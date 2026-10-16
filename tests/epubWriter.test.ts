/**
 * `services/epubWriter` 单测（#420 P1-B）—— 真正打 zip，并**从字节层自证** EPUB 的硬约束。
 * 🔴 不引 zip 解析库：直接读 **local file header / 中央目录**的裸字节 —— 这样「首条 = mimetype 且 STORED」
 *    是被**产物自己**证明的，而不是靠「我们相信 jszip」。
 */
import { describe, expect, it } from 'vitest';
import { epubFileList, type EpubMeta } from 'pure/epubPack';
import { epubHeadIssue, zipEpub } from 'services/epubWriter';

const META: EpubMeta = { title: '示例书名', author: '示例作者' };
const CH = [
    { no: 1, title: '第 1 章', text: '甲。\n\n乙。' },
    { no: 2, title: '第 2 章', text: '丙。' },
];
const OPTS = { modified: '2026-09-28T00:00:00Z', uuid: 'aaaabbbb-cccc-4ddd-aeee-ffff00001111' };

/** 从中央目录读全部条目名（中央目录每条固定以 `PK\x01\x02` 开头，名字在 +46 处、长度在 +28） */
function zipEntryNames(b: Uint8Array): string[] {
    const out: string[] = [];
    for (let i = 0; i < b.byteLength - 4; i++) {
        if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x01 && b[i + 3] === 0x02) {
            const len = b[i + 28] | (b[i + 29] << 8);
            out.push(new TextDecoder().decode(b.subarray(i + 46, i + 46 + len)));
        }
    }
    return out;
}

describe('epubWriter · 产物结构自证', () => {
    it('🔴 首条 local file header 是 `mimetype` 且压缩方式 = 0（STORED）', async () => {
        const bytes = await zipEpub(epubFileList(META, CH, OPTS));
        // 直接从裸字节判（不看我们自己的实现）
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes[2]).toBe(0x03);
        expect(bytes[3]).toBe(0x04);
        expect(bytes[8] | (bytes[9] << 8)).toBe(0); // method = STORE
        const nameLen = bytes[26] | (bytes[27] << 8);
        expect(new TextDecoder().decode(bytes.subarray(30, 30 + nameLen))).toBe('mimetype');
        // 自检函数也应判它合法
        expect(epubHeadIssue(bytes)).toBeNull();
    });

    it('`mimetype` 的内容**未压缩**地出现在字节里（STORE 的直接证据）', async () => {
        const bytes = await zipEpub(epubFileList(META, CH, OPTS));
        const text = new TextDecoder('latin1').decode(bytes);
        expect(text).toContain('application/epub+zip');
    });

    it('全部条目都在（container / opf / nav / ncx / css / 两章）', async () => {
        const bytes = await zipEpub(epubFileList(META, CH, OPTS));
        const names = zipEntryNames(bytes);
        for (const p of [
            'mimetype',
            'META-INF/container.xml',
            'OEBPS/content.opf',
            'OEBPS/nav.xhtml',
            'OEBPS/toc.ncx',
            'OEBPS/style.css',
            'OEBPS/chapter-00001.xhtml',
            'OEBPS/chapter-00002.xhtml',
        ]) {
            expect(names).toContain(p);
        }
        expect(names[0]).toBe('mimetype'); // 中央目录里也是第一条
    });

    it('正文内容真的进了包（能解出中文）', async () => {
        const JSZip = (await import('jszip')).default;
        const bytes = await zipEpub(epubFileList(META, CH, OPTS));
        const zip = await JSZip.loadAsync(bytes);
        const ch1 = await zip.file('OEBPS/chapter-00001.xhtml')!.async('string');
        expect(ch1).toContain('第 1 章');
        expect(ch1).toContain('甲。');
        const opf = await zip.file('OEBPS/content.opf')!.async('string');
        expect(opf).toContain('<dc:title>示例书名</dc:title>');
    });

    it('章多了也稳（200 章 = 200 条目 + 两套目录都齐）', async () => {
        const many = Array.from({ length: 200 }, (_, i) => ({ no: i + 1, title: `第 ${i + 1} 章`, text: '正文。' }));
        const bytes = await zipEpub(epubFileList(META, many, OPTS));
        expect(epubHeadIssue(bytes)).toBeNull();
        expect(zipEntryNames(bytes).filter((n) => n.startsWith('OEBPS/chapter-')).length).toBe(200);
    });
});

describe('epubWriter · 自检函数（负例都要被抓住）', () => {
    it('太短 / 签名不对 / 被压缩 / 名字不对 —— 四种都报原因', () => {
        expect(epubHeadIssue(undefined)).toContain('太小');
        expect(epubHeadIssue(new Uint8Array(4))).toContain('太小');
        const bad = new Uint8Array(40);
        expect(epubHeadIssue(bad)).toContain('不是合法的 zip');
        const compressed = new Uint8Array(40);
        compressed.set([0x50, 0x4b, 0x03, 0x04]);
        compressed[8] = 8; // DEFLATE
        expect(epubHeadIssue(compressed)).toContain('必须是 0/STORED');
        const wrongName = new Uint8Array(40);
        wrongName.set([0x50, 0x4b, 0x03, 0x04]);
        wrongName[26] = 3;
        wrongName.set([0x61, 0x62, 0x63], 30); // "abc"
        expect(epubHeadIssue(wrongName)).toContain('应当是 mimetype');
    });
});
