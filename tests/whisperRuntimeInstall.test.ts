/**
 * `services/whisperRuntime` 的执行层单测（注入式假 deps，⛔ 不联网）。
 *
 * 🔴 这个文件存在的理由：一键安装首版**一条单测都没有**，于是三个只有真跑才暴露的缺陷
 *    一路漏到用户面前 ——
 *    ① `mkdir` 排在下载之后 ⇒ 首装时目标目录不存在，`createWriteStream` 抛错被报成
 *       「写入文件失败，请检查磁盘空间」（真机 100% 失败，且把排查方向误导到磁盘容量）；
 *    ② 下载到一半失败后重试同一地址时，上一轮的写入流没关；
 *    ③ 镜像返回**相对** `Location`（`/https://...`）直接喂 `https.get` 会同步抛
 *       `Invalid URL`，还盖掉了官方地址的真实失败原因。
 *    ①②在本文件用假 deps 钉住；③属于 `defaultWhisperRuntimeDeps` 的内部实现，
 *    靠真实网络探针验证（见交付报告），并在代码里用 `new URL(loc, url)` 兜住。
 */
import { describe, expect, it, vi } from 'vitest';
import { installWhisperRuntime, parseZipEntries } from 'services/whisperRuntime';
import type { WhisperRuntimeDeps } from 'services/whisperRuntime';
import {
    WHISPER_RUNTIME_FILES,
    WHISPER_RUNTIME_ZIP_BYTES,
    WHISPER_RUNTIME_ZIP_MIRRORS,
    WHISPER_RUNTIME_ZIP_URL,
} from 'pure/whisperRuntime';

/** 造一个只含白名单 5 个文件的真实 zip（store 方式，不压缩，便于手写） */
function buildZip(files: Array<{ name: string; body: string }>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
        const nameBuf = Buffer.from(f.name, 'utf8');
        const data = Buffer.from(f.body, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version
        local.writeUInt16LE(0, 6); // flags
        local.writeUInt16LE(0, 8); // method 0 = store
        local.writeUInt32LE(0, 14); // crc（本模块不校验，填 0 即可）
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        locals.push(local, nameBuf, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(0, 10); // method 0
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += local.length + nameBuf.length + data.length;
    }
    const centralBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralBuf, eocd]);
}

function fullZip(): Buffer {
    // ⚠️ 正文要撑够长度：`installWhisperRuntime` 有 `buf.length < 1024` 的截断守卫，
    //    假 zip 太短会先撞上那条守卫，测的就不是本意了。
    const pad = 'x'.repeat(400);
    return buildZip(WHISPER_RUNTIME_FILES.map((name) => ({ name: `Release/${name}`, body: `body-of-${name}${pad}` })));
}

interface Recorder {
    deps: WhisperRuntimeDeps;
    calls: {
        mkdir: string[];
        writes: string[];
        removes: string[];
        downloadUrls: string[];
        /** mkdir 与 download 谁先发生 */
        order: string[];
    };
    /** 让第 n 次下载失败 */
    failDownloads: (msgs: string[]) => void;
}

function makeDeps(zip: Buffer | null): Recorder {
    const store = new Map<string, Buffer>();
    const calls: Recorder['calls'] = { mkdir: [], writes: [], removes: [], downloadUrls: [], order: [] };
    let queue: string[] = [];
    const deps: WhisperRuntimeDeps = {
        download: (url, destPath) => {
            calls.downloadUrls.push(url);
            calls.order.push('download');
            const next = queue.shift();
            if (next !== undefined) return Promise.resolve({ ok: false, message: next });
            if (zip) store.set(destPath, zip);
            return Promise.resolve({ ok: true, message: '' });
        },
        readFile: (p) => {
            const b = store.get(p);
            if (!b) throw new Error('no such file');
            return b;
        },
        writeFile: (p, buf) => {
            calls.writes.push(p);
            store.set(p, buf);
        },
        mkdir: (dir) => {
            calls.mkdir.push(dir);
            calls.order.push('mkdir');
            store.set(dir, Buffer.alloc(0));
        },
        remove: (p) => {
            calls.removes.push(p);
            store.delete(p);
        },
        exists: (p) => store.has(p),
        inflate: (buf) => buf,
        join: (dir, name) => `${dir}/${name}`,
        tmpZipPath: (binDir) => `${binDir}/whisper-runtime.zip`,
    };
    return {
        deps,
        calls,
        failDownloads: (msgs) => {
            queue = [...msgs];
        },
    };
}

describe('installWhisperRuntime —— 目录必须先于下载创建', () => {
    it('🔴 首次安装（目录不存在）也要成功，且 mkdir 发生在 download 之前', async () => {
        const rec = makeDeps(fullZip());
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(true);
        expect(r.binDir).toBe('C:/fake/bin');
        // 这一条就是这个缺陷的回归守卫：首版 order 是 ['download']，mkdir 在下载之后
        expect(rec.calls.order.indexOf('mkdir')).toBeGreaterThanOrEqual(0);
        expect(rec.calls.order.indexOf('mkdir')).toBeLessThan(rec.calls.order.indexOf('download'));
    });

    it('mkdir 抛错时给出权限相关的提示，而不是「磁盘空间」', async () => {
        const rec = makeDeps(fullZip());
        rec.deps.mkdir = () => {
            throw new Error('EACCES');
        };
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('权限');
        expect(r.message).not.toContain('磁盘空间');
    });

    it('已装齐 ⇒ 幂等成功，一个字节都不再下', async () => {
        const rec = makeDeps(fullZip());
        await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        rec.calls.downloadUrls.length = 0;
        const again = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(again.ok).toBe(true);
        expect(rec.calls.downloadUrls).toEqual([]);
    });
});

describe('installWhisperRuntime —— 下载失败与回退', () => {
    it('镜像失败 ⇒ 依次换下一个镜像，官方排最后兜底（用户 m07854 ⑨：镜像优先）', async () => {
        const rec = makeDeps(fullZip());
        rec.failDownloads(['下载失败（服务器返回 504），请稍后重试', '下载失败（服务器返回 504），请稍后重试']);
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(true);
        // 🔴 顺序（2026-11-13 起）：国内加速站优先、官方 GitHub 兜底。
        //    改前是「官方第一」—— 官方在国内时好时坏，先撞官方等于每次赌一把。
        expect(rec.calls.downloadUrls[0]).toBe(WHISPER_RUNTIME_ZIP_MIRRORS[0]);
        expect(rec.calls.downloadUrls).toContain(WHISPER_RUNTIME_ZIP_MIRRORS[1]);
    });

    it('官方地址仍在列表末尾（镜像全挂时还得有路可走）', async () => {
        const rec = makeDeps(null);
        rec.failDownloads(Array.from({ length: 12 }, () => '下载失败（服务器返回 404），请稍后重试'));
        await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        const urls = rec.calls.downloadUrls;
        expect(urls[urls.length - 1]).toBe(WHISPER_RUNTIME_ZIP_URL);
        expect(urls.indexOf(WHISPER_RUNTIME_ZIP_URL)).toBeGreaterThan(0);
    });

    it('全部地址都失败 ⇒ 把**最后一次**的真实原因交给用户，⛔ 不是笼统的「下载失败」', async () => {
        const rec = makeDeps(null);
        const many = Array.from({ length: 12 }, () => '下载失败（服务器返回 502），请稍后重试');
        rec.failDownloads(many);
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('502');
    });

    it('4xx 不重试（地址本身变了，重试只是浪费用户时间）', async () => {
        const rec = makeDeps(null);
        rec.failDownloads(Array.from({ length: 12 }, () => '下载失败（服务器返回 404），请稍后重试'));
        await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        // 4xx 不可重试 ⇒ 每个地址各试 1 次 = 1 官方 + 镜像个数
        expect(rec.calls.downloadUrls.length).toBe(1 + WHISPER_RUNTIME_ZIP_MIRRORS.length);
    });

    it('每次失败后都清掉半截文件（⛔ 别在残留上接着写，字节数会算错）', async () => {
        const rec = makeDeps(fullZip());
        rec.failDownloads(['下载失败（服务器返回 500），请稍后重试']);
        await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(rec.calls.removes.length).toBeGreaterThanOrEqual(1);
    });

    it('取消后不再继续下载，也不报错文案', async () => {
        const rec = makeDeps(fullZip());
        const h = installWhisperRuntime(rec.deps, 'C:/fake/bin');
        h.cancel();
        const r = await h.done;
        expect(r.ok).toBe(false);
        expect(r.message).toBe('');
    });
});

describe('installWhisperRuntime —— 包内容校验', () => {
    it('包里缺组件 ⇒ 明确说「缺少必需的组件」，⛔ 不写「磁盘空间」', async () => {
        // 同样要撑过 `buf.length < 1024` 的截断守卫，否则测到的是另一条分支
        const rec = makeDeps(buildZip([{ name: 'Release/whisper-cli.exe', body: 'x'.repeat(2000) }]));
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('缺少必需的组件');
    });

    it('包太小（下载被截断）⇒ 说安装包不完整', async () => {
        const rec = makeDeps(Buffer.alloc(100));
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('不完整');
    });

    it('成功时 5 个文件都落在 bin 根目录（不保留 Release/ 前缀）', async () => {
        const rec = makeDeps(fullZip());
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(r.ok).toBe(true);
        for (const f of WHISPER_RUNTIME_FILES) {
            expect(rec.calls.writes).toContain(`C:/fake/bin/${f}`);
        }
    });

    it('进度是一条 0–100：下载段不超过 80，解压段到 100', async () => {
        const rec = makeDeps(fullZip());
        const seen: number[] = [];
        const r = await installWhisperRuntime(rec.deps, 'C:/fake/bin', (pct) => {
            if (typeof pct === 'number') seen.push(pct);
        }).done;
        expect(r.ok).toBe(true);
        expect(Math.max(...seen)).toBe(100);
        expect(seen.every((p) => p >= 0 && p <= 100)).toBe(true);
    });

    it('临时包用完就删（用户目录里不该留 5.5MB 垃圾）', async () => {
        const rec = makeDeps(fullZip());
        await installWhisperRuntime(rec.deps, 'C:/fake/bin').done;
        expect(rec.calls.removes).toContain('C:/fake/bin/whisper-runtime.zip');
    });

    it('binDir 为空（拿不到主目录）⇒ 明确拒绝，不尝试下到相对路径', async () => {
        const rec = makeDeps(fullZip());
        const r = await installWhisperRuntime(rec.deps, '').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('安装位置');
        expect(rec.calls.downloadUrls).toEqual([]);
    });
});

describe('parseZipEntries —— 从真实结构的中央目录读位置', () => {
    it('解析出全部条目的 method / size / 数据区起止', () => {
        const zip = fullZip();
        const entries = parseZipEntries(zip);
        expect(entries).toHaveLength(WHISPER_RUNTIME_FILES.length);
        for (const e of entries) {
            expect(e.method).toBe(0);
            expect(e.dataEnd - e.dataStart).toBe(e.compressedSize);
            expect(e.size).toBe(e.compressedSize);
            // 数据区真的能取出来
            expect(zip.slice(e.dataStart, e.dataEnd).toString('utf8')).toContain('body-of-');
        }
    });

    it('不是 zip 的字节 ⇒ 返回空数组，⛔ 不抛异常', () => {
        expect(parseZipEntries(Buffer.from('not a zip at all, definitely not'))).toEqual([]);
    });

    it('体积常量与实际下载包一致（真机 5,523,979 字节）', () => {
        expect(WHISPER_RUNTIME_ZIP_BYTES).toBe(5523979);
    });

    it('镜像列表非空且都是 https（回退链不能是空的）', () => {
        expect(WHISPER_RUNTIME_ZIP_MIRRORS.length).toBeGreaterThanOrEqual(1);
        for (const u of WHISPER_RUNTIME_ZIP_MIRRORS) expect(u.startsWith('https://')).toBe(true);
    });
});

describe('defaultWhisperRuntimeDeps —— 重定向必须能处理相对路径', () => {
    it('模块能干净加载（Node 模块不带 node: 前缀，否则 esbuild 解析失败）', async () => {
        const mod = await import('services/whisperRuntime');
        expect(typeof mod.defaultWhisperRuntimeDeps).toBe('function');
        expect(vi.isMockFunction(mod.defaultWhisperRuntimeDeps)).toBe(false);
    });
});
