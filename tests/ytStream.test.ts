/**
 * `services/ytStream.ts` 的单测。
 *
 * 🔴 这一条是**真机 bug 的回归锁**，不是形式主义：
 *    Windows 上 `pip install yt-dlp` 只产出 `yt-dlp.cmd`（批处理包装器）。
 *    Node 的 `spawn` 不做 PATHEXT 解析、也不执行 `.cmd`，于是 `spawn('yt-dlp')`
 *    必报 `ENOENT` —— 用户明明装了，插件却说「yt-dlp 没装」。
 *    真实后果：YouTube 网络集 100% 不可用。
 *    ⇒ 必须保证候选表里 **`python -m yt_dlp` 排在第一位**。
 */
import { describe, expect, it } from 'vitest';

import {
    cookieToNetscape,
    isYtFailure,
    normalizeProxyUrl,
    removeCookieFile,
    resetJsRuntimeCache,
    resetYtCommandCache,
    resolveNodeRuntime,
    ytCommandCandidates,
} from 'services/ytStream';
import { ytErrorMessage } from 'pure/youtube';

describe('ytCommandCandidates', () => {
    it('第一候选必须是 python -m yt_dlp（Windows 上唯一稳定的一条）', () => {
        const c = ytCommandCandidates();
        expect(c.length).toBeGreaterThan(0);
        expect(c[0].cmd).toBe('python');
        expect(c[0].pre).toEqual(['-m', 'yt_dlp']);
    });

    it('不能把裸 yt-dlp 放在首位（Node 不解析 .cmd，必 ENOENT）', () => {
        const first = ytCommandCandidates()[0];
        // 这条断言就是本次 bug 的回归锁 —— 首项是裸 yt-dlp 就等于功能报废
        expect(first.cmd).not.toBe('yt-dlp');
    });

    it('候选表覆盖 python / py / 独立可执行三种装法', () => {
        const cmds = ytCommandCandidates().map((c) => c.cmd);
        expect(cmds).toContain('python');
        expect(cmds).toContain('py');
        expect(cmds.some((c) => c.startsWith('yt-dlp'))).toBe(true);
    });

    it('每个候选都要带 -m yt_dlp 或本身就是可执行（不能产出裸 python 调用）', () => {
        for (const c of ytCommandCandidates()) {
            if (c.cmd === 'python' || c.cmd === 'py') {
                expect(c.pre).toEqual(['-m', 'yt_dlp']);
            } else {
                expect(c.pre).toEqual([]);
            }
        }
    });

    it('候选表是纯函数：两次调用互不影响（防止调用方就地改坏常量）', () => {
        const a = ytCommandCandidates();
        a[0].pre.push('-X');
        expect(ytCommandCandidates()[0].pre).toEqual(['-m', 'yt_dlp']);
    });
});

describe('resetYtCommandCache', () => {
    it('可重复调用且不抛（用户装好 yt-dlp 后靠它免重启）', () => {
        expect(() => {
            resetYtCommandCache();
            resetYtCommandCache();
        }).not.toThrow();
    });
});

describe('normalizeProxyUrl', () => {
    it('空值 / undefined / null ⇒ 空串（= 直连）', () => {
        expect(normalizeProxyUrl('')).toBe('');
        expect(normalizeProxyUrl('   ')).toBe('');
        expect(normalizeProxyUrl(undefined)).toBe('');
        expect(normalizeProxyUrl(null)).toBe('');
    });

    it('只写 host:port 时自动补 http://（否则 yt-dlp 判非法参数）', () => {
        expect(normalizeProxyUrl('127.0.0.1:7897')).toBe('http://127.0.0.1:7897');
    });

    it('保留已有 scheme', () => {
        expect(normalizeProxyUrl('http://127.0.0.1:7897')).toBe('http://127.0.0.1:7897');
        expect(normalizeProxyUrl('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080');
    });

    it('丢掉路径与查询串（yt-dlp 只认 scheme://host）', () => {
        expect(normalizeProxyUrl('http://127.0.0.1:7897/some/path?x=1')).toBe('http://127.0.0.1:7897');
    });

    it('不支持的协议 ⇒ 空串，⛔ 不返回半截地址', () => {
        expect(normalizeProxyUrl('ftp://127.0.0.1:21')).toBe('');
        expect(normalizeProxyUrl('file:///etc/passwd')).toBe('');
    });

    it('没有 hostname ⇒ 空串', () => {
        expect(normalizeProxyUrl('http://')).toBe('');
    });

    it('完全解析不了 ⇒ 空串而不是抛', () => {
        expect(normalizeProxyUrl('::::')).toBe('');
    });
});

describe('cookieToNetscape', () => {
    it('输出 Netscape 头（没有这行 yt-dlp 判坏文件）', () => {
        const t = cookieToNetscape('a=b');
        expect(t.startsWith('# Netscape HTTP Cookie File')).toBe(true);
    });

    it('裸头部 `a=b; c=d`：每行 7 个 TAB 字段，域 .youtube.com、path=/', () => {
        const t = cookieToNetscape('SID=abc');
        const line = t.split('\n').find((l) => l.startsWith('.youtube.com'));
        expect(line).toBeDefined();
        const f = String(line).split('\t');
        expect(f).toHaveLength(7);
        expect(f[0]).toBe('.youtube.com');
        expect(f[1]).toBe('TRUE'); // include subdomains
        expect(f[2]).toBe('/');
        expect(f[3]).toBe('TRUE'); // secure
        expect(f[4]).toBe('0'); // session cookie
        expect(f[5]).toBe('SID');
        expect(f[6]).toBe('abc');
    });

    it('分号分隔的多条 Cookie 都转出来', () => {
        const t = cookieToNetscape('SID=a; HSID=b; SSID=c');
        const rows = t.split('\n').filter((l) => l.startsWith('.youtube.com'));
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.split('\t')[5])).toEqual(['SID', 'HSID', 'SSID']);
    });

    it('值里含 = 时只按第一个 = 切（JWT 类 Cookie 很常见）', () => {
        const t = cookieToNetscape('TOKEN=a=b=c');
        const row = t.split('\n').find((l) => l.includes('TOKEN'));
        expect(row).toBeDefined();
        expect(String(row).split('\t')[6]).toBe('a=b=c');
    });

    it('空串 / 纯空白 / 全是坏片段时不产出数据行', () => {
        for (const raw of ['', '   ', ';;;', '=x', 'noequals']) {
            const rows = cookieToNetscape(raw)
                .split('\n')
                .filter((l) => l && !l.startsWith('#'));
            expect(rows).toHaveLength(0);
        }
    });

    it('key 两边的空格被去掉（粘贴时常带）', () => {
        const t = cookieToNetscape('  SID  =  v  ');
        const row = t.split('\n').find((l) => l.startsWith('.youtube.com'));
        expect(String(row).split('\t')[5]).toBe('SID');
        expect(String(row).split('\t')[6]).toBe('v');
    });
});

/**
 * 🔴 这一组是**真机 bug 的回归锁**。
 *
 *    用户给的是浏览器插件导出的 **JSON 数组**，早期实现只按 `;` 切串
 *    ⇒ JSON 里既没有 `;` 也没有 `=` ⇒ **每条都被丢弃** ⇒ 生成空 cookies.txt
 *    ⇒ 「填了 Cookie 等于没填」，而且完全不报错。
 *    这个 bug 的后果是整个 YouTube 1080P / 机器人验证绕不过去。
 */
describe('cookieToNetscape（JSON 导出格式）', () => {
    const JSON_EXPORT = JSON.stringify([
        {
            domain: '.youtube.com',
            expirationDate: 1827460746,
            hostOnly: false,
            httpOnly: false,
            name: 'SID',
            path: '/',
            sameSite: 'unspecified',
            secure: false,
            session: false,
            value: 'sid-value',
        },
        {
            domain: '.youtube.com',
            expirationDate: 1824910517.679821, // 浮点秒，真实导出就是这样
            hostOnly: false,
            httpOnly: true,
            name: '__Secure-3PSID',
            path: '/',
            sameSite: 'no_restriction',
            secure: true,
            session: false,
            value: 'secure-sid',
        },
    ]);

    it('JSON 数组能被解析出全部条目（旧实现这里是 0 条）', () => {
        const rows = cookieToNetscape(JSON_EXPORT)
            .split('\n')
            .filter((l) => l && !l.startsWith('#'));
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.split('\t')[5])).toEqual(['SID', '__Secure-3PSID']);
    });

    it('浮点 expirationDate 必须取整（Netscape 第 5 列只认整数秒）', () => {
        const row = cookieToNetscape(JSON_EXPORT)
            .split('\n')
            .find((l) => l.includes('__Secure-3PSID'));
        expect(String(row).split('\t')[4]).toBe('1824910517');
    });

    it('secure 按 JSON 真值写，⛔ 不能一律 TRUE', () => {
        const rows = cookieToNetscape(JSON_EXPORT)
            .split('\n')
            .filter((l) => l && !l.startsWith('#'));
        expect(rows[0].split('\t')[3]).toBe('FALSE'); // SID: secure=false
        expect(rows[1].split('\t')[3]).toBe('TRUE'); // __Secure-3PSID: secure=true
    });

    it('hostOnly=false 的域写 TRUE（含子域）', () => {
        const row = cookieToNetscape(JSON_EXPORT).split('\n').find((l) => l.includes('SID\t'));
        expect(String(row).split('\t')[1]).toBe('TRUE');
    });

    it('hostOnly=true 时第 2 列写 FALSE', () => {
        const t = cookieToNetscape(
            JSON.stringify([{ domain: 'www.youtube.com', hostOnly: true, name: 'X', value: 'y', path: '/' }]),
        );
        const row = t.split('\n').find((l) => l.includes('\tX\t'));
        expect(String(row).split('\t')[1]).toBe('FALSE');
        expect(String(row).split('\t')[0]).toBe('www.youtube.com');
    });

    it('缺 expirationDate ⇒ 会话 cookie（0），不是 NaN', () => {
        const t = cookieToNetscape(JSON.stringify([{ name: 'NOEXP', value: 'v' }]));
        const row = t.split('\n').find((l) => l.includes('NOEXP'));
        expect(String(row).split('\t')[4]).toBe('0');
    });

    it('缺 domain / path ⇒ 回落 YouTube 口径，不生成空列', () => {
        const t = cookieToNetscape(JSON.stringify([{ name: 'BARE', value: 'v' }]));
        const row = String(t.split('\n').find((l) => l.includes('BARE')));
        const f = row.split('\t');
        expect(f[0]).toBe('.youtube.com');
        expect(f[2]).toBe('/');
    });

    it('坏 JSON 不抛，按「什么都没给」处理', () => {
        expect(() => cookieToNetscape('[{"name":"x",')).not.toThrow();
        expect(
            cookieToNetscape('[{"name":"x",')
                .split('\n')
                .filter((l) => l && !l.startsWith('#')),
        ).toHaveLength(0);
    });

    it('条目里没有 name ⇒ 跳过（不然文件里会出现无名行）', () => {
        const t = cookieToNetscape(JSON.stringify([{ value: 'onlyvalue' }, { name: 'OK', value: '1' }]));
        const rows = t.split('\n').filter((l) => l && !l.startsWith('#'));
        expect(rows).toHaveLength(1);
    });

    it('value 是数字也照样转（真实导出偶见）', () => {
        const t = cookieToNetscape(JSON.stringify([{ name: 'NUM', value: 123 }]));
        const row = String(t.split('\n').find((l) => l.includes('NUM')));
        expect(row.split('\t')[6]).toBe('123');
    });

    it('单条对象（非数组）也接受', () => {
        const t = cookieToNetscape(JSON.stringify({ name: 'SOLO', value: 'v' }));
        const rows = t.split('\n').filter((l) => l && !l.startsWith('#'));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain('SOLO');
    });

    it('真实导出样本：19 条全进文件（用户实际给的格式）', () => {
        const sample = JSON.stringify(
            Array.from({ length: 19 }, (_, i) => ({
                domain: '.youtube.com',
                hostOnly: false,
                name: `C${i}`,
                path: '/',
                secure: true,
                expirationDate: 1827460746 + i,
                value: `v${i}`,
            })),
        );
        const rows = cookieToNetscape(sample)
            .split('\n')
            .filter((l) => l && !l.startsWith('#'));
        expect(rows).toHaveLength(19);
    });
});

describe('removeCookieFile', () => {
    it('目录未给 / 文件不存在都不抛', () => {
        expect(() => removeCookieFile(undefined)).not.toThrow();
        expect(() => removeCookieFile('')).not.toThrow();
        expect(() => removeCookieFile('/nonexistent/dir/xyz')).not.toThrow();
    });
});

describe('isYtFailure', () => {
    it('带 err 字符串判失败', () => {
        expect(isYtFailure({ err: 'x', raw: '' })).toBe(true);
    });

    it('成功结果（info/raw）不判失败', () => {
        expect(isYtFailure({ info: {}, raw: '' })).toBe(false);
    });

    it('null / undefined / 字符串都不判失败', () => {
        expect(isYtFailure(null)).toBe(false);
        expect(isYtFailure(undefined)).toBe(false);
        expect(isYtFailure('x')).toBe(false);
    });

    it('err 不是字符串不算失败（防止把 info.err 之类的字段误判）', () => {
        expect(isYtFailure({ err: 42 })).toBe(false);
    });
});

/**
 * 🔴 2026-10-31 真机事故的回归锁。
 *
 * 现场：用户 ytCookie 已填（19 条有效 cookie，实测 yt-dlp 能吃到），却一直看到
 * 「YouTube 要求验证机器人身份 —— 请在设置里填浏览器 Cookie」。
 * 真根因是 yt-dlp `JS runtimes: none`（默认只启用 deno，本机没装 deno）
 * ⇒ 只下发 storyboard ⇒ real_formats = 0。
 *
 * 🧪 实测（2026.08.19 与 2026.10.26 双版本同视频对照）：
 *   不加 `--js-runtimes` ⇒ real_formats = 0；加 `node` ⇒ 22 / 33。
 * ⇒ 这两条锁住「别再让用户去填根本没问题的 Cookie」和「探测到 Node 就不能返回空」。
 */
describe('JS 运行时（YouTube storyboard 事故的回归锁）', () => {
    it('只拿到故事板 ⇒ 指向 JS 运行时，⛔ 不是让他再填 Cookie', () => {
        const s = ytErrorMessage('WARNING: Only images are available for download. use --list-formats to see them');
        expect(s).toContain('JS 运行时');
        expect(s).not.toContain('Cookie');
    });

    it('page needs to be reloaded ⇒ 也不许只说「填 Cookie」', () => {
        const s = ytErrorMessage('ERROR: [youtube] xx: The page needs to be reloaded.');
        expect(s).toContain('JS 运行时');
    });

    it('「节点运行时未就绪」时，排查方向不能只剩填 Cookie', () => {
        const s = ytErrorMessage("ERROR: [youtube] xx: Sign in to confirm you're not a bot.");
        // 真·机器人验证这条保留原意图（填 Cookie / 换出口），但必须是**最后**才这么说
        expect(s).toContain('Cookie');
    });
});

describe('resolveNodeRuntime', () => {
    it('本机有 Node 18+ ⇒ 返回非空（这是 storyboard 事故的修复前提）', async () => {
        resetJsRuntimeCache();
        // ⚠️ 这条依赖测试机装 Node —— 本仓测试本来就跑在 Node 上，属于合理前提
        expect(await resolveNodeRuntime()).not.toBe('');
    });

    it('缓存生效：连续两次调用结果一致', async () => {
        resetJsRuntimeCache();
        const a = await resolveNodeRuntime();
        const b = await resolveNodeRuntime();
        expect(b).toBe(a);
    });

    it('返回值形态只能是 node 或 node:<路径>（喂给 --js-runtimes）', async () => {
        resetJsRuntimeCache();
        const v = await resolveNodeRuntime();
        expect(v === 'node' || v.startsWith('node:')).toBe(true);
    });
});
