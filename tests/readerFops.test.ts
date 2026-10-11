/**
 * `pure/readerFops` —— 阅读器底栏图标组「描述行为」的悬停轻提示真源（#603）。
 *
 * 🔴 这里钉的是**事实**，不是措辞偏好：
 *    ⑴ 沉浸那条说的必须是「**点正文空白**收起 / 展开」—— 边缘唤出那条热区 2026-09-15 就撤了，
 *       旧文案（移到边缘唤出）是漏改留下的**错误说明**（用户 2026-10-10 报障原话即此）；
 *    ⑵ 两条自动推进，**括号里那半句必须一字不差**（同一个交互：再点停 + 右键调速）；
 *       能合法不同的只有「有没有翻页模式」—— PDF 只有连续滚动，⛔ 别给它安「翻页」二字。
 */
import { describe, it, expect } from 'vitest';
import { READER_FOPS } from '../src/pure/readerFops';

describe('readerFops · 底栏图标组的悬停轻提示', () => {
    it('沉浸模式：说的是「点正文空白收起 / 展开」', () => {
        expect(READER_FOPS.immersive).toBe('沉浸模式（点正文空白收起 / 展开）');
    });

    it('🔴 沉浸模式：⛔ 不许再出现「边缘 / 唤出」这套已经作废的说法（旧行为 2026-09-15 已撤）', () => {
        expect(READER_FOPS.immersive).not.toContain('边缘');
        expect(READER_FOPS.immersive).not.toContain('唤出');
        expect(READER_FOPS.immersive).not.toContain('鼠标');
        // 正向：必须点明真实的交互方式（不然用户压根不知道边栏怎么回来）
        expect(READER_FOPS.immersive).toContain('点正文空白');
    });

    it('两条自动推进：括号里那半句**一字不差**（同一交互：再点停 · 右键调速）', () => {
        const tail = '（再点停 · 右键调速）';
        expect(READER_FOPS.autoScrollPaged.endsWith(tail)).toBe(true);
        expect(READER_FOPS.autoScrollOnly.endsWith(tail)).toBe(true);
        // 🔴 旧版 TXT/EPUB 写的是「（右键调速）」—— 少了「再点停」，与 PDF 那句不同款
        expect(READER_FOPS.autoScrollPaged).not.toBe('自动滚动 / 翻页（右键调速）');
    });

    it('自动推进的**合法差异**只有一处：翻页模式（PDF 没有 ⇒ ⛔ 不许带「翻页」）', () => {
        expect(READER_FOPS.autoScrollPaged).toBe('自动滚动 / 翻页（再点停 · 右键调速）');
        expect(READER_FOPS.autoScrollOnly).not.toContain('翻页');
        expect(READER_FOPS.autoScrollOnly).toBe('自动滚动（再点停 · 右键调速）');
    });

    it('三条都是可直接挂 data-tip 的干净文案（非空、无首尾空白、无换行）', () => {
        for (const v of Object.values(READER_FOPS)) {
            expect(typeof v).toBe('string');
            expect(v).toBe(v.trim());
            expect(v.length).toBeGreaterThan(0);
            expect(v).not.toContain('\n');
        }
    });
});
