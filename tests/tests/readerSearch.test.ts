// 阅读器划词搜索纯逻辑单测（TDD）
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SEARCH_PROMPT,
    DEFAULT_SEARCH_QUESTION_PROMPT,
    SEARCH_ENGINES,
    SEARCH_ENGINE_GROUPS,
    buildSearchBody,
    buildSearchQuestionBody,
    normalizeSearchEngine,
    searchEngineUrl,
} from 'pure/readerSearch';

describe('SEARCH_ENGINE_GROUPS（五类分组表）', () => {
    it('五组且组序固定：通用 / 垂直 / 特色 / 购物 / 学术', () => {
        expect(SEARCH_ENGINE_GROUPS.map((g) => g.id)).toEqual([
            'general', 'vertical', 'feature', 'shopping', 'academic',
        ]);
        expect(SEARCH_ENGINE_GROUPS.map((g) => g.label)).toEqual([
            '通用搜索', '垂直领域', '特色场景', '购物比价', '学术搜索',
        ]);
    });

    // 用户 2026-09-19：**每组统一 5 个**（竖排浮层五列等高；此前 3/9/4/3/5 参差）
    it('🔴 每组都是 5 个（5 × 5 = 25）', () => {
        expect(SEARCH_ENGINE_GROUPS.map((g) => g.engines.length)).toEqual([5, 5, 5, 5, 5]);
        expect(SEARCH_ENGINES.length).toBe(25);
    });

    it('SEARCH_ENGINES 由分组 flatten 派生（分组是唯一真源，防两份表漂移）', () => {
        expect(SEARCH_ENGINES.map((e) => e.id)).toEqual(
            SEARCH_ENGINE_GROUPS.flatMap((g) => g.engines.map((e) => e.id)),
        );
    });
});

describe('SEARCH_ENGINES（内置引擎表）', () => {
    it('25 个引擎 id 与顺序齐全（组序 + 组内序）', () => {
        expect(SEARCH_ENGINES.map((e) => e.id)).toEqual([
            'baidu', 'bing', 'google', 'sogou', 'quark',
            'weibo', 'xiaohongshu', 'zhihu', 'bilibili', 'douyin',
            'pan', 'ebook', 'music', 'video', 'steam',
            'jd', 'taobao', 'pdd', 'manmanbuy', 'smzdm',
            'wanfang', 'pubscholar', 'cnki', 'baiduxueshu', 'bingxueshu',
        ]);
    });

    // 反向守卫：2026-09-19 裁定删掉的 4 个不得隐形回流（回流会让该组又变 6+ 个、巡排不再等高）
    it('🔴 已裁掉的 4 个不得回流（今日头条 / 公众号 / 推特 / 油管）', () => {
        const ids = SEARCH_ENGINES.map((e) => e.id) as string[];
        for (const gone of ['toutiao', 'wechat', 'twitter', 'youtube']) expect(ids).not.toContain(gone);
    });

    // 2026-09-18：icon 字段已随「浮层去掉引擎图标」删除（改由主题色加粗文字识别），断言同步去掉
    it('id 唯一、label 非空、模板 https 且含 {q} 占位', () => {
        expect(new Set(SEARCH_ENGINES.map((e) => e.id)).size).toBe(SEARCH_ENGINES.length);
        for (const e of SEARCH_ENGINES) {
            expect(e.label.trim()).not.toBe('');
            expect(e.urlTemplate).toMatch(/^https:\/\//);
            expect(e.urlTemplate).toContain('{q}');
        }
    });

    it('中文业务名齐全（25 个入口一个不少）', () => {
        const labels = SEARCH_ENGINES.map((e) => e.label);
        for (const l of [
            '百度', 'Bing', 'Google', '搜狗', '夸克',
            '微博', '小红书', '知乎', 'B站', '抖音',
            '网盘', '电子书', '音乐', '影视', 'Steam',
            '京东', '淘宝', '拼多多', '慢慢买', '什么值得买',
            '万方', 'PubScholar', 'CNKI', '百度学术', 'Bing学术',
        ]) {
            expect(labels).toContain(l);
        }
    });
});

describe('normalizeSearchEngine（脏数据防护）', () => {
    it('合法 id 直通', () => {
        for (const e of SEARCH_ENGINES) expect(normalizeSearchEngine(e.id)).toBe(e.id);
    });

    it('未知 / 空 / 原型链键名一律回退首个', () => {
        expect(normalizeSearchEngine('duckduckgo')).toBe('baidu');
        expect(normalizeSearchEngine(undefined)).toBe('baidu');
        expect(normalizeSearchEngine('')).toBe('baidu');
        expect(normalizeSearchEngine('toString')).toBe('baidu');
        expect(normalizeSearchEngine('constructor')).toBe('baidu');
        expect(normalizeSearchEngine(123)).toBe('baidu');
    });
});

describe('searchEngineUrl（拼查询 URL）', () => {
    it('每个引擎都拼得出 https 链接且含编码后的查询词', () => {
        for (const e of SEARCH_ENGINES) {
            const url = searchEngineUrl(e.id, '斗罗大陆');
            expect(url).toMatch(/^https:\/\//);
            expect(url).toContain(encodeURIComponent('斗罗大陆'));
            expect(url).not.toContain('{q}');
        }
    });

    it('抖音是路径段形态（{q} 在 path 里）也能正确替换', () => {
        const url = searchEngineUrl('douyin', '斗罗大陆');
        expect(url).toBe(`https://www.douyin.com/search/${encodeURIComponent('斗罗大陆')}`);
    });

    it('特殊字符全部编码（空格 / & / # / 中文混合）', () => {
        const url = searchEngineUrl('bing', 'a b&c#d 中文');
        expect(url).toContain(encodeURIComponent('a b&c#d 中文'));
        expect(url).not.toContain(' a b'); // 不出现未编码的裸空格
    });

    it('空查询 / 纯空白 / 非字符串 → null（不发无效跳转）', () => {
        expect(searchEngineUrl('baidu', '')).toBeNull();
        expect(searchEngineUrl('baidu', '   \n ')).toBeNull();
        expect(searchEngineUrl('baidu', undefined as unknown as string)).toBeNull();
    });

    it('未知引擎回退首个（不返回 null，避免「选了引擎却没反应」）', () => {
        expect(searchEngineUrl('duckduckgo', 'x')).toBe(searchEngineUrl('baidu', 'x'));
    });
});

describe('buildSearchBody（AI 搜索请求体 · 解读选段）', () => {
    it('空 / 纯空白文本 → null（不发请求）', () => {
        expect(buildSearchBody('')).toBeNull();
        expect(buildSearchBody('   \n ')).toBeNull();
    });

    it('默认走智谱 GLM-4-Flash，system 用内置搜索提示词，user 为去空白后的查询', () => {
        const body = buildSearchBody('  主角推开门  ');
        expect(body?.model).toBe('GLM-4-Flash');
        expect(body?.messages[0]).toEqual({ role: 'system', content: DEFAULT_SEARCH_PROMPT });
        expect(body?.messages[1]).toEqual({ role: 'user', content: '主角推开门' });
        expect(body?.stream).toBe(false);
    });

    it('可切 DeepSeek 且提示词可覆盖；留空/纯空白回退默认提示词', () => {
        expect(buildSearchBody('x', 'deepseek')?.model).toBe('deepseek-v4-flash');
        expect(buildSearchBody('x', 'zhipu', '自定义搜索提示')?.messages[0].content).toBe('自定义搜索提示');
        expect(buildSearchBody('x', 'zhipu', '   ')?.messages[0].content).toBe(DEFAULT_SEARCH_PROMPT);
        expect(buildSearchBody('x', undefined as unknown as 'zhipu')?.model).toBe('GLM-4-Flash');
    });

    it('内置提示词含「不确定」条目口径（防编造）', () => {
        expect(DEFAULT_SEARCH_PROMPT).toContain('不确定');
    });
});

describe('buildSearchQuestionBody（AI 搜索请求体 · 自定义提问）', () => {
    it('问题为空 / 纯空白 → null（没问题不发请求）', () => {
        expect(buildSearchQuestionBody('选段', '')).toBeNull();
        expect(buildSearchQuestionBody('选段', '   \n ')).toBeNull();
    });

    it('system 固定用提问提示词，不读设置页提示词（函数签名里没有提示词入参）', () => {
        const body = buildSearchQuestionBody('选段', '他为什么要离开？');
        expect(body?.messages[0]).toEqual({ role: 'system', content: DEFAULT_SEARCH_QUESTION_PROMPT });
        expect(DEFAULT_SEARCH_QUESTION_PROMPT).not.toBe(DEFAULT_SEARCH_PROMPT);
        expect(DEFAULT_SEARCH_QUESTION_PROMPT).toContain('不确定');
        // 提问提示词是「只回答读者问的这件事」，与「解读选段」的概括口径不同
        expect(DEFAULT_SEARCH_QUESTION_PROMPT).toContain('直接回答读者的问题');
    });

    it('选段 + 问题一起发（分段标注），默认智谱、可切 DeepSeek', () => {
        const body = buildSearchQuestionBody('  主角推开门  ', '  他为什么要离开？  ');
        expect(body?.model).toBe('GLM-4-Flash');
        expect(body?.messages[1].content).toBe('【选段】\n主角推开门\n\n【问题】\n他为什么要离开？');
        expect(body?.stream).toBe(false);
        expect(buildSearchQuestionBody('x', 'q', 'deepseek')?.model).toBe('deepseek-v4-flash');
    });

    it('选段为空 → 只问问题（不出现空选段段头）', () => {
        expect(buildSearchQuestionBody('', '这是什么意思？')?.messages[1].content).toBe('这是什么意思？');
        expect(buildSearchQuestionBody('   ', '这是什么意思？')?.messages[1].content).toBe('这是什么意思？');
    });
});
