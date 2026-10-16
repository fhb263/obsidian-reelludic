// 微信读书「书架同步」纯逻辑测试（#581）：响应解析 / 计数口径 / 判重分区 / 条目字段投影
import { describe, it, expect } from 'vitest';
import {
    parseWereadShelf,
    partitionShelfBooks,
    shelfBookEntryFields,
    shelfExtraNote,
    shelfLastReadLabel,
    type WereadShelfBook,
    type WereadShelfStats,
} from 'pure/wereadShelf';
import { WEREAD_READER_PREFIX } from 'pure/weread';

/** 形状照官方 `Tencent/WeChatReading` 的 `skills/shelf.md`（books / albums / mp / archive / bookCount） */
const fixture = {
    errCode: 0,
    bookCount: 3,
    books: [
        {
            bookId: '695233',
            deepLink: 'https://weread.qq.com/book-detail?type=1&v=ce032b305a9bc1ce0b0dd2a',
            title: '三体全集（全三册）',
            author: '刘慈欣',
            cover: 'https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s.jpg',
            category: '文学-科幻',
            readUpdateTime: 1748563200,
            finishReading: 1,
            updateTime: 1740000000,
            isTop: 1,
            secret: 0,
        },
        {
            bookId: '40542611',
            deepLink: 'https://weread.qq.com/book-detail?type=1&v=f6b32840726aa193f6b7e91',
            title: '活着',
            author: '余华',
            cover: 'https://cdn.weread.qq.com/weread/cover/1/yuewen_40542611/s.jpg',
            finishReading: 0,
        },
        { bookId: '999', title: '在读的一本', author: '', cover: '', deepLink: '' },
    ],
    albums: [{ albumInfo: { albumId: 'a1', name: '某有声书' } }],
    mp: {},
    archive: [
        { name: '科幻', bookIds: ['695233'] },
        { name: '待读', bookIds: ['40542611', '695233'] },
    ],
};

describe('parseWereadShelf', () => {
    it('🔴 未登录（errCode -2010）⇒ 失败并给可读文案（与测试连接同一份真源）', () => {
        const r = parseWereadShelf({ errCode: -2010, errMsg: '用户不存在', errLog: 'x', info: '' });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.message).toContain('无效或已过期');
    });

    it('其它错误码：带 errMsg 用它；缺则拼错误码', () => {
        const a = parseWereadShelf({ errCode: -1, errMsg: '系统繁忙' });
        const b = parseWereadShelf({ errCode: -3 });
        expect(a.ok).toBe(false);
        expect(b.ok).toBe(false);
        if (!a.ok) expect(a.message).toBe('系统繁忙');
        if (!b.ok) expect(b.message).toContain('-3');
    });

    it('🔴 `books` 不是数组 ⇒ 如实报「没有书架数据」（⛔ 不静默回空列表）', () => {
        const r = parseWereadShelf({ errCode: 0, bookCount: 2 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.message).toContain('没有书架数据');
    });

    it('形状不对 → 失败（null / 非对象）', () => {
        expect(parseWereadShelf(null).ok).toBe(false);
        expect(parseWereadShelf('x').ok).toBe(false);
    });

    it('抽出条目：title/author/bookId 必备，deepLink→阅读链接，finishReading→finished，cover 只认 http', () => {
        const r = parseWereadShelf(fixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.books).toHaveLength(3);
        expect(r.books[0]).toMatchObject({
            bookId: '695233',
            title: '三体全集（全三册）',
            author: '刘慈欣',
            readUrl: WEREAD_READER_PREFIX + 'ce032b305a9bc1ce0b0dd2a',
            finished: true,
            readUpdateTime: 1748563200,
            category: '文学-科幻',
            archives: ['科幻', '待读'],
        });
        expect(r.books[0].coverUrl).toContain('cdn.weread.qq.com');
        expect(r.books[1].finished).toBe(false);
        // 第三条：cover 是空串 ⇒ 不落键；deepLink 是空串 ⇒ 不落 readUrl；readUpdateTime 缺 ⇒ 不落键
        expect(r.books[2].coverUrl).toBeUndefined();
        expect(r.books[2].readUrl).toBeUndefined();
        expect(r.books[2].readUpdateTime).toBeUndefined();
        expect(r.books[2].archives).toBeUndefined();
    });

    it('🔴 cover 是相对路径 / 非 http ⇒ 丢弃（否则条目里挂一张破图）', () => {
        const r = parseWereadShelf({ errCode: 0, books: [{ bookId: '1', title: 'T', cover: '/cover/1.jpg' }] });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.books[0].coverUrl).toBeUndefined();
    });

    it('逐条容错：坏条目跳过（无 bookId / 无书名）；按 bookId 去重且保序', () => {
        const r = parseWereadShelf({
            errCode: 0,
            books: [
                null,
                { title: '没有 bookId' },
                { bookId: 'A' },
                { bookId: 'A', title: '甲' },
                { bookId: 'A', title: '甲的重复' },
                { bookId: 'B', title: '乙' },
            ],
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.books.map((b) => b.title)).toEqual(['甲', '乙']);
    });

    it('🔴 计数口径 = 官方那张表：books + albums + (mp 非空 ? 1 : 0)', () => {
        const r = parseWereadShelf(fixture);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // fixture 的 mp 是 `{}`（空壳）⇒ **不算**条目
        expect(r.stats).toEqual({ books: 3, albums: 1, hasMp: false, total: 4 });
    });

    it('🔴 `mp` 空壳（{} / [] / ""）不算数；有内容才算（否则书架总数平白 +1）', () => {
        const base = { errCode: 0, books: [] as unknown[] };
        expect((parseWereadShelf({ ...base, mp: {} }) as { stats: WereadShelfStats }).stats.hasMp).toBe(false);
        expect((parseWereadShelf({ ...base, mp: [] }) as { stats: WereadShelfStats }).stats.hasMp).toBe(false);
        expect((parseWereadShelf({ ...base, mp: '' }) as { stats: WereadShelfStats }).stats.hasMp).toBe(false);
        expect((parseWereadShelf({ ...base, mp: false }) as { stats: WereadShelfStats }).stats.hasMp).toBe(false);
        expect((parseWereadShelf({ ...base, mp: { name: '文章收藏' } }) as { stats: WereadShelfStats }).stats.hasMp).toBe(true);
    });

    it('archive 反查：一条书可在多个书单里；坏 archive 条目跳过', () => {
        const r = parseWereadShelf({
            errCode: 0,
            books: [{ bookId: 'X', title: '书' }],
            archive: [null, { name: '' }, { name: '甲', bookIds: ['X', 3] }, { name: '乙', bookIds: ['X'] }],
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.books[0].archives).toEqual(['甲', '乙']);
    });
});

describe('partitionShelfBooks', () => {
    const b = (title: string): WereadShelfBook => ({ bookId: title, title, author: '', finished: false });

    it('🔴 按**书名**判重（库里已有的进 dup）', () => {
        const r = partitionShelfBooks([b('甲'), b('乙'), b('丙')], (t) => t === '乙');
        expect(r.fresh.map((x) => x.title)).toEqual(['甲', '丙']);
        expect(r.dup.map((x) => x.title)).toEqual(['乙']);
    });

    it('空库 ⇒ 全是未导入', () => {
        const r = partitionShelfBooks([b('甲')], () => false);
        expect(r.fresh).toHaveLength(1);
        expect(r.dup).toHaveLength(0);
    });
});

describe('shelfBookEntryFields', () => {
    const base: WereadShelfBook = { bookId: 'X', title: '书', author: '作者', finished: false };

    it('🔴 状态：读完 ⇒ 已读（watched），未读完 ⇒ 在读（watching）', () => {
        expect(shelfBookEntryFields(base).status).toBe('watching');
        expect(shelfBookEntryFields({ ...base, finished: true }).status).toBe('watched');
    });

    it('🔴 readUrl 与 sourceUrl 同值（都是那一页在线阅读页）；来源 = weread', () => {
        const f = shelfBookEntryFields({ ...base, readUrl: WEREAD_READER_PREFIX + 'abc' });
        expect(f).toMatchObject({
            type: 'book',
            title: '书',
            author: '作者',
            source: 'weread',
            readUrl: WEREAD_READER_PREFIX + 'abc',
            sourceUrl: WEREAD_READER_PREFIX + 'abc',
        });
    });

    it('🔴 空字段不落键（空作者 / 无链接 / 无封面 ⇒ undefined，⛔ 不写空串）', () => {
        const f = shelfBookEntryFields({ bookId: 'X', title: '书', author: '', finished: false });
        expect(f.author).toBeUndefined();
        expect(f.readUrl).toBeUndefined();
        expect(f.sourceUrl).toBeUndefined();
        expect(f.poster).toBeUndefined();
    });

    it('🔴 #582 封面一律**升级成大图**（书架给的也是 70×100 缩略）', () => {
        const f = shelfBookEntryFields({
            bookId: 'X',
            title: '书',
            author: '',
            finished: false,
            coverUrl: 'https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s_x.jpg',
        });
        expect(f.poster).toBe('https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s_x.jpg?imageMogr2/thumbnail/600x');
    });

    it('🔴 #582 有详情时合并：简介 / 出版社 / ISBN / 年份 / 分类→题材 / 评分与人数', () => {
        const f = shelfBookEntryFields(base, {
            title: '书名（详情更准）',
            author: '详情作者',
            publisher: '重庆出版社',
            isbn: '9787229030933',
            intro: '简介正文',
            category: '文学-科幻',
            year: 2012,
            rating: 9.3,
            ratingCount: 295468,
        });
        expect(f).toMatchObject({
            title: '书名（详情更准）',
            author: '详情作者',
            publisher: '重庆出版社',
            isbn: '9787229030933',
            summary: '简介正文',
            genres: ['文学-科幻'],
            year: 2012,
            communityScore: 9.3,
            ratingCount: 295468,
        });
    });

    it('🔴 #582 没有详情 / 详情缺字段 ⇒ 回落书架级值（⛔ 不留空键、不写 undefined 覆盖）', () => {
        const noInfo = shelfBookEntryFields(base);
        expect(noInfo.title).toBe('书');
        expect(noInfo.author).toBe('作者');
        expect(noInfo.summary).toBeUndefined();
        expect(noInfo.publisher).toBeUndefined();
        expect(noInfo.genres).toBeUndefined();
        // 详情只给了简介：书名/作者仍回落书架级
        const partial = shelfBookEntryFields(base, { intro: '只有简介' });
        expect(partial.title).toBe('书');
        expect(partial.author).toBe('作者');
        expect(partial.summary).toBe('只有简介');
    });
});

describe('shelfLastReadLabel', () => {
    const b = (readUpdateTime?: number): WereadShelfBook => ({ bookId: 'X', title: '书', author: '', finished: false, readUpdateTime });

    it('🔴 时间戳转 `YYYY-MM-DD`（⛔ 不把原始数字露给用户）；无时间戳 → 空串', () => {
        // 用本地时区构造，避免测试机时区差异
        const local = new Date(2026, 4, 30, 12, 0, 0).getTime() / 1000;
        expect(shelfLastReadLabel(b(local))).toBe('2026-05-30');
        expect(shelfLastReadLabel(b())).toBe('');
        expect(shelfLastReadLabel(b(0))).toBe('');
    });
});

describe('shelfExtraNote', () => {
    it('有专辑 / 文章收藏 ⇒ 说明那句；都没有 ⇒ null', () => {
        expect(shelfExtraNote({ books: 3, albums: 0, hasMp: false, total: 3 })).toBeNull();
        expect(shelfExtraNote({ books: 3, albums: 2, hasMp: false, total: 5 })).toContain('2 个有声专辑');
        expect(shelfExtraNote({ books: 3, albums: 0, hasMp: true, total: 4 })).toContain('文章收藏');
        expect(shelfExtraNote({ books: 3, albums: 1, hasMp: true, total: 5 })).toContain('只导入电子书');
    });
});
