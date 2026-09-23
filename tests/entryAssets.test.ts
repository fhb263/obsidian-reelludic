import { describe, it, expect } from 'vitest';
import { ENTRY_ASSET_LABEL, entryAssetPlan } from 'pure/orphanAssets';

// #350（M3/M4）：删除条目时，勾选清单要**先说清会删什么**——条目记录 / 笔记 / 封面 / 阅读存档 / 书签文件
// （+ 高级里的媒体文件，默认不勾）。本模块只产**计划**（纯逻辑），DOM 与删除由弹窗/宿主负责。
const LIB = 'ReelLudic';
const entry = {
    id: 'e_1_aaaa',
    title: '百年孤独',
    notePath: 'ReelLudic/笔记/书籍/百年孤独.md',
    poster: '封面/bg.jpg',
    bookFile: 'ReelLudic/书籍/百年孤独.epub',
};
const allExists = () => true;

describe('entryAssetPlan（删除条目的资产计划，#350）', () => {
    it('按 note → cover → store → bookmark → media 的固定顺序产出，且各带类型标签', () => {
        const out = entryAssetPlan({ entry, libraryDir: LIB, exists: allExists });
        expect(out.map((a) => a.kind)).toEqual(['note', 'cover', 'store', 'bookmark', 'media']);
        expect(out.map((a) => ENTRY_ASSET_LABEL[a.kind])).toEqual(['笔记', '封面', '阅读存档', '书签文件', '媒体文件']);
    });

    it('笔记 / 封面 / 阅读存档 / 书签文件默认勾选（safe）；媒体文件默认不勾（risky，用户自己的资产）', () => {
        const out = entryAssetPlan({ entry, libraryDir: LIB, exists: allExists });
        const checked = out.filter((a) => a.risk === 'safe').map((a) => a.kind);
        expect(checked).toEqual(['note', 'cover', 'store', 'bookmark']);
        expect(out.find((a) => a.kind === 'media')?.risk).toBe('risky');
    });

    it('路径按既有单一真源拼（阅读存档 / 书签文件名 helper，不另写一套）', () => {
        const out = entryAssetPlan({ entry, libraryDir: LIB, exists: allExists });
        const byKind = Object.fromEntries(out.map((a) => [a.kind, a.path]));
        expect(byKind.store).toBe('ReelLudic/阅读进度/百年孤独-阅读-e_1_aaaa.json');
        expect(byKind.bookmark).toBe('ReelLudic/阅读进度/百年孤独-书签-e_1_aaaa.json');
        expect(byKind.cover).toBe('ReelLudic/封面/bg.jpg');
        expect(byKind.media).toBe('ReelLudic/书籍/百年孤独.epub');
    });

    it('name 取路径末段（弹窗里显示文件名，⛔ 不显示全路径）', () => {
        const out = entryAssetPlan({ entry, libraryDir: LIB, exists: allExists });
        expect(out.map((a) => a.name)).toEqual([
            '百年孤独.md',
            'bg.jpg',
            '百年孤独-阅读-e_1_aaaa.json',
            '百年孤独-书签-e_1_aaaa.json',
            '百年孤独.epub',
        ]);
    });

    it('🔴 不存在的文件不出现在清单里（条目没有笔记 / 没下过封面时不该列出来）', () => {
        const out = entryAssetPlan({
            entry: { id: 'e_1_aaaa', title: '百年孤独' },
            libraryDir: LIB,
            exists: () => false,
        });
        expect(out).toEqual([]);
    });

    it('封面是网络 URL → 不是本地文件，不列入（⛔ 别把 URL 当路径去删）', () => {
        const out = entryAssetPlan({
            entry: { ...entry, poster: 'https://img.example.com/a.jpg' },
            libraryDir: LIB,
            exists: allExists,
        });
        expect(out.some((a) => a.kind === 'cover')).toBe(false);
    });

    it('🔴 库外媒体文件只展示、不提供删除（risky + deletable=false + 提示自行在文件管理器处理）', () => {
        const out = entryAssetPlan({
            entry: { ...entry, bookFile: 'D:/媒体/百年孤独.epub' },
            libraryDir: LIB,
            exists: () => false,
        });
        const media = out.find((a) => a.kind === 'media');
        expect(media).toBeDefined();
        expect(media?.risk).toBe('risky'); // ⛔ 标成 safe 就会被默认勾选（媒体永不默认删）
        expect(media?.deletable).toBe(false);
        expect(media?.hint).toContain('库外');
    });

    it('多集媒体：每集一项（顺序与 episodeFiles 一致），且**库内**媒体是可删的（deletable=true，无「库外」提示）', () => {
        const out = entryAssetPlan({
            entry: { id: 'e_2_bbbb', title: '剧集', episodeFiles: ['ReelLudic/视频/01.mp4', 'ReelLudic/视频/02.mp4'] },
            libraryDir: LIB,
            exists: allExists,
        });
        const media = out.filter((a) => a.kind === 'media');
        expect(media.map((a) => a.name)).toEqual(['01.mp4', '02.mp4']);
        expect(media.every((a) => a.deletable && a.hint === undefined)).toBe(true);
    });

    it('libraryDir 为空 → 存档路径回退 ReelLudic（与存档路径 helper 同口径）', () => {
        const store = entryAssetPlan({
            entry: { id: 'e_1_aaaa', title: '百年孤独' },
            libraryDir: '',
            exists: allExists,
        }).find((a) => a.kind === 'store');
        expect(store?.path).toBe('ReelLudic/阅读进度/百年孤独-阅读-e_1_aaaa.json');
    });
});
