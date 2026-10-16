// 设置页「朗读音源」行（#480 ④：音源 + 音色 + 试听）的**纯逻辑**：音源选项与音色候选。
//
// 🔴 为什么单开一个模块，而不是塞进 `pure/tts`：`pure/ttsCloud` 已经 `import` 了 `pure/tts`
//    （`clampTtsRate` / `TtsOption` / `VoiceGroup`）—— 在 `tts` 里反过来 import `ttsCloud` 会**成环**。
//    这个模块是两者**共同的下游**，谁都不用改。
// 🔴🔴 音色**不新开存储**：系统音色走 `VOICE_URI_KEY`（`rl-tts-voice`）、云音色走 `CLOUD_VOICE_KEY`
//    （`rl-tts-cloud-voice`），与阅读器朗读弹窗**读写同一份** —— ⛔ 别在这里造第二个真源。
import { groupVoices, pickVoiceIndex, type TtsEngineKind, type TtsVoiceLite, type VoiceGroup } from 'pure/tts';
import { cloudVoiceGroups, normalizeCloudVoice, SILICONFLOW_MODEL } from 'pure/ttsCloud';

/** 音源下拉的选项（顺序 = UI 顺序） */
export const TTS_ENGINE_CHOICES: { value: TtsEngineKind; label: string }[] = [
    { value: 'system', label: '系统语音' },
    { value: 'cloud', label: '硅基流动' },
];

/** 归一音源：只有 `'cloud'` 是云，其余（含脏数据 / undefined）一律系统语音（与阅读器同一口径） */
export function normalizeTtsEngineKind(v: unknown): TtsEngineKind {
    return v === 'cloud' ? 'cloud' : 'system';
}

/**
 * 「音色」下拉的候选分组：
 *  - 系统语音 → 按语言分「中文 / 英语 / 其它」三段（`groupVoices`，组内本地优先）；
 *  - 硅基流动 → 按**性别**分组（`cloudVoiceGroups`）。
 * 🔴 两个来源**互不混用**：系统 `voiceURI` 与云音色全称是两个 id 空间，拿错会被云侧拒（400）。
 */
export function ttsVoiceGroups(
    kind: TtsEngineKind,
    systemVoices: readonly TtsVoiceLite[],
    cur: string | null,
): VoiceGroup[] {
    return kind === 'cloud'
        ? cloudVoiceGroups(cur, SILICONFLOW_MODEL)
        : groupVoices([...systemVoices], cur);
}

/**
 * **实际会用的**音色 id：记忆里有就用它，否则给出该音源自己的兜底 ——
 *  - 系统语音 → `pickVoiceIndex`（语言匹配优先、其中本地优先；列表空 ⇒ 空串，交给引擎默认）；
 *  - 硅基流动 → `normalizeCloudVoice(null)`（云音色默认，必须带模型前缀）。
 * 🔴 给设置页用：按钮上要显示「马上会念的那个音色」，⛔ 不能因为「还没选过」就空白 ——
 *    而试听也必须拿**同一个** id，否则「显示的音色」与「听到的声音」是两回事。
 */
export function effectiveTtsVoice(
    kind: TtsEngineKind,
    systemVoices: readonly TtsVoiceLite[],
    cur: string | null,
): string {
    const pick = typeof cur === 'string' ? cur.trim() : '';
    if (pick) return pick;
    if (kind === 'cloud') return normalizeCloudVoice(null, SILICONFLOW_MODEL);
    const list = [...systemVoices];
    const i = pickVoiceIndex(list);
    return i >= 0 ? (list[i]?.voiceURI ?? '') : '';
}

/**
 * ⛔ #482 **撤回** #481 的「合并成一格」：用户看完实装后说那格「有点尴尬」（一个长长的下拉框 + 一个播放按钮）
 * ⇒ 拆回**两格**（音源 / 音色）。上面那套 `ttsMerged*` 随之**删除**（已无消费者，留着就是死代码）。
 * ⚠️ 记录这段往复：#480 两格 → #481 合并成一格 → #482 又拆回两格。
 *    两格的**挤**、一格的**长**，根子都在「系统语音名太长」⇒ #482 的解法是**窄 + 宽的分工**（音源窄 / 音色宽），
 *    并把截断的全称交给 `data-tip`。⛔ 下一轮别再无脑来回翻 —— 先看这条根因。
 */

/** 当前音色的显示名（在 `ttsVoiceGroups` 里找那个 `on` 的项）；找不到 ⇒ 空串（调用方给占位） */
export function ttsVoiceLabel(
    kind: TtsEngineKind,
    systemVoices: readonly TtsVoiceLite[],
    cur: string | null,
): string {
    const id = effectiveTtsVoice(kind, systemVoices, cur);
    for (const g of ttsVoiceGroups(kind, systemVoices, id)) {
        const hit = g.items.find((o) => o.on);
        if (hit) return hit.label;
    }
    return '';
}

/** 音源是否可用（云音源要先配 Key；系统语音看宿主有没有 Web Speech） */
export function ttsEngineBlockedReason(kind: TtsEngineKind, cloudReady: boolean, systemReady: boolean): string | null {
    if (kind === 'cloud') {
        return cloudReady ? null : '未配置硅基流动 API Key（设置 → AI集成 › 模型服务 · 硅基流动）';
    }
    return systemReady ? null : '当前环境不支持系统语音（Web Speech API 不可用）';
}
