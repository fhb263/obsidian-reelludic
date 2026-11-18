/**
 * B 站字幕抓取（含 AI 字幕）——网络集字幕面板的数据来源。
 *
 * 🔴 用户 2026-11-09 逐字：「播放网络集的字幕面板能不能显示其b站的AI字幕」
 *
 * 真机实测（`tools/probe-bili-subtitle-cookie.mjs`）：
 *  - **必须带 Cookie**。匿名请求 `x/player/wbi/v2` 返回 `code:0` 但 `subtitles: []`
 *    —— 接口通、只是没内容；带 SESSDATA 后同一个请求返回 `ai-zh` 轨。
 *  - 字幕轨地址是 `//aisubtitle.hdslb.com/...`（协议相对），取回来的 JSON 是
 *    `{ type:'AIsubtitle', body:[{from,to,content}] }`。
 *
 * ⚠️ 两条纪律（与 `services/biliStream.ts` 同源）：
 *  1. **只读**：只发 GET，不改 B 站任何状态；
 *  2. **失败静默成 `null`**：字幕拿不到不该影响播放，⛔ 别把异常抛到界面。
 */
import { BILI_REFERER, BILI_UA } from 'pure/biliPlay';
import {
    biliCuesToVtt,
    parseBiliSubtitleBody,
    pickBiliSubtitles,
    pickPreferredSubtitle,
    type BiliSubtitleTrack,
} from 'pure/biliSubtitle';

/** 拿到的一份字幕（`text` 已是 VTT，便于面板与 `<track>` 共用同一份解析口径） */
export interface BiliSubtitleFile {
    /** 显示名：如 `AI字幕（中文）` / `中文（人工）` */
    fileName: string;
    /** VTT 文本 */
    text: string;
    /** 是否为 AI 生成 */
    isAi: boolean;
}

/** 取流用的最小传输面（与宿主 `dlTransport()` 同形，便于复用同一套重试/UA） */
export interface SubtitleTransport {
    get: (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>;
}

/**
 * 抓一条视频的字幕。
 *
 * @param cid     B 站分 P id（必填：字幕按 cid 挂，不是按 bvid）
 * @param bvid    视频号（与 cid 二者都要，接口同时校验）
 * @param cookie  用户 Cookie（空串 ⇒ 必然拿不到，这里直接返回 null 省一次请求）
 * @param onDiag  可选诊断回调：把「B 站认不认这次登录」回传给调用方。
 *
 * 🔴 为什么要有 `onDiag`（2026-10-31 用户报「字幕面板获取不到字幕」的教训）：
 *    以前这里取不到字幕一律 `return null`，调用方**分不清**是
 *      · 这集本来就没有字幕（正常，什么都不该说），还是
 *      · Cookie 失效 / B 站按未登录处理（**必须**告诉用户，否则他只会反复粘 Cookie 也修不好）。
 *    实测：`x/player/wbi/v2` 在未登录时回 `login_mid: 0` + `need_login_subtitle: true` +
 *    `subtitles: []`，与「登录了但这集没字幕」的形状**几乎一样**，唯一可靠的判据就是 `login_mid`。
 *    ⛔ 别把「空字幕」直接当「没字幕」—— 那次的真因是插件读的那套 vault 里躺着一个
 *       **已失效的旧 SESSDATA**（另一套 vault 里的才是有效的），接口侧完全正常。
 */
export async function fetchBiliSubtitle(
    t: SubtitleTransport,
    cid: number,
    bvid: string,
    cookie: string,
    onDiag?: (d: { loginMid: number; trackCount: number; needLogin: boolean }) => void,
): Promise<BiliSubtitleFile | null> {
    // ⛔ 没 Cookie 就别发请求：实测匿名一定是 0 条，白等一个来回路
    if (!cookie || !cid || !bvid) return null;
    const headers: Record<string, string> = { 'User-Agent': BILI_UA, Referer: BILI_REFERER, Cookie: cookie };

    const listUrl = `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`;
    let tracks: BiliSubtitleTrack[] = [];
    let loginMid = 0;
    let needLogin = false;
    try {
        const res = await t.get(listUrl, headers);
        if (res.status !== 200) return null;
        const json = JSON.parse(res.text) as { data?: { login_mid?: unknown; need_login_subtitle?: unknown } };
        // 🔴 判据只有 `login_mid`：0 = B 站按未登录处理（Cookie 失效/不对），非 0 = 认了
        loginMid = Number(json?.data?.login_mid ?? 0) || 0;
        needLogin = json?.data?.need_login_subtitle === true;
        tracks = pickBiliSubtitles(json);
    } catch {
        return null; // 风控给 HTML / 网络异常：都当「这集没字幕」，⛔ 不重试不抛
    }
    onDiag?.({ loginMid, trackCount: tracks.length, needLogin });
    const track = pickPreferredSubtitle(tracks);
    if (!track) return null;

    try {
        const body = await t.get(track.url, headers);
        if (body.status !== 200) return null;
        const cues = parseBiliSubtitleBody(JSON.parse(body.text));
        if (!cues.length) return null;
        return {
            fileName: track.isAi ? `AI字幕（${track.lanDoc || '中文'}）` : (track.lanDoc || '中文'),
            text: biliCuesToVtt(cues),
            isAi: track.isAi,
        };
    } catch {
        return null;
    }
}
