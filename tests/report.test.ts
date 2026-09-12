import { describe, it, expect } from 'vitest';
import { generateYearReport, yearReportPath } from 'pure/report';
import type { MediaEntry } from 'data/types';

function e(partial: Partial<MediaEntry> & Pick<MediaEntry, 'id' | 'type' | 'title'>): MediaEntry {
    return {
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...partial,
    };
}

const year = 2026;

describe('pure/report generateYearReport 年度总结', () => {
    it('frontmatter + 年度标题', () => {
        const md = generateYearReport({ year, entries: [] });
        expect(md).toContain('type: yearly-report');
        expect(md).toContain('year: 2026');
        expect(md).toContain('# 2026 年度总结');
    });

    it('概览：四库计数 + 时长 + 摘抄（含音乐）', () => {
        const entries = [
            e({ id: 'a', type: 'movie', title: '沙丘', watchedDate: '2026-03-01', rating: 5, year: 2021 }),
            e({ id: 'b', type: 'movie', title: '旧片', watchedDate: '2025-12-31' }),
            e({ id: 'c', type: 'book', title: '置身事内', watchedDate: '2026-05-01', readingProgress: { page: 200, totalPage: 320 } }),
            e({ id: 'd', type: 'game', title: '黑神话悟空', playtimeMinutes: 480 }),
            e({ id: 'm', type: 'music', title: '不再犹豫', watchedDate: '2026-06-01', durationMin: 5, rating: 5 }),
        ];
        const md = generateYearReport({ year, entries, excerptCounts: { c: 3 } });
        expect(md).toContain('看完 **1** 部');
        expect(md).toContain('读完 **1** 本');
        expect(md).toContain('320** 页');
        expect(md).toContain('摘抄 **3** 条');
        expect(md).toContain('通关 **0** 个');
        expect(md).toContain('🎵 音乐：已听 **1** 首');
    });

    it('Top 榜：仅年内看完且 rating>0，双链标题（含音乐）', () => {
        const entries = [
            e({ id: 'a', type: 'movie', title: '沙丘', watchedDate: '2026-03-01', rating: 5 }),
            e({ id: 'b', type: 'movie', title: '低分', watchedDate: '2026-03-02', rating: 1 }),
            e({ id: 'c', type: 'movie', title: '未评分', watchedDate: '2026-03-03', rating: 0 }),
            e({ id: 'm', type: 'music', title: '海阔天空', watchedDate: '2026-06-01', rating: 5 }),
        ];
        const md = generateYearReport({ year, entries });
        // Top 榜区域：从「## 二、Top 评分榜」到「## 三」之间，只含 沙丘/低分/海阔天空（rating>0）
        const topSection = md.slice(md.indexOf('## 二、Top 评分榜'), md.indexOf('## 三、月度节奏'));
        expect(topSection).toContain('★★★★★ **[[沙丘]]**');
        expect(topSection).toContain('★☆☆☆☆ **[[低分]]**');
        expect(topSection).toContain('### 音乐');
        expect(topSection).toContain('★★★★★ **[[海阔天空]]**');
        expect(topSection).not.toContain('未评分');
        // 完整清单含全部看完条目（未评分也在列，属正常）
        expect(md).toContain('[[未评分]]');
    });

    it('月度节奏表格：1-12 月四列', () => {
        const entries = [
            e({ id: 'a', type: 'movie', title: 'm1', watchedDate: '2026-01-15' }),
            e({ id: 'b', type: 'book', title: 'b1', watchedDate: '2026-05-01' }),
            e({ id: 'c', type: 'movie', title: 'm2', watchedDate: '2026-01-20' }),
            e({ id: 'm', type: 'music', title: 'song', watchedDate: '2026-06-01' }),
        ];
        const md = generateYearReport({ year, entries });
        expect(md).toContain('| 月份 | 影视 | 书籍 | 游戏 | 音乐 |');
        expect(md).toContain('| 1月 | 2 | 0 | 0 | 0 |');
        expect(md).toContain('| 5月 | 0 | 1 | 0 | 0 |');
        expect(md).toContain('| 6月 | 0 | 0 | 0 | 1 |');
        expect(md).toContain('| 12月 | 0 | 0 | 0 | 0 |');
    });

    it('完整清单：分库双链，含年份（含音乐）', () => {
        const entries = [
            e({ id: 'a', type: 'movie', title: '沙丘', watchedDate: '2026-03-01', year: 2021 }),
            e({ id: 'b', type: 'book', title: '置身事内', watchedDate: '2026-05-01' }),
            e({ id: 'm', type: 'music', title: '不再犹豫', watchedDate: '2026-06-01' }),
        ];
        const md = generateYearReport({ year, entries });
        expect(md).toContain('## 四、完整清单');
        expect(md).toContain('### 影视（1）');
        expect(md).toContain('- [[沙丘]]（2021）');
        expect(md).toContain('### 书籍（1）');
        expect(md).toContain('- [[置身事内]]');
        expect(md).toContain('### 音乐（1）');
        expect(md).toContain('- [[不再犹豫]]');
    });

    it('yearReportPath 命名（v0.4 中文化）', () => {
        expect(yearReportPath(2026)).toBe('ReelLudic/报告/2026-年度总结.md');
    });
});
