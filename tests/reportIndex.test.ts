import { describe, it, expect } from 'vitest';
import { parseReportYear, listReportYears } from 'pure/reportIndex';

describe('pure/reportIndex parseReportYear 报告年份解析', () => {
    it('合法：目录前缀 + YYYY-年度总结.md → 年份', () => {
        expect(parseReportYear('媒体库/报告/2025-年度总结.md')).toBe(2025);
        expect(parseReportYear('ReelLudic/报告/2026-年度总结.md')).toBe(2026);
        expect(parseReportYear('2024-年度总结.md')).toBe(2024); // 根目录直放也认
    });

    it('非法：非年度总结命名 / 年份缺失 / 年份非 4 位 → null', () => {
        expect(parseReportYear('媒体库/报告/年度总结.md')).toBeNull();
        expect(parseReportYear('媒体库/报告/2026-总结.md')).toBeNull();
        expect(parseReportYear('媒体库/报告/26-年度总结.md')).toBeNull();
        expect(parseReportYear('媒体库/报告/abcd-年度总结.md')).toBeNull();
        expect(parseReportYear('媒体库/报告/2026-年度总结.md.bak')).toBeNull();
    });

    it('相邻其它类型文件（笔记/封面）不误判', () => {
        expect(parseReportYear('媒体库/报告/2026-月度报告.md')).toBeNull();
        expect(parseReportYear('媒体库/笔记/2026-年度总结.md')).toBe(2026); // 文件名规则独立于目录
        expect(parseReportYear('媒体库/封面/2026-年度总结.png')).toBeNull();
    });
});

describe('pure/reportIndex listReportYears 报告罗列', () => {
    it('年份降序 + 剔除非法路径', () => {
        const paths = [
            '媒体库/报告/2025-年度总结.md',
            '媒体库/笔记/随便.md',
            '媒体库/报告/2024-年度总结.md',
            '媒体库/报告/2026-年度总结.md',
            '媒体库/报告/2026-月度报告.md',
        ];
        const list = listReportYears(paths);
        expect(list.map((x) => x.year)).toEqual([2026, 2025, 2024]);
        expect(list[0].path).toBe('媒体库/报告/2026-年度总结.md');
    });

    it('空输入 → 空数组', () => {
        expect(listReportYears([])).toEqual([]);
    });
});
