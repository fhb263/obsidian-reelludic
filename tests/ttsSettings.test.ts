// 设置页「朗读音源」行（#480 ④）的纯逻辑：音源归一 / 音色候选 / 当前音色名。
// 🔴 这条链路的**价值**在于：设置页与阅读器朗读弹窗读写的是**同一份**记忆（系统 `rl-tts-voice`、
//    云 `rl-tts-cloud-voice`）—— 所以这里测的是「两个入口看到同一件事」，不是新造一套。
import { describe, it, expect } from 'vitest';
import {
    TTS_ENGINE_CHOICES,
    normalizeTtsEngineKind,
    ttsVoiceGroups,
    ttsVoiceLabel,
    effectiveTtsVoice,
    ttsEngineBlockedReason,
} from 'pure/ttsSettings';
import { CLOUD_VOICE_DEFAULT, SILICONFLOW_MODEL } from 'pure/ttsCloud';
import type { TtsVoiceLite } from 'pure/tts';

const VOICES: TtsVoiceLite[] = [
    { name: 'Tingting', lang: 'zh-CN', voiceURI: 'zh-1', localService: true },
    { name: 'Meijia', lang: 'zh-TW', voiceURI: 'zh-2', localService: false },
    { name: 'Samantha', lang: 'en-US', voiceURI: 'en-1', localService: true },
    { name: 'Amelie', lang: 'fr-FR', voiceURI: 'fr-1', localService: true },
];

describe('朗读音源（#480 ④）', () => {
    it('音源选项 = 系统语音 / 硅基流动（顺序即 UI 顺序）', () => {
        expect(TTS_ENGINE_CHOICES.map((o) => o.value)).toEqual(['system', 'cloud']);
        expect(TTS_ENGINE_CHOICES.map((o) => o.label)).toEqual(['系统语音', '硅基流动']);
    });

    it('normalizeTtsEngineKind：只有 cloud 是云，其余（含脏数据）一律系统语音', () => {
        expect(normalizeTtsEngineKind('cloud')).toBe('cloud');
        expect(normalizeTtsEngineKind('system')).toBe('system');
        expect(normalizeTtsEngineKind(undefined)).toBe('system');
        expect(normalizeTtsEngineKind('CLOUD')).toBe('system');
    });

    it('音色候选按音源分开：系统按语言分组（中文在前），云按性别分组', () => {
        const sys = ttsVoiceGroups('system', VOICES, 'zh-1');
        expect(sys.map((g) => g.label)).toEqual(['中文', '英语', '其它']);
        expect(sys[0].items.map((o) => o.value)).toEqual(['zh-1', 'zh-2']);
        // 当前项只亮一个
        expect(sys.flatMap((g) => g.items).filter((o) => o.on).map((o) => o.value)).toEqual(['zh-1']);

        const cloud = ttsVoiceGroups('cloud', VOICES, CLOUD_VOICE_DEFAULT);
        expect(cloud.map((g) => g.label)).toEqual(['男声', '女声']);
        expect(cloud.flatMap((g) => g.items).filter((o) => o.on).map((o) => o.value)).toEqual([CLOUD_VOICE_DEFAULT]);
    });

    it('🔴 两个音源的音色**不混用**：系统列表里没有云音色，云列表里没有 voiceURI', () => {
        const cloud = ttsVoiceGroups('cloud', VOICES, null);
        expect(cloud.flatMap((g) => g.items).every((o) => o.value.startsWith(SILICONFLOW_MODEL + ':'))).toBe(true);
        const sys = ttsVoiceGroups('system', VOICES, null);
        expect(sys.flatMap((g) => g.items).some((o) => o.value.includes(':'))).toBe(false);
    });

    it('effectiveTtsVoice：记住的优先；没记住 ⇒ 给该音源自己的兜底（按钮不许空白）', () => {
        expect(effectiveTtsVoice('system', VOICES, 'en-1')).toBe('en-1');
        expect(effectiveTtsVoice('system', VOICES, '')).toBe('zh-1'); // pickVoiceIndex：中文 + 本地优先
        expect(effectiveTtsVoice('system', [], null)).toBe(''); // 列表空 ⇒ 交给引擎默认
        expect(effectiveTtsVoice('cloud', VOICES, null)).toBe(CLOUD_VOICE_DEFAULT);
        // 云音色记住的若是半截 id，仍按原样交出去（渲染层由 cloudVoiceGroups 认不出来 ⇒ 回缺省）
        expect(effectiveTtsVoice('cloud', VOICES, 'bella')).toBe('bella');
    });

    it('#482：音色显示名按**当前音源**取（云侧给的是中文名，不是 id）；列表空 ⇒ 空串', () => {
        expect(ttsVoiceLabel('system', VOICES, 'zh-1')).toBe('Tingting · zh-CN');
        expect(ttsVoiceLabel('cloud', VOICES, CLOUD_VOICE_DEFAULT)).toBe('沉稳男声');
        expect(ttsVoiceLabel('system', [], null)).toBe(''); // ⛔ 不许编一个假名字，占位由调用方给
    });

    it('ttsEngineBlockedReason：不可用要给**可执行**的原因（指向去哪配）', () => {
        expect(ttsEngineBlockedReason('system', false, true)).toBeNull();
        expect(ttsEngineBlockedReason('cloud', true, false)).toBeNull();
        expect(ttsEngineBlockedReason('cloud', false, true)).toContain('硅基流动');
        expect(ttsEngineBlockedReason('cloud', false, true)).toContain('设置 → AI集成');
        expect(ttsEngineBlockedReason('system', true, false)).toContain('Web Speech');
    });
});
