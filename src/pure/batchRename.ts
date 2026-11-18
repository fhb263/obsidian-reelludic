/**
 * 关联媒体重命名：把「条目 + 媒体文件」算成一批「旧路径 → 新文件名」的改名计划。
 *
 * 🔴🔴 **2026-11-13 用户指令（现行定稿）**：规则模板从原来那套统一的
 *    `[年份] 片名 - 导演、S01E01` 换成**按类型分列的七套**（电影 / 剧集 / 动画 / 音乐 /
 *    漫画 / 文学 / 网文）。原文逐字：
 *      电影：`{电影名} ({年份}).{ext}` 或 `{电影名} ({年份}) [{分辨率}].{ext}`
 *            示例：流浪地球2 (2023) [4K].mkv
 *      剧集：`{剧名} - S{季号}E{集号} - {单集标题}.{ext}`
 *            示例：权力的游戏 - S01E01 - 凛冬将至.mp4
 *      动画：`{动画名} - S{季号}E{集号} - {单集标题}.{ext}` 或 `{动画名} - 第{集号}话.{ext}`
 *            示例：进击的巨人 - S04E01 - 海的另一边.mkv 或 进击的巨人 - 第01话.mkv
 *      音乐：`{歌手} - {歌曲名}.{ext}` 示例：周杰伦 - 七里香.mp3、周杰伦&费玉清 - 千里之外.mp3
 *      漫画：`{漫画名} - 第{话数}话.{ext}` 或 `{漫画名} - 卷{卷号}.{ext}`
 *            示例：海贼王 - 第1090话.cbz 或 咒术回战 - 卷01.epub
 *      文学：`{作者} - {书名} ({年份}).{ext}` 示例：刘慈欣 - 三体 (2008).epub
 *      网文：`{书名} - {作者}.{ext}` 示例：诡秘之主 - 爱潜水的乌贼.txt
 *    ⚠️ 七套模板的**唯一真源**是 `RENAME_TEMPLATE_GROUPS` —— 设置页与弹窗都只渲染它，
 *       ⛔ 别在界面里再抄一遍字符串（抄两份必然漂移）。界面文案改动只改这里的 `label` / `examples`。
 *
 * 🔴 这个文件只做**算名字 + 判冲突**，一个字节都不碰文件系统：
 *    - 真正改名的唯一出口是宿主 `plugin.runBatchRename()` → `app.fileManager.renameFile()`；
 *    - 这样「规则」可以单测到逐字符，而「改文件」只在真机上发生一次。
 *
 * 🔴 **坐标口径（踩过一次）**：`episodeFiles` / `audioPath` / `bookFile` 里存的既可能是 **vault 相对路径**
 *    （`ReelLudic/视频/a.mkv`），也可能是**操作系统绝对路径**（`C:\videos\a.mkv`，
 *    由 `scanEpisodeDir` 回填）⇒ 本模块**不按前缀猜库内/库外**，只按最后一个 `/` 拆目录与文件名。
 *    「这个文件改不改得动」由宿主用 `vault.getAbstractFileByPath()` 拿到 `TFile` 才判定，
 *    ⛔ 不要在这里用 `libraryDir` 前缀做判断（绝对路径会漏判、用户改过库目录名后会误判）。
 *
 * 三条硬口径（都是踩过才知道的）：
 *   ⑴ **同一目录内改名必须整批一起算冲突**，逐条算会漏掉「A→B、B→A」这种互换（先改 A 会把 B 覆盖掉）。
 *   ⑵ **目标名相同就整条跳过**（不是加 `(1)` 后缀）：文件名的用途是「排序稳定 + 人能认」，
 *      加后缀反而制造第二套命名。跳过的原因要能说给用户听。
 *   ⑶ **解析不出的部分不写占位符**：没有年份就不写 `()`，没有单集标题就不写 ` - `。
 *      `刘慈欣 - 三体 ()` 这种名字比原名更糟。
 */

import type { BookKind, EntryType, MediaEntry } from 'data/types';
import { musicArtistOf } from 'pure/musicArtist';

/** 七类命名规则（= 用户给的七套模板，一一对应）。 */
export type RenameKind = 'movie' | 'tv' | 'anime' | 'music' | 'comic' | 'book' | 'novel';

/**
 * 一套规则模板（**界面唯一真源**）。
 * `templates` 里的 `{…}` 是占位符说明，用户看的是「这个名字会长成什么样」；`examples` 是实样。
 */
export interface RenameTemplateGroup {
    kind: RenameKind;
    /** 分组名（电影 / 剧集 / …），直接渲染成小标题 */
    label: string;
    /** 该类型支持的全部模板写法（≥1 条；多写法的类型第一条为**自动规则实际采用的**那条） */
    templates: string[];
    /** 实样（与 `templates` 同序，⛔ 不许编造仓库里不可能出现的类型） */
    examples: string[];
}

/**
 * 🔴🔴 七类规则模板（2026-11-13 用户给定，逐字）。界面只渲染这份数据。
 *
 * ⚠️ 多写法的三类（电影 / 动画 / 漫画）里，**第一条是自动规则真正会产出的**：
 *    - 电影的 `[{分辨率}]`：只有从**原文件名**里认得出 `4K / 2160p / 1080p …` 时才加（见 `resolutionOf`）；
 *    - 动画的 `第{集号}话`：只在**没有季号**时用（有季号走 `SxxExx`）；
 *    - 漫画的 `卷{卷号}`：条目上没有卷字段 ⇒ 自动规则只产出「第 N 话」，卷写法仅在模板说明里供参考。
 */
export const RENAME_TEMPLATE_GROUPS: readonly RenameTemplateGroup[] = [
    {
        kind: 'movie',
        label: '电影',
        templates: ['{电影名} ({年份}).{ext}', '{电影名} ({年份}) [{分辨率}].{ext}'],
        examples: ['流浪地球2 (2023) [4K].mkv'],
    },
    {
        kind: 'tv',
        label: '剧集',
        templates: ['{剧名} - S{季号}E{集号} - {单集标题}.{ext}'],
        examples: ['权力的游戏 - S01E01 - 凛冬将至.mp4'],
    },
    {
        kind: 'anime',
        label: '动画',
        templates: ['{动画名} - S{季号}E{集号} - {单集标题}.{ext}', '{动画名} - 第{集号}话.{ext}'],
        examples: ['进击的巨人 - S04E01 - 海的另一边.mkv', '进击的巨人 - 第01话.mkv'],
    },
    {
        kind: 'music',
        label: '音乐',
        templates: ['{歌手} - {歌曲名}.{ext}'],
        examples: ['周杰伦 - 七里香.mp3', '周杰伦&费玉清 - 千里之外.mp3'],
    },
    {
        kind: 'comic',
        label: '漫画',
        templates: ['{漫画名} - 第{话数}话.{ext}', '{漫画名} - 卷{卷号}.{ext}'],
        examples: ['海贼王 - 第1090话.cbz', '咒术回战 - 卷01.epub'],
    },
    {
        kind: 'book',
        label: '文学',
        templates: ['{作者} - {书名} ({年份}).{ext}'],
        examples: ['刘慈欣 - 三体 (2008).epub'],
    },
    {
        kind: 'novel',
        label: '网文',
        templates: ['{书名} - {作者}.{ext}'],
        examples: ['诡秘之主 - 爱潜水的乌贼.txt'],
    },
];

/** 按 `kind` 取模板组（弹窗 / 设置页共用，⛔ 别各自 find 一遍）。 */
export function renameTemplateOf(kind: RenameKind): RenameTemplateGroup | undefined {
    return RENAME_TEMPLATE_GROUPS.find((g) => g.kind === kind);
}

/**
 * 条目 → 用哪套规则。
 * - `movie` / `tv` / `anime` / `music`：直接对应；
 * - `book`：按 `bookKind` 分「漫画 / 网文 / 文学」（缺省文学，与 `pure/bookKind.normalizeBookKind` 同口径）；
 * - `game`：**没有命名规则**（游戏目录不该被插件改名）⇒ 返回 null，调用方按「跳过」处理。
 */
export function renameKindOf(entry: Pick<MediaEntry, 'type'> & { bookKind?: BookKind }): RenameKind | null {
    const type = entry.type as EntryType;
    if (type === 'movie' || type === 'tv' || type === 'anime' || type === 'music') return type;
    if (type !== 'book') return null;
    const bk = entry.bookKind;
    if (bk === 'comic') return 'comic';
    if (bk === 'novel') return 'novel';
    return 'book';
}

/**
 * 一条改名计划里的单文件。`path` 是**字段原样**（vault 相对路径或系统绝对路径），
 * 是否可改名由宿主用 `TFile` 判定。
 */
export interface RenameItem {
    /** 字段原样路径（vault 相对路径或系统绝对路径） */
    path: string;
    /** 目录部分（含尾随 `/`；根目录为空串） */
    dir: string;
    /** 当前文件名（含扩展名） */
    name: string;
    /** 扩展名（含点；无扩展名为空串） */
    ext: string;
    /** 该文件属于哪一集（1 = 第 1 集；非分集媒体恒 1） */
    episode: number;
    /** 该集是否**只有一个**文件（单文件条目用片名本身，不带集号） */
    single: boolean;
}

/** 一条被跳过的文件 + 原因（**只在内部统计与日志用**；弹窗按用户 2026-11-13 口径不再展示）。 */
export interface RenameSkip {
    path: string;
    reason: string;
}

/** 一个条目的改名结果。 */
export interface RenamePlan {
    entryId: string;
    title: string;
    /** 这条用的是哪套规则（弹窗按类型分组展示用） */
    kind: RenameKind | null;
    /** 会被改名的文件 */
    renames: Array<RenameItem & { next: string }>;
    /** 因为「名字没变」被跳过的 */
    unchanged: RenameSkip[];
    /** 因为「撞名 / 非法 / 缺字段 / 无规则」被跳过的 */
    skipped: RenameSkip[];
}

export interface RenameOptions {
    /**
     * 是否带集号。用户规则里写了「季/集」⇒ 默认 **true**；
     * 单文件条目（电影 / 单曲）自动不写。
     */
    withEpisode?: boolean;
    /** 文件名最大字符数（默认 180；Windows 全路径限制 260，留余量给目录与扩展名） */
    maxNameLen?: number;
    /** 覆盖式分辨率标签（如 `4K`）；缺省时从原文件名里认（见 `resolutionOf`） */
    resolution?: string;
}

const DEFAULT_MAX_NAME_LEN = 180;

/** 从扩展名切出来（`a/b/c.mkv` → `mkv`）；没有点则空串。 */
function extOf(name: string): string {
    const m = /\.[A-Za-z0-9]{1,8}$/.exec(name);
    return m ? m[0] : '';
}

/** 拆出目录 + 文件名（统一用 `/`，Windows 反斜杠也认）。 */
export function splitPath(path: string): { dir: string; name: string } {
    const p = String(path ?? '').replace(/\\/g, '/');
    const i = p.lastIndexOf('/');
    if (i < 0) return { dir: '', name: p };
    return { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
}

/**
 * 文件名清洗（**与 `pure/videoLink.sanitizeFileStem` 同一套禁用字符**，但这里不剥扩展名、不兜底）。
 * ⚠️ 之所以不直接复用：`sanitizeFileStem` 会把 `a.mkv` 的 `.mkv` 当扩展名剥掉，而这里要保留它。
 *
 * 🔴🔴 2026-11-14 用户指令（**推翻上一版「`[` `]` 也算禁用字符」的口径**）：
 *    原话「怎么完整输出中括号的如「[哥伦比亚] 加西亚·马尔克斯」没有中括号就会变成整个人名了」
 *    ⇒ **`[` 与 `]` 必须原样保留**（作者名里带 `[国籍]` 前缀是常见写法，吃掉了就变成一个人名）。
 *    `()` 与 `[]` 一样都是合法文件名字符，⛔ 都不禁。
 *    真正禁用（Windows/Obsidian 双链都不安全）的只有：`\ / : * ? " < > |` 与 `# ^`。
 */
export function cleanStem(raw: string): string {
    return String(raw ?? '')
        .replace(/[\\/:*?"<>|#^]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 两位补零（`1` → `01`）。 */
function pad2(n: number): string {
    return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** 取年份（非法 / 缺省 ⇒ 0，调用方据此决定要不要写 `(年份)`）。 */
function yearOf(entry: MediaEntry): number {
    return typeof entry.year === 'number' && entry.year > 0 ? Math.floor(entry.year) : 0;
}

/** 季号在 `entry.progress.season`（⛔ `MediaEntry` 上没有 `season` 字段）；缺失 ⇒ 0。 */
function seasonOf(entry: MediaEntry): number {
    const raw = entry.progress?.season;
    return typeof raw === 'number' && raw > 0 ? Math.floor(raw) : 0;
}

/** 第 `episode` 集的单集标题（`episodeTitles` 与 `episodeFiles` 同下标）；没有 ⇒ 空串。 */
function episodeTitleOf(entry: MediaEntry, episode: number): string {
    const list = Array.isArray(entry.episodeTitles) ? entry.episodeTitles : [];
    const at = episode - 1;
    if (at < 0 || at >= list.length) return '';
    return cleanStem(list[at] || '');
}

/**
 * 从原文件名里认分辨率标签（`流浪地球2.2160p.mkv` ⇒ `4K`；认不出 ⇒ 空串）。
 *
 * 🔴 为什么要从**文件名**认：`MediaEntry` 上没有分辨率字段（`types.ts` 里查过，只有 year / genres /
 *    director 之类）—— 而用户模板里 `[{分辨率}]` 是**可选段**。宁可从原文件名里读，也不去猜一个默认值
 *    （猜错会把 `720p` 的片子标成 `4K`，比不标更糟）。
 */
export function resolutionOf(fileName: string): string {
    const s = String(fileName ?? '').toLowerCase();
    if (/\b(4320p|8k)\b/.test(s)) return '8K';
    if (/\b(2160p|4k)\b/.test(s)) return '4K';
    if (/\b(1440p|2k)\b/.test(s)) return '2K';
    if (/\b1080p\b/.test(s)) return '1080P';
    if (/\b720p\b/.test(s)) return '720P';
    if (/\b480p\b/.test(s)) return '480P';
    return '';
}

/**
 * 按类型拼出**不带扩展名**的目标名（七套规则见文件头注释）。
 *
 * 通用口径：
 * - 缺字段就**整段省略**，⛔ 不写 `()` / ` - ` / `[]` 占位（见头注释口径 ⑶）；
 * - 片名清洗后为空 ⇒ 兜底「未命名」，⛔ 不产出空名字；
 * - `game` 之类没有规则的类型 ⇒ 返回空串，由 `planEntryRename` 记为跳过。
 */
export function buildRenameStem(entry: MediaEntry, episode: number, single: boolean, opts: RenameOptions): string {
    const kind = renameKindOf(entry);
    if (!kind) return '';

    const title = cleanStem(entry.title || '') || '未命名';
    const year = yearOf(entry);
    const season = seasonOf(entry);
    const ee = pad2(episode);
    const withEpisode = opts.withEpisode !== false;

    switch (kind) {
        // ── 电影：`{电影名} ({年份})` + 可选 `[{分辨率}]` ──
        case 'movie': {
            const base = year > 0 ? `${title} (${year})` : title;
            const res = cleanStem(opts.resolution || '');
            return res ? `${base} [${res}]` : base;
        }

        // ── 剧集：`{剧名} - S{季号}E{集号} - {单集标题}` ──
        case 'tv': {
            // 单文件剧（整季压一个文件）没有「第几集」可言 ⇒ 只用片名。
            if (single && !withEpisode) return title;
            const ss = pad2(season > 0 ? season : 1);
            const head = `${title} - S${ss}E${ee}`;
            const ep = episodeTitleOf(entry, episode);
            return ep ? `${head} - ${ep}` : head;
        }

        // ── 动画：有季号走 `SxxExx - 单集标题`，没季号走 `第NN话` ──
        case 'anime': {
            if (season > 0) {
                const head = `${title} - S${pad2(season)}E${ee}`;
                const ep = episodeTitleOf(entry, episode);
                return ep ? `${head} - ${ep}` : head;
            }
            return `${title} - 第${ee}话`;
        }

        // ── 音乐：`{歌手} - {歌曲名}` ──
        case 'music': {
            // 🔴 歌手走 `pure/musicArtist.musicArtistOf`（唯一真源）：音乐歌手在 `author`，
            //    `artist` 是**漫画画师**。⛔ 别在这里直接读 `entry.artist`（2026-11-14 bug 的根因）。
            // ⚠️ `musicArtistOf` 只负责「取哪个字段」，**不做文件名清洗**（它是纯取值函数，别处也要用原值）；
            //    清洗在这里做 —— 歌手名里带 `/` `:` 之类会算出非法文件名。
            const artist = cleanStem(musicArtistOf(entry));
            // 多文件（整张专辑）时，每个文件的「歌曲名」从 `episodeTitles` 取；没有就退到「片名 + 序号」，
            // 否则整张专辑的每首歌会算出同一个名字、被判同目录撞名而全部跳过（= 什么都没改）。
            const song = episodeTitleOf(entry, episode) || (single ? title : `${title} ${ee}`);
            return artist ? `${artist} - ${song}` : song;
        }

        // ── 漫画：`{漫画名} - 第{话数}话`（单文件卷用片名本身，不瞎标「第01话」）──
        case 'comic': {
            if (single) return title;
            return `${title} - 第${ee}话`;
        }

        // ── 文学：`{作者} - {书名} ({年份})` ──
        case 'book': {
            const author = cleanStem(entry.author || '');
            const named = year > 0 ? `${title} (${year})` : title;
            return author ? `${author} - ${named}` : named;
        }

        // ── 网文：`{书名} - {作者}` ──
        case 'novel': {
            const author = cleanStem(entry.author || '');
            return author ? `${title} - ${author}` : title;
        }
    }
}

/**
 * 原文件名是否**已经符合**该类型的规则形状 —— 符合就别动它。
 *
 * 🔴🔴 2026-11-14 用户指令：原话「还有一些符合规则关联的音频文件如：「周杰伦 - 七里香.mp3」
 *    被强制改为「七里香.mp3」了」。
 *    根因有两层：① `buildRenameStem` 的 music 分支在 `artist` 为空时会退化成只有歌名；
 *    ② `planEntryRename` 的「已合规」判据只认 `next === name`（逐字符相等），
 *    于是「文件名本来就已经是 `{歌手} - {歌曲名}`」的条目反而被改成了缺歌手的样子。
 *
 * 判据用**原文件名**（不带扩展名的 stem），⛔ 不看条目字段 —— 用户点名的是「文件本来就叫对了」。
 * 目前只对 `music` 生效（它是唯一「缺字段会退化到更差名字」的类型）；其它类型保持原口径不动。
 */
export function stemAlreadyCompliant(
    kind: RenameKind | null,
    originalStem: string,
    entry: MediaEntry,
    episode: number,
): boolean {
    if (kind !== 'music') return false;
    const stem = cleanStem(originalStem);
    if (!stem) return false;
    // `{歌手} - {歌曲名}`：中间必须是「空格 - 空格」（`周杰伦&费玉清 - 千里之外` 也命中）
    const m = /^(.+?)\s+-\s+(.+)$/.exec(stem);
    if (!m) return false;
    const song = episodeTitleOf(entry, episode) || cleanStem(entry.title || '');
    // 歌名认得出就要求尾段一致（防止「A - B」里 B 是别的东西）；认不出就认「两段式」即合规
    if (song && m[2].trim() !== song) return false;
    // 🔴 歌手段也要对得上：条目**有**歌手时，只有前缀相同才算「本来就叫对了」——
    //    否则 `别人 - 七里香.mp3` 会被这句免检放走，而规则本来能把它改成 `周杰伦 - 七里香.mp3`。
    //    条目**没有**歌手时才退回「两段式即合规」（规则算出来只会更差，见 `musicArtistOf`）。
    const artist = musicArtistOf(entry);
    if (!artist) return true;
    return m[1].trim() === artist;
}

/** 截断到 `maxLen` 个字符（按 UTF-16 长度；中文名字实际更占字节，180 已留足余量）。 */
function clampStem(stem: string, ext: string, maxLen: number): string {
    const limit = Math.max(16, maxLen - ext.length);
    return stem.length <= limit ? stem : stem.slice(0, limit).trim();
}

/**
 * 条目关联的本地文件清单。
 *
 * 顺序即优先级：分集视频（`episodeFiles`，下标 = 集号）→ 单曲（`audioPath`）→ 书籍文件（`bookFile`）。
 * ⛔ 别把 `bookFile` 塞在 `episodeFiles` 前面：剧集条目偶尔也挂了电子书，那会改错文件。
 */
function localFilesOf(entry: MediaEntry): Array<{ path: string; episode: number }> {
    const files: Array<{ path: string; episode: number }> = [];
    const episodes = Array.isArray(entry.episodeFiles) ? entry.episodeFiles : [];
    episodes.forEach((p, i) => {
        if (typeof p === 'string' && p.trim().length > 0) files.push({ path: p, episode: i + 1 });
    });
    if (files.length > 0) return files;

    if (typeof entry.audioPath === 'string' && entry.audioPath.trim().length > 0) {
        files.push({ path: entry.audioPath, episode: 1 });
    }
    if (files.length > 0) return files;

    if (typeof entry.bookFile === 'string' && entry.bookFile.trim().length > 0) {
        files.push({ path: entry.bookFile, episode: 1 });
    }
    return files;
}

/**
 * 算一个条目的改名计划。
 *
 * ⚠️ 冲突判定**只在同一目录内**（不同目录同名是允许的，Obsidian 也不认跨目录重名）；
 *    但同一目录里两个文件算出同一个名字 ⇒ **两颗都跳过**（不是留一颗改一颗：那会让用户
 *    看到「改了一半」，而且下次点又会改另一颗）。
 */
export function planEntryRename(entry: MediaEntry, opts: RenameOptions): RenamePlan {
    const maxLen = opts.maxNameLen ?? DEFAULT_MAX_NAME_LEN;
    const kind = renameKindOf(entry);
    const plan: RenamePlan = {
        entryId: entry.id,
        title: entry.title,
        kind,
        renames: [],
        unchanged: [],
        skipped: [],
    };

    const files = localFilesOf(entry);
    // 🔴 先判「有没有规则」再判「有没有文件」：游戏既没有规则、通常也没有关联文件，
    //    而真正的原因是**这个类型不该改名**（工具装了几百个 G 的目录被插件改名是灾难）。
    //    ⛔ 反过来先报「没有关联本地文件」会把用户引去补文件，补完还是改不了。
    if (!kind) {
        plan.skipped.push({ path: '', reason: '这个类型没有命名规则（游戏等不改名）' });
        return plan;
    }
    if (files.length === 0) {
        plan.skipped.push({ path: '', reason: '这条没有关联本地文件' });
        return plan;
    }

    const single = files.length === 1;
    const seen = new Map<string, string[]>();

    for (const f of files) {
        const { dir, name } = splitPath(f.path);
        const ext = extOf(name);
        const originalStem = ext ? name.slice(0, name.length - ext.length) : name;
        // 🔴 2026-11-14 用户指令：原文件名本来就已经符合规则形状（如 `周杰伦 - 七里香.mp3`）⇒ 不动它。
        //    必须在 buildRenameStem 之前判：条目缺 artist 时算出来的名字会更差（只剩歌名）。
        if (stemAlreadyCompliant(kind, originalStem, entry, f.episode)) {
            plan.unchanged.push({ path: f.path, reason: '名字已经符合规则' });
            continue;
        }
        // 分辨率从**这个文件自己的名字**里认（电影模板的可选段），⛔ 不跨文件套用。
        const perFile: RenameOptions = opts.resolution
            ? opts
            : { ...opts, resolution: kind === 'movie' ? resolutionOf(name) : '' };
        const stem = clampStem(buildRenameStem(entry, f.episode, single, perFile), ext, maxLen);
        const next = `${stem}${ext}`;
        if (!stem) {
            plan.skipped.push({ path: f.path, reason: '拼不出可用的文件名（片名全是非法字符）' });
            continue;
        }
        if (next === name) {
            plan.unchanged.push({ path: f.path, reason: '名字已经符合规则' });
            continue;
        }
        const key = `${dir}\u0000${next.toLowerCase()}`;
        const bucket = seen.get(key);
        if (bucket) bucket.push(f.path);
        else seen.set(key, [f.path]);
        plan.renames.push({ path: f.path, dir, name, ext, episode: f.episode, single, next });
    }

    // 同目录撞名 ⇒ 整组跳过（见头注释口径 ⑵）
    for (const [, paths] of seen) {
        if (paths.length < 2) continue;
        for (const p of paths) {
            const idx = plan.renames.findIndex((r) => r.path === p);
            if (idx < 0) continue;
            plan.renames.splice(idx, 1);
            plan.skipped.push({ path: p, reason: '同目录里有别的文件会算出同一个名字' });
        }
    }

    return plan;
}

/**
 * 全部条目的改名计划。
 *
 * 🔴 2026-11-13 口径：**只保留真会改名的条目**（`renames.length > 0`）。
 *    用户原话：「重命名这个页面不要显示什么有多少个文件被跳过了只显示关联的文件」
 *    ⇒ 「没有关联文件 / 名字已合规 / 撞名」这些条目**不进列表**，弹窗里也就不可能再报数。
 *    ⚠️ 合并条目仍带 `skipped` 明细，供宿主 debug 日志用，⛔ 别再渲染成「N 个文件被跳过」。
 */
export function planBatchRename(entries: readonly MediaEntry[], opts: RenameOptions): RenamePlan[] {
    const out: RenamePlan[] = [];
    for (const e of entries) {
        const plan = planEntryRename(e, opts);
        if (plan.renames.length > 0) out.push(plan);
    }
    return out;
}

/** 汇总：待改名条数 / 待改名文件数 / 跳过文件数（跳过数仅内部统计，界面不展示）。 */
export interface RenameSummary {
    entries: number;
    files: number;
    skipped: number;
}
export function summarizeRenamePlans(plans: readonly RenamePlan[]): RenameSummary {
    let files = 0;
    let skipped = 0;
    for (const p of plans) {
        files += p.renames.length;
        skipped += p.skipped.length;
    }
    return { entries: plans.filter((p) => p.renames.length > 0).length, files, skipped };
}

/** 计划里第一条「说明」文案（列表行摘要用；⛔ 别在视图里另拼一套）。 */
export function renamePlanTip(plan: RenamePlan): string {
    if (plan.renames.length === 0) {
        return plan.skipped.length > 0 ? plan.skipped[0].reason : '没有需要改名的文件';
    }
    const sample = plan.renames[0];
    const more = plan.renames.length > 1 ? `（共 ${plan.renames.length} 个）` : '';
    return `${sample.name} → ${sample.next}${more}`;
}
