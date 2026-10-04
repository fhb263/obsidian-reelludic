// 书籍子分类（文学 / 网文 / 漫画）纯逻辑：归一 + 匹配 + 计数。
// 1.0.3 起阅读页签提供【全部 / 文学 / 网文】子分类 chips（对标影视聚合页签的类型 chips）。
// 🔴 2026-09-30 用户裁定**加回**「漫画」：阅读页签恢复四桶【全部 / 文学 / 网文 / 漫画】，
//    且漫画在源链里**独立成组**（主源豆瓣，见 pure/sourceRegistry.sourceGroupForBookKind）。
//    ⚠️ comic 在 1.0.3.1 曾下线过（2026-09-13 裁定），本次是**加回** —— 本模块对它与 book/novel **完全同构**
//       （归一 / 匹配 / 计数三处**零特判**：新增值只要进 BOOK_KIND_LABELS 就被 VALID_KINDS 自动涵盖）。
// 缺省归「book」（展示为「文学」；用户 2026-09-12 裁定改名，原「出版」）：未指定 bookKind 的存量书籍不丢失，网文 / 漫画在搜索框类型下拉显式选择。
import type { BookKind } from 'data/types';

export const BOOK_KINDS: BookKind[] = ['book', 'novel', 'comic'];

export const BOOK_KIND_LABELS: Record<BookKind, string> = {
    book: '文学',
    novel: '网文',
    comic: '漫画',
};

/** 顶部概览量词（子分类 chip 选中非 all 时用；用户 2026-09-12 指定：5 本书 / 5 本网文，漫画同款「本漫画」）。
 *  「全部」chip 不用此表——回落 pure/labels.overviewUnitLabel('book') = 「本书」。 */
export const BOOK_KIND_TOP_UNITS: Record<BookKind, string> = {
    book: '本书',
    novel: '本网文',
    comic: '本漫画',
};

// ⚠️ 合法值集合以 BOOK_KIND_LABELS 的**自有键**为准（与 THEME_CLASS 同法，防两处定义漂移）。
const VALID_KINDS = Object.keys(BOOK_KIND_LABELS) as BookKind[];

/**
 * 归一书籍分类：合法值原样返回，其余（缺省 / 空值 / 损坏数据）一律归「book」（展示为「文学」）。
 * ⚠️ 合法值校验用 `Object.keys` 而非 `in`——`in` 会沿原型链查找，
 * `normalizeBookKind('toString')` 会误判合法（教训同 pure/themeTokens.normalizeUiTheme，有回归测试守）。
 */
export function normalizeBookKind(raw: unknown): BookKind {
    return typeof raw === 'string' && (VALID_KINDS as string[]).includes(raw) ? (raw as BookKind) : 'book';
}

/** 分类匹配：'all' 恒命中；显式 kind 时仅 book 类型参与匹配（其余类型不命中——调用方只在阅读页签传 bookKind，此处从严防语义漏出） */
export function matchesBookKind(e: { type: string; bookKind?: BookKind }, kind: 'all' | BookKind): boolean {
    if (kind === 'all') return true;
    if (e.type !== 'book') return false;
    return normalizeBookKind(e.bookKind) === kind;
}

/** 四桶计数（只统计 book 类型条目；all = book 总数）——阅读页签 chips 数字 */
export function bookKindCounts(entries: ReadonlyArray<{ type: string; bookKind?: BookKind }>): Record<'all' | BookKind, number> {
    const out: Record<'all' | BookKind, number> = { all: 0, book: 0, novel: 0, comic: 0 };
    for (const e of entries) {
        if (e.type !== 'book') continue;
        out[normalizeBookKind(e.bookKind)]++;
        out.all++;
    }
    return out;
}
