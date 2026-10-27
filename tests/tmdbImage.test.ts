import { describe, it, expect } from 'vitest';
import { posterUrl } from 'pure/tmdbImage';

// P1-8 守卫：posterUrl 必须在 pure 层可用（零 import），
// 否则 `pure/searchDisplay` 会被迫反向值导入 `services/tmdb`，分层再次被穿透。
describe('pure/tmdbImage 封面地址拼接（P1-8 分层守卫）', () => {
    it('默认档位 w500', () => {
        expect(posterUrl('/x.jpg')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
    });

    it('可指定档位（w200 / original）', () => {
        expect(posterUrl('/x.jpg', 'w200')).toBe('https://image.tmdb.org/t/p/w200/x.jpg');
        expect(posterUrl('/x.jpg', 'original')).toBe('https://image.tmdb.org/t/p/original/x.jpg');
    });

    it('空 / undefined ⇒ undefined（⛔ 不返回 half-baked 的 CDN 前缀）', () => {
        expect(posterUrl(undefined)).toBeUndefined();
        expect(posterUrl('')).toBeUndefined();
    });

    it('⛔ 不做「是否已是绝对 URL」判断 —— 绝对 URL 由调用方分流，本函数只拼接', () => {
        // 历史事实：`pure/searchDisplay.ts:322-330` 里 omdb/douban 的绝对 URL 走自己的分支
        // 直接透传，只有 TMDB 一类才进 posterUrl。这条断言锁住「本函数不加猜形态的分支」，
        // 否则调用方那套分流会与本函数的分支互相打架。
        expect(posterUrl('https://img.example.com/p.jpg', 'w500')).toBe(
            'https://image.tmdb.org/t/p/w500https://img.example.com/p.jpg',
        );
    });
});
