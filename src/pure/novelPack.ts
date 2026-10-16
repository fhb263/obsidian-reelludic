/**
 * **网文成品合成**（纯逻辑，#419）—— 无 `obsidian` / 无 DOM / 无网络，可单测。
 *
 * 本批只做 **TXT**（EPUB 排在 P1-B，见方案文档 §8.2）。
 * 章节正文已由 `pure/novelText` 净化过 ⇒ 这里只负责**装配**与**文件名**。
 */
import { bookStem } from 'pure/bookDownload';
import { sanitizeDownloadName } from 'pure/downloadPlan';

/** 一本书的元信息（够写进成品头部即可；`poster` 等字段与本批无关） */
export interface NovelMeta {
    title: string;
    author?: string;
    /** 书源显示名（写进头部，便于日后回查是哪条源下的） */
    sourceName?: string;
    intro?: string;
}

/** 一章（`no` 从 1 起；`text` 为净化后的正文） */
export interface NovelChapter {
    no: number;
    title: string;
    text: string;
}

/**
 * 成品文件名 = `书名 - 作者.ext`。
 * 🔴 基名走 `pure/bookDownload.bookStem`（「书名 - 作者」的**唯一定义处**）——
 *    ⛔ 别在这里自己拼字符串：`pure/libraryBooks.splitBookStem` 按那个口径反向切，
 *    两处不一致会让「库内找回」再也匹配不上刚下好的文件。
 */
export function novelBookFilename(meta: NovelMeta, format: 'txt' | 'epub'): string {
    const stem = sanitizeDownloadName(bookStem(meta.title, meta.author)) || '未命名';
    return `${stem}.${format}`;
}

/** 进度文案：`128 / 1234 章`（UI 与日志共用同一份口径） */
export function novelProgressText(done: number, total: number): string {
    return `${Math.max(0, Math.floor(done))} / ${Math.max(0, Math.floor(total))} 章`;
}

/**
 * 进度条百分比（0~100 的**整数**）—— #429 起进度条改用**真实进度**，⛔ 不再是「不确定态来回跑」。
 *
 * 🔴 分子取 **已处理 = 成功 + 失败**，⛔ 不是只取成功：失败的章本轮**不会再重试**（重试已在抓章层做完），
 *    它和成功章一样「翻篇了」。只算成功的话，一本有 3 章失败的书会永远停在 99% —— 那比不显示更糟。
 * ⚠️ `total <= 0`（还不知道章数 / 空区间）⇒ 0，⛔ 别算出 `NaN%` 或 `Infinity%`。
 */
export function novelProgressPercent(done: number, failed: number, total: number): number {
    const t = Math.floor(Number(total));
    if (!Number.isFinite(t) || t <= 0) return 0;
    const processed = Math.max(0, Math.floor(Number(done)) || 0) + Math.max(0, Math.floor(Number(failed)) || 0);
    return Math.min(100, Math.round((processed / t) * 100));
}

/**
 * 耗时文案（下载完成回执用）—— 用户 2026-09-29 给的样例是 **`68.96 s`**：
 * 🔴 一律**秒 + 两位小数**，⛔ 不做「超过 60 秒就换成分」的自动进位 ——
 *    样例本身 68.96 s 就 > 60，进位会直接违背用户给的形态。
 * ⚠️ 负数 / 非数 ⇒ `0.00 s`（时钟倒跳之类不该让回执变成 `NaN s`）。
 */
export function novelElapsedText(ms: number): string {
    const n = Number(ms);
    const sec = Number.isFinite(n) && n > 0 ? n / 1000 : 0;
    return `${sec.toFixed(2)} s`;
}

/**
 * 「目录」回填写进条目的**前几章**（#431）。
 * 🔴 起因：长篇动辄 2000+ 章，整份章节名塞进条目的 `toc` 字段，用户根本不会看完，
 *    还会被原样渲染进详情笔记的 `## 目录` 小节（一篇笔记里挂两千行）。
 *    用户口径：「只显示前 10 章加个 `....` 来显示」。
 */
export const TOC_PREVIEW_LIMIT = 10;

/**
 * 截断标记 —— **四个点**（用户给的写法就是 `....`）。
 * ⚠️ 别顺手改成省略号 `…` 或三个点：这是**用户点名的形态**（本仓对这类字面形态一律照抄）。
 */
export const TOC_PREVIEW_TAIL = '....';

/**
 * 把抓到的章节名清单裁成「前 10 章 + `....`」（#431）—— 回填条目 `toc` 的**唯一出口**。
 *
 * ⚠️ 只在**超出上限**时才补尾巴：10 章以内（含刚好 10 章）原样返回，⛔ 别给一本 6 章的书也挂个 `....`
 *    （那会让人以为「后面还有，只是没显示」）。
 * ⚠️ 空清单 ⇒ 空串（调用方照旧把它当「没有目录」，⛔ 不写一个只有 `....` 的怪目录）。
 */
export function novelTocPreview(titles: readonly string[]): string {
    const list = titles.map((t) => String(t ?? ''));
    if (!list.length) return '';
    if (list.length <= TOC_PREVIEW_LIMIT) return list.join('\n');
    return [...list.slice(0, TOC_PREVIEW_LIMIT), TOC_PREVIEW_TAIL].join('\n');
}

/** 成品头部的元信息块（作者 / 来源 / 简介；全空 ⇒ 回空串，不留一段空白） */
export function novelMetaBlock(meta: NovelMeta): string {
    const lines: string[] = [];
    const author = String(meta.author ?? '').trim();
    const source = String(meta.sourceName ?? '').trim();
    const intro = String(meta.intro ?? '').trim();
    if (author) lines.push(`作者：${author}`);
    if (source) lines.push(`来源：${source}`);
    if (intro) lines.push('', '简介', intro);
    return lines.join('\n');
}

/** 目录块（`第 N 章 标题` 一行一章） */
export function novelTocBlock(chapters: readonly NovelChapter[]): string {
    const lines = chapters.map((c) => `${c.no}. ${c.title}`.trim());
    return ['目录', ...lines].join('\n');
}

/**
 * 合成整本 TXT。
 *
 * 🔴 **目录默认开**（`opts.toc !== false`）：网文动辄上千章，没有目录的 TXT 基本没法用；
 *    但单测/调试要比对正文时可以关掉（关掉后产物只含头部 + 章节）。
 * ⚠️ 缺章的章不写（`text` 为空）—— 那章在 UI 上已经报过失败原因了，⛔ 别在成品里留一个
 *    「第 7 章」空标题让用户以为书本来就是空的。
 */
export function buildNovelTxt(meta: NovelMeta, chapters: readonly NovelChapter[], opts: { toc?: boolean } = {}): string {
    const parts: string[] = [];
    const head = String(meta.title ?? '').trim() || '未命名';
    const metaBlock = novelMetaBlock(meta);
    parts.push(metaBlock ? `${head}\n${metaBlock}` : head);
    const kept = chapters.filter((c) => String(c.text ?? '').trim().length > 0);
    if (opts.toc !== false && kept.length > 1) parts.push(novelTocBlock(kept));
    for (const c of kept) {
        parts.push(`${c.title.trim()}\n\n${String(c.text).trim()}`);
    }
    return parts.join('\n\n\n') + '\n';
}

/** 章节任务的三态（断点续传的前身；本批只用于进度显示，落库见 P1-C） */
export type ChapterState = 'pending' | 'done' | 'failed';

export interface ChapterTask {
    no: number;
    title: string;
    url: string;
    state: ChapterState;
    text?: string;
    /** 失败原因（面向用户的一句话） */
    error?: string;
}

/** 进度摘要：完成 / 失败 / 待抓（UI 一句话交代清楚，⛔ 别只给一个百分比） */
export function chapterTaskSummary(tasks: readonly ChapterTask[]): { done: number; failed: number; pending: number; total: number } {
    let done = 0;
    let failed = 0;
    let pending = 0;
    for (const t of tasks) {
        if (t.state === 'done') done++;
        else if (t.state === 'failed') failed++;
        else pending++;
    }
    return { done, failed, pending, total: tasks.length };
}

/**
 * 失败章的回执（下完后告诉用户哪里缺了）——**列前几个**失败的章号，不刷屏。
 * 全成功 ⇒ 空串。
 */
export function failedChaptersText(tasks: readonly ChapterTask[], max = 5): string {
    const failed = tasks.filter((t) => t.state === 'failed');
    if (!failed.length) return '';
    const nos = failed.slice(0, max).map((t) => `第 ${t.no} 章`);
    const more = failed.length > max ? ` 等 ${failed.length} 章` : '';
    return `有 ${failed.length} 章没抓到：${nos.join('、')}${more}。可在源站直接看这几章，或换一个书源重试。`;
}
