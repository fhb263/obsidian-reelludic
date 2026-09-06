// 卡片元信息文本（pure/cardMeta）单测 — 海报墙占位防错位
// 卡片网格同列依赖 subtitle/creator 两行高度一致，数据缺失返回「—」占位
// 保持行占位，避免同列卡片错位。
import { describe, it, expect } from 'vitest';
import { cardSubtitle, hasCardSubtitle, cardCreator, hasCardCreator, cardGenres, hasCardGenres } from 'pure/cardMeta';
import type { MediaEntry } from 'data/types';

/** 最小化构造器：测试只关心参与分支的字段，其余走 default 填充 */
function entry(partial: Partial<MediaEntry>): MediaEntry {
    const base: MediaEntry = {
        id: 'e1',
        type: 'movie',
        title: 'X',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
    };
    return { ...base, ...partial };
}

describe('cardSubtitle 卡片副行（年份槽）', () => {
    it('电影有年份：返回年份字符串', () => {
        expect(cardSubtitle(entry({ type: 'movie', year: 2004 }))).toBe('2004');
    });

    it('电影无年份：返回占位符「—」（防止同行卡片错位）', () => {
        expect(cardSubtitle(entry({ type: 'movie' }))).toBe('—');
    });

    it('电视剧无年份同样占位（覆盖另一影视类型）', () => {
        expect(cardSubtitle(entry({ type: 'tv' }))).toBe('—');
    });

    it('音乐：专辑 + 年份拼接', () => {
        const m = entry({ type: 'music', album: 'Album X', year: 2020 });
        expect(cardSubtitle(m)).toBe('Album X · 2020');
    });

    it('音乐仅有专辑：仅返回专辑', () => {
        const m = entry({ type: 'music', album: 'Album X' });
        expect(cardSubtitle(m)).toBe('Album X');
    });

    it('音乐仅有年份：仅返回年份', () => {
        const m = entry({ type: 'music', year: 2020 });
        expect(cardSubtitle(m)).toBe('2020');
    });

    it('音乐无专辑无年份：返回占位符「—」', () => {
        expect(cardSubtitle(entry({ type: 'music' }))).toBe('—');
    });

    it('书籍无年份同样占位（书籍常见无豆瓣年份）', () => {
        expect(cardSubtitle(entry({ type: 'book' }))).toBe('—');
    });
});

describe('hasCardSubtitle 副行是否为真实内容（用于决定 title tooltip 是否设置）', () => {
    it('电影有年份 → true', () => {
        expect(hasCardSubtitle(entry({ type: 'movie', year: 2004 }))).toBe(true);
    });

    it('电影无年份 → false', () => {
        expect(hasCardSubtitle(entry({ type: 'movie' }))).toBe(false);
    });

    it('音乐有任一字段 → true', () => {
        expect(hasCardSubtitle(entry({ type: 'music', album: 'A' }))).toBe(true);
        expect(hasCardSubtitle(entry({ type: 'music', year: 2020 }))).toBe(true);
    });

    it('音乐全无 → false', () => {
        expect(hasCardSubtitle(entry({ type: 'music' }))).toBe(false);
    });
});

describe('cardCreator 卡片创作者行（导演 / 作者 / 开发商槽）', () => {
    it('有导演：返回导演', () => {
        expect(cardCreator(entry({ director: '克里斯托弗·诺兰' }))).toBe('克里斯托弗·诺兰');
    });

    it('无导演有作者：回退作者（书籍）', () => {
        expect(cardCreator(entry({ type: 'book', author: '东野圭吾' }))).toBe('东野圭吾');
    });

    it('无导演无作者有开发商：回退开发商（游戏）', () => {
        expect(cardCreator(entry({ type: 'game', developer: 'FromSoftware' }))).toBe('FromSoftware');
    });

    it('书籍同时有作者与导演：导演优先（先匹配先返回）', () => {
        expect(cardCreator(entry({ type: 'book', director: '某导演', author: '某作者' }))).toBe('某导演');
    });

    it('全无：返回占位符「—」（防错位核心场景）', () => {
        expect(cardCreator(entry({ type: 'movie' }))).toBe('—');
    });
});

describe('hasCardCreator 创作者行是否为真实内容', () => {
    it('有任一字段 → true', () => {
        expect(hasCardCreator(entry({ director: 'X' }))).toBe(true);
        expect(hasCardCreator(entry({ author: 'X' }))).toBe(true);
        expect(hasCardCreator(entry({ developer: 'X' }))).toBe(true);
    });

    it('全无 → false', () => {
        expect(hasCardCreator(entry({ type: 'movie' }))).toBe(false);
    });
});

describe('cardGenres 卡片题材行（genres 前 2 个）', () => {
    it('有题材：前 2 个以「 · 」连接', () => {
        expect(cardGenres(entry({ type: 'anime', genres: ['战斗', '奇幻'] }))).toBe('战斗 · 奇幻');
    });

    it('超过 2 个题材：只取前 2 个', () => {
        expect(cardGenres(entry({ genres: ['剧情', '喜剧', '犯罪'] }))).toBe('剧情 · 喜剧');
    });

    it('题材为空：返回占位符「—」（与作者/年份占位同款，保持行占位）', () => {
        expect(cardGenres(entry({ type: 'anime' }))).toBe('—');
    });
});

describe('hasCardGenres 题材行是否为真实内容', () => {
    it('有题材 → true', () => {
        expect(hasCardGenres(entry({ genres: ['冒险'] }))).toBe(true);
    });

    it('题材为空 → false', () => {
        expect(hasCardGenres(entry({ type: 'anime' }))).toBe(false);
    });
});