import { describe, it, expect } from 'vitest';
import { buildOrphanAssets, entryAssetPlan, entryIdFromStoreFile, orphanStoreFiles } from 'pure/orphanAssets';

// #349：把「清理孤儿封面」扩成「附件清理」——除了封面目录，还要能清**阅读进度目录**里
// 已经没有对应条目的存档（用户报障：「无法有效清理或删除被遗弃的附件与封面」）。
describe('孤儿资产判定（#349）', () => {
    describe('entryIdFromStoreFile（从「阅读进度」目录的文件名解析条目 id）', () => {
        it('认现行存档名 {书名}-阅读-{id}.json', () => {
            expect(entryIdFromStoreFile('百年孤独-阅读-e_12_ab34.json')).toBe('e_12_ab34');
        });

        it('认旧进度名 {书名}-阅读进度-{id}.json', () => {
            expect(entryIdFromStoreFile('百年孤独-阅读进度-e_12_ab34.json')).toBe('e_12_ab34');
        });

        it('认旧书签名 {书名}-书签-{id}.json', () => {
            expect(entryIdFromStoreFile('百年孤独-书签-e_12_ab34.json')).toBe('e_12_ab34');
        });

        it('认最早期的纯 id 名（含 .bookmarks.json 变体）', () => {
            expect(entryIdFromStoreFile('e_12_ab34.json')).toBe('e_12_ab34');
            expect(entryIdFromStoreFile('e_12_ab34.bookmarks.json')).toBe('e_12_ab34');
        });

        it('书名里带「-」时取**最后一个**标记之后的段', () => {
            expect(entryIdFromStoreFile('我-的-书-阅读-e_12_ab34.json')).toBe('e_12_ab34');
        });

        it('🔴 认不出的名字一律 undefined（⛔ 宁可不判，也不误删用户文件）', () => {
            expect(entryIdFromStoreFile('随便一个文件.json')).toBeUndefined();
            expect(entryIdFromStoreFile('笔记.md')).toBeUndefined();
            expect(entryIdFromStoreFile('-阅读-.json')).toBeUndefined();
            expect(entryIdFromStoreFile('')).toBeUndefined();
        });
    });

    describe('orphanStoreFiles', () => {
        it('id 不在 liveIds → 孤儿；在 → 保留', () => {
            const files = ['A-阅读-e_1_aaaa.json', 'B-阅读-e_2_bbbb.json'];
            expect(orphanStoreFiles(files, ['e_2_bbbb'])).toEqual(['A-阅读-e_1_aaaa.json']);
        });

        it('🔴 认不出的文件**不算孤儿**（宁可留着，也不误删）', () => {
            expect(orphanStoreFiles(['说明.txt', 'X-阅读-e_1_aaaa.json'], [])).toEqual(['X-阅读-e_1_aaaa.json']);
        });

        it('全部命中 → 空数组；空输入 → 空数组', () => {
            expect(orphanStoreFiles(['A-阅读-e_1_aaaa.json'], ['e_1_aaaa'])).toEqual([]);
            expect(orphanStoreFiles([], ['e_1_aaaa'])).toEqual([]);
        });
    });

    describe('buildOrphanAssets（汇总给清理弹窗）', () => {
        it('封面在前、阅读存档在后；path 带目录前缀、name 取末段', () => {
            const out = buildOrphanAssets({
                coverFiles: ['封面/旧图.jpg', '封面/在用.jpg'],
                referencedPosters: ['封面/在用.jpg'],
                storeFiles: ['阅读进度/A-阅读-e_1_aaaa.json', '阅读进度/B-阅读-e_2_bbbb.json'],
                liveIds: ['e_2_bbbb'],
            });
            expect(out.map((a) => a.kind)).toEqual(['cover', 'store']);
            expect(out[0]).toEqual({ kind: 'cover', path: '封面/旧图.jpg', name: '旧图.jpg' });
            expect(out[1].path).toBe('阅读进度/A-阅读-e_1_aaaa.json');
            expect(out[1].name).toBe('A-阅读-e_1_aaaa.json');
        });

        it('没有孤儿 → 空数组', () => {
            expect(buildOrphanAssets({ coverFiles: [], referencedPosters: [], storeFiles: [], liveIds: [] })).toEqual([]);
        });

        it('封面口径沿用「未被任何条目引用」（URL 封面不参与比对）', () => {
            const out = buildOrphanAssets({
                coverFiles: ['封面/用完就扔.jpg'],
                referencedPosters: ['https://img.example.com/a.jpg'],
                storeFiles: [],
                liveIds: [],
            });
            expect(out.map((a) => a.path)).toEqual(['封面/用完就扔.jpg']);
        });
    });
});

// #403：删除条目时要能**连带删掉这条的音频附件**（用户：「删除条目时，支持关联删除对应的附件音频文件」）。
// 在此之前 `entryAssetPlan` 只收书文件与剧集文件 —— 音乐条目的「本地音频」（含下载来的歌）根本不在清单里，
// 于是删条目时那个 mp3 会被遗弃在库里、且弹窗里也没有勾选项。
describe('entryAssetPlan（删除条目的资产计划）', () => {
    const base = { id: 'e_1', title: '示例条目' };
    const none = () => false;

    it('🔴 本地音频进「媒体文件」队（vault 相对路径 → 可勾选删除，risk=risky 默认不勾）', () => {
        const out = entryAssetPlan({
            entry: { ...base, audioPath: '下载/音乐/a.mp3' },
            libraryDir: 'ReelLudic',
            exists: (p) => p === '下载/音乐/a.mp3',
        });
        expect(out).toEqual([
            { kind: 'media', path: '下载/音乐/a.mp3', name: 'a.mp3', risk: 'risky', deletable: true },
        ]);
    });

    it('🔴 文件不存在 ⇒ 不进清单（宁可不删，也不留一条点了会失败的勾选项）', () => {
        const out = entryAssetPlan({ entry: { ...base, audioPath: '下载/音乐/没了.mp3' }, libraryDir: 'ReelLudic', exists: none });
        expect(out).toEqual([]);
    });

    it('🔴 库外音频（绝对路径）只展示、不可删（deletable:false + 提示，⛔ 本插件不碰库外文件）', () => {
        const out = entryAssetPlan({ entry: { ...base, audioPath: 'D://Music//a.mp3' }, libraryDir: 'ReelLudic', exists: none });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            kind: 'media',
            name: 'a.mp3',
            risk: 'risky',
            deletable: false,
            hint: '库外文件，请在文件管理器中自行删除',
        });
    });

    it('媒体队顺序固定 = 书 → 音频 → 剧集（弹窗逐项展示，顺序不能随字段来源漂）', () => {
        const out = entryAssetPlan({
            entry: {
                ...base,
                bookFile: '书/T.epub',
                audioPath: '下载/音乐/T.mp3',
                episodeFiles: ['影/T.S01E01.mp4', '影/T.S01E02.mp4'],
            },
            libraryDir: 'ReelLudic',
            exists: () => true,
        });
        expect(out.filter((a) => a.kind === 'media').map((a) => a.path)).toEqual([
            '书/T.epub',
            '下载/音乐/T.mp3',
            '影/T.S01E01.mp4',
            '影/T.S01E02.mp4',
        ]);
    });

    it('安全项顺序 = 笔记 → 封面 → 阅读存档 → 书签文件（安全项恒在媒体项之前）', () => {
        const out = entryAssetPlan({
            entry: { ...base, notePath: '笔记/示例条目.md', poster: '封面/示例条目.jpg', audioPath: '下载/音乐/T.mp3' },
            libraryDir: 'ReelLudic',
            exists: () => true,
        });
        const kinds = out.map((a) => a.kind);
        expect(kinds.indexOf('note')).toBe(0);
        expect(kinds.indexOf('cover')).toBe(1);
        expect(kinds.indexOf('media')).toBe(kinds.length - 1);
        expect(out[0].risk).toBe('safe');
        expect(out[kinds.length - 1].risk).toBe('risky');
    });

    it('封面是**网络 URL** 时不算本地文件（⛔ 不把 URL 当路径去删）', () => {
        const out = entryAssetPlan({ entry: { ...base, poster: 'https://example.com/a.jpg' }, libraryDir: 'ReelLudic', exists: () => true });
        expect(out.some((a) => a.kind === 'cover')).toBe(false);
    });
});
