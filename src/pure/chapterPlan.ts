/**
 * **断点续传的计划与存档**（纯逻辑，P1-C）—— 无 `obsidian` / 无 DOM / 无网络，可单测。
 *
 * ## 存什么、存哪儿
 * 每本**正在下载**的书一个存档：`{libraryDir}/下载续传/{书名}-续传-{格式}-{hash8}.ndjson`
 *   · 第 1 行 = **元信息**（`kind:'meta'`）：站点键 / 书籍页 / 书名 / 作者 / 格式 / **目录指纹**；
 *   · 之后每行 = **一章**（`kind:'chapter'`）：`{no,title,text}` —— 抓完一章 append 一行。
 *
 * ## 三条设计取舍（都是被「1600 章 × 每章几秒」逼出来的）
 *  ⑴ **NDJSON 而不是「一个 JSON 数组」**：中途取消 / 崩掉时**已抓的章不会丢**，且每章只追加一行
 *    （O(1)）；换成数组就得把整本（可能十几 MB）反复序列化重写，长书下那是每秒一次的卡顿源。
 *  ② **带目录指纹**：书源改版后章节表会变，拿旧章节硬拼出来的成品会**错位**（序号对不上正文）
 *    ⇒ 指纹不一致整档作废、从头来（并明确告诉用户），⛔ 绝不混拼。
 *  ③ **档名带站点键哈希**：同一本书换源重下是**另一本**（章节地址全不同），⛔ 不能共用一个档。
 *
 * ⚠️ 目录指纹只吃 `no + title` 两项：**不含 url** —— 站点换域 / 给链接加参数不该让用户白下一遍。
 */

import { DIR_DOWNLOAD_RESUME } from 'pure/dirs';
import type { ChapterTask } from 'pure/novelPack';
import { sanitizeReaderTitle } from 'pure/readingProgress';

/** 存档 schema 版本（只增不改；读到更高版本 ⇒ 当不认识，整档作废重下） */
export const RESUME_VERSION = 1;

/** 成品格式（与弹窗上那两个按钮一致） */
export type ResumeFormat = 'txt' | 'epub';

/** 存档首行（元信息） */
export interface ResumeMeta {
    v: number;
    kind: 'meta';
    /** 书源**站点键**（`pure/sourceRule.sourceKey`）—— 换源重下 = 另一本 */
    sourceKey: string;
    /** 书籍详情页地址（同一站点下定位到具体一本） */
    bookUrl: string;
    title: string;
    author: string;
    format: ResumeFormat;
    /** 目录指纹（`chaptersFingerprint`）：不一致 ⇒ 整档作废 */
    tocKey: string;
    updatedAt: string;
}

/** 存档里的一章（正文照存；成品就是这些拼起来的） */
export interface ResumeChapter {
    no: number;
    title: string;
    text: string;
}

export interface ParsedResume {
    /** 首行解析结果；缺 / 版本不认识 / 形状不对 ⇒ `null` */
    meta: ResumeMeta | null;
    /** 已抓到的章（按 `no` 升序去重；同一个 `no` 后写的赢） */
    chapters: ResumeChapter[];
}

/** FNV-1a 32 位（够用的短指纹；⛔ 不是安全哈希，这里也不需要） */
function fnv1a(raw: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 目录指纹：章节表**变了**就认得出来。
 * 🔴 只吃 `no + title`（见文件头 ③）；空表 / 缺字段也稳定（`no` 缺省取位序 ⇒ 不会出现 undefined）。
 */
export function chaptersFingerprint(items: readonly { no?: number; title?: string }[]): string {
    const parts = (items ?? []).map((it, i) => `${Number(it?.no) || i + 1}\u0001${String(it?.title ?? '').trim()}`);
    return fnv1a(parts.join('\u0002'));
}

/**
 * 存档文件名：`{书名}-续传-{格式}-{hash8}.ndjson`（可读 + 稳定，对齐「阅读进度」那套命名）。
 * 🔴 哈希吃 `站点键 + 书籍页 + 格式` ⇒ 同名不同源 / 同源不同格式各存各的，⛔ 不互相污染。
 */
export function resumeFileName(o: { title: string; sourceKey: string; bookUrl: string; format: ResumeFormat }): string {
    const key = fnv1a(`${o.sourceKey}\u0001${o.bookUrl}\u0001${o.format}`);
    return `${sanitizeReaderTitle(String(o.title ?? ''))}-续传-${o.format}-${key}.ndjson`;
}

/** 存档目录：`{libraryDir}/下载续传`（libraryDir 空 ⇒ 回退 `ReelLudic`，与阅读存档同一约定） */
export function resumeDir(libraryDir: string): string {
    const dir = String(libraryDir ?? '').replace(/\/+$/, '') || 'ReelLudic';
    return `${dir}/${DIR_DOWNLOAD_RESUME}`;
}

/** 存档完整路径（纯字符串拼接，不引 normalizePath） */
export function resumePath(libraryDir: string, fileName: string): string {
    return `${resumeDir(libraryDir)}/${fileName}`;
}

/** 元信息行（含换行；append 用）。调用方只给内容，`v` / `kind` 由本模块统一盖（⛔ 别让调用点各写一份） */
export function resumeMetaLine(meta: Omit<ResumeMeta, 'v' | 'kind'>): string {
    return `${JSON.stringify({ ...meta, v: RESUME_VERSION, kind: 'meta' })}\n`;
}

/** 章节行（含换行；append 用） */
export function resumeChapterLine(ch: ResumeChapter): string {
    return `${JSON.stringify({ kind: 'chapter', no: ch.no, title: ch.title, text: ch.text })}\n`;
}

function normalizeMeta(o: Record<string, unknown>): ResumeMeta | null {
    if (o.v !== RESUME_VERSION) return null; // 版本不认识（未来档 / 坏档）⇒ 当没有
    const format: ResumeFormat | null = o.format === 'epub' ? 'epub' : o.format === 'txt' ? 'txt' : null;
    if (!format) return null;
    const str = (x: unknown): string => (typeof x === 'string' ? x : '');
    const sourceKey = str(o.sourceKey);
    const bookUrl = str(o.bookUrl);
    if (!sourceKey || !bookUrl) return null; // 定位不到是哪个源 / 哪本书的档，留着也没用
    return {
        v: RESUME_VERSION,
        kind: 'meta',
        sourceKey,
        bookUrl,
        title: str(o.title),
        author: str(o.author),
        format,
        tocKey: str(o.tocKey),
        updatedAt: str(o.updatedAt),
    };
}

function normalizeChapter(o: Record<string, unknown>): ResumeChapter | null {
    // ⚠️ 要求**真数字**：`"no":"2"` 这种串是坏档/手改过的痕迹，别用 `Number()` 把它悄悄救活
    if (typeof o.no !== 'number' || !Number.isInteger(o.no) || o.no < 1) return null;
    if (typeof o.text !== 'string') return null;
    return { no: o.no, title: typeof o.title === 'string' ? o.title : '', text: o.text };
}

/**
 * 解析存档文本。
 * 🔴 **容错到底**：空白行 / 半截行（进程被杀在写一半）/ 形状不对的行**逐行跳过**，
 *    ⛔ 不因为一行坏掉就把整档丢掉 —— 那等于把用户几十分钟的下载白费。
 */
export function parseResume(text: string): ParsedResume {
    const out: ParsedResume = { meta: null, chapters: [] };
    const byNo = new Map<number, ResumeChapter>();
    for (const line of String(text ?? '').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        let raw: unknown;
        try {
            raw = JSON.parse(s);
        } catch {
            continue; // 半截行 / 坏行
        }
        if (typeof raw !== 'object' || raw === null) continue;
        const o = raw as Record<string, unknown>;
        if (o.kind === 'meta') {
            const m = normalizeMeta(o);
            if (m) out.meta = m;
            continue;
        }
        if (o.kind !== 'chapter') continue;
        const ch = normalizeChapter(o);
        // 同一个 no 后写的赢：续传时重抓那一章会**再追加**一行，而不是回头改旧行
        if (ch) byNo.set(ch.no, ch);
    }
    out.chapters = [...byNo.values()].sort((a, b) => a.no - b.no);
    return out;
}

/** 存档是否对得上这次下载（站点 / 书 / 格式 / 目录指纹**四项全等**才敢复用） */
export function resumeMatches(
    meta: ResumeMeta | null,
    want: { sourceKey: string; bookUrl: string; format: ResumeFormat; tocKey: string },
): boolean {
    return (
        !!meta &&
        meta.sourceKey === want.sourceKey &&
        meta.bookUrl === want.bookUrl &&
        meta.format === want.format &&
        meta.tocKey === want.tocKey
    );
}

/**
 * 把存档里已抓到的章**并回任务表**（断点续传的核心一步）。
 * 判据是 `no`：与这次范围对得上的才复用（用户换了章节区间也不会串味）。
 * ⚠️ 正文是空的存档章**不复用**（宁可重抓，也不给用户一个空章节）。
 */
export function applyResume(
    tasks: readonly ChapterTask[],
    chapters: readonly ResumeChapter[],
): { tasks: ChapterTask[]; reused: number } {
    const done = new Map<number, ResumeChapter>();
    for (const ch of chapters ?? []) done.set(ch.no, ch);
    let reused = 0;
    const out = tasks.map((t) => {
        const hit = done.get(t.no);
        if (!hit || !String(hit.text ?? '').trim()) return { ...t };
        reused++;
        return { ...t, state: 'done' as const, title: hit.title.trim() || t.title, text: hit.text, error: undefined };
    });
    return { tasks: out, reused };
}
