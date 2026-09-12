# CHANGELOG.md — ReelLudic 更新记录

> 版式：按版本分节，节内分「新增功能 / 界面美化 / 体验优化 / 问题修复 / 内部开发者」五类。
> 版本号规则：manifest.json 与 package.json 同步，`npm run version` 统一回写。

## 1.0.3 · UI 双主题（原生 / 现代）— 2026-09-12

> **两正交维度**：明暗由 Obsidian 管（`body.theme-light` / `.theme-dark`），原生/现代由插件管（`body.rl-theme-modern`）→ 必须按 **2×2 组合**验收。默认 `native`，`native` 与 1.0.2 **逐像素一致**（本版首要验收标准）。

> **① 令牌层 `--rl-t-*`（形态，与颜色的 `--rl-*` 正交）**：`styles.css` 内 `:root` 18 键给原生原值 + `.rl-theme-modern` 覆盖 12 项。管圆角 / 阴影 / 位移 / 时长 / 缓动。**三条纪律**：⑴**顺序敏感** —— `.rl-theme-modern` 必须写在令牌 `:root` **之后**，否则 modern 覆盖静默失效（已加机器断言）；⑵**fallback 必须给原值** —— 一律写 `var(--rl-t-radius-lg, 8px)`，第二参数缺失时令牌解析不到会让属性变**空白**（静默破样式，本机制最危险的失败模式；断言用平衡括号扫描逐个校验，朴素 `[^)]+` 会在 `rgba()` 内层 `)` 处截断 —— 本日踩过两次）；⑶**诊断口诀：某处主题 B 不生效 = 该处值仍是硬编码**。

> **② 🔴 只迁移「能精确匹配某一档位」的原值（用户 2026-09-12 当场裁定）**：档位实际值为 `sm`=3px（**两主题相同**）/ `md`=6px→modern **10px** / `lg`=8px→modern **16px** / `pill`=999px（两主题同）。映射 = `3px→sm` / `6px→md` / `8px→lg` / `999px→pill`；**无档位的值（`2/4/5/7/9/10/12px`）保持硬编码**。⚠️ 计划里的映射表曾写「吸附到最近档位」，与「native 逐像素不变」的验收标准直接冲突，且 `10px→md` 在 modern 下仍是 10px（等于没迁移）—— **实施前必须与令牌层实际值对账，别照抄计划的估算表**。本裁定影响 Task 4（20 处未迁移）与 Task 5（`4px`×15 / `2px`×6 / `5px`×1 / `3px`×1 / `10px`×1 未迁移）。

> **③ 主题挂载单点 = `document.body`（替代原设计的 `RlModal` 共享基类）**：设计文档 §3.3 的 `RlModal` 基类方案**已在计划阶段废弃**，原因：⑴**收益不足** —— 16 个 Modal 中仅 4 个持有 `plugin` 引用，其中 3 个（阅读器 / 播放器）又属排除范围，为挂一个类改 16 个文件的继承链成本远超收益；⑵**风险更低** —— 继承链改造触碰全部弹窗构造路径属 P1 风险，`body` 挂载零侵入；⑶**原方案优点保留** —— body 单点**天然覆盖未来新增弹窗**。故 `src/modals/*.ts` **16 个文件一行不改**。此决策已告知用户（计划文末「与设计文档的差异说明」）。

> **④ 页签为唯一组件内结构分支**：`{#if uiTheme === 'modern'}` 增删 DOM 节点（变不出指示器、删不掉图标）—— 变量改不了 DOM，**结构差异必须走结构分支**。modern = 胶囊容器 + 描边滑动指示器 + **纯文字无图标**；`TAB_PAD=5` 必须与 CSS `padding:5px` 及指示器 `top/left:5px` **三处一致**；窄栏 `overflow-x:auto` 横向滚动、**不压缩字号**。⚠️ Svelte `$:` 响应式块**必须显式引用**依赖（仅写在函数体内 Svelte 不登记），节点在 `{#if}` 内**后挂载**时需 `void indEl` 建立依赖，否则指示器不动。

> **⑤ 切换即时且静默**：`applyUiTheme()` 顺带调 `HomeView.setUiTheme()` 只重推 prop，**不走 `refreshViews()`**（那会连带 `list()` 全量条目 = 无谓磁盘 IO）；设置页下拉 onChange 不弹 Notice。

> **⑥ 🔴 `main.ts:175` `this.settings.colorTheme = 'mono'` 不是死代码，勿删（修正原判断错误）**：既有内部文档曾判断「`colorTheme` 的硬写已解除」—— **恰好相反**。v0.0.1 曾有「色彩主题：彩色/单色」设置项；磁盘残留 `colorTheme:"colorful"` 的老用户靠这**唯一**纠正点兜底，删掉会让 `MediaList` 类型色条复活（Svelte prop 默认值也是 `'colorful'`）且设置页已无入口、**用户无法自救**。已加注释「不是死代码，别删」+ `assert-symbols.cjs` 正向断言 `colorTheme = "mono"` **守住该兜底存在**（防将来有人当死代码再删一次）。

> **⑦ 现代弹窗骨架 + 沉浸式显式排除**：`styles.css` 尾部追加 `.rl-theme-modern .modal`（圆角令牌 / `--rl-t-shadow-modal` 大阴影 / 去边框）+ `.rl-theme-modern .modal.rl-reader-immersive`（`border-radius:0; box-shadow:none`）。⚠️ **两者特异性均为 (0,2,0)，靠书写顺序决胜 → 排除规则必须排在骨架之后**；顺序颠倒会让阅读器被套上圆角（已加顺序断言 + 突变验证）。**阅读器（TXT/EPUB/PDF）与播放器不参与主题化**。断言禁 `!important`。

> **⑧ 令牌迁移实施面**：Task 3 `MediaList.svelte`（24 处：md×9 / lg×4 / pill×5 + 卡片/菜单 4 处阴影令牌 + 悬停 lift/scale）；Task 4 四组件 33 处（CalendarBoard 8 / TrackingBoard 6 / StatsBoard 4 / EntryForm 15）；Task 5 `styles.css` 全局层（md×29 / lg×4 / pill×5 + PDF 页卡阴影）。⚠️ `.rl-tip` 提示气泡**阴影不参与主题化**（气泡应跨主题一致），其圆角固定为 md 原值 6px 保证 modern 下也不变。

> **⑨ 验证手段**：每任务独立探针 + **突变测试**证明断言非橡皮图章。Task 5 探针 **47/47**、突变 **13/13 全数被抓**（含撤 fallback / 改错 fallback / 漏迁移 / 删排除规则 / 倒置顺序 / 加 !important / 令牌块移位 / 误迁移 4px）。⚠️ **突变测试暴露探针自身两处空断言**：⑴`css.indexOf(':root {')` 命中的是 Obsidian 基础变量块（第 11 行）而非令牌层（第 62 行）→ 改锚定 `--rl-t-radius-sm`；⑵`.rl-theme-modern .modal.rl-reader-immersive` **以 `.modal.rl-reader-immersive` 为子串**，全局 `includes`/正则会被另一处满足 → 空断言，必须**分别取块**校验。**这是「断言写了 ≠ 断言有效」的实证**。

> **⑩ 🔴 本日 git 对象库第二次静默损坏**：`git commit` 报 `fatal: could not parse HEAD`，`git fsck` 显示 `refs/heads/master: invalid sha1 pointer`；本会话 7 个 commit 全部丢失不可找回（最新幸存对象为 11:37 的 `8727a6a`）。恢复法：备份 `.git` 出工作区 → `mv .git .git-broken-20260912`（**必须移出工作区**，留里面污染 `git status`）→ `git init` → 回退基线 → **单根快照 commit**（message 注明损坏 + 所含原始 commit）→ 按任务逐个重放。**重放勿整文件 cp**（会带进其他任务的未完成改动）→ 逐块精确拼接 + 匹配次数断言 + 回读 `diff`（本轮 `styles.css` 踩了「截取块漏 7 行头注释」的 off-by-N，靠 `diff` 而非脚本自检发现）。**零实际工作丢失，仅历史丢失**。教训：**每个大任务完成即 commit 并立刻 `git log -1` 验证可读**。

> **⑪ 交付数字**：全量测试 **65 文件 / 1034 用例全绿**；构建告警 **87**（与基线一致）；`assert-symbols.cjs` 新增 1.0.3 段（正向 7 js + 5 css、反向 2、防误删 2、顺序 2、fallback 全量扫描、colorTheme 兜底、native 形态 3）；UI-GUIDE **v5** 新增 §6（主题 B 豁免清单：阴影堆叠 / 圆角夸张 / 滑动动画 / 主按钮辉光，**边界** = 仅限 `.rl-theme-modern` 作用域、不含渐变/3D 倾斜/emoji/呼吸动画/`!important`、**文字对比度仍须 AA**）+ §6.1 令牌层使用纪律。Commit：`24e9a43`(T0) → `51b2b2b`(T1+2) → `80c1fd6`(T3) → `2ca7e5e`(T4) → `743e584`(T5) → `6d59c1f`(T6) → `822d470`(T7) → `b6cbf77`(T8)。
> **⑫ 终审（独立 code review）后的收尾三修**：审查结论 **SHIP WITH NITS**（无 P0/P1）。三条 P2 已修：⑴**`--rl-t-shadow-cta` 曾是死令牌**（声明了零引用，而 §6 豁免表已把它写成「已豁免的主按钮辉光」——文档承诺落空）→ 接入 `.rl-btn-primary, .rl-ex-btn-primary` 的 `box-shadow: var(--rl-t-shadow-cta, none)`，native 下 fallback 为 `none` **零观感变化**；⑵**`--rl-t-ease` 曾是死令牌**（页签过渡写死 `ease`）→ 改 `var(--rl-t-ease, ease)`；⑶**modern 未复位 `:active` 缩放**（`.rl-tabs button:active { transform: scale(.96) }` 是原生按钮抖动，modern 分段控件下属网页风）→ 补 `.rl-tabs.rl-tabs-modern button:active { transform: none }`，native 保留原抖动。新增 **死令牌清算断言**：遍历令牌层所有声明，在 `styles.css` **与 `main.js` 两处**找引用，无人用即 FAIL（⚠️ 首版只扫 `styles.css`，把 12 个「组件内引用」的令牌误判为死代码 —— 令牌可被全局层或 Svelte 注入层引用，**两处都要扫**）。另加 4 条突变验证全数被抓。⚠️ **审查的另一条「阅读器内部按钮拿不到 10px 圆角」经复核为误报** —— 那些按钮都带 `.rl-btn` 类，而 `.rl-btn` 的圆角早已是 `var(--rl-t-radius-md, 6px)`（`styles.css:562`，Task 5 已迁移）→ 现代主题下自动变 10px，**无需改动**（审查者按 Svelte 组件样式推断，未察这些控件实际由全局 `.rl-btn` 定样式）。



> **⑬ LICENSE 源/镜像不一致裁定与统一（2026-09-12）**：终审时发现工作区源 `LICENSE`（795B / 19 行**短版 GPL-3.0 声明**）与公开镜像 `LICENSE`（35149B / 674 行 **GNU 官方全文**）**内容不同**（非行尾差异），按红线 10「不一致时停下报告、不得自动修复」停止并上报。**用户裁定：统一用 GNU 官方 GPL-3.0 全文，不要动镜像那份** → 已将工作区源 `LICENSE` 替换为全文（`https://www.gnu.org/licenses/gpl-3.0.txt`，与镜像逐字节一致），镜像**零改动**。⚠️ 同步修正两处**文档失真**：⑴`AGENTS.md` 红线 10 原文写「LICENSE 是用户定制的 GPL-3.0 **长文版本**」—— 与实测**恰好相反**（源是短版、镜像是全文），系早前误判写入；⑵红线 10 已补记本次用户授权的唯一例外，并注明此后**恢复常规效力（LICENSE 只读）**。版权归属仍为 `ReelLudic — Copyright (C) 2026 fhb263`。**教训：红线文档里的「事实描述」也要有实测依据，写错的描述会把后续所有会话带偏。**



> **⑭ 页签更名「计划」+ 指示器两修（2026-09-12 用户反馈，随 1.0.3 折叠发布）**：⑴顶部页签「计划表」→「计划」（仅 tabLabel 一处；视图内「计划表」标题与「打开计划表」命令名不动）。⑵**现代主题切页签毫无动画的真根因 = 内联样式缺属性名**：indicatorTransform 曾返回 "translateX(Xpx);width:Wpx"（缺 transform: 前缀）直接喂 style 属性 —— 内联样式按声明列表解析，首段无冒号被浏览器**静默丢弃**（不报错），只有 width 生效 → 指示器钉死 left:5px。**纯函数 15 例全绿 + 产物断言 47/47 全过仍拦不住：字符串级断言测不出「样式串会被 CSS 解析器拒绝」这类运行时行为**；assert-symbols 已加回归断言（正向 transform:translateX( / 反向旧形态 return 反引号 translateX(）。⑶同函数顺带修**误减 scrollLeft**：指示器 absolute 于滚动容器内、随内容滚动，与按钮同处内容坐标系，**不该减 scrollLeft**（减了则在窄栏横向滚动后向左漂移同量像素、脱离选中页签）→ 签名删去第 4 参 + 移除容器 on:scroll 重算（滚动无需重算）。教训：**DOM/CSS 运行时契约（属性名合法性、包含块与滚动坐标系）字符串断言守不住——要么真实渲染验证，要么把推导写进注释并用回归断言钉住产物形态。**



> **⑮ 现代页签恢复图标（2026-09-12 用户上手反馈，随 1.0.3 折叠发布）**：1.0.3 定稿曾裁定「现代页签纯文字」，用户上手后要求恢复 → 删除图标节点的 {#if uiTheme !== 'modern'} 门控，两主题恒渲染同一套 13px Lucide 图标。药丸指示器按按钮实测 offsetWidth 定位，按钮变宽自动适配、无需改 CSS。probe-task2 §C 断言反向改写（图标门控分支不得再出现 + tabIcon 仍挂载）；assert-symbols 加 !== "modern" 反向断言。教训：**设计裁定（纯文字更克制）属「设计时想象」，与「用起来的感受」可能相反——观感类裁定要以上手复核为准，别把当时的裁定当永久事实。**



> **⑯ 现代圆角放大回退（2026-09-12 用户上手反馈，随 1.0.3 折叠发布）**：modern 曾把 `--rl-t-radius-md` 6→10px、`--rl-t-radius-lg` 8→16px（lg 翻倍），海报卡 / 弹窗 / 日历卡观感过于夸张 → 用户选「全部回退与原生一致」：**删除 modern 块内两行圆角覆盖**，md/lg 落回 `:root` 原值（6/8px），弹窗骨架 `var(--rl-t-radius-lg, 8px)` fallback 自动生效、组件零改动。圆角维度两主题从此一致；现代感的区分度由阴影 / 悬停动效 / 页签胶囊 / 主按钮辉光承担。assert-symbols「modern 圆角 16」present 断言反转为 md/lg 两条 absent（突变验证恰好 2 FAIL）；UI-GUIDE §6 豁免表事实同步更新。教训同 ⑮：**形态放大档位是设计时想象，以上手复核为准；豁免清单里「允许偏离」不等于「必须偏离」。**

> **⑰ 全面 modern + 删除主题切换入口（2026-09-12 用户裁定，随 1.0.3 折叠发布）**：设置页「外观 → 界面主题」下拉整段删除，现代风格成为唯一主题。实现与 `colorTheme='mono'` **同构的「下线项兜底」**：`uiTheme` 字段按 append-only 保留，`onload` 强制覆写 `this.settings.uiTheme = 'modern'`（磁盘残留 `native` 的老用户载入即迁移，`saveSettings` 写回 `modern` 自愈）；`DEFAULT_SETTINGS.uiTheme` 同步改 `'modern'`；`applyUiTheme()` / `normalizeUiTheme` / `THEME_CLASS` / HomeView `setUiTheme` 与模板 `{#if uiTheme === 'modern'}` 分支**全部保留不动**（prop 恒 'modern'、分支恒真，将来若恢复切换零成本）。悬停上浮 `--rl-t-lift` `-7px → -3px`（用户点名「幅度小点」；scale 1.025 未动）。assert-symbols：设置页三条 present（「界面主题」label / native / modern 选项）删除，新增 absent×2（产物不得再出现 `addOption("native"` 与「界面主题」label）+ present×1（`uiTheme = "modern"` 兜底行）。

> **⑱ 书籍子分类【全部/出版/网文】+ 悬浮提示延迟（2026-09-12 用户需求，随 1.0.3 折叠发布；同日更名：桶名 图书→出版、小说→网文，组名/表单字段名 图书分类→书籍分类——字段值 'book'/'novel' 不变，只动展示层）**：⑴**数据**：`BookKind = 'book' | 'novel'`（append-only 可选字段）；**缺省归「出版」**（用户裁定：存量书不丢失）。`pure/bookKind.ts` 三件套：`normalizeBookKind`（Object.keys 校验防原型链，同 themeTokens 教训）/ `matchesBookKind`（显式 kind 时非 book 类型**不命中**——首版误写成「恒命中」被单测抓出：聚合页签根本不传 bookKind，防御分支纯多余还造语义漏出）/ `bookKindCounts`。⑵**筛选挂接**：`filterAndSort` opts 加可选 `bookKind`（缺省 undefined 不过滤，旧调用零影响）；MediaList 书籍页签传 `kindFilter` + `kindChips`/`kindCounts`，渲染同款 `rl-vb-group` chips（含计数）。⑶**表单**：书籍区块首行「书籍分类」两颗 chip（复用 `.rl-chip/.on`，与状态 chip 同款），submit book 分支 `input.bookKind = bookKind` 恒写。⑷**悬浮提示延迟**：`globalTooltip` 新元素悬停 500ms（`TIP_DELAY_MS`）才显示；同元素内子节点穿梭不重置计时（`pendingEl` 判等）；移开/滚动/点击立即取消 + 收起。**断言教训三连（突变验证抓出来的）**：needle 必须按**产物真实形态**写——`aria-label` 是 `attr(el,"aria-label",…)` 调用形态而非 HTML 字面量；`??` 被 esbuild 降级为 `(_aN = x) != null ? _aN : "all"` 且临时变量编号会漂移 → 用宽松正则；**子串 needle 会假活**（`TIP_DELAY_MS` 改名 `TIP_DELAY_MS_X` 后 present 仍命中）→ needle 选「使用点」等结构性位置，且突变必须回读确认真变 + 断言网对突变点收口（首版突变2漏网即断言缺口）。
> **⑲ 页签更名：书籍→阅读、音乐→收听（2026-09-12 用户需求，随 1.0.3 折叠发布）**：仅页签显示名——`HomeView.tabLabel()` 在 `ENTRY_TYPE_LABELS[t]` 之前加两行覆盖（`if (t === 'book') return '阅读'` / `if (t === 'music') return '收听'`），**类型标签映射本体不动**（表单/日历/统计/AI 提示词等 10 处消费场景仍显示「书籍/音乐」）。周边同步：ExcerptModal 空库引导文案「先在『书籍』页签」→「阅读」；指代页签名的注释同步（tab.ts / bookKind.ts×3 / search.ts / MediaList×2）；types.ts BookKind 注释一并修掉上轮桶名漏网（「缺省归图书」→「缺省归出版」）+ bookKind/search 测试标题漏网两处。assert-symbols 加两条正则断言（`if \(\w+ === "book"\) return "阅读"` 形态——tabLabel 编译后参数名漂移用 `\w+`，勿用裸「阅读」子串防「阅读进度」等语境假活）。
> **⑳ 子分类扩展：阅读+漫画桶 / 收听页签【全部/音乐/其他】+ chips 量词（2026-09-12 用户需求，随 1.0.3 折叠发布）**：⑴**书籍**：`BookKind` 加 `'comic'`（append-only），chips 变【全部/出版/网文/漫画】四桶，表单三颗 chip；normalize/matches/counts 零改动自动涵盖（VALID_KINDS 以 LABELS 自有键为准的设计红利）。⑵**音乐（新建 `pure/musicKind.ts`，与 bookKind 全同构）**：`MusicKind = 'music' | 'other'`（append-only 可选字段 `MediaEntry.musicKind`），**缺省归「music」**（存量音乐不丢失，类比书籍缺省裁定）；`filterAndSort` 加可选 `musicKind` 过滤链（matchesMusicKind 显式 kind 时非 music 类型不命中，同 bookKind 从严）；MediaList 收听页签 chips（rl-vb-group 同款）+ EntryForm 音乐区块「音乐分类」两颗 chip + submit 恒写。⑶**量词**：`BOOK_KIND_UNITS`（书籍各桶一律「本」）/ `MUSIC_KIND_UNITS`（音乐「首」、其他与全部「项」——全部跨两量词用中性「项」），渲染进 `rl-cnt`（「出版 5本」「音乐 5首」「其他 3项」）。测试：bookKind 扩展（comic 归一/匹配/四桶计数/量词）+ musicKind 新建 10 例 + search 2 例（other 只留显式 / music 含缺省）；assert-symbols 新增 6 条（normalizeMusicKind / matchesMusicKind / `comic: "漫画"` 结构键 / 「音乐分类」组名 / chips aria / MUSIC_KIND_UNITS）。
> **㉑ 顶部概览量词跟随子分类，chips 回退纯数字（2026-09-12 用户纠正，随 1.0.3 折叠发布）**：⑳ 首版把量词渲染进子分类 chips（`rl-cnt`）属理解偏差——用户指对齐影视「8 部电视剧」模式：量词在**顶部概览计数**（`rl-libstats-total`），chips 保持纯数字。改造：`BOOK_KIND_UNITS`/`MUSIC_KIND_UNITS` → `BOOK_KIND_TOP_UNITS`（本书/本网文/本漫画）/`MUSIC_KIND_TOP_UNITS`（首音乐/项其他）；MediaList `overviewUnit` 子分类感知（子分类 chip 非 all 时取 TOP_UNITS，否则回落 `pure/labels.overviewUnitLabel`），`overviewTotal` 配套（子分类选中取桶数 kindCounts/musicCounts，与 chips 数字同源，否则 `statusCounts.all`——影视「8 部电视剧」= 类型池总数同构）；两处 chips `rl-cnt` 去量词回纯数字。测试：bookKind/musicKind 量词用例改 TOP_UNITS 值；assert-symbols：needle 更新（MUSIC_KIND_TOP_UNITS / `music: "首音乐"` / BOOK_KIND_TOP_UNITS / `novel: "本网文"`）+ absent（旧 MUSIC_KIND_UNITS 表已删）。

> **㉒ 漫画源适配：书籍类目 comic 接入 Bangumi 主源 + 第六源链组（2026-09-12 用户需求，随 1.0.3 折叠发布）**：选型结论（漫画 Bangumi 更全：日漫覆盖全/结构化/一部作品一条/官方公开 API；网文维持豆瓣零开发）→ 用户裁定「适配漫画源，设置页设置一下书籍类目」。**架构 = comic 作为第六个 SourceGroup**（书籍类目子组，非独立条目类型）：`sourceGroupForType` 不产生 comic（EntryType 无此值），仅 `main.searchBook(query, kind)` 按 `bookKind === 'comic'` 显式路由（cache key `book:comic:…` 按类目隔离防串）。⑴**registry**：`SourceGroup`/`SOURCE_GROUPS` 加 `'comic'`、`GROUP_LABELS.comic='漫画'`、`DEFAULT_CHAINS.comic=['bangumi','douban']`（Bangumi 链首主源——注意「主源不限时」是 douban 特权，bangumi 仍按 aux 5s 超时，链序仅决定结果排前）、douban groups 加 comic（6 组全覆盖）、bangumi groups `['anime','comic']`（hint 更新）；normalize/resolve/derive/凭据判定/设置页勾选行全部零改动自动生效。⑵**bangumi.ts**：`buildBookSearchBody`（type=1 书籍，含漫画）+ `parseBangumiBookResults`（infobox 作者/译者/出版社/页数直接映射 BookSearchResult，搜索级可回填不触发详情补全——与 openLibrary 结果同待遇；评分兼容顶层 score 与 `rating.score/total` 对象两形态，v0 search 实际返回对象；id `bangumi:{id}`、source='bangumi'）+ `BangumiClient.searchBooks`。⑶**runner 分流零签名改动**：`bangumi: (query, type) => type === 'anime' ? search(query) : searchBooks(query)` —— comic 组 `collectGroupSources('comic','book',…)` 传入的 EntryType 恒为 'book'，与 anime 组的 'anime' 天然区分。⑷**表单传参链**：EntryForm `onSearchBook(q, bookKind, …)` → EntryModal → `main.searchBook(q, kind, onProgress)`。⑸**设置页**：`GROUP_DISPLAY_ORDER` 插 'comic'（书籍后）→ 勾选行自动渲染（候选 = 豆瓣+Bangumi 两颗，groupCandidates 按 registry 过滤）。测试 +6（comic 默认链/候选/normalize 滤 openLibrary/resolve + bangumi 漫画 5 例含 rating 对象形态）；tsc 0；全量 **1068/1068（67 文件）**；assert-symbols +11（comic 默认链 / searchBooks / `type: 1, limit` / parseBangumiBookResults / 作者键 / kind 路由 / runner 分流 / 缓存 key `??` 降级形态 / GROUP_LABELS 结构锚定——`comic: "漫画"` 与 BOOK_KIND 桶名同值必须带表名前缀 / source 尾键去逗号形态 / 旧「Douban 单源」注释 absent），全部 PASS；三方产物 cmp 全 OK。⚠️ 探查教训：`collectGroupSources` 在**根目录 main.ts**，此前两轮 grep 只搜 `src/` 恒空手——**No matches ≠ 不存在，先核对搜索范围与目标文件所在目录**。

> **㉓ 搜索框类型下拉加「漫画」+ 漫画视图点添加自动选中（2026-09-12 用户需求，随 1.0.3 折叠发布）**：用户原话「漫画源怎么不添加到条目搜索框类型下拉里，还有这个聚焦到漫画视图时点开搜索框要自动选中漫画进行搜索」。⑴**typeSel 展示值纯派生**：`src/pure/searchTypeSel.ts` 两纯函数——`toSearchTypeSel(type,bookKind)`（book+comic→'comic'）与 `applySearchTypeSel(sel,curType,curBookKind,isAddMode)`（'comic'→book+comic；**添加模式**从漫画切回书籍复位出版；**编辑模式永不复位**——仅切下拉不得静默改写既有条目分类，防换个词重搜就把漫画条目存成出版，改分类走 chips）；EntryForm 下拉改**受控 select**（`value={typeSel}` + `on:change={onTypeSelEl}`，不用 bind:value+on:change 同元素——有编译警告；TS as 断言只能在 script 内做，模板不支持），`$: typeSel = toSearchTypeSel(type, bookKind)` 纯派生 → chips 点击/编辑初始化全自动回显、零双向同步环。选项表 `TYPE_OPTIONS`（ENTRY_TYPES flatMap，书籍后插漫画）。⑵**添加链 kind 通道**：MediaList `onAdd(resolveAddType(...), lockType==='book' && kindFilter!=='all' ? kindFilter : undefined)` → HomeView.svelte/HomeView.ts 签名扩展 → `openAddModal(t, kind)` → EntryModal 第 5 参 `initialBookKind` → EntryForm `normalizeBookKind(entry?.bookKind ?? initialBookKind)`；对称规则：聚焦漫画→下拉「漫画」，聚焦网文→书籍+网文，出版/全部→缺省出版；StatsBoard `onAdd()` 无参天然兼容。⑶**占栏同源**：`onSourcesForType` 加 kind 参，`main.sourcesForType` 特判 `type==='book' && kind==='comic' ? 'comic' : sourceGroupForType(type)`（与 searchBook 路由一致）；头部「类型：漫画」三元。测试：`tests/searchTypeSel.test.ts` +10；全量 **1078/1078（68 文件）**；tsc 0；build 87 基线；assert-symbols +21（含 select_option 受控形态正则、props accessor 索引正则 `/initialBookKind: \d+,/`、语义锚定 `? "漫画" : ENTRY_TYPE_LABELS[`、absent 旧单参调用/旧四参构造、initialBookKind 覆盖 ≥12）；三方 cmp OK；commit `f89080c`。🔴 **行尾双重转换事故（本条最重教训）**：批量编辑脚本「归一 LF 匹配 + **to 预先 join(CRLF) 插入** + 写回再全局 `\n→\r\n`」→ 多行替换点全部变 `\r\r\n`（loneCR：main.ts 8 / EntryModal 5 / EntryForm 25）→ **git `convert_is_binary` 对 loneCR>0 判 binary（不需要 NUL！）→ 拒绝 eol 清洗 → diff/add 全文件级污染（main.ts 显 5823 行）**。诊断链：diff --stat 异常 → `git ls-files --eol` 见 `w/-text` → 字节扫描无 NUL → `git diff --ignore-cr-at-eol --stat` 验真实量 9+/8- → loneCR 计数定位 `\r\r\n` → 清洗归零重构建。**正确姿势：CRLF 文件批量脚本 = 归一 LF + needle/to 都保持 LF 插入 + 写回一次性 `\n→\r\n`；diff 全脏先跑 `--ignore-cr-at-eol` 再定性**。

> **㉔ 下拉加「网文」+ 删表单书籍分类 chips（2026-09-12 用户需求，随 1.0.3 折叠发布）**：用户原话「书籍类编辑条目窗口为什么会有【书籍分类：出版网文漫画】这选项，给我去掉，还有这个添加条目搜索框给我再加个类型网文，然后点网文视图就聚焦网文走douban源」。**架构简化 = 搜索框下拉成为书籍分类的唯一入口**（㉓ 的「编辑模式保护」设计作废——chips 删除后切下拉即明确分类意图）：⑴**searchTypeSel 简化**：`SearchTypeSel = EntryType | 'novel' | 'comic'`（'book' 同值复用为出版态）；`toSearchTypeSel = type==='book' ? bookKind : type`（书籍态回显子类本名）；`applySearchTypeSel(sel, curBookKind)` **删 isAddMode/curType 参数**——选网文/漫画 → book+对应分类，选书籍 → **无条件复位出版**（添加/编辑一致），其余类型 bookKind 原样保留（非书籍态不显示不落库，切回书籍时用户在下拉上明确选择）；㉓ 的 resetComic 保护分支删除。⑵**TYPE_OPTIONS**：书籍后插「网文」「漫画」（顺序对齐阅读页签 chips 出版→网文→漫画）。⑶**表单**：删 `{#if type==='book'}` 内 rl-kind-row 书籍分类 chips 三颗（**音乐分类 chips 保留**，rl-kind-row CSS 共用勿删）；头部「类型」改三分支（漫画/网文/其余类型名）。⑷**零改动自动生效**：网文搜索走 book 组（douban 主源+openLibrary，`searchBook(q,'novel')` 非 comic 路由即 book 链）；MediaList 添加按钮 kindFilter 通道天然支持 novel（聚焦网文点添加 → 表单下拉选中「网文」）；doSearch 已传 bookKind。测试：searchTypeSel 用例重写 8 个（to 4 + apply 4）；全量 **1076/1076（68 文件）**；tsc 0；build 87 基线；assert-symbols 更新（toSearchTypeSel 新体 / applySearchTypeSel 新签名 + 两段 if 展开正则 / novel+漫画选项 / 头部网文分支锚定 / **absent resetComic + absent `bookKind = "book"` 赋值形态**——absent 勿用「书籍分类」文案 needle：esbuild 保留注释，源码注释含该词会假 FAIL）；三方 cmp OK。

> **㉕ 落库断链修复（normalizeEntry 白名单补 bookKind/musicKind）+ 子分类「出版」更名「文学」（2026-09-12 用户报告）**：用户原话「为什么我用网文、漫画选中类型搜索的不归类到对应视图反而在出版视图，还有出版视图名称改成"文学"」。**根因 = normalizeEntry（`src/data/catalog.ts`）字段白名单式构造漏字段**：EntryForm 提交恒写 `input.bookKind/musicKind` ✓ → EntryModal 透传 ✓ → EntryService.create/update ✓ → 最后 normalizeEntry 归一一步把两字段**静默丢弃**（不在白名单）→ 落库缺省归 book 桶。1.0.3 子分类上线即存在（搜索路由正常、仅保存丢弃），非本轮引入；同理波及音乐 musicKind。**修复 = 白名单加两字段、合法值透传**（`BOOK_KINDS/MUSIC_KINDS.includes(raw.x as X) ? raw.x : undefined`）——非法/缺省 undefined 由读取端 `matchesBookKind → normalizeBookKind` 兜底归 book，不恒写默认值避免存量 undefined 被写盘放大；插入位置对齐 types.ts 字段序（aliases 后）。**改名 = `BOOK_KIND_LABELS.book` '出版'→'文学' 单点**（MediaList chips / 表单下拉 / 顶部计数自动生效；TOP_UNITS.book='本书' 保持）。测试：catalog.test.ts 加透传/兜底 9 断言（红→绿）+ bookKind.test.ts L71 断言更新 + 全库注释「出版」→「文学」对齐（types/searchTypeSel/EntryForm/MediaList/3 测试文件）；全量 **1077/1077（68 文件）**；tsc 0；build 87 基线；assert-symbols 150 PASS（LABELS needle 改 `book: "文学"` + normalizeEntry 白名单 2 条新断言）；三方 cmp IDENTICAL。⚠️ **存量数据**：修复只保证新保存落库正确，此前保存的网文/漫画条目 bookKind 已丢，需重新编辑保存归位。⚠️ **又一次同文件并行 Edit 事故**：改名波及 7 文件，同文件多 Edit 并行发 → 读-改-写竞争 10 处「报成功未落盘」（bookKind.ts 4 处只活 1、types.ts 2 活 1 等），grep 复核才暴露 → 串行重做修复。红线再次实证：**同文件多处修改必须串行 Edit 或精确串+计数断言脚本；「Successfully edited」≠ 落盘，批量修改后必须 grep 回读复核**。

> **㉖ 搜索框类型下拉显式排序 + 「书籍」项更名「文学」（2026-09-12 用户指定，随 1.0.3 折叠发布）**：用户原话「添加条目下拉类型顺序改为：【书籍、网文、漫画、动画、电视剧、电影、游戏、音乐】，其中书籍改为"文学"」。TYPE_OPTIONS 由 `ENTRY_TYPES.flatMap` 改**显式数组**（顺序即 UI 契约，不再隐式依赖 ENTRY_TYPES 排列）：book(文学)→novel→comic→anime→tv→movie→game→music；`ENTRY_TYPES` import 移除（仅 TYPE_OPTIONS 用过）。**value 与选择逻辑零变化**（'book' 仍是文学态快捷值，toSearchTypeSel/applySearchTypeSel 不动）；`ENTRY_TYPE_LABELS.book='书籍'` 保持——统计/表单/笔记等场景类型名不受影响（仅搜索下拉一处显示「文学」）。assert-symbols：flatMap 反向断言 + TYPE_OPTIONS 定义窗口（800 字符）内八项 value 顺序链断言 + 窗口内 `label: "文学"` / 无 `label: "书籍"`（labels 表其它处的「书籍」不受限）；**153 PASS**。全量 1077/1077；tsc 0；build 87 基线；三方 cmp IDENTICAL；commit `d11caad`。

## 未发布 → 随 v1.0.2（2026-09-09）发布收口

> **1.0.2 发布说明**：本区为历史累积（1.0.0/1.0.1 期条目多未切分，仍在下方）；本版 = #234/#235 + 09-09 阅读器批次（当日早段，见 2026-09-09 记忆）＋下方 4 条 09-09 修复项，已全部收口于根 CHANGELOG [1.0.2] + RELEASE-NOTES-1.0.2.md（版本三文件 1.0.2，manifest/versions/package 同步）。

> **移除：设置页「开始使用」引导卡整块拆除（09-11 用户定「删除引导卡和相关样式」）：** 批D 的最终归宿 —— 引导卡上线当天即被判定不需要。①**删除面**：`Settings.ts`（`renderGuideCard` / `dismissGuide` 两方法块、display() 调用、`guideDismissed` 字段、「关于」区「新手引导」重开行、onboarding 导入）、`main.ts`（`guideStatus()` 方法）、`styles.css`（`.rl-guide-*` 样式块 6 规则）、`src/pure/onboarding.ts` 与 `tests/onboarding.test.ts`（整文件删除）。②**删除方式延续 09-10 事故教训**：`remove-guide.cjs` 用**待删块自身内容**精确匹配 + 每处匹配次数断言恰为 1 + 块内特征校验（mustHave/mustNotHave）+ 写盘前全局残留自检，任一不满足整体中止不写盘。⚠️ 脚本首跑失败暴露一个工具坑：**不要在 Bash 工具里用 `sed -i` 内联修改含模板字符串的补丁脚本** —— 转义层级叠加（bash → sed → 脚本内 `\n`）会把脚本自身的模板串截断（本次 endMark 被切到 `XX`），改用「重写整个脚本文件」最稳。③**断言反向钉死**：assert-symbols 新增 6 条「应不存在」反向断言（`renderGuideCard` / `guideDismissed` / `guideStatus` / `rl-guide-` / `开始使用 · ` / css `rl-guide`），防止将来回潮；通用折叠规则 `.rl-key-open .rl-key-body` 仍被凭据折叠等使用，断言保留。④**`data.json` 遗留字段不清理**：测试库 `data.json` 里的 `guideDismissed: true` 属用户数据文件，代码已不再读取（多余键被静默忽略），且 schema append-only 红线「已用字段不删数据」——保留无害。⑤README 的 `ReelLudic/` 默认库名对齐**不随引导卡回滚**（那是独立决策）。全量 **1019/1019（64 文件，-14）**，tsc 0，main.js **3,653,244B**，styles.css **60,323B**，三段 cmp IDENTICAL，产物断言全部 PASS（含 6 条新增反向断言），镜像 src/tests/styles.css 一致。

> **批C 可访问性（09-11：键盘导航 + aria 收敛 + 双套语义色板；用户四问四选 = 只接海报墙+列表 / aria 按规范全做 / 全面换双套变量 / 徽标加深底色保留白字）：** ①**键盘导航（此前完全缺失）**——海报墙卡片 `.rl-card` 与列表行标题 `.rl-row-link` 补 `role="link" tabindex="0" on:keydown(Enter → 打开笔记)` + `:focus-visible` 聚焦环（延续 `.rl-vb-group` 既有写法）；瀑布流卡与音乐行按用户决定本轮不接。⚠️ 列表行**没有**用 `role="link"` 覆盖 `<tr>`——那会顶掉 `row` 含义、毁掉表格语义，改为把可聚焦元素放进标题单元格。②**aria 收敛 38 → 18 处**（UI-GUIDE §3 分流）——删掉「有可见文字却仍挂 aria-label」的冗余；纯图标按钮（视图切换 4 个、⋯、✎、▶、日历翻页 4 个、横幅关闭、书籍进度重解析、剧集批量检索、回到顶部）改**隐藏文本 `.rl-sr`**；`<span class="rl-libstats">` 补 `role="group"`（无 role 的 span 上 aria-label 会被读屏器直接忽略，原属死代码）。保留的 18 处全为表单控件 / `role=group|tablist|img` 容器 / `role=dialog`+`aria-labelledby`——合规且是唯一命名手段。③**修掉全仓唯一的 `aria-label` + `data-tip` 同元素违规**（`QuickAssociateModal` 批量检索钮：官方气泡与自绘气泡叠两层）→ 改隐藏文本，且**必须在 `setIcon`/`setText` 之后追加**（这两个会把元素内容整体替换，先加会被清掉）。⚠️ 上一轮我只扫了 `.svelte` 就断言「全仓无双气泡」，本轮补扫 `src/**/*.ts` 才发现这一处——**下结论前扫全，别只扫自己顺手的那半边**。④**对比度（实测，非目测）**——新建 `--rl-*` 语义色板（`styles.css` 文件头 `:root` + `.theme-dark` 双套，每行带实算比值注释）：`--rl-score` / `-score-empty` / `-danger` / `-good` / `-good-soft` / `-warn`；组件与 styles.css 共 23 处直写色值改为引用变量。**动因**：原色板是照**深色主题**调的，浅色主题下正文最低仅 **2.44:1**（评分/星级几乎读不清），反向也有 `#c0493f` 在暗底 3.39:1。⑤**状态徽标加深底色、保留白字**——四色改 `#6b6b64 / #8a6a12 / #1f7a30 / #37619f`，白字恒 ≥5:1，亮/暗**共用一套**（原 `.theme-dark` 覆盖块已删）；修前「在看」浅底白字 2.44、暗底 2.90，**两主题都不达标**。⑥**Esc 关闭弹窗无需改动**——17 个模态全部 `extends Modal`、无一处自定义 Escape，Obsidian 基类自带（类型定义里就有 `Modal.scope: Scope`）。⑦**未改动的（已核实无需动）**：`HomeView` 的 `#f8f9fa` 有 `body.theme-dark` 回退；`styles.css` 工具节气泡的 `#f2f2f2` 本就压深色底；`MediaList` 瀑布流遮罩里的 `#ffd76b`/`#fff` 同样压深色遮罩。全量 **1016/1016（64 文件）**，tsc 0，main.js **3,652,927B**，styles.css **58,433B**，三段 cmp IDENTICAL，产物断言 **41/41 PASS**（含 9 条「应不存在」反向断言 + 3 条「防误删」正向断言），对比度终检 **19/19 达标**。构建告警 89 → **87**（卡片/行补 role 后少 2 条 a11y 告警）。

> **修复：引导卡「没见到」（09-11 用户报「引导卡没见到啊」）：** 根因 —— 首版把显示条件写成「**必做项完成 → `host.remove()` 整块移除**」，本意是「自清理、不打扰老用户」，但实测用户的库**已有 53 条**（`catalog.json` 存在 + entryCount 53）→ `guideRequiredDone` 恒为 true → **卡片渲染完当场被移除**，表现为「根本没出现」。这是「自清理」设计的反噬：**它恰好对唯一会去看这张卡的人（已有数据的库主）永远不可见**。修法改为**手动收起**：①显示条件只取决于新字段 `settings.guideDismissed`（append-only，缺省 = 显示）；②卡片内加「不再显示」按钮（`dismissGuide()` → 置 true + save + 重绘）；③「关于」区加「新手引导」行 + 「显示引导卡」按钮（置 false + save + 重绘）作为重开入口；④**一律默认展开**（不按完成度分叉）：折叠态只剩一行标题，会被误认为「卡片根本没出现」——正是本次用户反馈的观感；不想要就点卡片里的「不再显示」。完成度只影响标题文案：未完成显示 `开始使用 · 1/2 已完成`，全部达成显示 `开始使用 · 已全部完成`；⑤「添加第一个条目」按钮只在 `entryCount === 0` 时渲染（库里已有条目还提示「添加第一个」很莫名）。新增 7 条产物断言，其中两条是**反向断言**：`host.remove()` 与「按完成度决定折叠」的旧写法都必须**不存在**于产物 —— 把「修掉那个会让卡片消失的逻辑」变成机器可验证的事实。全量 **1033/1033（65 文件）**，tsc 0，main.js **3,659,346B**，三段 cmp IDENTICAL，产物断言 **66/66 PASS**。

> **批D 新手引导（09-11；用户四问四选 = 只做设置页引导卡 / 不做示例数据 / 不弹窗、只在设置页看 / README 改默认库名）：** ⚠️ **范围被用户大幅收窄** —— 原方案（三步弹窗向导 + 6 条示例数据 + 首次运行自动弹窗）全部砍掉，最终只落两件事。①**设置页顶部「开始使用」引导卡**（`Settings.renderGuideCard`）：折叠行标题即进度（`开始使用 · 1/2 已完成`），**默认展开**（引导卡收起来就失去意义，仍可点击表头收起）；三步逐行展示「现状 + 下一步」：媒体库目录（未创建时注明「保存第一个条目时会自动创建，无需手动建目录」）/ 数据源凭据（标注**可选**，未配时列出免 Key 源名单，避免用户误以为必须先配 Cookie）/ 添加第一个条目（带「添加第一个条目」按钮直达 `openAddModal`）。**必做项（库就绪 + 至少一条条目）全达成后整块 DOM 移除** —— 自清理，因此**无需新增任何「不再显示」开关字段**。②**纯逻辑下沉 `src/pure/onboarding.ts`**（TDD 14 用例）：`buildGuideSteps(input)` 推导三步状态与文案、`guideRequiredDone(steps)` 判完成、`configuredProviderIds(read)` 列已配凭据源（**双凭据源 IGDB 必须两字段同有值**；纯空白视为未配；免 Key 源永不出现）、`freeSourceLabels()`。③**`main.guideStatus()`** 做 vault 探测并返回 `{libraryReady, entryCount}`；⚠️ **必须在 `service.list()` 之前探测 `catalog.json` 是否存在** —— 读操作可能顺带初始化文件，顺序反了会让「库尚未创建」永远判成已就绪。④**样式落全局 `styles.css`**（`.rl-guide-step` 等）：设置页 DOM API 创建的元素不经 Svelte 编译，写组件 scoped 样式不生效。⑤**库目录默认值不一致的处置**（用户定「只改 README」）：`DEFAULT_SETTINGS.libraryDir` 实际为 `'ReelLudic'`，而 README 一直写「默认 `媒体库/`」→ **改 README 对齐**，并把 FAQ/数据目录里的路径示例一并改为 `ReelLudic/`（设置项名称「媒体库目录」保持不动）。⑥**不做示例数据的理由**（用户选择）：示例数据需新增 `isSample` 字段与清理链，且首次体验的价值可通过「手动添加一条」达成；引导卡第 3 步已直接给按钮。全量 **1033/1033（65 文件）**，tsc 0，main.js **3,657,801B**，styles.css **61,065B**，三段 cmp IDENTICAL，产物断言 **60/60 PASS**（新增 14 条批D 断言）。

> **修复：音乐页签概览量词显示「N 项媒体」（09-11 用户报「应该显示的是 8 首音乐而不是 8 项媒体」；TDD 先红后绿）：** 根因 —— `MediaList.svelte` 里的 `overviewUnit` 是一串 `if (t === 'book') / 'game' / 'movie' / 'tv' / 'anime'` 的**逐类型 if 链**，**漏了 `music`** → 音乐页签落到兜底 `'项媒体'`。修法不只是补一个分支：把映射**下沉为纯函数 `pure/labels.ts overviewUnitLabel(type: EntryType | null)`**（`movie 部电影 / tv 部电视剧 / anime 部动画 / book 本书 / game 款游戏 / music 首音乐 / null 项媒体`），`MediaList` 改为一行调用，杜绝「逐类型 if 链漏项」这类静默降级。新增 3 个用例，其中一条是**穷举锁**：`for (const t of ENTRY_TYPES) expect(overviewUnitLabel(t)).not.toBe('项媒体')` —— 将来新增类型却忘配量词会直接测试失败，而不是上线后才发现顶部写成「N 项媒体」。全量 **1019/1019（64 文件）**，tsc 0，main.js **3,653,244B**，三段 cmp IDENTICAL，产物断言含「首音乐/本书/款游戏/部电影/部电视剧/部动画/项媒体」七项全 PASS。⚠️ **发现一条偶发失败**：本次全量跑的首轮出现「1 failed / 1018 passed」，随后连跑 5 次均 1019 全绿、未能复现；嫌疑集中在**用真实定时器**的 `timing.test.ts`（withTimeout/retry）与 `searchCache.test.ts`（TTL 缓存），全仓仅 `tracking.test.ts` 用了假定时器 —— 待后续把时间相关用例统一改 `vi.useFakeTimers()`。

> **批C 色板修订（09-11 当日二次：用户「评分星级颜色改回来」→「评分星级浅色深色模式共用」）：** 上一版色板我把**所有**槽位都按主题分叉、并统一换成了一套更艳的候选色——两个问题都被用户当场否掉。**修订原则：`:root` 放原色，`.theme-light` / `.theme-dark` 各自只列「自己这侧不达标」的项，覆盖值取保持原色相下的最小必要亮度幅度**。①**评分与星级改回两主题共用的原色**（`#d99a2b` / `#8a8a86` / `#b4b2a9` / `#d9cba0`），并从两个主题块中移除；⚠️ **单色共用等于放弃主题适配 —— 数学上不可能两主题同时达 AA**（白底需相对亮度 ≤0.183、暗底需 ≥0.230，两区间不相交；单色理论最优仅两主题各 4.11:1）。此取舍已记入根 README「已知问题与限制」，并写进 UI-GUIDE §2.1 附「若将来要恢复浅色可达性，必须先找用户确认放弃共用」。②**顺带修复我上一轮的过度统一**：`--rl-danger` / `--rl-danger-strong` / `--rl-good` / `--rl-warn` 在**各自本来就达标的那一侧恢复原色**（如 `#2f9e44` 暗底 4.84 本就达标、`#d97706` 暗底 5.23 本就达标，上一轮无谓地换成了别的色）；只有真正不达标的那一侧才覆盖（暗底 `#cb685f` / `#e55353`，浅底 `#28873a` / `#b36205`，均取最小幅度）。③**星级槽位还原为原本的四个独立色**：上一轮我把 `.rl-stars-none` 错并到 `var(--text-faint)`、把 `.rl-stars-input`（未点亮星）错并到 `--rl-score-empty`，等于把三个原色压成两个 —— 现拆回 `--rl-score-mid`（`#8a8a86`）/ `--rl-score-none`（`#b4b2a9`）/ `--rl-score-input`（`#d9cba0`）。④**进度条三档也还原原色**：新增 `--rl-good-bar`（`#4d9b52`）/ `--rl-good-soft`（`#5a9e7d`）/ `--rl-danger-soft`（`#e85a4f`），三者两主题均 ≥3:1 → 无需覆盖（上一轮把它们分别挂到 `--rl-good`/`--rl-danger` 上，造成了进度条与原文不符的色偏）。⑤**徽标恢复按主题分叉**：`:root` 用原浅色、`.theme-dark` 用原暗色，只对不达标项做最小加深 —— 暗底的 `want`（`#75756f`，白字 4.64）与 `archived`（`#3f6db8`，5.13）**本就达标，现在恢复原色**；`watched` 仅比原色深 0.8% 亮度（`#41884a` → `#408548`），肉眼基本无差。⑥**新增一条结构性反向断言**：`.theme-light` / `.theme-dark` 块内**不得出现任何 `--rl-score*` 覆盖** —— 把「两主题共用」这个用户决策变成机器可验证的约束，防止将来有人「顺手」给它加上主题适配。全量 **1016/1016（64 文件）**，tsc 0，main.js **3,653,326B**，styles.css **60,321B**，三段 cmp IDENTICAL，产物断言 **46/46 PASS**，对比度终检：按主题适配的槽位**全部达标**（评分/星级为刻意共用，脚本只如实打印不判定）。

> **批C 工具与踩坑（09-11）：** ①**新增 3 个可复用核算脚本**（隔离 node 工作区）——`contrast.cjs`（找出不达标色值）、`contrast-fix.cjs`（校验候选替换色）、`verify-palette.cjs`（**从 `styles.css` 直接解析变量做终检**，避免把色值再抄一遍——抄一遍等于没检查）。②**⚠️ 多行块替换必须先做行尾归一**：本仓行尾是**混的**（EntryForm/MediaList/HomeView/StatsBoard 为 CRLF，CalendarBoard/TrackingBoard/QuickAssociateModal 为 LF），而脚本模板字符串的换行符取决于**脚本自身**的行尾——两者不一致时，**单行替换照样命中、多行块必然 0 命中**，极易误判成「代码里没这段」。正确姿势：读入 → 归一 LF → 匹配 LF needle → 写回前按原行尾还原。③**⚠️ 别用 `grep -c $'\r'` 数行尾**：该写法在本环境里 `$'\r'` 未展开成空模式 → 匹配所有行 → 报出「全是 CRLF」的假读数（据此误判了一轮、白查一次）。可靠办法是 `tr -cd '\r' | wc -c` 与 `tr -cd '\n' | wc -c` 对比。④**同文件多处修改禁止并行 Edit**，改用「精确串 + 匹配次数断言」脚本（任一处计数不为 1 即整体中止不写盘），既快又安全——本轮两次补丁合计 41 组替换，一次成功一次拦下 6 处错误。⑤仓库行尾混用本身是遗留问题，暂不统一（会产生数千行假 diff），留待专门整理。

> **批B 数据源失败处方文案 + 批量应用前置确认 + 封面失败去静默（09-11；TDD 29 用例，全绿）：** ①**数据源失败「怎么办」**（`pure/sourceRegistry.ts`，**只补文案、不动布局**）——通用分支从「逐源罗列 + 一句『请到 设置 → 服务集成 检查后重试』」改为**按原因归组 + 按类别给处方**：同类多源合并成一项（`MusicBrainz、iTunes 请求失败`，不再在括号里重复同一句），未配置 → 「到 设置 → 服务集成 · 数据源管理 填入对应凭据后点『测试连接』」，请求失败 → 「多为网络不通或对方限流，可稍后重试或改用其他源」；`ERR_DOUBAN_UNREACHABLE` 补上「若 Cookie 正常，多为搜索过密触发风控，稍等几分钟再试或改用其他数据源」（顺带更新其 `toBe` 断言）；`ERR_ANIME_NO_TOKEN` 补上填写路径。文案全部落在既有 `.rl-err` 节点内，未改任何布局（`.rl-err` 是纯文本 + 自然折行，加长无需 CSS 配合）。②**批量应用前置确认**（用户拍板：**不做撤销栈**——回滚要重建笔记与目录项、冲突风险高；改为把关口前移到动手之前）——新增纯模块 `pure/bulkConfirm.ts` `describeBulkApply({count,statusLabel,rating,tags})`：说清「将对 N 项执行：状态改为『已看』；个人评分改为 4★；追加标签：科幻、经典」，并诚实注明「会一并更新这些条目的详情笔记，且不可一键撤销」；无可应用项返回 null（**不弹空确认框**，等价于原「三项全空直接返回」）。`rating` 语义显式三分：`undefined/0` = 不改（0 是下拉占位）、`null` = 清除、`1~5` = 设为。标签清洗（去首尾空白 → 丢空串 → 去重保序）在纯函数内完成。链路：`MediaList.svelte`（注入 `onConfirmBulk`，**确认点放在 `clearSelection()` 之前**——取消则保留当前勾选与表单值、不动任何数据）→ `HomeView.svelte` → `HomeView.ts`（`new ConfirmModal(this.app, message, '继续').open()`，与 `deleteEntries` 复用同一套确认弹窗）。文案必须**单行**：`.rl-nc-desc` 是居中的纯文本节点、无 `white-space: pre-line`，换行不会渲染（已加断言锁定）。③**封面下载失败不再静默**（`EntryForm.svelte` 选中结果后的 `catch {}` 空捕获补 8s Notice）——明确告知「已保留网络地址（预览可能空白）」，并指向**既有的**手动入口「拖入封面区 / 右键『更换本地图片』」，不新增任何常驻 UI 元素。④**海报墙虚拟滚动本轮只落纯逻辑、未接入组件**（用户定「下批再接」）——因此产物断言 `computeVirtualWindow` / `VIRTUAL_THRESHOLD` **应被 tree-shaking 剔除**，把「未接入」变成机器可验证的事实，而不是靠嘴说。全量 **1016/1016（64 文件）**，tsc 0，main.js **3,650,384B**，三段 cmp IDENTICAL，产物断言 18/18 PASS。

> **海报墙虚拟滚动窗口计算（09-11，纯逻辑先行，TDD 13 用例）：** 新增 `src/pure/virtualWindow.ts` —— `computeVirtualWindow({scrollTop, viewportHeight, rowHeight, columns, itemCount, overscanRows?})` → `{enabled, startRow, endRow, startIndex, endIndex, paddingTop, paddingBottom}`，渲染层只需 `filtered.slice(startIndex, endIndex)` + 把上下留白写进占位元素。`VIRTUAL_THRESHOLD = 500`（**超过**才启用；未达则返回全量区间 + 零留白，保留 Ctrl+F 能搜到卡片、打印完整列表的行为）；`DEFAULT_OVERSCAN_ROWS = 2`。三处设计要点：①**用「行」而非「卡片」做窗口单位**——等宽网格下同一条目随列数变化所在行不同，按行算才能让「行高 × 行号 = 实际像素位移」严格对齐；②**先夹末行再夹首行**（先 `endRow = min(rows-1, …)` 再 `startRow = min(endRow, …)`），顺序反了会在「滚过头」时出现 `startRow > endRow` 与负留白；③**守恒不变式** `paddingTop + 渲染行数×行高 + paddingBottom ≡ 总行数×行高`（对 4×4 组 scrollTop/itemCount 组合遍历断言），保证虚拟化后滚动条长度与全量渲染完全一致、不会变短。边界覆盖：条目数 0（`endRow = -1` 且不产生负留白）、非法列数/行高回退（不产生 NaN/Infinity）、负 scrollTop（弹性滚动）钳 0、视口 0 至少渲染一行。**接入前已核实的前提**：`.rl-grid` 是 `repeat(auto-fill, minmax(180px,1fr))` + `gap:12px` + `align-items:stretch` → 同行等高；卡片内容行数由 `pure/cardMeta.ts` 的 PLACEHOLDER 机制保证一致 → 跨行也等高。但封面是 `aspect-ratio: 2/3`，**行高与列数都随容器宽度变化** → 接入时必须用 ResizeObserver 实测，不能写死常量（这是接入的主要风险点，也是本轮没直接接入的原因）。

> **批A 开源基础设施与 README 完善（09-11，工程化第一批；纯文档 + 新增文件，未动 src/ 与产物）：** ①**README**：标题下加 Shields.io 徽章三枚（Obsidian Plugin 静态 / release 动态 / license 动态，均补 alt 文本）；新增 **「常见问题（FAQ）」9 组**——数据源失败的六步排查、封面不显示、备份导入导出与换机迁移、内置阅读器/播放器点不开、本地视频黑屏、追番检测原理、AI 摘要与翻译、1.0.2 目录自动迁移、main.js 为何 3.6MB；新增 **「已知问题与限制」6 类**——性能 / 数据源 / 功能边界 / 平台 / 安全 / 测试；「从源码构建」末尾加贡献指南入口。②**`.github/` 八件套**（此前该目录**完全不存在**）：`ISSUE_TEMPLATE/config.yml`（3 条 contact_links + `blank_issues_enabled: true`）、`ISSUE_TEMPLATE/bug_report.yml`（11 项、7 必填）、`ISSUE_TEMPLATE/feature_request.yml`（7 项、3 必填）、`PULL_REQUEST_TEMPLATE.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`（Contributor Covenant 2.1 中译）、`FUNDING.yml`（`custom: ["https://ifdian.net/a/fhb263"]`）。根 CHANGELOG.md 已存在，未重复建。③**README 锚点**用 `<a name="faq">` / `<a name="known-issues">` 显式声明，供 issue 模板与 CONTRIBUTING 稳定链接（**不依赖 CJK 标题自动生成的 anchor**，避免全角括号导致锚点不确定）。④**校验手段（沉淀）**：在隔离 node 工作区写 issue-form 校验脚本，按 GitHub issue-form schema 逐项检查 type 白名单 / label / description / id 唯一性与字符集 / dropdown options / validations.required 配对 —— **初版被拦下 8 处缺 `attributes.description`**（GitHub 要求每个 input/textarea/dropdown/checkboxes 都有 description），补齐后 ALL PASS；config.yml 与 FUNDING.yml 另查 contact_links 必填项、URL 协议、平台键白名单。⑤**测试数字核对**：README 原写「987 单测 62 文件」与实跑一致（`vitest run` → 62 files / **987 passed**），**无需修正**——早前 grep 计数 989 系把 `describe` 内字符串一并计入，已证伪。⑥**镜像同步**：README.md + 新增 `.github/`（7 文件）已同步至公开镜像，逐文件 `cmp` 全部 IDENTICAL。⑦**发现的待跟进**：`manifest.json` 的 `fundingUrl` 仍为空串（与新增 FUNDING.yml 不呼应）、`Project-Rule/AGENTS.md` 内容停留在 v1.0.0（缺 `music` 类型、源数写 10 实为 11、EntryType 只列 5 态），两处留待后续批次。

> **AI 智能摘要（批3，09-10：编辑表单标题旁 ✨ → 一句话总结 + 核心看点；用户定「摘要放简介下面、书籍放目录下面」「看点用多行框每行一条」「写进笔记」；新增 TDD 21 用例，全量 953/953（60 文件），tsc 0 + esbuild production 通过，main.js 3,626,416B，三段 cmp IDENTICAL，产物断言 17 项 ALL PASS）：**
> **① 纯逻辑 `src/pure/aiSummary.ts`**：`buildAiSummaryBody`（把类型/标题/年份/题材/主创/主演/简介/目录组装成 chat/completions 请求体；**prompt 写在此处**，system 硬约束「总结 ≤40 字、不剧透结局、不重复标题、禁『本片讲述了』套话；看点 3 条、每条 ≤20 字、名词短语开头、禁『值得一看』空泛评价；信息不足宁可克制、**不得编造**情节人物；只输出 JSON」；简介/目录分别按 1200/800 字截断控 token；无标题 → null 不发请求）+ `parseAiSummaryResult`（容错：剥 \`\`\`json 围栏 → 提取首个**平衡**的 `{}`（容忍前后解释文字、字符串内花括号不误判）→ 解析；非 JSON 纯文本降级为「一句话总结」；**以 `{` 开头却解析失败一律 null**，不把半截 JSON 写进笔记）+ `highlightsToText`/`textToHighlights`（表单多行框互转，剥 bullet 与「1. / 1、」序号、去重保序）+ `normalizeAiFields`（空值不落库）。
> **② 服务层 `src/services/aiSummary.ts`（增量刹车：外置 service，main 只注册转调）**：`AiSummaryService` 复用**阅读器翻译**的服务商与 Key（不为摘要单开一套凭据），端点/模型走 `pure/translate` 的 `translateChatUrl`/`modelFor`，响应取 `message.content` 复用 `parseTranslateResponse`；错误分诊与翻译一致（未配 Key 引导到设置页、401/429/非 200/非 JSON/无可用结果各自 Notice），超时 20s（长于翻译的 15s）。依赖全部注入（getConfig/notify/http/withTimeout），main 侧 `getAiSummaryService()` 惰性构造 + `aiSummarizeEntry()` 对外。
> **③ 表单 UI（EntryForm）**：标题输入框右侧新增 ✨ 小图标按钮（**尺寸对齐「从文件夹检索剧集」：20×18px 命中区 / 13px 图标 / hover accent**；`sparkles` 走 Icon 组件；读屏名用隐藏文本 `.rl-sr`——**不挂 aria-label，避免与 data-tip 双气泡**，符合 UI-GUIDE v3）；点击 → 元数据喂模型 → 结果回填「一句话总结」单行框（带 `n/40` 字数计数，超限转 error 色）+「核心看点」多行框（每行一条，建议 3 条），**生成后可继续手改再保存**；生成中禁用防连点，标题为空时提示先填标题。落点按用户指定：**非书籍紧贴「简介」之下、书籍在「目录」之下**（两处 `{#if}` 分别渲染，注释标明为刻意重复）。
> **④ 数据与笔记**：`MediaEntry` 增 append-only 可选字段 `aiSummary?: string` / `aiHighlights?: string[]`，`normalizeEntry` 承接（空串/空数组不落库）；笔记生成新增 `## 一句话总结` + `## 核心看点`（无序列表）两节，**位置与表单同序**：简介（书籍再经 作者简介/目录）之后、个人评语之前，只写有值的节。**闭环补全**：`pure/noteEditable.extractEditableFromNote` 同步支持读回这两节（看点按无序列表逐行采集），`EntryModal` 打开表单时合并——否则用户在笔记里手改摘要会在下次保存时被静默覆盖，与「简介/目录」既有可编辑语义保持一致。

> **批3 UI 修订（09-10 用户实机反馈后二次迭代）：** ①**图标不显示**——`sparkles` 在该用户 Obsidian 版本的 lucide 集里缺失（`setIcon` 静默失败 → 按钮空白）→ 改**内联 SVG**（Svelte 模板直写 `<svg>`，编译为真 SVGElement + `attr(path0,"d",…)`，color 走 `currentColor`），彻底不依赖图标集；②**单框合并**（用户定 B 方案）——两字段两框（一句话总结 + 核心看点）合并为**一个「AI 摘要」多行框：第 1 行 = 一句话总结、其余每行 = 一条看点**，保存经 `textToAiFields` 拆回 `aiSummary`/`aiHighlights`，生成时经 `aiFieldsToText` 回填；总结为空而看点非空时首行留空写出，避免看点被顶到总结位（往返用例锁定）；③**去掉 `n/40` 字数计数**（用户要求）；④「每行一条，建议 3 条」等说明**下沉为框内占位符**，不再挂在 label 后缀。新增 6 用例（aiFieldsToText/textToAiFields 往返与边界），并删除随之失效的 `normalizeAiFields`。全量 959/959（60 文件），tsc 0，main.js 3,622,334B，三段 cmp IDENTICAL，断言旧形态零残留。

> **批3 UI 三次迭代（09-10 用户再反馈）：** ①框标题「AI 摘要」→**「总结摘要」**；②**✨ 生成按钮从标题输入框右侧移到「总结摘要」小标题右侧**（样式选择器由 `.rl-title-row .rl-ai-btn` 提升为独立 `.rl-ai-btn` + `margin-left:4px`，两处渲染点同步）；③占位符改为用户指定文案 `一句话总结：/ 1. 要点1 / 2. 要点2 / 3. 要点3`（不再挂「建议 3 条」文字）。同步更正 4 处描述旧位置的注释（EntryModal/EntryForm×2/main）。全量 959/959，tsc 0，main.js 3,621,938B，三段 cmp IDENTICAL，断言「旧标题/旧占位符/旧位置注释」零残留。⚠️ 生成回填不带 `1.` 编号（解析会剥序号），如需框内编号需改 `aiFieldsToText`。

> **重新拉取不再重复下载封面（09-10 用户：「为什么所有类型条目 douban 重新拉取时都会重新下载封面，搞得一堆重复的封面文件，改方案」）：** **根因链**——重新拉取 = 编辑表单展开搜索 → 选中结果回填时 `poster = r.cover` **无条件覆盖**（七个自动回填点：书籍缩略图/豆瓣游戏/音乐/动画 bangumi/OMDB/TMDB 搜索/TMDB 详情）→ 保存后豆瓣封面走 `downloadPosterToLocal`（命名 `封面/{标题}.jpg`，重名追加 **-2/-3** 防覆盖）→ 每次重新拉取都长一个新文件。**新方案**（`pure/posterPolicy.ts` `shouldAdoptCover(current, incoming)` + 3 用例）：本地封面（非 http 路径）视为已有资产，**自动回填一律不覆盖**——重新拉取只刷元数据（年份/题材/简介/评分），封面保留原文件；仅当前封面为空或本身是远程 URL 时才采用/下载。**手动动作不受限**：封面 URL 输入框、拖图上传、清除封面仍是显式覆盖。存量重复文件（`{标题}-2.jpg` 等仍被 poster 引用）不会被孤儿扫描命中，需手动清理或改指回主文件。全量 **987/987（62 文件）**，tsc 0，main.js 3,646,540B，三段 cmp IDENTICAL。

> **音乐发行年无法回填修复（09-10 用户：「音乐字段发行年无法拉取回填」；TDD 先红后绿）：** 两处缺口——①`applyDoubanInfo` 音乐 `#info` 分支只消费「表演者/专辑」，**漏「发行时间」「流派」**（parseDoubanInfo 本就能解析出这两键，测试夹具早就有 `发行时间: 1993-05-14` 却无人消费）→ 补 `发行时间 → year`（`\d{4}` 提取，JSON-LD datePublished 已给时不覆盖，与书籍「出版年」同款兜底）+ `流派 → genres`；②表单选中音乐结果的详情兜底触发条件 `(!r.artist || !r.album)` 漏年份 → 加 `|| !r.year`（搜索级豆瓣结果常无 year，不触发就永远补不上）。新增 1 用例（发行时间→1993、流派→摇滚、JSON-LD 已有 year 不覆盖）。全量 **984/984（61 文件）**，tsc 0，main.js 3,646,152B，三段 cmp IDENTICAL。

> **音乐表单补年份/题材（09-10 用户问「音乐海报墙为什么有两条 -- 占位符」+「音乐编辑条目把年份、题材加回来，题材手动填写放在简介上方」）：** ①**占位符成因**——海报卡「专辑·年份」副行（`cardSubtitle`）与「题材」行（`cardGenres`）按「条件即布局」恒渲染、缺失画「—」防错位（`pure/cardMeta.ts` PLACEHOLDER 先例）；音乐条目两张卡都没填 album/year/genres → 各画两条「—」。②**表单根因**——通用「题材/发行年」区 `{#if type !== 'book' && type !== 'music'}` 把音乐排除，音乐专属区只有 作者/专辑 一行 → 字段无处可填。**修复**：音乐区 作者/专辑 行下补 `rl-2col`「题材（手动 / 分隔）| 发行年」一行（位于简介上方；提交路径 genres/year 本就通用，纯模板改动）；豆瓣音乐搜索回填 genres/year 的既有逻辑不受影响。断言：题材 placeholder 全包恰 3 处（影视/书籍/音乐）。tsc 0，983/983，main.js 3,645,857B，三段 cmp IDENTICAL。

> **快捷按钮再挪页眉（09-10 用户：「算了，把这三个按钮放生成今年总结左旁边」）：** 三按钮从趋势标题行移至页眉 `.rl-s-actions`（顺序：添加条目/随机推荐/想看的清单（N）→ 生成今年总结 → 往年报告下拉）；qbtn 尺寸回归页眉行规格（12px / 6px 12px）；趋势标题还原为「标题 + 图例」。tsc 0，983/983，main.js 3,643,679B，三段 cmp IDENTICAL。

> **并排改 1:1 + 快捷按钮并入趋势标题行（09-10 用户复诊：「按并排 1:1 来，下面三个按钮也放在月度看完趋势上排」）：** `.rl-s-mid` 改 `minmax(0,1fr) minmax(0,1fr)`；删独立快捷行 `<section class="rl-s-quick">`，三个按钮（添加条目/随机推荐/想看的清单（N））移进趋势面板 `.rl-s-panel-title`（标题 → 按钮 → 图例 margin-left:auto 靠右，标题本就 flex-wrap 窄列自动换行）；`.rl-s-qbtn` 紧凑化（12.5px/7px 14px → 11px/3px 9px，圆角 8→7）适配标题行高度；`.rl-s-quick` 容器规则删除（qbtn 样式保留）。tsc 0，983/983，main.js 3,643,687B，三段 cmp IDENTICAL；断言注意「添加条目」文案在空态提示也出现，位置核验用唯一的「想看的清单（」锚点。

> **趋势 × 四库分区并排（09-10 用户：「将月度看完趋势和四库分区并排显示，自适应排版」；AskUserQuestion 定 1.4:1）：** ①**搬移**：四库分区 `<section class="rl-s-part">` 从「趋势下方全宽」移进 `.rl-s-mid` 网格容器（与趋势同容器、等高对齐）。②**比例**：`.rl-s-mid` 改 `grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr)`（minmax(0,…) 防长标题/长 chip 撑破）；趋势标题加 `flex-wrap: wrap`（窄列图例换行防溢出）。③**自适应**：四库分区内部列数改**容器查询**——`.rl-s-part { container-type: inline-size }`，`@container (min-width: 560px)` 才展开 4 列，否则 2×2（并排窄容器自动 2×2；≤900px 回落堆叠、全宽 >560px 又恢复 4 列，比纯媒体查询贴合"自适应"）。⚠️ 断言注意：Svelte scoped CSS 产物无空格（`container-type:inline-size`）、HTML 注释生产编译被剥离，断言按编译形态写。tsc 0，983/983，main.js 3,644,288B，三段 cmp IDENTICAL。

> **「记录到日记」跟随 日/周/月/年（09-10 用户：「记录到日记这个按钮按切换的日周月年改动」）：** ①`pure/activityFeed` 增 `FEED_RANGE_WORDS`（今天/本周/本月/今年，按钮+空态共用）、`feedSectionLabel(range, span)`（区块标识：日=`2026-09-10` / 周=`第 37 周（2026-09-07–09-13）` / 月=`2026-09` / 年=`2026`，带年防跨年撞键）、`renderPeriodBlock(range, span, groups)`（周/月/年把 groupFeed 分块渲染成 quote callout，结构与面板所见一致；空周期 → null）。②`main.recordTodayJournal(range='day')` 参数化：日视图走原 `renderJournalBlock`（逐条 HH:mm），周/月/年走 `renderPeriodBlock`；`upsertJournalSection(note, sectionLabel, block)` 参数语义化——**不同范围的区块标题不同 → 天然互不覆盖**（同范围重复点击仍幂等整体替换）；Notice 空态/成功提示同步按范围措辞。③链路传参：StatsBoard（按钮文案 `记录${rangeWord}`、禁用条件 feed.length===0、tooltip 跟随范围；删 dayAct/today/collectDayActivity 遗留）→ HomeView.svelte → HomeView.ts → main。坑：纯函数字符串拼接经 python 写文件时 `join('\n')` 被解释成真实断行（PARSE ERROR）——写含转义序列的代码须用 chr(10) 显式构造。新增 4 用例（区块标识四形态、周块渲染含追更 detail、月块周标题、空周期 null）。全量 **983/983（61 文件）**，tsc 0，main.js 3,644,005B，三段 cmp IDENTICAL。

> **周期汇总改为逐级细分（09-10 用户纠偏：「是周按日分，月按周分啊」）：** 上一版把周/月都做成「单组全量汇总」——理解错了。正确口径 = **下一级细分**：周视图按**日**分块（`9月10日`，仅含有动态的日期）、月视图按**周**分块（`第 37 周` + 区间 `9月7日–9月13日`）、年视图按**月**分块（`9月`）。`groupFeed` 重构：`groupOf(it)` 按范围返回分组键/标题/次要区间；月视图引入 `weekInfo(date)`（ISO 周键含归属年防跨年撞车、周号、周一~周日区间文案）；`FeedGroup` 增可选 `range`。组件：组标题渲染 `label + range + 共 N 条`，`.rl-feed-groups` 限高 180→**260px**（要放下多组）。测试改为「周按日/月按周」断言并补 `range` 校验。全量 **980/980（61 文件）**，tsc 0，main.js 3,642,750B，三段 cmp IDENTICAL。

> **⚠️ 样式误删事故 + 周期汇总视图（09-10 用户报「四库分区 CSS 失效」）：** ①**事故根因**——上一轮删旧「今年动态」时间线样式时，用 `s.index("/* ── 今年动态时间线 ── */")` 到 `s.index("/* ── 想看清单弹层 ── */")` 的**注释标记区间**整体删除，把夹在中间的**四库分区（`.rl-part-*`）、快捷行（`.rl-s-quick*`）、往年报告下拉（`.rl-dd-*`）共 37 个选择器一起删掉**（用户当轮即发现四库分区塌掉）。**恢复**：从 `git show HEAD:src/views/components/StatsBoard.svelte` 取出 `/* ── 四库分区 ── */` 至 `/* ── 想看清单弹层 ── */` 之间的原始块（3260 字符）原样插入。**核对手法**（沉淀）：用「正则抽取两版 style 块的选择器集合 → 求差集」逐条确认缺失项只剩**有意替换**的那几个（旧图例 5 个 + 旧时间线 8 个）。**教训**：块删除严禁按注释标记区间切，必须用该块自身内容精确匹配；删完必须做选择器集合 diff。②**周/月/年改周期汇总**（用户：「不再是单日统计了，在周月；如 9月10日 / 23周 / 9月：看了什么」）——`pure/activityFeed` 扩展：`isoWeekOf()`（ISO-8601 周号，周四定归属年，实测 2026-09-10=第37周、2025-12-29=第1周）+ 周 label 改 `第 37 周（9月7日–9月13日）`、`FeedItem.detail`（追更 `S1E2` / 游玩 `1.5h`，text 归为「追更」「游玩」）+ **`groupFeed(items, 'week'|'month'|'year')`** 周期分组归并（年视图按月分组、最新月在前；组内按语义归并成行：状态类按 想看→在看→已看→存档 流程 + 新增/追更/计划/游玩，行内**按条目去重**）。StatsBoard：日视图保留逐条（时间+徽标+标题），周/月/年渲染**组标题 + 归并行**（`已读 《A》《B》`，作品名可点跳笔记）；`.rl-feed-groups` 同样限高内部滚动并纳入隐藏滚动条豁免。新增 5 用例（isoWeekOf 边界、周期归并、行内去重、年视图按月、detail 保留）。全量 **979/979（61 文件）**，tsc 0，main.js 3,640,602B，styles.css 56,312B，三段 cmp IDENTICAL；断言含「误删样式全部恢复」专项核对。

> **统计页：动态面板合并 + 日/周/月/年 切换；趋势图 0 值不画线（09-10 用户反馈：「将今年动态合并到今日动态，可按日周月年查看，还有这个月度看完趋势没有各类型条目标记的颜色折线」；AskUserQuestion 定：日历口径 + 0 值不画线图例灰显）：** ①**新纯模块 `src/pure/activityFeed.ts`**（15 用例）——`feedSpan(range, now)` 日历范围（日=当天 / 周=周一起算含跨月跨年 / 月=当月含闰年 2 月 / 年=当年，label 给「9月7日–9月13日」形态）；`collectFeed(entries, log, span)` 把**六源**归并成一条倒序时间轴：状态翻转（activityLog，带 HH:mm）/ 条目新增（createdAt，带 HH:mm）/ 追更（progress.history）/ 计划（plannedDate）/ 完成（watchedDate）/ 游玩（playSessions），**去重规则**＝同「条目+日期」已有状态变更则不再补计划/完成（设 plannedDate 与标「想看」、记 watchedDate 与标「已看」通常同一动作，避免一行变两行），已删条目跳过；`formatFeedTime(item, range)` 行首文案（日=HH:mm、其它=M月D日 [HH:mm]）。②**StatsBoard**：删「今年动态」面板（`.rl-s-act` + `.rl-timeline/.rl-tl-*` CSS 全清）与 `pure/stats.recentActivity`（含 `ActivityItem` + 3 用例——被 collectFeed 取代，避免两套「最近动态」实现并存）；新「动态 · {范围}」面板 = 原今日面板位置，右侧分段控件 `[日][周][月][年]`（`.rl-feed-switch/.rl-feed-tab`，当前项 accent 实心）+「记录到日记」常驻（写入始终是当天）；行 `HH:mm/日期 + 徽标 + 《标题》`，非状态类徽标中性灰（`.rl-today-kind`），行可点跳笔记；`.rl-s-mid` 由「趋势 1.6fr + 动态 1fr」双列改**单列**（趋势全宽）。③**趋势图**：`trendSeries` 带 `on = arr.some(v=>v>0)`，**0 条类型不渲染 polyline**（原多条零值叠成一条贴底线，看着像「缺折线」），图例改**色点 + 灰显标 0**（`.rl-tg-dot` / `.rl-tg-off`，删旧的 `.rl-tg-book|media|game|music` 文字着色）。全量 **974/974（61 文件）**，tsc 0，main.js 3,619,736B，三段 cmp IDENTICAL；README/根 CHANGELOG/RELEASE-NOTES 同步；镜像已同步。

> **统计页「今日」动态改一行一条 + 可滚动（09-10 用户反馈：「今日动态怎么是横排的，改成一个时间一个条目动态，加滑动条」）：** 原因——`.rl-today-list` 原为 `flex-wrap: wrap` 横排（条目少时看着像标签云、多时折行错乱）。改纯 CSS（StatsBoard scoped）：列表 `flex-direction: column` + `gap:4px` + `max-height:180px` + `overflow-y:auto` + `overscroll-behavior:contain` + `padding-right:6px`（给滑块留位）；行内 `.rl-today-item` 改 `display:flex; align-items:baseline; gap:8px`，`.rl-today-time` 固定 `min-width:40px` 让时间成列对齐，标题 `flex:1 1 auto` + 省略号，超长不撑破面板。**滚动条豁免**：`styles.css` 新增 `.rl-hide-scroll .rl-today-list::-webkit-scrollbar { display:block }` + `scrollbar-width:thin`（特异性 0,2,1 压过全局 `.rl-hide-scroll *::-webkit-scrollbar{display:none}`）——用户明确要求此处有滑动条，故这一处不受「隐藏插件内滚动条」设置影响（其余仍遵循）。main.js 3,621,831B，styles.css 56,225B，三段 cmp IDENTICAL；962/962；tsc 0；镜像已同步（styles.css + StatsBoard.svelte）。

> **打卡入口收敛为单一入口（09-10 用户指示：「设置页三项都删除，只保留统计页一个入口」）：** 删除设置页「数据管理」下的 ④ 打卡日记三行——「打卡日记文件夹」「打卡日记文件名格式」「记录今日到日记（立即记录按钮）」；并按「只保留统计页一个入口」**一并撤掉命令面板 `record-today-journal`**（09-10 新增）。**唯一入口 = 统计页「今日」面板的「记录到日记」按钮**（`HomeView → StatsBoard.onRecordJournal → main.recordTodayJournal()` 链路不变，幂等写入逻辑不变）。✅ 字段 `journalDir` / `journalFormat` **保留在 settings 接口**（append-only 红线 + 老用户已填值仍生效），`journalTarget()` 继续读取，只是没有 UI；解析顺序不变：手填值 → 核心「日记」插件 → 回退 `日记/YYYY-MM-DD`。删除随后失效的 `main.describeJournalTarget()`（原仅设置页 desc 用）。main.js 3,624,544B → **3,621,989B（−2.5KB）**。全量 962/962，tsc 0，三段 cmp IDENTICAL。

> **设置页提示词块定形（09-10 用户再反馈）：** ①标签由统一「服务提示词（可改，留空恢复默认）」拆为 **「翻译提示词」/「总结提示词」**；②**默认提示词改为 `placeholder` 灰字呈现**——不再是可编辑的 `value`：灰字点了改不了、点进框里是**空框**（用户写入自己的提示词才覆盖），清空/粘贴回与默认一致 → 存 `undefined` 恢复默认。CSS 相应调整：`.rl-prompt-input` 内容色改 `--text-normal`、新增 `::placeholder { color: var(--text-faint) }`。全量 962/962，tsc 0，main.js 3,624,544B，styles.css 55,939B，三段 cmp IDENTICAL。

> **设置页「AI 翻译与总结」文案精简 + 服务提示词可编辑（09-10 用户再反馈）：** ①**desc 精简**——「翻译服务」→「阅读器AI划词翻译」，「总结服务」→「书籍、影视类型条目Ai总结与摘要」（去掉「与对方相互独立」等长句）；②**下拉选项改名**「智谱 GLM-4-Flash」→「**GLM-4-Flash**」（DeepSeek 项不动）；③**新增可编辑「服务提示词」**——两项服务下各一块（`.rl-prompt-row` / `.rl-prompt-input`，灰色小字 textarea，`Settings.renderPromptField`），**框内直接显示当前生效提示词**（未自定义时即默认文案），失焦保存；**留空/改回与默认完全一致 → 存 undefined，等于恢复默认**。为此把两条 system prompt 从硬编码提为可覆盖：导出 `DEFAULT_TRANSLATE_PROMPT`（pure/translate，原内联英文串）与 `DEFAULT_SUMMARY_PROMPT`（pure/aiSummary，原 `SYSTEM_PROMPT`），`buildTranslateBody(text, provider, prompt?)` / `buildAiSummaryBody(input, provider, prompt?)` 增第三参（空/空白回落默认）；新增设置字段 `readerTranslatePrompt` / `readerSummaryPrompt`（append-only）；服务层 `AiSummaryConfig` 增 `prompt`，`main.translateText` 与 `getAiSummaryService().getConfig()` 各自读取。新增 3 用例（两处 prompt 覆盖 + 默认回落）。全量 962/962（60 文件），tsc 0，main.js 3,624,347B，styles.css 55,871B，三段 cmp IDENTICAL。

> **批3 UI 四次迭代 + 设置页 AI 服务拆分（09-10 用户再反馈）：** ①**生成回填带编号**——`aiFieldsToText` 输出 `1. 要点1` 形态与框内占位符一致（编号**只在展示层**，`textToAiFields` 剥行首序号后落库/笔记仍是无编号纯文本，往返用例锁定无损）。②**设置页「服务集成 ②」更名「阅读器翻译管理」→「AI 翻译与总结」**，其内新增**「总结服务」下拉**（`Section.renderTranslateFold`，样式与「翻译服务」完全一致：智谱 GLM-4-Flash / DeepSeek v4 Flash），两项**各自独立可调**——翻译读 `readerTranslateProvider`、总结读**新增字段** `readerSummaryProvider`（append-only，缺省 zhipu）；**Key 仍共用**（智谱/DeepSeek 两把 Key 一套，服务商只决定「用哪家跑」，凭据不重复配置）。两行 desc 均注明「与对方相互独立」。同步更名用户可见路径文案（`main.translateText` 未配 Key 提示、`AiSummaryService` 未配 Key 提示）与 README 服务集成说明。全量 959/959，tsc 0，main.js 3,622,816B，三段 cmp IDENTICAL，断言旧名零残留。


> **Dataview 集成 + 今日记录（批1+批2，09-10 用户四需求分批落地；AskUserQuestion 四问定案：本轮只做批1+批2、活动日志作数据源、日记自动探测+可手填覆盖、金句范围书籍+影视留待批4）：** 新增 TDD 22 用例（dailyLog 13 + catalog 3 + entryService 4 + noteGenerator 2），全量 **932/932（59 文件）**，tsc 0 + esbuild production 通过，main.js **3,598,519B**，三段（根/build/临时测试库）cmp IDENTICAL，产物断言 13 项 ALL PASS。
> **① Dataview frontmatter 对齐（批1）**：`entryFrontmatter` 补四类字段——`tags: [类型键, ...自定义标签]`（类型键恒在，便于 `FROM #movie`；与自定义标签重复去重保序、逐项加引号防特殊字符）、`created` / `updated`（本地日期 YYYY-MM-DD，Dataview 识别为 date，可 `SORT created DESC`）、`progress_percent`（书籍 percent 优先、回退 page/totalPage，与书架进度条同口径；剧集/动画按 episode/totalEpisodes；游戏/音乐无统一百分比不输出）。**同口径关键**：日期一律经 `pure/dailyLog.localDateOf`（本地时区）——直接 `createdAt.slice(0,10)` 是 UTC 切片，GMT+8 下凌晨 0-8 点会被算到前一天。存量笔记不自动重写（编辑保存任意条目即刷新其 frontmatter）。
> **② 今日记录 + 日记打卡（批2）**：数据源 = **append-only 活动日志**（`Catalog.activityLog: { at, id, status }[]`，上限 `ACTIVITY_LOG_LIMIT=500` 截断最旧）——此前只有 `updatedAt`（任何编辑都刷），答不出「何时何分标成已看」。写入**集中在 EntryService**：`setStatus` 与 `update`（**状态真的变了才记**，否则表单保存会刷满日志）；parse/serialize/load 三处透传 + 逐条校验（at 可解析 + id 非空 + status 合法，脏数据丢弃）。「新增条目」不另记日志，取 `createdAt`（存量数据零迁移即可回溯）。纯函数 `pure/dailyLog.ts`：`localDateOf/localTimeOf/todayLocal` + `collectDayActivity`（当日归集，已删条目的状态记录跳过）+ `renderJournalBlock`（`## ReelLudic 打卡 · YYYY-MM-DD` + `> [!reelludic] 今日 N 条动态` + 按类型换状态文案 `- 14:32 已看《三体》` + 新增行；无动态返回 null）+ `upsertJournalSection`（**幂等**：已有同日区块整体替换，只动本区块、相邻日期区块不误伤，重跑结果不变）。**入口两处**：命令面板 `record-today-journal`「记录今日观影/阅读到日记」+ 统计页「今日」面板右侧「记录到日记」按钮（同一 `main.recordTodayJournal()`，零动态时按钮禁用并提示）。**日记落点**：`settings.journalDir/journalFormat` 手填优先 → 核心「日记」插件 `internalPlugins.getPluginById('daily-notes').instance.options`（folder/format）→ 回退 `日记/YYYY-MM-DD`；目录不存在逐级创建（`createFolder` 只建一级）；设置页「数据管理」新增三项（文件夹 / 文件名格式 / 立即记录按钮，desc 实时显示当前解析路径）。统计页「今日」面板：状态变更 `HH:mm 徽标《标题》`（按类型显示 想看/在看/已看/存档、想读/在读/已读…）+ 「新增 N 条：标题 / …」+ 「共 N 条动态」脚注；空态给引导文案。

> **三处体验收敛（09-10：设置页文案 / 文件关联去二次弹窗 / 右键菜单边界自适应，用户指示 + AskUserQuestion 定三选：标题写「支持 ReelLudic」、边缘策略「先翻转再钳制 + 超高可滚动」、编辑表单封面菜单一起修；新增 TDD 12 用例，全量 908/908（58 文件），tsc 0 + esbuild production 通过，main.js 3,571,750B，三段（根/build/临时测试库）cmp IDENTICAL，产物断言 ALL PASS）：**
> ①**设置页「支持作者」→「支持 ReelLudic」**（src/Settings.ts 关于区标题；描述与双按钮不动）。用户指示「纯文案替换」，品牌大小写按产品名规范（ReelLudic 中间加空格）。
> ②**文件关联不再二次弹窗（全部类型直连系统文件管理器）**：根因——`main.pickSystemFile` 经 `pickFileDual` 弹 `PickFileSourceModal`（「从库中选择 / 从系统浏览」），每次点「浏览…」多一步且弹窗内再嵌 vault 建议列表；用户判断 vault 内文件在系统对话框同样可选、选择器无收益。改动：删除 `pickFileDual` → `pickSystemFile` 直接 `showOpenDialog`（保留 `toRel` 选后路径归一：书/音频/.lnk 落库转 vault 相对、视频因系统播放需绝对路径不转；保留 `lastSystemDir` 会话内目录接续）；删 `src/modals/PickFileSourceModal.ts`（唯一调用方）＋ styles.css `.rl-pick-src*` 区块 ＋ main.ts import；EntryForm 4 处 `data-tip` 「（库内/系统二选一）」→「（系统文件管理器）」。覆盖影视/书籍/游戏/音乐，编辑表单与快捷关联弹窗同源生效（`pickForAssociate` 分发不变）。`VaultFileSuggest` 保留（备份恢复入口仍在用）。
> ③**浮出菜单边界自适应下沉纯函数 `src/pure/menuPlacement.ts`（placeMenu）＋ `tests/menuPlacement.test.ts` 12 用例（红→绿）**：根因——旧 `MediaList.openCtx` 把**锚点相对坐标**（`ev.clientX - anchor.left`）直接与**视口宽高**比较做钳制，而 `.rl-ctx-anchor` 是内容末尾的零高 div（列表越长 a.top 偏移越大）→ 跨坐标系比较使钳制形同失效，下/右边缘触发时菜单跑出屏幕；另有翻转后不复测、菜单高于视口无兜底、`Esc` 监听每开一次 `once` 叠加一个。修法：全程**视口系**计算 → 贴鼠标 → 越界翻转（flipGap 8）→ 翻转侧仍越界则双向钳制（margin 6）→ 菜单超可用区域时返回 `maxHeight/maxWidth` 封顶（CSS `overflow:auto` + `overscroll-behavior:contain` 内部滚动）→ 最后 `left - anchorRect.left` 换算回锚点相对系写回 `ctxX/ctxY`；window 监听改「打开时绑定 / 关闭时摘除」的具名对（`unbindCtxWindow`）。**编辑表单封面右键菜单一并修**（用户勾选「一起修」）：原 `position:fixed` 直用 `clientX/clientY` 零边界处理 → 改走同一 `placeMenu`（视口系直用），并保存 `ctxMouseX/ctxMouseY` 以便「切换网络图片」使菜单变高后 `placePosterCtx` 重算；`.rl-ctx` 加 `overflow:auto`。
> ⚠️ **规范沉淀**：UI-GUIDE §3 新增两条硬约定——(a) 文件关联一律系统对话框，禁止再引入「库内/系统」二选一（原 `PickFileSourceModal` 已删）；(b) 浮出菜单边界自适应强制走 `placeMenu`，**禁止把锚点相对坐标与视口宽高直接比较**。

> **hover 双提示去重（09-09 晚，用户：有些按钮 hover 弹两个提示、第二个盖第一个；tsc 0 + 全量 896/896 + main.js 3,533,071B 三段 cmp OK + 产物断言 PASS）：** 机制事实——Obsidian 对悬停目标（含祖先就近匹配）带 `aria-label` 的元素自动弹官方气泡（`setTooltip` 只是 aria-label 包装），与插件自绘 `data-tip` 气泡并存即叠双层。全仓括号感知逐元素扫描确凿 13 处（全在 EntryForm）：①同元素双挂 2 处（「从文件夹检索剧集」图标、movie「观看」按钮）；②4 个内联编辑浮层 `.rl-ep-edit role=dialog aria-label`（游戏/音频/书籍/剧集）内 11 个 data-tip 子按钮（浏览…/保存/清除）被祖先官方气泡叠盖。修复（方案 B 最小去重，用户拍板 + 阅读器 title 一并统一）：浮层容器 aria-label → `aria-labelledby` 指向可见标题（`.rl-ep-edit-title` 加 `id=rl-ep-title-{game|audio|book|ep}`——aria-labelledby 不触发官方气泡，读屏 dialog 名不丢）；「观看」（有可见文字）删 aria 留 data-tip 富提示；「检索剧集」图标删重复 data-tip 留 aria（与旁边刷新图标同款官方气泡）；阅读器 Epub/TxtReaderModal mkQuick 4 按钮 `attr:{title}` → `attr:{'data-tip':title}`（原生黄条清零，符合 UI-GUIDE）。复扫 same-el A+D = 0、attr:{title} 残留 0。**规范更新**：UI-GUIDE §3「aria-label 与 data-tip 可并存」表述纠正为「同一元素/祖先链并存会双提示；读屏名优先可见文字/aria-labelledby」；AGENTS 坑点行同步。

> **豆瓣封面统一高清化（v7，09-09 晚，用户：所有类型统一高清化一并处理旧条目；tsc 0 + 全量 896/896 + 三段 cmp OK + 产物断言 PASS）：** 根因——搜索级豆瓣 spic / s_ratio_poster 缩略档（70~100px）落库导致海报墙糊。fetch 侧高清化（用户已确认交付）：douban.ts 新增纯函数 `upscaleDoubanCover`（spic|mpic→lpic；s_ratio_poster→l_ratio_poster；view/photo/m|s→l；幂等；非 doubanio 直通）接入 3 处封面出口（搜索项 cover / 游戏详情 cover / og meta cover）+ `ogImageOf`（fetchDetail JSON-LD 分支 `ld.cover ?? og:image` 兜底，JSON-LD 无图不再丢封面）。存量升级：main.ts `upgradeBlurredPosters` 内部方法（只扫 豆瓣源+本地化 poster+实测宽<200px+有 sourceUrl → 回源详情取高清 → modifyBinary 覆盖同名）+ 纯函数 src/pure/imageSize.ts（JPEG SOF0/1/2 + PNG IHDR 文件头测宽，4 用例）；candidates 收敛窄化结构修 TS18048/2345。**用户否设置页「封面高清化」按钮入口（AskUserQuestion：「我自己处理旧条目算了」）——fetch 侧维持，upgrade 保留内部能力勿再提议 UI**。

> **海报墙右键菜单被卡片 hover 遮罩盖住（09-09 晚 23:03，用户截图；tsc+esbuild 通过，main.js 3,565,382B 三段 cmp OK，产物断言 z-index/isolation FOUND）：** 根因——`.rl-card`（overflow:hidden+relative+background+hover `.rl-cov-hover` z-index:6）被 Chromium 视为独立 stacking context；`.rl-ctx`（anchor 内 z-index:100）所在 `.rl-ctx-anchor` 仅 relative 无 z-index 不建层 → 两层隔开卡片 hover 遮罩盖住菜单。修复 `.rl-ctx-anchor { position:relative; z-index:50; isolation:isolate }` 提层 + 强制独立 stacking context（anchor 为空 div 仅条件渲染菜单无副作用；与 .rl-to-top z-index:1000 区分）。

> **删除弹窗去红圆底（v6，09-09 晚 22:39，用户：所有删除弹窗去掉红底实心圆块、保留 ⚠️ 图标）：** `.rl-nc-icon` 去 background:var(--background-modifier-error)+border-radius:50%+width/height 46px 圆形容器 → 保留 emoji 居中直出（font-size 22px）；ConfirmModal/NoteConflictModal 共用该类同时生效；纯静态 CSS 不经 esbuild，styles.css 根/build/测试库 cmp IDENTICAL。

> **阅读进度/书签 JSON 文件名可读化（用户报「阅读进度全是英文+数字」，确认=文件树 e_xxx 名；AskUserQuestion 定「书名-阅读进度|书签-原ID」形态，TDD 12 新用例，全量 871/871（56 文件），tsc 0，main.js 3,562,437B，三段 cmp IDENTICAL，目标库产物断言 ALL PASS）：** 阅读进度/{entryId}.json 与 {entryId}.bookmarks.json（e_xxx 难辨认）→ `{书名}-阅读进度-{id}.json` / `{书名}-书签-{id}.json`（前段书名可读、尾段保留原 ID 保关联与同名去重；书签弃 .bookmarks.json 双词尾改对称 .json）。**改动**：①pure/readingProgress.ts 增 sanitizeReaderTitle（同 noteGenerator.safeFilename 规则）/progressFileName/bookmarksFileName/readingProgressFilePath/matchLegacyProgressFile（旧名识别正则 ^e_\d+_[a-z0-9]{4}，新名/无关文件 null 幂等）；②bookmark.ts bookmarksFilePath 签名改 (entryId,title,libraryDir)，import 共享命名函数；③main readReaderProgress/saveReadingProgress/readBookmarks/saveBookmarks 全带 title 走新名 + **旧名读取兜底**（极端遗留不丢进度）；④migrateProgressFileNames 启动迁移（service 就绪后）：扫描 阅读进度/ 旧格式 → catalog 查 title → rename，孤儿（条目已删）保留原名，幂等防同名覆盖。**测试**：readingProgress.test +21（sanitize/两文件名/路径/旧名识别），bookmark.test 路径断言 4 处改新格式，net 859→871。⚠️ 产物断言「-阅读进度-」「-书签-」模板含连字符字面量；node -e 用 heredoc 单引号防 shell/类型剥离吃反斜杠。**待办**：用户 Reload 实测迁移后文件树显示书名；commit 并入待提交集。

> **笔记类型子目录英文化（用户指示：文件夹 movie/teleplay/animation/book/game/music，其他不变；方案 AskUserQuestion 确认「保留笔记父层 + 插件自动迁移」，TDD 红→绿 7 新用例，全量 859/859（56 文件），tsc 0，main.js 3,559,286B，三段 cmp IDENTICAL，目标库产物断言 ALL PASS）：** 目录命名演进（v0.4 顶层通俗化之后）：`笔记/{中文标签}` → `笔记/{英文}`（tv→teleplay、anime→animation 为通俗词非内部键；movie/book/game/music 同名）。**改动**：①data/types.ts 新增 `ENTRY_TYPE_DIRS`（与 UI 中文标签 ENTRY_TYPE_LABELS 解耦——界面类型名仍中文）；②pure/dirs.ts 成真正命名中枢——typeDir() 改返英文目录名、`LEGACY_TYPE_DIR_ZH`（旧中文标签表）、`relocateLegacyNotePath()`（notePath 类型目录段中文→英文：仅非末段整段命中才替换，标题含词/封面平铺路径/二次迁移幂等不误伤）；③noteGenerator.entryNotePath 用 ENTRY_TYPE_DIRS；④EntryService.writeNote 去 `/笔记` 硬编码改 DIR_NOTES 常量；⑤main.ts migrateDirectories 增 1b 步骤（`笔记/{中文}`→`笔记/{英文}` 幂等 rename）+ catalog notePath 经 relocateLegacyNotePath 接力（typeDir 语义变更使 v0.4 旧库路径一步到位英文，中文库走 1b，两向收敛同一目标）。**测试**：新 tests/dirs.test.ts 7 用例（六类英文名全覆盖/自定义库目录/幂等/标题含词不误伤/非笔记目录不误伤）；既有路径断言 6 处改英文（noteGenerator 377-379、entryService 147/166/167/339）。**产物断言要点**：`relocateLegacyNotePath(` 在、六类 `key: "en"` 常量在、UI `movie: "电影"` 仍在；⚠️ node -e 双引号转义被 shell/类型剥离吞 `\s` 正则反斜杠 → 断言用 includes 字面量或 heredoc 单引号。**待办**：用户 Obsidian Reload 实测迁移（文件夹改名 + notePath 同步 + 打开笔记正常）+ 1.0.1 批次提交一并处理。

> **编辑表单字段重排：动画/剧集「总集数＋当前进度」并排、电影移除总集数框、观看链接改单集 ▶ 播放图标按钮（用户指示，822/822 全绿，tsc+esbuild 通过，产物断言 PASS，已部署测试库 cmp IDENTICAL）：** ①**并排**——动画/电视剧（非 bangumi 源模式）的「总集数」输入与「当前进度 S[季]E[集]」此前各占一整行，合并为同一 `rl-2col` 左右两列并排（原行尾常驻 hint「列表/月历按此显示进度」改为 label `title` 悬停提示，行高与同列条目一致、信息密度更高）；②**电影移除总集数框**——电影此前在两处仍显示总集数输入（bangumi 源模式导演行右列 `{:else if}` 含 movie + 非 bangumi 的独立总集数行含 movie），与电影=单集语义矛盾，两处入口全删（右列改仅 tv/anime 分支、独立行块删除并入 ①），`totalEpisodes` 对电影固定默认 '1'（L226 注释同步）；③**观看链接 ▶ 图标钮**——电影「观看链接」原渲染数字「1」小按钮，改为单个 ▶ 播放图标按钮（`<Icon icon="play" size={14}/>`，aria-label「播放（第 1 集）」，左键 `playOrOpenEpisode(0)` 播放/打开、右键 `openEpEditor(0)` 编辑关联；新增 `.rl-ep-btn-icon` inline-flex 居中、与集按钮同尺寸）；剧集/动画 1..N 集编号按钮不变。改动仅 src/views/components/EntryForm.svelte 模板/CSS/注释（无纯逻辑，无 TDD 增量）。验证：tsc 0；esbuild production 通过；main.js **3,521,658B**；三产物（根/build/测试库）cmp IDENTICAL；产物断言（decode \uXXXX 后）：「总集数/当前进度/观看链接/播放（第 1 集）」在，编译上下文 `attr(button,"class","rl-ep-btn rl-ep-btn-icon…")` + Icon 实例化 `icon: "play", size: 14` 确认，`.rl-ep-btn-icon{display:inline-flex…}` 已注入 main.js（Svelte scoped CSS 在 bundle 而非 styles.css，属预期）。⚠️ 两条初查假阴性均断言写法问题（scoped 样式误查 styles.css、组件 prop 编译形态带空格非 `icon="play"`），非代码缺陷。根 CHANGELOG [未发布] 变更节同步。commit 待本批

> **动画条目数据源回填修复（豆瓣详情补拉 + Bangumi persons 裸数组解析，用户报「添加动画条目回填不了题材/导演/主演/导演」，TDD 822/822 全绿，tsc+esbuild 通过，产物断言 PASS，已部署测试库 cmp IDENTICAL）：** ①**豆瓣动画缺回填根因**——`searchAnime` 把豆瓣结果用 `toBangumiResult` 转成 BangumiSearchResult（source='douban'），EntryForm.pick 的动画分支（`'studio' in r`）只消费搜索级字段（parseDoubanItem 本来就不含题材/导演/主演），且仅对 bangumi 原生结果发 persons/subject 详情——**从不发豆瓣详情请求**（书/游戏/音乐/电影/剧集分支都有，唯独动画漏）→ 恒空。补：source==='douban' 且缺导演/主演时按需 `onFetchDoubanDetail`（对齐电影分支），applyDoubanDetail 幂等回填题材/导演/主演/国家/集数等，失败静默可手填。②**Bangumi 导演恒空根因**——`parseBangumiPersons` 误按 `{"data":[...]}` 包装解析，而该接口真实响应是**裸数组** `RelatedPerson[]`（官方 OpenAPI 200 schema，含 id/name/type/career/relation/eps）→ `obj.data` undefined 恒 `return {}`；单测夹具恰好用 data 包装假结构所以一直绿。修：兼容裸数组与包装两形态（`Array.isArray(parsed) ? parsed : wrap.data`），+2 用例（sources 12→14）。③**海报墙题材行恒渲染**——grid 卡片 `.rl-tags` 原 `{#if tagText}` 空题材整行消失（行数参差），改纯函数 `cardGenres/hasCardGenres`（空→「—」同款占位，前 2 个 · 连接）+ cardMeta 19→24 用例，MediaList 删本地 tagText 恒渲染该行。改动：bangumi.ts / EntryForm.svelte / pure/cardMeta.ts / MediaList.svelte + 2 测试文件；main.js 3,518,340B（+11B）。根 CHANGELOG [未发布] 变更+修复节同步。

> **「隐藏插件内滚动条」作用范围收窄——阅读器滚动条始终显示（用户澄清，tsc+esbuild 通过，产物断言 PASS，已部署测试库 cmp IDENTICAL）：** 用户原意是**不要**隐藏阅读器滚动条（PDF 阅读器此前从未接该设置，TXT/EPUB 却跟随隐藏，三格式不一致）。改动：删除 TxtReaderOptions/EpubReaderOptions.hideScrollbars 字段 → ReaderModal 两 Modal onOpen 不再 `addClass('rl-hide-scroll')`、EpubReader iframe 文档不再注入 `::-webkit-scrollbar{display:none}` → main.ts 两处传参删除；设置项 desc 同步改为「隐藏主界面与编辑弹窗内滚动条…阅读器（TXT/EPUB/PDF）不受影响，滚动条始终显示」。保留：HomeView 主界面 + EntryModal 编辑弹窗仍跟随设置。产物断言：rl-hide-scroll 在 bundle 恰 2 处（HomeView+EntryModal）、EPUB iframe 隐藏滚动条注入 0 残留。

> **扫描版 PDF 整页空白（pdfjs v5 wasm 解码缺失，用户报《资本论（全三卷）》3022 页全空，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，待真机验证）：** 根因——该文件为 CCITT(G3/G4) 传真压缩扫描版（57.6MB/3022 页、零文字层）；pdfjs-dist **v5 起把 CCITT/JBIG2 解码改为外部 WASM**（需 `getDocument({ wasmUrl })` 提供 `jbig2.wasm`），而本插件是「单文件产物 + Blob 内联 worker」，Obsidian 环境拿不到 wasm → 每页图像 XObject 被 pdf.js 直接忽略（`ignoring XObject: "Jbig2Error: JBig2 failed to initialize"`）→ canvas 全空白。**复现与验证（Node 离线）**：v5 下 3022 页抽样全部 0 图像操作；同文件喂 v4.10.38 无警告、CCITT 页正常出图像操作。**修复**：pdfjs-dist ^5.7.284 → **^4.10.38**（传真/JPEG2000/色彩解码纯 JS 内联 worker，无外部资源依赖，单文件产物与三件套 cmp 流程不变）；唯一 API 适配——v4 `page.render` 参数是 `canvasContext`（v5 才改 `canvas`），改传 ctx（HiDPI 预变换不变）。产物 3.57MB→3.51MB。**红线沉淀**：本项目 PDF 依赖**固定 v4 线**，勿升 v5（除非改用非单文件部署并解决 wasm 资源加载）。

> **EPUB 目录「只显示 chapter1.html 等文件名」解析（用户报《活着》截图，TDD 7+12 用例全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 根因——廉价导出的 EPUB 往往既无 `nav.xhtml` 也无标准名 `toc.ncx`（用 `fb.ncx` 之类），`parseTocNav` 找不到入口 → 兜底用 spine href 末段做 label（OPF 顺序是 coverpage → chapter1 → chapter13 → chapter2 → …），侧栏就成了「coverpage.html / chapter13.html」字样。**修复策略（pure/epubParse + main.unpackEpub）**：①保留 nav.xhtml/toc.ncx 优先；②兜底扫 manifest 中 `application/x-dtbncx+xml` 媒体类型条目（解析 NCX），命中即取；③最终兜底从每个 spine 章节 XHTML 抽 `<h1>` > `<title>` 作 label，**剔除等于书名的 title**（扉页 chapter1.html 的 `<title>` 常写「活着」无信息不参与，否则会污染目录），仍抽不出才用文件名。**OPF spine 顺序保持权威**——本例中 chapter13.html 实为「作者简介」被前置是 EPUB 自身导出顺序问题，不自动重排（用户可一目了然看出问题）。**TDD**：extractChapterLabel 新增 7 用例（h1 优先/inline 标签折叠/title 排除书名/空字符串/空 title），与原 12 用例一同 19/19 绿。

> **周历点击弹当天详情 + 清除排期不关窗（用户报障，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** ①周视图日期格此前无点击行为——现与月历一致：点击当天格子（含空白/日期头/「空」）弹出当天计划弹窗，格子内条目卡仍点击打开笔记（stopPropagation 防止冒泡误弹）。②当天计划弹窗「清除排期」此前清除后弹窗即关闭——改为保持打开并实时移除该条目（计数/空态同步），可连续清除当天多条排期。

> **排期表月/周历等高 + 待排侧栏限高滚动（用户指示，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** ①周历此前每天仅 `min-height:220px`，明显矮于 6 行 ×84px 的月历，切换视图高度跳动——引入统一高度基准 `--cal-h`（≈ 月历总高），周历行 `minmax(0,1fr)` 填满与月历等高；②待排侧栏无高度上限，条目一多整栏被撑长——侧栏改 `height:100% + 内部滚动`，周视图单日条目过多时也列内滚动。月/周切换与待排数量都不再影响页面总高。

> **设置页阅读器翻译管理：折叠标题改名 + 删提示文案（用户截图指示，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 「阅读器翻译管理」折叠项下两个服务商 Key 折叠行标题「智谱 GLM-4-Flash」/「DeepSeek v4 Flash」改为「智谱清言」/「DeepSeek」（更贴近用户认知）；删除顶部提示文字「划词由 AI 自动中英互译。选服务商、填 Key，点「测试连接」验证。」。下拉服务商模型名 `智谱 GLM-4-Flash`/`DeepSeek v4 Flash` 保留（属模型名不混改）。

> **hover 缩放系数统一（同风格微调收尾，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 全项目 hover 放大系数收敛为单一 `scale(1.12)`——海报墙封面「打开笔记」胶囊按钮原为 `scale(1.05)`，与列表/追番表/音乐行两档并存，统一后消除视觉分裂。

> **追番表/音乐行成对按钮 hover 统一（同风格微调，用户 A+B，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 项目级按钮 hover 语言统一到「hover → accent + scale(1.12)」：①追番表表格行观看/编辑文字按钮（.rl-tr-btn）补 hover 放大与 transition（原已同灰 + hover accent）；②音乐分组歌单行内播放/编辑钮 hover 统一（编辑钮原为灰底不变色，改 accent；两钮 hover 均放大）。

> **列表观看/编辑按钮等高统一（用户「高度不一样」，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** #218 颜色统一后两钮高度仍不一致（编辑钮文本 ✎ vs 观看钮 SVG 图标，行内布局按内容撑高）。修复：操作列按钮加 `inline-flex + 固定 22px 高 + flex 居中`，文本与图标绝对等高垂直居中。

> **列表视图观看/编辑按钮样式统一（用户指示「未 hover 灰、悬停变色放大」，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 列表操作列的观看按钮（▶ 播放/阅读/启动等）此前常驻主题色，与默认灰的编辑按钮视觉割裂。改动：观看按钮改为与编辑一致——未 hover 灰色描边，hover 时主题色/主题底白字并轻微放大（`transform: scale(1.12)`，补 transition 平滑）。

> **列表进度列仅「在看」状态显示 S/E（用户截图报「想看」显示 S1E1·100% 绿满，808/808 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 修影视页签列表视图的视觉错觉——MediaList `listProgress` tv/anime 分支只看 `e.progress` 存在、不看 `e.status`，导致历史残留 progress + 「想看」状态被错显 SxEy 与百分比绿条。改动：守卫加 `e.status === 'watching'`，仅「在看」显示 SxEy + 进度条；想看/已看/存档全部隐藏（book/game 分支不受影响）。状态切换为「在看」即恢复显示，状态切换为他即隐藏。

> **剧集/动画表单「当前进度 S/E」手填（用户报 movie/game 卡片显示 S1E1，808/808 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** 修复影视进度不可手填的问题——`season`/`episode` 变量此前只用于保存、从未绑定输入控件，剧集/动画的 SxEy 只能被观看/追更动作自动推进（新建默认 episode=1 直接出 S1E1）。现剧集/动画编辑表单「总集数」下新增「当前进度 S[季] E[集]」双输入（钳制：季≥1、集≥0，非法回退原值防 NaN 落库），保存后列表/月历/追番表的 S/E 展示与手填一致。电影/游戏无季/集概念不显示该控件（各渲染点本就限 tv/anime 类型）。

> **统计页完全重构（数据优先 + 克制裁剪 + 往年报告入口，规格 docs/full-cycle/ReelLudic/17-统计页完全重构规划.md，808/808 全绿含 8 新单测，tsc+esbuild 通过，产物解码断言 PASS，已部署测试库 cmp IDENTICAL）：** 统计页回归 UI-GUIDE（原 StatsBoard 是全区块违规最重区域）。**信息架构**：页眉动作（生成今年总结 + 往年报告 ▾）→ KPI 行（今年看完/本月看完/在追在读/本月计划/库内总数）→ 月度看完趋势 × 今年动态 → 四库分区（数据主体）→ 快捷行（添加/随机推荐/想看的清单）。**克制裁剪**：删年度目标能量环（localStorage `reelludic-yearly-target` 键不再读写）、类型分布玻璃卡（子类型计数并入影视列）、霓虹热力图与全部 emoji/渐变/发光/彩色阴影；Icon 统一 Lucide 白名单。**历史回顾**：往年报告入口读 `{libraryDir}/报告/YYYY-年度总结.md` 年份降序列出点开。**纯逻辑 TDD**：新增 pure/reportIndex.ts（parseReportYear/listReportYears）+ stats.ts 下沉 recentActivity（限年内）。改动：StatsBoard.svelte 全重写 + main.listYearReports/openReport + HomeView.ts/.svelte 透传。红线不动：stats/report 口径、catalog schema、报告生成逻辑。

> **顶栏四快捷按钮「标注模式锁」（点钮→激活变色→此后拖选正文即自动执行该钮功能→再点退出；TXT/EPUB，规格 2026-09-04-reader-quick-annotate-mode-design，791/791 全绿含 7 toggle 单测，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 e0c4715→14f6598）：** 阅读器顶栏左「书签/批注/翻译/高亮」四钮升级为**标注模式锁**——点钮进入激活态（`.rl-quick-active` 强调底变色，title 提示用法），此后在正文拖选文字即**自动触发**该钮动作，再点退出。**四钮行为**：🖍高亮=静默自动 toggle（拖选未高亮段→新增黄标；拖选**已高亮**段→**取消**该条；写笔记「## 高亮」+ 页内 `<mark>`）；❝批注=每次拖选弹既有摘录确认窗；🌐翻译=每次拖选就地译文浮层；★书签=激活后**单击正文(无选区)**存一个位置书签（按章去重）。**实现**：`annotateMode`(null|bookmark|quote|languages|highlighter) 状态 + quickBtns 引用 + toggleAnnotate/setAnnotate/resetAnnotate（切章/关面板自动复位）；onTextMouseUp/onFrameMouseUp **前置分派**（激活+选区→走对应动作并 return，不弹普通动作条）；pure/highlight 加 normText/findSameHighlight(去空白同章比对)/decideHighlightToggle（纯函数 TDD）。**高亮 pane「清除全部」**：高亮区头部加按钮 + confirm 后逐条删笔记块并清页内黄标。删旧的顶栏 one-shot quickTranslate/quickHighlight（动作条 selbar 的 one-shot 保留）。旧侧栏 pane 仍经目录列 tab 行进入。

> **阅读器翻页模式（TXT/EPUB 真分页渲染，两模式可切换，用户「规划翻页」→「开始」批，规格 2026-09-04-reader-paged-mode-design，784/784 全绿含 12 paged 单测，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 7083810→face4d3）：** 阅读器扩展出「连续滚动（默认）/ 翻页」两种可切换模式——右上下拉「滚动模式」勾选连续/翻页即切。**CSS 列式分页**：翻页时把当前章一次排成 N 个「屏宽列」（textEl `column-width: 可视宽` + `height: 可视高`），每列恰为一屏一页，翻页平移容器；页码换算章内百分比，进度仍存「章+scrollRatio」语义不新增字段。**核心架构洞察**：连续(scrollTop/可滚长)与翻页(页index/(总列−1))统一为「章内前进比例 ratio」，只在换算点产出同一 scrollRatio → 进度持久化/跨章百分比/字号行距重排归位/高亮跳转全复用现逻辑不重写。**改动**：pure/paged.ts（pageToRatio/ratioToPage/pageStep/isFirst/isLast/clampRatio/clampPage + normalizeScrollMode）；Settings.readerScrollMode('continuous'|'paged' 缺省 continuous)；TXT/EPUB modal——scrollEl 加 `.rl-paged` 类（overflow 裁剪、去连续模式 40vh 底 padding）、setupPagedLayout 测总页、goToPage 平移、currentRatio/applyRatio mode 感知集中约 15 处滚动触点、updateProgress/currentPercent/currentLoc/flushSave/adjustFont/LineHeight 全走 currentRatio、renderContent 分支、footer‹›+键盘←→ 走 goPrevPage/goNextPage（连续模式退回翻章）、切模式重渲染保留原比例归位。EPUB onFrameLoad 分支（翻页 setupPagedLayout+定位页 代替 scrollTop 还原）、applyLayout/buildFrameDoc 翻页去双栏/40vh。**范围**：PDF 不纳入；EPUB 连续双栏只在连续模式保留。需用户 Obsidian 实测目检翻页视觉（CSS columns 布局无法沙盒目检）。**

> **阅读器划词高亮（页内持久黄标 + 写笔记「## 高亮」区，用户「先做高亮」批，规格 2026-09-04-reader-highlight-design，772/772 全绿含 19 高亮单测，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 94fe289→d4a0ffb）：** TXT/EPUB 阅读器选中文字可持久高亮——**一键即黄即记**：选中 → 动作条或顶栏「🖍高亮」→ 不弹窗、不打断，正文该段立即标 `<mark class="rl-hl-persist">` 黄标 **并自动写入书目笔记独立「## 高亮」区**（blockquote + `^hl…` 块，复用摘抄格式仅区标题/前缀异，与「## 摘抄」并列）。**页内还原**：每次渲染章节按本章高亮 loc.chapter 过滤，`findQuoteSegment`（去空白子串匹配→原文偏移，纯函数）把命中片段包 mark；重开/切章自动还原。**标注管理**：批注(摘抄) pane 顶部「高亮」区——计数 + 高亮列表（点击跳原书定位、右键删 → main 确认 → 移除 mark + 删笔记块）。范围 TXT+EPUB。**实现要点**：pure/excerpt.ts 参数化 section（extract/count/merge/append 加 section 参数缺省 '摘抄'）+ 新增 `parseExcerptBlocks`（^id 锚点切块——修初版按空行切块把 render 的 quote/meta 拆散 bug）；pure/highlight.ts（parseHighlightBlocks 复用 + chapterHighlights + findQuoteSegment + renderHighlightBlock）；EntryService.addHighlight/deleteHighlight（^hl id + 高亮区）；main loadEntryHighlights/addBookHighlight/deleteBookHighlight + options（highlights/onHighlight/onDeleteHighlight）；动作条/顶栏「高亮」灰态→真。摘抄（确认弹窗进「## 摘抄」、页内不标黄）与书签（位置书签、不进笔记）保持原语义不变。**

> **阅读器划词翻译（AI 双源：智谱 GLM + DeepSeek，用户「小功能直接开写」批3，Inline 实现，规格 2026-09-04-reader-translate-design，753/753 全绿含 18 翻译单测，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 2eca263→0bc1e01）：** 阅读器选中文字可翻译——①**服务**：**双源**（服务商下拉选默认源，默认智谱）——智谱 `POST open.bigmodel.cn/api/paas/v4/chat/completions`（GLM-4-Flash 免费）+ DeepSeek `api.deepseek.com/chat/completions`（deepseek-v4-flash），均 `Authorization: Bearer`；r4 起**模型固定**（hardcoded，UI 不可改）。**自动中英互译**（中文→英文 / 英文→中文，只输出译文，同 cform prompt）。pure/translate.ts（translateChatUrl/modelFor/normalizeProvider/buildTranslateBody/buildTranslatePingBody/parseTranslateResponse，18 用例）；main translateText 按源分派，未配 Key/401/429/非 200/无译文 → 细分 Notice；**testTranslateConnection(provider)** 发 ping 验证 Key。②**设置页 AI 翻译配置**：服务集成「③ AI 翻译（划词）」折叠项——服务商下拉 + 双源 Key 块（名称+已配置徽标+密文+测试连接+结果）。**修折叠打不开 bug**（内层 .rl-key-row 未绑 click → 改平铺）。③**就地浮层**：动作条「翻译」真功能——选中附近弹 `rl-translate-card`（loading「翻译中…」→ 译文/「翻译失败」，✕/滚动/点外部/切章收起，保留选区对照译文）；顶栏快捷翻译 icon 同步。不落库无历史。**历次换源**：DeepLX(localhost:1188 无服务)→DeepSeek→双源+智谱默认→r4 简化UI固定模型+测试按钮。高亮仍灰态（批2 待做）。**
> **阅读器软件式沉浸批1.5（去原生框 + 悬浮顶栏，规格 2026-09-04-reader-immersive-design 获批，subagent-driven 2 任务 + gate，735/735 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 9ad93c4→dc71b25）：** 把 TXT/EPUB 阅读器视觉升级为软件式仿真（跟随系统明暗）——①**去原生 modal 框**：ReaderModal onOpen 给 modalEl 加 `rl-reader-immersive`，CSS 覆盖隐藏原生标题栏/圆角/阴影、拉满近屏 97vw×95vh、去弹窗遮罩背景（`body:has(.rl-reader-immersive) .modal-bg` 背景透明而非 display:none——父容器连带隐藏子 modal 的功能性回归已由复审抓出修复 b830788）；②**顶栏半透明悬浮**：`.rl-reader-head` 改 absolute 渐变浮层（`var(--background-primary)` 顶部实色→透明，去实体下边框），`.rl-reader` 加 position:relative，`.rl-reader-body` 顶部 padding 让位（正文首行/侧栏 tab 不被压）。**范围核实裁剪**：正文阅读栏宽/章标题批 1 已实现（TXT 680px / EPUB 720px 居中），本批不改；侧栏折叠 B-b 批 1 已满足。沿用批1 的 master 逐任务 commit + spec/quality 双复审流程。**
> **阅读器界面重排批1（对标 Readest 裁剪版，规格 2026-09-03-reader-readest-ui-batch1-design 获批，subagent-driven 8 任务 TDD/复审，735/735 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL）：** TXT/EPUB 阅读器 UI 重排为仿 Readest 沉浸式结构——①**顶栏三 tab 重构**：目录/书签/摘抄（图标 toggle 展开左栏对应 pane），移除分散的 行距±/批注 按钮；顶栏**自动隐藏**（D1b：鼠标靠顶唤出、滚动/移出 1.5s 收起，TXT/EPUB 含 iframe 内 mousemove 适配）；②**书签体系**：新增 `pure/bookmark.ts`（ReaderBookmark 模型 + 路径/解析/序列化，16 用例），`{libraryDir}/阅读进度/{id}.bookmarks.json` 独立落盘（main readBookmarks/saveBookmarks），书签 pane 渲染/跳转/右键删除；③**选中动作条**：正文选中弹浮条（★书签/❝摘抄 可用——书签落盘、摘抄走既有笔记回写确认流；🖍高亮/译翻译 灰态占位提示后续版本），替代原"批注开关 + 选中即摘"间接交互，动作后清选区；④**右上下拉设置**：字号/行距 −+（写回设置）/滚动模式状态（连续=当前，翻页式置灰后续）/全屏显示；主题随系统不做切换；⑤**底部进度栏**：章名 + 章内%/全书% + 进度条 + ‹ › 翻屏/翻章（D4a 不伪造页码）。**范围裁剪**：不做 搜索/听书/并排/词典/批注详细编辑/自动滚动/PDF/真翻页渲染。**git 事故**：subagent 执行期间 .git 对象库第三次损坏（pack 丢失、HEAD 对象不可读）→ 按先例 snapshot rebuild 为单根提交 b34c6dd（含基线+T0/T1 内容），批1 代码无损失、逐任务 commit 链自此重建。**
> **修复关联 TXT 阅读进度在编辑表单不显示/刷新按钮不反馈当前进度（用户报障，33/33 bookProgress/txtParse 测试全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：根因——`persistReadingPercent` 落库 `{ page: rp.page, totalPage: rp.totalPage, percent }`，而阅读器只产 percent 从不产 page → page 恒 undefined 只落库了一半（实证：测试库「活着」readingProgress={ totalPage: 315, percent: 3 } 无 page）：海报墙能显示（readPct 优先 percent），但表单初始化 `readingPage = entry.readingProgress.page` 取不到 → 当前章空；刷新按钮取表单打开时的 percent 快照，阅读在打开之后 → 无 percent 走手填分支反馈「已是最新」。改动：①`persistReadingPercent` 落库时按 percent 真源 + totalPage 基准经 `pageFromPercent` 派生当前页/章一起落库（page 缺失补全，新数据表单/海报墙直接可用）；②EntryForm onMount 存量数据补全——percent 在但 page 缺失（旧数据）打开表单即派生当前页/章回填。**
> **#165 数据源全量接入 + 服务集成两折叠项（用户报障「设置页只有三个源能填」→ 拍板：7 注册位源本轮全部接入 + 服务集成改两折叠项；范围修订 spec 2026-09-02-source-full-integration 获批，subagent-driven 12 任务 TDD，698/698 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 bf463e7）：**① 注册表 10 源全量启用 + 默认链落 D2（book=豆瓣+Open Library、game=豆瓣+Steam、music=豆瓣+MusicBrainz+iTunes；影视/动画不变）+ `omdbApiKey` 字段 append-only；② 7 新源客户端接入（openLibrary/googleBooks(可选Key)/steam(免 Key，校准弃 suggest 用 api/storesearch)/musicbrainz(带 UA)/itunes/omdb(需 Key，独立 OmdbSearchResult 类型)/anilist，各含 parse fixture 单测 + 点选轻量补全 + 徽标/直达）；③ main 编排泛化（5 searchXFresh 收敛 runner map + keyField 动态读 + 辅助源 5s 超时失败静默，删单源 Notice 噪音）；④ searchDisplay source 查表（10 源徽标/URL/封面）；⑤ 设置页服务集成重构为两折叠项（API 管理 + 数据源启用勾选/调序）。**行为变更**：旧用户升级后书籍/游戏/音乐搜索自动多源（预期，可设置页改回）。**git 说明**：.git 对象库损坏（8/30 后两 pack 丢失、本地无备份），提交历史重建为单快照 bf463e7，代码内容无损。B3 待办：详情深度回填（OL/GB 书籍字段、steam appdetails 等）。**
> **数据源注册表 B1——设置页每类型源链自选 + 搜索编排链驱动（设计 2026-09-02-metadata-source-registry-design 获批，subagent-driven 5 任务 TDD，599/599 全绿，tsc+esbuild 通过，已部署测试库 cmp IDENTICAL，提交 dfe9b43→08c5996）：**① 新增 `src/pure/sourceRegistry.ts` 纯数据注册表——10 源注册位（douban/tmdb/bangumi implemented，另 7 源待接入占位）、5 组类型映射（movie/tv→movieTv）、每类型默认链（书籍/游戏/音乐=豆瓣单源、影视=豆瓣+TMDB、动画=豆瓣+Bangumi）、`normalizeSourceChain`/`resolveSourceChain` 脏数据兜底、`deriveGroupSearchError` 全链失败文案（5 条常量与旧 doubanUnavailableError 逐字对齐）+22 单测；② `settings.sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>` 可选字段（append-only，缺省 undefined=默认链，旧数据零迁移）；saveSettings 改基线法（`sourceChainBaselineJson`）检测链变更清搜索缓存（修浅拷贝同引用致 chainChanged 恒 false 死逻辑）；③ 五个 searchXFresh 重写为链驱动（按 sourceChains 并行 douban+aux，aux 5s 超时失败不阻塞、失败态按运行时真相上报；douban 移出链走统一失败文案），默认链行为与既往逐字节一致（含错误文案）；④ 设置页服务集成区重排——「凭据」小节 3 折叠行保留改名（全类型 · Douban / 影视 · TMDB / 动画 · Bangumi）+ 新增「每类型源链」5 组折叠行编辑器（≤3 槽 select 换源、↑↓ 排序、✕ 移除、＋添加，至少保留 1 源，等于默认链删键回默认）；⑤ styles.css 追加 rl-src-section-label / rl-chain-*（Obsidian 主题变量，朴素功能向）。B2 待办：新源 client 接入 + EntryForm 数据源栏联动 + N 源合并深层回填。**
> **状态区文案类型化（用户报障，labels 14/14 + 全量 558/558 测试全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：游戏/音乐的个人状态与评价此前沿用影视「观看」语义——表单状态区 label 是 `type === 'book' ? '阅读状态' : '观看状态'` 二元分支，游戏/音乐落到「观看状态/观看日期/观后感」。改动：labels.ts 新增纯函数 `statusVerb`（影视=观看、书籍=阅读、游戏=游玩、音乐=收听）与 `reviewLabel`（观后感/读后感/游玩体验/收听感受），EntryForm.svelte 5 处模板去二元分支改拼接——状态 label、计划/最近/完成日期 label、评语 placeholder（「写下你的游玩体验…」等）；与 actionVerb（游戏=启动、音乐=播放）语义区分，状态区用游玩/收听；选项 chips 本就走 statusLabel（想玩/在玩/通关）不受影响；MediaList 已按 statusLabel 渲染无改动。**
> **修复关联 TXT 阅读进度在编辑表单不显示/刷新按钮不反馈当前进度（用户报障，33/33 bookProgress/txtParse 测试全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：根因——`persistReadingPercent` 落库 `{ page: rp.page, totalPage: rp.totalPage, percent }`，而阅读器只产 percent 从不产 page → page 恒 undefined 只落库了一半（实证：测试库「活着」readingProgress={ totalPage: 315, percent: 3 } 无 page）：海报墙能显示（readPct 优先 percent），但表单初始化 `readingPage = entry.readingProgress.page` 取不到 → 当前章空；刷新按钮取表单打开时的 percent 快照，阅读在打开之后 → 无 percent 走手填分支反馈「已是最新」。改动：①`persistReadingPercent` 落库时按 percent 真源 + totalPage 基准经 `pageFromPercent` 派生当前页/章一起落库（page 缺失补全，新数据表单/海报墙直接可用）；②EntryForm onMount 存量数据补全——percent 在但 page 缺失（旧数据）打开表单即派生当前页/章回填。**
> **修复阅读 PDF 进度未保留（编辑条目页进度页数不同步）（用户报障，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：根因——#199 的 `opened` helper 用 `m.onClose = () => resolve(...)` 直接赋值，实例属性遮蔽了三个阅读器的 prototype `onClose()` 方法，而进度落库全挂在 `onClose → panel.destroy()/destroy() → flushSave()` 链上（TxtReaderPanel/EpubReaderPanel.destroy → flushSave；PdfReaderModal 的 destroy() 更无任何调用点）→ flushSave 永不执行：PDF 的 percent 100% 不写回 catalog（只在 flushSave 里 persist），TXT/EPUB 章内位置/关闭时进度同样丢失；另有竞态——`persistReadingPercent` 为 fire-and-forget，onClose 里立即 `service.get` 会读到落库前旧值。改动：①`opened` 改为**包装原 onClose**（保存 `origOnClose = m.onClose.bind(m)`，新闭包先执行原清理/落库再读取，try/catch 包裹），并新增 `lastPersist` 跟踪最近一次 `persistReadingPercent` 的 Promise，resolve 前先等落库完成（消除竞态，保证 watchBook 拿到含最新 percent 的 readingProgress）；②`PdfReaderModal.onClose` 补 `this.panel?.flushSave()`（panel 的 flushSave 由 private 改 public），PDF 关闭时兜底落库 percent + 最后一次滚动位置。**
> **修复书籍进度不在海报墙显示 + 当前进度页自动同步阅读器进度（用户指示，33/33 bookProgress/txtParse 测试全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：根因——海报墙进度行守卫 `readPct` 在「有 totalPage 无 page」（自动解析只回填基准）时短路 undefined 致整行不渲染，列表视图 `rp.page ?? 0` 兜底能显示，两视图不一致；连带修复 TXT 单位写死「页」（视图层遗漏，按 bookFile .txt 后缀动态显示「章」）与表单保存覆盖丢失 percent（唯一真源）。改动：`readPct` page 缺失按 0 参与计算（进度行照常渲染 0/N）；新增 `bookUnitOf`（.txt → 章）应用到海报墙/列表进度文本；表单保存 readingProgress 保留既有 percent；「打开阅读器」关闭后回传最新落库进度（main.ts `openBookReader`/`openBookInternal` 返回 `Promise<BookProgressFields|undefined>`，modal.onClose 读取 resolve），EntryForm `watchBook` 自动回填——percent 真源经 `pageFromPercent` 派生当前页/章、totalPage 同步本地基准。**
> **书籍进度页数旁新增「重新解析」小刷新按钮（用户指示，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：总页数输入框右侧加 22px icon 按钮（refresh-cw，title「重新解析本地文件（测试获取）」），手动触发本地文件探针（PDF 页数 / TXT 章节）测试是否成功获取——未关联文件提示「先右键编辑选择」、探针失败提示「解析失败：请确认文件存在且为 PDF/TXT」、已是最新提示「解析成功：本地 N 页/章（已是最新）」；`autoLinkBookProgress` 加 `notify` 参数，浏览/保存场景保持静默不打扰，仅刷新按钮明确反馈。**
> **进度页数自动关联兼容 TXT（按章节解析）+ placeholder 文案精简化（用户指示，21/21 bookProgress 测试全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：探针 `probeBookPages` 由「仅 PDF 页数」扩展为 PDF 页数 / TXT 章节双基准（`parseTxtBook` 按章节解析返回 totalChapters）；`reconcileBookProgress` TXT 分支与 PDF 同构——totalPage 收紧为本地章节数、percent 恒定重算当前章、手填超界钳制，但不做 pageCount 迁移（TXT 无「页」概念）；打开阅读器 TXT 分支同步校正（与 PDF onPdfReady 双通道对称）；表单关联 TXT 自动切换单位——label「进度章节」、placeholder「总章节（自动解析）」、提示「已读 X / Y 章」；placeholder「总页数（选择 PDF 自动解析自本地文件）」精简为「总页数（自动解析）」。**
> **海报墙操作文案类型化 + 书籍阅读进度基准校正（用户指示，536/536 单测全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）。**
> **各库搜索框占位文案与实际搜索能力对齐（用户指示，541/541 单测全绿，已部署测试库 cmp IDENTICAL）：影视/音乐占位缩为「搜索标题…」（剔除不可搜的「原名/导演」表述）；书籍/游戏保留「搜索书名、作者…」「搜索标题、开发商…」并增强搜索逻辑使其真实生效（matchesSearch 按类型扩展 author/developer 参与匹配，+5 用例）。**
> **音乐库也可按作者（歌手）搜索（用户指示，542/542 单测全绿，已部署测试库 cmp IDENTICAL）：matchesSearch 音乐类型同样匹配 author，占位文案「搜索标题…」→「搜索标题、作者…」，+1 用例锁定。**
> **游戏/音乐关联改小按钮 + 书籍表单布局调整（用户指示，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：游戏「启动快捷方式」与音乐「本地音频」由路径输入框改为小按钮 + 右键编辑浮层（左键启动/播放、未关联提示右键编辑、已关联高亮，对齐书籍文件按钮）；书籍表单「进度页数」下移至目录框之下，ISBN 与「元数据页数」并排。**
> **书籍进度页数自动关联本地文件（用户指示，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）：表单浏览/保存 PDF 书籍文件后自动解析本地页数回填总页数，当前页按既有进度（percent）重算/超界钳制（复用 reconcileBookProgress 纯逻辑），总页数 placeholder 更新为「选择 PDF 自动解析自本地文件」；PDF 阅读器打开时校正链路不变。**
> **删除追番表本地文件夹监控（用户指示），476/476 单测全绿，tsc/esbuild 通过，已部署测试库（cmp IDENTICAL）。**
> **修复游戏条目豆瓣回填全空（478/478 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **游戏条目移除发行商/别名框（用户指示，478/478 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **游戏字段移动 + 书籍删译者框 + 音乐表演者解析修复（用户指示，480/480 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **书籍 PDF 阅读器（v0.6 主打方向，492/492 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **设置页描述精简化（用户指示，已部署测试库 cmp IDENTICAL）。**
> **空状态/按钮 title 体验细节优化（用户指示，已部署测试库 cmp IDENTICAL）。**
> **第四轮体验优化：命令/ribbon 文案名实对齐 + 长句式精简 + 死样式清理 + main.ts 逻辑重构（已部署测试库 cmp IDENTICAL）。**
> **第五轮优化：services 纯逻辑下沉 record.ts + pickLocal 四函数合并 + Bangumi 详情抽取 + 阅读器快捷键/搜索 Esc/表单 Ctrl+Enter（500/500 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **第六轮修复：添加条目弹窗暗黑模式下拉白底蓝字 + 搜索结果态「取消」按钮被挤到 modal 底端（纯样式，已部署测试库 cmp IDENTICAL）。**
> **第七轮修复：搜索结果卡片排版分层——主标题独立行 + 副标题/年份/评分统一第二行 + 项间距收紧（纯模板/样式，已部署测试库 cmp IDENTICAL）。**
> **第六轮体验三连：点选结果顶部标题回显 + 搜索框 Esc 清空 + 回填后自动聚焦标题框（已部署测试库 cmp IDENTICAL）。**
> **搜索结果项间距加大 + 年份/评分固定占位（用户指示，纯模板/样式，已部署测试库 cmp IDENTICAL）。**
> **添加条目搜索窗删除取消按钮（空白处取消）+ row2 恒显作者/年份/评分（用户指示，已部署测试库 cmp IDENTICAL）。**
> **搜索结果「悬停才显示」根因修复（from span 创作者解析 + 影视导演回退）+ 音乐库海报墙复用影视卡片 + 弹窗底部分隔线删除（用户指示，新增 6 用例 97/97 全绿，已部署测试库 cmp IDENTICAL）。**
> **搜索结果封面裁剪 + 数据预取（一览即见作者/年份/评分）+ 音乐库四视图 + 瀑布流标题常显 + 去 emoji（用户指示，新增 4 用例 101/101 全绿，已部署测试库 cmp IDENTICAL）。**
> **搜索结果卡片提示去重 + row2 恢复显示 + 封面显示修复（用户指示，511/511 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **「重新拉取」点击即搜（用户指示，已部署测试库 cmp IDENTICAL）。**
> **海报墙封面回退 cover（恢复正常裁剪）+ 添加条目搜索结果改两栏海报墙网格（用户指示，514/514 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **搜索结果 row2/封面全局样式兜底（styles.css）+ 豆瓣封面 URL 协议归一化（用户报 UI 异常后根因修复，新增 3 用例 514/514 全绿，已部署测试库 cmp IDENTICAL）。**
> **媒体库卡片评分/年份常显（浅色改醒目）+ 封面 contain 防裁切 + 瀑布流补评分年份（用户报媒体库卡片悬停才显评分年份/封面裁剪1/3，514/514 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **两栏网格卡片封面改固定高度 220px，修复「标题/评分不可见」bug（grid + aspect-ratio + max-height + minmax(0,1fr) 组合导致卡片被压扁，514/514 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **搜索结果改回单列横排 + 封面缩回 60×90 缩略图（用户报「封面缩到正常大小」，回滚「两栏海报墙」错误方向，514/514 单测全绿，已部署测试库 cmp IDENTICAL）。**
> **封面缩略图再缩小 60×90 → 48×72（用户指示，514/514 单测全绿，已部署测试库 md5 一致）。**
> **搜索结果条目文字垂直居中 + hover 整框高亮（用户报文字没居中/悬停仅字变色，已部署测试库 md5 一致）。**
> **来源徽标 hover 仅文字+图标变色（删除重复 hover 块导致的整块蓝底，已部署测试库 md5 一致）。**
> **来源徽标垂直居中对齐每个条目（徽标移出 row1 作为 inf 并列子元素，已部署测试库 md5 一致）。**
> **添加条目头部「数据源」栏按类型列并源 + 未配置标注（未配置）（已部署测试库 md5 一致）。**
> **瀑布流视图默认仅封面，hover 才浮出标题/评分/年份（用户纠正方向，已部署测试库 md5 一致）。**
> **影视聚合页签切换分类后总数虚增为 9 的计数 bug 修复（已部署测试库 md5 一致）。**
> **海报墙元信息缺失字段占位防错位（用户报障，+19 用例 cardMeta 全绿，tsc/esbuild 通过，已部署测试库 cmp IDENTICAL）。**

### 新增功能
- **数据源全量接入——7 新源客户端（#165，用户指示「其他的源去哪了」后拍板全部接入）**：openLibrary（book，默认开，search.json + works.json 点选补简介/页数）、googleBooks（book，默认关自选，可选 googleBooksApiKey，未配 key 免 key 请求）、steam（game，默认开；**端点校准**：suggest 端点只回热门 HTML 弃用，改 `api/storesearch` 免 Key JSON，封面 library_600x900 实测可达）、musicbrainz（music，默认开，release-group 检索 + 统一 UA `ReelLudic/0.1`，封面走 coverartarchive URL 不探测）、itunes（music，默认开，artwork 100→600 放大，collectionViewUrl 直达）、omdb（movieTv，默认关需 omdbApiKey，`OmdbSearchResult` 独立类型防强塞 TmdbSearchResult，i= 详情补导演/演员/评分/Plot）、anilist（anime，默认关自选，复用 BangumiSearchResult + source 区分直达，rating=meanScore/10，搜索级已含 genres/studio/desc 免 detail 往返）；各源 = service（HTTP 注入可测）+ parse/to*Result 纯函数（fixture 单测 22-61 expect/源）+ main 注册 runner + EntryModal/EntryForm 点选按 source 分派补全（失败静默不阻塞保存）；`settings.omdbApiKey` 追加（append-only）
- **数据源注册表 B1——每类型源链自选（用户指示「增强获取元数据源的可能性」，方案 A「Provider 注册表 + 每类型源链配置」获批）**：新增纯数据模块 `src/pure/sourceRegistry.ts`（10 源注册位 + 5 组类型映射 + 每类型默认链 + 链归一/解析 + 全链失败文案推导，22 单测）；`settings.sourceChains` 可选字段（append-only，缺省 undefined=默认链零迁移）；影视/动画/书籍/游戏/音乐五个 `searchXFresh` 改链驱动执行（aux 源 5s 超时降级、失败态按运行时真相上报、douban 移出链走统一失败文案，默认链行为与既往逐字一致）；「每类型源链」折叠编辑器（≤3 源 select 换源 / ↑↓ 排序 / ✕ 移除 / ＋添加，至少保留 1 源，等于默认链自动删键回默认）——为后续接入 openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist 等第二/三源提供配置面与编排底座（B2：新源 client + EntryForm 数据源栏联动 + N 源合并深层回填）
- **书籍进度页数自动关联本地文件（用户指示）**：编辑表单浏览/保存 PDF 书籍文件后自动解析本地页数（`main.probeBookPages` → `PdfReaderModal.probePdfNumPages` 轻量探针，复用 pdf.js 单例 worker，只解析不渲染）→ 回填总页数；当前页按既有进度（percent 唯一真源）重算、手填超界钳制（复用 `reconcileBookProgress` 纯逻辑）；TXT/EPUB 无页数概念不解析；解析失败/无变化静默不打扰；总页数 placeholder 更新为「选择 PDF 自动解析自本地文件」；PDF 阅读器打开时校正链路（onPdfReady）保持不变，双通道同源同语义
- **书籍阅读进度基准校正（PDF 本地页数为准）**：新增纯逻辑 `pure/bookProgress.ts`（13 用例）——PDF 打开时（`PdfReaderModal.onPdfReady` → `main.reconcileBookProgressOnOpen`）以本地 `numPages` 校正进度基准：`totalPage` 收紧为本地页数、percent 恒定（唯一进度真源）重算 `page`、手填页码超界钳制；旧 `totalPage` 与本地页数不一致且 `pageCount` 为空时**惰性迁移**为元数据页数（保统计口径，不做一次性全量迁移）；EPUB/TXT（无真实页数）与无本地文件场景不校正，percent 直落
- **书籍元数据页数字段 `pageCount`（append-only）**：豆瓣实体书页数与进度基准分离——搜索/详情回填改写入 `pageCount`（不再覆盖进度总页数）；`EntryForm` 新增「元数据页数」输入（仅展示/统计，进度以本地文件为准）；`stats`/`report` 总页数口径 `pageCount` 优先、旧数据回退 `totalPage`；笔记 frontmatter 增 `page_count` 键 + 属性表格「页数」行口径切换；`noteEditable` 解析 `page_count` 回读
- **书籍 PDF 阅读器（内置，pdfjs-dist 自渲染）**：TXT/EPUB 之外第三格式闭环——连续滚动逐页 canvas 渲染（视口虚拟化，IntersectionObserver 只渲染可视 ± 缓冲页、离屏销毁防大 PDF 内存暴涨）+ 文本层（textLayer）选中摘抄（复用 ReaderExcerptModal 管道回写「## 摘抄」+ 书签 tab）+ PDF outline 目录侧栏（嵌套展开，点击解析 dest 跳转）+ 缩放 ±（0.25 步进 0.5-3.0，重渲染可视页并锚定当前位置）+ 进度持久化（ReadingProgress 复用，chapterIndex=页码索引 0 基 + 页内滚动比例，等权页估算百分比）；`internalBookReader` 开关语义不变（默认外部打开）；⚠️ 产物体积 main.js 1.15MB → 3.19MB（pdf.js worker 以 Blob 内联随产物打包，保持三件套单文件 + cmp 校验流程不变）；扫描版 PDF（无文本层）摘抄自动不可用、阅读不受影响

### 界面美化
- **设置页服务集成重构为两折叠项（#165，替代 B1 的凭据行+源链折叠行）**：①「API 管理」折叠项——需 Key 的 5 源（Douban/TMDB/Bangumi/OMDb/Google Books）配置统一聚合，每源点击展开密文输入（显示/隐藏）+ hint + 测试连接（Douban/TMDB/Bangumi 走既有 testXxx、OMDb/Google Books 走新增 testOmdbConnection/testGoogleBooksConnection，✓/✗ 反馈）；②「数据源启用」折叠项——书籍/影视/动画/音乐/游戏五分类各一行列出该分类全部源（天然 ≤3），checkbox 勾选/取消控制该源是否参与该类搜索 + 组内 ↑↓ 调序（首源为主力源展示，豆瓣恒为主力源不限时、可移出首位仅影响结果顺序），默认勾选 = 默认链、等于默认链不落键，存储仍走 sourceChains 纯函数语义零改动；旧的凭据折叠行与源链 select 槽编辑器整体移除，勾选面板为唯一入口（样式类 rl-src-*/rl-chain-* 清理）
- **设置页服务集成区重排——凭据行改名 + 每类型源链折叠编辑器（数据源注册表 B1）**：「凭据」小节 3 折叠行保留并改名对齐实际作用类型——Douban→「全类型 · Douban」（所有类型搜索均可能使用）、TMDB→「影视 · TMDB」、Bangumi→「动画 · Bangumi」，凭据提示文案位置修正（在链区上方）；下方新增「每类型源链」小节 5 组折叠行（每行 = 组名 + 链摘要 + 已配置源徽标 + ≤3 槽位 select 换源 + ↑/↓/✕ 操作按钮，「＋ 添加源」槽占位候选已尽时隐藏），行式折叠展开不占额外纵向空间；`rl-src-section-label` / `rl-chain-line/select/badge/btn/del` 样式全部走 Obsidian 主题变量、朴素功能向无动画
- **游戏启动/音乐音频关联改小按钮 + 书籍表单布局调整（用户指示）**：① 游戏「启动快捷方式」与音乐「本地音频」由「路径输入框 + 浏览/清除」改为与书籍文件一致的**小按钮 + 右键编辑浮层**——左键已关联直接启动/播放（未关联提示「右键编辑选择」），右键弹出编辑浮层（路径输入 + 浏览… + 保存/清除/取消，标题「启动快捷方式（.lnk）」/「本地音频」），已关联时按钮 accent 高亮；`EntryForm` 新增 `onLaunchGame`/`onPlayMusic` prop（`EntryModal` 编辑模式挂载当前条目调 `plugin.launchGame`/`playAudioEntry`，新增模式提示先保存），浏览函数改写入编辑缓冲（保存才回写字段）；数据层零改动；② 书籍表单布局——「进度页数」（当前-总页数 + 进度条）从顶部 ISBN 行下移至**目录框之下**（总页数 placeholder 注明「打开 PDF 自动校正自本地文件」，与书籍文件按钮相邻呼应自动解析语义），顶部改为 **ISBN 与「元数据页数」并排**（rl-2col），元数据页数 placeholder 精简为「豆瓣页数（实体书，仅展示/统计）」
- **主操作按钮文案类型化（海报墙/列表/右键菜单）**：新增纯逻辑 `pure/actionLabel.ts`（9 用例）统一动词与入口判定——影视「观看」、书籍「阅读」（`book-open` 图标）、游戏「启动」、音乐「播放」；封面右下角圆形按钮与列表「操作」列按类型换图标/aria-label；右键菜单书籍/游戏/音乐新增类型化主操作入口（入口可用直接执行，不可用显示「动词 · 去关联」并跳编辑表单补录），影视保持「直达观看」；入口可用性判定收口到 `hasActionEntry`（影视=链接/本地剧集/网络地址任一，书籍=`bookFile`，游戏=`gameLaunchPath`，音乐=`audioPath`）

### 体验优化
- **搜索多源失败静默降级（#165，收敛单源失败 Notice 噪音，对齐上游 D4）**：辅助源（tmdb/bangumi 及新增 6 源）失败不再逐个弹 Notice，进度阶段标失败态、由全链失败统一文案兜底（deriveGroupSearchError 文案不变）；缓存失效条件补 omdbApiKey（填 Key 后旧缓存不再命中）
- **状态区文案类型化（用户报障）**：游戏/音乐条目「个人状态与评价」区 label 此前落入二元分支 `type === 'book' ? '阅读状态' : '观看状态'` → 游戏/音乐显示「观看状态/观看日期/观后感」。新增纯逻辑 `pure/labels.ts` 的 `statusVerb`（影视=观看、书籍=阅读、游戏=**游玩**、音乐=**收听**）与 `reviewLabel`（观后感/读后感/**游玩体验**/**收听感受**，+7 用例锁定），EntryForm 状态 label（`{statusVerb(type)}状态`）、计划/最近/完成日期 label（`计划{statusVerb(type)}日期` 等）、评语 placeholder（`写下你的{reviewLabel(type)}…`）5 处模板改拼接；选项 chips 已走 `statusLabel`（想玩/在玩/通关、想听/在听/已听）无需改；与主操作动词（actionVerb：游戏=启动、音乐=播放）语义区分
- **各库搜索框占位文案与实际搜索能力对齐（用户指示）**：① 影视/音乐库占位 `搜索标题、原名、导演…` → `搜索标题…`——「原名/导演」不可搜（matchesSearch 只匹配标题/原名，导演不参与），文案删至与实际能力一致；② 书籍/游戏占位 `搜索书名、作者…`/`搜索标题、开发商…` **保留并增强逻辑使其真实生效**——`pure/search.ts` 的 `matchesSearch` 按类型扩展匹配：书籍额外匹配 `author`、游戏额外匹配 `developer`（影视/音乐保持 title+originalTitle 不变，`+5` 用例锁定：作者/开发商命中、大小写不敏感、空值不报错、其他类型不串味）；摘抄弹窗「搜索书名 / 作者…」核对无误（本就按 标题+作者 过滤）不动
- **音乐库搜索支持作者（歌手）（用户指示）**：`matchesSearch` 音乐类型同样匹配 `author`（歌手字段，与书籍一致）——占位文案 `搜索标题…` → `搜索标题、作者…`，文案与实际能力完全对齐；影视保持 `搜索标题…` 不变（原名/导演不宣传）；`+1` 用例锁定（音乐按作者命中、大小写不敏感、author 为空不命中；音乐不按开发商匹配、影视不按作者/开发商匹配）
- **添加条目弹窗搜索体验三连（点选反馈/Esc 清空/自动聚焦）**：① 点选搜索结果后顶部标题动态回显「添加条目：{标题}」（编辑模式「编辑条目：xx」不变、手动填写不触发）——选中结果一眼确认，不用再盯着字段区判断是否回填成功；② 搜索输入框按 `Esc` 一键清空搜索词（与媒体库搜索行为一致，此前需手动全选删除）；③ 点选结果后字段区展开、光标自动落在标题输入框（`bind:this` + `tick` 等 DOM 渲染后 focus），可直接开改标题
- **阅读器快捷键补齐（TXT/EPUB/PDF 三阅读器统一）**：三个阅读器此前已有 `←`/`→` 翻章/翻页（PDF 另有 PageUp/Down 滚一页高）；补 `+`/`−`（或 `=`/`−`）与 `T` 键——TXT/EPUB 映射字号调整（adjustFont）、PDF 映射缩放（adjustScale）、`T` 统一映射目录开关（toggleToc），与工具栏按钮行为完全一致，键盘不离开阅读器
- **搜索框 Esc 清空 + 表单 Ctrl+Enter 保存**：媒体库搜索框按 `Esc` 一键清空搜索词（此前需手动全选删除，Obsidian 下 type=search 原生 × 按钮不可靠）；条目表单（rl-form）内任意输入框 `Ctrl+Enter`（mac 为 `Cmd+Enter`）直接「保存并生成笔记」（数据源搜索框 Enter 仍是搜索，无冲突）
- **命令/ribbon 文案名实对齐（3 处）**：ribbon「ReelLudic 添加影视」与命令「添加影视」实际打开的是全类型添加弹窗（含书/游戏/音乐），改「添加条目」；命令「打开影视」实际打开聚合媒体库页签（含书/游戏/音乐/统计），改「打开媒体库」（命令 id 不变，已绑定快捷键不受影响）
- **「未关联 XX」提示句式统一精简（4 处）**：游戏/音乐/书籍三处「— 编辑条目在『XX』选择」长句式压缩（去掉与字段名重复的部分），douban 全英文错误 `Douban proof-of-work challenge exceeded max nonce` 中文化「豆瓣安全验证求解超时」（该错误会原样展示在设置页连接测试）
- **符号图标按钮补 title（悬停提示）**：海报墙视图切换（▦/☷/▥ 三按钮）与「回到顶部」（↑）此前仅有无障碍 aria-label、普通用户悬停无提示——补 `title`（与 aria-label 同文本），无新文案/样式/行为改动
- **音乐「专辑」placeholder 修正**：`所属专辑（豆瓣回填）` → `所属专辑（手动填写）`——豆瓣音乐数据源无「专辑」键（专辑页专辑名即标题），回填不可能发生，旧文案误导用户
- **阅读器「批注」按钮 title 统一精简（TXT/EPUB/PDF 三处）**：`批注开关：开启后选中文本可添加摘抄到笔记` → `开启后选中文本可添加摘抄`（去掉与按钮语义重复的「批注开关：」前缀）
- **追番表/想看清单空态精简与句式统一**：追番表空态 `当前没有「在看」的条目 — 把想追的作品标记为在看后，会出现在这里（参考追番列表：更新/活跃度优先置顶）` → `当前没有「在看」的条目 — 标记为「在看」后出现在这里`（括号排序说明与表头 hint 重复，空态场景无排序可言）；统计页想看清单空态 `没有想看条目 — 把条目标记为「想看」后出现在这里` → `没有「想看」的条目 — 标记为「想看」后出现在这里`（与追番表句式统一）
- **空状态文案按类型动态化 + 去过时位置描述**：grid/masonry/list 三视图共用 `emptyText` helper 按锁定类型输出文案——书籍「书架还是空的 — 点「＋ 添加」录入第一本书」、游戏「游戏库还是空的 — …录入第一款游戏」、音乐「歌单还是空的 — …录入第一首歌」（不再显示「书架」字样）、影视/动画/电影与聚合页签「库还是空的 — …录入第一条条目」（删掉已过时的「右上」定位）
- **右键菜单/表单按钮 title 去重复冗余**：「添加摘抄」→「从外部阅读器复制文本，生成摘抄块」（去掉与按钮名重复的头部与箭头）、「记录游玩」→「日期 + 时长 + 心得，保存到游戏笔记」（去掉「记录本次游玩」）、批量「应用」→「应用到选中条目」、「重新拉取」→「按当前标题重搜数据源，回填客观字段（不覆盖主观内容与关联）」
- **设置页描述精简化（用户指示）**：10 处设置描述文本压缩为要点式（隐藏滚动条/内置阅读器/Media Extended/媒体库目录/导出恢复/下载封面/清理孤儿封面 + 三数据源 hint），并修正 2 处内容问题——①「内置阅读器打开书籍文件」描述补上 **PDF**（v0.6 已上线但描述仍停留 TXT/EPUB）；② Douban Cookie 输入框 placeholder「可选」与实际「未配置即 403」矛盾，改「必填（登录态）」；rawgApiKey/googleBooksApiKey 死字段确认无需展示（main.ts 零引用，字段按 schema 红线保留）
- **移除追番表「本地文件夹」检测**：追更表更新检测回归纯网站检测——删除扫描下载文件夹统计视频数的本地监控分支（含与网站结果合并覆盖的逻辑）；`countLocalWatchVideos` / `countLocalVideos` / `LOCAL_VIDEO_EXTS` / `pickLocalFolder` 全部移除，`onCheckLocalDir` prop 链路（TrackingBoard ← HomeView.svelte ← HomeView.ts）一并拆除
- **游戏条目移除「发行商/别名」输入框**：豆瓣游戏页无发行商/别名数据，删掉游戏编辑表单这两格——UI 块、pick 赋值、提交写入（`input.publisher` / `aliases` 游戏时置 undefined）、`applyDoubanDetail` 回填守卫（`type !== 'game'`）五处同步清理；`MediaEntry.publisher/aliases` 字段按 schema append-only 红线保留，书籍「出版社」框、影视「又名」回填不受影响（noteGenerator 游戏属性表本就不输出这两项）
- **游戏条目「游玩时长/启动快捷方式」移到简介下方**：编辑表单字段流从「平台/开发商 → 时长/快捷方式 → 简介」变为「平台/开发商 → 简介 → 时长/快捷方式」，纯布局移动无逻辑改动（`{:else if type === 'game'}` 分支拆出为简介后独立 `{#if type === 'game'}` 块）
- **书籍条目移除「译者」输入框（用户指示）**：编辑表单删译者行、pick 不赋值、提交不写 `input.translator`、详情回填加 `type !== 'book'` 守卫；`MediaEntry.translator` 字段按 schema 红线保留，noteGenerator 书籍笔记仍展示已有译者历史数据，douban 解析层照常解析译者
- **「重新拉取」点击即搜（用户指示）**：编辑条目点「重新拉取」后立即用当前标题自动执行一次搜索并直接展示结果，无需再手动点「搜索」按钮——按钮点击与搜索触发收敛在同一交互流程内，搜索结果展示方式与数据结构完全不变（复用 `doSearch` 的 query 读取、状态重置、进度条与结果渲染全链路）
- **添加条目头部「数据源」栏按类型列出并源 + 未配置标注（用户指示）**：原「数据源」栏按 `formMode`（豆瓣/TMDB/Bangumi 三选一表单 UI 模式）只显示单源，且组件拿不到 douban/bangumi 配置状态。改为按类型动态列出实际并源——电影/电视剧 `数据源：Douban · TMDB`、动画 `Douban · Bangumi`、图书/游戏/音乐 `Douban`（单源），未配置 cookie/token 的源标注「（未配置）」；EntryForm 新增 `doubanConfigured`/`tmdbConfigured`/`bangumiConfigured` 三 prop（EntryModal 从 plugin.settings 的 doubanCookie/tmdbApiKey/bangumiToken 读取传入）
- **海报墙元信息缺失字段占位防错位（用户报障）**：grid 视图副行（年份）与创作者行（导演/作者/开发商）此前 `{#if ...}` 数据缺失时**整行 div 不渲染**，导致同列卡片高度参差不齐（用户截图 4 卡片明显错位：行数 2/3/2/2 浮动）。修复（**纯逻辑下沉 + 方案 A「—」文本占位**，用户确认后执行）：① 新建 `src/pure/cardMeta.ts` —— `cardSubtitle(e)`（音乐「专辑 · 年份」、其他「年份」、无值返回 `PLACEHOLDER='—'`）+ `cardCreator(e)`（优先级 导演 → 作者 → 开发商、无值返回 `—`）+ 配套 `hasCardSubtitle` / `hasCardCreator` 仅用于决定 `title` tooltip（避免显示「—」提示）；② `MediaList.svelte` 4 处替换——脚本导入新函数 + 删本地 `subtitleText`/`creatorText`、grid 卡片副行/创作者行去掉 `{#if}` 包裹**始终渲染**（占位符保行占位）、音乐分组歌单副行同样接入；③ `tests/cardMeta.test.ts` +19 用例（4 类年份槽位/优先级回退/书籍导演优先/全无占位/真实内容判定）红→绿。**影响面**：grid 视图副行+创作者行恒 2 行（+可选标签行 = 2/3 行恒定），同列卡片高度齐平；列表/瀑布流/分组歌单副行也走新函数（缺失年份显示「—」，行为一致）；MediaEntry schema 零改动（append-only 红线未触发）。**验证**：cardMeta 19/19 全绿；tsc+esbuild 通过；三产物 cmp IDENTICAL

### 问题修复
- **搜索结果封面缩略图缩小 60×90 → 48×72（用户指示「封面再缩小点，其他不变」）**：`.rl-res-cv` 尺寸 60×90 调至 **48×72**（2:3 海报比例），无封面时占位图标 20px → 16px 匹配新缩略图；其余布局/信息/交互完全不变（EntryForm.svelte scoped + styles.css 全局兜底同步）
- **搜索结果条目文字垂直居中 + hover 整框高亮（用户报「文字没在框内、悬停仅字变色」）**：① `.rl-res-item` `align-items: stretch` 把信息列硬拉到与封面 72px 同高，标题+row2 在大容器里居中反而视觉偏下沉 → 改 `center`（封面与信息列各自紧凑）+ padding 8px→6px；② `.rl-res-item:hover` 只改背景（浅色主题 `--background-modifier-hover` 透明度太低看不出，用户看到的「仅字变色」是浏览器 button 原生 hover 文字色）→ hover 同时改 background 和 border-color（整框变化更直观），并补 `.rl-res-item:focus-visible` 键盘焦点边框
- **来源徽标 hover 仅文字+图标变色（用户报「跳转链接标识整个变蓝底」）**：styles.css 存在两条重复的 `.rl-res-source:hover` 定义，第二条的 `background:var(--interactive-accent); color:var(--text-on-accent)` 覆盖第一条，导致悬停整块变蓝底白字 → 删除重复块，去掉 border-color 变化，仅保留 `color:var(--interactive-accent)`（同时作用于「TMDB」文字和 ↗ 图标，color 被子元素继承）
- **来源徽标垂直居中对齐每个条目（用户报「徽标没垂直居中」）**：徽标原在 `.rl-res-row1`（标题右侧）内，row1 仅标题一行高 ~19px，徽标在窄行内居中 = 卡片中线偏上 → 徽标移出 row1 作为 `.rl-res-inf` 并列子元素，`.rl-res-inf` 改 row flex + `align-items:center`，新增 `.rl-res-rows` 包裹 row1+row2，徽标中线与内容块中线对齐
- **瀑布流视图默认仅封面，hover 才浮出标题/评分/年份（用户纠正方向）**：上一轮误改「默认常显」，用户纠正为「默认只显示封面」——`.rl-m-overlay` 从 `opacity:1` 改回 `opacity:0` 默认隐藏，`:hover` 才 `opacity:1` 浮出（底部渐变托底 + 标题/年份/★评分 + 评分年份间 `·` 分隔）
- **影视聚合页签切换分类后总数虚增（用户报「每分类各显示 9 部」）**：影视是聚合页签 `lockType=null`，靠 `typeFilter` 切子分类；但顶部总数 `statusCounts.all` 的计数池只按 `lockType` 过滤，聚合页签下恒等于全部 9 项影视 → 切「动画/电影/电视剧」任一分类总数都虚增为 9 → 改 `const activeType = lockType ?? typeFilter`，总数跟随当前分类（分类 chips 数字 typeCounts 本就是对的，问题只在顶部总数口径）
- **搜索结果封面被条目宽度限制裁剪 + 作者/年份/评分「悬停才显示」（用户指示）**：① 封面——`.rl-res-item` `align-items: flex-start` 使封面与信息列同高被限高（信息列 ~35px 时 75px 封面被裁到 ~35px），且 `object-fit: cover` 对非 2:3 源图（音乐 1:1 封面）裁成竖条；改 `align-items: stretch` + 封面 50×75→**60×90**（2:3）+ `object-fit: contain`（完整显示不裁剪，音乐 1:1 封面上下留背景色）；② row2 数据——TMDB 结果搜索级缺 director/cast、豆瓣影视兜底无 from span 时 year/author 恒空 → 恒显「—」占位视觉像「悬停才显示」；新增**详情预取**（`prefetchTmdbDetails`：搜索完成后台分批并发 5 个/批拉 TMDB 详情，`mergeTmdbDetail` 纯函数非空覆盖回填 year/rating/ratingCount/director/cast/genres 到结果，原地更新 row2「一览即见」；失败静默）；③ row2 去 emoji（👤/📅/⭐ 移除，纯文本槽位 + title 提示）
- **音乐库列表/瀑布流仍锁「分组歌单」形态（用户指示）**：上一轮只解了海报墙，`{#if lockType === 'music' && viewMode !== 'grid'}` 让音乐在列表/瀑布流视图仍被强制分组歌单——改为 `viewMode === 'grouped'` 显式分支（音乐四视图：▦海报墙 / ☷列表 / ▥瀑布流 / ☰分组歌单），分组歌单退为可选视图（按钮仅音乐显示）
- **瀑布流标题 hover 才显示（用户指示「一览即见」）**：`.rl-m-overlay` 原 `opacity: 0` + hover 才 1 → 常显（`opacity: 1`，底部渐变托底 + 标题底部对齐单行省略），hover 仅加深背景强调
- **搜索结果卡片提示去重 + row2 恢复显示 + 封面显示修复（用户指示，三问题一并查清）**：① 悬停「双提示」——row2 三个字段 span（作者/年份/评分）各带独立 `title`，悬停卡片时多个 tooltip 并存视觉像双提示；定规则「**一个交互元素内不嵌套多个 title，卡片整体单一 title、字段级 title 移除**」，row2 三字段 title 全删、卡片 `<button>` 补单一 `title="点击回填该条目"`；② row2 不显示评分/年份/作者——`.rl-res-row2` 此前 `overflow:hidden` + 无 `min-height`，三层 `min-width:0`（`.rl-res-inf` → `.rl-res-row2` → `.rl-res-o`）链下子 span 全 `flex:none`，空数据时整行高度坍缩为 0 不可见；改 `flex-wrap:wrap` + `min-height:22px`（保单行最低高度）并去掉 `overflow:hidden`；③ 封面「裁剪糟糕」——根因是 `.rl-res-cv` 的 `<img>` 分支条件 `{#if d.cover && !isDoubanImage(d.cover)}` 把豆瓣图床（doubanio.com）封面**错误地全部跳过 `<img>` 渲染走占位图标**（豆瓣搜索结果 cover 本就是 doubanio.com），改 `{#if d.cover}` 直接渲染 img + `referrerpolicy="unsafe-url"` 防防盗链（占位图仅 cover 为空时显示）
- **搜索结果 row2/封面 全局样式兜底 + 豆瓣封面 URL 协议归一化（第十四轮，用户报「我真是服了」后全面排查）**：上一轮我只看产物里有 CSS 字面量就报 ✓、没看运行时 DOM（**产物校验伪绿**），导致用户截图里 row2 仍不显示、所有封面 60×90 框不生效（最底条目封面被切底半）、豆瓣来源封面全是断链图占位；根因：① **Svelte 4 `css: 'injected'` 在 Obsidian 环境下疑似未生效**——理论上 `add_css7(document.head)` 会执行并 `<style id="svelte-almu8f">` 注入到 head，但实际所有 `.rl-res-*` 样式都没应用（row2 无 `min-height:22px` 坍缩为 0、`.rl-res-cv` 无 `60×90` 高度塌缩被裁、`.rl-res-item` 无 `align-items:stretch` 封面被信息列限高）；**全量 `.rl-res-*` 样式复制到 `styles.css` 末尾做全局兜底**（不依赖 Svelte 运行时注入，重启 Obsidian 必生效）；② **豆瓣搜索结果 cover 协议形态多样**——HTML `<img src>` 有完整 URL（`https://img9.doubanio.com/...`）、协议相对（`//img9.doubanio.com/...`）、站内相对（`/s/pics/...`）三种，Obsidian Electron 下后两种直接加载失败显示断链图占位；`parseDoubanItem` 新增 `normalizeDoubanCover` 统一拼接为 `https://img9.doubanio.com` 完整 URL（`//` 前补 `https:`、`/` 开头补 `https://img9.doubanio.com`、http 升 https）

### 问题修复
- **添加条目搜索窗底部操作栏出现「—」分隔线（用户指示）**：`.rl-fft`（删除条目/重新拉取/保存按钮所在底部栏）顶部 `border-top: 1px solid var(--background-modifier-border)` + `box-shadow: 0 -3px 8px` 分隔阴影 → 搜索结果列表与底部栏之间视觉上横着一条硬分隔线；两条样式删除，操作栏与列表视觉连贯（sticky 固定底部、按钮、间距全保留）
- **搜索结果 row2「悬停才显示」真因——数据缺失而非 hover 逻辑（用户反馈）**：代码层从未有 hover 显示逻辑（git 历史铁证），实际是恒显出的「👤 — · 📅 — · ⭐ 9.7」占位横杠视觉像没显示——豆瓣搜索解析 `parseDoubanItem` 只提取 title/year/rating，**from span 里的作者/歌手/开发商根本没解析**（`DoubanSubject.author/director/developer` 恒空）；且影视搜索 item 无 from span 时年份/导演均为 undefined。修复：① `parseDoubanItem` 解析 from span 首段（`/` 分隔、去 `[国籍]` 前缀、`·` 是作者名一部分不可作分隔符、非纯年份非「流派：」类键值）→ `[游戏]` 前缀归属 developer、书籍/音乐归属 author；② `describeSearchResult` 影视分支 `sub` 缺原名时回退导演（`?? director`），meta 去重不重复显示导演——搜索返回即见真实作者/年份/评分
- **音乐库页签永远「分组歌单」形态，无法使用海报墙（用户指示）**：`MediaList.svelte` 音乐分支此前被锁死（`{#if lockType === 'music'}` 无条件优先 + 视图切换/排序对音乐隐藏）——音乐库改三视图可用：**▦海报墙**（grid 视图复用影视 `rl-card`：封面+标题+专辑·年份+歌手+状态+双评分+hover 播放按钮，547 行播放按钮条件本就含 music 分支）、**☷列表**（通用表格）、**▥瀑布流**；音乐 `subtitleText` 去歌手（「专辑 · 年份」，歌手由卡片创作者行显示避免重复）
- **添加条目搜索窗「取消」按钮删除 + 任意位置取消（用户指示）**：底部操作栏「取消」按钮被删除（`.rl-fft-right` 仅剩保存按钮）——取消改为在搜索结果区点击任意空白处：`.rl-res` 容器加 `on:click` 监听（`onResClick`：`ev.target.closest('.rl-res-item')` 命中条目则忽略，否则 `onCancel()` 关弹窗），条目按钮 `on:click|stopPropagation` 不误触、来源徽标原有 stopPropagation 保持「直达来源不取消」；head 提示补「点击空白取消」
- **搜索结果条目间距过小 + 年份/评分缺失时行内参差（用户反馈）**：`.rl-res` 项间距 6px 与卡片 padding 10px 12px 视觉过挤，且 row2 元信息行在年份/评分缺失时直接隐藏对应字段（`{#if d.year}` / `{#if d.rating}`）→ 有的条目「2009 · ★ 6.7」、有的只剩「★ 4.8」、纯标题条目整行消失，行内内容参差；改为——项间距 gap 6px→12px、卡片 padding 10px 12px→12px 14px；row2 去掉外层 `{#if d.sub || d.year || d.rating || d.meta}` 条件恒渲染，**年份槽位固定**（`{d.year ?? '—'}`）、**评分槽位固定**（`★ {d.rating ?? '—'}`），sub/meta 保持「有才显示」、`·` 分隔符跟随——缺失字段以「—」占位，行内始终「[sub] · [年份] · ★ [评分] · [meta]」整齐对齐
- **搜索结果卡片排版不分、行距过紧（用户反馈）**：`.rl-res-item { align-items: center }` 使中间信息列全部内容垂直居中，配合 `.rl-res-row1` 里「标题+年份+评分」三段横排、副标题/外文名被 nowrap 截断 → 每条结果的所有信息堆在同一行、与右侧来源徽标抢位，项间距仅 4px 视觉贴在一起；重构为两层布局——行 1 主标题独占（16px 粗体），行 2 统一放副标题/外文名 · 年份 · ★评分 · 附加信息（12px 灰、`·` 分隔、超长省略），来源徽标 `align-self: flex-start` 贴右上角不与标题抢位；`.rl-res` gap 4px→6px、`.rl-res-item` padding 8px 12px→10px 12px、中间列 gap 4px→6px，信息层级恢复「标题 → 元信息 → 来源」
- **添加条目弹窗暗黑模式类型下拉白底蓝字**：`.rl-search-type` 的 `<option>` 列表用浏览器原生渲染，不继承 Obsidian 主题变量——暗黑模式下弹出白底 + 蓝色文字的 6 个类型选项（电影/电视剧/动画/书籍/游戏/音乐），强光刺眼且与暗黑 UI 违和；补 `.rl-search-type option { background: var(--background-secondary); color: var(--text-normal) }`（亮/暗自适应）
- **搜索结果态「取消」按钮被挤到 modal 底端近不可见**：`.rl-form` 为 flex column 布局，结果区 `.rl-res { flex: 1 1 auto; overflow: auto }` 占满剩余空间，底部操作栏 `.rl-fft` 的 `position: sticky; bottom: 0` 在弹窗非滚动容器内不生效——结果一多「取消」按钮被推到 modal 最底边缘、半遮挡右侧滚动条，视觉上像被「铲除」；结果区加 `max-height: 50vh` 内部滚动，按钮浮栏始终在底部清晰可见（顺带落实搜索结果间距收紧：`.rl-res` gap 20px→4px 并删掉与 `.rl-res-item + .rl-res-item` margin-top:4px 的叠加，实际行距 24px→4px）
- **音乐条目豆瓣回填作者恒空**：实测真实音乐页（music.douban.com/subject/4899751/）「表演者」标签与值都嵌在 `class="pl"` 的 span 内（`<span class="pl"> 表演者: <a>beyond</a> </span>`），旧正则按「span 内=标签、span 外=值」解析 → 标签被解析成「表演者: beyond」、值为空 → 整行丢弃 → author 恒空；`parseDoubanInfo` 增加「标签: 值」混排兼容（按第一个冒号拆分），作者可回填（+2 回归用例）。⚠️ 「专辑」是豆瓣数据源无此键（专辑页专辑名即标题），不改代码，表单手动填写

### 问题修复
- **移除编辑条目「本地文件夹」输入框**：影视（movie/tv/anime）条目编辑表单不再显示本地下载目录行（label + 只读输入 + 浏览/清除按钮）——`onPickLocalFolder` prop、`browseLocalFolder`、`localWatchDir` 表单变量与提交写入全部删除；EntryModal 不再传入文件夹选择器
- **游戏条目豆瓣回填字段全空（三层根因）**：① 游戏分支 `r.id.replace('douban:', '')` 在 number id（`GameSearchResult.id: number`）上抛 TypeError 被 try/catch 静默吞掉 → **详情拉取从未发生**（题材/年份/平台/开发商/发行商/别名全空），改 `String(r.id)`；② `main.ts fetchDoubanDetailForEntry` 返回字段白名单漏 `platform`/`developer`，抽 `douban.ts toEntryDetailFields` 投影函数统一覆盖（+2 回归用例）；③ `applyDoubanDetail` 补 `platform`/`developer` 写入。`.svelte` 不在 tsconfig include（`**/*.ts`）内、不经 tsc 检查，该类型错误静默放行——已在本条备注

### 内部开发者
- **搜索结果 row2/封面 全局样式兜底 + 豆瓣封面 URL 协议归一化（第十四轮）**：① **styles.css 全局兜底**（23 行）——将 EntryForm.svelte `<style>` 块里所有 `.rl-res-*` 搜索结果样式（含 `.rl-res-row2` `min-height:22px`、`.rl-res-cv` 60×90 `object-fit:contain`、`.rl-res-item` `align-items:stretch` + hover 背景等 22 条）原样复制到 `styles.css` 末尾（注释说明「与 Svelte scoped 重复，确保 Obsidian 重启/CSP 下也生效」）；⚠️ **根因反思**：上一轮我跑「产物符号校验 7/7」时只看产物 main.js 字符串里有没有 `min-height:22px` 等字面量就报 ✓，**没实际打开 Obsidian 看运行时 DOM**——结果用户截图里 row2 仍 0 高度、封面仍被裁（`60×90` 没生效）——这是**产物校验伪绿**。`Svelte 4 css: 'injected'` 通过 `add_css7(document.head)` 运行时注入 `<style id="svelte-almu8f">`，理论在 Obsidian 也该工作但实际未生效，**改为双保险：Svelte scoped + 全局 styles.css 同时定义**，重启 Obsidian 必生效；② **`parseDoubanItem` 封面 URL 归一化**——`src/services/douban.ts` 新增 `normalizeDoubanCover(u)` 工具函数：完整 `https://...` 原样保留、`//img9.doubanio.com/...` 协议相对补 `https:`、站内相对 `/s/pics/...` 补 `https://img9.doubanio.com`、`http://` 升 `https://`；`imgM?.[1]` 提取后立即归一化；TDD 新增 3 用例（协议相对→`https://`、站内相对→`https://img9.doubanio.com`、完整 https 原样保留）红→绿；**514/514 全绿**（34 文件含新加 3 douban 用例）；tsc+esbuild 通过（76 warnings 存量）；main.js **3,349,110B（+308B）** 三产物 cmp IDENTICAL；CHANGELOG 问题修复 +1；current-progress #180；提交 5ce2468
- **「重新拉取」点击即搜（第十三轮）**：仅 EntryForm.svelte——`startRefetch()` 原来只 `refetchOpen = true` + `query = entry.title` + 清 `results/searchError/picked`（用户需再手动点「搜索」）；改为末尾追加 `void doSearch()`，复用 `doSearch` 内已有的 `query.trim()` 读取（即刚赋值的当前标题）、`searching/searchError/results/picked/prog*` 状态重置、`startSimProgress` 进度、按 type 分发（book/game/anime/music/movie-tv）与 `finally` 里 `prefetchTmdbDetails` 预取全链路；搜索结果展示方式（`.rl-res` 卡片 + row2 槽位 + 封面/占位图）与 `SearchResult` 数据结构零改动；`doSearch` 内 `if (!query.trim()) return` 空标题兜底保留；纯逻辑改动无 UI 布局/样式变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（76 warnings 存量 svelte a11y）；main.js **3,348,802B（+7B）** 三产物 cmp IDENTICAL；产物符号校验（startRefetch 函数体为 `refetchOpen=true; query=entry.title; void doSearch()`）；CHANGELOG 体验优化 +1；current-progress #179；提交 4217ebe
- **搜索结果卡片提示去重 + row2 恢复显示 + 封面显示修复（第十二轮）**：仅 EntryForm.svelte（模板 + 样式，无 schema/数据层/逻辑行为变化）：① 双提示去重——row2 三字段 span（`.rl-res-o`/`.rl-res-yr`/`.rl-res-score`）各带 `title="作者/原名/导演"/"年份"/"评分"` 全部删除，卡片 `<button class="rl-res-item">` 补单一 `title="点击回填该条目"`；② row2 恢复显示——`.rl-res-row2` 原 `overflow:hidden` + 无 `min-height`，三层 `min-width:0` 链下子 span 全 `flex:none`，空数据时整行高度坍缩为 0 不可见 → 改 `flex-wrap: wrap` + `min-height: 22px` 并去掉 `overflow:hidden`；③ 封面显示修复——`.rl-res-cv` 的 `<img>` 分支条件 `{#if d.cover && !isDoubanImage(d.cover)}` 把豆瓣图床（doubanio.com）封面错误跳过 `<img>` 渲染走占位图标（豆瓣搜索 cover 本就是 doubanio.com），改 `{#if d.cover}` 直接渲染 img + `referrerpolicy="unsafe-url"`（占位图仅 cover 为空时显示）；纯模板/样式未跑测试套件（项目约定），但跑全套确认无回归 **511/511 全绿**（34 文件）；tsc+esbuild 通过（76 warnings 存量 svelte a11y）；main.js **3,348,895B（-256B）** 三产物 cmp IDENTICAL；产物符号校验 7/7（title 点击回填该条目 1 处、旧 title 作者/原名/导演 0 处、年份 3 处保留纯文本、row2 flex-wrap+min-height:22px、封面 img 分支在、rl-res-ph 占位分支保留、旧 overflow:hidden 从 row2 移除）；CHANGELOG 问题修复 +1；current-progress #178；提交 7754e3b
- **封面 contain 防裁剪 + 详情预取 + 音乐四视图 + 瀑布流标题常显（第十一轮）**：① `EntryForm.svelte`——`.rl-res-item` align-items `flex-start`→`stretch`、`.rl-res-cv` 50×75→60×90 + `object-fit: cover`→`contain`（非 2:3 源图不裁切）、row2 三槽位去 👤/📅/⭐ emoji（纯文本 + title 提示）、新增 `prefetchTmdbDetails`（`results.filter` 判 `source==='tmdb'`，BATCH 5 分批并发拉 `onFetchDetail`，`mergeTmdbDetail` 合并后 `results = [...results]` 触发响应式，期间换搜索 `findIndex` 找不到即丢弃，失败静默）；② 新增 `src/pure/resultMerge.ts` `mergeTmdbDetail(r, d)` 纯函数（非空覆盖 year/rating/ratingCount/director/cast/genres，不改原对象）；③ `MediaList.svelte`——`viewMode` 类型加 `'grouped'`、分组歌单分支条件改 `lockType === 'music' && viewMode === 'grouped'`（音乐四视图，☰ 按钮仅音乐显示）、瀑布流 `.rl-m-overlay` `opacity: 0`→`1` 常显（底部渐变托底 + `align-items: flex-end` + 单行省略，hover 仅加深）；TDD 新增 `tests/resultMerge.test.ts` +4 用例（缺失字段回填/非空优先/详情缺字段不覆盖/纯函数不改原对象）红→绿，相关文件 **101/101 全绿**（douban 81 + searchDisplay 16 + resultMerge 4）；tsc+esbuild 通过（76 warnings 存量 svelte a11y）；main.js **3,349,151B（+2,511B）** 三产物 cmp IDENTICAL；产物校验 15/15（封面 60x90 + contain 无 cover、👤📅 0 处 ⭐ 仅设置页关于文案 1 处、mergeTmdbDetail 展开语法 `_a2 = d.year` 非空覆盖 + director/cast/genres 回填、prefetchTmdbDetails 调用点、☰ `\u2630` 按钮 + grouped 分支、瀑布流 opacity:1 + 渐变托底）；CHANGELOG 问题修复 +3；current-progress #177；提交 fdbc37c
- **搜索创作者解析 + 影视导演回退 + 音乐海报墙 + 分隔线删除（第十轮）**：① `douban.ts parseDoubanItem`——from span 全文改 `split('/')[0]` 首段 + 去 `[国籍]` 前缀 + 非纯年份/非「流派：」键值 → `[游戏]` 前缀归属 developer、书籍/音乐归属 author（`DoubanSubject.author/developer` 字段本已存在只是未填）；② `searchDisplay.ts` 影视分支——`sub` 缺原名时 `?? director` 回退 + meta 导演去重（`sub === t.director ? undefined : t.director`）；③ `MediaList.svelte`——排序下拉去 `lockType !== 'music'` 限制、视图切换按钮解锁音乐、音乐分支改 `lockType === 'music' && viewMode !== 'grid'`（非 grid 保持分组歌单）、`subtitleText` 音乐去歌手（专辑 · 年份）；④ `EntryForm.svelte` `.rl-fft` 删 border-top + box-shadow；TDD 新增 6 用例（douban.test +5：书籍作者/带国籍前缀/音乐歌手/游戏开发商/影视年份不误判；searchDisplay.test 更新 1 + 新增 2：导演回退/无原名无导演保持 undefined）**97/97 全绿**（douban 81 + searchDisplay 16，相关文件）；tsc+esbuild 通过（76 warnings 存量 svelte a11y）；main.js **3,346,640B（-66B）** 三产物 cmp IDENTICAL；产物校验 8/8（`.rl-fft` 无 border-top/box-shadow、`\u6E38\u620F` 游戏归属 developer 赋值、author 赋值、导演回退 + meta 去重、rl-music-group/rl-vb-view 类名在）；CHANGELOG 问题修复 +4；current-progress #176；提交 aad6de9
- **删除取消按钮 + row2 恒显作者/年份/评分（第九轮）**：仅 EntryForm.svelte——模板 3 处（`.rl-res` 容器 `on:click={onResClick}` + 条目按钮 `on:click|stopPropagation`；row2 去 sub 条件改「`👤 {d.sub ?? '—'}` 恒显、`📅 {d.year ?? '—'}`、`⭐ {d.rating ?? '—'}`」三槽位 + meta 保持有才显示；删 `.rl-fft-right` 底部「取消」按钮）+ script 1 处（`onResClick`：`closest('.rl-res-item')` 命中则忽略、否则 `onCancel()`）+ 样式 4 处（row2/yr/o 字号 12→13px + 色 muted→normal、score 12→13px）+ head-hint 补「点击空白取消」；无 schema/数据层/逻辑行为变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,346,706B（-1,778B）** 三产物 cmp IDENTICAL；产物校验 9/9（`\u{1F464}`👤/`\u{1F4C5}`📅/`\u2B50`⭐ 转义在、`\u2014` 占位在、底部取消按钮已从模板函数移除（rl-fft-right 仅剩保存按钮）、closest 判断在、stopPropagation 在、row2 13px 样式在、hint 文案在）；CHANGELOG 问题修复 +1；current-progress #175；提交 49ba8ae
- **搜索结果间距 + 年份/评分固定占位（第八轮）**：仅 EntryForm.svelte——样式 2 处（`.rl-res` gap 6px→12px、`.rl-res-item` padding 10px 12px→12px 14px）+ 模板 1 处（row2 去外层 `{#if}` 恒渲染，年份 `{d.year ?? '—'}`、评分 `★ {d.rating ?? '—'}` 固定槽位，sub/meta 有才显示、分隔符跟随）；无 schema/数据层/逻辑行为变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,348,484B** 三产物 cmp IDENTICAL；产物校验 3/3（`.rl-res` gap:12px 在 / `.rl-res-item` padding:12px 14px 在 / row2 无外层 if 恒渲染 + `\u2014`/`\u2605` 占位转义在）；CHANGELOG 问题修复 +1；current-progress #174；提交待本批
- **添加条目弹窗体验三连（第六轮方案 2/3/4）**：仅 EntryForm.svelte——新增 `pickedTitle`（pick 成功末尾赋值，手动填写不触发）+ fhd 标题三态（`entry ? 编辑条目：xx : pickedTitle ? 添加条目：xx : 添加条目`）；搜索框 keydown 补 `Escape` 分支 `query = ''`；标题输入框（book 分支「书名」+ 其余分支「标题」两处互斥渲染）加 `bind:this={titleInput}`，pick 成功末尾 `await tick()` 后 `titleInput?.focus()`（tick 等字段区 DOM 挂载，防 focus 空引用）；无 schema/数据层/逻辑行为变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,351,940B（+1,098B）** 三产物 cmp IDENTICAL；产物校验 3/3（fhd 三态转义序列在 / Escape→query="" 在 / tick+titleInput.focus 链在）；CHANGELOG 体验优化 +1；current-progress #173；提交待本批
- **搜索结果卡片排版分层（第七轮）**：仅 EntryForm.svelte 模板 `.rl-res-inf` 内部重组（row1 只留主标题 + 新增 row2 条件渲染 sub/year/rating/meta 链，`·` 分隔符按相邻字段存在性输出）+ `<style>` 9 处调整（`.rl-res-item` align-items:center→flex-start + padding 10px、`.rl-res` gap 4px→6px、`.rl-res-inf` gap 4px→6px、新增 `.rl-res-row2`、`.rl-res-yr` 从 inline-flex 组降为纯 span、`.rl-res-score/.rl-res-dot` 补 `flex: none`、`.rl-res-o/.rl-res-m` 补 `min-width: 0` 保 flex item 省略号、`.rl-res-source` 补 `align-self: flex-start`）；无 schema/数据层/逻辑行为变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,350,842B（+3,030B）** 三产物 cmp IDENTICAL；产物校验 4/4（row2 在 / row1 简化 / source align-self / item align-items:flex-start）；CHANGELOG 问题修复 +1；current-progress #172；提交待本批
- **添加条目弹窗样式修复（第六轮）**：纯 `<style>` 改动 3 处（EntryForm.svelte）——`option` 主题色、`.rl-res` max-height:50vh + gap:4px、删 `.rl-res-item + .rl-res-item` margin 叠加规则；无模板/逻辑/schema 变化，**未跑测试套件**（项目约定）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,347,812B（+544B）** 三产物 cmp IDENTICAL；产物校验 3/3（`option` 背景色规则 / max-height:50vh 在 / gap:4px 在、旧 margin 规则移除）；CHANGELOG 未发布节问题修复 +2 条；current-progress #171；提交待本批
- **services 重复纯逻辑下沉 `src/pure/record.ts`（TDD）**：`asRecord`（原 douban.ts/tmdb.ts/bangumi.ts 三份相同定义）与 `parseYear`（原 tmdb.ts/bangumi.ts 两份）下沉 `pure/record` 统一导出，三处删除本地定义改 import；新增 `tests/record.test.ts` +8 用例红→绿（asRecord 对象原引用/null/原始值/数组分支 + parseYear YYYY 前缀/非字符串/无匹配分支），行为与旧定义逐字一致
- **main.ts 行为不变重构**：① `pickLocal*` 四函数（视频/音频/书籍/游戏快捷方式）共享同一份 `electron.remote.dialog.showOpenDialog` + Promise 包装模板（仅 filters 与是否转 vault 相对路径不同），抽 `pickSystemFile(exts, name, toRel)` 统一实现、四方法变薄包装（顺带修正 pickBookFilePath 过时注释「TXT/EPUB」→「TXT/EPUB/PDF」）；② `fetchBangumiDetail(id, prog?, label?)` 抽取 subjects+persons 并行详情补全——表单回填 `fetchBangumiDetailForEntry` 改薄包装（对外签名不变）、`searchAnimeFresh` 前 3 条补全内嵌块替换（保留 studio 合并、失败返回空对象保留搜索级结果、进度回调 success/fail 均推进，行为对齐）
- 测试 **500/500 全绿**（record.test +8）；tsc+esbuild 通过（74 warnings 存量 svelte a11y）；main.js **3,347,268B（-921B）** 三产物 cmp IDENTICAL；产物符号校验 9/9（asRecord/parseYear/pickSystemFile/fetchBangumiDetail + 四薄包装均在）；CHANGELOG 未发布节体验优化 +2 条、内部开发者 +2 条；current-progress #170；提交待本批
- `MediaEntry.localWatchDir` 字段**按 schema append-only 红线保留**（注释标「已弃用，不再读写」，同 platformTemplates 先例）；`normalizeEntry` 删除透传，catalog.test 删除对应 3 条断言（保留 airDate 断言）
- 测试 476/476 全绿（catalog 16 减 3 = 13）；tsc + esbuild 通过，build/ 与测试库 cmp IDENTICAL（main.js 1,136,868B）
- 测试 478/478 全绿（douban.test +2）；tsc + esbuild 通过，build/ 与测试库 cmp IDENTICAL；产物验证 `String(r.id)` / `d.platform && !platform` / `toEntryDetailFields` 均在 main.js

## v0.3.0

> **游戏库 v0.2 + 跨库统计与体验增强 v0.3 一次性发布，290/290 单测全绿（2026-08-27）。**
> **当日发布后增强（290/290，已部署）：游戏源 IGDB→RAWG（免 OAuth 免费 Key）、CSV 导出（与导入对称）、列表表头三态全选、批量栏三操作共用「应用」按钮。**

### 新增功能
- **阅读器批注开关**：TXT/EPUB 阅读器头部新增「批注」toggle 按钮——开启后选中正文文本 → 弹摘录确认（页码/心得）→ 回写该书笔记「## 摘抄」区；默认关闭防误触
- **设置页分组重排**：设置页标题分组顺序调整为 **外观 → 数据管理 → 服务集成 → 关于**（「支持作者」区归入「关于」分组）
- **书籍文件改观看按钮**：编辑表单「书籍文件」输入框 → **「▶ 观看」小按钮**——左键打开阅读器、**右键弹编辑浮层**（路径输入 + 系统浏览选择 TXT/EPUB + 保存/清除）；有文件主题色高亮、无文件灰态提示右键编辑
- **书籍阅读器（TXT/EPUB，参考 obsidian-weave-reader）**：书籍条目「书籍文件」填 TXT/EPUB 路径 → 表单/详情「阅读」打开独立阅读弹窗——**TXT**（章节正则自动分章、目录侧栏跳转、单页连续滚动、字号±、键盘←→翻章、触底自动翻章、滚动位置持久化到 `阅读进度/{id}.json`）；**EPUB**（jszip 解包、spine 章节序、EPUB3 nav / EPUB2 NCX 双格式目录、iframe 安全渲染、双页两栏切换、进度持久化）；**阅读器内选中文本 → 弹摘录确认（页码/心得）→ 回写该书笔记「## 摘抄」区**（复用现有摘抄管道，带块引用锚点）；设置页「外观」加阅读字号/行距滑块；PDF 支持规划后置
- **游玩记录弹窗化**：游戏编辑表单底部「记录游玩」+ 卡片右键「记录游玩」→ 弹窗录入（日期 + 时长小时 + 心得，仿摘抄弹窗含生成预览）；记录同步写入游戏笔记「游玩记录」章节（立即可见）
- **三库分区统计**：统计页重构为 书籍/影视/游戏 三列分区（完成/进行计数 + 时长指标 + 摘抄/记录数 + Top3 评分榜点击开笔记），月度看完趋势三组柱状（书籍/影视/游戏）
- **年度总结**：统计页「生成年度总结」按钮 → 生成 `ReelLudic/reports/YYYY-年度总结.md`（概览 + 三库 Top5 双链榜 + 月度节奏表 + 完整双链清单）并自动打开
- **封面本地化**：设置页开关（新条目封面自动下载到 `covers/`）+ 存量封面一键迁移（限速防反爬、失败跳过、可重试）；离线可用、防图床失效
- **数据导出/导入**：设置页导出 catalog JSON 备份 / **CSV 导出（表头与导入对称）** / 从备份恢复 / CSV 批量导入（合并去重按 标题+类型）
- **批量评分/标签**：列表视图批量栏 状态/评分/标签 三个控件 + **单个「应用」按钮**一次应用全部设置；标签逗号分隔追加合并
- **列表表头全选**：三态（○ 未选 / ⦿ 部分选 / ⦿ 全选当前过滤结果），修原 disabled 圆框不可点
- **游戏数据源 RAWG**：替代 IGDB（rawg.io 免费注册即得 Key、无 OAuth/审核）；大众评分 metacritic/10 优先、fallback rating×2；搜索链 RAWG → 豆瓣兜底

### 界面美化
- **纯色图标系统（参考 obsidian-custom-icons）**：新增通用 Icon 组件（Obsidian 内建 Lucide 图标 setIcon 渲染，随主题变色）——「＋添加」→ plus、「▶ 观看」→ play、「编辑」→ pencil、「🆕 更新」→ bell、「‹ › 导航」→ chevron、「📅 排期」→ calendar、「✕ 清除/关闭」→ x；主界面页签加类型图标（影视=film/书籍=book-open/游戏=gamepad-2/音乐=music/统计=trending-up/计划表=calendar-check）
- **影视聚合页签**：动画/剧集/电影合并为「影视」，内部按三类筛选排序（计数=三类之和）
- **导航栏分层**：视图切换/搜索框（居中）/添加按钮三段式；类型/排序/状态 chips 分行；排序改 5 项点击 chips（最近更新/发布日期/标题/大众评分/个人评分），双状态翻转 + ▲/▼ 方向指示
- **排序按钮无障碍**：按压/过渡/激活持久标记 + aria-pressed / aria-label / focus-visible 键盘聚焦

### 体验优化
- 评分文案统一：排序/表头/笔记「大众评分」与「个人评分」明确区分
- 影视页签切换自动重置为「全部」（修复 Svelte 组件复用导致空屏）
- 排序 chips 视觉刷新（Svelte 4 反应式内联修复）

### 问题修复
- 记录游玩后笔记不同步（addPlaySession 落库后未重写笔记 → 同步 writeNote）
- playtimeMinutes 与游玩记录解耦（总时长手动填写，记录不自动累计/回退）
- 排序按钮点击无视觉反馈（Svelte 4 反应式不穿透普通函数）

### 内部开发者
- 新增 `src/pure/stats.ts`（8 用例）、`src/pure/report.ts`（6 用例）、`src/pure/csv.ts`（12 用例，含 entriesToCsv 圆回）、`src/pure/playtime.ts`（含 hoursToMinutes）
- 新增 `src/modals/GameSessionModal.ts`、`src/modals/VaultFileSuggest.ts`、`src/services/rawg.ts`（4 用例）；删除 `src/services/igdb.ts`
- `MediaEntry` 增 `playSessions?`；设置项增 `localizePosters`、`rawgApiKey`（igdbClientId/Secret 保留弃用不读）
- `EntryService.addPlaySession/removePlaySession` 落库后同步重写笔记
- 测试 290/290 全绿（+26）

## v0.4.1（并入 v0.5.0 发布）

> **删旧源 + 双套编辑 UI + 笔记双向同步 + 搜索提速，337/337 单测全绿（开发段，随 v0.5.0 一并发布）。**

### 新增功能
- **数据源收敛为 Douban / TMDB / Bangumi**：设置页移除 Google Books、RAWG 配置（Open Library 一并移除）；书籍/游戏统一 Douban 单源搜索，影视 = TMDB + Douban 并行、动画 = Bangumi + Douban 并行（按相似度排序）；服务集成重排为「图书/电影/电视剧/游戏 · Douban → 电影/电视剧 · TMDB → 动画 · Bangumi」
- **编辑条目双套 UI**：数据源为 Douban 用「豆瓣版」（按类型字段集：图书=作者/出版社/出版年/ISBN/页数/豆瓣评分(评价人数)/内容简介/作者简介/目录；影视=导演/编剧/主演/类型/国家/语言/上映年/片长/又名/剧情简介；游戏=类型/平台/别名/发行商/发行年/简介），TMDB/Bangumi 用对齐版（原名/制作公司等）；旧源条目按类型归入豆瓣版
- **豆瓣评分评价人数**：搜索 `(N人评价)` / 详情 JSON-LD ratingCount 提取，表单「8.5 分 · 517685人评价」展示
- **图书笔记小标题**：「## 内容简介 / ## 作者简介 / ## 目录」独立章节（豆瓣详情回填）
- **笔记 ↔ 表单双向同步扩展**：正文（内容简介/作者简介/目录/评语/链接）+ 顶部 frontmatter（评分/状态/年份/演职人员/进度/日期/封面）+ 属性表格「来源」行链接，全部回填编辑表单
- **搜索提速 + 步骤化进度条**：TMDB/Bangumi 与豆瓣搜索并行（省 1 个请求往返）；确定性进度条「豆瓣详情补全 2/3 · 预计 3 秒」（线性外推 ETA）
- **表单标题旁来源徽标**：书名/标题右侧「豆瓣 ↗」可点击跳数据源页；状态按钮组与日期并排（所有类型）
- **弹窗防叠加 + 焦点重试**：新开添加/编辑弹窗前关闭旧弹窗；搜索框多轮聚焦重试（防 Obsidian 焦点还原抢焦点）

### 界面美化
- 图书表单精简（删「译名/原名」「类型/题材」）；豆瓣评分与出版年并排

### 问题修复
- **豆瓣游戏封面下载成 74B 菜单 GIF**：游戏详情页全页第一个 `<img>` 是导航占位图，误作封面下载 → 封面提取限定 `item-subject-info` 容器 + 站内 `/pics/` 占位不覆盖搜索级封面
- **内容简介保存后消失**：`normalizeEntry` 缺失 `summary` 字段，落库时被静默丢弃 → 补上并加回归用例
- **搜索级内容简介拉不到**：豆瓣搜索 items 的 `<p>` 简介片段未提取 → parseDoubanItem 补摘要
- **详情 JSON-LD 缺评分覆盖搜索级评分/评价人数**：详情合并改为只覆盖「有值」字段（definedFields）
- **添加弹窗偶发无法输入/搜索**：防弹窗叠加 + 搜索框焦点多轮重试

### 内部开发者
- 新增 `src/services/resultTypes.ts`（BookSearchResult/GameSearchResult，书籍/游戏仅 Douban 后类型独立）、`src/pure/searchProgress.ts`（步骤上报 + ETA 外推，4 用例）
- 删除 `src/services/googleBooks.ts` / `openlibrary.ts` / `rawg.ts` 及测试；`MediaEntry` 增 `ratingCount/authorIntro/toc`（schema 只增不改）；`DoubanSubject` 增 `ratingCount/authorIntro/toc` + 发行商复用 publisher
- `pure/noteEditable.ts` 扩展：正文四章节 + frontmatter 解析（extractFrontmatterFromNote）+ 来源行链接
- 测试 337/337 全绿（+20）

## v0.4.2（并入 v0.5.0 发布）

> **v0.4 批次 + v0.5 阶段 1/2（追更/排期增强、技术债）+ 视图与体验持续优化，tsc/esbuild 通过（开发段，随 v0.5.0 一并发布）。**

### 体验优化
- **辅助源搜索超时压缩**：TMDB/Bangumi 搜索加 5s 超时——无代理/慢网络时不再干等，豆瓣源返回即出结果（不影响正常情况的双源合并）
- **搜索进度条朴素化**：移除流光/脉冲/淡出等网页式动效（回归 Obsidian 插件观感），纯色填充 + 始终显示百分比（单步搜索时模拟爬升进度，真实多步时用真实进度）
- **搜索提速**：搜索阶段不再强制预补前 3 条豆瓣详情（每次搜索少打 3 个反爬详情页）——结果列表秒出，点选某条时按需拉详情回填；游戏结果补上同款按需补全

### 新增功能
- **Bangumi 导入类型映射（动画/电影）**：导入时按 Bangumi subject.type 分类——**2=动画（含剧场版动画电影）**、**6=电影**，书籍/音乐/游戏等类型跳过不入库；动画电影（如《你的名字》）按数据源语义归动画库
- **Bangumi 导入直接拉详情**：「从 Bangumi 导入」建条目时同步拉取每条详情（评分/评价人数/制作公司/导演/主演）一并入库，导入即完整（失败静默保留基础字段）
- **追番表重构（参考 Bangumi-Bridge-Obsidian）**：①**开播季度列**——动画条目显示「2024年秋」等季度（Bangumi 放送时间回填 airDate），排序新季度在前；②**本地文件夹检测**——影视条目可配置本地下载文件夹（表单「本地文件夹」行，文件夹选择器），追番表扫描目录视频文件数与网站检测合并（有更新置顶）；③**从 Bangumi 批量导入**——追番表「从 Bangumi 导入」按钮，输入用户 ID（留空自动从 Token 获取）勾选想看/在看/已看列表，按标题+类型去重批量建条目
- **编辑条目「重新拉取」**：编辑弹窗底部「删除条目」右侧新增「重新拉取」按钮——点击后按当前标题重新搜索数据源（影视/动画走双源、书/游戏/音乐走豆瓣），选结果**回填客观字段**（封面/年份/简介/评分等），不覆盖评语/状态/个人评分/已关联路径；全类型可用
- **年度总结纳入音乐**：生成年度总结（统计页→「生成年度总结」）三库→四库——概览加「🎵 音乐：已听 N 首 · 时长」、Top 评分榜加音乐 Top5、月度节奏表加音乐列、完整清单加音乐分区（双链引用）
- **音乐页签（LyricFlux 联动）**：新增音乐类型与独立页签——豆瓣音乐源（cat=1003）搜索回填**歌手/专辑/发行年/封面/评分（含评价人数）**；表单单行本地音频选择（系统文件选择器，绝对路径自动转 vault 相对路径）；笔记模板 `bookinfo` callout **四行表格**（作者/发行年/来源/评分）+ ` ```lrc source [[歌曲.mp3]] ` 块（LyricFlux 原生支持 wiki 链接，目录解耦：LRC 笔记文件夹指向媒体库目录即可侧边栏播放）+ **`# 个人评语`**（一级标题，评语与 album 均支持笔记回读）；**lrc 块位于简介/评语之后、笔记末尾；音乐无「观看链接」章节**；表单本地音频行位于简介之后；卡片副行显示「歌手 · 年份」；设置页服务集成描述含音乐
- **集标题 + 电影默认 1 集**：集按钮右键编辑浮层新增「集标题」输入（悬停显示「第 N 集 + 标题」如「第 1 集 开始」，存 `episodeTitles`）；集数选择弹窗按钮同样显示「第 N 集 + 标题」；集按钮不再显示蓝/绿角标；**电影条目默认总集数 1**——编辑表单不再显示总集数输入框，但保留第 1 集观看链接按钮（右键关联本地/网络路径后海报墙/列表出现观看按钮）
- **观看链接改回集按钮 + 右键编辑**：观看链接区块恢复 **1..N 集按钮网格**（左键=本地优先播放/否则打开网络；右键=弹「编辑第 N 集」浮层填写本地路径或网络地址，浏览选择文件 / 保存 / 清除）；本地绿点（右上）+ 网络蓝点（左上）双角标，同集可同时关联；移除批量/文件夹/清除全部按钮
- **观看链接合一（网络 + 本地双路径）**：「资源链接」→「网络链接」并与本地剧集合并为「观看链接」区块——**所有影视条目**（电影/电视剧/动画）填总集数后，每集一行同时配置**本地路径**（浏览选择/播放/状态标识）与**网络地址**（输入/打开/复制）；旧「资源链接」数据自动迁移为对应集网络地址（不丢失）；**批量选择文件**（多选，绝对路径可靠）替代目录模式，关联成败均有明确提示
- **本地剧集播放**：动画/电视剧编辑表单填总集数后出现「本地剧集」集按钮行（1..N）——每集关联一个本地视频路径；点击已关联集 → 系统默认播放器播放本地视频（Electron shell.openPath，桌面端）；未关联集点击弹系统文件选择器选视频；「选文件夹批量关联」按文件名自然排序自动填充未关联集；hover ✕ 单集清除 / 「清除全部」一键清空（文字按钮）；**海报墙观看按钮对本地剧集条目二次列出集数弹窗**（已关联集实心点击播放、未关联禁用提示）；路径存 `MediaEntry.episodeFiles`（schema 只增不改）
- **正文字体适配**：插件视图内容区与编辑表单根容器改用 Obsidian 正文字体 `--font-text`（自定义中文字体生效），子元素统一继承
- **弃剧 → 存档**：移除弃剧状态，新增「存档」第五态——任意状态 ↔ 存档双向自由流转（归档标记，可随时恢复）；存量弃剧条目自动迁移为存档（normalizeEntry 归一）
- **搜索缓存失效（E）**：设置页保存时比对凭据字段（豆瓣 Cookie / TMDB Key / Bangumi Token），变更即清空搜索缓存（30min）与更新检测缓存（10min）——旧凭据结果不再残留命中
- **周历排期**：排期表新增「周/月」视图切换——**周视图**一屏聚焦一周 7 天列，每天条目以信息卡展示（封面/标题/类型/剧集进度），今天高亮、过去日期禁用、拖拽排期照常；周导航（‹ 9月1日–9月7日 › 今天）；与月历共存切换
- **支持作者（设置页底部）**：样式参考 LyricFlux about 区——「支持作者」卡片（标题+描述）+ Github / 爱发电 双按钮（Github 链接待发布后回填）
- **版本 0.5.0**：manifest.json 版本 0.3.0→0.5.0，简介精简为「影视/书籍/游戏/音乐收藏管理：书架视图、追更排期、统计看板、多源元数据抓取与双链笔记」
- **双写冲突提示（G）**：`noteFingerprint` 笔记内容指纹（FNV-1a）——保存条目时读现有笔记比对，检测到外部手动修改 → 弹窗二选一「保留笔记改动 / 覆盖为库数据」；「保留」跳过重写（catalog 仍保存），摘抄追加天然安全
- **孤儿封面清理（H）**：设置页「数据管理」新增「清理孤儿封面」——扫描 封面/ 列出未被任何条目引用的文件（取消添加弹窗残留/旧版本遗留），逐项勾选后删除；localizePosters 开关 UI 已移除确认无需处理
- **大库性能评估（补充3）**：16-大库性能评估.md 摸底报告——瓶颈排序（摘抄计数全量文件读 / 海报墙全量 DOM / 追更串行限速），P1 建议摘抄计数落库缓存 + 封面懒加载，虚拟滚动 P2 后置
- **存档徽标**：灰色无图标（亮 #6b7280 / 暗 #9aa0a6，与想看灰 #8a8a86 区分），全类型统一文案「存档」
- **存档全链路接入**：卡片右键菜单、批量改状态、状态筛选下拉、编辑表单状态按钮组（选中存档不显示日期输入框——不用日期选择器）、统计矩阵自动多一行
- **追更检测结果落库（A2）**：`MediaEntry.latestKnownEpisode` 记录最近检测到的最新集数（schema 只增不改）——进追更表**秒显已知结果**（不再全部「检测中…」）再后台刷新；同集数不重复标「🆕」（去重基线 = 落库值，同集数标「✅ 已同步」）；检测成功自动写回落库
- **排期到期联动（C）**：排期表顶部新增到期横幅「📅 N 项排期待开始：《标题》[开始观看]」——`plannedDate <= 今天` 且想看 的条目逐条列出，一键「开始观看」→ 状态 want→watching（排期日期保留）；✕ 关闭本次会话不再提醒
- **检测并发限流**：追更表更新检测由 `Promise.all` 全并发改为**串行 + 1.5s 间隔**（防对反爬站点突发并发请求）
- **更新提示去重**：最新集 ≤ 已知最新不再重复标「🆕 更新X集」（标题悬停仍显示真实差距「最新第X集 · 已看Y集」）

### 界面美化
- **统计页签重构**：Bento Grid 重排——类型分布上移与「今年目标完成度」同排（统计概览紧跟主指标）、月度看完趋势与最近动态同排（同为时间序列数据）、快捷入口压缩为横排一行；类型卡片 5 列→6 列（含音乐）；**底部分区统计三库→四库**（新增音乐列：已听/在听/曲目/时长 + Top 3），月度趋势图新增音乐折线（青色）与图例
- **瀑布流视图**：视图切换新增「▥ 瀑布流」——**只展示封面**的多列流（宽窗 6 列 / 中 4 / 窄 3，轮流分列保持排序横排顺序），hover 浮出标题，点击打开条目、右键菜单可用；与海报墙/列表三态互切
- **回到顶部按钮**：视图下滑超过页签+筛选栏高度时，右下角浮现圆形「回到顶部 ↑」按钮（fixed 定位、主题色、淡入过渡），点击平滑回顶；全页签生效
- **页签/筛选滚动固定**（已回退，见 #114a）：条目多滚动时页签栏、搜索/添加/概览行、筛选行（类型/状态/排序/视图）sticky 固定顶部——部署后用户反馈首行卡片被推到页签上方，flex column 容器 layout 计算错位，回退三处 sticky 改动，保留弹窗滚动条联动
- **隐藏滚动条开关覆盖编辑弹窗**：设置「隐藏插件内滚动条」开启时，编辑条目弹窗内部滚动条一并隐藏（原仅视图内生效）
- **添加条目窗口重构**：搜索结果列表紧凑化（padding 12/16→8/12、间距 4px、弱化边框提升一览性）；评分**只读**（豆瓣/大众评分改为「★ 8.5 · 517,685 人评价」文本展示，禁止编辑）；移除「片长/语言/又名/制片国家/地区」输入框（TMDB 源无法自动获取，数据层字段保留、豆瓣回填值不丢失）
- **列表视图重构**：隐藏「类型」列；新增「大众评分」列（个人评分前）；**表头点击排序**（标题/年份/状态/大众评分/个人评分，▲▼指示，状态按 想看→在看→已看→存档；列表视图移除排序下拉，海报墙保留）；「进度」列改「文本 · 百分比 + 绿色进度条」组合（书/剧集；游戏保持文本）
- **海报墙重构**：书籍进度「45% [条] 0/300 页」（页数在进度条右侧）；移除「原名」（副行只留年份）；大众评分移至**与标题并排**；来源链接按钮置于卡片最后（豆瓣 ↗，有 sourceUrl 时显示）
- 排序纯逻辑扩展：`SortBy` 新增 `status-asc/status-desc`（MEDIA_STATUSES 序），+1 用例
- **编辑条目表单布局**：标题/评分只读/来源链接三并排（标题行）；书籍 出版年+出版社、作者+译者、ISBN+进度页数（两 input 中间 `-` 分隔）；影视 题材+上映年、导演+主演并排（Bangumi 源主演隐藏 → 导演+总集数并排）；封面提示仅「右键更换封面」；移除「原名」输入框（数据层保留）；「类型/题材(标签)」改「题材」普通输入框；**简介类 textarea auto-grow**（主简介/作者简介/目录高度随文字多少自动伸缩——先归零再取 scrollHeight，overflow 隐藏 + min-height 2.4em 少文字基线）
- **章节对齐**：「个人状态与评价」标题负 margin 左移对齐「作品基础信息」首字（弹窗最左），内容 label（观看状态/我的评分/个人评语）与「简介」label 同列对齐
- **海报墙细节**：删旧「0/300 页」纯文本行（书籍进度统一 45%[条]0/300页）；状态徽标后跟我的评分星；副行只留年份（避免"两个标题"重复）；**封面右下角圆形「观看 ▶」按钮**（影视/动画**且已有资源链接**才显示，hover 浮现；单链接直接打开，**多链接弹窗选择播放源**）
- **资源链接交互重构**：添加行粘贴 URL **自动识别平台**（B站/爱奇艺/腾讯视频/Netflix/豆瓣/优酷/芒果TV/YouTube/Disney+/Apple TV 等 18 个域名/关键词映射，识别不到落「自定义」、已存行标签框可手动改）；已存链接行新增「打开 ↗」「复制 ⧉」按钮（打开复用外链逻辑、复制走剪贴板 + 成功提示）；**设置页移除「录入表单」分组（平台链接模板）**、表单移除平台下拉与提示文本（platformTemplates 字段按 schema 红线保留不读、不再生效）；**资源链接区块移至「简介」下方**、主简介框高度翻倍（rows 3→6，作者简介/目录不变）

### 问题修复
- **电影观看直达**：电影条目海报墙/列表 ▶ 不再弹集数选择弹窗——直接播放第 1 集本地视频（无本地则打开网络地址）；电视剧/动画仍弹集数选择
- **去除按钮双悬停提示**：修复 8 处按钮同时带 `title`（浏览器原生 tooltip）与 `aria-label`（Obsidian 自绘 tooltip）导致悬停出现两个提示——删重复 `title` 只留 `aria-label`（海报墙 ⋯/打开笔记/▶、列表 ✎/▶、视图切换 ▦☷▥、排期横幅 ✕、回到顶部 ↑）
- **重填总集数不丢数据**：总集数输入改为「只扩不缩」——重填（如 52→敲成 5→52）时不再截断数组，之前关联的本地/网络路径与集标题保留（提交时按当前总集数截取写入）
- **集数弹窗按钮精简**：海报墙观看按钮弹出的集数选择弹窗，按钮只显示集数数字，「第 N 集 + 标题」移至悬停提示（未关联集禁用并提示可在编辑表单中添加）
- **集浏览选择器修复**：本地视频「浏览…」改走 **Electron 系统文件选择器**（remote.dialog 直接返回绝对路径）——原 `<input type=file>` 的 `File.path` 在 Obsidian 环境不可用导致每次都提示「无法获取文件绝对路径」
- **观看链接精简**：移除区块标题旁的「本地 X/N · 网络 X/N 集」汇总文本；集按钮悬停提示仅显示填写的**集标题**（如【p1 开始】，未填回退「第 N 集」），不再拼接路径信息
- 追更表 blocked 提示文案增强：「该站有 CDN 人机验证，请在浏览器打开确认可访问，或更换观看链接」（原「需在浏览器访问该站或换一个观看链接」）
- **排期表过去日期可管理**：过去日期格子不再禁用点击（可打开当天弹窗「编辑」/「清除排期」），仅禁拖入新排期；横幅标题改「N 项排期待开始」（含过去排期）
- **豆瓣 Cookie 失效明确提醒**：搜索新增条目时若 Cookie 失效（登录跳转/禁止访问/安全验证失败/接口异常）→ 明确提示「豆瓣 Cookie 已失效或过期，请到 设置 → 服务集成 重新登录获取」（原 doubanFallback 吞掉错误只显示笼统「Douban 不可用」或无结果）；影视/动画主源有结果时豆瓣失败不打扰，主源也无结果才提示
- **删除后添加弹窗失焦**：删除确认由 `window.confirm`（Electron 原生对话框，阻塞主线程）改为 Obsidian Modal 确认——关闭后不再与下一个弹窗的打开动画竞争（原删除任意条目后点「添加条目」无法输入/无法点搜索）；删除条目/批量删除确认统一收口到 `plugin.deleteEntry/deleteEntries`
- **游戏条目评分获取**：豆瓣游戏详情页评分结构多形态（v:average 元素 / meta content / rating_num）统一提取；详情页缺评分时不再覆盖搜索级评分（undefined 不覆盖）
- **豆瓣封面 418**：列表视图缩略图 + 搜索结果封面补 `referrerpolicy="unsafe-url"`（doubanio.com 防盗链需带 Referer）
- **Bangumi 导演回填**：persons API `type` 兼容字符串 `"1"`（原数字判断会跳过所有人）+ 职业「演出」归导演；选任意搜索结果（非仅前 3 条）时无导演则按需拉详情补全

### 内部开发者
- **大库 P1 优化（16-性能评估落地）**：摘抄计数落库缓存——`MediaEntry.excerptCount`（addExcerpt 时维护，书架徽标/年度总结读 catalog 零文件读；老数据惰性解析一次并写回）；海报墙/列表封面补 `loading="lazy" decoding="async"`
- 新增 `src/pure/tracking.ts`（15 用例）：`runSerialWithDelay`（串行限流执行器）、`duePlannedEntries`（排期到期列表）、`decideUpdateDisplay`（更新提示去重决策）
- `MediaEntry` 增 `latestKnownEpisode?`（normalizeEntry 同步透传 + catalog.test 回归，吸取 summary 字段遗漏教训）；`extractMaxEpisodeFromHTML` 正则扩展（日文「第X話」、URL 参数 `ep=/ep/`、开头「X集全」，+3 用例）
- `TrackingBoard.svelte` 增 `onSaveLatestKnown` prop（落库写回，HomeView 层接 `service.update`）；`CalendarBoard.svelte` 增 `onStartWatching` prop（HomeView 层接 `service.setStatus`）
- **状态体系重构**：`MediaStatus` 移除 `dropped` 增 `archived`（status.ts 双向自由流转 + labels.ts 全类型「存档」+ normalizeEntry 存量迁移 + noteEditable frontmatter 白名单改 isMediaStatus 随枚举）；status/labels/catalog/tracking 测试同步（+迁移/双向/文案用例）
- **Cookie 失效错误类型化**：`DoubanCookieError extends Error`（douban.ts，4 处 Cookie 相关抛错统一）——`doubanFallback` 返回 `cookieInvalid` 标记（不再吞错误），`searchBook/searchGame/searchMovieTv/searchAnime` 抛明确提示；douban.test +1 用例
- **Bangumi 详情补全体系**：`fetchSubject`（/v0/subjects/{id}：评分+评价人数+制作公司）+ `fetchPersons`（/v0/subjects/{id}/persons：导演+主演，type 兼容字符串 "1" + 职业含「演出」）；动画搜索前 3 条并行补全 + pick 选中时无导演按需补全（subjects+persons 写回导演/评分）；主演字段仅 bangumi 源隐藏（formMode 条件），数据层保留；sources.test +3 用例
- **TMDB 评价人数**：`vote_count → ratingCount`（搜索解析 + `TmdbDetail`/`parseDetail` 详情兜底），标题行显示「★ X.X · N人评价」
- **通用确认弹窗**：`src/modals/ConfirmModal.ts`（DOM API，复用 rl-nc-* 样式）替代全部 `window.confirm`（Electron 原生对话框阻塞主线程，关闭后与 Modal 关闭动画竞争导致下一个弹窗失焦/被遮罩拦截无法输入）——删除条目/批量删除统一走 `plugin.deleteEntry/deleteEntries`（Modal 确认）
- 新增 `src/pure/linkGuess.ts`（18 用例）：`guessPlatformLabel` 纯函数——URL 提 hostname（无协议自动补 https、解析失败正则兜底），按主域名精确/子域后缀（防 `notbilibili.com` 误匹配）→ hostname 关键词兜底两级识别平台标签；`tests/linkGuess.test.ts` 覆盖 18 场景（域名/短链/无协议/大写/端口/未知/空/乱串）
- **游戏评分获取修复**：`extractRating` 统一评分提取（v:average 元素 / meta `property="v:average" content` / `rating_num` 类三结构兜底）；游戏详情合并改 `definedFields` 有值覆盖（详情缺评分不再覆盖搜索级）；douban.test +4 用例
- **豆瓣封面 418 防盗链**：列表视图缩略图 + 搜索结果封面补 `referrerpolicy="unsafe-url"`（doubanio.com 图床需 Referer，否则 418）
- 测试：新用例单独全绿（status/labels/catalog/tracking/noteEditable/douban/sources/tmdb 等），tsc + esbuild 通过；**全量测试本次未跑**（会话指示跳过，待补跑）

## v0.5.0

> **阅读器进度/书签体系 + 电影多集选集修复 + Media Extended 库外播放 + UI 轻量统一 + 音乐分组歌单，469/469 单测全绿（2026-08-31 发布）。**

### 新增功能
- **阅读进度百分比估算**：TXT 按段落数 / EPUB 按章节字符数加权估算整体进度，阅读器头部实时显示「已读 X% · 剩余 Y%」；翻章/关闭时 percent 写回条目 `readingProgress.percent`（新字段，书架进度条/列表进度列优先读取，无则回退手填页码）
- **摘抄定位标记**：阅读器内选中摘录保存时自动携带当前定位（`· 定位：1:42`，章序:百分比，append-only 旧摘抄不受影响），作为书签跳转的数据源
- **阅读器摘抄书签（目录 | 书签 双 tab）**：目录列顶部「目录 | 书签」两个 tab 并排切换——书签 tab 列出笔记摘抄（引用截断 + 定位标签，无定位显示「未定位」），点击书签跳回阅读器对应段落并**高亮 2.5s**（正文段落匹配引用文本）；**右键书签项删除摘抄**（ConfirmModal 确认 → 从笔记摘抄区移除该块 → 书签列表即时刷新，同步更新摘抄数）
- **设置页「实验性功能」分组**：①「内置阅读器打开书籍文件」开关（默认关）——默认系统默认程序打开 TXT/EPUB，开启后走内置阅读器，非桌面端自动回退；②「影音本地播放适配 Media Extended」开关（默认关）——默认系统播放器打开本地视频，开启后优先 Obsidian 媒体视图/Media Extended（vault 内 `openFile`；vault 外经 ME 编程入口 `api.openUrl` 或 `mx-open` URI，见「问题修复」节）
- **阅读器行距调节**：头部新增「行距− / 行距+」（0.1 步进，范围 1.2-2.4，跨面板共享）
- **游戏 .lnk 快捷方式启动**：游戏条目表单新增「启动快捷方式」行（浏览选择 .lnk，库内/系统二选一，存 `gameLaunchPath`）；海报墙/列表「▶ 启动」按钮（有快捷方式时显示）→ `shell.openPath` 启动游戏
- **音乐条目点击即播**：音乐卡片/列表「▶ 播放」按钮（已关联音频时显示）→ vault 内音频用 Obsidian 媒体视图播放（配合 LyricFlux 增强）、库外回退系统播放器；卡片副行显示「歌手 · 专辑 · 年份」
- **音乐页签分组歌单**：音乐条目按**歌手分组**展示（组头 = 歌手名 + 曲数，组名中文本地化拼音序，未填歌手的归「未分类」组置底；组内按专辑 → 年份 → 标题排序）；固定歌单形态（不再切换海报墙/表格视图，排序下拉与视图切换隐藏），支持搜索/状态筛选（筛选后重新分组）——新增 `src/pure/musicGroup.ts` `groupMusicByArtist`（7 用例）

### 界面美化
- 阅读器头部新增进度文本（`已读 34% · 剩余 66%`，muted 小字）
- **UI 轻量统一（按 Obsidian 审美收敛）**：①按钮体系合流——`.rl-ex-btn`/`.rl-day-btn` 并入 `.rl-btn` 单一基准（紧凑 12px / padding 4px 12px），EntryForm Svelte scoped 重复定义删除跟随全局；②危险按钮统一——`.rl-nc-danger`/`.rl-day-btn-danger`/`rl-btn-danger` 同交互（红边红字 → hover 红底白字），硬编码红 `#c0493f`/`#e03131` 全部换 `var(--text-error)`；③状态徽标双实现合流——MediaList scoped 徽标删除，全局 `.rl-badge` 唯一实现（补 cursor:pointer）；④字号全部映射 `--font-ui-smaller/small/medium`（清掉 11.5px/12.5px 非标刻度）；⑤摘抄跳转高亮改用 Obsidian 内置 `var(--text-highlight-bg)`（亮/暗自适应）；⑥等宽字体栈统一 `var(--font-monospace)`；⑦圆角收敛 7px/8px → 6px；⑧弹窗标题统一 15px/600

### 体验优化
- **设置页移除「阅读字号/阅读行距」滑块**：字号/行距调整全部移到阅读器内（A± / 行距±），调整写回设置全局记住（轻量落盘，不重建客户端）；字段保留兼容旧数据
- **阅读器滚动性能修复**：滚动事件 rAF 节流（滚动中不再反复读 scrollHeight 强制布局）+ 容器高度缓存；TXT 段落渲染改 DocumentFragment 批量插入；触底自动翻章延后到宏任务（不再在滚动帧内同步重建 DOM/iframe）；EPUB 宿主样式（字体/背景）打开时缓存一次，切章不再触发主文档重排
- **电影条目编辑表单显示「总集数」框**：此前电影固定总集数 1 且不显示输入框（TV/动画一直有）——现按用户要求加回，电影默认 1、可编辑（改大后观看链接自动变多集，与 TV/动画行为一致）；watching/非 watching 状态提交均写入 `progress.totalEpisodes`，电影保留原 season/episode

### 问题修复
- **EPUB 单页滚动无法进入下一章**：短章节（内容 + 底部 padding 不足一屏）`scrollHeight ≤ clientHeight` 导致滚动比例恒 0、永远够不到 0.98 阈值 → 触底判定改为「滚动到底 **或** 内容不足一屏」（TXT 段落少的章节同步修复）
- **移除双向溯源（按用户指示）**：删除笔记定位标记可点击跳原书（MarkdownPostProcessor）、书签「↗ 开笔记」按钮及溯源相关方法——书签只保留「跳回原书段落 + 高亮 + 右键删除」行为
- **阅读器添加摘抄后书签不实时显示**：面板只在打开时读一次笔记摘抄区，新增摘抄写笔记后无任何同步 → `openReaderExcerpt` 增 `onSaved` 回调（保存成功后重读 `loadEntryExcerpts`），Modal 层暴露 `refreshExcerpts` 转发给面板重绘书签 tab（删除路径原已实时，双向闭环）
- **阅读器书签左键点击不能跳转**：`jumpExcerpt` 调 `switchChapter` 遇同章短路（`i === chapterIndex` 直接 return）且 `jumpRatio`/`pendingHighlight` 残留误触发 → 同章分支绕过短路直接恢复滚动比例 + 定位段落高亮（TXT 直操作 scrollEl / EPUB 直操作 iframe 内 scroller），跨章逻辑不变
- **电影条目多集不弹集数选择（默认播第 1 集）**：`openWatchLinkPicker` 对 movie 无条件「直达第 1 集」，不检查总集数 → 改为真正单集（总集数未设或 ≤1 且资源 ≤1）才直达；多集（如动画电影系列，或设了总集数但只填了部分资源）落入集数选择弹窗，且弹窗按 `Math.max(totalEpisodes, 已填资源数)` 展开完整集数（未填资源的集置灰，提示在编辑表单补录）
- **vault 外绝对路径本地媒体播放不了**：此前库外文件硬编码回退系统播放器（`shell.openPath`），且未尝试 Media Extended（ME 官方披露明确支持 vault 外文件，`resolveMxProtocol` 对 file:// + 非 vault 文件会继续解析播放）→ 新增 `playWithMediaExtended` 降级链：优先 ME 编程入口 `api.openUrl(file:// URL)`（v3+ 公开 API）→ 回退 `obsidian://mx-open?url=` URI 协议 → 最后系统播放器；`playLocalEpisode`/`playAudioEntry` 库外分支均接入

### 内部开发者
- **新增 `Project-Rule/UI-GUIDE.md` 界面设计规范（AI 对齐）**：遵循 Obsidian 原生设计语言；CSS 全局变量体系（复用内建 `var(--*)`，禁止硬编码色值）；组件库约定（rl-* 语义类 + 复用内建组件）；设计流程「多方案对比 + 排雷法」+ UI 增删改前象形确认；改动自查清单
- `src/pure/readingProgress.ts` 新增 `estimatePercent`（章节大小加权，钳制 0-100，12 用例）；`src/pure/excerpt.ts` `ParsedExcerpt` 增 `loc` + `removeExcerptBlock`（按 ^id 删块，6 用例）
- `MediaEntry` 增 `readingProgress.percent?` / `gameLaunchPath?`（normalizeEntry 透传 + catalog.test 回归）；`ReelLudicSettings` 增 `internalBookReader?` / `internalMediaPlayback?`（默认 false）
- `main.ts`：`openBookReader` 外部/内部分流、`persistReadingPercent`、`loadEntryExcerpts`、`deleteBookExcerpt`（ConfirmModal）、`pickGameLaunchPath`、`launchGame`、`playAudioEntry`、`playLocalEpisode` Media Extended 分流；`openReaderExcerpt` 增 `onSaved` 回调、`openBookInternal` 持有 modal 引用刷新书签
- 测试：readingProgress 21 / excerpt 41 / catalog 16 / entryService 39 全绿；tsc + esbuild 通过，build/ 与测试库 cmp IDENTICAL（main.js 1,124,865B）
- `EntryForm.svelte`：影视条目（movie/tv/anime）统一渲染总集数框（bangumi 模式 + 非 bangumi 模式），提交逻辑 movie 纳入 totalEpisodes 写入（保留原 season/episode）；`main.ts` `openWatchLinkPicker` 电影多集分流
- 新增 `src/pure/mediaFileUrl.ts` `toFileUrl`（本地绝对路径 → file:// URL：反斜杠归一、中文/空格百分号编码、`#`/`?` 显式编码防 URL 截断，6 用例）——Media Extended `api.openUrl` 的输入格式
- 新增 `src/pure/musicGroup.ts` `groupMusicByArtist`（音乐按歌手分组：组名中文本地化排序、未分类置底、组内专辑→年份→标题，7 用例）；`MediaList` 音乐页签分组歌单渲染（组头 + 窄行）

## v0.4.0（并入 v0.5.0 发布）

> **豆瓣兜底反爬适配 + 搜索多源并存 + 添加窗口 UX 重构，317/317 单测全绿（开发段，随 v0.5.0 一并发布）。**

### 新增功能
- **豆瓣兜底反爬适配**（移植 wanxp/obsidian-douban v2.5.0 方案）：桌面端改用 Node 原生 `https` 传输层（绕开 Electron 网络栈指纹）+ 手动重定向 Set-Cookie 续传；PoW 安全验证求解改 Node crypto 提速；反爬拦截页三态检测（禁止访问/登录跳转/内容缺失）；详情 JSON-LD 失败回退 og meta；游戏详情走 `dl.thing-attr`（豆瓣游戏页无 JSON-LD）
- **编辑条目简介框**：`MediaEntry` 增 `summary` 字段，表单「作品基础信息」下新增可编辑简介框（搜索回填/手动改），笔记属性表后独立「## 简介」章节
- **搜索多源并存合并**：主源 + 豆瓣「20+20」合并（同源同名去重、跨源同名保留对比）；结果按搜索词相似度排序（完全相等 > 前缀 > 包含 > 首字模糊 > 无关）
- **搜索卡片带大众评分**：所有数据源（TMDB/豆瓣/RAWG/Bangumi/Google Books）显示 `★ 8.4`（数据源原分制）

### 界面美化
- **添加条目窗口 UX 重构**：海报固定 2:3 + 圆角 4px + object-fit；无封面/豆瓣封面占位图改类型图标（🎬📺🌸📖🎮）；外链「TMDB ↗」弱化为浅灰文字；卡片 hover 背景变深；未选中条目时不显示保存按钮；类型+输入框合并为组合输入框；标题 16px 加粗 + 副标题 muted + 年份评分纯文字「1999 • ★ 8.3」
- 搜索结果条目间距拉大（gap 12→20px）

### 问题修复
- **豆瓣封面防盗链空白**：豆瓣图床要求 Referer 为 douban.com，Obsidian 内 `<img>` 永远发 app:// → 搜索回填时下载到本地 `封面/{标题}.jpg`
- **搜索结果第一行标题被遮**：海报 `<img>` 缺 `display: block`，height 约束失效撑高卡片
- **游戏搜索只返回 5 条**：RAWG `page_size` 写死 5 → 改 30
- **豆瓣首请求丢 Cookie**：Node 传输层重定向分支才写回 Cookie → 首请求即携带

### 内部开发者
- 新增 `src/services/nodeHttp.ts`（Node 原生 http/https + 重定向 Cookie 续传 + 超时重试 + 二进制下载，惰性 require 防移动端崩）
- 新增 `src/pure/searchMerge.ts`（mergeBySource / sortByRelevance）
- `MediaEntry` 增 `summary?: string`（schema 只增不改）；`douban.ts` 增 detectDoubanPageProblem / parseDoubanOgMeta / parseDoubanGameDetail
- 测试 317/317 全绿（+7：searchMerge 7；douban/nodeHttp 等已在 v0.3.0 后陆续增补）

## v0.2.0（并入 v0.3.0 发布）

> **游戏库 v0.2：游玩记录 + 时长，随 v0.3.0 一并发布（2026-08-27）。**

### 新增功能
- **游玩记录（playSessions）**：游戏笔记「游玩记录」章节（日期倒序）；playtimeMinutes（总时长）**手动填写**，与明细解耦
- **时长格式**：formatPlaytime 统一小时制（0.5h / 1.5h / 12h），卡片/笔记统一

### 内部开发者
- `src/pure/playtime.ts`：formatPlaytime / playtimeFromSessions / hoursToMinutes
- `MediaEntry` 增 `playSessions?: PlaySession[]`（schema 只增不改；catalog 归一化兜底）
- `EntryService.addPlaySession` / `removePlaySession`（仅 game，落库后同步重写笔记）
- `noteGenerator` 游戏笔记「游玩记录」章节（日期倒序渲染）

## v0.1.0

> **书籍库：书摘双链 + 阅读进度完整实现，248/248 单测全绿（2026-08-27 发布）。**

### 新增功能
- **摘抄录入**：命令「添加摘抄」+ **书籍编辑表单/卡片右键「添加摘抄」按钮**（按入口固定挂载书目）→ 弹窗（剪贴板自动带入 + 页码 + 心得）→ 生成摘抄块（`^id` 块引用锚点），支持连续录入
- **摘抄存储**：书目笔记内嵌「摘抄」章节（个人评语后/链接前），摘抄块可被任意笔记 `[[书目#^id]]` 引用
- **合并写入策略 C**：模板重写时按「## 摘抄」标记行提取旧摘抄原样回填，防覆写清空用户摘抄
- **阅读进度双轨**：编辑弹窗「当前进度/总页数」并排 + 进度条自动延伸（四色阶反馈）+ 读完提示；EntryService.advanceReading（page/percent 校验）
- **书籍类型回填**：搜索自动填充类型/题材标签（Google Books categories + Open Library subject 提取）与页数（pageCount）
- **摘抄数徽标**：书架书籍卡片显示「摘抄 N」
- **书籍文案软化**：编辑表单书籍显示「阅读状态/阅读日期」「书名/译名（外文原名）」

### 体验优化
- **文件来源二选一弹窗**：浏览按钮弹「从库中选择 / 从系统浏览」卡片弹窗（替代 Menu 定位不可靠）；vault 内文件存相对路径、库外存绝对路径
- **海报墙悬停残留修复**：观看/打开笔记/更多按钮点击后 blur——不再因 `:focus-within` 持续显示悬停操作层
- **进度条按百分比分四色阶**：<30% 红 / 30-69% 琥珀 / 70-99% 绿 / 100% 深绿，平滑过渡
- 日期输入框日历图标固定右侧作为点击触发器
- 封面区虚线边框拖拽引导（hover 高亮，无封面显示「拖入图片/右键更换」）
- 标签输入框回车生成胶囊（含中文输入法 isComposing 守卫）
- 书籍表单类型化：书籍不再显示「片长/导演/编剧/国家/地区」（仅影视/动画）
- 「想读」状态但已有阅读进度时给出建议切换提示

### 问题修复
- 书籍条目误显示影视专属字段（片长/导演/国家）→ 按类型条件渲染
- 书籍搜索回填类型/题材丢失 → BookSearchResult 补 genres 字段 + categories/subject 提取 + EntryForm 读取

### 内部开发者
- 新增 `src/pure/excerpt.ts`：block ref 生成/摘抄块解析渲染/摘抄区提取/合并写入/追加（纯逻辑 28 用例）
- 新增 `src/modals/ExcerptModal.ts`：摘抄录入弹窗（DOM API 渲染，支持固定挂载书目）
- 测试 248/248 全绿（+45：excerpt 28 / advanceReading 8 / writeNote 合并 3 / addExcerpt 4 / pageCount+genres 3）

## v0.0.1

> **ReelLudic 首个发布版本：影视库 MVP + 七页签统一视图完整实现，203/203 单测全绿（2026-08-26 发布）。**

### 新增功能
- 书架视图：海报墙 / 列表双形态，支持类型、状态、评分、标题筛选排序
- 追更视图：连载中剧集集中管理，「已更新」一键推进集数并记录日志
- 添加影视：TMDB 自动抓取（搜索回填导演/演员/类型/封面）+ 手动录入，可互相覆盖
- 状态流转：想看 / 在看 / 已看 / 弃剧 四态，不合规回退置灰
- 进度记录：剧集记「季·集」（含历史），电影记观看日期
- 评分：1~5 星，参与排序筛选
- 观看链接：预设平台模板（B站/Netflix/豆瓣/爱奇艺/腾讯视频）+ 自定义
- 详情笔记：每条目自动生成 .md（frontmatter + 评语区 + 链接），双链就绪
- 混合存储：ReelLudic/ 目录（catalog.json + entries/*.md）
- 设置面板：TMDB Key / 库目录 / 豆瓣兜底开关 / 平台模板 / 连接测试按钮
- **删除条目**：编辑弹窗「删除条目」按钮（二次确认），删条目连带删笔记文件，立即刷新
- **数据变更自动刷新**：vault 文件监听兜底，外部修改/删除 catalog 或笔记文件后界面自动同步（防抖 500ms）
- **七页签统一视图**：计划表（追更表/月历切换）→ 书籍 → 动画 → 剧集 → 电影 → 游戏 → 统计，Tab 计数实时刷新
- **月历计划表**：想看条目按计划日期落格（周一起 7 列网格），点击日期打开当天详情弹窗
- **统计仪表盘**：Notion 式 Bento Grid（能量环 / 最近动态 / 类型分布 / 快捷入口 / 年度活跃热力图）
- **网站更新检测**：追更表「重新检测」抓取观看网址 HTML 提取最新集数，区分已更新/已同步/失败/被屏蔽等状态
- **Open Library 书籍兜底**：书籍搜索链升级为 Google Books → Open Library → 豆瓣（免费无 Key、无严格限流）
- **搜索缓存与网络加固**：30 分钟 TTL 内存缓存防重复搜索（429/反爬友好）；全部网络层超时（TIMEOUT_MS）+ GET 重试
- **色彩主题**：设置页「外观」分组，彩色（类型色条+状态五色）/ 单色切换
- **书籍文案软化**：书籍条目状态/日期标签按类型显示「想读/在读/已读/弃读」而非观看语义

### 界面美化
- 书架卡片类型色条：电影蓝 / 剧集紫 / 动画粉 / 书籍绿 / 游戏橙（可关闭）
- 编辑弹窗加宽：`min(720px, 92vw)` 适配双列 + 多字段布局，窄屏自适应
- 来源徽标可点击直达来源页；搜索结果数量上限 30+

### 体验优化
- 搜索过程显示不确定进度条，结束自动消失
- 未配置 Key、401/429、空结果、回填失败均有明确提示（不静默）
- **搜索结果卡片化**：每条目显示封面（无封面占位图）、中文名、原名/作者/导演/开发商/制作公司、年份徽标、豆瓣兜底来源徽标，信息层次分明
- **保存即刷新**：添加/编辑/状态切换/追更标记/删除后界面立即反映最新数据，无需手动刷新
- 笔记生成失败不再阻断保存：条目已落库并刷新，提示区分「已保存但笔记失败」

### 问题修复
- Svelte 4 裸 `onclick` 静默失效（编译为 setAttribute，全部按钮无反应）→ 改为 `on:click`
- TMDB 401/429 被静默吞掉 → 按状态码抛出明确错误
- 未配置 Key 时搜索按钮禁用无提示 → 点击给出引导提示
- 添加/编辑后界面不实时刷新（writeNote 异常阻断 refreshViews）→ 刷新移入 finally 必刷
- 外部删条目/改数据不刷新 → 新增 vault 文件变更监听兜底

### 内部开发者
- 脚手架沿用 obsidian-lyricflux 约定：esbuild + tsc + Vitest + build.bat + sync_plugin.ps1
- 纯逻辑模块（data/pure/services）无 obsidian 依赖，203 个单测覆盖
- 新增 src/pure/：searchDisplay（4 类数据源统一视图模型）、search（筛选排序）、searchCache（TTL 缓存）、timing（超时/重试）、updateCheck（网站更新检测）
- 新增 src/services/openlibrary.ts：Open Library 书籍搜索（HTTP 注入可 mock）
- git 里程碑：b169000（G4 实现）→ a30d84d（连接测试）→ 1b56faa（搜索反馈）→ 2d95ead（onclick 修复）→ 665fd2e（三视图合并）→ 6c5d7eb（libraryDir）→ b29d809（三库扩展）→ 038f1c9（豆瓣全类型）→ a79eca5（豆瓣 PoW）→ 6227c94（实时刷新三保险+搜索卡片）→ d5ced26（docs 同步）→ 71e6794（封面响应式+状态即时刷新）→ 351e2b7（搜索 30+来源徽标）→ a1400be（弹窗宽度）→ e215b3b（网络基础设施）→ d3a8239（七页签视图）→ 579c801（参考脚本）


> **Hover 提示统一 data-tip（v2 规范，用户指示全仓迁移，tsc 0 + 46 相关单测绿 + 产物断言 PASS + 三段 cmp IDENTICAL）：** 全仓 hover 提示由 title 原生黄条统一迁移到 `data-tip` 自绘气泡（深色 tooltip 风、跟随鼠标视口翻转）。新机制 `src/services/globalTooltip.ts`（document 委托 mouseover/out + 点击收起 + pointer-events:none），styles.css 新增 `.rl-tip`，plugin onload register 全局启用；Svelte/TS/DOM 四类载体机械迁移（Svelte 模板 title=、TS setAttribute/`obj.title=`/attr 块状态机），共改 16 文件、data-tip 138 处（Svelte attr + attr 键 + setAttribute 38），残留断言：Svelte title attr 0 / TS title attr 0 / 产物 attr(el,"title" 0；备份对比恢复 2 处 `===` 误伤（pdfProgress/googleBooks）。aria-label 保留仅读屏。规范写入 Project-Rule/UI-GUIDE §3（禁 title、data-tip 三写法、aria 职责）+ 评审清单 + AGENTS 坑点 v2 更新。待提交批次含本项。
