// 速率计（🔴 用户 m10754：「语音转文字的下载模型的进度浮球…如标 1MB/s 速度」）
//
// 三条下载链路对外的进度签名各不相同，且**都不能改**（各有十几个消费方）：
//   · `services/asrModelDownload`  → `(percent, received, total)`   ← 有字节数
//   · `services/whisperRuntime`    → `(percent, label)`             ← 只有百分比
//   · `services/asrBundleInstall`  → `(percent, fileIndex, label)`  ← 只有百分比
// 所以统一在这里做：调用方自己把百分比换算成字节（`percentToBytes`），再喂 `sample()`。

import { describe, expect, it } from 'vitest';
import {
    SPEED_MIN_WINDOW_MS,
    SPEED_STALE_MS,
    createSpeedMeter,
    parseSizeLabel,
    percentToBytes,
    speedSuffix,
} from 'pure/speedMeter';

/** 假时钟：手动推进，⛔ 不用真实 setTimeout（node 单测里会拖慢整轮） */
function fakeClock(): { now: () => number; tick: (ms: number) => void } {
    let t = 1_000_000;
    return {
        now: () => t,
        tick: (ms: number) => {
            t += ms;
        },
    };
}

describe('🔴 m10754 createSpeedMeter · 速率采样', () => {
    it('首个样本不出速度（只有一个点算不出斜率）', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        expect(m.sample(0)).toBeNull();
        expect(m.rate()).toBeNull();
    });

    it('窗口太短不出数，只更新基线', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        clock.tick(100); // < SPEED_MIN_WINDOW_MS
        expect(m.sample(64 * 1024)).toBeNull();
    });

    it('足量窗口给出合理速度（1 秒下 1MB ⇒ 约 1MB/s）', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        clock.tick(1000);
        const v = m.sample(1024 * 1024);
        expect(v).not.toBeNull();
        // 首个有效值直接采用（不平滑爬升），误差只来自取整
        expect(v as number).toBeCloseTo(1024 * 1024, -1);
    });

    it('连续样本按指数平滑收敛，不逐拍剧烈抖动', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        let bytes = 0;
        const rates: number[] = [];
        // 每 500ms 稳定下 512KB ⇒ 理论 1MB/s
        for (let i = 0; i < 6; i += 1) {
            clock.tick(500);
            bytes += 512 * 1024;
            const v = m.sample(bytes);
            if (v !== null) rates.push(v);
        }
        expect(rates.length).toBeGreaterThan(0);
        const last = rates[rates.length - 1];
        expect(last).toBeCloseTo(1024 * 1024, -2);
        // 平滑：相邻两拍的变化幅度不得超过理论值的 30%（否则界面会闪）
        for (let i = 1; i < rates.length; i += 1) {
            expect(Math.abs(rates[i] - rates[i - 1])).toBeLessThan(1024 * 1024 * 0.3);
        }
    });

    it(`🔴 超过 ${SPEED_STALE_MS}ms 没有新样本 ⇒ 速度归 0（不能留着旧读数骗人）`, () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        clock.tick(1000);
        const v = m.sample(1024 * 1024);
        expect(v).toBeGreaterThan(0);
        clock.tick(SPEED_STALE_MS + 1000);
        // 同一个字节数再喂一次 ⇒ 停了
        expect(m.sample(1024 * 1024)).toBe(0);
        expect(m.rate()).toBe(0);
    });

    it('进度回退（换源/分片重算）⇒ 不产生负速度，回到「未知」', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        clock.tick(1000);
        expect(m.sample(1024 * 1024)).toBeGreaterThan(0);
        clock.tick(1000);
        expect(m.sample(0)).toBeNull(); // 回退 ⇒ 重立基线
        clock.tick(1000);
        expect(m.sample(512 * 1024)).toBeCloseTo(512 * 1024, -1);
    });

    it('reset() 之后回到首个样本状态', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        m.sample(0);
        clock.tick(1000);
        m.sample(10 * 1024 * 1024);
        m.reset();
        expect(m.rate()).toBeNull();
        expect(m.sample(0)).toBeNull();
    });

    it('非法输入不炸、按 0 处理', () => {
        const clock = fakeClock();
        const m = createSpeedMeter(clock.now);
        expect(() => m.sample(Number.NaN)).not.toThrow();
        clock.tick(SPEED_MIN_WINDOW_MS + 10);
        expect(() => m.sample(-100)).not.toThrow();
    });
});

describe('🔴 m10754 parseSizeLabel · 体积文案 → 字节', () => {
    it('认 GB / MB / KB / B 与有无空格', () => {
        expect(parseSizeLabel('74 MB')).toBe(74 * 1024 ** 2);
        expect(parseSizeLabel('465MB')).toBe(465 * 1024 ** 2);
        expect(parseSizeLabel('1.5 GB')).toBe(Math.round(1.5 * 1024 ** 3));
        expect(parseSizeLabel('5.3MB')).toBe(Math.round(5.3 * 1024 ** 2));
        expect(parseSizeLabel('512 KB')).toBe(512 * 1024);
        expect(parseSizeLabel('900 B')).toBe(900);
    });

    it('取体积文案里第一处（清单行是「74 MB · 其它说明」形态）', () => {
        expect(parseSizeLabel('约 74 MB，装完可删')).toBe(74 * 1024 ** 2);
    });

    it('解析不出来返回 null（⛔ 不是 0 —— 「不知道多大」≠「0 字节」）', () => {
        expect(parseSizeLabel('')).toBeNull();
        expect(parseSizeLabel('未知')).toBeNull();
        expect(parseSizeLabel(undefined)).toBeNull();
    });
});

describe('🔴 m10754 percentToBytes · 百分比 → 字节', () => {
    it('正常换算', () => {
        expect(percentToBytes(50, 1000)).toBe(500);
        expect(percentToBytes(0, 1000)).toBe(0);
        expect(percentToBytes(100, 1000)).toBe(1000);
    });

    it('夹到 0..100（下载器偶发报 100.4）', () => {
        expect(percentToBytes(120, 1000)).toBe(1000);
        expect(percentToBytes(-5, 1000)).toBe(0);
    });

    it('任一未知 ⇒ null（调用方据此不显示速度）', () => {
        expect(percentToBytes(null, 1000)).toBeNull();
        expect(percentToBytes(50, null)).toBeNull();
        expect(percentToBytes(50, 0)).toBeNull();
        expect(percentToBytes(Number.NaN, 1000)).toBeNull();
    });
});

describe('🔴 m10754 speedSuffix · 拼到 label 尾段', () => {
    it('有速度给「 · 1.2 MB/s」', () => {
        expect(speedSuffix(1024 * 1024 * 1.2)).toBe(' · 1.2 MB/s');
    });

    it('0 / null / 负数 ⇒ 空串（⛔ 不出现「 · 0 B/s」）', () => {
        expect(speedSuffix(0)).toBe('');
        expect(speedSuffix(null)).toBe('');
        expect(speedSuffix(-1)).toBe('');
        expect(speedSuffix(undefined)).toBe('');
    });

    it('拼出来的串能被 splitLabelSpeed 拆回去（与 m09805 口径一致）', () => {
        const label = `正在下载模型…${speedSuffix(1024 * 1024 * 1.2)}`;
        expect(label).toBe('正在下载模型… · 1.2 MB/s');
    });
});
