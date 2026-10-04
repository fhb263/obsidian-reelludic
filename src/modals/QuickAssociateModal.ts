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
// #406：音乐条目的「检索库内同名音频」——与条目编辑表单那枚小按钮**同一个真源**
import { pickLibraryAudio, type LibraryAudioFile } from 'pure/libraryAudio';
// 🔴 #506：B站 候选 / 分P —— 与集编辑浮层（§16.30）**同一份纯逻辑**，⛔ 这里不判「谁勾谁不勾」
import {
    biliCheckedRows,
    biliSelectableRows,
    buildBiliFillRows,
    buildBiliPartUrl,
    formatBiliPlay,
    type BiliFillRow,
    type BiliPart,
    type BiliVideo,
} from 'pure/dl/bilibili';

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
     * 🔴 #406：音乐条目的两枚小按钮（**与条目编辑表单里那两枚同款同作用**，用户：「在本地文件路径旁
     * 新增『下载』和『检索』两个摘要总结同款小按钮，其作用类型与原有按钮保持一致」）：
     *  - `openMusicDownloader` = 「下载」：打开「下载歌曲」弹窗；`onPicked(relPath)` 回传落盘后的
     *    **库内相对路径**（弹窗把它填进「本地文件路径」）；
     *  - `listLibraryAudio` = 「检索」：**库内音乐目录**下的音频清单（匹配真源 `pure/libraryAudio`）。
     *  ⚠️ 某个回调没注入 ⇒ **那枚按钮不渲染**（⛔ 不画一个点了没反应的按钮）。
     */
    openMusicDownloader?: (title: string, author: string, onPicked: (relPath: string) => void) => void;
    listLibraryAudio?: () => LibraryAudioFile[];
    /**
     * 🔴 #454：**书籍**条目的「下载」小按钮（与音乐那枚**同款同位**：挂在「本地文件路径」标签右旁）——
     * 打开「下载书籍」弹窗（走**书源**通道，书源由用户自备；文学 / 网文各开各的窗口由宿主决定），
     * 下载完成回传**库内相对路径**，弹窗把它填进「本地文件路径」。
     * ⚠️ 某个回调没注入 ⇒ **那枚按钮不渲染**（⛔ 不画一个点了没反应的按钮）。
     */
    openBookDownloader?: (onPicked: (relPath: string) => void) => void;
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

/** 单路径类型（书/游戏/音乐）标签与占位 */
const SINGLE_LABEL: Record<'book' | 'game' | 'music', { label: string; title: string; placeholder: string; hint: string }> = {
    book: {
        label: '本地文件路径',
        title: '关联书籍文件',
        placeholder: '库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）',
        hint: '选择 TXT / EPUB / PDF 电子书',
    },
    game: {
        label: '本地文件路径',
        title: '关联启动快捷方式',
        placeholder: '库内路径，或系统绝对路径（.lnk）',
        hint: '选择游戏启动快捷方式（.lnk）',
    },
    music: {
        label: '本地文件路径',
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
    /** 卡内当前视图：`search` = 候选列表；`parts` = 选中那条的分P 勾选表（与浮层同口径） */
    private biliView: 'search' | 'parts' = 'search';
    private biliQuery = '';
    private biliVideos: BiliVideo[] = [];
    private biliRows: BiliFillRow[] = [];
    private biliPickBvid = '';
    private biliPickTitle = '';
    private biliBusy = false;
    private biliErr = '';

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
        const lblRow = wrap.createDiv({ cls: 'rl-qa-lbl-row' });
        lblRow.createDiv({ cls: 'rl-qa-lbl', text: meta.label });
        if (e.type === 'music') this.buildMusicQuickButtons(lblRow);
        if (e.type === 'book') this.buildBookQuickButton(lblRow);

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

    /** 音乐：标签旁的「下载」「检索」两枚小按钮（#406；缺哪个回调就不画哪枚） */
    private buildMusicQuickButtons(row: HTMLElement): void {
        const e = this.entry;
        if (this.cbs.openMusicDownloader) {
            const dl = row.createEl('button', { cls: 'rl-ai-btn' });
            dl.setAttribute('data-tip', '按歌名 / 歌手搜歌下载');
            try {
                setIcon(dl, 'download');
            } catch {
                /* 图标不可用：忽略（setIcon 遇未知名静默失败） */
            }
            // ⚠️ 读屏名必须在 `setIcon` **之后**追加：setIcon 会把元素内容整体替换，先加会被清掉
            dl.createSpan({ cls: 'rl-sr', text: '下载歌曲' });
            dl.onclick = () =>
                this.cbs.openMusicDownloader?.(e.title, e.author ?? '', (relPath) => {
                    if (!this.singlePathInput) return;
                    this.singlePathInput.value = relPath;
                    this.setSingleHint(`已下载并填入：${relPath}`);
                });
        }
        if (this.cbs.listLibraryAudio) {
            const find = row.createEl('button', { cls: 'rl-ai-btn' });
            find.setAttribute('data-tip', '在音频文件目录里检索同名音频');
            try {
                setIcon(find, 'search');
            } catch {
                /* 同上 */
            }
            find.createSpan({ cls: 'rl-sr', text: '检索库内同名音频' });
            find.onclick = () => this.findLibraryAudio();
        }
    }

    /**
     * 书籍：标签旁的「下载」小按钮（#454；缺回调就不画）—— 与音乐那枚**同款同位**。
     * 作用 = 打开「下载书籍」弹窗（**书源**通道，书源由用户自备），下载完把库内相对路径填进「本地文件路径」。
     * 🔴 分类口径与编辑表单**逐字一致**（那边是 `bookKind === 'novel' ? 'novel' : 'book'`）：网文走网文窗口、
     *    文学与漫画走文学窗口 —— ⛔ 别在这里另立一套判断（两个入口同时对同一条目给出不同窗口 = 用户分不清）。
     * 命中的是**只填输入框**，仍要点「保存并生效」（与「浏览」「检索」同款）。
     */
    private buildBookQuickButton(row: HTMLElement): void {
        if (!this.cbs.openBookDownloader) return;
        const e = this.entry;
        const novel = e.bookKind === 'novel';
        const dl = row.createEl('button', { cls: 'rl-ai-btn' });
        dl.setAttribute(
            'data-tip',
            novel
                ? '按网文书源搜书并下载（书源由你自备），完成后自动填入这里'
                : '按文学书源搜书并下载（书源由你自备），完成后自动填入这里',
        );
        try {
            setIcon(dl, 'download');
        } catch {
            /* 图标不可用：忽略（setIcon 遇未知名静默失败，与表单那枚同款行为） */
        }
        // ⚠️ 必须在 `setIcon` 之后追加（见上）
        dl.createSpan({ cls: 'rl-sr', text: novel ? '下载网文' : '下载文学' });
        dl.onclick = () =>
            this.cbs.openBookDownloader?.((relPath) => {
                if (!this.singlePathInput) return;
                this.singlePathInput.value = relPath;
                this.setSingleHint(`已下载并填入：${relPath}`);
            });
    }

    /**
     * 「检索」：在**库内音乐目录**里按歌名找回同名音频并填入路径。
     * 🔴 匹配真源 = `pure/libraryAudio.pickLibraryAudio`（与条目编辑表单那枚小按钮同一份逻辑，
     *    ⛔ 别在这里再写一套相似度）。命中**只填输入框**，仍要点「保存并生效」——与「浏览」同款。
     */
    private findLibraryAudio(): void {
        const input = this.singlePathInput;
        if (!input) return;
        const title = this.entry.title.trim();
        if (!title) {
            this.setSingleHint('标题为空，先给条目填个标题再检索');
            return;
        }
        const files = this.cbs.listLibraryAudio?.() ?? [];
        const { best, ranked } = pickLibraryAudio(files, title, (this.entry.author ?? '').trim());
        if (!best) {
            this.setSingleHint(files.length === 0 ? '音频文件目录里还没有音频文件' : `音频文件目录里没找到与「${title}」同名的音频`);
            return;
        }
        input.value = best.path;
        this.setSingleHint(ranked.length > 1 ? `命中 ${ranked.length} 个，已填入「${best.name}」` : `已填入「${best.name}」`);
    }

    /** 单路径块的提示行（懒建；「已关联」与「下载 / 检索」的反馈共用一行） */
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
        this.files = (e.episodeFiles ?? []).slice(0, this.total);
        this.urls = (e.episodeUrls ?? []).slice(0, this.total);
        this.titles = (e.episodeTitles ?? []).slice(0, this.total);

        if (e.type !== 'movie') {
            const trow = wrap.createDiv({ cls: 'rl-qa-total' });
            trow.createSpan({ cls: 'rl-qa-lbl-inline', text: '总集数' });
            this.totalInput = trow.createEl('input', { cls: 'rl-qa-input rl-qa-total-input', attr: { type: 'number', min: '1', step: '1' } });
            this.totalInput.value = String(this.total);
            this.totalInput.onchange = () => this.changeTotal(parseInt(this.totalInput!.value, 10));
            // 批量检索小图标（总集数行右侧；tv/anime）：选文件夹 → 识别集号自动填入未关联集（hover 出说明）
            // 读屏名走隐藏文本而非 aria-label：aria-label 与 data-tip 同元素会让 Obsidian 官方气泡
            // 与自绘气泡叠两层（UI-GUIDE §3 并存禁令）。经全仓扫描，这是唯一一处该违规。
            const batchBtn = trow.createEl('button', { cls: 'rl-ai-btn' });
            batchBtn.setAttribute('data-tip', '选文件夹批量填集（已填的不覆盖）');
            batchBtn.onclick = () => void this.batchScan();
            try {
                setIcon(batchBtn, 'folder-search');
            } catch {
                batchBtn.setText('📁');
            }
            // 必须追加在 setIcon / setText 之后：这两个会把元素内容整体替换，先加会被清掉
            batchBtn.createSpan({ cls: 'rl-sr', text: '从文件夹检索剧集' });
        }

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
        this.buildBiliQuickButton(urlLblRow);
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

    /** 「网络地址」标签旁的 B站 搜索小按钮（#506；⚠️ `biliSearch` 没注入就不画） */
    private buildBiliQuickButton(row: HTMLElement): void {
        if (!this.cbs.biliSearch) return;
        const btn = row.createEl('button', { cls: 'rl-ai-btn' });
        btn.setAttribute('data-tip', '搜索 B 站（可一次填完整季的分P）');
        try {
            setIcon(btn, 'search');
        } catch {
            btn.setText('🔍');
        }
        // ⚠️ 读屏名必须在 `setIcon` **之后**追加：setIcon 会把元素内容整体替换，先加会被清掉
        btn.createSpan({ cls: 'rl-sr', text: '搜索 B 站' });
        btn.onclick = () => void this.openBiliPicker();
    }

    /** 打开候选卡并立即搜一次（检索词初值 = 作品标题 + **当前集**标题，与浮层同口径） */
    private async openBiliPicker(): Promise<void> {
        this.flushCurIntoArrays();
        if (!this.biliCard) this.biliCard = this.contentEl.createDiv({ cls: 'rl-bili-card' });
        this.biliView = 'search';
        this.biliRows = [];
        if (!this.biliQuery.trim()) {
            const t = this.titles[this.curEp] ?? '';
            this.biliQuery = [this.entry.title.trim(), t.trim()].filter(Boolean).join(' ');
        }
        this.renderBiliCard();
        await this.runBiliSearch();
    }

    /** 关掉候选卡（⛔ 不改弹窗本身 —— 用户可能只是想放弃这次搜索） */
    private closeBiliCard(): void {
        this.biliCard?.remove();
        this.biliCard = null;
        this.biliView = 'search';
        this.biliRows = [];
    }

    /** 搜一次（卡里那颗「搜索」按钮；也供打开时自动跑） */
    private async runBiliSearch(): Promise<void> {
        if (this.biliBusy || !this.cbs.biliSearch) return;
        const kw = this.biliQuery.trim();
        this.biliVideos = [];
        this.biliErr = '';
        if (!kw) {
            this.biliErr = '先填检索词（默认取作品标题 + 集标题）';
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
     * ⚠️ **能力回落**（⛔ 别把老路堵死）：读不到分P（失败 / 单P / 没注入 `biliParts`）⇒
     *    直接填**当前这一集**并关掉卡片 —— 与浮层 `pickEpBiliUrl` **完全同一条纪律**。
     */
    private async pickBiliVideo(v: BiliVideo): Promise<void> {
        if (this.biliBusy) return;
        if (!this.cbs.biliParts) {
            this.urlInput.value = v.webUrl;
            this.flushCurIntoArrays();
            this.renderEpGrid();
            this.closeBiliCard();
            new Notice('已填入当前集（这个入口没接入分P，其余集仍需手动填）');
            return;
        }
        this.biliBusy = true;
        this.renderBiliCard();
        try {
            const out = await this.cbs.biliParts(v.bvid);
            const parts: BiliPart[] = out.parts ?? [];
            if (out.error || parts.length === 0) {
                this.urlInput.value = v.webUrl;
                this.flushCurIntoArrays();
                this.renderEpGrid();
                this.closeBiliCard();
                new Notice(out.error ? `读取分P失败（${out.error}），已直接填入这条链接` : '这条没有分P，已直接填入这条链接');
                return;
            }
            this.biliPickTitle = out.title || v.title;
            this.biliPickBvid = v.bvid;
            // 🔴 口径唯一真源：`buildBiliFillRows`（与浮层同一次调用形态）
            this.biliRows = buildBiliFillRows(parts, this.urls);
            this.biliView = 'parts';
        } catch (e) {
            this.biliErr = `读取分P出错：${e instanceof Error ? e.message : String(e)}`;
        } finally {
            this.biliBusy = false;
        }
        this.renderBiliCard();
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
        head.createDiv({ cls: 'rl-bili-card-title', text: this.biliView === 'parts' ? '选择分P' : '搜索 B 站' });
        const close = head.createEl('button', { cls: 'rl-bili-close', text: '✕' });
        close.setAttribute('data-tip', '关闭');
        close.onclick = () => this.closeBiliCard();

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
            attr: { type: 'text', placeholder: '检索词（默认 作品标题 + 集标题）', spellcheck: 'false' },
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
                    new Notice('请填写或浏览选择本地文件路径');
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
