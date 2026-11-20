/**
 * AI 预填的**真实性闸口**（用户 m16449：「优化AI预填真实每个类型返回模拟」——
 * 选择「修掉编造：让每个类型都只用真实检索到的数据」）。
 *
 * ## 这条闸口要解决什么
 * 实测（`main.ts` 的 `runPrefillTool` 与 `pure/searchDisplay.describeSearchResult`）：
 * `lookup_metadata` 交给模型的文本只有「标题 / 年份 / 来源 / 评分 / 题材 / 副标题」这一档，
 * 而 `prefillFieldsFor` 让它填的字段远多于这些 —— 总集数、开发商、平台、页数、ISBN、
 * 主演、导演、专辑、出版社……**这些键在工具文本里根本不存在**。
 * 模型为了「把表填满」，就只能按印象写（俗称模拟数据）：集数凑一个、开发商写个大概、
 * ISBN 编一串数字。用户看到的「预填」因此不可信。
 *
 * ## 判据（机械、可单测）
 * 逐个**事实字段**，把它的值切成 token，要求**每个 token 都在工具产出文本里出现过**；
 * 一个对不上 ⇒ 整条字段丢弃。这样「查到了就填、查不到就空着」成为结构保证，
 * 而不是靠提示词里那句「不确定就省略」（实测模型并不遵守）。
 *
 * ## 为什么 `tags` 是例外
 * 标签是**用户自己的个人标签**（`pure/aiPrefill` 的 `TAGS_DEF`：「给这条内容打的个人标签」），
 * 任何一个外部数据源都不会给出它 —— 要求「必须出现在工具文本里」等于让它永远填不上。
 * ⇒ 它是唯一豁免的键，见 `PREFILL_PERSONAL_KEYS`。
 *
 * ⚠️ 本模块**零依赖**（不 import obsidian / DOM），可被纯单测直接跑。
 */

/** 豁免闸口的字段：值本来就只能来自模型/用户，不存在「检索得到」这回事 */
export const PREFILL_PERSONAL_KEYS: readonly string[] = ['tags'];

/**
 * 值里的分隔符：这些字符切开后每一段都算一个独立 token。
 * 与表单口径对齐（题材/主演用 `/`、标签用逗号）—— `\n` 也要切，
 * 因为「目录」是「每行一项」，不切会把整段当做一个巨大的 token、永远对不上。
 */
const TOKEN_SPLIT = /[\/、,，;；\n]+/;

/** 纯数字 token（年份 / 集数 / 页数 / ISBN）—— 必须做边界检查，否则 `12` 会被 `2012` 命中 */
const NUMERIC = /^\d+$/;

/**
 * 归一化：`NFKC` → 小写 → 去掉所有空白。
 *
 * 去空白是刻意的：工具产出里的一句简介会被折成一行（`extractToolSynopsis` 就是这么做），
 * 而页面原文是跨行的；两边都去掉空白才能逐字比对。
 * `NFKC` 管的是全角数字 / 全角括号这类同义异形（`１２` vs `12`）。
 */
export function normalizeFact(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, '');
}

/** 数字 token 的边界检查：前后都不能再是数字（防 `12` 命中 `2012` / `3120`） */
function numericAppears(token: string, hay: string): boolean {
    let at = hay.indexOf(token);
    while (at >= 0) {
        const before = at > 0 ? hay[at - 1] : '';
        const after = at + token.length < hay.length ? hay[at + token.length] : '';
        if (!/\d/.test(before) && !/\d/.test(after)) return true;
        at = hay.indexOf(token, at + 1);
    }
    return false;
}

/**
 * 单个值是否**有据可查**。
 *
 * 判定顺序：
 * 1. 归一后整串直接出现在文本里 ⇒ 通过（覆盖「简介 / 作者简介」这类整段照抄）。
 * 2. 否则切 token，**每个** token 都要能对上：
 *    - 单字符 token 一律忽略（`/` 切出来的碎片、`1` 位数字没有判别力，留着只会造成误判）；
 *    - 纯数字 token 走边界检查；其余 token 走普通包含。
 * 3. 一个有效 token 都没有（值本身是空的/全是单字符）⇒ **不通过**（空值不该被当成「有据」）。
 */
export function factGrounded(value: unknown, toolText: string): boolean {
    const hay = normalizeFact(toolText);
    if (!hay) return false;
    const v = normalizeFact(value);
    if (!v) return false;

    // 🔴 数字**必须**走边界检查，⛔ 不能用下面的「整串包含」快速路径放过它 ——
    //    `总集数：2012` 里 `includes('12')` 为真，会把「12 集」这种编造值判成有据。
    //    （踩过：第一版先判 `hay.includes(v)`，`factGrounded('12','总集数：2012')` 返回 true。）
    if (NUMERIC.test(v)) return numericAppears(v, hay);

    if (hay.includes(v)) return true;

    const tokens = v
        .split(TOKEN_SPLIT)
        .map((t) => normalizeFact(t))
        .filter((t) => t.length >= 2);
    if (!tokens.length) return false;

    for (const t of tokens) {
        if (NUMERIC.test(t)) {
            if (!numericAppears(t, hay)) return false;
        } else if (!hay.includes(t)) {
            return false;
        }
    }
    return true;
}

/** 闸口结果：保留下来的字段 + 被丢弃的字段（丢弃清单要让用户看得见，⛔ 别静默） */
export interface GroundResult {
    fields: Record<string, string>;
    /** 被丢弃的字段 key（按 `fields` 原顺序） */
    dropped: string[];
}

/**
 * 过闸：把**未经检索证实的字段**从结果里剔掉。
 *
 * @param fields 已经过简介/题材照搬裁决的字段表
 * @param toolText 本次预填**所有工具产出的拼接文本**（没有工具 ⇒ 传空串 ⇒ 所有事实字段都会被丢弃，
 *                 这正是「只认真实检索」的应有结果；调用方必须把这件事如实告诉用户）
 * @param defs 本次要填的字段定义（只用它的 `key`，用来知道「哪些键属于本次 schema」）
 */
export function groundPrefillFields(
    fields: Record<string, string>,
    toolText: string,
    defs: readonly { key: string }[],
): GroundResult {
    const known = new Set(defs.map((d) => d.key));
    const out: Record<string, string> = {};
    const dropped: string[] = [];

    for (const [k, v] of Object.entries(fields)) {
        if (!known.has(k)) continue; // schema 之外的键本来就不该在这里
        if (PREFILL_PERSONAL_KEYS.includes(k)) {
            out[k] = v;
            continue;
        }
        if (factGrounded(v, toolText)) {
            out[k] = v;
        } else {
            dropped.push(k);
        }
    }
    return { fields: out, dropped };
}

/**
 * 丢弃清单 → 给用户的一句话（`null` = 一个都没丢，不用弹提示）。
 *
 * 文案口径：说清「丢了几项」并**点名**，让用户知道不是功能坏了而是数据没查到。
 * ⛔ 别写成「预填失败」——字段确实填了一部分，只是没查到的那些没有编。
 */
export function droppedNotice(dropped: readonly string[], labels: readonly { key: string; label: string }[]): string | null {
    if (!dropped.length) return null;
    const nameOf = new Map(labels.map((d) => [d.key, d.label]));
    const names = dropped.map((k) => nameOf.get(k) ?? k);
    return `已丢弃 ${dropped.length} 项未经检索证实的字段（${names.join(' / ')}）—— 查不到就不编，可手动补`;
}
