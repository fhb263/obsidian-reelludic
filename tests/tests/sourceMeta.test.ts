// 大众评分 / 来源链接的**手动填写**校验测试（2026-09-27 ②）。
//
// 为什么值得单测：这两个值落进 catalog 与笔记「来源 / 大众评分」，错值的后果是**静默存进一个错数**
// （评分超范围、链接缺协议头点不开）。校验口径要钉死在纯函数上，视图层只负责把说明弹给用户。
import { describe, it, expect } from 'vitest';
import {
    COMMUNITY_SCORE_MAX,
    RATING_COUNT_MAX,
    SOURCE_NAME_MAX,
    communityScoreIssue,
    entrySourceLabel,
    parseCommunityScore,
    parseRatingCount,
    parseSourceName,
    parseSourceUrl,
    ratingCountIssue,
    sourceNameIssue,
    sourceUrlIssue,
    splitScoreCount,
} from 'pure/sourceMeta';

describe('communityScoreIssue（大众评分手填校验）', () => {
    it('留空合法（= 不填，落库 undefined，⛔ 不是 0）', () => {
        expect(communityScoreIssue('')).toBeNull();
        expect(communityScoreIssue('   ')).toBeNull();
        expect(parseCommunityScore('')).toBeUndefined();
    });

    it('正常 10 分制输入放行（整数与一位小数）', () => {
        expect(communityScoreIssue('8')).toBeNull();
        expect(communityScoreIssue('8.4')).toBeNull();
        expect(communityScoreIssue('10')).toBeNull();
        expect(communityScoreIssue(' 9.1 ')).toBeNull();
    });

    it('🔴 非数字必须拦下（别让非数字静默变成「不填」）', () => {
        expect(communityScoreIssue('abc')).toMatch(/数字/);
        expect(communityScoreIssue('8分')).toMatch(/数字/);
        expect(communityScoreIssue('8,4')).toMatch(/数字/);
        expect(communityScoreIssue('8.4.1')).toMatch(/数字/);
        expect(communityScoreIssue('-1')).toMatch(/数字/);
    });

    it('🔴 超过 10 必须拦下（10 分制；⛔ 不做「按类型猜分制」的自动换算）', () => {
        expect(communityScoreIssue('10.1')).toMatch(/10/);
        expect(communityScoreIssue('100')).toMatch(/10/);
        expect(communityScoreIssue(String(COMMUNITY_SCORE_MAX + 1))).toMatch(/10/);
    });

    it('0 必须拦下（0 在 schema 里是「未评分」的语义，不是「评分 0」）', () => {
        expect(communityScoreIssue('0')).toMatch(/大于 0/);
        expect(communityScoreIssue('0.0')).toMatch(/大于 0/);
    });

    it('落库数值：最多一位小数（多余位四舍五入），非法 → undefined', () => {
        expect(parseCommunityScore('8')).toBe(8);
        expect(parseCommunityScore('8.4')).toBe(8.4);
        expect(parseCommunityScore(' 8.46 ')).toBe(8.5);
        expect(parseCommunityScore('0')).toBeUndefined();
        expect(parseCommunityScore('11')).toBeUndefined();
        expect(parseCommunityScore('abc')).toBeUndefined();
    });
});

describe('sourceUrlIssue（平台链接手填校验）', () => {
    it('留空合法（= 不填，落库 undefined）', () => {
        expect(sourceUrlIssue('')).toBeNull();
        expect(sourceUrlIssue('   ')).toBeNull();
        expect(parseSourceUrl('')).toBeUndefined();
    });

    it('http / https 绝对地址放行（大小写不敏感）', () => {
        expect(sourceUrlIssue('https://movie.douban.com/subject/1/')).toBeNull();
        expect(sourceUrlIssue('http://example.com/a?b=1&c=2')).toBeNull();
        expect(sourceUrlIssue('HTTPS://EXAMPLE.COM/X')).toBeNull();
    });

    it('🔴 缺协议头必须拦下（与 `openExternalUrl` 的放行口径一致，避免「表单收得下、点开却被拒」）', () => {
        expect(sourceUrlIssue('movie.douban.com/subject/1/')).toMatch(/http/);
        expect(sourceUrlIssue('www.example.com')).toMatch(/http/);
        expect(sourceUrlIssue('ftp://example.com/a')).toMatch(/http/);
        expect(sourceUrlIssue('obsidian://open?vault=x')).toMatch(/http/);
    });

    it('🔴 只有协议头没有主机名也要拦下；协议头后带空格不算绝对地址', () => {
        expect(sourceUrlIssue('https://')).toMatch(/http/);
        expect(sourceUrlIssue('https:// 带空格的地址')).toMatch(/http/);
    });

    it('落库值：去掉首尾空白原样保留（⛔ 不擅自补全或改写）', () => {
        expect(parseSourceUrl('  https://example.com/a  ')).toBe('https://example.com/a');
        expect(parseSourceUrl('www.example.com')).toBeUndefined();
    });
});

// #430：来源名（手填）—— 用户「在大众评分前面并排个来源框（仅第一修改有效，新增后显示为如番茄8星，番茄来源）」
describe('sourceMeta · 来源名（#430）', () => {
    it('留空合法（= 不填，落库 `undefined`，⛔ 不是空串）', () => {
        expect(sourceNameIssue('')).toBeNull();
        expect(sourceNameIssue('   ')).toBeNull();
        expect(parseSourceName('')).toBeUndefined();
        expect(parseSourceName('   ')).toBeUndefined();
    });

    it('正常来源名放行，落库去首尾空白', () => {
        expect(sourceNameIssue('番茄')).toBeNull();
        expect(parseSourceName('  番茄  ')).toBe('番茄');
    });

    it(`🔴 超长要拦下（上限 ${SOURCE_NAME_MAX} —— 它会印在封面角标上，⛔ 别允许一句话）`, () => {
        expect(sourceNameIssue('字'.repeat(SOURCE_NAME_MAX))).toBeNull();
        expect(sourceNameIssue('字'.repeat(SOURCE_NAME_MAX + 1))).toMatch(/来源名最多/);
        expect(parseSourceName('字'.repeat(SOURCE_NAME_MAX + 1))).toBeUndefined();
    });

    it('⚠️ 内部空白折成单个空格（从网页粘带换行的一句进来会把角标顶成两行）', () => {
        expect(parseSourceName('某 来源')).toBe('某 来源');
        expect(parseSourceName('某\n来源\t甲')).toBe('某 来源 甲');
    });

    it('⛔ **不校验「是不是已知数据源」**：自建站 / 出版社 / 私域都能填（拿白名单拦就把框变成选择题了）', () => {
        expect(sourceNameIssue('我家自建的小站')).toBeNull();
        expect(sourceNameIssue('某出版社')).toBeNull();
        expect(sourceNameIssue('example.com')).toBeNull();
    });
});

describe('sourceMeta · 显示用来源名（#430 的唯一裁决入口）', () => {
    it('🔴 **手填优先**：填了就用它，⛔ 不再去看数据源键', () => {
        expect(entrySourceLabel({ sourceName: '番茄', source: 'douban' })).toBe('番茄');
    });

    it('没手填 ⇒ 回落到数据源键的**中文名**（`douban` → 「豆瓣」，⛔ 不是原样吐 id）', () => {
        expect(entrySourceLabel({ source: 'douban' })).toBe('豆瓣');
        expect(entrySourceLabel({ source: 'tmdb' })).toBe('TMDB');
    });

    it('两者都没有 ⇒ 空串（角标退化为纯「8.4★」，⛔ 不出现一个空的来源占位）', () => {
        expect(entrySourceLabel({})).toBe('');
        expect(entrySourceLabel({ sourceName: '   ', source: '' })).toBe('');
        expect(entrySourceLabel({ source: '不认识的键' })).toBe('');
    });
});

// #431：手填的大众评分再加个「评价人数」（用户：「用例如：7 | 500 来表示 7 星 500 人评价」）
describe('sourceMeta · 评价人数（#431）', () => {
    it('留空合法（= 不填，落库 `undefined`，⛔ 不是 0）', () => {
        expect(ratingCountIssue('')).toBeNull();
        expect(ratingCountIssue('   ')).toBeNull();
        expect(parseRatingCount('')).toBeUndefined();
    });

    it('正常人数放行；**允许千分位逗号**（从页面上复制下来的数字常带逗号，为此报错太苛刻）', () => {
        expect(ratingCountIssue('500')).toBeNull();
        expect(parseRatingCount('500')).toBe(500);
        expect(ratingCountIssue('1,234')).toBeNull();
        expect(parseRatingCount('1,234')).toBe(1234);
        expect(parseRatingCount(' 12 ')).toBe(12);
    });

    it('🔴 非数字 / 负数 / 小数点 / 逗号位置不对 ⇒ 拦下（给出去用户看得懂的一句话）', () => {
        expect(ratingCountIssue('五百')).toMatch(/评价人数请填写数字/);
        expect(ratingCountIssue('-1')).toMatch(/评价人数请填写数字/);
        expect(ratingCountIssue('500.5')).toMatch(/评价人数请填写数字/);
        expect(ratingCountIssue('12,34')).toMatch(/评价人数请填写数字/);
        expect(parseRatingCount('五百')).toBeUndefined();
    });

    it(`🔴 超上限拦下（${RATING_COUNT_MAX.toLocaleString('en-US')} —— 纯防手抖多按几个 0）`, () => {
        expect(ratingCountIssue(String(RATING_COUNT_MAX))).toBeNull();
        expect(ratingCountIssue(String(RATING_COUNT_MAX + 1))).toMatch(/评价人数不超过/);
    });
});

describe('sourceMeta · `7 | 500` 一气呵成的写法（#431）', () => {
    it('🔴 含分隔符就拆成两段（半角 `|` 与**全角 `｜`** 都认 —— 中文输入法打出来的是全角）', () => {
        expect(splitScoreCount('7 | 500')).toEqual({ score: '7', count: '500' });
        expect(splitScoreCount('7｜500')).toEqual({ score: '7', count: '500' });
        expect(splitScoreCount(' 8.4|1,234 ')).toEqual({ score: '8.4', count: '1,234' });
    });

    it('⛔ **没有分隔符 ⇒ `null`**（别把光秃秃的 `7` 也拆成「评分 + 空人数」—— 那会让只填评分这条老路径多绕一圈）', () => {
        expect(splitScoreCount('7')).toBeNull();
        expect(splitScoreCount('')).toBeNull();
        expect(splitScoreCount('7.5')).toBeNull();
    });

    it('⚠️ 只切分、**不判合法性**：⛔ 别在这里把非法值洗成空串（那会把错误静默吞掉）', () => {
        expect(splitScoreCount('abc|def')).toEqual({ score: 'abc', count: 'def' });
        expect(splitScoreCount('7|')).toEqual({ score: '7', count: '' });
    });

    it('🔴 拆出来的两段各自过自己的校验（评分走 10 分制、人数走整数）', () => {
        const s = splitScoreCount('11 | 500')!;
        expect(s).not.toBeNull();
        expect(communityScoreIssue(s.score)).toMatch(/不能超过/); // 11 分超上限
        expect(ratingCountIssue(s.count)).toBeNull();
    });
});
