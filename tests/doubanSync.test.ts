// 豆瓣「我的收藏」同步 —— 纯解析与映射（#662）
// 契约来源：用户「豆瓣凭据入口再添加个同步导入按钮」→「导入曾标记想读在读等的条目」
// 数据形态取自参考实现 Wanxp/obsidian-douban 的收藏列表页（`/people/{uid}/{doType}?mode=list`）
import { describe, expect, it } from 'vitest';
import {
    DOUBAN_KIND_DOMAIN,
    DOUBAN_PAGE_SIZE,
    decodeEntities,
    doubanCollectionUrl,
    doubanRatingToEntryRating,
    doubanStateLabel,
    doubanStateToStatus,
    doubanSubjectUrl,
    doubanItemKey,
    doubanSyncJobs,
    doubanUserIdFromCookie,
    normalizeDate,
    parseDoubanCollectionItem,
    parseDoubanCollectionPage,
} from 'pure/doubanSync';

/** 造一块 `.item-show`（结构照抄豆瓣 mode=list 的经典形态） */
function block(id: number, title: string, opts: { rating?: number; date?: string; comment?: string } = {}): string {
    const rating = opts.rating ? `<span class="rating${opts.rating}-t"></span>` : '';
    const date = opts.date ? `<div class="date">${opts.date}</div>` : '';
    const cmt = opts.comment ? `<span class="comment">${opts.comment}</span>` : '';
    return `<div class="item-show"><div class="title"><a href="https://movie.douban.com/subject/${id}/">${title}</a></div>${rating}${date}${cmt}</div>`;
}

describe('doubanSync · 列表页解析', () => {
    it('正常页：解析出 id / 标题 / 评分 / 标记时间', () => {
        const html = `<span class="subject-num">1/234</span>` + block(1292052, '肖申克的救赎', { rating: 5, date: '2020-03-15' }) + block(1291546, '霸王别姬', { rating: 4, date: '2019-11-02' });
        const page = parseDoubanCollectionPage(html);
        expect(page.total).toBe(234);
        expect(page.items).toHaveLength(2);
        expect(page.items[0]).toMatchObject({ id: '1292052', title: '肖申克的救赎', rating: 5, markedAt: '2020-03-15' });
        expect(page.items[1]).toMatchObject({ id: '1291546', rating: 4 });
    });

    it('短评与实体：`&amp;` / `&#39;` 解码、`<span class="comment">` 取出', () => {
        // ⚠️ id 必须是 5~10 位（豆瓣真实 id 形态）；用 1 位数会撞 `\d{5,10}` 的判据，
        //    从而被当成"认不出的块"跳过 —— 本批第一版就是拿 1 位数当夹具假红了一次。
        const html = block(1234567, 'Tom &amp; Jerry&#39;s', { comment: '很好看 &lt;3' });
        const it = parseDoubanCollectionItem(html);
        expect(it?.title).toBe("Tom & Jerry's");
        expect(it?.comment).toBe('很好看 <3');
    });

    it('🔴 认不出的块**跳过**而不是抛错（豆瓣改版不该让整次同步崩掉）', () => {
        const html =
            `<div class="item-show"><div class="title">没有链接</div></div>` +
            block(1234567, '正常条目') +
            `<div class="item-show"><div class="title"><a href="/no-id-here/">空标题</a></div></div>`;
        const page = parseDoubanCollectionPage(html);
        expect(page.items.map((i) => i.id)).toEqual(['1234567']);
    });

    it('没打分 ⇒ rating 0（不是 NaN / undefined）', () => {
        expect(parseDoubanCollectionItem(block(1234567, 'x'))?.rating).toBe(0);
    });

    it('空页 / 非收藏页 ⇒ 0 条 0 总数（不抛）', () => {
        expect(parseDoubanCollectionPage('')).toEqual({ items: [], total: 0 });
        expect(parseDoubanCollectionPage('<html><body>登录</body></html>').items).toHaveLength(0);
    });
});

describe('doubanSync · 日期与评分', () => {
    it('日期归一成 YYYY-MM-DD（月日补零）；认不出 ⇒ null', () => {
        expect(normalizeDate('2020-3-5')).toBe('2020-03-05');
        expect(normalizeDate('2020/03/05 12:34')).toBe('2020-03-05');
        expect(normalizeDate('昨天')).toBeNull();
    });

    it('评分收敛到 0~5 的整数', () => {
        expect(doubanRatingToEntryRating(4)).toBe(4);
        expect(doubanRatingToEntryRating(0)).toBe(0);
        expect(doubanRatingToEntryRating(9)).toBe(5);
        expect(doubanRatingToEntryRating(Number.NaN)).toBe(0);
    });
});

describe('doubanSync · 地址与用户 ID', () => {
    it('收藏页地址：影视/书籍/音乐走**子域**，游戏走 www + action 参数', () => {
        expect(doubanCollectionUrl('movie', 'abc', 'wish', 0)).toBe(
            'https://movie.douban.com/people/abc/wish?start=0&sort=time&rating=all&filter=all&mode=list',
        );
        expect(doubanCollectionUrl('book', 'abc', 'do', 15)).toContain('https://book.douban.com/people/abc/do?start=15');
        expect(doubanCollectionUrl('game', 'abc', 'collect', 30)).toBe(
            'https://www.douban.com/people/abc/games?start=30&sort=time&rating=all&filter=all&mode=list&action=collect',
        );
        expect(DOUBAN_KIND_DOMAIN.game).toBe('www');
        expect(DOUBAN_PAGE_SIZE).toBe(15);
    });

    it('🔴 用户 ID 从 Cookie 的 `dbcl2` 认（引号可有可无）—— 用户不必再填一遍', () => {
        expect(doubanUserIdFromCookie('bid=x; dbcl2="123456789:AbCdEf"; ll="118254"')).toBe('123456789');
        expect(doubanUserIdFromCookie('dbcl2=987654321:zzz')).toBe('987654321');
        expect(doubanUserIdFromCookie('bid=x; ll="118254"')).toBeNull();
    });

    it('条目网址 = 详情页（也是判重键：sourceUrl 里带 /subject/<id>/）', () => {
        expect(doubanSubjectUrl('book', '1084336')).toBe('https://book.douban.com/subject/1084336/');
    });
});

describe('doubanSync · 一键读取全部（#663）', () => {
    it('「全部」= 4 类 × 3 状态 = 12 个任务，顺序固定', () => {
        const jobs = doubanSyncJobs();
        expect(jobs).toHaveLength(12);
        expect(jobs[0]).toMatchObject({ kind: 'movie', state: 'wish' });
        expect(jobs[11]).toMatchObject({ kind: 'game', state: 'collect' });
        // 每项都带可读标签（进度文案直接用它）
        for (const j of jobs) expect(j.label).toContain('·');
    });

    it('🔴 去重键带类型前缀：豆瓣各站点 subject 编号相互独立，裸 id 会把「同号电影」和「同号书」误合并', () => {
        expect(doubanItemKey('movie', '1292052')).toBe('movie:1292052');
        expect(doubanItemKey('book', '1292052')).not.toBe(doubanItemKey('movie', '1292052'));
        const seen = new Set([doubanItemKey('movie', '1'), doubanItemKey('book', '1')]);
        expect(seen.size).toBe(2);
    });
});

describe('doubanSync · 状态映射', () => {
    it('wish → want / do → watching / collect → watched（三态一一对应）', () => {
        expect(doubanStateToStatus('movie', 'wish')).toBe('want');
        expect(doubanStateToStatus('movie', 'do')).toBe('watching');
        expect(doubanStateToStatus('movie', 'collect')).toBe('watched');
    });

    it('展示名按类型微调：书籍是「想读 / 在读 / 读过」，音乐是「想听」，游戏是「想玩」', () => {
        expect(doubanStateLabel('book', 'wish')).toBe('想读');
        expect(doubanStateLabel('book', 'do')).toBe('在读');
        expect(doubanStateLabel('music', 'wish')).toBe('想听');
        expect(doubanStateLabel('game', 'collect')).toBe('玩过');
        expect(doubanStateLabel('movie', 'collect')).toBe('看过');
    });

    it('实体解码：名字实体与数字实体都认（⛔ 不引第三方库）', () => {
        expect(decodeEntities('a&amp;b')).toBe('a&b');
        expect(decodeEntities('&#39;x&#39;')).toBe("'x'");
        expect(decodeEntities('&#x4E2D;')).toBe('中');
        expect(decodeEntities('&nbsp;')).toBe(' ');
    });
});
