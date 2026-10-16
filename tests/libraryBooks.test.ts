import { describe, expect, it } from 'vitest';
import {
    LIBRARY_BOOK_MIN_SCORE,
    bookFileStem,
    isAssociableBookPath,
    pickLibraryBook,
    scoreLibraryBook,
    splitBookStem,
} from 'pure/libraryBooks';
import { LIBRARY_AUDIO_MIN_SCORE } from 'pure/libraryAudio';

// #417「在库里找回同名书籍文件」（书籍「书籍文件」浮层那枚 🔍）。

const file = (name: string, path = `下载/书籍/${name}`) => ({ path, name });

describe('libraryBooks · 可关联书籍文件', () => {
    it('白名单走 `downloadPlan` 的书籍名单（epub / pdf / txt 等），音频 / 图片 / 无扩展名都不算', () => {
        expect(isAssociableBookPath('下载/书籍/红楼梦.epub')).toBe(true);
        expect(isAssociableBookPath('书/某书.PDF')).toBe(true);
        expect(isAssociableBookPath('书/某书.txt')).toBe(true);
        expect(isAssociableBookPath('书/某书.mobi')).toBe(true);
        expect(isAssociableBookPath('下载/音乐/某歌.mp3')).toBe(false);
        expect(isAssociableBookPath('封面/某书.jpg')).toBe(false);
        expect(isAssociableBookPath('书/没有扩展名')).toBe(false);
    });

    it('去扩展名：只认最后一个点；无扩展名 / 以点开头的隐藏名 ⇒ 原名', () => {
        expect(bookFileStem('红楼梦 - 曹雪芹.epub')).toBe('红楼梦 - 曹雪芹');
        expect(bookFileStem('某书.PDF')).toBe('某书');
        expect(bookFileStem('没有扩展名')).toBe('没有扩展名');
        expect(bookFileStem('.epub')).toBe('.epub');
    });

    it('🔴 按「**书名** - 作者」切（与音频相反；切最后那个 ` - `，切不出就整段当书名）', () => {
        expect(splitBookStem('红楼梦 - 曹雪芹.epub')).toEqual({ title: '红楼梦', author: '曹雪芹' });
        expect(splitBookStem('红楼梦.epub')).toEqual({ title: '红楼梦', author: '' });
        // 书名自己带 ` - `：只切最后一个（作者段仍能取到）
        expect(splitBookStem('A - B - C.epub')).toEqual({ title: 'A - B', author: 'C' });
        // 任一侧为空 ⇒ 不切，整段当书名
        expect(splitBookStem(' - 曹雪芹.epub')).toEqual({ title: '- 曹雪芹', author: '' });
    });
});

describe('libraryBooks · 打分与挑选', () => {
    it('标题为空 ⇒ -1（调用方据此提示「先填标题」）', () => {
        expect(scoreLibraryBook(file('红楼梦.epub'), '', '曹雪芹')).toBe(-1);
        expect(scoreLibraryBook(file('红楼梦.epub'), '   ', '')).toBe(-1);
    });

    it('同名文件打到阈值之上；无关文件落到阈值之下（⛔ 不拿条目作者去补，否则别的书也会凑够分）', () => {
        expect(scoreLibraryBook(file('红楼梦 - 曹雪芹.epub'), '红楼梦', '曹雪芹')).toBeGreaterThanOrEqual(LIBRARY_BOOK_MIN_SCORE);
        expect(scoreLibraryBook(file('红楼梦.epub'), '红楼梦', '曹雪芹')).toBeGreaterThanOrEqual(LIBRARY_BOOK_MIN_SCORE);
        // 完全无关的书：分数为负 ⇒ 不会被当成命中
        expect(scoreLibraryBook(file('别的一本书.epub'), '红楼梦', '曹雪芹')).toBeLessThan(LIBRARY_BOOK_MIN_SCORE);
        expect(pickLibraryBook([file('别的一本书.epub')], '红楼梦', '曹雪芹').best).toBeNull();
    });

    it('阈值与音频侧同值（两处理由相同：容得下副题 / 版本后缀，又不至于乱命中）', () => {
        expect(LIBRARY_BOOK_MIN_SCORE).toBe(LIBRARY_AUDIO_MIN_SCORE);
    });

    it('挑选：分数降序、同分按路径字典序（结果稳定可断言），`best` = 榜首', () => {
        const files = [
            file('红楼梦.epub', 'z/红楼梦.epub'),
            file('红楼梦 - 曹雪芹.epub', 'a/红楼梦 - 曹雪芹.epub'),
            file('无关.epub', 'b/无关.epub'),
        ];
        const { best, ranked } = pickLibraryBook(files, '红楼梦', '曹雪芹');
        expect(ranked).toHaveLength(2); // 「无关」被阈值滤掉
        expect(best?.path).toBe(ranked[0].path);
        for (let i = 1; i < ranked.length; i++) {
            expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
        }
        // 同分时按路径排（构造两个同名不同目录的候选）
        const tie = pickLibraryBook([file('某书.epub', 'b/某书.epub'), file('某书.epub', 'a/某书.epub')], '某书', '');
        expect(tie.ranked.map((m) => m.path)).toEqual(['a/某书.epub', 'b/某书.epub']);
    });

    it('空清单 / 全是无关文件 ⇒ best 为 null（调用方据此区分「库里没书」与「没找到同名的」）', () => {
        expect(pickLibraryBook([], '红楼梦', '曹雪芹')).toEqual({ best: null, ranked: [] });
        const { best, ranked } = pickLibraryBook([file('别的.epub'), file('再别的.pdf')], '红楼梦', '曹雪芹');
        expect(best).toBeNull();
        expect(ranked).toEqual([]);
    });

    // 🔴 #463：与音频侧同一个坑（只按分数排 ⇒ 同分靠路径字典序碰运气）
    describe('#463 同名优先（分数只是第二关键字）', () => {
        it('🔴 同分现场：无关文件里「条目作者落在书名槽」⇒ 与正确文件同分，必须选**同名的**那条', () => {
            // 正确：某书.epub（书名段 == 条目标题）；
            // 干扰：某某 - 别的.epub（条目作者「某某」落进了**书名槽**，白拿同样两项加分 ⇒ 同分）
            const files463 = [file('某某 - 别的.epub'), file('某书.epub')];
            const r = pickLibraryBook(files463, '某书', '某某');
            expect(r.ranked.map((m) => Math.round(m.score * 10) / 10)).toEqual([74.8, 74.8]); // 先确认「分数分不出来」
            expect(r.best?.name).toBe('某书.epub');
            expect(r.ranked[0].exact).toBe(true);
            expect(r.ranked[1].exact).toBe(false);
        });

        it('「书名 - 作者」命名下书名段同名也算同名（库内命名方向不统一，两向都认）', () => {
            const r = pickLibraryBook([file('红楼梦 - 曹雪芹.epub'), file('无关.epub')], '红楼梦', '曹雪芹');
            expect(r.best?.name).toBe('红楼梦 - 曹雪芹.epub');
            expect(r.ranked[0].exact).toBe(true);
        });

        it('同名的两条**分数也相同**时，退回路径字典序（结果依旧稳定）', () => {
            const tie = pickLibraryBook([file('某书.epub', 'b/某书.epub'), file('某书.epub', 'a/某书.epub')], '某书', '');
            expect(tie.ranked.map((m) => m.path)).toEqual(['a/某书.epub', 'b/某书.epub']);
        });
    });
});
