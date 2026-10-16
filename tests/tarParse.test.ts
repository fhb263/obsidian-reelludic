import { describe, expect, it } from 'vitest';
import { parseTar } from 'pure/tarParse';

const BLOCK = 512;

/** 造一个 USTAR 常规文件块头（name/size/typeflag/prefix） */
function tarHeader(name: string, size: number, type: '0' | '5' = '0', prefix = ''): Uint8Array {
    const h = new Uint8Array(BLOCK);
    const put = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) h[offset + i] = s.charCodeAt(i);
    };
    put(0, name);
    put(100, '0000644\0'); // mode
    put(108, '0000000\0'); // uid
    put(116, '0000000\0'); // gid
    put(124, size.toString(8).padStart(11, '0') + '\0'); // size（11 位八进制 + NUL）
    put(136, '14500000000\0'); // mtime
    h[156] = type.charCodeAt(0);
    put(257, 'ustar\0');
    if (prefix) put(345, prefix);
    return h;
}

/** 把若干条目拼成完整 tar（含两个结束零块） */
function buildTar(entries: { name: string; data: string; type?: '0' | '5'; prefix?: string }[]): Uint8Array {
    const parts: Uint8Array[] = [];
    for (const e of entries) {
        const data = new Uint8Array([...e.data].map((c) => c.charCodeAt(0)));
        parts.push(tarHeader(e.name, data.length, e.type ?? '0', e.prefix ?? ''));
        parts.push(data);
        const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
        if (pad) parts.push(new Uint8Array(pad));
    }
    parts.push(new Uint8Array(BLOCK * 2)); // 结束
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}

const text = (b: Uint8Array): string => [...b].map((c) => String.fromCharCode(c)).join('');

describe('#537 TAR/CBT 解析（零依赖）', () => {
    it('解析常规文件：名称与字节内容都对', () => {
        const tar = buildTar([
            { name: '001.jpg', data: 'AAA' },
            { name: '002.jpg', data: 'BB' },
        ]);
        const out = parseTar(tar);
        expect(out.map((e) => e.name)).toEqual(['001.jpg', '002.jpg']);
        expect(text(out[0].bytes)).toBe('AAA');
        expect(text(out[1].bytes)).toBe('BB');
    });

    it('🔴 只用第一块全零做结束判定（GNU 两块 / 旧 tar 一块都吃得下）', () => {
        const tar = buildTar([{ name: 'a.png', data: 'X' }]);
        // 抹掉最后一块（模拟旧 tar 只带一个结束块）
        const trimmed = tar.subarray(0, tar.length - BLOCK);
        expect(parseTar(trimmed).map((e) => e.name)).toEqual(['a.png']);
    });

    it('目录项（typeflag=5）跳过，不算文件', () => {
        const tar = buildTar([
            { name: 'sub/', data: '', type: '5' },
            { name: 'sub/1.jpg', data: 'Z' },
        ]);
        expect(parseTar(tar).map((e) => e.name)).toEqual(['sub/1.jpg']);
    });

    it('USTAR prefix 拼进完整路径', () => {
        const tar = buildTar([{ name: '001.jpg', data: 'Q', prefix: 'deep/dir' }]);
        expect(parseTar(tar)[0].name).toBe('deep/dir/001.jpg');
    });

    it('大小不是块整数倍时按块对齐推进（后一条目仍能解析）', () => {
        const tar = buildTar([
            { name: 'a.jpg', data: 'A'.repeat(600) }, // 跨两个块
            { name: 'b.jpg', data: 'B' },
        ]);
        const out = parseTar(tar);
        expect(out.map((e) => e.name)).toEqual(['a.jpg', 'b.jpg']);
        expect(out[0].bytes.length).toBe(600);
        expect(text(out[1].bytes)).toBe('B');
    });

    it('🔴 坏档 / 空输入不抛：返回已解析出的部分或空数组', () => {
        expect(parseTar(new Uint8Array(0))).toEqual([]);
        expect(parseTar(new Uint8Array(10))).toEqual([]);
        // 截断在数据中间 ⇒ 越界即停，返回空
        const tar = buildTar([{ name: 'a.jpg', data: 'A'.repeat(600) }]);
        expect(parseTar(tar.subarray(0, BLOCK + 100))).toEqual([]);
    });
});
