# 阅读器「软件式沉浸」批 1.5（去原生框 · 仿 Readest 沉浸排版）设计

> 日期：2026-09-04 | 状态：设计已确认 | 范围：ReelLudic 阅读器（TXT/EPUB）视觉沉浸升级——脱离 Obsidian Modal 原生外观的「软件式仿真」阅读区
> 前置：批 1（2026-09-03，仿 Readest 裁剪版 UI 重排）已交付并经 G6 实测修订三轮；本批基于**批 1 交付态**（含 G6 修订）继续
> 参考：Readest（github.com/readest/readest）阅读界面观感；**跟随系统明暗主题**（不强制深色）

## 背景与目标

批 1 交付后，阅读器功能结构已完备（顶栏三态 chrome / 侧栏三 pane / 选中动作条 / 设置下拉 / 底部进度 / 书签落盘），但视觉上仍是**「Obsidian Modal 弹窗内嵌一个自绘阅读器」**——外层有原生 modal 标题栏（虽空但占位带阴影圆角边框）、顶部存在"原生标题栏 + 自绘顶栏"双层夹层，观感偏插件工具而非独立阅读软件。

本批目标：把 TXT/EPUB 阅读器做成**软件式仿真（视觉层面脱离 Obsidian 原生组件外观）**——隐藏原生 modal 边框/标题栏/圆角阴影、自绘顶栏直铺、正文限阅读栏宽沉浸排版、顶栏半透明悬浮、侧栏折叠完全收起。**跟随系统明暗主题**，不做自建主题切换（与批 1 主题决策一致）。

范围界定：
- **视觉仿真**，非真无边框独立窗口（受 Obsidian 插件沙箱限制，不改变宿主）
- 不改独立 View 标签（项目批 1 前已因视图渲染不稳回归弹窗）
- 数据模型/功能逻辑零变更；纯 CSS + 少量 modal 沉浸类注入

> **起点 = 批 1 交付态（含 2026-09-03 G6 实测修订三轮）**，即：顶栏**常驻显示**（G6 已撤销 D1b 自动隐藏）、顶栏左仅 `≣` 侧栏折叠按钮、右仅 `≡` 设置（A−/A+ 与 ✕ 已删）、侧栏为「目录|书签|摘抄」三 tab 三 pane 唯一切换入口、底部 footer（章名 + 章内% 进度条 + 全书% + ‹› 纯翻章）、选中动作条（书签/摘抄可用 + 高亮/翻译灰态）、设置下拉（字号/行距/滚动模式 checkbox 状态 + 全屏）。批 1.5 只改视觉沉浸，不改上述功能语义。

## 澄清结论（用户已确认，2026-09-04）

| 决策点 | 结论 |
|---|---|
| 仿真方向 | **A 视觉仿真**：隐藏原生 modal 边框/标题栏，自绘沉浸阅读区 |
| 视觉基调 | **跟随系统沉浸风**：去除弹窗框架、全宽沉浸排版，不强制深色 |
| 窗口骨架 | **隐藏原生边框 + 自绘顶栏直铺**到 modal 最顶边，宽拉满近屏幕（~97%）高 ~95%，保留边距；不做真全屏盖应用 |
| 顶栏/侧栏 | **仿 Readest 沉浸布局**：顶栏半透明悬浮浮层（非实体条）+ 侧栏折叠**完全收起**（B-b，不做窄 icon 列） |
| 正文排版 | 批 1 已实现居中限宽阅读栏（TXT 680px / EPUB 720px）；**批 1.5 不再改动**（计划阶段核实后裁剪） |
| 正文顶部 | **留出顶栏高度 padding**（C-1a：悬浮顶栏不压首行字） |
| 章节标题 | 批 1 已居中醒目（TXT 1.35em），**本批不改** |
| 默认字号/行距 | **不改默认值**（C-3a，沿用设置页，避免影响已持久化用户） |
| 阅读底色 | **纯跟随系统主题**（C-4a，不加差异化底色，最稳） |

## 目标界面结构（TXT 示例；EPUB 同构 + 双页按钮）

```
┌─ 无原生框 · 无标题栏（rl-reader-immersive 覆盖 modal 骨架）────────────┐
│                                                                      │
│  顶栏＝半透明渐变悬浮浮层(position:absolute 于 .rl-reader 顶部)          │
│  ┌ ≣[侧栏折叠]  活著 · TXT                 ……      [≡ 设置] ┐ ← 悬浮
│  └──────────────────────────────────────────────────────────┘
│  .rl-reader-body = flex 行                                            │
│  ├ 侧栏(展开 220px / 折叠 0 完全收起) ┤ 正文滚动区(全高，顶部 padding
│  │   目录|书签|摘抄 tab                   容纳悬浮顶栏，C-1a)             │
│  │   (三 pane 切换，B-b 折叠全收)    ┌── 居中阅读栏 max-width 680px ──┐   │
│  │                                    章标题(居中醒目，批1已实现)        │
│  │                                    段落文本……                       │
│  └──────────────────────────────────└────────────────────────────────┘ │
│  ─── 底部 footer（实体小条：章名 + 章内% 进度条 + 全书% + ‹ ›）────────── │
└──────────────────────────────────────────────────────────────────────┘
```

布局要点：
- `.rl-reader` 仍为 flex column：`head`(absolute 悬浮) / `body`(flex:1) / `footer`(固定)
- 顶栏 `head` 从正常文档流**改为 absolute 悬浮**于 `.rl-reader` 顶部（.rl-reader position:relative），`.rl-reader-body` 顶部 `padding-top` 容纳顶栏高度
- 侧栏折叠 = `width:0; overflow:hidden`（现 `.rl-reader-toc.collapsed`），B-b 无 icon 列，靠顶栏 `≣` / 键盘 T 展开

## 实现分区

### P1 窗口骨架去原生框（styles.css + ReaderModal.ts 少量类注入）

**ReaderModal.ts**（`TxtReaderModal.onOpen` / `EpubReaderModal.onOpen`）在 `this.modalEl` 上加沉浸类：
```ts
this.modalEl.addClass('rl-reader-immersive');
// EPUB onOpen 同
```
**styles.css** 以 `.rl-reader-immersive` 作用域重定义 Obsidian modal 原生骨架：
```css
.rl-reader-immersive.modal {                 /* modalEl 本身 */
    width: 97vw; max-width: none; height: 95vh; max-height: none;
    border-radius: 0; box-shadow: none; border: none;
    padding: 0; margin: 0;
}
/* 隐藏原生标题栏（Obsidian Modal 未 setTitle 时是含原生关闭的空栏）；
   .modal-title 容器 display:none，其内 .modal-close（原生 ✕）一并隐藏 */
.rl-reader-immersive .modal-title { display: none; }
/* 原生 body 层去默认内边距，交由 .rl-reader 布局 */
.rl-reader-immersive .modal-content,
.rl-reader-immersive .modal-body { padding: 0; height: 100%; }
/* 覆盖外层 modal-container 的阴影/圆角/动画，去"弹窗弹出"痕迹 */
.rl-reader-immersive {
    box-shadow: none;
}
```
⚠️ **技术风险如实声明**：Obsidian Modal 原生 DOM（`.modal-title/.modal-close`）为未公开结构，跨主题/版本可能变动。本批用 `display:none` **覆盖而非删除** DOM；若某版本结构变动导致隐藏失败，阅读器仍完整可用（外观降级为弹窗，功能无损）。**不**隐藏所有 `.modal-close`（全局），只在本沉浸类作用域内处理，避免影响插件其他弹窗。

### P2 顶栏半透明悬浮（styles.css + TxtReaderModal/EpubReaderModal 结构微调）

- `buildHeader()` 生成的 `head` 目前是 `.rl-reader` flex column 的第一个文档流子元素；改为在 `.rl-reader` 内 **absolute 定位悬浮**：
  - TS：`mount()` 中给 `.rl-reader` 设 `position:relative`（CSS）；`head` 结构不变（子元素/按钮逻辑不动）
  - CSS：`.rl-reader-head` 改 `position:absolute; top:0; left:0; right:0; z-index:10;` 半透明渐变底（`background: linear-gradient(...)` 用 var 透明度），**去掉 border-bottom 实体线**（悬浮无需硬分隔）
- `.rl-reader-body` 加 `padding-top: <顶栏高度>`（C-1a 首行不被压）——因顶栏悬浮，正文需从顶栏下留白处开始
- 顶栏仍**常驻显示**（批1 G6 已撤销自动隐藏，本批不改回自动隐藏）

### P3 侧栏折叠态（B-b：完全收起）

- 现状 `.rl-reader-toc.collapsed { width:0; overflow:hidden }` 已是完全收起；本批**保持 B-b 语义不变**，仅随骨架调整：
  - 折叠时 `.rl-reader-body` 正文区自然占满（现 flex 已自动）
  - 顶栏 `≣` sidebar-toggle 按钮与键盘 T 维持展开/收起
  - 无新增 icon 列（用户明确 B-b）
- 微调：展开态侧栏底色跟随主题（现 `--background-secondary`）；若沉浸后想更柔和可换 `--background-primary` 加 border，按实看效果定（留待实现/验证）

### P4 正文排版（现状已满足，本批不改——2026-09-04 计划阶段核实后裁剪）

正文阅读栏**批 1 已实现**（TXT `.rl-reader-text` 居中 `max-width:680px` + 章标题居中 1.35em 醒目；EPUB iframe 单页 `max-width:720px` 居中、双页 columns:2）。批 1.5 计划阶段核实后**不再改动正文宽度/章标题**（用户确认接受现状，避免重复改动；正文排版真增量已由批 1 完成）。

### P5 排版默认值（C-3a）

不改 `readerFontSize`/`readerLineHeight` 默认；正文栏宽 46em、行距 CSS 1.8 作为**沉浸展示默认**，但字号/行距仍可由设置下拉实时覆盖（沿用 adjustFont/adjustLineHeight 写回会话变量与 CSS 变量）。

## 测试策略

- **纯样式/布局变更**为主（去原生框、悬浮顶栏、阅读栏宽）→ 无新增纯逻辑 TDD；保留回归（TXT/EPUB 面板功能：切章、书签落盘、摘抄、进度持久化、选中动作条、设置下拉、双页切换）
- 关键验证 = **手工目检**（对照本文目标结构，逐区检查：无原生标题栏夹层、顶栏悬浮不压首行、侧栏折叠全收、阅读栏居中、章标题醒目、深浅主题各一遍）
- 产物符号断言：`.rl-reader-immersive` 类注入逻辑 + 无 CSS 死规则
- 部署三件套 cmp 校验（沿用项目标准路径）

## 不做（明确裁剪）

- 真无边框独立窗口 / 改宿主 / 独立 View 标签
- 自建明暗主题切换（跟随系统，同批 1）
- 侧栏折叠 icon 胶囊列（B-b）
- 自动隐藏顶栏（批1 G6 已改常驻，不回退）
- 阅读底色差异化（C-4a 纯跟随）
- 数据模型/进度/书签/摘抄存储变更

## 待实现确认点（非占位，实现时定）

1. EPUB iframe 内阅读栏限宽注入点与内容容器选择器（复用 applyLayout 的样式注入渠道）
2. 悬浮顶栏确切高度（px 或由内容撑开）与正文 padding-top 取值的一致性
3. 沉浸底色是否需在 footer 上加实体底以区隔（footer 保持实体小条）
