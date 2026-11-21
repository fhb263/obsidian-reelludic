/**
 * 网盘选片弹窗 —— 列 WebDAV 目录、勾选视频文件、按序对号填进 `episodeUrls`。
 *
 * 🔴 为什么是「弹窗 + 勾选表」而不是「一键自动填」：
 *    网盘目录里很少有「文件名就是第 N 集」的完美排列（可能带 `[1080p]`、可能从第 5 集开始、
 *    可能混着 SP/OVA）。自动填 = 静默错位，而错位的表现是「点第 3 集播第 5 集」——
 *    用户很难一眼看出是关联错了。⇒ **列出来、标清每行对到哪一集、让用户自己勾**。
 *    这与本仓 #505/#519 在 B 站那侧的做法是同一条纪律。
 *
 * 🔴 目录浏览保留「上层」按钮：剧集文件常放在 `动画/某番/第01集.mp4` 这种两层以下，
 *    不给返回上一级就只能重开弹窗一层层点下来。
 *
 * ⚠️ 本弹窗**只负责选与对号**，不写库：返回 `[集下标, 地址][]` 交给表单改 `episodeUrls`，
 *    再由表单的「保存」落库 —— 与「粘贴 / 点候选填入」完全同一条纪律。
 */
import { App, Modal, Notice } from 'obsidian';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';
import { listDav, normalizeDavSubPath } from 'services/webdavClient';
import { buildDavFillRows, sortDavVideos, davCheckedRows, withDavChecked, type DavFillRow } from 'pure/davFill';
import { formatDavSize, type DavEntry } from 'pure/webdav';

/** 弹窗入参 */
export interface DavPickerOptions {
    base: string;
    user: string;
    pass: string;
    /** 本条目现有的集地址（用来标「已有链接」、默认不勾） */
    urls: (string | undefined)[];
    /** 本条目总集数（0 = 未知，不裁超界） */
    total: number;
    /** 初始对号锚（0 起；用户点的那一集） */
    anchor?: number;
}

/** 弹窗结果（`null` = 取消 / 关闭，安全方向：什么都不改） */
export interface DavPickResult {
    pairs: [number, string][];
}

export class WebdavPickerModal extends Modal {
    private resolve: ((r: DavPickResult | null) => void) | null = null;

    /** 当前所在目录（相对 WebDAV 入口，空串 = 根） */
    private dir = '';
    /** 当前目录列出来的条目 */
    private entries: DavEntry[] = [];
    /** 当前目录下的勾选表 */
    private rows: DavFillRow[] = [];
    /** 对号锚（0 起） */
    private anchor = 0;
    private loading = false;
    private error = '';

    // 常驻节点（只建一次，后续只改内容 —— ⛔ 别每次重画整个弹窗，那会丢滚动位置与焦点）
    private crumbEl: HTMLElement | null = null;
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private fillBtn: HTMLButtonElement | null = null;
    private upBtn: HTMLButtonElement | null = null;
    private anchorInput: HTMLInputElement | null = null;

    constructor(app: App, private opts: DavPickerOptions) {
        super(app);
        this.anchor = Math.max(0, Math.floor(Number(opts.anchor) || 0));
    }

    open(): Promise<DavPickResult | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        markScrollInside(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-dav-picker');

        contentEl.createDiv({ cls: 'rl-nc-desc rl-dav-title', text: '从网盘导入剧集' });

        // 🔴 必须在这里说清「填进去的是什么地址、为什么可能播不了」（2026-11 定性，⛔ 别删这条提示）：
        //    填进去的是**这个 WebDAV 文件的地址**，不是 OpenList 那种签名直链。
        //    · 匿名可读（公开分享 / OpenList `/d/` / 群晖匿名）⇒ 插件内 `<video>` 直接能播；
        //    · 需要登录的 ⇒ `<video>` 发出的是**不带 Authorization 的裸请求**（Chromium 自 M59 起
        //      屏蔽子资源 URL 内嵌凭据），必然 401 ⇒ 播放失败后自动转**浏览器**（那边会弹一次登录框）。
        //    ⚠️ 用户明确否决了「回环代理注入 Authorization」这条（那是丙方案），所以这里不假装能兜住：
        //      说清了，用户就不会以为是插件坏了。
        if (this.opts.user || this.opts.pass) {
            const tip = contentEl.createDiv({ cls: 'rl-dav-tip' });
            tip.setText('这个网盘要登录：插件内能直连播放的前提是服务器允许匿名读（OpenList 的 /d/ 链接、公开分享）。需要登录的文件播不了时会自动交给浏览器，由浏览器弹一次账号框。');
        }

        // ── 路径行：面包屑 + 返回上层 ──
        const bar = contentEl.createDiv({ cls: 'rl-dav-bar' });
        this.upBtn = bar.createEl('button', { cls: 'rl-btn', text: '↑ 上层' });
        this.upBtn.addEventListener('click', () => void this.goUp());
        this.crumbEl = bar.createDiv({ cls: 'rl-dav-crumb' });

        // ── 对号锚：文件从第几集开始 ──
        const anchorRow = contentEl.createDiv({ cls: 'rl-dav-anchor' });
        anchorRow.createSpan({ cls: 'rl-dav-anchor-lbl', text: '这些文件从第' });
        this.anchorInput = anchorRow.createEl('input', {
            cls: 'rl-dav-anchor-input',
            attr: { type: 'number', min: '1', step: '1', value: String(this.anchor + 1) },
        });
        anchorRow.createSpan({ cls: 'rl-dav-anchor-lbl', text: '集开始（第 1 个文件对到这一集）' });
        this.anchorInput.addEventListener('change', () => {
            const n = Number(this.anchorInput?.value);
            this.anchor = Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : 0;
            // 锚一变 ⇒ 每行对到哪一集全变 ⇒ 必须重算勾选表（⛔ 不就地改 epIndex，那会漏掉超界重判）
            this.rebuildRows();
        });

        // ── 文件列表 ──
        this.listEl = contentEl.createDiv({ cls: 'rl-dav-list' });
        this.statusEl = contentEl.createDiv({ cls: 'rl-dav-status' });

        // ── 底部操作 ──
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const cancel = ops.createEl('button', { cls: 'rl-btn', text: '取消' });
        cancel.addEventListener('click', () => this.finish(null));
        this.fillBtn = ops.createEl('button', { cls: 'mod-cta', text: '填入' });
        this.fillBtn.addEventListener('click', () => this.apply());

        void this.loadDir(this.dir);
    }

    onClose(): void {
        // 关闭未确认 → null（安全方向：什么都不改）
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(r: DavPickResult | null): void {
        this.resolve?.(r);
        this.resolve = null;
        this.close();
    }

    /** 载入某个目录（`path` 相对入口，空串 = 根） */
    private async loadDir(path: string): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        this.error = '';
        this.renderStatus('正在读取目录…');
        try {
            const res = await listDav(this.opts.base, path, this.opts.user, this.opts.pass);
            if (!res.ok) {
                // 🔴 失败时**不切目录**：留在原地，用户能看到错误并重试（切过去会看到一张空表，更难判断）
                this.error = res.error;
                this.renderStatus(res.error, true);
                return;
            }
            this.dir = normalizeDavSubPath(path);
            this.entries = res.entries;
            this.rebuildRows();
        } finally {
            this.loading = false;
        }
    }

    /** 由当前目录的条目重算勾选表并重画（锚或目录变了都走这里） */
    private rebuildRows(): void {
        const videos = sortDavVideos(this.entries);
        this.rows = buildDavFillRows(videos, this.opts.urls, this.anchor, this.opts.total || undefined);
        this.renderCrumb();
        this.renderList(videos);
        this.refreshFillBtn();
    }

    private renderCrumb(): void {
        if (!this.crumbEl) return;
        this.crumbEl.empty();
        const segs = this.dir ? this.dir.split('/') : [];
        const root = this.crumbEl.createSpan({ cls: 'rl-dav-crumb-seg', text: '根目录' });
        root.addClass('is-link');
        root.addEventListener('click', () => void this.loadDir(''));
        for (let i = 0; i < segs.length; i++) {
            this.crumbEl.createSpan({ cls: 'rl-dav-crumb-sep', text: '/' });
            const p = segs.slice(0, i + 1).join('/');
            const seg = this.crumbEl.createSpan({ cls: 'rl-dav-crumb-seg', text: segs[i] });
            seg.addClass('is-link');
            seg.addEventListener('click', () => void this.loadDir(p));
        }
        if (this.upBtn) this.upBtn.disabled = !this.dir;
    }

    private renderList(videos: DavEntry[]): void {
        const host = this.listEl;
        if (!host) return;
        host.empty();

        // 子目录（先画，用户顺着点下来）
        const dirs = this.entries.filter((e) => e.isDir);
        for (const d of dirs) {
            const row = host.createDiv({ cls: 'rl-dav-dir', attr: { role: 'button', tabindex: '0' } });
            row.createSpan({ cls: 'rl-dav-dir-name', text: `📁 ${d.name}` });
            const enter = (): void => void this.loadDir(this.dir ? `${this.dir}/${d.name}` : d.name);
            row.addEventListener('click', enter);
            row.addEventListener('keydown', (ev: KeyboardEvent) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    enter();
                }
            });
        }

        if (videos.length === 0) {
            if (dirs.length === 0) {
                const empty = host.createDiv({ cls: 'rl-dav-empty' });
                empty.setText(this.error ? this.error : '这个目录里没有视频文件（也没有子目录）');
            }
            return;
        }

        for (const r of this.rows) {
            const row = host.createDiv({ cls: 'rl-dav-row' });
            if (r.outOfRange) row.addClass('is-out');
            const cb = row.createEl('input', { attr: { type: 'checkbox' } });
            cb.checked = r.checked;
            cb.disabled = r.outOfRange;
            cb.addEventListener('change', () => {
                const want = cb.checked;
                this.rows = this.rows.map((x) => (x.epIndex === r.epIndex ? withDavChecked(x, want) : x));
                this.refreshFillBtn();
            });

            const target = row.createSpan({ cls: 'rl-dav-target' });
            target.setText(`第 ${r.epNo} 集`);
            if (r.outOfRange) {
                target.setText(`第 ${r.epNo} 集 · 超出总集数`);
                target.addClass('is-bad');
            } else if (r.hasUrl) {
                // 🔴 已有链接的集默认不勾，但必须说清「为什么没勾」——否则用户会以为漏了
                target.setText(`第 ${r.epNo} 集 · 已有链接`);
                target.addClass('is-warn');
            }

            const name = row.createSpan({ cls: 'rl-dav-name', text: r.name });
            if (!r.playable) {
                // ⚠️ 不可内置 ≠ 不能关联：mkv 照样能交系统播放器播，只是不能在插件里播
                name.addClass('is-plain');
                name.setAttr('data-tip', 'mkv 等格式插件内播不了，会交给系统播放器');
            }
            const size = formatDavSize(r.size);
            if (size) row.createSpan({ cls: 'rl-dav-size', text: size });
        }
    }

    private renderStatus(text: string, bad = false): void {
        const el = this.statusEl;
        if (!el) return;
        el.setText(text);
        el.toggleClass('is-bad', bad);
    }

    private refreshFillBtn(): void {
        const n = davCheckedRows(this.rows).length;
        if (this.fillBtn) {
            this.fillBtn.setText(n > 0 ? `填入 ${n} 集` : '填入');
            this.fillBtn.disabled = n === 0;
        }
        if (!this.error) {
            this.renderStatus(
                this.rows.length > 0
                    ? `本目录 ${this.rows.length} 个视频 · 已勾 ${n} 集`
                    : '',
            );
        }
    }

    private async goUp(): Promise<void> {
        if (!this.dir) return;
        const segs = this.dir.split('/').filter(Boolean);
        segs.pop();
        await this.loadDir(segs.join('/'));
    }

    private apply(): void {
        const picked = davCheckedRows(this.rows);
        if (picked.length === 0) return;
        const pairs: [number, string][] = picked.map((r) => [r.epIndex, r.url]);
        // ⚠️ 这里是**唯一**的越界兜底：`outOfRange` 的行已默认不勾且复选框禁用，
        //    但 `davCheckedRows` 再挡一次（纯逻辑层已挡，这里不重复实现，只是不绕过它）。
        new Notice(`已选 ${pairs.length} 个文件（点「保存」生效）`);
        this.finish({ pairs });
    }
}
