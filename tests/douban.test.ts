// 豆瓣兜底解析纯逻辑测试（参考 obsidian-douban 获取方式：j/search 搜索 + 类型化 JSON-LD 详情 + PoW 安全验证）
import { describe, it, expect } from 'vitest';
import {
    parseDoubanItem,
    parseDoubanSearchItems,
    extractJsonLd,
    parseDoubanJsonLd,
    parseDoubanInfo,
    applyDoubanInfo,
    isoDurationToMin,
    DoubanClient,
    toTmdbResult,
    toBookResult,
    toGameResult,
    toBangumiResult,
    toMusicResult,
    DOUBAN_CAT,
    DOUBAN_DOMAIN,
    parseChallenge,
    solveChallenge,
    buildChallengeBody,
    detectDoubanPageProblem,
    parseDoubanOgMeta,
    parseDoubanGameDetail,
    extractDoubanSection,
    toEntryDetailFields,
    upscaleDoubanCover,
    DoubanCookieError,
    type DoubanSubject,
} from 'services/douban';

// 真实 j/search 影视结果结构：href 为 link2 编码跳转、id 在 onclick sid、h3 内带 [电影] span 前缀、评分后有 (N人评价)
const SAMPLE_ITEM = '<div class="result"><div class="pic"><a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F">'
    + '<img width="100" height="140" src="https://img9.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg"/></a></div>'
    + '<div class="content"><div class="title"><h3><span>[电影]</span>&nbsp;<a href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F" target="_blank" onclick="moreurl(this,{i: \'0\', query: \'肖申克的救赎\', from: \'dou_search_movie\', sid: 1292052, qcat: \'1002\'})">肖申克的救赎 </a>'
    + '<span class="ic-mark ic-movie-mark">可播放</span></h3>'
    + '<div class="rating-info"><span class="allstar50"></span><span class="rating_nums">9.7</span><span>(2935822人评价)</span></div></div></div></div>';

function sub(partial: Partial<DoubanSubject> = {}): DoubanSubject {
    return { id: '1292052', title: '肖申克的救赎', cast: [], genres: [], ...partial };
}

describe('豆瓣搜索 items 解析（全类型通用）', () => {
    it('解析单个 li：id/标题（去 from span）/年份/封面/评分/评价人数（封面自动高清化 s_ratio_poster → l_ratio_poster）', () => {
        const r = parseDoubanItem(SAMPLE_ITEM);
        expect(r).not.toBeNull();
        expect(r).toMatchObject({
            id: '1292052',
            title: '肖申克的救赎',
            rating: 9.7,
            ratingCount: 2935822,
            cover: 'https://img9.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg',
        });
    });

    it('搜索 items 无评价人数时 ratingCount 为 undefined', () => {
        const r = parseDoubanItem(SAMPLE_ITEM.replace(/<span>\(\d+人评价\)<\/span>/, ''));
        expect(r?.ratingCount).toBeUndefined();
    });

    it('搜索 items 提取内容简介（rating-info 后的 <p> 描述片段，图书/影视通用）', () => {
        const item = '<div class="result"><div class="pic"><a><img src="x.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[图书]</span>&nbsp;<a onclick="moreurl(this,{sid: 2567698})">三体</a></h3>'
            + '<div class="rating-info"><span class="rating_nums">8.9</span><span>(517685人评价)</span></div></div></div>'
            + '<p>文化大革命如火如荼进行的同时。军方探寻外星文明的绝秘计划"红岸工程"取得了突破性进展。</p></div></div>';
        const r = parseDoubanItem(item);
        expect(r?.ratingCount).toBe(517685);
        expect(r?.summary).toContain('红岸工程');
    });

    it('搜索 items 无描述片段时 summary 为 undefined', () => {
        const r = parseDoubanItem(SAMPLE_ITEM);
        expect(r?.summary).toBeUndefined();
    });

    it('无 subject id 的条目返回 null', () => {
        expect(parseDoubanItem('<li>no id here</li>')).toBeNull();
    });

    it('游戏（link2 编码 href + sid + [游戏] span 前缀）也能解析——回归锁定：真实结构', () => {
        // 真实豆瓣游戏搜索结果 HTML：href 为 link2 编码跳转、id 在 onclick sid、h3 内 <span>[游戏]</span>&nbsp;<a>
        const gameItem = '<div class="result"><div class="pic"><a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fwww.douban.com%2Fgame%2F26840375%2F"><img src="https://img3.doubanio.com/spic/s33707673.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[游戏]</span>&nbsp;<a href="https://www.douban.com/link2/?url=https%3A%2F%2Fwww.douban.com%2Fgame%2F26840375%2F" onclick="moreurl(this,{i: \'0\', query: \'少女前线\', from: \'dou_search_game\', sid: 26840375, qcat: \'3114\'})">少女前线</a></h3>'
            + '<div class="rating-info"><span class="allstar40"></span><span class="rating_nums">7.9</span></div></div></div></div>';
        const r = parseDoubanItem(gameItem);
        expect(r).not.toBeNull();
        expect(r?.id).toBe('26840375');
        expect(r?.title).toBe('少女前线');
        expect(r?.rating).toBe(7.9);
        // 影视真实结构（SAMPLE_ITEM）不受影响
        expect(parseDoubanItem(SAMPLE_ITEM)?.id).toBe('1292052');
        expect(parseDoubanItem(SAMPLE_ITEM)?.title).toBe('肖申克的救赎');
    });

    it('封面 URL 归一化：协议相对 //img2.doubanio.com/x.jpg → https 且高清化 l_ratio_poster（Obsidian Electron 下直接加载，避免断链图占位）', () => {
        const item = '<div class="result"><div class="pic"><a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F">'
            + '<img src="//img2.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg"/></a></div>'
            + '<div class="content"><div class="title"><h3><a href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F" onclick="moreurl(this,{sid: 1292052})">肖申克的救赎</a></h3></div></div></div>';
        expect(parseDoubanItem(item)?.cover).toBe('https://img2.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg');
    });

    it('封面 URL 归一化：站内相对路径 /s/pics/x.jpg → https://img9.doubanio.com/s/pics/x.jpg', () => {
        const item = '<div class="result"><div class="pic"><a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F">'
            + '<img src="/s/pics/p480747492.jpg"/></a></div>'
            + '<div class="content"><div class="title"><h3><a href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F" onclick="moreurl(this,{sid: 1292052})">肖申克的救赎</a></h3></div></div></div>';
        expect(parseDoubanItem(item)?.cover).toBe('https://img9.doubanio.com/s/pics/p480747492.jpg');
    });

    it('封面 URL 归一化：完整 https URL 高清化（s_ratio_poster → l_ratio_poster）', () => {
        expect(parseDoubanItem(SAMPLE_ITEM)?.cover).toBe('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg');
    });

    it('书籍：from span 首段作者提取（作者 / 出版社 / 年份），首段非数字才归属 author', () => {
        const item = '<div class="result"><div class="pic"><a><img src="b.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[图书]</span>&nbsp;<a onclick="moreurl(this,{sid: 2567698})">三体</a></h3>'
            + '<div class="rating-info"><span class="rating_nums">8.9</span></div>'
            + '<span class="from">刘慈欣 / 重庆出版社 / 2008-01</span></div></div></div>';
        const r = parseDoubanItem(item);
        expect(r?.author).toBe('刘慈欣');
        expect(r?.year).toBe(2008);
        expect(r?.developer).toBeUndefined();
    });

    it('书籍：from span 带 [国籍] 前缀的作者去除前缀', () => {
        const item = '<div class="result"><div class="pic"><a><img src="b.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[图书]</span>&nbsp;<a onclick="moreurl(this,{sid: 35216698})">蛤蟆先生去看心理医生</a></h3>'
            + '<div class="rating-info"><span class="rating_nums">8.5</span></div>'
            + '<span class="from">[英] 罗伯特·戴博德 / 陈赢 / 天津人民出版社 / 2020</span></div></div></div>';
        const r = parseDoubanItem(item);
        expect(r?.author).toBe('罗伯特·戴博德');
        expect(r?.year).toBe(2020);
    });

    it('音乐：from span 首段歌手提取（歌手 / 年份）', () => {
        const item = '<div class="result"><div class="pic"><a><img src="m.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[音乐]</span>&nbsp;<a onclick="moreurl(this,{sid: 26292739})">宝贝</a></h3>'
            + '<div class="rating-info"><span class="rating_nums">9.1</span></div>'
            + '<span class="from">张悬 / 2007-07</span></div></div></div>';
        const r = parseDoubanItem(item);
        expect(r?.author).toBe('张悬');
        expect(r?.year).toBe(2007);
    });

    it('游戏：from span 首段开发商提取（[游戏] 前缀归属 developer）', () => {
        const gameItem = '<div class="result"><div class="pic"><a class="nbg" href="https://www.douban.com/link2/?url=https%3A%2F%2Fwww.douban.com%2Fgame%2F26840375%2F"><img src="https://img3.doubanio.com/spic/s33707673.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[游戏]</span>&nbsp;<a href="https://www.douban.com/link2/?url=https%3A%2F%2Fwww.douban.com%2Fgame%2F26840375%2F" onclick="moreurl(this,{i: \'0\', query: \'少女前线\', from: \'dou_search_game\', sid: 26840375, qcat: \'3114\'})">少女前线</a></h3>'
            + '<div class="rating-info"><span class="allstar40"></span><span class="rating_nums">7.9</span></div>'
            + '<span class="from">上海散爆网络科技 / 2016-05</span></div></div></div>';
        const r = parseDoubanItem(gameItem);
        expect(r?.developer).toBe('上海散爆网络科技');
        expect(r?.year).toBe(2016);
        expect(r?.author).toBeUndefined();
    });

    it('影视：from span 首段为年份时不误判作者（year 保持提取）', () => {
        const item = '<div class="result"><div class="pic"><a href="https://www.douban.com/link2/?url=https%3A%2F%2Fmovie.douban.com%2Fsubject%2F1292052%2F"><img src="x.jpg"></a></div>'
            + '<div class="content"><div class="title"><h3><span>[电影]</span>&nbsp;<a onclick="moreurl(this,{sid: 1292052})">肖申克的救赎</a></h3>'
            + '<div class="rating-info"><span class="rating_nums">9.7</span></div>'
            + '<span class="from">1994 / 美国 / 犯罪 剧情</span></div></div></div>';
        const r = parseDoubanItem(item);
        expect(r?.year).toBe(1994);
        expect(r?.author).toBeUndefined();
        expect(r?.developer).toBeUndefined();
    });

    it('解析 j/search JSON：items 数组转 DoubanSubject[]', () => {
        const text = JSON.stringify({ items: [SAMPLE_ITEM, '<li>bad</li>'] });
        const rs = parseDoubanSearchItems(text);
        expect(rs).toHaveLength(1);
        expect(rs[0].title).toBe('肖申克的救赎');
    });

    it('空 items / 非 JSON 结构安全处理', () => {
        expect(parseDoubanSearchItems('{"items":[]}')).toEqual([]);
        expect(parseDoubanSearchItems('{}')).toEqual([]);
    });
});

describe('豆瓣详情 JSON-LD 解析（按类型）', () => {
    const movieLd = JSON.stringify({
        '@type': 'Movie',
        name: '肖申克的救赎 / The Shawshank Redemption',
        description: '一场谋杀案使银行家安迪蒙冤入狱…',
        aggregateRating: { ratingValue: '9.7', ratingCount: '2935822' },
        director: [{ name: '弗兰克·德拉邦特' }],
        author: [{ name: '弗兰克·德拉邦特' }, { name: '斯蒂芬·金' }],
        actor: [{ name: '蒂姆·罗宾斯' }, { name: '摩根·弗里曼' }],
        datePublished: '1994-09-23',
        duration: 'PT2H22M',
    });
    const bookLd = JSON.stringify({
        '@type': 'Book',
        name: '三体',
        author: { '@type': 'Person', name: '刘慈欣' },
        publisher: { '@type': 'Organization', name: '重庆出版社' },
        aggregateRating: { ratingValue: '9.3' },
        description: '地球往事三部曲',
    });
    const gameLd = JSON.stringify({
        '@type': 'VideoGame',
        name: '巫师3：狂猎',
        publisher: { '@type': 'Organization', name: 'CD Projekt RED' },
        genre: ['角色扮演', '开放世界'],
        aggregateRating: { ratingValue: '9.6' },
    });

    it('影视：导演/主演', () => {
        const r = parseDoubanJsonLd(`<script type="application/ld+json">${movieLd}</script>`, 'movie');
        expect(r).toMatchObject({
            title: '肖申克的救赎',
            originalTitle: 'The Shawshank Redemption',
            rating: 9.7,
            director: '弗兰克·德拉邦特',
            cast: ['蒂姆·罗宾斯', '摩根·弗里曼'],
        });
    });

    it('影视：JSON-LD 编剧(author)/上映年份/片长（ISO8601 → 分钟）', () => {
        const r = parseDoubanJsonLd(`<script type="application/ld+json">${movieLd}</script>`, 'movie');
        expect(r?.screenwriter).toEqual(['弗兰克·德拉邦特', '斯蒂芬·金']);
        expect(r?.year).toBe(1994); // datePublished 提取
        expect(r?.durationMin).toBe(142); // PT2H22M
    });

    it('影视：JSON-LD 提取评价人数（aggregateRating.ratingCount）', () => {
        const r = parseDoubanJsonLd(`<script type="application/ld+json">${movieLd}</script>`, 'movie');
        expect(r?.ratingCount).toBe(2935822);
    });

    it('isoDurationToMin：PT2H36M → 156，非法返回 undefined', () => {
        expect(isoDurationToMin('PT2H36M')).toBe(156);
        expect(isoDurationToMin('PT45M')).toBe(45);
        expect(isoDurationToMin('PT1H')).toBe(60);
        expect(isoDurationToMin('P1D')).toBeUndefined();
        expect(isoDurationToMin('')).toBeUndefined();
    });

    it('书籍：作者/出版社', () => {
        const r = parseDoubanJsonLd(`<script type="application/ld+json">${bookLd}</script>`, 'book');
        expect(r).toMatchObject({ title: '三体', author: '刘慈欣', publisher: '重庆出版社', rating: 9.3 });
    });

    it('游戏：开发商/类型标签', () => {
        const r = parseDoubanJsonLd(`<script type="application/ld+json">${gameLd}</script>`, 'game');
        expect(r).toMatchObject({ title: '巫师3：狂猎', developer: 'CD Projekt RED', genres: ['角色扮演', '开放世界'], rating: 9.6 });
    });

    it('无 JSON-LD 或解析失败返回 null', () => {
        expect(parseDoubanJsonLd('<html>no script</html>', 'movie')).toBeNull();
        expect(parseDoubanJsonLd('<script type="application/ld+json">{bad json}</script>', 'movie')).toBeNull();
    });

    it('音乐：byArtist 歌手 / datePublished 发行年（JSON-LD MusicAlbum）', () => {
        const html = `<script type="application/ld+json">{"@type":"MusicAlbum","name":"不再犹豫 / Beyond","byArtist":{"@type":"MusicGroup","name":"BEYOND"},"datePublished":"1991-09-06","aggregateRating":{"ratingValue":"9.7","ratingCount":"127431"}}</script>`;
        const d = parseDoubanJsonLd(html, 'music');
        expect(d?.title).toBe('不再犹豫');
        expect(d?.author).toBe('BEYOND');
        expect(d?.year).toBe(1991);
        expect(d?.rating).toBe(9.7);
        expect(d?.ratingCount).toBe(127431);
    });

    it('音乐：JSON-LD album 专辑提取', () => {
        const html = `<script type="application/ld+json">{"@type":"MusicRecording","name":"不再犹豫","byArtist":{"name":"BEYOND"},"inAlbum":{"@type":"MusicAlbum","name":"犹豫"},"datePublished":"1991"}</script>`;
        const d = parseDoubanJsonLd(html, 'music');
        expect(d?.album).toBe('犹豫');
    });
});

describe('豆瓣详情 #info 区解析（国家/语言/片长/译者/ISBN 等全字段）', () => {
    // 真实电影详情页 #info 结构（外层 span 包裹 + br 分隔 + 类型值内每个类型一个 <span property="v:genre">）
    const movieInfo = '<div id="info">'
        + '<span><span class="pl">导演</span>: <a href="/celebrity/1028333/">丹尼斯·维伦纽瓦</a></span><br/>'
        + '<span><span class="pl">编剧</span>: <a>丹尼斯·维伦纽瓦</a> / <a>乔·斯派茨</a> / <a>埃里克·罗思</a></span><br/>'
        + '<span><span class="pl">主演</span>: <a>提莫西·查拉梅</a> / <a>丽贝卡·弗格森</a> / <a>奥斯卡·伊萨克</a></span><br/>'
        + '<span class="pl">类型:</span> <span property="v:genre">剧情</span> / <span property="v:genre">科幻</span> / <span property="v:genre">冒险</span><br/>'
        + '<span class="pl">制片国家/地区</span>: 美国<br/>'
        + '<span class="pl">语言</span>: 英语 / 汉语普通话<br/>'
        + '<span class="pl">上映日期</span>: 2021-10-22(美国/中国大陆)<br/>'
        + '<span class="pl">片长</span>: 156分钟<br/>'
        + '<span class="pl">又名</span>: 沙丘瀚战(港) / Dune: Part One<br/>'
        + '</div>';
    // 真实书籍详情页 #info 结构（部分标签带前导空格、出版社冒号在 span 内）
    const bookInfo = '<div id="info">'
        + '<span><span class="pl"> 作者</span>: <a href="/author/4507393">[日] 渡边淳一</a></span><br/>'
        + '<span><span class="pl"> 译者</span>: <a>之乎</a></span><br/>'
        + '<span class="pl">出版社:</span> <a>青岛出版社</a><br>'
        + '<span class="pl">出版年:</span> 2015-6<br/>'
        + '<span class="pl">ISBN:</span> 9787555218296<br/>'
        + '<span class="pl">页数:</span> 340<br/>'
        + '<span class="pl">装帧:</span> 平装<br/>'
        + '<span class="pl">定价:</span> 39.00元<br/>'
        + '<span class="pl">丛书:</span>&nbsp;<a>渡边淳一作品</a><br>'
        + '</div>';

    it('电影：#info 提取 导演/编剧/主演/类型/国家/语言/片长/又名', () => {
        const info = parseDoubanInfo(movieInfo);
        expect(info['导演']).toBe('丹尼斯·维伦纽瓦');
        expect(info['编剧']).toBe('丹尼斯·维伦纽瓦 / 乔·斯派茨 / 埃里克·罗思');
        expect(info['主演']).toBe('提莫西·查拉梅 / 丽贝卡·弗格森 / 奥斯卡·伊萨克');
        expect(info['制片国家/地区']).toBe('美国');
        expect(info['语言']).toBe('英语 / 汉语普通话');
        expect(info['片长']).toBe('156分钟');
        expect(info['又名']).toBe('沙丘瀚战(港) / Dune: Part One');
        // 上映日期含括号斜杠不被拆分破坏
        expect(info['上映日期']).toBe('2021-10-22(美国/中国大陆)');
    });

    it('电影：#info 映射到 DoubanSubject（类型化字段）', () => {
        const r = applyDoubanInfo(sub(), 'movie', parseDoubanInfo(movieInfo));
        expect(r.director).toBe('丹尼斯·维伦纽瓦');
        expect(r.screenwriter).toEqual(['丹尼斯·维伦纽瓦', '乔·斯派茨', '埃里克·罗思']);
        expect(r.cast).toEqual(['提莫西·查拉梅', '丽贝卡·弗格森', '奥斯卡·伊萨克']);
        expect(r.genres).toEqual(['剧情', '科幻', '冒险']);
        expect(r.country).toBe('美国');
        expect(r.language).toBe('英语 / 汉语普通话');
        expect(r.durationMin).toBe(156);
        expect(r.aliases).toEqual(['沙丘瀚战(港)', 'Dune: Part One']);
    });

    it('书籍：#info 映射（作者/译者/出版社/ISBN/页数/装帧/定价/丛书/出版年）', () => {
        const r = applyDoubanInfo(sub(), 'book', parseDoubanInfo(bookInfo));
        expect(r.author).toBe('[日] 渡边淳一');
        expect(r.translator).toBe('之乎');
        expect(r.publisher).toBe('青岛出版社');
        expect(r.isbn).toBe('9787555218296');
        expect(r.pageCount).toBe(340);
        expect(r.binding).toBe('平装');
        expect(r.price).toBe('39.00元');
        expect(r.series).toBe('渡边淳一作品');
        expect(r.year).toBe(2015); // 出版年 2015-6 → 2015
    });

    // 真实音乐详情页 #info 结构（实测 music.douban.com/subject/4899751/）：
    // 「表演者」标签与值都嵌在 class="pl" 的 span 内（<span class="pl"> 表演者: <a>beyond</a> </span>），
    // span 外无内容——旧正则按「span 内=标签、span 外=值」解析 → 标签被解析成「表演者: beyond」、值为空 → 整行丢弃
    const musicInfo = '<div id="info">'
        + '<span> <span class="pl"> 表演者: <a>beyond</a> </span> </span><br/>'
        + '<span class="pl">流派:</span> 摇滚<br/>'
        + '<span class="pl">发行时间:</span> 1993-05-14<br/>'
        + '</div>';

    it('音乐：#info 提取「表演者」混排标签（标签与值同在 span 内，按第一个冒号拆分）', () => {
        const info = parseDoubanInfo(musicInfo);
        expect(info['表演者']).toBe('beyond');
        // 标准结构不受影响
        expect(info['流派']).toBe('摇滚');
        expect(info['发行时间']).toBe('1993-05-14');
    });

    it('音乐：#info 表演者 → author 回填', () => {
        const r = applyDoubanInfo(sub(), 'music', parseDoubanInfo(musicInfo));
        expect(r.author).toBe('beyond');
    });

    it('音乐：#info 发行时间 → year、流派 → genres 回填（表单发行年/题材依赖）', () => {
        const r = applyDoubanInfo(sub(), 'music', parseDoubanInfo(musicInfo));
        expect(r.year).toBe(1993); // 发行时间 1993-05-14 → 1993
        expect(r.genres).toEqual(['摇滚']);
        // JSON-LD 已给 year 时不覆盖
        expect(applyDoubanInfo(sub({ year: 1992 }), 'music', parseDoubanInfo(musicInfo)).year).toBe(1992);
    });

    it('无 #info 区：空映射且不破坏原条目', () => {
        expect(parseDoubanInfo('<html>no info</html>')).toEqual({});
        const r = applyDoubanInfo(sub({ director: '已有' }), 'movie', {});
        expect(r.director).toBe('已有');
    });

    it('fetchDetail 合并 JSON-LD + #info（书籍：作者来自 JSON-LD，出版社/ISBN/装帧来自 #info）', async () => {
        const client = new DoubanClient(
            async (url) => {
                if (url.includes('book.douban.com')) {
                    return '<script type="application/ld+json">{"@type":"Book","name":"三体","author":{"name":"刘慈欣"},"isbn":"9787536692930"}</script>'
                        + '<div id="info"><span class="pl">出版社:</span> 重庆出版社<br/><span class="pl">装帧:</span> 精装<br/><span class="pl">定价:</span> 68.00元<br/></div>';
                }
                return '{}';
            },
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '25864082', title: '三体' }), 'book');
        expect(r.author).toBe('刘慈欣');
        expect(r.isbn).toBe('9787536692930');
        expect(r.publisher).toBe('重庆出版社');
        expect(r.binding).toBe('精装');
        expect(r.price).toBe('68.00元');
    });
});

describe('类型化转换（EntryForm 无感接入）', () => {
    it('影视 → TmdbSearchResult（source=douban，封面完整 URL）', () => {
        expect(toTmdbResult(sub({ year: 1994 }))).toMatchObject({
            id: 1292052,
            title: '肖申克的救赎',
            year: 1994,
            mediaType: 'movie',
            source: 'douban',
        });
    });

    it('书籍 → BookSearchResult（id 前缀 douban:，作者/出版社透传）', () => {
        const r = toBookResult(sub({ author: '刘慈欣', publisher: '重庆出版社' }));
        expect(r).toMatchObject({ id: 'douban:1292052', title: '肖申克的救赎', author: '刘慈欣', publisher: '重庆出版社' });
    });

    it('游戏 → GameSearchResult（平台/开发商透传）', () => {
        const r = toGameResult(sub({ platform: 'PC', developer: 'CD Projekt RED' }));
        expect(r).toMatchObject({ id: 1292052, platform: 'PC', developer: 'CD Projekt RED' });
    });

    it('动画 → BangumiSearchResult（studio 映射 developer）', () => {
        const r = toBangumiResult(sub({ originalTitle: 'Shawshank', developer: 'Madhouse' }));
        expect(r).toMatchObject({ id: 1292052, originalTitle: 'Shawshank', studio: 'Madhouse' });
    });

    it('音乐：toMusicResult 映射（artist/album/封面/评分/人数/来源）', () => {
        const r = toMusicResult({ id: '4899751', title: '不再犹豫', author: 'BEYOND', album: '犹豫', year: 1991, cover: 'https://img1.doubanio.com/x.jpg', rating: 9.7, ratingCount: 127431, summary: '经典摇滚', cast: [], genres: [] });
        expect(r.id).toBe('douban:4899751');
        expect(r.title).toBe('不再犹豫');
        expect(r.artist).toBe('BEYOND');
        expect(r.album).toBe('犹豫');
        expect(r.year).toBe(1991);
        expect(r.cover).toBe('https://img1.doubanio.com/x.jpg');
        expect(r.rating).toBe(9.7);
        expect(r.ratingCount).toBe(127431);
        expect(r.summary).toBe('经典摇滚');
        expect(r.source).toBe('douban');
        expect(r.sourceUrl).toBe('https://music.douban.com/subject/4899751/');
    });
});

describe('DoubanClient 请求（cat 映射 / Cookie / 详情子域）', () => {
    it('DOUBAN_CAT 映射：影视 1002、书籍 1001、游戏 3114', () => {
        expect(DOUBAN_CAT.movie).toBe(1002);
        expect(DOUBAN_CAT.tv).toBe(1002);
        expect(DOUBAN_CAT.anime).toBe(1002);
        expect(DOUBAN_CAT.book).toBe(1001);
        expect(DOUBAN_CAT.game).toBe(3114);
    });

    it('DOUBAN_DOMAIN 映射：书籍/游戏独立子域', () => {
        expect(DOUBAN_DOMAIN.book).toBe('book.douban.com');
        expect(DOUBAN_DOMAIN.game).toBe('game.douban.com');
        expect(DOUBAN_DOMAIN.movie).toBe('movie.douban.com');
    });

    it('搜索按类型带 cat 且携带 Cookie/UA/Referer', async () => {
        let captured: { url: string; headers?: Record<string, string> } | undefined;
        const client = new DoubanClient(
            async (url, headers) => {
                captured = { url, headers };
                return JSON.stringify({ items: [SAMPLE_ITEM] });
            },
            async () => '{}',
            'bid=abc123',
        );
        await client.search('三体', 'book');
        expect(captured!.url).toContain('cat=1001');
        expect(captured!.headers).toMatchObject({
            Cookie: 'bid=abc123',
            'User-Agent': expect.stringContaining('Chrome'),
            Referer: expect.stringContaining('douban.com'),
            Accept: expect.stringContaining('text/html'),
            'Accept-Language': expect.stringContaining('zh-CN'),
        });
    });

    it('fetchDetail 按类型子域请求并合并 JSON-LD 字段', async () => {
        const client = new DoubanClient(
            async (url) => {
                if (url.includes('book.douban.com')) {
                    return '<script type="application/ld+json">{"@type":"Book","name":"三体","author":{"name":"刘慈欣"}}</script>';
                }
                return '{}';
            },
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '25864082', title: '三体' }), 'book');
        expect(r).toMatchObject({ id: '25864082', author: '刘慈欣' });
    });

    it('fetchDetail 详情页失败时保留搜索级字段', async () => {
        const client = new DoubanClient(
            async () => {
                throw new Error('HTTP 403');
            },
            async () => '{}',
        );
        const r = await client.fetchDetail(sub(), 'movie');
        expect(r.title).toBe('肖申克的救赎');
    });

    it('搜索遇 403 JSON（items 缺失）时抛错，供兜底层区分拦截与无结果', async () => {
        const client = new DoubanClient(
            async () => '{"r":1,"code":403}',
            async () => '{}',
        );
        await expect(client.search('x', 'movie')).rejects.toThrow();
    });

    it('testConnection 对 403 JSON 报错（不再因含 items 子串误判成功）', async () => {
        const client = new DoubanClient(
            async () => '{"r":1,"code":403,"items":null}',
            async () => '{}',
        );
        await expect(client.testConnection()).rejects.toThrow();
    });

    it('testConnection 对挑战页（非 JSON）报错', async () => {
        const client = new DoubanClient(
            async () => '<html><form id="sec" action="/c">challenge</form></html>',
            async () => '{}',
        );
        await expect(client.testConnection()).rejects.toThrow();
    });
});

describe('Douban 安全验证（proof-of-work）', () => {
    const CHALLENGE_HTML =
        '<html><form id="sec" action="/c">'
        + '<input name="tok" value="tok123"/>'
        + '<input name="cha" value="cha456"/>'
        + '<input name="sol" value=""/>'
        + '<input name="red" value="https://www.douban.com/j/search?q=test"/>'
        + '</form><script>var difficulty = 2;</script></html>';

    it('parseChallenge 提取 tok/cha/red/difficulty', () => {
        const c = parseChallenge(CHALLENGE_HTML);
        expect(c).toEqual({ token: 'tok123', challenge: 'cha456', redirectUrl: 'https://www.douban.com/j/search?q=test', difficulty: 2 });
        expect(parseChallenge('<html>no form</html>')).toBeNull();
    });

    it('solveChallenge 求出使 sha512(challenge+nonce) 以 difficulty 个 0 开头的 nonce', async () => {
        const c = { token: 't', challenge: 'challenge-test', redirectUrl: 'r', difficulty: 1 };
        const nonce = await solveChallenge(c);
        expect(nonce).toBeGreaterThan(0);
        // 用相同算法回验（独立验证）
        const cryptoLib = await import('node:crypto');
        const hash = cryptoLib.createHash('sha512').update(c.challenge + nonce).digest('hex');
        expect(hash.startsWith('0')).toBe(true);
    });

    it('buildChallengeBody 生成表单编码 body', () => {
        const body = buildChallengeBody({ token: 't', challenge: 'c', redirectUrl: 'https://x', difficulty: 1 }, 42);
        expect(body).toContain('tok=t');
        expect(body).toContain('cha=c');
        expect(body).toContain('sol=42');
        expect(body).toContain('red=');
    });

    it('request 流程：检测挑战 → 求解 → POST 验证 → 验证响应即结果', async () => {
        let posted: { url: string; body: string; headers?: Record<string, string> } | undefined;
        const client = new DoubanClient(
            async () => CHALLENGE_HTML, // 首次 GET 返回挑战页
            async (url, body, headers) => {
                posted = { url, body, headers };
                return JSON.stringify({ items: [SAMPLE_ITEM] }); // 验证响应即搜索结果
            },
            'bid=abc',
        );
        const rs = await client.search('x', 'movie');
        expect(rs).toHaveLength(1);
        expect(posted!.url).toBe('https://sec.douban.com/c');
        expect(posted!.body).toContain('sol=');
        expect(posted!.headers).toMatchObject({ Origin: 'https://sec.douban.com', 'Content-Type': 'application/x-www-form-urlencoded' });
    });

    it('验证后仍返回挑战页时明确报错', async () => {
        const client = new DoubanClient(
            async () => CHALLENGE_HTML,
            async () => CHALLENGE_HTML, // 验证响应仍是挑战
            'bid=abc',
        );
        await expect(client.search('x', 'movie')).rejects.toThrow('安全验证未能完成');
    });
});

describe('Douban 反爬拦截页检测（detectDoubanPageProblem）', () => {
    it('禁止访问页 → access-denied', () => {
        expect(detectDoubanPageProblem('<html><head><title> 禁止访问 </title></head><body></body></html>')).toBe('access-denied');
    });

    it('登录跳转页（title 形式）→ login-required', () => {
        expect(detectDoubanPageProblem('<title>豆瓣 - 登录跳转页</title>')).toBe('login-required');
    });

    it('登录跳转页（passport/login 链接形式）→ login-required', () => {
        expect(detectDoubanPageProblem('<a href="https://accounts.douban.com/passport/login?redir=https://www.douban.com/j/search?q=x">登录</a>')).toBe('login-required');
    });

    it('「你要的东西不在这」→ access-denied', () => {
        expect(detectDoubanPageProblem('<p>你要的东西不在这, 到别处看看吧。</p>')).toBe('access-denied');
    });

    it('正常页/JSON → null', () => {
        expect(detectDoubanPageProblem('{"items":[]}')).toBeNull();
        expect(detectDoubanPageProblem('<html><title>电影</title></html>')).toBeNull();
        expect(detectDoubanPageProblem('')).toBeNull();
    });
});

describe('Douban 详情 og meta 兜底（parseDoubanOgMeta）', () => {
    const ogHtml = '<html><head>'
        + '<meta property="og:title" content="肖申克的救赎"/>'
        + '<meta property="og:url" content="https://movie.douban.com/subject/1292052/"/>'
        + '<meta property="og:image" content="https://img9.doubanio.com/view/photo/p480747492.jpg"/>'
        + '<meta property="og:description" content="一场谋杀案使银行家安迪蒙冤入狱"/>'
        + '</head><body><div id="interest_sectl"><strong property="v:average">9.7</strong></div></body></html>';

    it('提取 id/title/cover/summary/rating', () => {
        const r = parseDoubanOgMeta(ogHtml);
        expect(r).toMatchObject({
            id: '1292052',
            title: '肖申克的救赎',
            cover: 'https://img9.doubanio.com/view/photo/p480747492.jpg',
            summary: '一场谋杀案使银行家安迪蒙冤入狱',
            rating: 9.7,
        });
    });

    it('无 og:title 且无 id 时返回 null', () => {
        expect(parseDoubanOgMeta('<html><body>no meta</body></html>')).toBeNull();
    });
});

describe('Douban 游戏详情解析（parseDoubanGameDetail，无 JSON-LD）', () => {
    const gameHtml = '<html><head>'
        + '<meta name="mobile-agent" content="format=html5;url=https://www.douban.com/game/26840375/"/>'
        + '</head><body>'
        + '<div id="content"><h1>少女前线</h1>'
        + '<div class="rating_self clearfix"><strong property="v:average">7.9</strong></div>'
        + '<div class="article"><div class="mod item-subject"><div class="item-subject-info"><div><a><img src="https://img3.doubanio.com/lpic/s33707673.jpg"></a></div></div></div></div>'
        + '<div id="link-report"><p>一款二次元策略养成手游</p></div>'
        + '<dl class="thing-attr">'
        + '<dt>类型:</dt><dd><a>策略</a> / <a>角色扮演</a></dd>'
        + '<dt>平台:</dt><dd><a>Android</a> / <a>iOS</a></dd>'
        + '<dt>别名:</dt><dd>Girls\' Frontline</dd>'
        + '<dt>开发商:</dt><dd>云母组</dd>'
        + '<dt>发行商:</dt><dd>散爆网络</dd>'
        + '<dt>发行日期:</dt><dd>2016-05-20</dd>'
        + '</dl></div></body></html>';

    it('提取 平台/开发商/类型/别名/发行年份/评分/简介', () => {
        const r = parseDoubanGameDetail(gameHtml);
        expect(r).toMatchObject({
            id: '26840375',
            title: '少女前线',
            platform: 'Android / iOS',
            developer: '云母组',
            genres: ['策略', '角色扮演'],
            aliases: ['Girls\' Frontline'],
            year: 2016,
            rating: 7.9,
            cover: 'https://img3.doubanio.com/lpic/s33707673.jpg',
        });
        expect(r?.summary).toBe('一款二次元策略养成手游');
    });

    it('无 mobile-agent 且无 h1 时返回 null', () => {
        expect(parseDoubanGameDetail('<html><body>no game</body></html>')).toBeNull();
    });

    it('评分支持 meta property="v:average" content 结构（新版页面）', () => {
        const r = parseDoubanGameDetail('<html><body><h1>游戏X</h1><meta property="v:average" content="8.6"/></body></html>');
        expect(r?.rating).toBe(8.6);
    });

    it('评分支持 rating_num 类结构（无 v:average 时兜底）', () => {
        const r = parseDoubanGameDetail('<html><body><h1>游戏X</h1><span class="rating_num">7.5</span></body></html>');
        expect(r?.rating).toBe(7.5);
    });

    // 真实 www.douban.com/game/{id}/ 页面：全页第一个 <img> 是站内导航 new_menu.gif（74B 占位图标），
    // 真实封面在 <div class="item-subject-info"><div class="pic"><img src="lpic/..."> 内
    const realGameHtml = '<html><head>'
        + '<meta name="mobile-agent" content="format=html5;url=https://www.douban.com/game/26709137/"/>'
        + '</head><body>'
        + '<div id="top-nav-douban"><a href="/"><img src="https://img3.doubanio.com/f/shire/e49eca1517424a941871a2667a8957fd6c72d632/pics/new_menu.gif"></a></div>'
        + '<div id="content"><h1>部落冲突：皇室战争 Clash Royale</h1>'
        + '<div class="mod item-subject"><div class="item-subject-info"><div class="pic">'
        + '<a href="https://img9.doubanio.com/lpic/s28383824.jpg"><img width="115" src="https://img9.doubanio.com/lpic/s28383824.jpg" alt="部落冲突：皇室战争 Clash Royale"></a>'
        + '</div></div></div>'
        + '<div id="link-report"><p>策略对战手游</p></div>'
        + '<dl class="thing-attr"><dt>平台:</dt><dd>Android / iOS</dd></dl>'
        + '</div></body></html>';

    it('封面取 item-subject-info 内的 lpic，不取全页第一个 new_menu.gif 导航占位图', () => {
        const r = parseDoubanGameDetail(realGameHtml);
        expect(r?.cover).toBe('https://img9.doubanio.com/lpic/s28383824.jpg');
    });

    it('无 item-subject-info 时封面为 undefined（不回退全页第一个 img，由 fetchDetail 保留搜索级封面）', () => {
        const r = parseDoubanGameDetail(
            '<html><body><img src="https://img3.doubanio.com/f/shire/xxx/pics/new_menu.gif"><h1>某游戏</h1>'
            + '<dl class="thing-attr"><dt>平台:</dt><dd>PC</dd></dl></body></html>',
        );
        expect(r?.cover).toBeUndefined();
    });

    it('fetchDetail 游戏分支走 dl.thing-attr（不再依赖 JSON-LD）', async () => {
        const client = new DoubanClient(
            async (url) => {
                if (url.includes('/game/')) return gameHtml;
                return '{}';
            },
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '26840375', title: '少女前线' }), 'game');
        expect(r.developer).toBe('云母组');
        expect(r.platform).toBe('Android / iOS');
        expect(r.genres).toEqual(['策略', '角色扮演']);
        expect(r.year).toBe(2016);
    });

    it('fetchDetail 游戏分支：真实页面（导航占位图在前）封面取 item-subject-info 内 lpic', async () => {
        const client = new DoubanClient(
            async (url) => (url.includes('/game/') ? realGameHtml : '{}'),
            async () => '{}',
        );
        const r = await client.fetchDetail(
            sub({ id: '26709137', title: '部落冲突：皇室战争 Clash Royale', cover: 'https://img1.doubanio.com/spic/s123.jpg' }),
            'game',
        );
        expect(r.cover).toBe('https://img9.doubanio.com/lpic/s28383824.jpg');
    });

    it('fetchDetail 游戏分支：详情封面为 /pics/ 站内占位图时保留搜索级封面', async () => {
        const noCoverHtml = '<html><body>'
            + '<div class="mod item-subject"><div class="item-subject-info"><div class="pic">'
            + '<img src="https://img1.doubanio.com/f/shire/xxx/pics/thing-default-small.gif"></div></div></div>'
            + '<h1>某游戏</h1><dl class="thing-attr"><dt>平台:</dt><dd>PC</dd></dl></body></html>';
        const client = new DoubanClient(
            async (url) => (url.includes('/game/') ? noCoverHtml : '{}'),
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '1', title: '某游戏', cover: 'https://img2.doubanio.com/spic/s999.jpg' }), 'game');
        expect(r.cover).toBe('https://img2.doubanio.com/spic/s999.jpg');
    });

    it('游戏详情提取发行商（发行商 → publisher）', () => {
        const r = parseDoubanGameDetail(gameHtml);
        expect(r?.publisher).toBe('散爆网络');
    });
});

describe('Douban 详情小节提取（extractDoubanSection：作者简介/目录）', () => {
    it('作者简介块：取标题后的 intro 文本，style 块不残留', () => {
        const html = '<div class="related_info">'
            + '<h2><span class="pl">作者简介</span> &middot;&middot;&middot;&middot;</h2>'
            + '<div class="indent"><div><style type="text/css">.intro p{text-indent:2em;word-break:normal;}</style>'
            + '<div class="intro"><p>刘慈欣，祖籍河南，长于山西。</p><p>高级工程师。</p></div></div></div>'
            + '</div>';
        expect(extractDoubanSection(html, '作者简介')).toBe('刘慈欣，祖籍河南，长于山西。 高级工程师。');
    });

    it('目录块：取标题后的 indent 文本，去掉「展开全部」尾巴', () => {
        const html = '<h2><span class="pl">目录</span> &middot;&middot;&middot;&middot;</h2>'
            + '<div class="indent" id="dir_2567698_short">1.科学边界<br/>2.射手<br/><span id="dir_2567698_full">3.宇宙闪烁</span>'
            + '<a href="javascript:;" onclick="x()">展开全部</a></div>';
        expect(extractDoubanSection(html, '目录')).toBe('1.科学边界 2.射手 3.宇宙闪烁');
    });

    it('无标题返回 undefined', () => {
        expect(extractDoubanSection('<html>no related_info</html>', '作者简介')).toBeUndefined();
        expect(extractDoubanSection('', '目录')).toBeUndefined();
    });
});

describe('Douban 图书详情集成（fetchDetail：作者简介/目录/评价人数）', () => {
    it('书籍详情页合并 作者简介/目录/JSON-LD 评价人数', async () => {
        const detailHtml = '<script type="application/ld+json">{"@type":"Book","name":"三体","author":{"name":"刘慈欣"},'
            + '"aggregateRating":{"ratingValue":"9.3","ratingCount":"517685"}}</script>'
            + '<div id="info"><span class="pl">出版社:</span> 重庆出版社<br/></div>'
            + '<div class="related_info">'
            + '<h2><span class="pl">作者简介</span> &middot;&middot;&middot;&middot;</h2>'
            + '<div class="indent"><div class="intro"><p>刘慈欣，科幻作家。</p></div></div>'
            + '<h2><span class="pl">目录</span> &middot;&middot;&middot;&middot;</h2>'
            + '<div class="indent" id="dir_x_short">第一章 科学边界</div>'
            + '</div>';
        const client = new DoubanClient(
            async (url) => (url.includes('book.douban.com') ? detailHtml : '{}'),
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '2567698', title: '三体' }), 'book');
        expect(r.ratingCount).toBe(517685);
        expect(r.authorIntro).toBe('刘慈欣，科幻作家。');
        expect(r.toc).toBe('第一章 科学边界');
        expect(r.publisher).toBe('重庆出版社');
    });

    it('详情页无相关小节时 authorIntro/toc 为 undefined（不覆盖已有值）', async () => {
        const client = new DoubanClient(async () => '<html><body>no sections</body></html>', async () => '{}');
        const r = await client.fetchDetail(sub({ id: '1', title: 'x', authorIntro: '已有' }), 'book');
        expect(r.authorIntro).toBe('已有');
    });

    it('详情 JSON-LD 缺评分时，不覆盖搜索级 评分/评价人数（undefined 不参与合并）', async () => {
        const detailHtml = '<script type="application/ld+json">{"@type":"Book","name":"三体","author":{"name":"刘慈欣"},"description":"地球往事三部曲"}</script>'
            + '<div id="info"><span class="pl">出版社:</span> 重庆出版社<br/></div>';
        const client = new DoubanClient(
            async (url) => (url.includes('book.douban.com') ? detailHtml : '{}'),
            async () => '{}',
        );
        const r = await client.fetchDetail(sub({ id: '2567698', title: '三体', rating: 8.9, ratingCount: 517685 }), 'book');
        expect(r.rating).toBe(8.9); // JSON-LD 无 aggregateRating，搜索级评分保留
        expect(r.ratingCount).toBe(517685); // 评价人数不被 undefined 覆盖
        expect(r.summary).toBe('地球往事三部曲'); // JSON-LD description 正常合并
    });
});

describe('Douban 类型化转换（新字段透传）', () => {
    it('书籍 → BookSearchResult 透传 评价人数/作者简介/目录', () => {
        const r = toBookResult(sub({ ratingCount: 517685, authorIntro: '简介A', toc: '目录B' }));
        expect(r.ratingCount).toBe(517685);
        expect(r.authorIntro).toBe('简介A');
        expect(r.toc).toBe('目录B');
    });

    it('游戏 → GameSearchResult 透传 发行商/评价人数/类型', () => {
        const r = toGameResult(sub({ publisher: '腾讯游戏', ratingCount: 5834, genres: ['策略'] }));
        expect(r.publisher).toBe('腾讯游戏');
        expect(r.ratingCount).toBe(5834);
        expect(r.genres).toEqual(['策略']);
    });

    it('影视 → TmdbSearchResult 透传评价人数', () => {
        const r = toTmdbResult(sub({ ratingCount: 2935822 }));
        expect(r.ratingCount).toBe(2935822);
    });
});

describe('toEntryDetailFields（豆瓣详情 → 表单回填字段投影）', () => {
    it('游戏详情字段完整投影：platform/developer 必须包含（回归：main.ts 白名单曾截掉，游戏回填全空）', () => {
        const d = toEntryDetailFields(sub({
            title: '部落冲突 Clash of Clans',
            platform: 'Android / iOS',
            developer: 'Supercell',
            publisher: 'Supercell',
            genres: ['策略'],
            aliases: ['Clash of Clans'],
            year: 2012,
            summary: '策略手游',
            cover: 'https://img9.doubanio.com/lpic/s1.jpg',
        }));
        expect(d.platform).toBe('Android / iOS');
        expect(d.developer).toBe('Supercell');
        expect(d.publisher).toBe('Supercell');
        expect(d.genres).toEqual(['策略']);
        expect(d.aliases).toEqual(['Clash of Clans']);
        expect(d.year).toBe(2012);
        expect(d.summary).toBe('策略手游');
        expect(d.cover).toBe('https://img9.doubanio.com/lpic/s1.jpg');
    });

    it('搜索级结果（无详情字段）投影为 undefined（表单保持空，不注入脏值）', () => {
        const d = toEntryDetailFields(sub({ title: 'x' }));
        expect(d.platform).toBeUndefined();
        expect(d.developer).toBeUndefined();
        expect(d.year).toBeUndefined();
        expect(d.publisher).toBeUndefined();
    });
});

describe('Douban 详情 og meta 兜底集成（fetchDetail）', () => {
    it('JSON-LD 缺失时回退 og meta（保留标题/封面/评分）', async () => {
        const ogHtml = '<html><head>'
            + '<meta property="og:title" content="肖申克的救赎"/>'
            + '<meta property="og:url" content="https://movie.douban.com/subject/1292052/"/>'
            + '<meta property="og:image" content="https://img9.doubanio.com/view/photo/p480747492.jpg"/>'
            + '</head><body><strong property="v:average">9.7</strong></body></html>';
        const client = new DoubanClient(async () => ogHtml, async () => '{}');
        const r = await client.fetchDetail(sub({ id: '1292052', title: '肖申克的救赎' }), 'movie');
        expect(r.title).toBe('肖申克的救赎');
        expect(r.rating).toBe(9.7);
        expect(r.cover).toBe('https://img9.doubanio.com/view/photo/p480747492.jpg');
    });

    it('JSON-LD 存在但无 image 字段时，封面从 og:image 兜底（JSON-LD 详情不带封面，og 是回源高清封面唯一来源）', async () => {
        // JSON-LD 含标题/评分（ld+json 块），无 image；og:image 提供原图级封面
        const html = '<html><head>'
            + '<script type="application/ld+json">{"@type":"Movie","name":"肖申克的救赎","aggregateRating":{"ratingValue":"9.7"}}</script>'
            + '<meta property="og:image" content="https://img9.doubanio.com/view/photo/m/public/p480747492.jpg"/>'
            + '</head><body></body></html>';
        const client = new DoubanClient(async () => html, async () => '{}');
        const r = await client.fetchDetail(sub({ id: '1292052', title: '肖申克的救赎' }), 'movie');
        expect(r.title).toBe('肖申克的救赎');
        expect(r.rating).toBe(9.7);
        // og 封面经 upscale 高清化：m → l
        expect(r.cover).toBe('https://img9.doubanio.com/view/photo/l/public/p480747492.jpg');
    });
});

describe('Douban 反爬拦截页集成（request 精确报错）', () => {
    it('搜索遇「禁止访问」页抛精确错误（非误判无结果）', async () => {
        const client = new DoubanClient(
            async () => '<html><head><title>禁止访问</title></head><body></body></html>',
            async () => '{}',
        );
        await expect(client.search('x', 'movie')).rejects.toThrow('拒绝访问');
    });

    it('搜索遇「登录跳转页」抛精确错误', async () => {
        const client = new DoubanClient(
            async () => '<title>豆瓣 - 登录跳转页</title>',
            async () => '{}',
        );
        await expect(client.search('x', 'movie')).rejects.toThrow('需要登录');
    });

    it('Cookie 失效场景（登录跳转/禁止访问/验证失败/接口异常）抛 DoubanCookieError 类型（供 main 明确提醒 Cookie 失效）', async () => {
        const mk = (html: string) => new DoubanClient(async () => html, async () => '{}');
        await expect(mk('<title>豆瓣 - 登录跳转页</title>').search('x', 'movie')).rejects.toBeInstanceOf(DoubanCookieError);
        await expect(mk('<title>禁止访问</title>').search('x', 'movie')).rejects.toBeInstanceOf(DoubanCookieError);
        // 安全验证未能完成（验证后仍是挑战页）
        const challengeHtml =
            '<html><form id="sec" action="/c">'
            + '<input name="tok" value="tok123"/><input name="cha" value="cha456"/>'
            + '<input name="sol" value=""/><input name="red" value="https://www.douban.com/j/search?q=x"/>'
            + '</form><script>var difficulty = 2;</script></html>';
        const alwaysChallenge = new DoubanClient(
            async () => challengeHtml,
            async () => challengeHtml, // POST 验证后仍返回挑战页 → 验证未完成
        );
        await expect(alwaysChallenge.search('x', 'movie')).rejects.toBeInstanceOf(DoubanCookieError);
        // 接口响应异常（非 items 数组，Cookie 无效或过期）
        const badJson = new DoubanClient(async () => '{"error":"need login"}', async () => '{}');
        await expect(badJson.search('x', 'movie')).rejects.toBeInstanceOf(DoubanCookieError);
    });
});

describe('Douban 游戏详情合并（fetchDetail 有值覆盖保护）', () => {
    it('游戏详情页无评分时保留搜索级评分（undefined 不覆盖）', async () => {
        const client = new DoubanClient(
            async () => '<html><body><h1>游戏X</h1><dl class="thing-attr"><dt>平台:</dt><dd>PC</dd></dl></body></html>',
            async () => '{}',
        );
        const r = await client.fetchDetail({ id: '12345', title: '游戏X', rating: 8, cast: [], genres: [] }, 'game');
        expect(r.rating).toBe(8);
    });

    it('游戏详情有评分时覆盖搜索级评分', async () => {
        const client = new DoubanClient(
            async () => '<html><body><h1>游戏X</h1><div class="rating_self"><strong property="v:average">9.1</strong></div><dl class="thing-attr"><dt>平台:</dt><dd>PC</dd></dl></body></html>',
            async () => '{}',
        );
        const r = await client.fetchDetail({ id: '12345', title: '游戏X', rating: 8, cast: [], genres: [] }, 'game');
        expect(r.rating).toBe(9.1);
    });
});

describe('upscaleDoubanCover 封面高清化（2026-09-09：搜索列表 spic 缩略图落库糊）', () => {
    it('老式图床 spic → lpic（游戏搜索封面 70×94 糊源）', () => {
        expect(upscaleDoubanCover('https://img3.doubanio.com/spic/s33707673.jpg')).toBe('https://img3.doubanio.com/lpic/s33707673.jpg');
    });
    it('老式图床 mpic → lpic', () => {
        expect(upscaleDoubanCover('https://img3.doubanio.com/mpic/s33707673.jpg')).toBe('https://img3.doubanio.com/lpic/s33707673.jpg');
    });
    it('view/photo 图床 s_ratio_poster → l_ratio_poster（影视搜索封面档）', () => {
        expect(upscaleDoubanCover('https://img9.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg')).toBe('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg');
    });
    it('view/photo 图床 m/s → l（详情页大图档）', () => {
        expect(upscaleDoubanCover('https://img9.doubanio.com/view/photo/m/public/p480747492.jpg')).toBe('https://img9.doubanio.com/view/photo/l/public/p480747492.jpg');
        expect(upscaleDoubanCover('https://img9.doubanio.com/view/photo/s/public/p480747492.jpg')).toBe('https://img9.doubanio.com/view/photo/l/public/p480747492.jpg');
    });
    it('已是高清档 lpic/l_ratio_poster/l 幂等（详情页封面不二次变换）', () => {
        expect(upscaleDoubanCover('https://img9.doubanio.com/lpic/s28383824.jpg')).toBe('https://img9.doubanio.com/lpic/s28383824.jpg');
        expect(upscaleDoubanCover('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg')).toBe('https://img9.doubanio.com/view/photo/l_ratio_poster/public/p480747492.jpg');
        expect(upscaleDoubanCover('https://img9.doubanio.com/view/photo/l/public/p480747492.jpg')).toBe('https://img9.doubanio.com/view/photo/l/public/p480747492.jpg');
    });
    it('非豆瓣图床（tmdb/bangumi/本地 URL）原样返回', () => {
        expect(upscaleDoubanCover('https://image.tmdb.org/t/p/w500/x.jpg')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
        expect(upscaleDoubanCover('https://lain.bgm.tv/pic/cover/l/81/a9/147934_JzMo9.jpg')).toBe('https://lain.bgm.tv/pic/cover/l/81/a9/147934_JzMo9.jpg');
        expect(upscaleDoubanCover('封面/我的世界 Minecraft.jpg')).toBe('封面/我的世界 Minecraft.jpg');
        expect(upscaleDoubanCover(undefined)).toBeUndefined();
    });
});
