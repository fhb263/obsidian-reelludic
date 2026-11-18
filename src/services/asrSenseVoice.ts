/**
 * SenseVoice（sherpa-onnx）原生转写执行层。
 *
 * 🔴 这个文件存在的理由（用户 m11073：「明明配置了 SenseVoice 模型显示已就绪却说没找到
 *    运行程序」）：原来 SenseVoice 走 Qwen3 的 Python 桥接 `cli_bridge.py`，于是
 *    ① 设置页的 SenseVoice 分支**根本没有** Python / 桥接脚本的输入框，
 *    ② 转写入口却无条件先要求这两个，
 *    ③ 状态栏又只看三件套 ⇒ 用户看到绿标、按下去必失败，而且无处可填。
 *    补一条判据只会让状态变红、依旧不可用，所以改成**插件自己起 sherpa**，不碰 Python。
 *
 * 🔴 为什么逐段起进程（而不是一次把全部 wav 喂进去）：
 *    真机实测 `sherpa-onnx-offline.exe` **不流式** —— 8 个片段的结果全在
 *    5876ms 同一毫秒吐出（SPREAD_MS=1）。那样一小时的视频在识别期间进度条完全不动。
 *    逐段的代价是每段都要重新加载模型（实测约 4.1s/次），但单段识别本身只要 0.2s
 *    （2 秒片段）/ 6.6s（120 秒片段，RTF 0.055），所以开销可接受，换来真实进度。
 *
 * ⚠️ 退出码：真机实测 sherpa **成功也返回 0**（早期版本返回 1），⛔ 不能拿退出码当
 *    成败判据 —— 判据是「有没有解析到含 tokens 的那行 JSON」。
 */
import {
    buildExtractArgs,
    ffmpegExeCandidates,
    ffmpegNotFoundMessage,
    lastErrorLine,
    parseFfmpegDuration,
    segmentDetail,
    withPercentLabel,
    ASR_CANCELLED_MESSAGE,
} from 'pure/asrEngine';
import {
    buildSegmentArgs,
    buildSenseVoiceArgs,
    clampEntries,
    entriesToSrt,
    mergePunctOnly,
    parseSenseVoiceJson,
    planSegments,
    segmentIndexOf,
    tokenWords,
    tokensToEntries,
    SV_SEGMENT_SECONDS,
    type SenseVoiceEntry,
} from 'pure/senseVoice';
import { createLineSplitter } from 'pure/lineBuffer';
import type { AsrCancelToken, AsrResult, AsrProgressCallback } from './asr';


/** 抽轨占整条进度的前 10%，切段占 10–14%，识别占 14–99%。 */
const SV_EXTRACT_WEIGHT = 10;
const SV_SPLIT_WEIGHT = 14;

/** 只声明真正用到的子进程表面（与 `services/asr.ts` 的 `AsrChild` 同口径）。 */
export interface SvChild {
    stdout?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    stderr?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
    kill?: (signal?: string) => void;
}

/**
 * 执行层依赖。
 * ⚠️ 抽轨/切段要「跑进程 + 看结果」，但**这两步只需要看退出码与 stderr**，所以共用一个
 *    `run`；识别那一步要逐行解析，用单独的 `runLines`。分成两个是为了让单测能分别造假。
 */
export interface SenseVoiceDeps {
    /** 起进程并收集全部输出（抽轨、切段用） */
    run: (exe: string, args: string[]) => Promise<{ code: number | null; stderr: string; spawnError?: string }>;
    /** 起进程并把每一行喂给回调（识别用） */
    runLines: (
        exe: string,
        args: string[],
        onLine: (line: string) => void,
        cancel?: AsrCancelToken,
    ) => Promise<{ code: number | null; stderr: string; spawnError?: string; cancelled?: boolean }>;
    exists: (p: string) => boolean;
    remove: (p: string) => void;
    /**
     * 把最终 SRT 写到磁盘。
     *
     * 🔴 m11423 之前这里**没有这个能力**：`srtPath` 算出来了、`srt` 也拼好了，
     *    但只作为返回值字符串交给调用方就丢了 ⇒ 用户转写「成功」却一个文件都没有，
     *    面板 `syncCueSource()` 也扫不到字幕，表现为「啥都没关联」。
     * ⚠️ 写盘失败必须**如实报错**，⛔ 不能因为「识别本身成功了」就吞掉 ——
     *    对用户来说没文件的成功等于失败。
     */
    writeFile: (p: string, text: string) => void;
    /** 读回文件内容（写完要复核一遍，见 ④ 之后那段） */
    readFile: (p: string) => string;
    /**
     * 递归删掉一个目录（含里面的东西）。
     *
     * 🔴 真机 e2e 抓到的缺陷：`cleanup()` 原来只 `remove` 目录**里的文件**，
     *    从不删目录本身 ⇒ 每转一次视频，它旁边就永远多一个 `<名字>.sv` 空目录。
     *    用户会以为插件在乱写东西（这正是「转写文件放哪了」这类困惑的养料）。
     * ⚠️ 与 `remove` 分开：`remove` 走 `rmSync(force)` 删文件，
     *    对目录不递归会抛 EPERM，所以⛔ 别指望用 `remove` 顺手把目录也收了。
     */
    rmdir: (p: string) => void;
    /** 列出目录下的文件名（切段后要知道切出了哪些） */
    listDir: (dir: string) => string[];
    mkdirp: (dir: string) => void;
    join: (...parts: string[]) => string;
    /** 目录/文件的父目录 */
    dirname: (p: string) => string;
    /** 去掉扩展名的文件名 */
    baseName: (p: string) => string;
    platform: string;
}

export interface SenseVoiceOptions {
    /** 视频/音频文件系统绝对路径 */
    videoPath: string;
    /** sherpa-onnx-offline(.exe) 路径 */
    exe: string;
    /** model.int8.onnx 或 model.onnx 路径 */
    model: string;
    /** tokens.txt 路径 */
    tokens: string;
    /** ffmpeg 路径（留空走 PATH 候选） */
    ffmpeg?: string;
    lang?: string;
    threads?: number;
    onProgress?: AsrProgressCallback;
    cancel?: AsrCancelToken;
    /** 段长（秒），默认 120 */
    segmentSec?: number;
}

const SV_LABEL = '正在本地识别…';
const SV_SPLIT_LABEL = '正在切分音频…';

/**
 * 用 SenseVoice 转写一段音视频，产出 SRT。
 *
 * 流程：ffmpeg 抽 16k 单声道 wav → 按 120s 切段 → 逐段 sherpa 识别 → 聚合句级 → 夹时间轴 → SRT。
 */
export async function transcribeWithSenseVoice(
    deps: SenseVoiceDeps,
    opts: SenseVoiceOptions,
): Promise<AsrResult> {
    const video = String(opts.videoPath ?? '').trim();
    if (!video) return { ok: false, message: '缺少视频路径' };
    if (opts.cancel?.cancelled) return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };

    const exe = String(opts.exe ?? '').trim();
    if (!exe) return { ok: false, message: '还没有指定 SenseVoice 的识别程序（sherpa-onnx-offline）' };
    if (!deps.exists(exe)) return { ok: false, message: `找不到识别程序：${exe}` };
    const model = String(opts.model ?? '').trim();
    if (!model || !deps.exists(model)) return { ok: false, message: `找不到识别模型：${model || '(空)'}` };
    const tokens = String(opts.tokens ?? '').trim();
    if (!tokens || !deps.exists(tokens)) return { ok: false, message: `找不到词表文件：${tokens || '(空)'}` };

    const segSec = Number(opts.segmentSec ?? SV_SEGMENT_SECONDS);
    const segDirName = `${deps.baseName(video)}.sv`;
    const workDir = deps.join(deps.dirname(video), segDirName);
    const wav = deps.join(deps.dirname(video), `${deps.baseName(video)}.asr.wav`);
    const srtPath = deps.join(deps.dirname(video), `${deps.baseName(video)}.srt`);

    const cleanup = (): void => {
        // ⚠️ 中间的 wav 与切段目录必须清掉：一小时视频会留下几百 MB，
        //    用户看到视频旁边多出一堆文件会以为插件乱写东西。
        for (const name of [wav]) {
            try {
                deps.remove(name);
            } catch {
                /* 删不掉不该让整次转写失败 */
            }
        }
        try {
            for (const f of deps.listDir(workDir)) deps.remove(deps.join(workDir, f));
        } catch {
            /* 目录可能压根没建 */
        }
        // 🔴 目录本身也要收（真机 e2e 抓到：只删文件会留下 `<名字>.sv` 空目录）
        try {
            deps.rmdir(workDir);
        } catch {
            /* 已经被删掉 / 没权限，不该让整次转写失败 */
        }
    };
    /**
     * 写盘阶段的失败。
     *
     * 🔴 与 `fail` 的唯一区别：**不清理中间产物**。
     *    识别本身已经把活干完了，卡在最后一步写不进去（权限/只读目录/磁盘满）——
     *    这时候把中间 wav 和切段文件删掉，等于让用户白等十几分钟还要从头再来；
     *    留着的话，修好权限后直接重跑还能省下识别那一段（Whisper 链路的片文件续传同理）。
     * ⚠️ 也别自作主张把 SRT 写到别处去「凑一个成功」—— 用户要的是视频同目录，
     *    换个地方放他照样找不到，只是把「啥都没关联」藏得更深。
     */
    const failKeep = (message: string): AsrResult => ({ ok: false, message });
    const fail = (message: string): AsrResult => {
        cleanup();
        return { ok: false, message };
    };
    /**
     * 用户主动停止。
     * 🔴 必须与 `fail` 分开：视图层靠 `cancelled` 区分「用户按的」与「真的失败」，
     *    否则点了停止会弹一个「转写失败」的红叉（既有 whisper 链路同口径）。
     * ⚠️ 也要 `cleanup()` —— 停下来的半截 wav 与切段文件同样不能留在视频旁边。
     */
    const stop = (): AsrResult => {
        cleanup();
        return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };
    };

    // ① 抽音轨
    opts.onProgress?.(null, '正在提取音频…');
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
        // ⚠️ `-loglevel info` 把 Duration 打在 stderr，抽轨后从这里读总长；
        //    读不到（流式输入）就继续走，后面用段号推算偏移。
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

    // ② 切段（总长未知时只切一刀，让 sherpa 吃整个 wav）
    opts.onProgress?.(SV_EXTRACT_WEIGHT, withPercentLabel(SV_SPLIT_LABEL, SV_EXTRACT_WEIGHT));
    const plan = totalSec !== null && totalSec > 0 ? planSegments(totalSec, segSec) : [{ start: 0, end: 0 }];
    const pattern = deps.join(workDir, 'seg_%04d.wav');
    try {
        deps.mkdirp(workDir);
    } catch (e) {
        return fail(`无法创建临时目录：${e instanceof Error ? e.message : String(e)}`);
    }
    if (plan.length > 1) {
        const s = await deps.run(ffUsed, buildSegmentArgs(wav, pattern, segSec));
        if (s.spawnError) return fail(s.spawnError === 'ENOENT' ? ffmpegNotFoundMessage() : s.spawnError);
        if (s.code !== 0) return fail(lastErrorLine(s.stderr, '切分音频失败'));
    }
    // 决定要喂给 sherpa 的文件：能切就按段号，切不成就用整段 wav
    let inputs: { file: string; offset: number }[] = [];
    if (plan.length > 1) {
        const names = deps
            .listDir(workDir)
            .filter((n) => /^seg_\d+\.wav$/i.test(n))
            .sort((a, b) => segmentIndexOf(a) - segmentIndexOf(b));
        inputs = names.map((n) => ({ file: deps.join(workDir, n), offset: segmentIndexOf(n) * segSec }));
        // ⚠️ 一段都没切出来（ffmpeg 静默失败）就退回整段，⛔ 别返回空字幕
        if (inputs.length === 0) inputs = [{ file: wav, offset: 0 }];
    } else {
        inputs = [{ file: wav, offset: 0 }];
    }

    // ③ 逐段识别
    const allEntries: SenseVoiceEntry[] = [];
    const total = inputs.length;
    let lastDetail = '';
    for (let i = 0; i < total; i++) {
        if (opts.cancel?.cancelled) return stop();
        const item = inputs[i];
        const offset = item.offset;
        // 段长：优先用计划里的真实长度，否则用段长常量（末段可能更短）
        const dur = plan[i] ? Math.max(0, plan[i].end - plan[i].start) : segSec;
        let payload: ReturnType<typeof parseSenseVoiceJson> = null;
        const r = await deps.runLines(
            exe,
            buildSenseVoiceArgs({
                model,
                tokens,
                lang: opts.lang,
                threads: opts.threads,
                wavs: [item.file],
            }),
            (line) => {
                const got = parseSenseVoiceJson(line);
                if (got) payload = got;
            },
            opts.cancel,
        );
        if (r.cancelled) return stop();
        if (r.spawnError === 'ENOENT') return fail(`找不到识别程序：${exe}`);
        // 🔴 判据是「解析到 JSON」，不是退出码（真机实测成功也返回 0，老版本返回 1）
        let fresh: SenseVoiceEntry[] = [];
        if (!payload) {
            // 单段失败不该让整次转写失败（Python 那版也是只打日志继续）
            if (i + 1 === total && allEntries.length === 0) {
                return fail(lastErrorLine(r.stderr, '本地识别失败'));
            }
        } else {
            const words = tokenWords(payload, offset, dur);
            const entries = tokensToEntries(words, offset + dur);
            allEntries.push(...entries);
            fresh = entries;
        }
        const pct = SV_SPLIT_WEIGHT + Math.round(((i + 1) / Math.max(1, total)) * (99 - SV_SPLIT_WEIGHT));
        const detail = payload
            ? segmentDetail({ start: offset, end: offset + dur, text: '' }, totalSec)
            : lastDetail;
        // 🔴 实时流（用户 m11612「每一句转写」）：本段新识别出的句子逐条送出去。
        //    ⚠️ 一次只带一句：`AsrProgressCallback` 的第 4 参是**单句**，
        //    这样视图层的追加/判重逻辑与 whisper 链路完全一致（⛔ 别在这里另造一套批量协议）。
        //    ⚠️ 段落推进的那次回调（不带句子）照旧要发，否则「一段识别完但没新句」时进度会停住。
        if (fresh.length > 0) {
            for (const entry of fresh) {
                const line = { start: entry.start, end: entry.end, text: entry.text };
                opts.onProgress?.(
                    Math.min(99, pct),
                    withPercentLabel(SV_LABEL, Math.min(99, pct)),
                    detail || undefined,
                    line,
                );
            }
        } else if (detail !== lastDetail || pct > 0) {
            opts.onProgress?.(Math.min(99, pct), withPercentLabel(SV_LABEL, Math.min(99, pct)), detail || undefined);
        }
        lastDetail = detail;
    }

    // ④ 聚合成 SRT
    const merged = mergePunctOnly(allEntries);
    const clamped = totalSec !== null && totalSec > 0 ? clampEntries(merged, totalSec) : merged;
    const srt = entriesToSrt(clamped.filter((e) => e.text.trim().length > 0));
    if (!srt.trim()) return fail('没有识别到可用的语音内容（可能是纯音乐或静音）');

    // ⑤ 写盘（🔴 m11423：以前漏了这一步，识别成功但磁盘上什么都没留下）
    // ⚠️ 这条路径**不能**走 `fail`（它会 cleanup 掉中间产物）—— 见 `failKeep` 的注释。
    try {
        deps.writeFile(srtPath, srt);
    } catch (e) {
        return failKeep(`字幕写盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
    // 复核一遍：写进去但读不回来（权限/磁盘满）同样算失败，⛔ 别只信 writeFile 没抛
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
export function defaultSenseVoiceDeps(): SenseVoiceDeps {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');

    const collect = (exe: string, args: string[]): Promise<{ code: number | null; stderr: string; spawnError?: string }> =>
        new Promise((resolve) => {
            let child: SvChild;
            try {
                child = cp.spawn(exe, args, { windowsHide: true }) as unknown as SvChild;
            } catch (e) {
                resolve({ code: null, stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
                return;
            }
            let err = '';
            let settled = false;
            const finish = (o: { code: number | null; stderr: string; spawnError?: string }): void => {
                if (settled) return;
                settled = true;
                resolve(o);
            };
            child.stderr?.on('data', (c) => {
                err += String(c ?? '');
            });
            child.stdout?.on('data', () => {
                /* 抽轨/切段的 stdout 用不上 */
            });
            child.on('error', (e) => finish({ code: null, stderr: err, spawnError: String(e?.code ?? e?.message ?? 'spawn error') }));
            child.on('close', (code) => finish({ code, stderr: err }));
        });

    return {
        run: collect,
        runLines: (exe, args, onLine, cancel) =>
            new Promise((resolve) => {
                let child: SvChild;
                try {
                    child = cp.spawn(exe, args, { windowsHide: true }) as unknown as SvChild;
                } catch (e) {
                    resolve({ code: null, stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
                    return;
                }
                let err = '';
                let settled = false;
                let cancelled = false;
                const finish = (o: { code: number | null; stderr: string; spawnError?: string; cancelled?: boolean }): void => {
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
                    finish({ code: null, stderr: err, cancelled: true });
                });
                /**
                 * 🔴 跨 chunk 的行缓冲（用户 m12618「每隔 2 分钟出句」的真根因）。
                 *
                 * sherpa 把结果 JSON **打在 stderr**，一条 JSON 有 5～10KB，而 Node 的
                 * stream chunk 边界与换行边界毫无关系。旧实现是「每个 chunk 各自 split」，
                 * 一行 JSON 被切成两半时**两个片段都 parse 失败** ⇒ 那一段的 `payload`
                 * 为 null ⇒ 整段句子静默消失，用户看到的就是「每隔 120 秒才出一句」
                 * （恰好是 `SV_SEGMENT_SECONDS` 的整数倍 —— 丢的正是被切开的那些段）。
                 *
                 * 现在统一走 `pure/lineBuffer`（与 `asrQwen.ts` 同一份实现）：攒够整行再解码，
                 * `close` 时 flush 残留半行。⛔ 别再用 `String(chunk)` 直接解 ——
                 * 多字节中文被腰斩时那半个字符的信息会**永久丢失**（变成 U+FFFD）。
                 *
                 * ⚠️ 文档说「JSON 在 stderr」，但不同版本的 sherpa 可能换流，所以**两个流都喂**。
                 *    `err` 也走 splitter 的 `onText` 累积，避免把中文错误信息解成乱码。
                 */
                const outSplitter = createLineSplitter();
                const errSplitter = createLineSplitter((text) => {
                    err += text;
                });
                const feed = (chunk: unknown, fromStderr: boolean): void => {
                    const buf =
                        typeof chunk === 'string'
                            ? Buffer.from(chunk, 'utf8')
                            : chunk instanceof Uint8Array
                              ? Buffer.from(chunk)
                              : null;
                    if (!buf) return;
                    for (const line of (fromStderr ? errSplitter : outSplitter).push(buf)) onLine(line);
                };
                child.stdout?.on('data', (c) => feed(c, false));
                child.stderr?.on('data', (c) => feed(c, true));
                child.on('error', (e) =>
                    finish({ code: null, stderr: err, spawnError: String(e?.code ?? e?.message ?? 'spawn error') }),
                );
                child.on('close', (code) => {
                    // 收尾：残留的半行（没有换行结尾）也要处理，否则最后一条 JSON 会漏
                    for (const line of outSplitter.flush()) onLine(line);
                    for (const line of errSplitter.flush()) onLine(line);
                    finish({ code, stderr: err, cancelled });
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
        // 🔴 必须 `utf8`：SRT 里全是中文，用默认缓冲区写出去播放器会乱码。
        //    ⛔ 别加 BOM —— 实测 PotPlayer / VLC 与 Obsidian 内嵌播放器对带 BOM 的 SRT
        //    偶发首行时间轴解析失败（同一个坑本项目在 styles.css 上踩过）。
        writeFile: (p: string, text: string) => {
            fs.writeFileSync(p, text, { encoding: 'utf8' });
        },
        readFile: (p: string) => fs.readFileSync(p, { encoding: 'utf8' }) as string,
        rmdir: (p: string) => {
            fs.rmSync(p, { recursive: true, force: true });
        },
        listDir: (dir: string) => {
            try {
                return fs.readdirSync(dir) as string[];
            } catch {
                return [];
            }
        },
        mkdirp: (dir: string) => {
            fs.mkdirSync(dir, { recursive: true });
        },
        join: (...parts: string[]) => path.join(...parts),
        dirname: (p: string) => path.dirname(p),
        baseName: (p: string) => path.basename(p, path.extname(p)),
        platform: process.platform,
    };
}

