/**
 * B 站「网络集 → 内置播放器直链」的**纯逻辑**（无 obsidian / 无 Node 依赖，可单测）。
 *
 * 🔴 用户需求（2026-11-02）：m06237「内嵌播放不能用插件内置的播放器组件么」
 *    → 用户裁定：**换成插件内置播放器**，且**设置里支持填 Cookie 冲 1080p**。
 *
 * 🔴 真机实测结论（不是查文档猜的，全部用真实请求跑过）：
 *  1. `x/player/pagelist?bvid=…` 取 `cid` —— `code:0`，可直接用；
 *  2. ⛔ **不能要 DASH**（`fnval=16`）：返回 `.m4s` 音视频分离分片，`<video>` 单个 src 放不了
 *     （实测 `Format error`）——这是本项目早期一度放弃「自带播放器播 B 站」的真正原因；
 *  3. ⛔ **不带 `platform=html5` 的 mp4 直链丢给 `<video>` 一律 403**。
 *     实测矩阵（同一个 cid，只改 playurl 参数，再用裸 header 请求 CDN）：
 *       - `fnval=0&fourk=0&platform=html5` ⇒ 只带 UA 就 **206 + ftyp**（✅ 直连可行）
 *       - `fnval=1&fourk=1`（旧口径）        ⇒ 只带 UA **403**，必须补 Referer
 *       - `fnval=0`（不带 platform）         ⇒ 只带 UA **403**，必须补 Referer
 *  4. 🔴 破解点：**`platform=html5` 拿到的链接，B 站 CDN 只校验 UA、不校验 Referer。**
 *     `<video>` 自己就会带 UA（真机 UA 含 `obsidian/1.11.4 … Electron/31.7.7` 实测 **206**，
 *     中段 seek `bytes=30000000-` 也 **206**），⇒ **不需要任何本地代理**，直连即可播放。
 *     这也是 Smart Media Notes「try direct playback」能直接播 B 站的原因（已读其打包产物确认：
 *     它只 `bl()` 注入 UA/Referer 发 API，取到 url 直接交给 `<video>`，全程无 proxy/localhost）。
 *  5. ✅ 该 mp4 是**音视频合一的整片**：拉完整 `moov` 实测 `trak=2`、`soun`+`vide` 都在、
 *     `mp4a`+`avc1` 俱全 ⇒ 有声音，⛔ 不是纯视频分片。
 *  6. 画质：`platform=html5` 实测 `accept_quality=[64,16]`，`qn≥64` 一律回报 `quality=64`（720P）。
 *     1080P 需要 Cookie + 非 html5 口径（那条路仍要 Referer 代理），本项目暂不提供。
 *
 * ⚠️ 本模块**不联网、不碰 Cookie 值**，只做字符串/JSON 层面的构造与解析。
 */

/** B 站接口要求的浏览器 UA（缺了会被风控直接拒） */
export const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** B 站接口与 CDN 都要求的 Referer（**这是直链能播的唯一原因**，见文件头第 4 条） */
export const BILI_REFERER = 'https://www.bilibili.com';

/** `pure/biliEmbed.ts` 里同一口径的片号提取；这里**不重复实现**，由调用方传入 bvid/epId/ssId */
export interface BiliIds {
    bvid?: string;
    /**
     * 旧版 `av` 号（`/video/av80433022`、`b23.tv/av80433022`）。
     *
     * 🔴 为什么需要它：`b23.tv` 官方文档列的 3 种短链里就有 av 形态，真机实测它的落地页
     *    `https://www.bilibili.com/video/av80433022/` **只带 aid、不带 BV** ⇒ 静态解析不可能拿到 bvid。
     *    `pagelist?aid=` 与 `playurl?avid=` 实测都能用（200 / `code:0` / `quality:64`），
     *    所以 aid 是**和 bvid 平级的一等入参**，⛔ 不是「先转成 BV 才能用」的二等公民。
     * ⚠️ 与 `bvid` 互斥：一个链接要么给 BV 要么给 av，两个都给说明上游解析写错了。
     */
    aid?: number;
    /** 番剧单集 id */
    epId?: number;
    /** 番剧整季 id（播放器自动落到第 1 集） */
    ssId?: number;
    /** 第几 P（1 基；`?p=3`） */
    page: number;
}

/**
 * 取 `cid` 的接口地址。
 * - 普通投稿：`x/player/pagelist?bvid=…&p=…` —— 返回**每一 P 一条**，取第 `page` 条；
 * - 番剧：`x/player/pagelist` 不认 ep/ss，改用 `x/player/wbi/v2` 之外的公开路 `pgc/view/web/season`。
 *   ⚠️ 番剧接口需要 `ep_id` / `season_id`，两者都没有 ⇒ 返回 `null`（调用方回退 iframe）。
 */
export function biliPagelistUrl(ids: BiliIds): string | null {
    if (ids.bvid) return `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(ids.bvid)}`;
    if (ids.epId) return `https://api.bilibili.com/pgc/view/web/season?ep_id=${ids.epId}`;
    if (ids.ssId) return `https://api.bilibili.com/pgc/view/web/season?season_id=${ids.ssId}`;
    return null;
}

/**
 * 从任意 B 站接口 JSON 里读出「失败原因」的人话；成功或无信息 = `null`。
 *
 * 🔴 为什么需要这个：`biliStreamFor` 原来有六处 `return null`（见 `main.ts` 里那段注释），
 *    一处都不留话 ⇒ 宿主只能把用户静默踢去浏览器。用户视角完全分不清
 *    「稿子被删了」和「插件坏了」（用户 m02763 报障原话：「网络集用插件播放器加载不出来」）。
 *    真机实测（2026-11-15）两条报障条目直查 `x/web-interface/view`：
 *    `code=62002 msg="稿件不可见"` ⇒ 稿子没了，取流失败是**正确行为**，缺的只是解释。
 *
 * ⚠️ 只做翻译、不做判断：返回 null 表示「这里没有可说的」，调用方自己决定用什么兜底文案。
 * ⛔ 不要把它当成「该不该失败」的判据 —— 判定仍然在各个 `pick*` 函数里。
 */
export function biliFailMessage(json: unknown): string | null {
    const o = json as { code?: unknown; message?: unknown; msg?: unknown };
    const code = typeof o?.code === 'number' ? o.code : null;
    const raw = typeof o?.message === 'string' ? o.message : (typeof o?.msg === 'string' ? o.msg : '');
    const msg = raw.trim();
    if (code === null || code === 0) return null;
    // 稿件级不可用：删稿 / 私享 / 版权地区限制 / 审核中，用户做什么都没用，只能换源
    if (code === 62002 || code === 62004 || code === -404) {
        return `这个稿件现在看不了（${msg || `code ${code}`}）—— 可能在 B 站被删除、设为私享，或本地区不可见`;
    }
    if (code === -403 || code === 403) return 'B 站拒绝了这次请求（可能需要重新登录或补 Cookie）';
    if (code === -352 || code === 412) return 'B 站风控拦了这次请求（请求太密，稍后再试）';
    return `B 站返回 ${code}${msg ? `：${msg}` : ''}`;
}

/** 从 pagelist JSON 里取第 `page`（1 基）P 的 cid；取不到 = `null` */
export function pickCidFromPagelist(json: unknown, page = 1): number | null {
    const data = (json as { data?: unknown })?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    const i = Math.min(Math.max(1, Math.floor(page || 1)) - 1, data.length - 1);
    const cid = (data[i] as { cid?: unknown })?.cid;
    return typeof cid === 'number' && Number.isFinite(cid) ? cid : null;
}

/**
 * `av` 号 → 视频详情接口（**一条请求同时拿到 bvid 和每 P 的 cid**）。
 *
 * 🔴 为什么用它而不是 `pagelist?aid=`：`pagelist` 只回 cid 不回 bvid，而 `playurl` 的
 *    主参要 bvid ⇒ 得再打一次才凑得齐。真机实测 `view?aid=80433022` ⇒ `code:0`，
 *    `data.bvid='BV1GJ411x7h7'`、`data.pages[0].cid=137649199` —— 一次到位。
 * ⚠️ 只用于「链接里只有 `av` 号」这一种情况：有 bvid 时走 `pagelist`，⛔ 别为同一个 cid 白打一次。
 */
export function biliViewUrl(aid: number): string {
    return `https://api.bilibili.com/x/web-interface/view?aid=${Math.floor(aid)}`;
}

/**
 * 从 `view?aid=` JSON 里取「归一后的 bvid + 第 `page` P 的 cid」；取不到 = `null`。
 *
 * `pages[]` 是**每一 P 一条**（单 P 视频也有一条）；没有 `pages` 则退回顶层 `cid`/`bvid`
 * （接口对部分老视频只给顶层字段）。⛔ 两样缺一样都算失败 —— 少了 bvid 就调不了 `playurl`。
 */
export function pickViewByAid(json: unknown, page = 1): { cid: number; bvid: string } | null {
    const o = json as { code?: unknown; data?: unknown };
    if (o?.code !== 0) return null;
    const d = o.data as { bvid?: unknown; cid?: unknown; pages?: unknown } | undefined;
    if (!d) return null;
    const bvid = typeof d.bvid === 'string' && d.bvid ? d.bvid : '';
    if (!bvid) return null;
    const pages = d.pages;
    if (Array.isArray(pages) && pages.length > 0) {
        const i = Math.min(Math.max(1, Math.floor(page || 1)) - 1, pages.length - 1);
        const cid = (pages[i] as { cid?: unknown })?.cid;
        return typeof cid === 'number' && Number.isFinite(cid) ? { cid, bvid } : null;
    }
    return typeof d.cid === 'number' && Number.isFinite(d.cid) ? { cid: d.cid, bvid } : null;
}

/**
 * 从番剧 `pgc/view/web/season` JSON 里取 cid 与它对应的 bvid。
 * 🔴 番剧的 `episodes[]` 每项同时带 `cid` 和 `bvid` —— 拿 cid 却丢 bvid 就调不了 `playurl`。
 * `epId` 有值 ⇒ 精确命中那一集；否则取第 1 集（`ss` 整季的语义）。
 */
export function pickPgcEpisode(json: unknown, epId?: number): { cid: number; bvid: string } | null {
    const eps = (json as { result?: unknown })?.result;
    const list = (eps as { episodes?: unknown })?.episodes;
    if (!Array.isArray(list) || list.length === 0) return null;
    const norm = list.map((e) => e as { cid?: unknown; bvid?: unknown; ep_id?: unknown });
    const hit = (typeof epId === 'number'
        ? norm.find((e) => e.ep_id === epId)
        : undefined) ?? norm[0];
    const cid = hit?.cid;
    const bvid = hit?.bvid;
    if (typeof cid !== 'number' || !Number.isFinite(cid)) return null;
    if (typeof bvid !== 'string' || !bvid) return null;
    return { cid, bvid };
}

/**
 * Cookie 是否「看起来像一条 SESSDATA 串」。
 *
 * ⚠️ 只做**形状**校验，⛔ 不联网验证 —— 过期 Cookie 与有效 Cookie 长得一样，
 *    真假只能靠 `playurl` 的返回码判（见 `pickBiliStream` 的 `code !== 0`）。
 * 为什么必须校验：用户往往会连「SESSDATA=」前缀一起粘，或粘成整段 `Cookie:` 头。
 */
export function looksLikeCookie(raw: string | undefined | null): boolean {
    if (typeof raw !== 'string') return false;
    const t = raw.trim();
    if (t.length < 8) return false;
    // 换行/制表/其它控制字符一律拒绝：那说明用户粘的是多行文本（或整段抓包），拼进请求头会直接炸
    if (/[\x00-\x1f\x7f]/.test(t)) return false;
    // 有 `名字=` 结构 = 整段 cookie 串：允许 `; ` 这种分隔空格（`SESSDATA=a; bili_jct=b` 是常态）
    if (/[A-Za-z0-9_]+\s*=/.test(t)) return true;
    // 没有 `=` = 裸 SESSDATA 值：必须是可打印 token，出现空格就说明不是值（如 `a b c d e f g h`）
    return /^[\x21-\x7e]+$/.test(t);
}

/**
 * 把用户填的东西规整成可直接放进 `Cookie` 头的串。
 * - 整段 `SESSDATA=xxx; bili_jct=yyy` ⇒ 原样（去掉 `Cookie:` 前缀与换行）；
 * - 只有裸值 ⇒ 补成 `SESSDATA=裸值`。
 */
export function normalizeCookie(raw: string | undefined | null): string {
    if (!looksLikeCookie(raw)) return '';
    let t = String(raw).trim().replace(/\r?\n/g, ' ');
    t = t.replace(/^cookie\s*:\s*/i, '').trim();
    if (!t) return '';
    // 没有 `名字=` 结构 ⇒ 当成裸 SESSDATA 值
    if (!/[A-Za-z0-9_]+\s*=/.test(t)) return `SESSDATA=${t}`;
    return t;
}
