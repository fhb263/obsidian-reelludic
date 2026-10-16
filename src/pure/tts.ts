// TTS 语音朗读的纯逻辑（#340 建立；#341 语速改横向滑条）。
// 🔴 只放**可单测**的东西：切句（按原文偏移）/ 偏移→文本节点映射 / 语速与语音菜单。
//    播放、高亮、滚动依赖 DOM 与 `window.speechSynthesis` ⇒ 在 `services/TtsService.ts`。

/** 语速滑条（右键弹窗「语速」行）：0.5–2 倍，0.25 一档（与既有档位 0.75/1/1.25/1.5/2 同网格） */
export const TTS_RATE_MIN = 0.5;
export const TTS_RATE_MAX = 2;
export const TTS_RATE_STEP = 0.25;
/** 缺省语速 = 正常速 */
export const TTS_RATE_DEFAULT = 1;
/** 记忆语速（localStorage：跨书共享一个语速，够用且不加设置字段 —— 与 `pure/readerToc` 同做法） */
export const TTS_RATE_KEY = 'rl-tts-rate';

/** 音调滑条（#343 方案 A：「音调」行；Web Speech 的 `pitch` 取值范围 0–2，默认 1） */
export const TTS_PITCH_MIN = 0.5;
export const TTS_PITCH_MAX = 1.5;
export const TTS_PITCH_STEP = 0.05;
export const TTS_PITCH_DEFAULT = 1;

// ── 音量（#351）──
// 🔴 音量是**播放侧增益**（系统引擎写 `utterance.volume`，云引擎写 `HTMLAudioElement.volume`）⇒
//    **与音源无关**：两个引擎都吃得下，也因此不进云侧合成的缓存键（同一句不同音量不必重新合成、不必再计费）。
export const TTS_VOLUME_MIN = 0;
export const TTS_VOLUME_MAX = 1;
export const TTS_VOLUME_STEP = 0.05;
export const TTS_VOLUME_DEFAULT = 1;
export const TTS_VOLUME_KEY = 'rl-tts-volume';

/** 记忆选中的语音（#343 方案 A：「记住选择」；此前只有语速会记） */
export const VOICE_URI_KEY = 'rl-tts-voice';

/** 试听用的固定短句（与正文无关 ⇒ 不写高亮、不滚动） */
export const VOICE_PREVIEW_TEXT = '这是一句试听。';

/**
 * 夹取 + 网格对齐音调（同语速口径，网格 0.05）；非法值回退 1
 */
export function clampTtsPitch(n: number): number {
    if (!Number.isFinite(n)) return TTS_PITCH_DEFAULT;
    const clamped = Math.min(TTS_PITCH_MAX, Math.max(TTS_PITCH_MIN, n));
    const steps = Math.round((clamped - TTS_PITCH_MIN) / TTS_PITCH_STEP);
    return Math.round((TTS_PITCH_MIN + steps * TTS_PITCH_STEP) * 100) / 100;
}

/**
 * 夹取 + **对齐网格**（🔴 网格锚定在 `TTS_RATE_MIN`，与 `input[type=range]` 的 `min + k*step` 语义一致；
 * 若锚定 0，滑条可拖到的档位与函数认可的值就会错开）。
 * 非法值（NaN / Infinity）回退 1（正常速）—— 不把朗读调成 0 或 NaN。
 */
export function clampTtsRate(n: number): number {
    if (!Number.isFinite(n)) return TTS_RATE_DEFAULT;
    const clamped = Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, n));
    const steps = Math.round((clamped - TTS_RATE_MIN) / TTS_RATE_STEP);
    // 浮点收尾：0.5 + 3×0.25 这类运算会带出 1.2500000000000002
    return Math.round((TTS_RATE_MIN + steps * TTS_RATE_STEP) * 100) / 100;
}

/** 读取记忆语速（localStorage 不可用 / 未存 → null，由调用方回退 1） */
export function loadTtsRate(): number | null {
    try {
        const raw = localStorage.getItem(TTS_RATE_KEY);
        if (raw === null) return null;
        return clampTtsRate(Number(raw));
    } catch {
        return null;
    }
}

/** 记住语速（跨阅读器共用；写不进就下次仍是正常速） */
export function saveTtsRate(rate: number): void {
    try {
        localStorage.setItem(TTS_RATE_KEY, String(clampTtsRate(rate)));
    } catch {
        /* 静默 */
    }
}

/**
 * 夹取 + **对齐网格**音量（#351）：网格锚在 `TTS_VOLUME_MIN`（= 0，与 `input[type=range]` 一致）。
 * 🔴 非法值回落 **满音量**（不是静音）：调不出声时用户的第一反应是「朗读坏了」，
 *    宁可响一点也不要让人以为功能失灵（要静音请自己拖到 0，那时文案会明说「静音」）。
 */
export function clampTtsVolume(n: number): number {
    if (!Number.isFinite(n)) return TTS_VOLUME_DEFAULT;
    const clamped = Math.min(TTS_VOLUME_MAX, Math.max(TTS_VOLUME_MIN, n));
    const steps = Math.round((clamped - TTS_VOLUME_MIN) / TTS_VOLUME_STEP);
    // 浮点收尾：0 + 11×0.05 会带出 0.5500000000000001
    return Math.round((TTS_VOLUME_MIN + steps * TTS_VOLUME_STEP) * 100) / 100;
}

/** 读取记忆音量（不可用 / 未存 → null，由调用方回退满音量） */
export function loadTtsVolume(): number | null {
    try {
        const raw = localStorage.getItem(TTS_VOLUME_KEY);
        if (raw === null) return null;
        return clampTtsVolume(Number(raw));
    } catch {
        return null;
    }
}

/** 记住音量（跨阅读器 / 跨音源共用） */
export function saveTtsVolume(volume: number): void {
    try {
        localStorage.setItem(TTS_VOLUME_KEY, String(clampTtsVolume(volume)));
    } catch {
        /* 静默 */
    }
}

/** 读取记忆的语音（不可用 / 未存 → null，由调用方回退引擎默认） */
export function loadVoiceUri(): string | null {
    try {
        const raw = localStorage.getItem(VOICE_URI_KEY);
        return raw ? raw : null;
    } catch {
        return null;
    }
}

/** 记住选中的语音（#343 方案 A） */
export function saveVoiceUri(uri: string): void {
    try {
        localStorage.setItem(VOICE_URI_KEY, uri);
    } catch {
        /* 静默 */
    }
}

/** 朗读音源（#344）：系统语音（Web Speech API）/ 云合成（OpenAI 兼容口）。🔴 真源只此一处，`ttsCloud` 反向依赖本文件 */
export type TtsEngineKind = 'system' | 'cloud';

/**
 * 记忆朗读音源（localStorage，与语速 / 音色同款做法）。
 * 🔴 为什么**不**用设置字段：音源是**使用态偏好**（今天想听云的就切云），不是「配置」；
 *    而且设置页下拉与阅读器弹窗 chips 都要写它，走 localStorage 两边都直接读写、不必来回透传回调。
 *    ⚠️ 它有别于语速的一点：刻意**不跟 vault 同步** —— 桌面用系统语音、手机用云合成本就是合理组合。
 */
export const TTS_ENGINE_KEY = 'rl-tts-engine';

/** 读取记忆音源（不可用 / 未存 / 值非法 → null，由调用方回退 system） */
export function loadTtsEngine(): TtsEngineKind | null {
    try {
        const raw = localStorage.getItem(TTS_ENGINE_KEY);
        return raw === 'cloud' || raw === 'system' ? raw : null;
    } catch {
        return null;
    }
}

/** 记住音源 */
export function saveTtsEngine(kind: TtsEngineKind): void {
    try {
        localStorage.setItem(TTS_ENGINE_KEY, kind === 'cloud' ? 'cloud' : 'system');
    } catch {
        /* 静默 */
    }
}

/** 菜单项：`value` 统一用字符串（语音 voiceURI 与云音色全称都走得通） */
export interface TtsOption {
    value: string;
    label: string;
    on: boolean;
    /** 不可点（如云音源未配置 Key）—— 渲染层应置灰，并把 `hint` 作为原因交代 */
    disabled?: boolean;
    /** 补充说明 / 置灰原因（渲染层用作 title；禁用项被点时可弹提示，别让用户点了没反应还不知道为什么） */
    hint?: string;
}

/** 弹窗里的一行**横向滑条**（#341：语速由档位胶囊改成滑条；HTML range 的原生语义与键盘 ←/→ 白拿） */
export interface TtsSlider {
    min: number;
    max: number;
    step: number;
    /** 🔴 必须是**已夹取**的值（越界值喂给 `input[type=range]` 会被浏览器自行吸收，UI 与真源就对不上了） */
    value: number;
}

export interface TtsMenuGroup {
    title: string;
    /** 有滑条的行（语速 / 音调）；其余组无 */
    slider?: TtsSlider;
    /**
     * 下拉选择项（**音源组**用；#351e 用户口径：由并排 chips 改成**下拉选择器**）。
     * ⚠️ 不可用项**保持可选**（不置 `disabled`）—— 选中后弹一次「去哪配」的说明、再自动回落当前音源。
     *    ⛔ 置灰的 `<option>` 根本点不了，用户就永远不知道该怎么办（#344 老口径：不静默没反应）。
     *    ⇒ 视图层读 `hint` 判「选了但不可用」，所以**不靠 `disabled` 表达不可用**。
     */
    select?: TtsOption[];
    items: TtsOption[];
    /** 语音 / 音色组专用（#343 方案 A：按语言 / 性别分组渲染）；其余组为 undefined */
    voiceGroups?: VoiceGroup[];
}

/** 语音分组（#343 方案 A：中文 → 英语 → 其它） */
export interface VoiceGroup {
    key: string;
    label: string;
    items: TtsOption[];
}

/** 语音的最小可用信息（`SpeechSynthesisVoice` 的结构化子集，便于单测与菜单渲染） */
export interface TtsVoiceLite {
    name: string;
    lang: string;
    voiceURI: string;
    localService?: boolean;
}

/** 一句话在**原文**中的区间（不做空白归一 —— 归一会让偏移错位 ⇒ 高亮打歪） */
export interface TtsSpan {
    start: number;
    end: number;
    text: string;
}

/** 偏移映射到「第 index 个文本节点」内的 [from, to) */
export interface SpanHit {
    index: number;
    from: number;
    to: number;
}

/**
 * 把整章文本切成一句句，返回**原文偏移**。
 * 🔴 为什么必须切：整章几万字直接喂给引擎，一停就全停，也没法「从当前位置继续」；
 *    Chromium 对超长 utterance 还会截断 / 卡顿。切句后才能逐句高亮 + 逐句滚动。
 * 切分顺序：句末标点 → 逗号/空格（已达 maxLen 时）→ 超过 maxLen*2 硬切。
 */
export function splitSentenceSpans(text: string, maxLen = 120): TtsSpan[] {
    const src = text ?? '';
    if (!src.trim()) return [];
    const out: TtsSpan[] = [];
    let from = 0;
    const push = (end: number): void => {
        const s = src.slice(from, end);
        if (s.trim()) out.push({ start: from, end, text: s });
        from = end;
    };
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if ('。！？…；.!?'.includes(ch)) {
            push(i + 1);
            continue;
        }
        const len = i + 1 - from;
        if (len >= maxLen && (ch === '，' || ch === ',' || ch === ' ' || ch === '、')) push(i + 1);
        else if (len >= maxLen * 2) push(i + 1);
    }
    if (from < src.length) push(src.length);
    return out;
}

/**
 * 字符偏移 → 文本节点序列里的区间（可能跨节点 ⇒ 返回多段）。
 * 🔴 越界一律夹取：Range 的起止越界会直接抛异常，而章节文本与 DOM 文本长度**天然可能有出入**
 *    （渲染时加了章标题、脚注等）⇒ 这里必须容错，宁可高亮少一点也不能让朗读崩掉。
 */
export function locateSpan(lengths: number[], start: number, end: number): SpanHit[] {
    const list = Array.isArray(lengths) ? lengths : [];
    let total = 0;
    for (const n of list) total += Number.isFinite(n) && n > 0 ? n : 0;
    if (total <= 0) return [];
    const from = Math.max(0, Math.min(total, Math.floor(start)));
    const to = Math.max(0, Math.min(total, Math.floor(end)));
    if (to <= from) return [];
    const hits: SpanHit[] = [];
    let acc = 0;
    for (let i = 0; i < list.length; i++) {
        const len = Number.isFinite(list[i]) && list[i] > 0 ? list[i] : 0;
        const segFrom = Math.max(from, acc);
        const segTo = Math.min(to, acc + len);
        if (segTo > segFrom) hits.push({ index: i, from: segFrom - acc, to: segTo - acc });
        acc += len;
        if (acc >= to) break;
    }
    return hits;
}

/**
 * 「从**当前段落**起读」（#342 用户指令）：把章节文本里的一个偏移换算成**起始句下标**。
 * 取第一句「末尾落在偏移之后」的句子 —— 也就是**包含该偏移**的那一句；句子边界归属下一句
 * （`span.end === offset` 视为已在下一句内）。
 * 🔴 偏移落到章尾之后（读完了再点朗读）→ 返回**最后一句**，⛔ 绝不回退 0
 *   （「点朗读却从头读整章」正是用户要修掉的行为）；非法 / 负偏移按 0 处理。
 */
export function startIndexAt(spans: TtsSpan[], offset: number): number {
    const list = Array.isArray(spans) ? spans : [];
    if (!list.length) return 0;
    const at = Number.isFinite(offset) ? Math.floor(Math.max(0, offset)) : 0;
    for (let i = 0; i < list.length; i++) if (list[i].end > at) return i;
    return list.length - 1;
}

/**
 * 「点击正文段落 → 起读点」（#355 用户指令）：把**第 index 个正文块**换算成章节文本里的起点偏移
 * = 前面各块文本长度之和。
 *
 * 🔴 为什么用「块长度累加」而不是 `Range.toString()` 量距离：两者**必须同口径**才好维护 ——
 *    本口径（只数文本、不数标签与 `<br>`）与 `locateSpan` 的「文本节点长度累计」逐字一致，
 *    而这正是 `TtsService.startOffset()` 量视口起读点用的算法（三处必须一致，否则
 *    起读点与高亮会错开一截 —— 本项目 #340 起就踩过「量法不一致」的坑）。
 * ⚠️ **空白文本节点也要计入**（它确实是正文内容的一部分，Range 同样会数到）—— 调用方传的是
 *    「全部子节点」的文本长度，别只挑元素节点。
 * 非法输入（越界 / NaN 长度）一律按 0 计（宁可差一点，⛔ 不能产出 NaN 偏移让后续全乱）。
 */
export function blockStartAt(blockLengths: number[], index: number): number {
    const list = Array.isArray(blockLengths) ? blockLengths : [];
    const at = Number.isFinite(index) ? Math.floor(index) : 0;
    if (at <= 0) return 0;
    const end = Math.min(list.length, at);
    let sum = 0;
    for (let i = 0; i < end; i++) {
        const n = list[i];
        sum += Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    }
    return sum;
}

/** 语速显示：1 倍显示「正常」，其余显示倍数 */
export function ttsRateLabel(rate: number): string {
    const r = clampTtsRate(rate);
    return r === 1 ? '正常' : `${r}×`;
}

/** 音调显示：1 显示「正常」，其余显示倍数（与语速同款，先乘后比以免浮点误差） */
export function ttsPitchLabel(pitch: number): string {
    const p = clampTtsPitch(pitch);
    return p === 1 ? '正常' : `${p}×`;
}

/** 音量显示（#351）：整数百分比；拖到 0 时直接说「静音」（「0%」还得让人反应一下） */
export function ttsVolumeLabel(volume: number): string {
    const v = clampTtsVolume(volume);
    if (v <= 0) return '静音';
    return `${Math.round(v * 100)}%`;
}

/** 语音显示名 */
export function voiceMenuLabel(v: TtsVoiceLite): string {
    return `${v.name} · ${v.lang}`;
}

/**
 * 挑语音下标：语言匹配优先 → 其中**本地**优先（离线可用）→ 退回第一个；空列表返回 -1（交给引擎默认）。
 * ⚠️ 语音列表是**异步**加载的：首次 `getVoices()` 常返回空 ⇒ 调用方要监听 `voiceschanged` 再取一次。
 */
export function pickVoiceIndex(list: TtsVoiceLite[], lang = 'zh-CN'): number {
    if (!Array.isArray(list) || !list.length) return -1;
    const head = lang.split('-')[0].toLowerCase();
    const same = list.filter((v) => (v.lang ?? '').toLowerCase().startsWith(head));
    const local = same.find((v) => v.localService);
    const hit = local ?? same[0];
    if (hit) return list.indexOf(hit);
    return 0;
}

/** 语音菜单项（on 只跟当前 voiceURI 走） */
export function ttsVoiceOptions(list: TtsVoiceLite[], curUri: string | null): TtsOption[] {
    return (Array.isArray(list) ? list : []).map((v) => ({
        value: v.voiceURI,
        label: voiceMenuLabel(v),
        on: !!curUri && v.voiceURI === curUri,
    }));
}

/**
 * 语音分组（#343 方案 A）。三组固定序：**中文 → 英语 → 其它** —— 中文用户第一眼要看到中文，
 * 而不是在一长串 `xx · en-US` 里找。组内**本地优先**（离线可用先出现），同级再按显示名排序（稳定可预期）。
 * 空语言标签 / 非中英语言一律进「其它」（**不丢项** —— 宁可归错组也不能让用户选不到自己的语音）。
 */
export function groupVoices(list: TtsVoiceLite[], curUri: string | null = null): VoiceGroup[] {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return [];
    const bucket = (v: TtsVoiceLite): string => {
        const head = (v.lang ?? '').toLowerCase().split('-')[0];
        return head === 'zh' ? 'zh' : head === 'en' ? 'en' : 'other';
    };
    const labels: Record<string, string> = { zh: '中文', en: '英语', other: '其它' };
    const order = ['zh', 'en', 'other'];
    const groups: VoiceGroup[] = [];
    for (const key of order) {
        const items = arr
            .filter((v) => bucket(v) === key)
            .sort((a, b) => {
                const la = a.localService ? 0 : 1;
                const lb = b.localService ? 0 : 1;
                if (la !== lb) return la - lb;
                return voiceMenuLabel(a).localeCompare(voiceMenuLabel(b));
            })
            .map((v) => ({
                value: v.voiceURI,
                label: voiceMenuLabel(v) + (v.localService ? '' : ' · 在线'),
                on: !!curUri && v.voiceURI === curUri,
            }));
        if (items.length) groups.push({ key, label: labels[key], items });
    }
    return groups;
}

/**
 * 右键弹窗的输入（#344 起改对象参数）：多到 7 项位置参数已经读不出谁是谁了。
 * ⚠️ `cloudVoices` 由**调用方**算好传进来（走 `ttsCloud.cloudVoiceGroups`）——
 *    这样本模块不必知道云的存在，也避免了 `tts ↔ ttsCloud` 循环依赖。
 */
export interface TtsMenuInput {
    engine: TtsEngineKind;
    /** 云音源是否可用（已配置 Key）；未配置 → 云项置灰 */
    cloudReady: boolean;
    rate: number;
    pitch: number;
    /** 播放侧增益（#351；音源无关 —— 两个引擎都吃） */
    volume: number;
    /** 系统语音列表（engine = system 时使用） */
    voices: TtsVoiceLite[];
    curUri: string | null;
    /** 已算好的云音色分组（engine = cloud 时使用） */
    cloudVoices: VoiceGroup[];
}

/**
 * 右键弹窗分组（#351 起按用户定的顺序：**音源 → 语音/音色 → 语速 → 音调 → 音量**）：
 *  - **音源组恒在**（用户 #344 裁定「弹窗里也能切」）：「系统语音 / 硅基流动」并排 chips；
 *  - **语音/音色组紧随其后**（都要挑一个「谁来读」，属于同一件事）；
 *  - 其后是三个滑条：**语速 / 音调 / 音量**；
 *  - engine = `system` → **音调**行 + **语音**组（语音 ≥2 个才给，且按语言分组）；
 *  - engine = `cloud`  → **音色**组（按性别分组）；🔴 **不给音调行** —— 云侧不支持 pitch（用户裁定：隐藏，不给假控件）；
 *    ⚠️ 但**音量行照给** —— 音量是播放侧增益（`HTMLAudioElement.volume`），云音源同样生效。
 * ⚠️ 语音 / 音色组的 `items` 恒为空数组 —— 内容在 `voiceGroups` 里（视图层渲染成 `<optgroup>`）：
 *    断言与视图都以 `voiceGroups` 为准，避免「同一份列表两个字段、有一个忘了更新」。
 * ⚠️ 顺序变了但**分组本身没删**：视图层按 title 渲染，断言按 title 数组钉顺序（防「悄悄又挪回去」）。
 * ⚠️ **#351e 起「音源」与「语音 / 音色」都用下拉选择器**（用户口径「把音源和音色选择都改成下拉选择器」）：
 *    音源走 `select`（本函数产出），语音 / 音色走 `voiceGroups` → 视图层拼 `<optgroup>`。
 */
export function buildTtsMenu(input: TtsMenuInput): TtsMenuGroup[] {
    const engine: TtsEngineKind = input?.engine === 'cloud' ? 'cloud' : 'system';
    const cloudReady = !!input?.cloudReady;
    const list = Array.isArray(input?.voices) ? input.voices : [];
    const cloud = Array.isArray(input?.cloudVoices) ? input.cloudVoices : [];
    const groups: TtsMenuGroup[] = [
        {
            title: '音源',
            select: [
                { value: 'system', label: '系统语音', on: engine === 'system' },
                {
                    value: 'cloud',
                    label: '硅基流动',
                    on: engine === 'cloud',
                    disabled: !cloudReady,
                    hint: cloudReady ? '' : '未配置 Key（设置 → AI集成 › 模型服务 · 硅基流动）',
                },
            ],
            items: [],
        },
    ];
    // 语音 / 音色（引擎相关，紧随音源）
    if (engine === 'cloud') {
        if (cloud.length) groups.push({ title: '音色', items: [], voiceGroups: cloud });
    } else if (list.length >= 2) {
        groups.push({ title: '语音', items: [], voiceGroups: groupVoices(list, input.curUri ?? null) });
    }
    groups.push({
        title: '语速',
        slider: { min: TTS_RATE_MIN, max: TTS_RATE_MAX, step: TTS_RATE_STEP, value: clampTtsRate(input?.rate) },
        items: [],
    });
    if (engine === 'system') {
        groups.push({
            title: '音调',
            slider: { min: TTS_PITCH_MIN, max: TTS_PITCH_MAX, step: TTS_PITCH_STEP, value: clampTtsPitch(input?.pitch) },
            items: [],
        });
    }
    groups.push({
        title: '音量',
        slider: { min: TTS_VOLUME_MIN, max: TTS_VOLUME_MAX, step: TTS_VOLUME_STEP, value: clampTtsVolume(input?.volume) },
        items: [],
    });
    return groups;
}
