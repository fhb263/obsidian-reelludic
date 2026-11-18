/**
 * 截图批注的**绘制层**（用户 `m07854` ⑰，2026-11-13 扩到 pixpin 式七工具）。
 *
 * 为什么单独一层而不写在 Modal 里：
 *   · 绘制要能被**单测**（用假 2D 上下文记调用序列），Modal 里的 `new Image()` / `toBlob` 没法在 node 里跑。
 *   · 「整帧重放」是撤销的唯一实现路径（见 `pure/shotAnnotate` 口径 ②），
 *     所以绘制必须是一个**纯函数**：给定形状列表 + 上下文 ⇒ 同样的像素。
 *
 * 为什么放在 `pure/` 而不是另开 `render/`：
 *   本仓的模块纪律是「`pure/` = 不碰 obsidian / vault / DOM **全局**」——
 *   2D 上下文是**参数传进来**的，本文件一个 DOM 全局都没碰，符合这条。
 *   另一个现实原因：`vitest.config` 的 alias 只按 `src` 顶层目录登记（`pure`/`data`/`services`/`modals`/`ui`），
 *   新开顶层目录要同步改 alias + tsconfig，而两者分叉过一次（见 `Project-Rule` 教训）⇒ 不值得。
 *
 * ⛔ 本文件不 import obsidian、不碰 vault、不读 DOM 全局。
 */
import {
    mosaicBlocks,
    seqRadiusFor,
    shapeBounds,
    strokeWidthFor,
    textSizeFor,
    toPx,
    type AnnotationShape,
} from 'pure/shotAnnotate';

/** 绘图目标的最小子集（`CanvasRenderingContext2D` 满足它；测试里用假对象）。 */
export interface Ctx2D {
    strokeStyle: unknown;
    fillStyle: unknown;
    lineWidth: number;
    lineCap: string;
    lineJoin: string;
    font: string;
    textAlign: string;
    textBaseline: string;
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    ellipse(
        x: number,
        y: number,
        radiusX: number,
        radiusY: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
    ): void;
    stroke(): void;
    fill(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
    /** 取原图像素（马赛克采样用）。`sx/sy` 是源图坐标。 */
    getImageData(sx: number, sy: number, sw: number, sh: number): { data: ArrayLike<number> };
}

/** 描边颜色：用固定高对比色（⛔ 不用主题色 —— 截图会被插进笔记，主题一换红圈就看不见了）。 */
export const ANNOTATE_STROKE_STYLE = '#ff3b30';

/** 文本/序号用同一个高对比色（红字压在深色画面上也看得清）。 */
export const ANNOTATE_TEXT_STYLE = '#ff3b30';

/** 字号字族：优先系统无衬线，中文回落到 sans-serif（⛔ 别写死某个字体名，跨平台会缺字形）。 */
export const ANNOTATE_FONT_FAMILY = 'sans-serif';

/**
 * 画一个形状。调用方负责在**整帧重放**时按列表顺序逐个调。
 *
 * @param src 原图（未批注的底图）上下文 —— 马赛克要**从这里采样**，
 *            而不是从已经画过马赛克的画布采样（那样会越打越糊，见 `mosaicBlocks` 注释）。
 */
export function drawShape(
    ctx: Ctx2D,
    src: Ctx2D | null,
    shape: AnnotationShape,
    width: number,
    height: number,
): void {
    if (shape.tool === 'mosaic') {
        drawMosaic(ctx, src, shape, width, height);
        return;
    }
    if (shape.tool === 'text') {
        drawText(ctx, shape, width, height);
        return;
    }
    if (shape.tool === 'number') {
        drawNumber(ctx, shape, width, height);
        return;
    }
    if (shape.tool === 'pen') {
        drawPen(ctx, shape, width, height);
        return;
    }
    const a = toPx(shape.from, width, height);
    const b = toPx(shape.to, width, height);
    ctx.save();
    ctx.strokeStyle = ANNOTATE_STROKE_STYLE;
    ctx.lineWidth = strokeWidthFor(width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (shape.tool === 'rect') {
        // 矩形 = 拖拽框本身（用户拖出多扁就多扁）
        const box = shapeBounds(shape, width, height);
        if (box.width < 1 || box.height < 1) {
            ctx.restore();
            return;
        }
        ctx.beginPath();
        ctx.moveTo(box.left, box.top);
        ctx.lineTo(box.left + box.width, box.top);
        ctx.lineTo(box.left + box.width, box.top + box.height);
        ctx.lineTo(box.left, box.top + box.height);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        return;
    }
    if (shape.tool === 'ellipse') {
        // 画圈 = 以拖拽框为外接矩形的椭圆（用户拖出多扁就多扁，⛔ 不强制正圆）
        const box = shapeBounds(shape, width, height);
        if (box.width < 1 || box.height < 1) {
            ctx.restore();
            return;
        }
        ctx.beginPath();
        ctx.ellipse(
            box.left + box.width / 2,
            box.top + box.height / 2,
            box.width / 2,
            box.height / 2,
            0,
            0,
            Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
        return;
    }
    // 箭头：主干 + 两条箭头翼（翼长按线长与描边宽度取，短箭头也不会变成一坨）
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const head = Math.min(len * 0.42, Math.max(10, ctx.lineWidth * 3.2));
    if (head >= 2) {
        const spread = Math.PI / 7;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(angle - spread), b.y - head * Math.sin(angle - spread));
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(angle + spread), b.y - head * Math.sin(angle + spread));
        ctx.stroke();
    }
    ctx.restore();
}

/** 铅笔：沿点位折线画一条连续线（首点用 moveTo，其余 lineTo）。 */
function drawPen(
    ctx: Ctx2D,
    shape: Extract<AnnotationShape, { tool: 'pen' }>,
    width: number,
    height: number,
): void {
    if (shape.points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = ANNOTATE_STROKE_STYLE;
    ctx.lineWidth = strokeWidthFor(width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < shape.points.length; i += 1) {
        const p = toPx(shape.points[i], width, height);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
}

/** 文本：一行字，基线左下对齐（`at` 就是用户点下去的位置）。 */
function drawText(
    ctx: Ctx2D,
    shape: Extract<AnnotationShape, { tool: 'text' }>,
    width: number,
    height: number,
): void {
    const at = toPx(shape.at, width, height);
    const size = textSizeFor(width, height);
    ctx.save();
    ctx.fillStyle = ANNOTATE_TEXT_STYLE;
    ctx.font = `${size}px ${ANNOTATE_FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(shape.text, at.x, at.y);
    ctx.restore();
}

/** 序号：实心圆 + 反白数字（圆盘压在任何底图上都能读）。 */
function drawNumber(
    ctx: Ctx2D,
    shape: Extract<AnnotationShape, { tool: 'number' }>,
    width: number,
    height: number,
): void {
    const at = toPx(shape.at, width, height);
    const r = seqRadiusFor(width, height);
    const label = String(shape.n);
    ctx.save();
    ctx.fillStyle = ANNOTATE_STROKE_STYLE;
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, r, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    // 数字本身按圆半径反推字号：一位数占 1.0r，两位数自动缩（⛔ 不另算宽度，纯层量不了字形）
    const size = Math.max(7, Math.round((r * 2) / Math.max(1, label.length) * 1.05));
    ctx.font = `${size}px ${ANNOTATE_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, at.x, at.y);
    ctx.restore();
}

/**
 * 马赛克：逐块从**原图**取均值色再填回去。
 *
 * ⚠️ `src` 为 `null` 时退化成「半透明黑方块」——这在正常流程里不会发生（调用方总是提供原图），
 *    但宁可画出可辨识的遮挡，也不要静默什么都不画（用户会以为按钮坏了）。
 */
function drawMosaic(
    ctx: Ctx2D,
    src: Ctx2D | null,
    shape: AnnotationShape,
    width: number,
    height: number,
): void {
    const blocks = mosaicBlocks(shape, width, height);
    if (blocks.length === 0) return;
    if (!src) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        for (const b of blocks) ctx.fillRect(b.x, b.y, b.size, b.size);
        ctx.restore();
        return;
    }
    ctx.save();
    for (const b of blocks) {
        let data: ArrayLike<number>;
        try {
            data = src.getImageData(b.x, b.y, b.size, b.size).data;
        } catch {
            // 越界/污染：跳过这一块，别让整张图导出失败
            continue;
        }
        let r = 0;
        let g = 0;
        let bl = 0;
        let n = 0;
        for (let i = 0; i + 3 < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            bl += data[i + 2];
            n += 1;
        }
        if (n === 0) continue;
        ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`;
        ctx.fillRect(b.x, b.y, b.size, b.size);
    }
    ctx.restore();
}

/**
 * 整帧重放：底图已由调用方画好，这里只按顺序叠形状。
 * 撤销 = 换个更短的列表再调一次本函数（⛔ 不做「盖上去就回不去」）。
 */
export function replayShapes(
    ctx: Ctx2D,
    src: Ctx2D | null,
    shapes: readonly AnnotationShape[],
    width: number,
    height: number,
): void {
    for (const s of shapes) drawShape(ctx, src, s, width, height);
}
