/**
 * TMDB 凭据形态判定与请求头构造（纯逻辑，零 obsidian/DOM）。
 *
 * ## 为什么要判形态
 * TMDB 有**两套**并存的凭据，认证方式完全不同：
 *
 * | 类型 | 外观 | 认证方式 |
 * | --- | --- | --- |
 * | v3 API Key | 32 位十六进制（如 `a1b2c3d4e5f6...`） | **query 参数** `?api_key=<key>` |
 * | v4 Read Access Token | JWT（`eyJ...`，含两个 `.`，通常 200+ 字符） | **请求头** `Authorization: Bearer <token>` |
 *
 * 🔴🔴 2026-10-25 用户报障「我临时测试库的为什么不能同步 tmdb 的收藏，我填了 id 名了」
 *   追加说明：**「是 v4 的令牌认证的」**。
 *   旧实现把凭据**一律**当 v3 塞进 `?api_key=` ⇒ 填 v4 JWT 时每个请求都 401
 *   （TMDB 的 401 文案还偏偏是「Invalid API key」，把用户引向反复重填 key）。
 *   ⇒ 必须按凭据形态分流：v4 走 header，并且**不能**再带 `api_key` 参数
 *     （带了会被 TMDB 判成 key 无效而优先报错）。
 *
 * ⚠️ 判据只用**形态**，不校验签名/有效期（那要发请求才知道）。判错的代价：
 *   · JWT 被当 v3 ⇒ 401（和修复前一样，不更坏）
 *   · v3 key 被当 JWT ⇒ 缺 `api_key` ⇒ 401
 *   所以两种形态的判别边界必须清晰：JWT 的 `eyJ` 前缀 + 两个点，v3 key 是纯十六进制、无点。
 */

/** TMDB v4 Read Access Token 的形态判据（JWT：`eyJ` 前缀 + 至少两个 `.`） */
export function isTmdbV4Token(credential: string): boolean {
    const s = (credential ?? '').trim();
    if (!s) return false;
    // JWT 的 header 段恒以 `eyJ` 开头（`{"` 的 base64url 编码，`alg`/`typ` 的固定开头）
    if (!s.startsWith('eyJ')) return false;
    // header.payload.signature —— 至少两个分隔点
    return s.split('.').length >= 3;
}

/**
 * 该凭据需要的请求头。v3 ⇒ 空对象（认证在 query 里）；v4 ⇒ `Authorization: Bearer <token>`。
 * ⛔ 别给 v3 key 也套 Bearer：TMDB 会当 token 解析失败。
 */
export function tmdbAuthHeaders(credential: string): Record<string, string> {
    if (!isTmdbV4Token(credential)) return {};
    return { Authorization: `Bearer ${credential.trim()}` };
}

/**
 * 把认证拼进 query 串。
 * - v3：`&api_key=<key>`（调用方自己起头，这里返回含前导 `&` 的片段）
 * - v4：空串 —— **⛔ 绝不能带 api_key**，否则 TMDB 优先报 "Invalid API key"
 */
export function tmdbApiKeyQuery(credential: string): string {
    if (isTmdbV4Token(credential)) return '';
    return `&api_key=${encodeURIComponent(credential.trim())}`;
}

/**
 * 「API Key」那一格更严的判据：**只收 v3 API Key**（32 位十六进制）。
 *
 * 🔴🔴 2026-10-25 用户裁定（第二版口径）：「统一一下吧，Session ID 那一格填的只能是 access_token
 *   近 300 位字符串，第二格填的只能是从 themoviedb.org 的「设置 → API」获取的 32 位字符串，占位说明也是」。
 *   ⇒ 两格**各归各位**：Key 格只认 32 位 hex，Session 格只认 v4 access_token（JWT）。
 *   ⚠️ 与 `isTmdbV4Token` 是**互补**的两条边界，⛔ 别拿它替换形态判据：
 *      `isTmdbV4Token` 决定「请求怎么带凭据」（老用户填的 v4 Read Access Token 仍要能搜），
 *      本函数只决定「这个框里的东西像不像一把 v3 Key」，用于输入框就地校验与同步前拦截。
 */
export function isTmdbV3ApiKey(credential: string): boolean {
    const s = (credential ?? '').trim();
    return /^[0-9a-fA-F]{32}$/.test(s);
}

/**
 * 「Session ID」那一格更严的判据：**只收 v4 access_token**（用户认证流程产物，`eyJ` 开头的长串）。
 * v3 的 32 位 session_id 不再接受（用户裁定「这一格填的只能是 access_token」）。
 */
export function isTmdbV4AccessToken(sessionId: string): boolean {
    const s = (sessionId ?? '').trim();
    // 与 isTmdbV4Token 同判据：`eyJ` 前缀 + 两个点。长度不写死 —— 官方不保证固定位数，
    // 写死「近 300 位」会在官方改长度那天误杀合法令牌。
    return isTmdbV4Token(s);
}

/**
 * 「Session ID」这一格该不该先换成 v3 session_id。
 *
 * 🔴🔴 2026-10-25 用户报障第二轮：「我是用 TMDB v4 用户认证操作流程…⑤在设置页该元数据源凭据行下
 *   填写 Session ID…获取的但依然同步不了」。
 *   **根因**：v4 用户认证流程（`/4/auth/request_token` → `/4/auth/access_token`）返回的是
 *   `access_token`（同样是 `eyJ` 开头的 JWT），**不是** v3 的 `session_id`（32 位十六进制）。
 *   用户按官方 v4 文档一路走下来，最后一步「填 Session ID」自然会把 access_token 填进来。
 *   而插件把它原样当 `?session_id=` 用 ⇒ 账号接口必然 401。
 *
 *   ⇒ 官方给了正解：`POST /3/authentication/session/convert/4`，body `{"access_token": "<v4 access token>"}`，
 *     返回 `{"success": true, "session_id": "..."}`。填 token 也能用，插件自己换。
 *
 * ⚠️ 判据与 v4 Read Access Token 相同（都是 `eyJ` 开头的 JWT）；v3 session_id 是 32 位十六进制、不带点，
 *   所以两种输入**不会互相误判**。
 * ⚠️ 2026-10-25 用户裁定后，这一格**只该收 access_token**；但 `tmdbSessionNeedsConvert` 仍按形态判，
 *   老用户手里的 v3 session_id 会走 `false` 分支原样使用 —— 这是**兼容**，不是承诺。
 *   提示与拦截文案一律按「只填 access_token」写（见 `Settings` 与 `tmdbSessionFieldIssue`）。
 */
export function tmdbSessionNeedsConvert(sessionId: string): boolean {
    return isTmdbV4Token(sessionId);
}

/**
 * 解析 `POST /3/authentication/session/convert/4` 的响应，取出 `session_id`。
 * 失败时抛带定位信息的错误（⛔ 不返回空串让上层拿空 session 去请求，那只会得到更难懂的 401）。
 */
export function parseTmdbConvertedSessionId(text: string): string {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('TMDB 会话转换失败 —— 响应不是合法 JSON（可能是代理返回了 HTML 错误页）');
    }
    const rec = data as Record<string, unknown> | null;
    const sid = rec && typeof rec.session_id === 'string' ? rec.session_id.trim() : '';
    if (sid) return sid;
    const msg = rec && typeof rec.status_message === 'string' ? rec.status_message : '';
    throw new Error(
        `TMDB 会话转换失败 —— access_token 未被批准或已过期${msg ? `（${msg}）` : ''}；` +
            '请重新走一遍 v4 用户认证流程（request_token → 浏览器批准 → access_token）',
    );
}

// ── 两格各自的就地校验文案（纯函数，便于单测与四处复用）──────────────────────────
// 🔴 2026-10-25 用户裁定：「Session ID 那一格填的只能是 access_token 近 300 位字符串，
//   第二格填的只能是从 themoviedb.org 的「设置 → API」获取的 32 位字符串，占位说明也是」。
//   ⇒ 校验文案分开写、⛔ 不再互相兼容：填错的格必须说清「该填哪种、去哪拿」，
//     而不是含糊的「两种都可以」。返回 null = 这一格没问题。

/** 第一格（API Key）该填什么 —— 不合法时返回用户可读的原因 */
export function tmdbApiKeyFieldIssue(value: string): string | null {
    const s = (value ?? '').trim();
    if (!s) return null; // 空值由「未配置」徽标负责，不在这里喊
    if (isTmdbV4Token(s)) {
        return '这一格只填 32 位 v3 API Key —— 你填的是一把 v4 读访问令牌（eyJ 开头），请改填到下面的 access_token 格';
    }
    if (!isTmdbV3ApiKey(s)) {
        return '这一格只填 32 位十六进制 v3 API Key（在 themoviedb.org「设置 → API」的「API Key」处复制）';
    }
    return null;
}

/** 第二格（access_token）该填什么 —— 不合法时返回用户可读的原因 */
export function tmdbSessionFieldIssue(value: string): string | null {
    const s = (value ?? '').trim();
    if (!s) return null;
    if (isTmdbV3ApiKey(s)) {
        return '这一格只填 v4 access_token（eyJ 开头的长串）—— 你填的是 32 位 v3 Session ID，本插件不再用它同步';
    }
    if (!isTmdbV4AccessToken(s)) {
        return '这一格只填 v4 access_token：走 TMDB v4 用户认证流程拿到的那串 eyJ 开头的长令牌';
    }
    return null;
}
