// ③-1（2026-11-12 用户 m00353）：「统一周期管理」面板的**唯一数据源** —— `pure/credentialMeta` 单测。
//
// 🔴 用户原话：「状态面板和搜索配置页必须共享同一个 `credentialMeta` 数据源，⛔ 不要在状态面板里
//    维护独立的『是否失效』状态」。⇒ 这里钉的就是那份共享语义，面板与徽标都只能读它：
//      · 是否配置 = 从 settings **现算**（不落盘）
//      · 是否失效 = 只读 `credentialStatus`，`undefined`（没测过）**绝不算失效**
//      · 上次检测 = 只读 `credentialCheckedAt`，⛔ 不 new Date() 现造
import { describe, expect, it } from 'vitest';
import * as meta from 'pure/credentialMeta';
import {
    CREDENTIAL_TOTAL,
    MUSIC_CREDENTIAL_IDS,
    MUSIC_CREDENTIAL_LABELS,
    NET_CREDENTIAL_IDS,
    NET_CREDENTIAL_LABELS,
    buildCredentialMeta,
    credentialCheckKey,
    credentialStateLabel,
    formatCheckedAt,
    isMusicConfigured,
    isNetConfigured,
    isSourceConfigured,
    summarizeCredentialMeta,
    type CredentialMeta,
} from 'pure/credentialMeta';
import { PROVIDERS } from 'pure/sourceRegistry';
import { musicCheckKey, netCheckKey, sourceCheckKey } from 'pure/credentialCheck';

/** 造一个只带关心的键的 settings —— ⛔ 不构造完整 Settings 类型（那会把设置模块整条依赖链拖进单测）。 */
function settingsOf(bag: Record<string, unknown>): unknown {
    return bag;
}

function input(settings: unknown, status: Record<string, boolean> = {}, checkedAt: Record<string, number> = {}) {
    return { settings, status, checkedAt };
}

/** 从结果表里取某条。 */
function pick(rows: readonly CredentialMeta[], key: string): CredentialMeta {
    const hit = rows.find((r) => r.key === key);
    if (!hit) throw new Error(`没有 ${key} 这一行`);
    return hit;
}

describe('credentialMeta · 13 条的构成与顺序', () => {
    it('总数 = CREDENTIAL_TOTAL = 13，且「需凭据的元数据源 + 3 音乐 + 2 网络播放」逐项对得上', () => {
        const rows = buildCredentialMeta(input(settingsOf({})));
        expect(rows).toHaveLength(CREDENTIAL_TOTAL);
        const sources = rows.filter((r) => r.family === 'source');
        const music = rows.filter((r) => r.family === 'music');
        const net = rows.filter((r) => r.family === 'net');
        // 元数据源只数**需要凭据**的（`keyField === null` 的免 Key 源不进面板）
        const needKey = PROVIDERS.filter((p) => !!p.keyField);
        expect(sources).toHaveLength(needKey.length);
        expect(music).toHaveLength(MUSIC_CREDENTIAL_IDS.length);
        expect(net).toHaveLength(NET_CREDENTIAL_IDS.length);
        expect(needKey.length + 3 + 2).toBe(CREDENTIAL_TOTAL);
    });

    it('顺序与设置页一致：元数据源按注册表序 → 音乐三平台 → 网络播放两条', () => {
        const rows = buildCredentialMeta(input(settingsOf({})));
        const needKey = PROVIDERS.filter((p) => !!p.keyField).map((p) => p.id);
        expect(rows.map((r) => r.id)).toEqual([...needKey, ...MUSIC_CREDENTIAL_IDS, ...NET_CREDENTIAL_IDS]);
    });

    it('免 Key 源（keyField === null）**一条都不进**面板 —— 它们没有「配置」这回事', () => {
        const rows = buildCredentialMeta(input(settingsOf({})));
        const free = PROVIDERS.filter((p) => !p.keyField).map((p) => p.id);
        expect(free.length).toBeGreaterThan(0); // 前提：本仓确实有免 Key 源
        for (const id of free) {
            expect(rows.some((r) => r.id === id)).toBe(false);
        }
    });

    it('每条的 key 与 `credentialCheck` 的三个 *CheckKey 逐字同源（⛔ 不各拼一套）', () => {
        const rows = buildCredentialMeta(input(settingsOf({})));
        for (const r of rows) {
            const expected = r.family === 'source' ? sourceCheckKey(r.id) : r.family === 'music' ? musicCheckKey(r.id) : netCheckKey(r.id);
            expect(r.key).toBe(expected);
            expect(credentialCheckKey(r.family, r.id)).toBe(expected);
        }
    });

    it('音乐 / 网络播放的展示名与设置页逐字相同（网易云音乐 / QQ 音乐 / 酷狗音乐 / B 站 / YouTube）', () => {
        expect(MUSIC_CREDENTIAL_LABELS).toEqual({ netease: '网易云音乐', qq: 'QQ 音乐', kugou: '酷狗音乐' });
        expect(NET_CREDENTIAL_LABELS).toEqual({ bilibili: 'B 站', youtube: 'YouTube' });
        const rows = buildCredentialMeta(input(settingsOf({})));
        expect(pick(rows, 'music:netease').label).toBe('网易云音乐');
        expect(pick(rows, 'music:kugou').label).toBe('酷狗音乐');
        expect(pick(rows, 'net:bilibili').label).toBe('B 站');
        expect(pick(rows, 'net:youtube').label).toBe('YouTube');
    });
});

describe('credentialMeta · 是否配置（现算，不落盘）', () => {
    it('元数据源：单凭据源填了 keyField 才算配置', () => {
        expect(isSourceConfigured(settingsOf({ tmdbApiKey: 'k' }), 'tmdb')).toBe(true);
        expect(isSourceConfigured(settingsOf({ tmdbApiKey: '   ' }), 'tmdb')).toBe(false);
        expect(isSourceConfigured(settingsOf({}), 'douban')).toBe(false);
    });

    it('双凭据源（IGDB）：主副字段都得有值 —— 少一个连 token 都换不出来', () => {
        const meta = PROVIDERS.find((p) => p.id === 'igdb');
        expect(meta?.keyField2).toBeTruthy(); // 前提：IGDB 确实是双凭据源
        const k1 = meta!.keyField as string;
        const k2 = meta!.keyField2 as string;
        expect(isSourceConfigured(settingsOf({ [k1]: 'a' }), 'igdb')).toBe(false);
        expect(isSourceConfigured(settingsOf({ [k1]: 'a', [k2]: 'b' }), 'igdb')).toBe(true);
    });

    it('音乐：`musicDlCookies[id]` 有值才算配置', () => {
        expect(isMusicConfigured(settingsOf({ musicDlCookies: { qq: 'c' } }), 'qq')).toBe(true);
        expect(isMusicConfigured(settingsOf({ musicDlCookies: { qq: '  ' } }), 'qq')).toBe(false);
        expect(isMusicConfigured(settingsOf({ musicDlCookies: {} }), 'qq')).toBe(false);
        expect(isMusicConfigured(settingsOf({}), 'qq')).toBe(false);
    });

    it('网络播放：B 站只看 biliCookie；YouTube 代理**或** Cookie 任一有值即算配置', () => {
        expect(isNetConfigured(settingsOf({ biliCookie: 'c' }), 'bilibili')).toBe(true);
        expect(isNetConfigured(settingsOf({ ytProxy: 'p' }), 'youtube')).toBe(true);
        expect(isNetConfigured(settingsOf({ ytCookie: 'c' }), 'youtube')).toBe(true);
        expect(isNetConfigured(settingsOf({}), 'youtube')).toBe(false);
        // B 站不认代理（它不是 YouTube 那种墙外站）
        expect(isNetConfigured(settingsOf({ ytProxy: 'p' }), 'bilibili')).toBe(false);
    });

    it('改 settings 立刻反映（⛔ 不缓存）—— 同一个 input 换一份 settings，configured 跟着变', () => {
        const key = 'music:qq';
        const before = buildCredentialMeta(input(settingsOf({})));
        expect(pick(before, key).configured).toBe(false);
        const after = buildCredentialMeta(input(settingsOf({ musicDlCookies: { qq: 'c' } })));
        expect(pick(after, key).configured).toBe(true);
    });
});

describe('credentialMeta · 是否失效（只读结论表，⛔ 绝不把「没测过」画成失效）', () => {
    const filled = settingsOf({ musicDlCookies: { qq: 'c' } });

    it('没测过（表里没这个键）⇒ expired:false 且 checked:false', () => {
        const row = pick(buildCredentialMeta(input(filled)), 'music:qq');
        expect(row.configured).toBe(true);
        expect(row.checked).toBe(false);
        expect(row.expired).toBe(false);
    });

    it('测过且通过 ⇒ checked:true / expired:false', () => {
        const row = pick(buildCredentialMeta(input(filled, { 'music:qq': true })), 'music:qq');
        expect(row.checked).toBe(true);
        expect(row.expired).toBe(false);
    });

    it('测过且失败 ⇒ expired:true', () => {
        const row = pick(buildCredentialMeta(input(filled, { 'music:qq': false })), 'music:qq');
        expect(row.checked).toBe(true);
        expect(row.expired).toBe(true);
    });

    it('🔴 未配置的源即使结论表里写着 false，也**不算失效**（标红等于骂用户没填）', () => {
        const row = pick(buildCredentialMeta(input(settingsOf({}), { 'music:qq': false })), 'music:qq');
        expect(row.configured).toBe(false);
        expect(row.expired).toBe(false);
    });

    it('别人的族前缀不串味（`music:qq` 的结论不影响 `source:qq` 这种同 id 异族）', () => {
        const rows = buildCredentialMeta(input(settingsOf({ musicDlCookies: { qq: 'c' } }), { 'music:qq': false }));
        expect(pick(rows, 'music:qq').expired).toBe(true);
        // 元数据源里没有 qq，用 net:bilibili 验同一根：它的结论不受 music 族影响
        expect(pick(rows, 'net:bilibili').expired).toBe(false);
    });
});

describe('credentialMeta · 上次检测时间（只读，⛔ 不现造）', () => {
    const filled = settingsOf({ musicDlCookies: { qq: 'c' } });

    it('没有结论 ⇒ lastCheckedAt 为 null（⛔ 不给 Date.now()）', () => {
        expect(pick(buildCredentialMeta(input(filled)), 'music:qq').lastCheckedAt).toBeNull();
    });

    it('有结论且有时间 ⇒ 原样透出', () => {
        const at = 1_700_000_000_000;
        const row = pick(buildCredentialMeta(input(filled, { 'music:qq': false }, { 'music:qq': at })), 'music:qq');
        expect(row.lastCheckedAt).toBe(at);
    });

    it('脏时间（0 / NaN / 负数 / 字符串）一律当没有 —— 否则面板会画出 1970 或 Invalid Date', () => {
        for (const bad of [0, Number.NaN, -1, '1700000000000']) {
            const row = pick(
                buildCredentialMeta(input(filled, { 'music:qq': false }, { 'music:qq': bad as number })),
                'music:qq',
            );
            expect(row.lastCheckedAt).toBeNull();
        }
    });

    it('有结论但**没有**时间 ⇒ null（历史数据里可能只有结论）', () => {
        const row = pick(buildCredentialMeta(input(filled, { 'music:qq': false })), 'music:qq');
        expect(row.lastCheckedAt).toBeNull();
    });
});

/**
 * 🔴 2026-11-12 第 28 轮（用户 `m07505` 逐字：「还有微信读书这个把上次检测的提示描述
 *   『登录超时可续期』删除掉」）⇒ 这里原有三组「续期提示」用例（`renewHint` 字段 +
 *   `credentialExpiryHint` 函数）已**整组删除**，改为**反向守卫**：
 * `CredentialMeta` 里不许再有 `renewHint`，`pure/credentialMeta` 也不许再导出那个函数。
 * ⛔ 别把这三条改回正向用例 —— 用户要的就是这一列只剩时间。
 */
describe('credentialMeta · 续期提示已按用户 m07505 删除', () => {
    it('13 行里没有任何一行带续期提示字段', () => {
        const rows = buildCredentialMeta(input(settingsOf({})));
        for (const r of rows) {
            expect(Object.prototype.hasOwnProperty.call(r, 'renewHint')).toBe(false);
        }
    });

    it('模块不再导出 credentialExpiryHint', () => {
        expect(Object.prototype.hasOwnProperty.call(meta, 'credentialExpiryHint')).toBe(false);
    });
});

describe('credentialMeta · 文案', () => {
    it('credentialStateLabel 四态：未配置 / 连接失败 / 未检测 / 正常', () => {
        const mk = (o: Partial<CredentialMeta>): CredentialMeta => ({
            key: 'x', family: 'music', id: 'x', label: 'x', familyLabel: '音乐平台',
            configured: true, expired: false, checked: true, lastCheckedAt: null, ...o,
        });
        expect(credentialStateLabel(mk({ configured: false }))).toBe('未配置');
        expect(credentialStateLabel(mk({ expired: true }))).toBe('连接失败');
        expect(credentialStateLabel(mk({ checked: false }))).toBe('未检测');
        expect(credentialStateLabel(mk({}))).toBe('正常');
    });

    it('formatCheckedAt：null → 「—」；有值 → YYYY-MM-DD HH:mm（个位补零）', () => {
        expect(formatCheckedAt(null)).toBe('—');
        const d = new Date(2026, 0, 5, 7, 3); // 本地时间 2026-01-05 07:03
        expect(formatCheckedAt(d.getTime())).toBe('2026-01-05 07:03');
    });

    it('formatCheckedAt 对脏值同样回「—」（与 lastCheckedAt 同一判据）', () => {
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(formatCheckedAt(bad)).toBe('—');
        }
    });
});

describe('credentialMeta · 汇总', () => {
    it('只数不改行：total / configured / expired / unchecked 四项', () => {
        const settings = settingsOf({ musicDlCookies: { qq: 'c', kugou: 'c' }, biliCookie: 'c' });
        const status = { 'music:qq': false, 'music:kugou': true, 'net:bilibili': true };
        const rows = buildCredentialMeta(input(settings, status));
        const sum = summarizeCredentialMeta(rows);
        expect(sum.total).toBe(CREDENTIAL_TOTAL);
        expect(sum.configured).toBe(3);
        expect(sum.expired).toBe(1);
        // 3 条配置里 qq/kugou/bilibili 都测过 ⇒ 0 条未检测
        expect(sum.unchecked).toBe(0);
    });

    it('已配置但没测过的计入 unchecked（面板要提示「有 N 条还没检测过」）', () => {
        const rows = buildCredentialMeta(input(settingsOf({ biliCookie: 'c' })));
        const sum = summarizeCredentialMeta(rows);
        expect(sum.configured).toBe(1);
        expect(sum.unchecked).toBe(1);
    });
});
