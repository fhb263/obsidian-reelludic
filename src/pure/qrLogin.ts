/**
 * 扫码登录的**纯逻辑层**（③-3 B 站 / ③-4 微信读书，2026-11-12 用户 m00353）。
 *
 * 🔴 方案变更（用户 m05505 实测反馈后，**推翻 m05063 的「弹出对应网页扫码」**）：
 *    用户原话：「这个 b 站扫码登录怎么是跳转到浏览器登录还会触发下载 iBiliPlayer 的行为什么鬼
 *    （但我浏览器有账号登录了就一直登录不了 cookie 也不能获取回填）」
 *    ⇒ 两个真根因，都在「开子窗口」这条路上：
 *      ⑴ 为保住 `qrcode_key` 必须给子窗口设**移动端 UA**（桌面 UA 会被重定向并换 key），
 *         而 B 站 H5 页认出移动端就渲染「下载 App」引导 —— `iBiliPlayer` 正是它安卓包的包名。
 *      ⑵ 子窗口是**独立 session**，与用户系统浏览器的登录态完全隔离；他浏览器里已登录，
 *         插件这边照样是空的，于是「一直登录不了、Cookie 拿不回来」。
 *    ⇒ **B 站改成插件内自绘二维码**（`pure/qrcode` 编码 + 本模块轮询），不弹窗、不跳浏览器、
 *      不触发下载引导，`refresh_token` 照样能拿到。
 *    ⇒ **豆瓣扫码整条删掉**（用户 m05505 明确要求）；它的 Cookie 仍可手动粘贴。
 *    ⇒ **微信读书保留开窗口**：实测 8 个候选 HTTP 端点全 404，**没有任何扫码接口**，
 *      只能开它的首页让用户自己点「登录」用微信扫，我们盯 cookie jar 里的 `wr_name`。
 *
 * ⚠️ 本模块**不碰 BrowserWindow / 网络 / DOM** —— 那些在 `services/qrLogin`。
 * ⚠️ 本模块**不判断「登录成功」以外的事**：Cookie 有没有效由既有的「测试连接」回答
 *   （`pure/credentialCheck` 那套），⛔ 别在这里再造一套判据。
 */

/** 支持扫码登录的平台（豆瓣已按用户 m05505 要求移除）。 */
export type QrPlatform = 'bilibili' | 'weread';

/** 扫码会话的阶段（UI 按它决定显示什么）。 */
export type QrStage =
    /** 已拿到二维码信息，等用户扫 */
    | 'pending'
    /** 用户扫了、手机端还没确认（B 站 `86102` / `86090`） */
    | 'scanned'
    /** 登录成功，凭据已拿到 */
    | 'done'
    /** 二维码过期，需要重新生成 */
    | 'expired'
    /** 出错（网络 / 接口改版 / 被风控） */
    | 'error';

/** 一次轮询的归一结果（UI 只认这个形状）。 */
export interface QrPollResult {
    stage: QrStage;
    /** 给用户看的一句话（成功/失败/过期都要能说清，⛔ 不写「出错了」这种废话） */
    message: string;
    /**
     * 拿到的凭据。`stage === 'done'` 时才有。
     * - B 站：`cookie`（`SESSDATA=…` 等拼好的 Cookie 头值）+ `refreshToken`
     * - 微信读书：只有 `cookie`
     */
    cookie?: string;
    /** B 站专有：`qrcode/poll` 响应体里的 `refresh_token`（③-3 硬要求「必须持久化」）。 */
    refreshToken?: string;
    /**
     * B 站专有：成功那轮 `data.url` 里的**票据地址**。
     *
     * 🔴 #756 新增（用户 m06077「B 站扫码能获取但测试连接失败」）：
     *    该地址形如 `…/web/crossDomain?ticket=…&gourl=…&first_domain=…`，**不含任何登录凭据**。
     *    真正的 `SESSDATA` / `bili_jct` / `DedeUserID` 要靠 GET 它、从 **302 的 `Set-Cookie`** 拿。
     * ⇒ 本层只负责把地址带出来（纯逻辑不碰网络），换凭据在 `services/qrLogin.exchangeBiliTicket`。
     */
    ticketUrl?: string;
}

/** `startQrLogin` 的产物：够 UI 画码 / 开窗口 + 起轮询。 */
export interface QrStartInfo {
    platform: QrPlatform;
    /**
     * B 站：要**编码进二维码**的扫码页地址（`account.bilibili.com/h5/.../scan-web?qrcode_key=…`）。
     * 微信读书：要加载的首页地址（本插件不画它的码，用户点页面上的「登录」）。
     */
    url: string;
    /** B 站轮询用的 key（微信读书没有） */
    qrcodeKey?: string;
}

/** B 站 poll 的 `code` 语义（官方口径，实测确认）。 */
export const BILI_POLL = {
    /** 0 = 成功（此时才有 url / refresh_token） */
    ok: 0,
    /** 86101 = 未扫码 */
    notScanned: 86101,
    /** 86102 = 已扫码待确认 */
    scanned: 86102,
    /** 86090 = 已扫码待确认（旧口径，部分版本会回这个） */
    scannedLegacy: 86090,
    /** 86038 = 二维码已失效 */
    expired: 86038,
} as const;

/**
 * 微信读书**昵称**所在的 Cookie 名（只用来显示「当前账号」，⛔ 不用它判登录）。
 *
 * 🔴 #757（用户 m07156「微信读书扫码后子窗口登录了，但设置页啥也没反应」）：
 *    以前把「登录判据」和「显示名」压成同一个键，只认它非空 ⇒ 真登录了也认不出来。
 *    实测反证：微信读书自己前端 4 个 bundle 里 **`wr_name` 字面量 0 命中**，
 *    它在设置页里的身份靠 `wr_vid`（用户 id）+ `wr_skey`（会话票）扛着。
 */
export const WEREAD_LOGIN_COOKIE = 'wr_name';

/** 微信读书的**用户 id** Cookie（判登录的必要条件，见 `isWereadLoggedIn`）。 */
export const WEREAD_ID_COOKIE = 'wr_vid';

/**
 * 微信读书的**身份/会话** Cookie 名：出现任意一个非空值才算「真的登进去了」。
 *
 * 🔴 依据（对照已验证可用的开源实现 `zhaohongxuan/obsidian-weread-plugin` 的
 *    `src/components/wereadLoginModel.ts`，它的判据原文是：
 *    `if (!wrVid || ((!wrName || wrName.value === '') && (!wrSkey || wrSkey.value === ''))) return false;`
 *    —— 即 **`wr_vid` 必须有，且 `wr_name` 与 `wr_skey` 至少一个非空**）。
 * ⚠️ 顺序有意义：`wr_skey` 是会话票，比昵称硬；`wr_name` 只是展示名。
 */
export const WEREAD_LOGIN_COOKIES = ['wr_skey', 'wr_name'] as const;

/** B 站 Cookie 里带用户 id 的键（用来在「当前账号」那行显示是谁）。 */
export const BILI_UID_COOKIE = 'DedeUserID';

/**
 * 从 B 站 `qrcode/poll` 的**响应 JSON** 里抽出凭据。
 *
 * 🔴 为什么不能只看 `code`：`refresh_token` 在 `data` 里，而真正的状态在 `data.code`
 *    （**不是**顶层 `code`）。实测响应形态：
 *    `{"code":0,"data":{"url":"…","refresh_token":"…","timestamp":0,"code":0,"message":"成功"}}`
 *    ⚠️ 顶层 `code` 恒为 0（接口本身通了），看错一层就会把「未扫码」当成「成功」。
 */
export function parseBiliPoll(raw: string): QrPollResult {
    let root: unknown;
    try {
        root = JSON.parse(raw);
    } catch {
        return { stage: 'error', message: 'B 站返回的不是 JSON（可能被风控页拦截）' };
    }
    if (!root || typeof root !== 'object') {
        return { stage: 'error', message: 'B 站返回结构无法识别' };
    }
    const top = root as Record<string, unknown>;
    if (top.code !== 0) {
        return { stage: 'error', message: `B 站接口报错：${String(top.message ?? top.code ?? '未知')}` };
    }
    const data = (top.data && typeof top.data === 'object' ? top.data : {}) as Record<string, unknown>;
    const code = typeof data.code === 'number' ? data.code : -1;
    const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : '';

    if (code === BILI_POLL.ok) {
        const url = typeof data.url === 'string' ? data.url : '';
        return {
            stage: 'done',
            message: '扫码成功',
            // 🔴 #756：票据地址里没有凭据 ⇒ `cookieFromBiliCallbackUrl` 会返回 undefined，
            //    此时必须把地址带出去让服务层「拿票据换真凭据」，⛔ 不能当成「已拿到 Cookie」。
            cookie: url ? cookieFromBiliCallbackUrl(url) : undefined,
            refreshToken: refreshToken || undefined,
            ticketUrl: url && isBiliTicketUrl(url) ? url : undefined,
        };
    }
    if (code === BILI_POLL.scanned || code === BILI_POLL.scannedLegacy) {
        return { stage: 'scanned', message: '已扫码，请在手机上确认登录' };
    }
    if (code === BILI_POLL.expired) {
        return { stage: 'expired', message: '二维码已过期，请重新生成' };
    }
    if (code === BILI_POLL.notScanned) {
        return { stage: 'pending', message: '等待扫码' };
    }
    // 未知状态码：把原话带出去（⛔ 别硬编码成「等待扫码」，那会让卡住的人以为是自己没扫）
    return {
        stage: 'pending',
        message: typeof data.message === 'string' && data.message ? data.message : '等待扫码',
    };
}

/**
 * B 站成功那轮的 `data.url` 可能是**两种形态**（#756 实测并存）：
 *
 * ⑴ 老形态（带凭据）：`https://passport.biligame.com/crossDomain?DedeUserID=…&SESSDATA=…&bili_jct=…`
 * ⑵ 新形态（**票据**）：`https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=…&gourl=…&first_domain=…`
 *
 * 🔴 用户 m06077 的真机事故：⑵ 里**一个登录凭据都没有**，而我们把这个 query 全当 Cookie 存了
 *    ⇒ `data.json` 里出现 `biliCookie: "ticket=…; gourl=…; first_domain=…"`，
 *      「测试连接」必然失败（缺 `SESSDATA`）。
 * ⇒ 判据 = 有没有 `ticket` 参数。有就走「拿票据换真凭据」（`services/qrLogin.exchangeBiliTicket`）。
 */
export function isBiliTicketUrl(url: string): boolean {
    if (!url) return false;
    const q = url.indexOf('?');
    if (q < 0) return false;
    for (const seg of url.slice(q + 1).split('&')) {
        const eq = seg.indexOf('=');
        if (eq > 0 && seg.slice(0, eq) === 'ticket') return true;
    }
    return false;
}

/** 真正的登录凭据 Cookie 名（B 站）。只有出现其中之一才算「拿到了凭据」。 */
export const BILI_CREDENTIAL_COOKIES = ['SESSDATA', 'bili_jct', 'DedeUserID'] as const;

/**
 * 从 B 站成功那轮的 `data.url` 里抠 Cookie（**仅老形态有效**）。
 *
 * ⚠️ #756 起加了**白名单**：只收 `SESSDATA` / `bili_jct` / `DedeUserID` / `buvid3` / `b_nut` 等
 *    真凭据键。原先「把 query 全部拼成 Cookie」的做法会把票据参数（`ticket`/`gourl`/`first_domain`）
 *    当凭据存进设置 —— 那正是「扫码能获取但测试连接失败」的直接原因。
 * ⚠️ 值要 `decodeURIComponent`：B 站会把 `,` 编成 `%2C`（`SESSDATA` 里真的有逗号）。
 * @returns 一个凭据键都没命中时返回 `undefined`（调用方据此改走票据兑换）
 */
export function cookieFromBiliCallbackUrl(url: string): string | undefined {
    const q = url.indexOf('?');
    if (q < 0) return undefined;
    const pairs: string[] = [];
    for (const seg of url.slice(q + 1).split('&')) {
        const eq = seg.indexOf('=');
        if (eq <= 0) continue;
        const name = seg.slice(0, eq);
        if (!BILI_CREDENTIAL_COOKIES.includes(name as (typeof BILI_CREDENTIAL_COOKIES)[number])) continue;
        const rawVal = seg.slice(eq + 1);
        let val = rawVal;
        try {
            val = decodeURIComponent(rawVal);
        } catch {
            /* 保留原值：解码失败不该让整条 Cookie 作废 */
        }
        if (val) pairs.push(`${name}=${val}`);
    }
    return pairs.length ? pairs.join('; ') : undefined;
}

/**
 * 把从浏览器 Cookie 罐里读出来的键值对拼成请求头值。
 *
 * ⚠️ 为什么要自己拼：`session.cookies.get()` 返回的是**对象数组**，而设置页要存的是
 *   `name=value; name=value` 这一整条（与用户手工粘贴的形态一致，⛔ 别改存 JSON ——
 *   既有 13 条凭据全是这个形态，改一种就多一个解析分支）。
 * 🔴 过滤：**必须剔除空值** —— `key=` 这种空值在部分站点会被当成「显式置空」而让整份登录态失效。
 */
export function cookieHeaderFromPairs(pairs: ReadonlyArray<{ name: string; value: string }>): string {
    const out: string[] = [];
    for (const p of pairs) {
        if (!p || typeof p.name !== 'string' || !p.name) continue;
        if (typeof p.value !== 'string' || !p.value) continue;
        out.push(`${p.name}=${p.value}`);
    }
    return out.join('; ');
}

/**
 * 判断微信读书的 Cookie 罐里是否已经登录。
 *
 * 🔴 判据（#757 重写，原「只认 `wr_name` 非空」是错的）：
 *    ⑴ 必须有 **`wr_vid`**（用户 id）—— 没有它一定没登进去；
 *    ⑵ 且 `wr_skey` / `wr_name` 至少一个非空（`wr_skey` = 会话票，`wr_name` = 昵称）。
 *
 * 依据：对照实现 `zhaohongxuan/obsidian-weread-plugin` 的 `wereadLoginModel.ts` 用的就是这条
 *   复合判据；实测微信读书前端 bundle 里**没有 `wr_name` 字面量**，只认昵称必然误判成未登录。
 * ⛔ 别退回「有没有 Cookie」—— 登录前就已有一堆匿名 Cookie（`wr_gid` / `wr_fp` 等 9 位指纹）。
 */
export function isWereadLoggedIn(pairs: ReadonlyArray<{ name: string; value: string }>): boolean {
    const nonEmpty = (name: string): boolean =>
        pairs.some((p) => p && p.name === name && typeof p.value === 'string' && p.value.length > 0);
    if (!nonEmpty(WEREAD_ID_COOKIE)) return false;
    return WEREAD_LOGIN_COOKIES.some((name) => nonEmpty(name));
}

/**
 * 从 Cookie 头值里取某个键的值（找不到给 `undefined`）。
 *
 * ⚠️ 自己解析而不用 `URLSearchParams`：Cookie 头是 `; ` 分隔，与 query string 的 `&` 不是一回事，
 *   硬套会把带 `;` 的值切坏（`SESSDATA` 里就可能有）。
 */
export function cookieValueOf(cookie: string, name: string): string | undefined {
    if (!cookie || !name) return undefined;
    for (const seg of cookie.split(';')) {
        const s = seg.trim();
        const eq = s.indexOf('=');
        if (eq <= 0) continue;
        if (s.slice(0, eq) === name) {
            const raw = s.slice(eq + 1);
            try {
                return decodeURIComponent(raw);
            } catch {
                return raw;
            }
        }
    }
    return undefined;
}

/**
 * 「当前账号」那行显示什么。
 *
 * 🔴 用户 m05505 原话：「用扫码登录的 UI 要变化成原来的输入框区域替换为
 *    『当前账号: 微信读书用户』」⇒ 登录成功后输入框要**换成一行账号信息**。
 * ⚠️ 返回 `null` 表示「认不出是谁」—— 这时调用方必须**保留输入框**，⛔ 别显示
 *    「当前账号: 未知」把输入框藏掉（用户就再也改不了 Cookie 了）。
 */
export function accountNameOf(platform: QrPlatform, cookie: string): string | null {
    if (platform === 'weread') {
        // 昵称优先（`wr_name`）；取不到时退回用户 id（`wr_vid`）——
        // 🔴 #757：以前只认昵称，而实测「登录了也可能没 wr_name」⇒ 会显示不出「当前账号」，
        //    用户以为没登录成功。有 id 至少能证明「是谁的账号」。
        const name = cookieValueOf(cookie, WEREAD_LOGIN_COOKIE);
        if (name && name.trim()) return name.trim();
        const vid = cookieValueOf(cookie, WEREAD_ID_COOKIE);
        return vid && vid.trim() ? `微信读书用户 ${vid.trim()}` : null;
    }
    // B 站 Cookie 里没有昵称，只有 DedeUserID ⇒ 先显示 UID，真名由调用方补（见 Settings）
    const uid = cookieValueOf(cookie, BILI_UID_COOKIE);
    return uid && uid.trim() ? `UID ${uid.trim()}` : null;
}

/**
 * 轮询节奏（毫秒）。
 *
 * ⚠️ B 站官方页面自己约 1.5–2s 一次。取 **2000ms** 折中：太快会被风控，
 *   太慢用户确认完还要盯着弹窗等。
 */
export const QR_POLL_INTERVAL_MS = 2000;

/**
 * 二维码有效期（毫秒）。超时就把会话判 `expired`，⛔ 不让用户对着死码干等。
 * B 站官方 TTL 约 180s。取 **180s**。
 */
export const QR_SESSION_TTL_MS = 180_000;

/** 会话是否已经超时（`now - startedAt >= ttl`）。 */
export function isSessionExpired(startedAt: number, now: number, ttl: number = QR_SESSION_TTL_MS): boolean {
    return now - startedAt >= ttl;
}

/**
 * 微信读书的会话有效期（毫秒）。
 *
 * 🔴 #756（用户 m06077「微信读书扫码后不自动获取 cookie」）：它的流程不是「扫一下就完」——
 *    我们先开它的**首页**，用户还要自己点右上角「登录」、等二维码弹出来、再掏手机扫。
 *    沿用 B 站的 **180s** 会在「人还没点到登录按钮」时就把会话判过期，症状正好是
 *    「扫完了却什么都没发生」。⇒ 给足 **10 分钟**（人操作窗口），过期只影响轮询停止，不影响已登录态。
 */
export const WEREAD_SESSION_TTL_MS = 600_000;

/** 按平台取会话有效期。 */
export function sessionTtlOf(platform: QrPlatform): number {
    return platform === 'weread' ? WEREAD_SESSION_TTL_MS : QR_SESSION_TTL_MS;
}

/**
 * 从一整条 jar Cookie 里**只挑出 B 站登录凭据**。
 *
 * 🔴 为什么需要它：jar 里混着大量匿名/风控 Cookie（`buvid3`、`_uuid`、`b_nut`…），
 *    全量存进设置既冗长又容易把「游客态」当成登录态。判据只认
 *    `SESSDATA` / `bili_jct` / `DedeUserID` 三件套 —— 有 `SESSDATA` 才算真登录。
 * @returns 一个都没命中返回 `undefined`
 */
export function biliCredentialCookieOf(cookie: string): string | undefined {
    if (!cookie) return undefined;
    const out: string[] = [];
    for (const name of BILI_CREDENTIAL_COOKIES) {
        // ⚠️ 这里**不能**用 `cookieValueOf`：它会 `decodeURIComponent`，而 jar 里的值已经是原文，
        //    二次解码会把含 `%` 的 SESSDATA 弄坏（`%` 本身也可能就在值里）。
        const v = rawCookieValueOf(cookie, name);
        if (v) out.push(`${name}=${v}`);
    }
    return out.length ? out.join('; ') : undefined;
}

/** 取 Cookie 里某个键的**原值**（不解码）。jar 内部用，⛔ 别拿它解析 URL query。 */
function rawCookieValueOf(cookie: string, name: string): string | undefined {
    if (!cookie || !name) return undefined;
    for (const seg of cookie.split(';')) {
        const s = seg.trim();
        const eq = s.indexOf('=');
        if (eq <= 0) continue;
        if (s.slice(0, eq) === name) return s.slice(eq + 1);
    }
    return undefined;
}
