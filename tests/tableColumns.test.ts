import { describe, it, expect } from 'vitest';
import { ENTRY_TYPES, type EntryType, type MediaEntry } from 'data/types';
import type { SeriesGroup } from 'pure/seriesGroup';
import {
    DEFAULT_TABLE_COLUMNS_BY_TYPE, TABLE_COLUMN_DEFAULTS_BY_TYPE, TABLE_COLUMN_EXCLUDED,
    TABLE_COLUMN_LIMIT, TABLE_VIRTUAL_COLUMNS, columnAppliesTo, normalizeTableColumnsForType,
    resolveTableColumnsByType, seriesCellText, tableColumnDefsFor, tableColumnPoolFor, tableColumnsForTypes,
} from 'pure/tableColumns';
import { hasTableCellBinding } from 'pure/tableCell';
import { findMetaField } from 'pure/metaFields';

const keysOf = (t: EntryType): string[] => tableColumnPoolFor(t).map((c) => c.key);

describe('tableColumns 池子（#621 表格视图可选的列）', () => {
    it('🔴 每类的池子都不含排除键（首列已承担的 title、内部标识 id/type、图片 banner、派生值 progress_percent）', () => {
        for (const t of ENTRY_TYPES) {
            const keys = keysOf(t);
            for (const k of TABLE_COLUMN_EXCLUDED) {
                expect(keys, `${t} 的池子里不该有 ${k}`).not.toContain(k);
            }
        }
    });

    it('🔴🔴 #621 池子里的**每个元数据键都可读**（只写不读的字段当列 = 「填了没反应」且不报错）', () => {
        const bad: string[] = [];
        for (const t of ENTRY_TYPES) {
            for (const c of tableColumnPoolFor(t)) {
                if (c.kind === 'readonly') continue; // 虚拟列不是 frontmatter 字段，不适用这条
                if (findMetaField(c.key)?.readable !== true) bad.push(`${t}:${c.key}`);
            }
        }
        expect(bad, `这些键读侧解析不回来，放进列池就是「填了没反应」：${bad.join(', ')}`).toEqual([]);
    });

    it('🔴🔴 池子里的**每个可编辑键都有单元格绑定**（少一条 ⇒ 那一列点开就写不回去）', () => {
        const bad: string[] = [];
        for (const t of ENTRY_TYPES) {
            for (const c of tableColumnPoolFor(t)) {
                if (c.editable && !hasTableCellBinding(c.key)) bad.push(`${t}:${c.key}`);
            }
        }
        expect(bad, `这些列在 pure/tableCell 里没有读写绑定：${bad.join(', ')}`).toEqual([]);
    });

    it('🔴 虚拟列：`__` 前缀 + 不可编辑 + 每类都在池子里（原列表视图那两列不许消失）', () => {
        expect(TABLE_VIRTUAL_COLUMNS.length).toBeGreaterThan(0);
        for (const v of TABLE_VIRTUAL_COLUMNS) {
            expect(v.key.startsWith('__'), v.key).toBe(true);
            expect(v.editable).toBe(false);
            for (const t of ENTRY_TYPES) expect(keysOf(t), `${t} 缺虚拟列 ${v.key}`).toContain(v.key);
        }
        expect(TABLE_VIRTUAL_COLUMNS.map((v) => v.key)).toContain('__community');
        expect(TABLE_VIRTUAL_COLUMNS.map((v) => v.key)).toContain('__progress');
    });

    it('类型专属字段只出现在对应类型（album 只音乐 / reading_page 只书籍 / playtime_minutes 只游戏）', () => {
        expect(keysOf('music')).toContain('album');
        expect(keysOf('movie')).not.toContain('album');
        expect(keysOf('book')).toContain('reading_page');
        expect(keysOf('game')).not.toContain('reading_page');
        expect(keysOf('game')).toContain('playtime_minutes');
        expect(keysOf('book')).not.toContain('playtime_minutes');
        expect(keysOf('tv')).toContain('progress_episode');
        expect(keysOf('movie')).not.toContain('progress_episode');
    });

    it('池子非空 ⇒ 每类都有东西可选（⛔ 别出现「这个类型一列都配不了」）', () => {
        for (const t of ENTRY_TYPES) expect(keysOf(t).length, t).toBeGreaterThan(0);
    });

    it('🔴 每类的**缺省列**都落在它自己的池子里（⛔ 别预置一个它选不到的列 —— 那会静默消失）', () => {
        for (const t of ENTRY_TYPES) {
            const keys = keysOf(t);
            for (const k of TABLE_COLUMN_DEFAULTS_BY_TYPE[t]) {
                expect(keys, `${t} 的缺省列 ${k} 不在池子里`).toContain(k);
            }
        }
    });

    it('🔴 缺省列先放**原列表视图那四列**（年份 / 状态 / 大众评分 / 个人评分）⇒ 升级不丢信息', () => {
        for (const t of ENTRY_TYPES) {
            expect(TABLE_COLUMN_DEFAULTS_BY_TYPE[t].slice(0, 4), t).toEqual([
                'year', 'status', '__community', 'rating',
            ]);
        }
    });

    it('columnAppliesTo：虚拟列恒适用；元数据键按类型的池子判', () => {
        expect(columnAppliesTo('__community', 'game')).toBe(true);
        expect(columnAppliesTo('album', 'music')).toBe(true);
        expect(columnAppliesTo('album', 'movie')).toBe(false);
        expect(columnAppliesTo('bogus', 'movie')).toBe(false);
    });
});

describe('🔴 #621 normalizeTableColumnsForType', () => {
    it('🔴🔴 **保留用户顺序**（⛔ 不按池子重排 —— 这一点与信息栏 `normalizeCardFieldsForType` 故意相反）', () => {
        // 池子里 `year` 在 `status` 之前，但用户把它们拖成相反顺序 ⇒ 必须原样保留
        expect(normalizeTableColumnsForType('movie', ['rating', 'status', 'year'])).toEqual(['rating', 'status', 'year']);
        expect(normalizeTableColumnsForType('movie', ['genres', 'year'])).toEqual(['genres', 'year']);
    });

    it('丢未知键 / 丢重复（去重保首次出现的位置）/ 丢不该当列的键', () => {
        expect(normalizeTableColumnsForType('movie', ['year', 'bogus', 'year'])).toEqual(['year']);
        expect(normalizeTableColumnsForType('movie', ['title', 'id', 'banner', 'progress_percent'])).toEqual([]);
        expect(normalizeTableColumnsForType('movie', ['rating', 'rating', 'year'])).toEqual(['rating', 'year']);
    });

    it('🔴 跨类型复用同一份值 ⇒ 不适用的键被丢（把书籍那套挂到游戏上不会冒出 reading_page）', () => {
        expect(normalizeTableColumnsForType('game', ['reading_page', 'year'])).toEqual(['year']);
    });

    it('非数组 ⇒ 用**该类型自己的**缺省（⛔ 不是影视那一组）', () => {
        for (const bad of [undefined, null, 'year', 42]) {
            expect(normalizeTableColumnsForType('book', bad), String(bad)).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.book]);
            expect(normalizeTableColumnsForType('game', bad), String(bad)).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.game]);
        }
    });

    it('🔴 空数组 = 「一列自定义列都不要」的合法值（只剩笔记名 + 操作），⛔ 不许被缺省吃掉', () => {
        expect(normalizeTableColumnsForType('movie', [])).toEqual([]);
    });

    it('截断到上限（按**用户顺序**取前 N，⛔ 不是按池子顺序）', () => {
        const all = keysOf('movie');
        expect(all.length).toBeGreaterThan(TABLE_COLUMN_LIMIT);
        const reversed = [...all].reverse();
        const out = normalizeTableColumnsForType('movie', reversed);
        expect(out).toHaveLength(TABLE_COLUMN_LIMIT);
        expect(out).toEqual(reversed.slice(0, TABLE_COLUMN_LIMIT));
    });

    it('六类至少有两类的缺省不同（否则「按类型」就是空话）', () => {
        const uniq = new Set(ENTRY_TYPES.map((t) => TABLE_COLUMN_DEFAULTS_BY_TYPE[t].join(',')));
        expect(uniq.size).toBeGreaterThan(1);
    });
});

describe('🔴 #621 resolveTableColumnsByType（六键齐全）', () => {
    it('六键齐全，缺的走该类型缺省（⛔ 不留 undefined）', () => {
        const r = resolveTableColumnsByType(undefined);
        expect(Object.keys(r).sort()).toEqual([...ENTRY_TYPES].sort());
        for (const t of ENTRY_TYPES) expect(r[t], t).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE[t]]);
    });

    it('只写了一类 ⇒ 那一类用新值、其余五类用**各自的缺省**', () => {
        const r = resolveTableColumnsByType({ book: ['author', 'translator'] });
        expect(r.book).toEqual(['author', 'translator']);
        expect(r.movie).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.movie]);
        expect(r.game).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.game]);
    });

    it('空数组仍是合法值；非对象的新键（手改 data.json 成字符串）不炸', () => {
        expect(resolveTableColumnsByType({ movie: [] }).movie).toEqual([]);
        const r = resolveTableColumnsByType('nope');
        for (const t of ENTRY_TYPES) expect(r[t], t).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE[t]]);
    });

    it('DEFAULT_TABLE_COLUMNS_BY_TYPE 与 resolve 的结果一致（缺省真源自洽，⛔ 别各算一份）', () => {
        const r = resolveTableColumnsByType(undefined);
        for (const t of ENTRY_TYPES) expect(DEFAULT_TABLE_COLUMNS_BY_TYPE[t], t).toEqual(r[t]);
    });
});

describe('🔴 #621 tableColumnsForTypes（混类型表的并集）', () => {
    const resolved = resolveTableColumnsByType(undefined);

    it('🔴 单类型 = 它自己的配置（⛔ 别多出别的类型的列）', () => {
        expect(tableColumnsForTypes(['movie'], resolved)).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.movie]);
    });

    it('🔴 多类型 = 并集，顺序按**传入类型的先后**追加（首次出现的键定位置）', () => {
        const out = tableColumnsForTypes(['movie', 'book'], resolved);
        expect(out.slice(0, TABLE_COLUMN_DEFAULTS_BY_TYPE.movie.length)).toEqual([...TABLE_COLUMN_DEFAULTS_BY_TYPE.movie]);
        // 书籍独有的那列（author）落在电影那组之后
        expect(out).toContain('author');
        expect(out.indexOf('author')).toBeGreaterThanOrEqual(TABLE_COLUMN_DEFAULTS_BY_TYPE.movie.length);
    });

    it('🔴 并集去重（两类共有的 year/status/rating 只出现一次）', () => {
        const out = tableColumnsForTypes(['movie', 'book', 'game', 'music'], resolved);
        expect(new Set(out).size).toBe(out.length);
    });

    it('🔴 与传入顺序无关的内容同一性：结果只取决于「有哪些类型」，⛔ 不取决于筛选结果的顺序', () => {
        const a = tableColumnsForTypes(['movie', 'book'], resolved);
        const b = tableColumnsForTypes(['movie', 'book'], resolved);
        expect(a).toEqual(b);
    });

    it('空类型列表 ⇒ 空列（调用方自己决定兜底，⛔ 别在这里偷偷塞一组）', () => {
        expect(tableColumnsForTypes([], resolved)).toEqual([]);
    });

    it('🔴 并集也要**截断到上限**（六类并起来 35 条，裁在纯函数里、⛔ 别让调用点各裁一次）', () => {
        const fat = {} as Record<EntryType, string[]>;
        // 🔴 fixture 必须用**全池**：每类池子的**前 12 个**键在六类里几乎完全重合
        //    （本批实测 raw union = 12）⇒ 用前 12 当输入，截断与否**看不出差别**，判据是空转的。
        for (const t of ENTRY_TYPES) fat[t] = tableColumnPoolFor(t).map((c) => c.key);
        expect(tableColumnsForTypes([...ENTRY_TYPES], fat), '全池并集应远大于上限').toHaveLength(TABLE_COLUMN_LIMIT);
        expect(Object.values(fat).flat().length).toBeGreaterThan(TABLE_COLUMN_LIMIT * 2);
    });
});

describe('🔴 #621 tableColumnDefsFor（列键 → 列描述）', () => {
    it('跨类型的键都能解析出 label/kind（混类型表要按任一类型的池子找）', () => {
        const defs = tableColumnDefsFor(['author', 'album', '__community'], ['book', 'music']);
        expect(defs[0].label).toBe('作者');
        expect(defs[1].label).toBe('专辑');
        expect(defs[2].label).toBe('大众评分');
        expect(defs[0].editable).toBe(true);
        expect(defs[2].editable).toBe(false);
    });

    it('🔴 认不出的脏键 ⇒ 兜一个**只读**列，⛔ 不丢列（丢列会让表头与各行 colspan 对不上）', () => {
        const defs = tableColumnDefsFor(['bogus'], ['movie']);
        expect(defs).toHaveLength(1);
        expect(defs[0].editable).toBe(false);
        expect(defs[0].label).toBe('bogus');
    });
});

describe('🔴 #621 seriesCellText（系列折叠行在哪列显示什么）', () => {
    const mk = (p: Partial<MediaEntry>): MediaEntry => ({
        id: 'x', type: 'movie', title: 't', status: 'watched', rating: 0, genres: [], cast: [],
        ...p,
    } as MediaEntry);
    const group = (items: MediaEntry[]): SeriesGroup => ({
        key: 'movie\u0001s', type: 'movie', name: 's', title: 's', items,
    });

    it('年份取**区间**（不是某一片的值）', () => {
        expect(seriesCellText(group([mk({ year: 2001 }), mk({ year: 2003 })]), 'year')).toBe('2001–2003');
        expect(seriesCellText(group([mk({ year: 2001 })]), 'year')).toBe('2001');
    });

    it('题材取整组去重合并；状态取整组的口径（未看完优先）', () => {
        const g = group([mk({ genres: ['科幻'] }), mk({ genres: ['科幻', '灾难'] })]);
        expect(seriesCellText(g, 'genres')).toBe('科幻 · 灾难');
        expect(seriesCellText(group([mk({ status: 'watched' }), mk({ status: 'watching' })]), 'status')).toBe('watching');
    });

    it('🔴 不能聚合的列一律空串（⛔ 别拿组内第一部的值冒充整组）', () => {
        const g = group([mk({ rating: 5 }), mk({ rating: 1 })]);
        for (const k of ['rating', 'director', 'duration_min', '__community', '__progress', 'bogus']) {
            expect(seriesCellText(g, k), k).toBe('');
        }
    });
});
