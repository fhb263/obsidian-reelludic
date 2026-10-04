// 云 TTS 的纯逻辑（#344 方案 C 段 · 硅基流动）。
//
// 🔴 只放**可单测**的东西：provider 表 / 端点归一 / 请求体 / 音色分组 / 错误归一 / 预取与缓存决策。
//    合成（HTTP）与播放（Audio）依赖宿主 ⇒ 在 `services/CloudSpeechEngine.ts`。
//
// ⚠️ 云侧的硬事实（官方文档核实，2026-09-19）：
//    ⑴ 返回是**二进制音频**（mp3），不是 JSON —— 不能走 chat 那条 JSON 通道；
//    ⑵ `voice` 必须带**模型名前缀**（`FunAudioLLM/CosyVoice2-0.5B:alex`），传裸 `alex` 会被拒；
//    ⑶ **不支持 pitch**（只有 speed + gain，gain 是音量）⇒ 云音源下「音调」行不给（用户 #344 裁定：隐藏）；
//    ⑷ 按字符计费 ⇒ 不无脑重试、句级缓存、预取只预一句。

import { clampTtsRate, type TtsOption, type VoiceGroup } from 'pure/tts';

/** 云失败归一后的种类（决定「重试」还是「提示」） */
export type SpeechErrorKind = 'ok' | 'auth' | 'quota' | 'http' | 'network';

/** 云音色（系统预置，固定表 —— 无需联网获取） */
export interface CloudVoice {
    /** 裸音色 id（真正发给 API 时要补模型名前缀） */
    id: string;
    /** 中文标签（给用户看；不出现服务商 / 模型名） */
    label: string;
    gender: 'male' | 'female';
}

/** 硅基流动 baseUrl（用户可在设置里改成别的 OpenAI 兼容口） */
export const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
/** 缺省模型：中文最优（另有 fishaudio/fish-speech-1.5、IndexTTS-2） */
export const SILICONFLOW_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';

/** 8 个系统预置音色（官方文档原表，顺序照搬） */
export const SILICONFLOW_VOICES: CloudVoice[] = [
    { id: 'alex', label: '沉稳男声', gender: 'male' },
    { id: 'benjamin', label: '低沉男声', gender: 'male' },
    { id: 'charles', label: '磁性男声', gender: 'male' },
    { id: 'david', label: '欢快男声', gender: 'male' },
    { id: 'anna', label: '沉稳女声', gender: 'female' },
    { id: 'bella', label: '激情女声', gender: 'female' },
    { id: 'claire', label: '温柔女声', gender: 'female' },
    { id: 'diana', label: '欢快女声', gender: 'female' },
];

/** 缺省云音色（全称） */
export const CLOUD_VOICE_DEFAULT = `${SILICONFLOW_MODEL}:alex`;
/** 记忆云音色（localStorage）—— 与系统语音的 `rl-tts-voice` **分开存**：两者 id 空间不同，混用会让切音源时选中态错乱 */
export const CLOUD_VOICE_KEY = 'rl-tts-cloud-voice';
/** 云合成重试上限（按字符计费 ⇒ 只给 1 次；auth / quota 一次都不给） */
export const SPEECH_MAX_RETRY = 1;
/** 输出格式：mp3（浏览器 `Audio` 支持最好，体积也小） */
export const SPEECH_FORMAT = 'mp3';

/** 音色分组标题（男声在前） */
const GENDER_LABEL: Record<CloudVoice['gender'], string> = { male: '男声', female: '女声' };

/**
 * 端点归一：`baseUrl` → `…/audio/speech`。
 * 🔴 三种输入都要吃下：裸 baseUrl / 带尾斜杠 / **用户把完整端点整个粘进来**（后者再接一次就废了）。
 * 空 / 非字符串 → 回退硅基流动缺省（不生成半截 URL）。
 */
export function speechEndpointUrl(baseUrl?: string): string {
    const raw = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
    const base = raw || SILICONFLOW_BASE_URL;
    return /\/audio\/speech$/.test(base) ? base : `${base}/audio/speech`;
}

/**
 * 音色 id 归一成**全称**（`模型:音色`）。
 * 🔴 已带 `:` 的值原样返回 —— 否则会拼出 `模型:模型:alex` 这种双前缀，云侧直接拒。
 */
export function cloudVoiceId(id: string, model = SILICONFLOW_MODEL): string {
    const v = typeof id === 'string' ? id.trim() : '';
    if (!v) return model === SILICONFLOW_MODEL ? CLOUD_VOICE_DEFAULT : `${model}:alex`;
    return v.includes(':') ? v : `${model}:${v}`;
}

/**
 * 记忆值归一：合法（全称 / 裸 id 且 id 在表里）→ 规范全称；其余（未知音色 / 空 / null）→ 缺省。
 * ⚠️ 裸 id 也要认 —— 早期版本或手改过的记忆值可能是裸 id，认不出就会丢掉用户的选中态。
 */
export function normalizeCloudVoice(id: string | null | undefined, model = SILICONFLOW_MODEL): string {
    const raw = typeof id === 'string' ? id.trim() : '';
    if (!raw) return cloudVoiceId('', model);
    const bare = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
    return SILICONFLOW_VOICES.some((v) => v.id === bare) ? cloudVoiceId(bare, model) : cloudVoiceId('', model);
}

/** 云合成请求体；空文本 → null（不发请求，省额度） */
export function buildSpeechBody(o: {
    text: string;
    voice: string;
    rate: number;
    model?: string;
}): Record<string, unknown> | null {
    const text = typeof o.text === 'string' ? o.text : '';
    if (!text.trim()) return null;
    return {
        model: o.model ?? SILICONFLOW_MODEL,
        input: text,
        voice: cloudVoiceId(o.voice, o.model ?? SILICONFLOW_MODEL),
        // 云侧支持 0.25–4，但 UI 值域是 0.5–2 ⇒ 按既有口径夹取，不把越界值透传出去
        speed: clampTtsRate(o.rate),
        response_format: SPEECH_FORMAT,
    };
}

/**
 * 云音色分组（男声 → 女声），供朗读弹窗的「音色」组渲染。
 * 当前值**认不出来就一个都不亮**（交渲染层回退缺省）—— 不让界面虚亮一项，用户点了才发现不对。
 */
export function cloudVoiceGroups(cur: string | null, model = SILICONFLOW_MODEL): VoiceGroup[] {
    const raw = typeof cur === 'string' ? cur.trim() : '';
    const bare = raw ? bareId(raw) : '';
    const target = bare && SILICONFLOW_VOICES.some((v) => v.id === bare) ? cloudVoiceId(bare, model) : '';
    const groups: VoiceGroup[] = [];
    for (const key of ['male', 'female'] as const) {
        const items: TtsOption[] = SILICONFLOW_VOICES.filter((v) => v.gender === key).map((v) => {
            const value = cloudVoiceId(v.id, model);
            return { value, label: v.label, on: !!target && value === target };
        });
        if (items.length) groups.push({ key, label: GENDER_LABEL[key], items });
    }
    return groups;
}

/** 取 `模型:音色` 里的音色段（无前缀则整串） */
function bareId(id: string): string {
    const v = typeof id === 'string' ? id.trim() : '';
    return v.includes(':') ? v.slice(v.lastIndexOf(':') + 1) : v;
}

/**
 * 云失败归一。`status = 0` 表示连接层就失败了（调用方传入）。
 * 🔴 400 里带「余额 / balance / 充值」也归 `quota` —— 各家习惯把余额不足塞在 400 里，
 *    只看状态码会把「欠费」误报成「服务异常」，用户按提示去查网络就白折腾。
 */
export function classifySpeechError(status: number, body = ''): { kind: SpeechErrorKind; message: string } {
    const s = Number.isFinite(status) ? Math.floor(status) : 0;
    if (s === 200) return { kind: 'ok', message: '' };
    if (s === 0) return { kind: 'network', message: '无法连接音色服务，请检查网络后重试' };
    if (s === 401 || s === 403) {
        return { kind: 'auth', message: '音色服务 Key 无效或未授权（HTTP 401），请到 设置 → AI集成 › 模型服务 · 硅基流动 检查' };
    }
    const text = typeof body === 'string' ? body.toLowerCase() : '';
    if (s === 429 || /balance|余额|quota|insufficient|充值|欠费/.test(text)) {
        return { kind: 'quota', message: '额度不足或请求过于频繁，请检查账户余额后重试' };
    }
    return { kind: 'http', message: `音色服务返回异常（HTTP ${s}）` };
}

/** 是否值得重试（auth / quota 一律不重试 —— 重试白费工夫还烧额度） */
export function shouldRetry(attempt: number, kind: SpeechErrorKind): boolean {
    if (kind !== 'http' && kind !== 'network') return false;
    const n = Number.isFinite(attempt) ? Math.floor(attempt) : 0;
    return n >= 0 && n < SPEECH_MAX_RETRY;
}

/**
 * 该预取哪一句（-1 = 不预取）。只预**下一句**：云合成每句要一次网络往返，
 * 不预取就会每句之间空 0.5–2 秒；预太多则额度被提前烧掉。
 * 🔴 已在合成中的不重复请求（重复 = 重复计费）；末句 / 越界 / 非法一律 -1。
 */
export function prefetchIndex(at: number, total: number, inflight: number[] = []): number {
    if (!Number.isFinite(at) || !Number.isFinite(total)) return -1;
    const cur = Math.floor(at);
    const n = Math.floor(total);
    if (cur < 0 || n <= 0 || cur >= n - 1) return -1;
    const next = cur + 1;
    return (Array.isArray(inflight) ? inflight : []).includes(next) ? -1 : next;
}

/** 句级缓存键（🔴 语速 / 音色也在键里：换了就该重新合成，不能拿旧音频糊弄） */
export function speechCacheKey(text: string, voice: string, rate: number): string {
    return `${voice}|${clampTtsRate(rate)}|${text}`;
}

/** 读取记忆云音色（localStorage 不可用 / 未存 → null，由调用方回退缺省） */
export function loadCloudVoice(): string | null {
    try {
        const raw = localStorage.getItem(CLOUD_VOICE_KEY);
        return raw ? normalizeCloudVoice(raw) : null;
    } catch {
        return null;
    }
}

/** 记住云音色（写不进就下次仍是缺省音色） */
export function saveCloudVoice(id: string): void {
    try {
        localStorage.setItem(CLOUD_VOICE_KEY, normalizeCloudVoice(id));
    } catch {
        /* 静默 */
    }
}
