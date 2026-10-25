// 元数据源 / 音乐平台图标表（pure/sourceIcons，#488 建立）。
// 这里守的是「设置页凭据行加图标之后」最容易静默出错的几件事：
//   ① 源增减时图标表漏改（漏 → 运行时 undefined → `renderAiIcon` 拿到 undefined 直接抛，或整行空白）
//   ② 内置图标名写错（`setIcon` 遇未知名**静默失败** → 空白图标，零报错）
//   ③ 拿别家品牌标顶替没有 logo 的源（观感上「冒充」，本仓既定纪律）
//   ④ 品牌标被误抽成空路径（生成器抽错段落 ⇒ 画出来是个空 SVG）
import { describe, expect, it } from 'vitest';
import { SOURCE_ICON, MUSIC_COOKIE_ICON, type SourceIcon } from 'pure/sourceIcons';

/**
 * 🔴 已用 `node _probe_lucide.cjs <name>` 在 Obsidian 的 `app.js` 图标表里**实测存在**的名字。
 *    写错的名字会被 `setIcon` 静默吞掉（留一个空白 span）——所以这里是**正向白名单**，⛔ 别凭推测扩。
 */
const KNOWN_BUILTIN_ICONS = new Set(['film', 'tv', 'clapperboard', 'book-marked', 'book-open', 'music', 'disc-3']);

/** 🔴 刻意**不许**挂别家品牌标顶替的源（本表建成时 Simple Icons 未收录它们） */
const MUST_STAY_BUILTIN_SOURCE = ['tmdb', 'bangumi', 'omdb', 'googleBooks', 'weread'] as const;
const MUST_STAY_BUILTIN_MUSIC = ['qq', 'kugou'] as const;

const isBrand = (i: SourceIcon): i is Extract<SourceIcon, { kind: 'brand' }> => i.kind === 'brand';

describe('pure/sourceIcons 元数据源图标表', () => {
    it('与设置页「需 Key 源」同一批（**八个**，一个不多一个不少）', () => {
        // 🔴🔴 #640（1.4.0）翻面：7 → 8，补 **steam** ——
        //    #639 给 Steam 挂了 `keyField: steamApiKey`（搜索免 Key、同步库/愿望单要 Key），
        //    但 `KEY_SOURCE_ORDER` 与 `KeySourceId` 都还把它当「免 Key 源」⇒ 设置页凭据行**压根没渲染**
        //    （用户上手第一句：「没有显示啊」）。
        //    ⚠️ 这条判据就是**那个 bug 的哨兵**：源表与定序表必须同一批，少一个就红。
        expect(Object.keys(SOURCE_ICON).sort()).toEqual([
            'bangumi', 'douban', 'googleBooks', 'igdb', 'omdb', 'steam', 'tmdb', 'weread',
        ]);
    });

    it('音乐平台与设置页 Cookie 行同一批（三行：网易云 / QQ / 酷狗）', () => {
        expect(Object.keys(MUSIC_COOKIE_ICON).sort()).toEqual(['kugou', 'netease', 'qq']);
    });

    it('🔴 品牌标：24×24 视图框 + 真有路径数据（防生成器抽空 / 抽错段）', () => {
        // ⚠️ 表的**键**是我们自己的 id、`slug` 是 simple-icons 的标名 —— 两者不总同名时按 `[key, slug]` 成对钉。
        const pairs: [SourceIcon, string][] = [
            [SOURCE_ICON.douban, 'douban'],
            [SOURCE_ICON.igdb, 'igdb'],
            // 🔴 #640：Steam 品牌标（与 `pure/searchIcons` 那张**同源同值**，来自 simple-icons v16）
            [SOURCE_ICON.steam, 'steam'],
            [MUSIC_COOKIE_ICON.netease, 'neteasecloudmusic'],
        ];
        for (const [icon, slug] of pairs) {
            expect(icon.kind).toBe('brand');
            if (!isBrand(icon)) continue;
            expect(icon.slug).toBe(slug);
            expect(icon.viewBox).toBe('0 0 24 24');
            expect(icon.d).toMatch(/^M[\d.\s-]/);
            expect(icon.d.length).toBeGreaterThan(100);
        }
    });

    it('🔴 未被 Simple Icons 收录的一律走内置标 —— ⛔ 不许拿别家品牌标顶替（OMDb ≠ IMDb）', () => {
        for (const k of MUST_STAY_BUILTIN_SOURCE) expect(SOURCE_ICON[k].kind).toBe('builtin');
        for (const k of MUST_STAY_BUILTIN_MUSIC) expect(MUSIC_COOKIE_ICON[k].kind).toBe('builtin');
    });

    it('内置图标名全部在**实测白名单**内（写错的名字会被 setIcon 静默吞掉）', () => {
        const all = [...Object.values(SOURCE_ICON), ...Object.values(MUSIC_COOKIE_ICON)];
        for (const icon of all) {
            if (icon.kind !== 'builtin') continue;
            expect(KNOWN_BUILTIN_ICONS.has(icon.id)).toBe(true);
        }
    });

    it('每一档都有图标（判别联合的两个分支都能被渲染端接住）', () => {
        for (const icon of [...Object.values(SOURCE_ICON), ...Object.values(MUSIC_COOKIE_ICON)]) {
            expect(icon.kind === 'brand' ? icon.d.length > 0 : icon.id.length > 0).toBe(true);
        }
    });
});
