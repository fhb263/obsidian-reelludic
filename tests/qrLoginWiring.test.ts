// ③-3 / ③-4 接线守卫（2026-11-12 用户 m00353，方案按 m05505 重做）。
//
// 🔴 用户 m05505 原话（推翻 m05063 的「弹出对应网页扫码」）：
//   「删除豆瓣的扫码登录，还有这个 b 站扫码登录怎么是跳转到浏览器登录还会触发下载 iBiliPlayer 的
//     行为什么鬼……扫码登录按钮改成二维码小图标按钮放在输入框的右侧旁边（紧挨着"显示"按钮的左侧）
//     同时用扫码登录的 UI 要变化成原来的输入框区域替换为『当前账号: 微信读书用户』」
// ⇒ 本文件钉的正是这四件事：**删豆瓣 / 图标进输入框行 / 登录后换形态 / B 站不再开窗口**。
//
// 语义层（状态码怎么读、Cookie 怎么抠）已由 `tests/qrLogin.test.ts` 钉住；
// 编码器正确性由 `tests/qrcode.test.ts` 与 Python 参照逐格比对钉住。
// 本文件只钉**接线**：错了不会让编译红、也不会让语义测试红，只会在用户点下去之后表现为
// 「点了没反应 / 图标在错的地方 / 登录了框还在」。
//
// ⚠️ 做法：读源码文本 + 剥注释后按正则断言（同 `tests/credentialPanelWiring.test.ts`）。
//   Settings.ts 是 9000+ 行的命令式 DOM 构造，没有可 inject 的宿主；
//   文本守卫是本仓对「大文件里的接线」既有的有效做法。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** 剥掉 `//` 行注释、`/* *\/` 块注释与 HTML 注释 —— 注释里合法出现的关键词不该判红。 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/<!--[\s\S]*?-->/g, '');
}

const settingsRaw = readFileSync(join(ROOT, 'src', 'Settings.ts'), 'utf8');
const settingsSrc = stripComments(settingsRaw);
const modalSrc = stripComments(readFileSync(join(ROOT, 'src', 'modals', 'QrLoginModal.ts'), 'utf8'));
const serviceSrc = stripComments(readFileSync(join(ROOT, 'src', 'services', 'qrLogin.ts'), 'utf8'));
const cssSrc = stripComments(readFileSync(join(ROOT, 'styles.css'), 'utf8'));

/**
 * 截出某个方法**定义**的函数体。
 *
 * 🔴 必须锚 `private <name>(` 而不是裸名字：`renderQrLoginButton` 在调用点先出现，
 *   拿调用点当方法体，断言就会在几十个字符的碎片上跑。
 */
function methodBody(src: string, name: string): string {
    const anchors = [`private ${name}(`, `private ${name}<`];
    let at = -1;
    for (const a of anchors) {
        at = src.indexOf(a);
        if (at > -1) break;
    }
    expect(at, `源码里找不到方法定义 private ${name}(`).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n {4}(?:private |\/\*\*|\})/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

/**
 * 截出某个**导出函数**的函数体（服务层是模块级函数，不是类方法）。
 *
 * ⚠️ 与 `methodBody` 分开而不是硬塞一个正则：两者的收尾边界完全不同
 *    （类方法到下一个 4 空格缩进成员；导出函数到下一个顶层 `export`）。
 *    ⛔ 别为了省一个函数把边界写成「下一个 `}`」—— 函数体里到处是 `}`。
 */
function exportBody(src: string, name: string): string {
    const at = src.indexOf(`export function ${name}(`) >= 0
        ? src.indexOf(`export function ${name}(`)
        : src.indexOf(`export async function ${name}(`);
    expect(at, `源码里找不到导出函数 export function ${name}(`).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n(?:export |\/\*\*|\/\* ─)/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

/**
 * 截出**模块内私有 async 函数**。
 * ⚠️ `readJarPairs` 不带 `export`，套 `exportBody` 会报「找不到导出函数」——
 *    别为了迁就而给它加 `export`（那会把内部实现变成对外 API）。
 */
function asyncFnBody(src: string, name: string): string {
    const at = src.indexOf(`async function ${name}(`);
    expect(at, `源码里找不到 async function ${name}(`).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n(?:async function |export |\/\*\*|\/\* ─)/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

/** 类里**非 private** 的方法（`onClose` / `onOpen` 这类覆写）。 */
function publicBody(src: string, name: string): string {
    const at = src.indexOf(`\n    ${name}(`);
    expect(at, `源码里找不到方法 ${name}(`).toBeGreaterThan(-1);
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n {4}(?:private |public |\/\*\*|\})/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

describe('🔴 豆瓣扫码必须整条删除（用户 m05505 明确要求）', () => {
    it('`createApiKeyRow` 里不再有豆瓣扫码分支', () => {
        const body = methodBody(settingsSrc, 'createApiKeyRow');
        expect(body).not.toMatch(/'douban'\s*:\s*'weread'/);
        expect(body).not.toMatch(/isDouban/);
    });

    it('`QrPlatform` 只剩两个平台（豆瓣加回来会在这里翻红）', () => {
        const pure = stripComments(readFileSync(join(ROOT, 'src', 'pure', 'qrLogin.ts'), 'utf8'));
        expect(pure).toMatch(/export type QrPlatform = 'bilibili' \| 'weread'/);
        expect(pure).not.toMatch(/'douban'/);
    });

    it('服务层与弹窗里都不再出现豆瓣端点', () => {
        expect(serviceSrc).not.toMatch(/accounts\.douban\.com/);
        expect(serviceSrc).not.toMatch(/qrlogin/);
        expect(modalSrc).not.toMatch(/douban/);
    });
});

describe('扫码图标必须落在「输入框行」内、且在「显示」按钮左侧（用户逐字要求）', () => {
    it('`fillSecretRow` 有 `beforeEye` 插槽，且建序是 input → beforeEye → eye', () => {
        const body = methodBody(settingsSrc, 'fillSecretRow');
        expect(body).toMatch(/beforeEye\?\.\(wrap\)/);
        // 🔴 顺序断言：beforeEye 调用必须出现在建「显示/隐藏」按钮之前
        const atBefore = body.indexOf('beforeEye?.(wrap)');
        const atEye = body.indexOf('rl-secret-eye');
        expect(atBefore).toBeGreaterThan(-1);
        expect(atEye).toBeGreaterThan(atBefore);
    });

    it('扫码按钮是**图标**按钮（`iconButton` + `qr-code`），⛔ 不是带字按钮', () => {
        const body = methodBody(settingsSrc, 'renderQrLoginButton');
        expect(body).toMatch(/iconButton\(/);
        expect(body).toMatch(/'qr-code'/);
        // 反向守卫：⛔ 不许退回带字按钮
        expect(body).not.toMatch(/text: '扫码登录'/);
        expect(body).not.toMatch(/cls: 'rl-btn rl-qr-open'/);
    });

    it('🔴 图标挂在**输入框最左旁**（`beforeInput` 行内首元素），⛔ 不是「显示」左边', () => {
        const body = methodBody(settingsSrc, 'renderQrAccountField');
        // m05813 改口径：「把二维码小图标按钮放在 cookie 框的**最左旁**」
        // ⚠️ 这条守的是**位置**而不是插槽名：`beforeInput` 是「建 input 之前」的插槽，
        //    是「行内首元素」的唯一正确表达；换成 `beforeEye`（建 input 之后）会跑到「显示」左边。
        expect(body).toMatch(/beforeInput:/);
        expect(body).toMatch(/renderQrLoginButton\(wrap, platform/);
        // 反向守卫：⛔ 别退回 `beforeEye`（那是输入框右侧，「显示」左边，用户点名不要的位置）
        expect(body).not.toMatch(/beforeEye:/);
        // 反向守卫：动作行里不许再有扫码按钮
        const row = methodBody(settingsSrc, 'createApiKeyRow');
        expect(row).not.toMatch(/renderQrLoginButton\(actions/);
    });

    it('🔴 插槽语义靠**建序**保证（`beforeInput` 必须真的在 createEl(input) 之前）', () => {
        // 只断言「调了 beforeInput」不够 —— 把它挪到 input 之后，视觉就回到右侧了，测试还是绿。
        // 所以这里真读 fillSecretRow 的**建序**：beforeInput → input → beforeEye → eye。
        const fill = methodBody(settingsSrc, 'fillSecretRow');
        const atBeforeInput = fill.indexOf('opts.beforeInput?.(wrap)');
        const atInput = fill.indexOf("wrap.createEl('input'");
        const atEye = fill.indexOf("cls: 'rl-secret-eye'");
        expect(atBeforeInput).toBeGreaterThan(-1);
        expect(atInput).toBeGreaterThan(-1);
        expect(atEye).toBeGreaterThan(-1);
        expect(atBeforeInput).toBeLessThan(atInput);
        expect(atInput).toBeLessThan(atEye);
    });
});

describe('登录后输入框区域换成「当前账号 + 退出登录」（用户逐字要求）', () => {
    it('`renderQrAccountField` 有「当前账号」与「退出登录」两个形态', () => {
        const body = methodBody(settingsSrc, 'renderQrAccountField');
        expect(body).toMatch(/当前账号/);
        expect(body).toMatch(/退出登录/);
        expect(body).toMatch(/accountNameOf\(/);
    });

    it('🔴 有账号名时**不建输入框**（⛔ 不是「框里填上 Cookie」）', () => {
        const body = methodBody(settingsSrc, 'renderQrAccountField');
        // 取到名字的分支里必须早退 / 直接建账户行，⛔ 不许再 createSecretField
        const atName = body.indexOf('if (!name)');
        expect(atName).toBeGreaterThan(-1);
        const accountBranch = body.slice(atName);
        expect(accountBranch).toMatch(/rl-acct/);
    });

    it('🔴 取不到账号名时**退回输入框**（⛔ 别显示「未知」把框藏掉）', () => {
        const body = methodBody(settingsSrc, 'renderQrAccountField');
        const atName = body.indexOf('if (!name)');
        const emptyBranch = body.slice(atName, body.indexOf('rl-acct'));
        expect(emptyBranch).toMatch(/createSecretField\(/);
    });

    it('两种形态下图标按钮都在（登录后还能换账号，用户 m05529 裁定）', () => {
        const body = methodBody(settingsSrc, 'renderQrAccountField');
        const calls = body.match(/renderQrLoginButton\(/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('微信读书与 B 站两行都走 `renderQrAccountField`', () => {
        expect(settingsSrc).toMatch(/platform: 'weread'/);
        expect(settingsSrc).toMatch(/platform: 'bilibili'/);
        const calls = settingsSrc.match(/this\.renderQrAccountField\(/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });
});

describe('③-3 · B 站 refresh_token 必须持久化', () => {
    it('`refresh_token` 写进 settings 的专用键（用户逐字：「必须持久化」）', () => {
        expect(settingsSrc).toMatch(/biliRefreshToken = picked\.refreshToken/);
        expect(settingsSrc).toMatch(/biliRefreshToken\?: string;/);
        expect(settingsSrc).toMatch(/biliRefreshToken: ''/);
    });

    it('🔴 只在真拿到时才写（`undefined` 不许覆盖旧值）', () => {
        expect(settingsSrc).toMatch(/if \(picked\.refreshToken\) this\.plugin\.settings\.biliRefreshToken/);
    });

    it('退出登录时连续期凭据一起清（留着只会去换一个已退出的账号）', () => {
        expect(settingsSrc).toMatch(/biliRefreshToken = ''/);
    });
});

describe('③-3 · B 站改为插件内自绘二维码（⛔ 不再开子窗口）', () => {
    it('服务层有 `startBiliQrLogin`，且它**不开窗口**', () => {
        const body = exportBody(serviceSrc, 'startBiliQrLogin');
        expect(body).toMatch(/biliGenerate/);
        expect(body).toMatch(/qrcodeKey/);
        // 反向守卫：只调接口，⛔ 不许 new BrowserWindow
        expect(body).not.toMatch(/new BW\(/);
        expect(body).not.toMatch(/BrowserWindow/);
    });

    it('弹窗里用 `encodeQr` + `qrSvgPath` 画码（自研编码器，无新依赖）', () => {
        expect(modalSrc).toMatch(/encodeQr\(/);
        expect(modalSrc).toMatch(/qrSvgPath\(/);
    });

    it('🔴 二维码有白底（深色主题下深色模块画在深色底上扫不出）', () => {
        expect(modalSrc).toMatch(/fill.*#ffffff/i);
    });

    it('🔴 `shape-rendering` 必须是 crispEdges（抗锯齿会把细模块糊成一团）', () => {
        expect(modalSrc).toMatch(/crispEdges/);
    });

    it('⛔ 不再有移动端 UA 那套（`BILI_MOBILE_UA` / `needsMobileUa` 已随旧方案删除）', () => {
        // ⚠️ 判据看**实际调用**而不是类型声明：`RemoteWindow` 里保留了 `setUserAgent?` 的
        //    可选签名（`@electron/remote` 的真实形状），但本模块⛔ 不许真的去调它。
        expect(serviceSrc).not.toMatch(/BILI_MOBILE_UA/);
        expect(serviceSrc).not.toMatch(/needsMobileUa/);
        expect(serviceSrc).not.toMatch(/\.setUserAgent\(/);
        expect(serviceSrc).not.toMatch(/\.setUserAgent\?\.\(/);
    });
});

describe('③-4 · 微信读书仍开窗口（实测没有任何 HTTP 扫码接口）', () => {
    it('`openWereadWindow` 存在且打开的是首页', () => {
        const body = exportBody(serviceSrc, 'openWereadWindow');
        expect(body).toMatch(/wereadHome/);
        expect(body).toMatch(/loadURL/);
    });

    it('⛔ 不能 `await loadURL`（首次导航必 reject ERR_ABORTED）', () => {
        expect(serviceSrc).not.toMatch(/await\s+\w+\.loadURL\(/);
        expect(serviceSrc).toMatch(/loadURL\?\.\(/);
    });
});

describe('弹窗生命周期', () => {
    it('`onClose` 里**停轮询 + 关子窗口**（关窗后还在打接口是用户看不见的浪费）', () => {
        const body = publicBody(modalSrc, 'onClose');
        expect(body).toMatch(/this\.stopPolling\(\)/);
        expect(body).toMatch(/this\.child\?\.close\(\)/);
    });

    it('弹窗不写 settings（落盘只在调用方的 `onPicked` 里，⛔ 散在弹窗会漏清结论）', () => {
        expect(modalSrc).not.toMatch(/saveSettings\(/);
        expect(modalSrc).not.toMatch(/plugin\.settings/);
    });
});

describe('样式口径（③-5 的硬要求对新增样式同样生效）', () => {
    it('扫码相关样式只用主题变量，⛔ 不写死颜色/像素', () => {
        const at = cssSrc.indexOf('.rl-qr-modal');
        expect(at).toBeGreaterThan(-1);
        const block = cssSrc.slice(at, cssSrc.indexOf('.rl-qr-open', at) + 200);
        expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(block).not.toMatch(/rgba?\(/);
        expect(block).not.toMatch(/:\s*\d+px/);
    });

    it('账户行样式（`.rl-acct`）也只用主题变量', () => {
        const at = cssSrc.indexOf('.rl-acct');
        expect(at).toBeGreaterThan(-1);
        const block = cssSrc.slice(at, at + 1200);
        expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(block).not.toMatch(/rgba?\(/);
    });
});

/**
 * #756（用户 m06077「微信读书扫码后不自动获取 cookie，b 站扫码能获取但测试连接失败」）
 *
 * 🔴 这组守卫钉的是**造成那两个真机症状的具体写法**，不是「大概长这样」：
 *    ① B 站的 `data.url` 已是票据地址 ⇒ 从 URL 抠 Cookie 必须是白名单，且票据要走兑换；
 *    ② 微信读书登录态有一部挂在 `path=/web` ⇒ 读 jar 不能只用根路径 url 过滤；
 *    ③ 180s TTL 对「开窗→点登录→扫码」太短 ⇒ 必须按平台分；
 *    ④ 弹窗拿到「已确认登录但无凭据」时不能终结会话。
 */
describe('#756 · B 站票据不许当凭据（用户 m06077）', () => {
    it('服务层有 `exchangeBiliTicket`，且它靠**累积 Cookie** 而不是 URL query', () => {
        const body = exportBody(serviceSrc, 'exchangeBiliTicket');
        expect(body).toMatch(/nodeHttpGet\(url/);
        // 关键：读 `res.cookies`（跨跳转累积），⛔ 不是再解析一遍 ticket 地址
        expect(body).toMatch(/res\.cookies/);
        expect(body).toMatch(/biliCredentialCookieOf/);
        // 🔴 也不许把**兑换目标地址本身**的 query 当凭据（那正是 ticket=… 的老错）
        expect(body).not.toMatch(/cookieFromBiliCallbackUrl\(url\)/);
    });

    it('兑换还有 `finalUrl` 兜底（跨域接口常把凭据拼进 302 的 Location query）', () => {
        const body = exportBody(serviceSrc, 'exchangeBiliTicket');
        // Node HTTP 不执行 JS ⇒ 落地页前端写 cookie 那步不会发生，必须自己看最终地址
        expect(body).toMatch(/cookieFromBiliCallbackUrl\(res\.finalUrl/);
    });

    it('`pollQrLogin` 成功轮：无凭据时先兑换票据，⛔ 不直接把票据当 cookie 返回', () => {
        const body = exportBody(serviceSrc, 'pollQrLogin');
        expect(body).toMatch(/parsed\.ticketUrl/);
        // 必须把 poll 轮自己的 Cookie 一起带进兑换（匿名 Cookie 让请求不像爬虫，且凭据可能就在这一轮）
        expect(body).toMatch(/exchangeBiliTicket\(parsed\.ticketUrl,\s*res\.cookies/);
        // 兑换失败必须明确报错，⛔ 不许吞成「扫码成功」
        expect(body).toMatch(/没能换到登录凭据/);
    });

    it('`nodeHttp` 把跨跳转累积的 Cookie 透出来（兑换靠的就是它）', () => {
        const nodeHttpSrc = stripComments(readFileSync(join(ROOT, 'src', 'services', 'nodeHttp.ts'), 'utf8'));
        expect(nodeHttpSrc).toMatch(/cookies\?: string;/);
        expect(nodeHttpSrc).toMatch(/cookies: cookie \}/);
        // 单跳 GET 的返回值也要带上，否则调用方永远看不到
        expect(nodeHttpSrc).toMatch(/nodeHttpGet[\s\S]{0,400}?cookies: r\.cookies/);
    });
});

describe('#756 · 微信读书要读到 path=/web 下的 cookie（用户 m06077）', () => {
    it('`readJarPairs` 按 **domain** 取全量，⛔ 不只问根路径', () => {
        const body = asyncFnBody(serviceSrc, 'readJarPairs');
        // ⚠️ 实现在 `tryGet({ domain: host })` 里 —— 首字母大写，正则要容忍
        expect(body).toMatch(/[Gg]et\(\{\s*domain:/);
        // 兜底必须留着（旧 Electron 的 get({url}) 行为差异）
        expect(body).toMatch(/url:\s*JAR_URL\[platform\]/);
    });

    it('同名 cookie 多 path 并存时**深 path 优先**（站点就是这么覆盖的）', () => {
        const body = asyncFnBody(serviceSrc, 'readJarPairs');
        expect(body).toMatch(/depth/);
        expect(body).toMatch(/depth > prev\.depth/);
    });

    it('微信读书 TTL 是 10 分钟、B 站仍是 180s（`sessionTtlOf` 分平台）', () => {
        const pureSrc = stripComments(readFileSync(join(ROOT, 'src', 'pure', 'qrLogin.ts'), 'utf8'));
        expect(pureSrc).toMatch(/WEREAD_SESSION_TTL_MS = 600_000/);
        expect(pureSrc).toMatch(/QR_SESSION_TTL_MS = 180_000/);
        // `pollQrLogin` 里必须走分平台的 TTL，⛔ 不许写死 QR_SESSION_TTL_MS
        const poll = exportBody(serviceSrc, 'pollQrLogin');
        expect(poll).toMatch(/sessionTtlOf\(info\.platform\)/);
        expect(poll).not.toMatch(/isSessionExpired\(startedAt, now, QR_SESSION_TTL_MS\)/);
    });
});

describe('#756 · 弹窗拿到「已确认登录但无凭据」不能终结会话', () => {
    it('🔴 `settled = true` 必须在 `if (!r.cookie)` **之后**（否则用户连重试机会都没有）', () => {
        const atGuard = modalSrc.indexOf('if (!r.cookie)');
        expect(atGuard).toBeGreaterThan(-1);
        const atSettled = modalSrc.indexOf('this.settled = true;', atGuard);
        expect(atSettled, '`this.settled = true` 必须在无凭据守卫之后').toBeGreaterThan(atGuard);
        // 无凭据分支内部不许 stopPolling（要能继续重试）。
        // ⚠️ 不能靠固定长度窗口截：`+260` 会越过守卫块吞到后面的 `stopPolling`，
        //    这是「断言写错」不是「实现写错」——改用花括号配对精确取块。
        const open = modalSrc.indexOf('{', atGuard);
        let depth = 0;
        let end = open;
        for (let i = open; i < modalSrc.length; i += 1) {
            if (modalSrc[i] === '{') depth += 1;
            else if (modalSrc[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        const guardBlock = modalSrc.slice(open, end + 1);
        expect(guardBlock).not.toMatch(/stopPolling/);
        expect(guardBlock).not.toMatch(/this\.settled = true/);
    });

    it('落盘只在 `onPicked`（弹窗仍不碰 settings）', () => {
        expect(modalSrc).not.toMatch(/saveSettings\(/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// #757（2026-11-12 用户 m07156「微信读书扫码后子窗口登录了，但设置页啥也没反应」）
//
// 🔴 三个真根因，每个都要一条守卫，否则改回去不会红：
//   ⑴ 判据错：只认 `wr_name` 非空。实测（CDP `Network.getAllCookies`）微信读书登录态是
//      `wr_vid` + `wr_skey`/`wr_name`，且前端 4 个 bundle 里 `wr_name` 字面量 0 命中。
//   ⑵ 取不到：`get({ domain: 'weread.qq.com' })` 拿不到挂在 `.weread.qq.com` 下的那半份。
//   ⑶ 看不出进度：pending 恒返回「等待扫码」+ 弹窗没有手动重读入口 ⇒ 用户以为死机。
// ─────────────────────────────────────────────────────────────────────────────
describe('#757 · 微信读书登录判据是复合的（不是「有 Cookie 就算登录」）', () => {
    const pureSrc = stripComments(readFileSync(join(ROOT, 'src', 'pure', 'qrLogin.ts'), 'utf8'));

    it('`isWereadLoggedIn` 要求 `wr_vid` **且** `wr_skey`/`wr_name` 之一', () => {
        const body = exportBody(pureSrc, 'isWereadLoggedIn');
        expect(body).toMatch(/WEREAD_ID_COOKIE/);
        expect(body).toMatch(/WEREAD_LOGIN_COOKIES/);
        // 语义必须是「id 必须 + 身份键 some」，⛔ 不许退回「只要有一条 cookie」
        expect(body).toMatch(/nonEmpty\(WEREAD_ID_COOKIE\)/);
        expect(body).toMatch(/some\(/);
    });

    it('🔴 `WEREAD_LOGIN_COOKIE` 不再当登录判据用（只留给「当前账号」显示）', () => {
        const body = exportBody(pureSrc, 'isWereadLoggedIn');
        expect(body).not.toMatch(/WEREAD_LOGIN_COOKIE\b/);
    });
});

describe('#757 · Cookie 要**两个域都问**（带点的父域也挂着登录态）', () => {
    it('`readJarPairs` 同时查 `host` 与 `.host`', () => {
        const body = asyncFnBody(serviceSrc, 'readJarPairs');
        expect(body).toMatch(/domain:\s*host/);
        // 🔴 关键：带点的父域
        expect(body).toMatch(/domain:\s*`\.\$\{host\}`/);
    });
});

describe('#757 · 拿到 Cookie 还要**权威复核**才算登录成功', () => {
    it('`pollQrLogin` 微信读书分支调 `probeWereadShelf`，且没通过时**继续等**而不是报错', () => {
        const poll = exportBody(serviceSrc, 'pollQrLogin');
        expect(poll).toMatch(/probeWereadShelf\(jar\)/);
        // 没通过必须是 pending（给用户继续操作的机会），⛔ 不是 error
        const at = poll.indexOf('probeWereadShelf(jar)');
        const after = poll.slice(at, at + 400);
        expect(after).toMatch(/stage:\s*'pending'/);
        // 只有 probe.ok 才 done，且 done 必须带 cookie（弹窗靠它落盘）
        expect(poll).toMatch(/probe\.ok/);
        expect(poll).toMatch(/stage:\s*'done'[\s\S]{0,80}cookie/);
    });

    it('复核复用 `pure/weread` 的书架真源（⛔ 别另写一套 errCode 判断）', () => {
        const body = asyncFnBody(serviceSrc, 'probeWereadShelf');
        expect(body).toMatch(/buildWereadShelfUrl\(\)/);
        expect(body).toMatch(/parseWereadShelfAuth\(/);
        expect(body).not.toMatch(/errCode\s*===\s*-2010/);
    });
});

describe('#757 · 弹窗要能看出进度（「啥也没反应」是文案不动）', () => {
    it('pending 文案带 Cookie 条数，⛔ 不是恒定一句「等待扫码」', () => {
        const poll = exportBody(serviceSrc, 'pollQrLogin');
        expect(poll).toMatch(/已读到 \$\{pairs\.length\} 条 Cookie/);
    });

    it('微信读书多一颗「立即读取」手动入口', () => {
        expect(modalSrc).toMatch(/我已在窗口里登录，立即读取/);
        // 只给微信读书（B 站是靠轮询接口判状态，不需要手动重读 jar）
        const at = modalSrc.indexOf('我已在窗口里登录，立即读取');
        const before = modalSrc.slice(Math.max(0, at - 300), at);
        expect(before).toMatch(/'weread'/);
    });
});
