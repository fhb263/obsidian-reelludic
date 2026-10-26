import { describe, expect, it } from 'vitest';
import {
    normalizeShotRect,
    readerShotBlock,
    readerShotFileName,
    readerShotLabel,
    sanitizeShotStem,
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
});
