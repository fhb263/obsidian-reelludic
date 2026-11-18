/**
 * 微信读书**划线与想法**的纯函数层（用户 2026-11-12 m00353 ②-4）。
 *
 * 用户原话：「参考 obs 插件 `hankzhao/Weread`，实现同步微信读书时把对应书目的划线与高亮
 *   批注写入单独条目笔记（`### 同步划线与高亮`）下」。
 *
 * 参考实现：`zhaohongxuan/obsidian-weread-plugin` 的 `src/api.ts` / `src/models.ts`
 *   （2026-11-12 实读源码，字段签名逐字核对）。本模块只做「URL 拼装 + 响应解析 + Markdown 渲染」，
 *   发请求在 `services/weread`（本仓既定分层：pure 可单测、service 管传输）。
 *
 * 🔴 三条口径：
 *   ⑴ **区名必须是 `同步划线与高亮`**，⛔ 不能叫「高亮」—— #528（2026-10-05）用户裁定
 *      「本地阅读器的高亮数据仅保存在阅读进度文件里」，笔记里的 `## 高亮` 镜像已废。
 *      这里是**微信读书云端**的划线，语义完全不同，同名会让两者互相覆盖。
 *   ⑵ **解析失败不许静默当「没有划线」** —— 返回 `error` 文案，由调用方如实显示。
 *      2026-11-12 实测：`bookmarklist` 无数据时回 `{}`（合法但空），`-2012` 回登录超时，
 *      这两种必须分开报告，否则用户以为「同步成功但一本书都没划线」。
 *   ⑶ 渲染出来的 markdown **每一行都以 `>` 或空行开头**（引用块）—— 划线原文可能以 `#` / `##`
 *      开头，裸文本会伪造出一级/二级标题，把 `## 同步划线与高亮` 区段直接截断（静默丢后续内容）。
 */
/** 微信读书错误响应的最小形状（`errCode !== 0` 即错误；`-2010` 未登录，`-2012` 登录超时）。 */
interface WereadErrRoot {
    errCode?: number;
    errMsg?: unknown;
}

/** 划线（个人读书笔记里的「划线」） */
export const WEREAD_BOOKMARK_URL = 'https://weread.qq.com/web/book/bookmarklist';
/** 想法（个人批注；`listType=11&mine=1` 才是「我的」） */
export const WEREAD_REVIEW_URL = 'https://weread.qq.com/web/review/list';
/** 章节表（把 chapterUid 映射成章节名/序号；**POST**，body `{ bookIds: [...] }`） */
export const WEREAD_CHAPTERS_URL = 'https://weread.qq.com/web/book/chapterInfos';

/** 笔记区段名（用户 m00353 ②-4 原话指定的字面量，⛔ 别改）。 */
export const WEREAD_NOTES_SECTION = '同步划线与高亮';

/** 一条合并后的「划线 / 想法」。`text` 是划线原文，`note` 是用户写在其上的想法。 */
export interface WereadNote {
    /** 章节 uid（章节表里的 `chapterUid`；缺失按 0 处理，排序时落最前） */
    chapterUid: number;
    /** 章节名（响应自带 `chapterName`；缺失回退章节表，再缺失留空） */
    chapterName: string;
    /** 原文位置区间 `"41349-41383"`，同章内排序与去重靠它 */
    range: string;
    /** 划线原文（想法响应里叫 `abstract`） */
    text: string;
    /** 我的想法内容（纯划线没有这一项） */
    note?: string;
    /** 创建时间（秒级时间戳；0 = 未知） */
    createTime: number;
}

/** 解析结果：`notes` 为合并去重后的列表；`error` 非空表示**整体失败**（不是「没有划线」）。 */
export interface WereadNotesParse {
    notes: WereadNote[];
    error?: string;
}

function asString(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

function asNum(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** `errCode !== 0` 时返回可直接显示的中文（与 `pure/weread.wereadErrMessage` 同款口径）。 */
function errOf(root: unknown): string | undefined {
    if (!root || typeof root !== 'object') return undefined;
    const code = (root as WereadErrRoot).errCode;
    if (code === undefined || code === 0) return undefined;
    if (code === -2010) return 'Cookie 无效或已过期（未登录）';
    if (code === -2012) return '登录超时，请到设置页「测试连接」重新验证微信读书 Cookie';
    return asString((root as WereadErrRoot).errMsg) || `微信读书返回错误码 ${code}`;
}

/** 拼划线接口 URL。 */
export function buildWereadBookmarkUrl(bookId: string): string {
    return `${WEREAD_BOOKMARK_URL}?bookId=${encodeURIComponent(String(bookId ?? '').trim())}`;
}

/** 拼想法接口 URL（`listType=11&mine=1&synckey=0` 是参考插件实测组合，⛔ 别省 `mine`）。 */
export function buildWereadReviewUrl(bookId: string): string {
    return `${WEREAD_REVIEW_URL}?bookId=${encodeURIComponent(String(bookId ?? '').trim())}&listType=11&mine=1&synckey=0`;
}

/** 章节表的 POST body。 */
export function buildWereadChaptersBody(bookId: string): string {
    return JSON.stringify({ bookIds: [String(bookId ?? '').trim()] });
}

/**
 * 解析划线响应。
 *
 * 🔴 判「有效响应」的条件是 `Array.isArray(updated)` —— 与参考插件一致。
 *    实测无数据时该接口回 `{}`（**没有** `updated` 字段），这**不是错误**，返回空列表。
 *    但若同时带 `errCode`，那是真错误（Cookie 过期等），必须报出来。
 */
export function parseWereadBookmarks(raw: unknown): WereadNotesParse {
    const err = errOf(raw);
    if (err) return { notes: [], error: err };
    if (!raw || typeof raw !== 'object') return { notes: [], error: '返回内容无法解析' };
    const updated = (raw as { updated?: unknown }).updated;
    if (updated === undefined) return { notes: [] }; // 实测无数据时就是 {}
    if (!Array.isArray(updated)) return { notes: [], error: '划线列表格式异常（接口可能变更）' };
    const notes: WereadNote[] = [];
    for (const it of updated) {
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const text = asString(o.markText).trim();
        if (!text) continue; // 没有正文的划线留不下来
        notes.push({
            chapterUid: asNum(o.chapterUid),
            chapterName: asString(o.chapterName).trim(),
            range: asString(o.range),
            text,
            createTime: asNum(o.createTime),
        });
    }
    return { notes };
}

/**
 * 解析想法响应（`reviews[].review`）。
 *
 * 🔴 这里 `abstract` 才是**被划的那句原文**，`content` 是用户自己写的话 ——
 *    参考插件同样这么用。两者都有的条目才算「划线 + 想法」，只有 `content` 的是「纯想法」。
 */
export function parseWereadReviews(raw: unknown): WereadNotesParse {
    const err = errOf(raw);
    if (err) return { notes: [], error: err };
    if (!raw || typeof raw !== 'object') return { notes: [], error: '返回内容无法解析' };
    const list = (raw as { reviews?: unknown }).reviews;
    if (list === undefined) return { notes: [] };
    if (!Array.isArray(list)) return { notes: [], error: '想法列表格式异常（接口可能变更）' };
    const notes: WereadNote[] = [];
    for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const rv = (it as { review?: unknown }).review;
        if (!rv || typeof rv !== 'object') continue;
        const o = rv as Record<string, unknown>;
        const text = asString(o.abstract).trim();
        const note = asString(o.content).trim();
        if (!text && !note) continue;
        notes.push({
            chapterUid: asNum(o.chapterUid),
            chapterName: (asString(o.chapterName) || asString(o.chapterTitle)).trim(),
            range: asString(o.range),
            text,
            note: note || undefined,
            createTime: asNum(o.createTime),
        });
    }
    return { notes };
}

/** 从 `"41349-41383"` 取起始偏移用于排序（解析不出回 `Number.MAX_SAFE_INTEGER`，落章尾）。 */
function rangeStart(range: string): number {
    const m = /^(\d+)/.exec(range);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * 合并划线 + 想法并排序（同章按位置升序，章节按 `chapterUid` 升序）。
 *
 * 🔴 合并键是 `chapterUid + range`：微信读书里「在划线上写想法」产生的两条记录**共用同一个 range**，
 *    分开渲染会让同一条划线在笔记里出现两遍（一句原文 + 一句想法各占一段）。
 *    ⛔ 别用 `text` 当键 —— 同一句话可能被划两次（不同 range），那是两条真实记录。
 */
export function mergeWereadNotes(
    highlights: readonly WereadNote[],
    reviews: readonly WereadNote[],
): WereadNote[] {
    const byKey = new Map<string, WereadNote>();
    const order: string[] = [];
    const put = (n: WereadNote) => {
        const key = `${n.chapterUid}|${n.range}`;
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, { ...n });
            order.push(key);
            return;
        }
        // 后到的补空字段，不覆盖已有的（划线先到 / 想法先到都成立）
        byKey.set(key, {
            chapterUid: prev.chapterUid || n.chapterUid,
            chapterName: prev.chapterName || n.chapterName,
            range: prev.range || n.range,
            text: prev.text || n.text,
            note: prev.note || n.note,
            createTime: prev.createTime || n.createTime,
        });
    };
    for (const n of highlights) put(n);
    for (const n of reviews) put(n);
    const out = order.map((k) => byKey.get(k) as WereadNote);
    out.sort((a, b) => {
        if (a.chapterUid !== b.chapterUid) return a.chapterUid - b.chapterUid;
        const ra = rangeStart(a.range);
        const rb = rangeStart(b.range);
        if (ra !== rb) return ra - rb;
        return a.createTime - b.createTime;
    });
    return out;
}

/** 日期格式：`YYYY-MM-DD HH:mm`（本地时区；同步说明行用）。 */
function fmtTime(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 把合并后的笔记渲染成「## 同步划线与高亮」区的正文（**不含区标题行**，由 `mergeExcerptSection` 加）。
 *
 * 版式约定（改之前先读）：
 *   - 每条一个引用块，**每行都以 `>` 开头** —— 划线原文里出现 `## xxx` 不会伪造出二级标题；
 *   - 章名走 `### `（三级标题），落在 `## 同步划线与高亮` 之内，⛔ 别升级成 `##`（会截断区段）；
 *   - 想法行以 `💭` 开头并与划线之间留一个 `>` 空行 —— 视觉上分开，复制到别处也读得懂；
 *   - 开头一行说明「共 N 条 + 同步时间」，让用户知道这是机器同步来的、什么时候同步的。
 *   - `max` 截断时明确写「已截断」并给出总条数，⛔ 不假装全同步了。
 */
export function renderWereadNotes(
    notes: readonly WereadNote[],
    opts: { syncedAt?: number; max?: number } = {},
): string {
    const max = opts.max && opts.max > 0 ? opts.max : 0;
    const total = notes.length;
    const shown = max > 0 ? notes.slice(0, max) : notes;
    const stamp = fmtTime(opts.syncedAt ?? Date.now());
    const head =
        max > 0 && total > max
            ? `> 由插件从微信读书同步 · 共 ${total} 条，此处显示前 ${max} 条 · ${stamp}`
            : `> 由插件从微信读书同步 · 共 ${total} 条 · ${stamp}`;
    const lines: string[] = [head];
    let lastChapter = '';
    for (const n of shown) {
        const chap = n.chapterName || (n.chapterUid ? `第 ${n.chapterUid} 章` : '');
        if (chap && chap !== lastChapter) {
            lines.push('');
            lines.push(`### ${chap}`);
            lastChapter = chap;
        }
        lines.push('');
        if (n.text) {
            for (const l of n.text.split('\n')) lines.push(l ? `> ${l}` : '>');
        }
        if (n.note) {
            if (n.text) lines.push('>');
            const noteLines = n.note.split('\n');
            noteLines.forEach((l, i) => {
                lines.push(i === 0 ? `> 💭 ${l}` : `> ${l}`);
            });
        }
    }
    return lines.join('\n').trim();
}
