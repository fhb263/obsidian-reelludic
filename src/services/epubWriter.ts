/**
 * **EPUB 打包**（#420 P1-B）—— 本仓**唯一**用 jszip 写文件的地方
 * （对称的另一半：阅读器解包在 `main.unpackEpubToText`，也是懒加载 jszip）。
 *
 * 🔴 **两条边界**：
 *  ⑴ 本模块**不认识书的结构**（那是 `pure/epubPack` 的活），只按给定的**顺序**把条目写进 zip；
 *  ② 打完**立刻自检**（`epubHeadIssue`）：首条必须是 `mimetype` 且 STORED —— 规范死规定，
 *     不满足就抛错。⛔ 宁可不产出，也别给用户一个「阅读器打不开」的 epub
 *     （参考软件 SoNovel 的 readme 就专门提到 WPS/掌阅打不开它产出的 epub）。
 * ⚠️ jszip **实测**（2026-09-28）满足这两点：按 `file()` 的调用顺序写、逐文件 `compression: 'STORE'` 生效。
 *    但那属于「库的实现细节」⇒ 自检留着，将来 jszip 升版改了行为会在**构建产物里**立刻炸出来。
 */
import type { EpubFile } from 'pure/epubPack';

/** zip 的 local file header 里，`mimetype` 那条必须满足的签名与压缩方式 */
const SIG_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const METHOD_STORE = 0;

/**
 * 自检 zip 头部（合法 ⇒ `null`；否则给一句原因）。
 * 读的是**第一条 local file header**：
 * `PK\x03\x04 | ver(2) | flags(2) | method(2)@8 | ... | namelen(2)@26 | name@30`
 */
export function epubHeadIssue(bytes: Uint8Array | undefined): string | null {
    const b = bytes;
    if (!b || b.byteLength < 30) return '产出的 EPUB 太小（连文件头都不完整）';
    for (let i = 0; i < 4; i++) if (b[i] !== SIG_LOCAL[i]) return '产出的 EPUB 不是合法的 zip（缺少 PK\\x03\\x04 签名）';
    const method = b[8] | (b[9] << 8);
    if (method !== METHOD_STORE) return `EPUB 的第一条被压缩了（压缩方式 ${method}，必须是 0/STORED）`;
    const nameLen = b[26] | (b[27] << 8);
    const name = new TextDecoder().decode(b.subarray(30, 30 + nameLen));
    if (name !== 'mimetype') return `EPUB 的第一条应当是 mimetype，实际是「${name}」`;
    return null;
}

/**
 * 把 `pure/epubPack.epubFileList` 的有序清单打成 zip。
 * 🔴 条目**顺序**与逐条 `stored` 都由清单决定，本函数**不改顺序、不重排**。
 */
export async function zipEpub(files: readonly EpubFile[]): Promise<Uint8Array> {
    // 懒加载（esbuild 打包进 main.js，避免启动期加载；CJS 互操作取 .default）
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const f of files) {
        zip.file(f.path, f.content, f.stored ? { compression: 'STORE' } : undefined);
    }
    const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const issue = epubHeadIssue(out);
    if (issue) throw new Error(`EPUB 结构自检没过：${issue}`);
    return out;
}
