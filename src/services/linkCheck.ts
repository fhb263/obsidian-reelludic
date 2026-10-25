/**
 * 剧集链接失效探测（服务层，#527）—— 只做「发请求」，判定与解析全在 `pure/linkStatus`（可单测）。
 *
 * 🔴 并发上限（避免一次 52 集把站点打爆 / 把自己拖死）+ 单个失败**不牵连**（该位记 `unknown`）。
 * ⛔ 只桌面端（走 `DlTransport` → `services/nodeHttp`）。返回数组**与传入下标一一对齐**。
 */
import {
    buildBiliCheckUrl,
    bvidOf,
    isHttpUrl,
    parseBiliCode,
    statusFromBiliCode,
    statusFromHttpStatus,
    LINK_CHECK_UA,
    type LinkStatus,
    type LinkScanTarget,
} from 'pure/linkStatus';
import type { DlTransport } from 'services/dl';

/** 同时探测的最大条数 */
export const LINK_CHECK_CONCURRENCY = 6;

/** 单条探测：B 站走接口判 `code`，其它走 GET 判状态码；任何异常 ⇒ `unknown`（⛔ 不抛）。 */
async function checkOne(t: DlTransport, url: string): Promise<LinkStatus> {
    const bvid = bvidOf(url);
    try {
        if (bvid) {
            const r = await t.get(buildBiliCheckUrl(bvid), {
                'User-Agent': LINK_CHECK_UA,
                Referer: 'https://www.bilibili.com/',
            });
            if (!r || r.status < 200 || r.status >= 300) return 'unknown';
            return statusFromBiliCode(parseBiliCode(r.text));
        }
        const r = await t.get(url, { 'User-Agent': LINK_CHECK_UA });
        return statusFromHttpStatus(r?.status);
    } catch {
        return 'unknown';
    }
}

/**
 * 批量探测 `urls`（与下标对齐；非 http(s) / 空位 → `undefined`）。
 * 只对 `isHttpUrl` 的位发请求；其余原样留空。
 *
 * 🔴 2026-10-25 用户指令（「失效链接：先弹窗再陆续显示检测到的失效链接」）：
 *    第 3 参 `onResult(i, status)` 是**逐条**回调，每探完一条就报一次 —— 调用方据此边跑边渲染，
 *    ⛔ 不要改成「等 Promise.all 收完再一次性回调」，那等于没做渐进显示。
 *    并发语义不变：仍是全局 `LINK_CHECK_CONCURRENCY` 路上限，回调在各自 worker 里同步触发。
 */
export async function checkEpisodeLinks(
    t: DlTransport,
    urls: (string | undefined)[],
    onResult?: (index: number, status: LinkStatus | undefined) => void,
): Promise<(LinkStatus | undefined)[]> {
    const out: (LinkStatus | undefined)[] = Array.from({ length: urls.length }, () => undefined);
    const targets: number[] = [];
    urls.forEach((u, i) => {
        if (isHttpUrl(u)) targets.push(i);
    });
    let cursor = 0;
    const worker = async (): Promise<void> => {
        while (cursor < targets.length) {
            const i = targets[cursor++];
            const st = await checkOne(t, (urls[i] ?? '').trim());
            out[i] = st;
            // 回调放在赋值之后：调用方读 out 或只读参数都能对上
            onResult?.(i, st);
        }
    };
    const workers = Array.from({ length: Math.min(LINK_CHECK_CONCURRENCY, targets.length) }, () => worker());
    await Promise.all(workers);
    return out;
}

/** 全库扫描的一行结果 */
export interface LinkScanResult {
    entryId: string;
    /** 与该条目 `episodeUrls` 下标对齐 */
    statuses: (LinkStatus | undefined)[];
}

/**
 * #531 **全库**探测（设置页那枚「检测失效链接」）。
 * 🔴 把所有条目的地址**摊平成一条队列**再跑 `checkEpisodeLinks` —— 这样并发上限是**全局 6**，
 *    ⛔ 不是「每条目各开 6 路」（100 个条目就会同时压 600 个请求）。
 * 返回按传入顺序一一对应；空 `targets` → `[]`（一个请求都不发）。
 */
export async function checkAllLinks(
    t: DlTransport,
    targets: LinkScanTarget[],
    onRow?: (entryId: string, statuses: (LinkStatus | undefined)[]) => void,
): Promise<LinkScanResult[]> {
    if (targets.length === 0) return [];
    const flat: string[] = [];
    const map: { entryId: string; start: number; len: number }[] = [];
    for (const tg of targets) {
        map.push({ entryId: tg.entryId, start: flat.length, len: tg.urls.length });
        for (const u of tg.urls) flat.push(u ?? '');
    }
    // 摊平后的下标 → 属于哪一行（渐进回调要用它把「第几条 URL」还原成「哪个条目」）
    const owner = new Map<number, { entryId: string; start: number; len: number }>();
    for (const m of map) {
        for (let i = m.start; i < m.start + m.len; i++) owner.set(i, m);
    }
    // ⚠️ 必须自己维护一份**可变的**形状数组：`checkEpisodeLinks` 的返回值在
    //    `await` 落定前是 TDZ 不可读，回调里只能读这份边填边读的副本。
    const live: (LinkStatus | undefined)[] = Array.from({ length: flat.length }, () => undefined);
    const all = await checkEpisodeLinks(t, flat, (i, st) => {
        live[i] = st;
        const m = owner.get(i);
        if (!m || !onRow) return;
        // 该行此刻的完整状态数组（未探到的位仍是 undefined）——调用方按 need 自行判 dead
        onRow(m.entryId, live.slice(m.start, m.start + m.len));
    });
    return map.map((m) => ({ entryId: m.entryId, statuses: all.slice(m.start, m.start + m.len) }));
}
