// 数据源注册表与源链解析测试（B1：注册表 + 默认链 + 归一 + 解析 + 错误文案推导）
import { describe, it, expect } from 'vitest';
import {
    PROVIDER_META,
    PROVIDERS,
    SOURCE_GROUPS,
    SOURCE_GROUP_ICONS,
    SOURCE_GROUP_COLOR_KEY,
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
    seedSourceChains,
    type ProviderId,
    type SourceGroup,
} from 'pure/sourceRegistry';
import { homeTabIcon } from 'pure/homeTabs';
import { ENTRY_TYPES } from 'data/types';
import { SONG_LIB_ID, SONG_LIB_LABEL } from 'pure/songLibrary';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
            ['openLibrary', null], ['googleBooks', 'googleBooksApiKey'],
            // 🔴 #639 ⑥：Steam 由 `null` 改为带凭据字段 —— **搜索/详情仍免 Key**（storefront API），
            //    但「同步库与游玩时长」走 Web API 的 `GetOwnedGames`，**实测无 Key 直接 401**
            //    ⇒ 挂上字段设置页才渲染凭据行（用户要的「新增 steam 凭据入口」）。
            ['steam', 'steamApiKey'],
            ['musicbrainz', null], ['itunes', null], ['omdb', 'omdbApiKey'], ['anilist', null],
            ['igdb', 'igdbClientId'], ['weread', 'wereadCookie'], // #580：微信读书凭据是 Cookie 不是 Key，但同样走 keyField
        ];
        for (const [id, kf] of keyed) {
            expect(PROVIDER_META[id].keyField, id).toBe(kf);
        }
    });

    it('双凭据源：igdb（Client ID + Secret）、tmdb（API Key + Session ID，#665 账号同步）——已配置需两字段', () => {
        expect(PROVIDER_META.igdb.keyField2).toBe('igdbClientSecret');
        expect(PROVIDER_META.igdb.groups).toEqual(['game']);
        // 🔴 #665：tmdb 也升级为双凭据 —— 搜索只用 API Key，账号同步（watchlist / favorite）要 session_id
        expect(PROVIDER_META.tmdb.keyField2).toBe('tmdbSessionId');
        expect(PROVIDER_META.tmdb.groups).toEqual(['movieTv']);
        // 🔴🔴 #690（用户报障 2026-10-20：「tmdb 填了 API 连接成功但未填 id，显示未配置」）：
        //    tmdb 的 Session ID **只服务同步**（搜索只用 API Key）⇒ 已配置判定只要求主凭据；
        //    而 igdb 缺 Secret 连 token 都换不出来 ⇒ 仍按「两字段同有值」。
        expect(PROVIDER_META.tmdb.keyField2OptionalForConfigured).toBe(true);
        expect(PROVIDER_META.igdb.keyField2OptionalForConfigured).toBeUndefined();
        // 其余源不应误带 keyField2（单凭据源不受影响）
        for (const pid of PROVIDERS.filter((p) => p.id !== 'igdb' && p.id !== 'tmdb').map((p) => p.id)) {
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

describe('候选源矩阵（T1：各组适用源全部 implemented → 候选 = 该组全部源，槽位 ≤4）', () => {
    it('六组候选恰为各组合法源集合（bangumi 服务动画+漫画；openLibrary/googleBooks/weread 仅书籍；comic 三源）', () => {
        const expectSet: Record<SourceGroup, ProviderId[]> = {
            // 🔴 #580：书籍组加了「微信读书」（用户 2026-10-09 点名接入；紧随豆瓣，可选 Cookie 源）⇒ 4 候选
            book: ['douban', 'weread', 'openLibrary', 'googleBooks'],
            game: ['douban', 'steam', 'igdb'],
            music: ['douban', 'musicbrainz', 'itunes'],
            movieTv: ['douban', 'tmdb', 'omdb'],
            anime: ['douban', 'bangumi', 'anilist'],
            comic: ['douban', 'bangumi', 'mangadex'],
        };
        for (const g of SOURCE_GROUPS) {
            const cands = PROVIDERS.filter((p) => p.implemented && p.groups.includes(g)).map((p) => p.id);
            expect(cands, g).toEqual(expectSet[g]);
            // 🔴 #580：书籍组因「微信读书」成为**首个 4 候选组** ⇒ 原「每组 ≤3」槽位上限放宽到 4；
            //    其余五组仍恰 3（由上面的 `expectSet` 精确钉住，⛔ 别删那条）。
            expect(cands.length, g).toBeLessThanOrEqual(4);
        }
    });
});

describe('默认链', () => {
    it('🔴 2026-11-14 用户裁定（m00002 ②）：免登录源不再默认勾选，新用户默认**仅豆瓣一个**', () => {
        //   用户原话：「元数据搜索源启用的免登录源不再默认勾选，新用户默认全勾选仅为豆瓣一个，
        //   其他需用户自己勾选」。
        //   这推翻了 2026-11-12 的「豆瓣 + 各组免登录源兜底」——那条的理由是「开箱即用」，
        //   但代价是把用户没点过的源一起开出去；用户现在要求默认面收窄到只有豆瓣。
        //   ⛔ 别再按 2026-11-12 那条改回多源默认链。
        expect(DEFAULT_CHAINS.book).toEqual(['douban']);
        expect(DEFAULT_CHAINS.game).toEqual(['douban']);
        expect(DEFAULT_CHAINS.music).toEqual(['douban']);
        expect(DEFAULT_CHAINS.movieTv).toEqual(['douban']);
        expect(DEFAULT_CHAINS.anime).toEqual(['douban']);
        expect(DEFAULT_CHAINS.comic).toEqual(['douban']);
    });

    it('🔴 守不变量：默认链里「除豆瓣外」每个源都必须真免登录（keyField === null）', () => {
        //   这是本条需求的核心承诺 —— 默认链里的备用源必须是「不填任何凭据也会发请求、也会出结果」的源，
        //   否则「开箱即用」只是把 403 从一个源换成另一个源的「未配置」。
        //   ⛔ 别把 tmdb / omdb / bangumi / igdb / googleBooks 塞进默认链（它们未配 Key 直接 die）。
        //   ⚠️ steam 是特例：搜索本身免 Key，但 keyField 是 steamApiKey ⇒ providerConfigured 判 false ⇒
        //      在 runAuxSource 里直接返回 unconfigured、根本不发请求，所以同样不许进默认链。
        for (const g of SOURCE_GROUPS) {
            for (const id of DEFAULT_CHAINS[g]) {
                if (id === 'douban') continue;
                expect(PROVIDER_META[id].keyField, `${g} 组默认链里的 ${id} 必须免登录`).toBeNull();
            }
        }
    });

    it('守不变量：豆瓣必须在全部六组的 groups 里 —— 否则链首会被归一滤空、回退默认链成死循环', () => {
        for (const g of ['book', 'game', 'music', 'movieTv', 'anime', 'comic'] as const) {
            expect(PROVIDER_META.douban.groups).toContain(g);
            // 豆瓣永远排在链首（用户选定的口径），⛔ 别把某个免登录源提到豆瓣前面
            expect(DEFAULT_CHAINS[g][0]).toBe('douban');
            // 默认链本身必须经得起归一（不依赖「回退默认链」这条兜底才拿得到）
            expect(normalizeSourceChain(g, [...DEFAULT_CHAINS[g]])).toEqual([...DEFAULT_CHAINS[g]]);
        }
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
    it('未配置（undefined）→ 默认链（2026-11-14 起仅豆瓣）', () => {
        expect(resolveSourceChain(undefined, 'movieTv')).toEqual(['douban']);
        expect(resolveSourceChain(undefined, 'anime')).toEqual(['douban']);
    });

    it('已配置合法链 → 原样（保序）', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb', 'douban'] }, 'movieTv')).toEqual(['tmdb', 'douban']);
    });

    it('已配置空数组/全被滤空 → 回退默认链（脏数据防御）', () => {
        expect(resolveSourceChain({ book: [] }, 'book')).toEqual(['douban']);
        // tmdb 不适用 book 滤空 → 回退默认链
        expect(resolveSourceChain({ book: ['tmdb'] }, 'book')).toEqual(['douban']);
    });

    it('不同组互不影响', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb'] }, 'anime')).toEqual(['douban']);
    });
});

// 🔴 用户 m07854 ①（2026-11-13）：「初始化配置默认启用免登录搜索源，**不要强制覆盖用户已修改过**，
//    仅在第一次启用插件时启用」。播种 = 把默认链写成**显式配置**，让默认值不再靠动态回退生效。
describe('#759 seedSourceChains 一次性播种（用户 m07854 ①）', () => {
    it('从未配置过（undefined）⇒ 六组全部播种成默认链', () => {
        const { chains, changed } = seedSourceChains(undefined);
        expect(changed).toBe(true);
        for (const g of SOURCE_GROUPS) {
            expect(chains[g]).toEqual([...DEFAULT_CHAINS[g]]);
        }
    });

    it('🔴 用户已配置的组**一个字节都不动**（不强制覆盖已修改过）', () => {
        // 用户把影视改成 tmdb 优先、把书籍改成只要 googleBooks —— 与默认链完全不同
        const mine: Partial<Record<SourceGroup, ProviderId[]>> = {
            movieTv: ['tmdb', 'douban'],
            book: ['googleBooks'],
        };
        const { chains } = seedSourceChains(mine);
        expect(chains.movieTv).toEqual(['tmdb', 'douban']);
        expect(chains.book).toEqual(['googleBooks']);
        // 未配置的四组仍被播种
        expect(chains.game).toEqual(['douban']);
        expect(chains.music).toEqual(['douban']);
    });

    it('用户已配的组即使**等于默认链**也保留（不再依赖 undefined 回退）', () => {
        // 这正是旧 `commit` 删键行为留下的坑：勾成与默认一致 ⇒ 键被删 ⇒ 默认值一改就被追溯篡改。
        // 2026-11-14 起默认链只剩豆瓣 ⇒ 这里就用「与默认链完全相同」的 ['douban'] 做主语。
        const { chains } = seedSourceChains({ book: ['douban'] });
        expect(chains.book).toEqual(['douban']);
        expect(Object.prototype.hasOwnProperty.call(chains, 'book')).toBe(true);
    });

    it('空数组 / 整链非法 ⇒ 视为「未配置」，补默认链', () => {
        const { chains, changed } = seedSourceChains({ book: [], movieTv: ['tmdb'] });
        expect(changed).toBe(true);
        expect(chains.book).toEqual(['douban']);
        // tmdb 不适用 movieTv？—— 适用，但旧值原样保留，⛔ 不因「非法」而清空用户值
        expect(chains.movieTv).toEqual(['tmdb']);
    });

    it('幂等：对播种结果再播种 ⇒ changed=false，且值不变', () => {
        const first = seedSourceChains(undefined);
        const second = seedSourceChains(first.chains);
        expect(second.changed).toBe(false);
        expect(second.chains).toEqual(first.chains);
    });

    it('不改动入参（纯函数）', () => {
        const mine: Partial<Record<SourceGroup, ProviderId[]>> = { book: ['googleBooks'] };
        seedSourceChains(mine);
        expect(mine).toEqual({ book: ['googleBooks'] });
        expect(Object.keys(mine)).toHaveLength(1);
    });
});

// 🔴 用户 m07854 ① 的**写入侧**守卫（源码级）：旧实现「等于默认链就删键」必须彻底消失，
//    否则默认值一改仍会追溯篡改用户已确认的配置。⛔ 铁律：先 strip 注释再匹配，
//    不然本文件自己的说明文字就能把反向断言打成假红。
describe('#759 源链写入侧不再「等于默认链就删键」（用户 m07854 ①）', () => {
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const settingsSrc = stripComments(readFileSync(resolve(__dirname, '..', 'src/Settings.ts'), 'utf8'));
    const mainSrc = stripComments(readFileSync(resolve(__dirname, '..', 'main.ts'), 'utf8'));

    it('🔴 `commit` 里不许再出现 `delete next[group]`', () => {
        expect(settingsSrc).not.toMatch(/delete next\[group\]/);
    });

    it('`commit` 必须把归一后的链显式写进 `next[group]`', () => {
        expect(settingsSrc).toMatch(/next\[group\] = norm;/);
        // 且不再因为「与默认链逐位相等」而走删键分支
        expect(settingsSrc).not.toMatch(/norm\.length === def\.length && norm\.every/);
    });

    it('`onload` 里有一次性播种（`sourceChainsSeeded` 守卫 + `seedSourceChains`）', () => {
        expect(mainSrc).toMatch(/if \(!this\.settings\.sourceChainsSeeded\)/);
        expect(mainSrc).toMatch(/seedSourceChains\(this\.settings\.sourceChains\)/);
        expect(mainSrc).toMatch(/this\.settings\.sourceChainsSeeded = true;/);
    });

    it('🔴 播种必须在基线赋值**之后**并**再次**刷新基线（否则播种会被当成用户改链清缓存）', () => {
        const firstBaseline = mainSrc.indexOf('this.sourceChainBaselineJson = JSON.stringify');
        const seedCall = mainSrc.indexOf('seedSourceChains(this.settings.sourceChains)');
        expect(firstBaseline).toBeGreaterThan(-1);
        expect(seedCall).toBeGreaterThan(firstBaseline);
        // 播种块里要有第二处基线刷新
        const afterSeed = mainSrc.slice(seedCall);
        expect(afterSeed.slice(0, 600)).toMatch(/this\.sourceChainBaselineJson = JSON\.stringify/);
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
        expect(err).toBe('Douban 兜底不可用 — 到 设置 → 搜索配置 › 元数据搜索源凭据 · Douban 填登录态 Cookie（含 dbcl2）过反爬；若 Cookie 正常，多为搜索过密触发风控，稍等几分钟再试或改用其他数据源');
        expect(err).toContain('Douban 兜底不可用');
    });

    it('movieTv 豆瓣 cookie 失效 → cookie 失效文案（tmdb 未配置不改变主文案）', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['douban', 'tmdb'],
            douban: { reachable: false, cookieInvalid: true },
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toBe('豆瓣 Cookie 已失效或过期 — 请到 设置 → 搜索配置 › 元数据搜索源凭据 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试');
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
        expect(err).toContain('设置 → 搜索配置 › 元数据搜索源凭据');
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
        expect(err).toContain('设置 → 搜索配置 › 元数据搜索源凭据');
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
        // #580：新增「微信读书」⇒ 12 → 13
        expect(PROVIDERS.length).toBe(13);
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

    it('#580 起「全部源」都至少有一个可识别域名（新增源别忘填 hosts）', () => {
        for (const p of PROVIDERS) {
            expect(p.hosts.length, p.id).toBeGreaterThan(0);
            const url = `https://${p.hosts[0]}/x`;
            expect(providerFromUrl(url), `${p.id} ← ${url}`).toBe(p.id);
        }
    });
});

// 🔴 2026-11-12（用户 m00353 ①-14）：设置-搜索配置页「元数据搜索源启用」六个组名前补类型图标。
//    守的是这条改造最容易静默出错的两处：
//      ① 组增减时图标表漏改 → 渲染端 `SOURCE_GROUP_ICONS[group]` 取到 undefined →
//         `safeSetIcon(host, undefined)` 什么也不画，界面上只剩一个空 span，**零报错**；
//      ② 图标名写错 → `setIcon` 遇未知名**静默 no-op**（见 `services/safeIcon` 文件头），
//         同样零报错但整行组名前一片空白。
//    ⇒ 这里做**双向穷尽**：表里每个 SourceGroup 都要有，且不许出现多余的键。
describe('源链组类型图标（①-14，设置页「元数据搜索源启用」组头）', () => {
    it('六个组一个不多一个不少（组新增必须同步补图标，否则组名前是空白）', () => {
        expect(Object.keys(SOURCE_GROUP_ICONS).sort()).toEqual([...SOURCE_GROUPS].sort());
    });

    it('图标名与本仓页签图标**同一批**（对齐 `homeTabIcon`，⛔ 别另抄一份名字）', () => {
        // 🔴 为什么拿 `homeTabIcon` 当基准：那套名字是本仓唯一「已实测存在于 obsidian.asar
        //    内建表」的图标真源（见 `pure/homeTabs.ts` 里 TAB_ICONS 上方注释）。
        //    `setIcon` 遇未知名**静默失败** ⇒ 写错不报错、界面只剩空白 span，
        //    所以这里用「与页签图标同值」把两边钉在一起：任一边改名，这条就红。
        expect(SOURCE_GROUP_ICONS.book).toBe(homeTabIcon('book'));
        expect(SOURCE_GROUP_ICONS.comic).toBe(homeTabIcon('kind:comic'));
        expect(SOURCE_GROUP_ICONS.movieTv).toBe(homeTabIcon('movie'));
        expect(SOURCE_GROUP_ICONS.anime).toBe(homeTabIcon('anime'));
        expect(SOURCE_GROUP_ICONS.music).toBe(homeTabIcon('music'));
        expect(SOURCE_GROUP_ICONS.game).toBe(homeTabIcon('game'));
    });

    it('漫画与书籍**不许**用同一枚图标（两行在 UI 里紧跟成行，同图标分不出谁是谁）', () => {
        expect(SOURCE_GROUP_ICONS.comic).not.toBe(SOURCE_GROUP_ICONS.book);
    });

    it('取色键全部是合法 EntryType（`movieTv` 合并组取 movie、`comic` 取 book），且六组各自有键', () => {
        expect(Object.keys(SOURCE_GROUP_COLOR_KEY).sort()).toEqual([...SOURCE_GROUPS].sort());
        for (const g of SOURCE_GROUPS) {
            expect(ENTRY_TYPES).toContain(SOURCE_GROUP_COLOR_KEY[g]);
        }
        // 🔴 这两条是「枚举不同构」的实质约定，⛔ 别改成 `SOURCE_GROUP_COLOR_KEY[g] === g`：
        //    `movieTv` / `comic` 都不是 EntryType，直接同构会 undefined → 渲染端取到 `TYPE_COLORS[undefined]`。
        expect(SOURCE_GROUP_COLOR_KEY.movieTv).toBe('movie');
        expect(SOURCE_GROUP_COLOR_KEY.comic).toBe('book');
        expect(SOURCE_GROUP_COLOR_KEY.anime).toBe('anime');
    });
});
