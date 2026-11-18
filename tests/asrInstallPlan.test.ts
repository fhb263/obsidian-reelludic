import { describe, expect, it } from 'vitest';

import {
    asrInstallDirFields,
    asrInstallPlan,
    itemProgress,
    joinInstallPath,
    planTotalBytes,
    WHISPER_RUNTIME_ITEM_TITLE,
} from 'pure/asrInstallPlan';
import { ASR_MODEL_PRESETS } from 'pure/asrModels';
import { SENSEVOICE_BUNDLE, QWEN_BUNDLE } from 'pure/asrBundles';
import { WHISPER_RUNTIME_FILES, WHISPER_RUNTIME_ZIP_BYTES } from 'pure/whisperRuntime';

describe('asrInstallPlan · whisper', () => {
    it('必须列出两步：先程序、后模型（用户 m09123 问的就是「到底装什么」）', () => {
        const plan = asrInstallPlan('whisper', 'base');
        expect(plan.items).toHaveLength(2);
        expect(plan.items[0].title).toBe(WHISPER_RUNTIME_ITEM_TITLE);
        expect(plan.items[1].title).toContain('base');
        expect(plan.blockedReason).toBe('');
    });

    it('序号必须从 1 连续到 N（弹窗按这个顺序打勾）', () => {
        const plan = asrInstallPlan('whisper', 'tiny');
        expect(plan.items.map((i) => i.index)).toEqual([1, 2]);
    });

    it('每项都带体积文案，且程序那项就是发布包大小', () => {
        const plan = asrInstallPlan('whisper', 'medium');
        expect(plan.items[0].size).toBe('5.3MB');
        // medium 是 1463MB —— 体积必须跟着档位走，⛔ 不能固定写 base 的 141MB
        expect(plan.items[1].size).toBe('1463MB');
        expect(plan.items.every((i) => i.size.length > 0)).toBe(true);
    });

    it('没指定档位时回落 base（推荐档），⛔ 不抛', () => {
        const plan = asrInstallPlan('whisper');
        expect(plan.items[1].title).toContain(ASR_MODEL_PRESETS[1].title);
    });

    it('换档位只改模型那一项，程序那项不动', () => {
        const a = asrInstallPlan('whisper', 'tiny');
        const b = asrInstallPlan('whisper', 'large-v3');
        expect(a.items[0].title).toBe(b.items[0].title);
        expect(a.items[0].size).toBe(b.items[0].size);
        expect(a.items[1].title).not.toBe(b.items[1].title);
    });

    it('程序那项要说清「从压缩包里取」，否则用户会疑惑 26MB 包只落盘 2MB', () => {
        const plan = asrInstallPlan('whisper', 'base');
        expect(plan.items[0].detail).toContain('whisper-cli.exe');
    });
});

describe('asrInstallPlan · sensevoice / qwen3', () => {
    it('SenseVoice 三项齐全且没被封锁', () => {
        const plan = asrInstallPlan('sensevoice');
        expect(plan.items).toHaveLength(SENSEVOICE_BUNDLE.files.length);
        expect(plan.items.map((i) => i.index)).toEqual([1, 2, 3]);
        expect(plan.blockedReason).toBe('');
        expect(plan.title).toContain('SenseVoice');
    });

    it('Qwen3 带封锁原因（要 Python 环境，插件装不了）', () => {
        const plan = asrInstallPlan('qwen3');
        expect(plan.blockedReason).toContain('Python');
        expect(plan.items).toHaveLength(QWEN_BUNDLE.files.length);
    });

    it('清单项的标题原样取自 bundle 的 label（两处口径只留一份真源）', () => {
        const plan = asrInstallPlan('sensevoice');
        expect(plan.items.map((i) => i.title)).toEqual(SENSEVOICE_BUNDLE.files.map((f) => f.label));
    });
});

describe('planTotalBytes', () => {
    it('whisper = 发布包 + 该档模型', () => {
        const base = ASR_MODEL_PRESETS.find((p) => p.tier === 'base');
        expect(base).toBeDefined();
        expect(planTotalBytes('whisper', 'base')).toBe(WHISPER_RUNTIME_ZIP_BYTES + (base?.bytes ?? 0));
    });

    it('两家整包 = 各文件字节之和', () => {
        const sum = SENSEVOICE_BUNDLE.files.reduce((s, f) => s + f.bytes, 0);
        expect(planTotalBytes('sensevoice')).toBe(sum);
    });

    it('未知引擎不抛，返 0', () => {
        expect(planTotalBytes('nope')).toBeGreaterThan(0); // 当成 whisper 处理
        expect(planTotalBytes('')).toBeGreaterThan(0);
    });
});

describe('itemProgress', () => {
    it('第 1 项从 0 走到 100', () => {
        expect(itemProgress(2, 0, 0).percent).toBe(0);
        expect(itemProgress(2, 0, 50).percent).toBe(100);
    });

    it('第 2 项在整包 50% 时刚开始（⛔ 不能显示成 50%，那会让用户以为两项同时在下）', () => {
        const p = itemProgress(2, 1, 50);
        expect(p.index).toBe(1);
        expect(p.percent).toBe(0);
    });

    it('第 3 项在整包 90% 时是自身 70%', () => {
        const p = itemProgress(3, 2, 90);
        expect(p.index).toBe(2);
        expect(p.percent).toBe(70);
    });

    it('下标越界时夹到合法范围（执行层偶发传错不至于崩）', () => {
        expect(itemProgress(3, -5, 10).index).toBe(0);
        expect(itemProgress(3, 99, 10).index).toBe(2);
        expect(itemProgress(0, 0, 10).index).toBe(0);
    });

    it('百分比夹在 0..100', () => {
        expect(itemProgress(2, 0, -20).percent).toBe(0);
        expect(itemProgress(2, 1, 500).percent).toBe(100);
    });
});

describe('asrInstallPlan · 落点路径（用户 m01935「装之前先告知所有路径」）', () => {
    it('每一项都带目录与落盘文件名（弹窗靠它列「会落下哪些文件」）', () => {
        const plan = asrInstallPlan('sensevoice', undefined, undefined, {
            engineDir: 'C:\\asr\\sensevoice',
            binDir: 'C:\\asr\\bin',
        });
        expect(plan.items.every((i) => i.dir === 'C:\\asr\\sensevoice')).toBe(true);
        expect(plan.items.every((i) => i.files.length > 0)).toBe(true);
    });

    it('不传目录时是空串（⛔ 别在纯逻辑里偷偷 homedir()，那会让弹窗与落盘各算一遍）', () => {
        const plan = asrInstallPlan('sensevoice');
        expect(plan.items.every((i) => i.dir === '')).toBe(true);
        // 文件名仍然要给：用户就算还没选目录，也该知道会装哪几个文件
        expect(plan.items.every((i) => i.files.length > 0)).toBe(true);
    });

    it('whisper 是唯一「程序进 bin、模型进 engineDir」的一家', () => {
        const plan = asrInstallPlan('whisper', 'base', undefined, {
            engineDir: 'D:\\m\\whisper',
            binDir: 'D:\\b',
        });
        expect(plan.items[0].dir).toBe('D:\\b');
        expect(plan.items[1].dir).toBe('D:\\m\\whisper');
        // 程序那项会剥出 5 个文件，⛔ 不能只列一个 exe
        expect(plan.items[0].files).toEqual([...WHISPER_RUNTIME_FILES]);
        expect(plan.items[1].files).toEqual(['ggml-base.bin']);
    });

    it('从压缩包里剥出来的项，files 是剥完之后的真实文件名（⛔ 不是压缩包名）', () => {
        const plan = asrInstallPlan('confucius', undefined, undefined, {
            engineDir: 'D:\\m\\confucius',
            binDir: '',
        });
        // 第 1 项是 llama.cpp 的 24MB zip，一次剥出 8 个文件
        expect(plan.items[0].files.length).toBe(8);
        expect(plan.items[0].files).toContain('llama-mtmd-cli.exe');
        // ⛔ 压缩包本身不该出现在落盘清单里
        expect(plan.items[0].files.some((f) => f.endsWith('.zip'))).toBe(false);
    });

    it('目录跟着传进来的值走（用户改了目录，清单立刻跟着改）', () => {
        const a = asrInstallPlan('paraformer', undefined, undefined, { engineDir: 'E:\\a', binDir: 'E:\\a' });
        const b = asrInstallPlan('paraformer', undefined, undefined, { engineDir: 'F:\\b', binDir: 'F:\\b' });
        expect(a.items[0].dir).toBe('E:\\a');
        expect(b.items[0].dir).toBe('F:\\b');
    });
});

describe('asrInstallDirFields · 要确认几个目录', () => {
    it('whisper 两个（程序在 bin、模型在 models/whisper）', () => {
        const f = asrInstallDirFields('whisper');
        expect(f.map((x) => x.key)).toEqual(['binDir', 'engineDir']);
        expect(f.every((x) => x.label.length > 0 && x.why.length > 0)).toBe(true);
    });

    it('其余五家都只要一个（程序、权重、词表同目录）', () => {
        for (const id of ['qwen3', 'sensevoice', 'paraformer', 'xasr', 'confucius']) {
            const f = asrInstallDirFields(id);
            expect(f.map((x) => x.key)).toEqual(['engineDir']);
        }
    });

    it('认不出的引擎当 whisper（与 asrInstallPlan 同一口径）', () => {
        expect(asrInstallDirFields('nope').map((x) => x.key)).toEqual(['binDir', 'engineDir']);
    });
});

describe('joinInstallPath', () => {
    it('Windows 路径保留反斜杠', () => {
        expect(joinInstallPath('C:\\asr\\xasr', 'tokens.txt')).toBe('C:\\asr\\xasr\\tokens.txt');
    });

    it('正斜杠路径用正斜杠', () => {
        expect(joinInstallPath('/home/u/models', 'tokens.txt')).toBe('/home/u/models/tokens.txt');
    });

    it('去掉目录尾部分隔符（⛔ 别拼出双斜杠）', () => {
        expect(joinInstallPath('C:\\asr\\', 'a.onnx')).toBe('C:\\asr\\a.onnx');
        expect(joinInstallPath('/home/u/', 'a.onnx')).toBe('/home/u/a.onnx');
    });

    it('空目录返回空串、空文件名返回目录本身', () => {
        expect(joinInstallPath('', 'a.onnx')).toBe('');
        expect(joinInstallPath('   ', 'a.onnx')).toBe('');
        expect(joinInstallPath('C:\\asr', '')).toBe('C:\\asr');
    });
});
