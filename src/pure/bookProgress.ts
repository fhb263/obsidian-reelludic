// 书籍阅读进度基准校正（纯逻辑，可单测）：
// 原则——percent 是唯一进度真源；本地文件是进度基准（PDF 按页 numPages 精确；TXT/EPUB 无页数概念，按章节解析 totalChapters；
// EPUB 解包拿 spine 章节数做基准；无文件/未知时 pageCount 只是元数据（展示/统计），不参与换算）。
// 校正时机：打开书籍文件 / 表单选择保存文件时（main 层拿到本地基准后调用），静默失败不影响阅读。
export interface BookProgressFields {
    page?: number;
    totalPage?: number;
    /** 阅读器进度百分比（0-100，唯一真源） */
    percent?: number;
    /** 元数据页数（豆瓣实体书；惰性迁移回填） */
    pageCount?: number;
}

/** 本地书籍文件探针结果（表单自动关联用）：PDF → 页数基准；TXT → 章节基准（按章节解析）；EPUB → spine 章节基准；
 *  漫画（#537，图片文件夹 / CBZ / CBT）→ 页数基准（与 PDF 同构，都是「页」制） */
export type BookProbeResult =
    | { format: 'pdf'; numPages: number }
    | { format: 'txt'; totalChapters: number }
    | { format: 'epub'; totalChapters: number }
    | { format: 'comic'; numPages: number };

/** 无探针信息的 EPUB 占位（兼容旧调用/旧数据：不校正）；null = 无本地文件 */
export type BookFileInfo = BookProbeResult | { format: 'epub' } | null;

export interface BookProgressReconcile {
    /** 需要落库的进度字段（无变化时缺省，调用方跳过写入） */
    readingProgress?: { page?: number; totalPage?: number; percent?: number };
    /** 惰性迁移回填的元数据页数（旧 totalPage 来自豆瓣且 pageCount 为空时） */
    pageCount?: number;
}

/**
 * 🔴 #609：本次写入 patch 是否**清空了本地书籍文件** ⇒ 该书的阅读进度也该一并清掉。
 *
 * 起因（用户报障）：「阅读进度条取消本地文件关联后，应该清除海报墙封面的阅读进度条样式」。
 * 真根因：解除关联只清 `bookFile`，`readingProgress` 留着；而海报墙的进度行判据
 * （`pure/mediaProgress.readPercent`）**只看 `readingProgress`**、完全不看 `bookFile`
 * ⇒ 文件没了、进度条照画。用户裁定 = **直接清掉数据**（不是「只不显示」）。
 *
 * 🔴 判据两条，缺一不可：
 *   ⑴ `'bookFile' in patch` —— 只有**本次真的动了这个字段**才算（否则「改个标题」这类不带 `bookFile`
 *      的 patch 会因为在原型上没有该键而被误判成「清空」）；
 *   ⑵ 清空后的值是**空/空白**（统一走 trim ⇒ `''` 与 `'   '` 同口径）。
 * ⚠️ 纯函数、无 obsidian 依赖（本仓「纯逻辑下沉」红线）；调用点只有 `EntryService.update` 一处
 *    —— ⛔ 别在右键弹窗 / 编辑表单里各判一次（那正是本仓反复踩的「两份必然漂」）。
 * ⚠️ 形参写成 `object`（而不是 `{ bookFile?: unknown }`）—— 调用点传的是 `Partial<MediaEntry>`
 *    （带一堆别的键），窄形参会让**对象字面量**在调用处撞「多余属性检查」（测试里就是这么撞的）。
 */
export function dropsReadingProgress(patch: object): boolean {
    if (!('bookFile' in patch)) return false;
    return !String((patch as { bookFile?: unknown }).bookFile ?? '').trim();
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
 * - TXT / EPUB：与 PDF 同构，按章节解析——totalPage 收紧为本地 totalChapters；percent 恒定重算当前章；手填钳制；
 *   不做 pageCount 迁移（TXT/EPUB 无「页」概念，豆瓣实体书页数与章节数无关）。
 * - EPUB（无 totalChapters 的旧占位）/ 无文件：不校正（percent 直落，totalPage 语义保持手填/豆瓣兜底）。
 * - 无变化返回 {}（调用方可跳过落库）。
 */
export function reconcileBookProgress(current: BookProgressFields, file: BookFileInfo): BookProgressReconcile {
    if (!file) return {};
    // EPUB 旧占位（无 totalChapters 字段 = 未探知章节数）：不校正
    if (file.format === 'epub' && !('totalChapters' in file)) return {};
    // 进度基准：PDF / 漫画（#537）= 本地页数；TXT / EPUB = 本地章节数（spine 解析）
    const base = file.format === 'pdf' || file.format === 'comic' ? file.numPages : file.totalChapters;
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
