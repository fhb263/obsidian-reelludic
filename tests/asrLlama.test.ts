import { describe, it, expect } from 'vitest';

import { createAsrCancelToken } from '../src/services/asr';
import { transcribeWithLlama, type LlamaDeps } from '../src/services/asrLlama';

/**
 * 真机 stdout（13.816 秒音频）—— llama-mtmd-cli 只打这一行。
 * ⚠️ 退出码不可信（实测成功也可能非 0），判据只能是「有没有 `<asr_text>`」。
 */
const REAL_STDOUT =
    'language English<asr_text>Good morning. This is a test of the local speech recognition. We are checking whether the transcript and the timestamps line up correctly. Thank you for your patience.';

const DURATION_LINE = '  Duration: 00:00:13.82, start: 0.000000, bitrate: 128 kb/s';

interface FakeOpts {
    stdout?: string;
    stderr?: string;
    /** 识别那次 run 返回的退出码（默认 1 —— 真机成功也返回非 0） */
    code?: number | null;
    spawnError?: string;
    cancelled?: boolean;
    exists?: (p: string) => boolean;
    failWrite?: boolean;
    failRead?: boolean;
}

function fakeDeps(o: FakeOpts = {}): { deps: LlamaDeps; calls: string[][]; removed: string[] } {
    const calls: string[][] = [];
    const removed: string[] = [];
    const written: Record<string, string> = {};
    const files = new Set<string>([
        '/v/movie.mp4',
        '/m/llama-mtmd-cli.exe',
        '/m/Confucius4-R2T2-Q4_K_M.gguf',
        '/m/mmproj-Confucius4-R2T2-Q8_0.gguf',
    ]);
    const deps: LlamaDeps = {
        run: async (exe, args) => {
            calls.push([exe, ...args]);
            if (args.includes('-progress')) return { code: 0, stdout: '', stderr: DURATION_LINE };
            if (o.cancelled) return { code: null, stdout: '', stderr: '', cancelled: true };
            if (o.spawnError) return { code: null, stdout: '', stderr: '', spawnError: o.spawnError };
            return { code: o.code ?? 1, stdout: o.stdout ?? REAL_STDOUT, stderr: o.stderr ?? '' };
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

const BASE = {
    videoPath: '/v/movie.mp4',
    exe: '/m/llama-mtmd-cli.exe',
    model: '/m/Confucius4-R2T2-Q4_K_M.gguf',
    mmproj: '/m/mmproj-Confucius4-R2T2-Q8_0.gguf',
};

describe('前置校验', () => {
    it('缺视频 / 缺 exe / 缺模型 / 缺投影器各有明确文案', async () => {
        const { deps } = fakeDeps();
        expect((await transcribeWithLlama(deps, { ...BASE, videoPath: '' })).message).toContain('缺少视频路径');
        expect((await transcribeWithLlama(deps, { ...BASE, exe: '' })).message).toContain('llama-mtmd-cli');
        expect((await transcribeWithLlama(deps, { ...BASE, model: '' })).message).toContain('找不到语言模型');
        expect((await transcribeWithLlama(deps, { ...BASE, mmproj: '' })).message).toContain('找不到投影模型');
    });

    it('⛔ 投影器是必填（少了 exe 直接拒绝运行）', async () => {
        const f = fakeDeps({ exists: (p) => !p.includes('mmproj') });
        const r = await transcribeWithLlama(f.deps, BASE);
        expect(r.ok).toBe(false);
        expect(f.calls.filter((c) => c[0] === '/m/llama-mtmd-cli.exe')).toHaveLength(0);
    });
});

describe('成功路径', () => {
    it('一句正文也能生成字幕（Confucius4 没有时间戳，靠比例反推）', async () => {
        const { deps } = fakeDeps();
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(true);
        expect(r.srt).toContain('Good morning');
        expect(r.srtPath).toBe('/v/movie.srt');
    });

    it('⛔ 退出码是 1 也照样成功（真机就这样）', async () => {
        const { deps } = fakeDeps({ code: 1 });
        expect((await transcribeWithLlama(deps, BASE)).ok).toBe(true);
    });

    it('⛔ 退出码是 0 但没 <asr_text> ⇒ 仍然失败', async () => {
        const { deps } = fakeDeps({ code: 0, stdout: 'loading model …' });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
    });

    it('命令行带 -m / --mmproj / --audio / --no-mmproj-offload', async () => {
        const { deps, calls } = fakeDeps();
        await transcribeWithLlama(deps, BASE);
        const call = calls.find((c) => c[0] === '/m/llama-mtmd-cli.exe');
        expect(call).toContain('-m');
        expect(call).toContain('/m/Confucius4-R2T2-Q4_K_M.gguf');
        expect(call).toContain('--mmproj');
        expect(call).toContain('/m/mmproj-Confucius4-R2T2-Q8_0.gguf');
        expect(call).toContain('--audio');
        expect(call).toContain('/v/movie.asr.wav');
        expect(call).toContain('--no-mmproj-offload');
    });

    it('中间 wav 会被清掉', async () => {
        const { deps, removed } = fakeDeps();
        await transcribeWithLlama(deps, BASE);
        expect(removed).toContain('/v/movie.asr.wav');
    });

    it('中文正文也能出字幕', async () => {
        const { deps } = fakeDeps({ stdout: 'language Chinese<asr_text>早上好，这是一个测试。' });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(true);
        expect(r.srt).toContain('早上好');
    });
});

describe('失败路径', () => {
    it('没有 <asr_text> 且 stderr 有内容 ⇒ 带上 stderr 尾行', async () => {
        const { deps } = fakeDeps({ stdout: '', stderr: 'error: failed to load model' });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('failed to load model');
    });

    it('⛔ 没有 <asr_text> 且 stderr 全空 ⇒ 提示可能是缺 dll（真机踩过的静默失败）', async () => {
        const { deps } = fakeDeps({ stdout: '', stderr: '' });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('dll');
    });

    it('起进程 ENOENT ⇒ 明确说找不到程序', async () => {
        const { deps } = fakeDeps({ spawnError: 'ENOENT' });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('找不到识别程序');
    });

    it('抽轨失败 ⇒ 报 ffmpeg 最后一行错误', async () => {
        const deps = fakeDeps().deps;
        deps.run = async (exe, args) => {
            if (args.includes('-progress')) return { code: 1, stdout: '', stderr: 'movie.mp4: Invalid data found' };
            return { code: 1, stdout: REAL_STDOUT, stderr: '' };
        };
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('Invalid data found');
    });

    it('写盘抛错 ⇒ 失败且如实报错', async () => {
        const { deps } = fakeDeps({ failWrite: true });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('字幕写盘失败');
    });

    it('⛔ 写了但读不回来同样算失败', async () => {
        const { deps } = fakeDeps({ failRead: true });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('没有成功写入');
    });
});

describe('取消', () => {
    it('进来就已取消 ⇒ 不起任何进程', async () => {
        const { deps, calls } = fakeDeps();
        const cancel = createAsrCancelToken();
        cancel.cancel();
        const r = await transcribeWithLlama(deps, { ...BASE, cancel });
        expect(r.cancelled).toBe(true);
        expect(calls).toHaveLength(0);
    });

    it('推理中途取消 ⇒ cancelled 且清掉中间文件', async () => {
        const { deps, removed } = fakeDeps({ cancelled: true });
        const r = await transcribeWithLlama(deps, BASE);
        expect(r.cancelled).toBe(true);
        expect(removed).toContain('/v/movie.asr.wav');
    });
});

describe('进度', () => {
    it('结束时 100%', async () => {
        const { deps } = fakeDeps();
        const pcts: (number | null)[] = [];
        await transcribeWithLlama(deps, { ...BASE, onProgress: (p) => pcts.push(p) });
        expect(pcts[pcts.length - 1]).toBe(100);
    });

    it('抽轨阶段先动起来（大模型推理慢，不能一直 0）', async () => {
        const { deps } = fakeDeps();
        const early: number[] = [];
        await transcribeWithLlama(deps, {
            ...BASE,
            onProgress: (p) => {
                if (typeof p === 'number') early.push(p);
            },
        });
        expect(early[0]).toBe(12);
    });
});
