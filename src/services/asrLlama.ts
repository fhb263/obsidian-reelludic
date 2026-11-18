/**
 * Confucius4（llama.cpp `llama-mtmd-cli`）执行层。
 *
 * 🔴 为什么走 llama.cpp 而不是官方推荐的 `r2t2_llama`：
 *    官方 README 说 llama.cpp 只是 **decoder 后端**、要用 Python 包 `r2t2_llama`，
 *    且预编译原生库只有 **Linux x86_64 + CUDA + CPython 3.12** 的 `libllama.so`。
 *    真机实测（2026-11）：`llama-mtmd-cli.exe --audio <wav> -m <gguf> --mmproj <mmproj>`
 *    在 **Windows CPU** 上直接出结果，格式 `language English<asr_text>正文`。
 *    ⇒ 不需要 Python、不需要 CUDA，插件可以自己起进程。
 *    ⛔ 别再引 `r2t2_llama` 那条路（PyPI 上是 404，装不上）。
 *
 * ⚠️ 与其它五家最大的不同：**输出没有时间戳**。
 *    时间轴只能按加权字符比例反推（见 `pure/llamaAsr.textToSegments`）。
 *    这对「整段字幕文件」够用，但**不是**强制对齐。
 *
 * ⚠️ `llama-mtmd-cli.exe` 必须带 8 个 dll 才能跑：只拷 exe 会**静默失败**
 *    （stdout / stderr 全空，退出码也可能正常）—— 真机踩过，非常难查。
 */
import {
    buildExtractArgs,
    ffmpegExeCandidates,
    ffmpegNotFoundMessage,
    lastErrorLine,
    parseFfmpegDuration,
    withPercentLabel,
    ASR_CANCELLED_MESSAGE,
} from 'pure/asrEngine';
import { clampEntries, entriesToSrt } from 'pure/senseVoice';
import { buildLlamaArgs, parseLlamaAsrOutput, textToSegments } from 'pure/llamaAsr';
import type { AsrCancelToken, AsrResult, AsrProgressCallback } from './asr';


/** 抽轨占前 12%，推理占 12–99%（大模型推理慢，必须让进度条尽早动起来）。 */
const LLAMA_EXTRACT_WEIGHT = 12;

const LLAMA_LABEL = '正在用大模型识别…';
const LLAMA_EXTRACT_LABEL = '正在提取音频…';

/** 只声明真正用到的子进程表面（与 `services/asr.ts` 的 `AsrChild` 同口径）。 */
export interface LlamaChild {
    stdout?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    stderr?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
    kill?: (signal?: string) => void;
}

/**
 * 执行层依赖。
 *
 * ⚠️ 这里**必须**同时收 stdout 和 stderr：
 *    · 识别结果在 **stdout**（一行纯文本）；
 *    · 日志（含加载耗时、OOM 之类）全在 stderr。
 *    `services/asrSenseVoice.ts` 那个 `run` 只收 stderr（sherpa 的结果在 stderr），
 *    所以⛔ 不能直接复用它的 deps —— 会拿到空 stdout 然后误判「没识别出东西」。
 */
export interface LlamaDeps {
    run: (
        exe: string,
        args: string[],
        cancel?: AsrCancelToken,
    ) => Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: string; cancelled?: boolean }>;
    exists: (p: string) => boolean;
    remove: (p: string) => void;
    writeFile: (p: string, text: string) => void;
    readFile: (p: string) => string;
    join: (...parts: string[]) => string;
    dirname: (p: string) => string;
    baseName: (p: string) => string;
    platform: string;
}

export interface LlamaOptions {
    videoPath: string;
    /** llama-mtmd-cli(.exe) 路径 */
    exe: string;
    /** 语言模型 gguf（Q4_K_M / f16） */
    model: string;
    /** 投影器 mmproj-*.gguf —— ⛔ 必填，少了 exe 直接拒绝运行 */
    mmproj: string;
    ffmpeg?: string;
    threads?: number;
    /** 输出 token 上限（长视频要相应放大） */
    maxTokens?: number;
    onProgress?: AsrProgressCallback;
    cancel?: AsrCancelToken;
}

/**
 * 用 Confucius4 转写一段音视频，产出 SRT。
 *
 * 流程：ffmpeg 抽 16k 单声道 wav → llama-mtmd-cli 推理 → 解析 `<asr_text>` → 按比例反推时间轴 → SRT。
 */
export async function transcribeWithLlama(deps: LlamaDeps, opts: LlamaOptions): Promise<AsrResult> {
    const video = String(opts.videoPath ?? '').trim();
    if (!video) return { ok: false, message: '缺少视频路径' };
    if (opts.cancel?.cancelled) return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };

    const exe = String(opts.exe ?? '').trim();
    if (!exe) return { ok: false, message: '还没有指定 Confucius4 的识别程序（llama-mtmd-cli）' };
    if (!deps.exists(exe)) return { ok: false, message: `找不到识别程序：${exe}` };
    const model = String(opts.model ?? '').trim();
    if (!model || !deps.exists(model)) return { ok: false, message: `找不到语言模型：${model || '(空)'}` };
    const mmproj = String(opts.mmproj ?? '').trim();
    if (!mmproj || !deps.exists(mmproj)) return { ok: false, message: `找不到投影模型（mmproj）：${mmproj || '(空)'}` };

    const dir = deps.dirname(video);
    const name = deps.baseName(video);
    const wav = deps.join(dir, `${name}.asr.wav`);
    const srtPath = deps.join(dir, `${name}.srt`);

    const cleanup = (): void => {
        try {
            deps.remove(wav);
        } catch {
            /* 删不掉不该让整次转写失败 */
        }
    };
    const failKeep = (message: string): AsrResult => ({ ok: false, message });
    const fail = (message: string): AsrResult => {
        cleanup();
        return { ok: false, message };
    };
    const stop = (): AsrResult => {
        cleanup();
        return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };
    };

    // ① 抽音轨（⛔ llama 吃不了视频容器，必须先抽成 16k 单声道 wav）
    opts.onProgress?.(null, LLAMA_EXTRACT_LABEL);
    let totalSec: number | null = null;
    const ffCands = ffmpegExeCandidates(opts.ffmpeg, deps.platform);
    let ffUsed = '';
    let extractOk = false;
    let extractErr = '';
    for (const cand of ffCands) {
        if (opts.cancel?.cancelled) return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };
        const r = await deps.run(cand, buildExtractArgs(video, wav));
        if (r.spawnError === 'ENOENT') continue;
        ffUsed = cand;
        if (r.spawnError) {
            extractErr = r.spawnError;
            break;
        }
        for (const line of String(r.stderr ?? '').split(/\r?\n/)) {
            const d = parseFfmpegDuration(line);
            if (d !== null) totalSec = d;
        }
        extractOk = r.code === 0;
        extractErr = r.stderr;
        break;
    }
    if (!ffUsed) return fail(ffmpegNotFoundMessage());
    if (!extractOk) return fail(lastErrorLine(extractErr, '提取音频失败'));
    if (opts.cancel?.cancelled) return stop();

    // ② 推理
    opts.onProgress?.(LLAMA_EXTRACT_WEIGHT, withPercentLabel(LLAMA_LABEL, LLAMA_EXTRACT_WEIGHT));
    const args = buildLlamaArgs({
        model,
        mmproj,
        wav,
        threads: opts.threads,
        maxTokens: opts.maxTokens,
    });
    const r = await deps.run(exe, args, opts.cancel);
    if (r.cancelled) return stop();
    if (r.spawnError === 'ENOENT') return fail(`找不到识别程序：${exe}`);
    // 🔴 判据：stdout 里有没有 `<asr_text>`。退出码不可信（实测成功也可能非 0）。
    const parsed = parseLlamaAsrOutput(String(r.stdout ?? ''));
    if (!parsed) {
        const tail = lastErrorLine(r.stderr, '');
        return fail(
            tail
                ? `大模型识别失败：${tail}`
                : '大模型没有输出识别结果（若程序崩溃，常见原因是缺少同目录的 dll）',
        );
    }

    // ③ 反推时间轴 → SRT
    opts.onProgress?.(95, withPercentLabel(LLAMA_LABEL, 95));
    const segs = textToSegments(parsed.text, totalSec);
    if (segs.length === 0) return fail('没有识别到可用的语音内容（可能是纯音乐或静音）');
    const clamped = totalSec !== null && totalSec > 0 ? clampEntries(segs, totalSec) : segs;
    const srt = entriesToSrt(clamped.filter((e) => e.text.trim().length > 0));
    if (!srt.trim()) return fail('没有识别到可用的语音内容（可能是纯音乐或静音）');

    try {
        deps.writeFile(srtPath, srt);
    } catch (e) {
        return failKeep(`字幕写盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
    let written = '';
    try {
        written = deps.exists(srtPath) ? deps.readFile(srtPath) : '';
    } catch {
        written = '';
    }
    if (!written.trim()) return failKeep(`字幕没有成功写入：${srtPath}`);

    cleanup();
    opts.onProgress?.(100, '转写完成');
    return { ok: true, message: '', srt, srtPath };
}

/** 真依赖（桌面端专用，惰性 require：移动端没有 Node 模块）。 */
export function defaultLlamaDeps(): LlamaDeps {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');

    return {
        run: (exe, args, cancel) =>
            new Promise((resolve) => {
                let child: LlamaChild;
                try {
                    child = cp.spawn(exe, args, { windowsHide: true }) as unknown as LlamaChild;
                } catch (e) {
                    resolve({ code: null, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
                    return;
                }
                let out = '';
                let err = '';
                let settled = false;
                let cancelled = false;
                const finish = (o: {
                    code: number | null;
                    stdout: string;
                    stderr: string;
                    spawnError?: string;
                    cancelled?: boolean;
                }): void => {
                    if (settled) return;
                    settled = true;
                    resolve(o);
                };
                // 🔴 取消：先打标记再 kill，最后**自己**结算 ——
                //    只等 'close' 的话，Windows 上被杀进程的 close 可能延后甚至不来。
                cancel?.onCancel(() => {
                    if (settled) return;
                    cancelled = true;
                    try {
                        child.kill?.();
                    } catch {
                        /* 已退出 */
                    }
                    finish({ code: null, stdout: out, stderr: err, cancelled: true });
                });
                // ⚠️ 用 Buffer 拼再 toString('utf8')：直接 `+= String(chunk)` 会把
                //    被 chunk 边界腰斩的多字节中文变成 U+FFFD（永久丢字）。
                const outBufs: Buffer[] = [];
                const errBufs: Buffer[] = [];
                child.stdout?.on('data', (c) => {
                    if (typeof c === 'string') out += c;
                    else if (c instanceof Uint8Array) outBufs.push(Buffer.from(c));
                });
                child.stderr?.on('data', (c) => {
                    if (typeof c === 'string') err += c;
                    else if (c instanceof Uint8Array) errBufs.push(Buffer.from(c));
                });
                child.on('error', (e) =>
                    finish({
                        code: null,
                        stdout: out,
                        stderr: err,
                        spawnError: String(e?.code ?? e?.message ?? 'spawn error'),
                    }),
                );
                child.on('close', (code) => {
                    const allOut = (out + Buffer.concat(outBufs).toString('utf8')).trim();
                    const allErr = (err + Buffer.concat(errBufs).toString('utf8')).trim();
                    finish({ code, stdout: allOut, stderr: allErr, cancelled });
                });
            }),
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
                /* 删不掉就算了 */
            }
        },
        // 🔴 必须 utf8，且⛔ 不加 BOM（与 SenseVoice 链路同一口径，见那里的注释）。
        writeFile: (p: string, text: string) => {
            fs.writeFileSync(p, text, { encoding: 'utf8' });
        },
        readFile: (p: string) => fs.readFileSync(p, { encoding: 'utf8' }) as string,
        join: (...parts: string[]) => path.join(...parts),
        dirname: (p: string) => path.dirname(p),
        baseName: (p: string) => path.basename(p, path.extname(p)),
        platform: process.platform,
    };
}
