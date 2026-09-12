import { describe, expect, it } from 'vitest';
import { shouldAdoptCover } from 'pure/posterPolicy';

describe('pure/posterPolicy shouldAdoptCover（重新拉取封面采用策略）', () => {
    it('本地封面保留：非 http 当前值一律不采用远程封面（防重复下载 -2/-3）', () => {
        expect(shouldAdoptCover('封面/海阔天空.jpg', 'https://img.doubanio.com/f.jpg')).toBe(false);
        expect(shouldAdoptCover('封面/xx-2.jpg', 'https://img.doubanio.com/f.jpg')).toBe(false);
    });

    it('当前为空或远程 URL 时采用新封面（首次添加 / 从未本地化的条目照常回填）', () => {
        expect(shouldAdoptCover(undefined, 'https://img.doubanio.com/f.jpg')).toBe(true);
        expect(shouldAdoptCover('', 'https://img.doubanio.com/f.jpg')).toBe(true);
        expect(shouldAdoptCover('https://img.doubanio.com/old.jpg', 'https://img.doubanio.com/new.jpg')).toBe(true);
    });

    it('无新封面时不采用（不把当前值清掉）', () => {
        expect(shouldAdoptCover('封面/xx.jpg', undefined)).toBe(false);
        expect(shouldAdoptCover(undefined, undefined)).toBe(false);
        expect(shouldAdoptCover(undefined, null)).toBe(false);
    });
});
