import { describe, it, expect } from 'vitest';
import {
    TRASH_FILE_NAME,
    TRASH_FILE_NAME_LEGACY,
    TRASH_KEEP,
    collectTrashFiles,
    fromLibraryRelative,
    normalizeTrashRecords,
    parseTrashFile,
    pushTrashRecord,
    restoreEntryFor,
    serializeTrashFile,
    toLibraryRelative,
    type TrashFile,
    type TrashRecord,
} from 'pure/entryTrash';
import { createEmptyEntry } from 'data/types';

const LIB = 'ReelLudic';

function entry(over: Record<string, unknown> = {}): any {
    return { ...createEmptyEntry({ title: '测试条目' }), ...over };
}

function record(over: Partial<TrashRecord> = {}): TrashRecord {
    return { deletedAt: '2026-10-06T10:00:00.000Z', entry: entry(), ...over };
}

// 「条目还原」：记住最近删除的 5 条条目（设置页 › 封面与清理），可一键复活。
describe('条目回收站（条目还原）', () => {
    it('🔴 文件名是英文 `trash.json`（用户 2026-10-22：中文文件名 → 英文）', () => {
        expect(TRASH_FILE_NAME).toBe('trash.json');
        // 旧名只许出现在迁移常量里 —— 它被固定成中文原文，迁移才认得出要搬的文件
        expect(TRASH_FILE_NAME_LEGACY).toBe('条目回收站.json');
        expect(TRASH_FILE_NAME).not.toBe(TRASH_FILE_NAME_LEGACY);
    });

    it('🔴 只保留最近 TRASH_KEEP 条，且新的在前', () => {
        expect(TRASH_KEEP).toBe(5);
        let file: TrashFile = { version: 1, records: [] };
        for (let i = 0; i < 8; i++) {
            file = pushTrashRecord(file, record({ deletedAt: `2026-10-0${i + 1}T00:00:00.000Z`, entry: entry({ id: `e_${i}` }) }));
        }
        expect(file.records).toHaveLength(5);
        expect(file.records[0].entry.id).toBe('e_7');
        expect(file.records[4].entry.id).toBe('e_3');
    });

    it('坏 JSON / 非对象 → 空表（⛔ 不抛，坏文件不该让设置页打不开）', () => {
        expect(parseTrashFile('not json').records).toEqual([]);
        expect(parseTrashFile('[]').records).toEqual([]);
        expect(parseTrashFile('{"records":5}').records).toEqual([]);
    });

    it('逐条校验：缺 deletedAt / 缺 entry.id / 缺 title 的记录丢弃，合法记录保留顺序', () => {
        const raw = [
            { deletedAt: '2026-10-01T00:00:00.000Z', entry: { id: 'a', title: 'A' } },
            { deletedAt: 'oops', entry: { id: 'b', title: 'B' } },
            { deletedAt: '2026-10-02T00:00:00.000Z', entry: { id: '', title: 'C' } },
            { deletedAt: '2026-10-03T00:00:00.000Z', entry: { id: 'd' } },
            { deletedAt: '2026-10-04T00:00:00.000Z', entry: { id: 'e', title: 'E' }, files: ['封面/e.jpg', 3] },
        ];
        expect(normalizeTrashRecords(raw)).toEqual([
            { deletedAt: '2026-10-01T00:00:00.000Z', entry: { id: 'a', title: 'A' }, files: undefined },
            { deletedAt: '2026-10-04T00:00:00.000Z', entry: { id: 'e', title: 'E' }, files: ['封面/e.jpg'] },
        ]);
    });

    it('序列化 → 解析往返稳定，且写出的文本能被 JSON.parse', () => {
        const file = pushTrashRecord({ version: 1, records: [] }, record({ files: ['封面/a.jpg'] }));
        const text = serializeTrashFile(file);
        expect(JSON.parse(text).records[0].files).toEqual(['封面/a.jpg']);
        expect(parseTrashFile(text)).toEqual(file);
    });

    it('库内相对路径换算：只去库目录前缀，绝对路径与空串一律 undefined（⛔ 不碰库外文件）', () => {
        expect(toLibraryRelative('ReelLudic/封面/a.jpg', LIB)).toBe('封面/a.jpg');
        expect(toLibraryRelative('封面/a.jpg', LIB)).toBe('封面/a.jpg');
        expect(toLibraryRelative('ReelLudic', LIB)).toBeUndefined();
        expect(toLibraryRelative('D:/Media/a.mp4', LIB)).toBeUndefined();
        expect(toLibraryRelative('/home/u/a.mp4', LIB)).toBeUndefined();
        expect(toLibraryRelative(undefined, LIB)).toBeUndefined();
        expect(toLibraryRelative('ReelLudic/笔记/x.md', 'ReelLudic/')).toBe('笔记/x.md');
    });

    it('相对 → 库内路径（封面字段存的就是相对库目录，⛔ 别重复加前缀）', () => {
        expect(fromLibraryRelative('封面/a.jpg', LIB)).toBe('ReelLudic/封面/a.jpg');
        expect(fromLibraryRelative('封面/a.jpg', 'ReelLudic/')).toBe('ReelLudic/封面/a.jpg');
        // 封面字段本身是相对库目录的：entryAssetPlan 拼 `{lib}/{poster}` 只拼一次
        expect(fromLibraryRelative('封面/a.jpg', LIB).split('ReelLudic').length).toBe(2);
    });

    it('collectTrashFiles：封面（相对库目录）补库前缀、阅读存档原样、库外媒体丢弃、去重保序', () => {
        const e = entry({
            poster: '封面/封面.jpg',
            bookFile: 'ReelLudic/书籍/x.epub',
            audioPath: 'D:/Music/a.mp3',
            episodeFiles: ['ReelLudic/视频/e1.mp4', 'ReelLudic/视频/e1.mp4'],
        });
        // 全部统一成 vault 全路径（与 EntryAsset.path 同一坐标系），删除时可直接拿去 getAbstractFileByPath
        expect(collectTrashFiles(e, LIB, ['ReelLudic/阅读进度/书-阅读-e_1.json'])).toEqual([
            'ReelLudic/封面/封面.jpg',
            'ReelLudic/阅读进度/书-阅读-e_1.json',
            'ReelLudic/书籍/x.epub',
            'ReelLudic/视频/e1.mp4',
        ]);
    });

    it('collectTrashFiles：网络封面不算本地文件', () => {
        expect(collectTrashFiles(entry({ poster: 'https://x/y.jpg' }), LIB)).toEqual([]);
    });

    it('原 id 空闲 → 原样复活（只刷 updatedAt）', () => {
        const rec = record({ entry: entry({ id: 'e_9_zzzz', notePath: 'ReelLudic/笔记/movie/A.md' }) });
        const { entry: out, sameId } = restoreEntryFor(rec, ['e_1_aaaa'], new Date('2026-10-07T00:00:00.000Z'));
        expect(sameId).toBe(true);
        expect(out.id).toBe('e_9_zzzz');
        expect(out.notePath).toBe('ReelLudic/笔记/movie/A.md');
        expect(out.updatedAt).toBe('2026-10-07T00:00:00.000Z');
    });

    it('原 id 被占用 → 换新 id + 笔记换名（⛔ 不覆盖现存文件）', () => {
        const rec = record({ entry: entry({ id: 'e_9_zzzz', notePath: 'ReelLudic/笔记/movie/A.md', noteFingerprint: 'abc' }) });
        const { entry: out, sameId } = restoreEntryFor(rec, ['e_9_zzzz'], new Date(2026, 9, 7));
        expect(sameId).toBe(false);
        expect(out.id).not.toBe('e_9_zzzz');
        expect(out.id).toMatch(/^e_\d+_[a-z0-9]{4}$/);
        expect(out.notePath).toBe(`ReelLudic/笔记/movie/A-${out.id}.md`);
        expect(out.noteFingerprint).toBeUndefined();
    });
});
