import { describe, expect, it } from 'vitest';
import {
    buildDavFillRows,
    davCheckedRows,
    davFillPairs,
    davSelectableRows,
    naturalCompare,
    sortDavVideos,
    withDavChecked,
} from 'pure/davFill';
import type { DavEntry } from 'pure/webdav';

function entry(name: string, isDir = false, size = 100): DavEntry {
    return { href: `/dav/${name}`, name, url: `https://h/dav/${encodeURIComponent(name)}`, isDir, size, mime: '' };
}

describe('naturalCompare', () => {
    it('数字段按数值比（第2集 < 第10集）', () => {
        expect(naturalCompare('第2集.mp4', '第10集.mp4')).toBeLessThan(0);
    });

    it('前导零不影响顺序', () => {
        expect(naturalCompare('第01集.mp4', '第2集.mp4')).toBeLessThan(0);
        expect(naturalCompare('第02集.mp4', '第10集.mp4')).toBeLessThan(0);
    });

    it('前导零长短不同也要出确定结果（保证全序，不会 a<b 与 b<a 同假）', () => {
        // 口径：数值相等时**短的在前**（`1.mp4` 排在 `01.mp4` 前面）。
        // ⚠️ 方向本身不重要，重要的是**反对称**：两次比较必须符号相反，
        //    否则 `Array.sort` 拿到 NaN 级的比较结果会乱序（这是「第 10 集插到第 2 集前面」的另一种成因）。
        expect(naturalCompare('01.mp4', '1.mp4')).toBeGreaterThan(0);
        expect(naturalCompare('1.mp4', '01.mp4')).toBeLessThan(0);
    });

    it('相等返回 0', () => {
        expect(naturalCompare('a.mp4', 'a.mp4')).toBe(0);
    });

    it('纯文本按字典序', () => {
        expect(naturalCompare('abc', 'abd')).toBeLessThan(0);
    });
});

describe('sortDavVideos', () => {
    it('自然序排、丢掉目录与非视频', () => {
        const list = sortDavVideos([
            entry('第10集.mp4'),
            entry('第2集.mp4'),
            entry('动画', true),
            entry('说明.txt'),
            entry('第1集.mp4'),
        ]);
        expect(list.map((e) => e.name)).toEqual(['第1集.mp4', '第2集.mp4', '第10集.mp4']);
    });

    it('服务端字节序（10 在 2 前）会被纠正 —— 这就是本模块存在的理由', () => {
        const served = [entry('Ep10.mp4'), entry('Ep2.mp4'), entry('Ep1.mp4')];
        expect(sortDavVideos(served).map((e) => e.name)).toEqual(['Ep1.mp4', 'Ep2.mp4', 'Ep10.mp4']);
    });

    it('mkv 等关联得到但播不了的也算剧集（只是不可内置）', () => {
        const list = sortDavVideos([entry('a.mkv')]);
        expect(list).toHaveLength(1);
    });

    it('空输入安全', () => {
        expect(sortDavVideos(undefined)).toEqual([]);
    });
});

describe('buildDavFillRows', () => {
    const files = [entry('第1集.mp4'), entry('第2集.mp4'), entry('第3集.mkv')];

    it('从第 1 集开始对号，默认全勾', () => {
        const rows = buildDavFillRows(files, [], 0, 12);
        expect(rows.map((r) => r.epIndex)).toEqual([0, 1, 2]);
        expect(rows.map((r) => r.epNo)).toEqual([1, 2, 3]);
        expect(rows.every((r) => r.checked)).toBe(true);
    });

    it('anchor 决定从第几集开始（文件是「第 5 集往后」就传 4）', () => {
        const rows = buildDavFillRows(files, [], 4, 12);
        expect(rows.map((r) => r.epIndex)).toEqual([4, 5, 6]);
        expect(rows.map((r) => r.epNo)).toEqual([5, 6, 7]);
    });

    it('已有链接的集不勾（不覆盖用户手填）', () => {
        const rows = buildDavFillRows(files, ['', 'https://old/x.mp4', ''], 0, 12);
        expect(rows.map((r) => r.checked)).toEqual([true, false, true]);
        expect(rows[1].hasUrl).toBe(true);
    });

    it('超出总集数的行标 outOfRange 且不勾', () => {
        const rows = buildDavFillRows(files, [], 0, 2);
        expect(rows[2].outOfRange).toBe(true);
        expect(rows[2].checked).toBe(false);
        expect(rows[0].outOfRange).toBe(false);
    });

    it('总集数缺省 ⇒ 不裁（仍能全填）', () => {
        const rows = buildDavFillRows(files, [], 0);
        expect(rows.every((r) => !r.outOfRange)).toBe(true);
    });

    it('playable 跟着扩展名走（mp4 可内置 / mkv 不可）', () => {
        const rows = buildDavFillRows(files, [], 0, 12);
        expect(rows.map((r) => r.playable)).toEqual([true, true, false]);
    });

    it('纯空格地址视为「没填」', () => {
        const rows = buildDavFillRows(files, ['   '], 0, 12);
        expect(rows[0].hasUrl).toBe(false);
        expect(rows[0].checked).toBe(true);
    });
});

describe('勾选与取出', () => {
    const files = [entry('a.mp4'), entry('b.mp4'), entry('c.mp4')];

    it('davSelectableRows 排除超界', () => {
        const rows = buildDavFillRows(files, [], 0, 2);
        expect(davSelectableRows(rows)).toHaveLength(2);
    });

    it('davCheckedRows 只留勾中且不超界', () => {
        let rows = buildDavFillRows(files, [], 0, 3);
        rows = rows.map((r) => withDavChecked(r, r.epIndex === 1));
        expect(davCheckedRows(rows).map((r) => r.epIndex)).toEqual([1]);
    });

    it('withDavChecked 返回新对象（Svelte 4 不能就地改）', () => {
        const rows = buildDavFillRows(files, [], 0, 3);
        const next = withDavChecked(rows[0], false);
        expect(next).not.toBe(rows[0]);
        expect(next.checked).toBe(false);
        expect(rows[0].checked).toBe(true);
    });

    it('withDavChecked 同值时原样返回（⛔ 不无谓重建）', () => {
        const rows = buildDavFillRows(files, [], 0, 3);
        expect(withDavChecked(rows[0], true)).toBe(rows[0]);
    });

    it('davFillPairs 产出 [集下标, 地址]', () => {
        const rows = buildDavFillRows(files, [], 2, 12);
        const pairs = davFillPairs(rows);
        expect(pairs).toHaveLength(3);
        expect(pairs[0][0]).toBe(2);
        expect(pairs[0][1]).toContain('https://');
    });

    it('davFillPairs 再挡一次超界（⛔ 不靠调用点记得判）', () => {
        const rows = buildDavFillRows(files, [], 0, 2).map((r) => ({ ...r, checked: true }));
        expect(davFillPairs(rows)).toHaveLength(2);
    });
});
