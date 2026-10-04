// AI 服务「服务商 + 模型」的**合并选择器**（#480 ② 方案 A 建立 / **#484 整弹窗重做**）。
//
// #484 重做四件事（用户 2026-10-02：「太丑了，而且不能实时点击反馈是怎么回事」）：
//   ① **布局**：左栏（吃掉 200px）改成**顶部横向 chip 行** ⇒ 列表吃满宽度，长模型名基本不用截断。
//   ② **就地反馈**：拉取/失败都在**弹窗内**发生（⛔ 不再 `close()` 再重开）；失败也就地报红，
//      ⛔ 不再「弹窗消失 + 只剩一行 Notice」（硅基流动 402 / DeepSeek 空 Key 401 时用户点下去啥也没有）。
//   ③ **选中可见**：点中先亮 `is-picking` 停留一瞬再关（原来瞬间 close，用户看不到自己选了谁）。
//   ④ **键盘**：↑↓ 移动、Enter 确认（市面主流 picker 的通行做法）。
//   ⑤ **置顶 + 能力筛选**：硅基流动一次返回 97 个模型，靠 ⭐ 与 chip 收口（判定在 `pure/aiPick`）。
//
// 🔴 为什么是一个**弹窗**而不是贴在下拉框下面的浮层：
//    设置页的内容区是 `.rl-set-content { overflow-y: auto }`（#354 定的「内容区独立滚动」）——
//    绝对定位的浮层一旦高过可视区就会被**裁掉**，而这里要放「chip 行 + 筛选 + 列表」，必然很高。
// ⚠️ 弹窗**不做业务判断**：候选由上层用 `pure/translate.mergeModelCandidates` 算好传进来；
//    拉取 / 写盘 / 重渲染也都归上层（这里只负责把结果就地画出来）。
import { App, Modal } from 'obsidian';
import {
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_OFF,
    isAiOff,
    modelNote,
    modelTags,
    type AiProviderChoice,
    type AiModelCandidate,
    type ModelFetched,
} from 'pure/translate';
import { MODEL_FILTERS, filterModels, splitPinned, type ModelFilter } from 'pure/aiPick';
import { aiChoiceIcon, renderAiIcon } from 'services/aiIcon';

/**
 * 一个模型候选 —— 🔴 直接**别名到** `pure/translate.AiModelCandidate`：
 * 弹窗层不另抄一份结构（抄一份 = 加字段时必漏，#482 的元数据就是这么来的）。
 */
export type AiModelItem = AiModelCandidate;

/** 弹窗结果：提交（服务商 + 模型）/ 手填模型名（都是网络或上层的活；**拉取已改成就地，不再出弹窗**） */
export type AiPickerPick =
    | { action: 'commit'; choice: AiProviderChoice; model?: string }
    | { action: 'manual'; provider: Exclude<AiProviderChoice, 'off'> };

/** 键盘高亮停留多久再关（让用户看见自己选中的那一行）—— 短到不碍事、长到看得见 */
const COMMIT_FLASH_MS = 140;

export class AiPickerModal extends Modal {
    private choice: AiProviderChoice;
    private query = '';
    private filter: ModelFilter = 'all';
    private chipEls = new Map<AiProviderChoice, HTMLElement>();
    private listEl: HTMLElement | null = null;
    private statusEl: HTMLElement | null = null;
    private countEl: HTMLElement | null = null;
    private searchEl: HTMLInputElement | null = null;
    private filterEl: HTMLElement | null = null;
    /** 当前可见的候选项（键盘导航的下标就在这上面走） */
    private visible: AiModelItem[] = [];
    private activeIndex = -1;
    private loading = false;
    private errorText = '';
    private busy = false;

    constructor(
        app: App,
        private opts: {
            /** 该行是哪个服务（进标题，如「翻译服务」） */
            title: string;
            choice: AiProviderChoice;
            /** 已算好的候选（`mergeModelCandidates(provider, fetched)`）；按服务商取 */
            candidatesOf: (provider: Exclude<AiProviderChoice, 'off'>) => readonly AiModelItem[];
            /** 该服务商是否已经拉过一次（决定按钮写「获取」还是「重新获取」） */
            fetchedOf: (provider: Exclude<AiProviderChoice, 'off'>) => boolean;
            /**
             * 该服务商**当前在用的**模型（给选中行的 ✓ 用）。
             * ⚠️ 必须是**按服务商取**：左栏切到别家时，✓ 要落在那家的默认模型上，⛔ 不能拿着上一家的模型名去比。
             */
            modelOf: (provider: Exclude<AiProviderChoice, 'off'>) => string | undefined;
            /** 该服务商有没有填 Key —— 没 Key 就不自动拉（拉了必然 401，白等一次） */
            hasKeyOf: (provider: Exclude<AiProviderChoice, 'off'>) => boolean;
            /** 置顶清单（落在设置里，跨服务商共用一份 ⭐ 记忆） */
            pinnedOf: () => readonly string[];
            onTogglePin: (model: string) => void;
            /**
             * 🔴 #484：**就地**拉一次模型列表（⛔ 不再「关弹窗 → 请求 → 成功才重开」）。
             * 弹窗只负责转圈与把结果/错误画出来；写缓存归上层。
             */
            onFetch: (
                provider: Exclude<AiProviderChoice, 'off'>,
            ) => Promise<{ ok: boolean; models?: ModelFetched[]; message?: string }>;
            onPick: (r: AiPickerPick) => void;
        },
    ) {
        super(app);
        this.choice = opts.choice;
    }

    onOpen(): void {
        // 🔴 #482：标题与关闭按钮是**宿主元素**（`.modal-title` / `.modal-close-button`）——
        //    ⛔ 别去改全局那两条规则（会影响全仓所有弹窗）⇒ 只在**本弹窗**上挂个作用域类，再 scoped 地改。
        this.modalEl.addClass('rl-pick-modal');
        this.titleEl.addClass('rl-pick-title');
        this.titleEl.setText(`${this.opts.title} · 服务与模型`);
        const wrap = this.contentEl.createDiv({ cls: 'rl-pick' });

        // ① 顶部：服务商横向 chip（⛔ 不再是吃掉 200px 的左栏）
        const chips = wrap.createDiv({ cls: 'rl-pick-chips', attr: { role: 'tablist', 'aria-label': '服务商' } });
        for (const o of AI_PROVIDER_OPTIONS) {
            const chip = chips.createEl('button', {
                cls: 'rl-pick-chip',
                attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
            });
            renderAiIcon(chip.createSpan({ cls: 'rl-ai-icon' }), aiChoiceIcon(o.value));
            chip.createSpan({ cls: 'rl-pick-chip-text', text: o.label });
            this.chipEls.set(o.value, chip);
            chip.addEventListener('click', () => this.setChoice(o.value));
        }

        // ② 搜索（右端带计数）
        const main = wrap.createDiv({ cls: 'rl-pick-main' });
        const searchRow = main.createDiv({ cls: 'rl-pick-searchrow' });
        this.searchEl = searchRow.createEl('input', {
            cls: 'rl-input rl-pick-search',
            attr: { type: 'text', spellcheck: 'false', placeholder: '搜索模型…' },
        });
        this.searchEl.addEventListener('input', () => {
            this.query = this.searchEl?.value ?? '';
            this.activeIndex = -1;
            this.paintList();
        });
        this.countEl = searchRow.createSpan({ cls: 'rl-pick-count' });

        // ③ 筛选 chip + 右侧两个次要动作
        this.filterEl = main.createDiv({ cls: 'rl-pick-filters' });
        this.statusEl = main.createDiv({ cls: 'rl-pick-status' });
        this.listEl = main.createDiv({ cls: 'rl-pick-list', attr: { role: 'listbox', 'aria-label': '模型' } });

        // 键盘导航（↑↓ 移动 / Enter 确认）—— 挂 document 才能在搜索框里也生效
        this.contentEl.addEventListener('keydown', (ev: KeyboardEvent) => this.onKey(ev));

        this.paint();
        window.setTimeout(() => this.searchEl?.focus(), 0);
        // 🔴 #484：切到一家「没拉过 + 有 Key」的服务商 ⇒ **自动拉一次**（实测 79~147ms，很快）。
        //    ⛔ 没 Key 就不拉（必然 401，白等一次还弹出个没意义的红字）。
        const p0 = this.provider;
        if (p0 && !this.opts.fetchedOf(p0) && this.opts.hasKeyOf(p0)) void this.doFetch(p0);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    /** 下钻一层：`AiProviderChoice` 里除了 `off` 都是真服务商 */
    private get provider(): Exclude<AiProviderChoice, 'off'> | null {
        return isAiOff(this.choice) ? null : (this.choice as Exclude<AiProviderChoice, 'off'>);
    }

    private setChoice(v: AiProviderChoice): void {
        if (v === this.choice) return;
        this.choice = v;
        this.query = '';
        this.filter = 'all';
        this.activeIndex = -1;
        this.errorText = '';
        if (this.searchEl) this.searchEl.value = '';
        this.paint();
        const p = this.provider;
        if (p && !this.opts.fetchedOf(p) && this.opts.hasKeyOf(p)) void this.doFetch(p);
    }

    private paint(): void {
        for (const [v, el] of this.chipEls) {
            el.toggleClass('is-on', v === this.choice);
            el.setAttribute('aria-selected', v === this.choice ? 'true' : 'false');
        }
        this.paintFilters();
        this.paintList();
    }

    // ───────────────────────── 筛选 chip ─────────────────────────

    private paintFilters(): void {
        const box = this.filterEl;
        if (!box) return;
        box.empty();
        const p = this.provider;
        if (!p) {
            box.toggleClass('is-hidden', true);
            if (this.searchEl) this.searchEl.disabled = true;
            return;
        }
        box.toggleClass('is-hidden', false);
        if (this.searchEl) this.searchEl.disabled = false;

        for (const f of MODEL_FILTERS) {
            // 🔴 置顶档在「一个都没置顶」时也要能点进去（点了才看得见那句「还没有置顶」）⇒ ⛔ 不隐藏它
            const btn = box.createEl('button', {
                cls: 'rl-pick-fchip',
                attr: { type: 'button' },
                text: f.label,
            });
            btn.toggleClass('is-on', f.value === this.filter);
            btn.setAttribute('aria-pressed', f.value === this.filter ? 'true' : 'false');
            btn.addEventListener('click', () => {
                this.filter = f.value;
                this.activeIndex = -1;
                this.paintFilters();
                this.paintList();
            });
        }

        // 两个次要动作（#482 ③ 口径：灰色文字按钮，⛔ 不铺底、不用 mod-cta）
        const acts = box.createDiv({ cls: 'rl-pick-acts' });
        const label = AI_PROVIDER_OPTIONS.find((o) => o.value === p)?.label ?? p;
        const refresh = acts.createEl('button', {
            cls: 'rl-pick-action',
            attr: { type: 'button' },
            text: this.opts.fetchedOf(p) ? `重新获取（${label}）` : `获取（${label}）`,
        });
        refresh.addEventListener('click', () => void this.doFetch(p));
        const manual = acts.createEl('button', { cls: 'rl-pick-action', attr: { type: 'button' }, text: '手动输入…' });
        manual.addEventListener('click', () => {
            this.close();
            this.opts.onPick({ action: 'manual', provider: p });
        });
    }

    // ───────────────────────── 列表 ─────────────────────────

    private paintList(): void {
        const box = this.listEl;
        const st = this.statusEl;
        if (!box || !st) return;
        box.empty();
        this.visible = [];
        const p = this.provider;

        // 「不启用」：整块换成一句说明 + **一枚提交按钮**
        if (!p) {
            this.setCount('');
            // 🔴🔴 #485 修用户报的「选不启用服务怎么都不能关闭」：
            //    根因 —— 这个分支原来**只有一句话、没有任何提交入口**。而本弹窗的提交路径是「点模型行」，
            //    选了「不启用」之后模型列表是空的 ⇒ 那条路径根本触发不到 ⇒ 用户选了却确认不了、关不掉。
            //    ⇒ 补一枚明确的「确认不启用」。
            // ⚠️ 只在**真的发生了变化**时出现：打开时本来就是「不启用」的话，摆一个常驻按钮会让人以为必须点它。
            const same = this.choice === this.opts.choice;
            this.setStatus(
                'info',
                same
                    ? '这个服务当前就是「不启用」—— 在上方选一个服务商即可启用它。'
                    : '将关闭这个服务：AI 翻译 / 总结 / 搜索不再调用它。',
            );
            if (!same) {
                const ok = this.statusEl?.createEl('button', {
                    cls: 'rl-pick-action',
                    attr: { type: 'button' },
                    text: '确认不启用',
                });
                ok?.addEventListener('click', () => {
                    this.close();
                    this.opts.onPick({ action: 'commit', choice: AI_PROVIDER_OFF });
                });
            }
            return;
        }
        if (this.loading) {
            this.setCount('');
            this.setStatus('loading', `正在获取模型列表（${providerLabelOf(p)}）…`);
            return;
        }
        if (this.errorText) {
            this.setCount('');
            this.setStatus('bad', this.errorText);
            return;
        }

        const q = this.query.trim().toLowerCase();
        const pinned = this.opts.pinnedOf();
        const base = this.opts.candidatesOf(p).filter(
            (i) => !q || i.value.toLowerCase().includes(q) || (i.name ?? '').toLowerCase().includes(q),
        );
        const filtered = filterModels(base, this.filter, pinned);
        this.setCount(`${base.length} 个`);

        if (!filtered.length) {
            // 🔴 空态也要说清**为什么** —— 尤其「长上下文」：智谱 / 硅基流动的接口不返回元数据（实测），
            //    筛出来是空的不是 bug，⛔ 别让用户以为插件坏了。
            const why =
                this.filter === 'pinned'
                    ? '还没有置顶任何模型 —— 把鼠标移到某一行，点右侧的 ★ 就能固定到顶部。'
                    : this.filter === 'long'
                      ? `这一家的接口没有返回上下文长度（实测智谱 / 硅基流动都不返回）⇒ 无法按「长上下文」筛。换个档位，或用「手动输入…」。`
                      : q
                        ? '没有匹配的模型 —— 换个关键词，或用「手动输入…」自己填。'
                        : '这个服务商还没有候选 —— 点上面的「获取」拉一份真实的，或用「手动输入…」。';
            this.setStatus('info', why);
            return;
        }
        this.setStatus('none', '');

        const cur = (this.opts.modelOf(p) ?? '').trim();
        const sections =
            this.filter === 'pinned'
                ? [{ label: '', items: filtered }]
                : [
                      { label: '★ 置顶', items: splitPinned(filtered, pinned).top },
                      { label: `全部 ${filtered.length}`, items: splitPinned(filtered, pinned).rest },
                  ];
        for (const sec of sections) {
            if (!sec.items.length) continue;
            if (sec.label) box.createDiv({ cls: 'rl-pick-sep', text: sec.label });
            for (const it of sec.items) {
                this.visible.push(it);
                this.renderRow(box, it, cur, pinned);
            }
        }
        // 键盘高亮落在当前选中的那一项上（没有就第一项）—— 打开就能直接 Enter 微调
        if (this.activeIndex < 0 || this.activeIndex >= this.visible.length) {
            const hit = this.visible.findIndex((i) => i.value === cur);
            this.activeIndex = hit >= 0 ? hit : 0;
        }
        this.syncActive();
    }

    private renderRow(
        box: HTMLElement,
        it: AiModelItem,
        cur: string,
        pinned: readonly string[],
    ): void {
        const on = !!cur && it.value === cur;
        const row = box.createEl('button', {
            cls: 'rl-pick-item',
            attr: { type: 'button', role: 'option', 'aria-selected': on ? 'true' : 'false' },
        });
        const main = row.createDiv({ cls: 'rl-pick-item-main' });
        main.createDiv({ cls: 'rl-pick-item-name', text: it.label });
        const note = modelNote(it);
        main.createDiv({ cls: 'rl-pick-item-note', text: note });
        const tags = modelTags(it.value, it, note);
        if (tags.length) {
            const tb = row.createDiv({ cls: 'rl-pick-item-tags' });
            for (const t of tags) tb.createSpan({ cls: 'rl-pick-tag', text: t });
        }
        if (on) {
            row.addClass('is-on');
            // ✓ 是**装饰**：读屏名靠 `aria-selected`，⛔ 别再塞一份文本
            row.createSpan({ cls: 'rl-pick-check', attr: { 'aria-hidden': 'true' }, text: '✓' });
        }
        // ⭐ 置顶（悬停 / 聚焦才出现，免得 97 行全是星星）
        const isPin = pinned.includes(it.value);
        const star = row.createEl('button', {
            cls: 'rl-pick-star',
            attr: { type: 'button', 'data-tip': isPin ? '取消置顶' : '置顶到顶部' },
            text: isPin ? '★' : '☆',
        });
        star.toggleClass('is-on', isPin);
        star.createSpan({ cls: 'rl-sr', text: isPin ? '取消置顶' : '置顶到顶部' });
        star.addEventListener('click', (ev) => {
            ev.stopPropagation(); // ⛔ 别顺带把这一行选了
            this.opts.onTogglePin(it.value);
            this.paintList();
        });
        row.addEventListener('click', () => this.commit(row, it));
        row.addEventListener('mouseenter', () => {
            const i = this.visible.indexOf(it);
            if (i >= 0 && i !== this.activeIndex) {
                this.activeIndex = i;
                this.syncActive();
            }
        });
    }

    /** 🔴 #484 ③：先亮起再关（原来瞬间 close，用户看不见自己选了谁） */
    private commit(row: HTMLElement, it: AiModelItem): void {
        if (this.busy) return;
        this.busy = true;
        row.addClass('is-picking');
        window.setTimeout(() => {
            this.close();
            this.opts.onPick({ action: 'commit', choice: this.choice, model: it.value });
        }, COMMIT_FLASH_MS);
    }

    // ───────────────────────── 键盘 ─────────────────────────

    private onKey(ev: KeyboardEvent): void {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;
        if (!this.visible.length) return;
        ev.preventDefault();
        if (ev.key === 'ArrowDown') this.activeIndex = (this.activeIndex + 1) % this.visible.length;
        else if (ev.key === 'ArrowUp')
            this.activeIndex = (this.activeIndex - 1 + this.visible.length) % this.visible.length;
        else {
            const hit = this.visible[this.activeIndex];
            const row = this.listEl?.querySelectorAll<HTMLElement>('.rl-pick-item')[this.activeIndex];
            if (hit && row) this.commit(row, hit);
            return;
        }
        this.syncActive(true);
    }

    /** 把 `activeIndex` 画到 DOM（并可选滚进可视区） */
    private syncActive(scroll = false): void {
        const rows = this.listEl?.querySelectorAll<HTMLElement>('.rl-pick-item');
        if (!rows) return;
        rows.forEach((el, i) => el.toggleClass('is-active', i === this.activeIndex));
        if (scroll) rows[this.activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    // ───────────────────────── 状态条（就地 loading / 报错） ─────────────────────────

    private setStatus(kind: 'none' | 'info' | 'loading' | 'bad', text: string): void {
        const st = this.statusEl;
        if (!st) return;
        st.empty();
        st.toggleClass('is-hidden', kind === 'none');
        st.removeClass('is-loading', 'is-bad');
        if (kind === 'none') return;
        if (kind === 'loading') {
            st.addClass('is-loading');
            // 🔴 复用全仓那个 spinner（`.rl-spinner`，已带 prefers-reduced-motion 兜底）⇒ ⛔ 不新造一份
            st.createSpan({ cls: 'rl-spinner', attr: { 'aria-hidden': 'true' } });
        }
        if (kind === 'bad') st.addClass('is-bad');
        st.createSpan({ text });
        // 🔴 失败就地给一条**重试**（原来失败 = 弹窗消失、啥也没了）
        if (kind === 'bad') {
            const p = this.provider;
            if (p) {
                const again = st.createEl('button', { cls: 'rl-pick-action', attr: { type: 'button' }, text: '重试' });
                again.addEventListener('click', () => void this.doFetch(p));
            }
        }
    }

    private setCount(text: string): void {
        if (this.countEl) this.countEl.setText(text);
    }

    /**
     * 🔴 #484 ②：**就地**拉模型列表 —— 弹窗不关、列表区转圈，失败也就地报红。
     * ⛔ 不再是「close → 请求 → 成功才重开」（失败时用户点下去什么都没发生，正是用户报的那个问题）。
     */
    private async doFetch(p: Exclude<AiProviderChoice, 'off'>): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        this.errorText = '';
        this.paintList();
        const res = await this.opts.onFetch(p);
        this.loading = false;
        if (!res.ok) {
            this.errorText = res.message ?? '获取模型列表失败';
            this.paintList();
            return;
        }
        this.paintList();
        this.paintFilters(); // 「获取」→「重新获取」的文案要跟着变
    }
}

/** 服务商显示名（与 `AI_PROVIDER_OPTIONS` 同源；⛔ 不在本文件另抄一份） */
function providerLabelOf(p: Exclude<AiProviderChoice, 'off'>): string {
    return AI_PROVIDER_OPTIONS.find((o) => o.value === p)?.label ?? p;
}

/**
 * 「手动输入模型名」（#479 建立 / #480 随合并选择器搬来）：入口是拣选弹窗里的「手动输入…」。
 * 🔴 保留它的理由见 `AiPickerPick` 的注释 —— ⛔ 别因为「列表里已经有几十个」就把它删了。
 * 提交口径与全仓一致：**回车 / 失焦才提交**（取消或清空都不写盘）。
 */
export class AiModelNameModal extends Modal {
    constructor(
        app: App,
        private opts: {
            /** 哪个服务的模型（进标题，如「翻译服务 · 模型」） */
            title: string;
            placeholder: string;
            /** 当前值（回填，方便微调） */
            value: string;
            onPick: (model: string) => void;
        },
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(this.opts.title);
        const wrap = this.contentEl.createDiv({ cls: 'rl-ai-modelname' });
        const input = wrap.createEl('input', {
            cls: 'rl-input',
            attr: { type: 'text', spellcheck: 'false', placeholder: this.opts.placeholder },
        });
        input.value = this.opts.value;
        wrap.createDiv({ cls: 'rl-hint-note', text: '模型名以服务商文档为准；留空即恢复默认。' });
        const actions = wrap.createDiv({ cls: 'rl-key-actions' });
        const ok = actions.createEl('button', { cls: 'mod-cta', text: '确定' });
        actions.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
        const commit = (): void => {
            const v = input.value.trim();
            this.close();
            this.opts.onPick(v);
        };
        ok.addEventListener('click', commit);
        input.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            commit();
        });
        // 打开即聚焦（与「选自定义…自动聚焦手填框」同款）
        window.setTimeout(() => input.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
