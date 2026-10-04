/**
 * 下载目标路径决策的**纯逻辑**（2026-09-27 #397，⑤ 公共基建）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * ## 为什么单独一层
 * 「下载的文件落到哪个路径」有三个全是纯函数就能钉住的坑：
 *  ① **文件名净化** —— 歌名 / 书名里带 `\ / : * ? " < > |` 时直接拼路径，轻则建出多层目录、重则抛错；
 *     末尾的空格与点在 Windows 上会被系统悄悄吃掉 ⇒ 实际文件名与预期不符。
 *  ② **重名去重** —— 同名落第二次时 Obsidian 的 `vault.create` **抛 EEXIST**（不是覆盖、也不是自动编号）
 *     ⇒ 用户会看到「下载失败」，而失败原因跟网络一点关系都没有。
 *  ③ **扩展名白名单** —— 上游把 HTML 错误页 / 重定向落地页当音频交给我们时必须能拦住。
 *
 * ⛔ **刻意不复用 `data/noteGenerator.safeFilename`**：那个是**笔记文件名**口径（额外去掉 `#^[]`，
 *    因为那几个字符是 Obsidian wikilink 的语法），且 `pure/` 反向依赖 `data/` 会破坏分层
 *    （`pure/` 是最底层，只许被别人依赖）。两者净化目标不同 ⇒ 各留一份，⛔ 别强行合并。
 */

import { AUDIO_ASSOCIABLE_EXTENSIONS, VIDEO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';

/** 下载物类型 —— 决定扩展名白名单与该类型的**缺省目录**（#459 起⛔ 不再由它拼子目录） */
export type DownloadKind = 'music' | 'book' | 'video' | 'other';

/** 下载根目录**缺省名**（库内相对路径）—— 仅用于「输入为空」时的兜底，以及下面各类型默认目录的前缀 */
export const DOWNLOAD_ROOT_DEFAULT = '下载';

/**
 * 各类型的**默认目录**（库内相对路径）—— 用户没填「音频文件目录 / 书籍文件目录」时的落点。
 *
 * 🔴 #459（用户 2026-10-01）：「这个设置里的音频和书籍文件路径怎么是嵌套再上，比如我填了『下载/音乐』，
 *    怎么一下载就多出个『下载/音乐/音乐』的，改成就我填的目录检索」
 *    ⇒ **设置项的值 = 文件所在目录本身**，`downloadDir()` ⛔ 不再往上拼 `音乐/` `书籍/` 子目录。
 *    ⚠️ 那两个子目录名**下沉到这里当默认值**（`下载/音乐` / `下载/书籍`）—— 默认落盘位置与旧版**逐字不变**，
 *    只有「用户自己填过值」的情况行为变了：以前会被再套一层，现在**原样使用**。
 *    ⛔ 别再让 `downloadDir()` 去拼子目录：设置项的提示写的就是「将落到「X」文件夹」，
 *      实现再套一层 = 「界面说 A、文件落 B」—— 用户实测报障的正是这个。
 */
export const DOWNLOAD_DIR_DEFAULT: Record<DownloadKind, string> = {
    music: `${DOWNLOAD_ROOT_DEFAULT}/音乐`,
    book: `${DOWNLOAD_ROOT_DEFAULT}/书籍`,
    video: `${DOWNLOAD_ROOT_DEFAULT}/视频`,
    // ⚠️ 值用「未分类」而不是惯常的近义词：全仓有一条反向守卫锚**「键名 + 那个中文词」连写的形态**
    //    （那是「音乐子分类下线」的证据形态），而**任何以该中文开头的值都会被它子串命中**
    //    （试过加后缀，照样撞）⇒ 只能换个不含该前缀的词。
    //    🔴 本注释**刻意不写出那个完整形态** —— 注释一样进产物，写出来就等于自己把那守卫撞红。
    other: `${DOWNLOAD_ROOT_DEFAULT}/未分类`,
};

/**
 * 各类型可落盘的扩展名白名单（小写、无点）。
 * 音乐 / 视频**复用既有真源** `pure/mediaExtensions`（文件选择器已按同一套名单筛过
 * ⇒ 下载来的文件必然能「关联」回去，⛔ 别在这里再抄一份）。
 */
export const DOWNLOAD_EXT_WHITELIST: Record<DownloadKind, readonly string[]> = {
    music: AUDIO_ASSOCIABLE_EXTENSIONS,
    video: VIDEO_ASSOCIABLE_EXTENSIONS,
    book: ['epub', 'pdf', 'txt', 'mobi', 'azw3', 'fb2', 'cbz', 'zip'],
    other: [],
};

/** 单文件大小上限（缺省 300 MB）—— 超限即拒，防「误点一个 ISO 链接把库撑爆」 */
export const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

/** 文件名单段长度上限（保守值；Windows 单段上限 255 **字节**，中文名 3 字节/字） */
export const DOWNLOAD_NAME_MAX_CHARS = 120;

/** 空名回退（与笔记侧 `safeFilename` 的中文口径保持一致） */
const FALLBACK_NAME = '未命名';

/**
 * 净化下载文件名：Windows 非法字符与控制字符 → `_`，折叠空白，去掉**首尾**空白/点，截断超长，空则回退。
 *
 * 🔴 为什么要去「尾部的点与空格」：Windows 文件系统会**静默吃掉**文件名末尾的 `.` 和空格
 *    ⇒ `「歌名 」.mp3` 落盘后变成 `歌名.mp3`，而下一次查找 `歌名 .mp3` 找不到。
 * ⛔ 不去除中文、空格、括号、`-`、`、` —— 它们全是合法且常用的。
 */
export function sanitizeDownloadName(raw: string): string {
    const cleaned = String(raw ?? '')
        .replace(/[\\/:*?"<>|]/g, '_')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '');
    if (!cleaned) return FALLBACK_NAME;
    return cleaned.length > DOWNLOAD_NAME_MAX_CHARS ? cleaned.slice(0, DOWNLOAD_NAME_MAX_CHARS) : cleaned;
}

/** 取扩展名（小写、无点；无扩展名 / 以点结尾 → `''`） */
export function downloadExt(filename: string): string {
    const name = String(filename ?? '');
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) return '';
    return name.slice(idx + 1).toLowerCase();
}

/** 扩展名是否在该类型的白名单里（大小写无关；`other` 为空白名单 ⇒ 恒 false） */
export function downloadExtAllowed(kind: DownloadKind, ext: string): boolean {
    const list = DOWNLOAD_EXT_WHITELIST[kind] ?? [];
    const e = String(ext ?? '')
        .replace(/^\./, '')
        .toLowerCase();
    return !!e && list.includes(e);
}

/**
 * 重名去重：`歌名.mp3` → `歌名 (2).mp3` → `歌名 (3).mp3`（占位则继续递增）。
 *
 * 🔴 **已带编号的名字要先「归一」再递增**：`歌名 (2).mp3` 已存在时应得 `歌名 (3).mp3`，
 *    而不是 `歌名 (2) (2).mp3`（否则同一首歌下十次能堆出十个不同后缀的副本）。
 */
export function uniqueDownloadName(filename: string, taken: ReadonlySet<string>): string {
    const name = sanitizeDownloadName(filename) || FALLBACK_NAME;
    if (!taken || !taken.has(name)) return name;
    const ext = downloadExt(name);
    const suffix = ext ? `.${ext}` : '';
    let base = ext ? name.slice(0, name.length - suffix.length) : name;
    // 剥掉既有编号：`歌名 (2)` → `歌名`（编号前**必须有空格**，否则「歌名(现场版)」会被误剥）
    const m = base.match(/^(.*?)\s\((\d+)\)$/);
    if (m) base = m[1];
    for (let n = 2; n < 10000; n++) {
        const candidate = `${base} (${n})${suffix}`;
        if (!taken.has(candidate)) return candidate;
    }
    return `${base} (${Date.now()})${suffix}`;
}

/**
 * 归一「目录输入值」：反斜杠 → 正斜杠、去掉首尾斜杠与空白。**空 / 全是斜杠 ⇒ `''`**（不回缺省）。
 * ⚠️ 这是 `normalizeDownloadRoot()` 与 `downloadDir()` 的**共同底盘** —— 两处归一规则不许分叉。
 *
 * 🔴 **先去空白再去斜杠**（顺序不能反）：`'  下载/  '` 若先剥斜杠，末尾那个 `/` 会被两侧空格挡住
 *    ⇒ 出来 `下载/` ⇒ 落盘路径变成 `下载//音乐/…`（多一层空目录名）。本批单测实测踩到。
 */
function normalizeRootInput(raw: string | undefined): string {
    return String(raw ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .trim();
}

/**
 * 归一「目录设置项」填的值：走 `normalizeRootInput`；**空 ⇒ 回该类型默认目录**（不传 kind 时回
 * 通用缺省 `DOWNLOAD_ROOT_DEFAULT`）。
 *
 * 🔴 这是目录设置项的**唯一归一入口** —— `downloadDir()` 也走它（#403 起），⛔ 别在设置页里另写一遍：
 *    两处归一规则只要有一处不同，就会出现「设置页显示 A、文件落到 B」这种查不出来的错位。
 * ⚠️ `kind` 参数（#459）：这两项现在**就是目录本身**，所以空值要回**本类型的**默认（`下载/音乐`），
 *    而不是通用缺省（否则音乐会被丢进 `下载/`，与既有文件分家）。
 */
export function normalizeDownloadRoot(raw: string | undefined, kind?: DownloadKind): string {
    const r = normalizeRootInput(raw);
    if (r) return r;
    return kind ? DOWNLOAD_DIR_DEFAULT[kind] ?? DOWNLOAD_ROOT_DEFAULT : DOWNLOAD_ROOT_DEFAULT;
}

/**
 * #459 存量迁移：旧版设置项存的是「**下载根**」，实际落盘 = `root/音乐`（子目录由代码拼）。
 * 本批改成「值 = 目录本身」后，**存量值恰好是旧缺省 `下载`** 的用户若不处理，新文件会落到 `下载/`
 * ——与已经下好的 `下载/音乐/**` 分家，且「检索同名音频」扫的是同一份目录（`listLibraryAudioFiles`）
 * ⇒ 用户看到「以前下的歌全搜不到了」。
 * ⇒ 把这类值补成该类型的默认目录；**其余值原样返回**（用户在用的自定义值一个都不动）。
 *
 * ⚠️ 调用方必须**只跑一次**（标记位）：用户完全可能**故意**填 `下载`（就想都放一处），
 *    每次载入都改等于用户改不回去。
 */
export function migrateLegacyDownloadDir(raw: string | undefined, kind: DownloadKind): string {
    const v = String(raw ?? '').trim();
    if (normalizeRootInput(v) === DOWNLOAD_ROOT_DEFAULT) {
        return DOWNLOAD_DIR_DEFAULT[kind] ?? DOWNLOAD_ROOT_DEFAULT;
    }
    return v;
}

/**
 * 该类型文件**所在目录**的库内相对路径（#459 起 = 设置项的值**本身**，⛔ 不再拼 `音乐/` `书籍/` 子目录）。
 *
 * ⚠️ 落盘（`downloadRelPath`）与「检索库内同名文件」（`main.listLibraryAudioFiles` /
 *    `listLibraryBookFiles`）**必须都走这一个函数** —— 两处各拼一份路径，用户改完设置立刻对不上。
 */
export function downloadDir(root: string | undefined, kind: DownloadKind): string {
    return normalizeDownloadRoot(root, kind);
}

/**
 * 该类型目录在**系统里的绝对路径** —— 系统文件选择器（「浏览」）`defaultPath` 的锚点。
 *
 * 🔴 #460（用户 2026-10-01）：「怎么每次浏览本地音频关联的路径每次在系统/下载，不是应该在填的目录下吗」
 *    —— 「浏览」走的是 Electron 系统对话框，而它此前**只在「本会话选过一次文件」时才有锚**
 *    （`main.lastSystemDir`）；首次打开 / 插件重载后一律落**系统默认**（Windows 上就是「下载」）。
 *    ⇒ 这里按「填的目录」算出绝对路径兜底，让冷启动就落在用户自己的目录里。
 *
 * ⚠️ **只做字符串拼接**（归一尾斜杠 + 拼 `basePath`），**不判存在** —— 存在性由调用方查
 *   （不存在的 `defaultPath` 各平台行为不一，宁可让调用方退回首选系统默认）。
 * ⚠️ 拿不到库基路径（非桌面 / 适配器无 `getBasePath`）⇒ `undefined`（⛔ 别硬编一个路径）。
 */
export function downloadDirAbsPath(
    basePath: string | undefined,
    root: string | undefined,
    kind: DownloadKind,
): string | undefined {
    // 基路径也归一成正斜杠：库内相对路径一律 `/`，拼出来右边 `/`、左边 `\` 的混合形态虽然 Windows 认，
    // 但会让 `defaultPath` 的可读性与断言都变脏（UNC `\\nas\share` → `//nas/share`，Node/Electron 同样认）。
    const base = String(basePath ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (!base) return undefined;
    return `${base}/${downloadDir(root, kind)}`;
}

/**
 * 校验设置页里填的下载根目录（库内相对路径）。合法 ⇒ `null`；否则给一句面向用户的原因。
 *
 * 🔴 三个「静默错位」防坑（照「媒体库目录」那一套，理由相同）：
 *  ⑴ **盘符 / 绝对路径**：`D:\音乐` 会被当成库内一个叫 `D:` 的文件夹 ⇒ 下载物落到 `D:/音乐/…`，
 *     用户以为存在 D 盘（实际全在库内），而**没有任何报错**；
 *  ⑵ `..` 段：`../外面` 会爬到库根之外，Obsidian 的 `vault.create` 那一步才失败；
 *  ⑶ Windows 非法字符：`:` `*` `?` `"` `<` `>` `|` 会直接建目录失败。
 * ⚠️ 空值是**合法**的（= 用缺省），⛔ 别把它判成错误。
 */
export function downloadRootIssue(raw: string | undefined): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\')) {
        return '要填库内相对路径（如 下载），不能填盘符或绝对路径';
    }
    if (s.split(/[\\/]+/).some((seg) => seg === '..')) return '路径里不能出现 ..';
    if (/[:*?"<>|]/.test(s.replace(/[\\/]/g, ''))) return '路径里不能有 : * ? " < > | 这些字符';
    return null;
}

/**
 * 决策最终落盘路径（含重名去重）。
 *
 * 🔴 `taken` 装的是**完整库内相对路径**（真实来源 = vault 索引），而 `uniqueDownloadName` 只认
 *    **文件名** ⇒ 这里必须先按 `dir/` 前缀筛出**同目录**的，再取 basename 交给它。
 *    ⛔ 别把整个路径集合直接塞进去：那样 `下载/视频/x.mp3` 会把 `下载/音乐/x.mp3` 也当成冲突，
 *    用户会看到「同名但我明明下载的是另一个目录」的莫名 `(2)`。
 *
 * @param taken 当前已存在的库内相对路径集合（调用方从 vault 索引取）
 * @returns 可直接交给 `vault.createBinary` 的库内相对路径
 */
export function downloadRelPath(opts: {
    kind: DownloadKind;
    filename: string;
    root?: string;
    taken?: ReadonlySet<string>;
}): string {
    const dir = downloadDir(opts.root, opts.kind);
    const prefix = `${dir}/`;
    const siblings = new Set<string>();
    for (const p of opts.taken ?? []) {
        if (p.startsWith(prefix)) siblings.add(p.slice(prefix.length));
    }
    const name = uniqueDownloadName(opts.filename, siblings);
    return `${dir}/${name}`;
}

/** 大小是否超限；返回**面向用户的原因**（未超返回 `null`） */
export function downloadSizeIssue(bytes: number, limit = DOWNLOAD_MAX_BYTES): string | null {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '文件大小异常';
    if (n > limit) return `文件超过 ${Math.round(limit / 1024 / 1024)} MB 上限`;
    return null;
}
