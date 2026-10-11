// #589 开机凭据自检纯逻辑测试：哪些该测 / 键前缀 / 失效判定 / 常量
import { describe, it, expect } from 'vitest';
import {
    CREDENTIAL_CHECK_DELAY_MS,
    DOMESTIC_MUSIC_SOURCES,
    CREDENTIAL_CHECK_GAP_MS,
    EXPIRED_BADGE,
    configuredCredentialChecks,
    isExpired,
    musicCheckKey,
    sourceCheckKey,
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

    it('只填了豆瓣 Cookie ⇒ 只有 douban 一条（免 Key 源永远不进）', () => {
        const r = configuredCredentialChecks({ doubanCookie: 'dbcl2=abc' });
        expect(r.sources).toEqual(['douban']);
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

    it('🔴🔴 #597 IGDB 是**外源** ⇒ 双凭据填齐也不进自检（用户点名「IGDB 不检测」）', () => {
        expect(configuredCredentialChecks({ igdbClientId: 'id', igdbClientSecret: 'sec' }).sources).toEqual([]);
    });

    it('🔴🔴 #597 用户点名不检测的四件外源（TMDB / Bangumi / Google Books / IGDB）全部不进；'
        + '国内源仍按**注册表顺序**（豆瓣 → 微信读书），⛔ 不是 settings 键的顺序', () => {
        const r = configuredCredentialChecks({
            tmdbApiKey: 'k', doubanCookie: 'c', wereadCookie: 'w', bangumiToken: 't',
            googleBooksApiKey: 'g', igdbClientId: 'i', igdbClientSecret: 's',
            omdbApiKey: 'o',
        });
        expect(r.sources).toEqual(['douban', 'weread']);
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

    it('「已失效」文案是唯一真源；延迟与间隔都是正整数毫秒', () => {
        expect(EXPIRED_BADGE).toBe('已失效');
        expect(CREDENTIAL_CHECK_DELAY_MS).toBeGreaterThan(0);
        expect(CREDENTIAL_CHECK_GAP_MS).toBeGreaterThan(0);
    });
});
