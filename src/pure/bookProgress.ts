// 书籍阅读进度基准校正（纯逻辑，可单测）：
// 原则——percent 是唯一进度真源；本地文件是进度基准（PDF 按页 numPages 精确；TXT 无页数概念，按章节解析 totalChapters；
// EPUB 无轻量探针不校正）；豆瓣 pageCount 只是元数据（展示/统计），不参与换算。
// 校正时机：打开书籍文件 / 表单选择保存文件时（main 层拿到本地基准后调用），静默失败不影响阅读。
export interface BookProgressFields {
    page?: number;
    totalPage?: number;
    /** 阅读器进度百分比（0-100，唯一真源） */
    percent?: number;
    /** 元数据页数（豆瓣实体书；惰性迁移回填） */
    pageCount?: number;
}

/** 本地书籍文件探针结果（表单自动关联用）：PDF → 页数基准；TXT → 章节基准（按章节解析） */
export type BookProbeResult =
    | { format: 'pdf'; numPages: number }
    | { format: 'txt'; totalChapters: number };

export type BookFileInfo = BookProbeResult | { format: 'epub' } | null;

export interface BookProgressReconcile {
    /** 需要落库的进度字段（无变化时缺省，调用方跳过写入） */
    readingProgress?: { page?: number; totalPage?: number; percent?: number };
    /** 惰性迁移回填的元数据页数（旧 totalPage 来自豆瓣且 pageCount 为空时） */
    pageCount?: number;
}

/** 百分比 → 页码（等比例取整，钳制 0..totalPage；totalPage 非法返回 0） */
export function pageFromPercent(percent: number, totalPage: number): number {
    if (!Number.isFinite(totalPage) || totalPage <= 0) return 0;
    const pct = Math.max(0, Math.min(100, percent));
    return Math.max(0, Math.min(totalPage, Math.round((pct / 100) * totalPage)));
}

/**
 * 进度基准校正：
 * - PDF：totalPage 收紧为本地 numPages（进度基准）；percent 存在 → page 由 percent 重算（percent 恒定，换文件自然平移）；
 *   手填无 percent → page 保留但超界钳制；旧 totalPage ≠ 本地页数且 pageCount 为空 → 惰性迁移 pageCount=旧 totalPage。
 * - TXT：与 PDF 同构，按章节解析——totalPage 收紧为本地 totalChapters；percent 恒定重算当前章；手填钳制；
 *   不做 pageCount 迁移（TXT 无「页」概念，豆瓣实体书页数与章节数无关）。
 * - EPUB / 无文件：不校正（percent 直落，totalPage 语义保持手填/豆瓣兜底）。
 * - 无变化返回 {}（调用方可跳过落库）。
 */
export function reconcileBookProgress(current: BookProgressFields, file: BookFileInfo): BookProgressReconcile {
    if (!file || file.format === 'epub') return {};
    // 进度基准：PDF=本地页数；TXT=本地章节数（按章节解析）
    const base = file.format === 'pdf' ? file.numPages : file.totalChapters;
    if (!Number.isInteger(base) || base <= 0) return {};

    const out: { page?: number; totalPage?: number; percent?: number } = { totalPage: base };
    let migratedPageCount: number | undefined;

    if (typeof current.percent === 'number') {
        // 阅读器进度为真源：page 恒由 percent 派生（percent 恒定 → 换文件基准平移，不丢进度）
        const page = pageFromPercent(current.percent, base);
        out.page = page;
        out.percent = current.percent;
    } else {
        // 手填页码（无阅读器 percent）：透传手填 page（输出须为完整进度字段，调用方整体替换），仅超界时钳制
        out.page = current.page !== undefined && current.page > base ? base : current.page;
    }

    // 惰性迁移仅 PDF：旧 totalPage 与本地页数不一致（典型=豆瓣实体书页数）且元数据为空 → 回填为 pageCount
    if (file.format === 'pdf' && current.totalPage !== undefined && current.totalPage !== base && current.pageCount === undefined) {
        migratedPageCount = current.totalPage;
    }

    const progressChanged =
        out.page !== current.page ||
        out.totalPage !== current.totalPage ||
        (out.percent !== undefined && out.percent !== current.percent);

    if (!progressChanged) return {};
    return {
        readingProgress: out,
        ...(migratedPageCount !== undefined ? { pageCount: migratedPageCount } : {}),
    };
}
