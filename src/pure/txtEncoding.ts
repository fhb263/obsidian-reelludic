// TXT 书籍编码嗅探与解码（纯逻辑，可单测）
//
// 背景（2026-09-17 用户实测）：中文网络小说 TXT 绝大多数是 GBK/GB18030 且无 BOM，
// 而 `vault.read` 与 `fs.readFile(path,'utf8')` 都**硬按 UTF-8 解码** —— 结果全篇 U+FFFD 替换字符（乱码），
// 更糟的是章节正则「第X章」在乱码里一个都匹配不到（实测 735 章 → 0 章）→ 整书退化成单章 → 一次渲染 300 万字 DOM 卡死。
// 所以：**先读二进制、嗅探编码、再解码**，是乱码与卡死的共同根因修复。
//
// 零新依赖：Chromium（Obsidian）与 Node 的 TextDecoder 都原生支持 gb18030（WHATWG 标准编码）。

export type TxtEncoding = 'utf-8' | 'gb18030' | 'utf-16le' | 'utf-16be';

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16LE = [0xff, 0xfe];
const BOM_UTF16BE = [0xfe, 0xff];

function startsWith(bytes: Uint8Array, bom: number[]): boolean {
    if (bytes.length < bom.length) return false;
    for (let i = 0; i < bom.length; i++) {
        if (bytes[i] !== bom[i]) return false;
    }
    return true;
}

/**
 * 严格 UTF-8 合法性校验（WHATWG 编码规范：排除 overlong、surrogate、> U+10FFFF）。
 * 中文 GBK 字节几乎必然落在这套规则之外 —— 这是「非 UTF-8 就当 GBK」判据可靠的原因。
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
    let i = 0;
    const n = bytes.length;
    const cont = (): boolean => bytes[i] !== undefined && (bytes[i] & 0xc0) === 0x80;
    while (i < n) {
        const b = bytes[i];
        if (b < 0x80) {
            i++;
            continue;
        }
        if (b < 0xc2 || b > 0xf4) return false; // 0x80-0xC1（孤立延续/overlong 首字节）、0xF5-0xFF 非法
        if (b <= 0xdf) {
            // 2 字节
            i++;
            if (!cont()) return false;
            i++;
            continue;
        }
        if (b <= 0xef) {
            // 3 字节：E0 要求 A0-BF（防 overlong）；ED 要求 80-9F（排除 surrogate）
            const lo = b === 0xe0 ? 0xa0 : 0x80;
            const hi = b === 0xed ? 0x9f : 0xbf;
            i++;
            if (bytes[i] === undefined || bytes[i] < lo || bytes[i] > hi || (bytes[i] & 0xc0) !== 0x80) return false;
            i++;
            if (!cont()) return false;
            i++;
            continue;
        }
        // 4 字节：F0 要求 90-BF；F4 要求 80-8F
        const lo = b === 0xf0 ? 0x90 : 0x80;
        const hi = b === 0xf4 ? 0x8f : 0xbf;
        i++;
        if (bytes[i] === undefined || bytes[i] < lo || bytes[i] > hi || (bytes[i] & 0xc0) !== 0x80) return false;
        i++;
        for (let k = 0; k < 2; k++) {
            if (!cont()) return false;
            i++;
        }
    }
    return true;
}

/** 嗅探编码：BOM 优先 → 严格 UTF-8 校验 → 兜底 gb18030（中文 TXT 主流） */
export function detectTxtEncoding(bytes: Uint8Array): TxtEncoding {
    if (startsWith(bytes, BOM_UTF8)) return 'utf-8';
    if (startsWith(bytes, BOM_UTF16LE)) return 'utf-16le';
    if (startsWith(bytes, BOM_UTF16BE)) return 'utf-16be';
    if (bytes.length === 0) return 'utf-8';
    return isValidUtf8(bytes) ? 'utf-8' : 'gb18030';
}

/** UTF-16BE → UTF-16LE（TextDecoder 不保证支持 be，统一转成 le 解码） */
function swapByteOrder(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes.length - (bytes.length % 2));
    for (let i = 0; i + 1 < out.length; i += 2) {
        out[i] = bytes[i + 1];
        out[i + 1] = bytes[i];
    }
    return out;
}

/**
 * 解码书籍字节。enc 缺省时自动嗅探。
 * - UTF-8 BOM 由 TextDecoder 自动吃掉，无需手动剥离
 * - utf-16be 先转字节序再用 utf-16le 解码（BOM 由解码器处理）
 */
export function decodeTxtBytes(bytes: Uint8Array, enc?: TxtEncoding): string {
    const e = enc ?? detectTxtEncoding(bytes);
    try {
        if (e === 'gb18030') return new TextDecoder('gb18030').decode(bytes);
        if (e === 'utf-16le') return new TextDecoder('utf-16le').decode(bytes);
        if (e === 'utf-16be') return new TextDecoder('utf-16le').decode(swapByteOrder(bytes));
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        // 兜底：任何解码器异常都退回宽松 UTF-8（保住 ASCII 部分，不抛给用户）
        return new TextDecoder('utf-8').decode(bytes);
    }
}
