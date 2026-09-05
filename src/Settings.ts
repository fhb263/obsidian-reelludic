// 设置类型、默认值与设置面板（字段只能追加，不能删除——AGENTS 红线）
import { Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import type ReelLudicPlugin from '../main';
import type { ColorTheme } from 'data/types';
import type { ProviderId, SourceGroup, ProviderMeta } from 'pure/sourceRegistry';
import {
    PROVIDERS, PROVIDER_META, GROUP_LABELS,
    resolveSourceChain, normalizeSourceChain, DEFAULT_CHAINS,
} from 'pure/sourceRegistry';
import { NORMAL_MS } from 'pure/timing';
import { normalizeProvider } from 'pure/translate';
import { PosterMigrateModal } from 'modals/PosterMigrateModal';
import { PosterCleanupModal } from 'modals/PosterCleanupModal';

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
    /** 阅读排版：字号（px，默认 16）/ 行距（倍数，默认 1.8）——设置项已移除（v0.5 起在阅读器内调整，写回本字段），字段保留兼容旧数据 */
    readerFontSize: number;
    readerLineHeight: number;
    /** 阅读滚动模式：'continuous' 连续滚动（默认）/ 'paged' 翻页（CSS 列式分页，D4b）。append-only，缺省 continuous */
    readerScrollMode?: 'continuous' | 'paged';
    /** 实验性功能：书籍文件用内置阅读器打开（默认 false = 外部系统默认程序打开） */
    internalBookReader?: boolean;
    /** 内置播放器打开视频文件（影视本地 episodeFiles；默认 false = 系统播放器打开文件；开启后 mp4/webm/mov/ogv 内嵌弹窗播放，mkv 等 Chromium 不可解格式自动转系统。命名沿用 internalMediaPlayback，语义已从「适配 Media Extended」改为「内置播放器」） */
    internalMediaPlayback?: boolean;
    /** 每类型源链（五组自选 ≤3 源及顺序；缺省/空 = 默认链，见 pure/sourceRegistry.DEFAULT_CHAINS。append-only 可选字段，旧数据无此键不迁移） */
    sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>;
    /** 阅读翻译服务商（'zhipu' 智谱 GLM / 'deepseek'；默认 zhipu。批3 r3 双源。append-only 可选字段） */
    readerTranslateProvider?: 'zhipu' | 'deepseek';
    /** 智谱 AI 翻译 API Key（Bearer，发往 open.bigmodel.cn；cform 同款 key，形如 xxx.yyy。批3 r3。append-only 可选字段） */
    readerZhipuKey?: string;
    /** DeepSeek AI 翻译 API Key（Bearer，发往 api.deepseek.com。批3 r3。append-only 可选字段） */
    readerDeepseekKey?: string;
    /** OMDb API Key（影视第三源，需 Key 1000 次/日；T1 预留字段，omdb 客户端接入后读取。append-only 可选字段，旧数据无此键不迁移） */
    omdbApiKey?: string;
    /** 服务集成折叠项开合记忆（api=数据源管理(含数据源启用子块) / translate=阅读器翻译管理；true=展开）。
     *  sources 键已弃用（数据源启用并入 api，不再单独折叠），类型保留兼容旧数据。append-only */
    serviceFoldOpen?: Partial<Record<'api' | 'sources' | 'translate', boolean>>;
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
    readerFontSize: 16,
    readerLineHeight: 1.8,
    internalBookReader: false,
    internalMediaPlayback: false,
};

export const PLATFORM_URL_PRESETS: Record<string, string> = {
    B站: 'https://www.bilibili.com/search?keyword=',
    Netflix: 'https://www.netflix.com/search?q=',
    豆瓣: 'https://search.douban.com/movie/subject_search?search_text=',
    爱奇艺: 'https://so.iqiyi.com/so/q_',
    腾讯视频: 'https://v.qq.com/x/search/?q=',
};

/** ① 数据源管理折叠项内需 Key 源展示顺序（spec S5 + IGDB 回归：Douban/TMDB/Bangumi/OMDb/Google Books/IGDB；遍历 PROVIDERS 派生，本表定序） */
const KEY_SOURCE_ORDER: readonly ProviderId[] = ['douban', 'tmdb', 'bangumi', 'omdb', 'googleBooks', 'igdb'];

/** ① 数据源管理折叠项内免 Key 源展示顺序（T1：Open Library/Steam/MusicBrainz/iTunes/AniList——无凭据可填，仅展示说明） */
const FREE_SOURCE_ORDER: readonly ProviderId[] = ['openLibrary', 'steam', 'musicbrainz', 'itunes', 'anilist'];

/** ② 数据源启用分类展示顺序（spec S5：书籍/影视/动画/音乐/游戏；registry SOURCE_GROUPS 顺序不同，UI 行序以此为准） */
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

export class ReelLudicSettingTab extends PluginSettingTab {
    constructor(app: unknown, private plugin: ReelLudicPlugin) {
        super(app as never, plugin);
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
        const toggle = wrap.createEl('button', { cls: 'rl-secret-eye', attr: { type: 'button', title: '切换明文/密文显示' }, text: '显示' });
        const apply = (show: boolean) => {
            input.type = show ? 'text' : 'password';
            toggle.setText(show ? '隐藏' : '显示');
        };
        toggle.addEventListener('click', () => apply(input.type === 'password'));
        input.addEventListener('input', () => opts.onInput(input.value.trim()));
        return input;
    }

    /**
     * 服务集成：两折叠项——① 数据源管理（内含「数据源启用」「数据源凭据」两个可折叠子块）+
     * ② 阅读器翻译管理。数据源启用原为独立折叠并入 ①；数据源凭据收纳全部源行（三级折叠：①→子块→源行）。
     */
    private renderServiceSection(parent: HTMLElement): void {
        // ① 数据源管理
        const apiBody = this.createFoldout(parent, '① 数据源管理', 'api');
        // 折叠子块 1：数据源启用（五分类勾选，默认收起）
        this.createSubfold(apiBody, '数据源启用', (body) => {
            for (const g of GROUP_DISPLAY_ORDER) this.createGroupCheckRow(body, g);
        });
        // 折叠子块 2：数据源凭据（所有需 Key / 免 Key 源行，每源行自身仍可展开，默认收起）
        this.createSubfold(apiBody, '数据源凭据', (body) => {
            for (const id of KEY_SOURCE_ORDER) this.createApiKeyRow(body, PROVIDER_META[id]);
            for (const id of FREE_SOURCE_ORDER) this.createFreeSourceRow(body, PROVIDER_META[id]);
        });

        // ② 阅读器翻译管理：阅读器划词翻译配置（原 ③，去掉独立②数据源启用后改 ②）
        const translateBody = this.createFoldout(parent, '② 阅读器翻译管理', 'translate');
        this.renderTranslateFold(translateBody);
    }

    /** ① 数据源管理内可折叠子块（默认收起，观感同需 Key 源行）：头可点击展开 body 内容 */
    private createSubfold(parent: HTMLDivElement, title: string, fill: (body: HTMLDivElement) => void): void {
        const row = parent.createDiv({ cls: 'rl-key-row' });
        const head = row.createDiv({ cls: 'rl-key-head' });
        head.createSpan({ cls: 'rl-key-name', text: title });
        head.createSpan({ cls: 'rl-key-caret', text: '▸' });
        const body = row.createDiv({ cls: 'rl-key-body' });
        fill(body);
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 阅读器翻译管理折叠项内容：服务商下拉 + 双源 Key（各为可折叠行，同 ① 数据源管理观感，
     * 展开显示 Key 密文输入 + 测试连接按钮 + 已配置徽标）。
     * 模型固定（智谱 GLM-4-Flash / DeepSeek deepseek-v4-flash），不再让用户配置。
     */
    private renderTranslateFold(body: HTMLDivElement): void {
        // 服务商下拉（顶部，默认 zhipu）
        new Setting(body)
            .setName('翻译服务')
            .setDesc('划词翻译用的 AI 服务商。')
            .addDropdown((d) => {
                d.addOption('zhipu', '智谱 GLM-4-Flash');
                d.addOption('deepseek', 'DeepSeek v4 Flash');
                d.setValue(normalizeProvider(this.plugin.settings.readerTranslateProvider));
                d.onChange(async (v: string) => {
                    this.plugin.settings.readerTranslateProvider = v === 'deepseek' ? 'deepseek' : 'zhipu';
                    await this.plugin.saveSettings();
                });
            });

        // 两个服务商 Key + 测试连接（始终都显示，不跟随服务商切换）
        this.renderTranslateKeyBlock(body, 'zhipu', '智谱清言', 'readerZhipuKey', '你的智谱 API Key');
        this.renderTranslateKeyBlock(body, 'deepseek', 'DeepSeek', 'readerDeepseekKey', 'sk-…');
    }

    /**
     * 渲染单个服务商 Key 行（阅读器翻译管理内）：可折叠（同 ① 数据源管理 createApiKeyRow 观感）——
     * 头 = 服务商名 + 已配置徽标 + ▸，点击展开 body（Key 密文输入 + 测试连接 + 结果）。
     */
    private renderTranslateKeyBlock(
        body: HTMLDivElement,
        provider: 'zhipu' | 'deepseek',
        label: string,
        keyField: 'readerZhipuKey' | 'readerDeepseekKey',
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
            resultEl.setText('');
            resultEl.removeClass('rl-key-result-ok', 'rl-key-result-slow', 'rl-key-result-bad');
            const res = await this.plugin.testTranslateConnection(provider);
            testBtn.disabled = false;
            testBtn.setText('测试连接');
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            resultEl.toggleClass('rl-key-result-ok', res.ok && res.elapsedMs <= NORMAL_MS);
            resultEl.toggleClass('rl-key-result-slow', res.ok && res.elapsedMs > NORMAL_MS);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
        });

        // 头点击展开/收起（必须绑 click 加 .rl-key-open，否则 .rl-key-body 恒 display:none 打不开）
        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 通用折叠项（子任务1）：头可点击展开/收起，返回 body（供填内容）。
     * 开合状态持久化到 settings.serviceFoldOpen[key]（true=展开）：
     * 首次访问（无记录）默认收起；此后每次点击写回，重进/刷新设置页保持上次状态。
     * defaultOpen 参数移除——统一以「无记忆则收起」为准。
     */
    private createFoldout(parent: HTMLElement, title: string, key: 'api' | 'sources' | 'translate'): HTMLDivElement {
        const saved = this.plugin.settings.serviceFoldOpen?.[key];
        const open = saved === true; // 缺省/false → 收起
        const fold = parent.createDiv({ cls: 'rl-fold' + (open ? ' rl-fold-open' : '') });
        const head = fold.createDiv({ cls: 'rl-fold-head' });
        head.createSpan({ cls: 'rl-fold-caret', text: '▸' });
        head.createSpan({ cls: 'rl-fold-title', text: title });
        const body = fold.createDiv({ cls: 'rl-fold-body' + (open ? '' : ' rl-fold-body-closed') });
        head.addEventListener('click', () => {
            const closing = !body.hasClass('rl-fold-body-closed');
            body.toggleClass('rl-fold-body-closed', closing);
            fold.toggleClass('rl-fold-open', !closing);
            // 持久化：展开写 true、收起写 false（缺省即收起，仍显式落值以清晰区分与「从未设置」）
            const next = { ...(this.plugin.settings.serviceFoldOpen ?? {}) } as Record<'api' | 'sources' | 'translate', boolean>;
            next[key] = !closing;
            this.plugin.settings.serviceFoldOpen = next;
            void this.plugin.saveSettings();
        });
        return body;
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
     * 数据源管理折叠项内「单源配置行」：源名 + 状态徽标（已配置/未配置/可选 Key）+ ▸，点击行头
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
        // 测试连接：✓/✗ 消息 · Nms；偏慢（>NORMAL_MS）橙色、失败红色
        const actions = body.createDiv({ cls: 'rl-key-actions' });
        const resultEl = actions.createSpan({ cls: 'rl-key-result' });
        const testBtn = actions.createEl('button', { text: '测试连接', cls: 'mod-cta' });
        testBtn.addEventListener('click', async () => {
            testBtn.disabled = true;
            testBtn.setText('测试中…');
            resultEl.setText('');
            const res = await this.testConnectionFor(meta.id);
            testBtn.disabled = false;
            testBtn.setText('测试连接');
            resultEl.setText(`${res.ok ? '✓ ' : '✗ '}${res.message} · ${res.elapsedMs}ms`);
            resultEl.toggleClass('rl-key-result-ok', res.ok && res.elapsedMs <= NORMAL_MS);
            resultEl.toggleClass('rl-key-result-slow', res.ok && res.elapsedMs > NORMAL_MS);
            resultEl.toggleClass('rl-key-result-bad', !res.ok);
        });

        head.addEventListener('click', () => row.toggleClass('rl-key-open', !row.hasClass('rl-key-open')));
    }

    /**
     * 数据源管理折叠项内「免 Key 源只读行」：源名 + 「免 Key」徽标 + ▸；点击行头内联展开仅展示 hint
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
                    attr: { type: 'checkbox', title: `是否启用「${c.label}」参与「${GROUP_LABELS[group]}」搜索` },
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

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ──────────── 外观 ────────────
        new Setting(containerEl).setHeading().setName('外观');

        new Setting(containerEl)
            .setName('隐藏插件内滚动条')
            .setDesc('隐藏主界面与编辑弹窗内滚动条，滚轮/触控板仍可滚动。阅读器（TXT/EPUB/PDF）不受影响，滚动条始终显示。')
            .addToggle((t) =>
                t.setValue(this.plugin.settings.hideScrollbars).onChange(async (value) => {
                    this.plugin.settings.hideScrollbars = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ── 实验性功能 ──
        new Setting(containerEl).setHeading().setName('实验性功能');

        new Setting(containerEl)
            .setName('内置阅读器打开书籍文件')
            .setDesc('开启后用内置阅读器打开 TXT/EPUB/PDF；关闭用系统默认程序。')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalBookReader).onChange(async (value) => {
                    this.plugin.settings.internalBookReader = value;
                    await this.plugin.saveSettings();
                }),
            );

        new Setting(containerEl)
            .setName('内置播放器打开视频文件')
            .setDesc('开启用内置播放器播放本地影视（mp4/webm 等内嵌，可上下集）；关闭用系统播放器。mkv 等自动转系统。')
            .addToggle((t) =>
                t.setValue(!!this.plugin.settings.internalMediaPlayback).onChange(async (value) => {
                    this.plugin.settings.internalMediaPlayback = value;
                    await this.plugin.saveSettings();
                }),
            );

        // ──────────── 数据管理 ────────────
        new Setting(containerEl).setHeading().setName('数据管理');

        // ① 媒体库目录（原「存储 → 库目录」，迁入数据管理）
        new Setting(containerEl)
            .setName('媒体库目录')
            .setDesc('数据目录（catalog.json、笔记/ 等）。修改即换库，旧数据保留。')
            .addText((text) =>
                text
                    .setPlaceholder('ReelLudic')
                    .setValue(this.plugin.settings.libraryDir)
                    .onChange(async (value) => {
                        this.plugin.settings.libraryDir = value.trim() || 'ReelLudic';
                        await this.plugin.saveSettings();
                        // 顶部名称动态跟随媒体库目录：刷新视图标签标题
                        await this.plugin.refreshHomeTabTitles();
                    }),
            );

        // ② 导出备份与备份恢复（合并原「导出备份」+「从备份恢复」；桌面端走系统文件对话框，非桌面回退 vault 选择器）
        new Setting(containerEl)
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

        // ③ 下载封面（一键迁移：网络封面下载到 封面/{标题}.jpg；开关已移除，字段保留兼容旧数据）
        new Setting(containerEl)
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
                    text.setText('正在迁移中… 0/0');
                    void this.plugin
                        .localizeAllPosters((done, total) => {
                            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                            fill.style.width = `${pct}%`;
                            text.setText(`正在迁移中… ${done}/${total}`);
                        })
                        .then((result) => {
                            prog.removeClass('show');
                            new PosterMigrateModal(this.app, result).open();
                        });
                }),
            );

        // 迁移进度条（紧跟设置行下方，默认隐藏；迁移中显示「正在迁移中… N/M」）
        const prog = containerEl.createDiv({ cls: 'rl-mig-prog' });
        const bar = prog.createDiv({ cls: 'rl-mig-bar' });
        const fill = bar.createDiv({ cls: 'rl-mig-fill' });
        const text = prog.createDiv({ cls: 'rl-mig-text', text: '正在迁移中…' });

        // ③.5 清理孤儿封面（H：列出未被任何条目引用的封面文件，逐项勾选后删除）
        new Setting(containerEl)
            .setName('清理孤儿封面')
            .setDesc('删除封面目录中未被条目引用的文件。')
            .addButton((b) =>
                b.setButtonText('扫描').onClick(async () => {
                    const orphans = await this.plugin.listOrphanPosters();
                    new PosterCleanupModal(this.app, orphans, this.plugin.settings.libraryDir || 'ReelLudic').open();
                }),
            );

        // ──────────── 服务集成（数据源）────────────
        new Setting(containerEl).setHeading().setName('服务集成');

        // 服务集成两折叠项：① 数据源管理（数据源启用 + 数据源凭据 两可折叠子块）+ ② 阅读器翻译管理。
        // 旧 B1 凭据折叠行 / 每类型源链折叠行已完全移除，勾选面板为唯一入口
        this.renderServiceSection(containerEl);

        // ──────────── 关于（支持作者，样式参考 LyricFlux about 区）────────────
        new Setting(containerEl).setHeading().setName('关于');
        const about = containerEl.createDiv({ cls: 'rl-about' });
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
