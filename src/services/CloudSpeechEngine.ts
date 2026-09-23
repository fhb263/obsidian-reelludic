// 云合成引擎（#344 方案 C 段 · 硅基流动 / OpenAI 兼容的 `/audio/speech`）。
//
// 🔴 与系统引擎的四处不同，来源都是官方文档核实过的事实：
//    ⑴ 返回是**二进制音频**（不是 JSON）⇒ HTTP 通道必须取 arrayBuffer；
//    ⑵ `voice` 要**模型前缀**（`…CosyVoice2-0.5B:alex`）⇒ 由 `pure/ttsCloud.cloudVoiceId` 补；
//    ⑶ **不支持 pitch** ⇒ 忽略 `opts.pitch`（菜单侧也不给音调行）；
//    ⑷ 按**字符**计费 ⇒ 句级缓存 + 只重试 1 次 + 预取幂等。
//
// ⚠️ `requestUrl` 没有 AbortSignal ⇒ 取消**不能真的掐断**在飞的请求，
//    只能靠**令牌**：回来时令牌对不上就丢弃结果（不播、不写缓存）。同理，预取回来的音频若已过时，
//    也只是躺在缓存里，无害。

import {
    buildSpeechBody,
    classifySpeechError,
    normalizeCloudVoice,
    shouldRetry,
    speechCacheKey,
    speechEndpointUrl,
} from 'pure/ttsCloud';
import type { SpeechEngine, SpeechOpts, SpeechResult } from 'services/SpeechEngine';
import { clampTtsVolume, type TtsVoiceLite } from 'pure/tts';

/** 合成请求（窄接口 ⇒ 生产传 Obsidian `requestUrl` 薄封装，测试注入桩） */
export interface SpeechHttpRequest {
    url: string;
    headers: Record<string, string>;
    body: string;
}

export interface SpeechHttpResponse {
    status: number;
    arrayBuffer: ArrayBuffer;
    text: string;
}

export type SpeechHttp = (req: SpeechHttpRequest) => Promise<SpeechHttpResponse>;

export interface CloudEngineOpts {
    http: SpeechHttp;
    /** 取 Key（**每次现取** ⇒ 刚在设置里填完就能用，不必重开阅读器） */
    key: () => string;
    /** 取 baseUrl（设置里可改；缺省走硅基流动） */
    baseUrl?: () => string;
    /** 提示通道（失败说一句；不刷屏） */
    notice?: (msg: string) => void;
    /** 句级缓存条数上限 */
    cacheMax?: number;
}

/** 句级缓存上限（一句 mp3 约 10–40KB ⇒ 80 条 ≈ 数 MB，够回翻重听又不至于撑内存） */
export const CLOUD_CACHE_MAX = 80;

export class CloudSpeechEngine implements SpeechEngine {
    /** 句级缓存（Map 保序 ⇒ 天然可做 LRU：命中即挪到尾部） */
    private cache = new Map<string, Blob>();
    /** 在飞请求（幂等：同一句并发只发一次，绝不重复计费） */
    private inflight = new Map<string, Promise<Blob | null>>();
    /** 复用一个 Audio 元素：换句只换 src，取消就是 pause（多实例会叠音） */
    private audio: HTMLAudioElement | null = null;
    private token = 0;
    private readonly cacheMax: number;

    constructor(private opts: CloudEngineOpts) {
        this.cacheMax = opts.cacheMax && opts.cacheMax > 0 ? opts.cacheMax : CLOUD_CACHE_MAX;
    }

    /** 可用 = 有 Key（没 Key 时按钮该走回退/置灰，而不是发一个注定 401 的请求） */
    available(): boolean {
        return !!this.keyOf();
    }

    /** 云音色清单不走这里（固定表在 `pure/ttsCloud`）⇒ 恒空，避免与系统语音列表混用 */
    voices(): TtsVoiceLite[] {
        return [];
    }

    async speak(text: string, opts: SpeechOpts): Promise<SpeechResult> {
        const token = ++this.token;
        const blob = await this.synth(text, opts);
        if (token !== this.token) return 'cancelled'; // 已被 stop / restart / 换句作废
        if (!blob) return 'failed'; // 失败原因已由 synth 弹过提示
        return this.play(blob, token, opts);
    }

    /** 提前合成（幂等：命缓存 / 在飞都直接返回，不会重复请求） */
    prefetch(text: string, opts: SpeechOpts): void {
        void this.synth(text, opts);
    }

    preview(text: string, opts: SpeechOpts): void {
        void this.speak(text, opts); // 试听与朗读同一条链路；不写高亮 / 不滚动（那是 TtsService 的事）
    }

    cancel(): void {
        this.token += 1;
        if (!this.audio) return;
        try {
            this.audio.pause();
        } catch {
            /* 静默 */
        }
    }

    /**
     * 暂停 / 继续（#351）。云侧的「这一句」就是一个 `HTMLAudioElement` ⇒ 原生 `pause()`/`play()`，
     * 从**中断处**续读。
     * 🔴 **不 `token++`**（与 `cancel()` 的区别就在这）：暂停不是作废，那句的 Promise 还要继续挂着，
     *   回来时的 `onended` 才算「读完」；作废令牌会让队列误判成 cancelled ⇒ 卡在第 N 句。
     */
    pause(): void {
        try {
            this.audio?.pause();
        } catch {
            /* 静默 */
        }
    }

    resume(): void {
        const a = this.audio;
        if (!a) return;
        void a.play().catch(() => {
            /* 恢复被拒（设备被抢）：静默，用户再点一次即可 */
        });
    }

    dispose(): void {
        this.cancel();
        this.cache.clear();
        this.inflight.clear();
        this.audio = null;
    }

    // ── 合成 ──

    private keyOf(): string {
        return (this.opts.key() ?? '').trim();
    }

    private async synth(text: string, opts: SpeechOpts): Promise<Blob | null> {
        const key = this.keyOf();
        if (!key) {
            this.opts.notice?.('未配置音色服务 Key（设置 → AI集成 › API凭据 · 硅基流动）');
            return null;
        }
        // 🔴 防御性归一：万一传进来的是**系统语音 id**（两个音源之间串味），也把它落回缺省云音色 ——
        //    否则会拼出 `模型:Microsoft Huihui` 这种鬼东西让云侧回 400。
        const voice = normalizeCloudVoice(opts.voice);
        const ck = speechCacheKey(text, voice, opts.rate);
        const hit = this.cache.get(ck);
        if (hit) {
            // 命中挪到尾部（LRU：常用的别被挤掉 —— 回翻重听正是高频场景）
            this.cache.delete(ck);
            this.cache.set(ck, hit);
            return hit;
        }
        const flying = this.inflight.get(ck);
        if (flying) return flying;
        const task = this.request(text, voice, opts.rate).finally(() => this.inflight.delete(ck));
        this.inflight.set(ck, task);
        const blob = await task;
        if (blob) this.remember(ck, blob);
        return blob;
    }

    /** 一次合成（含有限重试）；失败时弹一次提示并返回 null */
    private async request(text: string, voice: string, rate: number): Promise<Blob | null> {
        const body = buildSpeechBody({ text, voice, rate });
        if (!body) return null;
        const url = speechEndpointUrl(this.opts.baseUrl?.());
        const headers = { Authorization: `Bearer ${this.keyOf()}`, 'Content-Type': 'application/json' };
        const payload = JSON.stringify(body);
        for (let attempt = 0; ; attempt++) {
            let res: SpeechHttpResponse;
            try {
                res = await this.opts.http({ url, headers, body: payload });
            } catch (err) {
                const { kind, message } = classifySpeechError(0, err instanceof Error ? err.message : '');
                if (shouldRetry(attempt, kind)) continue;
                this.opts.notice?.(message);
                return null;
            }
            const { kind, message } = classifySpeechError(res.status, res.text);
            if (kind === 'ok') {
                const buf = res.arrayBuffer;
                if (!buf || buf.byteLength === 0) {
                    this.opts.notice?.('音色服务返回了空音频，请稍后重试');
                    return null;
                }
                return new Blob([buf], { type: 'audio/mpeg' });
            }
            if (shouldRetry(attempt, kind)) continue;
            this.opts.notice?.(message);
            return null;
        }
    }

    private remember(key: string, blob: Blob): void {
        this.cache.set(key, blob);
        // Map 的迭代顺序 = 插入顺序 ⇒ 第一个就是最旧的
        while (this.cache.size > this.cacheMax) {
            const oldest = this.cache.keys().next().value;
            if (oldest === undefined) break;
            this.cache.delete(oldest);
        }
    }

    // ── 播放 ──

    private play(blob: Blob, token: number, opts: SpeechOpts): Promise<SpeechResult> {
        return new Promise<SpeechResult>((resolve) => {
            const url = URL.createObjectURL(blob);
            const a = (this.audio ??= new Audio());
            a.src = url;
            // 音量（#351）：播放侧增益 —— 与合成无关（不进缓存键，也就不会因调音量重复计费）
            a.volume = clampTtsVolume(opts.volume);
            const done = (res: SpeechResult): void => {
                a.onended = null;
                a.onerror = null;
                try {
                    URL.revokeObjectURL(url);
                } catch {
                    /* 静默 */
                }
                resolve(res);
            };
            a.onended = (): void => done(token === this.token ? 'ended' : 'cancelled');
            a.onerror = (): void => done(token === this.token ? 'failed' : 'cancelled');
            void a.play().catch(() => {
                // 播放被拒（autoplay 策略 / 设备占用）：提示一次并停，不静默变哑巴
                if (token === this.token) this.opts.notice?.('音频无法播放，请检查系统音频设备');
                done(token === this.token ? 'failed' : 'cancelled');
            });
        });
    }
}
