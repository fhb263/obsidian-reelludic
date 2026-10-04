// 快捷关联入口弹窗（海报墙/列表右键「阅读/观看/播放/启动 · 去关联」直达，替代先开整个编辑表单）：
// 无关联入口时给最小关联编辑器——书/游戏/音乐 = 本地路径单行 + 浏览；影视 = movie 第 1 集 /
// tv·anime 总集数 + 集号网格 + 选中集（集标题 → 网络地址 → 本地路径），底部一次「保存并生效」。
// DOM API 渲染（非 Svelte 组件，复用全局 rl-btn/rl-eps-* 等样式）；保存回调注入，由 main 落库+同步笔记+刷新。
// 🔴 #446 用户裁定：选中集的**三个框与「编辑第 N 集」浮层同序同款同文案**（集标题 → 网络地址（带「粘贴」）→
//    本地路径），⛔ 别再把网络地址排第一个 / 别另写一套占位文字（用户在两个入口之间来回切，两套必然被认成两个功能）。
// 🔴 #454 用户裁定：单路径块的小图标按钮（音乐 = 下载 + 检索、书籍 = 下载）**挂在标签行右旁**
//    （`.rl-qa-lbl-row`，与编辑表单 `.rl-lbl-row` 同款同位），⛔ 别塞回输入框那行（那是用户要改掉的旧位置）。
import { App, Modal, Notice, setIcon } from 'obsidian';
import type { MediaEntry } from 'data/types';
import type { BookProbeResult } from 'pure/bookProgress';
import { buildEpisodeAssocResult, hasAnyEpisodeSource } from 'pure/quickAssociate';
import { episodeHintLabel } from 'pure/episodeAssoc';
import { episodeTitleFromName } from 'pure/episodeScan';
import { cleanPastedText, readClipboardText } from 'services/clipboard';
// 🔴 #506：B站 候选 / 分P —— 与集编辑浮层（§16.30）**同一份纯逻辑**，⛔ 这里不判「谁勾谁不勾」
import {
    biliCheckedRows,
    biliEpisodeQuery,
    biliSelectableRows,
    buildBiliFillRows,
    buildBiliPartUrl,
    formatBiliPlay,
    urlUsedByOtherEp,
    type BiliFillRow,
    type BiliPart,
    type BiliVideo,
} from 'pure/dl/bilibili';
// 🔴 #519：批量搜索未填集（确认表）—— 循环/限速/行模型全在纯模块，⛔ 这里不自己维护游标与进度
import {
    BATCH_PARTS_ANCHOR,
    batchCheckedRows,
    batchProgressText,
    batchSleep,
    batchStopText,
    buildBatchTargets,
    canExpandParts,
    canFillBatch,
    candidatesToMark,
    epRangeOf,
    filterTargetsByRange,
    makeBatchRows,
    normalizeEpRange,
    partCountLabel,
    pickedCandidate,
    pickedUrl,
    runBatchSearch,
    withChecked,
    withPartCount,
    withPicked,
    type BatchRow,
    type BatchTarget,
} from 'pure/biliBatch';

/** 系统文件选择器类别（映射 plugin.pick*Path 白名单） */
export type QuickAssocPickKind = 'book' | 'game' | 'music' | 'video';

/** 弹窗收集到的关联结果（元素均已 trim；影视数组与编辑表单同语义——压缩空位保序，空段缺省不写） */
export interface QuickAssociateResult {
    bookFile?: string;
    gameLaunchPath?: string;
    audioPath?: string;
    /** 影视：压缩空位后的连续已关联序列（index 0 = 第 1 个已关联集；与 entry.episodeFiles 存储语义一致） */
    episodeFiles?: string[];
    episodeUrls?: string[];
    episodeTitles?: string[];
    /** tv/anime 总集数（弹窗内可调）；movie 固定 1 不传 */
    totalEpisodes?: number;
}

export interface QuickAssociateCallbacks {
    /** 系统文件选择器：book=电子书(TXT/EPUB/PDF)；game=.lnk；music=音频；video=可关联视频容器 */
    pickFile: (kind: QuickAssocPickKind) => Promise<string | undefined>;
    /** 书籍基准探针（main 侧 reconcile 进度用；EPUB/失败返回 undefined 跳过） */
    probeBook?: (path: string) => Promise<BookProbeResult | undefined>;
    /** 保存：落库（service.update）+ 同步笔记 + 刷新视图；抛错则弹窗保留并提示 */
    save: (result: QuickAssociateResult) => Promise<void>;
    /** 选视频文件夹（「从文件夹检索剧集」目录选择器；非桌面/取消 → undefined） */
    pickVideoDir?: () => Promise<string | undefined>;
    /** 读文件夹内视频并识别集号（按集号升序；不可读/无命中 → []） */
    scanEpisodeDir?: (dir: string) => Promise<{ ep: number; path: string; name: string }[]>;
    /**
     * 🔴 #506：影视条目「网络地址」标签旁那枚 **B站 搜索小按钮**（与集编辑浮层 §16.28③ / §16.30
     * **同款同位同行为**）。用户报障原话：「怎么在海报墙上右键『播放 - 去关联』弹窗网络链接旁
     * 不显示搜索b站小图标按钮」——真因是那套 `.rl-bili-*` 样式当时**只在 `EntryForm.svelte` 的
     * scoped 样式里**，本弹窗是 DOM-API 组件、拿不到哈希类名（样式已上移 `styles.css` 全局）。
     *  — `biliSearch` = 搜候选（复用 `main.dlBiliSearch`，⛔ 别另写一份请求）；
     *  — `biliParts` = 取分P（`main.dlBiliView`）⇒ 点候选**展开分P 勾选表**（入口 C，可一次填完整季）。
     * ⚠️ `biliSearch` **没注入 ⇒ 那枚按钮不渲染**（⛔ 不画一个点了没反应的按钮，与上面两枚同一条纪律）；
     *    `biliParts` 没注入 / 读不到分P ⇒ 回落「直接填这一条」（与浮层同一条**能力回落**）。
     * ⚠️ 纯逻辑（谁勾谁不勾 / 链接形态）在 `pure/dl/bilibili`，⛔ 这里不判。
     */
    biliSearch?: (keyword: string) => Promise<{ videos: BiliVideo[]; error?: string }>;
    biliParts?: (bvid: string) => Promise<{ title: string; parts: BiliPart[]; error?: string }>;
}

/**
 * 单路径类型（书/游戏/音乐）标签与占位。
 * 🔴 #523：`label` 统一成 **『路径』**（用户：「所有类型条目下的右键编辑条目的播放标题统一改成『路径』标题」，
 *    并要求「两处一起统一」—— 编辑表单与这张快捷关联弹窗都要）。⚠️ 影视侧**不改**：那边一条是「网络地址」、
 *    一条是「本地路径」，是**两条不同的路径**，都叫「路径」会分不清。
 */
const SINGLE_LABEL: Record<'book' | 'game' | 'music', { label: string; title: string; placeholder: string; hint: string }> = {
    book: {
        label: '启动路径',
        title: '关联书籍文件',
        placeholder: '库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）',
        hint: '选择 TXT / EPUB / PDF 电子书',
    },
    game: {
        label: '启动路径',
        title: '关联启动快捷方式',
        placeholder: '库内路径，或系统绝对路径（.lnk）',
        hint: '选择游戏启动快捷方式（.lnk）',
    },
    music: {
        label: '启动路径',
        title: '关联本地音频',
        placeholder: '库内路径，或系统绝对路径（mp3/flac/m4a…）',
        hint: '选择本地音频文件',
    },
};

export class QuickAssociateModal extends Modal {
    private saving = false;
    // 影视状态：集数组（本地编辑副本，prefill 自 entry；总集数只扩不缩防丢数据）
    private files: (string | undefined)[] = [];
    private urls: (string | undefined)[] = [];
    private titles: (string | undefined)[] = [];
    private total = 1;
    private curEp = 0;
    // DOM 引用
    private gridEl!: HTMLDivElement;
    private curTitleEl!: HTMLDivElement;
    private urlInput!: HTMLInputElement;
    private fileInput!: HTMLInputElement;
    private titleInput!: HTMLInputElement;
    private totalInput: HTMLInputElement | null = null;
    private singlePathInput: HTMLInputElement | null = null;
    /** 单路径块的提示行（懒建；见 `setSingleHint`） */
    private singleHintEl: HTMLDivElement | null = null;
    private saveBtn!: HTMLButtonElement;
    // ── #506 B站 候选 / 分P 勾选表（DOM 卡片；`biliCard` = null 表示没开）──
    private biliCard: HTMLDivElement | null = null;
    /** 卡内当前视图：`search` = 候选列表；`parts` = 分P 勾选表；`batch` = 批量搜索确认表（#519） */
    private biliView: 'search' | 'parts' | 'batch' = 'search';
    private biliQuery = '';
    private biliVideos: BiliVideo[] = [];
    private biliRows: BiliFillRow[] = [];
    private biliPickBvid = '';
    private biliPickTitle = '';
    private biliBusy = false;
    private biliErr = '';
    // ── #519 批量搜索未填集（确认表）／#520 加集数区间 ──
    private batchRows: BatchRow[] = [];
    /** 全部未填集的目标（区间只筛它，⛔ 不重新算一遍） */
    private batchAllTargets: BatchTarget[] = [];
    /** 用户填的集数区间两端（1 起；默认 = 未填集的第一个 ~ 最后一个） */
    private batchFrom = 0;
    private batchTo = 0;
    private batchRunning = false;
    /** 「继续」从哪个下标接着跑（= 纯模块返回的 `nextIndex`） */
    private batchCursor = 0;
    private batchDone = 0;
    private batchTotal = 0;
    /** 正在搜的那一集的集号（0 = 没在搜） */
    private batchEpNo = 0;
    /** 停下来时已处理到的集号 + 原因（跑完时都归零） */
    private batchLastEpNo = 0;
    private batchReason = '';
    /** 是否**正常跑完**（false = 遇错停 / 用户停 ⇒ 显示「继续」） */
    private batchFinished = false;
    /** 用户点了「停止」/ 卡片被关 ⇒ 让 `shouldContinue()` 返回 false */
    private batchCancel = false;
    /** 展开了候选列表的行下标（-1 = 都没展开） */
    private batchOpenRow = -1;

    constructor(
        app: App,
        private entry: MediaEntry,
        private cbs: QuickAssociateCallbacks,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        modalEl.style.width = 'min(480px, 92vw)';
        const isVideo = this.entry.type === 'movie' || this.entry.type === 'tv' || this.entry.type === 'anime';

        const wrap = contentEl.createDiv({ cls: 'rl-qa' });
        wrap.createDiv({
            cls: 'rl-nc-desc rl-qa-title',
            text: `《${this.entry.title}》 · ${isVideo ? '关联观看入口' : this.single().title}`,
        });

        if (isVideo) this.buildVideoSection(wrap);
        else this.buildSingleSection(wrap);

        const ops = wrap.createDiv({ cls: 'rl-nc-ops rl-qa-ops' });
        this.saveBtn = ops.createEl('button', { cls: 'rl-btn rl-btn-primary', text: '保存并生效' });
        this.saveBtn.onclick = () => void this.save();
        const cancel = ops.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancel.onclick = () => this.close();
        this.saveBtn.focus();
    }

    /** 书/游戏/音乐：单行本地路径 + 浏览（音乐 = 「下载」「检索」两枚小按钮、书籍 = 「下载」一枚；均在标签右旁） */
    private buildSingleSection(wrap: HTMLElement): void {
        const e = this.entry;
        const meta = this.single();
        const prefill =
            e.type === 'book' ? (e.bookFile ?? '') : e.type === 'game' ? (e.gameLaunchPath ?? '') : (e.audioPath ?? '');

        // 🔴 #454 用户裁定：小图标按钮挂**标签行**（「本地文件路径」右旁），⛔ 不再挤在输入框那行 ——
        //    与编辑表单的 `.rl-lbl-row` 同款同位（表单里书籍那枚就是这样摆的），用户：
        //    「把下载和检索小按钮放在本地路径标题右旁」。
        // 🔴 #521：**本弹窗不再挂「下载 / 检索」小图标**（用户：「右键观看按钮浮窗网络链接按钮删除掉，
        //    干脆统一一下，书籍类游戏音乐也一样」）—— 这两件事在**编辑表单的标签行**上都有（同一份实现），
        //    ⛔ 不在两处重复提供。⇒ 那三个回调（`openMusicDownloader`/`listLibraryAudio`/`openBookDownloader`）
        //    连同 `buildMusicQuickButtons` / `buildBookQuickButton` / `findLibraryAudio` **一并撤掉**
        //    （⛔ 不留死代码；主程序那三个方法**保留** —— `EntryModal` 那侧还在用）。
        const lblRow = wrap.createDiv({ cls: 'rl-qa-lbl-row' });
        lblRow.createDiv({ cls: 'rl-qa-lbl', text: meta.label });

        const row = wrap.createDiv({ cls: 'rl-qa-row' });
        this.singlePathInput = row.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: meta.placeholder, spellcheck: 'false' },
        });
        this.singlePathInput.value = prefill;

        const browse = row.createEl('button', { cls: 'rl-btn rl-link-act', text: '浏览' });
        browse.setAttribute('data-tip', meta.hint);
        browse.onclick = () => void this.pickInto(this.singlePathInput!, this.pickKind());
        if (prefill) this.setSingleHint(`已关联：${prefill}（直接修改可更换）`);
    }

    /** 单路径块的提示行（懒建；目前只有「已关联」这一条反馈 —— ⚠️ #521 起下载/检索不在本弹窗了） */
    private setSingleHint(text: string): void {
        if (!this.singleHintEl) {
            const wrap = this.singlePathInput?.parentElement?.parentElement;
            if (!wrap) return;
            this.singleHintEl = wrap.createDiv({ cls: 'rl-qa-hint' });
        }
        this.singleHintEl.setText(text);
    }

    /** 影视：movie=第 1 集输入区；tv/anime=总集数 + 集号网格 + 选中集输入区 */
    private buildVideoSection(wrap: HTMLElement): void {
        const e = this.entry;
        const maxLen = Math.max(e.episodeFiles?.length ?? 0, e.episodeUrls?.length ?? 0, e.episodeTitles?.length ?? 0);
        this.total = e.type === 'movie' ? 1 : Math.max(1, e.progress?.totalEpisodes ?? maxLen);
        // 🔴 #518：**补齐到总集数**（⛔ 别只 `.slice(0, this.total)`）。存盘数组是**瘦**的
        //   （只到最后一个已关联的集），瘦数组会让分P 勾选表把后面所有分P 判成「超出集数」并**禁用**
        //   ⇒ 第 2 集根本填不进去（用户报障「第2集本身却是空的」的另一半）。
        //   ⚠️ **只扩不缩**：超出的元素留着（用户可能上调总集数），与 `changeTotal` 同一条纪律。
        const pad = <T,>(list: T[] | undefined): T[] => {
            const out = Array.isArray(list) ? list.slice() : [];
            if (out.length < this.total) out.length = this.total;
            return out;
        };
        this.files = pad(e.episodeFiles);
        this.urls = pad(e.episodeUrls);
        this.titles = pad(e.episodeTitles);

        // 🔴 #521：**电影也挂这两枚**（用户：「电影条目观看链接也把这两个按钮移上来」）——
        //    tv/anime 挂在「总集数」行右侧；电影没有总集数行 ⇒ 单开一行只放这两枚工具。
        const toolRow = wrap.createDiv({ cls: 'rl-qa-total' });
        if (e.type !== 'movie') {
            toolRow.createSpan({ cls: 'rl-qa-lbl-inline', text: '总集数' });
            this.totalInput = toolRow.createEl('input', { cls: 'rl-qa-input rl-qa-total-input', attr: { type: 'number', min: '1', step: '1' } });
            this.totalInput.value = String(this.total);
            this.totalInput.onchange = () => this.changeTotal(parseInt(this.totalInput!.value, 10));
            // 上面那个「总集数」输入框占位后再挂两枚工具；`margin-left:auto` 把它们推到右端
        }
        // 批量检索小图标：选文件夹 → 识别集号自动填入未关联集（hover 出说明）
        // 读屏名走隐藏文本而非 aria-label：aria-label 与 data-tip 同元素会让 Obsidian 官方气泡
        // 与自绘气泡叠两层（UI-GUIDE §3 并存禁令）。经全仓扫描，这是唯一一处该违规。
        const batchBtn = toolRow.createEl('button', { cls: 'rl-ai-btn' });
        batchBtn.setAttribute('data-tip', '选文件夹批量填集（已填的不覆盖）');
        batchBtn.onclick = () => void this.batchScan();
        try {
            setIcon(batchBtn, 'folder-search');
        } catch {
            batchBtn.setText('📁');
        }
        // 必须追加在 setIcon / setText 之后：这两个会把元素内容整体替换，先加会被清掉
        batchBtn.createSpan({ cls: 'rl-sr', text: '从文件夹检索剧集' });
        // 🔴 #520：批量搜 B站 **紧挨着「从文件夹检索剧集」**（用户：「小图标按钮是放在观看链接的
        //    检索本地剧集图标按钮的旁边」）—— 两枚都是「批量填集」，所以并排。
        this.buildBiliBatchButton(toolRow);

        this.gridEl = wrap.createDiv({ cls: 'rl-eps-grid rl-qa-grid' });
        this.renderEpGrid();
        const div = wrap.createDiv({ cls: 'rl-qa-cur' });
        this.curTitleEl = div.createDiv({ cls: 'rl-qa-cur-t', text: this.curLabel() });

        // 🔴 #446 顺序 + 文案（用户裁定）：集标题 → 网络地址（带「粘贴」）→ 本地路径，
        //    与「编辑第 N 集」浮层逐字一致（含占位文字），三者一律 `.rl-qa-row` 包一层 = 同一个样式口径。
        div.createDiv({ cls: 'rl-qa-lbl', text: e.type === 'movie' ? '标题' : '集标题' });
        const trow2 = div.createDiv({ cls: 'rl-qa-row' });
        this.titleInput = trow2.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: '如：开始', spellcheck: 'false' },
        });
        // 🔴 #506：B站 搜索小按钮挂在**「网络地址」标签行右旁**（`.rl-qa-lbl-row` + `.rl-ai-btn`）——
        //    与集编辑浮层 §16.28③ 同款同位；⛔ 别塞进下面那个输入框行（那是「粘贴」的位置，
        //    两枚挤一行会被认成两个功能）。
        const urlLblRow = div.createDiv({ cls: 'rl-qa-lbl-row' });
        urlLblRow.createDiv({ cls: 'rl-qa-lbl', text: '网络地址' });
        const urow = div.createDiv({ cls: 'rl-qa-row' });
        this.urlInput = urow.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: 'https://…', spellcheck: 'false' },
        });
        const paste = urow.createEl('button', { cls: 'rl-btn rl-link-act', text: '粘贴' });
        paste.setAttribute('data-tip', '粘贴链接');
        paste.onclick = () => void this.pasteUrl();
        div.createDiv({ cls: 'rl-qa-lbl', text: '本地路径' });
        const frow = div.createDiv({ cls: 'rl-qa-row' });
        this.fileInput = frow.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: '库内路径，或系统绝对路径', spellcheck: 'false' },
        });
        const browse = frow.createEl('button', { cls: 'rl-btn rl-link-act', text: '浏览' });
        browse.setAttribute('data-tip', '选择本地视频');
        browse.onclick = () => void this.pickInto(this.fileInput, 'video');
        this.populateCur();
    }

    // ────────────────────── #506 B站 候选 / 分P 勾选表（DOM 卡片）──────────────────────
    //  🔴 与集编辑浮层（UI-GUIDE §16.30）**同一份纯逻辑、同一套文案**；区别只在承载：
    //     浮层是 Svelte 模板 + scoped 壳 `.rl-ep-edit`，这里是 DOM API + 全局壳 `.rl-bili-card`
    //     （内部件样式在 `styles.css` 全局，那份才是唯一真源）。
    //  ⚠️ 没有 Svelte 的响应式 ⇒ 每次改状态后**整卡重绘**（52 行的表重绘一次可接受；
    //     ⛔ 别去手写增量 DOM 更新 —— 那才是两份口径漂移的温床）。

    // 🔴 #523：原「网络地址」标签旁那枚 B站 搜索小图标（#506）**已整条撤除** ——
    //    用户 2026-10-04 裁定「这些关联浮窗内小图标按钮都不再显示」+「把功能合并到编辑表单路径旁小图标
    //    按钮功能里」⇒ 单集检索改从**批量卡那一行的「单集」入口**进（`openBiliFromBatch`）。
    //    搜索卡本体（`openBiliPicker` / 候选 / 分P 勾选表）原样保留，⛔ 别连它一起删。

    /**
     * #519／#520：**批量搜索未填集**那枚小图标（🔴 挂在「总集数」行上「从文件夹检索剧集」的**右旁**，
     * 同款 `.rl-ai-btn` —— 用户：「小图标按钮是放在观看链接的检索本地剧集图标按钮的旁边」）。
     * ⚠️ `biliSearch` 没注入 ⇒ 不画（⛔ 不画一个点了没反应的按钮，与单集那枚同一条纪律）；
     *    ⚠️ **电影态不画**（它只有一集，单集搜索已经完全覆盖，两枚并列只会让人分不清）。
     */
    private buildBiliBatchButton(row: HTMLElement): void {
        // 🔴 #521：**电影也画**（用户：「电影条目观看链接也把这两个按钮移上来」）——
        //    ⛔ 别再按 `type === 'movie'` 挡掉；电影只搜第 1 集，检索词不补「第1集」（见 buildBatchTargets 的 single）。
        if (!this.cbs.biliSearch) return;
        const btn = row.createEl('button', { cls: 'rl-ai-btn' });
        btn.setAttribute('data-tip', '批量搜索未填的集（可选集数区间，搜完给一张确认表）');
        try {
            setIcon(btn, 'list-video');
        } catch {
            btn.setText('🗂');
        }
        btn.createSpan({ cls: 'rl-sr', text: '批量搜索未填集' });
        btn.onclick = () => this.openBatchPicker();
    }

    /**
     * 🔴 #523：**单集检索**入口（批量卡行内那枚「单集」）。
     * 用户原话：「[集编辑浮层里那枚 B站 图标] 撤掉，把功能合并到编辑表单路径旁小图标按钮功能里」
     *   ⇒ 弹窗这一侧也照同一条纪律：标签行不再挂图标，入口挂在「路径（总集数行那两枚）→ 批量卡 → 单集」链上。
     * ⚠️ 顺序：**先把当前集刷进数组再切 `curEp`**（否则切走时这一集的改动丢了）；
     *    `closeBiliCard()` 会顺手停批 + 拆卡，再由 `openBiliPicker()` 重建 —— ⛔ 别改成叠两层卡
     *    （同 z 层级，后建的批量卡会盖住搜索卡）。
     */
    private async openBiliFromBatch(idx: number): Promise<void> {
        const r = this.batchRows[idx];
        if (!r) return;
        this.flushCurIntoArrays();
        this.curEp = r.epIndex;
        this.renderEpGrid();
        this.populateCur();
        this.closeBiliCard();
        await this.openBiliPicker();
    }

    /**
     * 打开候选卡并立即搜一次（检索词 = 作品标题 + **当前集**标题，与浮层同口径）。
     * 🔴 #517 用户裁定：**每次打开都按当前集重算**（⛔ 别退回「空才算一次」）——
     *    旧写法把检索词缓存成成员变量、`closeBiliCard` 也不清 ⇒ 换个集再点搜索，
     *    用的还是上一个集那份词（用户报障：「点第2集搜索不映射为第2集，还是这个：熊出没」）。
     *    集标题为空时由 `biliEpisodeQuery` 用「第N集」补位；电影态传 0 不做集号补位。
     */
    private async openBiliPicker(): Promise<void> {
        this.flushCurIntoArrays();
        if (!this.biliCard) this.biliCard = this.contentEl.createDiv({ cls: 'rl-bili-card' });
        this.biliView = 'search';
        this.biliRows = [];
        const epNo = this.entry.type === 'movie' ? 0 : this.curEp + 1;
        this.biliQuery = biliEpisodeQuery(this.entry.title, epNo, this.titles[this.curEp] ?? '');
        this.renderBiliCard();
        await this.runBiliSearch();
    }

    /** 关掉候选卡（⛔ 不改弹窗本身 —— 用户可能只是想放弃这次搜索） */
    private closeBiliCard(): void {
        // #519：卡片一关就把正在跑的批量停掉（⛔ 别让它在后台继续打几十个请求）
        this.batchCancel = true;
        this.biliCard?.remove();
        this.biliCard = null;
        this.biliView = 'search';
        this.biliRows = [];
        this.batchRows = [];
        this.batchOpenRow = -1;
        // #517：检索词一并清掉 ⇒ 下次打开必然按当时的集重算（别留着上一个集的词）
        this.biliQuery = '';
    }

    /** 搜一次（卡里那颗「搜索」按钮；也供打开时自动跑） */
    private async runBiliSearch(): Promise<void> {
        if (this.biliBusy || !this.cbs.biliSearch) return;
        const kw = this.biliQuery.trim();
        this.biliVideos = [];
        this.biliErr = '';
        if (!kw) {
            this.biliErr = '先填检索词（默认取作品标题 + 集标题，缺则补第N集）';
            this.renderBiliCard();
            return;
        }
        this.biliBusy = true;
        this.renderBiliCard();
        try {
            const out = await this.cbs.biliSearch(kw);
            this.biliVideos = out.videos ?? [];
            this.biliErr = out.error ?? '';
        } catch (e) {
            this.biliErr = `B 站搜索出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            this.biliBusy = false;
        }
        this.renderBiliCard();
    }

    /**
     * 点一条候选（🔴 **入口 C**：先展开它的分P 让用户勾）。
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（失败 / **只有 1 个分P** = 单集投稿 / 没注入
     *    `biliParts`）⇒ 直接填**当前这一集**并关掉卡片 —— 与浮层 `pickEpBiliUrl` **完全同一条纪律**。
     *    🔴 #518：判据是 `parts.length <= 1`（⛔ 不是 `=== 0`，单集投稿也有 1 条 `pages`）。
     */
    /**
     * 点一条候选（🔴 **入口 C**：先展开它的分P 让用户勾）—— 单集搜索那一侧（锚 = 当前集）。
     * 实现走**两入口共用的** `openBiliParts`（批量卡那枚「展开分P」也走它，只是锚不同）。
     */
    private async pickBiliVideo(v: BiliVideo): Promise<void> {
        await this.openBiliParts(v, this.curEp, this.curEp);
    }

    /**
     * 取这一条候选的分P 并**打开分P 勾选表** —— 🔴 两个入口**共用的唯一实现**：
     *   ① 单集搜索点候选（`anchor` = **当前集**，`fallbackEp` = 当前集）；
     *   ② 批量卡那枚「展开分P」（`anchor` = `BATCH_PARTS_ANCHOR` = **0**，整季合集口径；`fallbackEp = null`）。
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（失败 / **只有 1 个分P** = 单集投稿 / 没注入 `biliParts`）
     *    ⇒ 按 `fallbackEp` 分流：数字 ⇒ 直接填**那一集**并关卡片；`null` ⇒ **只提示不填**
     *    （批量那枚的对象是「整季」，填哪一集都不对）。🔴 #518：判据是 `<= 1`（⛔ 不是 `=== 0`）。
     * ⚠️ 收尾那次 `renderBiliCard()` 用 `filled` 挡住 —— 回落路径已经把卡拆了
     *    （`closeBiliCard()` 把 `biliCard` 置 null），再渲染就是往空引用上画。
     */
    private async openBiliParts(v: BiliVideo, anchor: number, fallbackEp: number | null): Promise<void> {
        if (this.biliBusy) return;
        if (!this.cbs.biliParts) {
            if (fallbackEp === null) {
                new Notice('这个入口没接入分P，展开不了 —— 单集投稿直接勾上那一行即可');
                return;
            }
            this.urlInput.value = v.webUrl;
            this.flushCurIntoArrays();
            this.renderEpGrid();
            this.closeBiliCard();
            new Notice(`已填入当前集（这个入口没接入分P，其余集仍需手动填）${this.dupNote(v.webUrl)}`);
            return;
        }
        this.biliBusy = true;
        this.renderBiliCard();
        let filled = false;
        try {
            const out = await this.cbs.biliParts(v.bvid);
            const parts: BiliPart[] = out.parts ?? [];
            if (out.error || parts.length <= 1) {
                if (fallbackEp === null) {
                    new Notice(out.error
                        ? `读取分P失败（${out.error}），这条没法展开 —— 单集投稿直接勾上那一行即可`
                        : '这条没有可勾的分P（单集投稿），直接勾上那一行即可');
                } else {
                    this.urlInput.value = v.webUrl;
                    this.flushCurIntoArrays();
                    this.renderEpGrid();
                    this.closeBiliCard();
                    const dup = this.dupNote(v.webUrl);
                    new Notice(
                        (out.error ? `读取分P失败（${out.error}），已直接填入这条链接` : '这条没有可勾的分P，已直接填入本集') + dup,
                    );
                    filled = true;
                }
            } else {
                this.biliPickTitle = out.title || v.title;
                this.biliPickBvid = v.bvid;
                // 🔴 口径唯一真源：`buildBiliFillRows`（与浮层同一次调用形态）；
                //   集数按**本条目总集数**（`this.total`）传。
                this.biliRows = buildBiliFillRows(parts, this.urls, anchor, this.total);
                this.biliView = 'parts';
            }
        } catch (e) {
            this.biliErr = `读取分P出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            this.biliBusy = false;
        }
        if (!filled) this.renderBiliCard();
    }

    /**
     * 🔴🔴 #526：批量卡某一行那枚**「展开分P」**（这一行选中的是**整季合集**）。
     * 由来（用户 2026-10-04）：「批量网络检索只能适合单集的，有很多分52p的怎么办」——
     *   批量「填入」写的是候选的 `webUrl`（**恒定 P1**）⇒ 选中 52P 合集的行会被写进
     *   **同一条 P1 链接**（= 第 1 集的内容），用户看不出来。⇒ 多P 默认不勾（`withPartCount`）+ 这枚入口。
     * 🔴 **锚 = `BATCH_PARTS_ANCHOR`（0）**，与单集那条「锚当前集」**有意不同**（整季合集的 P1 = 第 1 集）。
     * ⚠️ 先把当前集刷进数组再切 `curEp`（与 `openBiliFromBatch` 同一条纪律）；
     *   ⛔ 不调 `closeBiliCard()` —— 那张卡要留着切成分P 视图，拆了重建反而多一层闪烁。
     */
    private async expandBatchParts(idx: number): Promise<void> {
        const r = this.batchRows[idx];
        const v = r ? pickedCandidate(r) : undefined;
        if (!r || !v) return;
        this.flushCurIntoArrays();
        this.curEp = r.epIndex;
        this.renderEpGrid();
        this.populateCur();
        await this.openBiliParts(v, BATCH_PARTS_ANCHOR, null);
    }

    /**
     * #517：**单P 直填**前的一句重复提示后缀 —— 这条链接若已被别的集占用，回「（注意：这条链接第 N 集已在用）」。
     * 🔴 2026-10-04 用户裁定：**只提示、不拦截**（用户可能就是要复用同一条链接）；
     *    ⛔ 别改成拒绝填入 —— 那是另一档选项，用户没挑。
     */
    private dupNote(url: string): string {
        const dup = urlUsedByOtherEp(this.urls, url, this.curEp);
        return dup ? `（注意：这条链接第 ${dup} 集已在用）` : '';
    }

    /**
     * 把勾中的分P **批量写进本弹窗的集链接数组**。
     * 🔴 写入的只是**弹窗内的副本**（`this.urls`），**仍要点「保存并生效」才落库** ——
     *    与浮层「只写表单状态」**同一条纪律**，⛔ 这里不直接改条目。
     * 🔴 写完**关掉卡片**（批量填的对象已经不是「当前这一集」了，让「网络地址」框继续显示
     *    一个可能刚被覆盖的旧值会自相矛盾）—— 与浮层「填完收起集编辑浮层」同一个理由。
     */
    private applyBiliParts(): void {
        const picked = biliCheckedRows(this.biliRows);
        if (picked.length === 0) return;
        let n = 0;
        for (const r of picked) {
            const url = buildBiliPartUrl(this.biliPickBvid, r.page);
            if (!url) continue;
            this.urls[r.epIndex] = url;
            n += 1;
        }
        if (n === 0) return;
        this.closeBiliCard();
        this.renderEpGrid();
        // 当前集可能刚被写入 ⇒ 把输入框同步成数组里的新值（⛔ 别留着旧值自相矛盾）
        this.populateCur();
        new Notice(`已把 ${n} 条链接填进对应集（点「保存并生效」落库）`);
    }

    /** 整卡重绘（DOM 卡片没有响应式 ⇒ 状态一变就重画，口径才不会漂） */
    private renderBiliCard(): void {
        const card = this.biliCard;
        if (!card) return;
        card.empty();

        const head = card.createDiv({ cls: 'rl-bili-head' });
        const title =
            this.biliView === 'parts' ? '选择分P' : this.biliView === 'batch' ? '批量搜索未填集' : '搜索 B 站';
        head.createDiv({ cls: 'rl-bili-card-title', text: title });
        const close = head.createEl('button', { cls: 'rl-bili-close', text: '✕' });
        close.setAttribute('data-tip', '关闭');
        close.onclick = () => this.closeBiliCard();

        if (this.biliView === 'batch') {
            this.renderBiliBatch(card);
            return;
        }
        if (this.biliView === 'search') {
            this.renderBiliSearch(card);
            return;
        }
        this.renderBiliParts(card);
    }

    /** 候选列表视图 */
    private renderBiliSearch(card: HTMLElement): void {
        const row = card.createDiv({ cls: 'rl-bili-searchrow' });
        const input = row.createEl('input', {
            cls: 'rl-input',
            attr: { type: 'text', placeholder: '检索词（作品标题 + 集标题，缺则补第N集）', spellcheck: 'false' },
        });
        input.value = this.biliQuery;
        input.oninput = () => {
            this.biliQuery = input.value;
        };
        input.onkeydown = (ev: KeyboardEvent) => {
            if (ev.key === 'Enter') void this.runBiliSearch();
        };
        const go = row.createEl('button', { cls: 'rl-btn rl-link-act', text: this.biliBusy ? '搜索中…' : '搜索' });
        go.disabled = this.biliBusy;
        go.onclick = () => void this.runBiliSearch();

        if (this.biliErr) card.createDiv({ cls: 'rl-hint-note is-error', text: this.biliErr });
        if (this.biliBusy) card.createDiv({ cls: 'rl-hint-note', text: '正在读取分P…' });

        const list = card.createDiv({ cls: 'rl-bili-list' });
        for (const v of this.biliVideos) {
            const r = list.createEl('button', { cls: 'rl-bili-row' });
            r.disabled = this.biliBusy;
            r.setAttribute('data-tip', `展开分P：${v.title}`);
            r.onclick = () => void this.pickBiliVideo(v);
            if (v.coverUrl) {
                const img = r.createEl('img', { cls: 'rl-bili-cover' });
                img.src = v.coverUrl;
                img.alt = '';
                // ⚠️ B站图床按 Referer 防盗链 ⇒ 不加这条就是一片灰底占位（与浮层同款，⛔ 别省）
                img.setAttribute('referrerpolicy', 'no-referrer');
            } else {
                const ph = r.createSpan({ cls: 'rl-bili-cover rl-bili-cover-ph' });
                try {
                    setIcon(ph, 'video');
                } catch {
                    /* 图标不可用：忽略 */
                }
            }
            const main = r.createSpan({ cls: 'rl-bili-main' });
            main.createSpan({ cls: 'rl-bili-name', text: v.title });
            main.createSpan({ cls: 'rl-bili-artist', text: v.author || '未知 UP 主' });
            r.createSpan({ cls: 'rl-bili-pill', text: this.fmtBiliDur(v.durationSec) });
        }
        if (!this.biliBusy && !this.biliErr && this.biliVideos.length === 0 && this.biliQuery.trim()) {
            card.createDiv({ cls: 'rl-hint-note', text: '没搜到，换个检索词试试' });
        }
    }

    /** 分P 勾选表视图（三口径与浮层逐字一致：没链接⇒勾、已有链接⇒不勾但可勾、超出⇒禁用） */
    private renderBiliParts(card: HTMLElement): void {
        const bar = card.createDiv({ cls: 'rl-bili-row-bar rl-bili-parts-bar' });
        const back = bar.createEl('button', { cls: 'rl-btn rl-link-act', text: '‹ 候选' });
        back.setAttribute('data-tip', '回到候选列表，换一条视频');
        back.onclick = () => {
            this.biliView = 'search';
            this.biliRows = [];
            this.renderBiliCard();
        };
        const src = bar.createSpan({ cls: 'rl-bili-parts-src', text: this.biliPickTitle || this.biliPickBvid });
        if (this.biliPickTitle) src.setAttribute('data-tip', this.biliPickTitle);

        const can = biliSelectableRows(this.biliRows);
        const picked = biliCheckedRows(this.biliRows);
        const withUrl = this.biliRows.filter((r) => r.hasUrl).length;
        const over = this.biliRows.filter((r) => r.outOfRange).length;

        const bar2 = card.createDiv({ cls: 'rl-bili-row-bar rl-bili-parts-bar' });
        const all = bar2.createEl('label', { cls: 'rl-bili-all' });
        const allBox = all.createEl('input', { attr: { type: 'checkbox' } });
        allBox.checked = can.length > 0 && can.every((r) => r.checked);
        allBox.onchange = () => {
            const on = allBox.checked;
            // ⚠️ `outOfRange` 的行**不参与全选**（禁用行不能被勾上）—— 与浮层同一条守卫
            this.biliRows = this.biliRows.map((r) => (r.outOfRange ? r : { ...r, checked: on }));
            this.renderBiliCard();
        };
        all.createSpan({ text: '全选' });
        const sum = bar2.createSpan({ cls: 'rl-bili-parts-sum' });
        sum.appendText(`共 ${this.biliRows.length} 个分P · 已勾 `);
        sum.createEl('b', { text: String(picked.length) });
        sum.appendText(' 集');
        if (withUrl) sum.appendText(` · 其中 ${withUrl} 集已有链接`);
        if (over) sum.appendText(` · ${over} 个超出本条目集数`);

        const list = card.createDiv({ cls: 'rl-bili-parts-list' });
        for (const r of this.biliRows) {
            const row = list.createEl('label', { cls: 'rl-bili-part-row' + (r.outOfRange ? ' rl-bili-part-off' : '') });
            const box = row.createEl('input', { attr: { type: 'checkbox' } });
            box.checked = r.checked;
            box.disabled = r.outOfRange;
            box.onchange = () => {
                const on = box.checked;
                this.biliRows = this.biliRows.map((x) => (x.epIndex === r.epIndex ? { ...x, checked: on } : x));
                this.renderBiliCard();
            };
            row.createSpan({ cls: 'rl-bili-part-ep', text: `第 ${r.epNo} 集` });
            const name = row.createSpan({ cls: 'rl-bili-part-name' });
            name.createSpan({ cls: 'rl-bili-part-no', text: `P${r.page}` });
            name.appendText(r.part || '（未命名）');
            if (r.part) name.setAttribute('data-tip', r.part);
            if (r.hasUrl) row.createSpan({ cls: 'rl-bili-pill rl-bili-pill-warn', text: '已有链接' });
            if (r.outOfRange) row.createSpan({ cls: 'rl-bili-pill', text: '超出集数' });
        }

        const ops = card.createDiv({ cls: 'rl-bili-parts-ops' });
        const apply = ops.createEl('button', { cls: 'rl-btn', text: `填入选中的 ${picked.length} 集` });
        apply.disabled = picked.length === 0;
        apply.setAttribute('data-tip', '填进本弹窗的集链接（仍要点「保存并生效」才落库）');
        apply.onclick = () => this.applyBiliParts();
    }

    // ────────────────────── #519 批量搜索未填集（确认表）──────────────────────
    //
    //  🔴 与上面两枚的分工：`搜索 B站` = **单集、交互式**（点候选 → 分P 勾选表）；
    //     本视图 = **批量、表格式**（把未填集全搜一遍 → 逐行确认 → 一次填入）。
    //  🔴 循环 / 限速 / 遇错即停 / 行模型**全在 `pure/biliBatch`**（两个入口共用同一份），
    //     ⛔ 这里只负责「画」+「把状态存进成员变量」，别自己维护游标与进度。

    /**
     * 打开批量确认表（🔴 #520：**只开卡、不自动跑** —— 用户裁定「选了才跑」）。
     * 先算「全部未填集」并把区间默认成它的第一个 ~ 最后一个；一个未填集都没有就直接提示。
     */
    private openBatchPicker(): void {
        this.flushCurIntoArrays();
        const all = buildBatchTargets(this.entry.title, this.urls, this.total, this.titles, this.entry.type === 'movie');
        if (all.length === 0) {
            new Notice('本条目没有未填的集');
            return;
        }
        this.batchAllTargets = all;
        const d = epRangeOf(all);
        this.batchFrom = d.from;
        this.batchTo = d.to;
        if (!this.biliCard) this.biliCard = this.contentEl.createDiv({ cls: 'rl-bili-card' });
        this.biliView = 'batch';
        this.biliRows = [];
        this.batchRows = [];
        this.batchRunning = false;
        this.batchCancel = false;
        this.batchOpenRow = -1;
        this.batchDone = 0;
        this.batchTotal = 0;
        this.batchEpNo = 0;
        this.batchLastEpNo = 0;
        this.batchReason = '';
        this.batchFinished = false;
        this.renderBiliCard();
    }

    /** 按当前区间**重开一轮**（用户点了「搜索」）：整表重来、游标归零 */
    private async startBatch(): Promise<void> {
        const all = this.batchAllTargets;
        const range = normalizeEpRange(this.batchFrom, this.batchTo, all[0]?.epNo ?? 0, all[all.length - 1]?.epNo ?? 0);
        this.batchFrom = range.from;
        this.batchTo = range.to;
        const picked = filterTargetsByRange(all, range);
        if (picked.length === 0) {
            new Notice('这个区间里没有未填的集');
            return;
        }
        this.batchRows = makeBatchRows(picked, this.entry.title);
        this.batchCursor = 0;
        this.batchDone = 0;
        this.batchTotal = picked.length;
        this.batchEpNo = 0;
        this.batchLastEpNo = 0;
        this.batchReason = '';
        this.batchFinished = false;
        this.batchCancel = false;
        this.batchOpenRow = -1;
        await this.runBatch();
    }

    /** 「继续」：从上次停下的那一集接着跑（⛔ 不重建表，已搜到的保留） */
    private async continueBatch(): Promise<void> {
        if (this.batchRows.length === 0) return this.startBatch();
        await this.runBatch();
    }

    /** 跑（或「继续」跑）：全部逻辑在 `runBatchSearch`，这里只注入回调 + 渲染 */
    private async runBatch(): Promise<void> {
        if (this.batchRunning) return;
        if (!this.cbs.biliSearch || !this.cbs.biliParts) return;
        this.batchRunning = true;
        this.batchCancel = false;
        this.batchReason = '';
        this.renderBiliCard();
        try {
            const out = await runBatchSearch(
                this.batchRows,
                {
                    search: (kw) => this.cbs.biliSearch!(kw),
                    parts: (bvid) => this.cbs.biliParts!(bvid),
                    onUpdate: (rows, done, total, epNo) => {
                        this.batchRows = rows;
                        this.batchDone = done;
                        this.batchTotal = total;
                        this.batchEpNo = epNo;
                        this.renderBiliCard();
                    },
                    // 用户点「停止」/ 卡片被关 ⇒ 立刻收手（⛔ 别在后台接着打请求）
                    shouldContinue: () => !this.batchCancel && !!this.biliCard,
                },
                this.batchCursor,
            );
            this.batchRows = out.rows;
            this.batchCursor = out.nextIndex;
            this.batchLastEpNo = out.lastEpNo;
            this.batchReason = out.reason;
            this.batchFinished = out.done;
        } finally {
            this.batchRunning = false;
            this.batchEpNo = 0;
            this.renderBiliCard();
        }
    }

    /** 整表重绘（DOM 卡没有响应式 ⇒ 状态一变就重画，口径才不会漂） */
    private renderBiliBatch(card: HTMLElement): void {
        // 🔴 #520 集数区间：默认 = 未填集的第一个 ~ 最后一个；⛔ 进卡**不自动跑**，点「搜索」才跑
        const range = card.createDiv({ cls: 'rl-bili-batch-range' });
        range.createSpan({ cls: 'rl-bili-batch-range-hint', text: '集数区间' });
        // 🔴 #522：`rl-bili-batch-num` 是宽度裁判的必需件（与浮层同款，见 styles.css 那条注释）。
        // ⚠️ 弹窗侧没有 scoped 规则 ⇒ 少挂这颗类时**这里看着是好的**，坏的是表单侧 ⇒ 别只测这一侧。
        const fromIn = range.createEl('input', { cls: 'rl-input rl-bili-batch-num', attr: { type: 'number', min: '1' } });
        fromIn.value = String(this.batchFrom || '');
        fromIn.onchange = () => {
            this.batchFrom = Number(fromIn.value);
        };
        range.createSpan({ cls: 'rl-bili-batch-range-sep', text: '–' });
        const toIn = range.createEl('input', { cls: 'rl-input rl-bili-batch-num', attr: { type: 'number', min: '1' } });
        toIn.value = String(this.batchTo || '');
        toIn.onchange = () => {
            this.batchTo = Number(toIn.value);
        };
        const go = range.createEl('button', { cls: 'rl-bili-batch-btn is-primary', text: '搜索' });
        go.disabled = this.batchRunning;
        go.setAttribute('data-tip', '按这个区间搜**未填**的集（整表重来）');
        go.onclick = () => void this.startBatch();

        const bar = card.createDiv({ cls: 'rl-bili-batch-bar' });
        if (this.batchRunning) {
            bar.createDiv({ cls: 'rl-bili-batch-note', text: batchProgressText(this.batchDone, this.batchTotal, this.batchEpNo) });
            const stop = bar.createEl('button', { cls: 'rl-bili-batch-btn is-ghost', text: '停止' });
            stop.setAttribute('data-tip', '停下（已搜到的保留，可再点「继续」）');
            stop.onclick = () => {
                this.batchCancel = true;
            };
        } else if (this.batchFinished) {
            bar.createDiv({
                cls: 'rl-bili-batch-note',
                text: `已搜完 ${this.batchTotal} 集 · 勾选 ${batchCheckedRows(this.batchRows).length} 集`,
            });
        } else if (this.batchRows.length > 0) {
            bar.createDiv({
                cls: 'rl-bili-batch-note' + (this.batchReason ? ' is-error' : ''),
                text: batchStopText(this.batchLastEpNo, this.batchReason),
            });
            const more = bar.createEl('button', { cls: 'rl-bili-batch-btn is-ghost', text: '继续' });
            more.setAttribute('data-tip', `从第 ${this.batchLastEpNo + 1} 集接着搜`);
            more.onclick = () => void this.continueBatch();
        } else {
            bar.createDiv({
                cls: 'rl-bili-batch-note',
                text: `选好区间后点「搜索」——只会搜**还没关联**的集（共 ${this.batchAllTargets.length} 个）`,
            });
        }

        const list = card.createDiv({ cls: 'rl-bili-batch-list' });
        this.batchRows.forEach((r, idx) => {
            const item = list.createDiv({ cls: 'rl-bili-batch-item' });
            const hitRow = item.createDiv({
                cls: 'rl-bili-batch-row' + (pickedCandidate(r) ? '' : ' rl-bili-batch-off'),
            });
            const box = hitRow.createEl('input', { attr: { type: 'checkbox' } });
            box.checked = r.checked;
            box.disabled = !pickedUrl(r);
            // 🔴 #526：多P 合集的行**默认没被勾上**（填 P1 会指向第 1 集）⇒ 提示语要说清怎么走
            box.setAttribute('data-tip', !pickedUrl(r)
                ? '这一集没有可填的链接'
                : (canExpandParts(r) ? '整季合集：直接勾上只会填第 1 集 —— 建议用「展开分P」' : '参与「填入」'));
            box.onchange = () => this.toggleBatchRow(idx, box.checked);
            hitRow.createSpan({ cls: 'rl-bili-batch-ep', text: `第 ${r.epNo} 集` });

            const hit = hitRow.createDiv({ cls: 'rl-bili-batch-hit' });
            const v = pickedCandidate(r);
            if (v) {
                if (v.coverUrl) {
                    const img = hit.createEl('img', { cls: 'rl-bili-cover' });
                    img.src = v.coverUrl;
                    img.alt = '';
                    // B站图床按 Referer 防盗链 ⇒ 少了就是一个灰底占位**且不报错**（与候选列表同款）
                    img.setAttribute('referrerpolicy', 'no-referrer');
                } else {
                    const ph = hit.createSpan({ cls: 'rl-bili-cover rl-bili-cover-ph' });
                    try {
                        setIcon(ph, 'video');
                    } catch {
                        /* 图标不可用：忽略 */
                    }
                }
                const main = hit.createDiv({ cls: 'rl-bili-main' });
                main.createSpan({ cls: 'rl-bili-batch-name', text: v.title });
                main.createSpan({ cls: 'rl-bili-artist', text: v.author || '未知 UP 主' });
                // 🔴 分P 胶囊：一眼区分「单集投稿」与「整季合集」（没标出来 ⇒ 不显示，⛔ 别写 `?P`）
                const pc = partCountLabel(r.partCounts[v.bvid] ?? 0);
                if (pc) {
                    const pill = hit.createSpan({ cls: 'rl-bili-batch-parts', text: pc });
                    pill.setAttribute('data-tip', pc === '1P' ? '单集投稿（只有 1 个分P）' : `整季合集（${pc} 个分P）`);
                }
                // 🔴 #520：**不展示链接**（用户：「要把视频标题完整展示不展示链接」）——
                //    链接挪到这条命中区的 data-tip（想核对链接时悬停即可）。
                hit.setAttribute('data-tip', pickedUrl(r));
                if (!r.matched) {
                    hitRow
                        .createSpan({ cls: 'rl-bili-batch-warn', text: '标题不含作品名' })
                        .setAttribute('data-tip', '标题里没有本条目作品名，所以没替你勾上');
                }
            } else {
                hitRow.createDiv({
                    cls: 'rl-bili-batch-note',
                    text: r.error || (this.batchRunning ? '…' : '未搜到'),
                });
            }
            // 🔴 #523：**单集检索**入口 —— 原「网络地址」旁那枚 B站 图标撤除后合并到这里
            //    （切到这一集 + 打开单集搜索卡；分P 勾选表与候选列表都是原样那套）。
            if (v) {
                const one = hitRow.createEl('button', { cls: 'rl-bili-batch-toggle', text: '单集' });
                one.setAttribute('data-tip', '打开这一集的搜索卡并搜 B站（含分P 勾选）');
                one.onclick = () => void this.openBiliFromBatch(idx);
            }
            // 🔴 #526：**整季合集专用**入口 —— 直接开这一条候选的分P 勾选表（锚 = 第 1 集）。
            //    批量「填入」对多P 候选只会写 P1（= 第 1 集），所以多P 行默认不勾、走这枚一次填整季。
            if (canExpandParts(r)) {
                const ex = hitRow.createEl('button', { cls: 'rl-bili-batch-toggle is-parts', text: '展开分P' });
                ex.setAttribute('data-tip', '这条是整季合集：展开分P 勾选表，一次填多集（分P i ↔ 第 i 集）');
                ex.onclick = () => void this.expandBatchParts(idx);
            }
            if (r.videos.length > 1) {
                const tg = hitRow.createEl('button', {
                    cls: 'rl-bili-batch-toggle',
                    text: this.batchOpenRow === idx ? '收起' : '换一条',
                });
                tg.setAttribute('data-tip', `这一集搜到 ${r.videos.length} 条候选`);
                tg.onclick = () => void this.toggleBatchCands(idx);
            }
            if (this.batchOpenRow === idx) this.renderBiliCands(item, r, idx);
        });

        const ops = card.createDiv({ cls: 'rl-bili-batch-ops' });
        const n = batchCheckedRows(this.batchRows).length;
        const fill = ops.createEl('button', { cls: 'rl-bili-batch-btn is-primary', text: `填入勾中的 ${n} 集` });
        fill.disabled = !canFillBatch(this.batchRows);
        fill.setAttribute('data-tip', '只填进本弹窗（仍要点「保存并生效」才落库）');
        fill.onclick = () => this.applyBatchFill();
    }

    /** 展开某一行的候选列表（收起再点 = 只收起，不重复打请求） */
    private async toggleBatchCands(idx: number): Promise<void> {
        if (this.batchOpenRow === idx) {
            this.batchOpenRow = -1;
            this.renderBiliCard();
            return;
        }
        this.batchOpenRow = idx;
        this.renderBiliCard();
        await this.markBatchCands(idx);
    }

    /** 展开时给**前几条**候选补标分P 数（串行 + 限速；⛔ 用户收起/换行就立刻收手） */
    private async markBatchCands(idx: number): Promise<void> {
        for (const v of candidatesToMark(this.batchRows[idx])) {
            await this.markPartCount(idx, v.bvid);
            if (this.batchOpenRow !== idx || !this.biliCard) return;
            await batchSleep();
        }
    }

    /**
     * 取一条候选的分P 数并记进行里。
     * 🔴 取不到（失败 / 没有 `pages`）⇒ **什么都不写**（胶囊留空）—— 链接照常可用，
     *    ⛔ 别把「标不出分P」当成失败（与 `runBatchSearch` 同一条纪律）。
     */
    private async markPartCount(idx: number, bvid: string): Promise<void> {
        if (!this.cbs.biliParts) return;
        const out = await this.cbs.biliParts(bvid);
        const n = Array.isArray(out?.parts) ? out.parts.length : 0;
        if (n > 0) this.batchRows = this.batchRows.map((r, i) => (i === idx ? withPartCount(r, bvid, n) : r));
        if (this.biliCard) this.renderBiliCard();
    }

    /** 某一行展开后的候选列表（点一条 = 换成它；换选即视作要填这一行） */
    private renderBiliCands(item: HTMLElement, r: BatchRow, idx: number): void {
        const box = item.createDiv({ cls: 'rl-bili-batch-cands' });
        r.videos.forEach((v, ci) => {
            const b = box.createEl('button', { cls: 'rl-bili-batch-cand' + (ci === r.picked ? ' is-cur' : '') });
            b.setAttribute('data-tip', ci === r.picked ? '当前选中' : '换成这一条');
            b.onclick = () => void this.pickBatchCand(idx, ci);
            if (v.coverUrl) {
                const img = b.createEl('img', { cls: 'rl-bili-cover' });
                img.src = v.coverUrl;
                img.alt = '';
                img.setAttribute('referrerpolicy', 'no-referrer');
            }
            const main = b.createDiv({ cls: 'rl-bili-main' });
            main.createSpan({ cls: 'rl-bili-batch-name', text: v.title });
            main.createSpan({ cls: 'rl-bili-artist', text: v.author || '未知 UP 主' });
            const pc = partCountLabel(r.partCounts[v.bvid] ?? 0);
            if (pc) b.createSpan({ cls: 'rl-bili-batch-parts', text: pc });
        });
    }

    /** 换成第 `ci` 条候选（顺手把它没标过的分P 数补上） */
    private async pickBatchCand(idx: number, ci: number): Promise<void> {
        this.batchRows = this.batchRows.map((r, i) => (i === idx ? withPicked(r, ci) : r));
        this.batchOpenRow = -1;
        this.renderBiliCard();
        const v = pickedCandidate(this.batchRows[idx]);
        if (v && !this.batchRows[idx].partCounts[v.bvid]) await this.markPartCount(idx, v.bvid);
    }

    /** 勾 / 取消勾一行 */
    private toggleBatchRow(idx: number, checked: boolean): void {
        this.batchRows = this.batchRows.map((r, i) => (i === idx ? withChecked(r, checked) : r));
        this.renderBiliCard();
    }

    /**
     * 把勾中的行写进**弹窗内的集链接数组**（`this.urls`）。
     * 🔴 只写内存副本，**仍要点「保存并生效」才落库** —— 与「粘贴」/ 分P 勾选表同一条纪律。
     * 🔴 写入按 `r.epIndex`（未填集的真实下标），**已填的集根本不在表里** ⇒ 不会跨集覆盖。
     */
    private applyBatchFill(): void {
        const picked = batchCheckedRows(this.batchRows);
        if (picked.length === 0) return;
        let n = 0;
        for (const r of picked) {
            const url = pickedUrl(r);
            if (!url) continue;
            this.urls[r.epIndex] = url;
            n += 1;
        }
        if (n === 0) return;
        this.closeBiliCard();
        this.renderEpGrid();
        this.populateCur();
        new Notice(`已把 ${n} 集的链接填进对应集（点「保存并生效」落库）`);
    }

    /** 时长文本（空 / 0 ⇒ 破折号，与浮层 `formatDuration` 的表现一致） */
    private fmtBiliDur(sec: number): string {
        const s = Number(sec);
        if (!Number.isFinite(s) || s <= 0) return '—';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = Math.floor(s % 60);
        const pad = (n: number) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
    }

    /** 集号网格重绘：linked=已有源 accent；当前选中描边高亮；未关联集可点 */
    private renderEpGrid(): void {
        const g = this.gridEl;
        g.empty();
        for (let i = 0; i < this.total; i++) {
            const linked = !!this.files[i] || !!this.urls[i];
            const btn = g.createEl('button', {
                cls: 'rl-eps-btn' + (linked ? ' linked' : '') + (i === this.curEp ? ' cur' : ''),
                text: String(i + 1),
            });
            // 悬停文案与「编辑第 N 集」浮层同一份真源（`pure/episodeAssoc`）；电影态无标题时回落到「观看链接」
            const title = this.titles[i];
            const linkedTip =
                this.entry.type === 'movie'
                    ? episodeHintLabel(i, title, true) || '观看链接'
                    : episodeHintLabel(i, title, false);
            btn.setAttribute('data-tip', linkedTip);
            btn.onclick = () => {
                this.flushCurIntoArrays();
                // #517：候选卡是拿**当时那一集**的检索词搜出来的 ⇒ 一换集就收掉它，
                //    别留一张挂着「与第 N 集无关的检索词 / 结果」的卡（用户报障的「别扭」正是这个）。
                this.closeBiliCard();
                this.curEp = i;
                this.renderEpGrid();
                this.populateCur();
            };
        }
    }

    /** 批量检索：选文件夹 → 读目录识别集号 → 未关联集保位填入本地路径 + 从文件名派生集标题（只填空位）；
     *  总集数自动扩到最大命中集号。已填本地路径的集跳过（不覆盖手填值），集标题照补。 */
    private async batchScan(): Promise<void> {
        if (!this.cbs.pickVideoDir || !this.cbs.scanEpisodeDir) return;
        this.flushCurIntoArrays();
        const dir = await this.cbs.pickVideoDir();
        if (!dir) {
            new Notice('未选择文件夹或系统对话框不可用');
            return;
        }
        const hits = await this.cbs.scanEpisodeDir(dir);
        if (hits.length === 0) {
            new Notice('该文件夹没有可识别集号的视频文件', 5000);
            return;
        }
        const maxEp = hits[hits.length - 1].ep;
        // 只扩不缩：数组保位扩到最大集号（与总集数扩展同规则，防丢数据）
        if (maxEp > this.files.length) this.files.length = maxEp;
        if (maxEp > this.urls.length) this.urls.length = maxEp;
        if (maxEp > this.titles.length) this.titles.length = maxEp;
        let filled = 0;
        let skipped = 0;
        let titled = 0;
        for (const h of hits) {
            const i = h.ep - 1;
            // #446 集标题：从**文件名**派生预填（`1.新邻居.mp4` → 「新邻居」）。只填空位（⛔ 不覆盖手填），
            // 且不受「本地路径是否已关联」影响 —— 集标题与路径是两件事，重扫一次也该把标题补齐。
            if (!this.titles[i]) {
                const t = episodeTitleFromName(h.name);
                if (t) {
                    this.titles[i] = t;
                    titled++;
                }
            }
            if (this.files[i]) {
                skipped++;
                continue;
            }
            this.files[i] = h.path;
            filled++;
        }
        if (maxEp > this.total) {
            this.total = maxEp;
            if (this.totalInput) this.totalInput.value = String(maxEp);
        }
        if (this.curEp >= this.total) {
            this.curEp = this.total - 1;
        }
        this.renderEpGrid();
        this.populateCur();
        new Notice(
            `已填入 ${filled} 集本地路径${titled ? `、${titled} 个集标题` : ''}${skipped ? `，跳过已关联 ${skipped} 集` : ''}`,
            4000,
        );
    }

    /** 总集数变化：只扩不缩（防输入中间值丢数据），截断展示；越界钳制；显示与内部值同步 */
    private changeTotal(raw: number): void {
        const n = Number.isInteger(raw) && raw > 0 ? raw : this.total;
        if (n > this.files.length) this.files.length = n;
        if (n > this.urls.length) this.urls.length = n;
        if (n > this.titles.length) this.titles.length = n;
        this.total = n;
        if (this.totalInput) this.totalInput.value = String(n);
        if (this.curEp >= n) {
            this.curEp = n - 1;
            this.populateCur();
        }
        this.renderEpGrid();
    }

    /** 当前集输入回填（curEp 切换 / 初始） */
    private populateCur(): void {
        this.curTitleEl.setText(this.curLabel());
        this.urlInput.value = this.urls[this.curEp] ?? '';
        this.fileInput.value = this.files[this.curEp] ?? '';
        this.titleInput.value = this.titles[this.curEp] ?? '';
    }

    /** 将当前集输入写回数组（切换/保存前调用；trim 后空串存 undefined） */
    private flushCurIntoArrays(): void {
        const i = this.curEp;
        this.urls[i] = this.urlInput.value.trim() || undefined;
        this.files[i] = this.fileInput.value.trim() || undefined;
        this.titles[i] = this.titleInput.value.trim() || undefined;
    }

    private curLabel(): string {
        const t = this.titles[this.curEp];
        if (this.entry.type === 'movie') return t ? `标题：${t}` : '观看链接';
        return `第 ${this.curEp + 1} 集${t ? `：${t}` : ''}`;
    }

    /** 「粘贴」：读剪贴板 → 清洗 → 填入**当前集**的网络地址（与「浏览」同款：只填框，仍要点「保存并生效」） */
    private async pasteUrl(): Promise<void> {
        const raw = await readClipboardText();
        const v = raw ? cleanPastedText(raw) : '';
        if (!v) {
            new Notice('读取剪贴板失败或为空，请手动粘贴');
            return;
        }
        this.urlInput.value = v;
    }

    /** 浏览选中文件回填到指定输入框 */
    private async pickInto(input: HTMLInputElement, kind: QuickAssocPickKind): Promise<void> {
        const p = await this.cbs.pickFile(kind);
        if (p) {
            input.value = p;
            new Notice('已选择，点「保存并生效」落库');
        } else {
            new Notice('未选择文件或系统对话框不可用，可手动输入路径');
        }
    }

    private pickKind(): QuickAssocPickKind {
        return this.entry.type === 'book' ? 'book' : this.entry.type === 'game' ? 'game' : 'music';
    }

    private single(): { label: string; title: string; placeholder: string; hint: string } {
        const t = this.entry.type;
        if (t === 'game') return SINGLE_LABEL.game;
        if (t === 'music') return SINGLE_LABEL.music;
        return SINGLE_LABEL.book;
    }

    /** 保存并生效：收集 → 校验 → 回调（main 落库+同步笔记+刷新）→ 成功后关闭 */
    private async save(): Promise<void> {
        if (this.saving) return;
        this.saving = true;
        this.saveBtn.disabled = true;
        try {
            const r: QuickAssociateResult = {};
            if (this.isVideo()) {
                this.flushCurIntoArrays();
                const n = this.total;
                const built = buildEpisodeAssocResult({
                    files: this.files,
                    urls: this.urls,
                    titles: this.titles,
                    total: n,
                    origTotal: this.entry.type === 'movie' ? undefined : this.entry.progress?.totalEpisodes,
                    allowTotalChange: this.entry.type !== 'movie',
                });
                Object.assign(r, built);
                if (built.totalEpisodes === undefined && !hasAnyEpisodeSource(this.files, this.urls, n)) {
                    new Notice('请至少填写一集的网络地址或本地路径');
                    return;
                }
            } else if (this.singlePathInput) {
                const v = this.singlePathInput.value.trim();
                if (!v) {
                    // 🔴 #523：标签已统一成「路径」⇒ 这句校验文案跟着改（⛔ 别指向一个界面上不存在的标签名）
                    new Notice('请填写或浏览选择路径');
                    return;
                }
                if (this.entry.type === 'book') r.bookFile = v;
                else if (this.entry.type === 'game') r.gameLaunchPath = v;
                else r.audioPath = v;
            }
            await this.cbs.save(r);
            this.close();
        } catch (err) {
            new Notice(`关联保存失败：${err instanceof Error ? err.message : String(err)}`, 5000);
        } finally {
            this.saving = false;
            this.saveBtn.disabled = false;
        }
    }

    private isVideo(): boolean {
        const t = this.entry.type;
        return t === 'movie' || t === 'tv' || t === 'anime';
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
