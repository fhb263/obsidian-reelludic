// AI 摘要（一句话总结 + 核心看点）纯逻辑测试：prompt 构造、模型输出解析容错、多行看点互转。
import { describe, it, expect } from 'vitest';
import {
    AI_HIGHLIGHT_MAX_ITEMS,
    aiFieldsToText,
    DEFAULT_SUMMARY_PROMPT,
    buildAiSummaryBody,
    highlightsToText,
    parseAiSummaryResult,
    textToAiFields,
    textToHighlights,
    type AiSummaryInput,
} from 'pure/aiSummary';

const base: AiSummaryInput = {
    type: 'movie',
    title: '沙丘',
    year: 2021,
    genres: ['科幻', '冒险'],
    creator: '丹尼斯·维伦纽瓦',
    cast: ['提莫西·查拉梅', '赞达亚'],
    summary: '少年保罗·厄崔迪卷入沙漠星球的权力斗争。',
};

describe('pure/aiSummary buildAiSummaryBody', () => {
    it('无标题 → null（不该发请求）', () => {
        expect(buildAiSummaryBody({ ...base, title: '  ' })).toBeNull();
    });
    it('组装 OpenAI 兼容请求体：模型随服务商、system 约束 JSON 输出、user 含各字段', () => {
        const body = buildAiSummaryBody(base, 'deepseek');
        expect(body?.model).toBe('deepseek-v4-flash');
        expect(body?.stream).toBe(false);
        const sys = body!.messages[0].content;
        expect(sys).toContain('JSON');
        expect(sys).toContain('40 字');
        const user = body!.messages[1].content;
        expect(user).toContain('沙丘');
        expect(user).toContain('2021');
        expect(user).toContain('科幻 / 冒险');
        expect(user).toContain('丹尼斯·维伦纽瓦');
        expect(user).toContain('提莫西·查拉梅');
        expect(user).toContain('权力斗争');
    });
    it('默认服务商为智谱；缺省字段不产生空行', () => {
        const body = buildAiSummaryBody({ type: 'book', title: '三体' });
        expect(body?.model).toBe('GLM-4-Flash');
        const user = body!.messages[1].content;
        expect(user).not.toContain('年份');
        expect(user).not.toContain('题材');
        expect(user).not.toContain('主演');
    });
    it('超长简介/目录按上限截断（控 token）', () => {
        const body = buildAiSummaryBody({ ...base, summary: '甲'.repeat(3000), toc: '乙'.repeat(2000) })!;
        const user = body.messages[1].content;
        expect(user.length).toBeLessThan(2600);
        expect(user).toContain('…');
    });
});

describe('pure/aiSummary parseAiSummaryResult', () => {
    it('纯 JSON → summary + highlights', () => {
        const r = parseAiSummaryResult('{"summary":"沙漠星球的家族史诗","highlights":["沙虫生态","宗教与政治"]}');
        expect(r).toEqual({ summary: '沙漠星球的家族史诗', highlights: ['沙虫生态', '宗教与政治'] });
    });
    it('容忍 ```json 代码块围栏', () => {
        const r = parseAiSummaryResult('```json\n{"summary":"A","highlights":["x"]}\n```');
        expect(r).toEqual({ summary: 'A', highlights: ['x'] });
    });
    it('容忍 JSON 前后混入解释文字（提取首个对象）', () => {
        const r = parseAiSummaryResult('好的，结果如下：\n{"summary":"A","highlights":["x","y"]}\n希望有帮助。');
        expect(r?.summary).toBe('A');
        expect(r?.highlights).toEqual(['x', 'y']);
    });
    it('highlights 清洗：非字符串/空串丢弃、条数封顶', () => {
        const r = parseAiSummaryResult(JSON.stringify({ summary: 'S', highlights: ['a', '', '  ', 1, null, 'b', 'c', 'd', 'e', 'f', 'g'] }));
        expect(r?.highlights).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(r?.highlights.length).toBe(AI_HIGHLIGHT_MAX_ITEMS);
    });
    it('只有 highlights 也算成功（summary 允许空）', () => {
        const r = parseAiSummaryResult('{"highlights":["x"]}');
        expect(r).toEqual({ summary: '', highlights: ['x'] });
    });
    it('模型没给 JSON 而是一段话 → 整段当一句话总结，看点为 []', () => {
        const r = parseAiSummaryResult('沙漠星球的家族史诗，视觉与音效极强。');
        expect(r).toEqual({ summary: '沙漠星球的家族史诗，视觉与音效极强。', highlights: [] });
    });
    it('以 { 开头但 JSON 非法 → null（不把坏 JSON 当总结）', () => {
        expect(parseAiSummaryResult('{"summary": "没闭合')).toBeNull();
    });
    it('空/空白/null → null', () => {
        expect(parseAiSummaryResult('')).toBeNull();
        expect(parseAiSummaryResult('   ')).toBeNull();
        expect(parseAiSummaryResult(null)).toBeNull();
        expect(parseAiSummaryResult(undefined)).toBeNull();
    });
});

describe('pure/aiSummary 看点互转（表单多行框·每行一条）', () => {
    it('highlightsToText：数组 → 多行；空数组 → 空串', () => {
        expect(highlightsToText(['甲', '乙'])).toBe('甲\n乙');
        expect(highlightsToText([])).toBe('');
        expect(highlightsToText(undefined)).toBe('');
    });
    it('textToHighlights：去空行、剥 bullet 与序号、去重保序', () => {
        expect(textToHighlights('1. 硬核设定\n- 宏大尺度\n\n• 群像表演\n2、硬核设定')).toEqual(['硬核设定', '宏大尺度', '群像表演']);
        expect(textToHighlights('   ')).toEqual([]);
    });
    it('往返一致', () => {
        const list = ['硬核设定', '宏大尺度', '群像表演'];
        expect(textToHighlights(highlightsToText(list))).toEqual(list);
    });
});

describe('pure/aiSummary 单框合并（第一行 = 总结，其余行 = 带编号看点）', () => {
    it('aiFieldsToText：总结 + 看点顺序拼行（看点带 1./2. 编号）', () => {
        expect(aiFieldsToText('总结', ['甲', '乙'])).toBe('总结\n1. 甲\n2. 乙');
        expect(aiFieldsToText('总结', [])).toBe('总结');
        expect(aiFieldsToText('总结', undefined)).toBe('总结');
        expect(aiFieldsToText('', ['甲'])).toBe('\n1. 甲'); // 首行留空 = 总结槽为空，避免看点被顶到总结位
        expect(aiFieldsToText('', [])).toBe('');
        expect(aiFieldsToText('   ', ['甲', '  '])).toBe('\n1. 甲');
    });

    it('textToAiFields：首行 = 总结，其余非空行 = 看点', () => {
        expect(textToAiFields('总结\n甲\n乙')).toEqual({ aiSummary: '总结', aiHighlights: ['甲', '乙'] });
        expect(textToAiFields('总结')).toEqual({ aiSummary: '总结' });
        expect(textToAiFields('只有看点\n第二行')).toEqual({ aiSummary: '只有看点', aiHighlights: ['第二行'] });
    });

    it('首行留空 → 只产出看点（不把看点顶到总结位）', () => {
        expect(textToAiFields('\n甲\n乙')).toEqual({ aiHighlights: ['甲', '乙'] });
        expect(textToAiFields('\n\n甲')).toEqual({ aiHighlights: ['甲'] });
    });

    it('首行也剥 bullet/序号；空白文本 → 两字段都不产出', () => {
        expect(textToAiFields('- 总结\n1. 甲\n\n• 乙')).toEqual({ aiSummary: '总结', aiHighlights: ['甲', '乙'] });
        expect(textToAiFields('   ')).toEqual({});
        expect(textToAiFields('')).toEqual({});
    });

    it('看点去重保序 + 条数封顶', () => {
        expect(textToAiFields('S\na\na\nb')).toEqual({ aiSummary: 'S', aiHighlights: ['a', 'b'] });
        const many = textToAiFields(['S', ...'abcdefgh'].join('\n'));
        expect(many.aiHighlights?.length).toBe(AI_HIGHLIGHT_MAX_ITEMS);
    });

    it('编号只在展示层：落库值仍是无编号纯文本（往返无损）', () => {
        expect(aiFieldsToText('总结', ['甲', '乙'])).toContain('1. 甲'); // 展示带编号
        const a = textToAiFields(aiFieldsToText('沙漠星球的家族史诗', ['沙虫生态', '宗教隐喻']));
        expect(a).toEqual({ aiSummary: '沙漠星球的家族史诗', aiHighlights: ['沙虫生态', '宗教隐喻'] }); // 拆回不带编号
        const b = textToAiFields(aiFieldsToText('', ['沙虫生态', '宗教隐喻']));
        expect(b).toEqual({ aiHighlights: ['沙虫生态', '宗教隐喻'] });
    });
});

describe('pure/aiSummary 自定义服务提示词（设置页可改）', () => {
    it('传自定义 prompt → 作为 system 内容；不传/空白 → 用默认提示词', () => {
        const custom = buildAiSummaryBody({ type: 'movie', title: '沙丘' }, 'zhipu', '我的自定义提示词')!;
        expect(custom.messages[0]).toEqual({ role: 'system', content: '我的自定义提示词' });
        const blank = buildAiSummaryBody({ type: 'movie', title: '沙丘' }, 'zhipu', '   ')!;
        expect(blank.messages[0].content).toBe(DEFAULT_SUMMARY_PROMPT);
        const none = buildAiSummaryBody({ type: 'movie', title: '沙丘' }, 'zhipu')!;
        expect(none.messages[0].content).toBe(DEFAULT_SUMMARY_PROMPT);
    });
    it('默认提示词含关键约束（供设置页灰字展示）', () => {
        expect(DEFAULT_SUMMARY_PROMPT).toContain('40 字');
        expect(DEFAULT_SUMMARY_PROMPT).toContain('JSON');
    });
});
