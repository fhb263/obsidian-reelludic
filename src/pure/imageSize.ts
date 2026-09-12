// 从图片字节中解析像素尺寸（纯逻辑，可单测）
// 用途：存量封面模糊检测（宽度 < 阈值判糊 → 触发回源重下高清，见 main.upgradeBlurredPosters）
// 支持 JPEG（SOF0/1/2 段）与 PNG（IHDR）；其余格式返回 null（不误判，交由启发式文件名兜底）

/** JPEG SOF 段标记（SOF0 基线 / SOF1 扩展序列 / SOF2 渐进式常见） */
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3]);

/** 从 ArrayBuffer/类数组字节中解析图片宽高；无法识别返回 null */
export function imageSizeFromBytes(data: ArrayBuffer | Uint8Array): { width: number; height: number } | null {
    const u = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (u.length < 24) return null;
    // PNG：8 字节签名 + IHDR（宽高为前 4 字节大端）
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) {
        const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
        return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    // JPEG：扫描段到 SOF（SOF 后的宽高是 height/width 大端）
    if (u[0] === 0xff && u[1] === 0xd8) {
        let i = 2;
        const len = u.length;
        while (i + 9 < len) {
            if (u[i] !== 0xff) { i++; continue; }
            const marker = u[i + 1];
            if (JPEG_SOF.has(marker)) {
                const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
                return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
            }
            // 段长（含 2 字节自身）后跳到下一段；0xFFD8/0xFF01 等无段长标记跳过
            if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { i += 2; continue; }
            if (i + 3 >= len) return null;
            const segLen = dvGetUint16(u, i + 2);
            if (segLen < 2) return null;
            i += 2 + segLen;
        }
        return null;
    }
    return null;
}

/** 小端环境读 Uint8Array 大端 uint16（DataView 便捷包装，避免重复创建） */
function dvGetUint16(u: Uint8Array, offset: number): number {
    return (u[offset] << 8) | u[offset + 1];
}
