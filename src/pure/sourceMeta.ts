// 数据源侧元数据（大众评分 communityScore / 来源链接 sourceUrl / 来源名 sourceName）的**手动填写**校验。
//
// 背景：前两个字段原本只能由搜索/详情回填（`EntryForm` 点选结果时写入），手动填写路径没有录入入口，
// 于是「自己知道评分/官方页地址但搜不到源」的场景只能干看着。2026-09-27 给表单加了两个输入框，
// 同时定死口径 —— **仅新增时可手填，编辑后只读**（视图层：编辑态不渲染输入框，值仍由回填驱动，
// 故「重新拉取」换源照旧生效，不会因为只读而失效）。
//
// #430 追加第三个框 **来源名 `sourceName`**（用户：「在大众评分前面并排个来源框（仅第一修改有效，
// 新增后显示为如番茄8星，番茄来源）」）—— 手工新建的条目**没有数据源**（`source` 空），
// 于是封面角标只能显示「8.4★」、标题栏链接只能显示「来源」；有了手填来源名就能显示「番茄8.4★」。
//
// 分制口径（用户 2026-09-27 裁定 D-5）：**统一 10 分制**。豆瓣/TMDB/Bangumi 都是 10 分制；
// Google Books 的 5 分制是少数派 —— 手填一律按 10 分制校验，⛔ 不做「按类型猜分制」的自动换算
// （换算猜错的后果是**静默存进一个错值**，比直接拦下难查得多）。
//
// 本模块只回答「这串输入是什么、能不能用」，DOM / Notice / 落库形态留给视图层。
import { sourceLabel } from 'pure/sourceRegistry';

/** 大众评分上限（10 分制） */
export const COMMUNITY_SCORE_MAX = 10;

/**
 * 大众评分手填校验；合法（**含留空**）返回 `null`，非法返回给用户看的一句话。
 *
 * 留空是合法的 —— 表示「不填」，对应落库 `undefined`（不是 0）。
 */
export function communityScoreIssue(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^\d+(?:\.\d+)?$/.test(s)) return '大众评分请填写数字（如 8.4）';
    const n = Number(s);
    if (!(n > 0)) return '大众评分需大于 0';
    if (n > COMMUNITY_SCORE_MAX) return `大众评分不能超过 ${COMMUNITY_SCORE_MAX}（10 分制）`;
    return null;
}

/** 大众评分 → 落库数值（留空 / 非法 → `undefined`）；最多保留一位小数。 */
export function parseCommunityScore(raw: string): number | undefined {
    if (communityScoreIssue(raw) !== null) return undefined;
    const s = String(raw ?? '').trim();
    if (!s) return undefined;
    return Math.round(Number(s) * 10) / 10;
}

/**
 * 来源链接手填校验；合法（**含留空**）返回 `null`，非法返回给用户看的一句话。
 *
 * 只认 `http(s)://` 绝对地址 —— 与 `main.openExternalUrl` 的放行口径**逐字一致**，
 * 免得「表单收得下、点开却被拒」。
 */
export function sourceUrlIssue(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^https?:\/\/\S+$/i.test(s)) return '平台链接请填 http:// 或 https:// 开头的地址';
    return null;
}

/** 来源链接 → 落库值（留空 / 非法 → `undefined`）。 */
export function parseSourceUrl(raw: string): string | undefined {
    if (sourceUrlIssue(raw) !== null) return undefined;
    return String(raw ?? '').trim() || undefined;
}

// ────────────────────────── 来源名（#430） ──────────────────────────

/**
 * 来源名长度上限。
 * 🔴 这个值最终会印在**封面角标**上（形态是「番茄8.4★」），所以必须有上限 —— ⛔ 别允许一句话。
 * 12 个字：中文来源名（出版社 / 站点 / 系列）够用，且不会把右侧的「8.4★」挤出角标。
 */
export const SOURCE_NAME_MAX = 12;

/**
 * 「来源」手填校验；合法（**含留空**）返回 `null`，非法返回给用户看的一句话。
 *
 * 🔴 刻意**不校验「是不是已知平台」**：用户自填的来源（自建站 / 出版社 / 私域）本来就落在已知集合之外，
 *    拿白名单去拦等于把这个框变成「只能填那几个」，与「手动填写」的初衷相反。
 */
export function sourceNameIssue(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (s.length > SOURCE_NAME_MAX) return `来源名最多 ${SOURCE_NAME_MAX} 个字（它会印在封面角标上）`;
    return null;
}

/**
 * 来源名 → 落库值（留空 / 非法 → `undefined`）。
 * ⚠️ 内部空白**折成单个空格**：从网页粘一句带换行的东西进来会把角标顶成两行。
 */
export function parseSourceName(raw: string): string | undefined {
    if (sourceNameIssue(raw) !== null) return undefined;
    const s = String(raw ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    return s || undefined;
}

/**
 * 条目显示用的「来源名」——**唯一裁决入口**（#430）。
 *
 * 优先级：**手填的 `sourceName`** ＞ 数据源键的中文名（`sourceLabel(source)`）＞ `''`。
 *
 * 🔴 三处消费必须都走它：**封面角标**（「番茄8.4★」）、**表单标题栏的链接按钮**、**笔记的「来源」行** ——
 *    各写一遍必然漂移，用户会在三个地方看到三个说法（本仓「阅读进度」「书籍文件名」都栽过同款）。
 * ⚠️ 回落那一层用 `sourceLabel` 而不是原样吐 `source`：`douban` 要变成「豆瓣」。
 */
export function entrySourceLabel(e: { sourceName?: string; source?: string }): string {
    const manual = String(e?.sourceName ?? '').trim();
    if (manual) return manual;
    return sourceLabel(e?.source);
}

// ────────────────────────── 评价人数（#431） ──────────────────────────

/**
 * 评价人数上限。
 * ⚠️ 纯防手抖（多按几个 0）：`9999 万人评价` 已经是天文数字，再大多半是笔误 ——
 *    ⛔ 但**不做「按数据源判断合理性」**那类聪明事（豆瓣就那点人，别的站不一定）。
 */
export const RATING_COUNT_MAX = 99_999_999;

/** `评分 | 人数` 的分隔符：半角与**全角**竖线都认（中文输入法下打出来的是全角 `｜`）。 */
const SCORE_COUNT_SEP = /[|｜]/;

/**
 * 把 `7 | 500` 这种**一气呵成**的写法拆成两段（#431，用户给的样例就是这个形状）。
 *
 * 🔴 只拆**含分隔符**的串（没有分隔符 ⇒ 返回 `null`，交给两个框各自处理）——
 *    ⛔ 别把 `7` 也当成「评分 + 空人数」拆出来，那会让「只填评分」这条老路径多绕一圈。
 * ⚠️ 只做**切分**，不判合法性：两段是否合法由 `communityScoreIssue` / `ratingCountIssue` 各自回答
 *    （⛔ 别在这里顺手把 `abc` 洗成空串 —— 那会把非法值静默吞掉）。
 */
export function splitScoreCount(raw: string): { score: string; count: string } | null {
    const s = String(raw ?? '');
    if (!SCORE_COUNT_SEP.test(s)) return null;
    const [score = '', count = ''] = s.split(SCORE_COUNT_SEP, 2);
    return { score: score.trim(), count: count.trim() };
}

/**
 * 评价人数手填校验；合法（**含留空**）返回 `null`，非法返回给用户看的一句话。
 *
 * 宽松处：**允许千分位逗号**（`1,234`）—— 从页面上复制下来的数字常带逗号，为此报错太苛刻。
 */
export function ratingCountIssue(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (!/^\d{1,3}(?:,\d{3})*$|^\d+$/.test(s)) return '评价人数请填写数字（如 500）';
    if (Number(s.replace(/,/g, '')) > RATING_COUNT_MAX) return `评价人数不超过 ${RATING_COUNT_MAX.toLocaleString('en-US')}`;
    return null;
}

/** 评价人数 → 落库值（留空 / 非法 → `undefined`）。 */
export function parseRatingCount(raw: string): number | undefined {
    if (ratingCountIssue(raw) !== null) return undefined;
    const s = String(raw ?? '').trim();
    if (!s) return undefined;
    return Number(s.replace(/,/g, ''));
}
