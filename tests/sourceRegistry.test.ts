// 数据源注册表与源链解析测试（B1：注册表 + 默认链 + 归一 + 解析 + 错误文案推导）
import { describe, it, expect } from 'vitest';
import {
    PROVIDER_META,
    PROVIDERS,
    SOURCE_GROUPS,
    GROUP_LABELS,
    sourceGroupForType,
    normalizeSourceChain,
    resolveSourceChain,
    deriveGroupSearchError,
    DEFAULT_CHAINS,
    type ProviderId,
    type SourceGroup,
} from 'pure/sourceRegistry';

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

    it('douban 适用于全部 5 组（1.0.3.1 起 comic 漫画子组已下线）且带 cookie 凭据字段', () => {
        for (const g of SOURCE_GROUPS) {
            expect(PROVIDER_META.douban.groups).toContain(g);
        }
        expect(PROVIDER_META.douban.keyField).toBe('doubanCookie');
    });

    it('组标签齐全（UI 组头用）', () => {
        expect(GROUP_LABELS.movieTv).toBe('影视');
        expect(GROUP_LABELS.book).toBe('书籍');
        expect(SOURCE_GROUPS).toEqual(['book', 'game', 'music', 'movieTv', 'anime']);
    });
});

describe('候选源矩阵（T1：各组适用源全部 implemented → 候选 = 该组全部源，槽位 ≤3）', () => {
    it('五组候选恰为各组合法源集合（bangumi 仅动画；openLibrary/googleBooks 仅书籍）', () => {
        const expectSet: Record<SourceGroup, ProviderId[]> = {
            book: ['douban', 'openLibrary', 'googleBooks'],
            game: ['douban', 'steam', 'igdb'],
            music: ['douban', 'musicbrainz', 'itunes'],
            movieTv: ['douban', 'tmdb', 'omdb'],
            anime: ['douban', 'bangumi', 'anilist'],
        };
        for (const g of SOURCE_GROUPS) {
            const cands = PROVIDERS.filter((p) => p.implemented && p.groups.includes(g)).map((p) => p.id);
            expect(cands, g).toEqual(expectSet[g]);
            expect(cands.length, g).toBeLessThanOrEqual(3);
        }
    });
});

describe('默认链（T1 落上游 D2 表）', () => {
    it('book=douban+openLibrary；game/music/movieTv/anime 不变（comic 组已随漫画子视图下线）', () => {
        expect(DEFAULT_CHAINS.book).toEqual(['douban', 'openLibrary']);
        expect(DEFAULT_CHAINS.game).toEqual(['douban', 'steam']);
        expect(DEFAULT_CHAINS.music).toEqual(['douban', 'musicbrainz', 'itunes']);
        expect(DEFAULT_CHAINS.movieTv).toEqual(['douban', 'tmdb']);
        expect(DEFAULT_CHAINS.anime).toEqual(['douban', 'bangumi']);
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
        expect(err).toBe('Douban 兜底不可用 — 到 设置 → 服务集成 · Douban 填登录态 Cookie（含 dbcl2）过反爬；若 Cookie 正常，多为搜索过密触发风控，稍等几分钟再试或改用其他数据源');
        expect(err).toContain('Douban 兜底不可用');
    });

    it('movieTv 豆瓣 cookie 失效 → cookie 失效文案（tmdb 未配置不改变主文案）', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['douban', 'tmdb'],
            douban: { reachable: false, cookieInvalid: true },
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toBe('豆瓣 Cookie 已失效或过期 — 请到 设置 → 服务集成 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试');
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
        expect(err).toContain('设置 → 服务集成 · 数据源管理');
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
        expect(err).toContain('设置 → 服务集成 · 数据源管理');
        expect(err).toContain('Bangumi Token');
    });
});
