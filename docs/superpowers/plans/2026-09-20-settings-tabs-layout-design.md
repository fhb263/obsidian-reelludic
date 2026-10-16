# 设置页「横向 Tab」改版 · UI 规范稿（#353）

> 日期：2026-09-20 | 状态：**已按 D-1~D-11 全部推荐项落地**（用户回「按你的来」）
> 触发：用户要求把 #352 的**左右分栏**改成**顶栏横向 Tab**（省横向空间 / 适配窄窗），并给出 Tab 三态规范、溢出方案、「关于」外移、内容区标题处置。
> 前情：`docs/superpowers/plans/2026-09-20-settings-panel-redesign-design.md`（#352，D-1~D-9 已落地）。
> 交付物：本规范稿（结构选型 + 三态视觉规范 + 溢出方案对比 + 影响面 + 裁定清单）。**落地记录见 §9.4 / §10.1**。

---

## 0. 一句话结论

1. **方向认可，但先把口径摆正**：横向 Tab **不省「横向空间」本身** —— 它把左栏那份**固定 168px 的横向成本**换成 **约 40px 的纵向成本**。这正是窄窗/手机需要的兑换（手机可支配宽度只有约 264px，一个 168px 的左栏直接吃掉 2/3）。理由要说对，否则将来按「横向更省」去验收会得出相反结论。
2. **三态推荐「只变色 + 激活项 2px 强调色下划线」**：这不是新发明 —— 是把你 **2026-09-14 的裁定**（并排切换类**悬停只变色不铺底**）与**阅读器顶栏已验证的 `.rl-seg-text`**（未选中 `--text-muted` / 悬停 `--text-normal` / 选中 `--interactive-accent` + 600）搬到设置页。Tab 就是「并排的切换类」，按既有口径它**不该铺 hover 底色**。
3. **溢出推荐 ① 横向滚动**（纯 CSS，零 JS）；②「···」溢出菜单要量宽度 + `ResizeObserver`，与 #352「⛔ 不需要 ResizeObserver」的既有裁定冲突，列为**可选增强**而不是默认。
4. **「关于」外移是零文案成本的** —— 全仓路径文案**没有任何一处**引用「关于」（已 grep 实证），而「数据源管理 / AI集成」有 7 处引用 ⇒ 移出「关于」不动一个字。

---

## 1. 现状盘点（对 `src/Settings.ts` + `styles.css` 实测）

### 1.1 现有 DOM 与类名

```
display()
└─ .rl-set-shell                      ← flex
   ├─ .rl-set-nav                     ← flex:0 0 168px / column / sticky
   │  └─ ×6  .rl-set-nav-item         ← div，内含 .rl-set-nav-icon(svg) + .rl-set-nav-label
   └─ .rl-set-content                 ← flex:1 1 auto; min-width:0
      └─ ×6  .rl-set-page             ← 仅 .is-active 显示
         ├─ (原生) .setting-item.setting-item-heading   ← setHeading() 出的页标题
         ├─ .rl-set-page-head         ← 仅窄屏显示的手风琴标题行（-head-icon/-head-label/-page-chev）
         └─ .rl-set-page-body         ← 页体，窄屏折叠、宽屏常显
```

切换只有一个真源 `setActivePage(id)`：`navItems` 与 `pageEls` 各 `toggleClass('is-active')` 一次（断言写**精确计数 2**）。

### 1.2 改成 Tab 后**可以删掉**的东西（这是收益的硬指标）

| 删除项 | 位置 | 为什么可以删 |
|---|---|---|
| `.rl-set-page-head` 整条链路（`-head-icon` / `-head-label` / `-page-chev`） | `Settings.ts` 建节点处 + `styles.css` 窄屏块 | 窄屏也走同一个 Tab 栏 ⇒ 不再需要第二套导航 |
| `@media (max-width:719px)` 里的 8 条规则 | `styles.css` | 同上 |
| `.rl-set-page > .setting-item.setting-item-heading { display:none }` | 同上 | 若按 D-4 去掉页标题，这条自动失效 |
| `.rl-set-nav` 的 `sticky` / `flex:0 0 168px` / `column` | `styles.css` | 竖排专属 |
| `createSectionHeading()` 方法（若无别处引用） | `Settings.ts:276` | 唯一调用点在 `display()` |

**DOM 规模**：现在 6 nav 项 + 6 手风琴头 + 6 页体 ⇒ 改后 **5 tab + 1 关于图标 + 6 页体**。

### 1.3 硬约束（不变）

| 约束 | 值 | 后果 |
|---|---|---|
| `minAppVersion` | `0.15.0` | ⛔ 官方 1.13+ 声明式设置页不可用（#352 已裁） |
| `isDesktopOnly` | `false` | ⚠️ 必须支持手机 ⇒ 溢出不是「万一」，是**必然**（见 §5.1） |
| 渲染方式 | 命令式 `new Setting(containerEl)`，`display()` 每次重绘 | 结构改动必须落在 `display()` 内 |
| 标签文案 | 「数据源管理 / AI集成」被全仓 **7 处**路径文案引用 | ⛔ 一个字都不能改（本次 5 个 Tab 标签**逐字沿用**，零文案改动） |
| 外框 | ⛔ 不碰 Obsidian 设置弹窗的 `.vertical-tab-*` | 只能在**自己 tab 的 `containerEl` 内部**做 |

---

## 2. 金标准检索结论

### 2.1 下划线导航的事实标准：GitHub Primer `UnderlineNav`

- 定位（官方决策流）：点击会**改变 URL/页面** → `UnderlineNav`；点击只**切换面板可见性** → `UnderlinePanels`；**换内容格式**（列表/网格）→ `SegmentedControl`。
  ⇒ 本仓是「切换面板可见性」⇒ 语义上更贴近 `UnderlinePanels`，但**视觉**上 `UnderlineNav` 是社区最认的下划线样式。**一个组件同时满足两者 = 下划线 + 面板**，这是本次选 A 的依据。
- 🔴 **溢出策略（可直接抄的两步）**：
  1. **先隐藏图标**（图标存在时）以腾出空间，尽量多显示项目；
  2. 仍放不下 → 把放不下的项目**移进 More 菜单**。
  ⇒ 「藏图标」这一步对中文长标签尤其值钱（见 §5.1 的宽度账）。
- 触屏（coarse pointer）上用**左右箭头**控制滚动。

### 2.2 Material Design Tabs

- 两种官方溢出：**scrollable tabs**（可滚动）与 **tabs with a More dropdown / overflow pagination**（更多菜单 / 溢出翻页）—— 你问的两种方案在 MD 里都是正统，不是二选一的「好/坏」。
- 固定 tab 建议**不超过 4 个**，我们有 5 个 ⇒ 严格按 MD 就该用**可滚动**形态。✅ 支持 §5 的推荐。
- 激活态 = **下划线 + 变色**（与我们的三态设计一致）。
- ⛔ **一个 Tab 集里不许「有的带图标+文字、有的只有文字」** —— 这项对 D-2 有约束力：要么 5 个都带图标，要么 5 个都不带，**不能只给个别 Tab 配图标**。
- 可滚动时首项与左缘留 52dp 偏移，用来暗示「右边还有内容」。

### 2.3 ⚠️ 对参考口径的两处纠正（本仓做不到 / 不该照抄）

| 参考说法 | 本仓实测 | 结论 |
|---|---|---|
| 下划线容器的底线应**通栏**（MD3） | 设置内容区 `.vertical-tab-content` 自带 **48px 横向内距**，且外框不许碰 | ⛔ 做不到通栏；且通栏底线会与「选中短线」抢视觉 ⇒ 改**只画激活项下的短线**（Primer 语言），是否需要容器底线列为 D-7 |
| 直接用原生 `--tab-*` 变量即可零硬编码 | 变量**存在**，但默认值偏弱：`--tab-text-color: var(--text-faint)`、`--tab-text-color-active: var(--text-muted)` | ⚠️ **只借形状变量**（`--tab-radius-active` / `--tab-curve` / `--tab-outline-color`），**文字色不借** —— 照抄会让设置页比 #352 还灰，是开倒车 |

### 2.4 ✅ 本轮实测（`_probe_tabvars.cjs`，源 `D:\Obsidian\resources\obsidian.asar`）

**原生 tab 形状变量存在（含默认值上下文抽验）**：

```
--tab-background-active: var(--background-primary);
--tab-text-color:        var(--text-faint);          ← ⚠️ 偏弱，不借
--tab-text-color-active: var(--text-muted);          ← ⚠️ 偏弱，不借
--tab-divider-color:     var(--background-modifier-border-hover);
--tab-outline-color:     var(--divider-color);
--tab-outline-width:     1px;
--tab-curve:             6px;
--tab-radius:            var(--radius-s);
--tab-radius-active:     6px 6px 0 0;                ← 胶囊态可直接用
--tab-width / --tab-max-width: 200px / 320px
```

**图标严格命中（形态判据 `"name":[[`）**：

- ✅ 可用：`more-horizontal` `more-vertical` `ellipsis-vertical` `chevron-left` `chevron-right` `chevron-down` `badge-info` `circle-help` `panel-top` `panel-left` `gallery-horizontal` `arrow-left` `arrow-right` + #352 已用的 6 个页图标
- ⛔ **严格 MISS（= 本探针证据不足，本项目纪律：不得使用）**：`ellipsis`、`info`、`dots-horizontal`
  ⇒ **「···」溢出菜单必须用 `more-horizontal`，⛔ 不能用直觉上的 `ellipsis`**；「关于」继续用 `badge-info`。
  （`setIcon()` 遇不存在的名字**静默失败** ⇒ 界面是空白图标且无报错，只有白名单单测能兜住。）

---

## 3. 方案选型

### 方案 A：下划线 Tab（**主推**）

```
+-------------------------------------------------------------------------------+
|  设置 / ReelLudic                                                             |
+-------------------------------------------------------------------------------+
|  [i]数据源管理   [i]AI集成   [i]外观   [i]实验性功能   [i]数据管理        [i]  |  <- Tab 栏 40px
|  ▔▔▔▔▔▔▔▔▔▔                                                            关于  |
|  ══════════                                                     (右上角小图标) |
+-------------------------------------------------------------------------------+
|                                                                               |
|    数据源启用                                     <- 无页标题，直接从子分组开始 |
|    +---------------------------------------------------------------------+    |
|    | 豆瓣                                        [已启用  o]             |    |
|    +---------------------------------------------------------------------+    |
|                                                                               |
|    数据源凭据                                                                  |
|    +---------------------------------------------------------------------+    |
|    | 豆瓣 API Key        [________]  [测试]                              |    |
|    +---------------------------------------------------------------------+    |
+-------------------------------------------------------------------------------+
      ^ 激活项：强调色文字 + 600 + 下方 2px 强调色短线
      ^ 悬停：只把文字变 --text-normal，⛔ 不铺底色（2026-09-14 裁定）
```

- **优点**：最省纵向空间（40px）；与 Obsidian 原生工作区标签页/`--tab-*` 语汇同族；无底色 ⇒ 与「悬停不铺底」的既有审美零冲突；窄屏藏图标后仍能塞下 3~4 项。
- **风险**：通栏底线做不到（§2.3）；激活项若落在滚动区外需要 `scrollIntoView`（§5.2）。

### 方案 B：胶囊 Tab

```
+-------------------------------------------------------------------------------+
|  设置 / ReelLudic                                                             |
+-------------------------------------------------------------------------------+
|   ┌────────────┐                                                              |
|   │ 数据源管理 │   AI集成    外观    实验性功能    数据管理          [i] 关于    |
|   └────────────┘                                                              |
+-------------------------------------------------------------------------------+
      ^ 激活：底色（强调色低饱和）+ 强调色文字
      ^ 悬停：⚠️ 若也铺底 → 与 2026-09-14 裁定直接冲突（见 D-6）
```

- **优点**：选中块更“实”，触摸目标更明确；形状可直接用 `--tab-radius-active: 6px 6px 0 0`（实测存在）。
- **风险**：🔴 **胶囊的成立依赖 hover 底色**（无底色时用户看不出那是可点的胶囊）⇒ 与「并排切换类悬停只变色」的裁定**正面冲突**；且 5 个胶囊横向占宽更大（比下划线版多约 20px/项），窄屏更早溢出。
- **注**：胶囊若要保住审美，只能走「**只在激活项上出胶囊**」的变体（类 MD3 的 active indicator，而非分段控制器）。

### 方案 C：不改结构，只修窄屏（对照项）

保持左右分栏，仅把窄屏手风琴换成横向 Tab。**不推荐**：等于维护两套导航（竖排 + 横排），成本最高、收益最小。

### 三方案对照

| 维度 | A 下划线 | B 胶囊 | C 只改窄屏 |
|---|---|---|---|
| 横向占用 | 5 项 ≈ **459px**（含图标） | ≈ **559px** | 宽屏 168px / 窄屏同 A |
| 纵向成本 | 40px | 40px | 0 |
| 与 2026-09-14 裁定 | ✅ 一致 | ⚠️ 冲突（需豁免） | — |
| 与原生 tab 语汇 | ✅ 同族 | ✅ `--tab-radius-active` | — |
| 实现成本 | **低**（纯 CSS + 删代码） | 中 | **高**（两套并存） |
| 窄屏适配 | ✅ 藏图标 + 滚动 | ⚠️ 更早溢出 | — |

---

## 4. 视觉规范（三态 / 尺寸）

### 4.1 方案 A 三态表（★ = 本次新增规范）

| 状态 | 选择器 | 文字色 | 字重 | 底色 | 下划线 | 光标 |
|---|---|---|---|---|---|---|
| **未激活** | `.rl-set-tab` | `--text-muted` | 400 | 无 | 无 | `var(--cursor)` |
| **悬停（未激活）**★ | `.rl-set-tab:hover:not(.is-active)` | `--text-normal` | 400 | ⛔ **不铺底** | 无 | `var(--cursor)` |
| **激活** | `.rl-set-tab.is-active` | `--interactive-accent` | **600** | ⛔ 不铺底 | **2px** `--interactive-accent`（`box-shadow: inset 0 -2px 0`） | `var(--cursor)` |
| **激活 + 悬停**★ | 保持激活态（`hover` 规则排除 `.is-active`） | 不变 | 600 | 不变 | 保持 | `var(--cursor)` |
| **键盘焦点** | `.rl-set-tab:focus-visible` | 不变 | 不变 | 无 | 不变 | — |
| **按下** | `.rl-set-tab:active` | `--interactive-accent` | 不变 | 无 | 不变 | — |

> —— 上表的文字色/字重**逐条对齐阅读器已落地的 `.rl-reader .rl-seg-text .rl-seg-item`**（`styles.css:2257-2273`），保证「插件里两处并排切换」是同一套语言。唯一新增的是**下划线**（设置页是"页级导航"，需要一个比变色更强的位置标记）。

### 4.2 尺寸规格

| 项 | 规格 | 依据 |
|---|---|---|
| Tab 栏高 | **40px**（含底部余量） | 与阅读器顶栏同一量级 |
| Tab 项高 | **36px** | 沿用 #352 已裁定的 D-8（36–40 区间**取下限**） |
| Tab 项内距 | `padding: 0 10px`，图标与文字 `gap: 6px` | 与 #352 `.rl-set-nav-item` 同值 |
| 字号 | `--font-ui-small` | 与 #352 导航项、阅读器分段器一致 |
| 图标 | `1em` + `align-items: center` | ⛔ 不用绝对 px（会与文字基线错位） |
| 项间距 | `gap: 4px` | 纯文字形态靠间距分组 |
| 下划线 | `box-shadow: inset 0 -2px 0 var(--interactive-accent)` | ⛔ **不用 `border-bottom`**（会给激活项 +2px 高度 ⇒ 顶动文字；#352 已有 `border-left` 撑宽 3px 的同类判例） |
| 激活标记竖直对齐 | 线在 36px 项内**底部**（不是容器底部） | 避免与滚动条/容器底线打架 |

### 4.3 零硬编码 CSS（草案，含兜底）

```css
/* Tab 栏：⚠️ .rl-set-tabs .rl-set-tab 两级前缀不可省（≥0,2,0）—— 见 §9 排雷 ③ */
.rl-set-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 40px;
    min-width: 0;
    overflow-x: auto;          /* 溢出方案①：横向滚动 */
    overflow-y: hidden;
    scrollbar-width: thin;
    position: sticky;          /* 长页时吸顶（D-10） */
    top: 0;
    z-index: 1;
    background: var(--background-primary);
}
.rl-set-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;            /* 不被压缩 ⇒ 靠滚动而不是靠挤 */
    height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--nav-item-color, var(--text-muted));
    font-family: inherit;
    font-size: var(--font-ui-small);
    white-space: nowrap;
    cursor: var(--cursor);
    user-select: none;
}
/* 悬停只变色（⛔ 不铺底）；必须排除 .is-active */
.rl-set-tab:hover:not(.is-active) { color: var(--nav-item-color-hover, var(--text-normal)); }
.rl-set-tab.is-active {
    color: var(--interactive-accent);
    font-weight: 600;
    box-shadow: inset 0 -2px 0 var(--interactive-accent);
}
.rl-set-tab-icon { display: flex; align-items: center; flex: 0 0 auto; color: inherit; }
.rl-set-tab-icon svg { width: 1em; height: 1em; }
```

> 变量选择说明：文字色沿用 #352 **已实测存在**的 `--nav-item-color*`（+ 兜底），形状/强调色用 `--interactive-accent`（与阅读器分段器一致）。原生 `--tab-text-*` 因默认值偏弱**不采用**（§2.3）。

### 4.4 窄屏（< 720px）的额外规范

按 Primer 的溢出策略第一步，窄屏**先藏图标**：

```css
@media (max-width: 719px) {
    .rl-set-tab-icon { display: none; }
    .rl-set-tab { padding: 0 8px; }
}
```

- 阈值 **720** 沿用全项目唯一口径（阅读器顶栏同值），本稿**不新增第二个阈值**。
- 藏图标后 5 项估算宽 ≈ **364px**；手机可支配宽 ≈ 264px ⇒ **仍会溢出**，所以滚动是必须项、不是可选项。

---

## 5. 溢出处理

### 5.1 先算账：为什么必然溢出

在 `--font-ui-small`（13px）下的**估算**宽度（±10%，以 `_probe_settings.cjs` 实测为准）：

| 项 | 文字宽（CJK 13px/字） | +图标 1em +gap 6 +内距 20 | 小计 |
|---|---|---|---|
| 数据源管理 | 65 | +39 | 104 |
| AI集成 | ≈40 | +39 | 79 |
| 外观 | 26 | +39 | 65 |
| 实验性功能 | 65 | +39 | 104 |
| 数据管理 | 52 | +39 | 91 |
| **5 项合计** | 248 | +195 | **≈ 443** + 4×4 gap = **≈ 459px** |
| 「关于」图标按钮 | — | — | +28 + 8 gap = **+36** |
| **Tab 栏总需求** | | | **≈ 495px** |

可用宽度（`--size-4-12` = 48px 横向内距，v42 实测）：

| 视口 | 可用宽 | 结论 |
|---|---|---|
| 手机竖屏 360dp | **264px** | 🔴 严重溢出，只能露 2~3 项 |
| 窄窗 640px | 544px | ✅ 放得下（495 < 544） |
| 常规 800px+ | 704px+ | ✅ 宽裕 |

⇒ **溢出只在手机/极窄窗发生，但一旦发生就必须可用**。

### 5.2 方案 ① 横向滚动（**推荐**）

| 项 | 做法 |
|---|---|
| 滚动容器 | `.rl-set-tabs { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }` |
| 项目不被压缩 | `.rl-set-tab { flex: 0 0 auto }` —— ⛔ 不能用 `flex:1`（会把 5 项挤成全等宽 + 文字截断，违反 MD「不截断标签」） |
| 「右边还有」的提示 | 两端 `mask-image: linear-gradient(...)` 渐隐（比滚动条更可靠：细滚动条在触控板上常驻但鼠标下会淡出） |
| 🔴 激活项必须可见 | `setActivePage()` 里补一行 `el.scrollIntoView({ block:'nearest', inline:'nearest' })` —— 否则「默认页在屏外 / 键盘切到屏外项」时内容变了、Tab 栏却没提示 |
| 鼠标横滚 | 触控板天然支持；鼠标 `Shift + 滚轮`（Chromium 默认） |
| 成本 | **零 JS（除上面一行）**、无 ResizeObserver、无高度跳变、无「搬节点」风险 |

### 5.3 方案 ②「···」溢出菜单（可选增强，**不推荐为默认**）

按 Primer 两步走：① 先藏图标 → ② 再逐项收进 More。

| 项 | 做法 / 风险 |
|---|---|
| 量宽 | 需 `getBoundingClientRect()` 逐个量 → 算容纳数 → 把多余项**移入**菜单 |
| 🔴 反向搬回 | 窗口变宽必须**搬回原位**（保持顺序）—— 这正是本仓 #351 栽过的坑（搬节点丢 `is-on` 与监听），必须**搬原节点、⛔ 不 `cloneNode`** |
| 🔴 激活项被收进菜单 | 菜单按钮必须显示**当前页名**（否则用户完全不知道自己在哪一页） |
| 🔴 浮层 mousedown | 浮层**必须自己挡 `mousedown`**，否则 `document` 的 `onDocMouseDown` 先 `remove()` 它 ⇒ 菜单项点击派发到最近公共祖先 ⇒ **点不动**（#351e 的原始故障，同一个坑） |
| ⚠️ 与既有裁定冲突 | #352 明确「**⛔ 不需要 ResizeObserver**」，本方案**必须**用 ⇒ 需要你显式豁免 |
| 图标 | 只能用 `more-horizontal`（`ellipsis` 本探针严格 MISS，见 §2.4） |
| 成本 | 中高（量宽 + ResizeObserver + 移节点 + 浮层命中测试 + 单测/断言 5 项） |

### 5.4 方案 ③ 滚动 + 边缘箭头（折中）

Primer 在**触屏设备**上用左右箭头控制滚动。🟡 折中：只在窄屏出现两个 `chevron-left`/`chevron-right` 小按钮 ⇒ 比 ② 便宜得多，但会用掉 2×28px 宽度（在 264px 里很贵），**建议仅在 ① 的渐隐提示实测不够明显时才启用**。

### 结论

**默认 = ① 横向滚动**（零 JS、无 ResizeObserver、无搬节点风险）；② / ③ 作为「实测发现可发现性不足」时的补丁，且 ② 需要 D-3 单独裁定。

---

## 6. 「关于」的安置

### 选项 ① 右上角小图标（**建议**）

```
+-------------------------------------------------------------------------------+
|  [i]数据源管理  [i]AI集成  [i]外观  [i]实验性功能  [i]数据管理      [i] 关于    |
|  ══════════                                                   ^ badge-info    |
+-------------------------------------------------------------------------------+   |
|  （激活「关于」时：Tab 栏 5 项全部未选中，只有右上角图标亮起）                       |
|                                                                                  |
|    关于 ReelLudic                                                                 |
|    ... 支持文案 ...                                          [反馈] [支持]         |
+-------------------------------------------------------------------------------+
```

- 图标 `badge-info`（实测存在），`aria-label` / tooltip 写「关于 ReelLudic」。
- ✅ 始终可见，不用滚到底。
- 🔴 **本方案唯一的"新状态"**：激活「关于」时，**Tab 栏没有任何选中项**。必须显式定规范，否则用户会以为界面坏了：
  - 右上角图标自身进入**激活态**（同 `.is-active` 的三态规格）；
  - 「关于」页内容区顶部保留一行**页名小标签**（因为它是唯一不在 Tab 栏里的页）—— 这一条与 D-4「删掉重复标题」**不矛盾**：别的页有 Tab 承载页名，「关于」没有。
- 🟢 **影响面**：全仓路径文案 **0 处**引用「关于」⇒ 外移**不动任何文案**。

### 选项 ② 面板最底部次要区

```
+-------------------------------------------------------------------------------+
|  [i]数据源管理  [i]AI集成  [i]外观  [i]实验性功能  [i]数据管理                  |
|  ══════════                                                                   |
+-------------------------------------------------------------------------------+
|    ... 长页内容 ...                                                            |
|                                                                               |
|  ─────────────────────────────────────────────────────────────────────────    |
|  关于 ReelLudic · v1.0.6 · 反馈                     <- 次要区，小字 muted       |
+-------------------------------------------------------------------------------+
```

- 优点：完全不占导航资源；与 iOS/Android 设置页的「关于在底部」惯例一致。
- ⚠️ **致命短板**：设置页最长的一页（数据源管理 ≈ 20 行）要**滚到底**才看得到 —— 而「关于」恰好是用户**最常去找版本号/反馈入口**的地方。⇒ 不推荐。

### 选项 ③（第三解，最小改动）

「关于」不作为页，改为**点图标弹浮层/弹窗**（复用现有 `renderAboutPage` 的内容）。
🟡 优点：没有「Tab 栏无选中项」这个新状态；缺点：内容要重排进浮层，比 ①② 贵。列为 D-5 的第三选项。

---

## 7. 内容区标题处置（去掉重复大标题）

### 7.1 改动

`display()` 里的 `this.createSectionHeading(el, page.label)` **删除**（`Settings.ts:717`）。

```
改前                                      改后
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ 数据源管理          ← 14px/600│         │ 数据源启用        ← 13px/600 │  ← 首个元素就是子分组
│ ──────────────────────────── │         │ ┌──────────────────────────┐ │
│ 数据源启用        ← 13px/600 │         │ │ 豆瓣      [已启用  o]    │ │
│ ┌──────────────────────────┐ │         │ └──────────────────────────┘ │
│ │ 豆瓣      [已启用  o]    │ │         │ 数据源凭据        ← 13px/600 │
│ └──────────────────────────┘ │         │ ┌──────────────────────────┐ │
└──────────────────────────────┘         └──────────────────────────────┘
```

### 7.2 连带的 4 件事（漏一件就出问题）

1. 🔴 **页顶会多一段留白**：`.rl-svc-group` 自带 `margin: var(--size-4-2) 0`，去掉标题后它成为页内首个元素 ⇒ 必须补
   `.rl-set-page > .rl-svc-group:first-child { margin-top: 0; }`
   （否则页顶空出一截，观感上像是"内容没对齐"。）
2. **可删的死代码/规则**：窄屏那条 `.rl-set-page > .setting-item.setting-item-heading { display:none }`（自动失效）、`createSectionHeading()`（若无别处调用）。
3. 🔴 **官方 guideline 澄清（重要，别自己吓自己）**：Obsidian 那条 guideline 的原文是「**用 `setHeading()` 而不是自造 `<h2>`**」，它约束的是**标题怎么实现**，**不**要求「必须有标题」。⇒ 去掉页标题**不违规**。
   但**语义不能一起丢掉** ⇒ 用 **`role="tabpanel"` + `aria-labelledby="<对应 tab 的 id>"`** 补回来，这比 `setHeading` **更**符合 a11y（WAI-ARIA Tabs 模式）。同时建议加 `identifier`/`data-page-id` 便于断言锚定。
4. ⚠️ **「关于」页例外**：若按 §6 选项 ①②把「关于」移出 Tab 栏，它**没有 Tab 替它承载页名** ⇒ 该页**必须保留**一个可见标题（原生 `setHeading()` 或等价的 `.rl-set-page-head` 静态标签，此时它不再承担"手风琴标题"的职责）。

---

## 8. 决策点（**已全部按「我的建议」列裁定**，2026-09-20 用户回「按你的来」）

> 裁定结果：D-1(a) 下划线 / D-2(c) 桌面带图标·窄屏藏 / D-3(a) 横向滚动 / D-4(b) 全删但关于保留 / D-5(a) 右上角图标 / D-6(a) 不铺底 / D-7(a) 2px 下划线 / D-8(a) 不要容器底线 / D-9(b) 拆常量 / D-10(a) 吸顶 / D-11(b) 图标亮起 + 关于页保留页名。
> 下表保留完整的**备选项与理由**，供后续改判时对照。

| # | 决策点 | 选项 | 我的建议 |
|---|---|---|---|
| **D-1** | **结构选型** | (a) 方案 A 下划线 / (b) 方案 B 胶囊 / (c) 方案 C 只改窄屏 | **(a)** —— 与 2026-09-14「并排切换悬停只变色」零冲突、占宽最小、成本最低 |
| **D-2** | Tab 项是否带图标 | (a) 5 项都带 / (b) 都不带 / (c) 桌面带、窄屏藏 | **(c)** —— 桌面带（复用现有 6 个实测图标）；窄屏藏 = Primer 溢出策略第一步。⚠️ ⛔ **不能只给个别项配图标**（MD 明文禁止混用） |
| **D-3** | 溢出方案 | (a) ① 横向滚动 / (b) ② ⋯溢出菜单 / (c) ③ 滚动+边缘箭头 / (d) ①+②（窄屏才上菜单） | **(a)** —— 零 JS、不引入 ResizeObserver（(b) 与 #352 既有裁定冲突，需显式豁免） |
| **D-4** | 内容区页标题 | (a) 全部删除（含「关于」）/ (b) 全删但「关于」保留 / (c) 不删 | **(b)** —— 别页有 Tab 承载页名，「关于」没有；且 (a) 会让外挂页彻底没有名字 |
| **D-5** | 「关于」安置 | (a) 右上角图标（仍是一页）/ (b) 底部次要区 / (c) 图标 + 弹层（不再是页） | **(a)** —— 始终可见、复用现有渲染、改动最小；(c) 作为后续可选升级 |
| **D-6** | 悬停是否铺底色 | (a) **不铺**（沿用 2026-09-14 裁定）/ (b) 铺（豁免该裁定） | **(a)** —— 若选 (b) 请明确「本次豁免」；胶囊方案（B）其实**依赖**铺底，两者要一起裁 |
| **D-7** | 激活标记强度 | (a) 2px 下划线 + 变色 / (b) 3px 下划线 + 变色 / (c) 仅变色（无线） | **(a)** —— 2px 是区间下限（沿用你「取区间下限」的偏好）；(c) 在 5 项并排时位置感偏弱 |
| **D-8** | 是否要容器底线（Tab 栏底部 1px 分隔线） | (a) 不要，只画激活短线 / (b) 要（仅容器宽度内，⛔ 非通栏） | **(a)** —— 通栏做不到（§2.3）；只有短线时观感最轻，与阅读器分段器同语言；若吸顶（D-10）后需要压住下方内容，改由 `background` 承担 |
| **D-9** | 「关于」外移后 `pure/settingNav` 的数据结构 | (a) 保留 6 页常量，渲染时 `filter(id !== 'about')` / (b) 拆 `SETTING_NAV_TABS`(5) + `SETTING_NAV_AUX`(1) | **(b)** —— 「5 个 Tab」与「6 个页」是两个契约，(a) 会把"关于是特例"这个事实藏在渲染层；拆开后单测能分别钉「Tab 数=5」「页数=6」。⚠️ 现有单测钉的是 **6 页顺序**，改结构要同步改测试 |
| **D-10** | Tab 栏是否吸顶（sticky） | (a) sticky / (b) 跟随滚动 | **(a)** —— #352 的左栏本来就是 `sticky`（同机制已验证）；否则在最长的那页要滚回顶部才能切页 |
| **D-11** | 「关于」激活时 Tab 栏的选中态 | (a) 5 项全不选中 + 图标亮起 / (b) 5 项全不选中 + 图标亮起 + 关于页内保留一行小标题 | **(b)** —— 这是本方案唯一的新状态，必须给用户「我在哪」的答案 |

---

## 9. 影响面 / 施工边界

### 9.1 改动文件

| 文件 | 改动 |
|---|---|
| `src/Settings.ts` | `display()` 重写：`.rl-set-shell` → `.rl-set-tabs`(5 tab) + `.rl-set-about-btn`(1) + 内容区 6 页；删 `.rl-set-page-head` 建节点与 `createSectionHeading` 调用；`setActivePage()` 补 `scrollIntoView`；补 `role="tab"/"tabpanel"` |
| `src/pure/settingNav.ts` | 按 D-9 拆常量（+ 注释说明「关于不在 Tab 栏」） |
| `styles.css` | 删 `.rl-set-nav*` 与窄屏手风琴整块；新增 `.rl-set-tabs` / `.rl-set-tab` / `.rl-set-tab-icon` / `.rl-set-about-btn`；补 `.rl-svc-group:first-child` 归零外边距 |
| `tests/settingNav.test.ts` | 按 D-9 同步（Tab 数、页数、id 唯一、默认页合法） |
| 产物断言 | ⚠️ **#352 那批锚点大面积失效**：`_s352_recheck.txt`（985 行）中凡 `.rl-set-nav*` / `.rl-set-page-head*` / `setting-item-heading` 的锚点都要重写；`_mutate_assert_352.json` 里至少 3 条突变锚点作废 |
| `_probe_settings.cjs` | 探针 DOM 必须改成新结构（四形态 → **五形态**：wide / narrow-滚动 / 溢出 / 关于激活 / dark）。⚠️ 探针 DOM 与真实结构不一致 = 自欺（#352 的教训） |
| `Project-Rule/UI-GUIDE.md` | §11 整节改写成「横向 Tab」（§11.1 结构契约 / §11.2 三态视觉口径 / §11.3 排雷） |
| 常规收口 | 双层 CHANGELOG + progress + UI-GUIDE 版本行 |

### 9.2 排雷（下一轮别再踩）

① 🔴 **若 Tab 用 `<button>`（a11y 推荐，可拿到原生键盘焦点）**，则必须重置核心按钮样式：核心 `button:not(.clickable-icon)`（特异性 **0,1,1**）会压过单类（0,1,0）⇒ 出灰底 + `--input-shadow` 内阴影 = **#351 那版「厚重感」**。写法：规则前缀提到两级（`.rl-set-tabs .rl-set-tab`，≥0,2,0），并显式 `background: transparent; border: 0; box-shadow: none; font-family: inherit;`。
   （若继续用 `<div>` 则没这个问题，但会丢键盘可达性 → 见 D-2 之外的建议：用 `<button>` 并写两级前缀。）
② 反向守卫**锚形态不锚裸名**：本稿提到的旧类名（`.rl-set-nav` / `.rl-set-page-head`）会出现在**新写的注释**里，而本仓 esbuild **不剥注释** ⇒ 锚裸类名必假红，要写 `.rl-set-nav {`（CSS）/ `cls: 'rl-set-nav'`（JS）。
③ 🔴 **激活项落在滚动区外**：`setActivePage()` 必须 `scrollIntoView`；否则窄屏切到屏外的页时，内容变了而 Tab 栏毫无反馈。
④ 🔴 **浮层（D-3 选 ② 时）必须自己挡 `mousedown`**，否则被 `onDocMouseDown` 先 `remove()`，菜单项点不动（#351e 原始故障）。
⑤ `.rl-` 前缀不可省（§3 v15 老坑）；`styles.css` 是 **CRLF**；esbuild 产物里引号变双引号。

### 9.3 明确不做

- ⛔ 不碰 Obsidian 设置弹窗**外框**（`.vertical-tab-*`）—— DOM hack，官方一改就坏。
- ⛔ 不改原生 `.setting-item` 的行高与外观（官方 guideline）。
- ⛔ 不硬编码任何颜色（亮/暗主题必崩）。
- ⛔ 不引 CSS 框架 / 不重写为 Svelte。
- ⛔ 不升 `minAppVersion`、不用 1.13+ 声明式设置页。

---

## 10. 附录：本稿的实测证据

| 证据 | 方法 | 结果 |
|---|---|---|
| 现有结构/类名/几何 | 读 `src/Settings.ts:697-731`、`styles.css:152-267` | §1.1 |
| 原生 `--tab-*` 是否存在 | `_probe_tabvars.cjs` 读 `D:\Obsidian\resources\obsidian.asar` + 上下文抽验 | **存在**（默认值见 §2.4），其中文字色偏弱**不采用** |
| 图标名可用性 | 同上，严格形态 `"name":[[` | `more-horizontal` ✅ / `ellipsis` ⛔ MISS / `info` ⛔ MISS / `badge-info` ✅ |
| 「关于」的文案引用数 | 全仓 grep `设置 →` | **0 处**引用「关于」⇒ 外移零文案成本 |
| 「数据源管理 / AI集成」的文案引用 | 同上 | **7 处** ⇒ 标签一个字不动 |
| 「隐藏插件内滚动条」是否影响 Tab 栏 | grep `rl-hide-scroll` | 只作用于 `HomeView.contentEl` 与 `EntryModal`，**不影响设置页** ⇒ 滚动条方案无冲突 |
| 阅读器分段器三态参考实现 | 读 `styles.css:2257-2273` | 未选中 `--text-muted` / 悬停 `--text-normal` / 选中 `--interactive-accent` + 600（本稿 §4.1 逐条对齐） |
| 内容区横向内距 | UI-GUIDE v42 实测 | `--size-4-12` = 48px ⇒ 通栏底线不可行 |

---

## 11. 落地与验证记录（2026-09-20 收口）

### 11.1 改了什么

| 文件 | 改动 |
|---|---|
| `src/pure/settingNav.ts` | 拆 `SETTING_NAV_TABS`(5) + `SETTING_NAV_AUX`(关于)；`SETTING_NAV_PAGES` 变**派生值**；新增 `nextTabId` / `tabStates` / `SettingTabState`；`SETTING_NAV_DEFAULT` 语义收紧为「必须落在 Tab 内」 |
| `src/Settings.ts` | `display()` 改 `shell > bar(.rl-set-tabs + .rl-set-about-btn) + .rl-set-content`；删手风琴链路；Tab 改 `button[role=tab]`；页容器加 `role=tabpanel`；`setActivePage` 三处同步 + aria + `scrollIntoView`；`createSectionHeading` 只对关于页调用；新增 `tabDomId` / `pageDomId` |
| `styles.css` | 删 `.rl-set-nav*` 与窄屏手风琴整块 media query；新增 `.rl-set-bar` / `.rl-set-tabs` / **`.rl-set-tabs .rl-set-tab`（两级前缀）** / `.rl-set-bar .rl-set-about-btn` / `.rl-set-tab-icon`；补 `.rl-set-page-body > .rl-svc-group:first-child` 归零 |
| `tests/settingNav.test.ts` | 10 → **14 例**（Tab=5 且不含 about / AUX 固定 / `PAGES = TABS + AUX` / 默认页必须落在 Tab 内 / `nextTabId` 顺序·回绕·兜底 / `tabStates` 选中与 roving tabindex 兜底） |
| `assert-symbols.cjs`（仓外） | ⑦b 整块重写为 #353 版 + 收窄一条过宽旧守卫；备份 `assert-symbols.bak-353.cjs` |
| `_probe_settings.cjs` | 🔴 加**显式拦停守卫**：它的 DOM 模板仍是 #352 版，静默跑会「量到一个不存在的界面」（自欺）⇒ 命中 `.rl-set-tabs .rl-set-tab` 时直接抛错并指向 UI-GUIDE §11 的重写要求。**待办**：按 #353 重写模板（五形态：wide / narrow-溢出 / 深色 / 关于激活 / before-#352） |
| `Project-Rule/UI-GUIDE.md` | **v83**，§11 整节重写 |
| 根 `CHANGELOG.md` / `Project-Rule/CHANGELOG.md` / `current-progress.md` | 常规收口 |

### 11.2 验证链（全部通过）

| 环节 | 结果 |
|---|---|
| `npm run build`（tsc 挡构建） | **exit 0**，告警 **87**（与基线一致） |
| 全量单测 | **103 文件 / 1738 用例全绿**（+2 例） |
| 产物断言 | **PASS 1368 / FAIL 0 / exit=0**（口径：exit code + 逐行 FAIL + 缩进检查行计数） |
| 产物级突变 | **8/8 全数被抓**（a 悬停铺底色回潮 / b 激活标记改 `border-bottom` / c 删 `min-width: 0` / d Tab 规则退回单类前缀 / e 首个子分组外边距不归零 / f 「关于」搬进滚动容器 / g 切页不 `scrollIntoView` / h 每页都加页标题） |
| 突变残留守卫 | `_guard_mut.cjs` → **干净 8 / 残留 0** |
| 部署 | 三产物 md5 三方一致（root = build = 测试库），已部署 `临时测试库` |

### 11.3 本轮新踩到的两个坑（已升格为通用纪律）

1. **通用名会被别的模块复用**：`tabs.createEl("button", {` 在 `main.js` 里命中 **5 次**（Svelte 组件也编译出了自己的 `tabs.createEl`）⇒ 「精确计数 1」的断言必须锚**完整赋值前缀**（`const tab = tabs.createEl("button", {`）。**首跑就因此假红**，靠 `_diag353.cjs` 逐条定位后修正。
2. **反向守卫要锚「范围」，别锚「全仓唯一串」**：`inset 0 -2px 0 var(--interactive-accent)` 曾被一条**全局**守卫禁掉（那轮是为阅读器侧栏页签改「无块无线」），而设置页 Tab 的激活下划线**正是这个值** ⇒ 全局守卫必然假红。已收窄为 `!/.rl-reader .rl-reader-toc-tab[^{]*\{[^}]*inset 0 -2px 0/`。

> 另有一条**自踩**：`.rl-set-tab` 起初写成**单类**选择器 —— 正好违反本稿 §9.2 自己写的「`<button>` 必须两级前缀」，被断言「两级前缀」当场抓住并改掉。
