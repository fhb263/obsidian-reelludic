// #635 关联图谱（#635）：手动关联条目的**唯一算法入口** + 放射状布局的**纯几何**。
//
// 口径（见 `docs/superpowers/plans/2026-10-15-related-graph-design.md`）：
//  · 数据只存**出边**（A.related 里有 B）；B 侧的「被关联」**只在渲染时算**，⛔ 不写反向数据。
//    ⇒ 摘掉 A 那条，B 那边自动消失，不会留脏引用。
//  · 关系词自由文本；反向按**取反表**镜像，表外一律「被关联」（⛔ 不猜、不做模糊匹配 —— 猜错比不猜更坏）。
//  · 只画「以当前条目为中心的一圈」，⛔ 不做全库力导向大图。
//  · 本模块**不依赖 obsidian**，布局只产出「角度 + 半径 + 标签显隐」，坐标换算留给组件（便于纯几何单测）。
import type { MediaEntry, RelatedLink } from 'data/types';

/** 图上**一个节点**（`label` 已算好取反，渲染侧不再判） */
export interface RelatedNode {
    id: string;
    title: string;
    type: MediaEntry['type'];
    /** 关系词（已取反 / 已兜底成「关联」或「被关联」；渲染侧直接显示） */
    label: string;
    /** 这条是「别人挂了我」⇒ 视觉上与出边区分（空心描边） */
    mirror: boolean;
}

/** 一次算全：节点 + 失效引用计数（⛔ 不删数据，只计数给角落提示） */
export interface RelatedGraph {
    nodes: RelatedNode[];
    /** 指向**查不到**的 id 的关联条数（出边 + 入边都算；渲染侧显示「N 条关联已失效」） */
    invalid: number;
}

/** 留空关系词时显示的默认词 */
export const REL_DEFAULT_LABEL = '关联';
/** 反向（别人挂了我）兜底词：表外一律用它 */
export const REL_MIRROR_LABEL = '被关联';
/** 关系词长度上限（防巨型文本进 SVG） */
export const REL_LABEL_MAX = 12;

/**
 * 取反表（**成对且对称**：`原唱↔翻唱`、`改编↔原作`、`续作↔前作`）。
 * 🔴 三项成对是**不变量**：断言会逐对校验 `invert(invert(x)) === x`，加新词也必须成对加。
 */
const REL_INVERT: ReadonlyArray<readonly [string, string]> = [
    ['原唱', '翻唱'],
    ['改编', '原作'],
    ['续作', '前作'],
];

/** 录入侧下拉**建议**（⛔ 只是建议，不是白名单 —— 自由文本照样能填） */
export const REL_LABEL_SUGGESTIONS: readonly string[] = ['原唱', '翻唱', '改编', '原作', '续作', '前作', '同曲', '现场版'];

/** 录入侧轻提示停留时长（与 `pure/toast.TOAST_MS` 同档 1.5s，⛔ 不各写一个数） */
export const REL_HINT_MS = 1500;

/** 启用交替半径的最小节点数（错开相邻标签） */
export const RADIAL_ALT_MIN = 6;
/** 标签「默认显示」的节点数门槛（超过转悬停显示；8 = 象形稿 6 条可读 / 12 条已密之间） */
export const GRAPH_MAX_READABLE = 8;
/** 节点圆半径下界（⛔ 不缩到看不见） */
export const MIN_NODE_R = 5;
/** 节点圆半径上界（节点少时别画成一个大饼） */
export const MAX_NODE_R = 15;
/** 放射半径留白（给标签与节点圆留空间） */
export const GRAPH_PADDING = 44;
/** 交替半径的第二档系数 */
export const RADIAL_ALT_RATIO = 0.8;
/** 画布尺寸的兜底常量（宽高非有限数时用它，⛔ 不产出 NaN） */
export const GRAPH_FALLBACK_W = 520;
export const GRAPH_FALLBACK_H = 320;

/**
 * 关系词归一（**唯一收口点**）：trim + 折内部空白 + 长度上限；空 ⇒ `undefined`。
 * 🔴 落 `undefined` 而不是 `''`：「留空 = 关联」的判据在渲染侧只判一次（`''` 会逼着到处判两次）。
 */
export function normalizeRelLabel(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const t = raw.replace(/\s+/g, ' ').trim();
    if (!t) return undefined;
    // 按**码点**截断（`slice` 会切碎 emoji 代理对，进 SVG 就是乱码方块）
    return Array.from(t).slice(0, REL_LABEL_MAX).join('');
}

/**
 * 关系词取反（裁定 ③）：表内命中 ⇒ 反义词；**表外 / 空 ⇒ 「被关联」**。
 * ⚠️ 只认**逐字相等**（trim 之外不做任何归一）：`翻唱（Live）` 是另一个词，落表外兜底 ——
 *    这正是「不猜」的口径，别改成 `includes` 模糊匹配。
 */
export function invertRelLabel(label: string | undefined): string {
    const t = typeof label === 'string' ? label.trim() : '';
    if (!t) return REL_MIRROR_LABEL;
    for (const [a, b] of REL_INVERT) {
        if (t === a) return b;
        if (t === b) return a;
    }
    return REL_MIRROR_LABEL;
}

/** 取反表全表（断言与 UI 共用；只读） */
export function relLabelInvertPairs(): ReadonlyArray<readonly [string, string]> {
    return REL_INVERT;
}

/**
 * 归一一条关联项（`normalizeEntry` 的逐项校验走它 —— 落库白名单与读取端**同一份判据**）。
 * 非法（非对象 / id 非字符串 / id trim 后空）⇒ `undefined`（**丢该项**，⛔ 不整批废）。
 */
export function normalizeRelatedLink(raw: unknown, selfId?: string): RelatedLink | undefined {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    if (!id) return undefined;
    // 自环丢：图上没有意义，且会让「点节点」变成「切到自己」
    if (selfId && id === selfId) return undefined;
    const label = normalizeRelLabel(o.label);
    return label ? { id, label } : { id };
}

/**
 * 归一整组关联（**落库唯一收口点**，`normalizeEntry` 调它）。
 *  - 非数组（含 undefined / null）⇒ `undefined`（⛔ 不落 `[]`：空数组与「没有」存储等价，多一个键只会撑大 data.json）
 *  - 逐项走 `normalizeRelatedLink`，脏项单丢
 *  - 同 id 重复 ⇒ **后写的赢**（与 #427 断点续传存档同口径）
 *  - 归一后为空 ⇒ `undefined`
 */
export function normalizeRelatedList(raw: unknown, selfId?: string): RelatedLink[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const byId = new Map<string, RelatedLink>();
    for (const item of raw) {
        const link = normalizeRelatedLink(item, selfId);
        if (!link) continue;
        byId.set(link.id, link); // Map 保序：重复 id 覆盖值但**留在首次出现的位置**
    }
    const out = Array.from(byId.values());
    return out.length ? out : undefined;
}

/**
 * 收集某条目的关联图谱（**出边 + 入边合并**）—— 唯一算法入口。
 *
 * · 出边：`entry.related`，`label` 原样（空 ⇒ 「关联」），`mirror = false`；
 * · 入边：扫全库，谁的 `related` 里有我 ⇒ 我这边显示**取反**后的词，`mirror = true`；
 * · **互相挂**（既有出边又有入边）⇒ **按出边优先**合并成一条（图上不出现两条重线）；
 * · 目标 id 查不到 ⇒ 计入 `invalid`、**不进节点**（⛔ 不删数据、不弹窗 —— 只在角落提示）。
 */
export function collectRelated(entry: Pick<MediaEntry, 'id' | 'related'> | undefined, allEntries: readonly MediaEntry[]): RelatedGraph {
    if (!entry) return { nodes: [], invalid: 0 };
    const byId = new Map<string, MediaEntry>();
    for (const e of allEntries) {
        if (e && typeof e.id === 'string' && e.id) byId.set(e.id, e);
    }
    const nodes: RelatedNode[] = [];
    const seen = new Set<string>([entry.id]);
    let invalid = 0;

    // ① 出边优先
    for (const link of entry.related ?? []) {
        const target = byId.get(link.id);
        if (!target) {
            invalid++;
            continue;
        }
        if (seen.has(target.id)) continue; // 自环 / 重复（normalize 已去重，这里再挡一次外部直传）
        seen.add(target.id);
        nodes.push({
            id: target.id,
            title: target.title,
            type: target.type,
            label: normalizeRelLabel(link.label) ?? REL_DEFAULT_LABEL,
            mirror: false,
        });
    }

    // ② 入边（不写进对方数据，渲染时算 ⇒ 摘掉出边即消失）
    for (const other of allEntries) {
        if (!other || !Array.isArray(other.related)) continue;
        if (other.id === entry.id) continue;
        const hit = other.related.find((l) => l && l.id === entry.id);
        if (!hit) continue;
        if (seen.has(other.id)) continue; // 互相挂：出边已占位，按出边优先
        seen.add(other.id);
        nodes.push({
            id: other.id,
            title: other.title,
            type: other.type,
            label: invertRelLabel(hit.label),
            mirror: true,
        });
    }

    return { nodes, invalid };
}

/** 布局的一项：角度（弧度，0 = 3 点方向，从 −90° 起算）+ 半径 + 标签是否默认显示 */
export interface RadialSlot {
    /** 弧度：−π/2 起、等分一周 */
    angle: number;
    /** 该节点到圆心的距离（px） */
    radius: number;
    /** 标签是否默认显示（否则悬停才显示） */
    labelsVisible: boolean;
    /** 节点圆半径（px，≥ MIN_NODE_R） */
    nodeR: number;
}

export interface RadialLayout {
    slots: RadialSlot[];
    /** 当时的放射基数半径（交替半径的第一档；组件画引导圈用） */
    baseRadius: number;
}

/**
 * 放射状布局的**纯几何**：只出「角度 + 半径 + 标签显隐 + 节点圆大小」，⛔ 不产出坐标。
 *
 * · 角度：`2π × i / count`，起始 −90°（12 点方向）；
 * · 半径：基数 `R = min(w,h)/2 − padding`；`count ≥ RADIAL_ALT_MIN` ⇒ 交替 `R` / `R × 0.8` 错开标签；
 * · **不设节点数硬上限**：count 大 ⇒ 半径仍取 R、节点圆变小、标签转悬停显示；
 * · 🔴 退化安全：`count <= 0` ⇒ 空数组；宽高非有限数 ⇒ 回落常量；⛔ **任何字段都不产出 NaN**
 *   （NaN 进 SVG 属性 = 元素静默不渲染，极难排查）。
 */
export function graphLayout(
    count: number,
    opts: { width?: number; height?: number } = {},
): RadialLayout {
    const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (n === 0) return { slots: [], baseRadius: 0 };
    const w = Number.isFinite(opts.width) ? (opts.width as number) : GRAPH_FALLBACK_W;
    const h = Number.isFinite(opts.height) ? (opts.height as number) : GRAPH_FALLBACK_H;
    // 半径：留白之后至少留 1px，⛔ 负数进 SVG 同样会静默坏掉
    const baseRadius = Math.max(1, Math.min(w, h) / 2 - GRAPH_PADDING);
    const labelsVisible = n <= GRAPH_MAX_READABLE;
    // 节点圆：随节点数收缩，但卡在 [MIN_NODE_R, MAX_NODE_R]
    const nodeR = Math.max(MIN_NODE_R, Math.min(MAX_NODE_R, Math.floor(baseRadius / 5)));
    const alt = n >= RADIAL_ALT_MIN;
    const slots: RadialSlot[] = [];
    for (let i = 0; i < n; i++) {
        slots.push({
            angle: -Math.PI / 2 + (2 * Math.PI * i) / n,
            radius: alt && i % 2 === 1 ? baseRadius * RADIAL_ALT_RATIO : baseRadius,
            labelsVisible,
            nodeR,
        });
    }
    return { slots, baseRadius };
}
