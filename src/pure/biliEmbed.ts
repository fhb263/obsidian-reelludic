/**
 * B 站外链 → 可内嵌播放地址（纯逻辑；无 obsidian 依赖，可单测）。
 *
 * 🔴 用户需求（2026-11-02）：「能不能做个外链网络链接如 b 站内嵌到播放器播放」。
 *    用户裁定两件事：①**就地内嵌播放，失败自动降级开浏览器**；②**只做 B 站**。
 *
 * 🧪 真机实测结论（CDP 插 iframe 实测，不是查文档猜的）：
 *    · `player.bilibili.com/player.html?bvid=…` 在 Obsidian 里**真实渲染并播放**，
 *      播放条走到 `00:01 / 03:33`；`?page=2` 确实跳到第 2 P（画面标题变了）。
 *    · 直连 `fetch` 405ms 返回（`type: opaque`）⇒ B 站这条路是通的。
 *
 * 🔴🔴 下面这条 2026-11-02 的旧结论**已于 2026-11-24 实测推翻，别再当依据**：
 *    原文写的是「YouTube `/embed/` 在这台机器**网络不可达**（`fetch` 10 秒失败），⛔ 不做」。
 *    当天（m05486）重测：`https://www.youtube.com/` HEAD → **HTTP 200 in 994ms**，
 *    系统代理 `127.0.0.1:7897` 生效 ⇒ 网络是通的。
 *    ⚠️ 所以「YouTube 播不了」**不是可达性问题**，⛔ 别再拿这条旧注释去解释故障；
 *    真正的排查方向见 `services/embedCookie` 的登录态写入链路。
 *
 * ⚠️ 跨域 iframe **读不到** `contentDocument`（实测 `docAccessible:false`）⇒ 拿不到播放进度，
 *    字幕时间轴对网络集不可用。这是内嵌的固有代价，界面要如实呈现，⛔ 不假装能跟随。
 *
 * ⛔ 不做「通用 iframe 任意站点」：多数站点用 `X-Frame-Options` / CSP 拒绝被嵌，表现是白屏，
 *    那种白屏用户会当成插件坏了。只认明确允许嵌入的 B 站。
 */

/** B 站播放器域名（内嵌态识别用） */
export const BILI_PLAYER_HOST = 'player.bilibili.com';

import type { BiliIds } from 'pure/biliPlay';

/** `BV` + 10 位 base58（与 `pure/linkStatus.bvidOf` 同一口径） */
const BVID_RE = /BV[0-9A-Za-z]{10}/;
/**
 * 旧版 `av` 号（`/video/av80433022`、`b23.tv/av80433022`）。
 *
 * 🔴 为什么要认：`b23.tv` 官方文档列了 **3 种**短链格式，其中就有 av 形态
 *    （见 https://github.com/pskdje/bilibili-API-collect/blob/main/docs/misc/b23tv.md）。
 *    真机实测 `https://b23.tv/av80433022` ⇒ 302 ⇒ `https://www.bilibili.com/video/av80433022/`
 *    —— 落地页本身就只带 aid，**静态永远抠不出 BV** ⇒ 不认 aid 这条链接就彻底用不了。
 * ⚠️ 只认 `av` + 数字，⛔ 别放宽成 `/a\d+`：那会误伤 `/anime/…` 之类的路径。
 */
const AVID_RE = /\/av(\d+)/;
/** 番剧 `ep_id`（`/bangumi/play/ep123456`） */
const EP_ID_RE = /\/ep(\d+)/;
/** 番剧 `ss_id`（`/bangumi/play/ss12345`，整季 → 播放器自动落到第 1 集） */
const SS_ID_RE = /\/ss(\d+)/;

/** 只认 B 站域名（含 `b23.tv` 短链、`m.bilibili.com` 移动端）；别的站点一律不碰 */
function isBiliHost(url: string): boolean {
    return /(^|\/\/|\.)bilibili\.com/i.test(url) || /(^|\/\/|\.)b23\.tv/i.test(url);
}

/**
 * 是不是 `b23.tv` 短链（**需要联网跳一次**才知道落地页）。
 *
 * 🔴 为什么单列一个判断：静态正则抠不出短码里的 BV（手机分享的 `b23.tv/AbCd123` 根本不含号），
 *    只有宿主侧的 `nodeHttpGet` 跟随重定向后回报的 `finalUrl` 才有落地页
 *    ⇒ 调用方据此决定「先跳再解析」，别的域名一次网络请求都不发。
 */
export function isBiliShortUrl(url: unknown): boolean {
    return typeof url === 'string' && /(^|\/\/|\.)b23\.tv/i.test(url);
}

/** `?p=3` 里的页码；没有 / 脏值 → 1（B 站默认第 1 P） */
function pageParam(url: string): number {
    const m = /[?&]p=(\d+)/.exec(url);
    const n = m ? Number(m[1]) : 1;
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * 外链 → 内嵌播放地址；**不能内嵌** ⇒ `null`（调用方退回「开浏览器」）。
 *
 * 认这几种形态（都是实测过的真实存法）：
 *  1. `https://www.bilibili.com/video/BV1xx411c7mD?p=2` → `…?bvid=BV1xx411c7mD&page=2`
 *  2. `https://m.bilibili.com/video/BV1xx411c7mD`       → 同上（移动端同号）
 *  3. `https://www.bilibili.com/bangumi/play/ep123456`  → `…?ep_id=123456`
 *  4. `https://www.bilibili.com/bangumi/play/ss12345`   → `…?season_id=12345`
 *  5. 已经是 `player.bilibili.com/player.html?...`       → 规范化后原样放行
 *
 * ⛔ 明确返回 `null` 的：
 *  · 非 http(s)（本地路径 / 空 / `"1"` 这种脏数据 —— 库里实测存在，拼不出合法地址）
 *  · 短链 `b23.tv/xxx`（要联网跳转才知道落地，静态解析不出来 ⇒ 交给浏览器）
 *  · 取不到 `BV` 号也取不到 `ep`/`ss` 号的 B 站页面（如专栏、直播、空间）
 */
export function biliEmbedUrl(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    const raw = url.trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    if (!isBiliHost(raw)) return null;

    // 已经是内嵌地址：只把 `autoplay` 统一成 1，与 `netInline.ts` 的 YouTube 内嵌同口径（点开就播）。
    //
    // 🔴 2026-11-10 真机 A/B 更正：这里原本写的是 `0`，理由记的是「自动播放在 Electron 里多半被拦，
    //    留着只会闪一下黑屏」—— **那句话是猜的，实测不成立**。
    //    `tools/probe-ab-autoplay.mjs` 拿 Electron 媒体事件当判据（跨域 iframe 是 OOPIF，
    //    主 session 的 Network 看不见内部媒体分片，第一版用 `Network.requestWillBeSent` 白跑了）：
    //      autoplay=0 ⇒ `media-started-playing` 一次都不来，`isCurrentlyAudible()` 12 秒内 6/6 采样全 false
    //      autoplay=1 ⇒ `media-started-playing` 立刻触发，6/6 采样全 true
    //    ⇒ Electron 放行自动播放。用户的原话是「怎么点击不是立即播放的，还要再点屏幕播放器才能播放」。
    // ⛔ 别再把这里改回 0：改一次用户就得再点一次才播。要验就重跑上面那个探针，别拍脑袋。
    if (raw.includes(BILI_PLAYER_HOST)) {
        const u = new URL(raw);
        if (!u.searchParams.get('bvid') && !u.searchParams.get('ep_id') && !u.searchParams.get('season_id')) {
            return null;
        }
        u.searchParams.set('autoplay', '1');
        return u.toString();
    }

    const bv = BVID_RE.exec(raw)?.[0];
    if (bv) {
        const q = new URLSearchParams({
            bvid: bv,
            page: String(pageParam(raw)),
            autoplay: '1',
            high_quality: '1',
            as_wide: '1',
            danmaku: '1',
        });
        return `https://${BILI_PLAYER_HOST}/player.html?${q.toString()}`;
    }

    const av = AVID_RE.exec(raw)?.[1];
    if (av) {
        // 🔴 只给 `aid`：`b23.tv` 官方文档的 av 形态与 `/video/av…` 落地页都只带 aid。
        //    真机实测 `player.html?aid=…` 与 `?bvid=…` 返回**同一个播放器壳**（同为 200、同样 6723 字节），
        //    但壳相同**证明不了** aid 一定被播放（两条路都只看得到外壳）⇒ 这条只是 iframe 兜底，
        //    真正能播的路径是原生流：宿主用 `view?aid=` 把 aid 归一成 cid+bvid 后取 playurl。
        const q = new URLSearchParams({
            aid: av,
            page: String(pageParam(raw)),
            autoplay: '1',
            high_quality: '1',
            as_wide: '1',
            danmaku: '1',
        });
        return `https://${BILI_PLAYER_HOST}/player.html?${q.toString()}`;
    }

    const ep = EP_ID_RE.exec(raw)?.[1];
    if (ep) {
        const q = new URLSearchParams({
            ep_id: ep,
            autoplay: '1',
            high_quality: '1',
            as_wide: '1',
            danmaku: '1',
        });
        return `https://${BILI_PLAYER_HOST}/player.html?${q.toString()}`;
    }

    const ss = SS_ID_RE.exec(raw)?.[1];
    if (ss) {
        const q = new URLSearchParams({
            season_id: ss,
            autoplay: '1',
            high_quality: '1',
            as_wide: '1',
            danmaku: '1',
        });
        return `https://${BILI_PLAYER_HOST}/player.html?${q.toString()}`;
    }

    return null;
}

/** 这条链接能不能就地内嵌（= `biliEmbedUrl` 是否给出地址）。 */
export function canEmbedBili(url: unknown): boolean {
    return biliEmbedUrl(url) !== null;
}

/**
 * 从外链里拆出**取流需要的**标识（`bvid` / `ep_id` / `season_id` / 第几 P）。
 *
 * 🔴 为什么不复用 `biliEmbedUrl` 的返回值：那函数产出的是**内嵌页地址**（`player.html?…`），
 *    而取 `playurl` 要的是 `cid`，得先拿 `bvid`/`ep`/`ss` 去打 `pagelist` / `pgc/view` ——
 *    两者的入参虽然同源，出品完全不同，硬从内嵌地址里反解等于绕一圈还容易漏。
 * ⛔ **不含片号的**短链 `b23.tv/xxxx` 一律 `null`：要联网跳转才知道落地页，静态解析给不出。
 *    但 `b23.tv/BV1xx…` / `b23.tv/ep123` 这类**短域名上仍带片号**的形态可以就地解析 ——
 *    函数下面照常往下走正则，⛔ 别一见到 `b23.tv` 就整段拒掉（那会把能认的一并误杀）。
 */
export function biliIdsOf(url: unknown): BiliIds | null {
    if (typeof url !== 'string') return null;
    const raw = url.trim();
    if (!/^https?:\/\//i.test(raw)) return null;
    if (!isBiliHost(raw)) return null;

    // 已经是内嵌页地址：参数就在 query 里
    if (raw.includes(BILI_PLAYER_HOST)) {
        const u = new URL(raw);
        const bvid = u.searchParams.get('bvid') ?? undefined;
        const ep = u.searchParams.get('ep_id');
        const ss = u.searchParams.get('season_id');
        const page = Number(u.searchParams.get('page') ?? '1');
        return {
            bvid: bvid && BVID_RE.test(bvid) ? bvid : undefined,
            epId: ep && /^\d+$/.test(ep) ? Number(ep) : undefined,
            ssId: ss && /^\d+$/.test(ss) ? Number(ss) : undefined,
            page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
        };
    }

    const bv = BVID_RE.exec(raw)?.[0];
    if (bv) return { bvid: bv, page: pageParam(raw) };
    const av = AVID_RE.exec(raw)?.[1];
    if (av) return { aid: Number(av), page: pageParam(raw) };
    const ep = EP_ID_RE.exec(raw)?.[1];
    if (ep) return { epId: Number(ep), page: 1 };
    const ss = SS_ID_RE.exec(raw)?.[1];
    if (ss) return { ssId: Number(ss), page: 1 };
    return null;
}

/**
 * 内嵌加载超时（毫秒）。
 *
 * 🔴 为什么是 8 秒：B 站播放器真机实测 **405ms** 就返回了 ⇒ 8 秒还 `load` 没动的，
 *    基本就是网络不通 / 被墙，不是「慢」。再等下去用户只会盯着黑屏。
 * ⚠️ 必须知道的局限：`X-Frame-Options` 拒绝被嵌时 Chrome **仍会**触发 `load`
 *    （加载到的是错误页）⇒ 超时**抓不到**这种失败。所以界面必须同时常留一个
 *    「在浏览器打开」按钮 —— 那是唯一 100% 可靠的兜底，⛔ 不要假装超时能覆盖全部失败。
 */
export const EMBED_LOAD_TIMEOUT = 8000;

/**
 * 🔴 2026-11-10 删除：原 `NET_CUE_HINT`（「这集回退成了 B 站内嵌…跨域读不到播放进度…」）。
 *
 * 两层都站不住了：
 *  ① 文案写死「B 站」，在 YouTube 集上整段是错的（用户「播放youtube网络集时字幕空状态怎么是这个样的」）；
 *  ② 「跨域读不到播放进度」是**猜的、已被真机证伪** —— `services/embedVideo` 走
 *     `framesInSubtree` + `executeJavaScript` 读写 `currentTime` 两边都通。
 * ⇒ 空态文案改成**平台化**、由 `EpisodePageView.buildCueNetUnavailable` 就地生成
 *   （和那颗「去 XX 看这一集」按钮同源），⛔ 不再放常量里让两边口径漂。
 */

/**
 * 内嵌层顶部工具条的文案。
 *
 * 🔴 用户 2026-11-03 明确否掉「B 站内嵌」这个说法：他要的是**插件自己的播放器**播 B 站流，
 *    不是 B 站 iframe。工具条原来写「B 站内嵌播放」⇒ 用户一看标题就以为在塞 iframe。
 *    现在按**实际播放面**分两套文案，⛔ 不许只留一套糊过去：
 *    - `NET_BAR_TITLE`：拿到直链、用自有 `<video>` 播（绝大多数情况）
 *    - `NET_BAR_TITLE_FRAME`：取流失败、真回退 B 站 iframe 时才用
 */
export const NET_BAR_TITLE = 'B 站直连播放';
export const NET_BAR_TITLE_FRAME = 'B 站内嵌（取流失败兜底）';
export const NET_BAR_OPEN = '在浏览器打开';
export const NET_BAR_EXIT = '退出播放';

/** 内嵌加载超时后的降级提示 */
export const NET_LOAD_FAIL = '这个外链没能在播放器里加载出来 — 可能是网络不通，或 UP 主关闭了站外播放';
