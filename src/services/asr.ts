/**
 * 本地音频转文字（ASR）的**执行层**：起 ffmpeg 抽音轨、起 whisper.cpp 转写出 SRT。
 *
 * 🔴 路线（与 `services/ytdlp` 同款，⛔ 别改成「插件内嵌推理引擎」）：
 *    `main.js` 已 95.7%，距用户定的 5MB 上限只剩 214KB —— onnxruntime / transformers.js
 *    随便一个都几十 MB。所以这里**只起外部进程**：用户自装 whisper.cpp + ffmpeg，
 *    插件负责递参数、读进度、收产物。纯逻辑（候选名 / 参数 / 进度解析）全在 `pure/asrEngine`。
 *
 * 两阶段：
 *   ① `ffmpeg -i 视频 -vn -ar 16000 -ac 1 -c:a pcm_s16le 同名.asr.wav`
 *   ② `whisper-cli -m 模型 -f wav -osrt -of 同名 -pp`（它自己写 `.srt`）
 *
 * ⚠️ 依赖全部注入（`AsrDeps`），单测才能在没有 whisper/ffmpeg 的机器上跑；
 *    真实现是 `defaultAsrDeps()`，惰性 `require`（移动端没有 Node 模块，顶层 import 会让整包崩）。
 */

import {
    asrExeCandidates,
    asrModelMissingMessage,
    asrNotFoundMessage,
    asrStageLabel,
    asrWavPathFor,
    asrSrtPathFor,
    ASR_CANCELLED_MESSAGE,
    buildAsrArgs,
    buildExtractArgs,
    ffmpegExeCandidates,
    ffmpegNotFoundMessage,
    lastErrorLine,
    parseAsrPercent,
    parseAsrSegment,
    parseAsrSegmentEnd,
    parseFfmpegDuration,
    parseFfmpegOutTime,
    segmentDetail,
    withPercentLabel,
} from 'pure/asrEngine';

/** 子进程最小表面（只声明我们真正用到的事件）。 */
export interface AsrChild {
    stdout?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    stderr?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
    /**
     * 杀掉子进程（🔴 用户 m06361：「也没有停止转录的交互」）。
     * ⚠️ 可选：单测里的假子进程不必实现；真实现 `cp.spawn` 的返回值天生就有。
     */
    kill?: (signal?: string) => void;
}

/**
 * 取消令牌（宿主 → 执行层）。
 *
 * 🔴 为什么不是 `AbortSignal`：它要跨到 `views/` 那层再传回来，而本仓对外部注入一律
 *    用最小自造对象（见 `EpisodePageExtras`）。这里只需要「打一下标记 + 通知一次」。
 * ⚠️ `onCancel` 可以注册多次（抽轨与识别是两个阶段，各注册一个）；已取消时**立即**回调，
 *    ⛔ 不要只等下一次 `cancel()` —— 那会让「点了停止但已经在跑的那一段」继续烧 CPU。
 */
export interface AsrCancelToken {
    readonly cancelled: boolean;
    onCancel: (cb: () => void) => void;
}

/** 造一个取消令牌（视图层点「停止」时调 `cancel()`）。 */
export interface AsrCancelHandle extends AsrCancelToken {
    cancel: () => void;
}

export function createAsrCancelToken(): AsrCancelHandle {
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
                    /* 单个回调抛错不该拦住其它回调（例如 kill 一个已退出的进程会抛） */
                }
            }
        },
    };
}

/** 一次跑进程的原始结果 */
interface SpawnOutcome {
    code: number | null;
    stdout: string;
    stderr: string;
    /** 起进程本身失败时带出（`ENOENT` = 找不到可执行文件） */
    spawnError?: string;
    /** 是被用户取消掉的（⛔ 不是失败，调用方要分开处理） */
    cancelled?: boolean;
}

/** 执行层依赖（真源 = `defaultAsrDeps`；单测注入假实现） */
export interface AsrDeps {
    spawn: (exe: string, args: string[]) => AsrChild;
    /** 文件/目录是否存在（判产物、判模型在不在） */
    exists: (p: string) => boolean;
    /** 删除文件（失败不抛：残留 wav 不该让整次转写报错） */
    remove: (p: string) => void;
    /** 读文本（读 whisper 产出的 srt） */
    readText: (p: string) => string;
    platform: string;
}

/**
 * 进度回调：`percent` 为 `null` 时只更新阶段文案（与 yt-dlp 那条回调同口径）。
 *
 * 🔴 用户 m09995：「转录中还是只有个进度条百分比都不知道转录到哪句时间戳了」
 *    ⇒ 第三参 `detail` 带**句级细节**（形如 `0:12 → 0:19 / 3:40`），由视图层的浮球
 *    与横幅显示。它可选，是因为抽轨段与阶段切换时说不出「到哪句」——
 *    那种时候给空串，⛔ 不要瞎编一个时间。
 *
 * 🔴 第 4 参 `line`（用户 m11612「转录过程中字幕面板的空态要变成转录过程（每一句转写）」）：
 *    引擎**边跑边吐**的草稿行，视图层拿它铺实时流。为什么单开一个参数而不再塞进 `detail`：
 *    `detail` 是「已经识别到片子哪一段」的一行摘要（会被后来的覆盖），而这里是**追加式**的
 *    句子序列，两者生命周期不同。⚠️ 它可选，抽轨/阶段切换时没有句子可给。
 */
export type AsrProgressCallback = (
    percent: number | null,
    label: string,
    detail?: string,
    line?: { start: number; end: number; text: string },
) => void;

export interface AsrResult {
    ok: boolean;
    /** 失败原因；成功时为空串 */
    message: string;
    /** 成功时产出的 SRT 原文（调用方直接喂面板，⛔ 不再读一次盘） */
    srt?: string;
    /** 成功时产出的 SRT 路径（提示用户「已保存至 …」要用） */
    srtPath?: string;
    /** 被用户主动停止（⛔ 与失败分开：停止不该弹「转写失败」） */
    cancelled?: boolean;
}

const EXTRACT_LABEL = '正在提取音频…';
const ASR_LABEL = '正在本地识别…';

/**
 * 抽轨阶段的进度权重：0–15%。剩下的 15–100% 归识别。
 *
 * 🔴 为什么抽轨只给 15%：正常视频抽轨几秒、识别几十秒到几分钟；两段平分会让「前半程
 *    进度快得像假的、后半程卡死」。⛔ 别改成 50/50。
 */
const EXTRACT_WEIGHT = 15;

/**
 * 起一次进程，stdout/stderr 逐行喂给回调。
 * ⚠️ 两个流**都要解析**：ffmpeg 的进度在 stderr（它把日志写 stderr），whisper.cpp 的 `-pp` 也在 stderr。
 *    只挂 stdout 的话进度条永远不会动（这个坑 yt-dlp 那条链路不存在，因为它只在 stdout 输出）。
 */
function spawnOnce(
    deps: AsrDeps,
    exe: string,
    args: string[],
    onLine?: (line: string, fromStderr: boolean) => void,
    cancel?: AsrCancelToken,
): Promise<SpawnOutcome> {
    return new Promise((resolve) => {
        let child: AsrChild;
        try {
            child = deps.spawn(exe, args);
        } catch (e) {
            resolve({ code: null, stdout: '', stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
            return;
        }
        let out = '';
        let err = '';
        let settled = false;
        let cancelled = false;
        const finish = (o: SpawnOutcome): void => {
            if (settled) return;
            settled = true;
            resolve(o);
        };
        // 🔴 取消：先打标记再 kill，最后**自己**结算。
        //    ⛔ 不能只等 'close'：进程被杀后 Windows 上 close 可能延后甚至不来，
        //    那样 `await` 会一直挂着 —— 用户点了「停止」却没有反应是最糟的一种。
        cancel?.onCancel(() => {
            if (settled) return;
            cancelled = true;
            try {
                child.kill?.();
            } catch {
                /* 已退出 / 无权限：不影响结算 */
            }
            finish({ code: null, stdout: out, stderr: err, cancelled: true });
        });
        const feed = (text: string, fromStderr: boolean): void => {
            for (const line of text.split(/\r?\n/)) {
                if (line.trim()) onLine?.(line, fromStderr);
            }
        };
        child.stdout?.on('data', (chunk) => {
            const text = String(chunk ?? '');
            out += text;
            feed(text, false);
        });
        child.stderr?.on('data', (chunk) => {
            const text = String(chunk ?? '');
            err += text;
            feed(text, true);
        });
        child.on('error', (e) => {
            finish({
                code: null,
                stdout: out,
                stderr: err,
                spawnError: String(e?.code ?? e?.message ?? 'spawn error'),
            });
        });
        child.on('close', (code) => finish({ code, stdout: out, stderr: err, cancelled }));
    });
}

/**
 * 按候选名逐个试跑，只有 `ENOENT` 才换下一个。
 * 🔴 别的 spawn 错误（权限 / EBUSY…）直接报出来 —— 那类问题换名字也解决不了
 *    （这条判据是从 `services/ytdlp` 抄来的，真机踩过）。
 */
async function runWithCandidates(
    deps: AsrDeps,
    candidates: string[],
    args: string[],
    onLine: ((line: string, fromStderr: boolean) => void) | undefined,
    notFound: (exe: string) => string,
    cancel?: AsrCancelToken,
): Promise<{ outcome?: SpawnOutcome; message?: string }> {
    for (let i = 0; i < candidates.length; i++) {
        // 用户在试第二个候选名之前就点了停止 ⇒ 别再起新进程
        if (cancel?.cancelled) return { outcome: { code: null, stdout: '', stderr: '', cancelled: true } };
        const exe = candidates[i];
        const r = await spawnOnce(deps, exe, args, onLine, cancel);
        if (r.cancelled) return { outcome: r };
        if (r.spawnError) {
            if (r.spawnError === 'ENOENT') {
                if (i < candidates.length - 1) continue;
                return { message: notFound(exe) };
            }
            return { message: `无法启动 ${exe}：${r.spawnError}` };
        }
        return { outcome: r };
    }
    return { message: notFound(candidates[candidates.length - 1] ?? '') };
}

/**
 * 转写一集：抽音轨 → 本地识别 → 读回 SRT。
 *
 * @param videoPath 视频/音频文件**系统绝对路径**（库内路径要先由宿主换算，见 `pure/localDirs.resolveLocalDirAbs`）
 * @param opts.model 模型 `.bin` 绝对路径；`opts.exe`/`opts.ffmpeg` 留空则走 PATH 候选名
 */
export async function transcribeWithWhisper(
    deps: AsrDeps,
    opts: {
        videoPath: string;
        model: string;
        exe?: string;
        ffmpeg?: string;
        lang?: string;
        threads?: number;
        onProgress?: AsrProgressCallback;
        /** 用户点「停止转写」时由视图层触发（见 `createAsrCancelToken`） */
        cancel?: AsrCancelToken;
    },
): Promise<AsrResult> {
    const video = String(opts.videoPath ?? '').trim();
    if (!video) return { ok: false, message: '缺少视频路径' };
    const model = String(opts.model ?? '').trim();
    if (!model) return { ok: false, message: asrModelMissingMessage() };
    if (!deps.exists(model)) return { ok: false, message: asrModelMissingMessage() };

    const wav = asrWavPathFor(video);
    const srtPath = asrSrtPathFor(video);
    if (!wav || !srtPath) return { ok: false, message: '无法从视频路径推出输出路径' };

    const cancel = opts.cancel;
    const stopEarly = (): AsrResult | null => (cancel?.cancelled ? { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true } : null);
    const stop = stopEarly();
    if (stop) return stop;

    opts.onProgress?.(null, EXTRACT_LABEL);

    /**
     * 抽轨进度状态。
     * ⚠️ 总时长要等 ffmpeg 读到输入头之后才有（`Duration:` 行），在那之前百分比算不出来，
     *    继续画不定态 —— ⛔ 不要拿 0 当分母凑一个 0%。
     */
    let totalSec: number | null = null;
    let lastPct = -1;
    const emitExtract = (sec: number | null): void => {
        if (sec === null || totalSec === null) return;
        const ratio = Math.max(0, Math.min(1, sec / totalSec));
        // 🔴 抽轨段只占整条的前 EXTRACT_WEIGHT%：上限 14 是为了把 15% 留给「开始识别」
        const pct = Math.max(0, Math.min(EXTRACT_WEIGHT - 1, Math.floor(ratio * EXTRACT_WEIGHT)));
        if (pct === lastPct) return;
        lastPct = pct;
        opts.onProgress?.(pct, withPercentLabel(EXTRACT_LABEL, pct));
    };

    // ① 抽音轨
    const ffCands = ffmpegExeCandidates(opts.ffmpeg, deps.platform);
    const ext = await runWithCandidates(
        deps,
        ffCands,
        buildExtractArgs(video, wav),
        (line) => {
            // ⚠️ 两种行都要看：总时长来自 `-loglevel info` 的 `Duration:`，
            //    已处理秒数来自 `-progress pipe:2` 的 `out_time_us=`。
            const dur = parseFfmpegDuration(line);
            if (dur !== null) {
                totalSec = dur;
                return;
            }
            emitExtract(parseFfmpegOutTime(line));
        },
        () => ffmpegNotFoundMessage(),
        cancel,
    );
    if (ext.outcome?.cancelled) {
        // 半截 wav 必须删掉：下次转写看到同名文件会以为上次成功了
        try {
            deps.remove(wav);
        } catch {
            /* 见上 */
        }
        return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };
    }
    if (!ext.outcome) return { ok: false, message: ext.message ?? ffmpegNotFoundMessage() };
    if (ext.outcome.code !== 0) {
        return { ok: false, message: lastErrorLine(ext.outcome.stderr, '提取音频失败') };
    }

    // ② 本地识别（whisper.cpp 自己写 .srt）
    opts.onProgress?.(EXTRACT_WEIGHT, withPercentLabel(ASR_LABEL, EXTRACT_WEIGHT));
    const asrCands = asrExeCandidates(opts.exe, deps.platform);
    const outBase = srtPath.replace(/\.srt$/i, '');
    /**
     * 识别进度状态。
     * 🔴 用户 m06361 报「没有百分比进度」的根因就在这里：`-pp` 的 `progress = N%`
     *    本机实测**全程只在最后打一次**（13.8s 音频 16.5s 跑完，中间一次都没有）。
     *    真正平滑的信号是**每识别出一句就打一行**的 `[start --> end] 文本`，
     *    所以用「最后一句的结束时间 ÷ 音频总长」算真实进度，`-pp` 的百分比只当兜底。
     */
    const asrTotal = totalSec;
    let asrPct = EXTRACT_WEIGHT;
    /** 上一条已发出的句级细节；同一个值不重复发（否则浮球每帧都在闪同一行） */
    let lastDetail = '';
    /**
     * 已发出的最后一句（供实时流用）。
     * ⚠️ 与 `lastDetail` 分开：`lastDetail` 是摘要串、只用来抑制重复；这里是句子本身。
     */
    let lastLineKey = '';
    const emitAsr = (
        pct: number,
        detail?: string,
        line?: { start: number; end: number; text: string },
    ): void => {
        const clamped = Math.max(EXTRACT_WEIGHT, Math.min(99, Math.round(pct)));
        // ⚠️ 进度不涨但「识别到哪句」变了时，仍要把新细节送出去：
        //    用户 m09995 要看的是句子在推进，不是百分比在推进。
        const nextDetail = detail ?? '';
        // 🔴 实时流（m11612）：句子按 start+end+text 判重，⛔ 用百分比判 ——
        //    同一句会随进度多次上报，按百分比判会把它当成新句子反复追加。
        const lineKey = line ? `${line.start}|${line.end}|${line.text}` : '';
        const lineIsNew = !!line && lineKey !== lastLineKey;
        if (clamped <= asrPct && nextDetail === lastDetail && !lineIsNew) return;
        if (clamped > asrPct) asrPct = clamped;
        lastDetail = nextDetail;
        if (line) lastLineKey = lineKey;
        opts.onProgress?.(asrPct, withPercentLabel(ASR_LABEL, asrPct), nextDetail, lineIsNew ? line : undefined);
    };
    const asr = await runWithCandidates(
        deps,
        asrCands,
        buildAsrArgs({ model, wav, outBase, lang: opts.lang, threads: opts.threads }),
        (line) => {
            const pct = parseAsrPercent(line);
            if (pct !== null) {
                // `-pp` 的 100% 出现在进程尾巴上，实际还没写完 srt ⇒ 封顶 99，
                // 真正的 100% 留给「读到产物并校验通过」之后。
                emitAsr((pct / 100) * (99 - EXTRACT_WEIGHT) + EXTRACT_WEIGHT);
                return;
            }
            // 🔴 字幕行同时给出「到哪句」与「进度」：整段解析一次，两样都用上。
            const seg = parseAsrSegment(line);
            if (seg !== null) {
                const detail = segmentDetail(seg, asrTotal);
                // 🔴 实时流（m11612）：把这一句原文一起送出去。
                //    ⚠️ `seg.text` 可能为空串（纯标点行/版本差异）—— 那是**正常**的，
                //    由 `appendTranscribeLine` 去丢掉，这里不做二次判断（否则要维护两套规则）。
                const draft = { start: seg.start, end: seg.end, text: seg.text };
                if (asrTotal !== null && asrTotal > 0) {
                    emitAsr((seg.end / asrTotal) * (99 - EXTRACT_WEIGHT) + EXTRACT_WEIGHT, detail, draft);
                } else {
                    // 拿不到总长时百分比画不定态，但「到哪句」照旧能说
                    const lineKey = `${draft.start}|${draft.end}|${draft.text}`;
                    const isNew = lineKey !== lastLineKey;
                    if (isNew) lastLineKey = lineKey;
                    opts.onProgress?.(null, withPercentLabel(ASR_LABEL, null), detail, isNew ? draft : undefined);
                    lastDetail = detail;
                }
                return;
            }
            const next = asrStageLabel(line);
            if (next) opts.onProgress?.(null, next);
        },
        () => asrNotFoundMessage(asrCands[0] ?? 'whisper-cli'),
        cancel,
    );
    if (asr.outcome?.cancelled) {
        try {
            deps.remove(wav);
        } catch {
            /* 见上 */
        }
        return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };
    }
    if (!asr.outcome) return { ok: false, message: asr.message ?? asrNotFoundMessage('whisper-cli') };
    if (asr.outcome.code !== 0) {
        return { ok: false, message: lastErrorLine(asr.outcome.stderr, '本地识别失败') };
    }

    // ③ 读回产物
    // 🔴 有退出码 0 却没文件 = whisper 版本差异（个别版本把 srt 写到 cwd）⇒ 必须显式报错，
    //    ⛔ 不能假装成功：面板刷新后一片空白，用户会以为字幕坏了。
    if (!deps.exists(srtPath)) {
        return { ok: false, message: '识别完成但没有生成字幕文件（whisper 可能把结果写到了别处，请检查它的输出目录参数）' };
    }
    let srt = '';
    try {
        srt = deps.readText(srtPath);
    } catch (e) {
        return { ok: false, message: `读取生成的字幕失败：${e instanceof Error ? e.message : String(e)}` };
    }
    if (!srt.trim()) return { ok: false, message: '生成的字幕是空的（可能是这段音轨没有可识别的人声）' };

    // 中间 wav 用完就删（同目录下会显眼地多出一个大文件，用户会困惑）
    try {
        deps.remove(wav);
    } catch {
        /* 删不掉就算了：⛔ 不该因此让整次转写报失败 */
    }

    opts.onProgress?.(100, '转写完成');
    return { ok: true, message: '', srt, srtPath };
}

/**
 * 真依赖（桌面端专用）。
 * 🔴 惰性 `require`（与 `services/ytdlp` / `services/nodeHttp` 同款）：移动端没有 Node 模块，
 *    顶层 `import` 会让整包崩。
 */
export function defaultAsrDeps(): AsrDeps {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cp = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    return {
        spawn: (exe: string, args: string[]) =>
            // ⚠️ 不用 shell：候选名都是 `.exe`（不带 shell 时 Node 不做 PATHEXT 补全的问题
            //    已在 `pure/asrEngine` 用「多候选 + `.exe` 后缀」绕过）。
            //    `windowsHide: true` 防止 Windows 上闪黑窗。
            cp.spawn(exe, args, { windowsHide: true }) as unknown as AsrChild,
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
        readText: (p: string) => String(fs.readFileSync(p, 'utf8')),
        platform: process.platform,
    };
}
