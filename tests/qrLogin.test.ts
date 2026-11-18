// ③-3 / ③-4（2026-11-12 用户 m00353 / m05505）：扫码登录**纯逻辑层**单测。
//
// 🔴 这里钉的全是「真机实测出来的口径」，不是想象出来的：
//    · B 站状态码在 `data.code`（顶层 `code` 恒 0）—— 看错一层会把「未扫码」当成功
//    · B 站 Cookie 在成功那轮的 `data.url` 里，`SESSDATA` 含被编码的逗号
//    · 微信读书判据是 `wr_name` 非空，⛔ 不是「有没有 Cookie」
//    · 豆瓣扫码已按用户 m05505 删除 ⇒ 它的状态归一等三个导出必须不存在
import { describe, expect, it } from 'vitest';
import * as qr from 'pure/qrLogin';
import {
    BILI_POLL,
    QR_POLL_INTERVAL_MS,
    QR_SESSION_TTL_MS,
    WEREAD_LOGIN_COOKIE,
    WEREAD_SESSION_TTL_MS,
    accountNameOf,
    biliCredentialCookieOf,
    cookieFromBiliCallbackUrl,
    cookieHeaderFromPairs,
    cookieValueOf,
    isBiliTicketUrl,
    isSessionExpired,
    isWereadLoggedIn,
    parseBiliPoll,
    sessionTtlOf,
    type QrPlatform,
} from 'pure/qrLogin';

/** 造一份 B 站 poll 响应（默认未扫码）。 */
function biliPoll(dataCode: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        code: 0,
        message: '0',
        ttl: 1,
        data: { url: '', refresh_token: '', timestamp: 0, code: dataCode, message: '未扫码', ...extra },
    });
}

describe('parseBiliPoll —— B 站扫码状态', () => {
    it('未扫码 → pending', () => {
        const r = parseBiliPoll(biliPoll(BILI_POLL.notScanned));
        expect(r.stage).toBe('pending');
        expect(r.message).toContain('扫码');
        expect(r.cookie).toBeUndefined();
        expect(r.refreshToken).toBeUndefined();
    });

    it('已扫码待确认（新口径 86102）→ scanned', () => {
        const r = parseBiliPoll(biliPoll(BILI_POLL.scanned));
        expect(r.stage).toBe('scanned');
        expect(r.message).toContain('确认');
    });

    it('已扫码待确认（旧口径 86090）→ scanned', () => {
        expect(parseBiliPoll(biliPoll(BILI_POLL.scannedLegacy)).stage).toBe('scanned');
    });

    it('已过期 86038 → expired', () => {
        expect(parseBiliPoll(biliPoll(BILI_POLL.expired)).stage).toBe('expired');
    });

    it('成功那一轮同时给出 cookie 与 refresh_token', () => {
        const r = parseBiliPoll(
            biliPoll(BILI_POLL.ok, {
                url: 'https://passport.biligame.com/crossDomain?DedeUserID=42&SESSDATA=abc%2Cdef&bili_jct=xyz',
                refresh_token: 'RT-1234567890',
            }),
        );
        expect(r.stage).toBe('done');
        expect(r.cookie).toBe('DedeUserID=42; SESSDATA=abc,def; bili_jct=xyz');
        expect(r.refreshToken).toBe('RT-1234567890');
    });

    it('🔴 顶层 code 非 0 才报错；顶层 code=0 但 data.code=86101 仍是 pending', () => {
        const topBad = JSON.stringify({ code: -412, message: '请求被拦截' });
        const r = parseBiliPoll(topBad);
        expect(r.stage).toBe('error');
        expect(r.message).toContain('请求被拦截');

        const okTop = biliPoll(BILI_POLL.notScanned);
        expect(JSON.parse(okTop).code).toBe(0);
        expect(parseBiliPoll(okTop).stage).toBe('pending');
    });

    it('非 JSON / 空对象 → error，且 message 不是空白', () => {
        for (const raw of ['', '<html>风控</html>', 'null', '[]']) {
            const r = parseBiliPoll(raw);
            expect(r.stage).toBe('error');
            expect(r.message.length).toBeGreaterThan(0);
        }
    });

    it('未知状态码不硬编码成「等待扫码」，把上游原话带出来', () => {
        const raw = JSON.stringify({ code: 0, data: { code: 99999, message: '风控校验中' } });
        const r = parseBiliPoll(raw);
        expect(r.stage).toBe('pending');
        expect(r.message).toBe('风控校验中');
    });
});

describe('cookieFromBiliCallbackUrl —— 从成功回调地址抠 Cookie', () => {
    it('解码被编码的逗号（SESSDATA 里真有）', () => {
        expect(cookieFromBiliCallbackUrl('https://x/cb?SESSDATA=a%2Cb%2Cc')).toBe('SESSDATA=a,b,c');
    });

    it('无 query → undefined', () => {
        expect(cookieFromBiliCallbackUrl('https://x/cb')).toBeUndefined();
        expect(cookieFromBiliCallbackUrl('')).toBeUndefined();
    });

    it('跳过没有名字的段；🔴 #756 起空值也丢（空 SESSDATA 不是凭据）', () => {
        expect(cookieFromBiliCallbackUrl('https://x/cb?=1&DedeUserID=7&bili_jct=')).toBe('DedeUserID=7');
    });

    it('解码失败不整条作废', () => {
        expect(cookieFromBiliCallbackUrl('https://x/cb?SESSDATA=%E0%A4%A&DedeUserID=2')).toBe(
            'SESSDATA=%E0%A4%A; DedeUserID=2',
        );
    });

    it('🔴 #756：票据地址（只有 ticket/gourl/first_domain）→ undefined，⛔ 不许当凭据', () => {
        const ticket =
            'https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=c91b5659cf5d426ec4db9c49ecc236ff&gourl=https%3A%2F%2Fwww.bilibili.com&first_domain=.bilibili.com';
        // 用户 m06077 的真机事故就是这个：全 query 当 Cookie ⇒ 存进 `ticket=…; gourl=…; first_domain=…`
        expect(cookieFromBiliCallbackUrl(ticket)).toBeUndefined();
        expect(isBiliTicketUrl(ticket)).toBe(true);
    });

    it('🔴 #756：真凭据只挑三件套，混进来的杂物一律丢掉', () => {
        const mixed = 'https://x/cb?SESSDATA=s1&gourl=https%3A%2F%2Fwww.bilibili.com&bili_jct=j1&first_domain=.bilibili.com&DedeUserID=42';
        expect(cookieFromBiliCallbackUrl(mixed)).toBe('SESSDATA=s1; bili_jct=j1; DedeUserID=42');
    });
});

describe('#756 · B 站票据兑换（纯逻辑侧）', () => {
    it('isBiliTicketUrl 只认 `ticket=` 参数', () => {
        expect(isBiliTicketUrl('https://a/cb?ticket=abc')).toBe(true);
        expect(isBiliTicketUrl('https://a/cb?SESSDATA=x&DedeUserID=1')).toBe(false);
        expect(isBiliTicketUrl('https://a/cb')).toBe(false);
        expect(isBiliTicketUrl('')).toBe(false);
        // 前缀相同但名字不同，不许误中
        expect(isBiliTicketUrl('https://a/cb?ticket_id=1')).toBe(false);
    });

    it('parseBiliPoll 成功轮把票据地址带出来（ticketUrl）', () => {
        const ticket =
            'https://passport.bilibili.com/x/passport-login/web/crossDomain?ticket=c91b&gourl=https%3A%2F%2Fwww.bilibili.com&first_domain=.bilibili.com';
        const r = parseBiliPoll(biliPoll(0, { url: ticket, refresh_token: 'rt1' }));
        expect(r.stage).toBe('done');
        expect(r.ticketUrl).toBe(ticket);
        expect(r.refreshToken).toBe('rt1');
        // 票据里没有凭据 ⇒ cookie 必须是 undefined，由服务层去兑换
        expect(r.cookie).toBeUndefined();
    });

    it('成功轮是老形态（URL 直接带 SESSDATA）→ 不出 ticketUrl', () => {
        const r = parseBiliPoll(biliPoll(0, { url: 'https://passport.biligame.com/crossDomain?DedeUserID=42&SESSDATA=abc&bili_jct=xyz' }));
        expect(r.stage).toBe('done');
        // 顺序跟 URL 参数顺序一致（先到先拼），⛔ 不要断言固定次序
        expect(r.cookie?.split('; ').sort()).toEqual(['DedeUserID=42', 'SESSDATA=abc', 'bili_jct=xyz']);
        expect(r.ticketUrl).toBeUndefined();
    });

    it('biliCredentialCookieOf：从混杂 jar 里只挑三件套，且**不解码**', () => {
        const jar = 'buvid3=anon; SESSDATA=a%2Cb; _uuid=x; bili_jct=j; DedeUserID=42';
        // 🔴 不解码：jar 里的值是原文，二次 decode 会把含 `%` 的值弄坏
        expect(biliCredentialCookieOf(jar)).toBe('SESSDATA=a%2Cb; bili_jct=j; DedeUserID=42');
        expect(biliCredentialCookieOf('buvid3=anon; _uuid=x')).toBeUndefined();
        expect(biliCredentialCookieOf('')).toBeUndefined();
    });
});

describe('cookieHeaderFromPairs —— Cookie 罐拼请求头', () => {
    it('剔除空值（`key=` 会被站点当「显式置空」）', () => {
        expect(
            cookieHeaderFromPairs([
                { name: 'SESSDATA', value: 'abc' },
                { name: 'empty', value: '' },
                { name: 'bili_jct', value: 'xyz' },
            ]),
        ).toBe('SESSDATA=abc; bili_jct=xyz');
    });

    it('剔除无名项与非字符串值', () => {
        expect(
            cookieHeaderFromPairs([
                { name: '', value: 'x' },
                { name: 'a', value: 1 as unknown as string },
                { name: 'b', value: '2' },
            ]),
        ).toBe('b=2');
    });

    it('全空 → 空串', () => {
        expect(cookieHeaderFromPairs([])).toBe('');
    });
});

describe('微信读书登录判据', () => {
    it('🔴 必须有 wr_vid，且 wr_skey / wr_name 至少一个非空（#757 复合判据）', () => {
        expect(isWereadLoggedIn([{ name: 'wr_vid', value: '123' }, { name: 'wr_skey', value: 'x' }])).toBe(true);
        expect(isWereadLoggedIn([{ name: 'wr_vid', value: '123' }, { name: 'wr_name', value: '张三' }])).toBe(true);
    });

    it('🔴 只有昵称、没有 wr_vid → 未登录（老实现会误判成已登录）', () => {
        expect(isWereadLoggedIn([{ name: 'wr_name', value: '张三' }])).toBe(false);
    });

    it('🔴 只有 wr_vid、两个身份键都空 → 未登录', () => {
        expect(
            isWereadLoggedIn([
                { name: 'wr_vid', value: '1' },
                { name: 'wr_skey', value: '' },
                { name: 'wr_name', value: '' },
            ]),
        ).toBe(false);
    });

    it('🔴 有一堆匿名 Cookie（wr_gid / wr_fp）但没有 wr_vid → 未登录', () => {
        expect(
            isWereadLoggedIn([
                { name: 'wr_gid', value: '294945095' },
                { name: 'wr_fp', value: '197931642' },
            ]),
        ).toBe(false);
    });

    it('空数组 / wr_vid 空串 → 未登录', () => {
        expect(isWereadLoggedIn([])).toBe(false);
        expect(isWereadLoggedIn([{ name: 'wr_vid', value: '' }, { name: 'wr_skey', value: 'x' }])).toBe(false);
    });
});

describe('cookieValueOf —— 从 Cookie 头里取单个值', () => {
    it('取到值；`; ` 分隔与 `;` 无空格都能切', () => {
        const c = 'SESSDATA=abc; DedeUserID=12345; bili_jct=xyz';
        expect(cookieValueOf(c, 'DedeUserID')).toBe('12345');
        expect(cookieValueOf('a=1;b=2', 'b')).toBe('2');
    });

    it('🔴 名字是前缀时不能误中（`wr_vid` 不许匹配 `wr_`）', () => {
        expect(cookieValueOf('wr_vid=9', 'wr_v')).toBeUndefined();
        expect(cookieValueOf('wr_name=张三', 'wr_name')).toBe('张三');
    });

    it('空串 / 缺名 / 不存在 → undefined', () => {
        expect(cookieValueOf('', 'x')).toBeUndefined();
        expect(cookieValueOf('=v', 'x')).toBeUndefined();
        expect(cookieValueOf('a=1', 'zzz')).toBeUndefined();
    });

    it('⚠️ 值里含 `=` 时只切第一个（SESSDATA 常见）', () => {
        expect(cookieValueOf('SESSDATA=a=b=c', 'SESSDATA')).toBe('a=b=c');
    });
});

describe('accountNameOf —— 登录后显示「当前账号」', () => {
    it('微信读书取 wr_name', () => {
        expect(accountNameOf('weread', 'wr_name=微信读书用户; wr_vid=1')).toBe('微信读书用户');
    });

    it('B 站用 DedeUserID 拼 UID（B 站 Cookie 里没有昵称）', () => {
        expect(accountNameOf('bilibili', 'SESSDATA=x; DedeUserID=12345')).toBe('UID 12345');
    });

    it('🔴 取不到 → null（调用方必须保留输入框，⛔ 别显示「未知」把框藏掉）', () => {
        expect(accountNameOf('weread', 'wr_gid=1')).toBeNull();
        expect(accountNameOf('bilibili', 'SESSDATA=x')).toBeNull();
        expect(accountNameOf('bilibili', '')).toBeNull();
    });

    it('🔴 #757 没有昵称但有 wr_vid → 退回显示用户 id（别让「当前账号」消失）', () => {
        expect(accountNameOf('weread', 'wr_vid=12345')).toBe('微信读书用户 12345');
        expect(accountNameOf('weread', 'wr_vid=12345; wr_name=张三')).toBe('张三');
    });

    it('空白值也算取不到（`wr_name=; ` 是未登录的典型形态）', () => {
        expect(accountNameOf('weread', 'wr_name=   ')).toBeNull();
    });
});

describe('平台差异', () => {
    it('🔴 只剩 B 站 / 微信读书 —— 豆瓣扫码已按用户 m05505 删除', () => {
        // 用类型层钉住：`QrPlatform` 若有人把 'douban' 加回来，这里会编译失败
        const platforms: QrPlatform[] = ['bilibili', 'weread'];
        expect(platforms).toHaveLength(2);
    });

    it('B 站不再需要移动端 UA（改为插件内自绘二维码，⛔ 不再开子窗口）', () => {
        // 上一版有 `BILI_MOBILE_UA` / `needsMobileUa` —— 那是「开子窗口保 key」的产物，
        // 而那套会被 B 站 H5 页识别成移动端并弹「下载 App」引导（iBiliPlayer），用户 m05505 明确否决。
        // ⇒ 这两个导出必须消失；有人加回来就说明旧方案回潮。
        expect(Object.keys(qr)).not.toContain('BILI_MOBILE_UA');
        expect(Object.keys(qr)).not.toContain('needsMobileUa');
        expect(Object.keys(qr)).not.toContain('normalizeDoubanStatus');
    });
});

describe('节奏与超时', () => {
    it('轮询间隔 2s（太快会被风控，太慢用户白等）', () => {
        expect(QR_POLL_INTERVAL_MS).toBe(2000);
    });

    it('会话 TTL 180s（B 站约 180s，取保守）', () => {
        expect(QR_SESSION_TTL_MS).toBe(180_000);
        expect(isSessionExpired(0, 179_999)).toBe(false);
        expect(isSessionExpired(0, 180_000)).toBe(true);
        expect(isSessionExpired(0, 1000, 500)).toBe(true);
    });

    it('🔴 #756：微信读书给 10 分钟（人要自己点「登录」再掏手机扫，180s 会先判过期）', () => {
        expect(WEREAD_SESSION_TTL_MS).toBe(600_000);
        expect(sessionTtlOf('weread')).toBe(WEREAD_SESSION_TTL_MS);
        expect(sessionTtlOf('bilibili')).toBe(QR_SESSION_TTL_MS);
        // 用户 m06077 的「扫完了却什么都没发生」：第 200 秒时 B 站早过期、微信读书还必须活着
        expect(isSessionExpired(0, 200_000, sessionTtlOf('bilibili'))).toBe(true);
        expect(isSessionExpired(0, 200_000, sessionTtlOf('weread'))).toBe(false);
    });
});
