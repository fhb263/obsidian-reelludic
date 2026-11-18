// 通用「输入一行文本」弹窗（2026-11-25 建立）。
//
// 🔴 为什么新开一个而不是复用 `AiModelNameModal`：那个是 AI 模型的专用弹窗（标题文案、
//    提示语、「留空即恢复默认」的提交口径都绑在模型名语义上），拿来做「批量填合集 /
//    标签」会把两套语义缠在一起。这里只保留**一行输入 + 确定/取消**这件最小的事。
//    样板与 `AiModelNameModal` 同源：`rl-input` + `rl-key-actions` + 回车提交 + 打开即聚焦。
//
// ⚠️ 全仓没有通用文本输入弹窗，这是第一个 —— 后续要「输一个字符串」的入口请用这个，
//    ⛔ 别再各自手搭一套 input（会出现三套回车行为、三套空值口径）。
import { App, Modal } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';

export interface TextPromptOptions {
    /** 标题 */
    title: string;
    /** 输入框占位文案 */
    placeholder?: string;
    /** 初始值（回填，方便微调） */
    value?: string;
    /** 确定按钮文案（缺省「确定」） */
    okText?: string;
    /** 输入框下方的一行说明（可选） */
    hint?: string;
    /**
     * 允许提交空串吗？
     * 🔴 缺省 `false`：大多数场景「输了个空」等于没输，交上去只会把现有值抹掉。
     * ⚠️ 「批量清空合集」这类**空串有意义**的场景必须显式传 `true`。
     */
    allowEmpty?: boolean;
    /** 提交（已 trim）。取消则不调用 */
    onSubmit: (value: string) => void;
}

export class TextPromptModal extends Modal {
    constructor(app: App, private opts: TextPromptOptions) {
        super(app);
    }

    open(): Promise<string | null> {
        super.open();
        return new Promise((res) => {
            this.resolve = res;
        });
    }

    private resolve: ((v: string | null) => void) | null = null;

    onOpen(): void {
        applyScrollPref(this.modalEl);
        this.titleEl.setText(this.opts.title);
        const wrap = this.contentEl.createDiv({ cls: 'rl-textprompt' });
        const input = wrap.createEl('input', {
            cls: 'rl-input',
            attr: {
                type: 'text',
                spellcheck: 'false',
                placeholder: this.opts.placeholder ?? '',
            },
        });
        input.value = this.opts.value ?? '';
        if (this.opts.hint) {
            wrap.createDiv({ cls: 'rl-hint-note', text: this.opts.hint });
        }
        const actions = wrap.createDiv({ cls: 'rl-key-actions' });
        const ok = actions.createEl('button', { cls: 'mod-cta', text: this.opts.okText ?? '确定' });
        actions.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());

        // ⚠️ 空值守卫只在 allowEmpty=false 时生效：直接把确定钮灰掉，
        //    比「点了没反应」清楚（用户能看出「这里必须填东西」）。
        const syncOk = (): void => {
            if (this.opts.allowEmpty) {
                ok.disabled = false;
                return;
            }
            ok.disabled = input.value.trim().length === 0;
        };
        syncOk();
        input.addEventListener('input', syncOk);

        const commit = (): void => {
            const v = input.value.trim();
            if (!this.opts.allowEmpty && v.length === 0) return;
            // 🔴🔴 必须先 resolve 再 close（2026-11-16 真机报障「填入链接点获取后直接提示已取消获取」）：
            //    `Modal.close()` 会**同步**跑 `onClose()`，那里有一句 `this.resolve?.(null)`。
            //    原实现先 `close()` 后 `onSubmit(v)` ⇒ promise 已经被解析成 `null`，
            //    调用方（`promptFetchGameSwf`）永远拿到「已取消」，用户点的「获取」白点。
            //    现在先把值交出去并清空 resolve，`onClose` 里那句就自动变成无操作。
            this.resolve?.(v);
            this.resolve = null;
            this.close();
            this.opts.onSubmit(v);
        };
        ok.addEventListener('click', commit);
        input.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter') return;
            ev.preventDefault();
            commit();
        });
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    }

    onClose(): void {
        // 关闭未提交 → null（调用方据此不做任何事）
        this.resolve?.(null);
        this.resolve = null;
        this.contentEl.empty();
    }
}
