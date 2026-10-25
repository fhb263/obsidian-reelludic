// 数据源注册表与源链解析（纯数据 + 纯函数，无 obsidian 依赖，可单测）
// T1（#165）：全 10 源 implemented=true；IGDB 回归后全 11 源——douban/tmdb/bangumi 之外，
// openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist/igdb 八条注册位源全部接入，自动进入设置 UI 候选与 normalize 链。
// implemented 布尔与 normalize 过滤保留：未来新增注册位源仍自动隐藏，置 true 即接入。
// 凭据全局唯一共享：keyField/keyField2 为 ReelLudicSettings 字段名（type-only，不 import Settings 避免依赖链；
// keyField2 供双凭据源使用，如 igdb 的 Client Secret——见下方 meta，已配置判定需两字段同有值）。
import type { BookKind, EntryType } from 'data/types';
import { SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';

/** 数据源 id（全量注册位） */
export type ProviderId =
    | 'douban' | 'tmdb' | 'bangumi'
    | 'openLibrary' | 'googleBooks' | 'steam' | 'musicbrainz' | 'itunes' | 'omdb' | 'anilist' | 'igdb'
    | 'mangadex' | 'weread';

/** 源链配置组：六组（movie/tv 共用 movieTv；书籍/游戏/音乐/影视/动画 + 漫画）。
 *  🔴 2026-09-30 用户裁定**加回 comic 组**（1.0.3.1 曾随漫画子视图下线，2026-09-13 裁定）：漫画**独立成组**、主源豆瓣。
 *     ⚠️ 追加在**末尾**（与 1.0.3 当时「第六源链组」的同一位置），⛔ 别插在中间 ——
 *        组序会牵动设置页行序与产物断言里的分组锚点。 */
export type SourceGroup = 'book' | 'game' | 'music' | 'movieTv' | 'anime' | 'comic';

export const SOURCE_GROUPS: readonly SourceGroup[] = ['book', 'game', 'music', 'movieTv', 'anime', 'comic'];

/** 组标签（设置页折叠行头、摘要文案） */
export const GROUP_LABELS: Record<SourceGroup, string> = {
    book: '书籍',
    game: '游戏',
    music: '音乐',
    movieTv: '影视',
    anime: '动画',
    comic: '漫画',
};

/** 条目类型 → 源链组（movie/tv 共用 movieTv；其余类型即组） */
export function sourceGroupForType(t: EntryType): SourceGroup {
    return t === 'movie' || t === 'tv' ? 'movieTv' : t;
}

/**
 * 书籍子分类 → 源链组。🔴 2026-09-30 用户裁定：漫画**独立成组**（主源豆瓣），文学 / 网文 / 未指定沿用 book 组。
 *
 * ⚠️ 写成两条 `if`，⛔ 别写成 `kind === 'comic' ? 'comic' : 'book'` 三元 ——
 *    那条形态是 1.0.3.1 删漫画时的产物形态（断言里按「不许回来」锚着），加回后改用本函数，
 *    断言也一并换成锚这里的 if 形态（见 assert-symbols 的漫画组路由条）。
 * ⚠️ 漫画不改 `sourceGroupForType`：comic 不是 EntryType（它是 book 的 bookKind 子类）——
 *    拿 type 问组的地方（如 movieTv 分流）必须保持「只有 Type 无 Kind」的语义。
 */
export function sourceGroupForBookKind(kind: BookKind | undefined): SourceGroup {
    if (kind === 'comic') return 'comic';
    return 'book';
}

export interface ProviderMeta {
    id: ProviderId;
    /** UI 徽标/摘要名 */
    label: string;
    /** 适用组 */
    groups: readonly SourceGroup[];
    /** 平台域名（识别「用户手填的平台链接属于哪个源」用，见 `providerFromUrl`）。
     *  写**上级域**即可覆盖其子域（`store.steampowered.com` 由 `steampowered.com` 命中）；
     *  ⛔ 别写成 URL 或带 `www.`（比对前会先归一掉 `www.`）。 */
    hosts: readonly string[];
    /** 凭据字段名（ReelLudicSettings 键；null = 免 Key）——全局唯一共享 */
    keyField: string | null;
    /** 第二凭据字段名（双凭据源专用，如 IGDB Client Secret；单凭据源省略/undefined）。非 null 时「已配置」判定需两字段同时有值 */
    keyField2?: string | null;
    /**
     * 🔴🔴 #690（1.4.1，用户报障 2026-10-20）：「tmdb 我填了 API 连接成功但未填 id，为什么显示未配置」。
     *
     * 「已配置」徽标的判据 = **搜索能不能用**，不是「同步能不能跑」。
     *   · 缺省（undefined）= 主凭据（`keyField`）与第二凭据（`keyField2`）**都得有** —— IGDB 的
     *     Client ID + Client Secret 是一对，少一个连 **token 都换不出来**，搜索直接废 ⇒ 双缺即未配置，口径不变。
     *   · **显式声明 =「只有主凭据是搜索的硬前置」**：TMDB 的 Session ID 只服务**账号同步**
     *     （watchlist / favorite），搜索走 API Key 就够 ⇒ 只填 API Key 应当显示「已配置」。
     *     用户上一轮实测「测试连接 ✓ 成功，徽标却写未配置」，就是这两处判据**互相打架**（测试只查 API Key）。
     *   ⚠️ 只影响**徽标文案**；同步入口（`renderTmdbSyncButton` / `TmdbSyncModal.readAll`）
     *      在发请求前仍会自己拦「还缺 Session ID」—— ⛔ 别因为本字段把同步的前置校验也放宽了。
     */
    keyField2OptionalForConfigured?: boolean;
    /** 已实现（可被搜索/进设置候选）；false = 注册位 */
    implemented: boolean;
    /**
     * 🔴🔴 #597：**是否国内源**（用户 2026-10-10：「失效检测仅检测元数据源的国内源和音乐源凭据的国内源，
     * 如 TMDB、Bangumi、Google Books、IGDB 不检测」）。
     *
     * ⛔ **必填**（不是 `?`）—— 新增数据源时必须**主动表态**自己算不算国内源；
     * 写成可选就会出现「忘了写 ⇒ 悄悄被排除在自检之外」那种沉默错误。
     * 🔴 唯一使用点 = `pure/credentialCheck.configuredCredentialChecks`（开机凭据自检的源名单）；
     * ⛔ 别拿它去筛搜索源 / 设置页凭据行 —— 那些地方的用户口径与「该不该自检」是两回事。
     */
    domestic: boolean;
    /**
     * 空态徽标文案（`keyField` 为空时设置页凭据行右侧显示的那两个字）。
     *
     * 🔴 存在的理由：徽标的默认两态是「未配置 / 可选 Key」，而后者里的 **Key** 是**写死**的 ——
     *    #580 的微信读书凭据是**Cookie 不是 Key** ⇒ 借用「可选 Key」会让用户在凭据栏里找一个
     *    根本不存在的 key。有此字段的源按它显示，其余源一字不变（⛔ 别顺手把所有源都写成这个字段）。
     * ⚠️ **仅对「未配置」态生效**：一旦填了值，徽标恒为「已配置」（与所有源同一条口径）。
     */
    emptyBadge?: string;
    /**
     * 设置页说明文案（凭据行展开后的那行提示）。
     *
     * 🔴 **#489 口径（用户 2026-10-02：「元数据源凭据项下只说明：获取网址、平台特色、用途就行了」）**：
     *    只写三段，**顺序固定**、每段以「获取：/ 特色：/ 用途：」起头 —— 用户扫一眼就知道
     *    去哪拿、这个源好在哪、它参与哪类搜索。⛔ 别把**实现细节**（走哪个接口 / type=1 /
     *    静默降级 / 索引什么别名）写进来，那些属于代码注释，不属于用户要读的一行。
     *    ⚠️ 本条**只管需凭据的那六个源**（`KEY_SOURCE_ORDER`）；免 Key 源不渲染凭据行，
     *       它们的 hint 保留原样（注册位数据按红线只增不删）。
     *    🔴🔴 **2026-10-20 用户裁定：`用途：` 段按该源服务的类别写「返回 X 元数据」。**
     *     用户原话：「还有一些源的描述文案去掉这些『用途：书籍的并排源，与豆瓣一起参与搜索』；
     *     改成『用途：返回书籍等元数据源』」→ 随后修正：「用途描述按对应服务的类来改啊：『返回书籍（影视等）元数据』」。
     *     ⇒ ① 原来按源写「X 的并排源 / 第二源 / 第三源 / 默认首源 / 补充源」那一套**全部收掉**：
     *          哪一类搜索由「元数据搜索源启用」那张表的勾选决定，凭据行里再讲一遍既重复又容易过期。
     *       ② **类别必须按 `groups` 写，⛔ 不许一律套「书籍」** —— TMDB / OMDb 是 movieTv（影视），
     *          Bangumi 是 anime+comic（动画、漫画），Steam / IGDB 是 game，MusicBrainz / iTunes 是 music。
     *          类别名的真源 = `GROUP_LABELS`（书籍 / 影视 / 动画 / 漫画 / 音乐 / 游戏）。
     *       ③ 只服务**一个**组 ⇒「返回书籍元数据」；**多组** ⇒ 按 `SOURCE_GROUPS` 顺序**全列举**，
     *          不再用「等」字收尾（豆瓣六组全占 ⇒「返回书籍、游戏、音乐、影视、动画、漫画元数据」）。
     *     ⚠️ 段后若还有该源**专属的凭据提示**（豆瓣「缺 Cookie 会 403」、微信读书「Cookie 只在同步书架时需要」、
     *       TMDB「API Key 参与搜索，Session ID 用于同步…」）**逐字保留**，只换「用途：」开头那一句。
     *       ⛔ Steam 不在此列：它的长尾「个人资料与愿望单需公开可见」是硬前置，不是用途描述。
     */
    hint: string;
}

export const PROVIDERS: readonly ProviderMeta[] = [
    {
        id: 'douban', label: '豆瓣', groups: ['book', 'game', 'music', 'movieTv', 'anime', 'comic'], hosts: ['douban.com'],
        keyField: 'doubanCookie', implemented: true,
        domestic: true,
        hint: '获取：登录 douban.com 后按 F12，复制任意请求的 Cookie（含 dbcl2）。特色：中文条目最全，带评分、评价人数与简介。用途：返回书籍、游戏、音乐、影视、动画、漫画元数据；缺 Cookie 会 403。',
    },
    // 🔴 #580：微信读书（book 组第三源；用户 2026-10-09 点名「新增微信读书搜索源导入」）。
    //    位置紧跟豆瓣 —— 书籍组候选顺序 = 本表顺序 ⇒ 启用组那一行读作
    //    「豆瓣 / 微信读书 / Open Library / Google Books」（与用户原话的列举同序）。
    //    ⚠️ `keyField` 是 **Cookie** 而非 Key：**搜索本身免登录**（实测），
    //       Cookie 只在「测试连接」与后续的「从微信读书同步书架」里用得上 ⇒ 空 Cookie 时
    //       它**照常参与搜索**（`OPTIONAL_KEY_SOURCES` / `OPTIONAL_KEY_AUX` 两处都放行，见各自注释）。
    {
        id: 'weread', label: '微信读书', groups: ['book'], hosts: ['weread.qq.com'],
        keyField: 'wereadCookie', implemented: true,
        domestic: true, emptyBadge: '可选 Cookie',
        hint: '获取：登录 weread.qq.com 后按 F12，复制任意请求头里的整条 Cookie。特色：中文电子书与网络文学平台，条目自带简介、出版方与评分。用途：返回书籍元数据；Cookie 只在同步书架时需要。',
    },
    {
        id: 'tmdb', label: 'TMDB', groups: ['movieTv'], hosts: ['themoviedb.org'],
        // 🔴 #665：双凭据源（keyField2 = session_id）—— 搜索只用 API Key，账号同步（watchlist / favorite）
        //    必须再有一个 session_id。
        // 🔴🔴 #690（用户报障「填了 API Key 连接成功却显示未配置」）：与 igdb **不再同构** ——
        //    igdb 两个字段是一对（换不出 token 就搜不了），tmdb 的 session_id **只服务同步** ⇒
        //    已配置判定**只看 API Key**（`keyField2OptionalForConfigured`，判据见 createApiKeyRow 的 refreshBadge）。
        //    上一版按 igdb 同构写「两字段同有值」，与「测试连接」（只查 API Key）**互相打架**，用户一眼就撞上了。
        keyField: 'tmdbApiKey', keyField2: 'tmdbSessionId', keyField2OptionalForConfigured: true, implemented: true,
        domestic: false,
        hint: '获取：themoviedb.org 注册后到「设置 → API」申请 API Key（免费）；同步个人清单需再生成 Session ID（同页「请求一个会话 ID」）。特色：全球影视库，海报、剧集与演职员齐全。用途：返回影视元数据；API Key 参与搜索，Session ID 用于同步想看清单与收藏。',
    },
    {
        id: 'bangumi', label: 'Bangumi', groups: ['anime', 'comic'], hosts: ['bangumi.tv', 'bgm.tv'],
        keyField: 'bangumiToken', implemented: true,
        domestic: false,
        hint: '获取：bgm.tv 的「设置 → 开发」创建 Access Token。特色：中文动画与漫画条目最全，含章节与放送信息。用途：返回动画、漫画元数据。',
    },
    {
        id: 'openLibrary', label: 'Open Library', groups: ['book'], hosts: ['openlibrary.org'],
        keyField: null, implemented: true,
        domestic: false,
        hint: 'Open Library（免 Key）：返回书籍元数据 —— openlibrary.org 开放检索，书名/作者/出版社/年份/ISBN/封面。',
    },
    {
        id: 'googleBooks', label: 'Google Books', groups: ['book'], hosts: ['books.google.com'],
        keyField: 'googleBooksApiKey', implemented: true,
        domestic: false,
        hint: '获取：console.cloud.google.com 启用 Books API 后创建 API Key。特色：书目元数据较全，含 ISBN、页数与分类。用途：返回书籍元数据；Key 可选，不填也能用，只是免费额度受限。',
    },
    {
        id: 'steam', label: 'Steam', groups: ['game'], hosts: ['steampowered.com', 'steamcommunity.com'],
        // 🔴 #639：**搜索/详情仍然免 Key**（storefront API），但**同步库与愿望单要 Web API Key**
        //    ⇒ 这里挂上凭据字段，设置页才渲染凭据行（用户要的「新增 steam 凭据入口」）。
        // 🔴 #640e（1.4.0，用户点名）：「这个元数据配置源 steam 未配置标签**改成『未配置』**」——
        //    原先 `emptyBadge: '可选 Key'`。⛔ 已删除该字段 ⇒ 走全组统一的两态（已配置 / 未配置）。
        //    ⚠️ 「可选 Key」那套原本是为「不填也能用」的源准备的（googleBooks / weread 仍在
        //       `OPTIONAL_KEY_SOURCES` 里）；Steam 的 Key **不填就同步不了**，
        //       标「可选」反而误导 ⇒ 按用户要求统一成「未配置」。
        keyField: 'steamApiKey', implemented: true,
        domestic: false,
        // 🔴🔴 #641（1.4.1，用户点名）：「steam 凭据行上的副标题取消并移动到（获取：… 用途：…）后面」。
        //    ⇒ 原先挂在**行头副标题**（`.rl-key-sub`，`Settings.credentialSubtitle`）的那条
        //      「公开可见」硬前置，现在**收进本 hint 的末尾**（副标题已取消）。
        //    ⚠️ 位置 = 三个既有段落（获取 / 特色 / 用途）**之后** —— 用户给的落点逐字是「后面」。
        //    ⚠️ 文案里的引号用「」：本行是纯文本（`createDiv({text})`），⛔ 别写 markdown。
        hint: '获取：steamcommunity.com/dev/apikey（另需 64 位 SteamID）。'
            + '特色：搜索免 Key；填 Key 后可同步游戏库、愿望单与游玩时长。'
            + '用途：返回游戏元数据与「同步 Steam」。'
            + '「个人资料」与「愿望单」需设为公开可见，否则读不到库、同步会失败。',
    },
    {
        id: 'musicbrainz', label: 'MusicBrainz', groups: ['music'], hosts: ['musicbrainz.org'],
        keyField: null, implemented: true,
        domestic: false,
        hint: 'MusicBrainz（免 Key）：返回音乐元数据 —— 厂牌/年份/专辑-曲目关系规范，中文曲库一般。',
    },
    {
        id: 'itunes', label: 'iTunes', groups: ['music'], hosts: ['music.apple.com', 'itunes.apple.com'],
        keyField: null, implemented: true,
        domestic: false,
        hint: 'iTunes（免 Key）：返回音乐元数据 —— 中文曲库 + 高清封面，与 MusicBrainz 互补。',
    },
    {
        id: 'omdb', label: 'OMDb', groups: ['movieTv'], hosts: ['imdb.com'],
        keyField: 'omdbApiKey', implemented: true,
        domestic: false,
        hint: '获取：omdbapi.com 申请免费 API Key（1000 次/日）。特色：IMDb 评分与上映信息，以英文为主。用途：返回影视元数据（IMDb 评分）；需在上方「元数据搜索源启用」勾上。',
    },
    {
        id: 'anilist', label: 'AniList', groups: ['anime'], hosts: ['anilist.co'],
        keyField: null, implemented: true,
        domestic: false,
        hint: 'AniList（免 Key，GraphQL）：返回动画元数据 —— 默认关，中文弱。',
    },
    {
        id: 'igdb', label: 'IGDB', groups: ['game'], hosts: ['igdb.com'],
        keyField: 'igdbClientId', keyField2: 'igdbClientSecret', implemented: true,
        domestic: false,
        hint: '获取：dev.twitch.tv/console/apps 注册应用，取得 Client ID 与 Client Secret。特色：游戏库覆盖广，含平台、发售日与评分。用途：返回游戏元数据；需在上方「元数据搜索源启用」勾上。',
    },
    {
        id: 'mangadex', label: 'MangaDex', groups: ['comic'], hosts: ['mangadex.org'],
        keyField: null, implemented: true,
        domestic: false,
        hint: 'MangaDex（免 Key）：返回漫画元数据 —— api.mangadex.org 公开检索。⚠️ 标题以日文罗马音/英文为主，但**索引中文别名**（实测搜「海贼王」能中 One Piece）；官方要求带可标识 User-Agent，并禁止用于含广告或付费的产品（本插件为本地个人工具，符合）。元数据来源：MangaDex。',
    },
];

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, ProviderMeta>;

/** 数据源英文展示名（头部「数据源：」列表与搜索进度汇总用；与中文/徽标文案区分） */
const SOURCE_EN: Record<ProviderId, string> = {
    douban: 'Douban', tmdb: 'TMDB', bangumi: 'Bangumi',
    openLibrary: 'Open Library', googleBooks: 'Google Books', steam: 'Steam',
    musicbrainz: 'MusicBrainz', itunes: 'iTunes', omdb: 'OMDb', anilist: 'AniList', igdb: 'IGDB',
    mangadex: 'MangaDex',
    weread: 'WeRead',
};

/** 源英文名（未知 id 原样返回，不崩）。⚠️ 非元数据源（在线曲库）没有英文名 ⇒ 回它与中文入口同一份展示名。 */
export function sourceEnLabel(id: ProviderId | string): string {
    return SOURCE_EN[id as ProviderId] ?? (extraSourceLabel(id) || id);
}

/**
 * 非「元数据源」的展示名（#464 在线曲库）—— 它**不进 PROVIDERS**（不进设置页勾选、不进 `sourceChains`，
 * 理由见 `pure/songLibrary` 文件头），但一样需要展示名：源头文案、来源徽标、以及选中结果后自动回填的
 * 「来源」框都经 `sourceLabel` / `sourceEnLabel` 取名字。
 * 🔴 值只从 `pure/songLibrary` 取（**单一真源**），⛔ 别在这里再写一遍字面量。
 */
const EXTRA_SOURCE_LABEL: Record<string, string> = { [SONG_LIB_ID]: SONG_LIB_LABEL };

/**
 * 取上表的展示名 —— **必须走 own-property 判定**。
 * 🔴 踩过：`EXTRA_SOURCE_LABEL['__proto__']` / `['constructor']` 会沿原型链取到 `Object.prototype`
 *    （一个对象，truthy 且不是 undefined）⇒ `sourceLabel('__proto__')` 会回 `{}` 而不是空串，
 *    角标上就会出现 `[object Object]`。老代码靠「原型链上的值没有 `.label` 属性」天然规避，
 *    这张**扁平字符串表**没有那层保护，只能用 `hasOwnProperty`。
 */
function extraSourceLabel(id: string | undefined): string {
    if (!id) return '';
    return Object.prototype.hasOwnProperty.call(EXTRA_SOURCE_LABEL, id) ? EXTRA_SOURCE_LABEL[id] : '';
}

/**
 * 源展示名（中文/规范写法），取注册表 `label` —— **单一真源**，改 PROVIDERS 即改所有调用点。
 * 用途：海报墙封面右上角评分角标（用户 2026-09-22「大众评分要显示数据源」）与它的 `data-tip`。
 * 未知 / 空的 id 一律回 `''`（角标退化为「数值★」，⛔ 绝不把 `undefined` 画到封面上）。
 * ⚠️ 实现上禁用 `id in PROVIDER_META` 判存在 —— 那会沿原型链把 `toString` / `__proto__` 判为合法；
 *    这里靠 `?.` + `?? ''`：原型链上取到的值没有 `label` 属性，自然落回空串。
 */
export function sourceLabel(id: ProviderId | string | undefined): string {
    if (!id) return '';
    return PROVIDER_META[id as ProviderId]?.label ?? extraSourceLabel(id);
}

/** 源英文名列表 join（头部/进度汇总用；空 → ''） */
export function sourceEnList(ids: readonly (ProviderId | string)[]): string {
    return ids.map(sourceEnLabel).join(' / ');
}

/**
 * URL 主机名 → 归一化（小写、去掉 `www.`、去端口）；非 `http(s)` 绝对地址回 `''`。
 * ⛔ 手写正则切域名（`/^https?:\/\/([^/]+)/` 之类）会把 `user:pass@host` / 端口一起当主机名 ⇒ 用 `new URL`。
 */
function urlHost(raw: string | undefined): string {
    const s = String(raw ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(s)) return '';
    try {
        return new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

/**
 * 从「用户手填的平台链接」识别数据源（2026-09-27 #385）。
 *
 * 用途：新增条目时用户填了平台链接 ⇒ 让海报墙封面角标也能显示平台名（`豆瓣 8.4★`），
 * 与搜索回填的条目表现一致。识别真源就是注册表 `hosts`（⛔ 别在视图层另写手写小表：
 * #373 那张只覆盖 5 源、键名还写错了 `'google'` / `'openlibrary'`，导致多数源恒回空串）。
 *
 * 判据 = 主机名 **等于** 或 **以 `.` 前缀结尾** 于某条 `hosts`。
 * ⛔ 绝不用 `includes` —— `notdouban.com` / `douban.com.evil.io` 会被误判成豆瓣。
 * 认不出返回 `null`（视图层据此退化为「只显示数值★」，⛔ 不写 `entry.source`）。
 */
export function providerFromUrl(url: string | undefined): ProviderId | null {
    const host = urlHost(url);
    if (!host) return null;
    for (const p of PROVIDERS) {
        for (const h of p.hosts) {
            if (host === h || host.endsWith('.' + h)) return p.id;
        }
    }
    return null;
}

/** 「用户手填的平台链接」→ 平台展示名（认不出回 `''`，角标退化为纯数值）。 */
export function platformLabelFromUrl(url: string | undefined): string {
    return sourceLabel(providerFromUrl(url) ?? '');
}

/** 各组默认链（T1 落上游 D2 表：book=douban+openLibrary；game=douban+steam；music=douban+musicbrainz+itunes 3 源满链；movieTv/anime 沿用 douban+tmdb/bangumi 不变；googleBooks/omdb/anilist 默认关、用户自选加入；链首 douban 为主力源不限时。
 *  🔴 2026-09-30 用户裁定**加回 comic 组**并接三个源：「设置里漫画源接豆瓣、Bangumi、MangaDex 三个源」
 *     ⇒ `comic = douban（主）+ bangumi（type=1 书籍类目）+ mangadex`。
 *     ⚠️ 与 1.0.3 那版不同 —— 当时是 `['bangumi', 'douban']`（Bangumi 主源、两源），且 Bangumi 书籍搜索
 *        后来被整块删掉了；那份实现**没回来**（现在走参数化的 subjectType + 新写的 MangaDex 客户端）。
 *     ⚠️ bangumi 需要 Access Token：未配置时它在这条链里静默降级（unconfigured），漫画仍能用豆瓣 + MangaDex。 */
// 🔴 #580：**微信读书不进任何默认链**（book 仍是 douban + openLibrary）—— 它是**用户自选**才加入的源
//    （与 googleBooks / omdb / anilist 同一条口径：新源默认关 ⇒「升级后搜索结果与旧版逐条一致」）。
//    要加它 = 到「设置 → 元数据源配置 › 元数据搜索源启用」把「书籍」那一行的**微信读书**勾上。
export const DEFAULT_CHAINS: Record<SourceGroup, readonly ProviderId[]> = {
    book: ['douban', 'openLibrary'],
    game: ['douban', 'steam'],
    music: ['douban', 'musicbrainz', 'itunes'],
    movieTv: ['douban', 'tmdb'],
    anime: ['douban', 'bangumi'],
    comic: ['douban', 'bangumi', 'mangadex'],
};

/**
 * 归一源链：剔除非法 id / 不适用本组 / 未实现源 / 重复项，保序。
 * 返回空数组表示整链无效（调用方回退默认链）。
 */
export function normalizeSourceChain(group: SourceGroup, chain: ProviderId[]): ProviderId[] {
    const seen = new Set<ProviderId>();
    const out: ProviderId[] = [];
    for (const id of chain) {
        const meta = PROVIDER_META[id];
        if (!meta) continue;
        if (!meta.groups.includes(group)) continue;
        if (!meta.implemented) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * 解析某组当前生效源链：settings.sourceChains 缺省 / 空 / 整链被滤空 → 默认链。
 * 用户配置只要留有一个合法源即尊重其顺序（可把 douban 挪位/移出）。
 */
export function resolveSourceChain(
    cfg: Partial<Record<SourceGroup, ProviderId[]>> | undefined,
    group: SourceGroup,
): ProviderId[] {
    const saved = cfg?.[group];
    if (!saved || saved.length === 0) return [...DEFAULT_CHAINS[group]];
    const norm = normalizeSourceChain(group, saved);
    return norm.length > 0 ? norm : [...DEFAULT_CHAINS[group]];
}

// ── 全链失败错误文案（设置区顶层标题已改：原「服务集成」撤除 → 数据源配置 / AI集成 各自成标题，
//    故路径文案按新层级写：`元数据源配置 › 元数据搜索源凭据 · Douban`）──
// 批B：每条文案除「哪里出问题」外必须给出「怎么办」，且路径具体到设置项名，避免用户去设置页里自己翻找
const ERR_COOKIE_INVALID = '豆瓣 Cookie 已失效或过期 — 请到 设置 → 元数据源配置 › 元数据搜索源凭据 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试';
const ERR_DOUBAN_UNREACHABLE = 'Douban 兜底不可用 — 到 设置 → 元数据源配置 › 元数据搜索源凭据 · Douban 填登录态 Cookie（含 dbcl2）过反爬；若 Cookie 正常，多为搜索过密触发风控，稍等几分钟再试或改用其他数据源';
const ERR_ANIME_NO_TOKEN = '未配置 Bangumi Access Token，且 Douban 也未找到匹配结果 — 到 设置 → 元数据源配置 › 元数据搜索源凭据 填 Bangumi Token 可扩大动画结果覆盖';
const ERR_ANIME_COOKIE = ERR_COOKIE_INVALID + '，或填写 Bangumi Token';
const ERR_ANIME_UNREACHABLE = '未配置 Bangumi Access Token，且 Douban 兜底不可用 — 到 设置 → 元数据源配置 › 元数据搜索源凭据 · Douban 填登录态 Cookie，或填写 Bangumi Token';

/** 链内非 douban 源在本次搜索中的结果状态（调用方只在「整体无结果」时调用 derive，故无需 'ok'） */
export type AuxState = 'absent' | 'unconfigured' | 'failed' | 'empty';

export interface GroupErrorState {
    group: SourceGroup;
    /** 解析后的生效链（决定 douban 是否参与） */
    chain: ProviderId[];
    /** douban 参与时的状态（douban 在链时调用方必须提供本字段；不在链则缺省）；reachable=false 表示反爬/不可用（区别于无匹配） */
    douban?: { reachable: boolean; cookieInvalid: boolean };
    /** 链内非 douban 源状态：absent=链外；unconfigured=未配凭据；failed=已配但请求失败；empty=成功无匹配。缺省/未提供 = 该源不参与或无需提示（函数只读链内成员的 aux 状态，链外源由 chain 过滤，缺失键当「无失败」静默处理） */
    aux: Partial<Record<Exclude<ProviderId, 'douban'>, AuxState>>;
}

/**
 * 全链无结果时的错误文案推导（有结果时调用方不应调用——返回 null 不打扰）。
 * 优先级：douban 参与且不可达 → 豆瓣文案（anime 无 Token 时追加填 Token 尾巴）；
 * douban 正常无匹配 → 仅 anime 缺 Token 给提示，其余静默空结果；
 * douban 不在链 → 按各源 unconfigured/failed 汇总通用文案；全 empty → null。
 */
export function deriveGroupSearchError(s: GroupErrorState): string | null {
    const hasDouban = s.chain.includes('douban');
    if (hasDouban && s.douban) {
        const animeNoToken = s.group === 'anime' && s.aux.bangumi === 'unconfigured';
        if (!s.douban.reachable) {
            return s.douban.cookieInvalid
                ? animeNoToken ? ERR_ANIME_COOKIE : ERR_COOKIE_INVALID
                : animeNoToken ? ERR_ANIME_UNREACHABLE : ERR_DOUBAN_UNREACHABLE;
        }
        // douban 正常但无匹配
        if (animeNoToken) return ERR_ANIME_NO_TOKEN;
        return null;
    }
    // douban 不在链：仅当存在未配置/失败源才提示（全 empty = 正常空结果）
    // 按「原因」归组而非逐源罗列：同类多源合并成一项，避免括号里重复同一句话；
    // 处方也只按类别给一次（未配置 → 去哪里填；失败 → 重试或换源）
    const listed = s.chain.filter((id): id is Exclude<ProviderId, 'douban'> => id !== 'douban');
    const unconfigured = listed.filter((id) => s.aux[id] === 'unconfigured');
    const failed = listed.filter((id) => s.aux[id] === 'failed');
    if (unconfigured.length === 0 && failed.length === 0) return null;

    const labelOf = (ids: readonly ProviderId[]): string => ids.map((id) => PROVIDER_META[id].label).join('、');
    const causes: string[] = [];
    const fixes: string[] = [];
    if (unconfigured.length > 0) {
        causes.push(`${labelOf(unconfigured)} 未配置凭据`);
        fixes.push('到 设置 → 元数据源配置 › 元数据搜索源凭据 填入对应凭据后点「测试连接」');
    }
    if (failed.length > 0) {
        causes.push(`${labelOf(failed)} 请求失败`);
        fixes.push('请求失败多为网络不通或对方限流，可稍后重试或改用其他源');
    }
    return `所选数据源不可用（${causes.join('；')}）—— ${fixes.join('；')}`;
}
