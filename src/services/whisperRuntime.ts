/**
 * whisper.cpp 运行时的**一键安装执行层**（下载 → 解压 → 落到 `~/.reelludic/bin/`）。
 *
 * 🔴 为什么不引第三方 zip 库：`main.js` 已逼近 5MB 上限（用户定的硬线），
 *    随便一个 zip 解析器都要几十~几百 KB。而这里只需要「解开一个自家知道结构的压缩包」：
 *    zip 的中央目录格式 20 年来没变过，Node 自带的 `zlib.inflateRawSync` 就够。
 *    ⛔ 别为了「支持所有 zip」把它写通用 —— 通用 zip 解析才是那个需要库的东西。
 *
 * ⚠️ 所有依赖注入（`WhisperRuntimeDeps`），单测才能在没有网络/磁盘的机器上跑；
 *    真实现是 `defaultWhisperRuntimeDeps()`，惰性 `require`（移动端没有 Node 模块）。
 * ⚠️ Node 模块一律**不带 `node:` 前缀** —— esbuild 的 external 清单是不带前缀那份，
 *    写 `require('node:fs')` 会 `Could not resolve`（见 `services/asrModelDownload` 同款注释）。
 */

import {
    WHISPER_RUNTIME_FILES,
    WHISPER_RUNTIME_ZIP_BYTES,
    WHISPER_RUNTIME_ZIP_MIRRORS,
    WHISPER_RUNTIME_ZIP_URL,
    installLabel,
    installPercent,
    runtimeFilePlan,
} from 'pure/whisperRuntime';
import { createSpeedMeter, speedSuffix } from 'pure/speedMeter';

/** 一次安装的结果 */
export interface InstallResult {
    ok: boolean;
    /** 失败时的一句话原因；成功为空串 */
    message: string;
    /** 装完之后的 bin 目录（成功时非空） */
    binDir?: string;
}

/** 进度回调（与转写那条同构：`percent` 为 null 时只更新文案） */
export type InstallProgress = (percent: number | null, label: string) => void;

/** 交互句柄：`done` 等结果，`cancel()` 幂等 */
export interface InstallHandle {
    done: Promise<InstallResult>;
    cancel: () => void;
}

/** zip 中央目录里我们关心的那几项 */
export interface ZipEntry {
    name: string;
    /** 解压方式：0 = store（不压缩）、8 = deflate */
    method: number;
    compressedSize: number;
    size: number;
    /** 数据区在整包里的起止（已按本地头解析好） */
    dataStart: number;
    dataEnd: number;
}

/** 执行层依赖（真源 = `defaultWhisperRuntimeDeps`） */
export interface WhisperRuntimeDeps {
    /** 下载到临时文件；`onChunk` 报告累计字节 */
    download: (url: string, destPath: string, onChunk: (received: number, total: number) => void) => Promise<{ ok: boolean; message: string }>;
    readFile: (p: string) => Buffer;
    writeFile: (p: string, buf: Buffer) => void;
    mkdir: (dir: string) => void;
    remove: (p: string) => void;
    exists: (p: string) => boolean;
    /** 解压单个条目（method 8 走 inflateRaw，method 0 原样切片） */
    inflate: (buf: Buffer, method: number) => Buffer;
    join: (dir: string, name: string) => string;
    /** 中间 zip 放在哪儿（同一块盘，避免跨盘 IO） */
    tmpZipPath: (binDir: string) => string;
}

/**
 * 解析 zip 的**中央目录**，返回白名单里那些条目的位置。
 *
 * 🔴 为什么不从本地头一路往后扫：本地头的字段长度不确定（有 extra field、data descriptor），
 *    扫到一半就会错位。中央目录（End of Central Directory → 条目表）长度字段是**定长**的，
 *    是唯一可靠的入口。这也是为什么 `runtimeFilePlan` 只挑名字、不猜顺序。
 * ⚠️ 只支持单个磁盘、无 zip64、无加密 —— 官方那个 5.5MB 包就是这样。别为它写通用支持。
 */
export function parseZipEntries(buf: Buffer): ZipEntry[] {
    // ① 找 End of Central Directory（`PK\x05\x06`），从尾部往前找（后面可能有注释）
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i -= 1) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) return [];
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const out: ZipEntry[] = [];
    for (let i = 0; i < count; i += 1) {
        // 中央目录条目签名 `PK\x01\x02`
        if (p + 46 > buf.length) break;
        if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) break;
        const method = buf.readUInt16LE(p + 10);
        const compressedSize = buf.readUInt32LE(p + 20);
        const size = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOffset = buf.readUInt32LE(p + 42);
        const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
        // 本地头比中央目录多 name/extra 两个「可能不同长度」的字段 ⇒ 必须从本地头重量一次
        if (localOffset + 30 <= buf.length && buf[localOffset] === 0x50 && buf[localOffset + 1] === 0x4b) {
            const lNameLen = buf.readUInt16LE(localOffset + 26);
            const lExtraLen = buf.readUInt16LE(localOffset + 28);
            const dataStart = localOffset + 30 + lNameLen + lExtraLen;
            out.push({ name, method, compressedSize, size, dataStart, dataEnd: dataStart + compressedSize });
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

/**
 * 安装 whisper.cpp 运行时。
 *
 * 流程：临时 zip → 下完校验体积 → 解析中央目录 → 按白名单解 5 个文件 → 删临时包。
 * ⚠️ 目标文件已全部在位 ⇒ 直接幂等成功（用户重开设置页点两次不该重下 5.5MB）。
 * ⚠️ 失败文案一律人话，⛔ 不把 `ETIMEDOUT` / `inflate` 这种词丢给用户。
 */
export function installWhisperRuntime(deps: WhisperRuntimeDeps, binDir: string, onProgress?: InstallProgress): InstallHandle {
    let cancelled = false;
    let cancelDownload: (() => void) | null = null;
    /** 🔴 m10754：实时速率（下载阶段才知道 `received`，转码阶段拿不到就自然停在旧值） */
    const meter = createSpeedMeter();

    const done = (async (): Promise<InstallResult> => {
        if (!binDir) return { ok: false, message: '无法确定安装位置（拿不到用户主目录）' };
        // ① 已经装好 ⇒ 幂等成功
        if (deps.exists(binDir)) {
            const have = WHISPER_RUNTIME_FILES.filter((f) => deps.exists(deps.join(binDir, f)));
            if (have.length === WHISPER_RUNTIME_FILES.length) return { ok: true, message: '', binDir };
        }

        // 🔴 必须**先**把目录建出来再下载：`tmpZipPath(binDir)` 指向 `binDir/whisper-runtime.zip`，
        //    而首装时 `binDir` 根本不存在 ⇒ `createWriteStream` 直接抛错，被报成
        //    「写入文件失败，请检查磁盘空间」。真机实测踩过：用户第一次安装 100% 失败，
        //    且提示误导排查方向（磁盘明明有几十 G）。`mkdir` 是 recursive 的，已存在也安全。
        try {
            deps.mkdir(binDir);
        } catch {
            return { ok: false, message: '无法创建安装目录，请检查该路径的写入权限' };
        }

        const tmp = deps.tmpZipPath(binDir);
        // 🔴 顺序：国内加速站优先 → 官方 GitHub 兜底（用户 m07854 ⑨「统一启用国内镜像源」）。
        //    改前是「官方优先 → 镜像兜底」，实测官方在国内**时好时坏**（同一分钟内出现过
        //    完整拉完 5,523,979 字节与连续 8 次 504），先撞官方等于每次都赌一把。
        //    ⚠️ 官方仍留在列表末尾：镜像全挂时它是唯一还能通的路径（海外用户尤其如此）。
        const urls = [...WHISPER_RUNTIME_ZIP_MIRRORS, WHISPER_RUNTIME_ZIP_URL];
        let lastMsg = '下载失败';
        let buf: Buffer | null = null;

        // 每个地址最多试 2 次：GitHub 的 release CDN 偶发 502/504（真机实测过一次 504，
        // 隔几秒再请求就通了）。⛔ 4xx 不重试 —— 那说明地址本身变了，重试只是浪费用户时间。
        const retriable = (msg: string): boolean =>
            /服务器返回 5\d\d/.test(msg) || msg.includes('连不上') || msg.includes('下载中断');
        for (let i = 0; i < urls.length; i += 1) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                if (cancelled) break;
                onProgress?.(installPercent('download', 0), installLabel('download'));
                // 🔴 m10754：换地址/重试都重新计数 —— 上一轮的斜率属于另一个连接，
                //    接着用会算出「起手就是 3MB/s」这种假读数。
                meter.reset();
                const r = await deps.download(urls[i], tmp, (received, total) => {
                    const known = total > 0 ? total : WHISPER_RUNTIME_ZIP_BYTES;
                    const pct = known > 0 ? (received / known) * 100 : 0;
                    const speed = meter.sample(received);
                    onProgress?.(installPercent('download', pct), `${installLabel('download')}${speedSuffix(speed)}`);
                });
                if (r.ok) {
                    lastMsg = '';
                    break;
                }
                lastMsg = r.message;
                // 换下一个地址/重试前清掉半截文件（⛔ 别在残留上接着写，字节数会算错）
                try {
                    deps.remove(tmp);
                } catch {
                    /* 删不掉不影响重试 */
                }
                if (!retriable(r.message)) break;
            }
            if (!lastMsg) break;
        }
        if (cancelled) {
            try {
                deps.remove(tmp);
            } catch {
                /* 同上 */
            }
            return { ok: false, message: '' };
        }
        if (lastMsg) return { ok: false, message: lastMsg };

        // ② 读进来解析
        try {
            buf = deps.readFile(tmp);
        } catch {
            return { ok: false, message: '下载完成但读不到安装包，请重试' };
        }
        if (!buf || buf.length < 1024) {
            return { ok: false, message: '下载到的安装包不完整，请重试' };
        }
        onProgress?.(installPercent('extract', 10), installLabel('extract'));
        const entries = parseZipEntries(buf);
        if (!entries.length) return { ok: false, message: '安装包格式无法识别，请换一台机器下载后手动放置' };

        const plan = runtimeFilePlan(entries.map((e) => e.name));
        if (plan.length !== WHISPER_RUNTIME_FILES.length) {
            return { ok: false, message: '安装包里缺少必需的组件，可能是下载被中途替换过，请重试' };
        }

        // ③ 逐个解出来写盘
        deps.mkdir(binDir);
        const byName = new Map(entries.map((e) => [e.name.replace(/\\/g, '/'), e]));
        for (let i = 0; i < plan.length; i += 1) {
            const item = plan[i];
            const entry = byName.get(item.entry);
            if (!entry) return { ok: false, message: '安装包里缺少必需的组件，请重试' };
            let raw: Buffer;
            try {
                const slice = buf.slice(entry.dataStart, entry.dataEnd);
                raw = deps.inflate(slice, entry.method);
            } catch {
                return { ok: false, message: '解压安装包失败，请重试' };
            }
            if (!raw || raw.length === 0) return { ok: false, message: '解压出来的文件是空的，请重试' };
            try {
                deps.writeFile(deps.join(binDir, item.target), raw);
            } catch {
                return { ok: false, message: '写入文件失败，请检查磁盘空间或权限' };
            }
            onProgress?.(installPercent('extract', 10 + (90 * (i + 1)) / plan.length), installLabel('extract'));
        }

        // ④ 清临时包
        try {
            deps.remove(tmp);
        } catch {
            /* 删不掉就算了，⛔ 不该因此判安装失败 */
        }
        onProgress?.(100, '转写引擎已就绪');
        return { ok: true, message: '', binDir };
    })();

    return {
        done,
        cancel: () => {
            cancelled = true;
            try {
                cancelDownload?.();
            } catch {
                /* 取消失败不影响结果 */
            }
        },
    };
}

/**
 * 真实现。
 * ⚠️ 下载走 `https` 流式写盘（⛔ 不用 `services/nodeHttp`：它 `Buffer.concat` 整块进内存）。
 */
export function defaultWhisperRuntimeDeps(): WhisperRuntimeDeps {
    return {
        download: (url, destPath, onChunk) => {
            return new Promise<{ ok: boolean; message: string }>((resolve) => {
                let settled = false;
                let req: { on: (e: string, cb: (...a: unknown[]) => void) => void; destroy: () => void } | null = null;
                let ws: {
                    on: (e: string, cb: (...a: unknown[]) => void) => void;
                    write: (b: Buffer) => void;
                    end: () => void;
                    destroy: () => void;
                } | null = null;
                // 🔴 每条结束路径都必须把请求与写入流销毁掉。否则「下到一半失败 → 重试同一地址」时，
                //    上一轮的写入流还开着，新一轮对同一个文件 createWriteStream 会被 Windows 拒绝，
                //    报出来的却是「写入文件失败，请检查磁盘空间」—— 把真正的「下载中断」盖掉，
                //    用户和排查者都会往磁盘容量上查（真机实测踩过：进度 16% 突然变成 0%，
                //    接着报磁盘写失败）。
                const cleanup = (): void => {
                    try {
                        ws?.destroy();
                    } catch {
                        /* 已经关了 */
                    }
                    ws = null;
                    try {
                        req?.destroy();
                    } catch {
                        /* 同上 */
                    }
                    req = null;
                };
                const finish = (ok: boolean, message: string): void => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve({ ok, message });
                };
                try {
                    const https = require('https') as {
                        get: (u: string, cb: (res: unknown) => void) => { on: (e: string, cb: (...a: unknown[]) => void) => void; destroy: () => void };
                    };
                    const fsMod = require('fs') as {
                        createWriteStream: (p: string) => {
                            on: (e: string, cb: (...a: unknown[]) => void) => void;
                            write: (b: Buffer) => void;
                            end: () => void;
                            destroy: () => void;
                        };
                    };
                    req = https.get(url, (resUnknown) => {
                        const res = resUnknown as {
                            statusCode?: number;
                            headers: Record<string, string | undefined>;
                            on: (e: string, cb: (...a: unknown[]) => void) => void;
                            resume: () => void;
                        };
                        const code = Number(res.statusCode ?? 0);
                        // 跟随重定向（GitHub release 会 302 到 objects.githubusercontent.com）
                        if (code === 301 || code === 302 || code === 303 || code === 307 || code === 308) {
                            const loc = String(res.headers.location ?? '');
                            res.resume();
                            if (!loc) return finish(false, '下载地址被重定向到一个空地址，请重试');
                            // 🔴 必须按当前 URL 解析相对路径再跳：镜像 ghproxy.net 的 301 给的是
                            //    `/https://github.com/...`（以斜杠开头）——直接喂给 https.get 会同步抛
                            //    `Invalid URL`，而这个同步异常会**盖掉官方地址真正的失败原因**
                            //    （真机实测：官方 504 被顶成「无法发起下载」）。
                            let next: string;
                            try {
                                next = new URL(loc, url).toString();
                            } catch {
                                return finish(false, '下载地址格式无法识别，请重试');
                            }
                            defaultWhisperRuntimeDeps()
                                .download(next, destPath, onChunk)
                                .then((r) => finish(r.ok, r.message))
                                .catch(() => finish(false, '下载失败，请检查网络后重试'));
                            return;
                        }
                        if (code !== 200) return finish(false, `下载失败（服务器返回 ${code}），请稍后重试`);
                        const total = Number(res.headers['content-length'] ?? 0);
                        // 🔴 先清掉上一轮可能残留的半个文件（同一 URL 重试时 path 相同）：
                        //    createWriteStream 默认是覆盖写，但若上一轮句柄没释放，Windows 会直接抛错。
                        ws = fsMod.createWriteStream(destPath);
                        let received = 0;
                        // 🔴 用 close（= 文件真的落完）而不是 end（= 只是把尾巴交出去了）：
                        //    同步量体积会读到偏小的值，那会让「校验通过」变成假象
                        //    （`services/asrModelDownload` 踩过同一个坑，那次偏差 0.73%）。
                        ws.on('close', () => finish(true, ''));
                        ws.on('error', () => finish(false, '写入文件失败，请检查磁盘空间'));
                        res.on('data', (chunk: unknown) => {
                            const b = chunk as Buffer;
                            received += b.length;
                            try {
                                ws?.write(b);
                            } catch {
                                /* 写盘失败交给 ws 的 error 兜底 */
                            }
                            onChunk(received, total);
                        });
                        res.on('end', () => {
                            try {
                                ws?.end();
                            } catch {
                                /* 已销毁 */
                            }
                        });
                        res.on('error', () => finish(false, '下载中断，请检查网络后重试'));
                    });
                    req.on('error', () => finish(false, '连不上下载服务器，请检查网络后重试'));
                } catch (err) {
                    // 把真实原因带出来：只写「无法发起下载」会让用户和排查者都无从下手
                    // （本轮真机就是靠这条才看出镜像是相对 Location）。
                    const why = err instanceof Error && err.message ? err.message : String(err);
                    finish(false, `无法发起下载（${why}），请重试`);
                }
            });
        },
        readFile: (p) => (require('fs') as { readFileSync: (x: string) => Buffer }).readFileSync(p),
        writeFile: (p, b) => (require('fs') as { writeFileSync: (x: string, y: Buffer) => void }).writeFileSync(p, b),
        mkdir: (dir) => (require('fs') as { mkdirSync: (x: string, o: { recursive: boolean }) => void }).mkdirSync(dir, { recursive: true }),
        remove: (p) => {
            try {
                (require('fs') as { unlinkSync: (x: string) => void }).unlinkSync(p);
            } catch {
                /* 幂等：本来就没有也算删成功 */
            }
        },
        exists: (p) => {
            try {
                return (require('fs') as { existsSync: (x: string) => boolean }).existsSync(p);
            } catch {
                return false;
            }
        },
        inflate: (buf, method) => {
            if (method === 0) return buf;
            const zlib = require('zlib') as { inflateRawSync: (b: Buffer) => Buffer };
            return zlib.inflateRawSync(buf);
        },
        join: (dir, name) => `${String(dir).replace(/[\\/]+$/, '')}/${name}`,
        tmpZipPath: (binDir) => `${String(binDir).replace(/[\\/]+$/, '')}/whisper-runtime.zip`,
    };
}
