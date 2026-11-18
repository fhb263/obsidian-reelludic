/**
 * AI 运行管家的硬件判据（用户 m05717 ①）。
 *
 * 这里钉的每一条都对应界面上的一句人话，改判据前先看对应用户原文：
 *  · 没独显 ⇒「未检测到，将默认使用 CPU」，**灰色置底、不是红叉**；
 *  · 显存不够 ⇒ 标红 + 建议换 INT8 / 小一档；
 *  · CMake / C++ ⇒ **可选**依赖，缺了显示 ⚠ 但不挡任何事。
 */
import { describe, expect, it } from 'vitest';
import {
    EMPTY_HARDWARE,
    defaultDevice,
    estimateFootprint,
    footprintWarning,
    formatMb,
    gpuRowState,
    hasFatalMissing,
    optionalToolState,
    parseNvidiaSmi,
    sizeLabelToMb,
    vramFits,
    type HardwareInfo,
} from '../src/pure/asrHardware';

function hw(patch: Partial<HardwareInfo> = {}): HardwareInfo {
    return { ...EMPTY_HARDWARE, ...patch };
}

describe('parseNvidiaSmi（读显卡）', () => {
    it('单卡正常输出', () => {
        expect(parseNvidiaSmi('NVIDIA GeForce RTX 4060 Laptop GPU, 8188\n')).toEqual([
            { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', vramMb: 8188 },
        ]);
    });

    it('多卡每行一块', () => {
        const out = 'NVIDIA GeForce RTX 4090, 24564\nNVIDIA GeForce RTX 3060, 12288\n';
        expect(parseNvidiaSmi(out)).toHaveLength(2);
        expect(parseNvidiaSmi(out)[1]).toEqual({ name: 'NVIDIA GeForce RTX 3060', vramMb: 12288 });
    });

    it('⛔ 显卡名自带逗号时，显存要从右边取', () => {
        // 某些 OEM 定制名会长这样；从左 split 会把显存读成 NaN
        const out = 'NVIDIA RTX A4000, Dell OEM, 16376\n';
        expect(parseNvidiaSmi(out)).toEqual([{ name: 'NVIDIA RTX A4000, Dell OEM', vramMb: 16376 }]);
    });

    it('没装 N 卡（空输出）返回空数组，不抛错', () => {
        expect(parseNvidiaSmi('')).toEqual([]);
        expect(parseNvidiaSmi('   \n\n')).toEqual([]);
    });

    it('脏行跳过（缺显存 / 显存非数字 / 显存为 0）', () => {
        expect(parseNvidiaSmi('NVIDIA X\n')).toEqual([]);
        expect(parseNvidiaSmi('NVIDIA X, abc\n')).toEqual([]);
        expect(parseNvidiaSmi('NVIDIA X, 0\n')).toEqual([]);
    });

    it('Windows 换行也能认', () => {
        expect(parseNvidiaSmi('NVIDIA GTX 1080, 8192\r\n')).toHaveLength(1);
    });
});

describe('formatMb（说人话）', () => {
    it('1024 以上按 GB 保留一位', () => {
        expect(formatMb(8188)).toBe('8.0 GB');
        expect(formatMb(2048)).toBe('2.0 GB');
    });

    it('1024 以下按 MB 取整', () => {
        expect(formatMb(512)).toBe('512 MB');
        expect(formatMb(643)).toBe('643 MB');
    });

    it('0 / 负数 / NaN 统一 0 MB', () => {
        expect(formatMb(0)).toBe('0 MB');
        expect(formatMb(-5)).toBe('0 MB');
        expect(formatMb(Number.NaN)).toBe('0 MB');
    });
});

describe('sizeLabelToMb（展示值反解）', () => {
    it('GB 与 MB 都认', () => {
        expect(sizeLabelToMb('1.5 GB')).toBe(1536);
        expect(sizeLabelToMb('75 MB')).toBe(75);
        expect(sizeLabelToMb('3.1 GB')).toBe(3174);
    });

    it('大小写与单字母单位都认', () => {
        expect(sizeLabelToMb('228 mb')).toBe(228);
        expect(sizeLabelToMb('1.0G')).toBe(1024);
    });

    it('认不出来返回 0（不瞎猜）', () => {
        expect(sizeLabelToMb('')).toBe(0);
        expect(sizeLabelToMb('很大')).toBe(0);
        expect(sizeLabelToMb('1.5 TB')).toBe(0);
    });
});

describe('estimateFootprint（资源预估）', () => {
    it('CPU 路径不吃显存', () => {
        const fp = estimateFootprint('1.5 GB', 'cpu');
        expect(fp.vramMb).toBe(0);
        expect(fp.ramMb).toBeGreaterThan(1536);
    });

    it('GPU 路径吃显存且比权重本身大', () => {
        const fp = estimateFootprint('1.5 GB', 'gpu');
        expect(fp.vramMb).toBeGreaterThan(1536);
        expect(fp.ramMb).toBeGreaterThan(0);
    });

    it('大档位的激活开销比例更高（>2GB 用 20%）', () => {
        const small = estimateFootprint('1.0 GB', 'cpu');
        const big = estimateFootprint('4.0 GB', 'cpu');
        // 4GB × 1.2 + 512 vs 1GB × 1.1 + 512 —— 后者相对增幅更大
        const smallRatio = (small.ramMb - 512) / 1024;
        const bigRatio = (big.ramMb - 512) / 4096;
        expect(bigRatio).toBeGreaterThan(smallRatio);
    });

    it('⛔ 体积认不出来时不许编数字', () => {
        expect(estimateFootprint('', 'gpu')).toEqual({ vramMb: 0, ramMb: 0 });
    });
});

describe('gpuRowState（GPU 那一项怎么显示）', () => {
    it('没显卡 ⇒ no-gpu（中性，不是错误）', () => {
        expect(gpuRowState(null, 4096)).toBe('no-gpu');
    });

    it('有卡且够 ⇒ selectable', () => {
        expect(gpuRowState({ name: 'RTX 4090', vramMb: 24564 }, 8192)).toBe('selectable');
    });

    it('有卡但显存不够 ⇒ too-small', () => {
        expect(gpuRowState({ name: 'RTX 3060', vramMb: 12288 }, 20000)).toBe('too-small');
    });

    it('需要 0 显存（CPU 档）时有卡也算 selectable', () => {
        expect(gpuRowState({ name: 'RTX 3060', vramMb: 12288 }, 0)).toBe('selectable');
    });
});

describe('vramFits', () => {
    it('刚好够算够（边界）', () => {
        expect(vramFits(8188, { name: 'x', vramMb: 8188 })).toBe(true);
    });

    it('差 1MB 就算了', () => {
        expect(vramFits(8189, { name: 'x', vramMb: 8188 })).toBe(false);
    });

    it('没卡恒 false', () => {
        expect(vramFits(1, null)).toBe(false);
    });
});

describe('defaultDevice（默认运行设备）', () => {
    it('⛔ 即使有 4090 也默认 CPU —— 因为装的是 CPU 版运行时', () => {
        const h = hw({ gpus: [{ name: 'RTX 4090', vramMb: 24564 }] });
        expect(defaultDevice(h)).toBe('cpu');
    });

    it('没卡时也是 CPU', () => {
        expect(defaultDevice(hw())).toBe('cpu');
    });
});

describe('footprintWarning（超了就说话）', () => {
    it('CPU 且内存够 ⇒ 不废话', () => {
        expect(footprintWarning({ vramMb: 0, ramMb: 1024 }, 'cpu', hw({ totalMemMb: 32768 }))).toBe('');
    });

    it('CPU 但内存不够 ⇒ 明说差多少', () => {
        const msg = footprintWarning({ vramMb: 0, ramMb: 65536 }, 'cpu', hw({ totalMemMb: 8192 }));
        expect(msg).toContain('内存不够');
        expect(msg).toContain('8.0 GB');
    });

    it('GPU 但没卡 ⇒ 回落提示，不是报错', () => {
        const msg = footprintWarning({ vramMb: 4096, ramMb: 512 }, 'gpu', hw());
        expect(msg).toContain('没检测到独立显卡');
        expect(msg).toContain('CPU');
    });

    it('GPU 显存不够 ⇒ 建议换 INT8 / 小一档', () => {
        const msg = footprintWarning(
            { vramMb: 20000, ramMb: 512 },
            'gpu',
            hw({ gpus: [{ name: 'RTX 3060', vramMb: 12288 }] }),
        );
        expect(msg).toContain('显存不够');
        expect(msg).toContain('INT8');
        expect(msg).toContain('差 7.5 GB');
    });

    it('GPU 显存够 ⇒ 不废话', () => {
        const msg = footprintWarning(
            { vramMb: 4096, ramMb: 512 },
            'gpu',
            hw({ gpus: [{ name: 'RTX 4090', vramMb: 24564 }] }),
        );
        expect(msg).toBe('');
    });

    it('内存总量未知（0）时不瞎报不够', () => {
        expect(footprintWarning({ vramMb: 0, ramMb: 999999 }, 'cpu', hw())).toBe('');
    });
});

describe('optionalToolState / hasFatalMissing', () => {
    it('CMake 找没找到映射成 ok / missing', () => {
        expect(optionalToolState(true)).toBe('ok');
        expect(optionalToolState(false)).toBe('missing');
    });

    it('有任何一项不 ok 就算致命缺失', () => {
        expect(hasFatalMissing([{ ok: true }, { ok: false }])).toBe(true);
    });

    it('全 ok ⇒ 不致命', () => {
        expect(hasFatalMissing([{ ok: true }, { ok: true }])).toBe(false);
    });

    it('空清单 ⇒ 不致命（没有要求就不存在缺失）', () => {
        expect(hasFatalMissing([])).toBe(false);
    });
});
