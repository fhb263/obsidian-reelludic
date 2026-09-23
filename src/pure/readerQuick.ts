// 阅读器顶栏「快捷入口」的**模式 id 契约**（TXT / EPUB 共用）。
//
// 为什么独立成模块：这 6 个 id 原本在两个 modal 里**各写一份联合类型**，改一处漏一处；
// 现在只有这一份真源，两个 modal 用 `import type` 取。
//
// ⚠️ **顺序是契约**（用户 2026-09-18 定：书签 · 高亮 · 摘抄 · 翻译 · 网络搜索 · AI搜索）——
//    由两个 modal 里 `mkQuick(...)` 的**调用顺序**表达，产物断言按序核对；
//    ⛔ 不在本模块里再造一份顺序数组（会变成第三个真源，且无人引用必被 tree-shaking 摇掉）。
// ⚠️ 2026-09-20 起窄屏「更多」浮层**只放图标**（用户裁定「收起菜单不要文字了」），
//    故这里不再维护中文短标签表；每个入口的可读名称仍在按钮的 `data-tip` 里。

export type ReaderQuickMode = 'bookmark' | 'quote' | 'languages' | 'highlighter' | 'netsearch' | 'aisearch';
