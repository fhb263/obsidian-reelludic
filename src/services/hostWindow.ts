// 用 `@electron/remote` 开**真正的独立窗口**（用户 m17697：「为什么不能改成微信读书式浏览器弹窗」）。
//
// 🔴 参照物：`services/qrLogin.openWereadWindow()` 的 `new BrowserWindow(...)`。
//    独立 OS 窗口自带标题栏 ⇒ 拖动 / 缩放 / 最大化 / 最小化全是操作系统的活，
//    插件这层**一行拖拽代码都不该有**。
//
// 🔴 为什么不能只写 `new BW({ width, height })`：实测构造参数被忽略
//    （传 900×700 实际拿 800×600），必须补一刀 `setBounds()`。取证记录见 `pure/hostWindow` 头注释。
//
// ⚠️ `require` 必须走 `window.require`（Obsidian 渲染进程里模块级 `require` 被 CSP 挡着）
//    —— 与 `services/qrLogin`、`services/embedCookie` 同一条口径。
import { Platform } from 'obsidian';
import {
    hostWindowBounds,
    hostWindowReusable,
    HOST_WINDOW_DEFAULT_HEIGHT,
    HOST_WINDOW_DEFAULT_WIDTH,
    type HostWorkArea,
    type HostWindowBounds,
} from 'pure/hostWindow';

/** `@electron/remote` 的最小面（⛔ 不装 @types，只取用得上的字段）。 */
interface RemoteWindow {
    loadURL?: (url: string) => Promise<void>;
    show?: () => void;
    focus?: () => void;
    restore?: () => void;
    close?: () => void;
    destroy?: () => void;
    isDestroyed?: () => boolean;
    isMinimized?: () => boolean;
    getBounds?: () => HostWindowBounds;
    setBounds?: (b: HostWindowBounds) => void;
    setTitle?: (t: string) => void;
    on?: (ev: string, cb: () => void) => void;
    webContents?: {
        getURL?: () => string;
        setWindowOpenHandler?: (h: (details: { url: string }) => { action: string }) => void;
    };
}

interface RemoteBrowserWindowCtor {
    new (opts: Record<string, unknown>): RemoteWindow;
    getAllWindows?: () => RemoteWindow[];
}

interface RemoteScreen {
    getPrimaryDisplay?: () => { workArea?: HostWorkArea };
    getDisplayNearestPoint?: (p: { x: number; y: number }) => { workArea?: HostWorkArea };
}

interface ElectronRemoteShape {
    BrowserWindow?: RemoteBrowserWindowCtor;
    screen?: RemoteScreen;
}

/** 一个已开着的宿主窗口（插件侧只关心这几件事）。 */
export interface HostBrowserWindow {
    window: RemoteWindow;
    /** 换地址（复用同一个窗口时用） */
    load(url: string): void;
    /** 设置标题 */
    setTitle(title: string): void;
    /** 该窗口还在吗 */
    alive(): boolean;
    /** 抬到前面（最小化时先 restore，⛔ 别让「点了没反应」） */
    bringToFront(): void;
    /** 关掉 */
    close(): void;
}

/**
 * 拿 `@electron/remote`。
 * ⚠️ 与 `services/qrLogin.electronRemote()` 是同一件事，但**不复用**那个私有函数：
 *    它是 `qrLogin` 的内部实现（导出的只有 `electronRemoteAvailable()`），
 *    把它提出来会让二维码登录那条链路凭空多一个公共出口。
 */
function electronRemote(): ElectronRemoteShape | null {
    try {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        if (typeof req !== 'function') return null;
        return (req('@electron/remote') as ElectronRemoteShape | undefined) ?? null;
    } catch {
        return null;
    }
}

/** 当前环境能不能开独立窗口。 */
export function hostWindowAvailable(): boolean {
    if (!Platform.isDesktopApp) return false;
    return !!electronRemote()?.BrowserWindow;
}

/** 主显示器工作区（已扣任务栏）；拿不到返回 `null`，由 `hostWindowBounds` 兜底。 */
function primaryWorkArea(screen: RemoteScreen | undefined): HostWorkArea | null {
    try {
        const area = screen?.getPrimaryDisplay?.()?.workArea;
        return area && Number.isFinite(area.width) && area.width > 0 ? area : null;
    } catch {
        return null;
    }
}

/** 已开着的、URL 以某前缀开头的窗口（复用判据的唯一真源）。 */
function findWindowByUrlPrefix(prefix: string): RemoteWindow | null {
    const BW = electronRemote()?.BrowserWindow;
    const all = BW?.getAllWindows?.() ?? [];
    for (const w of all) {
        try {
            if (w.isDestroyed?.()) continue;
            const url = w.webContents?.getURL?.() ?? '';
            if (url.startsWith(prefix)) return w;
        } catch {
            /* 单个窗口查询失败不影响其它候选 */
        }
    }
    return null;
}

/**
 * 打开（或复用）一个独立窗口装网页。
 *
 * @param opts.url    要加载的地址
 * @param opts.title  窗口标题
 * @param opts.reuse  为 true 时，若已有同前缀窗口则复用（默认 true —— 见 `hostWindowReusable`）
 * @returns 句柄；环境不支持返回 `null`（调用方必须**明说**，⛔ 别静默什么都不做）
 */
export function openHostWindow(opts: {
    url: string;
    title?: string;
    reuse?: boolean;
    width?: number;
    height?: number;
}): HostBrowserWindow | null {
    const remote = electronRemote();
    const BW = remote?.BrowserWindow;
    if (!BW) return null;

    const wantReuse = opts.reuse !== false;
    // 🔴 URL 前缀只取到 host（`https://www.baidu.com`）：
    //    每次搜索的 `?wd=` 都不同，按整条 URL 匹配等于永远不复用。
    let prefix = opts.url;
    try {
        const u = new URL(opts.url);
        prefix = `${u.protocol}//${u.host}`;
    } catch {
        /* 非法 URL 就按原串匹配 */
    }
    const existing = wantReuse ? findWindowByUrlPrefix(prefix) : null;
    if (existing && hostWindowReusable(existing.isDestroyed?.())) {
        const handle = asHostWindow(existing);
        handle.setTitle(opts.title ?? '');
        handle.load(opts.url);
        handle.bringToFront();
        return handle;
    }

    let win: RemoteWindow;
    try {
        win = new BW({
            // ⚠️ 这两个值只是初始意图；实测可能被忽略，下面 `setBounds` 才是准的
            width: opts.width ?? HOST_WINDOW_DEFAULT_WIDTH,
            height: opts.height ?? HOST_WINDOW_DEFAULT_HEIGHT,
            title: opts.title || '百度搜索',
            autoHideMenuBar: true,
            resizable: true,
            minimizable: true,
            maximizable: true,
            // 网页窗口不需要 node 能力（与微信读书那一档同口径）
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webviewTag: false,
            },
        });
    } catch {
        return null;
    }

    // 🔴 构造参数被忽略 ⇒ 必须补这一刀（实测：不补就是 800×600 落在屏幕左上角）
    const bounds = hostWindowBounds(
        { width: opts.width, height: opts.height },
        primaryWorkArea(remote?.screen),
    );
    try {
        win.setBounds?.(bounds);
    } catch {
        /* 个别平台不允许 immediate setBounds，退回构造尺寸 */
    }

    const handle = asHostWindow(win);
    handle.setTitle(opts.title ?? '');
    handle.load(opts.url);
    // 目标页里 `target=_blank` / `window.open` 一律就地导航，⛔ 别弹出无外壳的原生窗口
    try {
        win.webContents?.setWindowOpenHandler?.((details) => {
            return { action: 'deny' };
        });
    } catch {
        /* 老版本没有这个 API */
    }
    handle.bringToFront();
    return handle;
}

/**
 * 把裸 Electron 窗口包成插件侧句柄。
 *
 * 🔴 名字**不能**叫 `wrap`：本仓 `src/modals/ReaderPanelBase.ts` 与 `PdfReaderModal.ts`
 *    里各有一个同名局部变量（`const wrap = …` 弹层容器）。esbuild 为消歧会把它们的
 *    `wrap` 改名成 `wrap2` ⇒ 产物里 `wrap.addClass("rl-reader-pop-up")` 变成
 *    `wrap2.addClass(...)` ⇒ 撞红三条「底栏浮层向上开」的产物断言（实测踩过，失败数 222→223）。
 *    同族的坑：`BING_CJK_RE`（撞 `readingUnits.CJK_RE`）、`rssTag` 的 `tag`、#491 的 `section`。
 *    ⛔ 新增顶层标识符别用通用短名。
 */
function asHostWindow(win: RemoteWindow): HostBrowserWindow {
    return {
        window: win,
        load(url: string) {
            // ⚠️ 首次 `loadURL` 常以 `ERR_ABORTED (-3)` reject（被后续导航取代），**不是失败**
            //    ⇒ 必须吞掉，且 ⛔ 不要 await（await 会把正常导航当异常抛出来）
            void win
                .loadURL?.(url)
                ?.catch?.(() => undefined);
        },
        setTitle(title: string) {
            if (!title) return;
            try {
                win.setTitle?.(title);
            } catch {
                /* 窗口可能已销毁 */
            }
        },
        alive() {
            try {
                return win.isDestroyed?.() !== true;
            } catch {
                return false;
            }
        },
        bringToFront() {
            try {
                if (win.isMinimized?.()) win.restore?.();
                win.show?.();
                win.focus?.();
            } catch {
                /* 窗口可能已销毁 */
            }
        },
        close() {
            try {
                if (!win.isDestroyed?.()) win.close?.();
            } catch {
                /* 已销毁 */
            }
        },
    };
}
