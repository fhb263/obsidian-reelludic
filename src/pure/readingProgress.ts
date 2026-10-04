// 阅读进度持久化（纯逻辑，可单测）：每本书一个 JSON 对象，vault 内 阅读进度/{书名}-阅读进度|书签-{id}.json 由 main.ts 读写
// 存储结构：{ chapterIndex, scrollRatio（章节内滚动百分比 0-1）, updatedAt }
// 文件名演进：早期按纯 entryId（e_xxx.json / e_xxx.bookmarks.json，难辨认书名）→ 现可读名
// 「{书名}-阅读进度-{id}.json / {书名}-书签-{id}.json」：前段书名可读、尾段保留原 ID 供关联与去重。

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

/** 文件名标题安全段：清理文件名字符（同 noteGenerator.safeFilename 规则），空 → '未命名' */
export function sanitizeReaderTitle(title: string): string {
    const cleaned = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || '未命名';
}

/** 可读进度文件名：{书名}-阅读进度-{id}.json（id 保留作关联与去重） */
export function progressFileName(entryId: string, title: string): string {
    return `${sanitizeReaderTitle(title)}-阅读进度-${entryId}.json`;
}

/** 可读书签文件名：{书名}-书签-{id}.json */
export function bookmarksFileName(entryId: string, title: string): string {
    return `${sanitizeReaderTitle(title)}-书签-${entryId}.json`;
}

/** 阅读进度文件路径：{libraryDir}/阅读进度/{书名}-阅读进度-{id}.json。
 *  libraryDir 去尾部斜杠，空串/纯斜杠回退 'ReelLudic'（对齐 main.ts libDir 约定）；纯字符串拼接无 normalizePath。 */
export function readingProgressFilePath(entryId: string, title: string, libraryDir: string): string {
    const dir = libraryDir.replace(/\/+$/, '') || 'ReelLudic';
    return `${dir}/阅读进度/${progressFileName(entryId, title)}`;
}

/** 旧格式进度/书签文件名识别（可读名迁移用）：e_xxx.json → progress、e_xxx.bookmarks.json → bookmarks；
 *  新可读名/无关文件 → null（幂等防误伤）。 */
export function matchLegacyProgressFile(fileName: string): { entryId: string; kind: 'progress' | 'bookmarks' } | null {
    const m = /^(e_\d+_[a-z0-9]{4})\.(bookmarks\.)?json$/.exec(fileName);
    if (!m) return null;
    return { entryId: m[1], kind: m[2] ? 'bookmarks' : 'progress' };
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
 * 末章钳制：chapterIndex 为最后一章且 scrollRatio ≥ 0.95 → 100（连续滚动容器底部 padding 使
 * scrollTop/max 到不了精确 1.0，拉到文末视觉到底时落库常 97-99% → 海报墙永远差一点）。
 */
export function estimatePercent(chapterSizes: number[], chapterIndex: number, scrollRatio: number): number {
    if (!Array.isArray(chapterSizes) || chapterSizes.length === 0) return 0;
    if (chapterIndex < 0 || chapterIndex >= chapterSizes.length) return 0;
    const r = Math.max(0, Math.min(1, scrollRatio));
    // 末章读至 95%+ 视为读完（见上注释）；非末章不钳（高比例不代表读完）
    if (chapterIndex === chapterSizes.length - 1 && r >= 0.95) return 100;
    const sizes = chapterSizes.map((s) => (typeof s === 'number' && s > 0 ? s : 0));
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= 0) return 0;
    let done = 0;
    for (let i = 0; i < chapterIndex; i++) done += sizes[i];
    done += sizes[chapterIndex] * r;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/**
 * 章内比例取值（#469）—— TXT / EPUB 两个阅读器**共用这一份**（⛔ 别各写一套）。
 *
 * 🔴 为什么必须把「拿不到测量值」与「位置在章头」分成两档 —— **不可测量 ≠ 章头**（用户 2026-10-01 报障：
 *    「TXT/EUPB阅读器定位阅读进度怎么只能到章头，上次看到章中间具体段落现在打开还是到章头」）：
 *    阅读器保存进度走 `flushSave()`（挂在关闭阅读器的 destroy 链上），它直接取「当前比例」；
 *    而「当前比例」= `scrollTop / (scrollHeight − clientHeight)`。
 *    **元素不在布局里时**（标签页被切走 → `display:none`、leaf 被 detach、Obsidian 退出）
 *    `scrollHeight` 与 `clientHeight` 会**双双变成 0** —— 真 Chrome 实测（`_shot/rd468.html`）：
 *    可见态 `sh=9936 / ch=398`，元素或祖先 `display:none` 后 `sh=0 / ch=0`，
 *    而 `visibility:hidden` 不受影响（仍有布局盒）。
 *    旧实现在那一刻 `return 0` ⇒ 把「读到章中间」的进度**静默抹成「章头」**并落库
 *    ⇒ 下次打开恢复到 0 ⇒ 永远回章头（活动库里多本 `scrollRatio: 0` 就是这么来的）。
 *
 * 口径（两档，⛔ 别合并成一档）：
 *   · `clientHeight <= 0` ⇒ **元素没有布局盒** ⇒ 拿不到位置 ⇒ 返回 `last`（上次已知比例）；
 *   · `clientHeight > 0 && max <= 0` ⇒ 元素在布局里、只是内容不足一屏 ⇒ **位置确实在章头** ⇒ 返回 0。
 *
 * `measured` 传 `null`（元素尚未渲染 / iframe 未就绪 / scroller 取不到）同样按「拿不到」处理。
 * `last` 由调用方维护：可测量时随手更新、人为定位后用目标值、**切章时重置 0**。
 */
export function readerRatio(
    measured: { scrollTop: number; scrollHeight: number; clientHeight: number } | null | undefined,
    last: number,
): number {
    const safeLast = Number.isFinite(last) ? Math.max(0, Math.min(1, last)) : 0;
    if (!measured) return safeLast;
    const { scrollTop, scrollHeight, clientHeight } = measured;
    if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return safeLast;
    // 无布局盒（display:none / 未挂载）⇒ sh 与 ch 都是 0 ⇒ 拿不到位置，沿用上次已知
    if (clientHeight <= 0) return safeLast;
    const max = scrollHeight - clientHeight;
    if (max <= 0) return 0;
    return Math.max(0, Math.min(1, scrollTop / max));
}
