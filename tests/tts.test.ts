import { describe, it, expect } from 'vitest';
import {
    TTS_ENGINE_KEY,
    TTS_PITCH_MAX,
    TTS_PITCH_MIN,
    TTS_PITCH_STEP,
    TTS_RATE_KEY,
    TTS_RATE_MAX,
    TTS_RATE_MIN,
    TTS_RATE_STEP,
    VOICE_URI_KEY,
    blockStartAt,
    buildTtsMenu,
    clampTtsPitch,
    clampTtsRate,
    clampTtsVolume,
    groupVoices,
    loadTtsEngine,
    loadTtsVolume,
    locateSpan,
    pickVoiceIndex,
    saveTtsEngine,
    saveTtsVolume,
    splitSentenceSpans,
    startIndexAt,
    ttsPitchLabel,
    ttsRateLabel,
    ttsVoiceOptions,
    ttsVolumeLabel,
    voiceMenuLabel,
    TTS_VOLUME_DEFAULT,
    TTS_VOLUME_MAX,
    TTS_VOLUME_MIN,
    TTS_VOLUME_STEP,
    type TtsMenuInput,
} from 'pure/tts';

describe('splitSentenceSpans（#340 朗读切句，🔴 按**原文偏移**，不做空白归一）', () => {
    it('句末标点切分，返回原文起止下标与文本', () => {
        const spans = splitSentenceSpans('你好。世界！');
        expect(spans.map((s) => s.text)).toEqual(['你好。', '世界！']);
        expect(spans[0]).toMatchObject({ start: 0, end: 3 });
        expect(spans[1]).toMatchObject({ start: 3, end: 6 });
    });

    it('🔴 偏移必须能对回原文（slice 出来与原句一致）—— 归一空白会让偏移错位 ⇒ 高亮打歪', () => {
        const src = '第一句。第二句！第三句？';
        for (const s of splitSentenceSpans(src)) {
            expect(src.slice(s.start, s.end)).toBe(s.text);
        }
    });

    it('🔴 原文含**连续空白 / 换行**时偏移依旧精确（一做空白归一偏移就错位 ⇒ 高亮打歪）—— 实测这条曾假绿', () => {
        const src = '第一段。\n\n   第二段  有空格！结尾。';
        const spans = splitSentenceSpans(src);
        expect(spans.length).toBe(3);
        for (const s of spans) expect(src.slice(s.start, s.end)).toBe(s.text);
        expect(spans[1].text).toBe('\n\n   第二段  有空格！');
    });

    it('超长无标点 → 按字数硬切（不喂给引擎一整章）', () => {
        const src = 'あ'.repeat(500);
        const spans = splitSentenceSpans(src, 120);
        expect(spans.length).toBeGreaterThan(1);
        expect(spans.every((s) => s.end - s.start <= 240)).toBe(true);
    });

    it('空文本 / 纯空白 → 空数组', () => {
        expect(splitSentenceSpans('')).toEqual([]);
        expect(splitSentenceSpans('   ')).toEqual([]);
    });
});

describe('locateSpan（字符偏移 → 文本节点下标区间，供 Range 建高亮）', () => {
    it('落在单个节点内', () => {
        expect(locateSpan([10, 10], 2, 5)).toEqual([{ index: 0, from: 2, to: 5 }]);
    });

    it('跨两个节点 → 拆成两段', () => {
        expect(locateSpan([5, 5], 3, 8)).toEqual([
            { index: 0, from: 3, to: 5 },
            { index: 1, from: 0, to: 3 },
        ]);
    });

    it('🔴 越界要夹取（不能产出负下标或超出节点长度 —— 否则 Range 抛异常）', () => {
        expect(locateSpan([4], 0, 99)).toEqual([{ index: 0, from: 0, to: 4 }]);
        expect(locateSpan([4], -5, 3)).toEqual([{ index: 0, from: 0, to: 3 }]);
        expect(locateSpan([], 0, 5)).toEqual([]);
        expect(locateSpan([4], 3, 3)).toEqual([]);
    });
});

describe('ttsRateLabel / clampTtsRate（右键「语速」= **横向滑条**）', () => {
    it('1 倍显示「正常」，其余显示倍数', () => {
        expect(ttsRateLabel(1)).toBe('正常');
        expect(ttsRateLabel(0.75)).toBe('0.75×');
        expect(ttsRateLabel(2)).toBe('2×');
    });

    it('夹到 0.5–2 之间，并对齐 0.25 网格（滑条只吐网格值）', () => {
        expect(clampTtsRate(1.25)).toBe(1.25);
        expect(clampTtsRate(0.1)).toBe(TTS_RATE_MIN);
        expect(clampTtsRate(99)).toBe(TTS_RATE_MAX);
        expect(clampTtsRate(1.13)).toBe(1.25);
    });

    it('非法值回退 1（正常速）—— 不把朗读调成 0 或 NaN', () => {
        expect(clampTtsRate(NaN)).toBe(1);
        expect(clampTtsRate(0)).toBe(0.5);
    });
});

describe('voiceMenuLabel / pickVoiceIndex / ttsVoiceOptions（右键「语音」）', () => {
    const voices = [
        { name: 'Microsoft David', lang: 'en-US', voiceURI: 'u-david', localService: true },
        { name: 'Microsoft Huihui', lang: 'zh-CN', voiceURI: 'u-huihui', localService: true },
        { name: 'Google 普通话', lang: 'zh-CN', voiceURI: 'u-google', localService: false },
    ];

    it('显示名 = 名称 + 语言', () => {
        expect(voiceMenuLabel(voices[1])).toBe('Microsoft Huihui · zh-CN');
    });

    it('🔴 优先**本地**且语言匹配的语音（离线可用优先于云端）', () => {
        expect(pickVoiceIndex(voices, 'zh-CN')).toBe(1);
        expect(pickVoiceIndex(voices, 'en-US')).toBe(0);
    });

    it('没有匹配语言 → 退回第一个；空列表 → -1（交给引擎默认）', () => {
        expect(pickVoiceIndex(voices, 'ja-JP')).toBe(0);
        expect(pickVoiceIndex([], 'zh-CN')).toBe(-1);
    });

    it('选项的 on 只跟当前 voiceURI 走', () => {
        const opts = ttsVoiceOptions(voices, 'u-google');
        expect(opts.filter((o) => o.on).map((o) => o.value)).toEqual(['u-google']);
        expect(ttsVoiceOptions(voices, null).some((o) => o.on)).toBe(false);
    });
});

describe('音源记忆（#344；node 无 localStorage ⇒ 只验安全兜底）', () => {
    it('读取不可用 → null（由调用方回退系统语音）；写入不得抛', () => {
        expect(loadTtsEngine()).toBeNull();
        expect(() => saveTtsEngine('cloud')).not.toThrow();
    });

    it('记忆键与语速 / 语音、以及云音色的键都不同（混用会让切源时选中态错乱）', () => {
        expect(TTS_ENGINE_KEY).toBe('rl-tts-engine');
        expect([TTS_RATE_KEY, VOICE_URI_KEY, TTS_ENGINE_KEY]).toHaveLength(3);
        expect(new Set([TTS_RATE_KEY, VOICE_URI_KEY, TTS_ENGINE_KEY]).size).toBe(3);
    });
});

describe('buildTtsMenu（#344 对象参数：音源下拉恒在；系统=音调+语音 / 云=音色且无音调）', () => {
    /** 系统音源的缺省输入（用例只覆盖自己关心的字段） */
    const mk = (over: Partial<TtsMenuInput> = {}): TtsMenuInput => ({
        engine: 'system',
        cloudReady: false,
        rate: 1.5,
        pitch: 0.8,
        volume: 0.7,
        voices: [],
        curUri: null,
        cloudVoices: [],
        ...over,
    });

    it('🔴 音源组**恒在**且是**下拉选择项**（系统语音 / 硅基流动），当前音源亮起（#351e 用户口径：chips → 下拉）', () => {
        const sys = buildTtsMenu(mk());
        expect(sys[0].title).toBe('音源');
        expect(sys[0].select?.map((c) => c.label)).toEqual(['系统语音', '硅基流动']);
        expect(sys[0].select?.filter((c) => c.on).map((c) => c.value)).toEqual(['system']);

        const cloud = buildTtsMenu(mk({ engine: 'cloud', cloudVoices: [{ key: 'male', label: '男声', items: [] }] }));
        expect(cloud[0].select?.filter((c) => c.on).map((c) => c.value)).toEqual(['cloud']);
    });

    it('🔴 云音源未配置 Key → 标不可用并给出原因（不给点了没反应的入口）', () => {
        const off = buildTtsMenu(mk({ engine: 'system', cloudReady: false }));
        const cloudItem = off[0].select?.find((c) => c.value === 'cloud');
        expect(cloudItem?.disabled).toBe(true);
        expect(cloudItem?.hint).toContain('API凭据');

        const ready = buildTtsMenu(mk({ engine: 'cloud', cloudReady: true, cloudVoices: [{ key: 'male', label: '男声', items: [] }] }));
        expect(ready[0].select?.find((c) => c.value === 'cloud')?.disabled).toBe(false);
    });

    it('系统音源：音源 + 语速 + 音调 + 音量（#351 音量行；滑条值**已夹取**、不带列表项）', () => {
        const g = buildTtsMenu(mk({ rate: 1.5, pitch: 0.8, volume: 0.7 }));
        expect(g.map((x) => x.title)).toEqual(['音源', '语速', '音调', '音量']);
        expect(g[1].slider).toEqual({ min: TTS_RATE_MIN, max: TTS_RATE_MAX, step: TTS_RATE_STEP, value: 1.5 });
        expect(g[2].slider).toEqual({ min: TTS_PITCH_MIN, max: TTS_PITCH_MAX, step: TTS_PITCH_STEP, value: 0.8 });
        expect(g[3].slider).toEqual({ min: TTS_VOLUME_MIN, max: TTS_VOLUME_MAX, step: TTS_VOLUME_STEP, value: 0.7 });
        expect(g[1].items).toEqual([]);
        expect(g[2].items).toEqual([]);
        expect(g[3].items).toEqual([]);
    });

    it('🔴 越界值不能原样喂给 input[type=range]（NaN → 正常速 / 满音量）', () => {
        const bad = buildTtsMenu(mk({ rate: 99, pitch: 99, volume: 99 }));
        expect(bad[1].slider?.value).toBe(TTS_RATE_MAX);
        expect(bad[2].slider?.value).toBe(TTS_PITCH_MAX);
        expect(bad[3].slider?.value).toBe(TTS_VOLUME_MAX);
        const nan = buildTtsMenu(mk({ rate: NaN, pitch: NaN, volume: NaN }));
        expect(nan[1].slider?.value).toBe(1);
        expect(nan[2].slider?.value).toBe(1);
        expect(nan[3].slider?.value).toBe(TTS_VOLUME_DEFAULT);
    });

    it('🔴 云音源**不给音调行**（云侧不支持 pitch —— 用户 #344 裁定：隐藏，不留假控件）；音量行照给（音量是**播放侧增益**，与合成无关）', () => {
        const g = buildTtsMenu(mk({ engine: 'cloud', cloudVoices: [{ key: 'male', label: '男声', items: [] }] }));
        expect(g.map((x) => x.title)).toEqual(['音源', '音色', '语速', '音量']);
        expect(g.some((x) => x.title === '音调')).toBe(false);
        expect(g[3].slider?.value).toBe(0.7); // = mk() 里的入参音量（音量与音源无关 ⇒ 云音源下同样带出来）
    });

    it('🔴 云音源下系统语音列表**不串味**（present 也不能让「语音」组冒出来）', () => {
        const two = [
            { name: 'a', lang: 'zh-CN', voiceURI: 'u1' },
            { name: 'b', lang: 'zh-CN', voiceURI: 'u2' },
        ];
        const g = buildTtsMenu(mk({ engine: 'cloud', voices: two, cloudVoices: [{ key: 'male', label: '男声', items: [] }] }));
        expect(g.map((x) => x.title)).toEqual(['音源', '音色', '语速', '音量']);
    });

    it('系统音源：语音 ≥2 个才给语音组，且该组走**分组渲染**（voiceGroups）；#351 起语音组紧随音源', () => {
        expect(buildTtsMenu(mk({ rate: 1, pitch: 1, voices: [{ name: 'a', lang: 'zh-CN', voiceURI: 'u1' }], curUri: 'u1' }))
            .map((x) => x.title)).toEqual(['音源', '语速', '音调', '音量']);
        const two = [
            { name: 'a', lang: 'zh-CN', voiceURI: 'u1' },
            { name: 'b', lang: 'zh-CN', voiceURI: 'u2' },
        ];
        const g = buildTtsMenu(mk({ rate: 1, pitch: 1, voices: two, curUri: 'u2' }));
        expect(g.map((x) => x.title)).toEqual(['音源', '语音', '语速', '音调', '音量']);
        expect(g[1].slider).toBeUndefined();
        expect(g[1].voiceGroups?.map((v) => v.label)).toEqual(['中文']);
        expect(g[1].voiceGroups?.[0].items.filter((i) => i.on).map((i) => i.value)).toEqual(['u2']);
    });
});

describe('startIndexAt（#342 从**当前段落**起读：章节文本偏移 → 起始句下标）', () => {
    // '第一句。第二句。第三句。' ⇒ span[0] = [0,4) / span[1] = [4,8) / span[2] = [8,12)
    const spans = splitSentenceSpans('第一句。第二句。第三句。');

    it('句子边界：偏移落在哪一句就**从这一句开头**读起（前一句的 end 不算命中）', () => {
        expect(startIndexAt(spans, 0)).toBe(0);
        expect(startIndexAt(spans, 3)).toBe(0);
        expect(startIndexAt(spans, 4)).toBe(1); // = span[0].end ⇒ 已在第二句里
        expect(startIndexAt(spans, 5)).toBe(1);
        expect(startIndexAt(spans, 11)).toBe(2);
    });

    it('🔴 偏移到了章尾之后（在末尾点朗读）→ 从**最后一句**读起，⛔ 绝不回退到 0 从头读整章', () => {
        expect(startIndexAt(spans, 12)).toBe(2);
        expect(startIndexAt(spans, 99999)).toBe(2);
    });

    it('非法 / 负数偏移一律当 0（从头）；空句列返回 0', () => {
        expect(startIndexAt(spans, -5)).toBe(0);
        expect(startIndexAt(spans, NaN)).toBe(0);
        expect(startIndexAt([], 42)).toBe(0);
    });
});

describe('blockStartAt（#355 点击段落 → 起读点：正文块长度累加）', () => {
    const lens = [10, 5, 8];

    it('第 0 段 = 0；第 n 段 = 前面各块文本长度之和', () => {
        expect(blockStartAt(lens, 0)).toBe(0);
        expect(blockStartAt(lens, 1)).toBe(10);
        expect(blockStartAt(lens, 2)).toBe(15);
    });

    it('🔴 与「Range 量距离」同口径：累加的是**每个子节点的文本长度**（含段间空白）', () => {
        // 段间 '\n' 这类空白文本节点也占位 —— 少算它，锚点整体前移，起读点会比点的地方早一截
        expect(blockStartAt([3, 1, 4], 2)).toBe(4);
    });

    it('越界 index → 累加到最后一块（不返回 NaN）；负数 / 非法 → 0 从头读', () => {
        expect(blockStartAt(lens, 99)).toBe(23);
        expect(blockStartAt(lens, -1)).toBe(0);
        expect(blockStartAt(lens, NaN)).toBe(0);
        expect(blockStartAt([], 3)).toBe(0);
        expect(blockStartAt(undefined as never, 2)).toBe(0);
    });

    it('🔴 非法长度（NaN / 负数 / Infinity）按 0 计 —— ⛔ 绝不产出 NaN 偏移（后续定位会全崩）', () => {
        expect(blockStartAt([NaN, 4, -3, Infinity, 2], 5)).toBe(6);
    });
});

describe('音调 pitch（#343 方案 A：与语速并列的横向滑条）', () => {
    it('夹到 0.5–1.5 并对齐 0.05 网格；非法值回退 1（正常）', () => {
        expect(clampTtsPitch(1)).toBe(1);
        expect(clampTtsPitch(0.1)).toBe(TTS_PITCH_MIN);
        expect(clampTtsPitch(9)).toBe(TTS_PITCH_MAX);
        expect(clampTtsPitch(1.13)).toBe(1.15);
        expect(clampTtsPitch(NaN)).toBe(1);
    });

    it('显示：1 显示「正常」，其余显示倍数', () => {
        expect(ttsPitchLabel(1)).toBe('正常');
        expect(ttsPitchLabel(0.8)).toBe('0.8×');
    });
});

describe('groupVoices（#343 方案 A：语音按语言分组 + 本地优先）', () => {
    const voices = [
        { name: 'David', lang: 'en-US', voiceURI: 'u-david', localService: false },
        { name: 'Microsoft Huihui', lang: 'zh-CN', voiceURI: 'u-huihui', localService: true },
        { name: 'Google 普通话', lang: 'zh-CN', voiceURI: 'u-google', localService: false },
        { name: 'Kyoko', lang: 'ja-JP', voiceURI: 'u-kyoko', localService: true },
        { name: 'unlabeled', lang: '', voiceURI: 'u-nolabel' },
    ];

    it('🔴 组序固定为 中文 → 英语 → 其它（中文用户第一眼要看到中文）', () => {
        expect(groupVoices(voices).map((g) => g.label)).toEqual(['中文', '英语', '其它']);
    });

    it('🔴 组内**本地优先**（离线可用先出现），同级再按名称稳定排序', () => {
        const zh = groupVoices(voices).find((g) => g.label === '中文');
        expect(zh?.items.map((i) => i.value)).toEqual(['u-huihui', 'u-google']);
    });

    it('「其它」收纳所有非中英语言与无语言标签的语音（不丢项）', () => {
        const other = groupVoices(voices).find((g) => g.label === '其它');
        expect(other?.items.map((i) => i.value).sort()).toEqual(['u-kyoko', 'u-nolabel']);
    });

    it('当前选中的语音在组里 on=true，且空列表 → 空数组（不报错）', () => {
        const zh = groupVoices(voices, 'u-google').find((g) => g.label === '中文');
        expect(zh?.items.filter((i) => i.on).map((i) => i.value)).toEqual(['u-google']);
        expect(groupVoices([])).toEqual([]);
        expect(groupVoices(undefined as never)).toEqual([]);
    });
});

describe('音量（#351：播放侧增益 —— 音源无关，两个引擎都吃）', () => {
    it('夹取到 [0,1] 并按 0.05 网格对齐（滑条只会吐网格值，手写值在这里被吸回）', () => {
        expect(clampTtsVolume(0.55)).toBe(0.55);
        expect(clampTtsVolume(9)).toBe(TTS_VOLUME_MAX);
        expect(clampTtsVolume(-3)).toBe(TTS_VOLUME_MIN);
        expect(clampTtsVolume(0.53)).toBe(0.55); // 0.53 / 0.05 = 10.6 → 11 → 0.55
        expect(clampTtsVolume(0.52)).toBe(0.5); // 10.4 → 10 → 0.5
    });

    it('🔴 非法值（NaN / 字符串）→ 满音量缺省（不能静音：用户会以为朗读坏了）', () => {
        expect(clampTtsVolume(NaN)).toBe(TTS_VOLUME_DEFAULT);
        expect(clampTtsVolume('0.3' as never)).toBe(TTS_VOLUME_DEFAULT);
        expect(TTS_VOLUME_DEFAULT).toBe(1);
    });

    it('音量文案：整数百分比；0 → 静音（不显示「0%」这种要反应一下的说法）', () => {
        expect(ttsVolumeLabel(1)).toBe('100%');
        expect(ttsVolumeLabel(0.55)).toBe('55%');
        expect(ttsVolumeLabel(0)).toBe('静音');
        expect(ttsVolumeLabel(NaN)).toBe('100%');
    });

    it('记忆读写：node 无 localStorage ⇒ 只验安全兜底（不抛、回落 null）', () => {
        expect(loadTtsVolume()).toBeNull();
        expect(() => saveTtsVolume(0.5)).not.toThrow();
    });
});
