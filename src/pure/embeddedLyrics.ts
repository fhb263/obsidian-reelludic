/**
 * 内嵌歌词读取（第 4 路歌词源，2026-09-27 #391）—— **纯字节解析**，无 `obsidian` / fs / DOM 依赖，可单测。
 *
 * ## 为什么要有这个模块
 *
 * 本仓的四路歌词源是 `lyrics 指令 > 块内正文 > 同名 .lrc > **音频内嵌**`（真源 `pure/lrcSource.pickLyrics`）。
 * 前三路都要求「用户手上有独立的歌词文件」；而实际上 mp3 的 **ID3v2 `USLT` 帧**里常常就是一份完整 LRC
 * （#391 实测用户库：`4-Archive/music-attach/Musics/` 下 `.lrc` 文件 **0 个**，但 4 首歌的 USLT 里
 * 都躺着带时间戳的 LRC）⇒ 缺这一路，播放器只会一直显示「未找到歌词」，用户的第一反应就是「歌词怎么不同步过来」。
 *
 * ## 与其他模块的分工
 *
 * - 本模块只负责「**把音频字节变成一段歌词文本**」，⛔ **不做 LRC 解析**（那是 `pure/lrc.ts` 的事）。
 * - 判定「四路取哪一路」也⛔ 不在这里（那是 `pure/lrcSource.pickLyrics` 的事）——它只把我们返回的字符串当第 4 档候选。
 *
 * ## 金标准
 *
 * 同作者 LyricFlux 的 `src/renderers/{id3,vorbis,ogg,mp4}.ts`（口径照搬，实现重写为纯函数 + 单测）。
 * ⚠️ 照搬的是**判定口径**，不是代码：原实现依赖 `jsmediatags` 的辅助类型与 `ArrayBuffer`，
 * 这里统一收成 `Uint8Array` 入参、失败一律回 `null`（⛔ 绝不抛），并按「喂脏值会怎样」重新复核了每个循环。
 */
import { decodeTxtBytes } from './txtEncoding';

/** 能识别的容器（按魔数判定；识别不出 ⇒ `unknown`） */
export type AudioContainer = 'id3v2' | 'flac' | 'ogg' | 'mp4' | 'unknown';

/**
 * 按 **ID3 的「文本编码字节」** 解码。
 *
 * | 字节 | 名义含义 | 实际怎么解 |
 * |------|---------|-----------|
 * | 0 | ISO-8859-1 | 🔴 **按既有嗅探解**（BOM → 严格 UTF-8 → gb18030）——中文工具普遍把 GBK 写进编码 0，真按 latin1 解就是乱码 |
 * | 1 | UTF-16（带 BOM） | BOM 说了算；**无 BOM 按 LE**（ID3 实践如此，`TextDecoder('utf-16')` 同款口径） |
 * | 2 | UTF-16BE | 直接 BE |
 * | 3 | UTF-8 | 直接 UTF-8 |
 *
 * 🔴 **不另立编码真源**：0 与 3 都交给 `pure/txtEncoding.decodeTxtBytes`（红线 11 的那套嗅探），
 *    与「读 TXT 书籍」「读 .lrc 文件」共用同一份编码策略 —— 分叉的后果是同一个 GBK 文件在两处表现不同。
 */
function decodeId3Text(bytes: Uint8Array, encoding: number): string {
    if (!bytes.length) return '';
    try {
        if (encoding === 3) return decodeTxtBytes(bytes, 'utf-8');
        if (encoding === 2) return decodeTxtBytes(bytes, 'utf-16be');
        if (encoding === 1) {
            if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeTxtBytes(bytes, 'utf-16be');
            return decodeTxtBytes(bytes, 'utf-16le');
        }
        return decodeTxtBytes(bytes);
    } catch {
        return '';
    }
}

/** 读大端无符号整数（MP4 / ID3v2.2-2.3 用） */
function readBE(b: Uint8Array, offset: number, count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 8) | (b[offset + i] & 0xff);
    return value;
}

/** 读小端无符号整数（FLAC / OGG 的 Vorbis comment 用） */
function readLE(b: Uint8Array, offset: number, count: number): number {
    let value = 0;
    for (let i = count - 1; i >= 0; i--) value = (value << 8) | (b[offset + i] & 0xff);
    return value;
}

/** 读 syncsafe 整数（ID3v2.4 的长度字段：每字节只用 7 位） */
function readSyncsafe(b: Uint8Array, offset: number, count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 7) | (b[offset + i] & 0x7f);
    return value;
}

/** 撤销 ID3 的「非同步化」：正文里的 `0xFF 0x00` 还原成 `0xFF` */
function deunsync(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < data.length; i++) {
        out.push(data[i]);
        if (data[i] === 0xff && i + 1 < data.length && data[i + 1] === 0x00) i++;
    }
    return new Uint8Array(out);
}

/** `pos` 起是否连续 `len` 个 0 字节（= 文本描述符的终止符） */
function isZeroRun(data: Uint8Array, pos: number, len: number): boolean {
    for (let i = 0; i < len; i++) if (data[pos + i] !== 0) return false;
    return true;
}

/** Vorbis comment / MP4 的 data 文本**按规范就是 UTF-8** ⇒ 不走 ID3 那套编码字节嗅探 */
function decodeUtf8Text(bytes: Uint8Array): string {
    return decodeTxtBytes(bytes, 'utf-8');
}

/** 在字节流里找子序列（OGG 用；上限保护由调用方负责） */
function indexOfBytes(haystack: Uint8Array, needle: number[], from = 0): number {
    outer: for (let i = from; i + needle.length <= haystack.length; i++) {
        for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
        return i;
    }
    return -1;
}

/** 按魔数判定容器 */
export function detectContainer(bytes: Uint8Array): AudioContainer {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'id3v2';
    if (bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac';
    if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogg';
    // MP4/M4A：`....ftyp`（前 4 字节是 box 长度，不校验具体值，按 ascii 标记判定）
    if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4';
    return 'unknown';
}

// ────────────────────────────── ID3v2（mp3）──────────────────────────────

/**
 * 解析一个 `USLT` / `ULT` 帧的**内容**（已剥掉帧头）。
 * 布局：`[编码(1)] [语言(3)] [内容描述符 \0…] [歌词文本]`
 * 🔴 描述符的终止符宽度随编码变：UTF-16（编码 1/2）是 **2 个 0 字节**，其余是 **1 个**。
 *    按 1 个找会把 UTF-16 的每字符低位 0 当成终止 ⇒ 歌词只剩第一句（很隐蔽，必须单测钉住）。
 */
function parseId3LyricsFrame(data: Uint8Array): string | null {
    if (data.length < 5) return null;
    const encoding = data[0];
    const termLen = encoding === 1 || encoding === 2 ? 2 : 1;
    let pos = 4; // 跳过 编码(1) + 语言(3)
    while (pos + termLen <= data.length) {
        if (isZeroRun(data, pos, termLen)) break;
        pos++;
    }
    pos += termLen;
    if (pos >= data.length) return null;
    const text = decodeId3Text(data.subarray(pos), encoding).trim();
    return text ? text : null;
}

/**
 * 从 ID3v2 标签里取出**全部**歌词帧文本（`USLT`；v2.2 是 `ULT`）。
 * 支持 v2.2 / 2.3 / 2.4 的帧长差异、标签级与帧级非同步化、扩展头、v2.4 的压缩/加密帧跳过。
 * 解析不出 ⇒ 空数组（⛔ 不抛）。
 */
export function readId3v2Lyrics(bytes: Uint8Array): string[] {
    if (bytes.length < 10) return [];
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return [];
    const major = bytes[3];
    if (major < 2 || major > 4) return [];
    const flags = bytes[5];
    const tagSize = readSyncsafe(bytes, 6, 4);
    let tag = bytes.subarray(10, Math.min(10 + tagSize, bytes.length));
    if ((flags & 0x80) !== 0) tag = deunsync(tag);

    let offset = 0;
    // 扩展头（v2.4 用 syncsafe 长度，v2.3 用普通大端长度；两者都含「4 字节长度本身」）
    if ((flags & 0x40) !== 0) {
        const extSize = major >= 4 ? readSyncsafe(tag, offset, 4) : readBE(tag, offset, 4);
        offset += 4 + extSize;
    }

    const out: string[] = [];
    // 每轮至少推进 6 字节（v2.2 的帧头长度）⇒ 循环必然终止；再加长度越界兜底
    while (offset + 6 <= tag.length) {
        let frameId = '';
        for (let i = 0; i < 4 && offset + i < tag.length; i++) frameId += String.fromCharCode(tag[offset + i]);

        let frameSize: number;
        let headerSize = 10;
        if (major === 2) {
            frameId = frameId.substring(0, 3);
            frameSize = readBE(tag, offset + 3, 3);
            headerSize = 6;
        } else {
            frameSize = major === 3 ? readBE(tag, offset + 4, 4) : readSyncsafe(tag, offset + 4, 4);
        }
        if (frameSize <= 0) break;
        const contentStart = offset + headerSize;
        const contentEnd = contentStart + frameSize;
        if (contentEnd > tag.length) break;

        let frameData = tag.subarray(contentStart, contentEnd);
        if (major === 4) {
            const fmt = tag[offset + 9];
            if ((fmt & 0x20) !== 0 || (fmt & 0x10) !== 0) {
                offset = contentEnd;
                continue; // 压缩 / 加密帧：读不了，跳过（⛔ 别硬解出乱码当歌词）
            }
            if ((fmt & 0x40) !== 0 && frameData.length > 1) frameData = frameData.subarray(1); // 分组标识字节
            if ((fmt & 0x04) !== 0 && frameData.length > 4) frameData = frameData.subarray(4); // 数据长度指示
            if ((fmt & 0x08) !== 0) frameData = deunsync(frameData);
        }

        const isLyrics = major === 2 ? frameId === 'ULT' : frameId === 'USLT';
        if (isLyrics) {
            const text = parseId3LyricsFrame(frameData);
            if (text) out.push(text);
        }
        offset = contentEnd;
    }
    return out;
}

// ───────────────────────── FLAC / OGG（Vorbis comment）─────────────────────────

/**
 * 解析 Vorbis comment 结构并取歌词字段。
 * 布局：`vendor 长度(LE u32) + vendor + 评论条数(LE u32) + N × [长度(LE u32) + "KEY=value"]`
 * 认 `LYRICS`（标准）与 `UNSYNCEDLYRICS`（foobar2000 等常用别名），键名大小写不敏感。
 */
function parseVorbisCommentLyrics(data: Uint8Array, start: number): string | null {
    let p = start;
    if (p + 4 > data.length) return null;
    const vendorLen = readLE(data, p, 4);
    p += 4 + vendorLen;
    if (p + 4 > data.length) return null;
    const count = readLE(data, p, 4);
    p += 4;
    for (let i = 0; i < count; i++) {
        if (p + 4 > data.length) return null;
        const len = readLE(data, p, 4);
        p += 4;
        if (len <= 0 || p + len > data.length) return null;
        const comment = decodeUtf8Text(data.subarray(p, p + len));
        p += len;
        const eq = comment.indexOf('=');
        if (eq > 0) {
            const key = comment.substring(0, eq).trim().toUpperCase();
            const value = comment.substring(eq + 1);
            if ((key === 'LYRICS' || key === 'UNSYNCEDLYRICS') && value.trim()) return value;
        }
    }
    return null;
}

/** 从 FLAC 字节流取歌词（`fLaC` → 元数据块链 → type 4 = VORBIS_COMMENT） */
export function readFlacLyrics(bytes: Uint8Array): string | null {
    if (bytes.length < 4 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;
    let offset = 4;
    while (offset + 4 <= bytes.length) {
        const header = bytes[offset];
        const isLast = (header & 0x80) !== 0;
        const type = header & 0x7f;
        const len = readBE(bytes, offset + 1, 3);
        offset += 4;
        if (len < 0 || offset + len > bytes.length) return null;
        if (type === 4) return parseVorbisCommentLyrics(bytes, offset);
        if (isLast) break;
        offset += len;
    }
    return null;
}

/** 拼接 Ogg 流的**前若干页** payload（注释头一定在最前面几页里）。上限 64 页 / 512KB ⇒ 不会把整首歌读进来 */
function concatOggPages(bytes: Uint8Array): Uint8Array {
    const parts: number[] = [];
    let offset = 0;
    let pages = 0;
    while (offset + 27 <= bytes.length && pages < 64 && parts.length < 512000) {
        if (bytes[offset] !== 0x4f || bytes[offset + 1] !== 0x67 || bytes[offset + 2] !== 0x67 || bytes[offset + 3] !== 0x53) break;
        const segCount = bytes[offset + 26];
        const dataStart = offset + 27 + segCount;
        if (dataStart > bytes.length) break;
        let segTotal = 0;
        for (let i = 0; i < segCount; i++) segTotal += bytes[offset + 27 + i];
        const dataEnd = Math.min(dataStart + segTotal, bytes.length);
        for (let i = dataStart; i < dataEnd; i++) parts.push(bytes[i]);
        offset = dataStart + segTotal;
        pages++;
    }
    return new Uint8Array(parts);
}

/** 从 OGG 字节流取歌词（Vorbis 注释头 `\x03vorbis` 或 Opus 的 `OpusTags`） */
export function readOggLyrics(bytes: Uint8Array): string | null {
    if (bytes.length < 27) return null;
    if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) return null;
    const data = concatOggPages(bytes);
    const vorbis = indexOfBytes(data, [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]); // \x03 'vorbis'
    const opus = indexOfBytes(data, [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]); // 'OpusTags'
    const start = vorbis >= 0 ? vorbis + 7 : opus >= 0 ? opus + 8 : -1;
    if (start < 0) return null;
    return parseVorbisCommentLyrics(data, start);
}

// ────────────────────────────── MP4 / M4A ──────────────────────────────

/** MP4 原子名（4 字节 ASCII / latin1；`©` 在文件里是单字节 0xA9） */
function atomName(bytes: Uint8Array, offset: number): string {
    let name = '';
    for (let i = 0; i < 4; i++) name += String.fromCharCode(bytes[offset + i]);
    return name;
}

/**
 * 在 MP4 原子树里找目标原子（如 `©lyr`），返回其 `data` 子原子的文本。
 * 路径通常 `moov > udta > meta > ilst > ©lyr > data`；🔴 `meta` 原子 payload 前有 **4 字节 version/flags**，
 * 不跳过就会把第一个子原子读成垃圾名。
 */
function findMp4AtomText(bytes: Uint8Array, start: number, end: number, target: string, depth: number): string | null {
    if (depth > 6) return null; // 层深护栏（脏数据里原子可以互相嵌套成环状声明）
    let offset = start;
    while (offset + 8 <= end) {
        let size = readBE(bytes, offset, 4);
        const name = atomName(bytes, offset + 4);
        let headerLen = 8;
        if (size === 1) {
            if (offset + 16 > end) return null;
            size = readBE(bytes, offset + 8, 4) * 0x100000000 + readBE(bytes, offset + 12, 4); // 64 位长度
            headerLen = 16;
        } else if (size === 0) {
            size = end - offset; // 到容器末尾
        }
        if (size < headerLen || offset + size > end) return null;
        const payload = offset + headerLen;
        const childEnd = offset + size;
        if (name === target) return findMp4DataText(bytes, payload, childEnd);
        if (name === 'moov' || name === 'udta' || name === 'ilst' || name === 'meta') {
            const childStart = name === 'meta' ? payload + 4 : payload;
            const found = findMp4AtomText(bytes, childStart, childEnd, target, depth + 1);
            if (found !== null) return found;
        }
        offset = childEnd;
    }
    return null;
}

/** 目标原子下的 `data` 子原子文本（前 8 字节 = version/flags(4) + locale(4)） */
function findMp4DataText(bytes: Uint8Array, start: number, end: number): string | null {
    let offset = start;
    while (offset + 8 <= end) {
        const size = readBE(bytes, offset, 4);
        if (size < 8 || offset + size > end) return null;
        if (atomName(bytes, offset + 4) === 'data') {
            const textStart = offset + 16;
            if (textStart < offset + size) return decodeUtf8Text(bytes.subarray(textStart, offset + size));
            return null;
        }
        offset += size;
    }
    return null;
}

/** 从 M4A/MP4 字节流取歌词（`©lyr` 原子的 data 文本，UTF-8） */
export function readMp4Lyrics(bytes: Uint8Array): string | null {
    if (bytes.length < 12) return null;
    if (detectContainer(bytes) !== 'mp4') return null;
    const text = findMp4AtomText(bytes, 0, bytes.length, '\u00a9lyr', 0);
    return text && text.trim() ? text : null;
}

// ────────────────────────────── 对外统一入口 ──────────────────────────────

/**
 * 多条候选里挑「最像 LRC 的」那条：**优先带时间戳**（`[mm:ss`）的，否则取第一条。
 * 为什么需要挑：同一首歌可能有多个 `USLT` 帧（每语言一条，或「纯文本版 + LRC 版」各一条）
 * ⇒ 挑错就会出现「歌词能显示但**永不高亮**」（纯文本没有时间轴）。
 */
export function pickLrcLooking(frames: string[]): string | null {
    const usable = frames.filter((t) => !!t && !!t.trim());
    if (!usable.length) return null;
    for (const text of usable) if (/\[\d{1,3}:\d{2}/.test(text)) return text;
    return usable[0];
}

/**
 * 从音频字节流读内嵌歌词（第 4 路歌词源的总入口）。
 * 按魔数分发到对应容器解析器；识别不出容器 / 没有歌词 / 数据损坏 ⇒ **`null`**（⛔ 绝不抛）。
 */
export function readEmbeddedLyrics(bytes: Uint8Array | null | undefined): string | null {
    if (!bytes || !bytes.length) return null;
    try {
        switch (detectContainer(bytes)) {
            case 'id3v2':
                return pickLrcLooking(readId3v2Lyrics(bytes));
            case 'flac':
                return readFlacLyrics(bytes);
            case 'ogg':
                return readOggLyrics(bytes);
            case 'mp4':
                return readMp4Lyrics(bytes);
            default:
                return null;
        }
    } catch {
        return null;
    }
}
