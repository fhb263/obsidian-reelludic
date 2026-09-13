// 搜索框类型下拉展示值派生（纯逻辑，可单测）
// 「网文」是书籍类目的 bookKind 子类（非独立 EntryType），但搜索框下拉把它当独立类型用——
// 下拉是书籍分类的唯一入口（表单内「书籍分类」chips 已移除，2026-09-12 用户裁定）：
//  - 选中「网文」= type='book' + bookKind='novel'（走 book 链豆瓣主源）；
//  - 选中「书籍」= type='book' + bookKind='book'（文学，无条件复位——下拉即分类，切换即明确意图）；
//  - 其余类型 bookKind 原样保留（非书籍态不显示不落库，切回书籍时用户在下拉上明确选择子类）。
// 1.0.3.1：原「漫画」（bookKind='comic'）快捷态随漫画子视图下线（用户 2026-09-13 裁定）。
import type { EntryType, BookKind } from 'data/types';

/** 搜索框类型下拉的展示选择值：六种 EntryType + 网文快捷态（'book' 同值复用为文学态，原「出版」） */
export type SearchTypeSel = EntryType | 'novel';

/** 真实 (type, bookKind) → 下拉展示值：编辑初始化自动回显（书籍态显示子类本名，非书籍恒类型本名） */
export function toSearchTypeSel(type: EntryType, bookKind: BookKind): SearchTypeSel {
    return type === 'book' ? bookKind : type;
}

/** 下拉选择值 → 真实 (type, bookKind)：网文落到 bookKind='novel'，书籍复位文学 */
export function applySearchTypeSel(
    sel: SearchTypeSel,
    curBookKind: BookKind,
): { type: EntryType; bookKind: BookKind } {
    if (sel === 'novel') return { type: 'book', bookKind: 'novel' };
    if (sel === 'book') return { type: 'book', bookKind: 'book' };
    return { type: sel, bookKind: curBookKind };
}
