import { Modal, type App } from 'obsidian';
import type { PosterMigrateResult } from 'modals/PosterMigrateModal';
import { applyScrollPref } from 'services/scrollPref';

/**
 * 单条进度：网络封面 → 本地封面文件名。
 * 名字沿用 plan 冻结契约里的 `ComiclikeProgressStep`，调用方按这个名字 import 也能对上；
 * 它同时是 main.localizeAllPosters 的 onProgress 第 3 参形状。
 */
export interface ComiclikeProgressStep {
    title: string;
    from: string;
    to: string;
}

/** 失败明细最多列这么多条，剩下的折成一句「另有 N 条」——逐条铺开会把弹窗撑成日志页 */
const MAX_FAIL_ITEMS = 20;

/**
 * 「下载封面」进度弹窗。
 *
 * 它自己不跑迁移，只是一块表现层：调用方（设置页 / main.localizeAllPosters）在长任务过程中
 * 调 setProgress，收尾调 finish / fail。这样迁移逻辑不需要知道 DOM，弹窗也不需要知道下载细节。
 *
 * 中途关窗（X / Esc / 遮罩）只置 closedByUser 并清掉自身引用，绝不再回写调用方状态：
 * 调用方自己会用 modalEl.isConnected 之类的自保护跳过后续刷新，这里多做一层反而容易在
 * 「关窗后仍有一次进度回调」时抛 null 引用。
 *
 * 🔴 2026-10-21 用户指令：**禁止自动消失**。原先「全部成功 → 1.2s 后自动 close()」被删掉——
 *    自动收窗等于把「完成态」从用户眼前抢走：一眨眼就没了，既没法确认总数，也没法截图留证。
 *    现在跑完只置完成态 + 给「关闭」按钮，关不关由用户点。
 */
export class PosterMigrateProgressModal extends Modal {
    /** 用户是否在任务结束前手动关掉了窗口（供调用方按需记录，不做任何内部逻辑依赖） */
    closedByUser = false;

    private statusEl: HTMLElement | null = null;
    private fillEl: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;
    private logEl: HTMLElement | null = null;
    private failsEl: HTMLElement | null = null;
    private closeBtnEl: HTMLButtonElement | null = null;
    private finished = false;

    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        this.modalEl.addClass('rl-pm-modal');

        const { contentEl } = this;
        contentEl.empty();
        // 关掉后可能还有一次迟到的 setProgress，先把引用清干净
        this.finished = false;
        this.closedByUser = false;

        const head = contentEl.createDiv({ cls: 'rl-pm-head' });
        head.createDiv({ cls: 'rl-pm-title', text: '下载封面' });
        head.createDiv({ cls: 'rl-pm-sub', text: '正在把网络封面下载到本地' });

        this.statusEl = contentEl.createDiv({ cls: 'rl-pm-status', text: '正在准备…' });

        const bar = contentEl.createDiv({ cls: 'rl-pm-bar' });
        this.fillEl = bar.createDiv({ cls: 'rl-pm-fill' });
        // 只有进度条宽度允许走内联样式：它是唯一需要按数据实时变化的值，交给 CSS 类无法表达
        this.fillEl.style.width = '0%';

        this.countEl = contentEl.createDiv({ cls: 'rl-pm-count', text: '0/0' });
        // 逐条迁移日志：用户要的是「哪个网络封面 → 落到哪个本地文件」，滚动区在 CSS 里限高
        this.logEl = contentEl.createDiv({ cls: 'rl-pm-log' });
        this.failsEl = contentEl.createDiv({ cls: 'rl-pm-fails' });
    }

    onClose(): void {
        // 没走到 finish/fail 就被关掉 ⇒ 记录成「用户中途关窗」，调用方想据此收尾时有个依据
        if (!this.finished) {
            this.closedByUser = true;
        }
        this.statusEl = null;
        this.fillEl = null;
        this.countEl = null;
        this.logEl = null;
        this.failsEl = null;
        this.closeBtnEl = null;
        this.contentEl.empty();
    }

    /**
     * 逐条进度。step 缺省表示「还没取到具体条目」（刚开窗/批间空档）。
     * total 为 0 时按 0% 处理：0/0 的除零会变成 NaN%，反而把进度条撑满或消失。
     */
    setProgress(done: number, total: number, step?: { title: string; from: string; to: string }): void {
        // statusEl 为空 = 窗口已关；finished = 已收尾。
        // 两种情况都不许再改界面，否则「完成」会被迟到的进度覆盖回「正在…」
        if (!this.statusEl || this.finished) {
            return;
        }
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        if (this.fillEl) {
            this.fillEl.style.width = `${pct}%`;
        }
        if (this.countEl) {
            this.countEl.setText(`${done}/${total}`);
        }
        this.writeStatus(step);
        this.appendLog(step);
    }

    /** 任务正常收尾：成功/跳过/失败三段数字 + （有失败时）前 20 条明细 */
    finish(result: PosterMigrateResult): void {
        if (!this.statusEl || this.finished) {
            return;
        }
        this.finished = true;

        if (result.skipped) {
            // 整批防重（另一次下载还在跑）时 total=0，硬套「成功 0 个」会变成假信息
            this.statusEl.setText('完成：已有一次封面下载在进行，本次未重复执行');
        } else {
            // 契约里 skipped 是 boolean，逐条的「跳过」只能由总数减出来（已存在同名文件的那部分）
            const skipped = Math.max(0, result.total - result.success - result.fail);
            this.statusEl.setText(`完成：成功 ${result.success} 个，跳过 ${skipped} 个，失败 ${result.fail} 个`);
        }

        if (this.fillEl) {
            this.fillEl.style.width = '100%';
        }
        if (this.countEl && !result.skipped) {
            this.countEl.setText(`${result.total}/${result.total}`);
        }
        this.renderFailures(result);

        // 无论成败都只切到「完成态 + 关闭按钮」，窗口留在原地 —— 用户 2026-10-21 明确要求禁止自动消失
        this.showCloseButton();
    }

    /** 任务异常中断：把错误原文留在状态行，不自动关，让用户能截图报障 */
    fail(message: string): void {
        if (!this.statusEl || this.finished) {
            return;
        }
        this.finished = true;
        this.statusEl.setText(`失败：${message}`);
        this.statusEl.addClass('is-error');
        this.showCloseButton();
    }

    private writeStatus(step?: ComiclikeProgressStep): void {
        if (!this.statusEl) {
            return;
        }
        this.statusEl.empty();
        this.statusEl.removeClass('is-error');
        if (!step) {
            this.statusEl.setText('正在准备…');
            return;
        }
        // 条目名单独成 span：CSS 要把它压成前缀小字，混在一整串文本里做不到
        this.statusEl.createSpan({ cls: 'rl-pm-step-title', text: `《${step.title}》` });
        this.statusEl.createSpan({ text: `网络封面 → ${step.to}` });
    }

    /**
     * 逐条追加迁移日志。`to` 为空串 = 这一条下载失败（main.localizeAllPosters 成功时才给本地路径，
     * 失败留空 —— ⛔ 不要去猜失败条目的目标文件名）。
     * 每行固定挂在日志末尾并自动滚到底，用户能看到「刚才搬了哪张图」，而不是只有一行不停被覆盖的状态。
     */
    private appendLog(step?: ComiclikeProgressStep): void {
        if (!this.logEl || !step) {
            return;
        }
        const failed = !step.to;
        const row = this.logEl.createDiv({ cls: failed ? 'rl-pm-log-item is-fail' : 'rl-pm-log-item' });
        row.createSpan({ cls: 'rl-pm-log-title', text: `《${step.title}》` });
        // 网络封面地址常常很长（BV 号 / CDN 路径），整串塞进一行会把右侧目标挤没 ⇒ 交给 CSS 截断
        // + 悬停看全文（data-tip 走核心 tooltip）
        const fromEl = row.createSpan({ cls: 'rl-pm-log-from', text: step.from || '（无网络封面）' });
        if (step.from) {
            fromEl.setAttr('data-tip', step.from);
        }
        row.createSpan({ cls: 'rl-pm-log-arrow', text: '→' });
        row.createSpan({ cls: 'rl-pm-log-to', text: failed ? '下载失败' : step.to });
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    private renderFailures(result: PosterMigrateResult): void {
        if (!this.failsEl || result.failures.length === 0) {
            return;
        }
        this.failsEl.empty();
        for (const failure of result.failures.slice(0, MAX_FAIL_ITEMS)) {
            this.failsEl.createDiv({
                cls: 'rl-pm-fail-item',
                text: `${failure.title} — ${failure.reason}`,
            });
        }
        if (result.failures.length > MAX_FAIL_ITEMS) {
            this.failsEl.createDiv({
                cls: 'rl-pm-fail-more',
                text: `另有 ${result.failures.length - MAX_FAIL_ITEMS} 条失败未列出`,
            });
        }
    }

    /**
     * 🔴 2026-10-25 用户指令：底部**不再给「关闭」按钮** —— 与右上角 ✕ 重复。
     * 原实现是「收尾才画关闭键」，现在整块撤掉；完成态就停在原地（⛔ 仍然**禁止自动消失**，
     * 那条 2026-10-21 的口径不受影响 —— 消失要用户自己点 ✕）。
     */
    private showCloseButton(): void {
        this.closeBtnEl = null;
    }
}
