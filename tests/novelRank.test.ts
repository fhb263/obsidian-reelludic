// #426「下载书籍」搜索结果排序（`pure/novelRank`）：章号解析 + 稳定倒序。
// 样本全部来自真实书源（`_probe426.cjs` 打在「阅读库」上的实测输出）。

import { describe, it, expect } from 'vitest';
import { chineseNumber, latestChapterNo, sortByLatestChapter } from 'pure/novelRank';

describe('novelRank · 中文数字（只覆盖章节号会用的写法）', () => {
    it('个位 / 十位', () => {
        expect(chineseNumber('七')).toBe(7);
        expect(chineseNumber('十')).toBe(10);
        expect(chineseNumber('十二')).toBe(12); // 省略「一」的写法
        expect(chineseNumber('二十三')).toBe(23);
    });

    it('百 / 千 / 万 + 零占位', () => {
        expect(chineseNumber('一百零八')).toBe(108);
        expect(chineseNumber('一千二百三十四')).toBe(1234);
        expect(chineseNumber('一万二千')).toBe(12000);
    });

    it('认不出的字跳过、不抛（书源给的是站点自由文本）', () => {
        expect(chineseNumber('')).toBe(0);
        expect(chineseNumber('正文')).toBe(0);
        expect(chineseNumber('第x章')).toBe(0);
    });
});

describe('novelRank · 最新章节 → 章号', () => {
    it('阿拉伯数字：「第 N 章/节/回/话/集/篇」都认，中间可有空格', () => {
        expect(latestChapterNo('第325章：红尘影，终成梦（大结局）')).toBe(325);
        expect(latestChapterNo('正文 废柴逆袭_第12节 xxx')).toBe(12);
        expect(latestChapterNo('第 7 回 张三')).toBe(7);
    });

    it('中文数字：第七章 → 7 / 第一百零八回 → 108', () => {
        expect(latestChapterNo('第七章 得手臂、混战')).toBe(7);
        expect(latestChapterNo('第一百零八回 大结局')).toBe(108);
    });

    it('🔴 取**最后一个**匹配（源常把「正文 废柴逆袭_」这类前缀一起带进来）', () => {
        expect(latestChapterNo('第5章 番外 第325章')).toBe(325);
    });

    it('🔴 取不到 ⇒ 0（垫底），但**不丢这条结果**', () => {
        expect(latestChapterNo('新书元尊已在起点上传，欢迎大家阅读。')).toBe(0);
        expect(latestChapterNo('1')).toBe(0);
        expect(latestChapterNo('关于回归')).toBe(0);
        expect(latestChapterNo('')).toBe(0);
    });

    it('🔴「第一卷」不算章号（卷与章不是一个量级，混排会乱）', () => {
        expect(latestChapterNo('第一卷人物一览表（未全）')).toBe(0);
    });

    it('⛔ 不许把串里随便一个数字当章号（年份 / 括号里的数字）', () => {
        expect(latestChapterNo('2024年完结感言')).toBe(0);
        expect(latestChapterNo('（共 325 字）')).toBe(0);
    });
});

describe('novelRank · 排序（倒序 + 稳定）', () => {
    const H = (latestChapter: string, name: string) => ({ latestChapter, name });
    const latest = (r: { latestChapter: string }) => r.latestChapter;

    it('按章号**倒序**：连载进度越靠后越前；取不到章号（0）的垫底', () => {
        const rows = [H('第七章 得手臂', 'a'), H('新书元尊已在起点上传', 'b'), H('第325章：大结局', 'c')];
        expect(sortByLatestChapter(rows, latest).map((r) => r.name)).toEqual(['c', 'a', 'b']);
    });

    it('🔴 章号相同 ⇒ **保持原有先后**（原序 = 各源返回序，稳定排序避免每次搜索乱跳）', () => {
        const rows = [H('第10章 甲', 'a'), H('第10章 乙', 'b'), H('第10章 丙', 'c')];
        expect(sortByLatestChapter(rows, latest).map((r) => r.name)).toEqual(['a', 'b', 'c']);
    });

    it('全都没章号 ⇒ 原样不动', () => {
        const rows = [H('', 'a'), H('序章', 'b'), H('', 'c')];
        expect(sortByLatestChapter(rows, latest).map((r) => r.name)).toEqual(['a', 'b', 'c']);
    });

    it('⛔ 不改动入参数组（返回新数组）', () => {
        const rows = [H('第1章', 'a'), H('第9章', 'b')];
        const out = sortByLatestChapter(rows, latest);
        expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
        expect(out).not.toBe(rows);
    });
});
