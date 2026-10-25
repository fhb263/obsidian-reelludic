/**
 * 导入时的**同名检测**（2026-10-21，用户需求 4）。
 *
 * 🔴 背景（用户原话）：「豆瓣等账号收藏同步导入时若与库内条目同名，需显示「库内存在同名文件」，
 *    避免静默覆盖」。
 *
 * 为什么必须有这一层（真因，⛔ 别只当成"加个提示"）：
 *   笔记落盘路径是**按标题派生**的 —— `src/data/noteGenerator.ts` 的 `entryNotePath()` =
 *   `${baseDir}/${noteSubDir(e)}/${safeFilename(e.title)}.md`，而 `src/services/vaultIO.ts` 的
 *   `writeText()` 遇到已存在的 `TFile` 直接 `app.vault.modify()`。⇒ **同名标题 = 同一个 .md 文件**，
 *   第二次导入会把第一条的笔记原地覆盖，**零提示**（条目在 catalog 里是两条，笔记只剩一条）。
 *   而各导入器的既有判重只看「来源平台 id」（豆瓣 `subject/<数字>`、Bangumi subject id…）——
 *   同名不同 id 一律走「新建」，于是必然撞上上面这条路径。
 *
 * 所以本模块的唯一职责：给导入器一个**廉价的、纯的**同名判据，让它们能"跳过 + 报数"。
 * ⚠️ 判据是「类型 + 归一标题」，⛔ 不是「标题相同就一定是同一条」——
 *    本仓 `MediaEntry` 允许同名不同作品（同名电影 / 同名小说 / 同名游戏），
 *    但那类条目**必然共用同一个笔记文件名**，所以从"笔记不被覆盖"的角度看，跳过才是对的。
 * ⛔ 别把它升级成"自动改名后落库"：那会让用户的库出现第二条同名条目，
 *    用户看到的是"导入成功"而库里多了一条他不要的 —— 静默失败比报错更难查。
 */

/**
 * 标题归一：用于**判同**，⛔ 不用于展示（展示永远用原文）。
 *
 * 处理（顺序固定，单测逐条钉住）：
 *  1. `NFKC` —— 全角字母/数字/空格折成半角（豆瓣标题里常见的「１００％」与「100%」要判同）；
 *  2. 所有空白（含 0x3000 全角空格、`\t`、`\n`）折成一个半角空格再 `trim`
 *     （豆瓣标题里偶有多余空格 / 末尾不换行符）；
 *  3. 小写化（`One Piece` 与 `one piece` 判同）。
 */
export function normalizeTitleForMatch(title: string): string {
    return title.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 同名判据的键：`类型 + \u0000 + 归一标题`（用 NUL 分隔，标题里不可能出现，⛔ 别换成 `-` 或 `|`） */
export function titleKeyOf(type: string, title: string): string {
    return `${type}\u0000${normalizeTitleForMatch(title)}`;
}

/** 建索引所需的最小形状（`MediaEntry` 天然满足，⛔ 别 import 那整个类型：本模块要能脱离 obsidian 单测） */
export interface TitleKeyEntry {
    id: string;
    type: string;
    title: string;
}

/**
 * 把库内既有条目建成「类型 + 归一标题」→ 条目 的索引。
 * ⚠️ 同名多条时**先到先得**（`Map` 不覆盖已有键）：这里只需要"有没有"，不需要"有哪几条"。
 */
export function indexByTitleKey(entries: readonly TitleKeyEntry[]): Map<string, TitleKeyEntry> {
    const index = new Map<string, TitleKeyEntry>();
    for (const e of entries) {
        const key = titleKeyOf(e.type, e.title);
        if (!index.has(key)) index.set(key, e);
    }
    return index;
}

/**
 * 在「**本次要新建**」这条路径上查同名。返回命中的库内条目，没有则 `null`。
 *
 * @param index  `indexByTitleKey(existing)` 的结果（⛔ 别在循环里重建索引：那是 O(n²)）
 * @param type   本条目的类型（必须与索引里存的同一个枚举值）
 * @param title  本条目的标题（原文，函数内部自己归一）
 */
export function findTitleConflict(
    index: ReadonlyMap<string, TitleKeyEntry>,
    type: string,
    title: string,
): TitleKeyEntry | null {
    return index.get(titleKeyOf(type, title)) ?? null;
}

/** 导入器的上报字段（四个导入弹窗共用同一段文案，见各 `*SyncModal` 的结果行） */
export interface SameNameReport {
    /** 因「库内存在同名文件」而跳过的条数 */
    sameName: number;
    /** 被跳过的标题（原文，给用户看；⛔ 归一后的值不要外泄） */
    sameNames: string[];
}

/** 空报告（⛔ 别用 `undefined` 表示"没有"：调用方 `res.sameName ? …` 会静默当成字段不存在） */
export function emptySameNameReport(): SameNameReport {
    return { sameName: 0, sameNames: [] };
}
