/**
 * 官方内嵌播放器（跨域 iframe）的**时间轴桥**。
 *
 * 🔴 为什么要这个：网络集现在**固定**走 B 站 / YouTube 的官方内嵌 iframe
 *    （2026-11-24 用户裁定删掉内置播放器，`netInlinePlayer` 设置项已随之下线）。
 *    过去 `EpisodePageView` 里写着
 *    「跨域 iframe 读不到 `currentTime`，跟随/跳转在技术上做不到」—— 那是**猜的**，
 *    2026-11-10 真机实测已推翻：
 *      `require('@electron/remote').getCurrentWebContents().mainFrame.framesInSubtree`
 *      能列出跨域子帧（实测 4 个 `https://player.bilibili.com/player.html?...`），
 *      对命中帧 `frame.executeJavaScript(code, true)` **成功** —— 读回
 *      `{ dur: 212.261, t: 12, paused: true, rs: 4, vcount: 1 }`（dur 就是那支片子的
 *      真实时长 3:32），写 `v.currentTime = 12` 也生效。
 *    ⚠️ `getAllWebContents()` 只报 2 个 webContents（`about:blank` + `app://obsidian.md`），
 *       **不含** OOPIF 的 webContents —— ⛔ 别再从那儿找，找不到不代表进不去。
 *
 * ⛔ 别改成「重载 iframe 带 `t=` 参数」来跳转：那要重新缓冲、黑屏一下，体验差一档。
 * ⛔ 这是**尽力而为**的桥：拿不到就返回 `null` / `false`，调用方必须退回静态字幕列表，
 *    不许假装在跟随（宁可如实说「用不了」）。
 * ⛔ 别把 `executeJavaScript` 的返回值按 `{result:{value}}` 包装去解 —— 这里拿到的就是值。
 */

/** 一次读回来的播放头状态。`duration` 取不到（元数据没到）时为 0。 */
export interface EmbedVideoState {
    time: number;
    duration: number;
    paused: boolean;
}

/** `WebFrameMain` 在 remote 代理下长这样；只用到 `url` 和 `executeJavaScript`。 */
interface FrameLike {
    url?: unknown;
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
}

/**
 * 这台宿主能不能进跨域 iframe（桌面端 + `@electron/remote` + `framesInSubtree`）。
 * 同步、不发 IPC 到子帧 —— 只用来决定渲染侧画「可跟随」还是「静态」。
 */
export function embedVideoAvailable(): boolean {
    try {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        if (typeof req !== 'function') return false;
        const remote = req('@electron/remote') as {
            getCurrentWebContents?: () => { mainFrame?: { framesInSubtree?: unknown } };
        } | null;
        return !!remote?.getCurrentWebContents?.()?.mainFrame?.framesInSubtree;
    } catch {
        return false;
    }
}

function allFrames(): FrameLike[] {
    try {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        if (typeof req !== 'function') return [];
        const remote = req('@electron/remote') as {
            getCurrentWebContents?: () => { mainFrame?: { framesInSubtree?: unknown } };
        } | null;
        const list = remote?.getCurrentWebContents?.()?.mainFrame?.framesInSubtree;
        return Array.isArray(list) ? (list as FrameLike[]) : [];
    } catch {
        return [];
    }
}

/**
 * 找到「我们自己挂的那颗 iframe」对应的子帧。
 *
 * ⚠️ 同一支片子可能残留多个同 URL 的旧帧（换集/重挂的余烬），取**最后一个**（最新的那个）。
 * ⚠️ 精确匹配失败时退回「路径相同 + 查询串以同一段开头」，因为浏览器可能把 `src` 规范化。
 */
function pickFrame(src: string): FrameLike | null {
    const want = String(src ?? '').trim();
    if (!want) return null;
    const list = allFrames();
    const isMatch = (f: FrameLike): boolean => {
        try {
            const u = String(f?.url ?? '');
            return u === want || (u.length > 0 && want.startsWith(u)) || (u.startsWith(want) && u.length >= want.length);
        } catch {
            return false;
        }
    };
    const hits = list.filter(isMatch);
    return hits.length ? hits[hits.length - 1] : null;
}

const READ_JS =
    '(() => { var v = document.getElementsByTagName("video")[0]; if (!v) return null;' +
    ' var d = v.duration;' +
    ' return { time: v.currentTime || 0, duration: (typeof d === "number" && d === d && d > 0) ? d : 0, paused: !!v.paused }; })()';

function seekJs(seconds: number): string {
    const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    return '(() => { var v = document.getElementsByTagName("video")[0]; if (!v) return false;' +
        ' try { v.currentTime = ' + t + '; return true; } catch (e) { return false; } })()';
}

function asState(raw: unknown): EmbedVideoState | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as { time?: unknown; duration?: unknown; paused?: unknown };
    const time = Number(o.time);
    if (!Number.isFinite(time)) return null;
    return {
        time,
        duration: Number.isFinite(Number(o.duration)) ? Number(o.duration) : 0,
        paused: o.paused === true,
    };
}

/** 读官方内嵌播放器里的播放头。拿不到就 `null`（调用方退回静态字幕）。 */
export async function readEmbedVideo(src: string): Promise<EmbedVideoState | null> {
    const frame = pickFrame(src);
    if (!frame?.executeJavaScript) return null;
    try {
        return asState(await frame.executeJavaScript(READ_JS, true));
    } catch {
        return null;
    }
}

/** 往官方内嵌播放器里写播放头（字幕行点击跳转）。做不到就 `false`。 */
export async function seekEmbedVideo(src: string, seconds: number): Promise<boolean> {
    const frame = pickFrame(src);
    if (!frame?.executeJavaScript) return false;
    try {
        return (await frame.executeJavaScript(seekJs(seconds), true)) === true;
    } catch {
        return false;
    }
}
