import { describe, expect, it } from 'vitest';
import { createAsrCancelToken, transcribeWithWhisper, type AsrChild, type AsrDeps } from 'services/asr';

/**
 * 假子进程：把一个预设的输出行在 `nextTick` 里灌进来，然后关掉。
 * 🔴 必须异步关：真 `spawn` 的事件全是异步的，同步 close 会掩盖「close 在 data 之前到」这类竞态。
 */
function fakeChild(opts: { stdout?: string; stderr?: string; code?: number | null; spawnError?: string }): AsrChild {
    const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
    const on = (ev: string, cb: (arg?: unknown) => void): void => {
        (listeners[ev] = listeners[ev] ?? []).push(cb);
    };
    const child: AsrChild = {
        stdout: { on: (ev, cb) => on(`stdout:${ev}`, cb as (arg?: unknown) => void) },
        stderr: { on: (ev, cb) => on(`stderr:${ev}`, cb as (arg?: unknown) => void) },
        on: (ev, cb) => on(ev, cb as (arg?: unknown) => void),
    };
    setTimeout(() => {
        if (opts.spawnError) {
            for (const cb of listeners['error'] ?? []) cb({ code: opts.spawnError });
            return;
        }
        if (opts.stdout) for (const cb of listeners['stdout:data'] ?? []) cb(opts.stdout);
        if (opts.stderr) for (const cb of listeners['stderr:data'] ?? []) cb(opts.stderr);
        for (const cb of listeners['close'] ?? []) cb(opts.code ?? 0);
    }, 0);
    return child;
}

interface Recorder {
    deps: AsrDeps;
    spawned: { exe: string; args: string[] }[];
    removed: string[];
    progress: { percent: number | null; label: string }[];
}

/**
 * 造一套假依赖。
 * `plan` 按**起进程的顺序**给输出：第 1 次是 ffmpeg、第 2 次是 whisper。
 */
function mkDeps(plan: {
    steps: { stdout?: string; stderr?: string; code?: number | null; spawnError?: string }[];
    files?: Record<string, string>;
    platform?: string;
}): Recorder {
    const spawned: { exe: string; args: string[] }[] = [];
    const removed: string[] = [];
    const progress: { percent: number | null; label: string }[] = [];
    const files = new Map(Object.entries(plan.files ?? {}));
    const deps: AsrDeps = {
        spawn: (exe, args) => {
            const idx = spawned.length;
            spawned.push({ exe, args });
            return fakeChild(plan.steps[idx] ?? { code: 0 });
        },
        exists: (p) => files.has(p),
        remove: (p) => {
            removed.push(p);
            files.delete(p);
        },
        readText: (p) => {
            const v = files.get(p);
            if (v === undefined) throw new Error('ENOENT');
            return v;
        },
        platform: plan.platform ?? 'win32',
    };
    return { deps, spawned, removed, progress };
}

const VIDEO = 'C:\\v\\a.mp4';
const MODEL = 'C:\\m\\ggml-base.bin';
const WAV = 'C:\\v\\a.asr.wav';
const SRT = 'C:\\v\\a.srt';

const okSrt = '1\n00:00:01,000 --> 00:00:03,000\n你好\n';

function okDeps(extra?: { srt?: string; files?: Record<string, string> }): Recorder {
    return mkDeps({
        steps: [
            { code: 0 }, // ffmpeg
            { stderr: 'whisper_print_progress_callback: progress = 100%\n', code: 0 }, // whisper
        ],
        files: { [MODEL]: 'bin', [WAV]: 'wav', ...(extra?.files ?? { [SRT]: extra?.srt ?? okSrt }) },
    });
}

describe('transcribeWithWhisper · 前置校验', () => {
    it('缺视频路径 ⇒ 直接报错，不起任何进程', async () => {
        const r = okDeps();
        const out = await transcribeWithWhisper(r.deps, { videoPath: '  ', model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('视频路径');
        expect(r.spawned).toHaveLength(0);
    });

    it('缺模型路径 / 模型文件不存在 ⇒ 报「还没设置识别模型」，不起进程', async () => {
        const a = okDeps();
        expect((await transcribeWithWhisper(a.deps, { videoPath: VIDEO, model: '' })).message).toContain('ggml');
        expect(a.spawned).toHaveLength(0);

        const b = mkDeps({ steps: [], files: {} });
        const out = await transcribeWithWhisper(b.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('.bin');
        expect(b.spawned).toHaveLength(0);
    });
});

describe('transcribeWithWhisper · 成功路径', () => {
    it('两个阶段都起、参数正确、返回 srt 原文与路径', async () => {
        const r = okDeps();
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(true);
        expect(out.srt).toBe(okSrt);
        expect(out.srtPath).toBe(SRT);
        expect(r.spawned).toHaveLength(2);

        // ① ffmpeg：16kHz 单声道
        expect(r.spawned[0].exe).toBe('ffmpeg.exe');
        expect(r.spawned[0].args).toContain('-ar');
        expect(r.spawned[0].args[r.spawned[0].args.indexOf('-ar') + 1]).toBe('16000');

        // ② whisper：-osrt + -pp + -of 基名
        expect(r.spawned[1].exe).toBe('whisper-cli.exe');
        expect(r.spawned[1].args).toContain('-osrt');
        expect(r.spawned[1].args).toContain('-pp');
        expect(r.spawned[1].args[r.spawned[1].args.indexOf('-of') + 1]).toBe('C:\\v\\a');
    });

    it('中间 wav 用完就删（同目录多出个大文件用户会困惑）', async () => {
        const r = okDeps();
        await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(r.removed).toContain(WAV);
    });

    it('进度：先「提取音频」，再识别段带百分比数字、最后 100%', async () => {
        const r = okDeps();
        const seen: { percent: number | null; label: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (p, l) => seen.push({ percent: p, label: l }),
        });
        expect(seen[0]).toEqual({ percent: null, label: '正在提取音频…' });
        // 🔴 用户 m06361：「怎么没有百分比进度条提示啊」⇒ 文案里必须带数字，
        //    否则条在走、字不动，用户读不到任何进度。
        // 识别段从 EXTRACT_WEIGHT(15%) 起步：抽轨占 0–14%，两段不重叠。
        expect(seen.some((s) => s.label.startsWith('正在本地识别') && s.label.includes('%') && s.percent === 15)).toBe(true);
        expect(seen.some((s) => s.percent === 100)).toBe(true);
    });

    it('whisper 的进度在 stderr —— 只挂 stdout 的话进度条永远不动', async () => {
        const r = okDeps();
        const seen: number[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (p) => {
                if (p !== null) seen.push(p);
            },
        });
        expect(seen).toContain(100);
    });
});

describe('transcribeWithWhisper · 失败路径（每条都必须说人话）', () => {
    it('ffmpeg 的 ENOENT ⇒ 报「没找到 ffmpeg 并说明抽音轨是前置」', async () => {
        const r = mkDeps({ steps: [{ spawnError: 'ENOENT' }, { spawnError: 'ENOENT' }], files: { [MODEL]: 'bin' } });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('ffmpeg');
        expect(out.message).toContain('16kHz');
    });

    it('ffmpeg 非 0 退出 ⇒ 取 stderr 最后一行', async () => {
        const r = mkDeps({
            steps: [{ stderr: 'noise\nInvalid data found when processing input\n', code: 1 }],
            files: { [MODEL]: 'bin' },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toBe('Invalid data found when processing input');
    });

    it('whisper 的 ENOENT ⇒ 报「没找到 whisper.cpp」并给出装法提示', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { spawnError: 'ENOENT' }, { spawnError: 'ENOENT' }, { spawnError: 'ENOENT' }, { spawnError: 'ENOENT' }],
            files: { [MODEL]: 'bin', [WAV]: 'wav' },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('whisper.cpp');
        expect(out.message).toContain('设置');
    });

    it('whisper 非 0 退出 ⇒ 取 stderr 最后一行', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { stderr: 'ggml_new_tensor_impl: not enough space\n', code: 2 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav' },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toBe('ggml_new_tensor_impl: not enough space');
    });

    it('退出码 0 但没生成 srt ⇒ 必须在以下情况显式报错，不能假装成功', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { code: 0 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav' },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('没有生成字幕文件');
    });

    it('生成的字幕是空的 ⇒ 报「可能是这段音轨没有可识别的人声」', async () => {
        const r = okDeps({ srt: '   \n\n' });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('空的');
    });

    it('读 srt 抛错 ⇒ 包成可读文案，不把原始异常弹给用户', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { code: 0 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: 'x' },
        });
        // 先让 exists 通过、再让 readText 抛
        const deps: AsrDeps = { ...r.deps, exists: (p) => p === MODEL || p === WAV || p === SRT, readText: () => { throw new Error('EACCES'); } };
        const out = await transcribeWithWhisper(deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('读取生成的字幕失败');
        expect(out.message).toContain('EACCES');
    });
});

describe('transcribeWithWhisper · 候选名降级', () => {
    it('用户填了 exe/ffmpeg 就只用他填的（⛔ 不回退候选名绕过配置）', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { stderr: 'progress = 100%\n', code: 0 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            exe: 'D:\\w\\whisper-cli.exe',
            ffmpeg: 'E:\\f\\ffmpeg.exe',
        });
        expect(r.spawned[0].exe).toBe('E:\\f\\ffmpeg.exe');
        expect(r.spawned[1].exe).toBe('D:\\w\\whisper-cli.exe');
    });

    it('第一个候选 ENOENT 时换下一个（whisper.cpp 改过二进制名）', async () => {
        const r = mkDeps({
            steps: [{ code: 0 }, { spawnError: 'ENOENT' }, { stderr: 'progress = 100%\n', code: 0 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(true);
        expect(r.spawned[1].exe).toBe('whisper-cli.exe');
        expect(r.spawned[2].exe).toBe('main.exe');
    });

    it('非 ENOENT 的 spawn 错误不降级 —— 换名字解决不了权限/占用问题', async () => {
        const r = mkDeps({
            steps: [{ spawnError: 'EBUSY' }, { code: 0 }],
            files: { [MODEL]: 'bin', [WAV]: 'wav' },
        });
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('EBUSY');
        expect(r.spawned).toHaveLength(1);
    });
});

/**
 * 🔴 用户 m06361：「也没有停止转录的交互」。
 * 这组守的是「点了停止必须真的停下来」—— 最容易漏的一条是：
 * 子进程被 kill 后 `close` 可能延后甚至不来，若只等 `close`，用户点了停止会一直卡住。
 */
describe('transcribeWithWhisper · 抽轨段的真实百分比', () => {
    /**
     * 🔴 用户 m06361 的原始抱怨是「怎么没有百分比进度条」。
     *    上一版只有一条 `onProgress(null, '正在提取音频…')` —— 全程跑马灯，一个数字都没有。
     *    这组用**真实 ffmpeg 输出片段**证明：抽轨阶段就会按 `out_time_us / Duration` 报数字。
     */
    const FFMPEG_STDERR = [
        '  Duration: 00:01:40.00, start: 0.000000, bitrate: 128 kb/s',
        'out_time_us=0',
        'out_time_us=25000000', // 25s / 100s = 25% ⇒ floor(0.25*15)=3
        'out_time_us=50000000', // 50% ⇒ floor(0.5*15)=7
        'out_time_us=75000000', // 75% ⇒ floor(0.75*15)=11
        'out_time_us=100000000', // 100% ⇒ 夹到 14（15 留给识别段）
        'progress=end',
    ].join('\n');

    function withFfmpeg(stderr: string): Recorder {
        return mkDeps({
            steps: [
                { stderr, code: 0 },
                { stderr: 'progress = 100%\n', code: 0 },
            ],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
    }

    it('抽轨段百分比随已处理秒数上升（不是一路跑马灯）', async () => {
        const r = withFfmpeg(FFMPEG_STDERR);
        const seen: { percent: number | null; label: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (p, l) => seen.push({ percent: p, label: l }),
        });
        const extractPcts = seen
            .filter((s) => s.label.startsWith('正在提取音频'))
            .map((s) => s.percent)
            .filter((p): p is number => p !== null);
        expect(extractPcts.length).toBeGreaterThan(1);
        // 单调不减，且严格出现过多个不同值（只有 0 一个值等于没动）
        for (let i = 1; i < extractPcts.length; i++) expect(extractPcts[i]).toBeGreaterThanOrEqual(extractPcts[i - 1]);
        expect(new Set(extractPcts).size).toBeGreaterThan(1);
        // 抽轨段封顶 14：15 是识别段的起点，两段不能重叠
        expect(Math.max(...extractPcts)).toBeLessThanOrEqual(14);
        expect(Math.min(...extractPcts)).toBeGreaterThanOrEqual(0);
    });

    it('抽轨段的文案带百分比数字（用户要的是看得见的数字）', async () => {
        const r = withFfmpeg(FFMPEG_STDERR);
        const seen: string[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (_p, l) => seen.push(l),
        });
        // 至少有一条抽轨文案是「正在提取音频 NN%」
        expect(seen.some((l) => /^正在提取音频 \d+%$/.test(l))).toBe(true);
    });

    it('拿不到 Duration ⇒ 老实画不定态，⛔ 不编一个假百分比', async () => {
        // 只有 out_time、没有 Duration 行（例如流式输入）
        const r = withFfmpeg('out_time_us=50000000\nout_time_us=90000000\nprogress=end');
        const seen: { percent: number | null; label: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (p, l) => seen.push({ percent: p, label: l }),
        });
        const extract = seen.filter((s) => s.label.startsWith('正在提取音频'));
        expect(extract.length).toBeGreaterThan(0);
        expect(extract.every((s) => s.percent === null)).toBe(true);
        expect(extract.every((s) => !/\d+%/.test(s.label))).toBe(true);
    });

    it('抽轨段与识别段不重叠：15% 一定由识别段发出', async () => {
        const r = withFfmpeg(FFMPEG_STDERR);
        const seen: { percent: number | null; label: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (p, l) => seen.push({ percent: p, label: l }),
        });
        const firstAsr = seen.find((s) => s.label.startsWith('正在本地识别'));
        expect(firstAsr?.percent).toBe(15);
    });
});

/**
 * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
 *
 * 这一组守的是**第四参 `line`**：whisper 的字幕行本来就带整句正文
 * （`[00:00:01.000 --> 00:00:03.000]  你好`），旧实现只拿它算百分比就把正文丢了，
 * 于是转写期间面板只能显示进度条。现在必须把句子交出去。
 */
describe('transcribeWithWhisper · 逐句实时流（m11612）', () => {
    /** whisper 的真实字幕行形态（实测见 services/asr.ts 的 parseAsrSegment 用法） */
    const ASR_LINES = [
        '[00:00:00.000 --> 00:00:02.500]  Good morning.',
        '[00:00:02.500 --> 00:00:05.000]  This is a test.',
        '[00:00:05.000 --> 00:00:07.500]  第三句中文。',
    ].join('\n');

    function withLines(): Recorder {
        return mkDeps({
            steps: [
                { stderr: '  Duration: 00:00:20.00, start: 0.000000\n', code: 0 },
                { stderr: `${ASR_LINES}\n`, code: 0 },
            ],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
    }

    it('每识别出一句就回吐一行（时间轴 + 正文都带上）', async () => {
        const r = withLines();
        const lines: { start: number; end: number; text: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (_p, _l, _d, line) => { if (line) lines.push(line); },
        });
        expect(lines).toHaveLength(3);
        expect(lines[0]).toEqual({ start: 0, end: 2.5, text: 'Good morning.' });
        expect(lines[2].text).toBe('第三句中文。');
    });

    it('同一句重复上报只交一次（凭时间轴+正文判重）', async () => {
        const r = mkDeps({
            steps: [
                { stderr: '  Duration: 00:00:20.00, start: 0.000000\n', code: 0 },
                // 同一行出现两次：进度条那侧会去重，句子这一侧也必须去重
                { stderr: '[00:00:01.000 --> 00:00:03.000]  重复\n[00:00:01.000 --> 00:00:03.000]  重复\n', code: 0 },
            ],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
        const lines: { text: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (_p, _l, _d, line) => { if (line) lines.push(line); },
        });
        expect(lines).toHaveLength(1);
    });

    it('拿不到总长时**也要**回吐句子（不能因为算不出百分比就不给字幕）', async () => {
        // ffmpeg 不给 Duration ⇒ 识别段没有总长可算
        const r = mkDeps({
            steps: [
                { stderr: '', code: 0 },
                { stderr: '[00:00:01.000 --> 00:00:03.000]  没有总长也得出句\n', code: 0 },
            ],
            files: { [MODEL]: 'bin', [WAV]: 'wav', [SRT]: okSrt },
        });
        const lines: { text: string }[] = [];
        await transcribeWithWhisper(r.deps, {
            videoPath: VIDEO,
            model: MODEL,
            onProgress: (_p, _l, _d, line) => { if (line) lines.push(line); },
        });
        expect(lines.map((l) => l.text)).toEqual(['没有总长也得出句']);
    });
});

/**
 * 🔴 用户 m06361：「也没有停止转录的交互」。
 * 这组守的是「点了停止必须真的停下来」—— 最容易漏的一条是：
 * 子进程被 kill 后 `close` 可能延后甚至不来，若只等 `close`，用户点了停止会一直卡住。
 */
describe('transcribeWithWhisper · 停止转写', () => {
    /** 一个**永不自己结束**的子进程：只有 `kill()` 才能让它收敛 */
    function hangingChild(killed: () => void): AsrChild {
        const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
        const on = (ev: string, cb: (arg?: unknown) => void): void => {
            (listeners[ev] = listeners[ev] ?? []).push(cb);
        };
        return {
            stdout: { on: (ev, cb) => on(`stdout:${ev}`, cb as (arg?: unknown) => void) },
            stderr: { on: (ev, cb) => on(`stderr:${ev}`, cb as (arg?: unknown) => void) },
            on: (ev, cb) => on(ev, cb as (arg?: unknown) => void),
            // ⚠️ 故意**不**触发 close：真机上被杀进程的 close 并不保证及时到达
            kill: killed,
        };
    }

    it('转写中调 cancel() ⇒ 立刻返回「已停止转写」，不等 close', async () => {
        let kills = 0;
        const deps: AsrDeps = {
            spawn: () => hangingChild(() => { kills += 1; }),
            exists: (p) => p === MODEL || p === WAV,
            remove: () => undefined,
            readText: () => okSrt,
            platform: 'win32',
        };
        const token = createAsrCancelToken();
        const p = transcribeWithWhisper(deps, { videoPath: VIDEO, model: MODEL, cancel: token });
        // 让 spawn 先发生，再点「停止」
        await new Promise((r) => setTimeout(r, 5));
        token.cancel();
        const out = await p;
        expect(out.ok).toBe(false);
        expect(out.cancelled).toBe(true);
        expect(out.message).toBe('已停止转写');
        expect(kills).toBe(1);
    });

    it('停止后清掉半截 wav（否则下次转写会以为上次成功了）', async () => {
        const removed: string[] = [];
        const deps: AsrDeps = {
            spawn: () => hangingChild(() => undefined),
            exists: (p) => p === MODEL || p === WAV,
            remove: (p) => { removed.push(p); },
            readText: () => okSrt,
            platform: 'win32',
        };
        const token = createAsrCancelToken();
        const p = transcribeWithWhisper(deps, { videoPath: VIDEO, model: MODEL, cancel: token });
        await new Promise((r) => setTimeout(r, 5));
        token.cancel();
        await p;
        expect(removed).toContain(WAV);
    });

    it('已经取消过的令牌 ⇒ 不再起任何进程', async () => {
        const r = okDeps();
        const token = createAsrCancelToken();
        token.cancel();
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL, cancel: token });
        expect(out.cancelled).toBe(true);
        expect(r.spawned).toHaveLength(0);
    });

    it('没传 cancel ⇒ 行为不变（回归守卫）', async () => {
        const r = okDeps();
        const out = await transcribeWithWhisper(r.deps, { videoPath: VIDEO, model: MODEL });
        expect(out.ok).toBe(true);
        expect(out.cancelled).toBeUndefined();
    });
});
