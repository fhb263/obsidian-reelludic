// ReelLudic 插件入口：命令/视图/设置注册 + 服务编排
import { Plugin, WorkspaceLeaf, MarkdownView, MarkdownRenderChild, requestUrl, TFile, TFolder, normalizePath, parseLinktext, Notice, Platform, moment, type FileSystemAdapter, type MarkdownPostProcessorContext } from 'obsidian';
import { DEFAULT_SETTINGS, ReelLudicSettingTab } from 'Settings';
import type { ReelLudicSettings, SourceTestResult } from 'Settings';
import { measure, withTimeout, TimedError, TIMEOUT_MS, retry } from 'pure/timing';
import { CLOUD_VOICE_DEFAULT, buildSpeechBody, classifySpeechError, speechEndpointUrl } from 'pure/ttsCloud';
import { createSearchCache } from 'pure/searchCache';
import { normalizeUiTheme, THEME_CLASS } from 'pure/themeTokens';
import { isNumberInputTarget, parseNumberBounds, wheelStepValue } from 'pure/numberWheel';
// #541「个性化体验」：主导航布局 / 起始页 / 卡片风格 / 界面动效（归一与 body 类名全在 pure 侧）
import { normalizeStartTab, normalizeStartTabFor, normalizeTabAxis, type TabAxis } from 'pure/homeTabs';
import { defaultNavLayoutFor, normalizeNavLayout } from 'pure/navLayout';
import {
    APPEARANCE_BODY_CLASSES, CARD_STYLE_CLASS, MOTION_CLASS, normalizeCardStyle, normalizeMotionMode,
} from 'pure/appearance';
import { checkAnimeUpdate, isBlockedPage, type UpdateCheckResult } from 'pure/updateCheck';
import { EntryService } from 'services/EntryService';
import { AiSummaryService } from 'services/aiSummary';
import { LrcBilingualService } from 'services/lrcBilingual';
// 🔴 2026-11-27（用m06545，逐字）：「不做AI挂件了，删除全部AI挂件相关代码。
//    AI 全局悬浮对话（services/aiChat + pure/aiChat + AiChatWidget.svelte）已整体删除。
//    别再补回来。下面这AI 导入与它无关*不可**跟着删。
//      AiSummaryService（条目摘要）、CueSummaryService（字幕总结）、LrcBilingualService（双语歌词）。
//      AiPrefillService（条目预填）、aiIcon（图标）、translate（翻译）。
// 字幕 AI 总结（详情页时间轴面板那按钮。
import { CueSummaryService } from 'services/cueSummary';
import type { AiSummaryInput, AiSummaryResult } from 'pure/aiSummary';
import type { CueSummaryInput, CueSummaryResult, CueAskTurn } from 'pure/cueSummary';
import type { LrcBilingualMerge } from 'pure/lrcBilingual';
// #499 AI 条目预填（新增条目「手动填写」界面标题行 ✨）
import { AiPrefillService } from 'services/aiPrefill';
import type { AiPrefillOutcome } from 'services/aiPrefill';
import type { AiPrefillInput } from 'pure/aiPrefill';
import { PREFILL_SYNOPSIS_PREFIX, PREFILL_TOOL_METADATA, PREFILL_TOOL_WEB_SEARCH } from 'pure/aiPrefill';
import { BING_SEARCH_UA, bingResultsToText, buildBingRssUrl, parseBingRss } from 'pure/bingSearch';
import { describeSearchResult, synopsisOf, type SearchResult } from 'pure/searchDisplay';
import { createVaultIO } from 'services/vaultIO';
import { TmdbClient, posterUrl as tmdbPosterUrl, type TmdbDetail, type TmdbSearchResult } from 'services/tmdb';
import type { BookSearchResult, GameSearchResult, MusicSearchResult, OmdbSearchResult } from 'services/resultTypes';
import { BangumiClient, type BangumiSearchResult } from 'services/bangumi';
import { DoubanClient, DoubanCookieError, toTmdbResult, toBookResult, toGameResult, toMusicResult, toBangumiResult, toEntryDetailFields, type DoubanSubject } from 'services/douban';
import { OpenLibraryClient } from 'services/openLibrary';
import { GoogleBooksClient, buildSearchUrl } from 'services/googleBooks';
import { MangaDexClient } from 'services/mangadex';
import { SteamClient } from 'services/steam';
import { MusicBrainzClient } from 'services/musicbrainz';
import { ItunesClient } from 'services/itunes';
import { OmdbClient, buildDetailUrl, type OmdbDetailFields } from 'services/omdb';
import { AnilistClient } from 'services/anilist';
import { IgdbClient } from 'services/igdb';
import { createSearchProgress, type SearchProgressCb, type SearchProgressReporter } from 'pure/searchProgress';
import { collectDayActivity, renderJournalBlock, todayLocal, upsertJournalSection } from 'pure/dailyLog';
import {
    FEED_RANGE_WORDS, collectFeed, feedSectionLabel, feedSpan, groupFeed, renderPeriodBlock, type FeedRange,
} from 'pure/activityFeed';
import type { ActivityEvent } from 'data/types';
import {
    nodeHttpGet,
    nodeHttpPost,
    nodeHttpGetBuffer,
    nodeHttpPostStream,
    type NodeHttpBufferResponse,
    type NodeHttpResponse,
} from 'services/nodeHttp';
import { fetchLyric, searchLyrics, type LyricFetchOutcome, type LyricSearchOutcome } from 'services/lyricSearch';
// 四平台下载面（#399-D 移植批）：搜索 / 歌单 / 下载 / 连通性测试全在 `services/dl`
import {
    DL_SEARCH_ORDER,
    dlDownloadSong,
    dlPlaylistSongs,
    dlPreviewAudio,
    dlRecommendedPlaylists,
    dlSearch,
    neteaseCoversByIds,
    dlTestConnection,
    type DlPreviewResult,
    type DlTransport,
    type DownloadProgressCallback,
    type DownloadSong,
    type PlaylistSource,
    type RecommendedPlaylist,
} from 'services/dl';
import { MusicDownloadModal } from 'modals/MusicDownloadModal';
// #496 B 站：搜索两步请求在 `services/dl/bilibili`，起 yt-dlp 进程在 `services/ytdlp`
// 🔴 两者都不在 `services/dl` 里 —— 那边是**四平台音乐**（直连音频流），这边是**视频站 + 外部进程**，
//    混进去会让「四平台」这条链路的职责说不清。
import { dlBiliSearch, dlBiliView } from 'services/dl/bilibili';
// #529 书籍「检索在线书籍阅读」：微信读书网页版搜索（服务层只发请求，形态在 `pure/weread`）
// 🔴 #580：同一份服务层再供两条路 —— 「测试连接」（Cookie 打书架接口）与 **book 组元数据检索**
//    （`searchWereadMeta` 复用同一个免登录搜索 + 同一份解析/映射）。⛔ 别为元数据源另写一份请求。
import { searchWeread as searchWereadSvc, searchWereadMeta, testWereadAuth, fetchWereadShelf as fetchWereadShelfSvc, fetchWereadBookInfo as fetchWereadBookInfoSvc, fetchWereadNotes as fetchWereadNotesSvc, type WereadNotesOutcome } from 'services/weread';
import { hasWereadAuth, WEREAD_INFO_GAP_MS, type WereadBookInfo, type WereadCandidate } from 'pure/weread';
import { renderWereadNotes, WEREAD_NOTES_SECTION } from 'pure/wereadNotes';
// #589 开机凭据自检（纯逻辑在 pure；网络调用在本文件）
import {
    CREDENTIAL_CHECK_DELAY_MS,
    CREDENTIAL_CHECK_GAP_MS,
    configuredCredentialChecks,
    musicCheckKey,
    normalizeCredentialStatus,
    sourceCheckKey,
    statusOf,
    withStatus,
    withoutStatus,
    type CredentialStatusMap,
} from 'pure/credentialCheck';
import { partitionShelfBooks, shelfBookEntryFields, shelfExtraNote, type WereadShelfBook } from 'pure/wereadShelf';
// 🔴 #591 Ctrl+滚轮缩放：媒体库把「缩到几列」报回来，落盘 + 重推都在宿主（视图侧不碰 settings）
import { normalizePosterColumns, normalizePosterDensity, type PosterDensity } from 'pure/posterGrid';
// 🔴 #657：统计页区块顺序的归一（自由排序 + 自适应；真源在 pure/statsLayout）
import { isDefaultStatsOrder, normalizeStatsOrder, type StatsBlockKey } from 'pure/statsLayout';
// #527/#531 剧集链接失效探测（服务层只发请求，判据在 `pure/linkStatus`）
import { checkAllLinks, type LinkCheckStopSignal } from 'services/linkCheck';
import { collectLinkScanTargets, clearDeadEpisodeUrls, summarizeLinkStatus, bvidOf, isHttpUrl, type LinkStatus } from 'pure/linkStatus';
// 🔴 2026-10-19 用户指令：检测结果不再内嵌在设置页（`.rl-hint`），改成弹窗展示**失效明细** ⇒
//    明细条目的形状取自弹窗模块（唯一真源，⛔ 别在 main.ts 里再写一份同形状的本地接口）。
import type { DeadLinkItem } from 'modals/LinkCheckModal';
// 「第 N 集」文案真源（失效明细里的集标签与编辑表单的集按钮**同一份**，⛔ 别手写第二份）
import { episodeHintLabel } from 'pure/episodeAssoc';
import { canPlayNetInline } from 'pure/netInline';
import { biliIdsOf, isBiliShortUrl } from 'pure/biliEmbed';
// 🔴 2026-11-24：网络集改回**官方 iframe 内嵌**后，这里只需要「取 cid」与「Cookie 归一」这一。
//    取流专用的一半（BILI_QUALITY / biliPlayUrl / pickBiliStream / BILI_PREFETCH_WINDOW /
//    biliPrefetchRange / qualityLabel / wantQuality）已随内置播放器一起从 `pure/biliPlay.ts` 删除。
//    别再往这个 import 里加取流导出（那意味着又把内置播放器接回来了）。
import { BILI_REFERER, BILI_UA, biliFailMessage, biliPagelistUrl, biliViewUrl, looksLikeCookie, normalizeCookie, pickCidFromPagelist, pickPgcEpisode, pickViewByAid, type BiliIds } from 'pure/biliPlay';
import { fetchYtInfo, isYtFailure, normalizeProxyUrl, searchYt, systemProxyUrl, ytTestConnection } from 'services/ytStream';
import { syncEmbedCookies, type EmbedCookieResult } from 'services/embedCookie';
import { isYouTubeUrl, pickYtCaption, pickYtMedia, youTubeIdOf, ytThumbUrl, type YtSearchItem } from 'pure/youtube';
import { fetchBiliSubtitle, type BiliSubtitleFile } from 'services/biliSubtitle';
import type { NetCueFailReason } from 'pure/netCueCopy';
// 🔴 #496「B 站视mp3 下载」：这条链路与「网络集播放」无关，别随内置播放器一起删。
//    026-11-24 一度误删过，恢复时补回）。
import { defaultYtDlpDeps, fetchBiliAudioWithYtDlp } from 'services/ytdlp';
// 🔴 m01938 3「本地音频转文字」：执行层（ffmpeg 抽轨 + whisper 转写 + SRT）。
//    别在视图层直spawn —子进程、模型路径、vault→绝对路径的换算全归宿主。
import { defaultAsrDeps, transcribeWithWhisper, type AsrCancelHandle } from 'services/asr';
import { defaultQwenDeps, transcribeWithQwen } from 'services/asrQwen';
import { defaultSenseVoiceDeps, transcribeWithSenseVoice } from 'services/asrSenseVoice';
// 🔴 2026-11 六家引擎：Paraformer（VAD 分段离线）与 X-ASR（VAD 分段流式）共用一条执行层。
//    差别只在 exe（offline-asr / online-asr 版）与喂进去的权重。⛔ 别拆成两份几乎一样的代码。
import { defaultSherpaVadDeps, transcribeWithSherpaVad } from 'services/asrSherpaVad';
// 🔴 Confucius4 llama.cpp llama-mtmd-cli*结果stdout、日志在 stderr**。
//    sherpa 系（全在 stderr）相deps 不能复用（见 asrLlama 文件头）。
import { defaultLlamaDeps, transcribeWithLlama } from 'services/asrLlama';
import { asrSrtPathFor, sanitizeExePath } from 'pure/asrEngine';
import {
    engineDefOf,
    isSherpaRunner,
    engineMissingMessage,
    qwenMissingMessage,
    type AsrEngineId,
} from 'pure/asrEngines';
// 🔴 m09819「三家模型下载在目录怎么不区分」：三家各占 `models/<engine>/` 子目录。
//    子目录名这条规则的单一真源在这个纯模块里（tests/asrLayout.test.ts 钉住）。
import { asrEngineSubdir } from 'pure/asrLayout';
import { defaultDictDeps, lookupWordInDict } from 'services/wordDict';
// 🔴 m01938 第三期「按需下载模型」：执行层（https ?.part 字节校验 改名）。
//    ⚠️ 库外目录由宿主决定（`asrModelDir`），别让下载器自己猜路径。
import { defaultDownloadDeps, downloadModel } from 'services/asrModelDownload';
import { AsrEngineModal } from 'modals/AsrEngineModal';
// 🔴 m09123「一键装好和补环境具体是装什么东西」⇒ 先把清单摊开、逐项打勾再装。
//    `AsrInstallModal` 只负责画清单与打勾，真正的动作由本文件的 `openAsrInstall()` 提供。
import { AsrInstallModal } from 'modals/AsrInstallModal';
import { asrInstallDirFields, asrInstallPlan, itemProgress, type AsrInstallDirs } from 'pure/asrInstallPlan';
// 🔴 m05717 ①：AI 运行管家要真数据（显内存/CMake/C++），探测走子进程、结果缓存在实例上。
//    ⚠️ 纯判据在 `pure/asrHardware`，本文件只负责「采一次、缓存、给界面读」。
import { probeHardware } from 'services/asrHardwareProbe';
import type { HardwareInfo } from 'pure/asrHardware';
import {
    ASR_MODEL_PRESETS,
    downloadLooksComplete,
    joinDir,
    mirrorUrlFor,
    presetByFileName,
    presetOf,
    presetSizeLabel,
    type AsrModelPreset,
    type AsrModelTier,
} from 'pure/asrModels';
// 🔴 m05462「怎么还有剩下的框要我选择」：外部程序**自动定位**（纯逻辑：PATH 拆分、候选目录、就绪判据）。
//    只有字符串推导在这里，真正的 statSync 在本文件 `asrAutoDetect()`（惰require('fs')）。
import { commonInstallDirs, ffmpegPathNames, locateOrder, splitPathList, whisperCppOnlyNames } from 'pure/asrLocate';
// 🔴 一键安whisper.cpp 运行时：纯逻辑（挑5 个文/ 放哪/ 进度换算 执行层（zip 自解）。
//    不引第三zip —main.js 已逼近 5MB 硬线，zip 中央目录格式二十年没变，zlib 就够。
import { installSupported, installUnsupportedMessage } from 'pure/whisperRuntime';
import { defaultWhisperRuntimeDeps, installWhisperRuntime as runWhisperInstall, type InstallHandle } from 'services/whisperRuntime';
// 🔴 m08030「可一键下载三家模型」：SenseVoice / Qwen3 的安装包清单（纯逻辑 整包安装器（执行层）。
//    ⚠️ whisper 不走这套 —它的三档是「一ggml 文件一档」，既有实现`ASR_MODEL_PRESETS`。
import {
    bundleOf as asrBundleOf,
    bundleBytes,
    formatBundleBytes,
    QWEN_ALIGN,
    QWEN_ASR_VARIANTS,
    SENSEVOICE_VARIANTS,
    SHERPA_EXE_NAME,
    SHERPA_VAD_OFFLINE_EXE_NAME,
    SHERPA_VAD_ONLINE_EXE_NAME,
    SILERO_VAD_NAME,
    CONFUCIUS_VARIANTS,
    PARAFORMER_VARIANTS,
    XASR_VARIANTS,
    confuciusVariantOf,
    paraVariantOf,
    qwenBundle,
    qwenVariantOf,
    svVariantOf,
    xasrVariantOf,
} from 'pure/asrBundles';
import { defaultInstallBundleDeps, installBundle as runBundleInstall } from 'services/asrBundleInstall';
import type { BiliPart, BiliVideo } from 'pure/dl/bilibili';
import { biliThumbUrl, planEpCover, EP_COVER_GAP_MS, type EpCoverPlan } from 'pure/epCover';
import { buildBiliAudioFilename } from 'pure/dl/utils';
import type { LyricSourceId } from 'pure/lyricOnline';
import { HomeView, HOME_VIEW_TYPE } from 'views/HomeView';
import type { HomeTab } from 'views/tab';
import { EntryModal } from 'modals/EntryModal';
// 🔴 m07854 ⑭：「今天看什么」全屏抽卡（宿主弹窗，⛔ 组件里不 new Modal。
import { WhatToWatchModal } from 'modals/WhatToWatchModal';
import { SeriesPickerModal } from 'modals/SeriesPickerModal';
import { SeriesPropsModal } from 'modals/SeriesPropsModal';
// 🔴 #629 系列「批量关联」弹窗（系列折叠卡右键 →「批量关联」）
import { SeriesAssociateModal } from 'modals/SeriesAssociateModal';
// 🔴 2026-11-16 游戏「本地 swf 直接玩」：内置 Ruffle 播放器。
//    容器形态按用户逐字「要独立标签页运行而不是弹窗运行」定为工作区 ItemView，
//    ⛔ 旧的 `modals/FlashGameModal`（弹窗版）已删除，别再加回来。
import { FlashGameView, FLASH_GAME_VIEW_TYPE } from 'views/FlashGameView';
import type { SeriesGroup } from 'pure/seriesGroup';
import { normalizeSeriesName, seriesKeyOf, seriesTitleOf, sortSeriesItems } from 'pure/seriesGroup';
import { ConfirmModal } from 'modals/ConfirmModal';
import { TextPromptModal } from 'modals/TextPromptModal';
// 🔴 2026-11-25：通用「输一行文本」弹窗（系列折叠卡右键的「批量填归属合集 / 归属标签」用它）。
//    全仓第一—以后要「输一个字符串」请复用它，别再各自手搭 input。
import { LinkPickerModal } from 'modals/LinkPickerModal';
import { QuickAssociateModal, type QuickAssociateResult, type QuickAssocPickKind, type PlayableCandOutcome } from 'modals/QuickAssociateModal';
// 🔴 2026-10-19 设置页 UX 改版：新手引导（`modals/GuideModal`）**整体下线** ——
//    用户裁定「关于页那枚新手引导按钮换成『未来规划』」，本弹窗随之删除 ⇒ 这里也不再 import。
import { ExcerptModal } from 'modals/ExcerptModal';
import { AssetCleanupModal } from 'modals/AssetCleanupModal';
// 🔴 m07854 ⑱：批量重命名（规则pure/batchRename，弹窗只列计+ 确认。
import { BatchRenameModal } from 'modals/BatchRenameModal';
import { planBatchRename, type RenamePlan } from 'pure/batchRename';
// 🔴 2026-11-13 用户指令：阅读器区域截图右键 → 先抓图再进七工具批注弹窗
import { ShotAnnotateModal } from 'modals/ShotAnnotateModal';
// 🔴 2026-11-08：笔记反向导入（用户报「手写的条目上海报墙不出现」）扫库判据pure，勾UI modal
import { NoteImportModal } from 'modals/NoteImportModal';
import { NoteImportGuideModal, type NoteImportGuideScan } from 'modals/NoteImportGuideModal';
import { scanImportableNotes, writeIdIntoNote, posterFromBanner, type NoteImportCandidate } from 'pure/noteImport';
// 🔴 2026-11-08 用户指令：「给从笔记导入条目项加个『生成模板』按钮，可在仓库根目录生成笔记模板」
//   模板内容（六类型可复制区块）pure/noteTemplate，IO main.writeNoteTemplate()
import { buildNoteTemplate, noteTemplatePath } from 'pure/noteTemplate';
import { WereadShelfSyncModal, type WereadShelfFetchOutcome } from 'modals/WereadShelfSyncModal';
// 🔴 #662：豆瓣「同步导入」弹窗（收藏：想看 / 在看 / 看过）+ 纯解析
import { DoubanSyncModal, type DoubanSyncRow } from 'modals/DoubanSyncModal';
// 🔴 #665：Bangumi / TMDB 账号同步弹窗
import { BangumiSyncModal } from 'modals/BangumiSyncModal';
import { TmdbSyncModal, type TmdbSyncRow } from 'modals/TmdbSyncModal';
// 🔴 2026-10-25（用户：「所有类型账号同步是要先列出弹窗列出游戏让我勾选才同步」）：Steam 同步弹窗
import { SteamSyncModal, type SteamSyncRow } from 'modals/SteamSyncModal';
// 🔴 2026-11-09 15 轮阶C：音乐清单同步弹窗（与上面五个同步弹窗同构，只是多了「先选歌单」一层）
import { MusicSyncModal, type MusicSyncPlatformState, type MusicSyncRow } from 'modals/MusicSyncModal';
// 🔴 2026-10-25 用户指令：一键迁移改成「先弹窗勾选（默认全选）再迁移」⇒ 勾选层 + 进度层两个弹窗
import { PosterMigratePickModal, type PosterMigrateCandidate } from 'modals/PosterMigratePickModal';
import { PosterMigrateProgressModal } from 'modals/PosterMigrateProgressModal';
import {
    tmdbItemKey,
    tmdbListToStatus,
    tmdbSubjectUrl,
    tmdbVoteToCommunityScore,
    tmdbAddedAtToISO,
} from 'pure/tmdbSync';
import {
    DOUBAN_PAGE_SIZE,
    doubanCollectionUrl,
    doubanItemKey,
    doubanRatingToEntryRating,
    doubanStateToStatus,
    doubanSubjectUrl,
    doubanUserIdFromCookie,
    parseDoubanCollectionPage,
    type DoubanCollectionItem,
    type DoubanCollectionState,
    type DoubanSyncKind,
} from 'pure/doubanSync';
import { DeleteEntryModal } from 'modals/DeleteEntryModal';
// #685 旧 `GameSessionModal`（仅游戏「记录游玩」）已退场 ⇒ 换成两个通用弹窗：
//   EntryLogModal（时长 / 重温 / 周目）+ EntryTextModal（短评 / 攻略）。⛔ 别把旧的加回来。
import { EntryLogModal } from 'modals/EntryLogModal';
import { EntryTextModal } from 'modals/EntryTextModal';
import { VaultFileSuggest } from 'modals/VaultFileSuggest';
import { ComicReaderView, EpubReaderView, PdfReaderView, TxtReaderView, COMIC_READER_VIEW_TYPE, EPUB_READER_VIEW_TYPE, PDF_READER_VIEW_TYPE, TXT_READER_VIEW_TYPE } from 'views/ReaderViews';
import { probePdfNumPages } from 'modals/PdfReaderModal';
// #537 漫画阅读（零依赖档：图片文件夹 / CBZ·ZIP / CBT·TAR）——判据真源在 pure/comicFiles，TAR 解析在 pure/tarParse
import { isComicArchivePath, isComicImageName, sortComicPages, isComicArchiveEntry, comicExt } from 'pure/comicFiles';
// 🔴 #636 ⑤：漫画阅读器两档新偏好（阅读模式 / 缩略图栏）的归一闪源 + 类型
import { normalizeComicViewMode, thumbsVisible, type ComicViewMode } from 'pure/comicViewer';
// 🔴 #639 ⑥：Steam 集成的纯逻辑（凭据校验 / 三态解析 / 时长换算 / 配对 / 启动门槛）+ Web API 服务层
import {
    steamKeyIssue,
    steamIdIssue,
    minutesToHours,
    matchOwnedToEntries,
    steamTitleKey,
    syncSummary,
    shouldAutoSync,
    // 🔴 2026-10-25：同步弹窗改造新增（判重键 / 合并候选 / 落库字段 / 顶部结论）
    steamItemKey,
    steamCoverUrl,
    steamAppIdFromUrl,
    mergeSyncCandidates,
    syncFetchHeadline,
    // 🔴 2026-10-25：`syncSteamNow` 也要补详情（用户报「有些同步导入的没有评分和评价人数」）
    steamDetailFields,
    steamEntrySeed,
    steamEntryNeedsDetail,
    STEAM_DETAIL_FILL_LIMIT,
} from 'pure/steamSync';
// 🔴 2026-11-08：Bangumi 详情投影的唯一真源（以前在 ①②三处各手写一遍，兜底链靠人肉对齐。
import { bangumiDetailData, bangumiEntryFields, bangumiSearchEnrich } from 'pure/bangumiSync';
// 🔴 2026-11-09 15 轮阶B：在线曲库歌`music` 条目的落库映射（唯一真源。
import { MUSIC_ADOPT_FIELDS, adoptableMusicEntryId, indexMusicEntries, musicEntrySeed, musicIdFromResult, musicItemKey, musicSeedFromResult } from 'pure/musicSync';
import type { MusicEntrySeed } from 'pure/musicSync';
// 🔴 2026-11-09 15 轮阶C：账号清单同步（我的歌单 / 我喜欢的音乐。
//    纯逻辑（候选构/ 标签 / 汇总文案）`pure/musicPlaylist`，请求与降级`services/dl/myMusic`
import { musicCandidatesFromSongs, musicSyncPartialMessage, musicSyncSummary, playlistTag } from 'pure/musicPlaylist';
import type { MusicSyncCandidate, MusicSyncPlaylist } from 'pure/musicPlaylist';
import { musicPlatformLabel } from 'pure/musicPlatform';
import {
    KUGOU_SYNC_UNSUPPORTED,
    neteaseMyPlaylists,
    neteasePlaylistTracks,
    qqMyPlaylists,
    qqPlaylistTracks,
} from 'services/dl/myMusic';
import type { MyListOutcome } from 'services/dl/myMusic';
import { fetchOwnedGames, fetchWishlist, testSteamAuth } from 'services/steamWebApi';
// #540 EPUB 漫画（漫画条目 + .epub → 抽出页图走漫画阅读器）：判据真源在 pure/epubComic
import { extractEpubComicPages } from 'pure/epubComic';
import { parseTar } from 'pure/tarParse';
// #537 阅读时长计时（前台 + 活动页；最小 1 分钟）
import { addReadMinutes, countableMinutes, createReadTimeState, readActiveMs, setReadActive } from 'pure/readTimer';
// #351 阅读排版载荷（两个阅读器与宿主共用一份形状；字体/字重/字距的归一化也从这里取）
import { normalizeFontFamily, normalizeFontWeight, normalizeLetterSpacing, type ReaderTypoPayload } from 'pure/readerTypography';
import { countExcerpts, generateBlockId, parseExcerptBlocks, type ParsedExcerpt } from 'pure/excerpt';
import {
    parseHighlightBlocks,
    normalizeHlStyle,
    normalizeHlColor,
    findSameExcerpt,
    type HlStyle,
    type HlColor,
    type ReaderHighlight,
} from 'pure/highlight';
// 2026-10-23：PDF 页内高亮的归一化矩形（只 PDF 用；形状校验与夹取在纯模块里，main 不自己写一套）
import { normalizeRelRects, type PdfRelRect } from 'pure/pdfHighlight';
import { normalizeProgress, readingProgressFilePath, matchLegacyProgressFile, progressFileName, bookmarksFileName } from 'pure/readingProgress';
import { pageFromPercent, reconcileBookProgress, type BookFileInfo, type BookProbeResult, type BookProgressFields } from 'pure/bookProgress';
import { bookmarksFilePath, parseBookmarks, type ReaderBookmark } from 'pure/bookmark';
import {
    mergeLegacyStore,
    normalizeStore,
    readerStoreDir,
    readerStoreFilePath,
    serializeStore,
    withBookmarks,
    withHighlights,
    withProgress,
    type ReaderStore,
} from 'pure/readerStore';
import { buildTranslateBody, buildTranslatePingBody, pickPingModel, noChatModelHint, parseAiReply, aiHttpIssue, providerLabel, resolveModel, translateChatUrl, modelsUrl, parseModelList, normalizeProvider, normalizeAiChoice, aiKeyField, isCustomSlot, customSlotName, CUSTOM_SLOT_FIELDS, AI_PROVIDER_OFF, type AiProviderChoice, type TranslateProvider, type TranslateRequestBody, type ModelFetched } from 'pure/translate';
import { buildSearchBody, buildSearchQuestionBody } from 'pure/readerSearch';
import { parseTxtBook } from 'pure/txtParse';
import { decodeTxtBytes } from 'pure/txtEncoding';
import { containerRootfile, parseOpf, parseTocNav, extractChapterLabel, isTocAmbiguous, rebuildTocFromSpine } from 'pure/epubParse';
import { parseReaderDeepLink, readerDeepLinkFromParams } from 'pure/readerLink';
import {
    buildShotBlock,
    buildTimeLink,
    matchLineLink,
    parseTimeLink,
    shotFileName,
    stampLabel,
    videoDeepLinkFromParams,
    type VideoTimeTarget,
} from 'pure/videoLink';
import { MARK_SECTION_SHOT, MARK_SECTION_STAMP, type VideoMark } from 'pure/videoMarks';
// 🔴 m04435 ①：右键「时间戳笔记」浮层的 `心情 + 备注` 拼接（纯函数，文案真源在 `pure/stampNote`）
import { stampNoteLine } from 'pure/stampNote';
import {
    readerShotBlock,
    readerShotFileName,
    readerShotLabel,
    SHOT_SECTION_READER,
    type ShotLoc,
    type ShotRect,
} from 'pure/readerShot';
import { sanitizePosterTitle } from 'pure/posterFile';
// #349 附件清理：孤儿资产判定（封面 + 阅读存档）收敛在纯模块里；#350 起同一模块还产「删除条目的资产计划」
import { buildOrphanAssets, entryAssetPlan, type OrphanAsset } from 'pure/orphanAssets';
// 条目还原（最近删除的 5 条条目可复活）：记录文件 `{lib}/trash.json`，纯逻辑在 `pure/entryTrash`
import { TRASH_FILE_NAME, TRASH_FILE_NAME_LEGACY, TRASH_KEEP, collectTrashFiles, parseTrashFile, pushTrashRecord, restoreEntryFor, serializeTrashFile, type TrashRecord } from 'pure/entryTrash';
// ⑬ 搜索累积（用户 2026-10-22：「上限20条可再搜索突破」；2026-10-25 改口径：
//    「保存逻辑仅搜索完毕不关闭窗口才保存，退出再重新搜索为清除」⇒ **不再落盘**，
//    累积池只活在 `EntryModal` 实例里，关窗即随实例销毁。纯逻辑（合并/去重/截断）仍在 `pure/searchAccum`。
import { AssetManagerModal, type AssetGroup } from 'modals/AssetManagerModal';
import { EntryRestoreModal } from 'modals/EntryRestoreModal';
import { imageSizeFromBytes } from 'pure/imageSize';
import { toFileUrl } from 'pure/mediaFileUrl';
import { isEmbeddableVideoPath, isAssociableVideoPath, isAssociableAudioPath, VIDEO_ASSOCIABLE_EXTENSIONS, AUDIO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';
import type { MediaInfo } from 'pure/mediaInfo';
// #404「库内音乐目录里找回同名音频」：目录真源 `downloadDir` + 匹配纯模块
import { downloadDir, downloadDirAbsPath, downloadRelPath, downloadSizeIssue, migrateLegacyDownloadDir, sanitizeDownloadName, type DownloadKind } from 'pure/downloadPlan';
import { matchAudioFileToEntry, pickLibraryAudio, type LibraryAudioFile } from 'pure/libraryAudio';
// #497「改名关联的音频文件」：路径拆分 / 校验 / 目标 .lrc 路径的唯一真源
import { planAudioRename } from 'pure/renameAudio';
// #498「从网络搜索封面」：请求地址 / 解析 / 缩略图回退链 / 下载 Referer 的唯一真源
import { posterReferer, type PosterCandidate } from 'pure/posterSearch';
import { searchPosterImages, POSTER_UA } from 'services/posterSearch';
// #509：封面来源（网络搜索 + 四大音乐平台）与「平台封面→大图」的实测规则
import { platformCandidates, type PosterSource } from 'pure/posterSources';
// #417「库内找回同名书籍文件」：白名单真源走 `downloadPlan`，匹配纯模块是 `libraryBooks`
import { isAssociableBookPath, pickLibraryBook, type LibraryBookFile } from 'pure/libraryBooks';
// #534 游戏「检索本地」：可启动文件判据（与书籍那套扩展名集合分开，⛔ 别互相借用）
import { isGameLaunchPath } from 'pure/gameLaunch';
// 2026-11-16 游戏「本地 swf 直接玩」的纯逻辑（运行时完整性判据 + 解压筛选，见 `pure/flashGame` 的说明）
import {
    clampGameStage,
    isFlashPath,
    isRuffleRuntimeComplete,
    pickMainSwf,
    shouldKeepRuffleFile,
    RUFFLE_BUNDLE_URL,
} from 'pure/flashGame';
import { baseNameOf, extractAssetRefs, planAssetRefs } from 'pure/flashAssets';
// 2026-11-17 ① SWF 载体目录约定（平铺区 / 独立目录 / 存档备份夹的唯一判据真源）
import {
    GAME_SAVES_SUBDIR,
    dirOfSwf,
    gameBundleSavesDir,
    gameCarrierDir,
    gameCarrierLayout,
    isInSwfFlatDir,
    shouldUpgradeToBundle,
} from 'pure/gameLayout';
import { buildSaveBundle, parseSaveBundle, saveBundleFileName } from 'pure/gameSave';
import {
    build17yySwfUrl,
    decodeHtmlBytes,
    isFetchableUrl,
    looksLike404,
    normalizeGamePageUrl,
    parse17yyAjaxParams,
    parseFlashPage,
    parseGameEmbedPage,
    parseGameStage,
    resolveUrl,
    siteOf,
    swfFileNameOf,
} from 'pure/flashFetch';
import { downloadToVault } from 'services/downloader';
// #562 分类本地目录（键 / 分组 / 字段映射的真源）+ #563 单集本地检索的匹配纯模块
// 🔴 #602：`LocalBookSearchQuery` / `LocalFileSearchOutcome` 也收在这里 —— 关联弹窗与编辑表单
//    （`.svelte`）要用**同一个形状**，放弹窗模块里会让组件反向依赖弹窗（见 `pure/localDirs` 的说明）。
import {
    localDirKeyFor,
    localDirOf,
    resolveLocalDirAbs,
    LOCAL_DIR_LABELS,
    type LocalDirKey,
    type LocalBookSearchQuery,
    type LocalFileSearchOutcome,
} from 'pure/localDirs';
import { pickLocalEpisode, type LocalEpisodeOutcome, type LocalEpisodeQuery } from 'pure/localEpisode';
// #464 在线曲库：四平台搜歌结果 → 音乐结果卡片（纯映射；请求复用 `dlSearchSongs`）
import { songLibraryResults, SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
import { dirOfPath, fileNameOfPath, pickSubtitleCandidates, srtToVtt, type SubtitleCandidate } from 'pure/subtitle';
import { scanEpisodeNumbers } from 'pure/episodeScan';
import { bindTooltipDocument, initGlobalTooltip } from 'services/globalTooltip';
// 悬浮进度球（用户 m01938）：跨笔记存活的长任务进度显。
import { destroyProgressBall, startProgressBall, type ProgressBallHandle } from 'services/progressBall';
// 🔴 m03052 ⑤：B站音乐下载的后台化 —— 卸载时摘球/清订阅（见 `onload` 的 `register` 处）
import { disposeBiliDownloads } from 'services/biliDownloadService';
import { VideoPlayerView, VIDEO_PLAYER_VIEW_TYPE, type EmbedVideoItem, type VideoPlayerOptions } from 'views/VideoPlayerView';
// 🔴 #691 026-10-27）B 站风选集**独立新页**：不是播放器内塞侧栏，是工作区新标签。
import {
    EpisodePageView,
    EPISODE_PAGE_VIEW_TYPE,
    type EpisodePageExtras,
    type EpisodePageOptions,
} from 'views/EpisodePageView';
// #604 内置播放器「播放模式」四档真源 + 脏值归一 + 旧数据迁移（设置里只存联合类型，逻辑全在纯模块）
import { normalizePlayMode, playModeFromLegacy, type PlayMode } from 'pure/playerMenu';
// ④-4 内置音频播放器：视图 + 可复用装配层（笔记内 ` ```lrc ` 块共用同一套 DOM）
import { AudioPlayerView, AUDIO_PLAYER_VIEW_TYPE, type AudioPlayerOptions } from 'views/AudioPlayerView';
import { AudioInlineBlock, type AudioPlayerTrack } from 'views/audioPlayerMount';
import { NoteCardBlock } from 'views/noteCardMount';
import { NOTE_CARD_LANG, applyNoteCardEdit } from 'pure/noteCard';
// ③ 单集评价（用户 m00002）：写回时归一走 `pure/episodeReview` 的唯一判据，
//    ⛔ 别在宿主侧另写一套「空就保留」—— 那样用户把状态改回「未看」永远清不干净。
import { setReviewAt, normalizeEpisodeReviews, type EpisodeReview } from 'pure/episodeReview';
// ④ 歌词：四路来源优先级与 ` ```lrc ` 块围栏口径的唯一真源（生成侧 noteGenerator 与消费侧播放器共用）
import { extractLrcBlock, parseLrcBlock, parseLrcRef, pickLyrics, siblingLrcPath, type LrcBlock, type LrcLyricsOrigin } from 'pure/lrcSource';
import { readEmbeddedLyrics } from 'pure/embeddedLyrics';
import { normalizeAudioPlayMode, playersToPause, type PlayerKind } from 'pure/audioQueue';
import { clampAudioVolume } from 'pure/audioVolume';
import { fileDisplayName } from 'pure/libraryDir';
import { mergeBySource, sortByRelevance } from 'pure/searchMerge';
import { PROVIDER_META, resolveSourceChain, sourceGroupForBookKind, sourceGroupForType, sourceEnLabel, deriveGroupSearchError, seedSourceChains, type AuxState, type SourceGroup, type ProviderId } from 'pure/sourceRegistry';
import { audioSubtitle } from 'pure/cardMeta';
import { normalizeTableColumnsForType } from 'pure/tableColumns';
// 🔴 #668 视图顺序与时间线缩放档的归一（唯一真源，⛔ 别在别处再写一份）
import { normalizeTimelineZoom, normalizeViewOrder } from 'pure/viewModes';
// 🔴 2026-10-21（用户需求 4）：导入时的「库内存在同名文件」判据 —— 四个账号同步导入器共用一份。
import { findTitleConflict, indexByTitleKey } from 'pure/importConflict';
import type { BookKind } from 'data/types';
// #540：书籍子分类归一（唯一入口）—— EPUB 漫画分流按 `normalizeBookKind(entry.bookKind) === 'comic'` 判
import { normalizeBookKind } from 'pure/bookKind';
import { DIR_NOTES, DIR_COVERS, DIR_BACKUPS, DIR_REPORTS, typeDir, LEGACY_TYPE_DIR_ZH, relocateLegacyNotePath } from 'pure/dirs';
import { migrateNovelNotes } from 'services/novelMigration';
import { generateYearReport, yearReportPath } from 'pure/report';
import { listReportYears } from 'pure/reportIndex';
// Obsidian Bases（.base）视图模板：让用户用**原生 Bases** 查收藏库（数据真源 = 笔记 frontmatter，不是 catalog.json）
import { buildBaseTemplate, baseTemplatePath, baseTemplateFile, baseNotesFolder, baseSnippetPath, BASE_TEMPLATE_FILE_LEGACY } from 'pure/baseTemplate';
import { mergeSnippet, snippetNotice } from 'pure/snippetMerge';
import BASE_SNIPPET_CSS from 'reelludic:bases-css';
import { ENTRY_TYPES, type MediaEntry, type EntryType, type EntryLogKind, type EntryTextKind } from 'data/types';
import type { Rating } from 'pure/rating';
// 🔴 #630：滚动条偏好真源（插件内所有**非阅读器**容器都经它一处决定隐不隐；同步点 = 下面两处）
import { syncScrollPref } from 'services/scrollPref';

/** 辅助数据源（TMDB/Bangumi）搜索超时（ms）：无代理/慢网络时宁可放弃也不拖慢豆瓣主链路 */
const AUX_SEARCH_TIMEOUT = 5000;

/** 链内非 douban 源 id（douban 主源走既有 doubanFallback，不进 aux 超时包装） */
type AuxProviderId = Exclude<ProviderId, 'douban'>;

/** 可选 Key 辅助源（key 仅提升配额/免限流，未配仍照常运行、不带 key 请求）：googleBooks；
 *  🔴 #580 加上 **weread**（它连限流都不涉及：书籍检索免登录，Cookie 只给「测试连接 / 书架同步」用）。
 *  ⚠️ 本表与 `Settings.ts` 的 `OPTIONAL_KEY_SOURCES` 是**同一概念的两份**（那处管徽标文案、这处管
 *     `providerConfigured` 判定）⇒ **改一处必须同时改另一处**，否则会出现「徽标说可选、实际被跳过」。 */
const OPTIONAL_KEY_AUX: ReadonlySet<AuxProviderId> = new Set(['googleBooks', 'weread']);

/** 影视/剧集组搜索合并结果的类型（#165 T9）：omdb imdbID 为字符串，与 tmdb id:number 不可强塞——
 *  以联合并排（TmdbSearchResult | OmdbSearchResult），OmdbSearchResult 独立类型决策见 tests/omdb.test.ts；
 *  merge/sort 仅依赖 title/source，联合成员均可兼容 */
type MovieTvSearchResult = TmdbSearchResult | OmdbSearchResult;

/**
 * 辅助源搜索 runner：检索词 + 条目类型上下文（影视组源收到 'movie'|'tv'，其余组源为组对应类型）+ 进度器。
 * runner 只负责发起该源搜索并返回结果；超时包装 / 失败置 failed / 进度步 / 状态归集统一由 runAuxSource 层负责——
 * runner 内不弹 Notice、不做 withTimeout（T3 对齐 spec S3「失败源静默降级」，收敛 B1 的 tmdb/bangumi 单源失败 Notice）。
 */
type AuxSearchRunner = (query: string, type: EntryType, prog?: SearchProgressReporter) => Promise<unknown[]>;

/**
 * #562/#563 分类本地目录的**扩展名判据**（按分类分叉）。
 * ⛔ 别用一把梭的集合：视频目录里的 `.nfo` / `.srt` / `.jpg` 会被一起收进候选，
 * 然后在「按集号挑」那一步跟正片抢位置。
 */
function localDirAccept(key: LocalDirKey): (name: string) => boolean {
    if (key === 'music') return isAssociableAudioPath;
    if (key === 'book' || key === 'novel' || key === 'comic') return isAssociableBookPath;
    return isAssociableVideoPath;
}

/** 豆瓣主源一次运行结果（主源不限时 + reachable/cookieInvalid 归集） */
interface DoubanRun<T> {
    kind: 'douban';
    items: T[];
    reachable: boolean;
    cookieInvalid: boolean;
}

/** 单个辅助源一次运行结果（含归集状态，供 derive） */
interface AuxRun<T> {
    kind: 'aux';
    id: AuxProviderId;
    items: T[];
    state: AuxState;
}

/** 一次组内搜索的源运行归集（供五个 searchXFresh 合并 + derive 用） */
interface GroupSearchRun<T> {
    chain: ProviderId[];
    /** 各 aux 源状态（仅链内已参与判定的 aux 源；未注册 runner 源标 absent） */
    aux: Partial<Record<AuxProviderId, AuxState>>;
    /** 各 aux 源原始结果（链序） */
    auxItems: Partial<Record<AuxProviderId, T[]>>;
    /** douban 主源运行结果（链含 douban 时返回；否则 undefined） */
    douban: DoubanRun<T> | undefined;
}

/** 阅读数据存档的内存态（进度 + 书签 + 高亮三合一；落盘由 flush 合并，见 readerStores 注释） */
interface ReaderStoreMem {
    store: ReaderStore;
    /** 条目标题（文件名基准；条目改名后按新名落盘，旧文件成孤儿） */
    title: string;
    /** 合并窗口定时器（非 null = 已有待写，滚动期间不重复起表） */
    timer: number | null;
}

/** 进度落盘的合并窗口（ms）：滚动期间最多 1 写/秒（KOReader 式内存态 + 合并落盘，压住写放大） */
const READER_STORE_FLUSH_MS = 1000;

/**
 * LyricFlux 的插件 ID（④-4「笔记内 lrc 块」让位判定用）。
 * 它也注册同名 `lrc` 代码块处理器（`LyricsMarkdownRender`）⇒ 两边同时接管会画出两个播放器。
 * 取自其 `manifest.json` 的 `id`（⛔ 不是显示名「LyricFlux」）。
 */
const LYRICFLUX_PLUGIN_ID = 'obsidian-lyricflux';

/**
 * 「交回跳复用已取好的网络流」的保质期（毫秒）。
 *
 * 🔴 用户 2026-11-10 裁定「退回时沿用播放器里已经缓冲好的流，不再重新取流」。
 * 为什么必须有保质期：`biliStreamProxy` 挂上去的B 站直链路由，链接里的
 * 签名/`deadline` 会过期；Cookie 也可能在中途失效。拿过期路由回放的表现是
 * 「黑+ 一直转圈」，比重新取流还难查 超过这个时长一律退回重新取流。
 * ⚠️ 10 分钟：够覆盖「看一会儿 全屏 再退回」的常规操作。
 *    又远短于 B 站直链的典型有效期。⛔ 别改Infinity。
 */
const NET_STREAM_REUSE_MS = 10 * 60 * 1000;


/** #537 漫画页的 MIME（Blob 带上正确类型，`<img>` 解码更稳、avif/webp 尤其）；未知回落 `image/*` */
function comicMime(path: string): string {
    const map: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
        avif: 'image/avif',
        bmp: 'image/bmp',
    };
    return map[comicExt(path)] ?? 'image/*';
}

/**
 * 网络集字幕的抓取结果（用m06406 的两种空态靠它分岔）。
 *
 * `BiliSubtitleFile` = 拿到了；`{ fail }` = 没拿到，**带上了原因**。
 * 🔴 为什么不直接 `BiliSubtitleFile | null`：null 让视图层无从分辨「该去改 Cookie」
 *    和「改 Cookie 也没用」，只能瞎猜 —— 猜错就是把用户往设置页瞎指挥。
 */
type BiliSubtitleResult = BiliSubtitleFile | { fail: NetCueFailReason };

export default class ReelLudicPlugin extends Plugin {
    settings: ReelLudicSettings = DEFAULT_SETTINGS;
    service!: EntryService;
    private tmdb!: TmdbClient;
    private bangumi!: BangumiClient;
    private openLibrary!: OpenLibraryClient;
    private googleBooks!: GoogleBooksClient;
    /** 漫画源（2026-09-30 接入，用户裁定）：MangaDex 免 Key，走 comic 组的第三源 */
    private mangadex!: MangaDexClient;
    private steam!: SteamClient;
    private musicbrainz!: MusicBrainzClient;
    private itunes!: ItunesClient;
    private omdb!: OmdbClient;
    private anilist!: AnilistClient;
    private igdb!: IgdbClient;
    private douban!: DoubanClient;
    /** 搜索结果内存缓存（30min TTL，防重复搜索：429 限流/豆瓣反爬友好） */
    private readonly searchCache = createSearchCache<unknown>({ ttlMs: 30 * 60 * 1000, maxSize: 200 });
    /** sourceChains 上次持久化基线（JSON 串）：链配置变更时清搜索/更新检测缓存（见 saveSettings）。onload 时以磁盘加载值初始化 */
    private sourceChainBaselineJson = '';
    /** 系统文件/目录选择器上次选中目录（会话级记忆）：逐集「浏览」/批量检索接续上次位置（defaultPath） */
    private lastSystemDir = '';
    /** #462 本地音频「体积 + 时长」探测缓存（按路径）：hover 是高频动作，同一文件只探一次
     *  （⚠️ 会话内不失效 —— 文件被替换后数字会旧；探一次的成本远低于每次重探，且旧数字不影响使用） */
    private readonly audioInfoCache = new Map<string, MediaInfo>();
    /**
     * 🔴 #577 选集封面：B 站 **`bvid → 缩略图地址`** 内存缓存。
     *  - **跨弹窗复用**：用户口径「组件内使用 Map 做内存缓存，**二次打开直接读缓存**」——
     *    ⛔ 不能只做「单次打开内」的缓存（弹窗每次都是新实例，那样等于没缓存）；
     *  - **只存成功**：取不到（412 / 已下架）**不写**，下次打开再试一次（⛔ 别把失败也钉死）；
     *  - ⛔ **地址里不许带时间戳**（用户点名：加时间戳等于每次都破 HTTP 缓存）。
     */
    private readonly epCoverCache = new Map<string, string>();
    /** 同一 `bvid` 的在途请求（并发来问只发一次） */
    private readonly epCoverPending = new Map<string, Promise<string>>();
    /** 串行闸门：封面请求**一条一条来**（见 `EP_COVER_GAP_MS`，`view` 吃风控） */
    private epCoverGate: Promise<void> = Promise.resolve();
    /** #582 串行闸门：书架导入时**逐本**拉详情（见 `WEREAD_INFO_GAP_MS`，并发吃风控） */
    private wereadInfoGate: Promise<void> = Promise.resolve();
    /** ②-4 串行闸门：书架导入时**逐本**拉划线（与详情**共用同一条链** `wereadInfoGate`，
     *  因为它俩打的是同一个域名、同一份 Cookie，风控是按请求数算的，分开两条链等于并发翻倍） */
    /** ④-4 音频播放器：上一次播放的条目（命令面板「在标签页/侧边栏打开」用它重建队列） */
    private lastAudioEntry: MediaEntry | null = null;
    /** 笔记内块锚点链接 → 该书阅读器 leaf（M1 双向溯源：同一本书不重复开标签，D-4）；用前按 getLeavesOfType 校验存活 */
    private readonly readerLeaves = new Map<string, WorkspaceLeaf>();
    /**
     * 辅助源 runner 注册表（T3）：新源接入 = 在 rebuildClients 里注册一行 runner，不再改搜索函数。
     * 链中含但未注册 runner 的源在搜索时静默跳过（aux=absent），保证「注册表/默认链先行、客户端分批落地」的中间态不回归。
     * douban 主源不走本表（走既有 doubanFallback：主源不限时 + reachable/cookieInvalid 归集）。
     */
    private auxRunners: Partial<Record<AuxProviderId, AuxSearchRunner>> = {};
    /** 数据目录归一化（空值回退 ReelLudic、去尾部斜杠；多处共用） */
    private get libDir(): string {
        return normalizePath(this.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
    }
    /** Buffer → ArrayBuffer（去池偏移；pdfjs/JSZip/封面下载需要精确数据边界） */
    private toArrayBuffer(b: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }): ArrayBuffer {
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    }
    /**
     * 🔴 用户 m09565 ①-4：**两条分类轴各记各的当前页签**。
     *
     * 用户逐字：「两种模式的导航状态（当前选中项）要独立保存，切换开关时不要丢失各自的位置」
     * ⇒ 不能再用一个 `homeTab` 字段扛两套页签集合（切开关时后写的那套会把前一套冲掉）。
     *
     * ⚠️ 为什么是**内存**而不是 `settings`：`homeTab` 从 #541 起就刻意不落盘 ——
     *    那是「上次看到哪」，写回设置会让「起始页」永远被最后停留的页覆盖（见 `onLoad` 里那段注释）。
     *    这里只把「每条轴自己记到哪」放进内存，冷启动仍由 `settings.startTab` 按当前轴折算播种
     *    （`normalizeStartTabFor`），所以「起始页」依旧是唯一真源。
     */
    private homeTabByAxis: Record<TabAxis, HomeTab> = { expanded: 'movie', classic: 'media' };

    /** 当前页签分类轴（真源 = `settings.tabAxis`；归一在 `pure/homeTabs`） */
    get tabAxis(): TabAxis {
        return normalizeTabAxis(this.settings.tabAxis);
    }

    /**
     * 统一视图当前页签（追番表/书籍/影视/游戏/统计）。
     * 🔴 m09565 ①-4 起改成 getter/setter：读写都只作用于**当前分类轴**那一格，
     *    另一条轴的位置原样留着 ⇒ 切开关回来还在原处。
     */
    get homeTab(): HomeTab {
        return this.homeTabByAxis[this.tabAxis];
    }

    set homeTab(v: HomeTab) {
        this.homeTabByAxis[this.tabAxis] = v;
    }
    /** 数据文件变更刷新防抖定时器（vault 监听兜底） */
    private refreshTimer: number | null = null;
    // 🔴 #589/#1.4.x 凭据测试结论 = `settings.credentialStatus`（**单一真源**，不另开内存 Map）。
    //    ⚠️ 只存 `true` / `false`；**没有键 = 还没测过**（⛔ 别默认 false —— 那会把「没测」画成「连接失败」，
    //       判据见 `pure/credentialCheck.isExpired`）。
    //    🔴🔴 用户裁定：这份结论**必须落盘**（重启后不许回到「已配置」，只有下次测过才改）。
    //       读回在 `onload` 的 `loadData()` 之后；写走 `setCredentialStatus` / `persistCredentialStatus`。
    //    ⛔ 别退回纯内存 Map：豆瓣不在开机自检白名单（#634）⇒ 内存态一重启就丢，失败标签必然回弹。
    /** 自检的延时器（卸载要清；⛔ 别让它悬着） */
    private credentialTimer: number | null = null;
    /** 一次只跑一轮（设置页手动测试与开机自检可能同时想写同一个键） */
    private credentialRunning = false;
    /**
     * 🔴 #584：本轮防抖窗口内**被改动的条目笔记路径**（防抖会合并多次触发，得把路径攒着）。
     * 用途 = 播放器标记（进度条圆点 + 时间戳侧边栏）随笔记**实时同步**：
     * 用户在笔记里删掉一行时间戳 / 改一句备注时，抽屉与圆点必须在**不重开播放器**的前提下跟上。
     */
    private readonly pendingNotePaths = new Set<string>();

    /** 搜索入口缓存包装：命中直接返回；未命中执行后缓存（按 type+query 维度） */
    private cachedSearch<T>(key: string, fn: () => Promise<T[]>): Promise<T[]> {
        const hit = this.searchCache.get(key);
        if (hit) return Promise.resolve(hit as T[]);
        return fn().then((items) => {
            this.searchCache.set(key, items);
            return items;
        });
    }

    async onload(): Promise<void> {
        // 构建标识（#334）：每次加载打一行 —— 用来判断「磁盘上这份构建到底有没有被 Obsidian 读进去」。
        // 值 = 打包时刻（esbuild `define` 注入），与 `main.js` 的修改时间对齐；**不参与任何逻辑**。
        console.log(`[ReelLudic] build ${__REEL_BUILD__}`);
        // 🔴 2026-10-19 设置页 UX 改版追记：`loadData()` 原先还兼作「首次安装」判据（拿来弹新手引导），
        //    引导下线后那个判据一并删除 ⇒ 这里**只剩一件事**：把磁盘设置读上来。
        //    ⛔ 别再往这段塞「首次安装 / 已看过」之类的标志：用户裁定过不要额外字段。
        //    （变量名从 `rawFirstLoad` 改成 `rawSettings`：它现在纯粹是「磁盘上那份设置」，
        //     旧名会让人以为首次安装判据还在。）
        const rawSettings = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, rawSettings);
        /**
         * 🔴🔴 用户 m05673（手机实测）：「默认导航布局应该为合并视图以适应手机端竖屏显示」。
         *
         * 判据是「磁盘上**从来没有**这个字段」—— 不是 `typeof navLayout === 'undefined'` 之外的值。
         * 三种情况分得很清楚：
         *   ① `rawSettings.navLayout` 压根不存在（新装） ⇒ 按设备类型播种（手机/平板 = merged）；
         *   ② 存的是合法值（top / sidebar / merged） ⇒ **尊重用户选择**，一个字节都不动；
         *   ③ 存的是脏值（null / 数字 / 拼错） ⇒ 交给 `normalizeNavLayout` 兜成 `top`（旧口径不变）。
         *
         * ⛔ 别把这段挪进 `normalizeNavLayout`：那个函数是**读存量数据**的归一器，它的 `top`
         *    兜底保护的是老用户（改它 = 全体老用户升级即换脸）。也⛔ 别用「屏幕宽度」判 ——
         *    桌面用户把窗口拖窄是故意的，不该被强制换布局。
         * ⚠️ 播种之后要 `saveSettings()` 落盘吗？**不落**。这一档会随用户下一次改任何设置一起写下去；
         *    提前落盘反而会在「用户只是打开了一次插件」时改掉 data.json（违反「不改用户数据」的既有纪律）。
         */
        if (!rawSettings || typeof rawSettings !== 'object' || !('navLayout' in rawSettings)) {
            this.settings.navLayout = defaultNavLayoutFor(Platform.isMobileApp);
        }
        // 🔴🔴 用户裁定（1.4.x）：上次的凭据测试结论由 `loadData` 一并读上来（`statusOf` 直接读 `settings`），
        //    ⛔ 这里**不再需要**把 Map 灌回去 —— 单一真源就是 settings（见 `credentialStatus` 字段注释）。
        //    ⚠️ 但必须在这里做一次**归一**：旧 data.json / 手工改坏的脏值（字符串 "false"、null）要丢掉，
        //    否则 `isExpired('false')` 为 false ⇒ 失败标签静默消失（看起来「修好了」，其实是脏数据被放行）。
        this.settings.credentialStatus = normalizeCredentialStatus(this.settings.credentialStatus);
        // 🔴 #630：滚动条偏好**必须在设置读入之后立刻同步一次**（各弹窗/视图在 onOpen 时读的是这份模块态，
        //    不同步的话「开机第一次打开弹窗」会按默认 false 走 —— 与用户设置不符）
        syncScrollPref(this.settings);
        // 界面主题全面 modern（1.0.3）：设置页已删除切换入口，磁盘残留 native 的老用户在此强制迁移
        // （与下方 colorTheme='mono' 同构的「下线项兜底」，saveSettings 会把 'modern' 写回磁盘自愈）。
        // normalizeUiTheme 保留在 applyUiTheme 内做防御性归一，此处不再需要。
        this.settings.uiTheme = 'modern';
        // colorTheme 迁移（**不是死代码，别删**）：v0.0.1 曾提供「色彩主题：彩色/单色」设置项，
        // v0.4 起设置页移除该入口、外观固定单色。但设置项下线 ≠ 磁盘值消失 —— v0.0.1~v0.3.x 期间
        // 选过「彩色」的用户，data.json 里会永久残留 colorTheme:"colorful"。此处必须强制定为 'mono'：
        // 它曾是全仓**唯一**的纠正点，一旦删掉，MediaList.svelte 的 `{#if colorTheme === 'colorful'}`
        // 分支就会对这批老用户复活（他们的 Svelte prop 默认值也是 'colorful'），
        // 表现为升级后突然冒出类型色条 —— 而设置页已无入口、saveSettings 也不覆写，用户无法自救。
        this.settings.colorTheme = 'mono';
        // #541 起始页：主视图的初始页签由设置决定（缺省 media = 历史行为）。
        // ⚠️ 只在此处播种 —— 用户在会话中切页签走 `homeTab` 这个内存字段，⛔ 不落盘（那是「上次看到哪」，
        //    不是「起始页」；把它写回设置会让「起始页」永远被最后停留的页覆盖）。
        // 🔴 m09565 4：播种必*按当前分类轴折算**（`normalizeStartTabFor`）
        //    起始页可能存的是「电影」，而当前轴是聚合模式（没有「电影」这枚页签）。
        //    必须折到「影视」，否则 `homeTab` 拿着一个当前轴里不存在的值，页签栏没有任何一枚选中。
        const bootAxis = normalizeTabAxis(this.settings.tabAxis);
        const bootTab = normalizeStartTabFor(bootAxis, this.settings.startTab);
        this.homeTabByAxis[bootAxis] = bootTab;
        // sourceChains 基线以磁盘加载值初始化：此后 saveSettings 只要链配置与上次持久化基线不同即清缓存
        this.sourceChainBaselineJson = JSON.stringify(this.settings.sourceChains ?? {});
        // 🔴 用户 m07854 ①（2026-11-13）：「初始化配置默认启用免登录搜索源*不要强制覆盖用户已修改过**。
        //   仅在第一次启用插件时启用」。
        //   `DEFAULT_CHAINS` 早已是「豆+ 各组免登录源」（pure/sourceRegistry 的裁定注释）。
        //   缺的*生效方式**：它原先`resolveSourceChain` 动态回退 —默认值是个活值，将来一。
        //   就把用户已确认的配置追溯性改掉。这里在**首次启用**把它播种成显式配置并落盘，一次之。
        //   只认磁盘上那份。⚠只补「用户从未配置过」的组，已有非空值一个字节都不动。
        //   ⚠️ 必须排在 `sourceChainBaselineJson` 之后 —否则播种会被当成「用户改了链」而清一遍缓。
        //      （那只是空转，但会让下次搜索冷启）。
        if (!this.settings.sourceChainsSeeded) {
            const seeded = seedSourceChains(this.settings.sourceChains);
            this.settings.sourceChains = seeded.chains;
            this.settings.sourceChainsSeeded = true;
            // 播种后基线同步刷新：避免紧随其后saveSettings 把播种误判成用户改链。
            this.sourceChainBaselineJson = JSON.stringify(this.settings.sourceChains ?? {});
            await this.saveSettings();
        }
        // 目录命名演进迁移（顶层中文化 + 类型子目录英文化，幂等）：须在 rebuildService 之前执行，service 用新路径构造
        await this.migrateDirectories();
        this.rebuildService();
        // 阅读进度/书签文件名可读化迁移（旧 e_xxx 名 → {书名}-阅读进度|书签-{id}，幂等；须在 service 就绪后）
        await this.migrateProgressFileNames();
        // #528：清理存量笔记里的「## 高亮」镜像区（高亮真源已收敛到阅读数据 JSON；幂等，须在 service 就绪后）
        await this.migrateRemoveHighlightMirrors();
        // 条目回收站文件英文名迁移（`条目回收站.json` → `trash.json`，幂等；须在 service 就绪后、用户打开条目还原前）
        await this.migrateTrashFileName();
        // 🔴 2026-11-10：模程序目录整体从库`~/.reelludic` 换到**插件目录**下（幂等）。
        //    必须排在 `migrateAsrModelLayout` **之前** —先换 base，再在新 base 里做子目录归一。
        //    反了会把库外文件搬进一个马上要被换掉的 base。也必须在界面渲染前，否则用户先看到
        //    「已下载的模型不见了」再去点重新下载。
        this.migrateLegacyAsrDirs();
        // 🔴 2026-11-06 m09819：三家模型分目录（`models/` `models/<engine>/`，幂等）。
        //    须在界面渲染前跑—否则用户先看到「已下载的模型不见了」再去点重新下载。
        this.migrateAsrModelLayout();
        this.rebuildClients();

        // 🔴 #459 下载目录**一次性**迁移（与「填了『下载/音乐』却多出『下载/音乐/音乐』」同一批）。
        //   本批起「音频文件目录 / 书籍文件目录」的值 = **目录本身**（`downloadDir` 不再拼子目录），
        //   而存量值里有一批是**旧缺省 `下载`**（那时它是「下载根」，实际落盘 = `下载/音乐`）
        //   ⇒ 不迁就会把新文件落到 `下载/`，与已下好的 `下载/音乐/**` 分家、且「检索同名音频」扫的是
        //     同一份目录（`listLibraryAudioFiles`）⇒ 用户看到「以前下的歌全搜不到了」。
        //   ⚠️ **只跑一次**（标记位）：用户完全可能**故意**填 `下载`（就想都放一处），
        //      每次载入都改 = 用户改不回去。
        if (!this.settings.downloadDirMigrated) {
            this.settings.musicDownloadDir = migrateLegacyDownloadDir(this.settings.musicDownloadDir, 'music');
            this.settings.bookDownloadDir = migrateLegacyDownloadDir(this.settings.bookDownloadDir, 'book');
            this.settings.downloadDirMigrated = true;
            await this.saveSettings();
        }

        // 🔴 #756 脏数据自愈（用户 m06077「B 站扫码能获取但测试连接失败」的存量污染）：
        //    #754 `cookieFromBiliCallbackUrl` 把成功回调地址*全部 query** Cookie 存。
        //    B 站的 `data.url` 已是票据地址 那批用户`biliCookie` 里躺着。
        //    `ticket= gourl= first_domain=…`（一个登录凭据都没有），测试连接必然失败。
        //    只修「新扫码」不—存量值不清掉，用户打开设置看到的还是那串垃圾、测连接继续红。
        //    判据*有任何内容但没有 SESSDATA** 不是有效凭据，清空（B 站真凭据必有 SESSDATA）。
        //    ⚠️ 幂等：清空后再跑一次不满足条件；有Cookie（含 SESSDATA）一个字节都不动。
        const dirtyBili = String(this.settings.biliCookie ?? '').trim();
        if (dirtyBili && !/(^|;\s*)SESSDATA=/.test(dirtyBili)) {
            this.settings.biliCookie = '';
            await this.saveSettings();
        }

        this.applyUiTheme();
        // #541：卡片风格 / 界面动效两类 body 类（与主题类同一挂载点 —— 都是「按设置刷 body 类」）
        this.applyAppearance();

        this.registerView(HOME_VIEW_TYPE, (leaf) => new HomeView(leaf, this));
        this.registerView(VIDEO_PLAYER_VIEW_TYPE, (leaf) => new VideoPlayerView(leaf));
        // 🔴 #691：B 站风选集页（独立标签页）与播放器同一套内核，但版式是「左播放 + 右选集。
        this.registerView(EPISODE_PAGE_VIEW_TYPE, (leaf) => new EpisodePageView(leaf));
        this.registerView(AUDIO_PLAYER_VIEW_TYPE, (leaf) => new AudioPlayerView(leaf));
        // 阅读器三件（TXT / EPUB / PDF）：工作区新标签页打开（Modal 宿主于本批整体撤除）
        this.registerView(TXT_READER_VIEW_TYPE, (leaf) => new TxtReaderView(leaf));
        this.registerView(EPUB_READER_VIEW_TYPE, (leaf) => new EpubReaderView(leaf));
        this.registerView(PDF_READER_VIEW_TYPE, (leaf) => new PdfReaderView(leaf));
        // #537 漫画阅读器（图片文件夹 / CBZ·ZIP / CBT·TAR）
        this.registerView(COMIC_READER_VIEW_TYPE, (leaf) => new ComicReaderView(leaf));
        // 🔴 2026-11-16 用户逐字「要独立标签页运行而不是弹窗运行」：本地 swf 的 Flash 播放器
        //    从 Modal 改成工作区 ItemView（与视频播放器 / 选集页同族）。
        this.registerView(FLASH_GAME_VIEW_TYPE, (leaf) => new FlashGameView(leaf, this));
        // 笔记内摘录/高亮块头行链接 → 打开阅读器并定位（M1 双向溯源）。
        // 捕获阶段挂 document：既抢在 Obsidian「打开源文件」之前，也能 stopPropagation 彻底拦下那次导航。
        this.registerDomEvent(document, 'click', this.onWorkspaceAnchorClick, true);
        // ④ 数字输入框「滚轮增减」（#556，用户 2026-10-08）——
        // 🔴 两条硬规矩：⑴ **只有聚焦时才接管**：未聚焦一律原样放行（否则指针滑过输入框时页面就滚不动，
        //    这正是用户点名要防的）；⑵ 接管时必须 `preventDefault` + `stopPropagation`（「不让页面跟着滚」）。
        // 🔴 挂 **document 捕获阶段**（`capture: true`）：抢在任何容器的滚动处理之前拦下，才真的挡得住；
        //    `passive: false` 也是必须的 —— passive 监听里 `preventDefault()` 会被浏览器直接忽略。
        // ⚠️ 判据与算法全在 `pure/numberWheel`（纯逻辑 + 单测），这里只做 DOM 接线。
        this.registerDomEvent(document, 'wheel', this.onNumberWheel, { passive: false, capture: true });
        // 「回到原文」深链（`[↩](obsidian://reelludic?…)`）的**兜底通道**：笔记内点击由上面的捕获阶段拦截处理，
        // 万一被别的插件抢先 / 或从浏览器等外部唤起，Obsidian 会把 `obsidian://reelludic?…` 路由到这里。
        // 🔴 插件**无法**注册 OS 级自定义协议（`app.setAsDefaultProtocolClient` 是 Electron 主进程能力，
        //    插件只跑在渲染进程）—— `obsidian://` 就是官方给的等效机制（生态里 Bible Tools / Slurp 同款）。
        // 🔴 2026-09-19 用户第三次报障的**真根因就在这里**：本处理器原先「把 params 拼回 URL 再交给
        //    `parseReaderDeepLink` / `parseTimeLink`」，而 Obsidian 的 URI 语义是 `obsidian://<action>?<params>`
        //    —— **host 就是 action**，查询里写的 `action=video` 会被 host 名覆盖掉。用户日志实证：
        //    `Received URL action {action: 'reelludic', entry: 'e_…', ep: '0', t: '430'}`
        //    → 拼回的 URL action 已不是 `video`（也不是 `jump`）→ **两个解析器都 null → 静默什么都不做**。
        //    （日志里能看到 URL 被收到、界面上却毫无反应，正是这个形态。）
        //    ⇒ 现在**按参数形状分派**：`book`+`block` = 阅读器跳转；`entry` = 视频时间戳。**完全不看 action**。
        //    顺带修好了用户笔记里已经写好的旧链接（它们的 `action=jump` / `action=video` 同样是死的）。
        this.registerObsidianProtocolHandler('reelludic', (params) => {
            const p = (params ?? {}) as Record<string, unknown>;
            const reader = readerDeepLinkFromParams(p);
            if (reader) {
                void this.openDeepLinkTarget(reader);
                return;
            }
            const video = videoDeepLinkFromParams(p);
            if (video) void this.openVideoAt(video);
        });
        // 全局统一 hover 提示（data-tip 自绘气泡，UI-GUIDE 规范；卸载自动清理）
        this.register(initGlobalTooltip().destroy);
        // 🔴🔴 用户 m07854 ⑦（2026-11-13）「字幕面板、选集面板的小图标按钮没有鼠标 hover 轻提示」：
        //    真因**不是**那两组按钮缺 `data-tip`（真机实6 + 2 颗全齐、主窗口 hover 全出气泡）
        //    而是**弹出窗口里根本没有提示器**。`initGlobalTooltip()` 只绑 `activeDocument ?? document`
        //    （主窗口），`bindTooltipDocument` 全仓只有设置页与发布说明弹窗手工调了两次 —视图一律没绑。
        //    用户把选集/ 播放器页拖成独立窗口后，8 颗图标按钮的 `data-tip` 全部收不到监听。
        //      悬停自然毫无反应（CDP 实测：主窗口 `hasTipNode: true`、弹`hasTipNode: false`。
        //      而两边按钮数量完全一样）。
        //    两道口子都要堵。
        //      `window-open` 事件：之后新开的每个弹出窗口都绑一次（`bindTooltipDocument` 幂等）
        //      启动时兜底扫一遍已存在的窗—插件加载前就开着的弹窗不会再补发 `window-open`。
        this.registerEvent(this.app.workspace.on('window-open', (_win, popoutWin) => {
            bindTooltipDocument(popoutWin?.document ?? null);
        }));
        // ⚠️ `window-close` 不必手动解绑：`bindTooltipDocument` 内部document 幂等注册。
        //    窗口销毁后那份 document 与它的监听一起被回收（WeakMap 持有，不构成泄漏）。
        this.bindTooltipToOpenWindows();
        // 悬浮进度球：插件卸载时把挂在 body 上的球摘掉（它不在任何视图里，不会被自动回收。
        this.register(destroyProgressBall);
        // 🔴 m03052 ⑤：B站后台下载的进度球与订阅同样挂在 body / 模块层 —— 一并摘下。
        //    ⚠️ 只是摘球与清订阅，**不中止任务**（卸载场景任务本来就活不过 reload；
        //    真去 abort 反而要在服务层留一堆跨 reload 的句柄）。
        this.register(disposeBiliDownloads);
        // 书籍阅读器视图（新 Tab 打开，可拖出独立窗口）

        // 数据文件变更自动刷新（防抖兜底）：catalog.json / 条目笔记的创建、修改、删除
        // 覆盖外部修改、手动删文件等非插件路径，保证界面始终反映最新数据状态
        const onDataChange = (file: { path: string }): void => this.onVaultDataChange(file.path);
        this.registerEvent(this.app.vault.on('create', onDataChange));
        this.registerEvent(this.app.vault.on('modify', onDataChange));
        this.registerEvent(this.app.vault.on('delete', onDataChange));

        // 🔴🔴 2026-11-11 用户 m08970 ①「默认页签为电影的怎么不生效了」：
        //    这两处原来写`activateHome('media')`，`activateHome` 第一句就`this.homeTab = tab`
        //    只要ribbon / 命令面板打开主视图，用户设的「起始页」当场被 'media' 顶掉。
        //    （`syncStartTab` 只在**设置页改动那一*生效，冷启动/重开视图都会再被这里覆盖）。
        //    一律走 `openHomeAtStartTab()`，起始页只有一个真源：`settings.startTab`。
        //    别再在这里写字面量页—那是第二个真源，必然与设置项打架。
        this.addRibbonIcon('library', 'ReelLudic', () => void this.openHomeAtStartTab());
        this.addRibbonIcon('plus', 'ReelLudic 添加条目', () => this.openAddModal());

        this.addCommand({
            id: 'open-media-library',
            name: '打开媒体库',
            callback: () => void this.openHomeAtStartTab(),
        });
        // #326：时间戳 / 截图也挂命令面板（用户裁定 D-6：按钮 + 快捷键 + 命令三入口）。
        // 只在活动页是播放器时可用（checkCallback）—— 没有播放器就没有「当前帧」可言。
        this.addCommand({
            id: 'player-insert-timestamp',
            name: '播放器：插入当前时间戳',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(VideoPlayerView);
                if (!view) return false;
                if (!checking) void view.insertStamp();
                return true;
            },
        });
        this.addCommand({
            id: 'player-capture-frame',
            name: '播放器：截取当前帧并写入笔记',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(VideoPlayerView);
                if (!view) return false;
                if (!checking) void view.takeShot();
                return true;
            },
        });        this.addCommand({
            id: 'open-tracking-board',
            name: '打开计划表',
            callback: () => void this.activateHome('tracking'),
        });
        this.addCommand({
            id: 'add-media-entry',
            name: '添加条目',
            callback: () => this.openAddModal(),
        });
        this.addCommand({
            id: 'add-excerpt',
            name: '添加摘抄（书籍）',
            callback: () => this.openExcerptModal(),
        });
        // #349 附件清理：条目删除后遗留的封面 / 阅读存档此前只能去设置页找，补一个命令面板入口
        this.addCommand({
            id: 'cleanup-orphan-assets',
            name: '附件清理：清理未引用的封面 / 阅读存档',
            callback: () => void this.openAssetCleanup(),
        });
        // ④-4 音频播放器两条命令入口（D-9(a)）。都作用于「上一次播放的音乐条目」：
        // 命令面板没有「当前条目」这个概念，而队列来源是库内音乐条目（设计文档 §5.5 待裁定 A 方案）。
        this.addCommand({
            id: 'audio-player-open-tab',
            name: '音频播放器：在标签页打开',
            callback: () => void this.openAudioPlayer('tab'),
        });
        this.addCommand({
            id: 'audio-player-open-sidebar',
            name: '音频播放器：在右侧边栏打开',
            callback: () => void this.openAudioPlayer('sidebar'),
        });
        this.registerLrcBlockProcessor();
        this.registerNoteCardBlockProcessor();
        this.addSettingTab(new ReelLudicSettingTab(this.app, this));
        // 🔴 #589：新会话打开时——**等界面就绪之后**再安排一轮凭据自检（延迟 + 串行，见那个方法）。
        //    ⛔ 别在这里直接 await：那会把插件加载拖住 4 秒以上（一件 700ms 间隔 × 十来件）。
        this.app.workspace.onLayoutReady(() => {
            this.scheduleCredentialCheck();
            // 🔴 #639 ⑥：Steam 自动同步（用户：「插件启动时同步并增量游玩时长」）——
            //    与自检**并排**但**各自独立**：它有 6 小时门槛、且**静默**（开机不弹红字）。
            //    ⛔ 不 await（同样不能拖住加载）。
            void this.autoSyncSteamQuietly();
        });
    }

    async onunload(): Promise<void> {
        // 卸载时清理主题类，避免插件禁用后 body 上残留孤儿类。
        // 从 THEME_CLASS 取值而非硬编码类名：将来增删主题时不漏改清理点（native 的 '' 跳过）。
        for (const cls of Object.values(THEME_CLASS)) {
            if (cls !== '') document.body.removeClass(cls);
        }
        // 🔴 2026-11-26（m05012）：AI 悬浮挂件已删（用m06545「删除全部AI挂件相关代码」）
        //    别再补卸载逻辑进来 —已经没有任何挂件实例。
        // #541：外观偏好那两类 body 类同样要摘掉（清理名单的唯一真源在 pure/appearance）
        for (const cls of APPEARANCE_BODY_CLASSES) document.body.removeClass(cls);
        if (this.refreshTimer !== null) {
            window.clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        // #589：开机自检的延时器也一并清掉（还没跑的话就别跑了 —— 插件都卸了）
        if (this.credentialTimer !== null) {
            window.clearTimeout(this.credentialTimer);
            this.credentialTimer = null;
        }
        // #584：待刷新的笔记路径也一并清掉（否则禁用插件后残留的路径会在下次启用时被当成「刚改过」）
        this.pendingNotePaths.clear();
        // 阅读数据存档：把合并窗口里还没落盘的进度写掉 —— 否则禁用插件/关应用会丢掉最后一次滚动
        const pending = [...this.readerStores.keys()];
        for (const mem of this.readerStores.values()) {
            if (mem.timer !== null) {
                window.clearTimeout(mem.timer);
                mem.timer = null;
            }
        }
        await Promise.all(pending.map((id) => this.flushReaderStore(id)));
    }

    /**
     * 应用界面主题：在 document.body 挂/去 `rl-theme-modern`。
     * 单点挂载即可覆盖主界面与**全部弹窗**——Obsidian 的所有 Modal 都挂在 body 下，
     * 故 `.rl-theme-modern` 作为后代选择器前缀天然命中它们，无需逐个 Modal 改继承链。
     * 1.0.3 起全面 modern：设置页已无切换入口，settings.uiTheme 恒为 'modern'（onload 强制覆写），
     * 主题类始终挂上；本方法保留通用挂载逻辑（防御性 normalize），供将来恢复切换时复用。
     */
    applyUiTheme(): void {
        const theme = normalizeUiTheme(this.settings.uiTheme);
        const cls = THEME_CLASS[theme];
        document.body.toggleClass('rl-theme-modern', cls !== '');
        // 结构型主题差异（如页签的分段控件/指示器）无法只靠 CSS 变量表达，需把主题传给视图组件。
        // 不复用 refreshViews()：那个方法会连带重新 list() 全部条目与摘抄计数（磁盘 IO），
        // 而此处只需重推主题 prop。组件 $set 仅传 uiTheme，其余 props 保持不动。
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            // 🔴 真机实测（m04435 技术债）：`leaf.view` 不一定已经是我们这个类。
            //   插件重载 / 视图正在卸载时，leaf 上挂的可能是**上一个插件实例**的 view，
            //   或者还没 `onload` 完的空壳 ⇒ 直接 `(leaf.view as HomeView).setUiTheme(...)`
            //   会抛 `TypeError: ...setUiTheme is not a function`，而它在 `onload` 里被调到
            //   ⇒ **整个插件加载失败**（真机日志：`Plugin failure: obsidian-reelludic TypeError:
            //   i.view.setUiTheme is not a function at ...applyUiTheme ... at ...onload`）。
            //   ⇒ 必须运行时判型 + 方法存在，⛔ 别只靠 `as HomeView`（那是编译期断言，擦除后不设防）。
            const view = leaf.view as unknown as Partial<HomeView> | null;
            if (view && typeof view.setUiTheme === 'function') view.setUiTheme(theme);
        }
    }

    /**
     * #541 应用外观偏好：卡片风格 / 界面动效 → `document.body` 上的类。
     *
     * 🔴 与 `applyUiTheme` 同一套路（body 单点挂载即可覆盖主界面与**全部弹窗**）；区别只在来源 ——
     *    主题类来自 `uiTheme`（1.0.3 起恒 'modern'），本节两个类来自用户可改的两项设置。
     * 🔴 **先按全表清理、再按当前档位加**（`APPEARANCE_BODY_CLASSES` 是清理点的唯一真源）：
     *    不清理的话切档时 `rl-card-soft` 与 `rl-card-flat` 会同时挂在 body 上，
     *    变成「靠 styles.css 书写顺序决胜」的隐式行为 —— 排查时几乎看不出来。缺省档映射空串，天然不挂类。
     */
    applyAppearance(): void {
        for (const cls of APPEARANCE_BODY_CLASSES) document.body.removeClass(cls);
        const motion = MOTION_CLASS[normalizeMotionMode(this.settings.motionMode)];
        if (motion !== '') document.body.addClass(motion);
        const card = CARD_STYLE_CLASS[normalizeCardStyle(this.settings.cardStyle)];
        if (card !== '') document.body.addClass(card);
    }

    /**
     * #541 主导航布局即时生效（设置页「外观与体验 › 导航布局」改动后调用）。
     * 与 `syncPosterGrid` 同思路：只重推 prop，不重读条目、不落盘。
     * 🔴 布局是**结构分支**（侧栏那一支要增删 DOM 节点）⇒ 必须即时重推；只落盘「等下次刷新」
     *    会让用户以为「切了没反应」。
     */
    syncNavLayout(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            (leaf.view as HomeView).setNavLayout(this.settings.navLayout);
        }
    }

    /**
     * #541 起始页即时生效（设置页改动后调用）。两件事：
     *   ⑴ 记住新值 —— 供**之后**新建 / 重开的视图当初始页（`HomeView.render` 读 `this.homeTab`）；
     *   ⑵ 把已经开着的视图**当场切过去** —— 否则用户改了设置却看不到任何变化（同 `syncNavLayout` 的理由）。
     */
    syncStartTab(): void {
        // 🔴 m09565 4：必须按**当前分类*折算 —起始页可能属于另一条轴。
        //    （存的是「电影」而当前是聚合模式 折成「影视」，`normalizeStartTabFor`）。
        const tab = normalizeStartTabFor(this.tabAxis, this.settings.startTab);
        this.homeTab = tab;
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            // 🔴 2026-11-11 真机实测：标签页可以Obsidian **延迟加载**（deferred），那时。
            //    `leaf.view` 上既没有 `setRequestedTab` 也没`component` —直接调用会在。
            //    控制台抛 `TypeError: r.view.setRequestedTab is not a function`，把整条
            //    「起始页即时生效」链路静默打断（`homeTab` 已更新，视图却不动）。
            //    没这个方法就跳过：那个视图还没建，它下次 `render()` 会读 `this.homeTab` 拿到新值。
            const v = leaf.view as HomeView | undefined;
            if (typeof v?.setRequestedTab === 'function') v.setRequestedTab(tab);
        }
    }

    /**
     * 🔴 用户 m09565 ①-4：切换页签分类轴（设置页「按全类型分页签」开关改动后调用）。
     *
     * 用户逐字：「两种模式的导航状态（当前选中项）要独立保存，切换开关时不要丢失各自的位置」
     * ⇒ 这里**不碰** `homeTabByAxis` 里任何一格（两条轴各自的记忆原样留着），只把新轴推给开着的视图。
     * 视图侧收到 `tabAxis` 后会自己 `equivalentTabFor` 就近折算（电影→影视 / 文学→阅读），
     * 并把折算结果回写 `homeTab` —— 于是「切回来还在原处」自动成立。
     *
     * ⚠️ 别在这里顺手 `this.homeTab = equivalentTabFor(...)`：那样会把**新轴**的记忆提前覆盖成
     *    折算值，用户切回原轴时看到的就是折算后的页签，而不是他离开时那一枚。
     */
    syncTabAxis(): void {
        const axis = normalizeTabAxis(this.settings.tabAxis);
        // 🔴 2026-11-12 真机实测抓到的真缺陷：只`tabAxis` 不够。
        //    组件侧收到新轴后`equivalentTabFor(tabAxis, activeTab)` 就近折算 
        //    但「游戏」「音乐」「计划」「统计*两条轴同* 折算结果恒等于原不触switchTab。
        //    视图仍停在上一条轴那一枚，`this.homeTab` 已经读成新轴记住的那一**两者分*
        //    （实`on: "游戏"` `homeTab: "movie"`）。
        //    推完轴必须再把「这条轴记住的那一枚」显式推给视图（此刻 getter 已经指向新轴）。
        const want = this.homeTab;
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            const v = leaf.view as HomeView | undefined;
            // `syncStartTab` 的延迟加载理由：view 可能还没建，它下render 会读 `this.tabAxis`。
            if (typeof v?.setTabAxis !== 'function') continue;
            v.setTabAxis(axis);
            v.setRequestedTab(want);
        }
    }

    // 🔴 #543：`setNavCollapsed()` 已整体删除 —— 侧边栏改成**恒定图标轨**后就没有「折叠态」这个量了
    //    （#541 那套「折叠钮 → 落库 → 回推」随之退场；`settings.navCollapsed` 字段按 append-only 红线
    //     **保留但不再被读取**，⛔ 别把它接回任何判定 —— 那会造出一个「设置页没有、行为却受它影响」的鬼开关）。

    /**
     * 给**所有已经存在的**窗口各绑一次提示器（用户 m07854 ⑦）。
     *
     * 🔴 为什么光有 `window-open` 不够：那条事件只覆盖「插件加载之后新开的窗口」。
     *    插件被重载 / 用户在插件加载前就把标签页拖出去 ⇒ 那扇窗口永远不会补发事件，
     *    里面的 `data-tip` 依然全哑。⇒ 启动时按「视图所在文档」反向收集一遍再绑。
     *
     * ⚠️ 收集方式用 `iterateAllLeaves` 而不是遍历 `app.workspace.floatingSplit`
     *    （后者不在公开类型里，`app.workspace.window` 也不暴露窗口清单）：
     *    提示器只服务于**我们自己的按钮**，按钮一定长在某个 leaf 的 DOM 里，
     *    所以「每个 leaf 的 `ownerDocument`」恰好就是需要的全集，多一个都不少。
     *    `bindTooltipDocument` 内部按 document 幂等（WeakMap），重复调用无副作用。
     */
    private bindTooltipToOpenWindows(): void {
        const docs = new Set<Document>();
        if (typeof document !== 'undefined') docs.add(document);
        this.app.workspace.iterateAllLeaves((leaf) => {
            const owner = leaf.view?.containerEl?.ownerDocument;
            if (owner) docs.add(owner);
        });
        for (const doc of docs) bindTooltipDocument(doc);
    }

    /** 目录命名演进迁移（幂等，旧版任意起点一步到位；须在 rebuildService 之前执行，service 用新路径构造）：
     *  v0.4：顶层通俗化 entries/covers/backups/reports → 笔记/封面/备份/报告，类型子目录用中文标签；
     *  本版：类型子目录中文标签 → 英文（笔记/电影 → 笔记/movie、电视剧 → teleplay、动画 → animation、书籍 → book、游戏 → game、音乐 → music）；
     *  1.0.3.1：书籍再按子分类分目录（笔记/book/ 文学、笔记/novel/ 网文）。 */
    private async migrateDirectories(): Promise<void> {
        const dir = this.libDir;
        const vault = this.app.vault;
        // 1) v0.4 前旧库（entries/{类型键} 平铺）：先搬类型子目录再搬顶层，避免嵌套 rename 冲突；
        //    typeDir() 现返回英文目录名 → 一步落到 笔记/{英文}
        const oldNotes = vault.getAbstractFileByPath(`${dir}/entries`);
        if (oldNotes instanceof TFolder && !(vault.getAbstractFileByPath(`${dir}/${DIR_NOTES}`) instanceof TFolder)) {
            for (const t of ENTRY_TYPES) {
                const oldSub = vault.getAbstractFileByPath(`${dir}/entries/${t}`);
                if (oldSub instanceof TFolder) {
                    await vault.rename(oldSub, `${dir}/entries/${typeDir(t)}`);
                }
            }
            await vault.rename(oldNotes, `${dir}/${DIR_NOTES}`);
        }
        // 1b) 类型子目录英文化（v0.4–v1.0.1 中文标签库：笔记/电影 → 笔记/movie，幂等：目标已存在则跳过）
        for (const t of ENTRY_TYPES) {
            const oldSub = vault.getAbstractFileByPath(`${dir}/${DIR_NOTES}/${LEGACY_TYPE_DIR_ZH[t]}`);
            const target = `${dir}/${DIR_NOTES}/${typeDir(t)}`;
            if (oldSub instanceof TFolder && !(vault.getAbstractFileByPath(target) instanceof TFolder)) {
                await vault.rename(oldSub, target);
            }
        }
        // 2) 封面/备份/报告目录（v0.4，幂等）
        const simple: [string, string][] = [
            ['covers', DIR_COVERS],
            ['backups', DIR_BACKUPS],
            ['reports', DIR_REPORTS],
        ];
        for (const [old, neu] of simple) {
            const f = vault.getAbstractFileByPath(`${dir}/${old}`);
            if (f instanceof TFolder && !(vault.getAbstractFileByPath(`${dir}/${neu}`) instanceof TFolder)) {
                await vault.rename(f, `${dir}/${neu}`);
            }
        }
        // 3) catalog.json 引用更新：notePath 类型段 → 英文目录名，poster 前缀 covers/ → 封面/
        const catFile = vault.getAbstractFileByPath(`${dir}/catalog.json`);
        if (catFile instanceof TFile) {
            const text = await vault.read(catFile);
            try {
                const raw = JSON.parse(text) as { entries?: { notePath?: string; poster?: string }[] };
                let changed = false;
                for (const e of raw.entries ?? []) {
                    // v0.4 前旧引用：entries/{类型键}/ → 笔记/{英文}（一步到位）；本版 relocate 对已是 笔记/{中文} 的接力转英文
                    if (e.notePath?.startsWith(`${dir}/entries/`)) {
                        for (const t of ENTRY_TYPES) {
                            const oldP = `${dir}/entries/${t}/`;
                            if (e.notePath.startsWith(oldP)) {
                                e.notePath = `${dir}/${DIR_NOTES}/${typeDir(t)}/${e.notePath.slice(oldP.length)}`;
                                changed = true;
                                break;
                            }
                        }
                    }
                    if (e.notePath) {
                        const relocated = relocateLegacyNotePath(e.notePath);
                        if (relocated !== e.notePath) {
                            e.notePath = relocated;
                            changed = true;
                        }
                    }
                    if (e.poster?.startsWith('covers/')) {
                        e.poster = `${DIR_COVERS}/${e.poster.slice('covers/'.length)}`;
                        changed = true;
                    }
                }
                if (changed) await vault.modify(catFile, JSON.stringify(raw, null, 2));
            } catch {
                // catalog 解析失败：跳过引用更新（目录已搬，新条目用新路径）
            }
        }
        // 4) 网文笔记并入 笔记/novel/（1.0.3.1：书籍按子分类分目录，用户 2026-09-13 指定）
        await this.migrateNovelNotes();
    }

    /** 网文（bookKind=novel）笔记迁入 笔记/novel/（1.0.3.1，幂等）：
     *  迁移算法下沉 services/novelMigration（结构性 vault 接口 + 内存假 vault 单测 10 例：幂等 / 冲突不覆盖 /
     *  源缺只补引用 / 非网文不动 / 解析失败静默），此处只做 Obsidian Vault API 薄适配。 */
    private async migrateNovelNotes(): Promise<void> {
        const vault = this.app.vault;
        const libDir = this.libDir;
        await migrateNovelNotes({
            exists: (p) => vault.getAbstractFileByPath(p) != null,
            isFile: (p) => vault.getAbstractFileByPath(p) instanceof TFile,
            read: async (p) => {
                const f = vault.getAbstractFileByPath(p);
                if (!(f instanceof TFile)) throw new Error('ENOENT: ' + p);
                return vault.read(f);
            },
            write: async (p, content) => {
                const f = vault.getAbstractFileByPath(p);
                if (f instanceof TFile) await vault.modify(f, content);
            },
            createFolder: async (p) => {
                await vault.createFolder(p);
            },
            move: async (from, to) => {
                const f = vault.getAbstractFileByPath(from);
                if (f instanceof TFile) await vault.rename(f, to);
            },
        }, { notesDir: `${libDir}/${DIR_NOTES}`, catalogPath: `${libDir}/catalog.json` });
    }

    /** 数据文件变更（防抖 500ms）：仅响应本库 catalog.json 与 笔记/ 目录，其余文件不触发 */
    private onVaultDataChange(path: string): void {
        const dir = this.libDir;
        const p = normalizePath(path);
        const catalogPath = `${dir}/catalog.json`;
        const entriesDir = `${dir}/${DIR_NOTES}`;
        if (p !== catalogPath && !p.startsWith(entriesDir + '/')) return;
        // 🔴 #584：笔记改动要**顺带把播放器标记刷新一遍**（先攒路径，防抖窗口结束再统一刷）——
        //    这是「在笔记里删掉/改动一个时间戳，侧边栏与进度条圆点当场跟上」的唯一入口：
        //    `refreshPlayerMarks` 只被插入/截图那两条写入路径调用过，**外部改笔记**（手删一行、别的插件改）
        //    以前只会刷海报墙，播放器那份标记是**打开那一刻的快照**，一直不动。
        if (p !== catalogPath) this.pendingNotePaths.add(p);
        if (this.refreshTimer !== null) return; // 已有待执行刷新，合并触发
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            const notes = [...this.pendingNotePaths];
            this.pendingNotePaths.clear();
            void this.refreshViews();
            // 顺序无关：两边都只是「重画」，互不依赖；不 await 是为了不拖慢海报墙刷新
            void this.refreshPlayerMarksForNotes(notes);
        }, 500);
    }

    /**
     * 🔴 #584：把**被改动过的笔记**重解析成标记，推给正开着那条目的播放器（没有播放器就是空转）。
     *
     * 🔴 为什么按 notePath 逐个比对、而不是「把所有播放器都刷一遍」：
     *    ⑴ 只刷**真的被改到的那条**（别的条目在放，不该因为无关笔记被动重画）；
     *    ⑵ 比对用 `normalizePath`（vault 事件给的是 `/` 分隔路径，但条目里存的可能带 `\` —— 见 `normalizePath` 调用点）。
     * ⚠️ 与 `refreshPlayerMarks` 的分工：那个是「**我刚写完**笔记，把这条的标记推下去」（单条目、由写入方调）；
     *    这个是「**笔记被别人改了**，把受影响条目推下去」（按路径匹配、由 vault 监听调）。
     *    两者都汇到 `view.setMarks` 这一个出口，⛔ 别在视图里再加一条刷新路径。
     */
    private async refreshPlayerMarksForNotes(notePaths: readonly string[]): Promise<void> {
        if (!notePaths.length) return;
        const wanted = new Set(notePaths.map((p) => normalizePath(p)));
        try {
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (!(view instanceof VideoPlayerView) || !view.playingEntryId) continue;
                const entry = await this.service.get(view.playingEntryId);
                if (!entry?.notePath || !wanted.has(normalizePath(entry.notePath))) continue;
                view.setMarks(await this.service.readNoteMarks(view.playingEntryId));
            }
        } catch {
            /* 标记刷新失败不该影响数据刷新本身（与 refreshPlayerMarks 同一条纪律） */
        }
    }

    async saveSettings(): Promise<void> {
        const old = { ...this.settings };
        await this.saveData(this.settings);
        // 🔴 #630：设置落盘后同步「滚动条偏好」—— 改了开关要**当次就生效**（下一个打开的弹窗即按新值走），
        //    已在屏幕上的视图由 `refreshViews` 那条链各自重新 `applyScrollPref`。
        syncScrollPref(this.settings);
        this.rebuildClients();
        this.rebuildService();
        // E 缓存失效：凭据变更（豆瓣 Cookie / TMDB Key / Bangumi Token / OMDB Key / IGDB 双凭据）或源链配置变更 → 清空搜索与更新检测缓存，
        // 防止旧凭据/旧链结果继续命中（searchCache 30min TTL / updateCheckCache 10min TTL）
        const chainChanged = this.sourceChainBaselineJson !== JSON.stringify(this.settings.sourceChains ?? {});
        if (
            old.doubanCookie !== this.settings.doubanCookie ||
            old.tmdbApiKey !== this.settings.tmdbApiKey ||
            old.bangumiToken !== this.settings.bangumiToken ||
            old.omdbApiKey !== this.settings.omdbApiKey ||
            old.igdbClientId !== this.settings.igdbClientId ||
            old.igdbClientSecret !== this.settings.igdbClientSecret ||
            chainChanged
        ) {
            this.searchCache.clear();
            this.updateCheckCache.clear();
        }
        this.sourceChainBaselineJson = JSON.stringify(this.settings.sourceChains ?? {});
        await this.refreshViews();
    }

    /** 按设置的数据目录重建服务（libraryDir 变更立即生效；空值回退 ReelLudic） */
    rebuildService(): void {
        const dir = this.libDir;
        // 笔记表格开关随服务重建一并注入（saveSettings 会调本方法 → 改开关即时生效）
        this.service = new EntryService(
            createVaultIO(this.app),
            `${dir}/catalog.json`,
            `${dir}/${DIR_NOTES}`,
            // 🔴 #596：口径**翻面**（缺省关）—— 与 `Settings.renderAppearanceRows` 里那一处必须一致。
            this.settings.noteTable === true,
            // 1.3.1 ① 字段映射（高级设置 › 字段映射）；空串 = 恒等映射
            this.settings.fieldMap ?? '',
            // 1.3.1 ① 各类型笔记属性顺序（高级设置 › 笔记属性顺序）；缺省 = 全部走缺省顺序
            this.settings.fieldOrder ?? {},
            // 🔴 #640e：书籍子分类各自的顺序（高级设置 › 笔记属性顺序 的 文学/网文/漫画 三页）；
            //    缺省 = **回落 `fieldOrder.book`**（零迁移，见 `pure/fieldOrder` 模块头）
            this.settings.fieldOrderByKind ?? {},
            // 🔴 #721：**不写出**的属性键（高级设置 › 笔记属性顺序 每页里删掉的）；
            //    缺省 = 什么都不隐藏（老用户观感零变化）
            this.settings.fieldOrderHidden ?? {},
        );
    }

    /** 重建元数据客户端（TMDB / Bangumi / Douban，凭据变更立即生效） */
    rebuildClients(): void {
        // GET 类请求网络层重试 1 次（幂等；参考 obsidian-douban：GET 重试、POST 不重试）
        this.tmdb = new TmdbClient(
            this.settings.tmdbApiKey,
            async (url, headers) => {
                // 🔴 2026-10-25：v4 Read Access Token 走 `Authorization: Bearer`，必须把 headers 透传给 requestUrl；
                //   v3 key 时 headers 是 undefined ⇒ 行为与旧版完全一致（认证在 query 的 api_key）。
                const res = await retry(() => requestUrl(headers ? { url, headers } : { url }));
                if (res.status === 200) return res.text;
                if (res.status === 401) {
                    // 🔴 2026-10-25（用户报障「我填了 id 名了却同步不到收藏」）：401 有**两个**来源 ——
                    //   API Key 错（搜索也会一起挂）或 Session ID 错/过期（只有账号同步挂，搜索照常）。
                    //   旧文案一律报「API Key 无效」⇒ 用户会跑去反复改 API Key，白折腾。
                    //   地址里带 `session_id=` 就是账号同步请求 ⇒ 两个都要点到。
                    throw new Error(url.includes('session_id=')
                        ? 'TMDB 鉴权失败（HTTP 401）—— API Key / Read Access Token 或 Session ID 无效/过期，两个都请核对（搜索只用 Key/Token，账号同步还要 Session ID）'
                        : 'TMDB API Key / Read Access Token 无效（HTTP 401）');
                }
                if (res.status === 429) throw new Error('TMDB 请求过于频繁（HTTP 429）');
                // 404 常见于清单路径写错（历史上的 movie / movies 单复数事故）⇒ 把状态码和地址都给出来
                if (res.status === 404) throw new Error(`TMDB 接口不存在（HTTP 404）—— 检查同步路径：${url.split('?')[0]}`);
                throw new Error(`TMDB 请求失败（HTTP ${res.status}）`);
            },
            // 第 3 参是 lang（缺省 zh-CN），这里显式 undefined 占位；第 4 参才是 POST 通道
            undefined,
            // 第 4 参：POST 通道，只给「v4 access_token → v3 session_id」的转换用
            //   （`POST /3/authentication/session/convert/4`，见 `pure/tmdbAuth` 的转换说明）
            async (url, body, headers) => {
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/json' });
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('TMDB 会话转换失败（HTTP 401）—— access_token 无效、未被用户批准或已过期');
                if (res.status === 404) throw new Error('TMDB 会话转换接口不存在（HTTP 404）—— 检查接口路径');
                throw new Error(`TMDB 会话转换失败（HTTP ${res.status}）`);
            },
        );
        this.bangumi = new BangumiClient(
            this.settings.bangumiToken,
            async (url, headers) => {
                const res = await requestUrl({ url, headers });
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('Bangumi Access Token 无效（HTTP 401）');
                throw new Error(`Bangumi 请求失败（HTTP ${res.status}）`);
            },
            async (url, body, headers) => {
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/json' });
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('Bangumi Access Token 无效（HTTP 401）');
                if (res.status === 429) throw new Error('Bangumi 请求过于频繁（HTTP 429），请稍后重试');
                throw new Error(`Bangumi 请求失败（HTTP ${res.status}）`);
            },
        );
        this.douban = new DoubanClient(
            async (url, headers) => {
                // 桌面端走 Node 原生 https（网络栈指纹更不易被豆瓣识别为爬虫，参考 obsidian-douban），
                // nodeHttpGet 内置 GET 重试 2 次；移动端回退 requestUrl
                if (Platform.isDesktopApp) {
                    const res = await nodeHttpGet(url, headers);
                    if (res.status === 200) return res.text;
                    throw new Error(`Douban 请求失败（HTTP ${res.status}）`);
                }
                const res = await retry(() => requestUrl({ url, headers }));
                if (res.status === 200) return res.text;
                throw new Error(`Douban 请求失败（HTTP ${res.status}）`);
            },
            async (url, body, headers) => {
                if (Platform.isDesktopApp) {
                    const res = await nodeHttpPost(url, body, headers);
                    if (res.status === 200) return res.text;
                    throw new Error(`Douban 安全验证请求失败（HTTP ${res.status}）`);
                }
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/x-www-form-urlencoded' });
                if (res.status === 200) return res.text;
                throw new Error(`Douban 安全验证请求失败（HTTP ${res.status}）`);
            },
            this.settings.doubanCookie,
        );
        // Open Library（免 Key 公开 API）：书籍第二源，搜索/点选补全共用注入 requestUrl（GET 幂等重试 1 次）
        this.openLibrary = new OpenLibraryClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`Open Library 请求失败（HTTP ${res.status}）`);
            },
        );
        // Google Books（Key 可选）：书籍补充源，搜索级即含简介/页数/分类/ISBN/封面；点选直接回填无需详情接口
        // key 每次请求经 getter 现读 settings.googleBooksApiKey（T5 动态 key）：未配即不带 key 请求（免费额度，429 由 runAuxSource 静默降级）
        this.googleBooks = new GoogleBooksClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                // 429（免费额度限流/未配 key）与其它失败同路：runAuxSource catch → failed 状态，不弹 Notice
                throw new Error(`Google Books 请求失败（HTTP ${res.status}）`);
            },
            () => this.settings.googleBooksApiKey || undefined,
        );
        // MangaDex（免 Key 公开端点，2026-09-30 接入）：漫画源链第三源。
        // 🔴 必须带可标识 User-Agent（`MANGADEX_UA`，官方 Acceptable Usage Policy）⇒ 这里把 headers 透传给 requestUrl。
        // ⚠️ 429 = 触发全局限流（约 5 req/s）→ 与其它 aux 同路：runAuxSource catch → failed，不弹 Notice、不阻断整组。
        this.mangadex = new MangaDexClient(
            async (url, headers) => {
                const res = await retry(() => requestUrl({ url, headers }));
                if (res.status === 200) return res.text;
                throw new Error(`MangaDex 请求失败（HTTP ${res.status}）`);
            },
        );
        // Steam（免 Key 公开端点）：storesearch 免 Key 检索（#165 T6 校准：suggest 端点实测返回热门 HTML 非检索 JSON，
        // 故用 https://store.steampowered.com/api/storesearch/?term=&cc=US&l=english）；游戏第二源，搜索级字段直接可回填
        this.steam = new SteamClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`Steam 请求失败（HTTP ${res.status}）`);
            },
        );
        // MusicBrainz（免 Key 公开 API）：release-group 检索（#165 T7 校准：直接 query 形态实测 200；限流 ~1rps 且
        // 政策要求请求标识 User-Agent，故注入 http 带 UA header）；音乐第二源，搜索级字段直接可回填，
        // 封面 = coverartarchive 纯 URL 拼接（404 由 UI 占位，不在搜索时请求探测）
        this.musicbrainz = new MusicBrainzClient(
            async (url, headers) => {
                const res = await requestUrl({ url, headers });
                if (res.status === 200) return res.text;
                throw new Error(`MusicBrainz 请求失败（HTTP ${res.status}）`);
            },
        );
        // iTunes（免 Key 公开 API）：search 端点 entity=album 专辑检索（#165 T8 校准：免 UA/免 Key，
        // 结果自带 artworkUrl100 尺寸后缀放大 600x600bb + collectionViewUrl 官方页链接）；音乐第三源，
        // 搜索级字段直接可回填，与 musicbrainz 同名专辑跨源并存（mergeBySource 按 source 保留）
        this.itunes = new ItunesClient(
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                throw new Error(`iTunes 请求失败（HTTP ${res.status}）`);
            },
        );
        // OMDb（需 Key，1000 次/日）：IMDb 数据，英文为主；默认链不含（movieTv=douban→tmdb），用户自选加入。
        // key 为空时 client 不发起（search/detail 首行守卫）；runner 侧 providerConfigured 未配即 unconfigured 不启动
        this.omdb = new OmdbClient(
            this.settings.omdbApiKey ?? '',
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                if (res.status === 401) throw new Error('OMDb API Key 无效（HTTP 401）');
                if (res.status === 429) throw new Error('OMDb 请求次数已达上限（HTTP 429）');
                throw new Error(`OMDb 请求失败（HTTP ${res.status}）`);
            },
        );
        // AniList（免 Key GraphQL）：anime 第三源；默认链不含（anime=douban→bangumi）→ 仅用户自选加入后参与。
        // 搜索级 GraphQL 已含 genres/studio/desc/rating + title/year/cover → 点选直接回填、无 detail 往返
        //（决策见 tests/anilist.test.ts）；请求走 requestUrl POST（GraphQL JSON）
        this.anilist = new AnilistClient(async (url, body, headers) => {
            const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'application/json' });
            if (res.status === 200) return res.text;
            if (res.status === 429) throw new Error('AniList 请求过于频繁（HTTP 429）');
            throw new Error(`AniList 请求失败（HTTP ${res.status}）`);
        });
        // IGDB（需 Twitch 双凭据 Client ID+Secret，OAuth app token）：game 补充源；默认链不含（game=douban→steam），
        // 仅用户自选加入且双凭据配置后参与（重新接入：历史 IGDB→RAWG→删除，现按用户要求回归并复用遗留字段）
        this.igdb = new IgdbClient(
            this.settings.igdbClientId ?? '',
            this.settings.igdbClientSecret ?? '',
            // token 换取（GET，带重试；网络失败由 runAuxSource catch → failed 静默）
            async (url) => {
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) return res.text;
                if (res.status === 400) throw new Error('IGDB 鉴权参数无效（HTTP 400，请检查 Client ID/Secret）');
                throw new Error(`IGDB 鉴权请求失败（HTTP ${res.status}）`);
            },
            // games 查询（POST，contentType 默认 text/plain 符合 Apicalypse；IGDB 对错 token 回 401/403）
            async (url, body, headers) => {
                const res = await requestUrl({ url, method: 'POST', body, headers, contentType: 'text/plain' });
                if (res.status === 200) return res.text;
                if (res.status === 401 || res.status === 403) throw new Error('IGDB 访问被拒（HTTP 401/403，请检查凭据与 Client-ID 头）');
                throw new Error(`IGDB 请求失败（HTTP ${res.status}）`);
            },
        );

        // T3：辅助源 runner 注册（新源接入在此追加一行；未注册的链内源由 runAuxSource 静默跳过）
        this.auxRunners = {
            tmdb: (query, type) => this.tmdb.search(query, type as 'movie' | 'tv'),
            // bangumi 服务 **动画 + 漫画** 两组（2026-09-30 漫画加回）：按调用方给的 type 分流 ——
            // 'book'（漫画走 searchBookFresh，传的恒是 'book'）→ 书籍类目 type=1；其余（anime 组）→ 动画搜索。
            // ⚠️ 这与 1.0.3.1 删掉的那条分流**不同形**（旧的写法是「冒号紧接 bangumi 的 searchBooks 调用」），
            //    ⛔ 本条注释里**不许**照抄那个形态 —— 注释会进产物，抄了就会撞上断言里那条反向守卫（本轮真踩过）。
            bangumi: (query, type) => (type === 'book' ? this.bangumi.searchBooks(query) : this.bangumi.search(query)),
            // mangadex 只服务 comic 组（免 Key；带上官方要求的 User-Agent 由客户端负责）
            mangadex: (query) => this.mangadex.search(query),
            openLibrary: (query) => this.openLibrary.search(query),
            // googleBooks 默认链不含 → 仅用户自选后参与（book 组）；key 未配时 providerConfigured 对可选 Key 源放行
            googleBooks: (query) => this.googleBooks.search(query),
            // steam 默认链含（game=douban→steam）→ 免 Key 恒参与（T6 接入；runner 注册后 searchGameFresh 不再静默跳过）
            steam: (query) => this.steam.search(query),
            // musicbrainz 默认链含（music=douban→musicbrainz→itunes）→ 免 Key 恒参与（T7 接入）；
            // itunes 默认链含 → 免 Key 恒参与（T8 接入）→ 至此 music 组默认链 3 源 runner 全注册
            musicbrainz: (query) => this.musicbrainz.search(query),
            itunes: (query) => this.itunes.search(query),
            // omdb 默认链不含（movieTv=douban→tmdb）→ 仅用户自选加入且配置 key 后参与；
            // mediaType movie/tv → type=movie/series（runner 收到 EntryType 'movie'|'tv'）
            omdb: (query, type) => this.omdb.search(query, type as 'movie' | 'tv'),
            // anilist 默认链不含（anime=douban→bangumi）→ 仅用户自选加入后参与（anime 组第三源；免 Key）
            anilist: (query) => this.anilist.search(query),
            // igdb 默认链不含（game=douban→steam）→ 仅用户自选加入且双凭据配置后参与（game 组第三源）
            igdb: (query) => this.igdb.search(query),
            // 🔴 #580 weread（book 组第三源；用户 2026-10-09 点名接入）：默认链**不含** ⇒ 仅用户自选加入后参与。
            //    复用「检索在线书籍阅读」那条链的同一个服务函数（同一接口、同一解析），只做投影。
            //    ⚠️ 走 Node 传输层 ⇒ **仅桌面端**：移动端如实抛错（`runAuxSource` 收成 failed 静默降级），
            //      ⛔ 别在移动端假装成功返回空数组（那会把「跑不了」说成「没搜到」）。
            weread: (query) => {
                if (!Platform.isDesktopApp) throw new Error('微信读书检索仅桌面端支持');
                return searchWereadMeta(this.dlTransport(), query);
            },
        };
    }

    async searchTmdb(query: string, mediaType: 'movie' | 'tv'): Promise<TmdbSearchResult[]> {
        if (!this.settings.tmdbApiKey) {
            throw new Error('未配置 TMDB API Key，请先在 设置 → ReelLudic 中填写');
        }
        return this.tmdb.search(query, mediaType);
    }

    /**
     * 豆瓣兜底（全类型通用，始终启用）：搜索 + 前 3 条自动补详情（JSON-LD），
     * 再经 mapper 转成与主数据源一致的结果类型。
     * 返回 { items, reachable, cookieInvalid }：reachable=false 表示 Douban 接口被反爬拦截/不可用（区别于"无结果"）；
     * cookieInvalid=true 表示 Cookie 失效/风控（登录跳转/禁止访问/验证失败/接口异常），供上层明确提醒。
     * prog：进度上报（豆瓣搜索 1 步 + 详情 N 步，详情步数搜索后 addRemaining 动态补齐）。
     */
    private async doubanFallback<T>(
        query: string,
        type: EntryType,
        mapper: (s: DoubanSubject) => T,
        prog?: SearchProgressReporter,
    ): Promise<DoubanRun<T>> {
        try {
            prog?.next(`${sourceEnLabel('douban')} 搜索`); // 「Douban 搜索」——主源阶段标签取源英文名
            const results = await this.douban.search(query, type);
            if (results.length === 0) {
                prog?.source({ id: 'douban', state: 'empty', count: 0 });
                return { kind: 'douban', items: [], reachable: true, cookieInvalid: false };
            }
            // 搜索阶段不再强制预补详情（每次搜索都打 3 个详情页过反爬，等待长）——
            // 列表秒出，用户点选某条时由 fetchDoubanDetailForEntry 按需补全详情字段
            // 🔴 2026-11-12（①-12）：带上映射后的 items，豆瓣一回来这一栏就能先出卡片。
            //    ⚠️ 必须`mapped` 不是 `results` —`results` DoubanSubject，字段与 SearchResult 不同形。
            //       表单直接拿它渲染会读undefined；映射只做一次，下游与返回值共用同一份。
            const mapped = results.map(mapper);
            prog?.source({ id: 'douban', state: 'ok', count: mapped.length, items: mapped });
            return { kind: 'douban', items: mapped, reachable: true, cookieInvalid: false };
        } catch (e) {
            // 保留 Cookie 失效标记（登录跳转/禁止访问/验证失败/接口异常）——供上层明确提醒「Cookie 已失效」
            prog?.source({ id: 'douban', state: 'blocked' });
            return { kind: 'douban', items: [], reachable: false, cookieInvalid: e instanceof DoubanCookieError };
        }
    }

    /** 解析某组当前生效源链（settings.sourceChains → 归一 → 缺省默认链） */
    private sourceChain(group: SourceGroup): ProviderId[] {
        return resolveSourceChain(this.settings.sourceChains, group);
    }

    /** 凭据已配置判定（T3 动态 key，删 main 内写死的 tmdbApiKey/bangumiToken 布尔判断）：
     *  PROVIDER_META[id].keyField ? !!settings[keyField] : true（免 Key 源恒 true）；
     *  双凭据源（keyField2 非空，如 igdb Client ID+Secret）→ 两字段同时有值才算已配置；
     *  可选 Key 源（googleBooks，OPTIONAL_KEY_AUX）未配 key 仍视为已配置 → 不带 key 照常运行（T5，429 静默降级）。 */
    private providerConfigured(id: ProviderId): boolean {
        const meta = PROVIDER_META[id];
        const kf = meta.keyField;
        if (!kf) return true; // 免 Key 源恒 true
        // 可选 Key 源（仅 aux 会走到此判定；googleBooks key 只用于提配额）
        if (OPTIONAL_KEY_AUX.has(id as AuxProviderId)) return true;
        const s = this.settings as unknown as Record<string, unknown>;
        const hasFirst = !!s[kf];
        if (!meta.keyField2) return hasFirst;
        return hasFirst && !!s[meta.keyField2];
    }

    /** 公开版凭据判定（EntryModal 构造搜索源计划用）：同 providerConfigured 语义 */
    sourceConfigured(id: ProviderId): boolean {
        return this.providerConfigured(id);
    }

    /** 某条目类型本次搜索「实际会发起」的源集合（链序）：链内 aux 需已配置（免 Key 源恒 true），douban 恒参与。
     *  供搜索结果区固定占栏——栏数与源成败无关，只取决于源链配置。
     *  1.0.3.1：漫画源组已下线（用户 2026-09-13 裁定），书籍类目回归单链，故不再需要按子分类分流。 */
    /** 某类型本次**实际会发起的源**（表单头部「数据源」文案 + 搜索结果固定栏位）。
     *  🔴 2026-09-30：加可选 `kind` —— 漫画独立成组后**必须**按子分类问组，
     *     否则漫画态会告诉用户「数据源：Douban / Open Library」（2 栏），而实际只搜豆瓣（1 源）⇒ 栏位数也跟着错。
     *  ⚠️ 非书籍类型忽略 kind（只有 book 有子分类）。 */
    sourcesForType(type: EntryType, kind?: BookKind): ProviderId[] {
        const group: SourceGroup = type === 'book' ? sourceGroupForBookKind(kind) : sourceGroupForType(type);
        const chain = resolveSourceChain(this.settings.sourceChains, group);
        return chain.filter((id) => id === 'douban' || this.providerConfigured(id));
    }

    /**
     * 辅助源统一执行（T3）：runner 未注册 → 静默跳过（absent，中间态不回归）；
     * 需凭据源未配置 → 不启动（unconfigured）；否则 withTimeout(AUX_SEARCH_TIMEOUT) 运行，
     * 成功/失败各推进一步进度 + 上报 source 事件（UI 逐源真实进度：快源先亮、未完成源「搜索中…」），
     * 失败仅置 failed 状态，不弹 Notice（sanction：#165 T3 对齐 spec S3「失败源静默降级」）。
     */
    private async runAuxSource<T>(id: AuxProviderId, query: string, type: EntryType, prog: SearchProgressReporter): Promise<AuxRun<T>> {
        const runner = this.auxRunners[id];
        // 链含但 runner 未注册（T4-T10 分批接入中）：等同链外源跳过，不判定凭据/不请求
        if (!runner) return { kind: 'aux', id, items: [], state: 'absent' };
        const stage = `${sourceEnLabel(id)} 搜索`; // 进度/超时标签取源英文名（与头部「数据源：」文案一致）
        // 凭据判定统一走 keyField 动态读（runAuxSource 内不再出现写死的 settings.tmdbApiKey/bangumiToken）
        if (!this.providerConfigured(id)) return { kind: 'aux', id, items: [], state: 'unconfigured' };
        try {
            // 辅助源超时压缩：无代理/慢网络时 5s 内没返回就放弃（豆瓣源先返回即整体完成），不拖慢主链路
            const items = (await withTimeout(runner(query, type, prog), AUX_SEARCH_TIMEOUT, stage)) as T[];
            prog.next(stage);
            // 🔴 2026-11-12（①-12）：事件必须items —本源一返回，表单那边就能立刻渲染这一。
            //    （用户「要显示骨架屏展示另一个已返回的源」）；只count 的话结果区仍要等最慢的源。
            prog.source({ id, state: items.length > 0 ? 'ok' : 'empty', count: items.length, items });
            return { kind: 'aux', id, items, state: 'empty' };
        } catch (e) {
            // 失败静默降级：只推进该阶段进度步 + 置 failed（全链无果时 deriveGroupSearchError 统一文案），不弹 Notice
            const timeout = e instanceof Error && /超时/.test(e.message);
            prog.next(stage);
            prog.source({ id, state: timeout ? 'timeout' : 'failed' });
            return { kind: 'aux', id, items: [], state: 'failed' };
        }
    }

    /**
     * 组内源 runner 集合执行（五个 searchXFresh 收敛后的公共编排核心）：
     * 豆瓣主源（既有 doubanFallback，不限时 + reachable/cookieInvalid 归集）与链内各辅助源并行。
     * aux 三态按 T3 表达式归集：链外/未注册 → absent；缺凭据 → unconfigured；运行失败 → failed；成功（含无匹配）→ empty。
     */
    private async collectGroupSources<T>(
        group: SourceGroup,
        type: EntryType,
        query: string,
        mapper: (s: DoubanSubject) => T,
        prog: SearchProgressReporter,
    ): Promise<GroupSearchRun<T>> {
        const chain = this.sourceChain(group);
        const hasDouban = chain.includes('douban');
        const auxIds = chain.filter((id): id is AuxProviderId => id !== 'douban');
        const [doubanRun, ...auxRuns] = await Promise.all<DoubanRun<T> | AuxRun<T>>([
            hasDouban
                ? this.doubanFallback(query, type, mapper, prog)
                : Promise.resolve({ kind: 'douban', items: [] as T[], reachable: true, cookieInvalid: false }),
            ...auxIds.map((id) => this.runAuxSource<T>(id, query, type, prog)),
        ]);
        const aux: Partial<Record<AuxProviderId, AuxState>> = {};
        const auxItems: Partial<Record<AuxProviderId, T[]>> = {};
        for (const r of auxRuns) {
            if (r.kind !== 'aux') continue; // TS 收窄用（Promise.all 异质数组）
            aux[r.id] = r.state;
            auxItems[r.id] = r.items;
        }
        return { chain, aux, auxItems, douban: hasDouban ? doubanRun as DoubanRun<T> : undefined };
    }

    /** 组内结果合并（保持既有语义不变）：aux 源结果按链序在前，douban 结果在后，去重后再按相似度排序 */
    private mergeGroupResults<T extends { title: string; source?: string }>(run: GroupSearchRun<T>, query: string): T[] {
        const auxFirst: T[] = [];
        for (const id of run.chain) {
            if (id === 'douban') continue;
            const items = run.auxItems[id as AuxProviderId];
            if (items) auxFirst.push(...items);
        }
        const db = run.douban ?? { items: [] as T[] };
        return sortByRelevance(mergeBySource(auxFirst, db.items), query);
    }

    /** 豆瓣详情按需补全（表单选中搜索结果时调用）：搜索级结果缺详情字段（仅前 3 条搜索时已补），
     *  点击任意条后动态拉取 JSON-LD + #info，返回表单可直接使用的字段对象；失败返回 null 静默。 */
    async fetchDoubanDetailForEntry(id: string, type: EntryType): Promise<Record<string, unknown> | null> {
        try {
            const subject = await this.douban.fetchDetail({ id, title: '', cast: [], genres: [] }, type);
            return toEntryDetailFields(subject);
        } catch {
            return null;
        }
    }

    /**
     * #623 Steam 游戏详情补全（选中搜索结果时按需调用）：appdetails 公开免 Key 端点 →
     * 平台 / 开发商 / 发行年 / 题材 / 简介。
     *
     * 🔴 返回的键名与豆瓣详情**同形** ⇒ `EntryForm` 直接喂同一支 `applyDoubanDetail`，
     *    ⛔ 不在组件里为 Steam 另写一套字段回填（同一件事两处做 = 迟早分叉）。
     * ⚠️ 失败（网络 / 超时 / 应用下架 / `success=false`）一律 `null` ⇒ 调用方静默保留搜索级字段。
     */
    async fetchSteamDetailForEntry(appid: number): Promise<Record<string, unknown> | null> {
        try {
            const d = await this.steam.fetchDetail(appid);
            return d ? { ...d } : null;
        } catch {
            return null;
        }
    }

    /** Bangumi 详情补全统一实现（subjects+persons API 并行）：评分/评价人数/制作公司/导演/主演；失败返回空对象（调用方决定兜底），进度标签（若有）成功失败都推进 */
    private async fetchBangumiDetail(
        id: number,
        prog?: SearchProgressReporter,
        label?: string,
    ): Promise<{ rating?: number; ratingCount?: number; studio?: string; director?: string; cast?: string[] }> {
        try {
            const [sub, persons] = await Promise.all([
                this.bangumi.fetchSubject(id),
                this.bangumi.fetchPersons(id),
            ]);
            return {
                rating: sub.rating,
                ratingCount: sub.ratingCount,
                studio: sub.studio,
                director: persons.director,
                cast: persons.cast,
            };
        } catch {
            return {};
        } finally {
            if (prog && label) prog.next(label);
        }
    }

    /** Bangumi 详情按需补全（选中搜索结果时调用）：合并 subjects+persons API 字段（评分/评价人数/导演/主演） */
    async fetchBangumiDetailForEntry(id: number): Promise<{ rating?: number; ratingCount?: number; director?: string; cast?: string[] }> {
        if (!this.settings.bangumiToken) return {};
        return this.fetchBangumiDetail(id);
    }

    /** Open Library 详情按需补全（选中搜索书籍时调用）：works.json 补简介/页数/出版社（搜索级 fields 不含）；
     *  字段投影为表单可填键（summary/pageCount/publisher，对齐 applyDoubanDetail 读取）；失败返回 null 静默。 */
    async fetchOpenLibraryDetailForEntry(key: string): Promise<Record<string, unknown> | null> {
        try {
            const d = await this.openLibrary.fetchWorkDetail(key);
            const out: Record<string, unknown> = {};
            if (d.description) out.summary = d.description;
            if (d.numberOfPages != null) out.pageCount = d.numberOfPages;
            if (d.publishers?.length) out.publisher = d.publishers[0];
            return Object.keys(out).length > 0 ? out : null;
        } catch {
            return null;
        }
    }

    /**
     * 🔴 #609 微信读书**详情按需补全**（表单选中「微信读书源」的搜索结果时调用）。
     *
     * 起因（用户报障）：「用微信读书源搜索添加」比「从微信读书同步书架」缺斤少两 —— 封面糊、出版年 / 出版社不回填。
     * 真根因：搜索接口（`/web/search/global`）**不返回 `publishTime`**（2026-10-11 实测 `囚徒健身` 那条
     * bookInfo 的字段表里没有出版年），且简介在**候选**里不是全文 ⇒ 与书架导入（逐本调详情）天然不一致。
     *
     * 🔴 走**同一个闸门** `wereadBookInfoGated`（串行 + 间隔）—— ⛔ 别为表单另开一条并发路径：
     *    微信读书对并发/高频请求会风控，书架导入那条闸门就是为此立的。
     * ⛔ 不抛：详情失败一律 `null` ⇒ 表单静默降级回搜索级字段（与豆瓣 / Open Library 同款）。
     */
    async fetchWereadDetailForEntry(bookId: string): Promise<WereadBookInfo | null> {
        const id = String(bookId ?? '').trim();
        if (!id || !hasWereadAuth(this.settings.wereadCookie)) return null;
        try {
            return await this.wereadBookInfoGated(id);
        } catch {
            return null;
        }
    }

    /** OMDb 详情按需补全（选中 IMDb 搜索结果时调用）：GET https://www.omdbapi.com/?i={imdbID}&plot=full 补 Plot/导演/演员/类型/评分；
     *  投影键名对齐 EntryForm.applyDoubanDetail（director/cast/genres/summary/cover/ratingCount + rating 供评分回填）；
     *  失败（未配 key / 网络 / 错误体）返回 null 静默，不阻塞保存。 */
    async fetchOmdbDetailForEntry(imdbID: string): Promise<OmdbDetailFields | null> {
        if (!this.settings.omdbApiKey || !imdbID) return null;
        try {
            return await this.omdb.detail(imdbID);
        } catch {
            return null;
        }
    }

    /** 影视搜索（TMDB/OMDb + 豆瓣并行，组内链源可自选）：按相似度排序合并（结果缓存 30min）。
     *  返回影视结果联合（TmdbSearchResult | OmdbSearchResult）：omdb id 为字符串，与 tmdb number 不可强塞（决策见 tests/omdb.test.ts） */
    async searchWithFallback(query: string, mediaType: 'movie' | 'tv', onProgress?: SearchProgressCb): Promise<MovieTvSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`${mediaType}:${q.toLowerCase()}`, () => this.searchMovieTvFresh(q, mediaType, onProgress));
    }

    private async searchMovieTvFresh(query: string, mediaType: 'movie' | 'tv', onProgress?: SearchProgressCb): Promise<MovieTvSearchResult[]> {
        // T3：组内 runner 集合执行——douban 主源（不限时）与组内 aux（tmdb，5s 超时）并行；链含未注册/无 runner 源静默跳过
        const run = await this.collectGroupSources<MovieTvSearchResult>('movieTv', mediaType, query, toTmdbResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        // 全链无结果且 douban 参与不可达（Cookie 失效/反爬）：明确提示；辅助源失败已静默（不打扰）
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'movieTv',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 书籍搜索（结果缓存 30min）：统一走 book 组（豆瓣主源 + Open Library / Google Books）；缓存 key 按子分类隔离防串（文学/网文命中同一源链，仅结果缓存分桶） */
    async searchBook(query: string, kind?: BookKind, onProgress?: SearchProgressCb): Promise<BookSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`book:${kind ?? ''}:${q.toLowerCase()}`, () => this.searchBookFresh(q, kind, onProgress));
    }

    private async searchBookFresh(query: string, kind?: BookKind, onProgress?: SearchProgressCb): Promise<BookSearchResult[]> {
        // T3/T4：组内 runner 集合执行——book 组：douban 主源（不限时）+ aux openLibrary（5s 超时）。
        // 🔴 2026-09-30 用户裁定：漫画**独立成组** ⇒ 组按子分类选 —— comic → comic 组（默认链 = 豆瓣单源），
        //    文学 / 网文 / 未指定 → book 组。判组走纯函数 `sourceGroupForBookKind`（可单测），
        //    ⛔ 别在这里内联 `kind === 'comic' ? 'comic' : 'book'` —— 那条三元是 1.0.3.1 删漫画时的历史形态，
        //      断言里按「已删」锚着；加回改用纯函数后断言也换成了锚 if 形态。
        // ⚠️ 两个组给豆瓣 runner 的 type 都是 `'book'`：豆瓣没有「漫画」这个 cat，漫画走图书检索（cat=1001）。
        const group = sourceGroupForBookKind(kind);
        const run = await this.collectGroupSources<BookSearchResult>(group, 'book', query, toBookResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group,
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 游戏搜索（Douban 单源；Douban 不可用时给出准确提示，结果缓存 30min） */
    async searchGame(query: string, onProgress?: SearchProgressCb): Promise<GameSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`game:${q.toLowerCase()}`, () => this.searchGameFresh(q, onProgress));
    }

    private async searchGameFresh(query: string, onProgress?: SearchProgressCb): Promise<GameSearchResult[]> {
        // T3/T6：game 组 runner 集合执行——douban 主源（不限时）与 aux steam（5s 超时）并行
        const run = await this.collectGroupSources<GameSearchResult>('game', 'game', query, toGameResult, createSearchProgress(onProgress));
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'game',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /**
     * 音乐搜索（Douban 单源 + **在线曲库**；结果缓存 30min）。
     *
     * 🔴 #464：音乐这一路要多带一份**在线曲库**结果（`SONG_LIB_ID` 那一栏）—— 起因是用户
     *    「豆瓣源搜作者，为什么不出现对应的音乐」：豆瓣音乐搜索**只按专辑名匹配**，搜歌手名基本搜不到
     *    他的歌；而「下载歌曲」窗口那条四平台链搜的就是「歌名 + 歌手」，搜 `BEYOND` 直接出
     *    《海阔天空》《光辉岁月》…。曲库**不是数据源**（不进注册表/不进源链），由表单按「音乐态 + 可下载」
     *    挂栏，这里只负责把结果并进来（栏位口径见 `EntryForm` 的 `songLibOn`）。
     */
    async searchMusic(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`music:${q.toLowerCase()}`, () => this.searchMusicFresh(q, onProgress));
    }

    private async searchMusicFresh(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        // T8：music 默认链 douban→musicbrainz→itunes 三源 runner 全注册；musicbrainz 参与后 iTunes 并行补齐中文曲库
        const prog = createSearchProgress(onProgress);
        // 曲库检索与元数据搜索**并行**（曲库不阻塞豆瓣；它自己也受 5s 上限，慢也不拖住整体）
        const [run, lib] = await Promise.all([
            this.collectGroupSources<MusicSearchResult>('music', 'music', query, toMusicResult, prog),
            this.songLibrarySearch(query, prog),
        ]);
        const merged = this.mergeGroupResults(run, query).concat(lib);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'music',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /**
     * 在线曲库检索（#464）：与「下载歌曲」窗口**同一个函数**（`dlSearchSongs` ⇒ 同一平台顺序、同一份结果），
     * ⛔ 别在这里另拼一份四平台请求。
     *
     * 门控与表单那枚「下载歌曲」按钮同源（`canUseAudioDownload`）—— 移动端没有 Node http，放进来必然失败。
     * 失败/超时静默降级（只上报该栏状态，不打扰）：曲库拿不到不该让整次音乐搜索报错，
     * 豆瓣那栏该出的照出（与 aux 源同口径）。
     */
    private async songLibrarySearch(query: string, prog: SearchProgressReporter): Promise<MusicSearchResult[]> {
        if (!this.canUseSongLibrary()) return [];
        try {
            const { songs } = await withTimeout(this.dlSearchSongs(query), AUX_SEARCH_TIMEOUT, `${SONG_LIB_LABEL} 搜索`);
            const items = songLibraryResults(songs, await this.songLibraryCovers(songs));
            prog.source({ id: SONG_LIB_ID, state: items.length > 0 ? 'ok' : 'empty', count: items.length });
            return items;
        } catch {
            prog.source({ id: SONG_LIB_ID, state: 'failed' });
            return [];
        }
    }

    /**
     * 曲库标题/封面补拉：网易云搜索结果**一条封面都不带**（`pure/posterSources.ts:12` 的实测记录），
     * 补一跳 `song/detail`（`neteaseCoversByIds`，免 Cookie）拿 `al.picUrl`。
     *
     * 🔴 为什么放在宿主侧而不是 `songLibraryResults` 里：那个是**同步纯函数**，三条链路都在用
     *    （表单结果栏 / 播放候选 / 封面搜索），改 async 会逼三处全变；而这一跳只有表单结果栏需要。
     * ⚠️ 失败一律返回**空 Map**（`neteaseCoversByIds` 内部已 catch）—— 没封面只是卡片少张图，
     *    ⛔ 不该让整次曲库检索报错。
     */
    private async songLibraryCovers(songs: readonly DownloadSong[]): Promise<Map<number, string>> {
        const ids = (songs ?? []).filter((s) => s.source === 'netease' && s.neteaseId != null).map((s) => s.neteaseId);
        if (!ids.length) return new Map();
        return neteaseCoversByIds(this.dlTransport(), ids);
    }

    /**
     * 音乐「下载 / 曲库检索」门控：**桌面端 + 「启用内置音乐播放器」开启**。
     * 🔴 单一真源 —— 表单的 `canDownload`（下载按钮 + 在线曲库栏）与宿主侧的曲库检索都从这里取，
     *    ⛔ 别在两处各写一遍 `Platform.isDesktopApp && settings.audioInlinePlayer`（那正是「按钮亮着但搜不到」
     *    这类不一致的来源）。
     */
    canUseAudioDownload(): boolean {
        return Platform.isDesktopApp && this.settings.audioInlinePlayer === true;
    }

    /**
     * #538 音乐「在线曲库」检索门控（用户 2026-10-05：「设置项可选择开启或关闭新增音乐条目『在线曲库』的搜索，
     * **默认关闭**」）。
     *
     * 🔴 与 `canUseAudioDownload()` **不是同一件事**：那个管「有没有能力发这套请求」，这个管「用户要不要它」。
     *    ⇒ 这里是「能力 ∧ 开关」的组合，且**只有这一处**做组合（单一真源）——
     *    表单的 `songLibraryEnabled`（曲库栏位）与宿主侧 `songLibrarySearch` 都从这里取，
     *    ⛔ 别在组件/服务里再摊一份（#464 立的「按钮亮着、曲库栏却永远空」正是两处口径分叉的产物）。
     * ⚠️ 默认关的理由（与 `audioInlinePlayer` 同款）：曲库检索要打四个平台（Node http），
     *    默认关能保证「升级后行为不变」——用户不主动开，音乐检索结果与旧版一模一样。
     */
    canUseSongLibrary(): boolean {
        return this.canUseAudioDownload() && this.settings.musicSongLibrary === true;
    }

    /** 动画搜索（Bangumi + 豆瓣并行）：按相似度排序合并；无 Token 且 Douban 不可用时给出准确提示（结果缓存 30min） */
    async searchAnime(query: string, onProgress?: SearchProgressCb): Promise<BangumiSearchResult[]> {
        const q = query.trim();
        if (!q) return [];
        return this.cachedSearch(`anime:${q.toLowerCase()}`, () => this.searchAnimeFresh(q, onProgress));
    }

    private async searchAnimeFresh(query: string, onProgress?: SearchProgressCb): Promise<BangumiSearchResult[]> {
        // T3：组内 runner 集合执行——douban 主源（不限时）与组内 aux（bangumi，5s 超时）并行；anime 组补全逻辑随链源接入保留
        const prog = createSearchProgress(onProgress);
        const run = await this.collectGroupSources<BangumiSearchResult>('anime', 'anime', query, toBangumiResult, prog);
        // Bangumi 搜索结果缺评分/导演/主演（搜索 API 不含）→ 前 3 条并行调详情补全（链含 bangumi、已配 Token 且搜索有结果时）
        const primary = run.auxItems.bangumi ?? [];
        const head = primary.slice(0, 3);
        const tail = primary.slice(3);
        let enriched = primary;
        if (head.length > 0) {
            const n = head.length;
            prog.addRemaining(n);
            const filled = await Promise.all(
                head.map(async (r, i) => {
                    const d = await this.fetchBangumiDetail(r.id, prog, `Bangumi 详情补全 ${i + 1}/${n}`);
                    return bangumiSearchEnrich(r, d);
                }),
            );
            enriched = [...filled, ...tail];
        }
        run.auxItems.bangumi = enriched;
        const merged = this.mergeGroupResults(run, query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'anime',
                chain: run.chain,
                douban: run.douban ? { reachable: run.douban.reachable, cookieInvalid: run.douban.cookieInvalid } : undefined,
                aux: run.aux,
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    /** 追番表「从 Bangumi 导入」：拉取用户收藏列表 → 建条目（title+type 去重跳过已存在；源=Bangumi 便于后续搜索回填） */
    async importBangumiCollections(
        userId: number | string | undefined,
        types: { want: boolean; watching: boolean; watched: boolean },
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number }> {
        const need = [types.want && 0, types.watching && 2, types.watched && 1].filter((v): v is 0 | 1 | 2 => typeof v === 'number');
        if (need.length === 0) return { added: 0, skipped: 0 };
        // 未填用户 ID：尝试从 Token 自动获取（/v0/me）
        let uid: number | string | undefined = userId;
        if (uid === undefined || uid === '') {
            try {
                const me = await this.bangumi.fetchMe();
                if (me.id) uid = me.id;
            } catch { /* 静默 */ }
        }
        if (!uid) throw new Error('未提供 Bangumi 用户 ID（自动获取失败）——可在追番表导入弹窗填写，或确认已配置 Bangumi Token');
        const existing = await this.service.list();
        const exists = (t: string, type: string) => existing.some((x) => x.title === t && x.type === type);
        let added = 0;
        let skipped = 0;
        for (const t of need) {
            let items: Awaited<ReturnType<BangumiClient['fetchUserCollections']>>;
            try {
                items = await this.bangumi.fetchUserCollections(uid, t);
            } catch {
                throw new Error('拉取 Bangumi 收藏失败——请确认 Token 有效且网络可用（需代理访问 bgm.tv）');
            }
            // 🔴 2026-11-08 修复：这里原来写*两遍**同一段三元，后一遍漏`${}`
            //    用户进度面板上看到的是一行原JS 表达。
            //    「拉取收藏列表（想看）{t === 0 ? '想看' : ...}）」。
            //    别再补第二遍手写文案：要改就改这一处。
            onProgress?.(0, items.length, `拉取收藏列表（${t === 0 ? '想看' : t === 2 ? '在看' : '已看'}）`);
            let done = 0;
            for (const r of items) {
                done++;
                onProgress?.(done, items.length, `导入 ${r.title}`);
                // subject.type 决定条目类型：2=动画（含剧场版动画电影）、6=电影；其余类型已在解析时跳过
                const entryType: 'anime' | 'movie' = r.entryType ?? 'anime';
                if (exists(r.title, entryType)) {
                    skipped++;
                    continue;
                }
                // 直接拉取详情入库：评分/评价人数/制作公司（subject API）+ 导演/主演（persons API）
                // 失败静默（保留收藏级字段），不阻塞导入流程
                // 🔴 2026-11-08：投影统一`bangumiDetailData` + `bangumiEntryFields`（三处手写映射收口）
                let detail: { rating?: number; ratingCount?: number; studio?: string } = {};
                let persons: { director?: string; cast?: string[]; studio?: string } = {};
                try {
                    detail = await this.bangumi.fetchSubject(r.id);
                } catch { /* 静默 */ }
                try {
                    persons = await this.bangumi.fetchPersons(r.id);
                } catch { /* 静默 */ }
                const fields = bangumiEntryFields(r, bangumiDetailData(detail, persons));
                const created = await this.service.create({
                    type: entryType,
                    title: r.title,
                    originalTitle: r.originalTitle || undefined,
                    year: r.year,
                    airDate: r.airDate,
                    status: t === 0 ? 'want' : t === 2 ? 'watching' : 'watched',
                    rating: 0,
                    genres: [],
                    cast: fields.cast ?? [],
                    director: fields.director,
                    developer: fields.developer, // 制作公司（动画复用 developer 字段，与 Bangumi 源搜索回填一致）
                    summary: r.summary,
                    communityScore: fields.communityScore,
                    ratingCount: fields.ratingCount,
                    poster: r.cover,
                    source: 'bangumi',
                    sourceUrl: `https://bgm.tv/subject/${r.id}`,
                    links: [],
                    notes: '',
                    tags: [],
                });
                // 🔴 #593：导入的条目也要像「表单新建」那样**当场生成笔记**（出口仍是唯一的 `writeNote`）。
                //    ⛔ 单条失败**不阻断**导入（与上面两处详情失败同款）；否则整批导入会被一本书卡住。
                try {
                    await this.service.writeNote(created.id);
                } catch { /* 笔记失败不阻断导入 */ }
                added++;
            }
        }
        await this.refreshViews();
        return { added, skipped };
    }

    /**
     * #581 读微信读书书架（同步弹窗的数据源）。
     *
     * 🔴 与 #580「测试连接」**同一个端点、同一份 Cookie**（服务层 `fetchWereadShelf`）；真伪判定
     *    （`errCode` → 文案）在纯模块里，⛔ 这里不再抄一遍。⛔ 只桌面端（底层走 Node 传输层）。
     * 🔴 「库里是否已有同名书」**在这里算好**（判重口径在 `partitionShelfBooks`，宿主只提供 `isImported`）——
     *    弹窗拿到的每一行都自带 `imported`，⛔ 别让 UI 自己去查 catalog。
     */
    async fetchWereadShelf(): Promise<WereadShelfFetchOutcome> {
        if (!Platform.isDesktopApp) return { ok: false, message: '微信读书书架同步仅桌面端支持' };
        const parsed = await fetchWereadShelfSvc(this.dlTransport(), this.settings.wereadCookie);
        if (!parsed.ok) return parsed;
        const entries = await this.service.list();
        // 判重范围 = **书籍**条目（同名的一部影视不该挡住一本书）
        const titles = new Set(entries.filter((e) => e.type === 'book').map((e) => e.title));
        const { dup } = partitionShelfBooks(parsed.books, (t) => titles.has(t));
        const dupIds = new Set(dup.map((b) => b.bookId));
        return {
            ok: true,
            snapshot: {
                rows: parsed.books.map((b) => ({ ...b, imported: dupIds.has(b.bookId) })),
                note: shelfExtraNote(parsed.stats),
            },
        };
    }

    /**
     * #582 **逐本拉详情**（串行 + 间隔；失败静默回 `null` ⇒ 调用方降级回书架级字段）。
     * 🔴 闸门与 #577 封面那条同构（`promise` 链 + 间隔）：微信读书对**并发/高频**请求会风控。
     */
    private wereadBookInfoGated(bookId: string): Promise<WereadBookInfo | null> {
        const task = this.wereadInfoGate
            .catch(() => undefined)
            .then(() => fetchWereadBookInfoSvc(this.dlTransport(), this.settings.wereadCookie, bookId));
        this.wereadInfoGate = task.then(() => new Promise<void>((r) => window.setTimeout(r, WEREAD_INFO_GAP_MS)));
        return task;
    }

    /**
     * ②-4 **逐本拉划线 + 想法**（串行 + 间隔；与 `wereadBookInfoGated` 共用 `wereadInfoGate`）。
     *
     * 🔴 三条口径：
     *   ⑴ **共用同一条闸门链**：详情与划线打的是同一个域名、同一份 Cookie，风控按请求数算 ——
     *      另开一条链等于并发翻倍，正是 #582 当初把详情串起来的那个原因；
     *   ⑵ **失败不抛**（服务层已折成 `{ ok, error, warning }`）：某本书拉不到划线 ⛔ 不能
     *      把整次书架导入打断 —— 导入成功、划线没跟上，是可接受的降级；
     *   ⑶ 用户没填 Cookie 时服务层会直接回 `ok:false`，调用方据此**静默跳过**（不逐本刷失败提示）。
     */
    private wereadNotesGated(bookId: string): Promise<WereadNotesOutcome> {
        const task = this.wereadInfoGate
            .catch(() => undefined)
            .then(() => fetchWereadNotesSvc(this.dlTransport(), this.settings.wereadCookie, bookId));
        this.wereadInfoGate = task.then(
            () => new Promise<void>((r) => window.setTimeout(r, WEREAD_INFO_GAP_MS)),
        );
        return task;
    }

    /**
     * ②-4 把一本书的划线 / 想法同步进它条目笔记的 `## 同步划线与高亮` 区（导入循环里逐本调）。
     *
     * 🔴 口径：
     *   ⑴ **拉不到就什么都不写** —— ⛔ 不建空区。用户没填 Cookie / 该书确实没划线时，
     *      笔记里凭空多出一个「共 0 条」的区只是噪音；
     *   ⑵ 同步失败 **⛔ 不打断导入**：`importWereadShelf` 的契约是「书必须进库」，
     *      划线是附加价值，失败只把原因塞进进度文字；
     *   ⑶ 内容交给 `pure/wereadNotes.renderWereadNotes` 渲染（⛔ 不在这里拼 markdown），
     *      写入交给 `EntryService.syncWereadNotes`（笔记 + 指纹的唯一出口）。
     */
    private async syncWereadNotesFor(
        bookId: string,
        entryId: string,
        title: string,
        onProgress: ((done: number, total: number, label: string) => void) | undefined,
        done: number,
        total: number,
    ): Promise<void> {
        try {
            onProgress?.(done, total, `同步划线 ${title}`);
            const res = await this.wereadNotesGated(bookId);
            if (!res.ok) {
                // Cookie / 登录失效：不逐本书刷同一条提示（一本书一Notice 会刷屏）
                if (res.error && !/Cookie/.test(res.error)) {
                    onProgress?.(done, total, `划线未同步 ${title}（${res.error}）`);
                }
                return;
            }
            if (res.notes.length === 0) return;
            const markdown = renderWereadNotes(res.notes, { syncedAt: Date.now() });
            await this.service.syncWereadNotes(entryId, markdown);
            if (res.warning) onProgress?.(done, total, `${res.warning} ${title}`);
        } catch {
            /* 划线失败不阻断导出 */
        }
    }

    /**
     * #581 把选中的书架书籍落库（导入循环 = 「调 `shelfBookEntryFields` + `service.create`」，
     * ⛔ 别在别处再拼一遍字段）。
     *
     * 🔴 判重口径 = **书名**（与 `partitionShelfBooks` / `importBangumiCollections` 同族）；命中的
     *    **跳过、不动已有条目**（用户 2026-10-09 裁定：不覆盖评语 / 评分 / 进度）。
     *    ⚠️ 用**本地 Set 累进**（⛔ 不能只查「打开弹窗那一刻」的快照：同一书名在书架里可能重复出现）。
     * 🔴 **#582**：落库前**逐本补详情**（`/web/book/info`）—— 书架同步**不含**评分与简介，
     *    用户点名「导入的书没有评分/简介」⇒ 补来的字段经 `shelfBookEntryFields(b, info)` 合并；
     *    ⚠️ 详情失败**不阻断**（该书用书架级字段照常导入）。
     */
    async importWereadShelf(
        books: WereadShelfBook[],
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; overridden: number; sameName: number; sameNames: string[] }> {
        const existing = await this.service.list();
        // 🔴 #664：按**书名**建索引（微信读书没有稳定 id，判重口径一直是书名 —— 见方法头注释），
        //    已有的**不再一律跳过**：勾上 = 覆盖那条（只换微信读书来源的字段，⛔ 不动用户自己的记录）。
        const byTitle = new Map<string, MediaEntry>();
        for (const e of existing) if (e.type === 'book') byTitle.set(e.title, e);
        // 🔴 2026-10-21（用户需求 4）：上面那张是**逐字标题**的覆盖判据（历史口径，⛔ 别改），
        //    这里另建一张**归一标题**索引，只用来拦「同名不同写法」——
        //    例：库里《三体》与书架里的《三体 》（多一个空格）/《ＴＨＥ ＢＯＯＫ》全角字母，
        //    逐字比会当成新书 ⇒ 新建一条 ⇒ 笔记按标题派生、落到同一个 .md 上把原笔记覆盖。
        const sameNameIndex = indexByTitleKey(existing);
        let added = 0;
        let skipped = 0;
        let overridden = 0;
        let sameName = 0;
        const sameNames: string[] = [];
        let done = 0;
        for (const b of books) {
            done++;
            const prev = byTitle.get(b.title);
            if (!prev && findTitleConflict(sameNameIndex, 'book', b.title)) {
                sameName++;
                sameNames.push(b.title);
                skipped++;
                onProgress?.(done, books.length, `跳过（库内同名） ${b.title}`);
                continue;
            }
            onProgress?.(done, books.length, `读取详情 ${b.title}`);
            const info = await this.wereadBookInfoGated(b.bookId);
            onProgress?.(done, books.length, `${prev ? '覆盖' : '导入'} ${b.title}`);
            const fields = shelfBookEntryFields(b, info);
            const payload: Partial<MediaEntry> = {
                ...fields,
                // 兜底放**最后**：`shelfBookEntryFields` 在没拿到分类时给的是 `undefined`（#582），
                // 直接透传会让 normalizeEntry 收到 undefined ⇒ 这里显式落成空数组。
                genres: fields.genres ?? [],
            };
            if (prev) {
                // 🔴 覆盖：**只换微信读书来源的字段**，用户自己的评语 / 评分 / 进度 / 摘抄 / 标签一律保留
                try {
                    await this.service.update(prev.id, payload);
                    await this.service.writeNote(prev.id);
                    overridden++;
                    await this.syncWereadNotesFor(b.bookId, prev.id, b.title, onProgress, done, books.length);
                } catch {
                    skipped++;
                }
                continue;
            }
            const created = await this.service.create({
                rating: 0,
                cast: [],
                links: [],
                notes: '',
                tags: [],
                ...payload,
            });
            // 🔴 #593：**导入的条目也要有笔记** —— 用户报障原话：「从微信读书同步书架导入的新增条目
            //    关联不到自动生成的笔记，点击提示『该条目还没有笔记』」。根因 = `service.create()`
            //    只写 catalog、**不生成笔记**（表单新建那条路在 `EntryModal` 里额外调了 `writeNote`）。
            //    ⇒ 这里补上同一件事（出口仍是唯一的 `service.writeNote`）。⚠️ 单条失败**不阻断**导入。
            try {
                await this.service.writeNote(created.id);
            } catch { /* 笔记失败不阻断导入 */ }
            await this.syncWereadNotesFor(b.bookId, created.id, b.title, onProgress, done, books.length);
            byTitle.set(b.title, created);
            added++;
        }
        await this.refreshViews();
        return { added, skipped, overridden, sameName, sameNames };
    }

    /** #581 打开「从微信读书同步书架」弹窗（入口：设置 › 基本设置 ›「启用内置阅读器」折叠组） */
    openWereadShelfSync(): void {
        new WereadShelfSyncModal(this.app, {
            onFetch: () => this.fetchWereadShelf(),
            onImport: (books, onProgress) => this.importWereadShelf(books, onProgress),
        }).open();
    }

    /**
     * 🔴 #665（用户：「做 TMDB 的同步接入」）：TMDB 账号同步弹窗。
     * 凭据 = `tmdbApiKey`（搜索）+ `tmdbSessionId`（账号接口）；account_id 用 session 现场换，用户 ⛔ 不用填。
     * 🔴 一键全量口径与豆瓣一致（#663）：**打开即读** 4 个组合（watchlist/favorite × movie/tv），逐项报进度。
     */
    openTmdbSync(): void {
        new TmdbSyncModal(this.app, {
            credentials: () => ({ apiKey: this.settings.tmdbApiKey ?? '', sessionId: this.settings.tmdbSessionId ?? '' }),
            existingKeys: () => this.tmdbKnownKeys(),
            onFetch: (list, mediaType) => this.tmdb.accountItems(this.settings.tmdbSessionId, list, mediaType),
            onImport: (rows, onProgress) => this.importTmdbAccount(rows, onProgress),
        }).open();
    }

    /**
     * 库里已有的 TMDB 条目键（`tmdb:{movie|tv}:{id}` —— 与 `tmdbItemKey` 同形）。
     * 🔴 弹窗与导入侧**共用**（⛔ 两份判据必然漂；类型从 `sourceUrl` 的路径段认）。
     */
    async tmdbKnownKeys(): Promise<Set<string>> {
        const out = new Set<string>();
        for (const e of await this.service.list()) {
            const m = (e.sourceUrl ?? '').match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
            if (m) out.add(tmdbItemKey(m[1] as 'movie' | 'tv', Number(m[2])));
        }
        return out;
    }

    /**
     * 把 TMDB 账号条目落库。
     *
     * 🔴 判重键 = `tmdb:${movie|tv}:${id}`（与豆瓣同构：**类型 + 来源 id**，同号不互并）
     * 🔴 **勾上库里已有的 = 覆盖**（#664 同款口径）：只换 TMDB 来源字段，⛔ 不动用户的评语/进度/摘抄/标签。
     * 🔴 TMDB 返回的是**社区分**（10 分制）⇒ 落 `communityScore`，**不写用户 rating**（用户没在 TMDB 打过分；
     *    Rated Movies 接口是另一套，本批不做 —— 别把社区分硬塞进个人评分字段）。
     * 详情走既有 `detail()`（credits 一起回），失败**不阻断**（清单级字段照常落地）。
     */
    async importTmdbAccount(
        rows: TmdbSyncRow[],
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number; sameNames: string[] }> {
        const existing = await this.service.list();
        const byTitle = indexByTitleKey(existing);
        const byKey = new Map<string, MediaEntry>();
        for (const e of existing) {
            const m = (e.sourceUrl ?? '').match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
            if (m) byKey.set(tmdbItemKey(m[1] as 'movie' | 'tv', Number(m[2])), e);
        }
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let overridden = 0;
        // 🔴 2026-10-21（用户需求 4）：「库内存在同名文件」而跳过的条数（真因见 `pure/importConflict`）
        let sameName = 0;
        const sameNames: string[] = [];
        let done = 0;
        for (const r of rows) {
            done++;
            const key = tmdbItemKey(r.mediaType, r.id);
            const prev = byKey.get(key);
            const entryType: 'movie' | 'tv' = r.mediaType === 'movie' ? 'movie' : 'tv';
            const dup = prev ? null : findTitleConflict(byTitle, entryType, r.title);
            if (dup) {
                sameName++;
                sameNames.push(r.title);
                skipped++;
                onProgress?.(done, rows.length, `跳过（库内同名） ${r.title}`);
                continue;
            }
            onProgress?.(done, rows.length, `${prev ? '覆盖' : '导入'} ${r.title}`);
            const status = tmdbListToStatus(r.list);
            const input: Partial<MediaEntry> = {
                type: entryType,
                title: r.title,
                originalTitle: r.originalTitle || undefined,
                status,
                // 🔴 2026-11-08 修障：TMDB 的 `vote_average` 本身就是 10 分制，与 `communityScore` 同刻度
                //    ⇒ **直接透传**。旧代码走 `tmdbVoteToRating`（÷2 四舍五入 → 1~5 星）把 8.4 存成 4，
                //    在 10 分制字段里等于「4 分」，评分排序 / 系列均分全被低估一半。
                // ⛔ 不写用户 `rating`：那是 1~5 星个人分，用户没打过分。
                communityScore: tmdbVoteToCommunityScore(r.voteAverage) as MediaEntry['communityScore'],
                year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : undefined,
                airDate: r.releaseDate ?? undefined,
                summary: r.overview || undefined,
                poster: r.posterPath ? tmdbPosterUrl(r.posterPath) : undefined,
                sourceUrl: tmdbSubjectUrl(r.mediaType, r.id),
                source: 'tmdb',
            };
            if (r.addedAt) {
                const marked = tmdbAddedAtToISO(r.addedAt);
                if (marked) input.createdAt = marked;
            }
            // 详情失败**不阻断**：清单级字段照常导入
            try {
                const d = await this.tmdb.detail(r.id, r.mediaType);
                Object.assign(input, {
                    genres: d.genres,
                    director: d.director,
                    cast: d.cast,
                });
                // 🔴 2026-11-08 修障：详情接口带回来的评评价人数以前**一个都没落*
                //    账号同步建出来的条目评分栏永远是空的（用户报障「同步获取评分不到」）。
                //    清单`voteAverage` / `voteCount` 先垫底，详情值非空时覆盖（详情通常更准）。
                if (d.rating != null) input.communityScore = d.rating as MediaEntry['communityScore'];
                if (d.ratingCount != null) input.ratingCount = d.ratingCount;
            } catch { /* 静默降级 */ }
            // 详情失败时至少保住清单接口自带的评价人数（`vote_count` 在列row 里就有）
            if (input.ratingCount == null && r.voteCount != null) input.ratingCount = r.voteCount;
            try {
                if (prev) {
                    // 🔴 覆盖：只换 TMDB 来源字段（⛔ 不动 notes/tags 等用户记录）
                    const patch: Partial<MediaEntry> = { ...input };
                    delete (patch as Record<string, unknown>).notes;
                    delete (patch as Record<string, unknown>).tags;
                    await this.service.update(prev.id, patch);
                    await this.service.writeNote(prev.id);
                    overridden++;
                } else {
                    const created = await this.service.create({
                        rating: 0,
                        cast: [],
                        links: [],
                        notes: '',
                        tags: [],
                        ...input,
                    });
                    try {
                        await this.service.writeNote(created.id);
                    } catch { /* 笔记失败不阻断 */ }
                    added++;
                }
                byKey.set(key, prev ?? (null as unknown as MediaEntry));
            } catch {
                failed++;
            }
        }
        await this.refreshViews();
        return { added, skipped, failed, overridden, sameName, sameNames };
    }

    /**
     * 🔴 #665（用户：「Bangumi 元数据源凭据行加个同步按钮并排」）：Bangumi 账号同步弹窗。
     * 凭据 = `bangumiToken`（已有）；account id 用 token 现场换（`fetchMe`），用户 ⛔ 不用填。
     * 🔴 一键全量口径与豆瓣 / TMDB 一致：**打开即读** 3 个状态（想看/在看/看过），逐项报进度。
     * ⚠️ 收藏列表**单次只回 50 条**（`fetchUserCollections` 现状）——本批先按"每状态一次"接，
     *    收藏超 50 的用户读不全，弹窗里会**如实提示**（⛔ 不假装拉全了）。
     */
    openBangumiSync(): void {
        new BangumiSyncModal(this.app, {
            token: () => this.settings.bangumiToken ?? '',
            onFetch: (state) => this.fetchBangumiCollection(state),
            onImport: (rows, onProgress) => this.importBangumiRows(rows, onProgress),
        }).open();
    }

    /**
     * 抓 Bangumi 收藏的某一个状态（想看 0 / 在看 2 / 看过 1 —— 与既有导入同一个映射）。
     * 🔴 用户 ID 用 token 换（`fetchMe`）；失败给**可读文案**（Bangumi 需代理，401 = Token 失效）。
     */
    async fetchBangumiCollection(
        state: 'want' | 'watching' | 'watched',
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<BangumiSearchResult[]> {
        const me = await this.bangumi.fetchMe();
        if (!me.id) throw new Error('没能从 Token 认出 Bangumi 用户 —— 请确认 Token 有效（bgm.tv 需代理访问）');
        const type = state === 'want' ? 0 : state === 'watching' ? 2 : 1;
        const items = await this.bangumi.fetchUserCollections(me.id, type);
        onProgress?.(items.length, items.length, `已读取 ${items.length} 条`);
        return items;
    }

    /**
     * Bangumi 收藏行落库（与 `importBangumiCollections` 的落库字段**同一套**——
     * ⛔ 别在这里另写一份字段拼装：那是两份判据的起点）。
     * 🔴 判重键 = `bgm.tv/subject/<id>`（Bangumi 的 id 全站唯一，裸 id 即可，无需类型前缀）。
     * 🔴 勾上已有的 = 覆盖（#664 口径）：只换来源字段。
     */
    async importBangumiRows(
        rows: Array<{ id: number; title: string; originalTitle?: string; year?: number; airDate?: string; summary?: string; rating?: number; ratingCount?: number; cover?: string; entryType?: 'anime' | 'movie'; state: 'want' | 'watching' | 'watched' }>,
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number; sameNames: string[] }> {
        const existing = await this.service.list();
        const byTitle = indexByTitleKey(existing);
        const byKey = new Map<string, MediaEntry>();
        for (const e of existing) {
            const m = (e.sourceUrl ?? '').match(/bgm\.tv\/subject\/(\d+)/);
            if (m) byKey.set(`bangumi:${m[1]}`, e);
        }
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let overridden = 0;
        // 🔴 2026-10-21（用户需求 4）：「库内存在同名文件」而跳过的条数（真因见 `pure/importConflict`）
        let sameName = 0;
        const sameNames: string[] = [];
        let done = 0;
        for (const r of rows) {
            done++;
            const key = `bangumi:${r.id}`;
            const prev = byKey.get(key);
            const entryType: 'anime' | 'movie' = r.entryType ?? 'anime';
            // ⚠️ 同名检测放在**发网络请求之前**：跳过就别再去抓详情/人物了。
            const dup = prev ? null : findTitleConflict(byTitle, entryType, r.title);
            if (dup) {
                sameName++;
                sameNames.push(r.title);
                skipped++;
                onProgress?.(done, rows.length, `跳过（库内同名） ${r.title}`);
                continue;
            }
            onProgress?.(done, rows.length, `${prev ? '覆盖' : '导入'} ${r.title}`);
            const input: Partial<MediaEntry> = {
                type: entryType,
                title: r.title,
                originalTitle: r.originalTitle || undefined,
                year: r.year,
                airDate: r.airDate,
                status: r.state,
                genres: [],
                summary: r.summary || undefined,
                communityScore: r.rating,
                ratingCount: r.ratingCount,
                poster: r.cover,
                source: 'bangumi',
                sourceUrl: `https://bgm.tv/subject/${r.id}`,
            };
            // 详情补全（评分/制作公司 + 导演/主演）；失败**不阻断**
            // 🔴 2026-11-08：投影统一`bangumiDetailData` + `bangumiEntryFields`（三处手写映射收口）
            let sub: { rating?: number; ratingCount?: number; studio?: string } = {};
            let people: { director?: string; cast?: string[]; studio?: string } = {};
            try {
                sub = await this.bangumi.fetchSubject(r.id);
            } catch { /* 静默 */ }
            try {
                people = await this.bangumi.fetchPersons(r.id);
            } catch { /* 静默 */ }
            Object.assign(input, bangumiEntryFields(r, bangumiDetailData(sub, people)));
            try {
                if (prev) {
                    const patch: Partial<MediaEntry> = { ...input };
                    delete (patch as Record<string, unknown>).notes;
                    delete (patch as Record<string, unknown>).tags;
                    await this.service.update(prev.id, patch);
                    await this.service.writeNote(prev.id);
                    overridden++;
                } else {
                    const created = await this.service.create({
                        rating: 0,
                        cast: [],
                        links: [],
                        notes: '',
                        tags: [],
                        ...input,
                    });
                    try {
                        await this.service.writeNote(created.id);
                    } catch { /* 笔记失败不阻断 */ }
                    added++;
                }
                byKey.set(key, prev ?? (null as unknown as MediaEntry));
            } catch {
                failed++;
            }
        }
        await this.refreshViews();
        return { added, skipped, failed, overridden, sameName, sameNames };
    }

    /**
     * 🔴 #662（用户：「元数据源凭据-豆瓣凭据入口再添加个同步导入按钮」）：
     * 打开「从豆瓣同步收藏」弹窗（入口 = 豆瓣凭据行的动作行，与微信读书 / Steam 同构）。
     * ⚠️ 判重 / 落库 / 进度都走宿主，弹窗只做展示与勾选（与 `WereadShelfSyncModal` 同口径）。
     */
    openDoubanCollectionSync(): void {
        new DoubanSyncModal(this.app, {
            cookie: () => this.settings.doubanCookie,
            existingKeys: () => this.doubanKnownKeys(),
            onFetch: (kind, state) => this.fetchDoubanCollection(kind, state),
            onImport: (rows, onProgress) => this.importDoubanCollection(rows, onProgress),
        }).open();
    }

    /**
     * 库里已有的豆瓣条目键（`kind:id` —— 与 `doubanItemKey` 同形）。
     *
     * 🔴 判重键 = **类型 + 豆瓣 id**，不是裸 id：豆瓣各站点的 subject 编号**互相独立**
     *    ⇒ 一键读取会把电影和书一起拉回来，裸 id 会把「同号的电影」与「同号的书」误合并。
     *    ⚠️ 类型从 `sourceUrl` 的**子域**认（`movie.douban.com` → movie / `book.` → book / `www.`+`/games/` → game）。
     * 🔴 **弹窗与导入侧共用这一个方法**（⛔ 别各算一份 —— 两份判据迟早会漂）。
     */
    async doubanKnownKeys(): Promise<Set<string>> {
        const out = new Set<string>();
        for (const e of await this.service.list()) {
            const url = e.sourceUrl ?? '';
            const idM = url.match(/subject\/(\d{5,10})/);
            if (!idM) continue;
            const kind = /music\.douban\.com/.test(url)
                ? 'music'
                : /book\.douban\.com/.test(url)
                  ? 'book'
                  : /movie\.douban\.com/.test(url)
                    ? 'movie'
                    : /games/.test(url)
                      ? 'game'
                      : null;
            if (kind) out.add(doubanItemKey(kind, idM[1]));
        }
        return out;
    }

    /**
     * 抓豆瓣「我的收藏」某一类某一状态的全部条目（翻页直到够数）。
     *
     * 🔴 用户 ID 从 **Cookie 的 `dbcl2`** 里认（`doubanUserIdFromCookie`）—— 少一个必填项；
     *    认不出才报错让用户补 Cookie。
     * 🔴 翻页用 `total` 判定（页面上的「1/234」），⛔ 不靠"这一页不满 15 条"猜 ——
     *    豆瓣最后一页常常正好 15 条，猜会**永久漏掉尾部**。
     * ⚠️ 请求走 `DoubanClient.fetchPage`（复用同一套反爬处理），页与页之间**留间隔**（豆瓣对高频很敏感）。
     */
    async fetchDoubanCollection(
        kind: DoubanSyncKind,
        state: DoubanCollectionState,
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<DoubanCollectionItem[]> {
        const cookie = (this.settings.doubanCookie ?? '').trim();
        if (!cookie) throw new Error('未配置豆瓣 Cookie —— 先在上面填入登录态 Cookie（含 dbcl2），收藏列表需要登录态');
        const userId = doubanUserIdFromCookie(cookie);
        if (!userId) throw new Error('没能从 Cookie 里认出豆瓣用户 ID（Cookie 里应有 dbcl2）—— 请重新登录豆瓣复制完整 Cookie');
        const all: DoubanCollectionItem[] = [];
        const seen = new Set<string>();
        let total = 0;
        for (let start = 0; start < 2000; start += DOUBAN_PAGE_SIZE) {
            const html = await this.douban.fetchPage(doubanCollectionUrl(kind, userId, state, start));
            const page = parseDoubanCollectionPage(html);
            if (start === 0) {
                total = page.total;
                // 🔴 第一页就 0 行且总数也是 0 ⇒ 真的没收藏；但若 total>0 却 0 行 ⇒ 页面结构变了，必须说出来
                if (page.total > 0 && page.items.length === 0) {
                    throw new Error('豆瓣收藏页的结构看起来变了（页面说有收藏，但一条也解析不出来）—— 请把这条反馈给插件作者');
                }
            }
            for (const it of page.items) {
                if (seen.has(it.id)) continue;
                seen.add(it.id);
                all.push(it);
            }
            onProgress?.(all.length, total || all.length, `已读取 ${all.length}${total ? ` / ${total}` : ''} 条`);
            // 够了 / 空页 ⇒ 停
            if (page.items.length === 0) break;
            if (total > 0 && all.length >= total) break;
            if (total === 0 && page.items.length < DOUBAN_PAGE_SIZE) break;
            // 页间隔（豆瓣风控）
            await new Promise<void>((r) => window.setTimeout(r, 900));
        }
        return all;
    }

    /**
     * 把抓到的收藏条目落库。
     *
     * 🔴 **判重口径 = 豆瓣 id**（`sourceUrl` 里带 `/subject/<id>/`）—— 比按标题判重更准：
     *    同名的不同作品（重制 / 同名剧集）不会互相顶掉，改名后的旧条目也不会被重复导入。
     *    ⚠️ 与微信读书（按书名）不同不是疏漏：豆瓣每条都带稳定 id，有条件就该用更强的判据。
     * 🔴 已存在的**跳过、不动已有条目**（⛔ 不覆盖评语 / 评分 / 进度）—— 与其它三个导入同一口径。
     * 🔴 逐条拉详情（`fetchDetail`）：列表页只有标题 / 评分 / 日期，**没有简介、年份、导演等**；
     *    详情失败**不阻断**（用列表级字段照常导入），但要在结果里如实计入 `detailFailed`。
     */
    async importDoubanCollection(
        rows: DoubanSyncRow[],
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number; sameNames: string[] }> {
        // 🔴 #663：一键读取送来的行**四类混在一起**，每条自带 `kind` / `state` ——
        //    所以类型与状态都按**每一行**取，⛔ 不再用方法参数（那会让整批只能是一种类型）。
        // 🔴🔴 #664（用户：「为什么无法勾选库内已有的覆盖」）：
        //    **勾上的「库里已有」行 = 覆盖**（不再一律跳过）。覆盖口径：
        //      · 只覆盖**豆瓣来源的字段**（`sourceUrl` + 详情字段 + 评分 + 状态 + 标记时间）；
        //      · ⛔ **不动用户自己的东西**：评语（notes）/ 进度 / 摘抄 / 标签 —— 那是用户的记录，不是豆瓣的。
        const existing = await this.service.list();
        const byKey = new Map<string, MediaEntry>();
        for (const e of existing) {
            const url = e.sourceUrl ?? '';
            const idM = url.match(/subject\/(\d{5,10})/);
            if (!idM) continue;
            const kind = /music\.douban\.com/.test(url)
                ? 'music'
                : /book\.douban\.com/.test(url)
                  ? 'book'
                  : /movie\.douban\.com/.test(url)
                    ? 'movie'
                    : /games/.test(url)
                      ? 'game'
                      : null;
            if (kind) byKey.set(doubanItemKey(kind, idM[1]), e);
        }
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let overridden = 0;
        // 🔴 2026-10-21（用户需求 4）：因「库内存在同名文件」而跳过的条数 + 标题。
        //    真因见 `pure/importConflict` 头注释：笔记路径按标题派生 ⇒ 同名 = 同一个 .md 被覆盖。
        let sameName = 0;
        const sameNames: string[] = [];
        const byTitle = indexByTitleKey(existing);
        let done = 0;
        for (const r of rows) {
            done++;
            const key = doubanItemKey(r.kind, r.id);
            const prev = byKey.get(key);
            // ⚠️ 只在「要**新建**」这条路上查同名：命中已有豆瓣 id（`prev`）时走覆盖，
            //    那是用户勾选的意图，不该被同名检测拦掉。
            const dup = prev ? null : findTitleConflict(byTitle, r.kind, r.title);
            if (dup) {
                sameName++;
                sameNames.push(r.title);
                skipped++;
                onProgress?.(done, rows.length, `跳过（库内同名） ${r.title}`);
                continue;
            }
            onProgress?.(done, rows.length, `${prev ? '覆盖' : '导入'} ${r.title}`);
            // ⚠️ 只写 `MediaEntry` 里**真的存在**的字段（`sourceFrom` 不在 schema 里 ——
            //    本仓 schema 只增不改，⛔ 别为了一个导入顺手加字段）。
            const input: Partial<MediaEntry> = {
                type: r.kind,
                title: r.title,
                status: doubanStateToStatus(r.kind, r.state),
                rating: doubanRatingToEntryRating(r.rating) as MediaEntry['rating'],
                sourceUrl: doubanSubjectUrl(r.kind, r.id),
            };
            if (r.markedAt) {
                // 「标记时间」进创建时间（用户能看到"我什么时候在豆瓣标的"）
                input.createdAt = r.markedAt;
            }
            // 详情失败**不阻断**：列表级字段照常导入（只有标题时也仍然是一条可用条目）
            try {
                const subject = await this.douban.fetchDetail({ id: r.id, title: r.title, cast: [], genres: [] }, r.kind);
                Object.assign(input, toEntryDetailFields(subject));
            } catch {
                /* 静默降级 */
            }
            try {
                if (prev) {
                    // 🔴 覆盖：**只换豆瓣来源的字段**，用户自己的评语 / 进度 / 摘抄 / 标签一律保留
                    //    （`service.update` 是按字段合并的，这里显式剔除不该动的键，⛔ 别整条替换）
                    const patch: Partial<MediaEntry> = { ...input };
                    delete (patch as Record<string, unknown>).notes;
                    delete (patch as Record<string, unknown>).tags;
                    await this.service.update(prev.id, patch);
                    overridden++;
                } else {
                    await this.service.create(input);
                    added++;
                }
                byKey.set(key, prev ?? (null as unknown as MediaEntry));
            } catch {
                failed++;
            }
        }
        await this.refreshViews();
        return { added, skipped, failed, overridden, sameName, sameNames };
    }


    /** 网站更新检测缓存（10min TTL：追更表每次打开都检测会频繁抓站，命中直接复用） */
    private readonly updateCheckCache = createSearchCache<unknown>({ ttlMs: 10 * 60 * 1000, maxSize: 100 });

    /** 剧集/动画更新检测（参考 Bangumi-Bridge 追番脚本）：抓观看网址 HTML → 提最大集数 → 对比已看集数
     *  返回 null 表示无观看网址；失败/无集数信息/站点拦截返回带 error/status 的结果；结果按 url 缓存 10min
     *  force=true 跳过缓存（「重新检测」按钮用）；超时保护：requestUrl 无公开超时参数，用 withTimeout 兜底防挂起 */
    async checkUpdateFor(url: string, watchedEpisodes: number, force: boolean = false): Promise<UpdateCheckResult | null> {
        const u = url.trim();
        if (!u) return null;
        const key = `check:${u}:${watchedEpisodes}`;
        if (!force) {
            const hit = this.updateCheckCache.get(key);
            if (hit) return hit[0] as UpdateCheckResult;
        }
        const result = await checkAnimeUpdate(
            async (target) => {
                const res = await withTimeout(
                    requestUrl({ url: target, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }),
                    10000,
                    '更新检测请求',
                );
                if (res.status === 200) return res.text;
                // 非 200：若 body 是人机验证/反爬拦截页（cdndefend 常返回 403 + 挑战页特征），
                // 返回文本让 checkAnimeUpdate 判为 blocked（而不是笼统 failed），用户才能看到「🔒 站点拦截」
                if (isBlockedPage(res.text)) return res.text;
                throw new Error(`HTTP ${res.status}`);
            },
            u,
            watchedEpisodes,
        );
        this.updateCheckCache.set(key, [result]);
        return result;
    }

    async fetchTmdbDetail(r: TmdbSearchResult): Promise<Partial<TmdbDetail> & { posterPath?: string }> {
        const d = await this.tmdb.detail(r.id, r.mediaType);
        return { ...d, posterPath: r.posterPath };
    }

    /**
     * 测试连接统一包装：measure 全程耗时 + withTimeout 超时（10s），
     * 无论成功/失败/超时都返回 elapsedMs，供设置页「✓ 连接成功 · 423ms」展示。
     */
    private async runTest(label: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<SourceTestResult> {
        return measure(() => withTimeout(fn(), TIMEOUT_MS, label)).then(
            ({ elapsedMs, result }) => ({ ...result, elapsedMs }),
            (e) => ({
                ok: false,
                message: e instanceof Error ? e.message : String(e),
                elapsedMs: e instanceof TimedError ? e.elapsedMs : TIMEOUT_MS,
            }),
        );
    }

    /** 测试 TMDB 连接（设置页按钮）：请求 configuration 接口，按状态码反馈 */
    async testTmdbConnection(): Promise<SourceTestResult> {
        return this.runTest('TMDB 连接', async () => {
            const key = this.settings.tmdbApiKey;
            if (!key) return { ok: false, message: '未配置 TMDB API Key' };
            try {
                const res = await requestUrl({
                    url: `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`,
                });
                if (res.status === 200) return { ok: true, message: '连接成功：TMDB API Key 有效' };
                if (res.status === 401) return { ok: false, message: '连接失败：API Key 无效（HTTP 401）' };
                if (res.status === 429) return { ok: false, message: '连接失败：请求过于频繁（HTTP 429）' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 Bangumi 连接（设置页按钮）：GET /v0/me 验证 Access Token */
    async testBangumiConnection(): Promise<SourceTestResult> {
        return this.runTest('Bangumi 连接', async () => {
            if (!this.settings.bangumiToken) {
                return { ok: false, message: '未配置 Bangumi Access Token' };
            }
            try {
                await this.bangumi.testConnection();
                return { ok: true, message: '连接成功：Bangumi Access Token 有效' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试豆瓣可用性（设置页按钮）：探测 j/search 是否可访问且返回正常 JSON */
    async testDoubanConnection(): Promise<SourceTestResult> {
        return this.runTest('Douban 连接', async () => {
            try {
                await this.douban.testConnection();
                return { ok: true, message: 'Douban 搜索接口可访问' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 OMDb 连接（设置页按钮，T11 调用）：GET https://www.omdbapi.com/?apikey={key}&i=tt3896198&plot=short 轻量 ping；
     *  未配 key / 网络失败给出明确文案（未配置/连接失败区分） */
    async testOmdbConnection(): Promise<SourceTestResult> {
        return this.runTest('OMDb 连接', async () => {
            const key = this.settings.omdbApiKey;
            if (!key) return { ok: false, message: '未配置 OMDb API Key' };
            try {
                const res = await retry(() =>
                    requestUrl({ url: buildDetailUrl(key, 'tt3896198', 'short') }),
                );
                // 200 = ping 成功（无效 key OMDb 回 HTTP 401，超额回 429）
                if (res.status === 200) return { ok: true, message: '连接成功：OMDb API Key 有效' };
                if (res.status === 401) return { ok: false, message: '连接失败：API Key 无效（HTTP 401）' };
                if (res.status === 429) return { ok: false, message: '连接失败：请求次数已达上限（HTTP 429）' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 Google Books 连接（设置页按钮 #165 T11 调用）：volumes?q=test&maxResults=1 轻量 ping）
     *  Key 可选——未配 key 仍可用（公开免费额度）故成功时注明；无效 key / 429 限流给明确文案 */
    async testGoogleBooksConnection(): Promise<SourceTestResult> {
        return this.runTest('Google Books 连接', async () => {
            try {
                const url = buildSearchUrl('test', this.settings.googleBooksApiKey || undefined, 1);
                const res = await retry(() => requestUrl({ url }));
                if (res.status === 200) {
                    return this.settings.googleBooksApiKey
                        ? { ok: true, message: '连接成功：Google Books API Key 有效' }
                        : { ok: true, message: '连接成功：Google Books API 可访问（未配 Key，公开免费额度）' };
                }
                if (res.status === 429) return { ok: false, message: '连接失败：请求过于频繁（HTTP 429），建议配置 API Key' };
                return { ok: false, message: `连接失败：HTTP ${res.status}` };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 测试 IGDB 连接（设置页按钮）：双凭据齐备 → igdb.testConnection（换新 token + limit 1 查询）。
     *  与其它源 runTest 计时/文案口径一致；缺任一凭据给明确提示 */
    async testIgdbConnection(): Promise<SourceTestResult> {
        return this.runTest('IGDB 连接', async () => {
            if (!this.settings.igdbClientId || !this.settings.igdbClientSecret) {
                return { ok: false, message: '未配置 IGDB 双凭据（需 Client ID 与 Client Secret）' };
            }
            try {
                await this.igdb.testConnection();
                return { ok: true, message: '连接成功：IGDB 凭据有效，可访问 v4/games' };
            } catch (e) {
                return { ok: false, message: '连接失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /**
     * 测试微信读书连接（设置页按钮，#580）：带用户 Cookie 打一次**书架 / 鉴权**接口验登录态。
     *
     * 🔴 三条口径：
     *   ⑴ **不能只看状态码** —— 该端点未登录时回 **HTTP 200**（实测），真相在 body 的 `errCode` 里
     *      ⇒ 真伪判定全交给纯函数 `parseWereadShelfAuth`（服务层 `testWereadAuth` 已接好）；
     *   ⑵ **空 Cookie 不发请求** ⇒ 直接给「未填写」文案（⛔ 别把「没填」误报成「网络失败」）；
     *   ⑶ ⛔ **只桌面端** —— 底层走 Node 传输层；移动端如实拒绝（与 `searchWeread` 同口径）。
     * ⚠️ 微信读书的 Cookie 是**可选**的（书籍检索免登录，见 `sourceRegistry.emptyBadge`）——
     *    这里测的是**书架登录态**，所以未填时给的是「未填写」而非「不可用」。
     */
    async testWereadConnection(): Promise<SourceTestResult> {
        return this.runTest('微信读书 连接', async () => {
            if (!hasWereadAuth(this.settings.wereadCookie)) {
                return { ok: false, message: '未填写微信读书 Cookie' };
            }
            if (!Platform.isDesktopApp) {
                return { ok: false, message: '微信读书连接测试仅桌面端支持' };
            }
            return testWereadAuth(this.dlTransport(), this.settings.wereadCookie);
        });
    }

    // ── 🔴 #639 ⑥ Steam 集成（Web API：库 / 愿望单 / 游玩时长）──────────────────────────

    /**
     * Steam 凭据是否配置齐（两个字段都要：库接口要 Key，愿望单接口要 SteamID）。
     * 🔴 **两件都验**：只填一个就发请求的话，会拿到一句看不懂的 401 / 空响应。
     * 🔴 #664：改成 `public` —— 设置页要在**发请求之前**就拦住（否则"点了先转圈再失败"，
     *    而失败后的整页重建会把那一行**收起**，用户连提示都没看见，见 `renderSteamActions` 的注释）。
     */
    steamCredsIssue(): string | null {
        const keyIssue = steamKeyIssue(this.settings.steamApiKey);
        if (keyIssue) return keyIssue;
        const idIssue = steamIdIssue(this.settings.steamId);
        if (idIssue) return idIssue;
        return null;
    }

    /** Web API 的 HTTP 口（走 `requestUrl`；失败抛错由服务层折成三态）。⚠️ 桌面/移动都能用（纯 HTTP，不依赖 Node） */
    private steamGet = async (url: string): Promise<string> => {
        const res = await requestUrl({ url });
        return res.text;
    };

    /** 测试 Steam 连接：打一次**库**接口（它是唯一强制要 Key 的 ⇒ 才验得出凭据好坏） */
    async testSteamConnection(): Promise<SourceTestResult> {
        return this.runTest('Steam 连接', async () => {
            const issue = this.steamCredsIssue();
            if (issue) return { ok: false, message: issue };
            return testSteamAuth(this.steamGet, String(this.settings.steamApiKey), String(this.settings.steamId));
        });
    }

    /**
     * 🔴 2026-11-09 第 15 轮阶段 C：**从音乐平台同步清单**（用户：「给三大音乐平台加搜索元数据和
     * 同步清单的功能」）。
     *
     * 与另外五个账号同步弹窗**完全同构**（先弹窗列清单、勾选、导入、Notice 回执），
     * 唯独多一层「先选歌单」：网易云一个账号常有几十个歌单，一屏放不下全部曲目。
     *
     * 三条已裁定口径（见 `pure/musicPlaylist` 文件头）：
     *  ⑴ 只落单曲，歌单名写进标签 —— ⛔ 不建「歌单条目」、不扩 schema；
     *  ⑵ Cookie 过期就停（明确提示重贴，⛔ 不重试、⛔ 不静默降级成匿名拉公开数据）；
     *  ⑶ 每家独立降级 —— 某家失败只影响它自己的区块。
     */
    openMusicSync(onlyPlatform?: string): void {
        new MusicSyncModal(this.app, {
            ...(onlyPlatform ? { onlyPlatform } : {}),
            onFetch: () => this.fetchMusicSyncLists(onlyPlatform),
            onFetchTracks: (platform, playlistId) => this.fetchMusicSyncTracks(platform, playlistId),
            onImport: (rows, onProgress) => this.importMusicSyncRows(rows, onProgress),
        }).open();
    }

    /** 音乐平台 Cookie（三家各自一条；缺失 = 该家报「未粘贴」而不是整轮失败） */
    private musicCookieOf(platform: string): string {
        const all = (this.settings.musicDlCookies ?? {}) as Record<string, string | undefined>;
        return String(all[platform] ?? '').trim();
    }

    /**
     * 拉各平台「我的歌单」列表（弹窗打开时调一次）。
     *
     * 🔴 三家**各自 try/catch**：一家抛错只记在它自己的 `reason` 里，⛔ 不把整轮判失败
     *    （用户裁定⑶「接受私有接口风险，但每个平台独立降级」）。
     * 🔴 酷狗**明确不支持**（`KUGOU_SYNC_UNSUPPORTED`）—— 它的「我的歌单」走 android 网关
     *    签名接口，本仓没有这套签名器。⛔ 别假装能同步然后给空列表。
     */
    async fetchMusicSyncLists(onlyPlatform?: string): Promise<
        | { ok: true; snapshot: { ok: boolean; message: string; platforms: MusicSyncPlatformState[] } }
        | { ok: false; message: string }
    > {
        if (!Platform.isDesktopApp) return { ok: false, message: '清单同步仅支持桌面端' };
        const transport = this.dlTransport();
        const out: MusicSyncPlatformState[] = [];
        const okSources: string[] = [];
        const failed: { platform: string; reason: string }[] = [];
        // 🔴 2026-11-09 16 轮：从某一家凭据行进来时只拉那一—别「照旧拉全部、只UI 藏掉」
        //    那样另一家没Cookie 也会白跑一次请求、还会把它的失败混进状态栏。
        const wants = (p: string): boolean => !onlyPlatform || onlyPlatform === p;

        const neteaseCookie = this.musicCookieOf('netease');
        if (wants('netease')) try {
            const r = await neteaseMyPlaylists(transport, neteaseCookie);
            out.push({
                platform: 'netease',
                label: musicPlatformLabel('netease'),
                lists: r.items,
                ...(r.reason ? { reason: r.reason } : {}),
                ...(r.expired ? { expired: true } : {}),
            });
            if (r.reason) failed.push({ platform: musicPlatformLabel('netease'), reason: r.reason });
            else okSources.push(musicPlatformLabel('netease'));
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            out.push({ platform: 'netease', label: musicPlatformLabel('netease'), lists: [], reason });
            failed.push({ platform: musicPlatformLabel('netease'), reason });
        }

        const qqCookie = this.musicCookieOf('qq');
        if (wants('qq')) try {
            const r = await qqMyPlaylists(transport, qqCookie);
            out.push({
                platform: 'qq',
                label: musicPlatformLabel('qq'),
                lists: r.items,
                ...(r.reason ? { reason: r.reason } : {}),
                ...(r.expired ? { expired: true } : {}),
            });
            if (r.reason) failed.push({ platform: musicPlatformLabel('qq'), reason: r.reason });
            else okSources.push(musicPlatformLabel('qq'));
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            out.push({ platform: 'qq', label: musicPlatformLabel('qq'), lists: [], reason });
            failed.push({ platform: musicPlatformLabel('qq'), reason });
        }

        // 酷狗：如实说「不支持」，不伪装成「你没歌单。
        if (wants('kugou')) {
            out.push({ platform: 'kugou', label: musicPlatformLabel('kugou'), lists: [], reason: KUGOU_SYNC_UNSUPPORTED });
            failed.push({ platform: musicPlatformLabel('kugou'), reason: KUGOU_SYNC_UNSUPPORTED });
        }

        const message = musicSyncPartialMessage(okSources, failed);
        return { ok: true, snapshot: { ok: okSources.length > 0, message, platforms: out } };
    }

    /**
     * 拉某个歌单的曲目，并标出「库里已有」（弹窗默认不勾那些，勾上=覆盖）。
     *
     * ⚠️ 「库里已有」判据与落库同源：`indexMusicEntries` 从条目反解 `music:{source}:{id}`，
     *    ⛔ 别在这里另写一套（本仓 Steam 踩过「两个入口各写一份」）。
     */
    async fetchMusicSyncTracks(platform: string, playlistId: string): Promise<MyListOutcome<MusicSyncRow>> {
        if (!Platform.isDesktopApp) return { items: [], reason: '清单同步仅支持桌面端' };
        const transport = this.dlTransport();
        const cookie = this.musicCookieOf(platform);
        let lists: MusicSyncPlaylist[] = [];
        try {
            const r = platform === 'qq' ? await qqMyPlaylists(transport, cookie) : await neteaseMyPlaylists(transport, cookie);
            lists = r.items;
        } catch {
                    /* 只为拿歌单名；拿不到就退回 platform 名 */
        }
        const playlistName = lists.find((p) => p.id === playlistId)?.name ?? '';

        const result =
            platform === 'qq'
                ? await qqPlaylistTracks(transport, playlistId, cookie)
                : await neteasePlaylistTracks(transport, playlistId, cookie);
        if (result.reason) return { items: [], reason: result.reason, ...(result.expired ? { expired: true } : {}) };

        const known = indexMusicEntries(await this.service.list());
        const rows: MusicSyncRow[] = musicCandidatesFromSongs(
            result.items.map((s) => ({ ...s, source: platform as DownloadSong['source'] })),
            { source: platform, playlistName: playlistName || musicPlatformLabel(platform) },
        ).map((c) => (known.has(c.key) ? { ...c, imported: true } : c));
        return { items: rows };
    }

    /**
     * 导入弹窗里勾选的曲目。
     *
     * 🔴 按 `playlistName` **分组**再逐组调 `importMusicSongs` —— 标签按歌单来，
     *    一次导入跨了好几个歌单时必须各写各的（用户在弹窗里切歌单勾选是允许的）。
     * 🔴 汇总走 `musicSyncSummary`（唯一文案真源，⛔ 别在弹窗里再拼一遍）。
     */
    async importMusicSyncRows(
        rows: readonly MusicSyncRow[],
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number }> {
        const groups = new Map<string, MusicSyncRow[]>();
        for (const r of rows ?? []) {
            const name = String(r?.playlistName ?? '').trim();
            const bucket = groups.get(name);
            if (bucket) bucket.push(r);
            else groups.set(name, [r]);
        }
        const total = { added: 0, skipped: 0, failed: 0, overridden: 0, sameName: 0 };
        let done = 0;
        for (const [name, group] of groups) {
            const songs: DownloadSong[] = group.map((r) => ({
                source: r.source as DownloadSong['source'],
                id: r.songId,
                name: r.title,
                artist: r.artist ?? '',
                ...(r.album ? { album: r.album } : {}),
                ...(r.poster ? { coverUrl: r.poster } : {}),
                ...(r.webUrl ? { webUrl: r.webUrl } : {}),
            }));
            const res = await this.importMusicSongs(songs, (d, _t, label) => {
                onProgress?.(done + d, rows.length, label);
            }, name);
            done += group.length;
            total.added += res.added;
            total.skipped += res.skipped;
            total.failed += res.failed;
            total.overridden += res.overridden;
            total.sameName += res.sameName;
        }
        return total;
    }

    /**
     * 🔴 2026-10-25（用户原话）：「所有类型账号同步是要先列出弹窗列出游戏让我勾选才同步（库内已有要提示覆盖）」。
     *
     * ⇒ 「立即同步」按钮的口径从**直接落库**改为**先弹窗列清单**，与豆瓣 / Bangumi / TMDB / 微信读书
     *    四个同步弹窗**完全同构**（本仓既定：同一个「账号同步」交互不许出现第二套勾选语义）。
     * ⚠️ 启动时那条**静默**自动同步（`autoSyncSteamQuietly`）仍走 `syncSteamNow()`，⛔ 不弹窗 ——
     *    开机弹一个清单让用户勾选是打扰，那条只负责刷游玩时长。
     */
    openSteamSync(): void {
        new SteamSyncModal(this.app, {
            onFetch: () => this.fetchSteamSyncCandidates(),
            onImport: (rows, onProgress) => this.importSteamRows(rows, onProgress),
        }).open();
    }

    /**
     * 库里已有的 Steam 条目（按 `sourceUrl` 里的 appid 认）。
     * 🔴 判重键 = `steam:{appid}`（与 `steamItemKey` 同源），⛔ **不用标题** ——
     *    用户把「Portal 2」改成「传送门 2」后按标题就会重复导入一条。
     */
    async steamKnownKeys(): Promise<Set<string>> {
        const out = new Set<string>();
        for (const e of await this.service.list()) {
            const appid = steamAppIdFromUrl(e.sourceUrl);
            if (appid) out.add(steamItemKey(appid));
        }
        return out;
    }

    /**
     * 读库 + 愿望单，并成待选表（弹窗打开时调一次）。
     *
     * 🔴 三态如实报（`syncFetchHeadline`）：**只一个接口不通时照常列好的那半**，
     *    ⛔ 别因为愿望单没公开就把整轮判失败（那样用户会以为是凭据坏了）。
     * 🔴 两个都拉不到才 `ok:false` —— 且文案要说清缺的是什么。
     */
    async fetchSteamSyncCandidates(): Promise<
        | { ok: true; snapshot: { rows: SteamSyncRow[]; headline: string; note: string | null } }
        | { ok: false; message: string }
    > {
        const issue = this.steamCredsIssue();
        if (issue) return { ok: false, message: issue };
        const key = String(this.settings.steamApiKey);
        const id = String(this.settings.steamId);
        const owned = await fetchOwnedGames(this.steamGet, key, id);
        const wishlist = await fetchWishlist(this.steamGet, id);
        if (owned.kind === 'error' && wishlist.kind === 'error') {
            return { ok: false, message: `同步失败：${owned.message}` };
        }
        // 愿望单只有 appid ⇒ 名字靠商店 `appdetails` 另拉（失败就留占位名，⛔ 不静默丢这条）
        const names = new Map<number, string>();
        if (wishlist.kind === 'ok') {
            let unnamed = 0;
            for (const it of wishlist.items) {
                try {
                    const d = await this.fetchSteamDetailForEntry(it.appid);
                    const nm = d && typeof d.title === 'string' ? d.title.trim() : '';
                    if (nm) names.set(it.appid, nm);
                    else unnamed++;
                } catch {
                    unnamed++;
                }
            }
            if (unnamed > 0) {
                // 留在 note 里让用户知道「有几条只有 appid」——不让它变成一条看不见的怪条目
                const candidates = mergeSyncCandidates(
                    owned.kind === 'ok' ? owned.items : [],
                    wishlist.items,
                    names,
                );
                const known = await this.steamKnownKeys();
                const existing1 = await this.service.list();
                const titleIndex1 = indexByTitleKey(existing1.filter((e) => e.type === 'game'));
                const rows: SteamSyncRow[] = candidates.map((c) => ({
                    ...c,
                    imported:
                        known.has(steamItemKey(c.appid)) || findTitleConflict(titleIndex1, 'game', c.name) !== null,
                }));
                return {
                    ok: true,
                    snapshot: {
                        rows,
                        headline: syncFetchHeadline({ owned, wishlist, total: rows.length }),
                        note: `${unnamed} 条愿望单条目没取到名字（商店接口没回），会用「Steam App <appid>」占位，导入后可自行改名。`,
                    },
                };
            }
        }
        const candidates = mergeSyncCandidates(
            owned.kind === 'ok' ? owned.items : [],
            wishlist.kind === 'ok' ? wishlist.items : [],
            names,
        );
        const known = await this.steamKnownKeys();
        // 🔴🔴 2026-10-25 用户裁定：「同步窗口的勾选是覆盖操作啊不是跳过」。
        //    判「库里已有」不能只看 appid —— 旧版 `syncSteamNow` 建条目时**根本没写 `sourceUrl`**
        //    （只有 `{type,title,status}`），那些条目 appid 认不出来，会显示成「新条目」默认勾上，
        //    然后落库时撞 `findTitleConflict` 被当同名**跳过** —— 用户勾了却被跳过，正是这个。
        //    ⇒ 显示层也要按「名称」认一遍 `imported`（落库层再按 `imported` 决定覆盖还是保护）。
        const existing = await this.service.list();
        const titleIndex = indexByTitleKey(existing.filter((e) => e.type === 'game'));
        const rows: SteamSyncRow[] = candidates.map((c) => ({
            ...c,
            imported: known.has(steamItemKey(c.appid)) || findTitleConflict(titleIndex, 'game', c.name) !== null,
        }));
        return {
            ok: true,
            snapshot: { rows, headline: syncFetchHeadline({ owned, wishlist, total: rows.length }), note: null },
        };
    }

    /**
     * 把弹窗里勾选的 Steam 条目落库。
     *
     * 🔴 用户报障「拉取到的steam游戏连封面和任何信息都没有，只拉了个标题」的两层修法：
     *    ⑴ **封面**落商店竖版 `library_600x900.jpg`（`steamCoverUrl`）—— 原来根本没写 `poster`，
     *       愿望单那半更只有标题；
     *    ⑵ **元数据**（平台 / 开发商 / 发行年 / 题材 / 简介）走免 key 的 `appdetails` 补，
     *       失败**不阻断**（清单级字段照常落地，与 TMDB 同款降级口径）。
     *
     * 🔴 覆盖口径（与 TMDB / 豆瓣一致）：勾上库里已有的 = 只换 **Steam 来源字段**，
     *    ⛔ 不动用户的评语 / 进度 / 摘抄 / 标签 / 个人评分。
     * 🔴 同名文件保护：新建前查 `findTitleConflict` —— 笔记路径按标题派生，同名会把别人的笔记覆盖掉。
     */
    async importSteamRows(
        rows: SteamSyncRow[],
        onProgress?: (done: number, total: number, label: string) => void,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number }> {
        const existing = await this.service.list();
        const byTitle = indexByTitleKey(existing);
        const byKey = new Map<string, MediaEntry>();
        for (const e of existing) {
            const appid = steamAppIdFromUrl(e.sourceUrl);
            if (appid) byKey.set(steamItemKey(appid), e);
        }
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let overridden = 0;
        let sameName = 0;
        let done = 0;
        for (const r of rows) {
            done++;
            const key = steamItemKey(r.appid);
            let prev = byKey.get(key);
            // 🔴🔴 2026-10-25 用户裁定：「同步窗口的勾选是覆盖操作啊不是跳过」。
            //    旧版这里遇同名一律 `skip` —— 但那一行在弹窗里被标成「库里已有」、用户**勾了**，
            //    意图就是覆盖，结果却被跳过（用户报的正是这个）。
            //    根因还有一层：旧 `syncSteamNow` 建条目时**没写 `sourceUrl`**，appid 认不出来，
            //    只能靠归一标题认 ⇒ 这里对 `r.imported` 的行补一次标题匹配。
            // ⚠️ 只在 `r.imported` 为真时按标题认：否则「同名但是另一款游戏」会被误覆盖。
            if (!prev && r.imported) {
                const byTitleHit = findTitleConflict(byTitle, 'game', r.name);
                if (byTitleHit) prev = byTitleHit as MediaEntry;
            }
            if (!prev && findTitleConflict(byTitle, 'game', r.name)) {
                // 真·同名不同作品（且弹窗没把它标成「库里已有」）⇒ 仍保护笔记文件，不覆盖
                sameName++;
                skipped++;
                onProgress?.(done, rows.length, `跳过（库内同名） ${r.name}`);
                continue;
            }
            onProgress?.(done, rows.length, `${prev ? '覆盖' : '导入'} ${r.name}`);
            const input: Partial<MediaEntry> = {
                type: 'game',
                title: r.name,
                // 🔴 库里已拥有 = 「在看」（正在玩），愿望单 = 「想看」——原来全塞成想玩是错的
                status: r.source === 'owned' ? 'watching' : 'want',
                poster: steamCoverUrl(r.appid),
                sourceUrl: `https://store.steampowered.com/app/${r.appid}`,
                source: 'steam',
            };
            if (r.source === 'owned') {
                input.playtimeMinutes = Math.round(minutesToHours(r.playtimeForever) * 60);
            }
            // 详情失败**不阻断**：清单级字段（标题 / 封面 / 来源 / 时长）照常落地
            // 🔴 字段映射走 `pure/steamSync` 的 `steamDetailFields`（唯一真源）——
            //    2026-10-25 用户报障「有些同步导入的 steam 条目没有大众评分和评价人数」，
            //    根因就是本函数与 `syncSteamNow` 各写一份映射、后者漏了。⛔ 别在这里再手写一遍。
            try {
                const d = await this.steam.fetchDetail(r.appid);
                const f = steamDetailFields(d);
                if (f.platform) input.platform = f.platform;
                if (f.developer) input.developer = f.developer;
                if (f.year) input.year = f.year;
                if (f.genres) input.genres = f.genres;
                if (f.summary) input.summary = f.summary;
                // ⚠️ 覆盖已有条目时也写：这是 Steam 来源字段（媒体的客观数据），
                //    与「用户个人评分 rating / notes / tags」不是一回事，后者在覆盖 patch 里被显式排除。
                if (f.rating != null) input.communityScore = f.rating;
                if (f.ratingCount != null) input.ratingCount = f.ratingCount;
                // 🔴 2026-10-25 Steam 好评率百分比：与 `ratingCount` 同源（histogram），
                //    写入后列表/表单/笔记都显示 `97%` —— 用户报障「有评价人数没评分」的直接修法。
                //    ⚠️ 覆盖已有条目时也写：这是 Steam 的客观数据，与用户个人评分(`rating`) 不是一回事。
                if (f.reviewPercent != null) input.reviewPercent = f.reviewPercent;
                // 🔴 2026-11-08 收敛盖章（与 `syncSteamNow` `detailOf` 同一条口径）。
                //    详情已拉过就记一笔，别让下一轮同步再为同一条花一次请求。
                input.steamDetailFilledAt = new Date().toISOString();
            } catch {
                /* 静默降级：没有详情也比「只有标题」强 */
            }
            try {
                if (prev) {
                    // 🔴 覆盖：只换 Steam 来源字段（⛔ 不动 notes/tags/进度/评分 —— 那是用户的记录）
                    const patch: Partial<MediaEntry> = { ...input };
                    delete (patch as Record<string, unknown>).notes;
                    delete (patch as Record<string, unknown>).tags;
                    await this.service.update(prev.id, patch);
                    await this.service.writeNote(prev.id);
                    overridden++;
                } else {
                    const created = await this.service.create({
                        rating: 0,
                        cast: [],
                        links: [],
                        notes: '',
                        tags: [],
                        ...input,
                    });
                    try {
                        await this.service.writeNote(created.id);
                    } catch {
                        /* 笔记失败不阻断（与另外几个同步弹窗同口径） */
                    }
                    byTitle.set(r.name, { id: created.id, type: 'game', title: r.name } as MediaEntry);
                    added++;
                }
                if (prev) byKey.set(key, prev);
            } catch {
                failed++;
            }
        }
        this.settings.steamLastSyncAt = Date.now();
        await this.saveData(this.settings);
        await this.refreshViews();
        return { added, skipped, failed, overridden, sameName };
    }

    /**
     * 🔴 2026-11-09 第 15 轮阶段 B：**在线曲库歌曲 → `music` 条目**（结果卡片「入库」按钮走这里）。
     *
     * 由来：用户「给三大音乐平台加搜索元数据的功能」，成本规划
     * `docs/full-cycle/ReelLudic/19-三大音乐平台元数据与清单同步成本规划.md` 阶段 B
     * 「搜索结果 → 直接建成 `music` 条目」，落点由用户 2026-11-09 当面裁定为
     * **「结果卡片并列一颗「入库」按钮」**（不是另开同步弹窗，也不是只回填表单）。
     *
     * 口径（与 `importSteamRows` 同构，但有三处刻意不同）：
     *  ⑴ **判重键 = `music:{source}:{id}`**（`pure/musicSync.musicItemKey`）—— 按来源 id，
     *     ⛔ 不按标题：用户把「晴天」改成「晴天 (Live)」后按标题判重会重复导入一条。
     *  ⑵ **不拉详情、不盖章**：四平台的歌曲元数据在搜索结果里就齐了（歌名 / 歌手 / 专辑 / 封面），
     *     没有「详情接口」可补；所以⛔ 不写 `steamDetailFilledAt` 那类时间戳，也⛔ 不设同步时间。
     *  ⑶ **不写 `status`**：新落库的歌保持默认状态，由用户自己走「想听 / 在听 / 已听」。
     *     （Steam 那边 `owned ⇒ watching / wishlist ⇒ want` 是因为清单本身表达了意图，这里没有。）
     *
     * 🔴 覆盖口径：勾中库里已有的 = 只换**平台客观字段**（歌名 / 歌手 / 专辑 / 封面 / 来源 / 来源页），
     *    ⛔ 不动用户的 `notes` / `tags` / `rating` / `audioPath` / `listenMinutes`。
     * 🔴 同名文件保护：新建前查 `findTitleConflict` —— 笔记路径按标题派生，同名会把别人的笔记覆盖掉。
     */
    async importMusicSongs(
        songs: readonly DownloadSong[],
        onProgress?: (done: number, total: number, label: string) => void,
        playlistName?: string,
    ): Promise<{ added: number; skipped: number; failed: number; overridden: number; sameName: number }> {
        const existing = await this.service.list();
        const byTitle = indexByTitleKey(existing);
        const byId = new Map<string, MediaEntry>();
        for (const e of existing) byId.set(e.id, e);
        // 「库里已有」的判据全在 `pure/musicSync`（从条目反解 `music:{source}:{id}`），别在这里另写一。
        const byKey = indexMusicEntries(existing);
        // 🔴 阶段 C：歌单名 标签（唯一净化入口在 `pure/musicPlaylist.playlistTag`。
        const tag = playlistTag(playlistName ?? '');
        let added = 0;
        let skipped = 0;
        let failed = 0;
        let overridden = 0;
        let sameName = 0;
        let done = 0;
        for (const s of songs ?? []) {
            done++;
            // 字段映射`pure/musicSync.musicEntrySeed`（唯一真源）—本仓踩过「两个入口各写一份映射」
            // Steam 那次就漏了评分与评价人数026-10-25 用户报障）。⛔ 别在这里再手写一遍。
            const seed = musicEntrySeed(s);
            if (!seed) {
                skipped++;
                onProgress?.(done, songs.length, '跳过（平台 / 歌名无效）');
                continue;
            }
            const key = musicItemKey(seed.source, s?.id);
            // 「库里已有」两条来源：同平台同 id（`indexMusicEntries`）；豆瓣来的同名老条目（`adoptableMusicEntryId`。
            const keyedId = key ? byKey.get(key) : undefined;
            const adoptId = keyedId ? '' : adoptableMusicEntryId(existing, seed.title, seed.author);
            const prevId = keyedId ?? adoptId;
            const prev = prevId ? byId.get(prevId) : undefined;
            if (!prev && findTitleConflict(byTitle, 'music', seed.title)) {
                // 真·同名不同曲（且库里那条不是同一来源 id）⇒ 仍保护笔记文件，不覆盖
                sameName++;
                skipped++;
                onProgress?.(done, songs.length, `跳过（库内同名） ${seed.title}`);
                continue;
            }
            onProgress?.(done, songs.length, `${prev ? '覆盖' : '入库'} ${seed.title}`);
            try {
                if (prev) {
                    // 覆盖口径住在 `musicPatchFor`（批量与单条共用，⛔ 别在这里再写一份）
                    await this.service.update(prev.id, this.musicPatchFor(seed, tag, prev, !!adoptId));
                    await this.service.writeNote(prev.id);
                    overridden++;
                } else {
                    const created = await this.service.create({
                        rating: 0,
                        cast: [],
                        links: [],
                        notes: '',
                        // 🔴 阶段 C：歌单名写进标签（用户 2026-11-09 裁定「只落单曲，歌单名写进标签」）。
                        //    `playlistTag` 做最小净化（折叠空白 / 截 24 字 / ⛔ 不加前缀，加了就筛不出来）。
                        tags: tag ? [tag] : [],
                        ...seed,
                    });
                    try {
                        await this.service.writeNote(created.id);
                    } catch {
                        /* 笔记失败不阻断（与另外几个同步弹窗同口径） */
                    }
                    byTitle.set(seed.title, { id: created.id, type: 'music', title: seed.title } as MediaEntry);
                    // 同一批里再点一次同一首歌时能认出「刚建的那条」，不会建出第二。
                    if (key) byKey.set(key, created.id);
                    byId.set(created.id, created);
                    added++;
                }
            } catch {
                failed++;
            }
        }
        await this.refreshViews();
        return { added, skipped, failed, overridden, sameName };
    }

    /**
     * 单条落库的**覆盖补丁**（批量与单条共用，⛔ 别各写一份 —— 本仓 Steam 那次的病根就是两个入口各写一套）。
     *
     * 两条覆盖口径必须分开：
     *  ① `adopted = false`（同平台同 id 命中）—— 确实是同一来源的同一首歌，可以整体刷新平台字段；
     *  ② `adopted = true`（「认领」来的豆瓣同名老条目）—— 只是**判定为同一首**，
     *     它上面的标题 / 歌手 / 专辑 / 评分全是用户从豆瓣那套里挑的，
     *     ⛔ 不能拿平台侧标题（常带「【MV】」「1080P」）去覆盖 ⇒ 只补 `MUSIC_ADOPT_FIELDS`。
     *
     * 两种口径共同点：用户记录（`notes` / `tags` / `rating` / `audioPath` / `listenMinutes`）一律不碰。
     *
     * @param seed    平台侧映射（`pure/musicSync.musicEntrySeed` 的产物）
     * @param tag     本次歌单名归一后的标签（空串 = 不写）
     * @param prev    库里那条（取 `tags` 用）
     * @param adopted 是否走「认领」口径
     */
    private musicPatchFor(
        seed: MusicEntrySeed,
        tag: string,
        prev: Pick<MediaEntry, 'tags'>,
        adopted: boolean,
    ): Partial<MediaEntry> {
        let patch: Partial<MediaEntry>;
        if (adopted) {
            patch = {};
            // ⚠️ 先把 `seed` 转成 `unknown` 再转索引签名：`MusicEntrySeed` 没有 string 索引签名。
            //    直接 `as Record<string, unknown>` 会被 tsc 判成「两边都不重叠」（TS2352）。
            const src = seed as unknown as Record<string, unknown>;
            for (const f of MUSIC_ADOPT_FIELDS) {
                const v = src[f];
                if (v !== undefined) (patch as Record<string, unknown>)[f] = v;
            }
        } else {
            patch = { ...seed };
        }
        // 用户的记录一律不碰（`seed` 本来就不含这些键，这里是显式表态，防将来有人往 seed 里加。
        delete (patch as Record<string, unknown>).notes;
        delete (patch as Record<string, unknown>).tags;
        delete (patch as Record<string, unknown>).rating;
        delete (patch as Record<string, unknown>).audioPath;
        delete (patch as Record<string, unknown>).listenMinutes;
        // 🔴 阶段 C：歌单名**只增不减** —用户自己打的标签一律保留，只补上这次来自哪个歌单。
        //    不整份覆`tags`：那会把用户手打的标签冲掉。
        if (tag && !(prev.tags ?? []).includes(tag)) patch.tags = [...(prev.tags ?? []), tag];
        return patch;
    }

    /**
     * 🔴 2026-11-09 第 15 轮阶段 B：**结果卡片「入库」单条入口**（`EntryForm.onSaveMusic` 的实现）。
     *
     * 为什么卡片给的是 `SearchResult` 而不是 `DownloadSong`：
     *   卡片是 `pure/songLibrary.songLibraryResults` 的产物，原始 `DownloadSong` 早被压掉了；
     *   平台与平台内 id 只剩在 `id`（`songlib:{平台}:{id}`）里。
     *   ⇒ 用 `musicSeedFromResult` 反解，再走与批量落库**同一条**落库流程
     *   （⛔ 别为了单条另写一套落库 —— 那正是 Steam 踩过的「两个入口各写一份映射」）。
     *
     * 返回值：`null` = 成功；字符串 = 给用户看的原因（卡片上弹 Notice）。
     */
    async importMusicResult(r: SearchResult): Promise<string | null> {
        const seed = musicSeedFromResult(r);
        if (!seed) return '这条结果缺少平台信息，无法直接入库';
        return this.writeMusicSeed(seed, r);
    }

    /**
     * 单条 seed → 落库（与 `importMusicSongs` 共用判重与覆盖口径）。
     *
     * ⚠️ 与批量版的差别只在「一条 vs 一批」；判重键、同名保护、覆盖时不动用户字段
     *    这三条口径**必须一致** —— 所以这里复用 `indexMusicEntries` 与 `findTitleConflict`。
     */
    private async writeMusicSeed(seed: MusicEntrySeed, r: SearchResult): Promise<string | null> {
        const existing = await this.service.list();
        const byTitle = indexByTitleKey(existing);
        const byKey = indexMusicEntries(existing);
        // ⚠️ 判重键要*平台id**：`seed` 本身没有 id 字段，从卡片`songlib:…` 反解一。
        const key = musicItemKey(seed.source, musicIdFromResult(r));
        // 与批量同口径：① 同平台同 id；② 豆瓣来的同名老条目（`adoptableMusicEntryId`）。
        // 缺了 就会「豆瓣库里已有的歌从曲库点入库一律被当成同名冲突」—阶段 C 真机核对发现的断点。
        const keyedId = key ? byKey.get(key) : undefined;
        const adoptId = keyedId ? '' : adoptableMusicEntryId(existing, seed.title, seed.author);
        const prevId = keyedId ?? adoptId;
        const prev = prevId ? existing.find((e) => e.id === prevId) : undefined;
        if (!prev && findTitleConflict(byTitle, 'music', seed.title)) {
            return `库里已有同名条目（${seed.title}），已跳过以免覆盖笔记`;
        }
        try {
            if (prev) {
                // 单条入口没有歌单上下`tag` 传空串（别为了对齐签名硬编一个标签）
                await this.service.update(prev.id, this.musicPatchFor(seed, '', prev, !!adoptId));
                await this.service.writeNote(prev.id);
            } else {
                const created = await this.service.create({
                    rating: 0,
                    cast: [],
                    links: [],
                    notes: '',
                    tags: [],
                    ...seed,
                });
                try {
                    await this.service.writeNote(created.id);
                } catch {
                    /* 笔记失败不阻断（与其它落库入口同口径） */
                }
            }
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
        await this.refreshViews();
        return null;
    }

    /**
     * 🔴 #639 ⑥ **同步 Steam**（库 + 愿望单 + 游玩时长）—— 用户点「同步 Steam」按钮走这里。
     *
     * 口径（用户三项裁定）：
     *   · **库**：与已有条目按标题配对 ⇒ 配对上的**更新游玩时长**、没配对的**新增条目**（状态「想玩」）；
     *   · **愿望单**：新增为「想玩」条目（Steam 愿望单只给 appid ⇒ 名字靠商店 `appdetails` 另拉）；
     *   · **游玩时长**：**直接用 Steam 总时长覆盖**（`playtime_forever` 本来就是累计值，
     *     ⛔ 不做「增量累加」—— 那会翻倍）。
     */
    async syncSteamNow(): Promise<{ ok: boolean; message: string }> {
        const issue = this.steamCredsIssue();
        if (issue) return { ok: false, message: issue };
        const key = String(this.settings.steamApiKey);
        const id = String(this.settings.steamId);
        const owned = await fetchOwnedGames(this.steamGet, key, id);
        const wishlist = await fetchWishlist(this.steamGet, id);
        // 两个接口**都**拉不到 ⇒ 才是真失败（只一个不通时把好的那半照常落地）
        if (owned.kind === 'error' && wishlist.kind === 'error') {
            return { ok: false, message: `同步失败：${owned.message}` };
        }
        const entries = await this.service.list();
        let added = 0;
        let updated = 0;
        // 🔴🔴 2026-10-25 用户报障「为什么有些同步导入的 steam 条目没有大众评分和评价人数」。
        //    根因：本方法（启动静默同步 / 同步按钮）建条目时**只写标题与时长**，
        //    完全没走 `importSteamRows` 那套「封面 + appdetails 详情」——
        //    于是「弹窗勾选导入的」有评分，「静默同步进来的」永远空白。
        //    修法：① 新建走 `steamEntrySeed`（与弹窗同源：竖版封面 / sourceUrl / 正确状态）；
        //          ② 补详情走 `steamDetailFields`（同一映射真源）；
        //          ③ 已配对但缺字段的老条目也顺手补一次（否则用户库里已有的空条目永远补不上）。
        //    ⚠️ 有上限 `STEAM_DETAIL_FILL_LIMIT`：这是开机路径，不能把整个库逐条拉一遍。
        let detailBudget = STEAM_DETAIL_FILL_LIMIT;
        /**
         * 拉一次详情，返回「条目字段 + 商店里的真实标题」（一次请求两用，⛔ 别为了拿名字再拉一遍）。
         * 预算耗尽后只返回空对象 + undefined 名字 —— 剩下的条目本轮跳过，下轮启动继续。
         */
        const detailOf = async (
            appid: number,
        ): Promise<{ fields: Partial<MediaEntry>; name: string }> => {
            if (detailBudget <= 0) return { fields: {}, name: '' };
            detailBudget--;
            try {
                const raw = await this.fetchSteamDetailForEntry(appid);
                const f = steamDetailFields(raw);
                const out: Partial<MediaEntry> = {};
                if (f.platform) out.platform = f.platform;
                if (f.developer) out.developer = f.developer;
                if (f.year) out.year = f.year;
                if (f.genres) out.genres = f.genres;
                if (f.summary) out.summary = f.summary;
                if (f.rating != null) out.communityScore = f.rating;
                if (f.ratingCount != null) out.ratingCount = f.ratingCount;
                // 🔴 2026-10-25：Steam 好评率百分比（与上面 `ratingCount` 同源）——
                //    静默同步/同步按钮这条路径也要落，否则「弹窗勾选导入的有 %、静默同步的没有」，
                //    正是用户反复报的同一种病（两条路径各写一半）。
                if (f.reviewPercent != null) out.reviewPercent = f.reviewPercent;
                // 🔴 2026-11-08 收敛盖章*只要真的发出了这次请*就写标记（不管拿到几个字段）。
                //    判据 `steamEntryNeedsDetail` 靠它收敛 —否则「该游戏零评Metacritic」这。
                //    永远补不上评分的条目会每次开机重拉一遍（上一版注释里写死的教训）。
                //    ⚠️ 放在 `fetchSteamDetailForEntry` 成功之后（catch 分支不盖章：网络失败下轮该重试）。
                out.steamDetailFilledAt = new Date().toISOString();
                const nm = raw && typeof raw.title === 'string' ? raw.title.trim() : '';
                return { fields: out, name: nm };
            } catch {
                return { fields: {}, name: '' };
            }
        };
        /** 只要字段（新建库条目用；名字来自 Steam 库本身，不用详情里的） */
        const detailFieldsOf = async (appid: number): Promise<Partial<MediaEntry>> =>
            (await detailOf(appid)).fields;
        if (owned.kind === 'ok') {
            const byId = new Map(entries.map((e) => [e.id, e]));
            const matched = matchOwnedToEntries(owned.items, entries);
            for (const g of owned.items) {
                const hours = minutesToHours(g.playtimeForever);
                const entryId = matched.get(g.appid);
                if (entryId) {
                    const cur = byId.get(entryId);
                    // 🔴 只在**时长真变了**时写（否则每次同步都重写一遍笔记，白刷 updated 时间戳）
                    const patch: Partial<MediaEntry> = {};
                    if (cur && (cur.playtimeMinutes ?? 0) !== Math.round(hours * 60)) {
                        patch.playtimeMinutes = Math.round(hours * 60);
                    }
                    // 🔴 老条目补详情（用户报障的直接来源就是这些「早期只写了标题」的条目）
                    //    判据`steamEntryNeedsDetail`：缺封面 *** 没盖过详情标记；补过一次就收敛。
                    //    ⚠️ 2026-11-08 前这里只`poster`，导致「有封面但缺评分」的老条目永不补 —已修。
                    const missing = !cur || steamEntryNeedsDetail({
                        poster: cur.poster,
                        steamDetailFilledAt: cur.steamDetailFilledAt,
                    });
                    if (missing) {
                        // ⚠️ 封面也补：早期条目 `poster` 为空，海报墙里就是一块空白
                        if (!cur?.poster) {
                            patch.poster = steamCoverUrl(g.appid);
                        }
                        // `sourceUrl` 缺失会让「判重键 steam:{appid}」认不出来，下一轮又当新条目导入
                        if (!cur?.sourceUrl) {
                            patch.sourceUrl = `https://store.steampowered.com/app/${g.appid}`;
                        }
                        if (!cur?.source) patch.source = 'steam';
                        Object.assign(patch, await detailFieldsOf(g.appid));
                    }
                    if (Object.keys(patch).length > 0) {
                        try {
                            await this.service.update(entryId, patch);
                            // 写了就算是「更新了一条」：patch 只会在**确有变化或缺字段**时非空
                            // （旧版无条件 `updated++` 会让「每次同步都报更新 N 条」变成噪音）
                            updated++;
                        } catch {
                            /* 单条失败不打断整轮（与书架同步同口径） */
                        }
                    }
                } else {
                    try {
                        // 🔴 与弹窗导入同源：`steamEntrySeed` 给出竖版封面 / sourceUrl / 正确状态（库=看玩中）
                        const seed = steamEntrySeed({
                            appid: g.appid,
                            name: g.name,
                            source: 'owned',
                            playtimeForever: g.playtimeForever,
                        });
                        await this.service.create({
                            ...seed,
                            ...(await detailFieldsOf(g.appid)),
                        } as Partial<MediaEntry>);
                        added++;
                    } catch {
                        /* 同上 */
                    }
                }
            }
        }
        if (wishlist.kind === 'ok') {
            const have = new Set(entries.map((e) => steamTitleKey(e.title)));
            for (const it of wishlist.items) {
                // 愿望单只有 appid ⇒ 名字靠商店详情补（失败就用 appid 当占位名，⛔ 不静默丢掉这一条）
                let title = `Steam App ${it.appid}`;
                const got = await detailOf(it.appid);
                const fields = got.fields;
                if (got.name) title = got.name;
                if (have.has(steamTitleKey(title))) continue; // 已在库里 ⇒ 不重复加
                try {
                    // 🔴 愿望单也走同源 seed：封面 / sourceUrl 一个都不能少（旧版只有标题）
                    const seed = steamEntrySeed({
                        appid: it.appid,
                        name: title,
                        source: 'wishlist',
                        playtimeForever: 0,
                    });
                    await this.service.create({ ...seed, ...fields } as Partial<MediaEntry>);
                    added++;
                    have.add(steamTitleKey(title));
                } catch {
                    /* 同上 */
                }
            }
        }
        this.settings.steamLastSyncAt = Date.now();
        await this.saveData(this.settings);
        await this.refreshViews();
        return { ok: true, message: syncSummary({ owned, wishlist, added, updated }) };
    }

    /**
     * 🔴 #639 ⑥ **启动时自动同步游玩时长**（用户：「插件启动时同步并增量游玩时长」）。
     *
     * 🔴 两道门（都不可省）：
     *   ⑴ 凭据齐 + **距上次 ≥ 6 小时**（`shouldAutoSync`）—— Steam Web API 有频率限制，
     *      天天开十几次库会撞限流，而时长本就是「天级」数据；
     *   ⑵ **静默**：失败不弹窗（开机时弹一堆红字很烦），结论只在控制台留一行。
     */
    private async autoSyncSteamQuietly(): Promise<void> {
        if (Platform.isMobileApp) return; // 移动端跳过（与开机凭据自检同口径）
        const ok = shouldAutoSync({
            hasKey: !steamKeyIssue(this.settings.steamApiKey),
            hasId: !steamIdIssue(this.settings.steamId),
            lastSyncAt: this.settings.steamLastSyncAt,
            now: Date.now(),
        });
        if (!ok) return;
        try {
            const r = await this.syncSteamNow();
            if (!r.ok) console.warn('[ReelLudic] Steam 自动同步未完成：' + r.message);
        } catch (e) {
            // ⛔ 开机路径绝不抛（一个可选集成不该拖住插件加载）
            console.warn('[ReelLudic] Steam 自动同步异常：' + (e instanceof Error ? e.message : String(e)));
        }
    }

    /**
     * #589：按 id 跑一条**元数据源**连接测试 —— `ProviderId → testXxxConnection` 的**唯一**分派。
     * 🔴 它在**宿主**这一侧（`Settings.testConnectionFor` 已改为转调这里）：开机自检够得着设置页的按钮逻辑，
     *    ⛔ 别在两处各写一份 switch（加一个源时必然漏一处 = 那条永远「无可用测试」）。
     */
    async checkSourceCredential(id: ProviderId): Promise<SourceTestResult> {
        switch (id) {
            case 'douban': return this.testDoubanConnection();
            case 'tmdb': return this.testTmdbConnection();
            case 'bangumi': return this.testBangumiConnection();
            case 'omdb': return this.testOmdbConnection();
            case 'googleBooks': return this.testGoogleBooksConnection();
            case 'igdb': return this.testIgdbConnection();
            case 'weread': return this.testWereadConnection();
            // 🔴 #639 ⑥：Steam 的测试连接走 **Web API 的库接口**（唯一强制要 Key 的那个 ⇒ 验得出凭据好坏）
            case 'steam': return this.testSteamConnection();
            default: return { ok: false, message: '该源无可用测试', elapsedMs: 0 };
        }
    }

    /** #589：读一条凭据的自检结果（`undefined` = **还没测过** ⇒ 设置页**不标**「连接失败」）。 */
    credentialStatusOf(key: string): boolean | undefined {
        return statusOf(this.settings.credentialStatus ?? {}, key);
    }

    /**
     * #589：记下结果 —— 开机自检与设置页手动「测试连接」**都走这一个口**（结论必须同源）。
     * 🔴🔴 用户裁定（1.4.x）：结论要**持久化**（重启后仍显示「连接失败」，直到用户下次测过）。
     * ⚠️ 落盘走 `persistCredentialStatus`（只 `saveData` 不 rebuild）—— 这里是「测完一颗按钮」的热路径，
     *    ⛔ 绝不能调 `saveSettings()`：那会 rebuildService/rebuildClients + refreshViews，点一下测试就重建全库。
     */
    setCredentialStatus(key: string, ok: boolean): void {
        this.settings.credentialStatus = withStatus(this.settings.credentialStatus ?? {}, key, ok);
        // 1：同一口写「检测时刻」—面板的「上次检测」列读它。
        // 🔴 两张表必须同写：只写结论会让面板出现「有结论但没时间」，用户没法判断该不该重测。
        // ⚠️ 开机自检与手动测试都经此口，所以两条路径的时间语义天然一致（别在按钮里另记时间）。
        this.settings.credentialCheckedAt = {
            ...(this.settings.credentialCheckedAt ?? {}),
            [key]: Date.now(),
        };
        void this.persistCredentialStatus();
    }

    /**
     * #589：清掉某条结果（用户**改了凭据** ⇒ 旧结论立刻作废，⛔ 别让「已失效」挂在一个刚填的新值上）。
     * 同样只落盘、不 rebuild（理由见上）。**没有这条结论时什么都不做**（⛔ 别为此白写一次 data.json）。
     */
    clearCredentialStatus(key: string): void {
        const cur = this.settings.credentialStatus ?? {};
        const hasAt = Object.prototype.hasOwnProperty.call(this.settings.credentialCheckedAt ?? {}, key);
        if (!Object.prototype.hasOwnProperty.call(cur, key)) {
            // 结论不在、时间却在（历史脏数/ 只清了一半）顺手把时间也清掉，⛔ 别留着孤零零一个时。
            if (hasAt) {
                const at = { ...(this.settings.credentialCheckedAt ?? {}) };
                delete at[key];
                this.settings.credentialCheckedAt = at;
                void this.persistCredentialStatus();
            }
            return;
        }
        this.settings.credentialStatus = withoutStatus(cur, key);
        // 1：结论作时间一并作废（否则面板会显示「未检· 上次检10-01」自相矛盾）
        if (hasAt) {
            const at = { ...(this.settings.credentialCheckedAt ?? {}) };
            delete at[key];
            this.settings.credentialCheckedAt = at;
        }
        void this.persistCredentialStatus();
    }

    /**
     * ③-1：「统一周期管理」面板要的原始数据 —— **面板不自己攒状态**，一律从这里现取。
     * 返回的就是 `pure/credentialMeta.buildCredentialMeta` 的入参形态。
     */
    credentialMetaInput(): { settings: unknown; status: CredentialStatusMap; checkedAt: Record<string, number> } {
        return {
            settings: this.settings,
            status: this.settings.credentialStatus ?? {},
            checkedAt: this.settings.credentialCheckedAt ?? {},
        };
    }

    /**
     * 把「凭据测试结论」写进 data.json —— **只落这一件事**。
     * ⛔ 别改用 `saveSettings()`：那条路会 rebuild 全套服务/客户端并刷新视图（见 `setCredentialStatus` 注释）。
     * ⚠️ 失败只记日志：结论存不下来是「下次重启徽标回弹」，⛔ 不该把测试按钮本身搞崩。
     */
    private async persistCredentialStatus(): Promise<void> {
        try {
            await this.saveData(this.settings);
        } catch (e) {
            console.warn('[ReelLudic] 凭据测试结论落盘失败：' + (e instanceof Error ? e.message : String(e)));
        }
    }

    /**
     * 🔴 ③-1（2026-11-12 用户 m00353）：「统一周期管理」面板的**一键检测**入口。
     *
     * 按 `credentialCheckKey` 的族前缀分派到既有的三条测试路径 —— ⛔ 别为面板另写一套探测：
     *   族结论必须与徽标/开机自检**同源**（同一功能只有一个判据，本仓 #669 口径）。
     *   · `source:` → `checkSourceCredential`（元数据源唯一分派）
     *   · `music:`  → `dlTestConnection`（测的是「Cookie 能不能下载音频」）
     *   · `net:`    → B 站复用 `dlTestConnection('bilibili')`（判的是登录态，与取流同一个前置）；
     *                 YouTube 走 `ytTestConnection`（真跑 yt-dlp，见设置页那条注释）
     * ⚠️ 只**返回**结果，不写结论 —— 写盘统一由调用方走 `setCredentialStatus`（唯一写口）。
     */
    async testCredentialByKey(key: string): Promise<{ ok: boolean; message: string }> {
        const idx = key.indexOf(':');
        if (idx <= 0) return { ok: false, message: '未知凭据键' };
        const family = key.slice(0, idx);
        const id = key.slice(idx + 1);
        if (family === 'source') {
            const r = await this.checkSourceCredential(id as ProviderId);
            return { ok: r.ok, message: r.message };
        }
        if (family === 'music') {
            const cookies = (this.settings.musicDlCookies ?? {}) as Record<string, string | undefined>;
            return this.dlTestConnection(id, String(cookies[id] ?? ''));
        }
        if (family === 'net') {
            if (id === 'bilibili') return this.dlTestConnection('bilibili', String(this.settings.biliCookie ?? ''));
            if (id === 'youtube') return this.ytTestConnection();
            return { ok: false, message: "该源无可用测试" };
        }
        return { ok: false, message: "该源无可用测试" };
    }

    /**
     * #589：安排一轮开机凭据自检 —— 延迟 `CREDENTIAL_CHECK_DELAY_MS` 后跑。
     * 🔴 **只桌面端**：微信读书与音乐源那几条测试本身就写死「仅桌面端支持」⇒ 在移动端跑只会得到一排假失效。
     */
    private scheduleCredentialCheck(): void {
        if (!Platform.isDesktopApp) return;
        if (this.credentialTimer !== null) window.clearTimeout(this.credentialTimer);
        this.credentialTimer = window.setTimeout(() => {
            this.credentialTimer = null;
            void this.runCredentialChecks();
        }, CREDENTIAL_CHECK_DELAY_MS);
    }

    /**
     * #589：跑一轮自检 —— **串行**，每件之间间隔 `CREDENTIAL_CHECK_GAP_MS`。
     * 🔴 绝不并发：豆瓣那类源吃风控，一串请求同时打过去会**集体失败** ⇒ 好凭据被误标「已失效」。
     * 🔴 只测「已经填了」的凭据（`configuredCredentialChecks`）；单件失败**不打断**后面的。
     * ⚠️ 测试函数**抛错不属于「凭据失效」**（那是代码/环境问题）⇒ 抛错时**不记录**（宁可不标，也不误标）。
     */
    private async runCredentialChecks(): Promise<void> {
        if (this.credentialRunning) return;
        this.credentialRunning = true;
        const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
        try {
            const { sources, music } = configuredCredentialChecks(this.settings);
            for (const id of sources) {
                try {
                    const r = await this.checkSourceCredential(id as ProviderId);
                    // 🔴 走统一的写口（它不是纯内存 setter —— 会顺带落盘，见 `setCredentialStatus`）
                    this.setCredentialStatus(sourceCheckKey(id), r.ok);
                } catch {
                    /* 抛错 ≠ 凭据失效 ⇒ 不记录 */
                }
                await wait(CREDENTIAL_CHECK_GAP_MS);
            }
            const cookies = (this.settings.musicDlCookies ?? {}) as Record<string, string | undefined>;
            for (const id of music) {
                try {
                    const r = await this.dlTestConnection(id, String(cookies[id] ?? ''));
                    this.setCredentialStatus(musicCheckKey(id), r.ok);
                } catch {
                    /* 同上：抛错不记录 */
                }
                await wait(CREDENTIAL_CHECK_GAP_MS);
            }
        } finally {
            this.credentialRunning = false;
        }
    }

    async activateView(type: string): Promise<void> {        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        for (const l of workspace.getLeavesOfType(type)) {
            leaf = l;
            break;
        }
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type, active: true });
        }
        // `revealLeaf` 是 Workspace 上 @since 1.7.2 的 API（manifest.minAppVersion 已抬到 1.7.2）。
        // ⚠️ 仍加存在性守卫：本方法被大量入口调用（打开书架/追番/设置等），是老版本上
        //    唯一会**无条件崩溃**的点；缺这个 API 时退化为「已切 leaf 但不 reveal」，
        //    面板照样打开，只是不会自动滚到前台 —— 比直接抛 TypeError 好。
        if (typeof workspace.revealLeaf === 'function') void workspace.revealLeaf(leaf);
    }

    /** 打开统一视图并切到指定页签（shelf / tracking） */
    async activateHome(tab: HomeTab): Promise<void> {
        this.homeTab = tab;
        await this.activateView(HOME_VIEW_TYPE);
    }

    /**
     * 打开主视图并落在**用户设置的起始页**（唯一真源 = `settings.startTab`）。
     *
     * 🔴 2026-11-11 用户 m08970 ①：ribbon / 命令面板原来写死 `activateHome('media')`，
     *    入口一按就把起始页覆盖成 'media' —— 用户设的「电影」永远看不到。
     * ⚠️ 别改用 `activateHome(tab)` 再补一句 `syncStartTab()`：那样会「先闪一下 media 再跳走」；
     *    这里先归一好再一次性传下去，`homeTab` 从头到尾都是用户设的那个值。
     */
    async openHomeAtStartTab(): Promise<void> {
        await this.activateHome(normalizeStartTab(this.settings.startTab));
    }

    /**
     * 类型化主操作（阅读 / 观看 / 启动 / 播放）—— **四类统一入口**。
     *
     * 🔴 #444c：这段分流原来写在 `HomeView.ts` 的 `onWatch` 箭头函数里；系列选择弹窗改成
     *    应用级 `Modal` 之后，弹窗**不再长在插件视图里**（拿不到那个 prop），而它同样要执行「点某一部就播」。
     *    ⇒ 下沉到这个单一入口，`HomeView` 与 `SeriesPickerModal` 都调它，⛔ 别两处各写一套分流
     *    （两套必然漂移：从墙上点 vs 从弹窗点，行为不一样）。
     */
    runEntryAction(e: MediaEntry): void {
        if (e.type === 'book') void this.openBookFromWall(e);
        else if (e.type === 'game') void this.launchGame(e);
        else if (e.type === 'music') void this.playAudioEntry(e);
        else void this.openWatchLinkPicker(e);
    }

    /**
     * 🔴🔴 #676：海报墙 / 右键菜单 / 系列弹窗的「阅读」入口 —— **关闭后要把进度回写进 catalog**。
     *
     * 用户 2026-10-19 报障：「怎么没有阅读进度退出保存存储」。
     * 真因：`openBookReader()` 关闭时会**返回**最新阅读进度（`BookProgressFields`，percent 真源），
     * 但**只有编辑表单用了这个返回值**（`onOpenReader` 关完同步「当前进度页」）；海报墙这条路是
     * `void this.openBookReader(e)` —— 返回值**直接丢掉** ⇒ 阅读存档 JSON 存了，而 catalog 的
     * `readingProgress`（封面角标「已读 x%」、列表进度列都读它）**永远停在旧值**，
     * 用户看到的正是「没保存」。
     * ⇒ 这里补一次 catalog 回写，与表单那条路**同一口径**（走 `persistReadingPercent`，保留手填页数）。
     * ⚠️ 只在**拿到进度**时写；外部打开（无返回值）与打开失败（undefined/缺 percent）都不动数据。
     */
    private async openBookFromWall(entry: MediaEntry): Promise<void> {
        try {
            const pct = await this.openBookReader(entry);
            if (!pct || typeof pct.percent !== 'number') return;
            await this.persistReadingPercent(entry.id, pct.percent);
        } catch {
            // 阅读器异常不影响主流程；进度回写失败也不该弹错打扰用户
        }
    }

    /**
     * 🔴 #691（2026-10-27）：系列卡「播放」按钮 → 打开**选季页**，选中某一季后进 B 站风选集页。
     *
     * 用户裁定：「系列卡播放按钮后的改成 B 站风格页面的，不是内置播放器加个侧边栏，是新增一个页面」，
     * 并追加「两者都进新页」（系列卡播放按钮 + 海报墙/列表的「观看」按钮同一个落点）。
     *
     * 🔴 2026-11-06 用户改口径（原话「从系列卡点击播放按钮还是弹出选各季的页面再播放吧」）：
     *    ⛔ 不再自动挑「有进度的那一季 / 第一部」直接开播 —— 从系列卡进来时用户要挑季，
     *    替他选一季等于把选择权收走。现改为**先弹 `SeriesPickerModal`**，选完再走 `runEntryAction`。
     * ⚠️ 这个弹窗与「相关推荐 › 全部 N 部」用的是**同一个** `openSeriesListFor` 那套组件 ——
     *    ⛔ 不另造选择器，否则「系列 → 季」会出现两套口径。
     */
    openSeriesPicker(group: SeriesGroup): void {
        const items = group.items ?? [];
        if (items.length === 0) return;
        // 只有一部时弹窗没有意义（弹出来只有一张卡，还多一次点击）直接进那一。
        if (items.length === 1) {
            void this.openEpisodePageFor(items[0]);
            return;
        }
        new SeriesPickerModal(this.app, this, group).open();
    }

    /**
     * 新页里「相关推荐 › 全部 N 部」→ 打开既有的季列表弹窗（`SeriesPickerModal`）。
     *
     * 🔴 为什么还要留着这个弹窗：15 部的大系列不可能靠「相关推荐」那一行翻完 ——
     *    弹窗是一次看全 + 排序号的唯一入口（它还挂着 `SeriesReorderModal`）。
     *    ⇒ 新页只**新增**一条更快的直达路，⛔ 不把旧入口拆掉。
     */
    openSeriesListFor(entry: MediaEntry): void {
        void (async () => {
            const items = await this.service.list();
            const key = seriesKeyOf(entry);
            if (!key) return;
            const group: SeriesGroup = {
                key,
                type: entry.type,
                name: entry.series ?? entry.title,
                title: seriesTitleOf(entry.series ?? entry.title, entry.type),
                items: sortSeriesItems(items.filter((e) => seriesKeyOf(e) === key)),
            };
            if (group.items.length === 0) return;
            new SeriesPickerModal(this.app, this, group).open();
        })();
    }

    /**
     * 🔴 m07813②（用户逐字）：「给系列卡也做一个编辑属性窗口（同时右键菜单的改系列名、批量填合集、
     * 批量填标签收进编辑系列属性页面内。同单击单卡卡片网格信息栏逻辑一样，单击系列卡信息栏也打开
     * 编辑属性窗口）」
     *
     * 🔴 2026-11-15 第二次裁定（**推翻上一版**，用户逐字）：「还是将改系列名、排序号、批量填合集、
     * 批量填标签放进编辑系列属性页面窗口里较好，**删除右键菜单和其单独改的入口和页面**」
     *    ⇒ 这个窗口现在是那四件事的**唯一入口**；`openSeriesRenamePrompt` /
     *      `openGroupCollectionPrompt` / `openGroupTagsPrompt` 三个独立 Prompt 与
     *      `SeriesReorderModal`（拖拽弹窗）**已整体删除**。
     *    ⚠️ 第五轮 ask_user_question 裁定「右键菜单保留，只留这一条」——留下的是**批量关联**
     *      （逐条清单、不是批量写操作），仍走 `openSeriesAssociate`。
     *
     * 入口两个：单击系列卡信息栏 / 悬停 ⋯ 菜单（后者打开的就是那个只剩一条的右键菜单）。
     * ⚠️ 落库全在 `SeriesPropsModal` 里用既有批量原语做（`bulkSetSeriesIndex` / `bulkSetCollection` /
     *    `bulkAddTags` / `service.update` / `service.setSeriesRating`）。
     * ⛔ 别在这里预先算 `series` 键或碰 `catalog`：`SeriesPropsModal` 在 `mount()` 里读一次分就够了，
     *    多算一次反而会在「读分期间用户已关窗」时留下悬挂写入。
     */
    openSeriesProps(group: SeriesGroup): void {
        new SeriesPropsModal(this.app, this, group).open();
    }

    /**
     * 🔴 #629 系列「批量关联」弹窗（系列折叠卡右键 →「批量关联」）——
     * 一个弹窗内把这一系列列全，点某一行开**既有的**单条关联弹窗（`quickAssociateEntry`）。
     *
     * ⚠️ 弹窗**自己**在子弹窗关掉后重读 catalog（`plugin.service.list()`）来刷新清单 ——
     *    ⛔ 这里不传「查条目」的回调（那是把宿主的内务塞进弹窗的构造签名）；
     *    `onClosed` 钩子则由本方法注入（`quickAssociateEntry` 的第二参）。
     */
    openSeriesAssociate(group: SeriesGroup): void {
        // 🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」
        //    这条入口进来的电影不画那两枚批量填图标 —— 系列清单里电影只有一集，
        //    「从文件夹检索剧集 / 批量搜索未填集」在这里没有可填的对象，只是两枚噪声。
        //    ⛔ 只影响本入口；海报墙 / 列表右键那条（`HomeView` 的 `onQuickAssociate`）**照旧画**。
        new SeriesAssociateModal(this.app, this, group, (entry, onClosed) =>
            this.quickAssociateEntry(entry, onClosed, { hideMovieBatchFill: true })).open();
    }

    /** 当前打开的添加/编辑弹窗（防重复打开叠加：新开前先关闭旧的，避免遮罩堆叠导致新弹窗无法交互/无法输入搜索） */
    entryModal: EntryModal | null = null;

    /**
     * 打开「添加条目」弹窗。
     *
     * 🔴 用户 2026-11-27（m04135）：「在首页视图搜索框中搜索填入的文本如果这时点添加按钮
     *    就直接填入搜索条目一步到位，省去打开添加条目窗口再搜索」。
     *    ⇒ 首页搜索框有词时，把词**一路带进来**并立即触发搜索（实现在 `EntryForm` 的
     *      `presetQuery` + `onMount` 里那一步，见那边注释）。
     *    ⚠️ `initialQuery` 只走「新建」这条路 —— 命令面板 / 功能区图标那两处入口不传，
     *      行为与改动前逐字一致。
     */
    openAddModal(initialType?: EntryType, initialBookKind?: BookKind, initialQuery?: string): void {
        this.entryModal?.close();
        this.entryModal = new EntryModal(this.app, this, undefined, initialType, initialBookKind, initialQuery);
        this.entryModal.open();
    }

    /** 打开摘抄录入弹窗（命令入口无书需选书；书籍表单/右键菜单传入 book 固定挂载） */
    openExcerptModal(book?: MediaEntry): void {
        new ExcerptModal(this.app, this, book).open();
    }

    /** 添加摘抄：写入书目笔记摘抄区，随后立即刷新视图（摘抄数徽标即时更新） */
    async addExcerpt(bookId: string, excerpt: ParsedExcerpt): Promise<{ count: number }> {
        const e = await this.service.get(bookId);
        const r = await this.service.addExcerpt(bookId, excerpt, { refLink: this.excerptRefLink(e) });
        await this.refreshViews();
        return r;
    }

    /** 摘抄头行的源文件 wikilink 目标：库内文件取最短链接文本（metadataCache）；库外/无文件 → undefined（头行只写标签、块尾补 ^id） */
    excerptRefLink(e: MediaEntry | undefined): string | undefined {
        const rel = e?.bookFile;
        if (!rel) return undefined;
        try {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(rel));
            if (f instanceof TFile) return this.app.metadataCache.fileToLinktext(f, e?.notePath ?? '');
        } catch { /* 链接文本解析失败不阻断写入 */ }
        return undefined;
    }

    /** 摘抄计数（P1 性能缓存）：优先读 catalog.excerptCount（addExcerpt 时维护，零文件读）；
     *  老数据无值 → 惰性解析笔记一次并写回缓存（之后走缓存不再读笔记）。 */
    async excerptCounts(): Promise<Record<string, number>> {
        const out: Record<string, number> = {};
        const entries = await this.service.list();
        for (const e of entries) {
            if (e.type !== 'book' || !e.notePath) continue;
            if (typeof e.excerptCount === 'number') {
                out[e.id] = e.excerptCount;
                continue;
            }
            // 老数据兜底：解析一次并写回（失败记 0 不写回，下次重试）
            try {
                const f = this.app.vault.getAbstractFileByPath(e.notePath);
                if (f instanceof TFile) {
                    const n = countExcerpts(await this.app.vault.cachedRead(f));
                    out[e.id] = n;
                    void this.service.update(e.id, { excerptCount: n }).catch(() => undefined);
                } else {
                    out[e.id] = 0;
                }
            } catch {
                out[e.id] = 0;
            }
        }
        return out;
    }

    /** 生成年度总结：当年数据 → Markdown → 落盘 {libraryDir}/报告/YYYY-年度总结.md → 自动打开（仅统计页按钮入口） */
    async generateReport(): Promise<void> {
        const year = new Date().getFullYear();
        try {
            const [entries, excerptCounts] = await Promise.all([this.service.list(), this.excerptCounts()]);
            const md = generateYearReport({ year, entries, excerptCounts });
            const dir = this.libDir;
            const path = yearReportPath(year, `${dir}/${DIR_REPORTS}`);
            await createVaultIO(this.app).writeText(path, md);
            const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
            if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
            await this.refreshViews();
            new Notice(`已生成 ${year} 年度总结`);
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 罗列已生成的年度报告（{libraryDir}/报告/YYYY-年度总结.md），年份降序（统计页「往年报告」下拉） */
    async listYearReports(): Promise<{ year: number; path: string }[]> {
        try {
            const dir = normalizePath(`${this.libDir}/${DIR_REPORTS}`);
            return listReportYears(
                this.app.vault
                    .getFiles()
                    .map((f) => f.path)
                    .filter((p) => p.startsWith(dir + '/')),
            );
        } catch {
            return [];
        }
    }

    /** 打开某份年度报告笔记（统计页「往年报告」入口；报告在库内直接 openFile） */
    async openReport(path: string): Promise<void> {
        const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f);
    }

    /** #685 打开记录弹窗（时长 / 重温 / 周目）：固定挂载当前条目 */
    openEntryLogModal(entry: MediaEntry, kind: EntryLogKind): void {
        new EntryLogModal(this.app, this, entry, kind).open();
    }

    /** #685 打开文本记录弹窗（短评 / 攻略）：固定挂载当前条目 */
    openEntryTextModal(entry: MediaEntry, kind: EntryTextKind): void {
        new EntryTextModal(this.app, this, entry, kind).open();
    }

    /** #685 记录提交入口：时长（小时 → 分钟）/ 重温·周目（次数）→ 服务层落库 + 刷新 */
    async recordEntryLog(entryId: string, kind: EntryLogKind, data: { date: string; hours?: number; round?: number; note?: string }): Promise<void> {
        if (kind === 'time') {
            const minutes = Math.round((data.hours ?? 0) * 60);
            if (minutes <= 0) throw new Error('时长必须大于 0 小时');
            await this.service.addTimeSession(entryId, { date: data.date, minutes, note: data.note });
        } else {
            await this.service.addRoundLog(entryId, { kind, date: data.date, round: Math.max(1, Math.round(data.round ?? 1)), note: data.note });
        }
        await this.refreshViews();
    }

    /** #685 删除一条记录（时长明细 / 重温 / 周目） */
    async deleteEntryLog(entryId: string, kind: EntryLogKind, index: number): Promise<void> {
        if (kind === 'time') await this.service.removeTimeSession(entryId, index);
        else await this.service.removeRoundLog(entryId, index);
        await this.refreshViews();
    }

    /** #685 文本记录保存：短评（个人评语）/ 攻略
     *  🔴 用户 m00002：「添加短评…加上时间前缀」⇒ `date` 只对短评有意义
     *     （攻略是整篇正文，不带日期前缀），缺省 = 本地今天。 */
    async saveEntryText(entryId: string, kind: EntryTextKind, text: string, date?: string): Promise<void> {
        if (kind === 'comment') await this.service.setEntryComment(entryId, text, date);
        else await this.service.setEntryGuide(entryId, text);
        await this.refreshViews();
    }

    /** 打开编辑弹窗（书架/计划表卡片编辑图标） */
    async openEditModal(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (e) {
            this.entryModal?.close();
            this.entryModal = new EntryModal(this.app, this, e);
            this.entryModal.open();
        }
    }

    /**
     * 🔴 m07854 ⑭：「今天看什么」——从**「想看」且评分 ≥ 4** 的条目里随机抽一部，全屏弹卡。
     *
     * 🔴🔴 **2026-11-13 用户指令（本批反转了⑭的候选池口径）**，原话：
     *    「在对应的页签下的随机看一部应该是当前类型的随机出来而不是全部类型混在一起。
     *     （只有当导航布局为合并视图时随机看一部才是全库中挑）」。
     *    候选池 = **调用方传进来的那一份**（首页给的是「当前页签 + 当前视图」筛过的条目）；
     *       别在这里 `service.list()` 全库覆盖 —— 那就是用户点名要改掉的「全部类型混在一起」。
     *    兜底：`scoped` 为 `undefined`（命令面板 / 其他入口直接调）时取全库。
     *       这样「合并视图」和「没有页签上下文的入口」都是全库，语义一致。
     *
     * 封面`resolvePoster`（与首页同一套解析），⛔ 别在这里另拼路径。
     * ⚠️ 池为空时**照样弹**（Modal 里有空态说明），⛔ 不要用 `Notice` 顶替 ——
     *    用户点了骰子就该看到一张卡（哪怕是「还没够格候选」的说明卡），静默不弹会被当成没反应。
     */
    openWhatToWatchModal(scoped?: readonly MediaEntry[] | null): void {
        const pick = (all: readonly MediaEntry[]): readonly MediaEntry[] => scoped ?? all;
        void this.service.list().then((entries) => {
            const modal = new WhatToWatchModal(this.app, {
                entries: pick(entries),
                posterUrl: (e) => this.resolvePoster(e),
                onOpenEntry: (id) => void this.openEntryNote(id),
                // 🔴 m12298 ③：卡片封面右下角的播放钮走**宿主统一主操作入口**
                //    （`runEntryAction` 已在 #444c 收口：book 阅读 / game 启动 / music 播放 /
                //    其余观看，⛔ 别在这里再写一套分流）。原先这里的注入位是 `onEditEntry`
                //    （「改属性」按钮），用户点名删掉 ⇒ 同一个位置换成「播一集」。
                onPlayEntry: (e) => this.runEntryAction(e),
            });
            modal.open();
        });
    }

    // ───────────────────────── 条目回收站（「条目还原」） ─────────────────────────

    /** 回收站文件：与 catalog.json 同级（`{库目录}/trash.json`）。
     *  🔴 独立文件而不是塞进 catalog：catalog.json 是用户数据唯一真源、也是 Bases/Dataview 面向的库，
     *    往里塞「已删除的条目」会让外部查询看到幽灵行（详见 `pure/entryTrash` 模块头）。
     *  🔴 文件名**英文**（用户 2026-10-22 需求）：旧名 `条目回收站.json` 只由 `migrateTrashFileName` 读一次。 */
    get trashPath(): string {
        return `${this.libDir}/${TRASH_FILE_NAME}`;
    }

    /** 旧名回收站文件路径（仅迁移用；迁完就不再碰） */
    private get trashPathLegacy(): string {
        return `${this.libDir}/${TRASH_FILE_NAME_LEGACY}`;
    }

    /**
     * 回收站文件改名迁移（幂等，启动时执行一次）：
     *   `${lib}/条目回收站.json` → `${lib}/trash.json`
     *
     * 🔴 用 rename 而不是「读旧 → 写新 → 删旧」：
     *  ⑴ rename 是原子的，中途崩溃不会出现「新文件写了一半、旧文件已删」= 5 条后悔药全丢；
     *  ⑵ 保留文件本身（创建时间 / 属性不变），用户若在 Obsidian 里看过这个文件不会看到「被替换」。
     * ⚠️ 目标已存在（用户手动建过 trash.json / 上次迁移中途完成）⇒ **丢弃旧文件不覆盖**：
     *    新名文件是当前真源，旧名那份是历史残留，覆盖它只会把更旧的记录盖到新的上面。
     *    这是「宁丢旧记录、不覆盖当前数据」的一贯口径。失败静默，下次启动重试。
     */
    private async migrateTrashFileName(): Promise<void> {
        try {
            const legacy = this.app.vault.getAbstractFileByPath(normalizePath(this.trashPathLegacy));
            if (!(legacy instanceof TFile)) return; // 没有旧文件：绝大多数用户，直接返回
            const target = normalizePath(this.trashPath);
            const existing = this.app.vault.getAbstractFileByPath(target);
            if (existing instanceof TFile) {
                // 新名已存在：旧文件是残留，删掉（走回收站，误删可还原），⛔ 不覆盖新文件
                await this.app.fileManager.trashFile(legacy);
                return;
            }
            await this.app.vault.rename(legacy, target);
        } catch { /* 迁移失败静默（新写入已走新名；旧文件还在，下次启动重试） */ }
    }

    /** 读回收站（坏文件/不存在 → 空表，⛔ 不抛：设置页打不开比丢 5 条还原记录严重得多） */
    async readTrash(): Promise<TrashRecord[]> {
        try {
            return parseTrashFile(await createVaultIO(this.app).readText(this.trashPath)).records;
        } catch {
            return [];
        }
    }

    /** 写回收站（滚动保留最近 TRASH_KEEP 条） */
    private async writeTrash(records: TrashRecord[]): Promise<void> {
        await createVaultIO(this.app).writeText(this.trashPath, serializeTrashFile({ version: 1, records }));
    }

    /**
     * 落一条「刚删掉」的记录。**必须在真正删除前调用**：
     * 还原要的是条目原样快照（含 notePath / readingProgress / 关系网），删完就只剩回收站文件、没有记录可还原。
     * 失败**不阻断**删除（进不了回收站只是少了后悔药，不该反过来变成删不掉）；
     * `files` 只记**库内**路径（相对库目录），库外媒体一律不记（⛔ 本插件不碰库外文件）。
     */
    private async recordTrash(e: MediaEntry, files: string[] = []): Promise<void> {
        try {
            const prev = await this.readTrash();
            await this.writeTrash(pushTrashRecord({ version: 1, records: prev }, { deletedAt: new Date().toISOString(), entry: e, files: files.length ? files : undefined }, TRASH_KEEP).records);
        } catch {
            // 记不上不是删除的前置条件
        }
    }

    /**
     * 条目还原入口（设置页 › 封面与清理 › 条目还原） */
    async openEntryRestore(): Promise<void> {
        const [records, entries] = await Promise.all([this.readTrash(), this.service.list()]);
        new EntryRestoreModal(this.app, records, entries.map((e) => e.id), (picked) => this.restoreEntries(picked)).open();
    }

    /**
     * 还原若干条删除记录（弹窗回调）。逐条：确定 id → 补回 catalog → 有笔记时**重建**笔记 → 移出回收站。
     * 🔴 笔记按现有模板**重新生成**（用户若已在 Obsidian 回收站里还原了原笔记文件，`writeNote` 会先读后合并，
     *    标注区 / 歌词 / 关联区都是保留区，不会被模板冲掉）；文件本身找不回来时，还原的条目至少有一份新笔记。
     * ⚠️ 阅读存档 / 封面**不重写**：它们由各阅读器与封面逻辑按需再生，这里硬造只会覆盖用户可能在回收站里找回的那份。
     */
    async restoreEntries(picked: readonly TrashRecord[]): Promise<number> {
        if (picked.length === 0) return 0;
        let ok = 0;
        // 只移除**真正还原成功**的那几条：用「id@deletedAt」做键，⛔ 别再按 picked.slice(0, ok) 下标推算
        // （一旦中间某条失败，后面成功的记录会被留在回收站里，用户下次还会看到它）
        const done = new Set<string>();
        for (const rec of picked) {
            try {
                const live = await this.service.list();
                const { entry } = restoreEntryFor(rec, live.map((e) => e.id));
                await this.service.create(entry);
                ok++;
                done.add(`${rec.entry.id}@${rec.deletedAt}`);
                try {
                    await this.service.writeNote(entry.id);
                } catch {
                    // 笔记生成失败不影响条目还原（用户仍能在表单里重新生成）
                }
            } catch {
                // 单条失败不阻断其余
            }
        }
        if (done.size > 0) {
            const rest = (await this.readTrash()).filter((r) => !done.has(`${r.entry.id}@${r.deletedAt}`));
            await this.writeTrash(rest).catch(() => {});
        }
        await this.refreshViews();
        return ok;
    }

    // ───────────────────────── 附件管理 ─────────────────────────

    /**
     * 汇总**全部关联文件**（附件管理）：每个有文件的条目一组，组内 = 笔记 / 封面 / 阅读存档 / 书签 / 媒体。
     * 判定复用删除条目的 `entryAssetPlan`（同一份口径，⛔ 别在设置页另写一套「什么算关联文件」）。
     * 没有文件的条目**不列**（列表只服务于「管理文件」）。
     *
     * 🔴 2026-10-19 用户指令：「附件管理」弹窗按**系列**做二级折叠（`熊出没系列 · 共 N 部`）⇒
     *    这里把 `MediaEntry.series` 一并带出去。⛔ 别在弹窗里回头 `service.list()` 反查
     *    —— 那会与这份快照不同步（弹窗打开期间用户可能改了条目）。
     */
    async listEntryAssets(): Promise<AssetGroup[]> {
        const lib = this.settings.libraryDir || 'ReelLudic';
        const exists = (p: string) => this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile;
        const entries = await this.service.list();
        const out: AssetGroup[] = [];
        for (const e of entries) {
            const assets = entryAssetPlan({ entry: e, libraryDir: lib, exists });
            if (assets.length) {
                out.push({ entry: { id: e.id, title: e.title, type: e.type, series: e.series }, assets });
            }
        }
        return out;
    }

    /**
     * 附件管理入口（设置页 › 封面与清理 › 附件管理）。
     *
     * 🔴 2026-10-19 用户报障「关掉后再点打不开」的**真因**：本方法用 `assetManagerOpen` 做防重入，
     *    而弹窗的 `onClose()` 只清空 DOM，**从不复位这个标志** ⇒ 关过一次就永远走 early-return。
     *    ⇒ 修法 = 弹窗关闭时经 `onClosed` 回调把标志与实例引用一起复位；
     *      并且**每次都重新 `listEntryAssets()`**（⛔ 不复用旧实例：关闭期间的增删要能被看见）。
     */
    async openAssetManager(): Promise<void> {
        // 正在打开/已打开时不重复摊（首次扫描是异步的，连点两下不该开两个弹窗）
        if (this.assetManagerOpen) return;
        this.assetManagerOpen = true;
        try {
            this.assetManagerModal = new AssetManagerModal(
                this.app,
                await this.listEntryAssets(),
                this.trashPath,
                () => this.refreshViews(),
                // 🔴 复位必须挂在弹窗关闭上：这是上面那段报障的唯一修复点，⛔ 别挪到别处
                () => {
                    this.assetManagerOpen = false;
                    this.assetManagerModal = null;
                },
            );
            this.assetManagerModal.open();
        } catch (e) {
            this.assetManagerOpen = false;
            this.assetManagerModal = null;
            new Notice(`附件管理打开失败：${e instanceof Error ? e.message : String(e)}${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * 删除条目（#350 · 方案文档 M4）：**清单式确认 → 落回收站记录 → 逐项清理 → 删条目记录 → 刷新视图**。
     * 原实现是「一句轻量警告 + 删条目 + 连带删笔记」，封面 / 阅读存档会被遗弃（用户报障的盲区）。
     *
     * 🔴 四条硬口径：
     *  ⑴ **确认职责在本插件**：`fileManager.promptForDeletion` 在用户关掉 Obsidian「删除前确认」时
     *     **不弹窗、直接删**（asar 反查实证，见方案 D-9）—— 所以绝不依赖它来确认。
     *  ⑵ **笔记交给 Obsidian 原生弹窗删**：1.12 起它自带「一并删除附件」，能顺带处理**笔记里链接过的**文件
     *     （封面与播放器截图都嵌在笔记里）；用户在官方弹窗上取消 → **整体中止**（⛔ 不留半个删除）。
     *  ⑶ 其余勾选项（封面 / 阅读存档 / 书签文件 / 库内媒体）逐个走 **`trashFile`**（进回收站，可还原）。
     *  ⑷ **删之前先记一条回收站记录**（`recordTrash`）—— 设置页「条目还原」就靠它把条目记录找回来。
     */
    async deleteEntry(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (!e) return;
        const lib = this.settings.libraryDir || 'ReelLudic';
        const assets = entryAssetPlan({
            entry: e,
            libraryDir: lib,
            exists: (p) => this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile,
        });
        const picked = await new DeleteEntryModal(this.app, `删除条目「${e.title}」`, assets).open();
        if (!picked) return; // 取消 / 直接关闭 → 什么都不做
        // ⓪ 先落回收站记录：picked 里勾中的库内文件（笔记是 vault 全路径，其余是库内相对路径，字段口径见 entryAssetPlan）
        await this.recordTrash(
            e,
            collectTrashFiles(
                e,
                lib,
                assets.filter((a) => a.kind === 'store' || a.kind === 'bookmark').map((a) => a.path),
            ),
        );
        // ① 笔记：先交官方弹窗（唯一能顺带处理「笔记里链接过的附件」的通道）
        const note = picked.find((a) => a.kind === 'note');
        if (note) {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(note.path));
            if (f instanceof TFile && (await this.app.fileManager.promptForDeletion(f)) === false) return;
        }
        // ② 其余勾选项：逐个进回收站（单条失败不阻断其余）
        for (const a of picked) {
            if (a.kind === 'note' || !a.deletable) continue;
            const f = this.app.vault.getAbstractFileByPath(normalizePath(a.path));
            if (!(f instanceof TFile)) continue;
            try {
                await this.app.fileManager.trashFile(f);
            } catch {
                // 文件可能已被外部移除：不阻断
            }
        }
        // ③ 条目记录（⛔ 不用 removeWithNote —— 笔记已在上面处理过，避免重复删同一个文件）
        await this.service.remove(id);
        await this.refreshViews();
    }

    /**
     * 批量删除（列表多选）：一次确认后逐条删除，失败单条跳过不阻断。
     * ⚠️ 批量**不做逐项清单**（方案文档 D-3：会弹出 N 次）⇒ 直接清掉**安全项**（笔记 / 封面 / 阅读存档 / 书签文件），
     *    ⛔ 媒体文件永不默认删（那是用户自己的资产）。删除同样进回收站；每条在删前落一条回收站记录。
     */
    async deleteEntries(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        const ok = await new ConfirmModal(
            this.app,
            `确定删除选中的 ${ids.length} 个条目？笔记、封面与阅读存档将一并清理（进回收站）；媒体文件不会被动。`,
        ).open();
        if (!ok) return;
        const lib = this.settings.libraryDir || 'ReelLudic';
        for (const id of ids) {
            try {
                const e = await this.service.get(id);
                if (!e) {
                    await this.service.remove(id);
                    continue;
                }
                // 先算计划（笔记还在时能查到），再删——否则计划里的路径已经不存在
                const plan = entryAssetPlan({
                    entry: e,
                    libraryDir: lib,
                    exists: (p) => this.app.vault.getAbstractFileByPath(normalizePath(p)) instanceof TFile,
                }).filter((a) => a.risk === 'safe');
                await this.recordTrash(
                    e,
                    collectTrashFiles(e, lib, plan.filter((a) => a.kind === 'store' || a.kind === 'bookmark').map((a) => a.path)),
                );
                await this.service.removeWithNote(id);
                for (const a of plan) {
                    if (a.kind === 'note' || !a.deletable) continue; // 笔记已由 removeWithNote 处理
                    const f = this.app.vault.getAbstractFileByPath(normalizePath(a.path));
                    if (f instanceof TFile) await this.app.fileManager.trashFile(f);
                }
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /** 月历拖拽排期：设置条目的计划观看日期（dateStr 传空清除），随后刷新视图 */
    async planEntry(id: string, dateStr: string): Promise<void> {
        await this.service.update(id, { plannedDate: dateStr || undefined });
        await this.refreshViews();
    }

    /** 打开外部来源链接（计划表「直达」按钮；仅允许 http/https） */
    openExternalUrl(url: string): void {
        if (!/^https?:\/\//.test(url)) {
            new Notice('仅支持 http/https 链接');
            return;
        }
        window.open(url, '_blank');
    }

    /** 海报墙/列表「观看」按钮：影视条目有本地剧集或网络地址 → 弹集数选择（本地优先内嵌播放，否则打开网络）；否则单链接直接打开 / 多链接弹窗选择 */
    async openWatchLinkPicker(entry: MediaEntry): Promise<void> {
        const eps = entry.episodeFiles ?? [];
        const urls = entry.episodeUrls ?? [];
        const total = entry.progress?.totalEpisodes ?? 0;
        // 电影直达：真正单集（总集数未设或 ≤1，且资源不超过 1 个）不弹集数选择——直接播放第 1 集本地视频（无本地则打开网络地址）；
        // 多集（总集数 >1 或资源多于 1 个，如动画电影系列/上下集）→ 落入下方集数选择弹窗
        if (entry.type === 'movie' && total <= 1 && eps.length <= 1 && urls.length <= 1) {
            const p = eps[0];
            const u = urls[0];
            if (p) {
                void this.openEpisodeLocal(entry, 0);
                return;
            }
            if (u) {
                // 🔴 2026-11-06 用户报障：「怎么在单个电影下点击播放没有进到新播放器页面里。
                //    病根就是这里原本直接 `openExternalUrl(u)` 单集电影只要挂的是网络地址就开浏览。
                //    不支持「既是文件选择器又是目录选择器」**（该组合只会弹目录选择器）⇒ 实测「漫画关联不了
                //    与季里点网络集同一口径：能内嵌 B 站就开选集页由自有 `<video>` 播，
                //    只有B 站链接才退化成开浏览器（`openEpisodeOrExternal` 内部判）
                this.openEpisodeOrExternal(entry, 0, u);
                return;
            }
        }
        if (eps.length > 0 || urls.length > 0 || total > 1) {
            // 🔴 2026-11-07 用户裁定：「旧选集页面彻底删除掉，所有视频播放都改在新播放器页面播放。
            //    旧选集弹窗（`EpisodePickerModal`）已整文件删这里不再先弹一层「选哪一集」
            //    而是**直接进选集*，由它右栏那套选集网格承担「换集」的职责。
            //    ⚠️ 落点仍是**当前看到的那一*（`progress.episode` 为基准）与旧弹窗的初始页同一口径。
            //       别退化成 0（那会让「点观看」每次都从第 1 集重来）
            const at = Math.max(0, (entry.progress?.episode ?? 1) - 1);
            const p = entry.episodeFiles?.[at];
            const u = entry.episodeUrls?.[at];
            if (p) {
                void this.openEpisodeLocal(entry, at);
                return;
            }
            if (u) {
                this.openEpisodeOrExternal(entry, at, u);
                return;
            }
            // 当前集两种资源都没填（用户只设了总集数）仍进选集页，让他在右栏选集里自己挑。
            // 本地起始集为空时页子不会自己起播，那是预期（没有可播的东西）
            void this.openEpisodePageFor(entry, at);
            return;
        }
        const links = entry.links ?? [];
        if (links.length === 0) return;
        if (links.length === 1) {
            this.openExternalUrl(links[0].url);
            return;
        }
        const url = await new LinkPickerModal(this.app, entry.title, links).open();
        if (url) this.openExternalUrl(url);
    }

    /**
     * 海报墙 / 列表右键那条**常驻**的关联入口（文案见 `pure/actionLabel.associateMenuLabel`）。
     * 书 / 游戏 / 音乐 = 本地路径；影视 = 选集网络 / 本地源；保存由 `saveQuickAssociate` 落库 + 同步笔记 + 刷新视图。
     *
     * 🔴 #599：选集弹窗里那枚「去关联」（清该集本地路径 + 网络链接）**已整体撤除**（用户点名「去除【去关联】入口按钮」）
     *    —— 连带那枚按钮、它在宿主侧的那枚落库出口与它的样式一并退场（⛔ 不留死码）。
     *    ⚠️「按钮类名 / 回调名 / 那个方法名」三个字面量**刻意一个都不写**：注释会进产物，
     *       写了会撞红「那枚按钮不许回潮」的反向守卫（本仓老坑）。
     *    改关联 / 解除关联改走**本弹窗**（清空输入框 = 解除关联，`collectResult` 的空值照写那条口径不变）。
     *    ⚠️ 「集号保位」那条口径仍有效，只是由 `pure/episodeAssoc.storeEpisodeList` 执行（去尾空位、保留中间的洞）。
     */
    quickAssociateEntry(entry: MediaEntry, onClosed?: () => void, opts?: { hideMovieBatchFill?: boolean }): void {
        new QuickAssociateModal(this.app, entry, {
            pickFile: (kind) => this.pickForAssociate(kind),
            probeBook: (path) => this.probeBookPages(path),
            pickVideoDir: () => this.pickVideoDirPath(),
            scanEpisodeDir: (dir) => this.scanEpisodeDir(dir),
            // 🔴 #521 撤除：本弹窗**不再挂**「下载 / 检索」小图标（#406 / #454 那两套回调随之删除）——
            //    用户：「右键观看按钮浮窗网络链接按钮删除掉，干脆统一一下，书籍类游戏音乐也一样」。
            //    这两件事在**编辑表单的标签行**上都有（同一份实现）⇒ ⛔ 不在两处重复提供。
            //    ⚠️ 主程序那两个方法（`openMusicDownloader` / `listLibraryAudioFiles`）
            //    **原样保留** —— `EntryModal`（完整编辑表单）那侧还在用，⛔ 别顺手删。
            // 🔴 #506：影视条目「网络地址」标签旁的 **B站 搜索小按钮**（用户报障：这个入口原先没有它）。
            //    复用**同一条链**：`main.dlBiliSearch` / `main.dlBiliView`（两步请求 + `buvid3` 缓存 +
            //    `Platform.isDesktopApp` 门控都在它们里面，⛔ 这里不再判平台、也 ⛔ 别另写一份请求）。
            //    `biliParts` 缺了就会回落成「只填当前这一集」；两个都缺 ⇒ 弹窗里不画那枚按钮。
            biliSearch: (kw: string) => this.dlBiliSearch(kw),
            biliParts: (bvid: string) => this.dlBiliView(bvid),
            // 🔴「网络集可搜索 YouTube」：globe 浮层的第二个搜索源（与编辑表单同一个宿主出口
            //    `main.ytSearch`，⛔ 这里不另写请求、也不判平台 —— 那个方法自己判）。
            ytSearch: (kw: string) => this.ytSearch(kw),
            // 🔴 #599：「本地路径」标签旁那枚**单集本地检索** —— 与编辑浮层 #563 走**同一个宿主方法**
            //    （设置页分类目录递归找当前集；⛔ 这里不另写扫盘逻辑、也不判平台）。
            searchLocalEpisode: (o) => this.searchLocalEpisode(o),
            // 🔴 #601：单路径三类（书 / 游戏 / 音乐）「本地路径」旁那枚检索 —— 一步到位（见下方方法注释）。
            searchLocalFile: () => this.searchLocalForAssociate(entry),
            // 🔴🔴 2026-11-16（用户：「游戏类型卡快捷关联入口里怎么没获取swf入口」）：
            //    游戏条目的**本地 Flash 影片**（`.swf`）—— 编辑表单里早就有「浏览 / 获取」两枚，
            //    但快捷关联弹窗只有 .lnk 那条路，用户在这个入口没法把 swf 挂上去。
            //    两枚都复用**编辑表单同一条宿主链**（⛔ 别在这里另写一份地址解析 / 下载）：
            //      · `pickGameSwfPath()` —— 系统选择器挑 .swf；
            //      · `promptFetchGameSwf()` —— 问地址 → 抓真实 swf → 下载入库 → 返回库内相对路径。
            //    ⚠️ 只对 `type === 'game'` 注入（弹窗那边还会再按类型判一次，双保险）。
            ...(entry.type === 'game'
                ? {
                      pickGameSwf: () => this.pickGameSwfPath(),
                      // 🔴 必须带 `entry.id`：落盘文件名 = 「条目标题.swf」，不带 id 就退回 URL 末段。
                      fetchGameSwf: () => this.promptFetchGameSwf(entry.id),
                      // 2026-11-16 用户「改成关联目录」：选一整个游戏文件夹，自动挑主影片
                      pickGameSwfDir: () => this.pickGameSwfFromDir(),
                  }
                : {}),
            // 🔴🔴 2026-10-21（用户需求 8）：「音乐」条目的「本地路径」标签旁补一枚
            //    **「下载音频并回填路径」**小图标按钮，交互与编辑表单那枚一致。
            //    这是对 #521「本弹窗不再挂下载 / 检索小图标」的**部分翻面** ——
            //    用户这次只点名了音乐这一处（原话：音乐在「本地路径」旁再加一个
            //    「下载音频并回填路径」的小图标按钮，与编辑条目交互一致），
            //    书籍 / 影视 / 游戏那三处**仍不挂**（⛔ 别"顺手统一"，那就是把 #521 整条推翻）。
            //    门控与编辑表单**同源**：`canUseAudioDownload()`（桌面端 + 内置音乐播放器）；
            //    能力不在就**不注入** ⇒ 弹窗按「没注入就不渲染」处理，
            //    ⛔ 别注入一个注定失败的回调（点了没反应的按钮比没有按钮更差）。
            ...(this.canUseAudioDownload()
                ? {
                      musicDownload: (title: string, author: string, onPicked: (relPath: string) => void) =>
                          this.openMusicDownloader(title, author, onPicked),
                  }
                : {}),
            // 🔴🔴 #679（用户：「漫画右键菜单的关联入口窗口…没有能选择文件夹序列按钮」）：
            //    漫画条目的「选文件夹」—— 与编辑表单 #539 那枚**同一个宿主出口** `pickBookFolderPath`
            //    （Electron 在 Windows/Linux 上文件/目录只能二选一，⛔ 不能靠「浏览」兼做）。
            //    非漫画条目不给 ⇒ 弹窗里不渲染那枚按钮（不画点了没反应的东西）。
            pickBookFolder: normalizeBookKind(entry.bookKind) === 'comic' ? () => this.pickBookFolderPath() : undefined,
            // 🔴 #601：书籍「网络地址」旁那枚在线检索（微信读书）—— 与编辑表单 `onSearchWeread`
            //    **同一个出口**（`main.searchWeread`），⛔ 不另写一份请求。
            searchOnlineBook: (kw: string) => this.searchWeread(kw),
            // 🔴 #686（用户：「音乐类型的关联弹窗，网络地址旁没有搜索b站的小图标按钮啊」）：
            //    音乐「网络地址」旁那枚 `globe` 改成 **B站 检索**（与影视侧同一个 `biliSearch` 出口），
            //    ⛔ 不再走在线曲库（那枚在本弹窗撤掉；曲库检索仍在条目编辑浮层 / 搜索页曲库栏 / 下载窗口）。
            save: (r) => this.saveQuickAssociate(entry, r),
            // 🔴 用户 2026-10-29「字幕双向持久化」：字幕路径的**存在性探针**（丢文件要标红）。
            //    ⚠️ 弹窗是 `src/modals` 层，⛔ 不碰 fs；这里给一个只读探针，逻辑全在这个方法里。
            fileExists: (p) => this.subtitleFileExists(p),
            // 🔴 `b23.tv` 短链：手机分享的短码里没有 BV 号，弹窗是纯 UI 层不发请求 ⇒ 由宿主跳一次
            //    （与 `biliStreamFor` 内部那跳**同一个出口** `resolveBiliShortUrl`，⛔ 别各写一份）。
            resolveBiliShort: (u: string) => this.resolveBiliShortForPaste(u),
            // 🔴 #629：关窗（且兜底提交落库完成）后的回调 —— 只有系列「批量关联」清单会用到它
            onClosed,
            // 🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」
            //    只有**系列批量关联**这条入口会传 `opts.hideMovieBatchFill`，
            //    海报墙 / 列表右键那条入口不传 ⇒ 电影仍照 #521 的裁定画那两枚。
            //    ⛔ 别在这里写死 `entry.type === 'movie'`（那会把 #521 整条推翻，见 cbs 上的注释）。
            hideMovieBatchFill: opts?.hideMovieBatchFill === true,
        }).open();
    }

    // ──────────── 今日记录 / 日记打卡 ────────────
    /** 活动日志（状态翻转）：统计页「今日」与日记打卡共用的数据源 */
    async listActivity(): Promise<ActivityEvent[]> {
        try {
            return await this.service.activityLog();
        } catch {
            return [];
        }
    }

    /** 核心「日记」插件的目录/格式配置（未启用或内部接口变化 → null，不抛错） */
    private dailyNotesOptions(): { folder?: string; format?: string } | null {
        try {
            const ip = (this.app as unknown as {
                internalPlugins?: {
                    getPluginById?(id: string): {
                        enabled?: boolean;
                        instance?: { options?: { folder?: string; format?: string } };
                    } | null;
                };
            }).internalPlugins;
            const p = ip?.getPluginById?.('daily-notes');
            if (!p || p.enabled === false) return null;
            return p.instance?.options ?? null;
        } catch {
            return null;
        }
    }

    /** 打卡日记落点：设置页手填优先 → 核心「日记」插件 → 回退「日记 / YYYY-MM-DD」 */
    private journalTarget(): { dir: string; format: string } {
        const core = this.dailyNotesOptions();
        const dir = (this.settings.journalDir?.trim() || core?.folder?.trim() || '日记').replace(/^\/+|\/+$/g, '');
        const format = this.settings.journalFormat?.trim() || core?.format?.trim() || 'YYYY-MM-DD';
        return { dir, format };
    }

    /** 目录不存在则逐级创建（vault.createFolder 只建一级） */
    private async ensureFolder(dir: string): Promise<void> {
        if (!dir) return;
        let cur = '';
        for (const seg of dir.split('/').filter(Boolean)) {
            cur = cur ? `${cur}/${seg}` : seg;
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try {
                    await this.app.vault.createFolder(cur);
                } catch { /* 笔记失败不阻断导入 */ }
            }
        }
    }

    /**
     * 一键把观影/阅读动态写成打卡区块，追加进**当天日记**（幂等：已有同范围区块则整体更新，不重复追加）。
     * 范围跟随统计页「动态」面板的 日/周/月/年 切换：日 = 逐条（HH:mm），周/月/年 = 该周期的分块汇总。
     * 区块标题按范围区分（`2026-09-10` / `第 37 周（…）` / `2026-09` / `2026`），因此不同范围的区块互不覆盖。
     * 唯一入口 = 统计页「动态」面板的按钮（09-10 起不再挂设置页行与命令面板）。
     */
    async recordTodayJournal(range: FeedRange = 'day'): Promise<void> {
        const span = feedSpan(range);
        const [entries, log] = await Promise.all([this.service.list(), this.listActivity()]);
        const block = range === 'day'
            ? renderJournalBlock(span.start, collectDayActivity(entries, log, span.start))
            : renderPeriodBlock(range, span, groupFeed(collectFeed(entries, log, span), range));
        if (!block) {
            new Notice(`${FEED_RANGE_WORDS[range]}还没有观影/阅读动态 — 标记「在看/已看」或添加条目后再记录`, 4000);
            return;
        }
        const dateStr = span.start; // 日记文件名仍按「今天」（写入当天日记）
        const sectionLabel = range === 'day' ? span.start : feedSectionLabel(range, span);
        const { dir, format } = this.journalTarget();
        let name: string;
        try {
            name = moment(new Date()).format(format);
        } catch {
            name = dateStr;
        }
        const path = normalizePath(`${dir ? `${dir}/` : ''}${name}.md`);
        try {
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                const cur = await this.app.vault.read(existing);
                const next = upsertJournalSection(cur, sectionLabel, block);
                if (next !== cur) await this.app.vault.modify(existing, next);
            } else {
                await this.ensureFolder(dir);
                await this.app.vault.create(path, upsertJournalSection('', sectionLabel, block));
            }
            new Notice(`已记录${FEED_RANGE_WORDS[range]}动态 → ${path}`, 4000);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`写入打卡日记失败：${msg}${msg}`, 5000);
        }
    }

    /** 系统文件选择器按类别分发（书=电子书 / 游戏=.lnk / 音乐=音频 / 影视=可关联视频容器） */
    private pickForAssociate(kind: QuickAssocPickKind): Promise<string | undefined> {
        switch (kind) {
            case 'book': return this.pickBookFilePath();
            case 'game': return this.pickGameLaunchPath();
            case 'music': return this.pickLocalAudioPath();
            case 'video': return this.pickLocalVideoPath();
            // 🔴 2026-11-06 用户：「关联入口每集各个字幕文件框旁也要加个浏览按钮。
            //    ⚠️ 走既有的 `pickSubtitleFromSystem`（只选不读），⛔ 别用 `pickSubtitleRaw`
            //    —那个会顺带读文件正文，关联入口只需要一条路径。
            case 'subtitle': return this.pickSubtitleFromSystem().then((v) => v ?? undefined);
        }
    }

    /** 快捷关联保存：组装 patch →（书籍探本地基准 reconcile 进度）→ service.update → 同步笔记 → 刷新。
     *  笔记外部修改冲突不弹确认（快捷关联改动面小；writeNote 内置摘抄区合并防覆写） */
    private async saveQuickAssociate(entry: MediaEntry, r: QuickAssociateResult): Promise<void> {
        const patch: Partial<MediaEntry> = {};
        if (entry.type === 'book') {
            patch.bookFile = r.bookFile?.trim() || undefined;
            // 🔴 #601：网络地址与本地路径**两条并列**（清空 = 只解除那一条）
            patch.readUrl = r.readUrl?.trim() || undefined;
            if (r.bookFile) {
                const probe = await this.probeBookPages(r.bookFile);
                if (probe) {
                    const rec = reconcileBookProgress(entry.readingProgress ?? {}, probe as BookFileInfo);
                    if (rec.readingProgress) patch.readingProgress = rec.readingProgress;
                    if (rec.pageCount !== undefined) patch.pageCount = rec.pageCount;
                }
            }
        } else if (entry.type === 'game') {
            patch.gameLaunchPath = r.gameLaunchPath?.trim() || undefined;
            patch.gameUrl = r.gameUrl?.trim() || undefined;
            // 🔴 2026-11-16：本地 Flash 影片（`.swf`）。`undefined` = 这次没动（弹窗没建那一行）
            //    ⇒ ⛔ 别写 `r.gameSwf?.trim() || undefined`，那会把已有值冲掉。
            //    弹窗只在自己建了输入框时才产出这个键（见 `collectResult`）。
            if (r.gameSwf !== undefined) patch.gameSwf = r.gameSwf.trim() || undefined;
            // 🔴 2026-11-16：内嵌播放页（H5 / Unity）。与上面同口径 —— `undefined` = 这次没动。
            if (r.gameEmbed !== undefined) patch.gameEmbed = r.gameEmbed.trim() || undefined;
        } else if (entry.type === 'music') {
            patch.audioPath = r.audioPath?.trim() || undefined;
            // 🔴 #601：音乐网络地址（append-only 新字段）
            patch.audioUrl = r.audioUrl?.trim() || undefined;
        } else {
            patch.episodeFiles = r.episodeFiles;
            patch.episodeUrls = r.episodeUrls;
            patch.episodeTitles = r.episodeTitles;
            // 🔴 用户 2026-10-29「字幕双向持久化」：关联弹窗里改过的每集字幕路径。
            //    ⚠️ `undefined` = 这次没动（⛔ 别写`r.subtitlePaths ?? {}` 那会把整。
            //    字幕记忆清空，而弹窗只*真变*时才产出这个键，`collectResult`。
            if (r.subtitlePaths !== undefined) patch.subtitlePaths = r.subtitlePaths;
            if (entry.type !== 'movie' && r.totalEpisodes !== undefined) {
                // 仅调整 totalEpisodes，保留既有剧集进度（season/episode/日期/历史）
                const p = entry.progress;
                patch.progress = {
                    season: p?.season ?? 1,
                    episode: p?.episode ?? 0,
                    history: p?.history ?? [],
                    ...(p?.lastWatchedDate !== undefined ? { lastWatchedDate: p.lastWatchedDate } : {}),
                    totalEpisodes: r.totalEpisodes,
                };
            }
        }
        const merged = await this.service.update(entry.id, patch);
        try {
            await this.service.writeNote(merged.id);
        } catch (e) {
            new Notice('笔记同步失败：' + (e instanceof Error ? e.message : String(e)), 5000);
        }
        await this.refreshViews();
    }

    /** 打开某剧集本地视频（海报墙/列表「观看」选集后）：受设置「内置播放器打开视频文件」控制——
     *  关闭（默认）→ 系统播放器打开文件；开启时按整剧 episodeFiles 收集可内嵌集建播放列表打开内置播放器
     *  （支持上一集/下一集）；所选集为 Chromium 不可内嵌格式（mkv/h265 等）→ 自动转系统播放器 */
    private async openEpisodeLocal(entry: MediaEntry, startIdx: number, seekSec?: number, forceInternal = false): Promise<void> {
        const all = entry.episodeFiles ?? [];
        const startPath = all[startIdx];
        if (!startPath) return;
        // 设置「内置播放器打开视频文件」关闭（默认）→ 一律系统播放器打开文件（镜像 internalBookReader 语义）
        // 🔴 `forceInternal`（时间戳深链专用）：**必须走内置播放器** —— 只有它能定位到某秒；
        //    走系统播放器会从头播 = 「点了等于没跳」（2026-09-19 用户实测报障）。
        if (!forceInternal && !this.settings.internalMediaPlayback) {
            void this.openWithSystemPlayer(startPath);
            return;
        }
        // 所选集不可内嵌 → 该集直接系统播放器（不建弹窗，符合「不支持的自动转系统」）
        if (!isEmbeddableVideoPath(startPath)) {
            void this.openWithSystemPlayer(startPath);
            return;
        }
        // B 站风选集页（#691）：新页自带内置播放+ 右侧选集栏，与「观看」按钮同一落点。
        await this.openEpisodePageFor(entry, startIdx, seekSec);
    }

    /**
     * 点了一集**只有网络地址**的集：能就地内嵌（B 站）⇒ 打开选集页并停在这一集；否则开浏览器。
     *
     * 🔴 报障根因（2026-11-02 用户：「怎么只有在系列卡播放才能内嵌播放，在其中一季点击播放按钮会直接跳转浏览器播放」）：
     *    系列卡走 `openSeriesPicker` → `openEpisodePageFor`（会开选集页），
     *    而季详情里的集按钮走 `runEntryAction` → `openWatchLinkPicker`，那条路对网络集**无条件** `openExternalUrl`
     *    ⇒ 同一部片，从系列卡点能内嵌、从季里点却跳浏览器。两处入口必须同一口径。
     *
     * ⛔ 不对**不可内联的**链接开选集页：那页的内嵌层只做 B 站 + YouTube，硬开只会得到「点了一格没反应」。
     *    （2026-10-31 改口径：原话是「非 B 站链接」，现在 YouTube 也进了内置播放器，
     *      判据统一收在 `pure/netInline.ts` 的 `canPlayNetInline` —— 四处闸门共用一份。）
     * ⚠️ 选集页要能画出这一集的高亮，所以起始集必须传 `idx`（不是 0）。
     */
    private openEpisodeOrExternal(entry: MediaEntry, idx: number, url: string): void {
        if (canPlayNetInline(url)) {
            // 🔴 第二层根因：光把「点的是网络集」分流到选集页还不够。
            //    `openEpisodePageFor` `startIdx` 指的*`items`（本地可内嵌集）的下*。
            //    纯网络集压根不在 `items` 里（`buildEmbedItems` 只收本地文件）⇒ `findIndex` -1
            //    页子停在 0 集、本地播放器照常起来，用户看到「点了没反应。
            //    `netStart` 把「起始是网络集、集号是 idx」单独交给页子，由它自己进内嵌。
            void this.openEpisodePageFor(entry, idx, undefined, false, idx);
            return;
        }
        this.openExternalUrl(url);
    }

    /**
     * 🔴 #691（2026-10-27）：**打开 B 站风选集页**（新页面，不是播放器内嵌侧栏）。
     *
     * 用户原话：「系列卡点击播放按钮后的改成 B 站风格页面的，不是内置播放器加个侧边栏，是新增一个页面」，
     * 并追加「两者都进新页」⇒ 系列卡播放按钮与海报墙/列表「观看」按钮共用这一条落点。
     *
     * 🔴 边界（全部沿用「观看」按钮既有口径，⛔ 不在这里另立一套）：
     *  - `internalMediaPlayback` 关闭 且非 `forceInternal` ⇒ 系统播放器（设置跟随，用户裁定第 3 条）；
     *  - 起始集不可内嵌 ⇒ 系统播放器；
     *  - 无可内嵌集 ⇒ 系统播放器兜底（防御：可内嵌却解析失败）；
     *  - 只要**存在**可内嵌集就开新页 —— 用户点的是选集页，不是「必须先能播这一集」。
     */
    private async openEpisodePageFor(entry: MediaEntry, startIdx = 0, seekSec?: number, forceInternal = false, netStart?: number): Promise<void> {
        const all = entry.episodeFiles ?? [];
        const startPath = all[startIdx];
        // 🔴 2026-11-06：电影页隐藏选集节之后（用户裁定），「唯一资源是网络地址」的单集电影
        //    再也没有任何格子可点 页子打开就是一片黑，用户必须自己去点播放（真机实测 A6 失败。
        //    这里替它补上「一进来就播这一集」的意图：没有本地起始集、且0 条是**可内*
        //    链接（B 站或 YouTube，判据见 `pure/netInline.ts`）时，默`netStart = 0`
        //    ⚠️ 2026-10-31 起判据从 `canEmbedBili` 换成 `canPlayNetInline`：否。
        //      「唯一资源YouTube 链接」的单集电影打开还是一块黑，用户得自己找那一。
        //    只在调用*没显式指* `netStart` 时兜。
        //    显式传了（季里点N 集）就以调用方为准，别把用户点的集号覆盖0
        //    ⚠️ 多集条目不受影响：`urls.length > 1` 时保持原样，由用户自己挑
        if (typeof netStart !== 'number' && !startPath) {
            const urls = entry.episodeUrls ?? [];
            const soleUrl = urls.length === 1 ? urls[0] : undefined;
            if (soleUrl && canPlayNetInline(soleUrl)) netStart = 0;
        }
        // 设置跟随 + 起始集不可内系统播放器（`openEpisodeLocal` 同口径）
        if (startPath) {
            if (!forceInternal && !this.settings.internalMediaPlayback) {
                void this.openWithSystemPlayer(startPath);
                return;
            }
            if (!isEmbeddableVideoPath(startPath)) {
                void this.openWithSystemPlayer(startPath);
                return;
            }
        }
        const items = this.buildEmbedItems(entry);
        if (items.length === 0) {
            // 没有任何可内嵌集：有本地起始集就交系统播放器，否则纯网络条目也开新页（能看到选集 + 点开浏览器）
            if (startPath) {
                void this.openWithSystemPlayer(startPath);
                return;
            }
        }
        const pos = items.findIndex((it) => it.index === startIdx);
        const allEntries = await this.service.list();
        const page: EpisodePageExtras = {
            entry,
            files: all,
            urls: entry.episodeUrls ?? [],
            titles: entry.episodeTitles ?? [],
            // #527 失效标红：读**内存缓存**（编辑表单点过「检测失效」才有；没检测过 → 全 undefined，不标）
            statuses: this.linkStatusCache.get(entry.id) ?? [],
            total: entry.progress?.totalEpisodes ?? 0,
            // 当前集：季里点的是网络集时，用户要落到**那一集**，⛔ 不能拿 `progress.episode`
            // （那是上次看到哪集的记忆，可能完全是另一集；拿它盖会把用户按的格子抹掉）。
            currentIndex: typeof netStart === 'number'
                ? netStart
                : Math.max(0, (entry.progress?.episode ?? startIdx + 1) - 1),
            allEntries,
            coverUrl: this.resolvePoster(entry) ?? null,
            // 逐季封面：季卡要用**各自的**横版/竖版图，不能拿当前这部顶替。
            // ⚠️ 做成回调而不是提前算好数组：`allEntries` 是全库，全量解析封面会把打开动作拖慢；
            //    季带只画屏幕上那几张，按需取即可。
            seasonCover: (e) => this.resolvePoster(e) ?? null,
            // 逐集封面计划（#691 用户 2026-10-27「集数列表样式为封面+集数+标题」）：
            //   ⚠️ 与选集弹窗**共用同一个** `epCoverFor` —— 本地首帧 / B 站缩略图 / 统一占位图
            //      都在那里判过了，新页只按计划渲染（⛔ 别在这里再拼一套取图逻辑）。
            //   ⚠️ 做成回调：一页 50 格全量解析会把首屏拖慢，视图那边按「滚进视野」逐个问。
            episodeCover: (i) => this.epCoverFor(all, entry.episodeUrls ?? [], i),
            overview: entry.summary ?? '',
            onOpenSeason: (e) => void this.openEpisodePageFor(e, 0),
            // 🔴 用户 2026-11-16 逐字：「播放器详情页的右键更新了关联入口链接，但视频播放器不刷新」
            //    ⇒ 页子重算「本地可播集」时回宿主这一条出口（`buildEmbedItems` 是唯一真源，
            //      内含 `isEmbeddableVideoPath` + `resolveEmbedUrl` 两处只有宿主知道的知识）。
            //    ⚠️ 传函数不传数组：`refreshEpisodePages` 拿到的是**每次都最新**的条目快照，
            //      提前算好塞进 page 又会变成第二份会过期的快照（正是这个 bug 的老样子）。
            reloadItems: (e) => this.buildEmbedItems(e),
            onOpenSeriesList: () => this.openSeriesListFor(entry),
            // 🔴 用户 2026-11-08：「同时简介的封面可右键可弹窗菜单（同海报墙编辑属性逻辑）」
            //    ⇒ 简介封面右键弹**与海报墙完全同一个**菜单。
            //    ⚠️ 七个回调逐个对齐 `views/HomeView.ts:233-270` 传给海报墙的那一套 ——
            //       同一件事写两遍必有一遍先烂（本仓 #730 的教训），动作实现也复用 `plugin.*`，
            //       ⛔ 别在这里另写一遍打开逻辑。
            entryMenu: {
                onWatch: (e) => this.runEntryAction(e),
                onQuickAssociate: (e) => this.quickAssociateEntry(e),
                onEditEntry: (id) => void this.openEditModal(id),
                onAddExcerpt: (b) => this.openExcerptModal(b),
                onOpenEntryLogModal: (e, kind) => this.openEntryLogModal(e, kind),
                onOpenEntryTextModal: (e, kind) => this.openEntryTextModal(e, kind),
                onDeleteEntry: (id) => this.deleteEntry(id),
            },
            // 🔴 用户 2026-11-14：「播放器详情页简介封面加左键单击进笔记」
            //    ⇒ 左键封面走与标题行 / 阅读器顶栏**同一条**出口 `openEntryNote`
            //    （没有笔记会当场生成，见它的 #593 自愈分支），⛔ 别在这里另写打开逻辑。
            onOpenNote: (id) => void this.openEntryNote(id),
            onOpenUrl: (url) => {
                // 本地路径（不可内嵌集）→ 系统播放器；网络地址 浏览。
                if (!url) return;
                if (/^https?:\/\//.test(url)) this.openExternalUrl(url);
                else void this.openWithSystemPlayer(url);
            },
            // 时间轴面板的「导入字幕」：只读原文（⛔ 不转 VTT —— .ass 没有转换通路，
            // 面板自己按扩展名选解析器；画面字幕仍归播放器基类那条 <track> 通路）
            importCue: () => this.pickSubtitleRaw(),
            // 起始是纯网络集（季里点了 B 站集）⇒ 页子打开就进内嵌，⛔ 不留在第 0 集空转
            startNet: typeof netStart === 'number' ? netStart : undefined,
            // 🔴 用户 2026-11-11：「全屏能播，回到详情页一直缓冲中播不了」——
            //    回跳必须带上秒数（`seekSec`），否则视图侧 DASH 分支只能从第 0 片重拉。
            //    ⚠️ 只在网络集回跳时有意义（`netStart` 存在），本地集走基类 `pendingSeek`。
            startNetSeek: typeof netStart === 'number' && typeof seekSec === 'number' && seekSec > 0
                ? seekSec
                : undefined,
            netSubtitle: (url) => (isYouTubeUrl(url) ? this.ytSubtitleFor(url) : this.biliSubtitleFor(url)),
            // 🔴 用户 2026-11-11：「给字幕加个AI面板总结按钮小图标…点击在字幕面板上浮出AI面板」
            //    ⇒ 把「整条字幕 → 概括 + 要点」这条 AI 通道交给页子。
            //    ⚠️ 与 `netSubtitle` 分开：取字幕是数据，总结是另一家服务、另一组配置。
            cueSummary: (input) => this.cueSummarize(input),
            // 🔴 用户 m09565 ①-8：「字幕面板-AI总结输出动效改成流式打字机」
            //    ⇒ 同一个 `CueSummaryService`，只是走 `generateStream`（边收边推前缀）。
            //    ⚠️ 返回值与上面那条完全同构，视图层收尾仍走同一条渲染。
            cueSummaryStream: (input, onPartial) => this.cueSummarizeStream(input, onPartial),
            cueAsk: (input, q, hist) => this.cueAsk(input, q, hist),
            // 🎙️ 本地语音转文字（用户 m01938）：工具条那颗按钮的落点。
            // ⚠️ 与 `cueSummary` / `cueAsk` 完全分开：那两条走云端 AI，这条**全程在本机跑**，
            //    既不读 API Key 也不联网（用户在需求里把「音视频绝不上传」写成了硬要求）。
            transcribe: (req) => this.transcribeCue(req),
            // 📖 学习模式悬停查词（用户 m01938 §3.1）：落到设置里那个本地词典文件。
            // ⚠️ 为什么返回 `{def, phonetic?} | null` 而不是抛：查不到是**常态**（生僻词、
            //    没配词典），气泡要的是「安静地只说词形 + 🔊」，⛔ 不让一个查不到把学习模式打崩。
            //    查不到的具体原因（没配 / 找不到文件 / 太大 / 读失败）走 `dictHint()` 只在设置页显示。
            lookupWord: (key) => this.lookupWordInLocalDict(key),
            // 🔴 2026-10-31：把「上一次取流为什么失败」交给页子。YouTube 失败**没有兜底画面**
            //    （B 站能退 iframe，YouTube 没有），若只返回 null，页子只能干瞪眼，
            //    用户看到「点了没反应」——比原来跳浏览器更糟。原因只有宿主知道（`lastYtError`）。
            //    ⚠️ 传函数不传值：`lastYtError` 每次取流都变，快照会显示上一次的旧错误。
            // 🔴 2026-11-15（用户 m02763「网络集用插件播放器加载不出来」）扩到 B 站：
            //    B 站这条路以前**有兜底**（退 iframe / 开浏览器）所以没接过原因，
            //    但真机实测两条报障条目是 `62002 稿件不可见` —— 兜底再漂亮也没用，
            //    用户想知道的是「为什么播不了」。`lastBiliError` 现在会带人话原因。
            netFailHint: () => this.lastYtError ?? this.lastBiliError,
            // 🔴 2026-10-31 用户报障：「B站/油管内嵌的怎么还有登录，不上填了 cookie 吗」
            //    根因：设置里那串 Cookie 只喂插件自己的 API 请求；官方内嵌 iframe 是
            //    Electron 的独立浏览上下文，读的是 Chromium 的 cookie jar，两边从来没打通
            //    （真机实测该 jar 里 bilibili.com / youtube.com 都是 0 条）。
            //    ⇒ 挂 iframe 前把设置里那串写进 jar（`syncEmbedCookies()` 正式方法，见下）。
            //    ⚠️ 传函数：设置随时可能改，快照会让用户改完还得重开页子。
            syncEmbedCookies: () => this.syncEmbedCookies(),
            // 「全屏①」= 交接给内置播放器标签页（用户 2026-11-06「再点全屏进入该原播放器标签页」）
            onOpenPlayerTab: (info) => void this.handOffEpisodeToPlayer(entry, info),
            // 🔴 播放断点表的**只读副本**（`key` = 剧集下标字符串，值 = 秒）。
            //    右栏底部「观看进度」微件的「继续观看」要拿历史断点：
            //    基类把 `initialPositions` 存成 **private**（子类读不到），而微件又不能自己读库
            //    ⇒ 由宿主在这里透一份，页面侧只读、⛔ 不写（写回仍走 `onSavePosition` 那条唯一通路）。
            //    ⚠️ 用拷贝而不是直接塞 `entry.videoPositions`：playlist 对象是库里的活引用，
            //      页面持着它万一哪天顺手改了，就是绕过 service 的隐式写库。
            positions: entry.videoPositions ? { ...entry.videoPositions } : undefined,
            // ③ 单集评价（用户 m00002）：与 `positions` 同一手法 —— 透一份**拷贝**，
            //    页面侧只读，写回走 `onSaveReview`。⛔ 别直接塞 `entry.episodeReviews`：
            //    那是库里的活引用，页面顺手一改就绕过 `service.update`（catalog 变了、笔记没变）。
            reviews: entry.episodeReviews ? { ...entry.episodeReviews } : undefined,
            onSaveReview: (epKey, review) => void this.persistEpisodeReview(entry.id, epKey, review),
        };
        const marks = await this.service.readNoteMarks(entry.id);
        const opts: EpisodePageOptions = {
            page,
            entryTitle: entry.title,
            items,
            startIndex: pos >= 0 ? pos : 0,
            single: entry.type === 'movie',
            pendingSeek: seekSec !== undefined && seekSec > 0 ? { index: startIdx, seconds: seekSec } : undefined,
            onExternalFallback: (path) => void this.openWithSystemPlayer(path),
            entryId: entry.id,
            initialPositions: entry.videoPositions,
            onSavePosition: (key, seconds) => void this.persistVideoPosition(entry.id, key, seconds),
            listSubtitles: (videoPath) => this.listSubtitleCandidates(videoPath),
            loadSubtitleVtt: (subPath) => this.readSubtitleAsVtt(subPath),
            pickSubtitleFile: () => this.pickSubtitleFromSystem(),
            initialSubtitles: entry.subtitlePaths,
            onSaveSubtitle: (key, subPath) => void this.persistSubtitlePath(entry.id, key, subPath),
            marks,
            markImageUrl: (image: string) => this.resolveNoteImageUrl(image, entry),
            onOpenMarkNote: (mark: VideoMark) => this.openNoteAtMark(entry, mark),
            onInsertStamp: (info) => this.insertVideoStamp(entry, info),
            stampPreviewText: (info) => this.stampPreviewTextOf(entry, info),
            onCaptureShot: (info) => this.saveVideoShot(entry, info),
            onOpenNote: async () => { await this.openVideoNote(entry); },
            ...this.playerSwitchOptions(),
        };
        await this.openEpisodePage(opts);
    }

    /**
     * 建整剧「可内嵌」播放列表（跳过不可内嵌 / 解析失败的集；**保留真实集下标** `index`）。
     * 🔴 抽成一份：`openEpisodeLocal` 与 `openEpisodePageFor` 都吃它 —— 两处各写一遍必然漂
     *    （漂了就是「观看」能播、「选集页」少几集这种鬼故事）。
     */
    private buildEmbedItems(entry: MediaEntry): EmbedVideoItem[] {
        const all = entry.episodeFiles ?? [];
        const items: EmbedVideoItem[] = [];
        for (let i = 0; i < all.length; i++) {
            const path = all[i];
            if (!path || !isEmbeddableVideoPath(path)) continue;
            const url = this.resolveEmbedUrl(path);
            if (!url) continue;
            items.push({ index: i, title: entry.episodeTitles?.[i], url, path, isFirst: false, isLast: false });
        }
        items.forEach((it, k) => {
            it.isFirst = k === 0;
            it.isLast = k === items.length - 1;
        });
        return items;
    }

    /**
     * 回到「原来那个选集页」（用户 2026-11-06 两页互跳的另一半：播放器页点全屏 ⇒ 回选集页）。
     *
     * 🔴 必须**按条目 id 复用**已打开的那一页，⛔ 不能调 `openEpisodePageFor` 新开：
     *    那会每点一次多一个标签页，用户原话是「返回到新播放器页面 / 进入原来的播放器页面」——
     *    要的是**换回去**，不是再开一个。
     * ⚠️ 找不到（用户已关掉那页）⇒ 兜底现开一页，⛔ 别什么都不做（按钮点了没反应比多一页更糟）。
     *
     * 🔴 必须先退全屏，再调 `setActiveLeaf(leaf, ${focus:true})`（2026-11-06 真机实测根因）：
     *    ⑴ 播放器页此刻占着 `document.fullscreenElement`，全屏容器里的切换**会被吞掉**；
     *    ⑵ 光是 `revealLeaf(leaf)` **不够** —— 真机实测两种写法都是
     *       `activeLeaf 仍为 VideoPlayerView`（`_probe_afterback.mjs` / `_probe_reveal.mjs`），
     *       ⇒ `setActiveLeaf(leaf, ${ focus: true })` 一次就切过去了（`_probe_afterback2.mjs`）
     *    ⇒ 顺序固定为：① exitFullscreen（await，失败静默）→ ② setActiveLeaf(focus) → ③ revealLeaf（兜底保证页可见）。
     *    ⛔ 别只留 revealLeaf：那正是本 bug 的原样。
     *
     * 🔴 2026-11-09 用户逐字：「播放器全屏为标签页时再返回详情页时怎么不能播放而是直接显示为
     *    这集没有本地视频的」⇒ 回跳必须带上「这一集是网络集」这件事（`net`）。
     *    原来只传 `index`/`seconds`，`openEpisodePageFor` 收不到 `netStart`，而它只在
     *    `urls.length === 1` 时才兜底 —— 多集网络条目回跳后既不进内嵌态、也没有本地文件可播
     *    ⇒ 基类点亮「这一集没有本地视频」。真机实测：回跳后 `netIndex` 不存在、`readyState=0`。
     */
    private backToEpisodePage(entry: MediaEntry, index: number, seconds: number, net = false): void {
        // 优先回到「交接前记下的那片叶子。
        // 🔴 2026-11-09：交接现*占用选集页那片叶*（同 leaf `setViewState` 成播放器页）
        //    换视图后旧选集页实例已销下面那个 `getLeavesOfType` 循环永远找不到它。
        //    所以必须先走这里：把同一片叶子换回选集页，再让 `openEpisodePageFor` 就地重绘
        // ⚠️ 判据 `origin.view instanceof VideoPlayerView`：那片叶子若已被用户拿去开笔记/别的视图
        //    就不能强行抢占（会把用户正在看的东西顶掉）交给下面的兜。
        const origin = this.episodeOriginLeaf.get(entry.id) ?? null;
        if (origin && origin.view instanceof VideoPlayerView) {
            void (async () => {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen?.();
                } catch {
                    // 退全屏失败不阻断：下面仍会切页
                }
                try {
                    this.app.workspace.setActiveLeaf(origin, { focus: true });
                    await origin.setViewState({ type: EPISODE_PAGE_VIEW_TYPE, active: true });
                } catch {
                    // 叶子已被关掉 / API 差异：退回下面「现开一页」那条路
                }
                // 🔴 网络集必须把「这一集是网络集」继续往下传（`netStart = index`）：
                //    否则 `openEpisodePageFor` 只会按本地集路径走，`startPath` 为空。
                //    `items` 也为基类点亮「这一集没有本地视频。
                await this.openEpisodePageFor(entry, index, seconds > 0 ? seconds : undefined, false,
                    net ? index : undefined);
            })();
            return;
        }
        const leaves = this.app.workspace.getLeavesOfType(EPISODE_PAGE_VIEW_TYPE);
        for (const leaf of leaves) {
            const v = leaf.view;
            if (v instanceof EpisodePageView && v.currentEntryId() === entry.id) {
                void (async () => {
                    // 退全屏：全屏容器里切页会被吞掉。
                    try {
                        if (document.fullscreenElement) await document.exitFullscreen?.();
                    } catch {
                        // 退全屏失败不阻断：下面两步仍会尝试切页
                    }
                    // 真正切焦点（revealLeaf 不换焦点，见上方注释。
                    try {
                        this.app.workspace.setActiveLeaf(leaf, { focus: true });
                    } catch {
                        // 老版API 差异：失败就退revealLeaf
                    }
                    // 保住页可见（分栏折叠 / 被别的标签盖住时。
                    await this.app.workspace.revealLeaf(leaf);
                })();
                return;
            }
        }
        // 原来那页已经被关掉：按当前集现开一页（集号与秒数都带回去，别让用户从头找）
        // 🔴 网络集同样要`netStart`（理由见方法头注释）：不带就会开出一。
        //    「这一集没有本地视频」的空壳。
        void this.openEpisodePageFor(entry, index, seconds > 0 ? seconds : undefined, false,
            net ? index : undefined);
    }

    /**
     * 🔴 #691（2026-10-27）：在内置播放器视图里打开视频（工作区新标签页，Media Extended 式）。
     *  关闭语义 = 关标签页：点视频区黑边 / 「外部打开」/ 解码失败兜底都走视图内部。 */
    private async openVideoPlayer(opts: VideoPlayerOptions, reuseLeaf?: WorkspaceLeaf | null): Promise<void> {
        const workspace = this.app.workspace;
        const active = workspace.activeLeaf;
        // 🔴 必须排除选集页：`EpisodePageView extends VideoPlayerView`，只判基类会把正在显示的
        //    选集页认成「播放器已打开」⇒ 原地重绘、不换页。交接（`handOffEpisodeToPlayer`）正。
        //    从选集页触发的，漏这一句就等于「点了全屏，页面没变」（2026-11-06 真机实测 8/9 的根因）
        //    `openEpisodePage` 里「先选集页后播放器」是同一类坑的两个方。
        // 🔴 2026-11-09 用户逐字：「播放器全屏按钮点击后怎么是新开一个标签页给我覆盖成当前标签页，
        //    选集页交接过来时由调用方传入 `reuseLeaf`（就是那张选集页所在的叶子）
        //    这里*同一片叶*`setViewState` 换视标签页数量不变，观感是「原地翻页。
        //    ⚠️ 不能靠上面那`active.view instanceof VideoPlayerView` 自己命中：选集页就。
        //    `VideoPlayerView` 的子类，被刻意排除了（否则会原地重绘、不换页，就是那个bug。
        let leaf = reuseLeaf ?? (active && active.view instanceof VideoPlayerView && !(active.view instanceof EpisodePageView)
            ? active
            : null);
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIDEO_PLAYER_VIEW_TYPE, active: true });
        } else if (!(leaf.view instanceof VideoPlayerView) || leaf.view instanceof EpisodePageView) {
            // 同一片叶子换视图：先 setViewState 才能拿到新的 VideoPlayerView 实例
            // ⚠️ 判据里点名排除选集不排除的话这里会「认为已经是播放器」而不换。
            //    交接就变成原地重绘（同上那个bug 的复现路径）
            await leaf.setViewState({ type: VIDEO_PLAYER_VIEW_TYPE, active: true });
        }
        // 🔴 用户 2026-11-01：「时间戳列表没有标记」。
        //    根因之二：详情页那条路（`openEpisodePageFor`）会 `readNoteMarks` 后把 `marks` 塞进
        //    opts，但播放器页这三个调用点（本地交/ 网络交接 / 裸文件）**一个都没传**。
        //    播放器页刚打开`opts.marks === undefined`，抽屉必0 行，要等插入时间戳或。
        //    vault 事件才「突然」出现。⇒ 在这里统一兜一次，谁调用都拿得到已有标记。
        //    ⚠️ 只在调用方没给的时候读：调用方明确传了（哪怕是空数组）就以调用方为准，
        //    否则会把它刚算好的列表又覆盖一遍。
        if (!opts.marks && opts.entryId) {
            try {
                opts.marks = await this.service.readNoteMarks(opts.entryId);
            } catch (e) {
                // 笔记读不出来不该挡住播放：抽屉空着也比整页打不开。
                console.warn('[reelludic] 读取时间戳标记失败：', e);
            }
        }
        const view = leaf.view;
        if (view instanceof VideoPlayerView) {
            view.openWith(opts);
        }
        // 播放器互斥（④-4）：视频起播 ⇒ 让内置音频播放器停声（真源 pure/audioQueue.playersToPause）
        this.pauseOtherPlayers('video');
    }

    /**
     * 🔴 #691：打开 **B 站风选集页**（独立标签页）。
     *
     * 🔴 复用口径（与 `openVideoPlayer` 同构，但**按新视图类型判等**，⛔ 不拿 `VideoPlayerView` 判）：
     *    活动页已经是选集页 ⇒ 原地换片（点相关推荐连着换季不该刷出十个标签页）；
     *    否则开一个新标签页 —— 用户要的是「新增一个页面」，⛔ 不能把当前播放器标签页顶掉。
     *    ⚠️ `EpisodePageView extends VideoPlayerView` ⇒ 判等顺序**必须**先选集页后播放器，
     *       反过来会把选集页当成普通播放器 `openWith`（没有 `page` 上下文 = 画成空壳）。
     */
    private async openEpisodePage(opts: EpisodePageOptions): Promise<void> {
        const workspace = this.app.workspace;
        const active = workspace.activeLeaf;
        let leaf = active && active.view instanceof EpisodePageView ? active : null;
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: EPISODE_PAGE_VIEW_TYPE, active: true });
        }
        const view = leaf.view;
        if (view instanceof EpisodePageView) {
            view.openWithPage(opts);
        }
        // 播放器互斥：选集页里的播放器也是「视频」这一停掉内置音频播放。
        this.pauseOtherPlayers('video');
    }

    /**
     * 打开 **Flash 游戏播放页**（独立标签页）。
     *
     * 🔴 2026-11-16 用户逐字：「要独立标签页运行而不是弹窗运行」——改前的 `FlashGameModal` 是
     *    工作区模态弹窗（会盖住整窗、Esc 就没了），用户要的是和视频播放器一样能并排、能切走再切回。
     *
     * 复用口径（与 `openEpisodePage` 同构，但**按条目等**）：
     *   · 已有同一游戏的页 ⇒ 直接 `revealLeaf` 把它带到前台，⛔ 不再开第二页（否则连点几下就开一堆）；
     *   · 否则新开一个 tab —— 用户要的是「新增一个页面」，⛔ 不能把当前页顶掉。
     * ⚠️ 视图注册见 `onload` 里的 `registerView(FLASH_GAME_VIEW_TYPE, …)`；删了那行这里拿到的是
     *    `leaf.view` 非 `FlashGameView`（`setViewState` 会因未知类型抛错），别只改这里。
     */
    private async openFlashGame(entry: MediaEntry): Promise<void> {
        const workspace = this.app.workspace;
        // 同游戏已在某页 ⇒ 复用（`entryId()` 是视图自报，⛔ 别从 DOM 反推）
        const existing = workspace
            .getLeavesOfType(FLASH_GAME_VIEW_TYPE)
            .find((l) => l.view instanceof FlashGameView && l.view.entryId() === entry.id);
        let leaf: WorkspaceLeaf;
        if (existing) {
            leaf = existing;
        } else {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: FLASH_GAME_VIEW_TYPE, active: true });
        }
        const view = leaf.view;
        if (view instanceof FlashGameView) {
            view.openWith({ entry });
        }
        // `revealLeaf` 在某些版本/布局下不存在（`typeof` 守卫与 `activateView` 同口径）
        if (typeof workspace.revealLeaf === 'function') workspace.revealLeaf(leaf);
        // Flash 游戏也可能出声 ⇒ 与视频同口径停掉内置音频播放器
        this.pauseOtherPlayers('video');
    }

    /**
     * 「全屏①」的宿主实现：把选集页当前这一集**交接给内置播放器标签页**，并让它全屏。
     *
     * 🔴 用户 2026-11-06 逐字：「再点全屏进入该原播放器标签页」。选集页那颗按钮从此不再
     * 🔴 改前的语义是「本页打 `data-fs`、把右栏和季带藏起来」（窗内样式态）。用户逐字说的是
     *    内置播放器负责放大看。
     *
     * 🔴 两条交接路径（`info.net` 分岔）：
     *  - 本地集：`items` 里按**真实集下标**找那一项（`buildEmbedItems` 只收本地可内嵌文件，
     *    下标与 `episodeFiles` 对齐），把它的 `url` 当普通播放源。
     *  - 网络集：这一集没有本地文件、进不了 `items` ⇒ 先用 `biliStreamFor` 取 CDN 直链，
     *    取不到就回浏览器（⛔ 不留一个空播放器给用户）。
     *
     * 🔴 网络源必须 `netSource: true`：基类 `render()` 默认给 `<video>` 装
     *    `crossOrigin='anonymous'`（本地抓帧免污染 `#326`），B 站 CDN 不回 CORS 头 ⇒ 带着它就是
     *    加载失败、零字节。那个开关同时让它**不写播放位置**（`epKey()` 是本地集下标）。
     *
     * ⚠️ 秒数一律走 `pendingSeek`：那是基类既有的「进场定位」通路（`consumePendingTarget` 消费），
     *    ⛔ 不另造一套「打开后 setTimeout 再 seek」——那会和续播位置打架、还会跳两下。
     * ⚠️ 全屏：先 `openVideoPlayer`（可能新建标签页，`setViewState` 是异步的），拿到视图后
     *    在**这份 leaf 的容器**上 `requestFullscreen`。浏览器要求用户手势，这里还处在点击的
     *    调用栈里，所以能成功；`catch` 掉失败（全屏不是必需，⛔ 别让交接因它中断）。
     */
    private async handOffEpisodeToPlayer(
        entry: MediaEntry,
        info: { index: number; seconds: number; net: boolean; degraded?: boolean },
    ): Promise<void> {
        const seconds = Number.isFinite(info.seconds) && info.seconds > 0 ? info.seconds : 0;
        // 🔴 2026-11-09 用户逐字：「播放器全屏按钮点击后怎么是新开一个标签页给我覆盖成当前标签页，
        //    再点全屏按钮即回到原来播放器页面」⇒ 交接前先记下**选集页此刻所在的叶子**。
        //    让播放器页在同一片叶子上开出来（标签页数量不变），回跳时再换回。
        // ⚠️ 判据必须是选集页：普通播放器视图也满`VideoPlayerView`，认错了就会把用。
        //      以后想再细化某一组就得一路加 id，本仓没有这个先例。
        const origin = this.app.workspace.activeLeaf;
        if (origin && origin.view instanceof EpisodePageView) {
            this.episodeOriginLeaf.set(entry.id, origin);
        }
        const reuse = this.episodeOriginLeaf.get(entry.id) ?? null;
        if (!info.net) {
            const items = this.buildEmbedItems(entry);
            const pos = items.findIndex((it) => it.index === info.index);
            const target = pos >= 0 ? items[pos] : null;
            if (!target) {
                // 这一格既不是网络集、也不在可内嵌清单里（不可解/ 已移除）不假装能。
                new Notice('这一集没有可播放的视频');
                return;
            }
            await this.openVideoPlayer({
                entryTitle: entry.title,
                items,
                startIndex: pos,
                single: entry.type === 'movie',
                pendingSeek: seconds > 0 ? { index: info.index, seconds } : undefined,
                onExternalFallback: (p) => void this.openWithSystemPlayer(p),
                // 🔴 用户 2026-11-06 两页互跳：交接进来的播放器页那颗全屏按钮改义为「回选集页」
                onBackToEpisodePage: (sec) => this.backToEpisodePage(entry, info.index, sec, info.net),
                entryId: entry.id,
                initialPositions: entry.videoPositions,
                onSavePosition: (key, sec) => void this.persistVideoPosition(entry.id, key, sec),
                listSubtitles: (videoPath) => this.listSubtitleCandidates(videoPath),
                loadSubtitleVtt: (subPath) => this.readSubtitleAsVtt(subPath),
                pickSubtitleFile: () => this.pickSubtitleFromSystem(),
                initialSubtitles: entry.subtitlePaths,
                onSaveSubtitle: (key, subPath) => void this.persistSubtitlePath(entry.id, key, subPath),
                onInsertStamp: (i) => this.insertVideoStamp(entry, i),
                stampPreviewText: (i) => this.stampPreviewTextOf(entry, i),
                onCaptureShot: (i) => this.saveVideoShot(entry, i),
                onOpenNote: async () => { await this.openVideoNote(entry); },
                ...this.playerSwitchOptions(),
            }, reuse);
            this.focusPlayerTabFullscreen();
            return;
        }
        // 🔴 2026-11-24 用户裁定：「将网络集用插件播放器播放的全部功能和样式全部从插件移除，
        //    但有官方 iframe 内嵌播放的不要移除」⇒ 播放器页已经没有播网络流的能。
        //    （取/ MSE / 本地代理路由全数删除），网络集只在选集页用官方 iframe 播放。
        //    这里明确拒绝并指路，别保留半条死路（那会让用户看到空的播放器页）。
        new Notice('网络集在选集页用官方播放器播放，不进全屏播放器页');
    }

    /**
     * 交接之后把播放器页切到「标签页全屏」。
     *
     * 🔴 用户 2026-11-09 逐字：「这个播放器的全屏按钮怎么有两种全屏状态啊，
     *    给我改成纯以前的标签页全屏，而不是整个电脑屏幕全屏」
     *    ⇒ 这里**不再调 `containerEl.requestFullscreen()`**（那是整块显示器被接管）。
     *    放大由视图自己用 `contentEl` 上的 `rl-vp-tabfs` 类完成（见 `VideoPlayerView.toggleFullscreen`），
     *    宿主只负责在交接后把它打开一次。
     * ⚠️ 失败静默：放大不是交接的必要条件，用户已经到播放器页了。
     */
    private focusPlayerTabFullscreen(): void {
        const view = this.app.workspace.activeLeaf?.view;
        if (!(view instanceof VideoPlayerView)) return;
        try {
            view.contentEl.addClass('rl-vp-tabfs');
        } catch {
            // 视图已销/ 布局被锁：交接本身已经完成，静默。
        }
    }

    /** 播放器选项 → 视图选项（两处 openVideoPlayer 共用一份，免得缺省口径各写一遍漂掉）。
     *  迁移只在**这里**发生一次（`playModeFromLegacy`），视图只认 `PlayMode` 一种形态。
     *  🔴 #605：「后台播放」**只读传快照**（开关本体已搬到 设置页 › 内置视频播放器 折叠分组，
     *  由设置页直接读写 `playerBgPlay`）—— 故这里**没有** `onToggleSetting` 了。
     *  🔴 2026-11-09：全屏已不在此注入 —— 「标签页全屏」由视图自己切 `rl-vp-tabfs` 类实现
     *  （`VideoPlayerView.toggleFullscreen`），不需要宿主回调。
     *  缺省：后台播放关 / 播放模式 = 列表循环。 */
    private playerSwitchOptions(): Pick<
        VideoPlayerOptions,
        'backgroundPlay' | 'playMode' | 'onSetPlayMode'
    > {
        const legacyAutoNext = this.settings.playerAutoNext !== false;
        const legacyLoopOne = this.settings.playerLoopOne === true;
        return {
            backgroundPlay: this.settings.playerBgPlay === true,
            playMode: this.settings.playerPlayMode
                ? normalizePlayMode(this.settings.playerPlayMode)
                : playModeFromLegacy(legacyAutoNext, legacyLoopOne),
            onSetPlayMode: (mode) => void this.persistPlayMode(mode),
        };
    }

    /** #604 播放模式写回（归一后落盘；落盘失败静默 —— 本次会话已经生效） */
    private async persistPlayMode(mode: PlayMode): Promise<void> {
        this.settings.playerPlayMode = normalizePlayMode(mode);
        try {
            await this.saveSettings();
        } catch {
            // 落盘失败不影响本次会话已生效的模式
        }
    }

    /** 打开单个本地视频（编辑表单「集按钮」）：受设置「内置播放器打开视频文件」控制——
     *  关闭（默认）→ 系统播放器打开文件；开启且 Chromium 可内嵌 → 单集内置弹窗；不可内嵌/解析失败 → 系统播放器
     *
     * 🔴 m07854 ⑧（2026-11-13）用户逐字：「记住每个媒体上次播放位置，重新打开时恢复」。
     *    改前这条入口**既不给 `entryId`、也不给 `initialPositions`/`onSavePosition`** ⇒ 从编辑表单
     *    点开的视频永远从 0 开始，且播完也不留位置（其余入口都有，唯独这条漏了）。
     *    ⚠️ `entry` 可选：本方法另有一处「编辑表单里尚未落库的新条目」可能在 `this.entry` 为空时调用，
     *       那种情况保持改前行为（不记忆），⛔ 不要为它现造一个假 id 去写库。
     *    ⚠️ `index` 缺省 0：单文件条目恒 0，多集条目由表单传入真实集下标（键口径见 `VideoPlayerView.epKey`）。
     */
    async playLocalEpisode(path: string, index = 0, entry?: MediaEntry): Promise<void> {
        if (!path) return;
        // 设置关闭（默认）→ 系统播放器打开文件
        if (!this.settings.internalMediaPlayback) {
            await this.openWithSystemPlayer(path);
            return;
        }
        if (!isEmbeddableVideoPath(path)) {
            await this.openWithSystemPlayer(path);
            return;
        }
        const url = this.resolveEmbedUrl(path);
        if (!url) {
            await this.openWithSystemPlayer(path);
            return;
        }
        // 键由播放器侧`items[0].index` 推出（`VideoPlayerView.epKey()`），这里只需把集下标放进 item
        const item: EmbedVideoItem = { index: Math.max(0, Math.floor(index)), url, path, isFirst: true, isLast: true };
        void this.openVideoPlayer({
            entryTitle: path.split(/[\\/]/).pop() ?? path,
            items: [item],
            startIndex: 0,
            single: true,
            onExternalFallback: (p) => void this.openWithSystemPlayer(p),
            ...this.playerSwitchOptions(),
            // ⚠️ 只有拿到真条目才接记忆：没有 `entry.id` 就写不了库，硬接只会是假成功
            ...(entry
                ? {
                      entryId: entry.id,
                      initialPositions: entry.videoPositions,
                      onSavePosition: (k, sec) => void this.persistVideoPosition(entry.id, k, sec),
                  }
                : {}),
        });
    }

    /** 外部系统播放器打开本地文件（桌面 Electron shell.openPath；不可内嵌格式/解码失败兜底共用） */
    private async openWithSystemPlayer(path: string): Promise<void> {
        if (!Platform.isDesktopApp) {
            new Notice('本地视频播放仅桌面端可用');
            return;
        }
        try {
            // 惰性 require（AGENTS 红线：桌面专用模块不在顶层 import，防移动端崩溃）
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell!.openPath(path);
            if (err) new Notice(`无法打开视频：${err}${err}`);
        } catch {
            new Notice('无法打开本地播放器');
        }
    }

    /**
     * #462：探「本地音频」的**体积 + 时长**（音乐条目编辑表单那颗「播放」按钮的悬停提示用）。
     *
     * 用户原话：「给音乐类型关联到的音频文件鼠标hover提示音频文件时长：如04:25,和体积大小3MB」。
     *
     * 🔴 两条实现口径：
     *  ⑴ **时长靠 Chromium 解码探**（`<audio>` 的 `loadedmetadata` → `duration`），**不自己写容器解析**
     *     —— 与内置播放器走的是**同一条解码路径**（免白名单里的 mp3/flac/m4a/ogg/wav/aac 都能认），
     *     且 URL 复用 `resolveEmbedUrl`（库内 `getResourcePath` / 库外 `app://`），⛔ 别另拼一份。
     *  ⑵ **体积靠 `fs.statSync`**（桌面端；与「库内/库外」无关，走 `absoluteMediaPath` 取系统绝对路径）。
     *
     * ⚠️ 任一失败 ⇒ 该项 `undefined`（**拿不到就不显示那一段**，⛔ 不编造、不写「未知」）；
     *    结果按**路径**缓存（同一文件只探一次；hover 是高频动作，绝不每次重探）。
     */
    async probeAudioInfo(path: string): Promise<MediaInfo> {
        const p = String(path ?? '').trim();
        if (!p) return {};
        const hit = this.audioInfoCache.get(p);
        if (hit) return hit;
        let size: number | undefined;
        try {
            if (Platform.isDesktopApp) {
                const abs = this.absoluteMediaPath(p);
                if (abs) {
                    const fsMod = require('fs') as { statSync(q: string): { size: number } };
                    size = fsMod.statSync(abs).size;
                }
            }
        } catch {
            size = undefined; // 文件不在 / 无权限 ⇒ 只显示时长那一半
        }
        const duration = await this.probeAudioDuration(p);
        const info: MediaInfo = { size, duration };
        this.audioInfoCache.set(p, info);
        return info;
    }

    /** 本地路径 → **系统绝对路径**（vault 内走 `adapter.getFullPath`；库外原样返回）。取不到 ⇒ undefined */
    private absoluteMediaPath(path: string): string | undefined {
        const p = String(path ?? '').trim();
        if (!p) return undefined;
        try {
            const rel = this.toVaultRelPath(p);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) return (this.app.vault.adapter as FileSystemAdapter).getFullPath(f.path);
        } catch { /* 库外 / 取不到 ⇒ 当绝对路径用 */ }
        return p;
    }

    /** 探音频时长（秒）：Chromium `<audio>` 解码一次，拿不到（不可解码 / 超时 4s / 非渲染进程）⇒ undefined */
    private probeAudioDuration(path: string): Promise<number | undefined> {
        const url = this.resolveEmbedUrl(path);
        if (!url || typeof document === 'undefined') return Promise.resolve(undefined);
        return new Promise((resolve) => {
            let settled = false;
            const el = document.createElement('audio');
            const finish = (v?: number): void => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                try { el.removeAttribute('src'); el.load(); } catch { /* 忽略 */ }
                resolve(v);
            };
            const timer = window.setTimeout(() => finish(undefined), 4000);
            el.addEventListener('loadedmetadata', () => {
                const d = el.duration;
                finish(Number.isFinite(d) && d > 0 ? d : undefined);
            });
            el.addEventListener('error', () => finish(undefined));
            el.preload = 'metadata';
            el.src = url;
        });
    }

    /** 解析某本地路径为 <video> 可播 URL：
     *  vault 内 → app.vault.getResourcePath(TFile)；vault 外绝对路径 → app://<appId>/<encodeURIComponent 全路径>。
     *  返回 null = 文件无法定位（vault 外盘符/被移除等），调用方回退系统播放器 */
    /**
     * 把「路径」换成宿主可加载的 URL（库内 → `getResourcePath`，库外绝对 → `app://` 流式）。
     *
     * 🔴 2026-11-16 由 `private` 改为 `public`：Flash 播放弹窗（`FlashGameModal`）要用它把
     * `entry.gameSwf` 与 Ruffle 运行时的插件目录都换成 `app://` URL —— 探针已实测这两类路径
     * 在本宿主都能 fetch 到（wasm 的 MIME 也正确）。⛔ 别在弹窗里自己拼 app://（appId 取法唯一）。
     */
    public resolveEmbedUrl(path: string): string | null {
        try {
            const rel = this.toVaultRelPath(path);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) return this.app.vault.getResourcePath(f);
            // vault 外绝对路径：经 Obsidian app:// 自定义协议流式读取（同 LocalMediaEmbedder 外部文件方案，
            // 无需 http server / 整文件读内存；CSP 已放行 app: scheme）
            const appId = this.appSchemeId();
            if (!appId) return null;
            const norm = path.replace(/\\/g, '/');
            const encoded = norm
                .split('/')
                .map((seg) => encodeURIComponent(seg))
                .join('/');
            return `app://${appId}/${encoded}`;
        } catch {
            return null;
        }
    }

    /** 播放位置写回（节流由播放器负责）：并入 catalog.videoPositions；0 秒/无变化不写；失败静默 */
    private async persistVideoPosition(entryId: string, epKey: string, seconds: number): Promise<void> {
        try {
            if (!/^\d+$/.test(epKey)) return;
            const s = Math.max(0, Math.floor(seconds));
            if (s <= 0) return;
            const e = await this.service.get(entryId);
            if (!e) return;
            const map = { ...(e.videoPositions ?? {}) };
            if (map[epKey] === s) return;
            map[epKey] = s;
            await this.service.update(entryId, { videoPositions: map });
        } catch {
            /* 落库失败静默（不影响观看） */
        }
    }

    /**
     * 字幕路径写回（用户 2026-10-29「字幕要双向持久化」的落库端）：并入 catalog.subtitlePaths。
     *
     * 🔴 与 `persistVideoPosition` 同一形状 —— 按**集号**存，换集即换字幕记忆。
     * ⚠️ `subPath` 传空串 = **清除这一集的记忆**（播放器发现存过的文件丢了会这样调）。
     * ⚠️ 存**原始路径**（库内相对 / 库外绝对都行），⛔ 不在这里做路径规范化：
     *    规范化在读取侧（`readSubtitleAsVtt` 两条通路都试），写入侧多做一步只会多一个漂移点。
     */
    private async persistSubtitlePath(entryId: string, epKey: string, subPath: string): Promise<void> {
        try {
            if (!/^\d+$/.test(epKey)) return;
            const e = await this.service.get(entryId);
            if (!e) return;
            const map = { ...(e.subtitlePaths ?? {}) };
            const next = String(subPath ?? '').trim();
            if (!next) {
                // 清除：没有这条就什么都不做（避免无谓写盘）
                if (!(epKey in map)) return;
                delete map[epKey];
            } else {
                if (map[epKey] === next) return;
                map[epKey] = next;
            }
            await this.service.update(entryId, { subtitlePaths: map });
        } catch {
            /* 落库失败静默（不影响观看） */
        }
    }

    /**
     * ③ 单集评价写回（用户 m00002）：并入 `catalog.episodeReviews`，再让笔记 yaml 跟上。
     *
     * 🔴 与 `persistVideoPosition` / `persistSubtitlePath` 同一形状 —— 按**集号**存。
     * 🔴 两条纪律（少任何一条都会留下「数据在哪一半」的经典脏态）：
     *   ⑴ **归一收口在 `pure/episodeReview.setReviewAt`**：它对空评价（未看+无标签+无心情+无短评）
     *      做的是「删键、整表空了连字段一起没」—— ⛔ 别在这里判「空了就 return」，
     *      那样用户把状态改回「未看」时那一集永远清不掉。
     *   ⑵ **catalog 落完要回写笔记**：`episode_reviews` 是笔记 yaml 里的字段，
     *      只改 catalog 不改笔记，下次打开笔记 `extractFrontmatterFromNote` 会把旧值盖回来
     *      （用户看到的就是「改完自己变回去」）。回写走 `service.writeNote` 的既有通路
     *      （它内部按 `fieldMap`/`fieldOrder` 重排，新键不登记也只会落到末尾，⛔ 不会丢）。
     * ⚠️ 失败静默：评价是观看期的附带记录，写盘失败不该弹窗打断播放。
     */
    private async persistEpisodeReview(entryId: string, epKey: string, review: EpisodeReview): Promise<void> {
        try {
            if (!/^\d+$/.test(epKey)) return;
            const e = await this.service.get(entryId);
            if (!e) return;
            const next = setReviewAt(e.episodeReviews, Number(epKey), review);
            // 归一后与现状完全一致 ⇒ 不写盘（避免每点一次 chip 就改一次 mtime 撞 G 双写冲突）
            const before = JSON.stringify(normalizeEpisodeReviews(e.episodeReviews) ?? {});
            const after = JSON.stringify(next ?? {});
            if (before === after) return;
            await this.service.update(entryId, { episodeReviews: next });
            // 笔记 yaml 跟上：`writeNote` 是唯一重写出口（它按 `fieldMap`/`fieldOrder` 重排，
            // 新键没登记只会落到末尾，⛔ 不会丢），并且会搬回用户手写的标注区。
            // ⚠️ 只改 catalog 不回写笔记 = 下次打开笔记时旧值盖回来（用户看到「改完自己变回去」）。
            await this.service.writeNote(entryId);
        } catch {
            /* 落库失败静默（不影响观看） */
        }
    }

    /**
     * 视频文件的**系统绝对路径**（库内 = vault 根 + 相对路径；库外 = 原样）；解析失败返回空串。
     *
     * 🔴 与 `videoAbsDir` 的差别只有「留不留文件名」，但用途完全不同：
     *    `videoAbsDir` 给字幕同目录扫描用，这个给**外部程序**（ffmpeg / whisper）用 ——
     *    它们要的是一个能 `open()` 的文件，⛔ 不是目录。
     * ⚠️ 库内路径**必须**经 `getAbstractFileByPath` 判一次：同一个字符串既可能是库内相对路径，
     *    也可能恰好长得像系统路径，只有宿主知道它到底在哪。
     */
    private videoAbsPath(videoPath: string): string {
        try {
            const rel = this.toVaultRelPath(videoPath);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) {
                const adapter = this.app.vault.adapter as FileSystemAdapter;
                const base = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
                return base ? `${base}/${rel}` : '';
            }
            return videoPath;
        } catch {
            return '';
        }
    }

    /**
     * 设置页那一行的状态文案（「未配置引擎」/「已就绪（当前引擎：均衡版 · 约 141MB）」）。
     *
     * 🔴 判断口径只有一条：`asrModelPath` 非空**且文件真的在**才算就绪。
     *    只看路径非空会在用户删了文件之后仍然宣称就绪，然后转写时才炸 ——
     *    用户需求里明令「没有模型是正常状态，不能报错」，那就更不能撒谎说已就绪。
     * ⚠️ 认不出是哪一档（用户手填了自己的 ggml）⇒ 只说「已就绪（自定义模型）」，
     *    ⛔ 不猜档位、不显示体积（体积拿不到，编一个会更糟）。
     */
    /**
     * 当前选中的那家引擎是否就绪（设置页顶部状态行 / 转写前置检查共用）。
     * ⚠️ 只是 `asrEngineStatusOf` 的薄封装 —— 单卡片的绿标由后者按卡片的引擎分别查。
     */
    asrEngineStatus(): { ready: boolean; label: string } {
        return this.asrEngineStatusOf(this.settings.asrEngine);
    }

    /**
     * 任意一家引擎的就绪状态。`rawEngine` 可以是 `whisper` / `qwen3` / `sensevoice`，
     * 认不出来的值由 `engineDefOf` 回落成 `whisper`（⛔ 不抛错）。
     *
     * 🔴 为什么拆出这一版：设置页改成三张卡片后，**每张卡都要显示自己的绿标**，
     *    而 `asrEngineStatus()` 只认「当前选中的那家」——拆卡片却复用它是功能倒退。
     */
    asrEngineStatusOf(rawEngine: string | undefined): { ready: boolean; label: string } {
        // 🔴 引擎不同，就绪判据完全不同：
        //    whisper 模型文件真在；桥接系 解释器与脚本**两个**文件都真在。
        //    sherpa 系（SenseVoice / Paraformer / X-ASR）⇒ 程序 + 模型 + 词表 断句模型）缺一不可。
        //    Confucius4 运行+ 语言模型 + 投影器三件齐。
        //    只看「路径非空」会在文件被删后仍宣称就绪，转写时才—用户需求明。
        //    「没装引擎是正常状态、不能报错」，那就更不能撒谎说已就绪。
        const engine = engineDefOf(rawEngine);
        // 🔴 六家都要 ffmpeg：whisper 用它抽音轨，其余五家的执行层同样在用。
        //    原来完全不查 ffmpeg 用户明明装了，卡片还是「未配置」（m05462 的抱怨根源之一）。
        const ff = this.asrAutoDetect().ffmpeg;
        if (engine.id === 'sensevoice') {
            // 极速版sherpa-onnx C++ CLI：程+ 模型 + 词表**三个**文件缺一不可。
            const p = this.asrEnginePaths('sensevoice');
            if (!p.program || !p.model || !p.extra) {
                return { ready: false, label: `未配置引擎（${engine.title}需要程序、模型、词表三个文件）` };
            }
            const ok =
                this.fileNonEmpty(this.videoAbsPath(p.program) || p.program) &&
                this.fileNonEmpty(this.videoAbsPath(p.model) || p.model) &&
                this.fileNonEmpty(this.videoAbsPath(p.extra) || p.extra);
            if (!ok) return { ready: false, label: '未配置引擎（上次填的程序、模型或词表已经不在了）' };
            if (!ff) return { ready: false, label: '未配置引擎（还需要 ffmpeg，用于把视频里的声音抽出来）' };
            return { ready: true, label: `已就绪（当前引擎：${engine.title}）` };
        }
        // 🔴 需4~6 个文件的引擎（Paraformer / X-ASR / Confucius4）统一走这条。
        //    逐个 stat，缺哪个就说哪个，⛔ 别只报一句「未配置」让用户自己猜。
        const files = this.asrEnginePaths(engine.id).files;
        if (files) {
            const missing = Object.entries(files).filter(
                ([, v]) => !v || !this.fileNonEmpty(this.videoAbsPath(v) || v),
            );
            if (missing.length > 0) {
                const names: Record<string, string> = {
                    program: '识别程序',
                    model: '识别模型',
                    extra: "投影器",
                    tokens: '词表',
                    vad: '断句模型',
                    encoder: "编码器",
                    decoder: "解码器",
                    joiner: "连接器",
                };
                const which = missing.map(([k]) => names[k] ?? k).join('、');
                return { ready: false, label: `未安装（${engine.title}还缺${which}）` };
            }
            if (!ff) return { ready: false, label: '未配置引擎（还需要 ffmpeg，用于把视频里的声音抽出来）' };
            return { ready: true, label: `已就绪（当前引擎：${engine.title}）` };
        }
        if (engine.runner !== 'whisper') {
            const p = this.asrEnginePaths('qwen3');
            const py = String(this.settings.asrPythonPath ?? '').trim();
            const sh = String(this.settings.asrBridgeScript ?? '').trim();
            if (!py || !sh) return { ready: false, label: `未配置引擎（${engine.title}需要你自己准备好本地程序）` };
            const pyOk = this.fileNonEmpty(this.videoAbsPath(py) || py);
            const shOk = this.fileNonEmpty(this.videoAbsPath(sh) || sh);
            if (!pyOk || !shOk) {
                return { ready: false, label: "未配置引擎（上次填的程序或脚本已经不在了）" };
            }
            if (!ff) return { ready: false, label: '未配置引擎（还需要 ffmpeg，用于把视频里的声音抽出来）' };
            return { ready: true, label: `已就绪（当前引擎：${engine.title}）` };
        }
        const raw = String(this.settings.asrModelPath ?? '').trim();
        // 🔴 框里没模型：模型是插件自己下到固定目录（现在*插件目录**下的 `models/`）的。
        //    用户下完 ggml-base.bin 却看到「未配置引擎（首次使用将引导下载）」正m05462 的抱怨。
        //    所以框里空时先去那个固定目录把现成的档位找回来。
        const autoModel = this.asrModelAuto();
        if (!raw && !autoModel) return { ready: false, label: '未配置引擎（首次使用将引导下载）' };
        const abs = this.videoAbsPath(raw) || raw;
        const ok = raw ? this.fileNonEmpty(abs) : this.fileNonEmpty(autoModel);
        if (!ok) return { ready: false, label: '未配置引擎（上次使用的模型文件已不在了）' };
        // 🔴 模型在了，但 whisper-cli / ffmpeg 少一个照样转不了 —就绪必须三件齐。
        //    这两个「程序」通常不用用户填：自动探测会去 PATH 与常见安装位置找。
        if (!this.asrAutoDetect().whisper) {
            return { ready: false, label: "未配置引擎（还需要 whisper.cpp 程序，可在下方一键安装）" };
        }
        if (!ff) return { ready: false, label: '未配置引擎（还需要 ffmpeg，用于把视频里的声音抽出来）' };
        const preset = presetByFileName(raw || autoModel);
        if (!preset) return { ready: true, label: '已就绪（当前引擎：自定义模型）' };
        return { ready: true, label: `已就绪（当前引擎：${preset.title} · 约 ${presetSizeLabel(preset)}）` };
    }

    /**
     * 自动找回「插件自己下过的那份模型」。
     *
     * 🔴 存在的理由（用户 m05462）：模型下载器把文件放在 `~/.reelludic/models/ggml-*.bin`，
     *    但它**不会**往 `asrModelPath` 里写 —— 只有走弹窗的「下载并启用」才写。于是用户
     *    手动点过下载、或换过一次档之后，设置框是空的，状态就判成「未配置」，逼他去抄路径。
     * 口径：只在 `asrModelPath` 为空时才调用；按 `ASR_MODEL_PRESETS` 顺序取第一个**字节数对得上**
     *    的档位，⛔ 不拿半截文件充数（`.part` 也算不上，它名字不同）。
     */
    private asrModelAuto(): string {
        for (const preset of ASR_MODEL_PRESETS) {
            const dest = this.asrModelPathOf(preset);
            if (!dest) continue;
            try {
                const fsMod = require('fs') as { statSync: (p: string) => { size: number } };
                const size = fsMod.statSync(dest).size;
                if (downloadLooksComplete(size, preset.bytes)) return dest;
            } catch {
                // 这一档没下过，看下一。
            }
        }
        return '';
    }

    /** 文件存在且非空（状态判据唯一实现，⛔ 别在两处各写一遍 try/catch） */
    private fileNonEmpty(abs: string): boolean {
        if (!abs) return false;
        try {
            const fsMod = require('fs') as { statSync: (p: string) => { size: number } };
            return fsMod.statSync(abs).size > 0;
        } catch {
            return false;
        }
    }

    /**
     * 一次性把**库外旧目录**（`~/.reelludic/models` 与 `~/.reelludic/bin`）整体搬进插件目录
     * （幂等，可重复跑）。
     *
     * 🔴 用户 2026-11-10 裁定：「给所有模型下载目录换成插件文件夹根目录而不是 c 盘用户根目录」
     *    ⇒ 默认落点从 `C:\Users\<你>\.reelludic\` 改为 `<库>/.obsidian/plugins/obsidian-reelludic/`。
     *    不迁移的话，用户升级后会看到「明明下过 400MB 却说没下载」，只能重下。
     *
     * ⚠️ 与 `migrateAsrModelLayout` 的分工（⛔ 别合并成一个大函数）：
     *    · 那个管「同一个 models 根目录里的**子目录布局**」（根 → `<engine>/`）；
     *    · 这个管「**整个 base 目录换地方**」（库外 → 插件目录）。
     *    两者可叠加：先换 base（本函数），再在新 base 里做布局归一（那次），顺序不能反
     *    —— 反了就会把库外的文件搬进一个马上要被换掉的 base。
     *
     * ⚠️ 四条安全约束（缺一条都可能毁数据，都是用户明确要求「成功后删旧目录」才敢加的最后一条）：
     *   ① 只在**目标不存在**时搬 —— 目标已有说明用户已经在新位置重下过，别覆盖。
     *   ② 逐文件搬，**搬完立即校验字节数一致**，不一致就当没搬成功（不删源）。
     *   ③ 任何一步失败都**静默跳过** —— 迁移是尽力而为，绝不能因为它抛错卡住插件加载。
     *   ④ **只有整个旧目录搬空后才删它**（`rmdirSync` 非递归，剩一个文件就失败 ⇒ 留着）。
     *      绝不 `rm -rf`：那会连带删掉用户自己塞进来的、我们不认识的文件。
     */
    private migrateLegacyAsrDirs(): void {
        try {
            const own = this.pluginDir();
            if (!own) return; // 拿不到插件目录（移动端 / 适配器差异）⇒ 不迁，仍走旧路径
            const fsMod = require('fs') as {
                existsSync: (p: string) => boolean;
                mkdirSync: (p: string, o: { recursive: boolean }) => void;
                renameSync: (a: string, b: string) => void;
                copyFileSync: (a: string, b: string) => void;
                unlinkSync: (p: string) => void;
                rmdirSync: (p: string) => void;
                statSync: (p: string) => { size: number; isFile: () => boolean };
                readdirSync: (p: string) => string[];
            };
            const pathMod = require('path') as {
                join: (a: string, b: string) => string;
                dirname: (p: string) => string;
            };

            /** 把 srcDir 下的内容整体搬到 destDir；全部成功且 srcDir 已空时删掉空的 srcDir */
            const moveTree = (srcDir: string, destDir: string): void => {
                if (!srcDir || !destDir) return;
                if (srcDir.replace(/[\\/]+$/, '') === destDir.replace(/[\\/]+$/, '')) return;
                let names: string[] = [];
                try {
                    if (!fsMod.existsSync(srcDir)) return;
                    names = fsMod.readdirSync(srcDir);
                } catch {
                    return;
                }
                if (names.length === 0) {
                    // 空目录也清掉：不让用户以为「C 盘还留着 .reelludic。
                    try {
                        fsMod.rmdirSync(srcDir);
                    } catch {
                        /* 删不掉就算了，不是错误 */
                    }
                    return;
                }
                for (const name of names) {
                    const from = pathMod.join(srcDir, name);
                    const to = pathMod.join(destDir, name);
                    try {
                        if (!fsMod.existsSync(from)) continue;
                        if (!fsMod.statSync(from).isFile()) {
                            // 下钻一层（`<engine>/` 这种子目录），递归。
                            moveTree(from, to);
                            continue;
                        }
                        if (fsMod.existsSync(to)) continue; // 目标已有：用户已重下，别覆盖
                        fsMod.mkdirSync(pathMod.dirname(to), { recursive: true });
                        try {
                            fsMod.renameSync(from, to); // 同盘：瞬间完成
                        } catch {
                            // 跨盘 rename 会抛 EXDEV 退回复校验+删源。
                            fsMod.copyFileSync(from, to);
                            if (fsMod.statSync(to).size !== fsMod.statSync(from).size) {
                                try {
                                    fsMod.unlinkSync(to);
                                } catch {
                                    /* 清掉半截目标失败也只能留着，下次跑还会判「目标已有」跳过 */
                                }
                                continue; // 字节不一致：当没搬成功，源留着
                            }
                            fsMod.unlinkSync(from);
                        }
                    } catch {
                        // 单文件失败不影响其余。
                    }
                }
                // 只有搬空才删（非递归：还剩一个就不动它）
                try {
                    if (fsMod.readdirSync(srcDir).length === 0) fsMod.rmdirSync(srcDir);
                } catch {
                    /* 非空 / 被占用：留着，下次启动再试 */
                }
            };

            const newModels = `${own}/models`;
            const newBin = `${own}/bin`;
            moveTree(this.legacyAsrModelDir(), newModels);
            moveTree(this.legacyAsrBinDir(), newBin);
            // 两个子目录都空了 顺手`~/.reelludic` 这个空壳也收掉（非递归，绝不误删）
            try {
                const root = pathMod.dirname(this.legacyAsrModelDir());
                if (root && fsMod.existsSync(root) && fsMod.readdirSync(root).length === 0) fsMod.rmdirSync(root);
            } catch {
                /* 还有别的残留就别删 */
            }
        } catch {
            // 整体失败静默：迁移是尽力而为，卡住插件加载比不迁移严重得。
        }
    }

    /**
     * 一次性把散在 `models/` 根目录的旧模型挪进各自子目录（幂等，可重复跑）。
     *
     * 🔴 2026-11-06 m09819 用户报障：「三家模型下载在目录怎么不区分，只有 Models 文件夹
     *    都不知道哪个是哪个」。根因是旧实现让 whisper 直接铺在根下，另两家在子目录，
     *    于是同一层既躺着 `ggml-base.bin` 又躺着 `model.int8.onnx` / `tokens.txt`。
     *    改法是三家一律 `models/<engine>/`（见 `asrEngineDir`），这里负责把**已经下好**的
     *    旧文件搬过去 —— 不搬的话用户升级后会看到「明明下过却说没下载」，只能重下几百 MB。
     *
     * ⚠️ 三条安全约束（缺一条都可能毁数据）：
     *   ① 只在**目标不存在**时搬 —— 目标已有说明用户已经在新布局下重下过，别覆盖。
     *   ② 只在**源文件看起来是完整的那个尺寸**时搬 —— 半截文件（`.part` 残留、下载中断）
     *      搬过去会让自检把「坏的」当成「已就绪」。whisper 用 `downloadLooksComplete` 判，
     *      SenseVoice 的 token 与 onnx 用精确字节比。
     *   ③ 任何一步失败都**静默跳过** —— 迁移是尽力而为，绝不能因为它抛错就卡住插件加载。
     *      用户最多重下一次，比插件起不来好得多。
     */
    private migrateAsrModelLayout(): void {
        try {
            const base = this.asrModelDir();
            if (!base) return;
            const pathMod = require('path') as {
                join: (a: string, b: string) => string;
                dirname: (p: string) => string;
            };
            const fsMod = require('fs') as {
                existsSync: (p: string) => boolean;
                mkdirSync: (p: string, o: { recursive: boolean }) => void;
                renameSync: (a: string, b: string) => void;
                statSync: (p: string) => { size: number };
            };
            const oldOf = (name: string): string => pathMod.join(base, name);
            /** 目标不存在：建目录后把源 rename 过去。返回是否真搬了 */
            const move = (name: string, destDir: string): boolean => {
                const from = oldOf(name);
                const to = pathMod.join(destDir, name);
                if (from === to) return false; // 自定义目录已经就是子目录的情形（防御）
                try {
                    if (!fsMod.existsSync(from)) return false;
                    if (fsMod.existsSync(to)) return false; // 目标已有，不搬
                    fsMod.mkdirSync(pathMod.dirname(to), { recursive: true });
                    fsMod.renameSync(from, to);
                    return true;
                } catch {
                    return false; // 尽力而为
                }
            };

            // ── whisper：只在尺寸对得上时才搬（半截的留下，让自检如实报「未下载」）──
            const whisperDir = this.asrEngineDir('whisper');
            if (whisperDir) {
                for (const preset of ASR_MODEL_PRESETS) {
                    const from = oldOf(preset.fileName);
                    try {
                        if (!fsMod.existsSync(from)) continue;
                        const size = fsMod.statSync(from).size;
                        if (!downloadLooksComplete(size, preset.bytes)) continue; // 半截，别用
                    } catch {
                        continue;
                    }
                    move(preset.fileName, whisperDir);
                }
            }

            // ── SenseVoice：模+ 词表，按精确字节判完──
            const svDir = this.asrEngineDir('sensevoice');
            if (svDir) {
                for (const v of SENSEVOICE_VARIANTS) {
                    const from = oldOf(v.modelFile);
                    try {
                        if (!fsMod.existsSync(from)) continue;
                        if (fsMod.statSync(from).size !== v.bytes) continue;
                    } catch {
                        continue;
                    }
                    move(v.modelFile, svDir);
                }
                try {
                    const from = oldOf('tokens.txt');
                    if (fsMod.existsSync(from) && fsMod.statSync(from).size === 315894) move('tokens.txt', svDir);
                } catch {
                    // 词表搬不动就算了，自检会如实报。
                }
            }

            /**
             * 🔴 搬完必须回头收拾设置里那*指向已搬走文*的绝对路径。
             *
             * 不收拾的话用户会遇到最费解的一种状态：模型明明在磁盘上（在新子目录里）。
             * `data.json` `asrModelPath` 还指着旧位自检读那个死路径。
             * 报「未配置引擎」，而自动探*永远不会被走*（因为设置非空）。
             * 表现就是「我明明下过，它说没有」—比不迁移更糟。
             *
             * 判据：设置里非空 该路径确实不存在 同名的文件在**新位*存在
             *      清空该设置，交还给自动探测（不是写死新路径，那会换个机器又失效）。
             */
            const dropStale = (key: 'asrModelPath' | 'asrSenseVoiceModelPath' | 'asrTokensPath', newDir: string, fileName: string): void => {
                if (!newDir) return;
                const saved = String(this.settings[key] ?? '').trim();
                if (!saved) return;
                try {
                    if (fsMod.existsSync(saved)) return; // 用户指的地方还在，别动
                    if (!fsMod.existsSync(joinDir(newDir, fileName))) return; // 新位置也没有，交给自检如实报缺
                } catch {
                    return;
                }
                this.settings[key] = '';
            };
            if (whisperDir) {
                for (const preset of ASR_MODEL_PRESETS) dropStale('asrModelPath', whisperDir, preset.fileName);
            }
            if (svDir) {
                for (const v of SENSEVOICE_VARIANTS) dropStale('asrSenseVoiceModelPath', svDir, v.modelFile);
                dropStale('asrTokensPath', svDir, 'tokens.txt');
            }
        } catch {
            // 整个迁移是尽力而为，⛔ 绝不因为这里出错就影响插件加。
        }
    }

    /**
     * 自动定位 whisper-cli 与 ffmpeg 的真实路径。
     *
     * 🔴 为什么要有这个（用户 m05462 原话：「下载了 whisper.cpp·ggml-base，怎么还有剩下的框要我
     *    选择啊我怎么知道在哪里配置」）：原来的就绪判据看的是「输入框填没填」，于是
     *    **ffmpeg 明明已经在 PATH 里、模型明明已经被插件下到固定目录，卡片还是「未配置」**，
     *    逼用户去猜路径。这次改成「先看系统里有没有」，框只在真找不到时才要人填。
     *
     * 口径（与 `pure/asrEngine.asrExeCandidates` 完全一致，⛔ 别在这里另立一套）：
     *    ① 用户填了值 ⇒ **只试他填的那一个**（他明确指定了文件，退回候选名等于绕过他的配置）；
     *    ② 没填 ⇒ 先查 PATH（拆目录 × 候选名），再查几个常见安装位置。
     *
     * ⚠️ 不缓存：用户可能刚装好就回来看设置页，缓存会让「装完了还是红的」——比慢几毫秒难解释得多。
     * ⚠️ 全程 try/catch：`process` 在移动端不存在，`PATH` 也可能为空，⛔ 不能因此抛错。
     */
    asrAutoDetect(): { whisper: string; ffmpeg: string; whisperAuto: boolean; ffmpegAuto: boolean } {
        const empty = { whisper: '', ffmpeg: '', whisperAuto: false, ffmpegAuto: false };
        try {
            const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
            const platform = process.platform;
            const customWhisper = sanitizeExePath(this.settings.asrExePath);
            const customFf = sanitizeExePath(this.settings.asrFfmpegPath);
            // PATH 只拆一次（两个探测器共用）
            const pathDirs = splitPathList(env.PATH || env.Path || env.path, platform);
            const opts = {
                home: String(env.USERPROFILE || env.HOME || ''),
                appData: env.APPDATA,
                localAppData: env.LOCALAPPDATA,
                programFiles: env.ProgramFiles || env.PROGRAMFILES,
                programFilesX86: env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'],
                // 🔴 一键安装的落点就是这里（见 `asrBinDir`）：探测不先看它 = 装完仍然红。
                pluginDir: this.pluginDir(),
            };
            const pick = (custom: string, names: readonly string[], kind: 'whisper' | 'ffmpeg'): { path: string; auto: boolean } => {
                const order = locateOrder({
                    custom,
                    pathDirs,
                    names,
                    commonDirs: commonInstallDirs(kind, platform, opts),
                });
                for (const cand of order) {
                    if (this.fileNonEmpty(cand)) return { path: cand, auto: !custom };
                }
                // 一个都没找到：自定义值原样留着（用户可能填的是个还没挂载的盘）。
                // 没填过就是空界面据此展开「手动指定」。
                return { path: custom, auto: false };
            };
            const w = pick(customWhisper, whisperCppOnlyNames(platform), 'whisper');
            const f = pick(customFf, ffmpegPathNames(platform), 'ffmpeg');
            return { whisper: w.path, ffmpeg: f.path, whisperAuto: w.auto, ffmpegAuto: f.auto };
        } catch {
            return empty;
        }
    }

    /**
     * 一键安装的落点：默认**插件目录**下的 `bin/`（原来是 `~/.reelludic/bin/`），
     * 用户确认过自定义目录时以设置为准。
     *
     * 🔴 用户 2026-11-10：「给所有模型下载目录换成插件文件夹根目录而不是 c 盘用户根目录」
     *    ⇒ 程序也搬进来，和 `models/` 并排。
     * 🔴 必须与 `pure/asrLocate.commonInstallDirs('whisper', …)` 里的插件目录候选**逐字一致** ——
     *    装到别处的话，装完自动探测找不到，用户看到的是「装成功了但还是红的」，那比装不上更气人。
     *    用户 m01935 要求安装前可自定义路径 ⇒ 自定义值落进 `asrBinDirOverride`，
     *    与探测共用同一批候选（设置 → 默认位置），保证「装哪找哪」。
     */
    private asrBinDir(): string {
        try {
            const custom = String(this.settings.asrBinDirOverride ?? '').trim();
            if (custom) return custom.replace(/[\\/]+$/, '');
            const own = this.pluginDir();
            if (own) return `${own}/bin`;
            return this.legacyAsrBinDir();
        } catch {
            return '';
        }
    }

    /**
     * 一键安装 whisper.cpp 运行时（用户 m05462 抱怨的另一半：模型能下，跑模型的程序却要自己找）。
     *
     * 返回句柄，UI 可以拿它画进度条 / 取消。装完**不自动改设置**：装到的是标准位置，
     * 自动探测下一轮就会找到它，不需要往 `asrExePath` 里写死一个绝对路径
     * （写死之后用户换机器 / 换目录就失效，而探测是活的）。
     */
    installWhisperRuntime(
        onProgress?: (percent: number | null, label: string) => void,
        dirOverride?: string,
    ): InstallHandle {
        const bin = String(dirOverride ?? '').trim() || this.asrBinDir();
        return runWhisperInstall(defaultWhisperRuntimeDeps(), bin, onProgress);
    }

    /**
     * 某一家引擎的安装目录（exe / 模型 / 词表都落在这里，彼此不打架）。
     *
     * 🔴 为什么按引擎分目录而不是全塞 `~/.reelludic/models`：
     *    `model.int8.onnx` 这种名字是 SenseVoice 专属的，而 Qwen3 还要建两个子目录。
     *    混在一起的话，用户换引擎时看到的是「一堆不知道自己属于谁」的文件。
     * ⚠️ whisper 不在这个体系里 —— 它的三档走 `ASR_MODEL_PRESETS` / `asrModelDir()`，
     *    那是既有实现（460MB 档位、按文件名认档），⛔ 不要为了整齐把两套并成一套。
     */
    asrEngineDir(engine: string): string {
        const id = engineDefOf(engine).id;
        // 🔴 用户 m01935：安装前要能自定义路设置里的 per-engine 覆盖优先。
        //    别只改安装器不改这里：`asrEnginePaths` 也走本函数，两边一旦分家。
        //    就会出现「装D:\asr\xasr 了，但界面还C:\...\models\xasr 里找」
        //    表现是装完仍红，比装不上更让人火大。
        const custom = String((this.settings.asrEngineDirOverrides ?? {})[id] ?? '').trim();
        if (custom) return custom.replace(/[\\/]+$/, '');
        const base = this.asrModelDir();
        if (!base) return '';
        // 🔴 三家各占一个子目录026-11-06 m09819 用户报障「三家模型下载在目录怎么不区分。
        //    只有 Models 文件夹都不知道哪个是哪个」）。
        //    旧实现让 whisper 直接铺在 models/ 根下，另两家在子目录，于是同一层既。
        //    `ggml-base.bin` 又有 `model.int8.onnx` / `model.onnx` / `tokens.txt` 
        //    文件名本身不撞车，但**没有任何线索说明哪个属于哪一*，用户想手动清掉。
        //    某一家的模型都无从下手（这是可发现性问题，不是冲突问题）。
        //    别再让任何一家往根目录写：根目录只放用户自己的东西。
        //    子目录名`pure/asrLayout` 统一给（它是这条规则的单一真源，被单测钉住）。
        const path = require('path') as { join: (a: string, b: string) => string };
        return path.join(base, asrEngineSubdir(engineDefOf(engine).id));
    }

    /**
     * 一键装好某一家引擎（SenseVoice / Qwen3）。
     *
     * 🔴 这是用户 m08030「继续可一键下载三家模型」的落点：
     *    以前只有 whisper 三档能自动下，另两家要用户自己去 HuggingFace 上翻文件、
     *    再手抄路径进三个输入框 —— 那正是 m05462 抱怨的同一件事。
     * ⚠️ 装完**不自动改设置**：文件落在固定位置，自检是活的（`asrEnvCheck` 会去找），
     *    写死绝对路径换机器就失效。
     */
    installAsrEngineBundle(
        engine: string,
        onProgress?: (percent: number, fileIndex: number, label: string) => void,
        variant?: {
            qwenTier?: string;
            svVariant?: string;
            paraVariant?: string;
            xasrChunk?: string;
            confuciusTier?: string;
        },
        /**
         * 用户确认过的落点目录（弹窗里可能被改过）。
         * 🔴 传了就以它为准，别在这里再读一次设—否则用户改了目录、点开始
         *    文件仍落进旧目录，而界面显示的是新路径。
         */
        dirOverride?: string,
    ): { done: Promise<{ ok: boolean; message: string; cancelled?: boolean }>; cancel: () => void } {
        const id = engineDefOf(engine).id;
        const dir = String(dirOverride ?? '').trim() || this.asrEngineDir(id);
        // 🔴 `variant` 决定清单里是 0.6B 还是 1.7B、int8 还是 fp32 —不传就用设置里的当前档。
        const v = variant ?? this.asrCurrentVariant();
        const bundle = asrBundleOf(id, v);
        if (!bundle) {
            return { done: Promise.resolve({ ok: false, message: '这一家不需要单独安装' }), cancel: () => undefined };
        }
        const handle = runBundleInstall(defaultInstallBundleDeps(), bundle, dir, onProgress);
        return {
            // 🔴 `cancelled` 必须透出去：界面要区分「用户自己停的」与「装失败了」，
            //    ⛔ 把取消报成失败会让用户以为出了故障，然后去点「重试安装」。
            done: handle.done.then((r) => ({ ok: r.ok, message: r.message, cancelled: r.cancelled })),
            cancel: () => handle.cancel(),
        };
    }

    /**
     * 六家各自的当前档位（设置里的值，经 `pure/asrBundles` 的归一函数兜底）。
     *
     * 🔴 必须**全部**返回，⛔ 别只返回老两家的 —— `asrBundleStatus` / 安装清单 / 就绪判据
     *    都从这里取档位；少一个就会「用户选了 fp32、按 int8 的体积列清单、装完还是用不上」。
     */
    private asrCurrentVariant(): {
        qwenTier: string;
        svVariant: string;
        paraVariant: string;
        xasrChunk: string;
        confuciusTier: string;
    } {
        const s = this.settings;
        return {
            qwenTier: qwenVariantOf(s.asrQwenTier).tier,
            svVariant: svVariantOf(s.asrSvVariant).variant,
            paraVariant: paraVariantOf(s.asrParaVariant).variant,
            xasrChunk: xasrVariantOf(s.asrXasrChunk).chunk,
            confuciusTier: confuciusVariantOf(s.asrConfuciusTier).tier,
        };
    }

    /**
     * 设置页要看的「两家档位定义」—— 标题、说明、体积都由 `pure/asrBundles` 提供，
     * 界面只负责画。⛔ 别在 Settings.ts 里另抄一份体积表。
     */
    asrVariantInfo(): {
        qwenTier: string;
        svVariant: string;
        paraVariant: string;
        xasrChunk: string;
        confuciusTier: string;
        qwen: readonly { tier: string; label: string; dir: string }[];
        sv: readonly { variant: string; label: string; note: string }[];
        para: readonly { variant: string; label: string; note: string }[];
        xasr: readonly { chunk: string; label: string; note: string }[];
        confucius: readonly { tier: string; label: string; note: string }[];
        alignDir: string;
    } {
        const cur = this.asrCurrentVariant();
        return {
            ...cur,
            qwen: QWEN_ASR_VARIANTS.map((v) => ({
                tier: v.tier,
                label: `${v.tier} · ${formatBundleBytes(bundleBytes(qwenBundle(v.tier)))}`,
                dir: v.dir,
            })),
            sv: SENSEVOICE_VARIANTS.map((v) => ({
                variant: v.variant,
                label: `${v.title} · ${formatBundleBytes(v.bytes)}`,
                note: v.note,
            })),
            para: PARAFORMER_VARIANTS.map((v) => ({
                variant: v.variant,
                label: `${v.title} · ${formatBundleBytes(v.bytes)}`,
                note: v.note,
            })),
            xasr: XASR_VARIANTS.map((v) => ({
                chunk: v.chunk,
                label: `${v.title} · ${formatBundleBytes(v.encoderBytes)}`,
                note: v.note,
            })),
            confucius: CONFUCIUS_VARIANTS.map((v) => ({
                tier: v.tier,
                label: `${v.title} · ${formatBundleBytes(v.modelBytes + v.mmprojBytes)}`,
                note: v.note,
            })),
            alignDir: QWEN_ALIGN.dir,
        };
    }

    /**
     * 查某一家引擎的安装包**已经下好了哪几个文件**（给「一键装好」按钮显示进度/状态用）。
     * ⚠️ 只 stat，不启动进程（自检必须瞬时）。
     */
    asrBundleStatus(engine: string): { installed: number; total: number; ready: boolean; blockedReason: string } {
        const id = engineDefOf(engine).id;
        // 🔴 必须带档位：X-ASR encoder 体积chunk 变、Confucius4 gguf 随量化档变。
        //    不带档位就会按默认档去数文件 —用户装了 F16 却看到/3 已装」。
        const bundle = asrBundleOf(id, this.asrCurrentVariant());
        if (!bundle) return { installed: 0, total: 0, ready: false, blockedReason: '' };
        const dir = this.asrEngineDir(id);
        let installed = 0;
        if (dir) {
            const pathMod = require('path') as { join: (a: string, b: string) => string };
            for (const f of bundle.files) {
                if (this.fileNonEmpty(pathMod.join(dir, f.fileName))) installed += 1;
            }
        }
        return {
            installed,
            total: bundle.files.length,
            ready: installed === bundle.files.length && bundle.files.length > 0,
            blockedReason: bundle.blockedReason,
        };
    }

    /**
     * 某一家引擎在**指定档位**下的就绪情况（平铺列表每行一个状态胶囊用）。
     *
     * 🔴 为什么要单开一个方法，而不是复用 `asrBundleStatus`：
     *    后者永远按 `settings` 里的**当前档位**数文件。平铺列表要同时显示
     *    「tiny 未下载 / base 已就绪 / small 未下载」—— 拿当前档位去数，
     *    所有行会显示同一个状态，用户根本看不出自己装过哪一档。
     *
     * ⚠️ whisper 走 preset 单文件判据（`asrPresetReady`），其余走 bundle 多文件判据。
     *    两条判据各自都有既有实现，⛔ 别在这里另写一套 `statSync` 比较逻辑。
     */
    asrPickStatus(engine: string, tier: string): { installed: number; total: number; ready: boolean } {
        const id = engineDefOf(engine).id;
        if (id === 'whisper') {
            const preset = presetOf(tier);
            if (!preset) return { installed: 0, total: 1, ready: false };
            const ready = this.asrPresetReady(preset);
            return { installed: ready ? 1 : 0, total: 1, ready };
        }
        const bundle = asrBundleOf(id, this.asrVariantFor(id, tier));
        if (!bundle) return { installed: 0, total: 0, ready: false };
        const dir = this.asrEngineDir(id);
        let installed = 0;
        if (dir) {
            const pathMod = require('path') as { join: (a: string, b: string) => string };
            for (const f of bundle.files) {
                if (this.fileNonEmpty(pathMod.join(dir, f.fileName))) installed += 1;
            }
        }
        return {
            installed,
            total: bundle.files.length,
            ready: installed === bundle.files.length && bundle.files.length > 0,
        };
    }

    /**
     * 把「某一家 + 某个档位名」翻译成 `asrBundleOf` 要的整组档位参数。
     *
     * ⚠️ 未涉及的字段沿用当前设置 —— `asrBundleOf` 只认自己那一家对应的字段，
     *    其余字段填什么都不影响结果；沿用当前值可以避免造一堆无意义的字面量。
     */
    private asrVariantFor(
        engine: AsrEngineId,
        tier: string,
    ): { qwenTier: string; svVariant: string; paraVariant: string; xasrChunk: string; confuciusTier: string } {
        const base = this.asrCurrentVariant();
        if (engine === 'qwen3') return { ...base, qwenTier: qwenVariantOf(tier).tier };
        if (engine === 'sensevoice') return { ...base, svVariant: svVariantOf(tier).variant };
        if (engine === 'paraformer') return { ...base, paraVariant: paraVariantOf(tier).variant };
        if (engine === 'xasr') return { ...base, xasrChunk: xasrVariantOf(tier).chunk };
        if (engine === 'confucius') return { ...base, confuciusTier: confuciusVariantOf(tier).tier };
        return base;
    }

    /**
     * 「这一家到底要哪些文件才算能跑」—— 右侧配置面板的「环境状态检查」用。
     *
     * 🔴 为什么不让界面自己拼三块：「识别程序 / 识别模型 / 音频工具」那三块是
     *    whisper 时代的形状。Paraformer 要四样、X-ASR 要六样、Confucius4 要三样
     *    但第三样是投影器不是词表 —— 界面按三家硬编码就会漏项，
     *    表现是「面板上全绿、点转写却报缺文件」。
     *
     * ⚠️ 这里给的是**预期路径**（哪怕文件不存在也给），与 `asrPathsFor` 的过滤语义不同：
     *    面板要显示「本该在哪」，`asrPathsFor` 只回答「现在有什么」。
     */
    /**
     * 硬件探测的**缓存**（用户 m05717 ① 要真数据）。
     *
     * 🔴 为什么必须有缓存：`renderAsrEngineRows` 每次切档/重绘都会重新渲染整块面板，
     *    而探测要起 3~4 个子进程（`nvidia-smi` / `cmake` / `g++` / `cl`）。
     *    不缓存的话，用户每点一次档位就 fork 一轮进程 —— 设置页会明显发卡，
     *    在没有 N 卡的机器上还要白等 `nvidia-smi` 的超时。
     *
     * ⚠️ 缓存**不落盘**：显卡/内存是机器事实，同一进程内不会变；
     *    但插件装了新工具链（比如刚装了 CMake）要能立刻看到 ⇒ 提供 `refreshAsrHardware()`。
     * ⚠️ 缓存的是 **Promise** 而不是结果：两个面板同时渲染时会共用同一次探测，不会并发起两轮。
     */
    private asrHardwareCache: Promise<HardwareInfo> | null = null;

    /**
     * 取硬件数据（首次真探测，之后读缓存）。
     * ⚠️ 永远 resolve，探测失败也只是返回空值 —— ⛔ 别让它 reject 把渲染整块炸掉。
     */
    asrHardware(): Promise<HardwareInfo> {
        if (!this.asrHardwareCache) {
            const dir = this.asrModelDir() || '.';
            this.asrHardwareCache = probeHardware(dir)
                .then((r): HardwareInfo => ({
                    gpus: r.gpus,
                    totalMemMb: r.totalMemMb,
                    freeDiskMb: r.freeDiskMb,
                    cmake: r.cmake,
                    cpp: r.cpp,
                    probeError: r.probeError,
                }))
                .catch((): HardwareInfo => ({
                    gpus: [],
                    totalMemMb: 0,
                    freeDiskMb: 0,
                    cmake: { found: false, version: '' },
                    cpp: { found: false, detail: '' },
                    probeError: '硬件探测没能完成',
                }));
        }
        return this.asrHardwareCache;
    }

    /** 丢掉缓存、下次重新探测（用户点了「重新检测」时用）。 */
    refreshAsrHardware(): void {
        this.asrHardwareCache = null;
    }

    /**
     * 统计某一家引擎目录**已占磁盘字节数**（用户 m05717 ①：「醒目提示已占 XX」）。
     *
     * 🔴 为什么不在 settings 面板里直接 `statSync` 递归：那是几十到几百次同步系统调用，
     *    会把设置页卡住（X-ASR 一档就有 586MB、多个 onnx）。
     *    这里用 `fs.promises.readdir` 逐层异步走，失败一律按 0 算 —— 目录不存在是**正常**状态
     *    （还没装 = 0 字节），⛔ 别抛错、也别编一个数字出来。
     *
     * ⚠️ 按引擎目录统计，与 `asrEngineDir()` 同一口径（含用户自定义覆盖路径）。
     */
    asrEngineDirUsage(engine: string): Promise<number> {
        const dir = this.asrEngineDir(engine);
        if (!dir) return Promise.resolve(0);
        const fsp = require('fs') as {
            promises: {
                readdir(p: string, o: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean; isFile(): boolean }[]>;
                stat(p: string): Promise<{ size: number }>;
            };
        };
        const walk = async (p: string): Promise<number> => {
            let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
            try {
                entries = await fsp.promises.readdir(p, { withFileTypes: true });
            } catch {
                return 0;
            }
            let sum = 0;
            for (const e of entries) {
                const full = `${p}\\${e.name}`;
                if (e.isDirectory()) sum += await walk(full);
                else if (e.isFile()) {
                    try {
                        sum += (await fsp.promises.stat(full)).size;
                    } catch {
                        // 单文件读不到就跳过，别因为一个锁文件把整次统计判成失。
                    }
                }
            }
            return sum;
        };
        return walk(dir).catch(() => 0);
    }

    asrEngineChecklist(engine: string): {
        items: { key: string; label: string; path: string; ok: boolean }[];
        ready: boolean;
        env: { program: boolean; model: boolean; audio: boolean };
    } {
        const id = engineDefOf(engine).id;
        const s = this.settings;
        const raw: { key: string; label: string; path: string }[] = [];
        const det = this.asrAutoDetect();
        if (id === 'whisper') {
            raw.push({ key: 'program', label: '识别程序', path: det.whisper });
            raw.push({ key: 'model', label: '识别模型', path: String(s.asrModelPath ?? '').trim() || this.asrModelAuto() });
        } else if (id === 'qwen3') {
            raw.push({ key: 'program', label: 'Python 解释器', path: String(s.asrPythonPath ?? '').trim() });
            raw.push({ key: 'model', label: '桥接脚本', path: String(s.asrBridgeScript ?? '').trim() });
        } else {
            // 四样 / 六样 / 三样的引擎：顺序按「先程序、后权重、最后词表」排。
            // 与安装清单（`asrInstallPlan`）的顺序一致，免得用户对不上号。
            const files = this.asrEnginePaths(id).files ?? {};
            const labelOf: Record<string, string> = {
                program: '识别程序',
                vad: '断句模型',
                encoder: "编码器",
                decoder: "解码器",
                joiner: "连接器",
                model: id === 'confucius' ? '语言模型' : '识别模型',
                extra: id === "confucius" ? "投影器" : "附加文件",
                tokens: '词表',
            };
            const order =
                id === 'confucius'
                    ? ['program', 'model', 'extra']
                    : ['program', 'vad', 'encoder', 'decoder', 'joiner', 'model', 'tokens'];
            for (const key of order) {
                const p = files[key];
                if (!p) continue;
                raw.push({ key, label: labelOf[key] ?? key, path: p });
            }
        }
        raw.push({ key: 'audio', label: '音频工具', path: det.ffmpeg });

        const items = raw.map((it) => ({ ...it, ok: this.fileNonEmpty(it.path) }));
        const okOf = (key: string): boolean => items.some((it) => it.key === key && it.ok);
        return {
            items,
            ready: items.every((it) => it.ok),
            env: { program: okOf('program'), model: okOf('model'), audio: okOf('audio') },
        };
    }

    /**
     * 打开「安装清单」弹窗（用户 m09123：「点此行为就弹窗显示要装的项按序号来每完成一项就打勾」）。
     *
     * 🔴 为什么要有这一步而不是直接把按钮做成「点了就闷头下」：
     *    whisper 的一键安装其实是**两件事** —— 先装跑模型的程序（5.3MB 发布包），
     *    再下模型文件（74MB～2952MB）。原来的实现只做了前一半，用户点完
     *    「一键安装 whisper.cpp 程序」看到绿了，回头发现转写还是说「没模型」。
     *    清单弹窗把这两步摊开，用户点之前就知道要下多少、装到第几步了。
     *
     * ⚠️ 关窗会取消安装（`AsrInstallModal.onClose`），⛔ 不留后台偷偷占带宽。
     * ⚠️ 装完**不写设置**：文件落在固定位置，`asrEnginePaths` 是活探测，下一次开设置页自己就绿了
     *    （写死绝对路径换机器就失效，这与 `installWhisperRuntime` 的口径一致）。
     */
    openAsrInstall(engine: string, tier?: AsrModelTier, onClosed?: () => void): void {
        const id = engineDefOf(engine).id;
        // 🔴 档位必须一起传给清单：X-ASR 960ms 时清单要960ms encoder 体积列。
        //    不传就会按归一后的默认档（1920）列 —数字对不上，用户会以为下错了。
        const variant = this.asrCurrentVariant();
        /**
         * 🔴 目录必须**先算出来给弹*，而不是装的时候才知道（用m01935。
         *    「点击一键安装时必须弹窗告知用户一键安装模型及配置器的所有路。
         *    待用户选择确认或自定义路径后才能安装」）。
         *    这里给的是「当前会用到哪两个目录」的默认值，用户在弹窗里改了就以他改的为准。
         */
        const initDirs = { engineDir: this.asrEngineDir(id), binDir: this.asrBinDir() };
        const plan = asrInstallPlan(id, tier, variant, initDirs);
        /**
         * 全局右下角进*卡片**（用m10363：「怎么不在全局加个提示进度」
         * m10634：「怎么点一下就消失不见了，而且应该参考主流市面方案的悬浮球的进度框」）。
         *
         * 🔴 装在弹窗里，*卡片必须挂宿主层**（`services/progressBall` `document.body`）
         *    因为用户465MB 模型时一定会关掉弹窗去干活。
         * 🔴 卡片上的「取消」要真能停下安装 —否则用户关掉弹窗后看见卡片还在跑。
         *    却发现没有任何入口能停它，只能等它自己跑完。
         *    `installHandle` 是引用而不是值：弹窗里点「开始安装」之前它还是 null。
         *    那时取消不做任何事（也确实没东西可取消）。
         * ⚠️ 单例：转写正在跑时起卡片会接管旧的（`startProgressBall` 的既有语义），这是有意的 
         *    同一时刻只该有一个「正在发生的事」占着右下角。
         * 🔴 用户 2026-11-10（m03035）：「模型下载要点击开始安装才能出现右下角进度悬浮球和框。
         *    卡片**懒创*：弹窗打开时一个像素都不画，真的点了「开始安装」（`run` 被调用）
         *    `ensureBall()`。改前是 `openAsrInstall` 一进来`startProgressBall`，用户只。
         *    想看看要下什么、还没确认路径，右下角就已经挂着一0% 的球在转。
         * 别退回「打开就起球」：那个球对还没开始的安装是假信息。
         */
        let installHandle: { cancel: () => void } | null = null;
        let ball: ProgressBallHandle | null = null;
        const ensureBall = (): ProgressBallHandle => {
            if (!ball) {
                ball = startProgressBall(`正在准备安装 ${plan.title}`, {
                    onCancel: () => {
                        installHandle?.cancel();
                    },
                });
            }
            return ball;
        };
        let ballClosed = false;
        const closeBall = (kind: 'done' | 'fail' | 'dismiss', message?: string): void => {
            if (ballClosed) return;
            ballClosed = true;
            // 还没起过球（用户在确认路径之前就关了窗）没有任何东西要收。
            if (!ball) return;
            try {
                // ⚠️ 这里传的是「内容」，`endTip` 会自己加「完成：「失败：」前缀。
                //    别再传「安装完成」——拼出来会变成「完成：安装完成」。
                if (kind === 'done') ball.done(message || '全部装好了');
                else if (kind === 'fail') ball.fail(message || '安装没成功');
                else ball.dismiss();
            } catch {
                /* 球已自毁（END_LINGER_MS 之后），忽略 */
            }
        };
        const modal = new AsrInstallModal(this.app, {
            plan,
            dirs: initDirs,
            dirFields: asrInstallDirFields(id),
            // 浏览按钮走系统对话框（`createDirectory` 让用户能当场新建目录）
            pickDir: (current) => this.pickSystemDirectory(current),
            /**
             * 🔴 用户确认（可能改过）目录后才开工：这里把确认值落进设置，
             *    再把它交给执行层 —— **先落库再执行**，否则「弹窗显示 D:\x、实际装到 C:\y」
             *    这种不一致只会在装完发现还是红的时候才暴露。
             */
            onDirsConfirmed: (dirs) => {
                if (dirs.engineDir) this.settings.asrEngineDirOverrides = {
                    ...(this.settings.asrEngineDirOverrides ?? {}),
                    [id]: dirs.engineDir,
                };
                if (id === 'whisper' && dirs.binDir) this.settings.asrBinDirOverride = dirs.binDir;
                void this.saveSettings();
            },
            run: (onStep, dirs) => {
                // 🔴 到这一步才是「用户已经确认路径并按下开始安装」⇒ 这时才允许右下角出现悬浮。
                const liveBall = ensureBall();
                const wrap = (itemIndex: number, itemPercent: number, label: string): void => {
                    onStep(itemIndex, itemPercent, label);
                    liveBall.update({
                        label: label || plan.title,
                        percent: itemPercent,
                        detail: `第 ${itemIndex + 1} / ${plan.items.length} 项`,
                    });
                };
                const h = id === 'whisper'
                    ? this.runWhisperInstall(wrap, tier, dirs)
                    : this.runBundleInstall(id, plan.items.length, wrap, dirs.engineDir);
                // 把句柄挂出去，卡片上的「取消」才有东西可掐（别只让弹窗能停）
                installHandle = h;                void h.done.then((r) => {
                    installHandle = null;
                    if (r.cancelled) closeBall('dismiss');
                    else if (r.ok) closeBall('done', '全部装好了');
                    else closeBall('fail', r.message || '安装没成功');
                });
                return h;
            },
            onClosed: () => {
                // 关窗即取消（`AsrInstallModal.onClose` 里会 `handle.cancel()`）⇒ 卡片跟着撤，
                // 别留一张假装在装的。
                installHandle = null;
                closeBall('dismiss');
                onClosed?.();
            },
        });
        modal.open();
    }

    /**
     * whisper 的两步安装：程序 → 模型。
     * 进度按「第几项 + 这一项自己的百分比」发给弹窗（⛔ 不发整包总进度，
     * 那会让第 2 项一开头就显示 50%，看起来像前一步没做完就已经跳到后一步）。
     */
    private runWhisperInstall(
        onStep: (itemIndex: number, itemPercent: number, label: string) => void,
        tier?: AsrModelTier,
        dirs?: { binDir: string; engineDir: string },
    ): { done: Promise<{ ok: boolean; message: string; cancelled?: boolean }>; cancel: () => void } {
        const preset = (tier ? presetOf(tier) : null) ?? ASR_MODEL_PRESETS[1];
        let cancelled = false;
        let step1: InstallHandle | null = null;
        let step2: { cancel: () => void } | null = null;

        const done = (async (): Promise<{ ok: boolean; message: string; cancelled?: boolean }> => {
            // ── 1 项：跑模型的程序（幂等，已经装齐会立刻成功） ──
            onStep(0, 0, "正在下载转写程序…");
            const h1 = this.installWhisperRuntime((pct, label) => {
                onStep(0, pct ?? 0, label);
            }, dirs?.binDir);
            step1 = h1;
            const r1 = await h1.done;
            step1 = null;
            if (cancelled || r1.ok === false) {
                return { ok: false, message: r1.ok ? '' : (r1.message || '转写程序安装失败。'), cancelled };
            }
            onStep(0, 100, "转写程序已就位");

            // ── 2 项：模型文件4MB ~ 2952MB，这才是大头──
            // 🔴 用户确认过模型目录时以它为准（m01935），否则走默认推导。
            const dest = String(dirs?.engineDir ?? '').trim() === ''
                ? this.asrModelPathOf(preset)
                : joinDir(String(dirs?.engineDir ?? '').trim(), preset.fileName);
            if (!dest) return { ok: false, message: '无法确定模型存放目录。' };
            // 🔴 先建目录再下（m09819 之后模型`models/whisper/` 子目录，首次下载时它不存在）。
            //    `downloadModel` `createWriteStream`，父目录缺失会直接抛错。
            //    表现是「进度刚起来就报写入失败，让用户去查磁盘空间」
            //    `services/whisperRuntime` 里踩过的那个坑完全同源。
            try {
                const pathMod = require('path') as { dirname: (p: string) => string };
                const fsMod = require('fs') as { mkdirSync: (p: string, o: { recursive: boolean }) => void };
                fsMod.mkdirSync(pathMod.dirname(dest), { recursive: true });
            } catch {
                return { ok: false, message: "无法创建模型目录，请检查该路径的写入权限。" };
            }
            onStep(1, 0, `正在下载 ${preset.title} 模型…`);
            const h2 = downloadModel(
                defaultDownloadDeps(),
                preset,
                dest,
                (pct) => onStep(1, pct ?? 0, `正在下载 ${preset.title} 模型…`),
                mirrorUrlFor(preset),
            );
            step2 = h2;
            const r2 = await h2.done;
            step2 = null;
            if (cancelled) return { ok: false, message: '', cancelled: true };
            if (!r2.ok) return { ok: false, message: r2.message || '模型下载失败。' };
            onStep(1, 100, "模型已就位");
            return { ok: true, message: '' };
        })();

        return {
            done,
            cancel: () => {
                cancelled = true;
                step1?.cancel();
                step2?.cancel();
            },
        };
    }

    /** 另两家的整包安装：执行层给的是「整包加权进度 + 当前第几个文件」，这里换算成单项百分比 */
    private runBundleInstall(
        engine: string,
        total: number,
        onStep: (itemIndex: number, itemPercent: number, label: string) => void,
        dirOverride?: string,
    ): { done: Promise<{ ok: boolean; message: string; cancelled?: boolean }>; cancel: () => void } {
        const h = this.installAsrEngineBundle(
            engine,
            (percent, fileIndex, label) => {
                const p = itemProgress(total, fileIndex, percent);
                onStep(p.index, p.percent, label);
            },
            undefined,
            dirOverride,
        );
        return h;
    }

    /**
     * 插件自己的安装目录（系统绝对路径，**库内** `<库>/.obsidian/plugins/<id>`）。
     *
     * 🔴 用户 2026-11-10 裁定：「给所有模型下载目录换成插件文件夹根目录而不是 c 盘用户根目录」
     *    ⇒ 模型与程序都跟插件放在一起，用户打开库就能看见，不需要去 `C:\Users\<你>\.reelludic` 翻。
     * ⚠️ 取法两条腿，⛔ 别只留一条：
     *    ① `manifest.dir`（Obsidian 给的是 vault 内相对路径，如 `.obsidian/plugins/obsidian-reelludic`）
     *       + `vaultBasePath()` 拼成绝对路径 —— 正常桌面环境都走这条；
     *    ② `manifest.dir` 缺失（开发期手动放进 .obsidian 的旧包 / 某些第三方加载器）⇒ 退回
     *       `<库>/.obsidian/plugins/<manifest.id>`，仍拿不到库根就返回空串交给调用方兜底。
     * ⚠️ 拿不到（移动端 / 适配器无 getBasePath）⇒ 空串。调用方据此退回主目录旧路径，
     *    ⛔ 不要在这里抛错 —— 换目录失败不该让整个语音服务不可用。
     */
    private pluginDir(): string {
        try {
            const rel = String((this.manifest as { dir?: string } | undefined)?.dir ?? '').trim();
            const base = this.vaultBasePath();
            if (base) {
                const sub = rel || `.obsidian/plugins/${this.manifest.id}`;
                return `${base.replace(/[\\/]+$/, '')}/${sub.replace(/[\\/]+$/, '')}`;
            }
            return '';
        } catch {
            return '';
        }
    }

    /** 旧的库外模型目录（`~/.reelludic/models`）—— 只用于**一次性迁移**与拿不到插件目录时的兜底 */
    private legacyAsrModelDir(): string {
        try {
            const os = require('os') as { homedir: () => string };
            const home = os.homedir();
            if (!home) return '';
            return `${home}/.reelludic/models`;
        } catch {
            return '';
        }
    }

    /** 旧的库外程序目录（`~/.reelludic/bin`）—— 同上，只用于迁移与兜底 */
    private legacyAsrBinDir(): string {
        try {
            const os = require('os') as { homedir: () => string };
            const home = os.homedir();
            if (!home) return '';
            return `${home}/.reelludic/bin`;
        } catch {
            return '';
        }
    }

    /**
     * 本地模型文件的存放目录。
     *
     * 🔴 用户 2026-11-10 裁定：默认放**插件目录**下的 `models/`（原来是 `~/.reelludic/models`）。
     *    旧口径担心「放库里会被同步盘整份上传」，用户明确选择「跟插件在一起」优先于那条顾虑
     *    —— 这是用户的取舍，⛔ 不要再拿同步盘的理由把它改回去。
     * ⚠️ 拿不到插件目录（极端环境）⇒ 退回旧的主目录路径；再拿不到 ⇒ 空串，
     *    调用方据此提示「无法确定存放位置」。
     */
    private asrModelDir(): string {
        try {
            // 🔴 用户在「沉浸体语音服务」里可以指定下载目录（m06789 需求②。
            //    「要显示当前模型及环境下载路径和可选择指定路径下载」）非空时以它为准。
            //    不要在这里校验「是不是库内」—那是设置页输入时的职责，这里只负责给出一个可用字符串。
            const custom = String(this.settings.asrModelDir ?? '').trim();
            if (custom) return custom.replace(/[\\/]+$/, '');
            const own = this.pluginDir();
            if (own) return `${own}/models`;
            return this.legacyAsrModelDir();
        } catch {
            return '';
        }
    }

    /** 模型下载/存放目录（**给设置页显示用**，与内部 `asrModelDir` 同一真源） */
    asrModelsDir(): string {
        return this.asrModelDir();
    }

    /**
     * 环境自检：当前引擎要的三样（程序 / 模型 / 音频工具）各自在不在。
     *
     * 🔴 用户 m06789 需求②的点名要求：「▶ 环境自检：程序 [✅] | 模型 [✅] | 音频工具 [✅]」，
     *    并且**随上方下拉框联动** —— 所以这里按 `settings.asrEngine` 现算，⛔ 不缓存。
     *    ⚠️ 三个布尔值只说明「文件在不在」，不启动进程、不试跑（自检必须瞬时）。
     */
    asrEnvCheck(): {
        program: boolean;
        model: boolean;
        audio: boolean;
        programPath: string;
        modelPath: string;
        audioPath: string;
    } {
        const s = this.settings;
        const det = this.asrAutoDetect();
        const engine = engineDefOf(s.asrEngine).id;
        const paths = this.asrEnginePaths(engine);
        const programPath = paths.program;
        const modelPath = paths.model;
        return {
            program: this.fileNonEmpty(programPath),
            model: this.fileNonEmpty(modelPath),
            audio: this.fileNonEmpty(det.ffmpeg),
            programPath,
            modelPath,
            audioPath: det.ffmpeg,
        };
    }

    /**
     * 某一家引擎**实际可用的**三个文件路径：设置里填了就用填的，没填就去安装目录找。
     *
     * 🔴 这是 m08030 的关键一环。以前 sensevoice / qwen3 的判据是「设置里的路径字符串非空」，
     *    而一键安装把文件放进固定目录、**不写设置**（写死绝对路径换机器就失效）——
     *    结果就是「装完了卡片还是红的」，与 m05462 的 `asrModelAuto` 是同一个坑。
     *    所以这里的顺序必须是：用户填的优先 → 固定安装目录兜底 → 都没有才算未配置。
     */
    private asrEnginePaths(engine: string): {
        program: string;
        model: string;
        extra: string;
        /**
         * 需*多于三个**文件的引擎在这里给全（Paraformer 四样、X-ASR 六样）。
         * ⚠️ 老三家不—它们的调用方一直按 `program/model/extra` 读，别为了整齐改结构。
         */
        files?: Record<string, string>;
    } {
        const s = this.settings;
        const id = engineDefOf(engine).id;
        const dir = this.asrEngineDir(id);
        const pathMod = require('path') as { join: (a: string, b: string) => string };
        const at = (name: string): string => (dir ? pathMod.join(dir, name) : '');
        if (id === 'sensevoice') {
            // 🔴 模型文件名跟着档位走（int8 = `model.int8.onnx` / fp32 = `model.onnx`）：
            //    写死 int8 的话，用户选了 fp32 会「装好了但还是红」—探测去找一个没下过的文件名。
            const sv = svVariantOf(s.asrSvVariant);
            return {
                program: String(s.asrSenseVoiceExePath ?? '').trim() || at(SHERPA_EXE_NAME),
                model: String(s.asrSenseVoiceModelPath ?? '').trim() || at(sv.modelFile),
                extra: String(s.asrTokensPath ?? '').trim() || at('tokens.txt'),
            };
        }
        if (id === 'paraformer') {
            // 🔴 Paraformer 要四样才跑得起来（比 SenseVoice 多一个断句模型）。
            //    程序 = vad-with-offline-asr exe*不是** sherpa-onnx-offline，那个只出整段文字没有时间轴）。
            //    模型 = 该档 onnx、词表、以silero_vad。
            const pv = paraVariantOf(s.asrParaVariant);
            return {
                program: at(SHERPA_VAD_OFFLINE_EXE_NAME),
                model: at(pv.modelFile),
                extra: at('tokens.txt'),
                files: {
                    program: at(SHERPA_VAD_OFFLINE_EXE_NAME),
                    model: at(pv.modelFile),
                    tokens: at('tokens.txt'),
                    vad: at(SILERO_VAD_NAME),
                },
            };
        }
        if (id === 'xasr') {
            // 🔴 X-ASR 要六样：程序 = vad-with-**online**-asr exe。
            //    加上 encoder / decoder / joiner 三件+ 词表 + silero_vad。
            //    三个权重必须同一chunk，混用会因形状不匹配直接崩。
            const xv = xasrVariantOf(s.asrXasrChunk);
            return {
                program: at(SHERPA_VAD_ONLINE_EXE_NAME),
                model: at(`encoder-${xv.chunk}ms.onnx`),
                extra: at('tokens.txt'),
                files: {
                    program: at(SHERPA_VAD_ONLINE_EXE_NAME),
                    encoder: at(`encoder-${xv.chunk}ms.onnx`),
                    decoder: at(`decoder-${xv.chunk}ms.onnx`),
                    joiner: at(`joiner-${xv.chunk}ms.onnx`),
                    tokens: at('tokens.txt'),
                    vad: at(SILERO_VAD_NAME),
                },
            };
        }
        if (id === 'confucius') {
            // 🔴 Confucius4 三样：llama-mtmd-cli 运行+ 语言模型 gguf + 投影mmproj。
            //    只下 gguf 不下 mmproj exe 会直接拒绝运行（真机实测）。
            const cv = confuciusVariantOf(s.asrConfuciusTier);
            return {
                program: at('llama-mtmd-cli.exe'),
                model: at(cv.modelFile),
                extra: at(cv.mmprojFile),
                files: {
                    program: at('llama-mtmd-cli.exe'),
                    model: at(cv.modelFile),
                    extra: at(cv.mmprojFile),
                },
            };
        }
        if (id === 'qwen3') {
            // Qwen3 的两个「文件」其实是两个模型目录：程序仍是用户自己的 Python 解释器，
            // 模型侧靠目录里的 config.json model.safetensors 判在不在。
            // ⚠️ `extra` 给出该档的模型目—界面要用它显示「模型会放在哪」
            //    也让「装好了没有」与「脚本去哪找」指向同一个地方（目录= 上游仓库名）。
            const qv = qwenVariantOf(s.asrQwenTier);
            return {
                program: String(s.asrPythonPath ?? '').trim(),
                model: String(s.asrBridgeScript ?? '').trim(),
                extra: at(qv.dir),
            };
        }
        return {
            program: this.asrAutoDetect().whisper,
            model: String(s.asrModelPath ?? '').trim() || this.asrModelAuto(),
            extra: '',
        };
    }

    /**
     * 给设置页回显用的「这一家现在实际在用什么路径」（2026-11-06 m09051）。
     *
     * ⚠️ 只读、不落库 —— 设置项里为空时输入框用它回显，用户一动键盘才写 data.json。
     *    理由见 `Settings.renderAsrEngineRows` 里 `pathRow` 的 `auto` 注释：
     *    把探测到的绝对路径写死进设置，换机器就失效（m05462 的教训）。
     *
     * 🔴 每个字段**只在文件真的存在时**才非空（2026-11-06 m09819 用户报障
     *    「还有环境配置说的已自动找到，但没填路径啊我怎么知道找不找的到」）。
     *    旧实现把 `at(name)` 拼出来的**计算路径**直接返回，哪怕那个文件根本没下过 ——
     *    于是界面出现两种自相矛盾的呈现：框里是空（`fileNonEmpty` 判 false ⇒ 三勾是⬜），
     *    或者框里in一个不存在的路径却标注「已自动找到」。
     *    现在统一口径：**能回显的就是真实存在且非空的**，不存在就返回空串，
     *    让输入框如实显示 placeholder + 下面的「手动指定」区块。
     */
    asrPathsFor(engine: string): { program: string; model: string; extra: string; audio: string } {
        const p = this.asrEnginePaths(engine);
        const real = (v: string): string => (this.fileNonEmpty(v) ? v : '');
        return {
            program: real(p.program),
            model: real(p.model),
            extra: real(p.extra),
            audio: real(this.asrAutoDetect().ffmpeg),
        };
    }

    /** 某一档模型的目标绝对路径（目录拿不到 ⇒ 空串） */
    private asrModelPathOf(preset: AsrModelPreset): string {
        // 🔴 whisper 的模型改`models/whisper/` 子目录（与另两家同构，见 `asrEngineDir` 注释）。
        //    别改`asrModelDir()` 根目—那正m09819「分不清哪个是哪个」的来源。
        const dir = this.asrEngineDir('whisper');
        if (!dir) return '';
        return joinDir(dir, preset.fileName);
    }

    /** 给设置页用的 `asrModelPathOf`（私有版留给内部调用，这条是对外只读入口） */
    asrModelPathFor(preset: AsrModelPreset): string {
        return this.asrModelPathOf(preset);
    }

    /** 查某一档在本机的状态（就绪 / 字节数）—— 只读，⛔ 不下载 */
    private asrCardState(preset: AsrModelPreset): { ready: boolean; percent: number | null; received: number; total: number } {
        // 🔴 `asrModelAuto` 会「借用」另一档已下好的文件（见该方法的注释），这里必*精确**。
        //    模型列表上每一行都要说清「这一档在不在」，借来的就绪会让三档同时显示绿点。
        const dest = this.asrModelPathOf(preset);
        if (!dest) return { ready: false, percent: null, received: 0, total: preset.bytes };
        try {
            const fsMod = require('fs') as { statSync: (p: string) => { size: number } };
            const n = fsMod.statSync(dest).size;
            return {
                ready: downloadLooksComplete(n, preset.bytes),
                percent: null,
                received: n,
                total: preset.bytes,
            };
        } catch {
            return { ready: false, percent: null, received: 0, total: preset.bytes };
        }
    }

    /**
     * 给设置页「选择模型」列表用的**单档就绪查询**（公有只读）。
     * 与 `asrCardState` 的区别只有可见性：那条是私有的、留给弹窗；这条给设置页逐行画绿点。
     */
    asrPresetReady(preset: AsrModelPreset): boolean {
        return this.asrCardState(preset).ready;
    }

    /** 「选择音频转文字引擎」弹窗（设置页 [配置] / [更改] 按钮的落点） */
    openAsrEngineModal(): void {
        if (!this.asrModelDir()) {
            new Notice('无法确定本地模型存放位置（拿不到用户主目录），请改用下面的「识别模型文件」手动指定。');
            return;
        }
        const modal = new AsrEngineModal(this.app, {
            currentPath: String(this.settings.asrModelPath ?? ''),
            pathOf: (p) => this.asrModelPathOf(p),
            stateOf: (p) => this.asrCardState(p),
            // 🔴 第 5 参传镜像地址：官方源在国内直连超时（实测 12s socket hang up），
            //    下载器内部失败后会自动换 `hf-mirror.com` 再试一次。⛔ 别省这个参数 ——
            //    省了就等于「一键下载」在国内完全不可用。
            download: (p, onProgress) =>
                downloadModel(defaultDownloadDeps(), p, this.asrModelPathOf(p), onProgress, mirrorUrlFor(p)),
            remove: (p) => {
                const dest = this.asrModelPathOf(p);
                if (!dest) return;
                try {
                    const fsMod = require('fs') as { unlinkSync: (x: string) => void };
                    fsMod.unlinkSync(dest);
                } catch {
                    /* 文件本来就不在：删除是幂等成功，所以不弹窗 */
                }
                this.displayAsrHintAfterRemove(p);
            },
            onPick: async (p) => {
                this.settings.asrModelPath = this.asrModelPathOf(p);
                await this.saveSettings();
                new Notice(`已切换到「${p.title}」，现在可以转写了。`);
            },
            pickCustom: () => this.pickSystemFilePath(['bin'], '模型文件').then((v) => v ?? null),
            onPickCustom: async (abs) => {
                this.settings.asrModelPath = abs;
                await this.saveSettings();
                new Notice('已使用你选择的模型文件。');
            },
            // 2026-11-13 用户指令：模型页要能给出「下载模型官网路径」。
            // 🔴 走宿主 `openExternalUrl`（它已限 http/https），⛔ 不让弹窗自己 window.open ——
            //    那会绕过协议白名单，且移动端行为不一致。
            onOpenExternal: (url) => this.openExternalUrl(url),
        });
        modal.open();
    }

    /** 删掉当前正在用的那一档后，把设置里的模型路径清掉（否则转写会对着不存在的文件跑） */
    private displayAsrHintAfterRemove(preset: AsrModelPreset): void {
        const cur = String(this.settings.asrModelPath ?? '');
        if (!cur) return;
        if (cur === this.asrModelPathOf(preset)) {
            this.settings.asrModelPath = '';
            void this.saveSettings();
        }
    }

    /**
     * 本地语音转文字（宿主侧实现，供选集页 🎙️ 按钮调）。
     *
     * 🔴 用户 m01938 的完整流程由执行层 `transcribeWithWhisper` 包办：
     *    ffmpeg 抽 16k 单声道 wav → whisper.cpp `-osrt` 写 SRT → 读回正文 → 删中间 wav。
     *    宿主这层只做三件执行层做不了的事：
     *    ① **路径换算**（库内相对 / 系统绝对 → 系统绝对，见 `videoAbsPath`）；
     *    ② **配置读取**（模型 / 可执行文件 / 语言 / 线程数全来自设置页）；
     *    ③ **人话兜底**（`asrModelMissingMessage` 系文案已保证不出现技术黑话堆砌）。
     *
     * ⚠️ 配置不全时**不进执行层**：直接返回引导文案 —— 让用户看到「去设置页填模型」
     *    比看到一个 `spawn whisper ENOENT` 有意义得多（用户避坑指南：绝不出现红色报错）。
     * ⚠️ `onProgress` 原样透传：视图层拿它画那条细横幅（⛔ 宿主不自己画 UI）。
     */
    private async transcribeCue(req: {
        videoPath: string;
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void;
        cancel: AsrCancelHandle;
    }): Promise<{ ok: boolean; message: string; cancelled?: boolean; srtPath?: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '本地转写需要在电脑版 Obsidian 里使用' };
        const s = this.settings;
        const abs = this.videoAbsPath(req.videoPath);
        if (!abs) return { ok: false, message: '找不到这一集的本地文件' };

        // 🔴 用户 m09995：「转录中还是…也不浮窗显示」。
        //    浮球挂在宿主这层，⛔ 不能挂视图：用户切走笔记时视图会被卸载，
        //    而「切到别的笔记去工作」正是这颗球存在的全部理由（m01938 原话）。
        // ⚠️ 包一层而不是替换：视图层那条横幅仍然要收到同一份进度（两处显示互不依赖）。
        const ball = startProgressBall('正在准备转写');
        let lastDetail = '';
        // 🔴 用户 m12504：「转写不渲染出实时出句啊。
        //    根因就在这一行签名：这里3 个形参，`line` 被静默丢。
        //    服务层明明已经在回调4 参里逐句回吐（whisper/SenseVoice/Qwen3 三条链路都做了）。
        //    视图层也已经onProgress 4 参里 `appendCueTranscribeLine`。
        //    但宿主这层的中转把它吃了，于是面板永远停在「马上出第一句」。
        //    ⚠️ 别为了「进度文案够用」把 `line` 去掉：横幅负责百分比，`line` 负责逐句正文，两件事。
        const report = (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ): void => {
            req.onProgress(percent, label, detail, line);
            const d = detail ?? '';
            if (d) lastDetail = d;
            ball.update({ label, percent, detail: d || lastDetail });
        };

        // 🔴 按用户选的引擎分派（用m04641「按需加载，要有不能没有」）。
        //    六家共用同一套「进度回+ 成败人话」外壳，内部链路完全不同。
        //    - whisper：插件自己起 ffmpeg + whisper-cli。
        //    - SenseVoice：插件自己起 sherpa-onnx + ffmpeg*不需Python**（m11073）
        //    - Paraformer / X-ASR：插件自己起 sherpa vad-with-*-asr + ffmpeg（VAD 分段）
        //    - Confucius4：插件自己起 llama-mtmd-cli + gguf*结果stdout**）
        //    - Qwen3-ASR：起用户自备python 桥接，脚本自己搞定抽识别/对齐/写盘。
        const engine = engineDefOf(s.asrEngine).id;
        if (engine === 'sensevoice') {
            const native = await this.transcribeSenseVoiceNative(abs, report, req.cancel);
            if (native.ok) ball.done('字幕已保存');
            else if (native.cancelled) ball.dismiss();
            else ball.fail(native.message);
            return native;
        }
        if (engine === 'paraformer' || engine === 'xasr') {
            const native = await this.transcribeSherpaVadNative(engine, abs, report, req.cancel);
            if (native.ok) ball.done('字幕已保存');
            else if (native.cancelled) ball.dismiss();
            else ball.fail(native.message);
            return native;
        }
        if (engine === 'confucius') {
            const native = await this.transcribeLlamaNative(abs, report, req.cancel);
            if (native.ok) ball.done('字幕已保存');
            else if (native.cancelled) ball.dismiss();
            else ball.fail(native.message);
            return native;
        }
        if (engine !== 'whisper') {
            // 走到这里只剩 Qwen3-ASR（SenseVoice 上面已经 return 了）。
            // 别把 `engine` 直接传下去：签名已收窄成只收 'qwen3'，这是故意的 
            //    让「再SenseVoice 接回 Python 桥接」这件事在类型层面就通不过。
            const viaBridge = await this.transcribeViaBridge('qwen3', abs, report, req.cancel);
            // 桥接系自己会把「停止」反映成 cancelled，只有真失败才留下红色结果。
            if (viaBridge.ok) ball.done('字幕已保存');
            else if (viaBridge.cancelled) ball.dismiss();
            else ball.fail(viaBridge.message);
            return viaBridge;
        }

        // 🔴 框里没模型：模型是插件自己下到固定目录（现在*插件目录**下的 `models/`）的。
        //    框里空时先把那份找回来，否则「卡片绿了但转写说没模型」（m05462 的另一半）。
        const modelPath = String(s.asrModelPath ?? '').trim() || this.asrModelAuto();
        if (!modelPath) {
            ball.fail("还没有配置识别引擎");
            return { ok: false, message: "还没有配置识别引擎，请到「设置 → 高级设置 → 音频转文字」里选一档模型" };
        }

        const result = await transcribeWithWhisper(defaultAsrDeps(), {
            videoPath: abs,
            // 🔴 模型路径同样可能是库内相对路径（用户把 .bin 放进库里）⇒ 也走一次换算
            model: this.videoAbsPath(modelPath) || modelPath,
            // 🔴 自动探测的结果优先于「框里空着」：用户装好了但没填框时，这里必须把找到的路径递下去，
            //    否则探测只让卡片变绿、转写仍然 ENOENT —— 那正是 m05462 抱怨的「还得我自己配」。
            exe: this.asrAutoDetect().whisper || undefined,
            ffmpeg: this.asrAutoDetect().ffmpeg || undefined,
            lang: String(s.asrLang ?? '').trim() || undefined,
            threads: typeof s.asrThreads === 'number' ? s.asrThreads : undefined,
            onProgress: report,
            cancel: req.cancel,
        });
        if (!result.ok) {
            // ⚠️ 停止不该在右下角留一个红叉：那是用户自己按的，不是失。
            if (result.cancelled === true) ball.dismiss();
            else ball.fail(result.message);
            return { ok: false, message: result.message, cancelled: result.cancelled === true };
        }
        ball.done("字幕已保存");
        // 用户原话要求这一句：「✅ 转写完成！字幕已保存至视频同目录。
        // 🔴 m11423：必须把 `srtPath` 交出去，视图层才能调 `onSaveSubtitle` 写进
        //    `subtitlePaths`。只报「已保存」却不给路径 = 文件在那儿无人认领。
        return { ok: true, message: '✅ 转写完成！字幕已保存至视频同目录。', srtPath: this.toVaultRelPath(result.srtPath ?? '') };
    }

    /**
     * 🔴 用户 m11073：「明明配置了SenseVoice模型显示已就绪却说没找到运行程序」。
     *
     * 根因不是漏了个判据，是**设计矛盾**：`sherpa-onnx-offline.exe` 是静态链接的自足二进制
     * （真机复核：2MB 单个 exe，拷到空目录、干净 PATH 下仍能直接跑通识别），
     * 但插件一度把它发配到 Qwen3 的 Python 桥接里去执行 —— 于是三件套一键装好、状态变绿，
     * 一按转写却要求 Python + 脚本，而设置页的 SenseVoice 分支**根本没有这两个输入框**。
     *
     * 修法是把 SenseVoice 摘成**插件原生链路**：这里只负责路径换算与配置读取，
     * 抽轨 / 切段 / 逐段识别 / 拼 SRT 全在 `services/asrSenseVoice` 里做（纯 Node，无 Python）。
     * ⛔ 别再把它接回 `transcribeViaBridge`：那意味着用户为了「极速纯中文」还得先装一套 torch。
     */
    private async transcribeSenseVoiceNative(
        videoAbs: string,
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void,
        cancel: AsrCancelHandle,
    ): Promise<{ ok: boolean; message: string; cancelled?: boolean; srtPath?: string }> {
        const s = this.settings;
        // 三件套与自检同一真源（`asrEnginePaths`）：设置里填了用填的，没填就去安装目录找。
        // 🔴 一键安装刻*不写设置**（写死绝对路径换机器就失效），只读设置会得到「装完了还是红的」。
        const p = this.asrEnginePaths('sensevoice');
        if (!p.program) {
            return { ok: false, message: "还没有配置 SenseVoice 的识别程序，请到「沉浸体验 → 语音服务」里点一次安装" };
        }
        if (!p.model) {
            return { ok: false, message: "还没有配置 SenseVoice 的识别模型，请到「沉浸体验 → 语音服务」里点一次安装" };
        }
        if (!p.extra) {
            return { ok: false, message: "还没有配置 SenseVoice 的词表，请到「沉浸体验 → 语音服务」里点一次安装" };
        }
        // 这两个路径也可能是库内相对路径（用户把模型放进库里）都过一遍换。
        const r = await transcribeWithSenseVoice(defaultSenseVoiceDeps(), {
            videoPath: videoAbs,
            exe: this.videoAbsPath(p.program) || p.program,
            model: this.videoAbsPath(p.model) || p.model,
            tokens: this.videoAbsPath(p.extra) || p.extra,
            ffmpeg: this.asrAutoDetect().ffmpeg || undefined,
            lang: String(s.asrLang ?? '').trim() || undefined,
            threads: typeof s.asrThreads === 'number' ? s.asrThreads : undefined,
            onProgress,
            cancel,
        });
        if (!r.ok) return { ok: false, message: r.message, cancelled: r.cancelled === true };
        // 🔴 m11423：`srtPath` 必须交出去，否则视图层无从落库（文件在那儿无人认领）
        return { ok: true, message: '✅ 转写完成！字幕已保存至视频同目录。', srtPath: this.toVaultRelPath(r.srtPath ?? '') };
    }

    /**
     * Paraformer / X-ASR 的转写入口（两家共用一条执行层，差别只在 exe 与权重）。
     *
     * 🔴 为什么要 VAD 分段版 exe：实测 `sherpa-onnx-offline.exe --paraformer` 返回
     *    `"timestamps": []` —— 只有一整段文字、没有时间轴，做不出字幕条。
     *    `sherpa-onnx-vad-with-offline-asr.exe` 输出 `0.134 -- 0.940: text` 天然带时间轴。
     *    X-ASR 是流式 zipformer，必须用 `vad-with-online-asr` 版（喂 offline 版会 0xC0000409 崩溃）。
     */
    private async transcribeSherpaVadNative(
        engine: 'paraformer' | 'xasr',
        videoAbs: string,
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void,
        cancel: AsrCancelHandle,
    ): Promise<{ ok: boolean; message: string; cancelled?: boolean; srtPath?: string }> {
        const s = this.settings;
        // 六件套与自检同一真源（`asrEnginePaths`）：设置里没有槽位的引擎，路径全由安装目录推出。
        const p = this.asrEnginePaths(engine);
        const f = p.files ?? {};
        const abs = (v: string | undefined): string => {
            const raw = String(v ?? '').trim();
            return raw ? this.videoAbsPath(raw) || raw : '';
        };
        const result = await transcribeWithSherpaVad(defaultSherpaVadDeps(), {
            videoPath: videoAbs,
            mode: engine,
            exe: abs(f.program),
            tokens: abs(f.tokens),
            vadModel: abs(f.vad),
            paraformer: engine === 'paraformer' ? abs(f.model) : undefined,
            encoder: engine === 'xasr' ? abs(f.encoder) : undefined,
            decoder: engine === 'xasr' ? abs(f.decoder) : undefined,
            joiner: engine === 'xasr' ? abs(f.joiner) : undefined,
            ffmpeg: this.asrAutoDetect().ffmpeg || undefined,
            // ⛔ 不传 lang：Paraformer 与 X-ASR 三件套都**没有语言开关**
            //    （`--sense-voice-language` 只属 SenseVoice，transducer 的语言由权重决定）。
            //    硬塞会被 exe 当未知选项拒绝，整体转写失败。
            threads: typeof s.asrThreads === 'number' ? s.asrThreads : undefined,
            onProgress,
            cancel,
        });
        if (!result.ok) return { ok: false, message: result.message, cancelled: result.cancelled === true };
        return { ok: true, message: '✅ 转写完成！字幕已保存至视频同目录。', srtPath: this.toVaultRelPath(result.srtPath ?? '') };
    }

    /**
     * Confucius4 的转写入口（llama.cpp 的 `llama-mtmd-cli`）。
     *
     * 🔴 两个与 sherpa 系相反的坑，任一条踩了都表现为「什么都没有输出」：
     *    ① **结果在 stdout、日志在 stderr** —— sherpa 系正好相反，⛔ 不能复用它的 deps；
     *    ② 必须带同目录的 dll（只拷 exe 会静默失败，stdout/stderr 全空）。
     * ⚠️ 它上游没有时间戳，时间轴由 `pure/llamaAsr.textToSegments` 按句长比例反推 ——
     *    这是本家独有的取舍，⛔ 别指望在这里拿到字级对齐。
     */
    private async transcribeLlamaNative(
        videoAbs: string,
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void,
        cancel: AsrCancelHandle,
    ): Promise<{ ok: boolean; message: string; cancelled?: boolean; srtPath?: string }> {
        const s = this.settings;
        const p = this.asrEnginePaths('confucius');
        const abs = (v: string): string => (v ? this.videoAbsPath(v) || v : '');
        const result = await transcribeWithLlama(defaultLlamaDeps(), {
            videoPath: videoAbs,
            exe: abs(p.program),
            model: abs(p.model),
            mmproj: abs(p.extra),
            ffmpeg: this.asrAutoDetect().ffmpeg || undefined,
            threads: typeof s.asrThreads === 'number' ? s.asrThreads : undefined,
            onProgress,
            cancel,
        });
        if (!result.ok) return { ok: false, message: result.message, cancelled: result.cancelled === true };
        return { ok: true, message: '✅ 转写完成！字幕已保存至视频同目录。', srtPath: this.toVaultRelPath(result.srtPath ?? '') };
    }

    /**
     * Qwen3-ASR 的转写入口（唯一还需要 Python 桥接的一家）。
     *
     * 🔴 它自己完成「抽音轨 → 分段 → 识别 → 强制对齐 → 写 SRT」，
     *    插件只负责起进程、读协议、判成败 —— ⛔ 别在插件里再抽一次音轨（会白算一遍还要清临时文件）。
     * ⚠️ 输出 srt 落在**视频同目录**、与视频同名（`asrSrtPathFor` 同一口径），
     *    这样转写完成后面板的 `syncCueSource()` 能直接扫到它，不需要用户手动挑文件。
     */
    private async transcribeViaBridge(
        engine: 'qwen3',
        videoAbs: string,
        onProgress: (
            percent: number | null,
            label: string,
            detail?: string,
            line?: { start: number; end: number; text: string },
        ) => void,
        cancel: AsrCancelHandle,
    ): Promise<{ ok: boolean; message: string; cancelled?: boolean; srtPath?: string }> {
        const s = this.settings;
        const python = String(s.asrPythonPath ?? '').trim();
        const script = String(s.asrBridgeScript ?? '').trim();
        if (!python || !script) {
            // 🔴 这里只可能是 Qwen3：SenseVoice 走原生链路（`transcribeSenseVoiceNative`），压根不到这里。
            //    别为了「通用」把两家的缺失提示揉成一句话 —那正m11073 的起点。
            //    用户装好SenseVoice 却被要求去填 Python。
            return { ok: false, message: qwenMissingMessage() };
        }
        const out = asrSrtPathFor(videoAbs);
        if (!out) return { ok: false, message: '无法从视频路径推出字幕输出路径' };

        // SenseVoice 已改走原生链路（`transcribeSenseVoiceNative`），这里不再拼它的三件套 
        // 留着会让「用户选了极速版却把 sherpa 路径python 参数喂给 qwen3」这种错配重新出现。
        const result = await transcribeWithQwen(defaultQwenDeps(), {
            input: videoAbs,
            out,
            engine,
            // 这两个路径也可能是库内相对路径（用户把脚本放进库里）⇒ 都过一遍换算
            python: this.videoAbsPath(python) || python,
            script: this.videoAbsPath(script) || script,
            lang: String(s.asrLang ?? '').trim() || undefined,
            onProgress,
            cancel,
            // 🔴 m09432 之前这两个参数根本没传：`--model` 永远是脚本默认的 0.6B（1.7B 形同不存在），
            //    `--models-dir` 更是连参数都没有 —— 插件下到自己的目录、脚本却去项目目录找。
            //    `modelsDir` 传 Qwen3 的安装目录（其下就是 `Qwen3-ASR-*` 与 `Qwen3-ForcedAligner-0.6B`），
            //    与 `asrEnginePaths('qwen3').extra` 同一真源，⛔ 别在这里另拼一个路径。
            model: engine === 'qwen3' ? qwenVariantOf(s.asrQwenTier).tier : undefined,
            modelsDir: engine === 'qwen3' ? this.asrEngineDir('qwen3') : undefined,
        });
        if (!result.ok) return { ok: false, message: result.message, cancelled: result.cancelled === true };
        // 🔴 m11423：同样要把路径交出去（否Qwen3 转完也一样「文件在但没关联」）
        return { ok: true, message: '✅ 转写完成！字幕已保存至视频同目录。', srtPath: this.toVaultRelPath(result.srtPath ?? '') };
    }

    /**
     * 学习模式悬停查词：查设置里那个本地词典文件。
     *
     * 🔴 返回 `null` 是**正常路径**（没配词典 / 词不在表里），⛔ 不抛、不弹 Notice：
     *    用户只是在字幕上划过一个词，不该被任何提示打断。
     * ⚠️ 词典路径同样可能写成库内相对路径（用户把 csv 放进库里）⇒ 走一次 `videoAbsPath` 同源的换算；
     *    但换算失败时**退回原值**再试 —— 库外绝对路径场景 `toVaultRelPath` 会返回原值，不能因此判死。
     */
    private lookupWordInLocalDict(key: string): Promise<{ def: string; phonetic?: string } | null> {
        if (!Platform.isDesktopApp) return Promise.resolve(null);
        const raw = String(this.settings.dictPath ?? '').trim();
        if (!raw) return Promise.resolve(null);
        const path = this.videoAbsPath(raw) || raw;
        try {
            const r = lookupWordInDict(defaultDictDeps(), path, key);
            if (!r.entry) return Promise.resolve(null);
            return Promise.resolve({ def: r.entry.def, phonetic: r.entry.phonetic });
        } catch {
            return Promise.resolve(null);
        }
    }

    /** 视频所在目录的绝对路径（库内 = vault 根 + 相对路径；库外 = 自身目录）；解析失败返回空串 */
    private videoAbsDir(videoPath: string): string {
        try {
            const rel = this.toVaultRelPath(videoPath);
            const f = this.app.vault.getAbstractFileByPath(rel);
            if (f instanceof TFile) {
                const adapter = this.app.vault.adapter as FileSystemAdapter;
                const base = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
                return base ? dirOfPath(`${base}/${rel}`) : '';
            }
            return dirOfPath(videoPath);
        } catch {
            return '';
        }
    }

    /** 同目录字幕候选（fs 扫描 + pure/subtitle 匹配排序）；非桌面端/失败 → 空数组 */
    private async listSubtitleCandidates(videoPath: string): Promise<SubtitleCandidate[]> {
        if (!Platform.isDesktopApp) return [];
        const dir = this.videoAbsDir(videoPath);
        if (!dir) return [];
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            const names = await fs.readdir(dir);
            return pickSubtitleCandidates(fileNameOfPath(videoPath), names);
        } catch {
            return [];
        }
    }

    /** 读取字幕文件并转成 WebVTT（库内走 adapter、库外走 fs）；失败返回 null */
    private async readSubtitleAsVtt(subtitlePath: string): Promise<string | null> {
        try {
            const rel = this.toVaultRelPath(subtitlePath);
            const f = this.app.vault.getAbstractFileByPath(rel);
            let text: string | null = null;
            if (f instanceof TFile) {
                text = await this.app.vault.adapter.read(rel);
            } else if (Platform.isDesktopApp) {
                const fs = require('fs/promises') as typeof import('fs/promises');
                text = await fs.readFile(subtitlePath, 'utf8');
            }
            if (text === null) return null;
            return srtToVtt(text);
        } catch {
            return null;
        }
    }

    /**
     * 字幕文件是否还存在（用户 2026-10-29：关联弹窗里丢文件要标红）。
     *
     * 🔴 与 `readSubtitleAsVtt` **同一套路径口径**（库内 `getAbstractFileByPath`、库外 `fs`）——
     *    ⛔ 别另写一套判定，否则「读得到但显示丢失」这种自相矛盾就会出现。
     * ⚠️ 只读、不创建、不抛：任何异常一律当「不存在」（调用方只需布尔）。
     */
    private async subtitleFileExists(p: string): Promise<boolean> {
        const raw = String(p ?? '').trim();
        if (!raw) return false;
        try {
            const rel = this.toVaultRelPath(raw);
            if (this.app.vault.getAbstractFileByPath(rel) instanceof TFile) return true;
            if (!Platform.isDesktopApp) return false;
            const fs = require('fs/promises') as typeof import('fs/promises');
            // 库内没命中时，`raw` 也可能是绝对路径（库外字幕）直接 stat
            await fs.access(raw);
            return true;
        } catch {
            return false;
        }
    }

    /** 系统选择器挑字幕（.srt/.vtt）；取消/不可用返回 null */
    private async pickSubtitleFromSystem(): Promise<string | null> {
        const picked = await this.pickSystemFile(['srt', 'vtt'], '字幕文件', false);
        return picked ?? null;
    }

    /**
     * 系统选择器挑一份字幕并读回**原文**（给选集页时间轴面板用）。
     *
     * 🔴 与 `readSubtitleAsVtt` 的区别只在「返回之前不做格式转换」：
     *    面板要按扩展名自己选解析器（`.ass/.ssa` 走 ASS 解析，⛔ 转 VTT 会把 ASS 头整个丢掉）；
     *    `readSubtitleAsVtt` 那条仍原样服务 <track> 挂载，两条通路口径互不覆盖。
     */
    private async pickSubtitleRaw(): Promise<{ fileName: string; text: string } | null> {
        const picked = await this.pickSystemFile(['srt', 'vtt', 'ass', 'ssa'], '字幕文件', false);
        if (!picked) return null;
        try {
            const rel = this.toVaultRelPath(picked);
            const f = this.app.vault.getAbstractFileByPath(rel);
            let text: string | null = null;
            if (f instanceof TFile) {
                text = await this.app.vault.adapter.read(rel);
            } else if (Platform.isDesktopApp) {
                const fs = require('fs/promises') as typeof import('fs/promises');
                text = await fs.readFile(picked, 'utf8');
            }
            if (text === null) return null;
            return { fileName: fileNameOfPath(picked), text };
        } catch {
            return null;
        }
    }
    /** Obsidian app:// 自定义协议 ID（用 adapter.getResourcePath 推导，会话内缓存一次）。
     *  vault 内资源文件经此协议加载；协议处理器可读库外绝对路径（Chromium 自定义 scheme，流式） */
    private appSchemeId(): string {
        const cached = (this as unknown as { _rlAppId?: string })._rlAppId;
        if (cached) return cached;
        let id = '';
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            if (typeof adapter.getResourcePath === 'function') {
                const rp = adapter.getResourcePath('__dummy__');
                const m = /app:\/\/([^/]+)\//.exec(rp);
                if (m) id = m[1];
            }
        } catch {
            id = '';
        }
        (this as unknown as { _rlAppId?: string })._rlAppId = id;
        return id;
    }

    /** 尝试用 Media Extended 播放器打开 vault 外本地文件（file:// URL）：
     *  v3+ 暴露 api.openUrl() 编程入口；v4 若未暴露公开 api 则回退 mx-open URI 协议（ME 注册的 obsidian:// handler）。
     *  返回 false = ME 未启用 / 调用失败，由调用方回退系统播放器 */
    private async playWithMediaExtended(path: string): Promise<boolean> {
        // App.plugins 未在 obsidian 类型定义中公开 → 运行时断言访问（Obsidian 1.x 实际存在）
        const appWithPlugins = this.app as unknown as {
            plugins: {
                plugins: Record<string, { api?: { openUrl?: (url: string, newLeaf?: string) => Promise<void> } } | undefined>;
            };
        };
        const mx = appWithPlugins.plugins?.plugins?.['media-extended'];
        if (!mx) return false;
        const fileUrl = toFileUrl(path);
        try {
            if (typeof mx.api?.openUrl === 'function') {
                await mx.api.openUrl(fileUrl, 'tab');
                return true;
            }
        } catch { /* 无公开 api：继续尝试 URI 协议 */ }
        try {
            // 模拟点击 obsidian://mx-open 链接（Obsidian 主进程分发到 ME 的 URI handler）
            const a = document.createElement('a');
            a.href = `obsidian://mx-open?url=${encodeURIComponent(fileUrl)}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            return true;
        } catch { /* 回退系统播放器 */ }
        return false;
    }

    /** 系统文件选择器统一实现（Electron remote.dialog 返回绝对路径；toRel=true 转 vault 相对路径，库外保留绝对路径；input file 的 File.path 在 Obsidian 环境不可用）。
     *  会话内记忆上次选中目录（defaultPath 续接：第 1 集选了文件夹，第 2 集浏览仍从该目录弹起）。
     *  注：不再弹「从库中选择 / 从系统浏览」二选一——点「浏览」直接唤起系统文件管理器，少一步点击。
     *
     *  🔴 #460：新增 `fallbackDir` —— 「音频 / 书籍」这两类**目标目录固定**的字段（就是插件自己下载的去处），
     *     冷启动（首次打开 / 插件重载后 `lastSystemDir` 为空）此前一律落**系统默认**（Windows = 「下载」），
     *     用户看到的是「浏览本地音频怎么每次都在系统下载」。现在冷启动落到**设置里填的那个目录**；
     *     ⚠️ 一旦用户本次会话选过文件，仍**续接上次位置**（既有口径，逐集浏览那种场景要用）。 */
    private pickSystemFile(exts: string[], name: string, toRel: boolean, fallbackDir?: string): Promise<string | undefined> {
        if (!Platform.isDesktopApp) return Promise.resolve(undefined);
        return new Promise((resolve) => {
            try {
                const electron = require('electron') as {
                    remote?: { dialog?: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
                };
                const dialog = electron.remote?.dialog;
                if (dialog) {
                    void dialog
                        .showOpenDialog({
                            filters: [{ name, extensions: exts }],
                            // 🔴 #539 撤掉 #537 试过的「同时选文件与目录」组合：Electron 在 **Windows / Linux 上
                            //    不支持「既是文件选择器又是目录选择器」**（该组合只会弹目录选择器）⇒ 实测「漫画关联不了
                            //    图片文件夹、只能选单文件」正是这种平台差异。选目录改由**专用方法**（`pickBookFolderPath`）
                            //    走 `openDirectory` 明确分流。⛔ 别再把这个组合拿回来。
                            properties: ['openFile'],
                            defaultPath: this.lastSystemDir || fallbackDir || undefined,
                        })
                        .then((res) => {
                            const p = !res.canceled && res.filePaths[0] ? res.filePaths[0] : undefined;
                            if (p) this.lastSystemDir = dirnameOf(p);
                            resolve(p ? (toRel ? this.toVaultRelPath(p) : p) : undefined);
                        });
                } else resolve(undefined);
            } catch {
                resolve(undefined);
            }
        });
    }

    /**
     * 选**目录**（系统 `openDirectory`）—— 两个调用方共用这一份：
     *   · 「从文件夹检索剧集」（视频批量填集）；
     *   · 🔴 #524「检索本地书籍」（用户：「书籍检索文件目录给我**先弹出系统文件选择器让我选择目录**」）。
     * 🔴 三态返回值（调用方要据此分流，⛔ 别拿 `!dir` 一把抓）：
     *   `string` = 选中；`null` = **用户取消**；`undefined` = **本环境没有系统对话框**（非桌面端）——
     *   后者要「能力回落」到别的检索范围，取消则应当**什么都不做**。
     * ⚠️ 冷启动落点 = 上次浏览过的目录，其次 `fallbackDir`（调用方给该类的下载目录），最后系统默认。
     */
    pickDirPath(fallbackDir?: string): Promise<string | null | undefined> {
        if (!Platform.isDesktopApp) return Promise.resolve(undefined);
        return new Promise((resolve) => {
            try {
                const electron = require('electron') as {
                    remote?: { dialog?: { showOpenDialog(opts: unknown): Promise<{ canceled: boolean; filePaths: string[] }> } };
                };
                const dialog = electron.remote?.dialog;
                if (!dialog) {
                    resolve(undefined);
                    return;
                }
                void dialog
                    .showOpenDialog({
                        properties: ['openDirectory'],
                        defaultPath: this.lastSystemDir || fallbackDir || undefined,
                    })
                    .then((res) => {
                        const d = !res.canceled && res.filePaths[0] ? res.filePaths[0] : null;
                        if (d) this.lastSystemDir = d;
                        resolve(d);
                    });
            } catch {
                resolve(undefined);
            }
        });
    }

    /** 选视频文件夹（「从文件夹检索剧集」）：⚠️ 只认「选中」与「没选」两态（取消 / 无对话框都当没选） */
    async pickVideoDirPath(): Promise<string | undefined> {
        const d = await this.pickDirPath();
        return d || undefined;
    }

    /**
     * #534：选游戏目录（编辑表单「检索本地」—— 游戏那枚）—— 没有配置目录，冷启动锚点留空。
     * ⚠️ 只认「选中」与「没选」两态（取消 / 无对话框都当没选），与视频文件夹同口径。
     * 🔴 #602 起它是**全仓唯一**还走「当场挑文件夹」的本地检索（书籍改走分类目录、音乐走音频目录）——
     *    保留的依据见 `searchLocalBookFile` 那条注释（游戏按 #562 没有分类目录）。
     */
    async pickGameDirPath(): Promise<string | undefined> {
        const d = await this.pickDirPath();
        return d || undefined;
    }

    /**
     * 2026-11-16 用户：「我这个只有获取一个文件怎么办改成关联目录」——
     * 选一个**游戏文件夹**（主影片 + 关联资源都在里面），自动挑出主影片并关联。
     *
     * 🔴 为什么需要这条：原项目每个游戏一个文件夹，用户手上已经存好的游戏是**整个目录**；
     *    只让他挑单个 `.swf` 会丢掉「这个游戏还有哪些资源」这层信息。
     *    而且我们的「获取」现在也是按 `<游戏名>/` 一个目录落的 —— 两种来源汇成同一个形状。
     *
     * 三态（与 `pickDirPath` 同口径，⛔ 别拿 `!dir` 一把抓）：
     *   · 选中且找到 swf ⇒ 返回**库内相对路径**（库外则返回绝对路径，与 `gameSwf` 容错口径一致）；
     *   · 选中但目录里没有 swf ⇒ `null`（调用方提示「这个目录里没有 .swf」，不是取消）；
     *   · 取消 / 无系统对话框 / 读目录失败 ⇒ `undefined`。
     *
     * ⚠️ 主影片由纯层 `pickMainSwf` 挑（只有一个就选它；多个优先顶层、再优先 `index/main/game/start`）。
     *    猜错不要紧：浮层里那个输入框仍可手填具体路径。
     */
    async pickGameSwfFromDir(): Promise<string | null | undefined> {
        const dir = await this.pickGameDirPath();
        // 取消（pickDirPath 里 `null`）与「没有系统对话框」（`undefined`）对调用方都是「别动」
        if (!dir) return undefined;
        const files = this.collectFilesInDir(dir, isFlashPath);
        const picked = pickMainSwf(files.map((f) => f.path));
        if (!picked) return null;
        return picked;
    }

    /**
     * #534：列出用户刚挑的目录里的**可启动文件**（游戏「检索本地」）。
     * 判据在 `pure/gameLaunch.isGameLaunchPath`（.lnk/.exe/.bat/.cmd/.app/.sh；⛔ 与书籍扩展名集合分开）。
     * 其余口径（子目录深度 ≤ 4、忽略隐藏、库内/库外路径转换、失败返回 `[]`）与书籍那条**共用同一个 walk**。
     */
    async listGameLaunchFilesInDir(dir: string): Promise<LibraryBookFile[]> {
        return this.collectFilesInDir(dir, isGameLaunchPath);
    }

    /**
     * 在目录里按扩展名收集文件（支持子目录，深度 ≤ 4；忽略隐藏项）—— 书籍 / 游戏两个入口**共用的唯一 walk**。
     * 🔴 抽出来是因为原先只有书籍一份；再加游戏时若照抄一遍 ⇒ 两条 walk 必然漂（深度、隐藏、路径转换三处最容易分叉）。
     * `path` 与「浏览」同口径：库内 → 库内相对路径；库外 → 系统绝对路径（`toVaultRelPath` 认得出才转）。
     * 目录不存在 / 不可读 / 非桌面 ⇒ `[]`（调用方提示，⛔ 不抛）。
     */
    private collectFilesInDir(dir: string, accept: (name: string) => boolean): LibraryBookFile[] {
        const d = String(dir ?? '').trim();
        if (!d || !Platform.isDesktopApp) return [];
        const out: LibraryBookFile[] = [];
        try {
            const fsMod = require('fs') as { readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
            const sep = d.includes('/') ? '/' : '\\';
            const walk = (abs: string, depth: number): void => {
                if (depth > 4) return;
                for (const ent of fsMod.readdirSync(abs, { withFileTypes: true })) {
                    if (ent.name.startsWith('.')) continue;
                    const child = `${abs.replace(/[\\/]+$/, '')}${sep}${ent.name}`;
                    if (ent.isDirectory()) walk(child, depth + 1);
                    else if (accept(ent.name)) out.push({ path: this.toVaultRelPath(child), name: ent.name });
                }
            };
            walk(d, 0);
            out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        } catch {
            return [];
        }
        return out;
    }

    /**
     * #563 「单集本地检索」—— 编辑浮层「本地路径」标签旁那枚小图标按钮的宿主实现。
     *
     * 用户原话：「点一下要自动去设置页前置填写的媒体库目录路径里（含多层嵌套）递归搜索当前集的
     * 视频文件，并直接自动填入绝对路径」＋「这个不同类型条目检索不同的路径目录」。
     *
     * 流程：条目类型 → 分类目录键（`localDirKeyFor`）→ 读设置（`localDirOf`）→ 解析成系统绝对路径
     * （`resolveLocalDirAbs`，库内相对 / 系统绝对都认）→ **递归扫**（复用 `collectFilesInDir`，
     * 深度 ≤ 4、忽略隐藏项，与书籍 / 游戏两条检索**同一份 walk**）→ 按集号（+集标题加权）挑一条
     * （`pickLocalEpisode`）。
     *
     * 🔴 返回值分三种，**组件必须能区分**：
     *    · `ok`        → 填入路径；
     *    · `'nodir'`   → 该分类**没配目录**（或游戏这种压根没有目录的）⇒ 弹「去设置页配置」的警告；
     *    · `'notfound'`→ 配了但没找到这一集 ⇒ 只说没找到（⛔ 别混进上面那条，会把人支使去改设置）。
     * ⚠️ 扩展名判据按分类分叉：影视 → 可关联视频；文学/网文/漫画 → 可关联书籍；音乐 → 可关联音频。
     *    ⛔ 别用「一把梭」的扩展名集合 —— 那会让视频目录里的 `.nfo`/`.srt` 也进候选。
     * ⚠️ 路径口径与「浏览」按钮**一致**（库内 → 库内相对；库外 → 系统绝对，见 `toVaultRelPath`）。
     */
    async searchLocalEpisode(opts: LocalEpisodeQuery): Promise<LocalEpisodeOutcome> {
        const key = localDirKeyFor(opts.type, opts.bookKind);
        if (!key) return { ok: false, reason: 'nodir' };
        const abs = resolveLocalDirAbs(this.vaultBasePath(), localDirOf(this.settings, key));
        if (!abs) return { ok: false, reason: 'nodir' };
        const files = this.collectFilesInDir(abs, localDirAccept(key));
        const picked = pickLocalEpisode(files, opts.epIndex + 1, opts.epTitle || opts.title, opts.isMovie);
        return picked ? { ok: true, path: picked.path } : { ok: false, reason: 'notfound' };
    }

    /**
     * 🔴 #602 书籍「按标题检索本地文件」—— **唯一入口**（快捷关联弹窗与编辑表单 `findLibraryBook` 都走它）。
     *
     * 用户原话：「书籍关联入口这个小图标按钮怎么是选文件夹关联的，统一成检索关联」（问答里裁定「两处一起改」）。
     * ⇒ 书籍那枚 `folder-search` 不再「先弹系统目录选择器」（#524 那套两段式**对书籍作废**），换成与
     *    `searchLocalEpisode` **同一条链**：条目 → 分类目录键（`localDirKeyFor('book', bookKind)`，
     *    文学 / 网文 / 漫画三档）→ 读设置（`localDirOf`）→ 绝对路径（`resolveLocalDirAbs`）→ 递归扫
     *    （`collectFilesInDir` + 该分类的扩展名判据）→ 标题匹配（`pure/libraryBooks.pickLibraryBook`，
     *    与下载排序 / #417 那把相似度尺**同一份**）。
     *
     * ⛔ 三个「不」：⛔ 不判平台（`collectFilesInDir` 里已门控）、⛔ 不另写相似度、⛔ 不在这里拼第二份目录路径
     *    （目录真源只有 `pure/localDirs` 那一份）。
     * ⚠️ **游戏不走这条**（按 #562 它没有分类目录 ⇒ 本地关联就是「当场挑一个文件夹」，见
     *    `searchLocalForAssociate` 的游戏分支）—— ⛔ 别为「对称」给它硬造一个设置项。
     * ⚠️ 没配目录 / 目录里没文件 / 没找到同名 ⇒ 一律折成 `notice` 交回调用方（⛔ 别静默什么都不做）。
     */
    async searchLocalBookFile(q: LocalBookSearchQuery): Promise<LocalFileSearchOutcome> {
        const title = q.title?.trim() ?? '';
        if (!title) return { notice: '标题为空，先填标题再检索' };
        const key = localDirKeyFor('book', q.bookKind);
        if (!key) return { notice: '这一类没有配置本地目录，无法检索' };
        const dir = localDirOf(this.settings, key);
        if (!dir) return { notice: `还没设置「${LOCAL_DIR_LABELS[key]}」，先去设置页填一个目录${LOCAL_DIR_LABELS[key]}」，先去设置页填一个目录` };
        const abs = resolveLocalDirAbs(this.vaultBasePath(), dir);
        if (!abs) return { notice: `「${LOCAL_DIR_LABELS[key]}」不是有效路径，去设置页检查一下` };
        const files = this.collectFilesInDir(abs, localDirAccept(key));
        if (files.length === 0) return { notice: `${LOCAL_DIR_LABELS[key]}（${dir}）里没有可关联的书籍文件` };
        const { best, ranked } = pickLibraryBook(files, title, q.author?.trim() ?? '');
        if (!best) return { notice: `${LOCAL_DIR_LABELS[key]}（${dir}）里没找到与「${title}」同名的书籍文件` };
        return { path: best.path, name: best.name, count: ranked.length };
    }

    /**
     * 🔴 #601/#602 快捷关联弹窗「本地路径」标签旁那枚检索（`folder-search`）的宿主出口 —— **三类分流**：
     *    · 书籍 ⇒ `searchLocalBookFile`（#602：按子分类直接检索设置里的分类目录，**不问用户**）；
     *    · 音乐 ⇒ 音频目录（`listLibraryAudioFiles` 走 **vault API** ⇒ 移动端照样能用）+ `pickLibraryAudio`
     *      —— ⛔ 别顺手把它也改成 fs 扫盘（那会平白砍掉移动端这条路，用户没要求）；
     *    · 游戏 ⇒ **当场挑一个文件夹**（`pickGameDirPath` → `listGameLaunchFilesInDir` → 同一把匹配尺）
     *      —— #562 定过游戏没有「分类目录」，#602 问答里也裁定**保持原样**。
     * ⛔ 弹窗侧不判平台、不另写相似度；所有分支一律折成 `notice` 交回（用户取消 ≠ 出错，⛔ 别静默）。
     */
    async searchLocalForAssociate(entry: MediaEntry): Promise<LocalFileSearchOutcome> {
        if (entry.type === 'book') {
            return this.searchLocalBookFile({
                bookKind: entry.bookKind,
                title: entry.title ?? '',
                author: entry.author,
            });
        }
        const title = entry.title?.trim() ?? '';
        if (!title) return { notice: '标题为空，先填标题再检索' };
        if (entry.type === 'music') {
            const files = this.listLibraryAudioFiles();
            if (files.length === 0) return { notice: '音频文件目录里还没有音频文件' };
            const { best, ranked } = pickLibraryAudio(files, title, entry.author?.trim() ?? '');
            if (!best) return { notice: `音频文件目录里没找到与「${title}」同名的音频` };
            return { path: best.path, name: best.name, count: ranked.length };
        }
        // 游戏：当场挑一个文件夹（上面已门控桌面端 ⇒ 这里的 undefined 只可能是「用户取消」）
        const dir = await this.pickGameDirPath();
        if (!dir) return { notice: '未选择目录，已取消检索' };
        const files = await this.listGameLaunchFilesInDir(dir);
        if (files.length === 0) return { notice: `${dir} 里没有可关联的文件` };
        const { best, ranked } = pickLibraryBook(files, title, entry.author?.trim() ?? '');
        if (!best) return { notice: `${dir} 里没找到与「${title}」同名的文件` };
        return { path: best.path, name: best.name, count: ranked.length };
    }

    /**
     * 🔴🔴 2026-10-21 二轮（用户：「关联入口网络地址回填要的是**可播放的网络**，如 B站 搜索」）：
     *    快捷关联弹窗音乐「网络地址」那枚 `globe` 的宿主出口 —— **在线曲库检索**。
     *
     * 与「下载歌曲」窗口、音乐表单的在线曲库栏**同一条链**（`dlSearchSongs` ⇒ `songLibraryResults`），
     * ⛔ 不另拼一份四平台请求。回传 `sourceUrl` = **平台页链接**（打开即可试听）——
     * 这正是用户要的「可播放」，⛔ 不是豆瓣专辑资料页（上一版就是这么被否掉的）。
     * 门控与曲库栏同源（`canUseSongLibrary()` = 桌面端 + 内置播放器 + 曲库开关）。
     * ⚠️ 错误一律折成一句人话回传（弹窗只负责展示），⛔ 不抛给用户看堆栈。
     */
    async searchSongLibraryForAssociate(keyword: string): Promise<PlayableCandOutcome> {
        const q = keyword.trim();
        if (!q) return { cands: [], error: '检索词为空，先填歌名（或歌名 + 歌手）' };
        if (!this.canUseSongLibrary()) return { cands: [], error: '在线曲库需要桌面端、开启「内置音乐播放器」与曲库检索' };
        try {
            const { songs } = await this.dlSearchSongs(q);
            const cands = songLibraryResults(songs)
                .map((r) => ({
                    title: r.title,
                    sub: [r.artist, r.album].filter(Boolean).join(' · ') || SONG_LIB_LABEL,
                    url: String(r.sourceUrl ?? '').trim(),
                }))
                .filter((c) => c.url !== '');
            if (cands.length === 0) return { cands: [], error: `在线曲库没搜到「${q}」，换个歌名试试` };
            return { cands };
        } catch (e) {
            return { cands: [], error: `曲库检索失败：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    /** vault 根的系统绝对路径（拿不到 ⇒ 空串）。⚠️ 与 `toVaultRelPath` / `downloadDirSystemPath` 同源取法 */
    private vaultBasePath(): string {
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            return typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
        } catch {
            return '';
        }
    }

    /** 读视频文件夹内可识别集号的视频文件（快捷关联弹窗/编辑表单批量检索用）：过滤可关联容器扩展名 →
     *  pure 集号解析 → 按集号升序返回 {ep, path, name}（path 与所在目录同分隔风格，供 episodeFiles 保位填充）。
     *  目录不可读/非桌面 → []（调用方提示）。 */
    async scanEpisodeDir(dir: string): Promise<{ ep: number; path: string; name: string }[]> {
        if (!dir || !Platform.isDesktopApp) return [];
        try {
            const fsMod = require('fs') as { readdirSync(p: string): string[] };
            const names = fsMod.readdirSync(dir);
            const extOk = (n: string): string | undefined => {
                const dot = n.lastIndexOf('.');
                return dot > 0 ? n.slice(dot + 1).toLowerCase() : undefined;
            };
            const vids = names.filter((n) => {
                const ext = extOk(n);
                return !!ext && (VIDEO_ASSOCIABLE_EXTENSIONS as readonly string[]).includes(ext);
            });
            const hits = scanEpisodeNumbers(vids).sort((a, b) => a.ep - b.ep);
            const sep = dir.includes('/') ? '/' : '\\';
            const base = dir.replace(/[\\/]+$/, '');
            return hits.map((h) => ({ ep: h.ep, name: h.name, path: `${base}${sep}${h.name}` }));
        } catch {
            return [];
        }
    }

    /**
     * #460：某类下载目录在**系统里的绝对路径**（系统选择器 `defaultPath` 锚点）。拿不到 / 目录还不存在 ⇒ undefined
     * （退回系统默认，⛔ 别硬编路径）。
     * ⚠️ 路径拼接走纯函数 `pure/downloadPlan.downloadDirAbsPath`（与落盘 / 检索同一个 `downloadDir`）——
     *    ⛔ 别在这里另拼一份，否则设置页改完目录这里会指到旧地方。
     */
    private downloadDirSystemPath(root: string | undefined, kind: DownloadKind): string | undefined {
        try {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            const base = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : '';
            const abs = downloadDirAbsPath(base, root, kind);
            if (!abs) return undefined;
            const fsMod = require('fs') as { existsSync(p: string): boolean };
            return fsMod.existsSync(abs) ? abs : undefined;
        } catch {
            return undefined;
        }
    }

    /** 选本地视频：系统播放器需绝对路径，不转相对（可关联格式统一见 pure/mediaExtensions.VIDEO_ASSOCIABLE_EXTENSIONS） */
    async pickLocalVideoPath(): Promise<string | undefined> {
        return this.pickSystemFile([...VIDEO_ASSOCIABLE_EXTENSIONS], '视频', false);
    }

    /** 选本地音频（音乐条目）：可关联格式统一见 `pure/mediaExtensions.AUDIO_ASSOCIABLE_EXTENSIONS`（④ 收进真源，原先在此硬编码）。
     *  🔴 #460：冷启动锚点 = 设置页「音频文件目录」的绝对路径（⛔ 别让它再落系统「下载」）。 */
    async pickLocalAudioPath(): Promise<string | undefined> {
        return this.pickSystemFile(
            [...AUDIO_ASSOCIABLE_EXTENSIONS],
            '音频',
            true,
            this.downloadDirSystemPath(this.settings.musicDownloadDir, 'music'),
        );
    }

    /** 选书籍文件（TXT/EPUB/PDF/CBZ/CBT）｜🔴 #460：冷启动锚点 = 「书籍文件目录」绝对路径（同音频那枚）
     *  🔴 #539：**只选文件**。漫画的「散装文件夹型」改由 `pickBookFolderPath()` 那枚专用入口走目录选择器 ——
     *     Electron 在 Windows/Linux 上不能同时选文件与目录（实测会退化成只能选文件）。 */
    async pickBookFilePath(): Promise<string | undefined> {
        return this.pickSystemFile(
            ['txt', 'epub', 'pdf', 'cbz', 'zip', 'cbt', 'tar'],
            '电子书 / 漫画',
            true,
            this.downloadDirSystemPath(this.settings.bookDownloadDir, 'book'),
        );
    }

    /**
     * #539 选**漫画图片文件夹**（「散装文件夹型」= 一个装满图片的文件夹，把**这个文件夹本身**关联成书）。
     *
     * 🔴 为什么必须与「浏览」分成两枚入口：Electron 的 `showOpenDialog` 在 **Windows / Linux 上不能同时**
     *    选文件与目录（组合形态只会给出目录选择器，实测还会退化成只能选文件）
     *    ⇒ 与其赌平台差异，不如**明确分流**：文件走 `pickBookFilePath`（`openFile`），目录走这一枚（`openDirectory`）。
     * 口径与「浏览」选文件一致：库内转**库内相对路径**（`toVaultRelPath`），库外保留绝对路径。
     * ⚠️ 三态原样透传（`string` 选中 / `null` 用户取消 / `undefined` 本环境没有系统对话框），⛔ 别拿 `!dir` 一把抓。
     */
    async pickBookFolderPath(): Promise<string | null | undefined> {
        const d = await this.pickDirPath(this.downloadDirSystemPath(this.settings.bookDownloadDir, 'book'));
        if (typeof d !== 'string') return d;
        return this.toVaultRelPath(d);
    }

    /** 选游戏启动快捷方式（.lnk） */
    async pickGameLaunchPath(): Promise<string | undefined> {
        return this.pickSystemFile(['lnk'], '游戏快捷方式', true);
    }

    /** 选本地 Flash 影片（.swf；2026-11-16「先在插件内玩本地 swf」的入口） */
    async pickGameSwfPath(): Promise<string | undefined> {
        return this.pickSystemFile(['swf'], 'Flash 影片', true);
    }

    /**
     * 编辑表单「获取」按钮的宿主侧入口：弹窗问「游戏详情页地址」→ `fetchGameSwf` 抓取下载 →
     * 把库内相对路径交回表单（由表单回填输入框并立即落进表单态）。
     *
     * 🔴 为什么宿主来弹窗、而不是表单自己开：地址校验 / 抓取 / 失败解释都在 `fetchGameSwf` 一处，
     *    表单只该显示结果（⛔ 别在 UI 层再复制一套地址规则）。
     * 🔴 `entryId` 传 `undefined`：编辑表单可能是**还没保存的新条目**（没有 id 可写），
     *    此时只把文件下到库内、把路径交回表单，最终由「保存并生成笔记」落库 —— 与手动输路径同一归宿。
     *    ⚠️ 标签页场景同理：用户点了获取就该看到「已下载」，⛔ 别让下载白费。
     */
    async promptFetchGameSwf(entryId?: string): Promise<{ ok: boolean; message: string; relPath?: string }> {
        const url = await new TextPromptModal(this.app, {
            title: '获取 Flash 影片',
            placeholder: 'https://www.4399.com/flash/xxxxx.htm',
            okText: '获取',
            hint: '填游戏详情页地址（4399 / 7k7k / 17yy 或任意含 swf 的页面），会自动找出真实 swf 并下载到「设置 › 播放阅读 › 游戏目录」。',
            onSubmit: () => {},
        }).open();
        if (url === null) return { ok: false, message: '已取消获取' };
        return this.fetchGameSwf(url, entryId);
    }

    /**
     * 从**游戏详情页地址**里挖出真实 swf，下载进库，并（可选）回填条目的 `gameSwf`。
     * 2026-11-16（用户：「如何获取 swf 文件没有集成啊」）—— 上一版只做了「有 swf 就能玩」，
     * 这一步补上「怎么把 swf 弄到本地」。
     *
     * ## 链路
     * 取页面（浏览器 UA + Referer）→ 解码（GBK/UTF-8 自适应）→ `pure/flashFetch.parseFlashPage`
     * 挖地址（4399 `_strGamePath` / 7k7k `gamePath:` / `<param>` / `<embed>` / flashvars / 兜底正则）
     * → 若是「中间播放页」再抓一次 → `downloadToVault`（kind=`flash`，落 `下载/Flash 游戏`）
     * → 写进条目 `gameSwf`。
     *
     * ## ⛔ 不做的三件事（都是有意的）
     *  ① **不抓关联资源**：4399 那类游戏常把图片/音频拆成一堆同目录小文件，只拿主 swf 会缺资源。
     *     但「按目录批量猜文件名」是不可控的（参考项目要读站方 `.ini` 才知道清单），
     *     所以本版只取主影片，缺口写在提示里。
     *  ② **不覆盖已有文件**：`downloadToVault` 走 `uniqueDownloadName`，重名自动 `(2)`。
     *  ③ **不自动播放**：获取完只回填路径，用户自己点「▶ 启动」。
     */
    /**
     * 带「代理 → 直连」回退的 GET（返回 Buffer）。**全部网络抓取都必须走这里。**
     *
     * 🔴 为什么不能直接用 `nodeHttpGetBuffer(url, h, this.ytProxyFor())`：真机踩过两次同一个坑
     *    ——设置里配了代理（`http://127.0.0.1:7897`）但代理进程没开时，请求直接
     *    `connect ECONNREFUSED 127.0.0.1:7897`，而目标站点直连明明是通的。
     *    调用方拿到的是一个看起来像「站点打不开」的错误，用户完全看不出真因是本地代理。
     *    ⇒ 有代理就先代理、失败再直连；「代理挂了」不该被报成「网站挂了」。
     *
     * @param onFallback 第一次失败准备改直连时的回调（给 UI 一句人话）
     * @param onProgress 下载进度（已收字节 / 当前跳的 content-length；用户 m02844「做进度表」）
     */
    private async httpGetBufferWithFallback(
        url: string,
        headers: Record<string, string> | undefined,
        timeoutMs: number,
        onFallback?: (reason: string) => void,
        onProgress?: (received: number, total: number) => void,
    ): Promise<NodeHttpBufferResponse> {
        const proxy = this.ytProxyFor();
        const attempts: (string | undefined)[] = proxy ? [proxy, undefined] : [undefined];
        let lastErr: unknown = null;
        for (let i = 0; i < attempts.length; i += 1) {
            try {
                const r = await nodeHttpGetBuffer(url, headers, attempts[i], { timeoutMs, onProgress });
                if (r && r.status >= 200 && r.status < 300) return r;
                lastErr = new Error(`HTTP ${r?.status ?? '??'}`);
            } catch (e) {
                lastErr = e;
                if (i + 1 < attempts.length) {
                    onFallback?.(e instanceof Error ? e.message : String(e));
                }
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error('请求失败');
    }

    /**
     * 带「代理 → 直连」回退的 POST（返回文本）。与 `httpGetBufferWithFallback` 同一套纪律。
     *
     * 🔴 目前只有 17yy 的 `vip_ajax.php` 用它：那家的 swf 路径不在 HTML 里，
     *    必须 POST 一次 ajax 才拿得到 `data.game_path`（口径来自原项目 `HtmlAnalyse`）。
     *    ⛔ 别为了省事把 POST 写成 GET —— 那个端点对 GET 回的是空 JSON。
     */
    private async nodeHttpPostWithFallback(
        url: string,
        headers: Record<string, string> | undefined,
        body: string,
        timeoutMs: number,
    ): Promise<NodeHttpResponse | null> {
        const proxy = this.ytProxyFor();
        const attempts: (string | undefined)[] = proxy ? [proxy, undefined] : [undefined];
        let lastErr: unknown = null;
        for (const p of attempts) {
            try {
                const r = await nodeHttpPost(url, body, headers, p);
                if (r && r.status >= 200 && r.status < 300) return r;
                lastErr = new Error(`HTTP ${r?.status ?? '??'}`);
            } catch (e) {
                lastErr = e;
            }
        }
        void lastErr;
        return null;
    }

    async fetchGameSwf(
        pageUrl: string,
        entryId?: string,
        onProgress?: (label: string) => void,
    ): Promise<{ ok: boolean; message: string; relPath?: string }> {
        const report = (label: string): void => {
            try {
                onProgress?.(label);
            } catch {
                /* 回调炸了不影响下载 */
            }
        };
        if (!Platform.isDesktopApp) return { ok: false, message: '获取功能仅支持桌面端' };
        // 🔴 用户从地址栏复制常拿到**分类页外壳**：7k7k 的 `/flash/` 实际详情在 `/swf/`，
        //    17yy 的 `/f/` 实际在 `/f/play/`（口径来自原项目 `HtmlAnalyse`）。
        //    不纠正的话这两家会一直回「页面里没找到 swf 地址」，用户以为是插件坏了。
        const url = normalizeGamePageUrl(String(pageUrl ?? '').trim());
        if (!isFetchableUrl(url)) return { ok: false, message: '要填游戏详情页的 http(s) 地址' };

        // 🔴 必须带 UA 与 Referer：4399 / 7k7k 对空 UA 的 Node 请求会直接回空页或跳验证页
        //    （与音视频关联同一口径：⛔ 不要退回 `requestUrl`，Electron 网络栈对部分站点会被识别为爬虫）。
        const pageHeaders: Record<string, string> = {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Referer: url,
        };

        const getPage = async (target: string): Promise<string | { error: string }> => {
            try {
                const r = await this.httpGetBufferWithFallback(
                    target,
                    { ...pageHeaders, Referer: target },
                    30_000,
                );
                if (!r || r.status < 200 || r.status >= 300) return { error: `打不开页面：HTTP ${r?.status ?? '??'}` };
                const ct = String((r.headers as Record<string, string>)['content-type'] ?? '');
                const html = decodeHtmlBytes(r.buffer, ct);
                if (looksLike404(html)) return { error: '页面是 404（游戏可能已下线，或地址填成了分类页）' };
                return html;
            } catch (e) {
                return { error: `打不开页面：${e instanceof Error ? e.message : String(e)}` };
            }
        };

        report('正在读取游戏页面');
        const first = await getPage(url);
        if (typeof first !== 'string') return { ok: false, message: first.error };

        let parsed = parseFlashPage(first, url);
        // 中间播放页：只再抓一层（4399 新版大多是这个结构）。⛔ 别写成循环 —— 那会变成爬全站。
        if (!parsed.swfUrl && parsed.subPageUrl) {
            report('正在读取播放页');
            const second = await getPage(parsed.subPageUrl);
            if (typeof second === 'string') parsed = parseFlashPage(second, parsed.subPageUrl);
        }
        // 🔴 17yy：swf 路径**不在 HTML 里**，要走它的 POST ajax（口径逐行核过原项目
        //    `HtmlAnalyse.Get17yySwfPathInNewPage`：POST `vip_ajax.php` 取 `data.game_path`，
        //    拼 `http://img1.17yy.com/swf/<category>/<latterpath>`）。
        //    原项目作者自己都注了「找不到足够的样本做实验」⇒ 这条链失败要给出可读原因，⛔ 别静默。
        if (!parsed.swfUrl && siteOf(url) === '17yy') {
            report('正在查询 17yy 影片地址');
            const ajax = parse17yyAjaxParams(first, url);
            if (ajax.gameId) {
                try {
                    const body = JSON.stringify({ action: 'getStatus', id: ajax.gameId });
                    const r = await this.nodeHttpPostWithFallback(
                        'http://www.17yy.com/e/payapi/vip_ajax.php',
                        {
                            'User-Agent': pageHeaders['User-Agent'],
                            Accept: 'application/json, text/javascript, */*; q=0.01',
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest',
                            Referer: url,
                        },
                        // 它认的是表单编码而不是 JSON：`action=getStatus&id=123`
                        `action=getStatus&id=${encodeURIComponent(ajax.gameId)}`,
                        20_000,
                    );
                    if (r && r.status >= 200 && r.status < 300) {
                        const data = JSON.parse(String(r.text ?? '').trim() || '{}') as {
                            data?: { game_path?: unknown };
                        };
                        const latter = String(data?.data?.game_path ?? '').trim();
                        const built = build17yySwfUrl(ajax.category ?? '', latter);
                        if (built) parsed = { swfUrl: built, via: 'script' };
                    }
                } catch {
                    /* 拿不到就落到下面统一的 reason，⛔ 不把 ajax 失败当成下载失败 */
                }
            }
        }
        // 🔴 H5 / Unity：没有 swf 可下载，但有能在 iframe 里跑的在线播放页
        //    （真机实测 4399 详情页无 X-Frame-Options / 无 CSP，嵌入可行）。
        //    ⇒ 不报错，改存 `gameEmbed`，点「▶ 启动」在 Flash 游戏标签页里内嵌打开。
        if (!parsed.swfUrl && parsed.embedUrl) {
            // 🔴 2026-11-16 用户报障：「启动暴走英雄坛开始游戏后就跳转浏览器了」。
            //    根因：4399 详情页的「开始游戏」是 `<a class="start-btn" href="//www.zxwyouxi.com/g/…">`
            //    + `window.open`，Electron 把新窗口交给系统浏览器 ⇒ 游戏跑出插件、也带不进存档。
            //    ⇒ 优先存**那一跳的真实游戏页**（实测同样无 XFO/CSP，嵌进去直接是游戏本体），
            //      省掉用户那次必然触发弹窗的点击；拿不到才退回 4399 详情页。
            const gamePage = parseGameEmbedPage(first, url);
            const embedUrl = gamePage || this.embedPageOf(url, parsed.embedUrl);
            if (!entryId) return { ok: false, message: '这是 H5 / Unity 游戏，需要先关联到一个游戏条目才能内嵌播放' };
            try {
                await this.service.update(entryId, { gameEmbed: embedUrl });
                await this.service.writeNote(entryId);
            } catch (e) {
                return { ok: false, message: `写回条目失败：${e instanceof Error ? e.message : String(e)}` };
            }
            await this.refreshViews();
            return {
                ok: true,
                message: gamePage
                    ? `这是 H5 / Unity 游戏，已改为内嵌它的游戏本体页：${embedUrl}`
                    : `这是 H5 / Unity 游戏，已改为内嵌播放：${embedUrl}`,
            };
        }
        if (!parsed.swfUrl) return { ok: false, message: parsed.reason ?? '页面里没找到 swf 地址' };

        const swfUrl = parsed.swfUrl;
        // 🔴 2026-11-16 用户报障：「swf 文件未重新命名为该游戏名称.swf」。
        //    真实站点给的末段毫无信息量（`04.swf` / `play.swf` / `index.swf`），落盘后一片同名难辨。
        //    ⇒ 有条目就拿「条目名.swf」（走 sanitizeDownloadName 洗非法字符 + 截断）；
        //      拿不到条目（尚未关联到某条）才退回 URL 末段。
        const entry = entryId ? await this.service.get(entryId).catch(() => undefined) : undefined;
        const gameName = String(entry?.title ?? '').trim();
        const filename = gameName ? `${sanitizeDownloadName(gameName)}.swf` : swfFileNameOf(swfUrl, 'flash-game');
        // 🟠 2026-11-17 ① SWF 载体目录约定（用户逐字）：「单文件无存档 SWF 直接放 `games/swf/` 统一管理，
        //    条目关联对应 `.swf`；单文件 SWF 有存档做独立目录…；多文件 SWF 做独立目录（含 swf），
        //    其下 `saves/` 放存档文件」。
        //    ⇒ 「游戏目录」设置项**不动**（用户裁定：只有内部结构约定，不迁移老库），
        //      内部按 `pure/gameLayout` 分两层：`<游戏目录>/swf/`（平铺）与 `<游戏目录>/<游戏名>/`（独立）。
        //    ⚠️ 「多文件」要到主影片字节下来、扫出资源名才知道 ⇒ 这里先按「单文件」判，
        //      真扫出资源了再**先搬后补**（见下面 `moveFlashToBundleDir` 那段），
        //      ⛔ 不能先补资源再搬：平铺区里两个游戏都有 `sounds/bgm.mp3` 时，后一个会被 `existing` 挡下、
        //        前一个的文件又会被搬走，两边的资源就都错位了。
        const gameFolder = gameName ? sanitizeDownloadName(gameName) : '';
        const baseDir = downloadDir(this.settings.gameDownloadDir, 'flash');
        // 「有存档」直接看落盘快照（`pluginDir()/saves/<entryId>.json` 非空）——
        // 这是用户那条「单文件有存档 ⇒ 独立目录」的唯一判据，⛔ 别用「玩过没」之类的间接信号。
        const savedBefore = entryId ? Object.keys(await this.loadGameSaves(entryId)).length > 0 : false;
        const layout = gameCarrierLayout({ multiFile: false, hasSaves: savedBefore });
        const gameDir = gameCarrierDir(baseDir, gameFolder, layout);
        report(`正在下载 ${filename}`);

        const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
        // 主影片字节先接住 —— 下面要靠它扫「这个游戏还引用了哪些相对资源」。
        let mainBytes: Uint8Array | undefined;
        const outcome = await downloadToVault(
            (u, headers) =>
                this.httpGetBufferWithFallback(u, { ...pageHeaders, ...(headers ?? {}), Referer: url }, 120_000),
            { write: (relPath, data) => this.writeBinaryFile(relPath, data) },
            {
                url: swfUrl,
                kind: 'flash',
                filename,
                taken,
                // 🔴 m02844：落点读设置页「播放阅读 › 启用内置游戏启动器 › 游戏目录」。
                //    2026-11-16 起再追加一层**游戏自己的文件夹**（`gameDir`）：一个游戏一个目录，
                //    主影片与关联资源混在一起也不会与别的游戏撞名。
                //    留空时 `downloadToVault` 会用 `DOWNLOAD_DIR_DEFAULT.flash`（`下载/Flash 游戏`）。
                root: gameDir,
                // 内容校验：swf 头部三选一（`FWS` 未压缩 / `CWS` zlib / `ZWS` LZMA）。
                // 🔴 很多站点把下架页面以 200 + HTML 返回，光看状态码会「下载成功」一个网页当影片。
                validate: (bytes) => {
                    const b = bytes ?? new Uint8Array(0);
                    if (b.byteLength < 8) return '下载到的不是 swf（文件太小）';
                    const sig = String.fromCharCode(b[0], b[1], b[2]);
                    if (sig !== 'FWS' && sig !== 'CWS' && sig !== 'ZWS') {
                        return '下载到的不是 swf（可能是网页或防盗链提示）';
                    }
                    mainBytes = b;
                    return null;
                },
            },
        );
        if (!outcome.ok || !outcome.relPath) return { ok: false, message: outcome.error ?? '下载失败' };

        let relPath = outcome.relPath;
        // 🟠 ① 多文件 SWF ⇒ 独立目录（用户逐字：「多文件 SWF 做独立目录（含 swf），其下 `saves/` 放存档文件」）。
        //    判据不用「几个文件」这种事后才知道的量，而是**主影片自己引用了多少相对资源** ——
        //    这正是「多文件」的定义，且字节已经在手上（`mainBytes`），不用再多跑一次 IO。
        //    ⚠️ 顺序必须是**先搬后补**：`fetchFlashAssets` 按主影片的父目录拼资源落点，
        //      搬完再补才会补进独立目录；反过来补，资源会留在 `swf/` 平铺区，
        //      两个游戏都引用 `sounds/bgm.mp3` 时后一个被 `existing` 挡下 ⇒ 两边资源全错位。
        const mainRefs = this.flashAssetRefs(swfUrl, mainBytes);
        if (shouldUpgradeToBundle(mainRefs.length) && entryId) {
            relPath = await this.moveFlashToBundleDir(relPath, baseDir, gameFolder, report);
        }
        // 关联资源：主影片成功之后再补，任何一个失败都只记数、不影响主影片已成功。
        const assetNote = await this.fetchFlashAssets(swfUrl, relPath, mainBytes, pageHeaders, report);
        // 2026-11-16 用户问「原项目还做了什么」→ 裁定补「留档原始 swf URL + 原生宽高」。
        // 🔴 原始 URL 必须在成功落盘时立刻写下：`fetchFlashAssets` 补抓关联资源全靠它当 base，
        //    而且文件名已按游戏标题改过（`04.swf` → `黄金矿工.swf`），原始末段只在这里还留着。
        //    宽高只认**成对且可信**的（`clampGameStage`），单边命中就整对丢弃。
        const rawStage = parseGameStage(first, url);
        const stage = clampGameStage(rawStage.width, rawStage.height);
        if (entryId) {
            try {
                await this.service.update(entryId, {
                    gameSwf: relPath,
                    gameSwfUrl: swfUrl,
                    ...(stage ? { gameWidth: stage.width, gameHeight: stage.height } : {}),
                });
                await this.service.writeNote(entryId);
            } catch (e) {
                return {
                    ok: false,
                    message: `已下载到「${relPath}」，但写回条目失败：${e instanceof Error ? e.message : String(e)}`,
                };
            }
            await this.refreshViews();
        }
        return {
            ok: true,
            message: `已获取并关联：${relPath}${assetNote}`,
            relPath,
        };
    }

    /**
     * 把主影片字节变成「可以扫字符串」的形态。
     *
     * 🔴 这一步是「关联资源」能否工作的分水岭（实测踩到）：4399 上的 swf 绝大多数是 **CWS**
     *    （zlib 压缩体），资源名全在压缩段里 —— 直接扫原始字节永远扫出 0 条，
     *    表现为「怎么下载出的就一个文件」。必须先解压再扫。
     *    · `FWS` 未压缩 ⇒ 原样返回；
     *    · `CWS` zlib ⇒ 跳过 8 字节文件头后 inflate；
     *    · `ZWS` LZMA ⇒ ⛔ 不解（要额外解码器，属过度工程），返回原字节（扫不到就退回单文件播放）。
     */
    private swfScanBytes(bytes: Uint8Array | undefined): Uint8Array | undefined {
        const b = bytes;
        if (!b || b.byteLength < 12) return b;
        const sig = String.fromCharCode(b[0], b[1], b[2]);
        if (sig !== 'CWS') return b;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const zlib = require('node:zlib') as typeof import('node:zlib');
            const out = zlib.inflateSync(Buffer.from(b.subarray(8)));
            return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
        } catch {
            // 解压失败（截断 / 非标准 zlib）⇒ 退回原始字节，扫描结果为空是正常结果
            return b;
        }
    }

    /**
     * 挑一个「适合嵌进 iframe」的页面地址（H5 / Unity 用）。
     *
     * 🔴 真机实测踩到的坑：解析时第二层抓到的是**游戏中间页**（`sda.4399.com/…/index.html`），
     *    它有 Referer 校验 —— 直接嵌进去只会白屏。而用户最初填的**详情页**
     *    （`www.4399.com/flash/<id>.htm`）没有 `X-Frame-Options` / 没有 CSP，嵌它能出整页，
     *    它自己再带 Referer 去取中间页，游戏就能跑。
     * ⇒ 优先返回「最初那条地址」（只要它是 4399 详情页形态），解析出来的中间页只当兜底。
     */
    private embedPageOf(originalUrl: string, parsedUrl: string): string {
        const orig = String(originalUrl ?? '').trim();
        // 4399 详情页形态：`…/flash/<数字>.htm`（`_2.htm` 播放页同样能嵌，也命中）
        if (/^https?:\/\/[^/]*4399\.com\/flash\/[0-9]+(_[0-9]+)?\.html?$/i.test(orig)) return orig;
        return String(parsedUrl ?? '').trim();
    }

    /**
     * 扫出主影片引用的**相对资源名**（纯读，失败返回空数组）。
     *
     * 抽出来是因为「多文件 / 单文件」的分流判据要用它，而判据必须在**补资源之前**拿到：
     * 先补再搬会让资源留在平铺区（两个游戏都引用 `sounds/bgm.mp3` 时互相顶掉）。
     */
    private flashAssetRefs(swfUrl: string, mainBytes: Uint8Array | undefined): string[] {
        try {
            const scan = this.swfScanBytes(mainBytes);
            return planAssetRefs(extractAssetRefs(scan), baseNameOf(swfUrl.split(/[?#]/)[0] ?? ''));
        } catch {
            return [];
        }
    }

    /**
     * 把已经落进平铺区 `swf/` 的主影片搬进独立目录（`<游戏目录>/<游戏名>/`）。
     *
     * 只有「主影片引用了关联资源」才会走到这里 —— 即用户说的「多文件 SWF」。
     * 搬不动就原地不动：单文件散在 `swf/` 里也能正常玩，⛔ 不许因为搬家失败把整次获取判成失败。
     */
    private async moveFlashToBundleDir(
        relPath: string,
        baseDir: string,
        gameFolder: string,
        report: (label: string) => void,
    ): Promise<string> {
        if (!isInSwfFlatDir(relPath)) return relPath;
        const fileName = relPath.split('/').pop() ?? '';
        if (!fileName) return relPath;
        const stem = gameFolder || fileName.replace(/\.swf$/i, '');
        const bundleDir = gameCarrierDir(baseDir, stem, 'bundle');
        if (!bundleDir || bundleDir === baseDir) return relPath;
        const nextPath = `${bundleDir}/${fileName}`;
        if (nextPath === relPath) return relPath;
        const file = this.app.vault.getAbstractFileByPath(relPath);
        if (!(file instanceof TFile)) return relPath;
        try {
            await this.ensureFolder(bundleDir);
            report(`正在把主影片移入独立目录：${stem}`);
            // ⛔ 不用 adapter.rename：fileManager 会顺带更新指向该文件的链接。
            await this.app.fileManager.renameFile(file, nextPath);
            return nextPath;
        } catch {
            return relPath;
        }
    }

    /**
     * 把主影片引用的**相对资源**补到同一目录（用户 m03437：「怎么下载出的就一个 swf 文件没有其他的吗」）。
     *
     * 参考项目 `FlashGameDownloader` 靠本地 HTTP 服务器拦截运行时请求；本插件的 Ruffle 跑在 `app://` 下，
     * 请求不经过我们 ⇒ 改用「同目录同相对名」回填：Ruffle 按 swf 自己的地址解析相对路径，
     * 只要 `sounds/bgm.mp3` 落在 swf 旁边，它就会命中。
     *
     * 🔴 三条纪律：
     *   ① 失败一律忽略 —— 少一个贴图最多花屏，不该让整个「获取」失败；
     *   ② 不覆盖已有文件（参考项目 `notCoverExist` 默认行为），避免重复获取时反复写同一批字节；
     *   ③ 上限 `ASSET_REF_MAX`，且**只下相对路径**（跨域绝对地址即使下回来也放不回原位）。
     *
     * 返回给用户看的一行补充说明（无资源时为 `''`）。
     */
    private async fetchFlashAssets(
        swfUrl: string,
        mainRelPath: string,
        mainBytes: Uint8Array | undefined,
        headers: Record<string, string>,
        report: (label: string) => void,
    ): Promise<string> {
        const refs = this.flashAssetRefs(swfUrl, mainBytes);
        if (refs.length === 0) return '';

        const dir = mainRelPath.includes('/') ? mainRelPath.slice(0, mainRelPath.lastIndexOf('/')) : '';
        const existing = new Set(this.app.vault.getFiles().map((f) => f.path.toLowerCase()));
        let done = 0;
        for (const ref of refs) {
            const rel = dir ? `${dir}/${ref}` : ref;
            if (existing.has(rel.toLowerCase())) continue;
            const abs = resolveUrl(swfUrl, ref);
            if (!abs) continue;
            report(`正在补关联资源 ${done + 1}/${refs.length}：${ref}`);
            try {
                const r = await this.httpGetBufferWithFallback(
                    abs,
                    { ...headers, Referer: swfUrl },
                    60_000,
                    undefined,
                );
                if (r.status < 200 || r.status >= 300 || r.buffer.length === 0) continue;
                await this.writeBinaryFile(rel, r.buffer);
                existing.add(rel.toLowerCase());
                done += 1;
            } catch {
                // 单条失败不影响整体：❌ 贴图/音频缺失只该影响画面完整性
            }
        }
        return done > 0 ? `（另补 ${done} 个关联资源）` : '';
    }

    /**
     * 确保 Ruffle 运行时已装在**插件目录**（`<pluginDir>/ruffle`），返回该目录的**绝对路径**；
     * 装不了（非桌面端 / 拿不到插件目录 / 下载失败）返回 `''`，调用方据此显示原因。
     *
     * 🔴 为什么放插件目录而不是库内：库内会被 Obsidian 建索引、被同步与备份带上，
     *    而 ~29MB 的 wasm 进库没有任何好处；插件目录同样能用 `app://` 取到
     *    （2026-11-16 探针实测：`ruffle.js` 与 wasm 都能 fetch 200、wasm 的 MIME 是 `application/wasm`）。
     *
     * 🔴 为什么按需下载而不是随包分发：压缩包 10MB、落盘近 30MB，用户明确要求控制插件体积。
     *    只有真去玩 flash 的人才付这份代价，且只付一次（装完即有 `ruffle.js`，下次直接复用）。
     *
     * ⚠️ 完整性判据 `isRuffleRuntimeComplete`（入口 + wasm + core 分包三样齐）—— 探针里只拷
     *    `ruffle.js` + 一个 wasm 时 Ruffle 报的是那句极具误导性的
     *    `Failed to begin SWF load: Error: Failed to load Ruffle WASM`，真因却是缺 core 分包。
     *    ⛔ 别把判据放宽成「ruffle.js 在就算装好」，那会让一次失败的半装状态永久卡住。
     *
     * @param onProgress 进度回调（百分比 0-100 + 人类可读文案 + 字节详情）；缺省不报进度
     *   🔴 第三参 `detail` 是用户 m02844「做进度表」补的：百分比单独一个数字看不出
     *      「10MB 下到 3.2MB」这种量级，界面要同时显示**已下载 / 总量**。
     *      `total` 可能为 0（服务端没给 content-length）⇒ 界面只显示已下载量，⛔ 别当除数。
     */
    async ensureRuffleRuntime(
        onProgress?: (
            pct: number | undefined,
            label: string,
            detail?: { received: number; total: number },
        ) => void,
    ): Promise<string> {
        const report = (pct: number | undefined, label: string, detail?: { received: number; total: number }): void => {
            try {
                onProgress?.(pct, label, detail);
            } catch {
                /* 回调炸了不影响安装（调用方多半在渲染 UI） */
            }
        };
        if (!Platform.isDesktopApp) return '';
        const root = this.pluginDir();
        if (!root) return '';
        const dir = `${root.replace(/[\\/]+$/, '')}/ruffle`;
        try {
            const fsMod = require('fs') as {
                existsSync: (p: string) => boolean;
                mkdirSync: (p: string, o: { recursive: boolean }) => void;
                readdirSync: (p: string) => string[];
                writeFileSync: (p: string, d: Uint8Array) => void;
            };
            // ① 已装好就直接返回（这条是热路径：每次点「▶ 启动」都会过一下）
            if (fsMod.existsSync(dir)) {
                const names = fsMod.readdirSync(dir);
                if (isRuffleRuntimeComplete(names)) return dir;
            }
            fsMod.mkdirSync(dir, { recursive: true });

            // ② 下载自托管包（代理 → 直连回退由 httpGetBufferWithFallback 统一负责）
            //    🔴 真机踩过：设置里配的代理进程没开时这里会 `ECONNREFUSED`，而 GitHub release
            //       在国内直连未必不通 ⇒ 必须**回退直连再试一次**，否则「代理挂了」会被误报成
            //       「Flash 运行时装不了」，用户完全看不出真因（探针实测：DIAG 里只看到 `dir:''`）。
            // 🔴 2026-11-16 用户 m02844「做进度表」：这一包 10MB / 实测 278 秒，光一行静止文字
            //    分不清「在下」还是「卡死」⇒ 下载段按**已收字节**报百分比（0→45%），
            //    解压段接在后面（45→100%），两段拼成一条连续进度。
            report(0, '正在下载 Flash 运行时', { received: 0, total: 0 });
            let res: Awaited<ReturnType<typeof nodeHttpGetBuffer>> | null = null;
            try {
                // ⚠️ 这个包 10,527,427 字节，直连实测 278 秒 ⇒ 必须给足空闲超时，
                //    否则默认 30s 会在中途掐断，表现为「运行时装不上」而真因不可见。
                res = await this.httpGetBufferWithFallback(
                    RUFFLE_BUNDLE_URL,
                    undefined,
                    300_000,
                    () => report(0, '代理不可用，改直连重试…'),
                    // ⚠️ `total` 可能为 0（第一跳 302 无 body，或服务端不给 content-length）
                    //    ⇒ 那时只报已下载量、不报百分比，⛔ 别除以 0 报个假 100%。
                    (received, total) => {
                        const pct =
                            total > 0 ? Math.max(1, Math.min(45, Math.round((received / total) * 45))) : undefined;
                        report(pct, '正在下载 Flash 运行时', { received, total });
                    },
                );
            } catch (e) {
                throw e instanceof Error ? e : new Error('下载失败');
            }
            if (!res || !res.buffer?.length) throw new Error('下载失败');
            const pkgBytes = res.buffer.length;
            report(45, '正在解压 Flash 运行时', { received: pkgBytes, total: pkgBytes });

            // ③ 只落 .js / .wasm（⛔ 不铺 .map / README / LICENSE：只会让人误以为还要动它们）
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(res.buffer);
            const entries = Object.values(zip.files).filter((f) => shouldKeepRuffleFile(f.name));
            if (entries.length === 0) throw new Error('压缩包里没有可用的运行时文件');
            let done = 0;
            for (const f of entries) {
                const buf = await f.async('uint8array');
                // 包里所有文件都在同一层（没有目录）→ 直接落在 ruffle 目录
                const baseName = f.name.split('/').pop() ?? '';
                if (!baseName) continue;
                fsMod.writeFileSync(`${dir}/${baseName}`, buf);
                done += 1;
                // ⚠️ 解压段的「进度」是**文件数**不是字节数 ⇒ ⛔ 不塞进 `detail`
                //    （界面那份按字节格式化，5 个文件会被显示成「5 B」）。
                report(45 + Math.round((done / entries.length) * 55), '正在解压 Flash 运行时');
            }

            // ④ 装完自检：半装状态必须报错，别让下次开窗再撞同一句话
            const names = fsMod.readdirSync(dir);
            if (!isRuffleRuntimeComplete(names)) {
                throw new Error('运行时文件不完整（缺少 ruffle.js / wasm / core 分包之一）');
            }
            report(100, 'Flash 运行时已就绪');
            return dir;
        } catch (err) {
            new Notice(`Flash 运行时安装失败：${err instanceof Error ? err.message : String(err)}`, 6000);
            return '';
        }
    }

    /**
     * 读某个游戏条目落盘的 **Flash 存档快照**（`localStorage` 里那些 `.sol` 的键值对）。
     *
     * 🔴 为什么要自己做（2026-11-16 反查 `ruffle.js` 实证）：Ruffle 把 SharedObject 存在
     *    **宿主网页的 localStorage**，而我们跑在 `iframe.srcdoc` 里、origin 是 `null` ——
     *    那份 localStorage 属于一次性的 srcdoc 文档，**关页即销毁**，于是存档一律丢。
     *    ⇒ 打开前把快照灌进 srcdoc，玩的时候把变化回传、落盘到这里。
     *
     * 落点：`pluginDir()/saves/<entryId>.json`（不进库：存档是运行期产物，进库会被同步/备份
     * 带上，且用户一般不想它们出现在文件列表里）。
     * ⚠️ 读不到 / 解析失败一律返回空对象 —— ⛔ 别因为存档坏了就让游戏打不开。
     */
    async loadGameSaves(entryId: string): Promise<Record<string, string>> {
        const id = String(entryId ?? '').trim();
        if (!id) return {};
        try {
            const fsMod = require('node:fs') as typeof import('node:fs');
            const file = this.gameSaveFile(id);
            if (!file || !fsMod.existsSync(file)) return {};
            const raw = JSON.parse(fsMod.readFileSync(file, 'utf8')) as unknown;
            if (!raw || typeof raw !== 'object') return {};
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0) out[k] = v;
            }
            return out;
        } catch {
            return {};
        }
    }

    /**
     * 落盘某个游戏条目的存档快照（由 `FlashGameView` 收到 srcdoc 回传后调用）。
     *
     * ⚠️ 空对象**不写**：首次打开时快照本来就是空的，写一个 `{}` 上去只会让下次多读一次文件。
     * ⚠️ 写盘失败静默 —— 存档存不住比游戏打不开轻，⛔ 别为此弹 Notice 打断游戏。
     */
    async saveGameSaves(entryId: string, saves: Record<string, string>): Promise<void> {
        const id = String(entryId ?? '').trim();
        if (!id) return;
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(saves ?? {})) {
            if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) return;
        try {
            const fsMod = require('node:fs') as typeof import('node:fs');
            const file = this.gameSaveFile(id);
            if (!file) return;
            const dir = this.gameSaveDir();
            if (!dir) return;
            if (!fsMod.existsSync(dir)) fsMod.mkdirSync(dir, { recursive: true });
            fsMod.writeFileSync(file, JSON.stringify(clean));
        } catch {
            /* 存档写不进去不影响游戏继续 */
        }
    }

    /** 存档目录（`pluginDir()/saves`；拿不到插件目录就空串） */
    private gameSaveDir(): string {
        const base = this.pluginDir();
        return base ? `${base}/saves` : '';
    }

    /** 单个条目的存档文件绝对路径（entryId 做文件名，⛔ 别用标题 —— 标题会改） */
    private gameSaveFile(entryId: string): string {
        const dir = this.gameSaveDir();
        if (!dir) return '';
        // 只留安全字符：entryId 形如 `e_1788180352140_9vf1`，正常不会有别的字符
        const safe = String(entryId).replace(/[^A-Za-z0-9_-]/g, '_');
        return safe ? `${dir}/${safe}.json` : '';
    }

    /**
     * 导出某个游戏的存档备份（① 用户逐字：「存档是导出备份，需通过导入功能恢复」）。
     *
     * 落点由**用户选**（系统「另存为」对话框）——⛔ 不写死到 `<游戏目录>/saves/`：
     * 那是「多文件 SWF 独立目录」里的**备份位置**，写进去就等于把导出变成一次静默写库，
     * 用户既没有确认、也拿不到那份文件去换机/换库。默认文件名指向那里只是**方便**，
     * 用户改到 U 盘或桌面同样成立。
     *
     * 桌面端不可用（移动端 / 拿不到 electron.remote）时**明确告知**，⛔ 不假装成功。
     */
    async exportGameSaves(entry: MediaEntry): Promise<void> {
        const entryId = String(entry?.id ?? '').trim();
        if (!entryId) {
            new Notice('拿不到条目 id，没法导出存档');
            return;
        }
        const saves = await this.loadGameSaves(entryId);
        if (Object.keys(saves).length === 0) {
            new Notice('这个游戏还没有存档可导出（玩一会儿再来）', 4000);
            return;
        }
        const content = buildSaveBundle(entryId, entry.title ?? '', saves);
        const defaultName = saveBundleFileName(entry.title ?? '');
        // 默认落点尽量放进独立目录的 `saves/`（用户约定里的「备份位置」）；
        // 拿不到目录（条目还没关联 swf / 走的是平铺区）就只给文件名，由系统对话框决定。
        const bundleDir = this.gameBundleDirOf(entry);
        const defaultPath = bundleDir ? `${bundleDir}/${defaultName}` : defaultName;
        const name = await this.saveTextToSystem(defaultPath, content);
        if (!name) return;
        new Notice(
            `已导出 ${Object.keys(saves).length} 个存档：${name}（换库或重装后用「导入存档」恢复）`,
            6000,
        );
    }

    /**
     * 从导出文件恢复存档（覆盖式）。
     *
     * ⚠️ 是**覆盖**不是合并：存档表是「当前进度的快照」，合并两份不同进度的同名 SharedObject
     *    只会得到一份谁也不是的进度。所以先二次确认，确认后才写。
     */
    async importGameSaves(entry: MediaEntry): Promise<void> {
        const entryId = String(entry?.id ?? '').trim();
        if (!entryId) {
            new Notice('拿不到条目 id，没法导入存档');
            return;
        }
        const picked = await this.openTextFromSystem();
        if (!picked) return;
        const parsed = parseSaveBundle(picked.text);
        if (!parsed.ok) {
            new Notice(`导入失败：${parsed.reason}`, 6000);
            return;
        }
        const count = Object.keys(parsed.saves).length;
        const when = parsed.exportedAt ? `（导出于 ${parsed.exportedAt.slice(0, 19).replace('T', ' ')}）` : '';
        const from = parsed.title ? `《${parsed.title}》` : '这份文件';
        const ok = await new ConfirmModal(
            this.app,
            `用${from}的 ${count} 个存档覆盖当前进度${when}？\n\n当前的存档会被替换，且不可撤销。`,
            '导入存档',
        ).open();
        if (!ok) return;
        await this.saveGameSaves(entryId, parsed.saves);
        const written = await this.loadGameSaves(entryId);
        const n = Object.keys(written).length;
        if (n === 0) {
            new Notice('导入失败：存档没能写进去（可能插件目录不可写）', 6000);
            return;
        }
        new Notice(`已导入 ${n} 个存档（回到游戏页按「重玩」即可生效）`, 6000);
        // 已经打开着的游戏页要**重挂 srcdoc** 才能吃到新存档：
        // 存档是在 iframe 载入前灌进 localStorage 的（见 pure/flashGame 的 flashFrameHtml），
        // ⛔ 往活着的 iframe 里 postMessage 塞存档不管用 —— 那时 Ruffle 已经 populateSaves 过了。
        this.refreshFlashGame(entryId);
    }

    /**
     * 主影片所在的**独立目录**（`<游戏目录>/<游戏名>`）；平铺区或没关联 swf 时返回 `''`。
     *
     * ⛔ 别用 `dirOfSwf` 直接返回：它对平铺区（`.../swf/x.swf`）也给 `.../swf`，
     *    那不是独立目录 —— 把备份写进平铺区，等于给一整排单文件游戏共用一间 saves。
     */
    private gameBundleDirOf(entry: MediaEntry): string {
        const rel = String(entry?.gameSwf ?? '').trim();
        if (!rel || isInSwfFlatDir(rel)) return '';
        return dirOfSwf(rel);
    }

    /**
     * 让已经打开的 Flash 游戏页重挂一次影片（导入存档后需要，理由见 `importGameSaves`）。
     * 没有打开的页就什么都不做。
     */
    private refreshFlashGame(entryId: string): void {
        for (const leaf of this.app.workspace.getLeavesOfType(FLASH_GAME_VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof FlashGameView && view.entryId() === entryId) view.reloadStage();
        }
    }

    /** 启动游戏（条目「▶ 启动」）：有本地 swf 就在插件内播，否则 shell.openPath 打开 .lnk 快捷方式 */
    async launchGame(entry: MediaEntry): Promise<void> {
        // 🔴 2026-11-16 用户裁定「先做本地 swf 播放」：两者都填时 **swf 优先** ——
        //    能内嵌直接玩就不该把用户甩出 Obsidian 去开外部程序。
        // 🔴 m02844：这条优先路要过「启用内置游戏启动器」开关 —— 关掉 = 用户不想为 Flash
        //    付那 ~10MB 运行时代价 ⇒ 直接跳过 swf 分支，走原来的 `.lnk` 链路。
        const swf = String(entry.gameSwf ?? '').trim();
        if (swf && this.settings.internalGameLauncher !== false) {
            // 🔴 2026-11-16 用户逐字：「要独立标签页运行而不是弹窗运行」
            //    ⇒ 落在 `FlashGameView`（工作区 ItemView），⛔ 别退回 Modal 弹窗。
            await this.openFlashGame(entry);
            return;
        }
        // H5 / Unity：没有可下载的 swf，但有能在 iframe 里跑的在线播放页 ⇒ 同样是插件内标签页。
        // 放在 .lnk 之前 —— 「在插件里玩」比「甩出去开外部程序」更贴近用户的意图。
        const embed = String(entry.gameEmbed ?? '').trim();
        if (embed && this.settings.internalGameLauncher !== false) {
            await this.openFlashGame(entry);
            return;
        }        if (!entry.gameLaunchPath) {
            new Notice('未关联启动快捷方式 — 编辑属性选择 .lnk 文件', 4000);
            return;
        }
        if (!Platform.isDesktopApp) {
            new Notice('游戏启动仅桌面端可用');
            return;
        }
        try {
            // 库内相对路径转系统绝对路径；库外绝对路径直接用
            const file = this.app.vault.getAbstractFileByPath(entry.gameLaunchPath);
            const fullPath = file instanceof TFile ? (this.app.vault.adapter as FileSystemAdapter).getFullPath(file.path) : entry.gameLaunchPath;
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell?.openPath(fullPath);
            if (err) new Notice(`启动失败：${err}`, 4000);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 播放音乐条目音频（卡片「▶ 播放」）—— ④-4 起改为打开**内置音频播放器**（标签页）：
     * 歌词（笔记 lrc 块 / 同名 .lrc / 内嵌）与音频统一呈现，这是用户「统一 LRC 笔记和音频文件共存」的落点。
     * 解析不出可播 URL 时按老链路兜底（库内 → Obsidian 原生音频视图；库外 → Media Extended → 系统播放器），
     * ⛔ 不要因为新面而让原来能播的文件反而播不了。
     */
    async playAudioEntry(entry: MediaEntry): Promise<void> {
        if (!entry.audioPath) {
            // 🔴 #601：没有本地音频但填了「网络地址」⇒ 用浏览器打开 —— `hasActionEntry` 把 `audioUrl`
            //    也算作可用入口，判可用与真能执行**必须同口径**（⛔ 别造一条点了没反应的死入口）。
            const u = entry.audioUrl?.trim();
            if (u) {
                window.open(u, '_blank');
                return;
            }
            new Notice('未关联本地音频 — 编辑属性选择文件', 4000);
            return;
        }
        const opts = await this.buildAudioPlayerOptions(entry);
        if (opts) {
            this.lastAudioEntry = entry;
            // 🔴 #474（用户 2026-10-01）：「侧边栏有歌曲正播放时，点海报墙的播放按钮」= **就地切歌**，
            //    复用侧边栏里那个播放器实例，⛔ 不再另开一个标签页（否则同一首歌会在两处各起一个）。
            const side = this.findSidebarAudioPlayer();
            if (side) {
                this.pauseOtherAudioInstances(side.leaf);   // 其它音频实例让出声道（防两路同响）
                // 侧边栏被折叠时展开（否则用户只听见声音、找不到播放器）；
                // ⚠️ **已经展开就⛔ 别 reveal** —— reveal 会激活那个 leaf，把焦点从用户手上的笔记抢走。
                const rightSplit = this.app.workspace.rightSplit as unknown as { collapsed?: boolean } | null;
                if (rightSplit?.collapsed) this.app.workspace.revealLeaf(side.leaf);
                side.view.openWith(opts);
                return;
            }
            await this.openAudioPlayer('tab', opts);
            return;
        }
        // 兜底 1：库内音频至少还能用 Obsidian 原生音频视图播
        const f = this.app.vault.getAbstractFileByPath(entry.audioPath);
        if (f instanceof TFile) {
            await this.app.workspace.getLeaf('tab').openFile(f);
            return;
        }
        // 兜底 2：库外绝对路径 → Media Extended → 系统播放器
        if (!Platform.isDesktopApp) {
            new Notice('库外音频播放仅桌面端可用');
            return;
        }
        if (await this.playWithMediaExtended(entry.audioPath)) return;
        try {
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const err = await electron.shell?.openPath(entry.audioPath);
            if (err) new Notice(`无法播放音频：${err}${err}`, 4000);
        } catch {
            new Notice('无法打开播放器');
        }
    }

    /**
     * 🔴 #474（用户 2026-10-01）：找出**侧边栏里已经存在**的内置音频播放器实例（没有则 null）。
     *
     * 判据走 `AudioPlayerView.isInSidebar()`（= #410「打开笔记按钮只在标签页显示」的**同一份**口径），
     * ⛔ 别在宿主侧另写一份「是不是侧边栏」—— 两处必然漂。
     *
     * ⚠️ 也别图省事用 `getRightLeaf(false)`「顺手拿一个」：它返回的是侧边栏里**第一个** leaf，
     *    很可能挂着别的视图，随后的 `setViewState` 会把它顶掉（用户的侧边栏布局被静默改掉）。
     */
    private findSidebarAudioPlayer(): { leaf: WorkspaceLeaf; view: AudioPlayerView } | null {
        for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof AudioPlayerView && view.isInSidebar()) return { leaf, view };
        }
        return null;
    }

    /**
     * 🔴 #474：除 `keep` 之外的**音频播放器实例**一律让出声道。
     *
     * 为什么需要单独一个：真源 `pure/audioQueue.playersToPause` 是按**通路**分的（音频 ↔ 视频），
     * 它管不到「同一条通路上开了两个实例」（标签页一个 + 侧边栏一个）——
     * 而本批的场景（侧边栏在放 A、点卡片要放 B）恰好会同时存在两个实例 ⇒ 不处理就是**两路同时响**。
     * ⚠️ 这里**只排除 `keep`**（既不越权暂停用户自己点起来的那个实例，也不动别的通路 —— 那是 `pauseOtherPlayers` 的事）。
     */
    private pauseOtherAudioInstances(keep: WorkspaceLeaf | null): void {
        for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
            if (leaf === keep) continue;
            const view = leaf.view;
            if (view instanceof AudioPlayerView) view.pausePlayback();
        }
    }

    /**
     * 打开内置音频播放器。`where` 决定落在哪：标签页 / 右侧边栏
     * —— **同一个视图类型**，差别只是可用宽度（三档自适应由 `pure/audioLayout` 判定），
     * 所以「在侧边栏」不需要另一套 UI。
     * `opts` 缺省（命令面板入口）时用「上一次播放的音乐条目」重建队列。
     */
    private async openAudioPlayer(where: 'tab' | 'sidebar', opts?: AudioPlayerOptions): Promise<void> {
        const options = opts ?? (await this.buildAudioPlayerOptions(this.lastAudioEntry));
        if (!options) {
            new Notice('还没有可播放的音乐 — 先在音乐条目上点「播放」', 4000);
            return;
        }
        const workspace = this.app.workspace;
        let leaf: WorkspaceLeaf | null;
        if (where === 'sidebar') {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) {
                new Notice('右侧边栏不可用', 3000);
                return;
            }
        } else {
            // 当前活动页已是播放器 → 直接换条目复用（与 openVideoPlayer 同口径）
            const active = workspace.activeLeaf;
            leaf = active && active.view instanceof AudioPlayerView ? active : workspace.getLeaf('tab');
        }
        if (!(leaf.view instanceof AudioPlayerView)) {
            await leaf.setViewState({ type: AUDIO_PLAYER_VIEW_TYPE, active: where === 'tab' });
        }
        const view = leaf.view;
        if (view instanceof AudioPlayerView) {
            this.pauseOtherAudioInstances(leaf);   // 🔴 #474：起播前让**其它音频实例**让出声道（见 helper 注释）
            view.openWith(options);
        }
    }

    /**
     * 组装一次播放请求：队列 + 歌词读取 + 音量/模式设置。
     *
     * **队列来源（④-4 取设计文档 §5.5 的 A 方案）**：库内**全部带 `audioPath` 的音乐条目**，
     * 按库内顺序；起始曲 = 传入条目，不在队列里则从 0 开始。
     * 🔴 这里**不按扩展名再筛一遍**（`pure/audioQueue.normalizeAudioQueue` 的口径：会静默丢 `.opus`/`.ape`）；
     *    扩展名白名单只用于系统文件选择器。
     * ⚠️ 解析不出可播 URL 的曲目**不进队列** —— 否则用户切到它时只有一片安静、还以为播放器坏了。
     */
    private async buildAudioPlayerOptions(entry: MediaEntry | null): Promise<AudioPlayerOptions | null> {
        const all = await this.service.list();
        const tracks: AudioPlayerTrack[] = [];
        for (const e of all) {
            if (e.type !== 'music' || !e.audioPath) continue;
            const url = this.resolveEmbedUrl(e.audioPath);
            if (!url) continue;
            tracks.push({
                entryId: e.id,
                title: e.title,
                // 标签页标题要显示**笔记名**（用户 2026-09-27）：真源 `pure/libraryDir.fileDisplayName`
                // （叶子段去扩展名；⛔ 别在这里 `split('/')` —— 分隔符 / 扩展名大小写 / 带点目录名都是坑）
                noteName: fileDisplayName(e.notePath ?? ''),
                subtitle: audioSubtitle(e),
                path: e.audioPath,
                // 🔴 #408：笔记路径（「打开笔记」按钮）与左栏两块信息的展示文本
                notePath: e.notePath,
                url,
                coverUrl: this.resolvePoster(e) ?? null,
            });
        }
        if (!tracks.length) return null;
        const idx = entry ? tracks.findIndex((t) => t.entryId === entry.id) : 0;
        return {
            items: tracks,
            startIndex: idx >= 0 ? idx : 0,
            // 🔴 #406：**打开即自动播放**（用户：「海报墙点击播放按钮后…改为点击即自动播放」）。
            //    这里是标签页 / 侧边栏 / 命令面板三条入口共用的选项构造 —— 三处都是「用户主动点开」
            //    ⇒ 一律自动起播；⚠️ 笔记内联块走另一条构造（`audioOptionsForNote`），那里**不传**。
            autoplay: true,
            wordHighlight: this.settings.lyricsWordHighlight !== false,
            loadLyrics: (t) => this.loadEntryLyrics(t),
            initialMode: normalizeAudioPlayMode(this.settings.audioPlayMode),
            initialVolume: clampAudioVolume(this.settings.audioVolume ?? 1),
            onSaveMode: (mode) => void this.persistAudioSetting('mode', mode),
            onSaveVolume: (volume) => void this.persistAudioSetting('volume', volume),
            onPlayStart: (kind) => this.pauseOtherPlayers(kind),
            /** 🔴 #408：右上角「打开笔记」按钮 ⇒ 复用既有单点实现（无笔记时它自己会提示）。
             *  ⚠️ 只有**标签页 / 侧边栏**这条构造传它；内联块（笔记里的小卡片）**不传** ——
             *  那段笔记就在眼前，没必要再放一个「打开笔记」按钮（不传 ⇒ 按钮自动禁用）。 */
            onOpenNote: (track) => void this.openEntryNote(track.entryId),
            /**
             * 🔴 m02288：音乐收听时长**自动累计**（用户：「用音乐播放器播放每首音乐要统计总时长…
             * 而不是让用户手动记录」）。
             *
             * 落点 = `listenMinutes`（⛔ 不是 `durationMin` —— 那是片长，见 `pure/musicSync` 文件头 ⑵）；
             * 走 `bumpListenMinutes` 而**不是** `addTimeSession`：后者会往明细里堆「听了一分钟」的垃圾，
             * 播放器的背景累计不该在用户的时长明细列表里留痕。
             *
             * ⚠️ 三条路径共用本构造（标签页 / 侧边栏 / 命令面板）⇒ 这里注入一次就全覆盖。
             *    内联块那条走 `audioOptionsForNote`，那里**也传**（在笔记里听歌同样是收听）。
             */
            onListen: (track, minutes) => {
                if (!track.entryId) return;
                void this.service
                    .bumpListenMinutes(track.entryId, minutes)
                    .then((e) => {
                        // 刷新视图让海报墙的「已听 Nh」跟着涨 —— 但不抢焦点、不打断播放
                        if (e) this.refreshViews();
                    })
                    .catch(() => undefined);
            },
        };
    }

    /**
     * 取某条目音频的歌词 —— 四路优先级真源 = `pure/lrcSource.pickLyrics`：
     * `lyrics 指令 > 块内正文 > 同名 .lrc > 音频内嵌标签`。
     * ⚠️ 第 4 路（ID3 / FLAC / M4A 内嵌标签）本轮**未实现** ⇒ 不传，`pickLyrics` 自然跳过；
     *    将来补一个读取器塞进 `pickLyricsFor` 即可，判定顺序不用动。
     */
    private async loadEntryLyrics(track: AudioPlayerTrack): Promise<{ text: string; origin: LrcLyricsOrigin } | null> {
        const note = await this.service.readNoteText(track.entryId);
        const block = parseLrcBlock(extractLrcBlock(note ?? '') ?? '');
        return this.pickLyricsFor(block, track.path);
    }

    /**
     * 四路歌词源的**读取侧**（笔记内 ` ```lrc ` 块与播放器视图共用，⛔ 别各写一份优先级）。
     *
     * 🔴 **第 4 路（音频内嵌）单独一轮、且放在最后**：#391 起才接上（此前只留了槽位），
     *    而它要**整块读音频字节**（动辄 8–12MB）⇒ 若和前三路一起算，用户库里有 `.lrc` 时也白读一遍；
     *    切歌一次读一次，代价会累积。所以先只看「文本三路」，命中就直接返回。
     * ⚠️ 两轮都仍走 `pickLyrics`（真源）——它自己判「空白不算有」，⛔ 别在这里另抄一遍空值判定。
     */
    private async pickLyricsFor(
        block: LrcBlock,
        audioPath: string,
    ): Promise<{ text: string; origin: LrcLyricsOrigin } | null> {
        const directiveFile = await this.readLyricsRef(block.lyrics);
        const sibling = await this.readLyricsRef(siblingLrcPath(audioPath) ?? undefined);
        const fromText = pickLyrics({
            directiveFile: directiveFile ?? undefined,
            inline: block.inline,
            sibling: sibling ?? undefined,
        });
        if (fromText) return fromText;
        const bytes = await this.readBookBytes(audioPath);
        return pickLyrics({ embedded: readEmbeddedLyrics(bytes) ?? undefined });
    }

    /**
     * 读一路歌词文件。参数形态（wiki 链接 / 库内相对 / 库外绝对）统一走 `pure/lrcSource.parseLrcRef` 判定，
     * 于是生成侧（`noteGenerator` 写 `source` 行）与这里用的是**同一套分类** —— 分叉的后果是
     * 「笔记写着 A、播放器去读 B」，且两边都不报错。
     * 🔴 读文件走 `readBookText`（内部先读二进制再嗅探编码，红线 11）—— 歌词文件同样常见 GBK。
     * 读不到 ⇒ `null`，让 `pickLyrics` 落到下一档。
     */
    private async readLyricsRef(raw: string | undefined): Promise<string | null> {
        const ref = parseLrcRef(raw ?? '');
        if (!ref) return null;
        return this.readBookText(ref.value);
    }

    /**
     * 在线歌词检索（#396，条目表单「获取歌词」）—— 四源并行搜索（#400 起含酷狗）。
     * 纯逻辑在 `pure/lyricOnline`、请求与降级在 `services/lyricSearch`，本方法只做**平台门控 + 接线真源**。
     * 🔴 **仅桌面端**：`nodeHttp` 依赖 Node 内置 `https`，移动端没有 ⇒ 直接返回空档（表单侧按钮也不出现，
     *    这里是第二道闸 —— 门控只写一边的话，将来别处调用会静默走 `requestUrl` 拿不到同款反爬头）。
     */
    async searchOnlineLyrics(title: string, author: string): Promise<LyricSearchOutcome> {
        if (!Platform.isDesktopApp) return { query: null, results: [] };
        return searchLyrics((url, headers) => nodeHttpGet(url, headers), title, author);
    }

    /** 取某源某条候选的歌词正文（#396；桌面端门控同上）。失败 ⇒ 由服务层收成 `error`，⛔ 不抛到这里 */
    async fetchOnlineLyric(source: LyricSourceId, id: string): Promise<LyricFetchOutcome> {
        if (!Platform.isDesktopApp) return { text: null, error: '仅桌面端支持' };
        return fetchLyric((url, headers) => nodeHttpGet(url, headers), source, id);
    }

    // ────────────────────────── ⑤-c 音乐下载（网易云免费通道）──────────────────────────

    /**
     * 打开「下载歌曲」弹窗。
     * 🔴 按钮的显隐由 `EntryForm` 按设置决定（`canDownload` = 桌面端 + 「启用内置音乐播放器」开，
     *    见 `modals/EntryModal`）；这里**再挡一次** —— 移动端没有 Node http，真放进来必然是一次失败。
     */
    openMusicDownloader(title: string, author: string, onPicked: (relPath: string) => void): void {
        if (!Platform.isDesktopApp) {
            new Notice('下载功能仅支持桌面端', 3000);
            return;
        }
        new MusicDownloadModal(
            this.app,
            {
                search: (keyword, onPartial, onEmpty) => this.dlSearchSongs(keyword, onPartial, onEmpty),
                loadPlaylists: (source, limit) => this.dlRecommendedPlaylists(source, limit),
                loadPlaylist: (source, id) => this.dlPlaylistSongs(source, id),
                download: (song, onProgress) => this.dlDownloadSong(song, onProgress),
                preview: (song, onProgress) => this.dlPreviewAudio(song, onProgress),
                biliSearch: (keyword) => this.dlBiliSearch(keyword),
                // 🔴 2026-11-09 第 16 轮（用户：「从 b 站下载音频的文件名还是不跟随条目标题名改变」）：
                //    真因就在这一行 —— 上一轮给 `dlBiliDownload` 加了第三参 `songTitle`、也给
                //    `MusicDownload.svelte` 接了传参，但**这个宿主包装只转发了前两个参数**，
                //    第三参在这里被吃掉 ⇒ 文件名词永远拿到空串、回落成 B站视频标题。
                //    ⛔ 别写成 `(video, onProgress) => …`，少一个形参就是整条链路静默降级。
                biliDownload: (video, onProgress, songTitle) => this.dlBiliDownload(video, onProgress, songTitle),
            },
            { title, author, onPicked },
        ).open();
    }

    /**
     * 下载面传输层（#399-D）：四平台全部经 `services/nodeHttp`（Node 原生 https，能过平台反爬）。
     * 🔴 只在桌面端可用；移动端由各门面提前返回（见下面的 `Platform.isDesktopApp` 守卫）。
     */
    private dlTransport(proxy?: string): DlTransport {
        return {
            // 🔴 `proxy` 为空 = 直连（国内站）。墙外目标（YouTube 字幕正文等）必须传 `ytProxyFor()`，
            //    否则就是 2026-11-10 那个事故：元数据（yt-dlp 子进程带代理）拿到了、正文直连超时。
            //    ⛔ 别把这个参数去掉 —— 加它之前 YouTube 字幕一直是坏的。
            get: (url, headers) => nodeHttpGet(url, headers, proxy),
            post: (url, body, headers) => nodeHttpPost(url, body, headers, proxy),
            getBuffer: (url, headers) => nodeHttpGetBuffer(url, headers, proxy),
        };
    }

    /**
     * 四平台搜索（#399-D）：任一平台先回来就先回调（渐进渲染），全部失败时 `onEmpty(true)`。
     * ⛔ 只桌面端 —— 移动端没有 Node http，真放进来必然是一次失败。
     */
    async dlSearchSongs(
        keyword: string,
        onPartial?: (songs: DownloadSong[]) => void,
        onEmpty?: (networkError: boolean) => void,
    ): Promise<{ songs: DownloadSong[]; failedSources: PlaylistSource[] }> {
        if (!Platform.isDesktopApp) return { songs: [], failedSources: [] };
        // 🔴 #405：搜索结果的平台顺序用 **`DL_SEARCH_ORDER`（酷我优先）**，⛔ 不是 `DL_PLATFORMS`
        //    （后者是胶囊 / 设置页的平台清单顺序，用户没要求改那个）。
        return dlSearch(this.dlTransport(), keyword, { onPartial, onEmpty, order: [...DL_SEARCH_ORDER] });
    }

    /** 四平台推荐歌单（网易云复用本仓既有免密端点；QQ/酷狗/酷我走各自公开接口） */
    async dlRecommendedPlaylists(
        source: PlaylistSource,
        limit?: number,
    ): Promise<{ playlists: RecommendedPlaylist[]; error?: string }> {
        if (!Platform.isDesktopApp) return { playlists: [], error: '仅桌面端支持' };
        return dlRecommendedPlaylists(this.dlTransport(), source, limit);
    }

    /** 四平台歌单曲目 */
    async dlPlaylistSongs(
        source: PlaylistSource,
        id: string,
    ): Promise<{ songs: DownloadSong[]; error?: string }> {
        if (!Platform.isDesktopApp) return { songs: [], error: '仅桌面端支持' };
        return dlPlaylistSongs(this.dlTransport(), source, id);
    }

    /**
     * 四平台下载一首歌到库内（含网易云 VIP / QQ Cookie 链路）。
     * 🔴 `taken` = **当前库内全部相对路径**（`pure/downloadPlan` 的重名去重依据）—— 下载是低频操作，现取即可。
     * ⛔ **不内嵌任何音频标签**（用户 2026-09-28 明确不做那套）。
     */
    async dlDownloadSong(
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ): Promise<{ ok: boolean; message: string; relPath?: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '下载功能仅支持桌面端' };
        const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
        return dlDownloadSong(
            this.dlTransport(),
            song,
            {
                cookies: this.settings.musicDlCookies ?? {},
                target: {
                    root: this.settings.musicDownloadDir,
                    taken,
                    write: (relPath, data) => this.writeBinaryFile(relPath, data),
                },
            },
            onProgress,
        );
    }

    /**
     * 试听某首曲目（2026-09-28 #400）：取**标准档**音频字节（不写盘），由弹窗转 Blob 播放。
     * 链路顺序与下载完全一致（同一处 `resolveAudio`）⇒ 「能下不能听」不会出现。
     * 🔴 缓存**仅本会话有效**（服务层模块内 Map，重启即清）：用户明确「不做设置页试听缓存删除」
     *    ⇒ ⛔ 别为它加设置项 / 清缓存按钮 / 磁盘缓存。
     */
    async dlPreviewAudio(
        song: DownloadSong,
        onProgress?: DownloadProgressCallback,
    ): Promise<DlPreviewResult> {
        if (!Platform.isDesktopApp) return { ok: false, message: '试听功能仅支持桌面端' };
        return dlPreviewAudio(this.dlTransport(), song, { cookies: this.settings.musicDlCookies ?? {} }, onProgress);
    }

    /**
     * 本次取流实际要用的代理地址。
     *
     * 🔴🔴 为什么不是直接 `normalizeProxyUrl(settings.ytProxy)`（2026-10-31 真机事故）：
     *    用户 `ytProxy` 留空时，`yt-dlp` 会自己从注册表读 Windows 系统代理 ⇒ 取流成功。
     *    但合流那一步的 `ffmpeg` **不读系统代理** ⇒ 直连 `googlevideo.com` 必然
     *    `Error number -138`（ENETUNREACH）。表现为「取到流了、播不出来」，
     *    而设置页写的「留空 = 直连」让人以为留空是受支持的正确用法。
     *    ⇒ 留空时兜底沿用系统代理，让 `yt-dlp` 与 `ffmpeg` 走**同一个出口**。
     *
     * ⚠️ 只影响「实际取流用哪个出口」，**不回写** `settings.ytProxy`
     *    （用户界面里那格仍是空的，他看到的还是「留空 = 直连」这个自己填的事实）。
     * ⚠️ 用户显式填了就以用户的为准，系统代理只在留空时兜底。
     */
    private ytProxyFor(): string {
        const explicit = normalizeProxyUrl(this.settings.ytProxy);
        if (explicit) return explicit;
        return systemProxyUrl();
    }

    /** 平台连通性测试（设置页「测试连接」四态文案；`source` 传平台 id 字符串） */
    async dlTestConnection(source: string, cookie: string): Promise<{ ok: boolean; message: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '仅桌面端支持' };
        return dlTestConnection(this.dlTransport(), source, cookie);
    }

    /**
     * YouTube 连通性测试（设置页「网络播放 › YouTube」那行的「测试连接」）。
     *
     * 🔴 为什么必须真跑一次取流而不是只 ping 一下域名：YouTube 的失败**分层**得很厉害 ——
     *    域名能通但 `googlevideo.com` 不回 CORS 头、yt-dlp 没装、代理端口没开、
     *    要求验证机器人身份、Cookie 过期……只有真跑一次 `yt-dlp --dump-json` 才能一次性判完。
     *    ⇒ 直接复用播放时那条完全相同的 `fetchYtInfo`（见 `services/ytStream.ytTestConnection` 注释）。
     *
     * ⚠️ 代理与 Cookie 都从**当前设置**读，不是从设置页的输入框读：输入框是边打边存的
     *    （见 `renderNetPlaybackRows` 的 onInput），到这里时值已经在 settings 里了。
     *    ⛔ 别再传一份参数进来，那会变成第二个真源。
     */
    async ytTestConnection(): Promise<{ ok: boolean; message: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '仅桌面端支持' };
        const proxy = this.ytProxyFor();
        const cookie = String(this.settings.ytCookie ?? '').trim();
        return ytTestConnection(proxy, cookie, this.ytMuxDir());
    }

    /**
     * 把设置里填的 Cookie **同步进 Electron 的 cookie jar**（官方内嵌 iframe 靠它拿登录态）。
     *
     * 🔴 2026-10-31 用户报障：「B站/油管内嵌的怎么还有登录，不上填了 cookie 吗」
     *    设置页那串 Cookie 只是**字符串**，只喂插件自己发 API 请求
     *    （`biliStreamFor` / `ytStreamFor` 的 node 侧 fetch）。
     *    而官方内嵌播放器是一个 `<iframe>` —— 跑在 Electron 的独立浏览上下文里，
     *    读的是 Chromium 自己的 cookie jar。真机实测那份 jar 里
     *    `bilibili.com` / `youtube.com` 都是 **0 条** ⇒ 填了也永远是未登录。
     *
     * ⚠️ 做成**正式方法**（不是只塞在 page 对象里的内联箭头函数）：
     *    ① 真机探针要能直接调它验收（内联的调不到，只能靠打开页子间接触发）；
     *    ② 以后别处（比如内置播放器标签页）想复用，有地方可引；
     *    ③ 内联在 `openEpisodePageFor` 的 page 对象里，等于每次构造都生成一份，
     *       逻辑却只有这一处 —— 放在类上是它本来该在的位置。
     */
    async syncEmbedCookies(): Promise<EmbedCookieResult> {
        return syncEmbedCookies({
            bili: this.settings.biliCookie ?? '',
            yt: String(this.settings.ytCookie ?? ''),
        });
    }

    /**
     * B 站视频搜索（#496）：两步请求（先取 `buvid3` 再搜），形态与失败文案全在
     * `services/dl/bilibili` + `pure/dl/bilibili`。⛔ 只桌面端（移动端没有 Node http）。
     */
    async dlBiliSearch(keyword: string): Promise<{ videos: BiliVideo[]; error?: string }> {
        if (!Platform.isDesktopApp) return { videos: [], error: '仅桌面端支持' };
        return dlBiliSearch(this.dlTransport(), keyword);
    }

    /**
     * YouTube 视频搜索（「网络集可搜索 YouTube」）：
     * 与 `ytStreamFor` **同一条代理 / Cookie / Node 运行时链**，只是走 `--flat-playlist` 只取列表。
     *
     * ⚠️ 代理口径必须走 `this.ytProxyFor()`（⛔ 不是直接读 `settings.ytProxy`）：
     *    用户留空时代理来自系统设置 —— 这条路和取流一样，留空即直连是不会通的。
     */
    async ytSearch(keyword: string): Promise<{ videos: YtSearchItem[]; error?: string }> {
        if (!Platform.isDesktopApp) return { videos: [], error: '仅桌面端支持' };
        return searchYt(keyword, this.ytProxyFor(), String(this.settings.ytCookie ?? '').trim(), this.ytMuxDir());
    }

    /**
     * B 站取**分P 列表**（#505：把「一个 52 集的长篇」一次填完的前提）。
     * 🔴 与 `dlBiliSearch` 同一条纪律：只桌面端、共用 `buvid3` 缓存、失败重取一次再报原因；
     *    ⛔ 只**取列表**，不下载（下载是音乐下载弹窗那条路的职责）。
     */
    async dlBiliView(bvid: string): Promise<{ title: string; parts: BiliPart[]; cover: string; error?: string }> {
        if (!Platform.isDesktopApp) return { title: '', parts: [], cover: '', error: '仅桌面端支持' };
        return dlBiliView(this.dlTransport(), bvid);
    }

    /**
     * 🔴 `b23.tv` 短链 → 落地页，**给「粘贴链接」那两个入口**用（剪贴板里常是手机分享的短码）。
     *
     * ⚠️ 与 `biliStreamFor` 内部那次跳转**同一个出口** `resolveBiliShortUrl`（⛔ 别各写一份）：
     *    区别只是这里不带 Cookie/Referer 以外的取流头、也不要求真能取到流 —— 只要落地页。
     * ⛔ 非短链 / 跳不动 ⇒ 原样返回（调用方那句「请在浏览器打开」照旧有效）。
     */
    async resolveBiliShortForPaste(url: string): Promise<string> {
        if (!Platform.isDesktopApp) return url;
        if (!isBiliShortUrl(url)) return url;
        const headers: Record<string, string> = { 'User-Agent': BILI_UA, Referer: BILI_REFERER };
        return this.resolveBiliShortUrl(this.dlTransport(), url, headers);
    }

    /**
     * 取一条**可直接喂给 `<video>`** 的 B 站网络集流地址（选集页内嵌播放用）。
     *
     * 🔴 用户 2026-11-02 裁定「内嵌播放换成插件内置播放器」⇒ 必须自己拿直链：
     *    iframe 跨域读不到 `currentTime`，字幕时间轴/进度/倍速全死。真机实测链路：
     *    `biliIdsOf` bvid/ep/ss `pagelist` `pgc/view/web/season` `cid`
     *    ⇒ `playurl?fnval=0&platform=html5` 得**mp4 单文件直链** ⇒ **直接交给 `<video>`**。
     *
     * 🔴 直连为什么可行（不是猜的，`_probe_matrix.cjs` / `_probe_ua.cjs` 实测）：
     *    `platform=html5` 返回的 CDN 链接**只校验 UA、不校验 Referer**。
     *    `<video>` 自己发请求会带 UA（真机 `obsidian/1.11.4 … Electron/31.7.7` ⇒ 206、
     *    中段 seek ⇒ 206），⇒ **不需要本地代理**。
     *    ⛔ 别改回 `fnval=1&fourk=1`：那个口径裸 header 一律 403，会被迫起回环代理，
     *    而用户明确要求「直连播放」而非 `127.0.0.1`。
     *    📌 参考实现：Smart Media Notes 就是「取到 url 直接交给 `<video>`」，全程无 proxy。
     *
     * 🔴 画质**固定冲最高**（用户 2026-11-08：「算了去掉清晰度选择默认最高画质播放」）。
     *    请求值取 `BILI_DASH_TOP_QN`（112 = 1080P+），能拿到哪档由 B 站按登录态决定：
     *    DASH 分支按 `id` 降序取最高（`pickBiliDash` 已排序 + `pickTrackByQn` 取最高），
     *    html5 回退分支则由 `pickBiliStream` 回报的 `qn` 才是真值。
     *    ⚠️ 别再引入「用户选档」参数：控制栏那颗清晰度按钮已按用户要求整条删除。
     * ⛔ 任何一步拿不到就返回 `null`：调用方回退 iframe，**别抛异常到界面**。
     */

    /**
     * YouTube 合流产物的临时目录（vault 之外的插件缓存目录）。
     *
     * 🔴 为什么不放 vault 里：合流产物是几十到几百 MB 的中间文件，放进库里会被
     *    Obsidian 索引、被同步插件上传、被用户当成资料。放系统临时目录最干净。
     * ⚠️ 用 `os.tmpdir()` 而不是写死 `C:\\Temp`：跨平台（macOS/Linux 都能用）。
     */
    private ytMuxDir(): string {
        try {
            const os = require('os') as { tmpdir: () => string };
            const fsMod = require('fs') as { existsSync: (p: string) => boolean; mkdirSync: (p: string, o: { recursive: boolean }) => void };
            const dir = `${os.tmpdir().replace(/[\\/]+$/, '')}/reelludic-yt`;
            if (!fsMod.existsSync(dir)) fsMod.mkdirSync(dir, { recursive: true });
            return dir;
        } catch {
            return '';
        }
    }

    /**
     * ⇒ YouTube 网络集的字幕（人工或自动，转成与 B 站同形的 `${fileName,text,isAi}`）。
     *
     * 🔴 与取流**分开**（和 `biliSubtitleFor` 同一条纪律）：字幕慢不该拖慢起播。
     * ⚠️ 直接读 `yt-dlp -J` 里给的 `automatic_captions` 直链，再走同一份
     *    `dlTransport` 拉 VTT —— 不再 spawn 第二个进程（那要再花 2~5 秒）。
     */
    private async ytSubtitleFor(url: string): Promise<BiliSubtitleResult> {
        if (!Platform.isDesktopApp) return { fail: 'other' };
        if (!isYouTubeUrl(url)) return { fail: 'other' };
        const proxy = this.ytProxyFor();
        const cookie = String(this.settings.ytCookie ?? '').trim();
        // 🔴 用户 m06406 ④：没填 Cookie 单独成态（「未能获取到本集字幕 指路重填）。
        // ⚠️ YouTube 匿名也能拿到**公开**字幕，但拿不到需要登录的；这里保守起见只。
        //    「填了但是取不到任何轨」时Cookie 失效，没填就说「没填」。
        const got = await fetchYtInfo(url, proxy, cookie, this.ytMuxDir());
        if (isYtFailure(got)) return { fail: cookie ? 'cookie-invalid' : 'no-cookie' };
        const cap = pickYtCaption(got.info as never);
        if (!cap) return { fail: 'no-track' };
        try {
            // ⚠️ 字幕直链同样googlevideo 上，需要带 Referer（实测裸请求 403。
            // 🔴 这条正文请求**必须走代*（`ytProxyFor()`，⛔ 不是`dlTransport()`）
            //    元数据是 yt-dlp 子进程带代理拿的，正文却一直直被墙黑洞。
            //    `Request timed out after 30000ms`，YouTube 字幕长期拿不到。
            const t = this.dlTransport(this.ytProxyFor());
            const res = await t.get(cap.url, {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Referer: 'https://www.youtube.com/',
                ...(cookie ? { Cookie: cookie } : {}),
            });
            if (res.status !== 200 || !res.text) return { fail: 'other' };
            return {
                fileName: `YouTube ${cap.isAuto ? 'AI' : ''}字幕 ${cap.lang}`.replace(/\s+/g, ' ').trim(),
                text: res.text,
                isAi: cap.isAuto,
            };
        } catch {
            return { fail: 'other' };
        }
    }

    /**
     * 取当前网络集的 B 站字幕（含 AI 字幕，供选集页时间轴面板用）。
     *
     * 🔴 用户 2026-11-09 逐字：「播放网络集的字幕面板能不能显示其b站的AI字幕」
     *
     * ⚠️ 与 `biliStreamFor` **分开取**，⛔ 不塞进它返回的对象里：
     *    取流是起播关键路径（慢一点用户就等黑屏），字幕是到了再画就行；
     *    合成一次会让「字幕接口慢」变成「视频起播慢」。
     * ⚠️ 任何失败一律 `null`：没字幕不该影响播放（调用方据此显示「这一集没有字幕」）。
     */
    /** 「B 站 Cookie 已失效」提示的节流时间戳（一分钟内不重复弹，避免刷屏） */
    private biliCookieWarnAt = 0;

    private async biliSubtitleFor(url: string): Promise<BiliSubtitleResult> {
        if (!Platform.isDesktopApp) return { fail: 'other' };
        // Cookie 一定拿不到（实测匿名恒 0 条）省掉两次网络往。
        // ⚠️ 2026-11-24：`hasCookie` 原本`services/biliStream.ts` 里（已随内置播放器删除）。
        //    但它其实就是 `looksLikeCookie` 的一层空直接用纯逻辑那份，⛔ 别在这里再造一个。
        // 🔴 用户 m06406 ④：没填 Cookie 要单独成一种状态（「未能获取到本集字幕 指路重填）
        //    不能和「登录了但这集没字幕」混成同一null —两者用户该做的事完全相反。
        if (!looksLikeCookie(this.settings.biliCookie)) return { fail: 'no-cookie' };
        const cookie = normalizeCookie(this.settings.biliCookie);
        const headers: Record<string, string> = { 'User-Agent': BILI_UA, Referer: BILI_REFERER };
        const t = this.dlTransport();
        // 这一轮判定的失败原因（`fetchBiliSubtitle` `onDiag` 会填，默认按「没字幕轨」）
        let diag: { loginMid: number; trackCount: number } | null = null;
        try {
            let ids = biliIdsOf(url);
            if (!ids && isBiliShortUrl(url)) ids = biliIdsOf(await this.resolveBiliShortUrl(t, url, headers));
            if (!ids) return { fail: 'other' };
            const cid = await this.biliCidOf(t, ids, headers);
            if (!cid) return { fail: 'other' };
            // ⚠️ `dlTransport().get` 返回 `NodeHttpResponse`（多headers/finalUrl）
            //    在这里收窄成 `${status,text}` 服务层只依赖这两样，收窄免得Node 类型漏进纯逻辑。
            const got = await fetchBiliSubtitle(
                { get: async (u, h) => { const r = await t.get(u, h); return { status: r.status, text: r.text }; } },
                cid.cid,
                cid.bvid,
                cookie,
                // 🔴 B 站明说「未登录」时**必须**吭声：否则用户只看到「这一集没有字幕」，
                //    会以为是视频没字幕而反复粘 Cookie（2026-10-31 真实事故：真因是插件读的
                //    那套 vault 里躺着一个已失效的旧 SESSDATA，接口侧完全正常）。
                (d) => {
                    // 🔴 用户 m06406 ④：这个诊断现在*空态分岔的判据**，不再只是弹个提示。
                    //    先无条件记下来，后面Notice 只是「顺手提醒」，删了也不影响空态正确性。
                    diag = { loginMid: d.loginMid, trackCount: d.trackCount };
                    if (d.loginMid !== 0 || d.trackCount > 0) return;
                    const now = Date.now();
                    if (now - this.biliCookieWarnAt < 60_000) return; // 一分钟内不重复弹
                    this.biliCookieWarnAt = now;
                    // ⚠️ 处方路径同步成真正的设置位置（原来的「实验性功启用内置视频播放器。
                    //    早就不存在了，用户照着点会扑空 —`pure/netCueCopy` 文件头）。
                    new Notice('B站 Cookie 已失效：字幕接口认不出登录态（login_mid=0）。请到「设置 › 搜索配置 › 网络播放源凭据 › B站」重新粘贴一次 Cookie。', 8000);
                },
            );
            if (got) return got;
            // 没取到字幕：登录态没认出来（login_mid=0）⇒ Cookie 失效；否则就是这集真没轨。
            // 别把「空字幕」一律当「没 Cookie」—没诊断信息时按「没轨」说，不冤枉用户Cookie。
            if (diag && (diag as { loginMid: number }).loginMid === 0) return { fail: 'cookie-invalid' };
            return { fail: 'no-track' };
        } catch {
            return { fail: 'other' }; // 风控 / 网络异常：归不到 Cookie 或没轨，说「加载失败」
        }
    }

    /**
     * 短链 `b23.tv/xxxx` → 落地页（跟随一次重定向取 `finalUrl`，其它地址原样返回）。
     *
     * 🔴 为什么必须联网跳：真机实测 `https://b23.tv/BV1bE421g76i` ⇒ 302 →
     *    `https://www.bilibili.com/video/BV1bE421g76i`；而**手机分享出来的短码**（形如 `b23.tv/AbCd123`）
     *    里根本不含 BV 号，静态正则抠不出来 ⇒ `biliIdsOf` 只能一律拒。跳一次就有落地页了。
     * ⛔ 跳不到（网络不通 / 落地页仍是短链）⇒ 原样返回，让 `biliIdsOf` 继续拒，调用方回退 iframe。
     * ⛔ 只有 GET 才跳；`post` 走跳转会改变语义，这里用不到也不做。
     */
    private async resolveBiliShortUrl(
        t: DlTransport,
        url: string,
        headers: Record<string, string>,
    ): Promise<string> {
        if (!isBiliShortUrl(url)) return url; // 绝大多数链接：一次网络请求都不发
        try {
            const res = await t.get(url, headers); // `nodeHttpGet` 内部已跟随重定向并返回 finalUrl
            const finalUrl = res.finalUrl;
            if (finalUrl && /(^|\/\/|\.)bilibili\.com/i.test(finalUrl)) return finalUrl;
        } catch {
            // 短链解析失败不报错：按原样返回，上层自然iframe 兜底。
        }
        return url;
    }

    /** ① 取 cid：普通投稿走 pagelist，`av` 号走 view（拿 cid 同时换出 bvid），番剧走 pgc/view/web/season */
    /**
     * 取 cid；取不到写清原因到 `lastBiliError`（⚠️ 参数 `sink` 让调用方接住文案）。
     *
     * 🔴 为什么带 `sink` 而不是直接读 `this.lastBiliError`：本方法偶尔也用于只探封面/时长的
     *    旁路（见 `biliThumb` 同款链），那条路上写全局错误会污染下一次播放的提示。
     *    传 sink 让「会弹给用户看的那条路」自己决定要不要留话。
     */
    private async biliCidOf(
        t: DlTransport,
        ids: BiliIds,
        headers: Record<string, string>,
        sink?: (msg: string) => void,
    ): Promise<{ cid: number; bvid: string } | null> {
        // 🔴 `av` 形态单独一条：落地页（`/video/av80433022/`*只带 aid 不带 BV**。
        //    pagelist 又只cid 不回 bvid，playurl 的主参要 bvid 必须view 一次换齐。
        //    别指望「先 pagelist 再转」：那是两次请求，且第二次还得再解析一aid。
        if (ids.aid && !ids.bvid) {
            const res = await t.get(biliViewUrl(ids.aid), headers);
            if (res.status !== 200) {
                sink?.(`B 站详情接口返回 HTTP ${res.status}`);
                return null;
            }
            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                sink?.('B 站详情接口没回 JSON（多半是被风控拦了）');
                return null;
            }
            const got = pickViewByAid(json, ids.page);
            if (!got) sink?.(biliFailMessage(json) ?? 'B 站没给出这个视频的集号');
            return got;
        }
        const listUrl = biliPagelistUrl(ids);
        if (!listUrl) {
            sink?.('这个链接里解析不出可以查询的片号');
            return null;
        }
        const res = await t.get(listUrl, headers);
        if (res.status !== 200) {
            sink?.(`B 站选集接口返回 HTTP ${res.status}`);
            return null;
        }
        let json: unknown;
        try {
            json = JSON.parse(res.text);
        } catch {
            sink?.('B 站选集接口没回 JSON（多半是被风控拦了）');
            return null;
        }
        // 番剧：接口回的是 `result.episodes[]`（带 cid + bvid 两样。
        if (ids.epId || ids.ssId) {
            const got = pickPgcEpisode(json, ids.epId);
            if (!got) sink?.(biliFailMessage(json) ?? '番剧接口没给出这一集的 cid');
            return got;
        }
        const cid = pickCidFromPagelist(json, ids.page);
        if (!cid) {
            // 👇 两条报障条目正是走这条：`code=62002 稿件不可见` pagelist data null
            sink?.(biliFailMessage(json) ?? 'B 站没给出这一集的 cid');
            return null;
        }
        return ids.bvid ? { cid, bvid: ids.bvid } : null;
    }

    /**
     * 🔴 #577 选集封面**计划**（宿主侧）：本地视频 ⇒ 首帧；否则 B 站直链 ⇒ 缩略图；都没有 ⇒ 统一占位图。
     *
     * - **本地优先**（与全仓「本地恒在最前」同一条口径）：本地文件能定位到就**直接返回**，
     *   连 B 站那条请求都不发（⛔ 别为了「也拿个图」白打一次接口）；
     * - 网络侧**只认 B 站**（`bvidOf` 只认 bilibili.com / b23.tv 域名）：别的平台没有公开稳定的取图方式
     *   ⇒ 落占位图（用户明确允许的兜底：「获取失败时必须显示统一的默认占位图」）；
     * - 本方法**不写缓存**（缓存在 `biliThumb` 里按 `bvid` 做，同一合集 52 集共享同一条）。
     */
    private async epCoverFor(
        files: readonly (string | undefined)[],
        urls: readonly (string | undefined)[],
        idx: number,
    ): Promise<EpCoverPlan> {
        const raw = files[idx];
        // 库内走 getResourcePath、库外走 app://（与播放/探时长**同一条链**，⛔ 别另拼一份）
        const local = raw ? this.resolveEmbedUrl(String(raw)) ?? '' : '';
        if (local) return planEpCover(local, '');
        const net = String(urls[idx] ?? '');
        const bvid = bvidOf(urls[idx]);
        // 🔴 2026-11-10 YouTube（用户报「油管网络集在选集面板上封面没加载」）。
        //    `ytThumbUrl` 早就存在（`pure/youtube.ts` `i.ytimg.com/vi/<id>/mqdefault.jpg`）
        //    *零请求、幂等、不加时间戳**（正好对`pure/epCover.ts` 那三条封面纪律）。
        //    只是这里一直只`bvidOf` 油管链接恒落 `{kind:'none'}` 占位图。
        //    别为它加网络请求/内存缓存：`i.ytimg.com` 是稳CDN，浏览器自己就缓存了。
        const ytId = bvid ? '' : youTubeIdOf(net) ?? '';
        const thumb = bvid ? await this.biliThumb(bvid) : (ytId ? ytThumbUrl(ytId) : '');
        return planEpCover('', thumb);
    }

    /**
     * 🔴 #577 B 站视频**缩略图**地址（`bvid → https://…@320w_200h_1c.webp`）。三条纪律：
     *   ⑴ **同 `bvid` 只问一次**：缓存 → 在途 → 才排队（52 集同属一个合集时只打 1 次接口）；
     *   ⑵ **串行 + 间隔**（`EP_COVER_GAP_MS`）：`view` 实测吃风控，并发必然 412；
     *   ⑶ **取不到 ⇒ 空串**（调用方落占位图），**不写缓存**（下次打开还试）。
     * ⚠️ 走的是 `dlBiliView` 这条**已有**的链（同一接口、同一份 `buvid3` 缓存与重试纪律）
     *    —— ⛔ 别为封面另写一套 request + cookie。
     */
    private async biliThumb(bvid: string): Promise<string> {
        const b = String(bvid ?? '').trim();
        if (!b) return '';
        const hit = this.epCoverCache.get(b);
        if (hit !== undefined) return hit;
        const inflight = this.epCoverPending.get(b);
        if (inflight) return inflight;
        const task = this.epCoverGate
            .then(async () => {
                // 排到队时可能已经被前一条填上了（同一 bvid 的两条路）
                const again = this.epCoverCache.get(b);
                if (again !== undefined) return again;
                const out = await this.dlBiliView(b);
                const thumb = out.cover ? biliThumbUrl(out.cover) : '';
                if (thumb) this.epCoverCache.set(b, thumb);
                return thumb;
            })
            .catch(() => ''); // 传输层抛错 ⇒ 当「取不到」（封面不该把弹窗搞崩）
        this.epCoverPending.set(b, task);
        // 闸门后移：无论成败都等一个间隔再放行下一条
        this.epCoverGate = task.then(() => new Promise<void>((r) => window.setTimeout(r, EP_COVER_GAP_MS)));
        try {
            return await task;
        } finally {
            this.epCoverPending.delete(b);
        }
    }

    /**
     * #529 书籍「检索在线书籍阅读」：搜**微信读书网页版**，返回候选（书名/作者/封面/评分 + 阅读链接）。
     * ⛔ 只桌面端（走 Node 传输层）；失败一律「空结果 + error」，不抛（对齐 B 站那条口径）。
     * ⛔ 只检索链接，**不下载、不解析正文** —— 回填目标 = 条目 `readUrl`。
     */
    async searchWeread(keyword: string): Promise<{ books: WereadCandidate[]; error?: string }> {
        if (!Platform.isDesktopApp) return { books: [], error: '仅桌面端支持在线检索' };
        return searchWereadSvc(this.dlTransport(), keyword);
    }

    /**
     * #531 读某条目的失效检测结果（编辑表单 / 集数选择弹窗标红用）。
     * 🔴 内存态（`linkStatusCache`）；**没检测过 → 空数组**（⇒ 不标红，与旧行为一致）。
     */
    getLinkStatuses(entryId: string): (LinkStatus | undefined)[] {
        return this.linkStatusCache.get(entryId) ?? [];
    }

    /**
     * #531 **全库**检测失效链接 —— 入口在「设置 › 基本设置 › 封面与清理」那一组（用户 2026-10-05 指令：
     * 「把检测已填网络地址是否失效按钮放在设置页-基本设置-封面与清理下面，功能为全库检索失效链接标红」）。
     *
     * 🔴 结果**只存内存**（按条目写进 `linkStatusCache`）⇒ 编辑表单的集按钮与集数选择弹窗据此标红；
     *    ⛔ 不落 catalog（用户上一轮已裁定「仅内存缓存」）。
     * 🔴 全局并发上限 6：所有条目的地址**摊平成一条队列**（见 `services/linkCheck.checkAllLinks`），
     *    ⛔ 不是「每条目各开 6 路」。
     * ⛔ 只桌面端（走 Node 传输层）。
     *
     * 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-2）：结果不再在设置页内嵌一行文字，改成
     *    `LinkCheckModal` 弹窗逐条列出**具体是哪个条目的哪一集/哪条链接**失效 ⇒
     *    本方法追加返回 `items: DeadLinkItem[]`（条目名 / 字段标签 / 原始 URL）。
     *    ⚠️ 明细只能在这里拼：`services/linkCheck` 的结果是**按 `episodeUrls` 下标对齐的状态数组**，
     *       不含 label/url（那是展示层的语义），⛔ 别为了省这几行去改服务层形状。
     */
    async scanLibraryLinks(
        onDead?: (item: DeadLinkItem) => void,
        /**
         * 🔴 2026-11-17 用户报障（⑥-A）新增：给「停止检测」与进度用的钩子。
         *   `signal` —— 用户按了弹窗上的「停止」⇒ 传进来置 `stopped = true`，
         *      服务层各 worker 下一轮取任务前收手（已扫到的结果照常返回，不再发新请求）。
         *   `onProgress` —— 每探完**一条**回调一次，用于弹窗显示「已查 m / 共 n 条」，
         *      ⛔ 别改成「每探完一个条目」，用户要看的是分母明确的进度。
         * ⚠️ 不传 = 旧行为（无停止、无进度），旧调用方一行都不用改。
         */
        opts: {
            signal?: LinkCheckStopSignal;
            onProgress?: (done: number, total: number) => void;
        } = {},
    ): Promise<{
        entries: number;
        ok: number;
        dead: number;
        unknown: number;
        items: DeadLinkItem[];
        /** 是否被用户中途停止（true ⇒ 结果不完整，弹窗文案必须讲明） */
        stopped: boolean;
        /** 实际探测过的地址条数 / 总条数（停止时 done < total） */
        done: number;
        total: number;
    }> {
        if (!Platform.isDesktopApp) {
            return { entries: 0, ok: 0, dead: 0, unknown: 0, items: [], stopped: false, done: 0, total: 0 };
        }
        const list = await this.service.list();
        const targets = collectLinkScanTargets(list);
        // 总条数：摊平后真正要发请求的地址数（与 `services/linkCheck` 的 targets 口径一致）
        const total = targets.reduce((n, tg) => n + tg.urls.filter((u) => isHttpUrl(u)).length, 0);
        let done = 0;
        // entryId → 条目（只为取 title / episodeUrls / episodeTitles 拼明细；检测本身不需要它）
        const byId = new Map(list.map((e) => [e.id, e] as const));
        const items: DeadLinkItem[] = [];
        /**
         * 🔴 2026-10-25 用户指令（「失效链接：先弹窗再陆续显示检测到的失效链接」）：
         *    每探出一条 `dead` 就**立刻**回调给弹窗追加一行，⛔ 不是等全库跑完再一次性铺。
         *    回调只带展示所需的三元组，弹窗不碰 catalog / 服务层。
         *
         * ⚠️ `seen` 是必须的：`onRow` 每探完该行的**任意一条** URL 就会整行回调一次
         *    ⇒ 一个条目有 3 条失效链接时会回调 3 次，每次都看到前 3 条全 dead。
         *    不去重就会把同一条失效链接推 3 遍。键用 `entryId#下标`（URL 可重复，下标才唯一）。
         */
        const seen = new Set<string>();
        const emitDead = (r: { entryId: string; statuses: (LinkStatus | undefined)[] }): void => {
            const entry = byId.get(r.entryId);
            const urls = entry?.episodeUrls ?? [];
            r.statuses.forEach((st, i) => {
                if (st !== 'dead') return;
                const url = (urls[i] ?? '').trim();
                if (!url) return;
                const key = `${r.entryId}#${i}`;
                if (seen.has(key)) return;
                seen.add(key);
                // 电影是单集语义（`episodeHintLabel` 的 single 档显示标题本身），未填标题时回落到集序号
                const label = episodeHintLabel(i, entry?.episodeTitles?.[i], entry?.type === 'movie')
                    || `第 ${i + 1} 条链接`;
                const item: DeadLinkItem = { entryId: r.entryId, title: entry?.title ?? '', label, url };
                items.push(item);
                onDead?.(item);
            });
        };
        /**
         * ⚠️ 进度按「每行回调一次」粗略推进不对（一行有 3 条 URL 时回调 3 次却只算探完 3 条中的部分）——
         *    这里改用服务层的逐条计数：`onRow` 拿不到单条下标，所以进度用 `summary` 口径
         *    「已完成的 URL 数」= 各行当前非 undefined 的位累加。为保证单调不回退，
         *    用 Map 记录每行各下标的**最后一次**已知状态，只在有新增时 push。
         */
        const known = new Map<string, (LinkStatus | undefined)[]>();
        const bumpProgress = (entryId: string, statuses: (LinkStatus | undefined)[]): void => {
            const prev = known.get(entryId);
            known.set(entryId, statuses.slice());
            if (!prev) {
                done += statuses.filter((s) => s !== undefined).length;
            } else {
                let add = 0;
                statuses.forEach((s, i) => {
                    if (s !== undefined && prev[i] === undefined) add++;
                });
                done += add;
            }
            opts.onProgress?.(Math.min(done, total), total);
        };
        const results = await checkAllLinks(
            this.dlTransport(),
            targets,
            (entryId, statuses) => {
                bumpProgress(entryId, statuses);
                emitDead({ entryId, statuses });
            },
            { signal: opts.signal },
        );
        let ok = 0;
        let dead = 0;
        let unknown = 0;
        for (const r of results) {
            this.linkStatusCache.set(r.entryId, r.statuses);
            const s = summarizeLinkStatus(r.statuses);
            ok += s.ok;
            dead += s.dead;
            unknown += s.unknown;
        }
        // 渐进回调已经把 dead 明细收进 items 了（`seen` 去重）⇒ 这里不再补扫，避免重复
        return {
            entries: results.length,
            ok,
            dead,
            unknown,
            items,
            // 被用户中途停止：`checkEpisodeLinks` 会在 worker 收手后返回，剩余位是 undefined
            // ⚠️ 判据用 signal 而不是「done < total」：超时也记 unknown 进 done，
            //    正常跑完但全库恰好没地址时 done===total===0，不能因此报「被停止」。
            stopped: opts.signal?.stopped === true,
            done: Math.min(done, total),
            total,
        };
    }

    /**
     * 🔴 2026-10-22 用户指令：「失效链接检测完成后给一个一键清除按钮」。
     *
     * 清除口径（**用户当轮裁定**）：**只清 `dead`**，`unknown` 一律不动 —— 后者多为网络超时 /
     *   风控拦截，清掉等于把好好的链接误删（`pure/linkStatus` 注释里同一条理由）。
     *
     * 🔴 按下标清，不按 URL 反查：`linkStatusCache` 存的 `statuses` 与 `episodeUrls` **同下标**
     *    （见 `collectLinkScanTargets` / `scanLibraryLinks`）。同一集把同一条链接填两遍、
     *    或两集填同一条链接时，按 URL 找会一次清掉多条 / 清错集。
     * 🔴 保留空位（不压缩）：清第 2 集不能让第 3 集前移 —— 落库前还要过
     *    `pure/episodeAssoc.storeEpisodeList`（去尾空位、留中间的洞），逻辑在
     *    `pure/linkStatus.clearDeadEpisodeUrls` 里单点实现（有单测），⛔ 别在这里再写一套。
     * 🔴 写盘走 `service.update`（唯一写入口，连带笔记指纹 / 状态日志收口），⛔ 别直接改 catalog。
     *
     * @returns 实际清掉的链接条数 + 被动到的条目数（0 条 = 什么都没改，调用方据此决定文案）
     */
    async clearDeadLinks(): Promise<{ links: number; entries: number }> {
        if (!Platform.isDesktopApp) return { links: 0, entries: 0 };
        const list = await this.service.list();
        let links = 0;
        let entries = 0;
        for (const e of list) {
            const statuses = this.linkStatusCache.get(e.id);
            if (!statuses || statuses.length === 0) continue;
            const next = clearDeadEpisodeUrls(e.episodeUrls, statuses);
            if (!next) continue; // 该条目没有可清的 dead（或本来就空）
            const before = (e.episodeUrls ?? []).filter((u) => typeof u === 'string' && u.trim()).length;
            const after = next.filter((u) => typeof u === 'string' && u.trim()).length;
            if (after >= before) continue; // 纯防御：没真清掉就不写盘
            await this.service.update(e.id, { episodeUrls: next as string[] });
            links += before - after;
            entries++;
            // 该条目已清 ⇒ 缓存里对应位跟着失效（置 undefined），否则下次重复清除会重复计数
            this.linkStatusCache.set(
                e.id,
                statuses.map((s, i) => (s === 'dead' && e.episodeUrls?.[i] ? undefined : s)),
            );
        }
        if (links > 0) await this.refreshViews();
        return { links, entries };
    }

    /**
     * B站视频 → 音频（mp3）下载并落库（#496）。
     * 🔴 落盘口径与四平台**完全一致**：`downloadRelPath`（命名 / 净化 / 重名 `(2)(3)`）+ `writeBinaryFile`。
     *    区别只在「字节从哪来」—— 这里是 yt-dlp 抓到 `os.tmpdir()` 的临时目录里再读回来
     *    （临时目录由 `services/ytdlp` 自己清理，⛔ 不会在库里留半截文件）。
     * ⚠️ `ytdlpPath` **留空是合法值**（= 走系统 PATH），⛔ 别在这里兜底成 `'yt-dlp'`
     *    —— 候选名按平台生成，见 `pure/ytdlp.ytdlpExeCandidates`。
     */
    async dlBiliDownload(
        video: BiliVideo,
        onProgress?: DownloadProgressCallback,
        songTitle?: string,
    ): Promise<{ ok: boolean; message: string; relPath?: string }> {
        if (!Platform.isDesktopApp) return { ok: false, message: '下载功能仅支持桌面端' };
        const r = await fetchBiliAudioWithYtDlp(defaultYtDlpDeps(), {
            exe: this.settings.ytdlpPath ?? '',
            url: video?.webUrl ?? '',
            onProgress,
        });
        if (!r.ok || !r.data) return { ok: false, message: r.message };
        const sizeIssue = downloadSizeIssue(r.data.byteLength);
        if (sizeIssue) return { ok: false, message: sizeIssue };
        try {
            const taken = new Set(this.app.vault.getFiles().map((f) => f.path));
            const ext = r.ext || 'mp3';
            // 🔴 m07546 需求③：文件名*条目歌名**（`songTitle`），为空才回`作- 视频标题`。
            //    别退回只`video.author, video.title` —那正是用户点名要去掉的「B站视频标题」。
            //    ⚠️ 注释写在调用**外面**：`downloadRelPath` 的实参形态有逐字守卫（kind filename root
            //    三行紧邻），在实参中间插一行注释会把那条守卫撞红。
            const relPath = downloadRelPath({
                kind: 'music',
                filename: buildBiliAudioFilename(songTitle ?? '', video.author, video.title, ext),
                root: this.settings.musicDownloadDir,
                taken,
            });
            await this.writeBinaryFile(relPath, r.data);
            const mb = (r.data.byteLength / 1024 / 1024).toFixed(2);
            // 🔴 m04435 ②（用户逐字）：「从B站下载音乐：后台下载完成后**自动关联已有音乐条目**，
            //    不要求用户再手动搜索。」
            //    ⇒ 落盘之后立刻反查「库里哪一条音乐是这个文件」，找到就直接写 `audioPath`。
            // ⚠️ 放在 `writeBinaryFile` **之后**：文件不在库里时关联成功也没用（打开播放器会 404）。
            // ⚠️ 失败**不影响**下载成功的回执 —— 这是「顺手帮你关联」，不是下载的一部分。
            const auto = await this.autoAssociateDownloadedAudio(relPath);
            return { ok: true, message: `已下载 ${mb}MB：${relPath}（B站 \xB7 ${ext}）${auto}`, relPath };
        } catch (e) {
            return { ok: false, message: `请求失败：${e instanceof Error ? e.message : String(e)}` };
        }
    }

    /**
     * 🔴 m04435 ②：下载完的音频**自动关联**到库里已有的音乐条目（用户：「不要求用户再手动搜索」）。
     *
     * 返回一句**追加到成功回执末尾**的说明（空串 = 没关联上，调用方原样拼回去即可）。
     * ⛔ 绝不抛：这是下载成功后的顺手动作，任何异常都不许把「已经下好了」变成「下载失败」。
     *
     * 🔴 三条边界（都在 `pure/libraryAudio.matchAudioFileToEntry` 里判，⛔ 别在这里再判一遍）：
     *  ⑴ 只认 `music` 类型；⑵ **已经有 `audioPath` 的条目跳过**（别冲掉用户手工挑好的关联）；
     *  ⑶ 分数要过 `LIBRARY_AUDIO_MIN_SCORE` —— 不够就不关联，宁可让用户手动挑。
     * ⚠️ 笔记被外部改过时**不重写正文**（与 `EntryModal.onApplyAudio` 同一条口径）：
     *    只更新 catalog 字段，别覆盖用户手改的笔记。
     */
    private async autoAssociateDownloadedAudio(relPath: string): Promise<string> {
        try {
            const fileName = relPath.split('/').pop() ?? '';
            if (!fileName) return '';
            const entries = await this.service.list();
            const hit = matchAudioFileToEntry(entries, fileName);
            if (!hit) return '（没找到可自动关联的音乐条目，可在播放器里手动挑）';
            await this.service.update(hit.id, { audioPath: relPath });
            if (hit.notePath && !(await this.service.noteWasExternallyModified(hit.id))) {
                await this.service.writeNote(hit.id);
            }
            await this.refreshViews();
            return `（已自动关联到《${hit.title ?? fileName}》）`;
        } catch {
            // ⛔ 静默：下载本身已经成功了，这里的失败不该变成用户的失败提示
            return '';
        }
    }

    /**
     * 列出**库内音乐目录**下的音频文件（#404：本地音频浮层那枚「检索同名音频」小按钮的数据源）。
     *
     * 🔴 目录真源 = `pure/downloadPlan.downloadDir(settings.musicDownloadDir, 'music')`
     *    （默认 `下载/音乐`；与下载落盘用的是**同一个函数** ⇒ ⛔ 别在这里另拼一份路径，
     *    否则用户改了「音乐下载路径目录」后这里就找不到东西了）。
     * 🔴 扩展名按 `isAssociableAudioPath`（= `AUDIO_ASSOCIABLE_EXTENSIONS`）过滤 ——
     *    与「本地音频」字段能接受的文件同源，⛔ 不另列一份白名单。
     * ⚠️ 只扫**该目录下**（含子目录）：库内别处的音频不算「音乐目录里的」。
     */
    listLibraryAudioFiles(): LibraryAudioFile[] {
        const prefix = `${downloadDir(this.settings.musicDownloadDir, 'music')}/`;
        return this.app.vault
            .getFiles()
            .filter((f) => f.path.startsWith(prefix) && isAssociableAudioPath(f.path))
            .map((f) => ({ path: f.path, name: f.name }));
    }

    /**
     * #497 音乐条目「改关联的音频文件的名字」（用户：「再添加在音乐条目上修改关联的音频文件名称的功能」）。
     *
     * 纯逻辑（拆分 / 校验 / 目标 `.lrc` 路径）全在 `pure/renameAudio.planAudioRename`，本方法只做**它碰不到的事**：
     *  ⑴ **库内 / 库外分流**（判定与 `resolveEmbedUrl` / `absoluteMediaPath` 同源：先按库内相对试，不成当绝对）
     *  ⑵ 物理改名 —— 库内 `vault.rename`（顺带把**全库指向它的 wikilink 一起更新**，这是白捡的：
     *     笔记 ` ```lrc ` 块的 `source [[…]]` 正好是 wikilink）；库外 `fs.rename`（**桌面端门控**）
     *  ⑶ **同名 `.lrc` 一起改** —— 「同名 .lrc」是四路歌词来源之一，音频改名而歌词不改 ⇒ 歌词**静默失效**
     *  ⑷ 回写 catalog 的 `audioPath`（含**其它共用同一文件的条目**）+ 未被外部改过时重生成笔记
     *
     * 🔴 **重名即拒**（不覆盖、不自动加 `(2)`）：改名是用户主动指定名字，静默改写成别的名字比失败更糟；
     *    而覆盖已存在文件 = **直接毁掉用户另一个文件**。
     * 🔴 **物理改名在前、写库在后**：反过来的话，写库成功而改名失败会留下一个指向不存在文件的条目
     *    （播放按钮点了没反应，是最难查的那种）；现在最坏只是「文件改了名、条目还指旧路径」，
     *    用户重选一次即可，文件本身没丢。
     *
     * @param entryId 编辑态条目 id（新增态传 `null` —— 那时还没有条目可写，只改文件与表单）
     * @param currentPath 表单「文件路径」里的当前值（可能尚未保存，所以**不能**拿 catalog 的值代替）
     * @param newStem 新主名（扩展名由纯模块锁死，⛔ 不接受整名）
     */
    async renameEntryAudio(
        entryId: string | null,
        currentPath: string,
        newStem: string,
    ): Promise<{ ok: boolean; message: string; path?: string }> {
        const planned = planAudioRename(currentPath, newStem);
        if ('issue' in planned) return { ok: false, message: planned.issue };
        const plan = planned.plan;

        const fromFile = this.vaultFileOf(plan.from);
        let lrcNote = '';
        if (fromFile) {
            const target = normalizePath(plan.to);
            if (this.app.vault.getAbstractFileByPath(target)) {
                return { ok: false, message: `「${plan.toName}」已经存在，换个名字` };
            }
            await this.app.vault.rename(fromFile, target);
            lrcNote = await this.renameSiblingLrc(plan.lrcFrom, plan.lrcTo);
        } else {
            if (!Platform.isDesktopApp) return { ok: false, message: '库外文件改名仅桌面端支持' };
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                if (!(await this.pathExists(plan.from))) {
                    return { ok: false, message: `找不到这个文件：${plan.from}（路径可能已变，或它不在本机）` };
                }
                if (await this.pathExists(plan.to)) {
                    return { ok: false, message: `「${plan.toName}」已经存在，换个名字` };
                }
                await fs.rename(plan.from, plan.to);
            } catch (e) {
                return { ok: false, message: `请求失败：${e instanceof Error ? e.message : String(e)}` };
            }
            lrcNote = await this.renameSiblingLrc(plan.lrcFrom, plan.lrcTo);
        }

        // ④ 回写条目（含**共用同一文件的其它条目** —— 漏掉它们 = 那条的播放按钮静默失效）
        //    ⚠️ 新增态（`entryId` 为 null）同样要跑这一段：表单上的路径可能正是**别的条目**在用的文件。
        let touched = 0;
        try {
            const all = await this.service.list();
            const ids = all.filter((e) => e.audioPath === plan.from).map((e) => e.id);
            if (entryId && !ids.includes(entryId)) ids.push(entryId);
            for (const id of ids) {
                await this.service.update(id, { audioPath: plan.to });
                // 笔记里 `source` 行是按 audioPath 生成的 ⇒ 未被外部改过时重生成
                //（库内那支的 wikilink 已被 `vault.rename` 顺手更新，这里既是兜底、也是库外路径的唯一出路）
                if (!(await this.service.noteWasExternallyModified(id))) await this.service.writeNote(id);
                touched++;
            }
        } catch (e) {
            new Notice(`文件已改名为「${plan.toName}」，但写回条目失败：${e instanceof Error ? e.message : String(e)}${plan.toName}」，但写回条目失败：${e instanceof Error ? e.message : String(e)}`, 6000);
            await this.refreshViews();
            return { ok: true, message: `已改名为「${plan.toName}」`, path: plan.to };
        }
        await this.refreshViews();
        const extra = touched > 1 ? `（同时更新了 ${touched} 个条目）` : '';
        return { ok: true, message: `已改名为「${plan.toName}」${extra}${lrcNote}`, path: plan.to };
    }

    /** 该路径对应的**库内**文件（不是库内文件 ⇒ `null`）。判定与 `resolveEmbedUrl` 同源，⛔ 别用盘符前缀猜 */
    private vaultFileOf(path: string): TFile | null {
        try {
            const f = this.app.vault.getAbstractFileByPath(this.toVaultRelPath(String(path ?? '').trim()));
            return f instanceof TFile ? f : null;
        } catch {
            return null;
        }
    }

    /** 库外绝对路径是否存在（桌面端；模块加载失败 / 无权限 ⇒ `false`） */
    private async pathExists(p: string): Promise<boolean> {
        if (!Platform.isDesktopApp) return false;
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            await fs.stat(p);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 把与音频同名的 `.lrc` 一起改名（#497）。返回**追加到回执后面的一句话**（无歌词文件 ⇒ 空串）。
     * 🔴 目标已存在 ⇒ **只跳过 lrc、不改音频的结论** —— 覆盖会把用户另一个歌词文件毁掉。
     * ⚠️ 路径真源是 `pure/lrcSource.siblingLrcPath`（由纯模块算好传进来），⛔ 不在这里手拼 `.lrc`。
     */
    private async renameSiblingLrc(from: string | null, to: string | null): Promise<string> {
        if (!from || !to || from === to) return '';
        const f = this.vaultFileOf(from);
        if (f) {
            const target = normalizePath(to);
            if (this.app.vault.getAbstractFileByPath(target)) return '；同名歌词文件已存在，未改动';
            try {
                await this.app.vault.rename(f, target);
                return '；同名歌词文件已一起改名';
            } catch {
                return '；同名歌词文件未能改名';
            }
        }
        if (!(await this.pathExists(from))) return ''; // 没有同名歌词文件：什么都不说
        if (await this.pathExists(to)) return '；同名歌词文件已存在，未改动';
        try {
            const fs = require('fs/promises') as typeof import('fs/promises');
            await fs.rename(from, to);
            return '；同名歌词文件已一起改名';
        } catch {
            return '；同名歌词文件未能改名';
        }
    }

    /**
     * 写库内二进制文件（⑤-c）。🔴 两个坑：
     *  ⑴ Obsidian 的 `vault.create*` **都不自动建父目录** ⇒ 逐层补
     *     （`services/vaultIO` 里那段同名逻辑只服务**文本**写，⛔ 别指望它）；
     *  ⑵ `Uint8Array.buffer` 可能只是底层 `ArrayBuffer` 的一个**视图**（`byteOffset ≠ 0`）——
     *     直接用 `.buffer` 会把**整个底层缓冲**写进去（文件莫名变大、尾部混进别的数据）
     *     ⇒ 必须按 `byteOffset / byteLength` 切出真正属于这段数据的区间。
     */
    private async writeBinaryFile(relPath: string, data: Uint8Array): Promise<void> {
        const p = normalizePath(relPath);
        const segments = p.split('/');
        let cur = '';
        for (const seg of segments.slice(0, -1)) {
            cur = cur ? `${cur}/${seg}` : seg;
            if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
        }
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const existing = this.app.vault.getAbstractFileByPath(p);
        if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buf);
        else await this.app.vault.createBinary(p, buf);
    }

    /** 音频播放器的模式 / 音量写回设置（append-only 字段；落盘失败静默 —— 本次会话已生效） */
    private async persistAudioSetting(key: 'mode' | 'volume', value: number | string): Promise<void> {
        if (key === 'mode') this.settings.audioPlayMode = normalizeAudioPlayMode(value);
        // 🔴 音量标度是 0–2（200%，>1 走增益）：⛔ 别用 `clampVolume`（0..1）—— 那会把 150% 静默压回 100%
        else this.settings.audioVolume = clampAudioVolume(value);
        try {
            await this.saveSettings();
        } catch {
            /* 落盘失败不影响本次会话已生效的值 */
        }
    }

    /**
     * 播放器互斥：某一路起播 ⇒ 暂停**其余**路（真源 `pure/audioQueue.playersToPause`）。
     * 🔴两路都要在这里处理（音频 ↔ 视频是**双向**的）：只写一侧的后果，是另一侧起播时
     * 这一路**继续响** —— 而 UI-GUIDE **§15.5 F** 的口径是「同一时刻只允许一路在响」。
     * 新增第三路时**只改这一处**，⛔ 别在音频与视频两侧各写一遍「另一个是谁」——那样两边会漂。
     */
    private pauseOtherPlayers(starting: PlayerKind): void {
        const others = playersToPause(starting);
        if (others.includes('video')) {
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView) view.pauseForOtherPlayer();
            }
        }
        if (others.includes('audio')) {
            for (const leaf of this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof AudioPlayerView) view.pausePlayback();
            }
        }
    }

    /**
     * 笔记内 ` ```lrc ` 块 → 内联播放器（④-4 / D-8(c)：**接管但默认关**）。
     * 开关 = 「启用内置音乐播放器」（`settings.audioInlinePlayer`，基本设置 · 实验性功能）。
     * 🔴 2026-09-27 #399：它同时是**歌曲下载按钮**的门控（用户：「开启后始终有 LRC 显示播放器、
     *    下载歌曲功能，关闭后不显示下载按钮」）⇒ ⛔ 别再拆出第二个开关。
     * 两层让位：⑴ 设置关（缺省）⇒ 不接管，笔记外观与升级前完全一致；
     *          ⑵ 检测到 LyricFlux 启用 ⇒ 仍不接管（它也注册同名块处理器，两边都画就是两个播放器叠在一起）。
     *
     * 🔴 **第 ⑵ 层让位必须判在 `registerMarkdownCodeBlockProcessor(...)` **之前**，
     *  ⛔ 不能只写在回调里** —— Obsidian 的语言表是 **全局静态** 的（`AW.codeBlockPostProcessors`，
     *  见 `registerCodeBlockPostProcessor`：`if (n.hasOwnProperty(e)) throw new Error(...)`），
     *  同一语言 **重复注册直接抛错**，而调用点就在 `onload` ⇒ **整个插件加载失败**（#390 实测：
     *  `Error: Code block postprocessor for language lrc is already registered`）。
     *  ⚠️ 回调里那层只能防「两个播放器叠着画」，**防不住「插件起不来」**；两处都要有，但顺序不能反。
     */
    private registerLrcBlockProcessor(): void {
        if (this.isLyricFluxEnabled()) return;
        try {
            this.registerMarkdownCodeBlockProcessor('lrc', (source, el, ctx) => {
                if (this.settings.audioInlinePlayer !== true) return;
                ctx.addChild(
                    new AudioInlineBlock(el, () => this.audioOptionsForNote(ctx.sourcePath, source)),
                );
            });
        } catch (e) {
            // 兜底：占住 `lrc` 的**不止 LyricFlux**（`lyricflow` / `lyricflux` 等同族插件都可能）
            // ⇒ 让位，⛔ 绝不把 `onload` 带崩（那等于整个插件不可用）。
            console.warn('[ReelLudic] lrc 代码块已被其它插件接管，内置内联播放器让位：', e);
        }
    }

    /**
     * 笔记条目卡的**行内快捷编辑**落库出口（2026-11-16 第三次裁定）。
     *
     * 分工：解析键语义交给纯层 `applyNoteCardEdit`（它是与读投影严格成对的唯一真源，
     * `tests/noteCard.test.ts` 钉着），这里只负责「写下去」这一段的顺序与异常：
     * `service.update`（normalizeEntry / updatedAt / 状态变更补活动流）
     * → `service.writeNote`（保留区合并 / 笔记指纹刷新）→ 返回落库后的最新条目。
     *
     * 🔴 返回 `undefined` = **这次编辑被拒绝**（键只读 / 值非法），渲染层据此原样回显，
     *   ⛔ 不弹「已保存」的假成功。`writeNote` 失败只提示不阻断 —— 数据已经进 catalog，
     *   下一次刷新笔记会补上（与 `saveQuickAssociate` 同口径）。
     */
    private async saveNoteCardField(id: string, key: string, raw: string): Promise<MediaEntry | undefined> {
        const entry = await this.service.get(id);
        if (!entry) return undefined;
        const patch = applyNoteCardEdit(entry, key, raw);
        // `null` = 不可写 / 非法值 ⇒ 静默拒绝，让卡里原样回显（⛔ 别当成成功）
        if (!patch) return undefined;
        const merged = await this.service.update(entry.id, patch);
        try {
            await this.service.writeNote(merged.id);
        } catch (e) {
            new Notice('笔记同步失败：' + (e instanceof Error ? e.message : String(e)), 5000);
        }
        return merged;
    }

    /**
     * 笔记内 ` ```reelludic ` 块 → **插件专属条目卡**（🔴 2026-11-14 用户 m04138 指令）。
     *
     * 用户原话：「在笔记规划渲染出插件专属组件，因为笔记属性和表单两个可视化不对等的」。
     * 拍板口径（询问后确认）：⑴ 代码块显式挂载；⑵ 可交互（点字段直接改并回写）；
     * ⑶ 替换掉笔记里那张 `| 属性 | 内容 |` Markdown 表格（见 `data/noteGenerator`）。
     *
     * 🔴 **2026-11-14 用户 m07593 翻面**：卡内改成**纯详情视图**（只渲染密排的「键：值」），
     *    改值统一走标题旁的「编辑」按钮 → 打开 `EntryModal`（编辑属性窗口）。
     *    ⇒ 常驻输入框那版不再回来；编辑属性窗口本身就是 `EntryModal`，它内部走
     *    `service.update` + `writeNote`，保留区合并 / 指纹刷新 / 活动流一样不少。
     *
     * 🔴 **2026-11-16 第三次裁定：行内快捷编辑**（用户：「加行内快捷编辑，不再恢复旧表格」）。
     *    ⇒ 注入 `saveField`：点值就地换控件、写完即收起；**不占地方**（m07593 的诉求仍满足），
     *    也**不复活**旧 Markdown 属性表格。解析语义交给纯层 `applyNoteCardEdit`（唯一真源），
     *    落库仍走下面的 `saveNoteCardField`（`service.update` + `writeNote`）。
     *
     * 🔴 **语言名必须与 `pure/noteCard.NOTE_CARD_LANG` 同源**：⛔ 别再手写一遍 `'reelludic'`。
     * 与 `lrc` 不同，这个语言名是本插件专有的，不需要 LyricFlux 那套让位；但仍套 try/catch ——
     * Obsidian 的语言表是**全局静态**的，重复注册会直接抛错，抛在 `onload` 里就是整个插件加载失败
     * （#390 的教训，见 `registerLrcBlockProcessor` 的注释）。
     *
     * ⚠️ 写路径**必须**走 `EntryService.update` + `writeNote`：
     *    · `update` 负责 `normalizeEntry`、`updatedAt`、状态变更补活动流；
     *    · `writeNote` 负责保留区合并（摘录 / 歌词 / 相关）与笔记指纹刷新。
     *    绕过任何一环都会出现「改了但笔记没变」或「下次打开被旧指纹覆盖」，⛔ 别在渲染层直接写 vault。
     */
    private registerNoteCardBlockProcessor(): void {
        try {
            this.registerMarkdownCodeBlockProcessor(NOTE_CARD_LANG, (source, el, ctx) => {
                ctx.addChild(
                    new NoteCardBlock(el, source, {
                        getEntry: (id) => this.service.get(id),
                        openEntry: (id) => void this.openEntryNote(id),
                        editEntry: (id) => void this.openEditModal(id),
                        posterUrl: (e) => this.resolvePoster(e),
                        saveField: (id, key, raw) => this.saveNoteCardField(id, key, raw),
                    }),
                );
            });
        } catch (e) {
            // 理论上不会命中（`reelludic` 是本插件专有语言名）；命中说明有同名插件，让位别带崩 onload
            console.warn('[ReelLudic] reelludic 代码块注册失败，条目卡让位：', e);
        }
    }

    /**
     * 笔记内 lrc 块的播放选项：队列**只有这一首**（笔记里的块指向一个音频）。
     * 音频解析不出来时不抛错，而是回一个空队列 —— 装配层会用空态说明原因（⛔ 不静默吞掉整块）。
     */
    private async audioOptionsForNote(notePath: string, source: string): Promise<AudioPlayerOptions> {
        const block = parseLrcBlock(source);
        const ref = parseLrcRef(block.audio ?? '');
        const path = ref?.value ?? '';
        const url = path ? this.resolveEmbedUrl(path) : null;
        const entry = (await this.service.list()).find((e) => e.notePath === notePath) ?? null;
        if (!path || !url) {
            return { items: [], startIndex: 0, inline: true, loadLyrics: async () => null };
        }
        const track: AudioPlayerTrack = {
            entryId: entry?.id ?? '',
            title: entry?.title ?? (fileNameOfPath(path) || '音频'),
            subtitle: entry ? audioSubtitle(entry) : '',
            path,
            url,
            coverUrl: entry ? this.resolvePoster(entry) ?? null : null,
        };
        return {
            items: [track],
            startIndex: 0,
            inline: true,
            // ⚠️ 内联块**不传那个「打开即播」的开关**（打开笔记就出声很吵，那次也没人点播放键）；
            //    逐字高亮与标签页共用同一个开关（同一个播放器、同一个设置）。
            wordHighlight: this.settings.lyricsWordHighlight !== false,
            loadLyrics: () => this.pickLyricsFor(block, path),
            initialMode: normalizeAudioPlayMode(this.settings.audioPlayMode),
            initialVolume: clampAudioVolume(this.settings.audioVolume ?? 1),
            onSaveMode: (mode) => void this.persistAudioSetting('mode', mode),
            onSaveVolume: (volume) => void this.persistAudioSetting('volume', volume),
            onPlayStart: (kind) => this.pauseOtherPlayers(kind),
            /**
             * 🔴 m02288：内联块**也**自动累计收听时长 —— 在笔记里听歌同样是收听，
             * 没理由只算标签页那一份（否则同一首歌换个入口打开，时长就少了一半）。
             * 判真源与服务层方法同标签页那条构造（见 `buildAudioPlayerOptions` 里的长注释）。
             */
            onListen: (t, minutes) => {
                if (!t.entryId) return;
                void this.service
                    .bumpListenMinutes(t.entryId, minutes)
                    .then((e) => {
                        if (e) this.refreshViews();
                    })
                    .catch(() => undefined);
            },
        };
    }

    /**
     * LyricFlux 是否已启用（④-4 块处理器让位判定）。
     * ⚠️ `app.plugins` **不在** `obsidian.d.ts` 的公开类型里 ⇒ 经 `unknown` 收窄 + try/catch；
     *    探测失败按「未启用」处理（宁可自己画，也别因为探测不到就整块不渲染）。
     */
    private isLyricFluxEnabled(): boolean {
        try {
            const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
            return !!plugins?.enabledPlugins?.has(LYRICFLUX_PLUGIN_ID);
        } catch {
            return false;
        }
    }

    /** 绝对路径 → vault 相对路径（在 vault 内则去前缀；库外保留原样——LyricFlux 两种都支持） */
    private toVaultRelPath(abs: string): string {
        try {
            const base = (this.app.vault.adapter as FileSystemAdapter).getFullPath('');
            const norm = abs.replace(/\\/g, '/').replace(/\/+$/, '');
            const b = base.replace(/\\/g, '/').replace(/\/+$/, '');
            if (norm.toLowerCase().startsWith(b.toLowerCase())) {
                return normalizePath(norm.slice(b.length).replace(/^\/+/, ''));
            }
        } catch { /* 忽略 */ }
        return abs;
    }

    /** 删除摘抄（阅读器书签右键）：ConfirmModal 确认 → 从笔记摘抄区移除块；返回是否删除成功（供面板刷新书签列表） */
    async deleteBookExcerpt(entryId: string, blockId: string): Promise<boolean> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return false;
            const ok = await new ConfirmModal(
                this.app,
                `将从《${e.title}》笔记摘抄区移除该摘抄（删除笔记中的摘抄标记后不可恢复）。`,
                '删除',
            ).open();
            if (!ok) return false;
            const r = await this.service.deleteExcerpt(entryId, blockId);
            new Notice(`已删除摘抄 · 《${e.title}》现有 ${r.count} 条`);
            return true;
        } catch (err) {
            new Notice(`删除摘抄失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    /** 一键即黄即记：写入**阅读数据存档**（高亮真源）并返回新块 id 供阅读器即时 mark；失败 null（不抛，已 Notice 原因）。
     *  🔴 #528（2026-10-05 用户裁定「高亮数据仅保存在阅读进度文件里」）：**不再同步笔记镜像** —— 高亮只落 JSON，
     *  笔记里那份「## 高亮」区不再生成（存量残留由 `migrateRemoveHighlightMirrors` 清理）。 */
    private async addBookHighlight(
        entryId: string,
        title: string,
        quote: string,
        loc: { chapter: number; pct: number },
        style?: HlStyle,
        color?: HlColor,
        rects?: PdfRelRect[],
    ): Promise<string | null> {
        try {
            const mem = await this.ensureReaderStore(entryId, title);
            const id = generateBlockId('hl');
            const hl: ReaderHighlight = {
                quote: quote.trim(),
                id,
                loc,
                style: normalizeHlStyle(style),
                color: normalizeHlColor(color),
            };
            // PDF 页内几何（可选）：TXT/EPUB 不传 → 字段不出现，存档形状与旧版完全一致
            const rel = normalizeRelRects(rects);
            if (rel) hl.rects = rel;
            mem.store = withHighlights(mem.store, [...mem.store.highlights, hl]);
            await this.flushReaderStore(entryId);
            return id;
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }

    /** 删除高亮（阅读器标注右键）：ConfirmModal 确认 → 从存档移除（#528 起不再写笔记）；返回是否成功 */
    async deleteBookHighlight(entryId: string, blockId: string): Promise<boolean> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return false;
            const ok = await new ConfirmModal(this.app, `将从《${e.title}》的高亮中移除该条（删除后不可恢复）。`, '删除').open();
            if (!ok) return false;
            const n = await this.removeReaderHighlights(entryId, e.title, [blockId], []);
            if (!n) {
                new Notice('该高亮不存在或已删除');
                return false;
            }
            new Notice(`已删除高亮 · 《${e.title}》`);
            return true;
        } catch (err) {
            new Notice(`删除高亮失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    /** 读取书籍文件文本（TXT）：vault 相对 → vault.read；库外绝对路径（toVaultRelPath 未转换）→ fs 读取；失败返回 null */
    /** 读取书籍文本（TXT）：vault 相对或库外绝对双路径；供 ReaderView 视图内读取（对齐 weave-reader 视图自行加载） */
    async readBookText(path: string): Promise<string | null> {
        // 🔴 必须读二进制再嗅探编码：中文网络小说 TXT 多为 GBK/GB18030 且无 BOM，
        // 直接按 utf8 解会全篇 U+FFFD（乱码）→ 章节正则匹配不到 → 整书退化成单章 → 一次渲染数百万字 DOM 卡死。
        // 零新依赖：Chromium/Node 的 TextDecoder 原生支持 gb18030。
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const buf = await this.app.vault.readBinary(file);
            return decodeTxtBytes(new Uint8Array(buf));
        }
        if (Platform.isDesktopApp) {
            try {
                // 注意：Obsidian 渲染进程原生 import() 不可靠，用 require
                const fs = require('fs/promises') as typeof import('fs/promises');
                const buf = await fs.readFile(path);
                return decodeTxtBytes(new Uint8Array(buf));
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * 读取**原始字节**（音频内嵌歌词解析用）。
     * 🔴 与 `readBookText` 的区别：那个是「先读字节、嗅探编码、再整体解码」——适合纯文本；
     *    **音频绝不能被整体解码**（编码信息在帧内部，ID3 每帧自己带编码字节）⇒ 只能原样取字节，
     *    由 `pure/embeddedLyrics` 在帧内按自己的编码字节解。
     * 路径形态与 `readBookText` 一致：vault 相对 → `vault.readBinary`；库外绝对 → `fs`。失败回 `null`。
     */
    async readBookBytes(path: string): Promise<Uint8Array | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            try {
                return new Uint8Array(await this.app.vault.readBinary(file));
            } catch {
                return null;
            }
        }
        if (Platform.isDesktopApp) {
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                return new Uint8Array(await fs.readFile(path));
            } catch {
                return null;
            }
        }
        return null;
    }

    // ── #537 漫画来源（图片文件夹 / CBZ·ZIP / CBT·TAR）────────────────────────────
    // 判据真源在 `pure/comicFiles`（图 / 档两张扩展名表 + 自然序 + 归档项过滤）；
    // 本段只做「来源 → 页序（按需取字节）」的宿主侧适配 —— 面板不碰文件系统、也不解包。

    /** 路径是否**绝对**（盘符 / UNC / 以斜杠开头）—— 区分「库内相对」与「库外绝对」两条 IO 通道 */
    private isAbsolutePath(path: string): boolean {
        return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(String(path ?? '').trim());
    }

    /** 该路径是不是**目录**（漫画文件夹型）：库内查 TFolder；库外桌面端 statSync；拿不到一律 false */
    isDirectoryPath(path: string): boolean {
        const p = String(path ?? '').trim();
        if (!p) return false;
        const f = this.app.vault.getAbstractFileByPath(normalizePath(p));
        if (f) return f instanceof TFolder;
        if (!this.isAbsolutePath(p) || !Platform.isDesktopApp) return false;
        try {
            const fsMod = require('fs') as { statSync(p: string): { isDirectory(): boolean } };
            return fsMod.statSync(p).isDirectory();
        } catch {
            return false;
        }
    }

    /** 列出漫画文件夹里的图片页（**自然序**；库内相对走 vault.adapter，库外绝对走 fs）。失败 → [] */
    async listComicFolderPages(dir: string): Promise<string[]> {
        const d = String(dir ?? '').trim().replace(/[\\/]+$/, '');
        if (!d) return [];
        try {
            if (this.isAbsolutePath(d)) {
                if (!Platform.isDesktopApp) return [];
                const fsMod = require('fs') as { readdirSync(p: string): string[] };
                const names = fsMod.readdirSync(d).filter(isComicImageName);
                return sortComicPages(names.map((name) => ({ name }))).map((x) => x.name);
            }
            const adapter = this.app.vault.adapter as unknown as { list(p: string): Promise<{ files: string[] }> };
            const r = await adapter.list(d);
            const names = (r?.files ?? [])
                .map((p) => p.slice(p.lastIndexOf('/') + 1))
                .filter(isComicImageName);
            return sortComicPages(names.map((name) => ({ name }))).map((x) => x.name);
        } catch {
            return [];
        }
    }

    /** 读一页图片字节（文件夹型 / 宿主兜底）：库内相对或库外绝对，与 `readBookBytes` 同一通道 */
    private async readComicPageBlob(filePath: string): Promise<Blob | null> {
        const bytes = await this.readBookBytes(filePath);
        return bytes ? new Blob([bytes], { type: comicMime(filePath) }) : null;
    }

    /**
     * 打开漫画压缩包（CBZ/ZIP 走 jszip；CBT/TAR 走零依赖 `pure/tarParse`）→ 页序句柄。
     * 🔴 **按需取页**：ZIP 只持 jszip 文档（`file().async()` 逐页解）、TAR 只持原字节视图，
     *    ⛔ 别在打开时把 200 页全读进内存（200 张 1MB 图 = 200MB 常驻）。
     * 返回 `null` = 文件不存在 / 读取或解包失败；`names.length === 0` = 包里没有图片页（调用方分别提示）。
     */
    private async openComicArchive(path: string): Promise<{ names: string[]; read: (i: number) => Promise<Uint8Array | null> } | null> {
        const bytes = await this.readBookBytes(path);
        if (!bytes) return null;
        const ext = comicExt(path);
        if (ext === 'zip' || ext === 'cbz') {
            try {
                // jszip 懒加载（esbuild 打包进 main.js；CJS 互操作取 .default）—— 与 EPUB 解包同款
                const JSZip = (await import('jszip')).default;
                const zip = await JSZip.loadAsync(bytes);
                const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir && isComicArchiveEntry(n));
                const names = sortComicPages(entries.map((name) => ({ name }))).map((x) => x.name);
                /**
                 * 🔴 #669：CBZ 也补上「解压缓存 + 并发去重 + 有界 LRU」——与 `unpackEpub` 的 `loadBinary`
                 * **同一套口径**（那条是 #642 修的）。
                 *
                 * 为什么必须补：`JSZip.file().async()` **不缓存结果**，同一张图取两次就解两次。
                 * 阅读器侧从 #669 起会**并发**取图（单页制当前页 + 预取下一页；连续模式 IO 预取上下各 1.5 屏
                 * + 缩略图窗口 13 格），而且**每次滚动都可能重来**。实测（#642，`_probe_642_zip.cjs`）：
                 * 单张 8ms、串行 20 张 310ms —— 一次滚动就能占住主线程三分之一秒。
                 *
                 * ⚠️ 上限按**字节数**算（扫描页单张可达数 MB，按条数限会失控）；64MB ≈ 20~40 张扫描页。
                 * ⚠️ 只缓存**成功**解出的结果，坏条目每次都重试（与 EPUB 同口径）。
                 */
                const ZIP_BINARY_CACHE_MAX_BYTES = 64 * 1024 * 1024;
                const binaryCache = new Map<string, Uint8Array>();
                const binaryInflight = new Map<string, Promise<Uint8Array | null>>();
                let binaryCacheBytes = 0;
                const touchBinary = (key: string, data: Uint8Array): void => {
                    if (binaryCache.has(key)) {
                        binaryCacheBytes -= binaryCache.get(key)?.byteLength ?? 0;
                        binaryCache.delete(key);
                    }
                    binaryCache.set(key, data);
                    binaryCacheBytes += data.byteLength;
                    // Map 的插入序即 LRU 序：从头部淘汰（至少留 1 条，免得单张超上限时把刚存进去的自己挤掉）
                    while (binaryCacheBytes > ZIP_BINARY_CACHE_MAX_BYTES && binaryCache.size > 1) {
                        const oldest = binaryCache.keys().next().value as string | undefined;
                        if (oldest === undefined) break;
                        const evicted = binaryCache.get(oldest);
                        binaryCache.delete(oldest);
                        binaryCacheBytes -= evicted?.byteLength ?? 0;
                    }
                };
                return {
                    names,
                    read: async (i) => {
                        const n = names[i];
                        if (!n) return null;
                        const hit = binaryCache.get(n);
                        if (hit) {
                            touchBinary(n, hit); // 命中即刷新 LRU 位置
                            return hit;
                        }
                        const pending = binaryInflight.get(n);
                        if (pending) return pending; // 并发去重：同一页只会解压一次
                        const f = zip.file(n);
                        if (!f) return null;
                        const task = (async (): Promise<Uint8Array | null> => {
                            try {
                                const out = await f.async('uint8array');
                                touchBinary(n, out);
                                return out;
                            } catch {
                                return null; // 坏条目 ⇒ 当作取不到（阅读器侧显示占位，不抛）
                            } finally {
                                binaryInflight.delete(n);
                            }
                        })();
                        binaryInflight.set(n, task);
                        return task;
                    },
                };
            } catch {
                return null;
            }
        }
        // TAR / CBT：`parseTar` 返回的 bytes 是原缓冲的**子视图**（不额外拷贝），过滤 + 自然序后按名取页
        const found = parseTar(bytes).filter((e) => isComicArchiveEntry(e.name));
        const names = sortComicPages(found.map((e) => ({ name: e.name }))).map((x) => x.name);
        const byName = new Map(found.map((e) => [e.name, e.bytes] as const));
        return { names, read: async (i) => (names[i] ? (byName.get(names[i]) ?? null) : null) };
    }

    /** 探针本地书籍文件进度基准（表单「进度页数」自动关联用）：PDF 返回 numPages（页基准）；TXT 按章节解析返回 totalChapters；
     *   EPUB 解包取 spine 章节数做基准（章节制，与 TXT 同构）；漫画（#537）返回页数（文件夹图片数 / 压缩包图片页数）；
     *   失败返回 undefined。PDF 复用 pdfjs 单例 worker（Blob 内联），只解析不渲染，轻量 */
    async probeBookPages(path: string): Promise<BookProbeResult | undefined> {
        const lower = path.toLowerCase();
        // 🔴 #537 漫画优先于扩展名判定 —— 文件夹型**没有扩展名**，得先看它是不是目录
        if (this.isDirectoryPath(path)) {
            const names = await this.listComicFolderPages(path);
            return names.length ? { format: 'comic', numPages: names.length } : undefined;
        }
        if (isComicArchivePath(path)) {
            const arc = await this.openComicArchive(path);
            return arc && arc.names.length ? { format: 'comic', numPages: arc.names.length } : undefined;
        }
        if (lower.endsWith('.pdf')) {
            const data = await this.readPdf(path);
            if (data === null) return undefined;
            const numPages = await probePdfNumPages(data);
            return numPages !== undefined ? { format: 'pdf', numPages } : undefined;
        }
        if (lower.endsWith('.txt')) {
            const text = await this.readBookText(path);
            if (text === null) return undefined;
            return { format: 'txt', totalChapters: parseTxtBook(text).chapters.length };
        }
        if (lower.endsWith('.epub')) {
            // EPUB 无固定页码（流式重排），spine 章节数 = 进度基准（阅读器 chapterIndex 制同口径）
            try {
                const epub = await this.unpackEpub(path);
                if (!epub) return undefined;
                return { format: 'epub', totalChapters: epub.book.chapters.length };
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    /** 读 PDF 二进制（内置 PDF 阅读器用）：vault 内 adapter.readBinary（ArrayBuffer）；库外 fs.readFile → ArrayBuffer */
    async readPdf(path: string): Promise<ArrayBuffer | null> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            try {
                return await this.app.vault.adapter.readBinary(file.path);
            } catch {
                return null;
            }
        }
        if (Platform.isDesktopApp) {
            try {
                const fs = require('fs/promises') as typeof import('fs/promises');
                const buf = await fs.readFile(path);
                // Buffer 底层 ArrayBuffer 可能带池偏移，slice 出独立视图（pdfjs 需要精确的 data 边界）
                return this.toArrayBuffer(buf);
            } catch {
                return null;
            }
        }
        return null;
    }

    // ── 阅读数据存档（进度 + 书签 + 高亮，一本一个 JSON 文件）────────────────────────────────
    // 位置 `{libraryDir}/阅读进度/{书名}-阅读-{id}.json`；schema / 容错 / 路径全在 `pure/readerStore`。
    // 落盘策略（KOReader 式）：**内存态即真源**，滚动的进度按 1000ms 合并窗口落盘（最多 1 写/秒），
    // 标注/书签增删、翻章、关闭阅读器、插件卸载一律**立即落盘**（都是明确动作，不能等）。
    // 旧三源（进度文件 / 书签文件 / 笔记「## 高亮」区）在首次打开该书时**懒迁移**进来；旧文件按 D-5 保留一个版本。

    /** 内存态（按条目 id 缓存，打开阅读器时载入） */
    private readerStores = new Map<string, ReaderStoreMem>();
    /** 载入去重（同一本书被并发打开时只读一遍、只迁移一遍） */
    private readerStoreLoads = new Map<string, Promise<ReaderStoreMem>>();

    /**
     * #527 剧集链接失效检测结果（**只存内存**，用户裁定「仅内存缓存」）：
     * key = 条目 id，value = 与 `episodeUrls` 下标对齐的状态数组。
     * 用途：编辑表单点「检测失效」后写入，海报墙「观看」那张**集数选择弹窗**据此标红（同一份口径）；
     * 🔴 不落 catalog（探测结果可随时重测，写进 schema 只会引入一份会过期的缓存）。
     */
    private linkStatusCache = new Map<string, (LinkStatus | undefined)[]>();

    /**
     * 「条目 → 它当初打开选集页时用的那片叶子」（`entryId` 键）。
     *
     * 🔴 2026-11-09 用户逐字：「播放器全屏按钮点击后怎么是新开一个标签页给我覆盖成当前标签页，
     *    再点全屏按钮即回到原来播放器页面」⇒ 交接必须**占用选集页那片叶子**（观感是原地翻页），
     *    回跳也必须在**同一片叶子**上换回选集页。`setViewState` 换视图后旧视图实例被销毁，
     *    `getLeavesOfType(EPISODE_PAGE_VIEW_TYPE)` 那一招就再也找不到它 —— 所以这里按 id 记下来。
     *
     * ⚠️ 只存内存、不落库：叶子是运行时对象，重启即失效（失效就当没记过，退化成「现开一页」）。
     * ⚠️ 换片/关页都不主动清：条目 id 不变时复用的就是同一片叶子，清早了反而退回新开标签页。
     */
    private episodeOriginLeaf = new Map<string, WorkspaceLeaf>();

    /** 附件管理弹窗单例：再次点设置页的「浏览」时把已开的那个**拉到前面**，⛔ 不叠第二个。
     *  （列表是打开那一刻的快照；重开一次才重扫，符合「管理文件」的一次性动作） */
    private assetManagerModal: AssetManagerModal | null = null;
    private assetManagerOpen = false;

    /** 取内存态（无则载入 + 懒迁移）；title 每次都刷新（条目可能改过名，文件名基准要跟着走） */
    private async ensureReaderStore(entryId: string, title: string): Promise<ReaderStoreMem> {
        const hit = this.readerStores.get(entryId);
        if (hit) {
            hit.title = title;
            return hit;
        }
        const inflight = this.readerStoreLoads.get(entryId);
        if (inflight) return inflight;
        const p = (async (): Promise<ReaderStoreMem> => {
            const mem: ReaderStoreMem = { store: await this.loadOrMigrateReaderStore(entryId, title), title, timer: null };
            this.readerStores.set(entryId, mem);
            return mem;
        })();
        this.readerStoreLoads.set(entryId, p);
        try {
            return await p;
        } finally {
            this.readerStoreLoads.delete(entryId);
        }
    }

    /** 读存档：文件存在且能解析出 version → 归一后返回；否则走懒迁移（升级首开 / 坏档同路：按空档重建）。 */
    private async loadOrMigrateReaderStore(entryId: string, title: string): Promise<ReaderStore> {
        const path = normalizePath(readerStoreFilePath(entryId, title, this.settings.libraryDir));
        let raw: unknown;
        try {
            raw = JSON.parse(await this.app.vault.adapter.read(path));
        } catch {
            raw = undefined;
        }
        if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>).version === 'number') {
            return normalizeStore(raw);
        }
        // 懒迁移（一次性、幂等、非破坏）：合成新档 → 先写盘，旧文件与笔记原区**一律不删**
        const store = mergeLegacyStore(await this.readLegacyReaderData(entryId, title));
        await this.writeReaderStoreFile(entryId, title, store);
        return store;
    }

    /** 旧三源读取（**只给懒迁移用**，迁移后不再增量写）：旧进度文件 + 旧书签文件 + 笔记「## 高亮」区。各源失败互不牵连。 */
    private async readLegacyReaderData(
        entryId: string,
        title: string,
    ): Promise<{ progress?: unknown; bookmarks?: unknown; highlights?: unknown }> {
        const progDir = normalizePath(readerStoreDir(this.settings.libraryDir));
        const out: { progress?: unknown; bookmarks?: unknown; highlights?: unknown } = {};
        // 旧进度（含更早的 e_xxx.json 名兜底）
        try {
            let text: string | null = null;
            try {
                text = await this.app.vault.adapter.read(normalizePath(readingProgressFilePath(entryId, title, this.settings.libraryDir)));
            } catch {
                try {
                    text = await this.app.vault.adapter.read(normalizePath(`${progDir}/${entryId}.json`));
                } catch {
                    text = null;
                }
            }
            if (text !== null) out.progress = JSON.parse(text);
        } catch { /* 无进度 / 坏 JSON */ }
        // 旧书签（含更早的 e_xxx.bookmarks.json 名兜底）
        try {
            let text: string | null = null;
            try {
                text = await this.app.vault.adapter.read(normalizePath(bookmarksFilePath(entryId, title, this.settings.libraryDir)));
            } catch {
                try {
                    text = await this.app.vault.adapter.read(normalizePath(`${progDir}/${entryId}.bookmarks.json`));
                } catch {
                    text = null;
                }
            }
            if (text !== null) out.bookmarks = parseBookmarks(text);
        } catch { /* 无书签 */ }
        // 旧高亮：笔记「## 高亮」区（解析出来即搬进 JSON；笔记区之后由镜像接管）
        try {
            const e = await this.service.get(entryId);
            if (e?.notePath) {
                const f = this.app.vault.getAbstractFileByPath(e.notePath);
                const md = f instanceof TFile ? await this.app.vault.read(f) : await this.app.vault.adapter.read(e.notePath);
                // 历史块可能没有 `^hl…` 锚点（老数据/手改）→ 补一个：存档里 id 是删除与镜像锚点的唯一钥匙，
                // 缺了它这条高亮在阅读器里既取消不掉也清不掉（旧实现只能提示「去笔记里手动删」）。
                out.highlights = parseHighlightBlocks(md).map((h) => (h.id ? h : { ...h, id: generateBlockId('hl') }));
            }
        } catch { /* 无笔记 */ }
        return out;
    }

    /** 写存档（覆盖写）：目录缺失先建；失败静默（不打断阅读，下次 flush 重试） */
    private async writeReaderStoreFile(entryId: string, title: string, store: ReaderStore): Promise<void> {
        try {
            const dir = normalizePath(readerStoreDir(this.settings.libraryDir));
            if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
                try {
                    await this.app.vault.createFolder(dir);
                } catch { /* 笔记失败不阻断导入 */ }
            }
            const path = normalizePath(readerStoreFilePath(entryId, title, this.settings.libraryDir));
            const text = serializeStore(store);
            const f = this.app.vault.getAbstractFileByPath(path);
            if (f instanceof TFile) await this.app.vault.modify(f, text);
            else await this.app.vault.create(path, text);
        } catch { /* 落盘失败静默（不影响阅读） */ }
    }

    /** 立即落盘：清掉合并窗口，把当前内存态写掉（标注增删 / 翻章 / 关闭阅读器 / 插件卸载） */
    async flushReaderStore(entryId: string): Promise<void> {
        const mem = this.readerStores.get(entryId);
        if (!mem) return;
        if (mem.timer !== null) {
            window.clearTimeout(mem.timer);
            mem.timer = null;
        }
        await this.writeReaderStoreFile(entryId, mem.title, mem.store);
    }

    /** 进度写入（滚动期间高频）：只更内存态 + 起合并窗口。
     *  ⚠️ 已载入时**同步**改内存（不走 await）—— 关闭阅读器时 `flushSave → onSaveProgress → 紧接着 flushReaderStore`，
     *  若这里还要 await，flush 可能先跑完把旧进度写下去（最后一次滚动丢失）。 */
    async saveReaderProgress(entryId: string, title: string, p: { chapterIndex: number; scrollRatio: number }): Promise<void> {
        const hit = this.readerStores.get(entryId);
        if (hit) {
            hit.title = title;
            this.applyReaderProgress(hit, entryId, p);
            return;
        }
        this.applyReaderProgress(await this.ensureReaderStore(entryId, title), entryId, p);
    }

    /** 进度段合并 + 起窗（内存态已是真源，窗口只决定"什么时候落盘"） */
    private applyReaderProgress(mem: ReaderStoreMem, entryId: string, p: unknown): void {
        mem.store = withProgress(mem.store, p);
        if (mem.timer !== null) return; // 窗口内已有待写：不必重新起表
        mem.timer = window.setTimeout(() => {
            mem.timer = null;
            void this.flushReaderStore(entryId);
        }, READER_STORE_FLUSH_MS);
    }

    /** 书签写入（增删/清空是用户明确动作）：立即落盘 */
    async saveReaderBookmarks(entryId: string, title: string, list: ReaderBookmark[]): Promise<void> {
        const mem = await this.ensureReaderStore(entryId, title);
        mem.store = withBookmarks(mem.store, list);
        await this.flushReaderStore(entryId);
    }

    /**
     * 批量移除高亮（阅读器垃圾桶 / 侧栏「清除全部」共用）：先按块 id，再按**引用文本**兜底
     * （去空白归一；老数据/手改的条目可能没有 id）—— 只按 id 删会「提示删了却还在」。
     * 一次 flush；返回实际移除条数（调用方据此提示）。
     * 🔴 #528：**不再同步笔记镜像**（高亮只落 JSON）。
     */
    private async removeReaderHighlights(entryId: string, title: string, ids: string[], quotes: string[]): Promise<number> {
        const mem = await this.ensureReaderStore(entryId, title);
        let list = mem.store.highlights;
        let n = 0;
        for (const id of ids) {
            if (!id) continue;
            const before = list.length;
            list = list.filter((x) => x.id !== id);
            if (list.length < before) n++;
        }
        for (const q of quotes) {
            const hit = findSameExcerpt(list, q);
            if (!hit) continue;
            list = list.filter((x) => x !== hit);
            n++;
        }
        if (n) {
            mem.store = withHighlights(mem.store, list);
            await this.flushReaderStore(entryId);
        }
        return n;
    }

    /** 阅读进度/书签文件名可读化迁移（幂等，启动时执行）：旧 e_xxx.json / e_xxx.bookmarks.json
     *  → {书名}-阅读进度|书签-{id}.json；孤儿文件（对应条目已删）保留原名；失败静默（下次启动重试）。
     *  （2026-09-18 起进度/书签已并入存档 JSON：本步只为把**待迁移**的旧文件改成可读名，便于人工识别） */
    private async migrateProgressFileNames(): Promise<void> {
        try {
            const dir = (this.settings.libraryDir || 'ReelLudic').replace(/\/+$/, '') || 'ReelLudic';
            const progDirObj = this.app.vault.getAbstractFileByPath(normalizePath(`${dir}/阅读进度`));
            if (!(progDirObj instanceof TFolder)) return;
            const entries = await this.service.list();
            const byId = new Map(entries.map((e) => [e.id, e]));
            for (const f of progDirObj.children) {
                if (!(f instanceof TFile)) continue;
                const m = matchLegacyProgressFile(f.name);
                if (!m) continue; // 已是新可读名或无关文件
                const entry = byId.get(m.entryId);
                if (!entry) continue; // 孤儿：条目已删，保留原名
                const newName = m.kind === 'bookmarks'
                    ? bookmarksFileName(m.entryId, entry.title)
                    : progressFileName(m.entryId, entry.title);
                const target = normalizePath(`${dir}/阅读进度/${newName}`);
                if (newName === f.name || this.app.vault.getAbstractFileByPath(target) instanceof TFile) continue;
                await this.app.vault.rename(f, target);
            }
        } catch { /* 迁移失败静默（新写入走新名，下次启动重试） */ }
    }

    /**
     * #528 清理：删掉**存量笔记**里的「## 高亮」镜像区（高亮真源 = 阅读数据 JSON，笔记那份只是历史镜像）。
     *
     * 🔴 **只在「该条目已有阅读数据 JSON」时才删** —— 此时笔记区必然是镜像（或过期镜像），删掉不丢数据；
     *    JSON 不存在 ⇒ 跳过（可能是**尚未懒迁移**的旧手写高亮，等用户打开阅读器把它搬进 JSON 后，
     *    下一次 `writeNote` 重写会自然清掉 —— `ANNOTATION_SECTIONS` 已不含「高亮」）。
     * 幂等：无该区 → `removeHighlightSection` 返回 false（不写盘）；单条失败不中断，整体失败静默（下次启动重试）。
     */
    private async migrateRemoveHighlightMirrors(): Promise<void> {
        try {
            const entries = await this.service.list();
            for (const e of entries) {
                if (!e.notePath) continue;
                const storePath = normalizePath(readerStoreFilePath(e.id, e.title, this.settings.libraryDir));
                if (!(this.app.vault.getAbstractFileByPath(storePath) instanceof TFile)) continue;
                try {
                    await this.service.removeHighlightSection(e.id);
                } catch { /* 单条失败不中断 */ }
            }
        } catch { /* 迁移失败静默（下次启动重试） */ }
    }

    /**
     * AI 对话补全（阅读器**划词翻译**与**划词搜索**共用一条通道，避免两套凭据/两套错误处理漂移）：
     * POST 当前服务商 chat/completions，Bearer Key + messages body；模型固定 GLM-4-Flash / deepseek-v4-flash。
     * 未配对应 Key → Notice 引导；失败/超时 → 细分 Notice 并返回 null（不抛）。`label` 只用于错误文案（翻译 / 搜索）。
     */
    /**
     * 「不启用」守卫（用户 2026-09-18）：该 AI 功能在设置页被选成「不启用」→ 提示并返回 true，
     * 调用方直接 return null（**不发网络请求**）。三处服务下拉各自独立，互不影响。
     */
    private aiOffBlocked(choice: AiProviderChoice, label: string): boolean {
        if (choice !== AI_PROVIDER_OFF) return false;
        new Notice(`${label}已在设置中关闭（设置 → AI集成 · 用途 可改为服务商重新启用）`, 4000);
        return true;
    }

    /**
     * 🔴 #478：解析「某处服务这次该用哪个端点 / Key / 模型」—— **唯一入口**。
     *
     * 为什么要抽出来：加了第三家（`'custom'` 自定义端点）之后，原来散在各处的
     * 「按内置两家二分挑 Key 字段」与「按内置两家二分挑显示名」的写法会**把自定义端点错当成 DeepSeek**
     * （改一处漏一处）。现在这两件事各自只有一个出口：`resolveAiAccess` 与 `pure/translate.providerLabel`。
     *
     * 三处服务（翻译 / 总结 / 搜索）各自把**自己的模型字段**传进来（`pickedModel`）；凭据与端点共用。
     * `issue` 非空 ⇒ **不要发请求**（缺 Key / 缺端点地址 / 缺模型名）。
     */
    private resolveAiAccess(
        provider: TranslateProvider,
        pickedModel?: string,
    ): { url: string; key: string; model: string; label: string; issue?: string } {
        const label = providerLabel(provider);
        const model = resolveModel(provider, pickedModel);
        // 🔴 #634：**两个自定义槽位**共用这一段 —— 判据是 `isCustomSlot` 而不是 `=== 'custom'`，
        //    且 base URL 经 `CUSTOM_SLOT_FIELDS[slot].base` 取（⛔ 写死 `readerCustomBaseUrl`
        //    会让槽位 2 **静默复用槽位 1 的端点**：填了槽位 2 却打到槽位 1 去）。
        if (isCustomSlot(provider)) {
            const slotFields = CUSTOM_SLOT_FIELDS[provider];
            const slotName = customSlotName(provider, this.settingsRaw(slotFields.name));
            const url = translateChatUrl(provider, this.settingsRaw(slotFields.base));
            const key = this.aiKeyText(provider);
            const where = `设置 → AI集成 › 模型服务 · ${slotName}`;
            if (!url) return { url, key, model, label, issue: `未配置${slotName}地址，请先到 ${where} 填写` };
            if (!key) return { url, key, model, label, issue: `未配置${slotName}的 API Key，请先到 ${where} 填写` };
            if (!model) {
                return { url, key, model, label, issue: `${slotName}需要填模型名（设置 → AI集成 · 用途 的「模型」栏）` };
            }
            return { url, key, model, label };
        }
        const key = this.aiKeyText(provider);
        const url = translateChatUrl(provider);
        if (!key) {
            return { url, key, model, label, issue: `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写` };
        }
        return { url, key, model, label };
    }

    /**
     * 🔴 #479：服务商 → **凭据字段名**（唯一真源）。`resolveAiAccess` 与「获取模型」共用它 ——
     * ⛔ 别在第二处再写一遍 `provider === 'zhipu' ? … : …`（加第四家必漏一处，本仓栽过）。
     * 🔴 #480：`siliconflow` 与「朗读云合成」**共用同一把 Key**（同一账号）⇒ 复用 `readerSiliconflowKey`，
     *    不新开字段（否则用户要在同一页填两遍同一个 Key）。
     */
    /** 按 `pure/translate.aiKeyField` 取该服务商的 Key（trim；非字符串 → 空串） */
    private aiKeyText(provider: TranslateProvider): string {
        const v = (this.settings as unknown as Record<string, unknown>)[aiKeyField(provider)];
        return typeof v === 'string' ? v.trim() : '';
    }

    /**
     * 🔴 #634：按字段名读一个 settings 原始值（**不 trim、不判类型**）。
     * 给 `CUSTOM_SLOT_FIELDS` 那套动态字段名用 —— 槽位 1/2 的 base / name 都经它取，
     * ⛔ 别在调用点写死 `this.settings.readerCustomBaseUrl`（漏一处 = 槽位 2 打到槽位 1 的端点）。
     */
    private settingsRaw(field: string): unknown {
        return (this.settings as unknown as Record<string, unknown>)[field];
    }

    /**
     * 拉取服务商的**模型列表**（设置页「AI服务 › 模型 · 获取模型」，#479）。
     * 🔴 端点由 `pure/translate.modelsUrl` 从 chat 端点**派生**，解析走 `parseModelList` ——
     *    ⛔ 别在这里另写一份字面量 / 另写一套解析。
     * 🔴 凭据与 chat **同一份**（`aiKeyField`）—— 不新开凭据通道，也不要求先选好模型。
     * ⚠️ 失败时 `message` 面向用户直接可用（含 `aiHttpIssue` 的 401/402/403/404/429 可读文案）。
     */
    async listAiModels(provider: TranslateProvider): Promise<{ ok: boolean; models: ModelFetched[]; message?: string }> {
        const label = providerLabel(provider);
        // 🔴 #634：槽位感知 —— 自定义槽位取**自己那一个**的 base URL（⛔ 写死槽位 1 会让槽位 2 拉错列表）
        const base = isCustomSlot(provider) ? this.settingsRaw(CUSTOM_SLOT_FIELDS[provider].base) : undefined;
        const url = modelsUrl(provider, base);
        const key = this.aiKeyText(provider);
        if (!url) {
            const slotName = isCustomSlot(provider) ? customSlotName(provider, this.settingsRaw(CUSTOM_SLOT_FIELDS[provider].name)) : label;
            return { ok: false, models: [], message: `未配置${slotName}地址，请先到 设置 → AI集成 › 模型服务 填写` };
        }
        if (!key) return { ok: false, models: [], message: `未配置 ${label} API Key，请先到 设置 → AI集成 · 模型服务 填写` };
        try {
            const res = await withTimeout(
                requestUrl({ url, method: 'GET', headers: { Authorization: `Bearer ${key}` } }),
                15000,
            );
            if (res.status !== 200) {
                return { ok: false, models: [], message: aiHttpIssue(res.status, label) ?? `${label} 返回 HTTP ${res.status}` };
            }
            const models = parseModelList(res.json);
            if (!models.length) return { ok: false, models: [], message: `${label} 没有返回可用模型` };
            return { ok: true, models };
        } catch (e) {
            return { ok: false, models: [], message: '获取模型失败：' + (e instanceof Error ? e.message : String(e)) };
        }
    }

    private async chatCompletion(input: {
        text: string;
        provider: TranslateProvider;
        prompt?: string;
        /** 该服务在设置页选的模型（#478；空/缺省 ⇒ 该家默认模型） */
        model?: string;
        /** 用途名，进错误文案（「翻译失败：…」/「搜索失败：…」） */
        label: string;
        build: (text: string, provider: TranslateProvider, prompt?: string, model?: string) => TranslateRequestBody | null;
    }): Promise<string | null> {
        const { text, provider, prompt, model, label, build } = input;
        const access = this.resolveAiAccess(provider, model);
        if (access.issue) {
            new Notice(access.issue, 5000);
            return null;
        }
        const body = build(text, provider, prompt, access.model); // 提示词可在设置页改；空文本返回 null → 不发请求
        if (!body) return null;
        try {
            // 15s 超时（远程推理需给足时间）
            const res = await withTimeout(
                requestUrl({
                    url: access.url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${access.key}` },
                    body: JSON.stringify(body),
                }),
                15000,
            );
            // #478：401/402/403/404/429 一律给出**可读原因**（原来只特判 401/429 ⇒ 402 余额不足
            //   会被笼统报成「失败（HTTP 402）」，用户看不出是账户没钱）
            const httpIssue = aiHttpIssue(res.status, access.label);
            if (httpIssue) {
                new Notice(`${label}失败：${httpIssue}`, 5000);
                return null;
            }
            if (res.status !== 200) {
                new Notice(`${label}失败（HTTP ${res.status}）`, 4000);
                return null;
            }
            let json: unknown;
            try {
                json = JSON.parse(res.text);
            } catch {
                new Notice(`${label}失败（响应非 JSON）`, 4000);
                return null;
            }
            const reply = parseAiReply(json);
            if (!reply.ok) {
                // 🔴 推理模型只吐了思维链（`reasoning_content`）没给答案 ⇒ 明说，⛔ 别把思维链当结果
                new Notice(
                    reply.reason === 'reasoning-only'
                        ? `${label}失败：该模型只返回了思考过程、没给答案\n请在 设置 → AI集成 · 用途 换一个非推理模型`
                        : `${label}失败（模型未返回内容）`,
                    reply.reason === 'reasoning-only' ? 6000 : 4000,
                );
                return null;
            }
            return reply.text;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`${label}失败：${msg || `无法连接 ${access.label}`}\n请检查网络或 API Key（${access.url}）`, 5000);
            return null;
        }
    }

    /**
     * 划词翻译（AI 大模型，OpenAI 兼容，自动中英互译）：服务商由 settings.readerTranslateProvider 选。
     */
    async translateText(text: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerTranslateProvider);
        if (this.aiOffBlocked(choice, '翻译')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: this.settings.readerTranslatePrompt, // 提示词可在设置页改
            model: this.settings.readerTranslateModel, // #478：设置页选的模型（空 ⇒ 该家默认）
            label: '翻译',
            build: buildTranslateBody,
        });
    }

    /**
     * 划词 AI 搜索（阅读器搜索卡内自动发起）：与翻译同一通道，服务商由 settings.readerSearchProvider 选、
     * 提示词由 settings.readerSearchPrompt 覆盖（缺省用 DEFAULT_SEARCH_PROMPT）。
     */
    async aiSearchText(text: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerSearchProvider);
        if (this.aiOffBlocked(choice, 'AI 搜索')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: this.settings.readerSearchPrompt,
            model: this.settings.readerSearchModel, // #478
            label: '搜索',
            build: buildSearchBody,
        });
    }

    /**
     * 划词 AI 搜索「自定义提问」（用户 2026-09-18）：选段 + 问题一起发，**不读设置页提示词**
     * （那条提示词只服务「解读选段」态）。同一条 chatCompletion 通道 → 凭据与错误处理不漂移。
     */
    async aiAskText(text: string, question: string): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerSearchProvider);
        if (this.aiOffBlocked(choice, 'AI 搜索')) return null;
        return this.chatCompletion({
            text,
            provider: normalizeProvider(choice),
            prompt: undefined, // 显式不传：build 走内置提问提示词
            model: this.settings.readerSearchModel, // #478：与「解读选段」共用搜索服务那一栏的模型
            label: '提问',
            build: (_t, provider, _p, model) => buildSearchQuestionBody(text, question, provider, model),
        });
    }

    // ──────────── AI 摘要（编辑表单「总结摘要」小标题右侧小图标）────────────
    private aiSummaryService: AiSummaryService | null = null;

    /** AI 摘要服务（惰性构造）：复用阅读器翻译的服务商与 Key，不为摘要单开一套凭据 */
    private getAiSummaryService(): AiSummaryService {
        if (!this.aiSummaryService) {
            this.aiSummaryService = new AiSummaryService({
                getConfig: () => {
                    // 总结服务商独立于翻译服务商（设置页「AI 翻译 / 总结 / 搜索」内两项各自可调），但共用同一组 Key
                    // #478：模型 / 端点解析**与 chatCompletion 走同一个入口**（resolveAiAccess）——
                    //   否则「换到自定义端点」时总结这一路会偷偷还在用内置端点（两处真源必漂）。
                    const provider = normalizeProvider(this.settings.readerSummaryProvider);
                    const access = this.resolveAiAccess(provider, this.settings.readerSummaryModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue, prompt: this.settings.readerSummaryPrompt };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
            });
        }
        return this.aiSummaryService;
    }

    /** AI 生成条目摘要（一句话总结 + 核心看点）：失败返回 null（服务内部已 Notice） */
    aiSummarizeEntry(input: AiSummaryInput): Promise<AiSummaryResult | null> {
        const choice = normalizeAiChoice(this.settings.readerSummaryProvider);
        if (this.aiOffBlocked(choice, '总结')) return Promise.resolve(null);
        return this.getAiSummaryService().generate(input);
    }

    // ──────────── #507 LRC 双语歌词（音乐编辑条目「获取歌词」旁那枚小按钮）────────────
    private lrcBilingualService: LrcBilingualService | null = null;

    /**
     * 双语歌词服务（惰性构造）。
     * 🔴 **复用「阅读翻译」的服务商与 Key**（`readerTranslateProvider` / `readerTranslateModel`）——
     *    ⛔ 不为它单开一套凭据（本仓既有纪律：同一件事的 Key 只配一处，与摘要/预填同款）。
     * ⚠️ 提示词走纯模块里那份**内置**的（逐行对齐是格式契约），⛔ 不接设置页可改的「服务提示词」。
     */
    private getLrcBilingualService(): LrcBilingualService {
        if (!this.lrcBilingualService) {
            this.lrcBilingualService = new LrcBilingualService({
                getConfig: () => {
                    const provider = normalizeProvider(this.settings.readerTranslateProvider);
                    const access = this.resolveAiAccess(provider, this.settings.readerTranslateModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
            });
        }
        return this.lrcBilingualService;
    }

    /**
     * AI 生成**双语歌词**（`[00:15.16]hello | 你好`）：失败返回 null（服务内部已 Notice）。
     * ⚠️ 返回的是**合并后的整份 LRC**（时间标签原样保留）+ `applied / missing` 计数；
     *    写回表单/落库由组件那侧负责（与「获取歌词」同一条纪律：只填框，仍要点保存）。
     */
    aiBilingualLyrics(lrc: string, meta?: { title?: string; artist?: string }): Promise<LrcBilingualMerge | null> {
        const choice = normalizeAiChoice(this.settings.readerTranslateProvider);
        if (this.aiOffBlocked(choice, '翻译')) return Promise.resolve(null);
        return this.getLrcBilingualService().generate(lrc, meta);
    }

    // ──────────── 字幕 AI 总结（详情页时间轴面板那颗 ✨）────────────
    private cueSummaryService: CueSummaryService | null = null;

    /**
     * 字幕总结服务（惰性构造）。
     *
     * 🔴 用户 2026-11-11 裁定：「在设置页为字幕总结单独开一组服务商/模型」
     *    ⇒ 新增 `readerCueSummaryProvider` / `readerCueSummaryModel` / `readerCueSummaryPrompt`，
     *      与翻译 / 总结 / 搜索 / 预填**各自独立**；但 Key 与端点仍走 `resolveAiAccess` 那条唯一入口
     *      （⛔ 不新开一套凭据字段：同一家的 Key 只该填一遍）。
     */
    private getCueSummaryService(): CueSummaryService {
        if (!this.cueSummaryService) {
            this.cueSummaryService = new CueSummaryService({
                getConfig: () => {
                    const provider = normalizeProvider(this.settings.readerCueSummaryProvider);
                    const access = this.resolveAiAccess(provider, this.settings.readerCueSummaryModel);
                    return {
                        provider,
                        key: access.key,
                        model: access.model,
                        url: access.url,
                        issue: access.issue,
                        prompt: this.settings.readerCueSummaryPrompt,
                        askPrompt: this.settings.readerCueAskPrompt,
                    };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
                /**
                 * 流式通道（用户 m09565 ①-8）：只有桌面端才有 Node http。
                 *
                 * 🔴 为什么必须按 `Platform.isDesktopApp` 分流：`nodeHttpPostStream` 里
                 *    第一件事就是 `require('https')`，移动端没有 Node ⇒ 调用即抛。
                 *    不注入（`undefined`）时服务层**自动退回非流式**，
                 *    所以移动端只是没有打字机效果，功能不丢。
                 *
                 * ⚠️ 不传 proxy：AI 端点（智谱 / DeepSeek / 自定义）都在墙内，
                 *    与 `dlTransport` 里那条「墙外目标必须带 proxy」是两回事。
                 */
                httpStream: Platform.isDesktopApp
                    ? (opts, handlers) =>
                          nodeHttpPostStream(opts.url, opts.body ?? '', opts.headers, {
                              onText: handlers.onText,
                              shouldStop: handlers.shouldStop,
                              timeoutMs: handlers.timeoutMs,
                              signal: handlers.signal,
                          })
                    : undefined,
            });
        }
        return this.cueSummaryService;
    }

    /**
     * AI 总结整条字幕（一句话概括 + 剧情要点）：失败返回 null（服务内部已 Notice）。
     * ⚠️ 与 `aiSummarizeEntry` 是**两条独立的服务行**，只共用凭据。
     */
    cueSummarize(input: CueSummaryInput): Promise<CueSummaryResult | null> {
        const choice = normalizeAiChoice(this.settings.readerCueSummaryProvider);
        if (this.aiOffBlocked(choice, '字幕总结')) return Promise.resolve(null);
        return this.getCueSummaryService().generate(input);
    }

    /**
     * **流式**生成字幕总结（用户 m09565 ①-8）。
     *
     * 🔴 与非流式 `cueSummarize` 的差别**只在传输**：提示词、解析、返回值全部同构，
     *    所以视图层拿到的 `CueSummaryResult` 与以前一字不差。
     * ⚠️ `onPartial` 传的是**累积全文**（不是增量），界面直接设文本即可。
     * ⚠️ 桌面端才有真流式；移动端服务层会退回非流式，`onPartial` 只被调一次。
     */
    cueSummarizeStream(
        input: CueSummaryInput,
        onPartial: (summary: string, done: boolean) => void,
    ): Promise<CueSummaryResult | null> {
        const choice = normalizeAiChoice(this.settings.readerCueSummaryProvider);
        if (this.aiOffBlocked(choice, '字幕总结')) return Promise.resolve(null);
        return this.getCueSummaryService().generateStream(input, onPartial);
    }

    /**
     * 就当前这一集的字幕提问（面板提问框）。
     *
     * 🔴 用户 2026-11-11（第二轮）：「给字幕面板的AI改现代化点，如透明化去边框，给加个提问框」
     * ⚠️ 与 `cueSummarize` **同一条服务行、同一把 Key、同一个开关**（`readerCueSummaryProvider`）——
     *    用户关掉「字幕总结服务」时，提问也必须一起关：它们花的是同一份预算。
     *    只额外读一个 `readerCueAskPrompt`（提问的提示词规矩与总结不同，见 `DEFAULT_CUE_ASK_PROMPT`）。
     */
    cueAsk(input: CueSummaryInput, question: string, history: CueAskTurn[]): Promise<string | null> {
        const choice = normalizeAiChoice(this.settings.readerCueSummaryProvider);
        if (this.aiOffBlocked(choice, '字幕提问')) return Promise.resolve(null);
        return this.getCueSummaryService().ask(input, question, history);
    }

    // ──────────── AI 预填（新增条目「手动填写」界面标题行 ✨）────────────
    private aiPrefillService: AiPrefillService | null = null;

    /** AI 预填服务（惰性构造）：复用「AI集成」的服务商与 Key，只为预填单开一个提示词（#499） */
    private getAiPrefillService(): AiPrefillService {
        if (!this.aiPrefillService) {
            this.aiPrefillService = new AiPrefillService({
                getConfig: () => {
                    const provider = normalizeProvider(this.settings.readerPrefillProvider);
                    // 模型 / 端点解析与 chatCompletion 走同一个入口（resolveAiAccess）——
                    // 否则「换到自定义端点」时预填这一路会偷偷还在用内置端点（两处真源必漂）
                    const access = this.resolveAiAccess(provider, this.settings.readerPrefillModel);
                    return { provider, key: access.key, model: access.model, url: access.url, issue: access.issue, prompt: this.settings.readerPrefillPrompt };
                },
                notify: (msg, ms) => new Notice(msg, ms ?? 4000),
                http: (opts) => requestUrl(opts), // RequestUrlResponse 结构上即 { status, text }
                withTimeout,
                // 🔴 #499D agent 工具回路（宿主注入 ⇒ 不接线 / 移动端时整条回路自动关闭）
                runTool: (name, args) => this.runPrefillTool(name, args),
                onStep: (label) => this.prefillStepCb?.(label),
            });
        }
        return this.aiPrefillService;
    }

    /** #499D：本次预填的「工具进度」回调（服务是单例 ⇒ 每次调用前挂上、结束即清；按钮忙时不会再发第二次） */
    private prefillStepCb: ((label: string) => void) | null = null;

    /**
     * AI 预填条目字段（新增条目 · 手动填写界面的 ✨）：失败返回 null（服务内部已 Notice）。
     * ⚠️ 与 `aiSummarizeEntry` 是**两条独立的服务行**（各自的 provider / model / prompt），
     *    只共用凭据（`resolveAiAccess` 的 Key 与端点）。
     * 🔴 #499D：带 `onStep` ⇒ 工具回路里每次调用都给界面回一行进度（如「搜索网络：…」）。
     */
    aiPrefillEntry(input: AiPrefillInput, onStep?: (label: string) => void): Promise<AiPrefillOutcome | null> {
        const choice = normalizeAiChoice(this.settings.readerPrefillProvider);
        if (this.aiOffBlocked(choice, '预填')) return Promise.resolve(null);
        this.prefillStepCb = onStep ?? null;
        return this.getAiPrefillService()
            .generate(input)
            .finally(() => {
                this.prefillStepCb = null;
            });
    }

    /**
     * 🔴 #499D：AI 预填的**工具执行器**（agent 回路的「本地那一半」）。
     *
     * · `lookup_metadata` ⇒ 复用**插件自己的**类型搜索链（各源客户端早就在跑，⛔ 不另写一份 HTTP）
     * · `web_search` ⇒ **必应 RSS**（`pure/bingSearch`；实测 200 + 10 条结构化结果、免费无需 Key）
     *
     * ⚠️ 返回的是**给模型看的短文本**（不是给界面用的对象）：工具输出越短越准，
     *    这里每条只留「标题 / 年份 / 来源 / 评分 / 类型」这一档信息。
     * ⚠️ 工具**失败不抛** —— 交回一句人话让模型自己决定「换个词再搜」还是「凭记忆答」
     *    （抛出去会把整条回路打断，用户拿到的是「失败」而不是「一个差一点的答案」）。
     */
    private async runPrefillTool(name: string, args: Record<string, unknown>): Promise<string> {
        const str = (k: string): string => (typeof args[k] === 'string' ? (args[k] as string).trim() : '');

        if (name === PREFILL_TOOL_WEB_SEARCH) {
            const query = str('query');
            const url = buildBingRssUrl(query);
            if (!url) return '（没给搜索词）';
            const res = await requestUrl({
                url,
                headers: { 'User-Agent': BING_SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
            });
            if (res.status !== 200) return `（搜索失败：HTTP ${res.status}）`;
            const items = parseBingRss(res.text);
            if (!items.length) return '（没有搜到结果，换个关键词再试）';
            return `搜索「${query}」的前 ${items.length} 条结果：\n${bingResultsToText(items)}`;
        }

        if (name === PREFILL_TOOL_METADATA) {
            const title = str('title');
            if (!title) return '（没给标题）';
            const kind = this.normalizePrefillKind(str('type'));
            const hits = await this.searchForPrefill(title, kind);
            if (!hits.length) return `（本地元数据源没有查到「${title}」）${title}」）`;
            const lines = hits.slice(0, 3).map((r, i) => {
                const d = describeSearchResult(r as never);
                const bits = [d.year, d.source, d.rating != null ? `★${d.rating}` : '', d.sub].filter(Boolean);
                return `${i + 1}. ${d.title}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
            });
            const head = `命中 ${hits.length} 条：\n${lines.join('\n')}`;
            // 🔴 #499E：把**最佳命中的简介原文**一并交出去（用户 2026-10-03：「简介要搜索照搬真正作品的简介」）。
            //    服务层会照搬它去覆盖模型自己写的那一版 ⇒ 这段**必须带标记、且放在文本末尾**
            //    （标记与提取器是 `pure/aiPrefill` 的同一对常量，⛔ 别在这儿手写一遍字符串）。
            // ⚠️ 取 `hits[0]`（各源的排序已是相关性序）；查不到原文就**不加这一行**，让模型凭记忆兜底。
            const synopsis = synopsisOf(hits[0]);
            return synopsis ? `${head}\n\n${PREFILL_SYNOPSIS_PREFIX}${synopsis}` : head;
        }

        return `（未知工具：${name}）`;
    }

    /**
     * 工具参数里的类型归一：模型**可能给中文**（实测 DeepSeek 传过 `"type":"电影"`）⇒ 认几个常见写法，
     * 认不出的一律按电影走（宁可搜错一类，也别把整次工具调用判死）。
     */
    private normalizePrefillKind(raw: string): 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music' {
        const s = raw.toLowerCase();
        if (/^(tv|series|剧|电视剧|连续剧)/.test(s)) return 'tv';
        if (/^(anime|番|动画)/.test(s)) return 'anime';
        if (/^(book|novel|comic|书|文学|网文|漫画)/.test(s)) return 'book';
        if (/^(game|游|游戏)/.test(s)) return 'game';
        if (/^(music|音|音乐|歌)/.test(s)) return 'music';
        return 'movie';
    }

    /** 按类型挑**已有的**那条搜索链（⛔ 不新开 HTTP 通道，全走现成门面） */
    private async searchForPrefill(
        title: string,
        kind: 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music',
    ): Promise<unknown[]> {
        try {
            if (kind === 'movie' || kind === 'tv') return await this.searchWithFallback(title, kind);
            if (kind === 'anime') return await this.searchAnime(title);
            if (kind === 'book') return await this.searchBook(title);
            if (kind === 'game') return await this.searchGame(title);
            return await this.searchMusic(title);
        } catch {
            return []; // 工具层失败 ⇒ 空结果（上面会把它写成一句「没查到」，模型自己决定下一步）
        }
    }

    /** 测试 AI 翻译连接（设置页按钮）：按服务商向端点发最小 ping；401=Key 无效、200=有效、429=限流等细分 */
    async testTranslateConnection(provider: TranslateProvider, pickedModel?: string): Promise<SourceTestResult> {
        const label = providerLabel(provider);
        return this.runTest(`${label} AI`, async () => {
            // 🔴🔴 #486：**测哪家就用哪家的模型**。
            //    原实现里自定义端点传的是「翻译服务」的模型（实测：翻译服务选了 `GLM-4-Flash`，
            //    拿它去打 91hub ⇒ 503 `No available channel for model GLM-4-Flash`）
            //    —— 而那条端点 `/models` 能返回 361 个，用户自然困惑「能列模型却测不过」。
            //    ⇒ 自定义端点没有「默认模型」（`DEFAULT_MODELS.custom` 是空串），
            //      所以这里**先问这条端点自己有什么**，再用 `pickPingModel` 挑一个像文本对话的。
            // ⚠️ 内置三家**不改**：实测智谱列表里的 `glm-4.5` / `glm-5` 是 429（余额不足），
            //    反而是默认那档 `GLM-4-Flash` 能用 ⇒ 用真实列表第一个会让「本来能过」的测试变红。
            let model = pickedModel;
            // 🔴 #634：退回第一个时的那句说明（用户问「怎么是连第一个模型的」）——
            //    端点里**没有任何文本对话模型**才会非空；选了具体模型 / 内置三家时恒为空串。
            let modelHint = '';
            if (isCustomSlot(provider) && !model?.trim()) {
                const list = await this.listAiModels(provider);
                if (!list.ok) return { ok: false, message: `连接失败：${list.message ?? '拿不到模型列表'}` };
                const ids = list.models.map((m) => m.value);
                model = pickPingModel(ids);
                if (!model) return { ok: false, message: '连接失败：这条端点没有返回任何模型' };
                modelHint = noChatModelHint(ids);
            }
            // #478：三态统一走 resolveAiAccess（含 `'custom'` 自定义端点）；错误文案走 aiHttpIssue
            //   ⇒ 402 会明说「账户余额不足」而不是笼统的「HTTP 402」
            const access = this.resolveAiAccess(provider, model);
            if (access.issue) return { ok: false, message: access.issue };
            const body = buildTranslatePingBody(provider, access.model);
            try {
                const res = await requestUrl({
                    url: access.url,
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${access.key}` },
                    body: JSON.stringify(body),
                });
                if (res.status === 200) {
                    return { ok: true, message: `连接成功：${access.label} 可用（模型 ${access.model}）${modelHint}` };
                }
                // ⚠️ 失败也要带上模型名 —— 否则用户不知道「测的到底是谁」（#486 那次困惑的一半就来自这个）
                // 🔴 #634：`modelHint` 补上「为什么是它」（退回第一个的那些端点，否则用户误以为是我们瞎选）
                return {
                    ok: false,
                    message: `连接失败：${aiHttpIssue(res.status, access.label) ?? `HTTP ${res.status}`}（模型 ${access.model}）${modelHint}`,
                };
            } catch (e) {
                return {
                    ok: false,
                    message:
                        '连接失败：' +
                        (e instanceof Error ? e.message : String(e)) +
                        `（模型 ${access.model}）${modelHint}`,
                };
            }
        });
    }


    /**
     * 测试云合成连接（设置页「AI集成 › 模型服务 · 硅基流动 › 测试连接」，#344 方案 C）。
     * 🔴 真打一次 `/audio/speech`（最短文本）而**不是**只查 Key ——
     *    「Key 有效」不等于「能出声」，只有拿到**音频二进制**才算通。代价 = 一句两个字的合成额度。
     * ⚠️ 返回体是二进制 ⇒ 必须 `responseType: 'arraybuffer'`（同磁盘图床下载那条先例），
     *    不能走 chat 那套 JSON 解析。
     */
    async testSpeechConnection(): Promise<SourceTestResult> {
        const key = (this.settings.readerSiliconflowKey ?? '').trim();
        return this.runTest('云端语音合成', async () => {
            if (!key) return { ok: false, message: '未配置 API Key' };
            const body = buildSpeechBody({ text: '测试', voice: CLOUD_VOICE_DEFAULT, rate: 1 });
            if (!body) return { ok: false, message: '请求体构造失败' };
            try {
                const res = await requestUrl({
                    url: speechEndpointUrl(),
                    method: 'POST',
                    contentType: 'application/json',
                    headers: { Authorization: `Bearer ${key}` },
                    body: JSON.stringify(body),
                    responseType: 'arraybuffer',
                } as unknown as Parameters<typeof requestUrl>[0]);
                const verdict = classifySpeechError(res.status, res.text);
                if (verdict.kind !== 'ok') return { ok: false, message: `合成失败：${verdict.message}` };
                const bytes = res.arrayBuffer?.byteLength ?? 0;
                if (!bytes) return { ok: false, message: '合成失败：返回了空音频' };
                return { ok: true, message: `合成成功：已取到 ${bytes} 字节音频` };
            } catch (e) {
                return { ok: false, message: '合成失败：' + (e instanceof Error ? e.message : String(e)) };
            }
        });
    }

    /** 阅读整体百分比写回 catalog（书架进度条数据源）：保留手填 page/totalPage，仅更新 percent；失败静默 */
    private async persistReadingPercent(entryId: string, percent: number): Promise<void> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return;
            const rp = e.readingProgress ?? {};
            const pct = Math.max(0, Math.min(100, Math.round(percent)));
            // percent 唯一真源：有 totalPage 基准 → pageFromPercent 派生当前页/章一起落库（page 缺失时补全，表单/海报墙直接可用）
            const page = rp.totalPage ? pageFromPercent(pct, rp.totalPage) : rp.page;
            await this.service.update(entryId, {
                readingProgress: { page, totalPage: rp.totalPage, percent: pct },
            });
        } catch { /* 落库失败静默（不影响阅读） */ }
    }

    /** EPUB 解包解析：jszip 解包（懒加载）→ 纯逻辑解析结构（container/opf/spine/toc）；文件缺失返回 null，解析失败抛错 */
    /** 解包 EPUB（jszip 懒加载 → 文本 fileMap + 结构解析 + 二进制按需取）；供 ReaderView 视图内 / 漫画抽取调用 */
    async unpackEpub(path: string): Promise<{ fileMap: Record<string, string>; book: { title: string; chapters: string[]; toc: { label: string; href: string }[]; manifest: Record<string, string> }; loadBinary: (abs: string) => Promise<Uint8Array | null> } | null> {
        // jszip 动态 import（esbuild 打包进 main.js，避免启动期加载；CJS 互操作取 .default）
        const JSZip = (await import('jszip')).default;
        // 双路径读取二进制：vault 相对 → adapter.readBinary；库外绝对路径 → fs.readFile
        let buf: ArrayBuffer;
        const vf = this.app.vault.getAbstractFileByPath(path);
        if (vf instanceof TFile) {
            buf = await this.app.vault.adapter.readBinary(path);
        } else if (Platform.isDesktopApp) {
            const fs = require('fs/promises') as typeof import('fs/promises');
            const b = await fs.readFile(path);
            buf = this.toArrayBuffer(b);
        } else {
            return null;
        }
        const zip = await JSZip.loadAsync(buf);
        const fileMap: Record<string, string> = {};
        // zip.filter 回调第一参为 relativePath（字符串）；目录以结尾 '/' 判定；仅文本类文件入 fileMap（二进制资源如图片不在本期渲染范围）
        for (const f of zip.filter((p: string) => !p.endsWith('/') && /\.(xhtml?|html|htm|ncx|opf|xml|css)$/i.test(p))) {
            fileMap[f.name] = await f.async('string');
        }
        // 🔴 #540 漫画页图**按需取**（二进制不进 fileMap —— 那是文本表）：
        //   闭包持有 jszip 文档（与 CBZ 漫画同款代价），逐页 `async('uint8array')`，⛔ 不整包预解压。
        //   索引按小写建：包内路径与 XHTML 里 href 的**大小写常不一致**（Calibre 重打包的典型毛病）。
        const zipKeys = new Map<string, string>();
        for (const n of Object.keys(zip.files)) {
            if (!zip.files[n].dir) zipKeys.set(n.toLowerCase(), n);
        }
        // 🔴🔴 #642 解压缓存：`JSZip.file().async()` **不缓存结果** —— 同一张图取两次就**重新解压两次**。
        //   而阅读器侧会**并发**取图（当前页 + 预取下一页 + 连续模式窗口 7 页 + 缩略图窗口 13 页），
        //   且**每次滚动都重来**。实测（`_probe_642_zip.cjs`）：单张 8ms、串行 20 张 **310ms**
        //   ⇒ 一次滚动就能把 Electron 主线程占住三分之一秒，连续滚动叠加起来 = 用户报的「完全动不了」。
        //   ⇒ 这里做**去重 + 有界缓存**：同一路径只解一次（并发也共享同一个 Promise），
        //     并把已解压结果按 **LRU 上限**留住（翻回去不再解压）。
        //   ⚠️ 上限按**字节数**算而不是条数：扫描页单张可达数 MB，按条数限会失控。
        const ZIP_BINARY_CACHE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB 上限（约 20~40 张扫描页）
        const binaryCache = new Map<string, Uint8Array>();
        const binaryInflight = new Map<string, Promise<Uint8Array | null>>();
        let binaryCacheBytes = 0;
        /** 记为最近使用（Map 的插入序即 LRU 序：删了重插到末尾） */
        const touchBinary = (path: string, bytes: Uint8Array): void => {
            if (binaryCache.has(path)) binaryCache.delete(path);
            binaryCache.set(path, bytes);
            binaryCacheBytes += bytes.byteLength;
            while (binaryCacheBytes > ZIP_BINARY_CACHE_MAX_BYTES && binaryCache.size > 1) {
                const oldest = binaryCache.keys().next().value as string | undefined;
                if (oldest === undefined) break;
                const evicted = binaryCache.get(oldest);
                binaryCache.delete(oldest);
                binaryCacheBytes -= evicted?.byteLength ?? 0;
            }
        };
        const loadBinary = async (abs: string): Promise<Uint8Array | null> => {
            const key = zipKeys.get(String(abs ?? '').toLowerCase());
            if (!key) return null;
            const hit = binaryCache.get(key);
            if (hit) {
                touchBinary(key, hit); // 命中即刷新 LRU 位置
                return hit;
            }
            const pending = binaryInflight.get(key);
            if (pending) return pending; // 并发去重：同一张图只会解压一次
            const task = (async (): Promise<Uint8Array | null> => {
                try {
                    const f = zip.file(key);
                    if (!f) return null;
                    const bytes = await f.async('uint8array');
                    touchBinary(key, bytes);
                    return bytes;
                } catch {
                    return null; // 坏条目 ⇒ 当作取不到（阅读器侧会显示「这一页加载失败」）
                } finally {
                    binaryInflight.delete(key);
                }
            })();
            binaryInflight.set(key, task);
            return task;
        };        // container.xml → rootfile → content.opf
        const container = fileMap['META-INF/container.xml'];
        if (!container) throw new Error('EPUB 缺少 META-INF/container.xml');
        const opfPath = containerRootfile(container);
        if (!opfPath) throw new Error('EPUB container.xml 缺少 rootfile');
        const opfXml = fileMap[opfPath];
        if (opfXml === undefined) throw new Error(`EPUB 缺少 content.opf：${opfPath}`);
        const opfDir = opfPath.split('/').slice(0, -1).join('/');
        const parsed = parseOpf(opfXml, opfDir, fileMap);
        if (parsed.chapters.length === 0) throw new Error('EPUB 没有可渲染的章节（spine 为空或全部缺失）');
        // 目录：优先 nav.xhtml（EPUB3）→ toc.ncx（EPUB2）→ 扫 manifest 的 NCX 类型条目（应对变名如 fb.ncx）；
        // 都没有 → 从各章节 XHTML 抽 <h1>/<title> 命名（排除等于书名的 title 防扉页污染目录），抽不出仍回退文件名
        let toc: { label: string; href: string }[] | null = null;
        for (const name of ['nav.xhtml', 'toc.ncx']) {
            const key = Object.keys(fileMap).find((p) => p.toLowerCase().endsWith('/' + name)) ?? name;
            const navXml = fileMap[key];
            if (navXml === undefined) continue;
            const navToc = parseTocNav(navXml, key.split('/').slice(0, -1).join('/'), fileMap);
            if (navToc.length > 0) { toc = navToc; break; }
        }
        if (toc === null) {
            // 兜底扫 manifest 里任何 NCX 类型条目
            for (const [abs, media] of Object.entries(parsed.manifest)) {
                if (!/x-dtbncx/i.test(media)) continue;
                const navXml = fileMap[abs];
                if (!navXml) continue;
                const navToc = parseTocNav(navXml, abs.split('/').slice(0, -1).join('/'), fileMap);
                if (navToc.length > 0) { toc = navToc; break; }
            }
        }
        // 目录**错位**（Calibre「先写 NCX、后重切文件」的遗留：多个条目指向完全相同的位置）→
        // 该目录在数据上区分不开这些章，会同时点亮多章（用户 2026-09-19 报「目录连章」），
        // 且顶栏章名与正文对不上 → 改按 spine **内容文件** 1:1 重建目录。
        // 判据只认「重复目标」，一个文件含多章但锚点唯一（合法结构）不受影响，见 pure/epubParse 注释。
        if (toc !== null && isTocAmbiguous(toc)) {
            const rebuilt = rebuildTocFromSpine(parsed.chapters, fileMap, toc);
            if (rebuilt.length > 0) toc = rebuilt;
        }
        if (toc === null) {
            // 最终兜底：抽章节 XHTML 的 <h1>/<title>
            toc = parsed.chapters.map((href) => {
                const html = fileMap[href] ?? '';
                const label = extractChapterLabel(html, parsed.title) ?? href.split('/').pop() ?? href;
                return { label, href };
            });
        }
        return { fileMap, book: { ...parsed, toc }, loadBinary };
    }

    /** 读取条目笔记「## 摘抄」区 → 逐块解析（供阅读器摘抄书签目录；失败/无笔记返回空数组） */
    private async loadEntryExcerpts(entryId: string): Promise<ParsedExcerpt[]> {
        try {
            const e = await this.service.get(entryId);
            if (!e?.notePath) return [];
            const f = this.app.vault.getAbstractFileByPath(e.notePath);
            const md = f instanceof TFile ? await this.app.vault.read(f) : await this.app.vault.adapter.read(e.notePath);
            // 统一用 pure 的 ^id 锚点切块（区标题缺省「摘抄」）
            return parseExcerptBlocks(md);
        } catch {
            return [];
        }
    }

    /** 打开书籍：实验性开关分流（默认外部系统程序打开；开启/非桌面端走内置阅读器） */
    /** 打开书籍阅读器：外部打开（系统默认程序）立即返回 undefined；内置阅读器关闭后返回最新阅读进度（percent 真源，供表单自动同步） */
    async openBookReader(entry: MediaEntry): Promise<BookProgressFields | undefined> {
        if (!entry.bookFile) {
            // 🔴 #536（用户报障：「书籍填了网络链接，海报墙点阅读却提示未关联书籍文件」）：
            //    海报墙卡片 / 右键菜单 / 系列季列表走的是**本方法**（`runEntryAction` → `openBookReader`），
            //    它原先**只认 `bookFile`** ⇒ 只填了 `readUrl` 的条目点「阅读」就撞这句提示。
            //    ⚠️ 与编辑表单的 `watchBook`（本地优先、无本地才开 `readUrl`）**必须是同一套口径** ——
            //    否则会出现「表单里点得开、海报墙上点不开」。无本地文件时回落到在线阅读链接。
            if (entry.readUrl?.trim()) {
                this.openExternalUrl(entry.readUrl.trim());
                return undefined;
            }
            new Notice('未关联书籍文件 / 网络地址 — 编辑属性关联本地文件（TXT/EPUB/PDF/漫画）或填在线阅读链接', 5000);
            return undefined;
        }
        const path = normalizePath(entry.bookFile);
        const ext = path.split('.').pop()?.toLowerCase();
        // 🔴 #537 漫画放行两条路：压缩包（cbz/zip/cbt/tar，判据 `pure/comicFiles.isComicArchivePath`）
        //    与**文件夹**（散装图片序列 —— 目录没有扩展名，只能靠 `isDirectoryPath` 实测）。
        const comicSource = isComicArchivePath(path) || this.isDirectoryPath(path);
        if (ext !== 'txt' && ext !== 'epub' && ext !== 'pdf' && !comicSource) {
            // Kindle（mobi/azw3）在书籍扩展名白名单里**选得进来**，但本批阅读器不支持 ⇒ 单独说一句，
            // ⛔ 别混进下面那条通用提示（用户会以为是自己格式选错了）。
            if (ext === 'mobi' || ext === 'azw3' || ext === 'fb2') {
                new Notice('Kindle 格式（mobi/azw3）暂不支持 — 可转成 EPUB 或 PDF 再关联', 4000);
            } else {
                new Notice('暂不支持该格式（支持 TXT/EPUB/PDF/CBZ/CBT 与漫画文件夹）', 3000);
            }
            return undefined;
        }
        // 实验性功能「内置阅读器打开书籍文件」：默认 false = 外部打开（系统默认程序）；开启或非桌面端（无法外部）才走内置
        if (!this.settings.internalBookReader && Platform.isDesktopApp) {
            await this.openBookExternally(path);
            return undefined;
        }
        return await this.openBookInternal(entry, path);
    }

    /**
     * 笔记内链接点击拦截（M1 双向溯源 + 「回到原文」深链，document 捕获阶段）。三种形态：
     *  ① **`[↩](obsidian://reelludic?…)` 深链**（用户 2026-09-19）：markdown 外部链接形态、没有 `data-href`。
     *     与书在库内还是库外**无关**（参数是 entryId）→ 治「库外书头行写不出 wikilink、点不回去」的断点。
     *  ② **`[[源文件#^bk…|标签]]` 块锚点**：Obsidian 拿到只会去打开源文件本身（txt 当纯文本铺开、epub 无从渲染）、
     *     **无法定位** → 解析块 id 反查条目，开（或复用）阅读器并注入 pendingTargetId。
     *  ③ **视频时间戳链接**（`[7:10](…)`，库内 `影片.mp4#t=430` / 库外条目深链）。
     * 🔴 形态 ①③ 在**编辑视图里不是 `<a>`**（是 CM6 span，见 ③ 处注释）→ 目标得回所在行的 markdown 源码里取。
     * 三种之外的链接**一律不拦**（交回 Obsidian 默认行为，绝不吞掉用户正常的链接点击）。
     */
    /**
     * ④ 数字输入框「滚轮增减」（#556，用户 2026-10-08）。
     * 只做 DOM 接线：判据与算法在 `pure/numberWheel`（纯逻辑 + 单测）。
     * 🔴 顺序不可换：**先**判目标是不是 `input[type=number]`、**再**判是否聚焦 —— 两步都过才接管。
     * 🔴 未聚焦一律原样放行（不 preventDefault / 不 stopPropagation）：指针滑过输入框时页面必须照常滚动。
     */
    private onNumberWheel = (ev: WheelEvent): void => {
        const el = ev.target;
        if (!isNumberInputTarget(el)) return;
        if (document.activeElement !== el) return;
        const { min, max, step } = parseNumberBounds(el);
        const next = wheelStepValue(el.value, ev.deltaY < 0 ? 1 : -1, step, min, max);
        // 接管即拦：即便这一下算不出新值（已在边界 / 当前不是数），也不让页面跟着滚 ——
        // 否则同一只输入框上「能改值时页面不动、到边界时页面突然开始滚」会显得像 bug。
        ev.preventDefault();
        ev.stopPropagation();
        if (next === undefined) return;
        el.value = String(next);
        // 派发原生事件让 `bind:value` / `on:input` 照常收到（Svelte 4 的 bind:value 监听 input）。
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    private onWorkspaceAnchorClick = (ev: MouseEvent): void => {
        const target = ev.target as HTMLElement | null;
        const a = target?.closest?.('a') as HTMLAnchorElement | null;
        // ① 阅读器深链（它同时带 href 与 data-href 的场合也不会有歧义）
        const href = a?.getAttribute('href') ?? '';
        const dataHref = a?.getAttribute('data-href') ?? '';
        const deep = parseReaderDeepLink(href) ?? parseReaderDeepLink(dataHref);
        // ② 视频**时间戳链接**（#326）—— 两种形态都认：
        //    · 库外/兜底：`obsidian://reelludic?action=video&…`（在 href 上）
        //    · 库内：`影片.mp4#t=3`（Obsidian 把库内链接目标放在 **data-href**，href 可能是 app:// 形态 → 先看 data-href）
        let vTime = deep ? null : (parseTimeLink(dataHref) ?? parseTimeLink(href));
        // ③ 🔴 编辑视图（Live Preview / 源码模式）里的链接**不是 `<a>`**（2026-09-19 用户第三次报障的根因之二）：
        //    读 Obsidian 核心 `onEditorClick`（app.js @2548591）得到判据 —— 它认可点 token 只认
        //    `.external-link` / `.cm-url` / `.cm-link` / `.cm-underline` 这些 **CM6 span**。所以
        //    `closest('a')` 在编辑视图里**恒为 null**，而旧实现第一行是 `if (!a) return` ⇒
        //    **编辑视图永远拦不到**（阅读视图是 `<a>` → 只有那里能跳 = 用户报的「只能阅读视图跳」）。
        //    CM6 的链接目标**不在 DOM 属性上**（渲染出来的只有显示文字）→ 回「点击处所在行」的 markdown 源码，
        //    按「点击处文字 === 链接文字 / 链接目标」把目标取回来（`matchLineLink`；行内别的字、整行都不命中，
        //    所以**不会误吞普通点击**）。⛔ 别把这条判据换成「行里有链接就拦」——那样用户连点这行放光标都会被抢。
        if (!deep && !vTime && !a && target?.closest?.('.cm-editor')) {
            const dest = matchLineLink(target.closest('.cm-line')?.textContent ?? '', target.textContent ?? '');
            if (dest) vTime = parseTimeLink(dest);
        }
        // 🔴 **归属判断必须排在 `defaultPrevented` 之前**（2026-09-19 用户实测报障）：
        //    Live Preview 里 CodeMirror / Obsidian 会在**更早的阶段**处理 `mousedown` 并 `preventDefault()`
        //    （为接管光标定位与链接闪现），于是随后的 `click` 带着 `defaultPrevented=true` 进来 ——
        //    旧实现第一行就 `if (ev.defaultPrevented) return` 直接放行 → **编辑视图里本插件深链永远跳不了**，
        //    而阅读视图没人 preventDefault 所以正常 —— 症状正是「只能阅读视图跳」。
        //    判据：**是本插件要抢的链接就无条件拦下**；只有「不是我们的」才去尊重别人的 preventDefault。
        if (deep || vTime) {
            ev.preventDefault();
            ev.stopPropagation();
            if (deep) void this.openDeepLinkTarget(deep);
            else if (vTime) void this.openVideoAt(vTime);
            return;
        }
        // 不是本插件的链接 → 绝不吞掉用户的普通点击
        if (ev.defaultPrevented) return;
        // ③ 块锚点 wikilink
        const parsed = parseLinktext(dataHref);
        const subpath = parsed.subpath ?? '';
        const id = subpath.startsWith('#^') ? subpath.slice(2) : '';
        if (!parsed.path || !/^[\w-]+$/.test(id)) return;
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        // 链接缓存优先；未索引到（罕见）再按 vault 路径兜一次
        const file =
            this.app.metadataCache.getFirstLinkpathDest(parsed.path, sourcePath) ??
            this.app.vault.getAbstractFileByPath(normalizePath(parsed.path));
        if (!(file instanceof TFile)) return;
        const ext = file.path.split('.').pop()?.toLowerCase();
        if (ext !== 'txt' && ext !== 'epub' && ext !== 'pdf') return;
        // 认定由本插件接管 → 必须同步拦下：否则 Obsidian 会把源文件同时铺到另一个标签页
        ev.preventDefault();
        ev.stopPropagation();
        void this.openBookAtAnchor(file, id, dataHref, sourcePath);
    };

    /** 「回到原文」深链落地：按 entryId 反查条目 → 开（或复用）阅读器并注入 pendingTargetId。
     *  未命中条目（已删）→ 明确提示，**不**去猜文件路径（深链刻意不带路径）。 */
    private async openDeepLinkTarget(target: { book: string; block: string }): Promise<void> {
        try {
            const entry = await this.service.get(target.book);
            if (!entry?.bookFile) {
                new Notice('找不到这本书的条目（可能已删除）', 4000);
                return;
            }
            // 深链只在内置阅读器里才有意义（外部程序无法定位块锚点）→ 不看 internalBookReader 开关
            await this.openBookInternal(entry, normalizePath(entry.bookFile), target.block);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 时间戳链接里的库内文件路径 → 「条目 + 集下标」（库内链接只有路径，没有条目 id） */
    private async videoPathTarget(filePath: string): Promise<{ entry: MediaEntry; index: number } | null> {
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        const file =
            this.app.metadataCache.getFirstLinkpathDest(filePath, sourcePath) ??
            this.app.vault.getAbstractFileByPath(normalizePath(filePath));
        if (!(file instanceof TFile)) return null;
        for (const entry of await this.service.list()) {
            const idx = (entry.episodeFiles ?? []).indexOf(file.path);
            if (idx >= 0) return { entry, index: idx };
        }
        return null;
    }

    /**
     * 视频**时间戳链接**落地（#326）：定位到「条目 + 集」→ 已开着同条目的播放器就**直接跳转播放**，
     * 否则开/复用播放器并注入 pendingSeek（与阅读器的 `pendingTargetId` 同款手法）。
     * ⚠️ 不看 `internalMediaPlayback` 开关：深链只在内置播放器里才有意义（外部程序定位不到某秒）。
     */
    /** 时间戳链接（#326 双轨）：库内优先用文件链接文本（生态标准 `影片.mp4#t=3`，别的工具也认），
     *  库外 / 取不到文件时用条目深链。两种都取不到 → null（不产出不可用链接）。
     *
     *  🔴 用户 2026-11-01：「如何处理一个笔记52集的各集时间戳冲突问题」
     *     ⇒ **多集条目**的链接文字带上集号（`第3集·0:27`），否则 52 集共用一个 `## 单时间戳` 区时
     *       每行都只有时间，人眼分不出属于第几集。单集 / 电影不带（平添噪音）。
     *     集数口径取「已关联的本地文件 + 网络集 + 声明总集数」三者最大值 —— 与 `pure/episodePage`
     *     的 `episodeTotal` 同款（历史数据里 `totalEpisodes` 常常没跟着数组改，取 max 才不漏）。 */
    private videoTimeLink(entry: MediaEntry, ep: number, seconds: number): string | null {
        const raw = entry.episodeFiles?.[ep];
        let filePath: string | undefined;
        if (raw) {
            const f = this.app.vault.getAbstractFileByPath(normalizePath(raw));
            if (f instanceof TFile) filePath = this.app.metadataCache.fileToLinktext(f, entry.notePath ?? '');
        }
        const total = Math.max(
            entry.type === 'movie' ? 1 : 0,
            entry.episodeFiles?.length ?? 0,
            entry.episodeUrls?.length ?? 0,
            entry.episodeTitles?.length ?? 0,
            entry.progress?.totalEpisodes ?? 0,
        );
        // `label` 里不许有空白（Obsidian 会在第一个空白处截断链接 token）—`stampLabel` 已保。
        const label = stampLabel(seconds, { ep, multi: total > 1 });
        return buildTimeLink({ seconds, label, filePath, entryId: entry.id, ep });
    }

    /**
     * #326 插入时间戳。用户 2026-09-19 定稿口径：**写进条目笔记**，并在插入前把该笔记**开在分屏**上
     * （不抢焦点 → 播放器留在左侧继续播）→ 结果立刻看得见、点一下就能跳回去。
     * 🔴 该口径**取代**首版的「优先最近 Markdown 编辑器光标处」（D-2 Ⓒ）：那条路有个隐性坑 ——
     * Live Preview 会把**光标所在行**渲染成源码，刚插完链接就在光标旁 → 看着是链接却**点不动**（用户实测报障）。
     *
     * 🔴🔴 #587（用户 2026-10-09 裁定）：**单击动作不再弹二次确认备注框** —— 顶栏按钮 / 快捷键 / 命令面板
     * 三条入口都只写一行纯时间戳链接；备注（`[17:46](链接) 备注`）**只在用户手动编辑笔记时**出现。
     * 写入区名 = `MARK_SECTION_STAMP`（`## 单时间戳`，见 `pure/videoMarks`）。
     */
    async insertVideoStamp(
        entry: MediaEntry,
        info: { seconds: number; ep: number; caption?: string },
    ): Promise<void> {
        try {
            const link = this.videoTimeLink(entry, info.ep, info.seconds);
            if (!link) {
                new Notice('取不到这个视频的位置信息，没法生成时间戳', 4000);
                return;
            }
            // 🔴 m04435 ①：右键浮层给的补充文字（`🤩 震撼 备注`）接在链接**后面**；
            //    左键/快捷键那条路 `caption` 为空 ⇒ `stampNoteLine` 原样返回链接，
            //    落盘形态与 #587 定稿**一字不差**（⛔ 别给纯链接补尾随空格，那会让 Obsidian 把 token 当坏 URL）。
            const line = stampNoteLine(link, info.caption ?? '');
            const notePath = await this.openVideoNote(entry, false);
            const written = await this.service.appendNoteSection(entry.id, line, MARK_SECTION_STAMP);
            if (notePath) this.scrollNoteToLine(notePath, written.line);
            await this.refreshPlayerMarks(entry.id);
            new Notice(`已插入时间戳 · 《${entry.title}》笔记`, 3000);
        } catch (err) {
            new Notice(`插入时间戳失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 🔴 m04435 ①：右键浮层预览里的时间文字（`0:20` / 多集 `第3集·0:20`）。
     *
     * 与 {@link videoTimeLink} 用**同一套集数口径**（文件数 / 网络集 / 声明总集数取 max）：
     * 预览若自己按 `items.length` 判，纯网络条目会被算成单集、预览不带集号，而落盘带 —— 预览与结果不一致。
     *
     * ⚠️ 命名刻意避开「Preview + Label」那种拼法：产物断言 `#452` 有一条**全局反向守卫**，
     * 要求「评语标签」那个旧函数名（`pure/labels` 里早已退场）在产物中出现 **0 次**。
     * 我这颗钩子若拼成那个词就会以子串形式命中它 ⇒ 门禁假红。
     * ⛔ 别去改那条守卫来迁就命名；也⛔ 别在任何条目里写出那个字面量 —— **块注释同样会进产物**。
     */
    private stampPreviewTextOf(entry: MediaEntry, info: { seconds: number; ep: number }): string {
        const total = Math.max(
            entry.type === 'movie' ? 1 : 0,
            entry.episodeFiles?.length ?? 0,
            entry.episodeUrls?.length ?? 0,
            entry.episodeTitles?.length ?? 0,
            entry.progress?.totalEpisodes ?? 0,
        );
        return stampLabel(info.seconds, { ep: info.ep, multi: total > 1 });
    }

    /**
     * 阅读器「区域截图」回填笔记（2026-10-23 用户指令：「给 TXT/EUPB/PDF 阅读器加个区域截图回填笔记功能」）。
     *
     * 流程：`ShotOverlay` 交来视口矩形 → `capturePage(rect)` 取真实像素 → `getAvailablePathForAttachment` 落盘
     * → `appendNoteSection(…, SHOT_SECTION_READER)` 写进笔记「## 阅读截图」区 → 滚到插入处 → Notice。
     *
     * 🔴 取像素为什么用 `capturePage` 而不是 canvas：三端只有 PDF 是 canvas（TXT/EPUB 是文本层、
     *    EPUB 还在 iframe 里），`html2canvas` 本仓没有、`foreignObject` 跨 iframe 不可靠。
     *    Electron 的 `webContents.capturePage({x,y,width,height})` 2026-10-23 真机实测**精确命中**
     *    （传 200×150 得 200×150 的 PNG）⇒ 一条通道覆盖三端。
     * 🔴 矩形单位是 **DIP = CSS px**，与 `getBoundingClientRect()` 同尺，⛔ 不要乘 `devicePixelRatio`。
     */
    async saveReaderShot(
        entry: MediaEntry,
        info: { rect: ShotRect; loc?: ShotLoc; at?: Date; png?: ArrayBuffer },
    ): Promise<void> {
        try {
            // 🔴 必须先等一帧再抓：框选层刚被 `ShotOverlay.destroy()` 摘掉，浏览器还没重绘，
            //    立刻 `capturePage` 会抓到**上一帧的遮罩**（真机实测：截出来是一整块灰）。
            //    两道 rAF 等合成帧，再加 60ms 兜底（某些机器合成与 rAF 不同步）。
            // 🔴 2026-11-13：批注链路在弹窗**打开*就已经抓好图了（`info.png`），那一步必须复用它的像。
            //    否则会抓到「批注弹窗自己」，且用户调过的框与最终落盘不一致。
            await new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
            });
            const png = info.png ?? (await this.captureViewRect(info.rect));
            if (!png) {
                new Notice('截图失败：当前环境不支持抓取窗口画面', 4000);
                return;
            }
            const path = await this.app.fileManager.getAvailablePathForAttachment(
                `${readerShotFileName(entry.title, info.at)}.png`,
                entry.notePath ?? '',
            );
            await this.app.vault.createBinary(path, png);
            // 笔记里只写**文件名**（Obsidian 的 `![[…]]` 按名解析，带 `.png` 也能认，但写全名更明确）
            const fileName = path.split('/').pop() ?? path;
            const block = readerShotBlock({ fileName, label: readerShotLabel(entry.title, info.loc) });
            if (!block) {
                new Notice('截图块形态不对，这张图没写进笔记', 4000);
                return;
            }
            const notePath = await this.openNoteBeside(entry.id);
            const { line } = await this.service.appendNoteSection(entry.id, block, SHOT_SECTION_READER);
            if (notePath) this.scrollNoteToLine(notePath, line);
            new Notice(`已截图并写入《${entry.title}》笔记`, 3000);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 阅读器「区域截图批注」（2026-11-13 用户指令：截图按钮**右键**进批注模式）。
     *
     * 与 `saveReaderShot` 的差别只有一步：**先抓图、再开批注弹窗、用户点保存后落盘**。
     * 🔴 抓图必须在弹窗打开前完成 —— 弹窗一开就会盖住正文区域，之后再 `capturePage`
     *    抓到的就是弹窗自己（这是整条链路最容易踩的一处）。
     * 🔴 落盘仍走 `saveReaderShot({ png })`：文件名规则、笔记区块、滚动定位全部复用，
     *    不要在这里另写一遍写笔记逻辑。
     */
    async annotateReaderShot(entry: MediaEntry, info: { rect: ShotRect; loc?: ShotLoc; at?: Date }): Promise<void> {
        // 框选层已自毁，等一帧让它真的离开画面（同 `saveReaderShot` 的理由）
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
        });
        const png = await this.captureViewRect(info.rect);
        if (!png) {
            new Notice('截图失败：当前环境不支持抓取窗口画面', 4000);
            return;
        }
        new ShotAnnotateModal(this.app, {
            png,
            onSave: (annotated: ArrayBuffer) => this.saveReaderShot(entry, { rect: info.rect, loc: info.loc, at: info.at, png: annotated }),
        }).open();
    }

    /**
     * 抓取视口矩形内的真实像素（PNG bytes）。
     * 走 `webContents.capturePage(rect)`。
     *
     * 🔴🔴 2026-11-14 用户 m03072 ⑤（bug 修复）：用户报「阅读器的截图批注模式下……也无法点击截图」。
     *    抓像素是本仓唯一需要 Electron 主进程能力的动作，而 `remote` 的**取得方式因版本而异**：
     *    Obsidian 1.x 有时只在 `require('electron').remote` 上，有时 `@electron/remote` 包，
     *    有时挂在 `window.require` 上。旧实现只试第一条 ⇒ 取不到就 `return null` ⇒ 批注弹窗
     *    永远打不开（左键截图也一起失败），表现正是「点不了」。
     *    现改为**按序试三条通道**，任一拿到 `webContents` 即可；全拿不到才返回 null。
     *    ⛔ 不要在失败时静默吞掉 —— 调用方要能区分「功能不支持」与「做法错了」。
     *
     * ⚠️ 实现细节（踩过）：模块名必须放进**变量**再传给 `require`。
     *    `require('@electron/remote')` 这种字面量写法会被 esbuild 在**打包期**静态解析，
     *    而该包不在 `package.json` 里（Obsidian 运行时才可能提供）⇒ 构建直接
     *    `Could not resolve "@electron/remote"` 失败。走 `window.require` / 间接引用即可绕开。
     */
    private async captureViewRect(rect: ShotRect): Promise<ArrayBuffer | null> {
        try {
            if (!Platform.isDesktopApp) return null;
            type CapWc = {
                capturePage?: (r: ShotRect) => Promise<{ toPNG: () => Buffer } | null>;
            };
            type ElectronLike = { remote?: { getCurrentWebContents?: () => CapWc | null } | null };

            // 间接引用：⛔ 不要写成 `require('electron')` 字面量（esbuild 会试图打包它）
            const nodeRequire: ((id: string) => unknown) | undefined =
                typeof require === 'function' ? (require as unknown as (id: string) => unknown) : undefined;
            const winRequire = (window as unknown as { require?: (id: string) => unknown }).require;

            const loadModule = (id: string): ElectronLike | undefined => {
                for (const req of [winRequire, nodeRequire]) {
                    if (typeof req !== 'function') continue;
                    try {
                        return req(id) as ElectronLike;
                    } catch {
                        // 模块不存在 / 上下文隔离 ⇒ 换下一条通道
                    }
                }
                return undefined;
            };

            const candidateIds = ['electron', '@electron/remote'];

            for (const id of candidateIds) {
                let wc: CapWc | null | undefined;
                try {
                    wc = loadModule(id)?.remote?.getCurrentWebContents?.();
                } catch {
                    continue;
                }
                const cap = wc?.capturePage;
                if (!wc || typeof cap !== 'function') continue;
                const image = await cap.call(wc, rect);
                if (!image) continue;
                const buf = image.toPNG();
                if (!buf || buf.byteLength === 0) continue;
                // Buffer 底层 ArrayBuffer 可能带池偏移 ⇒ slice 出独立视图（与 `readPdf` 同款处理）
                return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * #326 一键截图（用户裁定 D-3 Ⓑ 极简两行 + D-4 Ⓐ 跟随附件设置）：
     * 抓到的帧 → `getAvailablePathForAttachment` 落盘（重名自动加序号）→ 写进**条目笔记「## 截图时间戳」**区
     * （`![[图]]` + `[00:03](链接)`）。
     * ⚠️ 库外媒体也是存**库内**：Obsidian 只管理库内文件。
     *
     * 🔴 #587（用户 2026-10-09 裁定）：单击截图**不再弹二次确认备注框**（与 `insertVideoStamp` 同口径）
     * ⇒ 动作一次到位、不再有「问一句再落盘」那一跳；写入区名 = `MARK_SECTION_SHOT`（`## 截图时间戳`）。
     */
    async saveVideoShot(entry: MediaEntry, info: { png: ArrayBuffer; seconds: number; ep: number }): Promise<void> {
        try {
            const link = this.videoTimeLink(entry, info.ep, info.seconds);
            if (!link) {
                new Notice('取不到这个视频的位置信息，没法生成回跳链接', 4000);
                return;
            }
            const path = await this.app.fileManager.getAvailablePathForAttachment(shotFileName(entry.title, info.seconds), entry.notePath ?? '');
            await this.app.vault.createBinary(path, info.png);
            // 🔴 入参是 `buildTimeLink` 的**完整 markdown 链接**（`timeLink`）—— 别把裸目标塞进去：
            //    旧签名收裸目标而这里传的是完整链接 → 产出**嵌套链接**、点了完全不跳（2026-09-19 用户报障）。
            const block = buildShotBlock({ fileName: path, timeLink: link });
            if (!block) {
                // 形态守卫（`buildShotBlock` 是 fail-closed）：走到这里说明链接形态不对，
                // 明确报出来比「静默什么都不写、却提示已截取」诚实。
                new Notice('回跳链接形态不对，这一帧没写进笔记', 4000);
                return;
            }
            const notePath = await this.openVideoNote(entry, false);
            const { line } = await this.service.appendNoteSection(entry.id, block, MARK_SECTION_SHOT);
            if (notePath) this.scrollNoteToLine(notePath, line);
            await this.refreshPlayerMarks(entry.id);
            new Notice(`已插入时间戳 · 《${entry.title}》笔记`, 3000);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /**
     * 打开（或聚焦）这条视频的**笔记**；缺笔记先生成（走 `writeNote`，与摘抄同款）。
     * `focus=true`（顶栏「打开笔记」按钮）→ 打开并聚焦；`focus=false`（插入时间戳/截图时自动打开）→
     * **竖向分屏打开且不抢焦点** —— 播放器留在左侧继续播（用户 2026-09-19：「要打开当前视频笔记并分屏显示」）。
     * 已经在某个标签页里开着 → 只按 `focus` 决定是否切过去，**不重复开**。
     * **返回笔记路径**（调用方接着用它把视图滚到插入处）；取不到笔记 → null。
     */
    private async openVideoNote(entry: MediaEntry, focus = true): Promise<string | null> {
        let notePath = (await this.service.get(entry.id))?.notePath;
        // 🔴 判据必须是「文件真的在」，不能只看 `notePath` 有没有值：
        // 🔴 notePath 必须写：这是「这条条目对应哪篇笔记」的唯一真源，
        // 🔴 notePath 必须写：这是「这条条目对应哪篇笔记」的唯一真源，
        //    用户看到的就是「条目在、笔记没了」且**怎么点都修不回来**。
        //    改成文件校验后，打开即可自愈（writeNote 会按当前标题重新生成。
        const fileMissing = () => {
            if (!notePath) return true;
            return !(this.app.vault.getAbstractFileByPath(notePath) instanceof TFile);
        };
        if (fileMissing()) {
            await this.service.writeNote(entry.id);
            notePath = (await this.service.get(entry.id))?.notePath;
        }
        const file = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
        if (!(file instanceof TFile)) {
            new Notice('这条视频还没有笔记', 4000);
            return null;
        }
        // 已开着（任意标签页）→ 不重复开；按 focus 决定要不要切过去
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) {
                if (focus) this.app.workspace.setActiveLeaf(leaf, { focus: true });
                return file.path;
            }
        }
        // 竖向分屏 = 左右并排（播放器在左、笔记在右）；`active: focus` → 自动打开时不抢焦点
        const leaf = this.app.workspace.getLeaf('split', 'vertical');
        await leaf.openFile(file, { active: focus });
        return file.path;
    }

    /**
     * 按条目 id 打开（或复用）它的笔记，**竖向分屏且不抢焦点**，返回笔记路径（供调用方滚到插入处）。
     * 与 `openVideoNote` 同构，但按 id 取（阅读截图只有 entry，手里不一定有最新 `notePath`）。
     * 无笔记就先 `service.writeNote` 生成 —— 出口仍是那唯一一个，⛔ 别在这里 `vault.create`。
     */
    private async openNoteBeside(id: string): Promise<string | null> {
        let notePath = (await this.service.get(id))?.notePath;
        // `openVideoNote`：判「文件在不在」，不判「notePath 有没有值」。
        // 否则 notePath 指向已被删的文件时，这次调用既不重建也不报错，静默返null。
        const missing = () => {
            if (!notePath) return true;
            return !(this.app.vault.getAbstractFileByPath(notePath) instanceof TFile);
        };
        if (missing()) {
            await this.service.writeNote(id);
            notePath = (await this.service.get(id))?.notePath;
        }
        const file = notePath ? this.app.vault.getAbstractFileByPath(notePath) : null;
        if (!(file instanceof TFile)) return null;
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (view instanceof MarkdownView && view.file?.path === file.path) return file.path;
        }
        const leaf = this.app.workspace.getLeaf('split', 'vertical');
        await leaf.openFile(file, { active: false });
        return file.path;
    }

    /** 笔记里 `![[图]]` 的文件名 → 资源 URL（#333 卡片缩略图）；解析不到 → null（卡片只显示文字） */
    private resolveNoteImageUrl(image: string, entry: MediaEntry): string | null {
        try {
            const file =
                this.app.metadataCache.getFirstLinkpathDest(image, entry.notePath ?? '') ??
                this.app.vault.getAbstractFileByPath(normalizePath(image));
            return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
        } catch {
            return null;
        }
    }

    /** 「在笔记中打开」（#333 D-3）：开/复用条目笔记（**聚焦** —— 是用户主动点的按钮）→ 滚到标记那一行 */
    private async openNoteAtMark(entry: MediaEntry, mark: VideoMark): Promise<void> {
        const notePath = await this.openVideoNote(entry, true);
        if (notePath) this.scrollNoteToLine(notePath, mark.line);
    }

    /** 插入时间戳 / 截图后：把重算好的标记推给**同一条目**正开着的播放器（#333：不重开也能看到新点） */
    private async refreshPlayerMarks(entryId: string): Promise<void> {
        try {
            const marks = await this.service.readNoteMarks(entryId);
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView && view.playingEntryId === entryId) view.setMarks(marks);
            }
            // 🔴 用户 2026-11-14：「网络集的时间戳…在时间戳列表不能显示」。
            //    详情页也`VideoPlayerView` 的子类，但它的叶子类型是。
            //    `EPISODE_PAGE_VIEW_TYPE` —上面那个 `getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)`
            //    **永远找不到它** 在详情页插入的时间戳，本页抽屉里看不到（得重开页才有）。
            //    ⚠️ 判据`currentEntryId()` 而不`playingEntryId`：详情页`opts.entryId`
            //    也是同一条目没错，但它还有「是不是这一页」的语义要认，`currentEntryId` 更明确。
            for (const leaf of this.app.workspace.getLeavesOfType(EPISODE_PAGE_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof EpisodePageView && view.currentEntryId() === entryId) view.setMarks(marks);
            }
        } catch {
            /* 标记刷新失败不该影响插入本身 */
        }
    }

    /** 把某条笔记的编辑器**滚到指定行**（用户 2026-09-19：「插入后应定位到时间戳的位置显示，
     * 而不是又从笔记开头显示」）。**只滚视图、不动光标、不抢焦点** —— 插入是顺手动作，不该打断用户。
     */
    private scrollNoteToLine(notePath: string, line: number): void {
        if (!this.scrollToLineNow(notePath, line)) return;
        // 🔴 **下一帧再补一次**：分屏是**刚挂上 DOM** 的，布局还没跑完时 `clientHeight` 为 0，
        //    `scrollIntoView` 会算歪甚至不动（用户报「插入后没定位到插入处」的可能来源之一）。
        //    同一目标重复滚动无副作用 —— 滚动比"没滚"安全。
        window.setTimeout(() => this.scrollToLineNow(notePath, line), 90);
    }

    /** 真正滚一次：找那条笔记所在的 Markdown 叶子 → `scrollIntoView`（只滚视图、不动光标）。命中返回 true */
    private scrollToLineNow(notePath: string, line: number): boolean {
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || view.file?.path !== notePath) continue;
            const target = Math.max(0, Math.min(line, view.editor.lastLine()));
            const pos = { line: target, ch: 0 };
            view.editor.scrollIntoView({ from: pos, to: pos }, true);
            return true;
        }
        return false;
    }

    private async openVideoAt(target: VideoTimeTarget): Promise<void> {
        try {
            let entry: MediaEntry | undefined;
            let index = 0;
            if (target.kind === 'entry') {
                entry = await this.service.get(target.entryId);
                index = target.ep;
            } else {
                const hit = await this.videoPathTarget(target.filePath);
                if (hit) {
                    entry = hit.entry;
                    index = hit.index;
                }
            }
            if (!entry) {
                new Notice('找不到这条视频（条目可能已删除）', 4000);
                return;
            }
            // 已开着**同一条目**的播放器 → 切集 + 跳转播放（不重开标签页）
            for (const leaf of this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE)) {
                const view = leaf.view;
                if (view instanceof VideoPlayerView && view.playingEntryId === entry.id) {
                    this.app.workspace.setActiveLeaf(leaf, { focus: true });
                    view.seekToEpisode(index, target.seconds);
                    return;
                }
            }
            // 🔴 用户 2026-11-14：「网络集的时间戳…不能跳转」。
            //    根因就在下面这一行：`openEpisodeLocal` 开`const startPath = all[startIdx];
            //    if (!startPath) return;` —网络集没有本地文**静默 return**。
            //    用户点了笔记里的时间戳，界面一动不动（连报错都没有）。
            // 这一集没有本地文件、但有网络地址时改走选集页的网络态（`netStart` + `seekSec`）
            //    由它取流后定位到目标秒。⛔ 别指`openEpisodeLocal` 自己—它按定义只认本地文件。
            const hasLocal = !!entry.episodeFiles?.[index];
            const netUrl = entry.episodeUrls?.[index];
            if (!hasLocal && netUrl) {
                // ⚠️ 先找**已经开着**的同条目详情页，原地换源。
                //    `openEpisodePageFor` 只在「当前激活叶子恰好是选集页」时复用，
                //    否则`getLeaf('tab')` 新开一页（真机实测 1 2 个页面。
                //    2026-11-09「别新开标签页」的裁定冲突）。
                for (const leaf of this.app.workspace.getLeavesOfType(EPISODE_PAGE_VIEW_TYPE)) {
                    const v = leaf.view;
                    if (v instanceof EpisodePageView && v.currentEntryId() === entry.id) {
                        this.app.workspace.setActiveLeaf(leaf, { focus: true });
                        v.jumpToNetEpisode(index, target.seconds);
                        return;
                    }
                }
                await this.openEpisodePageFor(entry, index, target.seconds, true, index);
                return;
            }
            void this.openEpisodeLocal(entry, index, target.seconds, true);
        } catch (err) {
            new Notice(`跳到时间戳失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 打开笔记里的块锚点：命中条目 → 内置阅读器定位；未命中（非插件管理的书 / 条目已删）→ 还原 Obsidian 默认打开 */
    private async openBookAtAnchor(file: TFile, blockId: string, href: string, sourcePath: string): Promise<void> {
        try {
            const entries = await this.service.list();
            const entry = entries.find((e) => e.bookFile && normalizePath(e.bookFile) === file.path);
            if (!entry?.bookFile) {
                await this.app.workspace.openLinkText(href, sourcePath);
                return;
            }
            // 锚点链接只能靠内置阅读器定位（外部程序无法定位到块锚点），故此处不看 internalBookReader 开关
            void this.openBookInternal(entry, normalizePath(entry.bookFile), blockId).catch((err) => {
                new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
            });
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** 外部打开：系统默认程序（桌面端 shell.openPath；vault 相对路径转真实路径，库外绝对路径直接用） */
    private async openBookExternally(path: string): Promise<void> {
        // ⛔ 移动端没有「系统默认程序」这回事：require('electron') 在那里必然抛错，
        //    落到 catch 会弹「外部打开失败」。用户看到的错误提示指向了错误的失败原因。
        //    manifest 的 isDesktopOnly 是 false（移动端可浏览管理条目，README.md:227），
        //    所以这个门控必须写在方法内，而不是靠 isDesktopOnly 拦住入口。
        if (!Platform.isDesktopApp) {
            new Notice('外部打开需要桌面端；移动端请用内置阅读器打开', 4000);
            return;
        }
        try {
            const electron = require('electron') as { shell?: { openPath(p: string): Promise<string> } };
            const fullPath = this.resolveSystemPath(path);
            const err = await electron.shell?.openPath(fullPath);
            if (err) new Notice(`启动失败：${err}`, 4000);
        } catch (err) {
            new Notice(`启动失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        }
    }

    /** vault 相对/库外绝对路径 → 系统真实路径（外部打开用） */
    private resolveSystemPath(path: string): string {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const adapter = this.app.vault.adapter as FileSystemAdapter;
            return adapter.getFullPath(file.path);
        }
        return path;
    }

    /** 内置阅读器：读文件（TXT 文本 / EPUB 解包解析）→ **阅读数据存档载入**（进度/书签/高亮三合一）→ Modal 渲染；
     *  关闭后 resolve 最新落库阅读进度
     *  pendingTargetId：笔记内链接进场带上的目标块 id（`^bk…`/`^hl…` 去 `^`），阅读器渲染完成后自行消费定位 */
    private async openBookInternal(entry: MediaEntry, path: string, pendingTargetId?: string): Promise<BookProgressFields | undefined> {
        const ext = path.split('.').pop()?.toLowerCase();
        // 回归弹窗（视图/新 Tab 方式在部分 Obsidian 版本渲染不可靠）：读文件 → Modal 渲染
        // 阅读数据存档载入（打开时一次）：存档不存在（升级首开）→ 顺带把旧三源懒迁移进来；
        // 载入后内存态常驻，滚动/标注的写入都先落内存再合并落盘（见 readerStores 注释）
        const mem = await this.ensureReaderStore(entry.id, entry.title);
        const progress = mem.store.progress;
        const bookmarks = mem.store.bookmarks;
        const settings = {
            fontSize: this.settings.readerFontSize,
            lineHeight: this.settings.readerLineHeight,
            indent: this.settings.readerIndent !== false,
            hlStyle: normalizeHlStyle(this.settings.readerHlStyle),
            hlColor: normalizeHlColor(this.settings.readerHlColor),
            // #351 字体 / 字重 / 字距（缺省 = 跟随主题 / 常规 / 不写字距）
            fontFamily: normalizeFontFamily(this.settings.readerFontFamily),
            fontWeight: normalizeFontWeight(this.settings.readerFontWeight),
            letterSpacing: normalizeLetterSpacing(this.settings.readerLetterSpacing),
        };
        const onSaveProgress = (p: { chapterIndex: number; scrollRatio: number }) => {
            void this.saveReaderProgress(entry.id, entry.title, p);
        };
        // 进度百分比低频写回 catalog（翻章/关闭时；保留手填 page/totalPage，不覆盖）
        // lastPersist 跟踪最近一次落库 Promise：关闭回读前先等落库完成，避免竞态读到旧 readingProgress
        let lastPersist: Promise<void> = Promise.resolve();
        const onProgressPersist = (percent: number) => {
            lastPersist = this.persistReadingPercent(entry.id, percent);
        };
        // 已打开的阅读器视图引用（摘抄保存成功后刷新书签列表；onExcerptSave 闭包捕获，先声明后赋值）
        let view: TxtReaderView | EpubReaderView | PdfReaderView | ComicReaderView | null = null;
        // 打开阅读器并等待关闭：包装视图 onClose（先执行清理/落库——panel.destroy → flushSave），
        // 待最近一次 percent 落库完成后再读取最新 readingProgress（percent 真源）返回，供表单「当前进度页」自动同步。
        // 不能覆盖 onClose 而不调原实现：三个阅读器的 flushSave（关闭时进度/percent 落库）都挂在 onClose → destroy 链上，覆盖会导致进度丢失。
        const waitReaderClosed = (v: TxtReaderView | EpubReaderView | PdfReaderView | ComicReaderView): Promise<BookProgressFields | undefined> => {
            return new Promise((resolve) => {
                const origOnClose = v.onClose.bind(v);
                v.onClose = async () => {
                    try {
                        await origOnClose();
                    } catch { /* 清理失败不影响返回 */ }
                    // 关闭时立刻落盘最后一次进度（原实现是 flushSave 里直接写文件；现在内存态 + 合并窗口，
                    // 不等窗口到点，否则「滚到底 → 直接关标签页」会丢掉最后一次滚动）
                    await this.flushReaderStore(entry.id);
                    void lastPersist
                        .then(() => this.service.get(entry.id))
                        .then((e) => resolve(e?.readingProgress))
                        .catch(() => resolve(undefined));
                };
            });
        };
        /** 在新标签页打开阅读器视图：options 直接交给视图实例（不经 setViewState 的 state —— 避免大对象序列化）；返回视图或 null */
        const openReaderTab = async (type: string): Promise<TxtReaderView | EpubReaderView | PdfReaderView | ComicReaderView | null> => {
            // 同一本书已在本类型标签里打开 → 复用（D-4：对齐 PDF++ 实测经验，避免同一文件堆标签）。
            // 复用前用 getLeavesOfType 校验 leaf 仍存活 —— 读者可能早已关掉它，那时走下面的新开分支。
            const prev = this.readerLeaves.get(entry.id);
            if (prev && this.app.workspace.getLeavesOfType(type).includes(prev)) {
                this.app.workspace.setActiveLeaf(prev, { focus: true });
                return prev.view as TxtReaderView | EpubReaderView | PdfReaderView | ComicReaderView;
            }
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.setViewState({ type, active: true });
            const v = leaf.view;
            const isReader = v instanceof TxtReaderView || v instanceof EpubReaderView || v instanceof PdfReaderView || v instanceof ComicReaderView;
            if (isReader) this.readerLeaves.set(entry.id, leaf);
            return isReader ? (v as TxtReaderView | EpubReaderView | PdfReaderView | ComicReaderView) : null;
        };
        /**
         * 🔴 #537 阅读时长：把「阅读器处于**前台且是活动页**」的时长累计进 `readMinutes`。
         * 口径（用户 2026-10-05 点定）：扣后台（切标签页 / 切出应用即暂停）+ **单次不足 1 分钟不计入**。
         * 算术与状态机在 `pure/readTimer`（可单测）；这里只接浏览事件、开关计时、关闭时落库。
         * ⚠️ 只看 `document.visibilityState` **不够** —— Obsidian 切标签页时文档仍可见，故必须同时比对**活动叶**。
         */
        const withReadTime = (leaf: WorkspaceLeaf, wait: Promise<BookProgressFields | undefined>): Promise<BookProgressFields | undefined> => {
            const rt = createReadTimeState();
            const isForeground = (): boolean => document.visibilityState === 'visible' && this.app.workspace.activeLeaf === leaf;
            const sync = (): void => setReadActive(rt, isForeground(), Date.now());
            sync();
            const onVis = (): void => sync();
            const onLeafChange = (): void => sync();
            document.addEventListener('visibilitychange', onVis);
            const leafRef = this.app.workspace.on('active-leaf-change', onLeafChange);
            return wait.then(async (r) => {
                document.removeEventListener('visibilitychange', onVis);
                this.app.workspace.offref(leafRef);
                setReadActive(rt, false, Date.now());
                const mins = countableMinutes(readActiveMs(rt));
                if (mins > 0) {
                    try {
                        const cur = await this.service.get(entry.id);
                        await this.service.update(entry.id, { readMinutes: addReadMinutes(cur?.readMinutes, mins) });
                    } catch { /* 计时落库失败不影响阅读返回 */ }
                }
                return r;
            });
        };
        /** 摘抄就地卡片保存（阅读器内划词 → 卡里写想法 → Enter/保存）：写回笔记「## 摘抄」区 + 刷新阅读器摘抄列表；
         *  返回是否成功 —— false 时阅读器保留卡片与输入便于重试（用户 2026-09-17 裁定 C 方案，替换原弹窗）
         *  `label` 可选：覆盖头行标签（PDF 用 —— 它的 loc.chapter 是**页码**，不能沿用「第 N 章」文案） */
        const onExcerptSave = async (
            quote: string,
            note: string | undefined,
            loc: { chapter: number; pct: number },
            label?: string,
        ): Promise<boolean> => {
            try {
                const r = await this.addExcerpt(entry.id, label ? { quote, note, loc, label } : { quote, note, loc });
                // 成功提示（用户 2026-09-19 报「保存摘抄没弹出轻提示」—— 此前只有失败路径有 Notice，
                // 就地卡片保存完什么反馈都没有；文案与摘抄弹窗（ExcerptModal）保持同一句式）
                new Notice(`已添加摘抄 · 《${entry.title}》现有 ${r.count} 条`);
                view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
                return true;
            } catch (err) {
                new Notice(`写入摘抄失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
                return false;
            }
        };
        /** PDF 摘抄保存：`loc.chapter` 是页码 1 基 ⇒ 头行标签写「第 N 页」（⛔ 不写「第 N 章」），其余走同一条通道 */
        const onPdfExcerptSave = (quote: string, note: string | undefined, loc: { chapter: number; pct: number }): Promise<boolean> => {
            const pct = Number.isFinite(loc.pct) && loc.pct > 0 ? ` · ${Math.round(loc.pct)}%` : '';
            return onExcerptSave(quote, note, loc, `第 ${loc.chapter} 页${pct}`);
        };
        /** 区域截图（2026-10-23 用户指令）：三阅读器共用 —— 面板给视口矩形 + 定位，这里取像素/落盘/写笔记。
         *  🔴 注入口在三个 `openWith` 里都叫 `onShotSave`；PDF 传 `{page}`，TXT/EPUB 传 `{chapter,pct}`。 */
        const onShotSave = (rect: ShotRect, loc?: ShotLoc): void => {
            void this.saveReaderShot(entry, { rect, loc });
        };
        /** 区域截图**右键批注**（2026-11-13 用户指令）：先抓图 → 七工具批注弹窗 → 保存后走同一条落盘通道 */
        const onShotAnnotate = (rect: ShotRect, loc?: ShotLoc): void => {
            void this.annotateReaderShot(entry, { rect, loc });
        };
        // 摘抄书签数据源（读笔记摘抄区；打开时读一次）
        const excerpts = await this.loadEntryExcerpts(entry.id);
        // 高亮数据源（阅读数据存档里的高亮段；打开时读一次，用于页内黄标渲染）
        const highlights = mem.store.highlights;
        // 排版调整写回设置（阅读器内 A±/行距± → settings 全局记住；saveData 轻量落盘，不重建客户端）
        const onDeleteExcerpt = (blockId: string) => this.deleteBookExcerpt(entry.id, blockId);
        // 一键即黄即记：写入阅读数据存档（真源）→ 返回新块 id（null=失败，阅读器本地据此即时 mark）
        // PDF 多传一个 `rects`（归一化页内矩形，缩放无关）；TXT/EPUB 不传 → 存档形状与旧版一致
        const onHighlight = (
            quote: string,
            loc: { chapter: number; pct: number },
            style?: HlStyle,
            color?: HlColor,
            rects?: PdfRelRect[],
        ) => this.addBookHighlight(entry.id, entry.title, quote, loc, style, color, rects);
        const onDeleteHighlight = (blockId: string) => this.deleteBookHighlight(entry.id, blockId);
        /** 动作条垃圾桶：直删（不弹确认，用户 2026-09-16 选定）—— 高亮出存档、摘抄出笔记摘抄区。
         *  `opts.quiet` ＝ 静默（改样式路径「先删旧再写新」的中间步骤用：改样式是一次用户动作，
         *  只该报一条提示 —— 旧实现这条删 + 阅读器的「已高亮」+「已更新高亮样式」共弹三条，用户 2026-09-18 报障）。 */
        const onTrashSelection = async (
            t: { highlightIds: string[]; excerptIds: string[]; highlightQuotes?: string[] },
            opts?: { quiet?: boolean },
        ): Promise<number> => {
            // 高亮：一次批量删（内部按 id + 引用文本兜底，只 flush 一次）
            let hlN = 0;
            try {
                hlN = await this.removeReaderHighlights(entry.id, entry.title, t.highlightIds, t.highlightQuotes ?? []);
            } catch { /* 单条失败不中断 */ }
            let exN = 0;
            for (const eid of t.excerptIds) {
                try { await this.service.deleteExcerpt(entry.id, eid); exN++; } catch { /* 同上 */ }
            }
            const n = hlN + exN;
            if (n) {
                // 提示写清**删的是哪一类**（用户 2026-09-18 报障时的困惑源头：只写「已删除 1 条」，
                // 而同一选段若同时存在摘抄与高亮，删掉摘抄后高亮仍在 → 看上去「删了却没删」）。
                // 静默模式下不报（调用方会把这一步并进它自己那一条提示里）。
                if (!opts?.quiet) {
                    const parts = [hlN ? `${hlN} 条高亮` : '', exN ? `${exN} 条摘抄` : ''].filter(Boolean);
                    new Notice(`已删除 ${parts.join('、')}`);
                }
                view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
            }
            return n;
        };
        /** 清除全部标注（侧栏「清除全部」按钮，已一次性确认）：按 kind 逐条删，**不再逐条弹确认**；
         *  删完刷新阅读器列表（高亮由阅读器本地清、摘抄/书签列表一并重读） */
        const onPurgeAnnotations = async (kind: 'highlight' | 'excerpt', blockIds: string[]): Promise<number> => {
            if (kind === 'highlight') {
                // 高亮走存档（一次批量删）
                return await this.removeReaderHighlights(entry.id, entry.title, blockIds, []).catch(() => 0);
            }
            let n = 0;
            for (const bid of blockIds) {
                if (!bid) continue;
                try {
                    await this.service.deleteExcerpt(entry.id, bid);
                    n++;
                } catch { /* 单条失败不中断（对齐垃圾桶容错） */ }
            }
            if (n) view?.refreshExcerpts(await this.loadEntryExcerpts(entry.id));
            return n;
        };
        /** 打开条目笔记（阅读器顶栏「打开笔记」按钮；无笔记时 openEntryNote 内部提示） */
        const onOpenNote = (): void => void this.openEntryNote(entry.id);
        const onBookmarksChange = (list: ReaderBookmark[]) => {
            void this.saveReaderBookmarks(entry.id, entry.title, list);
        };
        const onSettingsChange = (s: ReaderTypoPayload) => {
            this.settings.readerFontSize = s.fontSize;
            this.settings.readerLineHeight = s.lineHeight;
            if (s.indent !== undefined) this.settings.readerIndent = s.indent;
            if (s.hlStyle !== undefined) this.settings.readerHlStyle = s.hlStyle;
            if (s.hlColor !== undefined) this.settings.readerHlColor = s.hlColor;
            // #351 字体 / 字重 / 字距（缺省 = 本次不动这一项，见 ReaderTypoPayload 注释）
            if (s.fontFamily !== undefined) this.settings.readerFontFamily = s.fontFamily;
            if (s.fontWeight !== undefined) this.settings.readerFontWeight = s.fontWeight;
            if (s.letterSpacing !== undefined) this.settings.readerLetterSpacing = s.letterSpacing;
            void this.saveData(this.settings);
        };
        // 滚动模式（连续/翻页）：初始读持久字段（缺省 continuous），切换写回设置（append-only，跨面板/重开记住）
        const scrollMode = this.settings.readerScrollMode ?? 'continuous';
        const onScrollModeChange = (m: 'continuous' | 'paged') => {
            if (this.settings.readerScrollMode === m) return;
            this.settings.readerScrollMode = m;
            void this.saveData(this.settings);
        };
        // PDF 页面缩放（2026-10-23 用户指令「记住 Ctrl+滚轮调过的大小」）：
        // 初始读持久字段（缺省 1 = 100%），滑条 / 键盘 / Ctrl+滚轮三路都经 onScaleChange 写回。
        // ⚠️ 与 TXT/EPUB 的 `readerFontSize` 是两个字段：那两件调字号，PDF 调页面缩放，语义不同别合并。
        const pdfScale = this.settings.readerPdfScale ?? 1;
        const onPdfScaleChange = (s: number) => {
            if (this.settings.readerPdfScale === s) return;
            this.settings.readerPdfScale = s;
            void this.saveData(this.settings);
        };
        // 行宽（严格/全宽）：初始读持久字段（缺省 strict），切换写回设置（append-only，跨面板/重开记住）
        const lineWidth = this.settings.readerLineWidth ?? 'strict';
        const onLineWidthChange = (w: 'strict' | 'full') => {
            if (this.settings.readerLineWidth === w) return;
            this.settings.readerLineWidth = w;
            void this.saveData(this.settings);
        };
        // 阅读主题（1.0.5）：初始读持久字段（缺省 follow = 跟随 Obsidian 主题），切换写回设置（append-only，三件阅读器共用）
        const theme = this.settings.readerTheme ?? 'follow';
        const onThemeChange = (t: 'follow' | 'light' | 'dark' | 'green' | 'gray' | 'sepia') => {
            if (this.settings.readerTheme === t) return;
            this.settings.readerTheme = t;
            void this.saveData(this.settings);
        };
        /** 云合成 Key 读取（#344 方案 C）：交给阅读器面板**每次现取** ⇒ 设置页刚填完就能用，不必重开阅读器 */
        const getCloudKey = (): string => (this.settings.readerSiliconflowKey ?? '').trim();
        // ── #537 漫画分支（图片文件夹 / CBZ·ZIP / CBT·TAR）──────────────────────────
        // 先于扩展名分支：文件夹型没有扩展名，只能靠实测；压缩包按 `pure/comicFiles` 的扩展名表判定。
        const isComicSource = isComicArchivePath(path) || this.isDirectoryPath(path);
        if (isComicSource) {
            const isDir = this.isDirectoryPath(path);
            let names: string[];
            let loadPage: (i: number) => Promise<Blob | null>;
            if (isDir) {
                const dir = path.replace(/[\\/]+$/, '');
                names = await this.listComicFolderPages(dir);
                if (!names.length) {
                    new Notice('这个文件夹里没有找到图片页（支持 png/jpg/jpeg/webp/gif/avif/bmp）', 4500);
                    return undefined;
                }
                loadPage = (i) => (names[i] ? this.readComicPageBlob(`${dir}/${names[i]}`) : Promise.resolve(null));
            } else {
                const arc = await this.openComicArchive(path);
                if (!arc) {
                    new Notice(`书籍文件不存在或无法解包：${entry.bookFile}${entry.bookFile}`, 5000);
                    return undefined;
                }
                names = arc.names;
                if (!names.length) {
                    new Notice('这个压缩包里没有找到图片页（支持 png/jpg/jpeg/webp…）', 4500);
                    return undefined;
                }
                loadPage = async (i) => {
                    const bytes = await arc.read(i);
                    return bytes ? new Blob([bytes], { type: comicMime(names[i] ?? '') }) : null;
                };
            }
            const pageCount = names.length;
            // 打开时校正进度基准（totalPage = 本地页数，percent 恒定重算当前页；与 PDF 同构，单位「页」）
            void this.reconcileBookProgressOnOpen(entry.id, { format: 'comic', numPages: pageCount });
            const reader = await openReaderTab(COMIC_READER_VIEW_TYPE) as ComicReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                pageCount,
                loadPage,
                progress,
                onOpenNote,
                theme,
                onThemeChange,
                // 🔴 #636 ⑤：两档新偏好（阅读模式 / 缩略图栏）—— 与 theme 同款「初始读持久字段 + 切换写回」
                viewMode: normalizeComicViewMode(this.settings.comicViewMode),
                onViewModeChange: (m: ComicViewMode) => {
                    if (this.settings.comicViewMode === m) return;
                    this.settings.comicViewMode = m;
                    void this.saveData(this.settings);
                },
                thumbsOn: thumbsVisible(this.settings.comicThumbs),
                onThumbsChange: (on: boolean) => {
                    if (this.settings.comicThumbs === on) return;
                    this.settings.comicThumbs = on;
                    void this.saveData(this.settings);
                },
                // 🔴 右键菜单显示**压缩包内的原文件名**（图片文件夹档退化为文件名本身）
                pageName: (i: number) => names[i] ?? '',
                onSaveProgress,
                onProgressPersist,
                // 2026-10-23 用户指令：漫画补书签 + 区域截图（顶栏快捷按钮）。
                // 书签与 PDF 共用同一条落库通道 `saveReaderBookmarks`（位置 = 页码 1 基 + 页内 %），
                // ⛔ 别为漫画另开存储；二次确认由 `ComicReaderView.prepare()` 注入。
                bookmarks,
                onBookmarksChange,
                onShotSave,
                onShotAnnotate,
            });
            return withReadTime(reader.leaf, waitReaderClosed(reader));
        }
        if (ext === 'txt') {
            const text = await this.readBookText(path);
            if (text === null) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            // TXT 打开时同样校正进度基准（按章节解析：totalPage=章节数，percent 恒定重算当前章；与 PDF 双通道对称）
            void this.reconcileBookProgressOnOpen(entry.id, { format: 'txt', totalChapters: parseTxtBook(text).chapters.length });
            const reader = await openReaderTab(TXT_READER_VIEW_TYPE) as TxtReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                text,
                pendingTargetId,
                onOpenNote,
                progress,
                settings,
                scrollMode,
                onScrollModeChange,
                lineWidth,
                onLineWidthChange,
                theme,
                onThemeChange,
                getCloudKey,
                excerpts,
                bookmarks,
                highlights,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onExcerptSave,
                onShotSave,
                onShotAnnotate,
                onPurgeAnnotations,
                onSettingsChange,
                onDeleteExcerpt,
                onTrashSelection,
                onHighlight,
                onDeleteHighlight,
                onTranslate: (text) => this.translateText(text),
                onAiSearch: (text) => this.aiSearchText(text),
                // AI 卡「自定义提问」：走同一条 AI 通道但不读设置页提示词（用户 2026-09-18）
                onAiAsk: (text, question) => this.aiAskText(text, question),
                // 网络搜索浮层引擎 chip → 系统浏览器（openExternalUrl 已限 http/https）
                onOpenExternal: (url) => this.openExternalUrl(url),
            });
            return withReadTime(reader.leaf, waitReaderClosed(reader));
        } else if (ext === 'epub') {
            let epub: { fileMap: Record<string, string>; book: { title: string; chapters: string[]; toc: { label: string; href: string }[]; manifest: Record<string, string> }; loadBinary: (abs: string) => Promise<Uint8Array | null> } | null = null;
            try {
                epub = await this.unpackEpub(path);
            } catch (err) {
                new Notice(`EPUB 解析失败：${err instanceof Error ? err.message : String(err)}`, 6000);
                return undefined;
            }
            if (!epub) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            // ── #540 漫画条目 + EPUB ⇒ 走**漫画阅读器**（用户报障：「怎么解析不了 eupb 格式的漫画」）──────
            // 🔴 真因：EPUB 正文渲染在 `iframe.srcdoc` 里（无基准 URL）⇒ 章节里的相对路径 `image/p001.jpg`
            //    被解析成 `app://obsidian.md/image/p001.jpg`（控制台原文 `net::ERR_FILE_NOT_FOUND`）；
            //    且解包侧只收文本文件（图片从未进 `fileMap`）⇒ 图册型 EPUB 在文字阅读器里必然全空。
            // ⇒ 按 **spine 序**抽出页图（`pure/epubComic`），复用与 CBZ 同一条渲染链；抽不到图再回落文字阅读器。
            if (normalizeBookKind(entry.bookKind) === 'comic') {
                const pages = extractEpubComicPages(epub.book.chapters, epub.fileMap);
                if (pages.length) {
                    const loadPage = async (i: number): Promise<Blob | null> => {
                        const pg = pages[i];
                        if (!pg) return null;
                        const bytes = await epub!.loadBinary(pg.path);
                        return bytes ? new Blob([bytes], { type: comicMime(pg.name) }) : null;
                    };
                    void this.reconcileBookProgressOnOpen(entry.id, { format: 'comic', numPages: pages.length });
                    const reader = await openReaderTab(COMIC_READER_VIEW_TYPE) as ComicReaderView | null;
                    if (!reader) return undefined;
                    view = reader;
                    // 🔴 #636 ⑤：两档新偏好（阅读模式 / 缩略图栏）—— 与 theme 同款「初始读持久字段 + 切换写回」
                    const viewMode = normalizeComicViewMode(this.settings.comicViewMode);
                    const onViewModeChange = (m: ComicViewMode) => {
                        if (this.settings.comicViewMode === m) return;
                        this.settings.comicViewMode = m;
                        void this.saveData(this.settings);
                    };
                    const thumbsOn = thumbsVisible(this.settings.comicThumbs);
                    const onThumbsChange = (on: boolean) => {
                        if (this.settings.comicThumbs === on) return;
                        this.settings.comicThumbs = on;
                        void this.saveData(this.settings);
                    };
                    reader.openWith({
                        title: entry.title,
                        pageCount: pages.length,
                        loadPage,
                        progress,
                        onOpenNote,
                        theme,
                        onThemeChange,
                        viewMode,
                        onViewModeChange,
                        thumbsOn,
                        onThumbsChange,
                        // 🔴 右键菜单：EPUB 漫画那一档的页名取自 spine 抽出的页图路径
                        pageName: (i: number) => pages[i]?.name ?? '',
                        onSaveProgress,
                        onProgressPersist,
                        // 2026-10-23 用户指令：EPUB 漫画这一档也要书签 + 区域截图
                        // （与压缩包/图片文件夹那一档同构，共用 `saveReaderBookmarks` 落库）
                        bookmarks,
                        onBookmarksChange,
                        onShotSave,
                        onShotAnnotate,
                        });
                    return withReadTime(reader.leaf, waitReaderClosed(reader));
                }
                // 图册型判定失败（纯文字 EPUB / 图片走 CSS background 等）→ 交回文字阅读器，但说清缘由
                new Notice('这本 EPUB 里没有找到图片页 — 按文字排版打开', 4000);
            }
            // EPUB 打开时同样校正进度基准（spine 章节数：totalPage=章节数，percent 恒定重算当前章；与 TXT/PDF 对称）
            void this.reconcileBookProgressOnOpen(entry.id, { format: 'epub', totalChapters: epub.book.chapters.length });
            const reader = await openReaderTab(EPUB_READER_VIEW_TYPE) as EpubReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                fileMap: epub.fileMap,
                // 🔴 #641：正文插图/样式按包内路径取二进制 → 阅读器换成 blob URL 注入 srcdoc
                //    （srcdoc 无基准 URL ⇒ 相对路径全 404、每张图一次失败请求，见 `pure/epubResource`）。
                loadEpubResource: epub.loadBinary,
                pendingTargetId,
                onOpenNote,
                book: epub.book,
                progress,
                settings,
                scrollMode,
                onScrollModeChange,
                lineWidth,
                onLineWidthChange,
                theme,
                onThemeChange,
                getCloudKey,
                excerpts,
                bookmarks,
                highlights,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onExcerptSave,
                onShotSave,
                onShotAnnotate,
                onPurgeAnnotations,
                onSettingsChange,
                onDeleteExcerpt,
                onTrashSelection,
                onHighlight,
                onDeleteHighlight,
                onTranslate: (text) => this.translateText(text),
                onAiSearch: (text) => this.aiSearchText(text),
                // AI 卡「自定义提问」：走同一条 AI 通道但不读设置页提示词（用户 2026-09-18）
                onAiAsk: (text, question) => this.aiAskText(text, question),
                // 网络搜索浮层引擎 chip → 系统浏览器（openExternalUrl 已限 http/https）
                onOpenExternal: (url) => this.openExternalUrl(url),
            });
            return withReadTime(reader.leaf, waitReaderClosed(reader));
        } else {
            // PDF：读二进制 → PdfReaderModal（无字号/行距设置，其余管道复用）
            const data = await this.readPdf(path);
            if (data === null) {
                new Notice(`书籍文件不存在：${entry.bookFile}`, 5000);
                return undefined;
            }
            const reader = await openReaderTab(PDF_READER_VIEW_TYPE) as PdfReaderView | null;
            if (!reader) return undefined;
            view = reader;
            reader.openWith({
                title: entry.title,
                data,
                progress,
                onOpenNote,
                theme,
                onThemeChange,
                excerpts,
                // #382b：PDF 也接书签（同一条落库通道 `saveReaderBookmarks`）—— 位置存「页码（1 基）+ 页内 %」
                // ⚠️ `onConfirmClear` 不在这里传：它由 `PdfReaderView.prepare()` 统一注入（面板无 app，与 TXT/EPUB 同口）
                bookmarks,
                onBookmarksChange,
                onSaveProgress,
                onProgressPersist,
                onDeleteExcerpt,
                // PDF 加载完成后校正进度基准（totalPage=本地页数；percent 恒定重算 page；旧 totalPage 惰性迁移为元数据）
                onPdfReady: (numPages) => {
                    void this.reconcileBookProgressOnOpen(entry.id, { format: 'pdf', numPages });
                },
                // 2026-10-23 路线 A：PDF 高亮接进同一条管道（存阅读存档 JSON，⛔ 不写回 PDF 文件）。
                // 与 TXT/EPUB 共用 `highlights` / `onHighlight` / `onDeleteHighlight`，差别只是 PDF 会多存
                // 一个 `rects`（归一化页内矩形）—— 缩放/重开时按百分比还原，不用再跑一遍文本定位。
                // ⚠️ 这三项刻意排在 `onPdfReady` 之后：`_assert` 里「bookmarks + onBookmarksChange 同时接线」
                //    那条判据拿 `onPdfReady:` 当右锚且窗口只有 300 字符，插在中间会把窗口撑爆（假红）。
                highlights,
                onHighlight,
                onDeleteHighlight,
                // 静默直删（与 TXT/EPUB 同一个入口）：换样式时先删旧，⛔ 不弹确认框，
                // 让整次改样式只留末尾一条「已更新高亮样式」。
                onTrashSelection,
                // 2026-10-23：PDF 摘抄写入口（动作条「❝ 摘抄」→ 就地卡片 → 保存）。
                // 与 TXT/EPUB 共用同一个 `onExcerptSave` 闭包 —— 笔记区段与 noteFingerprint 的唯一
                // 拥有者是 EntryService，⛔ 别为 PDF 另起一条写入路径。
                // ⚠️ 走 `onPdfExcerptSave`：PDF 的 loc.chapter 是页码，头行标签必须写「第 N 页」。
                onExcerptSave: onPdfExcerptSave,
                // 2026-10-23：PDF 区域截图（动作条上方「区域截图」按钮 → 拖框 → 宿主 capturePage）。
                // 与 TXT/EPUB 共用同一个 `onShotSave` 闭包；PDF 额外传 `{page}` 定位（截图块标「第 N 页」）。
                onShotSave,
                onShotAnnotate,
                // 2026-10-23 用户指令：PDF 顶栏同步 TXT/EPUB 的快捷功能（书签/高亮/摘抄/截图/翻译/网络搜索/设置）。
                // 翻译与网络搜索复用 TXT/EPUB 那两个闭包 —— 同一套 AI/外部链接通道，⛔ 别另起实现。
                onTranslate: (text) => this.translateText(text),
                onOpenExternal: (url) => this.openExternalUrl(url),
                // 阅读模式（连续滚动 / 翻页）：与 TXT/EPUB **共用** `readerScrollMode` 字段 + `onScrollModeChange` 闭包，
                // ⛔ 别给 PDF 单开一个设置键（用户口径是「三个阅读器都要能切」，切换应当跨面板一致）。
                scrollMode,
                onScrollModeChange,
                // 页面缩放持久化（Ctrl+滚轮 / 滑条 / 键盘共用）：初始值来自 `readerPdfScale`，改动经 onScaleChange 写回。
                scale: pdfScale,
                onScaleChange: onPdfScaleChange,
            });
            return withReadTime(reader.leaf, waitReaderClosed(reader));
        }
    }

    /** 打开书籍阅读器时校正阅读进度基准（本地文件优先）：PDF 按页、TXT 按章节，percent 恒定，page/totalPage 重算；
     *  PDF 旧 totalPage 与本地不一致且 pageCount 为空 → 惰性迁移为元数据页数（保统计口径）。失败静默不影响阅读 */
    private async reconcileBookProgressOnOpen(entryId: string, file: BookFileInfo): Promise<void> {
        try {
            const e = await this.service.get(entryId);
            if (!e) return;
            const r = reconcileBookProgress(e.readingProgress ?? {}, file);
            if (!r.readingProgress) return;
            await this.service.update(entryId, {
                readingProgress: r.readingProgress,
                ...(r.pageCount !== undefined ? { pageCount: r.pageCount } : {}),
            });
        } catch { /* 校正失败静默（不影响阅读） */ }
    }

    async openEntryNote(id: string): Promise<void> {
        const e = await this.service.get(id);
        if (!e) return;
        if (e.notePath) {
            const f = this.app.vault.getAbstractFileByPath(e.notePath);
            if (f instanceof TFile) {
                await this.app.workspace.getLeaf('tab').openFile(f);
                return;
            }
        }
        // 🔴 #593：**没有笔记就当场生成**（用户报障：「从微信读书同步书架导入的条目点开提示
        //    『该条目还没有笔记』」）。根因 = `service.create()` 只写 catalog、不生成笔记，而导入
        //    路径用的就是它 ⇒ 那批条目永远没有 `notePath`。这里做**自愈**：存量条目也一并救活，
        //    出口仍是唯一那一个 `service.writeNote`（生成 + 写盘 + 回填 `notePath` 都在它里面）。
        try {
            const path = await this.service.writeNote(e.id);
            const f = this.app.vault.getAbstractFileByPath(path);
            if (f instanceof TFile) {
                await this.app.workspace.getLeaf('tab').openFile(f);
                return;
            }
        } catch (err) {
            new Notice(`生成笔记失败：${err instanceof Error ? err.message : String(err)}`, 5000);
            return;
        }
        new Notice('该条目还没有笔记');
    }

    async refreshViews(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            // 🔴 不能裸转 `leaf.view as HomeView`：Obsidian 恢复布局时，同类型 leaf 里可能是**尚未
            //    onOpen 的占位视图**（原型上是 `rerender` 而非 `refresh`），硬调用会抛
            //    `TypeError: leaf.view.refresh is not a function` 并打断整轮刷新（真机实测 2026-10-23）。
            //    ⚠️ 只做能力判定，不吞真实异常 —— `refresh()` 自己抛错仍然照常冒泡。
            const v = leaf.view as unknown as { refresh?: () => Promise<void> } | null;
            if (typeof v?.refresh !== 'function') continue;
            await v.refresh();
        }
        // 🔴 #408：条目数据变了 ⇒ 顺带把**打开的播放器**叫醒（新队列 / 新歌词）。
        //    用户报的 bug 正是「播放中识别不到新条目与更新后的歌词」—— 挂在 `refreshViews` 上
        //    就与「保存 / 删除 / 关联」这些入口天然同步，⛔ 不必每个调用点各写一遍（会漏）。
        await this.refreshAudioPlayers();
        // 🔴 2026-11-08：选集页同—它的 `pageCtx.entry` 是打开那一刻的快照。
        //    简介封面加了右键菜单之后，「编辑属性」改完保存就落在这条通路上，
        //    不刷的话用户得关掉整页重开才看得见新封/ 新标题。
        //    ⚠️ 只在**真有选集页开着**时才catalog（`getLeavesOfType` 空数组开销为零）。
        await this.refreshEpisodePages();
        // 🔴 2026-11-08（用m04478「修改了但当前播放页没有实时生效」）。
        //    独立播放器页签此*没有任何刷新入口** —它的片名是打开那一刻的快照。
        //    改完标题回到那一页，顶栏与标签页都还是旧名。这里按 entryId 认页后只推新片名。
        //    不重建视图（重建会打断正在播的片子，也与「认人不打断」的口径相反）。
        this.refreshPlayerTitles();
    }

    /**
     * 把最新片名推给已打开的独立播放器页签（只改名，不重建、不打断播放）。
     *
     * ⚠️ 与选集页那条分开：选集页自己会在 `refreshEntrySnapshot` 里推片名
     *    （它还有标题块与简介卡要重画），这里只管**纯播放器**页签。
     */
    private refreshPlayerTitles(): void {
        const leaves = this.app.workspace.getLeavesOfType(VIDEO_PLAYER_VIEW_TYPE);
        if (!leaves.length) return;
        for (const leaf of leaves) {
            const v = leaf.view;
            if (!(v instanceof VideoPlayerView)) continue;
            const id = v.playingEntryId;
            // 单文件预/ 无条目上下文（`playingEntryId` 为空）没有「条目改名」这回事。
            if (!id) continue;
            void this.service.get(id).then((latest) => {
                if (!latest) return;
                v.applyEntryTitle(latest.title);
            });
        }
    }

    /**
     * 把最新条目推给已打开的选集页（只重画标题块 + 简介卡，不重建播放器、不打断播放）。
     *
     * ⚠️ 与 `refreshViews()` 分开：`refreshEntrySnapshot` 需要每页各自的最新条目与封面地址，
     *    而 `resolvePoster` 会碰 vault 文件系统 —— 没开选集页时**一次都不该调用**。
     */
    private async refreshEpisodePages(): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(EPISODE_PAGE_VIEW_TYPE);
        if (!leaves.length) return;
        const views = leaves
            .map((leaf) => leaf.view)
            .filter((v): v is EpisodePageView => v instanceof EpisodePageView);
        if (!views.length) return;
        const ids = [...new Set(views.map((v) => v.currentEntryId()).filter((id): id is string => !!id))];
        if (!ids.length) return;
        for (const id of ids) {
            // 条目可能刚被删掉 `get` 返回 null，此时不刷（页面会被删除通路自己关掉。
            const latest = await this.service.get(id);
            if (!latest) continue;
            const cover = this.resolvePoster(latest) ?? null;
            for (const v of views) {
                if (v.currentEntryId() === id) v.refreshEntrySnapshot(latest, cover);
            }
        }
    }

    /**
     * 🔴 #408：把**最新的曲目队列**推给所有打开的音频播放器（标签页 / 侧边栏）。
     * 语义（认人 / 不打断播放）全在装配层的 `updateQueue` 里，本方法只负责「谁在场 + 给什么数据」。
     * ⚠️ 没人开着播放器时**立刻返回**（不读 catalog、零开销）—— 所以挂在 `refreshViews` 上是安全的。
     */
    async refreshAudioPlayers(): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(AUDIO_PLAYER_VIEW_TYPE);
        if (!leaves.length) return;
        const opts = await this.buildAudioPlayerOptions(null);
        if (!opts) return;
        for (const leaf of leaves) {
            (leaf.view as AudioPlayerView).refreshTracks(opts.items);
        }
    }

    /**
     * 海报密度即时生效（设置页「外观与体验 › 海报密度」改动后调用，用户 2026-09-22）。
     * 与 setUiTheme 同思路：只重推两个 prop（不重读条目、不落盘）——密度是纯展示参数，
     * 走 refreshViews() 会白跑一遍 catalog 磁盘 IO。
     */
    syncPosterGrid(): void {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            (leaf.view as HomeView).setPosterGrid(this.settings.posterDensity, this.settings.posterColumns);
        }
    }

    /**
     * 🔴 #591 Ctrl+滚轮缩放的**落盘出口**（媒体库只报告「缩到几列」，这里写设置 + 重推）。
     *
     * 为什么落成 `custom`：用户裁定的「两者并存」口径 —— 「海报密度」是**预设**，Ctrl+滚轮是**微调**；
     * 微调过之后那一行就该显示为「自定义列数」，再滚就从这个自定义值继续。
     * ⚠️ 与 `syncPosterGrid` 一样只重推 prop（不重读条目）；`saveSettings()` 是异步的、不等它。
     * ⚠️ #626 起这里只管**卡片网格 / 瀑布流**那一路；海报墙走 `applyWallZoom`（见下）。
     */
    applyPosterZoom(density: PosterDensity, columns: number): void {
        this.settings.posterDensity = normalizePosterDensity(density);
        this.settings.posterColumns = normalizePosterColumns(columns);
        void this.saveSettings();
        this.syncPosterGrid();
    }

    /**
     * 🔴 #626 海报墙（`wall`）Ctrl+滚轮缩放的**落盘出口**。
     *
     * 🔴 用户 2026-10-20：「设置页里的海报墙列数项删除掉」⇒ `wallColumns` 这个键**整条下线**，
     *    墙的缩放**改回写共享的 `posterDensity` / `posterColumns`**（与 `applyPosterZoom` 同一套语义：
     *    落成 `custom`，设置页「海报密度」显示为「自定义列数」）。
     * 为什么不能再各记各的：删掉设置项后，墙自己的键就变成「界面看不见、脚本还记着」的鬼开关 ——
     *    墙会停在一个设置页永远调不动的列数上。现在两处共用一条真源，⛔ 别再给墙开第二个列数键。
     * ⚠️ 上界随之下调为 `POSTER_COLUMNS_MAX`（12）：16 列那一档是「墙自己的上界」，随键一起退场。
     */
    applyWallZoom(columns: number): void {
        this.settings.posterDensity = 'custom';
        this.settings.posterColumns = normalizePosterColumns(columns);
        void this.saveSettings();
        this.syncPosterGrid();
    }

    /**
     * 🔴 #657 统计页区块顺序的**落盘出口**（用户：「统计页的所有元素支持自由排序，自适应」）。
     *
     * 🔴 落盘口径（与 `fieldOrder` 同一套）：归一后**与缺省逐位一致 ⇒ 删掉该键**，⛔ 不存一份缺省副本 ——
     *    这样以后新增区块能自动落在缺省顺序里的位置，而不是被老配置"钉"在末尾。
     * ⚠️ 只重推 prop（`refreshViews` 会重建组件状态），不重读条目 —— 顺序变了但数据没变。
     */
    applyStatsOrder(next: StatsBlockKey[]): void {
        const norm = normalizeStatsOrder(next);
        if (isDefaultStatsOrder(norm)) delete this.settings.statsOrder;
        else this.settings.statsOrder = norm;
        void this.saveSettings();
        this.refreshViews();
    }

    /** 媒体库目录变更后刷新视图标签标题（setViewState 触发 Obsidian 重算 getDisplayText；homeTab 保持） */
    async refreshHomeTabTitles(): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
            const state = leaf.getViewState();
            await leaf.setViewState({ ...state }, { history: false });
        }
    }

    /** 解析封面地址：http URL 直用，本地路径映射到 vault 资源 */
    resolvePoster(e: MediaEntry): string | undefined {
        return this.resolvePosterUrl(e.poster);
    }

    /** 解析封面字符串（http URL 直用；本地相对路径拼 libraryDir 映射 vault 资源） */
    resolvePosterUrl(p: string | undefined): string | undefined {
        if (!p) return undefined;
        if (/^https?:\/\//.test(p)) return p;
        const full = normalizePath(`${this.settings.libraryDir}/${p}`);
        const f = this.app.vault.getAbstractFileByPath(full);
        if (f instanceof TFile) return this.app.vault.getResourcePath(f);
        return undefined;
    }

    /** 上传本地图片作封面：复制到 {libraryDir}/封面/，返回相对路径（如 封面/e_123.jpg）
     *  供表单拖入更换封面使用；图片类型校验失败抛错 */
    async uploadPoster(file: File): Promise<string> {
        if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件（拖入的必须是图片）');
        const extM = /\.(png|jpe?g|webp|gif|avif)$/i.exec(file.name);
        const ext = extM ? extM[1].toLowerCase() : file.type === 'image/png' ? 'png' : 'jpg';
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        const name = `e_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        const target = normalizePath(`${dir}/${name}`);
        const buf = await file.arrayBuffer();
        await this.app.vault.createBinary(target, buf);
        return `${DIR_COVERS}/${name}`;
    }

    /**
     * 附件清理（#349）：扫描**未被引用的附件** —— 封面目录 + 阅读进度目录，供清理弹窗逐项列出。
     * 判定全在纯模块 `pure/orphanAssets`（可单测）。本方法由原来的「只扫封面」扩为两类资产。
     * 🔴 目录内路径一律转**库内相对**（只去库目录前缀、保留 `封面/` `阅读进度/`），与 poster / 存档存储格式一致，
     *    否则清单里的路径拼不回 vault 全路径。（存档侧另按**文件名解析出的条目 id** 判孤儿。）
     */
    async listOrphanAssets(): Promise<OrphanAsset[]> {
        const entries = await this.service.list();
        const referencedPosters = entries.map((e) => e.poster).filter((p): p is string => !!p);
        const lib = normalizePath(this.settings.libraryDir || 'ReelLudic');
        const rel = (dir: string) =>
            this.app.vault
                .getFiles()
                .filter((f) => f.path.startsWith(dir + '/'))
                .map((f) => f.path.slice(lib.length + 1));
        return buildOrphanAssets({
            coverFiles: rel(normalizePath(`${lib}/${DIR_COVERS}`)),
            referencedPosters,
            storeFiles: rel(normalizePath(readerStoreDir(this.settings.libraryDir || 'ReelLudic'))),
            liveIds: entries.map((e) => e.id),
        });
    }

    /** 附件清理入口（#349）：扫描 → 弹窗逐项勾选清理。设置页与命令面板共用这一条路径。 */
    async openAssetCleanup(): Promise<void> {
        const assets = await this.listOrphanAssets();
        new AssetCleanupModal(this.app, assets, this.settings.libraryDir || 'ReelLudic').open();
    }

    /**
     * 关联媒体重命名入口：扫全库算计划 弹窗列「旧 新」→ 用户勾选后执行。
     *
     * 🔴 2026-11-13 用户指令（现行定稿）：设置页标题从「批量重命名」改成「关联媒体重命名」，
     *    规则模板换成**按类型分列的七套**（电影 / 剧集 / 动画 / 音乐 / 漫画 / 文学 / 网文，
     *    真源 `pure/batchRename.RENAME_TEMPLATE_GROUPS`），弹窗**只列关联的文件**、⛔ 不报跳过数量。
     *
     * 职责划分：规则全在 `pure/batchRename`（可单测到逐字符），本方法只做「取全库 → 交给弹窗」。
     * ⛔ 别在这里判定哪个文件能改 —— 那是 `runBatchRename` 拿 `TFile` 时才知道的事。
     */
    async openBatchRename(): Promise<void> {
        const entries = await this.service.list();
        const plans = planBatchRename(entries, {});
        new BatchRenameModal(this.app, plans, (picked) => this.runBatchRename(picked)).open();
    }

    /**
     * 执行改名（唯一碰文件系统的地方）。
     *
     * 🔴 三条不可省的顺序：
     *   ⑴ 先用 `vault.getAbstractFileByPath()` 拿到 `TFile` —— 拿不到说明是**库外绝对路径**
     *      （`scanEpisodeDir` 回填的那种），插件无权也不该改，计入失败。
     *   ⑵ `fileManager.renameFile()` —— ⛔ 不用 `adapter.rename`（前者会同步更新所有指向该文件的链接，
     *      后者只挪文件、链接全断）。
     *   **改名成功后立刻回写条目字段**（`episodeFiles` / `audioPath` / `bookFile`）—— 这一步漏了
     *      条目关联就指向不存在的旧路径，下次打开播放器直接「文件不见了」。
     *      ⚠️ `bookFile` 2026-11-13 补上的：七类规则里「文学 / 网文 / 漫画」都靠 `bookFile` 定位。
     *      漏回写会让电子书改名后立刻打不开（此前只有 `episodeFiles` / `audioPath` 两条回写分支）。
     */
    async runBatchRename(plans: readonly RenamePlan[]): Promise<{ renamed: number; failed: number }> {
        let renamed = 0;
        let failed = 0;
        for (const plan of plans) {
            const entry = (await this.service.list()).find((e) => e.id === plan.entryId);
            if (!entry) {
                failed += plan.renames.length;
                continue;
            }
            let touched = false;
            const episodes = Array.isArray(entry.episodeFiles) ? [...entry.episodeFiles] : undefined;
            let audio = entry.audioPath;
            let book = entry.bookFile;

            for (const item of plan.renames) {
                const abs = normalizePath(item.path);
                const file = this.app.vault.getAbstractFileByPath(abs);
                if (!(file instanceof TFile)) {
                    // 库外绝对路径 / 文件已被移走 跳过并计。
                    failed += 1;
                    console.warn(`[ReelLudic] 批量重命名跳过（不在库内）：${item.path}`);
                    continue;
                }
                const parent = abs.slice(0, abs.lastIndexOf('/'));
                const nextPath = normalizePath(parent ? `${parent}/${item.next}` : item.next);
                try {
                    await this.app.fileManager.renameFile(file, nextPath);
                    renamed += 1;
                    touched = true;
                    if (episodes) {
                        const at = episodes.indexOf(item.path);
                        if (at >= 0) episodes[at] = nextPath;
                    }
                    if (audio && audio === item.path) audio = nextPath;
                    // 文学 / 网文 / 漫画bookFile 026-11-13 补；漏了电子书改名后必然打不开。
                    if (book && book === item.path) book = nextPath;
                } catch (err) {
                    failed += 1;
                    console.warn(`[ReelLudic] 批量重命名失败：${item.path} → ${nextPath}`, err);
                }
            }

            if (!touched) continue;
            // 🔴 回写一定走 `service.update`（唯一收口），别直接改 catalog.json
            // ⚠️ 只把**真的有变*的字段放patch：`audioPath` / `bookFile` `!==` 比原值。
            //    否则「改的是2 集」也会把 `audioPath` 重写一遍（多一次无谓落+ 变动时间戳）。
            const patch: Partial<MediaEntry> = {};
            if (episodes) patch.episodeFiles = episodes;
            if (audio !== entry.audioPath) patch.audioPath = audio;
            if (book !== entry.bookFile) patch.bookFile = book;
            try {
                await this.service.update(entry.id, patch);
            } catch (err) {
                console.warn(`[ReelLudic] 重命名后回写条目失败：${entry.id}`, err);
            }
        }
        return { renamed, failed };
    }

    /**
     * 生成「条目笔记模板」（用户 2026-11-08：「给从笔记导入条目项加个『生成模板』按钮，
     * 可在仓库根目录生成笔记模板」）。
     *
     * 🔴 落盘位置是 `{libraryDir}/条目模板.md`，**不是** `{libraryDir}/笔记/` ——
     *    `openNoteImport` 只扫 `笔记/` 子树 ⇒ 模板文件在物理上就不可能被当成条目导进来。
     *    这是第二道保险，第一道是模板里的 `title: "{{标题}}"` 占位符（会被第二道闸拦下）。
     *
     * 🔴 已存在就**跳过**并提示路径（用户 2026-11-08 选型：「已存在就跳过，并提示路径」）：
     *    用户可能已经在模板里记了自己的填法，覆盖是纯粹的损失。
     *
     * 职责划分：文本生成全在 `pure/noteTemplate.buildNoteTemplate`（无 obsidian 依赖，可单测），
     * 本方法只负责「拼上下文 → 补父目录 → 写盘 → Notice」。
     */
    async writeNoteTemplate(): Promise<void> {
        const lib = this.settings.libraryDir || 'ReelLudic';
        const path = normalizePath(noteTemplatePath(lib));
        if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
            new Notice(`模板已存在，未覆盖：${path}\n（删掉它再生成，即为当前版本的字段口径）`, 9000);
            return;
        }
        try {
            const io = createVaultIO(this.app);
            const parent = path.slice(0, path.lastIndexOf('/'));
            if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) {
                await this.app.vault.createFolder(parent);
            }
            const md = buildNoteTemplate({ libraryDir: lib, pluginVersion: this.manifest.version });
            await io.writeText(path, md);
            new Notice(`已生成条目笔记模板：${path}\n照着复制对应类型的区块到 ${lib}/笔记/ 下即可。`, 9000);
        } catch (err) {
            new Notice(`生成模板失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * 🔴 2026-11-08 用户指令：「是手写的条目在海报墙上展示无法出现，但笔记文件存在是怎么回事，
     *    有没有再加个检索库内笔记文件生成条目的项在基本设置下」
     *
     * 为什么需要它：海报墙的数据源**只有** `catalog.json`（`service.list()`），插件**没有任何**
     * 反向扫描能力 —— 手工写的笔记文件不写进 catalog 就永远不会出现在海报墙上。
     * 本方法是那条缺失通路的唯一入口：扫 `${libraryDir}/笔记/` → 弹窗勾选 → 落 catalog → 回写 id。
     *
     * 职责划分（与 `openPosterMigrate` 同架构）：本方法只负责**扫库 + 落库 + 写回**，
     * 判据全在 `pure/noteImport.scanImportableNotes` 里，选哪几条归弹窗。
     * ⛔ 弹窗不自己扫库、这里不自己判断勾选 —— 两边各写一份候选口径必然分叉。
     *
     * ⚠️ 扫描范围**只收 `{libraryDir}/笔记/` 之下**（用户裁定），⛔ 别扩到全库：
     *    用户库里还有豆瓣模板、项目文档、140 篇 `musicCN` —— 全库扫描会把模板当条目导进来。
     */
    async openNoteImport(): Promise<void> {
        if (this.isImportingNotes) {
            new Notice('笔记导入正在进行中…');
            return;
        }
        this.showNoteImportGuide();
    }

    /**
     * 引导弹窗（用户 2026-11-17 ⑥：「导入按钮要弹引导弹窗说明笔记需满足什么条件，
     * 不能只提示『没有可导入的笔记』」）。
     *
     * 🔴 为什么先讲条件再扫：导入是单向动作（落 catalog + 把 id 写回笔记），
     *    点下去才发现「一篇都不合格」的体验等价于功能坏了。条件清单的唯一真源在
     *    `modals/NoteImportGuideModal.noteImportRequirements`（从 `ENTRY_TYPES` 派生，⛔ 不在这里抄一份）。
     *
     * @param lastScan 上一轮零结果的摘要 ⇒ 同一个弹窗就地解释「为什么全被拒」，
     *                 而不是关掉弹窗再丢一条 Notice（旧行为，正是本次报障的观感来源）
     */
    private showNoteImportGuide(lastScan?: NoteImportGuideScan): void {
        const lib = this.settings.libraryDir || 'ReelLudic';
        const folder = baseNotesFolder(lib);
        new NoteImportGuideModal(this.app, {
            notesDir: folder,
            templatePath: noteTemplatePath(lib),
            lastScan,
            onProceed: () => { void this.runNoteImport(); },
            onTemplate: () => { void this.writeNoteTemplate(); },
        }).open();
    }

    /**
     * 真正的扫描与导入（`openNoteImport` 与引导弹窗的「扫描笔记」都走这里）。
     * 🔴 零结果**不再**只丢一句 Notice —— 回填 `lastScan` 重开引导弹窗，把篇数与跳过原因摆出来。
     */
    private async runNoteImport(): Promise<void> {
        if (this.isImportingNotes) {
            new Notice('笔记导入正在进行中…');
            return;
        }
        const lib = this.settings.libraryDir || 'ReelLudic';
        const folder = baseNotesFolder(lib);
        const mdFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${folder}/`));
        if (mdFiles.length === 0) {
            // 目录里一个 .md 都没有：同样回引导弹窗（那里会说明目录 + 给「生成模板」出口）
            this.showNoteImportGuide({ scanned: 0, skipped: [] });
            return;
        }

        const entries = await this.service.list();
        // 🔴 逐个读出正文：`scanImportableNotes` 是纯函数（文件内容由调用方提供）。
        //    别为了「少读几个文件」把 frontmatter 解析搬进宿主 那样判据又变成两。
        const files: { path: string; text: string }[] = [];
        for (const f of mdFiles) {
            try {
                files.push({ path: f.path, text: await this.app.vault.cachedRead(f) });
            } catch {
                // 单个文件读失败（权限 / 正在被同步占用）不该让整个扫描停。
            }
        }

        const { candidates, skipped } = scanImportableNotes({ files, entries, notesDir: folder });
        if (candidates.length === 0) {
            // 🔴 零候选：回引导弹窗并带上「读了几篇 / 谁被跳过、为什么」。
            //    旧实现这里只有 `Notice('没有可导入的笔记')` —— 用户既不知道扫了几篇、
            //    也不知道自己那篇为什么不算，观感等同于功能坏了（用户 2026-11-17 报障）。
            this.showNoteImportGuide({ scanned: files.length, skipped });
            return;
        }
        new NoteImportModal(this.app, candidates, skipped, (paths) => {
            void this.importNotesToEntries(paths, candidates, lib);
        }).open();
    }

    /**
     * 把勾选的笔记落成条目（`openNoteImport` 的回调出口）。
     *
     * 🔴 顺序不能反：**先落 catalog 再回写笔记 id**。
     *    反过来的话，回写完 id 却落库失败（比如 catalog 写盘被占用），笔记里就留下了一个
     *    catalog 里不存在的 id —— 下次扫描会被 `byId` 当成「已存在」静默跳过，条目永久丢失。
     *    现在这个顺序下最坏情况只是「笔记没有 id 行」，下次扫描会再列出来，可重试。
     */
    async importNotesToEntries(
        paths: readonly string[],
        candidates: readonly NoteImportCandidate[],
        libraryDir: string,
    ): Promise<void> {
        const byPath = new Map(candidates.map((c) => [c.path, c]));
        this.isImportingNotes = true;
        let ok = 0;
        const failed: string[] = [];
        try {
            for (const p of paths) {
                const cand = byPath.get(p);
                if (!cand) continue; // 弹窗给的 path 不在候选里 —— 跳过而不是猜
                try {
                    // 🔴 2026-11-08 修复：`posterFromBanner` 此前**从未被调*（函数写对了没人用）。
                    //    banner 存的是「库内完整路径」如 `媒体封面/x.jpg`，`resolvePosterUrl`
                    //    会再拼一`libraryDir` 变成 `媒体媒体封面/x.jpg` 文件不存封面空白。
                    //    落库前必须剥掉库目录前缀（http(s) 原样返回，前缀对不上也原样返回，不猜）。
                    const banner = cand.draft.poster;
                    const poster = banner ? posterFromBanner(banner, libraryDir) : undefined;
                    // catalog：id 有就用笔记里的，没有交给 normalizeEntry 生成。
                    const created = await this.service.create({
                        ...cand.draft,
                        poster,
                        id: cand.id || undefined,
                        type: cand.type,
                        title: cand.title,
                        // 🔴 notePath 必须写：这是「这条条目对应哪篇笔记」的唯一真源，
                        //    也是下次扫描的 `usedPaths` 去重判据（⛔ 漏写会导致每次扫描都重复列出）
                        notePath: p,
                        createdAt: new Date().toISOString(),
                    });
                    // 回写 id 到笔frontmatter（用户裁定「写回」）
                    const file = this.app.vault.getAbstractFileByPath(p);
                    if (file instanceof TFile) {
                        const text = await this.app.vault.read(file);
                        const next = writeIdIntoNote(text, created.id, created.type, created.title);
                        if (next !== text) await this.app.vault.modify(file, next);
                    }
                    ok++;
                } catch (e) {
                    failed.push(`${cand.title}：${e instanceof Error ? e.message : String(e)}`);
                }
            }
        } finally {
            this.isImportingNotes = false;
        }
        if (failed.length === 0) {
            new Notice(`已导入 ${ok} 个条目`);
        } else {
            new Notice(`已导入 ${ok} 个，失败 ${failed.length} 个：${failed.slice(0, 3).join('、')}`);
        }
        // 海报/ 各视图都缓存了条目列不重画就「导了但看不见」，用户会以为没生效。
        await this.refreshViews();
    }

    /**
     * 🔴 2026-10-25 用户指令：「点击一键迁移先弹窗列出当前可以迁移的封面条目出来然后用户勾选再迁移，默认全选」
     *
     * 职责划分：本方法只负责**扫候选 + 串流程**（扫库口径唯一），选哪几条归弹窗（纯表现层）。
     * ⛔ 弹窗不自己扫库、这里不自己判断勾选 —— 两边各写一份候选口径必然分叉。
     * ⚠️ 候选判据与 `localizeAllPosters` 内部那条**必须同源**：都是「有 poster 且是 http(s)」，
     *    否则弹窗列出了 50 条、实际能迁 48 条，用户勾了却不动的两条会被当成故障。
     */
    async openPosterMigrate(): Promise<void> {
        if (this.isMigratingPosters) {
            new Notice('封面迁移正在进行中…');
            return;
        }
        const entries = await this.service.list();
        const candidates: PosterMigrateCandidate[] = entries
            .filter((e) => !!e.poster && /^https?:\/\//.test(e.poster))
            .map((e) => ({ id: e.id, title: e.title, poster: e.poster ?? '' }));
        if (candidates.length === 0) {
            new Notice('没有待迁移的封面（当前没有使用网络封面的条目）');
            return;
        }
        new PosterMigratePickModal(this.app, candidates, (ids) => {
            // 进度与结果都归 `PosterMigrateProgressModal`（`finish()` 自己展示结果，
            // ⛔ 别再弹 `PosterMigrateModal`，否则一次迁移会连开两个弹窗）。
            //
            // 🔴 用户 m01938「切到别的笔记去工作」：弹窗被关掉时任务**照常继续**。
            //    进度接管到悬浮球—否则用户关掉弹窗就等于「不知道还在不在跑」
            //    只能干等或者以为失败了。（球挂 body，跨笔记存活。）
            let ball: ReturnType<typeof startProgressBall> | null = null;
            let lastPct: number | null = null;
            let lastLabel = '正在下载封面';
            const modal = new PosterMigrateProgressModal(this.app, () => {
                if (modal.closedByUser && !ball) {
                    ball = startProgressBall(lastLabel);
                    ball.update({ percent: lastPct, detail: `封面迁移中` });
                }
            });
            modal.open();
            void this.localizeAllPosters((done, total, step) => {
                modal.setProgress(done, total, step);
                // 同步给球（球可能还没起；这些值就是它接管时的起点。
                lastPct = total > 0 ? Math.round((done / total) * 100) : null;
                lastLabel = step ? `正在处理《${step.title}》` : "正在下载封面";
                ball?.update({ label: lastLabel, percent: lastPct });
            }, ids)
                .then((result) => {
                    modal.finish(result);
                    if (ball) {
                        // 已经关窗在看球负责报结果，弹窗那finish 只更新了它自己的（已关闭的）DOM
                        ball.done(`成功 ${result.success} 个`);
                        ball = null;
                    }
                })
                .catch((e) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    modal.fail(msg);
                    if (ball) {
                        ball.fail(msg);
                        ball = null;
                    }
                });
        }).open();
    }

    /** 下载 URL 图片为 ArrayBuffer：豆瓣图床（doubanio.com）防盗链要求 Referer 为 douban.com，
     *  桌面端用 Node 传输层 + 显式 Referer 下载；其余图床无严格防盗链，沿用 requestUrl。 */
    private async fetchImageBuffer(url: string, referer?: string): Promise<ArrayBuffer> {
        if (/doubanio\.com/.test(url) && Platform.isDesktopApp) {
            const res = await nodeHttpGetBuffer(url, {
                Referer: 'https://www.douban.com/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            });
            if (res.status !== 200) throw new Error(`豆瓣封面下载失败（HTTP ${res.status}）`);
            const b = res.buffer;
            return this.toArrayBuffer(b);
        }
        /**
         * #498：**搜索结果里的图**（来自各家图站）改用 Node 通道 + **来源站自己的 `Referer`**。
         * 🔴 为什么不能只靠下面那条 `requestUrl`：这类站多数按 Referer 防盗链，
         *    而 `requestUrl` 送不出「看起来像从那个站点的网页上点的」请求 ⇒ 常见 403。
         * ⚠️ 只带**来源站自己**的 Referer（`posterReferer` 从来源页取 origin），⛔ 别带 bing 的（对方认得出来）。
         * ⚠️ 失败**回落到 `requestUrl`**（与既有本地化同一条路）：两条都试才不至于「换个源就下不动」。
         */
        let firstErr = '';
        if (referer && Platform.isDesktopApp) {
            try {
                const res = await nodeHttpGetBuffer(url, {
                    Referer: referer,
                    'User-Agent': POSTER_UA,
                    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                });
                if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
                return this.toArrayBuffer(res.buffer);
            } catch (e) {
                firstErr = e instanceof Error ? e.message : String(e);
            }
        }
        const res = await requestUrl({ url, method: 'GET', responseType: 'arraybuffer' } as unknown as Parameters<typeof requestUrl>[0]);
        if (res.status !== 200) {
            throw new Error(firstErr ? `${firstErr}；备用通道也失败：HTTP ${res.status}` : `HTTP ${res.status}`);
        }
        return (res as unknown as { arrayBuffer: ArrayBuffer }).arrayBuffer;
    }

    /**
     * 下载 URL 图片到 封面/ 目录（命名 封面/{标题}.jpg，同标题重名追加 -2/-3 防覆盖），返回相对路径。
     * `referer`（#498，append-only 可选参）= 下载源站图片时带的来源页 —— 见 `fetchImageBuffer` 的说明。
     */
    async downloadPosterToLocal(url: string, title: string, referer?: string): Promise<string> {
        const base = sanitizePosterTitle(title) || 'poster';
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        let target = `${DIR_COVERS}/${base}.jpg`;
        let full = normalizePath(`${this.settings.libraryDir}/${target}`);
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(full) instanceof TFile) {
            target = `${DIR_COVERS}/${base}-${n}.jpg`;
            full = normalizePath(`${this.settings.libraryDir}/${target}`);
            n++;
        }
        const buf = await this.fetchImageBuffer(url, referer);
        await this.app.vault.createBinary(full, buf);
        return target;
    }

    /**
     * #498 封面图片搜索（仅桌面端：走 `nodeHttpGet`，与其它反爬链路同一个网络栈）。
     * 用户原话：「再添加在所有编辑条目的封面右键加个从网络上搜索下载封面图片的功能」。
     * 🔴 平台门控在**这一层**（`searchPosterImages` 本身不判平台）—— 与 `searchOnlineLyrics` 同口径。
     */
    async searchPosterCandidates(
        query: string,
        page: number,
    ): Promise<{ candidates: PosterCandidate[]; error?: string }> {
        if (!Platform.isDesktopApp) return { candidates: [], error: '仅桌面端支持' };
        return searchPosterImages(
            { get: (url: string, headers?: Record<string, string>) => nodeHttpGet(url, headers) },
            query,
            page,        );
    }

    /**
     * #509 **按来源搜封面**（用户：「继续增强获取音乐类型条目封面的能力，网络搜索 / 四大音乐平台搜索封面」）。
     *
     * · `bing`（默认）= 既有的图片搜索（#498，全类型可用）；
     * · 四个音乐平台 = 走**既有的四平台搜索链**（`dlSearchSongs`，与「下载歌曲」窗口同一个函数，
     *   ⛔ 不另写请求），把结果里的封面按 `pure/posterSources` 的**实测规则**换成大图。
     *   - 网易云：搜索响应**不带封面** ⇒ 补一次 `song/detail`（`neteaseCoversByIds`，免 Cookie 实测可用）；
     *   - 酷我：用**专辑图**字段（`coverUrl` 那张是 MV 横图，用了会得到一张压扁的横图）。
     * 🔴 平台门控与必应那条**同口径**（仅桌面端）。
     * 🔴 **空结果不算失败**：平台搜到 0 条 ⇒ `{ candidates: [] }` 不带 `error`（由界面说「没搜到」）。
     */
    async searchPosterCandidatesBySource(
        source: PosterSource,
        query: string,
        page: number,
    ): Promise<{ candidates: PosterCandidate[]; error?: string }> {
        if (!Platform.isDesktopApp) return { candidates: [], error: '仅桌面端支持' };
        if (source === 'bing') return this.searchPosterCandidates(query, page);
        const q = String(query ?? '').trim();
        if (!q) return { candidates: [], error: '先填搜索词（默认用条目标题 + 作者，可以改）' };
        try {
            // 与「下载歌曲」窗口**同一个搜索函数**（平台顺序、去重、VIP 标注口径都一致）
            const { songs } = await this.dlSearchSongs(q);
            const mine = songs.filter((s) => s.source === source);
            if (!mine.length) return { candidates: [] };
            if (source === 'netease') {
                // 🔴 网易云搜索不给封面 ⇒ 补一跳详情（失败只让这条路为空，⛔ 不报错）
                const covers = await neteaseCoversByIds(this.dlTransport(), mine.map((s) => s.neteaseId));
                return {
                    candidates: platformCandidates(
                        'netease',
                        mine.map((s) => ({
                            name: s.name,
                            artist: s.artist,
                            album: s.album,
                            coverUrl: covers.get(Number(s.neteaseId)) ?? '',
                            pageUrl: s.webUrl,
                        })),
                    ),
                };
            }
            return { candidates: platformCandidates(source, mine) };
        } catch (e) {
            return { candidates: [], error: `平台搜索失败：${e instanceof Error ? e.message : String(e)}${e instanceof Error ? e.message : String(e)}` };
        }
    }

    /**
     * #498 把搜到的封面下载并本地化到 `封面/`（与既有封面本地化**同一条**命名 / 重名去重口径）。
     * 🔴 带**来源站自己**的 `Referer`（`pure/posterSearch.posterReferer` 从来源页取 origin）——
     *    这类图站多数按 Referer 防盗链，不带就常见 403（`fetchImageBuffer` 里有回落说明）。
     * ⚠️ 失败只回 `${ok:false, message}`，**由候选弹窗就地显示**，⛔ 不在这里弹 Notice
     *    （用户正在挑图，弹窗被打断反而更烦；而且这条链路失败是常态：图挂了 / 站挂了）。
     */
    async downloadSearchedPoster(
        candidate: PosterCandidate,
        title: string,
    ): Promise<{ ok: boolean; message: string; path?: string }> {
        const url = String(candidate?.murl ?? '').trim();
        if (!url) return { ok: false, message: '这张没有原图地址，换一张试试' };
        try {
            const path = await this.downloadPosterToLocal(url, title, posterReferer(candidate.page));
            return { ok: true, message: '封面已下载并设为封面', path };
        } catch (e) {
            return { ok: false, message: `这张下载失败：${e instanceof Error ? e.message : String(e)}（换一张试试）${e instanceof Error ? e.message : String(e)}（换一张试试）` };
        }
    }

    /** 单条目封面本地化：URL 封面下载到 封面/{标题}.jpg → poster 改相对路径；成功返回 {entry}，失败返回 {error}（原因供结果弹窗展示） */
    async localizeEntryPoster(id: string): Promise<{ entry?: MediaEntry; error?: string }> {
        const e = await this.service.get(id);
        if (!e || !e.poster || !/^https?:\/\//.test(e.poster)) return { entry: e };
        try {
            const target = await this.downloadPosterToLocal(e.poster, e.title);
            return { entry: await this.service.update(id, { poster: target }) };
        } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }; // 下载失败：原因供结果弹窗排查
        }
    }

    /** 存量封面全量迁移进行中标志（防重复点击并发迁移；按钮保持可点击，重复点击给提示） */
    isMigratingPosters = false;

    /**
     * 最近一次 YouTube 取流失败的中文原因（`null` = 上次成功或还没试过）。
     *
     * 🔴 为什么留这个字段而不是直接弹 Notice：取流是**静默失败**的
     * （`ytStreamFor` 返回 null，视图层只显示「这集没有可播放的视频」）。
     * 用户看到那句等于没给任何线索 —— 到底是没装 yt-dlp、要登录、还是代理不通？
     * 留一手给宿主在提示里拼上真实原因，也方便排障时读。
     */
    lastYtError: string | null = null;

    /**
     * 最近一次 **B 站** 取流失败的中文原因（`null` = 上次成功或还没试过）。
     *
     * 🔴 与 `lastYtError` 同一条理由，但 B 站这边更糟：`biliStreamFor` 原来有六处
     * `return null`（非桌面端 / 解析不出片号 / 拿不到 cid / HTTP 非 200 / JSON 坏 /
     * `pickBiliStream` 空 / 裸 catch），**一处都不留话**。调用方看到 null 只能
     * `openExternalUrl(url)` 把用户踢去浏览器 —— 用户视角就是「点了播放，然后浏览器开了，
     * 插件里什么都没有」，完全不知道是稿子没了还是插件坏了（用户 m02763 报障原话：
     * 「网络集用插件播放器加载不出来」）。
     * 真机实测两条报障条目（2026-11-15）直查 `x/web-interface/view` 均回
     * `code=62002 msg="稿件不可见"` —— 稿子被删/私享/地区限制，取流失败是**正确行为**，
     * 错的是失败后不解释。⇒ 每次取流先清空、失败时写原因，让宿主能如实说清。
     */
    lastBiliError: string | null = null;

    /** 笔记导入进行中标志（同上：防并发；重复点击给提示而不是并排跑两份） */
    isImportingNotes = false;

    /**
     * 存量封面全量迁移：遍历 URL 封面逐个下载（限速 300ms/张、失败跳过），onProgress 实时回调进度，
     * 结束返回结果摘要（含失败原因与总数）。
     *
     * 🔴 2026-10-19 用户指令（设置页 UX 改版 ⑤-3）：进度不再画在设置页里的 `.rl-mig-prog` 进度条上，
     *    改由 `PosterMigrateProgressModal` 弹窗展示 ⇒ 回调追加第 3 参数 `step`：
     *    **当前处理条目**的标题 / 原网络地址 / 目标本地相对路径（弹窗里显示「正在处理哪一条、从哪搬到哪」）。
     *    ⚠️ 失败时 `to` 为空串：目标是 `downloadPosterToLocal` 内部才定的（重名会加后缀），
     *       没下载成功就没有可信的目标路径 —— 宁可留空，⛔ 别在这里猜一个。
     */
    async localizeAllPosters(
        onProgress?: (done: number, total: number, step?: { title: string; from: string; to: string }) => void,
        /**
         * 🔴 2026-10-25 用户指令：「点击"一键迁移"先弹窗列出当前可以迁移的封面条目出来然后用户勾选再迁移，默认全选」。
         * `ids` 给定时**只迁移这些条目**（用户在勾选弹窗里选的那批）；不传 = 全量（旧行为，保留给内部调用）。
         * ⚠️ 少了这个参数就没法「只迁勾选的」——弹窗选完再传进来，⛔ 不要在这里重算候选集，
         *    那会和弹窗里列出来的那张表不一致（用户勾了 A，实际迁了 A+B，等于骗人）。
         */
        ids?: readonly string[],
    ): Promise<{ success: number; fail: number; failures: { title: string; reason: string }[]; skipped: boolean; total: number }> {
        if (this.isMigratingPosters) return { success: 0, fail: 0, failures: [], skipped: true, total: 0 };
        this.isMigratingPosters = true;
        try {
            const entries = await this.service.list();
            // 候选集 = 有网络封面的条目；给了 `ids` 再按用户勾选收窄
            const wanted = ids ? new Set(ids) : null;
            const urls = entries.filter(
                (e) => e.poster && /^https?:\/\//.test(e.poster) && (!wanted || wanted.has(e.id)),
            );
            const total = urls.length;
            let done = 0;
            let ok = 0;
            const failures: { title: string; reason: string }[] = [];
            for (const e of urls) {
                const from = e.poster ?? '';
                const r = await this.localizeEntryPoster(e.id);
                const local = r.entry?.poster && !/^https?:\/\//.test(r.entry.poster) ? r.entry.poster : '';
                if (local) ok++;
                else failures.push({ title: e.title, reason: r.error ?? '未知错误' });
                done++;
                onProgress?.(done, total, { title: e.title, from, to: local });
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            await this.refreshViews();
            return { success: ok, fail: failures.length, failures, skipped: false, total };
        } finally {
            this.isMigratingPosters = false;
        }
    }

    /** 存量封面高清化进行中标志（防重复点击并发迁移；与 isMigratingPosters 独立） */
    isUpgradingPosters = false;

    /** 存量豆瓣本地封面高清化（2026-09-09 用户反馈：游戏封面糊——搜索级 spic/s_ratio_poster 缩略档落库 70~100px）：
     *  遍历豆瓣源且 poster 已本地化的条目，读本地文件测宽 < 200px 判为模糊 → 回源豆瓣详情（fetchDetail，
     *  详情封面 URL 经 upscaleDoubanCover 高清化 + og:image 兜底）取高清封面 → 下载覆盖同名文件。
     * 存量封面全量迁移：遍历 URL 封面逐个下载（限速 300ms/张、失败跳过），onProgress 实时回调进度，
     *  返回 { scanned, upgraded, fail, failures }（skipped=true 表示已有迁移在跑）。 */
    async upgradeBlurredPosters(onProgress?: (done: number, total: number) => void): Promise<{ scanned: number; upgraded: number; fail: number; failures: { title: string; reason: string }[]; skipped: boolean }> {
        if (this.isUpgradingPosters) return { scanned: 0, upgraded: 0, fail: 0, failures: [], skipped: true };
        this.isUpgradingPosters = true;
        try {
            const entries = await this.service.list();
            const coverDir = normalizePath(`${this.settings.libraryDir}/${DIR_COVERS}`);
            // 扫描阶段收敛窄化：仅保留「豆瓣源 + poster 本地化 + 文件实测宽 <200px + 详情页链接」的候选，
            // 携带回源所需的全部字段，避免第二轮循环丢失 poster/sourceUrl 的窄化信息
            const candidates: { id: string; title: string; type: EntryType; sourceUrl: string; full: string }[] = [];
            for (const e of entries) {
                // 仅豆瓣源 + poster 本地化（封面/x.jpg）+ 有豆瓣详情页链接（回源依据）
                if (e.source !== 'douban' || !e.poster || /^https?:/.test(e.poster) || !e.sourceUrl) continue;
                const posterFile = e.poster.split('/').pop();
                if (!posterFile) continue;
                const full = normalizePath(`${coverDir}/${posterFile}`);
                const f = this.app.vault.getAbstractFileByPath(full);
                if (!(f instanceof TFile)) continue;
                try {
                    const bytes = await this.app.vault.readBinary(f);
                    const size = imageSizeFromBytes(bytes);
                    if (!size || size.width >= 200) continue; // 已高清/非图片跳过
                } catch { continue; }
                candidates.push({ id: e.id, title: e.title, type: e.type, sourceUrl: e.sourceUrl, full });
            }
            const total = candidates.length;
            let done = 0;
            let ok = 0;
            const failures: { title: string; reason: string }[] = [];
            for (const c of candidates) {
                const { title, type, sourceUrl, full } = c;
                try {
                    // sourceUrl 例：https://www.douban.com/game/26840375/、https://movie.douban.com/subject/1292052/
                    const idM = /(?:subject|game)\/(\d+)\/?$/.exec(sourceUrl);
                    if (!idM) throw new Error('详情页链接缺条目 ID');
                    const fields = await this.fetchDoubanDetailForEntry(idM[1], type);
                    const hd = fields?.cover as string | undefined;
                    if (!hd || !/^https?:\/\//.test(hd)) throw new Error('详情无网络封面（可能被反爬）');
                    const buf = await this.fetchImageBuffer(hd);
                    const f = this.app.vault.getAbstractFileByPath(full);
                    if (!(f instanceof TFile)) throw new Error('本地封面文件不存在');
                    await this.app.vault.modifyBinary(f, buf); // 覆盖写同名文件（poster 字段不变）
                    ok++;
                } catch (err) {
                    failures.push({ title, reason: err instanceof Error ? err.message : String(err) });
                }
                done++;
                onProgress?.(done, total);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            await this.refreshViews();
            return { scanned: total, upgraded: ok, fail: failures.length, failures, skipped: false };
        } finally {
            this.isUpgradingPosters = false;
        }
    }

    // ── v0.3 M4 数据管理：导出/恢复/CSV 导入 + 批量评分/标签 ──

    /** 导出 catalog JSON 快照到 {libraryDir}/备份/catalog-时间戳.json */
    async exportCatalogBackup(): Promise<void> {
        const entries = await this.service.list();
        const snapshot = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
        const dir = normalizePath(`${this.settings.libraryDir}/${DIR_BACKUPS}`);
        if (!(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
            await this.app.vault.createFolder(dir);
        }
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const path = normalizePath(`${dir}/catalog-${ts}.json`);
        await createVaultIO(this.app).writeText(path, snapshot);
        new Notice(`已导出备份：catalog-${ts}.json（${entries.length} 条）`);
    }

    /**
     * 生成 / 覆盖 Obsidian Bases 视图模板 `{libraryDir}/ReelLudic.base`（设置页按钮）。
     *
     * 🔴 三条设计口径：
     *   ① **只写这一个文件**，不碰 `catalog.json`、不碰任何笔记 —— 它是纯读侧产物，删了随便重生成；
     *   ② 已存在时**覆盖**（用户点按钮就是要拿到最新模板；内容纯文本，改过的版本在 Git/历史里，且模板头写着「可自由修改」）；
     *   ③ 写失败（只读库 / 权限不足）**必须报错告诉用户**，⛔ 别静默吞掉 —— 静默失败在这里等于「点了没反应」。
     */
    async generateBaseTemplate(): Promise<void> {
        const path = normalizePath(baseTemplatePath(this.settings.libraryDir));
        try {
            const yaml = buildBaseTemplate({
                libraryDir: this.settings.libraryDir,
                pluginVersion: this.manifest.version,
                // 🔴 卡片密度跟随插件设置（紧凑 150 / 标准 180 / 宽松 220）：
                //    Bases 与插件的海报墙共用同一档观感；不传就会一律按「标准」写死，
                //    用户把插件调成紧凑后再生成，两个界面就又对不上了。
                posterDensity: this.settings.posterDensity,
                posterColumns: this.settings.posterColumns,
                // 🔴 #690：库里到底有没有 communityScore（`大众评分` 两档排序要不要生成）。
                //    是**扫描**得出的结论，不是写死 true —— 见 detectCommunityScore()。
                hasCommunityScore: await this.detectCommunityScore(),
            });
            const io = createVaultIO(this.app);
            // 父目录（{libraryDir}）可能还不存在（全新库、还没建过任何条目）⇒ 先补齐再写
            const parent = path.slice(0, path.lastIndexOf('/'));
            if (parent && !(this.app.vault.getAbstractFileByPath(parent) instanceof TFolder)) {
                await this.app.vault.createFolder(parent);
            }
            await io.writeText(path, yaml);
            // 🔴 #690：文件名跟着媒体库目录名走 ⇒ 老版本写死的 `ReelLudic.base` 会变成一份**残留副本**。
            //    这里只在「旧文件名 ≠ 新文件名」且旧文件确实存在时**提示**用户删掉它（⛔ 不自动删：那是用户 vault 里的文件）。
            let legacyNote = '';
            if (baseTemplateFile(this.settings.libraryDir) !== BASE_TEMPLATE_FILE_LEGACY) {
                const legacyPath = normalizePath(baseTemplatePath(this.settings.libraryDir).replace(/[^/]+$/, BASE_TEMPLATE_FILE_LEGACY));
                if (this.app.vault.getAbstractFileByPath(legacyPath) instanceof TFile) {
                    legacyNote = `\n⚠️ 旧的 ${legacyPath} 已不再使用，可以手动删除（否则会看到两份模板）。`;
                }
            }
            // 配套 CSS 片段：必须进 .obsidian/snippets/ 才会被 Obsidian 收进「外观 › CSS 代码片段」。
            // 🔴 旧实现是「文件存在就跳过」⇒ 片段里那条 `.bases-view` 错选择器永远修不到老用户，
            //    用户报的「css 不生效没有悬停动效」正是撞在这上面。
            // 现在走 `pure/snippetMerge`：**只替换托管区**，标记之外的用户定制原样保留；
            // 老文件（无标记）不覆盖，只在后面追加新的托管区。
            let snippetNote = '';
            try {
                const snippetPath = normalizePath(baseSnippetPath());
                const existing = this.app.vault.getAbstractFileByPath(snippetPath) instanceof TFile
                    ? await io.readText(snippetPath)
                    : undefined;
                const merged = mergeSnippet(existing, BASE_SNIPPET_CSS);
                if (merged.changed) await io.writeText(snippetPath, merged.content);
                snippetNote = snippetNotice(snippetPath, merged);
            } catch (err) {
                // ⛔ 样式是锦上添花，写不进去不能让整个「生成模板」失败
                snippetNote = `\n⚠️ 样式片段写入失败：${err instanceof Error ? err.message : String(err)}`;
            }
            new Notice(`已生成 Bases 视图模板：${path}\n打开它即可用 Obsidian 原生 Bases 浏览收藏库。${snippetNote}${legacyNote}`, 12000);
        } catch (err) {
            new Notice(`生成 Bases 模板失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * 库里**条目笔记**是否真的带 `communityScore` 这个 frontmatter 键（#690）。
     *
     * 🔴 为什么要探测而不是写死：`data/noteGenerator.entryFrontmatter` 目前**不写**这个键
     *    （它只在正文的「大众评分」表格行里出现）。写死 true 会生成两档切到全是空行的排序，
     *    用户只会以为「同步没进来」，比没有更糟。
     * ⚠️ 只看 `{libraryDir}/笔记/<类型>/` 下的 `.md`；最多扫 `limit` 篇，够判断即可（⛔ 别把整个库读完）。
     */
    async detectCommunityScore(limit = 200): Promise<boolean> {
        try {
            const folder = baseNotesFolder(this.settings.libraryDir);
            const files = this.app.vault.getMarkdownFiles()
                .filter((f) => f.path.startsWith(`${folder}/`))
                .slice(0, limit);
            for (const f of files) {
                const text = await this.app.vault.cachedRead(f);
                // 只认**行首**的 `communityScore:`（正文表格里的是 `| 大众评分 | 8.1 |`，不会命中）
                if (/^communityScore:/m.test(text)) return true;
            }
            return false;
        } catch {
            // 探测失败 = 当作没有（少两档排序不影响主功能，⛔ 别让它把整个生成流程带崩）
            return false;
        }
    }

    /** 生成模板并立刻打开它（设置页按钮：让用户**看见**结果，而不是只收到一句 Notice） */
    async generateAndOpenBaseTemplate(): Promise<void> {
        await this.generateBaseTemplate();
        const path = normalizePath(baseTemplatePath(this.settings.libraryDir));
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf(true).openFile(file);
        }
    }

    /** 从备份 JSON 恢复（vault 内文件版）：读文本 → 走共用解析核心 */
    async restoreFromBackup(path: string): Promise<void> {
        try {
            const text = await createVaultIO(this.app).readText(path);
            await this.restoreFromBackupText(text);
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 备份文本解析导入（vault 与系统文件共用核心）：合并去重（按 title+type，不覆盖已有条目） */
    async restoreFromBackupText(text: string): Promise<void> {
        try {
            const raw = JSON.parse(text) as unknown;
            const arr: unknown[] = Array.isArray(raw) ? raw : Array.isArray((raw as { entries?: unknown[] }).entries) ? (raw as { entries: unknown[] }).entries : [];
            let added = 0;
            let skipped = 0;
            const existing = await this.service.list();
            for (const item of arr) {
                if (typeof item !== 'object' || item === null) {
                    skipped++;
                    continue;
                }
                const it = item as Record<string, unknown>;
                const title = typeof it.title === 'string' ? it.title : '';
                const type = ENTRY_TYPES.includes(it.type as EntryType) ? (it.type as EntryType) : null;
                if (!title || !type) {
                    skipped++;
                    continue;
                }
                if (existing.some((x) => x.title === title && x.type === type)) {
                    skipped++;
                    continue;
                }
                await this.service.create(it as Partial<MediaEntry>);
                added++;
            }
            new Notice(`备份恢复完成：新增 ${added}，跳过 ${skipped}（重复/无效）`);
            await this.refreshViews();
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /** 设置页按钮：弹出 vault 内 .json 文件选择 → 恢复 */
    openBackupPicker(): void {
        const files = this.app.vault.getFiles().filter((f) => f.extension === 'json');
        new VaultFileSuggest(this.app, files, (f) => void this.restoreFromBackup(f.path), '选择备份 JSON 文件…').open();
    }

    // ── v0.4 持续优化：系统文件对话框（Electron remote dialog + fs，Obsidian 社区成熟方案）──

    /** 探测系统文件对话框是否可用（Obsidian 渲染进程 require('electron').remote.dialog；旧版 File System Access API 在部分环境不可用会静默失败） */
    private hasSystemDialog(): boolean {
        try {
            const g = globalThis as unknown as { require?: (id: string) => unknown };
            const electron = g.require?.('electron') as { remote?: { dialog?: unknown } } | undefined;
            return !!electron?.remote?.dialog;
        } catch {
            return false;
        }
    }

    /** 系统「另存为」对话框：选择任意系统路径并写入文本；取消/失败返回 undefined（失败时 Notice 提示，不静默） */
    private async saveTextToSystem(defaultName: string, content: string): Promise<string | undefined> {
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showSaveDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePath?: string }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showSaveDialog) return undefined;
        try {
            const res = await dialog.showSaveDialog({
                title: '导出备份 JSON',
                defaultPath: defaultName,
                filters: [{ name: 'JSON 文件', extensions: ['json'] }],
            });
            if (res.canceled || !res.filePath) return undefined;
            const fs = g.require?.('fs') as { writeFileSync: (p: string, d: string, enc?: string) => void };
            fs.writeFileSync(res.filePath, content, 'utf8');
            return res.filePath.split(/[\\/]/).pop() ?? res.filePath;
        } catch (err) {
            new Notice(`导出失败：${err instanceof Error ? err.message : String(err)}${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /** 系统「打开」对话框：选择任意系统路径文件并读取文本；取消/失败返回 undefined（失败时 Notice 提示） */
    private async openTextFromSystem(): Promise<{ name: string; text: string } | undefined> {
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showOpenDialog) return undefined;
        try {
            const res = await dialog.showOpenDialog({
                title: '选择备份 JSON 文件',
                filters: [{ name: 'JSON 文件', extensions: ['json'] }],
                properties: ['openFile'],
            });
            if (res.canceled || res.filePaths.length === 0) return undefined;
            const fs = g.require?.('fs') as { readFileSync: (p: string, enc?: string) => string };
            const text = fs.readFileSync(res.filePaths[0], 'utf8');
            return { name: res.filePaths[0].split(/[\\/]/).pop() ?? res.filePaths[0], text };
        } catch (err) {
            new Notice(`生成年度总结失败：${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /**
     * 🔴 本轮用户裁定（需求①）：「给这些本地检索目录框右侧加『浏览』按钮，**直接唤起系统文件选择器**」。
     *
     * 返回用户选中的**系统绝对路径**（目录）；取消 / 环境不支持 / 出错都回 `undefined`（⛔ 不抛）。
     *
     * 为什么不是 `VaultFolderSuggest`：那个只能选**库内**文件夹，而这几项设置（本地检索目录 /
     * 音乐下载目录 / 阅读器目录）本来就允许填**系统绝对路径**（占位符逐字是「库内路径，或系统绝对路径」），
     * 旧实现在「有 vault 补全实例」时**根本不显示浏览按钮**（`if (!inst)`），等于桌面用户反而没有浏览器。
     * ⇒ 桌面端首选本方法；`hasSystemDialog()` 为假（移动端 / 受限环境）时调用方再回退 vault 选择器。
     *
     * ⚠️ 用 `properties: ['openDirectory']`（不是 `openFile`）；`defaultPath` 只在**确实存在**时才传，
     *    否则 Electron 在部分平台会把对话框定位到一个不存在的目录（表现为「点了没反应」）。
     */
    async pickSystemDirectory(defaultPath?: string): Promise<string | undefined> {
        if (!this.hasSystemDialog()) return undefined;
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showOpenDialog) return undefined;
        try {
            const opts: Record<string, unknown> = {
                title: '选择目录',
                properties: ['openDirectory', 'createDirectory'],
            };
            const seed = (defaultPath ?? '').trim();
            if (seed && /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(seed)) opts.defaultPath = seed;
            const res = await dialog.showOpenDialog(opts);
            if (res.canceled || res.filePaths.length === 0) return undefined;
            return res.filePaths[0];
        } catch (err) {
            new Notice(`打开目录选择器失败：${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /**
     * 弹系统**文件**选择器（ASR 引擎配置用），返回绝对路径。取消 / 环境不支持都回 `undefined`。
     *
     * 🔴 这里**刻意不复用上面那个 `pickSystemFile(exts, name, toRel, fallbackDir)`**：
     *    那个把 `lastSystemDir` 会话记忆、`toVaultRelPath` 转换、`fallbackDir` 冷启动落点
     *    三件事揉在一起，返回的是**可能是库内相对路径**的值 —— 而 ASR 要的是喂给子进程的
     *    **系统绝对路径**（相对路径它根本打不开）。更麻烦的是它会改写 `lastSystemDir`：
     *    用户在设置页选了一部片子当模型目录，下一次「浏览本地音频」就会从那个奇怪的目录弹起。
     *    ⇒ 单独的 `pickSystemFilePath` 只做一件事：绝对路径 + 扩展名过滤，且不碰任何会话状态。
     *
     * @param exts 扩展名过滤（不带点，如 `['exe']`）；空数组 = 不过滤
     * @param name 过滤器的显示名（「可执行文件」/「模型文件」）
     */
    async pickSystemFilePath(exts: string[], name: string): Promise<string | undefined> {
        if (!Platform.isDesktopApp) return undefined;
        const g = globalThis as unknown as { require?: (id: string) => unknown };
        const electron = g.require?.('electron') as
            | { remote?: { dialog?: { showOpenDialog?: (opts: unknown) => Promise<{ canceled: boolean; filePaths: string[] }> } } }
            | undefined;
        const dialog = electron?.remote?.dialog;
        if (!dialog?.showOpenDialog) return undefined;
        try {
            const filters = exts.filter((e) => e.length > 0);
            const res = await dialog.showOpenDialog({
                properties: ['openFile'],
                ...(filters.length > 0 ? { filters: [{ name, extensions: filters }] } : {}),
            });
            if (res.canceled || res.filePaths.length === 0) return undefined;
            return res.filePaths[0];
        } catch (err) {
            new Notice(`打开文件选择器失败：${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }

    /** 系统对话框导出备份：另存为 JSON → 系统路径（桌面端；非桌面/不可用走 vault 版） */
    async exportCatalogBackupToSystem(): Promise<void> {
        if (!this.hasSystemDialog()) {
            new Notice('当前环境不支持系统文件对话框，已改用 vault 内导出');
            await this.exportCatalogBackup();
            return;
        }
        const entries = await this.service.list();
        const snapshot = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const name = await this.saveTextToSystem(`catalog-${ts}.json`, snapshot);
        if (name) new Notice(`已导出备份：${name}（${entries.length} 条）`);
    }

    /** 系统对话框恢复备份：打开任意位置 .json → 合并去重导入（桌面端；不可用回退 vault 选择器） */
    async restoreFromSystemFile(): Promise<void> {
        if (!this.hasSystemDialog()) {
            new Notice('当前环境不支持系统文件对话框，已改用 vault 内选择');
            this.openBackupPicker();
            return;
        }
        const f = await this.openTextFromSystem();
        if (!f) return;
        await this.restoreFromBackupText(f.text);
    }

    /** 批量设置个人评分（rating 0 = 清除） */
    /**
     * #621 表格视图的**列配置**（视图内「列」菜单勾选 / 表头拖序）：
     *   · 只写**当前类型这一个键** ⇒ 改一类不会把另外五类冻结成当时的快照（与 #617 信息栏同一口径）；
     *   · 落盘前过一遍 `normalizeTableColumnsForType`（丢脏键 / 保用户顺序 / 截断到上限）；
     *   · 🔴 必须 `refreshViews()`：表格是**已渲染**的 Svelte 组件，不刷视图就是「点了没反应」。
     */
    async setTableColumns(type: EntryType, keys: string[]): Promise<void> {
        this.settings.tableColumnsByType = {
            ...(this.settings.tableColumnsByType ?? {}),
            [type]: normalizeTableColumnsForType(type, keys),
        };
        await this.saveSettings();
        await this.refreshViews();
    }

    /**
     * 🔴 #668 用户：「切换视图按钮也支持**自由排序并持久化**」——把下拉里拖出来的顺序写进设置。
     * 归一在 `pure/viewModes.normalizeViewOrder` 一处（丢未知值 / 去重 / **缺失的档补末尾**），
     * ⛔ 这里**不要**再归一次（两处归一必然漂）。
     */
    async setViewOrder(order: string[]): Promise<void> {
        this.settings.viewOrder = normalizeViewOrder(order);
        await this.saveSettings();
        await this.refreshViews();
    }

    /**
     * 🔴 #668 用户：「时间线视图展示的也要支持 Ctrl+Z 缩放大小」——只写**时间线自己的**缩放档。
     * ⚠️ 刻意**不**复用 `posterColumns` / `posterDensity`：共用会让「在时间线上缩一次，
     *    卡片网格的列数也跟着变」（`wallColumns` 当年就踩过这条，见设置里那条注释）。
     */
    async setTimelineZoom(zoom: number): Promise<void> {
        this.settings.timelineZoom = normalizeTimelineZoom(zoom);
        await this.saveSettings();
        await this.refreshViews();
    }

    /**
     * 🔴 2026-10-21（用户需求 9）：列表视图工具栏那枚**单循环切换按钮**
     * 「展示分组 ↔ 不并组展示」的唯一落盘出口。
     * `true` = 展示分组（缺省行为）；`false` = 不并组展示。
     * ⚠️ 只有列表视图的分组折叠受它影响（行源分派在 `MediaList.svelte`），
     *    海报墙 / 卡片 / 时间线仍是原行为 —— 需求原文只点名列表视图。
     * ⚠️ 阈值与归一**不需要**新增纯函数：二元布尔，脏值按「展示分组」处理（与 `=== false` 判定一致）。
     */
    async setListGrouping(next: boolean): Promise<void> {
        this.settings.listGrouping = next === false ? false : true;
        await this.saveSettings();
        await this.refreshViews();
    }

    /**
     * 🔴 m07854 ⑬（2026-11-13）：视图切换下拉左旁那枚**单循环图标按钮**的唯一落盘出口。
     * `true` = 全部单卡平铺（拆系列折叠卡）；`false`/缺省 = 系列卡堆叠。
     *
     * ⚠️ 与旁边的 `setListGrouping` **是两件事**（⛔ 别合并）：
     *    `listGrouping` 管列表视图的**行形态**（树形父子行 ⇄ 每条独立一行），
     *    本方法管**卡片网格 / 海报墙的系列折叠卡**（`MediaList.svelte` 的 `seriesRows` 那一支）。
     * ⚠️ 归一不需要纯函数：二元布尔，脏值按「堆叠」处理（与消费侧的 `=== true` 判定一致）。
     */
    async setUnfoldSeries(next: boolean): Promise<void> {
        this.settings.unfoldSeries = next === true;
        await this.saveSettings();
        await this.refreshViews();
    }

    /**
     * 🔴 2026-11-23 分类视图（默认视图 / 合集视图 / 自定义视图）：**唯一**落盘出口。
     *
     * 与旁边那些 `setXxx` 不同：视图**存在媒体库 catalog 里**（用户裁定「跟库走」），
     * ⛔ 不写 settings —— 换设备 / 同步库之后分类结构要跟着库走，不能只活在本机。
     *
     * 归一 + 「只剩默认视图就不写键」全在 `pure/mediaViews`（`normalizeViews` / `viewsForStorage`），
     * ⛔ 这里不再二次归一（两处口径必然漂）。默认视图不可删/改名/换种类由归一器强制保证。
     */
    async setMediaViews(raw: unknown): Promise<void> {
        try {
            await this.service.setViews(raw);
        } catch (e) {
            new Notice('视图保存失败：' + (e instanceof Error ? e.message : String(e)));
            return;
        }
        await this.refreshViews();
    }

    /**
     * #621 表格**一格**的写回。patch 由 `MediaList` 用 `pure/tableCell` 算好（组件不碰磁盘、不碰 obsidian）。
     * 与「快捷关联」同一条链：落库 → 重写笔记 → 刷视图；⚠️ 笔记同步失败只提示、**不回滚条目**
     * （条目数据已经落进 catalog，回滚反而会造成「界面有、笔记没有」的第二处不一致）。
     */
    async commitTableCell(id: string, patch: Partial<MediaEntry>): Promise<void> {
        const merged = await this.service.update(id, patch);
        try {
            await this.service.writeNote(merged.id);
        } catch (e) {
            new Notice('笔记同步失败：' + (e instanceof Error ? e.message : String(e)));
        }
        await this.refreshViews();
    }

    async bulkSetRating(ids: string[], rating: number): Promise<void> {
        const r = Math.max(0, Math.min(5, Math.round(rating))) as Rating;
        for (const id of ids) {
            try {
                await this.service.update(id, { rating: r });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /** 批量追加标签（与已有 tags 合并去重，不覆盖） */
    async bulkAddTags(ids: string[], tags: string[]): Promise<void> {
        for (const id of ids) {
            try {
                const e = await this.service.get(id);
                if (!e) continue;
                const merged = Array.from(new Set([...(e.tags ?? []), ...tags]));
                await this.service.update(id, { tags: merged });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /**
     * #573 批量重排序号（系列视图里「勾选若干条 → 按当前列表顺序依次编号」）。
     *
     * 🔴 计划（哪几条、各拿什么号）**在纯模块 `planSeriesReindex` 里算**，这里只负责落库 ——
     *    ⛔ 别在视图层自己算号（那是要被单测钉住的规则：只编选中项、未选中不占号、步长 < 1 按 1）。
     * ⚠️ 只写 `seriesIndex` 一个字段，**不动 `series`**：本入口只在系列视图里出现，
     *    成员本来就有系列名（`service.update` 是「字段级补丁」，不会把别的字段抹掉）。
     */
    async bulkSetSeriesIndex(pairs: readonly { id: string; seriesIndex: number }[]): Promise<void> {
        for (const p of pairs) {
            try {
                await this.service.update(p.id, { seriesIndex: p.seriesIndex });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }

    /**
     * 批量**覆盖**「归属合集」（用户 2026-11-25：「系列卡片右键菜单可进行批量填归属合集」）。
     *
     * 🔴 语义是**覆盖**，不是 `bulkAddTags` 那种追加合并 —— 一个条目只能属于一个合集，
     *    给全组填了「熊出没」，成员原来写的「熊出没旧」就该被换掉，而不是两个并存。
     *    ⛔ 别复用 `bulkAddTags` 的合并逻辑来凑（那是多值字段的规矩）。
     * ⚠️ 传空串 = **清空**归属合集（条目退回「只出现在默认视图」），这是合法操作、不是错误输入，
     *    ⛔ 别拿 `if (!name) return` 把它挡掉 —— `service.update` 收 `undefined` 才是「不改这个字段」。
     * ⚠️ 与 `bulkSetSeriesIndex` 同款：单条失败不阻断其余，最后统一刷视图。
     */
    async bulkSetCollection(ids: readonly string[], collection: string): Promise<void> {
        // ⚠️ `|| undefined` 而不是直接给 `''`：`collection` 是可选字段，空串与「没填」在
        //    `normalizeEntry` 里都会被清成 undefined，但`undefined` 语义更干净（不产生空串残留）。
        const value = collection.trim() || undefined;
        for (const id of ids) {
            try {
                await this.service.update(id, { collection: value });
            } catch {
                // 单条失败不阻断其余
            }
        }
        await this.refreshViews();
    }
}

/** 取路径所在目录（分隔符不限 / \；无目录部分 → 原样返回）。系统文件对话框记忆目录用 */
function dirnameOf(p: string): string {
    const m = /^(.*)[\\/][^\\/]+$/.exec(p);
    return m ? m[1] : p;
}
