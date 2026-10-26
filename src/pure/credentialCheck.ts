// 开机凭据自检的**纯逻辑**（#589）：哪些凭据该测、徽标怎么显示、串行节奏。
// 零 `obsidian` / 零网络 / 零 DOM —— 可单测；真正的网络调用全在宿主（`main.ts`）那一层。
//
// 🔴 由来（用户 2026-10-10 第五条）：「新会话打开 obsidian 时，给元数据源凭据和音乐源凭据测试连接，
//    显示已失效标签」。⇒ 插件加载后**延迟 + 串行**跑一遍已配置凭据的既有测试函数，失败的在徽标上标「已失效」。
//
// 🔴🔴 三条口径：
//   ⑴ **只测「已经填了」的凭据** —— 空凭据没什么可失效的（测了只会得到一个必然失败的结论，
//      还会把「未配置」误标成「已失效」）。
//   ⑵ **源名单从注册表派生**（`pure/sourceRegistry.PROVIDERS` 的 `keyField` / `keyField2`），
//      ⛔ 别在这里手抄第二份 —— 加一个数据源时手抄那份必然漏。
//   ⑶ **`undefined` 不等于失效**：没测过就是没测过，⛔ 别把「还没跑」画成「已失效」（那是撒谎）。
//   ⑷ 🔴🔴 **只测用户点名的源**（#597 → #634 收窄）：
//      · **#597（2026-10-10）**：用户要求「失效检测仅检测元数据源的国内源和音乐源凭据的国内源，
//        如 TMDB、Bangumi、Google Books、IGDB **不检测**」⇒ 当时用注册表的 `domestic` 标记筛，
//        元数据源里命中的是 **豆瓣 / 微信读书** 两条。
//      · **#634（2026-10-15）**：用户报「豆瓣**开机**显示已失效，但手动测试连接发现没失效」。
//        🔴 根因已取证定性：`runTest` 的外层超时是 `pure/timing.TIMEOUT_MS = **10s**`，
//        而豆瓣那条走 `nodeHttp`（内层 **30s** 超时 + `GET_RETRY = 2` 次重试 + 反爬挑战页跳转）——
//        开机那一刻冷 DNS/TLS + 反爬往返很容易越过 10s ⇒ 外层先判超时 ⇒ 记 `false` ⇒ 标「已失效」；
//        稍后手动点「测试连接」时网络已热，10s 内跑完 ⇒ 通过。**两端判据不一致，误报是必然的。**
//        ⇒ 用户裁定：**开机自检不再测豆瓣**，元数据源只留**微信读书**一条。
//      ⚠️ 为什么不是「把超时调大」：10s 是**设置页手动测试**的通用阈值（用户面前等 30s 不可接受），
//        而自检要的是「别误报」——两件事的取舍不同，改成两个阈值等于把偶发误报的概率留在那里。
//      · 🔴 实现 = `SELF_CHECK_SOURCES` **显式白名单**（⛔ 不再拿 `domestic` 当自检名单）。
//        `domestic` 字段**保留**（它仍表达「是不是国内源」这个事实，注册表里是必填项），
//        但它**不再是自检的判据** —— 判据与事实分开，将来再加国内源也不会被悄悄塞进自检。
import { PROVIDERS } from 'pure/sourceRegistry';

/**
 * 🔴 #634：**开机自检的元数据源白名单** —— 只测这两条里**已经填了凭据**的。
 *
 * ⛔ 别改回「拿 `domestic` 筛」：豆瓣那条**必然误报**（取证见文件头 ⑷），原因与 timing 有关、
 *    与它是不是国内源无关。加新源时**主动决定**它要不要进自检，再把 id 写进来。
 * ⚠️ 与注册表的耦合由单测钉住（id 必须真在 `PROVIDERS` 里，⛔ 防手抄一个打错的 id 静默失效）。
 */
export const SELF_CHECK_SOURCES: readonly string[] = ['weread'];

/**
 * 🔴 #597：**国内音乐源**（带 Cookie 的三个平台）—— 开机自检只测这些。
 * ⚠️ 现役 `MusicSourceId` = `netease | qq | kugou`，**三个都是国内源** ⇒ 本名单与它逐项相同；
 *    将来加境外平台时，**只把它排除在本名单之外**即可（⛔ 别改成「不再过滤」）。
 * 🔴 与 `pure/sourceIcons.MUSIC_COOKIE_ICON` 的键集合一致由单测钉住（⛔ 手抄两份必然漂移）。
 */
export const DOMESTIC_MUSIC_SOURCES: readonly string[] = ['netease', 'qq', 'kugou'];

/** 「连接失败」徽标文案 —— **唯一真源**（设置页「元数据源凭据」与「音乐源凭据」两组共用）。 */
export const EXPIRED_BADGE = '连接失败';

/**
 * 插件加载后**延迟**多久才跑自检（ms）。
 * 🔴 不立刻跑：别跟开库抢资源，也别刚打开库就一串网络请求（用户可能马上就关了）。
 */
export const CREDENTIAL_CHECK_DELAY_MS = 4000;

/**
 * 两件凭据之间的**串行间隔**（ms）。
 * 🔴 豆瓣那类源吃风控，一次把 7~10 个请求全打过去会**集体失败** —— 那会把好凭据误标成「已失效」。
 */
export const CREDENTIAL_CHECK_GAP_MS = 700;

/**
 * 自检结果的**键**（三族用前缀分开）。
 * 🔴 必须带前缀：音乐源 id 是 `qq` 这种短名，与数据源 id 同在（未来）一个命名空间里迟早撞车。
 * ⚠️ #634：`ai:` 这一族**不进开机自检**（AI 服务多在境外 / 要代理 ⇒ 同 ⑷ 的理由），
 *    它只由设置页那颗「测试连接」写入 —— 但键与前缀仍与另外两族同源，⛔ 别写裸字符串。
 */
export function sourceCheckKey(id: string): string {
    return `source:${id}`;
}
export function musicCheckKey(id: string): string {
    return `music:${id}`;
}
/** #634：AI 服务（翻译 / 总结 / 云合成 / 自定义端点）的「测试连接」结论键。 */
export function aiCheckKey(id: string): string {
    return `ai:${id}`;
}

/** settings 的结构类型视图（⛔ 不 import `Settings` —— 避免把一条依赖链拖进纯模块） */
type Bag = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * 本次开机要自检的凭据：`SELF_CHECK_SOURCES`（元数据源，现役 = 微信读书）里有值的
 * + **国内**音乐源（`musicDlCookies` 里有值的那些）。
 * 🔴 #634：元数据源判据 = `SELF_CHECK_SOURCES` 白名单（⛔ **不是** `domestic`，理由见文件头 ⑷）。
 * @param settings 插件的 settings 对象（`unknown` 入参 ⇒ 单测可以直接喂最小对象）
 */
export function configuredCredentialChecks(settings: unknown): { sources: string[]; music: string[] } {
    const s: Bag = settings && typeof settings === 'object' ? (settings as Bag) : {};
    const sources: string[] = [];
    for (const p of PROVIDERS) {
        if (!SELF_CHECK_SOURCES.includes(p.id)) continue; // 🔴 #634：只测白名单里的（⛔ 别挪走这行）
        if (!p.keyField) continue; // 免 Key 源不在此列
        if (!str(s[p.keyField])) continue;
        // 双凭据源（IGDB）：两字段**同有值**才算「已配置」—— 与设置页徽标同一判据
        if (p.keyField2 && !str(s[p.keyField2])) continue;
        sources.push(p.id);
    }
    const raw = s.musicDlCookies;
    const cookies: Bag = raw && typeof raw === 'object' ? (raw as Bag) : {};
    const music = Object.keys(cookies).filter((k) => DOMESTIC_MUSIC_SOURCES.includes(k) && str(cookies[k]) !== '');
    return { sources, music };
}

/** 自检结果 → 要不要在徽标上标「连接失败」。`undefined`（还没测过）⇒ `false`。 */
export function isExpired(status: boolean | undefined): boolean {
    return status === false;
}

/** 「凭据测试结论」的落盘形态：键 → 测通没测通（`source:x` / `music:x` / `ai:x`）。 */
export type CredentialStatusMap = Record<string, boolean>;

/**
 * 🔴🔴 用户裁定（1.4.x）：「已测试链接得到的**连接失败**标签要持久化，重启新会话后不要变回『已配置』，
 *    要等到下一次用户测过才改」。⇒ 结论必须落盘，不能只活在内存 Map 里。
 *
 * 为什么这条以前做不到（根因，⛔ 别只看表面）：结论一直存在 `main.ts` 的 `Map<string, boolean>`，
 *   `loadData()` 从不读回它；而开机自检的白名单里**没有豆瓣**（#634：豆瓣必然误报）——
 *   于是「豆瓣测过失败 → 重启 → 既无狗盘值、自检又不测它」⇒ 徽标必然回到「已配置」。
 *
 * 下面是**纯的归一/读写**（零 obsidian / 零 DOM ⇒ 可单测）：
 *   · 只有 `true` / `false` 算结论，其余（脏数据、`null`、字符串）**一律丢掉** ——
 *     ⛔ 别把 `"false"` 这种真值串当成 false，那会把「没测过」画成「连接失败」。
 *   · `undefined` 仍然表示「还没有结论」（= 不标徽标），与内存态口径一致。
 */
export function normalizeCredentialStatus(raw: unknown): CredentialStatusMap {
    if (!raw || typeof raw !== 'object') return {};
    const out: CredentialStatusMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'boolean' && k) out[k] = v;
    }
    return out;
}

/** 读一条结论（`undefined` = 没测过）。 */
export function statusOf(status: CredentialStatusMap, key: string): boolean | undefined {
    return Object.prototype.hasOwnProperty.call(status, key) ? status[key] : undefined;
}

/** 写入一条结论，**返回新对象**（⛔ 别原地改：调用方要能判断「值有没有变」再决定落不落盘）。 */
export function withStatus(status: CredentialStatusMap, key: string, ok: boolean): CredentialStatusMap {
    return { ...status, [key]: ok };
}

/** 清掉一条结论（用户改了凭据 ⇒ 旧结论作废），返回新对象。 */
export function withoutStatus(status: CredentialStatusMap, key: string): CredentialStatusMap {
    if (!Object.prototype.hasOwnProperty.call(status, key)) return status;
    const next = { ...status };
    delete next[key];
    return next;
}
