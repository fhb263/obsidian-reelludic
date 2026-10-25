// 属性顺序「对比预览」位次矩阵（#653，2026-10-19 起 **9 列**）单测
// 契约来源：用户「笔记属性顺序编辑视图，再加个对比视图，如一整个表格滑动并览」
// 2026-10-19 追加：「对比预览的横向分类顺序，严格按数组顺序渲染：
//   ['全局','电影','剧集','动画','文学','网文','漫画','游戏','音乐']」
//   —— 书籍从「一列（book）」拆成 文学 / 网文 / 漫画 三列，因为三者的**字段集**真的分叉了
//      （文学无画师、网文无画师无 ISBN、漫画无 ISBN，见 `pure/fieldOrder.BOOK_KIND_EXCLUDED_FIELDS`）。
import { describe, expect, it } from 'vitest';
import {
    buildFieldOrderCompare,
    fieldLabelOf,
    FIELD_ORDER_COMPARE_COLUMNS,
    type FieldOrderCompare,
} from 'pure/fieldOrderCompare';
import {
    BOOK_KIND_EXCLUDED_FIELDS,
    defaultOrderFor,
    defaultOrderForBookKind,
    GLOBAL_FIELD_KEYS,
} from 'pure/fieldOrder';
import { fieldAppliesTo, META_FIELDS } from 'pure/metaFields';
import { BOOK_KINDS } from 'pure/bookKind';
import type { BookKind, EntryType } from 'data/types';

/**
 * 缺省九份生效顺序，**键 = 列键**（`__global` / `t:*` / `k:*`）——
 * 这正是新版 `buildFieldOrderCompare` 的入参形状：一个列键配一份数组，
 * ⛔ 不再由纯模块按 `EntryType` 自己推导「该取哪一份」。
 */
function defaultOrders(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const c of FIELD_ORDER_COMPARE_COLUMNS) {
        if (c.kind === 'global') out[c.key] = [...GLOBAL_FIELD_KEYS];
        else if (c.kind === 'bookKind' && c.bookKind) out[c.key] = defaultOrderForBookKind(c.bookKind);
        else if (c.type) out[c.key] = defaultOrderFor(c.type);
    }
    return out;
}

/** 取某列全部**有值**的格子（= 该列渲染出来的字段序列） */
function columnKeys(cmp: FieldOrderCompare, key: string): string[] {
    return cmp.rows
        .map((r) => r.cells[key])
        .filter((k): k is string => typeof k === 'string' && k.length > 0);
}

/** 该列**允许**出现的字段集（判据与实现同源，但这里是独立重写的期望值） */
function allowedFor(c: { kind?: string; type?: EntryType; bookKind?: BookKind }): string[] {
    if (c.kind === 'bookKind' && c.bookKind) {
        const excluded = BOOK_KIND_EXCLUDED_FIELDS[c.bookKind];
        // 🔴 书籍子列 = 大类 `appliesTo:['book']` 的字段 **再减掉**该子类的排除键
        return META_FIELDS.filter((f) => fieldAppliesTo(f.key, 'book') && !excluded.includes(f.key)).map((f) => f.key);
    }
    if (c.kind === 'type' && c.type) {
        return META_FIELDS.filter((f) => fieldAppliesTo(f.key, c.type as EntryType)).map((f) => f.key);
    }
    return [...GLOBAL_FIELD_KEYS];
}

describe('fieldOrderCompare · 列（9 列，顺序由用户冻结）', () => {
    it('🔴 九列 key 按固定顺序：全局 → 影视三兄弟 → 书三兄弟 → 游戏 → 音乐', () => {
        expect(FIELD_ORDER_COMPARE_COLUMNS.map((c) => c.key)).toEqual([
            '__global',
            't:movie',
            't:tv',
            't:anime',
            'k:book',
            'k:novel',
            'k:comic',
            't:game',
            't:music',
        ]);
    });

    it('🔴 列头文案**逐字**对上用户点名的顺序', () => {
        expect(FIELD_ORDER_COMPARE_COLUMNS.map((c) => c.label)).toEqual([
            '全局', '电影', '剧集', '动画', '文学', '网文', '漫画', '游戏', '音乐',
        ]);
    });

    it('书的列头取**子类名**（文学/网文/漫画），⛔ 不是大类的「书籍」', () => {
        for (const k of BOOK_KINDS) {
            const col = FIELD_ORDER_COMPARE_COLUMNS.find((c) => c.key === `k:${k}`);
            expect(col, `缺 k:${k} 列`).toBeTruthy();
            expect(col?.bookKind).toBe(k);
        }
        expect(FIELD_ORDER_COMPARE_COLUMNS.map((c) => c.label)).not.toContain('书籍');
    });
});

describe('fieldOrderCompare · 行是**位次**不是字段', () => {
    it('行数 = 最长那一列的字段数（不是九列字段并集）', () => {
        const cmp = buildFieldOrderCompare(defaultOrders());
        const maxLen = Math.max(...Object.values(cmp.sizes));
        expect(cmp.rows.length).toBe(maxLen);
        // 🔴 反向守卫：行的取值个数必须**少于**九列字段并集 —— 按并集做行就是稀疏矩阵
        //    （用户要的是「第 3 位在各类里分别是谁」，逐行对齐着读）
        const union = new Set<string>();
        for (const c of cmp.columns) for (const k of columnKeys(cmp, c.key)) union.add(k);
        expect(union.size).toBeGreaterThan(cmp.rows.length);
    });

    it('每行位次连续 1..N，且格子内容 = 该列（滤过后）的第 N 位（缺位为 null，⛔ 不拿别的字段补）', () => {
        const orders = defaultOrders();
        const cmp = buildFieldOrderCompare(orders);
        cmp.rows.forEach((row, i) => expect(row.rank).toBe(i + 1));
        for (const c of cmp.columns) {
            // 🔴 列 = 生效顺序里**滤掉不属于该列字段集**的键（不是 42 键全量表原样搬过来）
            const list = columnKeys(cmp, c.key);
            for (const row of cmp.rows) {
                expect(row.cells[c.key]).toBe(list[row.rank - 1] ?? null);
            }
        }
    });

    it('短分组在长分组末尾的位次上是空位（null），不是空串', () => {
        const cmp = buildFieldOrderCompare(defaultOrders());
        const shortest = cmp.columns.reduce((a, b) => (cmp.sizes[a.key] <= cmp.sizes[b.key] ? a : b));
        const lastRow = cmp.rows[cmp.rows.length - 1];
        expect(lastRow.cells[shortest.key]).toBeNull();
    });
});

describe('fieldOrderCompare · 取数口径（每列只取它自己那份数组）', () => {
    it('不传全局次序 ⇒ 用 `orders.__global` / 缺省时回落 `GLOBAL_FIELD_KEYS` 登记序', () => {
        const cmp = buildFieldOrderCompare(defaultOrders());
        expect(columnKeys(cmp, '__global')).toEqual([...GLOBAL_FIELD_KEYS]);
        // 连 `orders.__global` 都不给（空对象）⇒ 回落缺省，⛔ 不是空列
        const bare = buildFieldOrderCompare({});
        expect(columnKeys(bare, '__global')).toEqual([...GLOBAL_FIELD_KEYS]);
    });

    it('传了全局次序 ⇒ 用它（对比表要反映**用户配过的**次序，不是缺省序）', () => {
        const reversed = [...GLOBAL_FIELD_KEYS].reverse();
        const cmp = buildFieldOrderCompare(defaultOrders(), reversed);
        expect(columnKeys(cmp, '__global')).toEqual(reversed);
    });

    it('🔴 每列只取**该列键对应的数组**（不再由纯模块按 EntryType 推导）', () => {
        const orders = defaultOrders();
        // 把电影那列的次序整体反转：只有 `t:movie` 变，别的列不受影响
        orders['t:movie'] = [...orders['t:movie']].reverse();
        const cmp = buildFieldOrderCompare(orders);
        expect(columnKeys(cmp, 't:movie')).toEqual(
            orders['t:movie'].filter((k) => fieldAppliesTo(k, 'movie')),
        );
        expect(columnKeys(cmp, 't:tv')).toEqual(
            defaultOrderFor('tv').filter((k) => fieldAppliesTo(k, 'tv')),
        );
        // 书籍三列也不该被电影那一份带跑（⚠️ 期望值要按该子类收窄后再比，
        // `defaultOrderForBookKind` 是**大类口径**的完整顺序，含电影/游戏专属字段）
        for (const k of BOOK_KINDS) {
            expect(columnKeys(cmp, `k:${k}`), k).toEqual(
                defaultOrderForBookKind(k).filter((x) => fieldAppliesTo(x, 'book')),
            );
        }
    });

    it('每列只剩**该分组真会写出**的字段（`defaultOrderFor` 的 42 键全量表必须被收窄）', () => {
        const orders = defaultOrders();
        const cmp = buildFieldOrderCompare(orders);
        const col = 't:movie';
        expect(orders[col].length).toBeGreaterThan(cmp.sizes[col]);
        const allowed = allowedFor({ kind: 'type', type: 'movie' });
        expect(columnKeys(cmp, col)).toEqual(orders[col].filter((k) => allowed.includes(k)));
    });

    it('🔴 反向守卫：任何一列都不许出现不属于该列字段集的键（否则九列会退化成同一列抄九遍）', () => {
        const cmp = buildFieldOrderCompare(defaultOrders());
        for (const c of cmp.columns) {
            if (c.kind === 'global') continue;
            const allowed = allowedFor({ kind: c.kind, type: c.type, bookKind: c.bookKind });
            for (const row of cmp.rows) {
                const k = row.cells[c.key];
                if (k) expect(allowed, `${c.label} 列出现了不该有的 ${k}`).toContain(k);
            }
        }
        // 书籍专属（ISBN）绝不能出现在电影列；剧集专属（季 / 集）绝不能出现在音乐列
        expect(columnKeys(cmp, 't:movie')).not.toContain('isbn');
        expect(columnKeys(cmp, 't:music')).not.toContain('progress_season');
    });

    it('缺某列的顺序 ⇒ 回落该列缺省（⛔ 不能变成空列）', () => {
        const partial = { 't:movie': defaultOrderFor('movie') };  // 其余八列全缺
        const cmp = buildFieldOrderCompare(partial);
        const musicDefaults = defaultOrderFor('music').filter((k) => fieldAppliesTo(k, 'music'));
        expect(cmp.sizes['t:music']).toBe(musicDefaults.length);
        expect(cmp.rows[0].cells['t:music']).toBe(musicDefaults[0]);
        // 书籍子列同样回落**子类**缺省（不是书籍大类）
        expect(columnKeys(cmp, 'k:novel')).toEqual(
            defaultOrderForBookKind('novel').filter((k) => fieldAppliesTo(k, 'book')),
        );
    });

    it('脏数据（旧配置里排进了子类排除键）⇒ 在对比表里被滤掉', () => {
        const orders = defaultOrders();
        orders['k:novel'] = ['title', 'isbn', 'artist', 'author'];  // 用户旧数据里排进来的
        orders['k:book'] = ['title', 'artist', 'isbn'];
        const cmp = buildFieldOrderCompare(orders);
        expect(columnKeys(cmp, 'k:novel')).toEqual(['title', 'author']);
        expect(columnKeys(cmp, 'k:book')).toEqual(['title', 'isbn']);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔴 2026-10-19 用户裁定：书籍三子类的**字段集真的分叉**（这是拆列的**唯一**理由）
//    若将来有人想「把三列合回一列」，先看这组断言：合回去就再也表达不出下面四条差异。
// ══════════════════════════════════════════════════════════════════════════════
describe('fieldOrderCompare · 书籍三列的字段集差异（拆列的理由）', () => {
    const cmp = buildFieldOrderCompare(defaultOrders());

    it('🔴 文学列**不含**画师（文学是纯文字作品）', () => {
        expect(columnKeys(cmp, 'k:book')).not.toContain('artist');
    });

    it('🔴 网文列**既不含**画师**也不含** ISBN（网络连载：无作画者、无实体书号）', () => {
        expect(columnKeys(cmp, 'k:novel')).not.toContain('artist');
        expect(columnKeys(cmp, 'k:novel')).not.toContain('isbn');
        // 🔴 2026-10-21（用户字段表）：网文按**字数**计量 ⇒ 出版社/译者/装帧/定价/页数一并退场
        for (const k of ['publisher', 'translator', 'binding', 'price', 'reading_total_page', 'reading_page']) {
            expect(columnKeys(cmp, 'k:novel'), `网文列不该有 ${k}`).not.toContain(k);
        }
    });

    it('🔴 漫画列**不含** ISBN（单行本走出版社 / 装帧那一套）', () => {
        expect(columnKeys(cmp, 'k:comic')).not.toContain('isbn');
    });

    it('🔴 反向：文学列**含** ISBN（已出版实体书）、漫画列**含**画师', () => {
        expect(columnKeys(cmp, 'k:book')).toContain('isbn');
        expect(columnKeys(cmp, 'k:comic')).toContain('artist');
    });

    it('三列内容互不相同（合回一列会丢掉差异）', () => {
        const lit = columnKeys(cmp, 'k:book');
        const nov = columnKeys(cmp, 'k:novel');
        const com = columnKeys(cmp, 'k:comic');
        expect(nov).not.toEqual(lit);
        expect(com).not.toEqual(lit);
        expect(nov).not.toEqual(com);
        // 差额 = 两个子类排除表之差（⛔ 不写死数字：排除表一改这条就假红/假绿）
        const diff = BOOK_KIND_EXCLUDED_FIELDS.novel.length - BOOK_KIND_EXCLUDED_FIELDS.book.length;
        expect(cmp.sizes['k:novel']).toBe(cmp.sizes['k:book'] - diff);
    });
});

describe('fieldOrderCompare · 2026-10-21 按用户字段表重置后的列名（labelFor）', () => {
    const cmp = buildFieldOrderCompare(defaultOrders());

    it('🔴 音乐列的作者位显示「艺术家」、动画列的 developer 显示「制作公司」', () => {
        // 键是同一个（`author` / `developer`），只有**显示名**跟着类型变 —— 见 `metaFields.labelFor`
        expect(columnKeys(cmp, 't:music')).toContain('author');
        expect(fieldLabelOf('author', 'music')).toBe('艺术家');
        expect(fieldLabelOf('author', 'book')).toBe('作者');
        expect(fieldLabelOf('developer', 'anime')).toBe('制作公司');
        expect(fieldLabelOf('developer', 'game')).toBe('开发商');
        expect(fieldLabelOf('duration_min', 'tv')).toBe('单集片长');
        expect(fieldLabelOf('duration_min', 'movie')).toBe('片长（分钟）');
    });
});

describe('fieldOrderCompare · 中文名', () => {
    it('已知键 → 中文名；空位 → 空串；未知键 → 原样回显（⛔ 不抛）', () => {
        expect(fieldLabelOf('rating')).toBe('个人评分');
        expect(fieldLabelOf(null)).toBe('');
        expect(fieldLabelOf('__nope__')).toBe('__nope__');
    });
});
