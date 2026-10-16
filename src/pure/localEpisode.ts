/**
 * 「单集本地检索」的**匹配逻辑**（#563）—— 纯逻辑无 obsidian / 无 DOM，可单测。
 *
 * 场景：编辑某一条目某一集的浮层里，「本地路径」标签右侧那枚小图标按钮。
 * 用户原话：「点一下要自动去设置页前置填写的媒体库目录路径里（含多层嵌套）递归搜索当前集的视频文件，
 * 并直接自动填入绝对路径」。
 *
 * ## 两条口径
 *  ⑴ **集号是主判据，集标题是排序加权**。
 *     资源命名五花八门（`第03集` / `S01E03` / `EP3` / `03` / 纯 `3`），但**集号一定在**；
 *     集标题则经常被省略（甚至带一堆压制组后缀）。⇒ 只认「集标题必须命中」会把绝大多数文件判掉。
 *     ⛔ 反过来也不行：只看集号会在「同一目录里既有正片又有花絮、都带 03」时选错人 ⇒ 标题当**排序第一关键字**。
 *  ⑵ **电影是单集**（`isMovie`）⇒ 没有集号可找，只按标题匹配（标签侧的「标题」就是影片名本身）。
 *
 * ⚠️ 归一化复用 `pure/libraryMatch.normalizeMatchText`（与音频 / 书籍检索**同一把尺**，
 *    ⛔ 别在这里另写一份「去空格转小写」）。
 */

import { normalizeMatchText } from 'pure/libraryMatch';
import type { BookKind, EntryType } from 'data/types';

/**
 * 「单集本地检索」的请求参数 —— 组件（EntryForm）/ 弹窗（EntryModal）/ 宿主（main）**三层共用一份形状**。
 * ⛔ 别在任一层另写一遍内联字面量类型：那样加一个字段就要三处一起改，漏一处是编译期错误还好、
 *    改错字段名则是「静默不生效」。
 */
export interface LocalEpisodeQuery {
    type: EntryType;
    bookKind?: BookKind | string;
    /** 0-based 集序号（电影恒 0） */
    epIndex: number;
    /** 用户填的集标题（可能为空） */
    epTitle: string;
    /** 条目标题（集标题为空时兜底当检索词） */
    title: string;
    isMovie: boolean;
}

/** 宿主`searchLocalEpisode` 的结果：`ok` 命中 / `nodir` 没配目录 / `notfound` 没找到这一集 */
export type LocalEpisodeOutcome = { ok: true; path: string } | { ok: false; reason: 'nodir' | 'notfound' };

/** 一个候选文件（宿主扫出来的：库内 → 库内相对路径；库外 → 系统绝对路径） */
export interface LocalEpisodeFile {
    path: string;
    name: string;
}

/** 去掉扩展名（`S01E03.mkv` → `S01E03`）；无扩展名 / 隐藏文件原样返回 */
function stem(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
}

/**
 * 集号（1-based）的三种写法形态。命中任一即算「这个文件是这一集」。
 *  🔴 三条都带**边界**（⛔ 别用裸子串）：`3` 会撞 `1080p` / `2023` / `第13集`，
 *     那种误命中在多集目录里就是「填错了另一集」，且**看起来完全正常**（最难查）。
 *  ⚠️ 顺序无关（`some` 判定），但保留注释以便日后按需收放。
 */
export function episodePatterns(epNo: number): RegExp[] {
    const n = String(Math.max(1, Math.trunc(Number(epNo) || 1)));
    return [
        // 第03集 / 第3话 / 第3話 / 第3期
        new RegExp(`第0*${n}(?:集|话|話|期)`),
        // E03 / EP3 / E3 / Episode 3（`S01E03` 也命中）
        //  🔴 本条**刻意不要求前边界**：`S01E03` 里 `E` 前面就是数字，加了边界反而整类命名都漏掉。
        //     `E`/`EP`/`EPISODE` + 数字本身已足够特征化（实测 `1080p` / `x264` / `HEVC` 都不会误命中）。
        new RegExp(`e(?:p(?:isode)?)?[\\s._-]*0*${n}(?![0-9])`, 'i'),
        // 03 / 3（前后都不是字母数字）
        new RegExp(`(?:^|[^0-9a-z])0*${n}(?![0-9a-z])`, 'i'),
    ];
}

/** 文件名是否命中该集（只判集号；集标题只影响排序，见 `pickLocalEpisode`） */
export function fileMatchesEpisode(name: string, epNo: number): boolean {
    const s = stem(name);
    return episodePatterns(epNo).some((re) => re.test(s));
}

/**
 * 从候选里挑出**最像当前集**的那一个；没有 → `null`。
 * 排序（依次）：集标题命中 → 文件名更短 → 路径字典序（**稳定**，⛔ 别用不稳定的比较让它随机挑）。
 */
export function pickLocalEpisode(
    files: readonly LocalEpisodeFile[],
    epNo: number,
    epTitle: string,
    isMovie: boolean,
): LocalEpisodeFile | null {
    const t = normalizeMatchText(epTitle);
    const scored: { f: LocalEpisodeFile; title: number }[] = [];
    for (const f of files) {
        const s = stem(f.name);
        const ns = normalizeMatchText(s);
        if (isMovie) {
            // 电影：没填标题就没判据 ⇒ 不猜（⛔ 别「只有一条就返回它」—— 那会把花絮/预告填成正片）
            if (!t || !ns.includes(t)) continue;
            scored.push({ f, title: 1 });
            continue;
        }
        if (!fileMatchesEpisode(f.name, epNo)) continue;
        scored.push({ f, title: t && ns.includes(t) ? 1 : 0 });
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => {
        if (b.title !== a.title) return b.title - a.title;
        if (a.f.name.length !== b.f.name.length) return a.f.name.length - b.f.name.length;
        return a.f.path < b.f.path ? -1 : a.f.path > b.f.path ? 1 : 0;
    });
    return scored[0].f;
}

/**
 * 未配置根目录时给用户的警告（用户给定原文）。
 * 🔴 文案只此一处：组件弹它，⛔ 别在组件里手抄第二份。
 */
export const LOCAL_DIR_MISSING_WARN = '请先前往设置页配置媒体文件根目录';
