# 元数据源注册表 B1（基建：注册表 + 源链配置 + 编排链驱动 + 设置 UI）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立元数据源注册表与「按类型源链」配置能力——设置页五组折叠自选 ≤3 源及顺序，搜索编排按链执行且默认链行为与现状完全一致。

**Architecture:** 纯逻辑层新增 `pure/sourceRegistry.ts`（ProviderId/SourceGroup 域模型 + 默认链 + 链归一/解析 + 全链失败错误文案推导，全部可 TDD）；`ReelLudicSettings` append-only 追加可选 `sourceChains` 字段（缺省 undefined = 默认链，旧用户零迁移）；main.ts 四个 `searchXFresh` 由硬编码双源改为按链条件执行并统一走错误推导；Settings.ts「服务集成」区重排为「凭据行（保留现有 3 折叠行）+ 每类型源链 5 组折叠编辑」。

**Tech Stack:** TypeScript / Vitest（`tests/` 同位）/ Svelte 无关（本次不动 svelte）/ Obsidian SettingsTab（`src/Settings.ts`）/ esbuild+tsc 构建 → sync → cmp。

**范围边界（B1 不做什么，B2/B4 做）**
- 不接入任何新 HTTP 数据源（openLibrary/steam/musicbrainz/itunes/omdb/anilist 仅注册元数据，`implemented:false` 不进 UI 候选）。
- 不做 N 源（>2）合并——B1 每组最多 2 个 implemented 源，沿用现有 2 元 `mergeBySource`。
- 不改 EntryForm/EntryModal 头部「数据源」栏（B2 接新源时随徽标扩展一起改）。
- 不静默化辅助源失败 Notice（B2 统一改）；B1 辅助源失败仍弹 Notice（保证回归一致）。

**位置偏离说明（vs 设计文档）**：设计文档草案写 `services/registry.ts`，落地放 `pure/sourceRegistry.ts`——该文件是纯数据表 + 纯函数（无 obsidian 依赖、无网络），与 `pure/searchMerge.ts`/`pure/searchDisplay.ts` 同层，可被 Settings.ts 与 main.ts 共同引用且直接单测；services 层留给 B2 的真实 HTTP client。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/pure/sourceRegistry.ts`（新建） | ProviderId/SourceGroup 域 + PROVIDERS 元数据表 + 组候选/默认链 + normalize/resolve + deriveGroupSearchError 错误文案推导 |
| `tests/sourceRegistry.test.ts`（新建） | 上述纯函数全分支单测（TDD 红→绿） |
| `src/Settings.ts`（修改） | ① `ReelLudicSettings.sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>`；② `saveSettings()` 链变更清缓存；③ display()「服务集成」区重排：凭据 3 行 + 五组源链折叠编辑 |
| `src/main.ts`（修改） | 加 `sourceChain()` helper；四个 `searchXFresh` 改为链驱动 + derive 错误；删 `doubanUnavailableError` |
| `styles.css`（修改） | 增 `rl-src-section-label` / `rl-chain-*` 少量样式 |
| `Project-Rule/CHANGELOG.md`、`Project-Rule/current-progress.md`（修改） | 记录本次变更（#164） |

**关键行号锚点（供 Edit 定位；行号可能随前序任务漂移，以函数名/代码文本匹配为准）**
- `src/Settings.ts:9-45` ReelLudicSettings 接口；`:297-361` display() 服务集成区；`:94-151` createSourceRow
- `src/main.ts:36` searchMerge import；`:200-216` saveSettings；`:287-320` doubanFallback + doubanUnavailableError；`:365-501` 四个 searchXFresh
- `styles.css` 尾部（:100 之后追加）

---

### Task 1: pure/sourceRegistry.ts 注册表与链解析（TDD）

**Files:**
- Create: `src/pure/sourceRegistry.ts`
- Test: `tests/sourceRegistry.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/sourceRegistry.test.ts`:

```ts
// 数据源注册表与源链解析测试（B1：注册表 + 默认链 + 归一 + 解析 + 错误文案推导）
import { describe, it, expect } from 'vitest';
import {
    PROVIDER_META,
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
    it('B1 仅 douban/tmdb/bangumi implemented，其余留注册位', () => {
        const ids = ['douban', 'tmdb', 'bangumi', 'openLibrary', 'googleBooks', 'steam', 'musicbrainz', 'itunes', 'omdb', 'anilist'];
        for (const id of ids) {
            expect(PROVIDER_META[id], id).toBeDefined();
        }
        expect(PROVIDER_META.douban.implemented).toBe(true);
        expect(PROVIDER_META.tmdb.implemented).toBe(true);
        expect(PROVIDER_META.bangumi.implemented).toBe(true);
        expect(PROVIDER_META.openLibrary.implemented).toBe(false);
    });

    it('douban 适用于全部 5 组且带 cookie 凭据字段', () => {
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

describe('默认链（= 历史行为）', () => {
    it('书/游戏/音乐单 douban；影视 douban+tmdb；动画 douban+bangumi', () => {
        expect(DEFAULT_CHAINS.book).toEqual(['douban']);
        expect(DEFAULT_CHAINS.game).toEqual(['douban']);
        expect(DEFAULT_CHAINS.music).toEqual(['douban']);
        expect(DEFAULT_CHAINS.movieTv).toEqual(['douban', 'tmdb']);
        expect(DEFAULT_CHAINS.anime).toEqual(['douban', 'bangumi']);
    });
});

describe('normalizeSourceChain 归一', () => {
    it('剔除非法 id / 不适用本组 / 未实现源 / 重复，保序', () => {
        const r = normalizeSourceChain('book', ['douban', 'openLibrary', 'tmdb', 'douban', 'nonsense' as ProviderId]);
        expect(r).toEqual(['douban']); // openLibrary 未实现剔除；tmdb 不适用 book 剔除；重复 douban 去重
    });

    it('movieTv 组可含 douban/tmdb（omdb 未实现剔除）', () => {
        const r = normalizeSourceChain('movieTv', ['tmdb', 'omdb', 'douban']);
        expect(r).toEqual(['tmdb', 'douban']);
    });
});

describe('resolveSourceChain 解析', () => {
    it('未配置（undefined）→ 默认链', () => {
        expect(resolveSourceChain(undefined, 'movieTv')).toEqual(['douban', 'tmdb']);
    });

    it('已配置合法链 → 原样（保序）', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb', 'douban'] }, 'movieTv')).toEqual(['tmdb', 'douban']);
    });

    it('已配置空数组/全被滤空 → 回退默认链（脏数据防御）', () => {
        expect(resolveSourceChain({ book: [] }, 'book')).toEqual(['douban']);
        expect(resolveSourceChain({ book: ['tmdb'] }, 'book')).toEqual(['douban']);
    });

    it('不同组互不影响', () => {
        expect(resolveSourceChain({ movieTv: ['tmdb'] }, 'anime')).toEqual(['douban', 'bangumi']);
    });
});

describe('deriveGroupSearchError 全链失败错误推导（默认链回归）', () => {
    const auxEmpty = {};
    it('有结果（任一 aux ok 或有 douban 匹配）→ null，永不打扰', () => {
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
        expect(err).toContain('Douban 兜底不可用');
    });

    it('movieTv 豆瓣 cookie 失效 → cookie 失效文案（tmdb 未配置不改变主文案）', () => {
        const err = deriveGroupSearchError({
            group: 'movieTv', chain: ['douban', 'tmdb'],
            douban: { reachable: false, cookieInvalid: true },
            aux: { tmdb: 'unconfigured' },
        });
        expect(err).toContain('豆瓣 Cookie 已失效或过期');
    });

    it('movieTv 豆瓣不可达但 tmdb 请求成功（有结果）时调用方不会调用——此处验:有 douban 匹配即 null', () => {
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
});
```

- [ ] **Step 2: 运行确认红**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx vitest run tests/sourceRegistry.test.ts 2>&1 | tail -8`
Expected: FAIL（`Cannot find module 'pure/sourceRegistry'`）

- [ ] **Step 3: 实现 pure/sourceRegistry.ts**

Create `src/pure/sourceRegistry.ts`:

```ts
// 数据源注册表与源链解析（纯数据 + 纯函数，无 obsidian 依赖，可单测）
// B1：douban/tmdb/bangumi 纳入注册表；openLibrary/googleBooks/steam/musicbrainz/itunes/omdb/anilist
// 留注册位（implemented=false，对应批次落地时置 true 即自动进入设置 UI 候选）。
// 凭据全局唯一共享：keyField 为 ReelLudicSettings 字段名（type-only，不 import Settings 避免依赖链）。
import type { EntryType } from 'data/types';

/** 数据源 id（全量注册位） */
export type ProviderId =
    | 'douban' | 'tmdb' | 'bangumi'
    | 'openLibrary' | 'googleBooks' | 'steam' | 'musicbrainz' | 'itunes' | 'omdb' | 'anilist';

/** 源链配置组：五组（movie/tv 共用 movieTv，见 sourceGroupForType） */
export type SourceGroup = 'book' | 'game' | 'music' | 'movieTv' | 'anime';

export const SOURCE_GROUPS: readonly SourceGroup[] = ['book', 'game', 'music', 'movieTv', 'anime'];

/** 组标签（设置页折叠行头、摘要文案） */
export const GROUP_LABELS: Record<SourceGroup, string> = {
    book: '书籍',
    game: '游戏',
    music: '音乐',
    movieTv: '影视',
    anime: '动画',
};

/** 条目类型 → 源链组（movie/tv 共用 movieTv；其余类型即组） */
export function sourceGroupForType(t: EntryType): SourceGroup {
    return t === 'movie' || t === 'tv' ? 'movieTv' : t;
}

export interface ProviderMeta {
    id: ProviderId;
    /** UI 徽标/摘要名 */
    label: string;
    /** 适用组 */
    groups: readonly SourceGroup[];
    /** 凭据字段名（ReelLudicSettings 键；null = 免 Key）——全局唯一共享 */
    keyField: string | null;
    /** 已实现（可被搜索/进设置候选）；false = 注册位 */
    implemented: boolean;
    /** 设置页说明文案（凭据行 hint 用） */
    hint: string;
}

export const PROVIDERS: readonly ProviderMeta[] = [
    {
        id: 'douban', label: '豆瓣', groups: ['book', 'game', 'music', 'movieTv', 'anime'],
        keyField: 'doubanCookie', implemented: true,
        hint: '主力源（默认每类链首）。需登录态 Cookie（含 dbcl2）否则 403：登录 douban.com → F12 复制任意请求的 Cookie 粘贴即可。',
    },
    {
        id: 'tmdb', label: 'TMDB', groups: ['movieTv'],
        keyField: 'tmdbApiKey', implemented: true,
        hint: '影视并排源。themoviedb.org 注册后获取 API Key；配置后与 Douban 并排，未配置仅用 Douban。',
    },
    {
        id: 'bangumi', label: 'Bangumi', groups: ['anime'],
        keyField: 'bangumiToken', implemented: true,
        hint: '动画并排源。bgm.tv → 设置 → 开发 → 创建 Access Token；配置后与 Douban 并排，未配置仅用 Douban。',
    },
    {
        id: 'openLibrary', label: 'Open Library', groups: ['book'],
        keyField: null, implemented: false,
        hint: '书籍第二源（免 Key）：openlibrary.org 开放检索，书名/作者/出版社/年份/ISBN/封面。',
    },
    {
        id: 'googleBooks', label: 'Google Books', groups: ['book'],
        keyField: 'googleBooksApiKey', implemented: false,
        hint: '书籍补充源：ISBN/页数/分类较全；免费额度限流，API Key 可选提升配额。',
    },
    {
        id: 'steam', label: 'Steam', groups: ['game'],
        keyField: null, implemented: false,
        hint: '游戏第二源（免 Key）：Steam 商店公开检索，开发商/发行商/发售日/封面。',
    },
    {
        id: 'musicbrainz', label: 'MusicBrainz', groups: ['music'],
        keyField: null, implemented: false,
        hint: '音乐数据源（免 Key）：厂牌/年份/专辑-曲目关系规范；中文曲库一般。',
    },
    {
        id: 'itunes', label: 'iTunes', groups: ['music'],
        keyField: null, implemented: false,
        hint: '音乐数据源（免 Key）：中文曲库 + 高清封面，与 MusicBrainz 互补。',
    },
    {
        id: 'omdb', label: 'OMDb', groups: ['movieTv'],
        keyField: 'omdbApiKey', implemented: false,
        hint: '影视第三源（需 Key，1000 次/日）：IMDb 数据，英文为主。',
    },
    {
        id: 'anilist', label: 'AniList', groups: ['anime'],
        keyField: null, implemented: false,
        hint: '动画第三源（免 Key，GraphQL）：默认关，中文弱。',
    },
];

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, ProviderMeta>;

/** 各组默认链（= 历史行为：书/游戏/音乐单 Douban，影视 Douban+TMDB，动画 Douban+Bangumi；链首 douban 为主力源不限时） */
export const DEFAULT_CHAINS: Record<SourceGroup, readonly ProviderId[]> = {
    book: ['douban'],
    game: ['douban'],
    music: ['douban'],
    movieTv: ['douban', 'tmdb'],
    anime: ['douban', 'bangumi'],
};

/**
 * 归一源链：剔除非法 id / 不适用本组 / 未实现源 / 重复项，保序。
 * 返回空数组表示整链无效（调用方回退默认链）。
 */
export function normalizeSourceChain(group: SourceGroup, chain: ProviderId[]): ProviderId[] {
    const seen = new Set<ProviderId>();
    const out: ProviderId[] = [];
    for (const id of chain) {
        const meta = PROVIDER_META[id];
        if (!meta) continue;
        if (!meta.groups.includes(group)) continue;
        if (!meta.implemented) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * 解析某组当前生效源链：settings.sourceChains 缺省 / 空 / 整链被滤空 → 默认链。
 * 用户配置只要留有一个合法源即尊重其顺序（可把 douban 挪位/移出）。
 */
export function resolveSourceChain(
    cfg: Partial<Record<SourceGroup, ProviderId[]>> | undefined,
    group: SourceGroup,
): ProviderId[] {
    const saved = cfg?.[group];
    if (!saved || saved.length === 0) return [...DEFAULT_CHAINS[group]];
    const norm = normalizeSourceChain(group, saved);
    return norm.length > 0 ? norm : [...DEFAULT_CHAINS[group]];
}

// ── 全链失败错误文案（与 #163 前现状逐字对齐；设置区仍叫「服务集成」故文案不变）──
const ERR_COOKIE_INVALID = '豆瓣 Cookie 已失效或过期 — 请到 设置 → 服务集成 · Douban 重新登录获取 Cookie（含 dbcl2 登录态）后重试';
const ERR_DOUBAN_UNREACHABLE = 'Douban 兜底不可用（请在 设置 → 服务集成 · Douban 配置 Cookie 过反爬）';
const ERR_ANIME_NO_TOKEN = '未配置 Bangumi Access Token，且 Douban 也未找到匹配结果';
const ERR_ANIME_COOKIE = ERR_COOKIE_INVALID + '，或填写 Bangumi Token';
const ERR_ANIME_UNREACHABLE = '未配置 Bangumi Access Token，且 Douban 兜底不可用（请在 设置 → 服务集成 · Douban 配置 Cookie 过反爬，或填写 Bangumi Token）';

/** 链内非 douban 源在本次搜索中的结果状态（调用方只在「整体无结果」时调用 derive，故无需 'ok'） */
export type AuxState = 'absent' | 'unconfigured' | 'failed' | 'empty';

export interface GroupErrorState {
    group: SourceGroup;
    /** 解析后的生效链（决定 douban 是否参与） */
    chain: ProviderId[];
    /** douban 参与时的状态（不在链则缺省）；reachable=false 表示反爬/不可用（区别于无匹配） */
    douban?: { reachable: boolean; cookieInvalid: boolean };
    /** 链内非 douban 源状态：absent=链外；unconfigured=未配凭据；failed=已配但请求失败；empty=成功无匹配 */
    aux: Record<Exclude<ProviderId, 'douban'>, AuxState>;
}

/**
 * 全链无结果时的错误文案推导（有结果时调用方不应调用——返回 null 不打扰）。
 * 优先级：douban 参与且不可达 → 豆瓣文案（anime 无 Token 时追加填 Token 尾巴）；
 * douban 正常无匹配 → 仅 anime 缺 Token 给提示，其余静默空结果；
 * douban 不在链 → 按各源 unconfigured/failed 汇总通用文案；全 empty → null。
 */
export function deriveGroupSearchError(s: GroupErrorState): string | null {
    const hasDouban = s.chain.includes('douban');
    if (hasDouban && s.douban) {
        const animeNoToken = s.group === 'anime' && s.aux.bangumi === 'unconfigured';
        if (!s.douban.reachable) {
            return s.douban.cookieInvalid
                ? animeNoToken ? ERR_ANIME_COOKIE : ERR_COOKIE_INVALID
                : animeNoToken ? ERR_ANIME_UNREACHABLE : ERR_DOUBAN_UNREACHABLE;
        }
        // douban 正常但无匹配
        if (animeNoToken) return ERR_ANIME_NO_TOKEN;
        return null;
    }
    // douban 不在链：仅当存在未配置/失败源才提示（全 empty = 正常空结果）
    const listed = s.chain.filter((id) => id !== 'douban');
    const bits: string[] = [];
    for (const id of listed) {
        const st = s.aux[id];
        if (st === 'unconfigured') bits.push(`${PROVIDER_META[id].label} 未配置凭据`);
        else if (st === 'failed') bits.push(`${PROVIDER_META[id].label} 请求失败`);
    }
    if (bits.length === 0) return null;
    return `所选数据源不可用（${bits.join('；')}），请到 设置 → 服务集成 检查后重试`;
}
```

- [ ] **Step 4: 运行确认绿**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx vitest run tests/sourceRegistry.test.ts 2>&1 | tail -8`
Expected: PASS（约 16 用例全绿）

- [ ] **Step 5: Commit**

```bash
git add src/pure/sourceRegistry.ts tests/sourceRegistry.test.ts
git commit -m "feat: 数据源注册表 pure/sourceRegistry（组映射/默认链/归一解析/失败文案推导）+ 16 单测"
```

---

### Task 2: Settings.sourceChains 字段 + 链变更清缓存

**Files:**
- Modify: `src/Settings.ts:9-45`（接口追加字段）
- Modify: `src/main.ts:200-216`（saveSettings 链变更检测）

- [ ] **Step 1: 追加 settings 字段**

Edit `src/Settings.ts`——在 `ReelLudicSettings` 接口末尾（`internalMediaPlayback?: boolean;` 之后、`}` 之前）插入：

```ts
    /** 实验性功能：影音本地播放适配 Media Extended（默认 false = 系统播放器；开启后 vault 内文件用 Obsidian 媒体视图播放，库外回退系统） */
    internalMediaPlayback?: boolean;
    /** 每类型源链（五组自选 ≤3 源及顺序；缺省/空 = 默认链，见 pure/sourceRegistry.DEFAULT_CHAINS。append-only 可选字段，旧数据无此键不迁移） */
    sourceChains?: Partial<Record<SourceGroup, ProviderId[]>>;
```

并在文件头 import 区（现有 `import type { ColorTheme } from 'data/types';` 之后）追加类型导入：

```ts
import type { ProviderId, SourceGroup } from 'pure/sourceRegistry';
```

DEFAULT_SETTINGS 不加该键（保持 undefined = 默认链，旧用户零迁移）。

- [ ] **Step 2: main.ts saveSettings 链变更清搜索缓存**

Edit `src/main.ts` 的 `saveSettings()`（现 200-216 行），在凭据比较之外追加链变更比较——凭据或源链任一变化都清搜索/更新检测缓存：

```ts
        // E 缓存失效：凭据变更（豆瓣 Cookie / TMDB Key / Bangumi Token）或源链配置变更 → 清空搜索与更新检测缓存，
        // 防止旧凭据/旧链结果继续命中（searchCache 30min TTL / updateCheckCache 10min TTL）
        const chainChanged =
            JSON.stringify(old.sourceChains ?? {}) !== JSON.stringify(this.settings.sourceChains ?? {});
        if (
            old.doubanCookie !== this.settings.doubanCookie ||
            old.tmdbApiKey !== this.settings.tmdbApiKey ||
            old.bangumiToken !== this.settings.bangumiToken ||
            chainChanged
        ) {
            this.searchCache.clear();
            this.updateCheckCache.clear();
        }
```

- [ ] **Step 3: 类型检查**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx tsc --noEmit 2>&1 | grep -v "styles.css\|\.svelte" | head -10`
Expected: 无新增错误（存量 a11y 类 warning 可忽略；本步只改类型无逻辑跑动）

- [ ] **Step 4: Commit**

```bash
git add src/Settings.ts src/main.ts
git commit -m "feat: settings.sourceChains 可选字段（append-only）+ 链变更清搜索缓存"
```

---

### Task 3: main.ts 编排链驱动（回归等价重写四个 searchXFresh）

**Files:**
- Modify: `src/main.ts:36`（import 行）、`:287-320`（删 doubanUnavailableError）、`:365-501`（四个 fresh 重写）

- [ ] **Step 1: import 注册表纯函数**

Edit `src/main.ts`——在现有 `import { mergeBySource, sortByRelevance } from 'pure/searchMerge';` 之后追加：

```ts
import { resolveSourceChain, deriveGroupSearchError, type SourceGroup, type ProviderId } from 'pure/sourceRegistry';
```

- [ ] **Step 2: 删 doubanUnavailableError、加 sourceChain helper**

删除 `src/main.ts` 中 `doubanUnavailableError` 整个私有方法（现 313-320 行，含上方 JSDoc 注释），改为：

```ts
    /** 解析某组当前生效源链（settings.sourceChains → 归一 → 缺省默认链） */
    private sourceChain(group: SourceGroup): ProviderId[] {
        return resolveSourceChain(this.settings.sourceChains, group);
    }
```

（位置保持在 doubanFallback 之后、fetchDoubanDetailForEntry 之前即可。）

- [ ] **Step 3: 重写 searchMovieTvFresh（影视：链驱动 douban+tmdb）**

将现 371-395 行整函数替换为：

```ts
    private async searchMovieTvFresh(query: string, mediaType: 'movie' | 'tv', onProgress?: SearchProgressCb): Promise<TmdbSearchResult[]> {
        const prog = createSearchProgress(onProgress);
        const chain = this.sourceChain('movieTv');
        const hasDouban = chain.includes('douban');
        const hasTmdb = chain.includes('tmdb') && !!this.settings.tmdbApiKey;
        // TMDB（辅助，5s 超时）与豆瓣（主力，不限时）并行；链不含某源则该源不参与
        const [tmdbItems, db] = await Promise.all([
            (async (): Promise<TmdbSearchResult[]> => {
                if (!hasTmdb) return [];
                try {
                    // 辅助源超时压缩：无代理/慢网络时 5s 内没返回就放弃（豆瓣源先返回即整体完成），不拖慢主链路
                    const r = await withTimeout(this.tmdb.search(query, mediaType), AUX_SEARCH_TIMEOUT, 'TMDB 搜索');
                    prog.next('TMDB 搜索');
                    return r;
                } catch (e) {
                    prog.next('TMDB 搜索');
                    new Notice('TMDB 搜索失败：' + (e instanceof Error ? e.message : String(e)), 6000);
                    return [];
                }
            })(),
            hasDouban
                ? this.doubanFallback(query, mediaType, toTmdbResult, prog)
                : Promise.resolve({ items: [] as TmdbSearchResult[], reachable: true, cookieInvalid: false }),
        ]);
        const merged = sortByRelevance(mergeBySource(tmdbItems, db.items), query);
        // 全链无结果且 douban 参与不可达（Cookie 失效/反爬）：明确提示；辅助源失败不打扰
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'movieTv',
                chain,
                douban: hasDouban ? { reachable: db.reachable, cookieInvalid: db.cookieInvalid } : undefined,
                aux: {
                    // 能走到 derive 说明 tmdbItems 与 db.items 皆空：已配 key 时按「豆瓣是否参与」区分——
                    // 参与（请求已发但整体失败）标 failed / 未参与（未请求）标 empty（静默空）；未配 key = unconfigured
                    tmdb: !chain.includes('tmdb') ? 'absent' : !this.settings.tmdbApiKey ? 'unconfigured' : hasDouban ? 'failed' : 'empty',
                    ...this.emptyAux(),
                },
            });
            if (err) throw new Error(err);
        }
        return merged;
    }
```

**说明**：TMDB 请求失败与「成功但空」无法从 tmdbItems=[] 区分；因 derive 仅在整体无结果时调用（douban 参与且不可达优先命中豆瓣文案；douban 参与且正常 → 非 anime 组返回 null 静默），tmdb 态只影响「douban 不在链」的通用文案分支——该分支下 tmdb 未请求标 empty → 静默空，未配 key 标 unconfigured → 提示。`emptyAux()` 为下一行定义的补全 helper。

- [ ] **Step 4: 加 emptyAux 补全函数**

在类内（searchMovieTvFresh 附近、任意 fresh 之前）加入私有方法——把 aux 中链外源标 'absent'，避免 Record 需要全 9 键：

```ts
    /** deriveGroupSearchError.aux 补全：链外非 douban 源一律 'absent'（调用方可只写链内源） */
    private emptyAux(): Record<Exclude<ProviderId, 'douban'>, 'absent'> {
        return {
            tmdb: 'absent', bangumi: 'absent', openLibrary: 'absent', googleBooks: 'absent',
            steam: 'absent', musicbrainz: 'absent', itunes: 'absent', omdb: 'absent', anilist: 'absent',
        };
    }
```

- [ ] **Step 5: 重写 searchBookFresh / searchGameFresh / searchMusicFresh（单源链驱动）**

将现 404-408 / 417-424 / 433-440 三函数分别替换为（结构相同，仅类型与 mapper 不同）：

```ts
    private async searchBookFresh(query: string, onProgress?: SearchProgressCb): Promise<BookSearchResult[]> {
        const chain = this.sourceChain('book');
        const hasDouban = chain.includes('douban');
        const db = hasDouban
            ? await this.doubanFallback(query, 'book', toBookResult, createSearchProgress(onProgress))
            : { items: [] as BookSearchResult[], reachable: true, cookieInvalid: false };
        const merged = sortByRelevance(mergeBySource([], db.items), query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'book',
                chain,
                douban: hasDouban ? { reachable: db.reachable, cookieInvalid: db.cookieInvalid } : undefined,
                aux: this.emptyAux(),
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    private async searchGameFresh(query: string, onProgress?: SearchProgressCb): Promise<GameSearchResult[]> {
        const chain = this.sourceChain('game');
        const hasDouban = chain.includes('douban');
        const db = hasDouban
            ? await this.doubanFallback(query, 'game', toGameResult, createSearchProgress(onProgress))
            : { items: [] as GameSearchResult[], reachable: true, cookieInvalid: false };
        const merged = sortByRelevance(mergeBySource([], db.items), query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'game',
                chain,
                douban: hasDouban ? { reachable: db.reachable, cookieInvalid: db.cookieInvalid } : undefined,
                aux: this.emptyAux(),
            });
            if (err) throw new Error(err);
        }
        return merged;
    }

    private async searchMusicFresh(query: string, onProgress?: SearchProgressCb): Promise<MusicSearchResult[]> {
        const chain = this.sourceChain('music');
        const hasDouban = chain.includes('douban');
        const db = hasDouban
            ? await this.doubanFallback(query, 'music', toMusicResult, createSearchProgress(onProgress))
            : { items: [] as MusicSearchResult[], reachable: true, cookieInvalid: false };
        const merged = sortByRelevance(mergeBySource([], db.items), query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'music',
                chain,
                douban: hasDouban ? { reachable: db.reachable, cookieInvalid: db.cookieInvalid } : undefined,
                aux: this.emptyAux(),
            });
            if (err) throw new Error(err);
        }
        return merged;
    }
```

（三函数的对外公共方法 searchBook/searchGame/searchMusic 与缓存键不变，无需动。）

- [ ] **Step 6: 重写 searchAnimeFresh（动画：链驱动 douban+bangumi + 详情补全条件化）**

将现 449-500 行整函数替换为：

```ts
    private async searchAnimeFresh(query: string, onProgress?: SearchProgressCb): Promise<BangumiSearchResult[]> {
        const prog = createSearchProgress(onProgress);
        const chain = this.sourceChain('anime');
        const hasDouban = chain.includes('douban');
        const hasBg = chain.includes('bangumi') && !!this.settings.bangumiToken;
        // Bangumi（辅助，5s 超时）与豆瓣（主力，不限时）并行；链不含某源则该源不参与
        const [primary, db] = await Promise.all([
            (async (): Promise<BangumiSearchResult[]> => {
                if (!hasBg) return [];
                try {
                    // 辅助源超时压缩：无代理/慢网络时 5s 内没返回就放弃（豆瓣源先返回即整体完成）
                    const r = await withTimeout(this.bangumi.search(query), AUX_SEARCH_TIMEOUT, 'Bangumi 搜索');
                    prog.next('Bangumi 搜索');
                    return r;
                } catch (e) {
                    prog.next('Bangumi 搜索');
                    new Notice('Bangumi 搜索失败：' + (e instanceof Error ? e.message : String(e)), 6000);
                    return [];
                }
            })(),
            hasDouban
                ? this.doubanFallback(query, 'anime', toBangumiResult, prog)
                : Promise.resolve({ items: [] as BangumiSearchResult[], reachable: true, cookieInvalid: false }),
        ]);
        // Bangumi 搜索结果缺评分/导演/主演（搜索 API 不含）→ 前 3 条并行调详情补全（仅链含 bangumi 且已配 Token 时）
        const head = primary.slice(0, 3);
        const tail = primary.slice(3);
        let enriched: BangumiSearchResult[] = primary;
        if (hasBg && head.length > 0) {
            const n = head.length;
            prog.addRemaining(n);
            const filled = await Promise.all(
                head.map(async (r, i) => {
                    const d = await this.fetchBangumiDetail(r.id, prog, `Bangumi 详情补全 ${i + 1}/${n}`);
                    return {
                        ...r,
                        ...(d.rating != null ? { rating: d.rating } : {}),
                        ...(d.ratingCount != null ? { ratingCount: d.ratingCount } : {}),
                        ...(d.studio ? { studio: d.studio } : {}),
                        ...(d.director ? { director: d.director } : {}),
                        ...(d.cast?.length ? { cast: d.cast } : {}),
                    };
                }),
            );
            enriched = [...filled, ...tail];
        }
        const merged = sortByRelevance(mergeBySource(enriched, db.items), query);
        if (merged.length === 0) {
            const err = deriveGroupSearchError({
                group: 'anime',
                chain,
                douban: hasDouban ? { reachable: db.reachable, cookieInvalid: db.cookieInvalid } : undefined,
                aux: {
                    // 语义同 movieTv 的 tmdb：已配 Token 时按「豆瓣是否参与」区分 failed / empty；未配 = unconfigured
                    bangumi: !chain.includes('bangumi') ? 'absent' : !this.settings.bangumiToken ? 'unconfigured' : hasDouban ? 'failed' : 'empty',
                    ...this.emptyAux(),
                },
            });
            if (err) throw new Error(err);
        }
        return merged;
    }
```

- [ ] **Step 7: tsc + 回归单测**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx tsc --noEmit 2>&1 | grep -v "styles.css\|\.svelte" | head -10 && npx vitest run 2>&1 | tail -6`
Expected: tsc 无新增错误；全套测试绿（存量套件不回归）

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat: 搜索编排链驱动（四组按 sourceChains 执行，默认链行为回归一致；错误推导统一走 pure）"
```

---

### Task 4: 设置页「服务集成」区重排（凭据行 + 五组源链折叠编辑）

**UI 审批锚点**：以下实现对应已获批设计 D3 的语义（每类型自选 ≤3 源及顺序、凭据全局唯一共享）。布局为两小节：凭据行（复用现有 createSourceRow，零行为变化）+ 五组折叠行（新）。改动前/后 ASCII 见交付消息，若用户要求调整此处实现随之修改。

**Files:**
- Modify: `src/Settings.ts`（import 区、display() 服务集成区、新增私有方法）

- [ ] **Step 1: import 注册表**

Edit `src/Settings.ts`——在 `import type { ProviderId, SourceGroup } from 'pure/sourceRegistry';` 之后追加值导入（Task 2 加的 type import 保留）：

```ts
import {
    PROVIDERS, PROVIDER_META, SOURCE_GROUPS, GROUP_LABELS,
    resolveSourceChain, normalizeSourceChain, DEFAULT_CHAINS,
} from 'pure/sourceRegistry';
```

- [ ] **Step 2: 新增私有方法（createChainRow + 内部编辑器）**

在 `ReelLudicSettingTab` 类内、`createSecretField` 方法之后（`:157-175` 后）插入以下两个私有方法：

```ts
    /** 某组当前链摘要（头部行显示）：如「豆瓣 → TMDB」 */
    private chainSummary(group: SourceGroup): string {
        return resolveSourceChain(this.plugin.settings.sourceChains, group)
            .map((id) => PROVIDER_META[id].label)
            .join(' → ');
    }

    /** 该组可用的已实现源（设置 UI 候选）：implemented 且 groups 含本组 */
    private chainCandidates(group: SourceGroup) {
        return PROVIDERS.filter((p) => p.implemented && p.groups.includes(group));
    }

    /**
     * 创建「每类型源链」折叠行：头部 = 组名 + 当前链摘要 + 状态（含未配置凭据的源数）+ ▸；
     * 展开后为槽位编辑（select 换源/清位、↑↓ 排序、✕ 移除、尾部「＋ 添加」），≤3 位、至少保留 1 位。
     * 每次变更：归一 → 写 settings.sourceChains（等于默认链则删键保持 undefined）→ saveSettings → 局部重建编辑器。
     */
    private createChainRow(containerEl: HTMLElement, group: SourceGroup): void {
        const row = containerEl.createDiv({ cls: 'rl-src-row' });
        const header = row.createDiv({ cls: 'rl-src-header' });
        header.createSpan({ cls: 'rl-src-name', text: GROUP_LABELS[group] });
        const summaryEl = header.createSpan({ cls: 'rl-src-name-platform' });
        const statusEl = header.createSpan({ cls: 'rl-src-status' });
        header.createSpan({ cls: 'rl-src-chevron', text: '▸' });
        const body = row.createDiv({ cls: 'rl-src-body rl-src-collapsed' });

        const candidates = this.chainCandidates(group);

        const refreshHeader = (): void => {
            const chain = resolveSourceChain(this.plugin.settings.sourceChains, group);
            summaryEl.setText(' · ' + this.chainSummary(group));
            // 链内需凭据源未配置计数 → 「2 源未配置」提示；全配则隐藏
            const unconf = chain.filter((id) => {
                const m = PROVIDER_META[id];
                return m.keyField && !(this.plugin.settings as unknown as Record<string, unknown>)[m.keyField];
            }).length;
            statusEl.setText(unconf > 0 ? `${unconf} 源未配置` : '已配置');
            statusEl.toggleClass('rl-src-status-on', unconf === 0);
        };

        /** 读当前链（编辑用快照，每次重建前刷新） */
        const currentChain = (): ProviderId[] => resolveSourceChain(this.plugin.settings.sourceChains, group);

        /** 归一 + 落盘 + 刷新头部与编辑器 */
        const commit = (draft: ProviderId[]): void => {
            const norm = normalizeSourceChain(group, draft);
            if (norm.length === 0) return; // 至少保留 1 源（✕/清位在 UI 层已禁用，此处兜底）
            const next = { ...(this.plugin.settings.sourceChains ?? {}) };
            const def = DEFAULT_CHAINS[group];
            if (norm.length === def.length && norm.every((id, i) => id === def[i])) {
                delete next[group];
            } else {
                next[group] = norm;
            }
            this.plugin.settings.sourceChains = Object.keys(next).length > 0 ? next : undefined;
            void this.plugin.saveSettings();
            refreshHeader();
            renderEditor();
        };

        const renderEditor = (): void => {
            body.empty();
            // 组专属提示（每行一个，重建编辑器时一并重建）
            body.createDiv({
                cls: 'rl-src-hint',
                text: '该类型搜索参与的数据源与顺序（最多 3 个，第 1 个为主力源不限时，其余 5s 超时辅助）。凭据在下方「凭据」小节配置一次、全局共用；此处徽标仅标记是否已配置。',
            });
            const chain = currentChain();
            // 尾随空槽：链 < 3 且还有候选未用 → 渲染一个 value='' 的添加槽（只列未用候选）
            const used = new Set(chain);
            const remaining = candidates.filter((c) => !used.has(c.id));
            const slotCount = Math.min(3, chain.length + (chain.length < 3 && remaining.length > 0 ? 1 : 0));
            for (let i = 0; i < slotCount; i++) {
                const line = body.createDiv({ cls: 'rl-chain-line' });
                const isAddSlot = i >= chain.length;
                const current = isAddSlot ? null : chain[i];
                const select = line.createEl('select', { cls: 'rl-chain-select' });
                if (isAddSlot) {
                    const ph = select.createEl('option', { value: '', text: '＋ 添加源…' });
                    ph.disabled = true;
                    ph.selected = true;
                }
                for (const c of isAddSlot ? remaining : candidates) {
                    const opt = select.createEl('option', { value: c.id, text: c.label + (c.keyField ? '（需凭据）' : '（免Key）') });
                    opt.selected = c.id === current;
                    if (!isAddSlot && c.id !== current && used.has(c.id)) opt.disabled = true; // 其它槽已用
                }
                select.addEventListener('change', () => {
                    const v = select.value as ProviderId;
                    if (!v) return; // 空占位不可选，防御
                    if (isAddSlot) {
                        commit([...chain, v]);
                    } else {
                        commit(chain.map((id, idx) => (idx === i ? v : id)));
                    }
                });
                // 每槽提供「— 移除」选项？不：用 ✕ 按钮移除（select 无空项时保持当前值）
                const badge = line.createSpan({ cls: 'rl-chain-badge' });
                if (current) {
                    const m = PROVIDER_META[current];
                    if (m.keyField) {
                        const has = !!(this.plugin.settings as unknown as Record<string, unknown>)[m.keyField];
                        badge.setText(has ? '已配置' : '未配置');
                        badge.toggleClass('rl-chain-badge-on', has);
                    } else {
                        badge.setText('免Key');
                        badge.toggleClass('rl-chain-badge-on', true);
                    }
                }
                if (!isAddSlot) {
                    const up = line.createEl('button', { cls: 'rl-chain-btn', text: '↑', attr: { title: '上移', type: 'button' } });
                    up.disabled = i === 0;
                    up.addEventListener('click', () => {
                        const d = [...chain];
                        [d[i - 1], d[i]] = [d[i], d[i - 1]];
                        commit(d);
                    });
                    const down = line.createEl('button', { cls: 'rl-chain-btn', text: '↓', attr: { title: '下移', type: 'button' } });
                    down.disabled = i >= chain.length - 1;
                    down.addEventListener('click', () => {
                        const d = [...chain];
                        [d[i + 1], d[i]] = [d[i], d[i + 1]];
                        commit(d);
                    });
                    const del = line.createEl('button', { cls: 'rl-chain-btn rl-chain-del', text: '✕', attr: { title: '移除该源', type: 'button' } });
                    del.disabled = chain.length <= 1; // 至少保留 1 源
                    del.addEventListener('click', () => commit(chain.filter((_, idx) => idx !== i)));
                }
            }
        };

        refreshHeader();
        renderEditor();
        header.addEventListener('click', () => {
            const wasCollapsed = body.hasClass('rl-src-collapsed');
            body.toggleClass('rl-src-collapsed', !wasCollapsed);
            row.toggleClass('rl-src-row-expanded', wasCollapsed);
        });
        body.addClass('rl-src-collapsed'); // 默认收起
    }
```

- [ ] **Step 3: display() 服务集成区重排**

将 `src/Settings.ts:297-361` 整段（`// ──────────── 服务集成（数据源）────────────` 注释到 `});` 结束的 Bangumi createSourceRow）替换为：

```ts
        // ──────────── 服务集成（数据源）────────────
        new Setting(containerEl).setHeading().setName('服务集成');

        // ① 凭据（全局唯一，一次配置所有类型生效；凭据行 = 原 3 折叠行，行为不变）
        containerEl.createDiv({ cls: 'rl-src-section-label', text: '凭据（全局唯一，一次配置所有类型生效）' });

        // 1. Douban（主力源，默认每类链首）
        this.createSourceRow(containerEl, {
            name: '全类型 · Douban',
            isConfigured: () => !!this.plugin.settings.doubanCookie,
            buildBody: (body) => {
                body.createDiv({
                    cls: 'rl-src-hint',
                    text: '主力源（默认每类链首）。需登录态 Cookie（含 dbcl2）否则 403：登录 douban.com → F12 复制任意请求的 Cookie 粘贴即可。',
                });
                this.createSecretField(body, {
                    placeholder: 'Douban Cookie（必填，登录态）',
                    value: this.plugin.settings.doubanCookie,
                    onInput: (v) => {
                        this.plugin.settings.doubanCookie = v;
                        void this.plugin.saveSettings();
                    },
                });
            },
            test: () => this.plugin.testDoubanConnection(),
        });

        // 2. 电影/电视剧（TMDB，影视组与 Douban 并排）
        this.createSourceRow(containerEl, {
            name: '影视 · TMDB',
            isConfigured: () => !!this.plugin.settings.tmdbApiKey,
            buildBody: (body) => {
                body.createDiv({
                    cls: 'rl-src-hint',
                    text: '影视组第二源。themoviedb.org 注册后获取 API Key。配置后在「影视」源链中可用，未配置仅用 Douban。',
                });
                this.createSecretField(body, {
                    placeholder: '输入 TMDB API Key',
                    value: this.plugin.settings.tmdbApiKey,
                    onInput: (v) => {
                        this.plugin.settings.tmdbApiKey = v;
                        void this.plugin.saveSettings();
                    },
                });
            },
            test: () => this.plugin.testTmdbConnection(),
        });

        // 3. 动画（Bangumi，动画组与 Douban 并排）
        this.createSourceRow(containerEl, {
            name: '动画 · Bangumi',
            isConfigured: () => !!this.plugin.settings.bangumiToken,
            buildBody: (body) => {
                body.createDiv({
                    cls: 'rl-src-hint',
                    text: '动画组第二源。bgm.tv → 设置 → 开发 → 创建 Access Token。配置后在「动画」源链中可用，未配置仅用 Douban。',
                });
                this.createSecretField(body, {
                    placeholder: '输入 Bangumi Access Token',
                    value: this.plugin.settings.bangumiToken,
                    onInput: (v) => {
                        this.plugin.settings.bangumiToken = v;
                        void this.plugin.saveSettings();
                    },
                });
            },
            test: () => this.plugin.testBangumiConnection(),
        });

        // ② 每类型源链（自选 ≤3 源与顺序；链首为主力源不限时，其余 5s 超时辅助）
        containerEl.createDiv({
            cls: 'rl-src-section-label',
            text: '每类型源链（该类型搜索参与的数据源与顺序，最多 3 个；第 1 个为主力源）',
        });
        for (const g of SOURCE_GROUPS) {
            this.createChainRow(containerEl, g);
        }
```

- [ ] **Step 4: tsc 校验**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx tsc --noEmit 2>&1 | grep -v "styles.css\|\.svelte" | head -10`
Expected: 无新增错误。若报 `header.createSpan` 链式返回类型问题，按行拆分赋值（createSpan 返回 HTMLSpanElement，链式 OK）。

- [ ] **Step 5: Commit**

```bash
git add src/Settings.ts
git commit -m "feat: 设置页服务集成区重排——凭据行保留 + 五组源链折叠编辑（自选 ≤3 源/排序/移除）"
```

---

### Task 5: styles.css 增补 rl-src-section-label / rl-chain-*

**Files:**
- Modify: `styles.css`（文件尾追加小节）

- [ ] **Step 1: 追加样式**

Edit `styles.css`——在文件末尾追加：

```css
/* ── 设置页：数据源链编辑（rl-chain-* / rl-src-section-label，2026-09-02 源链自选 B1） ── */
.rl-src-section-label {
    margin: 12px 0 4px;
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    font-weight: 500;
}
.rl-src-section-label + .rl-src-row { margin-top: 2px; }
.rl-chain-line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 5px 0;
}
.rl-chain-select {
    flex: 1;
    min-width: 0;
    max-width: 260px;
    background: var(--background-secondary-alt);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    padding: 3px 6px;
    font-size: var(--font-ui-small);
}
.rl-chain-badge {
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    white-space: nowrap;
}
.rl-chain-badge-on { color: var(--color-green); }
.rl-chain-btn {
    padding: 0 7px;
    height: 24px;
    line-height: 24px;
    border-radius: var(--radius-s);
    background: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-normal);
    cursor: pointer;
    font-size: var(--font-ui-smaller);
}
.rl-chain-btn:disabled { opacity: 0.4; cursor: default; }
.rl-chain-btn:hover:not(:disabled) { background: var(--background-modifier-hover); }
.rl-chain-del { color: var(--text-muted); }
.rl-chain-del:hover:not(:disabled) { color: var(--text-error); }
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat: 源链编辑器样式（rl-chain-*/rl-src-section-label）"
```

---

### Task 6: 回归验证（测试 + 构建 + sync + cmp + grep）

**Files:** 无代码改动（验证 + 记录）

- [ ] **Step 1: 全量单测**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx vitest run 2>&1 | tail -6`
Expected: 全绿（存量 ~480 + sourceRegistry 新增 ~16）

- [ ] **Step 2: 构建**

Run: `cd "C:\Users\kest\Desktop\obsidian-reelludic" && npm run build 2>&1 | tail -5`
Expected: tsc + esbuild 通过（存量 a11y warnings 可忽略）

- [ ] **Step 3: 同步测试库并 cmp 三产物**

Run: `powershell -ExecutionPolicy Bypass -File "C:\Users\kest\Desktop\obsidian-reelludic\build\sync_plugin.ps1"`

Run:
```bash
cd "C:\Users\kest\Desktop\obsidian-reelludic" && cmp build/main.js "C:\Users\kest\Desktop\临时测试库\.obsidian\plugins\obsidian-reelludic\main.js" && cmp build/styles.css "C:\Users\kest\Desktop\临时测试库\.obsidian\plugins\obsidian-reelludic\styles.css" && cmp build/manifest.json "C:\Users\kest\Desktop\临时测试库\.obsidian\plugins\obsidian-reelludic\manifest.json" && echo "ALL 3 FILES MATCH"
```
Expected: `ALL 3 FILES MATCH`

- [ ] **Step 4: 产物符号断言**

Run:
```bash
cd "C:\Users\kest\Desktop\obsidian-reelludic" && echo "--- 新符号 ---" && grep -o "sourceChains\|deriveGroupSearchError\|resolveSourceChain\|createChainRow\|rl-chain-line" build/main.js build/styles.css 2>/dev/null | sort | uniq -c && echo "--- 旧 doubanUnavailableError 残留（应为 0） ---" && grep -c "doubanUnavailableError" build/main.js; echo "--- 服务集成三行 UI name 残留（应只有新文案） ---" && grep -o "图书/电影/电视剧/游戏/音乐 · Douban" build/main.js | wc -l
```
Expected: 新符号均 >0；doubanUnavailableError 计数输出 0；旧 douban 行名 0。

- [ ] **Step 5: 手工冒烟（记录于 CHANGELOG）**

在测试库 Obsidian 中：
1. 设置 → 服务集成：确认「凭据」小节 3 行折叠 + 「每类型源链」5 行折叠；展开影视组可见槽 1 豆瓣（已配置/未配置徽标）、槽 2 TMDB；「＋ 添加源」不出现（候选已尽）。
2. 把影视组槽 2 TMDB 移除 → 展开另组再展开影视组：摘要变为「豆瓣」，持久化（重开设置仍在）。
3. 重新加回 TMDB 或用 ✕/↑↓ 调序 → 保存后各类型添加条目搜索仍正常（5 组搜索可用）。
4. 新增条目 → 影视搜索「黑客帝国」返回豆瓣 + TMDB 结果（回归）；Ctrl+P 已 Reload。

（冒烟结果由执行者回填至本步骤勾选说明，异常走 systematic-debugging。）

---

### Task 7: CHANGELOG + current-progress + 记忆 + 收尾提交

**Files:**
- Modify: `Project-Rule/CHANGELOG.md`、`Project-Rule/current-progress.md`
- Modify: `.workbuddy/memory/2026-09-02.md`（追加）

- [ ] **Step 1: 更新 CHANGELOG 顶部**

在 `Project-Rule/CHANGELOG.md` 顶部（`## [Unreleased]` 或最近版本标题下）追加一条变更，格式仿照既有条目，含：
- 标题：`feat: 数据源注册表 B1——设置页五组源链自选 + 搜索编排链驱动（设计 2026-09-02-metadata-source-registry）`
- 要点：① pure/sourceRegistry（10 源注册位、组映射、默认链、归一/解析、全链失败文案推导 +16 单测）；② settings.sourceChains 可选字段（缺省=默认链，旧数据零迁移；链变更清搜索缓存）；③ 四组 searchXFresh 改链驱动，默认链行为与既往逐字一致（含错误文案），douban 移出链时走新通用文案；④ 设置页服务集成区：凭据行（原 3 折叠行保留）+ 五组源链折叠编辑器（≤3 槽 select 换源 / ↑↓ 排序 / ✕ 移除 / ＋添加，至少保留 1 源，等于默认链即删键）；⑤ EntryForm 头部数据源栏联动与 N 源合并留 B2。
- 验证：全量单测绿（+16）；tsc+esbuild 通过；三产物 cmp IDENTICAL；产物符号 grep 断言；提交 commit 哈希（`git log --oneline -6` 摘录本批）。

- [ ] **Step 2: 更新 current-progress**

在 `Project-Rule/current-progress.md` 表格末追加一行（序号接续 #163），格式仿照既有行（含 commit 哈希）。

- [ ] **Step 3: 写工作日志**

追加 `.workbuddy/memory/2026-09-02.md`：B1 落地（文件清单、行为回归要点、默认链=历史行为语义、设置 UI 结构、B2 待办：新源 client + EntryForm 数据源栏联动 + N 源合并）。

- [ ] **Step 4: 最终复核 + 提交**

Run:
```bash
cd "C:\Users\kest\Desktop\obsidian-reelludic" && npx vitest run 2>&1 | tail -3 && git status --short | head -15
```
确认工作区仅剩文档改动后提交：

```bash
git add Project-Rule/CHANGELOG.md Project-Rule/current-progress.md .workbuddy/memory/2026-09-02.md
git commit -m "docs: 数据源注册表 B1 变更记录（CHANGELOG + current-progress + 工作日志）"
```

- [ ] **Step 5: present_files 交付**

调用 present_files 展示本计划文档与变更记录（如用户需要）。

---

## Self-Review 记录（编写时已执行）

**1. Spec 覆盖**：对照 `docs/superpowers/specs/2026-09-02-metadata-source-registry-design.md`——D1 注册表 → Task 1；D2 默认链 → Task 1（DEFAULT_CHAINS）；D3 设置 UI → Task 4/5；D4 编排泛化 → Task 3；D5 settings append-only → Task 2；D6 新源 client → B2 不在本计划。批次表中 B1 回归验证 → Task 6/7。**缺口**：spec 提到「EntryModal 数据源栏按链展示」与「失败源静默降级（不再逐个弹 Notice）」两处为 spec 5 节的编排目标——前者留 B2（本计划范围边界注明），后者与 6 节「B1 回归=现状一致」冲突，按回归优先保留 Notice（B2 统一静默），范围边界注明。

**2. Placeholder 扫描**：无 TBD/TODO；每步含完整代码与命令；derive 三态 aux 语义已用注释固化。

**3. 类型一致性**：`ProviderId`/`SourceGroup`/`DEFAULT_CHAINS`/`normalizeSourceChain`/`resolveSourceChain`/`deriveGroupSearchError` 在 Task 1 定义、Task 2-4 引用名一致；`emptyAux()` 返回 `Record<Exclude<ProviderId,'douban'>, 'absent'>` 与 derive 的 aux 参数类型匹配（其余键在调用处以展开补全）；main.ts 中 `this.emptyAux()` 为私有方法、Task 3 Step 4 定义先行。

**4. 边界确认**：derive 只在 `merged.length === 0` 时调用（有结果绝不打扰）；douban 不在链时 hasDouban=false → 传 `douban: undefined` 走通用分支；book/game/music 链 B1 恒含 douban（候选唯一），新通用文案分支在影视/动画可手动触发（可测）。
