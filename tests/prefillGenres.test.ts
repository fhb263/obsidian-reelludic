/**
 * 🔴 m15796（用户 2026-11-19）：「这个也要搜索能该条目的题材、标签」。
 *
 * 这条测试守的是**装配链**，不是纯函数 —— 题材在四个地方会静默失联：
 *  1. `describeSearchResult` 不吐 `genres`（`SearchDisplay` 没有这个字段）
 *  2. 宿主 `lookup_metadata` 的回报文本不拼题材（模型在文本里看不见）
 *  3. 宿主 `fetch_page` 不抽题材（页面上有结构化 genre 却没人读）
 *  4. 服务层不收 `题材原文：` 标记（抽了也白抽）
 *
 * 每一环都用源码级判据钉住 —— 它们都不会在 `tsc` 或纯函数单测里报错。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PREFILL_GENRES_PREFIX,
    PREFILL_SYNOPSIS_PREFIX,
    extractToolGenres,
    preferToolGenres,
    prefillFieldsFor,
} from 'pure/aiPrefill';
import { describeSearchResult, type SearchResult } from 'pure/searchDisplay';

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** 剥掉 `//` 与 `/* *\/` 注释，避免判据被注释里的示例文字假绿 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('题材标记常量（两端共用一个真源）', () => {
    it('标记文本与简介标记必须是两个不同的串', () => {
        expect(PREFILL_GENRES_PREFIX).toBe('题材原文：');
        expect(PREFILL_GENRES_PREFIX).not.toBe(PREFILL_SYNOPSIS_PREFIX);
    });

    it('🔴 `PREFILL_GENRES_PREFIX` 必须声明在 `DEFAULT_PREFILL_PROMPT` 之前（TDZ）', () => {
        const src = read('src/pure/aiPrefill.ts');
        const decl = src.indexOf('export const PREFILL_GENRES_PREFIX');
        const prompt = src.indexOf('export const DEFAULT_PREFILL_PROMPT');
        expect(decl).toBeGreaterThan(0);
        expect(prompt).toBeGreaterThan(0);
        expect(decl).toBeLessThan(prompt);
    });
});

describe('extractToolGenres（消费端解析）', () => {
    it('抠出标记后的那一行，按 / 拆开', () => {
        const text = `命中 2 条：\n1. 三体 · 2008 · 豆瓣\n${PREFILL_GENRES_PREFIX}科幻 / 冒险`;
        expect(extractToolGenres(text)).toEqual(['科幻', '冒险']);
    });

    it('🔴 只取**一行** —— ⛔ 不许把后面的简介正文也拆成题材', () => {
        const text = `${PREFILL_GENRES_PREFIX}科幻\n\n${PREFILL_SYNOPSIS_PREFIX}文化大革命如火如荼进行的同时 / 军方探寻外星文明`;
        expect(extractToolGenres(text)).toEqual(['科幻']);
    });

    it('去重 + 折空白', () => {
        expect(extractToolGenres(`${PREFILL_GENRES_PREFIX}科幻  /  科幻/ 冒险 `)).toEqual(['科幻', '冒险']);
    });

    it('没有标记 / 标记后为空 ⇒ null', () => {
        expect(extractToolGenres('命中 1 条')).toBeNull();
        expect(extractToolGenres('')).toBeNull();
        expect(extractToolGenres(null)).toBeNull();
        expect(extractToolGenres(`${PREFILL_GENRES_PREFIX}   `)).toBeNull();
    });
});

describe('preferToolGenres（照搬裁决）', () => {
    const defs = prefillFieldsFor('book', 'novel');

    it('工具给了题材 ⇒ 覆盖模型写的那份', () => {
        const out = preferToolGenres({ genres: '小说', summary: 'x' }, ['科幻', '冒险'], defs);
        expect(out.genres).toBe('科幻 / 冒险');
        expect(out.summary).toBe('x');
    });

    it('🔴 工具没给题材 ⇒ **保留**模型写的那份（与简介方向相反）', () => {
        expect(preferToolGenres({ genres: '科幻' }, null, defs).genres).toBe('科幻');
        expect(preferToolGenres({ genres: '科幻' }, [], defs).genres).toBe('科幻');
    });

    it('该类型没有题材字段 ⇒ 原样返回（⛔ 不许给没有该字段的类型塞 genres 键）', () => {
        // ⚠️ 六种条目类型目前**都**有题材字段（音乐是「音乐风格」），所以这里用一个人为
        //    裁掉 genres 的定义表来测「没有该字段」这条分支 —— 不能拿 music 当反例。
        const noGenres = prefillFieldsFor('music').filter((d) => d.key !== 'genres');
        expect(noGenres.some((d) => d.key === 'genres')).toBe(false);
        expect(preferToolGenres({ album: 'x' }, ['流行'], noGenres)).toEqual({ album: 'x' });
    });

    it('去重 + 用 / 拼接', () => {
        expect(preferToolGenres({}, ['科幻', '科幻', '冒险'], defs).genres).toBe('科幻 / 冒险');
    });
});

describe('`describeSearchResult` 必须吐出 genres', () => {
    it('书籍源带题材 ⇒ 透出数组', () => {
        const rec = { source: 'googleBooks', title: '三体', author: '刘慈欣', genres: ['科幻', '小说'] };
        const d = describeSearchResult(rec as unknown as SearchResult);
        expect(d.genres).toEqual(['科幻', '小说']);
    });

    it('🔴 没题材 ⇒ `undefined`（⛔ 不是 `[]` —— 空数组会让提示词多出「题材：」半句）', () => {
        const d = describeSearchResult({ source: 'douban', title: '三体', author: '刘慈欣' } as unknown as SearchResult);
        expect(d.genres).toBeUndefined();
    });

    it('脏值（非字符串 / 空串 / 重复）被过滤干净', () => {
        const rec = { source: 'steam', title: 'Elden Ring', developer: 'FromSoftware', genres: ['动作', '', 42, '动作', ' 冒险 '] };
        expect(describeSearchResult(rec as unknown as SearchResult).genres).toEqual(['动作', '冒险']);
    });
});

describe('宿主接线（main.ts 两条工具分支）', () => {
    const raw = read('main.ts');
    const src = stripComments(raw);

    it('🔴 `lookup_metadata` 的回报行必须带题材（原先只拼年份/来源/评分/副标题）', () => {
        expect(src).toContain('d.genres?.length ? `题材：${d.genres.join(\' / \')}` : \'\'');
    });

    it('🔴 `lookup_metadata` 必须附「题材原文：」行，且只认同名命中', () => {
        // 断言的是**标识符**（`main.ts` 里不会出现「题材原文」字面量 —— 那在常量里）
        expect(src).toContain('${PREFILL_GENRES_PREFIX}${d.genres.join');
        // 只认同名（`titleTierOf(...) === 0 ⇒ continue`）
        expect(src).toContain('if (titleTierOf(d.title, title) === 0) continue;');
    });

    it('🔴🔴 顺序铁律：题材行必须排在简介**之前**（简介提取器取到串尾）', () => {
        // 反向守卫：⛔ 不许出现「简介在前、题材在后」的拼法
        expect(src).not.toMatch(/PREFILL_SYNOPSIS_PREFIX\}\$\{decision\.pick\.synopsis\}[\s\S]{0,120}?genresLine/);
        // 正向：同一模板串里 genresLine 在 PREFILL_SYNOPSIS_PREFIX 之前
        const m = /\$\{head\}\$\{genresLine \? `\\n\$\{genresLine\}` : ''\}\\n\\n\$\{PREFILL_SYNOPSIS_PREFIX\}/.test(src);
        expect(m).toBe(true);
    });

    it('🔴 `fetch_page` 必须抽页面题材', () => {
        expect(src).toContain('extractPageGenres(res.text)');
        expect(src).toContain('import { PAGE_TEXT_MAX, extractPageGenres, extractPageSynopsis, pageReadableText }');
    });

    it('🔴 页面没自证是这部作品时，题材与简介一起扣下（错页题材同样是脏数据）', () => {
        expect(src).toContain('const trusted =');
        expect(src).toMatch(/genresLine = trusted && pageGenres\.length/);
        // 反向守卫：⛔ 不许在 trusted 判定之前就无条件拼题材行
        expect(src).not.toMatch(/const genresLine = pageGenres\.length \?/);
    });
});

describe('服务层接线（消费端）', () => {
    const src = stripComments(read('src/services/aiPrefill.ts'));

    it('🔴 必须 import 并在工具结果里收题材', () => {
        expect(src).toContain('extractToolGenres');
        expect(src).toContain('preferToolGenres');
        expect(src).toContain('if (!toolGenres) toolGenres = extractToolGenres(text);');
    });

    it('🔴 两处收尾都必须走 `finalize`（⛔ 不许有一处只做简介）', () => {
        const hits = src.match(/return \{ fields: finalize\(fields \?\? \{\}\), sources \};/g) ?? [];
        expect(hits).toHaveLength(2);
        // 反向守卫：⛔ 不许再有裸 `preferToolSynopsis(` 出现在返回处
        expect(src).not.toMatch(/return \{ fields: preferToolSynopsis/);
    });

    it('🔴 只查到题材也算「有收获」（不许判失败）', () => {
        expect(src).toContain('if (fields || toolSynopsis || toolGenres)');
        expect(src).toContain('if (!fields && !toolSynopsis && !toolGenres)');
    });
});

describe('提示词与工具描述（模型得知道题材从哪来）', () => {
    it('🔴 默认提示词必须写明「题材原文：」照抄口径', () => {
        const src = read('src/pure/aiPrefill.ts');
        const prompt = src.slice(src.indexOf('export const DEFAULT_PREFILL_PROMPT'));
        expect(prompt).toContain('题材原文：');
        expect(prompt).toContain('照抄');
        // 明确禁止把载体当题材（实测模型爱写「小说 / 电影」）
        expect(prompt).toContain('载体');
    });

    it('🔴 两个工具的描述都要提到题材标记', () => {
        const src = stripComments(read('src/pure/aiPrefill.ts'));
        const toolsSrc = src.slice(src.indexOf('export function prefillTools'));
        const count = (toolsSrc.match(/PREFILL_GENRES_PREFIX/g) ?? []).length;
        expect(count).toBeGreaterThanOrEqual(2);
    });
});
