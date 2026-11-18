/**
 * 截图「即时批注」的纯逻辑（用户 `m07854` ⑰，2026-11-13 扩充为 pixpin 式七工具）。
 *
 * 用户原话（2026-11-13）：「批注模式下框选后可进行六向调整宽高、像 pixpin 一样列出批注
 * （几何图形、铅笔、箭头、文本打字、马赛克、标序号）播放器的区域截图按钮也为 pixpin 一样列出批注」
 *
 * 分工（与本仓其余 `pure/*` 同一条纪律）：
 *   · 本模块只管**几何 / 形状 / 序列化 / 工具清单**，不碰 DOM、不碰 canvas 上下文、不碰 vault。
 *   · 画到画布上在 `modals/ShotAnnotateModal` 与 `modals/ShotRegionAnnotator`；
 *     落盘与写笔记仍在宿主 `main.ts:saveReaderShot` / `main.ts:saveVideoShot`
 *     （笔记文件的唯一拥有者是 `EntryService`，⛔ 别在弹窗里 `vault.modify`）。
 *
 * 🔴 四条硬口径：
 *   ① 坐标一律用**归一化坐标**（`0..1` 相对画面宽高）存在形状里，⛔ 不存像素。
 *      截图是按原始分辨率抓的（1920×1080），而用户在浮层里看到的是缩放后的预览（可能 800×450）；
 *      存像素就会出现「画在预览上 400px、落盘后在原图上是 400/1920 处」的错位。
 *   ② 每个形状都必须能被 `drawShape` **重放**（撤销 = 弹掉最后一个再整帧重绘），
 *      ⛔ 不做「直接往画布上盖、盖了就回不去」的写法 —— 那样撤销只能靠快照堆内存。
 *   ③ 马赛克是**像素块**不是模糊画笔：按 `MOSAIC_BLOCK` 取整对齐的方块，重放时逐块重绘，
 *      同一形状在任何分辨率下都得到相同的马赛克观感（⛔ 别用 `filter: blur()`，那会随缩放变糊）。
 *   ④ 工具清单（顺序 / 文案 / 图标）**只有这一份真源** —— pixpin 式工具条由 `ANNOTATE_TOOLS`
 *      驱动渲染，⛔ 别在弹窗里另写一份数组（两处必然漂移，用户看到按钮和实际工具对不上）。
 */

/** 归一化点（0..1，相对画面宽高）。 */
export interface NormPoint {
    x: number;
    y: number;
}

/**
 * 批注工具（2026-11-13 用户口径：几何图形 / 铅笔 / 箭头 / 文本 / 马赛克 / 标序号）。
 *
 * `rect` + `ellipse` 合起来就是用户说的「几何图形」；拆成两个工具是因为
 * 「框住一块区域」和「圈出一个人」是两种不同意图，用一个工具再做二级切换等于多一次点击。
 */
export type AnnotateTool =
    | 'rect'
    | 'ellipse'
    | 'pen'
    | 'arrow'
    | 'text'
    | 'mosaic'
    | 'number';

/** 工具顺序 = pixpin 式工具条的按钮顺序（拖动类在前、点放类在后、遮挡类收尾）。 */
export const ANNOTATE_TOOLS: readonly AnnotateTool[] = [
    'rect',
    'ellipse',
    'pen',
    'arrow',
    'text',
    'mosaic',
    'number',
];

export const ANNOTATE_TOOL_LABELS: Readonly<Record<AnnotateTool, string>> = {
    rect: '矩形',
    ellipse: '画圈',
    pen: '铅笔',
    arrow: '箭头',
    text: '文本',
    mosaic: '马赛克',
    number: '序号',
};

/** 工具提示（悬停/无障碍文案的真源，⛔ 别在弹窗里另写一份）。 */
export const ANNOTATE_TOOL_TIPS: Readonly<Record<AnnotateTool, string>> = {
    rect: '矩形：按住拖出一块方框，把要指的区域框起来',
    ellipse: '画圈：按住拖出一个圈，把要指的地方圈起来',
    pen: '铅笔：按住自由手绘，松手成一条线',
    arrow: '箭头：从起点拖到目标，箭头指在松手处',
    text: '文本：点一下就地打字，回车确认',
    mosaic: '马赛克：按住拖过要遮的区域，按块打码',
    number: '序号：点一下落一个编号，编号自增',
};

/** 工具图标（Obsidian `setIcon` 名；⛔ 别用 emoji —— 各平台字形宽度不一，工具条会抖）。 */
export const ANNOTATE_TOOL_ICONS: Readonly<Record<AnnotateTool, string>> = {
    rect: 'square',
    ellipse: 'circle',
    pen: 'pencil',
    arrow: 'move-up-right',
    text: 'type',
    mosaic: 'grid-2x2',
    number: 'list-ordered',
};

/** 拖动类工具（按下—拖动—松开造形状）；其余是「点一下就地落子」。 */
export const ANNOTATE_DRAG_TOOLS: readonly AnnotateTool[] = ['rect', 'ellipse', 'pen', 'arrow', 'mosaic'];

/** 是否拖动类工具 —— 弹窗据此决定 pointerdown 是开画还是落子。 */
export function isDragTool(tool: AnnotateTool): boolean {
    return ANNOTATE_DRAG_TOOLS.includes(tool);
}

/** 描边粗细（**相对画面短边**的比例）—— 与分辨率无关，1080p 与 4K 都是同一观感。 */
export const ANNOTATE_STROKE_RATIO = 0.004;

/** 马赛克像素块边长（**相对画面短边**的比例）。1/120 ≈ 1080p 上 9px 一块。 */
export const MOSAIC_BLOCK_RATIO = 1 / 120;

/** 形状最小尺寸（归一化）：小于它当误触，⛔ 不记录（否则 undo 一次没反应会被当成按钮坏了）。 */
export const ANNOTATE_MIN_SIZE = 0.004;

/** 文本字号（相对画面短边比例）—— 1080p 上约 43px，够大但不至于压掉半屏。 */
export const ANNOTATE_TEXT_RATIO = 0.04;

/** 序号圆半径（相对画面短边比例）—— 与文本同量级，视觉上是一组。 */
export const ANNOTATE_SEQ_RATIO = 0.022;

/** 一个可重放的批注形状。 */
export type AnnotationShape =
    | { tool: 'rect'; from: NormPoint; to: NormPoint }
    | { tool: 'ellipse'; from: NormPoint; to: NormPoint }
    | { tool: 'arrow'; from: NormPoint; to: NormPoint }
    | { tool: 'mosaic'; from: NormPoint; to: NormPoint }
    | { tool: 'pen'; points: NormPoint[] }
    | { tool: 'text'; at: NormPoint; text: string }
    | { tool: 'number'; at: NormPoint; n: number };

/** 把视口像素坐标归一化到 `0..1`，并钳进画面（拖出画布外也不产生负坐标）。 */
export function toNorm(x: number, y: number, width: number, height: number): NormPoint {
    const w = width > 0 ? width : 1;
    const h = height > 0 ? height : 1;
    return {
        x: Math.min(1, Math.max(0, x / w)),
        y: Math.min(1, Math.max(0, y / h)),
    };
}

/** 反归一化回像素（绘制时用）。 */
export function toPx(p: NormPoint, width: number, height: number): { x: number; y: number } {
    return { x: p.x * width, y: p.y * height };
}

/**
 * 由一次拖拽造形状；过小返回 `null`（调用方据此**不**入栈）。
 * ⚠️ 判据用两条边的**较长者**比 `ANNOTATE_MIN_SIZE`：用户画扁平箭头（横向 300px、纵向 5px）
 *    是合理操作，用短边判会把它当误触丢掉。
 * ⚠️ 只接拖动类工具；`text` / `number` / `pen` 各有专门构造函数（⛔ 别用拖拽口径套它们）。
 */
export function makeShape(tool: AnnotateTool, from: NormPoint, to: NormPoint): AnnotationShape | null {
    if (!isDragTool(tool) || tool === 'pen') return null;
    const span = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    if (!(span >= ANNOTATE_MIN_SIZE)) return null;
    // 收窄成四变体：`tool` 已是 `isDragTool` 过滤后的拖动类（⛔ 别直接 `return { tool, from, to }`，
    //   TS 无法把 `AnnotateTool` 收窄到那几个字面量，会报 TS2322）
    switch (tool) {
        case 'rect':
            return { tool: 'rect', from, to };
        case 'ellipse':
            return { tool: 'ellipse', from, to };
        case 'arrow':
            return { tool: 'arrow', from, to };
        case 'mosaic':
            return { tool: 'mosaic', from, to };
        default:
            return null;
    }
}

/** 铅笔：点位太少（或总跨度太小）当误触。 */
export function makePenShape(points: readonly NormPoint[]): AnnotationShape | null {
    if (points.length < 2) return null;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!(span >= ANNOTATE_MIN_SIZE)) return null;
    return { tool: 'pen', points: points.map((p) => ({ x: p.x, y: p.y })) };
}

/** 文本：空串当误触（用户点了没打字就回车）。 */
export function makeTextShape(at: NormPoint, text: string): AnnotationShape | null {
    const body = text.trim();
    if (body.length === 0) return null;
    return { tool: 'text', at: { x: at.x, y: at.y }, text: body };
}

/** 序号：编号由调用方按 `nextSeq` 给，形状本身只存数字。 */
export function makeNumberShape(at: NormPoint, n: number): AnnotationShape {
    return { tool: 'number', at: { x: at.x, y: at.y }, n: Math.max(1, Math.round(n)) };
}

/** 下一个序号（已有形状里最大的编号 + 1，从 1 起）。 */
export function nextSeq(shapes: readonly AnnotationShape[]): number {
    let max = 0;
    for (const s of shapes) {
        if (s.tool === 'number' && s.n > max) max = s.n;
    }
    return max + 1;
}

/** 形状的像素包围盒（左上 + 宽高），供马赛克遍历与测试断言用。 */
export function shapeBounds(shape: AnnotationShape, width: number, height: number): {
    left: number;
    top: number;
    width: number;
    height: number;
} {
    if (shape.tool === 'pen') {
        let minX = 1;
        let minY = 1;
        let maxX = 0;
        let maxY = 0;
        for (const p of shape.points) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        const a = toPx({ x: minX, y: minY }, width, height);
        const b = toPx({ x: maxX, y: maxY }, width, height);
        return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
    }
    if (shape.tool === 'text') {
        const at = toPx(shape.at, width, height);
        const size = textSizeFor(width, height);
        // 只做粗估（文本真实宽度要量字形，纯层拿不到）—— 包围盒只用于「是否落在画面内」这类判断
        return { left: at.x, top: at.y - size, width: shape.text.length * size * 0.6, height: size * 1.2 };
    }
    if (shape.tool === 'number') {
        const at = toPx(shape.at, width, height);
        const r = seqRadiusFor(width, height);
        return { left: at.x - r, top: at.y - r, width: r * 2, height: r * 2 };
    }
    const a = toPx(shape.from, width, height);
    const b = toPx(shape.to, width, height);
    return {
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
    };
}

/** 描边宽度（像素）：按画面短边换算，并给一个下限（否则缩到小图时细得看不见）。 */
export function strokeWidthFor(width: number, height: number): number {
    const short = Math.min(width, height);
    return Math.max(1, Math.round(short * ANNOTATE_STROKE_RATIO));
}

/** 马赛克块边长（像素）：按画面短边换算，至少 2px（1px 的"马赛克"等于没打）。 */
export function mosaicBlockFor(width: number, height: number): number {
    const short = Math.min(width, height);
    return Math.max(2, Math.round(short * MOSAIC_BLOCK_RATIO));
}

/** 文本字号（像素）：按短边换算，至少 10px。 */
export function textSizeFor(width: number, height: number): number {
    const short = Math.min(width, height);
    return Math.max(10, Math.round(short * ANNOTATE_TEXT_RATIO));
}

/** 序号圆半径（像素）：按短边换算，至少 6px。 */
export function seqRadiusFor(width: number, height: number): number {
    const short = Math.min(width, height);
    return Math.max(6, Math.round(short * ANNOTATE_SEQ_RATIO));
}

/**
 * 马赛克要处理的块坐标列表（**从原图采样**，⛔ 不用已经画好的马赛克再算 —— 那会越打越糊）。
 *
 * 返回 `[sx, sy]` 像素坐标（块左上角），调用方按块取原图 → 求均值 → 填回。
 * 只覆盖形状包围盒与画面相交的部分。
 */
export function mosaicBlocks(
    shape: AnnotationShape,
    width: number,
    height: number,
): Array<{ x: number; y: number; size: number }> {
    const block = mosaicBlockFor(width, height);
    const b = shapeBounds(shape, width, height);
    const out: Array<{ x: number; y: number; size: number }> = [];
    const startX = Math.max(0, Math.floor(b.left / block) * block);
    const startY = Math.max(0, Math.floor(b.top / block) * block);
    const endX = Math.min(width, b.left + b.width);
    const endY = Math.min(height, b.top + b.height);
    for (let y = startY; y < endY; y += block) {
        for (let x = startX; x < endX; x += block) {
            const w = Math.min(block, width - x);
            const h = Math.min(block, height - y);
            if (w <= 0 || h <= 0) continue;
            out.push({ x, y, size: Math.max(w, h) });
        }
    }
    return out;
}

/**
 * 序列化/反序列化：批注图**不随图落盘**（用户只要「保存为图片」那一眼的成品），
 * 但要能跨「撤销 → 重绘 → 导出」三轮保持一致，故形状列表必须可深拷贝。
 * ⚠️ 用逐项重建而不是 `structuredClone` —— 本仓要在 Node/Electron 两种运行时都能跑，
 *    且形状只有扁平数字/短字符串，重建比结构化克隆便宜。
 * ⚠️ 铅笔的 `points` 必须**逐点重建**，否则撤销后重绘会改到旧数组（副本共享引用）。
 */
export function cloneShapes(shapes: readonly AnnotationShape[]): AnnotationShape[] {
    return shapes.map((s) => {
        if (s.tool === 'pen') return { tool: 'pen', points: s.points.map((p) => ({ x: p.x, y: p.y })) };
        if (s.tool === 'text') return { tool: 'text', at: { ...s.at }, text: s.text };
        if (s.tool === 'number') return { tool: 'number', at: { ...s.at }, n: s.n };
        return { tool: s.tool, from: { ...s.from }, to: { ...s.to } };
    });
}

/** 撤销：弹掉最后一个，返回**新数组**（⛔ 别原地 `pop`，Svelte 侧拿不到引用变化）。 */
export function undoShapes(shapes: readonly AnnotationShape[]): AnnotationShape[] {
    return shapes.slice(0, -1);
}

/** 是否还有东西可撤销（按钮可点态的判据）。 */
export function canUndo(shapes: readonly AnnotationShape[]): boolean {
    return shapes.length > 0;
}

/** 状态行文案（「画圈：已画 2 笔」这类），⛔ 别在弹窗里另拼一份。 */
export function annotateHint(tool: AnnotateTool, count: number): string {
    const name = ANNOTATE_TOOL_LABELS[tool];
    if (!isDragTool(tool)) {
        return count > 0 ? `${name} · 已画 ${count} 笔 · 点一下落子` : `${name} · 点一下落子`;
    }
    return count > 0 ? `${name} · 已画 ${count} 笔` : `${name} · 按住拖拽即可标注`;
}
