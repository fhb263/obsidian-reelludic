import { describe, expect, it, vi } from 'vitest';
import { createAsrCancelToken } from 'services/asr';
import { defaultQwenDeps, transcribeWithQwen, usesPythonBridge, type QwenBridgeDeps, type QwenChild } from 'services/asrQwen';

/** 假子进程：手动喂 stdout/stderr，再手动 close。 */
function makeChild() {
    const outCbs: Array<(c: unknown) => void> = [];
    const errCbs: Array<(c: unknown) => void> = [];
    let onError: ((e: { code?: string; message?: string }) => void) | null = null;
    let onClose: ((code: number | null) => void) | null = null;
    const child: QwenChild = {
        stdout: { on: (_e, cb) => outCbs.push(cb) },
        stderr: { on: (_e, cb) => errCbs.push(cb) },
        on: (event: string, cb: never) => {
            if (event === 'error') onError = cb;
            else onClose = cb;
        },
    } as QwenChild;
    return {
        child,
        /** 传 string 按 utf8 编码；传 Buffer 原样喂（用于构造「多字节被切开」的真场景） */
        pushOut: (s: string | Buffer) =>
            outCbs.forEach((cb) => cb(typeof s === 'string' ? Buffer.from(s, 'utf8') : s)),
        pushErr: (s: string | Buffer) =>
            errCbs.forEach((cb) => cb(typeof s === 'string' ? Buffer.from(s, 'utf8') : s)),
        fail: (code: string) => onError?.({ code }),
        close: (code: number | null) => onClose?.(code),
    };
}

function makeDeps(child: QwenChild, files: Record<string, string> = {}): QwenBridgeDeps {
    const store: Record<string, string> = { 'C:/py/python.exe': '', 'C:/q/bridge.py': '', ...files };
    return {
        spawn: () => child,
        exists: (p) => p in store,
        readText: (p) => {
            if (!(p in store)) throw new Error('ENOENT');
            return store[p];
        },
        platform: 'win32',
    };
}

const BASE = {
    input: 'C:/v/a.mp4',
    out: 'C:/v/a.srt',
    python: 'C:/py/python.exe',
    script: 'C:/q/bridge.py',
};

describe('usesPythonBridge', () => {
    it('只有 whisper 走插件内建，另两家走 Python 桥接', () => {
        expect(usesPythonBridge('whisper')).toBe(false);        expect(usesPythonBridge('qwen3')).toBe(true);
        expect(usesPythonBridge('sensevoice')).toBe(true);
    });
});

describe('transcribeWithQwen 前置校验', () => {
    it('没配解释器或脚本 → 引导去设置，且不起进程', async () => {
        const spawn = vi.fn();
        const deps: QwenBridgeDeps = { spawn, exists: () => true, readText: () => '', platform: 'win32' };
        // ⚠️ 2026-11-07：断言从「含『音频转文字』」改成「含新入口『语音服务』」。
        //    `音频转文字` 是**已退场**的组名，旧文案靠这个词能过，但那句话指的是一个用户点不到的地方。
        // 🔴 2026-11-10（用户 m03321）：「语音服务」这个中间层**也已退场** —— 它被拆成两个平级组，
        //    STT 那组自己就叫「语音转文字」。⇒ 断言改成含**新组名**，⛔ 别再钉「语音服务」：
        //    那个词已经不再对应任何一个用户点得到的入口。
        //    逐级校验（页签在 TAB 表、分组在图标表）仍见 `tests/asrEngines.test.ts`。
        const r1 = await transcribeWithQwen(deps, { input: 'a', out: 'b' });
        expect(r1.ok).toBe(false);
        expect(r1.message).toContain('语音转文字');
        const r2 = await transcribeWithQwen(deps, { input: 'a', out: 'b', python: 'p.exe' });
        expect(r2.ok).toBe(false);
        expect(r2.message).toContain('语音转文字');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('解释器/脚本文件不存在 → 明确指出是哪一个', async () => {
        const deps: QwenBridgeDeps = { spawn: vi.fn(), exists: () => false, readText: () => '', platform: 'win32' };
        expect((await transcribeWithQwen(deps, BASE)).message).toContain('Python 解释器');
        expect(
            (await transcribeWithQwen(deps, { ...BASE, python: 'x' }, )).message,
        ).toBeTruthy();
    });
});

describe('transcribeWithQwen 正常流程', () => {
    it('PROGRESS → DONE → RESULT 全走通，返回 srt 正文', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/a.srt': '1\n00:00:00,000 --> 00:00:01,000\nhi\n' });
        const seen: Array<[number | null, string]> = [];
        const p = transcribeWithQwen(deps, { ...BASE, onProgress: (n, l) => seen.push([n, l]) });
        f.pushOut('音频时长: 13.82 秒\n');
        f.pushOut('PROGRESS 35 正在识别 1/1 段\n');
        f.pushOut('PROGRESS 78 正在对齐时间轴…\n');
        f.pushOut('DONE C:/v/a.srt\n');
        f.pushOut('RESULT {"ok":true,"srtPath":"C:/v/a.srt","entries":3,"durationSec":13.82}\n');
        f.close(0);
        const r = await p;

        expect(r.ok).toBe(true);
        expect(r.srt).toContain('hi');
        expect(r.srtPath).toBe('C:/v/a.srt');
        expect(r.entries).toBe(3);
        // 第一条是「正在准备…」，之后是脚本自报的进度
        expect(seen[0][1]).toContain('准备');
        expect(seen.some(([n]) => n === 35)).toBe(true);
        expect(seen.some(([n]) => n === 78)).toBe(true);
        expect(seen[seen.length - 1][0]).toBe(100);
    });

    it('上游库的噪声日志不会污染进度，也不会被当错误', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/a.srt': 'x' });
        const seen: Array<[number | null, string]> = [];
        const p = transcribeWithQwen(deps, { ...BASE, onProgress: (n, l) => seen.push([n, l]) });
        f.pushOut('使用设备: cuda:0\r\n');
        f.pushOut('正在加载识别模型: D:\\Qwen\\Qwen3-ASR-0.6B\n');
        f.pushOut('[align] 失败: 词数=0\n');
        f.pushOut('PROGRESS 100 完成\n');
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(seen.filter(([n]) => n === null).length).toBe(1); // 只有最初那条「准备」
    });
});

describe('transcribeWithQwen 失败路径', () => {
    it('脚本报 ERROR ⇒ 原样透出人话，不回 traceback', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child);
        const p = transcribeWithQwen(deps, BASE);
        f.pushOut('ERROR 识别结果为空（这段音轨可能没有人声）\n');
        f.close(2);
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('识别结果为空');
        expect(r.message).not.toContain('Traceback');
    });

    it('非 0 退出且没有 ERROR 行 ⇒ 取 stderr 最后一行', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child);
        const p = transcribeWithQwen(deps, BASE);
        f.pushErr('some noise\nCUDA out of memory\n');
        f.close(9);
        expect((await p).message).toContain('CUDA out of memory');
    });

    it('非 0 退出且 stderr 为空 ⇒ 报退出码，不说成功', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child);
        const p = transcribeWithQwen(deps, BASE);
        f.close(7);
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('7');
    });

    it('spawn ENOENT ⇒ 指出找不到 Python 解释器', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child);
        const p = transcribeWithQwen(deps, BASE);
        f.fail('ENOENT');
        expect((await p).message).toContain('Python 解释器');
    });

    it('退出码 0 但没产物 ⇒ 显式报错（⛔ 不假装成功）', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child); // 没有 C:/v/a.srt
        const p = transcribeWithQwen(deps, BASE);
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('没有生成字幕文件');
    });

    it('产物是空文件 ⇒ 报「可能是没有人声」', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/a.srt': '   \n' });
        const p = transcribeWithQwen(deps, BASE);
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('空的');
    });

    it('读文件抛错 ⇒ 包成可读文案', async () => {
        const f = makeChild();
        const deps: QwenBridgeDeps = {
            spawn: () => f.child,
            exists: () => true,
            readText: () => {
                throw new Error('EACCES');
            },
            platform: 'win32',
        };
        const p = transcribeWithQwen(deps, BASE);
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('读取生成的字幕失败');
    });
});

describe('transcribeWithQwen 流式解码', () => {
    it('协议行被 chunk 从中间切断时仍能解析（残行留到下一次）', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/a.srt': 'ok' });
        const p = transcribeWithQwen(deps, BASE);
        // 把一个 PROGRESS 行拆成三段喂进去
        f.pushOut('PROG');
        f.pushOut('RESS 50 正在识');
        f.pushOut('别\n');
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(true);
    });

    it('🔴 多字节中文被从字节中间切开时不产生乱码', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/a.srt': 'ok' });
        const seen: Array<[number | null, string]> = [];
        const p = transcribeWithQwen(deps, { ...BASE, onProgress: (n, l) => seen.push([n, l]) });

        // 「正在识别」的「正」= E6 AD A3；切成 E6 | AD A3，逐 chunk 解码会出 U+FFFD
        const whole = Buffer.from('PROGRESS 60 正在识别\n', 'utf8');
        const cut = 12; // 落在「正」的第一字节之后
        expect(whole.subarray(cut, cut + 1).length).toBe(1);
        f.pushOut(whole.subarray(0, cut));
        f.pushOut(whole.subarray(cut));
        f.close(0);
        await p;

        const hit = seen.find(([n]) => n === 60);
        expect(hit).toBeTruthy();
        expect(hit?.[1]).toBe('正在识别');
        expect(hit?.[1]).not.toContain('\uFFFD');
    });

    it('最后一条 DONE 没有换行结尾时也要被处理（收尾 flush）', async () => {
        const f = makeChild();
        const deps = makeDeps(f.child, { 'C:/v/last.srt': 'ok' });
        const p = transcribeWithQwen(deps, BASE);
        f.pushOut('DONE C:/v/last.srt'); // ⛔ 故意不给 \n
        f.close(0);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(r.srtPath).toBe('C:/v/last.srt');
    });
});

describe('defaultQwenDeps', () => {
    it('真实现能拿到 spawn/exists/readText 三件', () => {
        const d = defaultQwenDeps();
        expect(typeof d.spawn).toBe('function');
        expect(typeof d.exists).toBe('function');
        expect(typeof d.readText).toBe('function');
        expect(d.exists('这是一个绝对不存在的路径/xxx')).toBe(false);
    });
});

describe('transcribeWithQwen 极速版（SenseVoice）', () => {
    const SV = {
        ...BASE,
        engine: 'sensevoice' as const,
        sherpaExe: 'C:/sv/sherpa-onnx-offline.exe',
        senseVoiceModel: 'C:/sv/model.int8.onnx',
        senseVoiceTokens: 'C:/sv/tokens.txt',
    };
    const SV_FILES = {
        'C:/sv/sherpa-onnx-offline.exe': '',
        'C:/sv/model.int8.onnx': '',
        'C:/sv/tokens.txt': '',
    };

    it('三件套缺一 ⇒ 前置就拦住，⛔ 不起进程', async () => {
        const c = makeChild();
        let spawned = 0;
        const deps: QwenBridgeDeps = {
            ...makeDeps(c.child),
            spawn: () => {
                spawned += 1;
                return c.child;
            },
        };
        const r = await transcribeWithQwen(deps, { ...BASE, engine: 'sensevoice' });
        expect(r.ok).toBe(false);
        expect(r.message).toContain('极速版');
        expect(spawned).toBe(0);
    });

    it('路径填了但文件不存在 ⇒ 分别指出是哪一个', async () => {
        const deps = makeDeps(makeChild().child, { 'C:/sv/sherpa-onnx-offline.exe': '' });
        const r = await transcribeWithQwen(deps, SV);
        expect(r.ok).toBe(false);
        expect(r.message).toContain('SenseVoice 模型');
    });

    it('走 sensevoice 模式并把三件套拼进命令行', async () => {
        const c = makeChild();
        let seen: string[] = [];
        const deps: QwenBridgeDeps = {
            ...makeDeps(c.child, { ...SV_FILES, 'C:/v/a.srt': '1\n00:00:00,000 --> 00:00:01,000\nhi\n' }),
            spawn: (_exe, args) => {
                seen = args;
                return c.child;
            },
        };
        const p = transcribeWithQwen(deps, SV);
        c.pushOut('PROGRESS 50 正在识别 1/1 段\nDONE C:/v/a.srt\nRESULT {"ok":true,"srtPath":"C:/v/a.srt","entries":1,"durationSec":1}\n');
        c.close(0);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(seen).toContain('--mode');
        expect(seen[seen.indexOf('--mode') + 1]).toBe('sensevoice');
        expect(seen).toContain('--sherpa-exe');
        expect(seen).toContain('--sv-model');
        expect(seen).toContain('--sv-tokens');
    });

    it('非 sensevoice 模式绝不拼 SenseVoice 参数（脚本会把它们当噪声）', async () => {
        const c = makeChild();
        let seen: string[] = [];
        const deps: QwenBridgeDeps = {
            ...makeDeps(c.child, { 'C:/v/a.srt': 'x' }),
            spawn: (_exe, args) => {
                seen = args;
                return c.child;
            },
        };
        const p = transcribeWithQwen(deps, { ...BASE, ...SV, engine: 'qwen3' });
        c.pushOut('DONE C:/v/a.srt\n');
        c.close(0);
        await p;
        expect(seen).not.toContain('--sherpa-exe');
        expect(seen).not.toContain('--sv-model');
    });
});

/**
 * 🔴 用户 m06361：「也没有停止转录的交互」。
 * 桥接系（中文精准版 / 极速版）走的是 python 进程，同样必须能被叫停。
 */
describe('transcribeWithQwen · 停止转写', () => {
    it('转写中调 cancel() ⇒ 立刻返回已取消，且真的 kill 了子进程', async () => {
        const c = makeChild();
        let kills = 0;
        const child: QwenChild = { ...c.child, kill: () => { kills += 1; } };
        const deps = makeDeps(child, { 'C:/v/a.srt': 'x' });
        const token = createAsrCancelToken();
        const p = transcribeWithQwen(deps, { ...BASE, cancel: token });
        // 让进程先起来，再点「停止」
        await new Promise((r) => setTimeout(r, 5));
        token.cancel();
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.cancelled).toBe(true);
        expect(r.message).toBe('已停止转写');
        expect(kills).toBe(1);
    });

    it('停止不报成「失败」—— 退出码可能是 null，⛔ 别把用户自己的操作报成错误', async () => {
        const c = makeChild();
        const child: QwenChild = { ...c.child, kill: () => undefined };
        const deps = makeDeps(child, { 'C:/v/a.srt': 'x' });
        const token = createAsrCancelToken();
        const p = transcribeWithQwen(deps, { ...BASE, cancel: token });
        await new Promise((r) => setTimeout(r, 5));
        token.cancel();
        const r = await p;
        expect(r.message).not.toContain('异常退出');
        expect(r.message).not.toContain('失败');
    });

    it('已经取消过的令牌 ⇒ 不再起进程', async () => {
        let spawned = 0;
        const c = makeChild();
        const deps: QwenBridgeDeps = {
            ...makeDeps(c.child, { 'C:/v/a.srt': 'x' }),
            spawn: () => {
                spawned += 1;
                return c.child;
            },
        };
        const token = createAsrCancelToken();
        token.cancel();
        const r = await transcribeWithQwen(deps, { ...BASE, cancel: token });
        expect(r.cancelled).toBe(true);
        expect(spawned).toBe(0);
    });
});
