/**
 * 扫码登录的**服务层**（③-3 B 站 / ③-4 微信读书，2026-11-12 用户 m00353 / m05505）。
 *
 * 🔴 方案变更（m05505 推翻 m05063 的「弹出对应网页扫码」）：B 站不再开子窗口。
 *    用户实测原话：「这个 b 站扫码登录怎么是跳转到浏览器登录还会触发下载 iBiliPlayer 的行为
 *    什么鬼（但我浏览器有账号登录了就一直登录不了 cookie 也不能获取回填）」
 *    ⇒ ⑴ 子窗口为保住 `qrcode_key` 必须设移动端 UA，B 站 H5 页认出就弹「下载 App」
 *         （`iBiliPlayer` = 它安卓包名）；
 *       ⑵ 子窗口是**独立 session**，与用户系统浏览器登录态完全隔离，他浏览器已登录也没用。
 *    ⇒ B 站改为**插件内自绘二维码**（`pure/qrcode`），本模块只负责「要 key + 按 key 轮询」。
 *
 * 两条通道分工（**别混用**，混了就出「扫了没反应」）：
 *    · **B 站状态** —— Node 侧按**我们自己生成的 `qrcode_key`** 轮询（`nodeHttpGet`）。
 *    · **B 站凭据** —— 成功那轮响应体里同时给 `data.url`（含 Cookie）与 `refresh_token`；
 *      ⚠️ `refresh_token` **只在响应 JSON 里**，Cookie 罐里没有。
 *    · **微信读书** —— 没有 HTTP 扫码通道（实测 8 个候选端点全 404，`/web/login/session/init`
 *      只回 `{"success":1}` 不带凭据）⇒ 只能开它的首页让用户点「登录」用微信扫，
 *      我们盯 cookie jar 里 `wr_name` 是否被填上。
 *
 * ⚠️ 本模块**只管「把凭据拿到手」**，⛔ 不写 settings、不刷 UI、不测连接 ——
 *    那些是 `Settings.ts` 与 `pure/credentialCheck` 的事。
 */
import { Platform } from 'obsidian';
import { nodeHttpGet } from './nodeHttp';
import { buildWereadShelfUrl, parseWereadShelfAuth, WEREAD_ACCEPT, WEREAD_REFERER, WEREAD_UA } from 'pure/weread';
import {
    biliCredentialCookieOf,
    cookieFromBiliCallbackUrl,
    cookieHeaderFromPairs,
    isSessionExpired,
    isWereadLoggedIn,
    parseBiliPoll,
    sessionTtlOf,
    type QrPlatform,
    type QrPollResult,
    type QrStartInfo,
} from 'pure/qrLogin';

/** 接口地址与 cookie 归属（集中一处，⛔ 别散在函数里）。 */
const ENDPOINTS = {
    biliGenerate: 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
    biliPoll: 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll',
    biliRefresh: 'https://passport.bilibili.com/x/passport-login/web/cookie/refresh',
    wereadHome: 'https://weread.qq.com/',
} as const;

/**
 * 读 cookie jar 用的探测 URL。
 *
 * ⚠️ 用 `url` 过滤而不是 `domain`：Electron 的 `get({ url })` 返回**该 URL 真正会带上的**全部 cookie
 *   （含 HttpOnly 的 `SESSDATA`），这正是我们想存进设置的那一份；按 `domain` 过滤会漏掉
 *   父域下发的条目（`.bilibili.com` vs `passport.bilibili.com` 的差异实测踩过）。
 */
const JAR_URL: Record<QrPlatform, string> = {
    bilibili: 'https://www.bilibili.com/',
    weread: 'https://weread.qq.com/',
};

/** 浏览器形态 UA（B 站接口按浏览器 UA 才给正常 JSON）。 */
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 当前环境能不能用 `@electron/remote`（微信读书开窗口需要它）。 */
export function electronRemoteAvailable(): boolean {
    if (!Platform.isDesktopApp) return false;
    return electronRemote() !== null;
}

/** `@electron/remote` 的最小面（⛔ 不装 @types，只取用得上的字段）。 */
interface RemoteBrowserWindow {
    new (opts: Record<string, unknown>): RemoteWindow;
    getAllWindows?: () => RemoteWindow[];
}
interface RemoteWindow {
    webContents: {
        setUserAgent?: (ua: string) => void;
        getURL?: () => string;
        session?: RemoteSession;
        on?: (ev: string, cb: (...a: never[]) => void) => void;
        executeJavaScript?: (code: string) => Promise<unknown>;
    };
    loadURL?: (url: string) => Promise<void>;
    getTitle?: () => string;
    isDestroyed?: () => boolean;
    close?: () => void;
    on?: (ev: string, cb: (...a: never[]) => void) => void;
    show?: () => void;
    focus?: () => void;
}
interface RemoteCookie {
    name: string;
    value: string;
}
interface RemoteSession {
    cookies?: {
        get(filter: Record<string, unknown>): Promise<RemoteCookie[]>;
    };
}
interface ElectronRemoteShape {
    BrowserWindow?: RemoteBrowserWindow;
    session?: { defaultSession?: RemoteSession };
}

/**
 * 拿 `@electron/remote`。
 *
 * 🔴 必须用 `window.require`（Obsidian 渲染进程里 `require` 被 CSP 挡着，`window.require` 才是通的）
 *    —— 与 `services/embedCookie.ts:97` 同一条口径，⛔ 别改成模块级 `require`。
 */
function electronRemote(): ElectronRemoteShape | null {
    try {
        const req = (window as unknown as { require?: (m: string) => unknown }).require;
        if (typeof req !== 'function') return null;
        const remote = req('@electron/remote') as ElectronRemoteShape | undefined;
        return remote ?? null;
    } catch {
        return null;
    }
}

/**
 * 读 cookie jar 的**键值对**形态（微信读书要按名字判登录）。
 *
 * 🔴 #756（用户 m06077「微信读书扫码后不自动获取 cookie」）：
 *    原先只发一次 `get({ url: JAR_URL[platform] })`。Electron 的 `get({url})` 只回
 *    **该 URL 路径下会带上的** cookie —— 微信读书把登录态里相当一部分挂在 `path=/web`
 *    上，用根路径 `/` 去问就读不到，症状正是「人已经登录了、我们这边还是空」。
 * ⇒ 改成**按 domain 取全量**（`get({ domain })` 不按 path 过滤），再按 path 深浅排序去重。
 *    domain 取 `weread.qq.com`；拿不到时退回老的 `url` 取法，⛔ 别把兜底删了（旧 Electron 行为差异）。
 */
async function readJarPairs(platform: QrPlatform): Promise<RemoteCookie[]> {
    const remote = electronRemote();
    const sess = remote?.session?.defaultSession;
    if (!sess?.cookies) return [];
    const host = new URL(JAR_URL[platform]).hostname;
    const tryGet = async (filter: Record<string, unknown>): Promise<RemoteCookie[]> => {
        try {
            const list = await sess.cookies!.get(filter);
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    };
    // 🔴 #757（用户 m07156「子窗口登录了，但设置页啥也没反应」）真根因之一：
    //    Electron 的 `get({ domain })` 是**按 domain 字段精确匹配**，不会自动把
    //    `weread.qq.com` 与 `.weread.qq.com` 当成一家。实测（CDP `Network.getAllCookies`）：
    //      `wr_gid` 挂在 `weread.qq.com`，而 `wr_fp` 挂在 **`.weread.qq.com`** —— 一半在带点的父域下。
    //    ⇒ 必须**两个域都问**，否则永远只能拿到半份 Cookie，判登录自然永远失败。
    const byDomain = [...(await tryGet({ domain: host })), ...(await tryGet({ domain: `.${host}` }))];
    const picked = byDomain.length ? byDomain : await tryGet({ url: JAR_URL[platform] });
    if (!picked.length) return [];
    // 同名 cookie 在多个 path/domain 下并存时，**深 path 优先**（站点就是这么覆盖的）
    const best = new Map<string, { pair: RemoteCookie; depth: number }>();
    for (const c of picked) {
        if (!c || !c.name) continue;
        const depth = String((c as { path?: string }).path || '/').length;
        const prev = best.get(c.name);
        if (!prev || depth > prev.depth) best.set(c.name, { pair: c, depth });
    }
    return Array.from(best.values()).map((v) => v.pair);
}

/**
 * 第一步（仅 B 站）：向平台要一个扫码会话。
 *
 * 🔴 只调接口、**不开窗口**。返回的 `url` 要由 UI 编码成二维码**画在插件里** ——
 *    这正是 m05505 要求的改法（用户实测开子窗口会跳浏览器 + 触发下载 App 引导）。
 * ⚠️ `url` 里带着**我们自己生成的 `qrcode_key`**，必须原样编码进二维码；
 *    任何跳转/替换都会让 key 作废 ⇒ poll 永远「未扫码」、`refresh_token` 永远拿不到。
 */
export async function startBiliQrLogin(): Promise<QrStartInfo> {
    const res = await nodeHttpGet(ENDPOINTS.biliGenerate, {
        'User-Agent': DESKTOP_UA,
        Referer: 'https://www.bilibili.com/',
    });
    let root: unknown;
    try {
        root = JSON.parse(res.text);
    } catch {
        throw new Error('B 站二维码接口返回的不是 JSON（可能被风控拦截）');
    }
    const data = (root as { data?: Record<string, unknown> }).data;
    const url = typeof data?.url === 'string' ? data.url : '';
    const key = typeof data?.qrcode_key === 'string' ? data.qrcode_key : '';
    if (!url || !key) throw new Error('B 站没有返回二维码地址（接口可能改版）');
    return { platform: 'bilibili', url, qrcodeKey: key };
}

/**
 * 第一步（仅微信读书）：它的「扫码会话」就是开一个首页窗口。
 *
 * ⚠️ 返回 `null` = 环境不支持（非桌面端 / `@electron/remote` 不可用）⇒ 调用方应明确告知，
 *    ⛔ 别静默什么都不做（那会让「点了扫码没反应」变成猜谜）。
 */
export function openWereadWindow(): { close: () => void; isClosed: () => boolean } | null {
    const remote = electronRemote();
    const BW = remote?.BrowserWindow;
    if (!BW) return null;
    const win = new BW({
        width: 460,
        height: 640,
        title: '登录微信读书',
        autoHideMenuBar: true,
        resizable: true,
        minimizable: true,
        // 子窗口不需要 node 能力：它就是一块普通网页
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    // ⚠️ 首次 `loadURL` 常以 `ERR_ABORTED (-3)` reject（被后续导航取代），**不是失败**
    //    ⇒ 必须吞掉，⛔ 不要 await 它（await 会把正常导航当异常抛给调用方）
    void win.loadURL?.(ENDPOINTS.wereadHome)?.catch?.(() => undefined);
    win.show?.();
    win.focus?.();
    let closed = false;
    win.on?.('closed', () => {
        closed = true;
    });
    return {
        close: () => {
            closed = true;
            if (!win.isDestroyed?.()) win.close?.();
        },
        isClosed: () => closed || win.isDestroyed?.() === true,
    };
}

/**
 * 🔴 #756 新增：**拿票据换真凭据**（用户 m06077「B 站扫码能获取但测试连接失败」的真根因）。
 *
 * 背景（真机实测，不是猜）：
 *   · 扫码成功后 `data.url` 已是票据地址
 *     `https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=<32位>&gourl=…&first_domain=.bilibili.com`；
 *   · 该地址 **302** 到 `https://www.bilibili.com`，`Set-Cookie` 在**这一跳**下发
 *     （`SESSDATA` / `bili_jct` / `DedeUserID`）；
 *   · 原先我们把它的 query 全当 Cookie 存 ⇒ `data.json` 里出现
 *     `biliCookie: "ticket=…; gourl=…; first_domain=…"`，没有一条是真凭据。
 *
 * ⇒ 做法：GET 这个票据地址（`nodeHttpGet` 会自动跟 302，并把**整条链累积的 Cookie**
 *   通过 `res.cookies` 回传），再从累积结果里只挑 `SESSDATA`/`bili_jct`/`DedeUserID`。
 * ⚠️ 票据**一次性**：同一张再次兑换会被判失效，所以只在 `stage === 'done'` 那轮调一次。
 * @returns 真凭据 Cookie；换不到返回 `null`（调用方应报错，⛔ 别把票据当凭据存下去）
 */
export async function exchangeBiliTicket(ticketUrl: string, seedCookies = ''): Promise<string | null> {
    const url = String(ticketUrl || '').trim();
    if (!url) return null;
    try {
        // ⑴ 🔴 最高优先：**poll 那一轮自己的响应**。扫码成功轮在同一个会话里往往已经下发凭据，
        //    那是离真相最近的一份，比再跳一趟便宜也可靠。
        const fromSeed = biliCredentialCookieOf(seedCookies);
        if (fromSeed) return fromSeed;
        const res = await nodeHttpGet(url, {
            'User-Agent': DESKTOP_UA,
            Referer: 'https://www.bilibili.com/',
            // 带上 poll 轮拿到的匿名 Cookie（`buvid*` 等），否则部分风控会直接回游客页
            ...(seedCookies ? { Cookie: seedCookies } : {}),
        });
        // ⑵ 整条重定向链累积的 Cookie（302 的 Set-Cookie 都在这里）
        const fromChain = biliCredentialCookieOf(res.cookies || '');
        if (fromChain) return fromChain;
        // ⑶ 🔴 关键兜底：crossDomain 这类接口的经典做法是把凭据**拼进 302 的 Location query**，
        //    再由落地页前端自己写 `document.cookie` —— 而 Node HTTP **不执行 JS**，
        //    那一步永远不会发生。⇒ 必须主动看一眼最终地址里有没有凭据参数。
        //    （`cookieFromBiliCallbackUrl` 带白名单，只会挑 SESSDATA/bili_jct/DedeUserID）
        const fromFinal = cookieFromBiliCallbackUrl(res.finalUrl || '');
        if (fromFinal) return fromFinal;
        // ⑷ 最后一跳的响应头（个别 Node/Electron 版本会把 Set-Cookie 只留在末跳）
        const raw = res.headers?.['set-cookie'];
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (list.length) {
            const jar = list.map((s) => String(s).split(';', 1)[0]).join('; ');
            const fromHeader = biliCredentialCookieOf(jar);
            if (fromHeader) return fromHeader;
        }
        // ⑸ 最后兜底：jar（罕见，但兑换成功后凭据确实会进 jar）
        const jarPairs = await readJarPairs('bilibili');
        return biliCredentialCookieOf(cookieHeaderFromPairs(jarPairs)) ?? null;
    } catch {
        return null;
    }
}

/**
 * 第二步：轮询一次。
 *
 * @param info `startBiliQrLogin` 的产物
 * @param startedAt 会话开始时间（`Date.now()`），用来判过期
 * @param now 当前时间（可注入，便于单测；默认 `Date.now()`）
 */
export async function pollQrLogin(
    info: QrStartInfo,
    startedAt: number,
    now: number = Date.now(),
): Promise<QrPollResult> {
    // 先判本地 TTL：接口那边可能要等很久才回「已过期」，本地先兜住
    // 🔴 #756：TTL 按平台分（微信读书给 10 分钟，见 `sessionTtlOf` 的注释）
    if (isSessionExpired(startedAt, now, sessionTtlOf(info.platform))) {
        return {
            stage: 'expired',
            message: info.platform === 'weread' ? '登录窗口开太久了，请重新扫码' : '二维码已过期，请重新生成',
        };
    }

    if (info.platform === 'bilibili') {
        if (!info.qrcodeKey) return { stage: 'error', message: '缺少 qrcode_key，请重新生成二维码' };
        const res = await nodeHttpGet(
            `${ENDPOINTS.biliPoll}?qrcode_key=${encodeURIComponent(info.qrcodeKey)}`,
            { 'User-Agent': DESKTOP_UA, Referer: 'https://www.bilibili.com/' },
        );
        const parsed = parseBiliPoll(res.text);
        if (parsed.stage !== 'done') return parsed;

        // 🔴 #756：成功轮优先用「URL 里直接带的凭据」（老形态）；
        //    拿到的是票据地址时必须**兑换**，⛔ 不能把票据当 Cookie 存。
        if (!parsed.cookie && parsed.ticketUrl) {
            // ⚠️ 把 poll 这一轮自己拿到的 Cookie 一起传进去：兑换请求带上匿名 Cookie 才不像爬虫，
            //    而且凭据有可能就在这一轮的响应头里（`fromSeed` 那条最高优先分支）。
            const exchanged = await exchangeBiliTicket(parsed.ticketUrl, res.cookies || '');
            if (!exchanged) {
                return {
                    stage: 'error',
                    message: '扫码成功，但没能换到登录凭据（票据已失效或接口改版），请重新生成二维码',
                };
            }
            return { ...parsed, cookie: exchanged };
        }
        if (!parsed.cookie) {
            // jar 兜底：扫码页若在同一个 session 里跑过，凭据可能已经落进 jar
            const jarPairs = await readJarPairs('bilibili');
            const fromJar = biliCredentialCookieOf(cookieHeaderFromPairs(jarPairs));
            if (fromJar) return { ...parsed, cookie: fromJar };
            return { stage: 'error', message: '扫码成功，但没拿到登录凭据，请重试' };
        }
        return parsed;
    }

    // 微信读书：没有 HTTP 状态接口 ⇒ 只能看 jar 里有没有登录态 Cookie
    const pairs = await readJarPairs('weread');
    if (!isWereadLoggedIn(pairs)) {
        // 🔴 #757：把「看到了几条 Cookie」说出来 —— 用户 m07156 的原话是「啥也没反应」，
        //    而原来这里永远回同一句「等待扫码」，等于把「正在读、但还没读到登录态」藏起来。
        return { stage: 'pending', message: `等待扫码（已读到 ${pairs.length} 条 Cookie）` };
    }
    const jar = cookieHeaderFromPairs(pairs);
    if (!jar) return { stage: 'error', message: '已登录，但没读到微信读书 Cookie（请重试）' };
    // 🔴 #757：光看 Cookie 名不够 —— 上传到 jar 的那份可能是**上一次**的残渣，
    //    或者扫码刚完成、服务端还没认。⇒ 用**同一个权威端点**复核一次（就是「测试连接」用的那个），
    //    通过才算 done；不通过就继续等（⛔ 别在这里判 error，那会让用户连等待的机会都没有）。
    //    对照实现 `zhaohongxuan/obsidian-weread-plugin` 也是「拿到 cookie 再 verify 一次」。
    const probe = await probeWereadShelf(jar);
    if (!probe.ok) {
        return { stage: 'pending', message: `已看到登录信息，等待微信读书确认（${probe.message}）` };
    }
    return { stage: 'done', message: '扫码成功', cookie: jar };
}

/**
 * 带 Cookie 打一次微信读书**书架**接口，验这份 Cookie 是不是真登录态。
 *
 * 🔴 复用 `pure/weread` 的 `parseWereadShelfAuth`（与「测试连接」**同一份文案真源**），
 *    ⛔ 别在这里另写一套 `errCode` 判断 —— 本仓「同一概念只准一份文案」。
 * ⚠️ 不抛：网络失败折进 `{ ok: false }`，由调用方决定「继续等」还是报错。
 */
async function probeWereadShelf(cookie: string): Promise<{ ok: boolean; message: string }> {
    try {
        const res = await nodeHttpGet(buildWereadShelfUrl(), {
            'User-Agent': WEREAD_UA,
            Referer: WEREAD_REFERER,
            Accept: WEREAD_ACCEPT,
            Cookie: cookie,
        });
        if (res.status < 200 || res.status >= 300) return { ok: false, message: `微信读书返回 ${res.status}` };
        return parseWereadShelfAuth(res.text);
    } catch {
        return { ok: false, message: '网络请求失败' };
    }
}

/**
 * B 站 `refresh_token` 换新 Cookie（③-3 的「长期保持登录态」）。
 *
 * 🔴 端点实测存在：`POST /x/passport-login/web/cookie/refresh`，假 token 回 `-101 账号未登录`
 *    （= 参数名 `refresh_token` 是对的，只是 token 假）。成功时响应体里同时给**新的 `refresh_token`**
 *    ⇒ 必须把新的那份也存回去，否则只能用一次。
 *
 * ⚠️ 还要 `csrf`（= Cookie 里的 `bili_jct`）。没有它接口回 `-111`。
 * @returns 成功给出新 cookie 与新 refresh_token；失败 `null`（⛔ 别抛：调用方多半是后台静默续期）
 */
export async function refreshBiliCookie(
    refreshToken: string,
    csrf: string,
): Promise<{ cookie: string; refreshToken?: string } | null> {
    const token = String(refreshToken || '').trim();
    if (!token) return null;
    try {
        const body = `csrf=${encodeURIComponent(csrf || '')}&refresh_token=${encodeURIComponent(token)}`;
        const res = await nodeHttpGet(`${ENDPOINTS.biliRefresh}?${body}`, {
            'User-Agent': DESKTOP_UA,
            Referer: 'https://www.bilibili.com/',
            Cookie: csrf ? `bili_jct=${csrf}` : '',
        });
        const root = JSON.parse(res.text) as {
            code?: number;
            data?: { refresh_token?: string; cookie_info?: { cookies?: { name: string; value: string }[] } };
        };
        if (root.code !== 0 || !root.data) return null;
        const pairs = root.data.cookie_info?.cookies;
        const fromBody = Array.isArray(pairs) ? cookieHeaderFromPairs(pairs) : '';
        if (!fromBody) return null;
        const next = typeof root.data.refresh_token === 'string' ? root.data.refresh_token : '';
        return { cookie: fromBody, refreshToken: next || undefined };
    } catch {
        return null;
    }
}
