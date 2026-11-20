// 数据层类型定义（schema 契约：只增不改）
import type { MediaStatus } from 'pure/status';
import type { Rating } from 'pure/rating';
import type { MediaView } from 'pure/mediaViews';
// 心情六档（#772 ⑳）：只取类型，`pure/mood` 不反向依赖本文件 ⇒ 无循环依赖
import type { MoodId } from 'pure/mood';
// ③ 单集评价的**类型**（判据在 `pure/episodeReview`，这里只要形状 —— 与 MoodId 同一手法：
// `data/types` 只声明接口，不引运行期逻辑，否则 `pure → data` 与 `data → pure` 会成环）。
import type { EpisodeReview } from 'pure/episodeReview';

// 六库扩展点：movie/tv/anime 影视动画，book/game 预留，music 已落地（平铺单选，schema 只增不改）
export type EntryType = 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music';

/** 书籍子分类（1.0.3）：book 文学（缺省，原「出版」）/ novel 网文 / comic 漫画 —— 阅读页签【全部/文学/网文/漫画】chips 维度（schema append-only）。
 *  🔴 2026-09-30 用户裁定**加回**「漫画」：阅读页签子分类恢复四桶，且漫画**独立成一个源链组**（主源豆瓣，见 pure/sourceRegistry）。
 *     ⚠️ comic 在 1.0.3.1 曾下线过（2026-09-13 裁定），本次是**加回** —— ⛔ 别再把 comic 当「已下线值」归一掉（旧注释已翻面）。 */
export type BookKind = 'book' | 'novel' | 'comic';

/** 音乐子分类：1.0.3.1 起音乐不再分子类（用户 2026-09-13 裁定删除「其他」）——合法值仅 music，
 *  收听页签子分类行与表单「音乐分类」选择已下线；字段按 schema append-only 保留，存量 other 读取时归一为 music，见 pure/musicKind。 */
export type MusicKind = 'music';

export const ENTRY_TYPES: readonly EntryType[] = ['movie', 'tv', 'anime', 'book', 'game', 'music'];

/**
 * 类型显示名（全仓唯一真源）。**改这里的字会连带**：合并视图「媒体类型」下拉 / 类型 chips /
 * 添加表单类型下拉 / 空态文案 / 库概览量词 / 系列折叠卡标题（`N 剧集系列`）/ 笔记「类型」行。
 * 🔴 2026-10-08（#555）：`tv` 由「电视剧」改为**「剧集」**（用户裁定，全局统一）。
 *    ⚠️ **历史笔记目录名不受影响** —— 那个走 `pure/dirs.LEGACY_TYPE_DIR_ZH`（已冻结为旧文案），
 *       ⛔ 不要再让任何「历史识别」逻辑引用本表（改了会让老目录搬不动）。
 */
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
    movie: '电影',
    tv: '剧集',
    anime: '动画',
    book: '书籍',
    game: '游戏',
    music: '音乐',
};

/** 类型 → 笔记子目录英文目录名（目录结构用：movie/teleplay/animation/book/game/music）。
 *  与 UI 中文标签 ENTRY_TYPE_LABELS 解耦（界面展示仍走中文，勿混用）。
 *  ⚠️ 书籍另有子分类分目录（文学 book/ 网文 novel/），由 pure/dirs.noteSubDir 统一裁决，勿在本表按 bookKind 分裂。 */
export const ENTRY_TYPE_DIRS: Record<EntryType, string> = {
    movie: 'movie',
    tv: 'teleplay',
    anime: 'animation',
    book: 'book',
    game: 'game',
    music: 'music',
};

/** 类型识别色（卡片色条/占位图主色）：电影蓝 / 剧集紫 / 动画粉 / 书籍绿 / 游戏橙 / 音乐青 */
export const TYPE_COLORS: Record<EntryType, string> = {
    movie: '#378ADD',
    tv: '#7F77DD',
    anime: '#D4537E',
    book: '#639922',
    game: '#EF9F27',
    music: '#2AA89B',
};

/** 色彩主题：彩色（类型色条 + 状态五色）/ 单色（关闭类型色条，仅状态色） */
export type ColorTheme = 'colorful' | 'mono';

/** 界面主题（1.0.3）：native 原生（默认，保持 Obsidian 克制风格）/ modern 现代 App 风 */
export type UiTheme = 'native' | 'modern';

export interface ProgressPoint {
    season: number;
    episode: number;
    date: string;
}

export interface Progress {
    season: number;
    episode: number;
    /** 总集数（可选，多季汇总展示 S2 E12/24 用） */
    totalEpisodes?: number;
    lastWatchedDate?: string;
    history: ProgressPoint[];
}

export interface WatchLink {
    label: string;
    url: string;
}

/**
 * 手动关联（#635）：指向另一条条目的 id + 自由关系词
 * （「原唱」/「翻唱」/「改编」…；留空 = 普通「关联」）。
 * 🔴 **只存出边**：B 侧的「被关联」由 `pure/relatedGraph.collectRelated` 渲染时算，⛔ 不写进 B 的数据。
 */
export interface RelatedLink {
    /** 目标条目 id（trim 后非空；指向自己不落库） */
    id: string;
    /** 关系词（自由文本，非白名单；trim 后为空则不落这个键 —— 缺省即「关联」） */
    label?: string;
}

/**
 * 单次**时长明细**（#685 泛化：游戏游玩 / 书籍阅读 / 音乐收听共用一套结构）。
 * 编辑表单 / 右键菜单「记录时长」录入 → 映射笔记对应章节：
 * 游戏 →「游玩记录」、书籍 →「阅读记录」、音乐 →「收听记录」。
 *
 * 🔴 字段名沿用 `PlaySession`（不重命名）：老数据里的 `playSessions` 数组直接可用，
 *    重命名会逼出一次数据迁移（这仓踩过 bookKind / summary / readUrl / gameUrl 静默丢弃的坑）。
 *    ⛔ 别把它当「游戏专属」——它现在是**跨类型的时长明细**。
 */
export interface PlaySession {
    /** 记录日期 YYYY-MM-DD */
    date: string;
    /** 本次时长（分钟） */
    minutes: number;
    /** 心得/备注（可选） */
    note?: string;
}

/**
 * 重温 / 周目记录（#685）：影视「重刷次数 + 感想」、游戏「周目序号 + 感想」。
 * 写入笔记「重温记录」/「周目记录」章节（**感想放笔记内**，用户原话）。
 * 🔴 与 `PlaySession`（时长明细）**分开存**：语义不同（次数 ≠ 时长），混在一起会让两种记录都读不懂。
 */
export interface RoundLog {
    /** 重温（影视重刷） / 周目（游戏通关轮次） */
    kind: 'rewatch' | 'playthrough';
    /** 记录日期 YYYY-MM-DD */
    date: string;
    /** 第几次（重刷次数 / 周目序号；从 1 起） */
    round: number;
    /** 感想（可选） */
    note?: string;
}

/**
 * #685 记录形态（**结构化记录**：日期 + 数字 + 心得）：
 * - `time` = 时长明细（游戏游玩 / 书籍阅读 / 音乐收听，共用 `PlaySession`）
 * - `rewatch` = 影视重温（`RoundLog.kind` 同源）
 * - `playthrough` = 游戏周目（`RoundLog.kind` 同源）
 * 🔴 唯一真源放这儿（⛔ 别在弹窗 / 视图里各写一份联合类型 —— 漂移过一次就得靠 grep 救火）。
 */
export type EntryLogKind = 'time' | RoundLog['kind'];

/**
 * **短评**（append-only 流水）：右键「添加短评」写入 → 笔记独立 `## 短评` 章节（日期倒序）。
 * 🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」。
 * ⚠️ 与 `RoundLog` 分开：那边是「第几次重刷/周目 + 感想」的结构，这边是纯一段文字 + 日期。
 * ⚠️ 与 `MediaEntry.notes`（个人评语正文）分开：`notes` 是用户手写的整段评语、可被表单与
 *    笔记回填双向维护；`commentLog` 只增不改，由模板重画。
 */
export interface CommentLog {
    /** 记录日期 YYYY-MM-DD（本地口径，与 `todayLocal` 一致） */
    date: string;
    /** 短评正文（多行原样保留） */
    text: string;
}

/**
 * #685 文本记录形态：**一段文字**（没有日期 / 数字那一套）
 * - `comment` = 短评 → 落 `commentLog`（笔记「短评」章节，**不再进个人评语**）
 * - `guide` = 攻略 → 落 `guide`（笔记「攻略」章节，仅游戏）
 */
export type EntryTextKind = 'comment' | 'guide';

export interface MediaEntry {
    id: string;
    type: EntryType;
    title: string;
    originalTitle?: string;
    status: MediaStatus;
    rating: Rating;
    year?: number;
    genres: string[];
    director?: string;
    cast: string[];
    /** 编剧（电影/电视剧，豆瓣详情回填） */
    screenwriter?: string[];
    /** 制片国家/地区（豆瓣详情回填） */
    country?: string;
    /** 语言（豆瓣详情回填） */
    language?: string;
    /** 片长（分钟，豆瓣详情回填） */
    durationMin?: number;
    /** 又名/别名（豆瓣详情回填） */
    aliases?: string[];
    /** 书籍子分类（缺省视为 'book'，展示为「文学」；分类唯一入口 = 搜索框类型下拉，归一见 pure/bookKind） */
    bookKind?: BookKind;
    /** 音乐子分类（1.0.3.1 起恒 'music'；页签子分类行与表单选择已下线，保留字段兼容存量 other，归一见 pure/musicKind） */
    musicKind?: MusicKind;
    /** 书籍作者（🔴 漫画里 = **原作 / 编剧**，画师另见 `artist`） */
    author?: string;
    /**
     * **画师**（漫画的作画；#444g 新增，append-only 可选字段）。
     * 🔴 用户原话（2026-09-30）：「漫画的自动拉取和手动填写表单界面把 ISBN、元数据页数、作者简介框删除掉，**加个画师框**」。
     *    动机：漫画里「作者（原作）」与「画师（作画）」常常是**两个人** —— MangaDex 就分成两条 relationship
     *    （`author` / `artist`）、Bangumi 书籍 infobox 也分「作者」/「作画」。共用一个 `author` 会把其中一个丢掉。
     * ⚠️ **只有漫画会写**：表单只在漫画态渲染「画师」框，其余 bookKind 保存时显式清空。
     */
    artist?: string;
    /** 书籍译者（豆瓣详情回填） */
    translator?: string;
    /** 书籍出版社 */
    publisher?: string;
    /** 书籍出品方（豆瓣详情回填） */
    producer?: string;
    /** 书籍 ISBN（豆瓣详情回填） */
    isbn?: string;
    /** 书籍装帧（豆瓣详情回填） */
    binding?: string;
    /** 书籍定价（豆瓣详情回填） */
    price?: string;
    /** 书籍丛书（豆瓣详情回填）
     *  🔴 **#434 起放开到全部 6 类型**（原来只有书籍会写）：它同时是海报墙「系列」分组的分组名。
     *    分组口径见 `pure/seriesGroup`（🔴 **分组键 = `type` + 归一化系列名** —— 同名不同类**不合并**，
     *    用户 2026-09-30 裁定「不做跨类型」）。书籍侧仍由豆瓣「丛书」自动回填，其余类型手填。 */
    series?: string;
    /**
     * **系列序号**（#434；append-only 可选字段；🔴 #443 起**锁定整数**）。
     *
     * 🔴 语义**由用户自定**（阅读序 / 上映序 / 季序都行）。🔴 #443（2026-09-30）起**锁定为整数**
     *    （用户裁定「只能填整数不能填小数」）：真库里出现过 `3.5` / `8.5`，结果「第七季 8.5 排在第八季 8
     *    后面」—— 序号一旦允许小数，「排序」就不再等于用户心里的「第几部」。小数**读时按四舍五入归一**。
     *    只在折叠卡的组内排序里用它（`seriesIndex` 升序 → 无值时回落年份 → 标题）。
     * ⚠️ 只在 `series` 有值时才有意义（没填系列名的孤立序号不参与任何分组）。
     */
    seriesIndex?: number;
    /**
     * **归属合集**（append-only 可选字段；2026-11-24 用户裁定新增）。
     *
     * 🔴 用户原话：「在所有类型条目属性窗口上加个归属合集，**只有写了才能进合集视图**」。
     *    ⇒ 合集视图（`kind === 'collection'`，见 `pure/mediaViews`）**只认这个字段**，
     *    ⛔ 不再回落 `series` —— `series` 的职责仍然是海报墙「系列折叠卡」的分组名
     *    （见上面那条注释），两者语义分开。
     * ⚠️ 留空 = 该条目**不进**任何合集视图（这是用户的显式意志，⛔ 别兜底成 series）。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    collection?: string;
    /** 游戏平台（如 PC / Switch） */
    platform?: string;
    /** 游戏开发商 */
    developer?: string;
    /** 音乐所属专辑（music 类型，豆瓣详情回填；表单可改，笔记 callout 表格展示） */
    album?: string;
    /** 音乐本地音频路径（music 类型；vault 相对路径优先，库外绝对路径兼容；lrc source 行来源） */
    audioPath?: string;
    /**
     * 音乐**网络地址**（#601；append-only 可选字段）。
     * 语义 = 「这首没有本地音频时，去这里听 / 这是它的在线页」。手填 / 粘贴，**没有检索按钮**
     * —— 与 `gameUrl` 同一条口径：音乐侧没有可用的在线检索源（实测四平台都需鉴权 / 签名）。
     * ⚠️ 与 `sourceUrl`（数据来源平台页，搜索回填自动记录）不是一回事：那是出处，这是手填的入口。
     */
    audioUrl?: string;
    /** 游戏启动快捷方式（.lnk）路径（game 类型；vault 相对优先，库外绝对兼容；「▶ 启动」打开） */
    gameLaunchPath?: string;
    /**
     * 游戏**网络路径**（#534；append-only 可选字段）。
     * 用户裁定「游戏**不接**在线检索源 —— 仅在右键弹窗加网络路径框（加粘贴文字按钮）」⇒
     * 它只在游戏「启动路径」浮层里手填 / 粘贴（商店页 / 官网 / 攻略链接都行），**没有检索按钮**。
     * ⚠️ 与 `sourceUrl`（数据来源平台页，搜索回填自动记录）不是一回事：那是出处，这是手填的入口。
     */
    gameUrl?: string;
    /**
     * 游戏**本地 Flash 影片**（.swf；append-only 可选字段，2026-11-16 用户裁定「先做本地 swf 播放」）。
     *
     * 语义 = 「这个游戏挂了一个本地 swf，点「▶ 启动」在插件内用 Ruffle 直接玩」——
     * 与 `gameLaunchPath`（.lnk/.exe，交给系统 shell 拉起外部程序）**并列**，不是它的替代：
     * 两者都填时**swf 优先**（能内嵌玩就不用把用户甩出 Obsidian）。
     *
     * ⚠️ 值可以是**库内相对路径**或**库外绝对路径**（与 `gameLaunchPath` 同一条容错口径）；
     *    播放端统一经宿主 `resolveEmbedUrl` 换成 `app://` URL 交给 Ruffle。
     * ⚠️ 新增字段必须同步 `catalog.ts` 的 normalizeEntry 白名单，漏了会被静默丢弃（历史踩坑）。
     */
    gameSwf?: string;
    /**
     * 游戏的**网页内嵌地址**（H5 / Unity 小游戏；append-only 可选字段，2026-11-16 用户问「怎么才能支持unity和h5的小游戏」）。
     *
     * 语义 = 「这个游戏没有可下载的 swf，但有一个能在 iframe 里跑的在线播放页」——
     * 点「▶ 启动」时在 Flash 游戏标签页里用 iframe 打开它。
     *
     * 🔴 为什么这条路成立（真机实测，不是猜的）：
     *   4399 的详情页 `…/flash/<id>.htm` 响应头**没有** `X-Frame-Options`、也**没有** `Content-Security-Policy`
     *   ⇒ 可以在 Obsidian 里 iframe 嵌 4399 页面（截图 `_shot/h5-embed-0.png` 实证：整页正常渲染）。
     *   而 Unity/H5 游戏真正的中间页（`…/index.html`）带 Referer 校验，插件**直连拿不到**（返回「访问错误」）——
     *   但嵌在 4399 页面里时 Referer 是 4399 自己，于是能跑。
     *   ⇒ 所以这里存的是**4399 自己的播放页**（`…/flash/<id>_2.htm`），不是中间页地址。
     *
     * ⚠️ 与 `gameUrl`（手填的商店页/官网/攻略链接，点了交给系统浏览器）**不是一回事**：
     *    那个是「去外面看」，这个是「在插件里玩」。
     * ⚠️ 新增字段必须同步 `catalog.ts` 的 normalizeEntry 白名单，漏了会被静默丢弃（历史踩坑）。
     */
    gameEmbed?: string;
    /**
     * 这份 `gameSwf` 的**原始网络地址**（append-only 可选字段，2026-11-16 用户裁定「留档原始 swf URL」）。
     *
     * 语义 = 「这个本地 swf 当初是从哪儿下的」——用于三件事，缺一个都不行：
     *  ① **补抓关联资源**：`fetchFlashAssets` 要靠 `swfUrl` 当 base 去 `resolveUrl()` 拼资源真实地址，
     *     只有本地路径时相对资源名（`sounds/bgm.mp3`）根本无从解析；
     *  ② **重新下载**：文件被误删 / 挪走后不用再让用户翻收藏夹找那串地址；
     *  ③ **溯源**：文件名已经按游戏标题改过名，原始末段（`04.swf` / `play.swf`）只剩这里还留着。
     *
     * 🔴 与 `gameSwf` 的**生命周期不同**：`gameSwf` 是本地路径，换机器 / 挪文件夹就失效；
     *    这个字段一旦写下就一直有效。⛔ 别在重设 `gameSwf` 时把它清掉。
     * ⚠️ 新增字段必须同步 `catalog.ts` 的 normalizeEntry 白名单，漏了会被静默丢弃（历史踩坑）。
     */
    gameSwfUrl?: string;
    /**
     * 游戏画面的**原始宽**（像素；append-only 可选字段，2026-11-16 用户问「怎么才能支持unity和h5的小游戏」的连带项）。
     *
     * 语义 = 站点在详情页里声明的舞台尺寸（4399 `_w = 800,`、7k7k `gamewidth: 800,`、17yy `flash_w = 800;`）。
     * 有了它播放页才能按**原生比例**摆舞台：默认 Ruffle 的 `scale: 'showAll'` 会把 4:3 游戏塞进 16:9 容器、
     * 上下各留一条黑边；按原生比例居中摆放则画面更大、黑边更窄。
     *
     * ⚠️ 可能是 0 / 缺失（不少页面不写，或写的是广告位尺寸）——`clampGameStage()` 会连宽高一起校验，
     *    不可信就整对丢弃，⛔ 别只信其中一个（1×800 这种是解析噪声）。
     */
    gameWidth?: number;
    /** 游戏画面的**原始高**（像素；与 `gameWidth` 成对，单边存在时一律不采用） */
    gameHeight?: number;
    /** 书籍文件路径（TXT/EPUB，阅读器打开入口；vault 相对路径，复用 audioPath 模式） */
    bookFile?: string;
    /**
     * 书籍**在线阅读**链接（#529；append-only 可选字段）。
     * 形如微信读书网页版 `https://weread.qq.com/web/reader/<hash>`（由「检索在线书籍阅读」回填，
     * 也可手填）。语义 = 「这本没有本地文件时，去这里读」⇒ 表单「阅读」按钮**本地优先、无本地才开它**。
     * ⚠️ 与 `sourceUrl`（数据来源平台页）不是一回事：它是**阅读入口**，不是来源出处。
     */
    readUrl?: string;
    /** 已弃用（#159 删除追番表本地文件夹监控）：字段保留兼容旧数据，不再读写 */
    localWatchDir?: string;
    /** 开播日期 YYYY-MM-DD（动画：Bangumi 放送时间回填；追番表「开播季度」列数据源） */
    airDate?: string;
    /** 本地相对路径（封面/xx.jpg，v0.4 起中文化）或 https URL */
    poster?: string;
    /** 剧集进度 */
    progress?: Progress;
    /** 本地剧集视频路径（动画/电视剧，index 0 = 第 1 集；存绝对路径，编辑表单「集按钮」关联，点击打开本地播放器播放） */
    episodeFiles?: string[];
    /** 剧集网络地址（index 0 = 第 1 集；与 episodeFiles 同下标，每集可同时关联本地路径 + 网络地址，点击打开浏览器） */
    episodeUrls?: string[];
    /** 集标题（index 0 = 第 1 集；右键编辑集按钮填写，hover 显示如「【第1集标题】」） */
    episodeTitles?: string[];
    /** 追更检测已知最新集（v0.5 A2 落库）：最近一次网站更新检测到的最大集数，进追更表秒显 + 更新提示去重基线 */
    latestKnownEpisode?: number;
    /** 电影观看日期 */
    watchedDate?: string;
    /** 计划观看日期（想看队列排期，YYYY-MM-DD；非想看状态编辑时会被清空） */
    plannedDate?: string;
    /** 书籍阅读进度（页码/总页，可选；percent = 阅读器进度百分比估算 0-100，书架进度条优先读） */
    readingProgress?: { page?: number; totalPage?: number; percent?: number };
    /**
     * 书籍**阅读时长**（分钟，可选；1.2.1 #537，append-only）。
     * 🔴 三个来源：① **内置阅读器**打开期间按「前台且为活动页」累计，关闭时叠加（不足 1 分钟不计）；
     *    ② 编辑表单**手填**（小时录入 → 分钟落库，**覆盖**总数）；
     *    ③ #685 右键菜单「**记录时长**」补记（追加一条明细 ⇒ **累加**到本总数）。
     * ⚠️ ② 是覆盖、①③ 是累加：同一段时间若既被阅读器累计又被手动补记，会**算两遍**（用户自己把关）。
     * 语义与游戏 `playtimeMinutes` 同构；海报墙封面左下角显示「已读 2h」（复用 `.rl-cov-playtime` 角标）。
     */
    readMinutes?: number;
    /** 本地视频播放位置（key = 剧集下标字符串，value = 秒）：内置播放器打开时续播、暂停/切集/关闭时写回 */
    videoPositions?: Record<string, number>;
    /**
     * 字幕文件路径（key = 剧集下标字符串，value = 字幕路径；append-only 可选字段）。
     *
     * 🔴 用户 2026-10-29：「字幕要双向持久化」——播放器里导入/选中的字幕**必须落库到这一集**，
     *    下次打开同一集自动挂上；同时「关联入口（右键 → 关联本地文件）」里也要能**看见并可编辑**。
     *    这是「双向」的两个方向：① 播放器 ⇒ 数据库 ② 数据库 ⇒ 播放器 / 关联入口回显。
     * ⚠️ 路径可以是 **vault 相对路径** 或 **操作系统绝对路径**（与 `episodeFiles` / `audioPath`
     *    同一容忍度）：库内字幕存相对、库外字幕存绝对，读取时两条通路都试（见 `readSubtitleAsVtt`）。
     * ⚠️ 与 `videoPositions` 同一形状（下标字符串键），便于「换集即换字幕」的按集绑定。
     */
    subtitlePaths?: Record<string, string>;
    /**
     * **单集评价**（③，append-only 可选字段，用户 2026-11-17：「各集数据写入整部单季 md 文件 yaml」）。
     *
     * 语义 = 「这一集我看成什么样、观感如何」：观看状态（未看/在看/已看）+ 高光/平庸/槽点标签 +
     * 六档心情 + 一句话短评。播放器详情页的「单集评价」面板读写它，选集格子据此画流斑/崩坏特效。
     *
     * 🔴 形状刻意与 `videoPositions` / `subtitlePaths` **完全同构**（`Record<集下标字符串, …>`）：
     *    选集格子的 `index` 就是 `episodeFiles` 的下标，共用同一个键空间才能「换集即换评价」，
     *    也不需要任何保位/压缩逻辑。⛔ 别改成数组 —— 三个集数组已经因压缩空位踩过「第 2 集的
     *    标题跑到第 1 集」的坑（`catalog.storeEpisodeList` 的注释里钉着）。
     * ⚠️ 归一/空值裁剪的唯一收口点是 `pure/episodeReview.normalizeEpisodeReviews`
     *    （读侧白名单与写侧 yaml 共用同一份判据）。
     * ⚠️ 新增字段必须同步 `catalog.ts` 的 normalizeEntry 白名单，漏了会被静默丢弃（历史踩坑）。
     */
    episodeReviews?: Record<string, EpisodeReview>;
    /** 书籍元数据页数（豆瓣实体书；仅展示与统计，不参与进度换算——进度基准 totalPage 以本地文件为准） */
    pageCount?: number;
    /** 游戏游玩时长（分钟，可选；playSessions 的快捷累计，两者保持同步） */
    playtimeMinutes?: number;
    /**
     * **时长明细**（可选；日期倒序展示）。
     * 🔴 #685 起**不再只属于游戏**：书籍 = 阅读时长明细、音乐 = 收听时长明细（共用 `PlaySession` 结构）。
     * 笔记章节按类型分名：游戏「游玩记录」/ 书籍「阅读记录」/ 音乐「收听记录」。
     */
    playSessions?: PlaySession[];
    /**
     * 音乐**收听时长**（分钟，#685，append-only）。
     * 🔴 内置播放器累计 + 右键菜单「记录时长」手动补记（累加）—— 与 `readMinutes` / `playtimeMinutes` 同构。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    listenMinutes?: number;
    /**
     * 重温 / 周目记录（#685，append-only）：影视重刷（rewatch）+ 游戏周目（playthrough）。
     * 写入笔记「重温记录」/「周目记录」章节。
     */
    roundLogs?: RoundLog[];
    /**
     * 游戏**攻略**（#685，append-only）：右键菜单「添加攻略」写入 → 笔记「攻略」章节。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    guide?: string;
    /**
     * **短评流水**（append-only）：右键「添加短评」写入 → 笔记独立的 `## 短评` 章节。
     * 🔴 用户 2026-10-25 指令：「添加短评不要追加到个人评语，另起个标题追加」——
     *    以前短评往 `notes` 里追，会和用户手写的「个人评语」混成一段：
     *    分不清哪句是评语哪句是流水，还把评语正文越拖越长。
     * ⚠️ 与 `notes` **分开存**：`notes` 是用户手写的整段评语（表单可改、笔记手改会回填）；
     *    `commentLog` 是只增不改的带日期流水（模板按日期倒序重画，与 `roundLogs` 同一口径）。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    commentLog?: CommentLog[];
    /** 数据源标识（douban/tmdb/bangumi/openlibrary/google/steam/musicbrainz/itunes/omdb/anilist/igdb；搜索回填自动记录） */
    source?: string;
    /** 数据源官方页链接（搜索回填自动记录，笔记「来源」行用） */
    sourceUrl?: string;
    /**
     * **手填的来源名**（#430；append-only 可选字段）。
     * 🔴 用途：手工新建的条目**没有数据源**（`source` 空）⇒ 封面角标只能显示「8.4★」、标题栏链接只能显示「来源」；
     *    填了它就能显示「番茄8.4★」。**手填优先于数据源键**，裁决入口是 `pure/sourceMeta.entrySourceLabel`。
     * ⚠️ 只有**新增条目**时能填（与 `communityScore` / `sourceUrl` 同一条「仅第一次填写有效」的口径）；
     *    编辑态只读展示。⛔ 它不是 `source`：`source` 是**数据源键**（douban/tmdb/…），决定走哪条搜索链。
     */
    sourceName?: string;
    /**
     * 🔴 **心情**（append-only 可选字段；用户 m07854 ⑳，2026-11-13）。
     *
     * 语义 = 看完 / 读完 / 玩完**那一下的情绪反应**，与 `rating`（好不好，0~5 数值）
     * 是**两个维度**：⛔ 别把心情折算成数值塞进 `rating` —— 那会污染系列均分、
     * 统计页与 `rating >= 4` 这类既有 Dataview 查询。
     *
     * 六个合法值见 `pure/mood.MOODS`（wow 震撼/神作、heal 治愈/开心、brain 烧脑/思考、
     * sad 致郁/破防、meh 无聊/犯困、rage 受罪/愤怒）。落盘存 **id**，
     * ⛔ 不存 emoji（emoji 在 YAML 里是裸字符，换字体渲染宽度不一，且用户改文案就废）。
     *
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    mood?: MoodId;
    /** 大众评分（数据源评分，搜索回填自动记录；分制随数据源：豆瓣/TMDB/Bangumi 10 分制、Google Books 5 分制） */
    communityScore?: number;
    /** 大众评分评价人数（豆瓣「评分（N人评价）」展示；搜索/详情回填） */
    ratingCount?: number;
    /**
     * 🔴 **好评率百分比**（0-100 整数，append-only 可选字段；目前只有 Steam 会填）。
     *
     * 2026-10-25 用户裁定「能不能显示为%专属」：Steam 没有「10 分制评分」，只有
     * 「All Reviews 好评率」⇒ 用本字段存百分比，展示为 `97%`，⛔ 不换算成 10 分制塞进 `communityScore`。
     *
     * ⚠️ 为什么不复用 `communityScore`：那个字段是全仓共用的**10 分制**（`pure/sourceMeta.communityScoreIssue`
     *    上限写死 10，排序 / 系列均分 / 表格列全按 10 分制假设）。混进 97 会直接校验失败、并污染其它来源展示。
     * ⚠️ 与 `communityScore` **并存不互算**：两者都有的条目，展示层优先显示百分比（裁决见 `pure/scoreDisplay`）。
     */
    reviewPercent?: number;
    /**
     * 🔴 **Steam 详情补全标记**（append-only 可选字段；ISO 日期串，只有 Steam 条目会有）。
     *
     * 用途 = **收敛**：`syncSteamNow` 用 `steamEntryNeedsDetail` 决定要不要花一次 appdetails 请求，
     * 旧判据只看「有没有封面」，导致**已有封面但缺评分**的条目永远补不上（用户 2026-11-08
     * 报障「steam 同步和搜索获取评分不到」）。而改用「缺评分」当判据又会漏进
     * 「该游戏零评测、永远没百分比」那类 —— 每轮开机重拉、白耗配额。
     * ⇒ 换成**请求过就盖章**：无论拿到多少字段，都写本字段；下一轮判据立刻为假。
     *
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     * ⛔ 它不是「同步时间」：条目的 `updatedAt` 由 service 维护，别用本字段做客情或排序。
     */
    steamDetailFilledAt?: string;
    /** 作者简介（书籍，豆瓣详情页回填；表单可改，笔记展示用） */
    authorIntro?: string;
    /** 目录（书籍，豆瓣详情页回填；表单可改，笔记展示用） */
    toc?: string;
    /** 简介/剧情简介（搜索回填自动记录，编辑表单可改；笔记「## 简介」章节） */
    summary?: string;
    /** AI 一句话总结（编辑表单可手填/可 AI 生成；笔记「## 一句话总结」章节） */
    aiSummary?: string;
    /** AI 核心看点（每条一句，建议 3 条；笔记「## 核心看点」列表） */
    aiHighlights?: string[];
    links: WatchLink[];
    notes: string;
    tags: string[];
    /**
     * 手动关联条目（#635，append-only）：缺省 = 无关联（老条目零迁移）。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     */
    related?: RelatedLink[];
    notePath?: string;
    /** 笔记内容指纹（G 双写冲突）：writeNote 落盘后记录，检测外部手动修改用 */
    noteFingerprint?: string;
    /** 摘抄数（P1 性能缓存）：addExcerpt 时更新，书架徽标/年度总结读 catalog 不读笔记（老数据惰性迁移一次） */
    excerptCount?: number;
    /**
     * 隐藏此条目卡片（m19210）：勾选后库列表里这张卡的封面与信息栏整体模糊。
     * ⚠️ 必须进 `normalizeEntry` 白名单，否则保存即被静默丢弃（本仓踩过多次）。
     * 🔴 只是「遮一下」，不参与任何筛选/排序/统计口径 —— ⛔ 别拿它当 archived 用。
     */
    cardHidden?: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Catalog {
    version: number;
    entries: MediaEntry[];
    /** 活动日志（append-only，新→旧不敏感、按时间升序）：状态翻转记录，「今日记录」/日记打卡的数据源。
     *  仅记状态变更——「新增条目」以 MediaEntry.createdAt 为准（存量数据同样可回溯），避免双份真相。
     *  超上限由写入侧截断最旧（见 ACTIVITY_LOG_LIMIT）。 */
    activityLog?: ActivityEvent[];
    /**
     * **系列（合集）评分**：`分组键 → 0~5 步长 0.5`（用户 2026-10-27 裁定「加合集分」）。
     *
     * 🔴 分组键 = `pure/seriesGroup.seriesKeyOf` 产出的 `type\u0001归一化系列名`
     *    —— ⛔ 别用「组内首条 id」当键：首条一删，这个分就跟着丢了。
     * 🔴 **独立字段，不是组内平均**。真实数据里组内分歧极大（`movie|周星驰` 是
     *    「9 部 5 分 + 9 部未评分」、`anime|海绵宝宝` 17 部只有首季 5 分），
     *    平均会被未评分条目稀释成一个谁也不认得的数；而「整个系列值几分」与
     *    「我看了其中几部、各打几分」本来就是两个概念（⛔ 别互相推算）。
     * ⚠️ **0 不落库**（见 `pure/seriesRating.writeSeriesRating` 的删键口径）。
     * ⚠️ append-only 可选字段：老 catalog 没有它照常读（缺省 = 全都是未评分）。
     */
    seriesRatings?: Record<string, number>;
    /**
     * **分类视图**（用户 2026-11-23 裁定「按场景/项目分类」，即「事本位」）。
     *
     * 🔴 存这里而不是插件设置：视图就是**分类维度本身**，跟库走才能保证
     *    换设备 / 同步 vault 后分类结构一致（用户明确选了「存进媒体库 Catalog」）。
     * 🔴 **默认视图恒在数组第 1 位**（`pure/mediaViews.normalizeViews` 强制构造）——
     *    它是物理库本身，不是逻辑分组，⛔ 不可删 / 不可改名 / 不可换种类。
     * ⚠️ append-only 可选字段：老 catalog 没有它照常读（缺省 = 只有默认视图）。
     * ⚠️ 读写收口点：`pure/mediaViews.normalizeViews`（读）/ `EntryService.setViews`（写）。
     */
    views?: MediaView[];
}

/** 一条状态翻转记录（谁、何时、变成什么状态；标题展示时按 id 现查，条目删除后该条不再展示） */
export interface ActivityEvent {
    /** ISO 时间戳 */
    at: string;
    /** 条目 id（MediaEntry.id） */
    id: string;
    /** 变更后的状态 */
    status: MediaStatus;
}

/** 活动日志保留条数上限（写入侧截断最旧，防 catalog 无限膨胀） */
export const ACTIVITY_LOG_LIMIT = 500;

export function createEntryId(now: number = Date.now()): string {
    return 'e_' + now + '_' + Math.random().toString(36).slice(2, 6);
}

export function createEmptyEntry(partial: Partial<MediaEntry> = {}): MediaEntry {
    const now = new Date().toISOString();
    return {
        id: createEntryId(),
        type: 'movie',
        title: '',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: now,
        updatedAt: now,
        ...partial,
    };
}
