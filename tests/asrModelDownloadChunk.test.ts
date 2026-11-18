import { describe, expect, it } from 'vitest';

import { downloadModel, type DownloadDeps } from 'services/asrModelDownload';
import { DOWNLOAD_CHUNK_BYTES, DOWNLOAD_PARALLEL } from 'pure/asrDownloadPlan';
import { tmpPathFor } from 'pure/asrModels';

/**
 * 分片并发 + 断点续传路径的单测（用户 m10363）。
 *
 * 🔴 为什么必须单独一套：分片能力全是 `DownloadDeps` 的**可选成员**，
 *    缺任何一个就退回单连接 —— 所以 `tests/asrModelDownload.test.ts` 那 20 条
 *    永远碰不到分片代码。没有这套，「关窗后片还在、下次接着下」可以被悄悄改坏而全绿。
 *
 * ⚠️ 全部用假 deps，不联网、不写真盘；`onChunk` 收到的是 `{ length: n }` 这种只有长度的替身，
 *    避免为了跑 5 片去分配 40MB 内存（实现只读 `.length` 与透传给 writer）。
 */

const MB = 1024 * 1024;
/** 5 片整（每片 8MB）—— 正好等于 `DOWNLOAD_PARALLEL + 1`，能验到「第 5 片要等名额」 */
const BIG = {
    url: 'https://example.test/big.bin',
    bytes: DOWNLOAD_CHUNK_BYTES * 5,
};

interface Req {
    url: string;
    start: number;
    end: number;
    onChunk: (b: Buffer) => void;
    onEnd: () => void;
    onError: (m: string) => void;
    aborted: boolean;
}

/** 假实现：文件系统是一张 Map，网络由测试逐片驱动 */
function mkDeps(init: { parts?: Record<number, number> } = {}) {
    const dest = '/dst/big.bin';
    const tmp = tmpPathFor(dest);
    const dir = `${tmp}.d`;
    const files = new Map<string, number>();
    for (const [i, n] of Object.entries(init.parts ?? {})) files.set(`${dir}/${i}.part`, n);

    const reqs: Req[] = [];
    /** 单连接路径（`open`）收到的请求 —— 用来证明分片路径**没有**走它 */
    const single: Req[] = [];
    const counts = {
        mkdirp: 0,
        concat: 0,
        rename: 0,
        removed: [] as string[],
        appendOpen: 0,
        open: 0,
        openWriter: 0,
    };
    let running = 0;
    let maxRunning = 0;

    const d: DownloadDeps = {
        // 单连接入口：正常可用，但分片路径一旦走到这里就会被计数器揭发
        open: (url, onChunk, onEnd, onError) => {
            counts.open += 1;
            const req: Req = { url, start: -1, end: -1, onChunk, onEnd, onError, aborted: false };
            single.push(req);
            return {
                abort: () => {
                    req.aborted = true;
                },
            };
        },
        openWriter: (p) => {
            counts.openWriter += 1;
            files.set(p, files.get(p) ?? 0);
            let closed = false;
            return {
                write: (c) => files.set(p, (files.get(p) ?? 0) + c.length),
                close: (onFlushed) => {
                    if (closed) return;
                    closed = true;
                    onFlushed();
                },
                abort: () => undefined,
            };
        },
        size: (p) => files.get(p) ?? -1,
        rename: (from, to) => {
            counts.rename += 1;
            files.set(to, files.get(from) ?? 0);
            files.delete(from);
        },
        remove: (p) => {
            counts.removed.push(p);
            files.delete(p);
        },
        mkdirp: (p) => {
            counts.mkdirp += 1;
            files.set(p, 0);
        },
        openRange: (url, start, end, onChunk, onEnd, onError) => {
            const req: Req = { url, start, end, onChunk, onEnd, onError, aborted: false };
            reqs.push(req);
            running += 1;
            if (running > maxRunning) maxRunning = running;
            return {
                abort: () => {
                    if (req.aborted) return;
                    req.aborted = true;
                    running -= 1;
                },
            };
        },
        openWriterAppend: (p) => {
            counts.appendOpen += 1;
            files.set(p, files.get(p) ?? 0);
            let closed = false;
            return {
                write: (c) => files.set(p, (files.get(p) ?? 0) + c.length),
                close: (onFlushed) => {
                    if (closed) return;
                    closed = true;
                    onFlushed();
                },
                abort: () => {
                    /* 假实现不截断，落盘多少就多少 */
                },
            };
        },
        concat: (parts, destPath, onDone) => {
            counts.concat += 1;
            let sum = 0;
            for (const p of parts) sum += files.get(p) ?? 0;
            files.set(destPath, sum);
            onDone(true, '');
        },
    };

    return {
        d,
        dest,
        tmp,
        dir,
        files,
        reqs,
        single,
        counts,
        get maxRunning() {
            return maxRunning;
        },
        /** 把这一片写完：喂满剩余字节再 end */
        feedFull(req: Req) {
            const need = req.end - req.start + 1;
            req.onChunk({ length: need } as unknown as Buffer);
            req.onEnd();
        },
        /** 只喂一部分就 end（模拟断流） */
        feedPartial(req: Req, n: number) {
            req.onChunk({ length: n } as unknown as Buffer);
            req.onEnd();
        },
        /**
         * 反复「喂满所有还没喂过的片」，直到没有新请求出现。
         * 🔴 必须循环：每喂完一片 `pump()` 才会发下一片，只喂一次首轮快照会让剩下的请求永远悬着
         *    （测试里表现为 5 秒超时，看着像产品卡死，其实是我这个夹具没跟上）。
         */
        drain(): void {
            const fed = new Set<Req>();
            for (let guard = 0; guard < 200; guard += 1) {
                const next = reqs.find((r) => !r.aborted && !fed.has(r));
                if (!next) return;
                fed.add(next);
                this.feedFull(next);
            }
            throw new Error('drain 没有收敛，分片调度可能死循环');
        },
    };
}

describe('downloadModel 分片并发（用户 m10363）', () => {
    it('≥4MB 且依赖齐全 ⇒ 走分片，不碰单连接', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest);
        expect(t.reqs.length).toBeGreaterThan(0);
        expect(t.counts.mkdirp).toBe(1);
        for (const r of t.reqs) t.feedFull(r);
        const res = await handle.done;
        expect(res.ok).toBe(true);
        expect(t.counts.rename).toBe(1);
    });

    it('在途并发不超过 DOWNLOAD_PARALLEL', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest);
        // 5 片：前 4 片同时在飞，第 5 片必须等到有空位
        expect(t.reqs).toHaveLength(DOWNLOAD_PARALLEL);
        expect(t.maxRunning).toBe(DOWNLOAD_PARALLEL);
        // 放完一批，第 5 片才发出去
        for (const r of t.reqs.slice()) t.feedFull(r);
        expect(t.reqs.length).toBe(5);
        t.feedFull(t.reqs[4]);
        await handle.done;
    });

    it('已下过的片不再重下（断点续传的核心）', async () => {
        const t = mkDeps({ parts: { 0: DOWNLOAD_CHUNK_BYTES, 1: 3 * MB } });
        const handle = downloadModel(t.d, BIG, t.dest);
        // 第 0 片已满 ⇒ 不该出现在请求里
        expect(t.reqs.some((r) => r.start === 0)).toBe(false);
        // 第 1 片只差 5MB ⇒ 起点必须从「已有 3MB」之后开始
        const r1 = t.reqs.find((r) => r.start === DOWNLOAD_CHUNK_BYTES + 3 * MB);
        expect(r1).toBeDefined();
        expect(r1?.end).toBe(2 * DOWNLOAD_CHUNK_BYTES - 1);
        t.drain();
        await handle.done;
    });

    it('片文件比应有长度还大 ⇒ 整片重下，不从偏大处接着写', async () => {
        // 第 0 片多出 100 字节：不可信（拼出来模型头部会错位）
        const t = mkDeps({ parts: { 0: DOWNLOAD_CHUNK_BYTES + 100 } });
        const handle = downloadModel(t.d, BIG, t.dest);
        const r0 = t.reqs.find((r) => r.start === 0);
        expect(r0).toBeDefined();
        expect(r0?.end).toBe(DOWNLOAD_CHUNK_BYTES - 1);
        t.drain();
        await handle.done;
    });

    it('中途断流 ⇒ 失败但**保留片文件**（下次接着下）', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest);
        const first = t.reqs[0];
        t.feedPartial(first, 1234);
        const res = await handle.done;
        expect(res.ok).toBe(false);
        expect(res.message).toContain('保留');
        // 片文件没被删：只可能被删的是拼合目标 tmp
        expect(t.counts.removed).not.toContain(`${t.dir}/0.part`);
        expect(t.files.get(`${t.dir}/0.part`) ?? 0).toBeGreaterThan(0);
    });

    it('全部下完 ⇒ 拼合、改名、清掉全部片', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest);
        t.drain();
        const res = await handle.done;
        expect(res.ok).toBe(true);
        expect(t.counts.concat).toBe(1);
        expect(t.files.get(t.dest)).toBe(BIG.bytes);
        for (let i = 0; i < 5; i += 1) expect(t.files.has(`${t.dir}/${i}.part`)).toBe(false);
    });

    it('拼出来的大小不对 ⇒ 清掉全部片（⛔ 留着只会反复失败）', async () => {
        const t = mkDeps();
        // 拼合时故意少写 1MB（远超 2% 容差），模拟片坏了
        const realConcat = t.d.concat;
        t.d.concat = (parts, destPath, onDone) => {
            t.counts.concat += 1;
            let sum = 0;
            for (const p of parts) sum += t.files.get(p) ?? 0;
            t.files.set(destPath, Math.max(0, sum - 1024 * 1024));
            onDone(true, '');
        };
        const handle = downloadModel(t.d, BIG, t.dest);
        t.drain();
        const res = await handle.done;
        expect(res.ok).toBe(false);
        expect(res.message).toContain('不完整');
        for (let i = 0; i < 5; i += 1) expect(t.files.has(`${t.dir}/${i}.part`)).toBe(false);
        t.d.concat = realConcat;
    });

    it('取消 ⇒ 掐断全部在途请求，且不拼合', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest);
        const inflight = t.reqs.slice();
        expect(inflight).toHaveLength(DOWNLOAD_PARALLEL);
        handle.cancel();
        expect(inflight.every((r) => r.aborted)).toBe(true);
        const res = await handle.done;
        expect(res.ok).toBe(false);
        expect(t.counts.concat).toBe(0);
    });

    it('某个地址返回服务器错误 ⇒ 不换源（换也一样）', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest, undefined, 'https://mirror.test/big.bin');
        const before = t.reqs.length;
        t.reqs[0].onError('服务器返回 404，可能地址已失效或需要代理');
        const res = await handle.done;
        expect(res.ok).toBe(false);
        expect(res.message).toContain('404');
        // 🔴 语义已反（用户 m07854 ⑨）：首轮就是镜像，切过去的是**官方**。
        //    断言重点不是「哪个地址」，而是「没有任何后续请求改用另一个源」——
        //    HTTP 状态码错说明文件本身不对，换源白等一轮。
        const after = t.reqs.slice(before);
        expect(after.filter((r) => r.url === BIG.url).length).toBe(0);
    });

    it('网络层失败 ⇒ 换源（镜像 → 官方），且失败的那片塞回队首重试', async () => {
        const t = mkDeps();
        const handle = downloadModel(t.d, BIG, t.dest, undefined, 'https://mirror.test/big.bin');
        const first = t.reqs[0];
        const wanted = { start: first.start, end: first.end };
        // 首轮必须是镜像（用户 m07854 ⑨「统一启用国内镜像源」）
        expect(first.url).toContain('mirror');
        first.onError('connect ETIMEDOUT');
        // 换源后这一片必须重新发出去（改用官方地址、同样的区间）
        const retry = t.reqs.find((r) => r.url === BIG.url && r.start === wanted.start);
        expect(retry).toBeDefined();
        expect(retry?.end).toBe(wanted.end);
        // 后续新发的片也直接用官方，⛔ 不再每片先撞一次镜像
        t.drain();
        await handle.done;
    });

    it('小文件 / 总长未知 ⇒ 退回单连接（不该开分片）', async () => {
        const small = { url: BIG.url, bytes: 100 };
        const t = mkDeps();
        // 单连接路径的桩：走 open 才算对
        let opened = 0;
        t.d.open = (_u, _c, onEnd) => {
            opened += 1;
            onEnd();
            return { abort: () => undefined };
        };
        const handle = downloadModel(t.d, small, t.dest);
        const res = await handle.done;
        expect(opened).toBe(1);
        expect(t.counts.mkdirp).toBe(0);
        expect(res.ok).toBe(false); // 没喂字节，大小对不上
    });

    it('换镜像时记录「已下部分」不丢（回落不等于清零片文件）', async () => {
        const t = mkDeps({ parts: { 0: DOWNLOAD_CHUNK_BYTES } });
        const handle = downloadModel(t.d, BIG, t.dest, undefined, 'https://mirror.test/big.bin');
        // 第 1 片下了一半就断
        const r1 = t.reqs.find((r) => r.start === DOWNLOAD_CHUNK_BYTES);
        expect(r1).toBeDefined();
        t.feedPartial(r1 as Req, 2 * MB);
        const res = await handle.done;
        expect(res.ok).toBe(false);
        // 半片留在盘上，下次从这里接着走
        expect(t.files.get(`${t.dir}/1.part`) ?? 0).toBe(2 * MB);
    });
});
