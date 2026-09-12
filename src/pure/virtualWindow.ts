// 海报墙虚拟滚动窗口计算（纯逻辑，无 obsidian 依赖，可单测）
//
// 背景：海报墙此前把 filtered 全量渲染成卡片，条目上千时 DOM 节点过多、滚动卡顿。
// 本模块只回答「给定滚动位置，该渲染哪一段、上下各留多少空白撑起总高度」——
// 不碰 DOM、不碰 Svelte，渲染层拿 startIndex/endIndex 切片、把留白写进占位元素即可。
//
// 为什么用「行」而不是「张卡片」：海报墙是等宽网格，同一条目在不同列数下所在行不同，
// 按行算窗口才能让滚动位置与内容位置严格对齐（行高 × 行号 = 实际像素位移）。

/** 低于该条目数不启用虚拟滚动：渲染开销可接受，且保留 Ctrl+F 能搜到卡片 / 打印完整列表的行为 */
export const VIRTUAL_THRESHOLD = 500;

/** 视口上下各多渲染的行数（缓解快速滚动时的白屏） */
export const DEFAULT_OVERSCAN_ROWS = 2;

export interface VirtualWindowInput {
    /** 滚动容器当前 scrollTop（负值按 0 处理） */
    scrollTop: number;
    /** 滚动容器可视高度 clientHeight */
    viewportHeight: number;
    /** 单行高度（含行间距）px */
    rowHeight: number;
    /** 每行卡片数（列数，非法值回退 1） */
    columns: number;
    /** 总条目数（同时用于阈值判定） */
    itemCount: number;
    /** 额外渲染行数，默认 DEFAULT_OVERSCAN_ROWS */
    overscanRows?: number;
}

export interface VirtualWindowResult {
    /** 是否真的启用虚拟滚动；false 时其余字段为「全量区间 + 零留白」，调用方应照常全量渲染 */
    enabled: boolean;
    /** 需渲染的行区间，闭区间（itemCount 为 0 时 endRow = -1） */
    startRow: number;
    endRow: number;
    /** 需渲染的条目下标区间，半开区间（直接用于 filtered.slice(startIndex, endIndex)） */
    startIndex: number;
    endIndex: number;
    /** 上方占位高度 px（= 被跳过行数 × 行高） */
    paddingTop: number;
    /** 下方占位高度 px */
    paddingBottom: number;
}

/**
 * 计算虚拟滚动窗口。不变式：paddingTop + 渲染行数 × 行高 + paddingBottom = 总行数 × 行高，
 * 因此滚动条长度与全量渲染时一致（不会因虚拟化而变短）。
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
    const itemCount = Math.max(0, Math.floor(input.itemCount) || 0);
    const cols = Math.max(1, Math.floor(input.columns) || 1);
    const rh = Math.max(1, Math.floor(input.rowHeight) || 1);
    const vh = Math.max(0, input.viewportHeight || 0);
    const st = Math.max(0, input.scrollTop || 0);
    const overscan = Math.max(0, Math.floor(input.overscanRows ?? DEFAULT_OVERSCAN_ROWS) || 0);

    const empty: VirtualWindowResult = {
        enabled: false, startRow: 0, endRow: -1,
        startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0,
    };
    if (itemCount === 0) return empty;

    const rows = Math.ceil(itemCount / cols);
    if (itemCount <= VIRTUAL_THRESHOLD) {
        return { ...empty, startRow: 0, endRow: rows - 1, startIndex: 0, endIndex: itemCount };
    }

    const firstVisibleRow = Math.floor(st / rh);
    const lastVisibleRow = Math.max(0, Math.ceil((st + vh) / rh) - 1);
    // 先夹末行，再夹首行（顺序不能反：滚过头时首行会大于末行，须由末行兜住）
    const endRow = Math.min(rows - 1, lastVisibleRow + overscan);
    const startRow = Math.min(endRow, Math.max(0, firstVisibleRow - overscan));

    return {
        enabled: true,
        startRow,
        endRow,
        startIndex: startRow * cols,
        endIndex: Math.min(itemCount, (endRow + 1) * cols),
        paddingTop: startRow * rh,
        paddingBottom: (rows - 1 - endRow) * rh,
    };
}
