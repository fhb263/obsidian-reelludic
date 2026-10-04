// 视图级题材筛选（pure/genreFilter）
//
// 需求（用户 2026-09-22）：
//  - 「题材」取自条目笔记的元数据字段 —— 本项目 frontmatter 键就是 `genres`（`noteGenerator.entryFrontmatter`），
//    卡片题材行 `.rl-tags` 也读它 ⇒ **题材池与卡片显示同源**，不另开笔记解析链路、不并入 `tags`
//    （tags 里混着类型键与用户自定义标签，并进来题材池就不纯了）。不做手动维护的题材表。
//  - 池按**出现频次**降序（并列按名称拼音序），过滤空值，另给「未分类」桶（D-5：全选含它）。
//  - 筛选是**视图级**的：每个子视图一套独立池（阅读的「文学」「网文」是两个池，影视的
//    「动画/电视剧/电影」是三个池）；阅读-全部 / 影视-全部 与所有上层聚合视图**不提供**题材筛选。
//    🔴 #444 追加：**系列视图也是一套独立池**（池 = 该系列组内的条目，见 `seriesGenreScope`）——
//    「每个系列视图拥有独立题材池，互不影响」。
//  - 多选，值之间是 OR；胶囊文案按**题材池顺序**取第一个已选（D-6），其余折成 `+N`。
import type { BookKind, EntryType } from 'data/types';
import { normalizeBookKind } from 'pure/bookKind';

/**
 * 「未分类」桶的保留键：含 NUL 控制字符 ⇒ 真实题材值不可能等于它（用户输入里不会有）；
 * 显示名走 `GENRE_NONE_LABEL`。已选集合里出现它 = 也接受「没有任何题材」的条目。
 */
export const GENRE_NONE_KEY = '\u0000__none__';
export const GENRE_NONE_LABEL = '未分类';

export interface GenreOption {
    /** 已选集合里存的值（真实题材就是题材名本身；未分类是保留键） */
    key: string;
    label: string;
    /** 在本视图池里的条目数 */
    count: number;
}

export interface GenreScope {
    /** 作用域复位键（同一子视图同一 key，子视图一变已选即清空，D-7） */
    key: string;
    type: EntryType;
    /** 书籍子分类（文学 / 网文）；非书籍视图为 undefined */
    bookKind?: BookKind;
}

/** 条目题材值集合：类型容错 → trim → 去空 → 去重保序 */
export function genreValuesOf(e: { genres?: string[] } | null | undefined): string[] {
    const raw = e?.genres;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const g of raw) {
        if (typeof g !== 'string') continue;
        const v = g.trim();
        // 字面「未分类」不作为题材值：否则面板里会出现两行同名（合成桶 + 同名字面值），用户无法分辨
        if (!v || v === GENRE_NONE_LABEL) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

/**
 * 构建题材池：频次降序 → 名称拼音序（并列时，保证结果不随输入顺序漂移）；
 * 无题材条目单独算「未分类」，**恒置末位**（没有这类条目时该行不出现）。
 */
export function buildGenreOptions(entries: ReadonlyArray<{ genres?: string[] }>): GenreOption[] {
    const counts = new Map<string, number>();
    let none = 0;
    for (const e of entries) {
        const vals = genreValuesOf(e);
        if (vals.length === 0) {
            none++;
            continue;
        }
        for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const opts: GenreOption[] = [...counts.entries()]
        .map(([label, count]) => ({ key: label, label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
    if (none > 0) opts.push({ key: GENRE_NONE_KEY, label: GENRE_NONE_LABEL, count: none });
    return opts;
}

/** 命中判定：空选 = 这一维不存在（恒真）；多选 = OR；选了未分类则「无题材」条目也算命中 */
export function matchesGenres(e: { genres?: string[] }, selected: readonly string[]): boolean {
    if (!selected || selected.length === 0) return true;
    const vals = genreValuesOf(e);
    const wantsNone = selected.includes(GENRE_NONE_KEY);
    if (vals.length === 0) return wantsNone;
    return vals.some((v) => selected.includes(v));
}

/**
 * 视图级题材作用域判定：**返回 null = 该视图不提供题材筛选**。
 *
 * 口径（用户 2026-09-22 指定，逐条可回归）：
 *  - 阅读页签（lockType='book'）：子分类「全部」→ null；文学 / 网文 → 各自一套
 *  - 影视聚合页签（lockType=null）：类型「全部」→ null；动画 / 电视剧 / 电影 → 各自一套
 *  - 游戏 / 音乐 / 单类型页签：没有更细的子分类 → 恒提供
 */
export function resolveGenreScope(
    lockType: EntryType | null | undefined,
    typeFilter: 'all' | EntryType,
    kindFilter: 'all' | BookKind,
): GenreScope | null {
    if (lockType) {
        if (lockType === 'book') {
            if (kindFilter === 'all') return null;
            // 🔴 2026-09-30 翻面：comic 加回后 **会**分裂出第三个池（文学 / 网文 / 漫画各一套题材池）——
            //    这正是「每个子分类独立题材池」要的；⛔ 别按旧注释把 comic 再归一成文学。
            //    ⚠️ 仍有脏值兜底：非法值由 normalizeBookKind 归文学（不会造出第四个池）。
            const kind = normalizeBookKind(kindFilter);
            return { key: `book:${kind}`, type: 'book', bookKind: kind };
        }
        return { key: `type:${lockType}`, type: lockType };
    }
    if (typeFilter === 'all') return null;
    return { key: `type:${typeFilter}`, type: typeFilter };
}

/** 池成员判定：与 resolveGenreScope 成对使用（池 = entries.filter(matchesGenreScope)） */
export function matchesGenreScope(
    e: { type: EntryType; bookKind?: BookKind },
    scope: GenreScope,
): boolean {
    if (e.type !== scope.type) return false;
    if (scope.bookKind === undefined) return true;
    return normalizeBookKind(e.bookKind) === scope.bookKind;
}

/**
 * **系列视图**的题材作用域（#444 用户点名：「每个系列视图拥有独立题材池，互不影响」）。
 *
 * 池 = 该系列组内的条目；key 带**组键** ⇒ 从 A 系列切到 B 系列时作用域 key 变了、
 * 已选题材自动清空（`MediaList` 的那条复位 `$:` 管这件事）—— 各系列视图互不影响。
 * ⚠️ 与 `resolveGenreScope` 的关键差别：**恒非 null**。系列视图本身就是一个具体子集，
 *    哪怕它从「影视-全部」这种「不提供题材筛选」的视图点进来（折叠卡在任何类型下都可能出现），
 *    进去之后也该能按这一系列的题材再筛一层。
 */
export function seriesGenreScope(groupKey: string, type: EntryType): GenreScope {
    return { key: `series:${groupKey}`, type };
}

/**
 * 题材作用域的**复位键**（#444 抽出）。
 *
 * 🔴 为什么要单独抽：系列视图下 `genreScope` 依赖 `activeGroup`，而 `activeGroup` 是
 *    `foldSeries(filtered)` 查出来的 ⇒ 若复位逻辑直接读 `genreScope.key`，就构成
 *    `genreScope → genreScopeKey → genreSel → filtered → activeGroup → genreScope` 的**响应式环**
 *    （Svelte 4 对环只能退化成语义未定义的求值顺序）。
 *    这里只吃「视图标识」这几个**不经过 `filtered`** 的量，口径与 `genreScope.key` 逐字一致。
 */
export function genreScopeKeyOf(
    lockType: EntryType | null | undefined,
    typeFilter: 'all' | EntryType,
    kindFilter: 'all' | BookKind,
    seriesKey?: string | null,
): string {
    if (seriesKey) return `series:${seriesKey}`;
    return resolveGenreScope(lockType, typeFilter, kindFilter)?.key ?? '';
}

/**
 * 胶囊文案：未选 → 「全部」；1 项 → 该题材名；≥2 项 → 「池序第一个 + N-1」。
 * 池序（频次降序）而非勾选先后 —— 同一组已选无论怎么点，显示都一致（D-6）。
 * 已选项若已不在池内（数据变动）也不崩：取不到池内项时退回该键本身。
 */
export function genrePillLabel(options: readonly GenreOption[], selected: readonly string[]): string {
    const total = selected?.length ?? 0;
    if (total === 0) return '全部';
    const inPool = options.filter((o) => selected.includes(o.key));
    const first = inPool[0]?.label ?? selected[0];
    return total === 1 ? first : `${first}+${total - 1}`;
}
