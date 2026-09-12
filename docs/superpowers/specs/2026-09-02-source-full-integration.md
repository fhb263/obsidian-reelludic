# 数据源全量接入 + 服务集成两折叠项重构 — 范围修订设计

- 日期：2026-09-02
- 状态：已批准（用户三轮拍板：① 注册表 7 个未接入源**本轮全部接入搜索客户端**；② 服务集成先定「小按钮 + 右键浮层」，随后修订为「**API 管理 + 数据源启用**」两个折叠项——API 管理聚合全部需 Key 源配置；数据源启用按五分类勾选 + 组内 ↑↓ 调序；③ 旧「源链」小按钮/折叠行交互**完全移除**，勾选面板为唯一入口）
- 上游：`2026-09-02-metadata-source-registry-design.md`（B1 已交付后的同源设计）；本文件是**范围修订**，未覆盖处以上游为准
- 关联条目：#165（current-progress 待追加）

## 背景与动因

B1 交付后用户冒烟设置页发现：**每类型源链候选只放 `implemented=true` 的 3 源**（douban/tmdb/bangumi），五组默认链恰用光各组已接入候选 → 全页面无处「＋ 添加」，Open Library / Google Books / Steam / MusicBrainz / iTunes / OMDb / AniList 7 个注册位源零展示；且「每类型一行折叠 + select 槽」的全局展开式编辑不符合用户偏好的紧凑交互。用户结论：

1. 7 个注册位源**这轮直接全部接入**（原分批 B2 免 Key 源 + B4 Key 源合一）；
2. 服务集成区最终形态经两轮拍板定为「**两个折叠项**」：① **API 管理**（所有需 Key 源配置统一聚合）；② **数据源启用**（五分类勾选 + 组内调序）——见 S5，以最新 ASCII 为准（小按钮浮层方案在用户再评审时被折叠项方案取代）。

## 目标与非目标

**目标**
1. 注册表 10 源全部 `implemented=true`（保留字段与过滤器，未来注册位仍可用）
2. 默认链落上游 D2 表：book=`douban→openLibrary`、game=`douban→steam`、music=`douban→musicbrainz→itunes`、movieTv=`douban→tmdb`、anime=`douban→bangumi`（googleBooks/omdb/anilist 默认关，自选加入）
3. 7 新源各交付：service 模块（纯 parse + http 注入 client）+ 结果映射 + main 编排注册 + 点选回填 + 展示徽标/直达
4. 服务集成区重构为「API 管理 + 数据源启用」两个折叠项（见 S5）
5. searchDisplay 泛化：徽标/直达 URL 不再写死「豆瓣/TMDB/Bangumi」，改按 `source` 查表

**非目标（仍留后续批次）**
- B3 详情深度回填（openLibrary/googleBooks 书籍字段 + steam appdetails）——本轮仅「搜索级字段 + 点选轻量补全」，深度回填另行排期
- rawg / Comic Vine / VNDB / BGG 等注册位：不做
- MediaEntry schema 零改动（append-only 红线不触发）；`ReelLudicSettings` 仅追加 `omdbApiKey?: string`（可选字段，缺省不迁移）

## 设计

### S1 注册表与默认链（修订 D1/D2）

`src/pure/sourceRegistry.ts`：
- PROVIDERS：openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist `implemented: true`（保留布尔与 normalize 过滤，未来新增注册位仍自动隐藏）
- keyField 补全：omdb → `'omdbApiKey'`（settings 追加可选字段）；googleBooks → `'googleBooksApiKey'`（既有字段复活读取）；其余新源免 Key（null）
- DEFAULT_CHAINS 按 D2 表更新；`normalize/resolve/derive` 逻辑不动

行为变更说明（CHANGELOG 需注明）：无 `sourceChains` 配置的旧用户升级后，书籍/游戏/音乐搜索自动多出第二/第三源结果（Open Library / Steam / MusicBrainz+iTunes）——属本设计的预期默认。

### S2 展示层泛化（修订 D4 展示子项）

`src/pure/searchDisplay.ts`：
- 新增查表：`sourceId → { label(徽标), buildUrl(result) }`，覆盖 10 源；旧数据无 `source` / 未知 source 兜底豆瓣
- 形状分支（album/author/platform/studio/影视）仍决定「类型上下文」与 meta 行拼法，但徽标与 sourceUrl 一律走 source 查表
- 封面规则：openLibrary `https://covers.openlibrary.org/b/id/{cover_i}-M.jpg`；googleBooks thumbnail 原样（去 `&zoom=` 保留）；steam 竖版 `https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg`；musicbrainz `https://coverartarchive.org/release-group/{id}/front`（404 回占位）；itunes `artworkUrl100` 放大 600×600；omdb Poster（`N/A`→无）；anilist `coverImage.large`
- 直达 URL：OL `https://openlibrary.org{works/…}`、googleBooks `https://books.google.com/books?id={id}`、steam `https://store.steampowered.com/app/{appid}`、musicbrainz `https://musicbrainz.org/release-group/{id}`、itunes 用返回的 `collectionViewUrl`、omdb `https://www.imdb.com/title/{imdbID}`、anilist `https://anilist.co/anime/{id}`

### S3 main 搜索编排泛化（修订 D4）

现状：5 个 `searchXFresh` 内联 douban/tmdb/bangumi 分支 + tmdb/bangumi 单源失败弹 Notice + aux 手写三态。改为：

- 组内 runner 注册表：`ProviderId → searchRunner`（douban 主源语义特殊：不限时 + `reachable/cookieInvalid` 归集 + 进度「豆瓣搜索」）；其余辅助源统一 `withTimeout(5s)`，**失败静默：只把进度阶段标 ✗ + 置 failed 状态，不再逐个弹 Notice**（sanction：对齐上游 D4「失败源静默降级」，收敛 B1 实现残留的单源 Notice 噪音；全链无果仍走 deriveGroupSearchError 统一文案）
- 凭据判定统一：`PROVIDER_META[id].keyField` → 动态读 `settings[keyField]`（不再 main 里写死 tmdb/bangumi 两个字段判断）
- 链中含未注册 runner 的源 → 静默跳过（aux 视为 absent）；保证「注册表/默认链先行、客户端分批落地」的中间提交不回归
- 影视/动画默认链不变 → 行为零漂移；book/game/music 因默认链新增源而产生新结果（预期）

### S4 新源点选回填契约

EntryModal 现有 handler 分发（douban/tmdb/bangumi 各一条）→ 每个新源追加同类 handler + EntryForm 内按 `result.source` 分派：
- 搜索级字段直接可回填者：googleBooks / steam / musicbrainz / itunes（title/作者或艺术家/年份/封面/出版社或平台等，能填则填，缺深度字段不强求——与现 douban 搜索级结果「点选后再补详情」体验对齐）
- 提供点选轻量补全者：openLibrary（works.json 补简介/页数）、omdb（`i=` 详情补 Plot/导演/演员/评分）、anilist（GraphQL 详情补 studios/meanScore/genres/desc）——能力有则补，失败静默不阻塞保存
- 各源 id 必须携带进结果对象，保存后条目可溯源（source + id + sourceUrl 三件套对齐现 douban/tmdb 行为）

### S5 设置页服务集成「两折叠项」（修订 D3，最终拍板）

**改动前（B1 现状）**：凭据 3 大折叠行 + 源链 5 大折叠行（select 槽 + ↑↓✕ + 添加源），全部展开填写。

**改动后（两折叠项）**：

```
── 服务集成 ─────────────────────────────────────────
▸ ① API 管理                    ← 折叠项一（默认展开）
  需 Key 的数据源配置统一聚合于此：
  [Douban] [TMDB] [Bangumi] [OMDb] [Google Books]
     └ 每源一条（按钮/行）点击展开 → 配置区
       ┌────────────────────────────────┐
       │ Douban（Cookie）               │
       │ ┌──────────────────────────┐   │
       │ │•••••••••••••   [显示]     │   │ ← 密文框(显示/隐藏)
       │ └──────────────────────────┘   │
       │ hint（1-2 行）                 │
       │ [测试连接] ✓ 已连接 · 200ms     │
       └────────────────────────────────┘
  （免 Key 源不在此列：Open Library/Steam/
    MusicBrainz/iTunes/AniList）

▸ ② 数据源启用                   ← 折叠项二（默认展开）
  按分类勾选参与搜索的源 · 组内 ↑↓ 调序
  书籍：  ☑ 豆瓣     ☑ Open Library   ☐ Google Books
  影视：  ☑ 豆瓣     ☑ TMDB           ☐ OMDb(IMDb)
  动画：  ☑ 豆瓣     ☑ Bangumi        ☐ AniList
  音乐：  ☑ 豆瓣     ☑ MusicBrainz    ☑ iTunes
  游戏：  ☑ 豆瓣     ☑ Steam
  · 每行 = 一个分类；行内列出该分类注册表全部适用源（每组 ≤3）
  · 勾选 = 该源参与该分类搜索；取消勾选 = 不参与
  · 行内 ↑↓ 调整勾选源顺序（首源 = 主源不限时；豆瓣可被移出首位）
  · 分组/折叠展开清晰、分类可区分，便于后续新增源维护
```

要点：
- **折叠项一 · API 管理**只列「需 Key 且已实现」源：Douban(Cookie)/TMDB/Bangumi/OMDb/Google Books（免 Key 源无凭据不列）。每源点击展开密文输入（显示/隐藏）+ hint + 「测试连接」按钮；onChange 写 `settings[keyField]` + saveSettings + 刷新状态徽标。
- **折叠项二 · 数据源启用**：5 行对应五分类（书籍/影视/动画/音乐/游戏，按此顺序展示）；每行列出该组注册表全部适用源；勾选集合 + 行内顺序 = 该组源链。默认勾选态 = 各组默认链成员；等于 `DEFAULT_CHAINS` 时不落键（undefined），保存语义沿用 B1 `commit()`（normalize → 等默认删键 → saveSettings）。
- 勾选/调序的存储模型仍是 `sourceChains: Partial<Record<SourceGroup, ProviderId[]>>`（有序数组），纯函数层（normalize/resolve/derive）与 schema 零改动——勾选 UI 只是链编辑的新交互形态。
- 测试连接：Douban/TMDB/Bangumi 沿用既有 `testXxxConnection`；OMDb/Google Books 轻量 ping（OMDb `i=tt3896198&plot=short`、Google Books `volumes?q=test&maxResults=1`），在 service 任务内实现并注册。
- 旧的凭据折叠行 / 源链折叠行 / 小按钮 + 右键浮层实现（若已落地）一律移除，**勾选面板为唯一入口**；`rl-src-*` 等不再引用的样式类清理。
- 折叠项头可点击展开/收起；两折叠项相互独立、可同时展开。

### S6 各新源 API 事实（端点以接入校准为准，测试用 fixture）

| 源 | 组 | 默认 | 检索端点 | 搜索级字段 | Key |
|---|---|---|---|---|---|
| openLibrary | book | 开 | `search.json?q=&limit=20&fields=…` | key/author[0]/first_publish_year/publisher[0]/isbn[0]/cover_i | 无 |
| googleBooks | book | 关 | `volumes?q=&maxResults=20` | id/title/authors/publisher/publishedDate/pageCount/categories/description/imageLinks | 可选(复活 googleBooksApiKey) |
| steam | game | 开 | store suggest（端点接入时校准，需返回 appid/name/logo） | appid/name/title/logo | 无 |
| musicbrainz | music | 开 | `ws/2/release-group/?query=&fmt=json&limit=20`（~1rps） | id/title/artist-credit/first-release-date/primary-type | 无 |
| itunes | music | 开 | `search?term=&entity=album&limit=20` | collectionId/collectionName/artistName/releaseDate/artworkUrl100/collectionViewUrl | 无 |
| omdb | movieTv | 关 | `?apikey=&s=&type=movie|series` | imdbID/Title/Year/Type/Poster | omdbApiKey(新增) |
| anilist | anime | 关 | GraphQL `Page.media(search:,type:ANIME)` | id/title(romaji/chinese)/coverImage/startDate | 无 |

## 分批交付（每任务 TDD 红→绿 → tsc+esbuild → 相关测试全绿 → commit；最终验证 gate：全量 vitest + build + 三产物 cmp + sync 测试库 + 符号断言）

| # | 内容 | 验收要点 |
|---|---|---|
| T1 | 注册表全量启用 + 默认链落 D2 + `omdbApiKey` 字段 | registry 测试更新；默认链新值；normalize 全 10 源通过 |
| T2 | searchDisplay 泛化（source 查表 label/url/封面） | 10 源徽标/直达单测；旧数据无 source 兜底豆瓣 |
| T3 | main 编排泛化（runner map + keyField 动态读 + 静默降级 aux） | 5 组回归（未注册源跳过）；默认链旧值行为 = 现状直至新源注册 |
| T4–T10 | 7 源客户端逐个（service + parse fixture 测试 + to*Result + main 注册 + 点选 handler + 展示条目 + 默认链/徽标随到随验） | 每源 ≥3 parse 单测；字段映射测试；该源加入默认链后冒烟 |
| T11 | 设置页服务集成两折叠项重构（Settings.ts + styles.css）：API 管理 + 数据源启用 | UI ASCII 对本 spec S5；勾选/↑↓调序持久化 = sourceChains；API 管理密文/测试连接 |
| T12 | 全链回归验证 | 全量测试绿 / build EXIT 0 / 三产物 cmp IDENTICAL / 符号断言 / sync 测试库 |
| T13 | 文档与提交 | CHANGELOG 横幅+分类 / current-progress #165 / 工作日志 / commit |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 编排重构回归（5 组行为漂移） | 默认链先行但 runner 未注册源静默跳过 → 中间态=旧行为；derive/文案常量不动 |
| 单源 Notice 收敛为静默是行为变化 | sanction 记录（对齐上游 D4），CHANGELOG 注明 |
| 默认链变化（旧用户无配置自动多源） | 属预期；CHANGELOG 注明，用户可在设置页改回单源 |
| Steam 无官方关键词 API | 端点接入时校准（suggest 或等价公开检索），fixture 先行；失败则该源 empty 不阻塞 |
| MusicBrainz 限流 1rps / CoverArt 404 | 辅助源 5s 压缩；封面 404 回占位 |
| 新源中文曲库/曲目质量参差 | 默认链已按 D2（musicbrainz 规范 + itunes 中文互补）；可自选关闭 |
| OMDb/Google Books Key 缺失 | 默认关/可选；未配 key → unconfigured 提示而非报错；凭据浮层引导 |
| 点选回填跨源映射漏字段 | S4 契约：搜索级字段能填则填、轻量补全有则补，保存可用为底线 |
