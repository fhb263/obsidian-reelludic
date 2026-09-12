// 搜索框类型下拉展示值派生（纯逻辑，可单测）
// 「漫画」是书籍类目的 comic 子类（非独立 EntryType），但用户在搜索框下拉里把它当第六个类型用：
//  - 选中「漫画」= type='book' + bookKind='comic'（搜索走漫画源链 Bangumi+豆瓣，见 main.searchBook 路由）；
//  - 下拉展示值（SearchTypeSel）与真实类型（EntryType + bookKind）之间的双向派生规则集中在此，
//    EntryForm 只做状态搬运，避免双向绑定在组件里绕出环。
import type { EntryType, BookKind } from 'data/types';

/** 搜索框类型下拉的展示选择值：六种 EntryType + 「漫画」快捷态 */
export type SearchTypeSel = EntryType | 'comic';

/** 真实 (type, bookKind) → 下拉展示值：编辑初始化与分类 chips 反向同步用 */
export function toSearchTypeSel(type: EntryType, bookKind: BookKind): SearchTypeSel {
    return type === 'book' && bookKind === 'comic' ? 'comic' : type;
}

/**
 * 下拉选择值 → 真实 (type, bookKind)：
 *  - 「漫画」→ 书籍 + comic 分类（编辑模式下也算用户主动改分类，与 chips 点「漫画」等价）；
 *  - 添加模式从「漫画」切回「书籍」→ 分类复位出版（下拉「书籍」的直观语义 = 出版书，避免下拉/chips 矛盾态）；
 *  - 编辑模式永不复位：仅切下拉不得静默改写既有条目的分类（否则换个词重搜就会把漫画条目存成出版），改分类走 chips。
 */
export function applySearchTypeSel(
    sel: SearchTypeSel,
    curType: EntryType,
    curBookKind: BookKind,
    isAddMode: boolean,
): { type: EntryType; bookKind: BookKind } {
    if (sel === 'comic') return { type: 'book', bookKind: 'comic' };
    // 切到非书籍类型时 bookKind 原样保留：非书籍态不显示不落库，切回书籍时再按上行规则处理
    const resetComic = isAddMode && sel === 'book' && curBookKind === 'comic';
    return { type: sel, bookKind: resetComic ? 'book' : curBookKind };
}
