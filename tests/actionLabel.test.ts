import { describe, it, expect } from 'vitest';
import { actionVerb, actionIcon, actionAriaLabel, hasActionEntry, hasLocalEntry, actionUnavailableHint, actionReadyHint, actionMenuTitle, associateMenuLabel } from 'pure/actionLabel';
import type { EntryType, MediaEntry } from 'data/types';

describe('actionLabel 动词映射（各库应用场景一致）', () => {
    it('影视类=观看 / 书籍=阅读 / 游戏=启动 / 音乐=播放', () => {
        expect(actionVerb('movie')).toBe('观看');
        expect(actionVerb('tv')).toBe('观看');
        expect(actionVerb('anime')).toBe('观看');
        expect(actionVerb('book')).toBe('阅读');
        expect(actionVerb('game')).toBe('启动');
        expect(actionVerb('music')).toBe('播放');
    });

    it('aria-label 与动词一致', () => {
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as EntryType[]) {
            expect(actionAriaLabel(t)).toBe(actionVerb(t));
        }
    });

    it('图标：书籍 book-open（阅读语义），其余 play', () => {
        expect(actionIcon('book')).toBe('book-open');
        expect(actionIcon('movie')).toBe('play');
        expect(actionIcon('game')).toBe('play');
        expect(actionIcon('music')).toBe('play');
    });
});

describe('actionLabel 主操作入口判定 hasActionEntry', () => {
    const base: MediaEntry = {
        id: 'e1', type: 'movie', title: 'T', status: 'want', rating: 0,
        genres: [], cast: [], links: [], notes: '', tags: [],
        createdAt: '', updatedAt: '',
    };

    it('影视：有 links / episodeFiles / episodeUrls 任一即可用', () => {
        expect(hasActionEntry({ ...base, type: 'movie', links: [{ label: 'a', url: 'https://x' }] })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'tv', episodeFiles: ['a.mp4'] })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'anime', episodeUrls: ['https://x'] })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'movie' })).toBe(false);
    });

    it('书籍：有 bookFile 才可用', () => {
        expect(hasActionEntry({ ...base, type: 'book', bookFile: '书籍/三体.txt' })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'book' })).toBe(false);
    });

    it('游戏：有 gameLaunchPath 才可用', () => {
        expect(hasActionEntry({ ...base, type: 'game', gameLaunchPath: '游戏.lnk' })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'game' })).toBe(false);
    });

    it('音乐：有 audioPath 才可用', () => {
        expect(hasActionEntry({ ...base, type: 'music', audioPath: '歌.mp3' })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'music' })).toBe(false);
    });

    // 🔴 #601：音乐**网络地址**（`audioUrl`，append-only 新字段）也算可用入口 —— 与 `main.playAudioEntry`
    //    的浏览器兜底**同口径**（判可用与真能执行必须一致，⛔ 别造一条点了没反应的死入口）；
    //    ⚠️ 但它**不算「本地入口」**（`hasLocalEntry` 只管本地音频）。
    it('🔴 音乐：只填了 audioUrl（无本地音频）也算有入口，但不算本地入口', () => {
        expect(hasActionEntry({ ...base, type: 'music', audioUrl: 'https://music.example/x' })).toBe(true);
        expect(hasLocalEntry({ ...base, type: 'music', audioUrl: 'https://music.example/x' })).toBe(false);
        expect(hasLocalEntry({ ...base, type: 'music', audioPath: '歌.mp3' })).toBe(true);
    });

    // 🔴 #535（用户报障：「书籍填了网络链接怎么海报墙没显示阅读按钮」）：
    //    `hasActionEntry` 原先对 book 只看 `bookFile`、对 game 只看 `gameLaunchPath`，
    //    ⇒ 只填了网络地址的条目在海报墙 / 右键菜单里**不给主操作按钮**（卡片右下角与右键「阅读 · 去关联」都判定为不可用）。
    it('书籍：只填了 readUrl（无本地文件）也算有入口', () => {
        expect(hasActionEntry({ ...base, type: 'book', readUrl: 'https://weread.qq.com/web/reader/abc' })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'book', bookFile: '', readUrl: '' })).toBe(false);
    });

    it('游戏：只填了 gameUrl（无 .lnk）也算有入口（#534 加 gameUrl 时漏同步这条判定）', () => {
        expect(hasActionEntry({ ...base, type: 'game', gameUrl: 'https://store.example/1' })).toBe(true);
        expect(hasActionEntry({ ...base, type: 'game', gameLaunchPath: '', gameUrl: '' })).toBe(false);
    });

    it('空串不算入口（⛔ 别用 `in` / 存在性判断 —— 空串会被当成有值）', () => {
        expect(hasActionEntry({ ...base, type: 'book', readUrl: '   ' })).toBe(false);
        expect(hasActionEntry({ ...base, type: 'game', gameUrl: '' })).toBe(false);
    });
});

describe('actionLabel 本地入口判定 hasLocalEntry（提示文案分叉用）', () => {
    const base = { type: 'book' } as MediaEntry;

    it('书籍：只有网络地址时本地入口仍为 false（⇒ 提示要写「在线阅读」而不是「打开书籍文件」）', () => {
        expect(hasLocalEntry({ ...base, type: 'book', bookFile: '三体.txt' })).toBe(true);
        expect(hasLocalEntry({ ...base, type: 'book', readUrl: 'https://x' })).toBe(false);
    });

    it('游戏：只有网络路径时本地入口仍为 false', () => {
        expect(hasLocalEntry({ ...base, type: 'game', gameLaunchPath: 'a.lnk' })).toBe(true);
        expect(hasLocalEntry({ ...base, type: 'game', gameUrl: 'https://x' })).toBe(false);
    });

    it('影视：本地剧集才算本地入口（网络地址不算）', () => {
        expect(hasLocalEntry({ ...base, type: 'tv', episodeFiles: ['1.mp4'] })).toBe(true);
        expect(hasLocalEntry({ ...base, type: 'tv', episodeUrls: ['https://x'] })).toBe(false);
    });
});

describe('actionLabel 可用提示随「有没有本地入口」分叉（#535）', () => {
    it('书籍：有本地=打开阅读器；只有网络=打开在线阅读链接', () => {
        expect(actionReadyHint('book', true)).toContain('阅读器');
        expect(actionReadyHint('book', false)).toContain('在线阅读');
        expect(actionReadyHint('book', false)).not.toContain('阅读器');
    });

    it('游戏：有本地=快捷方式启动；只有网络=打开网络路径', () => {
        expect(actionReadyHint('game', true)).toContain('快捷方式');
        expect(actionReadyHint('game', false)).toContain('网络路径');
    });

    it('缺省第二参 = 有本地（⛔ 别让既有调用点的文案变）', () => {
        expect(actionReadyHint('book')).toBe(actionReadyHint('book', true));
        expect(actionReadyHint('music')).toContain('音频');
    });
});

describe('actionLabel 不可用提示', () => {
    it('各类型不可用提示指向那条**常驻**的关联入口（#602：四类都叫「关联入口」）', () => {
        // 🔴 #602 翻面 #599：四类措辞统一 —— 提示里那一句**必须与菜单项 / 弹窗标题同字**（`关联入口`）
        for (const t of ['book', 'game', 'music', 'movie', 'tv', 'anime'] as const) {
            expect(actionUnavailableHint(t)).toContain('关联入口');
        }
        // 前半句仍是各类型自己的「缺什么」，别一起被抹平
        expect(actionUnavailableHint('book')).toContain('未关联书籍文件');
        expect(actionUnavailableHint('game')).toContain('未关联启动快捷方式');
        expect(actionUnavailableHint('music')).toContain('未关联本地音频');
        // 🔴 反向守卫：四种提示里都不许再出现「去关联」（那时候根本没有可去的东西）
        for (const t of ['book', 'game', 'music', 'movie'] as const) {
            expect(actionUnavailableHint(t)).not.toContain('去关联');
        }
    });

    it('关联入口文案**四类同一句**（#602：与快捷关联弹窗标题同一真源，⛔ 不再按类型分叉）', () => {
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as const) {
            expect(associateMenuLabel(t)).toBe('关联入口');
        }
        // 🔴 反向守卫：#599 那四个旧名**一个都不许回来**（否则菜单项与弹窗标题又会漂）
        for (const t of ['movie', 'book', 'game', 'music'] as const) {
            expect(associateMenuLabel(t)).not.toContain('关联书籍文件');
            expect(associateMenuLabel(t)).not.toContain('关联启动快捷方式');
            expect(associateMenuLabel(t)).not.toContain('关联本地音频');
            expect(associateMenuLabel(t)).not.toContain('关联观看入口');
        }
    });

    it('🔴 #599 右键菜单标题**一律只有动词**（可用/不可用同形，⛔ 不许再加后缀）', () => {
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'book', bookFile: 'a.txt' })).toBe('阅读');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'book' })).toBe('阅读');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'game', gameLaunchPath: 'a.lnk' })).toBe('启动');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'music' })).toBe('播放');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'tv' })).toBe('观看');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'tv', episodeUrls: ['u'] })).toBe('观看');
    });
});
