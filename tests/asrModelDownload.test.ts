import { describe, expect, it } from 'vitest';

import { downloadModel, type DownloadDeps } from 'services/asrModelDownload';
import { ASR_MODEL_PRESETS, tmpPathFor } from 'pure/asrModels';

const PRESET = ASR_MODEL_PRESETS[1]; // base 档 147951465 字节，用写成小体积的假预设更省事
/** 用一档 100 字节的假预设，避免测试里堆 MB 级数据 */
const SMALL = {
    tier: 'tiny' as const,
    title: 'tiny',
    subtitle: '最快，精度最低',
    scene: '测试用',
    url: 'https://example.test/m.bin',
    fileName: 'm.bin',
    bytes: 100,
    recommended: false,
};

/** 假实现：文件系统只有一张 Map，下载由测试手动供字节 */
function deps(init: { existing?: number } = {}) {
    const files = new Map<string, number>();
    if (init.existing !== undefined) files.set('/dst/m.bin', init.existing);
    const written: Buffer[] = [];
    const calls = { open: 0, rename: 0, remove: 0, abort: 0 };
    let chunkCb: ((c: Buffer) => void) | null = null;
    let endCb: (() => void) | null = null;
    let errCb: ((m: string) => void) | null = null;
    const d: DownloadDeps = {
        open: (_url, onChunk, onEnd, onError) => {
            calls.open += 1;
            chunkCb = onChunk;
            endCb = onEnd;
            errCb = onError;
            return {
                abort: () => {
                    calls.abort += 1;
                },
            };
        },
        openWriter: (path) => {
            files.set(path, 0);
            return {
                write: (c) => {
                    written.push(c);
                    files.set(path, (files.get(path) ?? 0) + c.length);
                },
                close: (onFlushed) => {
                    onFlushed();
                },
                abort: () => undefined,
            };
        },
        size: (p) => files.get(p) ?? -1,
        rename: (from, to) => {
            calls.rename += 1;
            files.set(to, files.get(from) ?? 0);
            files.delete(from);
        },
        remove: (p) => {
            calls.remove += 1;
            files.delete(p);
        },
    };
    return {
        d,
        files,
        written,
        calls,
        feed: (n: number) => chunkCb?.(Buffer.alloc(n)),
        end: () => endCb?.(),
        fail: (m: string) => errCb?.(m),
    };
}

describe('downloadModel', () => {
    it('正常下完：写 .part → 校验 → 改名', async () => {
        const h = deps();
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(60);
        h.feed(40);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(true);
        expect(r.path).toBe('/dst/m.bin');
        expect(h.calls.rename).toBe(1);
        // 临时文件用过且已不在
        expect(h.files.has(tmpPathFor('/dst/m.bin'))).toBe(false);
        expect(h.files.get('/dst/m.bin')).toBe(100);
    });

    it('中途回调进度（含百分比与已收字节）', async () => {
        const h = deps();
        const seen: Array<number | null> = [];
        const p = downloadModel(h.d, SMALL, '/dst/m.bin', (pct) => seen.push(pct));
        h.feed(25);
        h.feed(25);
        // 必须喂满：只喂一半就 end 会走「下载不完整」分支（那是另一条路径，已被单独覆盖）
        h.feed(50);
        h.end();
        await p.done;
        expect(seen[0]).toBe(25);
        expect(seen[1]).toBe(50);
        // 收尾补一次 100
        expect(seen[seen.length - 1]).toBe(100);
    });

    it('已存在完整文件 ⇒ 幂等成功，不重新下载', async () => {
        const h = deps({ existing: 100 });
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        const r = await p.done;
        expect(r.ok).toBe(true);
        expect(h.calls.open).toBe(0);
        expect(h.calls.rename).toBe(0);
    });

    it('已存在半个文件 ⇒ 删掉重下（⛔ 不 append 到坏文件）', async () => {
        const h = deps({ existing: 30 });
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        expect(h.calls.remove).toBe(1);
        h.feed(100);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(true);
        expect(h.files.get('/dst/m.bin')).toBe(100);
    });

    it('下载不完整 ⇒ 失败并删掉 .part（⛔ 留下半个模型）', async () => {
        const h = deps();
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(40);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('下载不完整');
        expect(h.files.has(tmpPathFor('/dst/m.bin'))).toBe(false);
        expect(h.files.has('/dst/m.bin')).toBe(false);
        expect(h.calls.rename).toBe(0);
    });

    it('网络出错 ⇒ 失败并清掉 .part', async () => {
        const h = deps();
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(10);
        h.fail('socket hang up');
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toBe('socket hang up');
        expect(h.files.has(tmpPathFor('/dst/m.bin'))).toBe(false);
    });

    it('取消 ⇒ 报「已取消下载」并清掉 .part', async () => {
        const h = deps();
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(10);
        p.cancel();
        expect(h.calls.abort).toBe(1);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toBe('已取消下载');
        expect(h.files.has(tmpPathFor('/dst/m.bin'))).toBe(false);
    });

    it('重复 cancel 只 abort 一次（幂等）', async () => {
        const h = deps();
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        p.cancel();
        p.cancel();
        expect(h.calls.abort).toBe(1);
        h.end();
        await p.done;
    });

    it('建写入流失败 ⇒ 人话报错', async () => {
        const h = deps();
        h.d.openWriter = () => {
            throw new Error('EACCES');
        };
        const r = await downloadModel(h.d, SMALL, '/dst/m.bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('无法创建下载文件');
    });

    it('写盘失败 ⇒ 报磁盘问题并中止', async () => {
        const h = deps();
        h.d.openWriter = () => ({
            write: () => {
                throw new Error('ENOSPC');
            },
            close: () => undefined,
            abort: () => undefined,
        });
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(10);
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('写入磁盘失败');
    });

    it('改名失败 ⇒ 人话报错且不留 .part', async () => {
        const h = deps();
        h.d.rename = () => {
            throw new Error('EPERM');
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(100);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('重命名失败');
        expect(h.files.has(tmpPathFor('/dst/m.bin'))).toBe(false);
    });

    it('发请求就抛错 ⇒ 人话报错', async () => {
        const h = deps();
        h.d.open = () => {
            throw new Error('ENOTFOUND');
        };
        const r = await downloadModel(h.d, SMALL, '/dst/m.bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('无法发起下载');
    });

    it('预设与常量对齐（防手改漏改）', () => {
        // m09123：主标题改成上游原始档位名，等于 tier —— 各档不许再自造「极速版」这类名字
        expect(PRESET.title).toBe(PRESET.tier);
    });
});

describe('downloadModel 换源回落', () => {
    const MIRROR = 'https://mirror.test/m.bin';

    // 🔴 用户 m07854 ⑨「下载模型统一启用国内镜像源」之后，第 5 参的语义反了：
    //    它现在是**首选地址**（镜像），失败后回落到 `preset.url`（官方）。
    //    ⚠️ 改前是「官方优先、失败回落镜像」—— 官方在国内必然先超时十几秒，
    //       用户看到的是「点了下载卡住不动」。
    it('镜像首选，网络层失败 ⇒ 回落官方源重试，并成功', async () => {
        const h = deps();
        const urls: string[] = [];
        const inner = h.d.open;
        h.d.open = (url, onChunk, onEnd, onError) => {
            urls.push(url);
            return inner(url, onChunk, onEnd, onError);
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin', undefined, MIRROR);
        h.feed(40);
        h.fail('connect ETIMEDOUT 1.2.3.4:443'); // 第一次：网络层失败
        h.feed(100);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(true);
        expect(urls).toEqual([MIRROR, SMALL.url]);
        // 回落前的半截数据必须清掉，⛔ 两个源的数据不能拼
        expect(h.written.length).toBe(2);
    });

    it('不传第 5 参 ⇒ 只用官方源，没有回落（单源退化）', async () => {
        const h = deps();
        const urls: string[] = [];
        const inner = h.d.open;
        h.d.open = (url, onChunk, onEnd, onError) => {
            urls.push(url);
            return inner(url, onChunk, onEnd, onError);
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.fail('connect ETIMEDOUT 1.2.3.4:443');
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(urls).toEqual([SMALL.url]);
    });

    it('回落时进度归零重来（不能从 100% 往下掉）', async () => {
        const h = deps();
        const seen: Array<number | null> = [];
        const p = downloadModel(h.d, SMALL, '/dst/m.bin', (pct) => seen.push(pct), MIRROR);
        h.feed(60);
        h.fail('socket hang up');
        h.feed(100);
        h.end();
        await p.done;
        // 回落那一刻显式推一次 0
        expect(seen).toContain(0);
        expect(seen[seen.length - 1]).toBe(100);
    });

    it('服务器返回 404 ⇒ 不换源，直接报错（换源也一样）', async () => {
        const h = deps();
        let opens = 0;
        const inner = h.d.open;
        h.d.open = (url, onChunk, onEnd, onError) => {
            opens += 1;
            return inner(url, onChunk, onEnd, onError);
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin', undefined, MIRROR);
        h.fail('服务器返回 404');
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('404');
        expect(opens).toBe(1);
    });

    it('换源只试一次（官方也失败就报错，不死循环）', async () => {
        const h = deps();
        let opens = 0;
        const inner = h.d.open;
        h.d.open = (url, onChunk, onEnd, onError) => {
            opens += 1;
            return inner(url, onChunk, onEnd, onError);
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin', undefined, MIRROR);
        h.fail('ETIMEDOUT');
        h.fail('ETIMEDOUT');
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(opens).toBe(2);
    });

    it('没传镜像地址 ⇒ 一次失败即报错（旧行为不变）', async () => {
        const h = deps();
        let opens = 0;
        const inner = h.d.open;
        h.d.open = (url, onChunk, onEnd, onError) => {
            opens += 1;
            return inner(url, onChunk, onEnd, onError);
        };
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.fail('ETIMEDOUT');
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(opens).toBe(1);
    });
});

describe('downloadModel 落盘时机', () => {
    it('close 是异步的 ⇒ 必须在回调里才校验大小（真机抓到的假成功）', async () => {
        const h = deps();
        // 模拟 createWriteStream：end() 之后字节还没落盘，稍后才补齐
        const realSizes = new Map<string, number>();
        h.d.openWriter = (path) => {
            const buf: Buffer[] = [];
            realSizes.set(path, 0);
            return {
                write: (c) => {
                    buf.push(c);
                },
                close: (onFlushed) => {
                    // 异步：下一轮事件循环才把字节记到文件系统
                    setTimeout(() => {
                        realSizes.set(path, buf.reduce((n, b) => n + b.length, 0));
                        onFlushed();
                    }, 5);
                },
                abort: () => undefined,
            };
        };
        h.d.size = (p) => realSizes.get(p) ?? -1;
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(100);
        h.end();
        const r = await p.done;
        // 如果实现是在 close 回调**之前**量大小，这里会得到 -1 或 0 ⇒ 报「下载不完整」
        expect(r.ok).toBe(true);
        expect(r.path).toBe('/dst/m.bin');
    });

    it('close 后大小仍不对 ⇒ 仍要报下载不完整', async () => {
        const h = deps();
        const realSizes = new Map<string, number>();
        h.d.openWriter = (path) => {
            realSizes.set(path, 0);
            return {
                write: () => undefined, // 故意不落盘
                close: (onFlushed) => {
                    setTimeout(onFlushed, 1);
                },
                abort: () => undefined,
            };
        };
        h.d.size = (p) => realSizes.get(p) ?? -1;
        const p = downloadModel(h.d, SMALL, '/dst/m.bin');
        h.feed(100);
        h.end();
        const r = await p.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('下载不完整');
    });
});
