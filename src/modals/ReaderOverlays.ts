import { Notice, setIcon } from 'obsidian';
import { SEARCH_ENGINE_GROUPS, searchEngineUrl, type SearchEngineId } from 'pure/readerSearch';
import { SEARCH_ENGINE_ICONS } from 'pure/searchIcons';

/**
 * 阅读器正文浮层的共用件：**译文卡** + **网络搜索浮层**。
 *
 * 2026-10-23 用户指令：PDF 顶栏要同步 TXT/EPUB 的快捷功能（含文本翻译、网络搜索）。
 * TXT/EPUB 各自内联实现了一份（产物断言锁着那两处，本轮不动），PDF 是**第三个**用到它的面板
 * —— 再抄一遍就是三份真源。故把「构建 + 定位 + 显隐」抽到这里，PDF 直接 new 一个用。
 *
 * 🔴 纪律（与 TXT/EPUB 内联版逐条对齐，改这里等于改三端表现）：
 *  1. 浮层挂在 `parent`（面板的 `selbarParent`）内，`absolute` 定位，坐标是 **parent 局部 px**；
 *  2. 优先生成在锚点**上方**，放不下转下方，四边钳制不出容器（`gap = 8` / `margin = 4`）；
 *  3. 面板自身 `mousedown` 必须 `stopPropagation` —— 否则 `document` 的「点外部收起」会立刻把它关掉；
 *  4. 引擎 chip 的 `mousedown` 还要 `preventDefault` —— 防焦点转移把浏览器选区弄没（用户要求选区保持可见）；
 *  5. ⛔ 不碰 `vault` / 不写笔记 —— 这里只管显示，动作一律回调给宿主。
 */

/** 浮层要用的宿主回调（PDF 面板按需注入；缺省即「当前阅读器不支持」） */
export interface ReaderOverlayHost {
    /** 译文：宿主 `translateText`；缺省 → 点翻译提示不支持 */
    translate?: (text: string) => Promise<string | null>;
    /** 外部链接：宿主 `openExternalUrl`；缺省 → 提示不支持 */
    openExternal?: (url: string) => void;
}

/** 译文卡与网络搜索浮层的状态容器（一个面板一个实例，随面板 destroy） */
export class ReaderOverlays {
    private card: HTMLDivElement | null = null;
    private cardBody: HTMLDivElement | null = null;
    private netPanel: HTMLDivElement | null = null;
    private netQuoteEl: HTMLDivElement | null = null;
    private netQuery = '';

    constructor(
        private readonly host: ReaderOverlayHost,
        private readonly parentOf: () => HTMLElement | null,
    ) {}

    // ── 译文 ──

    /** 显示译文浮层：(x, y) 为 **parent 局部坐标**（调用方已换算），text = 要翻译的选中文字 */
    showTranslate(x: number, y: number, text: string): void {
        const parent = this.parentOf();
        if (!parent) return;
        if (!this.host.translate) {
            new Notice('当前阅读器不支持翻译');
            return;
        }
        this.buildCard(parent);
        const card = this.card;
        const bodyEl = this.cardBody;
        if (!card || !bodyEl) return;
        // 先置 loading（移除 hidden 后要量一次尺寸才能钳位定位）
        bodyEl.empty();
        bodyEl.removeClass('rl-translate-error');
        bodyEl.addClass('rl-translate-loading');
        bodyEl.setText('翻译中…');
        card.classList.remove('hidden');
        const run = this.host.translate;
        void run(text)
            .then((translated) => {
                bodyEl.removeClass('rl-translate-loading');
                if (card.classList.contains('hidden')) return; // 已关闭 → 丢弃
                bodyEl.empty();
                if (translated) {
                    bodyEl.setText(translated);
                } else {
                    // 宿主已弹 Notice（端点/网络错误），卡片只提示不是译文
                    bodyEl.addClass('rl-translate-error');
                    bodyEl.setText('翻译失败');
                }
            })
            .catch(() => {
                bodyEl.removeClass('rl-translate-loading');
                if (card.classList.contains('hidden')) return;
                bodyEl.empty();
                bodyEl.addClass('rl-translate-error');
                bodyEl.setText('翻译失败');
            });
        this.place(card, parent, x, y);
    }

    /** 收起译文浮层；不打断进行中的翻译（结果到达时若已隐藏则丢弃） */
    hideTranslate(): void {
        if (this.card) this.card.classList.add('hidden');
        if (this.cardBody) this.cardBody.removeClass('rl-translate-loading');
    }

    private buildCard(parent: HTMLElement): void {
        if (this.card) return;
        const card = parent.createDiv({ cls: 'rl-translate-card hidden' });
        const head = card.createDiv({ cls: 'rl-translate-card-head' });
        head.createSpan({ cls: 'rl-translate-card-title', text: '译文' });
        const close = head.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-translate-card-close',
            attr: { 'data-tip': '关闭' },
            text: '✕',
        });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideTranslate());
        this.cardBody = card.createDiv({ cls: 'rl-translate-card-body' });
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.card = card;
    }

    // ── 网络搜索 ──

    /** 显示「网络搜索」浮层；anchor = parent 局部坐标，null 退容器中部 */
    showNet(text: string, anchor: { x: number; y: number } | null): void {
        const parent = this.parentOf();
        if (!parent) return;
        const panel = this.buildNetPanel(parent);
        if (!panel) return;
        this.netQuery = text;
        this.netQuoteEl?.setText(text ? `用选中文字：${text}` : '未选中文字 —— 先选中正文再点引擎');
        panel.classList.remove('hidden');
        const pRect = parent.getBoundingClientRect();
        const x = anchor ? anchor.x : pRect.width / 2;
        const y = anchor ? anchor.y : pRect.height / 3;
        this.place(panel, parent, x, y);
    }

    /** 收起「网络搜索」浮层（点正文其他区域 / Esc / 选完引擎） */
    hideNet(): void {
        this.netPanel?.addClass('hidden');
        this.netQuery = '';
    }

    /** 浮层是否打开（Esc 分派用） */
    isNetOpen(): boolean {
        return Boolean(this.netPanel && !this.netPanel.hasClass('hidden'));
    }

    private buildNetPanel(parent: HTMLElement): HTMLDivElement | null {
        if (this.netPanel) return this.netPanel;
        const panel = parent.createDiv({ cls: 'rl-search-net hidden' });
        const head = panel.createDiv({ cls: 'rl-search-net-head' });
        head.createSpan({ cls: 'rl-search-net-title', text: '网络搜索' });
        const close = head.createEl('button', {
            cls: 'rl-btn rl-reader-btn rl-search-net-close',
            attr: { 'data-tip': '关闭' },
            text: '✕',
        });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideNet());
        this.netQuoteEl = panel.createDiv({ cls: 'rl-search-net-quote' });
        const list = panel.createDiv({ cls: 'rl-search-net-list' });
        // 分组与顺序的唯一真源 = pure/readerSearch.SEARCH_ENGINE_GROUPS（组序 + 组内序即 UI 顺序）
        for (const g of SEARCH_ENGINE_GROUPS) {
            const col = list.createDiv({ cls: 'rl-search-net-col' });
            col.createDiv({ cls: 'rl-search-net-group', text: g.label });
            const row = col.createDiv({ cls: 'rl-search-net-row' });
            for (const eng of g.engines) {
                // 纯图标 chip（品牌官方色）+ 悬停提示；读屏名走隐藏文本
                // （UI-GUIDE §3：纯图标按钮不挂 aria-label，否则与 data-tip 气泡叠成两层）
                const b = row.createEl('button', {
                    cls: 'rl-btn rl-reader-btn rl-search-net-engine',
                    attr: { type: 'button', 'data-tip': eng.label },
                });
                b.createSpan({ cls: 'rl-sr', text: eng.label });
                applySearchEngineIcon(b, eng.id);
                // preventDefault：防焦点转移让浏览器选区消失（用户要求「选中保持高亮」）
                b.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                });
                b.addEventListener('click', () => {
                    const q = this.netQuery; // hideNet 会清锁存文本 → 先取
                    this.hideNet();
                    this.openEngine(eng.id, q);
                });
            }
        }
        panel.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.netPanel = panel;
        return panel;
    }

    private openEngine(engineId: SearchEngineId, query: string): void {
        const url = searchEngineUrl(engineId, query);
        if (!url) {
            new Notice('先选中要搜索的内容', 2500);
            return;
        }
        const open = this.host.openExternal;
        if (!open) {
            new Notice('当前阅读器不支持打开外部链接', 3000);
            return;
        }
        open(url);
    }

    // ── 共用定位 ──

    /** 在 parent 内定位 el：优先锚点上方，放不下转下方，四边钳制（rAF 里量尺寸，避免 hidden 时 rect 全 0） */
    private place(el: HTMLElement, parent: HTMLElement, x: number, y: number): void {
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();
            const gap = 8;
            const left = Math.min(Math.max(x, 4), Math.max(4, pRect.width - eRect.width - 4));
            let top = y - eRect.height - gap;
            if (top < 4) top = y + gap;
            el.style.left = `${Math.round(left)}px`;
            el.style.top = `${Math.round(Math.min(top, Math.max(4, pRect.height - eRect.height - 4)))}px`;
        });
    }

    /** 面板销毁时清引用（DOM 随面板容器一起没了，这里只解状态） */
    destroy(): void {
        this.card = null;
        this.cardBody = null;
        this.netPanel = null;
        this.netQuoteEl = null;
        this.netQuery = '';
    }
}

/** 给引擎 chip 挂图标：内置图标走 setIcon，品牌 logo 走自绘 svg + 品牌色变量（与 TXT/EPUB 同款） */
function applySearchEngineIcon(host: HTMLElement, id: SearchEngineId): void {
    const box = host.createSpan({ cls: 'rl-search-net-icon' });
    const icon = SEARCH_ENGINE_ICONS[id];
    if (icon.kind === 'builtin') {
        try {
            setIcon(box, icon.id);
        } catch {
            // 图标不可用：忽略
        }
        return;
    }
    box.style.setProperty('--rl-eng-c', icon.hex);
    if (icon.hexDark) box.style.setProperty('--rl-eng-c-dark', icon.hexDark);
    const svg = box.createSvg('svg', {
        cls: 'rl-eng-brand',
        attr: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    });
    svg.createSvg('path', { attr: { d: icon.path } });
}
