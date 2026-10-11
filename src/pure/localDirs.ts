/**
 * 「分类本地目录」真源（#562）—— 设置页「实验性功能」三个折叠分组下的子项，
 * 同时是全仓「本地检索」的**搜索根目录**：影视那枚单集本地检索（#563）、书籍那枚（🔴 #602 起
 * 也改成走它 —— 原先书籍是「先弹系统目录选择器」，现与影视同一条链）。
 *
 * 🔴 为什么要有单独一张表：用户在设置页里是**按三分组**填的
 *    （阅读器 → 文学 / 网文 / 漫画；视频播放器 → 剧集 / 动画 / 电影；音乐播放器 → 音乐），
 *    而代码侧需要「**给定一个条目，它的本地目录在哪**」这一个反向查询。
 *    两件事共用本表 ⇒ ⛔ 别在设置页或组件里各写一份 key→字段 的映射（那必然分叉）。
 *
 * ⚠️ 音乐那一档**没有新字段**：它复用既有的 `musicDownloadDir`（「音频文件目录」，
 *    本来就是「音频下载的存放与检索目录」）⇒ 设置页那边只是把那一行**搬进**音乐折叠分组，
 *    不是新建第二份「音乐目录」设置（两份必然打架）。
 *
 * ⛔ 游戏**没有**本地目录：它的本地关联是「用户当场挑一个文件夹」的语义（`findLibraryGame`），
 *    没有「按类型配一个根目录」的需求 ⇒ `localDirKeyFor('game')` 返回 `null`（⛔ 别为对称硬造一个）。
 *
 * 纯逻辑无 obsidian / 无 DOM，可单测。
 */
import type { BookKind, EntryType } from 'data/types';
import { normalizeBookKind } from 'pure/bookKind';

/** 分类本地目录的键（= 设置页子面板里的行，也 = 条目类型的分档） */
export type LocalDirKey = 'movie' | 'tv' | 'anime' | 'book' | 'novel' | 'comic' | 'music';

/** 七个键（顺序 = 三个分组内各自的顺序，见 `LOCAL_DIR_GROUPS`） */
export const LOCAL_DIR_KEYS: readonly LocalDirKey[] = ['book', 'novel', 'comic', 'movie', 'tv', 'anime', 'music'];

/** 设置项标题（⛔ 别在设置页手写第二份） */
export const LOCAL_DIR_LABELS: Record<LocalDirKey, string> = {
    book: '文学目录',
    novel: '网文目录',
    comic: '漫画目录',
    movie: '电影目录',
    tv: '剧集目录',
    anime: '动画目录',
    music: '音乐目录',
};

/**
 * 三个折叠分组 ↔ 成员（设置页渲染顺序的真源）。
 * 🔴 键名与 `pure/settingNav` 无关，只在本模块内使用；⛔ 别把顺序写在设置页里。
 */
export const LOCAL_DIR_GROUPS: Record<'reader' | 'video' | 'music', readonly LocalDirKey[]> = {
    reader: ['book', 'novel', 'comic'],
    video: ['movie', 'tv', 'anime'],
    music: ['music'],
};

/**
 * 目录键 → 设置字段名。
 * 🔴 音乐指向**既有**字段 `musicDownloadDir`（见模块头说明），其余六个是本批新增。
 */
export const LOCAL_DIR_FIELD: Record<LocalDirKey, string> = {
    book: 'localDirBook',
    novel: 'localDirNovel',
    comic: 'localDirComic',
    movie: 'localDirMovie',
    tv: 'localDirTv',
    anime: 'localDirAnime',
    music: 'musicDownloadDir',
};

/** 本模块需要的最小设置面（`ReelLudicSettings` 结构上满足它；⛔ 别 import Settings.ts —— 那是反向依赖） */
export interface LocalDirSettings {
    localDirBook?: string;
    localDirNovel?: string;
    localDirComic?: string;
    localDirMovie?: string;
    localDirTv?: string;
    localDirAnime?: string;
    musicDownloadDir?: string;
}

/** 读某个分类的本地目录（未配置 → 空串；两端空白一律去掉 —— 用户复制路径时极易带上） */
export function localDirOf(s: LocalDirSettings, key: LocalDirKey): string {
    const raw = (s as Record<string, unknown>)[LOCAL_DIR_FIELD[key]];
    return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 条目 → 本地目录键。
 * 🔴 书籍**走子分类**（文学 / 网文 / 漫画），缺省 / 非法子分类一律归「文学」（与 `normalizeBookKind` 同口径）。
 * ⛔ 游戏返回 `null`（见模块头）。
 */
export function localDirKeyFor(type: EntryType, bookKind?: BookKind | string | null): LocalDirKey | null {
    if (type === 'book') {
        const k = normalizeBookKind(bookKind);
        return k === 'novel' ? 'novel' : k === 'comic' ? 'comic' : 'book';
    }
    if (type === 'movie' || type === 'tv' || type === 'anime' || type === 'music') return type;
    return null;
}

/**
 * 目录值 → **系统绝对路径**（桌面端扫描要用）。
 * 🔴 两种写法都认：
 *    · 已是绝对路径（Windows 盘符 `D:\…` / `D:/…`，或 POSIX `/…`）⇒ 原样返回；
 *    · 其余按**库内相对路径**拼在 vault 根后面（与其他目录类设置一致）。
 * ⚠️ `base` 由宿主给（`adapter.getBasePath()`）；拿不到 base 而值又是相对路径 ⇒ 返回 `undefined`
 *    （⛔ 别拼出一个 `/电影` 这种看似合法、实则指向系统根的路径去扫）。
 * ⛔ 不在这里做 `existsSync` 判断（纯逻辑不碰 fs；存在性由宿主那一步兜）。
 */
export function resolveLocalDirAbs(base: string, dir: string): string | undefined {
    const d = String(dir ?? '').trim().replace(/[\\/]+$/, '');
    if (!d) return undefined;
    if (/^[a-zA-Z]:[\\/]/.test(d) || d.startsWith('/') || d.startsWith('\\\\')) return d;
    const b = String(base ?? '').trim().replace(/[\\/]+$/, '');
    if (!b) return undefined;
    return `${b}/${d}`;
}

/**
 * 🔴 #602 书籍「按标题检索本地文件」的**查询**（关联弹窗与编辑表单共用同一把口径）。
 * 用户原话：「书籍关联入口这个小图标按钮怎么是选文件夹关联的，统一成检索关联」⇒ 书籍那枚
 * `folder-search` 从「先弹系统目录选择器」改成与影视「单集本地检索」**同一条链**：根目录**不问用户**，
 * 直接取本条目的分类目录（`localDirKeyFor` → 文学 / 网文 / 漫画）。
 * ⚠️ `bookKind` 决定去哪个目录找 —— ⛔ 别在调用点自己判子分类（那正是 `localDirKeyFor` 的活）。
 */
export interface LocalBookSearchQuery {
    /** 书籍子分类（文学 / 网文 / 漫画）；缺省 / 非法一律按「文学」找（与 `normalizeBookKind` 同口径） */
    bookKind?: BookKind | string | null;
    /** 检索词 = 条目标题（空 ⇒ 宿主直接回一条提示，不扫盘） */
    title: string;
    /** 第二检索词 = 作者（不要求命中，只参与排序加成；与下载排序同一把尺） */
    author?: string;
}

/**
 * 「按标题检索本地文件」的**结果**（宿主算好，UI 只负责填框 / 提示）。
 * 🔴 收在本模块当**唯一形状**：弹窗（`QuickAssociateModal`）与编辑表单（`EntryForm.svelte`）都回这个，
 *    两边各自拿它决定「填框 + 闪提示」还是「把 `notice` 原样弹给用户」。
 * ⚠️ 为什么不在弹窗里定义：编辑表单要用同一把尺时，组件侧就得 import 一个**弹窗模块**
 *    （视图 → 弹窗的反向依赖）。放这里，两边都只依赖纯逻辑。
 */
export interface LocalFileSearchOutcome {
    /** 命中 ⇒ 要填进输入框的路径（库内相对 / 库外绝对，与「浏览」同口径） */
    path?: string;
    /** 命中的文件名（提示用） */
    name?: string;
    /** 同名命中个数（>1 时提示里说清「命中 N 个，已填入…」） */
    count?: number;
    /** 没命中 / 没配目录 / 标题为空 ⇒ 直接给用户看的文案 */
    notice?: string;
}
