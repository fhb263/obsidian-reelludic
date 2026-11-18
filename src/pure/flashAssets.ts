/**
 * 「一个 swf 到底是什么」—— 它有没有引用**外部资源**，以及引用了哪些（2026-11-16）。
 *
 * ## 为什么需要这一层（用户报障）：「怎么下载出的就一个 swf 文件没有其他的吗」
 * 参考项目 `FlashGameDownloader` 的「关联文件」是靠**本地 HTTP 服务器**做到的：它把游戏页面
 * 托管在 `localhost:1055+`，SWF 每请求一个图片/音频/子 swf，`on_request_start` 就当场下载到镜像路径
 * （见其 `AutoDownloader.on_request_start`）。那套机制在 Obsidian 里没有对应物 ——
 * 我们的 Ruffle 从 `app://` 加载，请求根本不经过插件。
 *
 * ## 替代路径：Ruffle 会按 **swf 自己的地址**解析相对路径
 * 所以只要把关联资源下载到**与 swf 同一目录、同一相对名**，Ruffle 再请求 `sounds/bgm.mp3`
 * 时就会命中 `app://…/下载/Flash 游戏/sounds/bgm.mp3`。⇒ 关键变成「先知道要下哪些名字」，
 * 而这正是本文件做的事：从 swf 的字节里把**相对资源名**扫出来。
 *
 * ## ⛔ 三条不许踩
 *  ① **不引第三方解析器**：这是 SWF 二进制里的纯字符串扫描，不是 AS 反编译。
 *  ② **不猜域名**：只收**相对**路径（`sounds/a.mp3`、`a.png`）；带 `://` 的绝对地址一律跳过 ——
 *     那类跨域资源即使下载了也放不回原位置（Ruffle 请求的是它自己的域名）。
 *  ③ **不上报海量垃圾**：SWF 里有大量非资源字符串（类名、变量名）。只认白名单扩展名 + 上限截断。
 */

/** 认得的关联资源扩展名 —— 只收「SWF 会去请求的静态文件」，不含 `swf`（子影片另行判断） */
export const ASSET_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'mp3', 'wav', 'ogg', 'xml', 'json', 'txt', 'dat'] as const;

/** 子影片扩展名（`loadMovie` 常见目标，单独一类，因为要不要跟着下得看它是不是相对路径） */
export const MOVIE_EXTS = ['swf'] as const;

/** 一次最多返回多少个候选（防某些 swf 里嵌了上千个字符串把下载队列撑爆） */
export const ASSET_REF_MAX = 24;

/** 单个路径长度上限（再长基本是压缩数据被误判成字符串） */
const REF_MAX_CHARS = 120;

/**
 * SWF 里「看着像资源名」的候选。
 *
 * 只匹配 ASCII 可打印段里的 `名字.扩展名`，且**整段不能含空白**（真实资源名极少带空格，
 * 而带空白的多半是两个相邻字符串被连读了）。
 */
const REF_RE = /[A-Za-z0-9_\-.~%]+(?:\/[A-Za-z0-9_\-.~%]+)*\.(?:png|jpg|jpeg|gif|bmp|mp3|wav|ogg|xml|json|txt|dat|swf)/gi;

/** 绝对地址 / 协议相对 / 盘符 / 以 `/` 开头的，一律不算「可回填到同目录」的关联资源 */
function isRelativeRef(ref: string): boolean {
    const s = String(ref ?? '');
    if (!s) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return false; // http: / file: / app:
    if (s.startsWith('//')) return false;
    if (s.startsWith('/')) return false;
    if (/^[a-zA-Z]:[\\/]/.test(s)) return false;
    if (s.includes('..')) return false; // 越出 swf 目录的，落不回原位
    return true;
}

/**
 * 匹配处在 `http://`、`//`、`/` 之后 —— 说明它是那条**绝对地址的尾巴**，不是独立相对路径。
 *
 * 🔴 为什么必须有这一步（实测踩到）：`http://game.miniclip.com/x.swf` 里，
 *    正则会从 `game.miniclip.com/x.swf` 开始匹配，光看匹配结果本身完全像个相对路径；
 *    不看前文就会把一堆跨域地址当成「可回填的关联资源」。
 */
function precededByAbsolute(text: string, index: number): boolean {
    const before = text.slice(Math.max(0, index - 10), index);
    return /(?:\/|:)$/.test(before);
}

/**
 * 从 swf 字节里扫出**相对资源名**（去重、保序、截断到 `ASSET_REF_MAX`）。
 *
 * ⚠️ 这是**启发式**：漏报安全（继续单文件播放），误报也只是多下一个 404 ——
 *    调用方必须把每个失败都当正常情况，⛔ 别因为某个资源 404 就判定整个「获取」失败。
 * ⚠️ 解压过的 swf（`CWS`/`ZWS`）里，压缩段内的字符串扫不到。本函数只扫**可见字节**，
 *    这意味着一部分游戏会返回空列表 —— 正常，退回单文件播放即可。
 */
export function extractAssetRefs(bytes: Uint8Array | undefined, max = ASSET_REF_MAX): string[] {
    const b = bytes ?? new Uint8Array(0);
    if (b.byteLength === 0) return [];
    // latin1 保证「字节 → 字符」一对一（⛔ 别用 utf8：解不出来的段会丢字节，偏移全乱）。
    // ⛔ 不用 Node 的字节容器全局：本层要能同时跑在纯单测与被 bundler 摇树的场景里。
    let text = '';
    const chunk = 8192;
    for (let i = 0; i < b.byteLength; i += chunk) {
        const end = Math.min(i + chunk, b.byteLength);
        const codes: number[] = [];
        for (let k = i; k < end; k += 1) codes.push(b[k]);
        text += String.fromCharCode.apply(null, codes);
    }
    const out: string[] = [];
    const seen = new Set<string>();
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null = REF_RE.exec(text);
    while (m && out.length < max) {
        const ref = m[0];
        if (ref.length <= REF_MAX_CHARS && !precededByAbsolute(text, m.index) && isRelativeRef(ref)) {
            const key = ref.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                out.push(ref);
            }
        }
        m = REF_RE.exec(text);
    }
    return out;
}

/**
 * Flash Player **自身**会去找、但不是游戏资源的文件名 —— 一律不进下载队列。
 *
 * 🔴 实测（4399 的 `04.swf`）：解压后能扫到 `fl.dat` 与 `flash.xml`，两个都 404。
 *    它们是播放器内建约定（本地存储 / 播放列表），不是站点上的文件；
 *    真去下只是白发两个请求、还会让日志看起来像「找到资源了」。
 */
const IGNORED_REFS = new Set(['fl.dat', 'flash.xml', 'crossdomain.xml', 'clientaccesspolicy.xml']);

/** 主影片名（用于换算「关联资源相对谁」）——与 `swfFileNameOf` 同口径，只取末段 */
export function baseNameOf(ref: string): string {
    const s = String(ref ?? '').split(/[?#]/)[0];
    const parts = s.split('/');
    return parts[parts.length - 1] ?? '';
}

/**
 * 把 swf 里的引用解析成**相对下载路径**，并剔除主影片自己。
 *
 * 🔴 `movieName` 传的是**下载时的原始文件名**（如 `04.swf`），不是落库后重命名的「游戏名.swf」——
 *    swf 内部的自我引用只可能用原始名，拿重命名后的名字比对永远比不上。
 *    用户明确要求把文件重命名为游戏名（m03437），那个改名发生在**写盘时**，与本函数无关。
 */
export function planAssetRefs(refs: readonly string[], movieName: string): string[] {
    const skip = baseNameOf(movieName).toLowerCase();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of refs ?? []) {
        const ref = String(raw ?? '').trim();
        if (!ref || !isRelativeRef(ref)) continue;
        const base = baseNameOf(ref).toLowerCase();
        if (!base) continue;
        if (IGNORED_REFS.has(base)) continue;
        if (skip && base === skip) continue;
        const key = ref.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(ref);
    }
    return out;
}
