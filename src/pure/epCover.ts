// 选集弹窗封面的**纯逻辑**（#577）—— 只算地址，⛔ 不碰 DOM / 网络 / 缓存。
//
// 用户（2026-10-09「三、选集弹窗重构」）：
//   ⑵ **封面获取策略（P0）**：本地视频 → 「直接渲染首帧或默认图」；网络视频 → 「优先通过平台 API 获取
//      （如 B站），获取失败时**必须**显示统一的默认占位图」；
//   ⑶ **缩略图截取（P0）**：「B站直链**必须**加上 `@320w_200h_1c.webp` 后缀拿缩略图，**禁止直接使用原图**」；
//   ⑶' **缓存（P0）**：「封面 CDN 链接**不要加时间戳**破坏 HTTP 缓存」。
//
// 🔴 分层：本模块只出**计划**（`EpCoverPlan`）—— 网络请求与内存缓存都在宿主
//    （`main.epCoverFor` / `main.biliThumb`）：弹窗摸不到 vault / service，只负责渲染。
// 🔴 **统一占位图** = `{ kind: 'none' }`（弹窗画一枚灰底图标）—— ⛔ 不显示破图、不编假地址。

/** B 站图床的缩略图处理参数（用户点名的这一档；⛔ 别自作主张换尺寸 / 换格式） */
export const BILI_THUMB_SUFFIX = '@320w_200h_1c.webp';

/**
 * 相邻两次 B 站封面请求的**最小间隔**（毫秒）。
 * 🔴 `view` 接口实测吃风控（不带 Cookie 直接 412）⇒ 52 集一起打必然出事：
 *    封面请求一律**串行**，且每条之间至少等这么久（成败都等 —— 风控不看你上一条成不成）。
 */
export const EP_COVER_GAP_MS = 260;

/**
 * 给 B 站封面地址挂**缩略图**参数。
 *  - **幂等**：路径段里已有图床处理参数（`@`）⇒ 原样返回 —— 叠成 `a.jpg@x@y` 图床会判非法参数；
 *  - 后缀插在 **query / hash 之前**（`…/a.jpg@320w…?v=1`），⛔ 不是拼到最尾（那会变成 query 值的一部分）；
 *  - 非 http(s)（空串 / 本地相对路径）⇒ **原样返回**（「它是不是 B 站图床」的判据在调用方，本函数不猜）。
 */
export function biliThumbUrl(raw: unknown): string {
    const s = String(raw ?? '').trim();
    if (!s || !/^https?:\/\//i.test(s)) return s;
    const cut = s.search(/[?#]/);
    const head = cut < 0 ? s : s.slice(0, cut);
    const tail = cut < 0 ? '' : s.slice(cut);
    if (head.includes('@')) return s;
    return `${head}${BILI_THUMB_SUFFIX}${tail}`;
}

/**
 * 一集的封面计划：
 *  - `img` = 直接可塞进 `<img>` 的图片地址；
 *  - `video` = **本地视频**（弹窗自己建 `<video preload="metadata">` 渲染首帧）；
 *  - `none` = 统一占位图。
 */
export type EpCoverPlan = { kind: 'img'; src: string } | { kind: 'video'; src: string } | { kind: 'none' };

/**
 * 定封面计划（**本地优先**，与全仓「本地恒在最前」同一条口径）：
 * 本地视频能定位到 ⇒ 首帧；否则有网络图片 ⇒ 用它；都没有 ⇒ 占位图。
 *
 * ⚠️ 两个入参都是**地址**（本地那个是 `resolveEmbedUrl` 的产物），本函数**不判断来源**：
 *    本地文件定位不到时宿主传空串，自然落到下一档（能力回落，⛔ 别把能用的路堵死）。
 */
export function planEpCover(localSrc?: unknown, imgSrc?: unknown): EpCoverPlan {
    const l = String(localSrc ?? '').trim();
    if (l) return { kind: 'video', src: l };
    const i = String(imgSrc ?? '').trim();
    if (i) return { kind: 'img', src: i };
    return { kind: 'none' };
}
