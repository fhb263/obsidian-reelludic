// 凭据「生命周期」的唯一真源（③-1，2026-11-12 用户 m00353）——
// 13 条凭据的 **名称 / 归属族 / 是否配置 / 是否失效 / 上次检测时间** 全部由本模块派生。
// 零 `obsidian` / 零 DOM / 零网络 ⇒ 可单测。
//
// 🔴🔴 用户原话（m00353 ③-1）：
//   「设置-搜索配置页『音乐下载源凭据』分组下再加组『统一周期管理』，为 13 个凭据做表格列项状态面板，
//     表头 = 名称 / 是否配置 / 是否失效 / 预计过期时间或上次刷新时间，最右表头为一键检测按钮；
//     没配置的源整行变灰但点名称可快速跳转到 Setting Tab 对应位置；
//     搜索配置页 13 个平台标签要同步更新；
//     **状态面板和搜索配置页必须共享同一个 `credentialMeta` 数据源，⛔ 不要在状态面板里维护独立的
//     「是否失效」状态**。」
//
// 由此确定的分层（⛔ 别把任何一项搬到视图层）：
//   ⑴ **是否配置** —— 从 `settings` 现算（读 `keyField` / `keyField2` / `musicDlCookies` / `biliCookie`），
//      ⛔ 不落盘：凭据一改就该立刻反映，落盘必然出现「填了但还显示未配置」。
//   ⑵ **是否失效** —— 只读 `settings.credentialStatus`（`pure/credentialCheck` 的三态表），
//      本模块**不产生**结论、也不缓存结论。`undefined`（没测过）⇒ `expired: false` + `checked: false`，
//      ⛔ 绝不把「没测过」画成「失效」（那是撒谎，与 `isExpired` 同一条口径）。
//   ⑶ **上次检测时间** —— 只读 `settings.credentialCheckedAt`（与结论同一写口写入，见 `main.ts`
//      的 `setCredentialStatus`）。⛔ 别在这里 new Date() 现造时间。
//
// ⚠️ 为什么「预计过期时间」我们给不出真实值：13 条里 11 条是不透明 Cookie / API Key，
//   上游从不告知过期时刻（豆瓣 / 网易云 / QQ 音乐 / 酷狗 / B 站 / YouTube Cookie 都是会话级，
//   TMDB / IGDB / OMDb / Bangumi 的 Key 长期有效）。⇒ 面板那一列显示的是
//   **「上次检测：…」** 这个可核查的事实，而不是编一个「预计过期」的假时间。
//   🔴 2026-11-12 第 28 轮（用户 `m07505`）：「还有微信读书这个把上次检测的提示描述
//      『登录超时可续期』删除掉」⇒ 微信读书那条额外说明**已整条退场**（`renewHint` 字段
//      + `credentialExpiryHint` 函数 + `.rl-cred-hint` 样式一并删除）。⛔ 别再加回来。

import { PROVIDERS, type ProviderId } from 'pure/sourceRegistry';
import { isExpired, musicCheckKey, netCheckKey, sourceCheckKey, type CredentialStatusMap } from 'pure/credentialCheck';

/** 凭据归属的三个族（与 `pure/credentialCheck` 的三个 `*CheckKey` 一一对应）。 */
export type CredentialFamily = 'source' | 'music' | 'net';

/** 元的**数量**口径（用户点名的 13 条）。改这个数要同时改面板的「共 N 条」文案与单测。 */
export const CREDENTIAL_TOTAL = 13;

/**
 * 音乐平台凭据的展示名。
 *
 * 🔴 与设置页 `DL_COOKIE_ROWS` 里 `name` 字段**逐字相同**（单测钉住两处键集合与文案）。
 * ⛔ 不从 `pure/musicPlatform.MUSIC_PLATFORM_LABELS` 取：那是**落库来源角标**用的短名
 *   （「网易云」「QQ音乐」「酷狗」），这里要的是凭据行的全名 —— 同一个平台在两处的
 *   措辞本来就不同，强行合并会让其中一处读起来别扭。
 */
export const MUSIC_CREDENTIAL_LABELS: Record<string, string> = {
    netease: '网易云音乐',
    qq: 'QQ 音乐',
    kugou: '酷狗音乐',
};

/** 音乐平台凭据 id 的顺序（= 设置页 `DL_COOKIE_ROWS` 的渲染顺序，⛔ 别在视图层另排）。 */
export const MUSIC_CREDENTIAL_IDS: readonly string[] = ['netease', 'qq', 'kugou'];

/**
 * 网络播放凭据的展示名。
 * ⚠️ YouTube 的「已配置」判据是**代理或 Cookie 任一有值** —— 与 `renderNetPlaybackRows` 的
 *   `createNetRow` 第三参数逐字同款（两条都可不填，要求同时有值会把正常配置画成未配置）。
 */
export const NET_CREDENTIAL_LABELS: Record<string, string> = {
    bilibili: 'B 站',
    youtube: 'YouTube',
};

/** 网络播放凭据 id 的顺序（= 设置页 `renderNetPlaybackRows` 的渲染顺序）。 */
export const NET_CREDENTIAL_IDS: readonly string[] = ['bilibili', 'youtube'];

/** 一条凭据的派生结果（面板一行 = 本接口一个实例）。 */
export interface CredentialMeta {
    /** 全局唯一键 = 落盘结论的键（`source:douban` / `music:qq` / `net:bilibili`）。 */
    key: string;
    /** 归属族。 */
    family: CredentialFamily;
    /** 族内原始 id（`douban` / `qq` / `bilibili`）。 */
    id: string;
    /** 展示名（与设置页对应凭据行逐字相同）。 */
    label: string;
    /** 族标签（面板左侧第二行的小字：元数据源 / 音乐平台 / 网络播放）。 */
    familyLabel: string;
    /** 是否已配置（现算，不落盘）。 */
    configured: boolean;
    /** **是否失效** —— `configured && statusOf(key) === false`，其余一律 false。 */
    expired: boolean;
    /** 有没有测过（结论存在与否）。`false` ⇒ 面板显示「未检测」，⛔ 不显示「正常」。 */
    checked: boolean;
    /** 上次检测时间（ms）；没有结论时为 `null`。 */
    lastCheckedAt: number | null;
}

/** `buildCredentialMeta` 的入参（全部来自 settings，⛔ 不许由视图层补齐）。 */
export interface CredentialMetaInput {
    settings: unknown;
    status: CredentialStatusMap;
    checkedAt: Record<string, number>;
}

type Bag = Record<string, unknown>;

function bag(v: unknown): Bag {
    return v && typeof v === 'object' ? (v as Bag) : {};
}

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/** 某条结论有没有被测过（`statusOf` 的本地化封装，带 own-property 判定防原型链）。 */
function hasConclusion(status: CredentialStatusMap, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(status, key);
}

/**
 * 上次检测时间：只认**有限正数**。
 * ⛔ 别把 `0` / `NaN` / 字符串当时间 —— 那会在面板上画出「1970-01-01」或「Invalid Date」。
 */
function readCheckedAt(map: Record<string, number>, key: string): number | null {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return null;
    const v = map[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** 元数据源里**需要凭据**的那些（`keyField === null` 的免 Key 源不是凭据，⛔ 不进面板）。 */
function keySources(): ProviderId[] {
    return PROVIDERS.filter((p) => !!p.keyField).map((p) => p.id);
}

/**
 * 单条元数据源的「已配置」判据 —— **与设置页徽标逐字同款**（#690 双凭据口径）。
 *
 * 🔴 为什么抽到这里：面板与徽标若各写一份，改一处就必然漂移（本仓栽过多次）。
 *   · 缺省（IGDB）：`keyField` 与 `keyField2` **都得有值** —— 少一个连 token 都换不出来；
 *   · `keyField2OptionalForConfigured`（TMDB）：主凭据有值即算已配置（access_token 只服务同步）。
 */
export function isSourceConfigured(settings: unknown, id: ProviderId): boolean {
    const s = bag(settings);
    const meta = PROVIDERS.find((p) => p.id === id);
    if (!meta || !meta.keyField) return false;
    if (!str(s[meta.keyField])) return false;
    const second = meta.keyField2 ?? undefined;
    if (!second) return true;
    if (meta.keyField2OptionalForConfigured === true) return true;
    return !!str(s[second]);
}

/** 音乐平台「已配置」判据 = `musicDlCookies[id]` 有值（与设置页同款）。 */
export function isMusicConfigured(settings: unknown, id: string): boolean {
    const cookies = bag(bag(settings).musicDlCookies);
    return !!str(cookies[id]);
}

/**
 * 网络播放「已配置」判据。
 * · B 站 = `biliCookie` 有值；
 * · YouTube = `ytProxy` **或** `ytCookie` 有值（两条都可不填，任一即算配置）。
 */
export function isNetConfigured(settings: unknown, id: string): boolean {
    const s = bag(settings);
    if (id === 'bilibili') return !!str(s.biliCookie);
    if (id === 'youtube') return !!str(s.ytProxy) || !!str(s.ytCookie);
    return false;
}

/** 该族该建的结论键（唯一真源 = `pure/credentialCheck` 的三个函数）。 */
export function credentialCheckKey(family: CredentialFamily, id: string): string {
    if (family === 'source') return sourceCheckKey(id);
    if (family === 'music') return musicCheckKey(id);
    return netCheckKey(id);
}

function makeRow(
    input: CredentialMetaInput,
    family: CredentialFamily,
    id: string,
    label: string,
    familyLabel: string,
    configured: boolean,
): CredentialMeta {
    const key = credentialCheckKey(family, id);
    const checked = hasConclusion(input.status, key);
    // 🔴 只有**已配置且测过且测不通**才算失效：未配置的源「测不通」是必然，标红等于骂用户没填。
    const expired = configured && checked && isExpired(input.status[key]);
    return {
        key,
        family,
        id,
        label,
        familyLabel,
        configured,
        expired,
        checked,
        lastCheckedAt: checked ? readCheckedAt(input.checkedAt, key) : null,
    };
}

/**
 * 建出 13 条（8 元数据源 + 3 音乐平台 + 2 网络播放）的派生表。
 *
 * 顺序 = 设置页里的实际排列顺序（元数据源按注册表序 → 音乐三平台 → 网络播放两条），
 * ⇒ 面板读起来与上面几组凭据行同序，用户不必在两处之间做映射。
 *
 * @param input `{ settings, status, checkedAt }` —— 三个都从 `plugin.settings` 现取，⛔ 不缓存。
 */
export function buildCredentialMeta(input: CredentialMetaInput): CredentialMeta[] {
    const rows: CredentialMeta[] = [];
    for (const id of keySources()) {
        const meta = PROVIDERS.find((p) => p.id === id);
        rows.push(
            makeRow(
                input,
                'source',
                id,
                meta?.label ?? id,
                '元数据源',
                isSourceConfigured(input.settings, id),
            ),
        );
    }
    for (const id of MUSIC_CREDENTIAL_IDS) {
        rows.push(
            makeRow(
                input,
                'music',
                id,
                MUSIC_CREDENTIAL_LABELS[id] ?? id,
                '音乐平台',
                isMusicConfigured(input.settings, id),
            ),
        );
    }
    for (const id of NET_CREDENTIAL_IDS) {
        rows.push(
            makeRow(
                input,
                'net',
                id,
                NET_CREDENTIAL_LABELS[id] ?? id,
                '网络播放',
                isNetConfigured(input.settings, id),
            ),
        );
    }
    return rows;
}

/** 面板顶部的汇总（「13 条 · 已配置 N · 失效 M」）。 */
export interface CredentialSummary {
    total: number;
    configured: number;
    expired: number;
    /** 已配置但**从未测过**的条数（面板要提示「有 N 条还没检测过」）。 */
    unchecked: number;
}

/** 汇总 —— 只数，不改行（⛔ 别在这里二次判定失效，判据已在 `buildCredentialMeta`）。 */
export function summarizeCredentialMeta(rows: readonly CredentialMeta[]): CredentialSummary {
    let configured = 0;
    let expired = 0;
    let unchecked = 0;
    for (const r of rows) {
        if (r.configured) configured += 1;
        if (r.expired) expired += 1;
        if (r.configured && !r.checked) unchecked += 1;
    }
    return { total: rows.length, configured, expired, unchecked };
}

/**
 * 「上次刷新时间」列的文字。
 * · 没测过 → `'—'`（⛔ 不编时间）
 * · 有结论 → `'YYYY-MM-DD HH:mm'`
 * @param now 允许注入（单测用），缺省取 `Date.now()`。
 */
export function formatCheckedAt(ts: number | null, now: number = Date.now()): string {
    if (ts === null || !Number.isFinite(ts) || ts <= 0) return '—';
    const d = new Date(ts);
    // 未来时间（用户改过系统时钟 / 数据迁移）也照实显示，⛔ 别静默夹到 now
    const pad = (n: number): string => String(n).padStart(2, '0');
    void now;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 「是否失效」列的文字（三态，与既有徽标口径**逐字相同**：已配置 / 未配置 / 连接失败）。
 *
 * 🔴 额外第四态「未检测」：已配置但 `checked === false`。
 *   设置页徽标那里「已配置但没测过」显示「已配置」（因为徽标只有一个格子、没有时间列），
 *   面板多一列专门讲状态，把「没测过」说出来才有用 —— 否则用户以为那 8 条都验过了。
 */
export function credentialStateLabel(row: CredentialMeta): string {
    if (!row.configured) return '未配置';
    if (row.expired) return '连接失败';
    if (!row.checked) return '未检测';
    return '正常';
}

/**
 * ⛔ 2026-11-12 第 28 轮（用户 `m07505` 逐字：「还有微信读书这个把上次检测的提示描述
 *   『登录超时可续期』删除掉」）：这里原来有 `credentialExpiryHint(row)`，给微信读书那一行
 *   第二句提示「登录超时可续期」。用户明确要求删掉 ⇒ **整条通道退场**：
 *     · `CredentialMeta.renewHint` 字段（连同 `makeRow` 的第 7 个形参）已删；
 *     · 本函数已删（不再有任何调用点）；
 *     · `src/Settings.ts` 的 `whenCell` 里那句 `credentialExpiryHint(row)` 与 `.rl-cred-hint` 已删；
 *     · `styles.css` 的 `.rl-cred-hint` 规则已删。
 *   ⛔ 别再以「给某一列补说明」为由把它加回来 —— 那一列真正要讲的是
 *      「上次检测：YYYY-MM-DD HH:mm」（由 `formatCheckedAt` 承担），
 *      再补一句主观说明会让用户把它当成**可核查的事实**去依赖。
 */
