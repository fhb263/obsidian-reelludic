import { describe, expect, it } from 'vitest';
import {
    BING_IMAGE_HOST,
    BING_PAGE_SIZE,
    buildBingImageUrl,
    buildPosterQuery,
    isLikelyPosterImage,
    parseBingImages,
    posterDomainLabel,
    posterReferer,
    posterThumbChain,
    POSTER_QUERY_SUFFIX,
    usablePosterCandidates,
} from 'pure/posterSearch';

/**
 * 夹具 = **真实响应里抠出来的三条**（2026-10-03 实测 `cn.bing.com/images/async?q=繁花`）。
 * 🔴 保留它们在响应里的**原始形态**（整个 JSON 被 `&quot;` 实体化、`&amp;` 出现在 turl 里）——
 *    手抄一份「好看的 JSON」当夹具，等于把「必须先还原实体再 parse」这条最要命的实测口径测掉。
 */
const R1 =
    '{&quot;sid&quot;:&quot;&quot;,&quot;cturl&quot;:&quot;&quot;,&quot;cid&quot;:&quot;25SQhm4X&quot;,&quot;purl&quot;:&quot;https://wenhui.whb.cn/zhuzhan/yingshi/20221103/493588.html&quot;,&quot;murl&quot;:&quot;http://wenhui.whb.cn/u/cms/www/202211/03155700yjdk.jpg&quot;,&quot;turl&quot;:&quot;https://ts1.mm.bing.net/th?id=OIP.25SQhm4X7T-75fgE_FibzAHaNK&amp;pid=15.1&quot;,&quot;md5&quot;:&quot;db9490866e17ed3fbbe5f804fc589bcc&quot;,&quot;shkey&quot;:&quot;evzO5BWkvArEIIoamFe5XEQcl7FG5TS/tQnYjRIyPA0=&quot;,&quot;t&quot;:&quot;王家卫新剧《繁花》发布最新海报及预告片，原著作者金宇澄亮相&quot;,&quot;mid&quot;:&quot;962660048F54A1CA0BE825BEF267F0CC4A5C66EC&quot;,&quot;desc&quot;:&quot;王家卫新剧《繁花》发布最新海报及预告片，原著作者金宇澄亮相&quot;}';
const R2 =
    '{&quot;sid&quot;:&quot;&quot;,&quot;cturl&quot;:&quot;&quot;,&quot;cid&quot;:&quot;DvczLapg&quot;,&quot;purl&quot;:&quot;https://h5.ifeng.com/c/vivo/v002j4ZDB5CXoqPXpFQKXw5jJgIb0-_BizcTRfHC6Gj35Rm8__?isNews=1&quot;,&quot;murl&quot;:&quot;https://x0.ifengimg.com/res/2024/84F0A598897E0953577D43138C1D2E5CFE56371E_size303_w1879_h1280.jpg&quot;,&quot;turl&quot;:&quot;https://ts3.mm.bing.net/th?id=OIP.DvczLapgfv52bwKiaZDxYQHaFC&amp;pid=15.1&quot;,&quot;md5&quot;:&quot;0ef7332daa607efe766f02a26990f161&quot;,&quot;shkey&quot;:&quot;dSvcpVud/XaOex3f9TSotUQaI5SoM1voTmqnO9II/Qk=&quot;,&quot;t&quot;:&quot;从《繁花》看上海出品&quot;,&quot;mid&quot;:&quot;6FF81B45C15A0C50DF79D075566C68B3C3A92AC0&quot;,&quot;desc&quot;:&quot;从《繁花》看上海出品&quot;}';

/** 造一个「像必应那样」的卡片（`m` 之外还有别的属性，验解析不会越界） */
const card = (m: string, extra = '') =>
    `<a class="iusc" style="height:180px;width:132px" m="${m}" data-fnvg="1" ${extra} href="/images/search"></a>`;

describe('buildPosterQuery —— 标题 + 类型词（用户裁定）', () => {
    it('各类型后缀：电影/剧/番 = 海报，书 = 封面，游戏 = cover，音乐 = 专辑封面', () => {
        expect(buildPosterQuery('繁花', 'movie')).toBe('繁花 海报');
        expect(buildPosterQuery('漫长的季节', 'tv')).toBe('漫长的季节 海报');
        expect(buildPosterQuery('葬送的芙莉莲', 'anime')).toBe('葬送的芙莉莲 海报');
        expect(buildPosterQuery('活着', 'book')).toBe('活着 封面');
        expect(buildPosterQuery('艾尔登法环', 'game')).toBe('艾尔登法环 cover');
        expect(buildPosterQuery('范特西', 'music')).toBe('范特西 专辑封面');
    });

    it('书籍按子分类细分（漫画 / 网文）', () => {
        expect(buildPosterQuery('海贼王', 'book', 'comic')).toBe('海贼王 漫画封面');
        expect(buildPosterQuery('诡秘之主', 'book', 'novel')).toBe('诡秘之主 小说封面');
        // 没给 kind ⇒ 回落表里的默认值（不是空串）
        expect(buildPosterQuery('活着', 'book')).toBe('活着 封面');
    });

    it('🔴 标题为空 ⇒ 空串（⛔ 别拿类型词单独去搜：那会搜出一堆与作品无关的图）', () => {
        expect(buildPosterQuery('', 'movie')).toBe('');
        expect(buildPosterQuery('   ', 'book')).toBe('');
    });

    it('标题去首尾空白；🔴 刻意不缀作者（实测「书名+作者」会把作者照片搜出来）', () => {
        expect(buildPosterQuery('  繁花  ', 'tv')).toBe('繁花 海报');
    });

    it('六种类型都有后缀（不漏 key —— 新增类型时 tsc 会在这里报错）', () => {
        for (const t of Object.keys(POSTER_QUERY_SUFFIX)) {
            expect(buildPosterQuery('x', t as never)).not.toBe('x');
        }
    });
});

describe('buildBingImageUrl', () => {
    it('主机 = cn.bing.com，路径 /images/async，参数齐（q / first / count / mmasync）', () => {
        const u = buildBingImageUrl('繁花 海报');
        expect(u.startsWith(`https://${BING_IMAGE_HOST}/images/async?`)).toBe(true);
        expect(u).toContain(`first=1`);
        expect(u).toContain(`count=${BING_PAGE_SIZE}`);
        expect(u).toContain('mmasync=1');
    });

    it('🔴 关键词必须编码（中文 / 空格 / `&`）—— 不编码时 `&` 会把后面那段变成新参数', () => {
        const u = buildBingImageUrl('A & B 海报');
        expect(u).toContain('q=A%20%26%20B%20%E6%B5%B7%E6%8A%A5');
        expect(u).not.toContain('q=A & B');
    });

    it('🔴 分页 = `first = (page-1)*35 + 1`（实测口径，⛔ 别发明 offset）', () => {
        expect(buildBingImageUrl('x', 1)).toContain('first=1');
        expect(buildBingImageUrl('x', 2)).toContain('first=36');
        expect(buildBingImageUrl('x', 3)).toContain('first=71');
    });

    it('非法 / 缺省页码一律回第 1 页（⛔ 不产生 first=0 或 first=NaN）', () => {
        for (const p of [0, -3, NaN, undefined as unknown as number]) {
            expect(buildBingImageUrl('x', p)).toContain('first=1');
        }
    });
});

describe('parseBingImages —— 真实响应形态', () => {
    it('🔴 先还原实体再 parse：三条真实数据都能出结果（且 murl/turl 里的 `&amp;` 已还原成 `&`）', () => {
        const list = parseBingImages(card(R1) + card(R2));
        expect(list).toHaveLength(2);
        expect(list[0].murl).toBe('http://wenhui.whb.cn/u/cms/www/202211/03155700yjdk.jpg');
        // turl 里的 `&amp;` 必须还原成 `&` —— 否则这个地址带着字面量 `&amp;` 去请求，必应会 404
        expect(list[0].turl).toBe('https://ts1.mm.bing.net/th?id=OIP.25SQhm4X7T-75fgE_FibzAHaNK&pid=15.1');
        expect(list[0].title).toContain('王家卫');
    });

    it('来源域名从 `purl` 取（拿它显示「这张来自哪个站」）', () => {
        const list = parseBingImages(card(R1) + card(R2));
        expect(list[0].domain).toBe('wenhui.whb.cn');
        expect(list[1].domain).toBe('h5.ifeng.com');
    });

    it('🔴 一条坏数据不拖累其余（逐条 try/catch）', () => {
        // 形态能匹配到 `m`（有收尾的 `}"`）但 JSON 本身是坏的 ⇒ 必须只丢这一条
        const broken = card('{&quot;murl&quot;:&quot;http://x/a.jpg&quot;,,&quot;t&quot;:&quot;x&quot;}');
        const list = parseBingImages(broken + card(R1));
        expect(list.map((c) => c.domain)).toEqual(['wenhui.whb.cn']);
        expect(parseBingImages(card('{&quot;t&quot;:&quot;没有 murl&quot;}'))).toEqual([]);
    });

    it('🔴 属性值里出现**裸双引号**时，量词 `[^\"]*` 卡住自己那一段 —— 既不产出假候选，也不吞掉后面的条目', () => {
        // 裸 `"` 会在 `{` 之后立刻终止匹配 ⇒ 这条被跳过，而后面的 R1 必须照常解析出来
        const jagged = '<div class="iusc" m="{"murl":"http://a/b.jpg"}" href="/x"></div>';
        const list = parseBingImages(jagged + card(R1));
        expect(list.map((c) => c.domain)).toEqual(['wenhui.whb.cn']);
    });

    it('🔴 按 `murl` 去重（必应同一张图会重复出现），保序', () => {
        const list = parseBingImages(card(R1) + card(R2) + card(R1));
        expect(list).toHaveLength(2);
        expect(list[0].murl).toBe('http://wenhui.whb.cn/u/cms/www/202211/03155700yjdk.jpg');
    });

    it('非 http(s) 的 murl（协议相对 / 空 / javascript:）一律丢', () => {
        const mk = (murl: string) => card(`{&quot;murl&quot;:&quot;${murl}&quot;,&quot;turl&quot;:&quot;https://t/x&quot;}`);
        expect(parseBingImages(mk('//x/a.jpg'))).toEqual([]);
        expect(parseBingImages(mk(''))).toEqual([]);
        expect(parseBingImages(mk('javascript:alert(1)'))).toEqual([]);
    });

    it('空 HTML / 没有 m 属性 ⇒ 空数组（不是抛错 —— 必应偶尔会回一个空壳页）', () => {
        expect(parseBingImages('')).toEqual([]);
        expect(parseBingImages('<html><body>no results</body></html>')).toEqual([]);
    });

    it('🔴 属性值里出现**裸双引号**时，量词 `[^"]*` 卡住自己那一段 —— 既不产出假候选，也不吞掉后面的条目', () => {
        // 裸 `"` 会在 `{` 之后立刻终止匹配 ⇒ 这条被跳过，而后面的 R1 必须照常解析出来
        const jagged = '<div class="iusc" m="{"murl":"http://a/b.jpg"}" href="/x"></div>';
        const list = parseBingImages(jagged + card(R1));
        expect(list.map((c) => c.domain)).toEqual(['wenhui.whb.cn']);
    });

    it('purl 缺失时退回用 murl 的域名（⛔ 不留空）', () => {
        const m = '{&quot;murl&quot;:&quot;https://img.3dmgame.com/a.jpg&quot;,&quot;turl&quot;:&quot;https://ts3.mm.bing.net/th?id=X&pid=15.1&quot;}';
        expect(parseBingImages(card(m))[0].domain).toBe('img.3dmgame.com');
    });
});

describe('posterThumbChain —— 缩略图逐级回退（🔴 实测 ts1 不通、tse1 通）', () => {
    it('bing 缩略图：先原样，再换 `tse1` 同源主机（同一张 id，实测 200）', () => {
        const chain = posterThumbChain('https://ts1.mm.bing.net/th?id=OIP.25SQhm4X7T-75fgE_FibzAHaNK&pid=15.1');
        expect(chain).toEqual([
            'https://ts1.mm.bing.net/th?id=OIP.25SQhm4X7T-75fgE_FibzAHaNK&pid=15.1',
            'https://tse1.mm.bing.net/th?id=OIP.25SQhm4X7T-75fgE_FibzAHaNK&pid=15.1',
        ]);
    });

    it('已是 tse* 主机 ⇒ 不再追加（⛔ 别自己套自己）', () => {
        expect(posterThumbChain('https://tse1.mm.bing.net/th?id=X')).toEqual(['https://tse1.mm.bing.net/th?id=X']);
    });

    it('非 bing 主机（未来换源）⇒ 原样一条，⛔ 不瞎改人家域名', () => {
        expect(posterThumbChain('https://img.3dmgame.com/a.jpg')).toEqual(['https://img.3dmgame.com/a.jpg']);
    });

    it('空值 ⇒ 空数组（调用方据此直接渲染占位块）', () => {
        expect(posterThumbChain('')).toEqual([]);
    });
});

describe('下载 Referer / 展示域名 / 非封面过滤', () => {
    it('🔴 Referer 取**来源站自己**的 origin（很多图站按 Referer 防盗链；⛔ 别带 bing 的）', () => {
        expect(posterReferer('https://wenhui.whb.cn/zhuzhan/yingshi/20221103/493588.html')).toBe('https://wenhui.whb.cn/');
        expect(posterReferer('https://h5.ifeng.com/c/vivo/v002j4?isNews=1')).toBe('https://h5.ifeng.com/');
    });

    it('来源页空 / 非法 ⇒ 空串（调用方就不带这个头，⛔ 别拼一个 `https:///`）', () => {
        expect(posterReferer('')).toBe('');
        expect(posterReferer('not a url')).toBe('');
    });

    it('展示域名：拿不到就写「未知来源」（⛔ 不留空 —— 空着看起来像渲染坏了）', () => {
        expect(posterDomainLabel({ domain: 'wenhui.whb.cn' })).toBe('wenhui.whb.cn');
        expect(posterDomainLabel({ domain: '' })).toBe('未知来源');
        expect(posterDomainLabel({} as never)).toBe('未知来源');
    });

    it('🔴 非图片后缀挡掉（svg 图标 / html 落地页）；⛔ 不按尺寸筛（这条链路拿不到宽高）', () => {
        expect(isLikelyPosterImage({ murl: 'https://x/a.jpg' })).toBe(true);
        expect(isLikelyPosterImage({ murl: 'https://x/a.PNG?v=2' })).toBe(true);
        expect(isLikelyPosterImage({ murl: 'https://x/logo.svg' })).toBe(false);
        expect(isLikelyPosterImage({ murl: 'https://x/a.gif' })).toBe(false);
        expect(isLikelyPosterImage({ murl: 'https://x/landing.html' })).toBe(false);
        expect(
            usablePosterCandidates([
                { murl: 'https://x/a.jpg', turl: '', title: '', page: '', domain: '' },
                { murl: 'https://x/b.svg', turl: '', title: '', page: '', domain: '' },
            ]).map((c) => c.murl),
        ).toEqual(['https://x/a.jpg']);
    });
});
