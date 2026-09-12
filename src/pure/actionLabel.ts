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

/** 主操作入口可用判定：影视=观看链接/本地剧集/网络地址任一；书籍=bookFile；游戏=gameLaunchPath；音乐=audioPath */
export function hasActionEntry(e: { type: EntryType; links?: WatchLink[]; episodeFiles?: string[]; episodeUrls?: string[]; bookFile?: string; gameLaunchPath?: string; audioPath?: string }): boolean {
    switch (e.type) {
        case 'book': return !!e.bookFile;
        case 'game': return !!e.gameLaunchPath;
        case 'music': return !!e.audioPath;
        default:
            return (e.links?.length ?? 0) > 0 || (e.episodeFiles?.length ?? 0) > 0 || (e.episodeUrls?.length ?? 0) > 0;
    }
}

/** 入口不可用时「去关联」提示（右键菜单 · 后缀 / title；点击直达快捷关联弹窗） */
export function actionUnavailableHint(type: EntryType): string {
    switch (type) {
        case 'book': return '未关联书籍文件 — 点「阅读 · 去关联」选择 TXT/EPUB/PDF';
        case 'game': return '未关联启动快捷方式 — 点「启动 · 去关联」选择 .lnk 文件';
        case 'music': return '未关联本地音频 — 点「播放 · 去关联」选择音频文件';
        default: return '无观看链接/本地视频 — 点「观看 · 去关联」补录网络地址或本地视频';
    }
}

/** 入口可用时主操作提示（右键菜单 title）：按类型给实际动作描述 */
export function actionReadyHint(type: EntryType): string {
    switch (type) {
        case 'book': return '打开书籍文件（内置/外部阅读器）';
        case 'game': return '通过 .lnk 快捷方式启动游戏';
        case 'music': return '播放本地音频';
        default: return '打开观看源（本地视频优先播放 / 网络浏览器打开）';
    }
}

/** 右键菜单主操作标题：可用=动词本身；不可用=动词 · 去关联 */
export function actionMenuTitle(e: { type: EntryType; links?: WatchLink[]; episodeFiles?: string[]; episodeUrls?: string[]; bookFile?: string; gameLaunchPath?: string; audioPath?: string }): string {
    return hasActionEntry(e) ? actionVerb(e.type) : `${actionVerb(e.type)} · 去关联`;
}
