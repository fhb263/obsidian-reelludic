// 设置类型、默认值与设置面板（字段只能追加，不能删除——AGENTS 红线）
import { Menu, Modal, Notice, Platform, PluginSettingTab, Setting, setIcon, requestUrl, TFolder } from 'obsidian';
import type ReelLudicPlugin from '../main';
import type { ColorTheme, UiTheme } from 'data/types';
// #604 内置播放器的播放模式（四档真源在纯模块；设置里只存这个联合类型）
import type { PlayMode } from 'pure/playerMenu';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, TYPE_COLORS, type BookKind, type EntryType } from 'data/types';
// 🔴 #640e：书籍子分类（文学 / 网文 / 漫画）的两个真源 —— 标签取自 `BOOK_KIND_LABELS`（⛔ 不手写）
import { BOOK_KINDS, BOOK_KIND_LABELS } from 'pure/bookKind';
import type { ProviderId, SourceGroup, ProviderMeta } from 'pure/sourceRegistry';
import {
    PROVIDERS, PROVIDER_META, GROUP_LABELS, SOURCE_GROUP_ICONS, SOURCE_GROUP_COLOR_KEY,
    resolveSourceChain, normalizeSourceChain,
} from 'pure/sourceRegistry';
// 🔴 本轮新增：「元数据搜索源启用」勾选项的 hover 一句话说明（六组 13 条，真源在纯模块，可单测）
import { sourcePitch } from 'pure/sourcePitch';
import { splitHintLinks } from 'pure/sourceLink';
import { rememberOpenFolds, restoreOpenFolds } from 'pure/detailsState';
import { normalizeAiChoice, normalizeProvider, normalizeAiBaseUrl, AI_PROVIDER_OPTIONS, aiProviderOptions, AI_PROVIDER_OFF, AI_PURPOSE_DEFAULT, DEFAULT_MODELS, DEFAULT_TRANSLATE_PROMPT, aiBaseUrlIssue, providerLabel, mergeModelCandidates, aiChoiceLabel, aiChoiceLabelNamed, aiPickText, isAiOff, aiKeyField, isCustomSlot, customSlotName, normalizeCustomName, CUSTOM_SLOTS, CUSTOM_SLOT_FIELDS, CUSTOM_SLOT_DEFAULT_NAME, type CustomSlot, type AiProviderChoice, type TranslateProvider, type ModelFetched } from 'pure/translate';
// #484：模型拣选弹窗的筛选 / 置顶判定（纯逻辑，可单测）
import { togglePin, toggleHidden, clearHiddenFor } from 'pure/aiPick';
// #479 AI集成页整页重排：服务商品牌标（LobeHub Icons，MIT）+ 可搜索的模型选择
// #480：图标绘制与「服务商图标」抽到 services/aiIcon（设置页与拣选弹窗共用一份）
import { AI_PROVIDER_ICON, type AiIcon } from 'pure/aiIcons';
// 🔴 #689：`pure/comicViewer` 的两个导出**已不再被设置页使用**（漫画阅读方式下拉已移除，
//    入口只在漫画阅读器内）⇒ import 一并删除。⛔ 别因为「以后可能用」留着 —— 本仓死码不留。
// 🔴 #639 ⑥：Steam 凭据（SteamID 校验是纯函数，⛔ 不在设置页另写一份位数判断）
import { steamIdIssue } from 'pure/steamSync';
// 🔴 2026-10-25 用户裁定：TMDB 两格各只收一种凭据（Key 格 = 32 位 v3 API Key；Session 格 = v4 access_token），
//    校验文案走纯函数，便于单测与「占位说明也是」那条要求对齐。
import { tmdbApiKeyFieldIssue, tmdbSessionFieldIssue } from 'pure/tmdbAuth';
import { renderAiIcon, aiChoiceIcon } from 'services/aiIcon';
// #488：元数据源 / 音乐平台图标真源（simple-icons CC0 品牌标 + 内置兜底；**生成器写盘**，
// 见 `_gen_source_icons.cjs`）。与 AI 服务商图标共用**同一个** `renderAiIcon` 渲染端。
import { SOURCE_ICON, MUSIC_COOKIE_ICON, NET_COOKIE_ICON, type KeySourceId, type MusicSourceId, type NetSourceId } from 'pure/sourceIcons';
// #589 开机凭据自检：凭据行的徽标要能显示「连接失败」（#634 由「已失效」改名）
// 🔴 #634：`aiCheckKey` 让 AI 服务（翻译/总结/云合成/自定义端点）也走**同一张三态结果表**
import { EXPIRED_BADGE, isExpired, aiCheckKey, musicCheckKey, netCheckKey, sourceCheckKey, type CredentialStatusMap } from 'pure/credentialCheck';
// 🔴 ③-1（2026-11-12 用户 m00353）：「统一周期管理」面板的**唯一数据源**。
//    ⛔ 面板里不许再自己算「是否配置 / 是否失效 / 上次检测」—— 一律走 `buildCredentialMeta`，
//    否则面板与下面几组凭据行的徽标必然漂移（用户原话：「必须共享同一个 credentialMeta 数据源」）。
import {
    buildCredentialMeta,
    credentialStateLabel,
    formatCheckedAt,
    summarizeCredentialMeta,
    type CredentialMeta,
} from 'pure/credentialMeta';
// 🔴 ③-5：全局 UI 组件基座（`src/ui/components.ts`）。分段 chips / 组头部 / 状态表格只从这里建，
//    ⛔ 别再在设置页里手搓 —— 用户原话「彻底消灭视觉上的东拼西凑」，根因就是同类控件各手写一份。
import { cell, chipBar, ghostIconButton, groupHeader, iconButton, setFeedback, splitTable, statusTable } from 'ui/components';
// #491「更新日志」= 内置弹窗（⛔ 不再跳浏览器）；正文是 `pure/releaseNotes` 里那张**手写**的版本一句话表
import { ReleaseNotesModal } from 'modals/ReleaseNotesModal';
// 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑧）：关于页那枚「新手引导」按钮换成「未来规划」，
//    引导弹窗（`modals/GuideModal`）与它的 `GUIDE_PAGE_COUNT` 一并下线 ⇒ 这里只留路线图弹窗。
import { RoadmapModal } from 'modals/RoadmapModal';
// ③-2 / ③-3 / ③-4（2026-11-12）：豆瓣 / B 站 / 微信读书的**扫码登录**弹窗。
// ⚠️ 用户裁定 m05063 =「弹出对应网页扫码」⇒ 弹窗里不画二维码，只开官方扫码页子窗口 + 轮询。
import { QrLoginModal, type QrLoginPicked } from 'modals/QrLoginModal';
import { accountNameOf, type QrPlatform } from 'pure/qrLogin';
// #598 对外链接的唯一真源（仓库 / 报 Bug / 提需求 / 爱发电）—— 「关于」页那几枚按钮只读它
import { REPO_URL, AFDIAN_URL, SUPPORT_BUTTONS, AUTHOR_GITHUB_URL, AUTHOR_GITHUB_TIP, AUTHOR_GITHUB_ICON } from 'pure/supportLinks';
import { AiPickerModal, AiModelNameModal, type AiModelItem, type AiPickerPick } from 'modals/AiPickerModal';
// #480 ④ / #482 ③：朗读音源行的「音源 + 音色 + 试听」（纯逻辑在 pure/ttsSettings；引擎复用阅读器那两套）
import {
    normalizeTtsEngineKind, ttsVoiceGroups, ttsVoiceLabel,
    effectiveTtsVoice, ttsEngineBlockedReason,
} from 'pure/ttsSettings';
import { SystemSpeechEngine, ttsSupported, type SpeechEngine } from 'services/SpeechEngine';
import { CloudSpeechEngine } from 'services/CloudSpeechEngine';
import { VOICE_PREVIEW_TEXT, loadTtsRate, loadTtsVolume, loadVoiceUri, saveVoiceUri, TTS_RATE_DEFAULT, TTS_PITCH_DEFAULT, TTS_VOLUME_DEFAULT, type TtsEngineKind, type TtsVoiceLite } from 'pure/tts';
import { cloudModelShortName, cloudVoiceFullLabel, loadCloudVoice, saveCloudVoice } from 'pure/ttsCloud';
import type { AudioPlayMode } from 'pure/audioQueue';
import { DEFAULT_SUMMARY_PROMPT } from 'pure/aiSummary';
import { DEFAULT_CUE_SUMMARY_PROMPT, DEFAULT_CUE_ASK_PROMPT } from 'pure/cueSummary';
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
// 🔴 2026-10-25：`PosterMigrateProgressModal` 也不再由本文件 import —— 一键迁移的完整流程
//    （扫候选 → 勾选弹窗 → 进度弹窗 → 迁移）已收进 `main.openPosterMigrate()`，设置页只点一下。
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
// 🔴 2026-11-23 分类视图：模型 / 归一 / 新建全在 pure/mediaViews（配单测）——
//    ⛔ 别在本文件里再归一一次，否则「设置页存的」和「首页读的」两套口径必然漂。
import {
    DEFAULT_VIEW_ID,
    VIEW_TYPE_CHOICES,
    isBuiltinView,
    MAX_VIEWS,
    VIEW_KIND_DESCS,
    createView,
    nextViewId,
    normalizeViewTags,
    viewIconOf,
    viewSelectionOf,
    viewSelectionPatch,
    type MediaView,
} from 'pure/mediaViews';
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
    // 🔴 #721：结构性键（id / type / title / created / updated）**不给删除入口** ——
    //    删了笔记就坏（插件认不出条目）。判据只有这一份真源，⛔ 别在设置页写名单。
    isHidableFieldKey,
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
// 🔴 第二期 ⑤：本地音频转文字（ASR）语言码归一 —— 与本页工具栏同一把尺，⛔ 别在设置页自己判
import { normalizeAsrLang } from 'pure/asrEngine';
import { ASR_ENGINES, engineDefOf } from 'pure/asrEngines';
// 🔴 2026-11-06：「沉浸体验 › 语音服务」顶部摘要行要写「Whisper.cpp (Base)」这种**具体档位名**，
//    靠 `presetByFileName` 从当前模型路径反查；⛔ 别在设置页自己按文件名 `includes` 猜（同 `main.ts` 同源）。
import { ASR_MODEL_PRESETS, presetByFileName, presetOf, presetSizeLabel, type AsrModelTier } from 'pure/asrModels';
import { asrBrandSvg } from 'pure/asrBrandIcon';
// 🔴 用户 m07854 ⑤：文字转语音两处小图标换品牌标 —— 本地 = 当前操作系统（`systemVoiceIcon`），
//    云端 = 硅基流动（复用 `AI_PROVIDER_ICON.siliconflow`，⛔ 别另抄路径）。
import { currentPlatform, systemVoiceIcon } from 'pure/osIcons';
// 🔴 2026-11-14（用户 m05673 手机实测）：「空白一片应该给个提示不支持」——
//    哪些组在移动端要打「仅桌面端」徽标，判定真源只此一份（⛔ 别在本页硬编码组名）。
import { DESKTOP_ONLY_LABEL, shouldMarkDesktopOnly } from 'pure/platformGates';
// 🔴 2026-11-10：左列表是「按家分组的平铺单选」，体积/准确度/标签/场景集中在这张纯数据表里
//    （来自用户给的 12 行模型表），⛔ 别在渲染处再拼一份数字。
import { accuracyLabel, asrCatalog } from 'pure/asrCatalog';
// 🔴 2026-11-11 用户 m05717 ①：AI 运行管家要**真数据**（显存/内存/CMake/C++）。
//    纯函数全在 `pure/asrHardware`（零 IO，被 35 条单测钉住），⛔ 别在本页自己解析 nvidia-smi 输出。
import {
    defaultDevice,
    estimateFootprint,
    footprintWarning,
    formatMb,
    gpuRowState,
    hasFatalMissing,
    vramFits,
    type HardwareInfo,
} from 'pure/asrHardware';
// 🔴 2026-11-06 m09123：另两家（Qwen3 / SenseVoice）的模型行也要显示「这一家一共多大」，
//    体积口径统一走 `pure/asrBundles`（那里已经有按字节求和的实现，⛔ 别在这页再算一遍）。
// 🔴 2026-11-06 m09432：另外还要给 Qwen3 / SenseVoice 各挂一个档位下拉，档位表与体积同样来自这里。
import {
    bundleBytes,
    bundleOf as asrBundleOf,
    bundleSizeLabel,
    formatBundleBytes,
    CONFUCIUS_VARIANTS,
    PARAFORMER_VARIANTS,
    QWEN_ASR_VARIANTS,
    QWEN_ALIGN,
    XASR_VARIANTS,
    confuciusVariantOf,
    paraVariantOf,
    qwenBundle,
    SENSEVOICE_VARIANTS,
    senseVoiceBundle,
    svVariantOf,
    qwenVariantOf,
    xasrVariantOf,
} from 'pure/asrBundles';
import { installSupported, installUnsupportedMessage } from 'pure/whisperRuntime';
// 🔴 1.5.1：编辑窗口「条目属性」（属性块的显示 / 隐藏 / 先后）—— 与 fieldOrder / cardMeta / tableColumns 三套各管一件事
import {
    ENTRY_FORM_MAX_SPAN,
    ENTRY_FORM_SLOTS,
    ENTRY_FORM_SPAN_PRESETS,
    defaultEntryFormFieldsFor,
    entryFormFieldIsFixed,
    entryFormFieldsFor,
    isDefaultEntryFormFields,
    normalizeEntryFormFields,
    withFixedEntryFormFields,
    type EntryFormFieldEntry,
    type EntryFormFieldLayout,
} from 'pure/entryFormFields';
// #541「个性化体验」四项：主导航布局 / 起始页 / 卡片风格 / 界面动效。
// 🔴 三项归一与文案**一律走 pure 模块**，⛔ 别在渲染处另写一份选项表（第二份真源）。
import { homeTabLabel, normalizeStartTab, normalizeStartTabFor, normalizeTabAxis, tabOrderFor, type HomeTab, type TabAxis } from 'pure/homeTabs';
import { NAV_LAYOUTS, NAV_LAYOUT_LABELS, normalizeNavLayout, type NavLayout } from 'pure/navLayout';
import {
    CARD_STYLES, CARD_STYLE_LABELS, MOTION_MODES, MOTION_MODE_LABELS,
    normalizeCardStyle, normalizeMotionMode, type CardStyle, type MotionMode,
} from 'pure/appearance';
import { safeSetIcon } from 'services/safeIcon';
// 提示 + 读屏名统一走组件基座（①-9：⛔ 别再手写 aria-label，会与 data-tip 叠两层气泡）
import { setTip, srLabel } from 'ui/components';
import { bindTooltipDocument } from 'services/globalTooltip';
import { probeEmbedCookies } from 'services/embedCookie';

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
    /**
     * 🔴 m07854 ⑬（2026-11-13，append-only 可选字段）**系列卡是否摊平**。
     *
     * `undefined` 或 `false` = 系列卡堆叠（同系列折成一张卡，与 1.5.0 之前一致）；`true` = 全部单卡平铺。
     * ⚠️ 与上面的 `listGrouping` **是两件事**，⛔ 别合并成一个开关：
     *    `listGrouping` 管的是**列表视图的行形态**（树形父子行 ⇄ 每条独立一行），
     *    本字段管的是**海报墙 / 卡片网格的系列折叠卡**（`seriesRows` 那一支）。
     *    两者作用面不同，合成一个会让「在列表里摊平 → 切到网格发现系列也没了」这种连带出现。
     * ⚠️ 只在**卡片网格 / 海报墙**两个视图可见（那两视图才有折叠卡）；列表 / 瀑布流 / 时间线不受它影响。
     * 落盘走 `plugin.setUnfoldSeries(next)`（唯一出口，⛔ 别在视图里直接改 `settings` 字段）。
     */
    unfoldSeries?: boolean;
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
     * 🔴 #657（用户：「统计页的所有元素支持自由排序，自适应」）：统计页**各区块的顺序**。
     * `['hero','feed','trend','overview','board','cloud']` = 缺省（与原三层倒金字塔的视觉顺序一致，
     * `cloud`（标签词云，②-3）追加在末尾）。
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
    /**
     * 🔴 用户 m09565 ①-4（append-only；缺省 `expanded` = 2026-11-08 起的全类型十枚）。
     *
     * 用户逐字：「设置页基本设置加个启用顶部胶囊/文字菜单则按全类型分页签，关闭则按
     * 计划、阅读、影视、音乐、游戏、统计分页签（**两种模式的导航状态（当前选中项）要独立保存**，
     * 切换开关时不要丢失各自的位置）」
     *
     * · `expanded` = 全类型摊开（计划/文学/网文/漫画/电影/剧集/动画/游戏/音乐/统计）
     * · `classic`  = 聚合六枚（计划/阅读/影视/音乐/游戏/统计）
     * 归一走 `pure/homeTabs.normalizeTabAxis`（脏值回 `expanded`，⛔ 升级不得换脸）。
     * ⚠️ 切换时**两条轴各自的选中项**由 `main.ts` 的 `homeTabByAxis` 分别记着（⛔ 别写进 settings：
     *    那是「上次看到哪」，落盘会把「起始页」永久盖掉 —— 同 `startTab` 的注释口径）。
     */
    tabAxis?: TabAxis;
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
     * 是否启用**内置游戏启动器**（append-only 可选字段；**默认 true = 开**）。
     * 用户 m02844：「游戏下载目录放播放阅读启用启动器下」。
     *
     * 语义：开启后，游戏条目「▶ 启动」优先在**插件内**用 Ruffle 播放本地 swf
     * （`FlashGameView`，工作区独立标签页）；关闭时沿用原行为 —— 打开 `.lnk` 快捷方式
     * 把游戏交给系统。
     *
     * 🔴 为什么缺省是 **true** 而不是 false：设置加载是 `Object.assign({}, DEFAULT_SETTINGS, raw)`
     *    ⇒ 老用户的 settings 文件里根本没有这个键，缺省 false 会让「刚刚才给 swf 配好路径的人」
     *    升级后被**静默关停**（点了没反应、也不报错），这种回归比多下载一次运行时严重得多。
     *    ⇒ 默认开、只有**显式关掉**才拦住；开了也确实符合用户意图（填了 swf 就是想内嵌玩）。
     * ⛔ 判断点只有 `main.launchGame` 一处，别在 UI 里再摊一份。
     */
    internalGameLauncher?: boolean;
    /**
     * 游戏（swf）的**下载 / 存放目录**（append-only 可选字段；留空 = `下载/Flash 游戏`）。
     * 用户 m02844 同期要求：「游戏下载目录」作为「启用内置游戏启动器」的子行。
     *
     * ⚠️ 与 `musicDownloadDir` / `bookDownloadDir` 同一套口径：空值不是「根目录」，
     *    而是**该类下载的默认子目录**（见 `pure/downloadPlan.DOWNLOAD_DIR_DEFAULT.flash`）。
     */
    gameDownloadDir?: string;
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
     * 🔴 用户 m07854 ①（2026-11-13）：「仅在第一次启用插件时」把默认源链播种成显式配置的一次性标记。
     *
     * 为什么必须有个标记位：默认链原先靠 `resolveSourceChain` **动态回退**生效，等于「默认值是一个
     * 随代码演进的活值」—— 将来改 `DEFAULT_CHAINS` 会追溯性改掉用户已确认的配置（详见
     * `pure/sourceRegistry.seedSourceChains` 的注释）。播种一次并落盘后，配置就只认磁盘上那份。
     *
     * ⚠️ 口径与 `downloadDirMigrated` 完全一致：置 `true` 后**永不回退**（否则每次载入都重新播种，
     *    用户把某组改回「不启用免费源」后会被反复改回来 —— 那正是「强制覆盖用户已修改过」）。
     * ⚠️ 与 `main.ts:onload` 头部那条「⛔ 别塞首次安装标志」的历史结论不冲突：那条讲的是
     *    **新手引导**用的「首次安装」判据（引导已下线）；这里是一次性**数据迁移**标记，与
     *    `downloadDirMigrated` / `biliCookie` 自愈同属「存量数据必须只改一次」的类别。
     */
    sourceChainsSeeded?: boolean;
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
    /**
     * 本地音频转文字（ASR）的 whisper.cpp 可执行文件路径。append-only 可选字段。
     *
     * 🔴 **留空 = 走系统 PATH**（按 `pure/asrEngine.ASR_EXE_CANDIDATES_*` 逐个试：whisper-cli / main / …）
     *    —— whisper.cpp **改过二进制名**（老版叫 `main`、新版叫 `whisper-cli`），只认一个名字会让
     *    相当一部分用户「明明装了却说没找到」。所以「空」是合法缺省，⛔ 别在读取端兜底成某个固定名。
     * ⚠️ 与 `ytdlpPath` 是**两条互不相干的链路**（一个取流、一个转写）：⛔ 不共用一个字段，
     *    否则用户在音乐设置里改了路径、却没意识到转写也跟着变了。
     */
    asrExePath?: string;
    /**
     * ffmpeg 可执行文件路径（ASR 抽音轨用）。append-only 可选字段。
     *
     * 🔴 为什么这次**单独设一项**（而 `ytdlpPath` 的注释里说「不另设 ffmpeg 路径项」）：
     *    yt-dlp 会自己去 PATH 与「它自己所在目录」找 ffmpeg，用户不用管；
     *    而 ASR 这条链路是**我们自己**起 ffmpeg，它不去别处找 ⇒ 找不到就整条链路不可用。
     *    ⚠️ 留空仍然走 PATH（多数装了 ffmpeg 的用户不用填）。
     */
    asrFfmpegPath?: string;
    /**
     * whisper.cpp 的模型文件（`.bin`，ggml 格式）路径。**没有它转写不可用**。
     *
     * 🔴 模型文件**不进插件、不自动下载**（用户 m02009 裁定的第二期就是「用户自装」版）：
     *    最小的 `ggml-tiny` 也有 ~75MB，`main.js` 上限是 5MB —— 塞进去等于把插件变成模型分发器。
     *    第三期才做「按需下载」。
     */
    asrModelPath?: string;
    /**
     * 转写模型的**下载 / 存放目录**（留空 = 默认 `~/.reelludic/models`）。
     *
     * 🔴 用户 m06789 需求②：「要显示当前模型及环境下载路径和**可选择指定路径下载**」。
     *    ⚠️ 这是比 `asrModelPath` 更粗的一层：`asrModelPath` 指到**文件**，本字段指到**目录**，
     *    插件自己下的三档 ggml 全都落在这个目录里。两个字段各管一件事，⛔ 别用一个顶另一个。
     *    ⛔ 目录默认仍在**库外**（465MB 进 vault 会被同步盘整份上传）。
     */
    asrModelDir?: string;
    /**
     * 转写语言（whisper.cpp 的 `-l`）。`auto` = 让它自己判。
     * ⚠️ 走 `pure/asrEngine.normalizeAsrLang` 归一，非法值一律回落 `auto`（⛔ 不把脏值透传给子进程）。
     */
    asrLang?: string;
    /**
     * 转写线程数（`-t`）。0 / 缺省 = 不传，让 whisper.cpp 自己按核数定。
     * ⚠️ 只对桌面端有意义；极端大值会被 `buildAsrArgs` 夹到 64。
     */
    asrThreads?: number;
    /**
     * 用哪一家转写引擎。append-only 可选字段，缺省 `whisper`。
     *
     * - `whisper`    —— 插件内建：ffmpeg 抽轨 + `whisper-cli -osrt`，模型可一键下载；
     * - `qwen3`      —— 中文精准版：调用户自备 Python 环境里的桥接脚本；
     * - `sensevoice` —— 极速版：同样走桥接脚本（用户自装 sherpa-onnx 运行时）。
     *
     * 🔴 用户 m04641：「按需加载，要有不能没有」⇒ 三家都要在界面上可选，
     *    但后两家**不随插件分发**（`main.js` 已 97%+，装不下 onnxruntime，更装不下 3.5GB 模型）。
     * ⚠️ 认不出来的值一律回落 `whisper`（见 `pure/asrEngines.engineDefOf`），⛔ 别抛错 ——
     *    用户手改 config 写了个生僻值时，插件该继续能用而不是整个转写入口消失。
     */
    asrEngine?: string;
    /**
     * Qwen3 桥接用的 Python 解释器路径（如 `D:\Qwen3-aligner\.venv\Scripts\python.exe`）。
     *
     * 🔴 **必须由用户指**：插件不去猜 Python 装在哪（conda / venv / 系统 Python 三种都常见），
     *    猜错了会起一个「没有 torch 的 python」，报错信息完全看不懂。
     * ⚠️ 空值是合法缺省（= 没配这一家），此时选这家会在转写时给引导文案，⛔ 不报硬错。
     */
    asrPythonPath?: string;
    /**
     * Qwen3 桥接脚本路径（`cli_bridge.py`）。
     *
     * 🔴 与 `asrPythonPath` 成对出现：只填一个等于没配（两者都是起进程的必要条件）。
     * 脚本本身不随插件分发 —— 它在用户的 Qwen3 工程目录里，由那份工程负责模型与依赖。
     */
    asrBridgeScript?: string;
    /**
     * 极速版（SenseVoice）的识别程序 `sherpa-onnx-offline.exe` 路径。
     *
     * 🔴 **2026-12 用户裁定（m05240）之后拆成独立槽位**：原先把三家的程序挤在 `asrExePath`、
     *    模型挤在 `asrModelPath`，UI 做成「一个下拉 + 六行输入框」—— 用户原话「太丑了而且没有用户引导，
     *    完全不知道怎么做」。改成三张卡片后，每张卡必须有自己的输入框，否则展开这家会显示那家的值。
     * ⚠️ `asrExePath` 从此**只属于**轻量多语版（whisper-cli），⛔ 别再让它兼职。
     */
    asrSenseVoiceExePath?: string;
    /**
     * 极速版（SenseVoice）的模型文件 `model.int8.onnx` 路径。
     *
     * 🔴 与 `asrModelPath`（whisper 的 ggml `.bin`）**不是同一个文件、不是同一个格式**，拆开存。
     * ⚠️ 极速版要三个文件才跑得起来：本项 + `asrSenseVoiceExePath` + `asrTokensPath`。
     */
    asrSenseVoiceModelPath?: string;
    /**
     * SenseVoice（极速版）用的词表文件 `tokens.txt`。
     *
     * 🔴 与 `model.int8.onnx` 在同一个发布包里一起下载；另两家不需要这一项。
     */
    asrTokensPath?: string;
    /**
     * Qwen3-ASR 用哪一档（`'0.6B'` / `'1.7B'`，缺省 = 0.6B）。
     *
     * 🔴 用户 m09432：「还有其他两家模型没有档位切换吗」—— 有。上游发布了 0.6B 与 1.7B 两个仓库
     *    （1.7B 的权重分两片，合计约 4.4GB）。档位影响三件事，缺一件都会「装了但用不上」：
     *    ① 下载清单下哪些文件（`qwenBundle(tier)`）；② 环境自检去哪个目录找（目录名 = 上游仓库名）；
     *    ③ 传给桥接脚本的 `--model`（`qwenModelOf`）。
     * ⚠️ 对齐模型**不跟档位联动** —— 上游只有 `Qwen3-ForcedAligner-0.6B` 一档。
     */
    asrQwenTier?: string;
    /**
     * SenseVoice 用哪一档量化（`'int8'` / `'fp32'`，缺省 = int8）。
     *
     * 🔴 用户 m09432 同上：同一个发布仓库里就有 `model.int8.onnx`（228MB）与 `model.onnx`（894MB）。
     *    档位决定下载哪个文件、自检找哪个文件名、转写时 `--sv-model` 传哪个路径。
     */
    asrSvVariant?: string;
    /**
     * Paraformer 用哪一档量化（`'int8'` / `'fp32'`，缺省 = int8）。
     *
     * 🔴 用户表格第 10/11 行：int8 237MB、fp32 880MB，中文准确度同为 1.95。
     *    与 SenseVoice 同一个套路 —— 档位决定三件事：下哪个文件、自检找哪个文件名、
     *    转写时 `--paraformer` 传哪个路径。
     */
    asrParaVariant?: string;
    /**
     * X-ASR 用哪一档分块（`'160'` / `'480'` / `'960'` / `'1920'`，缺省 = 1920）。
     *
     * 🔴 上游按 chunk 长度发了四套权重，目录名各不同（`chunk-160ms-model` 等）。
     *    用户裁定（m00449）：**列表里只列一行**，四档放进右侧配置面板的下拉里切 ——
     *    因为四档体积几乎一致（encoder 都在 593MB 上下），摊成四行没有信息量。
     * ⚠️ 这是**上游事实**，不是我们能合并的：三件套（encoder/decoder/joiner）必须同档配套，
     *    混用会直接崩（形状不匹配）。
     */
    asrXasrChunk?: string;
    /**
     * Confucius4 用哪一档量化（`'Q4_K_M'` / `'F16'`，缺省 = Q4_K_M）。
     *
     * 🔴 用户表格第 12/13 行：Q4_K_M 1.0GB、F16 3.2GB，两档准确度同为 8.2/6.1。
     * ⚠️ 每档都是「语言模型 + 投影器」一对文件，`--mmproj` 必填 ——
     *    只下 gguf 不下 mmproj 时 exe 会直接拒绝运行（真机实测）。
     */
    asrConfuciusTier?: string;
    /**
     * 每家引擎的自定义安装目录（用户 m01935 在安装弹窗里改过的路径会落到这里）。
     *
     * 🔴 为什么需要它：用户点「下载 / 一键装好」时可以在弹窗里改目录，改成 D:\asr\xasr
     *    之后插件必须**从同一处**去装、去找。⛔ 别把绝对路径写进 `asrEnginePaths` 的
     *    `program/model/extra` 那三个字段 —— 那三个是「单个文件」的覆盖，表达不了
     *    「这一家的程序、权重、词表整体换了地方」，而且换档位时会对不上新文件名。
     * ⚠️ 空对象 = 全部走默认（`asrModelDir()/<engine>`），旧数据不需要迁移。
     */
    asrEngineDirOverrides?: Record<string, string>;
    /**
     * whisper 识别程序（`whisper-cli.exe` + dll）的自定义安装目录。
     *
     * ⚠️ 只有 whisper 需要：它的程序在 `~/.reelludic/bin`，模型在 `models/whisper`，
     *    两家共用 `asrEngineDirOverrides` 会把程序也塞进模型目录 —— 而
     *    `pure/asrLocate.commonInstallDirs` 认的就是 bin 那个位置（装别处会「装好了还是红的」）。
     */
    asrBinDirOverride?: string;
    /**
     * 学习模式悬停查词用的本地词典文件（ECDICT 精简 CSV，或自己整理的「词<TAB>释义」表）。
     *
     * 🔴 **为什么不内置词典**：`main.js` 已 96.9%，距 5MB 上限只剩 150KB；ECDICT 精简版也有几 MB。
     *    所以只带解析器（`pure/wordDict`），词典文件由用户在设置里指路径 —— 与 whisper 模型、
     *    yt-dlp 同一条路（用户自装、插件只读）。
     * ⚠️ 空值是合法缺省：没配词典时学习模式照样能用（悬停只显示词形 + 🔊），
     *    ⛔ 不要让「查不到释义」弹出错误或红字。
     */
    dictPath?: string;
    /**
     * B 站 Cookie（2026-10-25，用户：「b站cookie凭据放音乐下载源「B站音频流」下」）—— append-only 可选字段。
     *
     * 🔴 **为什么不并进 `musicDlCookies`**：那张表的键是 `MusicSourceId`（`netease|qq|kugou`），
     *    而 `pure/sourceIcons.MUSIC_COOKIE_ICON`、`pure/credentialCheck.DOMESTIC_MUSIC_SOURCES` 与
     *    设置页 `DL_COOKIE_ROWS` 三者的键集合被单测互相钉死（加一个键不改另两处 = 编译期或单测立刻红）。
     *    更要紧的是**语义不同**：`musicDlCookies` 是「按平台下载歌曲」的登录态，B 站这条是
     *    「读 B 站字幕 / 音频」的登录态 —— 混进同一张表会让「测试连接」按音乐源那套逻辑去测它。
     *    用户的原话是「放在**那一行下面**」（界面位置），⛔ 不是「并进那张表」。
     *
     * 🔴 **不填也能用**：B 站的公开字幕接口（`x/player/wbi/v2`）免登录就能拿到**已公开**的字幕；
     *    填了 Cookie 才能看到「仅登录可见」的以及更稳地过风控。⇒ 空值是合法缺省，⛔ 别在读取端兜底成假值。
     * 🔴 **2026-11-02 复用**：用户裁定「B 站网络集要能用内置播放器播 + 支持填 Cookie 冲 1080p」，
     *    而 1080P 与字幕都要登录态 ⇒ **同一条 Cookie 两个用途**（播放取流 / 字幕接口）。
     *    ⛔ 不为播放另开一个字段：同一凭据存两份，用户改了 A 却不知道 B 还是旧的。
     * ⚠️ 明文存 `data.json`（与各源 API Key、音乐 Cookie 同款），说明写在行内描述里，⛔ 不做额外加密。
     */
    biliCookie?: string;
    /**
     * 🔴 ③-3（2026-11-12 用户 m00353）：「扫码成功返回的 `refresh_token` **必须持久化**」。
     *
     * B 站扫码登录（`modals/QrLoginModal` → `services/qrLogin.pollQrLogin`）在成功那一轮
     * 会同时给出 Cookie 与 `refresh_token`；后者是**唯一能续期的凭据** ——
     * Cookie 里的 `SESSDATA` 有固定有效期，过期后只有拿 `refresh_token` 走
     * `passport.bilibili.com/x/passport-login/web/cookie/refresh` 才能换回新的一套。
     * ⇒ 只存 Cookie 不存它 = 用户过几周又得重扫一次（用户明确不接受）。
     *
     * ⚠️ **append-only 可选字段**：旧数据没有这个键 ⇒ `undefined`，一切照旧走「Cookie 有效就用到失效」。
     * ⛔ 别在 `DEFAULT_SETTINGS` 之外做迁移、⛔ 别把它塞进 `credentialStatus`（那是 boolean 结论表）。
     * ⚠️ 与 Cookie 同一条口径：明文存 `data.json`（与各源 API Key 同款），⛔ 不做额外加密。
     * 🔴 失效处理：`refreshBiliCookie` 返回 `null` 时**只清这一个键**，⛔ 别顺手清 `biliCookie`
     *    —— 刷新失败不等于 Cookie 立刻失效，用户可能只是网络断了。
     */
    biliRefreshToken?: string;
    /**
     * 🔴 用户 2026-11-09 裁定：「播放器继续接入 youtube 网络集」+ 选定「新增代理设置项」。
     *
     * YouTube 的取流口只能靠 `yt-dlp` 子进程，而**本机实测**：直连
     * `googlevideo.com` 一律 `ETIMEDOUT`，yt-dlp 自己是从环境代理
     * `http://127.0.0.1:7897` 走出去的才成功 ⇒ 插件必须能把代理显式传给子进程。
     *
     * 值形如 `http://127.0.0.1:7897`（也接受裸 `127.0.0.1:7897`，读取端会补 scheme）。
     * ⛔ 空值是合法缺省 = 直连（海外用户就是这样），别在读取端兜底成 `127.0.0.1:7897`
     * —— 那会把「我没配」变成「我配了个错的」，报错更难懂。
     */
    ytProxy?: string;
    /**
     * YouTube 的浏览器 Cookie（`Netscape` 或裸 `name=value; …` 都接受）。
     *
     * 🔴 为什么要单独一条、不复用 `biliCookie`：两个站点的域与登录态完全无关，
     *    复用会让「填了 B 站 Cookie」变成「YouTube 也以为登录了」，实际仍然被风控。
     *
     * ⚠️ 真机实测：**部分**视频无 Cookie 也能取（`dQw4w9WgXcQ` 可以），
     *    另一些直接 `Sign in to confirm you're not a bot` ⇒ 这条是「遇到风控时的解」，
     *    不是必填。空值合法。
     */
    ytCookie?: string;
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
    /**
     * 🔴 ③-1（2026-11-12 用户 m00353）：「统一周期管理」状态面板要显示**上次检测时间**。
     *
     * 键与 `credentialStatus` **逐字同源**（`source:` / `music:` / `net:` 前缀族）；
     * 值 = `Date.now()` 毫秒。**没有键 = 没测过**（与结论表同一口径）。
     *
     * ⚠️ 为什么单开一张表、不把 `credentialStatus` 改成 `{ok, at}` 对象：
     *   那个字段已被 #589 的「重启后仍显示连接失败」口径钉住，值**必须是 boolean**
     *   （`normalizeCredentialStatus` 会把非 boolean 丢掉）；改结构会让所有旧数据静默失效。
     *   两张表同写同清（见 `main.ts` 的 `setCredentialStatus` / `clearCredentialStatus`），
     *   ⛔ 别只写一张 —— 那会让面板出现「有结论但没时间」或反之的鬼状态。
     */
    credentialCheckedAt?: Record<string, number>;
    /** 阅读翻译服务商（'zhipu' 智谱 GLM / 'deepseek' / **'siliconflow'（#480）** / **'custom' 自定义 OpenAI 兼容端点（#478）** / 'off' 不启用；
     *  默认 zhipu。批3 r3 双源。
     *  append-only 可选字段；'off' 由 normalizeAiChoice 认，勿用 normalizeProvider 归一（会把 off 吃掉）） */
    readerTranslateProvider?: AiProviderChoice;
    /**
     * 🔴🔴 2026-11-06（用户逐字：「AI集成-用途页重构，在顶部设置一个全局默认AI模型
     * （下方的所有服务全部继承这个）」）—— **全局默认 AI 模型** 的服务商与模型名。
     *
     * 🔴 **为什么是一个「动作」而不是一条「持续约束」**：本仓五个服务（翻译 / 总结 / 搜索 /
     *    预填 / 字幕总结）各自都有一份独立的 `reader*Provider` + `reader*Model`，且**必须**保持独立
     *    —— 那是 #478~#511 一路定下来的（用户可以只让翻译走 DeepSeek、总结继续走智谱）。
     *    若把「全局」做成一条**运行时覆盖**（服务没配就回落全局），就必须区分「用户主动选了不启用」
     *    与「用户没配过」这两件事，而它们现在都是同一个值 `'off'` ⇒ 只能新增一个三态取值，
     *    那会动到 `pure/translate.normalizeAiChoice` 这条公共归一链（有既有单测钉着）。
     *    ⇒ 本轮取**用户在设置页点一次、把值一次性铺到五个服务上**的做法：
     *      点完的**结果**就是「全部继承」，之后任何一张卡仍可单独改（那就是覆盖）。
     *      ⚠️ 所以这两个字段存的是**上一次全局选择**（回显用），⛔ 别把它当运行时真源。
     *    append-only 可选字段。
     */
    aiGlobalProvider?: AiProviderChoice;
    /** 全局默认 AI 模型的**模型名**（与上面 `aiGlobalProvider` 成对；空 = 该服务商默认模型） */
    aiGlobalModel?: string;
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
    /**
     * 🔴 字幕总结服务商（详情页时间轴面板那颗 ✨ 用它跑）。
     *
     * 用户 2026-11-11 裁定：「在设置页为字幕总结单独开一组服务商/模型」
     * —— 与翻译 / 总结 / 搜索 / 预填**各自独立**可调，但共用同一组 Key
     * （服务商只决定「用哪家跑」，凭据不重复配置，本仓既有口径）。
     * append-only 可选字段。
     */
    readerCueSummaryProvider?: AiProviderChoice;
    /** 字幕总结自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_CUE_SUMMARY_PROMPT。append-only 可选字段 */
    readerCueSummaryPrompt?: string;
    /**
     * 字幕**提问**自定义提示词（system）；留空/缺省 = 用 DEFAULT_CUE_ASK_PROMPT。
     *
     * 🔴 用户 2026-11-11（第二轮）：「给字幕面板的AI改现代化点，如透明化去边框，给加个提问框」
     * ⚠️ 刻意与 `readerCueSummaryPrompt` 分开两格：总结要 JSON + 分点，提问要自然语言 + 克制，
     *    硬塞进一个 prompt 会互相打架（模型会拿总结的规矩去答问题，答出个 JSON 壳）。
     *    append-only 可选字段。
     */
    readerCueAskPrompt?: string;
    /** 划词搜索自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_SEARCH_PROMPT。append-only 可选字段 */
    readerSearchPrompt?: string;
    /**
     * #478 翻译 / 总结 / 搜索各自的**模型名**（空/缺省 ⇒ 该服务商的默认模型）。
     * append-only 可选字段。存的是**最终字符串**（不是选项下标）—— 模型 ID 会随官方变更，
     * 设置页给「预置下拉 + 自定义手填」（`pure/translate.PROVIDER_MODELS` 只是候选，⛔ 不是穷举）。
     */
    readerTranslateModel?: string;
    readerSummaryModel?: string;
    /** 字幕总结的模型名（空/缺省 ⇒ 该服务商的默认模型）。append-only 可选字段 */
    readerCueSummaryModel?: string;
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
    /**
     * 🔴🔴 #721（2026-11-07 用户：「笔记属性配置也可增删，删除后不拉取改属性字段」）：
     * **不写出**的属性键。与 `fieldOrder` / `fieldOrderByKind` 是两个正交的维度 ——
     * 那两份管「先后」，这一份管「写不写」。
     *
     * 形态：`{ [target]: string[] }`，`target` 与设置页的分页键同口径 ——
     *   · `'__global'`：全局属性（对六个类型**都**隐藏）；
     *   · 某 `EntryType`（`movie` / `book` / …）：该类型的专属属性；
     *   · `'k:<BookKind>'`（`k:novel` / `k:comic`）：书籍子类各自的专属属性。
     *
     * 🔴 **为什么必须单独存一份**：`normalizeFieldOrder` 有一条保命规则 ——
     *    允许集里有、配置里没有的键会**补到末尾**（否则以后新增字段会直接「写不出来」）。
     *    所以「不在顺序数组里」表示的是「排到最后」，**表达不了删除**。删除只能是显式排除集。
     *
     * ⚠️ **结构性键不可隐藏**（`id` / `type` / `title` / `created` / `updated`）——
     *    由 `pure/fieldOrder.FIELD_ORDER_LOCKED_KEYS` 把关，设置页 UI 也不给入口。
     * ⚠️ append-only 可选键，零迁移：缺席 = 什么都不隐藏（老用户观感零变化）。 */
    fieldOrderHidden?: Record<string, string[]>;
    /**
     * 🔴🔴 1.5.1（用户 2026-11-27）：「高级设置里增加个自由删减各类型条目属性展示的面板，然后可以
     * 预览拖动调整剩下的属性的编辑属性窗口」⇒ **按条目类型各一份的「编辑窗口属性块」配置**。
     *
     * 数组 = 该类型**要显示**的表单块键，**顺序 = 渲染顺序**（键是表单向的块 id，如 `summary` /
     * `comic-author-artist`，⛔ 不是 frontmatter 键名 —— 别拿 `META_FIELDS` 的 key 来对）。
     *
     * ⚠️ `Partial` 语义 ⇒ **只存被用户动过的类型**，没动过的走 `pure/entryFormFields` 的缺省
     *    （全显示、模板原顺序）。与缺省一致时 Settings 侧会 delete 该键 ⇒ 不落冗余数据。
     * 真源 / 归一 / 施加见 `pure/entryFormFields`（唯一真源）。 */
    entryFormFieldsByType?: Record<string, EntryFormFieldEntry[]>;
    /** 🔴 1.5.1：**书籍三子类各一份**的编辑窗口属性块（文学 / 网文 / 漫画）。
     *  🔴 **append-only 可选键，零迁移**：缺席 ⇒ 三个子类一律回落 `entryFormFieldsByType.book`
     *     （与 `fieldOrderByKind → fieldOrder.book`、`cardFieldsByKind → cardFieldsByType.book` 同一条回落链）。
     *  ⚠️ ⛔ 别往 `entryFormFieldsByType` 里塞 `novel` / `comic` —— 那张表按 `EntryType` 键。 */
    entryFormFieldsByKind?: Record<string, EntryFormFieldEntry[]>;
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
    // 🔴 m09565 ①-4：页签分类轴缺省 `expanded`（= 2026-11-08 起全类型十枚，升级不变脸）。
    tabAxis: 'expanded',
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
    // m02844：内置游戏启动器（**默认开** —— 见字段注释：缺省 false 会让老用户升级后点了没反应）
    internalGameLauncher: true,
    // #538 在线曲库检索（默认关：不主动开就与旧版行为一致）
    musicSongLibrary: false,
    musicDownloadEnabled: false,
    // #459：这两项的值 = **目录本身**（不再由代码拼 `音乐/` `书籍/` 子目录）⇒ 缺省就得带上子目录名，
    //   否则老用户/新装用户的默认落点会从 `下载/音乐` 变成 `下载/`（与既有文件分家、检索扫不到）。
    musicDownloadDir: DOWNLOAD_DIR_DEFAULT.music,
    bookDownloadDir: DOWNLOAD_DIR_DEFAULT.book,
    // m02844：游戏（swf）下载目录 —— 口径同上面两项（值 = 目录本身），
    //   缺省就得带 `Flash 游戏` 这一层，否则默认落点会从 `下载/Flash 游戏` 变成 `下载/`。
    gameDownloadDir: DOWNLOAD_DIR_DEFAULT.flash,
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
    // 本地音频转文字（第二期「用户自装」版）：三项留空 = 走 PATH / 模型未配置
    // ⚠️ 留空是**合法缺省**，⛔ 别在这里预填任何路径（预填等于假装用户装好了）
    asrExePath: '',
    asrFfmpegPath: '',
    asrModelPath: '',
    // 模型下载目录：留空 = `~/.reelludic/models`（⛔ 默认不放库里，见字段注释）
    asrModelDir: '',
    // 语言缺省 auto（让它自己判）；线程 0 = 不传 -t
    asrLang: 'auto',
    asrThreads: 0,
    // 引擎缺省 = 内建那家（另两家要用户自备环境，⛔ 不能默认选中一个跑不起来的）
    asrEngine: 'whisper',
    // Qwen3 桥接两件（空 = 没配这一家，选它时给引导而不是报错）
    asrPythonPath: '',
    asrBridgeScript: '',
    // 极速版三件（程序 / 模型 / 词表）：与 whisper 那两槽位**分开存**，⛔ 别复用（见字段注释）
    asrSenseVoiceExePath: '',
    asrSenseVoiceModelPath: '',
    asrTokensPath: '',
    // 另两家的档位（缺省 = 各自的最小/最稳那一档；归一函数在 `pure/asrBundles`，认不出就回落这里）
    asrQwenTier: '0.6B',
    asrSvVariant: 'int8',
    // 新增三家的档位（缺省 = 默认档；归一函数在 `pure/asrBundles`，认不出就回落这里）
    // ⚠️ X-ASR 只存 chunk 档（160/480/960/1920），列表里只算一行，四档在配置面板里切
    asrParaVariant: 'int8',
    asrXasrChunk: '1920',
    asrConfuciusTier: 'Q4_K_M',
    // 学习模式查词词典（空 = 没配，悬停只显示词形 + 🔊，⛔ 不报错）
    dictPath: '',
    // 2026-10-25：B 站 Cookie（空 = 免登录，只能拿到已公开的字幕）
    biliCookie: '',
    // ③-3：B 站扫码登录拿到的续期凭据（空 = 没扫过码 / 已失效；Cookie 仍可用）
    biliRefreshToken: '',
    // YouTube 取流的两条前置（都不填也能工作：直连 / 无 Cookie，能取到多少算多少）
    ytProxy: '',
    ytCookie: '',
    // 凭据测试结论（空表 = 全部「还没测过」；⛔ 别预填任何 false）
    credentialStatus: {},
    // ③-1：结论的检测时刻（空表 = 没测过；键集合与上表同源，⛔ 别预填 0）
    credentialCheckedAt: {},
    // 🔴🔴 2026-10-25 用户裁定（默认值收紧）：「默认配置下 设置-AI集成-用途 默认全部为不启用」。
    //
    // 为什么必须写在这里、而不是去改 `normalizeAiChoice` 的兜底：
    //   `normalizeAiChoice(undefined)` 原来回退 `DEFAULT_TRANSLATE_PROVIDER`（= 'zhipu'）⇒ 四行默认「已启用」。
    //   若把那个兜底改成 'off'，**所有脏数据**（拼错的字符串、旧版遗留的怪值）都会变成「不启用」，
    //   且 `DEFAULT_TRANSLATE_PROVIDER` 的类型是 `TranslateProvider`（不含 'off'）—— 改不得。
    //   ⇒ 正道是在 DEFAULT_SETTINGS 里**显式声明默认值**：新装用户与从未存过这几键的老用户都拿到 'off'，
    //     而任何**显式设过服务商**的用户（data.json 里有该键）由 `Object.assign` 覆盖，行为不变。
    //
    // ⚠️ 四行各自独立（与设置页四个下拉一一对应），⛔ 别只写一行指望其余继承。
    // ⚠️ 「朗读音源」那一行不算在内：它是 `system | cloud` 音源切换，**没有「不启用」这个档**
    //     （见 `renderTtsVoiceRow` / `pure/tts.TtsEngineKind`），不属于「AI 服务商」默认值。
    readerTranslateProvider: AI_PURPOSE_DEFAULT,
    readerSummaryProvider: AI_PURPOSE_DEFAULT,
    readerSearchProvider: AI_PURPOSE_DEFAULT,
    readerPrefillProvider: AI_PURPOSE_DEFAULT,
    // 字幕总结（详情页时间轴面板 ✨）：第五行同样独立、同样默认「不启用」——理由同上。
    readerCueSummaryProvider: AI_PURPOSE_DEFAULT,
    // 🔴 2026-11-06（用户逐字）：「在顶部设置一个全局默认AI模型（下方的所有服务全部继承这个）」
    //    ⇒ 「用途」页顶部那颗「全局默认模型」的**回显值**。
    //    ⚠️ 默认 `AI_PURPOSE_DEFAULT`（= 'off'）而不是某个真服务商：新装用户没配过任何 Key，
    //       预先点亮 "zhipu" 会让那颗按钮读起来像「已经设好了」。
    //    ⚠️ 空模型名 = 用该服务商的默认模型（与各服务行同口径，`shownModel` 会补齐缺省）。
    aiGlobalProvider: AI_PURPOSE_DEFAULT,
    aiGlobalModel: '',
    // 🔴 2026-11-27（m06545）：原这里还有第七行 `aiChatProvider`（AI 悬浮挂件），已随挂件删除。
    //    ⛔ 别补回来 —— 它对应的设置页服务行与字段都已不存在。
};

export const PLATFORM_URL_PRESETS: Record<string, string> = {
    B站: 'https://www.bilibili.com/search?keyword=',
    Netflix: 'https://www.netflix.com/search?q=',
    豆瓣: 'https://search.douban.com/movie/subject_search?search_text=',
    爱奇艺: 'https://so.iqiyi.com/so/q_',
    腾讯视频: 'https://v.qq.com/x/search/?q=',
};

/** ① 搜索配置折叠项内**需 Key 源**展示顺序（spec S5 + IGDB 回归：Douban/TMDB/Bangumi/OMDb/Google Books/IGDB；遍历 PROVIDERS 派生，本表定序） *  ⛔ 2026-09-29：原来还有一张「免 Key 源展示顺序」表（Open Library/Steam/MusicBrainz/iTunes/AniList）——
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
 * 「用途」组一个条目的定义（主从两栏共用这一份真源：⛔ 别在左栏和右栏各列一遍）。
 * 字段含义见 `aiServiceDefs()` 的实例表。
 *
 * 🔴 #723（2026-11-07 用户裁定）：**删掉「全局默认模型」那一档** —— 它带来的
 *   「先选一个默认、再一键铺到五处」是第二套心智模型，而用户真正要的是「每个场景各自选」。
 *   ⇒ `prompt` 现在恒为必填对象、`applyAll` 字段**整套退场**（右栏不再有「应用到全部服务」）。
 *   ⚠️ `plugin.settings.aiGlobalProvider / aiGlobalModel` 两个**存储字段仍保留**（老 data.json
 *   里可能已有值，删字段会让 `loadData` 把它们当脏数据；它们现在只影响 `normalizeAiChoice`
 *   的兜底语义，界面上不再暴露）。⛔ 别顺手把字段也删了。
 */
type AiServiceDef = {
    id: string;
    name: string;
    desc: string;
    sceneTitle: string;
    /** 该条目是否为所在分组的第一个（左栏在它上方插一条分组标签） */
    groupTop?: boolean;
    getProvider: () => unknown;
    setProvider: (v: AiProviderChoice) => void;
    getModel: () => string | undefined;
    setModel: (v: string | undefined) => void;
    prompt: { label: string; value?: string; defaultText: string; onSave: (v: string | undefined) => void };
};

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
        desc: '登录 music.163.com 后复制 Cookie 以搜索和同步清单',
    },
    {
        id: 'qq',
        name: 'QQ 音乐',
        site: 'y.qq.com',
        desc: '登录 y.qq.com 后复制 Cookie 以搜索和同步清单',
    },
    { id: 'kugou', name: '酷狗音乐', site: 'kugou.com', desc: '登录 kugou.com 后复制 Cookie' },
];

/**
 * ④-A 音视频取流（yt-dlp）那行的行内说明 —— 与上面三条 `desc` 同款：**纯文本**
 * （`createDiv({ text })`，不解析 markdown）⇒ ⛔ 不许写 `**`。
 *
 * 🔴 2026-11-09（第 15 轮需求④，用户当面给了逐字口径）：**整条换成短句**，
 *    用户原文是一句里两半「yt-dlp 可执行文件路径，留空 = …；ffmpeg 可执行文件路径，留空 = …」，
 *    这里对应两个输入框 ⇒ 拆成 `YTDLP_PATH_DESC` 与 `FFMPEG_PATH_DESC` 两条 hint，
 *    各自紧贴自己的输入框（合写成一条会让第二半离自己的框太远）。
 *    ⚠️ 旧文案里的「mp3 还要 ffmpeg（放 yt-dlp 同目录或系统 PATH 中）」被用户口径顶掉了 ——
 *    「留空 = 自动在系统 PATH 里找」已经覆盖「放哪儿」，⛔ 别再把长解释塞回去。
 */
const YTDLP_PATH_DESC = 'yt-dlp 可执行文件路径，留空 = 自动在系统 PATH 里找';

const ASR_EXE_DESC =
    '本地识别程序的可执行文件。留空 = 让插件在系统里自动找（whisper-cli / main / whisper-cpp 都认，老版本 whisper.cpp 编译出来叫 main）。只有自动找不到、你又装在了特别的位置时才需要填。';
const FFMPEG_PATH_DESC = 'ffmpeg 可执行文件路径，留空 = 自动在系统 PATH 里找';
const ASR_MODEL_DESC =
    'whisper.cpp 的识别模型（ggml 格式，.bin）。体积越大越准也越慢；日常用 base，中文要更准可以用 small 以上。模型不随插件分发 —— 点上面卡片里的「下载模型」由插件替你下，或者自己从别处下载后填路径。';
const ASR_TOKENS_DESC =
    '极速版专用的词表文件 tokens.txt（与 model.int8.onnx 在同一个发布包里，一起下载即可）。另两家不需要这一项。';
/**
 * 极速版的识别程序与模型。
 * 🔴 2026-12（m05240）拆卡片时必须有这两条独立的说明：原先三家用同一段 `ASR_MODEL_DESC`，
 *    而那段讲的是 whisper 的 ggml —— 展开极速版却看到「用 whisper.cpp 的 ggml 模型」等于骗人。
 */
const ASR_SV_EXE_DESC =
    'sherpa-onnx 的可执行文件 sherpa-onnx-offline.exe。它要和同目录下的几个 dll 待在一起，别只把它单独拷出来用。';
const ASR_SV_MODEL_DESC =
    'SenseVoice 的识别模型 model.int8.onnx（约 228MB）。纯 CPU 也能跑，中文与中英混说都支持。';
/**
 * 「当前文字识别模型」这块的说明。
 *
 * 🔴🔴 2026-11-11 用户 m09233（逐字）：「删除掉描述文字『把音视频里的声音识别成字幕，全部在本机完成』
 *    选择模型(小标题分组，这没用排序了删除掉) 左边按大模型分组平铺所有档位，随时能看到体积与中/英
 *    准确度；右边是当前选中项的配置与环境检查。六家都在，不会按装没装隐藏。」
 *    ⇒ 这段「左边按大模型分组平铺…」**连同小标题「1 选择模型」一起退场**，界面直接从左导航 + 档位格开始。
 * ⛔ 常量整条删掉了（不留空字符串）：留着就有人会顺手接回去。要恢复说明请重新写，别指望旧文案。
 */
/**
 * 三家引擎在设置页用的图标（与 `ASR_ENGINES` 的 id 一一对应）。
 * ⚠️ 三个名字都已在 `obsidian.asar` 图标表里实测存在（`feather` / `brain` / `zap`），
 *    写错会被 `setIcon` 静默吞掉、界面留白且零报错。
 */
const ASR_ENGINE_ICONS: Record<string, AiIcon> = {
    whisper: { kind: 'builtin', id: 'feather' },
    qwen3: { kind: 'builtin', id: 'brain' },
    sensevoice: { kind: 'builtin', id: 'zap' },
};

/**
 * 「使用哪一家引擎」这段的文案（用户 m04641「按需加载，要有不能没有」之后补）。
 *
 * 🔴 必须讲清三件事，否则用户会以为另外几家是坏掉的：
 *  ⑴ **六家都在**，不是按安装情况显隐 —— 藏起来等于宣称这家不存在；
 *  ⑵ **只有 Whisper 的模型随插件一键下载**，其余各家要么靠插件的安装器补齐、要么要你自己的本地环境；
 *  ⑶ **都不能上传**，识别一律在本机完成。
 * ⚠️ 纯文本（不解析 markdown）⇒ ⛔ 不许写 `**`。
 */
const ASR_ENGINE_DESC =
    '六家都能选，识别全部在本机完成。Whisper 与 SenseVoice / Paraformer / X-ASR / Confucius4 的运行时和权重可以在这里一键装好；Qwen3-ASR 需要你自己已经装好 Python 环境，插件只负责调用它。';
const ASR_PYTHON_DESC =
    '中文精准版用的 Python 解释器完整路径（通常是某个虚拟环境里的 python.exe）。留空 = 没有配置这一家，选它时会给出引导而不是报错。';
const ASR_BRIDGE_DESC =
    '中文精准版用的桥接脚本完整路径（cli_bridge.py）。要和上面的 Python 解释器配套 —— 只填一个等于没配。';

/**
 * 「学习模式 · 悬停查词」那几行的说明文案。
 *
 * 🔴 #723（2026-11-07 用户裁定）：**删掉了原先那段「学习模式里把鼠标停在一个单词上时…」的长说明**
 *   （原 `DICT_DESC`，整经常量已一并删除）。用户原话点名要删的正是那三句 —— 它们把
 *   「为什么、留空会怎样、去哪拿」全讲了一遍，但这一行上面已有 `name` 与下面这句格式说明，
 *   再说一遍只是噪音。⇒ 现在本组只剩 `DICT_PATH_DESC` 一条说明。
 *   ⚠️ 想恢复那段话之前先想清楚：它在页面上占两行，而「留空 = 不查词」这句
 *   `DICT_PATH_DESC` 末尾已经说过了（不重复写在两处，是本页的一贯口径）。
 */
const DICT_PATH_DESC =
    '支持两种格式：ECDICT 导出的 CSV（word,phonetic,definition 三列），或你自己整理的「词<TAB>释义」纯文本表。留空 = 不查词。';

/**
 * 「网络播放」组里 **B 站那行**的行内说明。
 *
 * 🔴 与音乐源那三条 `desc` 同款：**纯文本**（`createDiv({ text })`，不解析 markdown）⇒ ⛔ 不许写 `**`。
 * 🔴 三件必须说清：⑴ 它干什么用；⑵ **不填会怎样**（不是「不能用」，而是「最高 720P」）；
 *    ⑶ 到哪去拿（⛔ 只说「请填 Cookie」，用户不知道从哪复制）。
 *
 * 🔴 2026-10-31 搬家（用户裁定「把网络播放组放在音乐下载源下」）：这段文案原来挂在
 *    「音乐下载源凭据 › B站音频流」行里（描述的是**下载音频**那个用途），现在这行搬进
 *    「网络播放」组、描述的是**内置播放器取流** ⇒ 文案跟着用途改写。
 *    ⚠️ `biliCookie` 仍是**同一个字段**：取流冲 1080P 与读字幕要的就是同一份登录态
 *    （见 `Settings` 里 `biliCookie` 的字段注释），⛔ 别为播放另开一个字段（存两份必然漂）。
 */
const BILI_COOKIE_DESC =
    '登录 bilibili.com 后按 F12 进入 Network 面板，刷新页面并复制任意请求 Headers 中的整条 Cookie 以正常登录态iframe播放及显示AI字幕';

/**
 * 「网络播放」组里 **YouTube 那行**的行内说明。
 *
 * 🔴 2026-11-09（第 15 轮需求④，用户当面给了逐字口径）：文案换成 Cookie 那半句。
 *    ⚠️ 代理那半句**没有丢**——它由下面 `YT_PROXY_LABEL`「代理地址（留空 = 直连）」承担，
 *    且紧贴代理输入框，比塞在这段总说明里更靠近它要解释的那个框。
 *    所以这里只讲 Cookie，⛔ 别再把它扩回「代理 + Cookie」的长段。
 * ⚠️ 纯文本（`createDiv({ text })`，不解析 markdown）⇒ ⛔ 不许写 `**`；
 *    用户原文里 `**EditThisCookie**` 的星号已按他本人裁定去掉（否则星号会原样露在页面上）。
 */
const YT_NET_DESC =
    '登录 youtube.com 后复制完整 cookies（推荐浏览器插件 EditThisCookie一键复制）以正常登录态iframe播放及显示AI字幕';

/** 「网络播放」组里 YouTube 行两个输入框的行内小标签（类名见 styles.css 的 `.rl-net-lbl`）。 */
const YT_PROXY_LABEL = '代理地址（留空 = 直连）';
const YT_COOKIE_LABEL = 'Cookie（可选）';

/**
 * 🔴🔴 本轮用户裁定：「Google Books 的配置标签从『可选Key』统一为『未配置』」
 *     ⇒ 原先这里有 `OPTIONAL_KEY_SOURCES = new Set(['googleBooks'])`，只服务徽标那两个字；
 *    用户要求全页只留「已配置 / 未配置」两套词后它**没有存在理由**了，整个集合与分支一起删除
 *    （⛔ 别退回「集合留空但分支还在」——那是死码，下次有人往里加一个 id 就静默复活第三套文案）。
 *
 *  ⚠️ 「可选 Key」从来只管徽标，与「不填凭据能不能搜」是两码事 —— 后者在 `main.ts` 的
 *     `OPTIONAL_KEY_AUX`（`providerConfigured`），两处解耦，**那边一个字没动**：
 *     googleBooks / weread 仍然免登录可搜，只是设置页不再标「可选」。
 */

/** 折叠 API 行的测试结果类型 */
export interface SourceTestResult {
    ok: boolean;
    message: string;
    /** 完整链路耗时（ms，发起请求到收到响应/失败/超时），恒返回 */
    elapsedMs: number;
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

/**
 * 🔴 #718（用户第⑧条）：**编辑窗口预览里那一块该画成什么控件**。
 *
 * 依据是 `src/views/components/EntryForm.svelte` 里每个 `data-fld` 块真实的渲染标签
 * （逐条核对过：`<input class="rl-input">` / `<textarea>` / `.rl-meta-row` 四格 / `.rl-lbl-row` 带按钮）。
 * ⛔ 别再拿「属性名长什么样」去猜控件类型 —— 那正是上一版只能画一个通用伪输入框的原因。
 *
 * 五种形态：
 * - `text`  单行输入（大多数：题材 / 年份 / 作者 / 出版社…）
 * - `num`   数字输入（`type="number"`：总集数 / 页数 / 系列序号 / 游戏时长…）
 * - `area`  多行文本域（简介 / 导演 / 主演 / 作者简介 / 目录）
 * - `btn`   标签行 + 右侧按钮（总结摘要 AI / 歌词 / 阅读进度）
 * - `meta`  一行四格（「来源 / 大众评分 / 评价人数 / 平台链接」）
 */
function entryFormControlKind(key: string): 'text' | 'num' | 'area' | 'btn' | 'meta' {
    switch (key) {
        case 'meta':
            return 'meta';
        case 'summary':
        case 'director':
        case 'cast':
        case 'author-intro':
        case 'toc':
            return 'area';
        case 'lrc':
        case 'ai-summary':
        case 'book-progress':
            return 'btn';
        case 'total-episodes':
        case 'episode':
        case 'pages':
        case 'series-index':
        case 'playtime':
        case 'read-hours':
        case 'novel-chapters':
        case 'comic-chapters':
            return 'num';
        default:
            return 'text';
    }
}

/*
 * 🔴 #480：`renderAiIcon` / `aiChoiceIcon` 已搬到 **`services/aiIcon.ts`** —— 设置页与「服务商+模型」
 *    拣选弹窗两处共用，而两者的 **fill 分治**（品牌标填充式 / 内置标描边式）只许有一份。
 * `aiChoiceLabel` 搬到 **`pure/translate.ts`**（下拉选项与显示名同源）。
 * `keyRowIcon` 已删 —— #480 起 `siliconflow` 就是 `TranslateProvider` 的一员，直接查表即可。
 */

/**
 * 🔴 #721：在「只看得见一部分项」的情况下把 `from` 挪到 `to` 的位置。
 *
 * 为什么不直接用 `moveItem(order, from, to)`：那个按**数组下标**挪，而列表里画的是
 * 「`order` 过滤掉隐藏项」后的视图 —— 下标与真数组对不上，混着隐藏项时会挪错位、甚至
 * 把隐藏项挤到别的相对位置。这里改成**按 key** 操作：
 *   ⑴ 把 `from` 从数组里摘出来；
 *   ⑵ 找 `to` 在摘除后的数组里的位置，按原先后决定插到它**前面**（上移）还是**后面**（下移）。
 *
 * ⚠️ 隐藏项一个都不动：它们既不在视图里、也不参与比较，摘除 + 插回全程不碰它们的下标。
 * ⚠️ `from` / `to` 有一方不在数组里（列表刚重画、状态错位）⇒ **原样返回**，⛔ 别硬挪出一个非法顺序。
 */
function moveInVisibleOrder(order: readonly string[], from: string, to: string): string[] {
    const fi = order.indexOf(from);
    const ti = order.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return [...order];
    const out = [...order];
    out.splice(fi, 1);
    // 摘除后 from 已不在，`to` 的位置即落点基准
    const base = out.indexOf(to);
    out.splice(fi < ti ? base + 1 : base, 0, from);
    return out;
}

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
    /** 🔴 m02844「游戏下载目录」输入框的同款实例 —— 与前两个**各存一份**（四个输入框可能先后各开一个浮层，
     *  共用一个字段会让先开的那个失去引用、关不掉）。⚠️ 同样要在重渲染 / 关闭设置页时 `close()`。 */
    private gameFolderSuggest: FolderInputSuggest | null = null;
    /** 🔴 #425 起三个目录输入框的自动补全实例各存一份（见上）；#562 又添四个"分类本地目录"输入框
     *  —— 它们**共用**本 Map（一个「本地目录」浮层同时只可能开一个，用不到各存一份的粒度）。
     *  但**键必须包含键名**：同一个键的输入框在重绘后是**新元素**，旧实例仍指向已卸载的 input，
     *  不 close 就会留下一个飘在已删节点旁边的孤儿浮层。 */
    private localDirSuggests = new Map<LocalDirKey, FolderInputSuggest | null>();

    /**
     * 🔴🔴 #758（2026-11-12 用户 `m07505` 逐字：「怎么我在搜索配置里配置了项和测试了连接但
     *   统一管理周期的不实时显示我的新增项」）—— 「统一周期管理」面板的**外部刷新入口**。
     *
     * 为什么要有这个字段：那张表的所有绘制逻辑（`paintRow` / `summaryEl`）原本只活在
     *   `renderCredentialTable` 的闭包里，**唯一**能触发重绘的是它自己那颗「一键检测」的 click。
     *   而用户真正会改数据的地方全在**别的行**上：
     *     · 元数据源凭据的 `onInput` / `onPicked` / `onLogout`（填了 Cookie / Key）
     *     · 音乐源凭据、网络播放凭据的同款写入
     *     · 各行里那颗「测试连接」（走 `plugin.setCredentialStatus`）
     *     · 开机自检（同样走 `setCredentialStatus`）
     *   ⇒ 填完/测完，上面那张表还是 `display()` 那一刻的快照，「是否配置 / 是否失效 /
     *     上次检测」三列全不动，用户看到的就是「不实时」。
     *
     * ⚠️ 为什么不改成切页时重建整个设置页：`setActivePage` 刻意**不重建 DOM**
     *   （见其注释），整页重建会把用户的滚动位置、各折叠组的展开态全部重置 ——
     *   为了刷新一张表付这个代价，是拿大 sledgehammer 敲小钉子。
     * ⚠️ 为什么不用事件总线（`app.workspace.trigger`）：本仓没有既存的设置页事件通道，
     *   为一张表新造一条全局事件注册/注销的生命周期，比一个回调字段更容易漏、更容易悬空。
     *   而设置页 DOM 是 `display()` 一次性建好的（`renderPage` 逐页渲染），
     *   那张表在打开设置页期间**一定存在**，回调字段的存活期与它天然对齐。
     *
     * 生命周期：`display()` 开头置 `null`（旧 DOM 已 `empty()`，旧闭包必须失效，
     *   ⛔ 别让一次刷新打到已卸载的节点上），`renderCredentialTable` 建表时赋上新闭包。
     * 调用方一律走 `refreshCredentialTable()`（带空守卫），⛔ 别直接碰这个字段。
     */
    private credentialTableRefresh: (() => void) | null = null;
    /**
     * 🔴 用户 m07854 ②（2026-11-13）：「统一周期检测的怎么不同步到对应的搜索配置项里」。
     *
     * 修 #758 时只打通了「搜索配置 → 面板」一个方向；反方向一直是断的 —— 面板顶上那颗
     * 「一键检测」跑完只会 `paintRow` 面板自己那一行，而下面「搜索配置」里同名那行的徽标
     * 是**另一个闭包**（各 builder 里自己捕获 `badge` / `current()`），没人通知它
     * ⇒ 用户看到「面板说连接失败，展开下面那行还写着已配置」。
     *
     * 键 = `pure/credentialCheck` 的 `sourceCheckKey` / `musicCheckKey` / `netCheckKey` /
     * `aiCheckKey`（**带族前缀**，⛔ 别用裸 id —— 三族 id 有重名）。
     * 值 = 该行自己的 `refreshBadge` 闭包，只重算徽标文字与两个类名，⛔ 不重建 DOM。
     *
     * 生命周期：`display()` 整页重建时清空（旧闭包指向已 `empty()` 的节点）；
     * 各 builder 建行时登记，行被重建则**同一键覆盖**（后建的那份才是活的）。
     */
    private credentialBadgeRefresh = new Map<string, () => void>();

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
    /**
     * 🔴 1.5.1「条目属性」组**当前正在配置的那一格**（八格：`f:<EntryType>` / `k:<BookKind>`）。
     * ⚠️ 同 `cardFieldsType`：只是「我现在在看哪一类」的视图状态，⛔ 别持久化。
     */
    private entryFormSlot = 'f:movie';
    /** 🔴 1.5.1：「条目属性」组的内容容器（挂「已保存」轻提示时反查组标题用） */
    private entryFormGroupEl: HTMLElement | null = null;
    /** 「已保存」轻提示本体（一次建好、反复点亮） */
    private entryFormToastEl: HTMLElement | null = null;
    /** 淡出定时器（只保留一个） */
    private entryFormToastTimer: number | null = null;
    /** 🔴 #479 「用途 › 模型」拉取到的真实模型清单（按服务商缓存）。#482 起**带真元数据** —— 见 `ModelFetched`。
     *  ⚠️ **只活在本次设置页会话**（实例字段），⛔ 不落库 —— 模型清单易变，存下来就是第二个「会过期的预置表」。 */
    private aiFetchedModels = new Map<TranslateProvider, ModelFetched[]>();
    /**
     * 🔴 2026-11-07「用途」主从布局：左栏**当前选中哪一条**（条目 id）。
     * ⚠️ 它是「此刻在看哪一项」的界面焦点，**不是用户配置** —— ⛔ 不写进 `plugin.settings`
    *    （落盘只会长出一个没人读的键）；与 `entryFormSlot` / `cardFieldsType` 同族。
     */
    private aiPick = '';
    /**
     * 🔴 #720b：条目属性栅格的列数观察器。
     *   设置页每次 `display()` 都整页重建 DOM ⇒ 旧观察器必须摘掉，否则越积越多（每个都还在观察已废弃的节点）。
     *   ⛔ 别换成全局单例：多个设置窗口并存时各自有自己的画布。
     */
    private efColsObs: ResizeObserver | null = null;
    /** #480 ④：试听用的两个引擎（**懒建 + 复用**；系统引擎会给 window 挂监听 ⇒ 必须能释放） */
    private ttsSystemEngine: SystemSpeechEngine | null = null;
    private ttsCloudEngine: CloudSpeechEngine | null = null;
    /** 系统语音 `voiceschanged` 只重绘一次（异步列表加载完那一趟），⛔ 别反复挂 */
    private ttsVoicesHooked = false;
    /**
     * 「选择模型」左列表是否展开了「其余模型家族」。
     *
     * 🔴 用户 m01935：「感觉太多模型了只留三个显示其他收起来」。
     * ⚠️ 故意**不落盘**：这是「看的时候的临时姿势」，不是偏好设置。
     *    落盘的话下次进设置页会莫名其妙全展开，用户还得再折一次。
     *    组内的「展开其余 N 档」更临时，连字段都不给，直接闭包变量。
     */
    private asrGroupExpanded = false;

    /**
     * 「选择模型」右侧配置面板是否展开。
     *
     * 🔴 用户 2026-11-10（m03035）：「设置页选择模型处默认折叠起来只有用户点击模型行才展开配置」。
     * ⇒ 初值 `false`（默认收起），点某一档的行才置 `true`。
     * ⚠️ 必须**存在实例字段**里：`switchAsrModel` 落盘后走 `display()` 整块重绘，闭包变量
     *    会跟着旧 DOM 一起没了 ⇒ 用户点了行、面板闪一下又收回，看起来像点了没反应。
     * ⚠️ 同样**不落盘**：这是看的姿势，不是偏好（与 `asrGroupExpanded` 同口径）。
     */
    private asrConfOpen = false;

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
        this.gameFolderSuggest?.close(); // m02844：游戏下载目录那颗
        this.gameFolderSuggest = null;
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
    /**
     * 造一个**多格共用**的就地校验提示槽的调度器。
     *
     * 🔴🔴 2026-10-25 用户裁定：「TMDB 行下的各个框间隔要同步 IGDB 行的」。
     *   真因 = 每格后面都插一条 `.rl-secret-issue`（`min-height:1.4em` + `margin-top:2px`），
     *   叠在 `.rl-key-body` 的 `gap:6px` 上 ⇒ 两框之间实际 ~34px；IGDB 两框之间只有 6px。
     *   ⇒ 提示槽改成**整行一个**，两个框直接相邻 = `gap:6px`，与 IGDB 逐像素一致。
     *
     * ⚠️ 共用一个槽就必须有**仲裁**，否则两格同时报错时后一次输入会把前一格的提示抹掉
     *   （用户正看着「Key 格填错」去改另一格，提示突然变成另一句，等于丢信息）。
     *   仲裁口径：**优先显示「刚刚编辑的那格」的错误**；刚编辑那格没错误时，再按登记顺序找第一条。
     *   ⛔ 不要改成「永远按登记顺序」：那样用户改第一格时，第二格的旧错误会把新提示压住。
     */
    private makeIssueSlot(): {
        register: (input: HTMLInputElement, issue: (v: string) => string | null) => void;
        /** 两个输入框都建好之后再调：把槽建到 `body` 末尾并首次渲染（顺序决定间距，⛔ 别提前建） */
        mountIn: (body: HTMLElement) => void;
        /** 把槽插到**某个已存在节点之后**（TMDB 用它挂到动作行下面，见 `renderKeyRow`） */
        mountAfter: (anchor: HTMLElement) => void;
    } {
        const regs: Array<{ input: HTMLInputElement; issue: (v: string) => string | null }> = [];
        let lastFired: HTMLInputElement | null = null;
        let slot: HTMLElement | null = null;
        const render = (): void => {
            if (!slot) return; // 还没挂到 DOM：输入事件不可能发生在 mount 之前，这里只是防御
            const order: Array<{ input: HTMLInputElement; issue: (v: string) => string | null }> = [];
            if (lastFired) {
                for (const r of regs) if (r.input === lastFired) order.push(r);
            }
            for (const r of regs) if (r.input !== lastFired) order.push(r);
            let msg: string | null = null;
            for (const r of order) {
                const m = r.issue(r.input.value);
                if (m) {
                    msg = m;
                    break;
                }
            }
            slot.setText(msg ?? '');
            slot.toggleClass('is-empty', !msg);
        };
        return {
            register: (input, issue) => {
                regs.push({ input, issue });
                input.addEventListener('input', () => {
                    lastFired = input;
                    render();
                });
            },
            mountIn: (body) => {
                slot = body.createDiv({ cls: 'rl-secret-issue' });
                slot.addClass('is-empty');
                render();
            },
            mountAfter: (anchor) => {
                slot = document.createElement('div');
                slot.className = 'rl-secret-issue rl-secret-issue-tail';
                slot.classList.add('is-empty');
                anchor.insertAdjacentElement('afterend', slot);
                render();
            },
        };
    }

    private createSecretField(
        body: HTMLDivElement,
        opts: {
            placeholder: string;
            value: string;
            onInput: (v: string) => void;
            /** 就地校验文案（纯函数）；传了它才需要配 `issueSlot` */
            issue?: (v: string) => string | null;
            /**
             * 校验提示的**落点**（多格共用一个槽时由调用方传入，见 `makeIssueSlot`）。
             * 不传 = 本格自建一条（老路径，单格场景）。
             */
            issueSlot?: { register: (input: HTMLInputElement, issue: (v: string) => string | null) => void };
            /** 插在「输入框」与「显示/隐藏」之间的额外控件（扫码图标用，见 `fillSecretRow`） */
            beforeEye?: (wrap: HTMLDivElement) => void;
            /** 插在「输入框」**之前**的控件（扫码图标按 m05813 改到这里，见 `fillSecretRow`） */
            beforeInput?: (wrap: HTMLDivElement) => void;
        },
    ): HTMLInputElement {
        const wrap = body.createDiv({ cls: 'rl-secret' });
        const input = this.fillSecretRow(wrap, opts);        // 🔴 2026-10-25 用户裁定「占位说明也是」⇒ 光改占位不够：TMDB 两格**各只收一种**形态，
        //    填错格的人必须当场看见「你填错格了、该去哪拿」。旧版填错也能保存、要到点同步才 401，
        //    用户只能反复重填（#700/#701 就是这么来的）。
        //    ⚠️ 校验器是**纯函数**注入（`pure/tmdbAuth` 的 `tmdbApiKeyFieldIssue` / `tmdbSessionFieldIssue`），
        //      这里只管渲染 —— 文案与判据单测覆盖得到。
        //    ⚠️ 提示挂在 `.rl-secret` 行**之外**：行本身是 flex 行，塞进去会把输入框挤窄。
        //    🔴🔴 **高度恒定预留**：这个槽永远占一行（空态只清文字、不收起元素），否则用户打字时
        //       提示一闪现就把下面的动作行（立即同步 / 测试连接）整体往下顶 —— 那正是用户在
        //       「立即同步按钮后出来的提示也不要更改按钮位置」里刚提过的同一类毛病。
        //       ⛔ 别改成 `display:none` / 删节点：那会让按钮上下跳。样式见 `styles.css` 的 `.rl-secret-issue`。
        //    ⚠️ 多格共用槽时由调用方传 `issueSlot`（`renderKeyRow` 里 TMDB 双格就是这么做的）；
        //       每格各建一条会把两格间距撑到 ~34px（用户 2026-10-25 报的那条）。
        if (opts.issue) {
            if (opts.issueSlot) {
                opts.issueSlot.register(input, opts.issue);
            } else {
                const issueEl = body.createDiv({ cls: 'rl-secret-issue' });
                const syncIssue = (): void => {
                    const msg = opts.issue!(input.value);
                    // 空态写全角空格占位：`.rl-secret-issue` 的 min-height 已保住行高，
                    // 这里再留一个字符宽，避免某些主题把空 div 的高度算成 0（min-height 与 theme 变量打架时）。
                    issueEl.setText(msg ?? '');
                    issueEl.toggleClass('is-empty', !msg);
                };
                issueEl.addClass('is-empty');
                input.addEventListener('input', syncIssue);
                syncIssue();
            }
        }
        return input;
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
        opts: {
            placeholder: string;
            value: string;
            onInput: (v: string) => void;
            masked?: boolean;
            /**
             * 在「输入框」与「显示/隐藏」之间插一个额外控件（历史插槽，现无消费者）。
             * @deprecated 用户 `m05813` 改口径：扫码图标要放在**输入框最左边**，用 `beforeInput`。
             *   本插槽保留是因为 `createSecretField` 的类型仍对外暴露它，删了要动调用面；
             *   ⛔ 不要在新代码里用它 —— 它插在输入框**右侧**，正是用户点名不要的位置。
             */
            beforeEye?: (wrap: HTMLDivElement) => void;
            /**
             * 插在「输入框」**之前**的控件（扫码图标用）。
             *
             * 🔴 用户 `m05813` 原话：「把二维码小图标按钮放在 cookie 框的**最左旁**」。
             *    上一版按 m05505 放在「显示」左边（输入框右侧），本轮改为整行的最左端。
             * ⚠️ 顺序必须是 lead → input → eye：这是「行内首元素」，靠建序保证，
             *    ⛔ 别用 `order`/`flex-direction` 之类的 CSS 手段事后挪 —— 那会让 DOM 顺序与
             *    视觉顺序不一致，键盘 Tab 的次序与看到的次序就分家了。
             */
            beforeInput?: (wrap: HTMLDivElement) => void;
        },
    ): HTMLInputElement {
        const masked = opts.masked !== false;
        // 最左旁的额外控件（扫码图标）：必须在 input 之前建，见 `beforeInput` 的注释
        opts.beforeInput?.(wrap);
        const input = wrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: opts.placeholder, type: masked ? 'password' : 'text', spellcheck: 'false' },
        });
        input.value = opts.value;
        opts.beforeEye?.(wrap);
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
     * #354 标签由「数据源管理」改成「数据源配置」；**#422 再改成「搜索配置」** ——
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
        //    ⚠️ **页签名「搜索配置」不动**（用户只点了三个组名）—— 导航图标表同理，见 `pure/settingNav`。
        // 🔴🔴 2026-11 用户裁定（本轮）：「搜索配置页把『元数据搜索源启用』组移到第一顺位」。
        //    ⇒ 本页组序改为 **启用 → 搜索源凭据 → 网络播放源凭据 → 音乐下载源凭据**：
        //    用户的心智起点是「我要搜哪几类、每类用哪些源」（勾选决定一切），凭据是它的下游配套
        //    ⇒ 勾选在最前，填凭据在后。⚠️ #488 定的「凭据一律排到启用之前」由此**作废**，
        //    那几个基的「先连上 → 再选它用在哪」不再是本页口径（用户本轮点名要反过来）。
        //    ⚠️ 组内容与能力一字未改，只换位置；本页 `createGroupSection` 仍是 4 处。
        this.createGroupSection(parent, '元数据搜索源启用', (body) => {
            for (const g of GROUP_DISPLAY_ORDER) this.createGroupCheckRow(body, g);
        });
        // 🔴🔴 2026-11-07 用户裁定（本轮，第二遍）：「把组内顺序调整为『元数据搜索源启用、
        //    元数据搜索源凭据、网络播放源凭据、音乐下载源凭据』」⇒ 本页组序**逐字按这个来**。
        //    上一轮（同日早些时候）曾把「网络播放源凭据」提到第二顺位 —— 那条**已被本轮覆盖**，
        //    ⛔ 别再把网络播放往前提：它现在排第三，理由是「搜索」这条线（启用 → 搜索源凭据）
        //    要先自成一段，网络播放与音乐下载都属于**另一件事**（播放 / 下载源），排在后面成第二段。
        //    ⚠️ 组名与 `pure/settingNav.ts` 的 `SETTING_GROUP_ICONS` 键**必须逐字一致**，
        //      否则图标静默丢失（`groupIcon()` 未登记直接回 null）。
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
            //    ⚠️ 这些源**照常参与搜索** —— 删掉的只是「凭据页里那一行只读说明」，不是源本身（enabled 开关在本页第一组）。
        });
        // 第三、第四顺位：网络播放源凭据 → 音乐下载源凭据（顺序见上面那段裁定注释）。
        this.createGroupSection(parent, '网络播放源凭据', (body) => this.renderNetPlaybackRows(body));
        this.createGroupSection(parent, '音乐下载源凭据', (body) => this.renderMusicCookieRows(body));
        // 🔴🔴 ③-1（2026-11-12 用户 m00353 逐字）：「设置-搜索配置页『音乐下载源凭据』分组下再加组
        //    『统一周期管理』，为 13 个凭据做表格列项状态面板…」⇒ 本页**最后一组**，位置逐字照用户说的来。
        //    ⚠️ 组名必须与 `pure/settingNav.SETTING_GROUP_ICONS` 的键逐字一致，否则图标静默丢失。
        this.createGroupSection(parent, '统一周期管理', (body) => this.renderCredentialTable(body));
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
     * 「搜索配置」页 · **「音乐源凭据」组**：各平台下载 / 试听的登录 Cookie（#399-D 移植批；#400 独立成组）。
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
        // 🔴 2026-11-09 第 16 轮（用户：「我的歌单三大平台放个同步按钮统一在凭据行里分别同步」）：
        //    **每行各一颗**，点了直接锁定那一家（弹窗标题也会带平台名）。
        // 🔴 2026-11-10 第 17 轮（用户：「把全部平台同步按钮删除掉」）：组头那颗「同步全部平台」
        //    **已整块删除**。理由不是「重复入口」而是**动作粒度与这一组不匹配**：
        //    这一组是三个平台的凭据卡，每组内容的动作应该只作用于这一行；
        //    「一次同步三家」在三家都没配 Cookie 时只会打开一个全是「未粘贴 Cookie」的空弹窗。
        //    ⛔ 别再往组头加回来 —— 也别把 group 级的同步另起一颗放在别处（同一动作两处入口，
        //    用户已经点错过一次）。
        //    ⚠️ 与元数据源那组不同，这里**不做前置校验**：三家里可能有没配的，
        //    弹窗会把没配的那家如实标成「未粘贴 Cookie」，⛔ 别在点之前就拦下。
        const list = parent.createDiv({ cls: 'rl-prov-list' });
        for (const p of DL_COOKIE_ROWS) {
            // 🔴 ③-1（2026-11-12）：「统一周期管理」面板点名称要跳到**这一行** ⇒ 挂 `data-cred-key`。
            //    值与 `pure/credentialMeta` 的 `key` 逐字同源（`music:<id>`），⛔ 两处不许各拼一套。
            const row = list.createDiv({
                cls: 'rl-key-row rl-prov-card',
                attr: { 'data-cred-key': musicCheckKey(p.id) },
            });
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
            // m07854 ②：登记给「统一周期管理」面板的一键检测回调（否则面板测完这行徽标不动）
            this.registerCredentialBadge(musicCheckKey(p.id), refreshBadge);
            refreshBadge();
            head.createSpan({ cls: 'rl-key-caret', text: '▸' });

            const body = row.createDiv({ cls: 'rl-key-body' });
            // 🔴 2026-11-06：原先这里是 `createDiv({ text: p.desc })` 纯文本 ⇒ 音乐下载源的「到 xx 官网
            //    拿 Cookie」在 Tab 上点不动（用户要求「所有要 cookie 或 key 的都加链接」）。统一走 renderHintNote。
            this.renderHintNote(body, p.desc);
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
                    // #758：上面的面板要跟着从「未配置」变「已配置」（用户 m07505 报的正是这个）
                    this.refreshCredentialTable();
                },
            });
            // 「测试连接」与源行同款反馈（✓/✗ 文案 · Nms；失败红、成功绿）
            // 用户裁定：结果文字在按钮**左边**、点测试时按钮**不许跳**（见 styles.css `.rl-key-actions` 注释）。
            const actions = body.createDiv({ cls: 'rl-key-actions' });
            const resultEl = actions.createSpan({ cls: 'rl-key-result' }); // 行首：文字向左长，按钮贴右不动
            // 🔴 2026-11-09 第 16 轮（用户：「三大平台放个同步按钮统一在凭据行里分别同步」）：
            //    每行一颗，点了就只同步这一家（`onlyPlatform` 收窄采集与展示两侧）。
            // 🔴 2026-11-10 第 17 轮（用户：「改成『立即同步』样式和其他凭据行按钮样式统一」）：
            //    文案与 class 都对齐**另外五个账号同步行**（Steam / 微信读书 / Bangumi / TMDB / 豆瓣 / 书架）：
            //    `cls: 'mod-cta rl-sync-btn'` + 文案「立即同步」。
            //    ⚠️ class 必须带上 `rl-sync-btn`：那几条的宽度 / 图标间距 / hover 由它统一，
            //    只写 `mod-cta` 会变成另一套尺寸（用户点名的正是「样式统一」）。
            //    顺序也照那几条：回执槽 → 同步 → 测试连接（同步是这一行的主操作，排前面）。
            // 🔴🔴 2026-11-19（用户 m13830：「酷狗音乐不能同步就把立即同步按钮删除掉」）：
            //    **酷狗这一行不再出「立即同步」**。上一版的口径是「照给，让弹窗如实说明不支持」，
            //    但实测那颗按钮是**死入口**：`main.fetchMusicSyncLists` 对 kugou 恒返回
            //    `KUGOU_SYNC_UNSUPPORTED`（它的「我的歌单」走 `cloudlist.service.kugou.com/v7/get_all_list`
            //    的 android 网关签名接口，本插件没有这套签名器）⇒ 点开永远是同一个「暂不支持」弹窗，
            //    零信息量、零动作。用户已明确要求删除 ⇒ 只跳过这一家，其余两家照旧。
            //    ⚠️ **保留「测试连接」**：酷狗的 `KUGOU_VIP_ROLEINFO_URL` 是真能区分有效/失效的，
            //      与 QQ 那条「端点全灭」的情形完全不同 ⇒ ⛔ 别顺手把测试按钮一起删掉。
            // 🔴🔴 2026-11-19 晚（用户 m15532：「QQ音乐凭据行的立即同步按钮也删除掉吧」）：
            //    **QQ 这一行同样不再出「立即同步」**。这次是**实测**才敢删（不是照抄酷狗那一条）：
            //    · 列歌单那步是**通的**（`fcg_user_created_diss` 拿到 4 个歌单，`我喜欢` 报 `song_cnt=17`）；
            //    · 但**取曲目那步是空的**：`fcg_musiclist_getmyfav` 回 `code:0` 且 `mapmid` 长度 **0**、
            //      `map` 也 0；`fcg_ucc_getcdinfo_byids_cp`（本仓 `buildQqDissDetailUrl` 那套参数，
            //      `onlysong=1 / platform=yqq / GB2312`）对 `dirid=201` 与 `dirid=1` 都回 `code=0`
            //      但 `songs=0`、`songnum=undefined`。
            //    ⇒ 点开弹窗只能看到歌单名、点进去一首歌都没有，比酷狗那条更没用（酷狗至少还明说「不支持」）。
            //    用户已要求删除 ⇒ 与酷狗同处理。**「测试连接」照旧保留**。
            //    ⚠️ 断言侧：`#665` 要求「立即同步」字面量 ≥5 处，这里只是**不执行**建按钮那两行，
            //      字面量本身没删 ⇒ 那几条不受影响。
            if (p.id !== 'kugou' && p.id !== 'qq') {
                const syncRowBtn = actions.createEl('button', { cls: 'mod-cta rl-sync-btn', text: '立即同步' });
                syncRowBtn.addEventListener('click', () => {
                    // 🔴 口径与另外五个账号同步弹窗一致：**先列清单、勾选后才落库**（⛔ 不做「点一下全量落库」）；
                    //    传 `p.id` ⇒ 这次只拉这一家的歌单（弹窗标题也会带平台名）。
                    this.plugin.openMusicSync(p.id);
                });
            }
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
                // #758：测完结论要立刻反映到面板的「是否失效 / 上次检测」两列
                this.refreshCredentialTable();
                resultEl.setText(`${r.ok ? '✓ ' : '✗ '}${r.message} · ${elapsedMs}ms`);
                resultEl.toggleClass('rl-key-result-ok', r.ok);
                resultEl.toggleClass('rl-key-result-bad', !r.ok);
            });
            head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
        }
        // ── 🔴🔴 历史裁定：「B站音频流」那一行当时改成跨站通用名并搬到「网络播放源凭据」下第一顺位
        //    ⇒ 整行**跨组搬走**，实现在 `renderYtdlpRow`。
        //    🔴 2026-11-09 第 15 轮需求④：那一行现在叫「音视频取流」（用户逐字口径）。
        //    ⚠️ 注释里不复述中间那个旧名 —— 反向守卫会连同注释一起查（本仓老坑：写了就自撞）。
        //
        //    为什么搬（⛔ 别搬回来）：
        //      · 它早就不是「只给 B 站下载音频用」了 —— 内置播放器冲 1080P 取流也走同一条 yt-dlp，
        //        名字里带「B站」会把 YouTube 用户直接劝退（用户点名要改成跨站通用名）。
        //      · 它和「网络播放源凭据」里那两条是**同一件事的三个前置**（可执行文件 + 两个站的 Cookie /
        //        代理），拆在两页读是上一版的结构债。
        //    ⚠️ 字段仍是同一个 `ytdlpPath`（逐字未改），下载与取流两条链路一个字没动。
        //    ⚠️ 本组现在**只剩三条 Cookie**（`DL_COOKIE_ROWS` 循环），循环体内前几行未动 ⇒
        //      #488/#489 那几条按循环体锚死的断言不受影响。
    }

    /**
     * 「统一周期管理」组 —— 13 条凭据的**生命周期状态面板**（③-1，2026-11-12 用户 m00353）。
     *
     * 用户原话：「为 13 个凭据做表格列项状态面板，表头 = 名称 / 是否配置 / 是否失效 /
     *   预计过期时间或上次刷新时间，最右表头为一键检测按钮（无边框透明化）；没配置的源整行变灰
     *   但点名称可快速跳转到 Setting Tab 对应位置」。
     *
     * 🔴🔴 本方法**一行状态都不自己算** —— 全部来自 `pure/credentialMeta.buildCredentialMeta`
     *   （与下面几组凭据行的徽标同一套判据）。用户点名：「状态面板和搜索配置页必须共享同一个
     *   `credentialMeta` 数据源，⛔ 不要在状态面板里维护独立的『是否失效』状态」。
     *   所以这里只做三件事：读表、画表、把「点了要发生什么」接出去。
     *
     * ⚠️ 「预计过期时间」给不出真实值（13 条里 11 条是不透明 Cookie/Key，上游从不告知过期时刻）
     *   ⇒ 那一列显示**可核查的事实**「上次检测：YYYY-MM-DD HH:mm」，
     *   微信读书额外标「可续期」（它 -2012 登录超时能 HEAD 续期）。
     *   ⛔ 别为了填满格子编一个假时间 —— 用户会拿它做判断。
     */
    private renderCredentialTable(parent: HTMLDivElement): void {
        const head = parent.createDiv({ cls: 'rl-cred-head' });
        const title = head.createDiv({ cls: 'rl-cred-title' });
        const summaryEl = title.createSpan({ cls: 'rl-cred-summary' });
        // 一键检测：**纯小图标**、无边框透明化（用户 `m05813` 逐字：「一键检测改成纯小图标（无边框透明化）」）。
        // ⛔ 用 `<button>` 而非 span —— 它真要点（键盘 Enter/Space、焦点环、disabled 全白拿）。
        // ⛔ 别再带「一键检测」四个字：这组标题已经叫「统一周期管理」，旁边一行字纯属占位；
        //    文案改走 `srLabel`（读屏读得到）+ `data-tip`（鼠标悬停看得到），视觉上只剩一枚图标。
        // 🔴 `clickable-icon` 是**宿主豁免**，不是装饰：Obsidian 的 `button:not(.clickable-icon)`
        //    （0,1,1）会给所有按钮铺「整行灰底 + 内阴影 + 边框」，单类选择器 (0,1,0) 压不过它
        //    ⇒ 只写 `.rl-cred-name { border: 0 }` 在真机上**完全不生效**（用户 `m05813` 截图里
        //    名称、刷新图标全带灰框，就是这个原因）。本仓同款处理见
        //    `src/modals/ReaderPanelBase.ts:1633` 与 `src/services/progressBall.ts:112`。
        //    ⚠️ 加了它之后，`.rl-cred-name` 里那些 `border/background/box-shadow: 0` 才真正起作用。
        const testAllBtn = head.createEl('button', { cls: 'rl-cred-testall clickable-icon' });
        testAllBtn.setAttribute('type', 'button');
        safeSetIcon(testAllBtn, 'refresh-cw');
        setTip(testAllBtn, '一键检测全部凭据');
        // 无边框按钮的读屏名走隐藏文本，⛔ 不写 aria-label（会与 data-tip 叠双层气泡，见 UI-GUIDE §3）
        srLabel(testAllBtn, '一键检测全部凭据');

        /**
         * 检测回执槽（③-5 组件库 `setFeedback`）。
         * 为什么需要：检测结果只落在**行内两格**（是否失效 / 上次检测），而一键检测会连刷十几行 ——
         * 用户视线停在顶部的「一键检测」按钮上，看不到下面某一行悄悄变了红；
         * 单条检测同理，点完除了那一行没有任何「点到了、测完了」的确认。
         * ⚠️ 用「就近回执」而不是 `Notice`：Notice 在右上角、离按钮很远（同 `mountGroupReset` 的口径）。
         */
        const feedback = parent.createDiv({ cls: 'rl-ui-feedback' });

        /**
         * 表头/表体走全局组件 `statusTable()`（③-5）。
         * 为什么换：这里原先是手写 `.rl-cred-table` / `.rl-cred-row` / `.rl-cred-cell` 五列
         * （grid 列宽写死在 CSS 里），而字段映射那组又是另一套 `<table>` 语汇 ——
         * 同一个设置页里两套表格实现，正是用户说的「组件规范不统一」。
         * `statusTable` 把列宽写进 `gridTemplateColumns`（表头与每行各写一次，grid 不继承），
         * 所以列对齐只由**这一个数组**决定，不再散落在 CSS 与 JS 两处。
         */
        const table = statusTable(parent, [
            { label: '名称', width: 'minmax(0, 2.4fr)' },
            { label: '是否配置', width: 'minmax(0, 1fr)' },
            { label: '是否失效', width: 'minmax(0, 1fr)' },
            { label: '上次检测', width: 'minmax(0, 1.8fr)' },
        ]);
        const bodyEl = table.body;

        const rows = buildCredentialMeta(this.plugin.credentialMetaInput());
        const sum = summarizeCredentialMeta(rows);
        summaryEl.setText(
            `共 ${sum.total} 条 · 已配置 ${sum.configured} · 失效 ${sum.expired}`
            + (sum.unchecked > 0 ? ` · 未检测 ${sum.unchecked}` : ''),
        );

        /**
         * 单行的重绘（改动就地更新，⛔ 不整表重建 —— 那会让用户刚滚到的行位置跳动）。
         *
         * 🔴 2026-11-12（用户 `m05813` 逐字）：「去掉单独检测……名称旁的描述（元数据源、
         *   音乐平台等）删除掉，名称列项把边框去掉」
         *   ⇒ 本行现在只有四格：名称 / 是否配置 / 是否失效 / 上次检测。
         *   ⛔ 别把「检测」那列加回来：13 行各挂一枚刷新图标，是整张表最吵的一层，
         *      而它做的事和顶上那颗「一键检测」完全重复 —— 单条检测的价值只在于
         *      「不想等十几条串行」时省几十秒，代价却是每行常驻一个可点控件。
         *      真要单条重测：一键检测本来就是串行逐条刷新，中途能看见每行先后变。
         */
        const paintRow = (host: HTMLDivElement, row: CredentialMeta): void => {
            host.empty();
            host.toggleClass('is-unconfigured', !row.configured);
            host.toggleClass('is-expired', row.expired);
            host.setAttribute('data-cred-row', row.key);

            const nameCell = cell(host, { cls: 'rl-cred-cell-name' });
            // 点名称跳转：未配置的源也允许跳（正是要去填它）⇒ ⛔ 不按 configured 门控
            // 🔴 `clickable-icon` 必带 —— 理由同上面「一键检测」那处：宿主的
            //    `button:not(.clickable-icon)`（0,1,1）会把名称压成一枚带灰框的按钮，
            //    `.rl-cred-name` 的 `border: 0` 单独压不过（用户 `m05813`：「名称列项把边框去掉」）。
            const nameBtn = nameCell.createEl('button', { cls: 'rl-cred-name clickable-icon', text: row.label });
            nameBtn.setAttribute('type', 'button');
            nameBtn.addEventListener('click', () => this.jumpToCredentialRow(row.key));
            // ⛔ 不再挂 `rl-cred-family`（族名）：一列里「豆瓣 元数据源 / 网易云音乐 音乐平台」
            //    重复了表头已经说清的事，且让名称列宽被它挤掉一半。

            cell(host, { text: row.configured ? '已配置' : '未配置' });
            // 失效列：未配置时给「—」（它的「测不通」是必然，标出来等于骂用户没填）
            cell(host, { text: row.configured ? credentialStateLabel(row) : '—' });
            const whenCell = cell(host, { cls: 'rl-cred-cell-when' });
            whenCell.createSpan({ text: formatCheckedAt(row.lastCheckedAt) });
            // ⛔ 2026-11-12 第 28 轮（用户 `m07505` 逐字：「把上次检测的提示描述『登录超时可续期』
            //    删除掉」）⇒ 这里原来还有一句 `const hint = credentialExpiryHint(row)`
            //    + `whenCell.createSpan({ cls: 'rl-cred-hint', text: hint })`，已**整条删除**。
            //    「上次检测」这一格现在只有时间本身 —— 多一句主观说明会被用户当成可核查事实。
            //    ⛔ 别再往这一格补第二行字（要补说明就写进表头，那处只出现一次）。
        };

        const paintAll = (): void => {
            const fresh = buildCredentialMeta(this.plugin.credentialMetaInput());
            for (const row of fresh) {
                const host = bodyEl.querySelector<HTMLDivElement>(`[data-cred-row="${row.key}"]`);
                // ⚠️ 找不到就跳过而不是补建：行集合是 `buildCredentialMeta` 恒定的 13 条，
                //    和建表时**同一份数据源** ⇒ 正常路径不可能缺行。真缺了说明 DOM 已被重建
                //    （`display()` 会把 `credentialTableRefresh` 置空，就不会走到这里）。
                //    ⛔ 别在这里 `table.row()` 补建 —— 新行会append到末尾，与 13 条的固定顺序错位。
                if (host) paintRow(host, row);
            }
            const after = summarizeCredentialMeta(fresh);
            summaryEl.setText(
                `共 ${after.total} 条 · 已配置 ${after.configured} · 失效 ${after.expired}`
                + (after.unchecked > 0 ? ` · 未检测 ${after.unchecked}` : ''),
            );
        };

        for (const row of rows) {
            // 行容器走 `statusTable.row()` —— 它已经把 `gridTemplateColumns` 写上了（grid 不继承，
            // 表头写一次不够），⛔ 别在这里手写 `.rl-cred-row` 再补一遍列宽。
            const host = table.row({ cls: 'rl-cred-row' });
            paintRow(host, row);
        }

        // 建完就把刷新入口交出去（#758，理由见 `credentialTableRefresh` 字段注释）。
        // ⚠️ 必须**在建完行之后**赋值：`paintAll` 靠 `[data-cred-row]` 找行，早于建行时一行都找不到。
        this.credentialTableRefresh = paintAll;

        testAllBtn.addEventListener('click', async () => {
            testAllBtn.disabled = true;
            testAllBtn.addClass('rl-btn-loading');
            // 🔴 串行、只测已配置的：11 条 Cookie 并发打同一批站点 = 自找风控；
            //    未配置的源没有可测对象（测了必然 false，会把「没填」写成「连接失败」）。
            const targets = buildCredentialMeta(this.plugin.credentialMetaInput()).filter((r) => r.configured);
            const failed: string[] = [];
            for (const [i, row] of targets.entries()) {
                // 逐条报「第几条 / 共几条」—— 十几条串行下来要几十秒，只转圈用户会以为卡死
                setFeedback(feedback, `正在检测 ${row.label}（${i + 1} / ${targets.length}）…`, 'neutral');
                const host = bodyEl.querySelector<HTMLDivElement>(`[data-cred-row="${row.key}"]`);
                const r = await this.plugin.testCredentialByKey(row.key);
                this.plugin.setCredentialStatus(row.key, r.ok);
                // 🔴 m07854 ②：把结论同步到「搜索配置」里那一行 —— 否则用户看到的还是旧徽标
                this.refreshCredentialBadge(row.key);
                if (!r.ok) failed.push(row.label);
                if (host) {
                    const fresh = buildCredentialMeta(this.plugin.credentialMetaInput()).find((x) => x.key === row.key);
                    if (fresh) paintRow(host, fresh);
                }
            }
            testAllBtn.disabled = false;
            testAllBtn.removeClass('rl-btn-loading');
            const after = summarizeCredentialMeta(buildCredentialMeta(this.plugin.credentialMetaInput()));
            summaryEl.setText(
                `共 ${after.total} 条 · 已配置 ${after.configured} · 失效 ${after.expired}`
                + (after.unchecked > 0 ? ` · 未检测 ${after.unchecked}` : ''),
            );
            // 一键检测的回执：只汇总「哪几条没通」，⛔ 不复述成功条数（成功是默认预期，说多了是噪音）
            if (targets.length === 0) {
                setFeedback(feedback, '还没有已配置的凭据可以检测', 'neutral');
            } else if (failed.length === 0) {
                setFeedback(feedback, `已检测 ${targets.length} 条，全部连接正常`, 'ok');
            } else {
                setFeedback(feedback, `${targets.length} 条中 ${failed.length} 条未通过：${failed.join('、')}`, 'warn');
            }
        });
    }

    /**
     * #758：「统一周期管理」面板重绘一次（幂等，可随时调）。
     *
     * 所有**会改变凭据派生结果**的写入点都要调它 —— 判断标准很简单：
     *   「这次写入会不会让 13 行里某一行的『是否配置 / 是否失效 / 上次检测』变？」会 ⇒ 调。
     *   已经接上的：8 处 `clearCredentialStatus`（填/改/登出凭据）+ 3 处 `setCredentialStatus`
     *   （音乐行测连接、元数据源行测连接、网络播放行测连接）。
     * ⚠️ 开机自检那条路径**不接**：它发生在 `onload`，那时设置页可能根本没打开
     *   （`credentialTableRefresh === null` ⇒ 自然空转）；用户下次打开设置页时
     *   `display()` 会拿最新的 `credentialStatus` 重新算，快照天生是新的。
     * ⛔ 别改成「无条件重建整页」—— 见 `credentialTableRefresh` 字段注释里的代价分析。
     */
    private refreshCredentialTable(): void {
        this.credentialTableRefresh?.();
    }

    /**
     * 登记某行凭据的徽标刷新闭包（m07854 ②）。同一键重复登记 ⇒ 覆盖（后建的 DOM 才是活的）。
     * ⚠️ 键必须是 `*CheckKey` 的产物（带族前缀），与「统一周期管理」面板的 row.key 同源。
     */
    private registerCredentialBadge(key: string, refresh: () => void): void {
        this.credentialBadgeRefresh.set(key, refresh);
    }

    /**
     * 把「检测结论变了」通知到**搜索配置**里对应的那一行（m07854 ②）。
     *
     * 与 `refreshCredentialTable()` 是**成对的两个方向**：
     *   · 搜索配置里填/改/测 → `refreshCredentialTable()`（表要不要跟着变）
     *   · 面板里一键检测     → `refreshCredentialBadge(key)`（下面那行徽标要不要跟着变）
     * ⚠️ 传 `undefined` ⇒ 全部刷新（一键检测跑完那种「一次改了十几条」的情况）。
     */
    private refreshCredentialBadge(key?: string): void {
        if (key !== undefined) {
            this.credentialBadgeRefresh.get(key)?.();
            return;
        }
        for (const refresh of this.credentialBadgeRefresh.values()) refresh();
    }

    /**
     * 面板里点名称 → 跳到本页对应那行凭据（③-1，用户：「没配置的源整行变灰但点名称可快速跳转到
     *   Setting Tab 对应位置」）。
     *
     * 三条要点：
     *   ① 目标行靠 `data-cred-key` 找 —— 三处凭据行（元数据源 / 音乐 / 网络播放）现在都挂了它，
     *      值由 `credentialCheck` 那三个 `*CheckKey` 现拼，与面板 key **同源**；
     *   ② 已经在本页 ⇒ ⛔ 别整页重建（`setActivePage` 会重画，用户面板上的滚动位置就丢了）；
     *   ③ 找到后**就地展开**那一行（`.rl-key-open`）再滚过去 —— 只滚不展开，用户看到的是一行折叠卡，
     *      还得自己再点一下才知道里面是输入框。
     */
    private jumpToCredentialRow(key: string): void {
        // 「是否已经在本页」只看 `activePage` 这一个真源 —— ⛔ 别去嗅 DOM 类名：
        // 页切换用的是 `.rl-set-page.is-active`（见 `setActivePage`），嗅类名等于把内部实现抄一份。
        const inPage = this.activePage === 'sources';
        const reveal = (): void => {
            const sel = `[data-cred-key="${key}"]`;
            const target = this.containerEl.querySelector<HTMLElement>(sel);
            if (!target) return;
            target.addClass('rl-key-open');
            target.addClass('rl-cred-flash');
            // 先滚后清高亮：`scrollIntoView` 是同步的，但主题的 smooth 滚动会延后 ⇒ 高亮留 1.2s 足够看见
            target.scrollIntoView({ block: 'center' });
            window.setTimeout(() => target.removeClass('rl-cred-flash'), 1200);
        };
        if (inPage) {
            reveal();
            return;
        }
        this.setActivePage('sources');
        // `setActivePage` 只切 class，DOM 已在 `display()` 时建好 ⇒ 下一帧再找元素最稳
        window.requestAnimationFrame(reveal);
    }

    /**
     * 「网络播放源凭据」组 · **第一顺位**：yt-dlp / ffmpeg 可执行文件路径（本轮从音乐组搬来）。
     *
     * 🔴 行形态与同组三条 Cookie 行**逐字同款**（`.rl-key-row.rl-prov-card` + 行头图标/名称/徽标/▸ +
     *    点行头开合），所以用户学会一次就会用第二次。
     * ⚠️ 它是**路径不是凭据** ⇒ 输入框走明文（⛔ 别用 `createSecretField`：那会挂一个毫无意义的
     *    「显示/隐藏」眼睛，路径本来就该看得见）。
     * ⚠️ 徽标只有「已配置 / 未配置」两态：未配置 = 走系统 PATH，那件事由 `YTDLP_PATH_DESC` 说清。
     */
    private renderYtdlpRow(list: HTMLElement): void {
        const dlRow = list.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const dlHead = dlRow.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(dlHead.createSpan({ cls: 'rl-ai-icon' }), { kind: 'builtin', id: 'terminal' });
        // 🔴 2026-11-09 第 15 轮需求④（用户逐字口径）：本行标题改成「音视频取流」。
        //    旧名把范围说死（四个并列名词 + 「通用」），而这条路就是 yt-dlp + ffmpeg 取音视频流。
        //    ⚠️ 注释里**刻意不复述旧名** —— 反向守卫会连同注释一起查（本仓老坑：写了就自撞）。
        dlHead.createSpan({ cls: 'rl-key-name', text: '音视频取流' });
        const dlBadge = dlHead.createSpan({ cls: 'rl-key-badge' });
        const currentExe = (): string => this.plugin.settings.ytdlpPath ?? '';
        const refreshExeBadge = (): void => {
            const has = !!currentExe().trim();
            dlBadge.setText(has ? '已配置' : '未配置');
            dlBadge.toggleClass('rl-key-badge-on', has);
        };
        refreshExeBadge();
        dlHead.createSpan({ cls: 'rl-key-caret', text: '▸' });
        const dlBody = dlRow.createDiv({ cls: 'rl-key-body' });
        dlBody.createDiv({ cls: 'rl-hint-note', text: YTDLP_PATH_DESC });
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

        /**
         * 🔴 2026-11-07 本轮第⑤条（用户裁定）：ffmpeg 从「语音转文字 › 环境配置」里搬出来，
         *    归到这条通用取流路径下面 —— 因为它本来就不是 ASR 专属：取流（yt-dlp）与
         *    本地转字幕（whisper.cpp 等）用的是同一个 ffmpeg，分两处填只会让用户填两遍
         *    或者只填一处然后百思不得其解。用户原话：「全局跟随『音视频取流』那个路径
         *    （加个 ffmpeg 框）」。
         *
         *  ⚠️ 这里仍写 `settings.asrFfmpegPath`（字段名带 asr 前缀是历史），⛔ 别为了好看改字段名 ——
         *    它会连同老用户 data.json 一起失效，得写迁移。名字丑，但值是全局唯一的。
         *  ⚠️ 明文框：路径不是凭据，⛔ 别套 `createSecretField`（那会多一个没意义的眼睛按钮）。
         */
        dlBody.createDiv({ cls: 'rl-hint-note', text: FFMPEG_PATH_DESC });
        const ffWrap = dlBody.createDiv({ cls: 'rl-secret' });
        const ffInput = ffWrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: 'ffmpeg.exe 的完整路径（留空 = 自动找）', type: 'text', spellcheck: 'false' },
        });
        ffInput.value = this.plugin.settings.asrFfmpegPath ?? '';
        ffInput.addEventListener('input', () => {
            this.plugin.settings.asrFfmpegPath = ffInput.value.trim();
            void this.plugin.saveSettings();
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
        //    ⚠️ 数据源 / AI 页**不传**这个参数：那两页组内各有自己的容器（`.rl-prov-list` / #717 起
        //      「用途」组用 `.rl-ai-master-wrap`），再套一层原生卡就是卡中卡。
        //    ⚠️ 代价是核心的 `.setting-group { max-width: var(--setting-group-max-width) }`（默认 700px、
        //      且 `margin-inline: auto`）会一起生效 —— 那正是原生设置页的观感，本批**刻意接受**。
        const wrap = parent.createDiv({ cls: nativeGroup ? 'rl-svc-group setting-group' : 'rl-svc-group' });
        const head = wrap.createDiv({ cls: 'rl-svc-group-title' });
        // 图标按标题从真源取；未登记则跳过（只是缺个图标，不抛错）
        const icon = groupIcon(title);
        if (icon) safeSetIcon(head.createSpan({ cls: 'rl-svc-group-icon' }), icon);
        head.createSpan({ text: title });
        /**
         * 🔴🔴 2026-11-14（用户 m05673 手机实测）：「有的分两行有的一行显示空白一片
         *    **应该给个提示不支持**」。
         *
         * 这些组在移动端不是「窄了不好看」，而是**整组控件根本没建**（`main.ts` 里
         * `Platform.isDesktopApp` 的门面提前返回，按钮压根不渲染）⇒ 用户看到的是一片空白，
         * 分不清「不支持」和「插件坏了」。这里在组标题行右侧补一枚小徽标说清楚。
         *
         * ⚠️ 判据（哪些组算桌面专属）只准在 `pure/platformGates` 里写一份 ——
         *    那个名单必须与 `main.ts` 的门控同源，⛔ 别在这里硬编码标题。
         */
        if (shouldMarkDesktopOnly(title, Platform.isDesktopApp)) {
            head.createSpan({ cls: 'rl-svc-group-badge-desktop', text: DESKTOP_ONLY_LABEL });
        }
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
        // 🔴🔴 本轮用户裁定：「AI 集成页把『用途』组移到第一顺位」。
        //    ⇒ 组序改为 **用途 → 模型服务**。⚠️ #483 当年定的「先连上 → 再选它用在哪」由此**作废**
        //    （用户本轮明确要求反过来：先看这一页能干什么，再决定接哪家）。
        //    ⚠️ 组内容与能力一字未改，只换位置。
        // 🔴🔴 2026-11-06 用户逐字：「AI集成-用途页重构，在顶部设置一个全局默认AI模型
        //    （下方的所有服务全部继承这个），然后根据场景分类：阅读器AI快捷（翻译、搜索）、
        //    编辑属性AI快捷（总结、预填）、播放器AI快捷（字幕总结、字幕提问）」。
        //
        // 🔴 **为什么从「六张平铺卡」改成「顶部全局 + 三张场景卡」**：原来六张卡
        //    （翻译/总结/搜索/预填/字幕总结/字幕提问）是**按功能点**平铺的 —— 用户看到的是六行
        //    「服务商 + 模型」，却看不出「我现在正在阅读器里读东西，该调哪一张」。
        //    三张场景卡对应的是**用户真正遇到它的三个地方**：读的时候、填条目的时候、看片的时候。
        //    ⚠️ 卡数变少但**服务一个没少**：六项仍各自独立、各自有提示词，只是被收进对应的场景卡里。
        this.createGroupSection(body, '用途', (inner) => this.renderAiServiceRows(inner));
        this.createGroupSection(body, '模型服务', (inner) => this.renderProviderCards(inner));
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
    /**
     * 「文字转语音」这一行。
     *
     * 🔴 2026-11-06 m08348（用户：「还是太复杂了改成卡片式一体化」）：
     *    它现在长在 `.rl-voice-card` **里面**，所以自己**不再套** `.rl-ai-svc-card` ——
     *    否则就是「卡中卡」（外白框套内白框，边距叠两层，实测会多出 18px 空白）。
     *    ⚠️ #717 之后 **`.rl-ai-svc-card` 全仓已无调用**（AI 用途组改成主从布局，
     *    `renderAiServiceRow` 随整套场景卡一起退场）—— 本行当初对齐的就是那套行距，
     *    现在它是**这条语音行独有**的类（见下面 `addClass('rl-ai-svc')` 的注释）。
     */
    private renderTtsVoiceRow(body: HTMLDivElement): void {
        this.renderTtsVoiceRows(body, () => this.display());
    }

    /**
     * 「文字转语音」——**与「语音转文字」同构的两栏**（用户 m09233：
     * 「把文字转语音的UI也改成语音转文字选择模型那样分本地和云端」）。
     *
     * 结构完全复用 STT 那套布局类（`.rl-asr-pick2` / `.rl-asr-row` / `.rl-asr-nav` /
     * `.rl-asr-top` / `.rl-asr-bt`）：
     *   · 左栏：`本地语音`（系统语音）+ `云端接入`（硅基流动）两段，单选互斥、未选中变灰；
     *   · 右上：当前音源的**音色格**（每格显示音色名 + 所属分组，如「中文 / 男性」）；
     *   · 右下：试听与可用性。
     * ⛔ 别另起一套类名：两栏骨架的宽度、间距、灰化、键盘可达性都已经在 STT 那里调好了，
     *   抄一份必然漂移（本仓「同一功能只留一个实现」）。
     */
    private renderTtsVoiceRows(host: HTMLDivElement, redraw: () => void): void {
        const { kind, remembered } = this.currentTtsState();
        const voices = this.systemVoices();
        const curVoice = effectiveTtsVoice(kind, voices, remembered);
        /**
         * 🔴 用户 m09565 ①-3：「硅基流动要明确知道这些来自哪个模型，而不是只显示音色
         *    （如显示为 `CosyVoice2 · alex（沉稳男声）`）」。
         * ⇒ 云端走 `cloudVoiceFullLabel`（带模型短名 + 音色 id + 中文标签）；
         *   系统语音保持 `ttsVoiceLabel`（系统音色名本身就是全名，再套一层反而更乱）。
         * ⚠️ 只改设置页的**展示**，⛔ 不动 `ttsVoiceLabel`：阅读器面板共用它，单测也钉着它的返回值。
         * ⚠️ 传 `curVoice`（`effectiveTtsVoice` 已把「还没选过」补成缺省音色）而不是 `remembered`：
         *    真机第一版传的是 `remembered`，没选过时它为空 ⇒ 「当前：」只剩 `CosyVoice2` 三个字，
         *    用户看不出马上会用哪个音色。这跟 `effectiveTtsVoice` 的注释是同一句话：
         *    显示的必须是**马上会念的那个**。
         */
        const curLabel = kind === 'cloud' ? cloudVoiceFullLabel(curVoice) : ttsVoiceLabel(kind, voices, remembered);
        const cloudReady = !!this.settingValue('readerSiliconflowKey');

        const pick2 = host.createDiv({ cls: 'rl-asr-pick2' });
        const row = pick2.createDiv({ cls: 'rl-asr-row' });
        const nav = row.createDiv({ cls: 'rl-asr-nav' });

        /**
         * 一个音源 = 一行导航。
         * ⚠️ 这里的「云端」和 STT 的云端**不是一回事**：TTS 的云端（硅基流动）是真实现，
         *    所以它是可点按钮、有 `is-todo` 的只有 STT 那边。
         */
        const mkItem = (value: TtsEngineKind, name: string, count: string, tip: string): void => {
            const item = nav.createEl('button', { cls: 'rl-asr-navi' });
            item.setAttribute('type', 'button');
            const on = value === kind;
            if (on) item.addClass('is-on');
            item.setAttribute('aria-pressed', on ? 'true' : 'false');
            const ico = item.createSpan({ cls: 'rl-asr-navi-icon' });
            /**
             * 🔴 用户 m07854 ⑤：「文字转语音组下的『系统语音』和『硅基流动』标题前的小图标
             *    改成对应品牌图标」。
             *    · 云端 = 硅基流动 ⇒ 它本来就有官方标（`AI_PROVIDER_ICON.siliconflow`，slug `siliconcloud`），
             *      直接复用，⛔ 别在别处再抄一份路径；
             *    · 本地 = 操作系统自带 TTS ⇒ 挂**当前操作系统**的标（真源 `pure/osIcons`，
             *      用户当场选的这一档；认不出平台回退内置 `monitor`）。
             * ⚠️ 走 `renderAiIcon` 而不是 `safeSetIcon`：品牌标是填充式、内置标是描边式，
             *    那条分治只准有一份（`services/aiIcon.ts`）。
             */
            renderAiIcon(ico, value === 'cloud' ? AI_PROVIDER_ICON.siliconflow : systemVoiceIcon());
            const txt = item.createSpan({ cls: 'rl-asr-navi-text' });
            txt.createSpan({ cls: 'rl-asr-navi-name', text: name });
            item.setAttribute('data-tip', tip);
            item.createSpan({ cls: on ? 'rl-asr-navi-count is-ok' : 'rl-asr-navi-count', text: count });
            item.addEventListener('click', () => {
                if (value === kind) return;
                saveTtsEngine(value);
                /**
                 * 🔴 用户 m09565 ①-2：「文字转语音点一个交互怎么就重置滚动了，修复一下保持位置不变」
                 *    真因：这里原本是 `this.display()` —— 那是**整页重建**，
                 *    设置页 DOM 全部换新 ⇒ 滚动位置被甩回顶部。
                 *    ⇒ 改走 `redraw()`（`mountVoiceCard` 那个闭包，只 `card.empty()` 后重画这张卡：
                 *      滚动容器、页签栏、其它分组一个都不动）。
                 *    ⚠️ 音色清单确实要整批换（系统语音 ↔ 硅基流动），但**换的是卡内内容**，
                 *      不需要动卡以外的任何节点。⛔ 别改回 `this.display()`。
                 */
                redraw();
            });
        };

        this.mkNavHead(nav, 'house', '本地语音', '不走网络');
        const sysBlocked = ttsEngineBlockedReason('system', cloudReady, ttsSupported());
        mkItem(
            'system',
            '系统语音',
            voices.length ? String(voices.length) : '0',
            sysBlocked ?? '用系统自带语音朗读，完全在本机，不走网络。',
        );
        this.mkNavHead(nav, 'cloud', '云端接入', '按次计费', true);
        const cloudBlocked = ttsEngineBlockedReason('cloud', cloudReady, ttsSupported());
        mkItem('cloud', '硅基流动', '云', cloudBlocked ?? '云端合成，音色更多；需要先在设置里填硅基流动 API Key。');

        /* ── 右上：音色格 ── */
        const top = row.createDiv({ cls: 'rl-asr-top' });
        const topHead = top.createDiv({ cls: 'rl-asr-top-head' });
        // 🔴 m07854 ⑤：右上的「当前音色来自谁」也要品牌标，与左栏那两行同一份真源
        //    （云端 = 硅基流动官方标 / 本地 = 当前操作系统的标）。⛔ 别写回 `cloud` / `volume-2`。
        renderAiIcon(topHead.createSpan({ cls: 'rl-asr-top-icon' }), kind === 'cloud' ? AI_PROVIDER_ICON.siliconflow : systemVoiceIcon());
        topHead.createSpan({ cls: 'rl-asr-top-title', text: kind === 'cloud' ? '硅基流动' : '系统语音' });
        if (curLabel) topHead.createSpan({ cls: 'rl-asr-top-cur', text: '当前：' + curLabel });

        const groups = ttsVoiceGroups(kind, voices, curVoice);
        const blocked = kind === 'cloud' ? cloudBlocked : sysBlocked;
        top.createDiv({
            cls: 'rl-asr-top-desc',
            text: blocked ?? (kind === 'cloud' ? '当前音色来自硅基流动的云端合成。' : '当前音色来自系统语音，全部在本机完成。'),
        });

        const grid = top.createDiv({ cls: 'rl-asr-tiergrid is-voice' });
        const total = groups.reduce((n, g) => n + g.items.length, 0);
        if (!total) {
            // ⚠️ 系统语音列表是异步加载的，首次常为空 —— 给一句人话，⛔ 不留白板
            top.createDiv({ cls: 'rl-bt-adv-title', text: '音色列表还在加载…' });
        }
        for (const g of groups) {
            for (const o of g.items) {
                const cell = grid.createDiv({ cls: 'rl-asr-tg' });
                cell.setAttribute('role', 'button');
                cell.setAttribute('tabindex', '0');
                cell.addClass(o.on ? 'is-on' : 'is-off');
                cell.setAttribute('aria-pressed', o.on ? 'true' : 'false');
                /**
                 * 🔴 m09565 ①-3：云端音色的 `o.label` 只有「沉稳男声」这类中文标签，
                 *    三个不同 id 的男声在界面上分不出谁是谁，也看不出是**哪个模型**出的。
                 * ⇒ 云端格子名显式带上 id：`alex（沉稳男声）`，脚注显示模型短名 `CosyVoice2`。
                 *    系统语音保持原样（`o.label` 本身已含「名 · 语言」全名）。
                 */
                const cellName = kind === 'cloud' ? cloudVoiceFullLabel(o.value) : o.label;
                const cellFoot = kind === 'cloud' ? cloudModelShortName() : g.label;
                cell.setAttribute('data-tip', kind === 'cloud' ? `${cellName}　·　${g.label}` : `${o.label}　·　${g.label}`);
                const pick = (): void => {
                    if (kind === 'cloud') saveCloudVoice(o.value);
                    else saveVoiceUri(o.value);
                    // 🔴 同上（m09565 ①-2）：切音色只重画这张卡，⛔ 别用 this.display() 整页重建
                    redraw();
                };
                cell.createDiv({ cls: 'rl-asr-tg-name', text: cellName });
                const foot = cell.createDiv({ cls: 'rl-asr-tg-foot' });
                foot.createSpan({ cls: 'rl-asr-tg-size', text: cellFoot });
                if (o.on) foot.createSpan({ cls: 'rl-asr-tg-ok', text: '✓' });
                cell.addEventListener('click', pick);
                cell.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return;
                    ev.preventDefault();
                    pick();
                });
            }
        }

        /* ── 右下：试听 + 可用性 ── */
        const bt = row.createDiv({ cls: 'rl-asr-bt' });
        const mod = bt.createDiv({ cls: 'rl-bt-mod' });
        const head = mod.createDiv({ cls: 'rl-bt-mod-head' });
        safeSetIcon(head.createSpan({ cls: 'rl-bt-mod-icon' }), 'play');
        head.createSpan({ cls: 'rl-bt-mod-title', text: '试听' });
        head.createSpan({
            cls: blocked ? 'rl-bt-mod-badge' : 'rl-bt-mod-badge is-ok',
            text: blocked ? '不可用' : '可以试听',
        });
        const body = mod.createDiv({ cls: 'rl-bt-run-body' });
        const play = body.createEl('button', { cls: 'rl-asr-fixbtn', attr: { type: 'button' } });
        play.setText('▶ 试听这句');
        play.addEventListener('click', () => this.previewTtsVoice(kind, curVoice));
        body.createDiv({ cls: 'rl-bt-adv-title', text: `朗读内容：「${VOICE_PREVIEW_TEXT}」` });
        if (blocked) body.createDiv({ cls: 'rl-bt-adv-title', text: blocked });

        // ⚠️ 系统语音列表是**异步**加载的（首次常为空）⇒ 变更后只重画这张卡（不整页刷新，避免滚动位置跳回顶部）
        if (kind === 'system' && ttsSupported() && !this.ttsVoicesHooked) {
            this.ttsVoicesHooked = true;
            window.speechSynthesis?.addEventListener('voiceschanged', () => redraw(), { once: true });
        }
    }

    /**
     * 左栏分组标题（「本地部署 / 云端接入」那一条灰字）。
     * 🔴 从 `renderAsrEngineRows` 的局部函数提出来：TTS 也要用同一款标题，
     *    复制一份必然漂移（字体、那条分隔横线的 margin 都要跟着抄）。
     */
    private mkNavHead(nav: HTMLElement, icon: string, title: string, note: string, cloud = false): void {
        const h = nav.createDiv({ cls: cloud ? 'rl-asr-nav-head is-cloud' : 'rl-asr-nav-head' });
        safeSetIcon(h.createSpan({ cls: 'rl-asr-nav-headicon' }), icon);
        h.createSpan({ cls: 'rl-asr-nav-headtitle', text: title });
        h.createSpan({ cls: 'rl-asr-nav-headnote', text: note });
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
     * 「用途」组 = **主从布局**（2026-11-07 用户从十版方案里选定「I 主从」）。
     *
     * 🔴 三块结构：
     *    ① 左栏 `.rl-ai-master` —— **六个条目**的索引：三个场景各两个服务（阅读 / 播放 / 编辑），
     *       每条一颗状态点（服务商已选 = 绿 / 不启用 = 灰），场景用分组小标签；
     *       ⚠️ #723 起「全局默认模型」那一档已删，⛔ 别再补回来（理由见 `AiServiceDef` 类型注释）。
     *    ② 右栏 `.rl-ai-detail` —— **只画当前选中那一条**的完整配置：模型控件 + 常驻提示词输入框；
     *    ③ 选中项存 `this.aiPick`（实例字段）—— ⛔ 不写进 `plugin.settings`：
     *       它是「此刻在看哪一项」的界面焦点，不是用户配置，落盘只会长出一个没人读的键。
     *
     * 🔴 **为什么提示词从折叠块变常驻输入框**（这正是选主从方案唯一的实质收益）：
     *    折叠形态下改一段 40 字提示词要点开、改、再点合，一屏里三张卡各有各的开合态；
     *    主从形态下右栏本来就只装一屏内容，不折叠也不会把页面撑长。
     *    ⚠️ 名行尾那颗「提示词 ›」按钮（`.rl-ai-prompt-btn`）随之**整套退场** —— ⛔ 别再为它加回来。
     *
     * ⚠️ 六个服务的 provider/model/提示词**仍完全独立**（#478~#511 定下的独立性，⛔ 别合并）；
     *    「全局默认模型」是它们共同的上游，靠一次**显式铺开**实现（见 renderAiServiceDetail 里
     *    那段逐项赋值），⛔ 不是运行时回落（三态语义的理由见 `aiGlobalProvider` 字段注释）。
     */
    private renderAiServiceRows(body: HTMLDivElement): void {
        const wrap = body.createDiv({ cls: 'rl-ai-master-wrap' });
        const master = wrap.createDiv({ cls: 'rl-ai-master' });
        const detail = wrap.createDiv({ cls: 'rl-ai-detail' });

        const defs = this.aiServiceDefs();
        // 上次看到的那一项可能已不存在（例如日后增删条目）⇒ 回落第一项，⛔ 别让右栏空着。
        let pick = defs.some((d) => d.id === this.aiPick) ? this.aiPick : defs[0].id;
        const items: Array<{ def: AiServiceDef; el: HTMLDivElement }> = [];

        for (const def of defs) {
            // 场景分组的第一个条目上方插一条分组标签（全局那一条自成一档）
            if (def.groupTop) master.createDiv({ cls: 'rl-ai-mgrp', text: def.sceneTitle });
            const el = master.createDiv({ cls: 'rl-ai-mitem', attr: { role: 'button', tabindex: '0' } });
            const dot = el.createSpan({ cls: 'rl-ai-mdot' });
            // 状态点：全局那一档看 `aiGlobalProvider`；服务看各自 provider。
            // 🔴 「不启用」是 `'off'`，与「还没配」同值 —— 所以这里只能表达「有没有选服务商」，
            //    ⛔ 别试图区分二者（要区分得改 `normalizeAiChoice` 的三态，那是另一件事）。
            dot.toggleClass('is-off', isAiOff(normalizeAiChoice(def.getProvider())));
            el.createSpan({ cls: 'rl-ai-mname', text: def.name });
            el.setAttribute('aria-label', `${def.name}，${def.sceneTitle}`);
            const go = (): void => {
                pick = def.id;
                this.aiPick = pick;
                for (const it of items) it.el.toggleClass('is-on', it.def.id === pick);
                this.renderAiServiceDetail(detail, def);
                detail.scrollTop = 0;
            };
            el.addEventListener('click', go);
            el.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                ev.preventDefault();
                go();
                el.focus();
            });
            items.push({ def, el });
        }

        const first = items.find((it) => it.def.id === pick) ?? items[0];
        first.el.addClass('is-on');
        this.renderAiServiceDetail(detail, first.def);
    }

    /** 一个「用途」条目的定义（主从两栏共用这一份真源：⛔ 别在左栏和右栏各列一遍） */
    private aiServiceDefs(): AiServiceDef[] {
        const s = () => this.plugin.settings;
        /**
         * 🔴 #723（2026-11-07 用户裁定，三条一起改）：
         *   ① **删掉「全局默认模型」** —— 用户原话「AI集成-用途删除全局配置模型」。
         *      ⚠️ 存储字段 `aiGlobalProvider / aiGlobalModel` 保留（见 `AiServiceDef` 类型注释），
         *      ⛔ 别顺手删字段 —— 老 data.json 里有值时删键等同静默丢配置。
         *   ② 分组名去掉「AI 快捷」后缀：`阅读器 AI 快捷 → 阅读` / `播放器 AI 快捷 → 播放` /
         *      `编辑属性 AI 快捷 → 编辑`（用户原话「删除『AI 快捷』」）。
         *   ③ 顺序按**场景在插件里出现的先后**排：阅读 → 播放 → 编辑。
         *      ⛔ 别按字母或按当年加的批次排 —— 用户看这一列时想的是「我在哪儿用它」。
         *   ④ 服务名统一成「AI + 动作」：AI翻译 / AI搜索 / AI字幕总结 / AI字幕提问 / AI总结 / AI预填
         *      （用户原话「翻译服务搜索服务等名称改成『AI翻译、AI搜索』」）。
         */
        return [
            {
                id: 'translate',
                name: 'AI翻译',
                desc: '阅读时划词即时翻译',
                sceneTitle: '阅读',
                groupTop: true,
                getProvider: () => s().readerTranslateProvider,
                setProvider: (v) => { s().readerTranslateProvider = v; },
                getModel: () => s().readerTranslateModel,
                setModel: (v) => { s().readerTranslateModel = v; },
                prompt: {
                    label: '翻译提示词',
                    value: s().readerTranslatePrompt,
                    defaultText: DEFAULT_TRANSLATE_PROMPT,
                    onSave: (v) => { s().readerTranslatePrompt = v; void this.plugin.saveSettings(); },
                },
            },
            {
                id: 'search',
                name: 'AI搜索',
                desc: '阅读时划词联网搜索',
                sceneTitle: '阅读',
                getProvider: () => s().readerSearchProvider,
                setProvider: (v) => { s().readerSearchProvider = v; },
                getModel: () => s().readerSearchModel,
                setModel: (v) => { s().readerSearchModel = v; },
                prompt: {
                    label: '搜索提示词',
                    value: s().readerSearchPrompt,
                    defaultText: DEFAULT_SEARCH_PROMPT,
                    onSave: (v) => { s().readerSearchPrompt = v; void this.plugin.saveSettings(); },
                },
            },
            {
                id: 'cue-summary',
                name: 'AI字幕总结',
                desc: '总结详情页里的字幕内容',
                sceneTitle: '播放',
                groupTop: true,
                getProvider: () => s().readerCueSummaryProvider,
                setProvider: (v) => { s().readerCueSummaryProvider = v; },
                getModel: () => s().readerCueSummaryModel,
                setModel: (v) => { s().readerCueSummaryModel = v; },
                prompt: {
                    label: '字幕总结提示词',
                    value: s().readerCueSummaryPrompt,
                    defaultText: DEFAULT_CUE_SUMMARY_PROMPT,
                    onSave: (v) => { s().readerCueSummaryPrompt = v; void this.plugin.saveSettings(); },
                },
            },
            {
                id: 'cue-ask',
                name: 'AI字幕提问',
                desc: '对详情页字幕提问时使用的提示词',
                sceneTitle: '播放',
                // 🔴 服务商 / 模型与上面那行**完全共用**（再开一行只会让人重复选一遍），
                //    只有提示词独立：总结要 JSON 分点、提问要自然语言克制，同一段服务不了两件事。
                getProvider: () => s().readerCueSummaryProvider,
                setProvider: (v) => { s().readerCueSummaryProvider = v; },
                getModel: () => s().readerCueSummaryModel,
                setModel: (v) => { s().readerCueSummaryModel = v; },
                prompt: {
                    label: '字幕提问提示词',
                    value: s().readerCueAskPrompt,
                    defaultText: DEFAULT_CUE_ASK_PROMPT,
                    onSave: (v) => { s().readerCueAskPrompt = v; void this.plugin.saveSettings(); },
                },
            },
            {
                id: 'summary',
                name: 'AI总结',
                desc: '为条目生成 AI 总结',
                sceneTitle: '编辑',
                groupTop: true,
                getProvider: () => s().readerSummaryProvider,
                setProvider: (v) => { s().readerSummaryProvider = v; },
                getModel: () => s().readerSummaryModel,
                setModel: (v) => { s().readerSummaryModel = v; },
                prompt: {
                    label: '总结提示词',
                    value: s().readerSummaryPrompt,
                    defaultText: DEFAULT_SUMMARY_PROMPT,
                    onSave: (v) => { s().readerSummaryPrompt = v; void this.plugin.saveSettings(); },
                },
            },
            {
                id: 'prefill',
                name: 'AI预填',
                desc: '为条目自动填写字段',
                sceneTitle: '编辑',
                getProvider: () => s().readerPrefillProvider,
                setProvider: (v) => { s().readerPrefillProvider = v; },
                getModel: () => s().readerPrefillModel,
                setModel: (v) => { s().readerPrefillModel = v; },
                prompt: {
                    label: '预填提示词',
                    value: s().readerPrefillPrompt,
                    defaultText: DEFAULT_PREFILL_PROMPT,
                    onSave: (v) => { s().readerPrefillPrompt = v; void this.plugin.saveSettings(); },
                },
            },
        ];
    }

    /** 右栏：当前选中条目的完整配置（模型控件 + 常驻提示词 + 标题行的恢复默认） */
    private renderAiServiceDetail(detail: HTMLDivElement, def: AiServiceDef): void {
        detail.empty();
        const head = detail.createDiv({ cls: 'rl-ai-dhead' });
        /**
         * 🔴 2026-11-07 本轮（用户：「这个恢复默认按钮样式改成高级设置那些项恢复默认样式统一放在
         *    服务标题旁边」）：
         *    · 位置：从提示词块**底部**搬到**标题行右侧**（`.rl-ai-dtitlerow`），与
         *      「高级设置」三组的 `mountGroupReset` 同一位置语言 —— 标题右边就是这一项的复位入口；
         *    · 样式：直接复用 `.rl-group-reset`（`rotate-ccw` 图标 + 「恢复默认」文字、透明底、
         *      悬停才铺底色），⛔ 不再用实心 `.rl-btn.rl-ai-dreset`（两处观感不一致，用户点名要统一）。
         *    ⚠️ 按钮**只在有提示词的那六条**上出现（全局那条 `prompt: null`，没有提示词可复位）。
         */
        const titleRow = head.createDiv({ cls: 'rl-ai-dtitlerow' });
        titleRow.createEl('h4', { cls: 'rl-ai-dtitle', text: def.name });
        head.createDiv({ cls: 'rl-ai-dsub', text: `${def.desc} · ${def.sceneTitle}` });

        const field = detail.createDiv({ cls: 'rl-ai-dfield' });
        field.createDiv({ cls: 'rl-ai-dlabel', text: '服务商 · 模型' });
        this.renderAiPickControl(field, {
            serviceName: def.name,
            getProvider: def.getProvider,
            setProvider: def.setProvider,
            getModel: def.getModel,
            setModel: def.setModel,
        });

        // 🔴 #723：「全局默认模型」那一档删掉之后，**每条都有提示词** ⇒ 这里不再包 `if (def.prompt)`。
        //    ⛔ 别为了「以后可能有不带提示词的条目」把条件加回来 —— 真到那天应该改类型，不是留个恒真的判断。
        /**
         * 标题行右侧的「恢复默认」（#653 口径：**常显**，未修改时点了给轻提示而不是禁用/隐藏）。
         * ⛔ 不用 `disabled`：高级设置那三枚也是常显可点的，禁用态会让同一套交互出现两种观感。
         */
        const reset = titleRow.createEl('button', {
            cls: 'rl-group-reset',
            attr: {
                type: 'button',
                'aria-label': `恢复「${def.prompt.label}」的内置默认`,
                'data-tip': '清空这一项的自定义提示词，回到内置默认',
            },
        });
        safeSetIcon(reset.createSpan({ cls: 'rl-group-reset-icon' }), 'rotate-ccw');
        reset.createSpan({ cls: 'rl-group-reset-text', text: '恢复默认' });
        /** 未修改时点按钮的轻提示（与 `.rl-group-hint` 同款，1.5s 淡出；⛔ 不弹 Notice） */
        const hintEl = titleRow.createDiv({
            cls: 'rl-group-hint',
            text: '已经是默认值',
            attr: { role: 'status', 'aria-live': 'polite' },
        });

        const pf = detail.createDiv({ cls: 'rl-ai-dfield' });
        // 🔴 标签只画**一次**（与「服务商 · 模型」同款 `.rl-ai-dlabel`，由本格自己画）：
        //    `renderPromptField` 内部**不再**画 `.rl-prompt-label` —— 两边各画一遍时，
        //    同一句「翻译提示词」会上下叠成两个标签（2026-11-07 修的真 bug）。
        pf.createDiv({ cls: 'rl-ai-dlabel', text: def.prompt.label });
        const block = this.renderPromptField(pf, def.prompt);
        /**
         * 🔴 2026-11-07 本轮：脚注**只留「已自定义 · 共 N 字」**。
         *    用户点名删掉的那句「没改过，用内置默认（灰字就是默认提示词）」不再出现 ——
         *    textarea 的 placeholder 本身就把默认提示词灰字显示出来了，再说一遍是噪音。
         *    ⇒ 没自定义时整条脚注 `hidden`（不是留一行空白：空白会让两个字段之间的间距忽大忽小）。
         */
        const foot = pf.createDiv({ cls: 'rl-ai-dfoot' });
        const hint = foot.createSpan({ cls: 'rl-ai-dhint' });
        const input = (): HTMLTextAreaElement | null => {
            const el = block.querySelector('.rl-prompt-input');
            return el instanceof HTMLTextAreaElement ? el : null;
        };
        const flashHint = (): void => {
            hintEl.addClass('is-on');
            window.setTimeout(() => hintEl.removeClass('is-on'), 1500);
        };
        // 🔴 提示与按钮状态必须**回读输入框当前内容**：失焦保存后要立刻刷新，
        //    ⛔ 别用渲染时的 `def.prompt.value` 快照 —— 它会一直停在保存前（2026-11-07 修的真 bug）。
        const refreshFoot = (): void => {
            const cur = input()?.value.trim() ?? '';
            if (cur) {
                hint.setText(`已自定义 · 共 ${cur.length} 字`);
                foot.hidden = false;
            } else {
                hint.setText('');
                foot.hidden = true; // 没改过 ⇒ 整条脚注收掉（那句「没改过…」已按用户要求删除）
            }
        };
        refreshFoot();
        // `renderPromptField` 自己的 change 监听负责写盘（注册在前）⇒ 本条只刷新提示，顺序天然正确。
        block.addEventListener('change', refreshFoot);
        reset.addEventListener('click', () => {
            const el = input();
            if (!el) return;
            if (!el.value.trim()) {
                flashHint(); // 未修改：只给轻提示，⛔ 不写盘（与高级设置三枚同款）
                return;
            }
            el.value = '';
            // ⚠️ `bubbles: true` 是必须的：默认 false 时事件冒不出 textarea，本格那条刷新监听收不到。
            el.dispatchEvent(new Event('change', { bubbles: true })); // 复用同一条「归一化 → 写盘 → 刷新」通路
        });

        // 🔴 #723：`applyAll`（全局默认模型 → 一键铺到五处）已随该档一起退场，⛔ 别加回来。
    }


    /**
     * 模型控件 = **服务商 + 模型合成一个拣选按钮**（#480 ② 方案 A：点开是「左服务商 / 右模型」大面板）。
     *
     * 🔴 主从布局之后它被**两处**复用（全局那一档、以及其余六个服务）⇒ 抽成一个方法，
     *    ⛔ 别再像旧版那样把这段代码在 `renderAiServiceRow` / `renderAiGlobalRow` 各抄一遍
     *    （两份实现各写一套正是本仓栽过的坑，见 `pure/lineBuffer` 那次丢段的来龙去脉）。
     *
     * 🔴 **模型为什么必须能手填**：模型 ID 时效性极强 —— `pure/translate` 里有实测记录
     *    （2026-10-02：智谱免费档已从 `GLM-4-Flash` 扩到 `GLM-4.7-Flash`，而 `GLM-4.5-Flash`
     *    官方标注「即将下线」）⇒ 控件必须「可搜索 + 可获取 + 可手填」，⛔ 别做成只能从预置里选。
     */
    private renderAiPickControl(
        host: HTMLElement,
        opts: {
            serviceName: string;
            getProvider: () => unknown;
            setProvider: (v: AiProviderChoice) => void;
            getModel: () => string | undefined;
            setModel: (v: string | undefined) => void;
        },
    ): void {
        const choice = normalizeAiChoice(opts.getProvider());
        // 🔴 #480 ①：**不启用时模型段根本不参与计算**。`normalizeProvider('off')` 会归一到 zhipu，
        //    `shownModel()` 于是回一个 `GLM-4-Flash` ⇒ 下面 `model ||` 把 `aiPickText` 的「不启用」盖掉，
        //    真机上就是「灰点 + 亮着模型名」两套信息打架（`aiPickText` 的单测钉不住组装处）。
        const off = isAiOff(choice);
        const model = off ? '' : this.shownModel(normalizeProvider(choice), opts.getModel());
        const pick = host.createDiv({ cls: 'rl-ai-pick' });
        const btn = pick.createEl('button', {
            cls: 'rl-ai-pick-btn',
            attr: { type: 'button', 'aria-haspopup': 'dialog' },
        });
        renderAiIcon(btn.createSpan({ cls: 'rl-ai-icon' }), aiChoiceIcon(choice));
        // 🔴 #494：文本只留**模型名**，服务商由左侧图标承担（`aiChoiceIcon` 就是为这件事存在的）。
        //    ⚠️ 「不启用」没有模型可显示 ⇒ 仍退回服务商名，⛔ 别显示成空白格。
        btn.createSpan({ cls: 'rl-ai-pick-text', text: model || aiPickText(choice, model, this.customSlotNames()) });
        btn.createSpan({ cls: 'rl-ai-caret', text: '▾' });
        // 🔴 #481 ②：控件固定宽度、文本超长走省略号 ⇒ 悬停提示必须给全称。
        //    走 `data-tip` 自绘气泡（本仓 UI 规范：禁原生 `title` 黄条），只在有模型时挂。
        if (model) btn.setAttribute('data-tip', aiPickText(choice, model, this.customSlotNames()));
        if (off) btn.addClass('is-off');
        // ⛔ #485 用户裁定撤掉「非预置模型 ⇒ 整格文字走主题色」：实测同一列三行颜色不一致，
        //    看着像两种控件。「这不是本仓写死的候选」这个信息留在弹窗小字里。
        btn.addEventListener('click', () =>
            this.openAiPicker(opts.serviceName, choice, opts.getProvider, opts.setProvider, opts.getModel, opts.setModel),
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
     * 提示词编辑块（2026-11-07 主从布局后**只剩右栏详情**一个调用方，常驻、不再折叠）：
     *  - 默认提示词（DEFAULT_*_PROMPT）只作 **placeholder 灰字**呈现——不可编辑、点不掉，纯粹让人知道默认长什么样；
     *  - 用户点进框里就是**空框**，写入自己的提示词即覆盖默认；清空（或粘贴回与默认完全一致）→ 存 undefined 恢复默认。
     *  - 改动在失焦（change）时保存，不逐键写盘。
     * ⚠️ **本方法不画标签**：标签由调用方用 `.rl-ai-dlabel` 画（与「服务商 · 模型」同款）。
     *    曾经这里也画一条 `.rl-prompt-label`，与调用方的标签同文案叠成两行（2026-11-07 修）。
     * 返回该块元素（调用方拿它查 textarea / 挂「保存后刷新提示」监听）。
     */
    private renderPromptField(
        body: HTMLDivElement,
        opts: { value?: string; defaultText: string; onSave: (v: string | undefined) => void },
    ): HTMLDivElement {
        const wrap = body.createDiv({ cls: 'rl-prompt-row' });
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
     * 渲染单个服务商 Key 行（AI 翻译 / 总结 / 搜索内，翻译与总结共用）：可折叠（同 ① 搜索配置 createApiKeyRow 观感）——
     * 头 = 服务商名 + 已配置徽标 + ▸，点击展开 body（Key 密文输入 + 测试连接 + 结果）。
     */
    /**
     * 渲染单个服务商 Key 行（翻译 / 总结 / 搜索 / **云合成**共用）：可折叠（同 ① 搜索配置 createApiKeyRow 观感）——
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
        // m07854 ②：登记给「统一周期管理」面板的一键检测回调
        this.registerCredentialBadge(aiCheckKey(provider), refreshBadge);
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
        // m07854 ②：登记给「统一周期管理」面板的一键检测回调（自定义槽位按 slot 分键）
        this.registerCredentialBadge(aiCheckKey(slot), refreshBadge);
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
        // 🔴 2026-10-25 用户裁定（原文：「第二格填的只能是从 themoviedb.org 的「设置 → API」获取的 32 位字符串，占位说明也是」）：
        //    这一格**只收 32 位 v3 API Key**。旧版占位写「v3 API Key 或 v4 Read Access Token」，
        //    结果两格都能填两种、用户怎么填都「看起来对」，填错了也看不出（#700/#701 两轮返工的真因）。
        if (meta.id === 'tmdb') return 'TMDB v3 API Key（32 位，设置 → API）';
        // 🔴 #580：微信读书的凭据是 **Cookie** 不是 Key —— 占位符要说清「从哪儿抄、抄什么」，
        //    以及「只在同步书架时用得上」（否则用户会以为不填就不能搜）。
        if (meta.id === 'weread') return '微信读书 Cookie（书架同步用）';
        // 🔴 #639 ⑥：Steam 的 Key **只服务同步**（搜索/详情免 Key）—— 占位符要说清这一点
        if (meta.id === 'steam') return 'Steam Web API Key（同步库用）';
        return `输入 ${meta.label} API Key`;
    }

    /**
     * ③-3 / ③-4（2026-11-12 用户 m00353 / m05505）：凭据行里的**扫码登录**图标按钮。
     *
     * 🔴 m05505 用户原话：「扫码登录按钮改成二维码小图标按钮放在输入框的右侧旁边
     *    （紧挨着"显示"按钮的左侧）」⇒ 本方法产出的按钮**属于输入框那一行**（`.rl-secret`），
     *    ⛔ 不属于下面那排 `.rl-key-actions`（与「立即同步」「测试连接」同行会变回他不要的样子）。
     *    位置由 `fillSecretRow` 的 `beforeEye` 保证：input → 本按钮 → 「显示」。
     *
     * 🔴 为什么是图标不是带字按钮（不是审美问题）：一行里已经有「立即同步」「测试连接」两颗带字的，
     *    再塞第三颗带字的，窄侧栏会把它们挤成两三行；图标只占 `--icon-size`。
     *    提示走 `iconButton` 的 `data-tip`（①-9 的单一真源，⛔ 别另挂 aria-label 叠两层）。
     *
     * 🔴 按钮只负责**开弹窗**：抓 Cookie、轮询、开子窗口全在 `modals/QrLoginModal` +
     *    `services/qrLogin`（设置页是同步渲染路径，⛔ 别在这里发请求）。
     * 🔴 落盘在**回调里**（不在弹窗里）：写盘要连 `saveSettings` + `clearCredentialStatus` +
     *    徽标刷新三件事，散在弹窗里必漏其中一件。`onPicked` 就是干这三件事的唯一入口。
     *
     * @param host 输入框那一行（`.rl-secret` 容器）
     * @param platform 平台（只剩 B 站 / 微信读书 —— 豆瓣扫码已按 m05505 删除）
     * @param onPicked 拿到凭据后落盘（由调用方提供，因为它要碰该行自己的输入框与徽标）
     */
    private renderQrLoginButton(
        host: HTMLElement,
        platform: QrPlatform,
        onPicked: (picked: QrLoginPicked) => void,
    ): HTMLButtonElement {
        const label = platform === 'bilibili' ? 'B 站' : '微信读书';
        const btn = iconButton('rl-qr-open', 'qr-code', `扫码登录${label}`);
        host.appendChild(btn);
        btn.addEventListener('click', () => {
            new QrLoginModal(this.app, {
                platform,
                onPicked: (picked) => onPicked(picked),
            }).open();
        });
        return btn;
    }

    /**
     * ③-3 / ③-4：凭据行 = 「输入框 + 扫码图标」**或**「当前账号 + 退出登录」二选一。
     *
     * 🔴 用户 m05505 原话：「用扫码登录的 UI 要变化成原来的输入框区域替换为
     *    『当前账号: 微信读书用户』」⇒ 登录成功后**输入框整块消失**，不是「框里填上 Cookie」。
     *    理由（用户视角）：Cookie 是几百字符的密文，显示出来既没法核对也没法用；
     *    用户真正要知道的是「我现在是谁」。
     *
     * 🔴 图标按钮在两种形态下**都在**（用户 m05529 裁定「保留图标按钮 + 加一个『退出登录』」）：
     *    登录后仍要能换账号 —— 那就是再扫一次，⛔ 别让用户先退出再扫。
     *
     * ⚠️ 账号名取不到（Cookie 里没有身份字段）时**退回输入框**，⛔ 别显示「当前账号: 未知」
     *    把框藏掉 —— 那样用户既看不到值、也没法手改，等于把凭据锁死。
     */
    private renderQrAccountField(
        host: HTMLDivElement,
        opts: {
            platform: QrPlatform;
            placeholder: string;
            value: string;
            onInput: (v: string) => void;
            /** 落盘（调用方提供：字段名、徽标刷新各不相同） */
            onPicked: (picked: QrLoginPicked) => void;
            /** 退出登录（调用方清字段 + 刷徽标） */
            onLogout: () => void;
        },
    ): void {
        const { platform } = opts;
        const name = accountNameOf(platform, opts.value);
        host.empty();

        if (!name) {
            this.createSecretField(host, {
                placeholder: opts.placeholder,
                value: opts.value,
                onInput: opts.onInput,
                // 🔴 用户 `m05813`：「把二维码小图标按钮放在 cookie 框的**最左旁**」
                //    ⇒ 走 `beforeInput`（行内首元素），不再是「显示」左边的 `beforeEye`。
                beforeInput: (wrap) => {
                    this.renderQrLoginButton(wrap, platform, (picked) => {
                        opts.onPicked(picked);
                        // 重绘：账号名变了 ⇒ 整块切成「当前账号」形态
                        this.renderQrAccountField(host, { ...opts, value: picked.cookie });
                    });
                },
            });
            return;
        }

        // 已登录形态：当前账号 + 重新扫码 + 退出登录
        const row = host.createDiv({ cls: 'rl-acct' });
        row.createSpan({ cls: 'rl-acct-label', text: '当前账号' });
        row.createSpan({ cls: 'rl-acct-name', text: name });
        // 换账号 = 再扫一次（用户 m05529 裁定「保留图标按钮」）
        this.renderQrLoginButton(row, platform, (picked) => {
            opts.onPicked(picked);
            this.renderQrAccountField(host, { ...opts, value: picked.cookie });
        });
        const logout = row.createEl('button', { cls: 'rl-btn', text: '退出登录' });
        logout.addEventListener('click', () => {
            opts.onLogout();
            this.renderQrAccountField(host, { ...opts, value: '' });
        });
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
            // 🔴 2026-10-25 用户裁定后：两格各只收一种，所以这里**按格说清楚**，
            //    ⛔ 不再用「两种都能填」的和稀泥文案 —— 用户这次就是被那句「Session ID 或 access_token」绕进去的。
            //    校验走纯函数（与输入框下方就地提示同一份判据，⛔ 别在这里重写一遍正则）。
            const keyIssue = tmdbApiKeyFieldIssue(apiKey);
            if (keyIssue) {
                this.flashInlineHint(actions, keyIssue);
                return;
            }
            const sesIssue = tmdbSessionFieldIssue(sessionId);
            if (sesIssue) {
                this.flashInlineHint(actions, sesIssue);
                return;
            }
            if (!apiKey) {
                this.flashInlineHint(actions, '未配置 TMDB API Key —— 先在上面填入 32 位 v3 API Key（设置 → API）');
                return;
            }
            if (!sessionId) {
                this.flashInlineHint(
                    actions,
                    '未配置 TMDB access_token —— 先在上面填入 v4 用户认证流程（request_token → 浏览器批准 → access_token）拿到的 eyJ 长串',
                );
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
            // ⚠️ 2026-10-25 用户：「steam凭据行下的框占位符怎么说明是64位，改成17位」——
            //    真值 = SteamID64 是 **17 位**数字（`76561198…`）；旧文案写「64 位」是把它跟
            //    「SteamID**64**」这个叫法混了，用户照着数位数必然以为自己填错了。
            placeholder: '17 位 SteamID（形如 76561198…）',
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
            btn.disabled = false;
            btn.setText('立即同步');
            btn.removeClass('rl-btn-loading');
            // 🔴 2026-10-25（用户：「所有类型账号同步是要先列出弹窗列出游戏让我勾选才同步（库内已有要提示覆盖）」）：
            //    口径从「点一下就全量落库」改为「**先弹窗列清单、勾选后才落库**」，与豆瓣 / Bangumi /
            //    TMDB / 微信读书四个同步弹窗完全同构。⛔ 别在这里再写一份落库循环 ——
            //    全量静默同步仍由 `syncSteamNow()` 承担（启动时那条），两者共用同一套判重键。
            this.plugin.openSteamSync();
            return;
        });
    }

    /**
     * 🔴 #664：在一颗按钮**旁边**闪一条轻提示（`host` 是它所在的动作行 `.rl-key-actions`）。
     *
     * 与「恢复默认」那枚同一视觉：淡底小字，2.4s 后自动消失。
     * ⚠️ 同时挂 `role="status"`，读屏也能听见（⛔ 不要只靠颜色 / 位置传达）。
     *
     * 🔴🔴 2026-10-25 用户裁定：「元数据源的立即同步按钮后出来的提示文字**也不要更改同步和连接
     *     按钮的位置**」。⇒ 落点从「动作行末尾」改成「行首回执槽 `.rl-key-result`」。
     * 为什么必须这样（真 Chrome 实测，改回来前先看数）：
     *   · 旧写法 `host.appendChild(tip)` 会给 `.rl-key-actions` **多加一个 flex item**；
     *     它是 `justify-content: flex-end` + 回执槽 `flex: 1 1 auto` ⇒ 两枚按钮被整体左推。
     *     实测（`_probe_inlinehint.cjs`，文案取最长那条 TMDB Session ID 提示）：
     *     「立即同步」left **638.34 → 185.91**、「测试连接」left **715.67 → 263.23**（左移 452px）。
     *   · 改进回执槽后：槽宽固定吃满行首剩余空间，提示只在**槽内**排版 ⇒ 两枚按钮 left/right/top
     *     **逐位相等**（同一支探针的 B 组），行高恒 25px。
     * ⚠️ 旧的「回执随行重建一起消失」这条顾虑已不成立：`redisplayKeepingRow` 会把文案写回去；
     *    且本条只活 2.4s、期间不重建行。
     */
    private flashInlineHint(host: HTMLElement, text: string): void {
        host.querySelector('.rl-inline-hint')?.remove();
        const tip = document.createElement('span');
        tip.className = 'rl-inline-hint';
        tip.setAttribute('role', 'status');
        tip.textContent = text;
        // 文案被 CSS 压成单行 + 省略号（防止换行把按钮顶下去），全文挂 title 供悬停查看
        tip.setAttribute('title', text);
        const slot = this.actionRowResultSlot(host);
        if (!slot) {
            // 兜底：结构变了也不许丢提示（此处会位移，但只有真找不到槽时才会走到）
            host.appendChild(tip);
            window.setTimeout(() => tip.remove(), 2400);
            return;
        }
        // 提示与回执共用那一格：先把已有回执文字让出来，2.4s 后连提示一起还原
        const prev = slot.textContent ?? '';
        slot.setText('');
        slot.appendChild(tip);
        window.setTimeout(() => {
            tip.remove();
            if (prev) slot.setText(prev);
        }, 2400);
    }

    /** 动作行里行首那个回执槽（`.rl-key-result`）；只认**直接子节点**，避免命中别处的同名元素。 */
    private actionRowResultSlot(host: HTMLElement): HTMLElement | null {
        const kids = Array.from(host.children);
        for (const el of kids) {
            if (el.classList.contains('rl-key-result')) return el as HTMLElement;
        }
        return null;
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
     * 搜索配置折叠项内「单源配置行」：**来源图标** + 源名 + 状态徽标（已配置/未配置/可选 Key）+ ▸，
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
    /**
     * 建一条**可点链接**的提示条（2026-11-06 用户裁定：「各项描述里的『获取官网』从纯文本改成可点击超链接
     * —— 所有要 cookie 或 key 的都加」）。
     *
     * 🔴 为什么抽成一个方法：全仓有**五处**要渲染这类 hint（元数据凭据 / 音乐下载凭据 / 网络播放两条 /
     *    yt-dlp），原先只有元数据凭据那一处做了切段，另外三处仍是 `createDiv({ text })` 纯文本
     *    ⇒ 同一句「到 xx.com 获取」在一个 Tab 能点、在另一个 Tab 点不动（用户报的就是这个）。
     *    ⛔ 别让任何一个调用点再写 `text:` —— 那会静默退回不可点。**统一走这里**。
     *
     * ⛔ 不在数据层（`pure/sourceRegistry` 的 `hint` / 常量 `*_DESC`）里塞 `<a>` 或 markdown：
     *    那些是纯数据（有单测按三段式钉住），且渲染端一旦用 `innerHTML` 就是注入面（本仓铁律）。
     *    ⇒ 文案一个字不改，只把「像域名的片段」变成 `<a>`（切段逻辑真源 = `pure/sourceLink`）。
     *
     * ⚠️ 既写 `href` 也绑 `click`：桌面端裸 `<a>` 的默认跳转有时被 shell 拦掉，click 里再 `window.open`
     *    一次是双保险（与同文件 `REPO_URL` 那两处按钮同款）。
     */
    private renderHintNote(host: HTMLElement, text: string, cls = 'rl-hint-note'): HTMLElement {
        const note = host.createDiv({ cls });
        for (const part of splitHintLinks(text)) {
            if (!part.url) {
                note.createSpan({ text: part.text });
                continue;
            }
            const a = note.createEl('a', {
                cls: 'rl-hint-link',
                text: part.text,
                attr: { href: part.url, target: '_blank', rel: 'noopener noreferrer', 'data-tip': part.url },
            });
            a.addEventListener('click', (ev: MouseEvent) => {
                ev.preventDefault();
                window.open(part.url as string, '_blank');
            });
        }
        return note;
    }

    private createApiKeyRow(parent: HTMLDivElement, id: KeySourceId): void {
        const meta = PROVIDER_META[id];
        if (!meta.keyField) return; // 免 Key 源不在此列
        const keyField: string = meta.keyField;
        const keyField2: string | undefined = meta.keyField2 ?? undefined; // 双凭据源（igdb）第二字段
        const row = parent.createDiv({
            cls: 'rl-key-row rl-prov-card',
            // 🔴 #664：带上源 id —— 同步完要刷新徽标时，靠它把**同一行**找回来、
            //    保住它的展开态与回执（否则整页重建后那一行会自己合上，用户什么都看不到）。
            // 🔴 ③-1（2026-11-12）：再加 `data-cred-key` ——「统一周期管理」面板点名称要跳到**这一行**。
            //    值与 `pure/credentialMeta` 的 `key` 逐字同源（`source:<id>`），⛔ 两处不许各拼一套；
            //    跳转实现见 `jumpToCredentialRow`。
            attr: { 'data-source-id': id, 'data-cred-key': sourceCheckKey(id) },
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
            //   · `keyField2OptionalForConfigured`（tmdb）：access_token 只服务账号同步，
            //     搜索只用 API Key ⇒ **主凭据有值即已配置**，否则就与「测试连接」（只查 API Key）互相打架。
            //   ⚠️ 只改徽标；同步按钮在发请求前自己拦「还缺 access_token」（renderTmdbSyncButton / TmdbSyncModal）。
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
                // 🔴 本轮用户裁定：空态只有**一套**词 —— 「未配置」（Google Books 也从「可选 Key」统一过来）。
                //    ⛔ 别再加第二套文案（曾经的「可选 Key」分支已连同 `OPTIONAL_KEY_SOURCES` 一起删除）。
                badge.setText('未配置');
            }
            badge.toggleClass('rl-key-badge-on', has && !expired);
            badge.toggleClass('rl-key-badge-bad', expired);
        };
        // m07854 ②：登记给「统一周期管理」面板的一键检测回调
        this.registerCredentialBadge(sourceCheckKey(meta.id), refreshBadge);
        refreshBadge();
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        const body = row.createDiv({ cls: 'rl-key-body' });
        // 🔴 本轮用户裁定：「各项描述里的『获取官网』从纯文本改成**可点击超链接**（所有要 cookie 或 key 的都加）」。
        //    ⛔ 不在 `pure/sourceRegistry` 的 `hint` 里塞 `<a>`/markdown —— 那份是纯数据（有单测按三段式钉住），
        //       且渲染端一旦用 `innerHTML` 就是注入面（本仓铁律）。
        //    ⇒ 文案不动，交给 `pure/sourceLink.splitHintLinks` 切段，这里逐段建节点。
        //    ⚠️ 链接只认**绝对 https**（splitHintLinks 已补前缀）；`window.open` 与同文件 `REPO_URL` 两处按钮同款。
        this.renderHintNote(body, meta.hint, 'rl-hint-note');
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
        // 🔴🔴 2026-10-25 用户裁定：「TMDB 行下的各个框间隔要同步 IGDB 行的」。
        //   TMDB 两格各带就地校验，若按老写法「每格后面插一条 `.rl-secret-issue`」，
        //   两框之间 = gap(6) + margin-top(2) + min-height(1.4em≈19) + gap(6) ≈ 34px，
        //   而 IGDB 两框之间就是 `.rl-key-body` 的 `gap:6px` ⇒ 肉眼看得出「TMDB 松一档」。
        //   ⇒ 整行**只建一个**提示槽，且挂到**动作行之后**（`mountAfter(actions)`，见方法末尾）。
        //     两格于是直接相邻（6px，与 IGDB 逐像素一致）；「最后一格框 → 按钮行」也只隔 8px
        //     （与 IGDB / Steam 等所有单格源同一数值），提示展开只往下推、⛔ 不动按钮。
        //   ⚠️ 槽必须**最后** mount：先建就又会夹在两个框中间（或框与按钮之间），等于没修。
        const issueSlot = meta.id === 'tmdb' && keyField2 ? this.makeIssueSlot() : null;
        /**
         * ③-4（2026-11-12 用户 m00353 / m05505）：微信读书这一行 = 「输入框 + 扫码图标」
         * 或「当前账号 + 退出登录」二选一，整块由 `renderQrAccountField` 渲染。
         *
         * 🔴 为什么不在这里直接建输入框：登录成功后要**整块换形态**（用户 m05505 原话
         *    「原来的输入框区域替换为『当前账号: 微信读书用户』」）⇒ 必须有个稳定的宿主容器，
         *    换形态就是重绘这个容器，⛔ 不是往输入框里塞值。
         * ⚠️ 宿主容器同时承担「重绘后 DOM 位置不变」——它建在原来的位置，
         *    重绘只清它的子节点，动作行（同步/测试）不会跟着跑位。
         */
        const mainField = (): void => {
            if (meta.id === 'weread') {
                const host = body.createDiv({ cls: 'rl-acct-host' });
                const persist = (cookie: string): void => {
                    this.plugin.settings.wereadCookie = cookie;
                    void this.plugin.saveSettings();
                    // #589：换了凭据，旧的「连接失败」结论立刻作废
                    this.plugin.clearCredentialStatus(sourceCheckKey(meta.id));
                    refreshBadge();
                    // #758：扫码登录 / 手动粘贴 / 退出登录都会走到这里 ⇒ 面板要立刻反映
                    this.refreshCredentialTable();
                };
                this.renderQrAccountField(host, {
                    platform: 'weread',
                    placeholder: this.credentialPlaceholder(meta),
                    value: this.settingValue(keyField),
                    onInput: (v) => persist(v),
                    onPicked: (picked) => persist(picked.cookie),
                    onLogout: () => persist(''),
                });
                return;
            }
            this.createSecretField(body, {
                placeholder: this.credentialPlaceholder(meta),
                value: this.settingValue(keyField),
                // 🔴 2026-10-25 用户裁定：TMDB 的 Key 格**只收 32 位 v3 API Key**，填 v4 令牌就当场提示改填下一格
                // ⚠️ 校验提示走**整行共用的槽**（`issueSlot`），⛔ 别让本格自建一条 —— 那会把两框间距撑到 ~34px
                issue: meta.id === 'tmdb' ? tmdbApiKeyFieldIssue : undefined,
                issueSlot: issueSlot ?? undefined,
                onInput: (v) => {
                    (this.plugin.settings as unknown as Record<string, unknown>)[keyField] = v;
                    void this.plugin.saveSettings();
                    // #589：值一改，旧的「连接失败」结论立刻作废（⛔ 别让红标挂在一个刚填的新值上）
                    this.plugin.clearCredentialStatus(sourceCheckKey(meta.id));
                    refreshBadge();
                    // #758：这一行从「未配置」变「已配置」要立刻反映到上面的面板
                    this.refreshCredentialTable();
                },
            });
        };
        const secondField = (): void => {
            // 🔴 2026-10-25 用户裁定（原文：「Session ID 那一格填的只能是 access_token 近 300 位字符串…占位说明也是」）：
            //    这一格**只收 v4 access_token**（v4 用户认证流程 request_token → 批准 → access_token 的产物）。
            //    旧占位写「Session ID 或 v4 access_token」= 两种都收，用户按老文档填 32 位 session_id 也「看起来对」，
            //    但那套在本插件里已经不走了 ⇒ 名字都改掉，别再叫「Session ID」把人往 v3 文档引。
            const placeholder =
                meta.id === 'tmdb' ? 'TMDB v4 access_token（eyJ 开头长串，账号同步用）' : `${meta.label} Client Secret`;
            this.createSecretField(body, {
                placeholder,
                value: this.settingValue(keyField2 as string),
                issue: meta.id === 'tmdb' ? tmdbSessionFieldIssue : undefined,
                issueSlot: issueSlot ?? undefined,
                onInput: (v) => {
                    (this.plugin.settings as unknown as Record<string, unknown>)[keyField2 as string] = v;
                    void this.plugin.saveSettings();
                    this.plugin.clearCredentialStatus(sourceCheckKey(meta.id));
                    refreshBadge();
                    // #758：同 `mainField` —— 双凭据源（IGDB / TMDB）两格任一变动都要刷新面板
                    this.refreshCredentialTable();
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
        // 🔴🔴 2026-10-25：TMDB 双格的共用校验槽改为挂到**动作行之后**（见下方 `if (issueSlot) issueSlot.mountAfter(actions)`）
        //   ⇒ 这里不再 mount；⚠️ 槽仍必须「最后」挂 —— 提前挂就又会夹在框与按钮之间，间距问题回来。
        //   ⚠️ 只有 `issueSlot` 非空（TMDB 双格）时才挂；其余源的提示行仍由各自 `createSecretField` 自建。
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
        // ③-4（2026-11-12 用户 m00353）：微信读书的**扫码登录图标**已经挂进输入框那一行
        //   （见 `mainField()` 里的 `beforeEye`），⛔ 不再往动作行里加按钮。
        //   ⚠️ 豆瓣扫码整条删除是用户 m05505 的明确要求（原话：「删除豆瓣的扫码登录」），
        //      别再按 ③-2 把它加回来。
        // 🔴 #665（用户：「Bangumi 元数据源凭据行加个同步按钮并排，也做 TMDB 的同步接入」）：
        //    Bangumi / TMDB 也各加一颗 —— 五个可同步源的动作行**同构**（Steam / 微信读书 / 豆瓣 / Bangumi / TMDB）。
        //    TMDB 需要第二凭据 session_id（meta.keyField2 已声明，双字段输入框自动出现）。
        if (meta.id === 'bangumi') this.renderBangumiSyncButton(actions);
        if (meta.id === 'tmdb') this.renderTmdbSyncButton(actions);
        // 🔴🔴 2026-10-25（用户：「TMDB行的立即同步测试连接按钮和上面的框间隔怎么和其他行的间隔不同，给我统一下」）：
        //    TMDB 双格的共用校验槽挂到**动作行之后**（不是两框之间、也不是按钮行里）。
        //    为什么是这个位置（两个要求同时成立）：
        //      ⑴ 「间距与别行一致」——「最后一格输入框 → 按钮行」之间只隔 `.rl-key-body` 的 gap 6px
        //         + `.rl-key-actions` 的 margin-top 2px = **8px**，与 IGDB / Steam 等所有单格源逐像素相同。
        //         改前槽夹在框与按钮之间（`min-height:1.4em` ≈ 16.8px）⇒ 那一处是 32.8px，一眼看得出不一样。
        //      ⑵ 「提示出现不许挪按钮」——槽是这一行的**最后一个子项**，按钮在它上方
        //         ⇒ 提示展开只会把下方内容往下推，按钮 rect 一个像素都不动（#699 的口径继续成立）。
        //    ⚠️ 空态 `display:none`（`.rl-secret-issue-tail.is-empty`）：它下面没有要护的东西，
        //       别保留高度——留着会让 TMDB 行常年比别的行高一截，又变成「间距不一致」。
        if (issueSlot) issueSlot.mountAfter(actions);
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
            // #758：元数据源行内「测试连接」的结论也要落到上面的面板
            this.refreshCredentialTable();
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
        // 🔴 2026-11-12（用户 m00353 ①-14）：「组下的书籍/漫画/影视/动画/音乐/游戏前面加
        //    **主题色通用类型小图标按钮**」⇒ 组名前补一枚类型图标，颜色走类型色真源 `TYPE_COLORS`。
        //    ⚠️ 三点口径：
        //    ⑴ **⛔ 不是按钮**：用户原话写「小图标按钮」，但它没有点击行为 —— 做成 `<button>` 会给
        //       读屏和键盘多一个空 tab 停靠点（本仓 `.rl-srcchk-gname` 旁也没有任何交互）。
        //       故用装饰性 `<span aria-hidden="true">`，语义上它就是标题的一部分。
        //    ⑵ **颜色内联**：`TYPE_COLORS` 是唯一色源（`data/types`），CSS 里 ⛔ 不许再写一份 hex；
        //       `comic` 不是 `EntryType`（它是 book 的子分类）⇒ 取 `TYPE_COLORS.book`，
        //       与它「和书籍同属书籍类目、在 UI 里紧跟书籍成行」的定位一致。
        //    ⑶ 图标名取 `SOURCE_GROUP_ICONS`（纯数据表，六个值均已实测存在于 asar 白名单）
        //       —— 未知名会让 `setIcon` **静默 no-op**，界面上只剩空白，故不在此处手写字符串。
        const gicon = head.createSpan({ cls: 'rl-srcchk-gicon' });
        gicon.setAttribute('aria-hidden', 'true');
        gicon.style.color = TYPE_COLORS[SOURCE_GROUP_COLOR_KEY[group]];
        safeSetIcon(gicon, SOURCE_GROUP_ICONS[group]);
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
            // 🔴 用户 m07854 ①（2026-11-13）：**显式落盘，⛔ 不再「等于默认链就删键」**。
            //    旧行为有两个后遗症：⑴ 用户勾成「与当前默认一致」⇒ 键被删 ⇒ 读回走 `resolveSourceChain`
            //    的 undefined 回退 ⇒ 将来 `DEFAULT_CHAINS` 一改，他**确认过**的配置被追溯性改掉；
            //    ⑵ 「默认值」因此不是用户配置的一部分，而是一个随代码演进的活值 —— 与用户原话
            //    「不要强制覆盖用户已修改过」直接冲突。现在只要用户动手，就把它落成他自己的值。
            const next = { ...(this.plugin.settings.sourceChains ?? {}) };
            next[group] = norm;
            this.plugin.settings.sourceChains = next;
            void this.plugin.saveSettings();
            render();
        }

        const render = (): void => {
            const chain = currentChain();
            list.empty();
            for (const c of candidates) {
                const checked = chain.includes(c.id);
                const line = list.createEl('label', { cls: 'rl-srcchk-line' });
                // 🔴🔴 本轮用户裁定：「元数据搜索源启用，对各个勾选项鼠标 hover 2 秒后轻提示」，
                //    并逐字给了六组 13 条一句话说明（真源 = `pure/sourcePitch`，⛔ 别在这里写死字面量）。
                //    ⑴ 文案优先用 `sourcePitch(group, id)`；查不到才回退到「是否启用…搜索」那句通用话
                //       —— 这样以后新接入一个源、忘配文案时**仍有提示**，只是话比较干（⛔ 别回退成空串）。
                //    ⑵ `data-tip-delay` 是本轮新加的能力（见 `services/globalTooltip.tipDelayOf`）：
                //       这一排勾选框密集，用全局 500ms 会在扫过时连闪一堆气泡。
                const pitch = sourcePitch(group, c.id);
                const genericTip = `是否启用「${c.label}」参与「${GROUP_LABELS[group]}」搜索`;
                // 🔴🔴 2026-11-06 修「勾选项 hover 无反应」（真缺陷，用户报障）：
                //    原先把 `data-tip` / `data-tip-delay` 挂在 `<input type="checkbox">` 上，
                //    而 `globalTooltip.onOver` 用的是 `target.closest('[data-tip]')` ——
                //    用户鼠标停在**源名文字**上时（这是绝大多数实际操作），target 是兄弟 `<span>`，
                //    `closest` 往上只找到 `<label>` 就停（span 自己没 data-tip）⇒ **一个气泡都不出**。
                //    只有把鼠标精确停在 15×15 的勾选框上才碰得到 —— 难怪用户说「hover 无反应」。
                //    ⇒ 属性必须挂在**整行** `label` 上：文字、勾选框、行内空白都能触发。
                //    ⛔ 别同时在 input 上留一份：`closest` 会命中最近的 input，延迟就会变成「鼠标一进
                //       勾选框就立刻出气泡、进文字反而没有」—— 两个来源必须收敛成一个（本行）。
                //    ⑶ 延迟 2000 → **1000**：2000ms 是当年「怕扫过时连闪」的估计值，
                //       用户实测反馈「hover 后像是坏了、要等好久」⇒ 取 1 秒（仍是全局 500 的两倍，
                //       足够区分「扫过」与「真停留」，又不会让人怀疑功能失效）。
                line.setAttribute('data-tip', pitch || genericTip);
                line.setAttribute('data-tip-delay', '1000');
                const cb = line.createEl('input', {
                    cls: 'checkbox',
                    attr: {
                        type: 'checkbox',
                    },
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
        /**
         * 🔴 #484（「不能实时点击反馈」根因 ①）→ m09565 ② 二次修正：
         *    本方法**整页重建**（`containerEl.empty()`），不存取滚动位置的话，
         *    点完一处、弹窗一关，页面就**跳回顶部**，刚改的那行已经滚出视野。
         *
         * 🔴🔴 2026-11-12 真机实测：原来这里读的是 `.rl-set-content` —— **读错了元素**。
         *    真机量到的链路（设置页 popout，800×520）：
         *      `.rl-set-content`      ch 1666 / sh 1666 / overflow visible  ⇒ **永远不滚**
         *      `.rl-set-shell`        ch 1765 / sh 1765 / overflow visible  ⇒ 不滚
         *      `.vertical-tab-content` ch 490 / sh 1837 / **overflow auto** ⇒ **真正在滚的是它**
         *    也就是说旧的 `keepScroll` 恒为 0，从来没生效过；「点交互被甩回顶部」
         *    不是 TTS 独有，**任何走 `display()` 的点击都会**（用户 m09565 ② 的原话
         *    「还有搜索UI层其他项是否也存在这种问题」——存在，而且是全页级的）。
         *
         * ⇒ 改成**沿祖先链找第一个真的可滚的元素**，而不是写死某个类名：
         *    判据 = `overflow-y` 是 auto/scroll 且 `scrollHeight > clientHeight + 4`。
         *    ⚠️ ⛔ 别退回写死 `.rl-set-content`：它的 `overflow` 是 visible，高度跟着内容长，
         *       `scrollTop` 赋什么都会被夹回 0 —— 看起来「有代码」其实一次都没跑。
         *    ⚠️ 判据里要留 4px 容差：亚像素舍入会让 `sh === ch` 抖动。
         */
        const scrollHost = ReelLudicSettingTab.findScrollHost(containerEl);
        const keepScroll = scrollHost ? scrollHost.scrollTop : 0;
        containerEl.empty();
        this.tabItems.clear();
        this.pageEls.clear();
        this.tabsEl = null;
        // #758：旧 DOM 已整体丢弃 ⇒ 指向它的刷新闭包必须立刻失效，
        //   ⛔ 别让任何一次迟到的 `refreshCredentialTable()` 打到已卸载的节点上。
        //   新闭包由下面 `renderPage('search')` → `renderCredentialTable` 重新赋值。
        this.credentialTableRefresh = null;
        // m07854 ②：同理 —— 各凭据行的徽标闭包也指向旧 DOM，必须整批丢弃。
        //   新闭包由下面各 builder（`renderCredentialRows` / `renderNetPlaybackRows` /
        //   `createApiKeyRow` / 自定义槽位）重新登记。
        this.credentialBadgeRefresh.clear();

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
            /**
             * 🔴🔴 2026-11-14（用户 m05673 手机实测：「点页签后只有顶部页签，内容一片空白」）：
             *
             * 真因不是某一页懒渲染 —— 是**这里没有围栏**。六个页是同一个循环里连着建的，
             * `renderPage` 一旦抛异常（手机端 `process` 不存在之类），循环当场中断：
             *   · 后面的页**一个都没建**；
             *   · 第 4708 行的 `setActivePage()` 根本没执行到 ⇒ 没有任何 `.rl-set-page` 拿到 `is-active`
             *     （`.rl-set-page` 默认 `display:none`）；
             *   · 页签栏是在这个循环**之前**建的，所以它好好地在 ⇒ 用户看到的就是「页签在、内容是空的」。
             *
             * 修法两层，缺一不可：
             *   ① **逐页 try/catch** —— 一页坏只塌一页，其余页照常可用；
             *   ② 坏掉的那页**自己写清原因**（而不是留白），用户才知道是插件的问题还是环境不支持。
             * ⛔ 别把 catch 写成静默吞掉（`catch {}` 或只 `console.warn`）—— 那样下次同样的白屏
             *    又只能靠用户在真机上盯着发愣才发现。
             */
            try {
                this.renderPage(page.id, body);
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                console.error(`[ReelLudic] 设置页「${page.label}」渲染失败：`, err);
                body.empty();
                const fail = body.createDiv({ cls: 'rl-set-pagefail' });
                fail.createDiv({ cls: 'rl-set-pagefail-title', text: `「${page.label}」这一页没能渲染出来` });
                fail.createDiv({
                    cls: 'rl-set-pagefail-desc',
                    text: '多半是这台设备缺少桌面端才有的能力（例如本地转写、文件系统访问）。其它页不受影响。',
                });
                fail.createDiv({ cls: 'rl-set-pagefail-detail', text: detail });
            }
            this.pageEls.set(page.id, el);
        }

        this.setActivePage(this.activePage);

        // 🔴🔴 2026-11-07 修用户报障「搜索配置页 hover 没有任何提示」：
        //    这一版 Obsidian 把设置页开在**独立窗口**，它有**自己的 document**；
        //    而全局 tooltip 原来只绑了主窗口的 document（`const doc = document`），
        //    独立窗口里的 mouseover 压根到不了那套监听 ⇒ 整页 `data-tip` 全是哑的。
        //    ⇒ 在这里把**本页所在的那部 document** 登记进 tooltip（幂等，切 Tab 重复调无副作用）。
        //    ⚠️ 用 `containerEl.ownerDocument` 而不是全局 `document`/`activeDocument`：
        //      前者是这部容器**真实所在**的文档，后者取决于焦点，开设置页时并不保证已切过来。
        //    ⚠️ ⛔ 别把这行删掉换个「看起来更通用」的全局初始化 —— 那等于又只绑主窗口，
        //      而且**不会报错**，只能在真机上盯着 hover 发愣才发现。
        bindTooltipDocument(containerEl.ownerDocument);

        // 🔴 #484 / m09565 ②：把滚动位置还回去（接上面的取值）。
        //    ⚠️ 必须等**布局完成**才能设：`scrollTop` 会被「内容还不够高」悄悄夹到 0
        //    ⇒ 放 `requestAnimationFrame` 里（与首帧补算溢出遮罩同一时机）。
        //    ⚠️ 目标元素是**重建后**重新找出来的滚动祖先，不是旧的 `scrollHost`（那已经被 empty 掉了）。
        if (keepScroll > 0) {
            requestAnimationFrame(() => {
                const host = ReelLudicSettingTab.findScrollHost(containerEl);
                if (host) host.scrollTop = keepScroll;
            });
        }
    }

    /**
     * 找出**真正会滚动**的祖先容器（`display()` 重建前后都要靠它存取 `scrollTop`）。
     *
     * 🔴 为什么不写死 `.rl-set-content`：它的 `overflow-y` 是 `visible`、高度跟着内容长，
     *    `scrollTop` 赋任何值都会被夹回 0（真机实测 ch 1666 / sh 1666）。
     *    实际在滚的是 Obsidian 原生的 `.vertical-tab-content`（ch 490 / sh 1837 / `overflow-y: auto`）。
     *
     * 判据（两条都要满足）：
     *   ① `overflow-y` 是 `auto` 或 `scroll`；
     *   ② `scrollHeight` 比 `clientHeight` 大 **4px 以上**（留容差：亚像素舍入会让两者抖动）。
     * ⚠️ 找不到就返回 `null`（调用方自己判空），⛔ 别退化成「回传 containerEl 反正不报错」。
     */
    private static findScrollHost(from: HTMLElement | null): HTMLElement | null {
        for (let el = from?.parentElement ?? null; el; el = el.parentElement) {
            const oy = getComputedStyle(el).overflowY;
            if (oy !== 'auto' && oy !== 'scroll') continue;
            if (el.scrollHeight > el.clientHeight + 4) return el;
        }
        return null;
    }

    /** 按页 id 分发到各页渲染（id 全部来自 `pure/settingNav` 的常量） */
    private renderPage(id: string, body: HTMLElement): void {
        if (id === 'basic') this.renderBasicPage(body);
        else if (id === 'sources') this.renderSourcePage(body);
        else if (id === 'immersive') this.renderImmersivePage(body);
        else if (id === 'ai') this.renderAiPage(body);
        else if (id === 'advanced') this.renderAdvancedPage(body);
        else this.renderAboutPage(body);
    }

    /**
     * 「沉浸体验」页（2026-11-06，用户逐字：「基本设置-实验性功能组和高级设置-ASR和TTS组
     * 全部移动到新开插件页签【沉浸体验】放在搜索配置和AI集成中间」）。
     *
     * 🔴 **两组的语义**（就是用户给的示意图）：
     *    · **【媒体载体】** —— 这个插件能不能在你眼前「播」：内置阅读器 / 视频播放器 / 音乐播放器
     *      三个总开关（原「基本设置 › 实验性功能」，连它的折叠子面板一起搬来）。
     *    · **【语音服务】** —— 声音与文字的互转：🎙️ 语音转文字（STT，原「高级设置 › 音频转文字」）
     *      + 🔊 文字转语音（TTS，原「AI集成 › 用途」卡堆末位的「朗读音源」）。
     *
     * 🔴 **为什么把 STT 与 TTS 并成一组**：它们是同一条链的两头（把片子里的声音变成字、
     *    把字念出来），配置方式也同构（选一个引擎 + 看它是否就绪）。分在两页时，
     *    用户想「让这个插件能听会说」要找两个 Tab —— 那正是本轮要消灭的东西。
     *
     * ⚠️ **「媒体载体」传 `nativeGroup`**（2026-11-07 用户裁定：样式改回基本设置页那版）；
     *    **「语音服务」不传** —— 那组内部是 `.rl-voice-card`（自带边框底色的独立卡），
     *    再套一层核心原生分组卡就是「卡中卡」。⛔ 两者别写成一样的。
     * ⚠️ 页内**不设页标题**（页名只由 Tab 承载）—— 与其余各页同口径。
     */
    private renderImmersivePage(parent: HTMLElement): void {
        // 🔴 2026-11-07 用户裁定（本轮第④条）：「播放阅读的媒体载体组样式改回基本设置页那版」
        //    ⇒ 「媒体载体」补上第 4 参 `true`，借核心原生的 `.setting-group` + `.setting-items`
        //      （组 = 一张卡、行平铺、行间发丝线），与「外观与体验」「数据与备份」同源同值。
        //    ⚠️ 这里**原本刻意不传**（见下条注释的历史口径「本页两组都不传」）—— 那是把
        //      「组内各有自己的卡片」当成前提。实际从基本设置页搬过来时，「媒体载体」的三行是
        //      `makeCollapsible` 生成的**裸 `.setting-item`**（子面板挂在行后面，不是组内独立卡），
        //      套原生分组卡**不会**变成卡中卡，反而正是它在基本设置页时的原样。
        //    ⛔ 别把这条参数删回 `false`：用户点名要的就是那个观感。
        //    ⚠️「语音服务」**仍不传**：那组内部是 `.rl-voice-card`（自带边框/底色的独立卡），
        //      再套一层原生分组卡才是真的卡中卡。
        this.createGroupSection(parent, '媒体载体', (body) => this.renderExperimentalRows(body as HTMLDivElement), true);
        // 🔴 语音服务：STT 在上（它是"重"配置、且要自检环境），TTS 在下（一次选完就不碰）。
        //    ⚠️ 顺序是用户示意图给的：【语音服务】里先「语音转文字 STT」再「文字转语音 TTS」。
        // 🔴 2026-11-07 用户裁定（本轮第⑥条）：「语音转文字、文字转语音图标去掉」
        //       ⇒ 标题**只留文字**，⛔ 别再给它们加 emoji / 图标。
        //       （那条裁定针对的是当时 `.rl-voice-sec-title` 里的 emoji；现在标题改由组承载，
        //        组的图标走 `SETTING_GROUP_ICONS`，与这条裁定不冲突。）
        // 🔴🔴 2026-11-10 用户逐字（m03321）：「将设置页语音服务组下两个项语音转文字、文字转语音
        //    移出来为单独组」⇒ 原来的「语音服务」一个大组**整体退场**，里面两个小节升格成
        //    **两个平级组**；用户 m03346 追加裁定「词典另外开一个独立分组」⇒ 再加第三组。
        //    最终组序：**语音转文字 → 文字转语音 → 字幕面板学习模式**。
        //    ⚠️ 为什么是「独立组」而不是原来那种「组内小节」：用户在设置页左侧导航里
        //      直接按组名跳转，小节名进不了导航 ⇒ STT/TTS 永远得先找大组再找小节。
        //    ⛔ 旧组名 `语音服务` 已从 `SETTING_GROUP_ICONS` 删除，别再建回来（图标会静默丢失）。
        //    ⚠️ 组名必须与 `pure/settingNav.SETTING_GROUP_ICONS` 的键**逐字一致**。
        //    ⚠️ 组内卡片走 `mountVoiceCard` 的 `.rl-voice-card.is-bare`（**不画边框/底色**）：
        //      组本身已经给了外框，卡再画一层就是卡中卡。旧的小节标题样式 `.rl-voice-sec*`
        //      已随 `renderVoiceSection` 一起删除，⛔ 别再把那层壳建回来。
        this.createGroupSection(parent, '语音转文字', (body) => {
            // 🔴 2026-11-11 用户 m09233：删掉组内那句「把音视频里的声音识别成字幕，全部在本机完成」——
            //    ⇒ 传空串（`mountVoiceCard` 内部 `if (desc)` 会跳过建节点）。
            this.mountVoiceCard(body as HTMLDivElement, '', (card, redraw) => this.renderAsrEngineRows(card, redraw));
        });
        this.createGroupSection(parent, '文字转语音', (body) => {
            // 同上：说明文字一并退场，用户要的是「同语音转文字一样」的左导航 + 右面板，不要标题下再挂一句话。
            this.mountVoiceCard(body as HTMLDivElement, '', (card, redraw) => this.renderTtsVoiceRows(card, redraw));
        });
        // 🔴 用户 m03321：「字典文件配置项放新增字幕面板学习模式下（放在文字转语音项下）」
        //    ⇒ 词典那行从「语音转文字 › 偏好与词典」整段搬到这里，单独成组、紧跟 TTS。
        this.createGroupSection(parent, '字幕面板学习模式', (body) => {
            this.renderDictRows(body as HTMLDivElement);
        });
    }

    /**
     * 组内挂一张「语音卡」：一句说明 + 卡体，卡体**不自带边框**（`.is-bare`）。
     *
     * 🔴 为什么从 `renderVoiceSection` 改成这个形态：小节升格为**组**之后，组卡
     *    （`.rl-svc-group` / 原生 `.setting-group`）已经提供了外框与底色，
     *    卡再自带一层 border + background 就是**卡中卡**（踩过：视觉上多出两条平行边框）。
     *    ⇒ 组内这一层只负责「一个可重画的容器」，边框交给组。
     *
     * 🔴 `fill` 收到第二个参数 `redraw`：卡内出现「装完之后状态要变」的场景（一键装好别的引擎）时，
     *    调用它即可**只重画这张卡**，⛔ 不要整页 `display()` —— 那会把滚动位置跳回顶部，
     *    用户反而看不到「已就绪」。
     *    ⚠️ 重画方式是「清空卡 + 重跑 fill」，所以 fill 必须是幂等的（只往传入的容器里建节点，
     *      自己不清空、不复用外部状态）—— 本页两处 fill 都满足。
     */
    private mountVoiceCard(
        host: HTMLDivElement,
        desc: string,
        fill: (card: HTMLDivElement, redraw: () => void) => void,
    ): void {
        if (desc) host.createDiv({ cls: 'rl-voice-group-desc', text: desc });
        const card = host.createDiv({ cls: 'rl-voice-card is-bare' });
        // ⚠️ 每次重画都新建一个闭包（不是复用同一个 `card` 变量）：
        //    卡是**原地复用**的，只清它的子节点，⛔ 不换 DOM 节点 —— 换节点会让宿主里的滚动锚点丢失。
        const redraw = (): void => {
            // 🔴 **先记住哪些折叠块是展开的**，重画后再还原。
            //    不记的后果很具体：用户展开某个折叠块 → 点一键装好 → 装成功 ⇒ 卡被重画，
            //    而折叠块的自动展开条件往往是「缺程序或缺模型」，**装成功后该条件恰好变假**
            //    ⇒ 折叠块反而合上，用户看不到刚装好的结果。这跟不刷新一样糟。
            const opened = rememberOpenFolds(card);
            card.empty();
            fill(card, redraw);
            restoreOpenFolds(card, opened);
        };
        fill(card, redraw);
    }

    /**
     * 「字幕面板学习模式」组：本地词典文件那一行。
     *
     * 🔴 用户 2026-11-10（m03321 + m03346）：这行原来在「语音转文字 › 偏好与词典」里，
     *    与「识别语言 / 识别线程数 / 模型下载目录」并排；那三项已按用户裁定**全部删除**，
     *    只剩词典这一项，且它服务的是**学习模式悬停查词**、与转写是两件独立的事
     *    ⇒ 单独成组，放在「文字转语音」之后（用户点名的位置）。
     *
     * ⚠️ 提交时机与其余路径类设置**同一口径**：失焦 / 回车才落库，⛔ 不在 `onChange` 里
     *    每敲一个字符存一次（那会把半截路径写进配置）。
     */
    private renderDictRows(host: HTMLDivElement): void {
        const s = this.plugin.settings;
        let touched = false;
        const row = new Setting(host).setName('本地词典文件').setDesc(DICT_PATH_DESC);
        row.addText((text) => {
            text.setPlaceholder('ECDICT.csv 的完整路径（留空 = 不查词）').setValue(s.dictPath ?? '');
            text.inputEl.addEventListener('input', () => {
                touched = true;
            });
            const commit = async (): Promise<void> => {
                if (!touched) return;
                touched = false;
                s.dictPath = text.getValue().trim();
                await this.plugin.saveSettings();
                text.setValue(s.dictPath ?? '');
            };
            text.inputEl.addEventListener('blur', () => void commit());
            text.inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    void commit();
                }
            });
        });
        row.addButton((b) => {
            b.setButtonText('浏览');
            b.buttonEl.addClass('rl-dir-browse');
            b.onClick(() => {
                // ⚠️ 不限制扩展名：用户自己整理的词表常常是 .txt / .tsv，限制成 csv 会让他们选不中
                void this.plugin
                    .pickSystemFilePath(['csv', 'txt', 'tsv', ''], '词典文件')
                    .then((picked) => {
                        if (!picked) return;
                        s.dictPath = picked;
                        void this.plugin.saveSettings().then(() => this.display());
                    });
            });
        });
    }

    /**
     * 「高级设置」页（1.3.1 ①，2026-10-12）：**5 组**（组序见方法内注释）。
     *   · 分类视图 —— 首页切换条上有哪几颗胶囊（2026-11-26 提到第一组）
     *   · 条目属性 —— 编辑弹窗里显示哪些属性块、什么顺序、多宽
     *   · 字段映射 —— 把插件写出的 frontmatter 键名改成用户习惯的名字（**读写闭环**）
     *   · 笔记属性顺序 —— 决定 frontmatter 的写出顺序
     *   · 卡片信息栏 —— 决定卡片（卡片网格 / 海报墙）上显示哪几行属性
     * 🔴 页内**不设页标题**（页名只由 Tab 承载）—— 与其余 4 页同口径。
     * ⚠️ 第二组原名「海报墙卡片」，#624 随视图改名一并改成「**卡片信息栏**」——
     *    它配的本来就是「卡片上那几行」，而「海报墙」现在指的是**另一个视图**（纯封面那档）。
     */
    private renderAdvancedPage(parent: HTMLElement): void {
        // 🔴 2026-11-26 用户逐字：「高级设置-分类视图加图标把移动到第一顺位」
        //    ⇒ 「分类视图」提到**第一组**（原在末尾）。理由：用户改视图的频率远高于字段映射，
        //      每次都要滚到页尾才找得到。⛔ 别再按「语义递进」把它挪回末尾。
        //      （图标见 `pure/settingNav.ts` 的 `SETTING_GROUP_ICONS.分类视图`。）
        this.createGroupSection(parent, '分类视图', (body) => void this.renderMediaViewsRows(body));
        // 🔴 2026-11-14 用户逐字：「高级设置-条目属性分组**移到『字段映射』组上面**」
        //    ⇒ 「条目属性」从**页尾**提到「字段映射」之前。⛔ 别再按「语义递进」把它挪回末尾。
        //    组序现为：分类视图 → 条目属性 → 字段映射 → 笔记属性顺序 → 卡片信息栏。
        //    （图标见 `pure/settingNav.ts` 的 `SETTING_GROUP_ICONS.条目属性`。）
        // 🔴🔴 1.5.1（用户 2026-11-27）：「高级设置里增加个自由删减各类型条目属性展示的面板，
        //    然后可以预览拖动调整剩下的属性的编辑属性窗口」
        this.createGroupSection(parent, '条目属性', (body) => {
            this.entryFormGroupEl = body;
            this.renderEntryFormRows(body);
        });
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
        // 🔴🔴 2026-11-06 用户逐字：「…和高级设置-ASR和TTS组全部移动到新开插件页签【沉浸体验】」⇒
        //    「音频转文字」组**已整体搬走**，与「朗读音源」合并成新页里的「语音服务」组
        //    （见 `renderImmersivePage`）。⛔ 别搬回来：
        //    ⑴ 同一功能只留一个入口（本仓 #669 立的铁律）—— 两处都留，用户会以为哪一处是坏掉的备份；
        //    ⑵ STT 与 TTS 是同一条链的两头，分在两页正是本轮要消灭的「找一个开关要翻两个 Tab」。
        //    ⚠️ `renderAsrEngineRows` 本体一字未改（三张 `.rl-prov-card` 引擎卡 + 环境自检 + 一键安装全在），
        //       只是换了挂载点。
    }

    /**
     * 「分类视图」组（用户 2026-11-23 裁定）。
     *
     * 🔴 **物本位 → 事本位**：用户原话「我更希望这个软件支持**自定义分类维度**：
     *    顶层『默认视图』（物理归档库）+ 用户自建顶栏视图（如『工作』『日常』），
     *    自定义视图内部再自由添加二级分类」。
     * ⚠️ **物理目录结构一字不动**：视图是**纯筛选器**（按标签命中），
     *    ⛔ 别在这里或别处去改用户的文件夹结构 —— 那是不可逆的操作，用户没要。
     *
     * 🔴 默认视图（`id === DEFAULT_VIEW_ID`）：**不可删 / 不可改名 / 不可换种类**（只读一行），
     *    其余每一行都能改名、换种类、配类型与标签、删除。归一器（`normalizeViews`）在数据层
     *    同样强制这三条 ⇒ 这里少做一步也不会把库写坏，但 UI 上禁掉能少一次误解。
     */

    private async renderMediaViewsRows(parent: HTMLElement): Promise<void> {
        const wrap = parent.createDiv({ cls: 'rl-views-admin' });
        const intro = wrap.createDiv({ cls: 'rl-views-intro' });
        // 🔴 2026-11-25 用户逐字给的文案，⛔ 别改写、别合并、别加感叹号
        intro.createEl('div', {
            text: '视图仅作“筛选器”，不会移动或复制你的文件。',
        });
        // 模板里的**第一条**分割线：说明文字 与 视图列表 之间
        wrap.createDiv({ cls: 'rl-views-sep', attr: { role: 'separator' } });

        const listEl = wrap.createDiv({ cls: 'rl-views-list' });
        /**
         * 🔴 用户 2026-11-25 模板里那条**固定的第二条**分割线：
         *    「（可勾选隐藏）合集视图 [系统内置] / 按系列/IP 聚合你的媒体。
         *      --- (分割线)
         *      **[ + 新建自定义视图 ]**」
         *    ⇒ 它分隔的是「已有视图」与「新建入口」，**与有没有自定义视图无关** ——
         *      所以它建在 `listEl` 外面、`addBar` 之前，⛔ 别塞进行区里（行区会被 `empty()` 清掉，
         *      而且行区那条分隔只在内置/自定义之间，是另一条线）。
         */
        wrap.createDiv({ cls: 'rl-views-sep', attr: { role: 'separator' } });
        const addBar = wrap.createDiv({ cls: 'rl-views-add' });
        // 🔴 用户 2026-11-25：「**[ + 新建自定义视图 ]** _(做成一个普通的按钮)_」
        //    ⇒ 普通按钮（`rl-btn`），⛔ 不再用 `mod-cta` 那种实心强调按钮抢注意力。
        const addBtn = addBar.createEl('button', {
            cls: 'rl-btn',
            text: '+ 新建自定义视图',
            attr: { type: 'button' },
        });
        const addHint = addBar.createSpan({ cls: 'rl-view-row-hint' });

        /** 只重画行区（骨架 build 一次，行区随数据重画） */
        const rerender = (): void => {
            void (async () => {
                let views: MediaView[] = [];
                try {
                    views = await this.plugin.service.views();
                } catch {
                    listEl.empty();
                    listEl.createDiv({ cls: 'rl-views-empty', text: '读取视图失败，请稍后重试。' });
                    return;
                }
                listEl.empty();
                this.renderMediaViewsRowList(listEl, views, commit);
                const full = views.length >= MAX_VIEWS;
                addBtn.disabled = full;
                addHint.setText(full ? `最多 ${MAX_VIEWS} 个视图` : '');
            })();
        };

        /**
         * 落盘 + **只重画行区**（唯一写出口走宿主 `setMediaViews` ⇒ 归一在那里做一次）。
         *
         * 🔴🔴 2026-11-24 用户报障（逐字）：「加个归属标签（自定义视图）这个**每点击一下就刷新重载**啊」。
         *    真因 = 这里原来调的是 `this.display()` —— 那是**整页重建**：每点一次类型标签 / 改一次名字，
         *    整个设置页（含左侧导航、其余所有分组）全部销毁重画 ⇒ 页面闪一下、滚动位置回顶部、焦点丢失。
         *    而视图配置恰是**高频连点**的操作（勾类型 / 敲标签），体感就是「点了就重载」。
         *    ⇒ 改成只重画 `.rl-views-list` 的行。
         *    ⚠️ 失败分支也必须**重画回去**：否则一次失败会留下一片空白，用户连现有视图都看不到。
         */
        /**
         * 🔴🔴 2026-11-08（用户 m05024 报障）：「我在设置里勾选了漫画、电影，怎么在首页视图上还显示
         *    其他类型的分类」。
         *
         * 真根因**不在页签过滤**（`pure/homeTabs.visibleTabs` 已用探针验过是对的），而在**这里**：
         *    原来 `commit(next: MediaView[])` 收的是一份**整数组快照** —— 每个行内控件的闭包都握着
         *    自己渲染那一刻的 `views`。而 `setMediaViews` 是异步写盘、写完才 `rerender()`：
         *      · 用户连点两个类型 chip（间隔 < 一次写盘）⇒ 第二下拿的还是旧数组，
         *        把第一下刚加的项**整条覆盖掉**；
         *      · 真实库证据：`catalog.json` 里 `types` 只剩 `["anime","book"]` —— 用户点的 movie 丢了。
         *    ⇒ 改成**补丁函数**：每次落盘前现读一遍最新视图再应用补丁（read-modify-write）。
         *    ⚠️ ⛔ 别再退回「传整数组」：只要有两枚控件能在同一次重画生命周期内被连点，就会互相覆盖。
         */
        function commit(patch: (cur: MediaView[]) => MediaView[]): void {
            void (async () => {
                let cur: MediaView[] = [];
                try {
                    cur = await thisPlugin.service.views();
                } catch {
                    new Notice('读取视图失败，未能保存。');
                    rerender();
                    return;
                }
                thisPlugin.setMediaViews(patch(cur)).then(
                    () => rerender(),
                    (e: unknown) => {
                        new Notice('视图保存失败：' + (e instanceof Error ? e.message : String(e)));
                        rerender();
                    },
                );
            })();
        }
        const thisPlugin = this.plugin;

        addBtn.addEventListener('click', () => {
            // 上限判据也放进补丁里现读：`addBtn.disabled` 只有等到下一次 rerender 才会更新，
            // 连点两下仍有窗口期能超建一条（补丁式 commit 让这道判断和写入是同一次读）。
            commit((cur) =>
                cur.length >= MAX_VIEWS
                    ? cur
                    : [...cur, createView('custom', '新视图', nextViewId(cur.map((v) => v.id)))],
            );
        });

        rerender();
        await Promise.resolve();
    }

    /**
     * 「分类视图」行区渲染（骨架由 `renderMediaViewsRows` 建一次，本函数只画行）。
     *
     * 🔴 拆出来只为「局部重画」（2026-11-24 用户报障「每点击一下就刷新重载」）：
     *    `commit()` 之后只调本函数重画行，⛔ 不许再 `this.display()` 整页重建。
     * ⚠️ 调用方负责 `listEl.empty()`；本函数**不碰** intro / 导航 / 新增按钮。
     */
    private renderMediaViewsRowList(
        listEl: HTMLElement,
        views: MediaView[],
        commit: (patch: (cur: MediaView[]) => MediaView[]) => void,
    ): void {
        /**
         * 🔴 2026-11-25 用户给的模板（逐字）：
         *    「视图仅作"筛选器"，不会移动或复制你的文件。
         *      --- (分割线)
         *      （可勾选隐藏）**默认视图** `[系统内置]` / 物理归档库，收录所有媒体笔记。
         *      （可勾选隐藏）**合集视图** `[系统内置]` / 按系列/IP 聚合你的媒体。
         *      --- (分割线)
         *      **[ + 新建自定义视图 ]**」
         *    ⇒ 行结构 = 勾选框 + 名字 + `[系统内置]` 标记 + 一句说明；
         *      内置两条与自定义之间有一条分割线（自定义视图是「用户的东西」，视觉上要和内置分开）。
         * ⚠️ 分割线**只在内置与自定义之间插一次**，⛔ 别每行都插（那就成了表格线，不是分组）。
         */
        const builtinViews = views.filter((v) => isBuiltinView(v));
        const customViews = views.filter((v) => !isBuiltinView(v));

        for (const v of builtinViews) this.renderOneViewRow(listEl, v, commit, true);

        if (customViews.length > 0) {
            // 内置 / 自定义 两组之间的那条线（模板里两行内置视图与「+ 新建」之间另有一条固定的，
            // 那条建在行区外面，见 `renderMediaViewsRows`）
            listEl.createDiv({ cls: 'rl-views-sep', attr: { role: 'separator' } });
            for (const v of customViews) this.renderOneViewRow(listEl, v, commit, false);
        }
    }

    /**
     * 画一行视图配置。
     *
     * 🔴 内置行（`builtin === true`）：勾选框 + 只读名字 + `[系统内置]` + 说明 + 类型/标签**只读**
     *    —— 名字/种类/类型/标签都会被归一器按常量重造（见 `pure/mediaViews`），放开改只会「改了没反应」。
     *    ✅ 但**勾选框是能用的**：用户 2026-11-25 明确要求内置视图也可勾选隐藏。
     * ⚠️ 勾选框语义统一为「在首页显示」：勾 = 显示（`hidden` 缺省），不勾 = 隐藏（`hidden: true`）。
     *    用「显示」而不是「隐藏」做正向语义：勾选框表达「现在首页有哪些」，比反向的「隐藏」少绕一层。
     * 🔴 出厂态（2026-11-14 用户逐字：「分类视图，用户初始**仅勾选默认视图**，不再勾选合集视图」）：
     *    **默认视图勾上、合集视图不勾** —— 见 `pure/mediaViews` 的 `builtinViewHiddenByDefault`。
     *    ⛔ 别再按 2026-11-25 那句「默认全是勾上的」改回来：首页只有在**勾了 ≥2 个视图**时才出下拉框
     *    （见 `ViewChips.svelte`），出厂就把两条都勾上等于让新用户第一次开机就看见一个用不上的切换器。
     */
    private renderOneViewRow(
        listEl: HTMLElement,
        v: MediaView,
        commit: (patch: (cur: MediaView[]) => MediaView[]) => void,
        builtin: boolean,
    ): void {
        const isDefault = v.id === DEFAULT_VIEW_ID;
        const card = listEl.createDiv({ cls: 'rl-view-row' });
        if (builtin) card.addClass('is-default');

        // ── 头顶行：勾选框 + 名字 + [系统内置] + （非内置的删除按钮）──
        const head = card.createDiv({ cls: 'rl-view-row-head' });

        /**
         * 红色拦截提示（挂在头顶行**下面**：`card` 此刻只有 `head` 一个子元素，
         * 所以这里追加出来的节点天然排在它之后）。
         * 默认 `is-hidden` 收起，只在拦截时露出来。
         */
        const warn = card.createDiv({
            cls: 'rl-view-row-warn is-hidden',
            attr: { role: 'alert' },
        });
        let warnTimer: number | null = null;
        const flashShowWarn = (text: string): void => {
            warn.setText(text);
            warn.removeClass('is-hidden');
            if (warnTimer !== null) window.clearTimeout(warnTimer);
            warnTimer = window.setTimeout(() => {
                warn.addClass('is-hidden');
                warnTimer = null;
            }, 5000);
        };

        const cbWrap = head.createEl('label', { cls: 'rl-view-row-show' });
        const cb = cbWrap.createEl('input', {
            attr: { type: 'checkbox', 'aria-label': `在首页显示「${v.name}」` },
        }) as HTMLInputElement;
        cb.checked = v.hidden !== true;
        /**
         * 🔴🔴 2026-11-15 用户 m05159 问题一（逐字）：
         *    「「高级设置-分类视图」不允许全部取消勾选。仅剩最后一个勾选项时再取消，
         *      应拦截并显示红色提示；拦截后该项保持勾选，不能出现全部未勾选状态。」
         *
         * 判据在 change 里**现读**一遍视图表再算（与 `commit` 同一套 read-modify-write 口径）：
         * ⛔ 别用渲染那一刻闭包里的 `v` / 视图快照 —— 连点两枚勾选框时，第二下拿的还是旧数组，
         *    会把第一下刚取消掉的那条又算成「还勾着」，于是两条一起被取消 ⇒ 恰好破掉这条约束。
         *
         * 三种出口：
         *   勾上     ⇒ 恒放行（只会让可见数变多）。
         *   取消且仍有别的可见项 ⇒ 放行。
         *   取消但本条是最后一条可见项 ⇒ **把勾选框打回勾上**并闪红提示（不写盘）。
         */
        cb.addEventListener('change', () => {
            if (cb.checked) {
                commit((cur) => cur.map((x) => (x.id === v.id ? { ...x, hidden: false } : x)));
                return;
            }
            void (async () => {
                let cur: MediaView[] = [];
                try {
                    cur = await this.plugin.service.views();
                } catch {
                    // 读不到就**不许放行**：放行等于「可能全不勾」，宁可按未生效处理
                    cb.checked = true;
                    flashShowWarn('读取视图失败，这次取消没有生效。');
                    return;
                }
                const others = cur.filter((x) => x.id !== v.id && x.hidden !== true).length;
                if (others <= 0) {
                    cb.checked = true;
                    flashShowWarn('至少要保留一个视图在首页显示。想换成别的视图，请先勾上它，再取消这一条。');
                    return;
                }
                commit((c) => c.map((x) => (x.id === v.id ? { ...x, hidden: true } : x)));
            })();
        });
        cbWrap.createSpan({ cls: 'rl-view-row-showtxt', text: '显示' });

        safeSetIcon(head.createSpan({ cls: 'rl-view-row-icon' }), viewIconOf(v));

        // ── 名字：内置视图只读，其余可改 ──
        if (builtin) {
            head.createSpan({ cls: 'rl-view-row-name', text: v.name });
            // 🔴 用户模板里的字面标记 `[系统内置]`
            head.createSpan({ cls: 'rl-view-row-badge', text: '[系统内置]' });
        } else {
            const nameIn = head.createEl('input', {
                cls: 'rl-input rl-view-row-namein',
                attr: { type: 'text', value: v.name, 'aria-label': '视图名称' },
            });
            nameIn.value = v.name;
            // ⚠️ 用 change 不是 input：每次按键都落盘会把磁盘写满
            nameIn.addEventListener('change', () => {
                const name = nameIn.value.trim();
                if (!name) {
                    nameIn.value = v.name;
                    return;
                }
                commit((cur) => cur.map((x) => (x.id === v.id ? { ...x, name } : x)));
            });

            // 🔴 2026-11-08（用户 m04478「自定义视图项怎么有个切换合集视图和该自定义视图的下拉框删除掉这没用」）：
            //    这里原本有一枚「视图种类」下拉（collection / custom）。它退场的原因不是字段无用，
            //    而是**用户没有第二种合理选择**：合集看板只由系统内置的「合集视图」提供，
            //    新建视图的入口恒为 `createView('custom', …)`（本文件里就这一处）⇒ 下拉的另一个选项
            //    永远是「把一个自建视图改成看板形态」。留着它只会让自建视图被点成看板后卡在那，
            //    且「自定义视图按标签过滤」这条语义对该视图当场失效（`pure/mediaViews` 的 `viewMatchesEntry`）。
            //    ⇒ 归一器把自建视图的 kind 钉成 `'custom'`（见 `pure/mediaViews` 的 `normalizeViews`），
            //      这里不再提供入口。⛔ 别按「一个字段没人填了就当它死了」把 `kind` 从数据模型里删掉：
            //      内置两枚视图（默认 / 合集）仍然靠它区分，`viewIconOf` / `viewMatchesEntry` 也还在读。

            const del = head.createEl('button', {
                cls: 'clickable-icon rl-view-row-del',
                // 🔴 2026-11-08 修双提示：原来这里同时挂 `aria-label` 与 `data-tip`，
                //    Obsidian 会给带 `aria-label` 的悬停目标自绘官方气泡，与本插件的 `data-tip`
                //    气泡叠成两层（UI-GUIDE §3 v3）。读屏名改走 `.rl-sr` 隐藏 span。
                attr: { 'data-tip': '删除视图（不动任何文件）' },
            });
            del.createSpan({ cls: 'rl-sr', text: `删除视图「${v.name}」` });
            safeSetIcon(del, 'trash-2');
            del.addEventListener('click', () => {
                void (async () => {
                    const ok = await new ConfirmModal(
                        this.app,
                        `删除视图「${v.name}」？\n\n只会删掉这条分类设置，条目与文件都不会动。`,
                        '删除视图',
                    ).open();
                    if (!ok) return;
                    commit((cur) => cur.filter((x) => x.id !== v.id));
                })();
            });
        }

        // ── 一句说明（真源在 pure/mediaViews，⛔ 别在这里手抄）──
        card.createDiv({ cls: 'rl-view-row-desc', text: VIEW_KIND_DESCS[v.kind] });

        // ── 类型白名单（哪几种媒体进这个视图；全不勾 = 不限制）──
        // ⚠️ 内置视图不给改：默认视图必须吃全量，合集视图的 types 也被归一器重造
        if (!builtin) {
            const typesRow = card.createDiv({ cls: 'rl-view-row-types' });
            typesRow.createSpan({ cls: 'rl-view-row-label', text: '媒体类型' });
            /**
             * 🔴 2026-11-26（m05012）用户逐字：「高级设置的选择类型扩充到九类」
             *    「用户自定义视图可选择现有的文学网文漫画动画剧集电影游戏音乐可选展示」
             * ⇒ 这里**不再**遍历 `ENTRY_TYPES`（那只有 6 个主类型，书籍只能整块勾），
             *   改遍历 `VIEW_TYPE_CHOICES`（八项：文学/网文/漫画/动画/剧集/电影/游戏/音乐）。
             * ⚠️ 勾选态与写回都走 `viewSelectionOf` / `viewSelectionPatch` 这对逆运算：
             *   `types` 与 `bookKinds` 是**两维**，分别提交必然互相踩（本仓踩过硬删字段的坑）。
             */
            const picked = new Set(viewSelectionOf(v));
            for (const c of VIEW_TYPE_CHOICES) {
                const on = picked.has(c.key);
                const chip = typesRow.createEl('button', {
                    cls: 'rl-view-type-chip' + (on ? ' is-on' : ''),
                    text: c.label,
                    attr: { type: 'button', 'aria-pressed': on ? 'true' : 'false' },
                });
                /**
                 * 🔴🔴 2026-11-08（用户 m05024 报障「勾了漫画、电影，首页还显示其他类型」）：
                 *    这里原来闭包吃的是渲染那一刻的 `picked` 与 `on` 两个**快照**：
                 *        const next = new Set(picked);  if (on) next.delete(c.key);  else next.add(c.key);
                 *    ⇒ 连点两枚 chip 时，第二下仍从旧 `picked` 重算 ⇒ 把第一下刚勾的项覆盖掉。
                 *    真实库证据：`catalog.json` 里 `types` 只剩 `["anime","book"]`（用户点的 movie 丢了）。
                 *    ⇒ 改成**现算**：补丁函数里用当前最新视图重新求勾选态，再翻转这一枚。
                 *    ⚠️ ⛔ 别把 `on` 当省事缓存：它只配用来画初始 `is-on`/`aria-pressed`，不配参与写回。
                 */
                chip.addEventListener('click', () => {
                    commit((cur) =>
                        cur.map((x) => {
                            if (x.id !== v.id) return x;
                            const now = new Set(viewSelectionOf(x));
                            if (now.has(c.key)) now.delete(c.key);
                            else now.add(c.key);
                            return { ...x, ...viewSelectionPatch([...now]) };
                        }),
                    );
                });
            }
            typesRow.createSpan({ cls: 'rl-view-row-hint', text: '全不勾 = 不限' });
        }

        // ── 标签白名单（自定义视图才需要；命中任一标签即进） ──
        if (v.kind === 'custom') {
            const tagsRow = card.createDiv({ cls: 'rl-view-row-tags' });
            tagsRow.createSpan({ cls: 'rl-view-row-label', text: '按标签收录' });
            const tagsIn = tagsRow.createEl('input', {
                cls: 'rl-input rl-view-row-tagin',
                attr: { type: 'text', placeholder: '多个标签用逗号分隔，如 工作, 项目A', 'aria-label': '按标签收录' },
            });
            tagsIn.value = v.tags.join(', ');
            tagsIn.addEventListener('change', () => {
                const tags = normalizeViewTags(tagsIn.value.split(/[,，]/));
                commit((cur) => cur.map((x) => (x.id === v.id ? { ...x, tags } : x)));
            });
            if (v.tags.length === 0) {
                tagsRow.createSpan({ cls: 'rl-view-row-hint is-warn', text: '还没配标签 ⇒ 这个视图永远是空的' });
            }
        }

        // `isDefault` 目前只在上面判名字只读分支用得到；显式消费避免「声明了没用」的噪音
        void isDefault;
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

        // 🔴 ③-5：说明行改走全局组件 `groupHeader()`（本组只需要说明行，回执槽留空 —— 空槽 CSS 用
        //    `:empty` 收掉，不占高度）。`rl-fo-help` 作为附加语义类保留，避免与断言/历史引用错位。
        groupHeader(body, '拖动调整笔记里属性的排列顺序；只影响之后写入或重写的笔记。', { helpCls: 'rl-fo-help' });

        // 🔴 #653（用户：「再加个对比视图，如一整个表格滑动并览」）：**编辑 / 对比预览**两档切换。
        //    编辑 = 左主右从（一次看一组）；对比 = 一整个表格横向滑动（七组并排、按位次对齐）。
        //    ⚠️ 两个视图共用同一份取数（`orderForType` / `GLOBAL_FIELD_KEYS`），⛔ 别各算一套。
        //
        // 🔴 ③-5：分段条改走全局组件库 `chipBar()`（与「卡片信息栏」「条目属性」两组同一份实现）。
        //    原来这里是**第三份**手写分段条（`rl-fo-modebar` + 两个 `rl-fo-mode` 按钮 + 自己 sync 高亮），
        //    与另两组逐字重复 —— 正是用户说的「同一手势两处（此处三处）实现」。
        //    ⇒ 高亮与 `aria-selected` 交给 `chipBar` 内部 sync（它建完立刻 sync 一次，#659 那条
        //      「首屏不高亮」的坑由组件库兜住，⛔ 不再依赖调用点记得手调）。
        //    本方法只剩「哪档可见」这一件真属于它自己的事（`syncMode`）。
        let mode: 'edit' | 'compare' = 'edit';
        const editHost = body.createDiv({ cls: 'rl-fo-view' });
        const cmpHost = body.createDiv({ cls: 'rl-fo-view' });
        cmpHost.addClass('is-hidden');
        const syncMode = (): void => {
            const isEdit = mode === 'edit';
            editHost.toggleClass('is-hidden', !isEdit);
            cmpHost.toggleClass('is-hidden', isEdit);
            // 切到对比时才重算（横向长表，不必常驻 DOM 陪着编辑视图）
            if (!isEdit) this.renderFieldOrderCompare(cmpHost);
        };
        chipBar({
            parent: body,
            ariaLabel: '属性顺序视图',
            items: [
                { key: 'edit', label: '编辑' },
                { key: 'compare', label: '对比预览' },
            ],
            getKey: () => mode,
            onPick: (next) => {
                mode = next === 'compare' ? 'compare' : 'edit';
                syncMode();
            },
        });
        // 🔴🔴 #659（用户：「怎么不默认高亮『编辑』按钮啊，要切换一下才能正常高亮」）：
        //    上一版只在**点击时**调同步 ⇒ 首屏两个按钮都还没有选中态。
        //    ⚠️ ③-5 之后这条不变量**拆成两半**：
        //      · 「按钮高亮」由 `chipBar` 建完自己 sync（组件库保证，⛔ 调用点不用管）；
        //      · 「哪档可见」仍必须在这里**无条件跑一次** —— 否则首屏两个视图容器都按默认显示，
        //        编辑区与对比区会同时出现在页面上。
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

        /**
         * 🔴🔴 #721：这一页的**隐藏集真源键**（用户「笔记属性配置也可增删，删除后不拉取改属性字段」）。
         *
         * 为什么按「页」存、而不是按类型存一份大表：用户是在**这一页**删的，就该只影响这一页的字段集
         * （全局页删 = 六个类型都不写；网文页删 = 只网文不写）。口径与 `EntryService.hiddenForEntry`
         * 的并集算法一一对应 —— 那边读的正是这三个键。
         */
        const hideTarget = isGlobal ? '__global' : kind ? `k:${kind}` : (type as string);
        /** 生效隐藏集：只留 `baseKeys` 里的（历史残留 / 手改进来的脏键在这里就丢掉，不带到写盘） */
        const readHidden = (): Set<string> =>
            new Set((this.plugin.settings.fieldOrderHidden?.[hideTarget] ?? []).filter((k) => baseKeys.includes(k)));

        /**
         * 落盘隐藏集。**与顺序完全解耦** —— 顺序那份照旧写 `fieldOrder` / `fieldOrderByKind`，
         * 这里只动 `fieldOrderHidden`，⛔ 不要顺手重排（删一个字段不该让别的字段跳位置）。
         * 与缺省（空集）一致时 delete 该键 ⇒ 不落冗余数据（同 `entryFormFieldsByType` 的口径）。
         */
        const commitHidden = async (next: string[]): Promise<void> => {
            const cfg = { ...(this.plugin.settings.fieldOrderHidden ?? {}) };
            if (next.length) cfg[hideTarget] = next;
            else delete cfg[hideTarget];
            this.plugin.settings.fieldOrderHidden = cfg;
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
        /**
         * 🔴 #721：当前隐藏集（每次 render 前重读真源 —— 与 `order` 同一口径，⛔ 不留本地副本）：
         * 列表里只画「没被隐藏」的，被隐藏的进下方的「已隐藏的属性」池。
         */
        let hiddenSet = readHidden();
        /** 正在拖的那一项（`dragstart` 记下、`drop` 取用） */
        let dragKey: string | null = null;
        /**
         * 🔴 2026-10-21：这一页按**哪个类型**的名字显示（`metaFields.labelFor`）。
         * · 全局页 ⇒ `undefined`（一律用缺省名）；
         * · 书籍三子类页 ⇒ `'book'`（子类不改显示名，差异只在**字段集**，见 `BOOK_KIND_EXCLUDED_FIELDS`）；
         * · 其余类型页 ⇒ 该类型（音乐页的 `author` 显示「艺术家」、动画页的 `developer` 显示「制作公司」）。
         */
        const labelType: EntryType | undefined = isGlobal ? undefined : kind ? 'book' : (type as EntryType);

        /**
         * 🔴 #721：被隐藏属性的「池子」是**常驻节点**，⛔ 别在 `render()` 里现建。
         *
         *    第一版把它写在 `render()` 内部（`if (hiddenInPage.length) pane.createDiv(...)`），
         *    于是每渲染一次就往 `pane` 里多塞一个池子、旧的从不移除 —— 真机实测到的症状是
         *    「从池子点回来、列表已经恢复满项，池子却还写着『已隐藏 1 项』」：
         *    那一个残留的旧池子就躺在下面（把原来的项又画了一遍）。
         *    改成常驻 + 每次渲染 `empty()` 后按需 `hidden` 显隐，就没有副本可言了。
         */
        const pool = pane.createDiv({ cls: 'rl-fo-pool' });
        pool.hidden = true;

        const render = (): void => {
            list.empty();
            hiddenSet = readHidden();
            // 🔴 #721：列表只画**没被隐藏**的项 —— 顺序仍是 `order` 的相对次序（隐藏的跳过，不重排）
            const shown = order.filter((k) => !hiddenSet.has(k));
            shown.forEach((key, i) => {
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

                // 🔴 #721：删除（隐藏）入口。结构性键**不挂**这枚按钮 —— 删了笔记会坏。
                if (isHidableFieldKey(key)) {
                    const del = li.createEl('button', {
                        cls: 'rl-fo-del',
                        // 🔴 2026-11-08 修双提示：`aria-label` 与 `data-tip` 同元素 ⇒ 官方气泡 + 自绘气泡叠两层。
                        attr: { 'data-tip': '删除：之后不再写入这条笔记' },
                    });
                    del.createSpan({ cls: 'rl-sr', text: `删除「${label}」：之后不再写入这条笔记` });
                    safeSetIcon(del, 'x');
                    del.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        // 只改隐藏集，**不动顺序** —— 以后想恢复，位置还在原位（这是刻意的）
                        void commitHidden([...hiddenSet, key]).then(() => render());
                    });
                }

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
                    // 🔴 #721：拖拽动的是**可见项之间**的次序 ⇒ 按 `shown` 算位置，再回写完整 `order`
                    //    （隐藏项不参与比较；它们的相对位置由「恢复」时回到原位保证）
                    order = moveInVisibleOrder(order, dragKey, key);
                    void commit(order);
                    render();
                });

                // 键盘等价物：拖拽是纯指针操作，键盘 / 读屏用户否则够不着
                li.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                    ev.preventDefault();
                    const to = ev.key === 'ArrowUp' ? i - 1 : i + 1;
                    if (to < 0 || to >= shown.length) return;
                    order = moveInVisibleOrder(order, key, shown[to]);
                    void commit(order);
                    render();
                    // 重建后焦点会掉 ⇒ 放回**同一项**的新位置（否则连按第二下就没反应）
                    (list.children[to] as HTMLElement | undefined)?.focus();
                });
            });

            // 🔴 #721：被隐藏的属性进这个池子 —— 用户「也可以增删」，所以必须给回得来的路。
            //    ⚠️ 池子里放的是**本页字段集里**被隐藏的项（不是全库），点一下即为「恢复」。
            //    ⚠️ `pool` 是渲染前建好的常驻节点（见上方注释），这里只 `empty()` 重画、按需显隐，
            //       ⛔ 别再 `pane.createDiv({cls:'rl-fo-pool'})` —— 那样每次渲染都会多一个。
            pool.empty();
            const hiddenInPage = order.filter((k) => hiddenSet.has(k));
            pool.hidden = hiddenInPage.length === 0;
            if (hiddenInPage.length) {
                pool.createDiv({
                    cls: 'rl-fo-pool-cap',
                    text: `已隐藏 ${hiddenInPage.length} 项（点一下恢复）`,
                });
                const chips = pool.createDiv({ cls: 'rl-fo-pool-chips' });
                for (const key of hiddenInPage) {
                    const chip = chips.createEl('button', {
                        cls: 'rl-fo-chip',
                        // 🔴 2026-11-08 修双提示：`aria-label` 与 `data-tip` 同元素 ⇒ 官方气泡 + 自绘气泡叠两层。
                        //    这枚 chip 本身有可见文字（下面的 `labelOf`），读屏名不需要再靠 `aria-label`。
                        attr: { 'data-tip': '恢复：重新写入这条笔记' },
                    });
                    chip.createSpan({ text: labelOf(key, labelType) });
                    safeSetIcon(chip.createSpan({ cls: 'rl-fo-chip-plus' }), 'plus');
                    chip.addEventListener('click', () => {
                        void commitHidden([...hiddenSet].filter((k) => k !== key)).then(() => render());
                    });
                }
            }
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
        /**
         * 🔴 ③-5：说明行改走全局组件 `groupHeader()`。
         *    旧写法是 `body.createDiv({ cls: 'rl-fieldmap-help' })` + `body.createDiv({ cls: 'rl-fieldmap-feedback' })`
         *    —— 与另外四组各写一套，正是用户说的「东拼西凑」。
         *    ⚠️ 但这两个类名**不能直接扔**：`rl-fieldmap-help` 还承担「未配置那句折进同一行」
         *    （`display:flex; flex-wrap:wrap`），`rl-fieldmap-feedback` 承担「有错时整块变红告警」
         *    （`is-bad` + `role="alert"`）。⇒ 作为**附加语义类**挂到通用容器上，通用排版仍归 `.rl-ui-help`。
         */
        const HELP_TEXT = '在「新属性名」列填你想要的键名，回车或失焦生效；留空 = 保持原属性名。';
        const { help, feedback } = groupHeader(body, '', {
            helpCls: 'rl-fieldmap-help',
            feedbackCls: 'rl-fieldmap-feedback',
        });

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
        /**
         * 🔴 ③-5 收口（2026-11-14 用户 m03626「彻底消灭视觉上的东拼西凑」）：
         *    这两张表原先在**本方法里手写** `createDiv('rl-fieldmap-headwrap')` + `createEl('table')`
         *    + `innerHTML = '<colgroup>…'`，而凭据表走的是全局组件 `statusTable()` ——
         *    同一个设置页里两套表格建法，正是用户点名的那件事。
         *    ⇒ 拆表这套结构（表头在外 / 表体滚动 / 两张表共用 colgroup）收进 `ui/components.splitTable()`，
         *      本方法只给列宽与类名。DOM 结构与类名逐字不变（视觉零变化，既有断言全部照旧）。
         *    ⚠️ 但这里**仍然不换成 `statusTable()`**：那是 grid 只读表，而本表 42 行都有可编辑
         *      `<input>`，必须靠 `table-layout: fixed` 保证输入框宽度不随内容抖动。
         */
        const split = splitTable(body, {
            widths: COL_WIDTHS,
            headWrapCls: 'rl-fieldmap-headwrap',
            wrapCls: 'rl-fieldmap-wrap',
            tableCls: 'rl-fieldmap-table',
            headCls: 'rl-fieldmap-head',
            bodyCls: 'rl-fieldmap-body',
        });
        const headTable = split.headTable;
        const table = split.bodyTable;
        const hr = split.headRow;
        // ⚠️ 三列表头文字被既有断言钉住（逐字），⛔ 别顺手改词
        for (const h of ['字段', '原属性名', '新属性名']) hr.createEl('th', { text: h });

        // 表体（在 `split.wrap` 里）已经由 `splitTable()` 建好 `<colgroup>`，这里直接用 `split.bodyTable`

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
        // 🔴 ③-5：分段条改走全局组件库 `chipBar()` —— 本组与「条目属性」组原先各手写一份
        //    （`rl-cf-typerow` / `rl-cf-typebar` / `typeBtns` / `syncTypeBar()` 逐字重复），
        //    只差 panel 类名与取 key 的函数。用户原话「彻底消灭视觉上的东拼西凑」正是指这个。
        //    ⚠️ 语义不变：平级枚举、点已选中的那格不重画（防冲掉面板里的滚动位置与展开态）。
        //
        // 🔴 顺序（三条都别改）：
        //    ⑴ 先把默认槽位抬到「当前类型对应的那一格」（电影 → f:movie）——
        //       `chipBar` 建完会**立刻 sync 一次**，槽位没归位就会按旧值高亮，用户看到「条上和下面对不上」；
        //    ⑵ 再建 chips（它往 body 末尾追加，故必须在 panel **之前**建，否则会排到面板下面）；
        //    ⑶ 最后建 panel 并首绘。
        if (!CARD_TYPE_SLOTS.some((e) => e.key === this.cardFieldsSlot)) this.cardFieldsSlot = `f:${this.cardFieldsType}`;
        chipBar({
            parent: body,
            caption: '条目类型',
            items: CARD_TYPE_SLOTS.map((e) => ({ key: e.key, label: e.label })),
            getKey: () => this.cardFieldsSlotKey(),
            onPick: (next) => {
                this.cardFieldsSlot = next;
                this.renderCardFieldsPanel(panelHost.el);
            },
        });
        // 切类型要重画**面板**（预览 + 已选 + 池子）—— 类型条高亮由 `chipBar` 自己 sync
        const panel = body.createDiv({ cls: 'rl-cf-panel' });
        const panelHost = { el: panel };

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

    // ────────────────────────────────────────────────────────────────────────
    // 🔴🔴 1.5.1「条目属性」组（编辑窗口里属性块的显示 / 隐藏 / 先后）
    //
    // 用户（2026-11-27）逐字：「高级设置里增加个自由删减各类型条目属性展示的面板，
    // 然后可以预览拖动调整剩下的属性的编辑属性窗口」。
    //
    // 🔴 与「卡片信息栏」的**关键差别**（⛔ 别把两组当同一种东西抄）：
    //   · 卡片信息栏 —— 海报墙**卡片上**那几行，最多 5 条，只管「显示哪几个」；
    //   · 本组       —— **编辑弹窗里**的属性块，不设上限（那是用户填表的主战场），
    //                   而且**顺序也要管**（拖动预览列表 = 改弹窗里的先后）。
    //   真源在 `pure/entryFormFields`（归一 / 缺省 / 补回全在那儿，⛔ 别在这里另写一套）。
    // ────────────────────────────────────────────────────────────────────────

    /** 当前槽位键（八格；没设过按当前类型算，保证永远有值） */
    private entryFormSlotKey(): string {
        return ENTRY_FORM_SLOTS.some((e) => e.key === this.entryFormSlot) ? this.entryFormSlot : `f:${this.cardFieldsType}`;
    }

    /** 当前槽位对应的条目类型 */
    private entryFormSlotType(): EntryType {
        const e = ENTRY_FORM_SLOTS.find((x) => x.key === this.entryFormSlotKey());
        return e ? e.type : this.cardFieldsType;
    }

    /** 当前槽位对应的书籍子分类（仅 `k:*` 有值） */
    private entryFormSlotKind(): BookKind | null {
        const e = ENTRY_FORM_SLOTS.find((x) => x.key === this.entryFormSlotKey());
        return e && e.kind ? e.kind : null;
    }

    /**
     * 读**当前那一格**的配置（已归一：只留本格适用键、去重、保持用户先后）。
     * 🔴 归一**不回填缺失** —— 缺项就是「用户把这块收起来了」（见 `pure/entryFormFields`）。
     * 🔴 子分类的回落链与 `cardFieldsByKind → cardFieldsByType.book` 同一条：
     *    `entryFormFieldsByKind[kind]` 缺失 ⇒ 回落 `entryFormFieldsByType.book`（零迁移）。
     */
    private currentEntryFormFields(): EntryFormFieldLayout[] {
        const kind = this.entryFormSlotKind();
        const raw = kind
            ? (this.plugin.settings.entryFormFieldsByKind ?? {})[kind]
                ?? (this.plugin.settings.entryFormFieldsByType ?? {}).book
            : (this.plugin.settings.entryFormFieldsByType ?? {})[this.entryFormSlotType()];
        return normalizeEntryFormFields(raw, kind ? 'book' : this.entryFormSlotType(), kind ?? undefined);
    }

    /**
     * 落盘当前那一格。
     *
     * 🔴 **与缺省一致的配置不落盘**（本仓铁律：冗余配置 = 以后改缺省时老用户不动）——
     *   但那句「与缺省一致」对**子分类格**要更严一点：`k:*` 删键后会**回落
     *   `entryFormFieldsByType.book`**，若那一份不是缺省，删了就会显示成另一套 ⇒
     *   只有当「删掉后算出来的结果仍等于要存的这份」才允许删（见下方 `fallback`）。
     */
    private async commitEntryFormFields(entries: EntryFormFieldLayout[]): Promise<void> {
        const kind = this.entryFormSlotKind();
        const type = kind ? 'book' : this.entryFormSlotType();
        const s = this.plugin.settings;
        const byType = { ...(s.entryFormFieldsByType ?? {}) };
        const byKind = { ...(s.entryFormFieldsByKind ?? {}) };
        /**
         * 🔴 面板交上来的**没有固定键**（`meta` 已被 `renderEntryFormPanel` 滤掉，用户看不到也拖不动）。
         *   落库前必须补回去，否则 `isDefaultEntryFormFields` 整份比对永远不相等 ⇒
         *   用户什么都没改也会被写一份自定义配置，且编辑弹窗会因为「配置里缺 meta」而把那一行当未登记。
         */
        const full = withFixedEntryFormFields(entries, type, kind ?? undefined);

        if (kind) {
            // 删键后会拿到什么（= 回落链的结果）—— 判断「删了是否等价」
            const fallback = normalizeEntryFormFields(byType.book, 'book', kind);
            const same = full.length === fallback.length
                && full.every((e, i) => e.key === fallback[i].key && e.span === fallback[i].span);
            if (same) delete byKind[kind];
            else byKind[kind] = full;
        } else if (isDefaultEntryFormFields(full, type, undefined)) {
            delete byType[type];
        } else {
            byType[type] = full;
        }

        s.entryFormFieldsByType = byType;
        s.entryFormFieldsByKind = byKind;
        await this.plugin.saveSettings();
        this.flashEntryFormToast();
        // 编辑弹窗若正开着，刷新能看到结果（与卡片信息栏同口径）
        this.plugin.refreshViews();
    }

    /**
     * 在「条目属性」组标题行右侧挂「已保存」轻提示。
     * ⚠️ 挂**组标题**而不是面板里：面板每次拖完 / 切类型都会 `empty()` 重画（同 `mountCardFieldsToast`）。
     */
    private mountEntryFormToast(): void {
        const group = this.entryFormGroupEl;
        if (!group) return;
        const head = group.querySelector('.rl-svc-group-title');
        if (!head) return;
        if (head.querySelector('.rl-ef-toast')) return;
        const toast = document.createElement('div');
        toast.className = 'rl-ef-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        const icon = document.createElement('span');
        const label = document.createElement('span');
        label.textContent = '已保存';
        toast.appendChild(icon);
        toast.appendChild(label);
        safeSetIcon(icon, 'check');
        head.appendChild(toast);
        this.entryFormToastEl = toast;
    }

    /** 点亮轻提示（单定时器，同 `flashCardFieldsToast`） */
    private flashEntryFormToast(): void {
        const el = this.entryFormToastEl;
        if (!el) return;
        el.addClass('is-on');
        if (this.entryFormToastTimer !== null) window.clearTimeout(this.entryFormToastTimer);
        this.entryFormToastTimer = window.setTimeout(() => {
            el.removeClass('is-on');
            this.entryFormToastTimer = null;
        }, 1500);
    }

    /** 「条目属性」组：类型条 + 面板（结构 / 口径见 `renderEntryFormPanel`） */
    private renderEntryFormRows(body: HTMLElement): void {
        this.mountEntryFormToast();

        // 八格与「卡片信息栏」**逐格对齐**（六类型 + 书籍三子类原地展开）—— 用户在这两组之间来回看时，
        // 位置一致才不会点错。⛔ 别只列六类型、把书籍三子类藏进下拉。
        //
        // 🔴 ③-5：分段条改走全局组件库 `chipBar()`（与「卡片信息栏」组同一份实现）。
        //    原先这里与那一组各手写一份 `rl-cf-typerow` / `rl-cf-typebar` / `typeBtns` / `syncTypeBar()`
        //    （闭包体逐字相同），只差 panel 类名与取 key 的函数 —— 本次收掉。
        // 🔴 顺序同「卡片信息栏」：槽位归位 → 建 chips（往 body 末尾追加，须在 panel 之前）→ 建 panel 首绘。
        if (!ENTRY_FORM_SLOTS.some((e) => e.key === this.entryFormSlot)) {
            this.entryFormSlot = `f:${this.cardFieldsType}`;
        }
        chipBar({
            parent: body,
            caption: '条目类型',
            items: ENTRY_FORM_SLOTS.map((e) => ({
                key: e.key,
                label: e.kind ? BOOK_KIND_LABELS[e.kind] : ENTRY_TYPE_LABELS[e.type],
            })),
            getKey: () => this.entryFormSlotKey(),
            onPick: (next) => {
                this.entryFormSlot = next;
                this.renderEntryFormPanel(panelHost.el);
            },
        });
        const panel = body.createDiv({ cls: 'rl-ef-panel' });
        const panelHost = { el: panel };

        // 「恢复默认」= 八格**全部**回到「全显示 + 模板顺序」（不只是当前格）
        this.mountGroupReset(body, {
            title: '条目属性',
            isCustomized: () =>
                Object.keys(this.plugin.settings.entryFormFieldsByType ?? {}).length > 0
                || Object.keys(this.plugin.settings.entryFormFieldsByKind ?? {}).length > 0,
            message: '将把八个类型（含文学 / 网文 / 漫画）的编辑窗口属性一起恢复成默认：全部显示、按原顺序。',
            apply: async () => {
                this.plugin.settings.entryFormFieldsByType = {};
                this.plugin.settings.entryFormFieldsByKind = {};
                await this.plugin.saveSettings();
                this.plugin.refreshViews();
            },
        });

        this.renderEntryFormPanel(panelHost.el);
    }

    /**
     * 面板：**左 = 编辑窗口预览（可拖动排序，所见即该类型弹窗的先后）**，右 = 已隐藏属性池。
     *
     * 🔴 「预览」在这里不是装饰：左边那一列就是用户点开条目后看到的属性块顺序，
     *    拖动它 = 直接改弹窗（⛔ 别做成「预览只读、另开一个列表去拖」—— 那要多看两处、还容易对不上）。
     * 🔴 锁定块（`ENTRY_FORM_LOCKED_KEYS`：标题 / 封面 / 状态 / 评分 / 评语 / 启动路径）**不进本面板**，
     *    它们由 `pure/entryFormFields` 的锁定表兜住 —— 那些块各自有硬依赖，隐藏会静默坏功能。
     */
    private renderEntryFormPanel(host: HTMLElement): void {
        host.empty();
        const slotType = this.entryFormSlotType();
        const slotKind = this.entryFormSlotKind();
        const allDefsAll = entryFormFieldsFor(slotType, slotKind ?? undefined);
        /**
         * 🔴 2026-11-15 用户 m07047（逐字）：「高级设置-条目属性排序**不要显示第一行了**，
         *   如标题、年份、评分来源都不要显示，都是固定的不能改换顺序」
         *
         *   ⇒ **固定键一个都不画**（`ENTRY_FORM_FIXED_KEYS` = 五个年份键 + `meta`）。
         *      这里直接把它们从 `allDefs` 里滤掉：画布不画、隐藏池没有、计数分母不含。
         *
         *   ⚠️ 本节**推翻**上一轮 m06462 的「灰块占位」方案（当时用户说「固定的不可改变也要
         *      显示预览变灰（不可拖动）按各自调序占位」）—— 两个口径是矛盾的，以新口径为准：
         *      用户现在认为「既然不能改顺序，画出来只会让人以为能拖」。
         *      ⛔ 别把灰块加回来（`styles.css` 里的 `.rl-ef-blk.is-fixed` 也已一并删除）。
         *
         *   ⚠️ 固定键仍留在 `ENTRY_FORM_FIELDS` 里登记着 —— `buildEntryFormPlan` 靠注册表给它
         *      算位次与宽度、`sortEntryFormKeys` 靠 `plan.order` 把它排到第一行。
         *      ⛔ 别顺手从注册表删掉，否则编辑窗里第一行整组会错位。
         *   ⚠️ 落库时固定键由 `commitEntryFormFields` 里的 `withFixedEntryFormFields` 补回，
         *      所以面板上「不画」不代表它不在配置里。
         */
        const allDefs = allDefsAll.filter((d) => !entryFormFieldIsFixed(d.key));

        const wrap = host.createDiv({ cls: 'rl-ef-wrap' });

        // ── 左：编辑窗口镜像（= 可拖动的 6 列栅格）──────────────────────────
        const preview = wrap.createDiv({ cls: 'rl-ef-preview' });
        const pHead = preview.createDiv({ cls: 'rl-ef-prevhead' });
        pHead.createDiv({ cls: 'rl-cf-cap', text: '编辑窗口预览' });
        const counter = pHead.createDiv({ cls: 'rl-cf-counter' });
        /**
         * 🔴🔴 #720（2026-11-07 用户 m03168「编辑属性条目给我结构重构啊参考网站给我 5 版方案」，
         *    选定**方案 D：真弹窗镜像**）—— 把「左边一条竖列表 + 底下一条只读色带」合并成
         *    **一块 6 列栅格**：每个属性块按它的 `span` 真实占位（6 = 整行、3 = 两并排、2 = 三并排），
         *    顺序就是弹窗里的书写顺序 ⇒ **设置页看到的就是编辑窗口**。
         *
         *    为什么废掉旧的两段式（#719 形态）：
         *      ⑴ 列表里每行右侧的「整行 / 1⁄2 / 1⁄3」只能告诉你「当前是几等分」，
         *         **看不出两个并排到底有多宽**，于是底下还得再画一条 `.rl-ef-mirror` 色带补位；
         *      ⑵ 那块色带是**只读装饰** —— 用户在色带上想拖却拖不动，两处长得像却只有一处能操作；
         *      ⑶ 3 个 1⁄3 是否正好凑满一行，得靠读数字心算。
         *    ⇒ 现在**只有这一块**：占位即结果，拖它就是排弹窗，没有第二个需要对照的地方。
         *
         *    ⚠️ 拖拽语义保持「插到目标块的**位置**上」（`moveItem(from, to)`），不改成
         *      「插到目标左侧 / 右侧」—— 后者在跨行换位时会产生两个落点区域、要画插入指示线，
         *      对本面板（最多 11 块）是过度设计。
         *    ⚠️ 块宽随 `span` 变，所以**块内的控件小样改成吃满块宽**（旧版是固定 72px 小样）——
         *      这正是「所见即所得」要表达的信息。
         */
        const canvas = preview.createDiv({ cls: 'rl-ef-canvas' });

        // ── 右：已隐藏属性池 ─────────────────────────────────────────────────
        const picker = wrap.createDiv({ cls: 'rl-ef-picker' });
        picker.createDiv({ cls: 'rl-cf-cap', text: '已隐藏的属性' });
        const chips = picker.createDiv({ cls: 'rl-cf-chips' });
        const emptyTip = picker.createDiv({ cls: 'rl-ef-hint-empty', text: '全部属性都在显示中' });
        picker.createDiv({
            cls: 'rl-cf-hint',
            text: '拖动左侧列表调整编辑窗口的先后；鼠标移到某一块上，右上角会出现一个宽度图标，点它选「整行 / 1⁄2 / 1⁄3 / 1⁄6」（1⁄2 = 两个并排，1⁄3 = 三个并排，1⁄6 = 六个并排）；点 ✕ 收起它。点右侧标签随时放回来。',
        });
        void emptyTip;

        /** 把 span 说成人话（给 `aria-label` / `data-tip` 用；⛔ 别在 aria 里直接念数字） */
        const spanLabelOf = (span: number): string => {
            const hit = ENTRY_FORM_SPAN_PRESETS.find((p) => p.span === span);
            return hit ? hit.hint : '自定义宽度';
        };

        /** 正在拖的块键（`dragstart` 记下、`drop` 取用） */
        let dragKey: string | null = null;

        /** 一处同刷：预览列表 + 计数 + 隐藏池（⛔ 别各刷各的，三处必须同源） */
        const sync = (): void => {
            // 🔴 固定键不进 `cur`：`cur` 只装**可管理**项，后面所有下标（拖动 / ↑↓ / 删除）才和屏幕对得上。
            const cur = this.currentEntryFormFields().filter((e) => !entryFormFieldIsFixed(e.key));
            const shownKeys = cur.map((e) => e.key);
            const hidden = allDefs.map((d) => d.key).filter((k) => !shownKeys.includes(k));
            // 「显示 N / M」只数可管理项 —— 固定键压根不画，不进分母
            counter.setText(`显示 ${cur.length} / ${allDefs.length}`);

            canvas.empty();
            cur.forEach((entry, i) => {
                const key = entry.key;
                const def = allDefs.find((d) => d.key === key);
                const label = def?.label ?? key;
                const row = canvas.createDiv({
                    cls: 'rl-ef-blk',
                    attr: {
                        role: 'button',
                        tabindex: '0',
                        draggable: 'true',
                        /**
                         * 🔴 #720b（2026-11-07 用户拍板「按窗口宽度降列数」）：占位**不写行内 `grid-column`**，
                         *   改成 `data-span` 交给 CSS —— 窄窗时列数会从 6 降到 2 / 1，
                         *   行内的 `span 6` 在 2 列网格里会越过末列（grid 会静默把它挤到下一行，
                         *   于是「整行」块反而排到最后、顺序看起来被打乱）。
                         *   CSS 侧按 `--rl-ef-cols` 现算：`span min(N, 列数)` 用 `min()` 表达。
                         */
                        'data-span': String(entry.span),
                        'aria-label': `${label}，第 ${i + 1} 位，宽度 ${spanLabelOf(entry.span)}；方向键可调整顺序`,
                    },
                });
                // 🔴 #720：块在 6 列栅格里按自己的 `span` 真实占位 —— 这就是「所见即所得」的全部。
                const grip = row.createSpan({ cls: 'rl-cf-grip' });
                safeSetIcon(grip, 'grip-vertical');
                /**
                 * 🔴 #718（2026-11-07 用户第⑧条）：「高级设置 › 条目属性重构 —— 就想根据现有
                 *    编辑属性 UI 页面拖动排序编辑增删不行吗」。选择的做法是 **A：真实控件外观 + 现有拖拽**。
                 *
                 * 🔴🔴 #719（2026-11-07 用户 m02783）：「这个条目属性什么鬼太丑了也不好调整，参考更多主流」
                 *    ⇒ 形态从「一行一张卡（标签在上、控件在下）」改成**主流属性编辑器**那种
                 *      「一张卡 + 发丝分隔线 + 每行一条」：
                 *        [⋮⋮] 属性名 ·············· [控件示意] [整行|1⁄2|1⁄3] [✕]
                 *      为什么改：
                 *        ⑴ 11 行 = 11 张带边框的卡片，纵向拉满 1000px，扫一眼全是框，这是「丑」的主因；
                 *        ⑵ 每行的「整行 / 1⁄2 / 1⁄3」三枚按钮常驻，三枚一排比属性名还抢眼，
                 *           11 行就是 33 枚按钮；改成**同行右侧的紧凑分段器**后视线不再被打断；
                 *    🔴🔴 #720（方案 D）本条注释的结论已翻面：现在**就是**在复刻弹窗排版 ——
                 *       块内「标签在上、控件在下」，块宽 = 弹窗里的实际占位。上一版「刻意不同」
                 *       的折中（横排一行 + 固定 72px 小样 + 只读色带）已整体退场，别再据它回潮。
                 *    ⚠️ 五种控件类型判据一字未改（`entryFormControlKind`），只改了**排布**。
                 */
                const fld = row.createDiv({ cls: 'rl-ef-fld' });
                fld.createSpan({ cls: 'rl-ef-lbl', text: label });
                const kind = entryFormControlKind(key);
                const ctl = fld.createSpan({ cls: `rl-ef-ctl is-${kind}` });
                if (kind === 'meta') {
                    // 「来源 / 大众评分 / 评价人数 / 平台链接」在真弹窗里是**一行四格**（`.rl-meta-row`）
                    for (let k = 0; k < 4; k++) ctl.createSpan({ cls: 'rl-ef-ctl-cell' });
                } else if (kind === 'btn') {
                    // 「总结摘要 / 歌词 / 阅读进度」这类带 AI 或操作按钮的标签行
                    ctl.createSpan({ cls: 'rl-ef-ctl-btn', text: '按钮' });
                }
                /**
                 * 块底工具行：跨度分段器 + 隐藏按钮。
                 *   🔴 #720 为什么从「一行右侧」挪到「块底」：块宽现在随 `span` 变化，
                 *      1⁄3 宽的块只有约 1/6 容器宽（约 120px），右栏塞不下三枚按钮 + ✕；
                 *      拆成独立一行后，无论块多窄都能放下（窄块里分段器会自己换行）。
                 */
                /**
                 * 🔴 ③-5（用户 m00353 逐字举例）：「去掉每个输入框下面那排紫色胶囊按钮，
                 *    改为输入框右上角一个极小图标（如 `layout-template`），点击才弹出下拉选 1/1、1/2、1/3」。
                 *
                 * 上一版（#720）是**块底**一行 `[整行|1⁄2|1⁄3] [✕]`。当时的理由写得很诚实：
                 *   「1⁄3 宽的块只有约 120px，右栏塞不下三枚按钮 + ✕」。那个理由**今天仍成立**，
                 *   所以这次不是把三枚按钮挪到右边，而是把它们**收进一枚图标**——
                 *   一枚 18px 图标在任何块宽下都放得下，展开后的菜单浮在块外，不占块内横向空间。
                 *
                 * 为什么用 `Menu`（Obsidian 原生）而不是手搓下拉：
                 *   用户 ③-5 的硬约束是「强制使用原生 API，不要手搓」。`Menu` 自带键盘导航、
                 *   焦点陷阱、Esc 关闭、视口边缘翻转，手搓一个不可能比它更原生。
                 *   ⚠️ 但**当前选中档要能被看到**：原生 `Menu` 的 checkbox 项会把勾选画在最左，
                 *   这里用 `setTitle` 把「当前档」写进菜单标题，并对当前档 `setDisabled(true)`
                 *   —— 点当前档本来就只有「什么都不发生」这一种结果，禁用比静默 no-op 更诚实。
                 */
                /**
                 * ⚠️ m07047 起画布上**只有可管理项**（固定键整组不画），所以工具行与拖拽
                 *   /键盘**无条件挂载** —— 这里不再有 `if (!isFixed)` 分支。
                 *   ⛔ 别把那个分支加回来：它的前提（固定键也画出来）已经被用户推翻。
                 */
                const tools = row.createDiv({ cls: 'rl-ef-tools' });
                const spanBtn = ghostIconButton('rl-ef-span', 'layout-template', `这一块在编辑窗口里占几列（当前：${spanLabelOf(entry.span)}）`);
                spanBtn.setAttribute('aria-haspopup', 'menu');
                tools.appendChild(spanBtn);
                spanBtn.addEventListener('click', (ev) => {
                    // 块本身是 `role="button"` + 可拖，冒泡上去会被当成「选中该块」——
                    // 下拉/隐藏这类块内动作一律掐断冒泡（#720 就有的坑，别丢）
                    ev.stopPropagation();
                    const menu = new Menu();
                    menu.addItem((mi) => {
                        mi.setTitle(`宽度（当前：${spanLabelOf(entry.span)}）`);
                        mi.setIsLabel(true);
                    });
                    for (const preset of ENTRY_FORM_SPAN_PRESETS) {
                        const on = preset.span === entry.span;
                        menu.addItem((mi) => {
                            mi.setTitle(`${preset.label} · ${preset.hint}`);
                            mi.setChecked(on);
                            if (on) mi.setDisabled(true);
                            mi.onClick(() => {
                                if (on) return;
                                const next = cur.map((e) => (e.key === key ? { key, span: preset.span } : e));
                                void this.commitEntryFormFields(next).then(sync);
                            });
                        });
                    }
                    const rect = spanBtn.getBoundingClientRect();
                    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
                });
                const hide = tools.createEl('button', {
                    cls: 'rl-ef-x',
                    attr: { type: 'button', 'aria-label': `隐藏「${label}」` },
                });
                safeSetIcon(hide, 'x');
                hide.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    void this.commitEntryFormFields(cur.filter((e) => e.key !== key)).then(sync);
                });

                row.addEventListener('dragstart', (ev) => {
                    dragKey = key;
                    row.addClass('is-dragging');
                    ev.dataTransfer?.setData('text/plain', key);
                });
                row.addEventListener('dragend', () => {
                    dragKey = null;
                    row.removeClass('is-dragging');
                });
                row.addEventListener('dragover', (ev) => {
                    ev.preventDefault();
                    row.addClass('is-over');
                });
                row.addEventListener('dragleave', () => row.removeClass('is-over'));
                row.addEventListener('drop', (ev) => {
                    ev.preventDefault();
                    row.removeClass('is-over');
                    if (!dragKey || dragKey === key) return;
                    const from = cur.findIndex((e) => e.key === dragKey);
                    const to = cur.findIndex((e) => e.key === key);
                    if (from < 0 || to < 0) return;
                    const next = moveItem(cur.slice(), from, to);
                    void this.commitEntryFormFields(next).then(sync);
                    dragKey = null;
                });
                // 键盘等价物：上下移动（本列表是纵向的 ⇒ 用 ↑/↓，与「卡片信息栏」那组的 ←/→ 区分得开）
                row.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
                    ev.preventDefault();
                    const to = ev.key === 'ArrowUp' ? i - 1 : i + 1;
                    if (to < 0 || to >= cur.length) return;
                    const next = moveItem(cur.slice(), i, to);
                    void this.commitEntryFormFields(next).then(() => {
                        sync();
                        // 重建后焦点会掉 ⇒ 放回同一项的新位置
                        (canvas.children[to] as HTMLElement | undefined)?.focus();
                    });
                });
            });

            // 🔴 #720：空态直接画在栅格里（占满 6 列），不再额外挂一条 `.rl-cf-empty` 到列表外
            if (cur.length === 0) {
                // 空态同理：占位交给 CSS（`grid-column: 1 / -1`），窄窗降列时也能横跨整行
                const empty = canvas.createDiv({ cls: 'rl-ef-empty-note', text: '可管理的属性已全部收起（第一行的标题 / 年份 / 评分来源是固定项，不在此列）' });
                empty.setAttribute('data-span', '6');
            }

            // 隐藏池：点一下放回**末尾**（与卡片信息栏「新加的排末尾」同口径 ⇒ 之后接着拖就行）
            chips.empty();
            emptyTip.toggleClass('is-hidden', hidden.length > 0);
            for (const key of hidden) {
                const def = allDefs.find((d) => d.key === key);
                const label = def?.label ?? key;
                const chip = chips.createEl('button', {
                    cls: 'rl-cf-chip',
                    text: label,
                    attr: { type: 'button', 'aria-label': `显示「${label}」` },
                });
                chip.addEventListener('click', () => {
                    const now = this.currentEntryFormFields();
                    if (now.some((e) => e.key === key)) return;
                    void this.commitEntryFormFields([...now, { key, span: def?.span ?? ENTRY_FORM_MAX_SPAN }]).then(sync);
                });
            }
        };

        /**
         * 🔴 #720b：栅格列数 = **画布自身宽度**说了算（用户 2026-11-07 拍板「按窗口宽度降列数」）。
         *
         * 为什么不用 CSS 的 `@media` / `@container`：实测（`tools/.out/probe-720b.cjs`，1440→520 五档）
         *   ⑴ 窗口宽度与画布宽度**不成正比** —— 窗口 1440 时画布只有 324px（预览被右侧「已隐藏的属性」
         *      挤窄），窗口 900 时画布反而 599px。按窗口写断点会把宽窄判反。
         *   ⑵ `container-type` 写在 `.rl-ef-canvas` 自身上不生效（容器查询只作用于后代）；
         *      挪到外层 `.rl-ef-preview` 会套上尺寸包含 ⇒ 固有宽度塌成 324px，宽窗反而变 1 列。
         * ⇒ 只认画布自己的 `clientWidth`，写回 `--rl-ef-cols` + `data-cols`，CSS 里逐档给映射。
         *   ⚠️ 阈值只在这里写一份，⛔ 别在 CSS 里再插一条 `@media`（会与这里打架）。
         *   ⚠️ 观察器必须 `disconnect()`：设置页每次 `display()` 都重建 DOM，不摘会越积越多。
         */
        const applyEntryFormCols = (): void => {
            const w = canvas.clientWidth;
            const cols = w < 240 ? 1 : w < 480 ? 2 : 6;
            canvas.setAttribute('data-cols', String(cols));
            canvas.style.setProperty('--rl-ef-cols', String(cols));
        };
        applyEntryFormCols();
        /**
         * 🔴 必须用**画布所在 document 的** `ResizeObserver`，不能用主窗口那个。
         *
         * 实测（`tools/.out/probe-720b.cjs`）：直接用全局 `ResizeObserver` 时，1440→520 五档画布宽度
         * 分别是 324/324/599/424/280px，但 `data-cols` 恒为初始的 `"1"` —— 回调**一次都没触发**。
         * 根因：Obsidian 1.14.4 把设置页开在**独立窗口**，`ResizeObserver` 绑定的是构造它的那个
         * document，观察别的 document 里的节点会被静默忽略（与 globalTooltip 只绑主窗口是同一类坑）。
         * ⇒ 从 `canvas.ownerDocument.defaultView` 取构造器；拿不到才退回全局。
         */
        const win = canvas.ownerDocument.defaultView ?? window;
        const RO = win.ResizeObserver ?? ResizeObserver;
        const colsObs = new RO(() => applyEntryFormCols());
        colsObs.observe(canvas);
        this.efColsObs?.disconnect();
        this.efColsObs = colsObs;
        // ⚠️ 首次调用时画布还没进布局（`clientWidth === 0` ⇒ 先算成 1 列），
        //   等这一帧渲染落地再量一次；之后交给 ResizeObserver 接管。
        win.requestAnimationFrame(() => applyEntryFormCols());

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
     * 「基本设置」页（#354 合并三页）：**4 组**。
     *   ⚠️ 组内行数：#399 时点 2/3/3/2 → #425 数据与备份 +1 → **#541 外观与体验 +4**（导航布局 / 起始页 /
     *      卡片风格 / 界面动效）⇒ **8 / 3 / 4 / 2**。
     *
     * 🔴 2026-10-31 翻面（用户裁定）：「把网络播放组放在音乐下载源下」——
     *    当天早些时候临时加在本页的第 3 组「网络播放」**已整体搬到「搜索配置」页**，
     *    紧跟「音乐下载源凭据」之后。本页因此退回 **4 组**，实验性功能也回到纯开关。
     *    ⛔ 别搬回来：本页的职责是「**开关类**设置」（一次设定后不再碰），
     *      凭据类是「用户被报错赶过来填的东西」，必须与音乐四平台的 Cookie 聚在同一页
     *      （见 `renderSourcePage` 那段注释的完整理由）。
     *
     * 🔴 分组是用户可见的层级，顺序即下表（用户 2026-09-21 要求「为基本设置页面设计合理的内部排版
     *    （建议按外观偏好、数据清理等小标题分组）」）：
     *      外观与体验 → 实验性功能 → 数据与备份 → 封面与清理
     *    ⚠️ 「实验性功能」这个词**保留为组名**（它承载"这些开关还不稳"的用户预期），只是从"页"降级成"组"。
     *    ⚠️ 组间**只用间距、⛔ 不画分割线**（D-6）：行数越多越要守这条，插 N 条线会把面板切碎，
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
        // 🔴🔴 2026-11-06 用户逐字：「基本设置-实验性功能组和高级设置-ASR和TTS组全部移动到新开插件页签
        //    【沉浸体验】放在搜索配置和AI集成中间」⇒ 这组**已整体搬走**（见 `renderImmersivePage` 的
        //    「媒体载体」组）。⛔ 别搬回来：三条「启用内置…」是「这个插件能不能在你眼前播」的事，
        //    与「外观怎么显示、数据怎么备份」不是一类；留在本页它只会被日常开关埋掉。
        //    ⚠️ `renderExperimentalRows` 本体一字未改（含 #399 钉死的「恰 3 条、阅读→视频→音乐」），
        //       只是换了挂载点 —— 那里面的折叠子面板、目录行、后台播放开关全部随它一起搬过去。
        // 🔴🔴 2026-10-31（用户裁定）：「把网络播放组放在音乐下载源下」——
        //    原本加在这里的第 3 组「网络播放」**已整体搬到「搜索配置」页**、
        //    紧跟「音乐下载源凭据」之后（见 `renderSourcePage` 里那段注释）。
        //    ⛔ 别搬回来：凭据类是「填了才能用」的东西，与音乐四个平台的 Cookie 同类，
        //    它们必须聚在一起；本页只留**开关类**（一次设定后不再碰）的设置。
        this.createGroupSection(parent, '数据与备份', (body) => this.renderDataBackupRows(body), true);
        // ⚠️ 组名演变：「封面与清理」→（上一轮）**「数据与维护」**→（本轮用户 m02783 ②）**「管理与维护」**。
        //    该组早已不只管封面（条目还原 / 附件清理 / 迁移进度都在里面），上一轮已把「封面」拿掉；
        //    本轮用户逐字要求「基本设置-数据与维护名称改成『管理与维护』」—— 组内是**动作**（清理/还原/
        //    检测/管理），不是数据本身，叫「管理」更贴。⛔ 别再叫回「数据与维护」。
        //    组名必须与 `pure/settingNav.SETTING_GROUP_ICONS` 的键逐字一致（已同步改），否则图标静默丢失。
        this.createGroupSection(parent, '管理与维护', (body) => this.renderPosterCleanupRows(body), true);
    }

    /**
     * 「基本设置」页 · 第 1 组「外观与体验」（8 行）。
     *
     * 🔴🔴 **子项顺序（#596 用户点名重排，2026-10-10）**：导航布局 → 起始页 → 卡片风格 → 界面动效 →
     *    海报密度 → **按全类型分页签** → Ctrl + 滚轮缩放 → 隐藏插件内滚动条 → 笔记表格。
     *    ⚠️ 本次把「卡片风格 / 界面动效」提到多档设置的中段、把两处二元开关与「笔记表格」压到组尾
     *    （⛔ 别按「谁先做的」排 —— 断言按本组函数体里 `setName` 的**出现顺序**逐项钉住）。
     *    🔴 m07854 ③（2026-11-13）：「按全类型分页签」从「导航布局」之后挪到「海报密度」之后
     *    （用户逐字：「把『基本设置-外观与体验』的按全类型分页签开关项移动到海报密度项下面」）。
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
        //    🔴 **行序（9 行，见方法上方那条）**：导航布局 → 起始页 → 卡片风格 → 界面动效 → 海报密度 →
        //       **按全类型分页签** → **Ctrl + 滚轮缩放** → 隐藏插件内滚动条 → 笔记表格。
        //       ⚠️ 既有断言按 `setName` 的出现顺序钉着，⛔ 别顺手调（m07854 ③ 已按用户要求调过一次，
        //          对应断言已同步改成新序）。
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
        //  🔴 m09565 ①-4：候选表按**当前分类轴**取（`tabOrderFor`）——
        //     聚合轴下列出「电影」这种当前不存在的页签，用户选了不生效，是最容易被当成 bug 的坑。
        new Setting(parent)
            .setName('起始页').setDesc('打开横向页签/纵向页签视图时的默认页签')
            .addDropdown((d) => {
                const axisNow = normalizeTabAxis(this.plugin.settings.tabAxis);
                for (const t of tabOrderFor(axisNow)) d.addOption(t, homeTabLabel(t));
                d.setValue(normalizeStartTabFor(axisNow, this.plugin.settings.startTab)).onChange(async (key) => {
                    // ⚠️ 落盘存**原始值**（不折轴）：用户可能来回切开关，存折过的值会让
                    //    「切回全类型后起始页莫名变成电影」——但用户当初选的其实是另一枚。
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

        // ── ⑤-a 按全类型分页签（🔴 用户 m09565 ①-4；m07854 ③ 起排到「海报密度」之后）──
        //  用户逐字：「设置页基本设置加个启用顶部胶囊/文字菜单则按全类型分页签，关闭则按
        //  计划、阅读、影视、音乐、游戏、统计分页签（**两种模式的导航状态（当前选中项）要独立保存**，
        //  切换开关时不要丢失各自的位置）」
        //  🔴 m07854 ③（2026-11-13）用户原话：「把『基本设置-外观与体验』的按全类型分页签开关项
        //     移动到**海报密度**项下面」⇒ 本行原先紧跟在「导航布局」后面（第 1.5 位），现在挪到
        //     海报密度之后。⚠️ 挪的只是**渲染位置**，行为一字未改（落盘键仍是 `tabAxis`）。
        //  ⚠️ 用它 `addToggle` 而不是下拉：这是**二态开关**（开 = 全类型十枚 / 关 = 聚合六枚），
        //     本组「多档选择才用下拉」的口径（见方法上方那段）在这里正好划出分界线。
        //  ⚠️ 关掉时两件事必须一起做：落盘 + `syncTabAxis()`。少了后者用户当场看不到页签变化
        //     （同 `syncNavLayout` 的理由：换的是 DOM 节点集合，纯 CSS 变不出来）。
        new Setting(parent)
            .setName('按全类型分页签').setDesc('关闭则按计划/阅读/影视/音乐/游戏/统计')
            .addToggle((t) => {
                t.setValue(normalizeTabAxis(this.plugin.settings.tabAxis) === 'expanded').onChange(async (on) => {
                    this.plugin.settings.tabAxis = on ? 'expanded' : 'classic';
                    await this.plugin.saveSettings();
                    // 🔴 两条轴各自的选中项由 `main.ts` 的 `homeTabByAxis` 分别记着 ⇒ 这里只重推轴，
                    //    ⛔ 别顺手 `syncStartTab()`：那会把**起始页**强行盖到用户当前停留的位置上。
                    this.plugin.syncTabAxis();
                    // 起始页下拉的候选**按轴变**（聚合轴没有「电影」这些）⇒ 本行变了要重建这一页，
                    // 否则下拉里还列着当前轴不存在的页签（选了也不会生效）。
                    this.display();
                });
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
                // 🔴 2026-11-24 用户裁定：「将网络集用插件播放器播放的全部功能和样式全部从插件移除，
                //    但有官方 iframe 内嵌播放的不要移除」⇒ 这里原有的「网络集用插件播放器」开关
                //    （`netInlinePlayer`）**连同设置字段一起删除**：现在没有第二条路可选，
                //    网络集固定走官方 iframe。⛔ 别再补回这个开关（补回来就是又开了一条内置播放器的路）。
                // 🔴🔴 2026-10-31（用户报障，逐字）：「设置页里没有 youtube 的 cookie 填写入口啊」
                //    —— 病根不是"没实现"，而是**藏在折叠面板里**：`makeCollapsible` 的 `.rl-exp-panel`
                //    默认 `display:none`，不点开「启用内置视频播放器」这一行，那两条输入框根本不存在于屏幕上。
                //    ⇒ 「B 站 / YouTube」两站的**取流凭据**搬去了「搜索配置」页的「网络播放」组
                //      （见 `renderNetPlaybackRows`；2026-10-31 下午用户又裁定「放在音乐下载源下」，
                //      所以它最终落在那一页、与音乐四平台的 Cookie 相邻）。
                //    ⛔ 别再搬回这个 panel：凭据是"用户主动要填"的东西，藏起来就等于没有。
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
                // 🔴🔴 本轮用户裁定（需求①）：「『音频下载目录』项改成**音乐目录**（与音频下载路径统一）」。
                //    ⇒ 行名从「音频文件目录」改为「音乐目录」，描述同步去掉「音频」二字（同一个字段没变）。
                //    ⚠️ 它就是同一个 `musicDownloadDir`，只是换了名字与摆放位置
                //      （两份设置必然打架，见 `pure/localDirs` 模块头）。
                //    ⚠️ 因此这里仍走 `createLibraryDirRow`（下载根口径：归一 / 校验 / 「将落到 X」提示都在它里面），
                //      ⛔ 别改用下面那个 `createLocalDirRow`（那是「本地检索根目录」口径，不做下载根归一）。
                this.createLibraryDirRow(
                    panel,
                    '音乐目录',
                    '音乐文件的存放与检索目录',
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
                // 🔴 1.5.1（用户 2026-11-28）：「将音频转文字放在高级设置下」
                //    ⇒ 本折叠项里**不再**渲染 ASR 引擎配置，已整段搬到「高级设置 › 音频转文字」组。
                //    ⛔ 别在这里补回来 —— 同一个设置字段只许有一个输入框（那会让两处状态不同步）。
                //    转写按钮（字幕面板那颗 🎙️）与引擎配置是正交的：按钮不受这块搬家的影响。
            },
        );

        // 🔴 m02844（用户逐字：「游戏下载目录放播放阅读启用启动器下」）——第 4 条折叠项。
        //    ⇒ 新增「启用内置游戏启动器」，把「游戏目录」作为它的从属子行（缩进，同一个
        //      `createLibraryDirRow` 口径：归一 / 校验 / 「将落到 X」提示都在它里面）。
        //    ⚠️ 顺序只在末尾追加，⛔ 别插进前面三条之间 —— 阅读→视频→音乐 是用户多轮定下的顺序。
        //    ⚠️ desc 沿用同组「在插件内做某事」句式。
        // 🔴 2026-11-17（①）：整行**抽成 `renderGameLauncherRow`** —— 本方法体内 `setName`
        //    被 #399 钉成**恰 3 条**（阅读 → 视频 → 音乐，见上面 7500-7501 行那条纪律）。
        //    1.5.0 期把游戏那行直接塞在这里 ⇒ 方法体变成 4 条，当场撞红那条判据。
        //    ⛔ 别为了「看着紧凑」再把它内联回来，也别去改 #399 的期望值 —— 那条判据守的是
        //       「这三行同组且顺序固定」，放宽它等于放任顺序被随手改。
        this.renderGameLauncherRow(parent);
    }

    /**
     * 「启用内置游戏启动器」+ 从属的「游戏目录」行。
     *
     * 独立方法的理由见调用点注释（#399 把 `renderExperimentalRows` 的 `setName` 钉成恰 3 条）。
     */
    private renderGameLauncherRow(parent: HTMLDivElement): void {
        const game = new Setting(parent).setName('启用内置游戏启动器').setDesc('在插件内启动本地 Flash 游戏');
        this.makeCollapsible(
            game,
            parent,
            !!this.plugin.settings.internalGameLauncher,
            async (value) => {
                this.plugin.settings.internalGameLauncher = value;
                await this.plugin.saveSettings();
            },
            (panel) => {
                // 游戏（swf）的下载落点 —— 与「音乐目录」同一套下载根口径（`kind: 'flash'` 决定
                // 空值回落到 `下载/Flash 游戏`，⛔ 别改成 'other'：那个白名单是空的，swf 会被直接拒）。
                // 🟠 ① 用户 2026-11-17 的目录约定：这个设置项**不动**，约定的是它**内部**的分层 ——
                //    `<游戏目录>/swf/` 放「单文件无存档」的影片（统一管理，几百个单文件也不会散落一地），
                //    `<游戏目录>/<游戏名>/` 放「多文件 / 有存档」的（主影片 + 关联资源 + `saves/` 备份）。
                //    判据收口在 `pure/gameLayout`，⛔ 别在别处再拼一遍路径。
                this.createLibraryDirRow(
                    panel,
                    '游戏目录',
                    'Flash 游戏文件的存放与检索目录（其下 `swf/` 收单文件、`<游戏名>/` 收多文件与存档）',
                    () => this.plugin.settings.gameDownloadDir,
                    async (next) => {
                        this.plugin.settings.gameDownloadDir = next;
                        await this.plugin.saveSettings();
                    },
                    'game',
                    'flash',
                );
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
        // 🔴 本轮追加：再挂一个 `.rl-dir-sub` —— 这几个目录行是**折叠项下的从属项**，
        //    用户要求「缩进区分于折叠项主次」。缩进值写在 `styles.css`（⛔ 别内联 padding）。
        //    ⚠️ 两个类各管一件事：`rl-dir-row` 管输入框宽度收敛，`rl-dir-sub` 管层级缩进。
        row.settingEl.addClass('rl-dir-row');
        row.settingEl.addClass('rl-dir-sub');
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
            // 🔴🔴 本轮用户裁定（需求①）：「给这些本地检索目录框右侧加『浏览』按钮，
            //    **直接唤起系统文件选择器**；且要**缩进区分于折叠项主次**」。
            //    ⑴ 按钮**恒常出现**（旧实现在 `!inst` 时才建 ⇒ 桌面用户反而没有浏览器，是本轮要修的病灶）。
            //    ⑵ 点击首选 `plugin.pickSystemDirectory()`（Electron 的 showOpenDialog，能选库外绝对路径）；
            //       它回 `undefined` 有两种情况 —— 用户取消、或环境不支持。**只有后者**才回退
            //       `VaultFolderSuggest`（库内选择器）；用户取消时什么都不做，⛔ 别弹一个意料之外的补全框。
            //       判据用 `Platform.isDesktopApp` 而**不是**「返回值是否 undefined」：
            //       取消与不支持在返回值上不可区分（都回 undefined）。
            //    ⑶ 行挂 `.rl-dir-sub`（缩进）—— 这几个目录是折叠项**下面的从属项**，
            //       不缩进会与折叠行头平齐，用户分不清哪行是主项。
            row.addButton((b) => {
                b.setButtonText('浏览');
                b.buttonEl.addClass('rl-dir-browse');
                b.onClick(() => {
                    if (Platform.isDesktopApp) {
                        void this.plugin.pickSystemDirectory(localDirOf(this.plugin.settings, key)).then((picked) => {
                            if (!picked) return; // 用户取消（或环境静默失败）⇒ 保持原值
                            text.setValue(picked);
                            void commit();
                        });
                        return;
                    }
                    new VaultFolderSuggest(this.app, folders, fromPick).open();
                });
            });
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
     * 「搜索配置」页 · 「网络播放」组：**B 站 / YouTube 两站的取流凭据**。
     *
     * 🔴🔴 2026-10-31 用户裁定（逐字）：「把网络播放组放在音乐下载源下，并添加同款折叠行和测试链接按钮」。
     *    三件事一次性落地：
     *      ⑴ **位置**：从「基本设置」页整体搬到本页，紧跟「音乐下载源凭据」；
     *      ⑵ **形态**：从「一行一个常显输入框」改成与音乐源**逐字同款**的折叠行
     *         （`rl-prov-list` / `rl-key-row rl-prov-card` / 图标 + 名称 + 徽标 + ▸）；
     *      ⑶ **测试连接**：每行一颗，反馈形态也与音乐源同款（✓/✗ 文案 · Nms，按钮贴右不动）。
     *
     * 🔴 为什么「同款」这条必须守死（⛔ 别再发明第五套布局）：
     *    同页现在有两组凭据、共六行。用户学会「点行头展开、右下角有测试连接」一次，就该处处适用；
     *    每换一组就换一套交互，等于让用户为同一件事学两遍（本仓 #488/#489 已经为
     *    「同页两组说同一件事却两套词」被用户点过一次）。
     *
     * 🔴 为什么两条都要「测试连接」（用户点名要）：
     *    这两站的取流失败**都很安静**——B 站是悄悄把画质降到 720P，YouTube 是报一句
     *    「要求验证机器人身份」。用户看到的现象是「怎么画质不对 / 怎么放不出来」，
     *    根本不知道是凭据问题。有一颗按钮能把原因当场问出来，比读一百行文档有用。
     *
     * ⚠️ 结论键走 `netCheckKey`（`net:bilibili` / `net:youtube`），⛔ **不**复用 `music:bilibili`：
     *    音乐那族测的是「Cookie 能不能下载音频」，本族测的是「能不能在内置播放器里取到流」——
     *    同一个 Cookie、两套判据，共用一个键会让一边的结论覆盖另一边
     *    （B 站那行现在恰好两个判据都成立，但 YouTube 那行没有「下载」这回事，不对称迟早出错）。
     */
    private renderNetPlaybackRows(parent: HTMLDivElement): void {
        const list = parent.createDiv({ cls: 'rl-prov-list' });

        // ── ⓪ 音视频取流（yt-dlp / ffmpeg 路径）—— 🔴 本轮从「音乐下载源凭据」搬来，占**第一顺位**。
        //    为什么它排最前：两个站的取流都**依赖它**（没有 yt-dlp 连测试连接都跑不了），
        //    先有工具再有凭据，读起来才是「前提 → 配置」的顺序。
        //    ⚠️ 它仍挂在**同一个** `.rl-prov-list` 容器里，行形态与下面两条逐字同款。
        this.renderYtdlpRow(list);

        // ── ① B 站：取流冲 1080P + 读字幕，共用同一个 `biliCookie` ──
        const curBili = (): string => this.plugin.settings.biliCookie ?? '';
        const bili = this.createNetRow(list, 'bilibili', 'B站', () => !!curBili().trim());
        // 🔴 2026-11-06：B 站 Cookie 说明里的官网地址改走可点链接（用户裁定「所有要 cookie 或 key 的都加」）
        this.renderHintNote(bili.body, BILI_COOKIE_DESC);
        /**
         * ③-3（2026-11-12 用户 m00353 / m05505）：B 站这一行 = 「输入框 + 扫码图标」
         * 或「当前账号 + 退出登录」，整块交给 `renderQrAccountField`。
         *
         * 🔴 扫码图标在**输入框那一行**（用户 m05505 原话「紧挨着『显示』按钮的左侧」），
         *    ⛔ 不再放到下面那排动作行里。
         * 🔴 `refresh_token` 只在**真拿到**时才写（`undefined` 时不动旧值）—— 用户重扫一次
         *    不该把上一次的续期凭据抹掉（新 Cookie 可能只是同账号再登一次，旧 token 仍可续）。
         */
        const biliHost = bili.body.createDiv({ cls: 'rl-acct-host' });
        const persistBili = (cookie: string): void => {
            this.plugin.settings.biliCookie = cookie.trim();
            void this.plugin.saveSettings();
            // 值一改 ⇒ 旧的「连接失败」作废（与音乐源那几条同一口径）
            this.plugin.clearCredentialStatus(netCheckKey('bilibili'));
            bili.refreshBadge();
            // #758：扫码拿到真凭据 / 手动粘贴 / 退出登录都经过这里 ⇒ 面板同步
            this.refreshCredentialTable();
        };
        this.renderQrAccountField(biliHost, {
            platform: 'bilibili',
            placeholder: '粘贴 bilibili.com 的 Cookie（可留空）',
            value: curBili(),
            onInput: (v) => persistBili(v),
            onPicked: (picked) => {
                persistBili(picked.cookie);
                // 🔴 用户 m00353 ③-3 硬要求：「扫码成功返回的 `refresh_token` 必须持久化」
                if (picked.refreshToken) this.plugin.settings.biliRefreshToken = picked.refreshToken;
                void this.plugin.saveSettings();
            },
            onLogout: () => {
                persistBili('');
                // 退出登录 = Cookie 作废 ⇒ 续期凭据也一起清（留着它只会去换一个已退出的账号）
                this.plugin.settings.biliRefreshToken = '';
                void this.plugin.saveSettings();
            },
        });
        // 🔴 判据复用下载侧那条 `dlTestConnection('bilibili', …)`：它打的是 B 站官方的
        //    `x/web-interface/nav`（`code === 0 && isLogin === true`），判的正是「这份 Cookie 登没登录」——
        //    而「登没登录」就是「能不能冲 1080P、能不能读字幕」的**同一个前置**。
        //    ⛔ 别为播放另写一套登录探测：两套判据迟早给出互相矛盾的结论。
        this.mountNetTestAction(
            bili.body,
            () => this.plugin.dlTestConnection('bilibili', curBili()),
            (ok) => {
                this.plugin.setCredentialStatus(netCheckKey('bilibili'), ok);
                bili.refreshBadge();
                // #758：B 站行的测试结论落到面板
                this.refreshCredentialTable();
            },
        );

        // ── ② YouTube：代理 + Cookie，两条都可不填 ──
        const curProxy = (): string => this.plugin.settings.ytProxy ?? '';
        const curYtCookie = (): string => String(this.plugin.settings.ytCookie ?? '');
        const yt = this.createNetRow(
            list,
            'youtube',
            'YouTube',
            // ⚠️ 两个前置**任一**有值就算「已配置」：它们都可不填，且都只在排障时才需要填，
            //    要求两个同时有值会把「只填了代理」这种完全正常的配置画成「未配置」。
            () => !!curProxy().trim() || !!curYtCookie().trim(),
        );
        // 🔴 2026-11-06：YouTube 说明里的地址同样可点（用户裁定「所有要 cookie 或 key 的都加」）
        this.renderHintNote(yt.body, YT_NET_DESC);
        yt.body.createDiv({ cls: 'rl-net-lbl', text: YT_PROXY_LABEL });
        // 代理走**明文**（与 `rl-secret` 的同款盒模型）：它是个 URL，不是密钥，
        // 用户需要能核对端口有没有打错（⛔ 别挂眼睛按钮，`masked: false` 也已给出切换）。
        const proxyWrap = yt.body.createDiv({ cls: 'rl-secret' });
        const proxyInput = proxyWrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: 'http://127.0.0.1:7897', type: 'text', spellcheck: 'false' },
        });
        proxyInput.value = curProxy();
        proxyInput.addEventListener('input', () => {
            // ⚠️ 边打边存会留下半截地址（`http://127.0`），但那只是**临时**状态：
            //    取流时 `normalizeProxyUrl` 会判它不可用并当直连处理，不会把播放搞崩。
            this.plugin.settings.ytProxy = proxyInput.value.trim();
            void this.plugin.saveSettings();
            this.plugin.clearCredentialStatus(netCheckKey('youtube'));
            yt.refreshBadge();
            // #758：代理地址也算「是否配置」的一半（见 `isNetConfigured('youtube')`）
            this.refreshCredentialTable();
        });
        yt.body.createDiv({ cls: 'rl-net-lbl', text: YT_COOKIE_LABEL });
        this.createSecretField(yt.body, {
            placeholder: 'SID=…; HSID=…; SSID=…（可留空）',
            value: curYtCookie(),
            onInput: (v) => {
                this.plugin.settings.ytCookie = v.trim();
                void this.plugin.saveSettings();
                this.plugin.clearCredentialStatus(netCheckKey('youtube'));
                yt.refreshBadge();
                // #758：YouTube Cookie 变了，面板「是否配置」也要跟上
                this.refreshCredentialTable();
            },
        });
        // 🔴 2026-11-26 用户：「可内嵌播放了，把检查按钮移除吧」
        //    这枚「检查内嵌登录态」按钮已完成使命（定位 YouTube 内嵌的登录态问题），
        //    用户确认能播之后按要求撤掉界面上这颗入口。
        //    ⚠️ 底层诊断能力**留着**：`probeEmbedCookies()` 仍在 `services/embedCookie` 里导出，
        //       下次再出登录态问题直接写个临时入口调它，⛔ 别把函数本身删了重写一遍。
        //    ⛔ 别把按钮补回界面上 —— 用户点名移除。
        // ⚠️ 测试用的是**真实取流那条路**（`main.ts` 的 `ytTestConnection` → `fetchYtInfo` 探测片），
        //    ⛔ 别在这里另起一个 `https.get('youtube.com')` 之类的轻量探测 ——
        //    那样会出现本仓栽过的「测试 ✓ 但播放 ✗」（真正卡住的是 yt-dlp 与代理的组合）。
        this.mountNetTestAction(
            yt.body,
            () => this.plugin.ytTestConnection(),
            (ok) => {
                this.plugin.setCredentialStatus(netCheckKey('youtube'), ok);
                yt.refreshBadge();
                // #758：YouTube 行的测试结论落到面板
                this.refreshCredentialTable();
            },
        );
    }

    /**
     * 「网络播放」组里一行折叠行的**壳**（图标 + 名称 + 徽标 + ▸ + 空行体）。
     *
     * 🔴 抽出来而不是复制两遍：行头那五件（图标/名称/徽标/箭头/展开事件）与音乐源那套
     *    是同一份几何，⛔ 两处各写一遍迟早会漂（本仓「同一件事写两遍」栽过多次）。
     * ⚠️ 与 `renderMusicCookieRows` 里那几行**刻意不再合并**：那边被 #488/#489 的既有断言锚着，
     *    动它是另一件事的账，⛔ 别顺手统一。
     *
     * @param has 判定「这一行算不算已配置」（各行的字段组合不同，由调用方给）
     */
    private createNetRow(
        list: HTMLElement,
        id: NetSourceId,
        name: string,
        has: () => boolean,
    ): { row: HTMLDivElement; body: HTMLDivElement; refreshBadge: () => void } {
        // 🔴 ③-1（2026-11-12）：「统一周期管理」面板点名称要跳到**这一行** ⇒ 挂 `data-cred-key`。
        //    值与 `pure/credentialMeta` 的 `key` 逐字同源（`net:<id>`），⛔ 两处不许各拼一套。
        const row = list.createDiv({
            cls: 'rl-key-row rl-prov-card',
            attr: { 'data-cred-key': netCheckKey(id) },
        });
        const head = row.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), NET_COOKIE_ICON[id]);
        head.createSpan({ cls: 'rl-key-name', text: name });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        // 🔴 三态徽标与音乐源**逐字同款**：已配置 / 未配置 / 连接失败
        //    （「连接失败」= 开机自检或刚点过测试测不通；没测过 ⇒ `undefined` ⇒ 不标，⛔ 别把「没测」画成「失败」）。
        const refreshBadge = (): void => {
            const filled = has();
            const expired = filled && isExpired(this.plugin.credentialStatusOf(netCheckKey(id)));
            badge.setText(expired ? EXPIRED_BADGE : (filled ? '已配置' : '未配置'));
            badge.toggleClass('rl-key-badge-on', filled && !expired);
            badge.toggleClass('rl-key-badge-bad', expired);
        };
        // m07854 ②：登记给「统一周期管理」面板的一键检测回调
        this.registerCredentialBadge(netCheckKey(id), refreshBadge);
        refreshBadge();
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });
        const body = row.createDiv({ cls: 'rl-key-body' });
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
        return { row, body, refreshBadge };
    }

    /**
     * 「网络播放」组里一行的**测试连接按钮 + 就地回执**（与音乐源那几颗逐字同款）。
     *
     * 🔴 三条不能改的细节，每条都有用户报障垫底：
     *   · 回执文字在按钮**左边**、按钮**贴右不动**（`.rl-key-actions` 的布局注释）；
     *   · 测试中**不改按钮文案**、只加 `.rl-btn-loading` —— 改文案会让按钮变窄 ⇒ 横向跳动；
     *   · 结论要么写进徽标、要么只留回执，⛔ 别两个地方说同一件事又说反。
     *
     * @param run   真正跑测试（由调用方选判据：B 站查登录态 / YouTube 真跑 yt-dlp）
     * @param after 拿到结论后刷新徽标（写结果表的动作由调用方做，本方法只负责画）
     */
    private mountNetTestAction(
        body: HTMLDivElement,
        run: () => Promise<{ ok: boolean; message: string }>,
        after: (ok: boolean) => void,
        /**
         * ③-3（2026-11-12）：在「测试连接」**之前**插入额外按钮（B 站用它是「扫码登录」）。
         *
         * ⚠️ 为什么做成回调而不是多传一个布尔：动作行的次序是本仓报障最多的区域
         *    （#641 的 16px gap、#655 的按钮反序），把「往这一行加按钮」收成一个明确的接缝，
         *    比在这里散写 `if (platform === 'bilibili')` 更难改错。
         * 🔴 建在测试按钮**之前**：测试是「用凭据」，扫码是「填凭据」—— 后者必须在前面。
         */
        beforeTest?: (actions: HTMLElement) => void,
    ): void {
        const actions = body.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        beforeTest?.(actions);
        const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
        testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            testBtn.addClass('rl-btn-loading');
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const started = Date.now();
            const r = await run();
            const elapsedMs = Date.now() - started;
            testBtn.disabled = false;
            testBtn.removeClass('rl-btn-loading');
            after(r.ok);
            resultEl.setText(`${r.ok ? '✓ ' : '✗ '}${r.message} · ${elapsedMs}ms`);
            resultEl.toggleClass('rl-key-result-ok', r.ok);
            resultEl.toggleClass('rl-key-result-bad', !r.ok);
        });
    }

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

    /**
     * 「当前文字识别模型」下拉的落点（m06789 需求②：「上面下拉框选择 ➡️ 下面详情卡片联动展示」）。
     *
     * 🔴 两件事一起做，**顺序不能反**：
     *   ⑴ `whisper:<tier>` 先把 `asrModelPath` 指到该档的**预期路径**（插件下次下载就落这里）；
     *      文件不在也没关系 —— 详情卡会依 `asrEngineStatus` 如实显示「未配置」。
     *   ⑵ 再改 `asrEngine`，最后重画：换引擎后「已就绪」的判据完全不同，不重画就会看到
     *      「上面选了 Qwen、下面还是 whisper 的三勾」。
     * ⚠️ 选到 `whisper:<tier>` 时若该档文件**已经存在**，等价于「切换使用中的模型」，直接生效无需下载。
     *
     * 🔴 2026-11-06 m08893：「我每次选择模型怎么重载了页面啊」——
     *    原来结尾是 `this.display()`（整页重绘：滚动跳回顶部、其它组也重画）。
     *    改成接收 `refresh` 回调只重画这张卡。判据不是「看起来没闪」，
     *    而是**页面 DOM 节点没被换掉**：`renderVoiceSection` 的 redraw 走的是 `card.empty()`，
     *    卡外的节点（页签栏、其它设置组）一个都不动。
     */
    private async switchAsrModel(pickId: string, refresh?: () => void): Promise<void> {
        const s = this.plugin.settings;
        if (pickId.startsWith('whisper:')) {
            const tier = pickId.slice('whisper:'.length);
            const preset = presetOf(tier);
            s.asrEngine = 'whisper';
            if (preset) {
                // 已经下载过就用它的实际路径；没下过也先指到预期位置（下载完成即生效）
                s.asrModelPath = this.plugin.asrModelPathFor(preset);
            }
        } else if (pickId.startsWith('qwen3:')) {
            // 🔴 m09432：`qwen3:1.7B` = 「切到 Qwen3 的 1.7B 档」
            //    ⛔ 别写成裸 `qwen3` 再另想办法带档位 —— 那样下拉里选档和选家会走两条路。
            s.asrEngine = 'qwen3';
            s.asrQwenTier = pickId.slice('qwen3:'.length);
        } else if (pickId.startsWith('sensevoice:')) {
            s.asrEngine = 'sensevoice';
            s.asrSvVariant = pickId.slice('sensevoice:'.length);
        } else if (pickId.startsWith('paraformer:')) {
            // 🔴 六家统一前缀约定：`<engine>:<档位>`。⛔ 别让某一家只写裸 id，
            //    那样下拉里「选家」与「选档」会走两条不同的路，续加引擎必漏。
            s.asrEngine = 'paraformer';
            s.asrParaVariant = pickId.slice('paraformer:'.length);
        } else if (pickId.startsWith('xasr:')) {
            s.asrEngine = 'xasr';
            s.asrXasrChunk = pickId.slice('xasr:'.length);
        } else if (pickId.startsWith('confucius:')) {
            s.asrEngine = 'confucius';
            s.asrConfuciusTier = pickId.slice('confucius:'.length);
        } else {
            s.asrEngine = engineDefOf(pickId).id;
        }
        await this.plugin.saveSettings();
        if (refresh) refresh();
        else this.display();
    }

    /**
     * 另两家的档位下拉项（Qwen3 / SenseVoice）。
     *
     * 🔴 m09432：「还有其他两家模型没有档位切换吗？还有对齐模型呢」
     *    · Qwen3 两档 0.6B / 1.7B —— **1.7B 的权重分两片**，体积是 0.6B 的 2.4 倍；
     *    · SenseVoice 两档 int8 / fp32 —— 同仓库里的两个 onnx，差的只是量化。
     *    对齐模型（Qwen3-ForcedAligner-0.6B）**不跟档位联动**、上游也只有一档，
     *    所以它不进下拉，而是在 Qwen3 行下面用一行字说明「会跟着一起装」。
     *
     * ⚠️ 体积都写进选项标签里：选之前就该知道 1.7B 要多下 2.6GB，
     *    ⛔ 别等点完「一键装好」弹窗才发现是 4.4GB。
     */
    private asrVariantItems(
        engine: string,
        refresh?: () => void,
    ):
        | {
              value: string;
              items: { value: string; label: string }[];
              onChange: (value: string) => void;
          }
        | undefined {
        const s = this.plugin.settings;
        if (engine === 'qwen3') {
            const cur = qwenVariantOf(String(s.asrQwenTier ?? '')).tier;
            return {
                value: `qwen3:${cur}`,
                items: QWEN_ASR_VARIANTS.map((v) => ({
                    value: `qwen3:${v.tier}`,
                    label: `${v.tier} · ${formatBundleBytes(bundleBytes(qwenBundle(v.tier)))}`,
                })),
                onChange: (v) => void this.switchAsrModel(v, refresh),
            };
        }
        if (engine === 'sensevoice') {
            const cur = svVariantOf(String(s.asrSvVariant ?? '')).variant;
            return {
                value: `sensevoice:${cur}`,
                items: SENSEVOICE_VARIANTS.map((v) => ({
                    value: `sensevoice:${v.variant}`,
                    label: `${v.title} · ${formatBundleBytes(v.bytes)}`,
                })),
                onChange: (v) => void this.switchAsrModel(v, refresh),
            };
        }
        if (engine === 'paraformer') {
            const cur = paraVariantOf(String(s.asrParaVariant ?? '')).variant;
            return {
                value: `paraformer:${cur}`,
                items: PARAFORMER_VARIANTS.map((v) => ({
                    value: `paraformer:${v.variant}`,
                    label: `${v.title} · ${formatBundleBytes(v.bytes)}`,
                })),
                onChange: (v) => void this.switchAsrModel(v, refresh),
            };
        }
        if (engine === 'xasr') {
            // 🔴 四档体积几乎一致（encoder 都在 593MB 上下），所以标签主打**延迟**：
            //    160ms 分块反应最快但更容易断句，1920ms 上下文最长、最稳。⛔ 别只写体积。
            const cur = xasrVariantOf(String(s.asrXasrChunk ?? '')).chunk;
            return {
                value: `xasr:${cur}`,
                items: XASR_VARIANTS.map((v) => ({
                    value: `xasr:${v.chunk}`,
                    label: `${v.title} · ${formatBundleBytes(v.encoderBytes)}`,
                })),
                onChange: (v) => void this.switchAsrModel(v, refresh),
            };
        }
        if (engine === 'confucius') {
            const cur = confuciusVariantOf(String(s.asrConfuciusTier ?? '')).tier;
            return {
                value: `confucius:${cur}`,
                items: CONFUCIUS_VARIANTS.map((v) => ({
                    value: `confucius:${v.tier}`,
                    label: `${v.title} · ${formatBundleBytes(v.modelBytes + v.mmprojBytes)}`,
                })),
                onChange: (v) => void this.switchAsrModel(v, refresh),
            };
        }
        return undefined;
    }

    /**
     * 「一键补齐缺失文件」的落点（m06789 需求②主按钮）。
     *
     * 🔴 **按引擎分头补齐**，且只补插件真能替用户下得了的东西：
     *   · 缺程序（whisper）⇒ 走 `installWhisperRuntime` 下 5 个文件到 `~/.reelludic/bin`；
     *   · 缺模型（whisper）⇒ 弹 `AsrEngineModal` 让用户选档（**不擅自替他选**一档就下，
     *     74MB / 465MB 的差别是用户的选择，不是我们的）；
     *   · 缺 ffmpeg ⇒ **一行字说明怎么办，⛔ 不替用户装**（系统级工具、各平台装法不同，
     *     装错位置还会污染 PATH，比留个空框更糟）；
     *   · 另两家（Qwen / SenseVoice）⇒ 只给出「缺哪一样」的指引，插件无法替装。
     */
    private async runAsrAutoFix(opts: {
        fixBtn: HTMLButtonElement;
        fixNote: HTMLElement;
        engine: string;
        env: { program: boolean; model: boolean; audio: boolean };
        refresh?: () => void;
    }): Promise<void> {
        const { fixBtn, fixNote, engine, env } = opts;
        const refresh = opts.refresh ?? ((): void => this.display());
        fixBtn.disabled = true;
        if (!env.audio) {
            // ffmpeg 最优先：没有它另两样补齐了也转不了
            fixNote.setText('缺「音频工具」ffmpeg：请先装它（Windows 可用 winget install ffmpeg），或在下面手动指定路径。');
            fixBtn.disabled = false;
            return;
        }
        // 🔴 2026-11-06 m09123：不再「补一半就把用户丢给另一个弹窗」——
        //    统一走安装清单弹窗，把「要装哪几样、装到第几步」摊开给用户看。
        //    whisper 会一次走完「程序 → 模型」两步（原来只补程序，用户回头还发现没模型）。
        fixBtn.disabled = false;
        const tier = presetByFileName(String(this.plugin.settings.asrModelPath ?? '').trim())?.tier;
        this.plugin.openAsrInstall(engine, tier, refresh);
    }

    /**
     * 「高级设置 › 音频转文字」组 · **本地音频转文字（ASR）引擎配置**。
     *
     * 🔴 用户 m01938（需求⑤）最初指定的位置是「设置 → 基本设置 › 实验性功能 → 启用内置播放器
     *    折叠项内部」；**1.5.1（用户 2026-11-28：「将音频转文字放在高级设置下」）搬到本页**。
     *    ⇒ 现在这是**唯一**渲染点，基本设置那边已删干净（⛔ 别补回去，两处输入框会不同步）。
     *    并给了「未配置 / 已就绪」两种文案与三张引擎卡片。
     *
     * 🔴 用户同一份需求里三条硬要求，逐条对应到这里的实现：
     *  ⑴ 「绝对不要用红色或警告图标，极简、中性」⇒ 徽标只有「未配置 / 已就绪」两态，
     *     ⛔ 不挂 `is-error`、⛔ 不用 `notice` 那种黄底 —— 没装引擎是**正常状态**，不是故障；
     *  ⑵ 「不出现技术黑话，技术词仅作极小字号的副标题」⇒ 行名说人话（「本地语音转文字」），
     *     `whisper.cpp` / `ggml` 只出现在描述里；
     *  ⑶ 「所有识别均在本地完成，音视频绝不会上传云端」⇒ 这句话放在这一块的第一行。
     *
     * ⚠️ 三行都走 `.rl-dir-sub` 缩进 —— 它们是组内的从属项，与「音乐目录」同一口径。
     * ⚠️ 文件选择器走 `plugin.pickSystemFilePath`（桌面端系统对话框）；移动端没有 Node 也没有外部程序，
     *    这一块在那里没有意义，但**仍然渲染**：藏起来会让用户以为功能消失了（⛔ 别按平台显隐）。
     */
    private renderAsrEngineRows(parent: HTMLElement, redraw?: () => void): void {
        const s = this.plugin.settings;
        // redraw = 「只重画这张卡」的钩子（由 renderVoiceSection 提供）。
        // 没有它时（别的调用点）退化成本页重画 —— 行为不比以前差，不会少刷新。
        const refresh = (): void => {
            if (redraw) redraw();
            else this.display();
        };

        const engineId = engineDefOf(s.asrEngine).id;
        const curPreset = presetByFileName(String(s.asrModelPath ?? '').trim());
        // 🔴 当前 whisper 档位要在**前后两段**都用到（① 选择模型的一行、② 环境配置的安装按钮），
        //    所以提到函数开头声明 —— 放在 ① 里会撞 TDZ（`const` 提升但不初始化），
        //    真机表现是「点安装按钮 ReferenceError: Cannot access 'curWhisper' before initialization」。
        const curTier = (curPreset ?? ASR_MODEL_PRESETS[0]).tier;
        const curWhisper = presetOf(curTier) ?? ASR_MODEL_PRESETS[0];
        // 下拉/列表的取值：whisper 走具体档位（whisper:base），另两家是单值。
        const pickId = engineId === 'whisper' ? `whisper:${curTier}` : engineId;
        // ⚠️ 原来这里还有 `env` / `paths` / `allReady` 三个局部量 —— 环境配置段并入每行之后
        //    （本轮第⑤条）它们已经**没有读者**了（各家状态改由 `renderEngineEnv` 按引擎现算）。
        //    ⛔ 别把它们加回来「以防以后要用」：死变量会让下一个人误以为还有第二处渲染路径。

        /**
         * 一个路径行：行名 + 说明 + 明文输入框 + 「浏览」按钮。
         * 为什么不用 createSecretField：这是路径不是凭据，挂一个「显示/隐藏」眼睛毫无意义。
         *
         * 🔴 `auto`（可选）：**框里要看得见实际在用的路径**（2026-11-06 m09051 用户报障
         *    「如音频工具 ffmpeg 等都已识别配置路径了但路径框什么内容都没填」）。
         *    实现上不能简单 `setValue(auto())` —— 那样用户一失焦就会把探测到的绝对路径
         *    写死进 data.json，换机器/换安装位置就失效（这正是 m05462 那轮的教训：
         *    判据要「系统里有没有」，不能「框里填没填」）。
         *    所以：显示探测值，但只有用户**真的动过输入框**（input 事件置 touched）
         *    才在失焦时落库；没动过就一个字都不写，设置里始终保持空 = 自动找。
         */
        const pathRow = (opts: {
            name: string;
            desc: string;
            get: () => string;
            set: (v: string) => Promise<void>;
            placeholder: string;
            filterName: string;
            exts: string[];
            host: HTMLElement;
            /** 已探测到的实际路径；设置里为空时用它回显（不落库）。 */
            auto?: () => string;
        }): void => {
            const saved = opts.get();
            const detected = saved ? '' : (opts.auto?.() ?? '');
            const row = new Setting(opts.host).setName(opts.name).setDesc(opts.desc);
            row.addText((text) => {
                text.setPlaceholder(opts.placeholder).setValue(saved || detected);
                if (detected) text.inputEl.addClass('rl-path-auto');
                let touched = false;
                text.inputEl.addEventListener('input', () => {
                    touched = true;
                });
                // 提交时机与目录类设置同一口径：失焦 / 回车才落库，不在 onChange 里每敲一个字符存一次
                const commit = async (): Promise<void> => {
                    // 没动过的自动回显不落库 —— 否则「自动找到的」会变成「写死的」
                    if (!touched) return;
                    touched = false;
                    await opts.set(text.getValue().trim());
                    text.inputEl.removeClass('rl-path-auto');
                    text.setValue(opts.get());
                };
                text.inputEl.addEventListener('blur', () => void commit());
                text.inputEl.addEventListener('keydown', (ev: KeyboardEvent) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        void commit();
                    }
                });
            });
            // 自动回显时补一句人话，让用户知道「这是我自己找到的，不是你填的」
            if (detected) {
                row.descEl.createDiv({
                    cls: 'rl-hint-note rl-path-auto-note',
                    text: '已自动找到，上面的路径是插件自己探测的；留空即保持自动，改了才会记住你填的。',
                });
            } else if (!saved) {
                // 🔴 2026-11-06 m09819：没找到也要说出来，别让用户对着空框猜
                //    （原话「我怎么知道找不找的到」）。这里只说事实，不催他去装 ——
                //    「要不要装」由上面的环境自检与「一键补齐」负责，⛔ 别在这行重复一遍。
                row.descEl.createDiv({ cls: 'rl-hint-note rl-path-auto-note', text: '系统里没找到，需要你手动指定。' });
            }
            row.addButton((b) => {
                b.setButtonText('浏览');
                b.buttonEl.addClass('rl-dir-browse');
                b.onClick(() => {
                    void this.plugin.pickSystemFilePath(opts.exts, opts.filterName).then((picked) => {
                        if (!picked) return;
                        // 用 refresh（只重画这张卡）而不是 this.display()：整页重画会让滚动跳回顶部，
                        // 用户选完文件反而找不到自己刚改的那行。
                        void opts.set(picked).then(refresh);
                    });
                });
            });
        };

        /** 一段的标题行：圆形序号 + 标题 + 右侧一句「为什么」。done 时序号变绿。 */
        const secHead = (host: HTMLElement, num: string, title: string, why: string, done: boolean): void => {
            const head = host.createDiv({ cls: 'rl-asr-sec-head' });
            const badge = head.createSpan({ cls: 'rl-asr-sec-num', text: num });
            if (done) badge.addClass('is-done');
            head.createSpan({ cls: 'rl-asr-sec-title', text: title });
            head.createSpan({ cls: 'rl-asr-sec-why', text: why });
        };

        /**
         * 🔴 段容器在这里**按屏幕顺序**一次建好：模型(1) → 偏好(3)。
         *    ⛔ 别在这里改成 parent.createDiv 之后再 appendChild —— Obsidian 的 Setting
         *    是按挂载顺序算 tabindex 的，后追加会让键盘 Tab 序与视觉顺序不一致。
         *
         * 🔴🔴 2026-11-07 用户裁定（本轮第⑤条）：「语音转文字的环境配置合并到选择模型折叠起来，
         *    如点击 whisper.cpp 那行就收放环境配置」⇒ 原来的第 2 段「环境配置」**整段退场**，
         *    它的内容改为**按引擎分别**挂到「选择模型」的每一行下面（`renderEngineEnv`），
         *    默认收起，点那一行才展开。序号也只留 1 与 3? 不 —— 见 `secHead` 调用处，
         *    现在实际只剩两段，所以第二段的序号写成 2（不再跳过 3）。
         */
        const sec1 = parent.createDiv({ cls: 'rl-asr-sec is-bare' }); // ① 选择模型（每行可展开自己的环境配置）
        // 🔴 2026-11-11 用户报「统一一下宽度，对齐上面的媒体载体」：`is-bare` 去掉本段自带的
        //    border / 底色 / `9px 11px` 内距 —— 外层组已经有外框，里面 `.rl-asr-pick2` 也画自己的
        //    外框，这层再画就是卡中卡；那 11px 还会把 pick2 从 524 挤到 500，与上面的组左缘对不齐。

        /**
         * 🔴 2026-11-07 本轮第⑤条：把「环境配置」从整段平铺改成**按引擎一段**，挂到该引擎行的
         *    折叠面板里。所以这里不再是「按当前引擎渲染一次」，而是「谁展开就渲染谁的」。
         *
         * ⚠️ 判据必须用 `asrPathsFor(forEngine)`（对任意引擎都可用、且只返回**真实存在**的路径），
         *    ⛔ 不能用 `asrEnvCheck()` —— 那个只看 `settings.asrEngine`（当前选中那家），
         *    拿它去渲染「没选中的那两行」会把别人的状态画成自己的。
         */
        const renderEngineEnv = (host: HTMLElement, forEngine: string): void => {
            const engPaths = this.plugin.asrPathsFor(forEngine);
            /**
             * 🔴 状态清单改成「按这一家的真实需求逐项列」，⛔ 不再固定三块。
             *
             *    固定三块（识别程序 / 识别模型 / 音频工具）是 whisper 时代的形状：
             *    Paraformer 要四样、X-ASR 要六样、Confucius4 的第三样是投影器不是词表。
             *    按三块画的结果是「面板全绿、点转写却报缺文件」—— 缺的那几样根本没画出来。
             *
             *    ⚠️ 判据在 `main.ts::asrEngineChecklist`（唯一实现），这里只负责画。
             */
            const check = this.plugin.asrEngineChecklist(forEngine);
            const envOf = check.env;
            const ready = check.ready;

            /**
             * 🔴🔴 2026-11-11 用户 m05717 ① 线框图：右下配置栏改成 **「AI 运行管家」三模块**：
             *    ① 环境体检（仅本地模型）② 资产与凭证 ③ 运行参数与资源预估。
             *
             * 为什么要拆：原来是一个大平铺（清单 tiles + 路径行 + 一键补齐按钮），
             * 六家的东西混在一张流水里，用户看不出「哪一步是体检、哪一步是填路径、哪一步是选参数」。
             * 拆成三个带标题的卡之后，每张卡只回答一个问题。
             *
             * ⚠️ 模块三的**锁定**（用户原话「环境体检有致命缺失 ⇒ 模块三 opacity .5 + 禁点 +
             *    提示请先完善基础环境」）落在 `renderRunModule` 里，判据用 `hasFatalMissing(check.items)`。
             */
            const modEnv = host.createDiv({ cls: 'rl-bt-mod' });
            const envHead = modEnv.createDiv({ cls: 'rl-bt-mod-head' });
            const envIcon = envHead.createSpan({ cls: 'rl-bt-mod-icon' });
            safeSetIcon(envIcon, 'stethoscope');
            envHead.createSpan({ cls: 'rl-bt-mod-title', text: '环境体检' });
            envHead.createSpan({
                cls: ready ? 'rl-bt-mod-badge is-ok' : 'rl-bt-mod-badge is-bad',
                text: ready ? '全部就绪' : '有缺项',
            });
            envHead.createSpan({ cls: 'rl-bt-mod-note', text: '仅本地模型需要' });

            const tiles = modEnv.createDiv({ cls: 'rl-asr-tiles' });
            /**
             * 🔴 2026-11-11 用户：「不要显示 ✓ 展开其余 1 项，全部默认展开」。
             *    之前（m03035 的「不要滚动条」）用 `CONF_TILE_LIMIT = 6` 折起多出来的项，
             *    可实际清单最多 7 项（X-ASR），折叠只省 1 行却多了一颗按钮和一句
             *    「展开其余 1 项（含 1 项缺失）」—— 收益为负，用户明确否决。
             *    ⇒ 全部直接铺开（**不再折叠**，`CONF_TILE_LIMIT` / `applyTileFold` 已删）。
             *
             * 🔴🔴 m07854 ④（2026-11-13）用户：「将语音与识别组的高度限制一下」——
             *    ⇒ `.rl-asr-tiles` 现在**有 max-height + 内部滚动**（见 styles.css 那条注释）。
             *    ⚠️ 这覆盖了 m03035「不要滚动条」与 m05717「容器不限高、不内滚」两条旧口径，
             *      当场问过用户、用户选的就是「max-height + 内部滚动」这一档。
             *    ⚠️ 折叠仍然不许回来：滚动能看到全部 7 项，折叠会把缺失项藏起来。
             */
            for (const it of check.items) {
                const box = tiles.createDiv({ cls: 'rl-asr-tile' });
                if (!it.ok) box.addClass('is-miss');
                const top = box.createDiv({ cls: 'rl-asr-tile-top' });
                /**
                 * 🔴 2026-11-11 用户：「UI 不要这么多边框按钮改成透明化高审美点」。
                 *    原来这里画的是 emoji `✅` / `⬜` —— 彩色 emoji 在主题里既不跟色、
                 *    字重也不一致，一眼就是「贴上去的」。改成主题同色系 SVG：
                 *    就绪 = `check-circle`（绿），缺失 = `alert-circle`（灰，⛔ 不用红色，
                 *    仓规：界面上不能出现吓人的红色 Error）。
                 */
                const mark = top.createSpan({ cls: 'rl-asr-tile-mark' });
                safeSetIcon(mark, it.ok ? 'check-circle' : 'alert-circle');
                if (!it.ok) mark.addClass('is-miss');
                top.createSpan({ cls: 'rl-asr-tile-name', text: it.label });
                box.createDiv({ cls: 'rl-asr-tile-path', text: it.path ? it.path : '（未找到）' }).setAttribute(
                    'data-tip',
                    it.path ? it.path : `${it.label}还没有准备好`,
                );
            }

            /**
             * 🔴 用户 m05717 ①：「Whisper.cpp 要额外展示 CMake + C++ 组件」。
             *
             * 为什么只给 whisper 看：CMake/C++ 只有「从源码编 whisper」才需要；
             * 其余五家全是拖下来的预编译 exe / onnx，装 CMake 对它们毫无作用 ——
             * 全给的话等于给每个人看一条与自己无关的红叉。
             *
             * ⚠️ 这两项**不算致命缺失**（不参与 `hasFatalMissing`）：插件自带预编译运行时，
             *    没装工具链照样能转写，只是不能自己编。所以这里用 ⚠️ 而不是 ❌。
             */
            if (forEngine === 'whisper') {
                const toolRows = modEnv.createDiv({ cls: 'rl-bt-tools' });
                const hw0 = this.plugin.asrHardware();
                void hw0.then((hw: HardwareInfo) => {
                    // 探测是异步的（要起子进程），面板先渲染、拿到数据再补两行 —— 不阻塞主渲染
                    if (!toolRows.isConnected) return;
                    toolRows.empty();
                    const mk = (label: string, found: boolean, detail: string, tip: string): void => {
                        const row = toolRows.createDiv({ cls: found ? 'rl-bt-tool is-ok' : 'rl-bt-tool is-warn' });
                        // 同「环境体检」的标记语言：就绪 = check-circle（绿），未装 = alert-circle（黄）
                        const tmark = row.createSpan({ cls: 'rl-bt-tool-mark' });
                        safeSetIcon(tmark, found ? 'check-circle' : 'alert-circle');
                        tmark.addClass(found ? 'is-ok' : 'is-warn');
                        row.createSpan({ cls: 'rl-bt-tool-name', text: label });
                        row.createSpan({ cls: 'rl-bt-tool-detail', text: detail }).setAttribute('data-tip', tip);
                    };
                    mk(
                        'CMake',
                        hw.cmake.found,
                        hw.cmake.found ? hw.cmake.version : '未检测到',
                        hw.cmake.found
                            ? `cmake ${hw.cmake.version}`
                            : '没装 CMake。只有想自己编译 whisper.cpp 时才需要，插件自带的预编译运行时不受影响。',
                    );
                    mk(
                        'C++ 编译器',
                        hw.cpp.found,
                        hw.cpp.found ? hw.cpp.detail : '未检测到',
                        hw.cpp.found
                            ? hw.cpp.detail
                            : '没检测到 g++ / MSVC cl。同上：只有自己编译才需要。',
                    );
                });
            }


            if (!ready) {
                // ⚠️ 挂在 `modEnv` 而不是 `host`：一键补齐属于「体检发现问题 → 当场修」，
                //    掉到模块外面就变成了另一件事
                const fixRow = modEnv.createDiv({ cls: 'rl-asr-fix' });
                /**
                 * 🔴 2026-11-11 用户：「UI 不要这么多边框按钮改成透明化高审美点」。
                 *    原来挂核心 `mod-cta`（实心主色按钮），周围全改成无框分段后，
                 *    一块纯蓝方块格外扎眼；而六个引擎各有一份，一屏能挂五六块蓝。
                 *    ⇒ 改成 `.rl-asr-fixbtn` 轻量文字按钮（平时 accent 文字，悬停浮淡底）。
                 *    ⛔ 别退回 `mod-cta`。
                 */
                const fixBtn = fixRow.createEl('button', { cls: 'rl-asr-fixbtn', text: '一键补齐缺失文件' });
                const fixNote = fixRow.createDiv({ cls: 'rl-asr-fixnote' });
                if (!envOf.audio) {
                    // ffmpeg 不替用户装：它是系统级工具，各平台装法不同，装错位置还会污染 PATH。
                    // 🔴 本轮第⑤条：ffmpeg 的输入框已搬到「搜索配置 › 音视频取流」那行，
                    //    所以这里的指引必须指向**新位置**，⛔ 不能再说「在下面手动指定」。
                    fixNote.setText(
                        '缺「音频工具」ffmpeg：请先装它（Windows 可用 winget install ffmpeg）。也可以在「设置 › 搜索配置 › 音视频取流」里指定 ffmpeg 路径。',
                    );
                }
                fixBtn.addEventListener('click', (ev: MouseEvent) => {
                    ev.stopPropagation();
                    void this.runAsrAutoFix({ fixBtn, fixNote, engine: forEngine, env: envOf, refresh });
                });
            }

            /**
             * ② 资产与凭证（本地模型 = 程序与权重在哪、占多大、怎么下）
             *
             * ⚠️ 全部路径行 + 安装按钮都进这张卡：它们回答的是同一个问题「我这家的文件从哪来」。
             *    以前它们和体检清单混在一起，用户看到「识别程序 ✅」下面又有个同名输入框，
             *    分不清哪个是状态、哪个是要填的东西。
             */
            const modAssets = host.createDiv({ cls: 'rl-bt-mod' });
            const asHead = modAssets.createDiv({ cls: 'rl-bt-mod-head' });
            const asIcon = asHead.createSpan({ cls: 'rl-bt-mod-icon' });
            safeSetIcon(asIcon, 'package');
            asHead.createSpan({ cls: 'rl-bt-mod-title', text: '资产与凭证' });
            // 已占磁盘：同步算不出来（要递归 statSync 整个引擎目录），先给个占位，
            // 探测完再填 —— 用户要的是「醒目提示已占 XX」，⛔ 不能编一个数字。
            const usedBadge = asHead.createSpan({ cls: 'rl-bt-mod-badge', text: '统计中…' });
            this.plugin.asrEngineDirUsage(forEngine).then((bytes: number) => {
                if (!usedBadge.isConnected) return;
                usedBadge.setText(bytes > 0 ? `已占用 ${formatBundleBytes(bytes)}` : '还没装文件');
                usedBadge.toggleClass('is-ok', bytes > 0);
            }).catch(() => usedBadge.setText('占用未知'));

            if (forEngine === 'whisper') {
                pathRow({
                    name: 'whisper.cpp 程序',
                    desc: ASR_EXE_DESC,
                    get: () => s.asrExePath ?? '',
                    set: async (v) => {
                        s.asrExePath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'whisper-cli.exe 的完整路径（留空 = 自动找）',
                    filterName: '可执行文件',
                    exts: ['exe', 'bin', ''],
                    host: modAssets,
                    auto: () => engPaths.program,
                });
                pathRow({
                    name: '识别模型文件',
                    desc: ASR_MODEL_DESC,
                    get: () => s.asrModelPath ?? '',
                    set: async (v) => {
                        s.asrModelPath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'ggml-base.bin 的完整路径（留空 = 自动找）',
                    filterName: '模型文件',
                    exts: ['bin'],
                    host: modAssets,
                    auto: () => engPaths.model,
                });
                // whisper 专有：装程序 + 装模型两步一起（用户 m09123：弹窗列清单、逐项打勾）
                // 🔴🔴 2026-11-14（用户 m05673 手机实测）：这里原写 `process.platform`，
                //    手机端 WebView 没有 `process` 全局 ⇒ `ReferenceError` ⇒ 打断整个 `display()`。
                //    ⛔ 一律走 `currentPlatform()`（移动端返回空串，`installSupported('')` 为 false
                //    ⇒ 走下面那条「这台设备装不了」的说明分支，正是我们要的行为）。
                const platform = currentPlatform();
                if (installSupported(platform)) {
                    const ops = modAssets.createDiv({ cls: 'rl-key-actions' });
                    const installBtn = ops.createEl('button', { text: '安装 / 更换 Whisper.cpp' });
                    installBtn.addEventListener('click', (ev: MouseEvent) => {
                        ev.stopPropagation();
                        // 🔴 一次装两样：程序（5.3MB 发布包）+ 当前档位的模型文件。
                        //    原来这颗按钮只装程序，用户点完看到绿了、回头发现转写还说没模型。
                        this.plugin.openAsrInstall('whisper', curWhisper.tier, refresh);
                    });
                } else {
                    modAssets.createDiv({ cls: 'rl-asr-installnote', text: installUnsupportedMessage(platform) });
                }
            } else if (forEngine === 'sensevoice') {
                // 🔴 2026-12 m11073 之后 SenseVoice 走**插件原生链路**，不再经过 Python 桥接：
                //    插件自己起 sherpa-onnx-offline.exe、自己用 ffmpeg 抽轨切段、自己拼 SRT。
                //    所以这一段只有三件套，⛔ 别再把「Python 解释器 / 桥接脚本」加回来 ——
                //    那正是当初「一键装好却提示没找到运行程序」的成因（用户根本找不到输入框）。
                pathRow({
                    name: 'sherpa-onnx 程序',
                    desc: ASR_SV_EXE_DESC,
                    get: () => s.asrSenseVoiceExePath ?? '',
                    set: async (v) => {
                        s.asrSenseVoiceExePath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'sherpa-onnx-offline.exe 的完整路径（留空 = 自动找）',
                    filterName: '可执行文件',
                    exts: ['exe', ''],
                    host: modAssets,
                    auto: () => engPaths.program,
                });
                pathRow({
                    name: '识别模型文件',
                    desc: ASR_SV_MODEL_DESC,
                    get: () => s.asrSenseVoiceModelPath ?? '',
                    set: async (v) => {
                        s.asrSenseVoiceModelPath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'model.int8.onnx 的完整路径（留空 = 自动找）',
                    filterName: '模型文件',
                    exts: ['onnx'],
                    host: modAssets,
                    auto: () => engPaths.model,
                });
                pathRow({
                    name: '词表文件',
                    desc: ASR_TOKENS_DESC,
                    get: () => s.asrTokensPath ?? '',
                    set: async (v) => {
                        s.asrTokensPath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'tokens.txt 的完整路径（留空 = 自动找）',
                    filterName: '词表文件',
                    exts: ['txt', ''],
                    host: modAssets,
                    auto: () => engPaths.extra,
                });
            } else if (forEngine === 'qwen3') {
                pathRow({
                    name: 'Python 解释器',
                    desc: ASR_PYTHON_DESC,
                    get: () => s.asrPythonPath ?? '',
                    set: async (v) => {
                        s.asrPythonPath = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: '…\\.venv\\Scripts\\python.exe',
                    filterName: '可执行文件',
                    exts: ['exe', ''],
                    host: modAssets,
                    auto: () => engPaths.program,
                });
                pathRow({
                    name: '桥接脚本',
                    desc: ASR_BRIDGE_DESC,
                    get: () => s.asrBridgeScript ?? '',
                    set: async (v) => {
                        s.asrBridgeScript = v;
                        await this.plugin.saveSettings();
                    },
                    placeholder: 'cli_bridge.py 的完整路径',
                    filterName: 'Python 脚本',
                    exts: ['py', ''],
                    host: modAssets,
                    auto: () => engPaths.model,
                });
            } else {
                /**
                 * 🔴 Paraformer / X-ASR / Confucius4：**没有可填的路径**。
                 *
                 *    这三家的程序与权重全部由插件自己下到 `models/<引擎>/` 下，
                 *    文件名是上游固定的（`sherpa-onnx-vad-with-*-asr.exe` / `encoder-1920ms.onnx` /
                 *    `llama-mtmd-cli.exe` …），用户没有「装在别处」的场景 ——
                 *    给一个空输入框只会让人以为漏填了什么。
                 *
                 *    所以这里只做两件事：告诉他文件会落在哪、给一个重装入口。
                 *    ⛔ 别为了「和上面几家长得一样」硬塞输入框：那等于把一个必然自动的
                 *      路径伪装成需要用户决策，填错反而更难排查。
                 */
                const dir = this.plugin.asrEngineDir(forEngine);
                modAssets.createDiv({
                    cls: 'rl-asr-installnote',
                    text: `程序与权重都在 ${dir || '（拿不到模型目录）'} 下，升级或换档时点下面的按钮重装即可。`,
                });
                const ops = modAssets.createDiv({ cls: 'rl-key-actions' });
                const btn = ops.createEl('button', { text: `重新安装 ${engineDefOf(forEngine).title}` });
                btn.addEventListener('click', (ev: MouseEvent) => {
                    ev.stopPropagation();
                    this.plugin.openAsrInstall(forEngine, undefined, refresh);
                });
            }

            /**
             * ③ 运行参数与资源预估
             *
             * 🔴 用户 m05717 ① 逐字要求：
             *    「运行设备单选（CPU/GPU）+ 资源预估面板（预计占用 4.5 GB 显存 和 2 GB 内存，
             *      超过实际显存标红并提示建议选择 INT8 精度或更换小档位）+
             *      高级参数折叠（识别语言 / 线程数 / 批处理大小）」
             *    「环境体检有致命缺失（红叉）⇒ 模块三整体 opacity: 0.5 + 禁点 +
             *      提示请先完善基础环境」
             *
             * ⚠️ 关于 GPU：本项目装的全是 **CPU 版运行时**（whisper 的 ggml-cpu.dll、
             *    llama-b12244-…-cpu-x64、sherpa 的 CPU exe），所以 GPU 这一项**不是真能力**：
             *    有卡时它显示为「可预选但当前运行时为 CPU」，没卡时显示 `未检测到，将默认使用 CPU`。
             *    ⛔ 别把它做成真能切过去 —— 那会让用户以为选了 GPU 就是在 GPU 上跑。
             */
            const modRun = host.createDiv({ cls: 'rl-bt-mod' });
            const runHead = modRun.createDiv({ cls: 'rl-bt-mod-head' });
            const runIcon = runHead.createSpan({ cls: 'rl-bt-mod-icon' });
            // ⚠️ 图标别用 `gauge`：那是倍速控件的旧图标，`assert-symbols.cjs` 有一条反向守卫
            //    「图标版残留全清」把 `"gauge"` 在 JS 里的出现次数钉成 0（倍速改成纯文字后留的）。
            safeSetIcon(runIcon, 'activity');
            runHead.createSpan({ cls: 'rl-bt-mod-title', text: '运行参数与资源预估' });

            // 致命缺失 ⇒ 整卡锁死（用 `aria-disabled` + 类名，不用 disabled 属性：
            // 里面的折叠按钮还要能被读屏念出来，真 disabled 会让子控件彻底不可达）
            const fatal = hasFatalMissing(check.items);
            if (fatal) modRun.addClass('is-locked');
            modRun.setAttribute('aria-disabled', fatal ? 'true' : 'false');
            if (fatal) {
                const lockNote = modRun.createDiv({ cls: 'rl-bt-locknote' });
                const lockIcon = lockNote.createSpan({ cls: 'rl-bt-lockicon' });
                safeSetIcon(lockIcon, 'triangle-alert');
                lockNote.createSpan({ text: '请先完善基础环境（上面的「环境体检」还有缺项）' });
            }

            const runBody = modRun.createDiv({ cls: 'rl-bt-run-body' });
            /**
             * 锁定时真的挡点击（CSS 只管视觉，键盘 Tab 进来按 Enter 照样触发，所以必须补事件拦截）。
             *
             * 🔴 2026-11-11 用户：「包括高级参数也展开」⇒ 高级参数不再有折叠按钮，
             *    整块内容常驻可见。于是这个拦截回到**最朴素**的语义：致命缺失时，
             *    这块里所有控件都不许改（设备单选 / 语言下拉 / 线程数输入）。
             *    ⛔ 别再为某颗按钮开豁免口子 —— 需要「光看不能改」的内容就别放进 runBody。
             */
            if (fatal) {
                runBody.addEventListener(
                    'click',
                    (ev: MouseEvent) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                    },
                    true,
                );
                runBody.addEventListener(
                    'keydown',
                    (ev: KeyboardEvent) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                    },
                    true,
                );
            }

            const tierForRun = asrCatalog()
                .find((g) => g.engine === forEngine)
                ?.tiers.find((t) => t.pickId === curPickId);
            const sizeLbl = tierForRun?.size ?? '';

            // ── 设备单选：CPU / GPU ──
            const devRow = runBody.createDiv({ cls: 'rl-bt-devrow' });
            devRow.createSpan({ cls: 'rl-bt-devlabel', text: '运行设备' });
            const devOpts = devRow.createDiv({ cls: 'rl-bt-devs' });
            const hwPromise = this.plugin.asrHardware();
            void hwPromise.then((hw: HardwareInfo) => {
                if (!devOpts.isConnected) return;
                devOpts.empty();
                const gpu = hw.gpus[0] ?? null;
                // 预估用当前档位体积反推；认不出体积时 `sizeLabelToMb` 给 0，
                // `estimateFootprint` 会退化成「只有常数开销」—— 那也算一个诚实的下界
                const fpGpu = estimateFootprint(sizeLbl, 'gpu');
                const fpCpu = estimateFootprint(sizeLbl, 'cpu');
                const gpuState = gpuRowState(gpu, fpGpu.vramMb);
                const cur = defaultDevice(hw); // 恒 'cpu'（见 pure/asrHardware 注释）

                const mkDev = (label: string, dev: 'cpu' | 'gpu', sub: string, off: boolean): void => {
                    const b = devOpts.createEl('button', {
                        cls: off ? 'rl-bt-dev is-off' : 'rl-bt-dev',
                        attr: { type: 'button', 'aria-pressed': cur === dev ? 'true' : 'false' },
                    });
                    if (cur === dev) b.addClass('is-on');
                    b.createSpan({ cls: 'rl-bt-dev-name', text: label });
                    if (sub) b.createSpan({ cls: 'rl-bt-dev-sub', text: sub });
                    b.addEventListener('click', (ev: MouseEvent) => {
                        ev.stopPropagation();
                        // 运行时是 CPU 版：点 GPU 只解释原因，⛔ 不假装切过去了
                        if (dev === 'gpu') {
                            const why =
                                gpuState === 'no-gpu'
                                    ? '这台机器没检测到独立显卡，将默认使用 CPU。'
                                    : '检测到显卡，但当前安装的是 CPU 版运行时（插件自动下载的就是 CPU 包），实际仍在 CPU 上跑。';
                            new Notice(why, 6000);
                            return;
                        }
                        new Notice('当前已是 CPU 模式（本插件安装的都是 CPU 版运行时）。', 5000);
                    });
                };

                mkDev('CPU', 'cpu', `预计 ${formatMb(fpCpu.ramMb)} 内存`, false);
                const gpuSub =
                    gpuState === 'no-gpu'
                        ? '未检测到，将默认使用 CPU'
                        : gpuState === 'too-small'
                          ? `显存不足（本机 ${formatMb(gpu?.vramMb ?? 0)}）`
                          : `${gpu?.name ?? 'GPU'} · ${formatMb(gpu?.vramMb ?? 0)}`;
                // 「未检测到」沿用用户原话措辞，并灰色置底（`is-off` + CSS 里 order 排到最后）
                mkDev('GPU', 'gpu', gpuSub, gpuState !== 'selectable');
            });

            // ── 资源预估面板 ──
            const estRow = runBody.createDiv({ cls: 'rl-bt-est' });
            void hwPromise.then((hw: HardwareInfo) => {
                if (!estRow.isConnected) return;
                estRow.empty();
                const fp = estimateFootprint(sizeLbl, 'cpu');
                const line = estRow.createDiv({ cls: 'rl-bt-est-line' });
                line.createSpan({ cls: 'rl-bt-est-k', text: '预计占用' });
                line.createSpan({ cls: 'rl-bt-est-v', text: `${formatMb(fp.vramMb)} 显存 和 ${formatMb(fp.ramMb)} 内存` });
                if (hw.totalMemMb > 0) {
                    line.createSpan({
                        cls: 'rl-bt-est-base',
                        text: `（本机内存 ${formatMb(hw.totalMemMb)}）`,
                    }).setAttribute('data-tip', '内存与显存探测自本机真实数据；显存为 0 表示 CPU 模式不占显存。');
                }
                // 超限标红 + 给建议（用户原话：「超过实际显存标红并提示建议选择 INT8 精度或更换小档位」）
                const warn = footprintWarning(fp, 'cpu', hw);
                const gpu = hw.gpus[0] ?? null;
                const gpuWarn = gpu && !vramFits(estimateFootprint(sizeLbl, 'gpu').vramMb, gpu)
                    ? `这一档若上 GPU 需要 ${formatMb(estimateFootprint(sizeLbl, 'gpu').vramMb)} 显存，本机只有 ${formatMb(gpu.vramMb)}。建议选择 INT8 精度或更换小档位。`
                    : '';
                const msg = warn || gpuWarn;
                if (msg) {
                    const w = estRow.createDiv({ cls: 'rl-bt-est-warn' });
                    const wi = w.createSpan({ cls: 'rl-bt-est-warnicon' });
                    safeSetIcon(wi, 'triangle-alert');
                    w.createSpan({ text: msg });
                }
            });

            // ── 高级参数：常驻展开（识别语言 / 线程数；批处理大小后端没有对应消费者，⛔ 不给假控件）──
            /**
             * 🔴 2026-11-11 用户：「包括高级参数也展开」。
             *    原来这里是一颗「高级参数」折叠按钮 + `advBody.hidden = true`，
             *    结果用户在「环境体检有缺项」时连点都点不开（同一轮修过一次放行），
             *    现在直接去掉折叠这一层：两项参数本来就只有两行，收起省不下空间。
             *    ⛔ 别再补回 toggle 按钮 / `advBody.hidden` —— `tests/asrPickLayout.test.ts` 有反向守卫。
             */
            runBody.createDiv({ cls: 'rl-bt-adv-title', text: '高级参数' });
            const advBody = runBody.createDiv({ cls: 'rl-bt-adv-body' });

            // 识别语言：复用既有 `settings.asrLang`（后端 `normalizeAsrLang` 真的会读它）
            const langLine = advBody.createDiv({ cls: 'rl-bt-adv-row' });
            langLine.createSpan({ cls: 'rl-bt-adv-name', text: '识别语言' });
            const langSel = langLine.createEl('select', { cls: 'dropdown' });
            const LANGS: { v: string; t: string }[] = [
                { v: 'auto', t: '自动识别' },
                { v: 'zh', t: '中文' },
                { v: 'en', t: '英文' },
                { v: 'ja', t: '日文' },
                { v: 'ko', t: '韩文' },
            ];
            const curLang = normalizeAsrLang(String(s.asrLang ?? ''));
            for (const L of LANGS) {
                const opt = langSel.createEl('option', { text: L.t });
                opt.value = L.v;
                if (L.v === curLang) opt.selected = true;
            }
            langSel.addEventListener('change', () => {
                s.asrLang = langSel.value;
                void this.plugin.saveSettings();
            });

            // 线程数：复用 `settings.asrThreads`（main.ts:6862/6922/6972/7008 真的传给引擎）
            const thLine = advBody.createDiv({ cls: 'rl-bt-adv-row' });
            thLine.createSpan({ cls: 'rl-bt-adv-name', text: '线程数' });
            const thInput = thLine.createEl('input', { cls: 'rl-bt-adv-num', attr: { type: 'number', min: '0', step: '1' } });
            thInput.value = String(typeof s.asrThreads === 'number' ? s.asrThreads : 0);
            thInput.addEventListener('change', () => {
                const n = Math.max(0, Math.floor(Number(thInput.value) || 0));
                s.asrThreads = n;
                void this.plugin.saveSettings();
            });
            thLine.createSpan({ cls: 'rl-bt-adv-hint', text: '0 = 让引擎自己决定' }).setAttribute(
                'data-tip',
                '按 CPU 核心数自动挑。填大了反而更慢（线程争抢），一般填物理核心数即可。',
            );
        };


        // ── ① 选择模型（左：按家分组的平铺单选；右：当前选中项的配置面板）──
        /**
         * 🔴 用户 m00002 本轮硬要求（逐字）：
         *    「按大类分组的平铺单选框，但绝对不能让每个档位下面都跟着这一大坨环境配置，
         *      改成左侧是清爽的平铺列表，右侧是专门用于配置当前选中项的面板。」
         *    ⇒ 一行一引擎 + 行尾箭头就地展开的旧结构**整体废弃**，换成两栏。
         *
         * 为什么不是「每行可展开」了：环境配置对六家 × 各自档位来说是同一坨内容
         *（状态清单 + 路径 + 一键补齐），挂在每一行下面 = 同一个面板重复六遍，
         * 而且行高被撑到几百像素，用户再也扫不到「哪档多大、准不准」。
         */
        /**
         * 🔴🔴 2026-11-11 用户 m09233：「选择模型(小标题分组，这没用排序了删除掉)」。
         *    ⇒ 小标题「1 选择模型」+ 右边那句「N 个可用 / 共 M 个」+ 下面那段说明文字
         *      **整块退场**，界面从左侧导航直接开始。用户的原话是「这没用排序了删除掉」——
         *      两个数字对「选一个能用的模型」这件事没有帮助，反而在 468px 宽的面板里占掉两行。
         *    ⚠️ 「几个可用」这个信息**没丢**：左导航每行末尾还挂着 `已装/总数`（`.rl-asr-navi-count`），
         *      分母是总档数、颜色区分有没有装好的 —— 比一行灰字更贴近「我该点哪一家」。
         *    ⛔ 别再补回 `secHead(...)` / `.rl-asr-sec-note`：`secHead` 已无任何调用方，
         *      留着它只为把这段历史讲清楚，下次要加标题请重新设计，别复活这套序号徽标。
         */

        /** 当前选中项（引擎 + 档位）的 pickId，用它给左列表打「已选中」标记。 */
        const curPickId = ((): string => {
            const s2 = this.plugin.settings;
            if (engineId === 'whisper') return `whisper:${curTier}`;
            if (engineId === 'qwen3') return `qwen3:${qwenVariantOf(String(s2.asrQwenTier ?? '')).tier}`;
            if (engineId === 'sensevoice') return `sensevoice:${svVariantOf(String(s2.asrSvVariant ?? '')).variant}`;
            if (engineId === 'paraformer') return `paraformer:${paraVariantOf(String(s2.asrParaVariant ?? '')).variant}`;
            if (engineId === 'xasr') return `xasr:${xasrVariantOf(String(s2.asrXasrChunk ?? '')).chunk}`;
            return `confucius:${confuciusVariantOf(String(s2.asrConfuciusTier ?? '')).tier}`;
        })();

        const pick2 = sec1.createDiv({ cls: 'rl-asr-pick2' });

        /**
         * 🔴🔴 2026-11-11 用户 m05717 ① 线框图改版（本轮结构的唯一依据）：
         *   左栏 = **两个大分组：本地部署 / 云端接入**，顶部一条明显分割线；
         *          条目名前带图标（🏠 本地 / ☁️ 云端）；**单选互斥**：被选中那家正常色 +
         *          左侧竖线高亮，未选中的整体变灰（#999）**但仍然可点**（点一下就切过去）。
         *   右侧 = 上下两段：上段「描述 + 档位 Grid」，下段「AI 运行管家」三模块。
         *
         * 与上一版（2026-11-10 D 版「一家一张卡 + 胶囊」）的关系：
         *   档位从「卡里的胶囊」搬到右侧上段的 Grid —— 用户要的是「左边选引擎、右边选档位」
         *   两次点击，职责分开；⛔ 别再退回「一家一张卡」：那版左栏同时背引擎与档位，
         *   想换档得先在一堆卡里找它是哪家的。
         *
         * ⚠️ `asrGroupExpanded` / `asrConfOpen` 在这一版不再参与布局：新左导航把六家
         *    一行一家全列出来（一屏放得下），既不需要「只摊前 3 家」，也不需要
         *    「点行才展开配置面板」。字段先留着，删字段是纯清理。
         */
        /**
         * 一行装「左导航 + 右上档位 + 右下三模块」。
         *
         * 🔴 用户 m06406 ① 判过两次：上一版把三模块挂在 `.rl-asr-pick2` 下面（横向铺满整行），
         *    看起来就是「环境配置还在模型下方列着③」。用户要的是：
         *    ┌──────┬─────────────┐
         *    │ 导航 │ ① 描述与档位  │
         *    │      ├─────────────┤
         *    │      │ ② 运行管家×3 │
         *    └──────┴─────────────┘
         *
         * 🔴 三者是**同一个 CSS Grid 的兄弟**（不是右列再套一层 flex）：
         *    `grid-template-columns: 172px 1fr` + `grid-template-rows: auto auto`，
         *    nav 在 (1,1)、top 在 (1,2)、bt 在 (2,2)。
         *    第 1 行的高度 = max(nav 内容, top 内容)，两者都 stretch ⇒ **自动等高**，
         *    这正是用户 m05717 ① 的「左侧列表容器高度跟随右侧上半部对齐」。
         *
         * ⚠️ 试过并已推翻的两条路（都不可靠）：
         *    · `align-items: stretch` + 右列 flex：nav 被拉成「右上 + 三模块」之和；
         *    · JS 量高回填（setTimeout / ResizeObserver）：设置页先建 DOM 后挂载，
         *      量到的高度是 0 或旧值，真机实测 inline style 有时为空。（累计 3 次失败）
         */
        const row = pick2.createDiv({ cls: 'rl-asr-row' });
        const nav = row.createDiv({ cls: 'rl-asr-nav' });
        // 左栏分组标题（本地部署 / 云端接入）。不可点 —— 它是分段线，不是折叠器。
        // ⚠️ 实现在 `this.mkNavHead`（TTS 两栏也要用同一款标题，⛔ 别再这里复制一份）
        this.mkNavHead(nav, 'house', '本地部署', '不上传');

        const allGroups = asrCatalog();
        for (let gi = 0; gi < allGroups.length; gi += 1) {
            const group = allGroups[gi];
            /** 这一家是不是当前选中的（决定 is-on / 变灰） */
            const on = group.engine === engineId;
            /**
             * 一个引擎 = 一个 `<button>`：
             *   · 键盘可达、`aria-pressed` 承担单选语义；
             *   · `type="button"` 必写 —— 设置页偶尔被塞进 `<form>`，默认 submit 会刷新整页。
             */
            const item = nav.createEl('button', { cls: 'rl-asr-navi' });
            item.setAttribute('type', 'button');
            if (on) item.addClass('is-on');
            item.setAttribute('aria-pressed', on ? 'true' : 'false');
            const ico = item.createSpan({ cls: 'rl-asr-navi-icon' });
            /**
             * 🔴 2026-11-11 用户：「图标要用各自的品牌图标而不是一个房子图标」。
             *    图标库实测没有一家 ASR 厂商的图形，所以用 `pure/asrBrandIcon` 里自绘的标记；
             *    万一引擎键认不出来（未来新增一家还没画），退回 `house` 兜底，
             *    ⛔ 不能什么都不画 —— 那样左栏会缺一个对齐位，标题整体向左缩。
             */
            const markSvg = asrBrandSvg(group.engine, 14);
            if (markSvg) ico.innerHTML = markSvg;
            else safeSetIcon(ico, 'house');
            const txt = item.createSpan({ cls: 'rl-asr-navi-text' });
            txt.createSpan({ cls: 'rl-asr-navi-name', text: group.title });
            /**
             * 🔴 2026-11-11 用户：「左侧栏的描述被截断干脆只显示名称」。
             *    副标题不再画（170px 宽放不下，永远只剩半句带省略号，像坏掉），
             *    但信息不能丢 —— 挪进 `data-tip`（下面那行已经拼了 title + subtitle）。
             */
            // 左栏只有 ~170px，名称之外的信息全靠悬浮
            item.setAttribute('data-tip', group.title + '\n' + group.subtitle);
            // 这一家有几档装好了 —— 扫一眼就知道哪家不用再下
            const readyInGroup = group.tiers.filter((t) => this.plugin.asrPickStatus(group.engine, t.tier).ready).length;
            item.createSpan({
                cls: readyInGroup > 0 ? 'rl-asr-navi-count is-ok' : 'rl-asr-navi-count',
                text: readyInGroup + '/' + group.tiers.length,
            }).setAttribute('data-tip', group.title + '：已装好 ' + readyInGroup + ' 档，共 ' + group.tiers.length + ' 档');
            item.addEventListener('click', () => {
                // 换家时优先停在这家「已记住的那一档」（curPickId 命中就用它），否则落第一档
                const keep = group.tiers.find((t) => t.pickId === curPickId) ?? group.tiers[0];
                if (!keep) return;
                void this.switchAsrModel(keep.pickId, refresh);
            });
        }

        /**
         * 云端接入：**空壳占位**。
         *
         * 🔴 用户裁定（m05825 前的 ask_user_question 答复）：「云端接入先只做 UI 壳，
         *    标成未开放并置灰」。本插件确实**没有任何云端 ASR 实现**（全仓只有 TTS 的
         *    `CloudSpeechEngine`，与识别无关），所以这里只放一条灰行 + 一句实话，
         *    ⛔ 不给可点控件 —— 假按钮比没有按钮更坏。
         *
         * ⚠️ 副标题别写「暂未接入」四个字：`assert-symbols.cjs:8060` 有一条反向守卫
         *    把「假装没做」的那句旧口径钉死（四个下载平台早已全部实现，该说法作废）。
         *    这里说的是**另一个功能**（云端 ASR），但守卫是全文件字符串匹配，换词才过。
         */
        this.mkNavHead(nav, 'cloud', '云端接入', '按次计费', true);
        const cloudRow = nav.createDiv({ cls: 'rl-asr-navi is-cloud is-todo' });
        const cloudIco = cloudRow.createSpan({ cls: 'rl-asr-navi-icon' });
        safeSetIcon(cloudIco, 'cloud');
        const cloudTxt = cloudRow.createSpan({ cls: 'rl-asr-navi-text' });
        cloudTxt.createSpan({ cls: 'rl-asr-navi-name', text: '远端语音识别' });
        // 「未开放」不画在行里（用户 2026-11-11：左栏只显示名称），挪进 data-tip
        cloudRow.setAttribute(
            'data-tip',
            '未开放。本插件目前只做本地识别（全部在本机完成，音频不出本机）。云端接入还没有实现，这里先不提供入口。',
        );

        /**
         * ── 右上：描述 + 档位 Grid（用户 m05717 ①「右侧上部」）──
         * 选中引擎后这一块跟着换：标题 + 一句人话 + 若干档位按钮（单选互斥）。
         * 每个档位按钮两行：**档位名** + **占用大小**（用户点名的）。
         *
         * 🔴 它和左导航同处 `.rl-asr-row` 这个 **CSS Grid**：
         *    nav 占 (1,1)、本块占 (1,2)、三模块占 (2,2)。
         *    第 1 行高度取两者较大值 ⇒ 左导航与它严格等高（用户 m05717 ①）。
         */
        const top = row.createDiv({ cls: 'rl-asr-top' });
        const curGroup = allGroups.find((g) => g.engine === engineId) ?? allGroups[0];
        const curTierRow = curGroup?.tiers.find((t) => t.pickId === curPickId);
        const topHead = top.createDiv({ cls: 'rl-asr-top-head' });
        const topIco = topHead.createSpan({ cls: 'rl-asr-top-icon' });
        safeSetIcon(topIco, 'microchip');
        topHead.createSpan({ cls: 'rl-asr-top-title', text: engineDefOf(engineId).title });
        if (curTierRow) {
            topHead.createSpan({ cls: 'rl-asr-top-cur', text: '当前：' + (curTierRow.label ?? curTierRow.tier) });
        }
        top.createDiv({ cls: 'rl-asr-top-desc', text: curGroup?.subtitle ?? '' });

        /**
         * 🔴 用户 m09565 ①-1：「设置项播放阅读-语音转文字的右侧栏模型描述怎么没有看到对应模型的
         *    准确度 (中/英 %)、核心定位与适用场景」。
         *    ⇒ 原来只画了家族副标题（`curGroup.subtitle`），**当前档位**的这三项信息全在
         *      `.rl-asr-tg` 的 `data-tip` 气泡里 —— 不悬停就看不到，等于没有。
         *    ⇒ 补一块 `.rl-asr-meta`：一行准确度（中/英词错率）+ 一行「核心定位」+ 一行「适用场景」。
         *    ⚠️ 数据一律取自 `AsrCatalogTier`（accZh / accEn / tag / scene），⛔ 别在这里另写文案表：
         *      档位一改，这里必须跟着改，两份真源必然漂移。
         *    ⚠️ `accEn` 为 null（Paraformer 上游没给英文指标）⇒ 这里渲成 `-`，⛔ 别填 0。
         */
        if (curTierRow) {
            const meta = top.createDiv({ cls: 'rl-asr-meta' });
            const acc = meta.createDiv({ cls: 'rl-asr-meta-acc' });
            acc.createSpan({ cls: 'rl-asr-meta-key', text: '准确度' });
            /**
             * ⚠️ `accuracyLabel()` 回的是**已经带单位语义的 `zh/en` 串**（如 `'1.95/-'`），
             *    它自己不带 `%`。第一版写成 `中文 / 英文词错率 ${accuracyLabel(t)}%` ⇒ 真机渲出
             *    「1.95/-%」（`-` 后面挂个 `%`，像是英文 0%）。用户 m09565 ①-1 要的是
             *    「准确度（中 / 英 %）」⇒ 两个数字**各自**带百分号，缺测的一侧保持 `-`。
             */
            const zh = curTierRow.accZh === null ? '-' : `${curTierRow.accZh}%`;
            const en = curTierRow.accEn === null ? '-' : `${curTierRow.accEn}%`;
            acc.createSpan({ cls: 'rl-asr-meta-val', text: `中文 ${zh} · 英文 ${en}` });
            if (curTierRow.tag) {
                const tagRow = meta.createDiv({ cls: 'rl-asr-meta-line' });
                tagRow.createSpan({ cls: 'rl-asr-meta-key', text: '核心定位' });
                tagRow.createSpan({ cls: 'rl-asr-meta-val', text: curTierRow.tag });
            }
            if (curTierRow.scene) {
                const sceneRow = meta.createDiv({ cls: 'rl-asr-meta-line is-scene' });
                sceneRow.createSpan({ cls: 'rl-asr-meta-key', text: '适用场景' });
                sceneRow.createSpan({ cls: 'rl-asr-meta-val', text: curTierRow.scene });
            }
        }

        const grid = top.createDiv({ cls: 'rl-asr-tiergrid' });
        for (const t of curGroup?.tiers ?? []) {
            const st = this.plugin.asrPickStatus(curGroup.engine, t.tier);
            const on = t.pickId === curPickId;
            /**
             * 🔴 2026-11-11 用户报「选择模型的各自下载按钮去哪了找不到入口」：
             *    原来这一格是 `<button>`，里面只画了一个 `⤓` 符号 —— 点整格只会「选中」，
             *    想装某个档位得滚下去找「资产与凭证」里那个笼统的「重新安装 X」。
             *    而且 `<button>` 里不能再嵌 `<button>`（非法 HTML，浏览器会把内层按钮甩到外面），
             *    所以格子改成 `div[role=button]` + 自己管键盘，未装的档位在格子里挂**真的**下载按钮。
             */
            const cell = grid.createDiv({ cls: 'rl-asr-tg' });
            cell.setAttribute('role', 'button');
            cell.setAttribute('tabindex', '0');
            if (on) cell.addClass('is-on');
            if (!st.ready) cell.addClass('is-off');
            cell.setAttribute('aria-pressed', on ? 'true' : 'false');
            cell.createSpan({ cls: 'rl-asr-tg-name', text: t.label ?? t.tier });
            const foot = cell.createDiv({ cls: 'rl-asr-tg-foot' });
            foot.createSpan({ cls: 'rl-asr-tg-size', text: t.size });
            // 装好 = 绿勾（纯状态标记）；没装 = 一颗**可点**的下载按钮（⛔ 别退回只画 ⤓ 符号）
            if (st.ready) {
                foot.createSpan({ cls: 'rl-asr-tg-ok', text: '✓' });
            } else {
                const dl = foot.createEl('button', { cls: 'rl-asr-tg-dl' });
                dl.setAttribute('type', 'button');
                dl.setText('⤓ 下载');
                dl.setAttribute('aria-label', `下载 ${curGroup.title} ${t.label ?? t.tier}（${t.size}）`);
                dl.addEventListener('click', (ev: MouseEvent) => {
                    // 下载 ≠ 选中：先把当前档位切过去，再开安装弹窗，
                    // 否则装完回到页面发现「装的是这一档，但当前选的是别的档」。
                    ev.stopPropagation();
                    ev.preventDefault();
                    void this.switchAsrModel(t.pickId, refresh).then(() => {
                        // `AsrCatalogTier.tier` 是 string（目录表里六家共用一张表），
                        // `openAsrInstall` 只认 whisper 的六个 AsrModelTier；
                        // 用 presetByFileName 同口径的收窄方式，认不出就不传（install 会退回按当前档位推断）
                        const tierKey = ASR_MODEL_PRESETS.some((p) => p.tier === t.tier)
                            ? (t.tier as AsrModelTier)
                            : undefined;
                        this.plugin.openAsrInstall(curGroup.engine, tierKey, refresh);
                    });
                });
            }
            cell.setAttribute(
                'data-tip',
                [
                    curGroup.title + ' ' + (t.label ?? t.tier) + ' · ' + t.size,
                    '中文/英文词错率 ' + accuracyLabel(t),
                    t.tag,
                    t.scene,
                    st.ready ? '已装好，可直接用' : '还没装：点格子里那颗「⤓ 下载」直接装这一档',
                ].join('\n'),
            );
            const pick = () => {
                void this.switchAsrModel(t.pickId, refresh);
            };
            cell.addEventListener('click', pick);
            cell.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key !== 'Enter' && ev.key !== ' ') return;
                ev.preventDefault();
                pick();
            });
        }

        /**
         * ── 右下：AI 运行管家（用户 m05717 ①「右侧下部」）──
         * 三模块由 `renderEngineEnv` 铺：环境体检 / 资产与凭证 / 运行参数与资源预估。
         *
         * 🔴 用户 m06406 ①：它是**网格第 2 行第 2 列**（右上那段的正下方、左导航右边缘开始），
         *    ⛔ 别再挂到 `pick2` 上 —— 那样就变成横跨整行铺在左导航下方了。
         */
        const bt = row.createDiv({ cls: 'rl-asr-bt' });
        renderEngineEnv(bt, engineId);

        /**
         * 🔴 「左导航与右上等高」现在**由 CSS Grid 保证，不需要任何 JS**（2026-11-11 第 18 轮）。
         *
         * 之前在这里写过 `syncNavHeight`：setTimeout + ResizeObserver 量高回填 inline style。
         * 真机实测**三次都没成**（inline style 有时为空、有时量到 0）——设置页是先建 DOM
         * 再挂载，测量时机根本不可控。现在的方案：三者是同一 Grid 的兄弟，
         * 第一行高度 = max(nav, top)，两个子项都 stretch ⇒ 天然等高。
         * ⛔ 别再往这里加量高代码；要改对齐就去改 `.rl-asr-row` 的 grid 规则。
         */

        // 🔴🔴 2026-11-10 用户裁定（m03321 + m03346）：「偏好与词典项移除掉不需要了」——
        //    整段（识别语言 / 识别线程数 / 模型下载目录 / 本地词典文件）**四行全删**。
        //    · 语言、线程：交给引擎默认值（whisper 的 `-l auto`、sherpa 的自动判定），
        //      用户不填反而更少出错；这两个字段仍留在 settings 里（旧库兼容），只是不再有 UI。
        //    · 下载目录：安装弹窗已经逐引擎列出落点、允许当场改（`AsrInstallModal` 的目录编辑区），
        //      在设置页再放一个全局目录只会和它打架（两处都能改 ⇒ 以谁为准？）。
        //    · 词典：搬到**「字幕面板学习模式」独立组**（见 `renderDictRows`），它服务的是
        //      学习模式悬停查词，与语音转文字本来就不是一件事。
        //    ⛔ 别在这里补回任何一行：用户点名「全部不要了」，加回来等于没听。
    }

    /**
     * 「选择模型」里的一行（2026-11-06 用户选定的 A 版）。
     *
     * 每行五件事：单选点 / 名字+一句人话 / 体积 / 环境状态胶囊 / 一个动作按钮。
     * 点整行 = 切到这一档；点按钮 = 下载 / 一键装好 / 取消（互不干扰，按钮里 stopPropagation）。
     *
     * 🔴 `pick`（可选）：把「同一家的多个档位」收进一个行内下拉，而不是每档占一行
     *    （m08893：「如 Whisper.cpp 不再区分什么均衡极速改成下拉框选择」）。
     *    有 `pick` 时，整行**不再**是可点按钮 —— 行点击与下拉点击会互相打架
     *    （点下拉也算点在行上，会先把当前档切一遍再让下拉选，出现「点了没反应」）；
     *    这时唯一的操作入口就是下拉本身。
     */
    private renderAsrModelRow(
        list: HTMLElement,
        opts: {
            id: string;
            current: boolean;
            name: string;
            sub: string;
            size: string;
            pill: string;
            pillOk: boolean;
            action: 'use' | 'download' | 'bundle' | 'none';
            pillTip?: string;
            /** 行内档位下拉。给了它就不再把整行做成按钮（避免与下拉抢点击）。 */
            pick?: {
                value: string;
                items: readonly { value: string; label: string }[];
                onChange: (value: string) => void;
            };
            onUse?: () => void;
            onDownload?: () => void;
            /** 点「一键装好」：打开安装清单弹窗（进度与打勾都在弹窗里） */
            onBundle?: (btn: HTMLButtonElement, row: HTMLElement) => void;
            /**
             * 🔴 2026-11-07 本轮第⑤条：这一行的**环境配置**（默认收起，点行收放）。
             *    v-if 语义：`undefined` = 这行没有环境配置（不渲染折叠面板、行也不可点开）。
             */
            env?: (host: HTMLElement) => void;
        },
    ): void {
        const row = list.createDiv({ cls: 'rl-asr-model' });
        if (opts.current) row.addClass('is-on');
        if (!opts.pillOk) row.addClass('is-off');
        /**
         * 🔴 2026-11-07 本轮第⑤条（用户裁定，选项一）：**点整行 = 收放这一行的环境配置**；
         *    「选中这个引擎」改由行首圆点 / 状态胶囊承担。
         *
         *    上一版是「点整行 = 切到这一档」（m09051 用户要求「统一点改行即可选择」）。
         *    两条要求不能同时压在一次点击上 —— 用户本轮明确选了「点行收放，选中走圆点」，
         *    所以这里必须**把点击语义换掉**，并把 onUse 挂到 `rl-asr-radio` 与 `rl-asr-pill` 上。
         *    ⚠️ 没装好的引擎点圆点也会切过去（与上一版整行点击一致）；这是用户已接受的代价，
         *      ⛔ 别自作主张加「没装好就不许选」的拦阻 —— 选它是为了先配好它。
         *    ⚠️ 档位下拉、动作按钮（下载 / 一键装好）都 `stopPropagation`，不会连带收放。
         */
        const collapsible = typeof opts.env === 'function';
        // 圆点 / 胶囊 / 整行：选中入口
        const selectable = !!opts.onUse && !opts.current;
        /** 环境配置面板（只有可收放的行才有）；行点击时用来排除「点在面板里」的情况。 */
        let envPanel: HTMLElement | null = null;
        if (collapsible) {
            row.addClass('is-foldable');
            /**
             * 🔴 2026-11-07 本轮（用户 m02783）：「选择模型环境配置改成下拉箭头收起展开吧」
             *    ⇒ 收放入口从**整行点击**改为一枚**行尾箭头按钮**（`.rl-asr-chev`）。
             *
             *    为什么不在行上留 role=button / tabindex / aria-expanded 了：
             *      · 整行点击会和行内控件（档位下拉、下载、一键装好、圆点选中）抢事件，
             *        上一版全靠各处 stopPropagation 兜着，漏一处就是「点一下顺便收起来」；
             *      · 语义上「这一行」不是一个按钮，只有箭头是。把 role / tabindex /
             *        aria-expanded 一并搬到箭头上，读屏念的是「展开环境配置 按钮 已折叠」，
             *        而不是「按钮 里面 组合框 按钮 按钮」。
             *    ⚠️ 箭头**无条件创建**（有档位下拉的行也要），`aria-expanded` 也跟着它走 ——
             *       #718 那个「Whisper.cpp 行读不到 aria-expanded」的坑就是这么来的：
             *       当时把它挂在行上、又用 `!opts.pick` 挡了一道。
             *    ⚠️ `is-clickable`（点行=选中）不在这个分支里加 —— 见函数末尾统一处理，
             *       它既要给无面板的行，也要给有面板的行（本轮第②条把整行点击还给了「选中」）。
             */
        }
        row.createSpan({ cls: 'rl-asr-radio' });
        const nameBox = row.createDiv({ cls: 'rl-asr-model-main' });
        nameBox.createSpan({ cls: 'rl-asr-model-name', text: opts.name });
        nameBox.createSpan({ cls: 'rl-asr-model-sub', text: opts.sub });
        if (opts.pick) {
            /**
             * 🔴 用户 m09432：「这个选择模型和切换模型档位的下拉框太原始了改成独立设计风格的
             *    市面主流方案」—— 原生 `<select>` 在 Obsidian 里永远是系统控件的样子（深色主题下
             *    是一块灰白、与旁边的圆角卡片完全不搭）。
             *
             * 所以复用本仓已有的自绘面板 `renderDropdown`（`.rl-ai-dd`：按钮 + 浮层面板 +
             * caret + Esc 关闭 + 点外关闭），AI 服务的服务商下拉用的就是它 ⇒ 两处观感一致。
             * ⚠️ 它必须挂在**紧贴名字**的位置，而不是靠 `margin-left:auto` 推到最右 ——
             *    推到最右会和「体积 / 胶囊 / 按钮」挤在同一段，窄窗口下先撑破的是这一行。
             */
            const pick = opts.pick;
            const cur = pick.items.find((it) => it.value === pick.value);
            const wrap = nameBox.createSpan({ cls: 'rl-asr-pickwrap' });
            this.renderDropdown(wrap, {
                cls: 'rl-asr-pickdd',
                text: cur ? cur.label : pick.value,
                items: pick.items.map((it) => ({ value: it.value, label: it.label })),
                current: pick.value,
                onPick: (v) => pick.onChange(v),
            });
            // 下拉是行内控件：点它不该连带触发整行的「切到这一档」
            wrap.addEventListener('click', (ev: MouseEvent) => ev.stopPropagation());
        }
        if (opts.size) row.createSpan({ cls: 'rl-asr-model-size', text: opts.size });
        const pill = row.createSpan({ cls: 'rl-asr-pill', text: opts.pill });
        if (opts.pillOk) pill.addClass('is-ok');
        if (opts.pillTip) pill.setAttribute('data-tip', opts.pillTip);

        // 🔴 第⑤条之后「选中」不再由整行承担：圆点与状态胶囊是那两个入口（见上面注释）。
        //    ⚠️ 当前选中的行点了也什么都不做（`selectable=false`）—— 重复点自己没意义，
        //      但⛔ 别把 `selectable` 判反：那会让「已选中」变成不可点、未选中的变成可点，
        //      与用户直觉正好相反。
        if (selectable) {
            for (const entry of [row.querySelector('.rl-asr-radio'), pill]) {
                if (!(entry instanceof HTMLElement)) continue;
                entry.addClass('rl-asr-select');
                entry.setAttribute('data-tip', '切到这个引擎');
                entry.addEventListener('click', (ev: MouseEvent) => {
                    ev.stopPropagation();
                    opts.onUse?.();
                });
            }
        }

        // 「下载 / 一键装好」是「装东西」，与「选哪个」不是一回事，
        // 混进整行点击会变成「点一下就下载 228MB」，所以按钮各自 stopPropagation。
        if (opts.action === 'download') {
            const btn = row.createEl('button', { cls: 'rl-asr-model-act', text: '下载' });
            btn.addEventListener('click', (ev: MouseEvent) => {
                ev.stopPropagation();
                opts.onDownload?.();
            });
        } else if (opts.action === 'bundle') {
            // bundle：点开的是「安装清单」弹窗，进度与打勾都在弹窗里，
            // 这里⛔ 不再自己把按钮切成「正在安装…」—— 那会让设置页和弹窗显示两份进度。
            const btn = row.createEl('button', { cls: 'rl-asr-model-act', text: '一键装好' });
            btn.addEventListener('click', (ev: MouseEvent) => {
                ev.stopPropagation();
                opts.onBundle?.(btn, row);
            });
        }

        // ── 环境配置折叠（本轮第⑤条 → m02783 改成箭头收放 → 2026-11-07 本轮第②条）──
        // 面板挂在**行之后**，默认 `hidden`；点行尾箭头切换 `is-open` + `aria-expanded`。
        // ⛔ 不用 `display:none` 类手写：这里用 `hidden` 属性，主题的 `[hidden]` 规则能统一压住，
        //    且读屏也认。
        if (collapsible) {
            /**
             * 🔴 箭头必须在**面板之前**创建（本轮第②条「始终在模型家行不变动位置」）。
             *
             *    为什么：行的布局是 `display:flex` + `flex-wrap:wrap`，面板是 `flex-basis:100%`
             *    的整行块。DOM 顺序决定换行位置 —— 先建面板再建箭头，箭头会被排到面板**下一行**，
             *    展开时整枚箭头往下跳一截（实测就是这样）。先建箭头再建面板，箭头就永远跟在
             *    「体积 / 胶囊 / 动作按钮」后面同一行，展开只是往下长出面板。
             *    ⛔ 别把这两行的创建顺序调回来。
             *
             * 真 `<button>`（不是带 role 的 span）：键盘 Enter/Space、焦点环、`disabled` 全部白拿。
             * `aria-expanded` 挂在它身上，读屏念「展开环境配置 按钮 已折叠」。
             *
             * 🔴 2026-11-12（用户 m00353 ①-9「部分按钮 hover 双提示重叠覆盖」）：
             *    这里原本 `aria-label` 与 `data-tip` 同时挂 —— 同一颗箭头 hover 出**两层气泡**。
             *    现在悬停提示只走 `setTip`（单一 `data-tip`），读屏名走 `srLabel`（`<span class="rl-sr">`），
             *    `aria-expanded` 保持不动（它只报折叠状态，不触发气泡）。
             *    ⚠️ `safeSetIcon` 会把按钮内容整个换掉，所以 `srLabel` 必须排在它**后面**。
             */
            const chev = row.createEl('button', { cls: 'rl-asr-chev' });
            chev.setAttribute('aria-expanded', 'false');
            safeSetIcon(chev, 'chevron-right');
            setTip(chev, '展开环境配置');
            srLabel(chev, '展开环境配置');

            const panel = row.createDiv({ cls: 'rl-asr-env' });
            panel.hidden = true;
            envPanel = panel;
            opts.env?.(panel);

            const toggle = (): void => {
                const open = panel.hidden;
                panel.hidden = !open;
                row.toggleClass('is-open', open);
                chev.setAttribute('aria-expanded', open ? 'true' : 'false');
                setTip(chev, open ? '收起环境配置' : '展开环境配置');
                srLabel(chev, open ? '收起环境配置' : '展开环境配置');
            };
            chev.addEventListener('click', (ev: MouseEvent) => {
                // 行现在是「点一下=选中」（见函数末尾），箭头只收放，两件事必须分开
                ev.stopPropagation();
                toggle();
            });
            /**
             * 🔴 2026-11-07 本轮第②条：**不再给「当前选中那家」默认展开**。
             *
             *    上一轮（#719）写的是「当前选中的那家默认展开 —— 它是用户正在用的，配置状态最该被看见」。
             *    本轮用户逐字要求「把语音服务的模型选择只勾选不展开环境配置」，而点整行选中之后
             *    设置页会重渲染、那一行就成了 `opts.current` ⇒ 旧规则会**替用户把面板展开**，
             *    真机实测就是这个现象（点 Qwen3-ASR 选中后 `panelHidden` 从 true 变 false）。
             *    所以默认展开整条取消：三行一律收起，要看配置自己点箭头。
             *    ⚠️ 这不是把 #719 的判断推翻了 —— #719 说的是「没有默认展开就不知道有配置」，
             *      那种担心由**箭头本身常驻可见**承担（`.rl-asr-chev` 的 opacity 从不降到 0），
             *      不需要靠自动展开。⛔ 别为了「体贴」把默认展开加回来。
             */
        }

        /**
         * 🔴 2026-11-07 本轮第②条（用户逐字：「把语音服务的模型选择只勾选不展开环境配置，
         *    而且这个下拉箭头透明化无边框化并始终在模型家行不变动位置」）：
         *    整行点击**只负责选中**，⛔ 不再收放环境配置 —— 收放归箭头，两件事彻底分开。
         *
         *    为什么这样分：
         *      · 上一轮把整行点击挪给了收放，导致「想换引擎得去点那个小圆点」，
         *        而用户对「点一行就该选它」的直觉更强（这是列表项，不是折叠区标题）；
         *      · 收放是**次要动作**、选中是**主要动作** —— 主要动作铺满整行、次要动作缩到
         *        22px 的箭头里，点击面积与动作重要性成正比。
         *
         *    ⚠️ 排除范围（点这些不该顺手切引擎）：
         *      环境配置面板内（`envPanel.contains`）、档位下拉（自己已 stopPropagation）、
         *      下载 / 一键装好按钮（同上）、圆点 / 胶囊（它们自己就是选中入口，已 stopPropagation）。
         *    ⚠️ 已选中的行走不到这里（`selectable=false`）：重复点自己没意义。
         */
        if (selectable) {
            row.addClass('is-clickable');
            row.addEventListener('click', (ev: MouseEvent) => {
                const t = ev.target as Node | null;
                if (envPanel && t && envPanel.contains(t)) return;
                opts.onUse?.();
            });
        }
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
        slot: 'dl' | 'book' | 'game',
        kind: DownloadKind,
    ): void {
        const row = new Setting(parent).setName(name).setDesc(desc);
        // 🔴 本轮：目录行是折叠项下的**从属项** ⇒ 挂 `.rl-dir-sub` 缩进（与 `createLocalDirRow` 同一口径，
        //    缩进值统一写在 `styles.css`，⛔ 别内联）。
        row.settingEl.addClass('rl-dir-sub');
        // 🔴 m03052①：宽度类。根因/口径见方法末尾那段长注释（⛔ 别挪到这儿 ——
        //    `assert-symbols` 的三条判据是「方法起点后 N 个字符内找 setPlaceholder / blur / Enter」，
        //    在方法开头插长注释会把它们整体挤出窗口，实测一轮红 3 条）。
        row.settingEl.addClass('rl-dir-row');
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
            const prev =
                slot === 'dl' ? this.dlFolderSuggest : slot === 'book' ? this.bookFolderSuggest : this.gameFolderSuggest;
            prev?.close();
            const inst = attachFolderInputSuggest(this.app, text.inputEl, folders, fromPick);
            if (slot === 'dl') this.dlFolderSuggest = inst;
            else if (slot === 'book') this.bookFolderSuggest = inst;
            else this.gameFolderSuggest = inst;
            // 🔴🔴 本轮用户裁定（需求①）：浏览按钮**恒常出现**、桌面端**直接唤起系统文件选择器**。
            //    与 `createLocalDirRow` 同一套口径（那边注释写全了理由），此处不再重复长篇：
            //      · 首选 `plugin.pickSystemDirectory()` → 能选库外绝对路径；
            //      · 只有 `!Platform.isDesktopApp` 才回退 `VaultFolderSuggest`（库内）；
            //      · 用户取消回 undefined ⇒ 什么都不做，⛔ 别掉进补全框。
            row.addButton((b) => {
                b.setButtonText('浏览');
                b.buttonEl.addClass('rl-dir-browse');
                b.onClick(() => {
                    if (Platform.isDesktopApp) {
                        void this.plugin.pickSystemDirectory(normalizeDownloadRoot(getCur(), kind)).then((picked) => {
                            if (!picked) return;
                            text.setValue(picked);
                            void commit();
                        });
                        return;
                    }
                    new VaultFolderSuggest(this.app, folders, fromPick).open();
                });
            });
        });
        // 🔴🔴 用户 m03052（逐字）：「播放阅读设置页的音乐目录和游戏目录的框宽度和其他关联目录不统一啊」。
        //    **根因**：输入框宽度收敛全靠 `.rl-dir-row`（`styles.css` 里
        //    `.rl-dir-row .setting-item-control { flex: 1 1 auto; min-width: 0; margin-inline-end: 8px; }`
        //    + `.rl-dir-row .setting-item-control input[type="text"] { flex: 1 1 auto; width: auto; }`）——
        //    而本工厂原先**只挂了 `rl-dir-sub`（缩进）没挂 `rl-dir-row`（宽度）**，于是音乐 / 游戏这两行的
        //    输入框退回 Obsidian 默认的 `width: auto` 靠内容撑，与文学 / 网文 / 电影…那几行对不齐。
        //    ⚠️ 两个类各管一件事（`createLocalDirRow` 那边注释写全了）：`rl-dir-row` = 宽度，
        //    `rl-dir-sub` = 缩进。⛔ 别把宽度规则直接写在这里（内联会盖掉主题与 CSS 收敛规则）。
        //    ⚠️ 这段解释**必须留在方法末尾**：`assert-symbols` 对 `createLibraryDirRow` 的三条判据
        //    是按「方法起点后 1200/2400/2700 个字符」开窗找 `setPlaceholder` / `blur` / `Enter` 的，
        //    写进方法开头会把它们整体挤出窗口（实测一次红 3 条）。
    }

    /**
     * 「基本设置」页 · 第 4 组「管理与维护」。
     *
     * 🔴🔴 **2026-11-13 用户指令（现行定稿，七行的顺序 / 名称 / 描述 / 按钮文案逐字对齐）**：
     *   1 从笔记导入条目「扫描并解析笔记，快速生成系统条目」按钮 导入 / 模板
     *   2 下载封面到本地「抓取网络封面图片并保存至本地」按钮 下载
     *   3 关联媒体重命名「按设定规则批量重命名关联的媒体文件」按钮 重命名
     *   4 失效性链接检测「全面检测库内网络链接的有效性」按钮 检测
     *   5 清理未引用附件「清理未引用的封面与阅读存档」按钮 清理
     *   6 附件管理与浏览「浏览被清理或删除的历史附件文件」按钮 查看
     *   7 条目记录还原「恢复近期删除的条目记录」按钮 还原
     *   ⚠️ 顺序即契约：**「导入 → 下载 → 重命名 → 检测 → 清理 → 查看 → 还原」**，
     *      由「把内容补进来」到「修好已有」再到「清理/回滚」的动线排列，⛔ 别按字母或旧顺序重排。
     */
    private renderPosterCleanupRows(parent: HTMLDivElement): void {
        // ① 从笔记导入条目（🔴 2026-11-08 用户指令：「是手写的条目在海报墙上展示无法出现，
        //      但笔记文件存在是怎么回事，有没有再加个检索库内笔记文件生成条目的项在基本设置下」）
        // 🔴 根因：海报墙只读 `catalog.json`，插件没有任何反向扫描能力 ⇒ 手工写的笔记不落 catalog 就永不显示。
        //   整条流程（扫 `{lib}/笔记/` → 弹窗勾选 → 落 catalog → 回写 id）收进 `main.openNoteImport()`，
        //   设置页只负责点一下（与「下载封面到本地」同架构，⛔ 别在这里自己扫库）。
        // 🔴 2026-11-08 用户指令：「给从笔记导入条目项加个『生成模板』按钮，可在仓库根目录生成笔记模板」
        //   ⇒ 同一行挂第二个按钮（⛔ 不新开一 Setting 行：这两个动作是同一件事的「准备」与「执行」，
        //     拆成两行会让用户以为模板是独立功能）。
        //   落盘位置 `{lib}/条目模板.md`（与 `笔记/` 同级）：扫描器只扫 `笔记/` 子树 ⇒ 模板不可能被导进去。
        new Setting(parent)
            .setName('从笔记导入条目')
            .setDesc('扫描并解析笔记，快速生成系统条目')
            .addButton((b) =>
                b.setButtonText('导入').onClick(() => {
                    void this.plugin.openNoteImport();
                }),
            )
            .addButton((b) =>
                b.setButtonText('模板')
                    .setTooltip('在媒体库目录下生成「条目模板.md」：六种类型的可复制 frontmatter 区块')
                    .onClick(() => {
                        void this.plugin.writeNoteTemplate();
                    }),
            );

        // ② 下载封面到本地（一键迁移：网络封面下载到 封面/{标题}.jpg；开关已移除，字段保留兼容旧数据）
        new Setting(parent)
            .setName('下载封面到本地')
            // #477：统一标准动作词「下载 / 保存」（口径见 renderAppearanceRows）
            .setDesc('抓取网络封面图片并保存至本地')
            .addButton((b) =>
                b.setButtonText('下载').onClick(() => {
                    // 🔴 2026-10-25 用户指令：「点击"一键迁移"先弹窗列出当前可以迁移的封面条目出来然后用户勾选再迁移，默认全选」
                    //    ⇒ 整条流程（扫候选 → 勾选弹窗 → 进度弹窗 → 迁移）收进 `main.openPosterMigrate()`，
                    //    设置页只负责点一下，⛔ 不再自己 new 进度弹窗（那会绕过勾选直接全量跑）。
                    void this.plugin.openPosterMigrate();
                }),
            );

        // ③ 关联媒体重命名（🔴 m07854 ⑱ 起的「批量重命名」，2026-11-13 用户指令改名并前移到第三位）
        //   规则模板改为**按类型分列**的七套（电影/剧集/动画/音乐/漫画/文学/网文），
        //   真源在 `pure/batchRename.ts` 的 `RENAME_TEMPLATE_GROUPS`，弹窗直接渲染那份数据 ——
        //   ⛔ 别在这里再抄一遍文案（抄两份必然漂移）。
        //   ⚠️ 弹窗先列「旧 → 新」再执行 —— 改名是**不可撤销的破坏性操作**（Obsidian 回收站救不回来），
        //      ⛔ 别做成「点一下直接跑」。
        new Setting(parent)
            .setName('关联媒体重命名')
            .setDesc('按设定规则批量重命名关联的媒体文件')
            .addButton((b) =>
                b.setButtonText('重命名').onClick(() => {
                    void this.plugin.openBatchRename();
                }),
            );

        // ④ 失效性链接检测（🔴 #531，用户 2026-10-05 指令：「把检测已填网络地址是否失效按钮放在设置页-基本设置-
        //      封面与清理下面，功能为**全库**检索失效链接标红」）—— 原在**编辑表单**里的那枚按钮**已撤**，
        //      改成这里一键扫全库；结果只存内存，失效的集在**编辑表单 / 集数选择弹窗**里标红（用户裁定「仅表单/弹窗」）。
        // 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-2）：结果**不再埋在设置页里**（原来那行 `.rl-hint` 在长设置页
        //    滚过去就丢，且只报个数、看不到具体是哪条链接）⇒ 改 `LinkCheckModal` 列出「条目名 / 字段 / 链接」明细。
        //    `scanLibraryLinks()` 因此扩了返回值：除四个计数外还带 `items`（失效明细，逐条 label + url）。
        let scanning = false;
        new Setting(parent)
            .setName('失效性链接检测')
            .setDesc('全面检测库内网络链接的有效性')
            .addButton((b) => {
                b.setButtonText('检测').onClick(() => {
                    // 防重入：全库扫描是串行网络请求，连点会打出多份请求并把结果互相覆盖
                    if (scanning) return;
                    scanning = true;
                    b.setDisabled(true);
                    b.setButtonText('检测中…');
                    // 🔴 2026-11-17 用户报障（⑥-A）修复：「按一下后误退出仍显示『检测中』、最终无结果弹窗」。
                    //
                    // 根因（已核实，⛔ 不是文案问题）：`services/nodeHttp` 的 `TIMEOUT_MS = 30_000`
                    //   是 **socket 空闲超时**、不是整条请求的截止时间，重定向链每跳重算；
                    //   加上全库成百条地址串行跑，整趟动辄几分钟且**没有任何中途出口**。
                    //   用户唯一能做的是按 ✕ 关窗 —— 而关窗后 `finishScan()` 里
                    //   `if (this.subEl)` / `if (wasScanning)` 全部静默 no-op，
                    //   结果**彻底丢失**，按钮还停在「检测中…」，这就是「误退出」的完整真相。
                    //
                    // 三处修法（对应三条根因，⛔ 只改一处都不够）：
                    //   ⑴ 服务层 `LINK_CHECK_TIMEOUT_MS` 单条硬截止 ⇒ 整趟一定能在有限时间内落定；
                    //   ⑵ 弹窗给「停止检测」出口 + `LinkCheckSignal` ⇒ 用户想中断时有正路，不必关窗；
                    //   ⑶ 关窗后宿主仍用 Notice 把结果说清楚 ⇒ 关窗不再等于「白跑」。
                    //
                    // 🔴 2026-10-25 用户指令：**先弹窗再陆续显示**检测到的失效链接。
                    //    ⇒ 先用 progressive 工厂开一个空壳（标题 + 「正在检测…」），
                    //      再把 `onDead` 接上宿主，每抓到一条就往列表里追加一行。
                    //    ⛔ 别再退回「扫完才 new LinkCheckModal(...items)」—— 那等于用户盯着一个不动的按钮等全库。
                    const signal = { stopped: false };
                    const modal = LinkCheckModal.progressive(
                        this.app,
                        { entries: 0, dead: 0, unknown: 0 },
                        // 执行体留在宿主（`plugin.clearDeadLinks`），弹窗只负责确认与反馈 ——
                        // ⛔ 别在弹窗里自己改 catalog：写盘要过 `service.update` 的唯一收口。
                        () => this.plugin.clearDeadLinks(),
                        // 「停止检测」：只置标志，⛔ 不 close()、也不撤销在途请求 ——
                        // 在途那条会跑完或被 12s 硬截止掐掉，已抓到的结果照常入列（用户要的是「别扫了」，不是「当没扫过」）。
                        () => {
                            signal.stopped = true;
                        },
                    );
                    modal.markScanning();
                    modal.open();
                    void this.plugin
                        .scanLibraryLinks((item) => modal.appendItem(item), {
                            signal,
                            onProgress: (done, total) => modal.setProgress(done, total),
                        })
                        .then((r) => {
                            const stopped = r.stopped;
                            modal.finishScan(
                                { entries: r.entries, dead: r.dead, unknown: r.unknown },
                                { stopped, done: r.done, total: r.total },
                            );
                            // 🔴 关窗兜底：用户中途按 ✕ 关掉弹窗后，`finishScan` 对界面是 no-op，
                            //    必须用 Notice 告诉他「跑完了 / 被你停了 / 抓到几条」，否则就是白跑一趟。
                            //    ⚠️ 判据用 `closedByUser` 而不是「有没有 listEl」：后者在 `clearDead()` 成功
                            //       后也会是 null（它自己会 close），那条路不该再弹一条重复的汇总。
                            if (modal.closedByUser) {
                                new Notice(
                                    stopped
                                        ? `链接检测已停止：查了 ${r.done} / ${r.total} 条，发现 ${r.dead} 条可能已失效`
                                        : `链接检测完成：${r.entries} 个条目、${r.total} 条地址，${r.dead} 条可能已失效`,
                                    9000,
                                );
                            }
                        })
                        .catch(() => {
                            // ⚠️ 走到这里说明是**真异常**（服务层单条失败一律吞成 unknown，⛔ 不会抛）。
                            //    关窗只在还开着时做，否则 Obsidian 会对着已销毁的 modal 再走一次 onClose。
                            if (!modal.closedByUser) modal.close();
                            new Notice('检测失败，请稍后再试');
                        })
                        .finally(() => {
                            scanning = false;
                            b.setDisabled(false);
                            b.setButtonText('检测');
                        });
                });
            });

        // ⑤ 清理未引用附件（原「附件清理」「清理孤儿封面」）：未被引用的封面 + 条目已删除后遗留的阅读存档，
        //   逐项勾选后清理。⚠️ 与下面「附件管理与浏览」的区别：清理只认**孤儿**（没人引用的），
        //   管理浏览的是**全部**历史文件（含正在用的）。
        new Setting(parent)
            .setName('清理未引用附件')
            // 🔴 #477 按事实修正：用户建议写「缓存文件」，但**实际清的不是缓存** ——
            //    两类 = 未被引用的**封面** + 条目删除后遗留的**阅读存档**（`{lib}/阅读进度/*.json`，
            //    见 `pure/orphanAssets`），弹窗里逐项标的也是「封面 / 阅读存档」⇒ 必须与界面标签同词。
            // 🔴 2026-11-13 用户指令（m00002 表格第 5 行逐字）：desc 就是「清理未引用的封面与阅读存档」——
            //    ⛔ 别再自作主张塞「本地」二字（我上一版塞过，既偏离用户原话，又让 #477 产物抽查翻红）。
            .setDesc('清理未引用的封面与阅读存档')
            .addButton((b) =>
                b.setButtonText('清理').onClick(() => {
                    void this.plugin.openAssetCleanup();
                }),
            );

        // ⑥ 附件管理与浏览（用户 2026-10-06 原指令：「附件管理：支持浏览所有关联的条目 - 笔记 - 图片 - 附件，可选删除」）
        new Setting(parent)
            .setName('附件管理与浏览')
            .setDesc('浏览被清理或删除的历史附件文件')
            .addButton((b) =>
                b.setButtonText('查看').onClick(() => {
                    void this.plugin.openAssetManager();
                }),
            );

        // ⑦ 条目记录还原（用户 2026-10-06 指令：「条目还原：可选回撤删除的条目（5 个）」）
        //   删除条目时（`main.deleteEntry` / `deleteEntries`）先把条目快照写进 `{lib}/trash.json`，
        //   这里把最近 5 条列出来供勾选复活。⛔ 文件本身在 Obsidian 回收站，弹窗里已如实说明。
        new Setting(parent)
            .setName('条目记录还原')
            .setDesc('恢复近期删除的条目记录')
            .addButton((b) =>
                b.setButtonText('还原').onClick(() => {
                    void this.plugin.openEntryRestore();
                }),
            );
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
        const metaRow = infoText.createDiv({ cls: 'rl-about-meta' });
        // 🔴 2026-11-12 用户逐字（m00353 ①-11）：「设置-关于页 ReelLudic 信息栏『同作者 fhb263』
        //    **前面加个 B 站 logo 可点击跳转 B 站主页**」。
        //    ⚠️ 四条口径：
        //    ⑴ **图标不新画**：直接复用 `NET_COOKIE_ICON.bilibili`（simple-icons v16 官方标，
        //       CC0-1.0，与 `pure/searchIcons` 同源同值）→ 走全仓唯一的品牌标渲染器
        //       `renderAiIcon`。⛔ 别在本页手写 `<svg><path d=…>`，那会造出第二份品牌路径。
        //    ⑵ **是 `<a>` 不是 `<button>`**：它就是个外部链接，`href` 让「中键新标签 / 悬停看状态栏 /
        //       右键复制地址」这些浏览器原生行为白拿；做成 button + `window.open` 反而少一圈能力。
        //       ⚠️ Obsidian 编辑器里左键点 `<a>` 会被宿主接管（默认在当前窗打开），
        //       故仍 `preventDefault` + `window.open(..., '_blank')` 显式开新页 —— 与同页 Github /
        //       报 Bug 按钮的行为保持一致（那几枚也是新标签打开）。
        //    ⑶ **读屏名走 `.rl-sr` 隐藏文本、悬停说明走 `data-tip`**：⛔ 两样都别用 `aria-label` ——
        //       Obsidian 会对带 `aria-label` 的悬停元素自绘官方气泡，与本仓 `data-tip` 气泡叠成两层
        //       （UI-GUIDE §3 并存禁令；本元素在设置页这个独立窗口里，`data-tip` 已由
        //       `bindTooltipDocument` 绑好，见 `display()`）。
        //    ⑷ 颜色**不写死**：默认继承 `.rl-about-meta` 的 `--text-faint`，hover 才升到 `--text-accent`
        //       （与这一行「作者 · 许可证」的层级一致，不抢「爱发电」的行动召唤）。
        // 🔴 2026-11-12 用户 `m05813` 改口径：「设置-关于页 ReelLudic 信息栏的 b 站图标
        //    跟上 github 的图标，点击可跳转作者主页『https://github.com/fhb263』」
        //    ⇒ 图标从 `NET_COOKIE_ICON.bilibili` 换成 `AUTHOR_GITHUB_ICON`，落点从 B 站空间
        //      换成作者 GitHub 主页（`AUTHOR_GITHUB_URL`，⛔ 不是 `REPO_URL` —— 那是仓库地址）。
        //    ⚠️ `BILI_SPACE_URL` / `BILI_SPACE_TIP` 两个常量**保留**（①-11 的交付物，
        //      断言脚本锚了它们），只是本页不再消费；⛔ 别顺手删掉。
        //    ⚠️ 四条口径沿用：⑴ 图标不新画，走全仓唯一品牌标渲染器 `renderAiIcon`；
        //      ⑵ 是 `<a>` 不是 `<button>`（中键新标签 / 悬停看状态栏 / 右键复制地址白拿）；
        //      ⑶ 读屏名走 `.rl-sr`、悬停说明走 `data-tip`，⛔ 两样都别用 `aria-label`（会叠两层气泡）；
        //      ⑷ 颜色不写死，继承 `.rl-about-meta` 的 `--text-faint`，hover 才升 `--text-accent`。
        const authorLink = metaRow.createEl('a', {
            cls: 'rl-about-bili',
            attr: { href: AUTHOR_GITHUB_URL, 'data-tip': AUTHOR_GITHUB_TIP, rel: 'noopener' },
        });
        authorLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            window.open(AUTHOR_GITHUB_URL, '_blank');
        });
        renderAiIcon(authorLink.createSpan({ cls: 'rl-ai-icon' }), AUTHOR_GITHUB_ICON);
        authorLink.createSpan({ cls: 'rl-sr', text: AUTHOR_GITHUB_TIP });
        metaRow.createSpan({ text: `作者 ${this.plugin.manifest.author} · 许可证 ${license}` });

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
