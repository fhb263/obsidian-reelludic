/**
 * 学习模式的**纯逻辑**（单句循环 / AB 复读 / 影子跟读 / 查词键归一）。
 *
 * 🔴 用户 m01938 需求文档 §3.3 / §3.4 逐条对应的就是本模块：
 *   · 3.3「单句循环：双击任意字幕行，该句左侧出现一个 🔁 图标，视频在句子首尾之间反复播放。
 *          再次双击取消。」
 *   · 3.3「AB 复读：右键某句设为 A 点，另一句设为 B 点。顶部横幅 `A [00:12] ←→ B [00:45]`，
 *          视频在此区间循环。」
 *   · 3.4「影子跟读：视频播放完一句自动暂停，倒计时结束后自动播放下一句。」
 *
 * ⛔ 本模块**不碰 DOM、不碰 video、不碰 settings** —— 视图层只拿它算「该不该回跳 / 还剩几秒」，
 *    自己负责 seek 与画横幅。理由与其他 `pure/*` 一致：这些边界（4Hz 的 `timeupdate` 会冲过终点、
 *    倒计时到期要在 tick 里判而不是 `setTimeout`）最容易写错，必须能被单测按住。
 *
 * ⚠️ 与 `pure/subtitleCues` 的分工：那边管「解析 + 定位」（`activeCueIndex` / `formatStamp`），
 *    这边管「循环区间与跟读时序」。⛔ 别把 `activeCueIndex` 复制一份过来。
 */

/** 循环档位（工具条那颗单循环钮的三档） */
export type LoopKind = 'off' | 'cue' | 'ab';

/** AB 复读的两个端点（秒） */
export interface AbPoints {
    a: number;
    b: number;
}

/** 学习模式里一段「可循环的区间」（单句循环与 AB 复读共用） */
export interface LoopRange {
    start: number;
    end: number;
}

/**
 * AB 两点之间允许的最小间隔（秒）。
 *
 * 🔴 为什么要有下限而不是「只要 b > a 就行」：用户可能把 A 和 B 点在同一句的相邻两次点击上，
 *    于是 `b - a` 只有几十毫秒 ⇒ 视频在 20ms 区间里疯狂回跳，观感直接变成卡死。
 *    0.5s 是「一句话至少这么长」的经验值，短于此的区间一律视为无效（返回 null，
 *    调用方保持原状态而不是把一个坏区间装进去）。
 */
export const AB_MIN_GAP_SEC = 0.5;

/**
 * 判定「已经越过终点」的默认容差（秒）。
 *
 * 🔴 为什么不是 0：`timeupdate` 只有约 4Hz，而字幕行常常只有 1-2 秒 ——
 *    若严格用 `time >= end` 判定，指针必然已经冲进下一行 0~250ms，
 *    单句循环会把下一句的开头露出来再跳回去（用户看到的是「每轮都闪一下下一句」）。
 *    ⇒ 提前一点点收，宁可在句尾少放 60ms，也不要在下一句开头闪一帧。
 *    ⚠️ 也不能给大值（比如 0.3）：那会把最后半个词吃掉，用户听感上就是「句子被截断」。
 */
export const LOOP_LEAD_SEC = 0.06;

/** 影子跟读的倒计时档位（秒）：用户文档写「留白时长 3s」，这里给三档供切 */
export const SHADOW_GAP_CHOICES: readonly number[] = [1, 2, 3, 5];

/** 影子跟读默认留白（秒）—— 用户文档逐字「留白时长 3s」 */
export const SHADOW_GAP_DEFAULT = 3;

/**
 * 严格取数：**只认 `number` 与「确实像数字的字符串」**。
 *
 * 🔴 为什么不能用 `Number(raw)` 一把梭：`Number('')`、`Number(null)`、`Number([])`、`Number(false)`
 *    **全都等于 0** —— 「用户没填」会被算成「用户填了 0」。
 *    本模块两处都吃过这个亏：
 *    · `normalizeShadowGap('')` 会把「未配置」判成最近的 1s 档（静默改成最快）；
 *    · `makeAbPoints(null, 10)` 会产出一个 `a=0` 的合法区间（A 点凭空跑到片头）。
 *    ⇒ 未设置就是未设置，必须能被区分出来。
 */
function toNumberStrict(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    // 空串 / 全空白 ⇒ 未设置，⛔ 不是 0
    if (!s) return null;
    // 只接受纯数字字面量（可带正负号与小数），`'3s'` / `'0x10'` / `'1e2'` 一律不认
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/**
 * 把倒计时读数归一成合法档位。
 *
 * ⚠️ 非法输入**回落到默认 3s**而不是 1s：1s 对学外语几乎来不及开口，
 *    静默降级到最快那一档等于悄悄改掉用户的使用体验。
 */
export function normalizeShadowGap(raw: unknown): number {
    const n = toNumberStrict(raw);
    if (n === null) return SHADOW_GAP_DEFAULT;
    if (SHADOW_GAP_CHOICES.includes(n)) return n;
    // 落在两档之间 ⇒ 取最近的一档（用户手改配置文件写了 2.4 也不该直接作废）
    let best = SHADOW_GAP_CHOICES[0];
    let bestGap = Math.abs(n - best);
    for (const v of SHADOW_GAP_CHOICES) {
        const gap = Math.abs(n - v);
        if (gap < bestGap) {
            best = v;
            bestGap = gap;
        }
    }
    return best;
}

/**
 * 校验并构造 AB 区间。
 *
 * @returns 合法时返回 `{a,b}`（端点已排序、已夹到 ≥0）；两点缺失/非有限/间隔不足 `AB_MIN_GAP_SEC` ⇒ `null`
 */
export function makeAbPoints(a: unknown, b: unknown): AbPoints | null {
    const x = toNumberStrict(a);
    const y = toNumberStrict(b);
    if (x === null || y === null) return null;
    // 用户完全可能先点 B 再点 A（右键顺序不该有隐含方向）⇒ 这里自己排序，⛔ 不报错
    const lo = Math.max(0, Math.min(x, y));
    const hi = Math.max(0, Math.max(x, y));
    if (hi - lo < AB_MIN_GAP_SEC) return null;
    return { a: lo, b: hi };
}

/**
 * 由「A 点是第 i 句、B 点是第 j 句」构造区间（用的是字幕句的起止时间）。
 *
 * ⚠️ 语义取「从 A 句**开头**到 B 句**结尾**」而不是两个时间点：
 *    AB 复读的用途是「把这一段对话反复听」，切在句子中间没有意义。
 *    ⛔ 别用 `cues[i].start` + `cues[j].start`（B 点切在自己开头 = B 句一次都没播完）。
 */
export function abFromCues(
    cues: ReadonlyArray<{ start: number; end: number }>,
    i: number,
    j: number,
): AbPoints | null {
    if (!Number.isInteger(i) || !Number.isInteger(j)) return null;
    if (i < 0 || j < 0 || i >= cues.length || j >= cues.length) return null;
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const start = cues[lo].start;
    const end = cues[hi].end;
    // 同一句设 A 和 B ⇒ start===end 附近，makeAbPoints 会因间隔不足退回 null（正是想要的）
    return makeAbPoints(start, end);
}

/**
 * 当前档位对应的可循环区间。
 *
 * @param kind 档位
 * @param cue 当前**高亮那一句**（`off` / `ab` 档可以不传）
 * @param ab AB 端点
 */
export function loopRangeOf(kind: LoopKind, cue: LoopRange | null, ab: AbPoints | null): LoopRange | null {
    if (kind === 'cue') {
        if (!cue) return null;
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return null;
        // 单行时长为 0（坏字幕 / 只有时间戳没有正文）⇒ 不回跳，否则会变成原地死循环
        if (!(cue.end > cue.start)) return null;
        return { start: cue.start, end: cue.end };
    }
    if (kind === 'ab') {
        if (!ab) return null;
        return { start: ab.a, end: ab.b };
    }
    return null;
}

/**
 * 播放头越过区间终点时该跳回哪里；不该跳返回 `null`。
 *
 * 🔴 这是整个循环功能唯一的判定点 —— ⛔ 别在视图层再写一份 `time >= end`：
 *    容差、区间合法性、非有限数全都得在这里收口，否则早晚两处漂开。
 *
 * ⚠️ 调用方拿到非 null **必须**先置「正在回跳」标志再 seek：
 *    seek 落地前的下一次 tick 仍会读到越过终点的旧时间，不设标志就会连续 seek 好几帧。
 */
export function loopSeekTarget(
    kind: LoopKind,
    time: number,
    cue: LoopRange | null,
    ab: AbPoints | null,
    leadSec: number = LOOP_LEAD_SEC,
): number | null {
    // 播放头为 NaN/Infinity（内嵌态未就绪、时长未知）⇒ 一律不判，⛔ 别拿坏值去 seek
    if (!Number.isFinite(time)) return null;
    if (kind === 'off') return null;
    const range = loopRangeOf(kind, cue, ab);
    if (!range) return null;
    const lead = Number.isFinite(leadSec) && leadSec >= 0 ? leadSec : LOOP_LEAD_SEC;
    if (time < range.end - lead) return null;
    // 已经跳回区间内（或区间本身退化成零长）⇒ 不再重复 seek
    if (time < range.start) return null;
    return range.start;
}

/**
 * 影子跟读：**该暂停了**吗。
 *
 * 🔴 用户文档 §3.4：「视频播放完一句自动暂停。暂停时当前高亮句子下方出现倒计时进度条，
 *    倒计时结束后自动播放下一句。」⇒ 判定点就是「播放头到达当前句结尾」。
 *
 * @param on 跟读开关
 * @param time 当前播放头
 * @param cue 当前高亮句
 */
export function shadowShouldPause(
    on: boolean,
    time: number,
    cue: LoopRange | null,
    leadSec: number = LOOP_LEAD_SEC,
): boolean {
    if (!on) return false;
    if (!Number.isFinite(time) || !cue) return false;
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) return false;
    if (!(cue.end > cue.start)) return false;
    // 还没进入这一句（刚 seek 过来 / 播放头在句首之前）⇒ 不该暂停
    if (time < cue.start) return false;
    const lead = Number.isFinite(leadSec) && leadSec >= 0 ? leadSec : LOOP_LEAD_SEC;
    return time >= cue.end - lead;
}

/**
 * 影子跟读倒计时剩余毫秒（≥ 0）。
 *
 * ⚠️ 用「截止时刻 - 现在」而不是递减计数器：
 *    `timeupdate` 在暂停时**完全不触发**，递减计数器会永远停在初始值 ⇒ 视频再也不自动恢复。
 *    调用方应在 `requestAnimationFrame` 或定时器里重新取 `Date.now()`。
 */
export function shadowLeftMs(deadlineMs: number, nowMs: number): number {
    if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return 0;
    return Math.max(0, deadlineMs - nowMs);
}

/** 倒计时进度 0..1（0 = 刚开始，1 = 到期）；用于画那圈脉冲 / 进度条 */
export function shadowProgress(deadlineMs: number, nowMs: number, totalMs: number): number {
    if (!Number.isFinite(totalMs) || totalMs <= 0) return 1;
    const left = shadowLeftMs(deadlineMs, nowMs);
    return Math.min(1, Math.max(0, 1 - left / totalMs));
}

/**
 * 倒计时读数的显示文本（整数秒，向上取整）。
 *
 * 🔴 向上取整而不是四舍五入：3 秒档的读数应依次是 3、2、1 —— 四舍五入会让「3」只显示半秒，
 *    用户会觉得倒计时跳帧。
 */
export function shadowCountdownText(leftMs: number): string {
    if (!Number.isFinite(leftMs) || leftMs <= 0) return '0';
    return String(Math.ceil(leftMs / 1000));
}

/**
 * 字幕行里可查词的**归一化键**。
 *
 * 🔴 用户文档 §3.1：「鼠标 Hover 到某个英文单词，单词下方出现虚线下划线，并向上浮出气泡
 *    （显示音标、简短释义 + 🔊 发音）」。查词必须归一，否则 `Apple` / `apple` / `APPLE,`
 *    在词典里是三笔不同的账。
 *
 * ⚠️ 只做「小写 + 去首尾标点」，⛔ **不做词形还原**（`running` → `run`）：
 *    那是词典层的事（ECDICT 自带变形字段），在这里猜会把 `us`（我们）还原成 `u`。
 */
export function lookupKey(raw: string): string {
    if (typeof raw !== 'string') return '';
    // 标点按 Unicode 逐个剥（⛔ 不用 `\p{P}`：tsconfig target 是 ES6，不支持属性转义）
    let s = raw.trim();
    let from = 0;
    let to = s.length;
    while (from < to && isEdgePunct(s.charAt(from))) from++;
    while (to > from && isEdgePunct(s.charAt(to - 1))) to--;
    s = s.slice(from, to);
    return s.toLowerCase();
}

/**
 * 该不该给这个词出气泡。
 *
 * ⚠️ 纯数字、单字母、超长串都不出：
 *   · 纯数字是时间码/集数，没有释义可查；
 *   · 单字母（`a` / `I`）在词典里命中率极低，气泡只会挡住字幕；
 *   · 超长串是歌词里的连写或 URL 残片，查了也是空。
 */
export function isLookupable(key: string): boolean {
    if (!key) return false;
    if (key.length < 2 || key.length > 48) return false;
    // 至少一个字母（含 CJK —— 中文也能查，只是词典多半没有）
    return /[a-z\u00c0-\u024f\u3400-\u4dbf\u4e00-\u9fff]/i.test(key);
}

/** 首尾需要剥掉的标点（与 `pure/wordTiming` 的 `PUNCT_RE` 同源口径，但只判单个字符） */
function isEdgePunct(ch: string): boolean {
    if (!ch) return false;
    return /[!-/:-@[-`{-~，。、；：？！「」『』（）〔〕【】《》〈〉…—～·・,.;:?!'"()\[\]{}\-]/.test(ch);
}
