/**
 * 分片并发下载的**纯逻辑**（切片计划 / 续传断点 / 进度合并）。
 *
 * 用户 m10363 报「安装 SenseVoice 模型怎么这么慢」「一关闭退出就又要重置下载了」。
 * 本机实测（hf-mirror.com，2026-11-06）：
 *   · 单连接 **131 KB/s** ⇒ 228MB 要 **约 30 分钟**
 *   · 4 路并发（Range 分片）聚合 **426 KB/s**，**加速 3.25 倍**
 *   · `Range: bytes=104857600-105906175` 返回 **206 + content-range** ⇒ 断点续传可行
 * 所以必须两件事一起做：**并发切片**（治慢）+ **片文件续传**（治「关窗就重置」）。
 *
 * 🔴 为什么每片各写一个临时文件、而不是都往同一个 `.part` 里 seek 写：
 *   ① 续传要能回答「已经下到哪了」。多个写入点同时推进时，`.part` 的**大小**不再是
 *      「已下字节数」（中间有空洞），得额外维护一份区间表；进程一崩，区间表与文件就对不上了。
 *   ② 每片一个文件时，**片文件的大小本身就是该片的断点**，不依赖任何额外状态，
 *      崩溃/关窗后重启只要 `stat` 一遍就能接着下。这个性质比省几个文件重要得多。
 *   ③ 合并只在全部片齐了之后做一次顺序拷贝，代价是 O(n) 的一次磁盘读，可忽略。
 *
 * ⛔ 本模块不碰 fs、不碰 Node API —— 只做数字推导，真 IO 在 `services/asrModelDownload`。
 */

/** 单片目标长度：8MB。太小 ⇒ 请求次数爆炸（每片都要一次 TLS 握手）；太大 ⇒ 续传粒度粗。 */
export const DOWNLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * 并发路数。
 *
 * 实测 4 路拿到 3.25 倍（不是理论 4 倍：镜像侧对单 IP 的总带宽有上限）。
 * ⛔ 不要再往上加：8 路只会把同一份带宽切得更碎，而且会被 hf-mirror 的限流打回 403。
 */
export const DOWNLOAD_PARALLEL = 4;

/**
 * 小于这个体积就不切片了。
 *
 * Qwen3 那十几个 `config.json` / `tokenizer_config.json` 只有几百字节到 2MB，
 * 给它们开 4 路并发是纯浪费（每路一次 TLS 握手 > 传输本身）。
 */
export const DOWNLOAD_MIN_CHUNKED_BYTES = 4 * 1024 * 1024;

/** 一片任务 */
export interface DownloadChunk {
    /** 片序号（从 0 开始） */
    index: number;
    /** 起始字节（含） */
    start: number;
    /** 结束字节（含）—— HTTP Range 的语义就是闭区间 */
    end: number;
    /** 这一片应有的字节数 */
    size: number;
}

/**
 * 把文件切成片。
 *
 * @param totalBytes 总长；`<= 0`（上游没给 content-length）⇒ 返回**单片**任务，调用方退回单连接下载。
 * @param chunkBytes 单片目标长度（默认 8MB）
 *
 * ⚠️ 最后一片可能比 `chunkBytes` 短，必须用 `end - start + 1` 算 `size`，
 *    ⛔ 不能一律写 `chunkBytes` —— 那会让「已下多少」永远差最后一段，永远判不完整。
 */
export function planChunks(totalBytes: number, chunkBytes: number = DOWNLOAD_CHUNK_BYTES): DownloadChunk[] {
    const total = Math.floor(totalBytes);
    // 🔴 `Math.max(1, Math.floor(NaN))` 仍是 NaN —— 不显式兜底的话 `step` 为 NaN，
    //    循环体一次都不跑、退化成单片，看着"没崩"其实参数已经烂了。
    const rawStep = Math.floor(chunkBytes);
    const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : DOWNLOAD_CHUNK_BYTES;
    if (!Number.isFinite(total) || total <= 0) {
        return [{ index: 0, start: 0, end: Math.max(0, step - 1), size: step }];
    }
    const out: DownloadChunk[] = [];
    for (let start = 0; start < total; start += step) {
        const end = Math.min(start + step, total) - 1;
        out.push({ index: out.length, start, end, size: end - start + 1 });
    }
    return out.length ? out : [{ index: 0, start: 0, end: Math.max(0, total - 1), size: Math.max(0, total) }];
}

/**
 * 这个体积值不值得切片并发。
 * `totalBytes <= 0`（未知）⇒ false，退回单连接（切片需要精确总长才能算 Range 上界）。
 */
export function shouldChunk(totalBytes: number, minBytes: number = DOWNLOAD_MIN_CHUNKED_BYTES): boolean {
    return Number.isFinite(totalBytes) && totalBytes >= Math.max(1, minBytes);
}

/**
 * 续传时算出「这一片从哪个字节接着下」。
 *
 * @param chunk 片任务
 * @param haveBytes 片文件已有的字节数（`< 0` 或 `NaN` 视为 0）
 * @returns 还没下的部分；`null` 表示这一片已经齐了，不用再下
 *
 * 🔴 片文件**比应有长度还大**时必须当「不可信」丢掉重下（返回整片）：
 *    那说明上一次写入没被截断、或者两个进程抢过同一个文件 —— 多出来的字节会让
 *    合并后的模型头部错位，而大小校验又刚好可能通过（因为总量对得上）。
 */
export function resumeChunk(chunk: DownloadChunk, haveBytes: number): DownloadChunk | null {
    const have = Number.isFinite(haveBytes) && haveBytes > 0 ? Math.floor(haveBytes) : 0;
    if (have === chunk.size) return null; // 正好齐了
    if (have > chunk.size) return chunk; // 偏大 ⇒ 不可信，整片重下
    const start = chunk.start + have;
    return { index: chunk.index, start, end: chunk.end, size: chunk.end - start + 1 };
}

/** 已下字节汇总（用于算总进度） */
export function sumBytes(sizes: readonly number[]): number {
    let n = 0;
    for (const s of sizes) {
        if (Number.isFinite(s) && s > 0) n += Math.floor(s);
    }
    return n;
}

/**
 * 总进度百分比。
 *
 * 🔴 并发下载时 `downloadPercent` 不够用：它只接受「已收 / 总长」两个数，
 *    而我们手里是一组片的已完成长度。这里把汇总做成单一入口，
 *    ⛔ 别在调用点各自 `reduce` —— 三处各写一遍必然有一处忘了夹 0..100。
 */
export function chunkedPercent(doneBytes: number, totalBytes: number): number | null {
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
    const done = Number.isFinite(doneBytes) && doneBytes > 0 ? doneBytes : 0;
    return Math.max(0, Math.min(100, Math.floor((done / totalBytes) * 100)));
}

/**
 * 这一批要同时发几路。
 * 片数少于并发上限时按片数来 —— 3 片就别开 4 路，多出来那路只会立刻空转。
 */
export function activeParallel(chunkCount: number, parallel: number = DOWNLOAD_PARALLEL): number {
    // 🔴 同样别信 `Math.max(1, Math.floor(NaN)) === NaN`：NaN 会一路传到「该开几路」的判定里，
    //    最后变成 0 路并发 = 什么都不下，比报错更难查。
    const p = Math.floor(parallel);
    const n = Number.isFinite(p) && p > 0 ? p : 1;
    const c = Math.floor(chunkCount);
    const count = Number.isFinite(c) && c > 0 ? c : 1;
    return Math.min(n, count);
}
