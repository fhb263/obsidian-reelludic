/**
 * `pure/readerFops` —— 阅读器底栏图标组「描述行为」的悬停轻提示真源（#603）。
 *
 * 🔴 这里钉的是**事实**，不是措辞偏好：
 *    ⑴ 沉浸那条说的必须是「**点正文空白**收起 / 展开」—— 边缘唤出那条热区 2026-09-15 就撤了，
 *       旧文案（移到边缘唤出）是漏改留下的**错误说明**（用户 2026-10-10 报障原话即此）；
 *    ⑵ 自动推进那条，**括号里那半句必须一字不差**（同一个交互：再点停 + 右键调速）；
 *    ⑶ 🔴 2026-10-23：`autoScrollOnly`（「PDF 只有连续滚动、所以不带翻页二字」）已**删除** ——
 *       本批给 PDF 补了「滚动 / 翻页」双模式、给漫画补了自动推进（单页定时翻页 / 连续匀速滚动），
 *       四个阅读器都是「滚动 + 翻页」两态 ⇒ 统一用 `autoScrollPaged`。
 *       ⛔ 别为了某处措辞「更贴切」再把第二个常量加回来，那正是死配置面的来源。
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

    it('自动推进：括号里那半句**一字不差**（同一交互：再点停 · 右键调速）', () => {
        const tail = '（再点停 · 右键调速）';
        expect(READER_FOPS.autoScrollPaged.endsWith(tail)).toBe(true);
        // 🔴 旧版 TXT/EPUB 写的是「（右键调速）」—— 少了「再点停」，与 PDF 那句不同款
        expect(READER_FOPS.autoScrollPaged).not.toBe('自动滚动 / 翻页（右键调速）');
    });

    it('🔴 2026-10-23：四个阅读器都有翻页模式 ⇒ 常量表里**只剩** autoScrollPaged，⛔ 没有 autoScrollOnly', () => {
        expect(READER_FOPS.autoScrollPaged).toBe('自动滚动 / 翻页（再点停 · 右键调速）');
        expect(Object.keys(READER_FOPS).sort()).toEqual(['autoScrollPaged', 'immersive']);
        expect('autoScrollOnly' in READER_FOPS).toBe(false);
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
