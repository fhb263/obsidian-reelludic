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

/**
 * 🔴 2026-11-17 用户报障（⑥-A）：「按一下后误退出仍显示『检测中』、最终无结果弹窗」。
 *
 * 根因（已核实，⛔ 不是文案问题）：`DlTransport.get` 最终落到 `services/nodeHttp.nodeHttpGet`，
 * 而那里的 `TIMEOUT_MS = 30_000` 是 **socket 空闲超时**（`req.setTimeout`，socket 上多久没数据），
 * ⛔ 不是「整条请求的截止时间」；重定向链（`requestOnce` 的 while）每跳**重新计**一次。
 * ⇒ 一条只握手不回包的地址，能把单个 worker 拖到几十秒；6 路 worker 全被这样卡住时，
 *    整个 `checkAllLinks` 的 Promise 长时间不落定，设置页的 `.finally` 永不执行：
 *    按钮就永远停在「检测中…」且一直 disabled，弹窗也永远等不到 `finishScan`。
 *
 * 修法：在**判定层**（本文件）加一层硬截止 `Promise.race`，⛔ 不动 nodeHttp 的全局超时
 * （那会让「测试连接」等所有请求一起变迟钝，见其文件头注释）。
 * ⚠️ 超时记 `unknown`（与网络异常同档），⛔ 不记 `dead` —— 超时 ≠ 失效，记 dead 会诱导用户
 *    把好好的地址一键清掉（`clearDeadLinks` 只清 dead，这条口径必须守住）。
 */
export const LINK_CHECK_TIMEOUT_MS = 12_000;

/** 停止信号：`stopped` 一置 true，各 worker 在**下一轮取任务前**收手（在途那条仍会跑完/超时） */
export interface LinkCheckStopSignal {
    stopped: boolean;
}

/**
 * 给任意 Promise 套一个硬截止：超时 / 抛错都回落到 `fallback`（⛔ 绝不让单条拖死全场）。
 * ⚠️ 这里**必须**用 `Promise.race` 语义而不能去给 `nodeHttpGet` 传 timeout：
 *    `DlTransport.get` 的签名只有 `(url, headers)`，改签名会波及 20+ 处调用方。
 */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: null): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (v: T | null): void => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            resolve(v);
        };
        timer = setTimeout(() => done(fallback), ms);
        p.then((v) => done(v), () => done(fallback));
    });
}

/**
 * 单条探测：B 站走接口判 `code`，其它走 GET 判状态码；任何异常/超时 ⇒ `unknown`（⛔ 不抛）。
 * ⚠️ 两处 `t.get` 都**必须**套 `withDeadline`：只给其中一处加，另一处仍能把整趟扫描拖住。
 */
async function checkOne(t: DlTransport, url: string, timeoutMs: number): Promise<LinkStatus> {
    const bvid = bvidOf(url);
    try {
        if (bvid) {
            const r = await withDeadline(
                t.get(buildBiliCheckUrl(bvid), {
                    'User-Agent': LINK_CHECK_UA,
                    Referer: 'https://www.bilibili.com/',
                }),
                timeoutMs,
                null,
            );
            if (!r || r.status < 200 || r.status >= 300) return 'unknown';
            return statusFromBiliCode(parseBiliCode(r.text));
        }
        const r = await withDeadline(t.get(url, { 'User-Agent': LINK_CHECK_UA }), timeoutMs, null);
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
    /**
     * 🔴 2026-11-17（⑥-A）新增两个可选参数，**不传即旧行为**（别的调用方一行都不用改）：
     *    `signal.stop` —— 用户按了「停止检测」⇒ 各 worker 在下一轮取任务前收手，
     *       在途那条仍会跑完（或被 `timeoutMs` 掐掉）。收手后剩余位保持 `undefined`。
     *    `timeoutMs` —— 单条硬截止，缺省 `LINK_CHECK_TIMEOUT_MS`。
     * ⚠️ 「收手」= 不再发新请求，**已探到的结果照常写进 `out`** —— ⛔ 别把 out 清空，
     *    用户按停止是「别扫了，把已经看到的给我」，不是「当没扫过」。
     */
    opts: { signal?: LinkCheckStopSignal; timeoutMs?: number } = {},
): Promise<(LinkStatus | undefined)[]> {
    const out: (LinkStatus | undefined)[] = Array.from({ length: urls.length }, () => undefined);
    const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : LINK_CHECK_TIMEOUT_MS;
    const targets: number[] = [];
    urls.forEach((u, i) => {
        if (isHttpUrl(u)) targets.push(i);
    });
    let cursor = 0;
    const worker = async (): Promise<void> => {
        while (cursor < targets.length) {
            // ⚠️ 收手检查放在 `cursor++` **之前**：否则被停掉的那条会白占一个下标，
            //    下次继续时直接从中间跳过去，漏检一条用户看不出来。
            if (opts.signal?.stopped) return;
            const i = targets[cursor++];
            const st = await checkOne(t, (urls[i] ?? '').trim(), timeoutMs);
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
    opts: { signal?: LinkCheckStopSignal; timeoutMs?: number } = {},
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
    const all = await checkEpisodeLinks(
        t,
        flat,
        (i, st) => {
            live[i] = st;
            const m = owner.get(i);
            if (!m || !onRow) return;
            // 该行此刻的完整状态数组（未探到的位仍是 undefined）——调用方按 need 自行判 dead
            onRow(m.entryId, live.slice(m.start, m.start + m.len));
        },
        opts,
    );
    return map.map((m) => ({ entryId: m.entryId, statuses: all.slice(m.start, m.start + m.len) }));
}
