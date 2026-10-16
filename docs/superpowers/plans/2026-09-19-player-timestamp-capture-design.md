# 播放器：时间戳插入 + 点击跳转 + 一键截图（设计）

> 状态：**已实施**（2026-09-19；用户裁定见 §6 决策结果）
> 触发：用户 2026-09-19 —— 「做**时间戳插入 + 点击跳转 + 一键截图**：① 在笔记中插入一个时间戳格式，例如 `[00:03](video://filename?t=3)`；② 当用户在笔记中点击这个链接时，**右侧/中央的视频播放器自动跳转到 00:03 并播放**；③ **截图捕捉**：同样一键即可截取当前视频帧，并自动保存到对应视频笔记中，同时附带回跳源视频的时间戳链接，方便图文对照」
> 关联资产：`docs/superpowers/plans/2026-09-17-reader-traceability-design.md`（#323 读者侧深链，本设计沿用同一套基础设施）

---

## 0. 需求拆解（三件事，可独立交付）

| 编号 | 需求 | 验收口径 |
| --- | --- | --- |
| **R1** | 时间戳插入 | 播放器里**一键**把「当前时刻」写成笔记里一条可点链接 |
| **R2** | 点击跳转 | 在笔记里点那条链接 → 播放器**跳到该时刻并播放**（已开着就复用，不开就打开） |
| **R3** | 一键截图 | **一键**抓当前帧 → 存进**对应视频条目笔记** → 附带**回跳该时刻的时间戳链接**（图文对照） |

---

## 1. 生态金标准检索（流程①）

### 1.1 结论：这件事的生态标准就是 **Media Extended**（332k 下载，Obsidian 官方社区插件页仍在维护）

它的功能集与用户三点需求**几乎逐条对应**：

| Media Extended 的能力 | 对应本需求 |
| --- | --- |
| *Timestamped Notes*：一键/命令插入指向媒体某时刻的链接，**点击跳到该时刻** | **R1 + R2** |
| *Screenshot Capture*：从视频抓图，可裁剪，**把图嵌进笔记并带回跳源视频的时间戳链接** | **R3**（原话逐字对应） |
| 三入口：命令面板 `Get timestamp from player` / 快捷键 `⌘/Ctrl+T` / **媒体视图标题栏 ⭐ 按钮** | 入口设计的参照 |
| 时间戳写成 **W3C Media Fragment URI**：`[文字](file.mp4#t=<start>[,<end>])`，时间可写秒数（`121.12`）或 `分:秒` / `时:分:秒` | **链接形态的参照**（见 §1.2） |
| 时间戳模板可自定义 | 列为「本期不做」（D-7） |

参考：社区插件页 <https://community.obsidian.md/plugins/media-extended>、v3 源码 README <https://github.com/aidenlx/media-extended>（v4 起闭源，v3 仍 MIT）、Media Fragment 规范 <https://www.w3.org/TR/media-frags/#naming-time>。

### 1.2 对用户提议 `[00:03](video://filename?t=3)` 的核实（**方向对、scheme 不可行**）

✅ **采纳**：链接里带秒数（`t=3`）+ 标签写 `[00:03]` —— 与生态标准同构，且项目已有 `pure/player.formatTime` 能直接产出 `m:ss` / `h:mm:ss`。

❌ **`video://` 这个 scheme 不可行**，三条独立原因：

1. **插件注册不了 OS 级自定义协议** —— `app.setAsDefaultProtocolClient` 是 Electron **主进程**能力，插件只跑在渲染进程。**同款提议上一批（#323）已经踩过一次**：用户当时提 `myreader://`，核实结论相同。
2. **不注册 scheme 的链接在 Obsidian 里是「死链」**：未知协议会被交给系统处理 → 打开失败 / 无反应；点击拦截一旦未命中就没有任何兜底。
3. **生态标准不是自造 scheme，而是把 `#t=` 挂在真实文件链接上**（Media Fragment）—— 用标准形态的好处是**别的工具也能认**（Obsidian 原生、将来其他插件、导出后仍可读），自造 scheme 只有本插件认。

⇒ 改用 **§4.1 的形式**（库内走 Media Fragment，库外走本插件深链）。

---

## 2. 现有资产核查（先看有什么，别重复造）

| 资产 | 位置 | 本次怎么用 |
| --- | --- | --- |
| **深链真源** | `pure/readerLink.ts`（#323：前缀 `obsidian://reelludic?` + host 严格比对 + id 白名单 `/^[\w-]+$/`） | 扩一个 `action=video` 分支，**复用同一前缀与校验**（不新造第二套 scheme 解析） |
| **点击拦截** | `main.onWorkspaceAnchorClick`（document 捕获阶段，先认深链再认块锚点） | 加两个识别分支：`#t=` 的库内媒体链接、视频深链 |
| **时间格式化** | `pure/player.formatTime`（`m:ss`，满 1h 转 `h:mm:ss`） | 时间戳标签 `[00:03]` |
| **区段追加（泛型）** | `pure/excerpt.appendExcerptToNote(noteMd, md, section = '摘抄')` —— section 是**参数**，建区段/追加/保序都现成 | 截图块与时间戳块的落笔复用同一条通道 |
| **二进制落盘** | `main.ts:3224` 封面下载用的 `vault.createBinary` | 截图 PNG 落盘 |
| **播放器打开 / 复用** | `main.openVideoPlayer(opts)`（活动叶已是播放器 → 换片复用，否则新开标签页） | 深链定位复用同一入口 |
| **播放位置通道** | `initialPositions` / `onSavePosition`（`catalog.videoPositions`，键=集下标） | 定位注入可与之并排（新加 pending seek） |
| **快捷键真源** | `pure/player.resolveKeyAction`（唯一真源） | 加两个键位，自动被两处调用方继承 |
| **区段命名先例** | 笔记模板已有 `## 个人评语` / `## 游玩记录` / `## 观看链接`；封面目录叫 `封面/` | 新区段/目录命名风格参照 |

---

## 3. 可行性实测（**先验证再设计**，不是推测）

### 3.1 🔴 抓帧会不会被 canvas 污染 —— **不会**（本设计最关键的一条）

- 播放源是 **`app://` URL**（库内 `getResourcePath`；库外 `app://local/<编码绝对路径>`）→ 相对应用页 `app://obsidian.md` 属**跨源**；跨源 `<video>` 直接 `drawImage` 会**污染 canvas** → `toBlob/toDataURL` 抛 `SecurityError`。
- **实测 Obsidian 1.13.7 的 asar**：资源协议处理器在响应里设置了

  ```
  Content-Length / Last-Modified / Access-Control-Allow-Origin: * /（仅 HTML 加 X-Frame-Options: DENY）
  ```

- ⇒ 只要给 `<video>` 加 **`crossOrigin = 'anonymous'`**（**必须在设 `src` 之前赋值**），响应头就能被 CORS 校验通过 → **`drawImage` + `toBlob` 不污染** ✅
- ⚠️ 记一条**回归风险**：`crossorigin=anonymous` 在**没有 ACAO 的远程 http 源**上会让**加载直接失败**。本期播放源全是 `app://`（库内/库外本地文件）→ 安全；将来若支持 http 远程视频，必须**按源类型分支**设置。

### 3.2 落盘 ✅ 已有先例（封面下载走 `vault.createBinary`），无需新依赖。

### 3.3 定位 ✅ `openVideoPlayer` 已支持「复用活动叶 + 指定起始项」，只需再加一个 **pending seek 秒数**（与阅读器的 `pendingTargetId` 同款手法）。

### 3.4 图标名 ✅ 已用 `_probe_lucide.cjs` 对着 `obsidian-1.13.7.asar` 核实：`clock` / `camera` / `image` / `link-2` / `crop` 都在（本期用 `clock` + `camera`）。

---

## 4. 方案（逐项选择题，附推荐）

### 4.1 时间戳链接形态

| 方案 | 库内视频 | 库外视频 | 评价 |
| --- | --- | --- | --- |
| **Ⓐ 生态标准双轨**（推荐） | `[00:03](影片.mp4#t=3)` | `[00:03](obsidian://reelludic?action=video&entry=<entryId>&ep=<集下标>&t=3)` | 库内走标准（别的工具也认）；库外走深链（**库外文件写不出 wikilink，这是 #323 已确认的死结**）。与 #323「方案 A 双轨」同款取向 |
| Ⓑ 统一深链 | 一律 `obsidian://reelludic?…` | 同左 | 一致、简单；但库内视频失去生态可识别性 |
| Ⓒ 用户原案 `video://…` | — | — | ❌ 不可行（§1.2） |

### 4.2 时间戳插到哪个笔记

| 方案 | 说明 | 评价 |
| --- | --- | --- |
| Ⓐ 视频条目笔记 | 与「摘抄 → 书笔记」同模型，零歧义、可自动建区段 | 适合「看完整理」；不适合边看边在别处记 |
| Ⓑ **上一个活动的 Markdown 编辑器光标处** | Media Extended 的做法（分屏：左视频右笔记） | **时间戳的真实用途多半是这个**（在观后感里引用某时刻） |
| **Ⓒ 都要**（推荐） | 优先插到最近的 Markdown 编辑器；没有则回落条目笔记并提示 | 两种场景都覆盖；代价是要跟踪「最近活动的编辑器」（`active-leaf-change` 记录） |

### 4.3 截图块的笔记形态（象形）

```
Ⓐ callout 家族（与摘抄同族）           Ⓑ 极简两行（推荐）
> [!example] 00:03 [↩ 回到视频](…)     ![[截屏 影片名 00-03.png]]
> ![[截屏 影片名 00-03.png]]           [00:03](…) · 回到视频
```
| 方案 | 评价 |
| --- | --- |
| Ⓐ | 与摘抄块气质一致、可折叠、回跳显眼；但截图本身就是「看图」，套框略重 |
| **Ⓑ（推荐）** | 最短、阅读视图里图直接铺开；回跳链接紧随其下，图文对照最直接 |

### 4.4 截图文件落点

| 方案 | 说明 |
| --- | --- |
| **Ⓐ 跟随用户 Obsidian 附件设置**（`fileManager.getAvailablePathForAttachment`）（推荐） | 尊重用户在 Obsidian 里设的附件目录；重名自动加序号 |
| Ⓑ 固定 `截图/` | 与项目 `封面/` 的中文化目录风格一致，但不跟随用户设置 |

### 4.5 入口（「一键」的落点）

- 控制条**右侧功能组**加两个**纯图标按钮**（现有：选集 · 倍速 · 字幕 · 音量 · 齿轮 · 全屏）：
  - `clock` → 「插入时间戳」
  - `camera` → 「截取当前帧」
- 快捷键（走 `pure/player.resolveKeyAction` 单一真源）：`Ctrl/⌘ + T` 插入时间戳、`Ctrl/⌘ + Shift + S` 截图
- 命令面板各挂一条（便于不改键位时也能用）

### 4.6 本期**不做**（明确划界）

- 截图**裁剪**（Media Extended 有；需要一套框选 UI，成本高）
- 时间**范围片段** `#t=start,end`（播放器无片段播放语义）
- 时间戳**模板自定义**（Media Extended 有；本期格式固定）
- 字幕时间戳批量导出

---

## 5. 模块规划（拆到可独立执行 / 可测）

| # | 落点 | 内容 | 可测性 |
| --- | --- | --- | --- |
| M1 | `src/pure/videoLink.ts`（新） | `formatStamp(sec)`（`m:ss` / `h:mm:ss`）、`parseMediaFragment(hash)`（`#t=` 秒数，含非法值防护）、`buildVideoTimeLink({entryId, url?, filePath?, ep, sec})`（**双轨**产出）、`parseVideoTimeLink(href)`（库内 Media Fragment / 库外深链两种都认；不是视频链接 → `null`） | 纯逻辑，单测全覆盖（脏值 / 边界 / 往返） |
| M2 | `src/pure/readerLink.ts`（扩） | `parseReaderDeepLink` 支持 `action=video`（返回判别联合 `{kind:'excerpt'\|'video'}`）；**前缀/host 校验/id 白名单仍单一真源** | 单测 + #323 旧断言须保持绿 |
| M3 | `main.onWorkspaceAnchorClick`（扩） | 识别「库内媒体 `#t=` 链接」与「视频深链」→ `openVideoAt({entryId, ep, sec})`；命中即 `preventDefault + stopPropagation`；**未命中一律放行**（不吞普通链接） | 产物断言：拦截体内新增两分支 + 反向守卫「不得无差别拦截」 |
| M4 | `main.openVideoAt`（新） | 反查条目 → 复用/打开播放器 → 注入 `pendingSeek { index, seconds, play: true }` | 产物断言 + 手工验证 |
| M5 | `VideoPlayerView`（扩） | ① `crossOrigin='anonymous'`（**设 src 之前**）；② `consumePendingSeek()`（`loadedmetadata` 后定位并播放）；③ 两个按钮 + 快捷键 + 命令；④ `captureFrame()`：`canvas.drawImage` → `toBlob('image/png')` → `arrayBuffer` → 回传宿主落盘；⑤ 成功/失败 Notice（句式与摘抄一致） | 产物断言（crossOrigin 赋值时机须在 `src` 之前 —— 反向守卫） |
| M6 | `EntryService`（扩） | `addVideoStamp(entryId, md)` / `addVideoShot(entryId, md)`：复用 `appendExcerptToNote(…, section)` 建「截图」/「时间戳」区段；写盘后返回 `count` 供提示 | 单测（用 memIO，与摘抄测试同款） |
| M7 | `Settings` / UI-GUIDE | 无需新设置项；UG 记 v54（入口 + 块形态 + 双轨口径 + crossOrigin 纪律） | — |
| M8 | 验证链 | 受影响单测 → 产物断言（+新守卫）→ 断言级突变（≥4 处）→ 构建 → md5 三方一致 → 部署 | 照既有流程 |

**命名与真源纪律**：链接前缀/host/白名单**只在 `readerLink.ts` 一处**；视频链接的**构造与解析都走 `videoLink.ts`**，宿主与视图都不自己拼字符串（防两处漂移）。

---

## 6. 待裁定决策点

### 6.1 决策结果（2026-09-19 已裁定）

| 编号 | 用户裁定 | 落地 |
| --- | --- | --- |
| **D-1** | **Ⓐ 生态标准双轨** | 库内 → `[0:03](影片.mp4#t=3)`（Media Fragment）；库外 → `obsidian://reelludic?action=video&entry=&ep=&t=` |
| **D-2** | **Ⓒ 都要** → ⚠️ **已被 2026-09-19 报障后的定稿取代** | 首版按 Ⓒ 插到「最近 Markdown 编辑器光标处」；**用户实测报障**（Live Preview 把光标所在行渲染成源码 → 刚插的链接点不动）→ 定稿改为**统一写条目笔记 + 写入前先把该笔记开在分屏**，`lastMdLeaf` 与 `active-leaf-change` 跟踪整体删除。详见 §8.2 |
| **D-3** | **Ⓑ 极简两行** | `![[截屏 片名 0-03.png]]` + `[0:03 · 回到视频](链接)` |
| **D-4** | **Ⓐ 跟随附件设置** | `fileManager.getAvailablePathForAttachment` + `vault.createBinary` |
| **D-5** | 设计方定（用户未指定）：**两个区段** | `## 时间戳`（纯时间戳）/ `## 截图`（截图块），与 `## 摘抄`/`## 游玩记录` 同风格 |
| **D-6** | **改为「顶栏右上角」**（用户指定，非原推荐的控制条右侧） | `.rl-vp-bar` 内 `.rl-vp-tools`；快捷键 **`T`/`S`（裸字母）**；命令面板两条 |
| **D-7** | 确认**不做**四项 | 裁剪 / 时间范围片段 / 模板自定义 / 字幕时间戳导出 均未做 |

### 6.2 原清单（存档）

- ~~D-1 链接形态~~ / ~~D-2 插入目标~~ / ~~D-3 截图块形态~~ / ~~D-4 截图落点~~ / ~~D-5 区段名~~ / ~~D-6 入口~~ / ~~D-7 本期不做~~ —— 均已裁定，见 6.1。

---

## 8. 实施结果（2026-09-19）

| 模块 | 落点 | 要点 |
| --- | --- | --- |
| M1 | `src/pure/videoLink.ts`（新） | `parseSecondsText` / `parseMediaFragmentTime` / `buildTimeLink`（双轨）/ `parseTimeLink`（**带 scheme 的外链一律不接管**）/ `shotFileName` / `buildShotBlock`；TDD 20 例 |
| M2 | `src/pure/readerLink.ts`（扩） | 抽出 `parseDeepLinkParams` / `deepLinkParam` / `isDeepLinkId` —— 前缀与 host 校验**仍是单一真源**，`jump` 与 `video` 两个 action 共用 |
| M3 | `main.onWorkspaceAnchorClick` | 新增视频分支 `parseTimeLink(dataHref) ?? parseTimeLink(href)`（库内目标在 `data-href`） |
| M4 | `main.openVideoAt` + `videoPathTarget` | 同条目播放器已开着 → `seekToEpisode`；否则 `openEpisodeLocal(entry, idx, seconds)` 注入 `pendingSeek` |
| M5 | `VideoPlayerView` | 顶栏右上角两钮（`clock`/`camera`）+ 裸字母键 `T`/`S` + `crossOrigin='anonymous'`（**设 src 前**）+ `consumePendingTarget`（与续播互斥）+ `captureFrame`（readyState 保护）+ `seekToEpisode`/`playingEntryId` |
| M6 | `EntryService.appendNoteSection` + main 两个回调 | 泛型区段追加（笔记只经 EntryService 写）；`insertVideoStamp`（编辑器优先）/ `saveVideoShot`（落盘 + 写 `## 截图`） |
| M7 | UI-GUIDE **v54** + 本文件 + 双层 CHANGELOG | 新增 §9.2（入口/双轨/块形态/抓帧两前提/定位互斥） |
| M8 | 验证链 | 单测 232/232；产物断言 **1103 PASS / 0 FAIL / CRASH=false**（+23）；**突变 5/5 全抓**；md5 三方一致 + 已部署 |

### 8.1 实施期新增/修正的认知

1. **`crossOrigin` 的赋值时机**：必须在设 `src` **之前**（元素创建处），否则即使响应带 ACAO 也不生效 —— **已有产物断言钉「赋值早于 `src`」**（突变 M-AW 验证有效）。
2. **快捷键用裸字母**（`T`/`S`）：沿用 `m`/`f` 的风格 → 不需要给 `resolveKeyAction` 加修饰键参数，也天然不与 Obsidian 热键冲突。
3. **拦截器要同时看 `href` 与 `data-href`**：库内 markdown 链接的目标路径在 **`data-href`**（`href` 可能是 `app://` 形态）—— 只用 href 会漏。
4. **两条既有产物断言因新增而计数变动**（占位态守卫 1→2、进场目标消费点 4→6）：属预期，已同步改判 + 加注释。
5. **两种「假绿」形态在本轮各出现一次**（替换掉文件末尾的 `process.exit` → 打 FAIL 但退出码 0；顶层块用 `cssCheck` → CRASH）→ **写完新断言块必须看 `CRASH=` 与退出码**。

---

## 8.2 用户实测报障后的定稿（2026-09-19，#327）

用户报障原话：「点击插入当前时间戳怎么笔记只显示条链接无跳转【obsidian://reelludic?action=video&entry=e_…&ep=0&t=323】」＋「在顶栏最右加个打开当前视频笔记的按钮」＋「插入当前时间戳和当前截图时要打开当前视频笔记并分屏显示」。

### 根因（三条，均为确凿缺陷）

| # | 根因 | 说明 |
| --- | --- | --- |
| 1 | **协议处理器只认 `action=jump`** | `action=video` 的深链**没有任何兜底通道**：笔记里的点击靠 `onWorkspaceAnchorClick` 捕获阶段拦截，一旦被别的插件抢先 / 从其他上下文唤起就**什么都不发生** |
| 2 | **`openEpisodeLocal` 会看 `settings.internalMediaPlayback`** | 关着时转**系统播放器**，而系统播放器**无法定位到某秒**（从头播）= 点了等于没跳。⚠️ 首版在 `openVideoAt` 注释里写了「不看开关」，但**委托调用里其实看了** —— 注释与实现不一致 |
| 3 | **「看着是链接却点不动」** | 首版按 D-2 Ⓒ 插到「当前编辑器光标处」，而 **Live Preview 会把「光标所在行」渲染成源码** → 刚插完链接就在光标旁，点下去只是移动光标 |

### 修法与口径改判

1. **协议处理器按 action 分派**：`parseReaderDeepLink` 命中 → 阅读器；否则 `parseTimeLink` → `openVideoAt`（前缀与 host 校验仍是 `readerLink` 的单一真源）。
2. **新增 `openEpisodeLocal(entry, startIdx, seekSec?, forceInternal = false)`**：时间戳/截图深链**必须传 `true`**（普通「观看」入口不传，语义不变）。
3. **口径改判（取代 D-2 Ⓒ）**：时间戳与截图**统一写条目笔记**，且**写入前先把该笔记开在分屏**（`focus=false` → 不抢焦点，播放器留在左侧继续播）；`lastMdLeaf` + `active-leaf-change` 跟踪**整体删除**（有反向守卫钉住不得回流）。
4. **补建入口**：顶栏右上角**最右**新增 `notebook-text`「打开视频笔记」—— 该图标正是三个阅读器「打开笔记」的**既定图标**（2026-09-17 裁定），**复用即惯例一致**。宿主 `openVideoNote(entry, focus)`：缺笔记先 `writeNote` → 已开着（任意标签页）**不重复开**、只按 `focus` 决定是否切过去 → 否则 `getLeaf('split', 'vertical')` **竖向分屏**打开。

验证：tsc 0 / 构建 87 告警（基线）/ 受影响单测 **114/114** / 产物断言 **1111 PASS / 0 FAIL / CRASH=false**（+8，同步改判 4 条旧锚点）/ **断言级突变 5/5 全抓** / md5 三方一致 + 已部署；UI-GUIDE **v55**。

---

## 8.3 第三次报障（2026-09-19，#330）：真根因是**深链通道压根没打通**（不是"文字里有空格"）

用户原话：「在编辑视图下还是跳不了，而且我要的插入时间戳并定位分屏打开笔记时间戳位置的呢」＋控制台
`Received URL action {action: 'reelludic', entry: 'e_…', ep: '0', t: '430'}` ×3 ＋
`TypeError: Failed to construct 'URL': Invalid URL at jE ← t.getClickableTokenAt ← t.onEditorLinkMouseover / onEditorClick` ×4。

### 8.3.1 先纠正上一轮的误判（重要 —— 这条要一起改掉）

`Invalid URL` 是**噪音，不是打不开的原因**。读 Obsidian 核心（`app.js` @1249551）：

```js
function jE(e){ try{ return new URL(e).toString() }catch(e){ console.log(e) } try{ return encodeURI(decodeURI(e)) }catch(e){} return "" }
function UE(e){ if((e=e.trim()).startsWith("<")){…} var n=/\s/.exec(e); return n ? e.substring(0, n.index) : e }
```

**异常被 `catch` 吞掉**，随后回退 `encodeURI(decodeURI(e))`。而且 `new URL("5:56")` 与 `new URL("5:56·回到视频")`
**都会抛**（都不是绝对 URL）⇒ 有空格没空格报的是**同一条错**。
⇒ 上一轮写下的「空格 → Invalid URL → 无法打开」是**错误因果**（#329 的 UI-GUIDE v57 与 CHANGELOG 已更正）。
**文案去空格本身保留**（`UE()` 确实会在第一个空白处截断 token，少一个变量总是好的），但它治不了「跳不了」。

### 8.3.2 真根因（两条，都有实证）

| # | 根因 | 证据 |
| --- | --- | --- |
| **1** | **协议处理器「把 params 拼回 URL 再解析」⇒ 恒不命中** | Obsidian 的 URI 语义是 **`obsidian://<action>?<params>`，host 就是 action**；分发器 `dispatch(e)` 先 `console.log("Received URL action", e)` 再按 `e.action` 查已注册 handler（`app.js` @2814566）。用户日志那行 `action: 'reelludic'` 说明链接里写的 `action=video` **被 host 名覆盖**了 → 拼回去后 `parseReaderDeepLink`（要 `jump`）与 `parseTimeLink`（要 `video`）**都判 null** → **处理器静默什么都不做**（日志里看得到 URL 已被收到、界面上毫无反应，正是这个形态） |
| **2** | **拦截器只认 `<a>` ⇒ 编辑视图永远拦不到** | `onEditorClick`（`app.js` @2548591）判可点 token 时只认 `.external-link` / `.cm-url` / `.cm-link` / `.cm-underline` 这些 **CM6 span**；**编辑视图里的链接不是 `<a>`** → `target.closest('a')` 恒为 null → 旧实现首行 `if (!a) return` 直接放行（阅读视图是 `<a>` → 只有那里能跳 = 用户报的「只能阅读视图跳」） |

### 8.3.3 修法（四条，含顺带发现的静默丢数据）

1. **协议处理器改为「按参数形状分派」**（纯函数 `readerLinkFromParams` / `videoDeepLinkFromParams`）：
   `book`+`block` → 阅读器跳转；`entry` → 视频时间戳。⛔ **完全不看 `action`**（它已不可信）。
   顺带修好了**用户笔记里已经写好的旧链接**（它们的 `action=jump` / `action=video` 同样是死的）。
   宽严口径：**严在 id**（白名单挡住「把别人的链接当自己的」）、**宽在时间**（`entry` 合法即认定是本插件链接，
   `t`/`ep` 缺失或非法一律按 0 —— 宁可「打开视频从头播」，也**绝不再出现「点了什么都不发生」**）。
2. **拦截器覆盖编辑视图**：编辑器里链接目标**不在 DOM 属性上**（渲染出来的只有显示文字）→ 回「点击处所在行」的
   markdown 源码，按「点击处文字 === 链接文字 **或** 链接目标」把目标取回来（`matchLineLink`）。
   行内别的字、整行（点到行元素）都不命中 ⇒ **不会误吞普通点击**，也不会抢「点这行放光标」。
3. **滚到插入处补一帧**：分屏是刚挂上 DOM 的，布局没跑完时 `clientHeight` 为 0 → `scrollIntoView` 会算歪甚至不动
   （「插入后没定位到插入处」的可能来源之一）→ 下一帧按同一目标补滚一次（重复滚动无副作用）。
4. 🔴 **顺带修掉一处静默丢数据**：`## 时间戳` / `## 截图` 是 #326 插入的**用户数据**，且**不在笔记模板里**，
   但 `ANNOTATION_SECTIONS` 只列了 `['高亮','摘抄']` → 条目保存触发 `writeNote` 重写时**两区被整段抹掉**。
   实测证据：用户笔记里只剩**后一次**插入的那条（`t=466`），日志里点过的更早那条（`t=430`）**全库搜不到**。
   ⇒ 名单补成 `['高亮','摘抄','时间戳','截图']`。**纪律：新增加入笔记的区段必须同步这张名单。**

---

## 8.4 第四次报障（2026-09-19，#331）：截图块的时间戳点不动 —— **入参契约与真实调用方不一致**

用户原话：「插入时间戳在编辑视图上能跳转，但截图生成的时间戳无法跳转」。
（前半句说明 #330 的修法生效了 ✔ —— **「插入」通、「截图」不通**，这个分叉本身就是最强的定位线索。）

### 根因（读代码即确认）

`buildShotBlock` 的签名收**裸目标**：

```ts
export function buildShotBlock(opts: { fileName: string; link: string; seconds: number }): string {
    return `![[${name}]]\n[${backLinkText(opts.seconds)}](${link})`;
}
```

而**唯一的真实调用方** `main.saveVideoShot` 传进来的是 `this.videoTimeLink(entry, ep, seconds)`
= `buildTimeLink` 的产物 —— **已包好 markdown 语法的完整链接**。⇒ 再包一层，产出**嵌套链接**：

```
![[截屏 …png]]
[7:46·回到视频]([7:46·回到视频](obsidian://reelludic?action=video&entry=…&ep=0&t=466))
```

点下去命中一个半成品 token → **完全没反应**。

### 🔴 为什么它能从 v54 一路藏到 v59（本批最值钱的一条）

1. **「插入时间戳」走的是同一个 `videoTimeLink` 产物，但那条链不经过 `buildShotBlock`**（它直接把 markdown 链接
   交给 `appendNoteSection`）⇒ 只有「截图」这条分支坏 —— 所以「插入正常 + 截图不正常」这个组合能长期自洽。
2. **单测与调用方对同一个函数的理解不一致**：单测传的是 `'影片.mp4#t=3'`（裸目标，好写），
   真实调用方传的是完整链接。**测试全绿，真实路径全坏** —— 这是「假绿」里最难发现的一类，
   因为它**不在断言层也不在实现层，而在契约层**。
3. 判据（已写进 UI-GUIDE）：**纯函数的入参契约必须由「真实调用方」来验** —— 写完单测回头 `grep` 一遍调用点，
   确认「真实传的真是这个」。

### 修法

1. **契约统一**：入参 = 完整 markdown 链接，参数名 `link` → **`timeLink`**，并**去掉 `seconds`**
   （label 由 `buildTimeLink` 决定；在这里再算一遍就是第二处真源）。函数体**只做两行拼接**。
2. **fail-closed 形态守卫**：`MD_LINK_RE = /^\[[^\]]+\]\(.+\)$/`，入参不像 markdown 链接 → **返回空串**
   —— 宁可什么都不写，也**绝不产出「点不动的裸 URL 行」**（裸 URL 在编辑视图只是文本，见 #328）。
   调用方补 `if (!block)` 明确提示，不再出现「静默没写却提示已截取」。
3. **单测按真实调用方式验**：`buildTimeLink` → `buildShotBlock` → 从块的第二行抽出目标 →
   **`parseTimeLink` 必须解回同一目标**（这才是「点得动、跳得到」的判据）；另加两条反向守卫
   （「不得出现 `]([` 嵌套」「传裸目标 → 空串」）。

验证：tsc 0 → 87 告警（基线）→ 受影响单测 194/194（+3）→ 产物断言 1126 PASS / 0 FAIL / CRASH=false（+3，改判 1 条陈旧锚点）
→ 突变 5/5 全抓（3 断言级 + 2 单元级）→ md5 `d7c600d012b4` 三方一致 + 已部署；UI-GUIDE v59。

---

## 7. 风险与已知缺口

| 风险 | 说明 | 处置 |
| --- | --- | --- |
| 远程 http 源 + `crossorigin` | 无 ACAO 的站点会**加载失败** | 本期源全为 `app://`；将来支持 http 时必须按源分支设置（已在 §3.1 记为回归风险） |
| 控制条宽度压力 | 右侧功能组从 6 项增至 8 项（含 2 个文本钮） | 中段已 `flex:1 + min-width:0`；改完按 v48 纪律**重测几何**（`_geo_net.cjs` 可复用，改造成播放器控制条版） |
| 库外媒体 | 截图**只能存库内**（Obsidian 只管理库内文件）；视频本身可继续留在库外 | 落点见 D-4；笔记里用 `![[内链]]` 引用 |
| 黑帧 | 视频未起播 / 未 decode 时抓帧会得到黑图 | `captureFrame` 判 `readyState >= 2`，否则提示「请先播放一下再截」 |
| 暂停帧与进度条 | 截图用的秒数与 `currentTime` **同一真源**（避免拖拽过程中两者不一致） | 实现约定 |
| 多集视频 | 库内链接由文件名区分集；库外深链**必须带 `ep`** | 已在 §4.1 形态里含 `ep` |
