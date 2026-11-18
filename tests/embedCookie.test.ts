/**
 * 官方内嵌 iframe 的 Cookie 同步 —— 解析层回归锁。
 *
 * 🔴 事故背景（2026-10-31 用户报障「B站/油管内嵌的怎么还有登录，不上填了 cookie 吗」）：
 *    设置里填的 Cookie 只喂插件自己的 API；官方内嵌 iframe 读的是 Electron 的 cookie jar，
 *    两边从来没打通。修法是把设置里那串写进 jar（`syncEmbedCookies`）。
 *
 * ⚠️ 这里只测**解析**（不碰 Electron）：写库那半段需要真机，由 `tools/probe-embed-cookie.mjs` 验。
 *    但解析恰恰是最容易出事的一层 —— 历史上「只按 `;` 切串」让浏览器扩展导出的 JSON
 *    被整批丢弃，用户填了 Cookie 等于没填，且**没有任何报错**。
 */
import { describe, expect, it } from 'vitest';
import { cookieDomainAccepted, parseEmbedCookies } from '../src/services/embedCookie';

describe('parseEmbedCookies —— 两种真实形态都要认', () => {
    it('裸请求头形态（开发者工具复制）：按第一个 = 切，值里的 = 不能丢', () => {
        const out = parseEmbedCookies('SESSDATA=abc%2C123; bili_jct=xyz==; DedeUserID=42', '.bilibili.com');
        expect(out.map((c) => c.name)).toEqual(['SESSDATA', 'bili_jct', 'DedeUserID']);
        expect(out[0].value).toBe('abc%2C123');
        // ⚠️ base64 值本身带 `=`，只按第一个 = 切才不会截断
        expect(out[1].value).toBe('xyz==');
        expect(out.every((c) => c.domain === '.bilibili.com')).toBe(true);
        // 裸头形态无法得知过期时间 ⇒ 会话 cookie（expiry 0 ⇒ 不传 expirationDate）
        expect(out.every((c) => c.expiry === 0)).toBe(true);
    });

    it('JSON 数组形态（浏览器扩展导出）：逐字段取真值', () => {
        const raw = JSON.stringify([
            {
                domain: '.youtube.com',
                name: '__Secure-1PSID',
                value: 'v1',
                path: '/',
                secure: true,
                expirationDate: 1827460746.987,
            },
            { domain: 'www.youtube.com', name: 'PREF', value: 'v2', path: '/', secure: false },
        ]);
        const out = parseEmbedCookies(raw, '.youtube.com');
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({
            domain: '.youtube.com',
            name: '__Secure-1PSID',
            secure: true,
            // 浮点秒必须取整（Chromium 只收整数）
            expiry: 1827460746,
        });
        // hostOnly 的域要原样保留，⛔ 不能补成 `.www.youtube.com`
        expect(out[1].domain).toBe('www.youtube.com');
        expect(out[1].secure).toBe(false);
        expect(out[1].expiry).toBe(0);
    });

    it('单个对象（不是数组）也认', () => {
        const out = parseEmbedCookies('{"name":"SID","value":"x","domain":".youtube.com"}', '.youtube.com');
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('SID');
    });

    it('值带引号 ⇒ 去掉首尾引号', () => {
        const out = parseEmbedCookies('a="quoted value"', '.bilibili.com');
        expect(out[0].value).toBe('quoted value');
    });

    it('空串 / 纯空白 ⇒ 空数组（⛔ 别拿空值去覆盖用户已有的登录态）', () => {
        expect(parseEmbedCookies('', '.bilibili.com')).toEqual([]);
        expect(parseEmbedCookies('   ', '.bilibili.com')).toEqual([]);
    });

    it('坏 JSON / 半截 JSON ⇒ 空数组，不抛', () => {
        expect(parseEmbedCookies('[{"name":"a"', '.youtube.com')).toEqual([]);
        expect(parseEmbedCookies('{oops}', '.youtube.com')).toEqual([]);
    });

    it('脏条目一律跳过：无 name、非对象、null', () => {
        const raw = JSON.stringify([
            { name: '', value: 'x' },
            { value: 'x' },
            null,
            'string',
            42,
            { name: 'SID', value: 'keep' },
        ]);
        const out = parseEmbedCookies(raw, '.youtube.com');
        expect(out.map((c) => c.name)).toEqual(['SID']);
    });

    it('缺 domain/path 时回落 fallback，path 恒有值', () => {
        const out = parseEmbedCookies(JSON.stringify([{ name: 'SID', value: 'x' }]), '.bilibili.com');
        expect(out[0].domain).toBe('.bilibili.com');
        expect(out[0].path).toBe('/');
    });

    it('裸头里没 = 的段落跳过，不产生垃圾条目', () => {
        const out = parseEmbedCookies('novalue; ok=1; =empty', '.bilibili.com');
        expect(out.map((c) => c.name)).toEqual(['ok']);
    });

    // 🔴🔴 这一组是 2026-10-31 第二次报障的回归锁。
    //    事故：cookie 写进了 jar（33 条、域/路径/secure 全对），但官方内嵌 iframe
    //    发出的真实请求头里 `Cookie` 长度 = 0 ⇒ 内嵌里永远未登录。
    //    根因：写入时没读 sameSite，Chromium 默认落成 `lax`，
    //         而 Lax cookie 在**跨站 iframe**里一律不发送。
    describe('sameSite 必须是 no_restriction（否则跨站 iframe 收不到）', () => {
        it('裸头形态（无 sameSite 元信息）⇒ no_restriction', () => {
            const out = parseEmbedCookies('SESSDATA=abc', '.bilibili.com');
            expect(out[0].sameSite).toBe('no_restriction');
        });

        it('JSON 缺 sameSite 字段 ⇒ 也按 no_restriction（不能默认成 lax）', () => {
            const out = parseEmbedCookies(JSON.stringify([{ name: 'SESSDATA', value: 'x' }]), '.bilibili.com');
            expect(out[0].sameSite).toBe('no_restriction');
        });

        it('显式 sameSite=None / no_restriction / unspecified ⇒ 归一成 no_restriction', () => {
            for (const v of ['None', 'none', 'no_restriction', 'unspecified', '', null]) {
                const raw = JSON.stringify([{ name: 'SESSDATA', value: 'x', sameSite: v }]);
                const out = parseEmbedCookies(raw, '.bilibili.com');
                expect(out[0].sameSite, `sameSite=${String(v)}`).toBe('no_restriction');
            }
        });

        it('显式 lax / strict 原样保留（用户的明确选择不被改写）', () => {
            const raw = JSON.stringify([
                { name: 'a', value: '1', sameSite: 'lax' },
                { name: 'b', value: '2', sameSite: 'Strict' },
            ]);
            const out = parseEmbedCookies(raw, '.bilibili.com');
            expect(out[0].sameSite).toBe('lax');
            expect(out[1].sameSite).toBe('strict');
        });

        it('httpOnly 原样带过去（SESSDATA 在浏览器里是 HttpOnly）', () => {
            const raw = JSON.stringify([{ name: 'SESSDATA', value: 'x', httpOnly: true }]);
            const out = parseEmbedCookies(raw, '.bilibili.com');
            expect(out[0].httpOnly).toBe(true);
        });
    });

/**
 * 🔴 2026-11-25 用户报障：「配置 cookie 都不能播放 youtube 内嵌视频？提示要登录」
 *
 * 真因不在解析层，而在**域白名单**：`syncEmbedCookies` 原来用 `/youtube\.com$/`
 * 过滤，而 YouTube 的登录令牌（`SID` / `SAPISID` / `__Secure-1PSID` …）在浏览器
 * 扩展导出的 JSON 里 `domain` 是 **`.google.com`** ⇒ 整批被丢掉，只写进去
 * `PREF` / `VISITOR_INFO1_LIVE` 这类非登录 cookie ⇒ iframe 里永远未登录。
 *
 * ⚠️ 这一组锁的是 `cookieDomainAccepted` 本身的判据。⛔ 别把判据写回
 *    内联正则（那样各自漂，且没有回归锁）。
 */
describe('cookieDomainAccepted —— YouTube 登录取 google.com 的域', () => {
    it('YouTube 登录令牌所在的 google.com 域必须收（含子域、含前导点）', () => {
        expect(cookieDomainAccepted('yt', '.google.com')).toBe(true);
        expect(cookieDomainAccepted('yt', 'google.com')).toBe(true);
        expect(cookieDomainAccepted('yt', '.accounts.google.com')).toBe(true);
    });

    it('youtube.com 自身的域照收（hostOnly 与通配两种写法）', () => {
        expect(cookieDomainAccepted('yt', '.youtube.com')).toBe(true);
        expect(cookieDomainAccepted('yt', 'www.youtube.com')).toBe(true);
    });

    it('nocookie 兜底域也收（墙内重试走它，cookie 是独立一套）', () => {
        expect(cookieDomainAccepted('yt', '.youtube-nocookie.com')).toBe(true);
        expect(cookieDomainAccepted('yt', 'www.youtube-nocookie.com')).toBe(true);
    });

    it('大小写与前导点归一：`.GOOGLE.COM` 也认', () => {
        expect(cookieDomainAccepted('yt', '.GOOGLE.COM')).toBe(true);
        expect(cookieDomainAccepted('bili', '.BILIBILI.COM')).toBe(true);
    });

    it('⛔ 别把「长得像」的域收进来（后缀匹配必须带点边界）', () => {
        // 故意造仿冒域：`evilgoogle.com` 结尾也是 `google.com`，但不是 `.google.com` 的子域
        expect(cookieDomainAccepted('yt', 'evilgoogle.com')).toBe(false);
        expect(cookieDomainAccepted('yt', 'notyoutube.com')).toBe(false);
        expect(cookieDomainAccepted('bili', 'fakebilibili.com')).toBe(false);
        expect(cookieDomainAccepted('yt', '')).toBe(false);
    });

    it('两个 kind 不串门：B 站不认 youtube 的域，反之亦然', () => {
        expect(cookieDomainAccepted('bili', '.youtube.com')).toBe(false);
        expect(cookieDomainAccepted('bili', '.google.com')).toBe(false);
        expect(cookieDomainAccepted('yt', '.bilibili.com')).toBe(false);
    });
    });
});
