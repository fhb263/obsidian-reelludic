import { describe, expect, it } from 'vitest';
import { BING_RSS_LIMIT, BING_SEARCH_HOST, WEB_SEARCH_TEXT_MAX, bingResultsToText, buildBingRssUrl, compactBingQuery, parseBingRss } from 'pure/bingSearch';

/** 真机抓下来的一条 item（含 CDATA、高亮标签、实体） */
const ITEM = (title: string, link: string, desc: string) =>
    `<item><title>${title}</title><link>${link}</link><description>${desc}</description></item>`;

const FEED =
    '<rss><channel>' +
    ITEM(
        '<![CDATA[周处除三害（2023年黄精甫执导的电影）_百度百科]]>',
        'https://baike.baidu.com/item/x',
        '<![CDATA[《周处除三害》是由<b>黄精甫</b>执导，阮经天主演，于2023年10月6日上映。]]>',
    ) +
    ITEM('周处除三害 - 豆瓣电影', 'https://movie.douban.com/subject/36151692/', '陈桂林找到了线索 &amp; 踏上征途') +
    '<item><title></title><link></link><description>空壳</description></item>' +
    '</channel></rss>';

describe('compactBingQuery（🔴 2026-11-19 实测：中文多段查询会被逐字拆词）', () => {
    it('含空格的中文查询只保留首段（作品名）', () => {
        expect(compactBingQuery('七里香 周杰伦 简介')).toBe('七里香');
        expect(compactBingQuery('名侦探柯南 豆瓣')).toBe('名侦探柯南');
        expect(compactBingQuery('三体 刘慈欣 简介')).toBe('三体');
    });

    it('单段查询原样返回（不折腾已经能用的形态）', () => {
        expect(compactBingQuery('七里香')).toBe('七里香');
        expect(compactBingQuery('名侦探柯南')).toBe('名侦探柯南');
    });

    it('⛔ 英文短语**不**单段化（实测 `The Lord of the Rings` 加不加引号都正常）', () => {
        expect(compactBingQuery('The Lord of the Rings')).toBe('The Lord of the Rings');
        expect(compactBingQuery('Inception')).toBe('Inception');
    });

    it('中英混排仍按中文处理（有 CJK 就单段化）', () => {
        expect(compactBingQuery('SPY×FAMILY 间谍过家家')).toBe('SPY×FAMILY');
    });

    it('多空格折叠 + 首尾空白剥掉；空查询 ⇒ 空串', () => {
        expect(compactBingQuery('  三体   刘慈欣  ')).toBe('三体');
        expect(compactBingQuery('')).toBe('');
        expect(compactBingQuery('   ')).toBe('');
    });
});

describe('buildBingRssUrl（实测口径）', () => {
    it('主机 / 路径 / format=rss / 关键词编码（⛔ 别发明别的参数）', () => {
        const u = buildBingRssUrl('周处除三害 导演');
        expect(u.startsWith(`https://${BING_SEARCH_HOST}/search?q=`)).toBe(true);
        expect(u).toContain('&format=rss');
        // 🔴 多段中文只编码首段（见 `compactBingQuery`；原文见 `probe-bing7.cjs` / `probe-bing8.cjs` 实测）
        expect(u).toContain(encodeURIComponent('周处除三害'));
        expect(u).not.toContain(encodeURIComponent('导演'));
    });

    it('单段查询逐字进 URL，不被截断', () => {
        expect(buildBingRssUrl('七里香')).toContain(encodeURIComponent('七里香'));
    });

    it('🔴 空查询 ⇒ 空串（调用方据此不白跑一次请求）', () => {
        expect(buildBingRssUrl('')).toBe('');
        expect(buildBingRssUrl('   ')).toBe('');
    });
});

describe('parseBingRss', () => {
    it('CDATA 剥掉、实体还原、**高亮标签剥掉**（`<b>黄精甫</b>` → 黄精甫）', () => {
        const items = parseBingRss(FEED);
        expect(items).toHaveLength(2); // 空壳那条被丢掉
        expect(items[0].title).toBe('周处除三害（2023年黄精甫执导的电影）_百度百科');
        expect(items[0].snippet).toBe('《周处除三害》是由黄精甫执导，阮经天主演，于2023年10月6日上映。');
        expect(items[1].snippet).toContain('陈桂林找到了线索 & 踏上征途');
        expect(items[1].link).toBe('https://movie.douban.com/subject/36151692/');
    });

    it('🔴 标题与链接都空的条目**直接丢掉**（留着会让模型把「(无标题)」当成一条结果）', () => {
        expect(parseBingRss('<rss><item><description>x</description></item></rss>')).toEqual([]);
    });

    it('非 RSS / 空串 ⇒ 空数组（不抛）', () => {
        expect(parseBingRss('')).toEqual([]);
        expect(parseBingRss('<html>nope</html>')).toEqual([]);
        expect(parseBingRss(null as unknown as string)).toEqual([]);
    });

    it(`最多取 ${BING_RSS_LIMIT} 条（控 token）`, () => {
        const many = '<rss>' + Array.from({ length: 30 }, (_, i) => ITEM(`t${i}`, `https://a/${i}`, 'd')).join('') + '</rss>';
        expect(parseBingRss(many)).toHaveLength(BING_RSS_LIMIT);
    });
});

describe('bingResultsToText（喂给模型的形态）', () => {
    it('逐行编号 + 标题 + 摘要 + 链接（链接是模型判断「哪条更权威」的唯一线索）', () => {
        const text = bingResultsToText(parseBingRss(FEED));
        expect(text.split('\n')).toHaveLength(2);
        expect(text).toContain('1. 周处除三害（2023年黄精甫执导的电影）_百度百科 —');
        expect(text).toContain('https://movie.douban.com/subject/36151692/');
    });

    it(`总长不超过 ${WEB_SEARCH_TEXT_MAX} 字（防一整页塞进上下文）`, () => {
        const big = parseBingRss(
            '<rss>' + Array.from({ length: 8 }, (_, i) => ITEM(`t${i}`, `https://a/${i}`, 'x'.repeat(600))).join('') + '</rss>',
        );
        expect(bingResultsToText(big).length).toBeLessThanOrEqual(WEB_SEARCH_TEXT_MAX + 200);
    });

    it('空列表 ⇒ 空串', () => {
        expect(bingResultsToText([])).toBe('');
    });
});
