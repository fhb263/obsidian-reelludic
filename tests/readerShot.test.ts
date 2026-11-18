import { describe, expect, it } from 'vitest';
import {
    hitShotHandle,
    normalizeShotRect,
    readerShotBlock,
    readerShotFileName,
    readerShotLabel,
    rectFromDrag,
    resizeShotRect,
    sanitizeShotStem,
    SHOT_HANDLE_HIT,
    SHOT_HANDLES,
    SHOT_MIN_SIZE,
    SHOT_SECTION_READER,
    shotStamp,
} from 'pure/readerShot';

describe('readerShot 区域截图纯逻辑（2026-10-23 用户指令）', () => {
    const bounds = { left: 100, top: 50, right: 500, bottom: 450 };

    describe('normalizeShotRect 拖拽归一', () => {
        it('正向拖拽：左上 → 右下', () => {
            expect(normalizeShotRect({ x1: 120, y1: 70, x2: 300, y2: 200 }, bounds)).toEqual({
                x: 120,
                y: 70,
                width: 180,
                height: 130,
            });
        });

        it('反向拖拽：右下 → 左上（摆正方向）', () => {
            expect(normalizeShotRect({ x1: 300, y1: 200, x2: 120, y2: 70 }, bounds)).toEqual({
                x: 120,
                y: 70,
                width: 180,
                height: 130,
            });
        });

        it('越过容器左/上边界：钳制进容器', () => {
            const r = normalizeShotRect({ x1: 40, y1: 10, x2: 200, y2: 100 }, bounds);
            expect(r).toEqual({ x: 100, y: 50, width: 100, height: 50 });
        });

        it('越过容器右/下边界：钳制进容器（窗口外截图会得黑边）', () => {
            const r = normalizeShotRect({ x1: 400, y1: 400, x2: 900, y2: 900 }, bounds);
            expect(r).toEqual({ x: 400, y: 400, width: 100, height: 50 });
        });

        it('完全在容器外：返回 null', () => {
            expect(normalizeShotRect({ x1: 10, y1: 10, x2: 80, y2: 40 }, bounds)).toBeNull();
        });

        it('小于最小尺寸（误触/手抖）：返回 null', () => {
            expect(normalizeShotRect({ x1: 120, y1: 70, x2: 125, y2: 75 }, bounds)).toBeNull();
        });

        it('恰好等于最小尺寸：保留（边界包含）', () => {
            const r = normalizeShotRect(
                { x1: 120, y1: 70, x2: 120 + SHOT_MIN_SIZE, y2: 70 + SHOT_MIN_SIZE },
                bounds,
            );
            expect(r).not.toBeNull();
            expect(r?.width).toBe(SHOT_MIN_SIZE);
        });

        it('结果取整（capturePage 要整数矩形）', () => {
            const r = normalizeShotRect({ x1: 120.4, y1: 70.6, x2: 300.5, y2: 200.2 }, bounds);
            for (const v of [r?.x, r?.y, r?.width, r?.height]) {
                expect(Number.isInteger(v)).toBe(true);
            }
        });
    });

    describe('readerShotFileName 文件名（2026-10-23 用户指令：改成 image-converter 同构形态）', () => {
        // 固定时间，避免测试依赖「现在几点」—— 文件名带时间戳后必须显式传入 Date
        const at = new Date(2026, 9, 23, 15, 30, 12); // 本地时区 2026-10-23 15:30:12
        const stamp = '20261023-153012';

        it('形态 = 「书名 + 时间戳」（⛔ 不再是「书名 截图」）', () => {
            expect(readerShotFileName('三体', at)).toBe(`三体 ${stamp}`);
        });

        it('同秒两张仍同构（撞名由 getAvailablePathForAttachment 加序号兜底）', () => {
            // 同秒两张名字相同 —— 这是已知且可接受的极端情况，宿主的文件管理器会自动加 ` 1`
            expect(readerShotFileName('三体', at)).toBe(readerShotFileName('三体', at));
        });

        it('不同秒产出不同名（旧实现「书名 截图」在这里会撞）', () => {
            const later = new Date(2026, 9, 23, 15, 30, 13);
            expect(readerShotFileName('三体', later)).toBe('三体 20261023-153013');
        });

        it('清洗路径分隔符与链接禁用字符', () => {
            expect(readerShotFileName('a/b:c*d?"e"', at)).toBe(`a b c d e ${stamp}`);
        });

        it('空书名有兜底，不会产出空文件名', () => {
            expect(readerShotFileName('', at)).toBe(`阅读截图 ${stamp}`);
        });

        it('去掉文件扩展名（避免 `三体.epub 2026…` 这种）', () => {
            expect(readerShotFileName('三体.epub', at)).toBe(`三体 ${stamp}`);
        });

        it('不传 at 时用当前时间（不会抛错、且形如 `<书名> YYYYMMDD-HHmmss`）', () => {
            expect(readerShotFileName('三体')).toMatch(/^三体 \d{8}-\d{6}$/);
        });
    });

    describe('shotStamp 时间戳片段', () => {
        it('本地时区 YYYYMMDD-HHmmss，两位数补零', () => {
            expect(shotStamp(new Date(2026, 0, 5, 3, 4, 5))).toBe('20260105-030405');
        });

        it('用 `-` 分隔时分秒（Windows 文件名禁冒号）', () => {
            expect(shotStamp(new Date(2026, 11, 31, 23, 59, 59))).not.toContain(':');
        });

        it('非法 Date 回落当前时间而不是抛错', () => {
            expect(shotStamp(new Date('nope'))).toMatch(/^\d{8}-\d{6}$/);
        });
    });

    describe('sanitizeShotStem', () => {
        it('压掉连续空白', () => {
            expect(sanitizeShotStem('  a   b  ')).toBe('a b');
        });

        it('全是被禁字符时用 fallback', () => {
            expect(sanitizeShotStem('///', '兜底')).toBe('兜底');
        });

        it('非字符串输入不抛错', () => {
            expect(sanitizeShotStem(undefined as unknown as string, '兜底')).toBe('兜底');
        });
    });

    describe('readerShotLabel 出处标签', () => {
        it('页码优先于章节（PDF 的章节号没有意义）', () => {
            expect(readerShotLabel('三体', { page: 3, chapter: 9, pct: 42 })).toBe('摘自《三体》 · 第 3 页 · 42%');
        });

        it('没有页码退章节', () => {
            expect(readerShotLabel('三体', { chapter: 9, pct: 42 })).toBe('摘自《三体》 · 第 9 章 · 42%');
        });

        it('只有百分比', () => {
            expect(readerShotLabel('三体', { pct: 7.6 })).toBe('摘自《三体》 · 8%');
        });

        it('完全没有定位信息时只剩书名', () => {
            expect(readerShotLabel('三体')).toBe('摘自《三体》');
        });

        it('百分比钳制到 0–100', () => {
            expect(readerShotLabel('三体', { pct: 250 })).toBe('摘自《三体》 · 100%');
            expect(readerShotLabel('三体', { pct: -5 })).toBe('摘自《三体》 · 0%');
        });

        it('页码非法（0/NaN）时不算页码', () => {
            expect(readerShotLabel('三体', { page: 0 })).toBe('摘自《三体》');
            expect(readerShotLabel('三体', { page: Number.NaN })).toBe('摘自《三体》');
        });

        it('空书名有兜底', () => {
            expect(readerShotLabel('')).toBe('摘自《未知》');
        });
    });

    describe('readerShotBlock 笔记块', () => {
        it('嵌入 + 斜体出处', () => {
            expect(readerShotBlock({ fileName: '三体.png', label: '摘自《三体》· 第 3 页' })).toBe(
                '![[三体.png]]\n*摘自《三体》· 第 3 页*',
            );
        });

        it('没有 label 时只有嵌入', () => {
            expect(readerShotBlock({ fileName: '三体.png' })).toBe('![[三体.png]]');
        });

        it('文件名空 ⇒ fail-closed 返回空串（调用方不写笔记）', () => {
            expect(readerShotBlock({ fileName: '' })).toBe('');
            expect(readerShotBlock({ fileName: '   ' })).toBe('');
        });
    });

    describe('区段常量', () => {
        it('区段名是「阅读截图」', () => {
            expect(SHOT_SECTION_READER).toBe('阅读截图');
        });
    });

    // 🔴 2026-11-13 用户指令：「批注模式下框选后可进行六向调整宽高」。
    //    这三个纯函数是那套手柄的全部逻辑，必须钉住，否则手柄可以「看着有、拖着不动」。
    describe('rectFromDrag 调整模式造框（不判最小尺寸）', () => {
        it('正向拖：右上角就是尺寸', () => {
            expect(rectFromDrag(120, 70, 300, 200, bounds)).toEqual({ x: 120, y: 70, width: 180, height: 130 });
        });

        it('反向拖也摆正', () => {
            expect(rectFromDrag(300, 200, 120, 70, bounds)).toEqual({ x: 120, y: 70, width: 180, height: 130 });
        });

        it('拖出容器：钳进 bounds，不产生负数宽度', () => {
            const r = rectFromDrag(40, 10, 900, 900, bounds);
            expect(r).toEqual({ x: 100, y: 50, width: 400, height: 400 });
        });

        it('零面积拖拽也返回矩形（调整过程允许暂时很小，松手才判）', () => {
            expect(rectFromDrag(200, 200, 200, 200, bounds)).toEqual({ x: 200, y: 200, width: 0, height: 0 });
        });
    });

    describe('hitShotHandle 命中测试（手柄优先于框内）', () => {
        const r = { x: 100, y: 100, width: 200, height: 100 };

        it('八个手柄都能命中，方向对得上', () => {
            expect(hitShotHandle(r, 100, 100)).toBe('nw');
            expect(hitShotHandle(r, 200, 100)).toBe('n');
            expect(hitShotHandle(r, 300, 100)).toBe('ne');
            expect(hitShotHandle(r, 300, 150)).toBe('e');
            expect(hitShotHandle(r, 300, 200)).toBe('se');
            expect(hitShotHandle(r, 200, 200)).toBe('s');
            expect(hitShotHandle(r, 100, 200)).toBe('sw');
            expect(hitShotHandle(r, 100, 150)).toBe('w');
        });

        it('手柄命中半径内即算命中（手感容差）', () => {
            expect(hitShotHandle(r, 100 + SHOT_HANDLE_HIT, 100 - SHOT_HANDLE_HIT)).toBe('nw');
        });

        it('框正中算 inside，远离则 null', () => {
            expect(hitShotHandle(r, 200, 150)).toBe('inside');
            expect(hitShotHandle(r, 900, 900)).toBeNull();
        });

        it('⛔ 角点优先于边：边与角的容差重叠时不能误判成 n', () => {
            expect(hitShotHandle(r, 103, 103)).toBe('nw');
        });
    });

    describe('resizeShotRect 六向调整', () => {
        const r = { x: 100, y: 100, width: 200, height: 100 };
        const wide = { left: 0, top: 0, right: 1000, bottom: 1000 };

        it('拖 e 只改宽，右边跟着走', () => {
            expect(resizeShotRect(r, 'e', 50, 999, wide)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
        });

        it('拖 w 只改左边，右边钉住', () => {
            expect(resizeShotRect(r, 'w', 40, 999, wide)).toEqual({ x: 140, y: 100, width: 160, height: 100 });
        });

        it('拖 n 只改上边，下边钉住（⛔ 不然会整框上移）', () => {
            expect(resizeShotRect(r, 'n', 999, 30, wide)).toEqual({ x: 100, y: 130, width: 200, height: 70 });
        });

        it('拖 s 只改下边', () => {
            expect(resizeShotRect(r, 's', 999, 25, wide)).toEqual({ x: 100, y: 100, width: 200, height: 125 });
        });

        it('角点同时改两向', () => {
            expect(resizeShotRect(r, 'se', 30, 40, wide)).toEqual({ x: 100, y: 100, width: 230, height: 140 });
        });

        it('缩到下限时钉住，不让框消失', () => {
            const tiny = resizeShotRect(r, 'e', -9999, 0, wide);
            expect(tiny.width).toBe(SHOT_MIN_SIZE);
            expect(tiny.x).toBe(100);
        });

        it('越界钳制后仍不小于 min', () => {
            const squeezed = resizeShotRect({ x: 990, y: 990, width: 10, height: 10 }, 'se', 999, 999, wide);
            expect(squeezed.width).toBeGreaterThanOrEqual(SHOT_MIN_SIZE);
            expect(squeezed.height).toBeGreaterThanOrEqual(SHOT_MIN_SIZE);
        });
    });
});
