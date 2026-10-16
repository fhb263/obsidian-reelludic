// 添加按钮初始类型解析（纯逻辑，可单测）
// 「＋ 添加」在各类视图下的默认类型规则：
//  - 单类型页签（书籍/游戏/音乐等，lockType 非空）→ 恒锁该类型（无视内层 typeFilter）；
//  - 聚合页签（影视，lockType=null）→ 聚焦 动画/剧集/电影 任一类型返回该类型（新增表单默认选中、
//    搜索走对应数据源，保存后新条目也落在当前聚焦视图内）；聚焦「全部」→ 这份里没有型别；
//  - 🔴 #555 **系列视图**：在某一系列卡里看时范围已被**这一组**切干净（组键含 `type`，见
//    `pure/seriesGroup`）⇒ 此时「添加」必须默认成**该系列的类型**。
//    用户报的就是这条：「无法在对应类型的系列卡内添加新条目时默认为该系列卡类型，
//    如在动画系列卡视图上添加条目时聚焦为电影而不是动画」——根因：聚合页签下
//    `lockType` / `typeFilter` 都停在「全部」，而**系列的型别根本不在这两个变量里**。
// 返回值经 onAdd(lockType ?? undefined) 旧实现演进而来：旧逻辑聚合页签恒 undefined（恒默认电影），
// 与「列表聚焦某类型」的视图状态错位。
import type { EntryType } from 'data/types';

/**
 * @param lockType    页签锁定的类型（单类型页签非空；聚合页签 null）
 * @param typeFilter  聚合页签内类型 chips 当前聚焦（'all' = 不聚焦）
 * @param seriesType  当前系列视图所属类型（不在系列视图时传 null / undefined）
 */
export function resolveAddType(
    lockType: EntryType | null,
    typeFilter: 'all' | EntryType,
    seriesType?: EntryType | null,
): EntryType | undefined {
    if (lockType) return lockType;
    if (typeFilter !== 'all') return typeFilter;
    return seriesType ?? undefined;
}
