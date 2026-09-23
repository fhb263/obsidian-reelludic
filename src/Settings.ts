// 设置类型、默认值与设置面板（字段只能追加，不能删除——AGENTS 红线）
import { Notice, Platform, PluginSettingTab, Setting, setIcon, TFolder } from 'obsidian';
import type ReelLudicPlugin from '../main';
import type { ColorTheme, UiTheme } from 'data/types';
import type { ProviderId, SourceGroup, ProviderMeta } from 'pure/sourceRegistry';
import {
    PROVIDERS, PROVIDER_META, GROUP_LABELS,
    resolveSourceChain, normalizeSourceChain, DEFAULT_CHAINS,
} from 'pure/sourceRegistry';
import { normalizeAiChoice, AI_PROVIDER_OPTIONS, DEFAULT_TRANSLATE_PROMPT } from 'pure/translate';
import { DEFAULT_SUMMARY_PROMPT } from 'pure/aiSummary';
import { DEFAULT_SEARCH_PROMPT } from 'pure/readerSearch';
import { loadTtsEngine, saveTtsEngine } from 'pure/tts';
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
    /** 每类型源链（五组自选 ≤3 源及顺序；缺省/空 = 默认链，见 pure/sourceRegistry.DEFAULT_CHAINS。append-only 可选字段，旧数据无此键不迁移） */
    sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>;
    /** 阅读翻译服务商（'zhipu' 智谱 GLM / 'deepseek' / 'off' 不启用；默认 zhipu。批3 r3 双源。
     *  append-only 可选字段；'off' 由 normalizeAiChoice 认，勿用 normalizeProvider 归一（会把 off 吃掉）） */
    readerTranslateProvider?: 'zhipu' | 'deepseek' | 'off';
    /** 智谱 AI 翻译 API Key（Bearer，发往 open.bigmodel.cn；cform 同款 key，形如 xxx.yyy。批3 r3。append-only 可选字段） */
    readerZhipuKey?: string;
    /** DeepSeek AI 翻译 API Key（Bearer，发往 api.deepseek.com。批3 r3。append-only 可选字段） */
    readerDeepseekKey?: string;
    /** AI 总结服务商（'zhipu' / 'deepseek'；与翻译服务各自独立可调。缺省 zhipu。append-only 可选字段）
     *  两个服务共用上面两把 Key——服务商只是选「用哪家跑」，凭据不重复配置。 */
    readerSummaryProvider?: 'zhipu' | 'deepseek' | 'off';
    /** 划词翻译自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_TRANSLATE_PROMPT。append-only 可选字段 */
    readerTranslatePrompt?: string;
    /** AI 总结自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_SUMMARY_PROMPT。append-only 可选字段 */
    readerSummaryPrompt?: string;
    /** AI 搜索服务商（'zhipu' / 'deepseek'；与翻译、总结各自独立可调。缺省 zhipu。append-only 可选字段）
     *  与翻译/总结共用同一组 Key——服务商只是选「用哪家跑」。 */
    readerSearchProvider?: 'zhipu' | 'deepseek' | 'off';
    /** 划词搜索自定义服务提示词（system）；留空/缺省 = 用 DEFAULT_SEARCH_PROMPT。append-only 可选字段 */
    readerSearchPrompt?: string;
    /** 云合成（OpenAI 兼容 `/audio/speech`）API Key（Bearer，发往 api.siliconflow.cn。append-only 可选字段）
     *  ⚠️ **朗读音源**（系统语音 / 云合成）不在这里 —— 它是使用态偏好，走 localStorage（`pure/tts` 的
     *  `rl-tts-engine`，与语速 / 音色同款），设置页下拉与阅读器弹窗 chips 读写同一份。 */
    readerSiliconflowKey?: string;
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
};

export const PLATFORM_URL_PRESETS: Record<string, string> = {
    B站: 'https://www.bilibili.com/search?keyword=',
    Netflix: 'https://www.netflix.com/search?q=',
    豆瓣: 'https://search.douban.com/movie/subject_search?search_text=',
    爱奇艺: 'https://so.iqiyi.com/so/q_',
    腾讯视频: 'https://v.qq.com/x/search/?q=',
};

/** ① 数据源配置折叠项内需 Key 源展示顺序（spec S5 + IGDB 回归：Douban/TMDB/Bangumi/OMDb/Google Books/IGDB；遍历 PROVIDERS 派生，本表定序） */
const KEY_SOURCE_ORDER: readonly ProviderId[] = ['douban', 'tmdb', 'bangumi', 'omdb', 'googleBooks', 'igdb'];

/** ① 数据源配置折叠项内免 Key 源展示顺序（T1：Open Library/Steam/MusicBrainz/iTunes/AniList——无凭据可填，仅展示说明） */
const FREE_SOURCE_ORDER: readonly ProviderId[] = ['openLibrary', 'steam', 'musicbrainz', 'itunes', 'anilist'];

/** ② 数据源启用分类展示顺序（spec S5：书籍/影视/动画/音乐/游戏；1.0.3.1 起漫画子组已下线，registry SOURCE_GROUPS 顺序不同，UI 行序以此为准） */
const GROUP_DISPLAY_ORDER: readonly SourceGroup[] = ['book', 'movieTv', 'anime', 'music', 'game'];

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
    /** #380 媒体库目录输入框的「边打边提示」实例；旧版本该 API 不存在 ⇒ 为 null（走「浏览…」按钮）。
     *  ⚠️ 设置页重渲染/关闭时必须 `close()`，否则会留下孤儿浮层。 */
    private folderSuggest: FolderInputSuggest | null = null;

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
        const toggle = wrap.createEl('button', { cls: 'rl-secret-eye', attr: { type: 'button', 'data-tip': '切换明文/密文显示' }, text: '显示' });
        const apply = (show: boolean) => {
            input.type = show ? 'text' : 'password';
            toggle.setText(show ? '隐藏' : '显示');
        };
        toggle.addEventListener('click', () => apply(input.type === 'password'));
        input.addEventListener('input', () => opts.onInput(input.value.trim()));
        return input;
    }

    /**
     * 「数据源配置」页（#352：原为 `renderServiceSection` 的前半段，标题升格成导航项后独立成页；
     * #354 起标签由「数据源管理」改成「数据源配置」—— 全仓处方文案同步改，见 `pure/sourceRegistry`）。
     *
     * 🔴 **折叠能力已整体撤除**：改版前是「一级标题常显 + 子分组可折叠」，现在
     *   **子分组一律常显**（`createGroupSection` 不再挂 caret、不再有 open 态）；
     *   #353 把「页」的切换换成横向 Tab 后，**页面本身也不再有第二个可折叠层**
     *   （#352 那套窄屏手风琴 `.rl-set-page-head` 已整体退场）。
     *   原因：Obsidian 原生设置页只有两层，再叠「分组折叠」就成了「点开页 → 里面还要再点开一个组」
     *   的**两层折叠嵌套**，正是用户要消灭的「层级模糊」。
     *
     * 🔴 层级口径（2026-09-18 第七次裁定，仍然有效）：子分组标题 13px/600 与原生设置行
     *   **同一左缘**；组内容再缩进一档（80px），与标题形成阶梯。
     *   ⚠️ #353 去掉页标题后，**页内首个元素就是子分组标题** ⇒ 它自带的 `margin` 会把页顶顶开一段，
     *      由 styles.css 的 `.rl-set-page-body > .rl-svc-group:first-child { margin-top: 0 }` 收掉。
     * ⚠️ 数据源凭据内的**源行**仍各自可展开 —— 那是输入框收纳，与分组本身无关。
     */
    private renderSourcePage(parent: HTMLElement): void {
        this.createGroupSection(parent, '数据源启用', (body) => {
            for (const g of GROUP_DISPLAY_ORDER) this.createGroupCheckRow(body, g);
        });
        this.createGroupSection(parent, '数据源凭据', (body) => {
            for (const id of KEY_SOURCE_ORDER) this.createApiKeyRow(body, PROVIDER_META[id]);
            for (const id of FREE_SOURCE_ORDER) this.createFreeSourceRow(body, PROVIDER_META[id]);
        });
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
     */
    private createGroupSection(parent: HTMLElement, title: string, fill: (body: HTMLDivElement) => void): void {
        const wrap = parent.createDiv({ cls: 'rl-svc-group' });
        const head = wrap.createDiv({ cls: 'rl-svc-group-title' });
        // 图标按标题从真源取；未登记则跳过（只是缺个图标，不抛错）
        const icon = groupIcon(title);
        if (icon) safeSetIcon(head.createSpan({ cls: 'rl-svc-group-icon' }), icon);
        head.createSpan({ text: title });
        const body = wrap.createDiv({ cls: 'rl-svc-group-body' });
        fill(body);
    }

    /**
     * ② AI集成 内容：两组 ——「AI服务」翻译 / 总结 / 搜索 / **朗读音源** 四套「用谁来做」的选择
     * （各带自己的提示词，朗读音源无提示词）+「API凭据」四家 Key（各为可折叠行，展开显示 Key 密文输入
     * + 测试连接按钮 + 已配置徽标）。模型固定（智谱 GLM-4-Flash / DeepSeek deepseek-v4-flash），
     * 不再让用户配置。
     *
     * 🔴 #356 两组行序调整（用户指令）：
     *    ⑴ **朗读音源**（原「语音合成」组的头一行）搬到 **AI服务 组末尾** —— 用户原话「把AI集成-朗读音源项
     *       放到搜索服务项下面」；落在**搜索提示词之后**（用户确认），以保住「服务 + 它的提示词」成对不拆开。
     *    ⑵ **硅基流动 Key**（原「语音合成」组的第二行）搬到 **API凭据 组**，跟在智谱 / DeepSeek 之后 ——
     *       用户原话「把硅基流动放到API凭据下面」；四家 Key 从此都在同一个凭据区里。
     *    ⇒ 「语音合成」这一整组**随之撤销**（两行都搬走后组内无内容，Obsidian 原生设置页里只会剩一个
     *       孤零零的标题）—— ⚠️ 连带全仓指向「AI集成 下的那个语音分组」的提示文案必须改指
     *       **`设置 → AI集成 › API凭据 · 硅基流动`**，否则提示会指向一个不存在的入口（本项目铁律）。
     */
    private renderTranslateFold(body: HTMLElement): void {
        // 分组标题去掉序号前缀（用户 2026-09-18：「1 AI服务 / 2 API凭据」→「AI服务 / API凭据」）
        this.createGroupSection(body, 'AI服务', (inner) => this.renderAiServiceRows(inner));
        this.createGroupSection(body, 'API凭据', (inner) => {
            // 各家 Key 始终都显示，不跟随服务商切换；翻译 / 总结 / 搜索三处共用前两家
            this.renderTranslateKeyBlock(inner, 'zhipu', '智谱清言', 'readerZhipuKey', '你的智谱 API Key');
            this.renderTranslateKeyBlock(inner, 'deepseek', 'DeepSeek', 'readerDeepseekKey', 'sk-…');
            // 🔴 #356：云合成（朗读音源选「硅基流动」时用）的 Key 从「语音合成」组搬来，排在第四
            this.renderTranslateKeyBlock(inner, 'siliconflow', '硅基流动', 'readerSiliconflowKey', 'sk-…');
        });
    }

    /**
     * 「朗读音源」行（#344，**#356 从「语音合成」组搬进 AI服务 组末尾**）。
     * 🔴 音源走 localStorage（**不是**设置字段）—— 阅读器朗读弹窗里的下拉读写同一份，
     *    两边都直接读写、不必来回透传回调；改完对**已打开**的阅读器不立即生效（重开即可）。
     */
    private renderTtsVoiceRow(body: HTMLDivElement): void {
        new Setting(body)
            .setName('朗读音源')
            .setDesc('阅读器语音朗读用哪种声音；系统语音无需配置，云合成的音色更多')
            .addDropdown((d) => {
                d.addOption('system', '系统语音');
                d.addOption('cloud', '硅基流动');
                d.setValue(loadTtsEngine() ?? 'system');
                d.onChange((v: string) => saveTtsEngine(v === 'cloud' ? 'cloud' : 'system'));
            });
    }

    /** 「AI服务」组内容：翻译 / 总结 / 搜索三套服务商下拉 + 各自的服务提示词 + 朗读音源（#356 移入） */
    private renderAiServiceRows(body: HTMLDivElement): void {
        // 翻译服务下拉（默认 zhipu）+ 其专属服务提示词
        new Setting(body)
            .setName('翻译服务')
            .setDesc('阅读器AI划词翻译；选「不启用」则关闭该功能')
            .addDropdown((d) => {
                for (const o of AI_PROVIDER_OPTIONS) d.addOption(o.value, o.label);
                d.setValue(normalizeAiChoice(this.plugin.settings.readerTranslateProvider));
                d.onChange(async (v: string) => {
                    this.plugin.settings.readerTranslateProvider = normalizeAiChoice(v);
                    await this.plugin.saveSettings();
                });
            });
        this.renderPromptField(body, {
            label: '翻译提示词',
            value: this.plugin.settings.readerTranslatePrompt,
            defaultText: DEFAULT_TRANSLATE_PROMPT,
            onSave: (v) => {
                this.plugin.settings.readerTranslatePrompt = v;
                void this.plugin.saveSettings();
            },
        });

        // 总结服务下拉（与翻译服务各自独立：条目 AI 生成一句话总结/核心看点用它跑）+ 其专属服务提示词
        new Setting(body)
            .setName('总结服务')
            .setDesc('书籍、影视类型条目Ai总结与摘要；选「不启用」则关闭该功能')
            .addDropdown((d) => {
                for (const o of AI_PROVIDER_OPTIONS) d.addOption(o.value, o.label);
                d.setValue(normalizeAiChoice(this.plugin.settings.readerSummaryProvider));
                d.onChange(async (v: string) => {
                    this.plugin.settings.readerSummaryProvider = normalizeAiChoice(v);
                    await this.plugin.saveSettings();
                });
            });
        this.renderPromptField(body, {
            label: '总结提示词',
            value: this.plugin.settings.readerSummaryPrompt,
            defaultText: DEFAULT_SUMMARY_PROMPT,
            onSave: (v) => {
                this.plugin.settings.readerSummaryPrompt = v;
                void this.plugin.saveSettings();
            },
        });

        // 搜索服务下拉（同样独立：阅读器划词搜索卡内的 AI 答案用它跑；网络搜索那一半不走 AI、无需配置）
        new Setting(body)
            .setName('搜索服务')
            .setDesc('阅读器划词Ai搜索；选「不启用」则关闭该功能')
            .addDropdown((d) => {
                for (const o of AI_PROVIDER_OPTIONS) d.addOption(o.value, o.label);
                d.setValue(normalizeAiChoice(this.plugin.settings.readerSearchProvider));
                d.onChange(async (v: string) => {
                    this.plugin.settings.readerSearchProvider = normalizeAiChoice(v);
                    await this.plugin.saveSettings();
                });
            });
        this.renderPromptField(body, {
            label: '搜索提示词',
            value: this.plugin.settings.readerSearchPrompt,
            defaultText: DEFAULT_SEARCH_PROMPT,
            onSave: (v) => {
                this.plugin.settings.readerSearchPrompt = v;
                void this.plugin.saveSettings();
            },
        });

        // 🔴 #356（用户指令）：朗读音源从「语音合成」组搬到本组末尾 —— 它和上面三项同属
        //    「用谁来做这件事」的服务选择；位置放在**搜索提示词之后**（用户确认），
        //    ⛔ 不插在「搜索服务」与「搜索提示词」之间（那会把一对服务配置拆开）。
        this.renderTtsVoiceRow(body);
    }

    /**
     * 提示词编辑块（翻译 / 总结各一块）：
     *  - 默认提示词（DEFAULT_*_PROMPT）只作 **placeholder 灰字**呈现——不可编辑、点不掉，纯粹让人知道默认长什么样；
     *  - 用户点进框里就是**空框**，写入自己的提示词即覆盖默认；清空（或粘贴回与默认完全一致）→ 存 undefined 恢复默认。
     *  - 改动在失焦（change）时保存，不逐键写盘。
     */
    private renderPromptField(
        body: HTMLDivElement,
        opts: { label: string; value?: string; defaultText: string; onSave: (v: string | undefined) => void },
    ): void {
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
    }

    /**
     * 渲染单个服务商 Key 行（AI 翻译 / 总结 / 搜索内，翻译与总结共用）：可折叠（同 ① 数据源配置 createApiKeyRow 观感）——
     * 头 = 服务商名 + 已配置徽标 + ▸，点击展开 body（Key 密文输入 + 测试连接 + 结果）。
     */
    /**
     * 渲染单个服务商 Key 行（翻译 / 总结 / 搜索 / **云合成**共用）：可折叠（同 ① 数据源配置 createApiKeyRow 观感）——
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
    ): void {
        const row = body.createDiv({ cls: 'rl-key-row' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        head.createSpan({ cls: 'rl-key-name', text: label });
        const badge = head.createSpan({ cls: 'rl-key-badge' });
        const refreshBadge = (): void => {
            const has = !!this.settingValue(keyField);
            badge.setText(has ? '已配置' : '未配置');
            badge.toggleClass('rl-key-badge-on', has);
        };
        refreshBadge();
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });

        const bodyEl = row.createDiv({ cls: 'rl-key-body' });
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

        // 测试连接行（按钮 + 结果文案）
        const actions = bodyEl.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        const testBtn = actions.createEl('button', { cls: 'mod-cta', text: '测试连接' });
        testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            testBtn.setText('测试中…');
            testBtn.addClass('rl-btn-loading'); // 1.0.4：内联 spinner（文字由 .rl-btn-loading 置透明）
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-bad');
            const res =
                provider === 'siliconflow'
                    ? await this.plugin.testSpeechConnection()
                    : await this.plugin.testTranslateConnection(provider);
            testBtn.disabled = false;
            testBtn.setText('测试连接');
            testBtn.removeClass('rl-btn-loading');
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            // 反馈配色（用户 2026-09-14 裁定）：失败才红，成功一律绿 —— 不再区分「偏慢」档
            resultEl.toggleClass('rl-key-result-ok', res.ok);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
        });

        // 头点击展开/收起（必须绑 click 加 .rl-key-open，否则 .rl-key-body 恒 display:none 打不开）
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
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
        if (meta.id === 'douban') return 'Douban Cookie（必填，登录态）';
        if (meta.id === 'bangumi') return '输入 Bangumi Access Token';
        if (meta.id === 'googleBooks') return 'Google Books API Key（可选，限流时提升配额）';
        if (meta.id === 'igdb') return 'IGDB Client ID';
        return `输入 ${meta.label} API Key`;
    }

    /**
     * 数据源配置折叠项内「单源配置行」：源名 + 状态徽标（已配置/未配置/可选 Key）+ ▸，点击行头
     * 内联展开配置区（hint + 密文输入 + 「测试连接」✓/✗ · 耗时），再点收起。
     * 输入变更写 settings[keyField] + saveSettings + 刷新徽标；不抛未捕获异常（测试内部 catch）。
     */
    private createApiKeyRow(parent: HTMLDivElement, meta: ProviderMeta): void {
        if (!meta.keyField) return; // 免 Key 源不在此列
        const keyField: string = meta.keyField;
        const keyField2: string | undefined = meta.keyField2 ?? undefined; // 双凭据源（igdb）第二字段
        const row = parent.createDiv({ cls: 'rl-key-row' });
        const head = row.createDiv({ cls: 'rl-key-head' });
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

    /**
     * 数据源配置折叠项内「免 Key 源只读行」：源名 + 「免 Key」徽标 + ▸；点击行头内联展开仅展示 hint
     * （无输入框/测试按钮——无需凭据，开箱即用）。与需 Key 行同构，保持清单观感一致。
     */
    private createFreeSourceRow(parent: HTMLDivElement, meta: ProviderMeta): void {
        const row = parent.createDiv({ cls: 'rl-key-row' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        head.createSpan({ cls: 'rl-key-name', text: meta.label });
        head.createSpan({ cls: 'rl-key-badge rl-key-badge-free', text: '免 Key' });
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });
        const body = row.createDiv({ cls: 'rl-key-body' });
        body.createDiv({ cls: 'rl-hint-note', text: meta.hint });
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
     *       数据源配置（原「数据源管理」改名）/ AI集成 / **关于（从右上角小图标回归 Tab 栏）**。
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
        this.createGroupSection(parent, '实验性功能', (body) => this.renderExperimentalRows(body));
        this.createGroupSection(parent, '数据与备份', (body) => this.renderDataBackupRows(body));
        this.createGroupSection(parent, '封面与清理', (body) => this.renderPosterCleanupRows(body));
    }

    /** 「基本设置」页 · 第 1 组「外观与体验」（原「外观」页那一行 + 海报密度） */
    private renderAppearanceRows(parent: HTMLDivElement): void {
        // 界面主题切换入口已删（1.0.3 全面 modern）：onload 强制 settings.uiTheme = "modern"。
        new Setting(parent)
            .setName('隐藏插件内滚动条')
            .setDesc('隐藏主界面与编辑弹窗内滚动条，滚轮/触控板仍可滚动。阅读器（TXT/EPUB/PDF）不受影响，滚动条始终显示。')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.hideScrollbars).onChange(async (value) => {
                    this.plugin.settings.hideScrollbars = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── 海报密度（用户 2026-09-22）──
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
            .setDesc('海报墙每行放几张卡片；「自定义列数」按容器宽度决定实际列数，过窄时自动减列。')
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

    /** 「基本设置」页 · 第 2 组「实验性功能」（原「实验性功能」页那两行） */
    private renderExperimentalRows(parent: HTMLDivElement): void {
        new Setting(parent)
            .setName('内置阅读器打开书籍文件')
            .setDesc('开启后用内置阅读器打开 TXT/EPUB/PDF；关闭用系统默认程序。')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalBookReader).onChange(async (value) => {
                    this.plugin.settings.internalBookReader = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(parent)
            .setName('内置播放器打开视频文件')
            .setDesc('开启用内置播放器播放本地影视（mp4/webm 等内嵌，可上下集）；关闭用系统播放器。mkv 等自动转系统。')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalMediaPlayback).onChange(async (value) => {
                    this.plugin.settings.internalMediaPlayback = value;
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
        //     ⑴ 输入框**边打边提示**库内文件夹（`AbstractInputSuggest`；旧版本无该 API ⇒ 降级为「浏览…」按钮）；
        //     ⑵ **失焦 / 回车才提交** —— 原来是 onChange 每敲一个字符就 `saveSettings`，
        //        打字过程中会**连续换库、连续建目录**（打「99-媒体库」会依次落到 9 / 99 / 99- …）；
        //     ⑶ 三个「静默换库」防坑：绝对路径（`D:\媒体库` 会被当成库内一个叫 `D:` 的文件夹 ⇒
        //        静默新建空库、看着像数据丢了）、`..` 段、非法字符一律当场拦下；目标文件夹不存在时**先确认**。
        this.folderSuggest?.close(); // 重渲染前先收掉上一次的浮层
        this.folderSuggest = null;
        const libRow = new Setting(parent)
            .setName('媒体库目录')
            .setDesc('库内相对路径（相对库根）。catalog.json、笔记/ 等都放在这里；换目录＝换库，原目录的数据不会被删。');
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
            // 边打边提示（旧版本该 API 不存在 ⇒ `null`，此时补一个「浏览…」按钮走模糊搜索弹层）
            const folders = folderCandidates(this.app);
            const fromPick = (folder: TFolder): void => {
                text.setValue(folder.path);
                void commit();
            };
            this.folderSuggest = attachFolderInputSuggest(this.app, text.inputEl, folders, fromPick);
            if (!this.folderSuggest) {
                libRow.addButton((b) =>
                    b.setButtonText('浏览…').onClick(() => {
                        new VaultFolderSuggest(this.app, folders, fromPick).open();
                    }),
                );
            }
        });

        // ①.5 笔记表格（用户 2026-09-18）：控制详情笔记里那张「| 属性 | 内容 |」表是否生成
        new Setting(parent)
            .setName('笔记表格')
            .setDesc('关闭后新生成/更新的条目笔记不再写「属性」表格；已存在的笔记不追溯改写。')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.noteTable !== false).onChange(async (value) => {
                    this.plugin.settings.noteTable = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ② 导出备份与备份恢复（合并原「导出备份」+「从备份恢复」；桌面端走系统文件对话框，非桌面回退 vault 选择器）
        new Setting(parent)
            .setName('导出备份与备份恢复')
            .setDesc('导出 catalog 快照；或导入 .json 备份合并去重（按标题+类型判重）。')
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

    /** 「基本设置」页 · 第 4 组「封面与清理」（原「数据管理」页的后两段 + 迁移进度条） */
    private renderPosterCleanupRows(parent: HTMLDivElement): void {
        // ③ 下载封面（一键迁移：网络封面下载到 封面/{标题}.jpg；开关已移除，字段保留兼容旧数据）
        new Setting(parent)
            .setName('下载封面')
            .setDesc('将网络封面下载到 封面/ 目录（失败项可重试）。')
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
            .setDesc('清理未被引用的封面，以及条目已删除后遗留的阅读存档。删除后进入回收站（跟随「删除文件」设置）。')
            .addButton((b) =>
                b.setButtonText('扫描').onClick(() => {
                    void this.plugin.openAssetCleanup();
                }),
            );
    }

    /** 「关于」页（支持作者；样式参考 LyricFlux about 区）
     *  🔴 #356（用户指令）：标题由「支持 ReelLudic」改回 **「支持作者」** —— 这是 09-10「支持作者 →
     *     支持 ReelLudic」的反向调整（那轮为统一品牌名），以用户本轮口径为准；描述与两个按钮不动。 */
    private renderAboutPage(parent: HTMLElement): void {
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
