// imageSize 纯函数测试：JPEG SOF / PNG IHDR 宽高解析
import { describe, it, expect } from 'vitest';
import { imageSizeFromBytes } from 'pure/imageSize';

/** 构造最小 PNG（8 字节签名 + IHDR 头 + 若干填充），宽高可参数化 */
function pngBytes(w: number, h: number): Uint8Array {
    const u = new Uint8Array(33);
    u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG 签名
    // IHDR 长度/类型（12-15）
    u.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    u[16] = (w >>> 24) & 0xff; u[17] = (w >>> 16) & 0xff; u[18] = (w >>> 8) & 0xff; u[19] = w & 0xff;
    u[20] = (h >>> 24) & 0xff; u[21] = (h >>> 16) & 0xff; u[22] = (h >>> 8) & 0xff; u[23] = h & 0xff;
    return u;
}

/** 构造最小 JPEG：SOI + 若干 APP 段（各含段长） + SOF0 + EOI */
function jpegBytes(w: number, h: number): Uint8Array {
    const seg = (marker: number, payload: Uint8Array): number[] => {
        const len = payload.length + 2;
        return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
    };
    const sofPayload = new Uint8Array([
        8, // 精度
        (h >> 8) & 0xff, h & 0xff,
        (w >> 8) & 0xff, w & 0xff,
        3, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // 组件表（尾随数据）
    ]);
    const app0 = seg(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1])); // JFIF
    const body = [0xff, 0xd8, ...app0, ...seg(0xc0, sofPayload), 0xff, 0xd9];
    return new Uint8Array(body);
}

describe('imageSizeFromBytes', () => {
    it('PNG IHDR 解析宽高', () => {
        expect(imageSizeFromBytes(pngBytes(400, 600))).toEqual({ width: 400, height: 600 });
        expect(imageSizeFromBytes(pngBytes(80, 80))).toEqual({ width: 80, height: 80 });
    });

    it('JPEG SOF0 解析宽高（跳过 APP0 段）', () => {
        expect(imageSizeFromBytes(jpegBytes(640, 360))).toEqual({ width: 640, height: 360 });
        expect(imageSizeFromBytes(jpegBytes(70, 94))).toEqual({ width: 70, height: 94 });
    });

    it('字节过短 / 空输入返回 null', () => {
        expect(imageSizeFromBytes(new Uint8Array(3))).toBeNull();
        expect(imageSizeFromBytes(new ArrayBuffer(0))).toBeNull();
    });

    it('非图片字节返回 null（不误判）', () => {
        expect(imageSizeFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]))).toBeNull();
    });
});
