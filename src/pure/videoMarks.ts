// 进度条打点 / 标记的纯逻辑（无 obsidian 依赖，可单测）。
//
// 需求（用户 2026-09-19）：「在进度条上显示小圆点 —— 当用户在视频任意时间点写下笔记时，进度条对应位置
// 自动生成一个标记；点击标记可以快速定位到该时间点对应的笔记内容」。
//
// 🔴 **数据源 = 条目笔记**（真源，零 schema 改动 / 零迁移 / 零漂移）：扫「## 单时间戳」/「## 截图时间戳」两区
//    里的链接，用 `parseTimeLink` 取秒数。**认链接目标、不认显示文字** ⇒ 老笔记（`[7:46·回到视频](…)`）与
//    新格式（`[7:46](…)`）都天然能读，**不需要迁移也不需要兼容分支**。
//    🔴 **区段名在 2026-10-09 改过**（用户：「写入笔记的 `## 时间戳`、`## 截图` 改成 `## 单时间戳`、
//    `## 截图时间戳`」）：写入一律用新名，**旧名继续读**（兼容面见下方 `MARK_SECTIONS_LEGACY` 的注释）。
//    「写下笔记」的入口就是顶栏那两个按钮（T 插入时间戳 / S 截图）；**手写**在区里的行也照样算一个点
//    （用户 2026-09-19 明确：「可以」）。
//
// ⚠️ 与 `pure/excerpt.ANNOTATION_SECTIONS` 的区别：那张名单管「`writeNote` 重写笔记时要搬回哪些区」
//    （`摘抄/单时间戳/截图时间戳` + 两个历史名），本文件的 `MARK_SECTIONS` 只管「哪几区里的链接算进度条标记」
//    —— **两者含义不同，别合并成一份**；但⚠️ **改区名时两处都要动**（少一处 = 静默丢数据）。
//
// 生态参照：交互惯例 = **YouTube 章节**（进度条上的标记 + 悬停看标题 + 点击跳转），而它的数据源
//    也正是「一份纯文本的时间戳列表」—— 与本模块的输入**同构**。

import { inlineLinks, parseTimeLink } from 'pure/videoLink';

/** 写入用的两个区名（用户 2026-10-09 定稿：`## 单时间戳` / `## 截图时间戳`） */
export const MARK_SECTION_STAMP = '单时间戳';
export const MARK_SECTION_SHOT = '截图时间戳';

/** 2026-10-09「区段改名」之前的两个**历史区名** —— ⛔ 只读兼容、写入一律用新名 */
export const MARK_SECTION_STAMP_LEGACY = '时间戳';
export const MARK_SECTION_SHOT_LEGACY = '截图';

/**
 * 🔴🔴 **历史区名只许留、不许删**（2026-10-09 区段改名的兼容面）：
 * 改名**不迁移已有笔记**（用户没要求动笔记文件）⇒ 老笔记里写下的 `## 时间戳` / `## 截图` 必须
 * **照样读得出来**（否则进度条圆点与侧边栏那两栏会**当场空白** —— 看着就像数据丢了）。
 * 🔴 **两处都要列上**，少一处就是静默丢数据：
 *   · 本文件的读名单（`MARK_SECTIONS`）—— 决定「哪些区的链接算标记」；
 *   · `pure/excerpt.ANNOTATION_SECTIONS` —— 决定「`writeNote` 重写笔记时把哪些区搬回去」。
 */
export const MARK_SECTIONS_LEGACY = [MARK_SECTION_STAMP_LEGACY, MARK_SECTION_SHOT_LEGACY] as const;

/** 哪几区里的链接算进度条标记（**新名 + 旧名**；改这里 = 改数据来源） */
export const MARK_SECTIONS = [MARK_SECTION_STAMP, MARK_SECTION_SHOT, ...MARK_SECTIONS_LEGACY] as const;

/** 算「截图」的那两区（新名 + 旧名）—— 只有它们走 `![[图]]` + 上一行的取图逻辑 */
const SHOT_SECTIONS: readonly string[] = [MARK_SECTION_SHOT, MARK_SECTION_SHOT_LEGACY];

/**
 * 🔴 #634：本模块**不再提供进度条命中判定**（`hitMark` / `inBarBand` / `pointerOnCard`）与
 * 「密集态阈值」（`MARK_DENSE_THRESHOLD`）—— 它们随进度条上的标记圆点一起退场。
 *
 * 由来：用户裁定「播放器上的进度条不再显示标记，并取消该跳转笔记功能，仅在抽屉侧边栏可点击跳转
 * 对应视频进度和关联时间戳笔记」。那三件套的**唯一用途**就是「悬停圆点出卡片 / 右键圆点开笔记」
 * 这条通路（`hitMark` 横向 8px 容差 + `inBarBand` 纵向 ±40px 把右键夹回条附近 + `pointerOnCard`
 * 护住卡片里的按钮）⇒ 圆点与卡片都没了，它们就是**死码**（本仓「死码不留」）。
 *
 * ⛔ 别因为「将来可能还要打点」把它们加回来 —— 需要时连判别口径一起重新论证；
 *    现在抽屉的「跳到那一秒」用的是**行下标**（`jumpToMark(i)`），不经过任何命中判定。
 */

/** 进度条上的一个标记 */
export interface VideoMark {
    /** 秒数（进度条定位用） */
    seconds: number;
    /** 来源：「插入时间戳」还是「截图」 */
    kind: 'stamp' | 'shot';
    /** 笔记里的**行号（0 基）** —— 「在笔记中打开」靠它定位（截图块取**图片那一行**，整块都在视野里） */
    line: number;
    /** 该行原文（抽屉列表里显示它；截图块含图片行） */
    text: string;
    /** 链接目标（库内 = 路径 / 库外 = 深链）—— 用来判「属于哪一集」 */
    dest: string;
    /** 库外深链的**集下标**（`ep`） */
    ep?: number;
    /** 库内链接的**文件名**（basename：库内链接只有路径、没有集号） */
    file?: string;
    /** 截图文件名（`![[图]]`）—— 抽屉列表用它取缩略图 */
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
 * 只扫 `MARK_SECTIONS` 那几区（新名 + 旧名）⇒ 正文 / 摘抄区里的链接**不会**被误当成标记。
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
        // 截图那两区（新名 + 旧名）走取图逻辑，其余算「纯时间戳」
        const kind: VideoMark['kind'] = SHOT_SECTIONS.includes(section) ? 'shot' : 'stamp';
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
 * 该标记行里**除链接与图片以外**的文字 —— 即用户**手写的补充说明**（抽屉列表显示它，没有则空串）。
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

