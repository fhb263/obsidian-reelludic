// YouTube 内嵌登录态：把「用户真实那条 cookie 串」喂进管道，看它到底能写出几条。
//
// 🔴 2026-11-26 用户报障（m05414）：「youtube内嵌播放器填了cookie还是无法播放」
//    实测用户 data.json 里那串是 19 条 **全部 `.youtube.com`** 的扩展导出 JSON，
//    含 SID / HSID / SSID / APISID / SAPISID / __Secure-1PSID / LOGIN_INFO 等完整登录令牌。
//    ⇒ 上一轮加的 `.google.com` 白名单对他这份数据毫无作用，真因在别处。
//
// 本文件的作用：把「解析 + 域过滤 + 写 jar」这一段锁死 ——
// 它一旦证明 19/19 都写得进去，剩下的唯一变量就只有「Electron session 到底拿没拿到」，
// 而那正是 `EmbedCookieResult.available` 要如实报告的东西（⛔ 不能再静默吞掉）。
import { describe, expect, it } from 'vitest';
import { cookieDomainAccepted, parseEmbedCookies } from '../src/services/embedCookie';

/** 用户实况的 19 条（域名与 sameSite 与实测一致，值不重要故精简） */
const REAL_YT_JSON = JSON.stringify([
    { domain: '.youtube.com', name: '__Secure-1PAPISID', value: 'v1', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: false, expirationDate: 1827460746.5 },
    { domain: '.youtube.com', name: '__Secure-1PSID', value: 'v2', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', hostOnly: false, expirationDate: 1827460746 },
    { domain: '.youtube.com', name: '__Secure-3PAPISID', value: 'v3', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', hostOnly: false },
    { domain: '.youtube.com', name: '__Secure-3PSID', value: 'v4', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', hostOnly: false },
    { domain: '.youtube.com', name: '__Secure-BUCKET', value: 'v5', path: '/', secure: true, httpOnly: false, sameSite: 'lax', hostOnly: false },
    { domain: '.youtube.com', name: 'APISID', value: 'v6', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'HSID', value: 'v7', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'LOGIN_INFO', value: 'v8', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction' },
    { domain: '.youtube.com', name: 'PREF', value: 'v9', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'SAPISID', value: 'v10', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'SID', value: 'v11', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'SIDCC', value: 'v12', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: 'SSID', value: 'v13', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: '_gcl_au', value: 'v14', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: '__Secure-1PSIDCC', value: 'v15', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: '__Secure-1PSIDTS', value: 'v16', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified' },
    { domain: '.youtube.com', name: '__Secure-3PSIDCC', value: 'v17', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction' },
    { domain: '.youtube.com', name: '__Secure-3PSIDTS', value: 'v18', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction' },
    { domain: '.youtube.com', name: 'ST-xuwub9', value: 'v19', path: '/', secure: false, httpOnly: false, sameSite: 'unspecified' },
]);

describe('用户实况数据：19 条 .youtube.com 全部能被收下', () => {
    it('域白名单不丢任何一条', () => {
        expect(cookieDomainAccepted('yt', '.youtube.com')).toBe(true);
    });

    it('parseEmbedCookies 解析出 19 条，且都保留原域', () => {
        const list = parseEmbedCookies(REAL_YT_JSON, '.youtube.com');
        expect(list).toHaveLength(19);
        for (const c of list) expect(c.domain).toBe('.youtube.com');
    });

    it('登录令牌一个不少（SID/HSID/SSID/APISID/SAPISID/__Secure-*PSID/LOGIN_INFO）', () => {
        const names = parseEmbedCookies(REAL_YT_JSON, '.youtube.com').map((c) => c.name);
        for (const n of ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO']) {
            expect(names).toContain(n);
        }
    });

    it('sameSite=unspecified 归一成 no_restriction（跨站 iframe 才带得上登录态）', () => {
        const list = parseEmbedCookies(REAL_YT_JSON, '.youtube.com');
        const sid = list.find((c) => c.name === 'SID');
        expect(sid?.sameSite).toBe('no_restriction');
    });

    it('expirationDate 浮点被截成整数（Chromium 只收整数秒）', () => {
        const list = parseEmbedCookies(REAL_YT_JSON, '.youtube.com');
        const c = list.find((x) => x.name === '__Secure-1PAPISID');
        expect(c?.expiry).toBe(1827460746);
        expect(Number.isInteger(c?.expiry)).toBe(true);
    });

    it('全部 19 条目标域都过 cookieDomainAccepted 的 yt 分支', () => {
        const list = parseEmbedCookies(REAL_YT_JSON, '.youtube.com');
        expect(list.filter((c) => cookieDomainAccepted('yt', c.domain))).toHaveLength(19);
    });
});
