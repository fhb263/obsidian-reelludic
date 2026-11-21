/**
 * 转码**执行层**：起 ffmpeg 探测流信息、再转成 Chromium 能解的 mp4。
 *
 * 🔴 为什么不做本地回环 HTTP 服务器：
 *    本以为是必须的（远程源要补 CORS 头），但**产物是我们自己的本地文件**，
 *    而 `main.ts::resolveEmbedUrl` 已经把「vault 外绝对路径」映射成 `app://<appId>/<编码路径>`，
 *    宿主侧 CSP 早就放行了 `app:` scheme。⇒ 转完直接 `video.src = app://...mp4` 就行，
 *    ⛔ 不需要 `createServer` + `listen` + Range 转发那一整套（那才是当年 B 站 DASH 的负担）。
 *
 * 🔴 与 2026-11-24 裁定的关系：这里既不取流也不碰 MSE，输入是本地一整个文件、
 *    输出是本地一整个 mp4，最后仍是 `video.src = 一个 URL` 这条最朴素的挂源方式。
 *
 * ⚠️ 依赖全部注入（`TranscodeDeps`），单测才能在没有 ffmpeg 的机器上跑；
 *    真实现是 `defaultTranscodeDeps()`，惰性 `require`（移动端没有 Node 模块，顶层 import 会让整包崩）。
 */

import { ffmpegNotFoundMessage, lastErrorLine } from 'pure/asrEngine';
import {
    buildProbeArgs,
    buildRemuxArgs,
    buildTranscodeArgs,
    H264_ENCODER_FALLBACK,
    H264_HW_ENCODERS,
    parseFfmpegProbe,
    parseTranscodeOutTime,
    planTranscode,
    TRANSCODE_DIR_NAME,
    transcodeFileName,
    transcodePercent,
    type TranscodeMode,
    type VideoProbe,
} from 'pure/transcode';
import { videoExt } from 'pure/mediaExtensions';

/** 子进程最小表面（只声明真正用到的事件；与 `services/asr.AsrChild` 同款结构） */
export interface TranscodeChild {
    stdout?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    stderr?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
    kill?: (signal?: string) => void;
}

/** 执行层依赖（真源 = `defaultTranscodeDeps`；单测注入假实现） */
export interface TranscodeDeps {
    spawn: (exe: string, args: string[]) => TranscodeChild;
    exists: (p: string) => boolean;
    /** 删除文件/目录（失败不抛：残留产物不该让整次转换报错） */
    remove: (p: string) => void;
    /** 建目录（递归；已存在不抛） */
    ensureDir: (p: string) => void;
    /** 系统临时目录（`os.tmpdir()`） */
    tmpDir: () => string;
    platform: string;
}

/** 取消令牌（与 `services/asr.createAsrCancelToken` 同语义，⛔ 别改成 AbortSignal） */
export interface TranscodeCancelToken {
    readonly cancelled: boolean;
    onCancel: (cb: () => void) => void;
}

export interface TranscodeCancelHandle extends TranscodeCancelToken {
    cancel: () => void;
}

export function createTranscodeCancelToken(): TranscodeCancelHandle {
    let cancelled = false;
    const cbs: Array<() => void> = [];
    return {
        get cancelled(): boolean {
            return cancelled;
        },
        onCancel: (cb: () => void) => {
            if (cancelled) {
                cb();
                return;
            }
            cbs.push(cb);
        },
        cancel: () => {
            if (cancelled) return;
            cancelled = true;
            for (const cb of cbs.splice(0)) {
                try {
                    cb();
                } catch {
                    /* 单个回调抛错不该拦住其它回调（kill 一个已退出的进程会抛） */
                }
            }
        },
    };
}

/** 进度回调：`percent` 为 null 时只更新阶段文案 */
export type TranscodeProgress = (percent: number | null, label: string) => void;

/** 一次跑进程的原始结果 */
interface SpawnOutcome {
    code: number | null;
    stdout: string;
    stderr: string;
    spawnError?: string;
    cancelled?: boolean;
}

/** 一次转换的最终结果 */
export interface TranscodeResult {
    ok: boolean;
    message: string;
    /** 产物**绝对路径**（调用方用 `resolveEmbedUrl` 转成 `app://` 再播放） */
    outPath: string;
    /** 实际走的方案（`none` 时 `outPath` 就是源文件自己） */
    mode: TranscodeMode;
    /** 探测到的流信息（UI 可用来显示「原编码 hevc ⇒ 已转 h264」） */
    probe: VideoProbe;
}

/** 跑一个 ffmpeg 子进程，边收 stderr 边累积，`onLine` 逐行回调 */
function runFfmpeg(
    deps: TranscodeDeps,
    exe: string,
    args: string[],
    cancel: TranscodeCancelToken | undefined,
    onLine?: (line: string) => void,
): Promise<SpawnOutcome> {
    return new Promise((resolve) => {
        let child: TranscodeChild;
        try {
            child = deps.spawn(exe, args);
        } catch (e) {
            resolve({ code: null, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
            return;
        }
        let stdout = '';
        let stderr = '';
        let cancelled = false;
        let settled = false;
        const finish = (o: SpawnOutcome): void => {
            if (settled) return;
            settled = true;
            resolve(o);
        };
        cancel?.onCancel(() => {
            cancelled = true;
            try {
                child.kill?.();
            } catch {
                /* 已退出时 kill 会抛，忽略 */
            }
        });
        // ffmpeg 的流信息与 `-progress` 全在 stderr；stdout 一般是空的（`-f null -` 时也没有）
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            const s = String(chunk);
            stderr += s;
            if (onLine) {
                for (const line of s.split(/\r?\n/)) {
                    if (line.trim()) onLine(line);
                }
            }
        });
        child.on('error', (err) => {
            finish({ code: null, stdout, stderr, spawnError: err.message || err.code || 'spawn 失败', cancelled });
        });
        child.on('close', (code) => {
            finish({ code, stdout, stderr, cancelled });
        });
    });
}

/**
 * 探测一个本地视频文件的流信息。
 *
 * ⚠️ ffmpeg 用 `-f null -` 读完流信息后会以**非 0** 码退出（「At least one output file must be specified」
 *    之类）—— 那是**预期**的，⛔ 不能据此判失败。只认「stderr 里有没有 Stream 行」。
 */
export async function probeVideo(
    deps: TranscodeDeps,
    ffmpeg: string,
    input: string,
    cancel?: TranscodeCancelToken,
): Promise<{ probe: VideoProbe; spawnError: string }> {
    const r = await runFfmpeg(deps, ffmpeg, buildProbeArgs(input), cancel);
    if (r.spawnError) return { probe: parseFfmpegProbe(''), spawnError: r.spawnError };
    return { probe: parseFfmpegProbe(r.stderr), spawnError: '' };
}

/** 转码产物目录（系统临时目录下，与用户文件分开） */
export function transcodeDirOf(deps: TranscodeDeps): string {
    const base = String(deps.tmpDir() ?? '').replace(/[\\/]+$/, '');
    return base ? `${base}/${TRANSCODE_DIR_NAME}` : '';
}

/** 产物路径（**不保证存在**，调用方自己判） */
export function transcodeOutputPath(deps: TranscodeDeps, sourceKey: string): string {
    const dir = transcodeDirOf(deps);
    if (!dir) return '';
    return `${dir}/${transcodeFileName(sourceKey)}`;
}

/**
 * 主入口：把 `input` 变成 Chromium 能播的 mp4。
 *
 * 流程：探测 → 定方案 → （`remux` 失败自动降级 `transcode`）→ 校验产物。
 *
 * 🔴 `remux` 失败必须**自动降级重编码**，不能直接报错：
 *    `-c copy` 对某些奇葩源（可变帧率 + 时间戳断裂的录屏、某些 ts）会产出 0 字节或坏 mp4。
 *    用户看到「转换失败」就再也不会点了，而重编码其实能成。
 * 🔴 已存在的产物直接复用：同一集反复点开不必每次重转（临时目录会随系统清理）。
 *
 * @param sourceKey 缓存键（一般用源文件绝对路径；网盘直链用 URL）
 */
export async function transcodeToMp4(
    deps: TranscodeDeps,
    ffmpeg: string,
    input: string,
    sourceKey: string,
    opts: { onProgress?: TranscodeProgress; cancel?: TranscodeCancelToken; forceTranscode?: boolean } = {},
): Promise<TranscodeResult> {
    const src = String(input ?? '').trim();
    const empty: VideoProbe = { videoCodec: '', audioCodec: '', duration: 0, width: 0, height: 0 };
    if (!src) return { ok: false, message: '没有源文件', outPath: '', mode: 'none', probe: empty };
    if (!deps.exists(src)) return { ok: false, message: '源文件不存在', outPath: '', mode: 'none', probe: empty };
    if (!ffmpeg) return { ok: false, message: ffmpegNotFoundMessage(), outPath: '', mode: 'none', probe: empty };

    const srcExt = videoExt(src);
    // ① 探测
    opts.onProgress?.(null, '正在读取视频信息…');
    const { probe, spawnError } = await probeVideo(deps, ffmpeg, src, opts.cancel);
    if (spawnError) return { ok: false, message: spawnError, outPath: '', mode: 'none', probe: empty };
    if (opts.cancel?.cancelled) return { ok: false, message: '已取消', outPath: '', mode: 'none', probe };

    // ② 定方案
    let mode = planTranscode(probe, srcExt, { forceTranscode: opts.forceTranscode });
    if (mode === 'none') {
        return { ok: true, message: '', outPath: src, mode: 'none', probe };
    }

    const dir = transcodeDirOf(deps);
    if (!dir) return { ok: false, message: '拿不到临时目录', outPath: '', mode, probe };
    try {
        deps.ensureDir(dir);
    } catch (e) {
        return { ok: false, message: `建临时目录失败：${e instanceof Error ? e.message : String(e)}`, outPath: '', mode, probe };
    }
    const output = transcodeOutputPath(deps, sourceKey || src);
    // ③ 已有产物直接复用（懒清理：临时目录由系统回收）
    if (deps.exists(output)) {
        return { ok: true, message: '', outPath: output, mode, probe };
    }

    /** 跑一次转换并检查产物。返回 null = 成功，否则错误文案 */
    const attempt = async (m: 'remux' | 'transcode', encoder: string): Promise<{ err: string; spawnCode: string }> => {
        const args = m === 'remux' ? buildRemuxArgs(src, output, probe) : buildTranscodeArgs(src, output, encoder, probe);
        const label = m === 'remux' ? '正在换封装（不重编码，很快）…' : `正在转码（${encoder}）…`;
        opts.onProgress?.(0, label);
        const r = await runFfmpeg(deps, ffmpeg, args, opts.cancel, (line) => {
            const sec = parseTranscodeOutTime(line);
            if (sec === null) return;
            opts.onProgress?.(transcodePercent(sec, probe.duration), label);
        });
        if (r.cancelled || opts.cancel?.cancelled) {
            // 取消时把半成品删掉，否则下次会命中「已有产物」直接播坏文件
            try {
                deps.remove(output);
            } catch {
                /* 删不掉就算了 */
            }
            return { err: '已取消', spawnCode: 'CANCELLED' };
        }
        if (r.spawnError) return { err: r.spawnError, spawnCode: 'SPAWN' };
        if (r.code !== 0) {
            return { err: lastErrorLine(r.stderr, `ffmpeg 退出码 ${r.code}`), spawnCode: 'EXIT' };
        }
        if (!deps.exists(output)) return { err: 'ffmpeg 结束了但没有生成文件', spawnCode: 'NOFILE' };
        return { err: '', spawnCode: '' };
    };

    // ④ remux 优先；失败自动降级重编码
    if (mode === 'remux') {
        const r = await attempt('remux', '');
        if (!r.err) {
            opts.onProgress?.(100, '完成');
            return { ok: true, message: '', outPath: output, mode: 'remux', probe };
        }
        if (r.spawnCode === 'CANCELLED') return { ok: false, message: '已取消', outPath: '', mode, probe };
        if (r.spawnCode === 'SPAWN') return { ok: false, message: r.err, outPath: '', mode, probe };
        // 流复制栽了 ⇒ 降级重编码（见函数头注释）
        try {
            deps.remove(output);
        } catch {
            /* 忽略 */
        }
        mode = 'transcode';
    }

    // ⑤ 重编码：硬件编码器依次试，全失败退 libx264
    let lastErr = '';
    for (const encoder of [...H264_HW_ENCODERS, H264_ENCODER_FALLBACK]) {
        if (opts.cancel?.cancelled) return { ok: false, message: '已取消', outPath: '', mode, probe };
        const r = await attempt('transcode', encoder);
        if (!r.err) {
            opts.onProgress?.(100, '完成');
            return { ok: true, message: '', outPath: output, mode: 'transcode', probe };
        }
        if (r.spawnCode === 'CANCELLED') return { ok: false, message: '已取消', outPath: '', mode, probe };
        if (r.spawnCode === 'SPAWN') return { ok: false, message: r.err, outPath: '', mode, probe };
        lastErr = r.err;
        // 半成品必须清掉：不清的话下一轮 `attempt` 生成的还是同一个路径，
        // 而 `exists(output)` 复用判定在函数开头已经过了，这里会写进坏文件后仍报「成功」
        try {
            deps.remove(output);
        } catch {
            /* 忽略 */
        }
    }
    return { ok: false, message: lastErr || '转码失败', outPath: '', mode, probe };
}

/**
 * 真依赖（桌面端专用）。
 * 🔴 惰性 `require`（与 `services/asr` / `services/ytdlp` 同款）：移动端没有 Node 模块，
 *    顶层 `import` 会让整包崩。
 */
export function defaultTranscodeDeps(): TranscodeDeps {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');
    return {
        // ⚠️ 不用 shell；`windowsHide: true` 防止 Windows 上闪黑窗（与 `services/asr` 一致）
        spawn: (exe: string, args: string[]) => cp.spawn(exe, args, { windowsHide: true }) as unknown as TranscodeChild,
        exists: (p: string) => {
            try {
                return fs.existsSync(p);
            } catch {
                return false;
            }
        },
        remove: (p: string) => {
            try {
                fs.rmSync(p, { force: true });
            } catch {
                /* 见调用点注释 */
            }
        },
        ensureDir: (p: string) => {
            try {
                fs.mkdirSync(p, { recursive: true });
            } catch {
                /* 已存在或建不了：后续 exists 会如实报失败 */
            }
        },
        tmpDir: () => {
            try {
                return String(os.tmpdir() ?? '');
            } catch {
                return '';
            }
        },
        platform: process.platform,
    };
}
