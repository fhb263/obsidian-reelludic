/**
 * **安装清单弹窗**：点「一键装好 / 一键补齐」后，先把「装到哪、装什么」摊开给用户确认，再逐项打勾。
 *
 * 🔴 用户 m09123 原文：「这个一键装好和补环境具体是装什么东西，应该如果用户点击此行为就
 *    弹窗显示要装的项按序号来每完成一项就打勾」
 *
 *    之前的行为：按钮变「正在安装…」，旁边滚一行百分比。用户看不见装几样、装到第几样、
 *    还差什么 —— 228MB 的模型和 0.3MB 的词表共享同一个「33%」，谁都会以为卡死了。
 *
 * 🔴 用户 m01935 原文：「点击一键安装时必须弹窗告知用户一键安装模型及配置器的所有路径
 *    待用户选择确认或自定义路径后才能安装」
 *
 *    ⇒ 光有清单还不够，**路径也要在上桌之前交代清楚**。所以本弹窗分三段：
 *      ⑴ 落点目录（可改、可浏览、每目录下列出会落哪些文件 —— 只读，文件名是上游固定的）
 *      ⑵ 逐项清单（装几样、每项多大、从哪个包剥出来）
 *      ⑶ 确认勾选 → 「开始安装」才可用
 *    改任何目录都会**清掉确认勾**，避免「看着 A 目录、实际装 B 目录」。
 *
 * 设计四原则：
 *  ⑴ **先给路径与清单，再开工**：打开就能看到目录、文件、体积；勾了确认才动网络。
 *  ⑵ **一项一行、逐项打勾**：当前项显示自己的百分比，已完成项打 ✅，未开始项灰着。
 *  ⑶ **失败停在原地**：不关窗、不弹红框，把失败原因写在该项下面，用户可以「重试」。
 *  ⑷ **确认值先落库再执行**：由 `onDirsConfirmed` 注入（`main` 提供），⛔ 不在弹窗里改设置。
 *
 * ⚠️ 弹窗**不碰网络、不碰 fs**：全部动作由 `opts.run` 注入（`main` 提供），
 *    这样它可被 jsdom 单测驱动，也不会在弹窗里长出第二套下载逻辑。
 */

import { App, Modal } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import {
    joinInstallPath,
    type AsrInstallDirs,
    type AsrInstallItem,
    type AsrInstallPlan,
} from 'pure/asrInstallPlan';
import { formatBytes, ASR_MODEL_SITE, ASR_MODEL_SITE_MIRROR } from 'pure/asrModels';

/** 安装结果（与执行层的返回值同形） */
export interface AsrInstallResult {
    ok: boolean;
    message: string;
    cancelled?: boolean;
}

/** 进度回调：`(第几项下标0基, 这一项自己的百分比, 文案)` */
export type AsrInstallStepCallback = (itemIndex: number, itemPercent: number, label: string) => void;

export interface AsrInstallHandle {
    done: Promise<AsrInstallResult>;
    cancel: () => void;
}

/** 一个待确认的落点目录（`key` 与 `AsrInstallDirs` 字段名逐字对应） */
export interface AsrInstallDirField {
    key: keyof AsrInstallDirs;
    label: string;
    why: string;
}

export interface AsrInstallModalOptions {
    /** 要装什么（`pure/asrInstallPlan.asrInstallPlan` 的产物） */
    plan: AsrInstallPlan;
    /** 默认落点（用户可改；`plan.items[].dir` 是这份默认值的展开） */
    dirs?: AsrInstallDirs;
    /** 这一家要确认几个目录（`pure/asrInstallPlan.asrInstallDirFields` 的产物） */
    dirFields?: readonly AsrInstallDirField[];
    /** 浏览按钮：返回用户选的目录；`undefined` = 用户取消 */
    pickDir?: (current: string) => Promise<string | undefined>;
    /** 用户勾了确认、点「开始安装」时调用（`main` 用它把目录落库） */
    onDirsConfirmed?: (dirs: AsrInstallDirs) => void;
    /** 开始安装。弹窗把进度回调与**确认后的目录**交给它，自己在 `done` 结算时更新界面。 */
    run: (onStep: AsrInstallStepCallback, dirs: AsrInstallDirs) => AsrInstallHandle;
    /** 关窗时回调（成功/失败/取消/直接关掉都可能），设置页靠它重画卡片 */
    onClosed?: (result: AsrInstallResult | null) => void;
    /**
     * 🔴 m10754：用系统浏览器打开一个外部地址。
     *
     * 用户原文：「我没看到官网链接在哪里可点击跳转下载并关联各自框啊」——
     * 原来那两块链接画在 `AsrEngineModal` 的「方式二」里，而那个弹窗自从设置页
     * 改走 `openAsrInstall()` 之后就**没有任何调用方**（`main.ts` 里 `openAsrEngineModal()`
     * 全仓 0 处引用），等于链接跟着一起失联。现在直接画在用户真正会看到的这个弹窗里。
     */
    onOpenExternal?: (url: string) => void;
}

/** 一行的可变件（⛔ 不重建节点，只改字与类） */
interface RowRef {
    root: HTMLElement;
    mark: HTMLElement;
    bar: HTMLElement;
    fill: HTMLElement;
    note: HTMLElement;
    /** 这一项自己的落点说明（目录改了要跟着变） */
    pathEl: HTMLElement;
    /** 这一项对应哪个目录字段（whisper 两项分属 binDir / engineDir） */
    dirKey: keyof AsrInstallDirs;
}

/** 目录区的一个可编辑块 */
interface DirRef {
    key: keyof AsrInstallDirs;
    input: HTMLInputElement;
    filesEl: HTMLElement;
}

export class AsrInstallModal extends Modal {
    private rows: RowRef[] = [];
    private dirRefs: DirRef[] = [];
    private handle: AsrInstallHandle | null = null;
    private result: AsrInstallResult | null = null;
    private closed = false;
    private startBtn: HTMLButtonElement | null = null;
    private statusEl: HTMLElement | null = null;
    private confirmBox: HTMLInputElement | null = null;
    private confirmWrap: HTMLElement | null = null;
    /** 当前确认中的目录（key → 绝对路径） */
    private dirs: AsrInstallDirs;

    constructor(
        app: App,
        private opts: AsrInstallModalOptions,
    ) {
        super(app);
        this.dirs = {
            engineDir: String(opts.dirs?.engineDir ?? '').trim(),
            binDir: String(opts.dirs?.binDir ?? '').trim(),
        };
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-asr-install-modal');

        const plan = this.opts.plan;
        contentEl.createEl('h2', { text: plan.title });
        if (plan.note) contentEl.createDiv({ cls: 'rl-asr-install-lead', text: plan.note });

        // 被封锁的引擎（Qwen3 要 Python 环境）：只显示原因，⛔ 不给「开始安装」
        if (plan.blockedReason) {
            contentEl.createDiv({ cls: 'rl-asr-install-blocked', text: plan.blockedReason });
            const ops = contentEl.createDiv({ cls: 'rl-asr-install-ops' });
            const close = ops.createEl('button', { cls: 'rl-btn', text: '知道了' });
            close.addEventListener('click', () => this.close());
            return;
        }

        // ── ⑴ 落点目录（先给路径，再谈安装）──
        this.renderDirs(contentEl);

        // ── ⑵ 总览 + 逐项清单 ──
        const total = plan.items.length;
        const bytes = plan.items.reduce((sum, it) => sum + bytesOf(it), 0);
        contentEl.createDiv({
            cls: 'rl-asr-install-total',
            text: `共 ${total} 项${bytes > 0 ? ` · 合计约 ${formatBytes(bytes)}` : ''}，装完一次就不用再管。`,
        });

        const list = contentEl.createDiv({ cls: 'rl-asr-install-list' });
        for (const it of plan.items) this.rows.push(this.renderRow(list, it));

        this.statusEl = contentEl.createDiv({ cls: 'rl-asr-install-status' });

        // ── ⑶ 确认门控 + 操作按钮 ──
        this.renderConfirm(contentEl);

        const ops = contentEl.createDiv({ cls: 'rl-asr-install-ops' });
        const start = ops.createEl('button', { cls: 'mod-cta', text: '开始安装' });
        this.startBtn = start;
        // 🔴 未勾确认前不可点（用户 m01935 的「确认或自定义路径后才能安装」）
        start.disabled = true;
        start.setAttribute('data-tip', '请先确认上面的安装路径');
        start.addEventListener('click', () => this.start());
        const later = ops.createEl('button', { cls: 'rl-btn', text: '稍后再说' });
        later.addEventListener('click', () => {
            // 正在装时这颗按钮的含义变成「取消安装」—— ⛔ 不留下「关了窗进程还在跑」的黑洞
            if (this.handle) {
                this.handle.cancel();
                return;
            }
            this.close();
        });

        // ── ⑷ 手动下载入口（官网 / 国内镜像）──
        this.renderManualLinks(contentEl);

        // 目录回填进清单行（首帧就要对上，⛔ 别等用户改一次才同步）
        this.syncRowPaths();
    }

    /**
     * 画「自己下载」的两个入口：官网与国内镜像。
     *
     * 🔴 m10754：这两行原本只在 `AsrEngineModal` 的「方式二」里，而那个弹窗已无调用方
     *    （设置页统一走 `openAsrInstall`）⇒ 用户完全看不到链接。现在搬进这个弹窗，
     *    网址**原样可见可复制**，右边一颗「打开」交给宿主用系统浏览器跳。
     *
     * ⚠️ 不用 `<a target="_blank">`：Obsidian 里点击会在应用内开新页签再失败，
     *    走 `onOpenExternal`（宿主 `openExternalUrl`）才是官方做法。
     */
    private renderManualLinks(host: HTMLElement): void {
        const box = host.createDiv({ cls: 'rl-asr-install-manual' });
        box.createDiv({ cls: 'rl-asr-install-manual-head', text: '方式二：自己下载后指定本地文件（不联网）' });
        box.createDiv({
            cls: 'rl-asr-install-manual-lead',
            text: '从官网或国内镜像下载 .bin / .zip，放到安装目录后再点上面的「开始安装」，插件会自动认已有的文件。',
        });
        const items: { label: string; url: string }[] = [
            { label: '官网', url: ASR_MODEL_SITE },
            { label: '国内镜像', url: ASR_MODEL_SITE_MIRROR },
        ];
        for (const it of items) {
            const row = box.createDiv({ cls: 'rl-asr-install-manual-row' });
            row.createDiv({ cls: 'rl-asr-install-manual-tag', text: it.label });
            // 网址原样显示：用户可以自己复制，⛔ 不做成截断的省略号
            row.createDiv({ cls: 'rl-asr-install-manual-url', text: it.url });
            const open = row.createEl('button', { cls: 'rl-btn', text: '打开' });
            open.setAttribute('aria-label', `用系统浏览器打开${it.label}`);
            open.addEventListener('click', () => {
                const cb = this.opts.onOpenExternal;
                if (cb) cb(it.url);
                else window.open(it.url, '_blank');
            });
        }
    }

    /**
     * 画落点目录区：每个目录一行「标签 + 输入框 + 浏览」，下面只读列出会落哪些文件。
     *
     * ⚠️ 文件名**只读**：上游给的名字是固定的（`model.int8.onnx` / `encoder-1920ms.onnx`…），
     *    用户改名之后插件按原名去找必然「装好了还是红的」。可改的只有**目录**。
     */
    private renderDirs(host: HTMLElement): void {
        const fields = this.opts.dirFields && this.opts.dirFields.length > 0
            ? this.opts.dirFields
            : [{ key: 'engineDir' as const, label: '安装目录', why: '识别程序与模型都会放进这个目录。' }];
        const box = host.createDiv({ cls: 'rl-asr-install-dirs' });
        box.createDiv({ cls: 'rl-asr-install-dirs-head', text: '安装到哪（可改，装之前先确认）' });

        for (const f of fields) {
            const row = box.createDiv({ cls: 'rl-asr-install-dir' });
            row.createDiv({ cls: 'rl-asr-install-dir-label', text: f.label });
            const line = row.createDiv({ cls: 'rl-asr-install-dir-line' });
            const input = line.createEl('input', { type: 'text' });
            input.value = this.dirs[f.key];
            input.placeholder = '留空 = 用默认位置';
            input.spellcheck = false;
            const browse = line.createEl('button', { cls: 'rl-btn', text: '浏览' });
            browse.addEventListener('click', () => {
                void this.pickInto(f.key, input);
            });
            // 手动输入也要能通过确认门控：改了就清勾
            input.addEventListener('input', () => {
                this.dirs[f.key] = input.value.trim();
                this.syncRowPaths();
                this.resetConfirm();
            });
            input.addEventListener('blur', () => {
                this.dirs[f.key] = input.value.trim();
                this.syncRowPaths();
                this.resetConfirm();
            });

            row.createDiv({ cls: 'rl-asr-install-dir-why', text: f.why });
            const filesEl = row.createDiv({ cls: 'rl-asr-install-dir-files' });
            this.dirRefs.push({ key: f.key, input, filesEl });
        }
        this.syncDirFiles();
    }

    private async pickInto(key: keyof AsrInstallDirs, input: HTMLInputElement): Promise<void> {
        const pick = this.opts.pickDir;
        if (!pick) return;
        const picked = await pick(this.dirs[key]);
        if (!picked) return;
        this.dirs[key] = picked;
        input.value = picked;
        this.syncRowPaths();
        this.syncDirFiles();
        this.resetConfirm();
    }

    /** 每个目录下列出「这一项会落哪些文件」（只读） */
    private syncDirFiles(): void {
        for (const d of this.dirRefs) {
            d.filesEl.empty();
            const names: string[] = [];
            for (const it of this.opts.plan.items) {
                if (this.dirKeyOf(it) !== d.key) continue;
                for (const n of it.files) if (!names.includes(n)) names.push(n);
            }
            if (names.length === 0) {
                d.filesEl.createDiv({ cls: 'rl-asr-install-dir-empty', text: '（没有文件落到这里）' });
                continue;
            }
            const head = d.filesEl.createDiv({ cls: 'rl-asr-install-dir-files-head' });
            head.setText(`会落下 ${names.length} 个文件：`);
            const ul = d.filesEl.createEl('ul', { cls: 'rl-asr-install-filelist' });
            for (const n of names) {
                const li = ul.createEl('li');
                li.createSpan({ cls: 'rl-asr-install-file', text: n });
                li.setAttribute('data-tip', joinInstallPath(this.dirs[d.key], n));
            }
        }
    }

    /**
     * 哪些清单项落到哪个目录。
     *
     * 🔴 whisper 是唯一「一项在 bin、一项在 models」的：程序那项用 `binDir`，
     *    模型那项用 `engineDir`。其余五家全部 `engineDir`。
     */
    private dirKeyOf(it: AsrInstallItem): keyof AsrInstallDirs {
        if (this.opts.dirFields && this.opts.dirFields.length > 1 && it.index === 1) return 'binDir';
        return 'engineDir';
    }

    /** 目录变化后，把每个清单行上的「落到 <path>」重画 */
    private syncRowPaths(): void {
        for (const row of this.rows) {
            const dir = this.dirs[row.dirKey];
            row.pathEl.setText(dir ? `落到 ${dir}` : '未指定目录');
        }
        this.syncDirFiles();
    }

    /** 画「我已确认这些路径」的勾选框 */
    private renderConfirm(host: HTMLElement): void {
        const wrap = host.createDiv({ cls: 'rl-asr-install-confirm' });
        this.confirmWrap = wrap;
        const label = wrap.createEl('label', { cls: 'rl-asr-install-confirm-label' });
        const cb = label.createEl('input', { type: 'checkbox' });
        this.confirmBox = cb;
        label.createSpan({
            cls: 'rl-asr-install-confirm-text',
            text: '我已确认上面的安装路径，按这里装',
        });
        cb.addEventListener('change', () => {
            this.applyGate();
        });
    }

    /** 勾选/取消后刷新「开始安装」的可用状态 */
    private applyGate(): void {
        const btn = this.startBtn;
        if (!btn) return;
        // 装的过程中不参与门控（按钮此时已 disabled 且文案是「安装中…」/「重试」）
        if (this.handle) return;
        const ok = !!this.confirmBox?.checked;
        btn.disabled = !ok;
        if (ok) btn.removeAttribute('data-tip');
        else btn.setAttribute('data-tip', '请先确认上面的安装路径');
    }

    /** 目录一变就清掉确认勾（⛔ 别让「看着 A 装到 B」发生） */
    private resetConfirm(): void {
        if (this.confirmBox && this.confirmBox.checked) {
            this.confirmBox.checked = false;
            this.applyGate();
        }
    }

    /** 画一行清单项（结构固定，之后只改 mark / bar / note） */
    private renderRow(host: HTMLElement, it: AsrInstallItem): RowRef {
        const root = host.createDiv({ cls: 'rl-asr-install-item' });
        const mark = root.createSpan({ cls: 'rl-asr-install-mark', text: String(it.index) });
        const main = root.createDiv({ cls: 'rl-asr-install-main' });
        const head = main.createDiv({ cls: 'rl-asr-install-head' });
        head.createSpan({ cls: 'rl-asr-install-name', text: it.title });
        if (it.size) head.createSpan({ cls: 'rl-asr-install-size', text: it.size });
        if (it.detail) main.createDiv({ cls: 'rl-asr-install-detail', text: it.detail });
        const pathEl = main.createDiv({ cls: 'rl-asr-install-item-path' });
        const bar = main.createDiv({ cls: 'rl-asr-install-bar is-off' });
        const fill = bar.createDiv({ cls: 'rl-asr-install-fill' });
        const note = main.createDiv({ cls: 'rl-asr-install-note' });
        return { root, mark, bar, fill, note, pathEl, dirKey: this.dirKeyOf(it) };
    }

    private start(): void {
        if (this.handle) return;
        // 🔴 双重门控：按钮 disabled 之外再挡一次（键盘/脚本也能触发 click）
        if (!this.confirmBox?.checked) return;
        const btn = this.startBtn;
        if (btn) {
            btn.setText('安装中…');
            btn.disabled = true;
        }
        // 锁定目录区：装到一半再改目录，等于装到两个地方
        for (const d of this.dirRefs) d.input.disabled = true;
        if (this.confirmBox) this.confirmBox.disabled = true;
        this.setStatus('正在准备…');
        // 🔴 先让调用方把确认值落库，再开工 —— 顺序反过来就会出现
        //    「界面显示 D:\x、这次装到旧目录、下次装到 D:\x」的三方不一致。
        this.opts.onDirsConfirmed?.({ ...this.dirs });
        this.handle = this.opts.run((idx, pct, label) => {
            if (this.closed) return;
            this.onStep(idx, pct, label);
        }, { ...this.dirs });
        // 🔴 用局部常量接住：`this.handle` 在 done 回调里会被置 null，
        //    直接读 `this.handle.done` 在多轮 await 之后可能已经变了。
        const h = this.handle;
        void h.done.then((r) => {
            if (this.closed) return;
            this.result = r;
            this.handle = null;
            this.finish(r);
        });
    }

    /** 收到一步进度：把「已完成 / 正在装 / 未开始」三态刷出来 */
    private onStep(idx: number, pct: number, label: string): void {
        const total = this.rows.length;
        for (let i = 0; i < total; i += 1) {
            const row = this.rows[i];
            if (i < idx) {
                row.mark.setText('✅');
                row.mark.addClass('is-done');
                row.bar.addClass('is-off');
                row.root.removeClass('is-active');
            } else if (i === idx) {
                row.mark.setText(String(i + 1));
                row.mark.removeClass('is-done');
                row.root.addClass('is-active');
                row.bar.removeClass('is-off');
                row.fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
                row.note.setText(pct > 0 ? `${label} ${pct}%` : label);
            }
        }
        // 把当前项的 百分比 汇总到顶部，用户不用自己找
        const done = idx;
        this.setStatus(pct >= 100 ? `第 ${Math.min(total, done + 1)} 项已完成…` : `正在装第 ${idx + 1} / ${total} 项 · ${label} ${pct}%`);
    }

    private finish(r: AsrInstallResult): void {
        const btn = this.startBtn;
        // 装完（含失败/取消）后目录区解锁：用户可以改地方重装
        for (const d of this.dirRefs) d.input.disabled = false;
        if (this.confirmBox) this.confirmBox.disabled = false;
        if (r.cancelled) {
            this.setStatus('已取消。已经下好的部分会留着，下次点继续。');
            if (btn) {
                btn.setText('继续安装');
                btn.disabled = !this.confirmBox?.checked;
            }
            // 取消后允许再点一次（不关窗，用户可能只是想停一下）
            this.handle = null;
            return;
        }
        if (!r.ok) {
            this.setStatus(r.message || '安装失败。');
            if (btn) {
                btn.setText('重试');
                btn.disabled = !this.confirmBox?.checked;
            }
            return;
        }
        for (const row of this.rows) {
            row.mark.setText('✅');
            row.mark.addClass('is-done');
            row.bar.addClass('is-off');
            row.root.removeClass('is-active');
            row.note.setText('');
        }
        this.setStatus('全部装好了。');
        if (btn) {
            btn.setText('完成');
            btn.disabled = false;
            // 成功后按钮改成「完成」，⛔ 不自动关窗 —— 用户要看见那排 ✅ 才算交代清楚
            btn.addEventListener('click', () => this.close(), { once: true });
        }
    }

    private setStatus(text: string): void {
        this.statusEl?.setText(text);
    }

    onClose(): void {
        this.closed = true;
        // 关窗中止安装：⛔ 不让一个看不见的下载继续占带宽
        if (this.handle) {
            this.handle.cancel();
            this.handle = null;
        }
        this.rows = [];
        this.dirRefs = [];
        this.confirmBox = null;
        this.confirmWrap = null;
        this.contentEl.empty();
        this.opts.onClosed?.(this.result);
    }
}

/** 从清单项的体积文案反解字节数（弹窗只用来算合计，解析失败就当 0） */
function bytesOf(it: AsrInstallItem): number {
    const m = /([\d.]+)\s*(GB|MB|KB|B)/.exec(it.size);
    if (!m) return 0;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const unit = m[2];
    const mul = unit === 'GB' ? 1024 * 1024 * 1024 : unit === 'MB' ? 1024 * 1024 : unit === 'KB' ? 1024 : 1;
    return Math.round(n * mul);
}
