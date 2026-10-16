# 阅读数据存储重构：高亮出笔记 + 进度/书签/高亮合并为单一 JSON（设计文档）

> 日期：2026-09-18 ｜ 触发：用户指示「阅读器高亮数据不储存在笔记中，改另一种储存方式 json，还有阅读进度、书签、高亮都是 json 能不能合并在一起」
> 状态：**已实施**（2026-09-18 收口，见文末 §8；决策点 D-1 ~ D-8 全部按「我的倾向」档执行）｜ 对应内部记录见 `Project-Rule/CHANGELOG.md` 同日「存储架构重构」条

---

## 1. 目标

1. **高亮出笔记** —— 高亮数据不再写进书目笔记的 `## 高亮` 区，改存独立 JSON。
2. **三合一** —— 阅读进度、书签、高亮合并为**每本书一个 JSON 文件**。

明确不在本次范围内（需用户单独点名才动）：
- 摘抄（`## 摘抄`）是否一并出笔记 —— 见 **D-4**。
- 阅读数据存放目录是否搬家 —— 见 **D-2**。

---

## 2. 现状勘察

### 2.1 四项数据的落盘现状

| 数据 | 现位置 | 形态 | 写入方 | 读取方 |
|---|---|---|---|---|
| 阅读进度 | `{libraryDir}/阅读进度/{书名}-阅读进度-{id}.json` | `{chapterIndex, scrollRatio, updatedAt}` | `main.saveReadingProgress`（阅读器侧 300ms 尾随节流 + 关闭/翻章 flush） | `main.readReaderProgress`（打开阅读器时读一次） |
| 书签 | `{libraryDir}/阅读进度/{书名}-书签-{id}.json` | `ReaderBookmark[]` | `main.saveBookmarks`（增删/清空时） | `main.readBookmarks`（打开时读一次） |
| **高亮** | **书目笔记 markdown 的 `## 高亮` 区** | blockquote callout 块 + `^hl…` 块 id | `EntryService.addHighlight` / `deleteHighlight` / `deleteHighlightByQuote`（改写笔记 md） | `main.loadEntryHighlights` → `parseHighlightBlocks(笔记 md)`（打开时读一次） |
| 摘抄 | 笔记 `## 摘抄` 区 | 同上 | `EntryService.addExcerpt` / `deleteExcerpt` | `loadEntryExcerpts` |

### 2.2 阅读器侧接口（**关键：本次不必动**）

三个阅读器 modal（`TxtReaderModal` / `EpubReaderModal` / `PdfReaderModal`）通过 options 收数据，接口与存储形态**解耦**：

```ts
highlights?: ReaderHighlight[];                                  // 数据源（打开时注入）
onHighlight?: (quote, loc, style?, color?) => Promise<string|null>;  // 返回新块 id
onDeleteHighlight?: (blockId: string) => Promise<boolean>;
onSaveProgress: (p: { chapterIndex, scrollRatio }) => void;
onProgressPersist?: (percent: number) => void;                    // 写 catalog 的低频回调
```

⇒ **存储层换掉，阅读器内部逻辑几乎不用动**（只需改注释与数据来源）。改动集中在 `main.ts` 适配层 + 纯模块 + `EntryService`。

⚠️ 两个现有差异，设计时不能拍平：
- **PDF 阅读器没有高亮**（无 `highlights` / `onHighlight`）→ 合并后的 schema 对 PDF 而言 `highlights` 恒为空数组。
- **PDF 的 `chapterIndex` 是页码**（`onSaveProgress({chapterIndex: pageIndex, ...})`），TXT/EPUB 是章节序 → schema 沿用现有语义，不新增解释。

### 2.3 现结构暴露的三个真问题

**① 高亮寄生在笔记里 → 与「笔记模板重写」互相踩（2026-09-18 已出过事故）**
`EntryService.writeNote` 重写笔记时，全靠 `ANNOTATION_SECTIONS = ['高亮','摘抄']` + `extractAnnotationSections()` 把两个标注区原样搬回。漏一条就把整区吞掉 —— 当天实测：`## 高亮` 整区被吞，高亮块全丢，正文里还显示着却删不掉、双向溯源断链。**每新增一个标注区，都要同步这条搬运链路**（已立为项目红线）。高亮搬出笔记后，这条链路只剩摘抄一条，脆弱面减半。

**② 高亮写入依赖笔记存在，且污染笔记指纹（潜在 bug）**
- `addHighlight` 发现没笔记会先 `writeNote(id)` 生成一本 —— 只想高亮一句，库里凭空多一个笔记文件，并连带 `notePath` / `noteFingerprint` / 双写冲突检测全部卷进来。**高亮本质是阅读数据，不该有「必须先有一本笔记」的前置条件。**
- 🔴 **实证 bug**：`writeNote` 会把 `noteFingerprint = hashNoteContent(final)` 落库；但 `addHighlight` / `addExcerpt` 之后**只写文件、不更新指纹**。于是用户加过高亮/摘抄后，下次编辑该条目时 `noteWasExternallyModified()`（`EntryModal.ts:137`）会把**插件自己的写入误判成「外部修改」**，弹出「笔记被外部修改」的二选一弹窗。高亮搬出笔记后，这条触发源消失（摘抄仍在 → 若摘抄也搬走则彻底消除，见 D-4）。

**③ 数据分散且目录名错位**
进度与书签同在 `阅读进度/` 目录（「书签」放这里名字已经不对），高亮又在笔记里。同一本书的阅读数据要跨两处找；备份/同步要多想一步。

---

## 3. 金标准检索（同类开源实现的落盘形态）

| 项目 | 做法 | 对本项目的启示 |
|---|---|---|
| **KOReader**（最贴近的强先例） | 每本书一个 `.sdr` 伴生目录，**`metadata.epub.lua` 把「进度 + 高亮 + 书签 + 笔记」全放一个文件**；内存态 + 按需 flush。也支持集中存放变体（`docsettings` / `hashdocsettings`） | **「三合一、一书一文件」正是成熟阅读器的默认形态** —— 用户的直觉与金标准一致。同时说明「跟书走 vs 集中存放」是真实可选维度 |
| **Obsidian Side Comments**（社区插件） | 标注存 `.obsidian-side-comments/`，**每个 md 一个 sidecar JSON**（`files/` + `cache/` + **`backups/`**），**明确宣称「不修改笔记源文件」**（non-invasive） | 「不污染笔记」正是用户要的卖点；**`backups/` 值得借鉴**（高亮是不可再生的珍贵资产） |
| **Article Annotator**（社区插件） | 全部批注放插件目录下**单个 `annotations.json`**（全局一个文件） | 另一种「合并」读法：**全局单文件**（见方案 C）。同一事实：合并是主流取向，分歧只在粒度 |
| **MarkMind**（PDF 标注） | 默认 JSON `.annos`（与 PDF 同目录同名），备选 markdown；官方列出的取舍是：JSON = 紧凑/结构化/不占库/不可读/搜索弱，MD = 可读/可全文搜索/可 block 链接 | 与本项目「高亮在笔记里可读可链接 vs JSON 化后不可见」的取舍完全同构 → **这是必须让用户明知的代价**（D-3） |
| **Obsidian Annotator**（58 万下载） | 存本地 markdown 文件（blockquote + block reference），警告「别重命名源文件，否则丢关联」 | 反例警示：**与笔记强耦合的存储，一旦笔记/文件被外部改动就断链** |

**结论**：用户的诉求（出笔记 + 合并）落在主流做法上，KOReader 直接提供了「一本一文件、进度+书签+高亮+笔记同放」的成熟范本；社区插件则普遍强调**不污染笔记源文件**。真正的分歧点只有三个：**合并粒度**（一本一文件 / 全局一文件）、**存放位置**（跟库走 / 插件目录）、**笔记里那一段怎么办**。

---

## 4. 三个方案

### 方案 A（推荐）：一本一文件，三合一，留在现有目录

```
{libraryDir}/阅读进度/{书名}-阅读-{id}.json
```
```json
{
  "version": 1,
  "updatedAt": "2026-09-18T14:00:00.000Z",
  "progress":   { "chapterIndex": 3, "scrollRatio": 0.42, "updatedAt": "…" },
  "bookmarks":  [ { "id": "bm-…", "chapter": 3, "pct": 42, "quote": "…", "createdAt": 1 } ],
  "highlights": [ { "id": "hl-…", "quote": "…", "loc": { "chapter": 3, "pct": 42 },
                    "style": "hl", "color": "yellow", "createdAt": 1 } ]
}
```
- 与 KOReader 同构（一文件承载一本书的全部阅读状态）。
- 旧两文件（进度 / 书签）一次性合并进新文件；笔记 `## 高亮` 区解析后搬入。

### 方案 B（保守）：一本两文件 —— 进度独立，书签+高亮合并

```
{书名}-阅读进度-{id}.json      ← 保持现状（不搬）
{书名}-阅读标注-{id}.json      ← 书签 + 高亮
```
- 理由：**进度是「高频 + 极小」（滚动就一直写，约 80 字节），标注是「低频 + 可能很大」（几百条高亮几十 KB）**。合在一起会让每次滚动停下都重写整个标注数组（写放大 + 触发 Obsidian Sync / iCloud 的文件变更风暴）。
- 代价：没做到用户要的「三样合并成一个文件」。

### 方案 C：全局单文件（Article Annotator 式）

```
{libraryDir}/阅读数据.json     ← 全库所有书的进度 + 书签 + 高亮
```
- 真·「合并成一个文件」，多端同步/备份只需一个文件。
- 代价最大：文件随书量线性膨胀（几百本书 + 高亮可达数 MB）；**任意一次滚动写就要重写全库数据**；单文件损坏=全库阅读数据一起丢（风险集中）；与现有「一书一文件 + 可读文件名」结构冲突最彻底。

### 象形对比

```
现状                                 方案 A（推荐）
{库}/阅读进度/                        {库}/阅读进度/
  《书名》-阅读进度-e1.json   ← 80B     《书名》-阅读-e1.json   ← 一个文件装全
  《书名》-书签-e1.json      ← 2KB        { version, progress,
                                            bookmarks, highlights }
书目笔记.md
  ## 高亮   ← 高亮藏在这儿           书目笔记.md
  ## 摘抄                              ## 摘抄   ← 只剩摘抄
```

---

## 5. 推荐方案 A 的详细设计

### 5.1 数据模型

`src/pure/readerStore.ts`（新纯模块）：

```ts
export const READER_STORE_VERSION = 1;

export interface ReaderStore {
    version: number;
    updatedAt: string;                       // ISO
    progress: ReadingProgress;               // 复用现有类型
    bookmarks: ReaderBookmark[];             // 复用现有类型
    highlights: ReaderHighlight[];           // 复用现有类型（新增 createdAt? 可选）
}
```

不变量与容错（沿用本项目既有纪律）：
- **`normalizeStore(raw)` 是唯一入口**：坏 JSON / 缺字段 / 类型不符 → 逐段回退默认（progress 走 `normalizeProgress`、bookmarks 走现 `parseBookmarks` 逐项校验、highlights 逐项校验）。**白名单式归一**（现 `bookmark.ts` 的写法）。
- **`version` 只增不改**，未来新增字段走 append-only（项目红线）。
- 序列化输出稳定（字段顺序固定），便于人眼 diff 与断言。

### 5.2 文件名 / 路径

- `readerStoreFileName(entryId, title)` → `{sanitizeReaderTitle(title)}-阅读-{entryId}.json`
- `readerStoreFilePath(entryId, title, libraryDir)` → `{libraryDir}/阅读进度/{fileName}`
- 旧文件名函数（`progressFileName` / `bookmarksFileName`）**保留一个版本用于迁移读取**，迁移完成后删（不留死代码，符合项目惯例）。
- 旧格式（`e_xxx.json` / `e_xxx.bookmarks.json`）兜底读取保留至迁移收口。

### 5.3 写入策略（关键）

内存模型 + 合并落盘（KOReader 式）：

```
阅读器滚动 ──300ms 尾随──▶ main.onSaveProgress ──▶ cache.progress = p（内存）
                                                    │ dirty = true
                                                    ▼
                                        flush 定时器（1000ms 合并窗口）
                                                    ▼
                            一次写整个 {书名}-阅读-{id}.json
```
- **进度**：内存更新 + `FLUSH_MS = 1000` 合并窗口（最多 1 写/秒；相比现状 300ms 节流写，滚动期间的磁盘写入次数降到约 1/3）。
- **标注/书签增删、翻章、关闭阅读器**：**立即 flush**（低频且是用户明确动作，不能等）。
- 关闭/切换条目前 flush 一次，防丢最后一次滚动（对应现 `flushSave`）。
- 写失败静默（不打断阅读），下次 flush 重试。

### 5.4 迁移（一次性、幂等、非破坏）

`migrateReaderStoreToJson(entryId, title)`：

1. 新文件已存在（能解析出 `version`）→ **直接返回**（幂等）。
2. 读旧进度文件（含 `e_xxx.json` 旧名兜底）。
3. 读书签文件（含 `e_xxx.bookmarks.json` 兜底）。
4. 读笔记 `## 高亮` 区 → `parseHighlightBlocks()` → 高亮数组。
5. 合成 → 写新文件（`version: 1`）。
6. **旧文件与笔记 `## 高亮` 区按 D-3 / D-5 处置。**

触发时机（推荐 **懒迁移**）：打开某本书的阅读器时，若新文件不存在则先迁移 → 失败静默但**继续以空数据打开**（不阻断阅读）。理由：不动启动路径（不拖慢启动、不批量写盘）、单本书失败不影响他人。

### 5.5 迁移后「笔记里的高亮」怎么办（代价必须讲清）

高亮搬进 JSON 后，**Obsidian 里就看不到、搜不到、也反链不到这些高亮了**（MarkMind 官方列出的 JSON 格式代价，完全同构）。三种处置（D-3）：

| 处置 | 说明 | 代价 |
|---|---|---|
| **① 整区删除** | 迁移完成后把笔记里 `## 高亮` 区从 md 删掉（`ANNOTATION_SECTIONS` 收窄为 `['摘抄']`） | 笔记更干净；但历史高亮在 Obsidian 侧彻底不可见（JSON 里仍在） |
| **② 只读镜像**（推荐） | `## 高亮` 区保留，但改为**由 JSON 单向生成**（每次高亮变更后重写该区，标注「本区自动生成，修改会被覆盖」） | 保住 Obsidian 搜索/导出/反链；代价是每次高亮都要写笔记（写放大）且用户手改会被覆盖 |
| **③ 静态留存** | 迁移时保留原文、之后不再同步 | 无额外写入；但笔记里的高亮会**慢慢变成过期快照**，反而误导 |

### 5.6 改动面清单

| 文件 | 动作 |
|---|---|
| `src/pure/readerStore.ts` | **新增**：schema / `emptyStore` / `normalizeStore` / `serializeStore` / 文件名与路径 / 分段更新（`withProgress` / `withBookmarks` / `withHighlights`）/ `mergeLegacy` |
| `tests/readerStore.test.ts` | **新增**（TDD 先红）：归一容错、路径拼接、三源合并、幂等、version 处理 |
| `src/pure/readingProgress.ts` | 保留 `normalizeProgress` / `isProgressDeeper` / `estimatePercent`；文件名函数转为迁移期用 |
| `src/pure/bookmark.ts` | `parseBookmarks` 逻辑并入 `normalizeStore`（保留薄封装或删除，避免两套真源）；`newBookmark` 保留 |
| `src/pure/highlight.ts` | 保留类型 / 档位 / 颜色 / `markParagraphHtml` / `findQuoteSegment` / `hlMarkTargetOf` 等**渲染与判定**逻辑；`parseHighlightBlocks` / `renderHighlightBlock` / `HIGHLIGHT_SECTION` 迁入迁移模块或删除（按 D-3 定） |
| `src/pure/excerpt.ts` | `ANNOTATION_SECTIONS` 按 D-3 收窄 |
| `main.ts` | 四个 IO 方法（`readReaderProgress` / `saveReadingProgress` / `readBookmarks` / `saveBookmarks`）收敛为 `loadReaderStore` / `saveReaderStore`（含内存缓存 + 合并 flush）；`loadEntryHighlights` 改读 JSON；`addBookHighlight` / `deleteBookHighlight` / `onTrashSelection` / `onPurgeAnnotations` 高亮分支改走 store；新增迁移调用 |
| `src/services/EntryService.ts` | `addHighlight` / `deleteHighlight` / `deleteHighlightByQuote` 改写 store（不再写笔记）；`writeNote` 的标注区搬运按 D-3 调整 |
| 三个阅读器 modal | **仅改注释与数据来源说明**（options 接口不变）；PDF 侧 `highlights` 恒空 |
| 文档 | `Project-Rule` 存储说明 / CHANGELOG / 项目记忆（**记忆里「高亮在笔记 `## 高亮` 区」这条要整体重写**） |

### 5.7 需要新增/改判的断言

- 不得再出现「高亮写笔记」的调用形态（`appendExcerptToNote(…, HIGHLIGHT_SECTION)` 归零）。
- 新模块符号齐（`normalizeStore` / `serializeStore` / `readerStoreFilePath`）。
- 合并写入路径存在（`version` 字段 + 三段 schema）。
- 迁移函数存在且幂等（形态锚，不锚裸标识符 —— 本轮教训）。
- 旧的 `-阅读进度-` / `-书签-` 文件名拼接**仍存在**（迁移期读取用）→ 迁移收口后再改判为「不得回潮」。

---

## 6. 风险与不变量

| 风险 | 应对 |
|---|---|
| **迁移丢数据**（不可再生资产：高亮/书签） | 迁移前先写新文件、成功后才动旧文件；旧文件默认保留（D-5）；写失败静默且不删任何东西 |
| **写放大**（进度高频写带动整个文件重写） | 1000ms 合并窗口 + 内存态；标注变更才立即写 |
| 高亮在 Obsidian 侧不可见 | D-3 的三种处置，由用户选 |
| 阅读器接口被误改 | options 类型**保持不变**，只换数据来源；断言钉住 `onHighlight` 等签名形态 |
| PDF 无高亮 | schema 允许空数组，不因 PDF 特化 |
| 现有双写冲突误报 | 高亮出笔记后少一条触发源；若 D-4 选「摘抄也迁出」则彻底消除（另需修 `addExcerpt` 的指纹刷新） |

---

## 7. 待裁定决策点

| # | 问题 | 我的倾向 |
|---|---|---|
| **D-1** | 合并粒度：A 一本一文件（三合一）/ B 进度独立（两文件）/ C 全局单文件 | **A**（合你的诉求，且是 KOReader 的成熟形态；B 只在「写放大」受不了时退守） |
| **D-2** | 存放位置：留在 `{库}/阅读进度/` / 移到插件目录 `.obsidian/…`（库里不显眼） | **留在原目录**（迁移面最小；你的库备份=阅读数据一起备份） |
| **D-3** | 笔记里的 `## 高亮` 区：① 整区删除 / ② 只读镜像（JSON→笔记 单向生成）/ ③ 静态留存 | **②**（保住 Obsidian 搜索/导出；但若你更在意「笔记零污染」则选 ①） |
| **D-4** | 摘抄要不要一起出笔记？（你没提，但它与高亮同构、且是同一处双写冲突源） | **本次不动**（只做你点名的三样；摘抄另立一轮，避免一次改太大） |
| **D-5** | 旧文件处置：迁移后删除 / 保留（`.bak` 或原位） | **保留原位一个版本**（高亮不可再生，宁可留冗余），下一轮再清 |
| **D-6** | 迁移时机：打开该书时懒迁移 / 启动时全库批量 / 设置页放个手动按钮 | **懒迁移**（不动启动路径、单本失败不波及全库）；可另在设置页放手动按钮兜底 |
| **D-7** | 目录名 `阅读进度/` 现在装的是「进度+书签+高亮」，名不副实 | **暂不改名**（改名=又一次全库文件搬家；要改就与 D-2 合并成同一轮） |
| **D-8** | 是否需要 `backups/`（借鉴 Side Comments）：每次 flush 前留一份上一版？ | **先不做**（JSON 体积小、有 Obsidian 自身文件恢复；若你要更稳可加，代价是目录里多一堆文件） |

---

## 8. 实施状态（2026-09-18 收口）

用户「按你倾向来」＝ D-1~D-8 **全部取上表「我的倾向」列**，无一项改判。

| 交付面 | 落地形态 |
|---|---|
| 纯模块 | 新增 `src/pure/readerStore.ts`（schema / 归一 / 序列化 / 路径 / 分段更新 / 迁移合并），TDD **19 用例** |
| 单一真源提取 | `bookmark.normalizeBookmarks`、`highlight.normalizeHighlights`（旧解析端、JSON 读取端、迁移端共用） |
| 存储门面 | `main.ts`：`readerStores` 内存态 + `readerStoreLoads` 载入去重 + `ensureReaderStore` / `loadOrMigrateReaderStore` / `readLegacyReaderData` / `writeReaderStoreFile` / `flushReaderStore` / `saveReaderProgress` / `saveReaderBookmarks` / `syncHighlightMirror` / `removeReaderHighlights`；`onunload` 统一 flush |
| 写入策略（§5.3） | 进度 = 内存态 + `READER_STORE_FLUSH_MS = 1000` 合并窗口；书签 / 高亮 / 切章 / 关阅读器 / 卸载 = 立即落盘 |
| 迁移（§5.4） | 首次打开该书时懒迁移（旧进度 + 旧书签 + 笔记 `## 高亮` 三源 → `mergeLegacyStore`）；**给历史无 id 高亮补 `generateBlockId('hl')`**；**旧文件保留原位不删**（D-5） |
| 笔记侧（§5.5） | `renderHighlightMirror` 单向生成「## 高亮」区（首行 `%% … 自动生成 … %%` 提示）；`EntryService.syncHighlightMirror` 取代 `addHighlight` / `deleteHighlight` / `deleteHighlightByQuote`；`replaceAnnotationSection` 整区重写（幂等、无变化不写盘） |
| 🔴 附加修复 | 写镜像后**刷新 `noteFingerprint`** —— 否则用户加过高亮后下次编辑该条会被误判「笔记被外部修改」（原方案 §2.3 ② 记录的实证 bug，本次一并消除该触发源） |
| 未动 | 摘抄（D-4）、目录名（D-7）、backups（D-8）、阅读器 options 接口（§2.2 预判成立，只改注释与两条用户文案） |

验证：tsc 0；构建 87 告警（基线）；全量单测 **1424/1424（86 文件）**；产物断言 **1006 PASS / 0 FAIL / CRASH=false**；突变 6/6 全抓；三产物 md5 三方一致（main.js `27edfc53dccab9826adc14f81643218d`）已部署测试库。

**遗留（下一轮）**：旧进度 / 旧书签文件在迁移后仍在库内（D-5 保留一个版本）→ 待用户上手确认无碍后清理；`progressFileName` / `bookmarksFileName` 在迁移期仍需保留（产物断言已钉住，收口后才可删）。
