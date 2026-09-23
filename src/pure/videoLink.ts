// 播放器「时间戳 ↔ 笔记」纯逻辑（无 obsidian 依赖，可单测）。
//
// 三件事：① 构造时间戳链接 ② 解析笔记里的时间戳链接（点击跳转用）③ 拼截图块。
//
// 🔴 链接**双轨**（用户 2026-09-19 裁定 D-1：生态标准优先 + 库外走深链），两者**都包 markdown 链接语法**
//    （对比文字 = **只有时间** `5:56`，见 `backLinkText` 的注释；⛔ 不留空白、也不要返回裸 URL）：
//    · **库内**视频 → `[5:56](影片.mp4#t=356)` —— W3C **Media Fragment URI**，是 Obsidian 生态标准形态
//      （Media Extended 同款），别的工具/导出后也认。
//    · **库外**视频 → `[5:56](obsidian://reelludic?action=video&entry=<id>&ep=<集>&t=356)` ——
//      ❌ 库外绝对路径在 Obsidian 里**写不出可解析的链接**（`fileToLinktext` 只认库内文件，见 #323 同款死结），
//      只能用条目 id 走深链。深链的前缀/host 校验沿用 `pure/readerLink`（单一真源）。
//
// 🔴 为什么不用用户原案 `video://filename?t=3`：
//    ⑴ 插件**注册不了 OS 级自定义协议**（`app.setAsDefaultProtocolClient` 是 Electron 主进程能力，
//       插件只跑渲染进程 —— #323 的 `myreader://` 已核实过一次）；
//    ⑵ 未注册 scheme 的链接在库里是**死链**（交给系统 → 打开失败），点击拦截一旦漏命中就没有兜底；
//    ⑶ 生态标准是把 `#t=` 挂在真实文件链接上，用标准形态别的工具也认。
//    但**解析端仍兼容 `?t=`**（用户手写 `?t=3` 也能生效，顺着他原来的直觉）。

import { formatTime } from 'pure/player';
import {
    deepLinkParam,
    deepLinkParamValue,
    isDeepLinkId,
    parseDeepLinkParams,
    READER_DEEP_LINK_PREFIX,
    type DeepLinkParams,
} from 'pure/readerLink';

/** 深链动作名（与阅读器的 `action=jump` 并列，前缀仍是同一个 `obsidian://reelludic?`） */
export const VIDEO_DEEP_LINK_ACTION = 'video';

/** 带 scheme 的 URL（`xxx://`）：用来区分「库内相对路径」与「外部网页链接」——后者一律不接管 */
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** 时间戳链接的两种指向 */
export type VideoTimeTarget =
    /** 库内文件：交给宿主按路径反查条目（路径含空格时 `<>` 已被剥掉，且可能 `%20` 编码） */
    | { kind: 'vault'; filePath: string; seconds: number }
    /** 库外/库内均可：按条目 id 定位（库外视频只有这一条路） */
    | { kind: 'entry'; entryId: string; ep: number; seconds: number };

/** 秒数文本 → 秒（`3` / `12.5` / `0:03` / `1:02:03`）；非法 / 负 / 超上限 → null */
export function parseSecondsText(text: string): number | null {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return null;
    const parts = raw.split(':');
    if (parts.length > 3) return null;
    let total = 0;
    for (const p of parts) {
        if (!/^\d+(?:\.\d+)?$/.test(p)) return null;
        total = total * 60 + Number(p);
    }
    if (!Number.isFinite(total) || total < 0) return null;
    // 上限：24 小时。防脏值把播放器 seek 到一个荒谬位置（也能挡住明显的手写错误）
    if (total > 86400) return null;
    return total;
}

/**
 * 从链接里取时间戳秒数：认 `#t=`（Media Fragment 标准）与 `?t=`（用户手写习惯）；
 * 形如 `#t=3,10` 的**范围**只取起点（播放器无片段播放语义，见设计文档 §4.6）。
 * 没有该片段 / 非法 → null。
 */
export function parseMediaFragmentTime(href: string): number | null {
    const raw = typeof href === 'string' ? href.trim() : '';
    if (!raw) return null;
    const m = /[#?&]t=([^&#\s]*)/i.exec(raw);
    if (!m) return null;
    const start = (m[1] ?? '').split(',')[0] ?? '';
    return parseSecondsText(start);
}

/** 文件名清洗：去掉路径分隔符与 Obsidian 链接禁用字符，供截图文件名用 */
export function sanitizeFileStem(name: string, fallback = '截图'): string {
    const cleaned = (typeof name === 'string' ? name : '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || fallback;
}

/** 截图文件名：`<片名> 00-03.png`（时间戳进文件名 → 不看笔记也能认出是哪一刻） */
export function shotFileName(title: string, seconds: number, ext = 'png'): string {
    const stamp = formatTime(seconds).replace(/:/g, '-');
    return `${sanitizeFileStem(title)} ${stamp}.${ext}`;
}

/**
 * 链接文字 = **只有时间**（`7:46`）。
 *
 * 🔴 **口径改判（用户 2026-09-19）**：原先写 `7:46·回到视频`，用户明确要求**去掉「·回到视频」** → 只留时间。
 * （历史笔记里带尾巴的旧块**照样能点** —— 拦截器认的是**链接目标**，不是文字，所以不需要迁移。）
 *
 * ⛔ **文字里不许出现空白**：Obsidian 编辑器判断「鼠标下这段是不是链接」时会**在第一个空白处截断 token**
 * （app.js `UE()`），碎片被当 URL 去 `new URL()` 解析 → 控制台 `Invalid URL`（**悬停就触发**）。
 * 现在只有时间、天然无空白；但**将来若再给文字加后缀，必须仍然无空格**（例如 `7:46-笔记`）。
 */
export function backLinkText(seconds: number): string {
    return formatTime(seconds);
}

/**
 * 构造时间戳链接（双轨，按给了哪个 id 自动选形态）。
 * **缺少可定位的参数 → null**（不产出不可用链接，调用方据此跳过插入）。
 * `filePath` 含空格时用 `<>` 包住（markdown 对含空格链接的标准写法）。
 * 默认文字 = **只有时间** `5:56`（用户 2026-09-19 改判：**去掉「·回到视频」尾巴**；见 `backLinkText`）。
 */
export function buildTimeLink(opts: {
    seconds: number;
    label?: string;
    /** 库内：vault 内的链接文本（相对路径）。优先于 entryId 使用 */
    filePath?: string;
    /** 库外/兜底：条目 id */
    entryId?: string;
    /** 集下标（0 基）；库内按文件名区分集，可省 */
    ep?: number;
}): string | null {
    const sec = Number.isFinite(opts.seconds) && opts.seconds > 0 ? Math.floor(opts.seconds) : 0;
    const label = (opts.label ?? '').trim() || backLinkText(sec);
    const file = (opts.filePath ?? '').trim();
    if (file) {
        const frag = `${file}#t=${sec}`;
        const dest = /\s/.test(frag) ? `<${frag}>` : frag;
        return `[${label}](${dest})`;
    }
    const entry = (opts.entryId ?? '').trim();
    if (!entry || !isDeepLinkId(entry)) return null;
    const ep = Number.isFinite(opts.ep) && (opts.ep as number) > 0 ? Math.floor(opts.ep as number) : 0;
    const dest = `${READER_DEEP_LINK_PREFIX}action=${VIDEO_DEEP_LINK_ACTION}&entry=${encodeURIComponent(entry)}&ep=${ep}&t=${sec}`;
    // 🔴 **必须包成 markdown 链接**（2026-09-19 用户实测报障）：首版这条分支直接返回**裸 URL** →
    //    ⑴ 笔记里只看到一串 `obsidian://…` 文本，不是 `[5:56](…)`；
    //    ⑵ 更致命：**裸 URL 在阅读视图会被 Obsidian 自动链接化（点得动）、在编辑视图/实时预览里只是文本（点不动）**
    //       → 症状表现为「编辑视图跳不了，只能阅读视图跳」。两条报告同一个根因。
    return `[${label}](${dest})`;
}

/**
 * 解析笔记里的时间戳链接 → 目标；**不是时间戳链接一律 null**（调用方据此把事件交回 Obsidian，
 * 绝不能吞掉用户的普通链接点击）。
 *
 * 只认两种形态：
 *   ① `obsidian://reelludic?action=video&entry=…&ep=…&t=…`（本插件深链）
 *   ② **无 scheme** 的库内路径 + `#t=`/`?t=`（如 `影片.mp4#t=3`、`目录/我的 影片.mp4?t=3`）
 * ⛔ **带 scheme 的外链（http/https/…）一律不接管** —— 播放器只播本地文件，
 *    外链应当交给系统浏览器（否则点一个网页视频链接会「什么都没发生」）。
 */
export function parseTimeLink(href: string): VideoTimeTarget | null {
    const raw = typeof href === 'string' ? href.trim() : '';
    if (!raw) return null;

    // ① 本插件深链
    const params = parseDeepLinkParams(raw);
    if (params) {
        if (params.get('action') !== VIDEO_DEEP_LINK_ACTION) return null;
        const entryId = deepLinkParam(params, 'entry');
        if (!isDeepLinkId(entryId)) return null;
        const seconds = parseSecondsText(deepLinkParam(params, 't'));
        if (seconds === null) return null;
        const ep = parseSecondsText(deepLinkParam(params, 'ep'));
        return { kind: 'entry', entryId, ep: ep === null ? 0 : Math.floor(ep), seconds };
    }

    // ② 库内路径形态。带 scheme 的不是库内文件 → 放行给系统
    if (HAS_SCHEME_RE.test(raw)) return null;
    const seconds = parseMediaFragmentTime(raw);
    if (seconds === null) return null;
    // 去掉片段与查询，得到文件路径；`<>` 可能已被浏览器剥掉，但 URL 编码要还原
    const filePart = raw.split(/[#?]/)[0] ?? '';
    let filePath = filePart.trim();
    try {
        filePath = decodeURIComponent(filePath);
    } catch {
        /* 非法转义按原样处理 */
    }
    if (!filePath || filePath === '.' || filePath.startsWith('/')) return null;
    return { kind: 'vault', filePath, seconds };
}

/** markdown 链接形态（`buildShotBlock` 只接受这个 —— 见下） */
const MD_LINK_RE = /^\[[^\]]+\]\(.+\)$/;

/**
 * 截图块（用户 2026-09-19 裁定 D-3 Ⓑ「极简两行」）：
 * ```
 * ![[截屏 片名 00-03.png]]
 * [00:03](obsidian://…)
 * ```
 * 图直接铺开、回跳链接紧随其下 —— 图文对照最直接（不套 callout）。
 *
 * 🔴 **入参 `timeLink` 必须是「已包好 markdown 链接语法」的完整链接**（= `buildTimeLink` 的产物，
 * 调用方直接把同一个变量传进来）。本函数**只做两行拼接**，自己**不拼任何链接**。
 *
 * ⚠️ **2026-09-19 用户报障「截图生成的时间戳无法跳转」的真根因**：旧签名收的是「裸目标」（`a.mp4#t=3`），
 * 而**唯一的真实调用方** `saveVideoShot` 传进来的却是 `buildTimeLink` 的产物（完整 markdown 链接）
 * ⇒ 产出**嵌套链接**：
 * ```
 * ![[图]]
 * [7:46·回到视频]([7:46·回到视频](obsidian://reelludic?action=video&…))   ← 完全点不动
 * ```
 * 而**单测用的恰好是裸目标** ⇒ **测试全绿、真实路径全坏**（从 v54 一路跑到 v58 五轮都没抓到）。
 * ⇒ 两处防复发：⑴ 入参名从 `link` 改成 **`timeLink`**、并**去掉 `seconds`**（label 由 `buildTimeLink` 决定，
 *    这里再算一遍就是两处真源）；⑵ **fail-closed**：传进来的若不是 markdown 链接形态，直接返回空串
 *    —— 宁可什么都不写，也**绝不产出「点不动的裸 URL 行」**（裸 URL 在编辑视图只是文本，见 #328）。
 */
export function buildShotBlock(opts: { fileName: string; timeLink: string }): string {
    const name = (opts.fileName ?? '').trim();
    const link = (opts.timeLink ?? '').trim();
    if (!name || !MD_LINK_RE.test(link)) return '';
    return `![[${name}]]\n${link}`;
}

/**
 * 🔴 **协议处理器入口：按「参数形状」解析视频时间戳深链（不看 `action`）**。
 * 为什么不能拼回 URL 再解析 —— 见 `pure/readerLink.readerDeepLinkFromParams` 的长注释
 * （Obsidian 把 `action` 覆盖成 host 名，用户 2026-09-19 日志实证 `{action:'reelludic', entry:…, t:'430'}`）。
 *
 * 宽严口径（有意为之）：
 *   · **严在 id** —— `entry` 必须过 `isDeepLinkId` 白名单（这条同时挡住「把别人的链接当自己的」）。
 *   · **宽在时间** —— `entry` 合法就已经证明「这是本插件的链接」，所以 `ep` / `t` 缺失或非法一律按 `0`。
 *     宁可「打开视频从头播」，也**绝不再出现「点了什么都不发生」** —— 后者正是这三轮报障的东西。
 *     （`parseSecondsText` 的上限 24h 仍生效：超范围的值也只是退回 0，不会 seek 到荒谬位置。）
 */
export function videoDeepLinkFromParams(params: DeepLinkParams | null | undefined): VideoTimeTarget | null {
    const entryId = deepLinkParamValue(params, 'entry');
    if (!isDeepLinkId(entryId)) return null;
    const seconds = parseSecondsText(deepLinkParamValue(params, 't'));
    const ep = parseSecondsText(deepLinkParamValue(params, 'ep'));
    return { kind: 'entry', entryId, ep: ep === null ? 0 : Math.floor(ep), seconds: seconds === null ? 0 : seconds };
}

/**
 * 行内 markdown 链接：`[文字](目标)`；目标允许用 `<>` 包住（含空格的路径的标准写法）。
 * 目标里不许有空白/右括号（不带 `<>` 时 markdown 本就不允许）。
 */
const INLINE_LINK_RE = /\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^)\s]*))\s*\)/g;

/**
 * 抽出一行里的**全部** markdown 链接（`[文字](目标)`；目标被 `<>` 包住时自动剥掉，含空格路径的标准写法不放空白）。
 * 🔴 **`matchLineLink` 与标记解析（`pure/videoMarks`）共用这一处正则** —— 别在别处再写一份（两份必然漂）。
 */
export function inlineLinks(lineText: string): { label: string; dest: string }[] {
    const line = typeof lineText === 'string' ? lineText : '';
    const out: { label: string; dest: string }[] = [];
    INLINE_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_LINK_RE.exec(line)) !== null) {
        const dest = (m[2] ?? m[3] ?? '').trim();
        if (!dest) continue;
        out.push({ label: (m[1] ?? '').trim(), dest });
    }
    return out;
}

/**
 * 🔴 **编辑器（Live Preview / 源码模式）里取回「用户点的那条链接」的目标**（2026-09-19 用户第三次报障）。
 *
 * 为什么需要它：编辑视图里的链接**不是 `<a>`** —— 读 Obsidian 核心 `onEditorClick`（app.js @2548591）
 * 得到判据：它认可点 token 只认 `.external-link` / `.cm-url` / `.cm-link` / `.cm-underline` 这些
 * **CM6 span**。于是靠 `target.closest('a')` 的拦截器在编辑视图**恒为 null** → 直接 return →
 * 编辑视图永远拦不到（阅读视图是 `<a>`，所以那里能跳）。症状正是「只能阅读视图跳 / 编辑视图跳不了」。
 *
 * 而 CM6 的链接目标**不在 DOM 属性上**（渲染出来的只是显示文字）→ 唯一可靠来源是**所在行的 markdown 源码**。
 * 判据（两者任一命中即算「点的是这条链接」）：
 *   · 点击处文字 === 该链接的**显示文字**（LP 渲染后点到的就是显示文字）
 *   · 点击处文字 === 该链接的**目标**（源码模式 / LP 把 URL 单独渲染成 `.cm-url`）
 * **不会误吞普通点击**：点是行内别的字、或点整行（点到行元素本身）时文字都对不上，一律返回 null。
 */
export function matchLineLink(lineText: string, clickedText: string): string | null {
    const line = typeof lineText === 'string' ? lineText : '';
    const clicked = typeof clickedText === 'string' ? clickedText.trim() : '';
    if (!line || !clicked) return null;
    for (const l of inlineLinks(line)) {
        if (l.label === clicked || l.dest === clicked) return l.dest;
    }
    return null;
}
