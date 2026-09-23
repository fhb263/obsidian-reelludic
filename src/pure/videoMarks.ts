// 进度条打点 / 标记的纯逻辑（无 obsidian 依赖，可单测）。
//
// 需求（用户 2026-09-19）：「在进度条上显示小圆点 —— 当用户在视频任意时间点写下笔记时，进度条对应位置
// 自动生成一个标记；点击标记可以快速定位到该时间点对应的笔记内容」。
//
// 🔴 **数据源 = 条目笔记**（真源，零 schema 改动 / 零迁移 / 零漂移）：扫「## 时间戳」/「## 截图」两区里的链接，
//    用 `parseTimeLink` 取秒数。**认链接目标、不认显示文字** ⇒ 老笔记（`[7:46·回到视频](…)`）与新格式
//    （`[7:46](…)`）都天然能读，**不需要迁移也不需要兼容分支**。
//    「写下笔记」的入口就是顶栏那两个按钮（T 插入时间戳 / S 截图）；**手写**在区里的行也照样算一个点
//    （用户 2026-09-19 明确：「可以」）。
//
// ⚠️ 与 `pure/excerpt.ANNOTATION_SECTIONS` 的区别：那张名单管「`writeNote` 重写笔记时要搬回哪些区」
//    （`高亮/摘抄/时间戳/截图`），本文件的 `MARK_SECTIONS` 只管「哪两区里的链接算进度条标记」
//    （`时间戳/截图`）—— **两者含义不同，别合并成一份**。
//
// 生态参照：交互惯例 = **YouTube 章节**（进度条上的标记 + 悬停看标题 + 点击跳转），而它的数据源
//    也正是「一份纯文本的时间戳列表」—— 与本模块的输入**同构**。

import { inlineLinks, parseTimeLink } from 'pure/videoLink';

/** 哪两区里的链接算进度条标记（改这里 = 改数据来源） */
export const MARK_SECTIONS = ['时间戳', '截图'] as const;

/** 标记多于这个数量 → 视图加「密集」态（圆点缩小变淡，D-5 Ⓐ）—— 免得进度条变成一条花边 */
export const MARK_DENSE_THRESHOLD = 12;

/** 进度条上的一个标记 */
export interface VideoMark {
    /** 秒数（进度条定位用） */
    seconds: number;
    /** 来源：「插入时间戳」还是「截图」 */
    kind: 'stamp' | 'shot';
    /** 笔记里的**行号（0 基）** —— 「在笔记中打开」靠它定位（截图块取**图片那一行**，整块都在视野里） */
    line: number;
    /** 该行原文（悬停摘要用；截图块含图片行） */
    text: string;
    /** 链接目标（库内 = 路径 / 库外 = 深链）—— 用来判「属于哪一集」 */
    dest: string;
    /** 库外深链的**集下标**（`ep`） */
    ep?: number;
    /** 库内链接的**文件名**（basename：库内链接只有路径、没有集号） */
    file?: string;
    /** 截图文件名（`![[图]]`）—— 悬停可显示缩略图 */
    image?: string;
}

/** `![[图]]` 取文件名 */
const IMAGE_RE = /!\[\[([^\]]+)\]\]/;
/** 二级区标题（允许前面缩进与尾部空格） */
const HEADING_RE = /^\s{0,3}##\s+(\S.*?)\s*$/;

/** 取文件名（兼容 `\` 路径；空串安全） */
function baseName(p: string): string {
    const s = (p ?? '').replace(/\\/g, '/');
    const i = s.lastIndexOf('/');
    return (i >= 0 ? s.slice(i + 1) : s).trim();
}

/**
 * 从条目笔记解析出**全部**标记（按笔记里的先后顺序）。
 * 只扫 `MARK_SECTIONS` 两区 ⇒ 正文 / 摘抄区里的链接**不会**被误当成标记。
 */
export function parseNoteMarks(markdown: string): VideoMark[] {
    const md = typeof markdown === 'string' ? markdown : '';
    if (!md) return [];
    const lines = md.split('\n');
    const out: VideoMark[] = [];
    let section = '';
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i] ?? '';
        const head = HEADING_RE.exec(raw);
        if (head) {
            section = (head[1] ?? '').trim();
            continue;
        }
        if (!(MARK_SECTIONS as readonly string[]).includes(section)) continue;
        const links = inlineLinks(raw);
        if (!links.length) continue;
        const kind: VideoMark['kind'] = section === '截图' ? 'shot' : 'stamp';
        // 截图块是两行：`![[图]]` + 链接行 → 标记落在**图片那一行**（点「在笔记中打开」时整块都在视野里）
        let image: string | undefined;
        let line = i;
        let text = raw.trim();
        if (kind === 'shot') {
            const same = IMAGE_RE.exec(raw)?.[1]?.trim();
            const prev = i > 0 ? (lines[i - 1] ?? '') : '';
            const prevImg = IMAGE_RE.exec(prev)?.[1]?.trim();
            if (same) {
                image = same;
            } else if (prevImg) {
                image = prevImg;
                line = i - 1;
                text = `${prev.trim()}\n${raw.trim()}`;
            }
        }
        for (const l of links) {
            const t = parseTimeLink(l.dest);
            if (!t) continue;
            const mark: VideoMark = { seconds: t.seconds, kind, line, text, dest: l.dest };
            if (t.kind === 'entry') mark.ep = t.ep;
            else mark.file = baseName(t.filePath);
            if (image) mark.image = image;
            out.push(mark);
        }
    }
    return out;
}

/**
 * 过滤出**当前这一集**的标记。
 * 🔴 **多集必须过滤**：进度条的时间轴只对应正在播的那一集 —— 第 3 集的 5:00 与第 1 集的 5:00 不在同一位置，
 *    混着画就是**画错位置**。
 * 判据：库外深链按 `ep`；**库内链接只有文件名** → 按文件名与当前集比对；反查不到集号的（既无 ep 又无文件名）
 * 一律**不画**（宁可不画，也别画错）。
 */
export function marksForEpisode(marks: VideoMark[], cur: { ep: number; fileName?: string }): VideoMark[] {
    const file = baseName(cur?.fileName ?? '');
    const ep = Number.isFinite(cur?.ep) ? Math.floor(cur.ep) : 0;
    return (marks ?? []).filter((m) => {
        if (typeof m?.ep === 'number') return m.ep === ep;
        if (typeof m?.file === 'string' && m.file) return !!file && m.file === file;
        return false;
    });
}

/** 秒数 → 进度条百分比（0~1）；总时长未知 / 非法 → 0（不画在错误位置） */
export function markPct(seconds: number, duration: number): number {
    const s = Number.isFinite(seconds) ? seconds : 0;
    const d = Number.isFinite(duration) ? duration : 0;
    if (d <= 0) return 0;
    return Math.min(1, Math.max(0, s / d));
}

/**
 * 该标记行里**除链接与图片以外**的文字 —— 即用户**手写的补充说明**（悬停卡片显示它，没有则空串）。
 * 纯展示用：`![[图]]` 与 `[文字](目标)` 都剥掉，再把空白压成一个空格。
 */
export function markCaption(text: string): string {
    const line = typeof text === 'string' ? text : '';
    return line
        .replace(/!\[\[[^\]]*\]\]/g, '')
        .replace(/\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 点击位置（`ratio` = 0~1）命中了第几个标记？容差内**取最近的一个**；都没命中 → -1
 * （**点空白处不跳** —— 否则用户想拖进度会莫名其妙被吸到某个点上）。
 */
export function hitMark(pcts: readonly number[], ratio: number, tol: number): number {
    const list = Array.isArray(pcts) ? pcts : [];
    const limit = Number.isFinite(tol) ? Math.max(0, tol) : 0;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
        const d = Math.abs((Number.isFinite(list[i]) ? list[i] : 0) - ratio);
        if (d <= limit && d < bestD) {
            best = i;
            bestD = d;
        }
    }
    return best;
}

/** 矩形（`getBoundingClientRect()` 的结构子集 —— 不引 DOM 类型，纯模块保持可单测） */
export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * 指针是否停在**已展开的标记卡片**上（含 `pad` 容差）—— 「从圆点向上移进卡片去按按钮」的判据。
 *
 * 🔴 为什么必须有它（2026-09-19 用户实测报障：「小圆点悬浮后，点『在笔记中打开』点不动」）：
 *    卡片画在**进度条上方**（`.rl-vp-tip { bottom: 22px }`），指针必须从条上**向上**移进卡片才按得到按钮，
 *    而这段位移全程都会给进度条发 `pointermove`、并触发 `pointerleave`：
 *      · `pointerleave` 若照旧收卡片 → 卡片在眼前消失（够不到按钮）；
 *      · `pointermove` 若照旧重算并 `tip.empty()` **重建卡片** → 按钮在 `mousedown` 与 `mouseup` 之间
 *        被换成新节点 ⇒ 浏览器**不合成 `click`**（按钮永远点不动）。
 *    ⇒ 命中本判据时**既不重算、也不收起**。
 * ⚠️ `display:none` 时 `getBoundingClientRect()` 全 0 —— 这种退化矩形必须返回 false，
 *    否则「整条进度条」都会被当成卡片（那样普通悬停就再也看不到时间气泡了）。
 */
export function pointerOnCard(card: Rect | null, x: number, y: number, pad = 4): boolean {
    if (!card) return false;
    const p = Number.isFinite(pad) ? Math.max(0, pad) : 0;
    const { left, top, right, bottom } = card;
    if (![left, top, right, bottom, x, y].every((v) => Number.isFinite(v))) return false;
    if (right <= left || bottom <= top) return false;
    return x >= left - p && x <= right + p && y >= top - p && y <= bottom + p;
}

/**
 * 指针是否落在**进度条所属的竖向带**内（含上下 `pad`）—— 右键命中判定的**纵向**门控。
 *
 * 🔴 为什么需要它（2026-09-19 用户改判：打开方式从「卡片里的按钮」换成「悬停出卡片 → 右键打开」）：
 *    右键必须挂在播放器 **root** 上，不能挂在进度条上 —— 因为卡片是 `pointer-events: none`，
 *    **卡片空白处的命中目标是底层 video**（无头 Chrome 实测 `elementFromPoint` 返回 `VIDEO`），
 *    事件根本不经过进度条 ⇒ 只有挂 root 才收得到「右键卡片」。代价是**画面任何位置右键都会进来**，
 *    于是必须用两道门控把它夹回进度条附近：横向 = `hitMark` 的 8px 容差，纵向 = 本函数。
 *    ⛔ **门控不通过时一律不 `preventDefault`** —— 绝不吞掉用户在画面别处的正常右键菜单。
 */
export function inBarBand(y: number, top: number, bottom: number, pad = 40): boolean {
    if (![y, top, bottom].every((v) => Number.isFinite(v))) return false;
    const p = Number.isFinite(pad) ? Math.max(0, pad) : 0;
    return y >= top - p && y <= bottom + p;
}
