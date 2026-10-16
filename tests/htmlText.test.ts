// HTML 文本还原真源（pure/htmlText）单测 —— #499E 起多了正文级的 `decodeHtmlBlockText`
import { describe, it, expect } from 'vitest';
import { decodeHtmlBlockText, decodeHtmlEntities, decodeHtmlText, stripHtmlTags } from 'pure/htmlText';

describe('decodeHtmlText / stripHtmlTags / decodeHtmlEntities（既有口径）', () => {
    it('短标题：剥标签 → 还原实体 → 折空白', () => {
        expect(decodeHtmlText('  <em class="keyword">晴</em>&nbsp;天  ')).toBe('晴 天');
    });

    it('🔴 剥标签与还原实体是两件事：`&lt;em&gt;` 还原后不该再被当标签剥掉', () => {
        expect(stripHtmlTags('&lt;em&gt;')).toBe('&lt;em&gt;');
        expect(decodeHtmlEntities('&lt;em&gt;')).toBe('<em>');
    });
});

describe('decodeHtmlBlockText（正文级：块级标签当换行）', () => {
    it('🔴 `<p>` 段落之间要有分隔 —— 直接剥标签会把两段首尾粘成一个词（英文最明显）', () => {
        expect(decodeHtmlBlockText('<p>end.</p><p>Next</p>')).toBe('end. Next');
        // ⛔ 反例（这条就是「只剥标签」的产物，本函数存在的理由）
        expect(stripHtmlTags('<p>end.</p><p>Next</p>')).toBe('end.Next');
    });

    it('`<br>` / `</li>` / `</h1>` 同样当分隔；连续空白折成一个空格', () => {
        expect(decodeHtmlBlockText('甲<br>乙')).toBe('甲 乙');
        expect(decodeHtmlBlockText('<li>一</li><li>二</li>')).toBe('一 二');
        expect(decodeHtmlBlockText('<h2>标题</h2>\n\n  正文')).toBe('标题 正文');
    });

    it('实体照旧还原（顺序仍是：块级标签→空格、剥标签、还原实体、折空白）', () => {
        expect(decodeHtmlBlockText('<p>甲 &amp; 乙</p><p>丙</p>')).toBe('甲 & 乙 丙');
    });

    it('行内标签不该被当分隔（`<b>` / `<span>` 是同一句话里的强调）', () => {
        expect(decodeHtmlBlockText('沙<b>丘</b>二')).toBe('沙丘二');
    });
});
