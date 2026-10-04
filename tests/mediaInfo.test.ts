// #462 本地音频「时长 / 体积」展示口径（音乐编辑表单「播放」按钮悬停提示用）
import { describe, it, expect } from 'vitest';
import { formatDuration, formatFileSize, mediaInfoLine } from 'pure/mediaInfo';

describe('formatDuration（秒 → mm:ss）', () => {
    it('常规：补零到两位分、两位秒（用户给的例子 04:25）', () => {
        expect(formatDuration(265)).toBe('04:25');
        expect(formatDuration(65)).toBe('01:05');
        expect(formatDuration(600)).toBe('10:00');
        expect(formatDuration(9)).toBe('00:09');
    });

    it('≥1 小时 ⇒ h:mm:ss（小时不补零、分补零）', () => {
        expect(formatDuration(3600)).toBe('1:00:00');
        expect(formatDuration(3723)).toBe('1:02:03');
    });

    it('小数四舍五入到整秒（59.6 → 01:00，跨分钟也算对）', () => {
        expect(formatDuration(59.6)).toBe('01:00');
        expect(formatDuration(264.4)).toBe('04:24');
    });

    it('🔴 拿不到 ⇒ 空串（0 / 负数 / 非数 / undefined —— ⛔ 不显示 00:00 冒充）', () => {
        expect(formatDuration(0)).toBe('');
        expect(formatDuration(-3)).toBe('');
        expect(formatDuration(Number.NaN)).toBe('');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('');
        expect(formatDuration(undefined)).toBe('');
    });
});

describe('formatFileSize（字节 → 可读体积，1024 进制）', () => {
    it('整数不留 .0（`3 MB` 而不是 `3.0 MB`）；单位与数值间有空格', () => {
        expect(formatFileSize(3 * 1024 * 1024)).toBe('3 MB');
        expect(formatFileSize(1024)).toBe('1 KB');
        expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('非整数保留 1 位小数', () => {
        expect(formatFileSize(Math.round(3.2 * 1024 * 1024))).toBe('3.2 MB');
        expect(formatFileSize(1536)).toBe('1.5 KB');
        expect(formatFileSize(Math.round(1.4 * 1024 * 1024 * 1024))).toBe('1.4 GB');
    });

    it('< 1 KB 显示整数字节；0 字节如实说 `0 B`', () => {
        expect(formatFileSize(812)).toBe('812 B');
        expect(formatFileSize(0)).toBe('0 B');
    });

    it('🔴 拿不到 ⇒ 空串（负数 / 非数 / undefined）', () => {
        expect(formatFileSize(-1)).toBe('');
        expect(formatFileSize(Number.NaN)).toBe('');
        expect(formatFileSize(undefined)).toBe('');
    });
});

describe('mediaInfoLine（「时长 · 体积」一行）', () => {
    it('两项都有 ⇒ `04:25 · 3.2 MB`（用户举例的形态）', () => {
        expect(mediaInfoLine(Math.round(3.2 * 1024 * 1024), 265)).toBe('04:25 · 3.2 MB');
    });

    it('🔴 只有一项 ⇒ 只显示那一项（⛔ 不留孤立的 `·`）', () => {
        expect(mediaInfoLine(undefined, 265)).toBe('04:25');
        expect(mediaInfoLine(3 * 1024 * 1024, undefined)).toBe('3 MB');
    });

    it('🔴 两项都没有 ⇒ **空串**（调用方据此整行不加到提示里）', () => {
        expect(mediaInfoLine(undefined, undefined)).toBe('');
        expect(mediaInfoLine(Number.NaN, 0)).toBe('');
    });
});
