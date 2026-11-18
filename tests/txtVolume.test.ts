// m03052 ②：TXT 目录「卷 → 章」两层投影（用户原话：「阅读器关联txt目录显示的没有区分卷做文件夹啊」）
//
// 铁律：`chapters` 的扁平下标是全阅读器唯一章标识（进度 / 书签 / 高亮 / 摘抄 / switchChapter 全按它算），
//   `txtVolumeGroups` 只是**视图层投影**，⛔ 不许改 `parseTxtBook` 输出的 chapters 结构。
// ⇒ 这里除了测分组本身，还必须测「分组不改变 chapters」与「卷边界与章下标一一对应」。

import { describe, expect, it } from 'vitest';
import { isVolumeLine, parseTxtBook, txtVolumeGroups, chapterParagraphs } from 'pure/txtParse';

const chaptersOf = (...titles: string[]) => titles.map((t) => ({ title: t }));

describe('isVolumeLine', () => {
    it('认「第X卷」「卷X」，含全角数字', () => {
        expect(isVolumeLine('第一卷 风起')).toBe(true);
        expect(isVolumeLine('第2卷')).toBe(true);
        expect(isVolumeLine('卷三：归途')).toBe(true);
        expect(isVolumeLine('第１２卷')).toBe(true);
    });

    it('章 / 节 / 回 不算卷', () => {
        expect(isVolumeLine('第一章 相遇')).toBe(false);
        expect(isVolumeLine('第三节')).toBe(false);
        expect(isVolumeLine('第五回 夜奔')).toBe(false);
        expect(isVolumeLine('楔子')).toBe(false);
    });

    it('长度口径与 isChapterLine 一致：过短 / 过长都不认', () => {
        expect(isVolumeLine('卷')).toBe(false); // 1 字，正文里可能是普通词
        expect(isVolumeLine(`第一卷${'啊'.repeat(60)}`)).toBe(false); // > 40 字，是正文句子
    });
});

describe('txtVolumeGroups · 分组投影', () => {
    it('无卷标记 ⇒ 单一「散章」组（title 空串），渲染层平铺、观感等同改造前', () => {
        const g = txtVolumeGroups(chaptersOf('第一章', '第二章', '第三章'));
        expect(g).toEqual([{ title: '', from: 0, to: 3 }]);
    });

    it('只有卷、没有散章 ⇒ 每组 from 指向卷头章、to 指向下一卷卷头', () => {
        const g = txtVolumeGroups(chaptersOf('第一卷', '第一章', '第二章', '第二卷', '第三章'));
        expect(g).toEqual([
            { title: '第一卷', from: 0, to: 3 },
            { title: '第二卷', from: 3, to: 5 },
        ]);
    });

    it('卷之前有散章 ⇒ 先出一个 title 空串的组（常见：书名/作者/简介）', () => {
        const g = txtVolumeGroups(chaptersOf('第一章', '第二章', '第一卷', '第三章'));
        expect(g).toEqual([
            { title: '', from: 0, to: 2 },
            { title: '第一卷', from: 2, to: 4 },
        ]);
    });

    it('空章节表 ⇒ 空数组（⛔ 不返回一个 from/to 都 0 的空组）', () => {
        expect(txtVolumeGroups([])).toEqual([]);
    });

    it('组区间无缝且覆盖全部章（不漏章、不重叠）', () => {
        const g = txtVolumeGroups(chaptersOf('序章', '第一章', '第一卷', '第二章', '第二卷', '第三章', '尾声'));
        expect(g[0]?.from).toBe(0);
        g.forEach((cur, i) => {
            expect(cur.to).toBeGreaterThan(cur.from);
            const next = g[i + 1];
            if (next) expect(next.from).toBe(cur.to);
        });
        expect(g[g.length - 1]?.to).toBe(7);
    });

    it('卷标题那一章同时在组内（它是正文内容，不能从章列表里被摘掉）', () => {
        const g = txtVolumeGroups(chaptersOf('第一卷', '第一章'));
        expect(g[0]).toMatchObject({ from: 0, to: 2 }); // 卷头章 0 也属于该组
    });
});

describe('txtVolumeGroups · 不改变 chapters 与下标语义', () => {
    const text = ['书名：测试', '作者：某人', '第一卷 风起', '第一章 相遇', '正文一段。', '第二章 分别', '又一正文。', '第二卷 云涌', '第三章 归来'].join('\n');

    it('投影前后 chapters 的标题与 startPara 完全不变（分组是只读视图）', () => {
        const book = parseTxtBook(text);
        const before = book.chapters.map((c) => `${c.title}@${c.startPara}`);
        txtVolumeGroups(book.chapters);
        const after = book.chapters.map((c) => `${c.title}@${c.startPara}`);
        expect(after).toEqual(before);
    });

    it('组区间内的章下标仍能喂给 chapterParagraphs，取到非空正文', () => {
        const book = parseTxtBook(text);
        const g = txtVolumeGroups(book.chapters);
        // 第 1 组（散章：书名/作者）与第 2 组（第一卷）各取首章
        expect(chapterParagraphs(book, g[0].from).length).toBeGreaterThan(0);
        const vol = g.find((x) => x.title.startsWith('第一卷'));
        expect(vol).toBeTruthy();
        expect(chapterParagraphs(book, vol!.from + 1).join('\n')).toContain('正文一段');
    });

    it('卷头章的标题就是卷标题（高亮当前章时卷头章与卷分组同名，不会指向别的章）', () => {
        const book = parseTxtBook(text);
        const g = txtVolumeGroups(book.chapters);
        const vol = g.find((x) => x.title.startsWith('第一卷'));
        expect(book.chapters[vol!.from]?.title).toBe(vol!.title);
    });
});
