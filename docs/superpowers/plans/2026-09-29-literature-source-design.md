# 文学源获取 · 设计（2026-09-29；**当日二次修订**）

> 需求原话：「现在规划文学源获取，参考构建 https://github.com/shiyi-0x7f/o-lib，但**外接源慢慢规划**」
> → 追加：「参考 o-lib 架构，**我这个插件就 gplv3 的**，或者你找找看金标准」。
> 前一份同族文档：`2026-09-28-novel-book-download-design.md`（D-15 ~ D-30 在那里，**本文件接 D-31**）。
> ⚠️ 本文只做**规划**（不写实现）。落码要等决策点被点名。
> 🔧 **修订记录**：初版把「本仓不是 GPL」当成前提，写了「⛔ 不能抄 o-lib 的码」——**那是错的**，
> 本仓就是 `GPL-3.0-only`（见 §2.6）。本版已改正，并补了 §4.5「金标准清单」。

---

## 0. 结论速览（只看这段就够决策）

- **一句话现状**：工具链（检索 → 选书 → 抓章 → TXT/EPUB → 落盘 → 关联、续传、取消、并发）**已经齐了**；
  缺的是「**源从哪来、怎么维护**」——目前只有一条路：**手动挑一个本地 `.json` 文件导入**。
- **关于 o-lib**：它是 **GPLv3**（与本仓**兼容**，可复用其公开代码），但 🔴 **它的源实现根本不公开**
  （私有 crate `olib_api`；被移出的文件含一份 `dev_docs/zlibrary-api-reference.md`）⇒
  **「参考它来构建文学源」在源对接这一层技术上走不通**（不是许可问题，是**拿不到**）。
  可参考的只剩**架构形态**与**功能面**（订阅式线路、一键测速、OPDS）。
- 🔴 **本轮最重要的一条实测发现**：维基文库导出服务（`wikimedia/ws-export`，GPL-2.0-or-later）**公开了一份
  可用的 OPDS 1.2 acquisition feed** —— `https://ws-export.wmcloud.org/opds/en/Ready_for_export.xml`，
  实测 **711 条目 / 2133 个 acquisition 链接**，条目自带 `<rights>CC BY-SA 3.0</rights>` 与
  **EPUB 直链**。⚠️ `/opds/` 下只有 `bn/ en/ fr/ pa/ te/`，**没有 `zh`**。
- **建议**：**甲（源生命周期）+ 乙（OPDS 消费方）都做**，两者**都不内置任何内容源**；
  **丙（内置公版直连）基本可以取消** —— 公版书这条已经被「乙 + 一条现成 feed 地址」覆盖，
  丙 只剩「**中文古籍导出**」这一小块（而且中文那条没有检索，只能让用户给页面名）。

---

## 1. 需求读法

「文学源获取」= **给「文学」（区别于网文）找内容**，拆开是三个子问题：

| 子问题 | 现在有解吗 |
|---|---|
| (A) **源从哪来** | ⚠️ 只有「用户自备 SoNovel `.json`」一条；文学源本身稀缺 |
| (B) **怎么进插件、怎么维护** | ⚠️ 只有「挑本地文件导入」；无订阅、无更新、无体检 |
| (C) 选书 → 抓 → 落盘 → 关联 | ✅ 已完整（#419/#420/#422/#427/#428/#429/#431） |

⇒ 本轮只覆盖 **(A)+(B)**，⛔ 不动 (C)（刚收口）。
「外接源慢慢规划」= 本轮**只做通道能力**，⛔ 不决定接哪些源。

---

## 2. 参考项目核实（`shiyi-0x7f/o-lib`）

### 2.1 它是什么（README 原文要点）

- 「跨平台、永久免费、无广告的**开源图书桌面客户端**」「**第三方客户端 · 仅提供前端界面 · 数据来自外部源**」。
- **Tauri 2**（Rust 后端 + 系统 WebView）+ React/TS/Vite；下载器 **aria2**（随包内置）；**GPLv3**。
- 功能面：搜索 / 下载管理（多线程 + 断点续传）/ **多线路**（服务器线路可选，支持**订阅 / 手动导入 + 一键测速**）/
  **多账号** / 书架收藏 / **局域网共享 + OPDS 目录**（KOReader、静读天下可订阅）。
- 初心原文：「知识不应该被高墙阻隔…绕过**价格、地区、平台**层层挡在门外」。

### 2.2 🔴 决定性事实：它的**源实现不公开**

README 原文：「**为防止项目被滥用，本仓库隐藏了特定数据接口的实现。**公开仓库只包含应用框架与前端界面，
**不含对接外部数据源的接口实现（该部分为独立私有模块）**…**直接克隆本仓库无法开箱即用地构建运行**。」

`dev_docs/architecture-vendor-split.md` 写清了做法：接口实现剥成私有 Cargo crate `olib_api`
（`path = "../vendor/olib-api-plugin-rs"`、`vendor/` 被 gitignore），公开仓库只留 **re-export 薄壳**。
**被移出公开仓库**的文件清单：

```
src-tauri/src/api.rs
src-tauri/src/hosts.rs
data/sites.json
dev_docs/zlibrary-api-reference.md      ← 这一行说明它对接的是什么
```

⇒ 三条结论：① **拿不到源对接实现**（不公开）；② 它对接的是 **Z-Library 那一类**；
③ 它的 `dev_docs/` 公开部分（`lan-server.md` / `plugin-development.md` / `architecture-vendor-split.md`）
可读，有真形态可借鉴（尤其 OPDS 那节）。

### 2.3 可参考 vs 不可参考

| 项 | 能否参考 / 复用 | 说明 |
|---|---|---|
| **宿主 / 源 解耦**（宿主只依赖契约） | ✅ 可**参考** | 我们**已经这么做**（`pure/sourceRule` 规则层 + `services/novelSource` 执行层）；可提炼为「源适配器契约」把多类源统一 |
| **源的订阅 / 手动导入 + 一键测速** | ✅ 可**参考** | 本方案「甲」的形态来源；✅ 订阅地址由用户自备 ⇒ 不内置源 |
| **OPDS 1.2 acquisition feed** | ✅✅ 可**参考** | 公开且完整（§2.4）；本方案「乙」的形态来源 |
| 局域网 OPDS **服务端** | ⚠️ 参考价值有限 | 对桌面插件意义不大（用户在桌面已能看），且要起 HTTP 服务 ⇒ P2 备选 |
| **它的源实现 / `sites.json` / zlibrary 接口** | ⛔ 技术不通 | **不公开**（不是许可问题 —— ⚠️ 初版在这里写错过，见 §2.6） |
| **抄它的公开代码** | ✅ **许可允许** | 🔧 本仓 `GPL-3.0-only`，与它的 GPLv3 **兼容**；⚠️ 但仍要保留其版权声明，且**它公开的多是 Rust/React 宿主代码**，对本插件可直接复用的部分很少 |

### 2.4 OPDS 那节（public，逐字要点）

`dev_docs/lan-server.md`：`GET /opds` = **OPDS 1.2 acquisition feed（Atom XML）**；**无认证**；
仅收录电子书扩展名（`pdf/epub/mobi/azw/azw3/fb2/djvu/cbz/cbr/txt`）；条目标题取**文件名去扩展名**、
按修改时间倒序；获取链接复用 `/download/{filename}`，文件名做 RFC 3986 路径段 percent-encoding；
MIME 按扩展名统一映射；供 **KOReader / 静读天下 / Marvin** 添加为目录源。

⇒ 价值不在「我们也要起服务」，而在**「OPDS 是被主流阅读器当目录源用的标准形态」**：我们做**消费方**时，
面对的就是同一套 Atom 结构（本方案乙）。

### 2.5 ⚠️ 与本仓既有裁定的冲突（必须摆在桌面上）

`2026-09-28-novel-book-download-design.md` 的 **D-25(c)** 明确：用户提及接 **Z-Library** → **不做**，
理由之一即 **Olib / Xlib** 属「代下载」客户端，**⛔ 不接**（同段还列了 `番茄小说下载器/`）。

⇒ 本次「参考 o-lib」**不能默默当成「要接它」**。我按「参考**形态**」处理，并把「要不要改 D-25(c)」
做成显式决策点 **D-36**（⛔ 我不替用户改这条红线）。

### 2.6 🔧 许可对照（**初版在此写错过，特此更正**）

| 项目 | 许可 | 与本仓 `GPL-3.0-only` |
|---|---|---|
| **本仓（ReelLudic）** | **GPL-3.0-only**（`package.json` / `LICENSE` / README 三处一致） | — |
| `shiyi-0x7f/o-lib` | **GPLv3** | ✅ 兼容（同一许可） |
| `edrlab/r2-opds-js` | **BSD 3-Clause** | ✅ 兼容（BSD-3 可并入 GPLv3 工程，保留版权声明即可） |
| `wikimedia/ws-export` | **GPL-2.0-or-later** | ✅ 兼容（可升级到 v3） |
| `calibre-web` | **GPL-3.0** | ✅ 兼容 |

> **更正说明**：初版写道「抄它的代码 ⛔⛔（GPLv3 传染）」，那是**把本仓当成非 GPL 项目**了 —— 错的。
> 正确结论：**许可这一层全线兼容，可复用**；唯一挡住我们的是 **o-lib 的源实现根本没公开**。

---

## 3. 现状盘点（本仓今天已经有什么）

| 面 | 现状 | 出处 |
|---|---|---|
| 源类型 | **只有一类**：SoNovel 格式 `.json` 书源规则（**用户自备**，插件不内置） | #419 / D-26(a) |
| 源分类 | 两类：**网络文学源 / 经典文学源**（`SourceKind`，缺省 novel） | #422 |
| 导入入口 | 设置页「书籍源凭据」两个小节各自的「导入…」；下载弹窗空态 | #421 / #422 / #425 |
| 导入方式 | **只有**「挑一个本地 `.json` 文件」 | #425 |
| 检索取源 | 按条目分类**本类优先、本类为空回退全部** | #422 续四 |
| 体检 | **只有**逐条静态「体检小字」（字段缺不缺） | #419 |
| 执行 | 搜索 → 目录 → 抓章（并发 50 / 断点续传 / 可取消）→ TXT/EPUB → 落盘 → 自动关联 | #419~#431 |
| 明确不做 | 内置任何内容源、绕登录与付费、执行第三方脚本（`@js:` ⇒ `unsupported`） | 红线 D-24(a) |

### 3.1 缺口（本轮要补的）

1. 🔴 **源获取只有一条腿**：必须先有 `.json` 文件。拿到清单后**没法粘贴**、**没法订阅**、**没法更新**。
2. 🔴 **没有「批量体检 / 一键测速」**：一条源还活着没有只能靠一次次真搜去撞（#424 实测 11 条源里 9 条是站点侧失效
   —— 这正是最该被一次性告知的场景）。
3. ⚠️ **格式只有 SoNovel**：生态里量最大的是 **legado**（P1-D 挂账，⏳ 需用户给样本）。
4. 🔴 **只有「规则型」一类通道**：没有**标准协议型**通道（OPDS）—— 而出版书籍（文学主力）大量躺在
   **用户自建书库**（Calibre-Web / Kavita / COPS）与**公版 OPDS 目录**里。

---

## 4. 来源与金标准核实

### 4.1 候选来源可达性实测（2026-09-29，本机）

> ⚠️ 本机网络受限（旧结论「维基媒体系超时」**不准确**，见下）；方法 `fetch(url, {signal: AbortSignal.timeout(9~12s)})`，
> 每项至少两轮。

| 来源 | 结果 | 说明 |
|---|---|---|
| `www.gutenberg.org`（站点 / 搜索页 / 章节正文） | ✅ 200 | 搜索页 `?query=` 可用 ⇒ 可解析 HTML 拿书 id |
| 古腾堡 **EPUB 直链**（`ebooks/<id>.epub.noimages`、`cache/epub/<id>/pg<id>.epub`） | ✅ 200 `application/epub+zip` | **一次请求拿整本 EPUB**（无需书源规则） |
| `ws-export.wmcloud.org`（维基文库**导出服务**）`?lang=zh&format=epub&page=<页面名>` | ✅ 200 `application/epub+zip`（两轮） | 中文古籍最实用的一条 |
| 同上 **`format=txt`** | ❌ **稳定超时（两轮）** | 🔴 **不是抖动**：`ws-export` 的 txt/pdf/rtf/mobi 都要服务端装 **Calibre `ebook-convert`**（README 明写）⇒ 只走 `epub` |
| **`ws-export.wmcloud.org/opds/<lang>/…`（OPDS feed）** | ✅✅ **200 `application/xml`** | 见 §4.2 |
| `standardebooks.org`（站点） | ✅ 200 | 只有英文；`/opds`、`/opds/all` 返回 **401**（待查） |
| `gutendex.com`（古腾堡 JSON API） | ❌ 超时 | ⇒ 只能走站点搜索页解析 |
| `zh.wikisource.org` / `zh.m.wikisource.org`（维基文库**本体**） | ❌ 超时 | ⇒ 做不了页面级检索 |
| `api.wikimedia.org` | ❌ 超时 | 同上 |
| `openlibrary.org` / `archive.org` | ❌ 超时 | 与 #417 撤掉 Open Library 那轮一致 |

**这张表决定的形态**：公版侧确实是「**一次请求拿整本成品**」（古腾堡 + 维基导出都是），
⛔ 与网文那套「规则引擎 + 抓章」**不是一种形态**，别硬塞进同一个抽象。

### 4.2 🔴 关键发现：维基文库导出服务**公开了一份可用的 OPDS feed**

`wikimedia/ws-export`（GPL-2.0-or-later）的 CLI 有 **`app:opds`** ⇒ 服务端把按语言/分类生成的 OPDS
文件放到 `/opds/<lang>/`。实测：

```
https://ws-export.wmcloud.org/opds?lang=zh      → Apache 索引，**只有 bn/ en/ fr/ pa/ te/（没有 zh）**
https://ws-export.wmcloud.org/opds/en/          → 里面是 Ready_for_export.xml
https://ws-export.wmcloud.org/opds/en/Ready_for_export.xml
    200 application/xml · 1,132,091 B · <updated>2026-09-29（当天）
    <entry> 711 个 · <link> 3630 个 · opds-spec.org/acquisition 2133 个
```

单条 entry 的实际形状（原文摘录）：

```xml
<entry xml:lang="en">
  <title>’Tis Sixty Years Since</title>
  <id xsi:type="dcterms:URI">https://en.wikisource.org/wiki/%27Tis_Sixty_Years_Since</id>
  <rights>http://creativecommons.org/licenses/by-sa/3.0</rights>     ← 开放授权，写在 feed 里
  <author><name>…</name></author>
  <dc:language xsi:type="dcterms:RFC4646">en</dc:language>
  <dcterms:issued xsi:type="dcterms:W3CDTF">1913</dcterms:issued>
  <link rel="alternate" type="text/html" href="https://en.wikisource.org/wiki/…"/>
  <link rel="http://opds-spec.org/acquisition" type="application/epub+zip"
        href="https://ws-export.wmcloud.org/?lang=en&amp;format=epub&amp;page=%27Tis_Sixty_Years_Since"/>
  <link rel="http://opds-spec.org/acquisition" type="application/x-mobipocket-ebook" href="…"/>
</entry>
```

⇒ 含义三条：
1. **「乙」的 OPDS 通道一上线，公版书这条就直接覆盖了**（feed 地址由**用户**填 ⇒ ⛔ 不是我们内置内容源，
   与 D-24(a)/D-25(a) 都不冲突）。
2. 条目自带 `<rights>`（开放授权）与 **`application/epub+zip` 直链** ⇒ 拿到的就是成品，插件侧已有 EPUB 阅读器，**拿到即读**。
3. ⚠️ **中文没有这条 feed**（`/opds/` 下无 `zh`）⇒ 中文公版只能走「**用户给页面名**」的导出那条（§4.1 实测 200）。

### 4.3 金标准清单（逐条核实）

| # | 项目 | 它是什么（核实到的事实） | 许可 | 对本规划的价值 |
|---|---|---|---|---|
| 1 | **`edrlab/r2-opds-js`**（Readium） | **OPDS 1（XML/Atom 反序列化）+ OPDS 2（JSON）+ OPDS1→2 转换器**的 **TypeScript** 实现；npm 包 `r2-opds-js` v1.0.47；依赖 `xmldom` + `r2-utils-js`；⚠️ 官方注明**只支持 Node 运行时、不支持浏览器**（我们用 Electron 的 Node 侧 ⇒ 正好） | **BSD-3-Clause** | 🔴 **OPDS 解析的真金标准**。⚠️ 但它是**重依赖**（TA-JSON 工厂注册那套），要不要引见 **D-37** |
| 2 | **OPDS 规范本身 + 作者背书** | OPDS 邮件组里，规范作者 Hadrien Gardeur 亲自回复「**推荐用 2.0**（已稳定多年、生产上大多用它）」，并点名 TS 解析器就是 Thorium 用的 `r2-opds-js`；`readium/ts-toolkit` 将来也会有 OPDS 解析器（无 ETA） | 规范文档 CC | 定「**优先 OPDS 2（JSON）**，但现实里 1.2（Atom）存量更大 ⇒ 两种都得能吃」 |
| 3 | **`calibre-web`** | 自托管 Calibre 书库的 Web 前端（**17.9k★**），`/opds` 输出 OPDS feed，**多用户 + 细粒度权限**，在线读 EPUB/PDF，中文界面齐全 | **GPL-3.0** | 🔴 **我们做消费方时要面对的现实格式**（用户自建库第一大来源）。它的「用户管理 + 权限」也解释了为什么 OPDS 目录**可能带 Basic 认证**（⇒ 源记录要能存用户名密码，见 B2） |
| 4 | **`wikimedia/ws-export`** | 就是 `ws-export.wmcloud.org` 的源码（PHP/Symfony）；`app:export -t <页面名> -f <format>`（**默认 `epub-3`**）；**`app:opds`** 生成 OPDS；txt/pdf/rtf/mobi 依赖 **Calibre `ebook-convert`** ⇒ 解释了 §4.1 的「epub 通 / txt 挂」 | **GPL-2.0-or-later** | 🔴 定义了这条通道的**真实契约**与**限制**（这也是 §4.2 那份 feed 的来源） |
| 5 | **KOReader / Thorium 的 OPDS 客户端实现** | o-lib 的 LAN 服务端明写「供 KOReader、静读天下、Marvin 添加为目录源」；Thorium(Readium) 用 `r2-opds-js` | KOReader GPL-3.0 / Thorium BSD-3 | **健壮性参考**：现实 feed 常有缺 `<link>`、相对 URL、多重 acquisition、Basic 认证 ⇒ 解析要宽容 |
| 6 | `standardebooks.org` | 站点可达；`/opds` 与 `/opds/all` 返回 **401**（待查）；只有英文；出**规范级** EPUB | 站点内容 CC0/PD | ⚠️ 暂列观察项，别写进方案 |
| 7 | `shiyi-0x7f/o-lib` | §2 已核实：**源实现不公开**；可参考的只有订阅/测速/OPDS 形态 | GPLv3 | 形态参考（不涉及源对接） |

---

## 5. 三个方案（**建议已按金标准核实结果调整**）

### 甲 · 源生命周期增强（不内置任何源）

```
现在   设置 › 书籍源凭据 › 网络文学源/经典文学源   [导入…] → 系统文件框 → 一个 .json
目标                                        ┌ 导入…
                                            ├ 订阅地址（粘一个 URL → 拉清单 → 一键导入/更新）
                                            ├ 粘贴 JSON（直接贴文本，不用先存文件）
                                            └ 一键体检（批量测：连得上吗 / 多少毫秒 / 搜得到几条）
```

- 「订阅」= **用户自备一个返回源清单的地址**；插件只负责拉取与合并（`mergeSources` 已有「同站点算更新、
  保留用户启停」的语义，✅ 直接复用）。
- 「一键体检」= 对每条源发一次**最小代价**请求（建议：真搜一个固定词），记「可达 / 时延 / 条数」，
  写回源行小字并给总结；⚠️ 必须并发上限 + 超时 + **可中断**（复用 #428 的 `CancelToken`）。
- 顺带把 P1-D 的 **legado 适配 / 源更新**收进来。

✅ 不碰红线 ｜ ✅ 直接解「源维护」 ｜ ❌ 对「源供给不足」只算间接

### 乙 · OPDS 消费方（标准协议通道）——**🔴 本轮建议提为 P0**

新增**第二类源**：一个 OPDS 目录地址（**用户自备**）当作「一个源」，浏览/检索 → 取 acquisition 链接 → 直接下 EPUB/TXT。

- 面对**标准 Atom/OPDS**（1.2 存量为主，2.0 是 JSON）⇒ **不需要书源规则引擎**（没有选择器、没有 `@js:`、没有脚本）。
- 覆盖两类场景：
  ① **用户自建书库**（Calibre-Web / Kavita / COPS）；
  ② **公版目录** —— §4.2 那条维基文库 feed 就是现成的（**用户粘地址即可**，⛔ 我们不预置）。
- UI 复用「选书 → 详情 → 下载」骨架，但 OPDS 是**成品文件**（没有章节概念）⇒ 详情卡退化成
  「格式 / 大小 / 下载」，章节范围那一段隐藏。
- 🔴 **必须支持 Basic 认证**（Calibre-Web 那类目录常常要登录）⇒ 源记录要能存用户名/密码（见 B2）。
- 解析健壮性（照金标准 #5 的坑）：缺 `<link>`、相对 URL、多个 acquisition、`type` 缺失、
  `rel` 用了 1.2 与 2.0 两种写法都要能吃。

✅ 不内置任何源（地址用户自备）｜ ✅ 标准协议、零脚本、零规则解析（红线最舒服的一类）
✅ **一条能力同时覆盖「自建库」与「公版英文」**（金标准核实后这条性价比最高）｜ ⚠️ 成本中等

### 丙 · 内置「开放授权直连」——**建议取消，只保留一小块**

原意是把 §4.1 实测可达的两条做成**内置**通道（古腾堡搜索 → EPUB 直链；维基导出 → 页面名）。

- 🔴 **公版英文这一块已被「乙」覆盖**（§4.2 那条 feed），再做一遍是重复建设。
- **只剩「中文古籍导出」**：`?lang=zh&format=epub&page=<页面名>`（实测 200）。
  ⚠️ 但**中文没有检索入口**（维基本体 / api.wikimedia / gutendex 全不可达）⇒ 体验是
  「用户自己知道页面名，贴进来」。
- 且它**直接推翻 D-25(a)**（「不内置内容源」）⇒ 若要做，建议退化成
  **「在设置页给一个『一键填入维基文库 feed 地址』的便利入口」**（⛔ 不预置、不自动添加，用户点了才写进去）。

### 对比表

| | 甲 源生命周期 | 乙 OPDS 消费方 | 丙 内置公版直连 |
|---|---|---|---|
| 碰红线 | 不碰 | 不碰 | ⚠️ 与 D-24(a)/D-25(a) 冲突 |
| 对「文学」的直接增益 | 中（维护向） | **高**（自建库 + 公版) | 低（已被乙覆盖大半） |
| 是否内置内容源 | ⛔ 不 | ⛔ 不 | ✅ 会 |
| 只靠用户自备 | 订阅地址 / JSON | 目录地址 | 无 |
| 新增解析器 | 无 | OPDS（Atom / JSON） | 古腾堡搜索页 HTML |
| 成本 | 小~中 | 中 | 小（但重复） |
| **建议** | **P0** | **P0（提级）** | **取消**（退化成一条「便利入口」，见 D-33） |

---

## 6. 模块规划（甲 + 乙 同批）

### P0-A · 源生命周期（4 个模块）

| # | 模块 | 层 | 边界（⛔ 不越界） |
|---|---|---|---|
| A1 | `pure/sourcePack.ts`（新） | 纯逻辑 | **源清单**解析 + 与现有 `SourceRecord[]` 的**合并决策**（新增/更新/保留启停/算差异）；复用 `sourceRule.mergeSources` 语义，⛔ 别另写一套 |
| A2 | `services/sourceFetch.ts`（新） | 服务 | 拉订阅地址（走 `nodeHttp`）+ 超时 + **大小上限**（⛔ 别让一个超大 JSON 吃光内存） |
| A3 | `pure/sourceCheck.ts`（新） | 纯逻辑 | 体检结果的**汇总口径**（可达 / 时延分档 / 条数 / 失败归因复用 `novelFailText`） |
| A4 | 设置页「书籍源凭据」 | UI | 两个小节各加「订阅…」「粘贴导入」「一键体检」；结果写回源行小字；⛔ 不动现有「导入…」的位置与文案 |

### P0-B · OPDS 消费方（4 个模块）

| # | 模块 | 层 | 边界 |
|---|---|---|---|
| B1 | `pure/opds.ts`（新） | 纯逻辑 | Atom/OPDS 解析：navigation feed ↔ acquisition feed、`rel` 两种写法、`type` → 格式、相对 URL 绝对化、分页；**⛔ 不碰网络、不碰 DOM**（DOM 交给 `services/htmlQuery` 那层已有的 `DOMParser` 惯例） |
| B2 | `pure/opdsSource.ts`（新） | 纯逻辑 | OPDS 源的**记录形态**（地址 / **Basic 用户名密码** / 命名 / 与 `SourceKind` 的关系 / 存哪） |
| B3 | `services/opdsFetch.ts`（新） | 服务 | 拉 feed（复用 `nodeHttp`，含 Authorization 头）+ 下载 acquisition 文件（复用 `writeBinaryFile` 的逐层补目录） |
| B4 | 弹窗 / 设置页 UI | UI | 「目录源」列表 + 浏览（上一级/下一级）+ 选一个成品 → 下载 → 自动关联 `bookFile` |

### P2 · 备选（明确不做 / 以后再说）

- 局域网 OPDS **服务端**（把库分享给 KOReader）—— 对桌面插件价值有限。
- 丙 若坚持要做中文古籍：建议**独立一类通道**，⛔ 不塞进书源规则引擎（§4.1 已说明形态不同）。

⚠️ **共同前置**：`SourceKind` 是**内容分类**（文学/网文），OPDS 是**协议** ⇒ 新开
`sourceProtocol: 'rule' | 'opds'` 维度，⛔ 别把 OPDS 塞进 `SourceKind`（会污染检索过滤那套语义）。

---

## 7. 决策点（D-31 ~ D-37，等点名）

| 编号 | 待裁定 | 选项 | 我的建议 |
|---|---|---|---|
| **D-31** | 本轮做哪几件 | (a) 只甲 ／ (b) **甲+乙** ／ (c) 只乙 ／ (d) 甲乙丙 | **(b)**：核实完金标准后，乙 的性价比已高于丙 |
| **D-32** | 「订阅」清单收哪种格式 | (a) 我们自定义最简 JSON ／ (b) **兼容社区 `repository.json` 形态** ／ (c) 两者都收 | **(b)+宽松解析**（用户手上有现成清单，能直接用最有价值） |
| **D-33** | 🔴 公版这块怎么做 | (a) **不做内置**，只在文档/UI 里给「一键填入维基文库 feed 地址」的便利入口 ／ (b) 内置古腾堡 + 维基导出 ／ (c) 连便利入口也不给 | **(a)**：既解决开箱可用性，又⛔ 不真的内置内容源（D-24(a) 不动）；⚠️ 中文那条**没有检索**，只能贴页面名 |
| **D-34** | 源的「协议」维度放哪 | (a) 扩 `SourceKind` ／ (b) **新增 `sourceProtocol`** | **(b)** |
| **D-35** | 「一键体检」打到什么程度 | (a) 只 ping 首页 ／ (b) **每源真搜一个固定词** ／ (c) 两者可选 | **(b) + 并发上限 + 可中断**（复用 `CancelToken`） |
| **D-36** | 🔴 是否修 **D-25(c)**（Olib / Z-Library / Xlib 不接） | (a) **不改** ／ (b) 改 | **(a)**：它的源实现**不公开**，技术上也无从「参考实现」 |
| **D-37** | OPDS 解析：自研 vs 引库（新增） | (a) **自研最小解析**（只吃我们需要的字段，零新依赖） ／ (b) 引 **`r2-opds-js`**（BSD-3，官方实现，但拖 `xmldom` + `r2-utils-js` 一串） | 倾向 **(a)**：本仓从不为了「协议完整性」加依赖（网文侧就是自研的规则引擎）；⚠️ 如果将来要支持 OPDS **2.0 JSON** + LCP 之类，再考虑 (b) |

---

## 8. 红线自查

| 红线 | 甲 | 乙 | 丙（若做） |
|---|---|---|---|
| 不内置任何内容源（D-24(a)） | ✅ | ✅ | ⛔ 会内置（须 D-33 放行） |
| 不绕登录 / 付费 | ✅ | ✅（Basic 认证**由用户提供自己的凭据**，不是绕） | ✅（公版） |
| 不执行第三方脚本 | ✅ | ✅（OPDS 是**数据**不是脚本） | ✅ |
| 许可合规 | ✅ | ✅ | ✅（全线兼容，见 §2.6） |

---

## 9. 下一步

1. 点名 **D-31 ~ D-37**（其中 **D-33 / D-36** 与红线相关，我不替你决定）。
2. 点名后只做被选中的部分，按本仓门禁收口（tsc → 受影响单测 → 断言 → 突变 → 三产物 md5 → 部署 → 文档）。
3. ⏳ 旧账：**P1-D**（legado 适配 + 书源更新；⚠️ 需用户给 legado `.json` 样本）—— 建议并进「甲」。
4. 探针脚本留在仓里：`_probe_opds.cjs`（复跑一次就能确认 §4.2 那份 feed 还在不在、条目数有没有变）。
