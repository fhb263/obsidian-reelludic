// Bangumi 数据源纯逻辑测试（Douban 数据源测试见 douban.test.ts；Google Books/RAWG/Open Library 已随源移除）
import { describe, it, expect } from 'vitest';
import { buildSearchBody, buildBookSearchBody, parseBangumiResults, parseBangumiBookResults, parseBangumiCollections, parseBangumiPersons, BangumiClient, BANGUMI_SEARCH_LIMIT } from 'services/bangumi';

describe('Bangumi 解析', () => {
    it('buildSearchBody 生成搜索请求体（type=2 动画，limit=30 满足"至少 30 条"）', () => {
        const body = JSON.parse(buildSearchBody('葬送的芙莉莲'));
        expect(body.keyword).toBe('葬送的芙莉莲');
        expect(body.type).toBe(2);
        expect(body.limit).toBe(30);
        expect(body.limit).toBe(BANGUMI_SEARCH_LIMIT);
    });

    it('search 走默认 limit=30（不被截断为 10；API 上限 50 + offset 分页）', async () => {
        const bodies: string[] = [];
        const client = new BangumiClient(
            'tok123',
            async () => '{}',
            async (_url, body) => {
                bodies.push(body);
                return '{"data":[],"total":0}';
            },
        );
        await client.search('葬送的芙莉莲');
        expect(JSON.parse(bodies[0]).limit).toBe(30);
        expect(JSON.parse(bodies[0]).limit).not.toBe(10);
    });

    it('解析搜索结果：name_cn 优先、制作公司/年份/封面/标签', () => {
        const text = JSON.stringify({
            data: [
                {
                    id: 302457,
                    name: '葬送のフリーレン',
                    name_cn: '葬送的芙莉莲',
                    date: '2023-09-29',
                    images: { large: 'https://lain.bgm.tv/pic/cover/l/xx.jpg', common: 'https://lain.bgm.tv/pic/cover/c/xx.jpg' },
                    summary: '魔王被打倒后的一千年……',
                    tags: [{ name: '奇幻' }, { name: '治愈' }],
                    infobox: [
                        { key: '话数', value: '28' },
                        { key: '动画制作', value: 'MADHOUSE' },
                    ],
                },
            ],
        });
        const r = parseBangumiResults(text);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            id: 302457,
            title: '葬送的芙莉莲',
            originalTitle: '葬送のフリーレン',
            year: 2023,
            airDate: '2023-09-29',
            genres: ['奇幻', '治愈'],
            studio: 'MADHOUSE',
            cover: 'https://lain.bgm.tv/pic/cover/l/xx.jpg',
        });
        expect(r[0].summary).toContain('魔王被打倒后');
    });

    it('无 name_cn 时回退 name；infobox 结构值（{v:...}）也能提取；空结果安全', () => {
        const text = JSON.stringify({
            data: [
                { id: 1, name: 'Naruto', images: {}, infobox: [{ key: '动画制作', value: { v: 'Studio Pierrot' } }] },
            ],
        });
        const r = parseBangumiResults(text);
        expect(r[0].title).toBe('Naruto');
        expect(r[0].studio).toBe('Studio Pierrot');
        expect(parseBangumiResults('{"data":[]}')).toEqual([]);
    });

    it('testConnection 成功路径带 Bearer token 请求 /v0/me', async () => {
        const client = new BangumiClient(
            'tok123',
            async (url, headers) => {
                expect(url).toContain('/v0/me');
                expect(headers?.Authorization).toBe('Bearer tok123');
                return '{"id":1}';
            },
            async () => '{}',
        );
        await expect(client.testConnection()).resolves.toBeUndefined();
    });

    it('token 无效（401）时 testConnection 抛错', async () => {
        const client = new BangumiClient(
            'bad',
            async () => {
                throw new Error('HTTP 401');
            },
            async () => '{}',
        );
        await expect(client.testConnection()).rejects.toThrow('HTTP 401');
    });

    it('解析用户收藏列表响应：subject 提取 中文名/年份/airDate/评分/封面', () => {
        const json = JSON.stringify({
            data: [
                {
                    type: 2,
                    subject: {
                        id: 123, name: 'Shingeki no Kyojin', name_cn: '进击的巨人',
                        type: 2,
                        date: '2013-04-07', score: 8.5,
                        images: { large: 'https://img.bgm.tv/x.jpg' },
                        summary: '墙外巨人',
                    },
                },
            ],
            total: 1,
        });
        const r = parseBangumiCollections(json);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            id: 123, title: '进击的巨人', originalTitle: 'Shingeki no Kyojin',
            year: 2013, airDate: '2013-04-07', rating: 8.5, cover: 'https://img.bgm.tv/x.jpg', summary: '墙外巨人',
        });
    });

    it('收藏列表：name_cn 缺失回退 name，date 缺失无 airDate', () => {
        const r = parseBangumiCollections(JSON.stringify({ data: [{ subject: { id: 1, name: 'Only JP', type: 2 } }] }));
        expect(r[0].title).toBe('Only JP');
        expect(r[0].airDate).toBeUndefined();
    });

    it('收藏列表：subject.type 映射条目类型（2=动画，6=电影，1/3/4 跳过）', () => {
        const json = JSON.stringify({
            data: [
                { type: 2, subject: { id: 1, name: '动画番', type: 2 } },
                { type: 2, subject: { id: 2, name: '剧场版电影', type: 6 } },
                { type: 2, subject: { id: 3, name: '某本书', type: 1 } },
                { type: 2, subject: { id: 4, name: '某游戏', type: 4 } },
            ],
        });
        const r = parseBangumiCollections(json);
        // 动画与电影保留，书籍/游戏跳过（非动画电影类型不入库）
        expect(r.map((x) => [x.id, x.entryType])).toEqual([
            [1, 'anime'],
            [2, 'movie'],
        ]);
    });
});

describe('Bangumi persons 详情解析（parseBangumiPersons）', () => {
    it('type 为字符串 "1" 也能解析导演/主演/制作公司', () => {
        const text = JSON.stringify({
            data: [
                { id: 1, name: '山田尚子', type: '1', career: ['导演'] },
                { id: 2, name: '茅野爱衣', type: '1', career: ['声优'] },
                { id: 3, name: '京都动画', type: '2', career: ['动画制作'] },
            ],
        });
        const r = parseBangumiPersons(text);
        expect(r.director).toBe('山田尚子');
        expect(r.cast).toEqual(['茅野爱衣']);
        expect(r.studio).toBe('京都动画');
    });

    it('职业「演出」也归为导演（日语系职位）', () => {
        const text = JSON.stringify({
            data: [
                { id: 1, name: 'XX', type: 1, career: ['演出'] },
            ],
        });
        const r = parseBangumiPersons(text);
        expect(r.director).toBe('XX');
    });

    it('无 persons 数据返回空对象', () => {
        expect(parseBangumiPersons('{"data":[]}')).toEqual({});
    });

    it('真实响应形态：裸数组（官方 OpenAPI 200 = RelatedPerson[]，无 data 包装）也能解析导演/主演/公司', () => {
        const text = JSON.stringify([
            { id: 1, name: '渡边信一郎', type: 1, career: ['导演'], relation: '导演', eps: '全话' },
            { id: 2, name: '林原惠', type: 1, career: ['声优'], relation: '出演', eps: '' },
            { id: 3, name: 'SUNRISE', type: 2, career: ['动画制作'], relation: '动画制作', eps: '' },
        ]);
        const r = parseBangumiPersons(text);
        expect(r.director).toBe('渡边信一郎');
        expect(r.cast).toEqual(['林原惠']);
        expect(r.studio).toBe('SUNRISE');
    });

    it('裸数组空响应返回空对象（不因 shape 变化抛错）', () => {
        expect(parseBangumiPersons('[]')).toEqual({});
    });
});

describe('Bangumi 漫画书籍搜索（书籍类目 comic 组主源）', () => {
    it('buildBookSearchBody：type=1（书籍，含漫画），limit 与动画一致', () => {
        const body = JSON.parse(buildBookSearchBody('葬送的芙莉莲'));
        expect(body.keyword).toBe('葬送的芙莉莲');
        expect(body.type).toBe(1);
        expect(body.limit).toBe(30);
        expect(body.limit).toBe(BANGUMI_SEARCH_LIMIT);
    });

    it('parseBangumiBookResults：infobox 作者/译者/出版社/页数 → BookSearchResult（id 带 bangumi: 前缀）', () => {
        const text = JSON.stringify({
            data: [
                {
                    id: 425418,
                    name: '葬送のフリーレン',
                    name_cn: '葬送的芙莉莲',
                    date: '2020-04-17',
                    score: 9.4,
                    images: { large: 'https://lain.bgm.tv/pic/cover/l/manga.jpg' },
                    summary: '勇者一行的后日谈……',
                    tags: [{ name: '漫画' }, { name: '奇幻' }],
                    infobox: [
                        { key: '作者', value: '山田钟人' },
                        { key: '译者', value: '某译' },
                        { key: '出版社', value: '某出版社' },
                        { key: '页数', value: '176' },
                    ],
                },
            ],
        });
        const r = parseBangumiBookResults(text);
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({
            id: 'bangumi:425418',
            title: '葬送的芙莉莲',
            author: '山田钟人',
            translator: '某译',
            publisher: '某出版社',
            pageCount: 176,
            year: 2020,
            genres: ['漫画', '奇幻'],
            rating: 9.4,
            thumbnail: 'https://lain.bgm.tv/pic/cover/l/manga.jpg',
            source: 'bangumi',
        });
        expect(r[0].description).toContain('勇者一行');
    });

    it('rating 对象形态（v0 search 实际返回 s.rating.score/total）也能取到评分与人数', () => {
        const r = parseBangumiBookResults(JSON.stringify({
            data: [{ id: 1, name: 'X', rating: { score: 8.1, total: 520 } }],
        }));
        expect(r[0].rating).toBe(8.1);
        expect(r[0].ratingCount).toBe(520);
    });

    it('infobox 结构值（{v:...}）兼容、name_cn 缺失回退 name、无 name 过滤、空结果安全', () => {
        const r = parseBangumiBookResults(JSON.stringify({
            data: [
                { id: 2, name: 'Only JP', infobox: [{ key: '作者', value: { v: '某作者' } }] },
                { id: 3, images: {} },
            ],
        }));
        expect(r).toHaveLength(1);
        expect(r[0].title).toBe('Only JP');
        expect(r[0].author).toBe('某作者');
        expect(parseBangumiBookResults('{"data":[]}')).toEqual([]);
    });

    it('searchBooks 带 Bearer 头并以 type=1 请求（limit=30）', async () => {
        const bodies: string[] = [];
        const client = new BangumiClient(
            'tok123',
            async () => '{}',
            async (_url, body, headers) => {
                bodies.push(body);
                expect(headers?.Authorization).toBe('Bearer tok123');
                return '{"data":[],"total":0}';
            },
        );
        await client.searchBooks('进击的巨人');
        expect(JSON.parse(bodies[0]).type).toBe(1);
        expect(JSON.parse(bodies[0]).limit).toBe(30);
    });
});
