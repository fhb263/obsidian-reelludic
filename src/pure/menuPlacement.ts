/**
 * 右键/浮出菜单的边界自适应定位（纯函数，无 DOM 依赖）
 *
 * 设计要点：
 *  - 全程在**视口坐标系**内计算。旧实现把「锚点相对坐标」直接与视口宽高比较，
 *    锚点又位于内容末尾（列表越长偏移越大），钳制因此形同失效 → 边缘触发时菜单跑出屏幕。
 *  - 顺序：贴鼠标展开 → 越界则翻转到鼠标另一侧 → 翻转侧仍越界则钳制到 margin。
 *  - 菜单比视口可用区域还大时给出 maxHeight / maxWidth 封顶（调用方配合 overflow 滚动），
 *    避免「整块菜单都塞不下」时既越界又无法查看。
 *  - 返回视口坐标：position:fixed 直接用；锚点相对定位的调用方再做一次减法换算。
 */

export interface MenuGeometry {
    /** 鼠标视口坐标 */
    x: number;
    y: number;
    /** 菜单实测尺寸（由调用方在渲染后 getBoundingClientRect 获取） */
    menuW: number;
    menuH: number;
    /** 视口尺寸 */
    vw: number;
    vh: number;
    /** 视口内最小留白，默认 6 */
    margin?: number;
    /** 翻转后与鼠标的间隙，默认 8 */
    flipGap?: number;
}

export interface MenuPlacement {
    /** 菜单左上角视口坐标 */
    left: number;
    top: number;
    /** 菜单高于视口可用高度时的封顶高度，未超限为 undefined */
    maxHeight?: number;
    /** 菜单宽于视口可用宽度时的封顶宽度，未超限为 undefined */
    maxWidth?: number;
}

export function placeMenu(g: MenuGeometry): MenuPlacement {
    const margin = g.margin ?? 6;
    const gap = g.flipGap ?? 8;

    const availW = Math.max(0, g.vw - margin * 2);
    const availH = Math.max(0, g.vh - margin * 2);

    // 超出可用区域先封顶，后续按封顶后的尺寸判断翻转/钳制
    const maxWidth = g.menuW > availW ? availW : undefined;
    const maxHeight = g.menuH > availH ? availH : undefined;
    const w = maxWidth ?? g.menuW;
    const h = maxHeight ?? g.menuH;

    let left = g.x;
    let top = g.y;

    // 1) 右/下越界 → 翻到鼠标另一侧
    if (left + w > g.vw - margin) left = g.x - w - gap;
    if (top + h > g.vh - margin) top = g.y - h - gap;

    // 2) 翻转侧仍越界 → 钳制进视口（上下界都退化到 margin 时以 margin 为准，不出负值）
    const maxLeft = Math.max(margin, g.vw - w - margin);
    const maxTop = Math.max(margin, g.vh - h - margin);
    left = Math.min(Math.max(margin, left), maxLeft);
    top = Math.min(Math.max(margin, top), maxTop);

    return { left, top, maxHeight, maxWidth };
}
