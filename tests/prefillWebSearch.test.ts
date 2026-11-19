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

    it('🔴 教它查询词只写作品名（多段会被搜索引擎拆成单字）', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('查询词只写作品名本身');
        expect(DEFAULT_PREFILL_PROMPT).toContain('拆成单个字');
    });

    it('⛔ 反向守卫：不许再出现「作品名 + 简介/豆瓣」那种多段搜索词的教法', () => {
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('「作品名 + 作者/导演/开发商」');
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('作品名 简介');
        expect(DEFAULT_PREFILL_PROMPT).not.toContain('作品名 豆瓣');
    });

    it('简介那段仍然要求先搜后抓（提示词自洽，不留旧口径）', () => {
        expect(DEFAULT_PREFILL_PROMPT).toContain('先 `web_search` 找权威条目页、再 `fetch_page` 抓它的原文');
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
