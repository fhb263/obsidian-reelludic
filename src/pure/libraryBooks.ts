/**
 * 「在库内找回同名书籍文件」的**纯逻辑**（2026-09-28 #417）—— 无 obsidian / 无 DOM，可单测。
 *
 * 场景：书籍表单 → 「书籍文件」浮层标题旁那枚 🔍（与「本地音频」那枚同款同位）。
 *
 * 🔴 三条口径：
 *  ⑴ **打分复用** `pure/dl/utils.songSimilarityScore`（与下载排序用的是**同一把尺**）——
 *     ⛔ 别在这里另写一份相似度算法：两把尺必然分叉，届时「这本书明明在库里却匹配不上」最难查；
 *  ⑵ **文件名按「书名 - 作者」切**（下载落盘就是这个形态，见 `pure/bookDownload.bookStem`）——
 *     ⚠️ 与音频**顺序相反**：音频是「艺人 - 歌名」，书籍是「书名 - 作者」，
 *     ⛔ 别照抄 `splitSongStem`，那样会把作者当书名去比；
 *  ⑶ 切不出作者时**不**拿条目的作者去补 —— 那会把「同作者的另一本书」也判成命中。
 *
 * ⚠️ 本模块**只做匹配与排序**；「库内有哪些书籍文件」由宿主提供（`main.listLibraryBookFiles()`）。
 */
import { songSimilarityScore } from 'pure/dl/utils';
import { segmentsExactTitle } from 'pure/libraryMatch';
import { downloadExt, downloadExtAllowed } from 'pure/downloadPlan';

/** 一个候选书籍文件（宿主扫出来的） */
export interface LibraryBookFile {
    /** 库内相对路径 */
    path: string;
    /** 文件名（含扩展名） */
    name: string;
}

/** 带分数的候选 */
export interface LibraryBookMatch extends LibraryBookFile {
    score: number;
    /** 文件名里那段**与条目标题完全同名**（归一后相等）—— 排序第一关键字（见 `pickLibraryBook`） */
    exact: boolean;
}

/**
 * 命中的**最低分**（低于它视为「不像同一本」）。与音频侧同值同理由：
 * 完全同名 ≈ 75 分；只重合个把字 ≈ 20 出头；完全无关 ≈ 负数。
 * 取值低于 75 是为了容纳「标题带副题 / 版本后缀」这类差异。
 */
export const LIBRARY_BOOK_MIN_SCORE = 30;

/** 这个路径是不是「可关联的书籍文件」（白名单真源 = `pure/downloadPlan.DOWNLOAD_EXT_WHITELIST.book`） */
export function isAssociableBookPath(path: string): boolean {
    return downloadExtAllowed('book', downloadExt(path));
}

/** 去掉扩展名（只认最后一个点；以点开头的隐藏名 / 无点 / 无扩展名 ⇒ 原名） */
export function bookFileStem(name: string): string {
    const s = String(name ?? '');
    const ext = downloadExt(s);
    return ext ? s.slice(0, s.length - ext.length - 1) : s;
}

/**
 * 把文件名拆成 `{ title, author }`：按**最后**一个 ` - ` 切（书名里自己带 `-` 时不误切）。
 * 切不出（无分隔符 / 任一侧为空）⇒ `author: ''` + 整段当书名。
 */
export function splitBookStem(name: string): { title: string; author: string } {
    const s = bookFileStem(name).trim();
    const at = s.lastIndexOf(' - ');
    if (at > 0) {
        const title = s.slice(0, at).trim();
        const author = s.slice(at + 3).trim();
        if (title && author) return { title, author };
    }
    return { title: s, author: '' };
}

/**
 * 给一个候选打分（越大越像）。**只按「书名 - 作者」那一档**比 ——
 * 拆分出来的书名是原整段的**前缀**，而打分的加分项对更短的字段更易成立 ⇒ 不需要再拿整段比一次。
 */
export function scoreLibraryBook(file: LibraryBookFile, title: string, author: string): number {
    const t = String(title ?? '').trim();
    if (!t) return -1;
    const a = String(author ?? '').trim();
    const kw = a ? `${t} ${a}` : t;
    const parts = splitBookStem(file.name);
    return songSimilarityScore(kw, parts.title, parts.author);
}

/**
 * #463：文件名里是否存在**与条目标题完全同名**的那一段（书名段或作者段 —— 库内命名方向不统一，两向都认）。
 * 判据真源 = `pure/libraryMatch.segmentsExactTitle`（与音频侧**同一份**，⛔ 别各写一套）。
 */
export function isExactTitleBookFile(fileName: string, title: string): boolean {
    const { title: name, author } = splitBookStem(fileName);
    return segmentsExactTitle(name, author, title);
}

/**
 * 从候选里挑最佳匹配。返回**排序后的命中列表**与其中的 `best`（没有命中时为 `null`）。
 *
 * 🔴 **#463：排序第一关键字 = 「文件名里有与条目标题完全同名的那段」**（`exact`），分数只是第二关键字。
 *    与音频侧同一个坑、同一套口径：只按分数排时，同分候选全靠路径字典序**碰运气**
 *    （实测现场：正确文件与无关文件同为 74.7 分，被选中的是字典序靠前的那个错的）。
 *    余下同分才退回路径字典序（结果稳定才可断言）。
 */
export function pickLibraryBook(
    files: readonly LibraryBookFile[],
    title: string,
    author: string,
): { best: LibraryBookMatch | null; ranked: LibraryBookMatch[] } {
    const ranked = (files ?? [])
        .map((f) => ({
            path: f.path,
            name: f.name,
            score: scoreLibraryBook(f, title, author),
            exact: isExactTitleBookFile(f.name, title),
        }))
        .filter((m) => m.score >= LIBRARY_BOOK_MIN_SCORE)
        .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.path.localeCompare(b.path));
    return { best: ranked[0] ?? null, ranked };
}
