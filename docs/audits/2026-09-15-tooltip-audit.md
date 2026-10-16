# 可交互元素悬停提示审计（2026-09-15）

> 扫描范围：src/**（svelte + ts）+ main.ts，共 108 个文件；可交互元素 147 个。
> 已有提示 **96** 个；无提示 **51** 个 —— 其中判定「✅需补」4 个、「🟡可选」1 个，其余均为「语义自解释、无需提示」。

## 一、无提示清单（51 个，含逐条判定）

| 判定 | 位置 | 元素 | 说明 |
|---|---|---|---|
| — | **src/views/components/CalendarBoard.svelte** | | |
| 无需 | src/views/components/CalendarBoard.svelte:269 | <button> | 月历日期格，日期数字自解释 |
| 无需 | src/views/components/CalendarBoard.svelte:295 | <div> | 周历日期格，同上 |
| — | **src/views/components/EntryForm.svelte** | | |
| 无需 | src/views/components/EntryForm.svelte:1344 | <div> | 表单根容器（Ctrl+Enter 提交的快捷键宿主，非按钮） |
| 无需 | src/views/components/EntryForm.svelte:1361 | <select> | 类型下拉，有可见选中值（aria 已有） |
| 无需 | src/views/components/EntryForm.svelte:1366 | <input> | 搜索输入框，placeholder 自解释 |
| 无需 | src/views/components/EntryForm.svelte:1369 | <button> | 「搜索」按钮，有文字 |
| 无需 | src/views/components/EntryForm.svelte:1373 | <button> | 「手动填写」按钮，有文字 |
| 无需 | src/views/components/EntryForm.svelte:1411 | <div> | 搜索结果容器（点击空白取消）；容器上方已有文字说明 |
| 无需 | src/views/components/EntryForm.svelte:1482 | <input> | 封面 URL 输入框 |
| 无需 | src/views/components/EntryForm.svelte:1486 | <div> | 封面预览容器（点击有右键说明 tip 在图上） |
| 无需 | src/views/components/EntryForm.svelte:1488 | <button> | 「更换本地图片…」有文字 |
| 无需 | src/views/components/EntryForm.svelte:1489 | <button> | 「更换网络图片…」有文字 |
| 无需 | src/views/components/EntryForm.svelte:1491 | <button> | 「移除封面」有文字 |
| 无需 | src/views/components/EntryForm.svelte:1495 | <input> | 网络图片 URL 输入框 |
| 无需 | src/views/components/EntryForm.svelte:1497 | <button> | 「使用」按钮，有文字 |
| 无需 | src/views/components/EntryForm.svelte:1591 | <input> | 页数输入框，placeholder 自解释 |
| 无需 | src/views/components/EntryForm.svelte:1615 | <input> | 「当前进度 S」输入框，有 S/E 标签 |
| 无需 | src/views/components/EntryForm.svelte:1617 | <input> | 「当前进度 E」输入框，同上 |
| 无需 | src/views/components/EntryForm.svelte:1672 | <div> | 编辑浮层背板（点击关闭，非按钮） |
| 无需 | src/views/components/EntryForm.svelte:1683 | <button> | 「取消」按钮，有文字 |
| ✅需补 | src/views/components/EntryForm.svelte:1722 | <button> | 纯图标（刷新），无提示；读屏名还带内部机制语「（测试获取）」 |
| 无需 | src/views/components/EntryForm.svelte:1751 | <div> | 音频编辑浮层背板 |
| 无需 | src/views/components/EntryForm.svelte:1762 | <button> | 「取消」按钮 |
| 无需 | src/views/components/EntryForm.svelte:1785 | <div> | 书籍编辑浮层背板 |
| 无需 | src/views/components/EntryForm.svelte:1796 | <button> | 「取消」按钮 |
| ✅需补 | src/views/components/EntryForm.svelte:1812 | <button> | 「检索剧集」纯图标（folder-search），无提示；快捷关联弹窗同款按钮有提示 |
| 无需 | src/views/components/EntryForm.svelte:1845 | <div> | 集编辑浮层背板 |
| 无需 | src/views/components/EntryForm.svelte:1849 | <input> | 集标题输入框，placeholder 自解释 |
| 无需 | src/views/components/EntryForm.svelte:1860 | <button> | 「取消」按钮 |
| 无需 | src/views/components/EntryForm.svelte:1871 | <button> | 状态 chips，有文字 |
| ✅需补 | src/views/components/EntryForm.svelte:1896 | <span> | 星级 ★ 可点，但「点同一颗星=取消」不可见（容器加一条） |
| 无需 | src/views/components/EntryForm.svelte:1922 | <button> | 「保存并生成笔记 / 更新笔记」主按钮，有文字 |
| — | **src/views/components/HomeView.svelte** | | |
| 无需 | src/views/components/HomeView.svelte:207 | <button> | 顶部页签，有文字（下划线选中语义） |
| — | **src/views/components/MediaList.svelte** | | |
| 无需 | src/views/components/MediaList.svelte:485 | <input> | 搜索输入框，aria 已有 |
| 无需 | src/views/components/MediaList.svelte:507 | <button> | 类型筛选 chips，有文字+计数 |
| 无需 | src/views/components/MediaList.svelte:517 | <button> | 书籍分类 chips，同上 |
| ✅需补 | src/views/components/MediaList.svelte:621 | <div> | 海报墙卡片（role=link）；瀑布流卡片 / 音乐行 / 追番表都有「打开笔记：{标题}」，唯独它没有 |
| 无需 | src/views/components/MediaList.svelte:698 | <div> | 卡片状态菜单容器（非按钮） |
| 无需 | src/views/components/MediaList.svelte:700 | <button> | 状态菜单项，有文字 |
| 无需 | src/views/components/MediaList.svelte:760 | <input> | 表头全选框，aria 已有（再加 tip 会双气泡） |
| 无需 | src/views/components/MediaList.svelte:788 | <input> | 行勾选框，原生控件自解释 |
| 🟡可选 | src/views/components/MediaList.svelte:794 | <span> | 列表行标题（role=link）；标题文字即语义，但追番表同款有「打开笔记：{标题}」——为一致性可补 |
| 无需 | src/views/components/MediaList.svelte:845 | <button> | 页码数字按钮，数字即语义 |
| 无需 | src/views/components/MediaList.svelte:865 | <div> | 右键菜单容器（非按钮） |
| — | **src/views/components/StatsBoard.svelte** | | |
| 无需 | src/views/components/StatsBoard.svelte:218 | <button> | 「＋ 添加条目」有文字 |
| 无需 | src/views/components/StatsBoard.svelte:219 | <button> | 「🎲 随机推荐」有文字 |
| 无需 | src/views/components/StatsBoard.svelte:220 | <button> | 「想看的清单（N）」有文字 |
| 无需 | src/views/components/StatsBoard.svelte:221 | <button> | 「生成今年总结」有文字 |
| 无需 | src/views/components/StatsBoard.svelte:223 | <button> | 「往年报告」下拉，有文字 |
| 无需 | src/views/components/StatsBoard.svelte:227 | <div> | 下拉背板（点击关闭） |
| 无需 | src/views/components/StatsBoard.svelte:233 | <button> | 报告菜单项，有文字 |

## 二、已有提示清单（96 个，按文件分组）


### src/views/components/CalendarBoard.svelte

- `193` 上个月
- `195` 下个月
- `197` 上一周
- `199` 下一周
- `202` 回到今天
- `204` 回到本周
- `207` 月视图
- `208` 周视图
- `220` 打开笔记：{e.title}
- `223` 关闭提醒（今天不再提醒）
- `226` 关闭提醒（今天不再提醒）
- `310` 打开笔记：{e.title}

### src/views/components/EntryForm.svelte

- `1420` 点击回填该条目
- `1438` 打开 {d.source} 页面
- `1452` 该来源本次搜索未返回可展示结果
- `1513` 打开数据源页面
- `1524` 打开数据源页面
- `1609` 列表/月历按此显示进度
- `1639` AI 生成一句话总结与核心看点（${AI_HIGHLIGHT_SUGGEST} 条） ⏎ 复用「阅读器翻译」的 AI 服务商与 API Key；生成后可手动修改
- `1662` (动态)
- `1677` 选择游戏启动快捷方式（系统文件管理器）
- `1678` 选择游戏启动快捷方式（系统文件管理器）
- `1681` 保存启动快捷方式关联
- `1682` 清除启动快捷方式关联
- `1702` AI 生成一句话总结与核心看点（${AI_HIGHLIGHT_SUGGEST} 条） ⏎ 复用「阅读器翻译」的 AI 服务商与 API Key；生成后可手动修改
- `1741` (动态)
- `1756` 选择音频（系统文件管理器）
- `1757` 选择音频（系统文件管理器）
- `1760` 保存本地音频关联
- `1761` 清除本地音频关联
- `1775` (动态)
- `1790` 选择书籍文件（系统文件管理器）
- `1791` 选择书籍文件（系统文件管理器）
- `1794` 保存书籍文件关联
- `1795` 清除书籍文件关联
- `1821` (动态)
- `1830` (动态)
- `1852` 选择本地视频（系统文件管理器）
- `1853` 选择本地视频（系统文件管理器）
- `1856` 保存本集标题/本地/网络关联
- `1858` 保存本集标题/本地/网络关联
- `1859` 清除本集标题与本地/网络关联
- `1911` 按当前标题重搜数据源，回填客观字段（不覆盖主观内容与关联）
- `1912` 按当前标题重搜数据源，回填客观字段（不覆盖主观内容与关联）
- `1914` 从外部阅读器复制文本，生成摘抄块
- `1916` 日期 + 时长 + 心得，保存到游戏笔记

### src/views/components/HomeView.svelte

- `223` 列表式追番看板（按更新时间排序）
- `226` 列表式追番看板（按更新时间排序）
- `227` 日历式排期看板（按播出日期）
- `279` 回到顶部

### src/views/components/MediaList.svelte

- `496` 新建条目
- `543` 海报墙视图
- `544` 列表视图
- `545` 瀑布流视图
- `547` 分组歌单视图
- `569` 应用到选中条目
- `570` 删除选中条目（不可撤销，删除前会二次确认）
- `571` 取消当前选中（不改动任何条目）
- `581` 打开笔记：{e.title}
- `592` 我的评分
- `601` 播放音乐
- `603` 编辑条目
- `614` 清除当前全部筛选与搜索条件
- `640` 更多操作（右键菜单）
- `644` 在新选项卡打开条目笔记
- `651` (动态)
- `672` 我的评分
- `718` 清除当前全部筛选与搜索条件
- `728` 打开笔记：{e.title}
- `752` 清除当前全部筛选与搜索条件
- `778` 清除当前全部筛选与搜索条件
- `815` 编辑条目
- `820` (动态)
- `836` 上一页
- `873` 修改该条目的字段与关联
- `874` 修改该条目的字段与关联
- `876` 从外部阅读器复制文本，生成摘抄块
- `879` 日期 + 时长 + 心得，保存到游戏笔记
- `881` 删除该条目（会二次确认）

### src/views/components/StatsBoard.svelte

- `260` (动态)
- `263` (动态)
- `273` 打开笔记
- `296` 打开笔记
- `385` 打开笔记
- `406` 打开笔记
- `426` 打开笔记
- `446` 打开笔记
- `460` 关闭想看清单
- `461` 关闭想看清单
- `464` 关闭想看清单
- `473` 打开笔记

### src/views/components/TrackingBoard.svelte

- `198` 重新检查所有在追条目的更新
- `199` 从 Bangumi 收藏列表批量导入动画条目
- `222` 打开笔记：{e.title}
- `265` 打开观看链接
- `267` 编辑条目
