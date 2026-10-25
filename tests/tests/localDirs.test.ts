// 分类本地目录真源（pure/localDirs）单测 — #562
// 规则表：
//  - 七个键 ↔ 三个分组（阅读 3 / 视频 3 / 音乐 1）；音乐复用既有 musicDownloadDir（⛔ 不新建第二份）；
//  - 条目 → 目录键：书籍按子分类走（缺省/非法 → 文学），游戏无本地目录（null）；
//  - 目录值 → 系统绝对路径：绝对路径原样、相对路径拼 vault base；两者缺一 ⇒ undefined（⛔ 不拼半个路径）。
import { describe, it, expect } from 'vitest';
import {
    LOCAL_DIR_KEYS,
    LOCAL_DIR_LABELS,
    LOCAL_DIR_GROUPS,
    LOCAL_DIR_FIELD,
    localDirOf,
    localDirKeyFor,
    resolveLocalDirAbs,
} from 'pure/localDirs';

describe('LOCAL_DIR_KEYS / LABELS / GROUPS 三表一致', () => {
    it('键集合 = 三个分组成员之并（不重不漏）', () => {
        const inGroups = [...LOCAL_DIR_GROUPS.reader, ...LOCAL_DIR_GROUPS.video, ...LOCAL_DIR_GROUPS.music];
        expect([...inGroups].sort()).toEqual([...LOCAL_DIR_KEYS].sort());
        expect(new Set(inGroups).size).toBe(inGroups.length);
    });

    it('分组成员顺序（设置页子面板渲染顺序的真源）', () => {
        expect(LOCAL_DIR_GROUPS.reader).toEqual(['book', 'novel', 'comic']);
        expect(LOCAL_DIR_GROUPS.video).toEqual(['movie', 'tv', 'anime']);
        expect(LOCAL_DIR_GROUPS.music).toEqual(['music']);
    });

    it('每个键都有标题，且音乐那一档的字段就是 musicDownloadDir（复用而非新建）', () => {
        for (const k of LOCAL_DIR_KEYS) expect(LOCAL_DIR_LABELS[k]).toBeTruthy();
        expect(LOCAL_DIR_FIELD.music).toBe('musicDownloadDir');
        expect(LOCAL_DIR_LABELS.music).toBe('音乐目录');
    });
});

describe('localDirKeyFor：条目 → 本地目录键', () => {
    it('影视三档按类型直取', () => {
        expect(localDirKeyFor('tv')).toBe('tv');
        expect(localDirKeyFor('anime')).toBe('anime');
        expect(localDirKeyFor('movie')).toBe('movie');
    });

    it('书籍按子分类走；缺省 / 非法 / 空一律归「文学」', () => {
        expect(localDirKeyFor('book', 'novel')).toBe('novel');
        expect(localDirKeyFor('book', 'comic')).toBe('comic');
        expect(localDirKeyFor('book', 'book')).toBe('book');
        expect(localDirKeyFor('book', undefined)).toBe('book');
        expect(localDirKeyFor('book', 'whatever')).toBe('book');
        expect(localDirKeyFor('book', null)).toBe('book');
    });

    it('音乐有目录；游戏**没有**（⛔ 不为对称硬造一个）', () => {
        expect(localDirKeyFor('music')).toBe('music');
        expect(localDirKeyFor('game')).toBeNull();
    });
});

describe('localDirOf：读设置值', () => {
    it('各键读各自字段，两头空白一律去掉（复制路径常带）', () => {
        expect(localDirOf({ localDirTv: '  D:/剧集  ' }, 'tv')).toBe('D:/剧集');
        expect(localDirOf({ localDirNovel: '下载/网文' }, 'novel')).toBe('下载/网文');
    });

    it('音乐读的是 musicDownloadDir（复用既有字段）', () => {
        expect(localDirOf({ musicDownloadDir: '下载/音乐' }, 'music')).toBe('下载/音乐');
    });

    it('未配置 / 非字符串 ⇒ 空串（⛔ 不返回 undefined 让调用方到处判空）', () => {
        expect(localDirOf({}, 'comic')).toBe('');
        expect(localDirOf({ localDirComic: undefined }, 'comic')).toBe('');
    });
});

describe('resolveLocalDirAbs：目录值 → 系统绝对路径', () => {
    it('Windows 盘符 / POSIX 绝对路径原样返回（尾斜杠先去掉）', () => {
        expect(resolveLocalDirAbs('C:/vault', 'D:\\媒体\\剧集')).toBe('D:\\媒体\\剧集');
        expect(resolveLocalDirAbs('C:/vault', 'D:/媒体/剧集/')).toBe('D:/媒体/剧集');
        expect(resolveLocalDirAbs('C:/vault', '/mnt/media/tv')).toBe('/mnt/media/tv');
    });

    it('库内相对路径拼 vault base（尾斜杠不重复）', () => {
        expect(resolveLocalDirAbs('C:/vault/', '媒体/剧集')).toBe('C:/vault/媒体/剧集');
        expect(resolveLocalDirAbs('C:/vault', '媒体/剧集')).toBe('C:/vault/媒体/剧集');
    });

    it('值为空 / base 拿不到（而值又是相对路径）⇒ undefined（⛔ 别拼出 `/<dir>` 去扫系统根）', () => {
        expect(resolveLocalDirAbs('C:/vault', '   ')).toBeUndefined();
        expect(resolveLocalDirAbs('', '媒体/剧集')).toBeUndefined();
        // 但绝对路径不依赖 base —— base 缺失也照样能用
        expect(resolveLocalDirAbs('', 'D:/媒体')).toBe('D:/媒体');
    });
});
