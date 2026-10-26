import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';
import { ConfirmModal } from 'modals/ConfirmModal';

/** 一条失效链接：宿主扫描时拿到的原始事实，这个弹窗只负责原样展示，不做二次判定 */
export interface DeadLinkItem {
    entryId: string;
    title: string;
    label: string;
    url: string;
}

/** 检测汇总，与设置页那行「已检测 X 个条目：M 条可能已失效」同源，弹窗只是换个更大的容器摊开 */
export interface LinkCheckSummary {
    entries: number;
    dead: number;
    unknown: number;
}

/**
 * 失效链接检测结果弹窗。
 *
 * 为什么单独开弹窗，而不是继续在设置页里塞一行 `.rl-hint`：
 *   ⑴ 全库的失效项可能几十条，一行字最多给个数，用户既点不进去看是哪一条，也没法直接开链接确认；
 *   ⑵ 用户明确要「居中带遮罩」的结果面板 —— 与「下载封面」进度窗同一档视觉，设置页只负责发命令。
 *
 * 为什么结果不落盘：宿主 scanLibraryLinks 的失效集本来就只在内存里（重启后一律回到未知），
 * 这里跟着不存，就不必为「过期结果」做兼容；footer 里把这点直接讲明，免得用户以为能复用。
 *
 * 🔴 2026-10-25 用户指令（**现行定稿**）：「失效链接检测**先弹窗**再**陆续显示**检测到的失效链接，
 *    其弹窗底部**不要显示「取消」按钮**（和顶部 ✕ 重复）」。
 *    ⇒ 两种打开方式并存，靠构造参数区分：
 *      ① **渐进态**（`progressive: true`，设置页检测走这条）：先 `open()` 一个只有标题 + 「检测中…」的壳，
 *         宿主每探出一条 dead 就调 `appendItem()` 往里加一行；
 *      ② **快照态**（旧签名，带 `items`）：一次性给全量明细，直接铺（保留给「别处只读打开」的场景）。
 *    ⚠️ 底部只留「一键清除失效链接」（且仅在有 dead 项、有执行体时出现）+ 说明文案。
 *       ⛔ 别再画「关闭」/「取消」——用户对五个弹窗统一提了同一条（顶部 ✕ 就是关）。
 */
export class LinkCheckModal extends Modal {
    private summary: LinkCheckSummary;
    private items: DeadLinkItem[];
    /**
     * 🔴 2026-10-22：一键清除的执行体（由设置页注入，弹窗不直接持有 plugin —— 和其他弹窗
     * 「宿主给能力、弹窗只管呈现」的既有分工一致）。
     * `undefined` = 没有入口（例如从别处只读打开），此时**不渲染**清除按钮。
     */
    private readonly onClearDead?: () => Promise<{ links: number; entries: number }>;

    /** 渐进态：宿主还在跑，`false` 时副标题显示「检测中…」、新增行后自动把列表滚到底 */
    private scanning = false;
    private listEl: HTMLElement | null = null;
    private subEl: HTMLElement | null = null;
    private footEl: HTMLElement | null = null;
    private opsEl: HTMLElement | null = null;

    constructor(app: App, summary: LinkCheckSummary, items: DeadLinkItem[], onClearDead?: () => Promise<{ links: number; entries: number }>);
    /**
     * 第二种口径：plan 的冻结契约写的是单 opts 对象 `{ entries, dead, unknown, items }`，
     * 这里用重载同时认两种调用，调用方按哪份文档写都不会挂 —— 行为完全一致，不是两套实现。
     */
    constructor(app: App, opts: LinkCheckSummary & { items: DeadLinkItem[]; onClearDead?: () => Promise<{ links: number; entries: number }> });
    constructor(
        app: App,
        summaryOrOpts: LinkCheckSummary | (LinkCheckSummary & { items: DeadLinkItem[]; onClearDead?: () => Promise<{ links: number; entries: number }> }),
        items?: DeadLinkItem[],
        onClearDead?: () => Promise<{ links: number; entries: number }>,
    ) {
        super(app);
        if (items) {
            this.summary = summaryOrOpts;
            this.items = items;
            this.onClearDead = onClearDead;
            return;
        }
        const opts = summaryOrOpts as LinkCheckSummary & {
            items?: DeadLinkItem[];
            onClearDead?: () => Promise<{ links: number; entries: number }>;
        };
        this.summary = opts;
        // opts.items 缺失时兜底成空列表：宁可显示「未发现失效链接」，也不要让设置页因为少传字段整窗炸掉
        this.items = opts.items ?? [];
        this.onClearDead = opts.onClearDead;
    }

    /**
     * 🔴 渐进态工厂：只给汇总的入口。宿主拿到它后先 `open()` 弹窗，再边跑边 `appendItem()`。
     * ⚠️ 与快照构造共用同一份渲染，⛔ 不是第二套实现。
     */
    static progressive(
        app: App,
        summary: LinkCheckSummary,
        onClearDead?: () => Promise<{ links: number; entries: number }>,
    ): LinkCheckModal {
        return new LinkCheckModal(app, summary, [], onClearDead);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        // 宽度类挂 modalEl 而不是 contentEl：Obsidian 的壳宽由 .modal 决定，挂错层会被主题的 max-width 吃掉
        this.modalEl.addClass('rl-lc-modal');

        const { contentEl } = this;
        contentEl.empty();
        // 列表自己有滚动条（CSS 给 .rl-lc-list overflow-y:auto），所以外层 modal-content 不再滚，
        // 否则两层同时可滚会出现「滚不动」的错觉
        markScrollInside(this.modalEl);

        // 标题与副标题刻意做成两个兄弟节点（而不是 titleEl + 一行文字）：
        // 之前附件管理弹窗就是靠 margin 硬错位，结果长文案换行后压到标题上，这里用结构保证分行
        const head = contentEl.createDiv({ cls: 'rl-lc-head' });
        head.createDiv({ cls: 'rl-lc-title', text: '失效链接检测' });
        this.subEl = head.createDiv({ cls: 'rl-lc-sub', text: this.scanning ? '正在检测…' : this.subtitle() });

        this.listEl = contentEl.createDiv({ cls: 'rl-lc-list' });
        this.renderList();

        this.footEl = contentEl.createDiv({ cls: 'rl-lc-foot' });
        this.footEl.createSpan({ cls: 'rl-lc-note', text: '检测结果只存内存，重启后需重新检测' });
        // 按钮们包一层：footer 是 space-between 的 row，多个裸子节点会把说明挤到中间（`.rl-lc-ops` 保证成组靠右）
        this.opsEl = this.footEl.createDiv({ cls: 'rl-lc-ops' });
        // 🔴 2026-10-25：**底部不画「关闭」** —— 与顶部 ✕ 重复（用户对五个弹窗统一的口径）。
        this.renderOps();
    }

    /** 列表整体重画（快照态一次画完；渐进态由 appendItem 增量追加） */
    private renderList(): void {
        if (!this.listEl) return;
        this.listEl.empty();
        if (this.items.length === 0) {
            this.listEl.createDiv({
                cls: 'rl-lc-empty',
                text: this.scanning ? '正在检测…（每发现一条失效链接就会出现在这里）' : '未发现失效链接',
            });
            return;
        }
        for (const item of this.items) {
            this.renderRow(this.listEl, item);
        }
    }

    /** 按钮区（渐进态下 dead 数会变 ⇒ 必须可增量重画） */
    private renderOps(): void {
        if (!this.opsEl) return;
        this.opsEl.empty();
        // 🔴 2026-10-22：有失效项且宿主给了执行体才出「一键清除」（没有 dead 时点了也是空操作，不如不出现）
        // ⚠️ 渐进态收尾前不出：跑到一半点清除只会清掉「此刻已知」的一小撮，用户以为清完了
        const canClear = !this.scanning && this.onClearDead !== undefined && this.items.length > 0;
        if (canClear) {
            const clearBtn = this.opsEl.createEl('button', { cls: 'rl-btn rl-btn-danger', text: '一键清除失效链接' });
            clearBtn.onclick = () => void this.clearDead(clearBtn);
        }
    }

    /**
     * 🔴 渐进态：宿主每探出一条失效链接就调一次（`main.scanLibraryLinks` 的 onDead）。
     * 增量追加而不是整表重画 —— 重画会让列表滚动位置跳回顶部，正是用户抱怨的那类体验。
     */
    appendItem(item: DeadLinkItem): void {
        if (!this.listEl) return;
        // 第一行进来的那一刻把空态清掉
        if (this.items.length === 0) this.listEl.empty();
        this.items.push(item);
        this.renderRow(this.listEl, item);
        // 跟着最新一条滚到底：用户看的是「又抓到一条」，不是回到顶部重新翻
        this.listEl.scrollTop = this.listEl.scrollHeight;
    }

    /** 渐进态收尾：切回以 complete 状态为基准的副标题 + 补出「一键清除」 */
    finishScan(summary: LinkCheckSummary): void {
        const wasScanning = this.scanning;
        this.scanning = false;
        this.summary = summary;
        this.items = this.items.slice(); // 数量以已推入的明细为准（summary.dead 是宿主权威计数）
        if (this.subEl) this.subEl.setText(this.subtitle());
        if (wasScanning) {
            // 一条都没抓到 ⇒ 列表还是那句「正在检测…」，要换成终态文案
            if (this.items.length === 0) this.renderList();
            this.renderOps();
        }
    }

    /** 开始标记：调用方 `open()` 之前调（或之后立刻调）都能生效 */
    markScanning(): void {
        this.scanning = true;
        if (this.subEl) this.subEl.setText('正在检测…');
        this.renderOps();
    }

    /**
     * 一键清除：二次确认 → 执行 → 关窗（失败或无改动时就地重绘）。
     * ⚠️ 只清「已失效」，`unknown`（多为超时/风控）保留 —— 用户当轮裁定的口径，确认文案里讲明白。
     * ⚠️ 清成功后**关窗**而不是留着旧列表：`items` 是扫描时的快照，清完就不代表现状了，
     *    留一屏点过却还在的行比关掉更容易让人以为「没生效」。
     */
    private async clearDead(btn: HTMLButtonElement): Promise<void> {
        const run = this.onClearDead;
        if (!run) return;
        const ok = await new ConfirmModal(
            this.app,
            `将清除 ${this.items.length} 条已失效链接的地址（「无法确认」的保留不动）。清除后不可恢复，集序号不会变动。`,
            '清除',
        ).open();
        if (!ok) return;
        btn.disabled = true;
        const label = btn.textContent;
        btn.setText('清除中…');
        try {
            const r = await run();
            new Notice(r.links > 0 ? `已清除 ${r.links} 条失效链接（涉及 ${r.entries} 个条目）` : '没有可清除的失效链接');
            if (r.links > 0) {
                // 列表已全部作废（缓存里被清的位置也置空了）⇒ 直接关窗，避免留一屏「点了却没变」的旧行
                this.close();
                return;
            }
            this.onOpen(); // 什么都没清掉（例如已被别处改过）⇒ 就地重绘，保持窗口与列表一致
        } catch {
            new Notice('清除失败，请稍后再试');
        } finally {
            btn.disabled = false;
            btn.setText(label ?? '一键清除失效链接');
        }
    }

    onClose(): void {
        this.listEl = null;
        this.subEl = null;
        this.footEl = null;
        this.opsEl = null;
        this.contentEl.empty();
    }

    /** 副标题文案集中在一处，避免「有 items 但 entries 为 0」这类组合在模板里散成好几份判断 */
    private subtitle(): string {
        const unknownTail = this.summary.unknown > 0 ? `，另有 ${this.summary.unknown} 条无法确认` : '';
        if (this.summary.entries === 0) {
            return '没有可检测的网络地址';
        }
        if (this.items.length === 0) {
            return `共检测到 ${this.summary.entries} 个条目，未发现失效链接${unknownTail}`;
        }
        return `共检测到 ${this.summary.entries} 个条目，其中 ${this.summary.dead} 条可能已失效${unknownTail}`;
    }

    private renderRow(list: HTMLElement, item: DeadLinkItem): void {
        const row = list.createDiv({ cls: 'rl-lc-row' });
        row.createSpan({ cls: 'rl-lc-entry', text: item.title, attr: { 'data-tip': item.title } });
        row.createSpan({ cls: 'rl-lc-label', text: item.label });

        // 既写 href 也绑 click：桌面端 Obsidian 里裸 <a> 的默认跳转有时被 shell 拦掉，
        // click 里再 window.open 一次是双保险；preventDefault 保证不会「开两个」
        const link = row.createEl('a', {
            cls: 'rl-lc-url',
            text: item.url,
            attr: {
                href: item.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                'data-tip': item.url,
            },
        });
        link.onclick = (ev: MouseEvent) => {
            ev.preventDefault();
            window.open(item.url, '_blank');
        };
    }
}
