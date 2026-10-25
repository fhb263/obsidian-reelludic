// #463 「库内检索」共用的同名判定（音频 / 书籍同一份真源）
import { describe, it, expect } from 'vitest';
import { normalizeMatchText, segmentsExactTitle } from 'pure/libraryMatch';

describe('normalizeMatchText（归一：只服务「完全同名」判定）', () => {
    it('小写 + 去空白与常见分隔/标点', () => {
        expect(normalizeMatchText(' 七里香 ')).toBe('七里香');
        expect(normalizeMatchText('Lemon Tree')).toBe('lemontree');
        expect(normalizeMatchText('七里香（Live）')).toBe('七里香live');
        expect(normalizeMatchText('a - b.mp3')).toBe('abmp3');
    });

    it('保留中日韩字符与字母数字本身（⛔ 别把语义字符也去掉）', () => {
        expect(normalizeMatchText('光辉岁月')).toBe('光辉岁月');
        expect(normalizeMatchText('emma-2')).toBe('emma2');
    });

    it('空 / undefined ⇒ 空串', () => {
        expect(normalizeMatchText('')).toBe('');
        expect(normalizeMatchText(undefined as unknown as string)).toBe('');
    });
});

describe('segmentsExactTitle（两段里任一段与标题同名即可）', () => {
    it('`歌手 - 歌名` 与 `歌名 - 歌手` 两种方向都认（库内命名混用）', () => {
        expect(segmentsExactTitle('光辉岁月', 'BEYOND', '光辉岁月')).toBe(true); // 第一段 = 歌名
        expect(segmentsExactTitle('兰亭序', '周杰伦', '兰亭序')).toBe(true); // 第一段 = 歌名（歌名 - 歌手）
        expect(segmentsExactTitle('BEYOND', '光辉岁月', '光辉岁月')).toBe(true); // 第二段 = 歌名
    });

    it('两段都不等于标题 ⇒ false（带版本后缀的也不算同名）', () => {
        expect(segmentsExactTitle('七里香 (Live)', '', '七里香')).toBe(false);
        expect(segmentsExactTitle('兰亭序', '周杰伦', '七里香')).toBe(false);
    });

    it('标题为空 ⇒ false（⛔ 空串不许把任何文件名判成同名）', () => {
        expect(segmentsExactTitle('', '', '')).toBe(false);
        expect(segmentsExactTitle('七里香', '', '   ')).toBe(false);
    });
});
