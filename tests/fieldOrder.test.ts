// 笔记属性顺序（pure/fieldOrder）单测 —— 1.3.1 ① 第 3 件
//
// 契约来源（用户 2026-10-12）：「新增高级设置-支持新增条目前各类型笔记属性排序」
// 关键口径：**按类型分开配** / **只排序不增删** / **缺省 = 现有写出顺序** / 未登记键落到末尾且不丢。
import { describe, it, expect } from 'vitest';
import {
    BOOK_KIND_EXCLUDED_FIELDS,
    FIELD_ORDER_TYPES,
    GLOBAL_FIELD_KEYS,
    applyFieldOrder,
    defaultOrderFor,
    defaultOrderForBookKind,
    exclusiveFieldsFor,
    exclusiveFieldsForBookKind,
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
import { META_FIELDS, META_FIELD_KEYS, fieldAppliesTo, findMetaField, labelOf } from 'pure/metaFields';
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

    it('🔴 书籍专属（ISBN/出版社/译者/装帧/定价）⛔ 不出现在影视/游戏/音乐页', () => {
        // ⚠️ 2026-10-21 起 `author` **不再是书籍专属**：音乐那一列的「艺术家」就是 `author`
        //    （用户表把音乐的「艺术家」与书籍的「作者」写在同一格语义上，表单 creator 也取 author）。
        //    ⇒ 这里的 key 清单里删掉了 `author`，它对音乐/书籍都成立（见下一条用例）。
        for (const k of ['isbn', 'publisher', 'translator', 'binding', 'price']) {
            expect(exclusiveFieldsFor('book'), `书籍页该有 ${k}`).toContain(k);
            for (const t of ['movie', 'tv', 'anime', 'game', 'music'] as EntryType[]) {
                expect(exclusiveFieldsFor(t), `${t} 不该有 ${k}`).not.toContain(k);
            }
        }
        // 书籍页当然还有作者；音乐页的「作者位」也是它，只是显示成「艺术家」
        expect(exclusiveFieldsFor('book')).toContain('author');
        expect(exclusiveFieldsFor('music')).toContain('author');
    });

    it('🔴 游戏专属（平台/游戏时长）只归游戏；开发商归游戏+动画；专辑只归音乐', () => {
        expect(exclusiveFieldsFor('game')).toEqual(expect.arrayContaining(['platform', 'playtime_minutes', 'developer']));
        expect(exclusiveFieldsFor('game')).toContain('producer');
        // 🔴 2026-10-21：`developer` 在动画那一列显示为「制作公司」（正文那行取的同一个键）
        expect(exclusiveFieldsFor('anime')).toContain('developer');
        expect(labelOf('developer', 'anime')).toBe('制作公司');
        expect(labelOf('developer', 'game')).toBe('开发商');
        for (const t of ['movie', 'tv', 'book', 'music'] as EntryType[]) {
            expect(exclusiveFieldsFor(t), `${t} 不该有 developer`).not.toContain('developer');
        }
        for (const t of ['movie', 'tv', 'anime', 'book', 'music'] as EntryType[]) {
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

    it('🔴 子类字段集**不再**与书籍同一份（2026-10-19 用户裁定：画师 / ISBN 真的分叉了）', () => {
        // ⚠️ 沿革：本用例此前钉的是「三个子类字段集与 `defaultOrderFor('book')` **完全相同**」
        //    （#640e 只拆了「各排各的顺序」）。2026-10-19 用户裁定字段集也分叉：
        //      文学无画师 / 网文无画师无 ISBN / 漫画无 ISBN ⇒ 那条断言整体翻面。
        //    ⛔ 别把它改回去：合回一份会让「网文笔记里出现 ISBN」重新变成可能。
        for (const k of BOOK_KINDS) {
            expect(defaultOrderForBookKind(k), k).not.toEqual(defaultOrderFor('book'));
        }
        // 差别**恰好**是排除表那几条（多一个 / 少一个都不行）
        for (const k of BOOK_KINDS) {
            expect(defaultOrderForBookKind(k).length, k).toBe(
                defaultOrderFor('book').length - BOOK_KIND_EXCLUDED_FIELDS[k].length,
            );
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-19 用户裁定：书籍三子类的**字段集**分叉
//   用户原话：「文学」「网文」分类下不该出现画师（画师只属漫画）；
//            「网文」分类下不该出现 ISBN（ISBN 是出版实体书特有 ⇒ 文学 / 漫画留，网文去）。
//   两个字段的语义归属：`artist` = 漫画单行本的作画者；`isbn` = 已出版实体书的书号
//   （网文是网络连载，走上架年 / 元数据章数那一套）。
// ══════════════════════════════════════════════════════════════════════════════
describe('书籍三子类字段集分叉（2026-10-19 画师/ISBN → 2026-10-21 严格按用户字段表）', () => {
    it('排除表口径：文学无画师；网文只剩作者+阅读时长；漫画无 ISBN', () => {
        expect([...BOOK_KIND_EXCLUDED_FIELDS.book]).toEqual(['artist']);
        // 🔴 2026-10-21（用户字段表）网文那一列 = 作者 / 首发平台 / 连载状态 / 字数 / 已读字数 / 阅读时长
        //    ⇒ 出版物那套（ISBN/出版社/译者/装帧/定价）与按页计的进度（总页数/已读页数）全部排除。
        expect([...BOOK_KIND_EXCLUDED_FIELDS.novel]).toEqual([
            'artist', 'isbn', 'translator', 'publisher', 'binding', 'price',
            'reading_total_page', 'reading_page', 'page_count',
        ]);
        expect([...BOOK_KIND_EXCLUDED_FIELDS.comic]).toEqual(['isbn']);
    });

    it('🔴 exclusiveFieldsForBookKind = 大类专属字段 − 该子类排除键（顺序沿用 META_FIELDS 登记序）', () => {
        const base = exclusiveFieldsFor('book');
        for (const k of BOOK_KINDS) {
            expect(exclusiveFieldsForBookKind(k), k).toEqual(
                base.filter((x) => !BOOK_KIND_EXCLUDED_FIELDS[k].includes(x)),
            );
        }
        // 该去的去
        expect(exclusiveFieldsForBookKind('book')).not.toContain('artist');
        expect(exclusiveFieldsForBookKind('novel')).not.toContain('artist');
        expect(exclusiveFieldsForBookKind('novel')).not.toContain('isbn');
        expect(exclusiveFieldsForBookKind('comic')).not.toContain('isbn');
        // 该留的留（反向守卫：⛔ 别把整类书籍字段一起滤掉）
        expect(exclusiveFieldsForBookKind('book')).toContain('isbn');
        expect(exclusiveFieldsForBookKind('comic')).toContain('artist');
        expect(exclusiveFieldsForBookKind('book')).toContain('publisher');
        expect(exclusiveFieldsForBookKind('comic')).toContain('publisher');
        for (const k of BOOK_KINDS) {
            expect(exclusiveFieldsForBookKind(k), `${k} 丢了 author`).toContain('author');
            expect(exclusiveFieldsForBookKind(k), `${k} 丢了 read_minutes`).toContain('read_minutes');
        }
    });

    it('🔴 defaultOrderForBookKind = defaultOrderFor(book) − 排除键（三份**不再**同一份）', () => {
        const base = defaultOrderFor('book');
        for (const k of BOOK_KINDS) {
            expect(defaultOrderForBookKind(k), k).toEqual(
                base.filter((x) => !BOOK_KIND_EXCLUDED_FIELDS[k].includes(x)),
            );
        }
        // 文学与漫画**字段数相同、内容不同**（各自少一个，少的不是同一个键）
        expect(defaultOrderForBookKind('book').length).toBe(defaultOrderForBookKind('comic').length);
        expect(defaultOrderForBookKind('book')).not.toEqual(defaultOrderForBookKind('comic'));
        // 网文少 9 个（排除表那 9 条全都真的在书籍缺省序里 ⇒ 减得掉）
        expect(defaultOrderForBookKind('novel').length).toBe(base.length - 9);
    });

    it('🔴 归一只按**子类**收窄：文学排进 artist / 网文排进 isbn ⇒ 被清掉', () => {
        const lit = normalizeFieldOrderForKind('book', ['title', 'artist', 'author']);
        expect(lit).not.toContain('artist');
        expect(lit.slice(0, 2)).toEqual(['title', 'author']);
        const nov = normalizeFieldOrderForKind('novel', ['title', 'isbn', 'artist']);
        expect(nov).not.toContain('isbn');
        expect(nov).not.toContain('artist');
        expect(nov[0]).toBe('title');
        // 漫画反过来：留 artist、去 isbn
        const com = normalizeFieldOrderForKind('comic', ['title', 'isbn', 'artist']);
        expect(com).not.toContain('isbn');
        expect(com).toContain('artist');
    });

    it('🔴🔴 `orderForBookKind` 回落必须按子类过滤：`fieldOrder.book` 里排进了 isbn ⇒ 网文取出来不含 isbn', () => {
        // 这是本轮最容易漏、后果最重的一条：回落那一跳若直接 `return orderForType(cfg,'book')`，
        // 排除表对「只配过书籍、从没配过子类」的**绝大多数用户**完全失效（`fieldOrderByKind`
        // 是 2026-10-19 才出现的键，此前所有用户的书籍顺序都在 `fieldOrder.book` 里）。
        // ⚠️ `fieldOrder.book` 的归一**允许** isbn（isbn 属于 book 大类）⇒ 它真能带着 isbn 进来。
        const legacy = { book: ['isbn', 'title', 'id', 'artist'] };
        expect(orderForType(legacy, 'book').slice(0, 3), '大类那一份确实带着 isbn').toEqual(['isbn', 'title', 'id']);

        const nov = orderForBookKind(legacy, {}, 'novel');
        expect(nov).not.toContain('isbn');
        expect(nov).not.toContain('artist');
        const lit = orderForBookKind(legacy, {}, 'book');
        expect(lit).not.toContain('artist');
        expect(lit).toContain('isbn');           // 文学有 ISBN（已出版实体书）
        const com = orderForBookKind(legacy, {}, 'comic');
        expect(com).toContain('artist');         // 漫画有画师
        expect(com).not.toContain('isbn');

        // 且**补齐**到该子类的完整缺省集（回落过滤⛔ 不是把字段砍掉不补）
        for (const k of BOOK_KINDS) {
            const got = orderForBookKind(legacy, {}, k);
            expect([...got].sort(), k).toEqual([...defaultOrderForBookKind(k)].sort());
        }
        // 子类自己配过的那一份也要收窄（同样的排除表，⛔ 两套口径）
        const dirty = { novel: ['title', 'isbn'] };
        expect(orderForBookKind({}, dirty, 'novel')).not.toContain('isbn');
        expect(orderForBookKind({}, dirty, 'novel')[0]).toBe('title');
    });

    it('大类的既有口径**不动**：`orderForType` / `exclusiveFieldsFor` 仍用 book 那一份（别处还在用）', () => {
        const cfg = { book: ['isbn', 'title'] };
        expect(orderForType(cfg, 'book').slice(0, 2)).toEqual(['isbn', 'title']);
        expect(exclusiveFieldsFor('book')).toContain('artist');
        expect(exclusiveFieldsFor('book')).toContain('isbn');
        // `FIELD_ORDER_TYPES` 仍是六类（⛔ 别把子类塞进来）
        expect([...FIELD_ORDER_TYPES]).toEqual(['movie', 'tv', 'anime', 'book', 'game', 'music']);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2026-10-21 用户裁定：**字段字典严格按表重置**（各媒体类型的属性字段 + 横向排序）
//   用户原话：「严格按表重置各媒体类型的属性字段及横向排序，修复网文等类型的冗余/错配字段」。
//   🔴 这张表就是**唯一真源**：`META_FIELDS` 的登记序 = 横向顺序（设置页每一页、九列对比、
//      笔记 frontmatter 写出序全都从它派生），所以这组用例一旦红了，用户看到的顺序就歪了。
//   ⚠️ 表里还有 12 个字段位本仓**没有任何数据通道**（出版年 / 首发平台 / 连载状态 / 字数 /
//      已读字数 / 卷数 / 上映日期 / 首播年份 / 发售日期 / 发行日期 / 流派 / 介质 / 曲目数），
//      下面这些期望值 = **表里能用现有键表达的那部分**，顺序与表逐位一致（缺的那几个就是没有）。
// ══════════════════════════════════════════════════════════════════════════════
describe('2026-10-21 字段字典按用户表重置（字段集 + 横向顺序）', () => {
    const TABLE: Record<string, string[]> = {
        // 全局（六类通用）
        global: ['id', 'type', 'title', 'banner', 'year', 'genres', 'series', 'series_index',
            'status', 'rating', 'tags', 'aliases', 'planned_date', 'watched_date', 'created', 'updated'],
        // 电影：导演、编剧、主演、制片国家、语言、上映日期(缺)、片长、出品方
        movie: ['director', 'screenwriter', 'cast', 'country', 'language', 'duration_min', 'producer'],
        // 剧集：导演、编剧、主演、制片国家、语言、首播年份(缺)、季、总集数、已看集数、单集片长、出品方、进度百分比
        tv: ['director', 'screenwriter', 'cast', 'country', 'language', 'progress_season',
            'progress_total_episodes', 'progress_episode', 'duration_min', 'producer', 'progress_percent'],
        // 动画：导演、编剧、主演/声优、制作公司、制片国家、语言、季、总集数、已看集数、单集片长、进度百分比
        anime: ['director', 'screenwriter', 'cast', 'developer', 'country', 'language', 'progress_season',
            'progress_total_episodes', 'progress_episode', 'duration_min', 'progress_percent'],
        // 游戏：开发商、出品方、平台、发售日期(缺)、游戏时长、进度百分比
        game: ['developer', 'producer', 'platform', 'playtime_minutes', 'progress_percent'],
        // 音乐：艺术家(= author)、专辑、发行日期(缺)、流派(缺)、介质(缺)、曲目数(缺)
        music: ['author', 'album'],
        // 文学：作者、译者、出版社、ISBN、装帧、定价、出版年(缺)、总页数、已读页数、阅读时长
        book: ['author', 'translator', 'publisher', 'isbn', 'binding', 'price',
            'reading_total_page', 'reading_page', 'read_minutes', 'page_count'],
        // 网文：作者、首发平台(缺)、连载状态(缺)、字数(缺)、已读字数(缺)、阅读时长
        novel: ['author', 'read_minutes'],
        // 漫画：作者、画师、译者、出版社、装帧、定价、卷数(缺)、连载状态(缺)、总页数、已读页数、阅读时长
        comic: ['author', 'artist', 'translator', 'publisher', 'binding', 'price',
            'reading_total_page', 'reading_page', 'read_minutes', 'page_count'],
    };

    it('🔴 全局页 = 表里「全局」那一行（逐位相等）', () => {
        expect([...GLOBAL_FIELD_KEYS]).toEqual(TABLE.global);
    });

    it('🔴 六个类型的专属页 = 表里对应那一行（逐位相等，含横向顺序）', () => {
        // ⚠️ 类型页 'book' 是**大类**口径（含画师 = 漫画才有的那个键），
        //    「文学」是它的**子类**页（排除画师）—— 两者不是同一份清单，见下一条用例。
        const BOOK_TYPE = ['author', 'artist', 'translator', 'publisher', 'isbn', 'binding', 'price',
            'reading_total_page', 'reading_page', 'read_minutes', 'page_count'];
        for (const t of FIELD_ORDER_TYPES) {
            expect(exclusiveFieldsFor(t), t).toEqual(t === 'book' ? BOOK_TYPE : TABLE[t]);
        }
    });

    it('🔴 三个书籍子类的专属页 = 表里对应那一行（逐位相等）', () => {
        for (const k of BOOK_KINDS) {
            expect(exclusiveFieldsForBookKind(k), k).toEqual(TABLE[k]);
        }
    });

    it('🔴 显示名按类型变：作者↔艺术家、开发商↔制作公司、片长↔单集片长', () => {
        expect(labelOf('author', 'book')).toBe('作者');
        expect(labelOf('author', 'music')).toBe('艺术家');
        expect(labelOf('developer', 'game')).toBe('开发商');
        expect(labelOf('developer', 'anime')).toBe('制作公司');
        expect(labelOf('duration_min', 'movie')).toBe('片长（分钟）');
        expect(labelOf('duration_min', 'tv')).toBe('单集片长');
        expect(labelOf('duration_min', 'anime')).toBe('单集片长');
        // 不给类型 ⇒ 缺省名；未登记键 ⇒ 原样回显
        expect(labelOf('author')).toBe('作者');
        expect(labelOf('__nope__')).toBe('__nope__');
    });

    it('🔴 缺的那 12 个字段位**一个都不许**先占坑（表里有、代码没有 ⇒ 就是没有）', () => {
        // 一旦有人为了「表好看」把空键登记进来，用户就会看到永远填不上的行 ⇒ 这条守着它。
        for (const k of ['pub_year', 'serial_platform', 'serial_status', 'word_count', 'words_read',
            'volume_count', 'release_date', 'first_air_date', 'sale_date', 'issue_date',
            'music_genre', 'medium', 'track_count']) {
            expect(findMetaField(k), `${k} 不该被登记`).toBeUndefined();
        }
    });

    it('🔴 没有键落在体系外：全局 ∪ 六类专属 = 全部登记键，且无重复', () => {
        const seen = new Set<string>(GLOBAL_FIELD_KEYS);
        expect(seen.size, '全局清单里有重复键').toBe(GLOBAL_FIELD_KEYS.length);
        for (const t of FIELD_ORDER_TYPES) {
            for (const k of exclusiveFieldsFor(t)) seen.add(k);
        }
        expect([...seen].sort()).toEqual([...META_FIELD_KEYS].sort());
        expect(META_FIELDS.length).toBe(META_FIELD_KEYS.length);
        expect(new Set(META_FIELD_KEYS).size).toBe(META_FIELDS.length);
    });
});
