// 数据源注册表与源链解析测试（B1：注册表 + 默认链 + 归一 + 解析 + 错误文案推导）
import { describe, it, expect } from 'vitest';
import {
    PROVIDER_META,
    PROVIDERS,
    SOURCE_GROUPS,
    GROUP_LABELS,
    sourceGroupForType,
    sourceGroupForBookKind,
    normalizeSourceChain,
    resolveSourceChain,
    deriveGroupSearchError,
    sourceLabel,
    sourceEnLabel,
    providerFromUrl,
    platformLabelFromUrl,
    DEFAULT_CHAINS,
    type ProviderId,
    type SourceGroup,
} from 'pure/sourceRegistry';
import { SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';

describe('sourceGroupForType 类型→组映射', () => {
    it('movie/tv 合并到 movieTv，其余类型即组', () => {
        expect(sourceGroupForType('movie')).toBe('movieTv');
        expect(sourceGroupForType('tv')).toBe('movieTv');
        expect(sourceGroupForType('anime')).toBe('anime');
        expect(sourceGroupForType('book')).toBe('book');
        expect(sourceGroupForType('game')).toBe('game');
        expect(sourceGroupForType('music')).toBe('music');
    });
});

describe('注册表元数据', () => {
    it('T1 全 11 源 implemented=true（8 个注册位源已接入，进设置 UI 候选）', () => {
        const all: ProviderId[] = ['douban', 'tmdb', 'bangumi', 'openLibrary', 'googleBooks', 'steam', 'musicbrainz', 'itunes', 'omdb', 'anilist', 'igdb'];
        for (const id of all) {
            expect(PROVIDER_META[id], id).toBeDefined();
            expect(PROVIDER_META[id].implemented, id).toBe(true);
        }
    });

    it('T1 keyField 矩阵：凭据源带 settings 字段名，其余免 Key null', () => {
        const keyed: Array<[ProviderId, string | null]> = [
            ['douban', 'doubanCookie'], ['tmdb', 'tmdbApiKey'], ['bangumi', 'bangumiToken'],
            ['openLibrary', null], ['googleBooks', 'googleBooksApiKey'], ['steam', null],
            ['musicbrainz', null], ['itunes', null], ['omdb', 'omdbApiKey'], ['anilist', null],
            ['igdb', 'igdbClientId'],
        ];
        for (const [id, kf] of keyed) {
            expect(PROVIDER_META[id].keyField, id).toBe(kf);
        }
    });

    it('igdb 双凭据源：keyField=Client ID + keyField2=Client Secret（已配置需两字段）', () => {
        expect(PROVIDER_META.igdb.keyField2).toBe('igdbClientSecret');
        expect(PROVIDER_META.igdb.groups).toEqual(['game']);
        // 其余源不应误带 keyField2（单凭据源不受影响）
        for (const pid of PROVIDERS.filter((p) => p.id !== 'igdb').map((p) => p.id)) {
            expect(PROVIDER_META[pid].keyField2, pid).toBeUndefined();
        }
    });

    it('douban 适用于全部 6 组（2026-09-30 漫画组加回，主源豆瓣）且带 cookie 凭据字段', () => {
        for (const g of SOURCE_GROUPS) {
            expect(PROVIDER_META.douban.groups).toContain(g);
        }
        expect(PROVIDER_META.douban.keyField).toBe('doubanCookie');
    });

    it('组标签齐全（UI 组头用）', () => {
        expect(GROUP_LABELS.movieTv).toBe('影视');
        expect(GROUP_LABELS.book).toBe('书籍');
        expect(GROUP_LABELS.comic).toBe('漫画');
        expect(SOURCE_GROUPS).toEqual(['book', 'game', 'music', 'movieTv', 'anime', 'comic']);
    });
});

describe('候选源矩阵（T1：各组适用源全部 implemented → 候选 = 该组全部源，槽位 ≤3）', () => {
    it('六组候选恰为各组合法源集合（bangumi 服务动画+漫画；openLibrary/googleBooks 仅书籍；comic 三源）', () => {
        const expectSet: Record<SourceGroup, ProviderId[]> = {
            book: ['douban', 'openLibrary', 'googleBooks'],
            game: ['douban', 'steam', 'igdb'],
            music: ['douban', 'musicbrainz', 'itunes'],
            movieTv: ['douban', 'tmdb', 'omdb'],
            anime: ['douban', 'bangumi', 'anilist'],
            comic: ['douban', 'bangumi', 'mangadex'],
        };
        for (const g of SOURCE_GROUPS) {
            const cands = PROVIDERS.filter((p) => p.implemented && p.groups.includes(g)).map((p) => p.id);
            expect(cands, g).toEqual(expectSet[g]);
            expect(cands.length, g).toBeLessThanOrEqual(3);
        }
    });
});

describe('默认链（T1 落上游 D2 表）', () => {
    it('book=douban+openLibrary；game/music/movieTv/anime 不变；comic=豆瓣单源（2026-09-30 加回）', () => {
        expect(DEFAULT_CHAINS.book).toEqual(['douban', 'openLibrary']);
        expect(DEFAULT_CHAINS.game).toEqual(['douban', 'steam']);
        expect(DEFAULT_CHAINS.music).toEqual(['douban', 'musicbrainz', 'itunes']);
        expect(DEFAULT_CHAINS.movieTv).toEqual(['douban', 'tmdb']);
        expect(DEFAULT_CHAINS.anime).toEqual(['douban', 'bangumi']);
        // 🔴 用户裁定「漫画源接豆瓣、Bangumi、MangaDex 三个源」（2026-09-30）：豆瓣为链首主源。
        //    ⚠️ 与 1.0.3 的旧值 ['bangumi','douban'] 不同：那是 Bangumi 主源两源，且那份实现已被删除重建。
        expect(DEFAULT_CHAINS.comic).toEqual(['douban', 'bangumi', 'mangadex']);
    });
});

describe('书籍子分类 → 源链组（sourceGroupForBookKind）', () => {
    it('comic 独立成组；文学 / 网文 / 未指定（undefined）沿用 book 组', () => {
        expect(sourceGroupForBookKind('comic')).toBe('comic');
        expect(sourceGroupForBookKind('book')).toBe('book');
        expect(sourceGroupForBookKind('novel')).toBe('book');
        expect(sourceGroupForBookKind(undefined)).toBe('book');
    });

    it('🔴 comic 三源都要在归一后存活 —— 每个源的 `groups` 必须含 comic（漏一个就被 normalizeSourceChain 静默滤掉）', () => {
        const chain = normalizeSourceChain('comic', ['douban', 'bangumi', 'mangadex']);
        expect(chain).toEqual(['douban', 'bangumi', 'mangadex']);
        // 逐个点名，防「某个源的 groups 漏了 comic」这种只掉一个源的隐性回归
        expect(PROVIDER_META.bangumi.groups).toContain('comic');
        expect(PROVIDER_META.mangadex.groups).toContain('comic');
        expect(PROVIDER_META.douban.groups).toContain('comic');
    });

    it('bangumi 同时服务动画与漫画两组（原来只有 anime）', () => {
        expect(PROVIDER_META.bangumi.groups).toEqual(['anime', 'comic']);
    });

    it('mangadex 免 Key（官方只要求可标识 User-Agent）', () => {
        expect(PROVIDER_META.mangadex.keyField).toBeNull();
        expect(PROVIDER_META.mangadex.hosts).toContain('mangadex.org');
    });
});

describe('normalizeSourceChain 归一', () => {
    it('剔除非法 id / 不适用本组 / 重复，保序；已接入源保留', () => {
        const r = normalizeSourceChain('book', ['douban', 'openLibrary', 'tmdb', 'douban', 'nonsense' as ProviderId]);
        expect(r).toEqual(['douban', 'openLibrary']); // T1 起 openLibrary 已接入故保留；tmdb 不适用 book 剔除；重复 douban 去重
    });

    it('movieTv 组可含 douban/tmdb/omdb（T1 起 omdb 已接入，保序不过滤）', () => {
        const r = normalizeSourceChain('movieTv', ['tmdb', 'omdb', 'douban']);
        expect(r).toEqual(['tmdb', 'omdb', 'douban']);
    });

    it('anime 组滤除 tmdb（影视源不适用动画），保序保留 douban/bangumi', () => {
        const r = normalizeSourceChain('anime', ['tmdb', 'douban', 'bangumi', 'douban']);
        expect(r).toEqual(['douban', 'bangumi']);
    });
});

describe('resolveSourceChain 解析', () => {
    it('未配置（undefined）→ 默认链', () => {
        expect(resolveSourceChain(undefined, 'movieTv')).toEqual(['douban', 'tmdb']);
        expect(resolveSourceChain(undefined, 'anime')).toEqual(['douban', 'bangumi']);
    });

    it('已配置合法链 → 原样（保序）', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb', 'douban'] }, 'movieTv')).toEqual(['tmdb', 'douban']);
    });

    it('已配置空数组/全被滤空 → 回退默认链（脏数据防御）', () => {
        expect(resolveSourceChain({ book: [] }, 'book')).toEqual(['douban', 'openLibrary']);
        expect(resolveSourceChain({ book: ['tmdb'] }, 'book')).toEqual(['douban', 'openLibrary']); // tmdb 不适用 book 滤空 → 回退默认链
    });

    it('不同组互不影响', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb'] }, 'anime')).toEqual(['douban', 'bangumi']);
    });
});

describe('deriveGroupSearchError 全链失败错误推导（默认链回归）', () => {
    it('douban 可达（视为有匹配）→ null，不打扰', () => {
        expect(
            deriveGroupSearchError({
                group: 'book', chain: ['douban'],
                douban: { reachable: true, cookieInvalid: false }, aux: {},
            }),
        ).toBeNull();
    });

    it('book 豆瓣反爬不可达（非 cookie）→ 豆瓣兜底不可用文案', () => {
        const err = deriveGroupSearchError({
            group: 'book', chain: ['douban'],
            douban: { reachable: false, cookieInvalid: false }, aux: {},
        });
        expect(err).toBe('Douban 兜底不可用 — 到 设置 → 元数据源配置 › 元数据源凭据 · Douban 填登录态 Cookie（含 dbcl2）过反爬；若 Cookie 正常，多为搜索过密触发风控，稍等几分钟再试或改用其他数据源');
        expect(err).toContain('Douban 兜底不可用');
    });

    it('movieTv 豆瓣 cookie 失效 → cookie 失效文案（tmdb 未配置不改变主文案）', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['douban', 'tmdb'],
            douban: { reachable: false, cookieInvalid: true },
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toBe('豆瓣 Cookie 已失效或过期 — 请到 设置 → 元数据源配置 › 元数据源凭据 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试');
        expect(err).toContain('豆瓣 Cookie 已失效或过期');
    });

    it('douban 可达 → null；aux failed 不改变 douban 主导结论（derive 仅在整体无结果时被调用）', () => {
        expect(
            deriveGroupSearchError({
                group: 'movieTv', chain: ['douban', 'tmdb'],
                douban: { reachable: true, cookieInvalid: false },
                aux: { tmdb: 'failed' },
            }),
        ).toBeNull();
    });

    it('anime 无 Bangumi Token 且豆瓣正常无匹配 → 未配置 Token 提示', () => {
        const err = deriveGroupSearchError({
            group: 'anime', chain: ['douban', 'bangumi'],
            douban: { reachable: true, cookieInvalid: false },
            aux: { bangumi: 'unconfigured' },
        });
        expect(err).toContain('未配置 Bangumi Access Token，且 Douban 也未找到匹配结果');
    });

    it('anime 无 Bangumi Token 且豆瓣 cookie 失效 → cookie 文案 + 填 Token 尾巴', () => {
        const err = deriveGroupSearchError({
            group: 'anime', chain: ['douban', 'bangumi'],
            douban: { reachable: false, cookieInvalid: true },
            aux: { bangumi: 'unconfigured' },
        });
        expect(err).toContain('豆瓣 Cookie 已失效或过期');
        expect(err).toContain('或填写 Bangumi Token');
    });

    it('anime 无 Bangumi Token 且豆瓣反爬（非 cookie）→ 兜底文案 + 填 Token 尾巴', () => {
        const err = deriveGroupSearchError({
            group: 'anime', chain: ['douban', 'bangumi'],
            douban: { reachable: false, cookieInvalid: false },
            aux: { bangumi: 'unconfigured' },
        });
        expect(err).toContain('Douban 兜底不可用');
        expect(err).toContain('或填写 Bangumi Token');
    });

    it('anime Bangumi 已配但失败、豆瓣正常无匹配 → null（静默空结果，不抛）', () => {
        expect(
            deriveGroupSearchError({
                group: 'anime', chain: ['douban', 'bangumi'],
                douban: { reachable: true, cookieInvalid: false },
                aux: { bangumi: 'failed' },
            }),
        ).toBeNull();
    });

    it('douban 不在链（用户自定义）且全部未配置 → 通用文案列源', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['tmdb'],
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toContain('TMDB');
        expect(err).toContain('未配置');
    });

    it('douban 不在链且源全部请求成功但无匹配 → null（正常空结果）', () => {
        expect(
            deriveGroupSearchError({
                group: 'movieTv', chain: ['tmdb'],
                aux: { tmdb: 'empty' },
            }),
        ).toBeNull();
    });

    it('douban 不在链且混有失败源 → 通用文案列失败源', () => {
        const err = deriveGroupSearchError({
            group: 'anime', chain: ['bangumi'],
            aux: { bangumi: 'failed' },
        });
        expect(err).toContain('Bangumi');
        expect(err).toContain('请求失败');
    });

    // ── 处方文案（批B：失败提示补「怎么办」）──

    it('通用文案：未配置源给出填写路径 + 测试连接', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['tmdb'],
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toContain('未配置凭据');
        expect(err).toContain('设置 → 元数据源配置 › 元数据源凭据');
        expect(err).toContain('测试连接');
    });

    it('通用文案：请求失败源给出「重试 / 换源」两条路子', () => {
        const err = deriveGroupSearchError({
            group: 'game', chain: ['igdb'],
            aux: { igdb: 'failed' },
        });
        expect(err).toContain('请求失败');
        expect(err).toContain('稍后重试');
        expect(err).toContain('改用其他源');
    });

    it('通用文案：未配置与失败并存 → 两类原因并列、两类处方并列', () => {
        const err = deriveGroupSearchError({
            group: 'game', chain: ['steam', 'igdb'],
            aux: { steam: 'unconfigured', igdb: 'failed' },
        });
        expect(err).toContain('Steam 未配置凭据');
        expect(err).toContain('IGDB 请求失败');
        expect(err).toContain('测试连接');
        expect(err).toContain('稍后重试');
    });

    it('通用文案：同类多源合并为一项（不在括号里逐条重复文案）', () => {
        const err = deriveGroupSearchError({
            group: 'music', chain: ['musicbrainz', 'itunes'],
            aux: { musicbrainz: 'failed', itunes: 'failed' },
        });
        expect(err).toContain('MusicBrainz、iTunes 请求失败');
        // 处方只出现一次
        expect(err!.split('稍后重试').length - 1).toBe(1);
    });

    it('anime 缺 Bangumi Token 文案补上填写路径', () => {
        const err = deriveGroupSearchError({
            group: 'anime', chain: ['douban', 'bangumi'],
            douban: { reachable: true, cookieInvalid: false },
            aux: { bangumi: 'unconfigured' },
        });
        expect(err).toContain('设置 → 元数据源配置 › 元数据源凭据');
        expect(err).toContain('Bangumi Token');
    });
});

// 海报墙评分角标的数据源展示名（用户 2026-09-22：「封面右上角大众评分要显示数据源」）。
// 🔴 穷举锁：角标要把来源名直接画在封面上，任何源漏登记都会让角标少半截（静默可读性损失）
//    —— 所以这里对全 11 源逐项比对，并且额外钉「与注册表 label 同源」，防止将来有人再手抄一份小表。
describe('sourceLabel 数据源展示名（评分角标 / data-tip 共用）', () => {
    it('全 11 源穷举：每个 id 都有非空展示名', () => {
        const expected: Array<[ProviderId, string]> = [
            ['douban', '豆瓣'], ['tmdb', 'TMDB'], ['bangumi', 'Bangumi'],
            ['openLibrary', 'Open Library'], ['googleBooks', 'Google Books'],
            ['steam', 'Steam'], ['musicbrainz', 'MusicBrainz'], ['itunes', 'iTunes'],
            ['omdb', 'OMDb'], ['anilist', 'AniList'], ['igdb', 'IGDB'],
        ];
        for (const [id, label] of expected) {
            expect(sourceLabel(id), id).toBe(label);
            expect(sourceLabel(id).length, id).toBeGreaterThan(0);
        }
    });

    it('与注册表 label 同源（单一真源：改 PROVIDERS 即改角标，不另维护手写表）', () => {
        expect(PROVIDERS.length).toBe(12);
        for (const p of PROVIDERS) {
            expect(sourceLabel(p.id), p.id).toBe(p.label);
        }
    });

    it('空值 / 未知 id → 空串（角标退化为「数值★」，绝不显示 undefined / null）', () => {
        for (const bad of [undefined, '', 'rawg', 'tvdb', 'douban ', 'DOUBAN', '豆瓣']) {
            expect(sourceLabel(bad as string | undefined), String(bad)).toBe('');
        }
    });

    it('⛔ 不沿原型链取值（__proto__ / constructor / toString 不得被当成合法源）', () => {
        for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
            expect(sourceLabel(k), k).toBe('');
        }
    });
});

// #464 在线曲库（songlib）**不是元数据源** —— 它不进 PROVIDERS（因此不进设置页勾选、不进 sourceChains），
//   但一样需要展示名：列头 / 结果徽标 / 头部「数据源：」列表 / 选中后自动回填的「来源」框都走这两个入口。
describe('sourceLabel / sourceEnLabel：#464 在线曲库（非元数据源）', () => {
    it('曲库 id 两个入口回**同一份**展示名（⛔ 别让头部/进度行显示 `songlib` 这种原始 id）', () => {
        expect(sourceLabel(SONG_LIB_ID)).toBe(SONG_LIB_LABEL);
        expect(sourceEnLabel(SONG_LIB_ID)).toBe(SONG_LIB_LABEL);
    });

    it('🔴 它**不进注册表**（进了就会变成设置页可勾选的「数据源」并混进源链 —— 曲库是检索，不是元数据源）', () => {
        expect(PROVIDERS.some((p) => p.id === (SONG_LIB_ID as ProviderId))).toBe(false);
    });

    it('这次改动没有放宽未知 id 的老口径（未知仍回空串 / 原样）', () => {
        expect(sourceLabel('rawg')).toBe('');
        expect(sourceEnLabel('rawg' as ProviderId)).toBe('rawg');
    });
});

// 2026-09-27 #385：手填「平台链接」→ 认数据源。
//   用途 = 让海报墙封面角标对手填条目也显示平台名（豆瓣 8.4★），与搜索回填条目表现一致。
//   真源 = 注册表 hosts（⛔ 不另写手写域名小表：#373 那张只覆盖 5 源、键名还写错）。
describe('providerFromUrl 平台链接 → 数据源识别（#385 手填平台链接）', () => {
    it('真实平台页（含子域 / www / 协议 / 端口 / 带路径查询）逐个认出', () => {
        const cases: Array<[string, ProviderId]> = [
            ['https://movie.douban.com/subject/1291546/', 'douban'],
            ['http://www.douban.com/book/subject/1/', 'douban'],
            ['https://douban.com/', 'douban'],
            ['https://www.themoviedb.org/movie/550', 'tmdb'],
            ['https://bangumi.tv/subject/1', 'bangumi'],
            ['https://bgm.tv/subject/1', 'bangumi'],
            ['https://openlibrary.org/works/OL1W', 'openLibrary'],
            ['https://books.google.com/books?id=abc', 'googleBooks'],
            ['https://store.steampowered.com/app/1/', 'steam'],
            ['https://steamcommunity.com/app/1', 'steam'],
            ['https://musicbrainz.org/release/abc', 'musicbrainz'],
            ['https://music.apple.com/cn/album/1', 'itunes'],
            ['https://itunes.apple.com/cn/album/1', 'itunes'],
            ['https://www.imdb.com/title/tt0111161/', 'omdb'],
            ['https://anilist.co/anime/1', 'anilist'],
            ['https://www.igdb.com/games/xyz', 'igdb'],
        ];
        for (const [url, id] of cases) {
            expect(providerFromUrl(url), url).toBe(id);
        }
    });

    it('⛔ 不做子串匹配（含平台名的冒牌域名不得误判）', () => {
        for (const bad of [
            'https://notdouban.com/x',        // 前缀冒充
            'https://douban.com.evil.io/x',   // 后缀冒充
            'https://imdb.com.cn/x',
            'https://xsteampowered.com/x',
        ]) {
            expect(providerFromUrl(bad), bad).toBeNull();
        }
    });

    it('认不出 / 非法 / 空值一律回 null（角标退化为纯数值）', () => {
        for (const bad of [
            '', undefined, '   ',
            'https://example.com/x',
            'https://myanimelist.net/anime/1',
            'movie.douban.com/subject/1/',   // 缺协议头
            'douban.com',
            'not a url',
        ]) {
            expect(providerFromUrl(bad as string | undefined), String(bad)).toBeNull();
        }
    });

    it('大小写与 www 不敏感；平台名经 sourceLabel 取注册表真源', () => {
        expect(providerFromUrl('HTTPS://WWW.DouBan.COM/subject/1/')).toBe('douban');
        expect(platformLabelFromUrl('https://movie.douban.com/subject/1/')).toBe('豆瓣');
        expect(platformLabelFromUrl('https://www.igdb.com/games/x')).toBe('IGDB');
        expect(platformLabelFromUrl('https://example.com/x')).toBe('');
    });

    it('全 11 源都至少有一个可识别域名（新增源别忘填 hosts）', () => {
        for (const p of PROVIDERS) {
            expect(p.hosts.length, p.id).toBeGreaterThan(0);
            const url = `https://${p.hosts[0]}/x`;
            expect(providerFromUrl(url), `${p.id} ← ${url}`).toBe(p.id);
        }
    });
});
