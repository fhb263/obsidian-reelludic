/**
 * `pure/whisperRuntime` 单测 —— 一键安装的「挑哪些文件 / 进度怎么算 / 平台门控」。
 *
 * 🔴 守三件事：
 *    ① 白名单只能是那 5 个文件（官方 zip 里有 parakeet / wchess / SDL2 等无关产物，
 *       整包解压会让用户目录凭空多出几十 MB）；
 *    ② 条目名要剥掉 `Release/` 前缀落到 bin 根目录（否则自动探测找不到，
 *       出现「装成功了但还是红的」——那比装不上更气人）；
 *    ③ 进度是**一条**线性 0–100（下载 0–80、解压 80–100），⛔ 不是两条各自冲到 100。
 */
import { describe, expect, it } from 'vitest';
import {
    WHISPER_RUNTIME_EXE,
    WHISPER_RUNTIME_FILES,
    installLabel,
    installPercent,
    installSupported,
    installUnsupportedMessage,
    runtimeComplete,
    runtimeFilePlan,
    runtimeMissing,
} from 'pure/whisperRuntime';

describe('WHISPER_RUNTIME_FILES 白名单', () => {
    it('恰好 5 个文件，且主程序在列', () => {
        expect(WHISPER_RUNTIME_FILES).toHaveLength(5);
        expect(WHISPER_RUNTIME_FILES).toContain(WHISPER_RUNTIME_EXE);
    });

    it('全是 .exe / .dll，没有把模型 .bin 混进来（模型走另一条下载链路）', () => {
        for (const f of WHISPER_RUNTIME_FILES) {
            expect(f).toMatch(/\.(exe|dll)$/);
        }
    });
});

describe('runtimeFilePlan', () => {
    it('🔴 剥掉 Release/ 前缀，落在 bin 根目录', () => {
        const plan = runtimeFilePlan(['Release/whisper-cli.exe', 'Release/whisper.dll']);
        expect(plan).toEqual([
            { entry: 'Release/whisper-cli.exe', target: 'whisper-cli.exe' },
            { entry: 'Release/whisper.dll', target: 'whisper.dll' },
        ]);
    });

    it('反斜杠分隔的条目也认（Windows 打包工具两种都有）', () => {
        const plan = runtimeFilePlan(['Release\\ggml.dll']);
        expect(plan).toEqual([{ entry: 'Release/ggml.dll', target: 'ggml.dll' }]);
    });

    it('大小写不敏感（不同 build 的大小写不一致过）', () => {
        const plan = runtimeFilePlan(['Release/Ggml.dll']);
        expect(plan.map((p) => p.target)).toEqual(['ggml.dll']);
    });

    it('🔴 无关产物一个都不要（parakeet / wchess / SDL2）', () => {
        const plan = runtimeFilePlan([
            'Release/parakeet.exe',
            'Release/wchess.exe',
            'Release/SDL2.dll',
            'Release/whisper-cli.exe',
        ]);
        expect(plan.map((p) => p.target)).toEqual(['whisper-cli.exe']);
    });

    it('同一个目标只保留第一次出现（zip 里偶尔有重复条目）', () => {
        const plan = runtimeFilePlan(['Release/ggml.dll', 'other/ggml.dll']);
        expect(plan).toHaveLength(1);
        expect(plan[0].entry).toBe('Release/ggml.dll');
    });

    it('空名 / 以斜杠结尾的条目被跳过', () => {
        expect(runtimeFilePlan(['', 'Release/', null as unknown as string])).toEqual([]);
    });

    it('真实 zip 的 33 个条目名里能挑出完整 5 件', () => {
        const realNames = [
            'Release/bench.exe',
            'Release/command.exe',
            'Release/ggml-base.dll',
            'Release/ggml-cpu.dll',
            'Release/ggml.dll',
            'Release/whisper-cli.exe',
            'Release/whisper.dll',
        ];
        const plan = runtimeFilePlan(realNames);
        expect(plan).toHaveLength(5);
        expect(plan.map((p) => p.target).sort()).toEqual([...WHISPER_RUNTIME_FILES].sort());
    });
});

describe('runtimeComplete / runtimeMissing', () => {
    it('五件齐 ⇒ complete 且没有缺失', () => {
        expect(runtimeComplete([...WHISPER_RUNTIME_FILES])).toBe(true);
        expect(runtimeMissing([...WHISPER_RUNTIME_FILES])).toEqual([]);
    });

    it('大小写不影响判定', () => {
        expect(runtimeComplete(WHISPER_RUNTIME_FILES.map((f) => f.toUpperCase()))).toBe(true);
    });

    it('缺一件 ⇒ 不完整，且指出缺的是哪几个', () => {
        const have = WHISPER_RUNTIME_FILES.filter((f) => f !== 'ggml-cpu.dll');
        expect(runtimeComplete(have)).toBe(false);
        expect(runtimeMissing(have)).toEqual(['ggml-cpu.dll']);
    });

    it('空目录 ⇒ 五件全缺', () => {
        expect(runtimeMissing([])).toHaveLength(5);
    });
});

describe('installPercent', () => {
    it('🔴 下载 0–80、解压 80–100，合成一条线性进度', () => {
        expect(installPercent('download', 0)).toBe(0);
        expect(installPercent('download', 50)).toBe(40);
        expect(installPercent('download', 100)).toBe(80);
        expect(installPercent('extract', 0)).toBe(80);
        expect(installPercent('extract', 50)).toBe(90);
        expect(installPercent('extract', 100)).toBe(100);
    });

    it('解压起点接着下载终点 —— 中间不回 0（回 0 会让用户以为失败过一次）', () => {
        expect(installPercent('extract', 0)).toBe(installPercent('download', 100));
    });

    it('越界与非法值被夹住', () => {
        expect(installPercent('download', -50)).toBe(0);
        expect(installPercent('download', 500)).toBe(80);
        expect(installPercent('download', Number.NaN)).toBe(0);
        expect(installPercent('extract', Number.POSITIVE_INFINITY)).toBe(100);
    });
});

describe('installLabel', () => {
    it('文案里不出现技术黑话（zip / exe / GitHub）', () => {
        for (const stage of ['download', 'extract'] as const) {
            const label = installLabel(stage);
            expect(label).not.toMatch(/zip|exe|github|dll/i);
            expect(label.length).toBeGreaterThan(0);
        }
    });

    it('两个阶段的文案不同（否则用户分不清在下还是在解）', () => {
        expect(installLabel('download')).not.toBe(installLabel('extract'));
    });
});

describe('installSupported / installUnsupportedMessage', () => {
    it('只有 Windows 支持一键安装（官方只发 Win32 预编译包）', () => {
        expect(installSupported('win32')).toBe(true);
        expect(installSupported('darwin')).toBe(false);
        expect(installSupported('linux')).toBe(false);
    });

    it('macOS 给 Homebrew 的具体命令，不是一句「不支持」', () => {
        const msg = installUnsupportedMessage('darwin');
        expect(msg).toContain('brew install whisper-cpp');
    });

    it('其它平台也给「装好后会自动找到」的出路', () => {
        const msg = installUnsupportedMessage('linux');
        expect(msg).toContain('自动找到');
        expect(msg).not.toMatch(/zip|exe/i);
    });
});
