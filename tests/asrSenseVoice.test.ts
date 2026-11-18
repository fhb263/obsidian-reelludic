import { describe, it, expect } from 'vitest';
import { transcribeWithSenseVoice, type SenseVoiceDeps } from '../src/services/asrSenseVoice';
import { createAsrCancelToken } from '../src/services/asr';

/**
 * 造真实的 sherpa 输出行（结构照真机输出，长度关系保持真实）。
 * `offsetApplied` 用不到 —— sherpa 的时间戳永远是段内相对的，偏移由调用方加。
 */
function svLine(text: string, stamps: number[], tokens?: string[]): string {
    const toks = tokens ?? text.split(' ').map((w, i) => (i === 0 ? w : ` ${w}`));
    return JSON.stringify({ lang: '<|en|>', emotion: '<|HAPPY|>', event: '<|Speech|>', text, tokens: toks, timestamps: stamps, durations: [] });
}

const DURATION_LINE = '  Duration: 00:04:10.00, start: 0.000000, bitrate: 128 kb/s';

interface FakeOpts {
    /** 每段识别时返回的行；key = wav 文件名 */
    linesFor?: (file: string) => string[];
    /** 抽轨 stderr（默认带 Duration 4 分 10 秒） */
    extractStderr?: string;
    /** 切出的段文件名（默认 3 段） */
    segments?: string[];
    /** 直接让某个 runLines 抛 spawnError */
    spawnErrorFor?: (file: string) => string | undefined;
    exists?: (p: string) => boolean;
    /** 让写盘抛错（模拟无权限/磁盘满） */
    failWrite?: boolean;
    /** 让读回为空（模拟写了但读不回来） */
    failRead?: boolean;
}

function fakeDeps(o: FakeOpts = {}): { deps: SenseVoiceDeps; calls: string[][]; removed: string[]; written: Record<string, string> } {
    const calls: string[][] = [];
    const removed: string[] = [];
    const written: Record<string, string> = {};
    const segments = o.segments ?? ['seg_0000.wav', 'seg_0001.wav', 'seg_0002.wav'];
    const files = new Set<string>([
        '/v/movie.mp4',
        '/v/movie.asr.wav',
        '/bin/sherpa.exe',
        '/m/model.int8.onnx',
        '/m/tokens.txt',
        ...segments.map((s) => `/v/movie.sv/${s}`),
    ]);
    const deps: SenseVoiceDeps = {
        run: async (exe, args) => {
            calls.push([exe, ...args]);
            // 抽轨：参数里有 -progress 就是 ffmpeg 那次
            if (args.includes('-progress')) {
                return { code: 0, stderr: o.extractStderr ?? DURATION_LINE };
            }
            // 切段
            return { code: 0, stderr: '' };
        },
        runLines: async (exe, args, onLine) => {
            calls.push([exe, ...args]);
            const wav = args[args.length - 1];
            const name = wav.split('/').pop() ?? '';
            const err = o.spawnErrorFor?.(name);
            if (err) return { code: null, stderr: '', spawnError: err };
            const lines = o.linesFor?.(name) ?? [svLine('hello.', [0.1], ['hello', '.'])];
            for (const l of lines) onLine(l);
            return { code: 0, stderr: '' };
        },
        exists: o.exists ?? ((p) => files.has(p)),
        remove: (p) => {
            removed.push(p);
            files.delete(p);
        },
        // 🔴 m11423：以前没有这两个成员，SRT 只作为返回值字符串存在、从不落盘，
        //    用户看到「转写完成」却在目录里找不到任何文件，面板也扫不到 ⇒「啥都没关联」。
        //    假 deps 必须跟着真接口走，否则这类「忘了写盘」的缺陷单测永远抓不到。
        writeFile: (p, text) => {
            if (o.failWrite) throw new Error('EACCES: permission denied');
            written[p] = text;
            files.add(p);
        },
        readFile: (p) => (o.failRead ? '' : (written[p] ?? '')),
        // 🔴 真机 e2e 抓到的缺陷：cleanup 以前只删目录里的文件，留下 `<名字>.sv` 空目录。
        rmdir: (p) => {
            removed.push(p);
        },
        listDir: (dir) => (dir === '/v/movie.sv' ? [...segments] : []),
        mkdirp: () => undefined,
        join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
        dirname: (p) => p.slice(0, p.lastIndexOf('/')) || '/',
        baseName: (p) => {
            const base = p.slice(p.lastIndexOf('/') + 1);
            const dot = base.lastIndexOf('.');
            return dot > 0 ? base.slice(0, dot) : base;
        },
        platform: 'win32',
    };
    return { deps, calls, removed, written };
}

const BASE = {
    videoPath: '/v/movie.mp4',
    exe: '/bin/sherpa.exe',
    model: '/m/model.int8.onnx',
    tokens: '/m/tokens.txt',
};

describe('services/asrSenseVoice 前置校验（🔴 不再要求 Python / 桥接脚本）', () => {
    it('三件套齐全就开跑，⛔ 全程不出现 python / cli_bridge', async () => {
        const { deps, calls } = fakeDeps();
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        const all = calls.map((c) => c.join(' ')).join('\n');
        expect(all).not.toContain('python');
        expect(all).not.toContain('cli_bridge');
    });

    it('缺识别程序 ⇒ 明确指出缺哪一个', async () => {
        const { deps } = fakeDeps({ exists: () => false });
        const r = await transcribeWithSenseVoice(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('找不到识别程序');
    });

    it('缺模型 / 缺词表各有自己的文案（⛔ 不能笼统说「没找到运行程序」）', async () => {
        const modelMissing = fakeDeps({ exists: (p) => !p.includes('model') });
        const r1 = await transcribeWithSenseVoice(modelMissing.deps, BASE);
        expect(r1.message).toContain('找不到识别模型');

        const tokMissing = fakeDeps({ exists: (p) => !p.includes('tokens') });
        const r2 = await transcribeWithSenseVoice(tokMissing.deps, BASE);
        expect(r2.message).toContain('找不到词表');
    });

    it('空视频路径直接拒绝', async () => {
        const { deps } = fakeDeps();
        const r = await transcribeWithSenseVoice(deps, { ...BASE, videoPath: '' });
        expect(r.ok).toBe(false);
    });

    it('已经取消的令牌 ⇒ 不起任何进程', async () => {
        const { deps, calls } = fakeDeps();
        const cancel = createAsrCancelToken();
        cancel.cancel();
        const r = await transcribeWithSenseVoice(deps, { ...BASE, cancel });
        expect(r.cancelled).toBe(true);
        expect(calls).toHaveLength(0);
    });
});

describe('services/asrSenseVoice 逐段识别与时间轴', () => {
    it('🔴 段偏移按段号 × 段长算（250 秒 ⇒ 3 段，第 3 段从 240s 起）', async () => {
        const { deps, calls } = fakeDeps({
            extractStderr: '  Duration: 00:04:10.00, bitrate: 128 kb/s',
            segments: ['seg_0000.wav', 'seg_0001.wav', 'seg_0002.wav'],
            linesFor: () => [svLine('hello.', [1.0], ['hello', '.'])],
        });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        // 3 段识别 + 1 次抽轨 + 1 次切段
        expect(calls.filter((c) => c.join(' ').includes('--sense-voice-model'))).toHaveLength(3);
        // 第 2 段（seg_0001）的时间戳 1.0 ⇒ 绝对 121.0
        expect(r.srt).toContain('00:02:01,000');
        // 第 3 段（seg_0002）⇒ 241.0
        expect(r.srt).toContain('00:04:01,000');
    });

    it('🔴 每段一个独立进程（sherpa 不流式，一次喂多段会让进度条不动）', async () => {
        const { deps, calls } = fakeDeps({ segments: ['seg_0000.wav', 'seg_0001.wav'] });
        await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        const asrCalls = calls.filter((c) => c.join(' ').includes('--sense-voice-model'));
        expect(asrCalls).toHaveLength(2);
        for (const c of asrCalls) {
            // 每次只带 1 个 wav（⛔ 不是把两段一起喂）
            expect(c.filter((a) => a.endsWith('.wav'))).toHaveLength(1);
        }
    });

    it('🔴 段号不从 0 连续时也不会错位（按文件名里的号算偏移，⛔ 不用循环下标）', async () => {
        const { deps } = fakeDeps({
            extractStderr: '  Duration: 00:04:10.00, bitrate: 128 kb/s',
            segments: ['seg_0000.wav', 'seg_0002.wav'],
            linesFor: () => [svLine('hi.', [0], ['hi.'])],
        });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        // seg_0002 的偏移是 240s，不是「第 2 个文件」的 120s
        expect(r.srt).toContain('00:04:00,000');
    });

    it('一段都没切出来 ⇒ 退回整段 wav（⛔ 不返回空字幕）', async () => {
        const { deps, calls } = fakeDeps({ segments: [] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        const asrCalls = calls.filter((c) => c.join(' ').includes('--sense-voice-model'));
        expect(asrCalls).toHaveLength(1);
        expect(asrCalls[0].join(' ')).toContain('movie.asr.wav');
    });

    it('总长未知 ⇒ 不切段，整段喂（⛔ 不能拿 0 当总长去切）', async () => {
        const { deps, calls } = fakeDeps({ extractStderr: 'no duration here' });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        const asrCalls = calls.filter((c) => c.join(' ').includes('--sense-voice-model'));
        expect(asrCalls).toHaveLength(1);
        expect(asrCalls[0].join(' ')).toContain('movie.asr.wav');
    });

    it('末段的时间轴被夹到总长内（真机：13.82s 被算到 22.079s）', async () => {
        const { deps } = fakeDeps({
            extractStderr: '  Duration: 00:00:13.82, bitrate: 128 kb/s',
            segments: ['seg_0000.wav'],
            linesFor: () => [svLine('long one.', [0.5, 1.0], ['long', ' one.'])],
        });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        const stamps = [...(r.srt ?? '').matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g)];
        for (const m of stamps) {
            const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
            expect(sec).toBeLessThanOrEqual(13.82 + 0.001);
        }
    });
});

describe('services/asrSenseVoice 容错与取消', () => {
    it('🔴 判据是「解析到 JSON」，不是退出码（真机实测成功也返回 0/1 不定）', async () => {
        // runLines 返回 code 非 0，但吐了合法 JSON ⇒ 仍算成功
        const { deps } = fakeDeps({ segments: ['seg_0000.wav'], linesFor: () => [svLine('ok.', [0], ['ok.'])] });
        const orig = deps.runLines;
        deps.runLines = async (exe, args, onLine, cancel) => {
            const r = await orig(exe, args, onLine, cancel);
            return { ...r, code: 1 };
        };
        const res = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(res.ok).toBe(true);
    });

    it('单段没解析出结果 ⇒ 跳过这一段、不拖垮整体', async () => {
        const { deps } = fakeDeps({
            segments: ['seg_0000.wav', 'seg_0001.wav'],
            linesFor: (f) => (f === 'seg_0000.wav' ? [] : [svLine('second.', [0], ['second.'])]),
        });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        expect(r.srt).toContain('second.');
    });

    it('全部段都没结果 ⇒ 报「没识别到内容」而不是空字幕', async () => {
        const { deps } = fakeDeps({ segments: ['seg_0000.wav'], linesFor: () => [] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(false);
        expect(r.message.length).toBeGreaterThan(0);
    });

    it('ENOENT ⇒ 说清楚找不到识别程序', async () => {
        const { deps } = fakeDeps({ segments: ['seg_0000.wav'], spawnErrorFor: () => 'ENOENT' });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(false);
        expect(r.message).toContain('找不到识别程序');
    });

    it('中途取消 ⇒ cancelled 标记（⛔ 不报成失败）', async () => {
        const cancel = createAsrCancelToken();
        const { deps } = fakeDeps({ segments: ['seg_0000.wav', 'seg_0001.wav', 'seg_0002.wav'] });
        const orig = deps.runLines;
        let n = 0;
        deps.runLines = async (exe, args, onLine, c) => {
            n++;
            const r = await orig(exe, args, onLine, c);
            if (n === 1) cancel.cancel();
            return r;
        };
        const res = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120, cancel });
        expect(res.cancelled).toBe(true);
    });

    it('失败也要清掉中间的 wav（⛔ 不能留下几百 MB 垃圾）', async () => {
        const { deps, removed } = fakeDeps({ segments: ['seg_0000.wav'], linesFor: () => [] });
        await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(removed.some((p) => p.endsWith('movie.asr.wav'))).toBe(true);
    });

    it('成功也清掉中间的 wav 与切段文件', async () => {
        const { deps, removed } = fakeDeps({ segments: ['seg_0000.wav'] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        expect(removed.some((p) => p.endsWith('movie.asr.wav'))).toBe(true);
        expect(removed.some((p) => p.endsWith('seg_0000.wav'))).toBe(true);
    });
});

describe('services/asrSenseVoice 字幕落盘（🔴 m11423「啥都没关联」）', () => {
    it('成功时必须真的写到视频同目录的同名 .srt', async () => {
        const { deps, written } = fakeDeps({ segments: ['seg_0000.wav'] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        expect(r.srtPath).toBe('/v/movie.srt');
        // 真写进 fake fs 了，不是只返回字符串
        expect(written['/v/movie.srt']).toBeTruthy();
        expect(written['/v/movie.srt']).toContain('00:00:00,100');
    });

    it('⛔ 不只是返回 srt 字符串 —— 磁盘上必须有字节（这条就是原缺陷的回归守卫）', async () => {
        const { deps, written } = fakeDeps({ segments: ['seg_0000.wav'] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        const onDisk = Object.keys(written);
        expect(onDisk).toHaveLength(1);
        expect(onDisk[0].endsWith('.srt')).toBe(true);
        expect(r.srt).toBe(written[onDisk[0]]);
    });

    it('写盘失败 ⇒ 报错，⛔ 不能假装成功（没文件的成功等于失败）', async () => {
        const { deps } = fakeDeps({ segments: ['seg_0000.wav'], failWrite: true });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(false);
        expect(r.message).toContain('写盘');
    });

    it('写了但读不回来（权限/磁盘满）⇒ 也算失败', async () => {
        const { deps } = fakeDeps({ segments: ['seg_0000.wav'], failRead: true });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(false);
        expect(r.message.length).toBeGreaterThan(0);
    });

    it('写盘失败时不清中间产物（留着还有重试余地）', async () => {
        const { deps, removed } = fakeDeps({ segments: ['seg_0000.wav'], failWrite: true });
        await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(removed).toHaveLength(0);
    });

    it('成功时必须把切段目录本身也删掉（⛔ 只删文件会留一个空目录）', async () => {
        const { deps, removed } = fakeDeps({ segments: ['seg_0000.wav'] });
        const r = await transcribeWithSenseVoice(deps, { ...BASE, segmentSec: 120 });
        expect(r.ok).toBe(true);
        // 目录本身必须出现在删除清单里（真机 e2e 抓到过只删文件的版本）
        expect(removed).toContain('/v/movie.sv');
    });
});

describe('services/asrSenseVoice 进度与句级细节', () => {
    it('进度单调不减，最后到 100', async () => {
        const seen: number[] = [];
        const { deps } = fakeDeps({ segments: ['seg_0000.wav', 'seg_0001.wav', 'seg_0002.wav'] });
        await transcribeWithSenseVoice(deps, {
            ...BASE,
            segmentSec: 120,
            onProgress: (p) => {
                if (p !== null) seen.push(p);
            },
        });
        for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen[seen.length - 1]).toBe(100);
    });

    it('🔴 识别阶段带上「到哪个时间段」的细节（用户 m09995）', async () => {
        const details: string[] = [];
        const { deps } = fakeDeps({ segments: ['seg_0000.wav', 'seg_0001.wav'] });
        await transcribeWithSenseVoice(deps, {
            ...BASE,
            segmentSec: 120,
            onProgress: (_p, _l, d) => {
                if (d) details.push(d);
            },
        });
        expect(details.length).toBeGreaterThan(0);
        expect(details.some((d) => d.includes('→'))).toBe(true);
    });

    it('进度上限不超过 99（真 100 留给「读到产物之后」）', async () => {
        const seen: number[] = [];
        const { deps } = fakeDeps({ segments: ['seg_0000.wav', 'seg_0001.wav', 'seg_0002.wav'] });
        await transcribeWithSenseVoice(deps, {
            ...BASE,
            segmentSec: 120,
            onProgress: (p) => {
                if (p !== null) seen.push(p);
            },
        });
        // 除最后那条 100 之外，识别阶段的都不该到 100
        const beforeDone = seen.slice(0, -1);
        for (const p of beforeDone) expect(p).toBeLessThanOrEqual(99);
    });

    /**
     * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
     *
     * SenseVoice 每段本就解析出了完整 `entries`，旧实现只 push 进 `allEntries`，
     * 视图层看不到任何句子 ⇒ 转写期间只能盯着进度条。
     */
    it('每段的句子逐条回吐，跨段也都要给（不是只给第一段）', async () => {
        const lines: { start: number; end: number; text: string }[] = [];
        const { deps } = fakeDeps({
            segments: ['seg_0000.wav', 'seg_0001.wav'],
            // 每段各出一句：第 2 段的句子起点必须落在段偏移之后，
            // 🔴 这正是当初 `tokenWords` 的 limit 写成 duration 时整段丢词的地方。
            linesFor: (name) => (name.startsWith('seg_0001')
                ? [svLine('second one.', [0.2], ['second', ' one', '.'])]
                : [svLine('first one.', [0.2], ['first', ' one', '.'])]),
        });
        await transcribeWithSenseVoice(deps, {
            ...BASE,
            segmentSec: 120,
            onProgress: (_p, _l, _d, line) => {
                if (line) lines.push(line);
            },
        });
        expect(lines.length).toBeGreaterThanOrEqual(2);
        // 第二段的句子时间轴必须 ≥ 120s（段偏移生效），而不是又回到 0
        const second = lines.find((l) => l.text.includes('second'));
        expect(second).toBeDefined();
        expect(second!.start).toBeGreaterThanOrEqual(120);
    });

    it('同一段多句都交出（段内不合并成一句）', async () => {
        const lines: { text: string }[] = [];
        const { deps } = fakeDeps({
            segments: ['seg_0000.wav'],
            // ⚠️ `stamps` 必须与 `tokens` **等长**：少给会让 `tokenWords` 按 min() 截断，
            //    只剩第一个词 ⇒ 看着像「段内没断句」，其实是夹具自己没喂够（踩过）。
            linesFor: () => [svLine(
                'one. two. three.',
                [0.1, 0.5, 1.0, 1.4, 1.9, 2.3],
                ['one', '.', ' two', '.', ' three', '.'],
            )],
        });
        await transcribeWithSenseVoice(deps, {
            ...BASE,
            segmentSec: 120,
            onProgress: (_p, _l, _d, line) => {
                if (line) lines.push(line);
            },
        });
        // 标点断句 ⇒ 句子被拆开逐条交出
        expect(lines.length).toBeGreaterThan(1);
    });
});
