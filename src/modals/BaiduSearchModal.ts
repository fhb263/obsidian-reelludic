// 「百度搜索」弹窗（用户 m17219；m17697 改成**优先独立窗口**）。
//
// 🔴 用户原话：「点击即可内弹窗百度搜索改条目名称」；裁定：「纯内嵌百度网页，不回填」。
//    ⇒ 这里**只承载一个浏览器视图**：把 `https://www.baidu.com/s?wd=<标题 作者>` 灌进容器，
//      用户在页面里自己看、自己点、自己改标题框。⛔ 不要加「点结果回填」这类注入脚本
//      （用户明确否掉了那一档；且跨站注入要 `executeJavaScript`，目标页随时改版就会静默失效）。
//
// 🔴🔴 m17697 的根本性修正（用户：「内嵌弹窗不能拖动啊居中也不行挡住了，为什么不能改成
//    微信读书式浏览器弹窗」）：**首选 `BrowserWindow` 独立窗口**（见文件末尾
//    `openBaiduSearchModal`）。本 Modal 类降级为「非桌面端 / 拿不到 `@electron/remote`」的兜底
//    —— 也就是微信读书那一档在桌面端**根本没有拖动代码**，因为系统标题栏白送；
//    只有在拿不到真窗口时，才需要下面这套自写的拖动/缩放。
//
// ⚠️ Modal 兜底路径仍用 `mountEmbedHost`（`services/gameEmbedHost`，本仓唯一承载层）。
//    它优先 `<webview>`——独立 webContents、浏览器特征完整。真窗口那条路更彻底：整页跑在
//    独立 webContents 里，连内嵌标签都不需要。
//    实测裸 HTTP 请求百度 `/s?wd=…` 会被 302 到验证码页，所以两条路都不能省"真浏览器特征"。
//
// ⚠️ `dispose()` 必须在本弹窗 `onClose` 里调：`<webview>` 是独立 webContents，
//    元素从 DOM 摘掉后进程不一定立刻回收（`services/gameEmbedHost` 头注释记了这条实测）。
import { App, Modal, Notice } from 'obsidian';
import { mountEmbedHost, type EmbedHost } from 'services/gameEmbedHost';
import { hostWindowAvailable, openHostWindow } from 'services/hostWindow';
import { hostWindowTitle } from 'pure/hostWindow';
import { baiduSearchQuery, baiduSearchUrlFor, baiduQueryIsEmpty } from 'pure/baiduSearch';
import {
    clampDragOffset,
    dragIgnored,
    dragOffsetAfter,
    dragOffsetIsZero,
    MODAL_MIN_HEIGHT,
    MODAL_MIN_WIDTH,
    resizeAxisSize,
    resizeMaxSize,
    type DragBox,
    type DragOffset,
    type ResizeEdge,
} from 'pure/modalDrag';

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
    /** 当前拖动位移（相对布局位置的附加位移） */
    private offset: DragOffset = { x: 0, y: 0 };
    /** 拖动中解绑指针监听用（`onClose` 兜底清掉，防拖到一半关窗留下悬挂监听） */
    private detachDrag: (() => void) | null = null;

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

        // 最后装拖动与改尺寸：此时 modalEl 已被 Obsidian 摆到最终位置，量出来的 rect 才可信
        this.attachDrag(head);
        this.attachResize();
    }

    /**
     * 改完尺寸后重新夹一次位移。
     *
     * 🔴 场景（真会踩）：用户把弹窗拖到贴右下角 → 再拉大宽度 → 右边缘立刻超出视口。
     *    拖动那一刻是合法的（当时还小），变大的那一刻才越界。
     *    ⇒ 尺寸一变就得按新盒子重算允许区间，⛔ 别只在 pointerdown 时夹一次。
     */
    private reclampOffset(): void {
        const { modalEl } = this;
        const rect = modalEl.getBoundingClientRect();
        const box: DragBox = {
            left: rect.left - this.offset.x,
            top: rect.top - this.offset.y,
            width: rect.width,
            height: rect.height,
        };
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const clamped = clampDragOffset(this.offset, box, viewport);
        this.offset = clamped;
        if (dragOffsetIsZero(clamped)) {
            modalEl.style.removeProperty('transform');
            return;
        }
        modalEl.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    }

    /**
     * 三条可改尺寸的边（右 / 下 / 右下角）。
     *
     * 🔴 为什么三条都要（用户 m17616 原话「现在是全屏搜索窗口，不能拖动改宽度，
     *    所有只能复制一个退出再搜索了」）：他要的是**和别的窗口并排**。
     *    只给角上一条路的话，往右拉宽必然同时拉高，并排时更挤 ⇒ 右边必须能单独改宽。
     * ⚠️ 抓手是绝对定位在 modalEl 边上的窄条，不占内容布局（不挤压 `.rl-baidu-stage`）。
     */
    private attachResize(): void {
        const { modalEl } = this;
        const add = (edge: ResizeEdge, cls: string, tip: string): void => {
            const grip = modalEl.createDiv({ cls: `rl-baidu-resize ${cls}` });
            grip.setAttribute('aria-hidden', 'true');
            grip.setAttribute('data-tip', tip);
            grip.addEventListener('pointerdown', (ev: PointerEvent) => {
                if (ev.button !== 0) return;
                ev.preventDefault();
                ev.stopPropagation();
                const rect = modalEl.getBoundingClientRect();
                const startW = rect.width;
                const startH = rect.height;
                const startX = ev.clientX;
                const startY = ev.clientY;
                const vp = { width: window.innerWidth, height: window.innerHeight };

                modalEl.addClass('rl-baidu-resizing');
                try {
                    grip.setPointerCapture(ev.pointerId);
                } catch {
                    /* 捕获失败不影响拖动 */
                }

                const onMove = (m: PointerEvent): void => {
                    if (m.pointerId !== ev.pointerId) return;
                    if (edge === 'e' || edge === 'se') {
                        modalEl.style.width = `${resizeAxisSize(
                            startW,
                            m.clientX - startX,
                            MODAL_MIN_WIDTH,
                            resizeMaxSize(vp.width, MODAL_MIN_WIDTH),
                        )}px`;
                    }
                    if (edge === 's' || edge === 'se') {
                        modalEl.style.height = `${resizeAxisSize(
                            startH,
                            m.clientY - startY,
                            MODAL_MIN_HEIGHT,
                            resizeMaxSize(vp.height, MODAL_MIN_HEIGHT),
                        )}px`;
                    }
                };
                const onUp = (): void => {
                    grip.removeEventListener('pointermove', onMove);
                    grip.removeEventListener('pointerup', onUp);
                    grip.removeEventListener('pointercancel', onUp);
                    try {
                        grip.releasePointerCapture(ev.pointerId);
                    } catch {
                        /* 已被系统释放 */
                    }
                    modalEl.removeClass('rl-baidu-resizing');
                    // 🔴 改完尺寸必须重新夹一次位移：窗变高/变宽后，原来的 offset 可能把
                    //    右下角顶出视口（拖的时候没超，拉大之后超了）。
                    this.reclampOffset();
                };
                grip.addEventListener('pointermove', onMove);
                grip.addEventListener('pointerup', onUp);
                grip.addEventListener('pointercancel', onUp);
            });
        };

        add('e', 'is-e', '拖动改宽度（不影响高度）');
        add('s', 'is-s', '拖动改高度（不影响宽度）');
        add('se', 'is-se', '拖动同时改宽高');
    }

    /**
     * 让整个弹窗能被「按住头部拖动」。
     *
     * 🔴 参照物是独立窗口（用户 m17476）：微信读书扫码那一档走 `openWereadWindow()` 的
     *    `new BrowserWindow(...)`，拖动由系统标题栏提供。内嵌 Modal 没有标题栏 ⇒ 用头部当把手。
     * ⚠️ 头部里的按钮由 `dragIgnored` 放行（否则 `preventDefault()` 会把 click 吞掉）。
     * ⚠️ 用 `transform` 而非 `left/top`：`.modal` 是 flex 居中，写死 left/top 会与居中规则打架。
     */
    private attachDrag(handle: HTMLElement): void {
        const { modalEl } = this;
        handle.addClass('rl-baidu-drag');
        handle.setAttribute('data-tip', '按住这一行可以拖动整个窗口');

        handle.addEventListener('pointerdown', (ev: PointerEvent) => {
            // 左键 / 单指才拖；中键、右键放行给宿主
            if (ev.button !== 0) return;
            if (dragIgnored(ev.target as Element | null)) return;

            ev.preventDefault();
            const start = { ...this.offset };
            const startX = ev.clientX;
            const startY = ev.clientY;
            // 🔴 每次拖动现量一次：窗口尺寸可能在两次拖动之间变了（用户拉过 Obsidian 窗口）
            const rect = modalEl.getBoundingClientRect();
            // ⚠️ 必须是「未位移」的盒子：rect 已含上次 transform，直接拿来算会越拖越偏
            const box: DragBox = {
                left: rect.left - start.x,
                top: rect.top - start.y,
                width: rect.width,
                height: rect.height,
            };
            const viewport = { width: window.innerWidth, height: window.innerHeight };

            modalEl.addClass('rl-baidu-dragging');
            try {
                handle.setPointerCapture(ev.pointerId);
            } catch {
                /* 捕获失败不影响拖动（move 仍会在元素上触发） */
            }

            const apply = (next: DragOffset): void => {
                const clamped = clampDragOffset(next, box, viewport);
                this.offset = clamped;
                if (dragOffsetIsZero(clamped)) {
                    modalEl.style.removeProperty('transform');
                    return;
                }
                modalEl.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
            };

            const onMove = (m: PointerEvent): void => {
                if (m.pointerId !== ev.pointerId) return;
                apply(dragOffsetAfter(start, m.clientX - startX, m.clientY - startY));
            };
            const onUp = (): void => {
                detach();
                modalEl.removeClass('rl-baidu-dragging');
            };
            const detach = (): void => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', onUp);
                handle.removeEventListener('pointercancel', onUp);
                try {
                    handle.releasePointerCapture(ev.pointerId);
                } catch {
                    /* 已被系统释放 */
                }
                this.detachDrag = null;
            };
            this.detachDrag = detach;
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp);
            handle.addEventListener('pointercancel', onUp);
        });
    }

    onClose(): void {
        // 拖到一半关窗（Esc / 点遮罩）必须解绑，否则监听留在已销毁的头部节点上
        try {
            this.detachDrag?.();
        } catch {
            /* 已解绑 */
        }
        this.detachDrag = null;
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

/**
 * 供宿主直接调的统一出口。
 *
 * 🔴 **首选独立窗口**（用户 m17697 原话：「内嵌弹窗不能拖动啊居中也不行挡住了，
 *    为什么不能改成微信读书式浏览器弹窗」）：
 *    微信读书那一档走 `services/qrLogin.openWereadWindow()` 的 `new BrowserWindow(...)` ——
 *    独立 OS 窗口，标题栏拖动 / 边缘缩放 / 最大化全是操作系统给的，插件一行拖拽代码都没有。
 *    我先前把这条需求做成「Modal + 自写拖动缩放」，等于拿自制装置模仿系统窗口；
 *    用户反馈「不能拖动、挡住了」正是那个选择的必然结果。
 *    ⇒ 现在反过来：**能开真窗口就开真窗口**，`BaiduSearchModal` 只作为
 *      「非桌面端 / 拿不到 `@electron/remote`」时的兜底（那时才需要自写拖动）。
 *
 * ⚠️ 兜底不是摆设：`hostWindowAvailable()` 在移动端、以及某些被裁掉 remote 的发行版里为 false，
 *    那时静默什么都不做会让「点了没反应」变成猜谜 ⇒ 必须降级到 Modal 并照常工作。
 */
export function openBaiduSearchModal(app: App, opts: BaiduSearchOptions): void {
    const query = baiduSearchQuery(opts.title ?? '', opts.author ?? '');
    const url = baiduSearchUrlFor(opts.title ?? '', opts.author ?? '');

    if (hostWindowAvailable()) {
        const opened = openHostWindow({
            url,
            title: hostWindowTitle(query),
            // 复用同站窗口：每点一次搜索开一个新窗，比「挡住半屏」更难受
            reuse: true,
        });
        if (opened) {
            // ⚠️ 页面里 `target=_blank` 由 `openHostWindow` 就地导航，这里不用再管
            return;
        }
    }

    try {
        new BaiduSearchModal(app, opts).open();
    } catch (e) {
        new Notice(`百度搜索窗口打开失败：${e instanceof Error ? e.message : String(e)}`);
    }
}
