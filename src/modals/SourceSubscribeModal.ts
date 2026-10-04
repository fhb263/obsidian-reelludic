// 「订阅 / 粘贴书源」弹窗（#432 甲 · A4）。**DOM API 渲染，样式写入 styles.css**（`rl-sub-*`）——
// 与 `ImportBangumiModal` 同款（本仓既有约定：轻量一次性弹窗不必上 Svelte 组件）。
//
// 两条入口**共用这一个弹窗**（用户不需要先想「我这是订阅还是粘贴」）：
//   · 粘一个 `http(s)://…` ⇒ 先拉回来再解析（订阅）；
//   · 粘一段 JSON 文本 ⇒ 直接解析（很多人是从网页上整段拷下来的）。
//
// 🔴 设计要点（⛔ 三条都别省）：
//   ① **先解析、后导入**：中间的「预览」不是装饰 —— 用户必须能看见
//      「可用几条 / 跳过几条 / 每条为什么」，否则他会以为导入坏了（本仓「不静默丢」的既有口径）。
//   ② **跳过原因逐条列出**：`.js` 脚本型不是「坏源」，而是**我们按红线不收**（见 `pure/sourcePack`）——
//      这条区别必须写在用户看得见的地方，⛔ 不能只留在代码注释里。
//   ③ **可取消**：订阅可能拉几十个文件，⛔ 别让弹窗卡死；关窗（✕ / Esc）**也取消**（照 #428 的口径）。

import { Modal, Notice, type App } from 'obsidian';
import { CancelledError, createCancelToken, type CancelToken } from 'pure/cancel';
import type { SourcePackSkipped } from 'pure/sourcePack';
import type { NovelSource } from 'pure/sourceRule';

export interface SourceSubscribeResolved {
    sources: NovelSource[];
    skipped: SourcePackSkipped[];
    packName: string;
}

export interface SourceSubscribeModalOptions {
    /** 归到哪一类（展示用，例如「网络文学源」） */
    kindLabel: string;
    /** 解析（拉取 + 宽松解析）；`onProgress` 给阶段文字，`cancel` 供中途放弃 */
    onResolve: (input: string, onProgress: (label: string) => void, cancel: CancelToken) => Promise<SourceSubscribeResolved>;
    /** 用户点「导入」后落库 */
    onApply: (resolved: SourceSubscribeResolved) => { ok: boolean; message: string };
}

export class SourceSubscribeModal extends Modal {
    private cancel: CancelToken = createCancelToken();

    constructor(
        app: App,
        private readonly opts: SourceSubscribeModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-sub-modal');
        this.titleEl.setText('订阅 / 粘贴书源');

        contentEl.createDiv({
            cls: 'rl-sub-hint',
            text:
                `粘一个订阅地址（拉回来的是书源清单），或者直接粘一段书源 JSON —— 都会先解析给你看，确认后再导入到「${this.opts.kindLabel}」。` +
                '本插件不内置任何书源；脚本型 .js 书源会被跳过并说明原因（不执行第三方脚本）。',
        });

        const input = contentEl.createEl('textarea', {
            cls: 'rl-sub-input',
            attr: { placeholder: 'https://…/repository.json　或　[{ "name": "…", … }]', rows: '5' },
        });

        const actions = contentEl.createDiv({ cls: 'rl-sub-actions' });
        const parseBtn = actions.createEl('button', { cls: 'rl-btn', text: '解析' });
        const applyBtn = actions.createEl('button', { cls: 'rl-btn mod-cta', text: '导入' });
        applyBtn.disabled = true;
        const status = contentEl.createDiv({ cls: 'rl-sub-status', text: '' });
        const preview = contentEl.createDiv({ cls: 'rl-sub-preview' });

        let resolved: SourceSubscribeResolved | null = null;

        parseBtn.addEventListener('click', () => {
            void (async () => {
                const text = input.value.trim();
                if (!text) {
                    status.setText('先粘一个订阅地址或一段书源 JSON。');
                    return;
                }
                // 每次解析换一枚新令牌（上一轮可能被取消过）—— ⛔ 别复用旧令牌（它已 stop，新请求会当场被放弃）
                this.cancel = createCancelToken();
                parseBtn.disabled = true;
                applyBtn.disabled = true;
                resolved = null;
                preview.empty();
                status.setText('正在解析…');
                try {
                    const r = await this.opts.onResolve(text, (label) => status.setText(label), this.cancel);
                    resolved = r;
                    this.renderPreview(preview, status, r);
                    applyBtn.disabled = r.sources.length === 0;
                } catch (e) {
                    // 🔴 取消 = **中性提示**（用户自己按的，不是出错）—— ⚠️ 必须用 `instanceof` 判，
                    //    ⛔ 不许拿 `e.name` / message 字符串比对（文案一改就静默失配，本仓 #428 已定）。
                    if (e instanceof CancelledError) status.setText('已取消。');
                    else status.setText(`解析失败：${e instanceof Error ? e.message : String(e)}`);
                } finally {
                    parseBtn.disabled = false;
                }
            })();
        });

        applyBtn.addEventListener('click', () => {
            if (!resolved) return;
            const out = this.opts.onApply(resolved);
            new Notice(out.message, out.ok ? 6000 : 8000);
            if (out.ok) this.close();
        });
    }

    /**
     * 预览区：一句摘要 + **跳过清单**。
     * 🔴 跳过的每条都要带原因（用户才知道「订了 30 条怎么只进来 3 条」）；超过 8 条折叠成一句计数，
     *    ⛔ 别把弹窗铺成一面墙（与「失败源折叠区」同一口径）。
     */
    private renderPreview(box: HTMLDivElement, status: HTMLDivElement, r: SourceSubscribeResolved): void {
        box.empty();
        const bits = [`可用 ${r.sources.length} 条`];
        if (r.skipped.length) bits.push(`跳过 ${r.skipped.length} 条`);
        status.setText(
            r.sources.length
                ? `${r.packName ? `「${r.packName}」· ` : ''}${bits.join(' · ')} —— 点「导入」写进设置。`
                : `${r.packName ? `「${r.packName}」· ` : ''}没有可用的源，看看下面的原因。`,
        );
        if (!r.skipped.length) return;
        box.createDiv({ cls: 'rl-sub-skip-title', text: '跳过的条目（为什么没收）' });
        const list = box.createDiv({ cls: 'rl-sub-skip-list' });
        r.skipped.slice(0, 8).forEach((s) => {
            const row = list.createDiv({ cls: 'rl-sub-skip-row' });
            row.createSpan({ cls: 'rl-sub-skip-name', text: s.name || '（未命名）' });
            row.createSpan({ cls: 'rl-sub-skip-why', text: s.reason });
        });
        if (r.skipped.length > 8) box.createDiv({ cls: 'rl-sub-skip-more', text: `…另有 ${r.skipped.length - 8} 条，同上` });
    }

    /**
     * 🔴 关窗（✕ / Esc）= **也取消**在飞的拉取（照 #428 定下的口径）。
     * ⚠️ 只是「不再等它」—— 掐不断已经发出去的请求，但用户不必等一整轮超时。
     */
    onClose(): void {
        this.cancel.stop();
        this.contentEl.empty();
    }
}
