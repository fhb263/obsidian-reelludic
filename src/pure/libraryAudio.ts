/**
 * 「在库内音乐目录里找回同名音频」的**纯逻辑**（2026-09-28 #404）—— 无 obsidian / 无 DOM，可单测。
 *
 * 场景：音乐条目表单 → 播放按钮**右键** → 「本地音频」浮层 → 那枚与「总结摘要」同款的小按钮。
 * 用户原话：「在其弹窗本地音频旁加个总结摘要同款小按钮（作用为优先检索库内音乐目录下同名音频文件进行关联）」。
 *
 * 🔴 两条口径：
 *  ⑴ **打分复用** `pure/dl/utils.songSimilarityScore`（下载多源排序用的**同一把尺**）——
 *     ⛔ 别在这里另写一份相似度算法：两把尺必然分叉，届时「这首歌能搜到却匹配不上」最难查。
 *  ⑵ **文件名按 ` - ` 切成「艺人 - 歌名」**（下载落盘就是这个形态，见 `pure/dl/utils.buildSongFilename`）；
 *     切不出艺人时**不**拿条目的作者去补 —— 那会把「别的歌.mp3」也判成命中（实测：补作者能让
 *     无关文件凑够 60 分）。切不出就只按歌名比。
 *  ⑶ **#463：文件名里「与条目标题完全同名」的那段是排序的第一关键字**（分数只是第二关键字）——
 *     库内文件命名两套混用（`歌手 - 歌名` 与 `歌名 - 歌手`），只按分数排会让「条目作者恰好出现在
 *     文件名里」的无关歌曲以**同分**并列、再被路径字典序碰运气选中（用户报障现场见 `isExactTitleFile`）。
 *
 * ⚠️ 本模块**只做匹配与排序**，「库内音乐目录在哪、有哪些文件」由宿主提供
 *    （`main.listLibraryAudioFiles()`，目录真源 = `pure/downloadPlan.downloadDir(root, 'music')`）。
 */
import { songSimilarityScore } from 'pure/dl/utils';
import { segmentsExactTitle } from 'pure/libraryMatch';

/** 一个候选音频（宿主扫出来的） */
export interface LibraryAudioFile {
    /** 库内相对路径 */
    path: string;
    /** 文件名（含扩展名） */
    name: string;
}

/** 带分数的候选 */
export interface LibraryAudioMatch extends LibraryAudioFile {
    score: number;
    /** 文件名里那段**与条目标题完全同名**（归一后相等）—— 排序的第一关键字（见 `pickLibraryAudio`） */
    exact: boolean;
}

/**
 * 命中的**最低分**（低于它视为「不像同一首」）。
 * 🔴 30 是量出来的：歌名完全相同（文件名只有歌名、无艺人段）≈ 75 分；只重合个把字 ≈ 20 出头；
 *    完全无关 ≈ 负数。取值低于 75 是为了容纳「标题带 Live / 现场版后缀」这类差异。
 */
export const LIBRARY_AUDIO_MIN_SCORE = 30;

/** 去掉扩展名（只认最后一个点；以点开头的隐藏名 / 无点 ⇒ 原名） */
export function audioStem(name: string): string {
    const s = String(name ?? '');
    const i = s.lastIndexOf('.');
    return i > 0 ? s.slice(0, i) : s;
}

/**
 * 把文件名拆成 `{ artist, title }`：按**最后**一个 ` - ` 切（歌名里自己带 `-` 时不误切）。
 * 切不出（无分隔符 / 任一侧为空）⇒ `artist: ''` + 整段当歌名。
 */
export function splitSongStem(name: string): { artist: string; title: string } {
    const s = audioStem(name).trim();
    const at = s.lastIndexOf(' - ');
    if (at > 0) {
        const artist = s.slice(0, at).trim();
        const title = s.slice(at + 3).trim();
        if (artist && title) return { artist, title };
    }
    return { artist: '', title: s };
}

/**
 * #463：文件名里是否存在**与条目标题完全同名**的那一段。
 *
 * 🔴 由来（用户 2026-10-01）：「为什么检索同名音频文件能搞到两个，还拉取了个错误的给我」。
 *    **实测现场**（活动库《七里香》/周杰伦）：正确的 `七里香.mp3` 与无关的 `兰亭序 - 周杰伦.mp3`
 *    **同为 74.7 分**（后者是「歌名 - 歌手」命名 ⇒ 条目作者落进了「歌名」槽，白拿 +50+25），
 *    并列后按路径字典序排 ⇒ **恰好是错误的那条排前面被填入**。
 *    ⇒ 判据：**文件名里那段歌名（或歌手段 —— 库内两种命名混用）与条目标题归一后相等** = 真·同名。
 *    ⚠️ 归一与「任一段相等」的规则是**共用真源** `pure/libraryMatch`（书籍侧同款，⛔ 别各写一份）。
 */
export function isExactTitleFile(fileName: string, title: string): boolean {
    const { artist, title: name } = splitSongStem(fileName);
    return segmentsExactTitle(name, artist, title);
}

/**
 * 给一个候选打分（越大越像）。**只按「艺人 - 歌名」那一档**比。
 *
 * 🔴 为什么不需要「整段当歌名再比一次」：拆分出来的歌名是整段的**后缀**，而 `songSimilarityScore`
 *    的加分项（`kw.includes(歌名)` / 逐 token 命中）对**更短**的那个反而更容易成立
 *    ⇒ 整段那一档永远不会比它更高（本批实测：把那一档删掉，9 条单测**无一变化**）。
 *    这正是仓里那条纪律的样本：**加了分支但突变抓不到 = 冗余，删掉**。
 *    ⚠️ 唯一例外是「文件名里根本没有 ` - `」——那种情况下两种切法**完全等价**（`splitSongStem` 返回
 *    整段当歌名），所以也不吃亏。
 */
export function scoreLibraryAudio(file: LibraryAudioFile, title: string, author: string): number {
    const t = String(title ?? '').trim();
    if (!t) return -1;
    const a = String(author ?? '').trim();
    const kw = a ? `${t} ${a}` : t;
    const { artist, title: name } = splitSongStem(file.name);
    return songSimilarityScore(kw, name, artist);
}

/**
 * 从候选里挑最佳匹配。返回**排序后的命中列表**（分数降序；同分按路径字典序，保证结果稳定可断言）
 * 与其中的 `best`（没有命中时为 `null`）。
 *
 * 🔴 **#463：排序第一关键字 = 「文件名里有与条目标题完全同名的那段」**（`exact`），**分数只是第二关键字**。
 *    为什么不是靠分数压过去：用户报障现场（《七里香》）里，正确文件与无关文件**分数完全相同**（74.7），
 *    分数排序根本分不出来，最后靠路径字典序「碰运气」选中了错的那条。格式塔上「同名」是硬证据，
 *    「相似度高」是软证据 ⇒ **硬的先于软的**（`⛔ 别把这条降级成给分数加权重` —— 那还是要跟别的加分项比大小）。
 *
 * ⚠️ 每个候选**只出现一次**（取上面对比后的最高分），⛔ 别把两种切法各推进列表一次。
 */
export function pickLibraryAudio(
    files: readonly LibraryAudioFile[],
    title: string,
    author: string,
): { best: LibraryAudioMatch | null; ranked: LibraryAudioMatch[] } {
    const ranked = (files ?? [])
        .map((f) => ({
            path: f.path,
            name: f.name,
            score: scoreLibraryAudio(f, title, author),
            exact: isExactTitleFile(f.name, title),
        }))
        .filter((m) => m.score >= LIBRARY_AUDIO_MIN_SCORE)
        .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || a.path.localeCompare(b.path));
    return { best: ranked[0] ?? null, ranked };
}
