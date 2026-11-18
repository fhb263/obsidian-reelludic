/**
 * H5 / Unity 内嵌页的承载层：**`<webview>` 优先，退化为 `<iframe>`**。
 *
 * 🔴 为什么必须换掉 iframe（2026-11-16 用户报障，真机实证）：
 *    「iframe 内嵌游玩但根本登录不了 4399 账号，一登录就刷新重置」。
 *    实测（CDP，`session.defaultSession.cookies.get`）：
 *      · 第三方 `<iframe>`（带/不带 sandbox 都一样）加载 `https://www.4399.com/` 之后，
 *        `4399.com` / `3304399.net` / `sda.4399.com` 三个域的 cookie **一条都没有**；
 *      · 同一 URL 放进 `<webview>` 或顶层 `BrowserWindow`，立刻写进 5 条
 *        （`home4399` / `UM_distinctid` / `Hm_lvt_*` / `Hm_lpvt_*` / `HMACCOUNT`）。
 *    ⇒ 根因是**第三方存储分区**：Obsidian 的 origin 是 `app://obsidian.md`，iframe 里的 4399
 *      是跨站第三方上下文，Chromium 的 3P cookie 封锁让它**写得进内存也落不了盘**，
 *      于是「登录 → 刷新 → 会话没了 → 又要求登录」。
 *    ⇒ `<webview>` 是独立的顶层 webContents（不是第三方上下文），cookie 正常落 jar。
 *
 * ⚠️ 代价与对策（都实测过，⛔ 别凭直觉删）：
 *    · `<webview>` 里的 `window.open` / `target=_blank` 默认**还是**会开新窗口（Electron 交给
 *      系统浏览器）⇒ 必须用 `setWindowOpenHandler` 接住并**改成就地导航**
 *      （探针实测：`window.open('…')` 与 `<a target=_blank>` 两种形态都会回调，且
 *       `return { action: 'deny' }` 之后 `webview.loadURL(details.url)` 能成功把页面换过来）。
 *    · `setWindowOpenHandler` 只能从主进程侧的 `webContents` 拿到 ⇒ 用 `@electron/remote`
 *      的 `webContents.fromId(wv.getWebContentsId())`。拿不到就退回「只 deny 不开窗」，
 *      ⛔ 绝不放它去系统浏览器。
 *    · `<webview>` 需要宿主 `webPreferences.webviewTag: true`（Obsidian 实测已开）。
 *      创建后 `loadURL` 方法是判别真假的唯一可靠信号（`document.createElement('webview')`
 *      在标签未启用时也能建出元素，但没有 `loadURL`）。
 *
 * ⛔ 不要退回 iframe：那是本文件存在的全部理由。
 */

/** 宿主 `@electron/remote` 的最小面（⛔ 不装 @types，只取用得到的字段） */
interface RemoteWebContents {
    setWindowOpenHandler?: (handler: (details: { url?: string }) => { action: 'deny' | 'allow' }) => void;
    on?: (ev: string, cb: (...a: never[]) => void) => void;
}
interface ElectronRemoteLite {
    webContents?: { fromId?: (id: number) => RemoteWebContents | undefined };
}
/** `<webview>` 元素的最小面（TS 的 DOM lib 里没有这个标签） */
interface WebviewElement extends HTMLElement {
    src?: string;
    loadURL?: (url: string) => Promise<void>;
    getURL?: () => string;
    getWebContentsId?: () => number;
    reload?: () => void;
    executeJavaScript?: (code: string) => Promise<unknown>;
}

/** 取 `window.require`（渲染进程里它是 Electron 注入的 CommonJS 入口） */
function nodeRequire(): ((m: string) => unknown) | undefined {
    try {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        return typeof req === 'function' ? req : undefined;
    } catch {
        return undefined;
    }
}

/** 宿主是否支持真 `<webview>`（不是「能不能建元素」，而是「有没有 loadURL」） */
export function canUseWebview(): boolean {
    try {
        const el = document.createElement('webview') as unknown as WebviewElement;
        return typeof el.loadURL === 'function';
    } catch {
        return false;
    }
}

/**
 * 建一个已就位的内嵌容器。
 *
 * 返回 `kind`：`'webview'`（cookie 能落盘，登录态可保持）/ `'iframe'`（降级，仅播放，登录会丢）。
 * ⚠️ 调用方要在自己的 `onClose` 里调 `dispose()` —— `<webview>` 是独立 webContents，
 *    元素被移除后仍可能持有进程，必须显式 `remove()` 断引用（GC 不保证及时）。
 */
export interface EmbedHost {
    el: HTMLElement;
    kind: 'webview' | 'iframe';
    /** 换地址（重载按钮 / 重进同一个游戏都走它） */
    load(url: string): void;
    dispose(): void;
}

/**
 * 挂载内嵌页。
 *
 * @param parent 舞台容器
 * @param url    要内嵌的地址（4399 详情页 / 游戏本体页）
 * @param cls    元素类名（页面里那套 `.rl-fg-frame` 尺寸规则要命中它）
 */
export function mountEmbedHost(parent: HTMLElement, url: string, cls: string): EmbedHost {
    if (canUseWebview()) {
        const wv = document.createElement('webview') as unknown as WebviewElement;
        wv.className = cls;
        // 🔴 `allowpopups` 是**必需的**：不给它，Electron 直接在渲染层拦掉 window.open，
        //    `setWindowOpenHandler` 根本收不到回调（探针实测：给了才有 calls）。
        //    给它不等于「允许弹窗」—— handler 里我们一律 `deny` 并就地导航。
        wv.setAttribute('allowpopups', '');
        wv.setAttribute('partition', '');
        wv.setAttribute('src', url);
        parent.appendChild(wv);
        const off = attachWindowOpenHandler(wv);
        return {
            el: wv,
            kind: 'webview',
            load(next: string) {
                try {
                    void wv.loadURL?.(next)?.catch?.(() => undefined);
                } catch {
                    /* 元素已销毁 */
                }
            },
            dispose() {
                off();
                try {
                    wv.remove();
                } catch {
                    /* 已移除 */
                }
            },
        };
    }

    // 降级：能播、但登录态存不住（3P 分区）。保留它只为「宿主把 webviewTag 关了」这一档。
    const frame = parent.createEl('iframe', { cls });
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    frame.setAttribute('allowfullscreen', 'true');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
    frame.setAttribute('src', url);
    return {
        el: frame,
        kind: 'iframe',
        load(next: string) {
            frame.setAttribute('src', next);
        },
        dispose() {
            try {
                frame.remove();
            } catch {
                /* 已移除 */
            }
        },
    };
}

/**
 * 把 `<webview>` 内的「新窗口」改成就地导航，返回解绑函数。
 *
 * 🔴 两种形态都要接：`window.open(...)`（4399 的 H5 启动按钮）与 `<a target="_blank">`
 *    （Fl​ash 游戏的「开始游戏」锚点）。探针实测两者都会进同一个 handler。
 * ⚠️ `deny` 是**必须**的：只 `loadURL` 不 deny，Electron 仍会把那次导航交给系统浏览器
 *    （用户报障「开始游戏后就跳转浏览器了」正是它）。
 */
function attachWindowOpenHandler(wv: WebviewElement): () => void {
    const req = nodeRequire();
    if (!req) return () => undefined;
    let remote: ElectronRemoteLite | undefined;
    try {
        remote = req('@electron/remote') as ElectronRemoteLite | undefined;
    } catch {
        return () => undefined;
    }
    const fromId = remote?.webContents?.fromId;
    if (typeof fromId !== 'function') return () => undefined;

    let wc: RemoteWebContents | undefined;
    const hook = (): void => {
        if (wc) return;
        try {
            const id = wv.getWebContentsId?.();
            if (id === undefined) return;
            wc = fromId(id);
            if (!wc || typeof wc.setWindowOpenHandler !== 'function') {
                wc = undefined;
                return;
            }
            wc.setWindowOpenHandler((details) => {
                const next = String(details?.url ?? '').trim();
                if (next) {
                    try {
                        void wv.loadURL?.(next)?.catch?.(() => undefined);
                    } catch {
                        /* 元素已销毁 */
                    }
                }
                // 🔴 一律 deny：不 deny 就会走 Electron 的默认处理 = 系统浏览器
                return { action: 'deny' };
            });
        } catch {
            wc = undefined;
        }
    };

    // `webContentsId` 只有在 webview 挂到 DOM 之后才有 ⇒ `dom-ready` 是最早的可靠时点
    const onReady = (): void => hook();
    try {
        wv.addEventListener('dom-ready', onReady);
    } catch {
        /* 元素不支持 */
    }
    return () => {
        try {
            wv.removeEventListener('dom-ready', onReady);
        } catch {
            /* 已销毁 */
        }
    };
}
