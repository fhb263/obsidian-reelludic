/**
 * **SoNovel 书源**（`.json` 规则文件）的解析与体检（纯逻辑，#419）—— 无 `obsidian` / 无 DOM / 无网络，可单测。
 *
 * ## 这个模块在整条链上的位置
 * 用户自备的 `.json` 书源 ⇒ **本模块**（解析 + 校验 + 体检）⇒ `pure/ruleExpr`（把规则串编译成步骤）
 * ⇒ `services/htmlQuery`（`DOMParser` 执行）⇒ `services/novelSource`（编排抓取）⇒ 落盘。
 *
 * ## 为什么认 SoNovel 格式（用户指名，2026-09-28）
 * 用户原话：「改成接内容源，按我给参考的软件做」—— 参考目录里给的是
 * `freeok/so-novel`（`网文创作/小说下载/网络小说下载器/SoNovel/`），其 `rules/*.json`
 * 就是本模块认的格式（字段与官方 `rule-template.json5` 一致）。
 * ⚠️ legado 书源字段名完全不同（搜 / 目录 / 正文的键名是本格式的对偶写法，前缀不一样）⇒ **本模块不认**；
 *    若要支持是「适配器」的活（方案文档 §8.3 D-26(b)）。
 *    🔴 **注释里别把那几个字段名照写出来** —— 断言块里有一条反向守卫锚它们（写出即自撞红，本仓踩过七次）。
 *
 * ## 🔴 红线（用户 2026-09-28 裁定的 D-24(a)，未改）
 * 插件**不内置任何书源**、**不绕过登录与付费**、**不执行第三方脚本**：
 *  · 书源全部来自用户自己的文件（`@js:` 脚本**一律不执行**，只在体检里标成「已降级」）；
 *  · 需要 Cookie / 登录的书源照样能导入，但要**明确标出前提**，⛔ 不静默尝试绕。
 *
 * ## 格式（官方模板口径；`null` 与缺字段等价）
 * ```
 * { url, name, comment, language, disabled,
 *   search:  { disabled, url, method, data, cookies, result, bookName, author, category,
 *              wordCount, status, latestChapter, lastUpdateTime, nextPage },
 *   book:    { url, bookName, author, intro, category, coverUrl, latestChapter, lastUpdateTime, status },
 *   toc:     { baseUri, url, item, isDesc, nextPage },
 *   chapter: { title, content, paragraphTagClosed, paragraphTag, filterTxt, filterTag, nextPage },
 *   crawl:   { concurrency, minInterval, maxInterval, maxAttempts, retryMinInterval, retryMaxInterval } }
 * ```
 */

/** 取值规则串（CSS 选择器 + 可选 `@后缀`）；编译见 `pure/ruleExpr` */
export type RuleString = string;

/**
 * 书源分类（#422）：`novel` 网络文学 / `book` 经典文学 —— 与**条目**的 `pure/bookKind` 同一口径，
 * 好让「按条目类型筛源」这一步不需要再做一次映射。
 */
export type SourceKind = 'novel' | 'book';

/** 两类书源在 UI 上的标题（设置页小节名 / 空态文案共用一份，⛔ 别在两处各写一遍） */
export const SOURCE_KIND_LABEL: Readonly<Record<SourceKind, string>> = {
    novel: '网络文学源',
    book: '经典文学源',
};

/** 全部分类（固定顺序：网文在前 —— 它是这个功能的来处，也是缺省值） */
export const SOURCE_KINDS: readonly SourceKind[] = ['novel', 'book'];

export interface NovelSourceSearch {
    disabled?: boolean;
    url: RuleString;
    method: string;
    data?: string;
    cookies?: string;
    /** 每条搜索结果的选择器（**必需**） */
    result: RuleString;
    bookName?: RuleString;
    author?: RuleString;
    category?: RuleString;
    wordCount?: RuleString;
    status?: RuleString;
    latestChapter?: RuleString;
    lastUpdateTime?: RuleString;
    nextPage?: RuleString;
}

export interface NovelSourceBook {
    url?: RuleString;
    bookName?: RuleString;
    author?: RuleString;
    intro?: RuleString;
    category?: RuleString;
    coverUrl?: RuleString;
    latestChapter?: RuleString;
    latestChapterUrl?: RuleString;
    lastUpdateTime?: RuleString;
    status?: RuleString;
}

export interface NovelSourceToc {
    /** 章节链接是相对路径时的基准（缺省 = 目录页自身） */
    baseUri?: string;
    /** 目录页与详情页不同站内页面时的目录页链接规则 */
    url?: RuleString;
    /** 目录里章节链接的选择器（**必需**） */
    item: RuleString;
    isDesc?: boolean;
    nextPage?: RuleString;
}

export interface NovelSourceChapter {
    title: RuleString;
    content: RuleString;
    /** 正文是否用成对标签分段（`<p>…</p>`）；否则按 `paragraphTag` 正则分段 */
    paragraphTagClosed?: boolean;
    /** 不成对分段时的分隔正则（如 `<br>+`） */
    paragraphTag?: string;
    /** 需要过滤的文本（**正则**，`|` 是选择分支） */
    filterTxt?: string;
    /** 需要过滤的标签（**CSS 选择器列表**，取到即整块删） */
    filterTag?: string;
    nextPage?: RuleString;
}

export interface NovelSourceCrawl {
    concurrency?: number;
    minInterval?: number;
    maxInterval?: number;
    maxAttempts?: number;
    retryMinInterval?: number;
    retryMaxInterval?: number;
}

/** 一条书源（字段名与文件保持一致，便于原样回写） */
export interface NovelSource {
    url: string;
    name: string;
    comment?: string;
    language?: string;
    disabled?: boolean;
    search?: NovelSourceSearch;
    book?: NovelSourceBook;
    toc: NovelSourceToc;
    chapter: NovelSourceChapter;
    crawl?: NovelSourceCrawl;
    /**
     * 书源分类（#422）—— **不是文件字段**，导入时由「点了哪个导入按钮」写下，之后可在源行里改。
     * ⚠️ 缺省 = `'novel'`（老数据全是从「网文书源」这一条路进来的，见 `sourceKindOf`）。
     * ⚠️ 它跟着对象一起存 `data.json`（append-only 可选字段，旧数据无此键不迁移）。
     */
    kind?: SourceKind;
}

// ────────────────────────── 规则串体检 ──────────────────────────

/**
 * 规则串里是否含 `@js:`（SoNovel 用它做响应体转换 / URL 参数计算）。
 * 🔴 本插件**不执行第三方脚本**（红线 D-24(a)；方案文档 D-18(c) 明确不做）
 *    ⇒ 命中即把这条规则标成「不支持」，**执行时给明确原因**，⛔ 绝不静默返回空串。
 */
export function ruleHasScript(rule: string): boolean {
    return /@js\s*:/i.test(String(rule ?? ''));
}

/**
 * 规则串是否**看起来是 XPath**（SoNovel 教程里从开发者工具「复制 selector」可能给出 `/html/body/…`）。
 * 🔴 判据 = **以 `/` 或 `(` 开头**（#420 按参考实现 `go-novel/internal/core/extractor.go` 补上 `(`）：CSS 选择器永不以这两个字符开头，故不会误判；
 *    `//div[@class='x']`（绝对 XPath）与 `/html/…`（绝对路径）都能命中。
 * ⚠️ 本插件只实现 CSS（`services/htmlQuery` 走 `querySelectorAll`）⇒ XPath 标成不支持。
 */
export function ruleLooksXPath(rule: string): boolean {
    return /^\s*[/(]/.test(String(rule ?? ''));
}

// ────────────────────────── 体检 ──────────────────────────

/** 书源上的标记位（UI 只读这些布尔值渲染徽标） */
export interface SourceFlags {
    /** 含 `@js:` 脚本 ⇒ 相关字段**不会被执行**（已降级） */
    script: boolean;
    /** 需要 Cookie（`search.cookies` 非空）⇒ 多半要登录态 */
    login: boolean;
    /** 含 XPath 规则 ⇒ 本插件不认（只支持 CSS） */
    xpath: boolean;
}

export interface SourceDiagnosis {
    /** 硬错误：缺必需字段 / 形态不对 —— 导入也跑不起来（UI 直接拒收这条） */
    errors: string[];
    /** 软提示：能用，但有前提或降级（UI 显示徽标 + 小字） */
    warnings: string[];
    flags: SourceFlags;
}

/** 取一条书源里**全部**取值规则串（体检遍历用）——`filterTag` / `filterTxt` 不在其中（它们不是选择器取值语义） */
function ruleFields(src: NovelSource): { path: string; value: RuleString }[] {
    const out: { path: string; value: RuleString }[] = [];
    const push = (path: string, value: unknown) => {
        const v = String(value ?? '').trim();
        if (v) out.push({ path, value: v });
    };
    const s = src.search;
    if (s) {
        push('搜索链接', s.url);
        push('搜索列表', s.result);
        push('书名', s.bookName);
        push('作者', s.author);
        push('最新章节', s.latestChapter);
        push('下一页', s.nextPage);
    }
    const b = src.book;
    if (b) {
        push('详情页', b.url);
        push('简介', b.intro);
        push('封面', b.coverUrl);
    }
    push('目录页', src.toc?.url);
    push('目录条目', src.toc?.item);
    push('章节标题', src.chapter?.title);
    push('章节正文', src.chapter?.content);
    return out;
}

/** 规则串在书源里的**用途名**（错误文案里要说清是哪一条坏） */
export function diagnoseSource(src: NovelSource): SourceDiagnosis {
    const errors: string[] = [];
    const warnings: string[] = [];
    const flags: SourceFlags = { script: false, login: false, xpath: false };

    if (!String(src?.name ?? '').trim()) errors.push('缺书源名称');
    if (!String(src?.url ?? '').trim()) errors.push('缺站点地址');

    // 目录与正文是「下整本」的两根支柱，缺一不可
    if (!String(src?.toc?.item ?? '').trim()) errors.push('缺目录规则（toc.item）');
    if (!String(src?.chapter?.title ?? '').trim()) errors.push('缺章节标题规则（chapter.title）');
    if (!String(src?.chapter?.content ?? '').trim()) errors.push('缺章节正文规则（chapter.content）');

    // 搜索面：给了 search 就得给全（缺 result/bookName 的搜索必然解析不出东西）
    const s = src?.search;
    if (s) {
        if (!String(s.url ?? '').trim()) errors.push('搜索缺链接（search.url）');
        if (!String(s.result ?? '').trim()) errors.push('搜索缺结果选择器（search.result）');
        if (!String(s.bookName ?? '').trim()) errors.push('搜索缺书名规则（search.bookName）');
    }

    if (String(s?.cookies ?? '').trim()) {
        flags.login = true;
        warnings.push('该源需要 Cookie（多半要登录态），若站点限流会抓不到');
    }

    // 🔴 同一原因**折成一行并列出受影响的字段** —— 真实书源里一个 `@js:` 常连着好几处，
    //    逐条 push 会让徽标小字滚成一面墙（而 UI 上那只是一枚「已降级」徽标的说明）。
    const scriptPaths: string[] = [];
    const xpathPaths: string[] = [];
    for (const { path, value } of ruleFields(src)) {
        if (ruleHasScript(value)) scriptPaths.push(path);
        else if (ruleLooksXPath(value)) xpathPaths.push(path);
    }
    if (String(src?.chapter?.filterTag ?? '').trim() && ruleLooksXPath(String(src.chapter.filterTag))) {
        xpathPaths.push('过滤标签');
    }
    if (scriptPaths.length) {
        flags.script = true;
        warnings.push(`${scriptPaths.join('、')} 含脚本（@js:），本插件不执行第三方脚本 ⇒ 这些字段已停用`);
    }
    if (xpathPaths.length) {
        flags.xpath = true;
        warnings.push(`${xpathPaths.join('、')} 用的是 XPath，本插件只支持 CSS 选择器`);
    }

    return { errors, warnings, flags };
}

// ────────────────────────── 抓取节奏 ──────────────────────────
// 🔴 #428 翻面：原写「D-20(a)：**串行 + 间隔**」—— 用户已裁定抓章改**并发池 50**、**章间不再等待**
//    （实测书源模板那两个间隔值归一成 2~3 秒 ⇒ 2277 章要跑一个半小时）。本模块现在只剩：
//    **重试退避**（`pacingDelayMs` 仍被 `services/novelSource` 的重试用）+ 书源自报的字段（仅供体检展示）。

/** 抓章节奏：两个间隔都是**秒**；`maxAttempts` = 单章最多试几次（含首次） */
export interface SourcePacing {
    minInterval: number;
    maxInterval: number;
    maxAttempts: number;
}

/** 间隔的**安全边界**（秒）：太小的间隔等于没有节流，太大会让一本 2000 章的书永远下不完 */
export const PACING_MIN_SEC = 0.3;
export const PACING_MAX_SEC = 30;

function clampSec(n: number, fallback: number): number {
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(PACING_MAX_SEC, Math.max(PACING_MIN_SEC, n));
}

/**
 * 取该源的抓取节奏（书源 `crawl` 段 → 带安全边界的默认值）。
 *
 * 🔴 两条口径：
 *  ⑴ **`concurrency` 一律忽略**（恒为 1）：本插件只做**串行**（D-20(a)）—— 对源站友好，
 *     也最不容易被判定为爬虫；书源里写 5 并发也不照做；
 *  ⑵ `minInterval` / `maxInterval` 缺省时给 **2s / 3s**（比 SoNovel 默认略保守），并夹在
 *     `PACING_MIN_SEC`~`PACING_MAX_SEC` 之间 —— 书源里写 `0` 或 `999` 都不会让抓取变成洪水或龟速。
 */
export function sourcePacing(src: NovelSource): SourcePacing {
    const c = src?.crawl;
    const min = clampSec(Number(c?.minInterval), 2);
    const max = clampSec(Number(c?.maxInterval), 3);
    const rawAttempts = Number(c?.maxAttempts);
    const maxAttempts = Number.isFinite(rawAttempts) && rawAttempts > 0 ? Math.min(10, Math.floor(rawAttempts)) : 3;
    // 书源把 min 写得比 max 大是常事（模板里两个都是 0）⇒ 归一成正区间
    return min <= max ? { minInterval: min, maxInterval: max, maxAttempts } : { minInterval: max, maxInterval: min, maxAttempts };
}

/** 一次抓取间隔（毫秒）：在 `[min,max]` 里取，`pick` ∈ [0,1) 由调用方注入（纯函数可测） */
export function pacingDelayMs(p: SourcePacing, pick: number): number {
    const t = Math.min(0.999999, Math.max(0, pick));
    return Math.round((p.minInterval + (p.maxInterval - p.minInterval) * t) * 1000);
}

// ────────────────────────── 文件解析 ──────────────────────────

export interface ParsedSourceFile {
    /** 通过校验、可以导入的书源 */
    sources: NovelSource[];
    /** 被拒的条目（`index` 从 1 起，便于对用户说「第 3 条」） */
    rejected: { index: number; name: string; reason: string }[];
}

/**
 * 解析用户导入的 `.json` 书源文件。
 *
 * 🔴 三种输入形态都收（用户从不同地方拿到的导出文件长这样）：
 *  ① **数组**（SoNovel 官方 `rules/main.json` 的形态，最常见）；
 *  ② **单条对象**（自己写一条时）；
 *  ③ `{ sources: [...] }`（有的整理版会包一层）。
 * ⚠️ **不静默丢条目**：形态不对或缺必需字段的条目一律进 `rejected` 并带原因 ——
 *    否则用户会以为「我导了 11 条，怎么只有 8 条能用」。
 */
export function parseSourceFile(raw: unknown): ParsedSourceFile {
    const list: unknown[] = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { sources?: unknown[] }).sources)
          ? ((raw as { sources: unknown[] }).sources as unknown[])
          : raw && typeof raw === 'object'
            ? [raw]
            : [];

    const sources: NovelSource[] = [];
    const rejected: ParsedSourceFile['rejected'] = [];
    list.forEach((item, i) => {
        const index = i + 1;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            rejected.push({ index, name: '', reason: '这一条不是一个书源对象' });
            return;
        }
        const src = item as NovelSource;
        const { errors } = diagnoseSource(src);
        if (errors.length) {
            rejected.push({ index, name: String(src.name ?? '').trim(), reason: errors.join('；') });
            return;
        }
        sources.push(src);
    });
    return { sources, rejected };
}

/** 解析 `.json` 文本；JSON 本身坏了 ⇒ 抛（由调用方折成一句给用户的话） */
export function parseSourceJson(text: string): ParsedSourceFile {
    let raw: unknown;
    try {
        raw = JSON.parse(String(text ?? ''));
    } catch (e) {
        throw new Error(`不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`);
    }
    return parseSourceFile(raw);
}

// ────────────────────────── 导入合并 ──────────────────────────

/** 书源的**唯一键**：站点地址（归一后）。同一站点重复导入 = 更新，不会堆出一串同名源。 */
export function sourceKey(src: NovelSource): string {
    return String(src?.url ?? '')
        .trim()
        .toLowerCase()
        .replace(/\/+$/, '');
}

/**
 * 取一条书源的分类。
 * 🔴 缺省 `'novel'`：本功能最初就叫「网文书源」，老数据里**没有 `kind` 键**的全是从那条路进来的
 *    ⇒ 归网文才不会让用户升级后「原本能搜到的源突然不参与了」。
 */
export function sourceKindOf(src: NovelSource | null | undefined): SourceKind {
    return src?.kind === 'book' ? 'book' : 'novel';
}

/** 把清单按分类拆开（顺序保持原样；不改变元素，只分组） */
export function groupSourcesByKind(list: readonly NovelSource[]): Record<SourceKind, NovelSource[]> {
    const out: Record<SourceKind, NovelSource[]> = { novel: [], book: [] };
    for (const s of list) out[sourceKindOf(s)].push(s);
    return out;
}

/**
 * 把 `from` 那一类的**全部**书源整批改归 `to` 类（#439）。
 *
 * 缘起：`kind` 是**本地状态**（书源文件里压根没这个键），唯一来源是「当时点的哪个导入按钮」
 * ⇒ 一次误点的整批改分类（见 `mergeSources` ③）写进 `data.json` 之后**无法从内容反推**该归哪类；
 * 而源行只有**逐条**移动，11 条就得点 11 次 —— 更糟的是「本类为空」时那一组里**根本没有源行可点**。
 * 这条给出「整组一把搬」的纯逻辑（设置页行头那枚按钮与弹窗空态那枚按钮共用）。
 *
 * 🔴 口径与单条移动（宿主 `setNovelSourceKind`）严格一致：**只动 `kind`**，
 *    `disabled` 等其它本地状态一律原样保留（用户手动停用的源不该因为搬组被打开）。
 * ⚠️ 不碰 `sourceKey` —— 站点是站点、分类是分类，两件事（`sourceKey` 只管「同站点算更新」）。
 * ⚠️ `from === to` ⇒ 原样（不抛、不改），调用方据此判「无事发生」。
 */
export function moveAllSourcesToKind(
    list: readonly NovelSource[],
    from: SourceKind,
    to: SourceKind,
): NovelSource[] {
    return list.map((s) => (from !== to && sourceKindOf(s) === from ? { ...s, kind: to } : { ...s }));
}

export interface MergeResult {
    sources: NovelSource[];
    /** 新站点条数 */
    added: number;
    /** 已存在、被这次文件覆盖的条数 */
    updated: number;
}

/**
 * 把导入的书源并进已有清单。
 *
 * 🔴 三条口径：
 *  ⑴ **同站点（`url`）算更新**，不追加 —— 否则反复导入同一份文件会堆出一串一模一样的源；
 *  ② **更新时保留用户自己的「停用」选择** —— 刷新一次书源就把用户手动关掉的源又打开，
 *     是很烦人的事（`disabled` 是使用态，不是规则的一部分）；
 *  ③ 🔴 **`kind`（#422）只给「新条目」打标，已存在的站点一律动都不动**。
 *     ⚠️ 这条最初写的是「已存在的跟着改成这次的类」，上线当天就被真实使用打脸：
 *     用户在「经典文学源」里点了一次导入（想刷新那批源），**10 条老源被整批搬走**
 *     ⇒ 换到网文条目里"一条书源都看不见"，以为数据丢了、要重新导入（实测 data.json 里
 *     `kind` 全成了 `book`，条数一条没少）。**一次误点的代价太大了。**
 *     要改分类请走**显式入口**（设置页源行那枚「移到另一组」按钮 / `setNovelSourceKind`）。
 *  ④ **不传 `kind` 时保留旧分类**：`kind` 和 `disabled` 一样是**本地状态**（文件里压根没这个键），
 *     拿 incoming 整个覆盖会把用户分好的类**静默抹掉**（本批单测抓到过一次）。
 */
export function mergeSources(existing: readonly NovelSource[], incoming: readonly NovelSource[], kind?: SourceKind): MergeResult {
    const out: NovelSource[] = existing.map((s) => ({ ...s }));
    const index = new Map<string, number>();
    out.forEach((s, i) => index.set(sourceKey(s), i));
    let added = 0;
    let updated = 0;
    for (const src of incoming) {
        const key = sourceKey(src);
        const tagged: NovelSource = kind ? { ...src, kind } : { ...src };
        const at = index.get(key);
        if (at === undefined) {
            index.set(key, out.length);
            out.push(tagged);
            added++;
            continue;
        }
        // 分类与启停都是「本地状态」：**一律保留用户已有的那份**（kind 由显式入口改，⛔ 不由导入改）
        const prev = out[at];
        const keptKind = prev.kind ?? kind;
        const next: NovelSource = keptKind ? { ...tagged, kind: keptKind } : { ...tagged };
        out[at] = prev.disabled === undefined ? next : { ...next, disabled: prev.disabled };
        updated++;
    }
    return { sources: out, added, updated };
}

// ────────────────────────── 搜索失败：折成人话 ──────────────────────────

/**
 * 网络层不可达的特征串（Node `errno.code` / 自写超时文案 / TLS 报错混在一起 ⇒ 用一批关键字兜）。
 * ⚠️ 这份表是**给归因用的字典**，改动会连带影响界面文案 ⇒ 由单测钉住。
 * ⚠️ 书源侧的失败原因里**还有一类**是「我们自己写的中文」（如「没匹配到任何结果（该源可能已改版或失效）」），
 *    那些本来就面向用户，`novelFailText` 会**原样放行**（⛔ 别统一套壳）。
 */
const NET_UNREACHABLE_HINTS = [
    'timed out',
    'timeout',
    '超时',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ECONNABORTED',
    'EPROTO',
    'EPIPE',
    'socket hang up',
    'getaddrinfo',
    'certificate',
];

/**
 * 把一条**搜索失败原因**折成一句给用户看的话（#422 续四）。
 *
 * 🔴 为什么要有它：`services/novelSource` 的 `error` 字段里混着三类东西 ——
 *  ① **网络层英文原文**：`getaddrinfo ENOENT www.example.com`、`HTTP 404`、`socket hang up`
 *     ⇒ 这些糊在结果列表上就是用户看不懂的乱码（用户上手第一眼就说「太丑了」）；
 *  ② **我们自己写的中文**：「没匹配到任何结果（该源可能已改版或失效）」「该源没有提供搜索」
 *     ⇒ 已经面向用户 ⇒ **原样放行**，⛔ 别套成「请求出错：…」；
 *  ③ **规则编译错误**：「章节正文的规则是空的」⇒ 也是中文 ⇒ 原样放行。
 *
 * ⚠️ **原文一律不丢**：调用方把它放进 `data-tip`（悬浮可看），本函数只负责列表里那一行。
 * ⚠️ 与音乐/书籍下载那套归因（`pure/bookDownload` 里的直链版）**刻意不共用** ——
 *    那边随直链通道在 #422 续四一起删了，且它的兜底文案是「请求出错：」的直链语气。
 */
export function novelFailText(error: string): string {
    const m = String(error ?? '').trim();
    if (!m) return '';
    // ① 纯状态码
    if (/^HTTP \d{3}$/.test(m)) return `该来源返回 ${m}`;
    // ① 网络层
    const low = m.toLowerCase();
    if (NET_UNREACHABLE_HINTS.some((h) => low.includes(h.toLowerCase()))) return '连不上该站点';
    // ② 我们自己写的中文（含「没匹配到」两个变体）——原样给，只把括号里那半句保留
    if (/没匹配到任何结果/.test(m)) return '没匹配到结果（该源可能已改版或失效）';
    if (/没匹配到任何章节/.test(m)) return '没匹配到任何章节（该源可能已改版或失效）';
    // ③ 其余：中文归因原样放行；过长的截断（列表里一行放不下）
    return m.length > 48 ? `${m.slice(0, 48)}…` : m;
}

// ────────────────────────── 给 UI 看的摘要 ──────────────────────────

/** 站点显示名：只取 host，去掉 `www.` 与末尾斜杠（`www.example.com/a/b` → `example.com`）
 * ⚠️ 注释里别写带协议的完整 URL —— 断言块有一条「本模块不得出现任何站点域名」的反向守卫，
 *    写出来会把那条守卫打红（`example.com` 这类保留域不带协议时不受影响）。 */
/**
 * 从**书籍页地址**里按 `book.url` 取出**书籍 ID**（#424，对齐 so-novel `TocParser` 的 `ReUtil.getGroup1`）。
 *
 * 🔴 为什么需要它：真实书源里有几条把目录放在**另一个页面**上，写法是一对同站地址 ——
 *      `book.url` = 一个含捕获组的**正则**（举例：`…/book/(.*?)/`）
 *      `toc.url`  = 一个 **URL 模板**（举例：`…/read/%s/`），`%s` 吃上面那个 ID
 *    ⇒ 少了这一步，`toc.url` 的 `%s` 就无从填起（#424 之前本仓把 `toc.url` 当选择器解析，那几条全废）。
 * ⚠️ 上面刻意不写完整域名 —— 本模块**不许出现任何站点域名**（断言有反向守卫钉着）。
 * ⚠️ 取**第 1 个捕获组**（与 so-novel 完全一致）；规则没写 / 没捕获组 / 正则非法 / 没匹配上 ⇒ 回空串。
 * ⚠️ so-novel 允许 `book.url` 带 `@js:` 后缀（用脚本算 ID）—— 本仓**不执行脚本**（红线 D-24(a)），
 *    统一**截掉** `@js:` 之后的部分再当正则用（能取到就取，取不到由调用方给出明确原因）。
 */
export function bookIdFromUrl(src: NovelSource | undefined, bookUrl: string): string {
    const raw = String(src?.book?.url ?? '').trim();
    const url = String(bookUrl ?? '').trim();
    if (!raw || !url) return '';
    const pat = raw.split('@js:')[0].trim();
    if (!pat) return '';
    try {
        const m = new RegExp(pat).exec(url);
        return m && m[1] != null ? String(m[1]).trim() : '';
    } catch {
        return '';
    }
}

export function sourceHost(url: string): string {
    const s = String(url ?? '').trim();
    if (!s) return '';
    try {
        return new URL(s).hostname.replace(/^www\./i, '');
    } catch {
        return s.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').replace(/\/+$/, '');
    }
}

/** 书源摘要（设置页列表与弹窗下拉都读这一份；⛔ 不外泄整份规则） */
export interface NovelSourceSummary {
    name: string;
    host: string;
    disabled: boolean;
    /** 🔴 #422：这条源属于哪一类 —— 弹窗下拉要按「本类优先」排序 / 分组，设置页两个小节也靠它 */
    kind: SourceKind;
    flags: SourceFlags;
    /** 徽标小字（体检警告拼起来；没错就是空串） */
    warning: string;
}

export function sourceSummary(src: NovelSource): NovelSourceSummary {
    const d = diagnoseSource(src);
    return {
        name: String(src?.name ?? '').trim() || sourceHost(src?.url) || '未命名书源',
        host: sourceHost(src?.url),
        disabled: src?.disabled === true,
        kind: sourceKindOf(src),
        flags: d.flags,
        warning: d.warnings.join('；'),
    };
}
