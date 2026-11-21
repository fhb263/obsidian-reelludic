/**
 * 网盘（WebDAV）客户端 —— 列目录 / 探测连通性。
 *
 * 🔴 分层纪律：**协议细节全在 `pure/webdav.ts`**（URL 规范化、Base64 鉴权头、PROPFIND 解析），
 *    本文件只做「把纯逻辑拼出来的请求真的发出去」这一件事。
 *    这样纯逻辑那半边能在 `node` 环境下单测，不需要真网盘。
 *
 * 🔴 为什么走 `nodeHttp` 而不是 Obsidian 的 `requestUrl`：
 *    `nodeHttp` 是本仓唯一支持**自定义方法 + 自定义头**的传输层（这次为 PROPFIND 扩了方法）；
 *    `requestUrl` 在 Electron 网络栈上有已知指纹问题（见 `nodeHttp.ts` 文件头）。
 *    且 `nodeHttp` 已经有重定向跟随 / 超时 / 重试，⛔ 别在这里自己再写一套 https 调用。
 *
 * ⚠️ 仅桌面端可用（`nodeHttp` 内部惰性 require Node 模块）。移动端调用一律先走
 *    `isWebdavAvailable()` 判掉 —— ⛔ 别让移动端走进来再抛异常。
 */
import { Platform } from 'obsidian';
import { nodeHttpPropfind } from 'services/nodeHttp';
import {
    davAuthHeader,
    normalizeDavBase,
    parseDavList,
    type DavEntry,
} from 'pure/webdav';

/** 一次列目录的结果（成功 / 失败二选一，⛔ 不抛异常给 UI —— 弹窗按 `ok` 分支画文案） */
export interface DavListResult {
    ok: boolean;
    /** 失败时给人看的一句话（成功时为空串） */
    error: string;
    /** 列到的条目（成功时才有；已按「目录在前 + 名字排序」排好） */
    entries: DavEntry[];
}

/** 网盘功能当前是否可用（桌面端 + 已配入口地址）。⛔ 不检查网络，那是 `listDav` 的事。 */
export function isWebdavAvailable(base: string | undefined): boolean {
    if (!Platform.isDesktopApp) return false;
    return !!normalizeDavBase(base);
}

/**
 * 把 WebDAV 的 HTTP 状态码翻成人话。
 *
 * 🔴 为什么要翻译而不是直接把状态码甩给用户：401/403/404/405 在 WebDAV 场景下
 *    各有明确含义（密码错 / 没权限 / 路径错 / 服务器没开 WebDAV），用户看着 `405`
 *    只会以为插件坏了。这里的文案直接决定他下一步去改密码还是改地址。
 */
function davErrorText(status: number): string {
    if (status === 401) return '账号或密码不对（401）';
    if (status === 403) return '没有权限访问这个目录（403）';
    if (status === 404) return '路径不存在，检查一下入口地址（404）';
    if (status === 405) return '这台服务器没开 WebDAV / 不支持列目录（405）';
    if (status === 501) return '这台服务器没开 WebDAV（501）';
    if (status === 0) return '连不上服务器，检查地址与网络';
    if (status >= 500) return `服务器出错了（${status}）`;
    return `请求失败（${status}）`;
}

/**
 * 列一个 WebDAV 目录（`Depth: 1`，只这一层）。
 *
 * @param base  WebDAV 入口地址（会被 `normalizeDavBase` 规范化；⛔ 不用调用方自己拼尾斜杠）
 * @param path  相对入口的子路径（空串 = 入口根目录）；形如 `动画/2024/`，**目录要以 `/` 结尾**
 * @param user  账号（空 = 匿名，很多内网 NAS 允许匿名读）
 * @param pass  密码
 */
export async function listDav(base: string, path: string, user: string, pass: string): Promise<DavListResult> {
    const root = normalizeDavBase(base);
    if (!root) return { ok: false, error: '入口地址不合法（需要 http/https 的 WebDAV 地址）', entries: [] };
    if (!Platform.isDesktopApp) return { ok: false, error: '网盘关联仅桌面端可用', entries: [] };

    const dir = normalizeDavSubPath(path);
    const url = dir ? new URL(encodeDavPath(dir), root).toString() : root;
    const headers: Record<string, string> = {};
    const auth = davAuthHeader(user, pass);
    if (auth) headers.Authorization = auth;

    let res;
    try {
        res = await nodeHttpPropfind(url, '1', headers);
    } catch (e) {
        // 网络层直接炸（DNS / 拒绝连接 / TLS）—— 与「服务器回了错误码」区分开
        return { ok: false, error: `连不上服务器：${errorMessageOf(e)}`, entries: [] };
    }
    // 207 是 PROPFIND 的正常响应；部分服务器（坚果云）对根目录也会回 200
    if (res.status !== 207 && res.status !== 200) {
        return { ok: false, error: davErrorText(res.status), entries: [] };
    }
    // 🔴 base 用**最终地址**（跟过重定向之后）：服务器给的 href 是相对它自己的，
    //    拿原始 `root` 去拼会在「入口 301 到别的路径」时拼出错地址。
    const entries = parseDavList(res.text, res.finalUrl || url);
    return { ok: true, error: '', entries };
}

/**
 * 探测「这套配置能不能列目录」—— 设置页的「测试连接」按钮用。
 * ⚠️ 只发一次 `Depth: 0`（不列内容），验证鉴权与路径，比 `listDav` 轻。
 */
export async function probeDav(base: string, user: string, pass: string): Promise<{ ok: boolean; error: string }> {
    const root = normalizeDavBase(base);
    if (!root) return { ok: false, error: '入口地址不合法（需要 http/https 的 WebDAV 地址）' };
    if (!Platform.isDesktopApp) return { ok: false, error: '网盘关联仅桌面端可用' };
    const headers: Record<string, string> = {};
    const auth = davAuthHeader(user, pass);
    if (auth) headers.Authorization = auth;
    try {
        const res = await nodeHttpPropfind(root, '0', headers);
        if (res.status === 207 || res.status === 200) return { ok: true, error: '' };
        return { ok: false, error: davErrorText(res.status) };
    } catch (e) {
        return { ok: false, error: `连不上服务器：${errorMessageOf(e)}` };
    }
}

/** 取异常的人话消息（`e` 在 `unknown` 下不能直接点 `.message`） */
function errorMessageOf(e: unknown): string {
    if (e instanceof Error && e.message) return e.message;
    const s = typeof e === 'string' ? e : '';
    return s || '未知错误';
}

/**
 * 规范化子路径：去掉开头的 `/`、保证结尾有 `/`、把反斜杠换成 `/`。
 *
 * 🔴 为什么必须保证尾斜杠：`new URL('动画', 'https://h/dav/')` 得到 `https://h/dav/动画`，
 *    而 WebDAV 服务器把它当成**文件**而不是目录 ⇒ `Depth: 1` 的 PROPFIND 回 404 或
 *    「不是集合」。加尾斜杠后 `https://h/dav/动画/` 才是「列这个目录」。
 */
export function normalizeDavSubPath(path: unknown): string {
    const raw = typeof path === 'string' ? path : '';
    const t = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    return t;
}

/**
 * 把子路径里的每一段做百分号编码（空格 / 中文 / `#` / `?` 都必须编）。
 *
 * ⚠️ 用 `encodeURIComponent` 逐段编码，⛔ **不能**整串 `encodeURI`：
 *    后者不编码 `#` 和 `?`，遇到「第 1 集 #01.mp4」这种名字会把 `#` 之后全当锚点丢掉。
 */
export function encodeDavPath(path: string): string {
    // 🔴 尾斜杠由「真的编码出几段」决定，⛔ 不用入参 `path` 是否非空来判断：
    //    传 '/' 或 '///' 时 filter 后段数为 0，若按入参判断会拼出一个空目录 `//`。
    const segs = path
        .split('/')
        .filter((seg) => !!seg)
        .map((seg) => encodeURIComponent(seg));
    return segs.length ? `${segs.join('/')}/` : '';
}

/**
 * 由「入口 + 子路径 + 文件名」拼出可直接写进 `episodeUrls` 的绝对地址。
 *
 * 🔴 这个地址是**给播放器/浏览器**用的，不是给 PROPFIND 用的：
 *    它必须带协议、带百分号编码，且在浏览器里能直接打开（浏览器会弹 Basic Auth 框）。
 */
export function davFileUrl(base: string, dir: string, name: string): string {
    const root = normalizeDavBase(base);
    if (!root) return '';
    const d = normalizeDavSubPath(dir);
    // ⚠️ 逐段编码：目录里的 `/` 是**层级分隔**，⛔ 不能整串 encodeURIComponent
    //    （那会把 `动画/2024` 编成 `动画%2F2024`，服务器找不到目录）。
    const segs = [...d.split('/'), name]
        .filter((s) => !!s)
        .map((seg) => encodeURIComponent(seg));
    if (!segs.length) return '';
    try {
        return new URL(segs.join('/'), root).toString();
    } catch {
        return '';
    }
}
