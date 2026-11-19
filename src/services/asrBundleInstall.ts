/**
 * **整包安装器**：把一个引擎需要的全部文件按顺序下好、解压到位。
 *
 * 🔴 为什么要有这一层，而不是让设置页循环调 `downloadModel`：
 *    ⑴ 进度必须是**跨文件的加权总进度**（见 `pure/asrBundles.bundlePercent` 的注释：
 *       按文件数算会让 228MB 那个文件一动不动却显示 66%）；
 *    ⑵ 压缩包要「下载 → 解出其中一个文件 → 删掉包」，这三步的中间态不能让调用方看见；
 *    ⑶ 取消要能中止**当前**文件并清掉它的 `.part`，而不是只清最后一个。
 *
 * ⚠️ 依赖全部注入（`InstallBundleDeps`），单测才能在无网络、无 tar 的机器上跑；
 *    真实现是 `defaultInstallBundleDeps()`，Node 模块一律 `require` 且⛔ 不带 `node:` 前缀
 *    （`esbuild.config.mjs` 的 external 用的是 builtin-modules 的不带前缀清单）。
 */

import { downloadModel, type DownloadDeps, type DownloadHandle } from 'services/asrModelDownload';
import {
    bundlePercent,
    type AsrBundle,
    type AsrBundleFile,
} from 'pure/asrBundles';
import { createSpeedMeter, speedSuffix } from 'pure/speedMeter';

/** 整包安装结果 */
export interface InstallBundleResult {
    ok: boolean;
    /** 失败原因；成功时为空串 */
    message: string;
    /** 已落盘的绝对路径（成功时是**主文件**，按 `primaryFileName` 决定） */
    paths: Record<string, string>;
    /** 用户点了取消 */
    cancelled?: boolean;
}

/** 进度回调：`percent` 是整包的加权总进度 */
export type InstallProgressCallback = (percent: number, fileIndex: number, label: string) => void;

/** 一次可取消的整包安装 */
export interface InstallBundleHandle {
    done: Promise<InstallBundleResult>;
    cancel: () => void;
}

/** 执行层依赖 */
export interface InstallBundleDeps {
    /**
     * 单文件下载器（复用 `downloadModel`，注入以便单测）。
     *
     * @param primaryUrl 首选地址（清单里的 `mirrorUrl`，国内加速站）；
     *                   网络层失败后由下载器回落到 `target.url`（官方源）。
     *                   🔴 用户 m07854 ⑨ 起方向是**镜像优先**，改前这个位置是
     *                   「官方优先、失败才用镜像」，参数名因此还叫 `fallbackUrl`，⛔ 别再按名字理解。
     */
    download: (
        target: { url: string; bytes: number },
        destPath: string,
        primaryUrl: string,
        onProgress: (pct: number | null, received: number, total: number) => void,
    ) => DownloadHandle;
    /**
     * 从压缩包里取出条目到目标路径。
     *
     * @param innerPaths 要取出的包内条目（一个或多个）
     * @param outDir 解压落点目录
     * @param stripLayers 剥掉的目录层数（sherpa 的 tar.bz2 = 2；llama.cpp 的扁平 zip = 0）
     * @param archive 压缩格式（`tbz` 走 `-xjf`；`zip` 走 `-xf` 由 bsdtar 自动识别）
     */
    extractOne: (
        archivePath: string,
        innerPaths: readonly string[],
        outDir: string,
        stripLayers: number,
        archive: 'tbz' | 'zip',
    ) => { ok: boolean; message: string };
    /** 建目录（含父级）；已存在不算错 */
    mkdirp: (dir: string) => void;
    /** 文件大小；不存在返回 -1 */
    size: (path: string) => number;
    /** 删文件（失败不抛） */
    remove: (path: string) => void;
    /** 拼路径 */
    join: (dir: string, name: string) => string;
    /** 取父目录 */
    dirname: (path: string) => string;
}

/** 临时包名（下载完就删，⛔ 留在用户目录里） */
function archiveTmpPath(binDir: string, fileName: string): string {
    return `${binDir.replace(/[\\/]+$/, '')}/.${fileName}.archive`;
}

/**
 * 安装整包。
 *
 * 流程：逐个文件 → 已就绪就跳过（幂等，⛔ 不重复下 228MB）→ 下载 → 若带 `innerPath` 则解出后删包。
 * 任何一个文件失败就整体失败，并把该文件的临时件清掉。
 *
 * ⚠️ **不做断点续传**：理由同 `AsrEngineModal` 的注释 —— 断点续传要 `Range`/206，
 *    HuggingFace 的 LFS 重定向链和 GitHub 的 CDN 并非每一跳都支持，做半套比不做更坑。
 *    取消会删 `.part`，重下从头开始。
 */
export function installBundle(
    deps: InstallBundleDeps,
    bundle: AsrBundle,
    destDir: string,
    onProgress?: InstallProgressCallback,
    /** 用户点取消后要重试时，调用方会新建一个 handle；这里只读它 */
    isCancelled: () => boolean = () => false,
): InstallBundleHandle {
    let cancelled = false;
    let current: DownloadHandle | null = null;
    const checkCancel = (): boolean => cancelled || isCancelled();
    const paths: Record<string, string> = {};
    /** 🔴 m10754：速率计（每个文件的下载回调里 `reset()` 一次，跨文件不串味） */
    const meter = createSpeedMeter();

    let resolveDone: ((r: InstallBundleResult) => void) | null = null;
    let settled = false;
    /** 🔴 只结算一次：下载器自己的 `done` 与用户的 `cancel()` 是两条独立的结束路径，谁先到谁算数 */
    const settle = (r: InstallBundleResult): void => {
        if (settled) return;
        settled = true;
        current = null;
        resolveDone?.(r);
    };

    const done = new Promise<InstallBundleResult>((resolve) => {
        resolveDone = resolve;
        const fail = (message: string): void => {
            settle({ ok: false, message, paths, cancelled: cancelled });
        };

        const step = (index: number): void => {
            if (checkCancel()) {
                fail('已取消安装');
                return;
            }
            if (index >= bundle.files.length) {
                onProgress?.(100, bundle.files.length, '安装完成');
                settle({ ok: true, message: '', paths });
                return;
            }
            const f = bundle.files[index];
            const finalPath = deps.join(destDir, f.fileName);

            // ① 已就绪 ⇒ 跳过（幂等）。压缩包只校验解出来的那个文件在不在。
            const existing = deps.size(finalPath);
            const hasEnough = f.bytes > 0 ? Math.abs(existing - f.bytes) <= f.bytes * 0.02 : existing > 0;
            if (existing > 0 && hasEnough) {
                paths[f.fileName] = finalPath;
                onProgress?.(bundlePercent(bundle, index + 1, 0), index + 1, `已就绪 · ${f.label}`);
                step(index + 1);
                return;
            }

            // ② 目录要先建：Qwen3 的文件在子目录里，`createWriteStream` 不会替我们建父目录
            try {
                deps.mkdirp(deps.dirname(finalPath));
            } catch {
                fail(`无法创建安装目录，请检查「${destDir}」的写入权限`);
                return;
            }

            // 🔴 多条目（`innerPaths`）优先于单条目（`innerPath`）：
            //    Confucius4 的运行时是一个 24MB zip 里剥 8 个文件，只下一次。
            const manyPaths = f.innerPaths && f.innerPaths.length > 0 ? f.innerPaths : null;
            const needsExtract = manyPaths ? true : !!f.innerPath;
            // 压缩包：下到临时名再解出条目；普通文件：直接下到最终名
            const targetPath = needsExtract ? archiveTmpPath(destDir, f.fileName) : finalPath;
            if (needsExtract) {
                try {
                    deps.mkdirp(destDir);
                } catch {
                    fail(`无法创建安装目录，请检查「${destDir}」的写入权限`);
                    return;
                }
            }

            onProgress?.(bundlePercent(bundle, index, 0), index, `正在下载${f.label}…`);
            // 🔴 m10754：**每个文件一个独立速率基线** —— 换文件不 reset 会把上一个文件的
            //    尾部斜率带到新文件首帧（界面开头就是「1.2 MB/s」，然后掉下来）。
            //    压缩包解压阶段同样 reset，避免把「下载速度」留在「正在解压」那行。
            meter.reset();
            const handle = deps.download(
                { url: f.url, bytes: f.bytes },
                targetPath,
                f.mirrorUrl,
                (pct, received) => {
                    if (checkCancel()) return;
                    const speed = meter.sample(received);
                    onProgress?.(
                        bundlePercent(bundle, index, received),
                        index,
                        `正在下载${f.label}…${speedSuffix(speed)}`,
                    );
                    void pct;
                },
            );
            current = handle;

            void handle.done.then((r) => {
                current = null;
                if (checkCancel()) {
                    deps.remove(targetPath);
                    fail('已取消安装');
                    return;
                }
                if (!r.ok) {
                    deps.remove(targetPath);
                    fail(`${f.label}下载失败：${r.message}`);
                    return;
                }
                if (!needsExtract) {
                    paths[f.fileName] = finalPath;
                    onProgress?.(bundlePercent(bundle, index + 1, 0), index + 1, `已就绪 · ${f.label}`);
                    step(index + 1);
                    return;
                }
                // ③ 从包里取出条目，然后删包（⛔ 把 26MB 的 tar 留在用户目录）
                const wanted = manyPaths ?? [f.innerPath as string];
                const ex = deps.extractOne(targetPath, wanted, destDir, f.stripLayers ?? 2, f.archive ?? 'tbz');
                deps.remove(targetPath);
                if (!ex.ok) {
                    fail(`解压${f.label}失败：${ex.message}`);
                    return;
                }
                paths[f.fileName] = finalPath;
                onProgress?.(bundlePercent(bundle, index + 1, 0), index + 1, `已就绪 · ${f.label}`);
                step(index + 1);
            });
        };

        if (bundle.blockedReason) {
            settle({ ok: false, message: bundle.blockedReason, paths });
            return;
        }
        if (!destDir) {
            settle({ ok: false, message: '无法确定安装位置（拿不到用户主目录）', paths });
            return;
        }
        step(0);
    });

    return {
        done,
        cancel: () => {
            cancelled = true;
            try {
                current?.cancel();
            } catch {
                /* 已经断了 */
            }
            // 🔴 不能只依赖下载器回应取消：`downloadModel` 的 done 可能还没走到 then 回调，
            //    上层界面就会一直卡在「正在安装…」。这里主动结算，让取消立刻生效。
            settle({ ok: false, message: '已取消安装', paths, cancelled: true });
        },
    };
}

/** 真实现（惰性 `require`；⛔ 不带 `node:` 前缀，见文件头） */
export function defaultInstallBundleDeps(): InstallBundleDeps {
    const fs = require('fs') as {
        mkdirSync: (p: string, o: { recursive: boolean }) => void;
        statSync: (p: string) => { size: number };
        unlinkSync: (p: string) => void;
        existsSync: (p: string) => boolean;
    };
    const pathMod = require('path') as { join: (a: string, b: string) => string; dirname: (p: string) => string };
    const childProcess = require('child_process') as {
        spawnSync: (cmd: string, args: string[], o: { windowsHide: boolean; encoding: string }) => { status: number | null; stderr?: string; stdout?: string };
    };
    const downloadDeps: DownloadDeps = require('services/asrModelDownload').defaultDownloadDeps() as DownloadDeps;

    return {
        download: (target, destPath, primaryUrl, onProgress) =>
            downloadModel(downloadDeps, target, destPath, onProgress, primaryUrl || undefined),
        extractOne: (archivePath, innerPaths, outDir, stripLayers, archive) => {
            /**
             * 🔴 用系统自带的 `bsdtar`（Windows 10+ 在 System32 里，实测 3.8.9 带 bz2lib）。
             *    为什么不用 npm 的 tar 库：Node 的 zlib **不支持 bzip2**，能解 bz2 的库都要带自己的
             *    解压器（体积几百 KB 全进 main.js）；而系统这个已经在了，且**同时支持 zip**。
             *
             * 🔴 两个上游包的目录结构完全不同，所以 `stripLayers` 必须由清单指定：
             *    · sherpa 的 tar.bz2：`<版本目录>/bin/<exe>` ⇒ 剥 2 层刚好剩文件名
             *    · llama.cpp 的 zip：**52 个条目全在包根、没有目录前缀** ⇒ 必须剥 0 层，
             *      剥 2 层会把文件名本身也剥掉，解出来是空目录（实测踩过）。
             *
             * ⚠️ `-xjf` 只解 bzip2；zip 要用 `-xf` 让 bsdtar 自己认格式。
             */
            const tar = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\tar.exe`;
            try {
                if (!fs.existsSync(tar)) return { ok: false, message: '系统缺少解压工具（tar.exe）' };
                fs.mkdirSync(outDir, { recursive: true });
                const args = [archive === 'zip' ? '-xf' : '-xjf', archivePath, '-C', outDir];
                if (stripLayers > 0) args.push(`--strip-components=${stripLayers}`);
                for (const p of innerPaths) args.push(p);
                const r = childProcess.spawnSync(tar, args, {
                    windowsHide: true,
                    encoding: 'utf8',
                });
                if (r.status !== 0) return { ok: false, message: (r.stderr || '').trim().slice(0, 200) || `tar 退出码 ${r.status}` };
                // 逐个确认真的落地了：tar 对「包内不存在该条目」不报错，只是什么都不解
                for (const p of innerPaths) {
                    const landed = pathMod.join(outDir, p.slice(p.lastIndexOf('/') + 1));
                    if (!fs.existsSync(landed)) return { ok: false, message: '压缩包里找不到需要的文件' };
                }
                return { ok: true, message: '' };
            } catch (err) {
                return { ok: false, message: err instanceof Error ? err.message : String(err) };
            }
        },
        mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
        size: (p) => {
            try {
                return fs.statSync(p).size;
            } catch {
                return -1;
            }
        },
        remove: (p) => {
            try {
                fs.unlinkSync(p);
            } catch {
                /* 不存在就算了 */
            }
        },
        join: (dir, name) => pathMod.join(dir, name),
        dirname: (p) => pathMod.dirname(p),
    };
}

/** 供界面显示「这个文件多大」 */
export function bundleFileSizeLabel(f: AsrBundleFile): string {
    const mb = f.bytes / 1024 / 1024;
    if (f.bytes <= 0) return '未知';
    return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}
