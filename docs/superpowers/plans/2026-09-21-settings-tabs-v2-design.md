# 设置页 Tab 重构（#354）· 规范稿：合并 4 个 Tab · 固定顶部 · 内容区独立滚动

> 日期：2026-09-21 | 状态：**已落地收口**（构建 / 全量单测 / 产物断言 / 产物级突变 / 残留守卫 / 部署 / 镜像 全绿；§11 有落地与验证记录）
> 交付物：本规范稿 + 高保真稿 `2026-09-21-settings-tabs-v2-mock.html`（含亮/暗截图，可点左侧标题直接调主题与方案）
> 前置：**#353 昨天刚落地**（顶栏 5 Tab + 右上角「关于」）。本次是对它的**再改**，其中 **3 处直接推翻 #353 的裁定** —— §1.3 先列清，避免"改了不知道翻了哪条"。
> 📌 **D-1~D-12 全部采用「我的建议」档**（用户本轮的原话是追问「插件设置页还没改呢？」，即按稿执行）。

---

## 0. 三句话结论

1. **最要紧的「固定顶部 + 内容区独立滚动」已被实测证明可行，而且不用碰外框**（本项目一直的红线）。外框 `.vertical-tab-content` 本身就是 `height: 100%; overflow-y: auto`（实测自 `app.css`）⇒ `height: 100%` 的 shell + `flex: 1; min-height: 0; overflow-y: auto` 的内容区就能做到。**实测数字**：桌面面板里 **外框 scrollHeight = clientHeight（不滚）**，而 **内容区 882 > 359（在滚）** —— 滚动条只在内容区。
2. **你说的「悬停浅灰底」与你 2026-09-14 的裁定表面冲突，但实测给出了两全解**：悬停用 `--background-modifier-hover`（黑/白 **6.7%** 中性底），激活用**强调色字 + 2px 下划线**（⛔ 不铺底）⇒ 两条视觉通道分离。那条裁定的两条理由（"会连成一条色带""会和选中色互相干扰"）在这里都不成立：底色**逐项铺**（带圆角、项间还有 4px 间隙）且**激活不靠底色**。**但这条仍请你明确点头**（D-4）。
3. **合并成 4 个 Tab 后，溢出几乎消失**：实测 360pt 手机上「藏图标 + 内距 8px」时 Tab 栏内容宽 **262px = 可用 262px**（刚好，**零余量**）⇒ 因此**溢出方案仍然必须做**（零余量 + 更窄的 320pt 手机、更长文案、更宽字体主题、将来多语言都会溢出）。

---

## 1. 现状核查（先纠三处事实，否则方案会建在错的前提上）

### 1.1 ⚠️「外观」页其实只有 1 项 —— 你举的例子不是本插件的设置项

对 `src/Settings.ts` 逐页核实（`:818` / `:832` / `:855`）：

| 现有页 | 实际行数 | 实际内容 |
|---|---|---|
| 外观 | **1** | 隐藏插件内滚动条 |
| 实验性功能 | **2** | 内置阅读器打开书籍文件 / 内置播放器打开视频文件 |
| 数据管理 | **5** | 媒体库目录 / 笔记表格 / 导出备份与备份恢复 / 下载封面 / 附件清理 |
| 数据源管理 | 2 组 | 数据源启用 / 数据源凭据 |
| AI集成 | 3 组 | AI服务 / API凭据 / 语音合成 |
| 关于 | 1 区 | 支持 + 2 按钮 |

- 你写的「**主题色、字体大小、界面缩放**」**都不是插件设置项**：界面主题切换入口在 **1.0.3 已删**（`onload` 强制 `uiTheme = "modern"`）；阅读器的字体/字号/行距/字距/主题在**阅读器顶栏面板**里（`§7.10`），不在插件设置页。
- ⇒ **合并后「基本设置」= 8 行**（1 + 2 + 5），示范稿见 §7。若你要把「阅读器排版」甚至「界面缩放」搬进设置页，那是**新增功能**（要新写控件 + 落库字段），单列 D-11。

### 1.2 改名要动多少文案（硬成本，先摆出来）

| 改名 | 代码/测试里要同步的地方 |
|---|---|
| 数据源管理 → **数据源配置** | **11 处**：`pure/sourceRegistry.ts` ×5（错误处方常量 + `fixes.push`）、`views/components/EntryForm.svelte` ×1、`modals/ImportBangumiModal.ts` ×1、`pure/settingNav.ts` ×1（标签）、`tests/sourceRegistry.test.ts` ×**4（硬断言，含 toBe 全等）** |
| 数据管理 → **基本设置** | README ×5（**src 里 0 处** ⇒ 代码零改动） |
| 外观 / 实验性功能 消失 | 「实验性功能」路径文案 **0 处** ✅；「外观」全仓只有 1 处，且是 **Obsidian 自己的**设置（`设置 → 外观 → 字体 → 正文字体`，`EpubReaderModal.ts:234`）⛔ **不许改** |
| （AI集成 不变） | 15 处引用**全部不动** ✅ |

> 判据：`_grep_paths.cjs` 扫全仓「设置 → …」形态（已排除 CHANGELOG / docs / 进度表 等历史记录）。

### 1.3 🔴 本次**推翻**了 #353 的 3 条裁定（改之前先确认这是有意的）

| #353 的裁定 | 本次 | 说明 |
|---|---|---|
| D-5/D-11：「关于」移到右上角小图标 + 定「Tab 栏无选中项」的新状态规范 | **推翻** | 你要它**平级回 Tab 栏** ⇒ 那条"外挂页"规范**整条作废**，右侧内容区也不必再为它保留标题 |
| 悬停**只变色不铺底** | **推翻** | 你本轮明确要「悬停：浅灰底」（§0.2 给了两全解，但需你点头 D-4） |
| D-8：⛔ 不画容器底线 | **推翻一半** | 那是"整面板滚动"时代的口径；**改成固定栏之后内容会从栏下穿过**，没有一条底边线会糊成一片 ⇒ 固定栏**必须**有一条 `1px` 底线（§5.4） |

---

## 2. 金标准检索（流程第 1 步）

### 2.1 本轮最大的发现：**Obsidian 核心自己就有这整套配方**（全部从本机 `obsidian.asar` 实测）

| 需求 | 核心的现成做法 | 出处（app.css） |
|---|---|---|
| 横向 Tab | `.horizontal-tab-nav-item`：`padding: 4px 8px`、`border-radius: var(--radius-m)`(8px)、`font-size: var(--font-ui-small)`(13px)、**实测高 25px**；桌面激活 = `background: var(--background-modifier-hover)` | 9942-9964 |
| 缺省态 | `.horizontal-tab-nav-item` 常态**无底色**、`cursor: var(--cursor)`、`user-select: none` | 同上 |
| **固定头 + 独立滚动区** | 搜索结果区：父 `display:flex; flex-direction:column; overflow:hidden`；头 `.setting-search-container { flex-shrink: 0 }`；列表 `.setting-search-results { flex:1; **min-height:0**; overflow-y:auto }` | 499-516 |
| **隐藏滚动条 + 遮罩** | `.is-phone .menu-scroll.is-scrolled { mask-image: var(--menu-scroll-mask) }` + `.menu-scroll::-webkit-scrollbar { display:none !important }` ⇒ **用 `.is-scrolled` 类门控，不是常驻遮罩** | 20496-20505 |
| 焦点环 | `.vertical-tab-nav-item:focus-visible { box-shadow: 0 0 0 var(--input-border-width-focus) var(--background-modifier-border-focus); outline:none }` | 10072-10075 |
| 官方的"设置页" | `.setting-page.vertical-tab-content > .setting-page-titlebar + .setting-page-content` —— 官方自己也是"固定标题栏 + 内容区"两段 | 4913-4920 |

🔴 **两个不能照抄的坑**：
1. 核心的 `--menu-scroll-mask` 值 = `linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.1) 48px)`（app.css:2499）—— 按 alpha 遮罩解释这会把内容遮到**几乎不可见**，**不能抄**。核心自己在 `mobile-navbar-text` 用的是**正确形态**：`-webkit-mask-image: linear-gradient(to left, rgba(0, 0, 0, 0) var(--size-4-4), #000000 var(--size-4-8))`（20837）。
2. 核心的**激活态是"铺底"**（`--background-modifier-hover`），即「悬停 ≈ 激活」⇒ 用户**分不出**"我正悬停"和"我在这页"。这正是我们**不该**抄的地方：我们用「激活 = 强调色字 + 下划线」把两者分开。

### 2.2 外部事实标准

- **GitHub Primer `UnderlineNav`**：下划线导航的事实标准 + **两步溢出策略**（① 先隐藏图标 → ② 仍放不下才收进 More 菜单）。
- **Material Design 3 Tabs**：固定 tab 建议 ≤4 个，**数量可变就用可滚动**；激活 = **下划线 + 变色**；⛔ 一个 Tab 集里不许「有的带图标、有的不带」。
- **mask 渐隐**（多来源交叉验证）：
  - 必须 **`mask-image` + `-webkit-mask-image` 双写**（核心自己也只用前缀形式）；
  - ⚠️ **静态遮罩会撒谎**：已经滑到最右端、右边什么都没有了，遮罩却还在把最后一项遮淡 ⇒ 必须**门控**（`@supports (animation-timeline: scroll())` 或 JS 加类）；
  - ⚠️ **遮罩会裁掉边缘项的焦点环**（mask 改的是绘制、不改布局与命中）⇒ 滚动容器要给首尾留出等于渐隐宽度的安全内距。

---

## 3. Tab 结构与命名（按你给的顺序）

| 顺序 | 新标签 | id | 来源 | 页内内容 |
|---|---|---|---|---|
| 1 | **基本设置** | `basic`（新） | 数据管理 **+ 外观 + 实验性功能** | 4 组 / **8 行**（§7） |
| 2 | **数据源配置** | `sources`（不变） | 数据源管理（仅改名） | 数据源启用 / 数据源凭据 |
| 3 | **AI集成** | `ai`（不变） | 不变 | AI服务 / API凭据 / 语音合成 |
| 4 | **关于** | `about`（不变） | 右上角图标**回归**为平级 Tab | 支持区 |

- 🔴 **id 全部沿用**（只加一个 `basic`）⇒ 数据层改动最小：`SETTING_NAV_TABS` 从 5 项改 4 项、`SETTING_NAV_AUX` **删除**（关于回归 Tab）、`SETTING_NAV_DEFAULT` 由 `'sources'` 改 **`'basic'`**（第一项；否则一打开设置页就落在第二页）。
- ⚠️ **你写「5 个中文 Tab」，但列表只有 4 项** —— 我按**严格的 4 项**做（D-1）。若是想保留第 5 个入口（比如「阅读」或「播放」），请点名。
- 宽度不变：「基本设置」4 字 = 原「数据管理」4 字；「数据源配置」5 字 = 原「数据源管理」5 字。

---

## 4. Tab 三态规范（亮 / 暗均为**实测值**，探针 `_probe_vars354.cjs`）

### 4.1 三态（同一张表给两套方案）

| 状态 | 选择器 | 文字 | 字重 | 底色 | 标记 |
|---|---|---|---|---|---|
| **未激活** | `.rl-set-tabs .rl-set-tab` | `--nav-item-color` | 400 | `transparent` | — |
| **悬停** | `…:hover:not(.is-active)` | `--nav-item-color-hover` | 400 | 🔴 `--background-modifier-hover` | — |
| **激活 · 方案 A（推荐）** | `.rl-set-tabs:not(.is-pill) .rl-set-tab.is-active` | `--interactive-accent` | 600 | ⛔ 仍 transparent | `box-shadow: inset 0 -2px 0 var(--interactive-accent)` |
| **激活 · 方案 B（胶囊）** | `.rl-set-tabs.is-pill .rl-set-tab.is-active` | `--interactive-accent` | 600 | `--background-modifier-active-hover`（强调色 10%） | 无下划线 |
| **焦点**（键盘） | `…:focus-visible` | 不变 | 不变 | 不变 | `box-shadow: 0 0 0 var(--input-border-width-focus) var(--background-modifier-border-focus)`（照抄核心） |
| **按下** | `…:active` | `--interactive-accent` | 不变 | `--background-modifier-hover` | — |

- ⛔ **激活态不做"反色"**（强调色满底 + 对比字）：那是成组操作类的语言（批量栏/右键菜单），不是导航类 —— 与你 2026-09-14 的口径一致。
- **方案 A / B 二选一**（D-3）：A 的优点是"悬停底"和"激活标记"在**两个不同通道**，永不打架；B 的优点是选中更"实"，但两个底都是浅透明色（6.7% 中性 vs 10% 强调色），分辨度不如 A。

### 4.2 亮 / 暗实测色值（默认主题）

| 用途 | 变量 | 亮色实测 | 暗色实测 |
|---|---|---|---|
| 未激活 文字 | `--nav-item-color` | `rgb(92, 92, 92)` | `rgb(179, 179, 179)` |
| 悬停 文字 | `--nav-item-color-hover` | `rgb(34, 34, 34)` | `rgb(218, 218, 218)` |
| **悬停 底色** | `--background-modifier-hover` | `color-mix(in oklch, black 6.7%, transparent)` → `oklch(0 0 none / 0.067)` | `color-mix(in oklch, white 6.7%, transparent)` |
| **激活 文字 / 下划线** | `--interactive-accent` | `rgb(152, 115, 247)` | `rgb(138, 92, 245)` |
| 激活 胶囊底（B） | `--background-modifier-active-hover` | 强调色 10% → `oklch(0.6538 0.1892 293.56 / 0.1)` | 强调色 10% → `oklch(0.6035 0.2172 292.49 / 0.1)` |
| 分组标题 | `--setting-group-heading-color` | `rgb(34, 34, 34)` | `rgb(218, 218, 218)` |
| Tab 栏底线 | `--background-modifier-border` | `rgb(228, 228, 228)` | `rgb(51, 51, 51)` |
| 焦点环 | `--background-modifier-border-focus` | `rgb(189, 189, 189)` | `rgb(85, 85, 85)` |
| 面板底色 | `--background-primary` | `rgb(255, 255, 255)` | `rgb(28, 28, 28)` |
| 控件区底色 | `--background-secondary` | `rgb(246, 246, 246)` | `rgb(40, 40, 40)` |

> 🔴 **实现里一个字面色值都不许出现**（⛔ 连 `#000` 都要避免 —— 遮罩渐变里那个 `#000000` 是**alpha 遮罩的"全不透明"语义**，与主题无关，是唯一例外，核心自己也这么写）。

### 4.3 尺寸

| 项 | 规格 | 依据 |
|---|---|---|
| Tab 栏高 | **40px**（项 36px + 底线） | 与 #353 同值（D-8 区间下限）；核心横向 tab 只有 25px 高，**偏矮、不适合触屏**，我们取 36 |
| Tab 项 | `padding: 0 10px`、图标-文字 `gap: 6px`、`border-radius: var(--radius-m)`(8px) | 圆角取核心横向 tab 的值 |
| 项间距 | `gap: var(--size-4-1)` = 4px | 底色逐项铺时，间隙让它们**不连成色带** |
| 字号 / 图标 | `--font-ui-small`(13px) / `1em` | 同 #353（图标 ⛔ 不用绝对 px） |
| 下划线 | `inset 0 -2px 0`（⛔ 不用 `border-bottom`，会给激活项 +2px 高度顶动文字） | #353 既有纪律 |
| 窄屏（< 720px） | **藏图标** + `padding: 0 8px` | Primer 溢出策略第一步（D-2） |

---

## 5. 布局技术要求：固定顶部 + 内容区独立滚动

### 5.1 结构（照真实外框，**不碰外框**）

```
.modal.mod-settings
└─ .vertical-tab-content-container            ← 核心：position:relative; overflow:hidden; flex-grow:1
   └─ .vertical-tab-content                    ← 🔴 核心：height:100%; overflow-y:auto; padding-inline:48; padding-top:48
      └─ .rl-set-shell                         ← 我们：display:flex; flex-direction:column; height:100%
         ├─ .rl-set-bar                        ← 我们：flex:0 0 auto（天然固定，⛔ 不再需要 position:sticky）
         └─ .rl-set-content                    ← 我们：flex:1; min-height:0; overflow-y:auto  ← 唯一滚动条
            ├─ .rl-svc-group（外观与体验）
            ├─ .rl-svc-group（实验性功能）
            ├─ .rl-svc-group（数据与备份）
            └─ .rl-svc-group（封面与清理）
```

### 5.2 为什么可行（实测，不是推断）

| 依据 | 实测 |
|---|---|
| 外框有**确定高度** | `.vertical-tab-content { height: 100% }`（app.css:444-450），父 `.vertical-tab-content-container { flex-grow: 1; overflow: hidden }`（438-442）⇒ `height:100%` 在 shell 上**能解析出确定值** |
| 效果 | 桌面面板：**外框 scrollHeight = clientHeight = 518（不滚）**；**内容区 scrollHeight 882 > clientHeight 359（在滚）** |
| 手机 | 同上（360pt 面板：外框 338 = 338，内容区 1377 > 179） |
| ⚠️ 反向风险 | 若哪天核心把 `height:100%` 去掉，shell 的 `height:100%` 会退化成 `auto` ⇒ **自动退回「整面板滚动」**：功能不坏、只是滚动条位置回到外框。**这个降级是安全的**，可以接受 |

### 5.3 CSS（草案）

```css
.rl-set-shell { display: flex; flex-direction: column; height: 100%; }
.rl-set-bar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--size-4-2);
  padding-bottom: var(--size-4-2); border-bottom: 1px solid var(--background-modifier-border); }
.rl-set-content { flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding-top: var(--size-4-3); scroll-padding-block: var(--size-4-3); }
```
> 🔴 **`min-height: 0` 是这条公式必须的那一行**（核心搜索列表同款写法）：flex 项默认 `min-height:auto` ⇒ 会被内容撑高、`overflow` 永不生效，整页又变回"外框在滚"。

### 5.4 连带的 3 件事（漏一条就不对）

1. **`.rl-set-bar` 不再需要 `position: sticky`** —— 它在 flex 列里天然固定（#353 的 sticky 是"整面板滚动"时的替代方案）。
2. 🔴 **固定栏必须加一条 `1px` 底线**：内容会从栏下穿过，没有线会糊在一起。（**这推翻了 #353 的 D-8"不要容器底线"** —— 那条的前提是"整面板一起滚"，现在前提变了。）
3. **内容区自己滚之后，外框的 `scroll-padding-block` 不再作用于它** ⇒ 滚动容器要自带 `scroll-padding-block`（把焦点滚进视野时不会被栏遮住）。

---

## 6. 溢出处理（隐藏滚动条 + 门控遮罩）

### 6.1 先看实测宽度（4 个 Tab）

| 场景 | Tab 栏可用宽 | Tab 内容实测宽 | 结论 |
|---|---|---|---|
| 桌面面板 900px（右侧内容区 730 → 去内距 634） | 634 | **634** | 不溢出，绰绰有余 |
| 手机 360pt（含图标，`padding:0 10px`） | 262 | **350** | 🔴 溢出 88px |
| 手机 360pt（**藏图标 + `padding:0 8px`**） | 262 | **262** | ✅ **刚好放下（零余量）** |
| 更窄手机 320pt 推算 | 222 | 262 | 🔴 溢出 40px |

⇒ **合并成 4 个 Tab 后溢出已接近消失，但不能省掉溢出方案**：零余量意味着「任一文案变长 1 字 / 更宽的主题字体 / 将来多语言 / 320pt 手机」都会溢出。

### 6.2 方案：隐藏滚动条 + **门控**遮罩

```css
/* ① 藏滚动条（触控板/滚轮仍可滚；shift+滚轮 ≈ 横滚） */
.rl-set-tabs { scrollbar-width: none; -ms-overflow-style: none; }
.rl-set-tabs::-webkit-scrollbar { display: none; }
/* ② 遮罩：只遮"确实还有内容"的那一端 —— 由 .is-overflow-start/.is-overflow-end 门控 */
.rl-set-tabs.is-overflow-end {
  -webkit-mask-image: linear-gradient(to right, #000000 0, #000000 calc(100% - 28px), rgba(0, 0, 0, 0) 100%);
          mask-image: linear-gradient(to right, #000000 0, #000000 calc(100% - 28px), rgba(0, 0, 0, 0) 100%);
}
.rl-set-tabs.is-overflow-start {
  -webkit-mask-image: linear-gradient(to right, rgba(0, 0, 0, 0) 0, #000000 28px, #000000 100%);
          mask-image: linear-gradient(to right, rgba(0, 0, 0, 0) 0, #000000 28px, #000000 100%);
}
/* 两端都要（滑动中）时合并成一条四停渐变 */
```

- **门控实现（二选一，D-5）**：
  - **(a) 零 JS**：`@supports (animation-timeline: scroll()) { animation-timeline: scroll(self inline); }` + 关键帧自动收边 —— 最优雅，但**是否支持要实测**（核心没用这个特性，`app.css` 里 0 命中）。
  - **(b) 同核心**：`scroll` 事件里按 `scrollLeft / scrollWidth / clientWidth` 加/摘 `.is-overflow-start|end` —— 核心自己的 `.is-scrolled` 就是这么做的，**确定可行**，代价是一个监听器。
- 🔴 **`28px` 的安全边**（否则遮罩会把首/尾项的**焦点环**裁掉）：`.rl-set-tabs { padding-inline: var(--size-4-4) }`（16px 起渐隐到 32px 全不透明；实测核心用的是 `--size-4-4` → `--size-4-8`）。⚠️ 这会让"零余量"场景变成"溢出 32px"，即 360pt 手机上要多滑一点点 —— 见 D-7。
- ⛔ **不要用常驻遮罩**：那是"撒谎"的遮罩（滑到右端还把「关于」遮淡），也会让最后一个 Tab 看起来像坏了。

---

## 7. 「基本设置」页内部排版（示范稿：4 组 / 8 行）

| 组 | 图标（已在实测白名单内） | 行 |
|---|---|---|
| **外观与体验** | `sliders-horizontal` | 隐藏插件内滚动条 |
| **实验性功能** | `flask-conical` | 内置阅读器打开书籍文件 · 内置播放器打开视频文件 |
| **数据与备份** | `hard-drive` | 媒体库目录 · 笔记表格 · 导出备份与备份恢复 |
| **封面与清理** | `trash-2` | 下载封面 · 附件清理 |

- **分组标题直接用现有的 `.rl-svc-group`（13px/600 + 图标 + 内容缩进一档）** ⇒ **零新样式**、零新断言面。
- **组间靠间距，⛔ 不画分割线**（D-6）：8 行里插 4 条线会把面板切碎；分组标题本身已有足够强度（600 + 图标）。若你要更强的分隔，可在组标题上压一条 `--background-modifier-border` 的 `1px` 短线（只铺标题宽，不通栏）。
- 「实验性功能」这个词**保留为组名**（它承载"这些开关还不稳"的用户预期），只是从"页"降级成"组"。
- 图标必须进 `SETTING_GROUP_ICONS` 白名单（4 个新键；`setIcon` 遇未知名字**静默失败**）。

---

## 8. 决策点

| # | 决策点 | 选项 | 我的建议 |
|---|---|---|---|
| **D-1** | Tab 数量 | (a) 按列表做 **4 个** / (b) 保留第 5 个入口（请说明是什么） | **(a)** —— 你写的「5 个中文 Tab」应是上一版计数 |
| **D-2** | Tab 图标 | (a) 桌面带 / 窄屏藏 / (b) 都带 / (c) 都不带 | **(a)** —— 实测带图标在 360pt 上溢出 88px，藏了刚好放下 |
| **D-3** | 激活样式 | (a) **下划线**（方案 A）/ (b) 胶囊（方案 B） | **(a)** —— 与"悬停底色"不在同一视觉通道，永不打架 |
| **D-4** | 悬停铺浅灰底 | (a) 铺（本轮你的明确要求）/ (b) 不铺（回 #353） | **(a)** —— 但请确认这是**有意修订** 2026-09-14 那条（理由见 §0.2；我会把这条写进规范，避免下次又被"回滚"） |
| **D-5** | 遮罩门控 | (a) 纯 CSS（`animation-timeline`，需实测支持）/ (b) JS 加类（同核心） | **(b)** —— 与核心同源、确定可行；(a) 作为"实测支持后的可选升级" |
| **D-6** | 基本设置页分组分隔 | (a) 只用间距 / (b) 间距 + 组标题上的短线 | **(a)** |
| **D-7** | 遮罩安全边（防裁焦点环） | (a) 加 16px 内距（零余量场景会变成多滑 32px）/ (b) 不加（焦点环在首尾项会被吃掉一角） | **(a)** —— 焦点环被裁是可达性缺陷（键盘用户找不到焦点） |
| **D-8** | 默认落哪一页 | (a) 基本设置（第一项）/ (b) 数据源配置（现状） | **(a)** —— 否则一打开就落在第二页 |
| **D-9** | 内容区去掉页标题的范围 | (a) 4 页**全去**（含关于）/ (b) 关于保留 | **(a)** —— 「关于」回归 Tab 后已有 Tab 承载页名；`createSectionHeading` 随之整体删除（死代码不留） |
| **D-10** | 「关于」的胶囊/下划线是否与其它三项一致 | (a) 一致 / (b) 右边距自动（推到最右） | **(a)** —— 一致；⛔ 不要为了"次要"把它推到最右，那又会变成第 4 个"外挂项" |
| **D-11** | 是否顺带把「阅读器排版 / 界面缩放」搬进基本设置 | (a) 不做 / (b) 做（新增功能，另立一轮） | **(a)** —— 本轮先做"合并 + 布局"，新增控件是另一件带落库的事 |
| **D-12** | 改名的连带文档 | (a) 同步 README + 测试硬断言 + UI-GUIDE（11 处代码/测试）/ (b) 只改 UI 标签、文案留旧 | **(a)** —— ⛔ 不改就会指向不存在的入口（本项目已有这条纪律） |

---

## 9. 影响面与施工边界

| 文件 | 改动 |
|---|---|
| `src/pure/settingNav.ts` | `SETTING_NAV_TABS` 5→**4**（新增 `basic`、`about` 回归、删 `SETTING_NAV_AUX`）；`SETTING_NAV_DEFAULT='basic'`；`SETTING_GROUP_ICONS` 加 4 键；`tabStates`/`nextTabId` 的 TABS 语义随之更新（附属页兜底分支**可删** → 但建议**保留**，见 D-9 备注） |
| `src/Settings.ts` | 合并 `renderAppearancePage`/`renderExperimentalPage` 进 `renderDataPage` → 改名 `renderBasicPage`（4 组）；`display()` 删 `.rl-set-about-btn`（回归 Tab）；`.rl-set-bar` 不再 sticky；`createSectionHeading` 整体删除；删 `isAux` 分支 |
| `styles.css` | `.rl-set-shell` 改 flex 列 + `height:100%`；`.rl-set-content` 加 `flex:1; min-height:0; overflow-y:auto`；`.rl-set-bar` 去 sticky、加底线；三态改为「悬停铺 `--background-modifier-hover`」；溢出遮罩三条规则 + 藏图标媒体查询 |
| `tests/settingNav.test.ts` | Tab=4、顺序、默认页、`about` 在 Tab 内（原"附属页不在 Tab 内"那条**反转**） |
| `tests/sourceRegistry.test.ts` | **4 条硬断言**的路径文案（数据源管理 → 数据源配置） |
| 路径文案 | `sourceRegistry.ts` ×5 / `EntryForm.svelte` ×1 / `ImportBangumiModal.ts` ×1 / README ×5 |
| 产物断言（仓外 `assert-symbols.cjs`） | ⑦b 块**第三次重写**：#353 那批锚点（`.rl-set-about-btn` / 只有关于有标题 / 吸顶）全部失效 |
| `_probe_settings.cjs` | 仍是 #352 版（#353 已给它加了拦停守卫）⇒ 本轮的**布局验证靠新探针**（`_probe_vtab.cjs` + `_gen_mock354.cjs` + `_measure_mock354.cjs`），它要按 #354 重写 |
| UI-GUIDE | §11 第二次重写（v84）+ 版本行 |
| 双层 CHANGELOG + progress | 常规收口 |

**明确不做**：⛔ 不碰 Obsidian 设置外框（`.vertical-tab-*`）；⛔ 不改原生 `.setting-item` 外观；⛔ 不硬编码颜色；⛔ 不升 `minAppVersion`；⛔ 不为"好看"给 Tab 栏加阴影/渐变。

---

## 10. 附录：本稿的实测证据

| 证据 | 方法 | 结果 |
|---|---|---|
| 外框是"定高 + 独立滚动" | `_probe_vtab.cjs` 抽真实 `app.css` | `.vertical-tab-content { height:100%; overflow-y:auto }` + 容器 `flex-grow:1; overflow:hidden` |
| 核心横向 Tab 语言 | 同上 | `.horizontal-tab-nav-item`：4px/8px 内距、radius 8px、13px、高 25px、桌面激活 = 铺 `--background-modifier-hover` |
| 核心的"固定头 + 独立滚动" | 同上（搜索结果区） | `flex-shrink:0` + `flex:1; min-height:0; overflow-y:auto` |
| 核心的"隐藏滚动条 + 门控遮罩" | 同上 | `.is-phone .menu-scroll.is-scrolled { mask-image: … }` + `::-webkit-scrollbar{display:none!important}` |
| 亮/暗变量实测值 | `_probe_vars354.cjs`（无头 Chrome + 真实 app.css；主题类同挂 html+body） | 见 §4.2（35 个变量 × 2 主题） |
| 4 个 Tab 的真实宽度 | `_measure_mock354.cjs`（量高保真稿） | 带图标 350px / 藏图标 262px / 可用 262px |
| **固定栏 + 独立滚动成立** | 同上 | 外框 518=518（不滚）· 内容区 882>359（在滚） |
| 真实图标路径 | `_gen_mock354.cjs` 从 asar 抽 `[[线宽,"路径"],…]` | 7 个图标全部命中（高保真稿里是真图标，不是占位） |
| 改名影响面 | `_grep_paths.cjs` 分类统计 | §1.2 |

---

## 11. 落地与验证记录（已收口）

> 🔴 **后续变更（#357，2026-09-21 同日）**：用户看到实机后提出两条几何修正 —— ① Tab 整组**居中**；② **滚动条要像别的插件那样贴「界面边缘」**。
> 第 ② 条与本稿的「内容区独立滚动」**互斥**：外框横向内距实测是 `max(var(--size-4-8), var(--setting-group-center-offset))`（面板越宽内容越往里缩，动态值纯 CSS 拿不到）⇒ 自己滚的内容区，滚动条必然画在内容盒右缘。
> ⇒ **本稿 §5 / §11.2 那套 `flex 列 + height:100% + 内容区 overflow-y` 已撤回**，改为「**外框滚 + 栏 `sticky`**（`top: calc(-1 * var(--size-4-12))` 补偿外框上内距）+ Tab `justify-content: safe center`」。
> 现行口径见 **UI-GUIDE §11.2 / §11.3（v87）**，实测证据与判据见下方 §11.3 的 #357 行。

### 11.1 决策点全部按「我的建议」档执行（D-1~D-12）

| # | 采的档 | 落地形态 |
|---|---|---|
| D-1 | **(a) 4 个 Tab** | 基本设置 / 数据源配置 / AI集成 / 关于（你写的「5 个」应是上一版计数） |
| D-2 | **(a) 桌面带图标 / 窄屏藏** | `@media (max-width: 719px) { .rl-set-tab-icon { display:none } .rl-set-tab { padding: 0 8px } }` |
| D-3 | **(a) 下划线** | 激活 = `--interactive-accent` + 600 + `box-shadow: inset 0 -2px 0`（⛔ 不铺底） |
| D-4 | **(a) 悬停铺浅灰底** | `background: var(--background-modifier-hover)`；写进 UI-GUIDE §11.3 并注明「**推翻 #353**、与 2026-09-14 不冲突」的理由 |
| D-5 | **(b) JS 加类门控** | `syncTabsOverflow()` + `scroll` / `resize` 监听 + `hide()` 摘除（与核心 `.is-scrolled` 同款） |
| D-6 | **(a) 只用间距** | 4 组之间不画任何分割线 |
| D-7 | **(a) 加 16px 安全内距** | `padding-inline: var(--size-4-4)` + **负 `margin-inline` 抵消**（首项仍与内容左缘对齐，实测 `firstAligned=true`） |
| D-8 | **(a) 默认落第一项** | `SETTING_NAV_DEFAULT = 'basic'` |
| D-9 | **(a) 4 页全去页标题** | `createSectionHeading` 整体删除（产物断言 + 反向守卫钉死） |
| D-10 | **(a) 与其它三项一致** | 「关于」就是第 4 个普通 Tab，⛔ 没有被推到最右 |
| D-11 | **(a) 不做** | 阅读器排版 / 界面缩放**没有**搬进设置页（那是另一件带落库的新增） |
| D-12 | **(a) 同步文档与测试** | `sourceRegistry` ×5 + `EntryForm` + `ImportBangumiModal` + `settingNav` + `tests/sourceRegistry` ×4 + README ×6 |

### 11.2 落地清单

| 文件 | 改动 |
|---|---|
| `src/pure/settingNav.ts` | 4 Tab（`basic`/`sources`/`ai`/`about`）；**删 `SETTING_NAV_AUX`**；`PAGES = [...TABS]`；默认页 `basic`；图标表 +4 组；注释全面改写 |
| `src/Settings.ts` | `display()`：去外挂「关于」按钮、去 `isAux` 分支、去页标题；新增 `tabsEl` / `syncTabsOverflow` / `onTabsScroll` / `onWindowResize` / `hide()`；`setActivePage` 末尾补 `syncTabsOverflow()`；三页渲染方法合并为 `renderBasicPage` + `renderAppearanceRows` / `renderExperimentalRows` / `renderDataBackupRows` / `renderPosterCleanupRows`；**删 `createSectionHeading`** |
| `styles.css` | `.rl-set-shell` 改 flex 列 + `height:100%`；`.rl-set-bar` 去 sticky + 加底线；`.rl-set-tabs` 加 `gap: var(--size-4-1)` / 藏滚动条 / 安全内距；`.rl-set-content` 加 `flex:1 + min-height:0 + overflow-y:auto`；**新增遮罩三条规则**；删 `.rl-set-about-btn` 全部规则 |
| 文案 | `pure/sourceRegistry.ts` ×5、`EntryForm.svelte`、`ImportBangumiModal.ts`、`tests/sourceRegistry.test.ts` ×4、README ×6 |
| 测试 | `tests/settingNav.test.ts` 14→**15** 例（4 Tab / 顺序 / 默认页 / 每个 id 恰好一个 `tabindex=0` / 模块**不得再导出** `SETTING_NAV_AUX`） |

### 11.3 实测证据（`_probe_set354.cjs`：真实 `app.css` + 真实 `styles.css` + 复刻 `display()` 的 DOM）

| 判据 | 实测 |
|---|---|
| 外框不滚 | **632 / 632**（`滚=false`） |
| 内容区在滚 | **819 / 469**（`滚=true`，`overflow-y=auto`、`min-height:0px`） |
| 🔴 固定顶栏 | 内容区滚到底后 **栏的 top 位移 = 0px**（`position: static` —— 不再靠 sticky） |
| 底线 / 栏高 | `1px solid` / **39px**（项 36 + 2 + 1） |
| 首个 Tab 与内容左缘 | **对齐**（`padding-inline:16px` + `margin-inline:-16px` 抵掉） |
| 三态（亮） | 未激活 `rgb(92,92,92)` / 悬停 `rgb(34,34,34)` + 底 `oklch(0 0 none / .067)` / 激活 `rgb(152,115,247)` + 底透明 + 600 + `inset 0 -2px 0` |
| 三态（暗） | 未激活 `rgb(179,179,179)` / 悬停 `rgb(218,218,218)` + 底 `oklch(0.999994 0.0000497986 none / .067)` / 激活 `rgb(138,92,245)` ⇒ **零硬编码**（暗色只挂 `theme-dark` 类，值全部由真实 `app.css` 给出 —— ⛔ 不手写变量值，否则是「用手写值证明零硬编码」的循环论证） |
| 遮罩门控 | `is-overflow-end` 生效 ✓ / 两端同时生效 ✓ |
| **#357 滚动条贴界面边缘** | 外框 **1018/632 在滚**、**滚动条占 15px 画在外框内缘**；内容区 799/799 不滚 |
| **#357 栏固定** | 滚到底后**栏顶 == 外框顶**（`barStuckToFrame=true`）；⚠️ 参照物是外框顶、不是面板顶（两者差 17px 是模态自身内距） |
| **#357 Tab 居中** | `justify-content: safe center` ⇒ 左右空档相等（各 **137.31px**）；360pt 溢出时**首项完整可见**（`safe` 降级正确） |
| 溢出（面板 360 / 320） | 可用 294 / 254，内容 **382** ⇒ 溢出 **88 / 128px**（滚动不是可选项） |

### 11.4 验证链

| 环节 | 结果 |
|---|---|
| 构建（tsc 挡构建） | exit 0，告警 **87**（与基线一致） |
| 全量单测 | **103 文件 / 1742 用例全绿**（settingNav 14→15） |
| 产物断言 | **1391 PASS / 0 FAIL / exit=0**（本批 **+11**；改判 5 条：两处处方文案、`trash-2` 计数 4→5、路径层级、`.rl-set-bar` 窗口） |
| 产物级突变 | **10/10 全数被抓**（M356-a…j） |
| 残留守卫 | **干净 10 / 残留 0** |
| 部署 | 三产物 md5 三方一致：`main.js 2b85c72ac458` / `manifest.json 1bbdf3e00d9f` / `styles.css e884f9d14a5f` |
| 镜像 | apply 成功 **10 项**；「无多余文件 / LICENSE 一致」 |

### 11.5 一条值得记的「假绿」（本轮实证）

M356-h 首版设计的是「把 `SETTING_NAV_AUX` 常量加回来」，断言写的是产物里 `!/SETTING_NAV_AUX = \{/` —— 结果**假绿**：那个常量**没有任何人 import**，esbuild 的 **tree-shaking 直接把它从 `main.js` 摇掉了** ⇒ 产物里根本不存在，断言自然通过。
🔴 **教训：用产物断言守卫「某个死常量不得回潮」是无效的**（死代码进不了产物）。修法两条并用：
⑴ 把突变改成**行为型**（本轮改为「把 `about` 从 `SETTING_NAV_TABS` 删掉」⇒ 入口与页都少一个，产物断言必红）；
⑵ 在**单测**里守模块的导出形状（`expect(Object.keys(await import('pure/settingNav'))).not.toContain('SETTING_NAV_AUX')`）—— 那里 import 是真解析，摇不掉。

