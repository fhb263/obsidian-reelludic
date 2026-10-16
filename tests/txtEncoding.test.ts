// TXT 书籍编码嗅探（pure/txtEncoding）：中文网络小说多为 GBK/GB18030，硬按 UTF-8 解码会全篇乱码
import { describe, it, expect } from 'vitest';
import { detectTxtEncoding, isValidUtf8, decodeTxtBytes } from 'pure/txtEncoding';

/** 便捷：number[] → Uint8Array */
const bytes = (...ns: number[]): Uint8Array => new Uint8Array(ns);
/** UTF-8 编码（带 BOM 可选） */
const encUtf8 = (s: string, bom = false): Uint8Array => {
    const body = Array.from(new TextEncoder().encode(s));
    return bytes(...(bom ? [0xef, 0xbb, 0xbf] : []), ...body);
};

describe('pure/txtEncoding isValidUtf8（WHATWG 严格规则）', () => {
    it('纯 ASCII 合法', () => {
        expect(isValidUtf8(bytes(0x41, 0x42, 0x0a, 0x7f))).toBe(true);
    });

    it('合法多字节序列（2/3/4 字节）合法', () => {
        expect(isValidUtf8(encUtf8('中文'))).toBe(true);
        expect(isValidUtf8(bytes(0xc3, 0xa9))).toBe(true); // é
        expect(isValidUtf8(bytes(0xf0, 0x9f, 0x98, 0x80))).toBe(true); // emoji
    });

    it('孤立延续字节 / 截断序列 / 越界首字节非法', () => {
        expect(isValidUtf8(bytes(0x80))).toBe(false); // 孤立 continuation
        expect(isValidUtf8(bytes(0xe4, 0xb8))).toBe(false); // 3 字节序列被截断
        expect(isValidUtf8(bytes(0xf0, 0x9f, 0x98))).toBe(false); // 4 字节序列被截断
        expect(isValidUtf8(bytes(0xc0, 0x80))).toBe(false); // overlong
        expect(isValidUtf8(bytes(0xff, 0xfe))).toBe(false);
    });

    it('UTF-16 surrogate 与超上界（0xF5+）非法', () => {
        expect(isValidUtf8(bytes(0xed, 0xa0, 0x80))).toBe(false); // U+D800 surrogate
        expect(isValidUtf8(bytes(0xf4, 0x90, 0x80, 0x80))).toBe(false); // > U+10FFFF
    });

    it('GBK「第一集」字节（0xB5 0xDA…）判为非法 UTF-8', () => {
        expect(isValidUtf8(bytes(0xb5, 0xda, 0xd2, 0xbb, 0xbc, 0xaf))).toBe(false);
    });
});

describe('pure/txtEncoding detectTxtEncoding', () => {
    it('UTF-8 BOM → utf-8', () => {
        expect(detectTxtEncoding(encUtf8('正文', true))).toBe('utf-8');
    });

    it('UTF-16 LE/BE BOM → 对应 UTF-16', () => {
        expect(detectTxtEncoding(bytes(0xff, 0xfe, 0x41, 0x00))).toBe('utf-16le');
        expect(detectTxtEncoding(bytes(0xfe, 0xff, 0x00, 0x41))).toBe('utf-16be');
    });

    it('无 BOM 且合法 UTF-8 → utf-8', () => {
        expect(detectTxtEncoding(encUtf8('第一章 风起'))).toBe('utf-8');
        expect(detectTxtEncoding(encUtf8('plain ascii only'))).toBe('utf-8');
    });

    it('无 BOM 且非合法 UTF-8 → gb18030（中文 TXT 主流兜底）', () => {
        // 「第一集 斗罗世界」的 GBK 字节
        expect(detectTxtEncoding(bytes(0xb5, 0xda, 0xd2, 0xbb, 0xbc, 0xaf))).toBe('gb18030');
    });

    it('空文件不会误判（空字节 → utf-8）', () => {
        expect(detectTxtEncoding(bytes())).toBe('utf-8');
    });
});

describe('pure/txtEncoding decodeTxtBytes', () => {
    it('UTF-8 解码（含 BOM 自动吃掉）', () => {
        expect(decodeTxtBytes(encUtf8('第一章 风起'))).toBe('第一章 风起');
        expect(decodeTxtBytes(encUtf8('带 BOM', true))).toBe('带 BOM');
    });

    it('GB18030 解码：GBK 字节还原为中文', () => {
        // 「第一集 斗罗世界」——与插件实测的斗罗大陆.txt 同源编码
        expect(decodeTxtBytes(bytes(0xb5, 0xda, 0xd2, 0xbb, 0xbc, 0xaf, 0x20, 0xb6, 0xb7, 0xc2, 0xde))).toBe('第一集 斗罗');
    });

    it('自动模式：不传编码时按嗅探结果解码（GBK 字节 → 中文，不出现替换字符）', () => {
        const out = decodeTxtBytes(bytes(0xb5, 0xda, 0xd2, 0xbb, 0xbc, 0xaf));
        expect(out).toBe('第一集');
        expect(out).not.toContain('�');
    });

    it('UTF-16LE/BE 解码（BE 自动转字节序）', () => {
        const le = bytes(0xff, 0xfe, 0x41, 0x00, 0x42, 0x00);
        expect(decodeTxtBytes(le)).toContain('AB');
        const be = bytes(0xfe, 0xff, 0x00, 0x41, 0x00, 0x42);
        expect(decodeTxtBytes(be)).toContain('AB');
    });
});
