// 添加按钮初始类型解析（纯逻辑，可单测）
// 「＋ 添加」在各类视图下的默认类型规则（影视聚合页签的「添加跟随聚焦」）：
//  - 单类型页签（书籍/游戏/音乐等，lockType 非空）→ 恒锁该类型（无视内层 typeFilter）；
//  - 聚合页签（影视，lockType=null）→ 聚焦「全部」返回 undefined（EntryForm 兜底默认电影），
//    聚焦 动画/电视剧/电影 任一类型返回该类型——新增表单默认选中、搜索走对应数据源，
//    保存后新条目也落在当前聚焦视图内。
// 返回值经 onAdd(lockType ?? undefined) 旧实现演进而来：旧逻辑聚合页签恒 undefined（恒默认电影），
// 与「列表聚焦某类型」的视图状态错位。
import type { EntryType } from 'data/types';

export function resolveAddType(
    lockType: EntryType | null,
    typeFilter: 'all' | EntryType,
): EntryType | undefined {
    if (lockType) return lockType;
    return typeFilter === 'all' ? undefined : typeFilter;
}
