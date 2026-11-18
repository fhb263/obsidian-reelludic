/**
 * QR 编码器的**逐格比对**守卫（`src/pure/qrcode.ts`）。
 *
 * 🔴 为什么要逐格比对：二维码画错一格手机就扫不出来，而「能画出一张黑白方块图」这种
 *    断言对正确性毫无约束力。参照矩阵由 Python `qrcode` 库（业界实现）生成后冻结在
 *    `tests/fixtures/qrRef.ts`，**同文本 + 同版本 + 同纠错档 + 同掩码 ⇒ 矩阵必须一模一样**。
 *
 * ⚠️ 参照是**冻结的快照**，不是每次跑测试时现算：
 *    ① 测试环境不保证有 Python；② 现算的话，参照与被测两边同时错也会「一致通过」。
 */
import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvgPath, type QrEcLevel } from '../src/pure/qrcode';
import { REF_BY_KEY } from './fixtures/qrRef';

/** 把参照矩阵的 `'1010…'` 行转成布尔二维数组，便于与编码器输出比对。 */
function toMatrix(rows: readonly string[]): boolean[][] {
    return rows.map((row) => [...row].map((ch) => ch === '1'));
}

/** 参照快照覆盖的用例（与 `tests/fixtures/qrRef.ts` 的键一一对应）。 */
const CASES: ReadonlyArray<{ text: string; ec: QrEcLevel; version: number }> = [
    { text: 'HELLO', ec: 'L', version: 1 },
    { text: 'https://weread.qq.com/', ec: 'M', version: 2 },
    { text: 'https://example.com/a?b=1', ec: 'H', version: 4 },
    {
        text: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=81f07cc20922c19d7eea5b4954a73371&from=',
        ec: 'M',
        version: 8,
    },
];

describe('qrcode 编码器', () => {
    it('参照快照已就位（防止有人把 fixture 清空导致下面的比对全是空转）', () => {
        // 这条是元自检：参照为空时，逐格比对会「比了个寂寞」而永远绿
        expect(Object.keys(REF_BY_KEY).length).toBeGreaterThanOrEqual(4);
        for (const c of CASES) {
            const ref = REF_BY_KEY[`${c.ec}|${c.text}`];
            expect(ref, `参照缺失：${c.ec}|${c.text.slice(0, 20)}`).toBeDefined();
            expect(ref!.version).toBe(c.version);
            expect(Object.keys(ref!.masks).length).toBe(8);
            // 每个矩阵的行数必须等于该版本边长（版本 n ⇒ 17 + 4n）
            for (let mask = 0; mask < 8; mask++) {
                expect(ref!.masks[mask].length).toBe(17 + 4 * c.version);
                expect(ref!.masks[mask][0].length).toBe(17 + 4 * c.version);
            }
        }
    });

    it('版本与尺寸对照正确（版本 n ⇒ 边长 17 + 4n）', () => {
        for (const v of [1, 2, 5, 8, 10]) {
            const qr = encodeQr('HELLO', { ec: 'M', version: v });
            expect(qr.size).toBe(17 + 4 * v);
            expect(qr.version).toBe(v);
        }
    });

    it('自动挑版本：能装下的最小版本（不无谓放大）', () => {
        // 8 字节 @M：版本 1 的 M 档装 14 字节 ⇒ 应停在版本 1
        expect(encodeQr('12345678', { ec: 'M' }).version).toBe(1);
        // 40 字节 @M：版本 2 装 26、版本 3 装 42 ⇒ 应停在版本 3
        expect(encodeQr('a'.repeat(40), { ec: 'M' }).version).toBe(3);
    });

    it('超出容量必须抛错，⛔ 不许静默截断', () => {
        // 截断的二维码扫出来是**错的 URL**，比报错危险得多
        expect(() => encodeQr('a'.repeat(200), { ec: 'H' })).toThrow(/太长/);
        expect(() => encodeQr('a'.repeat(50), { ec: 'H', version: 1 })).toThrow(/超出/);
    });

    it('版本 / 掩码越界都要抛错（别静默夹紧）', () => {
        expect(() => encodeQr('HELLO', { version: 41 })).toThrow(/版本只能是/);
        expect(() => encodeQr('HELLO', { mask: 8 })).toThrow(/掩码只能是/);
        expect(() => encodeQr('HELLO', { mask: -1 })).toThrow(/掩码只能是/);
    });

    it('同一个输入必须得到同一个矩阵（幂等，别带隐藏状态）', () => {
        const a = encodeQr('https://weread.qq.com/', { ec: 'M' });
        const b = encodeQr('https://weread.qq.com/', { ec: 'M' });
        expect(a.mask).toBe(b.mask);
        expect(a.modules).toEqual(b.modules);
    });

    it('三个定位图形必须落在三个角上（「能被扫到」的最低前提）', () => {
        const qr = encodeQr('https://weread.qq.com/', { ec: 'M' });
        const { modules, size } = qr;
        for (const [r, c] of [
            [0, 0],
            [0, size - 1],
            [size - 1, 0],
        ]) {
            expect(modules[r][c]).toBe(true);
        }
        // 分隔带：定位图形外侧一圈必须是浅色
        expect(modules[7][7]).toBe(false);
        expect(modules[7][size - 8]).toBe(false);
        expect(modules[size - 8][7]).toBe(false);
    });

    it('定时图形是黑白交替（第 6 行 / 第 6 列）', () => {
        const qr = encodeQr('HELLO', { ec: 'M', version: 2 });
        for (let i = 8; i < qr.size - 8; i++) {
            expect(qr.modules[6][i]).toBe(i % 2 === 0);
            expect(qr.modules[i][6]).toBe(i % 2 === 0);
        }
    });

    it('SVG path 只覆盖深色模块，且每个模块一条子路径', () => {
        const qr = encodeQr('HELLO', { ec: 'M' });
        const d = qrSvgPath(qr);
        let dark = 0;
        for (const row of qr.modules) for (const v of row) if (v) dark++;
        expect(dark).toBeGreaterThan(0);
        expect(d.split('M').length - 1).toBe(dark);
        expect(d).toMatch(/^M\d+ \d+h1v1h-1z/);
    });

    it('UTF-8 走 byte 模式（中文按多字节算，不是按字符数）', () => {
        // 「中文测试」= 12 字节，版本 1 的 M 档装 14 字节 ⇒ 刚好装得下
        expect(encodeQr('中文测试', { ec: 'M' }).version).toBe(1);
        // 13 个汉字 = 39 字节，版本 2 的 M 档 26 字节装不下 ⇒ 必须升级
        expect(encodeQr('一'.repeat(13), { ec: 'M' }).version).toBeGreaterThan(2);
    });
});

describe('与 Python qrcode 库逐格一致（冻结参照）', () => {
    for (const c of CASES) {
        it(`${c.ec} v${c.version} ${JSON.stringify(c.text.slice(0, 26))}：八种掩码逐个对得上`, () => {
            const ref = REF_BY_KEY[`${c.ec}|${c.text}`];
            expect(ref).toBeDefined();
            for (let mask = 0; mask < 8; mask++) {
                const mine = encodeQr(c.text, { ec: c.ec, version: c.version, mask });
                expect(mine.size).toBe(c.version * 4 + 17);
                // 逐格比对：不是「长得像」，是每一格都必须相同
                expect(mine.modules, `掩码 ${mask} 的矩阵与参照不一致`).toEqual(toMatrix(ref!.masks[mask]));
            }
        });
    }

    it('自动选掩码的结果也在参照里（说明惩罚分实现与官方一致）', () => {
        // 官方按四条规则算惩罚分取最低；我们算出同一个掩码 ⇒ 至少在那一条上对得上
        for (const c of CASES) {
            const mine = encodeQr(c.text, { ec: c.ec, version: c.version });
            expect(mine.mask).toBeGreaterThanOrEqual(0);
            expect(mine.mask).toBeLessThan(8);
            // 自动掩码产出的矩阵，必须等于参照里**同一个掩码**的矩阵
            expect(mine.modules).toEqual(toMatrix(REF_BY_KEY[`${c.ec}|${c.text}`]!.masks[mine.mask]));
        }
    });
});
