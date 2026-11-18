/**
 * 本地语音识别模型的**流式下载器**。
 *
 * 🔴 为什么不复用 `services/nodeHttp`：那个模块把响应体整块 `Buffer.concat` 进内存
 *    （它的两个调用方都是几十 KB 的搜索结果/页面）。模型最小 74MB、最大 465MB，
 *    整块读进来就是一次几百 MB 的峰值分配，在低配机器上直接 OOM。
 *    这里必须**边收边写盘**。
 *
 * 🔴 为什么先写 `.part` 再改名：下到一半断网/关软件时，真正的目标文件名绝不能出现半个模型
 *    —— 否则下次启动会把它当成「已就绪」，whisper-cli 只报「failed to load model」。
 *
 * ⚠️ 依赖全部注入（`DownloadDeps`），单测才能在没有任何网络的机器上跑；
 *    真实现是 `defaultDownloadDeps()`，惰性 `require`（移动端没有 Node 模块，
 *    且 `esbuild.config.mjs` 的 external 用的是**不带 `node:` 前缀**的 builtins 清单）。
 */

import { ASR_DOWNLOAD_TMP_SUFFIX, downloadLooksComplete, downloadPercent, tmpPathFor } from 'pure/asrModels';
import { activeParallel, chunkedPercent, planChunks, resumeChunk, shouldChunk, sumBytes } from 'pure/asrDownloadPlan';

/**
 * 下载器要的最小描述。
 *
 * 🔴 本轮（用户 m08030「可一键下载三家模型」）把它从 `AsrModelPreset` 放宽成这个形状：
 *    SenseVoice 要下「程序 + 模型 + 词表」三个文件、Qwen3 要下两个模型目录里的十几个文件，
 *    它们都不是 whisper 那种「档位预设」。为每个引擎再抄一套镜像回落逻辑是重复造轮子，
 *    而 `AsrModelPreset` 本来就满足这个接口（有 `url` 和 `bytes`）⇒ 放宽即可，⛔ 不改调用方。
 */
export interface DownloadTarget {
    /** 官方直链 */
    url: string;
    /** 期望字节数（下完校验用；`0` 表示未知，此时只校验「收到了字节」） */
    bytes: number;
}

/** 下载结果 */
export interface DownloadResult {
    ok: boolean;
    /** 失败原因；成功时为空串 */
    message: string;
    /** 成功时模型文件的绝对路径 */
    path?: string;
}

/** 进度回调：`percent` 为 `null` 表示上游没给总长（只更新已收字节数） */
export type DownloadProgressCallback = (percent: number | null, received: number, total: number) => void;

/** 一次可取消的下载句柄 */
export interface DownloadHandle {
    /** 等下载结束（成功/失败都会 resolve，⛔ 不 reject） */
    done: Promise<DownloadResult>;
    /** 用户点「取消」：中止并把 `.part` 删掉 */
    cancel: () => void;
}

/** 执行层依赖（真源 = `defaultDownloadDeps`；单测注入假实现） */
export interface DownloadDeps {
    /** 发 GET，返回流事件；`onAbort` 让调用方能在外面掐断 */
    open: (url: string, onChunk: (chunk: Buffer) => void, onEnd: () => void, onError: (msg: string) => void) => { abort: () => void };
    /** 以追加方式打开写入流，返回写入器 */
    openWriter: (path: string) => {
        write: (chunk: Buffer) => void;
        /** 🔴 带完成回调：`fs.createWriteStream().end()` 是异步的，字节落盘才能校验大小 */
        close: (onFlushed: () => void) => void;
        abort: () => void;
    };
    /** 文件大小；不存在返回 -1 */
    size: (path: string) => number;
    /** 改名（`.part` → 目标） */
    rename: (from: string, to: string) => void;
    /** 删文件（失败不抛） */
    remove: (path: string) => void;

    /* ── 以下是**分片并发**才需要的可选能力（用户 m10363 提速 + 断点续传） ──────────
     * 🔴 全部可选：任何一个缺失就退回上面那条单连接路径，所以既有注入式单测一行都不用改。
     *    实测（hf-mirror，2026-11-06）：单连接 131 KB/s、4 路并发聚合 426 KB/s（3.25 倍），
     *    且 `Range: bytes=N-M` 返回 206 ⇒ 分片与续传都成立。
     */
    /** 发带 `Range: bytes=start-end`（闭区间）的 GET */
    openRange?: (
        url: string,
        start: number,
        end: number,
        onChunk: (chunk: Buffer) => void,
        onEnd: () => void,
        onError: (msg: string) => void,
    ) => { abort: () => void };
    /** 以**追加**方式打开写入流（续传要接着写，⛔ 不能用会截断的 openWriter） */
    openWriterAppend?: (path: string) => {
        write: (chunk: Buffer) => void;
        close: (onFlushed: () => void) => void;
        abort: () => void;
    };
    /** 递归建目录（片文件放在 `<目标>.d/` 下，目录不存在会写失败） */
    mkdirp?: (dir: string) => void;
    /** 把若干片文件按序拼成目标文件（拼完由调用方删片） */
    concat?: (parts: readonly string[], dest: string, onDone: (ok: boolean, message: string) => void) => void;
}

/**
 * 下载一档模型到 `destPath`。
 *
 * 流程：已有目标文件且字节数对得上 ⇒ 直接成功（幂等，⛔ 不重复下 465MB）；
 * 否则下到 `.part`，校验字节数，通过才改名。
 *
 * 🔴 源顺序（2026-11-13 用户 m07854 ⑨ 改口径）：
 *    改前 = 官方先试、**网络层失败后**才回落镜像。问题是官方在国内是**必然失败**的
 *    （实测 12 秒 `socket hang up`）⇒ 每次下载都要先白等十几秒超时，用户看到的
 *    是「点了下载卡住不动」，而不是「在下」。用户逐字要求：「下载模型统一启用国内镜像源下载」。
 *    ⇒ 现在**镜像优先**，官方只作为备用源（镜像挂了 / 海外用户镜像反而慢时兜底）。
 *    ⚠️ 回落仍然只在**网络层失败**时发生（超时 / 连不上 / 断流），HTTP 状态码错（404 / 403）
 *       换源也一样，直接报错让用户看到真相。
 *    ⚠️ 回落前**必须删掉已下的 `.part`**：两个源的数据不能拼在一起（中途断开时字节数对得上纯属巧合，
 *       拼出来的文件是坏的且校验不出来）。
 */
export function downloadModel(
    deps: DownloadDeps,
    preset: DownloadTarget,
    destPath: string,
    onProgress?: DownloadProgressCallback,
    /** 首选地址（不传 = 直接用 `preset.url`）；网络层失败后回落到 `preset.url` */
    primaryUrl?: string,
): DownloadHandle {
    /**
     * 实际的首选地址与它的备用源。
     *
     * 🔴 为什么是「首选 + 回落」而不是「主/备」两个平级参数：
     *    调用方（`main.ts`）只会从 `preset.url` 派生出镜像地址，两者**必然同文件**；
     *    多一个参数只会多一种「备的是别的文件」的错误用法。
     * ⚠️ 首选与 `preset.url` 相同（调用方没传 / 传了同一个）⇒ 没有备用源，退化成单源行为。
     */
    const firstUrl = primaryUrl && primaryUrl.trim() ? primaryUrl.trim() : preset.url;
    const fallbackUrl = firstUrl === preset.url ? undefined : preset.url;
    let cancelled = false;
    let aborter: { abort: () => void } | null = null;
    /** 分片并发期间的在途请求集合（取消时要一起掐断，否则白占带宽到下一个块边界） */
    let abortChunks: (() => void) | null = null;
    /**
     * 🔴 分片路径的「取消即结算」入口。
     *
     * 分片路径是靠 `pump()` 一片推一片往前走的，而 `abort()` **不会**回调 `onEnd`/`onError`。
     * 所以光掐断在途请求，`done` 会永远悬着 —— 用户点了「取消」而弹窗停在「正在安装…」不动，
     * 这比不取消更糟（单测抓到的就是这条：5 秒超时）。
     * 单连接路径没这个问题，因为它的 `abort()` 会经由请求的 error 事件落到 `onError`。
     */
    let cancelChunks: (() => void) | null = null;
    let writer: {
        write: (chunk: Buffer) => void;
        close: (onFlushed: () => void) => void;
        abort: () => void;
    } | null = null;
    const tmp = tmpPathFor(destPath);

    /**
     * 校验「这个文件下完了」。
     * ⚠️ `bytes <= 0`（上游没给准数）时只要求「收到了字节」—— 这正是本轮把参数放宽成
     *    `DownloadTarget` 之后新增的分支：Qwen3 那十几个小文件里若有一个拿不到实测字节数，
     *    不该因为「没法校验」就永远判失败。
     */
    const complete = (got: number): boolean => (preset.bytes > 0 ? downloadLooksComplete(got, preset.bytes) : got > 0);

    const cleanupTmp = (): void => {
        try {
            deps.remove(tmp);
        } catch {
            /* 残留 .part 不影响正确性，下次会被覆盖 */
        }
    };

    const done = new Promise<DownloadResult>((resolve) => {
        // ① 已经有完整的目标文件 ⇒ 幂等成功
        const existing = deps.size(destPath);
        if (existing > 0 && complete(existing)) {
            resolve({ ok: true, message: '', path: destPath });
            return;
        }
        // ② 目标文件存在但对不上（半个模型）⇒ 删掉重下，⛔ 不append
        if (existing > 0) deps.remove(destPath);

        /* ── 分片并发 + 断点续传（用户 m10363） ────────────────────────────────
         * 触发条件（全部满足才走这条）：
         *   ① 目标足够大（≥4MB —— 几百字节的 config.json 开并发纯浪费 TLS 握手）
         *   ② 已知精确总长（切片要算 Range 上界）
         *   ③ 依赖齐全（缺任何一个就退回单连接，⛔ 不半吊子）
         *
         * 🔴 为什么片文件放在 `<目标>.d/` 而不是各自散在目标目录里：
         *    用户看到的模型目录要干净；而且整个目录直接删掉就等于「放弃这次下载」，
         *    不用逐个删、也不会漏删成孤儿。
         * 🔴 为什么片文件叫 `<index>.part` 而不是带总长/URL 的复合名：
         *    片文件的大小本身就是该片的断点（见 `pure/asrDownloadPlan` 文件头三条理由），
         *    换镜像重来时 URL 变了但分片布局不该变，用 URL 命名反而会让续传失效。
         */
        const chunkDir = `${tmp}.d`;
        const canChunk =
            shouldChunk(preset.bytes) &&
            typeof deps.openRange === 'function' &&
            typeof deps.openWriterAppend === 'function' &&
            typeof deps.mkdirp === 'function' &&
            typeof deps.concat === 'function';

        let received = 0;
        let total = preset.bytes;
        let settled = false;
        let usedFallback = false;

        const finish = (r: DownloadResult): void => {
            if (settled) return;
            settled = true;
            resolve(r);
        };

        /**
         * 🔴 这里**不再**预开写入流：单连接路径的流在 `begin()` 里开（它每次换源都要重开），
         *    分片路径根本不写 `tmp`（它是最后 `concat` 出来的）。
         *    之前无条件开一个 `tmp` 写入流，在分片路径下就是一个没人 close 的句柄 + 一个空文件，
         *    而且它抛错时会**在分片判定之前**就把整次下载判成「无法创建下载文件」——
         *    单测里正是这样暴露的（假 `openWriter` 一抛，12 条分片用例全部走不进分片分支）。
         */

        /**
         * 代际守卫 —— 🔴 实测抓到的真 bug：回落到镜像时若只换 `writer` 而不拦旧请求的回调，
         * 旧请求的 `onChunk` 会**继续往新一轮的 `received` 里累加**，表现为进度涨过 100%
         * 然后字节数对不上（实测收到 76079743 / 应 77691713，差 2.07%，恰好卡在 2% 容差外）。
         * 所以三个回调都按代生成（`callbacksFor(gen)`），号对不上就整个丢弃。
         */
        let gen = 0;

        /**
         * 为某一代下载生成一组回调。
         * ⚠️ 必须是**工厂**，不能用共享闭包 —— 共享闭包就是上面那个 bug 的成因。
         */
        const callbacksFor = (myGen: number) => {
            const stale = (): boolean => settled || myGen !== gen;

            const onChunk = (chunk: Buffer): void => {
                if (stale()) return; // 上一代的迟到数据，丢弃
                received += chunk.length;
                try {
                    writer?.write(chunk);
                } catch {
                    aborter?.abort();
                    finish({ ok: false, message: '写入磁盘失败，请检查剩余空间' });
                    return;
                }
                onProgress?.(downloadPercent(received, total), received, total);
            };

            const onEnd = (): void => {
                if (stale()) return;
                if (cancelled) {
                    try {
                        writer?.abort();
                    } catch {
                        /* 已经断了 */
                    }
                    cleanupTmp();
                    finish({ ok: false, message: '已取消下载' });
                    return;
                }

                /**
                 * 🔴 `close` 必须**等写完**再往下走（实测抓到的第二个真 bug）：
                 * `createWriteStream().end()` 是异步的，字节还在用户态缓冲里没落盘。
                 * 之前同步往下走，`deps.size(tmp)` 量到的只是个接近但不完整的大小（恰好落在
                 * 2% 容差内），于是「校验通过 → 改名成功 → 调用方立刻 stat 得到 77126507 / 应 77691713」。
                 * 真机上这就是「下载看起来成功、模型加载失败」——比直接报错更难排查。
                 * 所以校验与改名全部挪进 `close` 的回调里。
                 */
                writer?.close(() => {
                    if (stale()) return;
                    const got = deps.size(tmp);
                    if (!complete(got)) {
                        cleanupTmp();
                        finish({
                            ok: false,
                            message: `下载不完整（收到 ${got} 字节，应为 ${preset.bytes} 字节），请重试`,
                        });
                        return;
                    }
                    try {
                        deps.rename(tmp, destPath);
                    } catch {
                        cleanupTmp();
                        finish({ ok: false, message: '下载完成但重命名失败，请检查目标目录权限' });
                        return;
                    }
                    onProgress?.(100, preset.bytes, preset.bytes);
                    finish({ ok: true, message: '', path: destPath });
                });
            };

            const onError = (msg: string): void => {
                if (stale()) return;
                try {
                    writer?.abort();
                } catch {
                    /* 已经断了 */
                }
                cleanupTmp();
                if (cancelled) {
                    finish({ ok: false, message: '已取消下载' });
                    return;
                }
                // 🔴 换源回落（用户 m07854 ⑨ 之后的方向反了：首选镜像 → 网络层失败回落官方）。
                //    只在**网络层**失败时换源重试一次（超时 / 连不上 / 断流）。
                //    `服务器返回 404` 这类是本仓 `defaultDownloadDeps` 自己拼的文案（见那边的 `onError`
                //    调用点），语义是「文件本身不对」，换源不会变好 ⇒ 不回落，直接报错让用户看到真相。
                //    ⚠️ 用文案前缀判断确实不够优雅，但这层依赖是 `DownloadDeps.open` 的既有签名
                //      （它只回一个字符串）；为它改签名会波及全部注入式单测，收益不成比例。
                const serverSaid = msg.startsWith('服务器返回');
                if (fallbackUrl && !usedFallback && !serverSaid) {
                    usedFallback = true;
                    onProgress?.(0, 0, preset.bytes);
                    begin(fallbackUrl);
                    return;
                }
                finish({ ok: false, message: msg || '下载失败，请检查网络后重试' });
            };

            return { onChunk, onEnd, onError };
        };

        /**
         * 从某个地址开始下（首次用官方、回落时用镜像）。
         * ⚠️ 每次都**重开写入流并清零已收字节** —— 换源之后旧 `.part` 已删，`received`
         *    必须跟着归零，否则进度会从 100% 开始往下掉，用户看着像回滚。
         * ⚠️ 进入新一代前先 `abort()` 旧请求 —— 光靠代际守卫丢弃数据还是会白占带宽到下一个块边界。
         */
        const begin = (url: string): void => {
            try {
                aborter?.abort();
            } catch {
                /* 已经断了 */
            }
            gen += 1;
            const cb = callbacksFor(gen);
            received = 0;
            total = preset.bytes;
            try {
                writer = deps.openWriter(tmp);
            } catch {
                finish({ ok: false, message: '无法创建下载文件，请检查目标目录是否可写' });
                return;
            }
            try {
                aborter = deps.open(url, cb.onChunk, cb.onEnd, cb.onError);
            } catch (err) {
                finish({ ok: false, message: `无法发起下载：${err instanceof Error ? err.message : String(err)}` });
            }
        };

        /**
         * 分片并发 + 断点续传。
         *
         * 与单连接路径的关系：**互斥**，这里跑就绝不 `begin()`。共享的东西只有 `finish`/`settled`，
         * 所以「取消」「结算一次」的语义与单连接完全一致。
         *
         * 流程：切计划 → 建片目录 → 逐片续传（在途并发上限 4）→ 全部齐了拼成一个文件 → 校验 → 改名。
         */
        const runChunked = (): void => {
            const chunks = planChunks(preset.bytes);
            const partPath = (i: number): string => `${chunkDir}/${i}.part`;

            try {
                deps.mkdirp?.(chunkDir);
            } catch {
                finish({ ok: false, message: '无法创建下载目录，请检查目标目录是否可写' });
                return;
            }

            /** 每片「已下字节数」的当前值（决定总进度，也决定要不要发请求） */
            const have: number[] = chunks.map((c) => {
                const n = deps.size(partPath(c.index));
                // 🔴 片文件比应有长度还大 = 不可信（上次写入没截断 / 两个进程抢过同一个文件），
                //    整片重下（`resumeChunk` 会返回整片），否则拼出来的模型头部会错位。
                return n > 0 && n <= c.size ? n : 0;
            });

            let settledHere = false;
            let running = 0;
            /**
             * 🔴 待下分片用**队列**而不是游标 —— 镜像回落时要能把失败的那一片塞回队首重试。
             *    用游标的话下标只会往前走，回落的片就永远漏掉了（拼出来少一块，大小校验必挂）。
             */
            const queue: number[] = chunks.map((c) => c.index);
            let usedFallbackChunk = false;
            /**
             * 当前用的地址：首轮镜像（用户 m07854 ⑨），网络层失败一次后**整轮**切官方
             * （新片直接用官方，⛔ 别每片都先撞一次镜像超时）。
             */
            let chunkUrl = firstUrl;
            /** 在途请求，取消时统一掐断 */
            const inflight = new Set<{ abort: () => void }>();

            const report = (): void => {
                const doneBytes = sumBytes(have);
                onProgress?.(chunkedPercent(doneBytes, preset.bytes), doneBytes, preset.bytes);
            };

            const abortAll = (): void => {
                for (const h of inflight) {
                    try {
                        h.abort();
                    } catch {
                        /* 已经断了 */
                    }
                }
                inflight.clear();
            };
            abortChunks = abortAll;
            /** 取消时由 `cancel()` 直接调，保证 `done` 一定结算（片文件保留，下次续传） */
            cancelChunks = (): void => {
                if (settledHere) return;
                settledHere = true;
                abortAll();
                finish({ ok: false, message: '已取消下载' });
            };

            const fail = (message: string): void => {
                if (settledHere) return;
                settledHere = true;
                abortAll();
                // 🔴 失败**不删片目录** —— 已下的片留着，下次点「继续」就能接着来。
                //    这正是用户报障「一关闭退出就又要重置下载」要的行为。
                finish({ ok: false, message });
            };

            /** 全部片齐了：按序拼成一个文件 */
            const mergeAll = (): void => {
                if (settledHere) return;
                settledHere = true;
                abortAll();
                const parts = chunks.map((c) => partPath(c.index));
                const onMerged = (ok: boolean, message: string): void => {
                    if (!ok) {
                        finish({ ok: false, message: message || '拼合分片失败，请重试' });
                        return;
                    }
                    const got = deps.size(tmp);
                    if (!complete(got)) {
                        // 拼出来的大小不对 ⇒ 片是坏的，清掉全部片让下次从头来（⛔ 留着只会反复失败）
                        for (const p of parts) deps.remove(p);
                        deps.remove(tmp);
                        finish({
                            ok: false,
                            message: `下载不完整（合计 ${got} 字节，应为 ${preset.bytes} 字节），请重试`,
                        });
                        return;
                    }
                    try {
                        deps.rename(tmp, destPath);
                    } catch {
                        deps.remove(tmp);
                        finish({ ok: false, message: '下载完成但重命名失败，请检查目标目录权限' });
                        return;
                    }
                    // 成功才清片（失败要留作续传）
                    for (const p of parts) deps.remove(p);
                    onProgress?.(100, preset.bytes, preset.bytes);
                    finish({ ok: true, message: '', path: destPath });
                };

                try {
                    if (!deps.concat) return onMerged(false, '拼合分片的能力缺失');
                    deps.concat(parts, tmp, onMerged);
                } catch (err) {
                    onMerged(false, `拼合分片失败：${err instanceof Error ? err.message : String(err)}`);
                }
            };

            /**
             * 发下一批。用「游标 + 在途计数」而不是 `Promise.all` 分批：
             * 每片耗时差好几倍（实测 124～247 KB/s），分批等最慢那片会让快的连接空转。
             */
            const pump = (): void => {
                if (settledHere) return;
                if (cancelled) {
                    settledHere = true;
                    abortAll();
                    finish({ ok: false, message: '已取消下载' });
                    return;
                }
                if (queue.length === 0 && running === 0) {
                    mergeAll();
                    return;
                }
                const limit = activeParallel(chunks.length);
                while (running < limit && queue.length > 0) {
                    const idx = queue.shift() as number;
                    const chunk = chunks[idx];
                    const rest = resumeChunk(chunk, have[idx]);
                    if (!rest) {
                        // 这片上次已经下完：不出队也不占并发名额，`continue` 继续取下一片
                        continue;
                    }

                    running += 1;
                    let handle: { abort: () => void } | null = null;
                    let closed = false;
                    let writer: ReturnType<NonNullable<DownloadDeps['openWriterAppend']>> | null = null;
                    try {
                        writer = deps.openWriterAppend?.(partPath(chunk.index)) ?? null;
                    } catch {
                        writer = null;
                    }
                    if (!writer) {
                        running -= 1;
                        fail('无法创建分片文件，请检查目标目录是否可写');
                        return;
                    }

                    const onEnd = (): void => {
                        if (closed) return;
                        closed = true;
                        if (handle) inflight.delete(handle);
                        // 等真正落盘再判定这一片下了多少（`end()` 是异步的，见文件头那条实测教训）
                        writer?.close(() => {
                            running -= 1;
                            const got = deps.size(partPath(chunk.index));
                            if (got < rest.size) {
                                // 这一片没下满 ⇒ 记下已收部分（下次续传），但整轮算失败：
                                // ⛔ 不能静默重试，否则网络断断续续时进度会永远循环而不报错。
                                have[chunk.index] = got > 0 ? got : 0;
                                report();
                                fail('下载中断，请重试（已下好的部分会保留）');
                                return;
                            }
                            have[chunk.index] = chunk.size;
                            report();
                            pump();
                        });
                    };
                    const onError = (msg: string): void => {
                        if (closed) return;
                        closed = true;
                        if (handle) inflight.delete(handle);
                        try {
                            writer?.abort();
                        } catch {
                            /* 已经断了 */
                        }
                        running -= 1;
                        const got = deps.size(partPath(chunk.index));
                        have[chunk.index] = got > 0 && got <= chunk.size ? got : 0;
                        report();
                        /**
                         * 镜像回落（分片版）：与单连接同一判据 —— 只在**网络层**失败时换源，
                         * `服务器返回` 这类是本仓自己拼的文案（文件本身不对），换镜像不会变好。
                         * 换源后把这一片塞回队首重试，并让**后续所有片**直接用镜像地址。
                         */
                        const serverSaid = msg.startsWith('服务器返回');
                        if (fallbackUrl && !usedFallbackChunk && !serverSaid) {
                            usedFallbackChunk = true;
                            chunkUrl = fallbackUrl;
                            queue.unshift(chunk.index);
                            pump();
                            return;
                        }
                        fail(msg || '下载失败，请检查网络后重试');
                    };

                    try {
                        handle = deps.openRange?.(chunkUrl, rest.start, rest.end, (b) => {
                            if (closed) return;
                            try {
                                writer?.write(b);
                            } catch {
                                onError('写入磁盘失败，请检查剩余空间');
                            }
                        }, onEnd, onError) ?? null;
                        if (handle) inflight.add(handle);
                    } catch (err) {
                        running -= 1;
                        fail(`无法发起下载：${err instanceof Error ? err.message : String(err)}`);
                        return;
                    }
                }
            };

            report();
            pump();
        };

        if (canChunk) {
            runChunked();
            return;
        }
        begin(firstUrl);
    });

    return {
        done,
        cancel: () => {
            if (cancelled) return;
            cancelled = true;
            try {
                aborter?.abort();
            } catch {
                /* 已经断了 */
            }
            // 分片路径要掐断全部在途请求（单连接路径此时 `abortChunks` 为 null，无副作用）
            try {
                abortChunks?.();
            } catch {
                /* 已经断了 */
            }
            // 并且必须自己结算 `done`：abort 不会触发回调，光掐断会让 `done` 永远悬着
            try {
                cancelChunks?.();
            } catch {
                /* 已经结算过了 */
            }
        },
    };
}

/** 真实现（惰性 `require`；⛔ 一律不带 `node:` 前缀，见文件头） */
export function defaultDownloadDeps(): DownloadDeps {
    const fs = require('fs') as {
        createWriteStream: (p: string, o?: { flags?: string }) => {
            write: (c: Buffer) => void;
            end: () => void;
            destroy: () => void;
            once: (ev: string, cb: () => void) => void;
        };
        statSync: (p: string) => { size: number };
        renameSync: (a: string, b: string) => void;
        unlinkSync: (p: string) => void;
        mkdirSync: (p: string, o?: { recursive?: boolean }) => void;
    };
    const path = require('path') as { dirname: (p: string) => string };
    const https = require('https') as {
        get: (
            url: string,
            opts: { headers?: Record<string, string> },
            cb: (res: unknown) => void,
        ) => { on: (e: string, cb: (err: Error) => void) => void; destroy: () => void };
    };

    const openOnce = (
        url: string,
        onChunk: (chunk: Buffer) => void,
        onEnd: () => void,
        onError: (msg: string) => void,
        hop: number,
        range?: { start: number; end: number },
    ): { abort: () => void } => {
        let destroyed = false;
        // 🔴 先声明再发请求：重定向分支要把它指向下一跳的句柄，
        //    若声明在 `https.get` 之后，回调里引用它就落进 TDZ（虽然实际是异步触发，但依赖这点太脆）。
        const aborterRef: { abort: () => void } = {
            abort: () => {
                destroyed = true;
                try {
                    req.destroy();
                } catch {
                    /* 已经断了 */
                }
            },
        };
        const headers: Record<string, string> = {};
        if (range) {
            // HTTP Range 是**闭区间**（`bytes=0-99` 是 100 字节），而分片计划里的 end 也是闭区间，正好对上。
            headers.Range = `bytes=${range.start}-${range.end}`;
        }
        const req = https.get(url, { headers }, (raw) => {
            const res = raw as {
                statusCode?: number;
                headers: Record<string, string | string[] | undefined>;
                on: (e: string, cb: (...a: never[]) => void) => void;
                resume: () => void;
                destroy: () => void;
            };
            const code = res.statusCode ?? 0;
            // 重定向：HuggingFace 的 resolve 会 302 到 CDN，最多跟 5 跳
            const loc = res.headers['location'];
            if (code >= 300 && code < 400 && typeof loc === 'string' && hop < 5) {
                res.resume();
                const next = openOnce(loc, onChunk, onEnd, onError, hop + 1, range);
                aborterRef.abort = next.abort;
                return;
            }
            /**
             * 🔴 分片请求必须接受 **206**（Partial Content）：
             *    实测 hf-mirror 对 `Range: bytes=0-2097151` 就是回 206。
             *    若这里只认 200，分片路径会每一片都报「服务器返回 206」——看着像地址失效，其实是正常的。
             * ⚠️ 200 也放过：某些 CDN 忽略 Range 直接给整份。这时上层按「这一片收到的字节比预期多」
             *    会走「偏大 ⇒ 整片不可信」的逻辑，比直接崩好。
             */
            const ok = range ? code === 206 || code === 200 : code === 200;
            if (!ok) {
                res.resume();
                onError(`服务器返回 ${code}，可能地址已失效或需要代理`);
                return;
            }
            let ended = false;
            res.on('data', (chunk: Buffer) => {
                if (destroyed) return;
                onChunk(Buffer.from(chunk));
            });
            res.on('error', (err: Error) => {
                if (destroyed) return;
                onError(err.message);
            });
            res.on('end', () => {
                if (destroyed || ended) return;
                ended = true;
                onEnd();
            });
        });
        req.on('error', (err: Error) => {
            if (destroyed) return;
            onError(err.message);
        });
        return aborterRef;
    };

    /** 追加写的写入器（续传用）：`flags: 'a'` 才能接着已有字节往下写 */
    const appendWriter = (p: string): {
        write: (chunk: Buffer) => void;
        close: (onFlushed: () => void) => void;
        abort: () => void;
    } => {
        const ws = fs.createWriteStream(p, { flags: 'a' });
        return {
            write: (c) => ws.write(c),
            // 与主路径同一理由：必须等 `finish`/`error` 才算落盘
            close: (onFlushed) => {
                let done = false;
                const fire = (): void => {
                    if (done) return;
                    done = true;
                    onFlushed();
                };
                ws.once('finish', fire);
                ws.once('error', fire);
                ws.end();
            },
            abort: () => ws.destroy(),
        };
    };

    return {
        open: (url, onChunk, onEnd, onError) => openOnce(url, onChunk, onEnd, onError, 0),
        openRange: (url, start, end, onChunk, onEnd, onError) =>
            openOnce(url, onChunk, onEnd, onError, 0, { start, end }),
        openWriterAppend: appendWriter,
        mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
        /**
         * 把片文件按序拼起来。
         *
         * 🔴 用「读一段写一段」而不是把每片整块读进内存：单片 8MB × 4 路已经是 32MB，
         *    而单测/低配机器不该为拼合再吃一次几百 MB。
         * ⚠️ 目标文件以 `'w'` 打开（复写），拼合前若已有一个不完整的 `tmp` 必须被覆盖掉。
         */
        concat: (parts, dest, onDone) => {
            const readFileSync = require('fs').readFileSync as (p: string) => Buffer;
            const sink = fs.createWriteStream(dest);
            let done = false;
            const finish = (ok: boolean, message: string): void => {
                if (done) return;
                done = true;
                onDone(ok, message);
            };
            sink.once('error', () => finish(false, '写入目标文件失败，请检查剩余空间'));
            for (const p of parts) {
                let buf: Buffer;
                try {
                    buf = readFileSync(p);
                } catch {
                    try {
                        sink.destroy();
                    } catch {
                        /* 已经断了 */
                    }
                    finish(false, '分片文件读取失败，请重试');
                    return;
                }
                sink.write(buf);
            }
            sink.once('finish', () => finish(true, ''));
            sink.end();
        },
        /**
         * 🔴 必须等 `finish` 事件（或 `error`）才回调 —— `ws.end()` 只表示「不再写了」，
         *    字节还在用户态/内核缓冲里。同步往下走就会量到一个偏小的文件大小，
         *    且偏小幅度可能刚好落在 2% 容差内 ⇒ 假成功。实测差 565,206 字节（0.73%）。
         *    `error` 也当「已落定」处理：写盘失败时大小必然不对，交给上层的大小校验报错。
         */
        openWriter: (p) => {
            const ws = fs.createWriteStream(p);
            return {
                write: (c) => ws.write(c),
                close: (onFlushed) => {
                    let done = false;
                    const fire = (): void => {
                        if (done) return;
                        done = true;
                        onFlushed();
                    };
                    ws.once('finish', fire);
                    ws.once('error', fire);
                    ws.end();
                },
                abort: () => ws.destroy(),
            };
        },
        size: (p) => {
            try {
                return fs.statSync(p).size;
            } catch {
                return -1;
            }
        },
        rename: (a, b) => fs.renameSync(a, b),
        remove: (p) => {
            try {
                fs.unlinkSync(p);
            } catch {
                /* 不存在就算了 */
            }
        },
    };
}

/** 临时文件后缀（供调用方判断「目录里那些 .part 是什么」） */
export const DOWNLOAD_TMP_SUFFIX = ASR_DOWNLOAD_TMP_SUFFIX;
