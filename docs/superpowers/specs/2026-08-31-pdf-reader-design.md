# 书籍 PDF 阅读器设计（v0.6 主打方向）

> 日期：2026-08-31 | 状态：设计待确认 | 范围：ReelLudic 书籍库新增 PDF 阅读（连续滚动 + 首版含摘抄 + 目录与缩放）
>
> **决策（用户已确认）**：阅读形态 = **连续滚动**（与 TXT/EPUB 一致）；摘抄 = **首版即含**（text layer 选中回写）；目录 + 缩放 = **都要**（PDF outline 目录侧栏 + 缩放 ±）。

## 背景与目标

书籍阅读器（#142~#151）已支持 TXT / EPUB 两格式（弹窗渲染 + 目录侧栏 + 字号/行距 ± + 进度持久化 + 摘抄回写书签）。#142 明确「PDF 后置（未做）」——本轮补上，形成 TXT/EPUB/PDF 三格式闭环。

**关键选型事实**：Obsidian 基于 Electron 但**禁用了 Chromium 内置 PDF viewer**，PDF 必须自渲染。标准方案 = **pdfjs-dist**（Mozilla 官方，obsidian-pdf-plus 等同类插件同款）。

## 澄清结论（用户已确认）

| 维度 | 决定 |
|---|---|
| 阅读形态 | **连续滚动**：PDF 逐页 canvas 纵向排布，滚动连续阅读，体验与 TXT/EPUB 对齐；进度 = 页码 + 容器滚动比例 |
| 摘抄 | **首版即含**：textLayer 覆盖 canvas 可选中文本 → 复用 ReaderExcerptModal 管道回写「## 摘抄」+ 书签 tab |
| 目录 | PDF `getOutline()` 提取 outline 渲染侧栏（同 EPUB 样式），点击跳转目标页 |
| 缩放 | 工具栏缩放 ±（pdf.js viewport scale，重渲染可见页） |

## 一、依赖与构建（需用户知悉的权衡）

| 项 | 方案 | 影响 |
|---|---|---|
| 依赖 | `pdfjs-dist`（^5.x，Mozilla 官方） | main.js **+~800KB~1MB**（1.15MB → ~2MB）；npm 依赖新增，无运行时外部请求（全部本地打包） |
| worker | **Blob 内联**：esbuild plugin 将 `pdf.worker.min.mjs` 读为字符串 → `URL.createObjectURL(new Blob([code]))` 注入 `GlobalWorkerOptions.workerSrc` | 保持**单文件产物**（main.js/styles.css/manifest.json 三件套不变，cmp 校验流程不变）——规避 `?url` 拷文件方案带来的第 4 产物与插件加载路径问题 |
| 兼容 | pdfjs-dist v5 为 ESM，esbuild 天然支持；target es2018 若与 v5 语法冲突则升 target 或引 legacy build | 构建期验证，失败回退 `pdfjs-dist/legacy/build/pdf.mjs` |

**替代方案（备选）**：主线程 fake-worker（不设 workerSrc，pdf.js 自动回退主线程）——实现最简但大 PDF 解析卡 UI，不推荐。

## 二、渲染架构（PdfReaderPanel）

```
PdfReaderModal（复用 ReaderModal 包装模式）
  └─ PdfReaderPanel（新增 src/modals/PdfReaderModal.ts 内）
       ├─ 工具栏：目录 ↕ | 缩放 −/+ | 批注开关 | 关闭
       ├─ 左目录侧栏：pdf.getOutline()（嵌套展开，同 EPUB tocCollapsed 交互）
       └─ 滚动容器（rl-pdf-scroll，连续滚动）
            ├─ 页容器按需渲染（视口虚拟化：只渲染可视 ± 缓冲页的 canvas）
            ├─ 每页：<canvas>（渲染）+ <div class="textLayer">（pdf.js TextLayer 覆盖，可选/摘抄）
            └─ 滚动监听（rAF 节流，复用 #151 经验）→ 进度保存
```

### 关键实现点

1. **页渲染虚拟化**：大 PDF（数百页）只渲染可视区 ±N 页 canvas（`IntersectionObserver` 或滚动计算），滚出视口销毁 canvas 释放内存（`page.cleanup()`），否则长文档内存暴涨。
2. **textLayer 摘抄**：每页 `TextLayer.render` 生成可选中文本层覆盖 canvas；mouseup 捕获选中文本（复用 EPUB iframe 内选中捕获经验）→ `onExcerpt(quote, pageIndex+1, loc)`；`annotateOn` 开关守卫（同 TXT/EPUB 批注开关语义）。
3. **目录跳转**：`pdf.getOutline()` → `pdf.getDestination(dest)` → `pdf.getPageIndex(ref)` → 滚动到目标页。
4. **缩放**：scale 0.5~3.0 步进 0.25；变更后仅重渲染可视页（viewport × scale），滚动位置按当前页锚定不跳动。
5. **进度映射**：`ReadingProgress` 复用——`chapterIndex` = 页码索引（0-based），`scrollRatio` = 容器滚动比例；`estimatePercent` 的 chapterSizes 用**每页等权 1**（PDF 页大小均匀，精确度足够）：`percent ≈ (pageIndex + ratio) / numPages`。
6. **加载**：`pdfjsLib.getDocument({ data: ArrayBuffer })`（不设 url，避免 file:// 受限）——main.ts `readPdf` 返回 ArrayBuffer。

## 三、文件级影响面

| # | 文件 | 改动 |
|---|------|------|
| 1 | `package.json` | 新增 `pdfjs-dist` 依赖 |
| 2 | `esbuild.config.mjs` | 新增 worker 内联 plugin（text loader → Blob 注入） |
| 3 | **新增** `src/modals/PdfReaderModal.ts` | `PdfReaderPanel` + `PdfReaderModal`（渲染/虚拟化/缩放/目录/进度/摘抄，对齐 EpubReaderPanel 接口） |
| 4 | `src/modals/ReaderModal.ts` | 导出 `PdfReaderModal`（或同文件新增，按体积决定） |
| 5 | `main.ts` | `openBookReader` 扩展名判断加 `pdf`；`openBookInternal` 加 pdf 分支（readPdf → PdfReaderModal）；新增 `readPdf(path): Promise<ArrayBuffer | null>`（vault 内 `adapter.readBinary` / 库外 `require('fs/promises').readFile` → ArrayBuffer，沿用 #145 教训）；`pickBookFilePath` 过滤加 pdf |
| 6 | `src/modals/EntryForm.svelte`（如涉） | 书籍文件选择器提示文案「txt/epub/pdf」（仅文案，先确认） |
| 7 | `styles.css` | `.rl-pdf-*` 系列（滚动容器 / 页间距 / textLayer / 目录复用 rl-toc 样式） |
| 8 | `tests/*` | 新增纯逻辑测试（见下） |

**不动**：`ReadingProgress` 模型、摘抄管道（ReaderExcerptModal / excerpt.ts / noteGenerator）、noteGenerator 书籍属性、`internalBookReader` 开关语义（默认外部打开不变，开启或非桌面才走内置）。

## 四、可单测纯逻辑（TDD 红→绿）

| 模块 | 测试点 |
|---|---|
| 新增 `src/pure/pdfProgress.ts` | `estimatePdfPercent(numPages, pageIndex, ratio)`（等权：`(pageIndex + ratio)/numPages`，边界 0/100/越界钳制）；`normalizePdfProgress` 复用 readingProgress |
| 新增 `src/pure/pdfOutline.ts`（如解析复杂） | outline 条目扁平化/嵌套规整（`{label, pageIndex, children}`）——若 pdf.getOutline 直接可用则此模块仅做防御性规整，用例覆盖空/单层/嵌套 |
| 回归 | readingProgress / excerpt 不动（复用），新增用例锁定 pdf 映射语义 |

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| pdfjs-dist v5 ESM 与 esbuild target es2018 冲突 | 构建期验证；失败升 target 或引 `legacy/build/pdf.mjs` |
| worker 内联体积（+~1MB） | 已确认可接受（单文件产物换取部署简单）；minify 已开 |
| 大 PDF 内存/卡顿 | 视口虚拟化 + page.cleanup() + rAF 节流（复用 #151 经验） |
| textLayer 摘抄选中在 Modal 容器内被 user-select:none 拦截 | 复用 #147 经验：`.rl-pdf-scroll { user-select: text }` |
| 加密/扫描版 PDF（无文本层） | 摘抄静默不可用，阅读不受影响；扫描版正常 canvas 显示 |
| 打开方式分流 | 遵循现有 `internalBookReader` 开关——默认外部打开，避免行为突变 |

## 六、执行顺序（TDD）

1. **T1 依赖与构建**：装 pdfjs-dist + esbuild worker plugin，验证产物单文件 + 体积确认
2. **T2 纯逻辑红→绿**：`pdfProgress.ts`（estimatePdfPercent）+ `pdfOutline.ts`（规整）+ 测试
3. **T3 PdfReaderPanel 基础**：加载 ArrayBuffer → 连续滚动渲染（虚拟化）+ 翻页/滚动进度保存
4. **T4 目录 + 缩放**：outline 侧栏跳转 + 缩放 ±（重渲染可视页）
5. **T5 摘抄**：textLayer 选中 → onExcerpt 管道 + 书签 tab（复用）
6. **T6 main 接线**：openBookReader pdf 分支 + readPdf + pickBookFilePath 扩展名
7. **T7 全量验证**：vitest → tsc+esbuild → 产物 grep（PdfReaderModal/estimatePdfPercent/worker Blob 在 main.js）→ sync_plugin.ps1 → cmp IDENTICAL → CHANGELOG + current-progress → 提交
