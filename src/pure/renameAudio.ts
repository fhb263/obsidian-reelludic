/**
 * 「给关联的音频文件改名」的**纯逻辑**（#497）—— 无 `obsidian` / 无 DOM / 无 IO，可单测。
 *
 * 用户原话：「再添加在音乐条目上修改关联的音频文件名称的功能」。
 * 入口 = 音乐条目表单 → 右键「播放」→「本地音频」浮层 → 「文件路径」行**下面**新增的「文件名」行。
 *
 * ## 三条口径（本模块负责前两条，第三条归宿主）
 *
 * ⑴ 🔴 **只改主名，扩展名锁死** —— 输入框里给的是**主名**，扩展名以静态后缀显示。
 *    改名成 `xxx.txt` 会让 Chromium 与系统都不再把它当音频（而这个文件是**用户的**，改坏了找不回来）。
 *    ⚠️ 但用户很可能会把**完整文件名**粘进来（他手边只有完整名）⇒ 尾部与当前扩展名**完全相同**时
 *    **自动剥掉**（见 `stripOwnExt`）。这一条是零误伤的：一个名字本来就以自己的扩展名结尾，
 *    几乎不可能真是想拼成 `晴天.mp3.mp3`。
 *
 * ⑵ 🔴 **目录与分隔符风格原样保留** —— 只换最后一段（与 `pure/lrcSource.siblingLrcPath` 同一套走法）。
 *    库内相对路径用 `/`、库外绝对路径常是 `\`，⛔ 别统一归一成一种 —— 那会让写回目录的值与用户看到的不一致。
 *
 * ⑶ 物理改名本身（vault 内 / 库外 + 同名 `.lrc` + 写回条目与笔记）**在宿主 `main`** ——
 *    那部分碰 vault / fs，纯模块碰不了，也正因此本模块不写任何「已改名」的结论。
 *
 * ⚠️ **不校验扩展名白名单**：那是「关联」时的门槛（`isAssociableAudioPath`），
 *    「改名」不动扩展名，所以与白名单无关；在这里再查一遍只会多一条走不到的分支。
 */
import { DOWNLOAD_NAME_MAX_CHARS } from 'pure/downloadPlan';
import { siblingLrcPath } from 'pure/lrcSource';

/** 路径拆分结果（`sep` = 原路径用的分隔符，写回时照抄） */
export interface AudioPathParts {
    /** 目录部分**含末尾分隔符**（无目录 ⇒ `''`） */
    dir: string;
    /** 文件名（含扩展名） */
    name: string;
    /** 原路径使用的分隔符（`/` 或 `\`；无目录时为 `/`） */
    sep: string;
}

/**
 * 拆出「目录 + 文件名」。
 * 🔴 两种分隔符都认（`\` 与 `/`），取**最后出现**的那个 —— 混用形态（`D:/a\b.mp3`）在真实路径里不罕见，
 *    只认一种会让 `b.mp3` 被当成整段文件名。
 */
export function splitAudioPath(path: string): AudioPathParts {
    const p = String(path ?? '');
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    if (cut < 0) return { dir: '', name: p, sep: '/' };
    return { dir: p.slice(0, cut + 1), name: p.slice(cut + 1), sep: p[cut] };
}

/**
 * 拆「主名 / 扩展名」——扩展名**含点**且**原样保留大小写**（`.MP3` 不该被写成 `.mp3`）。
 * 无点 / 以点开头（`.mp3` 这种隐藏名）/ 以点结尾 ⇒ 整体当主名、扩展名空串
 * （与 `pure/downloadPlan.downloadExt` 的 `idx <= 0` 口径一致）。
 */
export function splitAudioName(name: string): { stem: string; ext: string } {
    const n = String(name ?? '');
    const i = n.lastIndexOf('.');
    if (i <= 0 || i === n.length - 1) return { stem: n, ext: '' };
    return { stem: n.slice(0, i), ext: n.slice(i) };
}

/** 非法字符（Windows 保留字）与控制字符 —— 单独列一份是**故意的**：`sanitizeDownloadName` 是
 *  「静默替换」，这里是「拒绝并说明」，语义不同 ⇒ 共用一个正则只会让两边都不敢改。 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_NAME = /[\\/:*?"<>|]|[\x00-\x1f\x7f]/;

/**
 * 用户把**完整文件名**粘进「主名」框时，把尾部那个**与本文件自己的扩展名完全相同**的部分剥掉。
 * 大小写无关（`.MP3` ≡ `.mp3`）；扩展名为空、或尾部不是它 ⇒ 原样返回。
 */
function stripOwnExt(stem: string, ext: string): string {
    if (!ext) return stem;
    const s = String(stem ?? '');
    return s.length > ext.length && s.toLowerCase().endsWith(ext.toLowerCase()) ? s.slice(0, -ext.length) : s;
}

/** 现名 / 新名（含扩展名） + 路径（目录与分隔符风格原样保留） */
export interface AudioRenamePlan {
    from: string;
    to: string;
    fromName: string;
    toName: string;
    /** 同名 `.lrc` 的现路径 / 目标路径（口径来自 `pure/lrcSource.siblingLrcPath`，⛔ 不另拼 `.lrc`） */
    lrcFrom: string | null;
    lrcTo: string | null;
}

/**
 * 校验并算出改名的全部涉及路径（**不碰磁盘**）。
 * @returns `issue` 非空 ⇒ 不可改名（面向用户的原因）；否则 `plan` 可用。
 */
export function planAudioRename(
    currentPath: string,
    newStem: string,
): { plan: AudioRenamePlan } | { issue: string } {
    const cur = String(currentPath ?? '').trim();
    if (!cur) return { issue: '还没有关联音频文件，先关联再改名' };
    const parts = splitAudioPath(cur);
    if (!parts.name) return { issue: '当前路径里没有文件名，改不了名' };
    const { stem, ext } = splitAudioName(parts.name);

    const raw = stripOwnExt(String(newStem ?? ''), ext).trim();
    if (!raw) return { issue: '文件名不能为空' };
    if (ILLEGAL_NAME.test(raw)) return { issue: '文件名不能包含 \\ / : * ? " < > | 这些字符' };
    // ⚠️ 首尾**空格**是 `trim()` 掉的（看不见、用户预期就是去掉），首尾**点**才拒绝 ——
    //    Windows 会把末尾的点静默吃掉 ⇒ 不拦就是「界面说 A、盘上是 B」。
    if (raw.startsWith('.')) return { issue: '文件名不能以点开头（系统会静默吃掉）' };
    if (raw.endsWith('.')) return { issue: '文件名不能以点结尾（系统会静默吃掉）' };
    if (raw.length > DOWNLOAD_NAME_MAX_CHARS) return { issue: `文件名过长（最多 ${DOWNLOAD_NAME_MAX_CHARS} 个字符）` };
    if (raw === stem) return { issue: '文件名没有变化' };

    const toName = `${raw}${ext}`;
    const to = `${parts.dir}${toName}`;
    return {
        plan: {
            from: cur,
            to,
            fromName: parts.name,
            toName,
            lrcFrom: siblingLrcPath(cur),
            lrcTo: siblingLrcPath(to),
        },
    };
}

/**
 * 取路径的**主名**（组件拿它渲染「文件名」输入框的初始值）。
 * 🔴 放在这里而不是组件里 —— 组件自己 `split('/')` + `split('.')` 就是第二份口径，
 *    届时「输入框显示 A、校验按 B」两边都不报错。
 */
export function audioStemOf(path: string): string {
    return splitAudioName(splitAudioPath(path).name).stem;
}

/** 取路径的**扩展名**（带点、原样大小写；组件拿它渲染静态后缀；无 ⇒ `''`） */
export function audioExtOf(path: string): string {
    return splitAudioName(splitAudioPath(path).name).ext;
}

