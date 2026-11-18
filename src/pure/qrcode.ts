/**
 * 最小 QR 编码器（byte 模式，版本 1–10，四档纠错）。
 *
 * 🔴 为什么要自己写（2026-11-12 用户 m05505 反馈后）：
 *    用户实测「B 站扫码登录怎么是跳转到浏览器登录还会触发下载 iBiliPlayer」——
 *    根因是上一版为了保住 `qrcode_key` 给子窗口设了**移动端 UA**，B 站 H5 页认出来就
 *    渲染「下载 App」引导页。⇒ 不再弹子窗口，改为**插件内自绘二维码**，只走 Node 侧轮询。
 *    要自绘就得有编码器；`package.json` 的运行时依赖至今只有 `jszip`，⛔ 不为这个功能加依赖，
 *    也 ⛔ 不去借 Obsidian 内部实现（asar 里确有 `qrcode` 字样，但那是私有模块，版本一变就炸）。
 *
 * 能力边界（够用即止，⛔ 别扩成通用库）：
 *  · 只有 **byte 模式**（UTF-8 字节）—— 我们只编码 URL，不需要数字/字母数字/汉字模式。
 *  · 只有 **版本 1–10**（最多 274 字节 @L / 122 字节 @H）—— B 站扫码 URL 约 125 字节，
 *    版本 8 的 M 档（154 字节）就装得下；留到 10 是给将来更长的 URL 余量。
 *  · 四档纠错全支持，默认 **M**（二维码贴在屏幕上给人扫，M 在「容错」与「密度」间最稳）。
 *
 * 正确性怎么保证：`tests/qrcode.test.ts` 用 Python `qrcode` 库生成的参照矩阵做**逐格比对**
 * （同一段文本 + 同版本 + 同纠错档 + 同掩码 ⇒ 矩阵必须一模一样）。
 * ⚠️ 只测「能不能画出来」是没用的 —— 画错一格手机就扫不出，必须逐格对。
 */

/** 四档纠错（容错能力 L < M < Q < H）。 */
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * 每版本 × 每纠错档的 Reed-Solomon 分块表。
 *
 * 结构：`[每块纠错码字数, [块数, 每块数据码字数], ...]`
 * —— 后面可能跟第二组（块数不同、每块数据码字数也不同，见版本 5 Q 档）。
 * 数据来源：ISO/IEC 18004 表 9。⚠️ 这些数字**不能凭记忆改**，改错一个字节整个矩阵就废。
 */
const RS_BLOCKS: Record<number, Record<QrEcLevel, [number, ...[number, number][]]>> = {
    1: { L: [7, [1, 19]], M: [10, [1, 16]], Q: [13, [1, 13]], H: [17, [1, 9]] },
    2: { L: [10, [1, 34]], M: [16, [1, 28]], Q: [22, [1, 22]], H: [28, [1, 16]] },
    3: { L: [15, [1, 55]], M: [26, [1, 44]], Q: [18, [2, 17]], H: [22, [2, 13]] },
    4: { L: [20, [1, 80]], M: [18, [2, 32]], Q: [26, [2, 24]], H: [16, [4, 9]] },
    5: { L: [26, [1, 108]], M: [24, [2, 43]], Q: [18, [2, 15], [2, 16]], H: [22, [2, 11], [2, 12]] },
    6: { L: [18, [2, 68]], M: [16, [4, 27]], Q: [24, [4, 19]], H: [28, [4, 15]] },
    7: { L: [20, [2, 78]], M: [18, [4, 31]], Q: [18, [2, 14], [4, 15]], H: [26, [4, 13], [1, 14]] },
    8: { L: [24, [2, 97]], M: [22, [2, 38], [2, 39]], Q: [22, [4, 18], [2, 19]], H: [26, [4, 14], [2, 15]] },
    9: { L: [30, [2, 116]], M: [22, [3, 36], [2, 37]], Q: [20, [4, 16], [4, 17]], H: [24, [4, 12], [4, 13]] },
    10: { L: [18, [2, 68], [2, 69]], M: [26, [4, 43], [1, 44]], Q: [24, [6, 19], [2, 20]], H: [28, [6, 15], [2, 16]] },
};

/**
 * 每版本的**对齐图形**中心坐标（行列各取一份，做笛卡尔积）。
 * 版本 1 没有对齐图形；版本 2 起从 `[6, 末尾-7]` 起步，中间按 2 的步长铺。
 */
const ALIGN_POS: Record<number, number[]> = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
};

/** 纠错档在「格式信息」里的两位编码（⚠️ 不是按 L<M<Q<H 顺序，见规范表 12）。 */
const EC_FORMAT_BITS: Record<QrEcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/** 版本上限：见文件头「能力边界」。 */
const MAX_VERSION = 10;

/* ── GF(256) 算术（本原多项式 0x11D，二维码规范固定值） ────────────────── */

/** 指数表 / 对数表（一次性建好，避免每次乘除都跑循环）。 */
const EXP: number[] = new Array(512);
const LOG: number[] = new Array(256).fill(0);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    // 表尾补一份（下标能到 255 + 255 = 510），省掉取模
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
}

/** 生成多项式 `(x - a^0)(x - a^1)…(x - a^(n-1))`，系数从高次到低次。 */
function rsGenerator(n: number): number[] {
    let poly = [1];
    for (let i = 0; i < n; i++) {
        const next = new Array<number>(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];
            next[j + 1] ^= gfMul(poly[j], EXP[i]);
        }
        poly = next;
    }
    return poly;
}

/** 对一块数据算纠错码字（多项式除法取余）。 */
function rsRemainder(data: readonly number[], ecLen: number): number[] {
    const gen = rsGenerator(ecLen);
    const res = new Array<number>(ecLen).fill(0);
    for (const byte of data) {
        const factor = byte ^ res[0];
        res.shift();
        res.push(0);
        for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
    }
    return res;
}

/* ── 容量计算 ──────────────────────────────────────────────────────── */

/** 该版本该档的**数据**码字总数（不含纠错码字）。 */
function dataCodewords(version: number, ec: QrEcLevel): number {
    const [, ...groups] = RS_BLOCKS[version][ec];
    return groups.reduce((sum, [blocks, per]) => sum + blocks * per, 0);
}

/** 该版本该档的**总**码字数（数据 + 纠错），用来判容量上限。 */
function totalCodewords(version: number, ec: QrEcLevel): number {
    const [ecPer] = RS_BLOCKS[version][ec];
    const [, ...groups] = RS_BLOCKS[version][ec];
    const blocks = groups.reduce((sum, [b]) => sum + b, 0);
    return dataCodewords(version, ec) + ecPer * blocks;
}

/**
 * byte 模式下，该版本能装多少**字节**。
 *
 * 头开销 = 4 位模式指示 + 字符计数（版本 1–9 是 8 位，10–26 是 16 位）。
 * ⚠️ 版本 10 起计数位宽翻倍 —— 这条边界写错会让版本 9 恰好能装的内容在版本 10 反而装不下。
 */
function byteCapacity(version: number, ec: QrEcLevel): number {
    const bits = dataCodewords(version, ec) * 8;
    const countBits = version <= 9 ? 8 : 16;
    return Math.floor((bits - 4 - countBits) / 8);
}

/* ── 位流 ──────────────────────────────────────────────────────────── */

function utf8Bytes(text: string): number[] {
    // ⚠️ 不直接用 `TextEncoder`：本模块要能在 vitest 的 node 环境与 Obsidian 渲染进程里同行为，
    //    手写一遍 UTF-8 只多十几行，却省掉「环境有没有 TextEncoder」这个变量。
    const out: number[] = [];
    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        else
            out.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f),
            );
    }
    return out;
}

/** 把数据码字与纠错码字**交织**成最终码字序列（规范 7.6 的 interleaving）。 */
function buildCodewords(bytes: readonly number[], version: number, ec: QrEcLevel): number[] {
    const [ecPer, ...groups] = RS_BLOCKS[version][ec];

    // 1) 按分组切数据
    const dataBlocks: number[][] = [];
    let cursor = 0;
    for (const [blocks, per] of groups) {
        for (let b = 0; b < blocks; b++) {
            dataBlocks.push(bytes.slice(cursor, cursor + per));
            cursor += per;
        }
    }

    // 2) 每块各算纠错
    const ecBlocks = dataBlocks.map((d) => rsRemainder(d, ecPer));

    // 3) 交织：先按「第 i 个数据码字」竖着取遍所有块，再按同样方式取纠错码字
    const out: number[] = [];
    const maxData = Math.max(...dataBlocks.map((d) => d.length));
    for (let i = 0; i < maxData; i++) {
        for (const d of dataBlocks) if (i < d.length) out.push(d[i]);
    }
    for (let i = 0; i < ecPer; i++) {
        for (const e of ecBlocks) out.push(e[i]);
    }
    return out;
}

/** 数据字节 → 码字序列（含模式指示、计数、终止符、填充字节）。 */
function encodeData(bytes: readonly number[], version: number, ec: QrEcLevel): number[] {
    const capacity = dataCodewords(version, ec) * 8;
    const bits: number[] = [];
    const push = (value: number, len: number): void => {
        for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(0b0100, 4); // byte 模式
    push(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) push(b, 8);

    // 终止符：最多 4 个 0，且不能超出容量（容量刚好用满时一个都不补）
    const term = Math.min(4, capacity - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);

    // 补到字节边界
    while (bits.length % 8 !== 0) bits.push(0);

    const words: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
        words.push(v);
    }
    // 交替填充 0xEC / 0x11 直到装满（规范指定的两个填充字节）
    const target = capacity / 8;
    for (let i = 0; words.length < target; i++) words.push(i % 2 === 0 ? 0xec : 0x11);
    return words;
}

/* ── BCH 校验（格式信息 15 位 / 版本信息 18 位） ─────────────────────── */

/** 格式信息：5 位（2 纠错 + 3 掩码）→ 15 位，再异或 0x5412。 */
function formatBits(ec: QrEcLevel, mask: number): number {
    const data = (EC_FORMAT_BITS[ec] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
}

/** 版本信息：6 位版本号 → 18 位（仅版本 7 起需要）。 */
function versionBits(version: number): number {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    return (version << 12) | rem;
}

/* ── 矩阵构建 ──────────────────────────────────────────────────────── */

interface QrMatrix {
    /** 边长（模块数，不含静默区） */
    size: number;
    /** `modules[row][col]`，`true` = 深色 */
    modules: boolean[][];
    version: number;
    ec: QrEcLevel;
    mask: number;
}

/** 画固定功能图形，并标出「已被占用」的格子（数据不能写进去）。 */
function placeFunctionPatterns(version: number, size: number, reserved: boolean[][], modules: boolean[][]): void {
    const set = (r: number, c: number, dark: boolean): void => {
        if (r < 0 || c < 0 || r >= size || c >= size) return;
        modules[r][c] = dark;
        reserved[r][c] = true;
    };

    // 三个定位图形（左上 / 右上 / 左下）+ 各自的白色分隔带
    const finder = (row: number, col: number): void => {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const rr = row + r;
                const cc = col + c;
                if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
                // 7×7 里：外框一圈深色、第二圈浅色、中心 3×3 深色
                const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                    (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                    (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                set(rr, cc, dark);
            }
        }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    // 定时图形：第 6 行 / 第 6 列，黑白交替
    for (let i = 8; i < size - 8; i++) {
        const dark = i % 2 === 0;
        set(6, i, dark);
        set(i, 6, dark);
    }

    // 对齐图形（5×5：外圈深、内圈浅、中心深），⚠️ 与定位图形重叠的位置要跳过
    const centers = ALIGN_POS[version];
    for (const row of centers) {
        for (const col of centers) {
            // 三个角上的定位图形位置不画
            if ((row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8)) continue;
            for (let r = -2; r <= 2; r++) {
                for (let c = -2; c <= 2; c++) {
                    const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
                    set(row + r, col + c, dark);
                }
            }
        }
    }

    // 固定的深色模块（第 4 版起在 (size-8, 8)）
    set(size - 8, 8, true);

    // 预留格式信息区（先占位，稍后按掩码写值）
    for (let i = 0; i < 9; i++) {
        if (!reserved[8][i]) set(8, i, false);
        if (!reserved[i][8]) set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
        set(8, size - 1 - i, false);
        set(size - 1 - i, 8, false);
    }

    // 预留版本信息区（版本 7 起）
    if (version >= 7) {
        for (let i = 0; i < 18; i++) {
            const r = Math.floor(i / 3);
            const c = (i % 3) + size - 11;
            set(r, c, false);
            set(c, r, false);
        }
    }
}

/** 按规范 zigzag 把码字写进矩阵（从右下角起，两列一组向上/向下交替）。 */
function placeData(codewords: readonly number[], size: number, reserved: boolean[][], modules: boolean[][]): void {
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    const bitAt = (i: number): boolean => {
        if (i >= totalBits) return false; // 余数位（remainder bits）恒为浅色
        return ((codewords[i >> 3] >> (7 - (i & 7))) & 1) === 1;
    };

    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
        // 第 6 列是定时图形，整列跳过（右半边的列号要左移一位）
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            const row = upward ? size - 1 - vert : vert;
            for (let k = 0; k < 2; k++) {
                const col = right - k;
                if (reserved[row][col]) continue;
                modules[row][col] = bitAt(bitIndex++);
            }
        }
        upward = !upward;
    }
}

/** 八种掩码的判定函数（规范表 10）。 */
function maskBit(mask: number, r: number, c: number): boolean {
    switch (mask) {
        case 0:
            return (r + c) % 2 === 0;
        case 1:
            return r % 2 === 0;
        case 2:
            return c % 3 === 0;
        case 3:
            return (r + c) % 3 === 0;
        case 4:
            return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5:
            return ((r * c) % 2) + ((r * c) % 3) === 0;
        case 6:
            return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        default:
            return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
}

/** 把格式信息与（版本 7 起的）版本信息写进矩阵。 */
function placeFormatAndVersion(
    version: number,
    size: number,
    ec: QrEcLevel,
    mask: number,
    modules: boolean[][],
): void {
    const fmt = formatBits(ec, mask);
    const bit = (i: number): boolean => ((fmt >> i) & 1) === 1;

    // 🔴🔴 格式信息的两份拷贝，坐标**极易写反**（本模块第一版就写反了：把「列 8 竖排」
    //    写成了「行 8 横排」，结果数据区全对、只有第 8 行与第 8 列共 17 格错 —— 这种码
    //    人眼看着完全正常，手机却扫不出）。规范与所有参考实现（Python `qrcode`、
    //    Nayuki）的坐标都是 `setFunctionModule(x=8, y=i)`，即**列 8、行 i**。
    //    写错一处就整张废，⛔ 改这里必须重跑 `tests/qrcode.test.ts` 的逐格比对。

    // 第一份（左上）：bit 0–5 沿**列 8** 从上往下
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    // bit 9–14 沿**行 8** 向左（col 5 到 col 0；col 6 是定时图形，跳过）
    for (let i = 9; i <= 14; i++) modules[8][15 - i - 1] = bit(i);

    // 第二份：bit 0–7 沿**行 8** 靠右端（右上角下方）
    for (let i = 0; i <= 7; i++) modules[8][size - 1 - i] = bit(i);
    // bit 8–14 沿**列 8** 靠底端（左下角上方）
    for (let i = 8; i <= 14; i++) modules[size - 15 + i][8] = bit(i);
    // 固定深色模块（写格式信息时会被覆盖，这里补回来）
    modules[size - 8][8] = true;

    if (version >= 7) {
        const ver = versionBits(version);
        for (let i = 0; i < 18; i++) {
            const dark = ((ver >> i) & 1) === 1;
            const r = Math.floor(i / 3);
            const c = (i % 3) + size - 11;
            modules[r][c] = dark;
            modules[c][r] = dark;
        }
    }
}

/** 掩码惩罚分（规范表 11 的四条规则，分越低越好）。 */
function penalty(modules: boolean[][], size: number): number {
    let score = 0;

    // 规则 1：同色连续 5 个以上（行、列各算一遍）
    for (let i = 0; i < size; i++) {
        for (const horizontal of [true, false]) {
            let run = 1;
            let prev = horizontal ? modules[i][0] : modules[0][i];
            for (let j = 1; j < size; j++) {
                const cur = horizontal ? modules[i][j] : modules[j][i];
                if (cur === prev) {
                    run++;
                } else {
                    if (run >= 5) score += 3 + (run - 5);
                    run = 1;
                    prev = cur;
                }
            }
            if (run >= 5) score += 3 + (run - 5);
        }
    }

    // 规则 2：2×2 同色方块，每块 3 分
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const v = modules[r][c];
            if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
        }
    }

    // 规则 3：形如 1:1:3:1:1 且一侧有 4 格空白的图案，每处 40 分
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (get: (k: number) => boolean, start: number, pat: boolean[]): boolean => {
        for (let k = 0; k < pat.length; k++) if (get(start + k) !== pat[k]) return false;
        return true;
    };
    for (let i = 0; i < size; i++) {
        for (let j = 0; j <= size - 11; j++) {
            if (matches((k) => modules[i][k], j, pat1) || matches((k) => modules[i][k], j, pat2)) score += 40;
            if (matches((k) => modules[k][i], j, pat1) || matches((k) => modules[k][i], j, pat2)) score += 40;
        }
    }

    // 规则 4：深色占比偏离 50% 越多分越高
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
}

/**
 * 生成二维码矩阵。
 *
 * @param text 要编码的内容（按 UTF-8 转字节，走 byte 模式）
 * @param opts.ec 纠错档，默认 `'M'`
 * @param opts.version 指定版本（不传 = 自动挑**能装下**的最小版本）
 * @param opts.mask 指定掩码 0–7（不传 = 八种全试，取惩罚分最低的那个；与官方实现一致）
 * @throws 内容超出所选/最大版本容量时抛错（⛔ 不静默截断 —— 截断的二维码扫出来是错的 URL）
 */
export function encodeQr(
    text: string,
    opts: { ec?: QrEcLevel; version?: number; mask?: number } = {},
): QrMatrix {
    const ec = opts.ec ?? 'M';
    const bytes = utf8Bytes(text);

    let version = opts.version ?? 0;
    if (version === 0) {
        for (let v = 1; v <= MAX_VERSION; v++) {
            if (bytes.length <= byteCapacity(v, ec)) {
                version = v;
                break;
            }
        }
        if (version === 0) {
            throw new Error(`内容太长（${bytes.length} 字节），版本 ${MAX_VERSION} 的 ${ec} 档也装不下`);
        }
    }
    if (version < 1 || version > MAX_VERSION) {
        throw new Error(`版本只能是 1–${MAX_VERSION}，收到 ${version}`);
    }
    if (bytes.length > byteCapacity(version, ec)) {
        throw new Error(
            `内容 ${bytes.length} 字节超出版本 ${version} 的 ${ec} 档容量（${byteCapacity(version, ec)} 字节）`,
        );
    }

    const codewords = buildCodewords(encodeData(bytes, version, ec), version, ec);
    // 自检：交织后的码字数必须等于该版本该档的总码字数，否则说明分块表或交织写错了
    const expected = totalCodewords(version, ec);
    if (codewords.length !== expected) {
        throw new Error(`内部错误：码字数 ${codewords.length} ≠ 期望 ${expected}（版本 ${version} ${ec}）`);
    }

    const size = 17 + 4 * version;
    const build = (mask: number): boolean[][] => {
        const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
        const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
        placeFunctionPatterns(version, size, reserved, modules);
        placeData(codewords, size, reserved, modules);
        // 掩码只作用于数据区（功能图形已被 reserved 标记）
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (!reserved[r][c] && maskBit(mask, r, c)) modules[r][c] = !modules[r][c];
            }
        }
        placeFormatAndVersion(version, size, ec, mask, modules);
        return modules;
    };

    if (opts.mask !== undefined) {
        const mask = opts.mask;
        if (mask < 0 || mask > 7) throw new Error(`掩码只能是 0–7，收到 ${mask}`);
        return { size, modules: build(mask), version, ec, mask };
    }

    let best: { mask: number; modules: boolean[][]; score: number } | null = null;
    for (let mask = 0; mask < 8; mask++) {
        const modules = build(mask);
        const score = penalty(modules, size);
        if (!best || score < best.score) best = { mask, modules, score };
    }
    return { size, modules: best!.modules, version, ec, mask: best!.mask };
}

/**
 * 把矩阵转成一条 SVG `path` 的 `d` 属性（每个深色模块画一个 1×1 方块）。
 *
 * 用一条 path 而不是 N 个 `<rect>`：45×45 的版本 8 有两千多个深色模块，
 * 两千个 DOM 节点在设置页里滚动会卡；单条 path 只有一串子路径。
 * 调用方把 `viewBox` 设成 `0 0 size size` 即可，⛔ 不要自己再算缩放。
 */
export function qrSvgPath(matrix: QrMatrix): string {
    const parts: string[] = [];
    for (let r = 0; r < matrix.size; r++) {
        for (let c = 0; c < matrix.size; c++) {
            if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
        }
    }
    return parts.join('');
}
