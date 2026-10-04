// 拉「源清单」与「源文件」的服务层（#432 甲 · A2）。
//
// 用途两条：
//   ① 订阅：把一个**仓库/清单地址**拉下来（交给 `pure/sourcePack` 解析）；
//   ② 展开：清单里 `form === 'manifest'` 的那些**待下载地址**，逐个拉回源文件文本。
//
// 🔴 四条硬约束（都来自既有批次踩过的坑，别省）：
//   · **超时**：走 `pure/timing.withTimeout`（本仓统一口径，⛔ 别自己写 `setTimeout` 竞争）；
//   · **大小上限**：清单/源文件都是**几十 KB 级**的东西，拉回一个 50 MB 的玩意儿不该进解析器
//     （⚠️ 本仓传输层是「整段缓冲」的，所以上限只能在**拿到之后**判 —— 但判了就有用：不进 JSON.parse）；
//   · **并发上限**：⛔ 绝不同时打十几个站点（体检/订阅都是「对别人的服务器发请求」）；
//   · **可中断**：复用 #428 的 `CancelToken` + `raceCancel`（用户点了取消就该当帧停下，⛔ 不是等一圈超时）。
//
// ⚠️ 本模块**不解析**任何东西（解析在 `pure/sourcePack`），也**不落库**（落库在宿主）。

import { CancelledError, raceCancel, type CancelToken } from 'pure/cancel';
import { withTimeout } from 'pure/timing';
import { nodeHttpGet } from 'services/nodeHttp';

/** 单次请求超时（清单 / 源文件都很小，20 秒足够） */
export const SOURCE_FETCH_TIMEOUT_MS = 20_000;

/** 单次响应**字节**上限（清单 / 源文件都是几十 KB 级；4 MB 已经宽到离谱） */
export const SOURCE_FETCH_MAX_BYTES = 4 * 1024 * 1024;

/** 批量拉取时的并发上限（⛔ 别把十几个站点同时打满 —— 订阅/体检都是在对别人的服务器发请求） */
export const SOURCE_FETCH_CONCURRENCY = 4;

/**
 * 传输口（**可注入**）：默认 `nodeHttpGet`，单测里换成假站点。
 * ⚠️ 只声明这里用得到的三个字段（⛔ 别把整个 `NodeHttpResponse` 拖进来 —— 那会让假实现被迫造一堆用不上的字段）。
 */
export type SourceFetchRequest = (url: string) => Promise<{ status: number; text: string; finalUrl?: string }>;

export interface SourceFetchOptions {
    timeoutMs?: number;
    maxBytes?: number;
    cancel?: CancelToken;
    /** ⛔ 生产代码别传；只有单测用 */
    request?: SourceFetchRequest;
}

export interface SourceFetchedText {
    ok: boolean;
    /** 成功时是正文；失败时空串 */
    text: string;
    /** 失败原因（已折成给用户看的一句话）；成功时为 undefined */
    error?: string;
    /** 跟随重定向后的最终地址（成功且拿到时才有；append-only，便于回执里说清「其实是哪儿」） */
    finalUrl?: string;
}

/**
 * 拉一个地址的文本。**不抛**（失败折进返回值）——
 * 订阅/体检是「一批里坏几个很正常」的场景，⛔ 别让一个坏地址把整轮炸掉。
 */
export async function fetchSourceText(url: string, opts: SourceFetchOptions = {}): Promise<SourceFetchedText> {
    const target = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(target)) return { ok: false, text: '', error: '地址不是 http(s) 开头' };
    const timeoutMs = opts.timeoutMs ?? SOURCE_FETCH_TIMEOUT_MS;
    const maxBytes = opts.maxBytes ?? SOURCE_FETCH_MAX_BYTES;

    try {
        const request = opts.request ?? nodeHttpGet;
        const res = await raceCancel(withTimeout(request(target), timeoutMs, '拉取'), opts.cancel);
        if (res.status < 200 || res.status >= 300) return { ok: false, text: '', error: `对方返回 HTTP ${res.status}` };
        const text = String(res.text ?? '');
        if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, text: '', error: `内容过大（超过 ${Math.round(maxBytes / 1024 / 1024)} MB），已拒绝解析` };
        return { ok: true, text, finalUrl: res.finalUrl };
    } catch (e) {
        // ⚠️ 取消**不是失败**：原样抛哨兵，让上层分辨（本仓 #428 口径）。
        // 🔴 必须用 `instanceof` 判，⛔ **不许拿 `e.name` / message 字符串比对** —— 文案一改就静默失配。
        if (e instanceof CancelledError) throw e;
        return { ok: false, text: '', error: e instanceof Error ? e.message : String(e) };
    }
}

export interface SourceFetchBatchOptions extends SourceFetchOptions {
    concurrency?: number;
    /** 每条完成就回调一次（UI 渐进显示用；⛔ 别等全批完再刷） */
    onOne?: (index: number, result: SourceFetchedText) => void;
}

/**
 * 批量拉取（**按下标保序**返回，与输入一一对应）。
 *
 * 🔴 用**下标游标**发任务（照 #428 抓章那套）：并发下「谁先回来」不确定，
 *    ⛔ 别用「push 完成结果」——那会让返回顺序随网络抖动而变，调用方再也对不上输入。
 */
export async function fetchSourceTexts(urls: readonly string[], opts: SourceFetchBatchOptions = {}): Promise<SourceFetchedText[]> {
    const list = [...urls];
    const out: SourceFetchedText[] = new Array(list.length);
    if (!list.length) return out;
    const concurrency = Math.max(1, Math.min(Math.floor(opts.concurrency ?? SOURCE_FETCH_CONCURRENCY) || 1, list.length));
    let cursor = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            if (opts.cancel?.stopped) return;
            const i = cursor < list.length ? cursor++ : -1;
            if (i < 0) return;
            const r = await fetchSourceText(list[i], opts);
            out[i] = r;
            opts.onOne?.(i, r);
        }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return out;
}
