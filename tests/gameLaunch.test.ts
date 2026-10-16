import { describe, expect, it } from 'vitest';
import { GAME_LAUNCH_EXTS, extOfFile, isGameLaunchPath } from 'pure/gameLaunch';

describe('#534 游戏「检索本地」：可启动文件判据', () => {
    it('取扩展名（小写，不含点）', () => {
        expect(extOfFile('Steam.lnk')).toBe('lnk');
        expect(extOfFile('Game.EXE')).toBe('exe');
        expect(extOfFile('  Hollow Knight.lnk  ')).toBe('lnk');
        expect(extOfFile('noext')).toBe('');
        expect(extOfFile('trailing.')).toBe('');
        expect(extOfFile('.hidden')).toBe(''); // 点开头 = 无扩展名，别把它当扩展名
        expect(extOfFile('')).toBe('');
    });

    it('可启动文件：lnk / exe / bat / cmd / app / sh 都认（大小写不敏感）', () => {
        for (const ext of GAME_LAUNCH_EXTS) {
            expect(isGameLaunchPath(`Some Game.${ext}`)).toBe(true);
            expect(isGameLaunchPath(`Some Game.${ext.toUpperCase()}`)).toBe(true);
        }
    });

    it('🔴 非可启动文件一律不认（书籍 / 影音 / 图片 / 目录名都不能被当成游戏）', () => {
        for (const n of ['攻略.txt', '封面.png', '原声.mp3', '影片.mp4', '存档.zip', 'readme.md', '无扩展名', '']) {
            expect(isGameLaunchPath(n)).toBe(false);
        }
    });

    it('🔴 与书籍那套**不共用**扩展名集合（各判各的，⛔ 别互相借用）', () => {
        // 书籍扩展名（epub/pdf/txt…）不该被游戏判据认下
        expect(isGameLaunchPath('三体.epub')).toBe(false);
        expect(isGameLaunchPath('三体.pdf')).toBe(false);
        // 游戏扩展名也不在书籍集合里
        expect(GAME_LAUNCH_EXTS.includes('epub')).toBe(false);
        expect(GAME_LAUNCH_EXTS.includes('pdf')).toBe(false);
    });
});
