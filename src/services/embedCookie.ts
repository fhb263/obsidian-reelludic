/**
 * 把用户在设置里填的 Cookie **同步进 Electron 的 cookie jar**。
 *
 * 🔴 为什么需要这一层（2026-10-31 用户报障：「B站/油管内嵌的怎么还有登录，不上填了 cookie 吗」）：
 *    设置里填的 `biliCookie` / `ytCookie` 是**一个字符串**，只喂给插件自己发 API 请求
 *    （字幕抓取 `biliSubtitleFor` / `ytSubtitleFor`、下载 `dlBiliDownload` 那些 node 侧 fetch）。
 *    ⚠️ 2026-11-24 起取流整体删除（`biliStreamFor` / `ytStreamFor` 已不存在），这层同步
 *       成了设置里那串 Cookie **唯一**能到达 iframe 的通道 —— 别再删。
 *    而「官方内嵌播放器」是一个 `<iframe>` —— 它跑在 Electron 的**独立浏览上下文**里，
 *    用的是 Chromium 自己的 cookie jar。那份 jar 跟设置里那串字符串**毫无关系**，
 *    所以哪怕 Cookie 填得完全正确，内嵌 iframe 里照样是未登录、照样弹扫码。
 *    真机实测（CDP，`session.defaultSession.cookies.get`）：
 *      `https://www.bilibili.com` → 0 条、`https://www.youtube.com` → 0 条。
 *
 * ⚠️ 只用 `@electron/remote`（Obsidian 里可 require 到），⛔ 不走 `webContents.session`
 *    —— iframe 是渲染进程里的元素，拿不到 `webContents`；而 `defaultSession` 正是
 *    iframe 所属的会话（Obsidian 没有给 iframe 开独立 partition）。
 *
 * ⚠️ 只写**用户真的填了的**那些 cookie；空字符串 ⇒ 什么都不做（⛔ 别拿空值去覆盖
 *    用户此前在 Obsidian 里手动登录留下的会话）。
 */

/** 一条要写进 cookie jar 的记录 */
interface JarCookie {
    domain: string;
    name: string;
    value: string;
    path: string;
    secure: boolean;
    /** unix 秒；`0` = 会话 cookie（不传 expirationDate） */
    expiry: number;
    /**
     * 同站策略。iframe 场景**必须**是 `no_restriction`（= SameSite=None）。
     *
     * 🔴 这是「官方内嵌 iframe 里永远未登录」的真根因（2026-10-31 第二次报障）：
     *    官方内嵌 iframe 是从 Obsidian 的 origin（`app://obsidian.md`）嵌
     *    `player.bilibili.com` ⇒ 对 Chromium 是**第三方 / 跨站**上下文。
     *    SameSite=Lax（含未显式声明时的默认值）在跨站 iframe 里**一律不发送**。
     *
     *    ✅ 真机 A/B 实测（CDP `Network.requestWillBeSentExtraInfo`）：
     *       no_restriction ⇒ `Cookie` 头 1388 字节、含 SESSDATA、`blockedReasons` 0 条；
     *       lax            ⇒ `Cookie` 头 **0 字节**，一条不带。
     *
     *    ⚠️ 取证教训（别再栽）：`Network.requestWillBeSent` 的 `request.headers`
     *       **不暴露 Cookie**，用它量出来恒为 0，是**假阴性**，不能当证据。
     *       Cookie 的附带与拦截原因只在 `requestWillBeSentExtraInfo` 的
     *       `associatedCookies` / `headers` 里。我第一版就拿错口径，
     *       一度以为「写进 jar 也没用」，差点改错方向。
     *
     *    ⚠️ 我第一版解析时根本没读 `sameSite` ⇒ Chromium 默认落成 `lax`
     *       ⇒「写进去了但不生效」。所以这里必须显式归一。
     */
    sameSite: 'no_restriction' | 'lax' | 'strict';
    /** 原值里是否带 HttpOnly（B 站 SESSDATA 在浏览器里是 HttpOnly） */
    httpOnly: boolean;
}

interface ElectronCookieApi {
    set(details: Record<string, unknown>): Promise<void>;
    flushStore(): Promise<void>;
    /** 读回能力：诊断用（`set` 不抛 ≠ 真的进 jar） */
    get(filter: Record<string, unknown>): Promise<{ name: string; domain: string }[]>;
}

interface ElectronSession {
    cookies: ElectronCookieApi;
}

/** `@electron/remote` 的最小面（⛔ 不装 @types，只取用得上的两个字段） */
interface ElectronRemote {
    session?: { defaultSession?: ElectronSession };
}

/**
 * 拿 Electron 的默认 session（cookie jar 就在这里）。
 *
 * 🔴 2026-11-24 用户 m05414：「youtube内嵌播放器填了cookie还是无法播放」。
 *    改这里之前本函数是 `catch { return null }`、`writeAll` 是 `catch {}`、
 *    调用方还有 `.catch(() => undefined)` —— **三处都把失败吞干净了**，
 *    结果「填了没反应」在界面上和日志里都是零痕迹，只能靠猜。
 *    ⇒ 现在必须把原因一路带出来（`SessionProbe.reason`），⛔ 别再改回静默。
 *
 * ⚠️ `@electron/remote` 在 Obsidian 里默认**可能是禁用的**：主进程侧有
 *    `isRemoteModuleEnabled()` 检查，未 `enable(webContents)` 时 require 会抛
 *    `@electron/remote is disabled for this WebContents`。这条错误必须能被看见，
 *    否则用户只会看到「cookie 无效」这种假结论。
 */
interface SessionProbe {
    session: ElectronSession | null;
    /** 拿不到时的人话原因（拿到就是空串） */
    reason: string;
}

function electronSession(): SessionProbe {
    let req: ((m: string) => unknown) | undefined;
    try {
        req = (window as unknown as { require?: (m: string) => unknown }).require;
    } catch {
        req = undefined;
    }
    if (typeof req !== 'function') {
        return { session: null, reason: '当前环境没有 window.require（非 Electron 渲染进程）' };
    }
    try {
        const remote = req('@electron/remote') as ElectronRemote | undefined;
        const sess = remote?.session?.defaultSession ?? null;
        if (!sess) return { session: null, reason: '@electron/remote 没有暴露 session.defaultSession' };
        return { session: sess, reason: '' };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { session: null, reason: `@electron/remote 不可用：${msg}` };
    }
}

/**
 * 把浏览器扩展导出的 `sameSite` 归一成 Electron 认的三档。
 *
 * ⚠️ 缺省 / 不认识的取值一律按 `no_restriction` 处理：**这是我们唯一的用途**
 *    （跨站 iframe 里要带得上登录态），按 `lax` 处理等于什么都没做。
 * ⚠️ 但 `no_restriction` 在 Chromium 里**必须配 `secure: true`**，否则写入被拒 ——
 *    所以下面 `writeAll` 里强制 `secure`。
 */
function normSameSite(raw: unknown): 'no_restriction' | 'lax' | 'strict' {
    const s = String(raw ?? '').toLowerCase();
    if (s === 'strict' || s === 'lax') return s;
    // 'no_restriction' / 'none' / 'unspecified' / 缺失 ⇒ 都要跨站可发
    return 'no_restriction';
}

/**
 * 解析形如 `SESSDATA=xxx; bili_jct=yyy` 的裸 Cookie 头。
 *
 * ⚠️ 只按**第一个** `=` 切：JWT / base64 的值里本身含 `=`。
 * ⚠️ 值可能带引号（`key="value"`），去掉首尾引号。
 * ⚠️ 裸头形态拿不到 sameSite 元信息 ⇒ 一律按 `no_restriction`（见 `normSameSite` 注释）。
 */
function parseHeader(raw: string, domain: string): JarCookie[] {
    const text = String(raw || '').trim();
    if (!text) return [];
    const out: JarCookie[] = [];
    for (const pair of text.split(';')) {
        const s = pair.trim();
        if (!s) continue;
        const eq = s.indexOf('=');
        if (eq <= 0) continue;
        const name = s.slice(0, eq).trim();
        if (!name) continue;
        let value = s.slice(eq + 1).trim();
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        out.push({
            domain,
            name,
            value,
            path: '/',
            secure: true,
            expiry: 0,
            sameSite: 'no_restriction',
            httpOnly: false,
        });
    }
    return out;
}

/**
 * 解析浏览器扩展导出的 **JSON 数组**形态（用户填 YouTube Cookie 时用的就是它）。
 *
 * ⚠️ `hostOnly: true` 的条目域不带前导点，写 cookie jar 时**必须原样保留**
 *    （写成 `.www.youtube.com` 就匹配不到 `www.youtube.com` 了）。
 * ⚠️ `expirationDate` 是浮点秒，Chromium 只收整数。
 */
function parseJsonArray(raw: string, fallbackDomain: string): JarCookie[] {
    let arr: unknown;
    try {
        arr = JSON.parse(raw);
    } catch {
        return []; // 半截 JSON ⇒ 当没给，⛔ 不猜
    }
    const list = Array.isArray(arr) ? arr : [arr];
    const out: JarCookie[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const name = typeof o.name === 'string' ? o.name.trim() : '';
        if (!name) continue;
        const value = o.value === undefined || o.value === null ? '' : String(o.value);
        const domain = typeof o.domain === 'string' && o.domain ? o.domain : fallbackDomain;
        const path = typeof o.path === 'string' && o.path ? o.path : '/';
        const secure = o.secure === true;
        const expRaw = Number(o.expirationDate ?? 0);
        const expiry = Number.isFinite(expRaw) && expRaw > 0 ? Math.floor(expRaw) : 0;
        out.push({
            domain,
            name,
            value,
            path,
            secure,
            expiry,
            sameSite: normSameSite(o.sameSite),
            httpOnly: o.httpOnly === true,
        });
    }
    return out;
}

/** 两种真实形态都认：JSON 数组（扩展导出）与裸头（开发者工具复制） */
function parseAny(raw: string, fallbackDomain: string): JarCookie[] {
    const text = String(raw || '').trim();
    if (!text) return [];
    if (text.startsWith('[') || text.startsWith('{')) return parseJsonArray(text, fallbackDomain);
    return parseHeader(text, fallbackDomain);
}

/**
 * 域白名单：决定设置里那串 Cookie 中**哪些域**值得写进 jar。
 *
 * 🔴 为什么 YouTube 要放 `google.com` 进来（2026-11-25 用户报障：
 *    「配置 cookie 都不能播放 youtube 内嵌视频？提示要登录」）：
 *    YouTube 的**登录令牌全在 `.google.com` 域上** —— `SID` / `HSID` / `SSID` /
 *    `APISID` / `SAPISID` / `__Secure-1PSID` / `__Secure-3PSID` / `__Secure-1PAPISID`，
 *    浏览器扩展导出的 JSON 里这些条目的 `domain` 写的就是 `.google.com`。
 *    而 `.youtube.com` 上只有 `PREF` / `VISITOR_INFO1_LIVE` / `CONSENT` 这类**非登录态**。
 *    ⇒ 旧口径 `/youtube\.com$/` 会把登录令牌**整批丢掉**，只写进几条例行 cookie，
 *      iframe 里自然是未登录、自然弹「请先登录」。
 *
 * ⚠️ `youtube-nocookie.com` 也收：`netEmbedFallbackUrl` 在墙内重试时换的就是这个域，
 *    它的 cookie 是独立的一套（`.youtube.com` 的条目不适用于它）。
 *    ⚠️ 但正因为域独立 —— **nocookie 重试那一次必然是未登录态**，只能看免登录视频。
 *       这是「先能出画面」与「保持登录」之间的取舍，不要试图把 youtube.com 的 cookie
 *       硬塞给 nocookie（Chromium 会按域拒收）。
 *
 * ⚠️ 归一后再比较：去掉前导点、转小写。`hostOnly` 条目（`www.youtube.com`）本来就不带点。
 */
export function cookieDomainAccepted(kind: 'bili' | 'yt', domain: string): boolean {
    const d = String(domain ?? '')
        .trim()
        .toLowerCase()
        .replace(/^\./, '');
    if (!d) return false;
    if (kind === 'bili') return d === 'bilibili.com' || d.endsWith('.bilibili.com');
    return (
        d === 'youtube.com' ||
        d.endsWith('.youtube.com') ||
        d === 'google.com' ||
        d.endsWith('.google.com') ||
        d === 'youtube-nocookie.com' ||
        d.endsWith('.youtube-nocookie.com')
    );
}

/**
 * 对外暴露的解析器（**仅为测试与诊断**）—— 把设置里那串 Cookie 解析成待写入 jar 的记录。
 *
 * ⚠️ 业务代码请用 `syncEmbedCookies`；这个导出只是让「两种形态都能解析」这条
 *    有回归锁（历史上「只按 `;` 切串」导致 JSON 导出被整批丢弃 = 填了等于没填）。
 */
export function parseEmbedCookies(raw: string, fallbackDomain: string): JarCookie[] {
    return parseAny(raw, fallbackDomain);
}

/** 写一批 cookie；返回成功条数与失败明细（单条失败不阻断其余） */
interface WriteOutcome {
    ok: number;
    /** 失败条数与第一条失败原因（给人看的） */
    failed: number;
    firstError: string;
}

async function writeAll(sess: ElectronSession, list: JarCookie[]): Promise<WriteOutcome> {
    let ok = 0;
    let failed = 0;
    let firstError = '';
    for (const c of list) {
        try {
            await sess.cookies.set({
                url: `https://${c.domain.replace(/^\./, '')}${c.path}`,
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                // ⚠️ `no_restriction`（SameSite=None）在 Chromium 里**必须** secure=true，
                //    否则这条写入会被静默拒绝 ⇒ iframe 里照样没有登录态。
                secure: c.sameSite === 'no_restriction' ? true : c.secure,
                httpOnly: c.httpOnly,
                sameSite: c.sameSite,
                ...(c.expiry > 0 ? { expirationDate: c.expiry } : {}),
            });
            ok += 1;
        } catch (e) {
            // 单条写不进去（域非法 / 值超长 / jar 拒收）⇒ 跳过，⛔ 别让整批失败。
            // 🔴 但**必须记下第一条原因**：历史上这里 catch{} 全吞，导致
            //    「填了 cookie 没效果」永远只能靠猜（见 electronSession 的注释）。
            failed += 1;
            if (!firstError) firstError = e instanceof Error ? e.message : String(e);
        }
    }
    return { ok, failed, firstError };
}

export interface EmbedCookieInput {
    /** 设置页「B 站登录 Cookie」，裸头形态 `SESSDATA=…; bili_jct=…` */
    bili: string;
    /** 设置页「YouTube Cookie」，通常是浏览器扩展导出的 JSON 数组 */
    yt: string;
}

/**
 * YouTube 的登录令牌清单（诊断「到底登录没登录」的口径）。
 *
 * ⚠️ 这些名字来自浏览器扩展导出的实况数据（用户 data.json 里 19 条 ytCookie 全都有），
 *    ⛔ 别凭记忆增删：名字写错会导致诊断假报「缺令牌」。
 */
const YT_LOGIN_COOKIES = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'];

export interface EmbedCookieProbe {
    /** 是否拿到了 Electron session（false ⇒ 非 Electron 环境） */
    available: boolean;
    /** 拿不到 session 的原因（正常时空串） */
    issue: string;
    /** jar 里 youtube.com 域下**实际存在**的 cookie 名 */
    ytNames: string[];
    /** jar 里 bilibili.com 域下**实际存在**的 cookie 名 */
    biliNames: string[];
    /** YouTube 登录令牌里缺了哪几个（空数组 = 全在） */
    ytMissingLogin: string[];
}

/**
 * 诊断用：**把 jar 里真实存在的 cookie 读回来**，而不是只看 `set()` 没抛异常。
 *
 * 🔴 为什么必须有这个：`cookies.set()` 对一条被 Chromium 拒收的写入**可能既不抛也不生效**
 *    （`secure`/`sameSite` 组合不合规时就是这种表现）。上一轮修 Ⓒ 时只能靠「写没写」猜，
 *    是因为当时三处 catch 把一切吞了；现在有了读回，就能一句话分清三种故障：
 *    ① 拿不到 session（`available:false`）；② 写不进去（`ytNames` 空）；
 *    ③ 写进去了但登录令牌不全（`ytMissingLogin` 非空）。
 *
 * ⚠️ 只读，不写任何东西；失败一律降级成空数组，⛔ 不抛给调用方。
 */
export async function probeEmbedCookies(): Promise<EmbedCookieProbe> {
    const empty: EmbedCookieProbe = {
        available: false,
        issue: '',
        ytNames: [],
        biliNames: [],
        ytMissingLogin: [],
    };
    const probe = electronSession();
    const sess = probe.session;
    if (!sess) return { ...empty, issue: probe.reason };
    const read = async (domain: string): Promise<string[]> => {
        try {
            const list = await sess.cookies.get({ domain });
            return list.map((c) => c.name);
        } catch {
            return [];
        }
    };
    const ytNames = await read('.youtube.com');
    const biliNames = await read('.bilibili.com');
    const ytSet = new Set(ytNames);
    const ytMissingLogin = YT_LOGIN_COOKIES.filter((n) => !ytSet.has(n));
    return { available: true, issue: '', ytNames, biliNames, ytMissingLogin };
}

export interface EmbedCookieResult {
    /** 是否拿到了 Electron session（false ⇒ 非 Electron 环境，什么都没写） */
    available: boolean;
    bili: number;
    yt: number;
    /**
     * 拿不到 session 的原因 / 写入失败的第一条原因（正常时是空串）。
     * 🔴 存在的意义只有一个：让「填了 cookie 没效果」能当场说出为什么，
     *    ⛔ 别在调用点把它丢掉（历史上 `.catch(() => undefined)` 就是这么坑的）。
     */
    issue: string;
}

/**
 * 把设置里填的 Cookie 同步进 Electron cookie jar（官方内嵌播放器读的就是这份）。
 *
 * ⚠️ 调用时机：**挂 iframe 之前**。Cookie 一旦写进去，iframe 加载时就会带上登录态。
 * ⚠️ 幂等：同样的值重复写只是覆盖，不会产生重复条目。
 */
export async function syncEmbedCookies(input: EmbedCookieInput): Promise<EmbedCookieResult> {
    const probe = electronSession();
    const sess = probe.session;
    if (!sess) return { available: false, bili: 0, yt: 0, issue: probe.reason };

    const bili = parseAny(input.bili, '.bilibili.com').filter((c) => cookieDomainAccepted('bili', c.domain));
    const yt = parseAny(input.yt, '.youtube.com').filter((c) => cookieDomainAccepted('yt', c.domain));

    const biliOut = bili.length > 0 ? await writeAll(sess, bili) : { ok: 0, failed: 0, firstError: '' };
    const ytOut = yt.length > 0 ? await writeAll(sess, yt) : { ok: 0, failed: 0, firstError: '' };

    const biliOk = biliOut.ok;
    const ytOk = ytOut.ok;

    if (biliOk > 0 || ytOk > 0) {
        // flush 到磁盘：不刷的话进程重启后 cookie 就没了（用户会以为「又没填」）
        try {
            await sess.cookies.flushStore();
        } catch {
            /* 刷盘失败不影响本次会话 */
        }
    }

    // 只有「该写却一条都没写进去」才算 issue；配置为空是用户自己的选择，不算故障。
    let issue = '';
    if (input.yt.trim() && ytOk === 0) {
        issue = ytOut.failed > 0 ? `YouTube Cookie 写入失败（${ytOut.failed} 条全部被拒）：${ytOut.firstError}` : 'YouTube Cookie 解析后没有任何有效条目';
    } else if (input.bili.trim() && biliOk === 0) {
        issue = biliOut.failed > 0 ? `B 站 Cookie 写入失败（${biliOut.failed} 条全部被拒）：${biliOut.firstError}` : 'B 站 Cookie 解析后没有任何有效条目';
    }
    return { available: true, bili: biliOk, yt: ytOk, issue };
}
