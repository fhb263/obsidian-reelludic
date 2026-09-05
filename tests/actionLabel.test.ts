import { describe, it, expect } from 'vitest';
import { actionVerb, actionIcon, actionAriaLabel, hasActionEntry, actionUnavailableHint, actionMenuTitle } from 'pure/actionLabel';
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
});

describe('actionLabel 不可用提示', () => {
    it('各类型「去关联」提示文案', () => {
        expect(actionUnavailableHint('book')).toContain('书籍文件');
        expect(actionUnavailableHint('game')).toContain('快捷方式');
        expect(actionUnavailableHint('music')).toContain('音频');
        expect(actionUnavailableHint('movie')).toContain('链接');
    });

    it('右键菜单标题：可用=动词本身；不可用=动词 + 去关联提示', () => {
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'book', bookFile: 'a.txt' })).toBe('阅读');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'book' })).toContain('去关联');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'game', gameLaunchPath: 'a.lnk' })).toBe('启动');
        expect(actionMenuTitle({ ...({} as MediaEntry), type: 'music' })).toContain('去关联');
    });
});
