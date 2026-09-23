// 阅读器深链（纯逻辑，无 obsidian 依赖，可单测）。
//
// 形态：`obsidian://reelludic?action=jump&book=<entryId>&block=<blockId>`
//
// 🔴 为什么挂在 `obsidian://` 下，而不是自定义 scheme（如 `myreader://`）：
//    插件**无法注册 OS 级协议** —— `app.setAsDefaultProtocolClient` 是 Electron **主进程**能力，
//    插件只跑在渲染进程；Obsidian 也不允许插件注册 `obsidian://` 之外的 scheme。
//    Obsidian 提供的原生替代是 `plugin.registerObsidianProtocolHandler(id, cb)` → `obsidian://<id>?…`，
//    生态里 Bible Tools / Slurp / weave-reader（`obsidian://weave-loc`）都是这个形态。
//
// 🔴 为什么参数用 entryId 而不是文件路径：
//    库外绝对路径会随「移动 / 改名」失效，且库外文件在 Obsidian 里本就不可索引；
//    entryId 是插件内的稳定主键（条目删了就是删了，语义明确）。
//
// 双保险：笔记里的 `↩` 由**点击拦截**（捕获阶段）处理；万一漏拦，Obsidian 会把
//    `obsidian://reelludic…` 路由给 `registerObsidianProtocolHandler` —— 两条路走同一个处理器。

/** 深链前缀（解析端靠它判定「这个链接归本插件管」） */
export const READER_DEEP_LINK_PREFIX = 'obsidian://reelludic?';

/** 深链指向的目标 */
export interface ReaderDeepLinkTarget {
    /** 条目 id */
    book: string;
    /** 块 id（`bk…` / `hl…`，**不含** `^`） */
    block: string;
}

/** id 白名单形态：与块 id 的既有校验一致（`[\w-]+`），也是拒绝脏值/注入的依据 */
const ID_RE = /^[\w-]+$/;

/**
 * 🔴 **深链解析的低层入口（前缀与 host 校验的唯一真源）**。
 * 只做三件事：类型/长度校验 → **host 严格比对**（`reelludicx` 之类前缀相近的假货不认）→ 拆 query 成 Map。
 * `action` 的判定留给上层：阅读器认 `jump`、播放器认 `video`（见 `pure/videoLink`）——
 * 两个 action 共用这一处前缀校验，避免各写一套后漂移。
 * 不是本插件的链接 → null。
 */
export function parseDeepLinkParams(url: string): Map<string, string> | null {
    if (typeof url !== 'string') return null;
    const raw = url.trim();
    if (raw.length < READER_DEEP_LINK_PREFIX.length) return null;
    if (raw.slice(0, READER_DEEP_LINK_PREFIX.length).toLowerCase() !== READER_DEEP_LINK_PREFIX) return null;
    const params = new Map<string, string>();
    for (const pair of raw.slice(READER_DEEP_LINK_PREFIX.length).split('&')) {
        if (!pair) continue;
        const i = pair.indexOf('=');
        if (i < 0) continue;
        params.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return params;
}

/** 取一个参数并 `decodeURIComponent`；缺失 / 转义非法（会抛）→ **空串**（不抛给调用方） */
export function deepLinkParam(params: Map<string, string>, key: string): string {
    try {
        return decodeURIComponent(params.get(key) ?? '');
    } catch {
        return '';
    }
}

/** 深链参数值的 id 白名单校验（两个 action 共用同一判据） */
export function isDeepLinkId(value: string): boolean {
    return ID_RE.test(value);
}

/**
 * Obsidian `registerObsidianProtocolHandler` 交过来的参数对象。
 * 值通常是字符串，但也可能是数字 —— 一律当「未知类型」处理，绝不当字符串直接用。
 */
export type DeepLinkParams = Record<string, unknown>;

/**
 * 从**参数对象**里取一个值 → 字符串；缺失 / 类型不对 → 空串（**不抛**，与 `deepLinkParam` 同款口径）。
 * 只接受 `string` 与有限 `number`：`{a:1}` 这类对象值一律当缺参，免得 `[object Object]` 混进 id 校验。
 */
export function deepLinkParamValue(params: DeepLinkParams | null | undefined, key: string): string {
    const v = params?.[key];
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

/**
 * 🔴 **协议处理器入口：按「参数形状」解析阅读器深链（不看 `action`）**。
 *
 * 为什么不能用「把 params 拼回 URL 再交给 `parseReaderDeepLink`」：
 *   Obsidian 的 URI 语义是 **`obsidian://<action>?<params>`** —— **host 本身就是 action**。
 *   它的分发器（`app.js` @2814566 附近）就是 `console.log("Received URL action", e)` 之后按
 *   `e.action` 查已注册的 handler。而 `e.action` 被填成 **host 名**：
 *   用户 2026-09-19 第三次报障的日志实证 ——
 *   ```
 *   Received URL action {action: 'reelludic', entry: 'e_1789309055145_jc7m', ep: '0', t: '430'}
 *   ```
 *   链接里明明白白写的 `action=video` **被吃掉了**（只剩 host 名的 `reelludic`）。
 *   ⇒ 拼回 URL 后 `parseReaderDeepLink` 要求 `jump`、`parseTimeLink` 要求 `video`，**两个都不认**，
 *     处理器于是**静默什么都不做** —— 这就是「点了不跳」而日志里却看得到 URL 已被收到的原因。
 *   ⇒ 判据改成看**参数形状**：`book` + `block` = 阅读器跳转；`entry` = 视频时间戳（见 `pure/videoLink`）。
 *     容错还顺带覆盖了**用户笔记里已经写好的**旧链接（它们的 `action=jump` 同样是死的）。
 */
export function readerDeepLinkFromParams(params: DeepLinkParams | null | undefined): ReaderDeepLinkTarget | null {
    const book = deepLinkParamValue(params, 'book');
    const block = deepLinkParamValue(params, 'block');
    if (!ID_RE.test(book) || !ID_RE.test(block)) return null;
    return { book, block };
}

/** 构造深链；缺少任一参数或非字符串 → null（**不产出不可用的链接**，调用方据此跳过 `↩`） */
export function readerDeepLink(book: string, block: string): string | null {
    const b = typeof book === 'string' ? book.trim() : '';
    const k = typeof block === 'string' ? block.trim() : '';
    if (!b || !k) return null;
    return `${READER_DEEP_LINK_PREFIX}action=jump&book=${encodeURIComponent(b)}&block=${encodeURIComponent(k)}`;
}

/**
 * 解析阅读器深链 → 目标；**不是本插件的链接 / action 不对 / 缺参数 / 脏值一律 null**
 * （调用方据此把事件交回 Obsidian 默认行为 —— 绝不能吞掉用户的普通链接点击）。
 * host 比较忽略大小写（Obsidian 可能归一化）。
 */
export function parseReaderDeepLink(url: string): ReaderDeepLinkTarget | null {
    const params = parseDeepLinkParams(url);
    if (!params) return null;
    if (params.get('action') !== 'jump') return null;
    const book = deepLinkParam(params, 'book');
    const block = deepLinkParam(params, 'block');
    if (!ID_RE.test(book) || !ID_RE.test(block)) return null;
    return { book, block };
}
