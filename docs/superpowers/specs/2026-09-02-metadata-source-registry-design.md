# 元数据源 Provider 注册表 + 五组源链自选 — 设计

- 日期：2026-09-02
- 状态：已批准（brainstorming 6 节确认，待本文件复核后进入 writing-plans）
- 关联：本项目 2026-08-28 #84「数据源收敛」的方向性扩展（从「收敛为 Douban/TMDB/Bangumi 三源」→「每类型 ≥2 源、源可自选」）

## 背景与动因

用户要求「增强获取元数据源的可能性」，并给出 4 个参考：

| 参考源 | 结论 | 对本项目价值 |
|---|---|---|
| github.com/mprojectscode/obsidian-media-db-plugin | Obsidian 插件，按「每个 API 一个 provider」查询多源（Tenrai/MAL、OMDb、TMDB、MusicBrainz、Steam、Open Library、Comic Vine、VNDB、BGG、Wikipedia）并统一搜索结果 | **高**：其源清单恰补本项目空窗（书籍/游戏/音乐现为 Douban 单源）；「provider 抽象 + 统一结果」与本项目 `MetadataSource` 接口同构 |
| github.com/metatube-community/jellyfin-plugin-metatube | Jellyfin/Emby（.NET 服务器）刮削插件，依赖自建 MetaTube server | 低：平台错配（Obsidian 端无法复用），数据模型自成一套 |
| github.com/metatube-community/metatube-server-releases | MetaTube server（Go 自托管）二进制/Docker 发布 | 低：metatube-sdk-go `provider/` 目录实测以成人内容刮削源为主（30+ JAV/AV 源），与 Douban 系媒体库无交集 |
| cdn.jsdelivr.net/.../manifest.json | Jellyfin 插件仓库清单（guid/targetAbi/version） | 无：纯 Jellyfin 分发格式 |

**用户决策链**（brainstorming 逐问确认）：
1. 核心动机 = **补空窗：每类型 ≥2 源**（书籍/游戏/音乐现仅 Douban，403/无 Cookie 即无备选）
2. 范围 = 书籍、游戏、音乐、影视、动画全部补源
3. 深度 = **混合**：所有新源先「搜索 + 基础回填」，书籍/游戏两个最常用源追加「详情回填」（第二批）
4. 源选型 = 不由设计者写死，改为**设置页五组折叠区（书籍/游戏/音乐/影视/动画），每组自选填写 ≤3 个源及顺序**
5. 架构 = **方案 A：Provider 注册表 + 每类型源链配置**

## 目标与非目标

**目标**
1. 新增 provider 能力注册目录（douban/tmdb/bangumi 纳入 + openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist 候选）
2. 设置页「服务集成」改为五组折叠区，每组自选 ≤3 个源及顺序
3. 搜索编排泛化为「按组配置并行搜索 → N 源合并 → 自动降级」
4. 批量交付：B1 基建 → B2 免 Key 新源 → B3 详情回填 → B4 Key 源

**非目标**
- 不做用户自定义 HTTP 模板源（任意 URL 模板化抓取）
- 不做 MAL（动画第三源以 AniList 候选提供，默认关）
- RAWG / Comic Vine / VNDB / BGG 等只留注册位（`registry.ts` 结构支持），本批不实现
- MediaEntry schema 零改动（append-only 红线不触发）

## 设计

### D1 Provider 注册表（核心纯数据层）

新文件 `src/services/registry.ts`（纯数据 + 纯函数，可 TDD）：

```ts
type EntryGroup = 'movieTv' | 'anime' | 'book' | 'game' | 'music';
type ProviderId =
  | 'douban' | 'tmdb' | 'bangumi'              // 既有
  | 'openLibrary' | 'googleBooks' | 'steam'    // 新（书/游戏）
  | 'musicbrainz' | 'itunes'                   // 新（音乐）
  | 'omdb' | 'anilist';                        // 新（影视/动画，需 Key/默认关）

interface ProviderMeta {
  id: ProviderId;
  label: string;                    // 徽标 / UI 名
  groups: EntryGroup[];             // 适用组
  needKey: boolean;                 // 是否需要 API Key
  needCookie?: boolean;             // 是否需要登录态 Cookie
  keyField?: keyof ReelLudicSettings; // 凭据存于哪个 settings 字段（全局唯一共享）
  defaultOn: boolean;               // 该组默认链是否含此源
  keyless: boolean;                 // 免 Key 可用
}

export const PROVIDERS: ProviderMeta[];
export function providersForGroup(g: EntryGroup): ProviderMeta[];
export function defaultChain(g: EntryGroup): ProviderId[]; // 向后兼容默认
export function isProviderForGroup(id: ProviderId, g: EntryGroup): boolean;
```

要点：
- **凭据只存一份、全局共享**：doubanCookie 一个字段服务全部组；注册表把「源 ↔ 适用组 ↔ 凭据字段」收敛一处，杜绝设置页每组重复输入同一凭据
- 组与条目类型映射：`movieTv` = movie + tv（二者始终同链，沿用现状）、`anime`、`book`、`game`、`music` —— 即设置页五组

### D2 默认源链（保持现行为 + 每类补免 Key 新源）

| 组 | 默认链（槽1→3） | 可选补充（注册但默认关） |
|---|---|---|
| book | douban → openLibrary → *空* | googleBooks |
| game | douban → steam → *空* | rawg（注册位，本批不实现）|
| music | douban → musicbrainz → itunes | —（满 3）|
| movieTv | douban → tmdb → *空* | omdb（需 Key）|
| anime | douban → bangumi → *空* | anilist |

规则：
- 默认链首恒为 douban → 保留现有「主源不限时」语义
- 新源默认打开仅 3 个免 Key 源：openLibrary / steam / musicbrainz + itunes（musicbrainz 与 itunes 互补：前者数据规范含厂牌/年份，后者中文曲库 + 高清封面）
- googleBooks 曾于 #84 删除：默认关，仅作自选（免 Key 但限流，可配 googleBooksApiKey 提升配额——该字段已存在保留未读，本次复活读取）
- omdb / anilist / rawg 均需额外凭据或中文弱，默认关

### D3 设置页 UI（五组折叠区）

**改动前（现「服务集成」区）**
```
── 服务集成 ────────────────────────────────
▸ 图书/电影/电视剧/游戏/音乐 · Douban  已配置
▸ 电影/电视剧 · TMDB                   未配置
▸ 动画 · Bangumi                       未配置
```

**改动后**
```
── 数据源（按类型自选 ≤3 源）──────────────────
▸ 书籍        [豆瓣✓][Open Library✓][＋]
▸ 游戏        [豆瓣✓][Steam✓][＋]
▸ 音乐        [豆瓣✓][MusicBrainz✓][iTunes✓]
▸ 影视        [豆瓣✓][TMDB✓][＋]
▸ 动画        [豆瓣✓][Bangumi✓][＋]
   └ 展开任一组（如「书籍」）：
     ┌────────────────────────────────────────┐
     │ 源1 ▾ 豆瓣(主力)    已配置 · 测试连接    │
     │ 源2 ▾ Open Library 免Key · 测试连接     │
     │ 源3 ▾ ＋ 添加源 (Google Books/关闭)      │
     │ 凭据全局唯一，选源后就地配置             │
     └────────────────────────────────────────┘
```
- 折叠行/状态徽标/测试连接沿用现有 `createSourceRow` 交互与 `rl-src-*` 样式（组件化复用，组 = 行、槽 = 行内下拉）
- 槽位下拉只列该组适用源；选中需凭据源 → 就地展开输入框（写全局字段）；状态「已配置/未配置」+「测试连接」
- 连带小改：添加条目头部「数据源」栏按各组实际启用且已配置的源展示（#164 曾实现「按类型列出并源」逻辑，读 sourceChains 取代硬编码三源判断）

### D4 搜索编排泛化（main.ts）

```
searchXFresh(q) = 读 settings.sourceChains[group]
  → Promise.allSettled(各源 search)
      主源（douban，链首）不超时
      其余源 5s 超时（沿用 AUX_SEARCH_TIMEOUT）
  → 失败源静默降级：搜索进度阶段标签标 ✗（不再逐个弹 Notice）
  → mergeBySource 泛化为 N 源（现双源）
  → sortByRelevance 排序
  → 返回；全链失败才弹统一错误（沿用 doubanUnavailableError 文案与 cookieInvalid 区分）
```
- 每新源结果经 to*Result 映射进既有结果类型（沿用 douban.ts `toTmdbResult/toBookResult/...` 模式），`source` 字段带 providerId
- 结果徽标 / 来源筛选：`pure/searchDisplay` 的 SOURCE_LABELS / inferSource 扩展新 id（openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist）
- 结果缓存 30min、进度阶段标签机制不变

### D5 设置存储（append-only）

`ReelLudicSettings` 追加：
```ts
/** 每组的启用源链（有序 ≤3，providerId）；缺省/空数组 = 该组默认链 */
sourceChains?: Partial<Record<EntryGroup, ProviderId[]>>;
/** OMDb API Key（omdbapi.com 免费注册，1000/日） */
omdbApiKey?: string;
```
- `googleBooksApiKey`/`rawgApiKey` 字段已存在（保留未读），复活读取（googleBooks 用；rawg 本批不实现仍不读）
- DEFAULT_SETTINGS：sourceChains 不设默认值；运行时 `resolveChain(group)` = `sourceChains?.[group]?.length ? 该值 : defaultChain(group)` —— 旧用户零迁移成本
- 其余新源（openLibrary/steam/musicbrainz/itunes/anilist）免 Key 无需新字段

### D6 新源 service 模块形态（B2 逐个落地）

每个新源一个文件 `src/services/<name>.ts`，模式对齐既有 douban.ts / tmdb.ts：
1. `parseXxxResults(text): RawItem[]`（纯函数，脱离 http，可 TDD）
2. `toBookResult/toGameResult/...(item): BookSearchResult/GameSearchResult/...`（source 带 providerId）
3. client class：`search(query)` → nodeHttpGet / nodeHttpPost 组装 + 解析；超时由编排层统一 withTimeout
4. detail 能力（B3）：`fetchDetail(id)` → 详情字段映射（仅 openLibrary/googleBooks 书籍 + steam 游戏）

各源 API 事实（接入时再校准端点）：
- Open Library：search.json 免 Key；author/publish_year/publisher/isbn/cover_i/subject
- Google Books：volumes 免 Key（可选 key）；title/authors/publisher/publishedDate/industryIdentifiers/pageCount/categories/description/imageLinks
- Steam：store.steampowered.com 公开检索（免 Key）；appdetails 详情（开发商/发行商/日期/封面/简介）
- MusicBrainz：release-group 检索免 Key（~1rps）；Cover Art Archive 封面
- iTunes Search API：entity=album 免 Key；collectionName/artistName/releaseDate/primaryGenreName/artworkUrl100（可放大 600×600）
- OMDb：按标题检索需 Key；Title/Year/Genre/Director/Actors/Plot/Poster/imdbID
- AniList：GraphQL 免 Key（可选 OAuth）；title(romaji/english/native)/coverImage/startDate/studios/meanScore/genres

## 分批交付计划（每批 TDD 红→绿 → tsc+esbuild → sync 测试库 → 3 产物 cmp → CHANGELOG/current-progress → commit）

| 批 | 内容 | 验证要点 |
|---|---|---|
| **B1 基建** | registry.ts + settings.sourceChains/omdbApiKey 字段 + 设置页五组 UI + main.ts 编排泛化（resolveChain/并行 N 源/降级）+ searchDisplay 徽标扩展（先只既有 3 源 + 新 id 预留） | 5 组搜索行为与现状完全一致（回归）；UI ASCII 已批 |
| **B2 免 Key 新源** | openLibrary / googleBooks(默认关) / steam / musicbrainz / itunes service 模块 + 注册 + 结果映射 + 徽标 | 每源 2-4 解析单测；真实 API 冒烟 |
| **B3 详情回填** | 书籍 Open Library/Google Books 详情字段 + 游戏 Steam appdetails 深度回填 | 表单字段映射单测 |
| **B4 Key 源** | OMDb（影视第三源）接入；AniList 视 B1-B3 后定 | 低风险收尾 |

依赖顺序 B1 → B2 → B3 → B4；B2/B3 均可独立验证部署。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| B1 编排重构回归（5 组搜索行为漂移）| 默认链 = 现行为；纯函数单测覆盖 resolveChain/并行降级；真实冒烟对拍新旧结果 |
| 设置页 UI 重构影响面大 | 复用 createSourceRow 折叠组件与 rl-src-* 样式；改动前已出 ASCII 对比（本设计 D3）|
| 新源反爬/限流/网络不稳定 | 全部按辅助源 5s 超时压缩；失败静默降级不阻塞主源；测试连接按钮可主动探活 |
| douban 失效时错误文案依赖 doubanUnavailableError | 全链失败统一抛错逻辑保留，cookieInvalid 语义不变 |
| #84 曾删 googleBooks/RAWG 的教训 | googleBooks 默认关仅自选；RAWG 本批不实现；Open Library 曾删但为免 Key 最稳书籍源，默认开（用户已确认）|

## 开放项
- AniList 是否实现：B3 完成后由用户视体验决定（默认关不影响其余）
- 影视组 movie 与 tv 是否要拆链：维持共用（现状即共用），如需拆分属另一议题
