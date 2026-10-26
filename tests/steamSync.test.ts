// #639 ⑥ Steam 集成纯逻辑测试：凭据校验 / 三态解析（空 vs 失败）/ 时长换算 / 配对 / 自动同步门槛。
import { describe, it, expect } from 'vitest';
import {
    normalizeSteamId,
    steamIdIssue,
    steamKeyIssue,
    minutesToHours,
    steamIconUrl,
    parseOwnedGames,
    parseWishlist,
    syncSummary,
    steamTitleKey,
    matchOwnedToEntries,
    shouldAutoSync,
    STEAM_SYNC_LIMIT,
    STEAM_AUTO_SYNC_GAP_MS,
    type SteamOwnedGame,
    // 🔴 2026-10-25：同步弹窗改造新增的判据
    steamItemKey,
    steamAppIdFromUrl,
    mergeSyncCandidates,
    steamEntrySeed,
    steamCoverUrl,
    syncFetchHeadline,
    // 🔴 2026-10-25：用户报「有些同步导入的没有评分和评价人数」⇒ 详情映射抽成唯一真源
    steamDetailFields,
    steamEntryNeedsDetail,
    STEAM_DETAIL_FILL_LIMIT,
    type SteamSyncCandidate,
} from 'pure/steamSync';

describe('#639 Steam 凭据校验', () => {
    it('SteamID：只认 17 位数字（`STEAM_0:1:…` 与个人资料网址都**明确报错**，⛔ 不拿去请求）', () => {
        expect(normalizeSteamId('76561197960287930')).toBe('76561197960287930');
        expect(normalizeSteamId('  76561197960287930  ')).toBe('76561197960287930');
        expect(normalizeSteamId('STEAM_0:1:12345678')).toBeNull();
        expect(normalizeSteamId('https://steamcommunity.com/id/someone')).toBeNull();
        expect(normalizeSteamId('')).toBeNull();
        expect(normalizeSteamId(123)).toBeNull();
        expect(normalizeSteamId('12345')).toBeNull(); // 位数不够
    });

    it('SteamID 的报错都带**下一步**（⛔ 不是干巴巴的「格式错误」）', () => {
        expect(steamIdIssue('')).toContain('未填写');
        // 🔴 `STEAM_0:` 那条必须**认出来并指名道姓**（含 "STEAM_0:1:…" 字样）。
        //    ⚠️ 2026-10-25：文案统一改成「17 位」后，原先「只判 `toContain('64 位数字')` 不够」的
        //    判定法失效了（现在各分支都写 17 位）⇒ 换判别器 = **位数不符那条独有「当前 N 位」**，
        //    STEAM_0 分支里⛔ 不许出现它。这样「STEAM_0 分支被删、落到位数校验」照样会被抓红。
        expect(steamIdIssue('STEAM_0:1:12345678')).toContain('STEAM_0:1:…');
        expect(steamIdIssue('STEAM_0:1:12345678')).not.toContain('当前');
        expect(steamIdIssue('https://steamcommunity.com/id/x')).toContain('不是个人资料网址');
        expect(steamIdIssue('someone')).toContain('自定义昵称不行');
        // 位数不符那条**只对纯数字**生效（含具体位数，方便用户核对）
        expect(steamIdIssue('12345')).toContain('17 位');
        expect(steamIdIssue('12345')).toContain('当前 5 位');
        expect(steamIdIssue('76561197960287930')).toBeNull();
        // 🔴 文案里⛔ 不许再出现「64 位」（那是把 SteamID**64** 的 64bit 读成了位数 —— 用户报障原话）
        for (const bad of ['', 'STEAM_0:1:12345678', 'https://steamcommunity.com/id/x', 'someone', '12345']) {
            expect(steamIdIssue(bad)).not.toContain('64 位');
        }
    });

    it('API Key：32 位十六进制；不合法时说清去哪拿', () => {
        expect(steamKeyIssue('A'.repeat(32))).toBeNull();
        expect(steamKeyIssue('0123456789abcdef0123456789abcdef')).toBeNull();
        expect(steamKeyIssue('')).toContain('未填写');
        expect(steamKeyIssue('short')).toContain('32 位十六进制');
        expect(steamKeyIssue('Z'.repeat(32))).toContain('32 位十六进制');
        expect(steamKeyIssue('Z'.repeat(32))).toContain('steamcommunity.com/dev/apikey');
    });
});

describe('#639 时长换算（用户裁定：直接用 Steam 总时长覆盖）', () => {
    it('分钟 → 小时，保留一位小数', () => {
        expect(minutesToHours(0)).toBe(0);
        expect(minutesToHours(60)).toBe(1);
        expect(minutesToHours(90)).toBe(1.5);
        expect(minutesToHours(95)).toBe(1.6);
        expect(minutesToHours(600)).toBe(10);
    });

    it('脏值 / 负值 ⇒ 0（⛔ 不产出 NaN —— 那会写进笔记 frontmatter）', () => {
        expect(minutesToHours(-5)).toBe(0);
        expect(minutesToHours('x')).toBe(0);
        expect(minutesToHours(undefined)).toBe(0);
        expect(minutesToHours(NaN)).toBe(0);
        expect(Number.isFinite(minutesToHours(NaN))).toBe(true);
    });

    it('小图标 URL 由 appid + hash 拼出；空 hash ⇒ **不落键**', () => {
        expect(steamIconUrl(570, 'abc123')).toBe(
            'https://media.steampowered.com/steamcommunity/public/images/apps/570/abc123.jpg',
        );
        expect(steamIconUrl(570, '')).toBeUndefined();
        expect(steamIconUrl(570, undefined)).toBeUndefined();
    });
});

describe('#639 解析：🔴「空」与「失败」必须分开（本模块最重要的判据）', () => {
    it('GetOwnedGames：正常响应 ⇒ ok，字段映射齐', () => {
        const raw = {
            response: {
                game_count: 2,
                games: [
                    { appid: 570, name: 'Dota 2', playtime_forever: 1200, playtime_2weeks: 60, img_icon_url: 'aaa' },
                    { appid: 440, name: 'Team Fortress 2', playtime_forever: 0 },
                ],
            },
        };
        const r = parseOwnedGames(raw);
        expect(r.kind).toBe('ok');
        if (r.kind !== 'ok') return;
        expect(r.items).toHaveLength(2);
        expect(r.items[0]).toMatchObject({ appid: 570, name: 'Dota 2', playtimeForever: 1200, playtime2Weeks: 60 });
        expect(r.items[0].iconUrl).toContain('/570/aaa.jpg');
        // 0 时长照收（那是「买了没玩」，不是错误）
        expect(r.items[1].playtimeForever).toBe(0);
        expect(r.items[1].playtime2Weeks).toBeUndefined();
        expect(r.items[1].iconUrl).toBeUndefined();
    });

    it('🔴 `{"response":{}}`（资料没公开）⇒ **private**，⛔ 绝不说成「你库里没有游戏」', () => {
        expect(parseOwnedGames({ response: {} }).kind).toBe('private');
        expect(parseWishlist({ response: {} }).kind).toBe('private');
        // ⚠️ 这是实测形态：`_probe_639_steam.cjs` 对非公开愿望单拿到的就是它（HTTP 仍是 200）
    });

    it('🔴 真的空库（`games: []`）⇒ **ok + 空数组**（与 private 是两回事）', () => {
        const r = parseOwnedGames({ response: { game_count: 0, games: [] } });
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') expect(r.items).toEqual([]);
    });

    it('结构不对 ⇒ error（key 无效被挡 / 接口变更）；⛔ 不静默当成空', () => {
        expect(parseOwnedGames(null).kind).toBe('error');
        expect(parseOwnedGames('x').kind).toBe('error');
        expect(parseOwnedGames({}).kind).toBe('error');
        expect(parseWishlist({ nope: 1 }).kind).toBe('error');
    });

    it('坏条目跳过（无名 / 无 appid / 非对象），其余照收', () => {
        const raw = {
            response: {
                games: [
                    { appid: 1, name: 'ok', playtime_forever: 60 },
                    { appid: 2, name: '' },          // 无名 ⇒ 跳过（本插件按标题落条目）
                    { appid: 0, name: 'bad id' },     // appid 非法 ⇒ 跳过
                    null,
                    'x',
                    { appid: 3, name: '  spaced  ', playtime_forever: -5 },
                ],
            },
        };
        const r = parseOwnedGames(raw);
        expect(r.kind).toBe('ok');
        if (r.kind !== 'ok') return;
        expect(r.items.map((g) => g.appid)).toEqual([1, 3]);
        expect(r.items[1].name).toBe('spaced'); // 名字去首尾空白
        expect(r.items[1].playtimeForever).toBe(0); // 负值归 0
    });

    it('愿望单解析：只给 appid（+ 可选 date_added / priority）', () => {
        const r = parseWishlist({ response: { items: [{ appid: 570, date_added: 1600000000, priority: 3 }, { appid: 440 }] } });
        expect(r.kind).toBe('ok');
        if (r.kind !== 'ok') return;
        expect(r.items[0]).toEqual({ appid: 570, dateAdded: 1600000000, priority: 3 });
        expect(r.items[1]).toEqual({ appid: 440 });
    });

    it(`条数上限 = ${STEAM_SYNC_LIMIT}（防几千个游戏把库撑爆）`, () => {
        const many = { response: { games: Array.from({ length: STEAM_SYNC_LIMIT + 50 }, (_, i) => ({ appid: i + 1, name: `G${i}`, playtime_forever: 1 })) } };
        const r = parseOwnedGames(many);
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') expect(r.items).toHaveLength(STEAM_SYNC_LIMIT);
    });
});

describe('#639 同步回执（失败说人话）', () => {
    it('三态各有各的说法，且**明确区分**「拉不到」与「真的 0 条」', () => {
        const ok = syncSummary({ owned: { kind: 'ok', items: new Array(12).fill(null) as never }, wishlist: { kind: 'ok', items: [] } });
        expect(ok).toContain('游戏库 12 条');
        expect(ok).toContain('愿望单 0 条');

        const priv = syncSummary({ owned: { kind: 'private' } });
        expect(priv).toContain('拉不到');
        expect(priv).toContain('公开');

        const err = syncSummary({ wishlist: { kind: 'error', message: '连接失败' } });
        expect(err).toContain('出错');
        expect(err).toContain('连接失败');
    });

    it('带新增/更新计数时一并报出', () => {
        const s = syncSummary({ owned: { kind: 'ok', items: [] }, added: 3, updated: 5 });
        expect(s).toContain('新增 3');
        expect(s).toContain('更新 5');
    });
});

describe('#639 与已有条目配对', () => {
    const G = (appid: number, name: string): SteamOwnedGame => ({ appid, name, playtimeForever: 0 });

    it('标题归一：全角括号 / 大小写 / 连续空白都算同一个', () => {
        expect(steamTitleKey('The Witcher 3')).toBe('the witcher 3');
        expect(steamTitleKey('  The   Witcher   3  ')).toBe('the witcher 3');
        expect(steamTitleKey('Portal（2）')).toBe('portal(2)');
        expect(steamTitleKey('A：B')).toBe('a:b');
    });

    it('按归一标题配对；没配上的留给「新增」', () => {
        const owned = [G(570, 'Dota 2'), G(440, 'Team Fortress 2'), G(1, 'Never Seen')];
        const entries = [{ id: 'e1', title: 'dota 2' }, { id: 'e2', title: 'Team  Fortress 2 ' }];
        const m = matchOwnedToEntries(owned, entries);
        expect(m.get(570)).toBe('e1');
        expect(m.get(440)).toBe('e2');
        expect(m.has(1)).toBe(false);
    });

    it('🔴 **同名多条 ⇒ 首条说了算**（⛔ 不覆盖 —— 后写会让配对结果随机化）', () => {
        const m = matchOwnedToEntries([G(570, 'Dota 2')], [
            { id: 'first', title: 'Dota 2' },
            { id: 'second', title: 'Dota 2' },
        ]);
        expect(m.get(570)).toBe('first');
    });

    it('🔴 **只做保守归一，不做模糊匹配**（把《Portal》配到《Portal 2》上比没配上糟得多）', () => {
        const m = matchOwnedToEntries([G(1, 'Portal')], [{ id: 'e1', title: 'Portal 2' }]);
        expect(m.size).toBe(0);
    });

    it('空标题不参与配对（⛔ 别让空标题把所有条目串起来）', () => {
        const m = matchOwnedToEntries([G(1, '')], [{ id: 'e1', title: '' }, { id: 'e2', title: 'x' }]);
        expect(m.size).toBe(0);
    });
});

describe('#639 启动自动同步的门槛', () => {
    const now = 1_800_000_000_000;

    it('两件凭据都得有（缺一不跑）', () => {
        expect(shouldAutoSync({ hasKey: false, hasId: true, now })).toBe(false);
        expect(shouldAutoSync({ hasKey: true, hasId: false, now })).toBe(false);
        expect(shouldAutoSync({ hasKey: true, hasId: true, now })).toBe(true);
    });

    it(`间隔 ${STEAM_AUTO_SYNC_GAP_MS / 3600000} 小时（既跟得上当天，又不撞 Steam 的频率限制）`, () => {
        expect(STEAM_AUTO_SYNC_GAP_MS).toBe(6 * 60 * 60 * 1000);
        const recent = now - 60 * 60 * 1000; // 1 小时前
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: recent, now })).toBe(false);
        const old = now - 7 * 60 * 60 * 1000; // 7 小时前
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: old, now })).toBe(true);
    });

    it('从没同步过 ⇒ 跑；脏 lastSyncAt ⇒ 当作没同步过', () => {
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: 0, now })).toBe(true);
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: undefined, now })).toBe(true);
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: 'x', now })).toBe(true);
        expect(shouldAutoSync({ hasKey: true, hasId: true, lastSyncAt: NaN, now })).toBe(true);
    });
});

// 🔴 2026-10-25（用户）：「所有类型账号同步是要先列出弹窗列出游戏让我勾选才同步（库内已有要提示覆盖）
//   还有拉取到的steam游戏怎么连封面和任何信息都没有啊只拉了个标题」
//   ⇒ 下面三组是这次改造的判据：判重键 / 合并候选 / 落库字段（封面与状态）。
describe('#639 ⑫ 同步弹窗的判重键', () => {
    it('`steam:{appid}` —— 与 TMDB 同款：**来源 id** 才是键，⛔ 不是标题', () => {
        expect(steamItemKey(620)).toBe('steam:620');
        expect(steamItemKey(620)).not.toBe(steamItemKey(621));
    });

    it('从 `sourceUrl` 反解 appid（弹窗判「库里已有」用）', () => {
        expect(steamAppIdFromUrl('https://store.steampowered.com/app/620')).toBe(620);
        // 带尾巴（`/Portal_2/`、query）也要认得
        expect(steamAppIdFromUrl('https://store.steampowered.com/app/620/Portal_2/')).toBe(620);
        expect(steamAppIdFromUrl('https://store.steampowered.com/app/620?l=english')).toBe(620);
        // ⛔ 非 Steam 来源 / 空值 / 非字符串 ⇒ null（不能误判成「已有」而跳过导入）
        expect(steamAppIdFromUrl('https://www.douban.com/subject/1/')).toBeNull();
        expect(steamAppIdFromUrl('')).toBeNull();
        expect(steamAppIdFromUrl(undefined)).toBeNull();
        expect(steamAppIdFromUrl(null)).toBeNull();
        expect(steamAppIdFromUrl('https://store.steampowered.com/app/abc')).toBeNull();
    });
});

describe('#639 ⑫ 库 + 愿望单并成待选表', () => {
    const owned: SteamOwnedGame[] = [
        { appid: 620, name: 'Portal 2', playtimeForever: 125, iconUrl: 'https://x/620.jpg' },
        { appid: 400, name: 'Portal', playtimeForever: 0 },
    ];
    const wish = [{ appid: 1145360, dateAdded: 1 }, { appid: 620 }]; // 620 同时在两处

    it('🔴 同一款既在库又在愿望单 ⇒ **库优先**（带时长、带图标，且不该被当「想要」）', () => {
        const out = mergeSyncCandidates(owned, wish, new Map([[1145360, 'Hades']]));
        expect(out.map((c) => c.appid)).toEqual([620, 400, 1145360]);
        const p2 = out.find((c) => c.appid === 620)!;
        expect(p2.source).toBe('owned');
        expect(p2.playtimeForever).toBe(125);
        expect(out.filter((c) => c.appid === 620)).toHaveLength(1);
    });

    it('愿望单没有名字 ⇒ 用传进来的名字；**拿不到就留占位名**（⛔ 不静默丢这条）', () => {
        const out = mergeSyncCandidates(owned, wish, new Map([[1145360, 'Hades']]));
        expect(out.find((c) => c.appid === 1145360)!.name).toBe('Hades');
        const withoutName = mergeSyncCandidates([], [{ appid: 999 }]);
        expect(withoutName).toHaveLength(1);
        expect(withoutName[0].name).toBe('Steam App 999');
        expect(withoutName[0].source).toBe('wishlist');
        expect(withoutName[0].playtimeForever).toBe(0);
    });

    it('空输入 ⇒ 空表（⛔ 不抛）', () => {
        expect(mergeSyncCandidates([], [])).toEqual([]);
    });
});

describe('#639 ⑫ 落库字段（用户报的「只拉了个标题」就是这里缺的）', () => {
    const ownedC: SteamSyncCandidate = { appid: 620, name: 'Portal 2', source: 'owned', playtimeForever: 125 };
    const wishC: SteamSyncCandidate = { appid: 1145360, name: 'Hades', source: 'wishlist', playtimeForever: 0 };

    it('🔴 **封面必须落竖版 600x900**（⛔ 不是 32×32 的 img_icon_url —— 贴海报墙会糊成一团）', () => {
        expect(steamEntrySeed(ownedC).poster).toBe(steamCoverUrl(620));
        expect(steamCoverUrl(620)).toBe(
            'https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_600x900.jpg',
        );
        expect(steamCoverUrl(620)).not.toContain('img_icon_url');
        expect(steamEntrySeed(wishC).poster).toBe(steamCoverUrl(1145360));
    });

    it('🔴 状态：库里已拥有 = **在看**（正在玩），愿望单 = **想玩** —— 原来全塞成想玩是错的', () => {
        expect(steamEntrySeed(ownedC).status).toBe('watching');
        expect(steamEntrySeed(wishC).status).toBe('want');
    });

    it('来源与链接齐（缺了笔记「来源」行就是空的）', () => {
        const s = steamEntrySeed(ownedC);
        expect(s.type).toBe('game');
        expect(s.source).toBe('steam');
        expect(s.sourceUrl).toBe('https://store.steampowered.com/app/620');
        expect(s.title).toBe('Portal 2');
    });

    it('时长只给库条目（愿望单没有时长 ⇒ ⛔ 不落 0 分钟这个假数据）', () => {
        // 🔴 原样落**分钟**：⛔ 别绕 `minutesToHours` 再乘回来 —— 那条路会四舍五入到 0.1 小时
        //    （6 分钟的刻度），125 分钟会变成 126，每轮同步都把用户时长悄悄改错。
        expect(steamEntrySeed(ownedC).playtimeMinutes).toBe(125);
        expect(steamEntrySeed({ ...ownedC, playtimeForever: 7500 }).playtimeMinutes).toBe(7500);
        expect(steamEntrySeed({ ...ownedC, playtimeForever: 0 }).playtimeMinutes).toBe(0);
        expect(steamEntrySeed(wishC).playtimeMinutes).toBeUndefined();
    });
});

describe('#639 ⑫ 弹窗顶部结论（三态各自说人话）', () => {
    const okOwned = { kind: 'ok' as const, items: [{ appid: 1, name: 'A', playtimeForever: 0 }] };
    const okWish = { kind: 'ok' as const, items: [{ appid: 2 }] };

    it('两半都通 ⇒ 报条数 + 待选总数', () => {
        const t = syncFetchHeadline({ owned: okOwned, wishlist: okWish, total: 2 });
        expect(t).toContain('游戏库 1');
        expect(t).toContain('愿望单 1');
        expect(t).toContain('待选 2 条');
    });

    it('🔴 只有一半不通 ⇒ **照常报好的那半**，⛔ 不整轮判失败', () => {
        const t = syncFetchHeadline({ owned: okOwned, wishlist: { kind: 'private' }, total: 1 });
        expect(t).toContain('游戏库 1');
        expect(t).toContain('愿望单拉不到');
        expect(t).toContain('待选 1 条');
    });

    it('「拉不到」与「出错」必须分开说（⛔ 把私有资料说成 key 无效）', () => {
        const priv = syncFetchHeadline({ owned: { kind: 'private' }, wishlist: { kind: 'private' }, total: 0 });
        expect(priv).toContain('拉不到');
        expect(priv).not.toContain('出错');
        const err = syncFetchHeadline({
            owned: { kind: 'error', message: 'HTTP 401' },
            wishlist: { kind: 'error', message: 'HTTP 401' },
            total: 0,
        });
        expect(err).toContain('出错');
        expect(err).toContain('HTTP 401');
    });
});

describe('🔴 2026-10-25 steamDetailFields（详情 → 条目字段的唯一映射真源）', () => {
    it('七个字段全部映射（含 rating / ratingCount）', () => {
        const f = steamDetailFields({
            platform: 'Windows / macOS',
            developer: 'Valve',
            year: 2011,
            genres: ['动作', '解谜', '独立'],
            summary: '一段简介',
            rating: 9.5,
            ratingCount: 392382,
        });
        expect(f).toEqual({
            platform: 'Windows / macOS',
            developer: 'Valve',
            year: 2011,
            genres: ['动作', '解谜', '独立'],
            summary: '一段简介',
            rating: 9.5,
            ratingCount: 392382,
        });
    });

    it('🔴 rating 只采信 (0, 10]：0 / 负数 / 超 10 一律不落键（⛔ 不把「没有媒体分」显示成 0 分）', () => {
        expect(steamDetailFields({ rating: 0 }).rating).toBeUndefined();
        expect(steamDetailFields({ rating: -1 }).rating).toBeUndefined();
        expect(steamDetailFields({ rating: 10 }).rating).toBe(10);
        expect(steamDetailFields({ rating: 10.1 }).rating).toBeUndefined();
        expect(steamDetailFields({ rating: Number.NaN }).rating).toBeUndefined();
    });

    it('ratingCount 只采信正整数（0 / 负数 / 小数都丢弃或取整）', () => {
        expect(steamDetailFields({ ratingCount: 0 }).ratingCount).toBeUndefined();
        expect(steamDetailFields({ ratingCount: -5 }).ratingCount).toBeUndefined();
        expect(steamDetailFields({ ratingCount: 12.6 }).ratingCount).toBe(13);
        expect(steamDetailFields({}).ratingCount).toBeUndefined();
    });

    it('题材最多前 3 个（与豆瓣同一截断口径），空串条目被过滤', () => {
        expect(steamDetailFields({ genres: ['a', 'b', 'c', 'd'] }).genres).toEqual(['a', 'b', 'c']);
        expect(steamDetailFields({ genres: ['a', '  ', ''] }).genres).toEqual(['a']);
        expect(steamDetailFields({ genres: [] }).genres).toBeUndefined();
    });

    it('脏入参不炸：null / 数组 / 字符串 / 缺字段 ⇒ 空对象', () => {
        expect(steamDetailFields(null)).toEqual({});
        expect(steamDetailFields(undefined)).toEqual({});
        expect(steamDetailFields([])).toEqual({});
        expect(steamDetailFields('nope')).toEqual({});
        expect(steamDetailFields({ platform: '   ' })).toEqual({});
    });

    // 🔴 2026-10-25 用户裁定「Steam 评分显示为 % 专属」⇒ 新增 `reviewPercent`。
    //    这几条守的是**它与 communityScore 的边界**：百分比绝不能写进 10 分制字段。
    it('reviewPercent 采信 [0, 100] 并取整', () => {
        expect(steamDetailFields({ reviewPercent: 97 }).reviewPercent).toBe(97);
        expect(steamDetailFields({ reviewPercent: 96.6 }).reviewPercent).toBe(97);
        expect(steamDetailFields({ reviewPercent: 0 }).reviewPercent).toBe(0);
        expect(steamDetailFields({ reviewPercent: 100 }).reviewPercent).toBe(100);
    });

    it('🔴 reviewPercent = 0 必须落键：那是「有人评、零好评」的真实结论，⛔ 不能当成缺失', () => {
        const f = steamDetailFields({ reviewPercent: 0 });
        expect('reviewPercent' in f).toBe(true);
        expect(f.reviewPercent).toBe(0);
    });

    it('reviewPercent 超 100 / 负数 / NaN 一律丢弃（⛔ 不钳到 100，比率不可能溢出）', () => {
        expect(steamDetailFields({ reviewPercent: 101 }).reviewPercent).toBeUndefined();
        expect(steamDetailFields({ reviewPercent: -1 }).reviewPercent).toBeUndefined();
        expect(steamDetailFields({ reviewPercent: Number.NaN }).reviewPercent).toBeUndefined();
        expect(steamDetailFields({ reviewPercent: Number.POSITIVE_INFINITY }).reviewPercent).toBeUndefined();
    });

    it('🔴 百分比绝不写进 communityScore（那是全仓 10 分制字段，塞 97 会被 catalog 校验丢掉）', () => {
        const f = steamDetailFields({ reviewPercent: 97, rating: 9.5 });
        // SteamDetailFields 里根本不该存在 communityScore 这个键——用 `in` 判存在性，
        // 比「读出来该是 undefined」更狠：连字段都不许有。
        expect('communityScore' in f).toBe(false);
        expect(f.rating).toBe(9.5);
        expect(f.reviewPercent).toBe(97);
    });
});

describe('🔴 2026-10-25 steamEntryNeedsDetail（缺详情判据必须能收敛）', () => {
    it('没有封面 ⇒ 判定为缺详情（用户报障的老条目正是这一类）', () => {
        expect(steamEntryNeedsDetail({})).toBe(true);
        expect(steamEntryNeedsDetail({ poster: '' })).toBe(true);
        expect(steamEntryNeedsDetail({ poster: '   ' })).toBe(true);
    });

    it('🔴 有封面 ⇒ 不再命中（补过一轮就收敛，⛔ 不能每轮都重拉）', () => {
        expect(steamEntryNeedsDetail({ poster: 'https://x/library_600x900.jpg' })).toBe(false);
    });

    it('🔴 「没有评分」不算缺详情：多数游戏本就无 Metacritic 收录，按它判会永远补不上、白耗配额', () => {
        // 有封面、没评分 ⇒ 不触发详情请求
        expect(steamEntryNeedsDetail({ poster: 'https://x/a.jpg' })).toBe(false);
    });

    it('详情补全预算是个正整数且不会大到把启动拖死', () => {
        expect(STEAM_DETAIL_FILL_LIMIT).toBeGreaterThan(0);
        expect(STEAM_DETAIL_FILL_LIMIT).toBeLessThanOrEqual(100);
    });
});
