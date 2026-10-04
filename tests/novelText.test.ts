/**
 * `pure/novelText` 单测（#419）—— 正文净化。
 * 样本取自真实书源里那种「广告 / 水印 / 本章完」串（域名与站名换成中性值）。
 */
import { describe, expect, it } from 'vitest';
import { buildFilterRegex, chapterHeading, chapterListLabel, chapterParagraphs, cleanChapterText } from 'pure/novelText';

describe('novelText · filterTxt', () => {
    it('多分支正则（`|`）一次清掉水印与「本章完」', () => {
        const raw = '正文第一段。\n一秒记住【示例阅读】，精彩无弹窗免费阅读！\n正文第二段。(本章完)';
        const out = cleanChapterText(raw, { filterTxt: '一秒记住【示例阅读】，精彩无弹窗免费阅读！|\\(本章完\\)' });
        expect(out.text).toBe('正文第一段。\n\n正文第二段。');
        expect(out.badPattern).toBeUndefined();
    });

    it('🔴 模式里的 `&nbsp;` 能比中文本里的 NBSP（真实书源里就这么写）', () => {
        // DOM 取出的文本里 NBSP 是 \u00a0，而书源写的是字面量 `&nbsp;` ⇒ 不转换就永远比不中
        const raw = '正文\u00a0前。\n一秒记住【示例阅读 】，精彩无弹窗免费阅读！\n正文后。';
        const out = cleanChapterText(raw, { filterTxt: '一秒记住【示例阅读&nbsp;】，精彩无弹窗免费阅读！' });
        expect(out.text).toBe('正文 前。\n\n正文后。');
    });

    it('NBSP 与全角空格一律归一成普通空格', () => {
        expect(cleanChapterText('甲\u00a0乙\u3000丙').text).toBe('甲 乙 丙');
    });

    it('🔴 书源里的正则写坏了 ⇒ **不过滤**、原样保留正文，并把原因回报出来（⛔ 不静默吞掉正文）', () => {
        const raw = '正文第一段。\n正文第二段。';
        const out = cleanChapterText(raw, { filterTxt: '([未闭合' });
        expect(out.text).toBe('正文第一段。\n\n正文第二段。');
        expect(out.badPattern).toBeTruthy();
    });

    it('空 filterTxt ⇒ 不过滤（也不报错）', () => {
        expect(cleanChapterText('甲\n\n乙', { filterTxt: '' }).badPattern).toBeUndefined();
        expect(cleanChapterText('甲\n\n乙').text).toBe('甲\n\n乙');
    });

    it('`buildFilterRegex` 三态：可用 / 空 / 坏', () => {
        expect('re' in buildFilterRegex('a|b')).toBe(true);
        expect(buildFilterRegex('')).toEqual({ error: '' });
        expect('error' in buildFilterRegex('([x')).toBe(true);
    });
});

describe('novelText · 空行与拆段', () => {
    it('多余空行折成一个，行尾空白清掉，首尾空行去掉', () => {
        expect(cleanChapterText('\n\n甲  \n\n\n\n乙\n\n').text).toBe('甲\n\n乙');
    });

    it('`chapterParagraphs` 按空行拆段（段内换行并成一行 —— 网文常把一句掰成两行）', () => {
        expect(chapterParagraphs('甲\n甲续\n\n乙')).toEqual(['甲 甲续', '乙']);
        expect(chapterParagraphs('')).toEqual([]);
        expect(chapterParagraphs('\n\n  \n')).toEqual([]);
    });
});

describe('novelText · 章节标题', () => {
    it('标题自带「第 N 章」时**不重复加**（目录页给的标题常自带序号）', () => {
        expect(chapterHeading(12, '风起')).toBe('第 12 章 风起');
        expect(chapterHeading(12, '第 12 章 风起')).toBe('第 12 章 风起');
        expect(chapterHeading(3, '第三章　雨落')).toBe('第三章　雨落');
        expect(chapterHeading(5, '第 5 节 尾声')).toBe('第 5 节 尾声');
        expect(chapterHeading(1, '楔子')).toBe('第 1 章 楔子');
    });

    it('序号为 0 / 空标题 ⇒ 原样（别造出「第 0 章」）', () => {
        expect(chapterHeading(0, '楔子')).toBe('楔子');
        expect(chapterHeading(1, '   ')).toBe('第 1 章');
    });

    it('列表标签复用同一份口径（UI 与成品头部不许两套）', () => {
        expect(chapterListLabel(2, '风起')).toBe('第 2 章 风起');
        expect(chapterListLabel(2, '第 2 章 风起')).toBe('第 2 章 风起');
    });
});
