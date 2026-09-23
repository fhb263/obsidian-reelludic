// 朗读引擎（#344 方案 C 段）：把「怎么把这一句发出去」从 `TtsService` 里抽出来。
//
// 职责划分：
//   `TtsService` 只管**流程**（切句 / 队列 / 逐句高亮 / 居中滚动 / 按钮态 / 起读点）；
//   引擎只管**发声**（系统语音 or 云合成）。
// ⇒ 换音源时，那套反复打磨过的高亮与滚动逻辑一行不用动。
//
// 两个实现：
//   `SystemSpeechEngine`（本文件，Web Speech API，零依赖）
//   `CloudSpeechEngine`（services/CloudSpeechEngine.ts，OpenAI 兼容口）

import { clampTtsPitch, clampTtsRate, clampTtsVolume, pickVoiceIndex, type TtsVoiceLite } from 'pure/tts';

/** 一次朗读的参数（系统引擎用 pitch；🔴 云引擎不支持 pitch ⇒ 忽略它） */
export interface SpeechOpts {
    rate: number;
    pitch: number;
    /** 播放侧增益（#351；0–1，两个引擎都吃 —— 系统写 utterance、云写音频元素） */
    volume: number;
    voice: string | null;
}

/**
 * 一句的结果：
 *  - `ended`     正常读完 → 流程继续排下一句；
 *  - `cancelled` 被 `stop()` / `restart()` 取消 → **调用方已自行收尾，不要再动任何状态**；
 *  - `failed`    引擎自身失败（云失败等，提示已由引擎弹出）→ 调用方收尾（熄灭按钮、停止朗读）。
 */
export type SpeechResult = 'ended' | 'cancelled' | 'failed';

export interface SpeechEngine {
    /** 引擎是否可用（系统语音整套可能不可用；云引擎未配置 Key 时不可用） */
    available(): boolean;
    speak(text: string, opts: SpeechOpts): Promise<SpeechResult>;
    /** 试听（不写高亮、不滚动、不改按钮态） */
    preview(text: string, opts: SpeechOpts): void;
    cancel(): void;
    /**
     * 暂停 / 继续**当前这句**（#351 空格键）：
     *  - 暂停**不结束**这句 —— `speak()` 的 Promise 仍挂着，`onend` 尚未触发；
     *  - 继续后从**中断处**往下读（不是回到句首；回句首是 `cancel()` + 重排的语义）。
     * ⚠️ 未在发声时调用应当是**静默无操作**（键盘可能连按）。
     */
    pause(): void;
    resume(): void;
    dispose(): void;
    /**
     * 可选：提前合成。
     * 只有云引擎有意义（系统引擎没有「合成」这一步 ⇒ 不实现）。
     * 🔴 必须**幂等**：同一句重复调用不得重复请求（云侧按字符计费）。
     */
    prefetch?(text: string, opts: SpeechOpts): void;
    /** 系统语音列表（云音色的清单不从这里走 —— 它在 `pure/ttsCloud` 的固定表里） */
    voices(): TtsVoiceLite[];
}

/** Web Speech API 是否可用（移动端 WebView 常没有 ⇒ 按钮置灰） */
export function ttsSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/**
 * 系统语音引擎 —— 逐句朗读、试听、取语音列表的实现从 `TtsService` **原样搬来**（行为不变）。
 * 🔴 `token` 的用法与 #341 的 `gen` 守卫同源：`cancel()` 会**异步**回调旧句子的 `onend`，
 *   只有靠令牌才能分辨「读完」与「被取消」，否则会再多排一句（串音）。
 */
export class SystemSpeechEngine implements SpeechEngine {
    private voiceList: TtsVoiceLite[] = [];
    private onVoicesChanged?: () => void;
    private token = 0;

    constructor() {
        if (!ttsSupported()) return;
        const load = (): void => {
            this.voiceList = window.speechSynthesis.getVoices().map((v) => ({
                name: v.name,
                lang: v.lang,
                voiceURI: v.voiceURI,
                localService: v.localService,
            }));
        };
        load();
        // ⚠️ 语音列表是**异步**加载的（首次 `getVoices()` 常为空）⇒ 监听 `voiceschanged` 再取一次
        this.onVoicesChanged = load;
        window.speechSynthesis.addEventListener('voiceschanged', load);
    }

    available(): boolean {
        return ttsSupported();
    }

    voices(): TtsVoiceLite[] {
        return this.voiceList;
    }

    speak(text: string, opts: SpeechOpts): Promise<SpeechResult> {
        if (!ttsSupported()) return Promise.resolve('failed');
        const token = ++this.token;
        return new Promise<SpeechResult>((resolve) => {
            const u = this.build(text, opts);
            u.onend = (): void => resolve(token === this.token ? 'ended' : 'cancelled');
            u.onerror = (): void => resolve(token === this.token ? 'failed' : 'cancelled');
            window.speechSynthesis.speak(u);
        });
    }

    preview(text: string, opts: SpeechOpts): void {
        if (!ttsSupported()) return;
        this.token += 1; // 作废在飞的那句（它的 onend 回来会 resolve 'cancelled'）
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(this.build(text, opts));
    }

    cancel(): void {
        this.token += 1;
        if (ttsSupported()) window.speechSynthesis.cancel();
    }

    /**
     * 暂停 / 继续（#351）。⚠️ **不 token++**：暂停是「同一句的中场休息」，
     * 若在这里作废令牌，恢复时回来的 `onend` 会被当成 `cancelled` ⇒ 队列停在第 N 句不动（听起来像卡死）。
     * ⚠️ 浏览器若把 `pause()` 处理成「停在词边界」，恢复后也只是少读半个词，不会串音。
     */
    pause(): void {
        if (ttsSupported() && window.speechSynthesis.speaking) window.speechSynthesis.pause();
    }

    resume(): void {
        if (ttsSupported() && window.speechSynthesis.paused) window.speechSynthesis.resume();
    }

    dispose(): void {
        if (ttsSupported() && this.onVoicesChanged) {
            window.speechSynthesis.removeEventListener('voiceschanged', this.onVoicesChanged);
            this.onVoicesChanged = undefined;
        }
        this.cancel();
    }

    private build(text: string, opts: SpeechOpts): SpeechSynthesisUtterance {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = clampTtsRate(opts.rate);
        u.pitch = clampTtsPitch(opts.pitch);
        u.volume = clampTtsVolume(opts.volume);
        const v = this.findVoice(opts.voice);
        if (v) u.voice = v;
        return u;
    }

    private findVoice(uri: string | null): SpeechSynthesisVoice | null {
        if (!ttsSupported()) return null;
        const all = window.speechSynthesis.getVoices();
        if (!all.length) return null;
        if (uri) {
            const picked = all.find((v) => v.voiceURI === uri);
            if (picked) return picked;
        }
        const i = pickVoiceIndex(
            this.voiceList.length
                ? this.voiceList
                : all.map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService })),
        );
        return i >= 0 ? all[i] ?? null : null;
    }
}
