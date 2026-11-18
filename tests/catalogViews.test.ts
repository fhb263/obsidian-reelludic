/**
 * `views`（分类视图）在 catalog 里的**往返**单测（用户 2026-11-23 裁定「视图存进媒体库」）。
 *
 * 🔴 钉三件事：
 *   ① 写了能读回来 —— 但真正的杀手是 `CatalogStore.load()`：它**重建** `out` 对象，
 *      顶层字段漏搬一个就等于「保存成功、重启全丢」。本仓已踩过 `seriesRatings`（见下方回归用例）。
 *   ② 只剩默认视图时**不写键**（⛔ 别给每个存量文件凭空添 `"views": [...]`）。
 *   ③ 脏数据读进来不炸、不把文件读废。
 */
import { describe, expect, it } from 'vitest';
import { CatalogStore, parseCatalog, serializeCatalog, type VaultIO } from '../src/data/catalog';
import type { Catalog } from '../src/data/types';
import { COLLECTION_VIEW_ID, COLLECTION_VIEW_NAME, DEFAULT_VIEW_ID, DEFAULT_VIEW_NAME, normalizeViews, viewIsVisible } from '../src/pure/mediaViews';

/** 内存版 VaultIO（只为这条往返链服务） */
function memIO(initial: string | null = null): VaultIO & { text: string | null } {
    const io = {
        text: initial,
        async readText() {
            if (io.text === null) throw new Error('ENOENT');
            return io.text;
        },
        async writeText(_p: string, content: string) {
            io.text = content;
        },
        async deleteFile() {
            io.text = null;
        },
    };
    return io;
}

const WORK_VIEW = { id: 'v_1', name: '工作', kind: 'custom' as const, types: ['movie' as const], tags: ['工作'] };

describe('views 往返', () => {
    it('🔴 存进去能读回来（读侧 + 写侧都接了，⛔ 别只加读侧）', () => {
        const cat: Catalog = { version: 1, entries: [], views: [normalizeViews([WORK_VIEW])[0], WORK_VIEW] };
        const text = serializeCatalog(cat);
        expect(text).toContain('views');
        const back = parseCatalog(text);
        const views = normalizeViews(back.views);
        expect(views.map((v) => v.name)).toEqual([DEFAULT_VIEW_NAME, COLLECTION_VIEW_NAME, '工作']);
    });

    it('🔴 只有内置视图（默认 + 合集）⇒ **不写键**（⛔ 别给存量文件凭空添一个空表）', () => {
        const text = serializeCatalog({ version: 1, entries: [], views: normalizeViews([]) });
        expect(text).not.toContain('views');
        expect(parseCatalog(text).views).toBeUndefined();
    });

    it('完全没这个字段的老 catalog ⇒ 读出不炸，归一后是内置两颗', () => {
        const back = parseCatalog(JSON.stringify({ version: 1, entries: [] }));
        expect(back.views).toBeUndefined();
        expect(normalizeViews(back.views)).toHaveLength(2);
        expect(normalizeViews(back.views)[0].id).toBe(DEFAULT_VIEW_ID);
        expect(normalizeViews(back.views)[1].id).toBe(COLLECTION_VIEW_ID);
    });

    it('非数组 / 脏数据 ⇒ 当没有（不抛错、不把文件读废）', () => {
        expect(parseCatalog(JSON.stringify({ version: 1, entries: [], views: 5 })).views).toBeUndefined();
        expect(parseCatalog(JSON.stringify({ version: 1, entries: [], views: 'x' })).views).toBeUndefined();
        const dirty = parseCatalog(
            JSON.stringify({ version: 1, entries: [], views: [{ id: 'v_1', name: 'ok', kind: 'custom', tags: ['a'] }, { id: 'v_2' }, 7] }),
        );
        expect(normalizeViews(dirty.views).map((v) => v.name)).toEqual([DEFAULT_VIEW_NAME, COLLECTION_VIEW_NAME, 'ok']);
    });

    // 🔴 2026-11-25 用户：「（可勾选隐藏）默认视图 [系统内置]」⇒ 内置视图**不可删但可藏**，
    //    且「被藏了」这个意图必须真的落盘 + 读得回来（否则勾完重开又冒出来 = 假功能）。
    describe('内置视图的 hidden（隐藏 ≠ 删除）', () => {
        it('只勾了「隐藏默认视图」⇒ 为它写一条存根，且读回来仍是隐藏', () => {
            const text = serializeCatalog({
                version: 1,
                entries: [],
                views: normalizeViews([{ id: DEFAULT_VIEW_ID, hidden: true }]),
            });
            // 存根只带 id + hidden 的语义：能读到 hidden 就够了，⛔ 不指望存根改名字/类型
            expect(text).toContain('"hidden": true');
            const back = normalizeViews(parseCatalog(text).views);
            expect(back.find((v) => v.id === DEFAULT_VIEW_ID)?.hidden).toBe(true);
            // 🔴 2026-11-14 起合集视图**出厂就隐藏** ⇒ 这里不能再要求它是 undefined，
            //    判据改成「它仍然是隐藏的」（出厂态没被这条存根带歪）。
            expect(viewIsVisible(back.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(false);
        });

        it('藏起来的是合集视图也一样能存住（两条内置都支持）', () => {
            const text = serializeCatalog({
                version: 1,
                entries: [],
                views: normalizeViews([{ id: COLLECTION_VIEW_ID, hidden: true }]),
            });
            const back = normalizeViews(parseCatalog(text).views);
            expect(back.find((v) => v.id === COLLECTION_VIEW_ID)?.hidden).toBe(true);
            // ⚠️ 名字/种类仍按常量重造 —— 存根里的占位值不会被当真
            expect(back.find((v) => v.id === COLLECTION_VIEW_ID)?.name).toBe(COLLECTION_VIEW_NAME);
        });

        it('🔴 勾回「显示」⇒ 合集视图**必须**留下一条 hidden:false 存根（出厂是隐藏的，这是一次真实的用户改动）', () => {
            // 出厂态：默认视图可见、合集视图隐藏（2026-11-14 用户裁定）。
            // 所以「把合集视图勾回来」= 与出厂不同 ⇒ 一定要落盘，否则重开又变回不勾。
            const text = serializeCatalog({
                version: 1,
                entries: [],
                views: normalizeViews([
                    { id: DEFAULT_VIEW_ID, hidden: false },
                    { id: COLLECTION_VIEW_ID, hidden: false },
                ]),
            });
            // 默认视图那条 hidden:false 与出厂相同 ⇒ 不写；合集视图那条是改动 ⇒ 要写
            expect(text).toContain('"hidden": false');
            const back = normalizeViews(parseCatalog(text).views);
            expect(viewIsVisible(back.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(true);
            // 且只写了合集视图一条（默认视图没被顺带写进去）
            expect(back.find((v) => v.id === DEFAULT_VIEW_ID)?.hidden).toBeUndefined();
        });

        it('老 catalog（没有 views 字段）读出来：默认视图可见、合集视图出厂隐藏', () => {
            const back = normalizeViews(parseCatalog(JSON.stringify({ version: 1, entries: [] })).views);
            expect(back).toHaveLength(2);
            // 🔴 2026-11-14 用户逐字：「分类视图，用户初始**仅勾选默认视图**，不再勾选合集视图」
            expect(viewIsVisible(back.find((v) => v.id === DEFAULT_VIEW_ID))).toBe(true);
            expect(viewIsVisible(back.find((v) => v.id === COLLECTION_VIEW_ID))).toBe(false);
        });
    });
});

describe('CatalogStore.load 顶层字段（🔴 回归：重建 out 时漏搬 = 保存了但读不回来）', () => {
    it('views 经过 store 存盘再读回仍在', async () => {
        const io = memIO();
        const store = new CatalogStore(io, 'catalog.json');
        await store.save({ version: 1, entries: [], views: normalizeViews([WORK_VIEW]) });
        const back = await store.load();
        expect(normalizeViews(back.views).map((v) => v.name)).toEqual([DEFAULT_VIEW_NAME, COLLECTION_VIEW_NAME, '工作']);
    });

    it('🔴 seriesRatings 经过 store 存盘再读回仍在（历史上就是在 load 里漏搬，合集分一存就没）', async () => {
        const io = memIO();
        const store = new CatalogStore(io, 'catalog.json');
        const KEY = 'movie\u0001周星驰';
        await store.save({ version: 1, entries: [], seriesRatings: { [KEY]: 4.5 } });
        const back = await store.load();
        expect(back.seriesRatings).toEqual({ [KEY]: 4.5 });
    });

    it('activityLog 与 entries 照旧读回（别为加新字段把老的搬丢了）', async () => {
        const io = memIO();
        const store = new CatalogStore(io, 'catalog.json');
        await store.save({ version: 1, entries: [], activityLog: [{ at: '2026-11-23T00:00:00.000Z', id: 'e1', status: 'watched' }] });
        const back = await store.load();
        expect(back.activityLog).toHaveLength(1);
        expect(back.entries).toEqual([]);
    });
});
