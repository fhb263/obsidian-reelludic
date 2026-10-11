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
//   ⑷ 🔴🔴 **只测国内源**（#597，用户 2026-10-10）：「失效检测仅检测**元数据源的国内源**和**音乐源凭据的国内源**，
//      如 TMDB、Bangumi、Google Books、IGDB **不检测**」。
//      · 元数据源：真源 = `PROVIDERS` 的 `domestic` 标记（现役国内 = **豆瓣 / 微信读书**两条）——
//        ⛔ 别在这里手抄一份 id 名单（加源必然漏）；
//      · 音乐源：现役三平台（网易云 / QQ / 酷狗）**全是国内源** ⇒ 名单 = `DOMESTIC_MUSIC_SOURCES`
//        （⛔ 不是「不筛」：将来加一个境外平台时，这里就是唯一的把关点）。
//      ⚠️ 为什么外源不测：它们多半要走代理才通，开机自检会在通不了网/走不动代理时把**好凭据**标成「已失效」
//        —— 那比不标更糟（用户会去反复重填一个本来没问题的 Key）。
import { PROVIDERS } from 'pure/sourceRegistry';

/**
 * 🔴 #597：**国内音乐源**（带 Cookie 的三个平台）—— 开机自检只测这些。
 * ⚠️ 现役 `MusicSourceId` = `netease | qq | kugou`，**三个都是国内源** ⇒ 本名单与它逐项相同；
 *    将来加境外平台时，**只把它排除在本名单之外**即可（⛔ 别改成「不再过滤」）。
 * 🔴 与 `pure/sourceIcons.MUSIC_COOKIE_ICON` 的键集合一致由单测钉住（⛔ 手抄两份必然漂移）。
 */
export const DOMESTIC_MUSIC_SOURCES: readonly string[] = ['netease', 'qq', 'kugou'];

/** 「已失效」徽标文案 —— **唯一真源**（设置页「元数据源凭据」与「音乐源凭据」两组共用）。 */
export const EXPIRED_BADGE = '已失效';

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
 * 自检结果的**键**（两族用前缀分开）。
 * 🔴 必须带前缀：音乐源 id 是 `qq` 这种短名，与数据源 id 同在（未来）一个命名空间里迟早撞车。
 */
export function sourceCheckKey(id: string): string {
    return `source:${id}`;
}
export function musicCheckKey(id: string): string {
    return `music:${id}`;
}

/** settings 的结构类型视图（⛔ 不 import `Settings` —— 避免把一条依赖链拖进纯模块） */
type Bag = Record<string, unknown>;

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/**
 * 本次开机要自检的凭据：**国内**元数据源（注册表顺序）+ **国内**音乐源（`musicDlCookies` 里有值的那些）。
 * 🔴 #597：非国内源（TMDB / Bangumi / Google Books / IGDB / OMDb / …）**一律不测**（见文件头 ⑷）。
 * @param settings 插件的 settings 对象（`unknown` 入参 ⇒ 单测可以直接喂最小对象）
 */
export function configuredCredentialChecks(settings: unknown): { sources: string[]; music: string[] } {
    const s: Bag = settings && typeof settings === 'object' ? (settings as Bag) : {};
    const sources: string[] = [];
    for (const p of PROVIDERS) {
        if (!p.domestic) continue; // 🔴 #597：只测国内源（⛔ 别把这一条挪走 —— 它是本函数的唯一把关点）
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

/** 自检结果 → 要不要在徽标上标「已失效」。`undefined`（还没测过）⇒ `false`。 */
export function isExpired(status: boolean | undefined): boolean {
    return status === false;
}
