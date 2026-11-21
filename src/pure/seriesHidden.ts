/**
 * 「隐藏此系列卡片」的判定真源（m03458）。
 *
 * 🔴 用户原话（2026-11-21，逐字）：「再在右上角加个『[复选框]隐藏此系列卡片』就只隐藏该系列封面和
 *    此信息栏，里面的系列条目不受影响」
 * 🔴 用户追问后的追加澄清（2026-11-21）：「不，这个隐藏的意思是模糊化，就像单卡那样」
 *    ⇒ 呈现口径**照抄单卡**：封面 `blur(6px) saturate(.55)` + `opacity: .6`（见 `MediaList.svelte`
 *      的 `.rl-card.is-card-hidden .rl-cov-wrap`），信息栏文字换成 `***`（`pure/cardHidden.maskCardText`）。
 *      ⛔ 不要把卡片整张藏掉（`display:none`）—— 用户说的是**模糊**，不是消失。
 *
 * 🔴 为什么必须是**独立字段**，不能复用 `pure/cardHidden.seriesCardHidden`：
 *    那个函数的判据是「组内**每一条**都勾了 `cardHidden`」——它是**由条目推出来的**，
 *    想让它为真就得把组内所有条目一起勾上，而用户明确要求「里面的系列条目不受影响」。
 *    两者语义相反 ⇒ 存储也必须分开：条目级 `MediaEntry.cardHidden`（单条），
 *    系列级 `Catalog.seriesHidden`（按分组键）。⛔ 别把两个概念挤进一个字段。
 *
 * 🔴 存储位置 = `Catalog.seriesHidden`，键 = **系列分组键**（`pure/seriesGroup.seriesKeyOf` 产出的
 *    `type\u0001归一化系列名`）—— 与 `Catalog.seriesRatings` 完全同构。⛔ 别用「组内首条 id」当键：
 *    首条一删标记就丢，而分组键由「类型 + 系列名」决定，与哪一条当门面无关。
 *
 * ⚠️ 语义边界（⛔ 别扩写）：只影响**卡片外观**，**不**参与筛选 / 排序 / 统计 / 进度 / 回收站，
 *    也不影响组成员自己的卡片。想让一组「从库里消失」请用 `MediaStatus` 的 `archived`。
 *
 * 本模块是纯函数（零 obsidian / 零 DOM），既给列表渲染用，也便于单测穷举。
 */
import type { MediaEntry } from 'data/types';
import { seriesKeyOf } from 'pure/seriesGroup';

/**
 * 系列隐藏表：分组键 → `true`。
 *
 * ⚠️ 值只存 `true`（⛔ 不存 `false`）：`Catalog` 是逐字节写盘的 JSON，
 * 给每个「勾过又取消」的系列留一个 `"…": false` 是纯噪音 —— 与本仓 `seriesRatings`
 * 「0 不落库」同一条口径。取消隐藏 = **删键**。
 */
export type SeriesHiddenMap = Record<string, true>;

/** 某一组是否被标记为「隐藏系列卡片」。非对象 / 缺键 / 值不是 `true` 一律 false。 */
export function seriesGroupHidden(map: SeriesHiddenMap | null | undefined, key: string): boolean {
    if (!map || typeof map !== 'object' || !key) return false;
    // 🔴 必须 `=== true` + `hasOwnProperty`：`map` 来自外部可改的 JSON，
    //    原型链上的 `constructor` / `toString` 会让 `map[key]` 返回函数（真值）⇒ 误判成「隐藏了」。
    return Object.prototype.hasOwnProperty.call(map, key) && map[key] === true;
}

/**
 * 写某组的隐藏标记，返回**新表**（不改入参 —— 与 `writeSeriesRating` 同一条「纯函数不就地改」的纪律）。
 *
 * 🔴 `hidden === false` ⇒ **删键**而不是存 `false`（理由见 `SeriesHiddenMap` 注释）。
 * 🔴 `hidden === true` 但键已存在 ⇒ 原样返回**同一个引用**：调用方据此判「没变化就别落盘」，
 *    避免拖一下复选框就全量重写 catalog（那是几百 KB 的写）。
 */
export function writeSeriesHidden(
    map: SeriesHiddenMap | null | undefined,
    key: string,
    hidden: unknown,
): SeriesHiddenMap {
    const base: SeriesHiddenMap = map && typeof map === 'object' ? map : {};
    if (!key) return { ...base };
    if (hidden !== true) {
        if (!Object.prototype.hasOwnProperty.call(base, key)) return base; // 本来就没有 ⇒ 不必产出新表
        const next: SeriesHiddenMap = { ...base };
        delete next[key];
        return next;
    }
    if (base[key] === true) return base;
    return { ...base, [key]: true };
}

/**
 * 脏数据归一（`parseCatalog` 用）：只留「键非空 + 值恒为 `true`」的项。
 * ⚠️ 与 `writeSeriesHidden` 同一口径（⛔ 不存 false）⇒ 老文件里若真有 `: false` 也在这里清掉。
 */
export function normalizeSeriesHidden(raw: unknown): SeriesHiddenMap {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: SeriesHiddenMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k !== 'string' || !k) continue;
        if (v === true) out[k] = true;
    }
    return out;
}

/**
 * 由条目反查它所属的组键（设置页「已隐藏的系列」清单里，把键翻回可读名用）。
 * 组键的**判据**仍走 `pure/seriesGroup.seriesKeyOf`（唯一真源），⛔ 别在这里再拼一次字符串。
 * 无系列名 / 脏输入 ⇒ `null`。
 */
export function seriesKeyOfEntry(entry: MediaEntry | null | undefined): string | null {
    return seriesKeyOf(entry ?? null);
}
