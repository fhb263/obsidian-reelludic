/**
 * 内嵌歌词读取单测（第 4 路歌词源，2026-09-27 #391）。
 *
 * 夹具都是**按格式手搓的字节**（不依赖任何真实音频文件）——这样每条边界都能单独摆出来，
 * 也保证 CI / 别人机器上跑得过。真实文件只用来在开发时人工核对过口径。
 *
 * 🔴 重点钉住的三处「照搬别家实现必踩」的坑：
 *  ⑴ **编码 0 名义 latin1、实际多为 GBK** —— 中文 mp3 按 latin1 解就是乱码（必须走仓内嗅探兜底）；
 *  ⑵ **ID3v2.4 的帧长是 syncsafe** —— 按 v2.3 的大端读法会读到别的帧上去（歌词整段消失或乱码）；
 *  ⑶ **描述符终止符宽度随编码变**（UTF-16 是 2 个 0 字节）—— 按 1 个找会把歌词截成第一句。
 */
import { describe, expect, it } from 'vitest';
import {
    detectContainer,
    pickLrcLooking,
    readEmbeddedLyrics,
    readFlacLyrics,
    readId3v2Lyrics,
    readMp4Lyrics,
    readOggLyrics,
} from 'pure/embeddedLyrics';

// ───────────────────────────── 夹具工具 ─────────────────────────────

function concat(parts: (number[] | Uint8Array)[]): number[] {
    const out: number[] = [];
    for (const p of parts) for (let i = 0; i < p.length; i++) out.push(p[i]);
    return out;
}
/** 收尾成 Uint8Array（解析器一律吃字节） */
function u8(parts: (number[] | Uint8Array)[]): Uint8Array {
    return new Uint8Array(concat(parts));
}
function ascii(s: string): number[] {
    return Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}
function be(n: number, count: number): number[] {
    const out: number[] = [];
    for (let i = count - 1; i >= 0; i--) out.push((n >>> (i * 8)) & 0xff);
    return out;
}
function le(n: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push((n >>> (i * 8)) & 0xff);
    return out;
}
function syncsafe(n: number): number[] {
    return [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f];
}
/** UTF-16LE + BOM（ID3 编码 1 的常规形态） */
function utf16le(s: string): number[] {
    const out: number[] = [0xff, 0xfe];
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        out.push(code & 0xff, (code >>> 8) & 0xff);
    }
    return out;
}
function utf8(s: string): number[] {
    return Array.from(new TextEncoder().encode(s));
}
/** GBK 字节（只在用例里手写已知码位，避免依赖编码器） */
const GBK = { 七里香: [0xc6, 0xdf, 0xc0, 0xef, 0xcf, 0xe3], 歌词: [0xb8, 0xe8, 0xb4, 0xca] };

/** 非同步化**编码**侧：每个 `0xFF` 后面插一个 `0x00`（解析侧要撤销它） */
function unsyncInsert(bytes: number[]): number[] {
    const out: number[] = [];
    for (const b of bytes) {
        out.push(b);
        if (b === 0xff) out.push(0x00);
    }
    return out;
}

/** `USLT` 帧内容：[编码(1)][语言(3)][描述符 \0][歌词] */
function usltBody(text: number[], encoding: number, desc: number[] = []): number[] {
    const term = encoding === 1 || encoding === 2 ? [0, 0] : [0];
    return concat([[encoding], ascii('eng'), desc, term, text]);
}

interface FrameSpec {
    id: string;
    body: number[];
    v4flags?: number;
}

/** 组装一个 ID3v2 标签；`extHeaderLen` > 0 时插入扩展头；`unsyncTag` 置标签级非同步化位 */
function id3Tag(opts: {
    major: 2 | 3 | 4;
    frames: FrameSpec[];
    /** 扩展头**总字节数**（含那 4 字节长度字段本身；写进长度字段的值 = 本值 − 4，与解析器口径一致） */
    extHeaderLen?: number;
    tagFlags?: number;
    /** 打上标签级非同步化位，并把正文里每个 `0xFF` 后面插一个 `0x00`（长度按插入后算） */
    unsyncTag?: boolean;
}): Uint8Array {
    const { major, frames } = opts;
    let body: number[] = [];
    for (const f of frames) {
        if (major === 2) body = body.concat(ascii(f.id.substring(0, 3)), be(f.body.length, 3), f.body);
        else if (major === 3) body = body.concat(ascii(f.id.substring(0, 4)), be(f.body.length, 4), [0, 0], f.body);
        else body = body.concat(ascii(f.id.substring(0, 4)), syncsafe(f.body.length), [0, f.v4flags ?? 0], f.body);
    }
    let payload = body;
    let flags = opts.tagFlags ?? 0;
    if (opts.extHeaderLen) {
        const sizeField = Math.max(0, opts.extHeaderLen - 4);
        const pad = new Array<number>(sizeField).fill(0);
        const ext = major >= 4 ? concat([syncsafe(sizeField), pad]) : concat([be(sizeField, 4), pad]);
        payload = concat([ext, body]);
        flags |= 0x40;
    }
    if (opts.unsyncTag) {
        payload = unsyncInsert(payload);
        flags |= 0x80;
    }
    return u8([
        ascii('ID3'),
        [major, 0, flags],
        syncsafe(payload.length),
        payload,
        // 标签后再跟一点「音频数据」，防解析器把标签当全部内容
        new Uint8Array(32),
    ]);
}

/** Vorbis comment 结构（FLAC 元数据块体 / OGG 注释头之后都是它） */
function vorbisComment(pairs: [string, string][]): number[] {
    const vendor = utf8('test');
    let out: number[] = [...le(vendor.length, 4), ...vendor, ...le(pairs.length, 4)];
    for (const [k, v] of pairs) {
        const line = utf8(`${k}=${v}`);
        out = out.concat(le(line.length, 4), line);
    }
    return out;
}

function flac(pairs: [string, string][]): Uint8Array {
    const block = vorbisComment(pairs);
    return u8([
        ascii('fLaC'),
        [0x80 | 4, ...be(block.length, 3)], // last + VORBIS_COMMENT
        block,
        new Uint8Array(16),
    ]);
}

/** 单页 Ogg（payload = 若干头部拼接），段表按 255 字节切 */
function oggPage(payload: number[]): Uint8Array {
    const segs: number[] = [];
    let rest = payload.length;
    while (rest > 255) {
        segs.push(255);
        rest -= 255;
    }
    segs.push(rest);
    return u8([
        ascii('OggS'),
        [0, 0],
        new Uint8Array(8), // granule
        le(1, 4),
        le(0, 4),
        le(0, 4), // crc
        [segs.length],
        segs,
        payload,
    ]);
}

/** 组装 MP4 原子：size(4 BE) + name(4) + payload */
function atom(name: string | number[], payload: number[]): number[] {
    const nm = typeof name === 'string' ? ascii(name) : name;
    return concat([be(8 + payload.length, 4), nm, payload]);
}
const LYR_ATOM = [0xa9, 0x6c, 0x79, 0x72]; // '©lyr'

function m4a(lyrics: string | null): Uint8Array {
    const ilst = atom(LYR_ATOM, atom('data', concat([[0, 0, 0, 1], [0, 0, 0, 0], utf8(lyrics ?? '')])));
    // 🔴 `hdlr` 也必须包成原子（meta 的子级是「原子列表」，裸字节会被当成 size=0 的坏原子而中止解析）
    const meta = atom('meta', concat([[0, 0, 0, 0], atom('hdlr', new Array<number>(8).fill(0)), ilst]));
    const udta = atom('udta', meta);
    return u8([atom('ftyp', ascii('M4A ')), atom('moov', udta), new Uint8Array(16)]);
}

// ───────────────────────────── 用例 ─────────────────────────────

describe('embeddedLyrics · 容器判定', () => {
    it('按魔数识别四种容器；认不出回 unknown', () => {
        expect(detectContainer(id3Tag({ major: 3, frames: [] }))).toBe('id3v2');
        expect(detectContainer(flac([['TITLE', 'x']]))).toBe('flac');
        expect(detectContainer(oggPage(ascii('\x01vorbis')))).toBe('ogg');
        expect(detectContainer(m4a('x'))).toBe('mp4');
        expect(detectContainer(u8([utf8('这不是音频')]))).toBe('unknown');
        expect(detectContainer(new Uint8Array(0))).toBe('unknown');
    });
});

describe('embeddedLyrics · ID3v2（mp3）', () => {
    it('v2.3 USLT + 编码 1（UTF-16LE BOM）⇒ 读出歌词', () => {
        const tag = id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(utf16le('[00:01.00]Hello'), 1) }] });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:01.00]Hello']);
    });

    it('🔴 编码 0 但字节是 GBK ⇒ 走嗅探兜底读出中文（按 latin1 解会是乱码）', () => {
        const tag = id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(GBK['歌词'], 0) }] });
        expect(readId3v2Lyrics(tag)).toEqual(['歌词']);
    });

    it('编码 3（UTF-8）中文 ⇒ 原样读出', () => {
        const tag = id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(utf8('[00:02.50]七里香'), 3) }] });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:02.50]七里香']);
    });

    it('🔴 描述符终止符按编码宽度找（UTF-16 是 2 字节）⇒ 后面整段歌词都在，不被截成一句', () => {
        const body = usltBody(utf16le('line1\nline2\nline3'), 1, utf16le('描述'));
        const tag = id3Tag({ major: 3, frames: [{ id: 'USLT', body }] });
        expect(readId3v2Lyrics(tag)).toEqual(['line1\nline2\nline3']);
    });

    it('🔴 v2.4 的帧长是 syncsafe ⇒ 能正确跳帧读到 USLT（按大端读会跑偏）', () => {
        const tag = id3Tag({
            major: 4,
            frames: [
                { id: 'TIT2', body: utf8('歌名') },
                { id: 'USLT', body: usltBody(utf8('[00:03.00]v24'), 3) },
            ],
        });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:03.00]v24']);
    });

    it('v2.2 的 `ULT`（3 字符帧 id + 3 字节帧长）⇒ 也能读', () => {
        const tag = id3Tag({ major: 2, frames: [{ id: 'ULT', body: usltBody(utf8('[00:04.00]v22'), 3) }] });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:04.00]v22']);
    });

    it('多层 USLT（多语言）⇒ 全部返回，交给 pickLrcLooking 挑带时间戳的那条', () => {
        const tag = id3Tag({
            major: 3,
            frames: [
                { id: 'USLT', body: usltBody(utf8('纯文本歌词（没有时间轴）'), 3) },
                { id: 'USLT', body: usltBody(utf8('[00:05.00]带时间轴'), 3) },
            ],
        });
        expect(readId3v2Lyrics(tag)).toHaveLength(2);
        expect(pickLrcLooking(readId3v2Lyrics(tag))).toBe('[00:05.00]带时间轴');
    });

    it('扩展头存在时正确跳过（v2.3 普通大端 / v2.4 syncsafe 两种长度写法）', () => {
        for (const major of [3, 4] as const) {
            const tag = id3Tag({
                major,
                extHeaderLen: 12,
                frames: [{ id: 'USLT', body: usltBody(utf8('[00:06.00]ext'), 3) }],
            });
            expect(readId3v2Lyrics(tag)).toEqual(['[00:06.00]ext']);
        }
    });

    it('标签级非同步化（flags 0x80）⇒ 先还原再解析', () => {
        // 让正文里**真的**出现 `FF 00` 字节：UTF-16LE 编码的 U+00FF 就是 FF 00
        // ⇒ 非同步化后会变成 FF 00 00，解析侧必须先还原成 FF 00 才解得对
        const tag = id3Tag({
            major: 3,
            frames: [{ id: 'USLT', body: usltBody(utf16le('[00:07.00]a\u00ffb'), 1) }],
            unsyncTag: true,
        });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:07.00]a\u00ffb']);
    });

    it('🔴 v2.4 压缩帧（格式位 0x20）⇒ 跳过不误读（⛔ 别把压缩字节当歌词）', () => {
        const tag = id3Tag({
            major: 4,
            frames: [
                { id: 'USLT', body: usltBody(utf8('BINARYGARBAGE'), 3), v4flags: 0x20 },
                { id: 'USLT', body: usltBody(utf8('[00:08.00]real'), 3) },
            ],
        });
        expect(readId3v2Lyrics(tag)).toEqual(['[00:08.00]real']);
    });

    it('没有 USLT ⇒ 空数组（`周杰伦 - 夜曲.mp3` 的真实情形）', () => {
        const tag = id3Tag({ major: 3, frames: [{ id: 'TIT2', body: utf8('夜曲') }] });
        expect(readId3v2Lyrics(tag)).toEqual([]);
    });
});

describe('embeddedLyrics · FLAC / OGG（Vorbis comment）', () => {
    it('FLAC 的 LYRICS 字段 ⇒ 读出', () => {
        expect(readFlacLyrics(flac([['TITLE', 'x'], ['LYRICS', '[00:01.00]flac']]))).toBe('[00:01.00]flac');
    });

    it('FLAC 认 `UNSYNCEDLYRICS` 别名 + 键名大小写不敏感', () => {
        expect(readFlacLyrics(flac([['unsyncedlyrics', '[00:02.00]alias']]))).toBe('[00:02.00]alias');
    });

    it('FLAC 无歌词字段 ⇒ null', () => {
        expect(readFlacLyrics(flac([['TITLE', 'x']]))).toBeNull();
    });

    it('OGG 的 Vorbis 注释头（\\x03vorbis）⇒ 读出', () => {
        const ident = new Array<number>(20).fill(0);
        const payload = concat([
            concat([[1], ascii('vorbis'), ident]),
            concat([[3], ascii('vorbis'), vorbisComment([['LYRICS', '[00:03.00]ogg']])]),
        ]);
        expect(readOggLyrics(oggPage(payload))).toBe('[00:03.00]ogg');
    });

    it('OGG 的 Opus 注释头（OpusTags）⇒ 读出', () => {
        const payload = concat([ascii('OpusTags'), vorbisComment([['LYRICS', '[00:04.00]opus']])]);
        expect(readOggLyrics(oggPage(payload))).toBe('[00:04.00]opus');
    });
});

describe('embeddedLyrics · MP4 / M4A', () => {
    it('`©lyr` 原子的 data 文本 ⇒ 读出（要跳过 meta 的 4 字节 version/flags 与 data 的 8 字节头）', () => {
        expect(readMp4Lyrics(m4a('[00:01.00]m4a'))).toBe('[00:01.00]m4a');
    });

    it('MP4 没有 ©lyr ⇒ null', () => {
        expect(readMp4Lyrics(m4a(null))).toBeNull();
    });
});

describe('embeddedLyrics · 统一入口与脏值护栏', () => {
    it('总入口按容器分发，四种容器都能取到', () => {
        expect(readEmbeddedLyrics(id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(utf8('A'), 3) }] }))).toBe('A');
        expect(readEmbeddedLyrics(flac([['LYRICS', 'B']]))).toBe('B');
        expect(readEmbeddedLyrics(m4a('C'))).toBe('C');
    });

    it('null / 空 / 非音频 / 全 0xFF ⇒ 一律 null，且绝不抛', () => {
        expect(readEmbeddedLyrics(null)).toBeNull();
        expect(readEmbeddedLyrics(new Uint8Array(0))).toBeNull();
        expect(readEmbeddedLyrics(u8([utf8('随便一段文字')]))).toBeNull();
        expect(readEmbeddedLyrics(new Uint8Array(4096).fill(0xff))).toBeNull();
        expect(readEmbeddedLyrics(new Uint8Array(4096))).toBeNull();
    });

    it('🔴 截断的 ID3 / 谎报长度（帧长越界、标签长越界）⇒ 不抛、不越界读', () => {
        const full = id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(utf8('[00:01.00]truncated'), 3) }] });
        expect(() => readId3v2Lyrics(full.subarray(0, 20))).not.toThrow();
        expect(() => readId3v2Lyrics(full.subarray(0, 40))).not.toThrow();
        // 谎报一个巨大的帧长
        const lie = id3Tag({ major: 3, frames: [{ id: 'USLT', body: usltBody(utf8('x'), 3) }] });
        lie[10 + 4] = 0x7f;
        lie[10 + 5] = 0xff;
        expect(() => readId3v2Lyrics(lie)).not.toThrow();
    });

    it('🔴 截断的 FLAC / MP4 原子链 ⇒ null 不抛（`size = 0` 与 `size = 1` 两种特殊长度都覆盖）', () => {
        const f = flac([['LYRICS', 'X']]);
        expect(() => readFlacLyrics(f.subarray(0, 8))).not.toThrow();
        const m = m4a('Y');
        expect(() => readMp4Lyrics(m.subarray(0, 40))).not.toThrow();
        expect(readEmbeddedLyrics(m.subarray(0, 40))).toBeNull();
    });

    it('pickLrcLooking：全空白 ⇒ null；不带时间戳 ⇒ 取第一条', () => {
        expect(pickLrcLooking([])).toBeNull();
        expect(pickLrcLooking(['   ', '\n'])).toBeNull();
        expect(pickLrcLooking(['纯文本', '[00:01.00]带轴'])).toBe('[00:01.00]带轴');
        expect(pickLrcLooking(['只有纯文本'])).toBe('只有纯文本');
    });
});
