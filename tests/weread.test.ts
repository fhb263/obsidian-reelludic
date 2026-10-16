// 微信读书检索纯逻辑测试（#529）：检索词 / URL / deepLink→hash / 解析容错
// ＋ #580 授权（Cookie 归一 / 书架鉴权判定）与「候选 → 书籍搜索结果」投影
import { describe, it, expect } from 'vitest';
import {
    buildWereadQuery,
    buildWereadSearchUrl,
    readerHashFromDeepLink,
    wereadReaderUrl,
    parseWereadSearch,
    WEREAD_READER_PREFIX,
    WEREAD_SEARCH_URL,
    buildWereadShelfUrl,
    normalizeWereadCookie,
    hasWereadAuth,
    parseWereadShelfAuth,
    toWereadBookResult,
    WEREAD_SHELF_URL,
    upgradeWereadCover,
    buildWereadBookInfoUrl,
    parseWereadBookInfo,
    WEREAD_COVER_QUERY,
} from 'pure/weread';

describe('buildWereadQuery', () => {
    it('书名 + 作者（去掉两端空白）', () => {
        expect(buildWereadQuery('  三体 ', ' 刘慈欣 ')).toBe('三体 刘慈欣');
    });
    it('无作者 → 只书名；书名空 → 退而用作者', () => {
        expect(buildWereadQuery('活着')).toBe('活着');
        expect(buildWereadQuery('', '余华')).toBe('余华');
        expect(buildWereadQuery('   ')).toBe('');
    });
});

describe('buildWereadSearchUrl', () => {
    it('带 keyword / maxIdx / frenum / fragment，且 keyword 已编码', () => {
        const url = buildWereadSearchUrl('三体 刘慈欣');
        expect(url.startsWith(WEREAD_SEARCH_URL + '?')).toBe(true);
        expect(url).toContain('keyword=%E4%B8%89%E4%BD%93+%E5%88%98%E6%85%88%E6%AC%A3');
        expect(url).toContain('maxIdx=0');
        expect(url).toContain('frenum=20');
        expect(url).toContain('fragment=100');
    });
});

describe('readerHashFromDeepLink / wereadReaderUrl', () => {
    it('从 deepLink 的 v 参数取 hash', () => {
        expect(readerHashFromDeepLink('https://weread.qq.com/book-detail?type=1&v=ce032b305a9bc1ce0b0dd2a'))
            .toBe('ce032b305a9bc1ce0b0dd2a');
        // v 在首位（无前导 &）也要认
        expect(readerHashFromDeepLink('https://x/?v=abc123')).toBe('abc123');
    });
    it('非字符串 / 无 v 参数 → undefined', () => {
        expect(readerHashFromDeepLink(undefined)).toBeUndefined();
        expect(readerHashFromDeepLink(123)).toBeUndefined();
        expect(readerHashFromDeepLink('https://weread.qq.com/book-detail')).toBeUndefined();
    });
    it('hash → 阅读链接（前缀固定）', () => {
        expect(wereadReaderUrl('ce032b305a9bc1ce0b0dd2a'))
            .toBe(WEREAD_READER_PREFIX + 'ce032b305a9bc1ce0b0dd2a');
    });
});

describe('parseWereadSearch', () => {
    // 形状照 2026-10-05 探针实测（三体全集 那一条）
    const fixture = {
        totalCount: 58,
        hasMore: 1,
        books: [
            {
                bookInfo: {
                    bookId: '695233',
                    deepLink: 'https://weread.qq.com/book-detail?type=1&v=ce032b305a9bc1ce0b0dd2a',
                    title: '三体全集（全三册）',
                    author: '刘慈欣',
                    cover: 'https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s.jpg',
                    intro: '【荣获世界科幻大奖…】每个人的书架上都该有套《三体》！',
                    publisher: '重庆出版社',
                    newRating: 930,
                    newRatingCount: 295468,
                },
            },
            {
                bookInfo: {
                    bookId: '40542611',
                    deepLink: 'https://weread.qq.com/book-detail?type=1&v=f6b32840726aa193f6b7e91',
                    title: '三体：史上最称职的面壁者',
                    author: '火炀',
                },
            },
        ],
    };

    it('抽出候选：title/author/readUrl 必备，评分按 /100 归一', () => {
        const list = parseWereadSearch(fixture);
        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({
            title: '三体全集（全三册）',
            author: '刘慈欣',
            readUrl: WEREAD_READER_PREFIX + 'ce032b305a9bc1ce0b0dd2a',
            publisher: '重庆出版社',
            rating: 9.3,
            ratingCount: 295468,
        });
        expect(list[0].coverUrl).toContain('cdn.weread.qq.com');
        expect(list[1].rating).toBeUndefined(); // 缺 newRating → 不带
    });

    it('🔴 无 deepLink（拼不出阅读链接）的条目被跳过', () => {
        const raw = { books: [{ bookInfo: { title: '公众号文章' } }, { bookInfo: { deepLink: 'https://x/?type=1' } }] };
        expect(parseWereadSearch(raw)).toEqual([]);
    });

    it('形状不对 → []（null / 非对象 / books 非数组）', () => {
        expect(parseWereadSearch(null)).toEqual([]);
        expect(parseWereadSearch('x')).toEqual([]);
        expect(parseWereadSearch({})).toEqual([]);
        expect(parseWereadSearch({ books: 'nope' })).toEqual([]);
    });

    it('逐条容错：坏条目跳过、好条目保留；按 readUrl 去重', () => {
        const dup = 'https://weread.qq.com/book-detail?type=1&v=hashA';
        const raw = {
            books: [
                null,
                { bookInfo: { deepLink: dup, title: '甲' } },
                { bookInfo: { deepLink: dup, title: '甲的重复' } },
                { bookInfo: { deepLink: 'https://weread.qq.com/book-detail?v=hashB', title: '' } },
                { bookInfo: { deepLink: 'https://weread.qq.com/book-detail?v=hashC', title: '丙' } },
            ],
        };
        const list = parseWereadSearch(raw);
        expect(list.map((x) => x.title)).toEqual(['甲', '丙']); // 重复的只留一条；空标题跳过
    });

    // 🔴 #609 翻面：**解析层不再截断**（原 `INTRO_MAX = 120` 已删）——
    //    截断只该发生在**显示层**。原因：回填进条目的简介要**全文**，
    //    在解析层截掉 ⇒ 无论选哪条、简介天生就是残缺的（用户报的「回填原信息不全」之一）。
    it('长简介**保留全文**（⛔ 不在解析层截断 —— 截断留给显示层）', () => {
        const long = 'x'.repeat(200);
        const raw = { books: [{ bookInfo: { deepLink: 'https://x/?v=h', title: 't', intro: long } }] };
        const intro = parseWereadSearch(raw)[0].intro ?? '';
        expect(intro).toBe(long); // 200 字一字不少
        expect(intro.endsWith('…')).toBe(false);
    });

    it('🔴 #609：数字 `bookId` 原样带上（它是逐本拉 `/web/book/info` 补详情的唯一钥匙）', () => {
        const raw = { books: [{ bookInfo: { deepLink: 'https://x/?v=h', title: 't', bookId: '750578' } }] };
        expect(parseWereadSearch(raw)[0].bookId).toBe('750578');
    });

    it('无 `bookId` ⇒ 不落这个键（缺了就只能靠搜索级字段，详情拉取自然跳过）', () => {
        const raw = { books: [{ bookInfo: { deepLink: 'https://x/?v=h', title: 't' } }] };
        expect('bookId' in parseWereadSearch(raw)[0]).toBe(false);
    });

    it('🔴 #609：封面在**解析层**就升级 ⇒ 两条路（数据源结果 / 「检索在线书籍阅读」浮层）都拿大图', () => {
        // 浮层直接渲染 `candidate.coverUrl` —— 若只在 `toWereadBookResult` 升级，那一处必糊（70×101 原图）
        const raw = { books: [{ bookInfo: { deepLink: 'https://x/?v=h', title: 't', cover: 'https://wfqqreader.qq.com/cover/1' } }] };
        expect(parseWereadSearch(raw)[0].coverUrl).toBe(`https://wfqqreader.qq.com/cover/1?${WEREAD_COVER_QUERY}`);
    });
});

// ────────────────────────── #580 授权（Cookie）与书架鉴权 ──────────────────────────

describe('buildWereadShelfUrl', () => {
    it('默认游标 0；显式传值原样带上（增量同步）', () => {
        expect(buildWereadShelfUrl()).toBe(`${WEREAD_SHELF_URL}?synckey=0&lectureSynckey=0`);
        expect(buildWereadShelfUrl(12, 34)).toBe(`${WEREAD_SHELF_URL}?synckey=12&lectureSynckey=34`);
    });
});

describe('normalizeWereadCookie', () => {
    it('剥掉整段粘贴带的 `Cookie: ` 前缀', () => {
        expect(normalizeWereadCookie('Cookie: wr_vid=1; wr_skey=2')).toBe('wr_vid=1; wr_skey=2');
        expect(normalizeWereadCookie('cookie:wr_vid=1')).toBe('wr_vid=1');
    });
    it('🔴 多行粘贴折成 `; ` 分隔（⛔ 不是空格 —— 否则整段会被当成一个 cookie、后续键全丢）', () => {
        expect(normalizeWereadCookie('wr_vid=1\nwr_skey=2')).toBe('wr_vid=1; wr_skey=2');
        // 行尾本来已带 `;` 的形态：折行后不得出现 `;;`
        expect(normalizeWereadCookie('wr_vid=1;\r\nwr_skey=2')).toBe('wr_vid=1; wr_skey=2');
    });
    it('压掉重复分隔符 / 多余空白 / 收尾分号', () => {
        expect(normalizeWereadCookie('  a=1  ;;  b=2 ; ')).toBe('a=1; b=2');
    });
    it('非字符串 / 空 → 空串', () => {
        expect(normalizeWereadCookie(undefined)).toBe('');
        expect(normalizeWereadCookie(123)).toBe('');
        expect(normalizeWereadCookie('   ')).toBe('');
    });
});

describe('hasWereadAuth', () => {
    it('归一到空 ⇒ false；有内容 ⇒ true', () => {
        expect(hasWereadAuth('')).toBe(false);
        expect(hasWereadAuth('  ')).toBe(false);
        expect(hasWereadAuth(undefined)).toBe(false);
        expect(hasWereadAuth('wr_vid=1')).toBe(true);
    });
});

describe('parseWereadShelfAuth', () => {
    it('errCode === 0 → 成功', () => {
        const r = parseWereadShelfAuth(JSON.stringify({ errCode: 0, books: [] }));
        expect(r.ok).toBe(true);
        expect(r.message).toContain('Cookie 有效');
    });
    it('🔴 未登录（errCode -2010，HTTP 200）→ 失败，如实说「无效或过期」', () => {
        const r = parseWereadShelfAuth('{"errCode":-2010,"errMsg":"用户不存在","errLog":"…","info":""}');
        expect(r.ok).toBe(false);
        expect(r.message).toContain('无效或已过期');
    });
    it('其它错误码：带 errMsg 用它，缺则拼错误码', () => {
        expect(parseWereadShelfAuth('{"errCode":-1,"errMsg":"系统繁忙"}').message).toBe('系统繁忙');
        expect(parseWereadShelfAuth('{"errCode":-3}').message).toContain('-3');
        expect(parseWereadShelfAuth('{"errCode":-3}').ok).toBe(false);
    });
    it('🔴 没有 errCode（上游换字段名）→ 退看 books 数组；没有则如实说「无法识别」（⛔ 不默认成功）', () => {
        expect(parseWereadShelfAuth('{"books":[]}').ok).toBe(true);
        expect(parseWereadShelfAuth('{"info":""}').ok).toBe(false);
        expect(parseWereadShelfAuth('{"info":""}').message).toContain('无法识别');
    });
    it('非 JSON / 非对象 → 失败', () => {
        expect(parseWereadShelfAuth('not json').ok).toBe(false);
        expect(parseWereadShelfAuth('<html>风控</html>').message).toContain('无法解析');
        expect(parseWereadShelfAuth('null').ok).toBe(false);
        expect(parseWereadShelfAuth('[]').ok).toBe(false);
    });
});

describe('toWereadBookResult', () => {
    it('映射为书籍搜索结果（source/来源链接 = 该书的在线阅读页）'
        + '｜🔴 #589 翻面：封面在**本层就升级成大图**（原来只升「采纳写入」那一步 ⇒ 搜索列表仍是 70×100 糊图）', () => {
        const r = toWereadBookResult({
            title: '三体全集',
            author: '刘慈欣',
            readUrl: WEREAD_READER_PREFIX + 'abc',
            coverUrl: 'https://cdn.weread.qq.com/x.jpg',
            intro: '简介',
            publisher: '重庆出版社',
            rating: 9.3,
            ratingCount: 100,
        });
        expect(r).toMatchObject({
            id: `weread:${WEREAD_READER_PREFIX}abc`,
            title: '三体全集',
            author: '刘慈欣',
            publisher: '重庆出版社',
            thumbnail: 'https://cdn.weread.qq.com/x.jpg?imageMogr2/thumbnail/600x',
            description: '简介',
            rating: 9.3,
            ratingCount: 100,
            source: 'weread',
            sourceUrl: WEREAD_READER_PREFIX + 'abc',
        });
    });
    it('🔴 #609：`bookId` 透传到搜索结果（表单选中后要拿它去拉 `/web/book/info` 补出版年/完整简介）', () => {
        const r = toWereadBookResult({ title: '囚徒健身', author: '保罗', readUrl: WEREAD_READER_PREFIX + 'z', bookId: '750578' });
        expect(r.bookId).toBe('750578');
    });
    it('🔴 #609：没有 `bookId` ⇒ 不落键（结果是 undefined 而不是空串 —— 详情拉取据此跳过）', () => {
        const r = toWereadBookResult({ title: 'X', author: '', readUrl: WEREAD_READER_PREFIX + 'x' });
        expect(r.bookId).toBeUndefined();
    });
    it('🔴 #589 幂等：结果里已经是处理过的地址 ⇒ 不叠第二遍；没有封面 ⇒ `undefined` 不落键', () => {
        const a = toWereadBookResult({
            title: 'A',
            author: '',
            readUrl: WEREAD_READER_PREFIX + 'a',
            coverUrl: 'https://cdn.weread.qq.com/x.jpg?imageMogr2/thumbnail/600x',
        });
        expect(a.thumbnail).toBe('https://cdn.weread.qq.com/x.jpg?imageMogr2/thumbnail/600x');
        const b = toWereadBookResult({ title: 'B', author: '', readUrl: WEREAD_READER_PREFIX + 'b' });
        expect(b.thumbnail).toBeUndefined();
    });
    it('🔴 空作者不落键（`author: ""` 会在详情里画出一行空白「作者」）', () => {
        const r = toWereadBookResult({ title: '无作者书', author: '', readUrl: WEREAD_READER_PREFIX + 'h' });
        expect(r.author).toBeUndefined();
    });
});

// ────────────────────────── #582 封面大图 / 书籍详情 ──────────────────────────

describe('upgradeWereadCover', () => {
    const S = 'https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s_yuewen_6952331784884457.jpg';

    it('🔴 加上 `imageMogr2/thumbnail/600x`（实测 70×100 → 600×857）', () => {
        expect(upgradeWereadCover(S)).toBe(`${S}?${WEREAD_COVER_QUERY}`);
    });

    it('🔴 幂等：已经带过 `imageMogr2` 就原样返回（⛔ 别叠第二遍）', () => {
        const once = upgradeWereadCover(S);
        expect(upgradeWereadCover(once)).toBe(once);
    });

    it('已有其它查询串 ⇒ 用 `&` 追加（⛔ 别写成第二个 `?`：实测只认第一段）', () => {
        expect(upgradeWereadCover(S + '?x=1')).toBe(`${S}?x=1&${WEREAD_COVER_QUERY}`);
    });

    it('非 http(s) 原样返回；空值 → undefined', () => {
        expect(upgradeWereadCover('/cover/local.jpg')).toBe('/cover/local.jpg');
        expect(upgradeWereadCover('')).toBeUndefined();
        expect(upgradeWereadCover(undefined)).toBeUndefined();
        expect(upgradeWereadCover(123)).toBeUndefined();
    });
});

describe('buildWereadBookInfoUrl / parseWereadBookInfo', () => {
    // 形状照参考实现 zhaohongxuan/obsidian-weread-plugin 的 BookDetailResponse
    const fixture = {
        bookId: '695233',
        title: '三体全集（全三册）',
        author: '刘慈欣',
        cover: 'https://cdn.weread.qq.com/weread/cover/80/yuewen_695233/s_yuewen_6952331784884457.jpg',
        intro: '<p>【荣获世界科幻大奖】</p><p>每个人的书架上都该有套《三体》！</p>',
        publisher: '重庆出版社',
        isbn: '9787229030933',
        category: '文学-科幻',
        publishTime: '2012-01-01',
        newRating: 930,
        newRatingCount: 295468,
        totalWords: 880000,
        finishReading: 1,
    };

    it('URL 带 bookId 且已编码', () => {
        expect(buildWereadBookInfoUrl('695233')).toContain('bookId=695233');
        expect(buildWereadBookInfoUrl('a b')).toContain('bookId=a%20b');
    });

    it('🔴 映射详情：简介去 HTML 标签 + 评分 ÷100 + 年份从 publishTime 取 + 封面升级成大图', () => {
        const info = parseWereadBookInfo(fixture);
        expect(info).not.toBeNull();
        expect(info).toMatchObject({
            title: '三体全集（全三册）',
            author: '刘慈欣',
            intro: '【荣获世界科幻大奖】 每个人的书架上都该有套《三体》！',
            publisher: '重庆出版社',
            isbn: '9787229030933',
            category: '文学-科幻',
            year: 2012,
            rating: 9.3,
            ratingCount: 295468,
        });
        expect(info!.coverUrl).toBe(`${fixture.cover}?${WEREAD_COVER_QUERY}`);
    });

    it('🔴 未登录（errCode -2010）⇒ null（导入侧静默降级，⛔ 不拿它污染条目）', () => {
        expect(parseWereadBookInfo({ errCode: -2010, errMsg: '用户不存在' })).toBeNull();
    });

    it('结构不对 ⇒ null（非对象 / 无 bookId 无书名）', () => {
        expect(parseWereadBookInfo(null)).toBeNull();
        expect(parseWereadBookInfo('x')).toBeNull();
        expect(parseWereadBookInfo({})).toBeNull();
    });

    it('缺的字段一律不落键（空简介 / 无 ISBN / 无评分）', () => {
        const info = parseWereadBookInfo({ bookId: '1', title: 'T', intro: '', isbn: '  ', newRating: 0 });
        expect(info).not.toBeNull();
        expect(info!.intro).toBeUndefined();
        expect(info!.isbn).toBeUndefined();
        expect(info!.rating).toBeUndefined();
        expect(info!.year).toBeUndefined();
    });
});
