/**
 * 🔴 m08028：LRC **整体时间戳偏移**的纯逻辑（无 `obsidian` 依赖，可单测）。
 *
 * 用户逐字：「出一个对LRC歌词整体所有时间戳向后加N秒的功能以对齐歌曲与LRC歌词不对齐的功能」。
 *
 * ## 两种用法（同一份真源，两条路径）
 *  ⑴ **播放器实时偏移**（不改文件）：`shiftLrcLines` 给解析结果整体加 `deltaMs`，
 *     画面立刻对齐 —— 边听边校，不满意接着调。
 *  ② **写回笔记**（改文件）：`shiftLrcText` 直接重写文本里的时间标签，
 *     校好之后一次落盘，以后再打开就是对的。
 *
 * ## 为什么写回必须「重写文本」而不是「写个 offset 头」
 *  LRC 规范里 `[offset:]` 表示的是「**有效时间 = 标签时间 − offset**」，`+` 提前、`-` 延后
 *  （见 `pure/lrc.ts` 的 `meta.offset` 解析）。而我们这里要的是「LRC 比歌慢了 N 秒 ⇒
 *  把每个时间戳**加** N 秒」。两者方向相反、且 `[offset:]` 只允许一个全局值 ——
 *  用 offset 表达会引入方向和范围两处心智负担（`LRC_OFFSET_LIMIT = 60_000` 还会把大偏移吃掉）。
 *  直接重写标签时间最直白：用户打开 `.lrc` 或笔记能看到数字真的变了，没有隐藏状态。
 *
 * ## 改写边界（⛔ 只碰行首那串时间标签，其余一个字符都不动）
 *  - `[ti:]` `[ar:]` `[al:]` `[by:]` `[offset:]` 等 kv 头 → **原样保留**；
 *  - `[Gold]`（`pure/lrc.LRC_GOLD_TAG` 同口径）→ 原样保留在原来的位置上；
 *  - 双语竖线、行内标注、`<mm:ss.xx>` 逐字时间 → **全部不动**（逐字时间是相对绝对时间，
 *    跟着行时间一起平移才对；这里刻意不缩写它们，因为解析侧会按 `[offset:]` 统一叠加，
 *    逐字时间并不参与解析后的 `lines[i].timestamp` 计算，改动它只会让文件更难读）；
 *  - 一行多个时间标签（`[00:12.00][00:45.00]副歌`）→ **逐个都加**（副歌复用同句是 LRC 常态）。
 */

import { formatClock, parseClock, type LrcLine } from 'pure/lrc';

/** 行首方括号标签（与 `pure/lrc.LRC_TAG` 同口径；这里**不** import 常量是因为那边没导出） */
const TAG_RE = /^\s*\[([^\]]*)\]/;
/**
 * 时间标签形态：`mm:ss` / `mm:ss.xx` / `hh:mm:ss.xx`。
 * ⚠️ 必须支持**三段式**：`formatClock` 在超一小时时吐 `hh:mm:ss`，而用户也可能手写这种。
 *    只认两段式的话，超过一小时的歌词行会「原地不动」—— 那是最难看出来的错位。
 */
const TIME_RE = /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/;

/**
 * 这个时间标签**值**是否合法（秒必须 < 60，`hh:mm:ss` 的分钟也必须 < 60）。
 *
 * 🔴 为什么不能只靠 `TIME_RE`：它只管「长得像」，而 `pure/lrc.parseClock` **不做范围校验**
 *    （`parseClock('99:99')` 会老实返回 6039 秒）。于是 `[99:99]` 这种畸形标签会被我们的
 *    加法当成真时间改写成 `[01:40:40]` —— 对一条**本来就没有意义**的数据做「正确的算术」，
 *    结果比原样不动更糟：用户看不出哪个值是他写的、哪个是我们算出来的。
 *    ⇒ 畸形标签一律**字节不变**，由用户自己判断。
 * ⚠️ 分钟**允许**超过 59（`[75:30]` 在 LRC 里是合法的长曲写法），所以只卡秒位与 `hh` 形态的分钟位。
 */
function isWellFormedClockTag(tag: string): boolean {
    if (!TIME_RE.test(tag)) return false;
    const parts = tag.split(':');
    const ss = parseFloat(parts[parts.length - 1]);
    if (!Number.isFinite(ss) || ss >= 60) return false;
    if (parts.length === 3) {
        const mm = parseInt(parts[1], 10);
        if (!Number.isFinite(mm) || mm >= 60) return false;
    }
    return true;
}

/**
 * 单个时间标签的「加 N 毫秒」。
 *
 * 🔴 三条真机口径：
 *  ⑴ **保留原始小数位数**：`[00:12.00]` 加完仍是两位小数（`[00:15.50]`），
 *     ⛔ 不要一律吐 `formatClock` 的整秒形态 —— 那会把 `[00:12.50]` 悄悄抹成 `[00:12]`，
 *     用户看到「我只加了 1 秒，怎么毫秒没了」；
 *  ② **负数夹到 0**：LRC 没有负时间轴，往前挪超头只能停在 `00:00`（与 `formatClock` 同口径）；
 *  ③ **跨小时自然进位**：`formatClock` 已处理 `hh:mm:ss`，这里只管小数。
 */
export function shiftClockTag(tag: string, deltaMs: number): string {
    // 🔴 畸形标签（秒 ≥ 60 等）⇒ **字节不变**。`parseClock` 不做范围校验，
    //    `[99:99]` 会被算成 6039 秒再吐成 `[01:40:40]` —— 对坏数据做「正确的算术」
    //    反而造出一个看不出是错的错值。⛔ 别在这里退回 00:00 或原样累加。
    if (!isWellFormedClockTag(tag)) return tag;
    const sec = parseClock(tag);
    // 非法时间标签（`[99:99]` 这类）⇒ 原样返回，⛔ 别把它清成 00:00（会改成「合法但错误」的值）
    if (!Number.isFinite(sec)) return tag;
    const ms = Math.max(0, Math.round(sec * 1000) + (Number.isFinite(deltaMs) ? deltaMs : 0));
    const base = formatClock(ms / 1000);
    // 原标签带小数 ⇒ 补回同样位数（`formatClock` 只到整秒）
    const dot = tag.indexOf('.');
    if (dot < 0) return base;
    // ⚠️ 超过 3 位小数没有物理意义（LRC 规范是厘秒）⇒ 按 3 位截断，别让 `10 ** (3 - digits)` 掉进小数
    const digits = Math.min(3, tag.length - dot - 1);
    if (digits <= 0) return base;
    // 🔴 这里**必须**是 `10 ** (3 - digits)`（厘秒 → 十位/百位/毫秒档）。
    //    写成 `1000 ** (3 - digits)` 会把 `[00:12.50]`+2s 算成 `00:14.00`（小数位永远为 0）——
    //    正是单测「两位小数标签 ⇒ 小数位原样保留」钉住的那条。
    const frac = String(Math.floor((ms % 1000) / 10 ** (3 - digits))).padStart(digits, '0');
    return `${base}.${frac}`;
}

/**
 * 重写整段 LRC 文本里的所有行首时间标签。
 *
 * `deltaMs > 0` = 整体**延后**（LRC 比歌快、字先出现就往下加）；`< 0` = 整体提前。
 * 非法 `deltaMs`（NaN / 非数）⇒ 原样返回，⛔ 别当 0 去重写一遍（会白改文件的字节）。
 */
export function shiftLrcText(text: string, deltaMs: number): string {
    const src = String(text ?? '');
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return src;
    // ⚠️ 保留原始换行风格：本仓笔记里的 lrc 块可能是 CRLF（Windows 用户手改过），
    //    统一成 \n 会让「只加 1 秒」变成整个文件的行尾大改。
    const crlf = src.includes('\r\n');
    const lines = src.split(crlf ? /\r\n/ : '\n');
    const out = lines.map((line) => {
        let rest = line;
        let prefix = '';
        // 逐段剥行首标签：只重写「时间标签」，其余标签原样接回
        for (;;) {
            const m = rest.match(TAG_RE);
            if (!m) break;
            const inner = m[1].trim();
            const tagText = m[0];
            // ⚠️ 畸形标签（`[99:99]`）与 kv 头、`[Gold]` 一样**原样保留**：
            //    对坏数据做「正确的算术」会造出一个看不出是错的错值（见 `isWellFormedClockTag`）。
            if (!isWellFormedClockTag(inner)) {
                prefix += tagText;
                rest = rest.slice(tagText.length);
                continue;
            }
            prefix += tagText.slice(0, tagText.indexOf('[')) + '[' + shiftClockTag(inner, deltaMs) + ']';
            rest = rest.slice(tagText.length);
        }
        return prefix + rest;
    });
    return out.join(crlf ? '\r\n' : '\n');
}

/**
 * 渲染侧偏移：把解析结果的每一行时间（含逐字时间）整体平移。
 *
 * ⚠️ 返回**新数组 + 新行对象**，⛔ 不原地改 —— `lines` 被 `lrcIndexAt` 反复读取，
 * 原地改会让「调回 0」变成不可逆（偏移量只能单向累加）。
 */
export function shiftLrcLines(lines: readonly LrcLine[], deltaMs: number): LrcLine[] {
    if (!Number.isFinite(deltaMs) || deltaMs === 0) return lines.map((l) => ({ ...l }));
    return lines.map((l) => {
        const timestamp = Math.max(0, Math.round(l.timestamp + deltaMs));
        const next: LrcLine = { ...l, timestamp, timestr: formatClock(timestamp / 1000) };
        if (l.words?.length) {
            next.words = l.words.map((w) => ({ ...w, timestamp: Math.max(0, Math.round(w.timestamp + deltaMs)) }));
        }
        return next;
    });
}

/** 偏移量文案（`+1.5s` / `-0.5s` / `0s`）—— 浮层顶部读数与按钮 aria 共用 */
export function lyricOffsetLabel(ms: number): string {
    const n = Number.isFinite(ms) ? ms : 0;
    if (n === 0) return '0s';
    const sec = n / 1000;
    // 整秒不显示小数点（`+2s` 比 `+2.0s` 好读）；半秒档保留一位
    const text = Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
    return `${n > 0 ? '+' : ''}${text}s`;
}

/** 偏移量夹取范围（**±30 秒**）——
 *  真实错位很少超过这个量级（超过通常是拿错了歌词文件，该换文件而不是硬挪）；
 *  再放开会让用户一格格点到天荒地老，也让「重置」变成唯一出路。 */
export const LYRIC_OFFSET_LIMIT = 30_000;
/**
 * 细档步长（浮层里 `<` / `>` 一次挪这么多）。
 *
 * 🔴 m08754 用户改判：「把偏移值按改成 -+0.1s、1s 调整：UI 按 `<<  <  0s  >  >>` 显示」
 *    ⇒ 从原来单一的 0.5s 拆成**细 0.1s + 粗 1s** 两档。0.1s 是听感上「刚好能对上」的最小刻度
 *    （音乐卡农/现场版错位常在半秒以内），而 1s 用来快速跨过整段前奏/间奏。
 * ⚠️ 本常量同时是 {@link clampLyricOffset} 的**吸附网格**（下面直接拿它取整）——
 *    换成 100 之后网格一并从 0.5s 变 0.1s，所以 `1200ms` 不再被吸成 `1000ms`。
 *    这是有意的：细档既然能落到 0.1，网格就不该再把它吃掉。
 */
export const LYRIC_OFFSET_STEP = 100;

/** 粗档步长（浮层里 `<<` / `>>` 一次挪这么多 —— 整秒跨段用） */
export const LYRIC_OFFSET_COARSE = 1000;

/** 把任意偏移量夹到 ±30s 并对齐 0.1s 网格（幂等：`clamp(clamp(x)) === clamp(x)`） */
export function clampLyricOffset(ms: number): number {
    if (!Number.isFinite(ms)) return 0;
    const snapped = Math.round(ms / LYRIC_OFFSET_STEP) * LYRIC_OFFSET_STEP;
    const out = Math.max(-LYRIC_OFFSET_LIMIT, Math.min(LYRIC_OFFSET_LIMIT, snapped));
    return Object.is(out, -0) ? 0 : out;
}

/** localStorage 键前缀（后接 `entryId`）—— 与 `lyricZoom.LYRIC_SCALE_KEY` 同风格 */
export const LYRIC_OFFSET_KEY_PREFIX = 'rl-ap-lyric-offset:';

/** 读某条目的偏移量（localStorage 不可用 / 未存 / 非法 ⇒ 0） */
export function loadLyricOffset(entryId: string): number {
    if (!entryId) return 0;
    try {
        const raw = localStorage.getItem(LYRIC_OFFSET_KEY_PREFIX + entryId);
        if (raw === null) return 0;
        const n = Number(raw);
        return Number.isFinite(n) ? clampLyricOffset(n) : 0;
    } catch {
        return 0;
    }
}

/**
 * 写某条目的偏移量。
 * 归零 ⇒ **删键**（⛔ 别留一堆 `key = "0"`：库大了会白占 localStorage 配额，
 * 而且 `loadLyricOffset` 读不到与读到 0 语义相同，留着没有信息量）。
 */
export function saveLyricOffset(entryId: string, ms: number): void {
    if (!entryId) return;
    try {
        const v = clampLyricOffset(ms);
        if (v === 0) localStorage.removeItem(LYRIC_OFFSET_KEY_PREFIX + entryId);
        else localStorage.setItem(LYRIC_OFFSET_KEY_PREFIX + entryId, String(v));
    } catch {
        /* 写不进就不记 */
    }
}
