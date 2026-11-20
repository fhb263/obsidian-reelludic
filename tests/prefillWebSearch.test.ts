// m15532 ②：AI 预填要「依据网络权威搜索」，而不是只查本地元数据源。
//
// 🔴 背景（用户原话）：「AI预填的GLM4-flash模型搜索怎么只依据元数据源搜索的，要依据网络权威搜索啊」。
// 两层真因：
//   ① 提示词压根没提 `web_search`（只点了 `lookup_metadata` 与 `fetch_page`）⇒ 模型自然先查本地源；
//   ② 即便提示词让联网，搜索引擎对**含空格的中文多段查询**会逐字拆词（实测见 `src/pure/bingSearch.ts`
//      里 `compactBingQuery` 的注释），`web_search` 拿回来的全是单字词典页。
// 本文件守的是「这两处修法都不许回潮」——源码级判据，不依赖产品产物。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFILL_PROMPT } from 'pure/aiPrefill';
import { compactBingQuery } from 'pure/bingSearch';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

describe('② AI 预填提示词：联网权威搜索排第一位（⛔ 不许只查本地元数据源）', () => {
    it('提示词里出现 `web_search`，且排在 `lookup_metadata` 之前', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('web_search');
        const atWeb = DEFAULT_PREFILL_PROMPT.indexOf('web_search');
        const atMeta = DEFAULT_PREFILL_PROMPT.indexOf('lookup_metadata');
        expect(atWeb).toBeGreaterThanOrEqual(0);
        expect(atMeta).toBeGreaterThanOrEqual(0);
        expect(atWeb).toBeLessThan(atMeta);
    });

    it('🔴 明确交代「本地元数据源只当交叉核对」（这是用户抱怨的那一句）', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('交叉核对');
        expect(DEFAULT_PREFILL_PROMPT).toContain('别把它当成唯一来源');
    });

    // 🔴 m17001（2026-11-20 实测翻面）：原判据要求提示词写死「查询词只写作品名本身」，
    //    但真机四组对照证明这条**只对必应回落通道成立**：DeepSeek 原生检索是语义重排，
    //    单段「七里香」首条返回「千里香 Murraya paniculata」植物页，「七里香 周杰伦 歌曲」才对；
    //    「艾尔登法环」单段前 3 条没有 FromSoftware，加限定词才有。
    //    ⇒ 现在要求**两条通道分别写清**（原生：多段；必应：单段），⛔ 别退回「一刀切单段」。
    it('🔴 查询词口径必须按通道分流：原生用多段、必应回落才用单段', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('平台原生检索');
        expect(DEFAULT_PREFILL_PROMPT).toContain('作品名 + 作者/导演/开发商');
        expect(DEFAULT_PREFILL_PROMPT).toContain('必应');
        expect(DEFAULT_PREFILL_PROMPT).toContain('单段作品名');
        // 必应拆词这条真实缺陷必须留着（回落通道仍然成立）
        expect(DEFAULT_PREFILL_PROMPT).toContain('拆成单个字');
    });

    it('⛔ 反向守卫：不许把查询词口径写死成「只写作品名」（对原生检索是错的）', () => {
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('查询词只写作品名本身');
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('别拼「作品名 + 简介/豆瓣/年份」');
    });

    it('⛔ 反向守卫：也不许写死成「一律多段」（必应回落通道会被拆字）', () => {
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('查询词一律用多段');
    });

    // m17001 精简：简介与题材两段合并成一条硬约束，原句「先 web_search 找权威条目页、再 fetch_page
    // 抓它的原文」不再逐字存在 ⇒ 改判成「两步都提到且顺序正确」，语义判据不放宽。
    it('简介那段仍然要求先搜后抓（提示词自洽，不留旧口径）', () => {
        const atSearch = DEFAULT_PREFILL_PROMPT.indexOf('web_search');
        const atFetch = DEFAULT_PREFILL_PROMPT.indexOf('fetch_page');
        expect(atSearch).toBeGreaterThanOrEqual(0);
        expect(atFetch).toBeGreaterThan(atSearch);
        expect(DEFAULT_PREFILL_PROMPT).toContain('权威条目页');
        expect(DEFAULT_PREFILL_PROMPT).toContain('抓下来读正文');
    });

    // 🔴 m17001 精简：原「简介只照抄」+「无原文绝不写简介」+「题材照抄」三段说了三遍同一件事，
    //    合并成一条硬约束。这里钉住「合并后仍然同时包含 照抄 / 省略 / 载体」三要素，⛔ 别精简丢约束。
    it('精简后简介与题材的硬约束一条不少', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('只照抄');
        expect(DEFAULT_PREFILL_PROMPT).toContain('简介原文');
        expect(DEFAULT_PREFILL_PROMPT).toContain('题材原文');
        expect(DEFAULT_PREFILL_PROMPT).toContain('绝不写');
        expect(DEFAULT_PREFILL_PROMPT).toContain('载体');
        expect(DEFAULT_PREFILL_PROMPT).toContain('不要润色');
    });
});

describe('② 宿主 web_search：查询单段化 + 把实际用的词告诉模型', () => {
    const mainSrc = read('main.ts');

    it('web_search 分支走 `buildBingRssUrl`（内部已单段化）', () => {
        expect(mainSrc).toContain('const url = buildBingRssUrl(query);');
    });

    it('🔴 回报实际使用的搜索词（否则模型以为多段词被完整搜索了）', () => {
        expect(mainSrc).toContain('const used = compactBingQuery(query);');
        expect(mainSrc).toContain('修饰词会被搜索引擎忽略');
        expect(mainSrc).toContain('import { BING_SEARCH_UA, bingResultsToText, buildBingRssUrl, compactBingQuery, parseBingRss }');
    });

    it('⛔ 反向守卫：不许退回「原样把多段查询塞进 URL」', () => {
        expect(mainSrc).not.toContain("buildBingRssUrl(query) + '&'");
        expect(mainSrc).not.toMatch(/const q = encodeURIComponent\(String\(query \?\? ''\)\.trim\(\)\);/);
    });

    // 🔴 m17001：提示词按通道分流查询词口径 ⇒ 工具结果必须自报通道，模型才知道该用哪种拼法。
    //    这两条标记是**契约**（`pure/aiPrefill.ts` 的提示词里逐字引用了它们），⛔ 别改名。
    it('🔴 原生通道的结果里标了「平台原生检索」', () => {
        expect(mainSrc).toContain('${aiSearchLabel(provider)} · 平台原生检索');
    });

    it('🔴 必应回落通道的结果里标了「回落通道」（恒有，不依赖查询是否被截断）', () => {
        expect(mainSrc).toContain('（来源：必应 RSS · 回落通道）');
    });
});

describe('② compactBingQuery 的行为契约（防回潮）', () => {
    it('中文多段 ⇒ 首段；英文短语 ⇒ 原样', () => {
        expect(compactBingQuery('七里香 周杰伦 简介')).toBe('七里香');
        expect(compactBingQuery('The Lord of the Rings')).toBe('The Lord of the Rings');
    });

    it('⛔ 不做「去空格拼接」（实测 `三体刘慈欣` 同样退化）', () => {
        expect(compactBingQuery('三体 刘慈欣')).not.toBe('三体刘慈欣');
        expect(compactBingQuery('三体 刘慈欣')).toBe('三体');
    });
});
