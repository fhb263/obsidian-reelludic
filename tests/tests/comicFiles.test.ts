import { describe, expect, it } from 'vitest';
import {
    COMIC_ARCHIVE_EXTS,
    COMIC_IMAGE_EXTS,
    comicArchiveLabel,
    comicExt,
    comicPageText,
    isComicArchiveEntry,
    isComicArchivePath,
    isComicImageName,
    naturalCompare,
    sortComicPages,
} from 'pure/comicFiles';

describe('#537 漫画文件判据', () => {
    it('取扩展名（小写、去参数、无扩展名空串）', () => {
        expect(comicExt('a/第01话.PNG')).toBe('png');
        expect(comicExt('a/b.cbz?x=1')).toBe('cbz');
        expect(comicExt('C:\\comics\\book.CBZ')).toBe('cbz');
        expect(comicExt('noext')).toBe('');
        expect(comicExt('trailing.')).toBe('');
        expect(comicExt('')).toBe('');
    });

    it('图片判据：png/jpg/jpeg/webp/gif/avif/bmp 都认，大小写不敏感', () => {
        for (const ext of COMIC_IMAGE_EXTS) {
            expect(isComicImageName(`page.${ext}`)).toBe(true);
            expect(isComicImageName(`page.${ext.toUpperCase()}`)).toBe(true);
        }
    });

    it('🔴 隐藏文件（含 .DS_Store）不算漫画页', () => {
        expect(isComicImageName('.DS_Store')).toBe(false);
        expect(isComicImageName('dir/.hidden.png')).toBe(false);
        expect(isComicImageName('')).toBe(false);
    });

    it('非图片不算页（txt / xml / 无扩展名）', () => {
        for (const n of ['readme.txt', 'ComicInfo.xml', 'cover.pdf', 'noext', 'a.mp4']) {
            expect(isComicImageName(n)).toBe(false);
        }
    });

    it('压缩包判据：仅 cbz/zip/cbt/tar（🔴 rar/7z 不在本批零依赖档）', () => {
        for (const ext of COMIC_ARCHIVE_EXTS) expect(isComicArchivePath(`x.${ext.toUpperCase()}`)).toBe(true);
        for (const n of ['x.cbr', 'x.rar', 'x.cb7', 'x.7z', 'x.mobi', 'x.azw3', 'x.epub', 'x.pdf']) {
            expect(isComicArchivePath(n)).toBe(false);
        }
    });

    it('归档格式短名（未知回落大写）', () => {
        expect(comicArchiveLabel('a/b.cbz')).toBe('CBZ');
        expect(comicArchiveLabel('a/b.CBT')).toBe('CBT');
        expect(comicArchiveLabel('a/b.xyz')).toBe('XYZ');
    });

    it('🔴 归档项过滤：目录项 / 隐藏 / macOS 资源叉 / 非图片一律不算页', () => {
        expect(isComicArchiveEntry('001.jpg')).toBe(true);
        expect(isComicArchiveEntry('sub/002.png')).toBe(true);
        expect(isComicArchiveEntry('sub/')).toBe(false); // 目录项
        expect(isComicArchiveEntry('__MACOSX/._001.jpg')).toBe(false); // macOS 资源叉
        expect(isComicArchiveEntry('a/__MACOSX/x.png')).toBe(false);
        expect(isComicArchiveEntry('._001.jpg')).toBe(false);
        expect(isComicArchiveEntry('.hidden.png')).toBe(false);
        expect(isComicArchiveEntry('ComicInfo.xml')).toBe(false); // 元数据不算页
        expect(isComicArchiveEntry('')).toBe(false);
    });
});

describe('#537 漫画页自然序', () => {
    it('自然序：p2 在 p10 前（字典序会反过来）', () => {
        expect(['p10.jpg', 'p2.jpg', 'p1.jpg'].sort(naturalCompare)).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
    });

    it('前导零：01 < 1（数值相等时短者在前），且不破坏整体顺序', () => {
        expect(naturalCompare('01.jpg', '1.jpg')).toBeLessThan(0);
        expect(['2.jpg', '10.jpg', '1.jpg'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
    });

    it('大小写 / 非数字段按字典序', () => {
        expect(naturalCompare('a.jpg', 'b.jpg')).toBeLessThan(0);
        expect(naturalCompare('same.jpg', 'same.jpg')).toBe(0);
    });

    it('sortComicPages 返回新数组、按 name 排序、不改入参', () => {
        const src = [{ name: '10.jpg' }, { name: '2.jpg' }, { name: '1.jpg' }];
        const out = sortComicPages(src);
        expect(out.map((x) => x.name)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
        expect(src.map((x) => x.name)).toEqual(['10.jpg', '2.jpg', '1.jpg']); // 原数组不动
    });

    it('底栏页码文本（0 基入参 → 1 基展示；越界钳制；无页回落破折号）', () => {
        expect(comicPageText(0, 5)).toBe('第 1 / 5 页');
        expect(comicPageText(4, 5)).toBe('第 5 / 5 页');
        expect(comicPageText(99, 5)).toBe('第 5 / 5 页');
        expect(comicPageText(-3, 5)).toBe('第 1 / 5 页');
        expect(comicPageText(0, 0)).toBe('第 — 页');
    });
});
