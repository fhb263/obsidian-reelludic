/**
 * 极简 TAR 解析（纯逻辑：无 obsidian / 无 DOM / 无 node 依赖，可单测）。
 *
 * 1.2.1 #537 漫画零依赖档：CBT = 改了扩展名的 TAR，本批**不引任何解压依赖**（用户点定 A1），
 * 故自带一个只读 USTAR/GNU 常规档的解析器 —— 只认「常规文件」，其余（目录 / 符号链接 / PAX 头）一律跳过。
 *
 * 只做必要的事（对齐本仓「最小改动」取向）：
 *   · 512 字节块头：`name[100]` / `size[12]`（八进制）/ `typeflag[1]` / USTAR `prefix[155]`；
 *   · 结尾判定：遇到**全零块**即停（GNU 用两块、旧 tar 可能只有一块；取第一块全零即返回，够用）；
 *   · 越界 / 大小非法 → **立即停止**并返回已解析出的条目（坏档不抛、不无限循环）；
 *   · ⛔ 不支持 GNU 长名（`typeflag = 'L'`）/ 稀疏文件 / base-256 大数大小 —— 漫画压缩包里不会出现，
 *     真遇到时按「跳过该条目」处理（宁可少一页，也不误读一段二进制当图片）。
 */

const BLOCK = 512;

/** 一个常规文件条目（`bytes` 是原数据的子视图，调用方按需拷贝） */
export interface TarEntry {
    name: string;
    bytes: Uint8Array;
}

/** 字节 → ASCII 串（TAR 头字段都是 ASCII；手工解码避免依赖 TextDecoder 在测试环境的差异） */
function decodeAscii(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

/** 读 `[offset, offset+len)` 的 NUL 结尾 ASCII 字段（TAR 头字段都是这种） */
function readString(data: Uint8Array, offset: number, len: number): string {
    let end = offset;
    const limit = Math.min(offset + len, data.length);
    while (end < limit && data[end] !== 0) end++;
    return decodeAscii(data.subarray(offset, end));
}

/** 读八进制数字字段（可能带前导空格 / 结尾 NUL 或空格）；非法返回 NaN */
function readOctal(data: Uint8Array, offset: number, len: number): number {
    const s = readString(data, offset, len).trim();
    if (!s) return 0;
    // 兼容「前导空格 + 八进制」与结尾 NUL；出现非八进制字符视为非法
    if (!/^[0-7]+$/.test(s)) return NaN;
    return parseInt(s, 8);
}

/** 该 512 块是否全零（TAR 的结束标记） */
function isZeroBlock(data: Uint8Array, offset: number): boolean {
    for (let i = 0; i < BLOCK; i++) if (data[offset + i] !== 0) return false;
    return true;
}

/**
 * 解析 TAR / CBT 字节流 → 常规文件条目列表。
 * 坏档（越界 / 非法大小）时返回**已解析出的部分**（不抛）；完全不是 tar → `[]`。
 */
export function parseTar(data: Uint8Array): TarEntry[] {
    const out: TarEntry[] = [];
    if (!data || data.length < BLOCK) return out;
    let off = 0;
    while (off + BLOCK <= data.length) {
        if (isZeroBlock(data, off)) break;
        const name = readString(data, off, 100);
        const prefix = readString(data, off + 345, 155);
        const full = prefix ? `${prefix}/${name}` : name;
        const size = readOctal(data, off + 124, 12);
        const type = String.fromCharCode(data[off + 156] || 0x30); // 缺省 '0' = 常规文件
        const dataStart = off + BLOCK;
        if (!Number.isFinite(size) || size < 0) break;
        const dataEnd = dataStart + size;
        if (dataEnd > data.length) break;
        // 只收常规文件：'0' / '\0'（老格式）/ ''；其余（目录 '5'、链接 '2'、PAX 'x' 等）跳过
        if (type === '0' || type === '\0') {
            out.push({ name: full, bytes: data.subarray(dataStart, dataEnd) });
        }
        off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    }
    return out;
}
