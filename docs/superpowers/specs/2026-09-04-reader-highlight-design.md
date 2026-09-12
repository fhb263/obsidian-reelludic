# 阅读器高亮批（页内持久高亮 + 写入书目笔记）设计

> 日期：2026-09-04 | 状态：**已实现**（TXT+EPUB 一键即黄即记 → 页内 `<mark>` + 笔记「## 高亮」区 + 标注 pane 列表，772/772 全绿含 19 高亮单测，tsc 0 + esbuild 3,545,812B + cmp OK） | 范围：ReelLudic 阅读器 TXT + EPUB 选中文字持久高亮
> 前置：批 1（动作条「🖍高亮」灰态占位）→ 本批填充；翻译批已完成。高亮与摘抄区分、数据落笔记均已确认。
> 目标：选中文字一键标黄（页内持久 `<mark>`）+ 自动写入书目笔记「## 高亮」区，重开/切章可还原。

## 决策（用户已确认）

| 决策点 | 结论 |
|---|---|
| 高亮动作 | **一键即黄即记**：选中 → 点动作条「🖍高亮」→ 不弹确认窗、不打断，选中段立即页内标黄 + 自动写一条笔记高亮。摘抄（❝）保留确认弹窗不变 |
| 数据落点 | **书目笔记独立「## 高亮」区**（与现有「## 摘抄」区并列），blockquote + `^id` 块格式，meta 含定位 |
| 单源真相 | **书目笔记「## 高亮」区**（阅读器页内渲染/高亮列表均从笔记解析；不另设阅读器侧高亮文件） |
| 页内渲染 | 渲染某章时，从该条目所有笔记高亮中筛本章（loc.chapter），按 quote 文本在正文段落查找并包 `<mark class="rl-hl-persist">` 持久黄标 |
| 范围 | **TXT + EPUB 都做**。TXT = textEl 段落流；EPUB = iframe contentDocument（srcdoc 重建后 onFrameLoad 内标 mark） |
| 管理 | 标注 pane（书签/摘抄 tab 同栏）展示高亮列表；点击高亮 → 跳原书定位并滚动到段；右键/删除 → 移除 `<mark>` + 从笔记删块 |
| 定位容错 | 正文找 quote 用去空白子串（同现有 excerpt 跳转），取首个命中；EPUB 内文本若被多标签拆散（v1 仅按 p.textContent 找，整段命中率覆盖多数场景） |

## 笔记高亮区格式（对齐 pure/excerpt.ts 的 blockquote 块）

```
## 高亮

> 选中文本（可多行 blockquote）

**p.128** · 定位：1:42 · 类型：高亮
^hl0001a2b3
```

- 复用 `generateBlockId('hl')` 生成 `^hl…` 块 id（与摘抄 `^bk…` 区分前缀）
- meta 行含定位 `定位：N:N`（chapter:pct，供跳转）与可选 `类型：高亮`
- 高亮块在笔记里可被普通摘抄浏览/块引用，语义自明

## 架构

- `src/pure/highlight.ts`（纯逻辑，无 obsidian 依赖，TDD）：高亮区提取/逐块解析/渲染块/追加/按 id 删除
  - `ParsedHighlight`（同 ParsedExcerpt 形态：quote/chapter/pct/id）+ `ReaderHighlight` 语义类型
  - `extractHighlightSection` / `parseHighlightBlocks`（本章高亮 quotes 列表）
  - `renderHighlightBlock(quote, {chapter,pct})` → blockquote + meta + `^hl…`
  - `appendHighlightToNote(noteMd, hlMd)` / `removeHighlightBlock(noteMd, blockId)`（同 excerpt.ts 合并/删除策略，区标题用「## 高亮」）
- `main.ts`：读笔记高亮区（loadEntryHighlights 同 loadEntryExcerpts 模式）→ 注入阅读器 options
- 阅读器 options：新增 `highlights?: ReaderHighlight[]` + `onHighlight?: (quote, loc) => Promise<{ok,id}>`（追加写笔记）+ `onDeleteHighlight?: (blockId) => Promise<boolean>`；onSaved/变更后重读刷新
- 动作条「🖍高亮」：addSelHighlight — 立即把选区标 mark（不重渲染整章）+ 调 onHighlight 写笔记
- TXT renderContent：每章渲染后 `applyHighlights()` 走 textEl 段落，把本章高亮 quote 命中段内的子串包 `<mark class="rl-hl-persist">`
- EPUB onFrameLoad：`applyHighlights()` 走 contentDocument.body 段落同理
- styles.css：`.rl-hl-persist`（黄底 mark）+ `.rl-reader-hl-item` 等列表样式

## styles.css 新增

`.rl-hl-persist { background: color-mix(in srgb, var(--text-highlight-bg, #f2cc60) 55%, transparent); border-radius:2px; }`（随系统明暗）

## 测试策略

- pure/highlight：区提取/解析/渲染/追加/删除 纯函数单测（TDD），覆盖合并/删除与摘抄区互不干扰
- 无 DOM 单测；面板手工目检（TXT/EPUB 各开一本：选中→高亮→页内黄标+笔记「## 高亮」区新增；切章/重开还原；删高亮）
- 回归 753 保持；tsc/esbuild/cmp 标准 gate

## 裁剪（不做）

- 不做高亮颜色多选（单一黄标）
- 不做 EPUB 内跨标签拆散文本的精确字符定位（v1 段落级 quote 匹配）
- 不做高亮导出/分享/云同步
- 不做翻译批的「高亮 → 导为摘抄」批量（可用时再议）

## 边界（与摘抄区分）

- 摘抄：确认弹窗 → 进「## 摘抄」区；页内**不**标黄
- 高亮：一键 → 页内 `<mark>` 黄标 + 进「## 高亮」区
- 动作条「★书签」仍为位置书签（进阅读器侧 bookmarks.json，不走笔记）
