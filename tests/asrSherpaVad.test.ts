import { describe, it, expect } from 'vitest';

import { createAsrCancelToken } from '../src/services/asr';
import { transcribeWithSherpaVad, type SherpaVadDeps } from '../src/services/asrSherpaVad';

/**
 * 真机输出（13.816 秒音频，四段）—— 抄自 `sherpa-onnx-vad-with-{offline,online}-asr.exe`。
 * ⚠️ 两个 exe 都把结果打在 stderr；offline 版识别成功也返回 **1**。
 */
const OFFLINE_LINES = [
    '0.134 -- 0.940:  good morning',
    '1.766 -- 4.876:  this is a test of the local speech recognition',
    '5.702 -- 10.796:  we are checking whether the transcript and the time stamps lineup correctly',
    '11.494 -- 13.100:  thank you for your patients',
    'Elapsed seconds: 1.161 s',
    'Real time factor (RTF): 1.161 / 13.816 = 0.084',
];

const ONLINE_LINES = [
    'vad segment(1:0.134-0.940) results:  Good morning .',
    'vad segment(2:1.766-4.876) results:  This is a test of the local speech recognition',
    'vad segment(3:5.702-10.796) results:  We are checking whether the transcript and the timestamps line up correctly',
    'vad segment(4:11.494-13.100) results:  Thank you for your patience',
    'Elapsed seconds: 2.245 s',
    'Real time factor (RTF): 2.245 / 13.816 = 0.162',
];

const DURATION_LINE = '  Duration: 00:00:13.82, start: 0.000000, bitrate: 128 kb/s';

interface FakeOpts {
    lines?: string[];
    /** runLines 返回的退出码（默认 0；offline 版真机是 1） */
    code?: number | null;
    stderr?: string;
    spawnError?: string;
    cancelled?: boolean;
    exists?: (p: string) => boolean;
    failWrite?: boolean;
    failRead?: boolean;
}

function fakeDeps(o: FakeOpts = {}): { deps: SherpaVadDeps; calls: string[][]; removed: string[] } {
    const calls: string[][] = [];
    const removed: string[] = [];
    const written: Record<string, string> = {};
    const files = new Set<string>([
        '/v/movie.mp4',
        '/bin/vad-offline.exe',
        '/bin/vad-online.exe',
        '/m/tokens.txt',
        '/m/model.int8.onnx',
        '/m/silero_vad.onnx',
        '/m/encoder-1920ms.onnx',
        '/m/decoder-1920ms.onnx',
        '/m/joiner-1920ms.onnx',
    ]);
    const deps: SherpaVadDeps = {
        run: async (exe, args) => {
            calls.push([exe, ...args]);
            if (args.includes('-progress')) return { code: 0, stderr: DURATION_LINE };
            return { code: 0, stderr: '' };
        },
        runLines: async (exe, args, onLine) => {
            calls.push([exe, ...args]);
            if (o.cancelled) return { code: null, stderr: '', cancelled: true };
            if (o.spawnError) return { code: null, stderr: '', spawnError: o.spawnError };
            for (const l of o.lines ?? OFFLINE_LINES) onLine(l);
            return { code: o.code ?? 0, stderr: o.stderr ?? '' };
        },
        exists: o.exists ?? ((p) => files.has(p)),
        remove: (p) => {
            removed.push(p);
            files.delete(p);
        },
        writeFile: (p, text) => {
            if (o.failWrite) throw new Error('EACCES: permission denied');
            written[p] = text;
            files.add(p);
        },
        readFile: (p) => (o.failRead ? '' : (written[p] ?? '')),
        rmdir: (p) => {
            removed.push(p);
        },
        listDir: () => [],
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
    return { deps, calls, removed };
}

const PARA = {
    videoPath: '/v/movie.mp4',
    mode: 'paraformer' as const,
    exe: '/bin/vad-offline.exe',
    tokens: '/m/tokens.txt',
    vadModel: '/m/silero_vad.onnx',
    paraformer: '/m/model.int8.onnx',
};

const XASR = {
    videoPath: '/v/movie.mp4',
    mode: 'xasr' as const,
    exe: '/bin/vad-online.exe',
    tokens: '/m/tokens.txt',
    vadModel: '/m/silero_vad.onnx',
    encoder: '/m/encoder-1920ms.onnx',
    decoder: '/m/decoder-1920ms.onnx',
    joiner: '/m/joiner-1920ms.onnx',
};

describe('前置校验', () => {
    it('缺视频路径 / 缺 exe 各有明确文案', async () => {
        const { deps } = fakeDeps();
        expect((await transcribeWithSherpaVad(deps, { ...PARA, videoPath: ' ' })).message).toContain('缺少视频路径');
        expect((await transcribeWithSherpaVad(deps, { ...PARA, exe: '' })).message).toContain('sherpa-onnx-vad-with-offline-asr');
        expect((await transcribeWithSherpaVad(deps, { ...XASR, exe: '' })).message).toContain('sherpa-onnx-vad-with-online-asr');
    });

    it('缺 tokens / 缺 vad 模型各有自己的文案', async () => {
        const noTok = fakeDeps({ exists: (p) => !p.includes('tokens') });
        expect((await transcribeWithSherpaVad(noTok.deps, PARA)).message).toContain('找不到词表文件');

        const noVad = fakeDeps({ exists: (p) => !p.includes('silero') });
        expect((await transcribeWithSherpaVad(noVad.deps, PARA)).message).toContain('找不到 VAD 模型');
    });

    it('⛔ 缺任一 X-ASR 权重就别起进程（sherpa 会打 92 行 usage 后静默退出）', async () => {
        for (const [missing, label] of [
            ['encoder', '编码器'],
            ['decoder', '解码器'],
            ['joiner', '连接器'],
        ] as const) {
            const f = fakeDeps({ exists: (p) => !p.includes(missing) });
            const r = await transcribeWithSherpaVad(f.deps, XASR);
            expect(r.ok).toBe(false);
            expect(r.message).toContain(label);
            // 只跑了抽轨那次，没起识别进程
            expect(f.calls.filter((c) => c[0] === '/bin/vad-online.exe')).toHaveLength(0);
        }
    });

    it('⛔ Paraformer 缺模型时不要求 encoder/decoder/joiner', async () => {
        const f = fakeDeps({ exists: (p) => !p.includes('model.int8') });
        expect((await transcribeWithSherpaVad(f.deps, PARA)).message).toContain('找不到 Paraformer 模型');
    });
});

describe('Paraformer 模式（offline 版 exe）', () => {
    it('四段全部变成字幕条目', async () => {
        const { deps } = fakeDeps();
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(true);
        expect(r.srt).toContain('good morning');
        expect(r.srt).toContain('thank you for your patients');
        expect(r.srtPath).toBe('/v/movie.srt');
    });

    it('⛔ 退出码是 1 也照样成功（真机 offline 版就是这样）', async () => {
        const { deps } = fakeDeps({ code: 1 });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(true);
    });

    it('参数用等号形式 + 带 silero vad + wav 在最后', async () => {
        const { deps, calls } = fakeDeps();
        await transcribeWithSherpaVad(deps, PARA);
        const call = calls.find((c) => c[0] === '/bin/vad-offline.exe');
        expect(call).toBeDefined();
        expect(call).toContain('--tokens=/m/tokens.txt');
        expect(call).toContain('--paraformer=/m/model.int8.onnx');
        expect(call).toContain('--silero-vad-model=/m/silero_vad.onnx');
        expect(call?.[call.length - 1]).toBe('/v/movie.asr.wav');
    });

    it('⛔ 不预先切段（VAD 自己按语音边界切，再切会切断句子）', async () => {
        const { deps, calls } = fakeDeps();
        await transcribeWithSherpaVad(deps, PARA);
        const all = calls.map((c) => c.join(' ')).join('\n');
        expect(all).not.toContain('-f segment');
        expect(all).not.toContain('seg_');
    });

    it('中间 wav 会被清掉，不留脏文件', async () => {
        const { deps, removed } = fakeDeps();
        await transcribeWithSherpaVad(deps, PARA);
        expect(removed).toContain('/v/movie.asr.wav');
    });
});

describe('X-ASR 模式（online 版 exe）', () => {
    it('四段全部变成字幕条目', async () => {
        const { deps } = fakeDeps({ lines: ONLINE_LINES });
        const r = await transcribeWithSherpaVad(deps, XASR);
        expect(r.ok).toBe(true);
        expect(r.srt).toContain('Good morning.');
        expect(r.srt).toContain('Thank you for your patience');
    });

    it('三个 ONNX 都拼进命令行', async () => {
        const { deps, calls } = fakeDeps({ lines: ONLINE_LINES });
        await transcribeWithSherpaVad(deps, XASR);
        const call = calls.find((c) => c[0] === '/bin/vad-online.exe');
        expect(call).toContain('--encoder=/m/encoder-1920ms.onnx');
        expect(call).toContain('--decoder=/m/decoder-1920ms.onnx');
        expect(call).toContain('--joiner=/m/joiner-1920ms.onnx');
    });

    it('⛔ 绝不出现 --paraformer（online 版实测报 Invalid option）', async () => {
        const { deps, calls } = fakeDeps({ lines: ONLINE_LINES });
        await transcribeWithSherpaVad(deps, XASR);
        const call = calls.find((c) => c[0] === '/bin/vad-online.exe') ?? [];
        expect(call.some((a) => a.startsWith('--paraformer'))).toBe(false);
    });

    it('⛔ 最后一段要 flush（没有下一个段头触发收口）', async () => {
        const { deps } = fakeDeps({ lines: ONLINE_LINES });
        const r = await transcribeWithSherpaVad(deps, XASR);
        expect(r.srt).toContain('Thank you for your patience');
    });

    it('⛔ 收尾日志不进字幕', async () => {
        const { deps } = fakeDeps({ lines: ONLINE_LINES });
        const r = await transcribeWithSherpaVad(deps, XASR);
        expect(r.srt).not.toContain('Real time factor');
        expect(r.srt).not.toContain('Elapsed seconds');
    });
});

describe('失败路径', () => {
    it('一段都没解析到 ⇒ 失败（⛔ 不是看退出码）', async () => {
        const { deps } = fakeDeps({ lines: ['loading model …', 'Elapsed seconds: 1.0 s'] });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('没有解析到任何语音段');
    });

    it('起进程 ENOENT ⇒ 明确说找不到程序', async () => {
        const { deps } = fakeDeps({ spawnError: 'ENOENT' });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('找不到识别程序');
    });

    it('抽轨失败 ⇒ 报 ffmpeg 的最后一行错误', async () => {
        const deps = fakeDeps().deps;
        deps.run = async (exe, args) => {
            if (args.includes('-progress')) return { code: 1, stderr: 'movie.mp4: Invalid data found' };
            return { code: 0, stderr: '' };
        };
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('Invalid data found');
    });

    it('写盘抛错 ⇒ 失败且如实报错', async () => {
        const { deps } = fakeDeps({ failWrite: true });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('字幕写盘失败');
    });

    it('⛔ 写了但读不回来（权限/磁盘满）同样算失败', async () => {
        const { deps } = fakeDeps({ failRead: true });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('没有成功写入');
    });
});

describe('取消', () => {
    it('进来就已取消 ⇒ 直接返回 cancelled', async () => {
        const { deps, calls } = fakeDeps();
        // `cancelled` 是只读 getter，必须靠 cancel() 触发（⛔ 不能直接赋值）
        const cancel = createAsrCancelToken();
        cancel.cancel();
        const r = await transcribeWithSherpaVad(deps, { ...PARA, cancel });
        expect(r.cancelled).toBe(true);
        // 一个进程都不该起
        expect(calls).toHaveLength(0);
    });

    it('识别中途取消 ⇒ cancelled 且清掉中间文件', async () => {
        const { deps, removed } = fakeDeps({ cancelled: true });
        const r = await transcribeWithSherpaVad(deps, PARA);
        expect(r.cancelled).toBe(true);
        expect(removed).toContain('/v/movie.asr.wav');
    });
});

describe('进度与实时句', () => {
    it('识别阶段会逐句送出（第 4 参是单句，与 whisper / SenseVoice 同口径）', async () => {
        const { deps } = fakeDeps();
        const seen: { start: number; end: number; text: string }[] = [];
        await transcribeWithSherpaVad(deps, {
            ...PARA,
            onProgress: (_p, _l, _d, line) => {
                if (line) seen.push(line);
            },
        });
        expect(seen.length).toBe(4);
        expect(seen[0].text).toBe('good morning');
    });

    it('结束时 100%', async () => {
        const { deps } = fakeDeps();
        const pcts: (number | null)[] = [];
        await transcribeWithSherpaVad(deps, { ...PARA, onProgress: (p) => pcts.push(p) });
        expect(pcts[pcts.length - 1]).toBe(100);
    });

    it('进度单调不减且不超过 99（100 留给完成）', async () => {
        const { deps } = fakeDeps();
        const pcts: number[] = [];
        await transcribeWithSherpaVad(deps, {
            ...PARA,
            onProgress: (p) => {
                if (typeof p === 'number') pcts.push(p);
            },
        });
        for (let i = 1; i < pcts.length; i++) expect(pcts[i]).toBeGreaterThanOrEqual(pcts[i - 1]);
        expect(Math.max(...pcts)).toBeLessThanOrEqual(100);
    });
});
