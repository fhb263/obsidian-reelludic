// 笔记属性顺序（pure/fieldOrder）单测 —— 1.3.1 ① 第 3 件
//
// 契约来源（用户 2026-10-12）：「新增高级设置-支持新增条目前各类型笔记属性排序」
// 关键口径：**按类型分开配** / **只排序不增删** / **缺省 = 现有写出顺序** / 未登记键落到末尾且不丢。
import { describe, it, expect } from 'vitest';
import {
    FIELD_ORDER_TYPES,
    GLOBAL_FIELD_KEYS,
    applyFieldOrder,
    defaultOrderFor,
    defaultOrderForBookKind,
    exclusiveFieldsFor,
    isDefaultKindOrder,
    isDefaultOrder,
    isGlobalFieldKey,
    normalizeFieldOrder,
    normalizeFieldOrderForKind,
    orderForBookKind,
    orderForType,
    resolveAllKindOrders,
    resolveAllOrders,
} from 'pure/fieldOrder';
import { META_FIELDS, META_FIELD_KEYS, fieldAppliesTo, findMetaField } from 'pure/metaFields';
import { BOOK_KINDS } from 'pure/bookKind';
import { entryFrontmatter } from 'data/noteGenerator';
import type { EntryType, MediaEntry } from 'data/types';

function entry(partial: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e1',
        type: 'movie',
        title: '标题',
        status: 'watching',
        rating: 4,
        year: 2020,
        genres: ['题材'],
        cast: [],
        director: '某某',
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
        ...partial,
    };
}

/** 从 YAML frontmatter 文本里取出顶层键（顺序即文本顺序） */
function fmKeys(fm: string): string[] {
    const body = /^---\n([\s\S]*?)\n---/.exec(fm)?.[1] ?? '';
    return body
        .split('\n')
        .map((l) => l.slice(0, l.indexOf(':')))
        .filter((k) => !!k);
}

describe('pure/fieldOrder 缺省顺序（= 现有写出顺序）', () => {
    it('六个类型都在册', () => {
        expect([...FIELD_ORDER_TYPES]).toEqual(['movie', 'tv', 'anime', 'book', 'game', 'music']);
    });

    it('🔴 按类型过滤：类型专属字段只出现在该类型的表里', () => {
        expect(defaultOrderFor('movie')).not.toContain('reading_page');
        expect(defaultOrderFor('book')).toContain('reading_page');
        expect(defaultOrderFor('book')).toContain('page_count');
        expect(defaultOrderFor('book')).toContain('read_minutes');
        expect(defaultOrderFor('tv')).toContain('progress_episode');
        expect(defaultOrderFor('anime')).toContain('progress_episode');
        expect(defaultOrderFor('game')).toContain('playtime_minutes');
        expect(defaultOrderFor('music')).toContain('album');
        // 反向：不该出现的类型里没有它们
        expect(defaultOrderFor('movie')).not.toContain('progress_episode');
        expect(defaultOrderFor('movie')).not.toContain('reading_page');
        expect(defaultOrderFor('movie')).not.toContain('playtime_minutes');
        expect(defaultOrderFor('movie')).not.toContain('album');
    });

    it('六个类型的并集 = 全部登记字段（一个不漏、也一个不多）', () => {
        const union = new Set<string>();
        for (const t of FIELD_ORDER_TYPES) for (const k of defaultOrderFor(t)) union.add(k);
        expect([...union].sort()).toEqual([...META_FIELD_KEYS].sort());
    });

    it('缺省顺序 = META_FIELDS 的登记顺序（与现有写出顺序逐位一致）', () => {
        expect(defaultOrderFor('movie')).toEqual(META_FIELDS.filter((f) => !f.types || f.types.includes('movie')).map((f) => f.key));
    });
});

describe('pure/fieldOrder 归一（#612 的教训：⛔ 不许把新字段吃掉）', () => {
    it('undefined / 非数组 ⇒ 回缺省', () => {
        expect(normalizeFieldOrder('movie', undefined)).toEqual(defaultOrderFor('movie'));
        expect(normalizeFieldOrder('movie', 'year')).toEqual(defaultOrderFor('movie'));
        expect(normalizeFieldOrder('movie', null)).toEqual(defaultOrderFor('movie'));
    });

    it('丢掉不认识的键（拼错 / 旧版本残留 / 手改 data.json）', () => {
        const out = normalizeFieldOrder('movie', ['year', 'bogus', 'titel']);
        expect(out).toContain('year');
        expect(out).not.toContain('bogus');
        expect(out).not.toContain('titel');
    });

    it('丢掉**该类型不适用**的键（把「已读页数」排进电影）', () => {
        // ⚠️ 用真的按类型门控的键：`reading_page` 只在 book 输出（`isbn` / `binding` / `price`
        //    在代码里是**无条件**输出的 ⇒ 六个类型都适用，⛔ 别拿它们做这条断言）
        expect(normalizeFieldOrder('movie', ['reading_page', 'year'])).not.toContain('reading_page');
        expect(normalizeFieldOrder('book', ['reading_page'])).toContain('reading_page');
        expect(normalizeFieldOrder('game', ['album'])).not.toContain('album');
        expect(normalizeFieldOrder('music', ['album'])).toContain('album');
    });

    it('去重', () => {
        expect(normalizeFieldOrder('movie', ['year', 'year']).filter((k) => k === 'year')).toHaveLength(1);
    });

    it('🔴 缺省里有、配置里没有的 ⇒ 追加到**末尾**（新字段不会因为「没配过」而写不出来）', () => {
        const partial = ['year', 'title'];
        const out = normalizeFieldOrder('movie', partial);
        expect(out.slice(0, 2)).toEqual(['year', 'title']);
        // 其余全部补在后面，且一个不少
        expect([...out].sort()).toEqual([...defaultOrderFor('movie')].sort());
        expect(out).toHaveLength(defaultOrderFor('movie').length);
    });
});

describe('pure/fieldOrder isDefaultOrder / orderForType / resolveAllOrders', () => {
    it('与缺省逐位一致 ⇒ true；只换两个位置 ⇒ false', () => {
        expect(isDefaultOrder('movie', defaultOrderFor('movie'))).toBe(true);
        const swapped = [...defaultOrderFor('movie')];
        [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
        expect(isDefaultOrder('movie', swapped)).toBe(false);
    });

    it('orderForType 从整份配置里按类型取；缺失 ⇒ 缺省', () => {
        const cfg = { movie: ['year', 'title'] };
        expect(orderForType(cfg, 'movie').slice(0, 2)).toEqual(['year', 'title']);
        expect(orderForType(cfg, 'book')).toEqual(defaultOrderFor('book'));
        expect(orderForType(undefined, 'game')).toEqual(defaultOrderFor('game'));
    });

    it('resolveAllOrders 一次给出六个类型的生效顺序', () => {
        const all = resolveAllOrders({ music: ['album'] });
        expect(Object.keys(all).sort()).toEqual([...FIELD_ORDER_TYPES].sort());
        expect(all.music[0]).toBe('album');
        expect(all.book).toEqual(defaultOrderFor('book'));
    });
});

describe('pure/fieldOrder applyFieldOrder（文本层重排）', () => {
    const yaml = '---\nid: "x"\ntype: movie\ntitle: "T"\nstatus: watching\nrating: 4\n---';

    it('按给定顺序重排键行', () => {
        const out = applyFieldOrder(yaml, ['rating', 'title', 'status', 'type', 'id']);
        expect(fmKeys(out)).toEqual(['rating', 'title', 'status', 'type', 'id']);
    });

    it('🔴 未登记的键落到**末尾**且保持原有先后（⛔ 不许清掉那一行）', () => {
        const out = applyFieldOrder(yaml, ['rating', 'id']);
        expect(fmKeys(out)).toEqual(['rating', 'id', 'type', 'title', 'status']);
    });

    it('order 为空 / 不匹配 ⇒ 原样返回（未配置顺序时零变化）', () => {
        expect(applyFieldOrder(yaml, [])).toBe(yaml);
    });

    it('非 frontmatter 文本原样返回（不抛错）', () => {
        expect(applyFieldOrder('## 标题\n\n正文', ['year'])).toBe('## 标题\n\n正文');
        expect(applyFieldOrder('', ['year'])).toBe('');
    });

    it('值里含冒号不受影响（只认行首到第一个冒号）', () => {
        const fm = '---\ntitle: "沙丘2: Part Two"\nyear: 2024\n---';
        expect(fmKeys(applyFieldOrder(fm, ['year', 'title']))).toEqual(['year', 'title']);
        expect(applyFieldOrder(fm, ['year', 'title'])).toContain('title: "沙丘2: Part Two"');
    });

    it('分隔线保住（首尾都是 ---）', () => {
        const out = applyFieldOrder(yaml, ['rating', 'id']);
        expect(out.startsWith('---\n')).toBe(true);
        expect(out.endsWith('\n---')).toBe(true);
        expect((out.match(/^---$/gm) || []).length).toBe(2);
    });
});

describe('🔴 端到端：自定义顺序真的改变了笔记里的属性排列', () => {
    it('把 rating 提到最前 ⇒ 笔记 frontmatter 里 rating 就是第一行', () => {
        const e = entry();
        const ordered = ['rating', ...defaultOrderFor('movie').filter((k) => k !== 'rating')];
        const fm = entryFrontmatter(e, 'ReelLudic', undefined, ordered);
        expect(fmKeys(fm)[0]).toBe('rating');
        expect(fmKeys(fm)[1]).toBe('id'); // 缺省顺序里排在第二位的就是 id
    });

    it('不传顺序 ⇒ 与历史逐字节一致（存量用户零变化）', () => {
        const e = entry();
        expect(entryFrontmatter(e, 'ReelLudic', undefined, undefined)).toBe(entryFrontmatter(e));
    });

    it('顺序与字段映射**同时**生效：先排序、后改名', () => {
        // 顺序里用的是**原始键名**，改名只影响最终写出的字面量
        const e = entry();
        const ordered = ['rating', ...defaultOrderFor('movie').filter((k) => k !== 'rating')];
        const fm = entryFrontmatter(e, 'ReelLudic', undefined, ordered);
        expect(fmKeys(fm)[0]).toBe('rating');
        expect(fm).toContain('title: "标题"');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #640：全局属性 / 类型专属属性的**归类**（用户报障的落点）
//   用户原话：「**电影专属属性的导演之类的怎么也归为全局属性了**」+
//            「我要的是**6个类型相同的**笔记属性才显示」。
// ══════════════════════════════════════════════════════════════════════════════
describe('#640 全局属性 / 类型专属属性归类', () => {
    it('🔴🔴 全局清单 = **专属字段的补集**（六类通用的都在里面，含封面/年份/题材/日期）', () => {
        // ⚠️ 翻面记录（#640f 用户报障）：「什么鬼，不是所有条目不都有这些字段吗，给我好好查啊」——
        //   第一版这里钉的是「恰 8 个键」（id/type/title/…/updated），把**封面 / 年份 / 题材 /
        //   又名 / 观看日期 / 计划日期 / 系列 / 系列序号** 全漏了。
        //   用户是对的：写出侧这些字段全是 `if (e.<field>)`（**零类型门控**），
        //   任何类型只要有值就会写 ⇒ 它们**本来就该在全局页**。
        // ⇒ 判据改成「**与专属字段互补**」这个**结构性**性质（⛔ 不再手抄一份名单：
        //   手抄名单正是本批这个 bug 的来源 —— 加字段时它会静默过期）。
        const exclusiveAll = FIELD_ORDER_TYPES.flatMap((t) => exclusiveFieldsFor(t));
        for (const f of META_FIELDS) {
            const isExclusive = exclusiveAll.includes(f.key);
            expect(isGlobalFieldKey(f.key), `${f.key} 的归属与专属字段不自洽`).toBe(!isExclusive);
        }
        // 用户点名的这几个必须在全局里
        for (const k of ['banner', 'year', 'genres', 'planned_date', 'watched_date', 'aliases', 'series']) {
            expect(isGlobalFieldKey(k), `${k} 应在全局`).toBe(true);
        }
    });

    it('🔴🔴 类型专属字段**不许**出现在全局清单里（本批报障的直接判据）', () => {
        // 导演/作者/开发商/ISBN 这些是「有值就写、写出侧不门控」的字段 ——
        // 拿 `defaultOrderFor` 取交集会把它们全算成公共字段（这就是那个 bug）。
        for (const k of ['director', 'cast', 'screenwriter', 'author', 'artist', 'translator',
            'publisher', 'isbn', 'binding', 'price', 'platform', 'developer', 'duration_min']) {
            expect(isGlobalFieldKey(k), `${k} 不该被当成全局属性`).toBe(false);
        }
    });

    it('🔴 导演归**影视三兄弟**（movie/tv/anime），⛔ 不出现在书籍/游戏/音乐页', () => {
        expect(exclusiveFieldsFor('movie')).toContain('director');
        expect(exclusiveFieldsFor('tv')).toContain('director');
        expect(exclusiveFieldsFor('anime')).toContain('director');
        for (const t of ['book', 'game', 'music'] as EntryType[]) {
            expect(exclusiveFieldsFor(t), `${t} 不该有导演`).not.toContain('director');
        }
    });

    it('🔴 书籍专属（作者/ISBN/出版社）⛔ 不出现在影视/游戏/音乐页', () => {
        for (const k of ['author', 'isbn', 'publisher', 'translator', 'binding', 'price']) {
            expect(exclusiveFieldsFor('book'), `书籍页该有 ${k}`).toContain(k);
            for (const t of ['movie', 'tv', 'anime', 'game', 'music'] as EntryType[]) {
                expect(exclusiveFieldsFor(t), `${t} 不该有 ${k}`).not.toContain(k);
            }
        }
    });

    it('🔴 游戏专属（平台/开发商/游戏时长）只归游戏；专辑只归音乐', () => {
        expect(exclusiveFieldsFor('game')).toEqual(expect.arrayContaining(['platform', 'developer', 'playtime_minutes']));
        for (const t of ['movie', 'tv', 'anime', 'book', 'music'] as EntryType[]) {
            expect(exclusiveFieldsFor(t)).not.toContain('developer');
            expect(exclusiveFieldsFor(t)).not.toContain('platform');
        }
        expect(exclusiveFieldsFor('music')).toContain('album');
        for (const t of ['movie', 'tv', 'anime', 'book', 'game'] as EntryType[]) {
            expect(exclusiveFieldsFor(t)).not.toContain('album');
        }
    });

    it('🔴 全局 ∪ 专属 ⊆ 该类型适用字段（⛔ 不许凭空多出字段）', () => {
        // ⚠️ 这里**不能**写成「并集 == defaultOrderFor」：`defaultOrderFor` 是按**写出侧**算的
        //    （`author` 对 movie 也在其中，因为写出侧「有值就写」不门控），而界面**只显示**该类型
        //    有意义的字段 ⇒ 并集是 `defaultOrderFor` 的**真子集**，这才是设计意图。
        //    真正要守的是两条：⑴ 界面上出现的键都确实适用（无凭空多出）；⑵ 落盘用的完整数组
        //    仍然是 `defaultOrderFor`（⛔ 别让界面过滤把写出顺序也砍掉 —— 那会让无关字段
        //    在该类型笔记里排到末尾，甚至影响既有笔记的重写顺序）。
        for (const t of FIELD_ORDER_TYPES) {
            const union = [...GLOBAL_FIELD_KEYS, ...exclusiveFieldsFor(t)];
            for (const k of union) {
                expect(defaultOrderFor(t), `${t} 的 ${k} 不适用于该类型`).toContain(k);
            }
            // ⑵ 落盘的完整顺序仍来自 `defaultOrderFor`（界面过滤**只**作用于展示）
            const full = orderForType({}, t);
            expect(full).toEqual(defaultOrderFor(t));
        }
    });

    it('🔴 全局字段在**每个**类型里都在（⛔ 别把全局键从某个类型的落盘顺序里漏掉）', () => {
        for (const t of FIELD_ORDER_TYPES) {
            for (const k of GLOBAL_FIELD_KEYS) {
                expect(orderForType({}, t), `${t} 的落盘顺序缺全局键 ${k}`).toContain(k);
            }
        }
    });

    it('🔴 两道过滤的依据**不是同一个字段**（`types` = 写出侧门控 / `appliesTo` = 语义归属）', () => {
        // 导演：写出侧**不门控**（types 留空），但语义上只属于影视 ⇒ 这正是两者分叉的样本。
        const d = findMetaField('director');
        expect(d?.types, 'director 的 types 必须留空（写出侧本来就不门控）').toBeUndefined();
        expect(d?.appliesTo).toEqual(['movie', 'tv', 'anime']);
        // 专辑：两者都有，且一致（少见的一致样本）
        const a = findMetaField('album');
        expect(a?.types).toEqual(['music']);
        expect(a?.appliesTo).toEqual(['music']);
    });

    it('🔴 未登记的键**保守放行**（说「不适用」会让它从界面凭空消失）', () => {
        expect(fieldAppliesTo('bogus_key_not_registered', 'movie')).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #640e：书籍三个子分类各自的顺序（文学 / 网文 / 漫画）
//   用户：「高级设置-属性分组再新增**文学网文**更明确的分组」→ 裁定「拆成 文学/网文/漫画 三页」
// ══════════════════════════════════════════════════════════════════════════════
describe('#640e 书籍子分类（文学 / 网文 / 漫画）的顺序', () => {
    it('🔴 三个子类**各存各的**：改网文不影响文学与漫画', () => {
        const kindCfg = { novel: ['title', 'author', 'id'] };
        const lit = orderForBookKind({}, kindCfg, 'book');
        const nov = orderForBookKind({}, kindCfg, 'novel');
        const com = orderForBookKind({}, kindCfg, 'comic');
        expect(nov[0]).toBe('title');
        expect(nov[1]).toBe('author');
        // 另两个仍是缺省（首项是 id）
        expect(lit[0]).toBe('id');
        expect(com[0]).toBe('id');
        expect(JSON.stringify(lit)).not.toBe(JSON.stringify(nov));
    });

    it('🔴🔴 **零迁移**：只配过 `fieldOrder.book` 的老用户，三个子类**一起继承**它', () => {
        // 这是本批最关键的兼容判据：老数据只可能有 `fieldOrder`（没有 `fieldOrderByKind`）——
        // 若不回落，升级后用户配好的书籍顺序会在三个子类页里「凭空消失」。
        const legacy = { book: ['title', 'id', 'type'] };
        for (const k of BOOK_KINDS) {
            expect(orderForBookKind(legacy, {}, k).slice(0, 3), `${k} 没继承 fieldOrder.book`).toEqual(['title', 'id', 'type']);
        }
    });

    it('🔴 子类自己那份**优先于** `fieldOrder.book`（回落只在前者缺席时生效）', () => {
        const cfg = { book: ['title', 'id'] };
        const kindCfg = { comic: ['rating', 'id'] };
        expect(orderForBookKind(cfg, kindCfg, 'comic').slice(0, 2)).toEqual(['rating', 'id']);
        expect(orderForBookKind(cfg, kindCfg, 'book').slice(0, 2)).toEqual(['title', 'id']);
    });

    it('🔴 归一：丢未知/不适用键、去重、缺省里有而配置里没有的**补回末尾**', () => {
        const out = normalizeFieldOrderForKind('novel', ['bogus', 'author', 'author', 'title']);
        expect(out.slice(0, 2)).toEqual(['author', 'title']);
        // 书籍那份缺省里的键一个都不许丢
        const d = defaultOrderForBookKind('novel');
        for (const k of d) expect(out).toContain(k);
        expect(out.length).toBe(d.length);
    });

    it('🔴 与缺省逐位一致 ⇒ 判为 default（落盘时删键，将来新增字段能自动落缺省位）', () => {
        expect(isDefaultKindOrder('book', defaultOrderForBookKind('book'))).toBe(true);
        expect(isDefaultKindOrder('book', ['title', ...defaultOrderForBookKind('book').filter((k) => k !== 'title')])).toBe(false);
    });

    it('🔴 `resolveAllKindOrders` 一次算三个（宿主构造时算一次即可）', () => {
        const all = resolveAllKindOrders({}, {});
        expect(Object.keys(all).sort()).toEqual(['book', 'comic', 'novel']);
        for (const k of BOOK_KINDS) expect(all[k]).toEqual(defaultOrderForBookKind(k));
    });

    it('🔴 子类字段集**与书籍同一份**（本批只拆「顺序」，⛔ 没拆字段集）', () => {
        // ⚠️ 这是个**刻意的边界**：用户要的是「更明确的分组」（各排各的顺序），
        //    而不是「文学/网文字段集不同」。若将来真要分字段集，改的是 `defaultOrderForBookKind`，
        //    本测试会红 —— 那时应当**连同断言一起改**，而不是让它悄悄漂移。
        for (const k of BOOK_KINDS) {
            expect(defaultOrderForBookKind(k), k).toEqual(defaultOrderFor('book'));
        }
    });
});
