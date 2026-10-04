/**
 * 歌词源解析与优先级（2026-09-27 ④-2）—— **纯逻辑，无 `obsidian` 依赖**，可单测。
 *
 * ` ```lrc ` 块是「笔记 ↔ 播放器」之间的**唯一接口**。它里面能出现的东西有四种：
 *  1. `source <音频>`  —— 指向音频（必填才有播放器）
 *  2. `lyrics <歌词文件>` —— **明示**外链歌词（库内 wiki 链接 或 库外绝对路径）
 *  3. 指令行之后的**正文** —— 内联歌词
 *  4. 音频文件**内嵌**标签（ID3 USLT 等）
 * 再加「与音频**同名**的 `.lrc`」这一条隐式路径，共四路歌词来源 ⇒ 本模块负责「从哪一路取」。
 *
 * ## 为什么要有这个模块（两个真源收敛）
 *
 * ⑴ 🔴 **优先级只有一处**：`lyrics 指令` > `块内正文` > `同名 .lrc` > `音频内嵌`。
 *    搞错的观感是「我在笔记里改了歌词，播放器还是唱旧的」——极难自查。
 * ⑵ 🔴 **引用形态判定只有一处**：`source` / `lyrics` 的参数可以是 wiki 链接、库外绝对路径或库内相对路径，
 *    LyricFlux 在**四处**各写了一份（`LyricsMarkdownRender.ts` 106 / 494 / 542 / 553）⇒ 本模块收敛为
 *    `parseLrcRef`，**生成侧**（`noteGenerator`）与**消费侧**（播放器）共用同一套判定，
 *    并由 `tests/lrcSource.test.ts` 的**往返用例**钉住两边不会各走各的。
 *
 * ⚠️ 编码一律走 `pure/txtEncoding.decodeTxtBytes`（红线 11：先读二进制再解码；⛔ 别 `read(…, 'utf8')`）。
 */

/** 歌词来自哪一路（用于在播放器里如实显示「歌词来源」） */
export type LrcLyricsOrigin = 'directive-file' | 'inline' | 'sibling' | 'embedded';

/** 引用形态：wiki 链接 / 库外绝对路径 / 库内相对路径 */
export type LrcRefKind = 'wiki' | 'absolute' | 'vault';

export interface LrcRef {
    kind: LrcRefKind;
    /** 规整后的值（wiki 已剥掉 `[[ ]]` 与显示别名） */
    value: string;
}

/** ` ```lrc ` 块解析结果 */
export interface LrcBlock {
    /** `source <x>` 的**原始参数**（未判定引用形态，需要时交给 `parseLrcRef`） */
    audio?: string;
    /** `lyrics <x>` 的**原始参数** */
    lyrics?: string;
    /** 是否出现遗留的 `embedded-lyrics` 指令（LyricFlux 已不依赖它，保留只为兼容旧笔记） */
    embedded: boolean;
    /** 指令区之后的正文（内联歌词；已 trim；空串表示没有） */
    inline: string;
}

/** 🔴 必须**紧跟一个空格**：`sourcebook …` 不是指令、`source` 单独成行也不是 */
const DIR_AUDIO = /^source (.*)/i;
const DIR_LYRICS = /^lyrics (.*)/i;
const DIR_EMBEDDED = /^embedded-lyrics\s*$/i;

/** 是否是指令行（与 `parseLrcBlock` 的扫描口径**同源**：三个正则共用，⛔ 别在别处另抄一份） */
function isLrcDirective(line: string): boolean {
    return DIR_AUDIO.test(line) || DIR_LYRICS.test(line) || DIR_EMBEDDED.test(line);
}

/** 完整 wiki 链接（含可选显示别名 `|别名`） */
const WIKI_REF = /^\[\[([\s\S]*)\]\]$/;

/** 库外绝对路径：盘符（两种斜杠）/ UNC（`\\server\share`）/ POSIX 根
 *  ⚠️ UNC 的**正斜杠**写法（`//server/share`）**不在这里** —— 它由下面 `startsWith('/')` 那条兜住，
 *     两条合起来才覆盖两种写法。⛔ 别把 `startsWith('/')` 当「多余分支」删掉（删了正斜杠 UNC 会被
 *     当成库内相对、包成 `[[//server/…]]` 断链）。 */
const ABS_WIN = /^[A-Za-z]:[\\/]/;
const ABS_UNC = /^\\\\/;

/**
 * 定位**第一个** ` ```lrc ` 围栏块，返回开 / 闭两行的下标（`null` = 没有块或未闭合）。
 *
 * 🔴 **生成侧与消费侧必须共用这一处**：`extractLrcBlock`（读块）与 `withLrcLyrics`（写回）都要认围栏，
 *    两份正则迟早分叉 —— 后果是「笔记里看着有歌词、播放器说找不到」，且两边都不报错。
 *    `tests/lrcSource.test.ts` 的往返用例 + 产物断言里的「围栏正则全产物恰 1 处」共同钉住这一点。
 *
 * 口径：
 *  - 开启围栏 = 行首（允许缩进）+ **3 个以上**反引号 + `lrc`（大小写不敏感）+ 行尾；
 *    ` ```lrc2 ` / ` ```lrc 注释 ` 这类**不算**（否则会把别的语言的块吃掉）。
 *  - 闭合围栏的反引号数**不少于**开启围栏（CommonMark 规则）⇒ ` ````lrc ` 块里含 ` ``` `
 *    也不会被提前截断。
 *  - 多块时取**第一块**（`noteGenerator` 只生成一块）。
 */
function findLrcFence(lines: string[]): { open: number; close: number } | null {
    const open = /^\s*(`{3,})\s*lrc\s*$/i;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(open);
        if (!m) continue;
        const fence = m[1].length;
        for (let j = i + 1; j < lines.length; j++) {
            const close = lines[j].match(/^\s*(`{3,})\s*$/);
            if (close && close[1].length >= fence) return { open: i, close: j };
        }
        return null; // 未闭合
    }
    return null;
}

/** 按行切分 + 归一 CRLF（围栏扫描的入参预处理，两处共用同一句） */
function lrcLines(markdown: string): string[] {
    return String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * 从条目笔记正文里取出**第一个** ` ```lrc ` 围栏块的内容（⛔ 不含围栏行本身）。
 *
 * 🔴 为什么必须有它：`parseLrcBlock` 解析的是**块内**内容，而笔记里那段内容是被围栏包着的。
 *    若每个消费方各自写一遍「找围栏」，口径必然分叉（只认 3 个反引号 / 把围栏当内容 / 认错大小写）。
 *    放在 `lrcSource` = **生成侧写块（`noteGenerator`）与消费侧读块（播放器）共用同一份围栏口径**。
 */
export function extractLrcBlock(markdown: string): string | null {
    const lines = lrcLines(markdown);
    const f = findLrcFence(lines);
    return f ? lines.slice(f.open + 1, f.close).join('\n') : null;
}

/** 解析 ` ```lrc ` 块的指令区（与 LyricFlux `LyricsMarkdownRender.onload` 的扫描口径一致） */
export function parseLrcBlock(source: string): LrcBlock {
    const out: LrcBlock = { embedded: false, inline: '' };
    const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
    let end = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const audio = line.match(DIR_AUDIO);
        const lyrics = line.match(DIR_LYRICS);
        if (audio) {
            out.audio = audio[1];
            end = i + 1;
        } else if (lyrics) {
            out.lyrics = lyrics[1];
            end = i + 1;
        } else if (DIR_EMBEDDED.test(line)) {
            out.embedded = true;
            end = i + 1;
        } else {
            // 第一条非指令行 ⇒ 指令区到此结束（其后的 `source` 行算正文；与 LyricFlux 同口径）
            break;
        }
    }
    out.inline = lines.slice(end).join('\n').trim();
    return out;
}

/**
 * 取 ` ```lrc ` 块里的**歌词正文**（＝指令区之后的非指令行）。
 *
 * 🔴 这是「**块内歌词归用户所有**」的读取端：条目表单的 LRC 框、播放器的内联歌词都读它。
 *    `source` / `lyrics` 指令行**不算**歌词正文（它们由 `audioPath` 生成，见 `formatLrcSourceDirective`）。
 * 无块 / 未闭合 / 只有指令行 ⇒ `''`（不是 `null`：调用方要的是「框里该显示什么」，空串即可）。
 */
export function lrcBlockLyrics(markdown: string): string {
    const body = extractLrcBlock(markdown);
    return body === null ? '' : parseLrcBlock(body).inline;
}

/**
 * 把**歌词正文**写回 ` ```lrc ` 块（生成侧的写端，与 `lrcBlockLyrics` 成对）。
 *
 * 🔴 为什么必须有它：`EntryService.writeNote` 是**整篇模板重写**，而模板只会按 `audioPath` 写出
 *    `source` 指令行 —— 用户填过 / 在线获取的歌词**若不搬回，保存一次就没了**（静默丢数据）。
 *    所以模板重写前先 `lrcBlockLyrics(旧笔记)`、重写后 `withLrcLyrics(新笔记, 旧歌词)`。
 *
 * 语义（三条都要记住，否则会出「清不掉」或「多写盘」）：
 *  - 块体 = **指令行 + 空行 + 歌词正文**；指令行原样保留，**正文整段替换**（不是追加 ——
 *    歌词的主人只有一个，就是调用方给的这个字符串）。
 *  - `lyrics` 为空 / 全空白 ⇒ 只留指令行（**这就是「清空歌词框」能生效的实现**，⛔ 别改成 no-op）。
 *  - 找不到块 / 块未闭合 / 结果与输入相同 ⇒ **原样返回**（调用方据此跳过写盘）。
 */
export function withLrcLyrics(markdown: string, lyrics: string): string {
    const src = String(markdown ?? '');
    const lines = lrcLines(src);
    const f = findLrcFence(lines);
    if (!f) return src; // 无块 / 未闭合 ⇒ 不动（⛔ 不许凭空造一个块出来）
    // 指令区 = 块体开头连续的指令行（与 `parseLrcBlock` 的 break 口径一致）
    const dirs: string[] = [];
    for (let k = f.open + 1; k < f.close; k++) {
        if (!isLrcDirective(lines[k])) break;
        dirs.push(lines[k]);
    }
    const body = String(lyrics ?? '').trim();
    const next = body ? [...dirs, '', ...body.split('\n')] : dirs;
    const out = [...lines.slice(0, f.open + 1), ...next, ...lines.slice(f.close)].join('\n');
    return out === src ? src : out;
}

/** 空白（含只有 `\n`）不算「有歌词」—— 否则会把下一档挡住 */
function usable(text: string | undefined): string | null {
    const s = String(text ?? '');
    return s.trim() ? s : null;
}

/**
 * 四路歌词源里挑一个用。
 * 🔴 优先级：**`lyrics` 指令指向的文件 > 块内正文 > 同名 `.lrc` > 音频内嵌标签**
 * （前两档与 LyricFlux 一致；第三档是 ④ 新增的增强，插在内联之后、内嵌之前）。
 */
export function pickLyrics(c: {
    directiveFile?: string;
    inline?: string;
    sibling?: string;
    embedded?: string;
}): { text: string; origin: LrcLyricsOrigin } | null {
    const order: { origin: LrcLyricsOrigin; text: string | undefined }[] = [
        { origin: 'directive-file', text: c.directiveFile },
        { origin: 'inline', text: c.inline },
        { origin: 'sibling', text: c.sibling },
        { origin: 'embedded', text: c.embedded },
    ];
    for (const { origin, text } of order) {
        const ok = usable(text);
        if (ok !== null) return { text: ok, origin };
    }
    return null;
}

/**
 * 与音频**同名**的 `.lrc` 路径（④ 新增的增强；LyricFlux 明确没做）。
 * 只换**最后一段文件名**的扩展名，目录部分（含 `1.0` 这类带点的目录名）原样保留；
 * 分符风格照抄输入（`\` / `/` 各自保留），本身就是 `.lrc` 时原样返回（幂等）。
 */
export function siblingLrcPath(audioPath: string): string | null {
    const p = String(audioPath ?? '').trim();
    if (!p) return null;
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const dir = cut < 0 ? '' : p.slice(0, cut + 1);
    const name = cut < 0 ? p : p.slice(cut + 1);
    if (!name) return null;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return `${dir}${stem}.lrc`;
}

/** 判定 `source` / `lyrics` 的参数属于哪种引用（wiki / 库外绝对 / 库内相对） */
export function parseLrcRef(raw: string): LrcRef | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const wiki = s.match(WIKI_REF);
    if (wiki) {
        // `[[路径|显示名]]` ⇒ 只取路径（⛔ 把别名当文件名会永远找不到文件）
        const value = wiki[1].split('|')[0].trim();
        return value ? { kind: 'wiki', value } : null;
    }
    if (ABS_WIN.test(s) || ABS_UNC.test(s) || s.startsWith('/')) return { kind: 'absolute', value: s };
    return { kind: 'vault', value: s };
}

/**
 * 生成笔记里的 `source` 行 —— **生成侧与消费侧共用同一套判定**。
 * 库内相对 ⇒ `source [[路径]]`；库外绝对 ⇒ `source 路径`；空值 ⇒ `''`（调用方据此不写这一行）。
 */
export function formatLrcSourceDirective(audioPath: string): string {
    const ref = parseLrcRef(audioPath);
    if (!ref) return '';
    return ref.kind === 'absolute' ? `source ${ref.value}` : `source [[${ref.value}]]`;
}
