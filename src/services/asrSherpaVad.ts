/**
 * sherpa-onnx **VAD 分段**执行层：Paraformer 与 X-ASR 共用。
 *
 * 🔴 为什么这两家必须走 vad-with-*-asr 这两个 exe，而不是 `sherpa-onnx-offline.exe`：
 *    · `--paraformer` 在 offline 版上只吐一整段 JSON，`timestamps` 实测是**空数组**，
 *      没有任何时间信息 ⇒ 建不出多条字幕（一条挂满整段视频）。
 *    · X-ASR 是**流式** zipformer transducer，喂给 offline 版直接崩
 *      （exit 0xC0000409），必须用 `vad-with-online-asr.exe`。
 *    这两个 vad 版 exe 会先用 silero-vad 切语音段再逐段识别，输出天然带段起止，
 *    是唯一能直接写 SRT 的形态。解析器在 `pure/sherpaVad`。
 *
 * 🔴 与 SenseVoice 链路的关键差异：**不需要 ffmpeg 切段**。
 *    SenseVoice 那套是按 120 秒机械切段（因为短语音模型整段喂会崩精度），
 *    VAD 本来就是按语音边界切，再切一次反而会切断句子。
 *
 * ⚠️ 退出码不可信：offline 版识别成功也返回 **1**（真机实测），
 *    online 版返回 0。判据只能是「解析到多少段」。⛔ 别拿 code !== 0 当失败。
 * ⚠️ 结果打在 **stderr**（实测 stdout 全空），两流都要喂。
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
    buildVadOfflineArgs,
    buildVadOnlineArgs,
    parseVadOfflineLine,
    parseVadOnlineHead,
    splitLongSegments,
    VadOnlineCollector,
    vadSegmentsToEntries,
    type VadSegment,
} from 'pure/sherpaVad';
import { clampEntries, entriesToSrt } from 'pure/senseVoice';
import type { AsrCancelToken, AsrResult, AsrProgressCallback } from './asr';
import { defaultSenseVoiceDeps, type SenseVoiceDeps } from './asrSenseVoice';


/** 抽轨占前 10%，识别占 10–99%。 */
const VAD_EXTRACT_WEIGHT = 10;

const VAD_LABEL = '正在本地识别…';

/** 单条字幕的字数上限（超过就按句切，见 `splitLongSegments`）。 */
const VAD_MAX_CHARS = 42;

/** 两种执行模式：Paraformer 走 offline 版 exe，X-ASR 走 online 版 exe。 */
export type SherpaVadMode = 'paraformer' | 'xasr';

export interface SherpaVadOptions {
    /** 视频/音频文件系统绝对路径 */
    videoPath: string;
    mode: SherpaVadMode;
    /** vad-with-offline-asr(.exe) 或 vad-with-online-asr(.exe) 路径 */
    exe: string;
    /** tokens.txt 路径 */
    tokens: string;
    /** silero_vad.onnx 路径（两款 exe 都强制要） */
    vadModel: string;
    /** Paraformer：model.int8.onnx / model.onnx */
    paraformer?: string;
    /** X-ASR：三个 ONNX 缺一不可 */
    encoder?: string;
    decoder?: string;
    joiner?: string;
    ffmpeg?: string;
    threads?: number;
    onProgress?: AsrProgressCallback;
    cancel?: AsrCancelToken;
}

/** 复用 SenseVoice 那套 deps（同一份 fs/spawn 实现，⛔ 别复制第三份）。 */
export type SherpaVadDeps = SenseVoiceDeps;

/**
 * 用 VAD 分段模式转写一段音视频，产出 SRT。
 *
 * 流程：ffmpeg 抽 16k 单声道 wav → 直接喂 vad 版 exe（VAD 自己切段）→ 收段 → 长段切分 → SRT。
 */
export async function transcribeWithSherpaVad(
    deps: SherpaVadDeps,
    opts: SherpaVadOptions,
): Promise<AsrResult> {
    const video = String(opts.videoPath ?? '').trim();
    if (!video) return { ok: false, message: '缺少视频路径' };
    if (opts.cancel?.cancelled) return { ok: false, message: ASR_CANCELLED_MESSAGE, cancelled: true };

    const mode = opts.mode === 'xasr' ? 'xasr' : 'paraformer';
    const exe = String(opts.exe ?? '').trim();
    if (!exe) {
        return {
            ok: false,
            message:
                mode === 'xasr'
                    ? '还没有指定 X-ASR 的识别程序（sherpa-onnx-vad-with-online-asr）'
                    : '还没有指定 Paraformer 的识别程序（sherpa-onnx-vad-with-offline-asr）',
        };
    }
    if (!deps.exists(exe)) return { ok: false, message: `找不到识别程序：${exe}` };

    const tokens = String(opts.tokens ?? '').trim();
    if (!tokens || !deps.exists(tokens)) return { ok: false, message: `找不到词表文件：${tokens || '(空)'}` };
    const vadModel = String(opts.vadModel ?? '').trim();
    if (!vadModel || !deps.exists(vadModel)) {
        return { ok: false, message: `找不到 VAD 模型（silero_vad.onnx）：${vadModel || '(空)'}` };
    }

    // 分模式的必需文件：⛔ 缺一个就别起进程（sherpa 会打 92 行 usage 后静默退出）
    if (mode === 'paraformer') {
        const p = String(opts.paraformer ?? '').trim();
        if (!p || !deps.exists(p)) return { ok: false, message: `找不到 Paraformer 模型：${p || '(空)'}` };
    } else {
        for (const [label, raw] of [
            ['编码器', opts.encoder],
            ['解码器', opts.decoder],
            ['连接器', opts.joiner],
        ] as const) {
            const p = String(raw ?? '').trim();
            if (!p || !deps.exists(p)) return { ok: false, message: `找不到 X-ASR ${label}：${p || '(空)'}` };
        }
    }

    const workDirBase = deps.dirname(video);
    const name = deps.baseName(video);
    const wav = deps.join(workDirBase, `${name}.asr.wav`);
    const srtPath = deps.join(workDirBase, `${name}.srt`);

    const cleanup = (): void => {
        // ⚠️ 中间 wav 必须清掉：一小时视频就是几百 MB，用户看到视频旁边多出文件会以为插件乱写。
        try {
            deps.remove(wav);
        } catch {
            /* 删不掉不该让整次转写失败 */
        }
    };
    /** 写盘阶段失败：**不清理**中间产物（识别已经跑完，重跑不必再抽一次轨）。 */
    const failKeep = (message: string): AsrResult => ({ ok: false, message });
    const fail = (message: string): AsrResult => {
        cleanup();
        return { ok: false, message };
    };
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
        // ⚠️ Duration 打在 stderr，抽轨后从这里读总长；读不到就退化成「按最后一段推进」
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

    // ② 识别（VAD 自己切段，不预先切）
    opts.onProgress?.(VAD_EXTRACT_WEIGHT, withPercentLabel(VAD_LABEL, VAD_EXTRACT_WEIGHT));
    const segments: VadSegment[] = [];
    const collector = new VadOnlineCollector();
    let lastDetail = '';

    /**
     * 实时进度与逐句送出。
     *
     * 🔴 `AsrProgressCallback` 的第 4 参是**单句**，与 whisper / SenseVoice 链路同口径，
     *    ⛔ 别在这里另造批量协议。
     */
    const emit = (seg: VadSegment | null, edgeSec: number): void => {
        const clean = seg ? vadSegmentsToEntries([seg])[0] : undefined;
        if (clean) segments.push(clean);
        const pct =
            totalSec !== null && totalSec > 0
                ? Math.min(99, Math.max(VAD_EXTRACT_WEIGHT, Math.round((edgeSec / totalSec) * 99)))
                : VAD_EXTRACT_WEIGHT;
        const detail =
            totalSec !== null && totalSec > 0
                ? segmentDetail({ start: clean ? clean.start : edgeSec, end: edgeSec, text: '' }, totalSec)
                : '';
        if (clean) {
            opts.onProgress?.(
                pct,
                withPercentLabel(VAD_LABEL, pct),
                detail || lastDetail || undefined,
                { start: clean.start, end: clean.end, text: clean.text },
            );
        } else if (detail && detail !== lastDetail) {
            opts.onProgress?.(pct, withPercentLabel(VAD_LABEL, pct), detail);
        }
        if (detail) lastDetail = detail;
    };

    const args =
        mode === 'paraformer'
            ? buildVadOfflineArgs({
                  tokens,
                  paraformer: String(opts.paraformer ?? '').trim(),
                  vadModel,
                  threads: opts.threads,
                  wav,
              })
            : buildVadOnlineArgs({
                  tokens,
                  encoder: String(opts.encoder ?? '').trim(),
                  decoder: String(opts.decoder ?? '').trim(),
                  joiner: String(opts.joiner ?? '').trim(),
                  vadModel,
                  threads: opts.threads,
                  wav,
              });

    let lastEdge = 0;
    const r = await deps.runLines(
        exe,
        args,
        (line) => {
            if (mode === 'paraformer') {
                const seg = parseVadOfflineLine(line);
                if (seg) {
                    lastEdge = seg.end;
                    emit(seg, seg.end);
                }
                return;
            }
            // online 版：段头给进度，段尾（下一段开头时收口）给句子
            const head = parseVadOnlineHead(line);
            if (head) lastEdge = head.end;
            const closed = collector.push(line);
            if (closed) {
                lastEdge = closed.end;
                emit(closed, closed.end);
            }
        },
        opts.cancel,
    );
    if (r.cancelled) return stop();
    if (r.spawnError === 'ENOENT') return fail(`找不到识别程序：${exe}`);

    if (mode === 'xasr') {
        // 收尾：最后一段没有「下一个段头」触发收口，必须 flush
        for (const seg of collector.finish()) {
            if (!segments.some((s) => s.start === seg.start && s.end === seg.end)) {
                const clean = vadSegmentsToEntries([seg])[0];
                if (clean) segments.push(clean);
            }
        }
    }

    // 🔴 判据：解析到多少段。退出码不可信（offline 版成功也返回 1）。
    if (segments.length === 0) {
        return fail(lastErrorLine(r.stderr, '本地识别失败（没有解析到任何语音段）'));
    }

    // ③ 长段切分 + 收敛时间轴 + 写盘
    const ordered = vadSegmentsToEntries(segments);
    const split = splitLongSegments(ordered, VAD_MAX_CHARS);
    const clamped = totalSec !== null && totalSec > 0 ? clampEntries(split, totalSec) : split;
    const srt = entriesToSrt(clamped.filter((e) => e.text.trim().length > 0));
    if (!srt.trim()) return fail('没有识别到可用的语音内容（可能是纯音乐或静音）');

    try {
        deps.writeFile(srtPath, srt);
    } catch (e) {
        return failKeep(`字幕写盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
    // 复核：写进去但读不回来（权限/磁盘满）同样算失败，⛔ 别只信 writeFile 没抛
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

/** 真依赖（与 SenseVoice 链路同一份实现）。 */
export function defaultSherpaVadDeps(): SherpaVadDeps {
    return defaultSenseVoiceDeps();
}
