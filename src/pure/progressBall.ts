/**
 * 悬浮进度球：纯逻辑（不算样式、不碰 DOM）。
 *
 * 🔴 用户 m01938 逐字：「悬浮进度球（用户点击了"音频转文字"后，切到了别的笔记去工作。转写需要几分钟。）」
 *
 * 场景决定了三条硬约束（都体现在下面的函数里）：
 *  ⑴ **必须活过视图生命周期**。用户切走了笔记，播报任务的那个视图可能已经被卸载 ——
 *     所以球是挂在 `document.body` 上的单例，任何视图都可往里上报；
 *  ⑵ **百分比可以缺席**。不是所有长任务都有总进度（转写、下载、批处理都可能只见阶段文本）
 *     ⇒ `percent` 允许 `null`，`ballText` 这时给省略号而不是伪造一个 0%；
 *  ⑶ **文案要能截短**。球很小，阶段文本（「正在本地识别 1:20 / 5:00」）塞不下 ——
 *     截断规则放这里，视图层只管显示。
 */

/** 一次上报的完整状态。 */
export interface ProgressBallState {
    /** 阶段文本，如「正在本地识别」 */
    label: string;
    /** 0..100；`null` = 只有阶段、没有可算的百分比 */
    percent: number | null;
    /** 可选的补充细节（如「1:20 / 5:00」） */
    detail?: string;
}

/** 收尾态：显示一小会儿再自己消失。 */
export type ProgressBallEnd = 'done' | 'fail';

/**
 * 卡片顶部的动作按钮。
 *
 * 🔴 用户 m10634 逐字：「这个下载模型悬浮球怎么点一下就消失不见了，而且应该参考主流市面方案的悬浮球的进度框」
 *
 * m01938 当初把「点击 = 收起」写成规格，是因为那时球只有 36px、纯装饰；
 * 但一旦它承担「下载 465MB 模型」这种十几分钟的任务，点一下就没了等于**把唯一的进度入口消耗掉**。
 * 主流做法（Chrome 下载、VS Code、各类客户端）是：点一下**在展开卡片与收起小球之间切换**，
 * 而不是销毁；真正取消任务要有独立按钮、且要二次确认。
 */
export type BallAction = 'minimize' | 'expand' | 'cancel';

/** 收起态只留一个小球，展开态是一张卡片。 */
export type BallMode = 'card' | 'pill';

/**
 * 点一次会切到哪个形态。
 *
 * ⚠️ 收尾态（`done`/`fail`）点一下 = 直接关掉（那时没有任务在跑，留着只是碍事）。
 * ⛔ 收尾态不提供「取消」，因为没东西可取消。
 */
export function nextMode(mode: BallMode, ended: boolean): BallMode | null {
    if (ended) return null;
    return mode === 'card' ? 'pill' : 'card';
}

/** 按钮文案（`aria-label` 与 tooltip 共用，⛔ 别在服务层另写一套）。 */
export function actionLabel(action: BallAction): string {
    if (action === 'minimize') return '收起进度（任务继续）';
    if (action === 'expand') return '展开进度';
    return '取消';
}

/**
 * 进度卡片上的标题（只有「在做什么」，**不重复百分比**）。
 *
 * 🔴 真渲染量测抓到的缺陷：第一版把百分比也拼进标题，而卡片右下角已经有一个独立的
 *    百分比位 ⇒ 同一张卡上「42%」出现两次，还把标题挤到截断（`scrollWidth > clientWidth`）。
 *    百分比只该有一个位置：`.rl-pball-pct`。
 * ⚠️ 完全没有阶段文案时给「进行中」，⛔ 不给空串（空标题会让卡片头部塌成一条线）。
 */
export function ballTitle(label: string): string {
    const s = (label ?? '').trim();
    return s || '进行中';
}

/**
 * 进度条填充比例（0..100）。
 *
 * ⚠️ 无百分比时返回 **null**，由渲染层改成不确定态（跑马灯）——
 *    ⛔ 不要返回一个假的 0 让条看起来停住，也不要返回 100 让它看起来快好了。
 * ⚠️ 与 `arcRatio`（收起态小球的环）分开：那个无百分比时返 `BALL_IDLE_ARC`（要画一小段弧），
 *    这里返 null（渲染层要换成动画），语义不同，⛔ 别合并。
 */
export function barPercent(percent: number | null): number | null {
    return clampPercent(percent);
}

/** 百分比夹到 0..100 并取整；非有限数返回 `null`（**不是** 0 —— 0% 是「真的一点没做」的假结论）。 */
export function clampPercent(percent: number | null | undefined): number | null {
    if (percent === null || percent === undefined) return null;
    if (!Number.isFinite(percent)) return null;
    return Math.min(100, Math.max(0, Math.round(percent)));
}

/**
 * 球面中央显示的文字。
 *
 * ⚠️ 无百分比时给「…」而不是「0%」：转写刚起步那几分钟算不出百分比，
 *    显示 0% 会让用户以为卡死了。
 */
export function ballText(percent: number | null): string {
    const p = clampPercent(percent);
    return p === null ? '…' : `${p}%`;
}

/** 悬浮提示 / 读屏文案：阶段 + 细节 + 百分比拼一句。 */
export function ballTip(state: ProgressBallState): string {
    const p = clampPercent(state.percent);
    const parts: string[] = [];
    if (state.label) parts.push(state.label);
    if (state.detail) parts.push(state.detail);
    parts.push(p === null ? '进行中' : `${p}%`);
    return parts.join(' · ');
}

/**
 * 阶段文案截短。
 * 球只有几十像素宽，`data-tip` 里放全文、球上放短版 —— 否则长文案会把球撑成一长条。
 */
export const BALL_LABEL_MAX = 14;

export function shortLabel(label: string, max = BALL_LABEL_MAX): string {
    const s = (label ?? '').trim();
    if (!s) return '';
    const chars = Array.from(s);
    if (chars.length <= max) return s;
    return `${chars.slice(0, max).join('')}…`;
}

/** 收尾文案（完成/失败各一句）。 */
export function endTip(kind: ProgressBallEnd, message?: string): string {
    const msg = (message ?? '').trim();
    if (kind === 'done') return msg ? `完成：${msg}` : '完成';
    return msg ? `失败：${msg}` : '失败';
}

/**
 * 环形进度图（SVG 用）。
 *
 * 返回的是「已走完的那段弧长占周长的比例」，`0..1`。
 * ⚠️ 无百分比时返回 **0.18** 而不是 0：留一小段固定弧当「在转」的视觉暗示，
 *    否则球看起来是空的、跟没启动一样。
 */
export const BALL_IDLE_ARC = 0.18;

export function arcRatio(percent: number | null): number {
    const p = clampPercent(percent);
    if (p === null) return BALL_IDLE_ARC;
    return p / 100;
}
