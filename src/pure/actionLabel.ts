// 各库主操作文案与入口判定（纯逻辑，可单测）：
// 动词与图标随类型（观看/阅读/启动/播放），入口可用性判定统一收口，UI 层不散落条件
import type { EntryType, WatchLink } from 'data/types';

/** 主操作动词：影视=观看 / 书籍=阅读 / 游戏=启动 / 音乐=播放（与应用场景一致） */
export function actionVerb(type: EntryType): string {
    switch (type) {
        case 'book': return '阅读';
        case 'game': return '启动';
        case 'music': return '播放';
        default: return '观看';
    }
}

/** 主操作图标（Lucide 名）：书籍用 book-open（阅读语义），其余 play */
export function actionIcon(type: EntryType): string {
    return type === 'book' ? 'book-open' : 'play';
}

/** 按钮 aria-label（与动词一致，无障碍读屏与文案统一） */
export function actionAriaLabel(type: EntryType): string {
    return actionVerb(type);
}

/**
 * 主操作入口可用判定（🔴 与「左键点了到底会不会有反应」**必须同口径**）：
 *   影视 = 观看链接 / 本地剧集 / 网络地址任一；
 *   书籍 = 本地书籍文件 **或** 在线阅读链接（#535：原先只看 `bookFile` ⇒ 只填了网络地址的条目
 *          在海报墙 / 右键菜单里**不给「阅读」按钮**，而左键其实打得开 —— 判可用与真能执行不一致）；
 *   游戏 = .lnk 快捷方式 **或** 网络路径（#534 新增 `gameUrl` 时这里没同步，同一处漏判）；
 *   音乐 = 本地音频 **或** 网络地址（#601 新增 `audioUrl`；⚠️ 计数它就必须让「▶ 播放」真能打开它 ——
 *          见 `main.playAudioEntry` 的浏览器兜底，⛔ 别再造一次「判可用但点不动」）。
 * ⚠️ 一律按 **trim 后非空** 判断（⛔ 别用 `in` / 存在性判断 —— 空串与纯空格都会被当成有值）。
 */
export function hasActionEntry(e: {
    type: EntryType;
    links?: WatchLink[];
    episodeFiles?: string[];
    episodeUrls?: string[];
    bookFile?: string;
    gameLaunchPath?: string;
    audioPath?: string;
    readUrl?: string;
    gameUrl?: string;
    audioUrl?: string;
}): boolean {
    switch (e.type) {
        case 'book': return !!e.bookFile?.trim() || !!e.readUrl?.trim();
        case 'game': return !!e.gameLaunchPath?.trim() || !!e.gameUrl?.trim();
        case 'music': return !!e.audioPath?.trim() || !!e.audioUrl?.trim();
        default:
            return (e.links?.length ?? 0) > 0 || (e.episodeFiles?.length ?? 0) > 0 || (e.episodeUrls?.length ?? 0) > 0;
    }
}

/**
 * 「有没有**本地**入口」（⛔ 不含网络地址）—— 只用于**提示文案**分叉：
 * 有本地 ⇒ 说「打开书籍文件 / 通过 .lnk 启动」；只有网络 ⇒ 说「打开在线阅读链接 / 打开网络路径」。
 * ⚠️ 它**不是**可用性判定（可用与否一律看 `hasActionEntry`），⛔ 别拿它当门控 —— 那会把网络地址排除掉。
 */
export function hasLocalEntry(e: {
    type: EntryType;
    links?: WatchLink[];
    episodeFiles?: string[];
    episodeUrls?: string[];
    bookFile?: string;
    gameLaunchPath?: string;
    audioPath?: string;
    readUrl?: string;
    gameUrl?: string;
    audioUrl?: string;
}): boolean {
    switch (e.type) {
        case 'book': return !!e.bookFile?.trim();
        case 'game': return !!e.gameLaunchPath?.trim();
        case 'music': return !!e.audioPath?.trim();
        default: return (e.episodeFiles?.length ?? 0) > 0;
    }
}

/**
 * 🔴 #599 右键菜单里那条**常驻**的关联入口文案（与快捷关联弹窗标题**同一套措辞**）。
 * 为什么单列：这条入口**不论有没有关联都在**（有入口时主操作是「观看 / 阅读 / 启动 / 播放」⇒ 改关联只剩它一条路），
 * 文案必须与弹窗标题一模一样 —— 两处各写一份必然漂，故收在这里当**唯一真源**。
 *
 * 🔴 #602 用户裁定：**四类统一叫「关联入口」**（原话：「海报墙右键菜单的关联本地音频 / 关联本地书籍文件等
 *    统一改成『关联入口』」）⇒ #599 那套按类型分叉（书 = 关联书籍文件 / 游戏 = 关联启动快捷方式 /
 *    音乐 = 关联本地音频 / 影视 = 关联观看入口）**整体退场**。两条理由：
 *    ⑴ 那是**同一个动作**（打开同一张关联窗），四类给四个名字，用户每换一类都要重认一遍；
 *    ⑵ 旧名只说了一半 —— 那张窗里「网络地址」与「本地路径」**两条路都在**，书叫「关联书籍文件」、
 *       却照样能填在线阅读链接，名字与事实不符。
 * ⚠️ 形参 `type` **刻意保留**（调用点照旧传条目类型）：将来若真按类分叉，只改这一处即可 ——
 *    ⛔ 别在组件里另写条件，也⛔ 别删这个形参（删了反而把「要不要分叉」这个决策点挪到了调用点）。
 */
export function associateMenuLabel(_type: EntryType): string {
    return '关联入口';
}

/**
 * 入口不可用时「怎么办」提示（右键菜单 title；点击直达那张快捷关联弹窗）。
 * 🔴 #602：四类都指向**同一条**入口、**同一套措辞**（`associateMenuLabel`）—— 旧文案里那四个名字一并退场。
 */
export function actionUnavailableHint(type: EntryType): string {
    switch (type) {
        case 'book': return '未关联书籍文件 — 点「关联入口」选本地文件或填在线阅读链接';
        case 'game': return '未关联启动快捷方式 — 点「关联入口」选 .lnk 文件或填网络路径';
        case 'music': return '未关联本地音频 — 点「关联入口」选音频文件或填网络地址';
        default: return '无观看链接/本地视频 — 点「关联入口」补录网络地址或本地视频';
    }
}

/**
 * 入口可用时主操作提示（右键菜单 title）：按类型给**实际会发生的动作**。
 * 🔴 #535：第二参 `hasLocal`（缺省 true）区分「开本地文件」还是「开网络地址」 ——
 *    只有网络地址时仍写「打开书籍文件」是在骗人（配合 `hasLocalEntry` 用）。
 */
export function actionReadyHint(type: EntryType, hasLocal: boolean = true): string {
    switch (type) {
        case 'book': return hasLocal ? '打开书籍文件（内置/外部阅读器）' : '打开在线阅读链接（浏览器）';
        case 'game': return hasLocal ? '通过 .lnk 快捷方式启动游戏' : '打开网络路径（商店页 / 官网）';
        case 'music': return hasLocal ? '播放本地音频' : '打开网络地址（浏览器）';
        default: return '打开观看源（本地视频优先播放 / 网络浏览器打开）';
    }
}

/**
 * 右键菜单主操作标题：**一律只有动词本身**（观看 / 阅读 / 启动 / 播放）。
 *
 * 🔴 #599：不可用时原先写成「观看 · 去关联」—— 那时**根本没有可去的东西**，字面与事实不符；
 *    且「关联」这件事已经由右键菜单里那条**常驻**的入口承担（`associateMenuLabel`）。
 *    ⇒ 后缀整条去掉；不可用时点它仍是打开那张关联窗（进路不变），差别只在 `data-tip`
 *      （`actionUnavailableHint` 会给出去哪一条的指引）。
 * ⚠️ 返回值的两种状态**看起来一样**是**刻意的** —— ⛔ 别再加回「去关联 / ·未关联」这类后缀。
 * ⚠️ 形参保留 `e`（调用点传整条目）：将来若真需要按状态分叉，改这一处即可，⛔ 别在组件里另写条件。
 */
export function actionMenuTitle(e: {
    type: EntryType;
    links?: WatchLink[];
    episodeFiles?: string[];
    episodeUrls?: string[];
    bookFile?: string;
    gameLaunchPath?: string;
    audioPath?: string;
    readUrl?: string;
    gameUrl?: string;
}): string {
    return actionVerb(e.type);
}
