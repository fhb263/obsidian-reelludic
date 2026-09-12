# 阅读器 UI 重排批 1（仿 Readest 裁剪版）— 实施计划

> 日期：2026-09-03
> 规格：`docs/superpowers/specs/2026-09-03-reader-readest-ui-batch1-design.md`
> 执行方式：逐任务 inline（executing-plans），每任务独立 commit；构建/验证 gate 见 T13
> 工作目录：`C:\Users\kest\Desktop\obsidian-reelludic`
> 范围：TXT/EPUB 阅读器 UI 重排（D1b 顶栏自动隐藏 / 左栏三 tab / 选中动作条 / 右上下拉 / 底部进度）；书签 ★ 独立 JSON 持久化；高亮/翻译入口灰态占位

## 全局约定
- 纯逻辑（书签类型/文件路径解析）先测后码（TDD 红→绿，`tests/` 对 `src/pure/`）；UI/DOM 重构无纯逻辑则手工验证 + 产物符号断言
- 提交：每任务独立 commit，消息前缀 `feat|refactor|style: reader-batch1 …`；只本地 commit
- 书签 JSON 目录沿用阅读进度目录：`{libraryDir}/阅读进度/`，文件 `{id}.bookmarks.json`（批 2 高亮并入同目录 `{id}.annotations.json` 或合并——**本批只建 bookmarks，文件名不锁高亮**）
- 现有 TxtReaderPanel / EpubReaderPanel 为类 DOM 面板（Obsidian createEl API），两面板同构但独立实现：TXT 先做，EPUB 镜像（差异处注明）
- esbuild charset=ascii：产物中文为 `\uXXXX` 大写 hex；grep 用大写形态
- **不做**：搜索/听书/并排/词典/批注详细编辑/自动滚动/段落模式/真翻页渲染/PDF

---

## T0 基础样式重构（styles.css：顶栏/三 tab/底部/动作条框架）

涉及：`styles.css`（现有 rl-reader 段 504-733）

1. 顶栏自动隐藏：`.rl-reader-head` 增加 `position:sticky/absolute + transform 过渡`（方案：head 置于 body 顶部，`.rl-reader-head.hidden { transform: translateY(-100%); }` + transition；body mousemove 顶区唤出），保留 `.rl-reader-ops` 内按钮样式
2. 侧栏三 tab：`.rl-reader-toc-tabs` 保持，新增 `.rl-reader-toc-tab` 三种 active 切换（复用现有 `.rl-reader-toc-tab.active`）；tab 文案由代码控制
3. 底部栏 `.rl-reader-footer`：flex 布局（左章名 / 中空 / 右百分比 + 翻页按钮），章节 tick 进度条 `.rl-reader-fprog`
4. 选中动作条 `.rl-selbar`：绝对定位在正文容器内（TXT scrollEl / EPUB frame 容器），胶囊按钮组（书签/摘抄/高亮/翻译），主题色高亮，点击区域外隐藏
5. 书签 tab pane 样式复用 `.rl-reader-ex-*`（书签条目卡片：文本 + 章节定位 + 右键删除）
6. 顶栏/底部半透明渐变：沿用现有 head 背景，若改沉浸需配合正文全宽（`rl-reader-body` 布局：toc 侧栏固定，滚动区 flex 撑满）

验收：tsc 0；构建通过；打开测试库任一 TXT/EPUB 阅读器，样式不回归（目录/书签跳转可用）；commit `style: reader-batch1 base chrome css`

## T1 书签类型与路径解析（pure，TDD）

涉及：`src/pure/bookmark.ts`（新建）、`tests/bookmark.test.ts`（新建）、`src/pure/dirs.ts`（如需目录常量）

1. 定义书签模型：
```ts
export interface ReaderBookmark {
    id: string;            // 生成：`bm-${Date.now().toString(36)}`
    chapter: number;       // 1 基章节（与摘抄定位一致）
    pct: number;           // 0-100 章内滚动比例
    quote?: string;        // 选中文本（未选中记位置时为 undefined）
    note?: string;         // 预留批注（批 1 不填）
    createdAt: number;     // epoch ms
}
```
2. `bookmarksFilePath(entryId: string, libraryDir: string): string` → `{libraryDir}/阅读进度/{entryId}.bookmarks.json`（复用 normalizePath；目录常量若 dirs.ts 有「阅读进度」则引用，无则字面量 + 注释对齐 main.ts L1558）
3. `parseBookmarks(text: string | undefined): ReaderBookmark[]`（JSON 数组安全解析：非数组/坏 JSON → []；逐项容错缺字段跳过）
4. `serializeBookmarks(list: ReaderBookmark[]): string`（JSON.stringify 数组）
5. TDD：路径拼接（含尾部斜杠 libraryDir 归一）、空/坏 JSON → []、缺字段过滤、序列化往返

验收：`vitest tests/bookmark.test.ts` 全绿；tsc 0；commit `feat: reader bookmarks pure model + path`

## T2 main 层书签读写 + 阅读器 options 扩展

涉及：`main.ts`（1530-1570 进度读写区附近）、`src/modals/ReaderModal.ts`、`src/modals/TxtReaderModal.ts`、`src/modals/EpubReaderModal.ts`

1. main.ts 新增（对齐 readReaderProgress/saveReadingProgress 的 adapter 读写范式）：
```ts
/** 阅读器书签读取（{libraryDir}/阅读进度/{id}.bookmarks.json）；无/坏 → [] */
async readBookmarks(entryId: string): Promise<ReaderBookmark[]>
/** 书签落盘（原子写同目录）；失败静默不打断阅读 */
async saveBookmarks(entryId: string, list: ReaderBookmark[]): Promise<void>
```
2. options 扩展（TxtReaderOptions / EpubReaderOptions 各加）：
```ts
/** 书签数据（打开阅读器时读取） */
bookmarks?: ReaderBookmark[];
/** 书签变更回调（面板内新增/删除后通知宿主落盘） */
onBookmarksChange?: (list: ReaderBookmark[]) => void;
/** 选中摘抄页内新增入口调用（复用 onExcerpt 的确认弹窗流；本批摘抄动作 = 原「批注」行为） */
```
3. main.openBookReader 打开前读 `readBookmarks(entry.id)` 注入 options；ReaderModal 构造透传；面板通过 onBookmarksChange 写回宿主 → `saveBookmarks`

验收：tsc 0；测试库打开书签 JSON 无文件时不报错；commit `feat: reader bookmarks io + options`

## T3 TXT 面板顶栏重构（三 tab toggle + 字号/设置/关闭，D1b 自动隐藏壳）

涉及：`src/modals/TxtReaderModal.ts`（buildHeader L166-203 / mount / 新增 toggleTocPane 切换三 tab）

1. buildHeader 重排：
   - 左侧三个 icon 按钮：目录(≡)、书签(⚑)、摘抄(❝)（Obsidian setIcon id 需存在：用 `list-tree`?/`bookmark`/`quote`——实现时用 safeSetIcon，title 分别「章节目录/书签/摘抄」）→ 各自 `switchTocPane('toc'|'bm'|'ex')`
   - 中间 titleWrap 保留（书名·TXT）
   - 右侧：字号 A（`adjustFont` 保留快捷）、`≡ 设置`（T5 下拉）、`✕` 关闭
   - **删除**：`行距−/行距+` 按钮（移入设置下拉）、独立 `目录` toggle 按钮（改为三 tab 按钮）、`批注` 开关按钮（删除——摘抄改为选中即动作条触发，不再需要"批注开/关"前置）
2. 新增三 tab 切换方法：把现 `switchTocPane(pane:'toc'|'ex', ...)` 泛化为三 pane `'toc'|'bm'|'ex'`（bmPane 新容器）
3. 顶栏自动隐藏壳（T0 CSS 配套）：容器 mousemove 距顶 <48px → head 去 hidden；mouseleave head 1.5s 后加回 hidden。**本任务仅接入 CSS class 切换**（T5 完善点击正文 toggle）
4. 字段调整：删除 annotateOn/annotateBtn；新增三个 toc tab 按钮引用 / bmPane 容器 / bookmarks 状态数组

验收：打开 TXT 阅读器顶栏三个 tab 按钮可切换三 pane（目录列出章节、书签空态、摘抄列出既有摘抄）；关闭仍工作；commit `feat: TXT reader head 3-tab rework`

## T4 TXT 侧栏三 pane + 书签 pane 渲染

涉及：`src/modals/TxtReaderModal.ts`（buildBody L205-243 / buildExcerptToc / 新增 buildBookmarkPane）

1. buildBody：三 tab + 三 pane 结构（现 exPane 逻辑保留；新增 bmPane = `.rl-reader-toc-pane rl-reader-bm-pane hidden` + `bmListEl`）
2. 书签 pane 渲染 `buildBookmarkList()`（对齐 buildExcerptToc）：
   - 空 → `rl-reader-bm-empty`「暂无书签」
   - 条目：文本（quote 或 `第N章 · P%`）、点击 `jumpBookmark(bm)`（复用 jumpExcerpt 同款跳转：loc→restoreScroll+highlight）、右键删除（回调 onBookmarksChange）
3. 摘抄 tab 文案从「书签」改名「摘抄」（语义迁移；数据仍 options.excerpts 笔记摘抄）
4. `refreshBookmarks(list)` 公共方法（宿主写回后重绘，镜像 refreshExcerpts）
5. 侧栏折叠语义：顶栏三个 tab icon 点击 → `switchTocPane` 且若侧栏处于 collapsed 则先展开（去 collapsed class）；键盘 `T` 折叠/展开（现 toggleToc）保留；切 pane 不改变 collapsed 态

验收：三 pane 各自正确；右键删除书签/摘抄仍可用；commit `feat: TXT reader bookmark pane`

## T5 TXT 选中动作条 + 书签/摘抄动作

涉及：`src/modals/TxtReaderModal.ts`（buildBody mouseup 区 / 新增 selbar）

1. 删除旧「批注开关 + mouseup 直接 onExcerpt」逻辑
2. 新增动作条（T0 `.rl-selbar`）：
```ts
private buildSelbar(): void; // 创建容器（hidden），四个按钮：★书签/❝摘抄/高亮(灰)/翻译(灰)
private showSelbarAt(x: number, y: number, quote: string): void;
private hideSelbar(): void;
```
   - mouseup 捕获选中（同现逻辑取 getSelection().toString().trim()），非空 → 记 quote + 定位 → showSelbarAt(event.clientX/Y 相对容器)
   - ★书签：`addBookmarkFromSelection()`——生成 ReaderBookmark（chapter/pct 来自 currentLoc()、quote=选中文本），push + onBookmarksChange + buildBookmarkList + Notice「已添加书签」
   - ❝摘抄：调 options.onExcerpt(quote, undefined, currentLoc())（同旧批注开启行为）+ hideSelbar + removeAllRanges
   - 高亮/翻译：置灰（title「后续版本提供」），点击 Notice「该功能将在后续版本提供」
3. 点击动作条外 / 滚动 / 切章 → hideSelbar
4. 顶栏自动隐藏完善：head hidden class 切换 + 「点击正文中央 toggle」接入（与 selbar 不冲突：仅点击空白段落时）

验收：选中文字弹出动作条；书签动作落盘并出现于书签 tab、重开仍在；摘抄动作走确认弹窗写笔记；高亮/翻译点击提示占位；commit `feat: TXT reader selection bar + bookmark action`

## T6 TXT 右上下拉（设置菜单）+ 底部进度栏

涉及：`src/modals/TxtReaderModal.ts`、`styles.css`

1. 右上下拉（`≡ 设置` 按钮）：
   - 菜单项（读设置/写回沿用现有 adjustFont/adjustLineHeight + onSettingsChange）：
     - 字号：− / +（含当前值显示）
     - 行距：− / +（含当前值）
     - 滚动模式：显示「连续滚动（当前）」为只读项；「翻页式」置灰 + title「后续版本提供」（规格 D4a：不引入真翻页渲染，仅展示状态避免无效项可点）
     - 主题：**不在本批做切换项**（阅读器内嵌 Obsidian，已自动跟随系统/用户主题；EPUB iframe 主题同步留批 1 后置）。下拉不含主题项
     - 全屏显示：对 modalEl 调 `requestFullscreen()`（失败/非桌面静默忽略；Obsidian 桌面 Electron 支持）
   - 菜单显示/隐藏（点按钮 toggle / 点外部关）
2. 底部 `.rl-reader-footer`：
   - 左：当前章标题
   - 右：`章内 P% · 全书 P%`（updateProgress 同时刷新 footer）
   - 翻页 ‹ ›：TXT 连续滚动下 = 上一屏/下一屏（scrollEl.scrollBy({top: ±clientHeight*0.8})）；章首已到顶部 ‹ 提示「已是本章开头」、章尾到底 › 触发自动翻章逻辑（复用 handleScrollFrame 触底分支）

验收：字号/行距从下拉可调且写回设置；底部章名+百分比实时刷新；‹ › 翻屏/翻章正确；commit `feat: TXT reader settings dropdown + footer`

## T7 EPUB 面板镜像（T3-T6 同构应用到 EpubReaderModal）

涉及：`src/modals/EpubReaderModal.ts`（buildHeader L175-214 / buildBody L216-247 / onFrameLoad 选中区 L272-286）、`styles.css`

差异点：
1. 选中事件在 iframe 内：onFrameLoad 的 mouseup → 用 `frameEl.getBoundingClientRect()` 换算动作条定位（frame 坐标 + frame 容器偏移）；iframe sandbox allow-same-origin 已保证 contentWindow.getSelection 可用
2. 书签 pct 用 EPUB scrollRatio（frame contentDocument.scrollingElement）；currentLoc 已存在（L313+ 附近有 currentLoc）
3. 双页 layoutBtn（现有 ⇆ 双页）**保留**在顶栏（EPUB 特有）；字号/行距/目录/关闭与 TXT 一致
4. 删除批注开关（annotateOn/annotateBtn）同 TXT
5. 底部/下拉/书签 pane 与 TXT 镜像（pane 结构与 DOM 相同，仅章节数据源不同）

验收：EPUB 打开三 tab/动作条/书签/下拉/底部全可用；双击（原文双页）不回归；commit `feat: EPUB reader batch1 mirror`

## T8 接线与构建部署 gate

涉及：`main.ts`（openBookReader 注入 bookmarks + onBookmarksChange 写回）、`src/modals/ReaderModal.ts`（options 透传）、`src/views/components/EntryForm.svelte`（无需改动，仅确认无 reader prop 引用破坏）

1. openBookReader 双分支（internalBookReader true）读取进度 + `readBookmarks` → options；modal 关闭后 resolve 阅读进度（现有逻辑保留）
2. onBookmarksChange 回调 → `saveBookmarks(entry.id, list)`
3. 回归：现有 719 单测全绿（无 pure 改动除 T1 新增）；tsc 0；esbuild production 通过
4. 产物断言：`rl-reader-footer`/`rl-selbar`/`bookmarksFilePath` 等符号在；书签 JSON 文件名拼接存在
5. 部署三件套（根/build/测试库）cmp IDENTICAL；CHANGELOG 未发布节 + current-progress 更新；提交
6. 手工验证清单：TXT 书打开→顶栏三 tab、选中动作条书签落盘重开仍在、摘抄写笔记、下拉调字号/行距、底部进度翻屏、高亮/翻译灰态；EPUB 同验 + 双页保留

验收：全量 vitest 719 及以上全绿（T1 新增用例）；tsc 0；三件套 cmp IDENTICAL；部署测试库；文档同步；commit `feat: reader batch1 done`
