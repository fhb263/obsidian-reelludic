// #635 关联图谱纯模块：落库归一 / 关系词取反 / 出入边镜像 / 放射状布局几何。
// 🔴 纯函数行为一律走**单元级**（产物里看不见）。
import { describe, it, expect } from 'vitest';
import {
    GRAPH_FALLBACK_H,
    GRAPH_FALLBACK_W,
    GRAPH_MAX_READABLE,
    GRAPH_PADDING,
    MAX_NODE_R,
    MIN_NODE_R,
    RADIAL_ALT_MIN,
    RADIAL_ALT_RATIO,
    REL_DEFAULT_LABEL,
    REL_LABEL_MAX,
    REL_LABEL_SUGGESTIONS,
    REL_MIRROR_LABEL,
    collectRelated,
    graphLayout,
    invertRelLabel,
    normalizeRelatedLink,
    normalizeRelatedList,
    normalizeRelLabel,
    relLabelInvertPairs,
} from 'pure/relatedGraph';
import type { MediaEntry, RelatedLink } from 'data/types';

/** 造一条最小可用条目（只填算法会读的字段） */
function entry(id: string, extra: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id,
        type: 'music',
        title: `标题-${id}`,
        status: 'watched',
        rating: 4,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    };
}

describe('normalizeRelLabel —— 关系词归一', () => {
    it('非字符串一律 undefined（不抛）', () => {
        expect(normalizeRelLabel(undefined)).toBeUndefined();
        expect(normalizeRelLabel(null)).toBeUndefined();
        expect(normalizeRelLabel(42)).toBeUndefined();
        expect(normalizeRelLabel({})).toBeUndefined();
    });

    it('trim + 折内部空白', () => {
        expect(normalizeRelLabel('  原唱  ')).toBe('原唱');
        expect(normalizeRelLabel('现场  版')).toBe('现场 版');
        expect(normalizeRelLabel('a\tb\nc')).toBe('a b c');
    });

    it('纯空白 ⇒ undefined（⛔ 不落空串 —— 「留空 = 关联」的判据只判一次）', () => {
        expect(normalizeRelLabel('')).toBeUndefined();
        expect(normalizeRelLabel('   ')).toBeUndefined();
        expect(normalizeRelLabel('\n\t')).toBeUndefined();
    });

    it('超长按码点截断到上限（emoji 不切碎代理对）', () => {
        const long = '一'.repeat(REL_LABEL_MAX + 10);
        expect(Array.from(normalizeRelLabel(long) ?? '').length).toBe(REL_LABEL_MAX);
        const emoji = '🎵'.repeat(REL_LABEL_MAX + 5);
        const out = normalizeRelLabel(emoji) ?? '';
        expect(Array.from(out).length).toBe(REL_LABEL_MAX);
        expect(out).toBe('🎵'.repeat(REL_LABEL_MAX)); // 没有孤立代理项
    });
});

describe('invertRelLabel —— 取反（裁定 ③：成对 + 表外兜底）', () => {
    it('表内命中逐对取反', () => {
        expect(invertRelLabel('原唱')).toBe('翻唱');
        expect(invertRelLabel('翻唱')).toBe('原唱');
        expect(invertRelLabel('改编')).toBe('原作');
        expect(invertRelLabel('原作')).toBe('改编');
        expect(invertRelLabel('续作')).toBe('前作');
        expect(invertRelLabel('前作')).toBe('续作');
    });

    it('取反两次回到原词（表必须对称）', () => {
        for (const [a, b] of relLabelInvertPairs()) {
            expect(invertRelLabel(b)).toBe(a);
            expect(invertRelLabel(invertRelLabel(a))).toBe(a);
        }
    });

    it('表外 / 空 ⇒ 「被关联」（⛔ 不猜）', () => {
        expect(invertRelLabel('同曲')).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel('现场版')).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel('随便写的词')).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel(undefined)).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel('')).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel('  ')).toBe(REL_MIRROR_LABEL);
    });

    it('不做模糊匹配：「翻唱（Live）」不是「翻唱」', () => {
        expect(invertRelLabel('翻唱（Live）')).toBe(REL_MIRROR_LABEL);
        expect(invertRelLabel('原唱版')).toBe(REL_MIRROR_LABEL);
    });

    it('取反前后 trim（写入端已 trim，读取端仍宽进）', () => {
        expect(invertRelLabel(' 原唱 ')).toBe('翻唱');
    });

    it('建议词表非空且都是字符串（它只是建议，不是白名单）', () => {
        expect(REL_LABEL_SUGGESTIONS.length).toBeGreaterThan(0);
        for (const s of REL_LABEL_SUGGESTIONS) expect(typeof s).toBe('string');
    });
});

describe('normalizeRelatedLink —— 单项归一', () => {
    it('非对象 / id 非字符串 / id 空 ⇒ undefined', () => {
        expect(normalizeRelatedLink(null)).toBeUndefined();
        expect(normalizeRelatedLink('e_x')).toBeUndefined();
        expect(normalizeRelatedLink(123)).toBeUndefined();
        expect(normalizeRelatedLink({})).toBeUndefined();
        expect(normalizeRelatedLink({ id: 42 })).toBeUndefined();
        expect(normalizeRelatedLink({ id: '   ' })).toBeUndefined();
    });

    it('id 前后空白被 trim', () => {
        expect(normalizeRelatedLink({ id: '  e_a  ' })).toEqual({ id: 'e_a' });
    });

    it('label 空 ⇒ 不落这个键（不是落空串）', () => {
        const r = normalizeRelatedLink({ id: 'e_a', label: '   ' });
        expect(r).toEqual({ id: 'e_a' });
        expect(Object.prototype.hasOwnProperty.call(r, 'label')).toBe(false);
    });

    it('label 归一后透传', () => {
        expect(normalizeRelatedLink({ id: 'e_a', label: ' 翻唱 ' })).toEqual({ id: 'e_a', label: '翻唱' });
    });

    it('自环丢（指向自己）', () => {
        expect(normalizeRelatedLink({ id: 'e_self' }, 'e_self')).toBeUndefined();
        expect(normalizeRelatedLink({ id: 'e_other' }, 'e_self')).toEqual({ id: 'e_other' });
    });
});

describe('normalizeRelatedList —— 落库唯一收口点', () => {
    it('非数组 ⇒ undefined（⛔ 不落 []）', () => {
        expect(normalizeRelatedList(undefined)).toBeUndefined();
        expect(normalizeRelatedList(null)).toBeUndefined();
        expect(normalizeRelatedList({})).toBeUndefined();
        expect(normalizeRelatedList('e_a')).toBeUndefined();
    });

    it('空数组 ⇒ undefined', () => {
        expect(normalizeRelatedList([])).toBeUndefined();
    });

    it('脏项单丢，不整批废（一项脏不该吃掉其它手填项）', () => {
        const out = normalizeRelatedList([null, { id: 'e_a' }, 'x', { id: '' }, { id: 'e_b', label: '前作' }]);
        expect(out).toEqual([{ id: 'e_a' }, { id: 'e_b', label: '前作' }]);
    });

    it('同 id 重复 ⇒ 后写的赢（值覆盖，位置留首次）', () => {
        const out = normalizeRelatedList([
            { id: 'e_a', label: '原唱' },
            { id: 'e_b' },
            { id: 'e_a', label: '翻唱' },
        ]);
        expect(out).toEqual([{ id: 'e_a', label: '翻唱' }, { id: 'e_b' }]);
    });

    it('全脏 ⇒ undefined', () => {
        expect(normalizeRelatedList([null, { id: ' ' }, 3])).toBeUndefined();
    });

    it('自环剔除', () => {
        expect(normalizeRelatedList([{ id: 'e_self' }, { id: 'e_a' }], 'e_self')).toEqual([{ id: 'e_a' }]);
    });

    it('幂等：归一两次与一次相同', () => {
        const once = normalizeRelatedList([{ id: ' e_a ', label: ' 原唱 ' }, { id: 'e_b' }], 'e_self');
        const twice = normalizeRelatedList(once, 'e_self');
        expect(twice).toEqual(once);
    });
});

describe('collectRelated —— 出入边合并（唯一算法入口）', () => {
    it('无 related / 条目为 undefined ⇒ 空图', () => {
        expect(collectRelated(undefined, [])).toEqual({ nodes: [], invalid: 0 });
        expect(collectRelated(entry('e_a'), [entry('e_a')])).toEqual({ nodes: [], invalid: 0 });
    });

    it('出边：label 原样，空 ⇒ 「关联」，mirror = false', () => {
        const a = entry('e_a', { related: [{ id: 'e_b', label: '翻唱' }, { id: 'e_c' }] });
        const all = [a, entry('e_b'), entry('e_c')];
        const g = collectRelated(a, all);
        expect(g.invalid).toBe(0);
        expect(g.nodes).toHaveLength(2);
        expect(g.nodes[0]).toMatchObject({ id: 'e_b', label: '翻唱', mirror: false });
        expect(g.nodes[1]).toMatchObject({ id: 'e_c', label: REL_DEFAULT_LABEL, mirror: false });
    });

    it('入边：别人挂了我 ⇒ 我这边显示取反词，mirror = true', () => {
        // b 挂 a（b 说「原唱」）⇒ a 图上 b 显示「翻唱」
        const a = entry('e_a');
        const b = entry('e_b', { related: [{ id: 'e_a', label: '原唱' }] });
        const g = collectRelated(a, [a, b]);
        expect(g.nodes).toHaveLength(1);
        expect(g.nodes[0]).toMatchObject({ id: 'e_b', label: '翻唱', mirror: true });
    });

    it('入边 label 为空 ⇒ 「被关联」', () => {
        const a = entry('e_a');
        const b = entry('e_b', { related: [{ id: 'e_a' }] });
        expect(collectRelated(a, [a, b]).nodes[0].label).toBe(REL_MIRROR_LABEL);
    });

    it('出边在前、入边在后（顺序稳定）', () => {
        const a = entry('e_a', { related: [{ id: 'e_c', label: '续作' }] });
        const b = entry('e_b', { related: [{ id: 'e_a', label: '前作' }] });
        const g = collectRelated(a, [a, b, entry('e_c')]);
        expect(g.nodes.map((n) => n.id)).toEqual(['e_c', 'e_b']);
        expect(g.nodes.map((n) => n.mirror)).toEqual([false, true]);
    });

    it('互相挂 ⇒ 合并成一条（出边优先，不出现两条重线）', () => {
        const a = entry('e_a', { related: [{ id: 'e_b', label: '翻唱' }] });
        const b = entry('e_b', { related: [{ id: 'e_a', label: '原唱' }] });
        const g = collectRelated(a, [a, b]);
        expect(g.nodes).toHaveLength(1);
        expect(g.nodes[0]).toMatchObject({ id: 'e_b', label: '翻唱', mirror: false });
    });

    it('指向查不到的 id ⇒ 计入 invalid、不进节点（⛔ 不删数据）', () => {
        const a = entry('e_a', { related: [{ id: 'e_gone' }, { id: 'e_b' }] });
        const g = collectRelated(a, [a, entry('e_b')]);
        expect(g.invalid).toBe(1);
        expect(g.nodes.map((n) => n.id)).toEqual(['e_b']);
    });

    it('入边指向已不存在的目标不计 invalid（扫描别人时目标是我，恒存在）', () => {
        const a = entry('e_a');
        const b = entry('e_b', { related: [{ id: 'e_a' }, { id: 'e_ghost' }] });
        const g = collectRelated(a, [a, b]);
        expect(g.nodes.map((n) => n.id)).toEqual(['e_b']);
        expect(g.invalid).toBe(0);
    });

    it('自环数据（外部直传未归一）不产生节点、不计 invalid', () => {
        const a = entry('e_a', { related: [{ id: 'e_a' }] });
        const g = collectRelated(a, [a]);
        expect(g).toEqual({ nodes: [], invalid: 0 });
    });

    it('节点带上目标标题与类型（渲染直接显示）', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }] });
        const b = entry('e_b', { title: '晴天', type: 'music' });
        expect(collectRelated(a, [a, b]).nodes[0]).toMatchObject({ title: '晴天', type: 'music' });
    });

    it('出边重复 id（未归一数据）只出一个节点', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }, { id: 'e_b', label: '同曲' }] });
        const g = collectRelated(a, [a, entry('e_b')]);
        expect(g.nodes).toHaveLength(1);
    });

    it('入边侧 related 形状破损（非数组）不炸', () => {
        const a = entry('e_a');
        const bad = entry('e_b', { related: 'oops' as unknown as RelatedLink[] });
        expect(() => collectRelated(a, [a, bad])).not.toThrow();
        expect(collectRelated(a, [a, bad]).nodes).toEqual([]);
    });

    it('全库为空数组时出边全失效', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }, { id: 'e_c' }] });
        const g = collectRelated(a, [a]);
        expect(g.nodes).toEqual([]);
        expect(g.invalid).toBe(2);
    });
});

describe('graphLayout —— 纯几何（⛔ 不产出坐标、不产出 NaN）', () => {
    const size = { width: 520, height: 320 };

    it('count 0 / 负数 / 非数 ⇒ 空数组', () => {
        expect(graphLayout(0, size).slots).toEqual([]);
        expect(graphLayout(-3, size).slots).toEqual([]);
        expect(graphLayout(NaN, size).slots).toEqual([]);
    });

    it('数量与槽位数一致', () => {
        for (const n of [1, 2, 3, 6, 8, 12, 40]) {
            expect(graphLayout(n, size).slots).toHaveLength(n);
        }
    });

    it('起始 −90°（12 点方向），等分一周', () => {
        const { slots } = graphLayout(4, size);
        expect(slots[0].angle).toBeCloseTo(-Math.PI / 2, 10);
        expect(slots[1].angle).toBeCloseTo(0, 10);
        expect(slots[2].angle).toBeCloseTo(Math.PI / 2, 10);
        expect(slots[3].angle).toBeCloseTo(Math.PI, 10);
    });

    it('基数半径 = min(w,h)/2 − padding，且必为正', () => {
        const { baseRadius } = graphLayout(3, size);
        expect(baseRadius).toBeCloseTo(320 / 2 - GRAPH_PADDING, 6);
        expect(baseRadius).toBeGreaterThan(0);
    });

    it('节点少于一档时半径一致（不交替）', () => {
        const { slots, baseRadius } = graphLayout(RADIAL_ALT_MIN - 1, size);
        for (const s of slots) expect(s.radius).toBeCloseTo(baseRadius, 6);
    });

    it('达到 RADIAL_ALT_MIN 起交替半径（隔一个缩一档）', () => {
        const { slots, baseRadius } = graphLayout(RADIAL_ALT_MIN, size);
        expect(slots[0].radius).toBeCloseTo(baseRadius, 6);
        expect(slots[1].radius).toBeCloseTo(baseRadius * RADIAL_ALT_RATIO, 6);
        expect(slots[2].radius).toBeCloseTo(baseRadius, 6);
        expect(slots[3].radius).toBeCloseTo(baseRadius * RADIAL_ALT_RATIO, 6);
    });

    it('标签显隐判据 = count <= GRAPH_MAX_READABLE（边界两侧各测）', () => {
        const on = graphLayout(GRAPH_MAX_READABLE, size).slots;
        expect(on.every((s) => s.labelsVisible)).toBe(true);
        const off = graphLayout(GRAPH_MAX_READABLE + 1, size).slots;
        expect(off.every((s) => !s.labelsVisible)).toBe(true);
    });

    it('不设硬上限：40 个节点照样全出，半径不缩成 0', () => {
        const { slots, baseRadius } = graphLayout(40, size);
        expect(slots).toHaveLength(40);
        expect(baseRadius).toBeGreaterThan(0);
        expect(slots.every((s) => s.radius > 0)).toBe(true);
    });

    it('节点圆：有下界 MIN_NODE_R，也有上界 MAX_NODE_R', () => {
        for (const n of [1, 6, 12, 40, 200]) {
            for (const s of graphLayout(n, size).slots) {
                expect(s.nodeR).toBeGreaterThanOrEqual(MIN_NODE_R);
                expect(s.nodeR).toBeLessThanOrEqual(MAX_NODE_R);
            }
        }
    });

    it('宽高非有限数 ⇒ 回落常量（⛔ 不产出 NaN）', () => {
        const { slots, baseRadius } = graphLayout(5, { width: NaN, height: Infinity });
        expect(Number.isFinite(baseRadius)).toBe(true);
        expect(baseRadius).toBeCloseTo(Math.min(GRAPH_FALLBACK_W, GRAPH_FALLBACK_H) / 2 - GRAPH_PADDING, 6);
        for (const s of slots) {
            expect(Number.isFinite(s.angle)).toBe(true);
            expect(Number.isFinite(s.radius)).toBe(true);
            expect(Number.isFinite(s.nodeR)).toBe(true);
        }
    });

    it('尺寸为 0 / 极小 ⇒ 半径卡在 ≥1，仍不产出负数或 NaN', () => {
        for (const sz of [{ width: 0, height: 0 }, { width: 10, height: 10 }]) {
            const { slots, baseRadius } = graphLayout(8, sz);
            expect(baseRadius).toBeGreaterThanOrEqual(1);
            for (const s of slots) {
                expect(s.radius).toBeGreaterThan(0);
                expect(Number.isFinite(s.radius)).toBe(true);
            }
        }
    });

    it('不传尺寸走兜底常量', () => {
        expect(graphLayout(3).baseRadius).toBeCloseTo(Math.min(GRAPH_FALLBACK_W, GRAPH_FALLBACK_H) / 2 - GRAPH_PADDING, 6);
    });

    it('不产出坐标字段（真源只在几何层）', () => {
        const s = graphLayout(3, size).slots[0] as unknown as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(s, 'x')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(s, 'y')).toBe(false);
        expect(s.label).toBeUndefined(); // label 也不在这层（它在 RelatedNode 上）
    });
});
