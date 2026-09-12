# 阅读器性能 / 进度百分比 / 摘抄书签与双向溯源设计

> 日期：2026-08-31 | 状态：设计待确认 | 范围：ReelLudic 阅读器（TXT/EPUB）性能修复 + 剩余进度百分比 + 摘抄定位与书签目录 + 笔记↔原书双向溯源 + 设置页排版项迁移
>
> **2026-08-31 修订（用户指示）**：摘抄书签改为「目录 | 书签」双 tab 并排切换；**删除双向溯源**（笔记定位标记可点击跳原书、书签「↗ 开笔记」均移除）；点击书签仅跳回阅读器对应段落并高亮 2.5s。定位数据 `定位：N:N` 保留（书签跳转数据源）。

## 背景与目标

阅读器（#142~#150）已具备：TXT/EPUB 阅读弹窗、目录侧栏、字号 A±、滚动进度持久化（`阅读进度/{id}.json`）、摘录回写笔记「## 摘抄」区（带 ^id 锚点）。

本批次解决 6 个问题：

1. **阅读器滚动/翻章卡顿**（TXT/EPUB）
2. **阅读进度持久化打通**（阅读器进度 ↔ 书架进度条，当前脱节）
3. **剩余进度百分比估算**（阅读器内显示已读/剩余）
4. **原书摘抄段落持久化**（已实现，确认语义：摘抄存续以笔记为准）
5. **阅读器摘抄段落书签目录**（列出摘抄，点击跳原书）
6. **双向溯源**（笔记摘抄定位标记 ↔ 原书锚点跳转）

## 澄清结论（用户已确认）

| 维度 | 决定 |
|---|---|
| 删除条目语义 | **保持连带删除**（现状不变：删条目即删笔记即删摘抄；摘抄删除途径 = 删除笔记中的摘抄标记） |
| 字号/行距持久化 | **写回设置全局记住**（调整后写回 `readerFontSize`/`readerLineHeight`，下次打开任何书生效） |
| 卡顿修复范围 | **TXT 与 EPUB 都修** |

## 一、卡顿修复方案（根因已在代码确认）

| # | 根因 | 位置 | 修法 |
|---|---|---|---|
| 1 | 逐段 `createEl('p')`，上千段时每插入触发重排 | TXT `renderContent()` | **DocumentFragment 批量构建一次 append** |
| 2 | scroll 事件内同步读 `scrollHeight`（强制同步布局） | TXT `onScroll` / EPUB `onFrameScroll` | **rAF 节流**：滚动中只记 scrollTop，比例计算与保存延到 rAF 帧；容器高度 `resize` 时缓存 |
| 3 | 触底自动翻章在 scroll 事件内**同步重建整章 DOM / iframe srcdoc** | TXT/EPUB `onScroll` | **翻章延后**：scroll 内仅标记，`setTimeout(0)`/rAF 后执行 `switchChapter` |
| 4 | 每次切章 `getComputedStyle(document.body)` 触发主文档重排 | EPUB `buildFrameDoc` | 打开时缓存一次宿主字体/背景/颜色，切章复用 |
| 5 | **短章节触底无法自动翻章**：内容 + 底部 padding 不足一屏 → `max = scrollHeight - clientHeight ≤ 0` → `ratio` 恒 0，永远达不到 0.98 阈值（EPUB 章节文件短/版权页/插页，TXT 段落少的章节同样中招） | TXT/EPUB 触底判定 | 判定改为「滚动到底 **或** 内容不足一屏」：`atBottom = max <= 0 \|\| scrollTop >= max - 1`，且非最后一章才翻 |

## 二、进度百分比估算（pure 层，可单测）

### 算法

```
estimatePercent(chapterSizes: number[], chapterIndex: number, scrollRatio: number): number
  = (Σ sizes[0..ci-1] + sizes[ci] × ratio) / Σ sizes  × 100
```

- TXT 的 chapterSizes = 各章**段落数**（`chapterParagraphs(book, i).length`，精确）
- EPUB 的 chapterSizes = 各章**字符数**（unpackEpub 时 `fileMap[chapter].length`，估算）
- 边界：chapterIndex 越界 → 0；sizes 空 → 0；结果钳制 0-100；最后一章 ratio≈1 → 100

### 展示与落库

- 阅读器头部显示 `已读 34% · 剩余 66%`（实时估算，TXT/EPUB 面板通用）
- **percent 写回 catalog**：`MediaEntry.readingProgress` 扩展 `percent?: number`（schema 只增不改，normalizeEntry 透传）
  - 频率控制：滚动节流照旧写进度文件；**翻章/关闭（flushSave）时**才写回 catalog.percent（避免滚动中频繁写 catalog.json）
- 书架进度条 `readPct()` 优先读 `readingProgress.percent`，无则回退旧 `page/totalPage` 逻辑

## 三、摘抄定位格式（append-only）

### ParsedExcerpt 扩展

```ts
export interface ParsedExcerpt {
  quote: string;
  page?: number;
  note?: string;
  id?: string;
  /** 原书定位：chapter 从 1 计，pct 0-100 整数（TXT 段落比例 / EPUB 滚动比例） */
  loc?: { chapter: number; pct: number };
}
```

### 笔记格式（meta 行追加，旧摘抄不受影响）

```
改前：> 引用文本        **p.128** · 心得：xxx        ^bk001a
改后：> 引用文本        **p.128** · 心得：xxx · 定位：1:42        ^bk001a
```

- 存储用机器可读 `定位：{chapter}:{pct}`（1 基、冒号分隔），展示层转「第1章 · 42%」
- `parseExcerptBlock` 兼容：无定位 → `loc: undefined`；手写笔记带定位 → 可解析（笔记 ↔ 代码双向）
- 阅读器选中摘录保存时（ReaderExcerptModal onConfirm）自动携带当前 `chapterIndex + 滚动比例` 定位

## 四、摘抄书签目录（阅读器内）

- 打开阅读器时 main 读取笔记摘抄区 → `extractExcerptSection` → 逐块 `parseExcerptBlock` → 注入面板 options（`excerpts`）
- 目录列章节目录下方新增「摘抄 (N)」分组（collapsed 时随目录列隐藏）：
  - 每项 = quote 首行截断（~18 字）+ 定位标签（有 loc：`第1章 · 42%`；无 loc：`未定位` 灰字）
  - 点击项 → 有 loc：`switchChapter(loc.chapter - 1)` + `restoreScroll(loc.pct / 100)`；无 loc：Notice「该摘抄无定位信息」
- 样式：复用 rl-reader-toc-item 体系，新增 `rl-reader-ex-*`（分组标题/书签项/定位标签）

## 五、双向溯源

### 笔记 → 原书（MarkdownPostProcessor）

- 注册 `registerMarkdownPostProcessor`（main.ts onload 一次）：扫描渲染后 el 中文本 `定位：(\d+):(\d+)` → 替换为 `<span class="rl-loc" data-ch data-pct>原书 第N章·X%</span>`
- click → `openBookReaderAtLocByNotePath(sourcePath, ch, pct)`：main 内 list 按 notePath 反查 book 条目 → 读进度/文件 → 打开阅读器并传入 `initialLoc` → 面板 mount 后切章 + 恢复滚动比例
- 防误匹配：仅匹配 meta 行形态 `定位：数字:数字`

### 原书 → 笔记

- 摘抄书签项右侧「↗」按钮 → `openEntryNote(entryId)` 打开笔记（定位到 ^id 块为 P2 增强，本期先打开笔记）

## 六、设置页与排版（UI 改动，已向用户展示前后对比）

### UI-1 设置页删两行

- Settings.ts「外观」分组删除「阅读字号」「阅读行距」两个 Setting（滑块）
- `readerFontSize`/`readerLineHeight` 字段**保留**（兼容旧数据，注释更新为「设置项已移除，阅读器内调整」，同 colorTheme 先例）

### UI-5 设置页新增「实验性功能」分组 + 书籍打开方式开关

```
┌─ 实验性功能 ───────────────────────────────┐
│ 内置阅读器打开书籍文件              [toggle] │  ← 默认关（= 外部打开）
│ 说明：默认用系统默认程序打开书籍文件；        │
│       开启后用 ReelLudic 内置阅读器（TXT/EPUB）│
└──────────────────────────────────────────┘
```

- Settings 新增字段 `internalBookReader?: boolean`（默认 `false` = 外部打开；schema 只增不改）
- 行为分流（main.openBookReader 入口）：
  - **关（默认）**：书籍条目「▶ 观看」→ 系统默认程序打开（桌面端 `shell.openPath`，vault 相对路径经 `adapter.getFullPath` 转真实路径，库外绝对路径直接用；已有 playLocalEpisode 先例）
  - **开**：现有内置阅读器弹窗（TXT/EPUB）
  - **非桌面端**：外部打开不可用 → 回退内置阅读器（提示）
- 分组位置：置于「外观」之后、「数据管理」之前；desc 明确「实验性」语义

### UI-2 阅读器头部（TXT/EPUB 通用）

```
改前：│ 📖 书名·TXT     A− A+  目录  批注  ✕ │
改后：│ 📖 书名·TXT  已读34%·剩余66%  A− A+ 行距− 行距+  目录  批注  ✕ │
```

- 新增 `已读 X% · 剩余 Y%` 进度文本（rl-reader-prog，muted 小字）
- 新增 `行距− / 行距+` 按钮（步进 0.1，范围 1.2-2.4，与旧滑块一致）；行距改模块级变量（与字号一致跨面板共享）
- A±/行距调整后写回 settings：面板调用 `options.onSettingsChange?.({fontSize, lineHeight})` → main 更新字段 + `saveData(settings)`（轻量落盘，**不**触发 rebuildClients/refreshViews，避免每次点击重建）

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/pure/readingProgress.ts` | + `estimatePercent` |
| `src/pure/excerpt.ts` | ParsedExcerpt.loc + render/parse 定位 |
| `src/data/types.ts` + `src/data/catalog.ts` | readingProgress.percent 透传 |
| `src/modals/TxtReaderModal.ts` | 性能修复 + 进度显示 + 行距按钮 + 摘抄书签 + initialLoc |
| `src/modals/EpubReaderModal.ts` | 性能修复 + 进度显示 + 行距按钮 + 摘抄书签 + initialLoc |
| `src/modals/ReaderExcerptModal.ts` | onConfirm 携带 loc |
| `src/modals/ReaderModal.ts` | 载荷透传（excerpts/initialLoc/settingsChange） |
| `src/Settings.ts` | 删两滑块（字段保留）+ 新增「实验性功能」分组（internalBookReader 开关，默认外部） |
| `src/main.ts` | chapterSizes 计算、percent 落库、读笔记摘抄、postprocessor、openBookReaderAtLoc、onSettingsChange、书籍打开方式分流（external shell.openPath / internal 阅读器） |
| `src/views/components/MediaList.svelte` | readPct 优先 percent |
| `styles.css` | 进度文本 / 行距按钮 / 摘抄书签 / rl-loc 样式 |
| `tests/*` | readingProgress / excerpt / catalog 回归 |

## 执行顺序（TDD）

1. **T1 纯逻辑**：estimatePercent + ParsedExcerpt.loc + 测试
2. **T2 数据层**：readingProgress.percent 透传 + catalog.test 回归
3. **T3 卡顿修复 TXT**（fragment + rAF 节流 + 翻章延后 + 短章节触底判定）
4. **T4 卡顿修复 EPUB**（rAF 节流 + 翻章延后 + 样式缓存 + 短章节触底判定）
5. **T5 进度显示 + percent 落库**（TXT/EPUB 面板 + main 回调）
6. **T6 摘抄定位回写**（ReaderExcerptModal loc + addExcerpt 渲染）
7. **T7 摘抄书签目录**（main 读笔记 + 面板分组 + 点击跳转 + 开笔记）
8. **T8 笔记→原书 postprocessor**（rl-loc 渲染 + openBookReaderAtLoc）
9. **T9 设置页删滑块 + 行距按钮 + 排版写回**
10. **T10 MediaList readPct 优先 percent** → 全量构建 + 部署验证
11. **T11 书籍打开方式分流**：Settings 增 internalBookReader（默认 false）+ 实验性功能分组 + main.openBookReader 外部/内部分流 + 非桌面回退
