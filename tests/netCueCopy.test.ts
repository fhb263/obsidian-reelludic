import { describe, expect, it } from 'vitest';
import { isAuthFailReason, netCueEmptyCopy, netCuePlatform } from 'pure/netCueCopy';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const YT_SHORT = 'https://youtu.be/dQw4w9WgXcQ';
const BILI = 'https://www.bilibili.com/video/BV1y7JazfEF3';

/**
 * 🔴 用户 2026-11-11（m06406 ④）逐字要求字幕面板区分两种状态：
 *    ① 未填 / 失效 Cookie →「未能获取到本集字幕」+ 指路去重填；
 *    ② Cookie 有效但解析失败 →「字幕加载失败」。
 *    并**删掉**「去 B站/Youtube 看这集」按钮。
 *
 * 这组断言守的就是「两种状态不许再塌成一种」+「按钮不许回来」。
 */
describe('netCueEmptyCopy — 两种失败状态', () => {
    it('没填 Cookie：说「未能获取到本集字幕」+ 指向设置里的凭据组', () => {
        const c = netCueEmptyCopy(BILI, 'no-cookie');
        expect(c.title).toBe('未能获取到本集字幕');
        expect(c.state).toBe('auth');
        expect(c.desc).toContain('B站');
        expect(c.desc).toContain('Cookie 已失效');
        expect(c.desc).toContain('设置 > 搜索配置 > 网络播放源凭据 > B站');
    });

    it('Cookie 失效：与「没填」同一套话（用户该做的事一样）', () => {
        const c = netCueEmptyCopy(BILI, 'cookie-invalid');
        expect(c.title).toBe('未能获取到本集字幕');
        expect(c.state).toBe('auth');
    });

    it('Cookie 正常但解析不出轨：说「字幕加载失败」，⛔ 不许提 Cookie', () => {
        for (const reason of ['no-track', 'other'] as const) {
            const c = netCueEmptyCopy(BILI, reason);
            expect(c.title).toBe('字幕加载失败');
            expect(c.state).toBe('parse');
            expect(c.desc).toContain('未能解析出字幕轨');
            expect(c.desc).not.toContain('Cookie');
            expect(c.desc).not.toContain('设置 >');
        }
    });

    it('宿主没给原因（null/undefined）：按「解析失败」渲染，不冤枉用户的 Cookie', () => {
        for (const reason of [null, undefined]) {
            const c = netCueEmptyCopy(BILI, reason);
            expect(c.title).toBe('字幕加载失败');
            expect(c.state).toBe('parse');
        }
    });

    it('两种状态的标题必须真的不同（否则界面等于没改）', () => {
        const auth = netCueEmptyCopy(BILI, 'no-cookie');
        const parse = netCueEmptyCopy(BILI, 'no-track');
        expect(auth.title).not.toBe(parse.title);
        expect(auth.desc).not.toBe(parse.desc);
    });

    it('YouTube 集：通篇说 YouTube，不许漏出「B站」', () => {
        const c = netCueEmptyCopy(YT, 'no-cookie');
        expect(c.desc).toContain('YouTube');
        expect(c.desc).not.toContain('B站');
        expect(c.desc).toContain('设置 > 搜索配置 > 网络播放源凭据 > YouTube');
    });

    it('youtu.be 短链同判为 YouTube', () => {
        const c = netCueEmptyCopy(YT_SHORT, 'cookie-invalid');
        expect(c.desc).toContain('YouTube');
        expect(c.desc).not.toContain('B站');
    });

    it('🔴 出口按钮必须彻底退场（用户明确要求删掉「去 B站/Youtube 看这集」）', () => {
        for (const u of [YT, BILI]) {
            for (const reason of ['no-cookie', 'cookie-invalid', 'no-track', 'other'] as const) {
                const c = netCueEmptyCopy(u, reason);
                // 结构上就没有 btn 字段了 —— 这条用 key 断言，防止有人「顺手」加回来
                expect(Object.keys(c).sort()).toEqual(['desc', 'state', 'title']);
                expect(JSON.stringify(c)).not.toContain('看这一集');
            }
        }
    });

    it('拿不到 url（空串/undefined/非链接）时按 B站 兜底，不许抛', () => {
        for (const bad of ['', undefined, null, 123, 'not-a-url']) {
            const c = netCueEmptyCopy(bad, 'no-cookie');
            expect(c.desc).toContain('B站');
            expect(c.title).toBe('未能获取到本集字幕');
        }
    });
});

describe('isAuthFailReason — 哪些原因该让用户去改 Cookie', () => {
    it('no-cookie / cookie-invalid 是认证类', () => {
        expect(isAuthFailReason('no-cookie')).toBe(true);
        expect(isAuthFailReason('cookie-invalid')).toBe(true);
    });

    it('no-track / other / 缺失 都不是', () => {
        expect(isAuthFailReason('no-track')).toBe(false);
        expect(isAuthFailReason('other')).toBe(false);
        expect(isAuthFailReason(null)).toBe(false);
        expect(isAuthFailReason(undefined)).toBe(false);
    });
});

describe('netCuePlatform', () => {
    it('两站各归各的', () => {
        expect(netCuePlatform(YT)).toBe('YouTube');
        expect(netCuePlatform(BILI)).toBe('B 站');
        expect(netCuePlatform('')).toBe('B 站');
    });
});
