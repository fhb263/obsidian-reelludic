import { describe, it, expect } from 'vitest';
import { ENTRY_TYPES, type MediaEntry } from 'data/types';
import { tableColumnPoolFor } from 'pure/tableColumns';
import {
    hasTableCellBinding, parseRatingCell, parseTableCellInput, tableCellCurrentPatch, tableCellDraft, tableCellText,
} from 'pure/tableCell';

/** 全字段有值的 fixture：`#621` 的往返测试靠它「每列都真能被读出来再写回去」 */
const entry = (over: Partial<MediaEntry> = {}): MediaEntry => ({
    id: 'e1', type: 'movie', title: '示例条目', status: 'watching', rating: 4.5,
    year: 2024, genres: ['科幻', '灾难'], director: '导演', cast: ['甲', '乙'], screenwriter: ['编剧'],
    country: '中国大陆', language: '汉语普通话', durationMin: 125, aliases: ['别名 A', '别名 B'],
    author: '作者', translator: '译者', publisher: '出版社', producer: '出品方',
    isbn: '978-7-0000-0000-0', binding: '平装', price: '59.00', series: '示例系列', seriesIndex: 2,
    platform: 'PC', developer: '开发商', album: '专辑',
    progress: { season: 2, episode: 12, totalEpisodes: 24, history: [] },
    watchedDate: '2026-01-02', plannedDate: '2026-02-03',
    readingProgress: { page: 30, totalPage: 300, percent: 10 },
    pageCount: 300, readMinutes: 90, playtimeMinutes: 600,
    ...over,
} as MediaEntry);

/** 池子里声明过的**全部可编辑键**（测试跟着池子走，⛔ 别手抄一份清单） */
const ALL_EDITABLE_KEYS = [...new Set(
    ENTRY_TYPES.flatMap((t) => tableColumnPoolFor(t).filter((c) => c.editable).map((c) => c.key)),
)];

describe('#621 tableCellText / tableCellDraft', () => {
    it('列表类字段用「, 」连接；数字原样；空值给空串（由调用方渲染 —）', () => {
        const e = entry();
        expect(tableCellText(e, 'genres')).toBe('科幻, 灾难');
        expect(tableCellText(e, 'duration_min')).toBe('125');
        expect(tableCellText(e, 'year')).toBe('2024');
        expect(tableCellText(e, 'author')).toBe('作者');
        expect(tableCellText(entry({ director: undefined }), 'director')).toBe('');
        expect(tableCellText(entry({ genres: [] }), 'genres')).toBe('');
    });

    it('🔴 未登记 / 虚拟列 ⇒ 空串（⛔ 别抛错：表里混着只读列是常态）', () => {
        expect(tableCellText(entry(), '__community')).toBe('');
        expect(tableCellText(entry(), 'bogus')).toBe('');
    });

    it('🔴 评分预填按 10 分制（`9/10`），未评分给空串 —— 与编辑表单那个输入框同口径', () => {
        expect(tableCellDraft(entry({ rating: 4.5 }), 'rating')).toBe('9/10');
        expect(tableCellDraft(entry({ rating: 5 }), 'rating')).toBe('10/10');
        expect(tableCellDraft(entry({ rating: 0 }), 'rating')).toBe('');
        // 其余字段的预填 = 显示文本
        expect(tableCellDraft(entry(), 'genres')).toBe(tableCellText(entry(), 'genres'));
    });
});

describe('🔴 #621 parseRatingCell（评分输入）', () => {
    it('带分母 ⇒ 按比例折算；不带分母 ≤5 ⇒ 按存储刻度；不带分母 6~10 ⇒ 按 10 分制', () => {
        expect(parseRatingCell('9/10')).toBe(4.5);
        expect(parseRatingCell('10/10')).toBe(5);
        expect(parseRatingCell('4.5/5')).toBe(4.5);
        expect(parseRatingCell('4.5')).toBe(4.5);
        expect(parseRatingCell('5')).toBe(5);
        // 🔴 「不带分母且 > 5」只可能是 10 分制（5 分制里不存在这个区间）⇒ 除以 2。
        //    ⛔ 别退回「钳到 5」那个旧口径 —— 用户敲 9 想要的是 4.5，钳成满分是静默改语义。
        expect(parseRatingCell('9')).toBe(4.5);
        expect(parseRatingCell('6')).toBe(3);
    });

    it('🔴 越界 / 解析不出来一律 `null`（⛔ 不是 0，也不是钳制）', () => {
        expect(parseRatingCell('13/10')).toBeNull();
        expect(parseRatingCell('13')).toBeNull();
        expect(parseRatingCell('9/0')).toBeNull();
        expect(parseRatingCell('')).toBeNull();
        expect(parseRatingCell('abc')).toBeNull();
        expect(parseRatingCell('9 分')).toBeNull();
        expect(parseRatingCell('4.5.5')).toBeNull();
    });
});

describe('🔴 #621 parseTableCellInput（按形态校验）', () => {
    it('清空 ⇒ 写 `undefined`（笔记里那个键会消失）', () => {
        for (const k of ['author', 'duration_min', 'genres', 'watched_date']) {
            const r = parseTableCellInput(entry(), k, '   ');
            expect(r.ok, k).toBe(true);
            if (r.ok) expect(Object.values(r.patch)[0], k).toBeUndefined();
        }
    });

    it('🔴 季 / 集**非空**：清空 = 回到 S1E0（与宿主「快捷关联」重建 progress 的缺省一致）', () => {
        const s = parseTableCellInput(entry(), 'progress_season', '');
        const ep = parseTableCellInput(entry(), 'progress_episode', '');
        expect(s.ok && s.patch.progress?.season).toBe(1);
        expect(ep.ok && ep.patch.progress?.episode).toBe(0);
    });

    it('数字列只认**非负整数**；年份再收紧到 4 位', () => {
        expect(parseTableCellInput(entry(), 'duration_min', '125').ok).toBe(true);
        expect(parseTableCellInput(entry(), 'series_index', '3').ok).toBe(true);
        expect(parseTableCellInput(entry(), 'series_index', '3.5').ok).toBe(false); // #443 起锁整数
        expect(parseTableCellInput(entry(), 'duration_min', '-1').ok).toBe(false);
        expect(parseTableCellInput(entry(), 'duration_min', 'abc').ok).toBe(false);
        expect(parseTableCellInput(entry(), 'year', '2024').ok).toBe(true);
        expect(parseTableCellInput(entry(), 'year', '26').ok).toBe(false);
    });

    it('🔴 非法输入给 `ok:false` + 一句人话原因（⛔ 别静默吞掉 —— 那是「我改了它自己变回去了」）', () => {
        const r = parseTableCellInput(entry(), 'rating', '13/10');
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
        expect(parseTableCellInput(entry(), 'status', 'nope').ok).toBe(false);
        expect(parseTableCellInput(entry(), 'watched_date', '2026/1/2').ok).toBe(false);
    });

    it('🔴 状态收**值**也收**中文标签**（界面上显示的是「在看」，⛔ 别逼用户记住 `watching`）', () => {
        const raw = parseTableCellInput(entry(), 'status', 'watched');
        expect(raw.ok && raw.patch.status).toBe('watched');
        const label = parseTableCellInput(entry(), 'status', '已看');
        expect(label.ok && label.patch.status).toBe('watched');
        expect(parseTableCellInput(entry(), 'status', '在追').ok).toBe(false);
        // 预填的是**标签**（与格子里显示的形态一致）
        expect(tableCellDraft(entry({ status: 'watching' }), 'status')).toBe('在看');
    });

    it('日期要 `YYYY-MM-DD`；列表按 `,`/`，` 拆并去空', () => {
        const d = parseTableCellInput(entry(), 'watched_date', '2026-10-13');
        expect(d.ok && d.patch.watchedDate).toBe('2026-10-13');
        const g = parseTableCellInput(entry(), 'genres', ' 科幻 ， 灾难 ,, 悬疑 ');
        expect(g.ok && g.patch.genres).toEqual(['科幻', '灾难', '悬疑']);
    });

    it('🔴 未登记键 / 虚拟列 ⇒ 明确拒绝（⛔ 别当成字符串写回去）', () => {
        expect(parseTableCellInput(entry(), '__community', 'x').ok).toBe(false);
        expect(parseTableCellInput(entry(), '__progress', 'x').ok).toBe(false);
        expect(parseTableCellInput(entry(), 'bogus', 'x').ok).toBe(false);
        expect(hasTableCellBinding('__community')).toBe(false);
        expect(hasTableCellBinding('bogus')).toBe(false);
    });
});

describe('🔴🔴 #621 嵌套字段必须整体重建（`update` 是浅合并 —— 漏了同级就静默丢数据）', () => {
    it('改「集」不动 season / history / totalEpisodes', () => {
        const r = parseTableCellInput(entry(), 'progress_episode', '5');
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.patch.progress).toMatchObject({ season: 2, episode: 5, totalEpisodes: 24, history: [] });
        }
    });

    it('改「已读页数」不动 totalPage / percent（percent 是阅读器的口径，⛔ 表格不许手改它）', () => {
        const r = parseTableCellInput(entry(), 'reading_page', '99');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.patch.readingProgress).toEqual({ page: 99, totalPage: 300, percent: 10 });
    });

    it('清空 readingProgress 的最后一个键 ⇒ 整个对象置 `undefined`（⛔ 别留一个空壳对象）', () => {
        const r = parseTableCellInput(entry({ readingProgress: { page: 5 } }), 'reading_page', '');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.patch.readingProgress).toBeUndefined();
    });

    it('🔴 没有 progress 的条目上填季 / 集 ⇒ 补齐缺省（⛔ 别写出 `{season: undefined}`）', () => {
        const r = parseTableCellInput(entry({ progress: undefined }), 'progress_episode', '3');
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.patch.progress).toMatchObject({ season: 1, episode: 3, history: [] });
    });
});

describe('🔴 #621 往返不变式（显示文本 → 解析 ⇒ 还是同一个值）', () => {
    it('池子里**每个可编辑列**都满足：读出来再写回去 = 原样（⛔ 少一列都说明读写两侧口径分叉了）', () => {
        const e = entry();
        expect(ALL_EDITABLE_KEYS.length).toBeGreaterThan(25);
        const broken: string[] = [];
        for (const key of ALL_EDITABLE_KEYS) {
            const text = tableCellText(e, key);
            const r = parseTableCellInput(e, key, text);
            if (!r.ok) { broken.push(`${key}（解析被拒：${r.reason}）`); continue; }
            const back = tableCellCurrentPatch({ ...e, ...r.patch } as MediaEntry, key);
            const after = tableCellText({ ...e, ...r.patch } as MediaEntry, key);
            if (after !== text) broken.push(`${key}（${text} → ${after}）`);
            if (!back) broken.push(`${key}（无绑定）`);
        }
        expect(broken, `这些列的显示文本与解析口径对不上：${broken.join('; ')}`).toEqual([]);
    });

    it('撤销用的 patch 走的是**同一个** rebuild（嵌套同级照样补齐）', () => {
        const p = tableCellCurrentPatch(entry(), 'progress_episode');
        expect(p?.progress).toMatchObject({ season: 2, episode: 12, totalEpisodes: 24 });
        expect(tableCellCurrentPatch(entry(), '__community')).toBeUndefined();
    });
});
