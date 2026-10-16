import { describe, expect, it } from 'vitest';
import { BILI_THUMB_SUFFIX, EP_COVER_GAP_MS, biliThumbUrl, planEpCover } from 'pure/epCover';

// ────────────────────── #577 B 站封面 → 缩略图 ──────────────────────
// 用户（2026-10-09）：「**缩略图截取**：B站直链必须加上 `@320w_200h_1c.webp` 后缀拿缩略图，
// **禁止直接使用原图**。」
describe('#577 biliThumbUrl（挂缩略图后缀）', () => {
    const SRC = 'https://i0.hdslb.com/bfs/archive/abc.jpg';

    it('🔴 后缀就是用户点名的那一串（钉具体值，⛔ 不是「以 @ 开头」这种相对判断）', () => {
        expect(BILI_THUMB_SUFFIX).toBe('@320w_200h_1c.webp');
        expect(biliThumbUrl(SRC)).toBe(`${SRC}${BILI_THUMB_SUFFIX}`);
    });

    it('http 也照挂（`normalizeBiliCover` 已提到 https，这里不挑协议）', () => {
        expect(biliThumbUrl('http://i0.hdslb.com/bfs/archive/a.jpg')).toBe(
            `http://i0.hdslb.com/bfs/archive/a.jpg${BILI_THUMB_SUFFIX}`,
        );
    });

    it('🔴 **幂等**：已带图床处理参数（路径段里有 `@`）⇒ 原样返回（叠成 `a.jpg@x@y` 图床判非法）', () => {
        const done = `${SRC}${BILI_THUMB_SUFFIX}`;
        expect(biliThumbUrl(done)).toBe(done);
        expect(biliThumbUrl('https://i0.hdslb.com/bfs/archive/a.jpg@80w_80h.webp')).toBe(
            'https://i0.hdslb.com/bfs/archive/a.jpg@80w_80h.webp',
        );
    });

    it('🔴 后缀插在 **query / hash 之前** —— 拼到最尾会变成 query 值的一部分（图床认不出）', () => {
        expect(biliThumbUrl(`${SRC}?v=2`)).toBe(`${SRC}${BILI_THUMB_SUFFIX}?v=2`);
        expect(biliThumbUrl(`${SRC}#frag`)).toBe(`${SRC}${BILI_THUMB_SUFFIX}#frag`);
    });

    it('非 http(s)（空串 / 空白 / 本地相对路径）⇒ **原样返回**，⛔ 不给本地文件瞎挂图床参数', () => {
        expect(biliThumbUrl('')).toBe('');
        expect(biliThumbUrl('   ')).toBe('');
        expect(biliThumbUrl(undefined)).toBe('');
        expect(biliThumbUrl(null)).toBe('');
        expect(biliThumbUrl('封面/a.jpg')).toBe('封面/a.jpg');
    });

    it('🔴 **不带时间戳**：产物里不允许出现 `Date.now` / `?t=` 这类破 HTTP 缓存的写法', () => {
        // 反向守卫的性质由断言侧（产物锁）再兜一道；这里钉的是纯函数本身够纯（同样输入 ⇒ 同样输出）
        expect(biliThumbUrl(SRC)).toBe(biliThumbUrl(SRC));
    });
});

// ────────────────────── #577 封面计划（本地优先） ──────────────────────
describe('#577 planEpCover（本地优先 → 网络图 → 占位图）', () => {
    it('🔴 **本地优先**（与全仓「本地恒在最前」同口径）：两者都有 ⇒ 出本地首帧，⛔ 不是网络图', () => {
        expect(planEpCover('app://abc/x.mp4', 'https://i0.hdslb.com/a.jpg')).toEqual({
            kind: 'video',
            src: 'app://abc/x.mp4',
        });
    });

    it('只有网络图 ⇒ `img`（B 站缩略图那条路）', () => {
        expect(planEpCover('', 'https://i0.hdslb.com/a.jpg@320w_200h_1c.webp')).toEqual({
            kind: 'img',
            src: 'https://i0.hdslb.com/a.jpg@320w_200h_1c.webp',
        });
    });

    it('🔴 都没有 / 全是空白 ⇒ **统一占位图**（⛔ 不显示破图、不编假地址）', () => {
        expect(planEpCover()).toEqual({ kind: 'none' });
        expect(planEpCover(undefined, undefined)).toEqual({ kind: 'none' });
        expect(planEpCover('   ', '\t')).toEqual({ kind: 'none' });
        expect(planEpCover('', '')).toEqual({ kind: 'none' });
    });

    it('入参两侧都 trim（宿主传进来的可能是空白串）', () => {
        expect(planEpCover('  app://a/b.mp4  ')).toEqual({ kind: 'video', src: 'app://a/b.mp4' });
        expect(planEpCover('', '  https://i0.hdslb.com/a.jpg  ')).toEqual({
            kind: 'img',
            src: 'https://i0.hdslb.com/a.jpg',
        });
    });
});

describe('#577 EP_COVER_GAP_MS（串行限速）', () => {
    it('🔴 必须是**正数**：调成 0 就等于不限速，52 集一起打必然吃 B 站风控（412）', () => {
        expect(Number.isFinite(EP_COVER_GAP_MS)).toBe(true);
        expect(EP_COVER_GAP_MS).toBeGreaterThan(0);
    });
});
