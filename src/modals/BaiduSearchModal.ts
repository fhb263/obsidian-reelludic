// 「百度搜索」内嵌弹窗（用户 m17219）。
//
// 🔴 用户原话：「点击即可内弹窗百度搜索改条目名称」；裁定：「纯内嵌百度网页，不回填」。
//    ⇒ 本弹窗**只承载一个浏览器视图**：把 `https://www.baidu.com/s?wd=<标题 作者>` 灌进内嵌容器，
//      用户在页面里自己看、自己点、自己改标题框。⛔ 不要加「点结果回填」这类注入脚本
//      （用户明确否掉了那一档；且跨站注入在 `<webview>` 里要 `executeJavaScript`，
//       目标页随时改版就会静默失效，属于「看着能用其实不牢」）。
//
// 🔴 为什么用 `mountEmbedHost` 而不是自己 `createEl('iframe')`：
//    那是本仓唯一的承载层（`services/gameEmbedHost`）。它优先用 `<webview>`——**独立 webContents**，
//    不是第三方上下文，浏览器特征完整。这一点对本弹窗是硬需求：
//    实测裸 HTTP 请求百度 `/s?wd=…` 会被 302 到 `wappass.baidu.com/static/captcha/tuxing_v2.html`
//    （图形验证码）或 `bioc-static.cdn.bcebos.com/pages/ds_svcp.html`（人机校验）。
//    降级 iframe 时更可能撞验证码 ⇒ 界面上要**明说**当前是哪一档，别让用户以为功能坏了。
//
// ⚠️ `dispose()` 必须在本弹窗 `onClose` 里调：`<webview>` 是独立 webContents，
//    元素从 DOM 摘掉后进程不一定立刻回收（`services/gameEmbedHost` 头注释记了这条实测）。
import { App, Modal, Notice } from 'obsidian';
import { mountEmbedHost, type EmbedHost } from 'services/gameEmbedHost';
import { baiduSearchQuery, baiduSearchUrlFor, baiduQueryIsEmpty } from 'pure/baiduSearch';

export interface BaiduSearchOptions {
    /** 条目标题（可能为空 —— 新条目还没填） */
    title?: string;
    /** 作者 / 导演 / 开发商（与标题一起拼查询词） */
    author?: string;
    /** 打开外部浏览器（走宿主，⛔ 不用 `<a target="_blank">`） */
    onOpenExternal?: (url: string) => void;
}

export class BaiduSearchModal extends Modal {
    private host: EmbedHost | null = null;
    private url = '';

    constructor(app: App, private readonly opts: BaiduSearchOptions) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-baidu-modal');
        // 弹窗要装得下一个网页：默认尺寸按「半个视口」给，窄屏仍能收
        modalEl.addClass('rl-baidu-modal-shell');

        const query = baiduSearchQuery(this.opts.title, this.opts.author);
        this.url = baiduSearchUrlFor(this.opts.title, this.opts.author);

        // ── 头：查询词 + 两个出口 ────────────────────────────────────────────
        const head = contentEl.createDiv({ cls: 'rl-baidu-head' });
        head.createDiv({
            cls: 'rl-baidu-query',
            text: baiduQueryIsEmpty(query)
                ? '标题与作者都是空的 —— 已打开百度首页，直接在里面搜就行'
                : `正在百度搜索：${query}`,
        });

        const acts = head.createDiv({ cls: 'rl-baidu-acts' });

        const reload = acts.createEl('button', { cls: 'rl-btn', text: '重新加载' });
        reload.setAttribute('data-tip', '百度页面卡住或撞了人机校验时点它重来一次');
        reload.onclick = () => {
            if (!this.host) return;
            this.host.load(this.url);
        };

        const external = acts.createEl('button', { cls: 'rl-btn', text: '在浏览器打开' });
        external.setAttribute('data-tip', '内嵌页受限时，用系统浏览器打开同一个搜索');
        external.onclick = () => {
            if (this.opts.onOpenExternal) {
                this.opts.onOpenExternal(this.url);
                this.close();
                return;
            }
            // 没有宿主注入就自己走 window.open —— 与 `Settings.renderHintNote` 同口径的兜底
            window.open(this.url, '_blank');
        };

        // ── 承载层 ──────────────────────────────────────────────────────────
        const stage = contentEl.createDiv({ cls: 'rl-baidu-stage' });
        this.host = mountEmbedHost(stage, this.url, 'rl-baidu-frame');

        // 🔴 降级提示必须显式写出来：iframe 档下百度更容易要验证码，
        //    用户看到「打不开/要验证」时得知道是宿主禁了 webview，而不是插件坏了。
        if (this.host.kind !== 'webview') {
            stage.createDiv({
                cls: 'rl-baidu-warn',
                text: '当前环境不支持内嵌窗口（webview），已降级为 iframe —— 百度可能要求人机验证，可点右上「在浏览器打开」。',
            });
        }
    }

    onClose(): void {
        // 🔴 先释放内嵌容器再清 DOM（顺序别反：先 empty 会让 webview 的 dispose 摸到已脱离的节点）
        try {
            this.host?.dispose();
        } catch {
            /* 宿主已销毁 */
        }
        this.host = null;
        this.contentEl.empty();
    }
}

/** 供宿主直接调：`new BaiduSearchModal(this.app, opts).open()`（统一出口，免得到处 new） */
export function openBaiduSearchModal(app: App, opts: BaiduSearchOptions): void {
    try {
        new BaiduSearchModal(app, opts).open();
    } catch (e) {
        new Notice(`百度搜索窗口打开失败：${e instanceof Error ? e.message : String(e)}`);
    }
}
