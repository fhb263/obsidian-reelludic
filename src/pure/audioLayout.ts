/**
 * 音频播放器三档自适应（2026-09-27 ④-4）—— **纯逻辑，无 `obsidian` / DOM 依赖**，可单测。
 *
 * ## 为什么是「按容器宽度分档」而不是媒体查询
 *
 * 播放器同时要活在**主区标签页**（宽）与**右侧边栏**（窄）里，而 Obsidian 里
 * **视图宽度 ≠ 窗口宽度** —— 侧栏收放、拖分隔条、分屏、把页签拖进侧栏都不改窗口尺寸
 * ⇒ `@media` 完全量不到真正的可用宽度。真源只能是容器的 `clientWidth` + `ResizeObserver`。
 *
 * ## 三档
 *
 * | 档位 | 宽度 | 布局（样式侧见 styles.css 的 `.rl-ap-*`） |
 * |------|------|------------------------------------------|
 * | `wide` | ≥ 720 | 左右两栏（左：封面 / 进度 / 控制；右：标题 + 歌词）；封面 200×200 |
 * | `medium` | 420–719 | 封面 88×88 与标题并排；控制行通栏；歌词在下 |
 * | `compact` | < 420（典型 = 右侧边栏） | 单列、**不显示封面**；标题 / 控制 / 歌词竖排 |
 *
 * 🔴 **未布局不提交**：视图刚挂载、或后台 leaf 重新可见的那一瞬间 `clientWidth` 是 0，
 * 此时「算档位」没有意义 —— 返回 `null` 让调用方**跳过这一轮**。
 * ⛔ 别把 0 当成 `compact`：那会先画一帧窄档布局再跳回宽档，观感就是「打开先闪一下」。
 *
 * ⚠️ 本轮**不做**「倍速入口」「续播位置」（D-10 后置）：音量与倍速的档位真源在仓内
 * `pure/player.ts`（`SPEED_STEPS` / `clampVolume`），⛔ 不要再引入第二套档位表。
 */

/** 播放器布局档位 */
export type AudioLayoutTier = 'wide' | 'medium' | 'compact';

/** 全部档位（宽 → 窄；样式侧 `[data-tier="…"]` 按它取值） */
export const AUDIO_LAYOUT_TIERS: readonly AudioLayoutTier[] = ['wide', 'medium', 'compact'];

/** 宽档下限（**含**）：`width >= 720` ⇒ `wide` */
export const AUDIO_LAYOUT_WIDE_MIN = 720;

/** 中档下限（**含**）：`420 <= width < 720` ⇒ `medium`；更窄 ⇒ `compact` */
export const AUDIO_LAYOUT_MEDIUM_MIN = 420;

/**
 * 容器宽度 → 档位；**宽度不可用时返回 `null`**（调用方据此跳过本轮、保持上一次的 `data-tier`）。
 *
 * 🔴 `Infinity` / `NaN` 也归入 `null`：它们不是「很宽的容器」，而是量测出错
 * （`clientWidth` 只会是有限值）—— 按「很宽」处理会把布局顶到宽档且再不回退。
 */
export function resolveAudioLayout(width: number): AudioLayoutTier | null {
    if (!Number.isFinite(width) || width <= 0) return null;
    if (width >= AUDIO_LAYOUT_WIDE_MIN) return 'wide';
    if (width >= AUDIO_LAYOUT_MEDIUM_MIN) return 'medium';
    return 'compact';
}

/** 一条矩形（只用到 `getBoundingClientRect()` 的这两个字段） */
export interface AudioLayoutRect {
    top: number;
    height: number;
}

/**
 * 把「当前歌词行」推到列表**垂直正中**所需的 `scrollTop` 增量。
 *
 * 🔴 **必须用「两条 rect 的差值」，⛔ 不能用 `行.offsetTop - 列表.offsetTop`** ——
 * 歌词行自身带 `position: relative`（高亮行前面的 `▸` 标记靠它定位），于是行的 `offsetTop`
 * 是相对**最近的定位祖先**（实测就是 `body`）而非列表 ⇒ 拿它当「距列表顶的距离」会把
 * `scrollTop` 顶到最大值，当前行被推到视口**上方**（仿真实测偏差 −35 / −68 / −165px）。
 *
 * 调用方按 `list.scrollTop = Math.max(0, list.scrollTop + lyricCenterDelta(...))` 应用；
 * 差值本身**可正可负**（行在中心下方 ⇒ 正 ⇒ 往下滚），符号即方向，⛔ 不要在这里夹零。
 *
 * 脏 rect（非有限值）⇒ 返回 0（不动比乱动好：乱动会把用户的滚动位置顶飞）。
 */
export function lyricCenterDelta(cur: AudioLayoutRect, list: AudioLayoutRect): number {
    const curMid = cur.top + cur.height / 2;
    const listMid = list.top + list.height / 2;
    const delta = curMid - listMid;
    return Number.isFinite(delta) ? delta : 0;
}
