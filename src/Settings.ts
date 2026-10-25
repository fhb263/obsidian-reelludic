// 设置类型、默认值与设置面板（字段只能追加，不能删除——AGENTS 红线）
import { Modal, Notice, Platform, PluginSettingTab, Setting, setIcon, requestUrl, TFolder } from 'obsidian';
import type ReelLudicPlugin from '../main';
import type { ColorTheme, UiTheme } from 'data/types';
// #604 内置播放器的播放模式（四档真源在纯模块；设置里只存这个联合类型）
import type { PlayMode } from 'pure/playerMenu';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, type BookKind, type EntryType } from 'data/types';
// 🔴 #640e：书籍子分类（文学 / 网文 / 漫画）的两个真源 —— 标签取自 `BOOK_KIND_LABELS`（⛔ 不手写）
import { BOOK_KINDS, BOOK_KIND_LABELS } from 'pure/bookKind';
import type { ProviderId, SourceGroup, ProviderMeta } from 'pure/sourceRegistry';
import {
    PROVIDERS, PROVIDER_META, GROUP_LABELS,
    resolveSourceChain, normalizeSourceChain, DEFAULT_CHAINS,
} from 'pure/sourceRegistry';
import { normalizeAiChoice, normalizeProvider, normalizeAiBaseUrl, AI_PROVIDER_OPTIONS, aiProviderOptions, AI_PROVIDER_OFF, DEFAULT_MODELS, DEFAULT_TRANSLATE_PROMPT, aiBaseUrlIssue, providerLabel, mergeModelCandidates, aiChoiceLabel, aiChoiceLabelNamed, aiPickText, isAiOff, aiKeyField, isCustomSlot, customSlotName, normalizeCustomName, CUSTOM_SLOTS, CUSTOM_SLOT_FIELDS, CUSTOM_SLOT_DEFAULT_NAME, type CustomSlot, type AiProviderChoice, type TranslateProvider, type ModelFetched } from 'pure/translate';
// #484：模型拣选弹窗的筛选 / 置顶判定（纯逻辑，可单测）
import { togglePin, toggleHidden, clearHiddenFor } from 'pure/aiPick';
// #479 AI集成页整页重排：服务商品牌标（LobeHub Icons，MIT）+ 可搜索的模型选择
// #480：图标绘制与「服务商图标」抽到 services/aiIcon（设置页与拣选弹窗共用一份）
import { AI_PROVIDER_ICON, TTS_ICON, type AiIcon } from 'pure/aiIcons';
// 🔴 #689：`pure/comicViewer` 的两个导出**已不再被设置页使用**（漫画阅读方式下拉已移除，
//    入口只在漫画阅读器内）⇒ import 一并删除。⛔ 别因为「以后可能用」留着 —— 本仓死码不留。
// 🔴 #639 ⑥：Steam 凭据（SteamID 校验是纯函数，⛔ 不在设置页另写一份位数判断）
import { steamIdIssue } from 'pure/steamSync';
import { renderAiIcon, aiChoiceIcon } from 'services/aiIcon';
// #488：元数据源 / 音乐平台图标真源（simple-icons CC0 品牌标 + 内置兜底；**生成器写盘**，
// 见 `_gen_source_icons.cjs`）。与 AI 服务商图标共用**同一个** `renderAiIcon` 渲染端。
import { SOURCE_ICON, MUSIC_COOKIE_ICON, type KeySourceId, type MusicSourceId } from 'pure/sourceIcons';
// #589 开机凭据自检：凭据行的徽标要能显示「连接失败」（#634 由「已失效」改名）
// 🔴 #634：`aiCheckKey` 让 AI 服务（翻译/总结/云合成/自定义端点）也走**同一张三态结果表**
import { EXPIRED_BADGE, isExpired, aiCheckKey, musicCheckKey, sourceCheckKey, type CredentialStatusMap } from 'pure/credentialCheck';
// #491「更新日志」= 内置弹窗（⛔ 不再跳浏览器）；正文是 `pure/releaseNotes` 里那张**手写**的版本一句话表
import { ReleaseNotesModal } from 'modals/ReleaseNotesModal';
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑧）：关于页那枚「新手引导」按钮换成「未来规划」，
//    引导弹窗（`modals/GuideModal`）与它的 `GUIDE_PAGE_COUNT` 一并下线 ⇒ 这里只留路线图弹窗。
import { RoadmapModal } from 'modals/RoadmapModal';
// #598 对外链接的唯一真源（仓库 / 报 Bug / 提需求 / 爱发电）—— 「关于」页那几枚按钮只读它
import { REPO_URL, AFDIAN_URL, SUPPORT_BUTTONS } from 'pure/supportLinks';
import { AiPickerModal, AiModelNameModal, type AiModelItem, type AiPickerPick } from 'modals/AiPickerModal';
// #480 ④ / #482 ③：朗读音源行的「音源 + 音色 + 试听」（纯逻辑在 pure/ttsSettings；引擎复用阅读器那两套）
import {
    TTS_ENGINE_CHOICES, normalizeTtsEngineKind, ttsVoiceGroups, ttsVoiceLabel,
    effectiveTtsVoice, ttsEngineBlockedReason,
} from 'pure/ttsSettings';
import { SystemSpeechEngine, ttsSupported, type SpeechEngine } from 'services/SpeechEngine';
import { CloudSpeechEngine } from 'services/CloudSpeechEngine';
import { VOICE_PREVIEW_TEXT, loadTtsRate, loadTtsVolume, loadVoiceUri, saveVoiceUri, TTS_RATE_DEFAULT, TTS_PITCH_DEFAULT, TTS_VOLUME_DEFAULT, type TtsEngineKind, type TtsVoiceLite } from 'pure/tts';
import { loadCloudVoice, saveCloudVoice } from 'pure/ttsCloud';
import type { AudioPlayMode } from 'pure/audioQueue';
import { DEFAULT_SUMMARY_PROMPT } from 'pure/aiSummary';
import { DEFAULT_PREFILL_PROMPT } from 'pure/aiPrefill';
import { DEFAULT_SEARCH_PROMPT } from 'pure/readerSearch';
import { loadTtsEngine, saveTtsEngine } from 'pure/tts';
import { DOWNLOAD_DIR_DEFAULT, downloadRootIssue, normalizeDownloadRoot, type DownloadKind } from 'pure/downloadPlan';
import {
    POSTER_DENSITIES, POSTER_DENSITY_LABELS, POSTER_COLUMNS_MIN, POSTER_COLUMNS_MAX,
    normalizePosterDensity, normalizePosterColumns, type PosterDensity,
} from 'pure/posterGrid';
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-3）：「一键迁移」不再在设置页里画进度条
//    （`.rl-mig-prog` 那套 DOM 已整体删除），改由进度弹窗承担；结果也由它的 `finish()` 展示 ⇒
//    `PosterMigrateModal`（结果弹窗）**不再被本文件 import**（文件本身保留：可能被命令/别处引用）。
import { PosterMigrateProgressModal } from 'modals/PosterMigrateProgressModal';
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-2）：失效链接检测结果改弹窗展示
import { LinkCheckModal } from 'modals/LinkCheckModal';
import { AssetCleanupModal } from 'modals/AssetCleanupModal';
import { ConfirmModal } from 'modals/ConfirmModal';
import {
    folderCandidates, attachFolderInputSuggest, VaultFolderSuggest, type FolderInputSuggest,
} from 'modals/VaultFolderSuggest';
import { DEFAULT_LIBRARY_DIR, libraryDirIssue, normalizeLibraryDirInput, sameLibraryDir } from 'pure/libraryDir';
// #562 分类本地目录：7 个键 / 分组 / 文案 / 字段映射的真源（⛔ 别在本文件里另写一份 key→字段 表）。
//   音乐那一档没有新字段（复用 `musicDownloadDir`），见 `pure/localDirs` 模块头。
import { LOCAL_DIR_FIELD, LOCAL_DIR_GROUPS, LOCAL_DIR_LABELS, localDirOf, type LocalDirKey } from 'pure/localDirs';
import {
    SETTING_NAV_TABS, SETTING_NAV_PAGES, SETTING_NAV_DEFAULT,
    groupIcon, nextTabId, tabStates,
} from 'pure/settingNav';
// 1.3.1 ①「高级设置」页：字段映射（纯逻辑校验 + 字段清单真源）
import { parseFieldMap } from 'pure/fieldMap';
// 🔴 #653：属性顺序「对比预览」的位次矩阵（纯逻辑，⛔ 不在这里另算一套）
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑦）：对比预览从 7 列扩到 9 列（书籍拆成
//    文学 / 网文 / 漫画三列）⇒ 列清单改从 `FIELD_ORDER_COMPARE_COLUMNS` 取，⛔ 别再在设置页手写列。
import { FIELD_ORDER_COMPARE_COLUMNS, buildFieldOrderCompare, fieldLabelOf } from 'pure/fieldOrderCompare';
import { META_FIELDS, labelOf } from 'pure/metaFields';
import { CARD_FIELD_LIMIT, CARD_PREVIEW_ENTRIES, cardFieldOptionsFor, cardFieldValue, normalizeCardFieldsForType, resolveCardFieldsByType, type CardFieldKey } from 'pure/cardMeta';
// 1.3.1 ① 第 3 件：各类型笔记属性顺序（拖拽列表复用 seriesGroup 的通用搬移纯函数）
import {
    FIELD_ORDER_TYPES,
    GLOBAL_FIELD_KEYS,
    defaultOrderFor,
    exclusiveFieldsFor,
    // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑦）：书籍三子类各有排除表（网文去掉画师 / ISBN），
    //    子类页与对比预览的 `k:<kind>` 列都走它 —— ⛔ 不许在设置页拿 `exclusiveFieldsFor('book')` 顶替。
    exclusiveFieldsForBookKind,
    isDefaultKindOrder,
    isDefaultOrder,
    orderForBookKind,
    orderForType,
    // 对比预览九列要按「用户已配次序」取数：回落链（子类 → 大类 → 缺省）由这两个汇总器负责，
    // ⛔ 别在设置页自己拼一遍（拼错就静默用缺省序，tsc 不会报）。
    resolveAllKindOrders,
    resolveAllOrders,
} from 'pure/fieldOrder';
import { moveItem } from 'pure/seriesGroup';
// #541「个性化体验」四项：主导航布局 / 起始页 / 卡片风格 / 界面动效。
// 🔴 三项归一与文案**一律走 pure 模块**，⛔ 别在渲染处另写一份选项表（第二份真源）。
import { HOME_TAB_ORDER, homeTabLabel, normalizeStartTab, type HomeTab } from 'pure/homeTabs';
import { NAV_LAYOUTS, NAV_LAYOUT_LABELS, normalizeNavLayout, type NavLayout } from 'pure/navLayout';
import {
    CARD_STYLES, CARD_STYLE_LABELS, MOTION_MODES, MOTION_MODE_LABELS,
    normalizeCardStyle, normalizeMotionMode, type CardStyle, type MotionMode,
} from 'pure/appearance';

export interface ReelLudicSettings {
    /** TMDB API Key（免费注册，设置页引导） */
    tmdbApiKey: string;
    /** 🔴 #665：TMDB 账号同步用（watchlist / favorite 接口要 session_id，搜索只用 API Key；见 pure/tmdbSync 模块头） */
    tmdbSessionId: string;
    /** 库目录（vault 内） */
    libraryDir: string;
    /** 豆瓣兜底（已移除开关，改为始终启用；字段保留以兼容旧数据，不再读取） */
    doubanEnabled: boolean;
    /** 观看链接预设平台模板 */
    platformTemplates: string[];
    /** IGDB（游戏补充源）Twitch 开发者凭据：Client ID（IGDB 重新接入后激活读取；历史曾弃用，字段一直保留兼容） */
    igdbClientId: string;
    /** IGDB（游戏补充源）Twitch 开发者凭据：Client Secret（同上，双凭据源第二字段，见 PROVIDER_META.igdb.keyField2） */
    igdbClientSecret: string;
    /** Google Books API Key（可选，429 限流时配置可提升配额） */
    googleBooksApiKey: string;
    /** Bangumi（bgm.tv）Access Token（动画/番剧数据源） */
    bangumiToken: string;
    /** 豆瓣 Cookie（过反爬，浏览器登录后复制） */
    doubanCookie: string;
    /** 🔴 #580 微信读书 Cookie（**仅书架同步与「测试连接」需要**；书籍检索本身免登录，见 `pure/weread`）。
     *  append-only 可选字段：旧数据无此键时由 `DEFAULT_SETTINGS` 补空串（⛔ 不写迁移）。 */
    wereadCookie: string;
    /** 色彩主题：彩色（类型色条+状态五色）/ 单色（关闭类型色条）（v0.4 起设置页移除选项，固定单色；字段保留兼容旧数据） */
    colorTheme: ColorTheme;
    /** 封面本地化：开启后新条目网络封面自动下载到 covers/（离线可用、防图床失效） */
    localizePosters: boolean;
    /** 书架默认视图：海报墙 grid / 列表 list（设置项已移除，字段保留兼容旧数据；固定海报墙） */
    defaultViewMode: 'grid' | 'list';
    /** 隐藏插件内滚动条（外观）：开启后 ReelLudic 视图内滚动条不显示 */
    hideScrollbars: boolean;
    /** 海报密度（基本设置 › 外观与体验，用户 2026-09-22）：紧凑 / 标准 / 宽松 / 自定义列数。
     *  缺省「标准」= 历史观感（原 `.rl-grid` 硬编码 180px）。⛔ 无需迁移：旧数据无此键时由
     *  pure/posterGrid.normalizePosterDensity 归一为 standard。append-only 可选字段。 */
    posterDensity?: PosterDensity;
    /** 自定义列数的「目标列数」（仅 posterDensity === 'custom' 生效；缺省 6，范围 1-12）。
     *  实际列数仍由容器宽度决定 —— 容器过窄时按最小卡片宽度自动减列（pure/posterGrid）。
     *  🔴 用户 2026-10-20 删除「海报墙列数」后，这一对是**卡片网格与海报墙共用**的唯一列数真源。 */
    posterColumns?: number;
    /**
     * 🔴 #626 **海报墙（`wall`）自己的目标列数** —— ⚠️ **已下线**（用户 2026-10-20：「设置页里的
     * 海报墙列数项删除掉」）。字段名保留**仅为了读懂老 data.json**：它现在被**一律忽略**
     * （见 `pure/posterGrid.posterGridTemplateForWall`，形参收下就丢），墙恒跟随上面的「海报密度」。
     *
     * 历史：Ctrl+滚轮缩放原本只写共享的 `posterDensity` / `posterColumns` ⇒「在墙上缩一次，
     * 卡片网格的列数也跟着变了」；#626 于是给墙开了这个键。现在墙面那一路的缩放**也落回共享键**
     * （见 main.ts 的 `applyWallZoom`）—— 一条真源，⛔ 别再给墙开第二个列数键。
     *
     * ⛔ **不要把设置行加回来**：没有入口的键 = 鬼开关。
     */
    wallColumns?: number;
    /**
     * 🔴 #668 **时间线视图自己的缩放档**（append-only 可选字段）。
     *
     * 与 `wallColumns` 同一条理由：Ctrl+滚轮缩放若共用 `posterColumns`，
     * 「在时间线上缩一次，卡片网格的列数也跟着变」—— 每个视图各记各的。
     * ⚠️ 语义是**条目宽度档**（1 = 最宽 .. 6 = 最窄），不是列数：时间线是按年份横向铺条目，没有「列」。
     * 🔴 **缺省 = 没配过** ⇒ 用 `TL_WIDTH_DEFAULT`，脏值（`null` / 字符串 / `NaN` / 越界）一律按没配过处理。
     */
    timelineZoom?: number;
    /**
     * 🔴 #668 **「切换视图」下拉里各档的顺序**（append-only 可选字段，用户自由拖排）。
     * 缺省 = `ALL_VIEW_VALUES` 的默认顺序；归一在 `pure/viewModes.normalizeViewOrder` 一处
     * （丢未知值 / 去重 / **把缺失的档补到末尾** —— 以后新增视图时老用户也能看见它）。
     */
    viewOrder?: string[];
    /**
     * 🔴 2026-10-21（用户需求 9）**列表视图「展示分组 / 不并组展示」**（append-only 可选字段）。
     * `undefined` 或 `true` = 展示分组（同系列折叠成组，与 1.4.0 之前的行为一致）；`false` = 不并组展示。
     * ⚠️ 只作用于**列表视图**（需求原文只点名列表视图那排工具栏）；海报墙 / 卡片 / 时间线**不受影响**
     *    —— 它们的行源在 `MediaList.svelte` 里是另一条分支，⛔ 别把开关接到 `seriesRows` 那一支上。
     * 落盘走 `plugin.setListGrouping(next)`（唯一出口，⛔ 别在视图里直接改 `settings` 字段）。
     */
    listGrouping?: boolean;
    /** 界面主题（1.0.3）：全面 modern 后恒为 'modern'（设置页已无切换入口；字段按 schema append-only 保留） */
    uiTheme?: UiTheme;
    /**
     * 🔴 #541 主导航布局（append-only 可选字段；**缺省 `top` = 顶部横向胶囊**，与 1.2.0 观感一致）。
     * `sidebar` = 主视图**视图内**的左侧竖向导航（图标 + 文字，可折叠）。
     * ⚠️ 是「视图内的左栏」，不是 Obsidian 工作区侧栏 —— 视图仍是同一个 `ItemView`，
     *    与 `AudioPlayerView.isInSidebar()` 那件事**无关**（⛔ 别把两者当成一个概念）。
     * 归一走 `pure/navLayout.normalizeNavLayout`（脏值回 `top`，⛔ 升级不得换脸）。
     */
    navLayout?: NavLayout;
    /**
     * 🔴 #657（用户：「统计页的所有元素支持自由排序，自适应」）：统计页**五个区块的顺序**。
     * `['hero','feed','trend','overview','board']` = 缺省（与原三层倒金字塔的视觉顺序一致）。
     * 🔴 落盘口径：与缺省逐位一致 ⇒ **删掉该键**（⛔ 不存缺省副本）—— 这样以后新增区块能自动落在缺省位置。
     * 归一 / 移动 / 自适应档见 `pure/statsLayout`（唯一真源，⛔ 别在视图里再写一遍阈值）。
     */
    statsOrder?: string[];
    /**
     * 🔴 #541 引入 / **#543 退场**：曾表示侧边栏的折叠态（图标+文字 ↔ 只留图标）。
     * #543 把侧边栏改成**恒定图标轨**（用户裁定的 ④ 排法：轨里只有图标、页名交给内容区大标题承担）
     * ⇒ 没有「折叠态」这个量了，**字段按 append-only 红线保留但不再被任何地方读取**。
     * ⛔ 别把它接回任何判定（会造出「设置页没有、行为却受它影响」的鬼开关），也⛔ 别删字段（旧 data.json 兼容）。
     */
    navCollapsed?: boolean;
    /**
     * 🔴 #541 起始页（append-only；缺省 `media`，= `plugin.homeTab` 的历史初值）。
     * 打开主视图时默认落在哪个一级页签。归一走 `pure/homeTabs.normalizeStartTab`
     * （只认一级导航那 6 个 id，`anime`/`tv`/`movie` 这类聚合内部类型一律回 `media`）。
     */
    startTab?: HomeTab;
    /** 🔴 #541 界面动效（append-only；缺省 `full` = 与 1.2.0 一致）。`reduced` = 关掉过渡与悬停位移。 */
    motionMode?: MotionMode;
    /** 🔴 #541 卡片风格（append-only；缺省 `standard` = 与 1.2.0 一致）。`soft` 圆润 / `flat` 扁平。 */
    cardStyle?: CardStyle;
    /**
     * 🔴 #591 Ctrl + 滚轮缩放（append-only 可选字段）。
     * `true` = 在媒体库视图（海报墙 / 瀑布流）里**拦截** Ctrl+滚轮的默认页面缩放，改为缩放内容区卡片
     * （步进列数 → 落成 `posterColumns` 并把 `posterDensity` 置 `custom`，即「海报密度」显示为自定义）。
     * 🔴 **缺省 `false`**（用户 2026-10-10 裁定）：它要接管一个系统级手势，⛔ 不能默认改变所有人的行为。
     * ⚠️ 读取一律 `!!settings.ctrlWheelZoom`（旧数据无此键 ⇒ false，无需迁移）。
     */
    ctrlWheelZoom?: boolean;
    /** 阅读排版：字号（px，默认 16）/ 行距（倍数，默认 1.8）——设置项已移除（v0.5 起在阅读器内调整，写回本字段），字段保留兼容旧数据 */
    readerFontSize: number;
    readerLineHeight: number;
    /** 阅读滚动模式：'continuous' 连续滚动（默认）/ 'paged' 翻页（CSS 列式分页，D4b）。append-only，缺省 continuous */
    readerScrollMode?: 'continuous' | 'paged';
    /** PDF 阅读器页面缩放（2026-10-23 用户指令「记住 Ctrl+滚轮调过的大小」）。
     *  范围与 `PdfReaderModal` 的 SCALE_MIN/MAX 一致（0.5–3，步进 0.25）；append-only，缺省 1 = 100%。
     *  ⚠️ 与 `readerFontSize` 语义不同：那个是 TXT/EPUB 的正文字号，这个是 PDF 整页缩放。 */
    readerPdfScale?: number;
    /** 阅读行宽：'strict' 固定版心（默认）/ 'full' 铺满可用宽度。append-only，缺省 strict */
    readerLineWidth?: 'strict' | 'full';
    /** 阅读器正文段落首行缩进（用户 2026-09-16；append-only 可选字段，缺省 false = 段首齐头） */
    readerIndent?: boolean;
    /** 高亮默认样式（hl/underline/wavy；缺省 hl = 底色高亮）（用户 2026-09-16 十四轮） */
    readerHlStyle?: 'hl' | 'underline' | 'wavy';
    /** 高亮默认颜色（yellow/green/blue/pink；缺省 yellow） */
    readerHlColor?: 'red' | 'yellow' | 'green' | 'blue' | 'purple';
    /** 阅读主题：'follow' 跟随 Obsidian 主题（默认）/ 'light' 经典白 / 'dark' 夜间黑 / 'green' 护眼绿 / 'gray' 深灰 / 'sepia' 羊皮纸。
     *  1.0.5 append-only 可选字段，缺省 follow（旧数据不迁移，不写 DEFAULT_SETTINGS）；仅影响阅读器内换肤 */
    readerTheme?: 'follow' | 'light' | 'dark' | 'green' | 'gray' | 'sepia';
    /** 正文字体族（#351）：'default' 跟随主题（默认）/ 'sans' / 'serif' / 'mono'。append-only，缺省 default */
    readerFontFamily?: 'default' | 'sans' | 'serif' | 'mono';
    /** 正文字重（#351；#351b 按用户口径删除「中等」600 档）：'normal' 400（默认）/ 'bold' 700。
     *  ⚠️ 旧数据里的 'medium' 由 `normalizeFontWeight` 兜回 'normal'（不需迁移） */
    readerFontWeight?: 'normal' | 'bold';
    /** 正文字距（#351，em）：-0.02 ～ 0.12 步进 0.01。append-only，缺省 0（不写字距） */
    readerLetterSpacing?: number;
    /** 实验性功能：书籍文件用内置阅读器打开（默认 false = 外部系统默认程序打开） */
    internalBookReader?: boolean;
    /** 内置播放器打开视频文件（影视本地 episodeFiles；默认 false = 系统播放器打开文件；开启后 mp4/webm/mov/ogv 内嵌弹窗播放，mkv 等 Chromium 不可解格式自动转系统。命名沿用 internalMediaPlayback，语义已从「适配 Media Extended」改为「内置播放器」） */
    internalMediaPlayback?: boolean;
    /** 播放器 · 后台播放（用户 2026-09-18 第四次指示）：不可见（切走标签页 / 窗口最小化 / 不在视口）时**继续播放**，
     *  既不暂停、也不起「超时彻底释放」计时。append-only 可选字段，缺省 false = 保持既有省电行为。 */
    playerBgPlay?: boolean;
    /** 播放器 · 自动切集（缺省 true = 保持历史行为：播完弹连播倒计时并自动切下一集）；关掉则播完**停在结尾**。
     *  append-only 可选字段；读取口径 `settings.playerAutoNext !== false`（旧数据无此键 → 视为开）。 */
    playerAutoNext?: boolean;
    /** 播放器 · 单集循环（缺省 false）：播完重播当前集；**优先级高于自动切集**。append-only 可选字段
     *  ⚠️ #604 起**不再读它**（被 `playerPlayMode` 取代）—— 保留只为**旧数据迁移**（`playModeFromLegacy`）。 */
    playerLoopOne?: boolean;
    /**
     * #604 播放器 · 播放模式（`'listLoop' | 'singleLoop' | 'sequential' | 'shuffle'`，缺省 `listLoop`）。
     * append-only 可选字段；读取一律经 `pure/playerMenu.normalizePlayMode`（手改设置文件写脏值 ⇒ 回落 listLoop）。
     * 🔴 缺省时由旧的两个布尔迁移（`playModeFromLegacy`）—— ⛔ 别在这里就地写默认值，那会让「旧数据」与
     *    「新用户」走同一条路，迁移逻辑反而失去意义。
     */
    playerPlayMode?: PlayMode;
    /**
     * 音频播放器 · 播放模式（④-4；`'off' | 'single' | 'sequential' | 'shuffle'`，缺省 `off` = 不循环）。
     * append-only 可选字段；读取一律经 `pure/audioQueue.normalizeAudioPlayMode`（手改设置文件写脏值 ⇒ 回落 off）。
     */
    audioPlayMode?: AudioPlayMode;
    /** 音频播放器 · 音量 0..1（缺省 1）；读取经 `pure/player.clampVolume` 夹取 */
    audioVolume?: number;
    /**
     * 音频播放器 · 歌词**逐字高亮**（#406 用户：「歌词滚动效果需支持逐字高亮（按时间均分）方式，
     * 请在设置页-外观与体验中新增该效果的开关项」）。append-only 可选字段。
     * 🔴 读取口径 = `!== false`（**缺省开**）—— 用户点名要这个效果，装上就该看得见；
     *    关掉它才需要一次显式操作。渲染侧真源 = `pure/lrc.wordIndexAt`（有逐字标记按标记、
     *    没有则 `parseLrc` 已按「到下一行」均分好时间）。
     */
    lyricsWordHighlight?: boolean;
    /**
     * 笔记内 ` ```lrc ` 块是否渲染成内联播放器（④-4，**默认 false = 让位**）。
     * 🔴 默认关的理由：LyricFlux 也注册同名块处理器，两插件同时开会**打架**；
     *    且默认关可保证升级后笔记外观不变（D-8(c)）。启用时若检测到 LyricFlux 已启用则仍然让位。
     */
    audioInlinePlayer?: boolean;
    /**
     * #538 音乐「在线曲库」检索开关（append-only 可选字段；**默认 false = 关**）。
     * 用户 2026-10-05：「设置项可选择开启或关闭新增音乐条目『在线曲库』的搜索，默认关闭」。
     *
     * 语义：开启后，**新增/编辑音乐条目**的搜索会多一栏「在线曲库」（四平台按「歌名 + 歌手」搜，
     * 见 `pure/songLibrary` 与宿主 `songLibrarySearch`）；关闭时那一栏**整栏不出现**。
     * 🔴 与「启用内置音乐播放器」（`audioInlinePlayer`）是**两件事**：后者是能力（能不能发这套请求 +
     *    表单「下载歌曲」按钮），这个是**用户要不要它在检索结果里出现**。真正的组合只有一处：
     *    `main.canUseSongLibrary()`（能力 ∧ 本开关）。⛔ 别在组件里再摊一份判定。
     */
    musicSongLibrary?: boolean;
    /**
     * ⑤-c 音乐下载总开关。🔴 2026-09-27 #399 起**已无 UI、也不再被任何地方读取** ——
     *    下载能力的门控并入 `audioInlinePlayer`（「启用内置音乐播放器」）。
     *    字段按 AGENTS 红线**保留**（字段只能追加不能删，删了旧 settings 文件的兼容性就没保证了），
     *    ⛔ 但别再把它接回任何判定（否则会出现「设置页没有、行为却受它影响」的鬼开关）。
     */
    musicDownloadEnabled?: boolean;
    /**
     * 音频文件目录（**库内相对路径**，缺省 `下载/音乐`）。
     * 🔴 与「媒体库目录」同口径（库内相对路径而非系统绝对路径）—— 全仓落盘都经 `vault.createBinary`，
     *    绝对路径在 Obsidian 里不可写。
     * 🔴 #399 起一度**无 UI**（「音乐集成」分组整体撤除）⇒ 只作 `main.downloadMusic` 的 root 兜底；
     *    **2026-09-28 #403 起 UI 回来了**：设置页「基本设置 › 数据与备份」新增「音乐下载路径目录」
     *    （用户：「在设置页-基本设置-数据与备份分组下，新增『音乐下载路径目录』设置项」）——
     *    仍按**库内相对路径**消费；归一与校验走 `pure/downloadPlan`（⛔ 别在设置页另写一份）。
     * 🔴 **#459 起这个值 = 音频文件所在目录本身**（旧版是「下载根」，代码再拼一个 `音乐/` 子目录 ⇒
     *    用户填 `下载/音乐` 就落到 `下载/音乐/音乐/`）。缺省从 `下载` 改成 `下载/音乐`（默认落点不变）。
     */
    musicDownloadDir?: string;
    /**
     * 书籍文件目录（#425 新增，**append-only**）：下载与「检索库内书籍文件」的库内相对路径目录。
     *
     * 🔴 用户 2026-09-29：「音乐下载路径目录项再加个**书籍下载路径目录**，再改名称『**音频文件目录**』
     *    和『**书籍文件目录**』（作用为下载和检索功能）」。
     * 🔴 在此之前书籍下载**复用了音乐目录**（`root: settings.musicDownloadDir`）——
     *    两类文件被塞进同一个根下，想分开存做不到。现在各自独立。
     * 口径与音频目录**完全一致**（库内相对路径、缺省 `下载/书籍`；归一与校验走 `pure/downloadPlan`，
     * ⛔ 别在设置页另写一份）；⛔ **不再由代码拼子目录**（#459，见 `musicDownloadDir` 那条）。
     */
    bookDownloadDir?: string;
    /** #459 下载目录一次性迁移标记（旧版值是「下载根」⇒ 见 `pure/downloadPlan.migrateLegacyDownloadDir`）。
     *  ⚠️ 只在 `onload` 里读：置 true 后**永不回退**（用户可能故意填 `下载`，每次载入都改＝改不回去）。 */
    downloadDirMigrated?: boolean;
    /**
     * #562 分类「本地目录」六个（append-only）：**单集 / 单文件本地检索**的搜索根目录。
     *
     * 🔴 用户 2026-10-08：「把音乐路径目录放在启用内置音乐播放器折叠分组下、三个各个的电视剧/动画/电影
     *    路径目录放在启用内置视频播放器折叠分组下、三个各个的文学/网文/漫画路径目录放在启用内置阅读器
     *    折叠分组下」，用途见 ⑧「（本地路径旁的）单集检索…去设置页前置填写的媒体库目录路径里递归搜索」。
     * ⚠️ **音乐那一档刻意不在这里**：它复用上面的 `musicDownloadDir`（本来就是「音频下载的存放与检索目录」）
     *    —— 再建一个 `localDirMusic` 就是同一件事两份设置，必然打架（设置页只是把那一行**搬进**音乐分组）。
     * ⚠️ **游戏也没有**：它的本地关联是「当场挑一个文件夹」（`findLibraryGame`），没有「按类型配根目录」的需求。
     * 口径：与其它目录类设置一致 —— **库内相对路径**为主，但**也认绝对路径**（视频/图书常放在 vault 之外，
     *    见 `pure/localDirs.resolveLocalDirAbs`）；缺省空串 = 未配置 ⇒ 检索时提示去设置页（⛔ 不猜目录）。
     */
    localDirBook?: string;
    /** 见 `localDirBook` */
    localDirNovel?: string;
    /** 见 `localDirBook` */
    localDirComic?: string;
    /** 见 `localDirBook` */
    localDirMovie?: string;
    /** 见 `localDirBook` */
    localDirTv?: string;
    /** 见 `localDirBook` */
    localDirAnime?: string;
    /**
     * 音乐下载 · 各平台登录 Cookie（#399-D 移植批；key ∈ `netease` / `qq` / `kugou` / `kuwo`）。
     * append-only 可选字段，**明文存 `data.json`**（与各数据源 API Key 同款口径，设置页已给出提示）。
     * 用途：**网易云**带 Cookie 才走 VIP 高音质；**QQ 必需** Cookie 才能下载；酷狗可选；
     * **酷我免登录**（#403 起设置页不再给它的填写项 —— 它的链路本来就不读 Cookie；键名仍保留，⛔ 别删）。
     */
    musicDlCookies?: Record<string, string>;
    /**
     * B 站音频下载用的 yt-dlp 可执行文件路径（#496，2026-10-03）。append-only 可选字段。
     * 🔴 **留空 = 走系统 PATH**（先试 `yt-dlp.exe` 再试 `yt-dlp`，见 `pure/ytdlp.ytdlpExeCandidates`）——
     *    所以「空」是**合法且有意义的缺省**，⛔ 别在读取端用 `?? 'yt-dlp'` 之类的兜底把它填死。
     * ⚠️ 转 mp3 还需要 ffmpeg：yt-dlp 自己会去 PATH 与「它自己所在目录」找，⛔ 本仓不另设 ffmpeg 路径项。
     */
    ytdlpPath?: string;
    /** 每类型源链（六组自选源及顺序；缺省/空 = 默认链，见 pure/sourceRegistry.DEFAULT_CHAINS。append-only 可选字段，旧数据无此键不迁移）。
     *  ⚠️ #580：书籍组因新增「微信读书」成为**首个 4 候选组**（豆瓣 / 微信读书 / Open Library / Google Books），
     *     ⛔ 原「≤3 源」不再是各组通用上限（其余五组仍 ≤3）。 */
    sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>;
    /**
     * 🔴🔴 用户裁定（1.4.x）：「已测试链接得到的**连接失败**标签要持久化，重启新会话后不要变回『已配置』」。
     * 键 = `pure/credentialCheck` 的 `sourceCheckKey` / `musicCheckKey` / `aiCheckKey`（带族前缀，⛔ 别用裸 id）；
     * 值只有 `true` / `false`。**没有键 = 还没测过**（⛔ 别默认 false —— 那会把「没测」画成「失败」）。
     * ⚠️ 只存结论、⛔ 不存凭据本身（结论是「这个 Key 通不通」，不是敏感数据）。
     * append-only 可选字段；读写一律走 `normalizeCredentialStatus` / `withStatus` / `withoutStatus`。
     */
    credentialStatus?: CredentialStatusMap;
    /** 阅读翻译服务商（'zhipu' 智谱 GLM / 'deepseek' / **'siliconflow'（#480）** / **'custom' 自定义 OpenAI 兼容端点（#478）** / 'off' 不启用；
     *  默认 zhipu。批3 r3 双源。
     *  append-only 可选字段；'off' 由 normalizeAiChoice 认，勿用 normalizeProvider 归一（会把 off 吃掉）） */
    readerTranslateProvider?: AiProviderChoice;
    /** 智谱 AI 翻译 API Key（Bearer，发往 open.bigmodel.cn；cform 同款 key，形如 xxx.yyy。批3 r3。append-only 可选字段） */
    readerZhipuKey?: string;
    /** DeepSeek AI 翻译 API Key（Bearer，发往 api.deepseek.com。批3 r3。append-only 可选字段） */
    readerDeepseekKey?: string;
    /** AI 总结服务商（'zhipu' / 'deepseek' / 'siliconflow'（#480）/ **'custom'**（#478）/ 'off'；与翻译服务各自独立可调。缺省 zhipu。append-only 可选字段）
     *  各服务共用同一组 Key——服务商只是选「用哪家跑」，凭据不重复配置。 */
    readerSummaryProvider?: AiProviderChoice;
    /** 划词翻译自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_TRANSLATE_PROMPT。append-only 可选字段 */
    readerTranslatePrompt?: string;
    /** AI 总结自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_SUMMARY_PROMPT。append-only 可选字段 */
    readerSummaryPrompt?: string;
    /** AI 搜索服务商（'zhipu' / 'deepseek' / 'siliconflow'（#480）/ **'custom'**（#478）/ 'off'；与翻译、总结各自独立可调。缺省 zhipu。append-only 可选字段）
     *  与翻译/总结共用同一组 Key——服务商只是选「用哪家跑」。 */
    readerSearchProvider?: AiProviderChoice;
    /** 划词搜索自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_SEARCH_PROMPT。append-only 可选字段 */
    readerSearchPrompt?: string;
    /**
     * #478 翻译 / 总结 / 搜索各自的**模型名**（空/缺省 ⇒ 该服务商的默认模型）。
     * append-only 可选字段。存的是**最终字符串**（不是选项下标）—— 模型 ID 会随官方变更，
     * 设置页给「预置下拉 + 自定义手填」（`pure/translate.PROVIDER_MODELS` 只是候选，⛔ 不是穷举）。
     */
    readerTranslateModel?: string;
    readerSummaryModel?: string;
    /** ⚠️「解读选段」与「自定义提问」共用搜索这一栏的模型 */
    readerSearchModel?: string;
    /**
     * 🔴 #499 AI **条目预填**服务商（新增条目「手动填写」界面标题行 ✨ 用）；
     * 与翻译 / 总结 / 搜索各自独立可调，共用同一组 Key。缺省 zhipu。append-only 可选字段。
     */
    readerPrefillProvider?: AiProviderChoice;
    /** #499 AI 条目预填自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_PREFILL_PROMPT。append-only 可选字段 */
    readerPrefillPrompt?: string;
    /** #499 AI 条目预填的模型名（空/缺省 ⇒ 该服务商的默认模型）。append-only 可选字段 */
    readerPrefillModel?: string;
    /**
     * #478 自定义 OpenAI 兼容端点的 base URL（服务商选「自定义」时用）。
     * ⚠️ 填 base（`https://api.deepseek.com/v1`）或整条 `/chat/completions` 都能识别
     *    （归一在 `pure/translate.customChatUrl`，⛔ 别在设置页另写一份）。
     */
    readerCustomBaseUrl?: string;
    /** #478 自定义端点的 API Key（明文存 `data.json`，与其它凭据同款口径） */
    readerCustomKey?: string;
    /**
     * 🔴 #634：**自定义端点槽位 2**（用户 2026-10-15：「再加个自定义端点 2 项，并支持重命名」，
     * 经追问裁定**总共两个槽位**）。三个字段与槽位 1 **完全对称**，只是名字带 `2`。
     * ⚠️ 单真源 `CUSTOM_SLOT_FIELDS`（`pure/translate`）—— 读写一律经它，⛔ 别在调用点写死字段名。
     */
    readerCustom2BaseUrl?: string;
    readerCustom2Key?: string;
    /**
     * 🔴 #634：两个槽位的**显示名**（可选；留空/缺省 = 用默认名「自定义端点 / 自定义端点 2」）。
     * ⚠️ 只影响**显示**（设置页行头 / 服务下拉 / 错误文案），不影响任何路由或存储键。
     */
    readerCustomName?: string;
    readerCustom2Name?: string;
    /**
     * 🔴 #636 ⑤：漫画阅读器的**阅读模式**（`'single'` 单页制 / `'scroll'` 连续滚动）。
     * append-only 可选字段；缺省 / 脏值 ⇒ `'single'`（#537 起的既有行为，⛔ 别默认连续）。
     */
    comicViewMode?: string;
    /**
     * 🔴 #636 ⑤：漫画阅读器的**右侧缩略图导航栏**是否显示。
     * 缺省 `false`（用户裁定「默认关」—— 窄窗下它会挤掉正文约 112px）。
     */
    comicThumbs?: boolean;
    /**
     * 🔴 #639 ⑥：**Steam Web API Key**（用户要求「新增 steam 凭据入口，包括 Steam API Key、SteamID」）。
     * 🔴 实测：搜索/详情走 storefront API **免 Key**，但**同步库与游玩时长**走 `IPlayerService/GetOwnedGames`
     *    **强制要 Key**（无 Key 返 401）⇒ 这个字段只服务「同步 Steam」。
     */
    steamApiKey?: string;
    /** 🔴 #639 ⑥：**SteamID64**（17 位数字）—— 同步库/愿望单都要它（愿望单接口连 Key 都不需要，只要它） */
    steamId?: string;
    /**
     * 🔴 #639 ⑥：上次自动同步的时刻（`Date.now()` 毫秒）。
     * 用于「插件启动时同步」的**门槛**（`pure/steamSync.shouldAutoSync`，间隔 6 小时）——
     * ⛔ 不无条件跑：Steam Web API 有频率限制，天天开十几次库会撞限流，而时长是「天级」数据。
     */
    steamLastSyncAt?: number;
    /** 云合成（OpenAI 兼容 `/audio/speech`）API Key（Bearer，发往 api.siliconflow.cn。append-only 可选字段）
     *  ⚠️ **朗读音源**（系统语音 / 云合成）不在这里 —— 它是使用态偏好，走 localStorage（`pure/tts` 的
     *  `rl-tts-engine`，与语速 / 音色同款），设置页下拉与阅读器弹窗 chips 读写同一份。 */
    readerSiliconflowKey?: string;
    /**
     * #484：**置顶的模型**（拣选弹窗里的 ⭐，跨服务商共用一份记忆）。
     * 为什么要有它：硅基流动 `/v1/models` 一次返回 **97 个**（实测 2026-10-02），
     * 每次挑模型都要从头翻 —— 置顶项固定显示在列表最上面的「★ 置顶」段（VS Code 的 Pinned 同款）。
     * ⚠️ 存的是**模型 id**（不是显示名）：显示名会随接口返回的 `name` 变，id 才是稳定的键。
     * append-only 可选字段，旧数据无此键 = 「还没有置顶」。
     */
    readerPinnedModels?: string[];
    /**
     * 2026-10-23 用户：「插件内置候选模型列出来给我决定删除哪个」⇒ **被删掉的内置候选**。
     * 键 = `服务商\u0000模型id`（见 `pure/aiPick.hiddenKey`）—— 模型 id 会跨家重名，必须带服务商。
     * ⚠️ 只作用于**本仓预置**候选（`fromApi === false`）；`/models` 拉回来的删不掉（下次获取又回来）。
     * ⚠️ 默认模型删不掉（`resolveModel` 会回落到它）；当前在用的那个也删不掉。
     * append-only 可选字段，旧数据无此键 = 「还没删过任何内置候选」。
     */
    readerHiddenModels?: string[];
    /** OMDb API Key（影视第三源，需 Key 1000 次/日；T1 预留字段，omdb 客户端接入后读取。append-only 可选字段，旧数据无此键不迁移） */
    omdbApiKey?: string;
    /** 服务集成折叠项开合记忆（**已弃用**：用户 2026-09-17 定稿「只有标题不折叠、内容一律折叠」，
     *  ①/② 不再是折叠项、`createFoldout` 已删除，本字段不再读写。⚠️ 字段只增不删（AGENTS 红线），
     *  保留仅为兼容旧数据。append-only 可选字段 */
    serviceFoldOpen?: Partial<Record<'api' | 'sources' | 'translate', boolean>>;
    /** 详情笔记是否渲染「属性表格」（笔记生成开关，用户 2026-09-18）。append-only 可选字段，
     *  缺省 true = 保持历史行为；关掉后笔记只有 callout/简介/评语/链接等章节，无表格。
     *  🔴🔴 #596 **翻面**：读取口径由 `!== false`（缺省开）改成 **`=== true`（缺省关）** ——
     *  用户点名「默认全部关闭」（旧数据无此键 ⇒ 关）。⚠️ 与 `main.ts` 构造 `EntryService` 那一句
     *  必须**一起翻**，漏一处就会出现「设置显示关闭、笔记里仍有属性表」。 */
    noteTable?: boolean;
    /** 1.3.1 ① 字段映射原文（高级设置 › 字段映射）：每行一条 `[原始属性名] -> [新属性名]`。
     *  空 / 缺省 = **恒等映射**（保持历史行为，不写任何改名）。
     *  🔴 同一份配置必须同时喂给两侧，漏一处就会出现「笔记写了新键名、插件读不回来」：
     *    写侧 = `data/noteGenerator.entryFrontmatter` 第三参（由 `EntryService` 构造时注入）
     *    读侧 = `pure/noteEditable.extractFrontmatterFromNote` 第二参（由 `EntryModal` 打开时注入）。 */
    fieldMap?: string;
    /** ⚠️ **已废弃（#617 追加件起不再读）**：原「一份管所有类型」的全局配置。
     *  用户裁定「让位给按类型预填」—— 它一视同仁地对六类生效，正是「五个类型看起来一样」的根源。
     *  🔴 **键本身保留**：删字段 = 静默清掉老用户的配置数据（本仓红线：字段只追加不删）。
     *  真源见 `pure/cardMeta.resolveCardFieldsByType`（只读下面那个新键）。 */
    cardFields?: string[];
    /** 1.3.1 ①（#617）：**按条目类型各一份**的信息栏配置（高级设置 › 卡片信息栏）。
     *  ⚠️ `Partial` 语义 ⇒ **只存被用户动过的类型**；没动过的类型走**各自的预填**
     *     （`CARD_FIELD_DEFAULTS_BY_TYPE`：影视 = 年份/创作者/题材，书籍 = 年份/作者/题材，
     *      游戏 = 年份/开发商/平台，音乐 = 年份/创作者/专辑）。
     *  归一（含**按类型的池子过滤**）见 `pure/cardMeta.resolveCardFieldsByType`（唯一真源）。 */
    cardFieldsByType?: Record<string, string[]>;
    /** 🔴 #653：**书籍子分类各一份**的卡片信息栏（文学 / 网文 / 漫画）。
     *  🔴 **append-only 可选键，零迁移**：缺席 ⇒ 三个子类**一律回落 `cardFieldsByType.book`**
     *     （与 `fieldOrderByKind → fieldOrder.book` 同一条回落链）。
     *  ⚠️ ⛔ 别往 `cardFieldsByType` 里塞 `novel` / `comic` —— 那张表按 `EntryType` 键，塞进去会被当脏数据忽略。 */
    cardFieldsByKind?: Record<string, string[]>;
    /** 1.3.1 ②（#621）：**表格视图的列**（按条目类型各一份；在**视图内**的「列」菜单里配）。
     *  🔴 与上面的 `cardFieldsByType` **是两件事**（⛔ 别合并）：卡片信息栏是「精选 16 项、最多 5 行」，
     *     表格列是「该类型全部可写可读字段」。混在一起卡片那边会冒出 40 个候选。
     *  ⚠️ `Partial` 语义 ⇒ **只存被用户动过的类型**，其余走各类型自己的缺省（`TABLE_COLUMN_DEFAULTS_BY_TYPE`）。
     *  🔴 **数组顺序 = 列序**（用户拖列头拖出来的），⛔ 别按池子重排（见 `pure/tableColumns` 文件头）。
     *  归一 / 回落 / 截断见 `pure/tableColumns.resolveTableColumnsByType`（唯一真源）。 */
    tableColumnsByType?: Record<string, string[]>;
    /** 1.3.1 ① 第 3 件：**各类型笔记属性的写出顺序**（高级设置 › 笔记属性顺序）。
     *  ⚠️ `Partial` ⇒ **只存被用户改过的类型**，没改的走 `pure/fieldOrder.defaultOrderFor` 的缺省
     *     —— 这样以后新增字段能自动落在缺省位置，⛔ 不会因为「配置里没有它」而被吃掉。
     *  真源 / 归一 / 施加见 `pure/fieldOrder`（写侧经 `EntryService` → `entryFrontmatter` 第四参）。 */
    fieldOrder?: Record<string, string[]>;
    /**
     * 🔴🔴 #640e（1.4.0）：**书籍子分类各自的属性顺序**（文学 `book` / 网文 `novel` / 漫画 `comic`）。
     *
     * 用户（2026-10-16）：「高级设置-属性分组再新增**文学网文**更明确的分组，新增归类对应属性」
     * → 追问裁定「拆成 文学 / 网文 / 漫画 三页」。
     *
     * 🔴 **append-only 可选字段，零迁移**：缺席 ⇒ 三个子类**一律回落 `fieldOrder.book`**
     *    （老用户只配过「书籍」那一份 ⇒ 升级后观感零变化）。
     *    ⛔ `fieldOrder` 里书籍那一份**保留不动** —— 它既是老数据、也是这里的回落源。
     * 归一 / 回落链见 `pure/fieldOrder.orderForBookKind`（唯一真源）。 */
    fieldOrderByKind?: Record<string, string[]>;
    /** 打卡日记所在文件夹（vault 内相对路径，如 日记）；留空/缺省 = 自动跟随核心「日记」插件配置。
     *  09-10 起**设置页不再提供入口**（打卡动作只在统计页「今日」面板），字段保留兼容/兜底读取。 */
    journalDir?: string;
    /** 打卡日记文件名格式（moment 日期格式，如 YYYY-MM-DD）；留空/缺省 = 自动跟随核心「日记」插件，未检测到用 YYYY-MM-DD。
     *  09-10 起设置页不再提供入口，字段保留兼容/兜底读取。 */
    journalFormat?: string;
}

export const DEFAULT_SETTINGS: ReelLudicSettings = {
    tmdbApiKey: '',
    tmdbSessionId: '',
    libraryDir: 'ReelLudic',
    doubanEnabled: false,
    platformTemplates: ['B站', 'Netflix', '豆瓣', '爱奇艺', '腾讯视频'],
    igdbClientId: '',
    igdbClientSecret: '',
    googleBooksApiKey: '',
    bangumiToken: '',
    doubanCookie: '',
    wereadCookie: '',
    colorTheme: 'mono',
    localizePosters: false,
    defaultViewMode: 'grid',
    hideScrollbars: false,
    posterDensity: 'standard',
    posterColumns: 6,
    // 🔴🔴 #626 **`wallColumns` 已下线**（用户 2026-10-20 删除「海报墙列数」设置项）——
    //    墙与卡片网格共用上面的 `posterDensity` / `posterColumns`，⛔ 别再把墙的列数默认值补回来。
    uiTheme: 'modern',
    // #541「个性化体验」四项 —— 🔴 缺省值必须让**升级后的观感与 1.2.0 逐项一致**：
    //    顶部胶囊 / 展开态 / 影视页 / 完整动效 / 标准卡片。换任何一个缺省都是在用户没点过的前提下换脸。
    navLayout: 'top',
    navCollapsed: false,
    startTab: 'media',
    motionMode: 'full',
    cardStyle: 'standard',
    // #591 Ctrl+滚轮缩放：**缺省关**（要接管系统手势，不能替所有人改行为）。旧数据无此键 ⇒ falsy ⇒ 关。
    ctrlWheelZoom: false,
    readerFontSize: 16,
    readerLineHeight: 1.8,
    readerIndent: true,
    readerHlStyle: 'hl',
    readerHlColor: 'yellow',
    internalBookReader: false,
    internalMediaPlayback: false,
    playerBgPlay: false,
    playerAutoNext: true,
    playerLoopOne: false,
    audioPlayMode: 'off',
    audioVolume: 1,
    lyricsWordHighlight: true,
    audioInlinePlayer: false,
    // #538 在线曲库检索（默认关：不主动开就与旧版行为一致）
    musicSongLibrary: false,
    musicDownloadEnabled: false,
    // #459：这两项的值 = **目录本身**（不再由代码拼 `音乐/` `书籍/` 子目录）⇒ 缺省就得带上子目录名，
    //   否则老用户/新装用户的默认落点会从 `下载/音乐` 变成 `下载/`（与既有文件分家、检索扫不到）。
    musicDownloadDir: DOWNLOAD_DIR_DEFAULT.music,
    bookDownloadDir: DOWNLOAD_DIR_DEFAULT.book,
    // #562 分类本地目录：缺省**空串** = 未配置（⛔ 别给个默认目录 —— 那会让「单集本地检索」在
    //   用户从没说过媒体放哪的前提下，去扫一个凭空冒出来的路径）。
    localDirBook: '',
    localDirNovel: '',
    localDirComic: '',
    localDirMovie: '',
    localDirTv: '',
    localDirAnime: '',
    musicDlCookies: {},
    // #496：空串 = 用系统 PATH 里的 yt-dlp（见 `ytdlpPath` 字段注释，⛔ 别填成 `yt-dlp`）
    ytdlpPath: '',
    // 凭据测试结论（空表 = 全部「还没测过」；⛔ 别预填任何 false）
    credentialStatus: {},
};

export const PLATFORM_URL_PRESETS: Record<string, string> = {
    B站: 'https://www.bilibili.com/search?keyword=',
    Netflix: 'https://www.netflix.com/search?q=',
    豆瓣: 'https://search.douban.com/movie/subject_search?search_text=',
    爱奇艺: 'https://so.iqiyi.com/so/q_',
    腾讯视频: 'https://v.qq.com/x/search/?q=',
};

/** ① 元数据源配置折叠项内**需 Key 源**展示顺序（spec S5 + IGDB 回归：Douban/TMDB/Bangumi/OMDb/Google Books/IGDB；遍历 PROVIDERS 派生，本表定序） *  ⛔ 2026-09-29：原来还有一张「免 Key 源展示顺序」表（Open Library/Steam/MusicBrainz/iTunes/AniList）——
 *     那一批只读行随用户要求整体删除（「不显示这类凭据」），表随之退场。
 *  🔴 #488：类型从 `ProviderId` **收窄成 `KeySourceId`**（`pure/sourceIcons` 那张图标表的键）——
 *     这样「加一个凭据源却忘了配图标」会在**编译期**报错，⛔ 别再退回宽类型（那会静默缺图标）。
 *  🔴🔴 #640（1.4.0）**补 Steam** —— 用户上手报障「没有显示啊」：
 *     #639 给 Steam 挂上了 `keyField: steamApiKey`（搜索免 Key、但同步库/愿望单要 Web API Key），
 *     注册表那侧配好了，**而这张定序表没跟上** ⇒ 凭据行压根没被渲染出来。
 *     ⚠️ 为什么类型系统没兜住：当时的 `KeySourceId` 联合里**也没有 steam**
 *        （它还在那份已删除的「免 Key 源」名单的心智里）⇒ 这张表少一项是**合法**的。
 *     ⇒ 两处一起补（本表 + `pure/sourceIcons` 的联合与图标表），
 *        ⛔ 以后再改「某源要不要凭据」必须**两边同时改** —— 只改注册表 = 界面静默不显示。
 *     ⚠️ 位置放在 **igdb 之前**（游戏类的两个源挨着；且它是本批新增，⛔ 不打乱既有六项的相对顺序，
 *        免得用户的肌肉记忆错位）。
 *  🔴 #640e（1.4.0）用户点名：「移到 **IGDB 上方**」—— 上一版把 steam 放在 igdb **之后**，
 *     本批按用户要求调成**在前**（`… 'googleBooks', 'steam', 'igdb'`）。
 *     ⚠️ 与上一批那条「放 igdb 之后」的注释**冲突**，以用户最新指令为准。 */
const KEY_SOURCE_ORDER: readonly KeySourceId[] = [
    'douban', 'weread', 'tmdb', 'bangumi', 'omdb', 'googleBooks', 'steam', 'igdb',
];

/**
 * 🔴🔴 #640e：「笔记属性顺序」主从视图里**当前选中哪个分组**。
 *   · `null`        —— 全局（六个类型共用的那批）
 *   · `{ type }`    —— 某个条目类型（movie / tv / anime / game / music）
 *   · `{ kind }`    —— **书籍的子分类**（文学 book / 网文 novel / 漫画 comic）
 *
 * 为什么要多一维：文学与网文的属性集**真不一样**（网文有「上架年 / 元数据章数」，
 *   文学有「译者 / 出版社 / ISBN / 装帧 / 定价」），而 `fieldOrder` 原本只按六类存
 *   ⇒ 书籍三者被迫共用一份顺序。用户要求「新增文学网文更明确的分组」⇒ 拆出这一维。
 * ⚠️ 存储上是**并行的可选键** `fieldOrderByKind`（见 `pure/fieldOrder` 模块头），零迁移。
 */
type FieldOrderTarget = { type: EntryType } | { kind: BookKind } | null;

/**
 * 🔴🔴 #653：「卡片信息栏」的八个切换格（用户点名顺序：**电影、剧集、动画、文学、网文、漫画、游戏、音乐**）。
 *
 * 六类型 + **书籍按子分类拆三页** —— 位置与「笔记属性顺序」那组的左导航一致（书籍原本那一格原地展开），
 *   ⛔ 别把文学/网文/漫画甩到末尾（那会让「书籍」这一族散开）。
 *
 * 🔴 存储口径：`cardFieldsByType` 仍是**六类型**（零迁移）；三个子分类各写 `cardFieldsByKind[kind]`，
 *    没配过 ⇒ 回落 `cardFieldsByType.book`（与 `fieldOrderByKind → fieldOrder.book` 同一条回落链）。
 *    ⚠️ 为什么不直接往 `cardFieldsByType` 里塞 `novel` / `comic`：那是个**按 EntryType 键**的表，
 *    塞进非 EntryType 的键会让 `resolveCardFieldsByType` 把它们当脏数据忽略（静默失效）。
 */
const CARD_TYPE_SLOTS: ReadonlyArray<{
    key: string;
    label: string;
    /** 预览卡 / 字段池按哪个条目类型算 */
    type: EntryType;
    /** 仅书籍子分类有值 */
    kind?: BookKind;
}> = [
    { key: 'f:movie', label: ENTRY_TYPE_LABELS.movie, type: 'movie' },
    { key: 'f:tv', label: ENTRY_TYPE_LABELS.tv, type: 'tv' },
    { key: 'f:anime', label: ENTRY_TYPE_LABELS.anime, type: 'anime' },
    ...BOOK_KINDS.map((k) => ({ key: `k:${k}`, label: BOOK_KIND_LABELS[k], type: 'book' as EntryType, kind: k })),
    { key: 'f:game', label: ENTRY_TYPE_LABELS.game, type: 'game' },
    { key: 'f:music', label: ENTRY_TYPE_LABELS.music, type: 'music' },
];

/** ② 数据源启用分类展示顺序（spec S5：书籍/漫画/影视/动画/音乐/游戏；registry SOURCE_GROUPS 顺序不同，UI 行序以此为准）。
 *  🔴 2026-09-30：漫画组**加回**（1.0.3.1 曾下线），UI 里**紧跟书籍**（同属书籍类目）——
 *     与 `SOURCE_GROUPS` 把 comic 追加在**末尾**不同：那张表的顺序服务于链解析，这张服务于用户读数习惯。 */
const GROUP_DISPLAY_ORDER: readonly SourceGroup[] = ['book', 'comic', 'movieTv', 'anime', 'music', 'game'];

/**
 * ③ 音乐源 · 三平台 Cookie 行（#399-D 移植批，顺序与弹窗胶囊一致：网易云 → QQ → 酷狗；酷我 #403 已撤）。
 * 🔴 「要不要填」这件事写在 `desc` 里（QQ 那条写「下载必需」、另两条写不填会怎样），
 *    ⛔ 别在描述里写「自动获取」这类做不到的话。
 *    ⚠️ 这些 `desc` / `hint` 是**纯文本**（`createDiv({ text })`，不解析 markdown）⇒ ⛔ 不许写 `**加粗**`
 *        —— 星号会**原样显示**（#489 顺手清掉 QQ 那条的 `**必需**`，本仓 user-facing 串不带 markdown）。
 * 🔴 2026-09-28 #403：**酷我整行撤除** —— 用户：「设置页的音乐源凭据中，既然酷我音乐支持免登录，
 *    就不要显示密钥填写项」。⇒ 表里只剩三行，`'free'` 这个状态**随之删除**。
 *    酷我仍能搜索 / 试听 / 下载 —— 那条链路**本来就不读 Cookie**（`services/dl` 里酷我走 mobi 免密通道），
 *    撤掉的只是「填不填」这个入口。
 * 🔴 #488：`id` 收窄成 `MusicSourceId`（`pure/sourceIcons` 图标表的键）—— 加一行却忘配图标 = 编译期报错。
 * 🔴🔴 **#489 翻面（用户 2026-10-02：「音乐源凭据标签下统一改成『未配置』」）**：
 *    徽标由「已填写 / 必需 / 可选」**统一成「已配置 / 未配置」** —— 与上一组「元数据源凭据」逐字同款。
 *    理由：同页两组凭据的行头徽标说的是**同一件事**（这个源配没配），却各用一套词；
 *    而「必需 / 可选」讲的是**要不要填**，那是 `desc` 的活（QQ 那条本来就写着「下载必需」）。
 *    ⇒ `status` 字段**成死码、一并删除**（本仓「死码不留」）；⛔ 别再把「必需 / 可选」做回徽标。
 */
const DL_COOKIE_ROWS: ReadonlyArray<{
    id: MusicSourceId;
    name: string;
    site: string;
    desc: string;
}> = [
    {
        id: 'netease',
        name: '网易云音乐',
        site: 'music.163.com',
        desc: '粘贴网页版登录 Cookie 后按会员档位下载（会员走无损/320k）；不填则只走免密标准音质。',
    },
    {
        id: 'qq',
        name: 'QQ 音乐',
        site: 'y.qq.com',
        desc: 'QQ 下载必需：在 y.qq.com 登录后复制 Cookie（需含 uin），否则该平台只能搜索、不能下载。',
    },
    { id: 'kugou', name: '酷狗音乐', site: 'kugou.com', desc: '可选：不填也能下载免费曲目。' },
];

/**
 * ④-B 站下载（yt-dlp）那行的行内说明（#496）—— 与上面三条 `desc` 同款：**纯文本**
 * （`createDiv({ text })`，不解析 markdown）⇒ ⛔ 不许写 `**`。
 * 🔴 三件必须说清的事：⑴ 它是干什么的；⑵ **留空会怎样**（不是「没配」而是「走系统 PATH」）；
 *    ⑶ mp3 还要 ffmpeg、yt-dlp 会去**哪两个地方**找它（⛔ 别只说「请安装 ffmpeg」，
 *    用户不知道放哪儿等于没说）。
 */
const YTDLP_PATH_DESC =
    'B 站音频下载用的 yt-dlp 可执行文件路径；留空则用系统 PATH 里的 yt-dlp。转 mp3 还需 ffmpeg（放 yt-dlp 同目录或系统 PATH 中）。';

/** 需 Key 但 Key 可选的数据源（未配仍照常工作，仅限流；空态徽标文案标「可选」而非「未配置」）
 *  🔴 #580：微信读书**也在这一集合里**，但理由与 googleBooks 不同 —— 它连「限流」都不涉及：
 *     书籍检索本身**免登录**（实测），Cookie 只是「测试连接」与「从微信读书同步书架」的凭据。
 *     ⇒ 用户不填 Cookie 时它照常参与搜索（⛔ 别把它挪出这个集合：那会让勾选后什么都不发生）。
 *     ⚠️ 空态徽标不借用「可选 Key」（它是 **Cookie**）—— 由注册表 `emptyBadge` 单独给文案。 */
const OPTIONAL_KEY_SOURCES: ReadonlySet<ProviderId> = new Set(['googleBooks', 'weread']);

/** 折叠 API 行的测试结果类型 */
export interface SourceTestResult {
    ok: boolean;
    message: string;
    /** 完整链路耗时（ms，发起请求到收到响应/失败/超时），恒返回 */
    elapsedMs: number;
}

/**
 * 挂内置图标并**吞掉异常**（与三个阅读器里的同名函数同款）。
 * 🔴 `setIcon()` 遇到不存在的图标名是**静默失败** —— 不抛错、不警告，只留一个**空白 span** ——
 *    界面上「图标不见了」却查不到任何日志。所以图标名一律取自 `pure/settingNav` 真源，
 *    并由 `tests/settingNav.test.ts` 的**实测白名单**兜住；⛔ 不要在调用点现写字符串。
 */
function safeSetIcon(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        // 图标不可用：忽略
    }
}

/**
 * 预览卡信息栏里**某一行**的类名（#616）——与真卡片的三档字号一一对应：
 *   · `creator` → `.rl-pvw-cr`（真卡 `.rl-creator`，10px）
 *   · `genres`  → `.rl-pvw-tag`（真卡 `.rl-tags`，10px + `text-faint`）
 *   · 其余      → `.rl-pvw-sub`（真卡 `.rl-sub`，11px）
 * 🔴 这三档是**照抄** `MediaList.svelte` 的 scoped 样式数值（那边是 scoped，设置页拿不到哈希
 *    ⇒ `styles.css` 里必须有一份全局的）。两处数值由断言钉成**等式**，⛔ 改一处必须改另一处。
 * ⛔ 别为了「省事」把它折成一个通用类 —— 三档显式列出来，以后加第四档才知道要补 CSS。
 */
function previewRowClass(f: CardFieldKey): string {
    if (f === 'creator') return 'rl-pvw-cr';
    if (f === 'genres') return 'rl-pvw-tag';
    return 'rl-pvw-sub';
}

/*
 * 🔴 #480：`renderAiIcon` / `aiChoiceIcon` 已搬到 **`services/aiIcon.ts`** —— 设置页与「服务商+模型」
 *    拣选弹窗两处共用，而两者的 **fill 分治**（品牌标填充式 / 内置标描边式）只许有一份。
 * `aiChoiceLabel` 搬到 **`pure/translate.ts`**（下拉选项与显示名同源）。
 * `keyRowIcon` 已删 —— #480 起 `siliconflow` 就是 `TranslateProvider` 的一员，直接查表即可。
 */

/** Tab 的 DOM id（`aria-controls` / `aria-labelledby` 互指用；稳定、可作断言锚点） */
function tabDomId(pageId: string): string {
    return `rl-set-tab-${pageId}`;
}

/** 页容器的 DOM id（同上） */
function pageDomId(pageId: string): string {
    return `rl-set-page-${pageId}`;
}

export class ReelLudicSettingTab extends PluginSettingTab {
    /** 当前选中的页（实例字段 ⇒ 重绘不丢；⛔ 不落库，属纯界面态） */
    private activePage: string = SETTING_NAV_DEFAULT;
    /** Tab 项 / 页容器：display() 每次重建，切页时同步 is-active */
    private tabItems = new Map<string, HTMLElement>();
    private pageEls = new Map<string, HTMLElement>();
    /** Tab 栏滚动容器（溢出遮罩门控要读它；display() 重建后重新指向） */
    private tabsEl: HTMLElement | null = null;
    /** #380 媒体库目录输入框的「边打边提示」实例；旧版本该 API 不存在 ⇒ 为 null（走「浏览」按钮）。
     *  ⚠️ 设置页重渲染/关闭时必须 `close()`，否则会留下孤儿浮层。 */
    private folderSuggest: FolderInputSuggest | null = null;
    /** 🔴 #411 「音乐下载路径目录」输入框的同款实例（与上面的 `folderSuggest` **各存一份** ——
     *  两个输入框可能先后各开一个浮层，共用一个字段会让先开的那个失去引用、关不掉）。
     *  ⚠️ 同样必须在重渲染 / 关闭设置页时 `close()`。 */
    private dlFolderSuggest: FolderInputSuggest | null = null;
    /** 🔴 #425 「书籍文件目录」输入框的同款实例 —— 与上面两个**各存一份**（三个输入框可能先后各开一个浮层，
     *  共用一个字段会让先开的那个失去引用、关不掉）。⚠️ 同样要在重渲染 / 关闭设置页时 `close()`。 */
    private bookFolderSuggest: FolderInputSuggest | null = null;
    /** 🔴 #425 起三个目录输入框的自动补全实例各存一份（见上）；#562 又添四个"分类本地目录"输入框
     *  —— 它们**共用**本 Map（一个「本地目录」浮层同时只可能开一个，用不到各存一份的粒度）。
     *  但**键必须包含键名**：同一个键的输入框在重绘后是**新元素**，旧实例仍指向已卸载的 input，
     *  不 close 就会留下一个飘在已删节点旁边的孤儿浮层。 */
    private localDirSuggests = new Map<LocalDirKey, FolderInputSuggest | null>();

    /**
     * #562 可折叠分组行的展开态（内存态，⛔ 不落库）：键 = 那一行的标题文本。
     *  ⚠️ 为什么按标题而不是按索引：`display()` 每次整页重建，索引会随「上面插了一行」而错位；
     *     标题是那一行**自己的身份**（同名行在本页不存在）。
     *  ⚠️ 缺省 = **收起**（用户口径「将每个设置项收起为摘要行」）；用户在本次会话里展开过就一直记着。
     */
    private expandedGroups = new Set<string>();
    /**
     * #617 「卡片信息栏」组**当前正在配置的类型**（内存态，⛔ 不落库）。
     * ⚠️ 每次 `display()` 整页重建都从 `'movie'` 起步 —— 它只是「我现在在看哪一类」的视图状态，
     *    ⛔ 别持久化：把它存下来会让下次打开设置页莫名停在某一类上，用户找不到原因。
     */
    private cardFieldsType: EntryType = 'movie';
    /** 🔴 #640 ⑶：「卡片信息栏」组的内容容器（= 该组 `.rl-svc-group-body`）——挂「已保存」轻提示时反查组标题用 */
    private cardFieldsGroupEl: HTMLElement | null = null;
    /** 🔴 #640 ⑶：那枚「已保存」轻提示本体（一次建好、反复点亮，⛔ 不每次重建节点） */
    private cardFieldsToastEl: HTMLElement | null = null;
    /** 🔴 #640 ⑶：淡出定时器（**只保留一个** —— 连点会叠多个定时器，旧的到点把新的也隐掉） */
    private cardFieldsToastTimer: number | null = null;
    /** 🔴 #479 「用途 › 模型」拉取到的真实模型清单（按服务商缓存）。#482 起**带真元数据** —— 见 `ModelFetched`。
     *  ⚠️ **只活在本次设置页会话**（实例字段），⛔ 不落库 —— 模型清单易变，存下来就是第二个「会过期的预置表」。 */
    private aiFetchedModels = new Map<TranslateProvider, ModelFetched[]>();
    /** #480 ④：试听用的两个引擎（**懒建 + 复用**；系统引擎会给 window 挂监听 ⇒ 必须能释放） */
    private ttsSystemEngine: SystemSpeechEngine | null = null;
    private ttsCloudEngine: CloudSpeechEngine | null = null;
    /** 系统语音 `voiceschanged` 只重绘一次（异步列表加载完那一趟），⛔ 别反复挂 */
    private ttsVoicesHooked = false;

    constructor(app: unknown, private plugin: ReelLudicPlugin) {
        super(app as never, plugin);
    }

    /**
     * 切到某一页：Tab 项与页容器**同时**亮起。
     *
     * 🔴 切完必须把 Tab 滚进可视区（#353 D-3 / #354 §6）：窄屏 / 手机上 Tab 栏可横向滚动，
     *    「方向键移到屏外项」会让内容变了、Tab 栏却毫无反馈。
     *    用 `inline:'nearest'` 而不是 `center` —— 已可见的项不该被无谓滚动（否则滚动条自己乱跳）。
     * ⚠️ 滚完要重算一次溢出遮罩（滚动位置的改变会让「哪一端还有内容」变化）。
     */
    private setActivePage(id: string): void {
        this.activePage = id;
        this.tabItems.forEach((el, k) => el.toggleClass('is-active', k === id));
        this.pageEls.forEach((el, k) => el.toggleClass('is-active', k === id));
        // 无障碍状态与视觉同步（读屏软件只看 aria-*，不看类名）：`aria-selected` + roving tabindex。
        // 🔴 取值规则（含「activeId 不在栏内」那条兜底）收敛在纯函数 `tabStates` 里，由单测钉住；
        //    这里只负责把值写进 DOM。
        tabStates(id).forEach((st) => {
            const tabEl = this.tabItems.get(st.id);
            if (!tabEl) return;
            tabEl.setAttribute('aria-selected', String(st.selected));
            tabEl.setAttribute('tabindex', st.tabindex);
        });
        const activeTab = this.tabItems.get(id);
        if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        this.syncTabsOverflow();
    }

    /**
     * 重算 Tab 栏的**溢出遮罩门控**（#354 §6.2 方案 b，与 Obsidian 核心 `.is-scrolled` 同款做法）：
     * 只有在「那一端确实还有内容」时才挂对应类 ⇒ 遮罩不会撒谎（滑到端点就不再遮，⛔ 不用常驻遮罩）。
     *
     * 🔴 为什么必须门控：常驻遮罩会在已经滑到最右端、右边什么都没有时**仍然把最后一项遮淡**
     *    —— 用户看到的是「最后那个 Tab 坏了」。
     * ⚠️ 类名成对使用：`is-overflow-start` / `is-overflow-end` 可同时成立（滑到中间），
     *    CSS 里那条「两端都要」的合并规则靠两个类同时命中。
     * ⚠️ 空栏 / 未溢出（`maxScroll <= 1`）⇒ 两个类都不挂（把 1px 亚像素误差也当"没溢出"）。
     */
    private syncTabsOverflow(): void {
        const el = this.tabsEl;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        const overflow = max > 1;
        // 亚像素 / RTL 下 scrollLeft 可能是小数或负值 ⇒ 用 1px 容差而不是 `> 0`
        el.toggleClass('is-overflow-start', overflow && el.scrollLeft > 1);
        el.toggleClass('is-overflow-end', overflow && el.scrollLeft < max - 1);
    }

    /** 滚动时重算（挂/摘类都在这一个入口；`passive` ⇒ 不阻塞滚动） */
    private onTabsScroll = (): void => {
        this.syncTabsOverflow();
    };

    /** 窗口尺寸变化 → Tab 栏可用宽变了 ⇒ 溢出状态必须重算（与核心 `.is-scrolled` 同款） */
    private onWindowResize = (): void => {
        this.syncTabsOverflow();
    };

    /**
     * 关闭设置面板：把 **window** 上的监听摘掉（Tab 栏自身随 DOM 一并销毁，不必手动清）。
     * ⚠️ `display()` 每次打开都会调用 ⇒ 不摘会按「打开次数」累积监听器
     *    （同一函数引用重复 add 是幂等的，但**每次 display() 都是新实例字段**吗？不是 ——
     *    它们是类字段箭头函数，引用稳定 ⇒ 严格说不会累积；这里仍然显式摘除，避免依赖那个细节）。
     */
    hide(): void {
        window.removeEventListener('resize', this.onWindowResize);
        this.folderSuggest?.close(); // #380：输入建议浮层随面板一起收
        this.folderSuggest = null;
        this.dlFolderSuggest?.close(); // #411：音乐下载目录那颗同理（三个实例都要收）
        this.dlFolderSuggest = null;
        this.bookFolderSuggest?.close(); // #425：书籍文件目录那颗
        this.bookFolderSuggest = null;
        // #562：六个「分类本地目录」输入框的浮层（一个 Map 装全部；见 `localDirSuggests` 的说明）
        for (const inst of this.localDirSuggests.values()) inst?.close();
        this.localDirSuggests.clear();
        // #480 ④：试听引擎随面板释放（系统引擎在 window 上挂了 `voiceschanged`，云引擎可能正在播）
        this.ttsSystemEngine?.dispose();
        this.ttsSystemEngine = null;
        this.ttsCloudEngine?.cancel();
        this.ttsCloudEngine = null;
        this.ttsVoicesHooked = false;
        this.tabsEl = null;
        super.hide();
    }

    /**
     * 创建可切换明文/密文的密钥输入框：
     * 默认密文（password），点击「显示/隐藏」按钮切换 type，兼顾安全与核对。
     */
    private createSecretField(
        body: HTMLDivElement,
        opts: { placeholder: string; value: string; onInput: (v: string) => void },
    ): HTMLInputElement {
        const wrap = body.createDiv({ cls: 'rl-secret' });
        return this.fillSecretRow(wrap, opts);
    }

    /**
     * 往一个**已有的** `.rl-secret` 行里填「输入框 + 显示/隐藏」。
     *
     * 🔴🔴 #654（用户：「steam 下的两个值框对齐 IGDB 凭据样式」）：Steam 的第二个值框（SteamID）
     *    原来走的是 `.rl-steam-id`（只给了 `max-width: 320px`，于是它比 IGDB 的框**短一截**）。
     *    ⇒ 抽成本方法，让 SteamID 也落在 `.rl-secret` 这套**同一份**几何里。
     * ⚠️ 抽出来而不是复制：`.rl-secret` 的宽度 / 内距 / 右侧「显示」的尺寸只有一处定义，
     *    两处各写一遍迟早会漂（本仓「同一件事写两遍」栽过多次）。
     * ⚠️ `type` 由 `opts.masked` 决定：SteamID 是**明文**（它不是密钥，用户要能核对位数），
     *    但**仍保留「显示 / 隐藏」那一栏** —— 用户要的两框对齐，对齐的正是这一栏的位置。
     *    明文时按钮恒显「显示」且禁用（点了不该有任何事发生，⛔ 别做成「点了变乱码」）。
     */
    private fillSecretRow(
        wrap: HTMLDivElement,
        opts: { placeholder: string; value: string; onInput: (v: string) => void; masked?: boolean },
    ): HTMLInputElement {
        const masked = opts.masked !== false;
        const input = wrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: opts.placeholder, type: masked ? 'password' : 'text', spellcheck: 'false' },
        });
        input.value = opts.value;
        const toggle = wrap.createEl('button', {
            cls: 'rl-secret-eye',
            attr: { type: 'button' },
            text: masked ? '显示' : '隐藏',
        });
        // 🔴🔴 #655（用户：「steamid 的显示按钮点击无反应」）：那一枚**必须能点**。
        //    上一版把它做成 `is-static`（明文项没有「隐藏」可言）⇒ 点了真的什么都没发生。
        //    ⇒ 现在明文项也走**同一个切换**：点「隐藏」→ 退回 `password`（✓ 圆点）；再点「显示」→ 明文。
        //    这样它既与原位置对齐，也真有反馈 —— ⛔ 别再为了对齐把按钮做成死的。
        const apply = (show: boolean): void => {
            input.type = show ? 'text' : 'password';
            toggle.setText(show ? '隐藏' : '显示');
            toggle.setAttribute('data-tip', show ? '隐藏' : '显示');
        };
        // 初始态：`masked` 项从「隐藏」起步（显示「显示」）；明文项从「显示」起步（显示「隐藏」）
        apply(!masked);
        toggle.addEventListener('click', () => apply(input.type === 'password'));
        input.addEventListener('input', () => opts.onInput(input.value.trim()));
        return input;
    }

    /**
     * 「元数据源配置」页（#352：原为 `renderServiceSection` 的前半段，标题升格成导航项后独立成页；
     * #354 标签由「数据源管理」改成「数据源配置」；**#422 再改成「元数据源配置」** ——
     * 每次改名都必须同步全仓处方文案，见 `pure/sourceRegistry` / `ImportBangumiModal` / 下载弹窗）。
     *
     * 🔴 **折叠能力已整体撤除**：改版前是「一级标题常显 + 子分组可折叠」，现在
     *   **子分组一律常显**（`createGroupSection` 不再挂 caret、不再有 open 态）；
     *   #353 把「页」的切换换成横向 Tab 后，**页面本身也不再有第二个可折叠层**
     *   （#352 那套窄屏手风琴 `.rl-set-page-head` 已整体退场）。
     *   原因：Obsidian 原生设置页只有两层，再叠「分组折叠」就成了「点开页 → 里面还要再点开一个组」
     *   的**两层折叠嵌套**，正是用户要消灭的「层级模糊」。
     *   ⚠️ **#422 的唯一例外**：书籍源那**两个小节**（网络文学源 / 经典文学源）是用户点名要折叠的
     *      —— 它们在「书籍源凭据」**组内**，走 `.rl-key-row` 那一套（与源行同款），
     *      ⛔ **本节这套「组标题不折叠」的规则没有跟着变**，别顺势把 `createGroupSection` 也改掉。
     *
     * 🔴 层级口径（2026-09-18 第七次裁定，仍然有效）：子分组标题 13px/600 与原生设置行
     *   **同一左缘**；组内容再缩进一档（80px），与标题形成阶梯。
     *   ⚠️ #353 去掉页标题后，**页内首个元素就是子分组标题** ⇒ 它自带的 `margin` 会把页顶顶开一段，
     *      由 styles.css 的 `.rl-set-page-body > .rl-svc-group:first-child { margin-top: 0 }` 收掉。
     * ⚠️ 元数据源凭据内的**源行**仍各自可展开 —— 那是输入框收纳，与分组本身无关。
     *
     * 🔴🔴 **#488 组序改判（用户 2026-10-02：「插件设置页-元数据源凭据界面也改成 AI 集成的样式，加图标，
     *    凭据移到上面」）**：页内组序从「启用 → 元数据源凭据 → 音乐源凭据」改成
     *    **「元数据搜索源凭据 → 音乐下载源凭据 →（书籍源凭据）→ 元数据搜索源启用」**——凡「凭据」一律排到「启用」之前。
     *    （组名按 #690 的改名口径写；当年 #488 定序时的旧名见下文「元数据源凭据」字样。）
     *    依据与 AI 页 #483 那条**同源**：接入的心智顺序是「**先连上 → 再选它用在哪**」
     *    （AI 页正是把「模型服务」提到「用途」之前）。⛔ 别只搬「元数据源凭据」一组留下音乐源 ——
     *    用户在本轮明确选了「所有凭据组都上移」。
     *    ⚠️ 组**内容与能力一字未改**，只换位置；「元数据源凭据 在 音乐源凭据 之前」这条**照旧成立**。
     *    ⚠️ 本页 `createGroupSection` **仍是 4 处**（#400/#419 定的「不再加第 5 组」口径继续有效）。
     */
    private renderSourcePage(parent: HTMLElement): void {
        // #422 改名：页签「数据源配置」→「元数据源配置」，两个组同步加「元」字。
        // 原因（用户原话）：「数据源配置、凭据改成元数据源配置、凭据」—— 本页三个组里
        // **只有前两组是元数据源**，后两组分别是音频源（音乐源凭据）与内容源（书籍源凭据），
        // 统称「数据源」会让「音乐/书籍也算数据源」这件事一直含混。
        // ⚠️ 改组名必须同步全仓处方文案（`pure/sourceRegistry` / `ImportBangumiModal` / 下载弹窗），
        //    否则提示会指向一个**不存在的入口**（本仓铁律，见 MEMORY）。
        // 🔴🔴 #690（1.4.1，用户 2026-10-20 点名）：「设置页-音乐源凭据名称改成『音乐下载源凭据』，
        //    元数据源凭据改成『元数据搜索源凭据』、元数据源启用改成『元数据搜索源启用』」。
        //    ⇒ 本页三个组名（以及全仓处方文案里的路径）统一带上「搜索 / 下载」这个**用途后缀**：
        //       元数据搜索源凭据 = 填搜索服务商的凭据；音乐下载源凭据 = 填下载 / 试听的 Cookie；
        //       元数据搜索源启用 = 勾选哪几类搜索、每类用哪些源。
        //    ⚠️ **页签名「元数据源配置」不动**（用户只点了三个组名）—— 导航图标表同理，见 `pure/settingNav`。
        this.createGroupSection(parent, '元数据搜索源凭据', (body) => {
            // #488：整组先包一层 `.rl-prov-list`（flex column + gap 8px），行长什么样子由 `createApiKeyRow`
            // 自己挂 `.rl-prov-card` 决定 —— 与 AI 页「模型服务」那组**同一套容器 + 同一个类**。
            const list = body.createDiv({ cls: 'rl-prov-list' });
            for (const id of KEY_SOURCE_ORDER) this.createApiKeyRow(list, id);
            // ⛔ 2026-09-29（用户上手当天）：「免 Key 源」那一批只读行**整体删除** ——
            //    用户原话「把元数据源凭据设置里的免 Key 的那些也删除掉，不显示这类凭据」。
            //    它们本来就**没有任何可配置的东西**（源名 + 「免 Key」徽标，展开只有一句说明），
            //    列在「凭据」组里属于名不副实：没凭据可填的源不需要出现在凭据页。
            //    ⇒ `FREE_SOURCE_ORDER` / `createFreeSourceRow` / `.rl-key-badge-free` 一并退场（死码不留）。
            //    ⚠️ 这些源**照常参与搜索** —— 删掉的只是「凭据页里那一行只读说明」，不是源本身（enabled 开关在下一组）。
        });
        // 2026-09-28 #400（用户：「设置页音乐源改成仿上折叠样式，为音乐源凭据分组下」）：
        // 四平台 Cookie 从「元数据源凭据」里**搬出来自成一组**，行形态也换成**与上面源行同款的可折叠行**
        // （源名 + 徽标 + ▸ → 展开才是密文输入 + 测试连接）。
        // #488：与本组同样卡片化（用户本轮点名「音乐源凭据一起改」）—— 容器与卡片类都由
        // `renderMusicCookieRows` 内部挂，调用点形态不变。
        this.createGroupSection(parent, '音乐下载源凭据', (body) => this.renderMusicCookieRows(body));
        this.createGroupSection(parent, '元数据搜索源启用', (body) => {
            for (const g of GROUP_DISPLAY_ORDER) this.createGroupCheckRow(body, g);
        });
        // ⛔ 2026-09-27 #399 起「音乐集成」分组已整体撤除（用户：「把设置页-音乐集成分组和其下项都删除掉」）。
        //    「启用歌曲下载」「下载目录」两项随之从**本页**消失：下载能力改由**「启用内置音乐播放器」**
        //    （基本设置 · 实验性功能）单点门控。
        //    ⚠️ 2026-09-28 #403：「下载目录」**在「基本设置 › 数据与备份」里回来了**（改名「音乐下载路径目录」，
        //    因为它的字段一直是 `downloadSong` 的 root）⇒ ⛔ 别再把「目录类设置」加回本页。
    }

    /**
     * ⛔ 2026-09-27 #399：「音乐集成」分组（`启用歌曲下载` + `下载目录`）**从本页整体删除** ——
     *    用户原话「把设置页-音乐集成分组和其下项都删除掉」。这两项一个字都不许加回**本页**：
     *      · 「启用歌曲下载」的职责并入**「启用内置音乐播放器」**（基本设置 · 实验性功能）——
     *        开 ⇒ 笔记内 lrc 块就地显示播放器 **且** 音乐编辑表单给「下载」按钮；关 ⇒ 两者都没有。
     *      · 「下载目录」⇒ **2026-09-28 #403 起以「音乐下载路径目录」的名义放回「基本设置 › 数据与备份」**
     *        （用户明确要求新增该设置项）。⛔ 别在这里重建它。
     *    ⚠️ 这两个下载字段（总开关 / 目录）**仍保留**（AGENTS 红线：字段只能追加不能删）——
     *    前者已**不再被任何地方读取**，后者仍是 `downloadSong` 的 root。
     */

    /**
     * 「元数据源配置」页 · **「音乐源凭据」组**：各平台下载 / 试听的登录 Cookie（#399-D 移植批；#400 独立成组）。
     *
     * 🔴 **行形态与上面「元数据源凭据」里的源行完全同款**（`rl-key-row` / `rl-key-head` / `rl-key-body`）：
     *    来源图标 + 源名 + 状态徽标 + ▸，点行头才展开密文输入与「测试连接」。
     *    用户 2026-09-28 原话：「设置页音乐源改成仿上折叠样式，为音乐源凭据分组下」——
     *    「仿上」= 照抄 `createApiKeyRow` 那一套，⛔ 别再退回「一行一个常显输入框 + 按钮」的平铺形态。
     *    🔴 #488（用户 2026-10-02：「音乐源凭据一起改」）：与元数据源凭据**一起卡片化** ——
     *       本组内容自己包一层 `.rl-prov-list`、行挂 `.rl-prov-card`、行头最前挂平台图标
     *       （真源 `MUSIC_COOKIE_ICON`：网易云走 simple-icons 品牌标，QQ / 酷狗未被收录 ⇒ 内置图标兜底）。
     *       ⚠️ 调用点形态没变（`createGroupSection` 里仍是 `(body) => this.renderMusicCookieRows(body)`），
     *          容器在**函数内部**建 —— 这样「音乐源凭据」一组就是自洽的（⛔ 别把建容器挪到调用点）。
     *    🔴 #489：徽标**统一成「已配置 / 未配置」**（与上面那组逐字同款，见 `DL_COOKIE_ROWS` 注释）；
     *       「要不要填」由行内 `desc` 说（QQ 那条写着「下载必需」）。
     * ⚠️ Cookie 明文存 `data.json`（与各源 API Key 同款）—— 说明写在行内描述里，⛔ 不做额外加密（保持既有凭据一致）。
     */
    private renderMusicCookieRows(parent: HTMLDivElement): void {
        const list = parent.createDiv({ cls: 'rl-prov-list' });
        for (const p of DL_COOKIE_ROWS) {
            const row = list.createDiv({ cls: 'rl-key-row rl-prov-card' });
            const head = row.createDiv({ cls: 'rl-key-head' });
            renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), MUSIC_COOKIE_ICON[p.id]);
            head.createSpan({ cls: 'rl-key-name', text: p.name });
            const badge = head.createSpan({ cls: 'rl-key-badge' });
            const current = (): string => this.plugin.settings.musicDlCookies?.[p.id] ?? '';
            // 🔴 #489：徽标两态 =「已配置 / 未配置」，与上一组「元数据源凭据」**逐字同款**
            //    （⛔ 别再退回「已填写 / 必需 / 可选」—— 同页两组说同一件事却两套词，用户点名统一）。
            const refreshBadge = (): void => {
                const has = !!current();
                // 🔴 #589：第三态「连接失败」（开机自检 / 手动测试测不通）；没测过（`undefined`）不标。
                const expired = has && isExpired(this.plugin.credentialStatusOf(musicCheckKey(p.id)));
                badge.setText(expired ? EXPIRED_BADGE : (has ? '已配置' : '未配置'));
                badge.toggleClass('rl-key-badge-on', has && !expired);
                badge.toggleClass('rl-key-badge-bad', expired);
            };
            refreshBadge();
            head.createSpan({ cls: 'rl-key-caret', text: '▸' });

            const body = row.createDiv({ cls: 'rl-key-body' });
            body.createDiv({ cls: 'rl-hint-note', text: p.desc });
            this.createSecretField(body, {
                placeholder: `${p.site} 的 Cookie`,
                value: current(),
                // ⚠️ 与「媒体库目录」不同**不做**「失焦才提交」：这个值只在「点下载 / 试听 / 测试连接」那一刻被读，
                //    边打边存没有副作用（⛔ 别照搬那一套以为漏了）。
                onInput: (v) => {
                    const next = { ...(this.plugin.settings.musicDlCookies ?? {}) };
                    if (v) next[p.id] = v;
                    else delete next[p.id];
                    this.plugin.settings.musicDlCookies = next;
                    void this.plugin.saveSettings();
                    // #589：值一改 ⇒ 旧的「连接失败」作废
                    this.plugin.clearCredentialStatus(musicCheckKey(p.id));
                    refreshBadge();
                },
            });
            // 「测试连接」与源行同款反馈（✓/✗ 文案 · Nms；失败红、成功绿）
            // 用户裁定：结果文字在按钮**左边**、点测试时按钮**不许跳**（见 styles.css `.rl-key-actions` 注释）。
            const actions = body.createDiv({ cls: 'rl-key-actions' });
            const resultEl = actions.createSpan({ cls: 'rl-key-result' }); // 行首：文字向左长，按钮贴右不动
            const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                // ⛔ 不改文案：`.rl-btn-loading` 已把文字置透明并叠 spinner；改文案（「测试中…」更短）
                //    会让按钮宽度变窄 ⇒ 按钮横向跳动，那正是用户报的那类抖动。
                testBtn.addClass('rl-btn-loading');
                resultEl.setText('');
                resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
                const started = Date.now();
                const r = await this.plugin.dlTestConnection(p.id, current());
                const elapsedMs = Date.now() - started;
                testBtn.disabled = false;
                testBtn.removeClass('rl-btn-loading');
                // 🔴 #589：结论记进同一张结果表 ⇒ 徽标（含刚被打开的「连接失败」）同步刷新
                this.plugin.setCredentialStatus(musicCheckKey(p.id), r.ok);
                refreshBadge();
                resultEl.setText(`${r.ok ? '✓ ' : '✗ '}${r.message} · ${elapsedMs}ms`);
                resultEl.toggleClass('rl-key-result-ok', r.ok);
                resultEl.toggleClass('rl-key-result-bad', !r.ok);
            });
            head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
        }
        // ── ④-B 站音频流（#496）：yt-dlp 可执行文件路径 ──
        // 🔴 为什么排在**同一个组**里：它是「下载这一件事的配置」，与三条 Cookie 一起读最省事；
        //    但它是**路径不是凭据** ⇒ 输入框走明文（不挂「显示/隐藏」眼睛），⛔ 别用 `createSecretField`。
        // ⚠️ 这行是**追加**在 `DL_COOKIE_ROWS` 循环**之后**的 —— #488/#489 那几条按「循环体内前几行」
        //    锚死的断言因此不受影响（改这里别把循环挪走）。
        const dlRow = list.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const dlHead = dlRow.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(dlHead.createSpan({ cls: 'rl-ai-icon' }), { kind: 'builtin', id: 'terminal' });
        // 🔴 #555：本行名称按用户裁定改名（原先是「工具名 + 括号里的用途」那种写法）——
        //    旧名把**实现工具**当成了功能名，用户看不出这行到底在开什么；新名先说是「B 站音频流」，
        //    再把两个外部依赖写进括号（与下面 `YTDLP_PATH_DESC` 说的事一致，⛔ 别改成第二套说法）。
        //    ⚠️ 注释里**刻意不复述旧名** —— 反向守卫会连同注释一起查（本仓老坑：写了就自撞）。
        // 🔴 用户裁定（1.4.x）：标题只写「B站音频流」——⛔ 别在这里挂「（需yt-dlp、ffmpeg）」：
        //    依赖说明已经是下方那个路径项的描述（`YTDLP_PATH_DESC`，写了留空=走 PATH、转 mp3 还需 ffmpeg），
        //    标题里再重复一遍只是噪音（用户原话：去掉）。
        dlHead.createSpan({ cls: 'rl-key-name', text: 'B站音频流' });
        const dlBadge = dlHead.createSpan({ cls: 'rl-key-badge' });
        const currentExe = (): string => this.plugin.settings.ytdlpPath ?? '';
        const refreshExeBadge = (): void => {
            // ⚠️ 徽标与上面三条**逐字同款**（#489 的「已配置 / 未配置」）：本行的「未配置」= 走系统 PATH，
            //    那件事由行内 desc 说清（往徽标里塞第三套词反而与同页两份凭据打架）。
            const has = !!currentExe().trim();
            dlBadge.setText(has ? '已配置' : '未配置');
            dlBadge.toggleClass('rl-key-badge-on', has);
        };
        refreshExeBadge();
        dlHead.createSpan({ cls: 'rl-key-caret', text: '▸' });
        const dlBody = dlRow.createDiv({ cls: 'rl-key-body' });
        dlBody.createDiv({ cls: 'rl-hint-note', text: YTDLP_PATH_DESC });
        // 明文输入（复用 `.rl-secret*` 的盒模型，⛔ 不加眼睛按钮）
        const exeWrap = dlBody.createDiv({ cls: 'rl-secret' });
        const exeInput = exeWrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: 'yt-dlp.exe 的完整路径（留空 = 用系统 PATH）', type: 'text', spellcheck: 'false' },
        });
        exeInput.value = currentExe();
        exeInput.addEventListener('input', () => {
            this.plugin.settings.ytdlpPath = exeInput.value.trim();
            void this.plugin.saveSettings();
            refreshExeBadge();
        });
        dlHead.addEventListener('click', () => dlRow.toggleClass('rl-key-open', !dlRow.hasClass('rl-key-open')));
    }

    /** 「AI集成」页（同上，原 `renderServiceSection` 的后半段） */
    private renderAiPage(parent: HTMLElement): void {
        this.renderTranslateFold(parent);
    }

    /**
     * 主题域内的子分组（#352）：**标题 + 图标常显，内容直接展开** —— 折叠能力整体撤除。
     *
     * 🔴 **为什么把折叠也去掉**：改版后「切页」本身已经是一次展开动作（#354 起是点顶部 Tab），
     *    页内再来一层「点开分组」＝**两级嵌套**，恰好重新制造这次要消灭的「层级模糊」。
     *    所以子分组退成**纯静态标签**：不带折叠箭头、不带展开态类名、不挂 click。
     *    （历史沿革见 UI-GUIDE：09-18 第四次裁定「恢复折叠」→ #352 第五次裁定「取消折叠」。）
     *
     * 标题行 = 原生设置行的**左缘与字号**（13px / 600 / `--text-normal`）+ 按标题取的图标；
     * ⛔ 不再有 `:hover` 底色与 `cursor: pointer`（静态标签不该看起来可点）。
     * 组内容依旧缩进一档，形成「标题 → 子分组 → 内容」三档。
     * ⚠️ 数据源凭据内的**源行**仍各自可展开 —— 那是输入框收纳，与分组本身无关。
     *
     * 🔴 **#490 组级说明整体退场**（用户 2026-10-02 点名删掉「实验性功能」组下那句风险提示）：
     *    #477 为那一组加的可选第 4 参（`note`）与配套的灰小字样式**一并删除** —— 它只有那一个使用者，
     *    删掉实参就成死码（本仓「死码不留」）。
     *    ⚠️ 这里**刻意不把删掉的那句原文抄进注释**（本仓 #422 的既定做法）：注释会进产物且中文**不转义**，
     *       抄进来会让「这句不许回潮」的反向守卫被**自己的注释**撞红。
     *    ⚠️ 连带撤掉「组级说明」这个能力本身：⛔ 别再把第 4 参加回来；真要给某组加说明，先看 #422 的先例
     *       （书源那组两行灰字被用户嫌「太丑」整体删过）—— 用户对本页的偏好是**少字**。
     */
    private createGroupSection(
        parent: HTMLElement,
        title: string,
        fill: (body: HTMLDivElement) => void,
        nativeGroup = false,
    ): void {
        // 🔴 #553 第 4 参 = 借**核心原生的分组结构**（`.setting-group` + `.setting-items`）：
        //    新版 Obsidian 自己就带「组 = 一张卡、组内各行平铺、行间细分隔线」这套规则
        //    （app.css：`.setting-group .setting-items { background/border-radius/border }` +
        //      `.setting-group .setting-item:not(.setting-item-heading) { border:none; background:transparent }`）。
        //    ⇒ 基本设置页**直接用核心的类名**，让它自己算，⛔ 别再手写分组卡 + 覆盖 ——
        //      #541 手写过一版（分组卡）、#551 又手写过一版压制（压主题给的框），两版都在替核心打工，
        //      还一路踩到「每一行各自一个框」。用户上手后一句话点到根上：「还是改回 Obsidian 原生吧」。
        //    ⚠️ 数据源 / AI 页**不传**这个参数：那两页组内各有自己的卡片（`.rl-prov-list` / `.rl-ai-svc-card`），
        //      再套一层原生卡就是卡中卡。
        //    ⚠️ 代价是核心的 `.setting-group { max-width: var(--setting-group-max-width) }`（默认 700px、
        //      且 `margin-inline: auto`）会一起生效 —— 那正是原生设置页的观感，本批**刻意接受**。
        const wrap = parent.createDiv({ cls: nativeGroup ? 'rl-svc-group setting-group' : 'rl-svc-group' });
        const head = wrap.createDiv({ cls: 'rl-svc-group-title' });
        // 图标按标题从真源取；未登记则跳过（只是缺个图标，不抛错）
        const icon = groupIcon(title);
        if (icon) safeSetIcon(head.createSpan({ cls: 'rl-svc-group-icon' }), icon);
        head.createSpan({ text: title });
        // ⛔ #490：这里原有一行「组级说明」（`if (note) …`）—— 已随旧的第 4 参一并删除（死码不留）
        // 🔴 #553：`nativeGroup` 时给内容器补核心的 `.setting-items`（组卡与行平铺都由它触发，见上）。
        const body = wrap.createDiv({ cls: nativeGroup ? 'rl-svc-group-body setting-items' : 'rl-svc-group-body' });
        fill(body);
    }

    /**
     * 把一个「恢复默认」按钮挂到某组的**标题行右侧**（#652，用户：「高级设置下的三个组都要有恢复默认项」）。
     *
     * 🔴 为什么挂在组标题行而不是组内容顶部：三组的位置**完全一致** ——
     *    用户不必每组各找一次「按钮在哪」；也⛔ 不挤占内容区（那会让表格 / 卡片整体下移一行）。
     * 🔴🔴 **#653 翻面：按钮常显，未修改时点了给「轻提示」** ——
     *    用户原话「还有要始终出现『恢复默认』，未修改时误点击要轻提示」。
     *    上一版是「没配置就整枚不渲染」，那会让按钮**看起来时有时无**（用户不知道该不该点、
     *    甚至会以为功能没了）。现在一律显示，靠 `isCustomized()` 分成两条路：
     *      · 有配置 ⇒ `ConfirmModal` 二次确认 → 清键 → 整组重画；
     *      · 没配置 ⇒ **什么都不改**，只在按钮旁浮出一枚「已经是默认值」轻提示（1.5s 自动淡出）。
     *    ⚠️ 轻提示**不弹 Notice**：Notice 在右上角、离按钮很远，用户点下去会以为「没反应」。
     */
    private mountGroupReset(body: HTMLElement, opts: {
        /** 当前是否有用户配置（决定是「二次确认」还是「轻提示」） */
        isCustomized: () => boolean;
        /** 组名（进 aria-label 与确认文案） */
        title: string;
        /** 确认弹窗正文：**逐字说清会丢什么**（⛔ 别只写「确定吗」） */
        message: string;
        /** 执行恢复（只负责落盘，重画由本方法统一做） */
        apply: () => Promise<void>;
    }): void {
        const group = body.closest('.rl-svc-group');
        const head = group?.querySelector('.rl-svc-group-title');
        if (!head) return;
        // 同一组重画时先摘掉旧的按钮与提示（⛔ 不叠第二份）
        head.querySelector('.rl-group-reset')?.remove();
        head.querySelector('.rl-group-hint')?.remove();
        const btn = head.createEl('button', {
            cls: 'rl-group-reset',
            attr: {
                type: 'button',
                'aria-label': `恢复「${opts.title}」的默认设置`,
                // 状态即文案语义：没改过时提示「点了也没用」，读屏能听见这条差异
                'aria-describedby': `rl-gr-hint-${opts.title}`,
            },
        });
        safeSetIcon(btn.createSpan({ cls: 'rl-group-reset-icon' }), 'rotate-ccw');
        btn.createSpan({ cls: 'rl-group-reset-text', text: '恢复默认' });
        const hint = head.createDiv({
            cls: 'rl-group-hint',
            text: '已经是默认值',
            attr: { id: `rl-gr-hint-${opts.title}`, role: 'status', 'aria-live': 'polite' },
        });
        const timer = { id: 0 as number };
        const flashHint = (): void => {
            hint.addClass('is-on');
            if (timer.id) window.clearTimeout(timer.id);
            timer.id = window.setTimeout(() => hint.removeClass('is-on'), 1500);
        };
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // 🔴 未修改：只给轻提示，⛔ 不开确认弹窗、⛔ 不写盘
            if (!opts.isCustomized()) {
                flashHint();
                return;
            }
            void (async () => {
                const ok = await new ConfirmModal(this.app, opts.message, '恢复默认').open();
                if (!ok) return;
                await opts.apply();
                this.display();
            })();
        });
    }

    /**
     * ② AI集成 内容（**#483 定稿**）：两组 ——「模型服务」四张服务商卡片（Logo + 名称 + 状态徽标 +
     * 就地「测试」+ 展开配 Key / base）+「用途」翻译 / 总结 / 搜索 / 朗读四行（各带自己的提示词，
     * 朗读音源无提示词），四行收在**一张卡**里。
     *
     * 🔴 #356 两组行序调整（用户指令）：
     *    ⑴ **朗读音源**（原「语音合成」组的头一行）搬到 **用途 组末尾** —— 用户原话「把AI集成-朗读音源项
     *       放到搜索服务项下面」。
     *    ⑵ **硅基流动 Key**（原「语音合成」组的第二行）搬到凭据组 ——
     *       用户原话「把硅基流动放到API凭据下面」；四家 Key 从此都在同一个凭据区里。
     *    ⇒ 「语音合成」这一整组**随之撤销**（两行都搬走后组内无内容，Obsidian 原生设置页里只会剩一个
     *       孤零零的标题）—— ⚠️ 连带全仓指向「AI集成 下的那个语音分组」的提示文案必须改指
     *       **`设置 → AI集成 › 模型服务 · 硅基流动`**（#483 改名后），否则提示会指向一个不存在的入口（本项目铁律）。
     *
     * 🔴 #479 行序再调（用户指令）：「**硅基流动放到自定义端点前面**」⇒ 凭据区四行 =
     *    智谱清言 → DeepSeek → **硅基流动** → 自定义端点。
     * ⚠️ #478 曾说硅基流动「只服务朗读」；**#480 用户改主意**（「也要参与到全部 AI 服务中」）⇒ 它已是一等
     *    chat 提供商，⛔ 别再退回「仅用于朗读」。
     */
    private renderTranslateFold(body: HTMLElement): void {
        // 🔴 #483（用户 2026-10-02：「重构当前 AI 集成 UI 页面，太丑了，参考市面上 AI 软件或中转站
        //    是怎么做接入多 AI 的」）—— 整页从「以**行**组织」改成「以**卡片**组织」，两组同时**改名 + 换序**：
        //      ① **模型服务**（原「API凭据」）：四张**服务商卡片**（Logo + 名称 + 状态徽标 + **就地「测试」** +
        //         展开配 Key / base）；⚠️ 卡片化当时只作用于本页（多挂一个 `.rl-prov-card` 类），
        //         数据源页那几处 `.rl-key-row`（书籍源 / 音乐源）观感不动。
        //         🔴 **#488 起卡片语汇全仓共用**：数据源页「元数据源凭据 / 音乐源凭据」两组也走
        //         `.rl-prov-list` + `.rl-prov-card`（用户 2026-10-02：「元数据源凭据界面也改成 AI 集成的样式」）
        //         ⇒ ⛔ 别再把 `.rl-prov-card` 当成「本页专属」而在样式里加页级前缀。
        //      ② **用途**（原「AI服务」）：翻译 / 总结 / 搜索 / 朗读四行收进**一张卡**（行间发丝线）。
        //    🔴 **为什么把「连服务商」提到前面**：接入多 AI 的心智顺序是「先连上 → 再选它用在哪」，
        //       这也是 Cherry Studio 的顺序（设置 → 模型服务里配 Provider，再回聊天页选模型）；
        //       中转站（New API / one-api）同理 —— 渠道在前、令牌在后。已核对，见 UI-GUIDE §11.7。
        //    ⚠️ 组名换了 ⇒ `pure/settingNav.SETTING_GROUP_ICONS` 的键同步换过（⛔ 旧键不留）。
        this.createGroupSection(body, '模型服务', (inner) => this.renderProviderCards(inner));
        this.createGroupSection(body, '用途', (inner) => this.renderAiServiceRows(inner));
    }

    /**
     * #483：**服务商卡片列表**（内置三家 + **两个自定义端点槽位**）。⛔ 别在这里另写一套行 —— 仍是
     * `renderTranslateKeyBlock` / `renderCustomEndpointRow`，只是各自多挂 `.rl-prov-card`。
     * 🔴 #634：自定义槽位由**一处循环**渲染（`CUSTOM_SLOTS`）—— 加/减槽位只改那个常量，
     *    ⛔ 别写两行 `renderCustomEndpointRow(list, 'custom')` / `(list, 'custom2')`（漏一行 = 少一个入口）。
     */
    private renderProviderCards(body: HTMLDivElement): void {
        const list = body.createDiv({ cls: 'rl-prov-list' });
        // 各家 Key 始终都显示，不跟随用途里选了谁；翻译 / 总结 / 搜索三处共用前两家
        this.renderTranslateKeyBlock(list, 'zhipu', '智谱清言', 'readerZhipuKey', '你的智谱 API Key');
        this.renderTranslateKeyBlock(list, 'deepseek', 'DeepSeek', 'readerDeepseekKey', 'sk-…');
        // #487（用户指令）：**删掉**这一行的说明文案「AI 翻译 / 总结 / 搜索与朗读云合成共用这一个 Key」
        //     —— 因此这里退回**四参**调用（`note` 是可选的；组件能力保留，别的地方还用）。
        this.renderTranslateKeyBlock(list, 'siliconflow', '硅基流动', 'readerSiliconflowKey', 'sk-…');
        // #478 + #634：自定义 OpenAI 兼容端点（**两个槽位**：base URL + Key + 显示名 + 测试连接）
        for (const slot of CUSTOM_SLOTS) this.renderCustomEndpointRow(list, slot);
    }

    /**
     * 「朗读音源」行（#344 建立；**#480 ④ 重做**为「音源 + 音色 + 试听」三件）。
     * 🔴 三个控件与其它服务行**同款观感**（同一行、同高、同圆角）—— 用户原话：「其他卡片都是
     *    [服务商]+[模型] 的组合，而朗读音源只有一个孤零零的下拉框，而且看起来是系统原生边框的旧样式」。
     * 🔴 **不新开存储**：音源 `rl-tts-engine` / 系统音色 `rl-tts-voice` / 云音色 `rl-tts-cloud-voice`
     *    —— 与阅读器朗读弹窗读写**同一份**（⛔ 别在这里造第二个真源；切音源也**不迁移**音色，
     *    两个 id 空间各自读自己的记忆，与「切音源装该音源自己的记忆音色」同口径）。
     * ⚠️ 改完对**已打开**的阅读器不立即生效（它读的是打开时的快照）—— 重开即可。
     */
    private renderTtsVoiceRow(body: HTMLDivElement): void {
        // #487：与上面三行**同款卡片**（用户要「各个服务之间空开间距」⇒ 四行各自成卡）
        const card = body.createDiv({ cls: 'rl-ai-svc-card' });
        const row = new Setting(card)
            .setName('朗读音源')
            // #477：「用哪种声音」偏口语 ⇒ 去掉疑问句式（口径见 renderAppearanceRows）
            .setDesc('朗读使用的声音');
        row.settingEl.addClass('rl-ai-svc'); // #480 ③：与其它 AI 服务行同款的行距

        const { kind, remembered } = this.currentTtsState();
        const voices = this.systemVoices();
        const curVoice = effectiveTtsVoice(kind, voices, remembered);
        const curLabel = ttsVoiceLabel(kind, voices, remembered);

        const dock = row.controlEl.createDiv({ cls: 'rl-ai-tts' });

        // ① 音源 = **控件区最左的一枚图标钮**（#495：从名称行尾**挪进控件区**，排在下拉框之前）
        //    🔴 用户 2026-10-03 第三条要求：「把切换开关移到下拉框之前，排列顺序 = 切换开关 + 下拉框，
        //    两者水平对齐、间距一致，整体作为一个整体保持右对齐」—— 两者现在同在 `.rl-ai-tts` 这个
        //    flex 容器里（`gap: 6px`），天然等高同间距；整组随控件区 `justify-content: flex-end` 贴右。
        //    🔴 **挪位置必须同步改 CSS 选择器**（已从 `.rl-ai-name-row …` 改成行级 `.rl-ai-svc …`）——
        //    否则两级前缀不命中，按钮退回宿主裸 `button` 的盒模型（实测宽 38px 而非 30px）。
        //    图标本身就是状态（喇叭 = 系统语音 / 硅基流动标 = 云端）⇒ 不用写文字；两个选项 ⇒ 点击切到另一个。
        const engineBtn = dock.createEl('button', { cls: 'rl-ai-engine-btn', attr: { type: 'button' } });
        const engineLabel = TTS_ENGINE_CHOICES.find((c) => c.value === kind)?.label ?? kind;
        renderAiIcon(engineBtn.createSpan({ cls: 'rl-ai-icon' }), kind === 'cloud' ? AI_PROVIDER_ICON.siliconflow : TTS_ICON);
        engineBtn.setAttribute('data-tip', `朗读音源：${engineLabel}（点击切换）`);
        engineBtn.addEventListener('click', () => {
            saveTtsEngine(kind === 'cloud' ? 'system' : 'cloud');
            this.display(); // 音色清单整批换 ⇒ 重建（与「服务商切换整页重渲染」同一口径）
        });

        // ② 音色（**唯一**的下拉；宽度 = `--rl-ai-ctl-w`，窄窗可缩不凸出）
        //    ⚠️ #482 的「窄 + 宽」两格、#493 的「两格等宽平分」都已退场 —— 同一根因（控件区塞不下两个下拉）。
        const groups = ttsVoiceGroups(kind, voices, curVoice);
        this.renderDropdown(dock, {
            cls: 'rl-ai-tts-voice',
            // ⚠️ 列表空（系统语音还没加载出来）时给占位，⛔ 不留空按钮
            text: curLabel || (kind === 'cloud' ? '默认音色' : '默认语音'),
            tip: curLabel || undefined,
            current: curVoice,
            items: groups.flatMap((g) => g.items.map((o) => ({ value: o.value, label: o.label, group: g.label }))),
            onPick: (v) => {
                if (kind === 'cloud') saveCloudVoice(v);
                else saveVoiceUri(v);
                this.display();
            },
        });

        // ③ 试听（语音类设置最要紧的体验：不点一下就不知道选的是谁）
        const play = dock.createEl('button', {
            cls: 'rl-ai-tts-play clickable-icon',
            attr: { type: 'button', 'data-tip': '试听' },
        });
        safeSetIcon(play, 'play');
        play.createSpan({ cls: 'rl-sr', text: '试听' });
        play.addEventListener('click', () => this.previewTtsVoice(kind, curVoice));

        // ⚠️ 系统语音列表是**异步**加载的（首次常为空）⇒ 变更后重绘一次（`once` 自摘，不会累积）
        if (kind === 'system' && ttsSupported() && !this.ttsVoicesHooked) {
            this.ttsVoicesHooked = true;
            window.speechSynthesis?.addEventListener('voiceschanged', () => this.display(), { once: true });
        }
    }

    /**
     * 「当前朗读音源 + 记忆音色」的**唯一读取点**（音源键 + 该音源自己桶里的音色）。
     *
     * 🔴 #491 抽出来：设置页那行（`renderTtsVoiceRow`）与「关于 › 一键复制环境信息」都要读这两个值。
     *    ⚠️ **#492 起另一半使用者已退场**（那枚按钮整体删除），本方法**保留** —— 它是「两个 id 空间各自
     *    读自己的记忆」这条规则（系统走 `loadVoiceUri`、云走 `loadCloudVoice`）的落点，⛔ 别把这段散回
     *    调用点（散回去就等于把「切音源不迁移音色」的口径再抄一份）。
     */
    private currentTtsState(): { kind: TtsEngineKind; remembered: string | null } {
        const kind = normalizeTtsEngineKind(loadTtsEngine());
        return { kind, remembered: kind === 'cloud' ? loadCloudVoice() : loadVoiceUri() };
    }

    /** 系统语音引擎（**懒建 + 复用**：它会往 `window.speechSynthesis` 挂 `voiceschanged` 监听，⛔ 别每次点都新建） */
    private systemSpeechEngine(): SpeechEngine {
        if (!this.ttsSystemEngine) this.ttsSystemEngine = new SystemSpeechEngine();
        return this.ttsSystemEngine;
    }

    /** 云合成引擎（试听用；与阅读器同一套 `CloudSpeechEngine`，凭据每次现取 ⇒ 刚填完的 Key 立即可用） */
    private cloudSpeechEngine(): SpeechEngine {
        if (!this.ttsCloudEngine) {
            this.ttsCloudEngine = new CloudSpeechEngine({
                http: async (req) => {
                    const res = await requestUrl({
                        url: req.url,
                        method: 'POST',
                        contentType: 'application/json',
                        headers: req.headers,
                        body: req.body,
                        responseType: 'arraybuffer',
                    } as unknown as Parameters<typeof requestUrl>[0]);
                    return { status: res.status, arrayBuffer: res.arrayBuffer, text: res.text };
                },
                key: () => this.settingValue('readerSiliconflowKey'),
                notice: (msg) => new Notice(msg, 5000),
            });
        }
        return this.ttsCloudEngine;
    }

    /** 当前系统的语音列表（引擎未建 / 宿主不支持 ⇒ 空数组，UI 会落回占位文案） */
    private systemVoices(): TtsVoiceLite[] {
        try {
            return this.systemSpeechEngine().voices();
        } catch {
            return [];
        }
    }

    /** 试听一句（系统引擎用 pitch；云引擎忽略 pitch —— 云侧本来就没有这个参数） */
    private previewTtsVoice(kind: TtsEngineKind, voiceId: string): void {
        const blocked = ttsEngineBlockedReason(kind, !!this.settingValue('readerSiliconflowKey'), ttsSupported());
        if (blocked) {
            new Notice(blocked, 7000);
            return;
        }
        const engine = kind === 'cloud' ? this.cloudSpeechEngine() : this.systemSpeechEngine();
        if (!engine.available()) {
            new Notice('该音源当前不可用', 5000);
            return;
        }
        engine.preview(VOICE_PREVIEW_TEXT, {
            rate: loadTtsRate() ?? TTS_RATE_DEFAULT,
            pitch: TTS_PITCH_DEFAULT,
            volume: loadTtsVolume() ?? TTS_VOLUME_DEFAULT,
            voice: voiceId || null,
        });
    }

    /**
     * 轻量自绘下拉（#480）：给「朗读音源」的**音源 / 音色**两格用。
     * 🔴 为什么不用原生 `<select>`：音色要按语言 / 性别**分组带标题**，`<option>` 做不到；
     *    而音源那格必须与旁边音色格**长得一模一样**（同一行的两个控件）。
     * 🔴 关闭时机 = 点外部 / Esc / 选中；关闭时**立刻摘掉** document 监听
     *    （设置页会整页重渲染，留着就是孤儿监听）。
     */
    private renderDropdown(
        host: HTMLElement,
        opts: {
            cls: string;
            text: string;
            items: { value: string; label: string; group?: string }[];
            current: string;
            icon?: AiIcon;
            /** 悬停提示（`data-tip` 自绘气泡）—— 文本被省略号截断时是唯一能看到全称的入口 */
            tip?: string;
            onPick: (v: string) => void;
        },
    ): void {
        const wrap = host.createDiv({ cls: `rl-ai-dd ${opts.cls}` });
        const btn = wrap.createEl('button', {
            cls: 'rl-ai-dd-btn',
            attr: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' },
        });
        if (opts.tip) btn.setAttribute('data-tip', opts.tip);
        if (opts.icon) renderAiIcon(btn.createSpan({ cls: 'rl-ai-icon' }), opts.icon);
        btn.createSpan({ cls: 'rl-ai-dd-text', text: opts.text });
        btn.createSpan({ cls: 'rl-ai-caret', text: '▾' });

        let panel: HTMLDivElement | null = null;
        const onDocDown = (ev: MouseEvent): void => {
            if (panel && !wrap.contains(ev.target as Node)) close();
        };
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') close();
        };
        const close = (): void => {
            if (!panel) return;
            panel.remove();
            panel = null;
            btn.setAttribute('aria-expanded', 'false');
            btn.removeClass('rl-open');
            document.removeEventListener('mousedown', onDocDown, true);
            document.removeEventListener('keydown', onKey, true);
        };
        btn.addEventListener('click', () => {
            if (panel) {
                close();
                return;
            }
            const list = wrap.createDiv({ cls: 'rl-ai-dd-panel', attr: { role: 'listbox' } });
            panel = list;
            let lastGroup = '';
            for (const it of opts.items) {
                if (it.group && it.group !== lastGroup) {
                    lastGroup = it.group;
                    list.createDiv({ cls: 'rl-ai-dd-group', text: it.group });
                }
                const item = list.createEl('button', {
                    cls: 'rl-ai-dd-item',
                    attr: { type: 'button', role: 'option', 'aria-selected': it.value === opts.current ? 'true' : 'false' },
                });
                item.createSpan({ cls: 'rl-ai-dd-item-text', text: it.label });
                if (it.value === opts.current) item.addClass('is-on');
                item.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    close();
                    if (it.value !== opts.current) opts.onPick(it.value);
                });
            }
            btn.setAttribute('aria-expanded', 'true');
            btn.addClass('rl-open');
            document.addEventListener('mousedown', onDocDown, true);
            document.addEventListener('keydown', onKey, true);
        });
    }

    /**
     * 「AI服务」组内容：翻译 / 总结 / 搜索三套「服务商 + 模型 + 提示词」+ 朗读音源（#356 移入）。
     * 🔴 #479 整页重排：提示词**并入各自的服务行**（默认收起）—— 原来三块 4 行 textarea 恒展开，
     *    把这一页撑到约 3 屏；收起后约 1 屏。⛔ 功能与字段一个没少（展开即是原来那块）。
     */
    private renderAiServiceRows(body: HTMLDivElement): void {
        // 🔴🔴 #487 用户裁定：「各个服务之间**空开间距**」⇒ 四行**各自成卡**（#483 的「一张 `rl-ai-card`
        //    + 行间发丝线」作废）。容器复用 `.rl-prov-list`（卡片列表：flex column + gap 8px），
        //    于是上下两组（模型服务 / 用途）的**卡间距与观感完全一致**。
        //    ⚠️ ⛔ 卡片不许 `overflow: hidden`：朗读音源那格的下拉面板是 `position: absolute`，
        //    会被裁掉（与 #354「设置页内容区 overflow-y:auto」同族坑，#480 已栽过一次）。
        const card = body.createDiv({ cls: 'rl-prov-list' });
        // 翻译服务（服务商 + 模型 + 提示词）
        this.renderAiServiceRow(card, {
            name: '翻译服务',
            desc: '阅读时划词即时翻译',
            getProvider: () => this.plugin.settings.readerTranslateProvider,
            setProvider: (v) => { this.plugin.settings.readerTranslateProvider = v; },
            getModel: () => this.plugin.settings.readerTranslateModel,
            setModel: (v) => { this.plugin.settings.readerTranslateModel = v; },
            prompt: {
                label: '翻译提示词',
                value: this.plugin.settings.readerTranslatePrompt,
                defaultText: DEFAULT_TRANSLATE_PROMPT,
                onSave: (v) => {
                    this.plugin.settings.readerTranslatePrompt = v;
                    void this.plugin.saveSettings();
                },
            },
        });

        // 总结服务（与翻译服务各自独立：条目 AI 生成一句话总结/核心看点用它跑）
        this.renderAiServiceRow(card, {
            name: '总结服务',
            // #477：「给条目一键生成总结」偏口语 ⇒ 改标准句式（口径见 renderAppearanceRows）
            desc: '为条目生成 AI 总结',
            getProvider: () => this.plugin.settings.readerSummaryProvider,
            setProvider: (v) => { this.plugin.settings.readerSummaryProvider = v; },
            getModel: () => this.plugin.settings.readerSummaryModel,
            setModel: (v) => { this.plugin.settings.readerSummaryModel = v; },
            prompt: {
                label: '总结提示词',
                value: this.plugin.settings.readerSummaryPrompt,
                defaultText: DEFAULT_SUMMARY_PROMPT,
                onSave: (v) => {
                    this.plugin.settings.readerSummaryPrompt = v;
                    void this.plugin.saveSettings();
                },
            },
        });

        // 搜索服务（同样独立：阅读器划词搜索卡内的 AI 答案用它跑；网络搜索那一半不走 AI、无需配置）
        this.renderAiServiceRow(card, {
            name: '搜索服务',
            desc: '阅读时划词联网搜索',
            getProvider: () => this.plugin.settings.readerSearchProvider,
            setProvider: (v) => { this.plugin.settings.readerSearchProvider = v; },
            getModel: () => this.plugin.settings.readerSearchModel,
            setModel: (v) => { this.plugin.settings.readerSearchModel = v; },
            prompt: {
                label: '搜索提示词',
                value: this.plugin.settings.readerSearchPrompt,
                defaultText: DEFAULT_SEARCH_PROMPT,
                onSave: (v) => {
                    this.plugin.settings.readerSearchPrompt = v;
                    void this.plugin.saveSettings();
                },
            },
        });

        // 预填服务（#499）：新增条目「手动填写」界面标题行 ✨ 用它跑 —— 与上面三项同构，
        // 独立提示词（改写预填措辞不影响总结/搜索）。⚠️ 它是**第五张卡**（#487 的「各自成卡」照旧）。
        this.renderAiServiceRow(card, {
            name: '预填服务',
            desc: '为条目自动填写字段',
            getProvider: () => this.plugin.settings.readerPrefillProvider,
            setProvider: (v) => { this.plugin.settings.readerPrefillProvider = v; },
            getModel: () => this.plugin.settings.readerPrefillModel,
            setModel: (v) => { this.plugin.settings.readerPrefillModel = v; },
            prompt: {
                label: '预填提示词',
                value: this.plugin.settings.readerPrefillPrompt,
                defaultText: DEFAULT_PREFILL_PROMPT,
                onSave: (v) => {
                    this.plugin.settings.readerPrefillPrompt = v;
                    void this.plugin.saveSettings();
                },
            },
        });

        // 🔴 #356（用户指令）：朗读音源从「语音合成」组搬到本组末尾 —— 它和上面三项同属
        //    「用谁来做这件事」的服务选择；位置放在**最后一项服务之后**（提示词已并入各自服务行）。
        this.renderTtsVoiceRow(card);
    }

    /**
     * 一行「AI 服务」= **服务商（自绘下拉，选项带品牌图标）+ 模型（可搜索弹窗）+ 提示词（可开合）**（#479 整页重排）。
     *
     * 🔴 三行（翻译 / 总结 / 搜索）**共用本方法** —— ⛔ 别给某一行开小灶（选项文案、显隐规则、提交口径必须一致）。
     * 🔴 **模型为什么必须能手填**：模型 ID 时效性极强 —— `pure/translate` 里有实测记录
     *    （2026-10-02：智谱免费档已从 `GLM-4-Flash` 扩到 `GLM-4.7-Flash`，而 `GLM-4.5-Flash` 官方标注「即将下线」）
     *    ⇒ 模型控件是「**可搜索 + 可获取 + 可手填**」，⛔ 别做成「只能从预置里选」（那样每加一个模型都要发一版）。
     * 🔴 三件控件的分工（#478 实测过「一行三控件不挤」，第四件必挤）：
     *    ① 服务商 = **自绘下拉**（原生 `<select>` 的 option 放不进 SVG）；
     *    ② 模型   = 一颗按钮 ⇒ **可搜索弹窗**（模型可能上百个，且「获取模型 / 手动输入」都在弹窗里）；
     *    ③ 提示词 = **名称行尾**的小按钮，开合下面那块（默认收起，页面从约 3 屏降到约 1 屏）。
     * ⚠️ 服务商切换会**整页重渲染**（`display()`）：模型候选随服务商变，重建比原地改 `<option>` 简单可靠。
     *    代价是切完丢焦点（可接受 —— 用户本来就在这一行操作）。模型字段**不清空**：切过去若模型名不适用，
     *    按钮会落到「非预置」观感（主题强调色），一点就能改。
     */
    private renderAiServiceRow(
        body: HTMLDivElement,
        opts: {
            name: string;
            desc: string;
            getProvider: () => unknown;
            setProvider: (v: AiProviderChoice) => void;
            getModel: () => string | undefined;
            setModel: (v: string | undefined) => void;
            /** 本服务的提示词块（#479 起默认收起，由名称行的小按钮开合） */
            prompt: { label: string; value?: string; defaultText: string; onSave: (v: string | undefined) => void };
        },
    ): void {
        // 🔴🔴 #487 用户裁定（附截图）：「各个服务之间**空开间距**」⇒ 四行**各自成卡**
        //    （与上面「模型服务」那四张卡同款），推翻 #483 的「四行收进一张 `rl-ai-card` + 发丝线」。
        //    做法：**先建本行的卡片容器**，`Setting` 与提示词块都往它里面挂 ——
        //    ⛔ 别再靠 `insertAdjacentElement('afterend')` 把块挪出去（那样块会落到卡外，
        //      变成「展开的输入框悬在两张卡之间」）。
        const card = body.createDiv({ cls: 'rl-ai-svc-card' });
        const row = new Setting(card).setName(opts.name).setDesc(opts.desc);
        // #480 ③：标题与副标题拉开 4px（类挂在行上，样式见 styles.css 的 `.rl-ai-svc`）
        row.settingEl.addClass('rl-ai-svc');

        // ① 提示词块建在**本卡内**（名称行那颗小按钮要开合它）——
        //    创建顺序 = 行 → 块 ⇒ DOM 顺序天然就是 #483 要的那一种，⛔ 不用再手动挪。
        const block = this.renderPromptField(card, opts.prompt);
        block.addClass('rl-ai-prompt-block');

        // ② 提示词入口 = **名称行尾的「提示词 ›」文字按钮**
        //    🔴 #481 用户指令**撤回** #480 的「笔形图标挪进控件区」：
        //       「提示词改成笔形图标挪到下拉框左边这条命令代码撤回改回原『提示词 ›』」。
        //       理由也站得住：图标按钮混进控件区后，与「选择模型」那颗按钮并列 ⇒ 分不清谁是主控件。
        //    ⛔ 仍挂**名称行**（不占控件区）：一行三件是本仓实测的上限（#478）。
        row.nameEl.addClass('rl-ai-name-row');
        const promptBtn = row.nameEl.createEl('button', { cls: 'rl-ai-prompt-btn', attr: { type: 'button' } });
        const paintPrompt = (): void => {
            const open = block.hasClass('rl-open');
            promptBtn.empty();
            promptBtn.createSpan({ text: '提示词' });
            promptBtn.createSpan({ cls: 'rl-ai-caret', text: '▸' });
            promptBtn.toggleClass('rl-open', open);
            // 已自定义 ⇒ 主题强调色（用户裁定：本页只走「主题色 + 已配置绿」两色）
            promptBtn.toggleClass('is-set', !!opts.prompt.value?.trim());
            promptBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        promptBtn.addEventListener('click', () => {
            block.toggleClass('rl-open', !block.hasClass('rl-open'));
            paintPrompt();
        });
        paintPrompt();

        // ③ 服务商 + 模型 = **一个** 拣选控件（#480 ② 方案 A：点开是「左服务商 / 右模型」的大面板）
        const choice = normalizeAiChoice(opts.getProvider());
        const model = this.shownModel(normalizeProvider(choice), opts.getModel());
        const pick = row.controlEl.createDiv({ cls: 'rl-ai-pick' });
        const btn = pick.createEl('button', {
            cls: 'rl-ai-pick-btn',
            attr: { type: 'button', 'aria-haspopup': 'dialog' },
        });
        renderAiIcon(btn.createSpan({ cls: 'rl-ai-icon' }), aiChoiceIcon(choice));
        // 🔴 #494（用户：「『智谱 GLM · GLM-4-Flash』改成**只显示 GLM-4-Flash**，图标保留」）：
        //    文本只留**模型名**，服务商由**左侧图标**承担（`aiChoiceIcon` 就是为这件事存在的，#479/#480）。
        //    ⚠️ 「不启用」没有模型可显示 ⇒ 仍退回服务商名（`aiPickText` 的原口径），⛔ 别显示成空白格。
        btn.createSpan({ cls: 'rl-ai-pick-text', text: model || aiPickText(choice, model, this.customSlotNames()) });
        btn.createSpan({ cls: 'rl-ai-caret', text: '▾' });
        // 🔴 #481 ②（用户：模型名过长会把格子撑满 / 各行宽度不一）：
        //    控件**固定宽度**（`--rl-ai-ctl-w`，样式层），文本超出走省略号 ⇒ 悬停提示必须给全称。
        //    🔴 #494：文本已经只剩模型名，所以气泡改给**完整串**「服务商 · 模型」—— 复用 `aiPickText`
        //    这**一个真源**（⛔ 别另拼一个格式），且只在有模型时挂（「不启用」时文本已是全称）。
        //    走 `data-tip` 自绘气泡（本仓 UI 规范：禁原生 `title` 黄条），由全局 tooltip 委托读取。
        if (model) btn.setAttribute('data-tip', aiPickText(choice, model, this.customSlotNames()));
        if (isAiOff(choice)) btn.addClass('is-off');
        // ⛔ #485 用户裁定**撤掉**「当前模型不在该家预置表里 ⇒ 整格文字走主题色」（旧 `is-custom`）：
        //    实测后果是同一列三行**颜色不一致**（用户：「一个蓝一个黑的不同」）——
        //    因为 `deepseek-chat` 在预置里（黑）、`deepseek-flash` 与硅基的模型不在（蓝），看着像两种控件。
        //    ⇒ 现在文字一律 `--text-normal`（与「朗读音源」那两格、与卡片行名一致）；
        //    「这不是本仓写死的候选」这个信息**留在弹窗的小字里**（`modelNote` 已写明来源），
        //    ⛔ 不再占用整个控件的颜色（那还会被误读成「选中态 / 链接」）。
        btn.addEventListener('click', () =>
            this.openAiPicker(opts.name, choice, opts.getProvider, opts.setProvider, opts.getModel, opts.setModel),
        );
    }

    /** 当前生效的模型名：存的值 → 该家默认（自定义槽位无默认 ⇒ 空串） */
    private shownModel(provider: TranslateProvider, picked: string | undefined): string {
        return (picked ?? '').trim() || DEFAULT_MODELS[provider];
    }

    /**
     * 🔴 #634：两个自定义槽位的**用户填名原文**（给下拉 / 弹窗 / 合并控件那一行字用）。
     * ⛔ 不要在调用点直接读 `settings.readerCustomName`：那会让「另一个槽位」永远拿不到自己的名字。
     */
    private customSlotNames(): { custom?: unknown; custom2?: unknown } {
        return {
            custom: this.plugin.settings.readerCustomName,
            custom2: this.plugin.settings.readerCustom2Name,
        };
    }

    /** 🔴 #634：显示名（自定义槽位用**用户改过的名**，内置三家与 off 走原真源） */
    private slotAwareLabel(v: AiProviderChoice): string {
        return aiChoiceLabelNamed(v, this.customSlotNames());
    }

    /** 该服务商**已拉到**的真实模型清单（空数组 = 没拉过） */
    private fetchedOf(provider: TranslateProvider): ModelFetched[] {
        return this.aiFetchedModels.get(provider) ?? [];
    }

    /**
     * 打开「服务商 + 模型」拣选弹窗（#480 ② 方案 A：左栏服务商 / 右栏模型）。
     * 🔴 弹窗只负责**选**；写盘与重渲染归这里（每个出口都要落库 + 重画，免得按钮文案与真源不同步）。
     * 🔴 拉到的清单按服务商缓存在 `this.aiFetchedModels`（**只活在本次设置页会话**，不落库 —— 见字段注释）。
     */
    private openAiPicker(
        serviceName: string,
        choice: AiProviderChoice,
        getProvider: () => unknown,
        setProvider: (v: AiProviderChoice) => void,
        getModel: () => string | undefined,
        setModel: (v: string | undefined) => void,
    ): void {
        new AiPickerModal(this.app, {
            title: serviceName,
            choice,
            candidatesOf: (p) => mergeModelCandidates(p, this.fetchedOf(p)) as AiModelItem[],
            fetchedOf: (p) => this.fetchedOf(p).length > 0,
            // ⚠️ 按服务商取当前模型：切到别家时 ✓ 要在那家的默认模型上，⛔ 别拿上一家的模型名去比
            modelOf: (p) => (normalizeProvider(p) === normalizeProvider(normalizeAiChoice(getProvider())) ? this.shownModel(p, getModel()) : this.shownModel(p, undefined)),
            // 🔴 #484：没填 Key 就**不自动拉**（必然 401，白等一次还弹出个没意义的红字）
            hasKeyOf: (p) => !!this.settingValue(aiKeyField(p)),
            /** 置顶清单的唯一真源 = 设置字段（⛔ 别在弹窗里另存一份） */
            pinnedOf: () => this.plugin.settings.readerPinnedModels ?? [],
            onTogglePin: (model) => {
                const cur = this.plugin.settings.readerPinnedModels ?? [];
                this.plugin.settings.readerPinnedModels = togglePin(cur, model);
                void this.plugin.saveSettings();
            },
            // 2026-10-23 用户：「插件内置候选列出来给我决定删除哪个」⇒ 删（隐藏）内置候选
            hiddenOf: () => this.plugin.settings.readerHiddenModels ?? [],
            onToggleHide: (_p, model) => {
                const cur = this.plugin.settings.readerHiddenModels ?? [];
                this.plugin.settings.readerHiddenModels = toggleHidden(cur, _p, model);
                void this.plugin.saveSettings();
            },
            onClearHidden: (_p) => {
                const cur = this.plugin.settings.readerHiddenModels ?? [];
                this.plugin.settings.readerHiddenModels = clearHiddenFor(cur, _p);
                void this.plugin.saveSettings();
            },
            // 🔴 #634：两个自定义槽位显示**用户改过的名**（chips / 获取按钮 / 加载文案三处共用这一份）
            customNamesOf: () => this.customSlotNames(),
            // 🔴 #484 ②：**就地**拉（弹窗自己转圈 / 报错）。⛔ 不再「关弹窗 → 请求 → 成功才重开」
            onFetch: (p) => this.fetchAiModels(p),
            onPick: (r: AiPickerPick) => {
                if (r.action === 'manual') {
                    new AiModelNameModal(this.app, {
                        title: `${serviceName} · ${this.slotAwareLabel(r.provider)} 模型`,
                        placeholder: isCustomSlot(r.provider) ? '填该端点支持的模型名' : '填模型名',
                        value: this.shownModel(r.provider, getModel()),
                        onPick: (v) => {
                            setModel(v || undefined);
                            void this.plugin.saveSettings();
                            this.display();
                        },
                    }).open();
                    return;
                }
                // 提交：服务商**变了才算变**；模型只在给了值时才写（「不启用」不给模型）
                if (normalizeAiChoice(r.choice) !== normalizeAiChoice(getProvider())) {
                    setProvider(normalizeAiChoice(r.choice));
                }
                if (r.model) setModel(r.model);
                void this.plugin.saveSettings();
                this.display();
            },
        }).open();
    }

    /**
     * 真去拉一次模型列表（宿主 `listAiModels`）—— **#484：只返回结果，不再管弹窗**。
     * ⛔ 旧实现是「关弹窗 → 请求 → 成功才重开」：失败时弹窗彻底不回来，只剩一行 Notice
     *    （硅基流动实测 402、DeepSeek 空 Key 401 ⇒ 用户点下去**什么都没发生**，正是用户报的那个问题）。
     * 🔴 拉到的清单按服务商缓存在 `this.aiFetchedModels`（**只活在本次设置页会话**，不落库 —— 见字段注释）。
     */
    private async fetchAiModels(
        provider: Exclude<AiProviderChoice, 'off'>,
    ): Promise<{ ok: boolean; models?: ModelFetched[]; message?: string }> {
        const res = await this.plugin.listAiModels(provider);
        if (!res.ok) return { ok: false, message: res.message ?? '获取模型列表失败' };
        this.aiFetchedModels.set(provider, res.models);
        return { ok: true, models: res.models };
    }

    /**
     * 提示词编辑块（翻译 / 总结 / 搜索各一块）。**#479 起默认收起**（由各自服务行名称行的小按钮开合）：
     *  - 默认提示词（DEFAULT_*_PROMPT）只作 **placeholder 灰字**呈现——不可编辑、点不掉，纯粹让人知道默认长什么样；
     *  - 用户点进框里就是**空框**，写入自己的提示词即覆盖默认；清空（或粘贴回与默认完全一致）→ 存 undefined 恢复默认。
     *  - 改动在失焦（change）时保存，不逐键写盘。
     * 返回该块元素（调用方拿它开合）。🔴 收起只靠 `.rl-open` 类 + CSS —— ⛔ 别用内联 `display:none`
     *    （产物断言与仿真页都要能读到这块结构）。
     */
    private renderPromptField(
        body: HTMLDivElement,
        opts: { label: string; value?: string; defaultText: string; onSave: (v: string | undefined) => void },
    ): HTMLDivElement {
        const wrap = body.createDiv({ cls: 'rl-prompt-row' });
        wrap.createDiv({ cls: 'rl-prompt-label', text: opts.label });
        const ta = wrap.createEl('textarea', {
            cls: 'rl-prompt-input',
            attr: { rows: '4', spellcheck: 'false', placeholder: opts.defaultText },
        });
        ta.value = opts.value?.trim() ?? ''; // 未自定义 → 空框（默认文案在 placeholder 里）
        ta.addEventListener('change', () => {
            const raw = ta.value;
            const trimmed = raw.trim();
            opts.onSave(!trimmed || trimmed === opts.defaultText.trim() ? undefined : raw);
        });
        return wrap;
    }

    /**
     * 渲染单个服务商 Key 行（AI 翻译 / 总结 / 搜索内，翻译与总结共用）：可折叠（同 ① 元数据源配置 createApiKeyRow 观感）——
     * 头 = 服务商名 + 已配置徽标 + ▸，点击展开 body（Key 密文输入 + 测试连接 + 结果）。
     */
    /**
     * 渲染单个服务商 Key 行（翻译 / 总结 / 搜索 / **云合成**共用）：可折叠（同 ① 元数据源配置 createApiKeyRow 观感）——
     * 头 = 服务商名 + 已配置徽标 + ▸，点击展开 body（Key 密文输入 + 测试连接 + 结果）。
     * ⚠️ 云合成（`siliconflow`）的「测试连接」走**另一条路**：真合成一句并检查有没有拿到音频二进制 ——
     *    对朗读来说「Key 有效」不等于「能出声」，只查凭证的测试在这个场景里没有意义。
     */
    private renderTranslateKeyBlock(
        body: HTMLDivElement,
        provider: 'zhipu' | 'deepseek' | 'siliconflow',
        label: string,
        keyField: 'readerZhipuKey' | 'readerDeepseekKey' | 'readerSiliconflowKey',
        placeholder: string,
        /** #478 可选的一句话说明（展开后显示在输入框上方）；硅基流动用它点明「只服务朗读」 */
        note?: string,
    ): void {
        const row = body.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        // #479：行头最前面是服务商品牌标（LobeHub）；硅基流动用它自己的标（不在 chat 表里）
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), AI_PROVIDER_ICON[provider]);
        head.createSpan({ cls: 'rl-key-name', text: label });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            const has = !!this.settingValue(keyField);
            // 🔴 #634：第三态「连接失败」（手动「测试连接」测不通）—— 与元数据源 / 音乐源那两套同款，
            //    判据走同一条 `isExpired`（`undefined` = 还没测过 ⇒ **不标**，⛔ 别把「还没跑」画成失败）。
            const failed = has && isExpired(this.plugin.credentialStatusOf(aiCheckKey(provider)));
            badge.setText(failed ? EXPIRED_BADGE : (has ? '已配置' : '未配置'));
            badge.toggleClass('rl-key-badge-on', has && !failed);
            badge.toggleClass('rl-key-badge-bad', failed);
        };
        refreshBadge();

        const bodyEl = row.createDiv({ cls: 'rl-key-body' });
        if (note) bodyEl.createDiv({ cls: 'rl-hint-note', text: note });
        // Key 密文输入
        this.createSecretField(bodyEl, {
            placeholder,
            value: this.settingValue(keyField),
            onInput: (v) => {
                (this.plugin.settings as unknown as Record<string, unknown>)[keyField] = v;
                void this.plugin.saveSettings();
                // #634：值一改 ⇒ 旧的「连接失败」结论立刻作废（⛔ 别让红标挂在一个刚填的新值上）
                this.plugin.clearCredentialStatus(aiCheckKey(provider));
                refreshBadge();
            },
        });

        // 测试（#485 用户裁定：**放回折叠体内**，像书籍源 / 音乐源 Cookie 那样展开才见）
        this.attachProviderTest(
            bodyEl,
            () => (provider === 'siliconflow' ? this.plugin.testSpeechConnection() : this.plugin.testTranslateConnection(provider)),
            aiCheckKey(provider),
            refreshBadge,
        );
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        // 头点击展开/收起（必须绑 click 加 .rl-key-open，否则 .rl-key-body 恒 display:none 打不开）
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 「模型服务」组的**自定义端点**卡片行（#478 / #483 卡片化）：显示名 + base URL + Key + 测试连接。
     *
     * 🔴 与上面三家**同款折叠行**（`rl-key-row` 那套），但体里是**三个输入** —— 所以没复用
     *    `renderTranslateKeyBlock`（它只服务「单 Key」：云合成那把 Key 没有 baseURL 概念）。
     * ⚠️ baseURL 走**明文**输入（它不是密钥，且用户要核对有没有少写 `…/v1`）；Key 仍走密文字段。
     * ⚠️ 提交口径 = **失焦 / 回车**（与目录项同款）；归一在 `pure/translate.normalizeAiBaseUrl`（⛔ 别另写一份）。
     *
     * 🔴🔴 **#634：本方法由「写死槽位 1」改为「槽位参数化」**（用户：「再加个自定义端点 2 项，并支持重命名」，
     *    裁定**总共两个槽位**）。四个字段名一律经 `CUSTOM_SLOT_FIELDS[slot]` 取 ——
     *    ⛔ 别在任何一处写死 `readerCustomBaseUrl` / `readerCustomKey`：那会让槽位 2
     *    **静默读写槽位 1 的凭据**（填了槽位 2 却打槽位 1 的端点，且界面上两个框还会显示同一个值）。
     * @param slot `'custom'`（槽位 1，沿用 #478 既有字段 ⇒ **零迁移**）或 `'custom2'`（槽位 2，新增）
     */
    private renderCustomEndpointRow(parent: HTMLDivElement, slot: CustomSlot): void {
        const f = CUSTOM_SLOT_FIELDS[slot];
        const get = (field: string): string => {
            const v = (this.plugin.settings as unknown as Record<string, unknown>)[field];
            return typeof v === 'string' ? v : '';
        };
        const set = (field: string, v: string | undefined): void => {
            (this.plugin.settings as unknown as Record<string, unknown>)[field] = v;
        };
        const row = parent.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        // #479：自定义端点没有品牌标（LobeHub 无 `custom`）⇒ 内置 `plug`；⛔ 不拿 OpenAI 标顶替
        // #634：槽位 2 用**同一个** `plug` —— 两者是同一种东西的两条通道，不同标会让人以为功能不同
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), AI_PROVIDER_ICON[slot]);
        // 🔴 行头显示**用户改过的名**（重命名的可见落点之一）；⛔ 别写死「自定义端点」
        const nameEl = head.createSpan({ cls: 'rl-key-name', text: customSlotName(slot, get(f.name)) });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            const has = !!get(f.base) && !!get(f.key);
            // 🔴 #634：第三态「连接失败」（与前三家 AI 行 / 元数据源同款口径）；键按**槽位**分开
            const failed = has && isExpired(this.plugin.credentialStatusOf(aiCheckKey(slot)));
            badge.setText(failed ? EXPIRED_BADGE : (has ? '已配置' : '未配置'));
            badge.toggleClass('rl-key-badge-on', has && !failed);
            badge.toggleClass('rl-key-badge-bad', failed);
        };
        refreshBadge();

        const bodyEl = row.createDiv({ cls: 'rl-key-body' });
        // #487（用户指令）：**删掉**这行说明（「任意 OpenAI 兼容服务（通义千问 / Kimi / OpenRouter / 本地 Ollama…）
        //     —— 填 base 或整条 /chat/completions 都能识别」）。⛔ 别再加回：那段话解释的是**归一化能力**，
        //     而它由 `pure/translate.normalizeAiBaseUrl` 保证，用户填错时占位符与测试连接已经能说清。
        //
        // ⓪ 🔴 #634 新增：**显示名（重命名）** —— 明文输入，失焦/回车提交；留空 ⇒ 恢复默认名
        const nameInput = bodyEl.createEl('input', {
            cls: 'rl-input rl-ai-endpoint-name',
            attr: { type: 'text', spellcheck: 'false', placeholder: CUSTOM_SLOT_DEFAULT_NAME[slot] },
        });
        nameInput.value = get(f.name);
        const commitName = (): void => {
            const next = normalizeCustomName(nameInput.value);
            set(f.name, next);
            // ⚠️ 回显归一后的值（超长被截断时用户要看得见），并把行头名字同步过去
            nameInput.value = next ?? '';
            nameEl.setText(customSlotName(slot, next));
            void this.plugin.saveSettings();
            // 🔴 重命名影响**三处服务下拉**的选项文案 ⇒ 要整页重渲染才看得到。
            //    不这么做的话：改了名但下拉里还是旧名，用户会以为没生效（本仓「填了没反应」类报障的典型形态）。
            this.display();
        };
        nameInput.addEventListener('blur', commitName);
        nameInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            commitName();
        });

        // ① base URL（明文）
        const baseInput = bodyEl.createEl('input', {
            cls: 'rl-input',
            attr: { type: 'text', spellcheck: 'false', placeholder: 'https://api.example.com/v1' },
        });
        baseInput.value = get(f.base);
        const baseHint = bodyEl.createDiv({ cls: 'rl-hint-note' });
        const commitBase = (): void => {
            const raw = baseInput.value.trim();
            if (!raw) {
                set(f.base, undefined);
                baseHint.setText('');
                baseHint.toggleClass('is-error', false);
                void this.plugin.saveSettings();
                refreshBadge();
                return;
            }
            const issue = aiBaseUrlIssue(raw);
            if (issue) {
                baseHint.setText(`${issue}（未生效，当前仍是「${get(f.base) || '未配置'}」）`);
                baseHint.toggleClass('is-error', true);
                return;
            }
            const next = normalizeAiBaseUrl(raw);
            baseInput.value = next; // 回显归一化后的值（补上的 https:// / 去掉的尾斜杠都能看见）
            set(f.base, next);
            baseHint.setText('');
            baseHint.toggleClass('is-error', false);
            void this.plugin.saveSettings();
            refreshBadge();
        };
        // 打字期间只做即时校验提示，⛔ 不落库（提交时机见下）
        baseInput.addEventListener('input', () => {
            const issue = aiBaseUrlIssue(baseInput.value);
            baseHint.setText(issue ?? '');
            baseHint.toggleClass('is-error', !!issue);
        });
        baseInput.addEventListener('blur', commitBase);
        baseInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            commitBase();
        });

        // ② Key（密文，与其它凭据同款）
        this.createSecretField(bodyEl, {
            placeholder: `${customSlotName(slot, get(f.name))}的 API Key`,
            value: get(f.key),
            onInput: (v) => {
                set(f.key, v || undefined);
                void this.plugin.saveSettings();
                // #634：值一改 ⇒ 旧的「连接失败」结论作废（与前三家 AI 行同款）；键按**槽位**分开
                this.plugin.clearCredentialStatus(aiCheckKey(slot));
                refreshBadge();
            },
        });

        // ③ 测试（#485：**放回折叠体内**，与 cookie 同款）
        //    🔴 #486：**不再传「翻译服务」的模型** —— 那是另一家的模型名，拿它测这条端点必然
        //       「No available channel for model …」（实测 91hub：503）。现在由 `testTranslateConnection`
        //       自己去问这条端点「你有什么」，再挑一个像文本对话的来 ping。
        this.attachProviderTest(
            bodyEl,
            () => this.plugin.testTranslateConnection(slot),
            aiCheckKey(slot),
            refreshBadge,
        );
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 服务商卡片**折叠体内**的「测试连接」（就地体检）。
     *
     * 🔴 **抽成一个方法**：四个 Key 行共用（智谱 / DeepSeek / 硅基流动 / 自定义端点）—— ⛔ 别各写一份
     * （本仓在「同一件事写两遍」上栽过多次；#483 之前这段逻辑就是复制了两份）。
     * 🔴🔴 **位置由用户裁定（#485）**：「把测试按钮放在折叠项下**像其他 cookie 测试那样**」——
     *    原来（#483）它挂在**行头**常驻，与「书籍源 / 音乐源 Cookie」那套不一致（那边是展开后才看得见）。
     *    ⇒ 现在：`rl-key-actions` 一行 = 结果文字 + 蓝色「测试连接」（`mod-cta`），**与 cookie 那处逐字同款**。
     * ⚠️ 因为按钮已在体内，**不需要**再 `stopPropagation`（行头的开合点击收不到体内的事件），
     *    也**不需要**再替用户展开卡片 —— 能点到它就说明已经展开了。
     */
    private attachProviderTest(
        bodyEl: HTMLDivElement,
        run: () => Promise<{ ok: boolean; message: string; elapsedMs: number }>,
        /**
         * 🔴 #634：结论要落到**哪条**凭据键（`pure/credentialCheck.aiCheckKey(id)`）。
         * 传进来的意义 = 测不通时把行头徽标改成「连接失败」，**与元数据源 / 音乐源那两套逐字同款**
         * （用户原话：「把『连接失败』标签同步到其他如 AI 服务那里」）。
         * ⚠️ 四个 Key 行（智谱 / DeepSeek / 硅基流动 / 自定义端点）**各自的 id 不同** ——
         *    漏传就是「测了但不标」，用户点完测试仍看到「已配置」（本次要修的那类不一致）。
         */
        checkKey: string,
        /** 测完后刷新行头徽标（由调用方提供，因为它还依赖该行的「已配置」判据） */
        refreshBadge: () => void,
    ): void {
        // 与 cookie 那处同款：同一行里「结果文字 + 测试连接」
        // 用户裁定：结果文字在按钮**左边**、点测试时按钮**不许跳**（见 styles.css `.rl-key-actions` 注释）。
        const actions = bodyEl.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' }); // 行首：文字向左长，按钮贴右不动
        const btn = actions.createEl('button', { cls: 'mod-cta', text: '测试连接' });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            // ⛔ 不改文案（理由同音乐源那处）：文字变短会让按钮宽度变窄 ⇒ 横向跳动
            btn.addClass('rl-btn-loading'); // 1.0.4：内联 spinner（文字由 .rl-btn-loading 置透明）
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const res = await run();
            btn.disabled = false;
            btn.removeClass('rl-btn-loading');
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            // 反馈配色（用户 2026-09-14 裁定）：失败才红，成功一律绿 —— 不再区分「偏慢」档
            resultEl.toggleClass('rl-key-result-ok', res.ok);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
            // 🔴 #634：结论同时记进行头徽标（测不通 ⇒「连接失败」）—— 与元数据源/音乐源同一张结果表
            this.plugin.setCredentialStatus(checkKey, res.ok);
            refreshBadge();
        });
    }

    /** settings[keyField] 安全读（凭据字符串；未知键回退 ''） */
    private settingValue(key: string): string {
        const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : '';
    }

    /** 测试连接分派：⛔ **只有一份** —— 已移到宿主 `main.checkSourceCredential`（开机自检也要用同一份，
     *  在设置页留一份必然与它分叉：加一个源时只改一处 ⇒ 另一处永远「该源无可用测试」）。 */
    private testConnectionFor(id: ProviderId): Promise<SourceTestResult> {
        return this.plugin.checkSourceCredential(id);
    }

    /** 密文输入占位符（按源给出引导语境） */    private credentialPlaceholder(meta: ProviderMeta): string {
        if (meta.id === 'douban') return 'Douban Cookie（登录态）';
        if (meta.id === 'bangumi') return '输入 Bangumi Access Token';
        if (meta.id === 'googleBooks') return 'API Key（可选，提配额）';
        if (meta.id === 'igdb') return 'IGDB Client ID';
        // 🔴 #580：微信读书的凭据是 **Cookie** 不是 Key —— 占位符要说清「从哪儿抄、抄什么」，
        //    以及「只在同步书架时用得上」（否则用户会以为不填就不能搜）。
        if (meta.id === 'weread') return '微信读书 Cookie（书架同步用）';
        // 🔴 #639 ⑥：Steam 的 Key **只服务同步**（搜索/详情免 Key）—— 占位符要说清这一点
        if (meta.id === 'steam') return 'Steam Web API Key（同步库用）';
        return `输入 ${meta.label} API Key`;
    }

    /**
     * 🔴 #662：豆瓣凭据行里的**同步导入按钮**（用户：「豆瓣凭据入口再添加个同步导入按钮」）。
     *
     * 与 `renderWereadSyncButton` / `renderSteamActions` **同款**（都走 `.mod-cta.rl-sync-btn`）：
     * 三个同步源的动作行长得一样，用户不用重新认。
     * ⚠️ 按钮只负责**开弹窗**（选类型 + 状态 → 读取 → 勾选导入），
     *    抓取与落库都在宿主（`openDoubanCollectionSync` → `fetchDoubanCollection` / `importDoubanCollection`）。
     *    ⛔ 别在这里直接发请求：设置页是同步渲染路径，发请求会让整页卡住。
     */
    private renderDoubanSyncButton(actions: HTMLElement): void {
        // 🔴 2026-10-20 用户裁定：五个同步源（豆瓣 / 微信读书 / TMDB / Bangumi / Steam）的按钮文案
        //    **统一为「立即同步」**（原文案「同步豆瓣收藏」）—— 动作行本来就带源名在行头，按钮上再写一遍源名是冗余。
        //    ⚠️ 改文案必须五处一起改（本方法 + Bangumi / TMDB / 微信读书 / Steam 四颗），
        //        Steam 的「同步中…」是**进行中**态，不属于这套命名。
        const btn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
        btn.addEventListener('click', () => this.plugin.openDoubanCollectionSync());
    }

    /**
     * 🔴 #665：Bangumi 凭据行里的**同步按钮**（用户：「Bangumi 元数据源凭据行加个同步按钮并排」）。
     * 与豆瓣 / 微信读书 / Steam **同款**（`.mod-cta.rl-sync-btn`）—— 五个同步源动作行同构。
     * 只负责**开弹窗**（读三态收藏 → 勾选 → 导入）；抓取与落库都在宿主（`openBangumiSync`）。
     */
    private renderBangumiSyncButton(actions: HTMLElement): void {
        // 文案统一「立即同步」（2026-10-20 用户裁定，原文案「同步 Bangumi 收藏」）
        const btn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
        btn.addEventListener('click', () => this.plugin.openBangumiSync());
    }

    /**
     * 🔴 #665：TMDB 凭据行里的**同步按钮**（用户：「也做 TMDB 的同步接入（同先参考金标准）」）。
     * 与其它四个同步源**同款**。⏱ 双凭据（API Key + Session ID）在**发请求之前**就拦（#664 口径：
     * 缺哪个给按钮旁就地轻提示，⛔ 不发请求、不重建页面）。
     */
    private renderTmdbSyncButton(actions: HTMLElement): void {
        // 文案统一「立即同步」（2026-10-20 用户裁定，原文案「同步 TMDB 清单」）
        const btn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
        btn.addEventListener('click', () => {
            const apiKey = (this.plugin.settings.tmdbApiKey ?? '').trim();
            const sessionId = (this.plugin.settings.tmdbSessionId ?? '').trim();
            if (!apiKey) {
                this.flashInlineHint(actions, '未配置 TMDB API Key —— 先在上面填入 API Key');
                return;
            }
            if (!sessionId) {
                this.flashInlineHint(actions, '未配置 TMDB Session ID —— 到 themoviedb.org「设置 → API」生成后填入');
                return;
            }
            this.plugin.openTmdbSync();
        });
    }

    /**
     * 🔴 #639 ⑥：微信读书凭据行里的**同步按钮**（用户：「将微信读书同步入库的项放在微信读书凭据下拉处，
     * 两个同步按钮样式都改成**白字主题色底**」）。
     *
     * ⚠️ 与 `renderSteamExtra` 里的「同步 Steam」**同款**（都走 `.rl-sync-btn`）——
     *    用户点名要两个按钮样式一致。样式真源 = styles.css 的 `.rl-sync-btn`（⛔ 不在这里写内联色）。
     * 🔴 #640e：**按钮追加进调用方给的那条动作行**（`actions`），与「测试连接」并排 ——
     *    ⛔ 别再自己 `createDiv({ cls: 'rl-key-actions' })`（那会另起一行，回到用户报的竖排三行）。
     */
    private renderWereadSyncButton(actions: HTMLElement): void {
        // 文案统一「立即同步」（2026-10-20 用户裁定，原文案「从微信读书同步书架」）
        const btn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
        btn.addEventListener('click', () => this.plugin.openWereadShelfSync());
    }

    /**
     * 🔴 #639 ⑥：Steam 凭据行里的**专属件**（SteamID 输入）。
     *
     * 用户要求逐条对应：
     *   · 「包括 Steam API Key、SteamID」⇒ 上面那个密文字段是 Key，这里补 **SteamID**（明文，它不是密钥）。
     *
     * 🔴 #640f（1.4.0，用户点名）本方法**瘦身两处**：
     *   ⑴ 「Steam 个人资料与愿望单要公开可见」那条提示 → 移出本方法（#641 起最终落在
     *      `pure/sourceRegistry` 的 steam.hint 末尾）；
     *   ⑵ 「同步 Steam」按钮 → 搬到 `renderSteamActions`，由调用点排在 **SteamID 输入之下**
     *      （用户：「这两个同步与测试连接按钮应该在 **steamid 下**」）。
     *   ⇒ 本方法现在**只剩 SteamID 输入与它的就地校验**。
     *
     * ⚠️ SteamID **明文**输入（它不是密钥，且用户要能核对自己有没有抄错位数）；
     *    提交口径 = **失焦 / 回车**（与目录项同款，⛔ 不用 `input` —— 打字中途会连续写盘 + 连续校验）。
     */
    private renderSteamExtra(body: HTMLElement): void {
        // 🔴🔴 #654（用户：「steam 下的两个值框对齐 IGDB 凭据样式」）：
        //    结构 = 与 Key 那行**同一个** `.rl-secret`（输入框 flex:1 + 右侧「显示」），
        //    ⛔ 不再是裸 `<input class="rl-input rl-steam-id">` —— 那个只给了 max-width: 320px，
        //    于是 Steam 的第一个框跟 IGDB 一样宽、第二个框短一截，两个框自己都不齐。
        const idRow = body.createDiv({ cls: 'rl-secret' });
        const input = this.fillSecretRow(idRow, {
            placeholder: '64 位 SteamID（形如 76561198…）',
            value: this.settingValue('steamId'),
            masked: false,
            // 校验在「失焦 / 回车」时才落盘（见下面的 commit），这里只做**即时预告**
            onInput: () => undefined,
        });
        input.addClass('rl-steam-id');
        const hint = body.createDiv({ cls: 'rl-hint-note' });
        const commit = (): void => {
            const raw = input.value.trim();
            if (!raw) {
                this.plugin.settings.steamId = undefined;
                hint.setText('');
                hint.toggleClass('is-error', false);
                void this.plugin.saveSettings();
                return;
            }
            const issue = steamIdIssue(raw);
            if (issue) {
                // ⛔ 不落盘：非法值写进去只会在同步时炸，且界面上还显示「已配置」
                hint.setText(`${issue}（未生效，当前仍是「${this.settingValue('steamId') || '未配置'}」）`);
                hint.toggleClass('is-error', true);
                return;
            }
            this.plugin.settings.steamId = raw;
            hint.setText('');
            hint.toggleClass('is-error', false);
            void this.plugin.saveSettings();
        };
        input.addEventListener('input', () => {
            const issue = steamIdIssue(input.value);
            hint.setText(issue ?? '');
            hint.toggleClass('is-error', !!issue);
        });
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            commit();
        });

        // 🔴 #641：公开可见提示**不在本折叠体里单独占一行**（`.rl-steam-privacy` 已删）——
        //    它现在是 `pure/sourceRegistry` 的 steam.hint **末尾那句**（与「获取 / 特色 / 用途」同一段灰字）。
        //    ⛔ 别在这里再加一份：同一条前置条件说两遍，用户会以为其中一处是补充说明。
    }

    /**
     * 🔴🔴 #640f（1.4.0，用户点名）：「这两个同步与测试连接按钮应该在 **steamid 下**」。
     *
     * ⇒ Steam 那一行的动作按钮**不在 `body` 的通用动作行里**，而是**紧跟 SteamID 输入之后**。
     * 编排（`createApiKeyRow` 里）：
     *   Key 密文 → （Steam 时）SteamID 输入 → **动作行（同步 Steam · 测试连接）**
     * ⚠️ 通用动作行由调用点建在正确位置（见 `createApiKeyRow` 里的 `steamActions`）——
     *    ⛔ 本方法不自己建行、也不重排 DOM（那会与调用点的顺序打架）。
     */
    private renderSteamActions(actions: HTMLElement, getResult: () => HTMLElement | null, sourceId: string): void {
        // 🔴 #655（用户：「steam 同步和测试按钮应该调换位置」）：本方法**只负责「同步 Steam」这一颗**，
        //    它必须是这一行的**第一颗**；「测试连接」由调用点在本方法之后紧接着建。
        //    ⛔ 别再在这里做任何 DOM 排序（上一版用 `resultEl.before()` 插槽 ⇒ 测试连接跑到了最前）。
        // ⚠️ 回执槽由调用点建（在两颗按钮之后），同步结论与测试结论共用那一个 ⇒ 本方法收 `resultEl`。
        // 文案统一「立即同步」（2026-10-20 用户裁定，原文案「同步 Steam」）；进行中另用「同步中…」。
        const btn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
        btn.addEventListener('click', async () => {
            // 🔴🔴 #664（用户：「未配置 steam 点击同步怎么不是轻提示误而是直接收起了」）：
            //    真因 = 下面的 `this.display()` —— 同步完**整行重建**，而重建后是**收起态**
            //    + 回执槽是新的空 span ⇒ 用户看到的是「点了以后那一行自己合上了」，
            //    回执（"缺 Key / 缺 SteamID"）连一眼的工夫都没有。
            //    ⇒ 三条一起改：
            //      ⑴ **未配置就别开始**：先拦一次，只给一条**就地轻提示**（⛔ 不写进回执槽、⛔ 不重建行）；
            //      ⑵ 只有**真的同步过**才刷新徽标（`display()` 的用途就是刷徽标，没同步就没必要重建）；
            //      ⑶ 即使要重建，也必须保住「展开态 + 回执」，否则同样是"自己合上了"。
            btn.disabled = true;
            btn.setText('同步中…');
            btn.addClass('rl-btn-loading');
            getResult()?.setText('');
            getResult()?.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const issue = this.plugin.steamCredsIssue();
            if (issue) {
                btn.disabled = false;
                btn.setText('立即同步');
                btn.removeClass('rl-btn-loading');
                // 轻提示：贴在按钮旁边，1.5s 淡出（与「恢复默认」那枚同款，⛔ 不弹 Notice）
                this.flashInlineHint(actions, issue);
                return;
            }
            const r = await this.plugin.syncSteamNow();
            btn.disabled = false;
            btn.setText('立即同步');
            btn.removeClass('rl-btn-loading');
            getResult()?.setText(`${r.ok ? '✓ ' : '✗ '}${r.message}`);
            getResult()?.toggleClass('rl-key-result-ok', r.ok);
            getResult()?.toggleClass('rl-key-result-bad', !r.ok);
            // 同步结论记进同一张结果表（徽标据此刷新，与「测试连接」同款）
            this.plugin.setCredentialStatus(sourceCheckKey('steam'), r.ok);
            // 🔴 刷新徽标但**保住展开态与回执**（见本回调开头的注释⑶）
            this.redisplayKeepingRow(sourceId);
        });
    }

    /**
     * 🔴 #664：在一颗按钮**旁边**闪一条轻提示（`actions` 是它所在的动作行）。
     *
     * 与「恢复默认」那枚（`flashInlineHint` 的兄弟实现）同一视觉：淡底小字，1.5s 后自动淡出。
     * ⚠️ 为什么用它而不是回执槽：回执槽会随行重建一起消失，**恰好就是用户报的这个现象**；
     *    轻提示挂在**刚点的那颗按钮旁边**，用户视线不用移开。
     * ⚠️ 同时挂 `role="status"`，读屏也能听见（⛔ 不要只靠颜色 / 位置传达）。
     */
    private flashInlineHint(host: HTMLElement, text: string): void {
        host.querySelector('.rl-inline-hint')?.remove();
        const tip = document.createElement('span');
        tip.className = 'rl-inline-hint';
        tip.setAttribute('role', 'status');
        tip.textContent = text;
        host.appendChild(tip);
        window.setTimeout(() => tip.remove(), 2400);
    }

    /**
     * 🔴 #664：刷新设置页（为了更新徽标），但**保住刚操作那一行的展开态与回执文字**。
     *
     * `display()` 会整页重建 ⇒ 行回到收起态、回执被清空。
     * 这里在重建前后各记一次：重建后把那一行重新展开，并把回执文字写回去。
     * ⚠️ 只在「确实需要刷新徽标」时调用；无谓的重建本身就是这个 bug 的来源。
     */
    private redisplayKeepingRow(sourceId: string): void {
        const sel = `.rl-key-row[data-source-id="${sourceId}"]`;
        const before = this.containerEl.querySelector(sel);
        const wasOpen = !!before?.hasClass('rl-key-open');
        const resultText = before?.querySelector('.rl-key-result')?.textContent ?? '';
        const resultOk = before?.querySelector('.rl-key-result')?.hasClass('rl-key-result-ok') ?? false;
        const resultBad = before?.querySelector('.rl-key-result')?.hasClass('rl-key-result-bad') ?? false;
        this.display();
        const after = this.containerEl.querySelector(sel);
        if (!after) return;
        if (wasOpen) after.addClass('rl-key-open');
        if (resultText) {
            const el = after.querySelector('.rl-key-result');
            if (el) {
                el.setText(resultText);
                el.toggleClass('rl-key-result-ok', resultOk);
                el.toggleClass('rl-key-result-bad', resultBad);
            }
        }
    }

    /**
     * 元数据源配置折叠项内「单源配置行」：**来源图标** + 源名 + 状态徽标（已配置/未配置/可选 Key）+ ▸，
     * 点击行头内联展开配置区（hint + 密文输入 + 「测试连接」✓/✗ · 耗时），再点收起。
     * 输入变更写 settings[keyField] + saveSettings + 刷新徽标；不抛未捕获异常（测试内部 catch）。
     *
     * 🔴 #488（用户 2026-10-02：「元数据源凭据界面也改成 AI 集成的样式，加图标」）：
     *    ⑴ **行挂 `.rl-prov-card`** —— 与 AI 页「模型服务」四张卡**同一套外观**（容器 `.rl-prov-list`
     *       由调用方给）。⛔ 别在这里另写卡片样式：`.rl-key-row.rl-prov-card` 那条两级规则是唯一出处。
     *    ⑵ **行头最前是来源图标**（真源 `pure/sourceIcons`，渲染端与 AI 页共用 `renderAiIcon`）——
     *       品牌标优先（豆瓣 / IGDB），未被 Simple Icons 收录的走内置图标兜底，⛔ 不拿别家品牌标顶替。
     *    ⑶ **入参从 `ProviderMeta` 换成 `KeySourceId`** —— 让 `SOURCE_ICON[id]` 的类型天然成立
     *       （⛔ 别退回「传 meta 再 `as` 断言」：那样加一个凭据源忘了配图标**编译期不报错**，只会静默缺图标）。
     *    ⚠️ 折叠行为一字未改：图标在行头最前，点行头仍是开合开关。
     */
    private createApiKeyRow(parent: HTMLDivElement, id: KeySourceId): void {
        const meta = PROVIDER_META[id];
        if (!meta.keyField) return; // 免 Key 源不在此列
        const keyField: string = meta.keyField;
        const keyField2: string | undefined = meta.keyField2 ?? undefined; // 双凭据源（igdb）第二字段
        const row = parent.createDiv({
            cls: 'rl-key-row rl-prov-card',
            // 🔴 #664：带上源 id —— 同步完要刷新徽标时，靠它把**同一行**找回来、
            //    保住它的展开态与回执（否则整页重建后那一行会自己合上，用户什么都看不到）。
            attr: { 'data-source-id': id },
        });
        const head = row.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), SOURCE_ICON[id]);
        // 🔴🔴 #641（1.4.1，用户点名）：「steam 凭据行上的副标题取消并移动到（获取：… 用途：…）后面」。
        //    ⇒ 行头**只有源名**（与豆瓣 / TMDB / 微信读书等其余源**逐字同构**）。
        //    ⚠️ #640f 曾为 Steam 单独建一层 `.rl-key-text`（名字 + 副标题，column 排布）——
        //      副标题取消后那一层**没有存在理由**（单元素纵列 = 白搭一层 flex），
        //      且留着会让 Steam 行头与别源**结构不同**。
        //    ⇒ 整块收掉（连 `credentialSubtitle` 方法一起删）；那条硬前置改由
        //      `pure/sourceRegistry` 的 steam.hint 承载（展开即见）。
        head.createSpan({ cls: 'rl-key-name', text: meta.label });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            // 🔴🔴 #690（用户报障 2026-10-20：「tmdb 填了 API 连接成功但未填 id，为什么显示未配置」）：
            //   双凭据源的「已配置」判据**不是一律双字段同有值** ——
            //   · 缺省（igdb）：两个字段是一对，少一个就换不出 token ⇒ 双有才算配置好（口径不变）；
            //   · `keyField2OptionalForConfigured`（tmdb）：session_id 只服务账号同步，
            //     搜索只用 API Key ⇒ **主凭据有值即已配置**，否则就与「测试连接」（只查 API Key）互相打架。
            //   ⚠️ 只改徽标；同步按钮在发请求前自己拦「还缺 Session ID」（renderTmdbSyncButton / TmdbSyncModal）。
            const has = !!this.settingValue(keyField)
                && (meta.keyField2OptionalForConfigured === true || !keyField2 || !!this.settingValue(keyField2));
            // 🔴 #589：开机自检（或手动「测试连接」）**测不通** ⇒ 徽标改「连接失败」（红，#634 由「已失效」改名）。
            //    ⚠️ 只在**已配置**时才谈失效；`undefined`（还没测过）走原来的两态 ——
            //       ⛔ 别把「还没跑」画成「连接失败」（那是撒谎，判据见 `pure/credentialCheck.isExpired`）。
            const expired = has && isExpired(this.plugin.credentialStatusOf(sourceCheckKey(meta.id)));
            if (expired) {
                badge.setText(EXPIRED_BADGE);
            } else if (has) {
                badge.setText('已配置');
            } else {
                // 🔴 #580：源可自带文案（`emptyBadge`，如微信读书的「可选 Cookie」）；
                //    没带的源逐字沿用「可选 Key / 未配置」两态（#489 口径未动）。
                badge.setText(meta.emptyBadge ?? (OPTIONAL_KEY_SOURCES.has(meta.id) ? '可选 Key' : '未配置'));
            }
            badge.toggleClass('rl-key-badge-on', has && !expired);
            badge.toggleClass('rl-key-badge-bad', expired);
        };
        refreshBadge();
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        const body = row.createDiv({ cls: 'rl-key-body' });
        body.createDiv({ cls: 'rl-hint-note', text: meta.hint });
        /**
         * 🔴🔴 #667（用户：「tmdb 怎么多显示了一行 key 框」+「统一 id 框在上，key 框在下」）：
         * 双凭据源的两个输入框，**统一「标识」在上、「密钥」在下**：
         *   · igdb：Client ID（keyField，标识）→ Client Secret（keyField2，密钥）—— 声明序天然正确；
         *   · tmdb：Session ID（keyField2，标识）→ API Key（keyField，密钥）—— **倒序**。
         * 🔴 上一版 #666 的 bug：主字段（`keyField`）在下面这块**之外**无条件先建了一次，
         *    tmdb 分支里又建一遍 ⇒ API Key 框**出现两次**（一次在 Session ID 上面、一次在下面）。
         *    ⇒ 重构：主字段**只在分支里建**（tmdb 走后建、其余源先建），⛔ 任何路径都只建一次。
         * ⚠️ 占位符按源给出（⛔ 别写死 IGDB 的字样）。
         */
        const mainField = (): void => {
            this.createSecretField(body, {
                placeholder: this.credentialPlaceholder(meta),
                value: this.settingValue(keyField),
                onInput: (v) => {
                    (this.plugin.settings as unknown as Record<string, unknown>)[keyField] = v;
                    void this.plugin.saveSettings();
                    // #589：值一改，旧的「连接失败」结论立刻作废（⛔ 别让红标挂在一个刚填的新值上）
                    this.plugin.clearCredentialStatus(sourceCheckKey(meta.id));
                    refreshBadge();
                },
            });
        };
        const secondField = (): void => {
            const placeholder = meta.id === 'tmdb' ? 'TMDB Session ID（账号同步用）' : `${meta.label} Client Secret`;
            this.createSecretField(body, {
                placeholder,
                value: this.settingValue(keyField2 as string),
                onInput: (v) => {
                    (this.plugin.settings as unknown as Record<string, unknown>)[keyField2 as string] = v;
                    void this.plugin.saveSettings();
                    this.plugin.clearCredentialStatus(sourceCheckKey(meta.id));
                    refreshBadge();
                },
            });
        };
        if (keyField2) {
            if (meta.id === 'tmdb') {
                // tmdb：标识（Session ID）在上，密钥（API Key）在下
                secondField();
                mainField();
            } else {
                // igdb 等源：标识（keyField）在上，密钥（keyField2）在下
                mainField();
                secondField();
            }
        } else if (meta.id === 'steam') {
            // 🔴🔴 #667（用户：「我要的是 steam 的 id 框与 key 框调换」）：
            //    Steam 的「标识」= SteamID（`renderSteamExtra` 里的那个明文框），密钥 = API Key（keyField）。
            //    上一版顺序 = Key 在上、SteamID 在下（#640f 定的）；用户这次点名**调换** ⇒ SteamID 在上、Key 在下。
            //    实现 = **主字段（Key）延后建**：先跑 renderSteamExtra（把 SteamID 框放上去），
            //    再补 Key 框。SteamID 的就地校验 / 失焦落盘逻辑都在 renderSteamExtra 里（⛔ 不搬）。
            //    ⚠️ 动作行（同步/测试）仍须在**两个输入之后**（#640f 口径不变）。
            this.renderSteamExtra(body);
            mainField();
        } else {
            mainField();
        }
        // 🔴🔴 #640f（1.4.0，用户点名）：「这两个同步与测试连接按钮应该在 **steamid 下**」。
        //    ⇒ 动作行在「输入之后」才建（下面的 `actions`）。
        // 🔴🔴 #667（用户：「steam 的 id 框与 key 框调换」）：SteamID 输入**已经搬到上面**（steam 分支里
        //    `renderSteamExtra` 先于 `mainField`）⇒ 这里⛔ **不许再调一次** renderSteamExtra
        //    （本批实测：残留的旧调用让 SteamID 框出现两个 —— 产物核对当场抓到）。
        // 🔴🔴 #640e：「steam 同步按钮还有微信读书同步按钮应该和测试连接并排显示」——
        //    动作行**只建这一次**，两个同步按钮往里追加，「测试连接」也建在同一行。
        //    ⚠️ 原先是各建各的 `.rl-key-actions`（同步一行、测试又一行）⇒ 竖着堆三行。
        //    ⚠️ 顺序 = 同步按钮在前、测试连接在末（同步是这一行的主操作）。
        // 🔴🔴 #641（1.4.1，用户报障「同步和测试连接两个按钮之间的间距不一致」）：
        //    真因 = 中间那个**空的** `.rl-key-result` span 也是 flex item（实测 width=0 但仍占一格），
        //    ⇒ `gap: 8px` 被**计了两次**（8 + 8 = 16px），比别处按钮间距大一倍。
        //    实测证据（`_probe_641_gap.cjs` / `gap2.cjs`，真 Chrome 量 rect）：
        //      改前 —— 同步右边界 669 / 测试左边界 685 ⇒ **16px**；
        //      摘掉中间 span —— `gap = 8px`。
        //    ⇒ 结果 span **挪到测试连接之后**（DOM 里两个按钮**相邻**，gap 只计一次）。
        //    ⚠️ 与原「同步 Steam · ✗ …」的就地回执次序一致（回执仍紧跟它服务的按钮组），
        //      且失败长文案不再把两颗按钮**撑开**（max-width:60% 换行时更明显）。
        // 🔴🔴 #655 动作行**按创建顺序建按钮**，⛔ 不再用 `resultEl.before()` 排序：
        //    上一版是「先建回执槽 → 两个排序槽 before(回执槽)」⇒ 后插入的**测试连接跑到了最前**
        //    （真实 DOM 是「测试连接 · 同步 Steam · 回执」），用户看到的正是两颗按钮**顺序反了**。
        //    而我当时的仿真页是**手写**成「同步 → 测试」的 ⇒ 量出「8px 对齐」就收工，**量的是假的**。
        //    ⚠️ 教训：仿真页必须复刻**创建顺序**，⛔ 不能复刻「我以为的顺序」。
        //    现在：回执槽 → 同步按钮 → 测试连接，三条同步行（Steam / 微信读书 / 无同步的源）同构。
        // 🔴 #641：⛔ 回执槽别夹在两颗按钮**中间**：空的 flex item 会把 `gap` 计两次
        //    （8 → 16px），正是用户报过两次的那处间距。放到**行首**即可（见下条 ⑴）。
        // 🔴 用户裁定（1.4.x）：「测试结果文字显示在按钮左边，且点按钮时按钮不许跳」。
        //    ⑴ 回执槽**建在最前**（DOM 首个 flex item）：`.rl-key-result` 吃满剩余空间、文字右对齐贴按钮，
        //       ⇒ 文字变长不会把按钮往左推（这是本次要修的那类跳动）。
        //    ⑵ 顺带保住 #641 那条约束：回执槽在**按钮组之外**，两颗按钮仍然相邻，
        //       `gap` 只计一次（8px），⛔ 不会回到 16px。
        //    ⑶ 顺序 = 回执槽 → 同步按钮 → 测试连接（视觉上仍右对齐成「同步 · 测试」，回执在最左）。
        const actions = body.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        // 回执槽交给 Steam 的同步按钮（它稍后才建 ⇒ 用**取值函数**延迟拿，⛔ 别用 null 兜底）
        const syncResultEl: HTMLElement = resultEl;
        if (meta.id === 'steam') this.renderSteamActions(actions, () => syncResultEl, meta.id);
        // 🔴 #639 ⑥：微信读书的同步入口**搬到它自己的凭据行里**（用户：
        //    「并将微信读书同步入库的项放在微信读书凭据下拉处，两个同步按钮样式都改成**白字主题色底**」）。
        //    ⚠️ 原来是「基本设置 › 启用内置阅读器」折叠组里的独立一行 —— 现在**那一行删掉**，
        //    入口只此一处（⛔ 别两处都留：同一功能两个入口，用户会以为哪一处是失效的备份）。
        if (meta.id === 'weread') this.renderWereadSyncButton(actions);
        // 🔴 #662（用户：「元数据源凭据-豆瓣凭据入口再添加个同步导入按钮的功能」）：
        //    豆瓣也有一颗同步按钮 —— 位置 / 样式 / 次序与微信读书**完全同构**
        //    （⛔ 别另起一行、别另用一种颜色：三个源的动作行必须长得一样，用户才不用重新认）。
        if (meta.id === 'douban') this.renderDoubanSyncButton(actions);
        // 🔴 #665（用户：「Bangumi 元数据源凭据行加个同步按钮并排，也做 TMDB 的同步接入」）：
        //    Bangumi / TMDB 也各加一颗 —— 五个可同步源的动作行**同构**（Steam / 微信读书 / 豆瓣 / Bangumi / TMDB）。
        //    TMDB 需要第二凭据 session_id（meta.keyField2 已声明，双字段输入框自动出现）。
        if (meta.id === 'bangumi') this.renderBangumiSyncButton(actions);
        if (meta.id === 'tmdb') this.renderTmdbSyncButton(actions);
        // 测试连接：✓/✗ 消息 · Nms；失败红色、成功绿色（与同步按钮**同一行**）
        const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
        // ⛔ 回执槽**已在行首**建好（见本方法上方 `resultEl`）—— 别再在这里建第二个：
        //    那样会多出一个空 flex item（把 `gap` 计两次，8 → 16px = #641 老毛病），
        //    且结果文字又跑到按钮右边去（正是用户本次要修的那处）。
        testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            // ⛔ 不改文案（同音乐源那处）：文字变短会使按钮变窄 ⇒ 横向跳动
            testBtn.addClass('rl-btn-loading'); // 1.0.4：内联 spinner（文字由 .rl-btn-loading 置透明）
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const res = await this.testConnectionFor(meta.id);
            testBtn.disabled = false;
            testBtn.removeClass('rl-btn-loading');
            // 🔴 #589：手动测试的结论**记进同一个结果表** —— 徽标（含刚被打开的「连接失败」）据此同步刷新。
            this.plugin.setCredentialStatus(sourceCheckKey(meta.id), res.ok);
            refreshBadge();
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            // 反馈配色（用户 2026-09-14 裁定）：失败才红，成功一律绿 —— 不再区分「偏慢」档
            resultEl.toggleClass('rl-key-result-ok', res.ok);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
        });

        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /** 该组全部适用源（候选，已实现且 groups 含本组；注册表顺序，天然 ≤3） */
    private groupCandidates(group: SourceGroup): ProviderMeta[] {
        return PROVIDERS.filter((p) => p.implemented && p.groups.includes(group));
    }

    /**
     * 数据源启用折叠项内「分类勾选行」：组名 + 该组全部候选源行内并排勾选。
     * 仅 checkbox + 源名（无徽标 / ↑↓ / 「主」 / 「已选 N」摘要）；勾选集合 + 组内顺序取自注册表（豆瓣恒为链首/主力源）。
     * 勾选 toggle → commit → normalize → 等于默认链删键（undefined）/ 偏离则写 sourceChains[group]
     * → saveSettings → 仅重绘本组。组内不可全空：全取消 = 恢复上一有效态。
     */
    private createGroupCheckRow(parent: HTMLDivElement, group: SourceGroup): void {
        const box = parent.createDiv({ cls: 'rl-srcchk-group' });
        const head = box.createDiv({ cls: 'rl-srcchk-head' });
        head.createSpan({ cls: 'rl-srcchk-gname', text: GROUP_LABELS[group] });
        const list = box.createDiv({ cls: 'rl-srcchk-list' });
        const candidates = this.groupCandidates(group);

        const currentChain = (): ProviderId[] => resolveSourceChain(this.plugin.settings.sourceChains, group);

        const commit = (draft: ProviderId[]): void => {
            const norm = normalizeSourceChain(group, draft);
            if (norm.length === 0) {
                render(); // 组内不可全空：恢复上一有效态（与 resolve 回退默认链语义一致，不落空键）
                return;
            }
            const next = { ...(this.plugin.settings.sourceChains ?? {}) };
            const def = DEFAULT_CHAINS[group];
            if (norm.length === def.length && norm.every((id, i) => id === def[i])) {
                delete next[group]; // 等于默认链 → 删键（保持 undefined = 默认）
            } else {
                next[group] = norm;
            }
            this.plugin.settings.sourceChains = Object.keys(next).length > 0 ? next : undefined;
            void this.plugin.saveSettings();
            render();
        }

        const render = (): void => {
            const chain = currentChain();
            list.empty();
            for (const c of candidates) {
                const checked = chain.includes(c.id);
                const line = list.createEl('label', { cls: 'rl-srcchk-line' });
                const cb = line.createEl('input', {
                    cls: 'checkbox',
                    attr: { type: 'checkbox', 'data-tip': `是否启用「${c.label}」参与「${GROUP_LABELS[group]}」搜索` },
                });
                cb.checked = checked;
                cb.addEventListener('change', () => {
                    if (cb.checked) commit([...chain, c.id]);
                    else commit(chain.filter((id) => id !== c.id));
                });
                line.createSpan({ cls: 'rl-srcchk-name', text: c.label });
            }
        }

        render();
    }

    /**
     * 渲染整个设置页（#354 合并 4 Tab / #357 滚动方式改回外框）。
     *
     * 🔴 #354 三件（用户给定）：
     *    ⑴ **合并成 4 个平级 Tab**：基本设置（= 原「数据管理」+「外观」+「实验性功能」）/
     *       元数据源配置（#354 原「数据源管理」改名，**#422 再改成「元数据源配置」**）/ AI集成 /
     *    ⑵ **顶部固定**（见 ⑶ 的改判）；⑶ **去掉内容区页标题**（4 页全去）：页名已由 Tab 承载；
     *       连带 `createSectionHeading` 整体删除。
     *
     * 🔴 #357 改判：**滚动交回 Obsidian 外框**（`.vertical-tab-content` 自带 `overflow-y:auto`），
     *    Tab 栏改由 `position: sticky` 固定。
     *    ⚠️ 为什么把 #354 的「内容区独立滚动」撤掉：用户要「滚动条像别的插件那样贴**界面边缘**」——
     *       外框的横向内距是 `max(var(--size-4-8), var(--setting-group-center-offset))`（动态，
     *       面板越宽内容越往里缩），所以**自己滚的内容区，滚动条必然画在内容盒右缘**（离面板边缘 32px 起）。
     *       这两条要求**互斥**，以用户本轮口径为准；栏的固定靠 sticky，观感不变。
     *
     * 结构：shell（普通块）> bar（Tab 栏，sticky）+ content（普通块，仅作包裹）。
     *   **全宽度只有这一个形态** —— #352 那套「宽屏左栏 / 窄屏手风琴」双形态早已退场：
     *   窄屏不再换导航，改由 Tab 栏自己横向滚动承接（并在 <720px 藏图标腾宽度）。
     *
     * ⚠️ **页内容全部预先渲染**（不是懒渲染）—— 否则在「媒体库目录」里打了一半字、切页再切回来就没了。
     */
    display(): void {
        const { containerEl } = this;
        // 🔴 #484（用户报的「不能实时点击反馈」根因 ①）：
        //    本方法**整页重建**（`containerEl.empty()`），而内容区 `.rl-set-content` 是**独立滚动容器**（#354）
        //    ⇒ 不存/复 `scrollTop` 的话，选完一个模型、弹窗一关，页面就**跳回顶部**，
        //      你刚改的那一行已经滚出视野 —— 看起来就像「点了没反应」。
        //    ⚠️ 只在**重建前**取旧值；切 Tab 走的是 `setActivePage`（不重建），不受影响。
        const prevContent = containerEl.querySelector('.rl-set-content');
        const keepScroll = prevContent instanceof HTMLElement ? prevContent.scrollTop : 0;
        containerEl.empty();
        this.tabItems.clear();
        this.pageEls.clear();
        this.tabsEl = null;

        const shell = containerEl.createDiv({ cls: 'rl-set-shell' });
        const bar = shell.createDiv({ cls: 'rl-set-bar' });
        const tabs = bar.createDiv({ cls: 'rl-set-tabs', attr: { role: 'tablist', 'aria-label': '设置分类' } });
        const content = shell.createDiv({ cls: 'rl-set-content' });
        // #354 溢出遮罩门控（方案 b：JS 加类，与核心 .is-scrolled 同款）——
        // 滚动 / 窗口尺寸变化都要重算；首帧还要补一次（布局未完成时 scrollWidth 读不到）。
        this.tabsEl = tabs;
        tabs.addEventListener('scroll', this.onTabsScroll, { passive: true });
        window.addEventListener('resize', this.onWindowResize);
        requestAnimationFrame(() => this.syncTabsOverflow());

        for (const page of SETTING_NAV_TABS) {
            const tab = tabs.createEl('button', {
                cls: 'rl-set-tab',
                attr: {
                    type: 'button',
                    role: 'tab',
                    id: tabDomId(page.id),
                    'aria-controls': pageDomId(page.id),
                    'aria-selected': 'false',
                    tabindex: '-1',
                },
            });
            safeSetIcon(tab.createSpan({ cls: 'rl-set-tab-icon' }), page.icon);
            tab.createSpan({ cls: 'rl-set-tab-label', text: page.label });
            tab.addEventListener('click', () => this.setActivePage(page.id));
            // WAI-ARIA Tabs 模式：←/→ 在相邻 Tab 之间**循环**移动并把焦点带过去。
            // ⚠️ 取值规则（含「activeId 不在栏内」的兜底）收敛在纯函数 nextTabId 里，由单测钉住。
            tab.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
                ev.preventDefault();
                const next = nextTabId(page.id, ev.key === 'ArrowRight' ? 1 : -1);
                this.setActivePage(next);
                this.tabItems.get(next)?.focus();
            });
            this.tabItems.set(page.id, tab);
        }

        for (const page of SETTING_NAV_PAGES) {
            const el = content.createDiv({
                cls: 'rl-set-page',
                // 🔴 #541：`data-page` 是「基本设置页分组卡片化」的**唯一选择器锚**
                //    （`.rl-set-page[data-page="basic"] .rl-svc-group`）。
                //    ⚠️ 刻意不用 id 选择器（`#rl-set-page-basic`）—— id 权重 (1,0,0) 会盖过所有类规则，
                //      以后想再细化某一组就得一路加 id，本仓没有这个先例。
                attr: { id: pageDomId(page.id), 'data-page': page.id, role: 'tabpanel', 'aria-labelledby': tabDomId(page.id) },
            });
            const body = el.createDiv({ cls: 'rl-set-page-body' });
            this.renderPage(page.id, body);
            this.pageEls.set(page.id, el);
        }

        this.setActivePage(this.activePage);

        // 🔴 #484：把滚动位置还回去（接上面的取值）。
        //    ⚠️ 必须等**布局完成**才能设：`scrollTop` 会被「内容还不够高」悄悄夹到 0
        //    ⇒ 放 `requestAnimationFrame` 里（与首帧补算溢出遮罩同一时机）。
        if (keepScroll > 0) {
            requestAnimationFrame(() => {
                content.scrollTop = keepScroll;
            });
        }
    }

    /** 按页 id 分发到各页渲染（id 全部来自 `pure/settingNav` 的常量） */
    private renderPage(id: string, body: HTMLElement): void {
        if (id === 'basic') this.renderBasicPage(body);
        else if (id === 'sources') this.renderSourcePage(body);
        else if (id === 'ai') this.renderAiPage(body);
        else if (id === 'advanced') this.renderAdvancedPage(body);
        else this.renderAboutPage(body);
    }

    /**
     * 「高级设置」页（1.3.1 ①，2026-10-12）：**3 组**。
     *   · 字段映射 —— 把插件写出的 frontmatter 键名改成用户习惯的名字（**读写闭环**）
     *   · 卡片信息栏 —— 决定卡片（卡片网格 / 海报墙）上显示哪几行属性
     *   · 笔记属性顺序 —— 决定 frontmatter 的写出顺序
     * 🔴 页内**不设页标题**（页名只由 Tab 承载）—— 与其余 4 页同口径。
     * ⚠️ 第二组原名「海报墙卡片」，#624 随视图改名一并改成「**卡片信息栏**」——
     *    它配的本来就是「卡片上那几行」，而「海报墙」现在指的是**另一个视图**（纯封面那档）。
     */
    private renderAdvancedPage(parent: HTMLElement): void {
        // 🔴 #640（1.4.0，用户点名）组序：**字段映射 → 笔记属性顺序 → 卡片信息栏**。
        //    原来的顺序是「字段映射 → 卡片信息栏 → 笔记属性顺序」，改动理由 = 语义递进：
        //    前两组都是**笔记 frontmatter** 的事（先管「叫什么名字」、再管「排第几位」），
        //    卡片信息栏管的是**主视图卡片上那几行**，与笔记无关 ⇒ 排到最后才对得上读者的心智。
        this.createGroupSection(parent, '字段映射', (body) => this.renderFieldMapRows(body));
        this.createGroupSection(parent, '笔记属性顺序', (body) => this.renderFieldOrderRows(body));
        // 🔴 #640 ⑶：把本组的容器记下来 —— 「已保存」轻提示要挂在**组标题行**上（见 `mountCardFieldsToast`）
        this.createGroupSection(parent, '卡片信息栏', (body) => {
            this.cardFieldsGroupEl = body;
            this.renderCardFieldsRows(body);
        });
    }

    /**
     * 「笔记属性顺序」组（1.3.1 ① 第 3 件；**#640 改主从视图**）：**按类型**配置笔记 frontmatter 里属性的排列顺序。
     * 用户口径：「支持新增条目前各类型笔记属性排序」—— 即**预先**在这里排好，之后新增 / 重写的笔记就照它排。
     *
     * 🔴🔴 **#640（1.4.0）形态翻面：六列并排 → 左主右从**。用户报障原文：
     *    「目前展示为 **6 列并排导致横向空间严重不足**，改成主从视图……还有当前列列都显示了
     *     几个完全相同的属性（条目ID、类型、标题、状态...），这是一种视觉浪费。
     *     建议拆分『全局属性』与『类型专属属性』」。
     *    ⇒ 左侧 = **属性分组导航**（「全局」+ 六个类型），右侧 = 选中那一组的有序列表。
     *
     * 🔴 **数据模型不动**（用户 2026-10-15 裁定：「只改 UI 观感，不动数据模型」）：
     *    `settings.fieldOrder` 仍是 **per-type 的完整顺序表**（`FieldOrderConfig`），
     *    `pure/fieldOrder` 一行都不改 ⇒ **零迁移、零写出逻辑改动**。
     *    「全局」这一页显示的是**六个类型都有的那批字段**（`GLOBAL_FIELD_KEYS`），
     *    在它上面拖动**逐个写入六个类型**的顺序表 —— 于是用户「改一次全局顺序，所有类型生效」
     *    的诉求照样满足，而每个类型页里**只显示自己专属的那几个字段**（视觉浪费随之消失）。
     *    ⚠️ 合并逻辑天然成立：写出时用的仍是那个 per-type 完整数组（全局段在前、专属段在后），
     *      ⛔ 不需要在 `noteGenerator` 里再拼一次。
     *
     * 🔴 拖拽复用纯函数 `moveItem`（与系列「排序号」同一个通用件，⛔ 不另写第二份搬数组实现）；
     *    拖拽是纯指针操作 ⇒ 必须配**键盘 ↑↓ 等价物**，否则键盘 / 读屏用户够不着；
     *    `role="listbox"` + 行 `role="option"`（⚠️ ⛔ 别用 `listitem` 配 `tabindex` —— 非交互语义
     *    配焦点会让 a11y 检查报警，那是 `SeriesReorder` 已经踩过一次的坑）。
     *
     * 🔴 落盘口径：与缺省逐位一致时 **删掉该键**（不是存一份缺省副本）—— 这样以后新增字段能自动落在
     *    缺省位置，⛔ 不会因为「配置里没有它」而被排到末尾或吃掉。
     * ⚠️ 只影响**之后写入 / 重写**的笔记（改顺序不会回头去改已存在的笔记文件）。
     */
    private renderFieldOrderRows(body: HTMLElement): void {
        // 🔴 #652：本组的「恢复默认」（六类顺序 + 三个书籍子类顺序**一键全清**）
        this.mountGroupReset(body, {
            title: '笔记属性顺序',
            isCustomized: () =>
                Object.keys(this.plugin.settings.fieldOrder ?? {}).length > 0
                || Object.keys(this.plugin.settings.fieldOrderByKind ?? {}).length > 0,
            message: '将把所有类型（含文学 / 网文 / 漫画）的属性顺序恢复成默认。\n（只影响之后写入或重写的笔记）',
            apply: async () => {
                this.plugin.settings.fieldOrder = {};
                this.plugin.settings.fieldOrderByKind = {};
                await this.plugin.saveSettings();
            },
        });

        body.createDiv({
            cls: 'rl-fo-help',
            text: '拖动调整笔记里属性的排列顺序；只影响之后写入或重写的笔记。',
        });

        // 🔴 #653（用户：「再加个对比视图，如一整个表格滑动并览」）：**编辑 / 对比预览**两档切换。
        //    编辑 = 左主右从（一次看一组）；对比 = 一整个表格横向滑动（七组并排、按位次对齐）。
        //    ⚠️ 两个视图共用同一份取数（`orderForType` / `GLOBAL_FIELD_KEYS`），⛔ 别各算一套。
        let mode: 'edit' | 'compare' = 'edit';
        const modeBar = body.createDiv({
            cls: 'rl-fo-modebar',
            attr: { role: 'tablist', 'aria-label': '属性顺序视图' },
        });
        const editBtn = modeBar.createEl('button', {
            cls: 'rl-fo-mode', text: '编辑', attr: { type: 'button', role: 'tab', 'aria-selected': 'true' },
        });
        const cmpBtn = modeBar.createEl('button', {
            cls: 'rl-fo-mode', text: '对比预览', attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
        });
        const editHost = body.createDiv({ cls: 'rl-fo-view' });
        const cmpHost = body.createDiv({ cls: 'rl-fo-view' });
        cmpHost.addClass('is-hidden');
        const syncMode = (): void => {
            const isEdit = mode === 'edit';
            editBtn.toggleClass('is-on', isEdit);
            editBtn.setAttribute('aria-selected', isEdit ? 'true' : 'false');
            cmpBtn.toggleClass('is-on', !isEdit);
            cmpBtn.setAttribute('aria-selected', isEdit ? 'false' : 'true');
            editHost.toggleClass('is-hidden', !isEdit);
            cmpHost.toggleClass('is-hidden', isEdit);
            // 切到对比时才重算（横向长表，不必常驻 DOM 陪着编辑视图）
            if (!isEdit) this.renderFieldOrderCompare(cmpHost);
        };
        editBtn.addEventListener('click', () => {
            mode = 'edit';
            syncMode();
        });
        cmpBtn.addEventListener('click', () => {
            mode = 'compare';
            syncMode();
        });
        // 🔴🔴 #659（用户：「怎么不默认高亮『编辑』按钮啊，要切换一下才能正常高亮」）：
        //    上一版只在**点击时**调 `syncMode()` ⇒ 首屏两个按钮都还没有 `is-on`，
        //    初始 `aria-selected="true"` 是写在 HTML 里的字面量、类名却没跟上 ⇒ "看起来没高亮"。
        //    ⇒ 首次渲染就要跑一次（与点击走**同一个**函数，⛔ 不另写一份初始态）。
        syncMode();

        const wrap = editHost.createDiv({ cls: 'rl-fo-wrap' });

        // ── 左：属性分组导航（「全局」+ 六个类型）─────────────────────────────────
        const nav = wrap.createDiv({
            cls: 'rl-fo-nav',
            attr: { role: 'tablist', 'aria-label': '属性分组' },
        });
        nav.createDiv({ cls: 'rl-fo-nav-cap', text: '属性分组' });

        // ── 右：选中那组的有序列表（整块重画）───────────────────────────────────
        const pane = wrap.createDiv({ cls: 'rl-fo-pane' });

        /** 当前选中的分组。`null` = 全局；`{type}` = 六类型；`{kind}` = 书籍子分类（文学/网文/漫画） */
        let active: FieldOrderTarget = null;
        const navBtns = new Map<string, HTMLElement>();

        /** 刷新左侧高亮 —— 与右侧内容必须同源（⛔ 别在切换处各刷各的） */
        const syncNav = (): void => {
            const key = active === null ? '__global' : 'kind' in active ? `bk:${active.kind}` : `t:${active.type}`;
            for (const [k, el] of navBtns) {
                const on = k === key;
                el.toggleClass('is-on', on);
                el.setAttribute('aria-selected', on ? 'true' : 'false');
            }
        };

        const renderPane = (): void => this.renderFieldOrderPane(pane, active, syncNav);

        // 🔴🔴 #640e：左导航 = 全局 + **书籍按子分类拆三页**（文学 / 网文 / 漫画）+ 其余五个类型。
        //    用户（2026-10-16）：「高级设置-属性分组再新增**文学网文**更明确的分组」，
        //    追问裁定「拆成 文学 / 网文 / 漫画 三页」。位置 = **书籍原本那一格原地展开**
        //    （文学/网文/漫画紧跟在「动画」之后），⛔ 不把它们甩到列表末尾（那会让「书籍」这一族散开）。
        const entries: Array<{ key: string; label: string; target: FieldOrderTarget }> = [
            { key: '__global', label: '全局', target: null },
        ];
        for (const t of FIELD_ORDER_TYPES) {
            if (t === 'book') {
                // 书籍那一格拆成三个子分类页（展示名取自 `BOOK_KIND_LABELS`，⛔ 不手写）
                for (const k of BOOK_KINDS) {
                    entries.push({ key: `bk:${k}`, label: BOOK_KIND_LABELS[k], target: { kind: k } });
                }
                continue;
            }
            entries.push({ key: `t:${t}`, label: ENTRY_TYPE_LABELS[t], target: { type: t } });
        }
        for (const e of entries) {
            const btn = nav.createEl('button', {
                cls: 'rl-fo-navitem',
                text: e.label,
                attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
            });
            navBtns.set(e.key, btn);
            btn.addEventListener('click', () => {
                active = e.target;
                syncNav();
                renderPane();
            });
        }

        syncNav();
        renderPane();
    }

    /**
     * 🔴🔴 #653（用户：「再加个对比视图，如一整个表格滑动并览」）：**七组并排的位次矩阵**。
     *
     * 行 = **位次**（1..maxLen），列 = 全局 + 六个类型；格 = 「该组第 N 位是哪个字段」。
     * 🔴 为什么不按字段做行：七组字段集不同（全局 8 个、电影 16 个、书籍 20 个），
     *    按字段取并集会有 30+ 行、绝大多数格子空白 —— 稀疏矩阵根本读不出「对比」。
     *    用户要的是「第 3 位在各类里分别是谁」⇒ 位次做行才能横向对齐着读。
     *
     * 表格本体是**真 `<table>`**（`border-collapse: collapse` + 固定列宽），横向滑动由外层容器负责：
     *   · 外层 `overflow-x: auto` + 内层 `min-width: max-content` ⇒ 宽屏铺满、窄屏可滑；
     *   · 表头 / 首位次列 `position: sticky`（滑的时候列头跟着走，不然不知道自己在看哪一列）；
     * · 各列**等宽**（`minmax(96px, 1fr)` 的语义用 `table-layout: fixed` + 定宽实现）。
     * ⚠️ 这是**只读**视图：⛔ 不做拖拽 / 编辑（要改去「编辑」那档）。
     */
    private renderFieldOrderCompare(host: HTMLElement): void {
        host.empty();
        host.addClass('rl-fo-cmp');

        const fieldOrder = this.plugin.settings.fieldOrder;
        const kindOrderCfg = this.plugin.settings.fieldOrderByKind;

        // 全局次序：取电影那一份（六个类型同步写；用户手改 data.json 使它们不一致时，
        // 显示的是电影那份 —— 与编辑视图「全局」页的取法**同一口径**，⛔ 别另选一个类型）
        const movieOrder = orderForType(fieldOrder, FIELD_ORDER_TYPES[0]);
        const globalOrder = GLOBAL_FIELD_KEYS.filter((k) => movieOrder.includes(k));

        // 「用户已配」的完整次序（含全局段）—— 真源走 `pure/fieldOrder` 的两个汇总器，
        // ⛔ 别在设置页自己拼回落链（子类那份要走 kind → book → 缺省，拼错就静默用缺省序）。
        const typeOrders = resolveAllOrders(fieldOrder);
        const kindOrders = resolveAllKindOrders(fieldOrder, kindOrderCfg);

        /**
         * 某列最终喂给对比矩阵的数组 = **用户已配次序 ∩ 该列专属字段集**。
         * 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑦）：按列键前缀分流取数 ——
         *    `__global` = 全局那批；`t:<type>` = `exclusiveFieldsFor(type)`；
         *    `k:<kind>` = `exclusiveFieldsForBookKind(kind)`（网文才不会列出画师 / ISBN）。
         * 🔴 **必须滤掉全局字段**：`fieldAppliesTo` 对全局字段恒返回 true（它们没有 `appliesTo`），
         *    直接把 `resolveAllOrders` 那份整表丢进去，九列会变成「同一批全局字段 + 各自专属」
         *    —— 前面十来行九列一模一样，正是 #653 第一版被指出「把同一列抄九遍」的退化形态。
         */
        const columnOrder = (key: string): string[] => {
            if (key === '__global') return [...globalOrder];
            if (key.startsWith('k:')) {
                const allowed = exclusiveFieldsForBookKind(key.slice(2) as BookKind);
                return kindOrders[key.slice(2) as BookKind].filter((k) => allowed.includes(k));
            }
            const allowed = exclusiveFieldsFor(key.slice(2) as EntryType);
            return typeOrders[key.slice(2) as EntryType].filter((k) => allowed.includes(k));
        };

        const orders: Record<string, string[]> = {};
        for (const c of FIELD_ORDER_COMPARE_COLUMNS) orders[c.key] = columnOrder(c.key);

        const cmp = buildFieldOrderCompare(orders, globalOrder);

        host.createDiv({
            cls: 'rl-fo-cmp-cap',
            text: '按「位次」对齐：横向滑动可并览全部类型与书籍子类；每列只列该列的字段。',
        });
        // ⚠️ 表头（`thead th` 的 sticky）**必须留在这个滚动容器内部** —— 挪到容器外就没有
        //    「滑的时候列头跟着走」的效果，而且 sticky 会挂到设置页滚动流上（用户 2026-10-19 报障的层级穿透）。
        const scroll = host.createDiv({ cls: 'rl-fo-cmp-scroll' });
        const table = scroll.createEl('table', { cls: 'rl-fo-cmp-table' });
        // 首位次列 + 九列，全部定宽（⛔ 别用 auto 布局：各列宽度会被内容拉得参差，扫读时对不齐）
        const cols = ['56px', ...cmp.columns.map(() => '112px')].join(' ');
        table.createEl('colgroup').innerHTML = cols.split(' ').map((w) => `<col style="width:${w}">`).join('');
        const headRow = table.createEl('thead').createEl('tr');
        headRow.createEl('th', { cls: 'rl-fo-cmp-rank', text: '位次', attr: { scope: 'col' } });
        for (const c of cmp.columns) {
            const th = headRow.createEl('th', { cls: 'rl-fo-cmp-col', attr: { scope: 'col' } });
            th.createSpan({ cls: 'rl-fo-cmp-col-label', text: c.label });
            th.createSpan({ cls: 'rl-fo-cmp-col-n', text: `${cmp.sizes[c.key]} 项` });
        }
        const tbody = table.createEl('tbody');
        for (const row of cmp.rows) {
            const tr = tbody.createEl('tr');
            tr.createEl('th', { cls: 'rl-fo-cmp-rank', text: String(row.rank), attr: { scope: 'row' } });
            for (const c of cmp.columns) {
                const key = row.cells[c.key];
                const td = tr.createEl('td', { cls: key ? 'rl-fo-cmp-cell' : 'rl-fo-cmp-cell is-empty' });
                if (key) {
                    // 🔴 按**该列的类型**取名：`author` 在音乐列是「艺术家」、`developer` 在动画列是
                    //    「制作公司」、`duration_min` 在剧集/动画列是「单集片长」（见 `metaFields.labelFor`）。
                    //    书籍三子类共用大类的名字 ⇒ 传 'book'。
                    const colType = c.key.startsWith('t:')
                        ? (c.key.slice(2) as EntryType)
                        : c.key.startsWith('k:')
                          ? ('book' as EntryType)
                          : undefined;
                    td.createSpan({ cls: 'rl-fo-cmp-label', text: fieldLabelOf(key, colType) });
                    // 键名走 `data-tip`（本仓禁用 title）；空位不挂提示
                    td.setAttribute('data-tip', key);
                }
            }
        }
    }

    /**
     * 右侧面板：把**当前分组**的可拖列表画出来（#640）。
     *
     * 🔴 两档语义（同一个拖动实现，只是**作用范围**不同）：
     *    · `null`（全局）—— 列表 = **六个类型都有的**那批字段（`GLOBAL_FIELD_KEYS`）；
     *      拖动后 `commitGlobalOrder` 把新顺序**逐个写进六个类型**的顺序表。
     *    · 某类型 —— 列表 = 该类型的**专属字段**（`defaultOrderFor(type)` 减掉全局那批）；
     *      拖动只改这一个类型。
     *
     * ⚠️ **滚动与拖拽互不干扰**：列表自己 `overflow-y: auto`，而拖动用的是 HTML5 DnD
     *    （`draggable=true` + `dragstart/dragover/drop`）—— 浏览器在拖拽期间**不会**把指针移动
     *    当成滚动，所以「拖到列表底部自动滚动」这条浏览器**原生就给了**（HTML5 DnD 的标准行为），
     *    ⛔ 不需要手写定时器模拟「拖到边缘自动滚」。
     */
    private renderFieldOrderPane(
        pane: HTMLElement,
        target: FieldOrderTarget,
        onDone: () => void,
    ): void {
        pane.empty();

        // 🔴🔴 #640 修用户报障「电影专属属性的导演之类的怎么也归为全局属性了」：
        //    原先这里是**推导**（`defaultOrderFor` 对六个类型取交集），而那个函数答的是
        //    「写出侧会不会考虑这个字段」——`director`/`author`/`isbn` 这些「有值就写」的字段
        //    六类都返回 ⇒ 全被算成「六个类型全都有」⇒ 全局页几乎等于全部字段、各类型页成了空壳。
        //    ⇒ 改用**显式清单** `GLOBAL_FIELD_KEYS`（真源在 `pure/fieldOrder`，设置页不另写一份）。
        const globalKeys: readonly string[] = GLOBAL_FIELD_KEYS;
        const isGlobal = target === null;
        // 🔴 #640e：书籍子分类那一档（文学 / 网文 / 漫画）—— 与「类型」档分开处理
        const kind: BookKind | null = target && 'kind' in target ? target.kind : null;
        const type: EntryType | null = target && 'type' in target ? target.type : null;
        /** 这一页显示的标题名（子分类用 `BOOK_KIND_LABELS`，⛔ 不手写） */
        const pageLabel = isGlobal ? '全局' : kind ? BOOK_KIND_LABELS[kind] : ENTRY_TYPE_LABELS[type as EntryType];

        // 全局页 = 那批公共字段；其余页 = 该字段集适用、且**不属于公共**的那批（专属字段）。
        // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑦）：这里原先对书籍子类一律按 `'book'` 算字段集
        //    （`kind ? 'book' : type`），于是**网文 / 漫画页也把画师、ISBN 列了出来** —— 用户明确要求去掉。
        //    ⇒ 子类页改走 `exclusiveFieldsForBookKind(kind)`（排除表的真源在 `pure/fieldOrder`，
        //    ⛔ 别在设置页另写一份排除名单，否则三处会漂移）。
        const baseKeys = isGlobal
            ? [...globalKeys]
            : kind
              ? exclusiveFieldsForBookKind(kind)
              : exclusiveFieldsFor(type as EntryType);

        // 🔴 #643（用户「这个太丑了」）表头措辞：原来标题与说明**各说一遍「全局」**、中间还夹一个悬浮间隔号，
        //    读起来像两段碎句拼的。改成**一句说得清的话**：左边是「哪些字段」、右边是「改了对谁生效」。
        //    ⚠️ 这里**刻意不复述旧文案**：注释会进产物，反向守卫（「旧措辞不许回潮」）会被自己的注释撞红（本批实测撞过一次）。
        const head = pane.createDiv({ cls: 'rl-fo-pane-head' });
        head.createDiv({
            cls: 'rl-fo-pane-title',
            text: isGlobal ? '全局属性' : `${pageLabel}专属属性`,
        });
        head.createDiv({
            cls: 'rl-fo-pane-note',
            // 🔴 #640e：子分类页要**说清它与「书籍」的关系** —— 文学/网文/漫画三者属性集相同、
            //    但顺序各存各的（这正是用户要「更明确的分组」的意义），⛔ 别让用户以为改一个动全部。
            text: isGlobal
                ? '所有类型共用，改动对全部类型生效'
                : kind
                  ? `仅对${pageLabel}生效，文学 / 网文 / 漫画各存一份`
                  : `仅对${pageLabel}生效`,
        });

        if (!baseKeys.length) {
            pane.createDiv({ cls: 'rl-fo-empty', text: '这个类型没有专属属性' });
            return;
        }

        /**
         * 当前展示顺序。🔴 **真源是设置本身**（不是本地副本）——
         * 全局页要同时读六个类型，本地副本会立刻与设置不同步。
         */
        const readOrder = (): string[] => {
            if (isGlobal) {
                // 全局页：以六个类型的顺序表里**全局字段的相对次序**为准 ——
                // 取第一个类型（FIELD_ORDER_TYPES[0]）的相对次序作代表；六个类型从来同步写，
                // 若用户手改过 data.json 使它们不一致，这里显示的是「电影」那一份（可接受：一改就收敛）。
                const cur = orderForType(this.plugin.settings.fieldOrder, FIELD_ORDER_TYPES[0]);
                return baseKeys.filter((k) => cur.includes(k));
            }
            // 🔴 #640e：子分类页读它自己那份（回落链见 `orderForBookKind`：kind → fieldOrder.book → 缺省）
            const cur = kind
                ? orderForBookKind(this.plugin.settings.fieldOrder, this.plugin.settings.fieldOrderByKind, kind)
                : orderForType(this.plugin.settings.fieldOrder, type as EntryType);
            return baseKeys.filter((k) => cur.includes(k));
        };

        /** 落盘：全局页写**六个类型**、子分类页写 `fieldOrderByKind`、类型页写 `fieldOrder` */
        const commit = async (next: string[]): Promise<void> => {
            if (isGlobal) {
                const cfg = { ...(this.plugin.settings.fieldOrder ?? {}) };
                for (const t of FIELD_ORDER_TYPES) {
                    // 该类型的完整顺序 = 全局段（新次序）+ 它的专属段（原次序，⛔ 一个字不动）
                    const full = orderForType(this.plugin.settings.fieldOrder, t);
                    const own = full.filter((k) => !baseKeys.includes(k));
                    const merged = [...next, ...own];
                    if (isDefaultOrder(t, merged)) delete cfg[t];
                    else cfg[t] = merged;
                }
                this.plugin.settings.fieldOrder = cfg;
            } else if (kind) {
                // 🔴 #640e：**只动 `fieldOrderByKind[kind]`**，⛔ 不碰 `fieldOrder.book`
                //    （它是老用户的既有配置，也是另两个子类的回落源 —— 动它 = 三个子类一起变）。
                const kcfg = { ...(this.plugin.settings.fieldOrderByKind ?? {}) };
                // 该子类的完整顺序 = 全局段（原次序）+ 本子类的专属段（新次序）
                const full = orderForBookKind(this.plugin.settings.fieldOrder, this.plugin.settings.fieldOrderByKind, kind);
                const globalPart = full.filter((k) => globalKeys.includes(k));
                const merged = [...globalPart, ...next];
                if (isDefaultKindOrder(kind, merged)) delete kcfg[kind];
                else kcfg[kind] = merged;
                this.plugin.settings.fieldOrderByKind = kcfg;
            } else {
                const cfg = { ...(this.plugin.settings.fieldOrder ?? {}) };
                // 该类型的完整顺序 = 全局段（原次序，⛔ 一个字不动）+ 本类型的专属段（新次序）
                const full = orderForType(this.plugin.settings.fieldOrder, type as EntryType);
                const globalPart = full.filter((k) => globalKeys.includes(k));
                const merged = [...globalPart, ...next];
                if (isDefaultOrder(type as EntryType, merged)) delete cfg[type as EntryType];
                else cfg[type as EntryType] = merged;
                this.plugin.settings.fieldOrder = cfg;
            }
            await this.plugin.saveSettings();
        };

        const list = pane.createEl('ul', {
            cls: 'rl-fo-list',
            attr: {
                role: 'listbox',
                'aria-label': isGlobal ? '全局属性的顺序' : `${pageLabel}的专属属性顺序`,
            },
        });

        let order = readOrder();
        /** 正在拖的那一项（`dragstart` 记下、`drop` 取用） */
        let dragKey: string | null = null;
        /**
         * 🔴 2026-10-21：这一页按**哪个类型**的名字显示（`metaFields.labelFor`）。
         * · 全局页 ⇒ `undefined`（一律用缺省名）；
         * · 书籍三子类页 ⇒ `'book'`（子类不改显示名，差异只在**字段集**，见 `BOOK_KIND_EXCLUDED_FIELDS`）；
         * · 其余类型页 ⇒ 该类型（音乐页的 `author` 显示「艺术家」、动画页的 `developer` 显示「制作公司」）。
         */
        const labelType: EntryType | undefined = isGlobal ? undefined : kind ? 'book' : (type as EntryType);

        const render = (): void => {
            list.empty();
            order.forEach((key, i) => {
                const label = labelOf(key, labelType);
                const li = list.createEl('li', {
                    cls: 'rl-fo-item',
                    attr: {
                        role: 'option',
                        tabindex: '0',
                        draggable: 'true',
                        'aria-label': `${label}，第 ${i + 1} 位`,
                    },
                });
                // 🔴 #633 同款：把手只在悬停 / 拖动时现身（默认隐身，⛔ 不占位推文字）
                safeSetIcon(li.createSpan({ cls: 'rl-fo-grip' }), 'grip-vertical');
                li.createSpan({ cls: 'rl-fo-label', text: label });
                li.createSpan({ cls: 'rl-fo-key' }).createEl('code', { text: key });

                li.addEventListener('dragstart', (ev) => {
                    dragKey = key;
                    li.addClass('is-dragging');
                    ev.dataTransfer?.setData('text/plain', key);
                });
                li.addEventListener('dragend', () => {
                    dragKey = null;
                    li.removeClass('is-dragging');
                });
                li.addEventListener('dragover', (ev) => {
                    ev.preventDefault();
                    li.addClass('is-over');
                });
                li.addEventListener('dragleave', () => li.removeClass('is-over'));
                li.addEventListener('drop', (ev) => {
                    ev.preventDefault();
                    li.removeClass('is-over');
                    if (!dragKey || dragKey === key) return;
                    order = moveItem(order, order.indexOf(dragKey), order.indexOf(key));
                    void commit(order);
                    render();
                });

                // 键盘等价物：拖拽是纯指针操作，键盘 / 读屏用户否则够不着
                li.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                    ev.preventDefault();
                    const to = ev.key === 'ArrowUp' ? i - 1 : i + 1;
                    if (to < 0 || to >= order.length) return;
                    order = moveItem(order, i, to);
                    void commit(order);
                    render();
                    // 重建后焦点会掉 ⇒ 放回**同一项**的新位置（否则连按第二下就没反应）
                    (list.children[to] as HTMLElement | undefined)?.focus();
                });
            });
        };
        render();

        // 底部提示：把「最终写出的顺序」说清楚（用户象形稿里点名要有这一行）
        pane.createDiv({
            cls: 'rl-fo-foot',
            text: isGlobal
                ? '提示：此顺序对所有类型生效。各类型专属属性在对应类型页中单独排序。'
                : '提示：最终写入顺序 = 全局属性 → 本类型专属属性。全局那一段请在左侧「全局」页调整。',
        });

        // 左侧导航的高亮由外层 `syncNav` 管，这里只在**切换后**通知外层已重画
        onDone();
    }

    /**
     * 「字段映射」组（#613 改「逐字段一行的表格」）：**42 行全部可填**。
     *
     * 🔴 #613 用户裁定：「所有映射字段改成表格**全部可填**」⇒ 两处翻面：
     *    ⑴ 输入方式由**手打语法**（`[原] -> [新]` 的 textarea）改为**逐字段一行**的表格
     *       —— 用户不必记语法、也不必担心拼错键名（键名是现成的，只填目标名）；
     *    ⑵ 原先被钉住的 `tags` / `created` / `updated` / `rating`（Dataview 对齐键）**解除硬拦截**，
     *       只在那几行挂一枚 `Dataview` 徽标 + `data-tip` 说明「改名会让既有查询失效」。
     *    ⚠️ 同时把原来那张**只读**的「元数据字段清单」表**合并**进本表（`renderMetaFieldTable` 已删除）——
     *       两张表列同一份字段，分开摆既占地方又容易看串行。
     *
     * 🔴 校验仍是**边改边判**的（`parseFieldMap` 不抛异常、把错误折进返回值）——
     *    但落点变了：**校验不过就不落盘**（保持上一次合法状态），⛔ 不是「先存再报错」。
     *    理由：存进去的非法行虽然会被下游 `compileFieldMapText` 静默忽略，但用户会以为它生效了。
     *
     * ⚠️ 存储仍是**同一份文本**（`settings.fieldMap`，每行 `[原] -> [新]`）——
     *    写侧 `EntryService` / 读侧 `EntryModal` 一行都不用改，零数据迁移。
     */
    private renderFieldMapRows(body: HTMLElement): void {
        // 🔴 #652：标题行右侧「恢复默认」（用户：「高级设置下的三个组都要有恢复默认项」）。
        //    ⚠️ 挂**组标题行**而不是组内容顶部：三个组的位置一致，用户扫一眼就在同一个地方找到它。
        const help = body.createDiv({ cls: 'rl-fieldmap-help' });
        /** 说明行的主体句式（未配置时状态就折在它前面，见 `renderFieldMapStatus`） */
        const HELP_TEXT = '在「新属性名」列填你想要的键名，回车或失焦生效；留空 = 保持原属性名。';
        /** 回执槽：放在**说明与表头之间**（⛔ 不占固定高度，空态由 CSS 的 `:empty` 收掉） */
        const feedback = body.createDiv({ cls: 'rl-fieldmap-feedback' });

        // 🔴 #640（1.4.0，用户报障）：「表头区域超出了自身容器的边界，与上方设置页签的底部发生了
        //    视觉重叠/粘连。同时表格右侧出现了独立的滚动条，导致表格容器没有合理的内边距」。
        //    根因两条，一起修：
        //      ⑴ 表头虽写了 `sticky`，但它**在滚动容器内部** —— 滚到顶部时表头仍要参与该容器的
        //         布局，而容器有 `border-radius` + `overflow` ⇒ 表头的背景方块会顶到圆角外面，
        //         看着就像「溢出去压住了上方页签」；
        //      ⑵ 内容区滚动条占宽约 8px，而表头是 `width: 100%` ⇒ 表头比内容宽，
        //         右侧那一列的表头与内容**对不齐**。
        //    ⇒ 结构改成 **表头 / 表体两张独立的 `<table>`**：表头在外（不滚动），表体在滚动容器里。
        //      ⚠️ 两张表必须**列宽完全一致**才对齐 ⇒ 都走 `table-layout: fixed` + **同一份
        //      `<colgroup>`**（见 `COL_WIDTHS`），⛔ 别在 CSS 里各写一套百分比。
        //      ⚠️ 滚动条宽度用 `scrollbar-gutter: stable` 在滚动容器**右侧常驻预留**——
        //      这样不管有没有滚动条，表体内容区宽度都不变，与表头恒定对齐。
        // 🔴🔴 #652（用户：「表头和其下字段三者隔开按比例分一下」）：原来是 26 / 22 / 52 ——
        //    第一列（中文名，最长「阅读时长」「进度百分比」6 字）只占 26%、第三列（短键名）却吃掉
        //    一半以上 ⇒「名字挤、输入区空」。改成 **1 : 1.3 : 1.7**：名字给到能放下 6 字（约 1.4×），
        //    原键名按最长 `progress_total_episodes`（23 字符等宽 11px ≈ 150px）给够，
        //    剩下的全归输入区 —— 三列之间有明确比例关系，不再是被内容「挤」出来的。
        //    ⚠️ 列宽真源只在这里：CSS ⛔ 不得再写 `td { width: … }`（`table-layout: fixed` 下会打架）。
        const COL_WIDTHS = ['30%', '24%', '46%'];
        const headWrap = body.createDiv({ cls: 'rl-fieldmap-headwrap' });
        const headTable = headWrap.createEl('table', { cls: 'rl-fieldmap-table rl-fieldmap-head' });
        const colgroupHtml = COL_WIDTHS.map((w) => `<col style="width:${w}">`).join('');
        headTable.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;
        const hr = headTable.createEl('thead').createEl('tr');
        // ⚠️ 三列表头文字被既有断言钉住（逐字），⛔ 别顺手改词
        for (const h of ['字段', '原属性名', '新属性名']) hr.createEl('th', { text: h });

        const wrap = body.createDiv({ cls: 'rl-fieldmap-wrap' });
        const table = wrap.createEl('table', { cls: 'rl-fieldmap-table rl-fieldmap-body' });
        table.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;

        // 初值：把现有映射文本反解回「原键 → 新键」（未映射的字段留空）
        const current = new Map<string, string>();
        for (const e of parseFieldMap(this.plugin.settings.fieldMap ?? '').entries) current.set(e.from, e.to);

        /** ⚠️ 收集所有输入框：提交时要按**表格顺序**重新拼文本（顺序 = META_FIELDS 的顺序） */
        const inputs = new Map<string, HTMLInputElement>();

        const commit = async (): Promise<void> => {
            const lines: string[] = [];
            for (const f of META_FIELDS) {
                const v = (inputs.get(f.key)?.value ?? '').trim();
                // 🔴 #644：**空 = 不写这条映射**（= 保持原键名）。原键名现在只做 placeholder（不进 `value`），
                //    所以这里不再需要 `v !== f.key` 那半句 —— 但**留着**：用户手打成一个与原键名**完全相同**的
                //    串（比如把 `rating` 填成 `rating`）也是「改了等于没改」，不该在 `fieldMap` 里留一条空转映射。
                if (v && v !== f.key) lines.push(`[${f.key}] -> [${v}]`);
            }
            const draft = lines.join('\n');
            // 🔴 校验不过**不落盘**（见方法头说明）
            if (parseFieldMap(draft).errors.length) {
                this.renderFieldMapStatus(help, HELP_TEXT, feedback, draft);
                return;
            }
            this.plugin.settings.fieldMap = draft;
            await this.plugin.saveSettings();
            this.renderFieldMapStatus(help, HELP_TEXT, feedback, draft);
        };

        const tbody = table.createEl('tbody');
        for (const f of META_FIELDS) {
            const tr = tbody.createEl('tr');
            const labelTd = tr.createEl('td', { cls: 'rl-fm-label' });
            // 🔴 #645：`td` 上的左内距改不动（被 `.rl-fieldmap-table td` 的 `padding` 简写竞掉 —— 实测该 td 的
            //    computed `padding-left` 恒为 8px，连内联简写都不动）⇒ 8px 内缩改由**这个内层 span** 承担，
            //    与另两列「`<code>` / `<input>` 自己带内距」**同构** ⇒ 三列的值共享同一条文字左缘。
            labelTd.createSpan({ cls: 'rl-fm-label-text', text: f.label });
            // 🔴 #652（用户：「字段映射还有那几个不要dataview标签了」）：Dataview 徽标**整体撤掉**。
            //    ⚠️ 语义仍在 `pure/metaFields.dataviewAligned`（只是不再渲染），⛔ 别删那个字段 ——
            //    它是「这几个键被外部查询依赖」的唯一登记处，将来要提示还能用。
            tr.createEl('td', { cls: 'rl-fm-key' }).createEl('code', { text: f.key });

            const input = tr.createEl('td', { cls: 'rl-fm-input' }).createEl('input', {
                cls: 'rl-fm-name',
                type: 'text',
                attr: { placeholder: f.key, 'aria-label': `「${f.label}」的新属性名` },
            });
            // 🔴🔴 #644（用户：「输入框内显示的均是默认的原属性名……对应了上方『未配置映射』的提示」）——
            //    **空值就是「没配过」**，原键名只做**灰色占位提示**（`placeholder` 已在上面给了），⛔ 不再写进 `value`。
            //    理由三条：⑴ 回显 = 界面无法表达「我改过这一行」与「我没动」的区别；
            //    ⑵ 用户**做不到把某个字段改成空**（原值 `writer` 想不写出，只能先删光 —— 而回显态下删光又跳回原键名）；
            //    ⑶ 42 行输入框里 42 个重复的 `id`/`type`/`title` 本身就是一团噪声（这才是本组最刺眼的地方）。
            // 🔴🔴 #651：**已映射的行要有记号**（用户：「这UI太丑了，改改」）。输入框改表格式（无框）之后，
            //    「这行配没配」只能靠行上的记号表达 —— 判据 = 输入框有值且不等于原键名（提交口径同 `commit`）。
            //    ⚠️ 只切一个类，⛔ 不重建行（重建会把正在输入的焦点打掉）。
            const syncMapped = (): void => {
                const v = input.value.trim();
                tr.toggleClass('is-mapped', v !== '' && v !== f.key);
            };
            input.value = current.get(f.key) ?? '';
            input.spellcheck = false;
            inputs.set(f.key, input);
            syncMapped();
            // ⚠️ `input` 只管「记号」这一个视觉钩子（零写盘）；落盘仍走 `change`（回车 / 失焦）
            input.addEventListener('input', syncMapped);
            // `change` = 失焦或回车才触发（⛔ 不用 `input` 落盘，否则每敲一个字符都写盘一次）
            input.addEventListener('change', () => {
                void commit();
            });
        }

        // 🔴 #652：本组的「恢复默认」（清空 `fieldMap` 文本 ⇒ 回到恒等映射）
        this.mountGroupReset(body, {
            title: '字段映射',
            isCustomized: () => !!(this.plugin.settings.fieldMap ?? '').trim(),
            message: '将清空「字段映射」里的全部改名，之后写出的笔记一律用原始属性名。\n（已有的旧笔记不会回改）',
            apply: async () => {
                this.plugin.settings.fieldMap = '';
                await this.plugin.saveSettings();
            },
        });

        // 首次渲染就把当前状态的判定显示出来（别等用户动一下才出现反馈）
        this.renderFieldMapStatus(help, HELP_TEXT, feedback, this.plugin.settings.fieldMap ?? '');
    }

    /**
     * 「卡片信息栏」组（1.3.1 ①；**#616 改版 · #617 按类型拆**；#624 随视图改名换的标题）：**卡片预览 + 信息栏字段选择**。
     *
     * 🔴 **#617：配置按条目类型各一份**（六类）—— 顶部一个原生下拉切类型，下面整块（预览 + chip）
     *    跟着换。理由：16 个候选字段里大半是**类型专属**的（译者 / 出版社 / 出品方 → 书籍，
     *    平台 / 开发商 → 游戏，专辑 → 音乐），一部电影的信息栏里摆一行「译者」本就说不通。
     *
     * 🔴 形态（#616，用户 2026-10-12 裁定）：左 = **卡片实况预览**（改选立刻跟着变），
     *    右 = **信息栏字段** 16 枚 chip，点选即上卡、再点即移除，**至多 5 条**；到上限后其余 chip 置灰。
     *    换成 chip 的理由：16 行开关会占掉整屏竖向空间，而这里真正的诉求是「**看着卡片**选」
     *    ⇒ 预览与选择器必须同屏可见。
     *
     * 🔴🔴 **#640（1.4.0）四处改进**（用户逐条点名）：
     *    ⑴ **已选字段可拖拽排序** —— 原文「点选字段后只能按点选的先后顺序固定排列，无法调整先后位置。
     *       建议：在已选中的标签上增加拖拽功能……并持久化记忆（拖拽排序时，其他标签要有弹性占位动画）」。
     *       ⇒ 已选 chip 从「混在池子里」提升为**独立的「已选」区**，拖动即改顺序并落盘。
     *    ⑵ **海报占位高度减小** —— 原文「海报（封面的占位）高度太高，导致预览信息字段视觉比例不协调。
     *       建议：减小海报占位图的整体高度。目的让下方『信息栏』的文字展示区域获得更多空间」。
     *       ⇒ CSS 侧 `.rl-pvw-cov` 由 `aspect-ratio: 2/3`（150px 宽 ⇒ 225px 高）改为**固定 132px**。
     *    ⑶ **「已保存」轻提示** —— 原文「目前没有自动保存『已保存』的轻提示」。
     *       ⇒ 每次落盘后在本组标题右侧浮出一枚 `check` + 「已保存」，1.5s 后自动淡出。
     *    ⑷ **合并视图卡片等高** —— 那条不属于本方法（改的是 `MediaList` / `HomeView` 的卡片 CSS）。
     *
     * 🔴 预览取值**复用真卡片那个取值函数**（`pure/cardMeta` 的导出，参数传对应类型的演示条目）——
     *    与实物同源，⛔ 别在这里另写一遍取值逻辑，那样预览与实物会各走各的。
     *    ⚠️ 本行措辞**刻意避开那句调用的字面形态**：注释会进产物，写全了会把断言锚撞绿（#616 实测）。
     *    演示条目的 16 个字段**逐份全部有值**，保证「点哪个字段都能立刻看到它长什么样」
     *    （说明与单测守卫见 `pure/cardMeta`）。
     * ⚠️ 预览卡样式在 `styles.css`（`.rl-pvw-*`）：`MediaList` 的卡片样式是 **scoped** 的，
     *    设置页是普通 DOM-API、拿不到那串哈希 ⇒ 必须有一份全局的等价样式。
     * 🔴 落盘仍**按该类型池子的顺序重排**（数组顺序 = 渲染顺序，⛔ 别让「点选先后」决定它）；
     *    归一与截断在 `pure/cardMeta.normalizeCardFieldsForType`（真源）。
     */
    private renderCardFieldsRows(body: HTMLElement): void {
        // 🔴 #640 ⑶：整组的「已保存」轻提示挂在组标题行上（一进来就建好，落盘时点亮）
        this.mountCardFieldsToast();

        // 🔴 #652（用户：「像切换条目类型用选择不用下拉了」）：下拉 → **分段 chips**。
        //    理由：六个类型是**平级枚举**，下拉把五个藏进一次点击里；chips 一眼看全、一点即切，
        //    与下面那排「信息栏字段」chips 也是同一种手势（选中 = 主题色）。⛔ 别退回 `<select>`。
        // 🔴🔴 #653（用户点名顺序）：「电影、剧集、动画、文学、网文、漫画、游戏、音乐」——
        //    八格：六类型 + **书籍按子分类拆三页**（文学 / 网文 / 漫画，位置与「笔记属性顺序」那组一致：
        //    书籍原本那一格原地展开）。⚠️ 存储仍是 `cardFieldsByType` 的**六类型**口径（零迁移）：
        //    三个子分类分别映射到 `book` 的哪一份？⇒ 用户选哪个子类就显示 / 写那一类的**独立**配置
        //    （`cardFieldsByKind`）。没配过的子类回落到 `cardFieldsByType.book`（与 `fieldOrderByKind`
        //    同一条回落链，⛔ 别各写一套）。
        const typeRow = body.createDiv({ cls: 'rl-cf-typerow' });
        typeRow.createDiv({ cls: 'rl-cf-typerow-cap', text: '条目类型' });
        const typeBar = typeRow.createDiv({
            cls: 'rl-cf-typebar',
            attr: { role: 'tablist', 'aria-label': '条目类型' },
        });
        const panel = body.createDiv({ cls: 'rl-cf-panel' });

        // 切类型要重画**面板**（预览 + 已选 + 池子）与**类型条自身**的高亮 —— 同源刷新
        const panelHost = { el: panel };
        const typeBtns = new Map<string, HTMLButtonElement>();
        const syncTypeBar = (): void => {
            const cur = this.cardFieldsSlotKey();
            for (const [k, b] of typeBtns) {
                const on = k === cur;
                b.toggleClass('is-on', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            }
        };

        // 🔴 #652：本组的「恢复默认」—— 六类**全部**回到各自预填（不只是当前类型）
        this.mountGroupReset(body, {
            title: '卡片信息栏',
            isCustomized: () =>
                Object.keys(this.plugin.settings.cardFieldsByType ?? {}).length > 0
                || Object.keys(this.plugin.settings.cardFieldsByKind ?? {}).length > 0,
            message: '将把六个类型（含文学 / 网文 / 漫画）的卡片信息栏一起恢复成默认字段（当前选中的也不例外）。',
            apply: async () => {
                this.plugin.settings.cardFieldsByType = {};
                this.plugin.settings.cardFieldsByKind = {};
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            },
        });

        for (const e of CARD_TYPE_SLOTS) {
            const btn = typeBar.createEl('button', {
                cls: 'rl-cf-type',
                text: e.label,
                attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
            });
            typeBtns.set(e.key, btn);
            btn.addEventListener('click', () => {
                if (this.cardFieldsSlotKey() === e.key) return;
                this.cardFieldsSlot = e.key;
                syncTypeBar();
                this.renderCardFieldsPanel(panelHost.el);
            });
        }
        // 首次进入：把默认槽位抬到「当前类型对应的那一格」（电影 → f:movie）
        if (!CARD_TYPE_SLOTS.some((e) => e.key === this.cardFieldsSlot)) this.cardFieldsSlot = `f:${this.cardFieldsType}`;
        syncTypeBar();
        this.renderCardFieldsPanel(panelHost.el);
    }

    /**
     * 「卡片信息栏」当前选中的那一格（#653 八格）。
     * 🔴 槽位键是**字符串**（`f:<EntryType>` / `k:<BookKind>`），⛔ 别再用 `cardFieldsType` 单值表达 ——
     *    文学 / 网文 / 漫画共用 `book` 的类型却各存一份，一个 `EntryType` 装不下。
     */
    private cardFieldsSlot = 'f:movie';

    /** 当前槽位的键（没设过就按当前类型算，保证永远有值） */
    private cardFieldsSlotKey(): string {
        return CARD_TYPE_SLOTS.some((e) => e.key === this.cardFieldsSlot) ? this.cardFieldsSlot : `f:${this.cardFieldsType}`;
    }

    /** 当前槽位对应的**条目类型**（预览卡 / 字段池按它算） */
    private cardFieldsSlotType(): EntryType {
        const e = CARD_TYPE_SLOTS.find((x) => x.key === this.cardFieldsSlotKey());
        return e ? e.type : this.cardFieldsType;
    }

    /** 当前槽位对应的**书籍子分类**（仅 `k:*` 有值，其余为 null） */
    private cardFieldsSlotKind(): BookKind | null {
        const e = CARD_TYPE_SLOTS.find((x) => x.key === this.cardFieldsSlotKey());
        return e && e.kind ? e.kind : null;
    }

    /**
     * 在「卡片信息栏」组标题行右侧挂一枚「已保存」轻提示（#640 ⑶）。
     *
     * 🔴 为什么挂在**组标题**而不是面板里：面板每次切类型 / 每次点选都会 `empty()` 重画，
     *    挂在面板里的提示会被自己擦掉 ⇒ 必须挂在**不重画**的祖先上。
     * ⚠️ 走 `data-tip` 那条铁律不适用（这里是**状态回执**不是悬停提示），
     *    但读屏仍要能听见 ⇒ 用 `role="status"` + `aria-live="polite"`（本仓既有做法）。
     * ⚠️ 定时器只保留**一个**：连点五下会叠五个定时器，旧的到点把新的也隐掉
     *    （表现为「刚点的没提示」）⇒ 必须先清旧的。
     */
    private mountCardFieldsToast(): void {
        // 组标题由 `createGroupSection` 建在 `.rl-svc-group-title` 上；
        // 从 body 反查它 —— ⛔ 不改 `createGroupSection` 的签名（那会波及全页十来个调用点）
        const group = this.cardFieldsGroupEl;
        if (!group) return;
        const head = group.querySelector('.rl-svc-group-title');
        if (!head) return;
        // 已挂过就不重复挂（本方法可能因重新渲染被再调一次）
        if (head.querySelector('.rl-cf-toast')) return;
        const toast = document.createElement('div');
        toast.className = 'rl-cf-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        const icon = document.createElement('span');
        const label = document.createElement('span');
        label.textContent = '已保存';
        toast.appendChild(icon);
        toast.appendChild(label);
        safeSetIcon(icon, 'check');
        head.appendChild(toast);
        this.cardFieldsToastEl = toast;
    }

    /** 点亮「已保存」轻提示并安排 1.5s 后淡出（#640 ⑶） */
    private flashCardFieldsToast(): void {
        const el = this.cardFieldsToastEl;
        if (!el) return;
        el.addClass('is-on');
        if (this.cardFieldsToastTimer !== null) window.clearTimeout(this.cardFieldsToastTimer);
        this.cardFieldsToastTimer = window.setTimeout(() => {
            el.removeClass('is-on');
            this.cardFieldsToastTimer = null;
        }, 1500);
    }

    /**
     * 读**当前选中那一格**的信息栏配置（#653：八格 = 六类型 + 文学/网文/漫画）。
     * 🔴 刻意走 `resolveCardFieldsByType` 这个**唯一真源**（与 `HomeView.ts` 给海报墙传参时用的是同一个）
     *    —— ⛔ 别在这里另写一套「新键 → 预填」的回落链，两份回落链迟早会不一致。
     * 🔴 子分类那一格：`cardFieldsByKind[kind]` 缺失 ⇒ 回落 `cardFieldsByType.book`
     *    （= `resolveCardFieldsByType` 算出来的书籍那一份，零迁移）。
     */
    private currentCardFields(): CardFieldKey[] {
        const byType = resolveCardFieldsByType(this.plugin.settings.cardFieldsByType);
        const kind = this.cardFieldsSlotKind();
        if (!kind) return byType[this.cardFieldsSlotType()];
        const raw = (this.plugin.settings.cardFieldsByKind ?? {})[kind];
        // 有独立配置 ⇒ 按该类型的池子归一（⛔ 不直接用原数组：可能是手改 data.json 留下的脏值）
        return raw === undefined ? byType.book : normalizeCardFieldsForType('book', raw);
    }

    /** 预览卡 + 字段 chip 那一整块（#617 切类型时**整块重画**）。结构 / 口径见上方注释。 */
    private renderCardFieldsPanel(host: HTMLElement): void {
        host.empty();
        const slotType = this.cardFieldsSlotType();
        const slotKind = this.cardFieldsSlotKind();
        const entry = CARD_PREVIEW_ENTRIES[slotType];
        const wrap = host.createDiv({ cls: 'rl-cf-wrap' });

        // ── 左：卡片实况预览 ────────────────────────────────────────────────────
        const preview = wrap.createDiv({ cls: 'rl-cf-preview' });
        preview.createDiv({ cls: 'rl-cf-cap', text: '卡片预览' });
        const card = preview.createDiv({ cls: 'rl-pvw-card' });
        setIcon(card.createDiv({ cls: 'rl-pvw-cov' }), 'image');
        const meta = card.createDiv({ cls: 'rl-pvw-meta' });
        meta.createDiv({ cls: 'rl-pvw-ttl', text: entry.title });
        const rows = meta.createDiv({ cls: 'rl-pvw-rows' });

        // ── 右：信息栏字段 ──────────────────────────────────────────────────────
        const picker = wrap.createDiv({ cls: 'rl-cf-picker' });
        const head = picker.createDiv({ cls: 'rl-cf-head' });
        head.createDiv({ cls: 'rl-cf-cap', text: '信息栏字段' });
        const counter = head.createDiv({ cls: 'rl-cf-counter' });

        // 🔴 #640 ⑴：**已选**独立成区（可拖拽排序），与「未选」池子分开 ——
        //    原来选中/未选混在同一堆 chip 里，用户根本分不清「哪几行已经在卡上」，
        //    更没法说清「拖谁、往哪儿拖」。
        const selectedCap = picker.createDiv({ cls: 'rl-cf-subcap', text: '已选（拖动调整顺序）' });
        const selected = picker.createDiv({ cls: 'rl-cf-selected' });
        const poolCap = picker.createDiv({ cls: 'rl-cf-subcap', text: '未选' });
        const chips = picker.createDiv({ cls: 'rl-cf-chips' });
        picker.createDiv({
            cls: 'rl-cf-hint',
            text: `点选即加入卡片信息栏，至多 ${CARD_FIELD_LIMIT} 条；拖动已选标签调整先后，自动保存`,
        });

        const chipEls = new Map<CardFieldKey, HTMLButtonElement>();
        /** 正在拖的字段键（`dragstart` 记下、`drop` 取用） */
        let dragKey: CardFieldKey | null = null;

        /** 落盘：只写**当前那一格**（类型格写 `cardFieldsByType[type]`；子分类格写 `cardFieldsByKind[kind]`） */
        const commit = async (keys: CardFieldKey[]): Promise<void> => {
            if (slotKind) {
                this.plugin.settings.cardFieldsByKind = {
                    ...(this.plugin.settings.cardFieldsByKind ?? {}),
                    [slotKind]: keys,
                };
            } else {
                this.plugin.settings.cardFieldsByType = {
                    ...(this.plugin.settings.cardFieldsByType ?? {}),
                    [slotType]: keys,
                };
            }
            await this.plugin.saveSettings();
            // 🔴 #640 ⑶：落盘成功才点亮「已保存」（失败不该说已保存）
            this.flashCardFieldsToast();
            // 海报墙是已渲染的 Svelte 组件 ⇒ 落盘后必须主动刷视图，否则点了没反应
            this.plugin.refreshViews();
        };

        /** 把已选区 / chip 池 / 预览卡**一起**刷到与设置一致（三处必须同源，⛔ 别各刷各的） */
        const sync = (): void => {
            const cur = this.currentCardFields();
            counter.setText(`已选 ${cur.length} / ${CARD_FIELD_LIMIT}`);

            // ① 已选区：按配置数组的**真实顺序**渲染（数组顺序 = 卡片上的行序）
            selected.empty();
            if (cur.length === 0) {
                selected.createDiv({ cls: 'rl-cf-empty', text: '还没选任何字段' });
            }
            cur.forEach((key, i) => {
                const opt = cardFieldOptionsFor(slotType).find((o) => o.key === key);
                const el = selected.createDiv({
                    cls: 'rl-cf-sel',
                    attr: {
                        role: 'button',
                        tabindex: '0',
                        draggable: 'true',
                        'aria-label': `${opt?.label ?? key}，第 ${i + 1} 位；方向键可调整顺序`,
                    },
                });
                const grip = el.createSpan({ cls: 'rl-cf-grip' });
                safeSetIcon(grip, 'grip-vertical');
                el.createSpan({ cls: 'rl-cf-sel-label', text: opt?.label ?? key });
                // 移除：点右侧那个 ✕（⛔ 不做成「点整块即移除」—— 那会与拖拽抢手势）
                const x = el.createEl('button', {
                    cls: 'rl-cf-sel-x',
                    attr: { type: 'button', 'aria-label': `移除「${opt?.label ?? key}」` },
                });
                safeSetIcon(x, 'x');
                x.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    void commit(cur.filter((k) => k !== key)).then(sync);
                });

                el.addEventListener('dragstart', (ev) => {
                    dragKey = key;
                    el.addClass('is-dragging');
                    ev.dataTransfer?.setData('text/plain', key);
                });
                el.addEventListener('dragend', () => {
                    dragKey = null;
                    el.removeClass('is-dragging');
                });
                el.addEventListener('dragover', (ev) => {
                    ev.preventDefault();
                    el.addClass('is-over');
                });
                el.addEventListener('dragleave', () => el.removeClass('is-over'));
                el.addEventListener('drop', (ev) => {
                    ev.preventDefault();
                    el.removeClass('is-over');
                    if (!dragKey || dragKey === key) return;
                    const next = moveItem(cur.slice(), cur.indexOf(dragKey), cur.indexOf(key));
                    void commit(next).then(sync);
                    dragKey = null;
                });

                // 键盘等价物：拖拽是纯指针操作，键盘 / 读屏用户否则够不着（与属性顺序那组同口径）
                el.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
                    ev.preventDefault();
                    const to = ev.key === 'ArrowLeft' ? i - 1 : i + 1;
                    if (to < 0 || to >= cur.length) return;
                    const next = moveItem(cur.slice(), i, to);
                    void commit(next).then(() => {
                        sync();
                        // 重建后焦点会掉 ⇒ 放回**同一项**的新位置（否则连按第二下就没反应）
                        (selected.children[to] as HTMLElement | undefined)?.focus();
                    });
                });
            });

            // ② 池子：未选中的那些（已选的**不再重复出现**在池子里 —— 那正是用户说的「视觉浪费」）
            poolCap.toggleClass('is-hidden', cur.length >= CARD_FIELD_LIMIT);
            for (const [key, el] of chipEls) {
                const on = cur.includes(key);
                el.toggleClass('is-hidden', on);
                el.setAttribute('aria-pressed', on ? 'true' : 'false');
                // 🔴 到上限 ⇒ 未选中的置灰（让「不能再选」在**点之前**就看得见）
                el.disabled = !on && cur.length >= CARD_FIELD_LIMIT;
            }

            // ③ 预览卡的信息栏：按同一份配置逐行重画；一个都没选时留一行占位（⛔ 不留白块）
            rows.empty();
            for (const f of cur) {
                rows.createDiv({
                    cls: `rl-pvw-row ${previewRowClass(f)}`,
                    text: cardFieldValue(entry, f),
                });
            }
            if (cur.length === 0) rows.createDiv({ cls: 'rl-pvw-row rl-pvw-sub', text: '—' });
        };

        for (const opt of cardFieldOptionsFor(slotType)) {
            const btn = chips.createEl('button', { cls: 'rl-cf-chip', text: opt.label });
            btn.type = 'button';
            btn.setAttribute('aria-pressed', 'false');
            // 字段说明走 `data-tip`（本仓禁用 title 悬停提示，见 UI-GUIDE）
            btn.setAttribute('data-tip', opt.desc);
            chipEls.set(opt.key, btn);
            btn.addEventListener('click', () => {
                const cur = this.currentCardFields();
                const on = cur.includes(opt.key);
                // 双保险：UI 已经置灰，这里再拦一次（程序化调用绕不过去）
                if (!on && cur.length >= CARD_FIELD_LIMIT) return;
                // 🔴 #640 ⑴：**新加的排在末尾**（拖拽才能接着把它挪走）；
                //    移除后就地从数组里删 —— 其余项**保持既有先后**（⛔ 不按池子顺序重排，
                //    那样用户刚拖出来的顺序一点选就全乱了）。
                const next = on ? cur.filter((k) => k !== opt.key) : [...cur, opt.key];
                void commit(next).then(sync);
            });
        }
        void selectedCap;
        sync();
    }

    /**
     * 映射状态回执（成功 / 逐条错误）—— **#644 起「未配置」这一态不再单独占一行**。
     *
     * 三态落点：
     *   · **未配置**（`entries` 与 `errors` 都空）⇒ 状态折成 `help` 行前面的灰色小字，`el` **留空**
     *     （CSS `:empty` 把外距一起收掉 ⇒ 表格不会被一句「什么都没发生」往下推）；
     *   · **已生效** ⇒ `el` 里一行「N 条映射已生效」；
     *   · **有错** ⇒ `el` 里逐条错误（`is-bad` 保留：它是「别信那行成功回执」的样式钩子）。
     * ⚠️ 只动自己这两个容器的内容，不重建整页。
     */
    private renderFieldMapStatus(
        help: HTMLElement,
        helpText: string,
        el: HTMLElement,
        text: string,
    ): void {
        help.empty();
        el.empty();
        const { entries, errors } = parseFieldMap(text);
        if (errors.length) {
            // 有错时不折状态：把「未配置」的暗示收起来，避免与错误同时出现、让用户不知道信哪条
            help.createSpan({ text: helpText });
            el.toggleClass('is-bad', true);
            // 🔴 #651：错误要**被读屏听见**（`role="alert"` 比 `aria-live` 更可靠 —— 它是断言式播报）
            el.setAttribute('role', 'alert');
            for (const msg of errors) el.createDiv({ cls: 'rl-fieldmap-err', text: msg });
            return;
        }
        el.toggleClass('is-bad', false);
        el.removeAttribute('role');
        if (!entries.length) {
            // 未配置 ⇒ 状态折进说明行（前半句灰字 + 空格 + 原说明）
            const idle = help.createSpan({ cls: 'rl-fieldmap-idle', text: '未配置映射，按原始字段名写出。' });
            idle.setAttribute('aria-live', 'polite');
            help.createSpan({ text: helpText });
            return;
        }
        help.createSpan({ text: helpText });
        el.createDiv({ cls: 'rl-fieldmap-ok', text: `${entries.length} 条映射已生效` });
    }

    /**
     * 「基本设置」页（#354 合并三页）：**4 组 / 17 行**。
     *   ⚠️ 行数：#399 时点 2/3/3/2 → #425 数据与备份 +1 → **#541 外观与体验 +4**（导航布局 / 起始页 /
     *      卡片风格 / 界面动效）⇒ 现为 **8 / 3 / 4 / 2**。
     *
     * 🔴 分组是用户可见的层级，顺序即下表（用户 2026-09-21 要求「为基本设置页面设计合理的内部排版
     *    （建议按外观偏好、数据清理等小标题分组）」）：
     *      外观与体验 → 实验性功能 → 数据与备份 → 封面与清理
     *    ⚠️ 「实验性功能」这个词**保留为组名**（它承载"这些开关还不稳"的用户预期），只是从"页"降级成"组"。
     *    ⚠️ 组间**只用间距、⛔ 不画分割线**（D-6）：8 行里插 4 条线会把面板切碎，
     *       而分组标题本身已有足够强度（13px/600 + 图标）。
     * 🔴 三页合并**只改归属、不改任何一行设置项本身**（名字、描述、回调一律原样搬运）
     *    —— 免得读者以为"顺手优化"了什么。
     */
    private renderBasicPage(parent: HTMLElement): void {
        // 🔴 #553：三组传 `true` ⇒ 借**核心原生**的分组结构（`.setting-group` + `.setting-items`）。
        //    本页是唯一"组内没有自己的卡片"的一页 ⇒ 只有它适合直接套核心那套（另两页会卡中卡）。
        this.createGroupSection(parent, '外观与体验', (body) => this.renderAppearanceRows(body), true);
        // 🔴 #490（用户 2026-10-02）：本组标题下那句风险提示**已按用户要求删除** ——
        //    当时那个可选第 4 参（组级说明）**连同参数一起删除**（只有一个使用者 = 死码）。
        //    ⛔ 别再往回加；⚠️ 注释里刻意不抄那句原文（注释进产物，抄了会撞红自己的反向守卫）。
        //    ⚠️ 现在这个第 4 参是**另一个用途**（`nativeGroup`，见 `createGroupSection`），别跟当年那个混。
        //
        // 🔴🔴 #567（用户 2026-10-08）：「目前是这样的**一个卡片**里的，**分开**」。这一组**不传** `true`：
        //    核心给「**裸** `.setting-item`」的规则**本身就是一张卡**（真实 `app.css`：
        //    `.setting-item { background-color: var(--setting-items-background); border: …;
        //     border-radius: var(--setting-items-radius); padding: var(--size-4-4);
        //     margin-bottom: var(--size-4-2) }`），而套进 `.setting-group` 后它反被压成
        //    「组内平铺、无边框、只有发丝分隔线」（`.setting-group .setting-item:not(.setting-item-heading)`
        //    那条 —— #553 借的就是这个形态）。
        //    ⇒ **不套 = 三项各自一张卡 + 项间 8px 留缝**，正是用户要的「分开」，而且**零手写卡片样式**
        //      （⛔ 别再去写一套卡片：那就是 #541 手写分组卡 → #551 手写压制那条老账的第三次）。
        //    ⚠️ **组标题仍在**（`.rl-svc-group-title`），只是它后面不再跟着那张大卡。
        //    ⚠️ 那一版本组是**唯一**不套原生卡的一组（另三组的成员是普通设置行，套上才对）。
        //
        // 🔴🔴 2026-10-21 **翻面上面那条**（用户需求 3，逐字）：「实验性功能区域的背景色块样式
        //    必须与同级『外观与体验』『数据与备份』卡片背景**绝对一致**（统一卡片底色与边距）；
        //    折叠下拉容器可深色一点；其他样式不变」，并点明这是「**纠正之前的去背景逻辑**」。
        //    ⇒ 本组改回 `true`（借核心原生 `.setting-group` + `.setting-items`）：
        //      · 底色/圆角/边距全部由核心算 ⇒ 与另三组**同源同值**，我们一格都不手写
        //        （#541 手写卡 → #551 手写压制 → #567 不套卡，这条路上已经栽过三次）；
        //      · 于是 `styles.css` 里那两条「#655 去背景」与「水平内距归零」的规则**必须一并退场**
        //        （内距归零的初衷是"没有卡了别留卡的内衬"，卡回来后它会让文字贴到卡边）。
        //    ⚠️ 用户说的「折叠下拉容器可深色一点」指**展开后的子面板**，不是本组容器 ——
        //      子面板底色在 `styles.css` 的 `.rl-exp-panel.is-open` 上，见那里注释。
        this.createGroupSection(parent, '实验性功能', (body) => this.renderExperimentalRows(body), true);
        this.createGroupSection(parent, '数据与备份', (body) => this.renderDataBackupRows(body), true);
        this.createGroupSection(parent, '封面与清理', (body) => this.renderPosterCleanupRows(body), true);
    }

    /**
     * 「基本设置」页 · 第 1 组「外观与体验」（8 行）。
     *
     * 🔴🔴 **子项顺序（#596 用户点名重排，2026-10-10）**：导航布局 → 起始页 → 卡片风格 → 界面动效 →
     *    海报密度 → Ctrl + 滚轮缩放 → 隐藏插件内滚动条 → 笔记表格。
     *    ⚠️ 本次把「卡片风格 / 界面动效」提到多档设置的中段、把两处二元开关与「笔记表格」压到组尾
     *    （⛔ 别按「谁先做的」排 —— 断言按本组函数体里 `setName` 的**出现顺序**逐项钉住）。
     *
     * 🔴🔴 **#477 设置页描述总口径（设置页 17 条 `setDesc` 一体适用；#476 立、#477 收紧措辞）**：
     *    #476（用户 2026-10-02）立了「**用途式 + 每条 ≤ 15 字**」，这两条硬约束**本批沿用不变**；
     *    #477（同日）用户再给四条原则 —— **准确**（说明功能是什么）、**简洁**（避免废话）、
     *    **专业**（减少口语化）、**一致**，并点名撤掉上一轮的几处口语词（「附一张」「点亮」「没用的」「笔记里」）
     *    ⇒ 措辞标准收紧为：
     *    ⑴ 🔴 **准确优先** —— 落笔前先核实「这一项实际做什么」（本批两条用户建议因**与代码事实不符**被改写：
     *       「媒体库目录」不是只存媒体文件 —— 它装 `catalog.json` + `笔记/` + `封面/` + `备份/` + `阅读进度/`，
     *       而**音频在「音频文件目录」**；「附件清理」清的不是「缓存文件」而是**阅读存档**（弹窗里逐项就这么标））；
     *    ⑵ **去口语、去主观感受** —— ⛔ 不写「更清爽」「没用的」「附一张」这类说法，一律用**标准动作词**
     *       （插入 / 隐藏 / 显示 / 设置 / 存放 / 下载 / 保存 / 清理）；
     *    ⑶ **不重复标题** —— 描述要**补充信息**（「数据备份与恢复」写 `导出或导入 JSON 备份` 点出格式），
     *       ⛔ 不复述标题（用户原话：「原描述只是标题的复述」）；
     *    ⑷ **每条 ≤ 15 字**（含标点）照旧；
     *    ⑸ ⛔ **不写条件对偶句**（#470 的「启用则 X；关闭则 Y」已于 #476 退场）、⛔ 不写实现口径
     *       （「库内相对路径」「下载落点即此目录，不追加子目录」）；
     *    ⑹ 三条实验开关**统一「启用后…」句式**（用户 2026-10-02 裁定）。
     *    ⚠️ 顶掉的行为细节**不是丢信息** —— 各有兜底（换库不删原数据 → `ConfirmModal` 原文写着；
     *       「留空用下载/音乐」→ 输入框占位符；「不追加子目录」→ 提交后提示「将落到「X」文件夹」）。
     *    ⚠️ 断言与突变器按**本条口径**钉：成对锚（选项名 + 描述）+ 「17 条全 ≤ 15 字」量测 + 旧句式反向守卫。
     */
    private renderAppearanceRows(parent: HTMLDivElement): void {
        // 界面主题切换入口已删（1.0.3 全面 modern）：onload 强制 settings.uiTheme = "modern"。
        //
        // 🔴 #561（用户 2026-10-08：「把外观与体验下重构返回为**原生的开关项式和下拉框式**、
        //    标准布局（左文右控），如果副标题描述很长，文字换行时，开关应该依然保持在行的最右侧」）：
        //    本组控件**改回原生** —— 多档的走 `.addDropdown`、布尔的走 `.addToggle`。
        //    ⛔ 别再把那套「卡片式勾选」加回来（它的渲染方法 / 常量 / 样式类已随本批**整体删除**，
        //       本仓「死码不留」）—— 那三处引用点（本组 7 行）现在全是原生控件。
        //    ⚠️ 「左文右控 + 描述换行时控件仍贴最右」由 styles.css 的 `.rl-appearance-rows` 三条兜住
        //       （核心 `.setting-item` 本来就是 flex，但 `setting-item-info` 缺 `min-width: 0` 时
        //        长描述会把控件挤出容器；三条一起写才稳）。
        //  🔴🔴 #596 / #597（用户 2026-10-10 两条口径，后者顶掉前者那半）：
        //    本组控件形态按「值的性质」分两类 ——
        //      · **二元开关**（开 / 关）= `noteTable` / `hideScrollbars` / `ctrlWheelZoom` 三处 ⇒
        //        **原生滑动开关 `.addToggle`**（#596 先做成胶囊按钮组，**#597 用户改口**：
        //        「把这三处的文字分段控件改成滑动开关」⇒ 那套分段控制器的**渲染方法 / 文案常量 / 样式类**
        //        已随本批**整体删除**，本仓「死码不留」；⛔ 别再加回来）；
        //        三处**缺省一律关闭**（口径由 #596 立，本批不动）。
        //      · **多档选择**（≥2 档且互不包含）= 导航布局 / 起始页 / 卡片风格 / 界面动效 / 海报密度 五处 ⇒
        //        **原生下拉框**（`.addDropdown`）。
        //    ⛔ 别把那套「卡片式勾选」（#546）加回来 —— 它的渲染方法与样式类早已整体删除。
        //    ⚠️ 「左文右控 + 描述换行时控件仍贴最右」由 styles.css 的 `.rl-appearance-rows` 三条兜住
        //       （核心 `.setting-item` 本来就是 flex，但 `setting-item-info` 缺 `min-width: 0` 时
        //        长描述会把控件挤出容器；三条一起写才稳）。
        //    🔴 **行序（8 行，见方法上方那条）**：导航布局 → 起始页 → 卡片风格 → 界面动效 → 海报密度 →
        //       **Ctrl + 滚轮缩放** → 隐藏插件内滚动条 → 笔记表格。
        //       ⚠️ 既有断言按 `setName` 的出现顺序钉着，⛔ 别顺手调。
        //       🔴 #574：原第 5 项「歌词逐字高亮」已**搬去「实验性功能 › 启用内置音乐播放器」折叠分组**
        //       （用户：「将『歌词逐字高亮』、『启用在线曲库』移入【启用内置音乐播放器】折叠分组下」）。
        //    🔴 选项与文案仍**全部来自 pure 模块**（`NAV_LAYOUT_LABELS` / `homeTabLabel` /
        //       `POSTER_DENSITY_LABELS` / `CARD_STYLE_LABELS` / `MOTION_MODE_LABELS`），
        //       ⛔ 不在这里手写第二份。
        //    🔴 #477 描述四原则（准确 / 简洁 / 专业 / 一致 + ≤15 字）继续适用，本批把长描述**再收一档**
        //       （去掉「设置…」这类引言，直接说这一项管什么）。

        // 标记本组：控件列贴最右 + 描述换行不挤控件（见 styles.css `.rl-appearance-rows`）
        parent.addClass('rl-appearance-rows');

        // ── ① 导航布局（🔴 #541 新增，2026-10-07）──
        //  决定**主视图一级导航排在哪**；这是**结构分支**（改完必须 `syncNavLayout()` 即时重推，
        //  ⛔ 不能只落盘「等下次刷新」—— 用户当场看不到变化就会当成「点了没反应」）。
        //  🔴 #596（用户 2026-10-10）：**由分段控制器改回下拉框式**（用户点名「改回下拉框式」）。
        //    选项与文案仍**一律取自 `pure/navLayout`**，⛔ 不在这里手写第二份。
        new Setting(parent)
            .setName('导航布局').setDesc('主导航的排列方式')
            .addDropdown((d) => {
                for (const k of NAV_LAYOUTS) d.addOption(k, NAV_LAYOUT_LABELS[k]);
                d.setValue(normalizeNavLayout(this.plugin.settings.navLayout)).onChange(async (key) => {
                    this.plugin.settings.navLayout = normalizeNavLayout(key);
                    await this.plugin.saveSettings();
                    this.plugin.syncNavLayout();
                });
            });

        // ── ② 起始页（🔴 #541 新增；#596 仍是第 2 行）──
        //  缺省 `media` = `plugin.homeTab` 的历史初值 ⇒ 不选它就跟旧版一样。
        //  🔴 #591 起**一直保留原生下拉框**（用户：「起始页：保留原生的下拉框，因为选项较多，下拉框更合适」）；
        //     #596 之后本组有 **5 处**下拉（本行 + 导航布局 / 卡片风格 / 界面动效 / 海报密度）。
        new Setting(parent)
            .setName('起始页').setDesc('打开顶部胶囊/文字菜单视图时的默认页签')
            .addDropdown((d) => {
                for (const t of HOME_TAB_ORDER) d.addOption(t, homeTabLabel(t));
                d.setValue(normalizeStartTab(this.plugin.settings.startTab)).onChange(async (key) => {
                    this.plugin.settings.startTab = normalizeStartTab(key);
                    await this.plugin.saveSettings();
                    this.plugin.syncStartTab();
                });
            });

        // ── ③ 卡片风格（🔴 #541 新增；#596 由组尾递补到第 3 行）──
        //  只作用于**封面卡片**（`.rl-card` 的圆角与悬停阴影），⛔ 不动别的卡的通用圆角令牌。
        //  🔴 实现 = 挂 body 类覆写形态令牌（`pure/appearance.CARD_STYLE_CLASS`），
        //      样式在 styles.css 里必须排在 `.rl-theme-modern` **之后**才生效（同特异性靠顺序）。
        //  🔴 #596：分段控制器 → **下拉框**；选项与文案取自 `pure/appearance` 的标签表。
        new Setting(parent)
            .setName('卡片风格').setDesc('封面卡片的圆角与阴影')
            .addDropdown((d) => {
                for (const k of CARD_STYLES) d.addOption(k, CARD_STYLE_LABELS[k]);
                d.setValue(normalizeCardStyle(this.plugin.settings.cardStyle)).onChange(async (key) => {
                    this.plugin.settings.cardStyle = normalizeCardStyle(key);
                    await this.plugin.saveSettings();
                    this.plugin.applyAppearance();
                });
            });

        // ── ④ 界面动效（🔴 #541 新增；#596 由组尾递补到第 4 行）──
        // 「精简」= 过渡时长归零 + 悬停不上浮不放大（走 `--rl-t-dur*` / `--rl-t-lift` / `--rl-t-scale`）。
        //  ⚠️ 它管的是**令牌驱动**的那批动效；少数组件内的硬编码过渡不在其内 —— 那是刻意的：
        //     一刀切 `transition: none !important` 会连「加载中」这类**功能性**反馈一起杀掉。
        //  🔴 #596：分段控制器 → **下拉框**；两档文案仍取 `pure/appearance` 的 `MOTION_MODE_LABELS`
        //     （完整 / 精简）—— 用「开启 / 关闭」描述一个**档位**不够准确（关掉的是过渡与位移，不是这项功能）。
        new Setting(parent)
            .setName('界面动效').setDesc('界面过渡与缩放动画')
            .addDropdown((d) => {
                for (const k of MOTION_MODES) d.addOption(k, MOTION_MODE_LABELS[k]);
                d.setValue(normalizeMotionMode(this.plugin.settings.motionMode)).onChange(async (key) => {
                    this.plugin.settings.motionMode = normalizeMotionMode(key);
                    await this.plugin.saveSettings();
                    this.plugin.applyAppearance();
                });
            });

        // ── ⑤ 海报密度（用户 2026-09-22；#596 排到第 5 行）──
        // 三档 = 最小卡片宽度（紧凑 150 / 标准 180（历史值）/ 宽松 220），列数仍由容器宽度决定；
        // 「自定义列数」= 目标列数 + 最小卡片宽度保护（容器窄了自动减列）。纯逻辑见 pure/posterGrid。
        // 🔴 #596：分段控制器 → **下拉框**（用户点名）；「自定义列数」仍是其中一档，选中它才显出数字框。
        let colsInputEl: HTMLInputElement | null = null;
        let colsUnitEl: HTMLElement | null = null;
        const syncColsVisible = () => {
            const show = normalizePosterDensity(this.plugin.settings.posterDensity) === 'custom';
            const display = show ? '' : 'none';
            if (colsInputEl) colsInputEl.style.display = display;
            if (colsUnitEl) colsUnitEl.style.display = display;
        };
        // 🔴 #626 **desc 改词**：这一行配的是**共享**档位（卡片网格用它；海报墙没配过自己的列数时也用它）。
        //    #624 立了「同一个词只准指一个视图」—— 旧 desc 写「海报墙每行卡片密度」，
        //    而「海报墙」在 #624 之后**专指 `wall`**（那个视图有自己的列数行，见下）⇒ 旧 desc 会把两行读混。
        const densityRow = new Setting(parent)
            .setName('海报密度')
            .setDesc('卡片网格每行卡片密度');
        densityRow.addDropdown((d) => {
            for (const key of POSTER_DENSITIES) d.addOption(key, POSTER_DENSITY_LABELS[key]);
            d.setValue(normalizePosterDensity(this.plugin.settings.posterDensity)).onChange(async (value) => {
                this.plugin.settings.posterDensity = normalizePosterDensity(value);
                await this.plugin.saveSettings();
                syncColsVisible();
                this.plugin.syncPosterGrid();
            });
        });
        densityRow.addText((t) => {
                colsInputEl = t.inputEl;
                t.inputEl.type = 'number';
                t.inputEl.min = String(POSTER_COLUMNS_MIN);
                t.inputEl.max = String(POSTER_COLUMNS_MAX);
                t.inputEl.addClass('rl-poster-cols');
                t.setPlaceholder('如 6');
                t.setValue(String(normalizePosterColumns(this.plugin.settings.posterColumns)));
                colsUnitEl = document.createElement('span');
                colsUnitEl.addClass('rl-poster-cols-unit');
                colsUnitEl.setText('列');
                t.inputEl.insertAdjacentElement('afterend', colsUnitEl);
                t.onChange(async (value) => {
                    // ⚠️ 输入过程中**不回写**输入框（否则敲「12」会被第一位归一成的「1」打断），
                    // 只把归一值存进设置；失焦时再把归一结果显示回去（防「框里 99 / 实际 12 列」的错位）
                    this.plugin.settings.posterColumns = normalizePosterColumns(value);
                    await this.plugin.saveSettings();
                    this.plugin.syncPosterGrid();
                });
                t.inputEl.addEventListener('blur', () => {
                    if (!colsInputEl) return;
                    colsInputEl.value = String(normalizePosterColumns(colsInputEl.value));
                });
                syncColsVisible();
            });

        // ── ⑤-b 🔴 #626「海报墙列数」这一行**已删除**（用户 2026-10-20：「设置页里的海报墙列数项删除掉」）──
        // 随之一起下线的还有 `wallColumns` 这个设置键（schema 字段见 settings 类型里的注释）：
        // 「设置页看不见、脚本还记着」的键就是鬼开关 —— 墙现在恒跟随上面的「海报密度」。
        // ⛔ 别把这一行加回来：海报墙想要更密/更疏，改「海报密度」或 Ctrl+滚轮（都落到同一处真源）。

        // ── ⑥ Ctrl + 滚轮缩放（🔴 #591 新增）──
        //  在**媒体库视图**（海报墙 / 瀑布流）里按住 Ctrl 滚滚轮 = 放大 / 缩小内容区卡片：
        //  拦截系统默认缩放、步进列数并落成 `posterColumns` + `posterDensity = 'custom'`
        //  ⇒ 「海报密度」那一行**自动显示为「自定义列数」**（两者并存：下拉是预设、滚轮是微调）。
        //  🔴 **缺省关**（`!!settings.ctrlWheelZoom`）：它要接管一个系统级手势，⛔ 不默认改所有人的行为。
        //  🔴🔴 #597（用户 2026-10-10）：「把 Ctrl + 滚轮缩放、隐藏插件内滚动条、笔记表格的文字分段控件
        //     改成**滑动开关**」⇒ 这三处由「胶囊按钮组」改回**原生 `.addToggle`**。
        new Setting(parent)
            .setName('Ctrl + 滚轮缩放')
            .setDesc('按住 Ctrl 滚轮缩放卡片')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.ctrlWheelZoom).onChange(async (value) => {
                    this.plugin.settings.ctrlWheelZoom = value;
                    await this.plugin.saveSettings();
                    this.plugin.syncPosterGrid();
                }),
            );

        // ── ⑦ 隐藏插件内滚动条（#596 由第 4 行挪到第 7 行）──
        //  🔴 #597：**原生滑动开关**（#591 分段控制器 → #596 胶囊按钮组 → 本批定形为 `.addToggle`）。
        //     🔴 **默认关闭**（用户 #596 点名）⇒ 缺省值 `hideScrollbars: false` 不动。
        new Setting(parent)
            .setName('隐藏插件内滚动条')
            .setDesc('隐藏插件界面滚动条')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.hideScrollbars).onChange(async (value) => {
                    this.plugin.settings.hideScrollbars = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── ⑧ 笔记表格（#403 从「数据与备份」搬来；#411 进本组；#596 排到组尾）──
        //  管的是**笔记正文长什么样**（那张「| 属性 | 内容 |」表写不写），与「外观与体验」同类。
        //  #477：位置口径按**事实**写「笔记顶部」（`generateNoteMarkdown` 顺序 = 顶部块 → 属性表格 → …）。
        //  🔴🔴 #596（用户 2026-10-10）：「笔记表格」与另两处二元开关一起**默认关闭** ——
        //    读取口径由 `!== false`（缺省开）**翻面**成 `=== true`（缺省关；旧数据无此键 ⇒ 关）。
        //    ⚠️ **两处必须一起翻**（这里 + `main.ts` 构造 `EntryService` 那一句），漏一处就会出现
        //       「设置里显示关闭、生成的笔记里却仍有属性表」。⛔ 别再退回 `!== false`。
        //  ⚠️ 存储仍是同一个布尔 `noteTable`（⛔ 没有新字段、⛔ 不做数据迁移）。
        new Setting(parent)
            .setName('笔记表格')
            .setDesc('在笔记顶部插入属性表')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.noteTable === true).onChange(async (value) => {
                    this.plugin.settings.noteTable = value;
                    await this.plugin.saveSettings();
                }),
            );
    }

    /**
     * 「基本设置」页 · 第 2 组「实验性功能」（原「实验性功能」页那两行）。
     *
     * 🔴 2026-09-27 #399 三条**统一命名口径**（用户：「其上的也统一文案改成启用内置阅读器/视频播放器」）：
     *    一律 `启用内置<媒体>…`，与同组的「启用内置音乐播放器」并列读起来是同一族开关。
     *    ⛔ 别再退回旧的「打开…文件 / 笔记内…显示播放器」描述句式（产物的注释也让它们留在正文里，
     *    而断言要按 `setName("…")` 调用形态反查 ⇒ 旧句式回归时会把反向守卫撞绿）。
     * ⚠️ #476 本组三条 desc 已改成用途式；**#477 再收紧为统一「启用后…」句式**（用户 2026-10-02 裁定；
     *    他给的第一条示范就是「启用后可在插件内阅读电子书」）。⛔ #399 那套「启用则…；关闭则…」早已退场，
     *    ⛔ 也别退回无主语的纯动词短语（三条必须同形）。
     */
    private renderExperimentalRows(parent: HTMLDivElement): void {
        // 🔴 #562（用户 2026-10-08）：「采用**可折叠的分组**设计，将每个设置项收起为摘要行，点击后展开详情」
        //    —— 三枚「启用内置…」各自变成一整行摘要（**左侧名称 / 右侧开关 + 箭头**），
        //    它管的那批**分类目录**收进子面板。⛔ 开关与展开是两个独立动作（见 `makeCollapsible`）。
        //    ⚠️ 三行的 `setName` **必须仍在本方法体内**（#399 钉了「恰 3 条、顺序 阅读→视频→音乐」），
        //      所以折叠装饰走 `makeCollapsible(setting, …)`，⛔ 别把标题挪进助手函数的参数里。
        //
        // 🔴 #567：本组**不套核心原生分组卡**（见 `renderBasicPage` 那条注释）⇒ 三行各自是一张
        //    「裸 `.setting-item`」= 一张卡。标记本组容器只为**把项间留缝钉成一条**：
        //    核心给卡的是 `margin-bottom: var(--size-4-2)`（8px），而组容器自带 `gap: 6px`
        //    ⇒ 两者会叠成 14px 且与其它组不一致 ⇒ 这里统一成「gap 8px + 行 margin 0」。
        // 🔴 #574（用户 2026-10-08）：**#567 的「三项各自成卡」改写为「无缝列表组」** ——
        //    「由独立卡片式改为无缝列表组。去掉投影和较大圆角，改为底部分割线（如 iOS 设置列表）」。
        //    ⇒ 容器 `.rl-exp-list` **自己就是那张卡**（小圆角 / 无投影 / hairline 描边），
        //      `gap` 归 0、行拍平成透明 + `padding: 9px 14px`、行与行之间只留一条**上分割线**
        //      （`> .rl-exp-row:not(:first-child)`，⛔ 不用 `border-bottom`：子面板会插在行与行之间，
        //        `:last-child` 判不准）。摘要按钮上那个「框」也随之拍平（`border/padding` 归零）。
        //    ⚠️ 于是 `.rl-exp-list` 上「gap 8px + margin 0」那条旧口径**作废**（现在 gap 0）。
        // 🔴 2026-10-21（用户需求 3）：本组**改回套核心原生分组卡**（见 `renderBasicPage`），
        //    所以上面 #567/#574 那两段「不套卡 / 容器自己就是那张卡」的形态**都已作废**；
        //    容器类名保留只为挂钩两件事：容器内 `gap: 0` 与行间分割线（用户说「其他样式不变」）。
        //    ⛔ 但**行内距/外边距一律不再自己写** —— 那两格的语义现在是「与另三组逐值一致」，
        //       唯一正确做法是交给核心（同一套 DOM 链 ⇒ 同一套规则），见 `styles.css` 对应注释。
        parent.addClass('rl-exp-list');
        const reader = new Setting(parent)
            .setName('启用内置阅读器')
            // 🔴 #640（1.4.0，用户点名）：副标题改成**能力式**说明 —— 原文「启用后可在插件内阅读电子书」
            //    把范围限死在「电子书」，而这条开关实际管的是书籍与漫画的**全部**内置阅读能力
            //    （EPUB / TXT / PDF / 图片文件夹 / CBZ·CBT），文案与行为对不上。
            .setDesc('在插件内阅读书籍文件（电子书、漫画）');
        this.makeCollapsible(
            reader,
            parent,
            !!this.plugin.settings.internalBookReader,
            async (value) => {
                this.plugin.settings.internalBookReader = value;
                await this.plugin.saveSettings();
            },
            (panel) => {
                for (const k of LOCAL_DIR_GROUPS.reader) this.createLocalDirRow(panel, k);
                // 🔴 #639 ⑥：**原来这里有一行「从微信读书同步书架」** —— 用户要求把同步入口
                //    「放在微信读书凭据下拉处」⇒ 已搬到 `createApiKeyRow` 的 weread 分支
                //    （入口只此一处，⛔ 别两处都留：同一功能两个入口，用户会以为哪一处是坏掉的备份）。
                // 🔴🔴 #689（用户 2026-10-19 裁定）：「设置页-基本设置**去掉漫画阅读模式的选择**，
                //    只由**漫画阅读器内**设置调整」。
                //    ⇒ 这里原本调的 `renderComicReaderRows(panel)`（「漫画阅读方式」下拉）**已整体移除**，
                //       阅读方式现在只在漫画阅读器内部切换（顶栏那枚按钮，状态仍落 `comicViewMode`）。
                //    ⚠️ 沿用 #669 立的同一条口径：**同一功能只留一个入口** —— 两个入口会让用户以为
                //       哪一处是坏掉的备份。⛔ 别再把下拉搬回来。
            },
        );

        const video = new Setting(parent)
            .setName('启用内置视频播放器')
            // #477：用户「『影视』用词偏娱乐化，『视频文件』更标准」⇒ 改标准词
            // 🔴 #640（1.4.0，用户点名）：去掉「启用后」这个条件从句 —— 三条副标题统一成
            //    「在插件内做某事」的能力句，与阅读器那条逐字同构（设置页里三条并排读起来才整齐）。
            .setDesc('在插件内播放视频文件');
        this.makeCollapsible(
            video,
            parent,
            !!this.plugin.settings.internalMediaPlayback,
            async (value) => {
                this.plugin.settings.internalMediaPlayback = value;
                await this.plugin.saveSettings();
            },
            (panel) => {
                for (const k of LOCAL_DIR_GROUPS.video) this.createLocalDirRow(panel, k);
                // 🔴 #605（用户 2026-10-11）：「把播放设置弹窗里的『后台播放』移到 设置页 › 内置播放器
                //    折叠分组下」—— 它是**全局设置**，不该占播放器快捷面板。样式保持「标题 + 副标题 + 开关」。
                //    ⚠️ 与前两个目录行同为**折叠面板内**的行（`panel`，⛔ 不是组容器）。
                //    ⚠️ 仍**单独一个方法**：本方法体内 `setName` 被 #399 钉成**恰 3 条**（阅读→视频→音乐），
                //      塞进来会当场撞红那条判据（#562/#574 同款理由）。
                this.renderBgPlayRow(panel);
            },
        );

        // ④-4 音频播放器 + ⑤-c 歌曲下载的**唯一门控**（#399 起）：笔记里的 ` ```lrc ` 块是否就地渲染成播放器，
        // 以及音乐编辑表单是否给「下载」按钮 —— 两件事共用一个开关，⛔ 别再拆回两个。
        // 🔴 默认关（D-8(c)）：LyricFlux 注册了同名块处理器，两插件同时开会打架；
        //    且默认关能保证「升级后笔记外观不变」。开启后若检测到 LyricFlux 仍启用，本插件依然让位。
        const music = new Setting(parent)
            .setName('启用内置音乐播放器')
            // #477：用户「『笔记里』表达不准确（播放器可能是全局的）」⇒ 去掉地点限定，只说能力。
            //   ⚠️ 「下载」这半个功能必须留着（门控的另一半 = 音乐表单的「下载」按钮），只是不再写「下载到哪」。
            // 🔴 #640（1.4.0，用户点名）：副标题改「在插件内播放音频文件」—— 与前两条同句式。
            //   ⚠️ 与视频那条**刻意差一个字**（音频 / 视频），⛔ 别为了整齐把两条写成同一句
            //      （那会让断言锚「两条必须不同」失效，也真的描述错了）。
            .setDesc('在插件内播放音频文件');
        this.makeCollapsible(
            music,
            parent,
            !!this.plugin.settings.audioInlinePlayer,
            async (value) => {
                this.plugin.settings.audioInlinePlayer = value;
                await this.plugin.saveSettings();
            },
            (panel) => {
                // 🔴 #562：**「音频文件目录」整行从「数据与备份」搬到这里**（用户：「把音乐路径目录放在
                //    启用内置音乐播放器折叠分组下」）。⛔ 不是新建一个「音乐目录」设置 —— 它就是同一个
                //    `musicDownloadDir`，只是换了个摆放位置（两份设置必然打架，见 `pure/localDirs` 模块头）。
                //    ⚠️ 因此这里仍走 `createLibraryDirRow`（下载根口径：归一 / 校验 / 「将落到 X」提示都在它里面），
                //      ⛔ 别改用下面那个 `createLocalDirRow`（那是「本地检索根目录」口径，不做下载根归一）。
                this.createLibraryDirRow(
                    panel,
                    '音频文件目录',
                    '音频下载的存放与检索目录',
                    () => this.plugin.settings.musicDownloadDir,
                    async (next) => {
                        this.plugin.settings.musicDownloadDir = next;
                        await this.plugin.saveSettings();
                    },
                    'dl',
                    'music',
                );
                // 🔴 #574（用户 2026-10-08）：「将『歌词逐字高亮』、『启用在线曲库』移入
                //    【启用内置音乐播放器】折叠分组下」—— 两项都只作用于**音乐那一面**
                //    （逐字高亮 = 内置音频播放器的歌词栏；在线曲库 = 音乐检索要不要打四个平台），
                //    放进这个能力开关下才读得通。
                //    ⚠️ 两者各自**单独一个方法**：本方法体内 `setName` 被 #399 钉成**恰 3 条**
                //       （阅读 → 视频 → 音乐），塞进来会当场撞红那条判据（#562 同款理由）。
                //    ⚠️ ⛔ 别再在「外观与体验」组里留一份 —— 同一个设置字段只许一个输入框/开关。
                this.renderLyricsWordRow(panel);
                this.renderSongLibraryRow(panel);
            },
        );
    }

    /**
     * #562 把一行设置**变成可折叠分组的摘要行**（用户 2026-10-08 参考 obsidian-agent-client 的设计）；
     * **#564 按参考实现重写内核**（`renderCollapsibleAgentSection`，本地参考仓库 `obsidian-agent-client-master`）。
     *
     * 🔴 #564 改了什么、为什么（用户原话：「参考 …代码**再实现**设置页可折叠分组」）：
     *    旧版把展开判定挂在**整行**上，再用「点在核心开关宿主里就提前 return」把开关那一下排除掉。
     *    参考实现的做法更硬：**摘要行 = 一个真实 `<button>`**（里面是名称 + 说明两个 span），
     *    **开关是它的兄弟节点**（在 `controlEl` 里，不在按钮内部）——
     *      ⑴ 键盘可用：Tab 能聚焦、Enter / Space 展开（旧版挂在 `div` 上，键盘用户压根碰不到）；
     *      ⑵ `aria-expanded` / `aria-controls` 落在**按钮**上，语义正确；
     *      ⑶ **开关的点击根本到不了展开处理器**（两个不同子树）⇒ 那条「排除开关」的守卫可以**整条删掉**。
     *    ⚠️ 参考代码的原话：交互内容不能嵌在 `button` 里（内容模型不合法），而作为**兄弟**时它的点击
     *    传不到折叠处理器 —— 这正是旧版那条守卫在手动模拟的事，现在由**结构本身**保证（守卫是补丁，结构是解药）。
     * 🔴 #565（用户上手截图 ③「设置页组可折叠项要这个界面效果」）：**箭头从「control 里的第二枚按钮」
     *    改成摘要按钮内部的尾随 `span`** —— 参考实现里这一行**本身就是一个带边框的框**（像一枚输入框），
     *    箭头在框的**右缘内侧**、开关挂在框的**外面**。这样改还顺带少一个按钮：
     *    点箭头冒泡到同一个处理器，⛔ 不再有两份 `aria-expanded` 要同步。
     * 🔴 展开态存 `expandedGroups`（实例字段）⇒ 整页重建后仍在；缺省收起。
     * 🔴 箭头用 `chevron-right` + CSS **旋转**（参考实现同样是 `rotate(90deg)` + 过渡）；
     *    ⛔ 不换图标名 —— 换名会让「旋转」变成瞬间替换、看着像闪一下。
     *
     * 🔴🔴 #567（用户 2026-10-08 第三次改这一块）三条一起落：
     *    ⑴ **说明（小标题）整体去掉**（用户原话：「把小标题去掉不要了，如『启用后播放本地视频文件』」）
     *       ⇒ 摘要框里只剩**名称**一个 span。⚠️ 核心那两个节点仍要**移除**（`descEl.remove()`）——
     *          留着它，核心会把它按自己的排版再画一遍（位置还不受我们控制）。
     *       ⇒ `.rl-exp-text` 这一层**保留**（框内左列容器，`space-between` 的两列布局靠它），
     *          只是列内现在只有一行字；⛔ 别为了少一层而把名称直接挂到按钮上（旧锚会漂、也不省事）。
     *       🔴🔴 **#640（1.4.0）翻面本条 ⑴：说明加回来了** —— 用户上手报「阅读器等那几条副标题没显示」，
     *          而 #640 主批刚按用户给的逐字文案给三条开关加了 `setDesc`。
     *          两批口径**直接冲突**（#567 删、#640 要），以**最新指令**为准 ⇒ 现在把 desc 文本
     *          **搬进** `.rl-exp-text` 的左列（那个容器本来就是两行用的），再删核心节点。
     *          ⚠️ 这正是「光改 `setDesc` 字面量不够」的典型：删除点在**另一个方法**里，
     *            改字面量 + 断言全绿，**界面依然一个字都不显示**（与 Steam 凭据行同族的静默失效）。
     *    ⑵ 🔴 **`aria-label` 撤掉**（本条是顺手修的真 bug）：它和 `data-tip` 挂在**同一个元素**上 ⇒
     *       Obsidian 对带 `aria-label` 的悬停目标**自绘官方气泡**，与插件那条 `data-tip` **叠成两层**
     *       （UI-GUIDE §3 v3 明令：「`aria-label` 不放在带 `data-tip` 的元素或祖先链上」；
     *        同族踩过：`.rl-ro-meta`（#501）、EntryForm 那 13 处）。
     *       ⚠️ 读屏名**不受影响**：按钮里本来就有可见文字（名称），它天然就是可访问名。
     *    ⑶ 摘要框的白底由 styles.css 那条**两级选择器**兜住（核心 `button:not(.clickable-icon)` 的灰底
     *       是 (0,1,1)，单类压不过 —— 见 styles.css 里 `.rl-exp-row .rl-exp-head` 那段）。
     * ⚠️ 名称的文本从核心的 `.setting-item-name` **搬进**按钮，核心那个节点随后被替换掉
     *    （外观由 `.rl-exp-name` 接管，⛔ 别两套都留着）。
     */
    private makeCollapsible(
        setting: Setting,
        parent: HTMLElement,
        on: boolean,
        onToggle: (value: boolean) => Promise<void>,
        renderPanel: (panel: HTMLDivElement) => void,
    ): void {
        const key = setting.nameEl.textContent ?? '';
        setting.settingEl.addClass('rl-exp-row');
        setting.addToggle((t) => t.setValue(on).onChange((value) => void onToggle(value)));

        // 面板先建 —— 按钮的 `aria-controls` 要指向它（id 由标题派生，稳定，重建后不变）
        const panelId = `rl-exp-panel-${key.replace(/[^\w\u4e00-\u9fa5-]+/g, '-')}`;
        const panel = parent.createDiv({ cls: 'rl-exp-panel' });
        panel.id = panelId;
        renderPanel(panel);

        // 摘要 = **一个框**（真实 <button>）：框内左「名称」、框内右「箭头」；开关在**框外**
        //  🔴 #565（用户上手截图 ③）：参考实现里这一行**本身是个带边框的框**（像一枚输入框），
        //     箭头在框的**右缘内侧**，开关挂在框的**外面**（右侧）。
        //     ⇒ 箭头从「control 里的第二枚按钮」改成**摘要按钮内部的尾随 span**：
        //       ⑴ 视觉与参考一致（箭头在框内右端，`justify-content: space-between` 顶到最右）；
        //       ⑵ 少一个按钮 —— 点箭头冒泡到同一个处理器，⛔ 不再有两份 aria-expanded 要同步。
        //  🔴 #567：说明那行**整体去掉**（用户：「把小标题去掉不要了」）⇒ 框内只剩名称；
        //     同时撤掉 `aria-label`（与 `data-tip` 同元素 = Obsidian 官方气泡 + 自绘气泡叠两层，
        //     见本方法顶部注释 ⑵）。按钮里的可见名称本身就是可访问名。
        const head = document.createElement('button');
        head.addClass('rl-exp-head');
        head.type = 'button';
        head.setAttribute('aria-expanded', 'false');
        head.setAttribute('aria-controls', panelId);
        head.setAttribute('data-tip', '展开/收起');
        const text = head.createSpan({ cls: 'rl-exp-text' });
        text.createSpan({ cls: 'rl-exp-name', text: key });
        // 🔴🔴 #640（1.4.0）**翻面 #567 ⑴**：把副标题**加回来**（用户：「阅读器等那几条副标题没显示」）。
        //    #567（2026-10-08）当时的口径是「把小标题去掉不要了，如『启用后播放本地视频文件』」⇒
        //    这里原本是 `setting.descEl.remove()`，把 `setDesc` 写的那行**整个删掉**。
        //    而 #640 用户又要求三条实验开关**要有**副标题（给了逐字文案）——
        //    光改 `setDesc` 的字面量是不够的：**这一行会把它删掉**，界面永远不显示
        //    （tsc / 构建 / 断言全绿，只有用户看得见 —— 与 Steam 凭据行那次同族的「静默不显示」）。
        //    ⇒ 改为**把核心那行 desc 的文本搬进摘要框的左列**（`.rl-exp-text` 本来就是
        //      `flex-direction: column` 的两行容器，见 styles.css），然后删掉核心节点
        //      （⛔ 不能留着：核心会按自己的排版再画一遍，位置不受我们控制）。
        //    ⚠️ 没有 desc 时**不建那个 span**（⛔ 别留一个空节点 —— `.rl-exp-text` 的 `gap: 2px`
        //      会在名称下面白留 2px，看着像没对齐）。
        const descText = setting.descEl.textContent?.trim() ?? '';
        if (descText) text.createSpan({ cls: 'rl-exp-desc', text: descText });
        const chev = head.createSpan({ cls: 'rl-exp-chev' });
        safeSetIcon(chev, 'chevron-right');
        setting.nameEl.replaceWith(head);
        setting.descEl.remove();

        const sync = (): void => {
            const open = this.expandedGroups.has(key);
            panel.toggleClass('is-open', open);
            setting.settingEl.toggleClass('is-open', open);
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
        };
        const flip = (): void => {
            if (this.expandedGroups.has(key)) this.expandedGroups.delete(key);
            else this.expandedGroups.add(key);
            sync();
        };
        head.addEventListener('click', flip);
        sync();
    }

    /**
     * #562 「分类本地目录」一行（**本地检索根目录**口径，与 `createLibraryDirRow` 的**下载根**口径不同）。
     *
     * 🔴 为什么另起一个工厂而不是复用 `createLibraryDirRow`：
     *    那个走 `pure/downloadPlan` 的「下载根」归一（缺省兜底 `下载/音乐`、把「下载」补成类型子目录），
     *    而本地目录**允许留空**（= 未配置 ⇒ 让「单集本地检索」提示去配置），且**允许绝对路径**
     *    （媒体常放在 vault 之外，拼库内相对路径会得到一个扫描不到的位置）。
     * ⚠️ 音乐那一档**不走这里**（它是同一个 `musicDownloadDir`，仍走下载根口径那条，见调用点）。
     * 提交时机与其它目录项一致：**失焦 / 回车**（⛔ 别改成 onChange，打字中途会连续写盘 + 连续重扫）。
     */
    private createLocalDirRow(parent: HTMLElement, key: LocalDirKey): void {
        const field = LOCAL_DIR_FIELD[key];
        const row = new Setting(parent).setName(LOCAL_DIR_LABELS[key]).setDesc('本地文件检索的根目录');
        // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑥）：这一行的输入框宽度不受控（换行 / 溢出都见过），
        //    给整行挂一个钩子类，宽度规则**统一写在 `styles.css`** —— ⛔ 别在这里写内联 width
        //    （内联会盖掉主题与 CSS 的收敛规则，之后想改就得回来动 TS）。
        row.settingEl.addClass('rl-dir-row');
        // 🔴 2026-10-25 用户指令：这一行的状态提示（未配置时的「未配置 — 单集本地检索不可用」与
        //    配置后的「检索目录：…」）**两条都去掉** —— 输入框里已经是当前值，再复述一遍纯属噪音。
        //    ⛔ 别把 `rl-hint-note` 加回来；「没配目录 ⇒ 本地检索不可用」由检索动作当场给 Notice 承担。
        this.localDirSuggests.get(key)?.close();
        this.localDirSuggests.set(key, null);
        row.addText((text) => {
            text.setPlaceholder('库内路径，或系统绝对路径').setValue(localDirOf(this.plugin.settings, key));
            const commit = async (): Promise<void> => {
                const next = text.getValue().trim();
                (this.plugin.settings as unknown as Record<string, unknown>)[field] = next;
                await this.plugin.saveSettings();
                text.setValue(next); // 失焦回显去空白后的值
            };
            text.inputEl.addEventListener('blur', () => void commit());
            text.inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    void commit();
                }
            });
            const folders = folderCandidates(this.app);
            const fromPick = (folder: TFolder): void => {
                text.setValue(folder.path);
                void commit();
            };
            const inst = attachFolderInputSuggest(this.app, text.inputEl, folders, fromPick);
            this.localDirSuggests.set(key, inst);
            if (!inst) {
                row.addButton((b) =>
                    b.setButtonText('浏览').onClick(() => {
                        new VaultFolderSuggest(this.app, folders, fromPick).open();
                    }),
                );
            }
        });
    }


    /**
     * 🔴 #639 ⑥：**`createWereadShelfRow` 整体删除**（用户：「将微信读书同步入库的项放在微信读书凭据下拉处」）。
     *
     * 原落点是「基本设置 › 启用内置阅读器」折叠组里的一整行（#581 用户 2026-10-09 亲自点的位置）——
     * 本轮用户改判，把它搬到**微信读书凭据行**内（`createApiKeyRow` 的 weread 分支 →
     * `renderWereadSyncButton`）：与 Steam 的「立即同步」**同款同位置**，两个按钮样式统一。
     *
     * ⛔ **别把这一行加回来**：同一个功能两个入口，用户会以为哪一处是坏掉的备份
     *    （本仓在「同一概念只准一份文案 / 一个入口」上栽过多次）。
     * ⚠️ 弹窗本身（`WereadShelfSyncModal`）与宿主方法 `openWereadShelfSync` **都没动** ——
     *    搬的只是**入口那一行**。
     */

    /**
     * #406 音乐「歌词逐字高亮」开关（🔴 #574 从「外观与体验」**搬进**「启用内置音乐播放器」折叠分组）。
     *
     * 只影响**内置音频播放器**里那一列歌词：当前行按字逐个点亮（`.rl-ap-lyr-w.is-on`）。
     * 时间从哪来：LRC 自带 `<mm:ss.xx>` 就用精确值，没有则由 `pure/lrc.parseLrc` 按「到下一行」**均分**
     * ⇒ 用户说的「按时间均分」正是这条兜底。
     *
     * ⚠️ 读取口径 `!== false`（缺省开）；真源 `pure/lrc.wordIndexAt`。⛔ 别改成 `!!` ——
     *   旧数据里没有这个键，改成 `!!` 会让升级后歌词不再逐字高亮（等于悄悄换脸）。
     * ⚠️ 与 `renderSongLibraryRow` 同样是**独立方法**（理由见调用点注释）。
     */
    private renderLyricsWordRow(parent: HTMLDivElement): void {
        new Setting(parent)
            .setName('歌词逐字高亮').setDesc('歌词按字逐一高亮显示')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.lyricsWordHighlight !== false).onChange(async (v) => {
                    this.plugin.settings.lyricsWordHighlight = v;
                    await this.plugin.saveSettings();
                }),
            );
    }

    /**
     * #605 「后台播放」开关（用户 2026-10-11：「把播放设置弹窗里的『后台播放』项移到 设置页 › 内置播放器
     * 的折叠分组下。样式保持现在的『标题+副标题+Switch 开关』不变，因为它是全局设置，不应该占用播放器快捷面板」）。
     *
     * 语义：不可见（切走标签页 / 窗口最小化 / 不在视口）时**继续播放**，既不暂停、也不起「超时彻底释放」计时。
     * 字段照旧是 append-only 的 `playerBgPlay`（⛔ 不新建键）；写入方式与其它开关同款（直接写 + saveSettings）。
     * ⚠️ 与 `renderLyricsWordRow` / `renderSongLibraryRow` 同样是**独立方法**（理由见调用点注释）。
     * desc 沿用播放器弹窗里那条副标题，按 #477 口径 ≤ 15 字。
     */
    private renderBgPlayRow(parent: HTMLDivElement): void {
        new Setting(parent)
            .setName('后台播放')
            .setDesc('退出后继续播放音频')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.playerBgPlay === true).onChange(async (value) => {
                    this.plugin.settings.playerBgPlay = value;
                    await this.plugin.saveSettings();
                }),
            );
    }

    /**
     * 🔴🔴 #689（用户 2026-10-19 裁定）：「设置页-基本设置**去掉漫画阅读模式的选择**，
     *    只由**漫画阅读器内**设置调整」。
     *
     * ⇒ 原来这里那个 `renderComicReaderRows`（「漫画阅读方式」下拉）**已连同方法一起删除** ——
     *    调用点没了就是死码，本仓「死码不留」。阅读方式只在漫画阅读器内切换。
     *    ⚠️ `comicViewMode` 字段与 `pure/comicViewer` 的归一函数**照旧保留**（红线：字段只增不删），
     *       `ComicReaderModal` 仍在用。
     *    ⚠️ 沿用 #669 立的同一条口径：**同一功能只留一个入口** ——
     *       两个入口会让用户以为哪一处是坏掉的备份。⛔ 别再把下拉搬回来。
     */

    /**
     * #538 音乐「在线曲库」检索开关（用户 2026-10-05：「设置项可选择开启或关闭新增音乐条目『在线曲库』的搜索，
     * **默认关闭**」）。
     *
     * 🔴 #574：摆放位置从「实验性功能**组尾**」改为**音乐子面板内**（用户：「将『歌词逐字高亮』、
     *    『启用在线曲库』移入【启用内置音乐播放器】折叠分组下」）⇒ 接线处传的是 `panel` 而不是组容器。
     * ⚠️ 仍**单独一个方法**：`renderExperimentalRows` 组内 `setName` 被既有断言钉成**恰 3 条、顺序
     *    阅读→视频→音乐**（#399），⛔ 别把这一行并进那个方法体（会当场撞红那条判据）。
     *
     * 默认**关**：曲库检索要打四个平台，默认关能保证「升级后音乐检索结果与旧版一模一样」。
     * desc 走组内统一句式「启用后…」，且 ≤ 15 字（#477）。
     */
    private renderSongLibraryRow(parent: HTMLDivElement): void {
        new Setting(parent)
            .setName('启用在线曲库检索')
            .setDesc('启用后音乐检索含在线曲库')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.musicSongLibrary).onChange(async (value) => {
                    this.plugin.settings.musicSongLibrary = value;
                    await this.plugin.saveSettings();
                }),
            );
    }

    /** 「基本设置」页 · 第 3 组「数据与备份」（原「数据管理」页的前三段） */
    private renderDataBackupRows(parent: HTMLDivElement): void {
        // ① 媒体库目录（原「存储 → 库目录」，迁入数据管理）
        //   #380（用户 2026-09-23：「媒体库目录的根文件夹是否可以设置在库中文件夹下？做个自动搜索」）
        //   ⇒ **可以，而且这是唯一支持的方式** —— 全仓都按库内相对路径消费它
        //      （`normalizePath('{libraryDir}/…')`、`{libraryDir}/阅读进度/…`），默认值就是库内的 ReelLudic。
        //   本轮补三件：
        //     ⑴ 输入框**边打边提示**库内文件夹（`AbstractInputSuggest`；旧版本无该 API ⇒ 降级为「浏览」按钮）；
        //     ⑵ **失焦 / 回车才提交** —— 原来是 onChange 每敲一个字符就 `saveSettings`，
        //        打字过程中会**连续换库、连续建目录**（打「99-媒体库」会依次落到 9 / 99 / 99- …）；
        //     ⑶ 三个「静默换库」防坑：绝对路径（`D:\媒体库` 会被当成库内一个叫 `D:` 的文件夹 ⇒
        //        静默新建空库、看着像数据丢了）、`..` 段、非法字符一律当场拦下；目标文件夹不存在时**先确认**。
        this.folderSuggest?.close(); // 重渲染前先收掉上一次的浮层
        this.folderSuggest = null;
        const libRow = new Setting(parent)
            .setName('媒体库目录')
            // 🔴 #476 改用途式 → **#477 按事实修正**：用户建议「存放插件产生的媒体文件（如封面、音频）」
            //    **与代码不符** —— 本目录实际装的是 `catalog.json`（条目数据）+ `笔记/` + `封面/` + `备份/` +
            //    `报告/` + `阅读进度/`（阅读存档，见 `pure/dirs`），而**音频在「音频文件目录」**（另一项）。
            //    ⇒ 写作「存放插件的条目数据与笔记」（准确优先；⛔ 别退回「媒体文件」，那会与下面那项打架）。
            .setDesc('存放插件的条目数据与笔记');
        const libHint = libRow.descEl.createDiv({ cls: 'rl-hint-note' });
        const setLibHint = (msg: string, isError = false): void => {
            libHint.setText(msg);
            libHint.toggleClass('is-error', isError);
        };
        libRow.addText((text) => {
            text.setPlaceholder(DEFAULT_LIBRARY_DIR).setValue(this.plugin.settings.libraryDir);
            // 打字期间只做**即时校验提示**，⛔ 不落库（提交时机见下面的 blur / Enter）
            text.onChange((value) => {
                const issue = libraryDirIssue(value);
                setLibHint(issue ?? '', !!issue);
            });
            const commit = async (): Promise<void> => {
                const raw = text.getValue();
                const issue = libraryDirIssue(raw);
                if (issue) {
                    setLibHint(`${issue}（未生效，当前仍是「${this.plugin.settings.libraryDir}」）`, true);
                    return;
                }
                const next = normalizeLibraryDirInput(raw);
                if (sameLibraryDir(next, this.plugin.settings.libraryDir)) {
                    text.setValue(next); // 失焦回显归一化后的值（斜杠方向/前后斜杠的写法差异在此被吸收）
                    setLibHint('');
                    return;
                }
                const target = this.app.vault.getAbstractFileByPath(next);
                if (target && !(target instanceof TFolder)) {
                    setLibHint(`「${next}」已经是一个文件，不能当作媒体库目录`, true);
                    return;
                }
                if (!target) {
                    const prev = this.plugin.settings.libraryDir;
                    const ok = await new ConfirmModal(
                        this.app,
                        `文件夹「${next}」还不存在。继续将新建一个空库；当前库「${prev}」的数据仍留在原目录，不会被删除。`,
                        '仍要切换',
                    ).open();
                    if (!ok) {
                        text.setValue(prev); // 取消 → 回滚显示为当前生效值
                        setLibHint('');
                        return;
                    }
                }
                this.plugin.settings.libraryDir = next;
                await this.plugin.saveSettings();
                await this.plugin.refreshHomeTabTitles();
                text.setValue(next);
                setLibHint(`已切换到「${next}」`);
            };
            // 提交时机：**失焦 / 回车**。⛔ 别改回 onChange —— 那会在打字中途连续换库。
            text.inputEl.addEventListener('blur', () => void commit());
            text.inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    void commit();
                }
            });
            // 边打边提示（旧版本该 API 不存在 ⇒ `null`，此时补一个「浏览」按钮走模糊搜索弹层）
            const folders = folderCandidates(this.app);
            const fromPick = (folder: TFolder): void => {
                text.setValue(folder.path);
                void commit();
            };
            this.folderSuggest = attachFolderInputSuggest(this.app, text.inputEl, folders, fromPick);
            if (!this.folderSuggest) {
                libRow.addButton((b) =>
                    b.setButtonText('浏览').onClick(() => {
                        new VaultFolderSuggest(this.app, folders, fromPick).open();
                    }),
                );
            }
        });

        // ①.4 音频文件目录 / ①.5 书籍文件目录（#403 建立；**#425 改名 + 拆出书籍那一项**）
        //  用户 2026-09-29：「音乐下载路径目录项再加个书籍下载路径目录，再改名称『音频文件目录』
        //  和『书籍文件目录』（作用为下载和检索功能）」。
        //  🔴 两行**共用同一个工厂** `createLibraryDirRow` —— 校验 / 提交时机（失焦 · 回车）/ 库内
        //     自动补全三件事必须逐项一致，⛔ 别复制一份出来改（改一处忘一处是这类设置项最常见的事故）。
        // 🔴 #562：原「音频文件目录」那一行**已搬到「实验性功能 › 启用内置音乐播放器」折叠分组下**
        //    （用户 2026-10-08：「把音乐路径目录放在启用内置音乐播放器折叠分组下」）。
        //    ⛔ 别在本组再渲染一份 —— 同一个 `musicDownloadDir` 出现两个输入框，改哪个都只影响一半心智。
        // ② 数据备份与恢复（合并原「导出备份」+「从备份恢复」；桌面端走系统文件对话框，非桌面回退 vault 选择器）
        //   🔴 #477 改名（用户 2026-10-02：「标题太长（可改成数据备份与恢复）」）：原「导出备份与备份恢复」
        //      11 字且把两件事串着说 ⇒ 改为 6 字。⚠️ 改名要同步**用户向文档**里的引用（README 两处）；
        //      断言里原来只当 label 文本用（非判据），也顺带更新。
        //   ⚠️ 描述不再复述标题（用户：「原描述只是标题的复述」）⇒ 点出**格式** JSON。
        new Setting(parent)
            .setName('数据备份与恢复')
            .setDesc('导出或导入 JSON 备份')
            .addButton((b) =>
                b.setButtonText('导出 JSON').onClick(() => {
                    if (Platform.isDesktopApp) void this.plugin.exportCatalogBackupToSystem();
                    else void this.plugin.exportCatalogBackup();
                }),
            )
            .addButton((b) =>
                b.setButtonText('选择文件').onClick(() => {
                    if (Platform.isDesktopApp) void this.plugin.restoreFromSystemFile();
                    else this.plugin.openBackupPicker();
                }),
            );

        // ③ 生成 Bases 视图模板（用户 2026-10-20：「做随生成 .base 模板」）
        //   🔴 数据真源是**笔记 frontmatter**，不是 catalog.json —— Bases 只索引 vault 里的 markdown。
        //      所以这里生成的是「查询模板」而不是「数据导出」：条目一改，Bases 视图跟着变，永远不会过期。
        //   ⚠️ 描述点明**产物路径**（用户能自己找到文件），并说清「可重复生成、可随意改」。
        //   🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-1）：这枚按钮**降级为普通按钮**（去掉 `.setCta()`）——
        //      它是「生成一个模板」，不是本页的主行动；紫色 primary 在这里把视觉重量给错了地方
        //      （同页的「扫描 / 查看」都是白底灰边）。描述同步改成用户给定的逐字文案。
        new Setting(parent)
            .setName('Bases 视图模板')
            .setDesc('生成 .base：用原生 Bases 浏览收藏库(重复生成即覆盖)')
            .addButton((b) => b.setButtonText('生成并打开').onClick(() => void this.plugin.generateAndOpenBaseTemplate()));
    }

    /**
     * 造一行「库内相对路径目录」设置（#425 抽出的工厂：**音频文件目录 / 书籍文件目录**共用）。
     * ⚠️ 「媒体库目录」是另一套语义（它管的是条目主视图的根），⛔ 别并进来。
     *
     * 🔴 四件事必须逐项一致，所以只留这一个实现，⛔ 别复制一份出去改：
     *   ① **失焦 / 回车才提交**（⛔ 别用 onChange 落库 —— 边打边存会让下载在打字途中落到半截目录里）；
     *   ② 提交前 `pure/downloadPlan.downloadRootIssue` 校验、提交后 `normalizeDownloadRoot` 归一
     *      （⛔ 别在设置页另写一份）；
     *   ③ 库内文件夹**自动补全**（旧版本没有 `AbstractInputSuggest` 时降级成「浏览」按钮）；
     *   ④ **提示里报的就是真实落点**（#459）：`kind` 传进去，占位与「当前仍是…」都取**该类型的**
     *      默认目录 —— 界面说「将落到下载/音乐」而代码偷偷再套一层，正是用户报障的那个 bug。
     *
     * @param getCur 取当前值 —— **每次提交时现读**，别闭包捕获旧值（否则「当前仍是…」那句会过时）
     * @param onCommit 落库回调（写哪个字段由调用方定）
     * @param slot 自动补全实例存在哪个字段 —— 三个输入框**各存一份**，共用一个会让先开的浮层失去引用、关不掉
     * @param kind 该目录服务哪一类下载（决定「空值 = 哪个默认目录」与占位文案）
     */
    private createLibraryDirRow(
        parent: HTMLElement,
        name: string,
        desc: string,
        getCur: () => string | undefined,
        onCommit: (next: string) => Promise<void>,
        slot: 'dl' | 'book',
        kind: DownloadKind,
    ): void {
        const row = new Setting(parent).setName(name).setDesc(desc);
        const hint = row.descEl.createDiv({ cls: 'rl-hint-note' });
        const setHint = (msg: string, isError = false): void => {
            hint.setText(msg);
            hint.toggleClass('is-error', isError);
        };
        row.addText((text) => {
            text.setPlaceholder(DOWNLOAD_DIR_DEFAULT[kind] ?? DOWNLOAD_DIR_DEFAULT.other).setValue(
                normalizeDownloadRoot(getCur(), kind),
            );
            // 打字期间只做**即时校验提示**，⛔ 不落库（提交时机见下面的 blur / Enter）
            text.onChange((value) => {
                const issue = downloadRootIssue(value);
                setHint(issue ?? '', !!issue);
            });
            const commit = async (): Promise<void> => {
                const raw = text.getValue();
                const issue = downloadRootIssue(raw);
                if (issue) {
                    setHint(`${issue}（未生效，当前仍是「${normalizeDownloadRoot(getCur(), kind)}」）`, true);
                    return;
                }
                const next = normalizeDownloadRoot(raw, kind);
                await onCommit(next);
                text.setValue(next); // 失焦回显归一化后的值（斜杠方向 / 前后斜杠在一次提交中被吸收）
                setHint(`将落到「${next}」文件夹`);
            };
            text.inputEl.addEventListener('blur', () => void commit());
            text.inputEl.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    void commit();
                }
            });
            const folders = folderCandidates(this.app);
            const fromPick = (folder: TFolder): void => {
                text.setValue(folder.path);
                void commit();
            };
            // 重渲染前先收掉上一次的浮层（同一个 slot 至多一个）
            const prev = slot === 'dl' ? this.dlFolderSuggest : this.bookFolderSuggest;
            prev?.close();
            const inst = attachFolderInputSuggest(this.app, text.inputEl, folders, fromPick);
            if (slot === 'dl') this.dlFolderSuggest = inst;
            else this.bookFolderSuggest = inst;
            if (!inst) {
                row.addButton((b) =>
                    b.setButtonText('浏览').onClick(() => {
                        new VaultFolderSuggest(this.app, folders, fromPick).open();
                    }),
                );
            }
        });
    }

    /** 「基本设置」页 · 第 4 组「封面与清理」（原「数据管理」页的后两段 + 迁移进度条） */
    private renderPosterCleanupRows(parent: HTMLDivElement): void {
        // ③ 下载封面（一键迁移：网络封面下载到 封面/{标题}.jpg；开关已移除，字段保留兼容旧数据）
        new Setting(parent)
            .setName('下载封面')
            // #477：统一标准动作词「下载 / 保存」（口径见 renderAppearanceRows）
            .setDesc('将网络封面下载并保存到本地')
            .addButton((b) =>
                b.setButtonText('一键迁移').onClick(() => {
                    if (this.plugin.isMigratingPosters) {
                        new Notice('封面迁移正在进行中…');
                        return;
                    }
                    // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-3）：进度**不再画在设置页里**，改用独立进度弹窗。
                    //    两个理由：⑴ 页内进度条会随设置页滚走就看不见，长迁移时用户以为没在跑；
                    //    ⑵ 结果本来还有一个弹窗，两套东西并存时「页内条 → 结果弹窗」的接力很别扭。
                    //    ⇒ 原来的 `.rl-mig-prog`（prog / bar / fill / text / textLabel + spinner）**整体删除**，
                    //    进度与结果都归 `PosterMigrateProgressModal`（`finish()` 自己展示结果，
                    //    ⛔ 别再弹 `PosterMigrateModal`，否则一次迁移会连开两个弹窗）。
                    const modal = new PosterMigrateProgressModal(this.app);
                    modal.open();
                    void this.plugin
                        .localizeAllPosters((done, total, step) => modal.setProgress(done, total, step))
                        .then((result) => modal.finish(result))
                        .catch((e) => modal.fail(e instanceof Error ? e.message : String(e)));
                }),
            );

        // ③.5 附件清理（原「清理孤儿封面」）：未被引用的封面 + 条目已删除后遗留的阅读存档，逐项勾选后清理
        new Setting(parent)
            .setName('附件清理')
            // 🔴 #477 按事实修正：用户建议写「缓存文件」，但**实际清的不是缓存** ——
            //    两类 = 未被引用的**封面** + 条目删除后遗留的**阅读存档**（`{lib}/阅读进度/*.json`，
            //    见 `pure/orphanAssets`），弹窗里逐项标的也是「封面 / 阅读存档」⇒ 必须与界面标签同词。
            .setDesc('清理未引用的封面与阅读存档')
            .addButton((b) =>
                b.setButtonText('扫描').onClick(() => {
                    void this.plugin.openAssetCleanup();
                }),
            );

        // ③.5a 条目还原（用户 2026-10-06 指令：「条目还原：可选回撤删除的条目（5 个）」）
        //   删除条目时（`main.deleteEntry` / `deleteEntries`）先把条目快照写进 `{lib}/trash.json`，
        //   这里把最近 5 条列出来供勾选复活。⛔ 文件本身在 Obsidian 回收站，弹窗里已如实说明。
        new Setting(parent)
            .setName('条目还原')
            .setDesc('恢复最近删除的 5 个条目')
            .addButton((b) =>
                b.setButtonText('还原').onClick(() => {
                    void this.plugin.openEntryRestore();
                }),
            );

        // ③.5b 附件管理（同一指令：「附件管理：支持浏览所有关联的条目 - 笔记 - 图片 - 附件，可选删除」）
        //   ⚠️ 与上一行「附件清理」的区别：清理只认**孤儿**（没人引用的），管理浏览的是**全部**关联文件（含正在用的）。
        new Setting(parent)
            .setName('附件管理')
            .setDesc('查看每次删除带走的文件')
            .addButton((b) =>
                b.setButtonText('浏览').onClick(() => {
                    void this.plugin.openAssetManager();
                }),
            );

        // ③.6 失效链接检测（🔴 #531，用户 2026-10-05 指令：「把检测已填网络地址是否失效按钮放在设置页-基本设置-
        //      封面与清理下面，功能为**全库**检索失效链接标红」）—— 原在**编辑表单**里的那枚按钮**已撤**，
        //      改成这里一键扫全库；结果只存内存，失效的集在**编辑表单 / 集数选择弹窗**里标红（用户裁定「仅表单/弹窗」）。
        // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-2）：结果**不再埋在设置页里**（原来那行 `.rl-hint` 在长设置页
        //    滚过去就丢，且只报个数、看不到具体是哪条链接）⇒ 改 `LinkCheckModal` 列出「条目名 / 字段 / 链接」明细。
        //    `scanLibraryLinks()` 因此扩了返回值：除四个计数外还带 `items`（失效明细，逐条 label + url）。
        let scanning = false;
        new Setting(parent)
            .setName('失效链接检测')
            .setDesc('检测全库网络链接是否失效')
            .addButton((b) => {
                b.setButtonText('检测').onClick(() => {
                    // 防重入：全库扫描是串行网络请求，连点会打出多份请求并把结果互相覆盖
                    if (scanning) return;
                    scanning = true;
                    b.setDisabled(true);
                    b.setButtonText('检测中…');
                    // 🔴 2026-10-25 用户指令：**先弹窗再陆续显示**检测到的失效链接。
                    //    ⇒ 先用 progressive 工厂开一个空壳（标题 + 「正在检测…」），
                    //      再把 `onDead` 接上宿主，每抓到一条就往列表里追加一行。
                    //    ⛔ 别再退回「扫完才 new LinkCheckModal(...items)」—— 那等于用户盯着一个不动的按钮等全库。
                    const modal = LinkCheckModal.progressive(
                        this.app,
                        { entries: 0, dead: 0, unknown: 0 },
                        // 执行体留在宿主（`plugin.clearDeadLinks`），弹窗只负责确认与反馈 ——
                        // ⛔ 别在弹窗里自己改 catalog：写盘要过 `service.update` 的唯一收口。
                        () => this.plugin.clearDeadLinks(),
                    );
                    modal.markScanning();
                    modal.open();
                    void this.plugin
                        .scanLibraryLinks((item) => modal.appendItem(item))
                        .then((r) => {
                            modal.finishScan({ entries: r.entries, dead: r.dead, unknown: r.unknown });
                        })
                        .catch(() => {
                            modal.close();
                            new Notice('检测失败，请稍后再试');
                        })
                        .finally(() => {
                            scanning = false;
                            b.setDisabled(false);
                            b.setButtonText('检测');
                        });
                });
            });
    }

    /**
     * 「关于」页。
     *
     * 🔴 #356（用户指令）：标题由「支持 ReelLudic」改回 **「支持作者」** —— 这是 09-10「支持作者 →
     *     支持 ReelLudic」的反向调整（那轮为统一品牌名），以用户本轮口径为准。
     *
     * 🔴 **#490 补「只补真有用的三件」**（用户 2026-10-02：「关于分组，太空了，怎么改较好」→ 三问后选定）：
     *    ⑴ **插件信息卡**（名称 + 版本 + 简介 + 作者 / 许可证）—— 版本号是反馈问题时**第一句就要报**的东西，
     *       以前只能去插件列表里翻；简介与作者同样取自 `manifest`（**唯一真源**，⛔ 别在设置页里再抄一份字面量）。
     *    ⑵ **两个链接入口**（问题反馈 / 更新日志）—— 找不到 Issues、或不知道这版改了什么时的出口。
     *    ⛔ **没做**「使用概览」（条目数 / 上次备份）：与「统计页」重复，且每次打开设置页都要扫一遍 catalog。
     *    ⚠️ 卡片外观**复用「支持作者」那套 `.rl-about`**（左文右钮）—— ⛔ 别为信息卡另造一套样式。
     *
     * 🔴 **#492（用户 2026-10-03）**：信息卡的**第一枚按钮（一键复制环境信息）整体退场** —— 连它下面的
     *    纯函数模块、剪贴板写入端与配套单测一并删除（只有一个使用者 = 死码，本仓「死码不留」）。
     *    ⇒ 信息卡一度只剩**两枚按钮**（问题反馈 / 更新日志）；本页仍是两块 **`.rl-about`** 卡。
     *
     * 🔴🔴 **#598（用户 2026-10-10）**：「把**问题反馈**按钮分成**报 Bug、提需求**两个按钮，做好调用入口」
     *    ⇒ 信息卡现在是**三枚**：报 Bug / 提需求 / 更新日志。
     *    ⚠️ 两枚反馈按钮的 label 与 URL 都取自 `pure/supportLinks.SUPPORT_BUTTONS`（唯一真源），
     *      链到 `.github/ISSUE_TEMPLATE/` 下的两个 issue form（模板已排好必填项）——
     *      ⛔ 别再退回那枚笼统的「问题反馈」（它只落到 issue 列表页，用户还得自己挑模板）。
     *
     * 🔴🔴 **#686（用户 2026-10-19，现行定稿）**：两卡**按语义各管一摊** ——
     *    信息卡 = **更新日志 · 未来规划**（「这版改了什么 / 接下来做什么」）；
     *    支持作者卡 = **报 Bug · 提需求 · Github · 爱发电**（「给反馈 / 给支持」）。
     *    ⇒ 本页两块卡**都带按钮**了（#685 曾把六枚全并到信息卡、支持作者卡只剩一句话，本轮已推翻）。
     *
     * 🔴🔴 **2026-10-19 用户指令（设置页 UX 改版 ⑧）**：信息卡第二枚按钮**「新手引导」→「未来规划」**。
     *    用户裁定引导弹窗整体下线（「新手引导」这条线不再维护，`modals/GuideModal` 已删、首次安装自动弹引导也一并撤），
     *    换成指向路线图弹窗。⚠️ **不带** `.rl-about-btn-accent`：本卡不再设强调按钮
     *    （紫色实底留给支持作者卡的「爱发电」，那才是本页唯一的行动召唤）。
     */
    private renderAboutPage(parent: HTMLElement): void {
        // ── ① 插件信息卡（名称 · 版本 / 简介 / 作者 · 许可证 + 两枚按钮）──
        const info = parent.createDiv({ cls: 'rl-about' });
        const infoText = info.createDiv({ cls: 'rl-about-text' });
        const nameRow = infoText.createDiv({ cls: 'rl-about-title' });
        nameRow.createSpan({ text: this.plugin.manifest.name });
        nameRow.createSpan({ cls: 'rl-about-ver', text: `v${this.plugin.manifest.version}` });
        infoText.createDiv({ cls: 'rl-about-desc', text: this.plugin.manifest.description });
        // ⚠️ `PluginManifest` 类型里**没有** `license`（obsidian 的 manifest.json 有这个键）⇒ 读可选键 + 兜底。
        //    真源仍是 `package.json` / `LICENSE` / `manifest.json` 三处（本仓红线），这里只是显示。
        const license = (this.plugin.manifest as { license?: string }).license ?? 'GPL-3.0';
        infoText.createDiv({ cls: 'rl-about-meta', text: `作者 ${this.plugin.manifest.author} · 许可证 ${license}` });

        const infoBtns = info.createDiv({ cls: 'rl-about-buttons' });
        // 🔴🔴 #686（用户 2026-10-19）：「更新日志、爱发电按钮放在 ReelLudic 信息栏；报 Bug、提需求、Github
        //    移到支持作者卡片」。⇒ 按钮按**语义归属**分两组，不再挤同一行：
        //      信息栏（认识这个插件）  → 更新日志 · 未来规划
        //      支持作者卡（反馈与支持）→ 报 Bug · 提需求 · Github · 爱发电
        //    ⚠️ 沿革：#685 曾把六枚全并进信息栏一行（当时读成「都排在爱发电前面」）；本轮用户明确了归属，
        //       ⛔ 别再合并回去 —— 两组的语义本来就不同（一个讲「这版改了什么/接下来做什么」，一个讲「给反馈/给支持」）。
        //    ⚠️ 文案 / URL 仍取 `pure/supportLinks`（唯一真源，⛔ 别手写第二份）。
        // 🔴 #491（用户 2026-10-03：「点击更新日志不跳转网页改成内置弹窗」）：内置弹窗（正文见 `pure/releaseNotes`）。
        //    ⛔ 别再退回浏览器跳转；完整发布记录那条链在弹窗底部，由用户主动点。
        const logBtn = infoBtns.createEl('button', { cls: 'rl-about-btn', text: '更新日志' });
        logBtn.addEventListener('click', () => new ReleaseNotesModal(this.app).open());
        // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑧）：原「新手引导」按钮**整体退场**（引导弹窗下线，见 `modals/GuideModal` 的删除），
        //    这个位置换成「未来规划」——用户要的是「这插件接下来做什么」的可见出口。
        //    ⚠️ 普通次要按钮样式（⛔ 不带 `.rl-about-btn-accent`）：本卡的按钮都不该抢「爱发电」的行动召唤。
        const roadmapBtn = infoBtns.createEl('button', { cls: 'rl-about-btn', text: '未来规划' });
        roadmapBtn.addEventListener('click', () => new RoadmapModal(this.app).open());

        // ── ② 支持作者（说明文字 + **反馈与支持**四枚按钮）──
        // 🔴 #686：本卡恢复「左文右钮」布局（`.rl-about` 本就是 flex），按钮改挂到这张卡上。
        const about = parent.createDiv({ cls: 'rl-about' });
        const aboutText = about.createDiv({ cls: 'rl-about-text' });
        aboutText.createDiv({ cls: 'rl-about-title', text: '支持作者' });
        aboutText.createDiv({ cls: 'rl-about-desc', text: '如果 ReelLudic 对你有帮助，欢迎在 GitHub 上给个 ⭐，或通过爱发电支持一下～' });

        const supportBtns = about.createDiv({ cls: 'rl-about-buttons' });
        for (const b of SUPPORT_BUTTONS) {
            const btn = supportBtns.createEl('button', { cls: 'rl-about-btn', text: b.label });
            btn.addEventListener('click', () => window.open(b.url, '_blank'));
        }
        const githubBtn = supportBtns.createEl('button', { cls: 'rl-about-btn', text: 'Github' });
        githubBtn.addEventListener('click', () => window.open(REPO_URL, '_blank'));
        // 爱发电压轴：它是这一组里唯一「掏钱」的入口，用主题色实底与三枚反馈按钮拉开层级
        const afdianBtn = supportBtns.createEl('button', { cls: 'rl-about-btn rl-about-btn-accent', text: '爱发电' });
        afdianBtn.addEventListener('click', () => window.open(AFDIAN_URL, '_blank'));
    }
}
