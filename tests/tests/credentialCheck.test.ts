// #589 开机凭据自检纯逻辑测试：哪些该测 / 键前缀 / 失效判定 / 常量
import { describe, it, expect } from 'vitest';
import {
    CREDENTIAL_CHECK_DELAY_MS,
    DOMESTIC_MUSIC_SOURCES,
    CREDENTIAL_CHECK_GAP_MS,
    EXPIRED_BADGE,
    SELF_CHECK_SOURCES,
    configuredCredentialChecks,
    isExpired,
    musicCheckKey,
    normalizeCredentialStatus,
    sourceCheckKey,
    statusOf,
    withStatus,
    withoutStatus,
} from 'pure/credentialCheck';
// 🔴 #597：国内源的**真源**（注册表标记）与音乐源图标表的键集合
import { PROVIDERS } from 'pure/sourceRegistry';
import { MUSIC_COOKIE_ICON } from 'pure/sourceIcons';

describe('#589 configuredCredentialChecks（只挑「已经填了」的）', () => {
    it('空 settings ⇒ 两族都空（⛔ 别把「没配」也算进来）', () => {
        expect(configuredCredentialChecks(undefined)).toEqual({ sources: [], music: [] });
        expect(configuredCredentialChecks({})).toEqual({ sources: [], music: [] });
        expect(configuredCredentialChecks(null)).toEqual({ sources: [], music: [] });
    });

    it('只填了微信读书 Cookie ⇒ 只有 weread 一条（免 Key 源永远不进）', () => {
        const r = configuredCredentialChecks({ wereadCookie: 'wr_vid=abc' });
        expect(r.sources).toEqual(['weread']);
        expect(r.music).toEqual([]);
    });

    it('空白串 / 非字符串一律不算「已配置」（🔴 #597 起这条改用**国内源**做样本 —— 外源根本进不来了）', () => {
        const r = configuredCredentialChecks({
            doubanCookie: '   ',
            wereadCookie: 123 as unknown as string,
            tmdbApiKey: 'k',
        });
        expect(r.sources).toEqual([]);
    });

    it('🔴🔴 #634 豆瓣**不进**自检（用户：「豆瓣开机显示已失效，但手动测试连接发现没失效」）——'
        + '根因 = 外层 10s 超时 < nodeHttp 内层 30s + 2 次重试，开机冷启动必然误报 ⇒ 白名单里没有它', () => {
        const r = configuredCredentialChecks({ doubanCookie: 'dbcl2=abc', wereadCookie: 'w' });
        expect(r.sources).toEqual(['weread']);
        expect(r.sources).not.toContain('douban');
    });

    it('🔴🔴 #634 元数据源白名单 = `SELF_CHECK_SOURCES`（现役恰 微信读书 一条）；'
        + '判据**不再是** `domestic` —— 两者刻意解耦（`domestic` 仍表达事实，只是不参与自检）', () => {
        expect(SELF_CHECK_SOURCES).toEqual(['weread']);
        // 🔴 反向守卫：白名单里每个 id 必须真在注册表里（⛔ 防手抄一个打错的 id 静默失效 = 那条永不检测）
        for (const id of SELF_CHECK_SOURCES) {
            expect(PROVIDERS.some((p) => p.id === id)).toBe(true);
        }
        // 🔴 豆瓣**仍是**国内源（事实不变），但它**不在**自检名单里（判据已解耦）
        expect(PROVIDERS.find((p) => p.id === 'douban')?.domestic).toBe(true);
        expect(SELF_CHECK_SOURCES).not.toContain('douban');
    });

    it('🔴🔴 #597 用户点名不检测的四件外源（TMDB / Bangumi / Google Books / IGDB）全部不进；'
        + '国内源里只有白名单内的进（#634 起 = 微信读书），⛔ 不是 settings 键的顺序', () => {
        const r = configuredCredentialChecks({
            tmdbApiKey: 'k', doubanCookie: 'c', wereadCookie: 'w', bangumiToken: 't',
            googleBooksApiKey: 'g', igdbClientId: 'i', igdbClientSecret: 's',
            omdbApiKey: 'o',
        });
        expect(r.sources).toEqual(['weread']);
    });

    it('🔴 #597 国内源名单**从注册表派生**（`domestic` 标记），现役恰为 豆瓣 / 微信读书', () => {
        expect(PROVIDERS.filter((p) => p.domestic).map((p) => p.id)).toEqual(['douban', 'weread']);
        // 反向守卫：用户点名的四件必须是**非**国内源
        for (const id of ['tmdb', 'bangumi', 'googleBooks', 'igdb']) {
            expect(PROVIDERS.find((p) => p.id === id)?.domestic).toBe(false);
        }
        // ⛔ 每个源都必须**主动表态**（必填字段），没有 undefined 的漏网
        expect(PROVIDERS.every((p) => typeof p.domestic === 'boolean')).toBe(true);
    });

    it('音乐源：`musicDlCookies` 里**有值**的键才进（空串 / 空白算没填）', () => {
        const r = configuredCredentialChecks({
            musicDlCookies: { netease: 'MUSIC_U=1', qq: '   ', kugou: '' },
        });
        expect(r.music).toEqual(['netease']);
    });

    it('音乐源：`musicDlCookies` 不是对象（脏数据）⇒ 空数组，不抛', () => {
        expect(configuredCredentialChecks({ musicDlCookies: 'oops' }).music).toEqual([]);
        expect(configuredCredentialChecks({ musicDlCookies: null }).music).toEqual([]);
    });

    it('🔴 #597 音乐源只测**国内平台**：现役三平台照测，境外平台键（如 spotify）忽略', () => {
        expect(DOMESTIC_MUSIC_SOURCES).toEqual(['netease', 'qq', 'kugou']);
        expect(configuredCredentialChecks({
            musicDlCookies: { netease: 'a', qq: 'b', kugou: 'c', spotify: 'd' },
        }).music).toEqual(['netease', 'qq', 'kugou']);
    });

    it('🔴 #597 国内音乐源名单与 `MUSIC_COOKIE_ICON` 的键集合**逐项一致**（⛔ 不是手抄两份）', () => {
        expect([...DOMESTIC_MUSIC_SOURCES].sort()).toEqual(Object.keys(MUSIC_COOKIE_ICON).sort());
    });
});

describe('#589 键前缀 / 失效判定 / 节奏常量', () => {
    it('两族键**必须带前缀**（音乐源 id 是 `qq` 这种短名，无前缀迟早与数据源撞车）', () => {
        expect(sourceCheckKey('douban')).toBe('source:douban');
        expect(musicCheckKey('qq')).toBe('music:qq');
        expect(sourceCheckKey('qq')).not.toBe(musicCheckKey('qq'));
    });

    it('🔴 `undefined`（还没测过）**不是**失效 —— 只有 `false` 才是', () => {
        expect(isExpired(false)).toBe(true);
        expect(isExpired(true)).toBe(false);
        expect(isExpired(undefined)).toBe(false);
    });

    it('「连接失败」文案是唯一真源（#634 由「已失效」改名）；延迟与间隔都是正整数毫秒', () => {
        expect(EXPIRED_BADGE).toBe('连接失败');
        expect(CREDENTIAL_CHECK_DELAY_MS).toBeGreaterThan(0);
        expect(CREDENTIAL_CHECK_GAP_MS).toBeGreaterThan(0);
    });
});

// 🔴🔴 用户裁定（1.4.x）：「已测试链接得到的『连接失败』标签要持久化，重启新会话后不要变回『已配置』」。
// 根因 = 结论只活在内存 Map，且豆瓣不在开机自检白名单（#634）⇒ 重启必然回弹。
describe('凭据结论持久化（落盘归一 / 读写）', () => {
    it('只认布尔值：脏数据（字符串 "false" / null / 数字）一律丢掉，⛔ 别把真值串当成结论', () => {
        expect(normalizeCredentialStatus({
            'source:douban': false,
            'music:qq': true,
            'source:tmdb': 'false',
            'source:bad': null,
            'source:num': 0,
            '': true,
        })).toEqual({ 'source:douban': false, 'music:qq': true });
    });

    it('非对象入参 ⇒ 空表（旧 data.json 没有这个键 / 脏数据都不许抛）', () => {
        expect(normalizeCredentialStatus(undefined)).toEqual({});
        expect(normalizeCredentialStatus(null)).toEqual({});
        expect(normalizeCredentialStatus('oops')).toEqual({});
        expect(normalizeCredentialStatus([])).toEqual({});
    });

    it('🔴 没有键 = 还没测过（`undefined`），⛔ 不是 false —— 否则会把「没测」画成「连接失败」', () => {
        const s = { 'source:douban': false };
        expect(statusOf(s, 'source:douban')).toBe(false);
        expect(statusOf(s, 'source:weread')).toBeUndefined();
        // 反向：`withStatus` 只加键，`withoutStatus` 才删
        expect(statusOf(withStatus(s, 'source:weread', true), 'source:weread')).toBe(true);
    });

    it('🔴🔴 重启不回弹：写进去的 false 归一后仍然是 false（这正是「连接失败」要活过重启的那条链路）', () => {
        const saved = withStatus({}, 'source:douban', false);
        const reloaded = normalizeCredentialStatus(JSON.parse(JSON.stringify(saved)));
        expect(statusOf(reloaded, 'source:douban')).toBe(false);
        expect(isExpired(statusOf(reloaded, 'source:douban'))).toBe(true);
    });

    it('withStatus / withoutStatus 都返回**新对象**（⛔ 不原地改，调用方要靠引用变化判断要不要落盘）', () => {
        const base = { 'music:qq': true };
        const added = withStatus(base, 'source:douban', false);
        expect(added).not.toBe(base);
        expect(base).toEqual({ 'music:qq': true });
        const removed = withoutStatus(added, 'music:qq');
        expect(removed).not.toBe(added);
        expect(removed).toEqual({ 'source:douban': false });
        // 删不存在的键 ⇒ 原样返回（不白造对象）
        expect(withoutStatus(base, 'source:nope')).toBe(base);
    });

    it('三族前缀各走各的键（`source:qq` 与 `music:qq` 是两个结论，⛔ 别互相覆盖）', () => {
        let s = withStatus({}, sourceCheckKey('qq'), false);
        s = withStatus(s, musicCheckKey('qq'), true);
        expect(statusOf(s, 'source:qq')).toBe(false);
        expect(statusOf(s, 'music:qq')).toBe(true);
    });
});
