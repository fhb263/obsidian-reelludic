/**
 * 统计页「标签词云」的**摆放**逻辑（2026-11-15 用户 m04642 ①）。
 *
 * ## 用户口径（逐字）
 * 「这个词云统计应该按参考 `@isoterik/react-word-cloud`、`araea-wordcloud` 实现词云效果
 *   在有限空间内"见缝插针"」
 *
 * ⇒ 改前是 `display: flex; flex-wrap: wrap` 的**行内流式**排布：一行填满换下一行，
 *   于是每行底部留一条锯齿状空带、大词被小词挤到行尾、整块高度随词数暴涨 ——
 *   这正是用户说的「没有见缝插针」。
 *   ⛔ 别再退回 flex-wrap：那是「排版」不是「词云」。
 *
 * ## 做法（与上面两个库同源，但零依赖手写）
 *   · **阿基米德螺旋**从画布中心向外找位（`r = a · θ`）：中心留给最大的词，
 *     越往外越宽裕，天然形成"核心词居中、长尾铺四周"的视觉；
 *   · **每个候选位做碰撞检测**（矩形 + `gap` 膨胀），撞了就沿螺旋前进一格再试；
 *   · **放不下就降档重排**（`autoFit`）：整块先按原字号试，丢词超过阈值就整体缩 8% 再试，
 *     最多缩到 72% —— 这样"有限空间"里能塞下的词数最大化，而不是简单地截断尾巴。
 *
 * ## 为什么是纯模块（⛔ 别把这套写进 .svelte）
 *   · 摆放结果是 `{x, y, width, height}` 的纯数据，可以单测断言「两两不重叠」「全在框内」；
 *   · 组件只负责量一个容器宽度、把结果写成 `left/top`，逻辑不进 DOM 才能被突变测试打中。
 *
 * ⚠️ **文字宽度靠估算**（`estimateTextWidth`），不能真去 `measureText`：
 *    纯函数里没有 canvas，真量就得把布局塞回组件、又会变成不可测的东西。
 *    估算按「CJK 全角 = 1em、ASCII ≈ 0.55em、空格 ≈ 0.28em」的经验比例，
 *    再在碰撞检测里留 `gap` 兜住误差。
 */

/** 摆放用的输入词（与 `WordCloudItem` 同形，这里只依赖这三个字段） */
export interface CloudLayoutWord {
    text: string;
    /** 频次（只用于稳定排序，不参与几何） */
    weight: number;
    /** 字号档位 1..5 */
    level: number;
}

/** 一个已摆好的词（组件只读这五个几何字段） */
export interface CloudPlacedWord extends CloudLayoutWord {
    /** 左上角 x（画布坐标系） */
    x: number;
    /** 左上角 y */
    y: number;
    width: number;
    height: number;
    /** 该词最终使用的字号（px，已含 autoFit 的缩放） */
    fontPx: number;
}

export interface CloudLayoutResult {
    placed: CloudPlacedWord[];
    /** 空间不足、怎么缩都放不下的词（组件可据此提示，⛔ 静默丢弃会让人以为标签丢了） */
    dropped: string[];
    width: number;
    height: number;
    /** 实际用上的字号缩放（1 = 没缩） */
    scale: number;
}

export interface CloudLayoutOptions {
    /** 画布宽（px）。组件传入容器实测宽 */
    width: number;
    /** 画布高（px）。缺省按宽度算，见 `cloudHeightFor` */
    height?: number;
    /** 基准字号（px，= 容器计算后的 font-size）。缺省 13 */
    basePx?: number;
    /** 词与词之间至少留多少 px（碰撞检测时对矩形膨胀） */
    gap?: number;
    /** 画布四边至少留多少 px */
    padding?: number;
    /** 螺旋每步的角增量（弧度）。越小越密但越慢 */
    thetaStep?: number;
    /** 螺旋最多转多少弧度 */
    maxTheta?: number;
}

/**
 * 字号档位 → `em` 倍数。
 *
 * 🔴 **必须与 `StatsBoard.svelte` 里 `.rl-cloud-w.lv-N` 的 `font-size` 逐档一致** ——
 * 这里算错，碰撞检测就会按一个尺寸判重叠、浏览器按另一个尺寸渲染，于是「看着明明没碰却躲开了」。
 * 改 CSS 记得同步改这里（`tests/wordCloudLayout.test.ts` 有跨文件守卫盯着）。
 */
export const CLOUD_LEVEL_EM = [0.82, 0.95, 1.1, 1.3, 1.55] as const;

/** `autoFit` 依次尝试的字号缩放（1 → 0.72，共 5 档） */
export const CLOUD_FIT_SCALES = [1, 0.92, 0.85, 0.78, 0.72] as const;

/** 丢词率超过这个比例就降档重排（0.25 = 四分之一没放下） */
export const CLOUD_DROP_TOLERANCE = 0.25;

/** 行高倍数（与 CSS `line-height: 1.5` 里的字身部分大致对应；碰撞框宁大勿小） */
const LINE_HEIGHT = 1.28;

/** 单个字符的宽度估算（px） */
function charWidthPx(ch: string, fontPx: number): number {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xa000 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6);
    if (wide) return fontPx;
    if (ch === ' ' || ch === '\u3000') return fontPx * 0.28;
    return fontPx * 0.55;
}

/**
 * 估算一段文字在给定字号下占多宽（px）。
 *
 * ⚠️ 估算必然有误差（字体、字重、字距、主题字号都会影响）。真正的护栏是 `gap`：
 *    碰撞检测用的是「估算宽 + gap」，只要 `gap` 不小于典型误差就不会出现视觉重叠。
 */
export function estimateTextWidth(text: string, fontPx: number): number {
    const s = String(text ?? '');
    let w = 0;
    for (const ch of s) w += charWidthPx(ch, fontPx);
    return w;
}

/** 档位 → 未缩放字号（px） */
export function fontPxOfLevel(level: number, basePx: number): number {
    const lv = Math.max(1, Math.min(CLOUD_LEVEL_EM.length, Math.floor(Number(level) || 1)));
    return basePx * CLOUD_LEVEL_EM[lv - 1];
}

/**
 * 给定画布宽，推荐高度。
 *
 * 目标是「一块面板的高度」而不是方图：统计页里词云是一整块窄条，
 * 太高会把下面的区块挤走，太矮又会大量丢词。0.42 的经验比例在 320~900px 宽区间都合适。
 */
export function cloudHeightFor(width: number): number {
    const w = Math.max(0, Number(width) || 0);
    if (w <= 0) return 220;
    return Math.max(200, Math.min(340, Math.round(w * 0.42)));
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
    const ax = a.x - gap;
    const ay = a.y - gap;
    const aw = a.width + gap * 2;
    const ah = a.height + gap * 2;
    return ax < b.x + b.width && b.x < ax + aw && ay < b.y + b.height && b.y < ay + ah;
}

/**
 * 在给定画布内按螺旋摆放词。
 *
 * @returns 已摆好的词（顺序 = 输入的降字号序）、放不下的词、实际缩放
 */
export function layoutWordCloud(words: readonly CloudLayoutWord[], opts: CloudLayoutOptions): CloudLayoutResult {
    const width = Math.max(0, Number(opts.width) || 0);
    const height = Math.max(0, Number(opts.height ?? cloudHeightFor(width)) || 0);
    const basePx = Math.max(1, Number(opts.basePx) || 13);
    const gap = Math.max(0, Number(opts.gap ?? 4) || 0);
    const padding = Math.max(0, Number(opts.padding ?? 4) || 0);
    const thetaStep = Math.max(0.05, Number(opts.thetaStep) || 0.18);
    const maxTheta = Math.max(Math.PI, Number(opts.maxTheta) || Math.PI * 26);

    const list = Array.isArray(words) ? words.filter((w) => w && String(w.text ?? '').trim()) : [];
    const empty = (scale: number): CloudLayoutResult => ({ placed: [], dropped: list.map((w) => w.text), width, height, scale });

    if (width <= 0 || height <= 0) return empty(1);
    if (list.length === 0) return { placed: [], dropped: [], width, height, scale: 1 };

    /** 大词先摆（天然占中心），同字号按频次降序 —— 保证结果稳定、可单测 */
    const ordered = [...list].sort((a, b) => (b.level - a.level) || (b.weight - a.weight));

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;
    if (innerW <= 4 || innerH <= 4) return empty(1);

    const cx = padding + innerW / 2;
    const cy = padding + innerH / 2;
    /** 螺旋最远要能触到画布四角，否则大画布里长尾永远找不到位置 */
    const maxRadius = Math.hypot(innerW, innerH) / 2;
    const armA = maxRadius / maxTheta;

    const runOnce = (scale: number): CloudLayoutResult => {
        const placed: CloudPlacedWord[] = [];
        const dropped: string[] = [];

        for (const word of ordered) {
            const fontPx = fontPxOfLevel(word.level, basePx) * scale;
            const w = Math.min(innerW, estimateTextWidth(word.text, fontPx));
            const h = fontPx * LINE_HEIGHT;
            if (w <= 0 || h > innerH) {
                dropped.push(word.text);
                continue;
            }

            let hit: CloudPlacedWord | null = null;
            for (let theta = 0; theta <= maxTheta; theta += thetaStep) {
                const radius = armA * theta;
                /** 椭圆化：横向画布按 y 方向压缩，让词先铺满宽度再往上下走 */
                const x = cx + radius * Math.cos(theta) - w / 2;
                const y = cy + radius * Math.sin(theta) * (innerH / innerW) - h / 2;

                if (x < padding || y < padding || x + w > width - padding || y + h > height - padding) {
                    /** 已经飞出画布且半径还在涨 ⇒ 这一档缩放下不可能再放进去 */
                    if (radius > maxRadius) break;
                    continue;
                }
                const rect: Rect = { x, y, width: w, height: h };
                if (placed.some((p) => overlaps(rect, p, gap))) continue;

                hit = { ...word, x, y, width: w, height: h, fontPx };
                break;
            }

            if (hit) placed.push(hit);
            else dropped.push(word.text);
        }

        return { placed, dropped, width, height, scale };
    };

    /** 先按原字号试；丢太多就整体降档，取「丢词最少」的那次（同样好时优先大的） */
    let best = runOnce(1);
    if (best.dropped.length > 0) {
        const tolerance = Math.floor(ordered.length * CLOUD_DROP_TOLERANCE);
        if (best.dropped.length > tolerance) {
            for (const scale of CLOUD_FIT_SCALES.slice(1)) {
                const next = runOnce(scale);
                if (next.dropped.length < best.dropped.length) best = next;
                if (best.dropped.length <= tolerance) break;
            }
        }
    }
    return best;
}
