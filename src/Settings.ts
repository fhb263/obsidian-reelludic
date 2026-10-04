// 设置类型、默认值与设置面板（字段只能追加，不能删除——AGENTS 红线）
import { Modal, Notice, Platform, PluginSettingTab, Setting, setIcon, requestUrl, TFolder } from 'obsidian';
import type ReelLudicPlugin from '../main';
import type { ColorTheme, UiTheme } from 'data/types';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from 'data/types';
import type { ProviderId, SourceGroup, ProviderMeta } from 'pure/sourceRegistry';
import {
    PROVIDERS, PROVIDER_META, GROUP_LABELS,
    resolveSourceChain, normalizeSourceChain, DEFAULT_CHAINS,
} from 'pure/sourceRegistry';
import { normalizeAiChoice, normalizeProvider, normalizeAiBaseUrl, AI_PROVIDER_OPTIONS, AI_PROVIDER_OFF, DEFAULT_MODELS, DEFAULT_TRANSLATE_PROMPT, aiBaseUrlIssue, providerLabel, mergeModelCandidates, aiChoiceLabel, aiPickText, isAiOff, aiKeyField, type AiProviderChoice, type TranslateProvider, type ModelFetched } from 'pure/translate';
// #484：模型拣选弹窗的筛选 / 置顶判定（纯逻辑，可单测）
import { togglePin } from 'pure/aiPick';
// #479 AI集成页整页重排：服务商品牌标（LobeHub Icons，MIT）+ 可搜索的模型选择
// #480：图标绘制与「服务商图标」抽到 services/aiIcon（设置页与拣选弹窗共用一份）
import { AI_PROVIDER_ICON, TTS_ICON, type AiIcon } from 'pure/aiIcons';
import { renderAiIcon, aiChoiceIcon } from 'services/aiIcon';
// #488：元数据源 / 音乐平台图标真源（simple-icons CC0 品牌标 + 内置兜底；**生成器写盘**，
// 见 `_gen_source_icons.cjs`）。与 AI 服务商图标共用**同一个** `renderAiIcon` 渲染端。
import { SOURCE_ICON, MUSIC_COOKIE_ICON, type KeySourceId, type MusicSourceId } from 'pure/sourceIcons';
// #491「更新日志」= 内置弹窗（⛔ 不再跳浏览器）；正文是 `pure/releaseNotes` 里那张**手写**的版本一句话表
import { ReleaseNotesModal } from 'modals/ReleaseNotesModal';
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
import { BOOK_DOWNLOAD_ENABLED } from 'pure/featureGate';
// #422 书源（设置页「元数据源配置 › 书籍源凭据」组）：类型 + 摘要 + 站点键 + 分类
import { SOURCE_KINDS, SOURCE_KIND_LABEL, sourceKey, sourceSummary, type NovelSource, type SourceKind } from 'pure/sourceRule';
// #432 甲：源生命周期（订阅 / 粘贴 / 体检）—— 体检汇总口径 + 取消 + 弹窗
import { SOURCE_HEALTH_KEYWORD, sourceCheckHealthText, sourceCheckSummaryText, type SourceCheckResult } from 'pure/sourceCheck';
import { SourceSubscribeModal } from 'modals/SourceSubscribeModal';
import { CancelledError, createCancelToken } from 'pure/cancel';
import { mountFilePickLabel } from 'services/filePick';
import {
    POSTER_DENSITIES, POSTER_DENSITY_LABELS, POSTER_COLUMNS_MIN, POSTER_COLUMNS_MAX,
    normalizePosterDensity, normalizePosterColumns, type PosterDensity,
} from 'pure/posterGrid';
import { PosterMigrateModal } from 'modals/PosterMigrateModal';
import { AssetCleanupModal } from 'modals/AssetCleanupModal';
import { ConfirmModal } from 'modals/ConfirmModal';
import {
    folderCandidates, attachFolderInputSuggest, VaultFolderSuggest, type FolderInputSuggest,
} from 'modals/VaultFolderSuggest';
import { DEFAULT_LIBRARY_DIR, libraryDirIssue, normalizeLibraryDirInput, sameLibraryDir } from 'pure/libraryDir';
import {
    SETTING_NAV_TABS, SETTING_NAV_PAGES, SETTING_NAV_DEFAULT,
    groupIcon, nextTabId, tabStates,
} from 'pure/settingNav';

export interface ReelLudicSettings {
    /** TMDB API Key（免费注册，设置页引导） */
    tmdbApiKey: string;
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
     *  实际列数仍由容器宽度决定 —— 容器过窄时按最小卡片宽度自动减列（pure/posterGrid）。 */
    posterColumns?: number;
    /** 界面主题（1.0.3）：全面 modern 后恒为 'modern'（设置页已无切换入口；字段按 schema append-only 保留） */
    uiTheme?: UiTheme;
    /** 阅读排版：字号（px，默认 16）/ 行距（倍数，默认 1.8）——设置项已移除（v0.5 起在阅读器内调整，写回本字段），字段保留兼容旧数据 */
    readerFontSize: number;
    readerLineHeight: number;
    /** 阅读滚动模式：'continuous' 连续滚动（默认）/ 'paged' 翻页（CSS 列式分页，D4b）。append-only，缺省 continuous */
    readerScrollMode?: 'continuous' | 'paged';
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
    /** 播放器 · 单集循环（缺省 false）：播完重播当前集；**优先级高于自动切集**。append-only 可选字段 */
    playerLoopOne?: boolean;
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
    /** 每类型源链（五组自选 ≤3 源及顺序；缺省/空 = 默认链，见 pure/sourceRegistry.DEFAULT_CHAINS。append-only 可选字段，旧数据无此键不迁移） */
    sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>;
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
    /** OMDb API Key（影视第三源，需 Key 1000 次/日；T1 预留字段，omdb 客户端接入后读取。append-only 可选字段，旧数据无此键不迁移） */
    omdbApiKey?: string;
    /** 服务集成折叠项开合记忆（**已弃用**：用户 2026-09-17 定稿「只有标题不折叠、内容一律折叠」，
     *  ①/② 不再是折叠项、`createFoldout` 已删除，本字段不再读写。⚠️ 字段只增不删（AGENTS 红线），
     *  保留仅为兼容旧数据。append-only 可选字段 */
    serviceFoldOpen?: Partial<Record<'api' | 'sources' | 'translate', boolean>>;
    /** 详情笔记是否渲染「属性表格」（笔记生成开关，用户 2026-09-18）。append-only 可选字段，
     *  缺省 true = 保持历史行为；关掉后笔记只有 callout/简介/评语/链接等章节，无表格。
     *  读取口径：`settings.noteTable !== false`（旧数据无此键 → 视为开）。 */
    noteTable?: boolean;
    /** 打卡日记所在文件夹（vault 内相对路径，如 日记）；留空/缺省 = 自动跟随核心「日记」插件配置。
     *  09-10 起**设置页不再提供入口**（打卡动作只在统计页「今日」面板），字段保留兼容/兜底读取。 */
    journalDir?: string;
    /** 打卡日记文件名格式（moment 日期格式，如 YYYY-MM-DD）；留空/缺省 = 自动跟随核心「日记」插件，未检测到用 YYYY-MM-DD。
     *  09-10 起设置页不再提供入口，字段保留兼容/兜底读取。 */
    journalFormat?: string;
    /**
     * **书源**（#419；**#422 起按分类分「网络文学源 / 经典文学源」两类**）—— 用户自备的 SoNovel 格式书源（`.json` 导入后的原始规则对象）。
     *
     * 🔴 红线 **D-24(a)**：插件**不内置任何书源**、不绕过登录与付费、**不执行 `@js:` 脚本**。
     *    这里存的是**用户自己的文件内容**（与各数据源 API Key / 音乐 Cookie 同款口径：明文存 `data.json`）。
     * 🔴 唯一键 = **站点地址**（`pure/sourceRule.sourceKey`）⇒ 重复导入算「更新」而不是追加。
     *    ⚠️ `disabled` 是**使用态**：合并导入时会**保留用户自己的开关**（不要被刷新重置）。
     * append-only 可选字段，旧数据无此键不迁移。
     */
    novelSources?: NovelSource[];
}

export const DEFAULT_SETTINGS: ReelLudicSettings = {
    tmdbApiKey: '',
    libraryDir: 'ReelLudic',
    doubanEnabled: false,
    platformTemplates: ['B站', 'Netflix', '豆瓣', '爱奇艺', '腾讯视频'],
    igdbClientId: '',
    igdbClientSecret: '',
    googleBooksApiKey: '',
    bangumiToken: '',
    doubanCookie: '',
    colorTheme: 'mono',
    localizePosters: false,
    defaultViewMode: 'grid',
    hideScrollbars: false,
    posterDensity: 'standard',
    posterColumns: 6,
    uiTheme: 'modern',
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
    musicDownloadEnabled: false,
    // #459：这两项的值 = **目录本身**（不再由代码拼 `音乐/` `书籍/` 子目录）⇒ 缺省就得带上子目录名，
    //   否则老用户/新装用户的默认落点会从 `下载/音乐` 变成 `下载/`（与既有文件分家、检索扫不到）。
    musicDownloadDir: DOWNLOAD_DIR_DEFAULT.music,
    bookDownloadDir: DOWNLOAD_DIR_DEFAULT.book,
    musicDlCookies: {},
    // #496：空串 = 用系统 PATH 里的 yt-dlp（见 `ytdlpPath` 字段注释，⛔ 别填成 `yt-dlp`）
    ytdlpPath: '',
};

export const PLATFORM_URL_PRESETS: Record<string, string> = {
    B站: 'https://www.bilibili.com/search?keyword=',
    Netflix: 'https://www.netflix.com/search?q=',
    豆瓣: 'https://search.douban.com/movie/subject_search?search_text=',
    爱奇艺: 'https://so.iqiyi.com/so/q_',
    腾讯视频: 'https://v.qq.com/x/search/?q=',
};

/** ① 元数据源配置折叠项内**需 Key 源**展示顺序（spec S5 + IGDB 回归：Douban/TMDB/Bangumi/OMDb/Google Books/IGDB；遍历 PROVIDERS 派生，本表定序）
 *  ⛔ 2026-09-29：原来还有一张「免 Key 源展示顺序」表（Open Library/Steam/MusicBrainz/iTunes/AniList）——
 *     那一批只读行随用户要求整体删除（「不显示这类凭据」），表随之退场。
 *  🔴 #488：类型从 `ProviderId` **收窄成 `KeySourceId`**（`pure/sourceIcons` 那张图标表的键）——
 *     这样「加一个凭据源却忘了配图标」会在**编译期**报错，⛔ 别再退回宽类型（那会静默缺图标）。 */
const KEY_SOURCE_ORDER: readonly KeySourceId[] = ['douban', 'tmdb', 'bangumi', 'omdb', 'googleBooks', 'igdb'];

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

/** 需 Key 但 Key 可选的数据源（未配仍照常工作，仅限流；空态徽标文案标「可选」而非「未配置」） */
const OPTIONAL_KEY_SOURCES: ReadonlySet<ProviderId> = new Set(['googleBooks']);

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
        const input = wrap.createEl('input', {
            cls: 'rl-secret-input',
            attr: { placeholder: opts.placeholder, type: 'password', spellcheck: 'false' },
        });
        input.value = opts.value;
        const toggle = wrap.createEl('button', { cls: 'rl-secret-eye', attr: { type: 'button', 'data-tip': '显示 / 隐藏' }, text: '显示' });
        const apply = (show: boolean) => {
            input.type = show ? 'text' : 'password';
            toggle.setText(show ? '隐藏' : '显示');
        };
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
     *    **「元数据源凭据 → 音乐源凭据 →（书籍源凭据）→ 元数据源启用」**——凡「凭据」一律排到「启用」之前。
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
        this.createGroupSection(parent, '元数据源凭据', (body) => {
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
        this.createGroupSection(parent, '音乐源凭据', (body) => this.renderMusicCookieRows(body));
        // 2026-09-28 #419（用户：「改成接内容源，按我给参考的软件做」）：
        //    **书源**自成一组 —— 书源是**内容源**，与「元数据源凭据」同类，故放本页而非「数据与备份」。
        // #422（用户：「网文书源改成『书籍源凭据』加个图标，把网络文学源和经典文学源分组折叠起来，
        //    分别加导入按钮」）：标题改名 + 组内拆成两个可折叠小节，见 `renderBookSourceFold`。
        // 🔴 #468 封禁：这一整组**不再渲染** —— 书源是内容源，本来就是给「下载书籍」用的，
        //    下载入口全封之后它就是个没有消费者的死块（用户 2026-10-01 选「一起封」）。
        //    ⛔ 别改成「留个空组壳」或「留着只读展示」。
        //    解禁 = 翻 `pure/featureGate.BOOK_DOWNLOAD_ENABLED`。
        if (BOOK_DOWNLOAD_ENABLED) {
            this.createGroupSection(parent, '书籍源凭据', (body) => this.renderBookSourceFold(body));
        }
        this.createGroupSection(parent, '元数据源启用', (body) => {
            for (const g of GROUP_DISPLAY_ORDER) this.createGroupCheckRow(body, g);
        });
        // ⛔ 2026-09-27 #399 起「音乐集成」分组已整体撤除（用户：「把设置页-音乐集成分组和其下项都删除掉」）。
        //    「启用歌曲下载」「下载目录」两项随之从**本页**消失：下载能力改由**「启用内置音乐播放器」**
        //    （基本设置 · 实验性功能）单点门控。
        //    ⚠️ 2026-09-28 #403：「下载目录」**在「基本设置 › 数据与备份」里回来了**（改名「音乐下载路径目录」，
        //    因为它的字段一直是 `downloadSong` 的 root）⇒ ⛔ 别再把「目录类设置」加回本页。
    }

    /**
     * 「一键体检」的**上一次结果**（按 `sourceKey` 存 —— ⛔ 别按名字，两个源同名时会串行）。
     * ⚠️ 这是**会话内**的临时状态（不落库）：体检结果会过期，落库反而会误导（下次打开还显示上次的绿字）。
     */
    private srcCheckResults = new Map<string, SourceCheckResult>();

    /** #432 甲：打开「订阅 / 粘贴」弹窗（一个弹窗两条路，⛔ 不给用户多一个要记的入口） */
    private openSourceSubscribe(kind: SourceKind): void {
        new SourceSubscribeModal(this.app, {
            kindLabel: SOURCE_KIND_LABEL[kind],
            // ⛔ 这一行**不判分类**：拉取 / 解析全在宿主（`resolveSourceInput`），本处只转发
            onResolve: (input, onProgress, cancel) => this.plugin.resolveSourceInput(input, { onProgress, cancel }),
            onApply: (r) => this.plugin.mergeNovelSources(r.sources, kind, r.skipped.map((s) => `${s.name}：${s.reason}`)),
        }).open();
    }

    /**
     * #432 甲：跑一轮体检并写回源行小字。
     *
     * 🔴 三件都别省：① 按钮**当帧**进「体检中…」并在每源回来时更新计数（用户要知道它没死）；
     *    ② 跑完 `display()` 重渲染把结果落到源行上（⛔ 只改内存不重渲染 = 看起来没反应）；
     *    ③ 结果**只说事实**（N 条可用 / M 条不可用），⛔ 不评价、⛔ 不把「搜到 0 条」算坏。
     */
    private async runSourceCheck(kind: SourceKind, btn: HTMLButtonElement): Promise<void> {
        const label = SOURCE_KIND_LABEL[kind];
        const total = this.plugin.novelSourcesOf(kind).filter((s) => s.disabled !== true).length;
        if (!total) {
            new Notice(`「${label}」里还没有启用中的书源。`);
            return;
        }
        const t0 = Date.now();
        btn.disabled = true;
        btn.setText(`体检中 0/${total}`);
        const token = createCancelToken();
        const modal = new Modal(this.app);
        modal.titleEl.setText(`正在体检「${label}」`);
        modal.contentEl.createDiv({ cls: 'rl-cancel-note', text: '逐条试搜一次；关掉本窗口即取消。' });
        const cancelBtn = modal.contentEl.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancelBtn.addEventListener('click', () => {
            token.stop();
            cancelBtn.setText('取消中…');
            cancelBtn.disabled = true;
        });
        modal.open();
        let done = 0;
        try {
            const results = await this.plugin.checkNovelSources(
                kind,
                (r) => {
                    done++;
                    this.srcCheckResults.set(r.key, r);
                    btn.setText(`体检中 ${done}/${total}`);
                },
                token,
            );
            for (const r of results) if (r) this.srcCheckResults.set(r.key, r);
            new Notice(sourceCheckSummaryText(results.filter(Boolean), Date.now() - t0), 8000);
        } catch (e) {
            // ⚠️ 取消**不是失败**（用户自己按的）—— 中性提示，⛔ 不报红（本仓 #428 口径）
            if (e instanceof CancelledError) new Notice(`已取消体检（已完成 ${done}/${total} 条）`, 6000);
            else new Notice(`体检出错：${e instanceof Error ? e.message : String(e)}`, 8000);
        } finally {
            modal.close();
            btn.disabled = false;
            btn.setText('体检');
            this.display(); // 🔴 把结果落到源行小字上（⛔ 不重渲染 = 用户看不到任何变化）
        }
    }

    /**
     * 「元数据源配置」页 · **「书籍源凭据」组**（#419 建立；**#422 拆成两个可折叠小节**）：
     * 导入 / 启停 / 删除 / 改分类用户自备的 SoNovel 格式书源。
     *
     * 🔴 红线 **D-24(a)**：**不内置任何书源**、不绕过登录与付费、**不执行 `@js:` 脚本**
     *    （含脚本的源照常可导入，但会标出「已降级」）。
     * ⚠️ 书源文件是**用户自己的东西**（提示语里说清「由你自备」），与各元数据源 Key / 音乐 Cookie 同款口径。
     *
     * 🔴 **#422 为什么拆两个小节**：书源分「网络文学源」「经典文学源」两类（`pure/sourceRule.SourceKind`），
     *    而这两类在**检索时是分开用的** —— 网文条目只拿网文源搜、文学条目只拿文学源搜。
     *    混在一列里用户既分不清哪个是哪个，也没法「我只想导一批文学源」。
     *    ⇒ 各自成节、各自带**导入按钮**（导入即归类），并各自可折叠（条数多起来时整页不被撑爆）。
     */
    private renderBookSourceFold(body: HTMLDivElement): void {
        // ⛔ 2026-09-29（用户上手当天，第二处删除）：这一组原来顶着一句**组级提示**（说明书源是用户自备的
        //    SoNovel 格式 .json、且含脚本的源会被标记但脚本不执行）—— 用户看过后说「将这个删除掉……太丑了」，
        //    **已整体删除**。⚠️ 这里刻意**不把那句原文抄进注释**：产物**不剥注释**，抄进来会让
        //    「这句不许回潮」的反向守卫自撞红（本仓踩过多次的老坑）。
        //    信息没丢：①「由你自备」这件事在**弹窗空态**那句里写着，也在两个小节的空态提示里写着；
        //    ②「含脚本会被标记」是**逐条**的事 —— 源行 desc 里本来就有「已降级」体检小字，比组级笼统声明更准。
        //    ⇒ 组内第一个元素直接就是「网络文学源」小节（少了那段两行灰字，整组清爽很多）。
        const counts = this.plugin.novelSourceCounts();
        for (const kind of SOURCE_KINDS) this.renderSourceSubsection(body, kind, counts[kind]);
        // ⛔ 2026-09-29（用户上手后：「太丑了，把清空全部按钮删除掉」）：**这里不再有「清空全部」** ——
        //    两个小节已经把「哪一类」分开了，而那个按钮孤零零落在组尾右下角、与上面两行都不成组，
        //    观感上像一块浮出来的色块。清空不再是必需能力：源行各自带删除（带二次确认），
        //    书源本来就是用户自己导入的少数几条（实测 11 条），逐条删既够用也更不容易误伤。
        //    ⚠️ 连带 `main.clearNovelSources()` 一并退场（没了调用方就是死码）；反向守卫钉着不许回潮。
    }

    /**
     * 书源**小节**（网络文学源 / 经典文学源）：可折叠行头 + 展开后的书源列表。
     *
     * 🔴 行形态照抄上面的 `rl-key-row` 折叠行（源名 + 徽标 + ▸），这是设置页唯一的折叠语汇，
     *    ⛔ 别为这两个小节另造一套（观感会跟源行、Cookie 行打架）。
     * 🔴 **「导入…」放在行头**、不是展开后 —— #421 的教训：入口被折叠藏起来，用户就以为「根本不能导入」。
     * ⚠️ 行头里那枚按钮的 `margin-left: auto` 与 caret 的 `margin-left: auto` **会平分剩余空间**
     *    （首版就是这样：按钮停在中间、离右边 caret 一大段空白，用户上手第一句就是「太丑了」）。
     *    ⇒ styles.css 里配了一条 `.rl-src-import + .rl-key-caret { margin-left: 0 }` 把 caret 的 auto 收掉。
     *    行头那个 click 是折叠开关，所以按钮里**必须 `stopPropagation`**（否则点导入会顺手把面板折上）。
     * ⚠️ 与上面各组不同，本页的**子分组**刻意是静态常量（`createGroupSection` 不折叠）——
     *    这里折叠是用户 2026-09-29 点名要的，只给这两个小节开，⛔ 别顺手把 `createGroupSection` 也改成可折叠。
     */
    private renderSourceSubsection(parent: HTMLDivElement, kind: SourceKind, count: number): void {
        const row = parent.createDiv({ cls: 'rl-key-row' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        head.createSpan({ cls: 'rl-key-name', text: SOURCE_KIND_LABEL[kind] });
        head.createSpan({ cls: 'rl-key-badge', text: `${count} 条` });
        // 🔴 #432 甲：行头从「一枚导入按钮」变成**一组**（订阅… / 体检 / 导入…），故包一层 `.rl-src-tools`：
        //    · `margin-left: auto` 挂在这一层上 ⇒ 三个按钮**成组靠右**（⛔ 别让每个按钮各带 auto —— 那会把
        //      剩余空间**平分**成几段空白，正是 #422 那轮「按钮停在中间」的同一个坑）；
        //    · caret 的 `margin-left: auto` 由 `.rl-src-tools + .rl-key-caret` 收掉（选择器随之从
        //      `.rl-src-import + .rl-key-caret` 改过来 —— 直接前一个兄弟现在是这一层了）。
        //    ⚠️ 「导入…」**保持在组内最后一位**：它那套 `<label>` + 内嵌 input 的原生关联是 #425 第三次修才治好的，
        //      ⛔ 别动它的位置与结构（断言两头都钉着）。
        const ops = head.createDiv({ cls: 'rl-src-tools' });
        const subBtn = ops.createEl('button', { cls: 'rl-btn rl-src-sub', text: '订阅…' });
        subBtn.setAttribute('data-tip', '粘贴订阅地址或书源 JSON');
        subBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSourceSubscribe(kind);
        });
        const checkBtn = ops.createEl('button', { cls: 'rl-btn rl-src-check', text: '体检' });
        checkBtn.setAttribute('data-tip', `逐条试搜（0 条≠坏了）`);
        checkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.runSourceCheck(kind, checkBtn);
        });
        // 🔴 #439 整批改分类（源行那枚是**单条**）：`kind` 是**本地状态**、无法从内容反推，
        //    一次误点的整批错位只能逐条点回来（11 条 = 11 次）；更糟的是「本类为空」时
        //    这一组里**根本没有源行可点**（用户当时看到的就是「换到网文条目里一条书源都看不见」）。
        //    ⇒ 补一枚**整组**操作。⚠️ 位置：**「导入…」必须留在组内最后一位**（它那套
        //    `<label>` + 内嵌 input 的原生关联是 #425 第三次修才治好的，⛔ 别动它的位置与结构）。
        //    ⚠️ 这是**批量**操作 ⇒ 按本仓「批量操作前置确认」的既有规矩走 `ConfirmModal`
        //    （单条那枚不确认；整组一次搬 11 条，误点的代价太大）。
        //    ⚠️ 本组为空时不渲染：没有东西可搬（**另一组**的那枚才是「搬进来」）。
        if (count > 0) {
            const other: SourceKind = kind === 'novel' ? 'book' : 'novel';
            const moveAll = ops.createEl('button', { cls: 'rl-btn rl-src-moveall', text: '移到另一组' });
            moveAll.setAttribute('data-tip', `把这 ${count} 条整批归到「${SOURCE_KIND_LABEL[other]}」`);
            moveAll.addEventListener('click', (e) => {
                e.stopPropagation();
                void (async () => {
                    const ok = await new ConfirmModal(
                        this.app,
                        `把「${SOURCE_KIND_LABEL[kind]}」这 ${count} 条整批归到「${SOURCE_KIND_LABEL[other]}」？\n（分类是本地状态，源文件里没有这项 —— 搬错了就在对面那组再点一次搬回来）`,
                        '整批移动',
                    ).open();
                    if (!ok) return;
                    const moved = this.plugin.moveAllNovelSources(kind, other);
                    new Notice(
                        moved > 0 ? `已把 ${moved} 条书源归到「${SOURCE_KIND_LABEL[other]}」` : '这一组已经没有书源了',
                        5000,
                    );
                    this.display();
                })();
            });
        }
        const imp = mountFilePickLabel(ops, {
            cls: 'rl-btn rl-src-import',
            text: '导入…',
            tip: `导入一份 .json 书源文件；导进来的源归到「${SOURCE_KIND_LABEL[kind]}」`,
            onText: (text) => this.applyImportedSources(text, kind),
            onError: (e) => new Notice(`读取书源文件失败：${e instanceof Error ? e.message : String(e)}`, 8000),
        });
        // ⚠️ 只 `stopPropagation`（行头那个 click 是折叠开关）—— ⛔ 别 `preventDefault()`：
        //    那把 label 的激活转发一并挡掉，就又回到「点了没反应」。
        imp.addEventListener('click', (e) => e.stopPropagation());
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));

        const body = row.createDiv({ cls: 'rl-key-body' });
        const list = this.plugin.novelSourcesOf(kind);
        if (!list.length) {
            body.createDiv({ cls: 'rl-hint-note', text: '这一组还没有书源 —— 点右上角「导入…」挑一份 .json（书源由你自备）。' });
        }
        for (const src of list) this.renderNovelSourceRow(body, src, kind);
    }

    /**
     * 一条书源行：名称 + 站点/体检小字 + 启停开关 + **改分类** + 删除。
     * 🔴 「改分类」的图标用**目标那一组**的图标（网文↔文学），用户一眼看出「点它去哪」。
     * ⚠️ 改完要 `this.display()` 重渲染（条目要挪到另一个小节里去 —— 只改数据不动 DOM 会看起来没反应）。
     */
    /**
     * 一条书源行：名称 + 站点/体检小字 + 启停开关 + **改分类** + 删除 + **就地改 Cookie**（#457 C′）。
     * 🔴 「改分类」的图标用**目标那一组**的图标（网文↔文学），用户一眼看出「点它去哪」。
     * ⚠️ 改完要 `this.display()` 重渲染（条目要挪到另一个小节里去 —— 只改数据不动 DOM 会看起来没反应）。
     *
     * 🔴 C′ 为什么是「源行下面一整行」而不是行内再塞一枚图标按钮：
     *    ① 行内已经有「开关 + 移到另一组 + 删除」三件，再挤一枚就放不下了；
     *    ② 更硬的理由是**图标名**：`cookie` / `lock` / `shield` 都不在本仓核实过的名单里，
     *       `setIcon` 遇到未知名是**静默失败** ⇒ 那会是一枚空白按钮（本仓踩过）。
     *    ⇒ 用一行文字标签 + 输入框，既不会空白，也放得下说明。
     */
    private renderNovelSourceRow(body: HTMLDivElement, src: NovelSource, kind: SourceKind): void {
        const s = sourceSummary(src);
        const key = sourceKey(src);
        // 站点 + 体检小字（含脚本 / 需登录 / 含 XPath 都在 warning 里，逐条说清）
        // 🔴 #432：**再加**上一次「一键体检」的结果（可用 / 不可用 + 时延 + 条数）——
        //    静态体检说「字段缺不缺」，这里说「这条源现在还能不能用」，两回事，都留着。
        const health = this.srcCheckResults.get(key);
        const desc = [s.host, s.warning, health ? sourceCheckHealthText(health) : ''].filter(Boolean).join(' · ');
        const other: SourceKind = kind === 'novel' ? 'book' : 'novel';
        new Setting(body)
            .setName(s.name)
            .setDesc(desc)
            .addToggle((t) => t.setValue(!s.disabled).onChange((v) => this.plugin.setNovelSourceEnabled(key, v)))
            .addExtraButton((b) =>
                b
                    .setIcon(other === 'book' ? 'library-big' : 'scroll-text')
                    .setTooltip(`移到「${SOURCE_KIND_LABEL[other]}」`)
                    .onClick(() => {
                        this.plugin.setNovelSourceKind(key, other);
                        this.display();
                    }),
            )
            .addExtraButton((b) =>
                b
                    .setIcon('trash-2')
                    .setTooltip('删除这条书源')
                    .onClick(() => {
                        void (async () => {
                            const ok = await new ConfirmModal(this.app, `删除书源「${s.name}」？`, '删除').open();
                            if (!ok) return;
                            this.plugin.removeNovelSource(key);
                            this.display();
                        })();
                    }),
            );

        // ── #457 C′：**就地改 Cookie** —— 以前改一次 Cookie 要重导一整份 .json，现在改完即存。
        //    ⚠️ 提交口径 = **失焦 / 回车**（与设置页目录项同款）；**没改动就不写盘**（⛔ 别每次失焦都落一次盘）。
        const cookieRow = body.createDiv({ cls: 'rl-src-cookie' });
        cookieRow.createSpan({ cls: 'rl-src-cookie-l', text: 'Cookie' });
        const cookieInput = cookieRow.createEl('input', {
            cls: 'rl-input',
            attr: {
                type: 'text',
                spellcheck: 'false',
                placeholder: '需要登录的源：登录后把 Cookie 粘到这里（凭据由你自备；留空即清除）',
            },
        });
        const saved = String(src?.search?.cookies ?? '').trim();
        cookieInput.value = saved;
        const commitCookie = (): void => {
            const v = cookieInput.value.trim();
            if (v === saved) return;
            this.plugin.setNovelSourceCookie(key, v);
            new Notice(v ? `已保存「${s.name}」的 Cookie` : `已清空「${s.name}」的 Cookie`, 3000);
        };
        cookieInput.addEventListener('blur', commitCookie);
        cookieInput.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            cookieInput.blur(); // 回车 ⇒ 失焦 ⇒ 走同一个提交口
        });
    }

    /**
     * 把**已经读到的**书源文本导入（#425）。
     *
     * 🔴 与「下载书籍」弹窗**共用宿主的 `importNovelSources(text, kind)`** —— 那边也是自己在
     *    Svelte 模板里读文件、再把文本交过来。⛔ 别再退回「宿主自己弹文件框」那条路：
     *    文件框必须挂在**调用方自己的 DOM 上**（设置页的 label / 组件里的 label），宿主拿不到。
     */
    private applyImportedSources(text: string, kind: SourceKind): void {
        const r = this.plugin.importNovelSources(text, kind);
        new Notice(r.message, r.ok ? 5000 : 8000);
        if (r.ok) this.display();
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
                badge.setText(has ? '已配置' : '未配置');
                badge.toggleClass('rl-key-badge-on', has);
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
                    refreshBadge();
                },
            });
            // 「测试连接」与源行同款反馈（✓/✗ 文案 · Nms；失败红、成功绿）
            const actions = body.createDiv({ cls: 'rl-key-actions' });
            const resultEl = actions.createSpan({ cls: 'rl-key-result' });
            const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
            testBtn.addEventListener('click', async () => {
                testBtn.disabled = true;
                testBtn.setText('测试中…');
                testBtn.addClass('rl-btn-loading');
                resultEl.setText('');
                resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
                const started = Date.now();
                const r = await this.plugin.dlTestConnection(p.id, current());
                const elapsedMs = Date.now() - started;
                testBtn.disabled = false;
                testBtn.setText('测试连接');
                testBtn.removeClass('rl-btn-loading');
                resultEl.setText(`${r.ok ? '✓ ' : '✗ '}${r.message} · ${elapsedMs}ms`);
                resultEl.toggleClass('rl-key-result-ok', r.ok);
                resultEl.toggleClass('rl-key-result-bad', !r.ok);
            });
            head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
        }
        // ── ④-B 站下载（#496）：yt-dlp 可执行文件路径 ──
        // 🔴 为什么排在**同一个组**里：它是「下载这一件事的配置」，与三条 Cookie 一起读最省事；
        //    但它是**路径不是凭据** ⇒ 输入框走明文（不挂「显示/隐藏」眼睛），⛔ 别用 `createSecretField`。
        // ⚠️ 这行是**追加**在 `DL_COOKIE_ROWS` 循环**之后**的 —— #488/#489 那几条按「循环体内前几行」
        //    锚死的断言因此不受影响（改这里别把循环挪走）。
        const dlRow = list.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const dlHead = dlRow.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(dlHead.createSpan({ cls: 'rl-ai-icon' }), { kind: 'builtin', id: 'terminal' });
        dlHead.createSpan({ cls: 'rl-key-name', text: 'yt-dlp（B站下载）' });
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
    ): void {
        const wrap = parent.createDiv({ cls: 'rl-svc-group' });
        const head = wrap.createDiv({ cls: 'rl-svc-group-title' });
        // 图标按标题从真源取；未登记则跳过（只是缺个图标，不抛错）
        const icon = groupIcon(title);
        if (icon) safeSetIcon(head.createSpan({ cls: 'rl-svc-group-icon' }), icon);
        head.createSpan({ text: title });
        // ⛔ #490：这里原有一行「组级说明」（`if (note) …`）—— 已随第 4 参一并删除（死码不留）
        const body = wrap.createDiv({ cls: 'rl-svc-group-body' });
        fill(body);
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
     * #483：**服务商卡片列表**（四家）。⛔ 别在这里另写一套行 —— 仍是
     * `renderTranslateKeyBlock` / `renderCustomEndpointRow`，只是各自多挂 `.rl-prov-card`。
     */
    private renderProviderCards(body: HTMLDivElement): void {
        const list = body.createDiv({ cls: 'rl-prov-list' });
        // 各家 Key 始终都显示，不跟随用途里选了谁；翻译 / 总结 / 搜索三处共用前两家
        this.renderTranslateKeyBlock(list, 'zhipu', '智谱清言', 'readerZhipuKey', '你的智谱 API Key');
        this.renderTranslateKeyBlock(list, 'deepseek', 'DeepSeek', 'readerDeepseekKey', 'sk-…');
        // #487（用户指令）：**删掉**这一行的说明文案「AI 翻译 / 总结 / 搜索与朗读云合成共用这一个 Key」
        //     —— 因此这里退回**四参**调用（`note` 是可选的；组件能力保留，别的地方还用）。
        this.renderTranslateKeyBlock(list, 'siliconflow', '硅基流动', 'readerSiliconflowKey', 'sk-…');
        // #478：自定义 OpenAI 兼容端点（base URL + Key）
        this.renderCustomEndpointRow(list);
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
        btn.createSpan({ cls: 'rl-ai-pick-text', text: model || aiPickText(choice, model) });
        btn.createSpan({ cls: 'rl-ai-caret', text: '▾' });
        // 🔴 #481 ②（用户：模型名过长会把格子撑满 / 各行宽度不一）：
        //    控件**固定宽度**（`--rl-ai-ctl-w`，样式层），文本超出走省略号 ⇒ 悬停提示必须给全称。
        //    🔴 #494：文本已经只剩模型名，所以气泡改给**完整串**「服务商 · 模型」—— 复用 `aiPickText`
        //    这**一个真源**（⛔ 别另拼一个格式），且只在有模型时挂（「不启用」时文本已是全称）。
        //    走 `data-tip` 自绘气泡（本仓 UI 规范：禁原生 `title` 黄条），由全局 tooltip 委托读取。
        if (model) btn.setAttribute('data-tip', aiPickText(choice, model));
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

    /** 当前生效的模型名：存的值 → 该家默认（`custom` 无默认 ⇒ 空串） */
    private shownModel(provider: TranslateProvider, picked: string | undefined): string {
        return (picked ?? '').trim() || DEFAULT_MODELS[provider];
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
            // 🔴 #484 ②：**就地**拉（弹窗自己转圈 / 报错）。⛔ 不再「关弹窗 → 请求 → 成功才重开」
            onFetch: (p) => this.fetchAiModels(p),
            onPick: (r: AiPickerPick) => {
                if (r.action === 'manual') {
                    new AiModelNameModal(this.app, {
                        title: `${serviceName} · ${providerLabel(r.provider)} 模型`,
                        placeholder: r.provider === 'custom' ? '填该端点支持的模型名' : '填模型名',
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
            badge.setText(has ? '已配置' : '未配置');
            badge.toggleClass('rl-key-badge-on', has);
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
                refreshBadge();
            },
        });

        // 测试（#485 用户裁定：**放回折叠体内**，像书籍源 / 音乐源 Cookie 那样展开才见）
        this.attachProviderTest(bodyEl, () =>
            provider === 'siliconflow' ? this.plugin.testSpeechConnection() : this.plugin.testTranslateConnection(provider),
        );
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        // 头点击展开/收起（必须绑 click 加 .rl-key-open，否则 .rl-key-body 恒 display:none 打不开）
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 「模型服务」组的**自定义端点**卡片行（#478 / #483 卡片化）：base URL + Key + 测试连接。
     *
     * 🔴 与上面三家**同款折叠行**（`rl-key-row` 那套），但体里是**两个输入** —— 所以没复用
     *    `renderTranslateKeyBlock`（它只服务「单 Key」：云合成那把 Key 没有 baseURL 概念）。
     * ⚠️ baseURL 走**明文**输入（它不是密钥，且用户要核对有没有少写 `…/v1`）；Key 仍走密文字段。
     * ⚠️ 提交口径 = **失焦 / 回车**（与目录项同款）；归一在 `pure/translate.normalizeAiBaseUrl`（⛔ 别另写一份）。
     */
    private renderCustomEndpointRow(parent: HTMLDivElement): void {
        const row = parent.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        // #479：自定义端点没有品牌标（LobeHub 无 `custom`）⇒ 内置 `plug`；⛔ 不拿 OpenAI 标顶替
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), AI_PROVIDER_ICON.custom);
        head.createSpan({ cls: 'rl-key-name', text: '自定义端点' });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            const has = !!this.settingValue('readerCustomBaseUrl') && !!this.settingValue('readerCustomKey');
            badge.setText(has ? '已配置' : '未配置');
            badge.toggleClass('rl-key-badge-on', has);
        };
        refreshBadge();

        const bodyEl = row.createDiv({ cls: 'rl-key-body' });
        // #487（用户指令）：**删掉**这行说明（「任意 OpenAI 兼容服务（通义千问 / Kimi / OpenRouter / 本地 Ollama…）
        //     —— 填 base 或整条 /chat/completions 都能识别」）。⛔ 别再加回：那段话解释的是**归一化能力**，
        //     而它由 `pure/translate.normalizeAiBaseUrl` 保证，用户填错时占位符与测试连接已经能说清。
        // ① base URL（明文）
        const baseInput = bodyEl.createEl('input', {
            cls: 'rl-input',
            attr: { type: 'text', spellcheck: 'false', placeholder: 'https://api.example.com/v1' },
        });
        baseInput.value = this.settingValue('readerCustomBaseUrl');
        const baseHint = bodyEl.createDiv({ cls: 'rl-hint-note' });
        const commitBase = (): void => {
            const raw = baseInput.value.trim();
            if (!raw) {
                this.plugin.settings.readerCustomBaseUrl = undefined;
                baseHint.setText('');
                baseHint.toggleClass('is-error', false);
                void this.plugin.saveSettings();
                refreshBadge();
                return;
            }
            const issue = aiBaseUrlIssue(raw);
            if (issue) {
                baseHint.setText(`${issue}（未生效，当前仍是「${this.settingValue('readerCustomBaseUrl') || '未配置'}」）`);
                baseHint.toggleClass('is-error', true);
                return;
            }
            const next = normalizeAiBaseUrl(raw);
            baseInput.value = next; // 回显归一化后的值（补上的 https:// / 去掉的尾斜杠都能看见）
            this.plugin.settings.readerCustomBaseUrl = next;
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
            placeholder: '自定义端点的 API Key',
            value: this.settingValue('readerCustomKey'),
            onInput: (v) => {
                this.plugin.settings.readerCustomKey = v || undefined;
                void this.plugin.saveSettings();
                refreshBadge();
            },
        });

        // ③ 测试（#485：**放回折叠体内**，与 cookie 同款）
        //    🔴 #486：**不再传「翻译服务」的模型** —— 那是另一家的模型名，拿它测这条端点必然
        //       「No available channel for model …」（实测 91hub：503）。现在由 `testTranslateConnection`
        //       自己去问这条端点「你有什么」，再挑一个像文本对话的来 ping。
        this.attachProviderTest(bodyEl, () => this.plugin.testTranslateConnection('custom'));
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
    ): void {
        // 与 cookie 那处同款：同一行里「结果文字 + 测试连接」
        const actions = bodyEl.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        const btn = actions.createEl('button', { cls: 'mod-cta', text: '测试连接' });
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.setText('测试中…');
            btn.addClass('rl-btn-loading'); // 1.0.4：内联 spinner（文字由 .rl-btn-loading 置透明）
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const res = await run();
            btn.disabled = false;
            btn.setText('测试连接');
            btn.removeClass('rl-btn-loading');
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            // 反馈配色（用户 2026-09-14 裁定）：失败才红，成功一律绿 —— 不再区分「偏慢」档
            resultEl.toggleClass('rl-key-result-ok', res.ok);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
        });
    }

    /** settings[keyField] 安全读（凭据字符串；未知键回退 ''） */
    private settingValue(key: string): string {
        const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
        return typeof v === 'string' ? v : '';
    }

    /** 测试连接分派：Douban/TMDB/Bangumi → plugin 既有 testXxx；OMDb/Google Books → T9/T11 新增测试 */
    private testConnectionFor(id: ProviderId): Promise<SourceTestResult> {
        switch (id) {
            case 'douban':
                return this.plugin.testDoubanConnection();
            case 'tmdb':
                return this.plugin.testTmdbConnection();
            case 'bangumi':
                return this.plugin.testBangumiConnection();
            case 'omdb':
                return this.plugin.testOmdbConnection();
            case 'googleBooks':
                return this.plugin.testGoogleBooksConnection();
            case 'igdb':
                return this.plugin.testIgdbConnection();
            default:
                return Promise.resolve({ ok: false, message: '该源无可用测试', elapsedMs: 0 });
        }
    }

    /** 密文输入占位符（按源给出引导语境） */
    private credentialPlaceholder(meta: ProviderMeta): string {
        if (meta.id === 'douban') return 'Douban Cookie（登录态）';
        if (meta.id === 'bangumi') return '输入 Bangumi Access Token';
        if (meta.id === 'googleBooks') return 'API Key（可选，提配额）';
        if (meta.id === 'igdb') return 'IGDB Client ID';
        return `输入 ${meta.label} API Key`;
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
        const row = parent.createDiv({ cls: 'rl-key-row rl-prov-card' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        renderAiIcon(head.createSpan({ cls: 'rl-ai-icon' }), SOURCE_ICON[id]);
        head.createSpan({ cls: 'rl-key-name', text: meta.label });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            const has = !!this.settingValue(keyField) && (!keyField2 || !!this.settingValue(keyField2));
            if (has) {
                badge.setText('已配置');
                badge.toggleClass('rl-key-badge-on', true);
            } else {
                badge.setText(OPTIONAL_KEY_SOURCES.has(meta.id) ? '可选 Key' : '未配置');
                badge.toggleClass('rl-key-badge-on', false);
            }
        };
        refreshBadge();
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        const body = row.createDiv({ cls: 'rl-key-body' });
        body.createDiv({ cls: 'rl-hint-note', text: meta.hint });
        this.createSecretField(body, {
            placeholder: this.credentialPlaceholder(meta),
            value: this.settingValue(keyField),
            onInput: (v) => {
                (this.plugin.settings as unknown as Record<string, unknown>)[keyField] = v;
                void this.plugin.saveSettings();
                refreshBadge();
            },
        });
        // 双凭据源（IGDB：Client ID + Client Secret）：第二行密文输入
        if (keyField2) {
            this.createSecretField(body, {
                placeholder: 'IGDB Client Secret',
                value: this.settingValue(keyField2),
                onInput: (v) => {
                    (this.plugin.settings as unknown as Record<string, unknown>)[keyField2 as string] = v;
                    void this.plugin.saveSettings();
                    refreshBadge();
                },
            });
        }
        // 测试连接：✓/✗ 消息 · Nms；失败红色、成功绿色
        const actions = body.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
        testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            testBtn.setText('测试中…');
            testBtn.addClass('rl-btn-loading'); // 1.0.4：内联 spinner（文字由 .rl-btn-loading 置透明）
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const res = await this.testConnectionFor(meta.id);
            testBtn.disabled = false;
            testBtn.setText('测试连接');
            testBtn.removeClass('rl-btn-loading');
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
                attr: { id: pageDomId(page.id), role: 'tabpanel', 'aria-labelledby': tabDomId(page.id) },
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
        else this.renderAboutPage(body);
    }

    /**
     * 「基本设置」页（#354 合并三页）：**4 组 / 8 行**。
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
        this.createGroupSection(parent, '外观与体验', (body) => this.renderAppearanceRows(body));
        // 🔴 #490（用户 2026-10-02）：本组标题下那句风险提示**已按用户要求删除** ——
        //    #477 加的那个可选第 4 参**连同参数一起删除**（只有一个使用者 = 死码）。
        //    ⛔ 别再往回加；⚠️ 注释里刻意不抄那句原文（注释进产物，抄了会撞红自己的反向守卫）。
        this.createGroupSection(parent, '实验性功能', (body) => this.renderExperimentalRows(body));
        this.createGroupSection(parent, '数据与备份', (body) => this.renderDataBackupRows(body));
        this.createGroupSection(parent, '封面与清理', (body) => this.renderPosterCleanupRows(body));
    }

    /**
     * 「基本设置」页 · 第 1 组「外观与体验」（4 行）。
     *
     * 🔴 **子项顺序由用户点名（#411）**：「笔记表格 - 隐藏插件内滚动条 - 歌词逐字高亮 - 海报密度」。
     *    ⛔ 别按「谁先做的」排 —— 断言按本组函数体里 `setName` 的**出现顺序**钉住。
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

        // ── ① 笔记表格（用户 2026-09-18 建立；🔴 2026-09-28 #403 **从「数据与备份」搬到本组**，
        //    #411 又按用户点名排到本组**首位**）──
        //  它管的是**笔记正文长什么样**（那张「| 属性 | 内容 |」表写不写），与「外观与体验」同类。
        //  ⛔ 别搬回去（断言按分组函数体钉位置）。
        //  #477：位置口径按**事实**写「笔记顶部」—— `data/noteGenerator.generateNoteMarkdown` 的顺序 =
        //    顶部块（标题 + 封面 callout）→ **属性表格** → 歌词 → 评语 → 链接（⛔ 别写「底部」）。
        new Setting(parent)
            .setName('笔记表格')
            .setDesc('在笔记顶部插入属性表')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.noteTable !== false).onChange(async (value) => {
                    this.plugin.settings.noteTable = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── ② 隐藏插件内滚动条 ──
        new Setting(parent)
            .setName('隐藏插件内滚动条')
            .setDesc('隐藏插件界面的滚动条')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.hideScrollbars).onChange(async (value) => {
                    this.plugin.settings.hideScrollbars = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── ③ 歌词逐字高亮（#406 用户：「歌词滚动效果需支持逐字高亮（按时间均分）方式，
        //    请在设置页-外观与体验中新增该效果的开关项」）──
        //  🔴 只影响**内置音频播放器**里那一列歌词：当前行按字逐个点亮（`.rl-ap-lyr-w.is-on`）。
        //    时间从哪来：LRC 自带 `<mm:ss.xx>` 就用精确值，没有则由 `pure/lrc.parseLrc` 按
        //    「到下一行」**均分** ⇒ 用户说的「按时间均分」正是这条兜底。
        //  ⚠️ 读取口径 `!== false`（缺省开）；真源 `pure/lrc.wordIndexAt`（⛔ 视图层别自己写二分）。
        new Setting(parent)
            .setName('歌词逐字高亮')
            .setDesc('歌词按字逐一高亮显示')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.lyricsWordHighlight !== false).onChange(async (value) => {
                    this.plugin.settings.lyricsWordHighlight = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── ④ 海报密度（用户 2026-09-22）──
        // 三档 = 最小卡片宽度（紧凑 150 / 标准 180（历史值）/ 宽松 220），列数仍由容器宽度决定；
        // 「自定义列数」= 目标列数 + 最小卡片宽度保护（容器窄了自动减列）。纯逻辑见 pure/posterGrid。
        let colsInputEl: HTMLInputElement | null = null;
        let colsUnitEl: HTMLElement | null = null;
        const syncColsVisible = () => {
            const show = normalizePosterDensity(this.plugin.settings.posterDensity) === 'custom';
            const display = show ? '' : 'none';
            if (colsInputEl) colsInputEl.style.display = display;
            if (colsUnitEl) colsUnitEl.style.display = display;
        };
        new Setting(parent)
            .setName('海报密度')
            // #477：原「调整海报墙每行卡片数」= 复述标题（用户：「描述和标题意思重复」）⇒ 改为说**密度**本身。
            //   ⛔ 不加「（当前为紧凑）」—— 旁边的下拉框本来就显示当前档位，那句会把关键信息挤掉且推满 15 字。
            .setDesc('设置海报墙每行卡片密度')
            .addDropdown((d) => {
                for (const key of POSTER_DENSITIES) d.addOption(key, POSTER_DENSITY_LABELS[key]);
                d.setValue(normalizePosterDensity(this.plugin.settings.posterDensity)).onChange(async (value) => {
                    this.plugin.settings.posterDensity = normalizePosterDensity(value);
                    await this.plugin.saveSettings();
                    syncColsVisible();
                    this.plugin.syncPosterGrid();
                });
            })
            .addText((t) => {
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
        new Setting(parent)
            .setName('启用内置阅读器')
            .setDesc('启用后可在插件内阅读电子书')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalBookReader).onChange(async (value) => {
                    this.plugin.settings.internalBookReader = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(parent)
            .setName('启用内置视频播放器')
            // #477：用户「『影视』用词偏娱乐化，『视频文件』更标准」⇒ 改标准词
            .setDesc('启用后播放本地视频文件')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalMediaPlayback).onChange(async (value) => {
                    this.plugin.settings.internalMediaPlayback = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ④-4 音频播放器 + ⑤-c 歌曲下载的**唯一门控**（#399 起）：笔记里的 ` ```lrc ` 块是否就地渲染成播放器，
        // 以及音乐编辑表单是否给「下载」按钮 —— 两件事共用一个开关，⛔ 别再拆回两个。
        // 🔴 默认关（D-8(c)）：LyricFlux 注册了同名块处理器，两插件同时开会打架；
        //    且默认关能保证「升级后笔记外观不变」。开启后若检测到 LyricFlux 仍启用，本插件依然让位。
        new Setting(parent)
            .setName('启用内置音乐播放器')
            // #477：用户「『笔记里』表达不准确（播放器可能是全局的）」⇒ 去掉地点限定，只说能力。
            //   ⚠️ 「下载」这半个功能必须留着（门控的另一半 = 音乐表单的「下载」按钮），只是不再写「下载到哪」。
            .setDesc('启用后支持播放与下载音频')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.audioInlinePlayer).onChange(async (value) => {
                    this.plugin.settings.audioInlinePlayer = value;
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
        this.createLibraryDirRow(
            parent,
            '音频文件目录',
            // 🔴 #476 改用途式 → #477 按用户口径微调（「『下载与检索』稍微生硬」⇒「存放与检索」）；
            //    ⚠️ 顶掉的信息各有兜底：占位符 = 真实落点、提交后提示「将落到「X」文件夹」。
            '音频下载的存放与检索目录',
            () => this.plugin.settings.musicDownloadDir,
            async (next) => {
                this.plugin.settings.musicDownloadDir = next;
                await this.plugin.saveSettings();
            },
            'dl',
            'music',
        );
        // 🔴 #468 封禁：整个「书籍文件目录」项**不再渲染**（用户 2026-10-01：「设置页书籍文件路径也封禁掉」）。
        //    ⚠️ 字段本身照旧（`downloadDir(root,'book')` 仍读它，存量值不动、也不影响任何现存条目）——
        //    封的只是「让用户改它」这件事，⛔ 别顺手把字段也删了（schema append-only + 解禁要还原）。
        //    解禁 = 翻 `pure/featureGate.BOOK_DOWNLOAD_ENABLED`，下面这段还原缩进即可。
        if (BOOK_DOWNLOAD_ENABLED) {
            this.createLibraryDirRow(
                parent,
                '书籍文件目录',
                // 🔴 #476 改用途式 → #477 与音频那项**同款写法**（一致性；口径见 renderAppearanceRows）
                '书籍下载的存放与检索目录',
                () => this.plugin.settings.bookDownloadDir,
                async (next) => {
                    this.plugin.settings.bookDownloadDir = next;
                    await this.plugin.saveSettings();
                },
                'book',
                'book',
            );
        }

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
                    // 点击直接开始（无二次确认）：设置页内显示进度条（不关闭设置页）→ 结束后弹结果弹窗
                    prog.addClass('show');
                    fill.style.width = '0%';
                    textLabel.setText('正在迁移中… 0/0');
                    void this.plugin
                        .localizeAllPosters((done, total) => {
                            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                            fill.style.width = `${pct}%`;
                            textLabel.setText(`正在迁移中… ${done}/${total}`);
                        })
                        .then((result) => {
                            prog.removeClass('show');
                            new PosterMigrateModal(this.app, result).open();
                        });
                }),
            );

        // 迁移进度条（紧跟设置行下方，默认隐藏；迁移中显示「正在迁移中… N/M」）
        const prog = parent.createDiv({ cls: 'rl-mig-prog' });
        const bar = prog.createDiv({ cls: 'rl-mig-bar' });
        const fill = bar.createDiv({ cls: 'rl-mig-fill' });
        const text = prog.createDiv({ cls: 'rl-mig-text' });
        text.createSpan({ cls: 'rl-spinner' }); // 1.0.4：迁移中内联 spinner
        const textLabel = text.createSpan({ text: '正在迁移中…' });

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
     *    ⇒ 信息卡现在只剩**两枚按钮**（问题反馈 / 更新日志）；本页仍是两块 **`.rl-about`** 卡。
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
        const issueBtn = infoBtns.createEl('button', { cls: 'rl-about-btn', text: '问题反馈' });
        issueBtn.addEventListener('click', () =>
            window.open('https://github.com/fhb263/obsidian-reelludic/issues', '_blank'),
        );
        // 🔴 #491（用户 2026-10-03：「点击更新日志不跳转网页改成内置弹窗」）：原先是 `window.open(CHANGELOG.md)`
        //    ⇒ 改成在 Obsidian 里打开**内置弹窗**（正文见 `pure/releaseNotes`）。
        //    ⛔ 别再退回浏览器跳转；完整发布记录那条链在弹窗底部，由用户主动点。
        const logBtn = infoBtns.createEl('button', { cls: 'rl-about-btn', text: '更新日志' });
        logBtn.addEventListener('click', () => new ReleaseNotesModal(this.app).open());

        // ── ② 支持作者（#356 起的样子，⛔ 一字未改）──
        const about = parent.createDiv({ cls: 'rl-about' });
        const aboutText = about.createDiv({ cls: 'rl-about-text' });
        aboutText.createDiv({ cls: 'rl-about-title', text: '支持作者' });
        aboutText.createDiv({ cls: 'rl-about-desc', text: '如果 ReelLudic 对你有帮助，欢迎在 GitHub 上给个 ⭐，或通过爱发电支持一下～' });
        const aboutBtns = about.createDiv({ cls: 'rl-about-buttons' });
        const githubBtn = aboutBtns.createEl('button', { cls: 'rl-about-btn', text: 'Github' });
        githubBtn.addEventListener('click', () => window.open('https://github.com/fhb263/obsidian-reelludic', '_blank'));
        const afdianBtn = aboutBtns.createEl('button', { cls: 'rl-about-btn rl-about-btn-accent', text: '爱发电' });
        afdianBtn.addEventListener('click', () => window.open('https://ifdian.net/a/fhb263', '_blank'));
    }
}
