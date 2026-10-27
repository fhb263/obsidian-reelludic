# AGENTS.md — ReelLudic 工作手册

> 本文档面向 AI Agent 和人类开发者。每次新会话开始时，**必须先读本文档**。
> 版本：**v1.4.0 期**（最近发布版 v1.3.0 / 2026-10-11，见 `CHANGELOG.md` 的 `## [1.3.0]` 节；**当前开发版 1.4.0 / 2026-10-16**；更早：原 1.2.1 期**从未发布** ⇒ 整体改定 1.3.0、1.1.1 期内容并入 1.2.0、1.0.4 期并入 1.1.0）| **最后更新：2026-10-16**
> 1.1.0 期累计（截至 2026-09-23）：阅读器三件（顶栏章标题 / 六档阅读主题 / 标注）+ 海报墙密度 + 视图级题材筛选 + 封面评分角标 + 统计页三层重构 + 设置页顶栏 Tab + 阅读器顶栏标题居中 + 设置页「媒体库目录」搜索式选择 + 若干修复。
> 1.1.1 期累计（截至 2026-09-27）：主视图显示名取叶子段 + 新增条目手动填写「大众评分 / 平台链接」（仅新增态）+「笔记表格」关闭时顶部块去 callout 残留（#384）。**④ 并入 LyricFlux 音频播放器已按 `docs/superpowers/plans/2026-09-27-1.1.1-design.md` §5.5 推进到 ④-4**：④-1 `pure/lrc.ts`（LRC 解析 / 时间轴 / 二分定位）、④-2 `pure/lrcSource.ts`（` ```lrc ` 块契约 / 四路歌词源优先级 / 引用形态）、④-3 `pure/audioQueue.ts`（播放模式 / 队列推进 / 乱序 / 互斥真源）、**④-4 视图层落装 `AudioPlayerView` + 三档自适应（判容器宽度，非媒体查询）+ 笔记 ` ```lrc ` 块内联播放器（#389）** —— 三个纯模块至此**首次接线**、符号进产物；**#390 修 P0**（`lrc` 语言重复注册 ⇒ 整个插件加载失败：Obsidian 全局静态语言表 + throw 点在 `onload`）；**#391 接上第 4 路歌词源**（音频内嵌标签 `pure/embeddedLyrics.ts`，用户库 118 首里 52 首有内嵌 LRC）；**#392 补「倍速」+「音量浮层」**（照视频播放器既有口径，⛔ 不搬 LyricFlux 的 `playbackUtils`）；**#393 细节定稿**：标签页标题改「关联笔记名」（切歌跟着变）、两浮层改**横向滑条**、音量标度 **0–200% 每 10% 一档**（>100% 走 `GainNode`）；**#394 修正**：倍速按钮定稿为**纯文字**（= 当前倍速）、拖动时已填充段随手柄同步（单一同步口）、音量滑条**颜色随当前值渐变**（0% 无填充 → 0–100% 淡→实 → >100% 偏橙；**倍速滑条不换色**）、浮层随容器尺寸重定位。**仍待推进**：④-5 收口（右侧边栏入口属 UI 增改 ⇒ 待用户过目象形稿；双层 CHANGELOG / 进度表 / UI-GUIDE 已随 ④-4 一并收口）、⑤ 书籍与音乐下载 —— 其中 **⑤-c-1（音乐 · 网易云免费通道）的公共基建 + 纯逻辑 + 服务层已落（#397）**：`pure/downloadPlan`（目标路径决策 / 文件名净化 / 重名去重 / 扩展名白名单 / 大小上限）、`pure/songDownload`（免密外链 `song/media/outer/url` + `isNeteaseDownloadable(fee)` + 魔数嗅探 + 64 KB 门槛）、`services/downloader`（注入式下载落盘）、`services/musicDownload`（搜索复用 #396 端点 + 免费通道下载），**+69 例 / 单元级突变 24/24 `[RED ok]`**；**UI 入口（设置项 / 条目表单下载入口 / 下载弹窗）归 ⑤-c-2**，按 UI 约定须先出象形待裁定。另：**#395 音量滑条配色改判**（按「值」渐变，推翻 #394 的「固定位置摆异色」；倍速滑条不换色）、**#396 音乐条目 LRC 歌词框 + 在线获取歌词**（三源免配置；歌词正文落笔记 ` ```lrc ` 块并纳入重写保留区 ⇒ 保存条目不再静默吞歌词）。**#397 ⑤-c-1**（公共基建 + 网易云免费通道纯逻辑与服务层，+69 例 / 单元级突变 24/24）与 **#398 ⑤-c-2 接线**（下载歌曲弹窗【三段视图：推荐歌单 / 搜索 / 歌单曲目】+ 设置页 **「音乐集成」** 分组【位置固定在「数据源凭据」之下】+ 表单「下载」入口 + **LRC 框上移到「总结摘要」之上**；产物断言 1861 / 产物级突变 15/15）均已落地。🔴 **⑤ 的能力边界（D-13(a)）**：只做网易云**免费通道**（`fee=0` 或缺失）—— 实测热歌榜 200 首只有 **1 首**可下 ⇒ 弹窗**逐首标可下载性**、⛔ 不做「下载全部」、⛔ **不静默过滤**（过滤会让用户以为「搜不到」）；其余平台胶囊**保留但禁用**。⛔ **不碰 `neteaseCrypto`**（源自 AGPL 的 `go-music-dl`）—— 歌单走**公开 `/api/` 端点**即可，无需加密。**⑤-a 网文（Legado 子集）/ ⑤-b Z-Library（用户给定 URL → 落盘）仍未开工。** **#399 音乐面三点收口（2026-09-27）**（用户：「音乐编辑条目界面在本地音频旁加个同款小按钮用于下载歌曲并自动关联，把设置页-音乐集成分组和其下项都删除掉，笔记内 lrc 代码块显示播放器占位的地方改成『启用内置音乐播放器』【其上的也统一文案改成启用内置阅读器/视频播放器】，开启后始终有 LRC 显示播放器、下载歌曲功能，关闭后不显示下载按钮」）：设置页**「音乐集成」分组整体删除**（含 `启用歌曲下载`/`下载目录` ⇒ `数据源配置` 页恰 2 组；下载目录回落 `pure/downloadPlan.DOWNLOAD_ROOT_DEFAULT`；字段按红线保留，`musicDownloadEnabled` **不再被任何地方读取**）｜实验性功能三条**统一命名** `启用内置阅读器` / `启用内置视频播放器` / `启用内置音乐播放器`｜🔴 **`audioInlinePlayer` 成为音乐面唯一开关**：开 ⇒ 笔记内 lrc 块出 LRC 播放器 **且** 音乐编辑表单给「下载」按钮，关 ⇒ 两者都没有｜「下载」按钮与「▶ 播放」**同款**（`.rl-ep-btn-book, .rl-ep-btn-dl` 共用 auto 宽规则；原先裸 `.rl-ep-btn` 是集号方块 36px 固定宽，图标+文字会挤出去）。产物断言 1869 / 产物级突变 15/15。****用户裁定：下载面全是实验功能，版本号锁定 1.1.1，不因新面推进而升版。** 逐条见 `current-progress.md` 进度表与双层 CHANGELOG。

---

## 新会话启动清单

| 顺序 | 文件 | 目的 |
|------|------|------|
| 1 | `Project-Rule/AGENTS.md`（本文件） | 了解规则和红线 |
| 2 | `Project-Rule/UI-GUIDE.md` | 界面设计规范（Obsidian 原生语言 + CSS 变量 + 组件约定 + 多方案对比/排雷） |
| 3 | `Project-Rule/current-progress.md` | 了解当前进度、门禁状态和待办 |
| 4 | `Project-Rule/DESIGN.md` | 数据 schema、视图 ID、抓取流程（实现依据） |
| 5 | `Project-Rule/PRODUCT.md` | 第一版做什么/不做什么（需求边界） |
| 6 | `main.ts`（**在仓库根目录，不在 `src/`**） | 插件入口 + 命令/视图注册 + 迁移编排 |
| 7 | `src/data/types.ts` | 核心类型 + entryType / 子分类枚举 |
| 8 | `src/pure/dirs.ts` | 目录命名中枢（笔记子目录唯一裁决入口 `noteSubDir`） |
| 9 | `docs/full-cycle/ReelLudic/` | 阶段产出物（需求澄清/可行性结论） |

---

## 项目命令速查

| 命令 | 用途 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发模式（esbuild watch） |
| `npm run build` | 生产构建（tsc + esbuild） |
| `npm test` ⚠️ **必须先 `cd` 到项目根** | 跑单测（vitest run）。**不带 `cd` 会报误导性的 `TypeError: … reading 'config'` + `(0 test)`**，且"既有测试也会假挂" —— 详见「已知坑点」表第一行 |
| `npm run version` | 版本号同步（version-bump.mjs） |
| 双击 `build.bat` | 构建 + 拷贝产物到 `build/`（含 `pause`，脚本化时不适用） |

### 部署流程（⚠️ Agent 必做）

> 每次改动 `src/`、`styles.css`、`manifest.json` 后，**必须走完「构建 → 受影响单测（动公共纯逻辑则全量）→ 产物断言 → 突变验证 → 部署测试库 → 镜像同步」**，否则 Obsidian 测试库加载的是旧产物。
> **旧的 `build/sync_plugin.ps1`、`build.bat` 已废弃不用**（2026-09-12 起）。

🔴 **部署目标库路径（用户 2026-10-24 明示「始终记住这路径是部署到库」）—— 唯一 canonical 目标**：

```
C:\Users\kest\Desktop\临时测试库\.obsidian\plugins\obsidian-reelludic
```

- 这就是用户**实际打开使用的 Obsidian 库**（主实例窗口标题 `… - 临时测试库 - Obsidian`），也是 `_deploy.cjs` 里 `VAULT` 常量的值。
- 每次交付都要把 `main.js` / `styles.css` / `manifest.json` 三件**真的覆盖到这里**，并做 md5 逐件核对；⛔ 不能只构建不部署、⛔ 不能只部署到 `.testvault` 就说"已部署"。
- `.testvault` 只是**无头真机验证用**的隔离库（`tools/rd.cjs` 跑），⛔ 不是交付目标；两者都要更新时，先部署 `临时测试库`（交付），再同步 `.testvault`（验证）。
- 交付话术里报路径就报这一条全路径，⛔ 不要含糊说「测试库」。

1. 构建：`node node_modules/typescript/bin/tsc -noEmit -skipLibCheck` + `node esbuild.config.mjs production`（**告警数要与基线一致**：当前基线 = **87 warnings**，2026-10-13 实测；⚠️ 变化沿革：2026-09 期是 87 → 2026-10-07 起 89 → **2026-10-13（#619）回到 87**，原因是星控件补上 `role`/`tabindex` 修掉 2 条 A11y 警告（已实测复核，⛔ 不是漏报）；判定时以**当次构建末尾那行 `N warnings`** 为准；只为更快的日常迭代直跑 esbuild 时，**收口前必须补跑一次 tsc**）
1b. **Svelte 类型检查**：`npm run check`（= `svelte-check --tsconfig ./tsconfig.json`）。🔴 tsc 的 `include` 只有 `**/*.ts`，**看不见 `.svelte` 内的 TS 错误**——这正是下节「已知坑」第 1 条。2026-10-27 起 `.svelte` 侧错误已清零（36 → 0），基线 = **0 errors / 89 warnings**；改过任何 `.svelte` 后收口前必须跑一次，**errors 不为 0 不许交付**。
2. 部署：`node _deploy.cjs`（= 拷三产物到测试库 + **md5 三方一致**校验 + 写 `_deploy_sum.txt`）
3. 断言：`node C:/Users/kest/.workbuddy/binaries/node/workspace/assert-symbols.cjs`。🔴 **判绿只看 `exit` + 逐行 `FAIL`，⛔ 不看横幅**；PASS 计数用 node `spawnSync` 点算（PowerShell 管道会把输出并成一行）
4. 突变：`node _mut<批次>.cjs`（每条须 `[RED ok]`；`[SKIP]` = 没验，⛔ 不算通过）
5. 镜像：见下节
6. Obsidian 中 Ctrl+P → `Reload app without restarting`

### 🔴 UI / 交互验证：先用真机，别再手搭复现页

> **2026-10-19 立**：`tools/rd.cjs` 已把「真机 Obsidian」接成一条命令（CDP 驱动，零新依赖）。
> 凡涉及**布局 / 样式 / 交互 / 主题**的改动，**默认先走真机**；复现页只在「需要大规模数据变换后比对」等真机不方便的场景才退而用之。
> 用法与坑表见 `tools/README.md`。

```bash
node tools/make-testvault.cjs          # 首次：建隔离库 .testvault（从临时测试库拷，自动剔掉未装插件）
node tools/rd.cjs launch               # 启动隔离真机（不抢用户当前窗口）
node tools/rd.cjs setup --size 1440x900 --tab media
node tools/rd.cjs shot --out _shot/rd/x.png
node tools/rd.cjs check overflow '.rl-card'
node tools/rd.cjs check computed '.rl-card' 'border-radius'
node tools/rd.cjs dev --tab media --shot   # 改了产物 → 自动热部署 + 真机重载（~4s）
node tools/rd.cjs stop
```

- **为什么不再优先复现页**：复现页手抄样式与祖先链，抄漏 / 被 Obsidian 级联覆盖 / 主题变量取错值都**不会自曝**；
  真机里 `window.app` 就是 Obsidian App，看到的就是用户看到的。实测已用它捕获「封面容器宽度失控 ⇒ 61 张卡全部越界」这类复现页容易糊弄过去的问题。
- **判绿口径**：`check` 退出码 0（= 全 PASS **且** 期间无控制台报错）。控制台错误会自动附在输出末尾。
- ⚠️ **改仓库文本文件一律用 write/edit 工具**，⛔ 别用 PowerShell `Set-Content` 重写 —— 实测会把中文写成乱码、截断字符串并加 BOM（`tools/rd.cjs` 曾因此整文件损坏、需重写）。

---

## 公开镜像同步（`E:/备份0621/Obsidian集合/Obsidian插件开发/obsidian-reelludic`）

> 镜像 = 面向公开仓库的**源码快照**（含 `.git`），**只同步文件，不代 commit / 不代 push**（提交与推送归用户）。

**成员 = 17 项（source-only，其余一律不进镜像）**

| 类别 | 成员 |
|------|------|
| 根文件（14） | `.gitignore`、`.github/`、`CHANGELOG.md`、`LICENSE`、`README.md`、`esbuild.config.mjs`、`package.json`、`package-lock.json`、`manifest.json`、`versions.json`、`tsconfig.json`、`vitest.config.ts`、`version-bump.mjs`、`styles.css` |
| 源码/测试（3） | `main.ts`、`src/`、`tests/` |

**不进镜像**（判据 = 产物 / 私有 / 临时 / 开发工具，**按判据判，⛔ 不按文件名枚举**）：`main.js`（构建产物）、`build/`、`build.bat`、`Project-Rule/`、`docs/`、`_*.cjs`（一次性探针 / 突变器 / 审计脚本）、`_tools_old/`（**已消费的一次性探针归档**，#381 起）、`_mirror_out.txt`（工具产物）、`_shot/`（复现页与截图）、`.workbuddy/`、`node_modules*`、`Bangumi-Bridge-Obsidian/`、`RELEASE-NOTES-*.md`、`.obsidian/`、`.superpowers/`、`.git-backup-corrupt/`。
⚠️ **2026-09-23 更正**：旧名单里列的 `_p9.json` / `_probe.py` / `go-music-dl-analysis/` / `.code-review-task2.md` **均已不存在**（枚举式清单必烂）⇒ 改成上面的「判据 + 排除类」写法。

**同步步骤（幂等）—— 首选正统工具 `_mirror.cjs`**

```bash
node _mirror.cjs          # DRY-RUN：报告写进 _mirror_out.txt（不打印到 stdout，别看漏）
node _mirror.cjs apply    # 执行拷贝
```

该工具用**白名单**（`FILES` + `DIRS`）遍历 —— 所以新增的根文件/目录**必须同时写进它的 `FILES`/`DIRS`**，否则不会被同步；反过来它**绝不会**把 `_*.cjs` / `_tools_old/` 之类带进公开快照 ✓。它顺带做 LICENSE 只读核对（红线 10）。
🔴 **判绿口径**：报告里「待拷贝 0 项」「镜像无多余文件」「LICENSE 一致」，且独立全量比对必须**真实差异 = 0**（逐字节；仅 CRLF 差异也算差异 —— 2026-09-23 用它重拷修掉了 `.github/*` 的 4 处 CRLF 不一致）。

手工兜底（工具不可用时）：`cmp -s` 单文件、`diff -rq` 目录（`Only in 源` = 新增待拷，`Only in 镜像` = 待删）；拷贝目录注意 `cp -rf "src/." "$DST/src/"` 的 **`/.` 形态**（写成 `cp -rf src "$DST/"` 会嵌套）。

**🔴 LICENSE 例外**：只允许 `cmp` 只读核对，**禁止 `cp` / 写入 / 归一**（红线 10）。不一致时停下报告，等用户裁定。

---

## 🔴 红线 — 不能破坏的功能

### 1. 视图类型 ID（`src/views/HomeView.ts`）

- `HOME_VIEW_TYPE = 'reelludic-home'`（统一视图：页签容器，计划/阅读/影视/游戏/音乐/统计共用一个 ItemView）
- **不要修改**，否则工作区布局（workspace.json）中已保存的视图位置全部失效
- 历史遗留：`reelludic-media` / `reelludic-tracking` 两个视图 ID 已在统一视图改造中合并，**勿再新建同名视图**

### 2. catalog.json schema（`src/data/types.ts` + `catalog.ts`）

- **字段只能追加，不能删除、不能改类型**
- 新增字段必须有默认值；读取时对旧数据缺字段做兜底
- 已存在的旧版本数据必须无损升级（版本号 + 迁移函数）

### 3. 核心枚举（`src/pure/status.ts`、`src/data/types.ts`）

- `MediaStatus` 四态 `want / watching / watched / archived` **不能改名**（存入 JSON/MD，改名即数据损坏；v0.5 已移除 `dropped` 增 `archived`，存量 `dropped` 数据在 normalizeEntry 自动迁移为 `archived`，勿再引用 dropped）
- `EntryType` 枚举值 `movie / tv / anime / book / game / music` 六态平铺，**不要移除**
- 评分范围 1~5（0=未评分），边界校验不能放宽
- **子分类枚举**（append-only 可选字段，只增不改）：
  - `BookKind = 'book' | 'novel' | 'comic'`（book 展示名「文学」原「出版」；漫画 1.0.3.1 曾下线，**#444e / 2026-09-30 已加回** —— 独立源链组 + 独立 `笔记/comic/` 目录，归一/匹配/计数与其他子类**零特判**）
  - `MusicKind = 'music'`（**原 `'other'` 已于 1.0.3.1 下线**，存量值归 music；音乐不再分子类）
  - 合法值集合以 `BOOK_KIND_LABELS` / `MUSIC_KINDS` 为准，归一函数用 `Object.keys`/`includes` 校验（**禁用 `in`**，会沿原型链误判 `toString` 合法）
  - 新增子分类值时必须三件套同步：`MediaEntry` 字段注释 + `normalizeEntry` 白名单（`src/data/catalog.ts`）+ `catalog.test.ts` 回归

### 4. 条目笔记路径与 frontmatter（`noteGenerator.ts` + `pure/dirs.ts`）

- **笔记子目录唯一裁决入口 = `pure/dirs.noteSubDir(e)`**：书籍按子分类分（文学 `笔记/book/`、网文 `笔记/novel/`、漫画 `笔记/comic/`），其余类型按类型目录（`笔记/movie|teleplay|animation|game|music/`）。**新增/改路径一律走它**，勿散落硬编码 `ENTRY_TYPE_DIRS`
- 存量网文笔记迁移 = `services/novelMigration.migrateNovelNotes(vault, opts)`（挂在 `main.migrateDirectories` 第 4 步）：幂等、目标冲突不覆盖、源缺只补引用、失败静默
- frontmatter 键名**不能改**：核心 `id/type/title/status/rating`；Dataview 对齐 `tags/created/updated/progress_percent`；其余按类型可选（`year/genres/director/cast/author/publisher/platform/album/banner/…`，见 `entryFrontmatter`）
- 生成模板的章节结构（`基本信息 / 内容简介 / 个人评语 / 一句话总结 / 核心看点 / 游玩记录 / 相关链接·观看链接`）为公共约定，重命名会破坏既有笔记的可读性与回填解析（`pure/noteEditable.ts`）
- 🔴 **空评语那行是解析哨兵**（`## 个人评语` 下、评语为空时写入）：文本真源 = `pure/noteEditable.NOTES_PLACEHOLDER`（现行 `（在这里写下你的感想）`），判定只走 **`isNotesPlaceholder()`** —— **新旧形态都算「未写」**（旧文本存在 `LEGACY_NOTES_PLACEHOLDERS`，⛔ 别删：删了旧条目一打开就把占位符当成用户评语回填）。`noteGenerator` 写入侧必须取该常量，⛔ 不许内联第二份字面量（#453 收敛过）
- **`## 观看链接` 的内容**（#448 立）：影视（movie/tv/anime）的**逐集网络链接**要写成 `- [第 1 集 集标题](url)`（`noteGenerator.episodeWatchLines`；标签走 `pure/episodeAssoc.episodeHintLabel` 同一份真源；电影不出「第 N 集」、多资源电影用「文件 N」）；**本地路径不写进笔记**（绝对路径又长又不可点）。⛔ 别退回「只读 `e.links`」——影视的链接早已迁到 `episodeUrls`（提交时 `links` 清空），那样写等于一条集链接都不落笔记


#### 表单里那一块的名字统一叫「**启动路径**」（#523 起，2026-10-18 复核，强制）

五种类型在编辑表单里有**各自**的一块关联资源，**界面上的标签一律叫「启动路径」**：

| 类型 | 「启动路径」下面是什么 | 右侧小图标 |
|---|---|---|
| 电影 / 剧集 / 动画 | 观看链接（▶ 观看 / 1..N 集按钮，右键编辑本地或网络） | 检索本地（剧集/动画另有「批量搜索未填集」） |
| 书籍（文学/网文/漫画） | 书籍文件（TXT / EPUB / PDF / CBZ…） | 检索本地书籍 + 检索在线阅读（微信读书） |
| 游戏 | 启动快捷方式（.lnk / .exe） | 检索本地 |
| 音乐 | 本地音频（mp3 / flac…） | 检索本地音频 + 下载歌曲 |

🔴 **不要再按旧叫法去描述这一块**：文档、注释、断言里写的若是「观看链接 / 本地音频 / 启动快捷方式 / 书籍文件」
**作为表单标签**，一律改成「启动路径」（旧名字只保留在**字段名**与**数据键**的语境里，例如 `audioPath` / `gameLaunchPath` /
`bookFile` / `episodeFiles` —— 那些是 schema，⛔ 不许改）。沿革：标签原为「观看链接」，#523 用户点名
「所有类型条目下的右键编辑条目的播放标题统一改成『路径』标题」⇒ 全类型统一成「启动路径」并沿用至今。
### 5. 构建链

- `npm run build` = `tsc -noEmit -skipLibCheck && esbuild`，**不要跳过 tsc**
- esbuild `external` 列表（obsidian/electron/@codemirror*/@lezer*/builtin-modules）不能乱删
- 🔴 **PDF 不再打包 pdfjs（2026-10-22 用户裁定「换 pdfjs 源为 Obsidian 自带 5.3.34，保留自研阅读器」）**：
  - `src/modals/PdfReaderModal.ts` 走 `import { loadPdfJs } from 'obsidian'` + 模块级单例 `getPdfjs()`（懒加载、失败可重试），**⛔ 别再写回 `import * as pdfjsLib from 'pdfjs-dist'` / `import workerUrl from '...pdf.worker.min.mjs'`**
  - `esbuild.config.mjs` 里那个把 worker 读成字符串再 Blob 注入的 `pdfWorkerInline` 插件**已删除**，⛔ 别加回来
  - 依赖层面：`package.json` 的 `pdfjs-dist` 与 `package-lock.json` 里它带来的 `@napi-rs/canvas*` 共 13 个包条目已摘除；`src/types/pdfjs-worker.d.ts` 已删
  - 类型层面：v5 起不再导出 `RenderTask` ⇒ 用本文件内的结构类型 `PdfRenderTask` / `PdfPageProxy` / `PdfDocumentProxy` / `PdfjsLib`，⛔ 别 `import type` 自 pdfjs-dist
  - ⚠️ **`CHANGELOG.md`（内部）里「PDF 依赖固定 v4 线、勿升 v5」那条红线仍然有效，但它只管「自带 pdfjs-dist 打包进单文件产物」这条路径**；复用引擎自带版本是**已实测的例外**（引擎这版 JBIG2/CCITT 是纯 JS、不 fetch wasm，`render` 仍收 `canvasContext`）。判定依据与完整实测记录见 `Project-Rule/CHANGELOG.md` 中「上述红线的例外与收窄（2026-10-22）」那条。**⛔ 别把例外理解成「可以升 pdfjs-dist 到 v5」。**
- 🔴 **PDF 高亮（2026-10-23 用户裁定路线 A「只存 JSON，不写回 PDF」）**：
  - 高亮**只写进阅读进度 JSON**（`ReaderStore.highlights`），**⛔ 绝不能用 pdf-lib 之类把 Annot 写回用户的 PDF 原文件**（PDF++ 那样做有损坏风险，且与本仓 #528 裁定相反）
  - 页内位置一律存**归一化 0-1 百分比**（`PdfRelRect{x,y,w,h}`，见 `src/pure/pdfHighlight.ts`）。依据：`chars[].r` 实测与缩放无关，pdf.js 自己渲染 textLayer span 也走百分比 ⇒ 缩放 50%–300% **不重算**。**⛔ 别改成存像素或每次缩放重算**
  - 覆盖层 `.rl-pdf-hl-layer` 的 **`pointer-events: none` 必须保留**，否则挡住 textLayer 拖选、高亮入口整体失效
  - `renderPage` 的 `textLayer.render().then` 末尾**必须**调 `paintHighlightLayer(i)` —— 离屏销毁重建（`releasePage`）与缩放重渲染（`applyScaleValue`）后靠它把高亮画回来
  - 换样式走**静默删除通道** `onTrashSelection({quiet:true})`，**⛔ 别走 `onDeleteHighlight`**（那会弹 ConfirmModal，用户为换个颜色得先确认一次删除，真机实测过这个毛病）
  - `ReaderHighlight` 的 `rects?` 是 **append-only** 可选字段，`normalizeHighlights` 白名单同步；**⛔ 别为 PDF 单开 schema、别升 `READER_STORE_VERSION`**
  - ⚠️ **真机验证前先确认产物真进了 `.testvault`**：`_deploy.cjs` 的 `VAULT` 指向 `C:/Users/kest/Desktop/临时测试库/...`，**不是** `tools/rd.cjs` 跑的 `.testvault` ⇒ 必须手动 `Copy-Item main.js,styles.css,manifest.json .testvault\.obsidian\plugins\obsidian-reelludic\` 再 `rd.cjs stop` + `launch`，否则测的是旧产物

- 🔴 **三阅读器区域截图（2026-10-23，用户指令「给 TXT/EPUB/PDF 阅读器加个区域截图回填笔记功能」）**：
  - 取像素**唯一通道** = `require('electron').remote.getCurrentWebContents().capturePage({x,y,width,height})`。**⛔ 别改成 `canvas.toDataURL`**（TXT 是文本层、EPUB 正文在 `iframe` 的 `srcdoc` 里，拿不到内容）、**⛔ 别引入 `html2canvas` 或 `foreignObject`**（本仓没有 html2canvas；foreignObject 丢样式且跨 iframe 不可靠）。真机实测 `capturePage` 传 200×150 精确得 200×150，且抓的是**窗口合成像素** ⇒ iframe 天然覆盖
  - `ShotRect` 单位是 **CSS px（DIP）**，**⛔ 别乘 `devicePixelRatio`** —— `capturePage` 的矩形与 `getBoundingClientRect()` 同尺
  - 🔴 **截前必须等两帧**：`saveReaderShot` 开头必须 `requestAnimationFrame ×2 + setTimeout(60ms)`。`ShotOverlay` 是 `position:fixed` 的 `rgba(0,0,0,0.28)` 遮罩，`destroy()` 后浏览器未重绘就 `capturePage`，抓到的是**上一帧的遮罩**（真机第一张截图是 705 字节的整块纯灰）
  - **文件名缺省后缀必须是「截图」**（`readerShotFileName`）：空后缀会与同名封面撞车（实测截图落成 `活着.png`、与封面同目录，笔记 `![[活着.png]]` 指向封面）。**⛔ 别把 tail 缺省改回空串**；书名本身为空时不叠后缀
  - 🔴 **新增笔记区段必须同步 `pure/excerpt.ANNOTATION_SECTIONS`**：截图写进 `## 阅读截图`（`pure/readerShot.SHOT_SECTION_READER`），不加进名单 = 用户一保存条目就触发 `writeNote` 模板重写、整区截图被静默抹掉。**⚠️ 与视频的 `截图时间戳`/`截图` 是两个不同区，⛔ 别合并**
  - **笔记只能经 `EntryService.appendNoteSection` 写**（`noteFingerprint` 的唯一拥有者）；面板里 **⛔ `vault.modify`**，否则指纹过期、下次误报「笔记被外部修改」
  - 框选区：PDF `.rl-pdf-scroll` / TXT `.rl-reader-scroll` / EPUB `frameEl.closest('.rl-reader-frame')`（**iframe 外层 wrapper**，⛔ 不用 `frameEl` 自身）
  - 截图按钮是**一次性动作**，⛔ 不走 `toggleAnnotate`（那不是模式）；必须有 `if (this.options.onShotSave)` 守卫，未注入不画按钮
  - 🔴 `.rl-shot-hint` 的 `border-radius` **只能写 `var(--radius-l)`**：写成 `999px` 会撞全仓「胶囊形态（999px + 容器底）一律退场」的反向守卫，断言当场红（本批真机踩过一次）
  - 三面板 `destroy()` 都必须 `this.shotOverlay?.destroy()`（遮罩挂 `document.body`，面板没了必须一起收）

- 🔴 **PDF 摘抄（2026-10-23）**：
  - 卡片、键盘语义、定位全部复用 `pure/excerptCard`（`needsQuoteExpand` / `excerptCardKeyAction` / `excerptCardLocLabel` / `placeCard`）。**⛔ 别为 PDF 另写一套卡片**
  - 🔴 **PDF 的 `loc.chapter` 存的是一基页码**，`excerptCardLocLabel(title, loc, unit)` 第 3 参必须传 `'页'`（缺省 `'章'` 是给 TXT/EPUB 的）—— 漏传会写成「第 1 章」（真机抓到过）。**⛔ 别去改 `ParsedExcerpt.loc` 的共用语义**
  - PDF 动作条为 **摘抄 / 高亮 / 复制 / 垃圾桶 四钮**；PDF 动作条**不做**翻译 / 网络搜索 / AI 搜索（无笔记正文语境）—— ⚠️ 别与**顶栏快捷模式**混淆：顶栏第 5/6 钮就是「翻译 / 网络搜索」模式，拖选正文后由 `dispatchAnnotate` 走 `ReaderOverlays`（2026-10-23 起）
  - 写笔记同样只经 `onExcerptSave` → 宿主 `addExcerpt` → `EntryService`，面板里 ⛔ 碰 vault

- 🔴 **四阅读器统一口径（2026-10-23，用户指令「四阅读器统一改造」）**：
  - **PDF 顶栏顺序是契约**：书签 · 高亮 · 摘抄 · 区域截图 · 翻译 · 网络搜索 · 设置。前 6 枚在 `.rl-reader-quick` 里、`≡` 在 `.rl-reader-ops` 上紧随其后。⛔ 别调序、别插队
  - 🔴 **书签是一次性动作，⛔ 不是模式**：`mkQuick(wrap, id, icon, tip, onClick?)` 的第 5 参必须传 `() => this.addBookmark()`。不传会落到默认的 `toggleAnnotate(id)`，按钮进入一个没有任何持续语义的「书签模式」（真机抓到过）
  - **PDF 侧栏是两个页签**（`文档目录` + `书签 · 高亮 · 摘抄`），三区共处一个 pane、各由 `buildAnnoHead` 建头。⛔ 别退回「一区一个页签」
  - `syncAnnoBtns(head, total)` 是**各面板私有**（`annoSelection` 不导出它，别试图提取）
  - 🔴 **批量删除高亮只能走 `onTrashSelection({highlightIds, excerptIds}, {quiet:true})`**：逐条调 `onDeleteHighlight` 会为每条弹一次确认框（选 10 条弹 10 次）—— 断言 `@L2843` 明令禁止
  - 🔴 **Ctrl/⌘+滚轮的监听位置**：PDF 挂 `.rl-pdf-scroll`、TXT 挂 `.rl-reader-scroll`、EPUB 挂**iframe 内 `doc`**（正文在 frame 里，宿主容器收不到），三者都要 `{passive:false}` + `preventDefault()`。⛔ PDF 别挂 `container` —— 那上面 `onUserInterrupt` 是 passive，拦不住 Obsidian 把 Ctrl+滚轮当整页缩放
  - **TXT 的 Ctrl+滚轮必须优先于翻页判定**（`if (ctrlKey||metaKey) { preventDefault(); adjustFont(); return; }` 写在 `isPaged()` 之前）
  - **PDF 缩放持久化字段是 `Settings.readerPdfScale`**（0.5–3 / 0.25 / 缺省 1），⛔ 别复用 `readerFontSize`（语义不同）；写回点在 `applyScaleValue()` 末尾，滑条/键盘/Ctrl+滚轮三路共用
  - **PDF 翻页模式复用 `pure/paged.ScrollMode` 与设置键 `readerScrollMode`**（⛔ 别另起枚举）；`scrollByPage`、键盘 ←/→、底栏 `navL`/`navR` 三处都必须有 `isPaged()` 分支
  - **`ReaderOverlays`（译文卡 + 网络搜索浮层）是 PDF 的共用件**；TXT/EPUB 里那两份内联版**别去抽共** —— 它们被产物断言按字面锁着，本轮刻意不动
  - 🔴 **漫画有两个 `openWith` 入口**（压缩包/图片文件夹档 + **EPUB 漫画档**），补任何新回调都要**两处都补**（真机抓到过：只补前者，「呆头农场」走 EPUB 档 ⇒ 顶栏没有截图按钮）
  - **漫画顶栏 `quick` 只放「存书签 / 区域截图」**，缩略图钮留在 `ops` 上（⛔ 别挪进 quick）
  - 🔴 **PDF 翻页模式的坐标基准必须是 DOM 真值（2026-10-23 #692 修）**：`refreshPageTops()` 里 `pv.top = pv.el.offsetTop - this.pagesEl.offsetTop`，⛔ 别退回「页高累加」—— `.rl-pdf-pages` 有 `padding-top:16px` 与页间 `gap:14px`，累加会每页漏 14px，第 289 页偏 4062px，表现为「切了翻页但页码不动」。必须保留 `measurable` 守卫（容器未布局时整列 `offsetTop` 都是 0）
  - 🔴 **`.rl-pdf-paged` 隐藏非当前页只能 `visibility:hidden`，⛔ 绝不能用 `display:none`**：后者让隐藏页塌成 0 高 ⇒ `offsetTop` 几何全错、`scrollToPage()` 定位失效。且 `.rl-pdf-pages` 在 paged 下要 `padding-bottom:100vh`（`overflow:hidden` 时可滚范围 = scrollHeight − clientHeight，60vh=540px < clientHeight≈758px 不够末页顶对齐）
  - 🔴 **`.is-current` 必须四路维护**：`setMode()` / `scrollToPage()` / `updateProgress()` / `load()`。少任一路都会白屏（初始全 hidden）或脱页。`mount()` 里还要按持久化 `mode` 补 `rl-pdf-paged` 类，否则重开不生效
  - 🔴 **自动推进入口 `dt` 单位必须是「秒」（2026-10-23 #692 真缺陷）**：`advanceAutoPos(pos, speed, dt, max)` 算的是 `speed * dt`、`autoScrollPx` 是 px/秒。写 `Math.min(0.1, (ts - autoLastTs) / 1000)`，⛔ 别传毫秒（放大 1000 倍 ⇒ 一帧冲到底并立刻触发「已读完全书」，表面症状是「按钮点了没反应」）。`setInterval` 走 `autoTurnMs` 毫秒语义，那条不用改
  - 🔴 **`READER_FOPS.autoScrollOnly` 已删除**（2026-10-23 #692）：四件一律 `autoScrollPaged`。`tests/readerFops.test.ts` 有反向守卫，⛔ 别再按「PDF 只有连续滚动」加回第二个常量
  - 🔴 **漫画书签列表只在侧栏**（`bmHeadRef` / `rl-reader-bm-list`），⛔ 别接回设置菜单（会变两个真源）。漫画 `activateSidebarPane()` 内必须先 `const toc = this.tocEl; if (!toc) return;`，否则 tsc 报 `TS2531`
  - 🔴 **区域截图文件名是 `书名 + 空格 + YYYYMMDD-HHmmss`**（`pure/readerShot.shotStamp`，为与 `image-converter` 的 `{notename}-{date}` 模板同构）：⛔ 别退回「书名 截图N」；⛔ 时分秒别用冒号（Windows 非法 + `![[…]]` 会解析错）；同秒撞名交给 `getAvailablePathForAttachment` 加序号

- 🔴 **断言基线口径（2026-10-23 修正，⛔ 别再用「78」）**：`assert-symbols.cjs` 的正确基线是 **「旧断言 + 旧产物」= PASS 3970 / FAIL 84**。判断「本批有没有引入新红灯」必须做**四象限对照**（{旧断言,新断言} × {旧产物,新产物}，FAIL 集合去掉 `@L\d+` 行号后求差），⛔ 不能只比数字 —— 曾因拿两种搭配的读数互比，误判「多了 4 条」。当前口径下 `#691` 收尾值 = PASS 3972 / FAIL 82（净少 2 条）。

### 6. vitest alias 表（`vitest.config.ts`）

- 因 tsconfig `baseUrl: ./src` 裸导入，**每次在 src/ 顶层新增模块，必须同步在 vitest alias 表注册**，否则单测解析失败

### 7. 版本三文件同步

- `package.json` / `manifest.json` / `versions.json` 的 version 必须一致。
- ⚠️ **实践口径（用户裁定）：改版本号是手改这三处**，⛔ 不走 `npm version` / `npm run version` —— 该脚本（`version-bump.mjs`）确实存在、也能用，但它内含 `git add manifest.json versions.json`，与「提交归用户」相冲。本仓也不打 `v*` tag、不跑 CI 发版。

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

## 🔒 当前版本策略（2026-09-16 立；2026-09-22 / 2026-10-04 / 2026-10-11 / 2026-10-16 用户补充裁定）

- **当前在 1.4.1 期**：版本三文件（`package.json` / `manifest.json` / `versions.json`）均为 **1.4.1**（手改，见红线 7）。⚠️ `package-lock.json` 的**根版本也要同步**（顶层 `version` + `packages[""].version`，共 2 处；⚠️ 锁文件里另有 `expect-type` 等依赖自身的 `"version": "1.4.0"` 行，那是**依赖版本**，⛔ 别跟着改）。⚠️ 发版时 `versions.json` 要**加键**（不是改既有键），并同步 `package-lock.json` 根版本（顶层 + `packages[""]`）**与 `src/services/mangadex.ts` 的 `MANGADEX_UA` 版本段** —— #473 断言会逐条核对「UA 版本段 == `package.json` version」与「三处一致」。**2026-10-25 实测：四处齐为 1.4.1、`MANGADEX_UA = 'ReelLudic/1.4.1 …'`、`versions.json["1.4.1"] = "1.7.2"`（该键值是 minAppVersion，⛔ 不是插件版本）。**
- **沿革**：正式发布的更新日志止于 1.0.3 → 原 1.0.4 期并入 **1.1.0** → 1.1.1 期**改定 1.2.0**（2026-10-04）→ 原 1.2.1 期（**从未发布**）**整体改定 1.3.0**（2026-10-11；装的是实打实的新功能面：微信读书同步 / 搜索、内置阅读器本地漫画、播放器时间戳·截图侧边栏、导航布局与时间线视图、失效链接检测等，按语义化版本属 **minor**）→ **1.4.0**（2026-10-16）。
- **1.4.0 期**（用户 2026-10-16 点名「插件版本号定级为 1.4.0」）：EPUB 阅读器正文插图恢复显示（`srcdoc` 无基准地址 ⇒ 包内相对路径全 404 的老问题）、EPUB 首屏/开章提速（目录字数惰性化，实测省 ~95% 同步时间）、Steam 凭据行两处 UI 修正（副标题取消并入说明、按钮间距 16px → 8px）。⚠️ 定级说明：本批**主要是体验优化与修复**，按 2026-09-22 那条「体验优化不算新增功能」的口径本可留在 1.3.x；**是用户显式点名定为 1.4.0**，故照办（⛔ 别据本条反推「以后优化都能升 minor」—— 判不准时**先问用户**）。
- 🔴 **2026-09-22 用户裁定（仍然有效）：体验优化（如「视图级题材筛选」这类现有功能的完善）不算「新增功能」**，可继续留在同版本；只有**全新的能力面**才需另开版本。判断不清时**先问用户**，⛔ 别自行归类后闷头做。
- 发版流程照旧：三文件同步（手改）+ UA 版本段 → 构建 → 受影响/全量单测 → 产物断言 → 突变 → 部署测试库 → 公开镜像同步（只同步文件，commit/push 归用户）。

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
| `src/services/resultTypes.ts` | 书籍/游戏搜索结果类型（形状源自 Google Books / RAWG 两代实现，**现仅 Douban 产生**；⛔ 别据此以为这两个服务已从仓库删除 —— 见下方「数据源」口径） |
| `src/services/novelMigration.ts` | 网文笔记目录迁移（结构性 vault 接口 + 内存假 vault 单测 10 例，幂等；改判定条件需同步测试） |
| `src/pure/noteEditable.ts` | 笔记可编辑字段解析（正文章节 + frontmatter + 来源行），改动需同步 EntryModal 回填逻辑与测试 |
| `src/views/`、`src/modals/` | 视图 UI，逻辑下沉纯模块后可安全改样式 |
| `tests/` | vitest 单测 |
| `Project-Rule/`、`docs/` | 纯文档 |
| `build.bat` / `build/sync_plugin.ps1` | ⚠️ **均已废弃**（2026-09-12 起）—— 构建走 `node esbuild.config.mjs production`，部署走 `node _deploy.cjs`。保留文件仅为历史，⛔ 别再引用 |

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
| **设置页 DOM 样式须写 styles.css** | Settings.ts 用 DOM API 创建的元素（折叠行等）不经 Svelte 编译，样式不会注入 main.js | 自定义类样式（如 `rl-srcchk-*`）写入 styles.css 并随部署同步。已踩坑：2026-08-25 |
| 🔴 **本机跑 vitest ⛔ 不能省 `cd`** | 不带 `cd` 时 vitest 把 root 解析成**小写盘符** `c:/…`，而 `vitest.config.ts` 的别名是 `resolve(__dirname,'src/pure')`（大写）⇒ **别名全废**；报错却是**误导性**的 `TypeError: Cannot read properties of undefined (reading 'config')` + `(0 test)`，连**既有测试也会假挂**（只有不依赖别名的独立模块能过，极易误判成环境坏） | 一律 `cd C:/Users/kest/Desktop/obsidian-reelludic && node node_modules/vitest/vitest.mjs run …`；跑前瞄一眼横幅里的 root 是否为大写盘符。已踩坑：2026-09-23（当时连 `tests/sourceRegistry.test.ts` 35 例都假挂） |
| ⚠️ **带反引号 / `$` / 反斜杠的脚本 ⛔ 别放进 `node -e "…"`** | bash 先解析双引号字符串：`` `code` `` 会做**命令替换**（整段被吃成空）、`$VAR` 会展开、`\\` 层数被削（正则静默变义或语法报错） | 这类脚本（含中文长文案 / 正则 / 模板串）**落成 `.cjs` 文件再 `node 文件`**（本仓根的 `_*.cjs` 就是此用途）。已踩坑：2026-09-23（UI-GUIDE 一条历史行被吃掉一半） |
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
| **吸顶 sticky：别直接给内部行加 sticky，且警惕定位声明被覆盖** | 两种真失效方式：⑴**属性被级联压掉**——`.rl-tabs{position:sticky}` 被更具体的 `.rl-tabs.rl-tabs-modern{position:relative}` 覆盖（两个类 > 一个类且后者在后），**不报错、不提示**，表现为「从上线起从未吸顶」；⑵**内部行仅部分宽度 + margin 区不参与吸附** → 吸顶时滚动内容从栏的上方/两侧露出（2026-08-29 观察到的「首行卡片被推到页签栏上方」属此类） | **吸顶只做在「拉满宽度 + 同色底」的外层容器**（`.rl-sticky-head`）；间距用 `padding` 收进容器、**不要用 `margin`**；同一元素不得被两条规则同时设 `position`。⚠️ **本条早前记为「flex column + min-height:100% 会破坏 sticky」——2026-09-14 以 Chrome 无头忠实复现（照抄 obsidian.asar 祖先链 + `contain:strict`）已推翻**：K1–K4 全变体吸附，真因只有上面两条。详见内部 CHANGELOG ⑳。⚠️ **1.0.4 曾按此实现页签吸顶，同日经用户上手裁定「放弃吸顶」并已整体回撤 —— 当前项目无吸顶**，本条保留为「将来若做」的须知。 |
| **textarea auto-grow：scrollHeight 不小于渲染高度** | 简介框 auto-grow 用 `height:'auto'` 复位再取 scrollHeight——textarea 的 scrollHeight **不会小于当前渲染高度**，`height:auto` 后仍停 `rows=6` 基线，文字少时框缩不回去 | **先 `el.style.height='0px'` 再取 `el.scrollHeight`**（强制按内容重算）+ CSS `min-height` 控制少文字基线。已踩坑：2026-08-29 修复（commit c8ba585） |
| **Obsidian 视图滚动容器是 `.view-content`（非 window）** | 视图内容滚动发生在 view-content，`svelte:window`/window 的 scroll 事件**不触发**；滚动容器可能是 contentEl 或其祖先 | 从组件根元素向上找第一个 `scrollHeight > clientHeight + 1` 的祖先绑 `scroll` 监听（passive）。已踩坑：2026-08-29 回到顶部按钮实现 |
| **`.svelte` 文件不经 tsc 检查 → Svelte 内 TS 类型错误静默放行** | tsconfig `include: ["**/*.ts"]` **不含 .svelte**，esbuild-svelte 只转译不查类型——`.svelte` 里对 number 调 `.replace` 等类型错误 tsc 全绿、运行时才炸（被 try/catch 吞掉后表现为「功能静默不生效」） | ✅ **2026-10-27 起已有 `npm run check`（svelte-check）兜住这一层**：36 errors 已全部修掉、基线 0 errors；**改过任何 `.svelte` 后收口前必须跑，errors 不为 0 不许交付**。⚠️ 另注意 `tsc` 的 `include` 本身未扩（刻意不动：扩了会把 `.svelte` 塞进 `tsc` 的 `allowJs` 路径，行为与 esbuild-svelte 不一致），`exclude` 已补 `node_modules*` / `.chrome-*` / `.testvault*`（此前漏了 `node_modules.bak-vite8/` 的 882 个 `.d.ts` 被一起编译，tsc 从 24.2s 降到 14.0s）。⚠️ 历史兜底手段仍有效：Svelte 内对跨类型值操作可 `String(x)` 包一层再 `.replace`，改完 grep 产物验证形态。已踩坑：2026-08-31 游戏条目豆瓣回填全空（`GameSearchResult.id` 是 number 却调 `r.id.replace('douban:','')` → TypeError 静默吞 → 详情拉取从未发生） |
| **`GameSearchResult.id` 是 number（douban:xxx 是书/音乐专属）** | `toGameResult` 产 `id: Number(s.id) || 0`（number），书/音乐产 `douban:xxx` 字符串——**游戏 id 不能走 `.replace('douban:','')` 剥前缀**（number 无 replace，静默 TypeError） | 游戏分支统一 `String(r.id)`；`main.ts fetchDoubanDetailForEntry` 字段白名单必须经 `toEntryDetailFields` 投影（漏列 platform/developer 曾导致游戏回填全空）。已踩坑：2026-08-31 部落冲突豆瓣回填全空 |
| **esbuild 增量缓存：只改 .svelte/.css 不动 main.ts 会漏重编译** | `npm run build` 的 esbuild 用 `context.rebuild()` 增量缓存，**只改 .svelte/.css、不动 main.ts 时可能不重编译**——main.js 里仍残留旧样式值（如 60×90 没变成 48×72），grep 产物发现还是旧值 | 改完 .svelte/.css 后 **`rm -f main.js build/main.js` 再重跑 `node esbuild.config.mjs production`** 强制重编译；注意 esbuild outfile 是**根目录 main.js**（非 build/），三件套需 `cp -f main.js styles.css manifest.json build/` 再同步测试库。已踩坑：2026-09-01 封面缩略图 48×72 首次构建漏编译 |
| **产物 CSS 断言：scoped 选择器带 hash、minify 折叠空白但保留函数内空格** | Svelte scoped 样式在 main.js 里是 `.rl-xxx.svelte-<hash>.svelte-<hash>{…}`（搜 `.rl-xxx:hover` 必假阴性）；esbuild css minify 折叠非关键空白但**保留 `minmax(0, 1fr)` 等函数内空格**（搜无空格形态也假阴性） | 断言前先 dump 产物实际片段确认形态；CSS 规则断言用宽松子串/正则（分隔关键词各自 includes），别按源码书写形态猜。已踩坑：2026-09-05 追番表 hover（#220）与排期表等高（#223）断言各一次 |
| **按钮 hover 语言（全项目约定）** | 操作按钮此前颜色/缩放/反馈各写各的（常驻主题色、无 hover 反馈、两档 scale） | 成对操作按钮统一：**默认灰 → hover accent（文字或底）+ `transform: scale(1.12)` + transition**；primary CTA（常驻主题色）与封面 overlay 快操例外。已落地：2026-09-05 #218-221 列表/追番表/音乐行/海报墙 |

| **高亮 `<mark>` 的文字色依赖 UA 默认 → 深色模式下黑字隐形** | `<mark>` 的 UA 默认文字色是 `MarkText`＝**纯黑 `rgb(0,0,0)`**；Obsidian 核心只覆写 `.markdown-rendered mark { color: var(--text-normal) }`，**而阅读器正文不在那个作用域里** → 底色 / 划线 / 波浪三种样式的文字**全落黑**。色块档靠 42% 黄底遮挡才「看着正常」，划线 / 波浪档 `background: transparent` → 深色主题下黑字无遮挡 = 看不见（2026-09-18 用户报障；浅色下同样偏黑，只是不明显） | `.rl-hl-persist` **基类必须显式写 `color: inherit`**（口径：高亮只加底色 / 划线、**不改文字颜色**；⛔ 不要写死任何色值，否则与「换肤只改容器变量」的机制打架）。🔴 **两处真源必须同步改**：`styles.css`（TXT/PDF）与 `src/pure/highlight.ts` 的 `highlightMarkCss()`（EPUB `srcdoc` 注入的**独立文档**，收不到插件样式表）。已加双向断言（css 基类 inherit + 反向守卫「只准 inherit」、js 注入版同步 + 反向守卫「不得退回旧形态」）+ 突变 3/3 验证。⚠️ 断言写法坑：`color:\s*(?!inherit)` 会因 `\s*` **回溯到零长度**而对合规写法假红 → 改「取值后比对」，并用 `(?<![\w-])` 排除 `text-decoration-color` |

---

## 依赖关系图

```
main.ts（入口 + 命令注册 + 视图注册 + 事件中枢 + homeTab 页签状态 + 库目录迁移）
  ├── Settings.ts（服务集成：12 源注册表凭据 + 6 组源链勾选（书籍/漫画/游戏/音乐/影视/动画）+ AI 翻译与总结双 Key + 库目录 + 播放/阅读开关 + 外观）
  ├── views/HomeView.ts（统一视图 reelludic-home，页签容器）
  │     └── components/HomeView.svelte（页签栏：计划/阅读/影视/游戏/音乐/统计 + 回到顶部按钮）
  │           ├── components/MediaList.svelte（书架：海报墙/列表/瀑布流/按歌手分组 + 筛选排序 + 观看按钮/右键菜单 + 书籍子分类 chips）
  │           ├── components/TrackingBoard.svelte（追更表：更新检测串行限流 + 结果落库）
  │           ├── components/CalendarBoard.svelte（排期表：月历/周历 + 拖拽 + 到期横幅 + 日期点击弹详情）
  │           └── components/StatsBoard.svelte（统计页**三层倒金字塔**：核心指标 1 主 4 辅 → 动态 → 趋势 → 概览 Tab；纯逻辑全在 pure/statOverview.ts，主 CTA 在主指标卡内）
  ├── modals/EntryModal.ts（添加/编辑弹窗：双套 UI + 笔记回填 + 孤儿封面清理 + 双写冲突）
  │     └── components/EntryForm.svelte（Douban 版 / TMDB·Bangumi 版，formMode 按 source 切换；搜索框类型下拉 = 书籍分类唯一入口）
  ├── modals/*（ConfirmModal 通用确认 / LinkPickerModal 多链接选源 / EpisodePickerModal 集数选择 /
  │     NoteConflictModal 双写冲突 / ExcerptModal 摘抄 / EntryLogModal 游玩记录（#685 起通用化，替代旧 GameSessionModal） / CalendarDayModal 排期日 / 
  │     PosterMigrateModal 封面迁移 / PosterCleanupModal 孤儿清理 /
  │     VaultFileSuggest 文件建议 / VaultFolderSuggest 文件夹建议（后者兼作旧版 Obsidian 的降级入口））
  ├── services/EntryService.ts（增删改查编排 + 状态流转 + 笔记生成/双写冲突检测）
  │     ├── services/vaultIO.ts（VaultIO 适配：writeText 前 ensureParentFolder）
  │     ├── services/novelMigration.ts（网文笔记迁入 笔记/novel/：结构性 vault 接口，幂等，10 例单测）
  │     ├── services/tmdb.ts（TMDB 搜索/详情：电影/电视剧，vote_count→ratingCount）
  │     ├── services/bangumi.ts（Bangumi 搜索/详情补全：subjects + persons；服务**动画 + 漫画**两链，漫画走 `subjectType=1` 书籍类目）
  │     ├── services/resultTypes.ts（BookSearchResult/GameSearchResult 类型定义）
  │     ├── services/douban.ts（全类型主力源：反爬适配 + Cookie 失效提示 + 详情小节）
  │     ├── services/nodeHttp.ts（Node 原生传输层，桌面端专用，惰性 require）
  │     └── services/aiSummary.ts（AI 总结摘要：复用阅读器翻译凭据，依赖全注入）
  │   另有按需注册的补充源：openLibrary / googleBooks / steam / musicbrainz / itunes /
  │     omdb / anilist / igdb / mangadex（12 源注册表见 src/pure/sourceRegistry.ts，各组默认链见 DEFAULT_CHAINS）
  ├── data/catalog.ts（catalog.json 读写；normalizeEntry 为落库唯一关口）
  ├── data/noteGenerator.ts（.md 笔记生成，按类型渲染 + 指纹；路径走 pure/dirs.noteSubDir）
  ├── pure/*（**179** 个无 obsidian 依赖纯模块 —— 2026-10-25 实测 `src/pure/*.ts` 计数 179、其中 import 'obsidian' 者为 0；旧文写「134 个」是 #369 期的旧数，勿再沿用；**#369 之后新增批次**：posterGrid / genreFilter / statOverview /
  │     settingNav / searchIcons / focusType / libraryDir 等。其余：status/labels/rating/dirs/cardMeta/stats/report/
  │     搜索链 search*+resultMerge+searchCache/子分类 bookKind+musicKind+searchTypeSel/
  │     进度 bookProgress+readingProgress+pdfProgress+epubParse+txtParse+bookmark+highlight/
  │     翻译 translate+aiSummary/源注册 sourceRegistry/追更 tracking+updateCheck+episodeScan/
  │     界面辅助 menuPlacement+mediaFileUrl+virtualWindow+bulkConfirm+dailyLog+activityFeed 等，
  │     逐一有对应 tests/）
  └── data/types.ts（MediaEntry / EntryType：movie|tv|anime|book|game|music；BookKind：book|novel|comic；MusicKind：music）
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
  书籍      → Douban 主源 + Open Library（Google Books 可选加入）；文学/网文同链，仅落库 bookKind 不同
  漫画      → Douban 主源 + Bangumi（subjectType=1 书籍类目）+ MangaDex；缺 Bangumi Token 时静默降级
  游戏      → Douban 单源（+ Steam 补充源，默认关）
  音乐      → Douban + MusicBrainz + iTunes 满链
  影视      → TMDB + Douban 并行 → mergeBySource/sortByRelevance 按相似度排序
  动画      → Bangumi + Douban 并行
  → 候选列表（豆瓣前 3 条已预补详情）→ 用户选择（豆瓣封面下载到本地）
  → 按命中源切换表单 UI（douban/tmdb/bangumi）→ 保存
```

> **#444e / 2026-09-30 起「漫画」源链组加回**：`SourceGroup` **六组** = `book | comic | game | music | movieTv | anime`；漫画**独立成组**（主源豆瓣 + Bangumi 书籍类目 + MangaDex），Bangumi 同时服务 `anime` 与 `comic`。⚠️ comic 不是 `EntryType`（是 book 的 `bookKind` 子类），路由走 `sourceGroupForBookKind`（⛔ 不改 `sourceGroupForType`）。

### 🔴 数据源口径（唯一真源 = `src/pure/sourceRegistry.ts` 的 `PROVIDERS`）

**12 个源全部在册**：`douban` / `tmdb` / `bangumi` / `openLibrary` / `googleBooks` / `steam` / `musicbrainz` / `itunes` / `omdb` / `anilist` / `igdb` / `mangadex`。

- ⛔ **「已移除 Open Library / Google Books / RAWG」是错的**：`openLibrary`、`googleBooks` **都在注册表里**，只是**默认链里关着**（用户可在设置页加入）；**`RAWG` 从未注册过**（历史上提过、没落地 —— `services/resultTypes.ts` 里那句「RAWG 时代遗留形状」说的是**类型形状**的来历，不是说该服务还在或曾注册）。
- **默认链**（`DEFAULT_CHAINS`）：book = `douban + openLibrary`｜comic = `douban + bangumi + mangadex`｜game = `douban + steam`｜music = `douban + musicbrainz + itunes`｜movieTv = `douban + tmdb`｜anime = `douban + bangumi`。
- 🔴 **凡涉源清单**（文档、UI 文案、测试、断言）**一律以 `PROVIDERS` 为准去 grep / 遍历**，⛔ 别信云备忘、旧 CHANGELOG、或本文件上方依赖图里那份手抄名（那份只为便于阅读，抄漏过）。
