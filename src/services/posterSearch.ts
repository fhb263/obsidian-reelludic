/**
 * 封面图片搜索服务层（#498，2026-10-03）—— 只做「发请求 + 拼装」，
 * 地址构造与解析全在 `pure/posterSearch`（可单测）。
 *
 * 🔴 实测（2026-10-03，真请求）：
 *  · `GET https://cn.bing.com/images/async?q=…&first=1&count=35&mmasync=1`
 *    + `User-Agent`（浏览器）+ `Accept-Language: zh-CN` ⇒ **200 + 35 条**；
 *    **不需要 Cookie、不需要 Referer、不需要任何 Key**（`Referer` 加不加都一样，本层就不加）。
 *  · `www.bing.com` 在本机 302 到 `cn.bing.com` ⇒ 地址直接写 cn，少一跳。
 *  · 百度 / Google / DuckDuckGo 都**不可用**（前者 `Forbid spider access`，后两者本机不可达）⇒ ⛔ 别接。
 *
 * 🔴 **空结果不算失败**（与 #496 的 B站 同口径）：`{ candidates: [] }` 且不带 `error` ⇒
 *    由界面说「没搜到，换个关键词」，⛔ 别把它写成错误 —— 用户看到「失败」会以为插件坏了。
 *
 * ⚠️ 传输层注入（`get`），与 `services/dl` 同一套写法：单测给假实现就能覆盖
 *    HTTP 码 / 空壳页 / 抛错三条分支，不必真联网。
 */
import {
    buildBingImageUrl,
    parseBingImages,
    usablePosterCandidates,
    type PosterCandidate,
} from 'pure/posterSearch';

/** 浏览器 UA（必应对无 UA 的请求会回风控页；照抄一个常见 Chrome 串即可） */
export const POSTER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** 这一层需要的传输能力（真源 = `nodeHttpGet`；单测注入假实现） */
export interface PosterSearchTransport {
    get: (
        url: string,
        headers?: Record<string, string>,
    ) => Promise<{ status: number; text: string } | null | undefined>;
}

/**
 * 搜封面候选图。
 * @param page 从 1 起（分页口径见 `pure/posterSearch.buildBingImageUrl`）
 * @returns `error` 只在**真失败**时出现；搜到 0 条 ⇒ `{ candidates: [] }`（无 error）
 */
export async function searchPosterImages(
    t: PosterSearchTransport,
    query: string,
    page: number = 1,
): Promise<{ candidates: PosterCandidate[]; error?: string }> {
    const q = String(query ?? '').trim();
    if (!q) return { candidates: [], error: '先填搜索词（默认用条目标题，可以改）' };
    try {
        const res = await t.get(buildBingImageUrl(q, page), {
            'User-Agent': POSTER_UA,
            'Accept-Language': 'zh-CN,zh;q=0.9',
        });
        if (!res) return { candidates: [], error: '图片搜索请求没有返回内容（检查网络或代理）' };
        if (res.status < 200 || res.status >= 300) {
            return { candidates: [], error: `图片搜索失败（HTTP ${res.status}）` };
        }
        // ⚠️ 必应偶尔会回一个不含结果卡片的空壳页（此时解析出来就是空，不是错）
        return { candidates: usablePosterCandidates(parseBingImages(res.text)) };
    } catch (e) {
        return { candidates: [], error: `图片搜索失败：${e instanceof Error ? e.message : String(e)}` };
    }
}
