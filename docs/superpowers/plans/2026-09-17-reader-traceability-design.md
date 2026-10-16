# 阅读器双向溯源（摘录 / 高亮 ⇄ 原文）技术方案

> 状态：**待用户裁定**（三方案 + 4 个决策点）
> 日期：2026-09-17
> 关联：`2026-09-03-reader-readest-batch1.md`（阅读器三件）、`2026-09-14-1.0.4-plan.md`
> 前置约定：本方案**不改 schema、不改 JSON 数据**，只动「笔记正文锚点」与阅读器渲染层。

---

## 0. 需求

把三个阅读器（TXT / EPUB / PDF）的「摘录 → 元数据注入 → 索引扫描 → 高亮回显 → 回跳原文」链路打通成闭环，覆盖三类对象（书签 / 高亮 / 摘抄）。

对既有成果的定位：**这条链路在 TXT 上已经闭环，EPUB 处于「能写能显、定位靠猜」的半程，PDF 处于「只能读、只能摘、无高亮」的起步态**。

---

## 1. 金标准开源参考（已检索核实）

### 1.1 核实结论

| 清单里的项 | 核实结果 | 说明 |
| --- | --- | --- |
| `RyotaUshio/obsidian-pdf-plus` | ✅ 真实，**确为 PDF 域金标准** | 被 Obsidian 官方年度插件提名；用 `monkey-around` 补丁**原生**查看器（不替换）；三层索引 `PDFBacklinkIndex → PDFPageBacklinkIndex → PDFBacklinkCache`；链接参数族 `&page=&selection=beginIndex,beginOffset,endIndex,endOffset&color=`；直写 PDF 走 `pdf-lib`（Cantoo Scribe fork） |
| `zhuzhige123/obsidian-weave-reader`（"Weave EPUB Reader"） | ✅ 真实，**但清单把引擎写错了** | 不是 `epub.js` 而是 **foliate-js**；Svelte 架构；`obsidian://weave-loc` deep link；`EpubBacklinkHighlightService` 扫 vault 把笔记摘录**回显进阅读器**；`NavigationHub` 以 intent 承载跳转；双向溯源属其付费档 |
| `epub-reader-highlighter`（官方市场） | ✅ 真实，**锚点设计最值得抄** | 每书一个 JSON；**双锚 = CFI + 章内文本位置**；markup 变动（换机器、邻座高亮被删）时用**文本锚找回段落并修复 CFI**；epub 文件被换掉则整份存档为 `previous` 而不是错画 |
| `AdolDev40/obsidian-epub-plugin` | ✅ 真实 | PDF++ 风格界面；deep link `obsidian://epub-highlight?vault=&file=&cfi=`；导出模板带 `{{highlight.cfi}}` |
| `AXL Light` | ✅ 真实（作者 Epiphany Xiao） | 非侵入：批注存 `.obsidian-annotations/`（`index.json` + `notes/` + `__reading__/*.json`），Markdown 与 PDF 都支持 |
| `FloatMark` | ✅ 真实（`wanghuan9/obsidian-float-mark`） | sidecar `.obsidian-float-marks/`；**锚点重定位**：偏移 + 上下文 + 选中文本三要素 |
| `pdf-lib` / `Pdf Annotator`（插件） | ✅ 真实 | 直写 PDF 注释；PDF++ README 明确其「需 Obsidian 的 pdf.js 升到 4.x」 |
| **`ElasticPDF`** | ❌ **检索不到** | 疑为虚构项 |
| **`annotpdf` / `pdfAnnotate` 库** | ❌ **检索不到确切仓库** | 真实存在的是 `pdf-lib`；写注释另见 `Pdf Annotator` 插件 |
| **"Highlights to Obsidian（Calibre）"** | ⚠️ 未核实 | 本次不涉及（属外部导入，非双向溯源） |
| `obsidian-weread-plugin` / `obsidian-kindle-plugin` | ✅ 真实（常识性确认） | 元数据注入 / 模板化 / 增量同步——本次不涉及 |

**另检索到清单遗漏但更贴我们场景的三个：**

| 参考 | 为什么重要 |
| --- | --- |
| **Nutrient（PSPDFKit）《How to build text highlight annotations with PDF.js》** | 把 PDF 高亮拆成**五步法**：`pointerup` 抓 selection → `.page[data-page-number]` 定页 → `range.getClientRects()` 减页容器 rect → `viewport.convertToPdfPoint(x,y)` 转**与缩放无关的 PDF 坐标** → 渲染 div overlay。是我们自渲染方案的直接施工图 |
| **`agentcooper/react-pdf-highlighter`** | 成熟的 `ScaledPosition`（归一化坐标）+ `scaledToViewport()` / `viewportToScaled()` 双向换算 + 按页分组的 `HighlightLayer`，证明「归一化 rect 数组」就是业界标准锚点 |
| **`sona-gj/pdf-highlighter`** | quote 文本 → 精确 rect 的算法：遍历文本层 DOM 建「虚拟页字符串 + 字符索引 → {node, offset} 映射」，命中后 `new Range()` + `getClientRects()` 取真实矩形；用 `MutationObserver` 在文本层渲染完成/重排（缩放）后重算 |

### 1.2 四个可直接迁移的机制

1. **双锚 + 修复**（来自 epub-reader-highlighter）：主锚（精确位置）失效时，用**文本锚**（quote 归一化后匹配）找回并**回写修正主锚**。这是「抗排版漂移」的关键，且天然可纯函数化。
2. **三层索引 + 响应式重建**（来自 PDF++）：文件级 → 页/章级 → 条目缓存；监听 Obsidian `metadataCache` 的 `changed` / `deleted` 与 `vault.rename`，把索引与笔记真源保持同步。
3. **归一化坐标 + Range 取矩形**（Nutrient / react-pdf-highlighter）：写入时存**与缩放无关**的 rect（PDF 坐标或页内比例），显示时按当前 scale 换算；由 `Range.getClientRects()` 反推而非估算字符宽度。
4. **纯 Markdown 真源**（PDF++ 哲学）：批注本体写在笔记里，插件停用也不丢。我们已经在这么做，方案里**不能退化成 sidecar-only**。

---

## 2. ReelLudic 现状盘点

### 2.1 五段链路 × 三格式

| 链路 | TXT | EPUB | PDF |
| --- | --- | --- | --- |
| ① 摘录/高亮**写入** | ✅ 完整（摘抄 + 高亮 + 书签） | ✅ 完整（摘抄 + 高亮 + 书签） | ⚠️ **仅摘抄**（`PdfReaderModal` 菜单明确「PDF 无书签/翻译/高亮」） |
| ② 元数据**注入** | ✅ `highlights` / `excerpts` / `bookmarks` 三项全给 | ✅ 同上三项全给 | ❌ 只给 `excerpts`（`main.ts:2701-2708`） |
| ③ **索引扫描** | ⚠️ 只读当前条目笔记一次（`loadEntryHighlights` / `loadEntryExcerpts`，`main.ts:2554-2556`） | ⚠️ 同 TXT | ❌ 无 |
| ④ 高亮**回显**（打开书即见标注） | ✅ 页内 `<mark>` 渲染 | ✅ 按章渲染（`currentChapterHighlights`） | ❌ 无渲染层 |
| ⑤ **回跳**原文 | ✅ 借 `pendingRatio` + `pendingQuote` 章内比例 + 文本查找 | ✅ 同 TXT（`pendingRatio` / `pendingQuote`） | ⚠️ `jumpExcerpt`：`loc.chapter-1` 当页码 + 页内比例 + textLayer 内文本高亮 |

### 2.2 锚点模型现状

笔记里与阅读器里**只有一套锚点**：

```ts
// pure/highlight.ts:89  ReaderHighlight
{ quote: string; id?: string; loc?: { chapter: number; pct: number }; style?; color? }
// pure/bookmark.ts      ReaderBookmark
{ id: string; chapter: number; pct: number; quote?: string; note?: string; createdAt: number }
// pure/excerpt.ts       ParsedExcerpt
{ quote; page?; note?; id?; loc?: { chapter; pct }; style?; color?; label?; refLink? }
```

即 **`章/页序号 + 章内百分比 + quote 文本`**。没有 CFI、没有字符偏移、没有坐标。`pct` 的计算方式（`currentPageRatio` / 滚动比例）意味着**换字号、换窗口宽度、换设备都会漂**。

### 2.3 四处断链点（本方案的靶子）

| # | 断链 | 事实依据 | 后果 |
| --- | --- | --- | --- |
| **D1** | **笔记里点摘录头行链接进不了阅读器** | `main.ts` 全文**无** `registerObsidianProtocolHandler`，**无** `registerExtensions` | 头行 `[[书籍/活着.txt#^bk…\|第 6 章 · 19%]]` 点击后：Obsidian 不认识 `.txt`/`.epub` 扩展名 → 打不开或当作未解析链接。**「笔记 → 原文」这一向目前是断的**，只能先手动开书再点侧栏条目 |
| **D2** | **PDF 无高亮** | `PdfReaderModal` 无 `onHighlight` 注入、无渲染层；菜单注释「PDF 无书签/翻译/高亮」 | 用户清单里优先级最高的一项，且是唯一「完全缺失」的 |
| **D3** | **定位精度不足** | `jumpExcerpt` / `jumpHighlight` 依赖 `pct` 粗定位 + quote 文本在**当前章全文**里查找 | 排版一变（字号/窗宽）→ pct 漂；同章重复文本 → 命中错处。没有「找回 + 修正」机制（epub-reader-highlighter 的双锚就是治这个） |
| **D4** | **索引只扫当前笔记** | `openBookInternal` 打开时读一次本条目笔记 | 摘录分散在多篇笔记时无法回显（PDF++ 是扫全库 backlink）。当前「一本书 = 一篇笔记」的设计下不致命，列为二期 |

---

## 3. 三个可选方案

三者的分歧点在**锚点怎么存、回跳怎么走**，不在功能目标。

### 方案 A —— 最小闭环：链接拦截 + 文本副锚 + PDF overlay

**做法**

- **回跳（治 D1）**：注册 document **捕获阶段** `click` 监听，识别 `<a class="internal-link">` 的 `data-href` → 拆出 `{ 文件路径, #^id }` → 由文件路径反查条目 → 打开对应阅读器 + 注入 `pendingTarget: { id }` → 阅读器 `mount` 后走既有 `jumpHighlight` / `jumpExcerpt`。
  - 保留 `[[…]]` wikilink 形态 → **不动笔记格式、保住反向链接面板与关系图谱**。
  - 参数零编码：块 id 本身就是参数，明细从已注入的 `highlights` / `excerpts` 里按 id 查。
- **精度（治 D3）**：`pct` 降级为**粗定位提示**，真定位走新增纯函数 `locateByQuote(章全文, quote, hintPct) → offset | -1`（NFKC 归一 + 折叠空白 + 在提示位置附近开窗搜索，失败则全章搜索）。**定位成功后不写回笔记**（笔记格式零改动）。
- **PDF 高亮（治 D2）**：照 Nutrient 五步法在 `PdfReaderModal` 加 `.rl-pdf-hl-layer`（页面 div 内绝对定位，与 textLayer 同坐标系）。
  - 写入：`pointerup` → `.page[data-page-number]` → `range.getClientRects()` 减页 rect → `viewport.convertToPdfPoint()` → 存**归一化 rect 数组** + **页内字符偏移**（跨页选区拆成每页一段）。
  - 回显：复用 §1.2-4 的算法——把 PDF 高亮的 `quote` 在页内文本层做 Range 搜索 → `getClientRects()` 画矩形。**所以坐标不必进笔记**（见决策点 D-2）。
- **索引（暂不治 D4）**：沿用「打开时读本条目笔记」。

**代价**：零新依赖（`pdfjs-dist` 已在）、不改笔记格式、不碰 schema。新增纯模块 `pure/anchor.ts`（定位算法）+ `pure/pdfAnchor.ts`（坐标换算，可纯函数测）。
**风险**：捕获阶段拦截可能与其他插件（PDF++、Better Search Views）的链接处理顺序冲突——需要实测；`pct` 在极端排版下仍可能粗定位偏一代。

### 方案 B —— 标准锚点：CFI + PDF 归一化坐标进笔记

**做法**

- EPUB 引入 **CFI**（`epubcfi.js` 或 foliate-js 的 CFI 工具），PDF 引入**页码 + 归一化 rect + 滚动哈希指纹**（PDF++ 口径），TXT 引入**章内字符偏移**。
- 锚点**写进笔记**（头行标签尾段或隐藏注释 `%%rl-anchor:{…}%%`），回跳由 `obsidian://` 协议 handler 承载（`obsidian://reelludic?entry=…&cfi=…`）。
- 索引（治 D4）：借 `app.metadataCache.getBacklinksForFile()` 做全库 backlink 扫描 + 三层索引。

**代价**：新依赖（CFI 库，影响产物体积）、三套锚点模型并存、笔记里出现长参数串、PDF 坐标转换与哈希指纹是最硬的骨头。
**收益**：精度最高；CFI 是国际标准，能**与外部生态互通**（从 Weave / AdolDev 系插件导出的 CFI 链接可直接用）。
**风险**：改动面最大，与「最小改动」取向冲突；`obsidian://` 裸链接会**丢反向链接图谱**（除非双写）。

### 方案 C —— sidecar 索引：笔记只留短链，锚点外置

**做法**：笔记里保持 `^bk…` / `^hl…` 短 id，锚点明细（CFI / rect / offset / 指纹）存 `.reelludic/anchors/{entryId}.json`（仿 AXL Light / FloatMark）。回跳时按 id 查 sidecar。

**代价**：数据**两处真源**（笔记 + sidecar），删块 / 改名 / 重装插件都要同步 → 正是项目 MEMORY 里记的「孤儿」问题；插件卸载后链接失效，**违反纯 Markdown 哲学**。
**收益**：笔记干净；锚点算法可以随时升级（不用再改笔记），一份数据可存多套锚。

### 3.1 三方案对比

| 维度 | A 最小闭环 | B 标准锚点 | C sidecar |
| --- | --- | --- | --- |
| 笔记格式改动 | **零** | 大（长参数/隐藏注释） | 零 |
| 新依赖 | 零 | CFI 库（+体积） | 零 |
| 治 D1 回跳 | ✅ | ✅（协议链接） | ✅ |
| 治 D2 PDF 高亮 | ✅ | ✅ | ✅ |
| 治 D3 精度 | ✅ 文本副锚 | ✅✅ 标准锚 + 指纹 | ✅ 可多套锚 |
| 治 D4 全库索引 | ❌（二期） | ✅ | ✅ |
| 反向链接图谱 | **保住** | 裸链接会丢 | 保住 |
| 纯 Markdown 哲学 | ✅ | ✅ | ❌ |
| 实现成本 | 低 | 高 | 中 |
| 与外部生态互通 | ❌ | ✅ | ❌ |

### 3.2 为什么不采用 PDF++ 的核心做法

PDF++ 的立身之本是**补丁 Obsidian 原生 PDF 查看器**（`monkey-around` 打 `PDFViewerChild` / `ObsidianViewer` 等私有 API）。
ReelLudic 的 `PdfReaderModal` 是**自渲染**（`pdfjs-dist` 直接 `renderPage`），两个体系的 DOM 结构与生命周期完全不同；且 PDF++ 自己在 README 里明说「依赖大量 Obsidian 私有 API，Obsidian 升级时打碎的风险较高」。
**结论：抄它的索引与参数设计，不抄它的补丁方式。** 同理，我们**不应该**为 PDF 注册 `registerExtensions(['pdf'])` —— 那会抢走 Obsidian 原生查看器（PDF++ 刻意避开的事）。

---

## 4. 模块规划

推荐路线：**A 打底（M0–M3 即闭环），B 的两件（CFI、全库索引）作为 M4–M5 二期增量**。

### M0 锚点纯模块（TDD 主战场，无 UI）

| 项 | 内容 |
| --- | --- |
| 新增 | `src/pure/anchor.ts`、`src/pure/pdfAnchor.ts` + 同位测试 |
| `anchor.ts` | `normalizeQuote(s)`（NFKC + 折叠空白 + 破折号/引号归一）、`locateByQuote(章文本, quote, hintPct?) → offset \| -1`（开窗 + 滑动，返回首个命中）、`quoteHash(s)` |
| `pdfAnchor.ts` | `toPdfRects(clientRects, pageRect, viewport)` / `toViewRects(pdfRects, viewport)` / `splitRectsByPage(...)`（跨页选区拆分） |
| 测试 | 换字号/重复文本/部分选区/跨页选区/归一化等价（全角空白、`——`、`“”`）、命中不到时返回 -1 |
| 验收 | 纯函数 100% 可测；不引 obsidian 依赖 |

### M1 回跳闭环（治 D1，含 UI）

| 项 | 内容 |
| --- | --- |
| 改动 | `main.ts` 新增链接点击拦截 + `pendingTarget` 传递；`ReaderViews.ts` 三个 View 的 options 加 `pendingTarget?`；三个 Modal 在 `mount` 末消费 |
| 反查 | `路径 → MediaEntry`（复用既有的文件路径索引思路，若缺则新增小映射）|
| 兜底 | 反查不到条目 → 不拦截，交回 Obsidian 默认行为（避免吞掉用户正常的 md 链接点击）|
| 验收 | 笔记里点摘录头行链接 → 阅读器打开并停在那句话上；点普通 md 链接不受影响 |

### M2 精度升级（治 D3）

| 项 | 内容 |
| --- | --- |
| 改动 | `jumpHighlight` / `jumpExcerpt` / 书签跳转统一走 M0 的 `locateByQuote`：先 `pct` 粗滚 → 再按 offset 精滚 → 再画高亮 |
| 不写回 | 定位结果**不回写笔记**（保持笔记零改动）；若实测错跳率仍高，再议「笔记内隐藏锚」 |
| 验收 | 改字号 / 改窗宽 / 关掉重开后再回跳，仍然命中同一句 |

### M3 PDF 高亮（治 D2，工作量最大）

| 项 | 内容 |
| --- | --- |
| 写入 | `PdfReaderModal` 新增贴 `onHighlight` 注入 + 菜单「🖍 高亮」；选区 → 归一化 rect + 页内偏移 → 走既有 `addBookHighlight` 通道 |
| 回显 | 页 div 内新增 `.rl-pdf-hl-layer`；每页渲染完成后对已注入高亮做 quote 搜索 → Range → rect → 画 div；缩放/重渲染后重算 |
| 侧栏 | 「摘抄」pane 升级为「摘抄 + 高亮」两段（对齐 TXT/EPUB 的 pane 结构）|
| 书签 | 是否一并补 PDF 书签（现状全无）→ 决策点 D-3 |
| 验收 | PDF 划一句 → 笔记出高亮块 → 关闭重开 → 页面上仍是彩标；缩放后不错位 |

### M4（二期）EPUB 锚点升级为 CFI

`epubcfi.js` 生成 / 解析；笔记锚点与 CFI 双写；解析端新旧兼容。仅在「需要与外部生态互通」时才做。

### M5（二期）全库 backlink 索引（治 D4）

`app.metadataCache.getBacklinksForFile()` → 解析 subpath → 三层索引 → `metadataCache` 事件驱动重建（对齐 PDF++ 的 `changed` / `deleted` / `vault.rename` 三事件）。

### M6 文档与断言

双 CHANGELOG、进度表、UI-GUIDE（新渲染层样式口径）；`assert-symbols.cjs` + 突变脚本按本方案新增断言（链接拦截存在、PDF overlay 存在、`locateByQuote` 被三处调用等）。

---

## 5. 待裁定决策点

| # | 决策 | 选项 | 我的建议 |
| --- | --- | --- | --- |
| **D-1** | 路线选哪个 | A / B / C / A+B 分期 | **A 打底 + B 的具体机制（M4/M5）按需追加** |
| **D-2** | PDF 高亮的坐标要不要进笔记 | ① 不进（回显靠页内文本搜索）② 进（隐藏注释 `%%rl-anchor:…%%`）③ 进（head 标签尾段） | **①**：零格式改动，且 PDF 单页文本量小、搜索可靠；坐标只在「同一句话在页内出现多次」时才有必要 |
| **D-3** | 是否一并补 PDF 书签 | 是 / 否（只补高亮） | **否**：先把高亮这条最难的路走通，书签复用同一套锚点后是顺手的事 |
| **D-4** | 回跳时若书已打开 | ① 复用已打开的标签并定位 ② 另开新标签 | **①**：PDF++ 的实测经验是「同一文件不重复开标签」体验更好 |

---

## 6. 风险与明确不做的事

**风险**

1. **链接拦截的作用域**：捕获阶段拦截必须严格限定「目标是本插件管理的 txt/epub/pdf 文件」，否则会吞掉用户正常的笔记内跳转。
2. **`pct` 锚点的固有漂移**：M2 的文本副锚能治「找不回」，但治不了「同一段文字出现两次」（需靠 hintPct 开窗缩小范围）。
3. **PDF 缩放重绘**：虚拟化 + 分页渲染下 overlay 必须在 `renderPage` 完成后重算，否则缩放后会错位（`TxtReaderModal` 的 `flushSave` / `restoreScroll` 那套时序可以借鉴）。

**明确不做**

- ❌ 不注册 `registerExtensions(['pdf'])` 抢 Obsidian 原生 PDF 查看器。
- ❌ 不引入 `pdf-lib` 直写 PDF 文件（改了用户的原文件，且每次写都要重载查看器）。
- ❌ 不做 sidecar-only 锚点（保住纯 Markdown 真源）。
- ❌ 不在本方案里改任何 schema / JSON 结构。

---

## 附：对那张「书签 / 高亮 / 摘抄」三行表的回应

该表的判断与我们**已落地的口径基本一致**，只有一处需要澄清：

| 判断 | 我们的现状 | 说明 |
| --- | --- | --- |
| 三者都需回跳原文 | ✅ | 正是本方案 |
| 高亮需全文检索、书签不需 | ✅ | 回显靠文本锚，前提就是能搜 |
| 「是否需要独立存储」：书签 ❌ / 摘抄 ✅ | ⚠️ **现状相反** | 我们的**书签**存 sidecar JSON（`阅读进度/{书名}-书签-{id}.json`），**摘抄/高亮**真源在笔记。按「结构短小 → sidecar；长文本 + 需二次加工 → 笔记」这条口径看，现状是对的，建议后续文档按这条措辞写，别用「是否需要独立存储」这个提法 |
| 摘抄需二次加工、高亮可选 | ✅ | 与现有「想法 / 心得」输入框一致 |

---

## 7. 增量（2026-09-19）：笔记里的 `↩` 回跳 +「库外书」断点

> 状态：**已实施**（2026-09-19；用户裁定 **方案 A 双轨** + 覆盖口径「**只新块**」）
> 触发：用户「加摘抄双向溯源，笔记里的 `↩` 可以跳回原文摘抄位置」+ 提议自定义 URL Scheme（`myreader://`）

### 7.1 现状核查（实测，非推测）

- **M1（方案 A 的「链接拦截」）已实施**：`main.onWorkspaceAnchorClick`（document 捕获阶段）拦 `a[data-href]` 里的 `#^id` 块锚点 → `openBookAtAnchor` → `openBookInternal(entry, path, blockId)` → 注入 `pendingTargetId` → 阅读器 `consumePendingTarget()` 定位。**对「库内」书这条链是通的**（零新协议、零新依赖）。
- 🔴 **但有一个洞（用户本次踩到的）**：`excerptRefLink` 对**库外绝对路径**的书恒返回 `undefined` —— 因为 `vault.getAbstractFileByPath()` 对库外文件拿不到 `TFile`。于是头行不写 wikilink、块 id 掉到块尾，**头行没有任何可点区域 → 回跳断**。
  实测：条目 `百年孤独` 的 `bookFile = C:\Users\kest\Desktop\媒体库\书籍\百年孤独.epub`（媒体库在测试库之外）→ 笔记里就是 `> [!quote|yellow] 第 6 章 · 4%`（**无链接**）+ 块尾 `^bkmu5g97j1t5o0`。
- 即便有 wikilink，**可点区域的语义词是「第 6 章 · 4%」而不是「回到原文」** —— 用户看不出这里能点。

### 7.2 对「自定义 URL Scheme」提议的核实

| 提议 | 核实结果 |
| --- | --- |
| `myreader://…` 注册 **OS 级**协议 | ❌ **插件做不到**：`app.setAsDefaultProtocolClient` 是 Electron **主进程**能力，插件只跑在渲染进程；Obsidian 也不允许插件注册 `obsidian://` 之外的 scheme |
| 参数里带 `file` / `page` / `anchor` | ⚠️ 方向对，但**别用文件路径**：库外路径会随移动/改名失效，且库外文件在 Obsidian 里本就不可索引。改用 **entryId（条目 id）** |
| 「唤起阅读器并跳转」 | ✅ 生态金标准 = **`plugin.registerObsidianProtocolHandler('<id>', cb)`**，即 `obsidian://reelludic?…`（Bible Tools / Slurp 的用法；本方案 §1 检索到的 `obsidian://weave-loc`、`obsidian://epub-highlight?vault=&file=&cfi=` 同族）。**跨平台、零新依赖**，还能顺带支持「从浏览器 / 其他 app 唤起」 |

### 7.3 深链形态

统一：`obsidian://reelludic?action=jump&book=<entryId>&block=<blockId>`（`block` 即 `bk…` / `hl…`，阅读器 `consumePendingTarget` 已能消费 → **零新增定位逻辑**）。

- **方案 A（双轨，推荐）**：头行 = wikilink（保留）+ 追加 `↩` 深链 → **反链 / 图谱保住**，且库内库外都能点回（库外书只有 `↩` 可用，但**终于有入口了**）
- **方案 B（单轨）**：头行标签本身换成深链、不再写 wikilink → 更干净、库内库外统一，但**丢掉 Obsidian 反链 / 图谱索引**（§3.1 已标注「裸链接会丢」）

### 7.4 决策结果（2026-09-19 已裁定）

- **D-5** `↩` 的形态 → 按用户原话用 **`[↩]`**（纯符号）
- **D-6** 旧块迁移 → **不做**（用户选「只新块」；已有摘抄块保持原样，不追溯改写）
- **D-7** 高亮块 → **不加**（同上，镜像不传 `entryId`）
- **形态** → **方案 A（双轨）**：wikilink 保留 + 追加 `↩` 深链

### 7.5 实施结果（2026-09-19）

| 项 | 落点 |
| --- | --- |
| 纯模块 | `src/pure/readerLink.ts` —— `READER_DEEP_LINK_PREFIX` / `readerDeepLink`（缺参返 null）/ `parseReaderDeepLink`（host 严格比对 + `action==='jump'` + id 白名单 `/^[\w-]+$/`） |
| 渲染 | `renderExcerptBlock` 的 `ExcerptRenderOptions.entryId?` → 头行尾 `` [↩](…) ``；`block` 与块内 `^id` **同源** |
| 解析 | `parseExcerptBlock` 取 title 后先 `stripBackLink`（**只认本插件 scheme**） |
| 宿主 | `registerObsidianProtocolHandler('reelludic')` + `onWorkspaceAnchorClick` **先认深链再认块锚点** + `openDeepLinkTarget` |
| 写入 | `EntryService.addExcerpt` 传 `entryId: id`；`ExcerptModal` 预览同款（高亮镜像**不传**） |

验证：tsc 0 / 构建 87 告警（基线）/ 受影响单测 **246/246**（+18）/ 产物断言 **1065 PASS / 0 FAIL / CRASH=false**（+15，含 2 条反向守卫）/ **断言级突变 6/6 全抓** / 三产物 md5 三方一致 + 已部署测试库 / UI-GUIDE v51。

⚠️ **已知缺口（如实记录，未做）**：`consumePendingTarget` 只在 TXT / EPUB 实现 → **PDF 书点 `↩` 会打开阅读器但不定位**（属本文档 D2/D3 的未完项，不是本批引入的回归）。

### 7.6 实现要点（踩过的坑）

- 🔴 解析端要**先剥掉头行尾部的深链再解析 label**：`parseExcerptBlock` 在「头行无 wikilink」时会走 `label = title`，会把 `[↩](…)` 整段吃进标签。
- ✅ Obsidian **官方文档确认 callout 标题支持行内 markdown（含链接）** → `↩` 放头行是可点的（已核实 help/callouts 的 `[[Internal link|Wikilinks]]` 示例）。
- **双保险**：① 点击拦截（捕获阶段 `preventDefault` + `stopPropagation`）；② `registerObsidianProtocolHandler`（拦截失效时 Obsidian 会把 `obsidian://reelludic…` 路由到处理器，仍然能跳）。
- `↩` 只在**新写入**的块上出现（摘抄块一旦固化不再重写）→ D-6 就是治这个。
