// 阅读进度持久化（纯逻辑，可单测）：每本书一个 JSON 对象，vault 内 阅读进度/{id}.json 由 main.ts 读写
// 存储结构：{ chapterIndex, scrollRatio（章节内滚动百分比 0-1）, updatedAt }

export interface ReadingProgress {
    /** 当前章节索引（EPUB spine 序 / TXT 章节序，-1=未开始） */
    chapterIndex: number;
    /** 章节内阅读位置（0-1：单页连续滚动为滚动比例；双页为页对位置） */
    scrollRatio: number;
    /** 最近阅读时间（ISO 字符串） */
    updatedAt: string;
}

export function createEmptyProgress(): ReadingProgress {
    return { chapterIndex: -1, scrollRatio: 0, updatedAt: new Date().toISOString() };
}

/** 校验并归一化外部读取的进度（容错旧数据/损坏）：字段缺失回退默认 */
export function normalizeProgress(raw: unknown): ReadingProgress {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const chapterIndex = typeof o.chapterIndex === 'number' && o.chapterIndex >= -1 ? Math.floor(o.chapterIndex) : -1;
    const scrollRatio = typeof o.scrollRatio === 'number' && o.scrollRatio >= 0 && o.scrollRatio <= 1 ? o.scrollRatio : 0;
    const updatedAt = typeof o.updatedAt === 'string' && !Number.isNaN(new Date(o.updatedAt).getTime()) ? o.updatedAt : new Date().toISOString();
    return { chapterIndex, scrollRatio, updatedAt };
}

/** 进度比较：后一次阅读位置是否比前一次更深（恢复时提示「继续上次阅读」） */
export function isProgressDeeper(prev: ReadingProgress, next: ReadingProgress): boolean {
    if (next.chapterIndex !== prev.chapterIndex) return next.chapterIndex > prev.chapterIndex;
    return next.scrollRatio > prev.scrollRatio;
}

/**
 * 整体阅读百分比估算（0-100，四舍五入）：按各章大小加权。
 * chapterSizes = 每章大小（TXT 段落数 / EPUB 字符数），进度 = (前序章总和 + 当前章 × scrollRatio) / 总和。
 * 边界：空列表/越界 → 0；scrollRatio 钳制 0-1；章节大小负值按 0 计；结果钳制 0-100。
 */
export function estimatePercent(chapterSizes: number[], chapterIndex: number, scrollRatio: number): number {
    if (!Array.isArray(chapterSizes) || chapterSizes.length === 0) return 0;
    if (chapterIndex < 0 || chapterIndex >= chapterSizes.length) return 0;
    const r = Math.max(0, Math.min(1, scrollRatio));
    const sizes = chapterSizes.map((s) => (typeof s === 'number' && s > 0 ? s : 0));
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let done = 0;
    for (let i = 0; i < chapterIndex; i++) done += sizes[i];
    done += sizes[chapterIndex] * r;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}
