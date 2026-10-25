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
        // 🔴 `STEAM_0:` 那条必须**认出来并指名道姓**（含 "STEAM_0:1:…" 字样）——
        //    ⚠️ 只判 `toContain('64 位数字')` 是**不够的**：位数不符那条文案里也有这四个字，
        //    于是「SteamID 分支被删掉、落到位数校验」这种回归会被判绿（本批突变 M46 实测抓到）。
        expect(steamIdIssue('STEAM_0:1:12345678')).toContain('STEAM_0:1:…');
        expect(steamIdIssue('STEAM_0:1:12345678')).not.toContain('17 位');
        expect(steamIdIssue('https://steamcommunity.com/id/x')).toContain('不是个人资料网址');
        expect(steamIdIssue('someone')).toContain('自定义昵称不行');
        // 位数不符那条**只对纯数字**生效（含具体位数，方便用户核对）
        expect(steamIdIssue('12345')).toContain('17 位');
        expect(steamIdIssue('12345')).toContain('当前 5 位');
        expect(steamIdIssue('76561197960287930')).toBeNull();
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
