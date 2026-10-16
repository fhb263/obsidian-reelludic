# 方案设计 · 第十批（2026-09-18）

> 本批 8 项需求：笔记表格开关 / 侧栏底部页签样式 / 服务集成分组样式还原 / 高亮位移修复 /
> 搜索拆「网络搜索 + AI 搜索」两个入口 / 动作条与顶栏顺序 / 引擎表扩到 5 类 24 个 / AI 卡新增自定义提问。
> 状态：**已实施完毕（2026-09-18）**，验证链见文末「落地记录」。

## 决策记录（AskUserQuestion 收口，2026-09-18）

| 编号 | 问题 | 用户裁定 | 落地 |
|------|------|----------|------|
| D-1 | ① 数据源管理下两组的「原始样式」 | **这步不做**（保持「标题 + ▸ 可点折叠」现状；只去 ② 内的 `1/2` 序号前缀） | 仅改标题文案，`createGroupSection` 结构零改动 |
| D-2 | 侧栏底部两按钮激活样式 | **无块无线，仅主题色 + 加粗** | `.rl-reader-toc-tab.active` 撤下划线改 700 字重 |
| D-3 | 24 个引擎的浮层形态 | **分组文字 chip 浮层** | `.rl-search-net-*`（预览行 + 5 组 + chip + 内部滚动） |
| D-4 | AI 卡「自定义提问」进入方式 | **卡顶两态切换** | `mkMode('read'/'ask')` + 两套输入区 |
| D-5 | 「不启用」粒度 | 默认取法：三个下拉各自新增「不启用」 | `AI_PROVIDER_OPTIONS` + `normalizeAiChoice` + `aiOffBlocked` 四处守卫 |
| D-6 | 笔记表格开关 | 默认取法：设置页「数据管理」、默认开、不追溯改写已有笔记 | `settings.noteTable`（append-only）+ `{ table }` 门控 |
| D-7 | 特色场景 4 个入口站点 | 默认取法：网盘＝阿里云盘 / 电子书＝鸠摩搜书 / 音乐＝网易云音乐 / 影视＝豆瓣电影搜索 | 已 curl 实测，写进 `SEARCH_ENGINE_GROUPS` |
| D-8 | 「右键动作条」 | 默认取法：按**划词动作条**理解（动作条 + 顶栏两处同改） | 顺序契约断言锚 `bar.append` 形参序 |

---

## 落地记录（2026-09-18）

- 改动文件：`src/pure/readerSearch.ts`（引擎分组表 + `buildSearchQuestionBody`）、`src/pure/translate.ts`（`normalizeAiChoice` / `AI_PROVIDER_OPTIONS`）、`src/pure/highlight.ts`（mark CSS）、`src/Settings.ts`（表格开关 + 不启用 + 去前缀）、`src/data/noteGenerator.ts`（表格门控）、`src/services/EntryService.ts`（第 4 参透传）、`main.ts`（`aiAskText` / `aiOffBlocked` / `rebuildService` / 两处 `onAiAsk` 接线）、`src/modals/TxtReaderModal.ts` + `src/modals/EpubReaderModal.ts`（搜索双入口 + 六按钮顺序 + 两态卡 + 网络浮层）、`styles.css`。
- 验证：tsc 0；构建 87 告警（基线）；受影响单测 207/207 → 全量 **1336/1336（84 文件）**；产物断言 **849 PASS / 0 FAIL**；突变 **10/10 全抓**；三产物 md5 三方一致 + `cmp` IDENTICAL + 已部署测试库；公开镜像已同步（17 成员，LICENSE 只读 `cmp` 一致）。
- 遗留 / 下一轮候选：① PDF 侧仍无划词动作条与高亮（既有状态，本批未动）；② 特色场景 4 个入口站点若想换（如夸克网盘 / 安娜档案 / QQ音乐 / 豆瓣全部）只改 `SEARCH_ENGINE_GROUPS` 一处；③ 网络搜索目前不抓结果列表（引擎浮层 → 系统浏览器），「卡内出网页结果」需自备 API Key。

---

## 0. 现状核查（逐项确认位置与影响面）

| # | 需求 | 现状落点 | 影响面 |
|---|------|----------|--------|
| 1 | 笔记表格开关 | `src/data/noteGenerator.ts:216` 属性表格（`| 属性 | 内容 |`）+ 音乐对齐分支 `:218` | 该表格被 `pure/noteEditable.ts` 反向解析「来源」行 → `sourceUrl/source` 回填（无表时回退 catalog 值，**不丢数据**） |
| 2 | 侧栏底部两按钮 | `styles.css:1144` `.rl-reader-toc-tab.active` = `box-shadow: inset 0 -2px 0`（下划线） | TXT/EPUB/PDF 三阅读器共用（tab 行为三件一致） |
| 3 | 服务集成分组 | `src/Settings.ts:209 createGroupSection` + `:201 createSectionTitle` | ①/② 与四组共用同一套渲染 |
| 4 | 高亮位移 | `styles.css:1287-1302` + `pure/highlight.ts:71 highlightMarkCss()` | 两处同源（EPUB iframe 走注入式 CSS），必须成对改 |
| 5 | 搜索拆两个入口 | 动作条 `TxtReaderModal.ts:1219 buildSelbar` / 顶栏 `:485 mkQuick`；搜索卡 `:1632`、二选一浮层 `:1815` | **TXT + EPUB 两份面板**，另有 `askSearchMode` 二选一层要被取代 |
| 6 | 顺序 | 动作条现序 书签·摘抄·高亮·翻译·搜索；顶栏现序 书签·摘抄·翻译·高亮·搜索 | 同上两份 |
| 7 | 引擎表 | `src/pure/readerSearch.ts:33 SEARCH_ENGINES`（4 个，扁平） | 单测 `tests/readerSearch.test.ts`（11 例）+ 产物断言 |
| 8 | AI 卡自定义提问 | 卡内仅一个查询框（回车重跑，`runAiSearch` 走 `settings.readerSearchPrompt`） | 需新增一条**不读设置提示词**的请求通道 |

---

## 1. 高亮位移：根因已实证（回答需求 4）

**不是重排、不是滚动复位，是 `<mark>` 的盒模型参与行内布局。**

实测（无头 Chrome，抄 `styles.css` 真身规则，正文版心 520px / 字号 16px / 行距 1.8）：

| 状态 | 段高 | 行数 | mark 之后第 1 个字的 x |
|------|------|------|------------------------|
| 无 mark（基线） | 86 | 3 | **457** |
| 加 `hl` 高亮（现规则） | 86 | 3 | **459**（+2px） |
| 加 `hl` 但 `padding:0` | 86 | 3 | **457**（= 基线） |
| 加 `underline`（现规则） | 86 | 3 | **459**（+2px） |

结论：

1. `padding: 0 1px` 让 `mark` 的行内盒左右各宽 1px → **同一行 mark 之后的文字整体右移 2px**；
   若该行接近折行边缘，还会挤掉最后一个字换到下一行 → 观感就是「稍微位移」。
2. `underline` 变体只有 `background/border-radius/border-bottom` 被覆盖，**没重置 `padding`** →
   划线样式同样带这 2px。
3. 段高/行数不变（行距 1.8 给了足够留白吸收 2px 边框），所以不是「整段往下跑」。
4. 翻页模式下版心宽度变化 2px 会参与列数重算，位移表现更明显（可能整页内容挪一位）。

**修法**（零布局影响，保持视觉）：

```css
.rl-hl-persist{background:…;border-radius:2px;}            /* 去掉 padding:0 1px */
.rl-hl-persist[data-style="underline"]{… text-decoration:underline 2px solid var(--rl-hl-c);
    text-underline-offset:3px;}                            /* border-bottom → text-decoration（不占布局） */
```

`text-decoration` / `background` / `border-radius` 都不参与行内布局 → 位移归零。
副作用：底色高亮不再向左右各溢 1px（贴字更紧），肉眼几乎不可辨。

---

## 2. 待裁定项（象形）

### D-1 服务集成分组（需求 3）

现状（①② 与四个组同一套渲染，都是「小标题 + ▸」）：

```
① 数据源管理
   数据源启用                              ▸
   数据源凭据                              ▸
② AI集成
   1 AI服务                               ▸
   2 API凭据                              ▸
```

- **方案 a（推荐）** ① 两组回「原始」= 标题常显 + 内容直接平铺（不折叠）；② 两组保持可折叠，标题去 `1/2` 前缀：

```
① 数据源管理
   数据源启用                    ← 小标题（不可点）
     ☑ 豆瓣  ☑ TMDB …          ← 内容直接可见
   数据源凭据                    ← 小标题（不可点）
     豆瓣 ▸   TMDB ▸   …
② AI集成
   AI服务                        ▸    ← 可点折叠
   API凭据                       ▸
```

- 方案 b：① 两组回到**行头式折叠**（一行 `数据源启用 ▸`，样式同源行 `.rl-key-row`）
- 方案 c：①② 四组**全部平铺**（一律不折叠）

### D-2 侧栏底部两个按钮的激活样式（需求 2）

现状 = 底部下划线竖条：

```
├──────────────────────┤
│  目录  ▔▔▔   摘抄     │   激活项：底部 2px 主题色横线
└──────────────────────┘
```

- **方案 a（推荐）** 圆角胶囊底（激活项 = 主题色底 + on-accent 字，与主界面页签药丸观感一致）：

```
│ ┌────────┐┌────────┐ │
│ │  目录  ││  摘抄  │ │
│ └────────┘└────────┘ │
```

- 方案 b：顶部 2px 短条（`▔▔▔` 移到按钮上沿，宽度≈文字宽）
- 方案 c：无块无线，仅「主题色 + 加粗」

### D-3 网络搜索浮层形态（需求 5 + 7）

24 个引擎、内置图标集又没有品牌 logo → 纯图标方案已不可行（无法分辨）。

- **方案 a（推荐）** 独立「网络搜索」浮层卡：顶部一行显示将用于搜索的选中文字，下方按 5 类分组的**文字 chip**，超高内部滚动：

```
┌ 网络搜索 ──────────────  ✕ ┐
│ 用选中文字：他抬头望见天边… │
│ 通用搜索                     │
│  [百度] [Bing] [Google]      │
│ 垂直领域                     │
│  [微博][小红书][头条][公众号] │
│  [知乎][B站][抖音][推特][油管]│
│ 特色场景                     │
│  [网盘][电子书][音乐][影视]   │
│ 购物比价                     │
│  [京东][淘宝][拼多多]        │
│ 学术搜索                     │
│  [万方][PubScholar][CNKI]    │
│  [百度学术][Bing学术]        │
└──────────────────────────────┘
```

- 方案 b：紧凑图标层（只放 5 类图标）→ 点类别再出一个该类引擎条（两级下钻，浮层小但多一跳）
- 方案 c：沿用现「二选一 → 引擎图标」形态，只把图标扩到 24 个（**不推荐**：图标重复、分辨不出）

### D-4 AI 卡「自定义提问」（需求 8）

- **方案 a（推荐）** 卡顶两态切换：「解读选段」（走设置页提示词）|「自定义提问」（输入问题，走**内置固定提示词**，把「选段 + 问题」一起发给 AI）：

```
┌ AI 搜索 ────────────────── ✕ ┐
│ [ 解读选段 ][ 自定义提问 ]     │
│ ┌──────────────────────────┐  │
│ │ 针对这段内容提问…（仅右态）│  │
│ └──────────────────────────┘  │
│ 答案区…                       │
│                       [复制]  │
└───────────────────────────────┘
```

- 方案 b：单输入框 + 两按钮（`用提示词搜索` / `按问题提问`）
- 方案 c：单输入框按内容判断（空 = 解读，有内容 = 当问题问）——**语义容易误伤，不推荐**

---

## 3. 已定默认值（可否决项 D-5 ~ D-8）

| 编号 | 项 | 默认取法 |
|------|----|----------|
| D-5 | 「不启用」粒度 | **翻译 / 总结 / 搜索三个下拉各自新增「不启用」项**（可单关某一功能）；选中后该功能调用即提示「已关闭」并返回 null |
| D-6 | 笔记表格开关 | 位置：设置页「数据管理」组；**默认开启**（保持现状）；只影响此后生成/更新的笔记，已存在的笔记不回溯改写 |
| D-7 | 特色场景 4 个入口的站点 | 网盘＝阿里云盘搜索、电子书＝鸠摩搜书、音乐＝网易云音乐、影视＝豆瓣电影搜索（均已 curl 200/302 验证；候选：夸克网盘 / 安娜档案 ×本机不可达 / QQ音乐 / 豆瓣全部） |
| D-8 | 「右键动作条」 | 按**划词动作条**（选中文字后鼠标旁弹出的那条）理解；现动作条与顶栏两处一起改为 书签 · 高亮 · 摘抄 · 翻译 · 网络搜索 · AI搜索 |

---

## 4. 引擎表（需求 7，已 curl 验证）

| 类别 | 引擎 | URL 模板 | 实测 |
|------|------|----------|------|
| 通用 | 百度 | `baidu.com/s?wd={q}` | 302 |
| 通用 | Bing | `cn.bing.com/search?q={q}` | 200 |
| 通用 | Google | `google.com/search?q={q}` | 本机不可达（模板为标准形态） |
| 垂直 | 微博 | `s.weibo.com/weibo?q={q}` | 302 |
| 垂直 | 小红书 | `xiaohongshu.com/search_result?keyword={q}` | 301 |
| 垂直 | 今日头条 | `so.toutiao.com/search?keyword={q}` | 200 |
| 垂直 | 公众号 | `weixin.sogou.com/weixin?type=2&query={q}` | 200 |
| 垂直 | 知乎 | `zhihu.com/search?type=content&q={q}` | 403（反爬拦 curl，浏览器正常） |
| 垂直 | B站 | `search.bilibili.com/all?keyword={q}` | 200 |
| 垂直 | 抖音 | `douyin.com/search/{q}`（路径段） | 200 |
| 垂直 | 推特 | `x.com/search?q={q}` | 本机不可达 |
| 垂直 | 油管 | `youtube.com/results?search_query={q}` | 本机不可达 |
| 特色 | 网盘 | `alipan.com/search?keyword={q}` | 200 |
| 特色 | 电子书 | `jiumodiary.com/search?keyword={q}` | 200 |
| 特色 | 音乐 | `music.163.com/#/search/m/?s={q}` | 200 |
| 特色 | 影视 | `search.douban.com/movie/subject_search?search_text={q}` | 200 |
| 购物 | 京东 | `search.jd.com/Search?keyword={q}` | 200 |
| 购物 | 淘宝 | `s.taobao.com/search?q={q}` | 200 |
| 购物 | 拼多多 | `mobile.yangkeduo.com/search_result.html?search_key={q}` | 200 |
| 学术 | 万方 | `s.wanfangdata.com.cn/paper?q={q}` | 200 |
| 学术 | PubScholar | `pubscholar.cn/search?q={q}` | 200 |
| 学术 | CNKI | `kns.cnki.net/kns8s/defaultresult/index?kw={q}` | 302 |
| 学术 | 百度学术 | `xueshu.baidu.com/s?wd={q}` | 302 |
| 学术 | Bing学术 | `cn.bing.com/academic/search?q={q}` | 200 |

> 抖音是**路径段**（非 query）→ `urlTemplate` 的 `{q}` 替换需容忍此形态（现实现用 `replace('{q}', encodeURIComponent(q))` 即可，无需改）。

---

## 5. 模块规划（拆到可独立执行 / 可测）

| 模块 | 改动 | 测试 |
|------|------|------|
| M1 笔记表格开关 | `Settings.ts` 新增 `noteTable` 字段（append-only，缺省 true）+ 开关行；`noteGenerator.generateNoteMarkdown` 按开关跳过表格段 | `noteGenerator.test.ts` +4（开/关 / 音乐对齐 / 关后「来源」行不渲染） |
| M2 侧栏页签样式 | `styles.css` 仅改 `.rl-reader-toc-tab.active`（D-2 选定形态） | 产物断言（CSS 规则形态 + 反向下划线形态） |
| M3 服务集成分组 | `Settings.ts` 按 D-1 调整 `renderServiceSection` / `createGroupSection` 调用；`createGroupLabel` 形态（若选 a） | 产物断言（①② 分组渲染形态、`1 AI服务` 字样 absent） |
| M4 高亮位移 | `styles.css` + `pure/highlight.ts:highlightMarkCss()`（**同源两处**） | `highlightStyle.test.ts` + 产物断言逐值比对两处（既有机制） |
| M5 引擎表 | `readerSearch.ts`：`SEARCH_ENGINE_GROUPS`（5 类）+ `SEARCH_ENGINES` 扁平派生 + `groupOfEngine` 归一 | `readerSearch.test.ts` 重写（约 +18 例：24 项齐全 / 分组归属 / 模板合法 / 抖音路径形态 / 脏数据回退） |
| M6 网络搜索浮层 | 新 `rl-search-net` 浮层（TXT/EPUB 各一份），替掉 `rl-search-ask` 二选一；`askSearchMode` 删除 | 产物断言（二选一旧形态 absent、浮层分组 5 类、两阅读器各 1） |
| M7 搜索双入口 | 动作条 5→6 按钮、顶栏 5→6 快捷（新增 `netscan` / `aisearch` 两个模式 id）；`dispatchAnnotate` 分派；顺序按 D-8 | 产物断言（顺序链 + 模式计数 + 选中保持高亮：该分支不得出现 `removeAllRanges`） |
| M8 AI 卡自定义提问 | `readerSearch.ts` 新增 `buildSearchQuestionBody(text, question, provider)`（**不读设置提示词**，走内置 `DEFAULT_SEARCH_QUESTION_PROMPT`）；卡片加两态 | `readerSearch.test.ts` +5（不读设置提示词 / 空问题返回 null / 组合 body 形态）；main 新增 `aiAskText(text, question)` 走同一 `chatCompletion` |
| M9 收口 | 文档（内部 CHANGELOG / 进度表 / UI-GUIDE）+ 产物断言 + 三产物部署 + 镜像 | 全链验证 |

**验证链**：`npm run build`（告警对齐 87 基线）→ 受影响单测 → 产物断言 + 突变测试 → 三产物 md5 三方一致 → 部署测试库 → 镜像同步 → 文档。
