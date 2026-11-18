import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    ENTRY_FORM_FIELDS,
    ENTRY_FORM_FIXED_KEYS,
    ENTRY_FORM_LOCKED_KEYS,
    ENTRY_FORM_MAX_SPAN,
    ENTRY_FORM_SLOTS,
    ENTRY_FORM_SPAN_PRESETS,
    buildEntryFormPlan,
    clampEntryFormSpan,
    defaultEntryFormFieldsFor,
    entryFormFieldAppliesTo,
    entryFormFieldByKey,
    entryFormFieldHidden,
    entryFormFieldIsFixed,
    entryFormFieldSpan,
    entryFormFieldsFor,
    isDefaultEntryFormFields,
    normalizeEntryFormFields,
    sortEntryFormKeys,
    withFixedEntryFormFields,
    type EntryFormFieldLayout,
} from 'pure/entryFormFields';
import type { EntryType, BookKind } from 'data/types';

const ROOT = resolve(__dirname, '..');

/** 把布局数组收成键数组，方便与「模板书写顺序」逐项对账。 */
const keysOf = (list: ReadonlyArray<EntryFormFieldLayout>): string[] => list.map((e) => e.key);

/**
 * 🔴 模板书写顺序（`src/views/components/EntryForm.svelte` 里 `data-fld` 的出现顺序）。
 *
 * 这是本文件**唯一的对账真源**：`ENTRY_FORM_FIELDS` 的登记顺序必须与它一致，
 * 否则「没配过的用户」打开编辑窗口也会被 `applyFieldOrder` 重排 —— 那是静默改版。
 * 改模板时必须同步改这张表，改不动就说明登记顺序漂了。
 *
 * 🔴🔴 2026-11-15 用户 m05562（逐字）：「表单的标题框太长了，把上映年（首播年、发行年）和标题
 *   并排在中【顺序为：标题、上映年、评分来源等】、上映年原来位置由标签替代【顺序为：题材、标签】，
 *   然后把系列和系列序号框合并为一个宽度行不行，然后和合集并排【顺序为：系列&系列序号、合集】」
 * ⇒ 八行全部重排，三处结构性变化：
 *    · 年份键提到**最前**（title 自己的那圈 `.rl-title-col` 不在这张表里 —— 它是锁定键、没有
 *      `data-fld`，只靠 CSS 占 3 栅格），紧跟其后才是 `meta`；
 *    · `tags` 从「合集之后」提到**题材组末尾**，于是永远「题材、标签」并排；
 *    · `series-index` **彻底消失** —— 两框并进同一个 `data-fld="series"` 块，不再各自成项。
 */
const TEMPLATE_ORDER: Record<string, string[]> = {
    movie: [
        'year', 'meta', 'genres', 'tags', 'director', 'cast',
        'series', 'collection',
        'summary', 'ai-summary',
    ],
    tv: [
        'year', 'meta', 'genres', 'tags', 'director', 'cast',
        'total-episodes', 'episode',
        'series', 'collection',
        'summary', 'ai-summary',
    ],
    anime: [
        'year', 'meta', 'genres', 'tags', 'director', 'cast',
        'total-episodes', 'episode',
        'series', 'collection',
        'summary', 'ai-summary',
    ],
    game: [
        'year', 'meta', 'genres', 'tags', 'game-platform', 'game-developer',
        'series', 'collection',
        'summary', 'ai-summary', 'playtime',
    ],
    music: [
        'music-year', 'meta', 'music-genres', 'tags', 'music-author', 'music-album',
        'series', 'collection',
        'summary', 'lrc', 'ai-summary',
    ],
    'book:book': [
        'book-year', 'meta', 'book-genres', 'tags', 'book-publisher', 'book-author',
        'isbn', 'pages',
        'series', 'collection',
        'read-hours', 'summary', 'author-intro', 'toc', 'ai-summary', 'book-progress',
    ],
    'book:novel': [
        'novel-year', 'meta', 'novel-genres', 'tags', 'novel-author', 'novel-chapters',
        'series', 'collection',
        'read-hours', 'summary', 'author-intro', 'toc', 'ai-summary', 'book-progress',
    ],
    'book:comic': [
        'comic-year', 'meta', 'comic-genres', 'tags',
        'comic-publisher', 'comic-author', 'comic-artist', 'comic-chapters',
        'series', 'collection',
        'read-hours', 'summary', 'book-progress',
    ],
};

describe('ENTRY_FORM_SLOTS（八格类型格）', () => {
    it('共八格：前三影视、接着书籍三子类、最后游戏音乐', () => {
        expect(ENTRY_FORM_SLOTS.map((s) => s.key)).toEqual([
            'f:movie', 'f:tv', 'f:anime', 'k:book', 'k:novel', 'k:comic', 'f:game', 'f:music',
        ]);
    });

    it('只有书籍三格带 kind，且 type 恒为 book', () => {
        for (const slot of ENTRY_FORM_SLOTS) {
            if (slot.kind) {
                expect(slot.type).toBe('book');
                expect(['book', 'novel', 'comic']).toContain(slot.kind);
            } else {
                expect(slot.type).not.toBe('book');
            }
        }
    });

    it('书籍三子类原地展开，没被甩到末尾', () => {
        const keys = ENTRY_FORM_SLOTS.map((s) => s.key);
        const firstKind = keys.findIndex((k) => k.startsWith('k:'));
        expect(firstKind).toBe(3);
        expect(keys.slice(3, 6)).toEqual(['k:book', 'k:novel', 'k:comic']);
    });
});

describe('ENTRY_FORM_SPAN_PRESETS（宽度档位）', () => {
    it('四档且都是 6 的约数（6 / 3 / 2 / 1）', () => {
        // 🔴 m06404：新增 1/6 一档（年份块压成最窄，给右侧绝对定位的只读评分簇腾位置）。
        expect(ENTRY_FORM_SPAN_PRESETS.map((p) => p.span)).toEqual([6, 3, 2, 1]);
        for (const p of ENTRY_FORM_SPAN_PRESETS) {
            expect(ENTRY_FORM_MAX_SPAN % p.span).toBe(0);
        }
    });

    it('每档都有 label 与 hint', () => {
        for (const p of ENTRY_FORM_SPAN_PRESETS) {
            expect(p.label.length).toBeGreaterThan(0);
            expect(p.hint.length).toBeGreaterThan(0);
        }
    });

    it('clampEntryFormSpan：合法值原样、越界夹到 1..6、非数回落', () => {
        expect(clampEntryFormSpan(6)).toBe(6);
        expect(clampEntryFormSpan(3)).toBe(3);
        expect(clampEntryFormSpan(2)).toBe(2);
        // 4 不属四档预设，但仍在 1..6 栅格内 ⇒ 原样保留（配置里可能来自旧版本或手改 JSON）
        expect(clampEntryFormSpan(4)).toBe(4);
        expect(clampEntryFormSpan(1)).toBe(1);
        // 越界夹紧
        expect(clampEntryFormSpan(0)).toBe(1);
        expect(clampEntryFormSpan(-1)).toBe(1);
        expect(clampEntryFormSpan(9)).toBe(ENTRY_FORM_MAX_SPAN);
        // 非数回落
        expect(clampEntryFormSpan(NaN)).toBe(ENTRY_FORM_MAX_SPAN);
        expect(clampEntryFormSpan(undefined)).toBe(ENTRY_FORM_MAX_SPAN);
        expect(clampEntryFormSpan('3')).toBe(ENTRY_FORM_MAX_SPAN);
        // 自定义 fallback
        expect(clampEntryFormSpan(NaN, 3)).toBe(3);
    });
});

describe('ENTRY_FORM_FIELDS（字段登记表）', () => {
    it('键唯一', () => {
        const keys = ENTRY_FORM_FIELDS.map((d) => d.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('每项 label 非空、span 合法', () => {
        for (const d of ENTRY_FORM_FIELDS) {
            expect(d.label.length).toBeGreaterThan(0);
            expect([6, 3, 2, 1]).toContain(d.span);
        }
    });

    it('🔴 锁定键一律不在可管理字段里（藏了就真坏）', () => {
        const keys = new Set(ENTRY_FORM_FIELDS.map((d) => d.key));
        for (const locked of ENTRY_FORM_LOCKED_KEYS) {
            expect(keys.has(locked)).toBe(false);
        }
    });

    it('kinds 只标在 type === book 的项上', () => {
        for (const d of ENTRY_FORM_FIELDS) {
            if (d.kinds) expect(d.types).toEqual(['book']);
        }
    });

    it('长文本块一律整行（span 6）', () => {
        for (const key of ['summary', 'lrc', 'author-intro', 'toc', 'ai-summary', 'read-hours', 'playtime', 'book-progress', 'meta']) {
            expect(entryFormFieldByKey(key)?.span).toBe(6);
        }
    });
});

describe('entryFormFieldAppliesTo（适用判定）', () => {
    it('types 不匹配 ⇒ false', () => {
        const genres = entryFormFieldByKey('genres')!;
        expect(entryFormFieldAppliesTo(genres, 'movie')).toBe(true);
        expect(entryFormFieldAppliesTo(genres, 'book')).toBe(false);
        expect(entryFormFieldAppliesTo(genres, 'music')).toBe(false);
    });

    it('kinds 只对 book 生效，其它类型一律 false', () => {
        const artist = entryFormFieldByKey('comic-artist')!;
        expect(entryFormFieldAppliesTo(artist, 'book', 'comic')).toBe(true);
        // 模板里书三分支是 if/else-if/else **互斥** ⇒ 漫画专属字段在文学下必须不适用
        expect(entryFormFieldAppliesTo(artist, 'book', 'book')).toBe(false);
        expect(entryFormFieldAppliesTo(artist, 'book', 'novel')).toBe(false);
        expect(entryFormFieldAppliesTo(artist, 'movie', 'comic')).toBe(false);
    });

    it('kinds 存在但调用方没给 kind ⇒ 保守放行', () => {
        const artist = entryFormFieldByKey('comic-artist')!;
        expect(entryFormFieldAppliesTo(artist, 'book', undefined)).toBe(true);
    });

    it('🔴 excludeKinds：漫画排除总结摘要，其余子类与其它类型照常', () => {
        const ai = entryFormFieldByKey('ai-summary')!;
        expect(entryFormFieldAppliesTo(ai, 'book', 'comic')).toBe(false);
        expect(entryFormFieldAppliesTo(ai, 'book', 'book')).toBe(true);
        expect(entryFormFieldAppliesTo(ai, 'book', 'novel')).toBe(true);
        expect(entryFormFieldAppliesTo(ai, 'movie')).toBe(true);
        expect(entryFormFieldAppliesTo(ai, 'game')).toBe(true);
    });
});

describe('entryFormFieldsFor / defaultEntryFormFieldsFor', () => {
    it('八格都能取到非空集合', () => {
        for (const slot of ENTRY_FORM_SLOTS) {
            const list = entryFormFieldsFor(slot.type, slot.kind);
            expect(list.length).toBeGreaterThan(0);
        }
    });

    it('电影拿不到任何书籍专属块，也拿不到音乐 / 游戏专属块', () => {
        const keys = keysOf(defaultEntryFormFieldsFor('movie'));
        expect(keys).not.toContain('isbn');
        expect(keys).not.toContain('comic-artist');
        expect(keys).not.toContain('music-album');
        expect(keys).not.toContain('playtime');
    });

    it('漫画有画师/总话数、没有 ISBN / 目录 / 作者简介 / 总结摘要', () => {
        const keys = keysOf(defaultEntryFormFieldsFor('book', 'comic'));
        expect(keys).toContain('comic-artist');
        expect(keys).toContain('comic-chapters');
        expect(keys).not.toContain('isbn');
        expect(keys).not.toContain('toc');
        expect(keys).not.toContain('author-intro');
        expect(keys).not.toContain('ai-summary');
    });

    it('网文有元数据章数、没有 ISBN 与画师', () => {
        const keys = keysOf(defaultEntryFormFieldsFor('book', 'novel'));
        expect(keys).toContain('novel-chapters');
        expect(keys).not.toContain('isbn');
        expect(keys).not.toContain('comic-artist');
    });

    it('文学有 ISBN / 元数据页数 / 目录 / 作者简介', () => {
        const keys = keysOf(defaultEntryFormFieldsFor('book', 'book'));
        expect(keys).toContain('isbn');
        expect(keys).toContain('pages');
        expect(keys).toContain('toc');
        expect(keys).toContain('author-intro');
        expect(keys).not.toContain('comic-artist');
        expect(keys).not.toContain('novel-chapters');
    });
});

describe('🔴 登记顺序 == 模板书写顺序（没配过不许被重排）', () => {
    const cases: Array<[EntryType, BookKind | undefined]> = [
        ['movie', undefined],
        ['tv', undefined],
        ['anime', undefined],
        ['game', undefined],
        ['music', undefined],
        ['book', 'book'],
        ['book', 'novel'],
        ['book', 'comic'],
    ];
    for (const [type, kind] of cases) {
        const label = kind ? `book:${kind}` : type;
        it(`${label} 的缺省顺序与模板一致`, () => {
            expect(keysOf(defaultEntryFormFieldsFor(type, kind))).toEqual(TEMPLATE_ORDER[label]);
        });
    }

    it('缺省 span 也符合模板（成对字段 3、长文本 6、年份 1）', () => {
        const list = defaultEntryFormFieldsFor('movie');
        const spanOf = (k: string): number => list.find((e) => e.key === k)!.span;
        expect(spanOf('meta')).toBe(6);
        expect(spanOf('genres')).toBe(3);
        // 🔴 m06404：年份压到 1 栅格（标题壳 3 栅格 + 年份 1 栅格 + 右侧 2 栅格给绝对定位的评分簇）
        expect(spanOf('year')).toBe(1);
        expect(spanOf('summary')).toBe(6);
    });
});

describe('normalizeEntryFormFields（只过滤不补回）', () => {
    it('undefined ⇒ 全量缺省', () => {
        expect(keysOf(normalizeEntryFormFields(undefined, 'movie'))).toEqual(TEMPLATE_ORDER.movie);
    });

    it('非数组垃圾值 ⇒ 全量缺省', () => {
        expect(keysOf(normalizeEntryFormFields('nope', 'movie'))).toEqual(TEMPLATE_ORDER.movie);
        expect(keysOf(normalizeEntryFormFields(42, 'movie'))).toEqual(TEMPLATE_ORDER.movie);
        expect(keysOf(normalizeEntryFormFields({ a: 1 }, 'movie'))).toEqual(TEMPLATE_ORDER.movie);
    });

    it('🔴 空数组是「全部收起」的合法值，必须原样保留（⛔ 不能当假值回落缺省）', () => {
        expect(normalizeEntryFormFields([], 'movie')).toEqual([]);
    });

    it('🔴 只过滤不补回：删掉一项后长度必须跟着少，⛔ 不能偷偷回填', () => {
        const raw = ['meta', 'genres', 'year'];
        const out = normalizeEntryFormFields(raw, 'movie');
        expect(out.length).toBe(3);
        expect(out.length).toBeLessThan(TEMPLATE_ORDER.movie.length);
    });

    it('不适用本类型的脏键被丢弃', () => {
        const out = keysOf(normalizeEntryFormFields(['meta', 'isbn', 'music-album', 'summary'], 'movie'));
        expect(out).toEqual(['meta', 'summary']);
    });

    it('已知键去重，先到先得', () => {
        const out = keysOf(normalizeEntryFormFields(['summary', 'meta', 'summary'], 'movie'));
        expect(out).toEqual(['summary', 'meta']);
    });

    it('旧格式（纯字符串）仍被认作缺省 span', () => {
        const out = normalizeEntryFormFields(['genres', 'meta'], 'movie');
        expect(out).toEqual([
            { key: 'genres', span: 3 },
            { key: 'meta', span: 6 },
        ]);
    });

    it('新格式的 span 被尊重（合法值原样、非法回落缺省）', () => {
        const out = normalizeEntryFormFields(
            [{ key: 'genres', span: 2 }, { key: 'meta', span: 99 }, { key: 'summary', span: 3 }],
            'movie',
        );
        expect(out).toEqual([
            { key: 'genres', span: 2 },
            { key: 'meta', span: 6 },
            { key: 'summary', span: 3 },
        ]);
    });

    it('混合新旧格式（脏数据兜底）', () => {
        const out = normalizeEntryFormFields([{ key: 'summary', span: 3 }, 'genres'], 'movie');
        expect(out).toEqual([
            { key: 'summary', span: 3 },
            { key: 'genres', span: 3 },
        ]);
    });

    it('对象缺 key / key 非字符串 ⇒ 丢弃', () => {
        const out = keysOf(normalizeEntryFormFields([{ span: 3 }, { key: 5, span: 3 }, 'meta'], 'movie'));
        expect(out).toEqual(['meta']);
    });
});

describe('isDefaultEntryFormFields（顺序与 span 都要一致才算缺省）', () => {
    it('全量缺省 ⇒ true', () => {
        expect(isDefaultEntryFormFields(defaultEntryFormFieldsFor('movie'), 'movie')).toBe(true);
    });

    it('顺序被改 ⇒ false', () => {
        const list = defaultEntryFormFieldsFor('movie');
        const swapped = [list[1], list[0], ...list.slice(2)];
        expect(isDefaultEntryFormFields(swapped, 'movie')).toBe(false);
    });

    it('span 被改 ⇒ false', () => {
        const list = defaultEntryFormFieldsFor('movie').map((e) =>
            e.key === 'genres' ? { key: e.key, span: 2 } : e,
        );
        expect(isDefaultEntryFormFields(list, 'movie')).toBe(false);
    });

    it('少一项 ⇒ false', () => {
        expect(isDefaultEntryFormFields(defaultEntryFormFieldsFor('movie').slice(1), 'movie')).toBe(false);
    });

    it('空数组 ⇒ false（全收起不是缺省）', () => {
        expect(isDefaultEntryFormFields([], 'movie')).toBe(false);
    });
});

describe('buildEntryFormPlan / entryFormFieldHidden / entryFormFieldSpan', () => {
    it('未配置（undefined）⇒ 全显示、全缺省 span、空 order', () => {
        const plan = buildEntryFormPlan(undefined, 'movie');
        expect(plan.hidden.size).toBe(0);
        for (const key of TEMPLATE_ORDER.movie) {
            expect(entryFormFieldHidden(plan, key)).toBe(false);
            expect(entryFormFieldSpan(plan, key)).toBe(entryFormFieldByKey(key)!.span);
        }
    });

    it('隐藏一项 ⇒ 只有它在 hidden 里', () => {
        const list = defaultEntryFormFieldsFor('movie').filter((e) => e.key !== 'summary');
        const plan = buildEntryFormPlan(list, 'movie');
        expect(plan.hidden.size).toBe(1);
        expect(entryFormFieldHidden(plan, 'summary')).toBe(true);
        expect(entryFormFieldHidden(plan, 'meta')).toBe(false);
    });

    it('全收起（空数组）⇒ hidden 覆盖该类型全部**可管理**字段（固定键除外），且不含锁定键', () => {
        const plan = buildEntryFormPlan([], 'movie');
        const applicable = entryFormFieldsFor('movie');
        // 🔴 m07047 起固定键是第一行整组（剧集/电影：year + meta 两个）。
        //   ⚠️ 期望值**写死 2**（该类型下适用固定键的个数），
        //   ⛔ 别用 `ENTRY_FORM_FIXED_KEYS.length` 算期望 —— 那样把常量清空时这条会跟着成立，等于没锁住行为。
        const fixedHere = applicable.filter((d) => ENTRY_FORM_FIXED_KEYS.includes(d.key));
        expect(fixedHere.map((d) => d.key)).toEqual(['year', 'meta']);
        expect(plan.hidden.size).toBe(applicable.length - 2);
        for (const d of fixedHere) expect(entryFormFieldHidden(plan, d.key)).toBe(false);
        for (const d of applicable) {
            if (ENTRY_FORM_FIXED_KEYS.includes(d.key)) continue;
            expect(entryFormFieldHidden(plan, d.key)).toBe(true);
        }
        for (const locked of ENTRY_FORM_LOCKED_KEYS) expect(entryFormFieldHidden(plan, locked)).toBe(false);
    });

    it('🔴 固定键即使不在配置里也恒有位次（旧配置不含它也不能把它挤到最后）', () => {
        // 用户可能存过一份「当时 meta 还能收起」的旧配置
        const plan = buildEntryFormPlan([{ key: 'genres', span: 3 }, { key: 'summary', span: 6 }], 'movie');
        expect(entryFormFieldHidden(plan, 'meta')).toBe(false);
        expect(entryFormFieldHidden(plan, 'year')).toBe(false);
        // 模板里 year 排第一、meta 第二位 ⇒ 被强制补到最前，⛔ 不能落到 rank=MAX 的末尾
        expect(plan.order.get('year')).toBe(0);
        expect(plan.order.get('meta')).toBe(1);
        expect(plan.order.get('genres')!).toBeGreaterThan(1);
        expect(plan.order.get('summary')!).toBeGreaterThan(plan.order.get('genres')!);
    });

    it('span 改动反映到 plan', () => {
        const list = defaultEntryFormFieldsFor('movie').map((e) =>
            e.key === 'genres' ? { key: 'genres', span: 2 } : e,
        );
        const plan = buildEntryFormPlan(list, 'movie');
        expect(entryFormFieldSpan(plan, 'genres')).toBe(2);
        // 🔴 m06404：年份缺省已改成 1 栅格（标题 3 + 年份 1 + 右侧 2 格给绝对定位的评分簇）
        expect(entryFormFieldSpan(plan, 'year')).toBe(1);
    });

    it('order 位次：非固定键按配置数组的先后，固定键按模板位次插回去', () => {
        const list: EntryFormFieldLayout[] = [
            { key: 'summary', span: 6 },
            { key: 'genres', span: 3 },
        ];
        const plan = buildEntryFormPlan(list, 'movie');
        // 🔴 m07047：固定键是第一行整组（year 模板第 0 位、meta 第 1 位）⇒ 强制占 0/1 号位，
        //    其余可管理键保持用户在配置里的相对先后（summary 在 genres 前）。
        expect(plan.order.get('year')).toBe(0);
        expect(plan.order.get('meta')).toBe(1);
        expect(plan.order.get('summary')!).toBeGreaterThan(1);
        expect(plan.order.get('summary')!).toBeLessThan(plan.order.get('genres')!);
    });

    it('plan 拿不到未登记键 ⇒ span 回退缺省、hidden 视为显示', () => {
        const plan = buildEntryFormPlan(undefined, 'movie');
        expect(entryFormFieldSpan(plan, 'not-a-key')).toBe(ENTRY_FORM_MAX_SPAN);
        expect(entryFormFieldHidden(plan, 'not-a-key')).toBe(false);
    });
});

describe('sortEntryFormKeys', () => {
    it('null plan ⇒ 返回副本且不改入参', () => {
        const input = ['b', 'a'];
        const out = sortEntryFormKeys(input, null);
        expect(out).toEqual(['b', 'a']);
        expect(out).not.toBe(input);
        expect(input).toEqual(['b', 'a']);
    });

    it('按 plan 位次升序（固定键恒占模板位次）', () => {
        const plan = buildEntryFormPlan(
            [{ key: 'summary', span: 6 }, { key: 'meta', span: 6 }, { key: 'genres', span: 3 }],
            'movie',
        );
        // 🔴 2026-11-14：meta 固定 ⇒ 恒在模板首位，用户配置只管其余键的先后
        expect(sortEntryFormKeys(['genres', 'summary', 'meta'], plan)).toEqual(['meta', 'summary', 'genres']);
    });

    it('未登记键垫底且保持相对顺序', () => {
        const plan = buildEntryFormPlan([{ key: 'summary', span: 6 }, { key: 'meta', span: 6 }], 'movie');
        // plan 里 meta 固定占 0 号位、summary 位次 1；x / y 未登记 ⇒ 垫底且彼此保持原相对顺序
        expect(sortEntryFormKeys(['x', 'meta', 'y', 'summary'], plan)).toEqual(['meta', 'summary', 'x', 'y']);
    });

    it('已有序 ⇒ 等值返回', () => {
        const plan = buildEntryFormPlan([{ key: 'summary', span: 6 }, { key: 'meta', span: 6 }], 'movie');
        expect(sortEntryFormKeys(['meta', 'summary'], plan)).toEqual(['meta', 'summary']);
    });

    it('空数组 ⇒ 空数组', () => {
        expect(sortEntryFormKeys([], null)).toEqual([]);
    });
});

describe('固定键（五个年份键 + meta）：永远显示、不进设置面板、不随用户配置消失', () => {
    it('ENTRY_FORM_FIXED_KEYS 恰好是第一行整组，且它们必须留在注册表里', () => {
        // 🔴 2026-11-15 m07047（用户逐字）：「高级设置-条目属性排序**不要显示第一行了**，
        //   如标题、年份、评分来源都不要显示，都是固定的不能改换顺序」
        //   ⇒ 第一行整组固定：标题（属锁定键，本就不在注册表）+ 五个年份键 + `meta`。
        // ⚠️ 固定键**必须**在 ENTRY_FORM_FIELDS 里（buildEntryFormPlan 靠注册表算位次宽度）；
        //   ⛔ 别为了「面板上不显示」就把它从注册表删掉 —— 那样它会变成未登记键 ⇒ 被 sortEntryFormKeys 垫底。
        expect(ENTRY_FORM_FIXED_KEYS).toEqual(['year', 'novel-year', 'comic-year', 'book-year', 'music-year', 'meta']);
        for (const key of ENTRY_FORM_FIXED_KEYS) {
            expect(entryFormFieldByKey(key), `${key} 必须登记在注册表里`).toBeTruthy();
            expect(entryFormFieldIsFixed(key)).toBe(true);
        }
        expect(entryFormFieldIsFixed('genres')).toBe(false);
        expect(entryFormFieldIsFixed('tags')).toBe(false);
    });

    it('固定键与锁定键是两个不相交的概念', () => {
        for (const fixed of ENTRY_FORM_FIXED_KEYS) {
            expect(ENTRY_FORM_LOCKED_KEYS.includes(fixed)).toBe(false);
        }
    });

    it('withFixedEntryFormFields：把用户删掉的固定键按模板位次补回来', () => {
        const out = withFixedEntryFormFields([{ key: 'genres', span: 3 }], 'movie');
        // 影视：模板里 year → meta → genres ⇒ 两个固定键都补在 genres 之前
        expect(out.map((e) => e.key)).toEqual(['year', 'meta', 'genres']);
        expect(out[0].span).toBe(entryFormFieldByKey('year')!.span);
        expect(out[1].span).toBe(entryFormFieldByKey('meta')!.span);
    });

    it('withFixedEntryFormFields：已有固定键 ⇒ 位置与宽度都以模板为准，不重复', () => {
        const out = withFixedEntryFormFields(
            [
                { key: 'meta', span: 2 },
                { key: 'genres', span: 3 },
            ],
            'movie',
        );
        expect(out.filter((e) => e.key === 'meta')).toHaveLength(1);
        expect(out.filter((e) => e.key === 'year')).toHaveLength(1);
        // 宽度以模板为准：meta 是 6 栅格、year 是 1 栅格
        expect(out.find((e) => e.key === 'meta')!.span).toBe(entryFormFieldByKey('meta')!.span);
        expect(out.find((e) => e.key === 'year')!.span).toBe(entryFormFieldByKey('year')!.span);
        // 位次仍是模板位次：year 在 genres 之前
        expect(out.findIndex((e) => e.key === 'year')).toBeLessThan(out.findIndex((e) => e.key === 'genres'));
    });

    it('withFixedEntryFormFields：补完后与模板缺省等价 ⇒ isDefault 判 true（不会白写一份配置）', () => {
        // 用户在面板上把一个普通键删掉再放回来，落库形态必须回到「缺省」，
        // 否则 isDefaultEntryFormFields 恒判非缺省 ⇒ 每个用户都会被写自定义配置。
        const withoutFixed = defaultEntryFormFieldsFor('movie').filter((e) => !ENTRY_FORM_FIXED_KEYS.includes(e.key));
        const full = withFixedEntryFormFields(withoutFixed, 'movie');
        expect(isDefaultEntryFormFields(full, 'movie')).toBe(true);
    });

    it('withFixedEntryFormFields：八个类型格（含文学 / 网文 / 漫画）都成立', () => {
        // 用 ENTRY_FORM_SLOTS 遍历（八格 = 六类型 + 书籍三子类），⛔ 别拿 TEMPLATE_ORDER 的键当 EntryType 用：
        // novel / comic 是 BookKind，不是 EntryType。
        expect(ENTRY_FORM_SLOTS).toHaveLength(8);
        for (const slot of ENTRY_FORM_SLOTS) {
            // 表格键：影视/游戏/音乐用类型名，书籍三子类用 'book:<kind>'
            const label = slot.kind ? `book:${slot.kind}` : slot.type;
            const withoutFixed = defaultEntryFormFieldsFor(slot.type, slot.kind).filter((e) => !ENTRY_FORM_FIXED_KEYS.includes(e.key));
            const full = withFixedEntryFormFields(withoutFixed, slot.type, slot.kind);
            // 🔴 m05562 之后 meta **不再是第一位**（年份键提到最前，见 TEMPLATE_ORDER 的注释）——
            //    所以这里按「模板里 meta 该在第几位」来判，⛔ 别写死 `full[0]`。
            expect(keysOf(full)[TEMPLATE_ORDER[label].indexOf('meta')]).toBe('meta');
            expect(keysOf(full)).toEqual(TEMPLATE_ORDER[label]);
        }
    });
});

/**
 * 🔴🔴 m05562 的四条排版约束（用户 2026-11-15 逐字）：「表单的标题框太长了，把上映年（首播年、
 *   发行年）和标题并排在中…上映年原来位置由标签替代…然后把系列和系列序号框合并为一个宽度行不行，
 *   然后和合集并排」。
 *
 * 这一组**读真实模板与样式**（`src/views/components/EntryForm.svelte`），不是读纯函数 ——
 * `ENTRY_FORM_FIELDS` 的顺序对不代表画面上排对了：年份键排在第一位，但模板若把它写在 meta 后面，
 * 用户看到的仍是「标题 → 来源行 → 题材 → 年份」。两层都得钉。
 */
describe('🔴 m05562 表单排版（读模板守卫）', () => {
    const SRC = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
    /** 模板区（`<style>` 之前那一段）—— CSS 里同名的 `.rl-series-pair` 不该干扰 DOM 断言。 */
    const TPL = SRC.slice(0, SRC.indexOf('<style'));
    /** 样式区 —— 只从 `.rl-fields-col {` 那块之后找，避免命中别处的同名片段。 */
    const CSS = SRC.slice(SRC.indexOf('<style'));
    /**
     * 全局样式表 —— 评分簇那组规则**必须**在全局（见 ②c 的理由）。
     * `styles.css` 是纯 LF，直接读即可。
     */
    const GLOBAL_CSS = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

    it('① 标题外包一层 `.rl-title-col`，且它**不带** data-fld（title 是锁定键）', () => {
        // 开壳必须在标题 label 之前、`.rl-title-row` 之后收
        const open = TPL.indexOf('<div class="rl-title-col">');
        const close = TPL.indexOf('<!-- /rl-title-col -->');
        const row = TPL.indexOf('<div class="rl-title-row">');
        expect(open).toBeGreaterThan(-1);
        expect(close).toBeGreaterThan(open);
        expect(row).toBeGreaterThan(open);
        expect(row).toBeLessThan(close);
        // ⛔ 别给这层壳加 data-fld —— title 属锁定键，进了受管集合会被 applyFieldOrder 重排
        const shell = TPL.slice(open, close);
        expect(shell).not.toMatch(/<div class="rl-title-col"[^>]*data-fld/);
    });

    it('② CSS 给标题壳 **span 3**（年份 1 ⇒ 3+1=4，右侧 2 格留给绝对定位的评分簇），且必须写在 `:not([data-fld])` 之后', () => {
        const rule = CSS.indexOf('.rl-fields-col > .rl-title-col');
        const blanket = CSS.indexOf('.rl-fields-col > :not([data-fld])');
        expect(rule).toBeGreaterThan(-1);
        expect(blanket).toBeGreaterThan(-1);
        expect(rule).toBeGreaterThan(blanket);
        const block = CSS.slice(rule, CSS.indexOf('}', rule));
        // 🔴 m06052：用户要「标题框占长、上映年占短」⇒ 标题 4 栅格、年份 2 栅格。
        //   上一版两边都 span 3，加上标题行内的评分簇/AI 按钮挤占后，标题框反而更短（实测 245 vs 271）。
        // 🔴 m06404：用户「标题|上映年|评分来源贴最右」⇒ 标题 3 栅格、年份 1 栅格，
        //   右侧空出的 2 栅格给 `position: absolute` 的只读评分簇（`.rl-ro-meta`）。
        expect(block).toMatch(/grid-column:\s*1 \/ span 3/);
        // 反向守卫：⛔ 别退回 span 4 —— 4+2 正好占满整行、零余量，评分簇只能挤在中间
        //（那正是被用户打回的「这还是来源评分占中间啊」）
        expect(block).not.toMatch(/grid-column:\s*1 \/ span 4/);
    });

    it('②b 标题 3 + 年份 1 = 4 栅格，余 2 格给评分簇（数量守恒，别占满整行）', () => {
        const titleSpan = 3; // 上一条已钉 CSS 里的 span 3
        // 五个年份键的 span 必须都是 1，且全类型一致 —— 否则某些类型会换行错位
        for (const key of ['year', 'novel-year', 'comic-year', 'book-year', 'music-year']) {
            expect(entryFormFieldByKey(key)!.span).toBe(1);
        }
        const used = titleSpan + entryFormFieldByKey('year')!.span;
        expect(used).toBe(4);
        // 🔴 硬约束：标题 + 年份必须 **小于 6**，把右侧留给评分簇。
        //   做到 6（=占满整行）就会把评分簇逼回中间，用户当场能看出来。
        expect(used).toBeLessThan(ENTRY_FORM_MAX_SPAN);
    });

    it('②c 只读评分簇绝对定位贴整行最右（锚点是 `.rl-fields-col`，⛔ 不能锚标题行）', () => {
        // 定位锚点：`.rl-fields-col` 必须有 position: relative
        const colRule = CSS.indexOf('.rl-fields-col {');
        expect(colRule).toBeGreaterThan(-1);
        const colBlock = CSS.slice(colRule, CSS.indexOf('}', colRule));
        expect(colBlock).toMatch(/position:\s*relative/);
        // 🔴 簇与 AI 按钮那组规则**必须在全局 `styles.css`**，不能在本组件的 scoped 样式里：
        //   `assert-symbols.cjs:6605` / `:6754` 钉死产物里 `"rl-btn rl-btn-src"` 恰好 1 处，
        //   而 scoped 样式会让 Svelte 给按钮追加 `svelte-xxxx` 哈希类 ⇒ 字面串消失、计数归零
        //   （本轮实测踩到、门禁当场红）。这跟 `.rl-ai-btn`「#406 起全局化」是同一条理由。
        // 🔴 m03052：这组规则的选择器**只剩 `.rl-ro-meta`** —— 原先是
        //   `.rl-title-row > .rl-ro-meta,\n.rl-title-row > .rl-ai-btn`（逗号连接两枚），
        //   用户裁定「AI预填图标按钮…位置放在书名标题的右旁边不是框旁边」⇒ ✨ 已搬进标题**标签行**
        //   （`.rl-lbl-row`，与「总结摘要 / 重新解析」同槽），标题输入行里再也没有 `.rl-ai-btn` 子节点。
        const abs = GLOBAL_CSS.indexOf('.rl-title-row > .rl-ro-meta {');
        expect(abs).toBeGreaterThan(-1);
        // ⛔ 反向守卫：⛔ 别把 `.rl-title-row > .rl-ai-btn` 加回这组规则 —— 标题行里已无该子节点，
        //   留着是永不命中的死规则，还会误导后来人以为 ✨ 仍在输入框右侧。
        //   ⚠️ 必须先剥注释：styles.css 里那段解释「为什么撤掉它」的长注释本身就会命中这条正则
        //   （实测踩到：不剥注释这条守卫会自己把自己判红）。
        const globalNoComments = GLOBAL_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(globalNoComments).not.toMatch(/\.rl-title-row\s*>\s*\.rl-ai-btn/);
        const absBlock = GLOBAL_CSS.slice(abs, GLOBAL_CSS.indexOf('}', abs));
        expect(absBlock).toMatch(/position:\s*absolute/);
        expect(absBlock).toMatch(/right:\s*0/);
        // ⛔ 反向守卫：本组件 scoped 样式里**不许**再出现 `.rl-btn-src` 选择器
        //   （否则又会把 Svelte 哈希类塞进那枚按钮的 class）
        const scopedNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(scopedNoComments).not.toMatch(/\.rl-btn-src\s*[,{]/);
        // ⛔ 反向守卫：`.rl-title-row` **不能**变成定位锚点 —— 一旦 relative，
        //   right: 0 只会贴到标题那一格（271px）的右缘，正是用户说的「占中间」。
        for (const sheet of [CSS, GLOBAL_CSS]) {
            const rowRule = sheet.indexOf('.rl-title-row {');
            if (rowRule > -1) {
                const rowBlock = sheet.slice(rowRule, sheet.indexOf('}', rowRule));
                expect(rowBlock).not.toMatch(/position:\s*relative/);
            }
        }
        // 顶部/底部必须留 auto —— 否则以整个字段栅格（800px+）为参照，簇会跑到行外
        expect(absBlock).toMatch(/top:\s*auto/);
        expect(absBlock).toMatch(/bottom:\s*auto/);
        // 宽度上界必须是「右侧 2 栅格」那一量级（实测自然宽 202px，超过就反压年份框）
        expect(absBlock).toMatch(/max-width:\s*18\dpx/);
    });

    it('③ 年份块紧跟在标题壳之后、且在 meta 之前（顺序：标题、上映年、评分来源）', () => {
        const close = TPL.indexOf('<!-- /rl-title-col -->');
        const year = TPL.indexOf('<div data-fld="year"');
        const meta = TPL.indexOf('<div class="rl-meta-row"');
        expect(year).toBeGreaterThan(close);
        expect(meta).toBeGreaterThan(year);
        // 五类年份各自一把 key —— 一个都不能落在 meta 之后（否则被 span6 的 meta 挤到下一行）
        for (const key of ['year', 'novel-year', 'comic-year', 'book-year', 'music-year']) {
            const at = TPL.indexOf(`<div data-fld="${key}"`);
            expect(at).toBeGreaterThan(close);
            expect(at).toBeLessThan(meta);
        }
    });

    it('④ 标签紧跟题材、且已在「合集」之前（上映年原位置由标签替代）', () => {
        const genres = TPL.indexOf('<div data-fld="genres"');
        const tags = TPL.indexOf('<div data-fld="tags"');
        const collection = TPL.indexOf('<div data-fld="collection"');
        expect(genres).toBeGreaterThan(-1);
        expect(tags).toBeGreaterThan(genres);
        expect(collection).toBeGreaterThan(tags);
        // ⛔ 全模板只能有**一处** tags 渲染（上移后若忘了删旧的，会出现两个同名输入框）
        expect(TPL.match(/<div data-fld="tags"/g) ?? []).toHaveLength(1);
    });

    it('⑤ 系列 + 系列序号并进**同一个**受管块：`series-index` 不再有 data-fld，`series` 内有 pair', () => {
        // series-index 已从注册表退场 ⇒ 模板里不许再出现它的 data-fld
        expect(TPL).not.toMatch(/data-fld="series-index"/);
        expect(entryFormFieldByKey('series-index')).toBeUndefined();
        // 两框仍在，且落在 rl-series-pair 里
        const series = TPL.indexOf('<div data-fld="series"');
        const pair = TPL.indexOf('<div class="rl-series-pair">');
        expect(pair).toBeGreaterThan(series);
        const pairBlock = TPL.slice(pair, TPL.indexOf('</div>', TPL.indexOf('rl-series-cell-idx')));
        expect(pairBlock).toMatch(/id="rl-f-series"/);
        expect(pairBlock).toMatch(/id="rl-f-series-index"/);
    });

    it('⑥ 系列组内部 2:1 分宽（合计仍是半行），右侧与合集并排', () => {
        const pair = CSS.indexOf('.rl-series-pair {');
        expect(pair).toBeGreaterThan(-1);
        const cell = CSS.indexOf('.rl-series-pair > .rl-series-cell {');
        const idx = CSS.indexOf('.rl-series-pair > .rl-series-cell-idx {');
        expect(cell).toBeGreaterThan(pair);
        expect(idx).toBeGreaterThan(cell);
        expect(CSS.slice(cell, CSS.indexOf('}', cell))).toMatch(/flex:\s*2/);
        expect(CSS.slice(idx, CSS.indexOf('}', idx))).toMatch(/flex:\s*1/);
        // 两框同属一个 span3 块 ⇒ 合计半行宽；合集也是 span 3 ⇒ 正好拼成一整行
        expect(entryFormFieldByKey('series')!.span).toBe(3);
        expect(entryFormFieldByKey('collection')!.span).toBe(3);
    });

    it('⑦ 数字框与文本框同高（m06052：全表单统一高度）', () => {
        /**
         * 根因（真机逐条比对规则集才找到）：宿主核心 css 有
         * `input[type="text|number|…"] { height: var(--input-height) }`（=32px）；
         * 本插件的文本框大多不写 type ⇒ 匹配不上 ⇒ auto（27px）；数字框被命中 ⇒ 32px。
         * ⇒ 必须把数字框的 height 也改回 auto，⛔ 别写 27px 定值。
         */
        const STYLES = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');
        const at = STYLES.indexOf("body .rl-input[type='number'] {");
        expect(at).toBeGreaterThan(-1);
        const block = STYLES.slice(at, STYLES.indexOf('}', at));
        expect(block).toMatch(/height:\s*auto/);
        // 反向守卫：⛔ 别用定值压高 —— 字号一改就脱节
        expect(block).not.toMatch(/height:\s*\d+px/);
        expect(block).not.toMatch(/height:\s*var\(--input-height\)/);
        // 微调按钮也要藏掉（个别平台它会额外占宽）
        expect(STYLES).toMatch(/\.rl-input\[type='number'\]::-webkit-inner-spin-button/);
        expect(STYLES).toMatch(/\.rl-input\[type='number'\]::-webkit-outer-spin-button/);
        // ⛔ 主规则不许加 height —— assert-symbols #456 明令禁止
        const mainRule = STYLES.slice(STYLES.indexOf('body .rl-input {'), STYLES.indexOf('}', STYLES.indexOf('body .rl-input {')));
        expect(mainRule).not.toMatch(/\bheight:/);
    });

    it('⑧ 系列组内两个 label 必须原样继承 `.rl-lbl` 的 margin-top（m06052 不对齐的真凶）', () => {
        /**
         * 🔴🔴 实测：`.rl-series-pair .rl-lbl { margin-top: 0 }` 会让整组比右边「合集」高 9px
         * （系列 label y=417 vs 合集 y=426、两个 input y=436 vs y=445）。
         * 行距真源是 `.rl-lbl { margin: 9px 0 4px }`（`:6412`），组内 label ⛔ 不许被单独抹平。
         */
        // ⚠️ 必须先剥掉注释再判：源码注释里逐字保留了那条错规则的写法（警示文案），
        //    裸匹配会命中注释本身，造成**恒假红**（本轮实测过）。
        const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(CSS_CODE).not.toMatch(/\.rl-series-pair[^{]*\.rl-lbl[^{]*\{[^}]*margin-top:\s*0/);
        expect(CSS_CODE).not.toMatch(/\.rl-series-cell[^{]*\.rl-lbl[^{]*\{[^}]*margin-top:\s*0/);
        // 正向：行距真源还在
        const lbl = CSS_CODE.indexOf('.rl-lbl {');
        expect(lbl).toBeGreaterThan(-1);
        expect(CSS_CODE.slice(lbl, CSS_CODE.indexOf('}', lbl))).toMatch(/margin:\s*9px 0 4px/);
    });

    it('⑨ 并排的两个字段块必须上下齐平（m07813① 简介 / 总结 1/2 并排）', () => {
        /**
         * 🔴🔴 真机实测（1440×900，`.testvault`，把「简介」「总结摘要」强制各 span 3 并排后）：
         *   外层高度本来就一致（131 = 131，栅格行被统一），坏的是**块内部**：
         *     · 「简介」textarea 被 `autosizeTextarea()` 按内容撑到 **104px**；
         *     · 「总结摘要」textarea 只有 `rows="4"` 的固定 **84px**
         *       ⇒ 底边差 **24px**。
         *     · 裸 `.rl-lbl` 是 9+14+4 = **27px** 高；`.rl-lbl-row` 里那颗粒 label 的
         *       `margin-bottom` 被清零 ⇒ 只有 **23px** ⇒ 顶边再差 **4px**。
         *   修法：受管块统一纵向 flex + 块内 textarea `flex: 1 1 auto`（吃掉剩余高度），
         *        标签行补回 4px 下边距。修后实测 taTop 399=399、taBottom 503=503（完全对齐）。
         *   ⛔ 别退回 `display: block`，也别给 textarea 写死 height。
         */
        const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        // 实现走到 `applyFieldOrder()` 里写内联样式 ⇒ 要读模板 + 脚本那一段（⛔ 不是 `<style>`）
        const TPL_CODE = TPL.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const fn = TPL_CODE.indexOf('function applyFieldOrder(): void {');
        expect(fn).toBeGreaterThan(-1);
        const fnBody = TPL_CODE.slice(fn, TPL_CODE.indexOf('\n    afterUpdate(', fn));

        // ① 受管块设成纵向 flex（`meta` 除外 —— 它本身是四框横排的 `.rl-meta-row`）
        expect(fnBody).toMatch(/const isMeta = key === 'meta';/);
        expect(fnBody).toMatch(/const wantDisplay = hide \? 'none' : isMeta \? '' : 'flex';/);
        expect(fnBody).toMatch(/const wantDir = isMeta \? '' : 'column';/);
        expect(fnBody).toMatch(/el\.style\.flexDirection = wantDir;/);
        // 反向守卫：⛔ 不许退回 `display: block`（那样并排必不齐，本轮真机踩过）
        expect(fnBody).not.toMatch(/'block'/);
        // 反向守卫：⛔ 不许在 `<style>` 里重新加那三条选择器 ——
        //   实测 Svelte scoped 会给同组既有规则叠第三段 hash，打红 assert-symbols 十余条旧断言
        expect(CSS_CODE).not.toMatch(/\.rl-fields-col > \[data-fld\]:not\(\[data-fld='meta'\]\)\s*\{/);
        expect(CSS_CODE).not.toMatch(/\.rl-fields-col > \[data-fld\] > \.rl-lbl-row\s*\{/);

        // ② 块内 textarea 吃掉剩余高度（`min-height: 0` 是 flex 收缩的必要条件）
        expect(fnBody).toMatch(/:scope > textarea\.rl-input/);
        expect(fnBody).toMatch(/ta\.style\.flex = '1 1 auto';/);
        expect(fnBody).toMatch(/ta\.style\.minHeight = '0';/);
        // 反向守卫：⛔ 不许写死高度（autosize 与 rows 两套口径会再次打架）
        expect(fnBody).not.toMatch(/ta\.style\.height/);

        // ③ 标签行补回 4px 下边距（顶边对齐）
        expect(fnBody).toMatch(/:scope > \.rl-lbl-row/);
        expect(fnBody).toMatch(/row\.style\.marginBottom = '4px';/);
        // 反向守卫：⛔ 全局 `.rl-lbl-row` 的「标签无下边距」口径不许被改（启动路径 / 进度页数在用）
        const global = CSS_CODE.indexOf('.rl-lbl-row .rl-lbl {');
        expect(global).toBeGreaterThan(-1);
        expect(CSS_CODE.slice(global, CSS_CODE.indexOf('}', global))).toMatch(/margin-bottom:\s*0/);
    });

    it('⑩ 标题行的 ✨ 要比「书名」文字中心下移 4.5px（m03052 ③ 视觉对齐）', () => {
        /**
         * 🔴 无头 Chrome 实测（`_shot/entryform-ai-protos.html`，真样式表）：
         *   `.rl-lbl-row { align-items: center }` 居中的是**外边距盒**，而里面的
         *   `.rl-lbl` 仍带 `margin: 9px 0 4px` 的上外边距、✨ 又是 18px 高（label 文字行仅 15px）
         *   ⇒ 按钮相对文字中心**上抬 4.5px**（label.cy=76.9 / btn.cy=72.4）。
         *   ✨ 和「书名」在标题行里是同一个视觉单元，浮半格肉眼就看得出。
         * ⇒ 用 `position: relative; top: 4.5px` 做**视觉微移**。
         *   ⛔ 不许改用 margin / height 修：那会把标题列总高从 28px 改成 31px，
         *      标题框整体比右边年份框低 3px，上面那条 4px 补偿就白算了（两个错叠起来更歪）。
         *
         * 🔴 真源**必须在全局** `styles.css`（与 `.rl-ai-btn` 同处，自 #406 起全局化）。
         *   写进组件 scoped 会让 Svelte 给「被新增子选择器命中的元素」的同组既有规则**再叠一层
         *   `.svelte-xxxx`** ⇒ 产物里那些规则从双 hash 变三段（实测
         *   `.rl-prefill-old.svelte-x.svelte-x.svelte-x`），而 `assert-symbols.cjs` 里十余条钉
         *   双 hash 形态的旧断言当场 12 条红（本轮实测踩到并撤回）。
         */
        const globalNoComments = GLOBAL_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        const at = globalNoComments.indexOf('.rl-title-col > .rl-lbl-row .rl-ai-btn {');
        expect(at).toBeGreaterThan(-1);
        const block = globalNoComments.slice(at, globalNoComments.indexOf('}', at));
        expect(block).toMatch(/position:\s*relative/);
        expect(block).toMatch(/top:\s*4\.5px/);
        // 反向守卫：⛔ 不许用盒模型改对齐（margin-top / height / padding 都不行）
        expect(block).not.toMatch(/\bmargin/);
        expect(block).not.toMatch(/\bheight/);
        expect(block).not.toMatch(/\bpadding/);
        // 反向守卫：⛔ 这条选择器绝不许出现在组件 scoped 里（会引发 hash 层数升级）
        const scopedNoComments = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(scopedNoComments).not.toContain('.rl-title-col > .rl-lbl-row .rl-ai-btn');
        // 前提还在：`.rl-lbl` 的块间距真源（在**组件 scoped**，不是全局）没被抹，否则 4.5 就失去依据
        const lbl = scopedNoComments.indexOf('.rl-lbl {');
        expect(lbl).toBeGreaterThan(-1);
        expect(scopedNoComments.slice(lbl, scopedNoComments.indexOf('}', lbl))).toMatch(/margin:\s*9px 0 4px/);
    });
});
