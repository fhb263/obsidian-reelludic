/**
 * 播放器「时间戳笔记」浮层（用户 `m04435` ①）。
 *
 * 用户原话：「**右键**：弹出"时间戳笔记"浮层（鼠标自动聚焦），附有一个笑脸表情图标
 * （点击后展开六档心情emoji图标），附预览窗。选择心情后生成记录并展示为：`20:15 震撼emoji`
 * （右键未选择直接关闭，不生成记录）」。
 *
 * 当场裁定（`ask_user_question`）：
 *   · 写入时机 = **「选心情只是选中，再点「写入笔记」才落」**；
 *   · 要有备注输入框，文字接在心情后面。
 *
 * 四条实现口径：
 *  ① **浮层而不是弹窗**（用户点名「浮层」）。但本仓 `position: fixed` 会被视图的 transform 祖先
 *     整体偏移（`src/views/components/MediaList.svelte:2228` / `:4053` / `:5121` 三处注释，来自 #610），
 *     所以本类只管**内容与状态**，定位/挂载交给调用方（播放器把它贴到控制栏上方的那个坐标里）。
 *     ⇒ ⛔ 别在这里用 `position: fixed` 定位到鼠标点。
 *  ② **打开即聚焦**（用户：「鼠标自动聚焦」）：用 `requestAnimationFrame` 等一帧再 `focus()`，
 *     元素刚插入时还没布局，直接 focus 在部分环境下不生效。
 *  ③ 六档心情**取自 `pure/mood` 的唯一真源**（⛔ 别手抄 emoji 数组），点已选档位 = 取消（与表单
 *     chips 同一纪律：心情可清除）。
 *  ④ **没选心情也没写备注 = 与左键单击完全一致**（用户：「右键未选择直接关闭，不生成记录」）：
 *     此时点「写入笔记」不产生带心情的记录，由调用方按「纯时间戳」处理。
 */

import { Notice, setIcon } from 'obsidian';
import { MOODS, moodChipTip, moodText, type MoodId } from 'pure/mood';
import { STAMP_NOTE_COMMIT, STAMP_NOTE_TITLE, stampNotePreview } from 'pure/stampNote';

export interface StampNoteResult {
    /** 选中的心情；未选 = undefined（不是 `''`，那样会污染落盘） */
    mood: MoodId | undefined;
    /** 备注文字（已 trim；空串表示没写） */
    note: string;
}

export interface StampNotePopoverOptions {
    /** 预览用的时间文字（与链接文字同源，多集时形如 `第3集·0:20`） */
    timeText: string;
    /** 用户点「写入笔记」后回调（心情/备注都空也可能进来 —— 那是「等价于左键单击」） */
    onCommit: (result: StampNoteResult) => Promise<void> | void;
    /** 关闭（取消 / Esc / 点空白）—— 调用方据此摘掉 DOM */
    onClose: () => void;
}

export class StampNotePopover {
    private root: HTMLElement | null = null;
    private moodRowEl: HTMLElement | null = null;
    private previewEl: HTMLElement | null = null;
    private noteEl: HTMLInputElement | null = null;
    private mood: MoodId | undefined = undefined;
    private busy = false;
    private closed = false;
    /** 🔴 挂在 `window` 捕获阶段的按键监听（Esc/Enter 抢在 Obsidian 之前）；`destroy()` 里必须摘掉 */
    private winKeyHandler: ((ev: KeyboardEvent) => void) | null = null;

    constructor(private readonly opts: StampNotePopoverOptions) {}

    /** 把浮层内容挂进 `host`（调用方负责给 host 定位）。 */
    mount(host: HTMLElement): void {
        host.empty();
        host.addClass('rl-stampnote');
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-label', STAMP_NOTE_TITLE);
        this.root = host;

        const head = host.createDiv({ cls: 'rl-stampnote-head' });
        head.createDiv({ cls: 'rl-stampnote-title', text: STAMP_NOTE_TITLE });
        const closeBtn = head.createEl('button', {
            cls: 'rl-stampnote-close',
            attr: { type: 'button', 'aria-label': '关闭（不生成记录）', 'data-tip': '关闭（不生成记录）' },
        });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', () => this.close());

        // 心情：笑脸按钮展开六档（用户：「附有一个笑脸表情图标（点击后展开六档心情emoji图标）」）
        const moodWrap = host.createDiv({ cls: 'rl-stampnote-mood' });
        this.moodRowEl = moodWrap.createDiv({ cls: 'rl-stampnote-moodrow' });
        this.moodRowEl.toggleClass('is-open', false);
        for (const m of MOODS) {
            const chip = this.moodRowEl.createEl('button', {
                cls: 'rl-stampnote-moodchip',
                attr: { type: 'button', 'aria-pressed': 'false', 'data-tip': moodChipTip(m.id, false) },
            });
            chip.createSpan({ cls: 'rl-stampnote-emoji', text: m.emoji });
            chip.createSpan({ cls: 'rl-stampnote-moodlabel', text: m.label });
            chip.addEventListener('click', () => this.toggleMood(m.id));
        }
        const smileBtn = moodWrap.createEl('button', {
            cls: 'rl-stampnote-smile',
            attr: { type: 'button', 'aria-expanded': 'false', 'aria-label': '选择心情', 'data-tip': '选择心情' },
        });
        setIcon(smileBtn, 'smile');
        // 笑脸放在 moodRow **之前**（视觉上「笑脸在左，展开的档位在右」）
        moodWrap.insertBefore(smileBtn, this.moodRowEl);
        smileBtn.addEventListener('click', () => {
            const open = !this.moodRowEl?.hasClass('is-open');
            this.moodRowEl?.toggleClass('is-open', open);
            smileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) this.focusFirstMood();
        });

        // 备注输入框（用户裁定：文字接在心情后面）
        this.noteEl = host.createEl('input', {
            cls: 'rl-stampnote-note',
            attr: { type: 'text', placeholder: '补一句（可留空）', 'aria-label': '备注' },
        });
        this.noteEl.addEventListener('input', () => this.syncPreview());

        // 预览窗（用户：「附预览窗」）
        this.previewEl = host.createDiv({ cls: 'rl-stampnote-preview' });

        const ops = host.createDiv({ cls: 'rl-stampnote-ops' });
        const cancel = ops.createEl('button', { cls: 'rl-btn', text: '取消', attr: { type: 'button' } });
        cancel.addEventListener('click', () => this.close());
        const ok = ops.createEl('button', { cls: 'rl-btn mod-cta', text: STAMP_NOTE_COMMIT, attr: { type: 'button' } });
        ok.addEventListener('click', () => void this.commit());

        host.addEventListener('keydown', (ev: KeyboardEvent) => this.onKeyDown(ev));
        // 🔴 真机实测（m04435 ①）：Esc / Enter **收不到** —— 上面那条挂在 host 上的监听永远不触发。
        //   逐层埋点证据：真实按键下 `winCap:1, docCap:0, hostCap:0, noteCap:0`
        //   ⇒ Obsidian 在 **window 捕获阶段**就把按键吃掉（它自己的 Esc 关面板逻辑），
        //   事件根本没进到 document、更进不到浮层。
        //   ⇒ 必须在 window 的**捕获阶段**（第三参 true）再挂一份，才能抢在 Obsidian 之前。
        //   ⛔ 别改成 `document.addEventListener`（仍然在后，实测计数 0）；⛔ 别只删上面那条。
        this.winKeyHandler = (ev: KeyboardEvent) => {
            if (!this.root) return;
            // 只处理浮层还活着、且焦点确实落在浮层内部（或其子节点）的情况，
            // ⛔ 不能无条件吞掉全窗口的 Esc —— 那会让别处的 Esc（关弹窗/关设置）失效。
            const active = activeDocument.activeElement;
            const inside = !!active && (this.root === active || this.root.contains(active));
            if (!inside) return;
            this.onKeyDown(ev);
        };
        window.addEventListener('keydown', this.winKeyHandler, true);

        this.syncPreview();
        // 用户要求「鼠标自动聚焦」：等一帧再 focus（刚插入还没布局）
        window.requestAnimationFrame(() => {
            if (this.closed) return;
            this.noteEl?.focus();
        });
    }

    /** 摘掉挂载的 DOM（幂等；`onClose` 只回调一次 —— 反复调用不会重复通知） */
    destroy(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.winKeyHandler) {
            window.removeEventListener('keydown', this.winKeyHandler, true);
            this.winKeyHandler = null;
        }
        this.root?.empty();
        this.root = null;
        this.moodRowEl = null;
        this.previewEl = null;
        this.noteEl = null;
    }

    /**
     * Esc = 关闭不落盘；Enter = 写入。⛔ 不改事件语义（用户：「右键未选择直接关闭，不生成记录」）。
     * `host` 与 `window` 捕获两处都会进来 ⇒ 幂等（`close()` / `commit()` 自身有守卫）。
     */
    private onKeyDown(ev: KeyboardEvent): void {
        if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            this.close();
        } else if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            void this.commit();
        }
    }

    close(): void {
        if (this.closed) return;
        this.destroy();
        this.opts.onClose();
    }

    private toggleMood(id: MoodId): void {
        // 点已选档位 = 取消（与表单 chips / 评分「再点清零」同一纪律）
        this.mood = this.mood === id ? undefined : id;
        this.moodRowEl?.querySelectorAll<HTMLElement>('.rl-stampnote-moodchip').forEach((el, i) => {
            const m = MOODS[i];
            if (!m) return;
            const on = m.id === this.mood;
            el.toggleClass('is-on', on);
            el.setAttribute('aria-pressed', on ? 'true' : 'false');
            el.setAttribute('data-tip', moodChipTip(m.id, on));
        });
        this.syncPreview();
    }

    private focusFirstMood(): void {
        window.requestAnimationFrame(() => {
            if (this.closed) return;
            this.moodRowEl?.querySelector<HTMLElement>('.rl-stampnote-moodchip')?.focus();
        });
    }

    /** 预览窗：`0:20 🤩 震撼 备注`；两者都空时显示「与左键单击相同」的说明 */
    private syncPreview(): void {
        const el = this.previewEl;
        if (!el) return;
        el.empty();
        const note = this.noteEl?.value ?? '';
        const line = stampNotePreview(this.opts.timeText, this.mood, note);
        el.createDiv({ cls: 'rl-stampnote-preview-main', text: line });
        if (!this.mood && !note.trim()) {
            el.createDiv({ cls: 'rl-stampnote-preview-hint', text: '不选心情也不写备注，就与左键单击相同。' });
        }
    }

    private async commit(): Promise<void> {
        if (this.busy || this.closed) return;
        this.busy = true;
        const result: StampNoteResult = { mood: this.mood, note: (this.noteEl?.value ?? '').trim() };
        try {
            // 先关再写：写入是异步落盘（可能几帧），浮层留着会让人以为还能改
            this.destroy();
            await this.opts.onCommit(result);
        } catch (err) {
            new Notice(`写入时间戳笔记失败：${err instanceof Error ? err.message : String(err)}`, 4000);
        } finally {
            this.busy = false;
            this.opts.onClose();
        }
    }
}

/** 心情 → 展示文字（`🤩 震撼`）；供截图/测试断言的口径与 `pure/mood` 同源 */
export function stampMoodText(mood: MoodId | undefined): string {
    return moodText(mood);
}
