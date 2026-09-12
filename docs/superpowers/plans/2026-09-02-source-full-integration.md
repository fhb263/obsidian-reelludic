# 数据源全量接入 + 服务集成小按钮化 — 执行计划（#165）

- 日期：2026-09-02
- 规格：`docs/superpowers/specs/2026-09-02-source-full-integration.md`（范围修订，上游 = metadata-source-registry-design.md）
- 执行方式：subagent-driven（每任务 fresh implementer + spec/quality 复审 + 修复循环），任务间不停顿
- 工作目录：`C:\Users\kest\Desktop\obsidian-reelludic`；构建/验证 gate：见 T12；文档收尾 T13

## 全局约定（所有任务适用）
- TDD：纯函数先测后码（红→绿），测试与源码同位（`tests/` 对 `src/pure|services/`）；client 的 HTTP 一律注入（fetch/httpGet 参数化），单测不联网（fixture JSON 文本）
- 提交：每任务独立 commit，消息前缀 `feat|refactor|test|docs: #165 …`；只本地 commit，review 修复用 amend
- 不得读取计划文件以外需求；如规格与现状代码冲突，先按现状代码最小适配并在 commit message 注明
- schema append-only：`ReelLudicSettings` 仅允许追加 `omdbApiKey?: string`（T1）；`MediaEntry` 零改动
- esbuild charset=ascii：产物中文字符为 `\uXXXX` 大写 hex；grep 探测用大写形态

---

## T1 注册表全量启用 + 默认链落 D2 + omdbApiKey 字段

涉及：`src/pure/sourceRegistry.ts`、`src/Settings.ts`、`tests/sourceRegistry.test.ts`

1. `PROVIDERS`：openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist 七条 `implemented: true`；omdb `keyField: 'omdbApiKey'`；googleBooks 保持 `keyField: 'googleBooksApiKey'`；其余新源 keyField 为 null。hint 文案可微调为「已接入」语境，不得改 id/label/groups
2. `DEFAULT_CHAINS` 更新为：book `['douban','openLibrary']`；game `['douban','steam']`；music `['douban','musicbrainz','itunes']`；movieTv `['douban','tmdb']`；anime `['douban','bangumi']`
3. `normalizeSourceChain/resolveSourceChain/deriveGroupSearchError/错误文案常量` 逻辑与文案零改动
4. `src/Settings.ts`：`ReelLudicSettings` 接口在 `sourceChains` 后追加注释字段 `omdbApiKey?: string;`（可选，不入 DEFAULT_SETTINGS；沿用 append-only 注释风格）
5. 测试更新 `tests/sourceRegistry.test.ts`：
   - 默认链表断言改新值（music 3 源满）；新增「候选 = 该组全部适用源」注册位矩阵（每组 ≤3 可用）断言
   - 既有 normalize/derive/文案测试必须原样绿（不改语义）

验收：vitest `tests/sourceRegistry.test.ts` 全绿；`npx tsc --noEmit` 0 诊断；commit。

## T2 searchDisplay 展示泛化（source 查表）

涉及：`src/pure/searchDisplay.ts`、`tests/searchDisplay.test.ts`（如无则新建）

1. 新增内部查表 `SOURCE_VIEW: Record<ProviderId, {label: string; url(r: …): string | undefined}>`（label 直接取 PROVIDER_META.label 或中文徽标，保持现 UI「豆瓣/TMDB/Bangumi」短徽标风格，新源用其英文短名/中文名——以现 UI 徽标样式为准，短名优先）；`buildSourceUrl(source, r)` 未知/缺省 → undefined
2. 直达 URL 规则（据结果字段）：douban（沿用现各类型 subject URL 拼接）、tmdb（现逻辑）、bangumi（现逻辑）、openLibrary `https://openlibrary.org` + 结果携带的 key/路径、googleBooks `https://books.google.com/books?id=` + id、steam `https://store.steampowered.com/app/` + appid、musicbrainz `https://musicbrainz.org/release-group/` + id、itunes 用结果自带 `sourceUrl`（collectionViewUrl）、omdb `https://www.imdb.com/title/` + imdbID、anilist `https://anilist.co/anime/` + id
3. 封面规则按 spec S2（OL cover_i 拼图、steam `library_600x900.jpg`、musicbrainz coverartarchive 失败回 undefined、itunes artwork 放大、omdb `N/A` 滤除、google thumbnail 原样）
4. `describeSearchResult` 形状分支保留（判类型上下文），但 source/sourceUrl 输出改走查表：新增分支按形状判断后的结果对象给 `source` 字段 → 查表输出徽标与 URL；旧数据无 source 或查表缺失 → 兜底现行为（豆瓣文案与 URL）
5. 新源结果类型若缺字段（如 omdb 无 director）→ 形状分支内做可选字段安全读取，不因缺字段崩
6. 测试：为每个源构造一条最小结果 fixture → 断言 label/sourceUrl/cover 输出；无 source 旧数据兜底豆瓣；未知 source 兜底

验收：`tests/searchDisplay.test.ts` 全绿；tsc 0 诊断。T2 与各客户端任务可并行独立推进（客户端产出结果类型字段与 T2 查表以 spec S2 为准对齐）。

## T3 main 搜索编排泛化（runner map + 动态 key + 静默降级）

涉及：`main.ts`（根目录）、`src/pure/sourceRegistry.ts`（如需导出辅助）、`src/pure/timing.ts`（沿用 AUX_SEARCH_TIMEOUT）

目标：把 5 个 `searchXFresh` 内联分支收敛为「组内源 runner 顺序执行/并行 + 状态归集」，新增源 = 注册一行 runner，不再改搜索函数。

1. 新增私有结构（main.ts 内）：
   - `private auxRunners: Partial<Record<ProviderId, (q: string, g: SourceGroup, prog) => Promise<unknown[]>>>` 或按组别 map；douban 特殊走既有 `doubanFallback`（主源不限时 + reachable/cookieInvalid）
   - 辅助源统一包装：`withTimeout(run, AUX_SEARCH_TIMEOUT, label)`；catch → 置该源 `failed` 状态 + 进度阶段标 ✗，**不弹 Notice**（sanction：对齐 spec S3，收敛现 tmdb/bangumi 单源失败 Notice）
   - key 判定：`PROVIDER_META[id].keyField ? !!settings[keyField] : true`，删 main 内写死的 `tmdbApiKey/bangumiToken` 布尔判断
   - 链中含「未注册 runner / 未实现」源 → 跳过（aux absent），保证中间态不回归
2. 五个 `searchXFresh` 收敛：影视/动画仍并行 douban+aux（或跑各自组内 runner 集合）；book/game/music 现仅 douban + （注册后新增源）。aux 三态表达式改为循环归集 `aux[id] = !chain.includes(id) ? 'absent' : !key ? 'unconfigured' : failed ? 'failed' : 'empty'`
3. 进度阶段标签用 PROVIDER_META.label；结果合并沿用 `mergeBySource/sortByRelevance`
4. **回归门**：此时新源 runner 尚未注册，默认链虽含新源但被跳过 → 5 组实际行为 = B1 现状（douban-only / douban+tmdb / douban+bangumi）。此门必须在 T4 前保持：以全量 vitest + 现有搜索相关测试绿为准

验收：tsc 0；全量 vitest 绿；行为等价现状（无新源结果出现）。

## T4 客户端 · openLibrary（book，默认开）

涉及：`src/services/openLibrary.ts`（新建）、`src/services/douban.ts`（如需复用 mapper 风格，只读参照）、`main.ts`（注册 runner + 点选 handler）、`tests/openLibrary.test.ts`（新建）

1. 端点：`https://openlibrary.org/search.json?q={query}&limit=20&fields=key,title,author_name,first_publish_year,publisher,isbn,cover_i,subject`（字段校准以实测返回为准，用 fixture 固定快照）；`HttpGet` 注入同 tmdb.ts 风格
2. 纯函数 `parseOpenLibraryResults(text): RawOpenLibraryItem[]` + `toBookResult(item): BookSearchResult`：id=`key`（如 `/works/OL…`，存完整或剥离前缀须与 sourceUrl 构造一致）；author=author_name[0]；year=first_publish_year；publisher=publisher[0]；isbn=isbn[0]；pageCount=无（搜索级）；thumbnail=`https://covers.openlibrary.org/b/id/{cover_i}-M.jpg`（无 cover_i 则 undefined）；genres=subject 截 3；source=`'openLibrary'`；sourceUrl=`https://openlibrary.org{key}`
3. main.ts 注册 book 组 runner；EntryModal/EntryForm 点选分派：新增 `onFetchOpenLibraryDetail`（works.json：`https://openlibrary.org{key}.json` 补 description/页数(number_of_pages)/publishers，字段投影风格对齐 `toEntryDetailFields`；失败返回 null 静默）
4. 测试：parse 至少 3 fixture（含无 cover、无 author、subject 截断、多作者取首）；toBookResult 字段映射；点选 detail 解析 fixture

验收：`tests/openLibrary.test.ts` 绿；book 组搜索实际出现 Open Library 结果（真实网络冒烟若不可用则记录待用户手测）；注册后 T3 回归门中 book 默认链第二源生效。

## T5 客户端 · googleBooks（book，默认关，自选）

涉及：`src/services/googleBooks.ts`、`main.ts`、`tests/googleBooks.test.ts`

1. 端点：`https://www.googleapis.com/books/v1/volumes?q={query}&maxResults=20`（有 `settings.googleBooksApiKey` 时拼 `&key=`——key 读取走 T3 动态 key 逻辑，未配即不带 key 请求，429 属限流不弹 Notice）
2. `parseGoogleBooksResults(text)`：`items[]` → id/volumeInfo.title/authors/publisher/publishedDate(取 4 位年)/pageCount/categories(截3)/description/imageLinks.thumbnail/industryIdentifiers(优先 ISBN_13→isbn)/infoLink；`toBookResult`：source=`'googleBooks'`、sourceUrl=`https://books.google.com/books?id={id}`；title 无则滤
3. main.ts 注册 book 组 runner（默认链不含 googleBooks，仅用户自选后参与）
4. 测试：≥3 fixture（无 imageLinks、publishedDate 仅年、industryIdentifiers 缺 ISBN_13、categories 空）

## T6 客户端 · steam（game，默认开）

涉及：`src/services/steam.ts`、`main.ts`、`tests/steam.test.ts`

1. 端点**接入时校准**：优先 Steam store suggest（`https://store.steampowered.com/search/suggest/{query}/?cc=US&l=english`，返回含 appid/name/logo 的 JSON-ish 数据；实际解析以校准实测为准并固定 fixture）。不得依赖需登录/需 Steam Web API Key 的端点
2. `parseSteamResults` / `toGameResult`：id=appid(number)；title=name；cover=竖版 `https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900.jpg`（或校准所得可靠图床）；source=`'steam'`；sourceUrl=`https://store.steampowered.com/app/{appid}`；summary/developer 搜索级无则不填（B3 深度回填范围外）
3. main.ts 注册 game 组 runner
4. 测试：parse ≥3 fixture（编码/空结果/异常条目容错）；toGameResult 映射；**若端点校准失败（无公开可用检索）→ 停止并回报 controller 决策，不得伪实现**

## T7 客户端 · musicbrainz（music，默认开）

涉及：`src/services/musicbrainz.ts`、`main.ts`、`tests/musicbrainz.test.ts`

1. 端点：`https://musicbrainz.org/ws/2/release-group/?query={query}&fmt=json&limit=20`（URL 编码；若需加 `release-group` 检索词形如 `releasegroup:{q}` 以校准实测为准）；User-Agent 建议设置（MusicBrainz 要求标识 UA，沿用 nodeHttp 可扩展性，如不支持则仅记录）
2. `parseMusicBrainzResults` / `toMusicResult`：id=release-group id；title=title；artist=artist-credit[0].name（有 joinphrase 拼）；year=first-release-date 前 4 位；album=title（对齐 MusicSearchResult 语义：album 字段存所属专辑名）；cover=`https://coverartarchive.org/release-group/{id}/front`（仅作 URL 展示，404 时 UI 占位，**不在搜索时请求探测**）；source=`'musicbrainz'`；sourceUrl=`https://musicbrainz.org/release-group/{id}`；source? 注意 resultTypes.MusicSearchResult 字段齐全性
3. main.ts 注册 music 组 runner（默认链 music=douban→musicbrainz→itunes，注册先后与 T8 无依赖）
4. 测试：≥3 fixture（artist-credit 多作者/joinphrase、无 first-release-date、primary-type 过滤或保留决策以实测为准）；**注意避免 CI 中触发 ~1rps 限制（单测全 fixture 不联网）**

## T8 客户端 · itunes（music，默认开）

涉及：`src/services/itunes.ts`、`main.ts`、`tests/itunes.test.ts`

1. 端点：`https://itunes.apple.com/search?term={query}&entity=album&limit=20`（URL 编码）
2. `parseItunesResults` / `toMusicResult`：id=collectionId(number)；title=collectionName；artist=artistName；year=releaseDate 前 4 位；album=collectionName；cover=artworkUrl100 中 `100x100bb` 替换为 `600x600bb`（正则校准）；summary=无或 primaryGenreName；source=`'itunes'`；sourceUrl=collectionViewUrl（结果自带，直填）
3. main.ts 注册 music 组 runner；结果与 musicbrainz 并存（mergeBySource 跨源同名保留）
4. 测试：≥3 fixture（artwork 放大、无 artwork、releaseDate 畸形容错）

## T9 客户端 · omdb（movieTv，默认关，需 Key）

涉及：`src/services/omdb.ts`、`src/Settings.ts`（T1 已加字段，本任务确认读取）、`main.ts`、`tests/omdb.test.ts`

1. 端点：`https://www.omdbapi.com/?apikey={key}&s={query}&type=movie|series&page=1`；未配 key → runner 不启动（unconfigured）
2. `parseOmdbResults(text, mediaType)`：`Search[]`（Title/Year/imdbID/Type/Poster）→ 按 mediaType 过滤 Type 或信任 `type=` 参数；id=imdbID(字符串，注意下游类型)；year=Year 解析（`1999`/`1999–` 容错）；poster：`N/A`→undefined；source=`'omdb'`
   - **结果类型决策**：影视结果现为 `TmdbSearchResult`（id:number）——omdb imdbID 为字符串，禁止强塞 TmdbSearchResult。方案：在 `services/resultTypes.ts` 或 searchDisplay 联合类型新增 `OmdbSearchResult`（字段以 TmdbSearchResult 可选子集 + id:string + imdbID），shape 分支用现有影视分支安全兼容（缺字段可选读取）；merge/sort 仅依赖 title/source，兼容
3. 点选轻量补全：`onFetchOmdbDetail` → `?apikey=&i={imdbID}&plot=full` 补 Title/Year/Director/Actors(截5)/Genre(截3)/Plot/Poster/imdbRating/imdbVotes（`imdbVotes` 去逗号）→ 字段投影返回表单可填 Record；失败 null 静默
4. main.ts 注册 movieTv 组 runner；EntryModal/EntryForm 点选分派新增 omdb handler
5. 测试：parse ≥3 fixture（N/A Poster、Year 范围、多结果）；detail 解析 fixture；映射决策写测试断言

## T10 客户端 · anilist（anime，默认关）

涉及：`src/services/anilist.ts`、`main.ts`、`tests/anilist.test.ts`

1. GraphQL POST `https://graphql.anilist.co`：`query ($s: String) { Page(page:1, perPage:20) { media(search:$s, type:ANIME, sort:SEARCH_MATCH) { id title { romaji english native } coverImage { large } startDate { year } genres meanScore studios { nodes { name } } description(asHtml:false) } } }`；nodeHttpPost 注入（参照 nodeHttp.ts 能力）
2. `parseAnilistResults(text)` / `toBangumiResult`：id=number；title=romaji（或 english/native 优先级以校准为准）；year=startDate.year；cover=coverImage.large；genres 截3；rating=meanScore（换算 10 分制：/10 或保留百分制需与 UI 展示语义一致——检查现有 rating 展示假设，决策写入测试）；studio=studios.nodes[0].name；source=`'anilist'`；sourceUrl=`https://anilist.co/anime/{id}`
   - 与 omdb 同理：anime 结果现为 `BangumiSearchResult`（bgm.tv id:number 语义）——若字段冲突新增源类型或扩展联合（以 shape 分支兼容为原则，决策写测试）
3. main.ts 注册 anime 组 runner（默认链不含 anilist，自选参与）
4. 点选轻量补全：可选（搜索级已含 genres/studio/desc/rating，若搜索字段足够则无需额外 detail 请求——据此决策，避免多余 GraphQL 往返）
5. 测试：≥3 fixture（title 语言优先级、startDate 缺年、meanScore 缺失、studios 空）

## T11 设置页服务集成两折叠项重构（Settings.ts + styles.css）

涉及：`src/Settings.ts`、`styles.css`；ASCII 规格 = spec S5（最新版：两折叠项）；用户拍板：勾选后组内可调序（豆瓣可移出首位）；旧「源链」小按钮/折叠行交互完全移除、勾选面板唯一入口

1. **折叠项一 · API 管理**：遍历 `PROVIDERS.filter(hasKeyField && implemented)`（= Douban/TMDB/Bangumi/OMDb/Google Books 5 源）→ 每源一条配置项（源名 + 状态徽标 已配置/未配置/可选 Key）；点击展开该源配置区（保持在设置页内，点击外部/Esc 关闭；复用 createSecretField 密文显示/隐藏 + `rl-*` 主题变量）：
   - 内容：密文输入 + hint（PROVIDER_META.hint）+「测试连接」按钮 + ✓/✗ · Nms（Douban/TMDB/Bangumi 走既有 plugin.testXxx；OMDb/Google Books 走 main 侧 `testOmdbConnection`/`testGoogleBooksConnection`——T9/T5 服务已具备，失败给未配/网络文案）
   - 输入 onChange 写 settings[keyField] + saveSettings + 刷新状态徽标
2. **折叠项二 · 数据源启用**：五分类按「书籍/影视/动画/音乐/游戏」顺序渲染 5 行；每行 = 组标签 + 该组全部适用源 checkbox（checkbox + 源名 + 已配置/免Key 徽标）+ 组内 ↑↓ 调序（对勾选源上移/下移）：
   - 勾选集合 + 组内顺序 = 该组 sourceChains（有序数组）；默认勾选态 = DEFAULT_CHAINS 成员
   - 任一 checkbox / ↑↓ 变更 → normalize → 等于 DEFAULT_CHAINS 删键(undefined) → saveSettings → 重渲染（保存语义沿用 B1 commit()）
   - 每组候选 ≤3（注册表天然约束），无需「添加源」交互
   - 行内小字提示「第 1 个为主力源不限时」；豆瓣可被移出首位
   - 分组折叠展开清晰、分类可区分；后续新增源 = 行内自动多一 checkbox（便于维护）
3. **移除旧实现**：删除 `createChainRow/createSourceRow`（B1 折叠行）与既有凭据大折叠行；若 B1 后已落地小按钮/浮层形态（以现状代码为准）一并替换为两折叠项；`rl-src-*` 折叠相关类确认无引用后清理（避免死样式）
4. 折叠项头可点击展开/收起（两折叠项默认展开）；展开态滚动不溢出设置页；暗色主题变量一致
5. UI 验收 = spec S5 ASCII 全要素；本任务不做纯函数测试（Settings DOM 层），saveSettings/chain 语义走既有纯测试；构建后手工冒烟项列 T12

## T12 全链回归验证 gate

1. 全量 `npx vitest run` 全绿（预期 599 + 新增源测试）；`npx tsc --noEmit` 0 诊断
2. `npm run build` EXIT 0；产物拷贝 build/ + `sync_plugin.ps1` 同步测试库（PowerShell，路径 `C:\Users\kest\Desktop\临时测试库`）
3. 三产物（main.js/styles.css/manifest.json）`cmp` 逐字节 IDENTICAL
4. 产物符号断言：新源 id 字面量各 ≥1（openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist）、`omdbApiKey` 存在、旧 `doubanUnavailableError` 不存在、设置按钮类名（如 rl-btn-*）在 styles.css ≥1；中文文案用大写 hex 形态 grep
5. 手工冒烟清单（用户测试库执行）：
   - 设置 → 服务集成：两折叠项——① API 管理（Douban/TMDB/Bangumi/OMDb/Google Books 5 源聚合、展开/收起、密文显示/隐藏、测试连接 ✓/✗）；② 数据源启用（书籍/影视/动画/音乐/游戏 5 行、勾选/取消、组内 ↑↓ 调序、默认勾选态 = 默认链、折叠开合）
   - 默认链：书籍搜索出现豆瓣+Open Library；游戏豆瓣+Steam；音乐豆瓣+MusicBrainz+iTunes；影视豆瓣+TMDB；动画豆瓣+Bangumi
   - 点选各来源结果 → 表单字段回填 → 保存条目 → 列表/详情展示正常、来源直达可开
   - OMDb：填 Key 后影视组自选加入 omdb → 搜索出现 IMDb 结果；Google Books：可选 Key（未配也工作）
   - 移除/调序/加回源（含把 douban 移出链）→ 持久化（重开设置页仍在）；链空整链无效回退默认

## T13 文档与提交

1. `Project-Rule/CHANGELOG.md`：未发布节顶部横幅（标题 + 要点：① 7 新源接入 + 默认链变化说明 + ② 设置页服务集成小按钮化 + ③ 单源失败静默降级收敛 + 验证链 commit 范围 + B3 详情回填待办）
2. `Project-Rule/current-progress.md`：追加 **#165** 行（设计修订 → T1-T12 各任务要点 → 验证 → B3 待办）
3. `.workbuddy/memory/YYYY-MM-DD.md` 工作日志追加；MEMORY.md 如有长期约定变化同步
4. 最终 commit（docs）；确认工作区干净、提交链完整

---

## 依赖与次序
T1 → T2（可与 T4+ 并行）→ T3 → T4-T10（彼此独立，可并行推进；每源完成即随默认链生效）→ T11（依赖 T1/T3/T9 key 判定，可在 T4-T10 中途并行）→ T12 → T13。
风险决策上报点：T6 端点校准失败（Steam 无公开检索）、T9/T10 结果类型冲突、T3 行为漂移——遇到即停，回报 controller，不得绕路实现。
