// 阅读器底栏读数纯逻辑测试：TXT / EPUB / PDF 统一口径 ——
// 数字恒为「已读 全书%」、进度条填充取全书进度；页码与章内% 只走悬停提示。
import { describe, it, expect } from 'vitest';
import { footerReadout } from 'pure/readerFooter';

describe('footerReadout（底栏读数：数字 / 悬停 / 填充三件套）', () => {
    it('连续模式：数字「已读 全书%」，填充 = 全书%，悬停 = 章内 · 全书', () => {
        expect(footerReadout({ paged: false, page: 0, totalPages: 1, chapPct: 18, overallPct: 42 })).toEqual({
            text: '已读 42%',
            tip: '章内 18% · 全书 42%',
            fillPct: 42,
        });
    });

    it('翻页模式：数字与填充同连续模式（全书口径），页码只进悬停提示', () => {
        expect(footerReadout({ paged: true, page: 2, totalPages: 12, chapPct: 18, overallPct: 42 })).toEqual({
            text: '已读 42%',
            tip: '第 3/12 页 · 章内 18% · 全书 42%',
            fillPct: 42,
        });
    });

    it('两种模式同位置读数一致：数字与填充只由全书进度决定，与模式无关', () => {
        const base = { page: 2, totalPages: 12, chapPct: 18, overallPct: 42 };
        const scroll = footerReadout({ ...base, paged: false });
        const paged = footerReadout({ ...base, paged: true });
        expect(paged.text).toBe(scroll.text);
        expect(paged.fillPct).toBe(scroll.fillPct);
    });

    it('页码钳制：总页数 ≤ 0 视为 1 页，页码落在 [1, 总页数]', () => {
        expect(footerReadout({ paged: true, page: -3, totalPages: 0, chapPct: 0, overallPct: 0 }).tip).toBe(
            '第 1/1 页 · 章内 0% · 全书 0%',
        );
        expect(footerReadout({ paged: true, page: 99, totalPages: 12, chapPct: 0, overallPct: 0 }).tip).toBe(
            '第 12/12 页 · 章内 0% · 全书 0%',
        );
    });

    it('百分比归一：四舍五入 + 钳制 0-100，非法值按 0', () => {
        expect(footerReadout({ paged: false, page: 0, totalPages: 1, chapPct: 140, overallPct: -20 })).toEqual({
            text: '已读 0%',
            tip: '章内 100% · 全书 0%',
            fillPct: 0,
        });
        expect(footerReadout({ paged: false, page: 0, totalPages: 1, chapPct: Number.NaN, overallPct: 42.6 }).fillPct).toBe(43);
    });
});
