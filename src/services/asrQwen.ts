/**
 * 音频转文字：Qwen3-ASR 桥接执行层（调用用户自备的 Python 环境里的 `cli_bridge.py`）。
 *
 * ## 为什么单独一个文件，不并进 `services/asr.ts`
 * `asr.ts` 那条链是「ffmpeg 抽轨 → whisper-cli 写 srt」，两个进程都由插件自己起、路径都能从设置里拼出来。
 * 而这条链是「起一个 python.exe，脚本自己搞定抽音轨 / 分段 / 识别 / 对齐 / 写盘」，
 * 插件只负责**传参 + 读协议 + 判成败**。硬并进去会让 `asr.ts` 里出现两套互不相干的失败分支。
 *
 * ## 依赖全部注入（`QwenBridgeDeps`）
 * 真实现 `defaultQwenDeps()` 惰性 `require`（移动端没有 Node 模块，顶层 import 会让整包崩），
 * 单测注入假进程，⛔ 不能在没有 Python 的机器上真起进程。
 *
 * ## stdout 的坑
 * 🔴 桥接脚本的 stdout 里混着它上游库自己的中文日志与 `\r` 进度条。
 * 解析必须只认 `PROGRESS/DONE/ERROR/RESULT` 四种前缀（见 `pure/asrEngines.parseQwenLine`），
 * 其余当噪声丢掉 —— ⛔ 别把「第一行非空输出」当结果。
 */

import {
    buildQwenArgs,
    parseQwenLine,
    qwenLangFor,
    qwenMissingMessage,
    senseVoiceMissingMessage,
    type AsrEngineId,
} from 'pure/asrEngines';
import { segmentDetail } from 'pure/asrEngine';
import { createLineSplitter } from 'pure/lineBuffer';
// ⚠️ 只借类型：`asr.ts` 不 import 本文件，单向依赖不会成环。
import type { AsrCancelToken } from './asr';

/** 子进程最小表面（与 `services/asr.ts` 的 `AsrChild` 同形，便于复用假实现） */
export interface QwenChild {
    stdout?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    stderr?: { on(event: 'data', cb: (chunk: unknown) => void): void } | null;
    on(event: 'error', cb: (err: { code?: string; message?: string }) => void): void;
    on(event: 'close', cb: (code: number | null) => void): void;
    /**
     * 杀掉子进程（🔴 用户 m06361「停止转录的交互」）。
     * ⚠️ 可选：单测的假子进程不必实现。
     */
    kill?: (signal?: string) => void;
}

export interface QwenBridgeDeps {
    /** `(exe, args)` —— exe 是 python.exe，args 是 `[脚本路径, ...buildQwenArgs(...)]` */
    spawn: (exe: string, args: string[]) => QwenChild;
    exists: (p: string) => boolean;
    readText: (p: string) => string;
    platform: string;
}

export type QwenProgressCallback = (
    percent: number | null,
    label: string,
    detail?: string,
    line?: { start: number; end: number; text: string },
) => void;

export interface QwenTranscribeOptions {
    /** 要转写的视频/音频**系统绝对路径** */
    input: string;
    /** 输出 srt 的**系统绝对路径** */
    out: string;
    /** python.exe 路径（空 ⇒ 直接报引导） */
    python?: string;
    /** `cli_bridge.py` 路径（空 ⇒ 直接报引导） */
    script?: string;
    /** 插件里的语言码（`zh`/`en`…），内部转成脚本认的英文名 */
    lang?: string;
    /** `0.6B` / `1.7B` */
    model?: string;
    /**
     * 模型根目录（其下是 `Qwen3-ASR-0.6B` / `Qwen3-ASR-1.7B` / `Qwen3-ForcedAligner-0.6B`）。
     * 🔴 不传 ⇒ 脚本只用它自己的 `<项目目录>/Qwen`，插件下到别处就永远用不上（m09432 的真缺陷）。
     */
    modelsDir?: string;
    /** VAD 分段上限（秒），0/undefined 用脚本默认 */
    segment?: number;
    onProgress?: QwenProgressCallback;
    /**
     * 走哪条链路。
     *
     * 🔴 **2026-12 m11073 之后，`'sensevoice'` 在这条链路里已停用**：
     *    SenseVoice 改由 `services/asrSenseVoice` 走插件原生链路（自己起 sherpa + ffmpeg），
     *    不再经过这个 Python 桥接。原因见 `main.ts` 的 `transcribeSenseVoiceNative` 注释 ——
     *    一句话：sherpa 是自足二进制，为了它逼用户装一套 torch 是设计错误。
     * ⚠️ 这里的分支与测试暂时保留（删除会牵动 4 条既有断言），但**生产代码不再传 `'sensevoice'`**。
     *    ⛔ 别把它接回来 —— 那等于把「一键装好却提示没找到运行程序」这个 bug 复现一遍。
     */
    engine?: AsrEngineId;
    /** 仅 `engine: 'sensevoice'`：`sherpa-onnx-offline` 可执行文件绝对路径。 */
    sherpaExe?: string;
    /** 仅 `engine: 'sensevoice'`：SenseVoice 的 `model.int8.onnx` 绝对路径。 */
    senseVoiceModel?: string;
    /** 仅 `engine: 'sensevoice'`：SenseVoice 的 `tokens.txt` 绝对路径。 */
    senseVoiceTokens?: string;
    /** 用户点「停止转写」时由视图层触发（🔴 用户 m06361）。 */
    cancel?: AsrCancelToken;
}

export interface QwenTranscribeResult {
    ok: boolean;
    message: string;
    srt?: string;
    srtPath?: string;
    /** 脚本自报的条目数，用于汇报 */
    entries?: number;
    /** 被用户主动停止（⛔ 与失败分开：停止不该弹「转写失败」） */
    cancelled?: boolean;
}

const PREPARE_LABEL = '正在准备…';

/**
 * 起一个进程并把两个流按行喂给回调。
 * @returns 退出码（null = spawn 失败/被信号杀）
 */
function runBridge(
    deps: QwenBridgeDeps,
    exe: string,
    args: string[],
    onLine: (line: string, fromStderr: boolean) => void,
    cancel?: AsrCancelToken,
): Promise<{ code: number | null; stderr: string; spawnError?: string; cancelled?: boolean }> {
    return new Promise((resolve) => {
        let child: QwenChild;
        try {
            child = deps.spawn(exe, args);
        } catch (e) {
            resolve({ code: null, stderr: '', spawnError: e instanceof Error ? e.message : String(e) });
            return;
        }

        let settled = false;
        let cancelled = false;
        let allErr = '';
        /**
         * 🔴 两个流各一个跨块行缓冲（统一走 `pure/lineBuffer`）。
         *
         * 以前这里有一套手写的 `chunkBuffer` / `lastNewline` / `feed`，`asrSenseVoice.ts`
         * 那边却是「每个 chunk 各自 split」—— **两份实现各写一套正是 m12618
         * 「每隔 2 分钟才出句」那次丢段的土壤**。现在统一成一个纯模块，任何一条链路
         * 要改都只改一处，`tests/lineBuffer.test.ts` 也就能同时守住它们。
         */
        const outSplitter = createLineSplitter();
        const errSplitter = createLineSplitter((text) => {
            allErr += text;
        });

        // 🔴 取消：先 kill 再**自己**结算。⛔ 别只等 'close' —— 子进程被杀后
        //    'close' 在 Windows 上可能延后；用户点了「停止」却半天没反应是最糟的体验。
        cancel?.onCancel(() => {
            if (settled) return;
            cancelled = true;
            try {
                child.kill?.();
            } catch {
                /* 已退出：不影响结算 */
            }
            settled = true;
            resolve({ code: null, stderr: allErr, cancelled: true });
        });

        /**
         * 把流的字节交给对应的行切分器，凑够整行的立刻回调。
         *
         * ⛔ 别改成「每个 chunk 自己 split」—— 见 `pure/lineBuffer` 文件头的血泪史。
         */
        const feed = (chunk: unknown, fromStderr: boolean): void => {
            const buf =
                typeof chunk === 'string'
                    ? Buffer.from(chunk, 'utf8')
                    : chunk instanceof Uint8Array
                      ? Buffer.from(chunk)
                      : null;
            if (!buf) return;
            for (const line of (fromStderr ? errSplitter : outSplitter).push(buf)) onLine(line, fromStderr);
        };

        child.stdout?.on('data', (chunk) => feed(chunk, false));
        child.stderr?.on('data', (chunk) => feed(chunk, true));

        child.on('error', (e) => {
            if (settled) return;
            settled = true;
            resolve({ code: null, stderr: allErr, spawnError: String(e?.code ?? e?.message ?? 'spawn error') });
        });
        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            // 收尾：残留的半行（没有换行结尾）也要处理，否则最后一条 DONE 会漏
            for (const line of outSplitter.flush()) onLine(line, false);
            for (const line of errSplitter.flush()) onLine(line, true);
            resolve({ code, stderr: allErr, cancelled });
        });
    });
}

/**
 * 跑 Qwen3-ASR 桥接脚本，把音频转成字幕。
 *
 * 失败全部翻成人话（⛔ 不回传 Python traceback）：
 * - 没配解释器/脚本 → 引导去设置
 * - ENOENT → 「找不到 Python 解释器」
 * - 脚本 `ERROR` 行 → 取它的文案（脚本那边已经是人话）
 * - 退出码 0 但没产物 → 显式报错，⛔ 不假装成功
 */
export async function transcribeWithQwen(
    deps: QwenBridgeDeps,
    opts: QwenTranscribeOptions,
): Promise<QwenTranscribeResult> {
    // 已经在取消态的令牌 ⇒ 一步都不做。
    // 与 transcribeWithWhisper 的 `runWithCandidates` 同口径：用户点了「停止」之后
    // 再开一次转写，绝不能又把 python 进程拉起来（那会让「停止」看起来没生效）。
    if (opts.cancel?.cancelled) return { ok: false, message: '已停止转写', cancelled: true };

    const python = String(opts.python ?? '').trim();
    const script = String(opts.script ?? '').trim();
    if (!python || !script) return { ok: false, message: qwenMissingMessage() };
    if (!deps.exists(python)) return { ok: false, message: `找不到 Python 解释器：${python}` };
    if (!deps.exists(script)) return { ok: false, message: `找不到桥接脚本：${script}` };
    if (!opts.input) return { ok: false, message: '没有可转写的声音来源' };

    // SenseVoice 走 sherpa-onnx 的 C++ CLI：三件套任一缺失都直接给引导，⛔ 别起进程才发现
    const isSv = opts.engine === 'sensevoice';
    const svExe = String(opts.sherpaExe ?? '').trim();
    const svModel = String(opts.senseVoiceModel ?? '').trim();
    const svTokens = String(opts.senseVoiceTokens ?? '').trim();
    if (isSv) {
        if (!svExe || !svModel || !svTokens) return { ok: false, message: senseVoiceMissingMessage() };
        if (!deps.exists(svExe)) return { ok: false, message: `找不到 sherpa-onnx 程序：${svExe}` };
        if (!deps.exists(svModel)) return { ok: false, message: `找不到 SenseVoice 模型：${svModel}` };
        if (!deps.exists(svTokens)) return { ok: false, message: `找不到 SenseVoice 词表：${svTokens}` };
    }

    opts.onProgress?.(null, PREPARE_LABEL);

    const args = [script, ...buildQwenArgs({
        input: opts.input,
        out: opts.out,
        lang: qwenLangFor(opts.lang),
        model: opts.model,
        mode: isSv ? 'sensevoice' : 'transcribe',
        segment: opts.segment,
        modelsDir: opts.modelsDir,
        sherpaExe: svExe,
        senseVoiceModel: svModel,
        senseVoiceTokens: svTokens,
    })];

    let scriptError = '';
    let donePath = '';
    let entries = 0;
    // `SEG` 行只换句级细节，百分比与阶段文案要沿用上一笔 PROGRESS 的
    // （详见下面 `msg.kind === 'seg'` 那段注释）。
    let lastPercent: number | null = null;
    let lastLabel = '';

    const r = await runBridge(
        deps,
        python,
        args,
        (line) => {
            const msg = parseQwenLine(line);
            if (!msg) return; // 上游库的日志，丢掉
            if (msg.kind === 'progress') {
                lastPercent = msg.percent;
                lastLabel = msg.label || '正在识别…';
                opts.onProgress?.(lastPercent, lastLabel);
                return;
            }
            // 桥接脚本每识别完一段就报一次起止时间（用户 m09995：要知道转到哪句了）。
            // 🔴 必须把上一次的百分比与阶段文案一起重发：`percent === null` 在视图层是「不定态」，
            //    会让条从确定进度变成来回扫的跑马灯；`label === ''` 则会把「正在识别 2/3 段」清空。
            //    这一路只换 detail，别的都不动。
            if (msg.kind === 'seg') {
                const detail = segmentDetail({ start: msg.start, end: msg.end, text: '' }, msg.total);
                if (lastPercent !== null) opts.onProgress?.(lastPercent, lastLabel, detail);
                return;
            }
            // 🔴 用户 m11612「每一句转写」：桥接脚本识别阶段每段报一句原文，
            //    这里原样送给视图层铺实时流（百分比沿用当前值，⛔ 不自己编一个）。
            if (msg.kind === 'line') {
                opts.onProgress?.(
                    lastPercent,
                    lastLabel,
                    undefined,
                    { start: msg.start, end: msg.end, text: msg.text },
                );
                return;
            }
            if (msg.kind === 'error') {
                scriptError = msg.message;
                return;
            }
            if (msg.kind === 'done') {
                donePath = msg.srtPath;
                return;
            }
            if (msg.kind === 'result') {
                if (msg.srtPath) donePath = msg.srtPath;
                entries = msg.entries;
            }
        },
        opts.cancel,
    );

    // 🔴 用户点了「停止」⇒ 直接结算为已取消。⛔ 不要往下走「退出码非 0 ⇒ 报失败」那条：
    //    杀进程拿到的退出码常常是 null 或非 0，把用户自己的操作报成错误，用户会以为插件坏了。
    if (r.cancelled) return { ok: false, message: '已停止转写', cancelled: true };

    if (r.spawnError) {
        const codeText = r.spawnError.includes('ENOENT') ? `找不到 Python 解释器：${python}` : `无法启动识别程序：${r.spawnError}`;
        return { ok: false, message: codeText };
    }
    if (scriptError) return { ok: false, message: scriptError };
    if (r.code !== 0) {
        const tail = r.stderr.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
        return { ok: false, message: tail || `识别程序异常退出（退出码 ${String(r.code)}）` };
    }

    const srtPath = donePath || opts.out;
    // 🔴 退出码 0 但没产物 = 脚本版本差异或写盘失败 ⇒ 必须显式报错
    if (!deps.exists(srtPath)) {
        return { ok: false, message: '识别完成但没有生成字幕文件（请检查桥接脚本的输出路径参数）' };
    }
    let srt = '';
    try {
        srt = deps.readText(srtPath);
    } catch (e) {
        return { ok: false, message: `读取生成的字幕失败：${e instanceof Error ? e.message : String(e)}` };
    }
    if (!srt.trim()) return { ok: false, message: '生成的字幕是空的（可能是这段音轨没有可识别的人声）' };

    opts.onProgress?.(100, '转写完成');
    return { ok: true, message: '', srt, srtPath, entries };
}

/** 真实现：惰性 require，⛔ 别把这些提到顶层（移动端没有 Node 模块，顶层 import 会让整包崩）。 */
export function defaultQwenDeps(): QwenBridgeDeps {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const cp = require('child_process') as {
        spawn: (exe: string, args: string[], opts?: Record<string, unknown>) => QwenChild;
    };
    const fs = require('fs') as {
        existsSync: (p: string) => boolean;
        readFileSync: (p: string, enc: string) => string;
    };
    return {
        spawn: (exe, args) =>
            cp.spawn(exe, args, {
                windowsHide: true,
                env: {
                    ...process.env,
                    // 🔴 真机实测（2026-11-29）：不加这两个，Windows 上 Python 的 stdout
                    //    按系统 ANSI 码页（简体中文系统是 cp936）编码 ⇒ 插件这边按 UTF-8 解，
                    //    进度文案全是「����׼����Ƶ��」这种乱码。单测注入的是 Buffer，
                    //    永远碰不到这条路径，只有真起进程才会暴露。
                    PYTHONIOENCODING: 'utf-8',
                    // 顺带关掉 Python 的输出缓冲：不开的话进度要等进程结束才一次性吐出来，
                    // 用户会看到进度条一直停在「正在准备…」然后瞬间跳到完成。
                    PYTHONUNBUFFERED: '1',
                },
            }),
        exists: (p) => {
            try {
                return fs.existsSync(p);
            } catch {
                return false;
            }
        },
        readText: (p) => fs.readFileSync(p, 'utf-8'),
        platform: process.platform,
    };
}

/**
 * 这个引擎是否走 Python 桥接。
 * `sensevoice` 也走桥接（sherpa-onnx 的 CLI 由用户自装、参数形态与 whisper 完全不同），
 * 只有 `whisper` 走插件内建的 `services/asr.ts`。
 */
export function usesPythonBridge(engine: AsrEngineId): boolean {
    return engine !== 'whisper';
}
