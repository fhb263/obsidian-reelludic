// 搜索框类型下拉展示值派生（纯逻辑，可单测）
// 「网文」「漫画」是书籍类目的 bookKind 子类（非独立 EntryType），但搜索框下拉把它们当独立类型用——
// 下拉是书籍分类的唯一入口（表单内「书籍分类」chips 已移除，2026-09-12 用户裁定）：
//  - 选中「漫画」= type='book' + bookKind='comic'（搜索走漫画源链 Bangumi+豆瓣，见 main.searchBook 路由）；
//  - 选中「网文」= type='book' + bookKind='novel'（走 book 链豆瓣主源）；
//  - 选中「书籍」= type='book' + bookKind='book'（出版，无条件复位——下拉即分类，切换即明确意图）；
//  - 其余类型 bookKind 原样保留（非书籍态不显示不落库，切回书籍时用户在下拉上明确选择子类）。
import type { EntryType, BookKind } from 'data/types';

/** 搜索框类型下拉的展示选择值：六种 EntryType + 网文/漫画快捷态（'book' 同值复用为出版态） */
export type SearchTypeSel = EntryType | 'novel' | 'comic';

/** 真实 (type, bookKind) → 下拉展示值：编辑初始化自动回显（书籍态显示子类本名，非书籍恒类型本名） */
export function toSearchTypeSel(type: EntryType, bookKind: BookKind): SearchTypeSel {
    return type === 'book' ? bookKind : type;
}

/** 下拉选择值 → 真实 (type, bookKind)：网文/漫画落到对应 bookKind，书籍复位出版 */
export function applySearchTypeSel(
    sel: SearchTypeSel,
    curBookKind: BookKind,
): { type: EntryType; bookKind: BookKind } {
    if (sel === 'novel' || sel === 'comic') return { type: 'book', bookKind: sel };
    if (sel === 'book') return { type: 'book', bookKind: 'book' };
    return { type: sel, bookKind: curBookKind };
}
