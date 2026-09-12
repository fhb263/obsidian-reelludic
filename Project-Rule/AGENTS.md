# AGENTS.md — ReelLudic 工作手册

> 本文档面向 AI Agent 和人类开发者。每次新会话开始时，**必须先读本文档**。
> 版本：v1.0.2（2026-09-10 发布）| 最后更新：2026-09-11（EntryType 六态 / 11 源 / 依赖图补全）

---

## 新会话启动清单

| 顺序 | 文件 | 目的 |
|------|------|------|
| 1 | `Project-Rule/AGENTS.md`（本文件） | 了解规则和红线 |
| 2 | `Project-Rule/UI-GUIDE.md` | 界面设计规范（Obsidian 原生语言 + CSS 变量 + 组件约定 + 多方案对比/排雷） |
| 3 | `Project-Rule/current-progress.md` | 了解当前进度、门禁状态和待办 |
| 4 | `Project-Rule/DESIGN.md` | 数据 schema、视图 ID、抓取流程（实现依据） |
| 5 | `Project-Rule/PRODUCT.md` | 第一版做什么/不做什么（需求边界） |
| 6 | `src/main.ts` | 插件入口 + 命令/视图注册 |
| 7 | `src/data/types.ts` | 核心类型 + entryType 枚举 |
| 8 | `docs/full-cycle/ReelLudic/` | 阶段产出物（需求澄清/可行性结论） |

---

## 项目命令速查

| 命令 | 用途 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发模式（esbuild watch） |
| `npm run build` | 生产构建（tsc + esbuild） |
| `npm test` | 跑单测（vitest run） |
| `npm run version` | 版本号同步（version-bump.mjs） |
| 双击 `build.bat` | 构建 + 拷贝产物到 `build/` |
| `powershell -NoProfile -ExecutionPolicy Bypass -File "build/sync_plugin.ps1"` | 同步到测试库 `临时测试库\.obsidian\plugins\obsidian-reelludic` |

### 部署流程（⚠️ Agent 必做）

> 每次改动 `src/`、`styles.css`、`manifest.json` 后，**必须依次执行「构建 → 刷新 build/ → 同步测试库」**，否则 Obsidian 测试库加载的是旧产物。构建产物只在项目根目录，不会自动更新 `build/`。

1. 双击 `build.bat`（或 `npm run build` + 拷贝 main.js/styles.css/manifest.json 到 build/）
2. `powershell -NoProfile -ExecutionPolicy Bypass -File "build/sync_plugin.ps1"`
3. Obsidian 中 Ctrl+P → `Reload app without restarting`

---

## 🔴 红线 — 不能破坏的功能

### 1. 视图类型 ID（`src/main.ts`）

- `MEDIA_VIEW_TYPE = 'reelludic-media'`、`TRACKING_VIEW_TYPE = 'reelludic-tracking'`
- **不要修改**，否则工作区布局（workspace.json）中已保存的视图位置全部失效

### 2. catalog.json schema（`src/data/types.ts` + `catalog.ts`）

- **字段只能追加，不能删除、不能改类型**
- 新增字段必须有默认值；读取时对旧数据缺字段做兜底
- 已存在的旧版本数据必须无损升级（版本号 + 迁移函数）

### 3. 核心枚举（`src/pure/status.ts`、`src/data/types.ts`）

- `MediaStatus` 四态 `want / watching / watched / archived` **不能改名**（存入 JSON/MD，改名即数据损坏；v0.5 已移除 `dropped` 增 `archived`，存量 `dropped` 数据在 normalizeEntry 自动迁移为 `archived`，勿再引用 dropped）
- `EntryType` 枚举值 `movie / tv / anime / book / game / music` 六态平铺，**不要移除**
- 评分范围 1~5（0=未评分），边界校验不能放宽

### 4. 条目笔记 frontmatter（`noteGenerator.ts`）

- 字段名（id/type/title/status/rating/year/genres/progress_season/progress_episode）**不能改**
- 生成模板的章节结构（基本信息/个人评语/观看链接）为公共约定，重命名会破坏既有笔记的可读性

### 5. 构建链

- `npm run build` = `tsc -noEmit -skipLibCheck && esbuild`，**不要跳过 tsc**
- esbuild `external` 列表（obsidian/electron/@codemirror*/@lezer*/builtin-modules）不能乱删

### 6. vitest alias 表（`vitest.config.ts`）

- 因 tsconfig `baseUrl: ./src` 裸导入，**每次在 src/ 顶层新增模块，必须同步在 vitest alias 表注册**，否则单测解析失败

### 7. 版本三文件同步

- `package.json` / `manifest.json` / `versions.json` 的 version 必须一致，`npm run version` 统一回写

### 8. 部署三步

- 见上文部署流程；**严禁只构建不同步**就宣称完成验证

### 9. Svelte 4 事件语法（必须用 `on:` 指令）

- Svelte 组件中的事件**必须写 `on:click={fn}` / `on:keydown={fn}`** 指令语法
- **禁止裸 `onclick={fn}`**（Svelte 5 语法）：Svelte 4 会把它当普通属性编译为 `attr(el,"onclick",fn)`，函数被 `setAttribute` 转成字符串，浏览器当内联脚本执行（函数声明不调用）→ **点击静默无反应、无任何报错**（已踩坑：2026-08-25 全部按钮失效，提交 2d95ead 修复）
- 写完 Svelte 组件后检查编译产物：应出现 `listen(el,"click",...)`，不应出现 `attr(el,"onclick",...)`

### 10. LICENSE 文件只读（2026-09-11 用户明令）

- `LICENSE` 是用户定制的 **短版 GPL-3.0 声明**（19 行；文件头 `ReelLudic — Copyright (C) 2026 fhb263`，尾部含 `SPDX-License-Identifier: GPL-3.0-only` 与官方全文链接，见提交 d3bff29），**任何操作不得改写、替换、重新生成、格式化**
- 镜像同步、文档批次、开源化/模板化等一切流程对 LICENSE **只允许 `cmp` 只读核对，禁止 `cp` / 写入 / 换行符归一 / 编码转换**
- 核对发现不一致时**不得自动修复**：停下报告差异内容，等用户亲自决定哪边为准
- **2026-09-12 用户裁定**：以 **GNU 官方 GPL-3.0 全文**为准（`https://www.gnu.org/licenses/gpl-3.0.txt`，35149 字节 / 674 行），**源与镜像统一为全文**。本工作区源 `LICENSE` 已于当日由短版替换为全文（经用户明确授权，属红线 10 记录在案的唯一例外）；**此后本红线恢复常规效力：LICENSE 只读，不得再改写/替换/重新生成/格式化**。版权归属仍以 `ReelLudic — Copyright (C) 2026 fhb263` 为准（全文末尾惯例附注，或由仓库 README / `package.json` 承载）。

---

## 🟡 谨慎修改的文件

| 文件 | 风险 | 注意事项 |
|------|------|----------|
| `src/main.ts` | 🔴 高 | 入口 + 命令/视图注册 + 事件中枢；视图 ID、命令 ID 不能改 |
| `src/data/types.ts` | 🔴 高 | 类型定义即 schema 契约，只增不改 |
| `src/data/catalog.ts` | 🔴 高 | catalog.json 读写；迁移逻辑只增分支 |
| `src/services/EntryService.ts` | 🟡 中 | 编排层，状态流转/追更标记的副作用集中地，改动需回归测试 |
| `vitest.config.ts` | 🟡 中 | alias 表与 src 顶层模块强耦合 |
| `esbuild.config.mjs` | 🟡 中 | 构建链，改动需全量构建验证 |
| `styles.css` | 🟡 中 | 用户可能用 CSS Snippets 覆写，核心类名不重命名 |

---

## 🟢 安全修改的文件

| 文件 | 说明 |
|------|------|
| `src/Settings.ts` | 设置面板，新增设置项安全（字段追加） |
| `src/data/noteGenerator.ts` | 笔记模板生成（有单测） |
| `src/pure/status.ts` / `rating.ts` | 纯逻辑（有单测） |
| `src/services/tmdb.ts` | 网络层，可独立修改（mock 单测） |
| `src/services/douban.ts` | **全类型主力源**（书籍/游戏单源，影视/动画与 TMDB/Bangumi 并存）：已适配反爬（Node 传输层 + PoW + 拦截页防护 + 封面本地化 + 详情小节解析），可独立修改（mock 单测） |
| `src/services/nodeHttp.ts` | Node 原生 http/https 传输层（桌面端专用，惰性 require 防移动端崩），可独立修改 |
| `src/services/resultTypes.ts` | 书籍/游戏搜索结果类型（Douban 单源后独立于此文件，勿再依赖已删的 googleBooks/rawg） |
| `src/pure/noteEditable.ts` | 笔记可编辑字段解析（正文章节 + frontmatter + 来源行），改动需同步 EntryModal 回填逻辑与测试 |
| `src/views/`、`src/modals/` | 视图 UI，逻辑下沉纯模块后可安全改样式 |
| `tests/` | vitest 单测 |
| `Project-Rule/`、`docs/` | 纯文档 |
| `build.bat` / `build/sync_plugin.ps1` | 构建/同步脚本 |

---

## 开发规范

### 代码风格

- **TypeScript**：`strict` 模式，避免 `any`；camelCase（变量/函数）、PascalCase（类/类型）
- **缩进**：4 空格
- **注释**：只在复杂逻辑处添加
- **Svelte**：`<script lang="ts">`，组件导出函数用 `export function`
- **可测性**：纯逻辑（枚举校验/笔记生成/JSON 读写）抽到无 obsidian 依赖的模块并配 vitest 单测

### Git 提交

- `feat:` / `fix:` / `refactor:` / `docs:` / `style:` / `chore:` 前缀

### 已知坑点（实现期持续补充）

| 坑点 | 说明 | 解决方案 |
|------|------|----------|
| **Svelte 4 模板不支持 `as` 类型断言** | 模板表达式里写 `{s as MediaStatus}` 报 `Unexpected token`（esbuild-svelte 解析错误） | 预类型化常量（`const STATUS_OPTIONS: MediaStatus[] = [...]`）后在模板 each；断言只放在 `<script>` 内。**同族限制：模板内 `!` 非空断言（`{arr[i]!}`）、`bind:value` 数组下标（`bind:value={arr[i]}`）同样编译报 Unexpected token**——改用事件驱动 + helper（`inputVal(ev)` 取值、`arr.map` 重建数组触发响应式）、函数签名收 `string | undefined`。已踩坑：2026-08-25 EntryForm 状态 chips / 2026-08-30 观看链接双路径 |
| **双悬停提示（title / aria-label / Obsidian tooltip）→ v3 已定规则** | 旧坑：按钮同时写 `title`（原生黄条）与 `aria-label`（Obsidian 对带 aria-label 元素自绘 tooltip）→ 悬停两个提示文本。v3 修订（2026-09-09）：**Obsidian 会因 `aria-label`（含祖先就近匹配）自动弹官方气泡** → 它与 `data-tip` 自绘气泡**同元素/祖先链并存必叠双层**（官方后出覆盖自绘）。已踩坑：2026-08-30 海报墙等 8 处（v2 title→data-tip）；2026-09-09 EntryForm 4 浮层 aria-label 容器内 11 子按钮 + 观看/检索 2 按钮（13 处双气泡） | **v3 规则（见 UI-GUIDE §3）**：悬停视觉提示一律 `data-tip`，禁 `title` 黄条；**`aria-label` 不放在带 `data-tip` 的元素或祖先链上**。读屏命名分流：有可见文字直接删 aria；纯图标按钮用可见/隐藏文本或 `aria-labelledby` 指向文本元素（不触发官方气泡）；`role="dialog"` 等容器命名一律 `aria-labelledby` 指向可见标题。新写 hover 提示照此执行 |
| **Bangumi infobox value 双形态** | `/v0/search/subjects` 的 infobox 项 value 可能是字符串或 `{v:...}` 结构；`s.infobox` 类型是 unknown | infoboxValue 用 `Array.isArray` 收窄 + 同时处理两种 value 形态。已踩坑：2026-08-25 |
| **设置页 DOM 样式须写 styles.css** | Settings.ts 用 DOM API 创建的元素（折叠行等）不经 Svelte 编译，样式不会注入 main.js | 自定义类样式（rl-src-*）写入 styles.css 并随部署同步。已踩坑：2026-08-25 |
| **Svelte 4 裸 `onclick` 全部无反应（静默失败）** | Svelte 4 把 `onclick={fn}` 当普通属性编译为 `attr(el,"onclick",fn)` → setAttribute 把函数转字符串 → 浏览器当内联脚本执行（函数声明但不调用），点击无反应且**无任何报错** | **必须用 `on:click={fn}`**（Svelte 4 事件指令 → addEventListener）；`onkeydown` → `on:keydown`。Svelte 5 才支持裸 `onclick`。已踩坑：2026-08-25 v0.0.1 全部按钮失效（提交 2d95ead 修复） |
| **Obsidian `vault.create` 不自动建父目录（ENOENT）** | 首次写 `ReelLudic/catalog.json` 时目录不存在 → `ENOENT: no such file or directory`；`vault.create` 不会递归建目录 | 写入前逐层 `getAbstractFileByPath` + `createFolder`（见 `src/services/vaultIO.ts` 的 `ensureParentFolder`）。已踩坑：2026-08-25 保存报 ENOENT（提交 8bf0345，vaultIO.test.ts 锁定） |
| **修复后未重建部署 = 测试库跑旧版** | 代码/提交已修复，但 build/ 与测试库 main.js 是修复前构建 → 用户实测仍是 Bug 表现，误判"没修好" | 每次改代码后必须重建 + 部署，并**比对测试库 main.js 时间戳与提交时间**、检查编译产物特征（如 listen vs attr）。已踩坑：2026-08-25 onclick 修复后仍不能点击 |
| **产物中文验证（部署后 grep 新文案）** | esbuild 默认把中文转义成 **`\uXXXX` 大写十六进制**（媒=\u5A92，小写 u5a92 匹配不到）；转义串还可能被 esbuild 换行拆开，**grep 连续整串转义必为 0 误判"没进产物"**；build.bat 含 `pause` 会卡交互脚本 | 验证用单字转义上下文 `grep -o '.\{N\}u5BFC.\{N\}'` 或直接抓 `setName("中文")` 形态；部署链可靠做法 = `npm run build` + `cp -f main.js styles.css manifest.json build/` + `cmp` 比对测试库。已踩坑：2026-08-27 设置页重构部署验证 |
| **Svelte 4 反应式不穿透普通函数调用** | 模板里 `class:on={sortActive(s)}` / `{sortArrow(s)}` 这种把反应式读取（`sortBy`）封装在普通 `function` 内再调用的写法，**Svelte 4 编译器只追踪模板表达式中直接读到的反应式变量**，不会穿透函数体分析内部依赖——编译产物的 each block `p(new_ctx, dirty)` 退化为 `{ ctx = new_ctx; }` 空函数（不调用 toggle_class / set_data / attr），sortBy 变化后 UI 不刷新。**表面现象**：click 触感（:active scale）正常、但 `.on` 高亮/箭头/aria 永远停在初始值 | **模板表达式必须直接读反应式变量**——把判断内联：`class:on={sortBy === s.asc \|\| sortBy === s.desc}`、`{sortBy === s.asc ? '▲' : sortBy === s.desc ? '▼' : ''}`。**诊断**：查 `main.js` 中对应 `create_each_block_N` 的 `p()` 函数体，若只有 `ctx = new_ctx;` 即中招。已踩坑：2026-08-27 排序 chip 点了无视觉切换（提交 f4801d0 修复） |
| **obsidian 类型缺 `sleep` / `requestUrl.responseType`** | 项目用的 obsidian 类型版本没有 `sleep` 导出、`RequestUrlParam` 无 `responseType` 字段（tsc 报 TS2305/TS2345） | 自写 `new Promise(r => setTimeout(r, ms))`；下载二进制用全局 `fetch` + `res.arrayBuffer()`（requestUrl 仅文本 GET/POST）。已踩坑：2026-08-27 封面本地化（提交 3adfed7） |
| **删除模块前必须 grep 全仓引用** | 删除 `services/igdb.ts` 时，`GameSearchResult` 类型还被 searchDisplay/douban/EntryForm/测试引用，tsc 报 TS2307 | 删除前 grep 引用并把类型迁到新模块（rawg.ts）、测试 import 一并改；git 提交删除用 `git add -A`（`git add <已删文件>` 报 pathspec 失败）。已踩坑：2026-08-27（提交 ada6572） |
| **豆瓣图床（img*.doubanio.com）防盗链** | 豆瓣封面要求 Referer 为 douban.com；Obsidian 内 `<img>` 的 Referer 永远是 `app://obsidian.md`，`referrerpolicy="unsafe-url"` 也无效 → 封面 403/418 空白 | 封面一律**下载到本地**（`封面/{标题}.jpg`）；下载走 nodeHttp 传输层 + 显式 `Referer: https://www.douban.com/`（`main.ts fetchImageBuffer`）。已踩坑：2026-08-27 豆瓣封面空白 |
| **Node 传输层必须惰性 require** | `require('https')/require('http')/require('crypto')` 在移动端（Capacitor 无 Node）会抛错崩溃 | 只在函数体内 require（非顶层 import），且调用方按 `Platform.isDesktopApp` 分流；移动端回退 `requestUrl`/`crypto.subtle`。见 `nodeHttp.ts` / `douban.ts sha512Hex`。已踩坑：2026-08-27 豆瓣反爬适配 |
| **详情页全页第一个 `<img>` 不可作封面** | 豆瓣游戏详情页全页第一个 img 是站内导航 `new_menu.gif`（74B 占位），当作封面下载会得到空图 | 封面提取限定真实容器（`.item-subject-info`）；fetchDetail 合并时站内 `/pics/` 占位不覆盖搜索级封面。已踩坑：2026-08-28 我的世界/部落冲突封面 74B GIF |
| **MediaEntry 增字段必须同步 normalizeEntry** | `normalizeEntry` 是落库唯一关口，漏加字段 → 表单数据保存时被静默丢弃（summary 曾缺失，简介保存即消失、笔记无「内容简介」） | MediaEntry 接口 + `data/catalog.ts normalizeEntry` + `catalog.test.ts` 回归三件套同步；schema 只增不改红线内追加。已踩坑：2026-08-28 图书简介落库丢失 |
| **详情 JSON-LD/og 缺字段覆盖搜索级值** | `parseDoubanJsonLd` 恒返回 `rating: undefined` 等键，`{...merged, ...detail}` spread 把搜索级评分/评价人数覆盖成 undefined | 详情合并用 `definedFields()` 只覆盖「有值」字段。已踩坑：2026-08-28 图书评价人数拉不到 |
| TMDB 无 Key | 搜索直接报错 | 设置页引导配置；无 Key 时影视仅显示 Douban 结果（Douban 始终可用） |
| 豆瓣反爬 | 无 Cookie 时 j/search 返回 403 JSON（`{"r":1,"code":403}`） | 已适配：Node 传输层 + 完整浏览器头 + dbcl2 登录态 Cookie + PoW 自动求解 + 拦截页三态检测；书籍/游戏搜索已完全依赖 Douban，不配置 Cookie 则无结果并提示 |
| 中文路径编码 | PowerShell 同步中文路径 | 沿用 lyricflux 的 Unicode 方案（sync_plugin.ps1 已处理） |
| 封面大图内存 | 海报墙一次性渲染大量大图卡顿 | 封面缩放存储；MVP 百级条目可接受，预留懒加载 |
| **flex column + min-height 100% 容器内 sticky 布局错位** | 在 `.rl-home`（display:flex; flex-direction:column; min-height:100%）内给页签/筛选栏设 `position:sticky; top:0/34/72px`，内容滚动时**首行卡片被推到页签栏上方**（sticky 元素 layout 占位与 flex 布局在内容溢出时计算错位） | **避免在 flex column + min-height 容器内使用 sticky**；如需顶栏固定改用：①固定区放 `.rl-home` 之外的独立 sticky 容器；②JS 滚动监听手动 `position:fixed`。已踩坑：2026-08-29 回退 sticky 改动（commit 5642c65），改为右下角「回到顶部」按钮（commit dbe349c） |
| **textarea auto-grow：scrollHeight 不小于渲染高度** | 简介框 auto-grow 用 `height:'auto'` 复位再取 scrollHeight——textarea 的 scrollHeight **不会小于当前渲染高度**，`height:auto` 后仍停 `rows=6` 基线，文字少时框缩不回去 | **先 `el.style.height='0px'` 再取 `el.scrollHeight`**（强制按内容重算）+ CSS `min-height` 控制少文字基线。已踩坑：2026-08-29 修复（commit c8ba585） |
| **Obsidian 视图滚动容器是 `.view-content`（非 window）** | 视图内容滚动发生在 view-content，`svelte:window`/window 的 scroll 事件**不触发**；滚动容器可能是 contentEl 或其祖先 | 从组件根元素向上找第一个 `scrollHeight > clientHeight + 1` 的祖先绑 `scroll` 监听（passive）。已踩坑：2026-08-29 回到顶部按钮实现 |
| **`.svelte` 文件不经 tsc 检查 → Svelte 内 TS 类型错误静默放行** | tsconfig `include: ["**/*.ts"]` **不含 .svelte**，esbuild-svelte 只转译不查类型——`.svelte` 里对 number 调 `.replace` 等类型错误 tsc 全绿、运行时才炸（被 try/catch 吞掉后表现为「功能静默不生效」） | Svelte 内对跨类型值操作保持防御：`String(x)` 包一层再 `.replace`；改完 Svelte 后**必须 grep 编译产物**（main.js）验证目标代码形态。已踩坑：2026-08-31 游戏条目豆瓣回填全空（`GameSearchResult.id` 是 number 却调 `r.id.replace('douban:','')` → TypeError 静默吞 → 详情拉取从未发生） |
| **`GameSearchResult.id` 是 number（douban:xxx 是书/音乐专属）** | `toGameResult` 产 `id: Number(s.id) || 0`（number），书/音乐产 `douban:xxx` 字符串——**游戏 id 不能走 `.replace('douban:','')` 剥前缀**（number 无 replace，静默 TypeError） | 游戏分支统一 `String(r.id)`；`main.ts fetchDoubanDetailForEntry` 字段白名单必须经 `toEntryDetailFields` 投影（漏列 platform/developer 曾导致游戏回填全空）。已踩坑：2026-08-31 部落冲突豆瓣回填全空 |
| **esbuild 增量缓存：只改 .svelte/.css 不动 main.ts 会漏重编译** | `npm run build` 的 esbuild 用 `context.rebuild()` 增量缓存，**只改 .svelte/.css、不动 main.ts 时可能不重编译**——main.js 里仍残留旧样式值（如 60×90 没变成 48×72），grep 产物发现还是旧值 | 改完 .svelte/.css 后 **`rm -f main.js build/main.js` 再重跑 `node esbuild.config.mjs production`** 强制重编译；注意 esbuild outfile 是**根目录 main.js**（非 build/），三件套需 `cp -f main.js styles.css manifest.json build/` 再同步测试库。已踩坑：2026-09-01 封面缩略图 48×72 首次构建漏编译 |
| **产物 CSS 断言：scoped 选择器带 hash、minify 折叠空白但保留函数内空格** | Svelte scoped 样式在 main.js 里是 `.rl-xxx.svelte-<hash>.svelte-<hash>{…}`（搜 `.rl-xxx:hover` 必假阴性）；esbuild css minify 折叠非关键空白但**保留 `minmax(0, 1fr)` 等函数内空格**（搜无空格形态也假阴性） | 断言前先 dump 产物实际片段确认形态；CSS 规则断言用宽松子串/正则（分隔关键词各自 includes），别按源码书写形态猜。已踩坑：2026-09-05 追番表 hover（#220）与排期表等高（#223）断言各一次 |
| **按钮 hover 语言（全项目约定）** | 操作按钮此前颜色/缩放/反馈各写各的（常驻主题色、无 hover 反馈、两档 scale） | 成对操作按钮统一：**默认灰 → hover accent（文字或底）+ `transform: scale(1.12)` + transition**；primary CTA（常驻主题色）与封面 overlay 快操例外。已落地：2026-09-05 #218-221 列表/追番表/音乐行/海报墙 |

---

## 依赖关系图

```
main.ts（入口 + 命令注册 + 视图注册 + 事件中枢 + homeTab 页签状态）
  ├── Settings.ts（服务集成：11 源注册表凭据 + 每类型源链 + 翻译双 Key + 库目录 + 播放/阅读开关 + 外观）
  ├── views/HomeView.ts（统一视图 reelludic-home，页签容器）
  │     └── components/HomeView.svelte（页签栏：计划表/书籍/影视/游戏/音乐/统计 + 回到顶部按钮）
  │           ├── components/MediaList.svelte（书架：海报墙/列表/瀑布流 + 筛选排序 + 观看按钮/右键菜单）
  │           ├── components/TrackingBoard.svelte（追更表：更新检测串行限流 + 结果落库）
  │           ├── components/CalendarBoard.svelte（排期表：月历/周历 + 拖拽 + 到期横幅 + 日期点击弹详情）
  │           └── components/StatsBoard.svelte（统计 1.0：KPI 行 + 月度趋势×今年动态 + 四库分区 + 快捷行 + 往年报告）
  ├── modals/EntryModal.ts（添加/编辑弹窗：双套 UI + 笔记回填 + 孤儿封面清理 + 双写冲突）
  │     └── components/EntryForm.svelte（Douban 版 / TMDB·Bangumi 版，formMode 按 source 切换；音乐含本地音频单行）
  ├── modals/*（ConfirmModal 通用确认 / LinkPickerModal 多链接选源 / EpisodePickerModal 集数选择 /
  │     NoteConflictModal 双写冲突 / ExcerptModal 摘抄 / GameSessionModal 游玩记录 / CalendarDayModal 排期日 / 
  │     PosterMigrateModal 封面迁移 / PosterCleanupModal 孤儿清理 / VaultFileSuggest 文件建议）
  ├── services/EntryService.ts（增删改查编排 + 状态流转 + 笔记生成/双写冲突检测）
  │     ├── services/vaultIO.ts（VaultIO 适配：writeText 前 ensureParentFolder）
  │     ├── services/tmdb.ts（TMDB 搜索/详情：电影/电视剧，vote_count→ratingCount）
  │     ├── services/bangumi.ts（Bangumi 搜索/详情补全：subjects + persons）
  │     ├── services/resultTypes.ts（BookSearchResult/GameSearchResult 类型定义）
  │     ├── services/douban.ts（全类型主力源：反爬适配 + Cookie 失效提示 + 详情小节）
  │     ├── services/nodeHttp.ts（Node 原生传输层，桌面端专用，惰性 require）
  │     └── services/aiSummary.ts（AI 总结摘要：复用阅读器翻译凭据，依赖全注入）
  │   另有按需注册的补充源：openLibrary / googleBooks / steam / musicbrainz / itunes /
  │     omdb / anilist / igdb（11 源注册表见 src/pure/sourceRegistry.ts，各组默认链见 DEFAULT_CHAINS）
  ├── data/catalog.ts（catalog.json 读写；normalizeEntry 为落库唯一关口）
  ├── data/noteGenerator.ts（.md 笔记生成，按类型渲染，含图书小节 + 指纹）
  ├── pure/*（47 个无 obsidian 依赖纯模块：status/labels/rating/dirs/cardMeta/stats/report/
  │     搜索链 search*+resultMerge+searchCache/进度 bookProgress+readingProgress+pdfProgress+
  │     epubParse+txtParse+bookmark+highlight/翻译 translate+aiSummary/源注册 sourceRegistry/
  │     追更 tracking+updateCheck+episodeScan/界面辅助 menuPlacement+mediaFileUrl+virtualWindow+
  │     bulkConfirm+dailyLog+activityFeed 等，逐一有对应 tests/）
  └── data/types.ts（MediaEntry / EntryType：movie|tv|anime|book|game|music）
```

### 数据流

```
EntryModal 提交 → EntryService.create()
  → data/catalog.ts 写 catalog.json（vaultIO 自动建目录，normalizeEntry 兜底）
  → noteGenerator.ts 生成 .md 详情笔记
  → 刷新 HomeView（保持当前页签）
```

### 抓取数据流

```
EntryModal 输入标题 → 按类型分流（并行 + 进度上报）
  书/游戏   → Douban 单源（游戏另有 Steam 补充源，默认关）
  音乐      → Douban + MusicBrainz + iTunes 满链
  影视      → TMDB + Douban 并行 → mergeBySource/sortByRelevance 按相似度排序
  动画      → Bangumi + Douban 并行
  → 候选列表（豆瓣前 3 条已预补详情）→ 用户选择（豆瓣封面下载到本地）
  → 按命中源切换表单 UI（douban/tmdb/bangumi）→ 保存
```
