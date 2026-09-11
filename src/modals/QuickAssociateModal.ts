// 快捷关联入口弹窗（海报墙/列表右键「阅读/观看/播放/启动 · 去关联」直达，替代先开整个编辑表单）：
// 无关联入口时给最小关联编辑器——书/游戏/音乐 = 本地路径单行 + 浏览；影视 = movie 第 1 集 /
// tv·anime 总集数 + 集号网格 + 选中集（网络地址/本地路径/集标题），底部一次「保存并生效」。
// DOM API 渲染（非 Svelte 组件，复用全局 rl-btn/rl-eps-* 等样式）；保存回调注入，由 main 落库+同步笔记+刷新。
import { App, Modal, Notice, setIcon } from 'obsidian';
import type { MediaEntry } from 'data/types';
import type { BookProbeResult } from 'pure/bookProgress';
import { buildEpisodeAssocResult, hasAnyEpisodeSource } from 'pure/quickAssociate';

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
}

/** 单路径类型（书/游戏/音乐）标签与占位 */
const SINGLE_LABEL: Record<'book' | 'game' | 'music', { label: string; title: string; placeholder: string; hint: string }> = {
    book: {
        label: '本地文件路径',
        title: '关联书籍文件',
        placeholder: 'vault 相对路径，如 书籍/三体.txt（TXT/EPUB/PDF）',
        hint: '选择 TXT / EPUB / PDF 电子书',
    },
    game: {
        label: '本地文件路径',
        title: '关联启动快捷方式',
        placeholder: 'vault 相对路径或系统绝对路径（.lnk）',
        hint: '选择游戏启动快捷方式（.lnk）',
    },
    music: {
        label: '本地文件路径',
        title: '关联本地音频',
        placeholder: 'vault 相对路径或系统绝对路径（mp3/flac/m4a…）',
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
    private saveBtn!: HTMLButtonElement;

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

    /** 书/游戏/音乐：单行本地路径 + 浏览 */
    private buildSingleSection(wrap: HTMLElement): void {
        const e = this.entry;
        const meta = this.single();
        const prefill =
            e.type === 'book' ? (e.bookFile ?? '') : e.type === 'game' ? (e.gameLaunchPath ?? '') : (e.audioPath ?? '');

        wrap.createDiv({ cls: 'rl-qa-lbl', text: meta.label });
        const row = wrap.createDiv({ cls: 'rl-qa-row' });
        this.singlePathInput = row.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: meta.placeholder, spellcheck: 'false' },
        });
        this.singlePathInput.value = prefill;
        const browse = row.createEl('button', { cls: 'rl-btn rl-link-act', text: '浏览…' });
        browse.setAttribute('data-tip', meta.hint);
        browse.onclick = () => void this.pickInto(this.singlePathInput!, this.pickKind());
        if (prefill) {
            wrap.createDiv({ cls: 'rl-qa-hint', text: `已关联：${prefill}（直接修改可更换）` });
        }
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
            const batchBtn = trow.createEl('button', { cls: 'rl-qa-batch-btn' });
            batchBtn.setAttribute('data-tip', '从文件夹检索剧集：选含剧集文件的文件夹，识别文件名集号（第N集 / S01E0N / 01…）自动填入本地路径，已填集跳过');
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

        div.createDiv({ cls: 'rl-qa-lbl', text: '网络地址' });
        this.urlInput = div.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: 'https://…（浏览器打开；本地优先播放）', spellcheck: 'false' },
        });
        div.createDiv({ cls: 'rl-qa-lbl', text: '本地视频路径' });
        const frow = div.createDiv({ cls: 'rl-qa-row' });
        this.fileInput = frow.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: '本地视频路径（库内相对/系统绝对）', spellcheck: 'false' },
        });
        const browse = frow.createEl('button', { cls: 'rl-btn rl-link-act', text: '浏览…' });
        browse.onclick = () => void this.pickInto(this.fileInput, 'video');
        div.createDiv({ cls: 'rl-qa-lbl', text: '集标题（可选）' });
        this.titleInput = div.createEl('input', {
            cls: 'rl-qa-input',
            attr: { type: 'text', placeholder: '如：开始（悬停显示「第 N 集 标题」）', spellcheck: 'false' },
        });
        this.populateCur();
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
            const title = this.titles[i];
            btn.setAttribute('data-tip', title ? `第 ${i + 1} 集 ${title}` : `第 ${i + 1} 集`);
            btn.onclick = () => {
                this.flushCurIntoArrays();
                this.curEp = i;
                this.renderEpGrid();
                this.populateCur();
            };
        }
    }

    /** 批量检索：选文件夹 → 读目录识别集号 → 未关联集保位填入本地路径；总集数自动扩到最大命中集号。
     *  已填本地路径的集跳过（不覆盖手填值）。 */
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
        for (const h of hits) {
            const i = h.ep - 1;
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
        new Notice(`已填入 ${filled} 集本地路径${skipped ? `，跳过已关联 ${skipped} 集` : ''}`, 4000);
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
        return `第 ${this.curEp + 1} 集${t ? `：${t}` : ''}`;
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
