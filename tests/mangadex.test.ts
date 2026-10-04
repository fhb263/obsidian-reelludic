// MangaDex 漫画源纯逻辑测试（2026-09-30 接入：漫画源链第三源，用户裁定「接豆瓣、Bangumi、MangaDex」）。
//
// ⚠️ 本文件的 fixture 取自**真实响应**（2026-09-30 实测 `GET /manga?title=海贼王&includes[]=cover_art|author|artist`），
//    不是编的 —— 真实数据里三个坑正是这里要钉住的：
//    ① `attributes.title` 只有 `{'ja-ro': 'One Piece'}`（**没有 en 键**）⇒ 只认 en 会得到空标题；
//    ② 作者名在 `relationships[type=author].attributes.name`（要 `includes[]=author` 才带 attributes）；
//    ③ 封面文件名**自带扩展名**（实测是 `.png`），拼尺寸档时要**保留**它（见 coverUrl 的实测对比）。
import { describe, it, expect } from 'vitest';
import {
    buildSearchUrl,
    parseMangaDexResults,
    pickTitle,
    pickDescription,
    coverUrl,
    tagNames,
    toBookResult,
    parseChapterCount,
    MangaDexClient,
    MANGADEX_UA,
    MANGADEX_SEARCH_LIMIT,
} from 'services/mangadex';

/** 实测响应片段（One Piece；只保留本模块用到的字段） */
const REAL_RESPONSE = JSON.stringify({
    result: 'ok',
    response: 'entity',
    data: [
        {
            id: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
            type: 'manga',
            attributes: {
                title: { 'ja-ro': 'One Piece' },
                altTitles: [{ ja: 'ワンピース' }, { uk: 'Ван Піс' }],
                description: { en: 'From Viz: As a child, Monkey D. Luffy was inspired to become a pirate…' },
                year: 1997,
                status: 'ongoing',
                contentRating: 'suggestive',
                tags: [
                    { attributes: { name: { en: 'Award Winning' } } },
                    { attributes: { name: { en: 'Sci-Fi' } } },
                    { attributes: { name: { en: 'Monsters' } } },
                    { attributes: { name: { en: 'Adventure' } } },
                ],
            },
            relationships: [
                { type: 'author', id: 'b6045e2c-28f4-4ce0-b4dd-b14070f2f5ae', attributes: { name: 'Oda Eiichirou (尾田栄一郎)' } },
                { type: 'artist', id: 'b6045e2c-28f4-4ce0-b4dd-b14070f2f5ae', attributes: { name: 'Oda Eiichirou (尾田栄一郎)' } },
                { type: 'cover_art', id: '38383930-d836-4fd7-85f7-ecfebdea3e3c', attributes: { fileName: '2f4aca53-64c7-46ac-ae85-3bc9b3169890.png' } },
            ],
        },
        // 无标题的坏条目：必须被丢弃（否则结果栏里会出现一条认不出的空卡）
        { id: 'no-title', type: 'manga', attributes: { title: {} }, relationships: [] },
    ],
    limit: 20,
    offset: 0,
    total: 34,
});

describe('buildSearchUrl — 搜索 URL 构造', () => {
    it('标题 + 封面/作者/画师关系 + 内容分级过滤（safe/suggestive）', () => {
        const u = buildSearchUrl('海贼王');
        expect(u.startsWith('https://api.mangadex.org/manga?')).toBe(true);
        const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
        expect(q.getAll('includes[]')).toEqual(['cover_art', 'author', 'artist']);
        expect(q.getAll('contentRating[]')).toEqual(['safe', 'suggestive']);
        expect(q.get('title')).toBe('海贼王'); // URLSearchParams 已做百分号编码，解析回来仍是中文
        expect(q.get('limit')).toBe(String(MANGADEX_SEARCH_LIMIT));
    });

    it('🔴 显式排除 erotica / pornographic（本仓是通用媒体库，不做成人过滤开关）', () => {
        const u = buildSearchUrl('x');
        expect(u).not.toContain('erotica');
        expect(u).not.toContain('pornographic');
    });

    it('limit 可覆盖（分页/少条数调试用）', () => {
        expect(new URLSearchParams(buildSearchUrl('x', 5).split('?')[1]).get('limit')).toBe('5');
    });
});

describe('parseMangaDexResults — 响应解析', () => {
    it('真实响应 → 条目（id/attributes/relationships 都在）', () => {
        const rows = parseMangaDexResults(REAL_RESPONSE);
        expect(rows.length).toBe(2); // 含那条无标题的（丢弃发生在 toBookResult 之后，解析层不判标题）
        expect(rows[0].id).toBe('a1c7c817-4e59-43b7-9365-09675a149a6f');
        expect(rows[0].relationships.length).toBe(3);
    });

    it('坏 JSON / 缺 data / data 非数组 → 空数组（⛔ 不抛：搜索链路靠它静默降级）', () => {
        expect(parseMangaDexResults('<html>502</html>')).toEqual([]);
        expect(parseMangaDexResults('{}')).toEqual([]);
        expect(parseMangaDexResults('{"data":"nope"}')).toEqual([]);
    });

    it('缺 id 的条目被丢弃', () => {
        expect(parseMangaDexResults('{"data":[{"attributes":{}}]}')).toEqual([]);
    });
});

describe('pickTitle — 标题多语言回退（真实数据最高危的一处）', () => {
    it('🔴 只有 ja-ro 时取 ja-ro（真实响应就没有 en 键）', () => {
        expect(pickTitle({ 'ja-ro': 'One Piece' })).toBe('One Piece');
    });
    it('有 zh 时**优先中文**（本仓是中文库，与豆瓣/Bangumi 结果观感一致）', () => {
        expect(pickTitle({ en: 'Attack on Titan', zh: '进击的巨人', 'ja-ro': 'Shingeki no Kyojin' })).toBe('进击的巨人');
    });
    it('en 优先于 ja-ro / ja', () => {
        expect(pickTitle({ 'ja-ro': 'Kimetsu no Yaiba', en: 'Demon Slayer' })).toBe('Demon Slayer');
    });
    it('没有已知语言键时取第一个非空值', () => {
        expect(pickTitle({ ko: '원피스' })).toBe('원피스');
    });
    it('空对象 / 非对象 / 空白串 → 空字符串', () => {
        expect(pickTitle({})).toBe('');
        expect(pickTitle(undefined)).toBe('');
        expect(pickTitle('One Piece')).toBe('');
        expect(pickTitle({ en: '   ' })).toBe('');
    });
});

describe('pickDescription — 简介回退', () => {
    it('无 zh 时取 en（真实响应的 description 只有 en/es/ru/uk…）', () => {
        expect(pickDescription({ es: 'ES', en: 'EN text' })).toBe('EN text');
    });
    it('无可用语言 → undefined', () => {
        expect(pickDescription({})).toBeUndefined();
        expect(pickDescription(undefined)).toBeUndefined();
    });
});

describe('coverUrl — 封面直链', () => {
    it('🔴 保留 fileName 的**原扩展名**再拼尺寸档（实测：去扩展名 → 404；保留 → 200/182KB）', () => {
        expect(coverUrl('mid', '2f4aca53-64c7-46ac-ae85-3bc9b3169890.png'))
            .toBe('https://uploads.mangadex.org/covers/mid/2f4aca53-64c7-46ac-ae85-3bc9b3169890.png.512.jpg');
    });
    it('缺 id 或缺文件名 → undefined（UI 走占位封面，⛔ 不产出半截 URL）', () => {
        expect(coverUrl('', 'a.png')).toBeUndefined();
        expect(coverUrl('mid', undefined)).toBeUndefined();
    });
});

describe('tagNames — 标签', () => {
    it('取 en 名；只保留有名字的', () => {
        expect(tagNames([{ attributes: { name: { en: 'Award Winning' } } }, { attributes: {} }, { attributes: { name: { en: 'Sci-Fi' } } }]))
            .toEqual(['Award Winning', 'Sci-Fi']);
    });
    it('非数组 → 空', () => {
        expect(tagNames(undefined)).toEqual([]);
    });
});

describe('toBookResult — 映射成 BookSearchResult', () => {
    const item = parseMangaDexResults(REAL_RESPONSE)[0];

    it('字段完整：id / 标题 / 作者 / 年份 / 简介 / 题材(≤3) / 封面 / 来源', () => {
        const r = toBookResult(item);
        expect(r.id).toBe('a1c7c817-4e59-43b7-9365-09675a149a6f');
        expect(r.title).toBe('One Piece');
        expect(r.author).toBe('Oda Eiichirou (尾田栄一郎)');
        expect(r.year).toBe(1997);
        expect(r.description).toContain('Monkey D. Luffy');
        expect(r.genres).toEqual(['Award Winning', 'Sci-Fi', 'Monsters']); // 真实数据 4 个 → 截 3
        expect(r.thumbnail).toBe('https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2f4aca53-64c7-46ac-ae85-3bc9b3169890.png.512.jpg');
        expect(r.source).toBe('mangadex');
        expect(r.sourceUrl).toBe('https://mangadex.org/title/a1c7c817-4e59-43b7-9365-09675a149a6f');
    });

    it('author 缺失时回退 artist（MangaDex 把「原作 / 作画」分成两条关系）', () => {
        const only = parseMangaDexResults(JSON.stringify({
            data: [{ id: 'x', attributes: { title: { en: 'T' } }, relationships: [{ type: 'artist', attributes: { name: '画师' } }] }],
        }))[0];
        expect(toBookResult(only).author).toBe('画师');
    });

    it('🔴 #444g 画师：author 与 artist **不同人** ⇒ 两栏都填（漫画里原作与作画常是两个人）', () => {
        const item = parseMangaDexResults(JSON.stringify({
            data: [{
                id: 'x',
                attributes: { title: { en: 'T' } },
                relationships: [
                    { type: 'author', attributes: { name: '原作君' } },
                    { type: 'artist', attributes: { name: '作画君' } },
                ],
            }],
        }))[0];
        const r = toBookResult(item);
        expect(r.author).toBe('原作君');
        expect(r.artist).toBe('作画君');
    });

    it('🔴 #444g 同一人 ⇒ artist **留空**（实测 One Piece 的 author / artist 就是同一个人，⛔ 不让表单出现两格一样的值）', () => {
        const item = parseMangaDexResults(JSON.stringify({
            data: [{
                id: 'x',
                attributes: { title: { en: 'T' } },
                relationships: [
                    { type: 'author', attributes: { name: 'Oda Eiichirou (尾田栄一郎)' } },
                    { type: 'artist', attributes: { name: 'Oda Eiichirou (尾田栄一郎)' } },
                ],
            }],
        }))[0];
        const r = toBookResult(item);
        expect(r.author).toBe('Oda Eiichirou (尾田栄一郎)');
        expect(r.artist).toBeUndefined();
    });

    it('🔴 #445 总话数：`attributes.lastChapter` → `pageCount`（实测完结作有值：火影 700 / 进击的巨人 139）', () => {
        const item = parseMangaDexResults(JSON.stringify({
            data: [{ id: 'x', attributes: { title: { en: 'T' }, lastChapter: '700' } }],
        }))[0];
        expect(toBookResult(item).pageCount).toBe(700);
    });

    it('🔴 #445 总话数：连载中 `lastChapter=""` / 缺失 ⇒ `undefined`（⛔ 别给 0，会覆盖手填值还造出「话数 0」）', () => {
        const ongoing = parseMangaDexResults(JSON.stringify({
            data: [{ id: 'x', attributes: { title: { en: 'T' }, lastChapter: '' } }],
        }))[0];
        expect(toBookResult(ongoing).pageCount).toBeUndefined();
        const missing = parseMangaDexResults(JSON.stringify({
            data: [{ id: 'x', attributes: { title: { en: 'T' } } }],
        }))[0];
        expect(toBookResult(missing).pageCount).toBeUndefined();
    });
});

describe('parseChapterCount — 话数字符串解析（#445）', () => {
    it('数字字符串 / 数字 / 带单位 → 非负整数', () => {
        expect(parseChapterCount('700')).toBe(700);
        expect(parseChapterCount(139)).toBe(139);
        expect(parseChapterCount('139.7')).toBe(139);
    });
    it('空串 / 非数 / 负数 / NaN / undefined → undefined（⛔ 不给 0）', () => {
        expect(parseChapterCount('')).toBeUndefined();
        expect(parseChapterCount(undefined)).toBeUndefined();
        expect(parseChapterCount('abc')).toBeUndefined();
        expect(parseChapterCount('-3')).toBeUndefined();
        expect(parseChapterCount(Number.NaN)).toBeUndefined();
    });
});

describe('MangaDexClient — 注入 HTTP（可 mock）', () => {
    it('🔴 请求**带 MANGADEX_UA**（官方 Acceptable Usage Policy 要求可标识 UA）', async () => {
        const seen: Array<Record<string, string> | undefined> = [];
        const client = new MangaDexClient(async (_url, headers) => {
            seen.push(headers);
            return '{"data":[]}';
        });
        await client.search('x');
        expect(seen.length).toBe(1);
        expect(seen[0]?.['User-Agent']).toBe(MANGADEX_UA);
        expect(MANGADEX_UA).toContain('ReelLudic');
    });

    it('搜索 → 映射 + **丢掉无标题的结果**（那种条目在结果栏里认不出）', async () => {
        const client = new MangaDexClient(async () => REAL_RESPONSE);
        const out = await client.search('海贼王');
        expect(out.length).toBe(1); // 真实 fixture 里第 2 条无标题 ⇒ 被丢
        expect(out[0].title).toBe('One Piece');
    });

    it('HTTP 抛错向上冒泡（由 runAuxSource 捕获成 failed 状态，不阻断整组）', async () => {
        const client = new MangaDexClient(async () => {
            throw new Error('MangaDex 请求失败（HTTP 429）');
        });
        await expect(client.search('x')).rejects.toThrow('429');
    });
});
