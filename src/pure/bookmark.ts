// 阅读器书签纯模型（纯逻辑，可单测，无 obsidian 依赖）：每本书一个 JSON 数组，
// vault 内 {libraryDir}/阅读进度/{书名}-书签-{id}.json 由 main.ts 读写。
// batch1 仅落位置书签：quote 为选段文本（可缺省=纯位置书签），note 预留批 2 批注。
// 与 readingProgress.ts 同风格：解析容错、路径纯字符串拼接（不引 normalizePath）。
import { bookmarksFileName } from 'pure/readingProgress';

export interface ReaderBookmark {
    /** 书签唯一 id（bm-{Date.now().toString(36)}，调用方生成；解析器不依赖它，仅在原数据有时透传） */
    id: string;
    /** 1-based 章节（与摘录 loc 的章号一致） */
    chapter: number;
    /** 章节内滚动百分比 0-100 */
    pct: number;
    /** 选中文本；undefined = 纯位置书签 */
    quote?: string;
    /** 预留批注（batch1 永不填充，批 2 用） */
    note?: string;
    /** 创建时间（epoch ms） */
    createdAt: number;
}

/**
 * 书签文件路径：{libraryDir}/阅读进度/{书名}-书签-{entryId}.json（文件名可读，尾段保留 ID）。
 *  libraryDir 去尾部斜杠，空串/纯斜杠回退 'ReelLudic'（对齐 main.ts libDir 约定）；
 *  vault 相对路径统一 '/' 分隔，纯字符串操作无 normalizePath。
 */
export function bookmarksFilePath(entryId: string, title: string, libraryDir: string): string {
    const dir = libraryDir.replace(/\/+$/, '') || 'ReelLudic';
    return `${dir}/阅读进度/${bookmarksFileName(entryId, title)}`;
}

/**
 * 解析书签 JSON 文本：undefined/空/坏 JSON/顶层非数组 → []。
 * 逐项校验：非对象、chapter 非整数或 <1、pct 非有限数值或超出 [0,100] → 跳过；
 * id/createdAt 类型匹配（string/number）才透传，否则缺省；quote/note 仅字符串保留（空串 quote 省略）。
 */
export function parseBookmarks(text: string | undefined): ReaderBookmark[] {
    if (text === undefined || text === '') return [];
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) return [];

    const out: ReaderBookmark[] = [];
    for (const item of raw) {
        const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
        if (!o) continue;
        if (typeof o.chapter !== 'number' || !Number.isInteger(o.chapter) || o.chapter < 1) continue;
        if (typeof o.pct !== 'number' || !Number.isFinite(o.pct) || o.pct < 0 || o.pct > 100) continue;

        // 仅当原数据含合法 id/createdAt 才写入；缺省则字段不出现（旧数据/手写数据容错）
        const bm = { chapter: o.chapter, pct: o.pct } as ReaderBookmark;
        if (typeof o.id === 'string') bm.id = o.id;
        if (typeof o.createdAt === 'number') bm.createdAt = o.createdAt;
        if (typeof o.quote === 'string' && o.quote !== '') bm.quote = o.quote;
        if (typeof o.note === 'string' && o.note !== '') bm.note = o.note;
        out.push(bm);
    }
    return out;
}

/** 序列化为 JSON 文本（落盘用） */
export function serializeBookmarks(list: ReaderBookmark[]): string {
    return JSON.stringify(list);
}

/**
 * 新建书签：id = bm-{Date.now().toString(36)}；quote 裁剪首尾空白，空/纯空白 → undefined（纯位置书签）。
 * 「纯」含义限定为形状与裁剪语义可测——精确 id/时间由调用时时钟决定，不在测试断言范围内。
 */
export function newBookmark(chapter: number, pct: number, quote?: string): ReaderBookmark {
    const clampedPct = Math.min(100, Math.max(0, pct));
    return {
        id: `bm-${Date.now().toString(36)}`,
        chapter,
        pct: clampedPct,
        quote: quote?.trim() || undefined,
        createdAt: Date.now(),
    };
}
