// 阅读数据统一存档（纯逻辑，可单测，无 obsidian 依赖）：
// **一本书一个 JSON 文件**，装「阅读进度 + 书签 + 高亮」三段 —— 对齐 KOReader 的
// `metadata.*.lua`（一文件承载一本书的全部阅读状态），也是用户 2026-09-18 的明确诉求
// （「阅读进度、书签、高亮都是 json 能不能合并在一起」）。
//
// 位置：`{libraryDir}/阅读进度/{书名}-阅读-{id}.json`（IO 在 main.ts，本模块只管 schema / 容错 / 路径 / 分段更新）。
// 高亮自此**不再写进书目笔记**的「## 高亮」区（笔记里那份是 JSON 单向生成的只读镜像）。
//
// 设计纪律：
// - **normalizeStore 是唯一读取入口**：坏 JSON 文本由调用方 JSON.parse 后把结果传进来，形状不对/缺段
//   → 逐段回退默认（坏一段不连累另两段）。
// - **白名单式归一**：未识别字段一律不带进内存（防脏数据悄悄混入，对齐本项目既有纪律）。
// - 分段归一**复用既有真源**（progress → `normalizeProgress`；bookmarks → `normalizeBookmarks`；
//   highlights → `normalizeHighlights`），不在这里另写一套校验。
// - `version` 只增不改，未来新增字段走 append-only。

import { DIR_READING } from 'pure/dirs';
import { normalizeProgress, sanitizeReaderTitle, type ReadingProgress } from 'pure/readingProgress';
import { normalizeBookmarks, type ReaderBookmark } from 'pure/bookmark';
import { normalizeHighlights, type ReaderHighlight } from 'pure/highlight';

/** 存档 schema 版本（只增不改；读取到更高版本原样透传，由调用方决定兼容策略） */
export const READER_STORE_VERSION = 1;

export interface ReaderStore {
    /** schema 版本 */
    version: number;
    /** 整档最近写入时间（ISO 字符串） */
    updatedAt: string;
    /** 阅读进度（语义沿用旧进度文件：chapterIndex 对 TXT/EPUB 是章节序、对 PDF 是页码） */
    progress: ReadingProgress;
    /** 书签 */
    bookmarks: ReaderBookmark[];
    /** 高亮（PDF 阅读器无高亮功能 → 恒空数组，不为 PDF 特化 schema） */
    highlights: ReaderHighlight[];
}

/** 空档：三段各归默认（新书 / 坏档的统一起点） */
export function emptyStore(): ReaderStore {
    return {
        version: READER_STORE_VERSION,
        updatedAt: new Date().toISOString(),
        progress: normalizeProgress(undefined),
        bookmarks: [],
        highlights: [],
    };
}

/**
 * 归一化外部读入的存档：顶层非对象（含 null / 数组 / 字符串）→ 空档；
 * version 非法（非正整数）→ 回退当前版本；updatedAt 非法 → 现在；三段各自归一（缺段按默认）。
 */
export function normalizeStore(raw: unknown): ReaderStore {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyStore();
    const o = raw as Record<string, unknown>;
    const version =
        typeof o.version === 'number' && Number.isInteger(o.version) && o.version > 0 ? o.version : READER_STORE_VERSION;
    const updatedAt =
        typeof o.updatedAt === 'string' && !Number.isNaN(new Date(o.updatedAt).getTime())
            ? o.updatedAt
            : new Date().toISOString();
    return {
        version,
        updatedAt,
        progress: normalizeProgress(o.progress),
        bookmarks: normalizeBookmarks(o.bookmarks),
        highlights: normalizeHighlights(o.highlights),
    };
}

/** 序列化为 JSON 文本（落盘用）。字段顺序固定（version → updatedAt → progress → bookmarks → highlights），
 *  便于人眼 diff、手工修档与产物断言。 */
export function serializeStore(store: ReaderStore): string {
    return JSON.stringify({
        version: store.version,
        updatedAt: store.updatedAt,
        progress: store.progress,
        bookmarks: store.bookmarks,
        highlights: store.highlights,
    });
}

/** 存档文件名：{书名}-阅读-{id}.json（前段可读，尾段保留条目 id 供关联与去重） */
export function readerStoreFileName(entryId: string, title: string): string {
    return `${sanitizeReaderTitle(title)}-阅读-${entryId}.json`;
}

/** 存档目录：{libraryDir}/阅读进度（书签/高亮/进度三者同放；main.ts 建目录与拼路径都走这里，回退规则只有一份）。
 *  ⚠️ 目录名走 `pure/dirs.DIR_READING`（红线路径 → 名字只留一处真源，#381 收敛）。 */
export function readerStoreDir(libraryDir: string): string {
    const dir = libraryDir.replace(/\/+$/, '') || 'ReelLudic';
    return `${dir}/${DIR_READING}`;
}

/** 存档路径：{libraryDir}/阅读进度/{fileName}。
 *  libraryDir 去尾部斜杠，空串/纯斜杠回退 'ReelLudic'（对齐 main.ts libDir 约定）；纯字符串拼接无 normalizePath。 */
export function readerStoreFilePath(entryId: string, title: string, libraryDir: string): string {
    return `${readerStoreDir(libraryDir)}/${readerStoreFileName(entryId, title)}`;
}

/**
 * 只换进度段（书签/高亮原样），刷新整档 updatedAt。
 * 参数取 `unknown` 是刻意的：进度来自阅读器滚动回调（不可信输入），由 `normalizeProgress` 收口钳制。
 */
export function withProgress(store: ReaderStore, p: unknown): ReaderStore {
    return { ...store, updatedAt: new Date().toISOString(), progress: normalizeProgress(p) };
}

/** 只换书签段（进度/高亮原样），刷新整档 updatedAt；列表逐项归一见 `normalizeBookmarks` */
export function withBookmarks(store: ReaderStore, list: unknown): ReaderStore {
    return { ...store, updatedAt: new Date().toISOString(), bookmarks: normalizeBookmarks(list) };
}

/** 只换高亮段（进度/书签原样），刷新整档 updatedAt；列表逐项归一见 `normalizeHighlights` */
export function withHighlights(store: ReaderStore, list: unknown): ReaderStore {
    return { ...store, updatedAt: new Date().toISOString(), highlights: normalizeHighlights(list) };
}

/**
 * 旧数据三源合并（一次性迁移用）：旧进度文件 + 旧书签文件 + 笔记「## 高亮」区解析结果 → 新存档。
 * 三段各自容错（缺源按默认）、脏值走同一套归一；`version` 落为当前版本。
 */
export function mergeLegacyStore(parts: { progress?: unknown; bookmarks?: unknown; highlights?: unknown }): ReaderStore {
    return normalizeStore({
        version: READER_STORE_VERSION,
        progress: parts.progress,
        bookmarks: parts.bookmarks,
        highlights: parts.highlights,
    });
}
