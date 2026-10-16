// #635 ④ 评分看板纯逻辑测试：行序 / 六色阶 / 分类页签与计数 / 拖放落点 / 未评分比率。
import { describe, it, expect } from 'vitest';
import {
    BOARD_TABS,
    BOARD_TAB_LABELS,
    toneOf,
    entryInTab,
    tabCounts,
    boardRows,
    rowKeyOf,
    buildBoard,
    ratingForRow,
    dropHint,
    unratedRatio,
} from 'pure/ratingBoard';
import type { MediaEntry } from 'data/types';

/** 造一条最小可用条目（类型断言：测试里不必凑齐全部字段） */
function E(partial: Partial<MediaEntry> & { id: string; title: string }): MediaEntry {
    return { type: 'movie', status: 'watched', rating: 0, links: [], ...partial } as unknown as MediaEntry;
}

/** 造「脏评分」条目 —— `rating` 的类型是 `Rating`，故意塞非法值时必须走断言（与生产侧读脏数据同形） */
function EBad(id: string, title: string, rating: unknown): MediaEntry {
    return E({ id, title, rating: rating as MediaEntry['rating'] });
}

describe('#635 boardRows：行序与左侧星数', () => {
    it('从高到低 10 档（5 → 0.5）+ **最后**一行「未评分」= 共 11 行', () => {
        const rows = boardRows();
        expect(rows).toHaveLength(11);
        expect(rows.slice(0, 10).map((r) => r.rating)).toEqual([5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]);
        expect(rows[10].unrated).toBe(true);
        expect(rows[10].rating).toBe(0);
        // ⛔ 10 个评分行里不许混进 0（0 只做「未评分」行）
        expect(rows.filter((r) => r.rating === 0)).toHaveLength(1);
    });

    it('左侧主星数 / 半星数：整档 half=null、半档 half=5（拼成 `.5`）；「未评分」行 half=null', () => {
        const rows = boardRows();
        const by = (r: number) => rows.find((x) => x.rating === r)!;
        expect(by(5).whole).toBe(5);
        expect(by(5).half).toBeNull();
        expect(by(4.5).whole).toBe(4);
        expect(by(4.5).half).toBe(5);
        expect(by(0.5).whole).toBe(0);
        expect(by(0.5).half).toBe(5);
        expect(by(0).half).toBeNull();
    });

    it('每行初始 items 都是空数组（视图据此显示「暂无作品」）', () => {
        for (const r of boardRows()) expect(r.items).toEqual([]);
    });
});

describe('#635 toneOf：六色阶（用户给的分档**逐字**对应）', () => {
    it('顶级 5.0/4.5 → 金', () => {
        expect(toneOf(5)).toBe('gold');
        expect(toneOf(4.5)).toBe('gold');
    });
    it('高质 4.0/3.5 → 红', () => {
        expect(toneOf(4)).toBe('red');
        expect(toneOf(3.5)).toBe('red');
    });
    it('普通 3.0/2.5 → 紫', () => {
        expect(toneOf(3)).toBe('purple');
        expect(toneOf(2.5)).toBe('purple');
    });
    it('及格 2.0/1.5 → 蓝', () => {
        expect(toneOf(2)).toBe('blue');
        expect(toneOf(1.5)).toBe('blue');
    });
    it('低分 1.0/0.5 → 绿', () => {
        expect(toneOf(1)).toBe('green');
        expect(toneOf(0.5)).toBe('green');
    });
    it('🔴 0（未评分）→ **灰**（用户：「灰色留给空数据或未评分状态」）', () => {
        expect(toneOf(0)).toBe('gray');
    });
    it('🔴 每一档都有色，且**没有**红/紫/蓝/绿被跨档复用（六色阶互不串味）', () => {
        const all = boardRows().map((r) => r.tone);
        expect(all).toEqual(['gold', 'gold', 'red', 'red', 'purple', 'purple', 'blue', 'blue', 'green', 'green', 'gray']);
    });
});

describe('#635 分类页签：判据与计数', () => {
    it('九个页签、顺序固定、标签齐全', () => {
        expect(BOARD_TABS).toEqual(['all', 'book', 'novel', 'comic', 'anime', 'tv', 'movie', 'game', 'music']);
        for (const t of BOARD_TABS) expect(BOARD_TAB_LABELS[t]).toBeTruthy();
        expect(BOARD_TAB_LABELS.all).toBe('所有');
        expect(BOARD_TAB_LABELS.book).toBe('文学');
        expect(BOARD_TAB_LABELS.tv).toBe('剧集');
    });

    it('🔴 书籍三子类只看 `bookKind` —— 同名 `type="book"` 不会串到别的页签', () => {
        const book = E({ id: '1', title: '文学书', type: 'book', bookKind: 'book' });
        const novel = E({ id: '2', title: '网文', type: 'book', bookKind: 'novel' });
        const comic = E({ id: '3', title: '漫画', type: 'book', bookKind: 'comic' });
        expect(entryInTab(book, 'book')).toBe(true);
        expect(entryInTab(book, 'novel')).toBe(false);
        expect(entryInTab(book, 'comic')).toBe(false);
        expect(entryInTab(novel, 'novel')).toBe(true);
        expect(entryInTab(novel, 'book')).toBe(false);
        expect(entryInTab(comic, 'comic')).toBe(true);
        expect(entryInTab(comic, 'book')).toBe(false);
        // 三个子页签互相排斥
        for (const e of [book, novel, comic]) {
            expect([entryInTab(e, 'book'), entryInTab(e, 'novel'), entryInTab(e, 'comic')].filter(Boolean)).toHaveLength(1);
        }
    });

    it('🔴 **缺 `bookKind` 的老书籍按「文学」算** —— ⛔ 别让它从三个子页签里同时漏掉', () => {
        const legacy = E({ id: '9', title: '老书', type: 'book' });
        expect(entryInTab(legacy, 'book')).toBe(true);
        expect(entryInTab(legacy, 'novel')).toBe(false);
        expect(entryInTab(legacy, 'comic')).toBe(false);
    });

    it('🔴 三子页签之和 == 书籍总数（「所有」比子页签之和大 = 有条目谁也进不去 = 看着像丢数据）', () => {
        const list = [
            E({ id: '1', title: 'a', type: 'book', bookKind: 'book' }),
            E({ id: '2', title: 'b', type: 'book', bookKind: 'novel' }),
            E({ id: '3', title: 'c', type: 'book', bookKind: 'comic' }),
            E({ id: '4', title: 'd', type: 'book' }), // 缺 bookKind
        ];
        const c = tabCounts(list);
        expect(c.book + c.novel + c.comic).toBe(list.length);
    });

    it('非书籍类型按 `type` 直配（anime / tv / movie / game / music）；`all` = 全部', () => {
        const list = [
            E({ id: '1', title: 'a', type: 'anime' }),
            E({ id: '2', title: 'b', type: 'tv' }),
            E({ id: '3', title: 'c', type: 'movie' }),
            E({ id: '4', title: 'd', type: 'game' }),
            E({ id: '5', title: 'e', type: 'music' }),
        ];
        const c = tabCounts(list);
        expect(c.anime).toBe(1);
        expect(c.tv).toBe(1);
        expect(c.movie).toBe(1);
        expect(c.game).toBe(1);
        expect(c.music).toBe(1);
        expect(c.all).toBe(5);
    });
});

describe('#635 buildBoard：投影', () => {
    it('按归一后的评分落行；0 落「未评分」行', () => {
        const list = [
            E({ id: '1', title: '满分', rating: 5 }),
            E({ id: '2', title: '半星', rating: 0.5 }),
            E({ id: '3', title: '没打分', rating: 0 }),
            EBad('4', '脏值', 4.3), // 4.3 → 4.5（最近半档）
        ];
        const rows = buildBoard(list);
        const bucket = (r: number) => rows.find((x) => x.rating === r)!.items.map((x) => x.title);
        expect(bucket(5)).toEqual(['满分']);
        expect(bucket(0.5)).toEqual(['半星']);
        expect(bucket(4.5)).toEqual(['脏值']);
        expect(bucket(0)).toEqual(['没打分']);
    });

    it('🔴 `rowKeyOf` 走 `normalizeRating`（脏值归一到最近半档，⛔ 不是原样透传）', () => {
        expect(rowKeyOf(EBad('1', 'a', 4.3))).toBe(4.5);
        expect(rowKeyOf(EBad('2', 'b', 99))).toBe(5);
        expect(rowKeyOf(EBad('3', 'c', -3))).toBe(0);
        expect(rowKeyOf(EBad('4', 'd', '4'))).toBe(0); // 字符串不算数
    });

    it('同分按标题排序（`localeCompare zh`），且**不改动原数组**', () => {
        const list = [E({ id: '1', title: '丙', rating: 3 }), E({ id: '2', title: '甲', rating: 3 }), E({ id: '3', title: '乙', rating: 3 })];
        const before = list.map((e) => e.id);
        const rows = buildBoard(list);
        expect(rows.find((r) => r.rating === 3)!.items.map((x) => x.title)).toEqual(['丙', '乙', '甲'].sort((a, b) => a.localeCompare(b, 'zh')));
        expect(list.map((e) => e.id)).toEqual(before);
    });

    it('按页签过滤（只留该页签的条目）', () => {
        const list = [
            E({ id: '1', title: '电影', type: 'movie', rating: 5 }),
            E({ id: '2', title: '书', type: 'book', bookKind: 'book', rating: 5 }),
        ];
        expect(buildBoard(list, 'movie').find((r) => r.rating === 5)!.items.map((e) => e.title)).toEqual(['电影']);
        expect(buildBoard(list, 'all').find((r) => r.rating === 5)!.items).toHaveLength(2);
    });

    it('总条目数守恒：11 行的 items 之和 == 该页签下的条目数（⛔ 不许有条目凭空消失）', () => {
        const list = [
            E({ id: '1', title: 'a', rating: 5 }), E({ id: '2', title: 'b', rating: 4.5 }),
            E({ id: '3', title: 'c', rating: 0 }), E({ id: '4', title: 'd', rating: 3.5 }),
            E({ id: '5', title: 'e', rating: 1, type: 'game' }),
        ];
        const rows = buildBoard(list);
        expect(rows.reduce((n, r) => n + r.items.length, 0)).toBe(list.length);
        expect(rows.reduce((n, r) => n + r.items.length, 0)).toBe(buildBoard(list, 'all').reduce((n, r) => n + r.items.length, 0));
    });
});

describe('#635 拖放落点与提示', () => {
    it('🔴 落点 = 行评分；**「未评分」行 ⇒ 清除评分（0）**（⛔ 不是 undefined）', () => {
        const rows = boardRows();
        expect(ratingForRow(rows.find((r) => r.rating === 3)!)).toBe(3);
        expect(ratingForRow(rows.find((r) => r.rating === 4.5)!)).toBe(4.5);
        const unrated = rows.find((r) => r.unrated)!;
        expect(ratingForRow(unrated)).toBe(0);
        // ⛔ 类型上就必须是 Rating（弱化成 undefined 会让视图侧再判一次，两份口径必漂）
        for (const r of rows) expect(typeof ratingForRow(r)).toBe('number');
    });

    it('拖拽提示：整档说「3 星」、半档说「3.5 星」、**未评分行说「清除评分」**（⛔ 不是「评 0 星」）', () => {
        const rows = boardRows();
        const by = (r: number) => rows.find((x) => x.rating === r)!;
        expect(dropHint(by(3))).toContain('3 星');
        expect(dropHint(by(4.5))).toContain('4.5 星');
        expect(dropHint(by(0.5))).toContain('0.5 星');
        expect(dropHint(rows.find((r) => r.unrated)!)).toContain('清除评分');
        expect(dropHint(rows.find((r) => r.unrated)!)).not.toContain('0 星');
        // 带作品名时拼上「《…》」（拖拽中让用户确认拖的是哪一条）
        expect(dropHint(by(3), '沙丘')).toContain('《沙丘》');
    });
});

describe('#635 unratedRatio：未评分计数（规格里的「0/0 实时联动」）', () => {
    it('返回 `[未评分数, 该页签总数]`', () => {
        const list = [
            E({ id: '1', title: 'a', rating: 5 }),
            E({ id: '2', title: 'b', rating: 0 }),
            E({ id: '3', title: 'c', rating: 0 }),
        ];
        expect(unratedRatio(list)).toEqual([2, 3]);
    });

    it('按页签收窄（与看板同一套过滤判据）', () => {
        const list = [
            E({ id: '1', title: 'a', type: 'movie', rating: 0 }),
            E({ id: '2', title: 'b', type: 'book', bookKind: 'book', rating: 5 }),
        ];
        expect(unratedRatio(list, 'movie')).toEqual([1, 1]);
        expect(unratedRatio(list, 'book')).toEqual([0, 1]);
        expect(unratedRatio(list, 'all')).toEqual([1, 2]);
    });

    it('空库 ⇒ `[0, 0]`（视图据此显示「0 / 0」而不是 NaN）', () => {
        expect(unratedRatio([])).toEqual([0, 0]);
        expect(unratedRatio([], 'game')).toEqual([0, 0]);
    });
});
