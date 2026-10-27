/**
 * `seriesRatings`（系列/合集评分）在 catalog 里的**往返**单测（用户 2026-10-27 裁定「加合集分」）。
 *
 * 🔴 这里钉的是「读了能写、写了能读、脏的不进盘」——
 *    单看 `pure/seriesRating` 的纯函数测不出「忘了在 serializeCatalog 里写回」这种漏，
 *    那正是这类字段最常见的死法（读侧加了、写侧漏了 ⇒ 重启后分全丢）。
 */
import { describe, expect, it } from 'vitest';
import { parseCatalog, serializeCatalog } from '../src/data/catalog';
import type { Catalog } from '../src/data/types';
import { seriesKeyOf } from '../src/pure/seriesGroup';

const KEY = 'movie\u0001周星驰';

describe('seriesRatings 往返', () => {
    it('🔴 存进去能读回来（读侧 + 写侧都接了，⛔ 别只加读侧）', () => {
        const cat: Catalog = {
            version: 1,
            entries: [],
            seriesRatings: { [KEY]: 4.5 },
        };
        const text = serializeCatalog(cat);
        expect(text).toContain('seriesRatings');
        const back = parseCatalog(text);
        expect(back.seriesRatings).toEqual({ [KEY]: 4.5 });
    });

    it('🔴 空表**不写键**（⛔ 别给每个存量文件凭空添一个 `"seriesRatings": {}`）', () => {
        const text = serializeCatalog({ version: 1, entries: [] });
        expect(text).not.toContain('seriesRatings');
        expect(parseCatalog(text).seriesRatings).toBeUndefined();
    });

    it('🔴 写侧清掉 0 值（与 `writeSeriesRating` 的删键口径同源）', () => {
        const text = serializeCatalog({ version: 1, entries: [], seriesRatings: { [KEY]: 0, other: 3 } });
        const back = parseCatalog(text);
        expect(back.seriesRatings).toEqual({ other: 3 });
    });

    it('🔴 读侧吃掉脏值（字符串 / null / 越界 / 数组 / 非对象都不许抛错）', () => {
        const dirty = JSON.stringify({
            version: 1,
            entries: [],
            seriesRatings: { good: 2.5, bad: 'x', nul: null, over: 99, arr: [1] },
        });
        expect(parseCatalog(dirty).seriesRatings).toEqual({ good: 2.5, over: 5 });
    });

    it('seriesRatings 非对象 ⇒ 当没有（⛔ 不抛错、不把文件读废）', () => {
        expect(parseCatalog(JSON.stringify({ version: 1, entries: [], seriesRatings: 5 })).seriesRatings).toBeUndefined();
        expect(parseCatalog(JSON.stringify({ version: 1, entries: [], seriesRatings: 'x' })).seriesRatings).toBeUndefined();
    });

    it('分组键含 `\\u0001` 分隔符也能原样往返（JSON 会转义它）', () => {
        const key = seriesKeyOf({ type: 'movie', series: '周星驰' }) as string;
        expect(key).toBe(KEY);
        const back = parseCatalog(serializeCatalog({ version: 1, entries: [], seriesRatings: { [key]: 5 } }));
        expect(back.seriesRatings?.[key]).toBe(5);
    });

    it('写侧归一后值仍是合法档位（越界钳到 5、小数四舍五入到半档）', () => {
        const back = parseCatalog(serializeCatalog({ version: 1, entries: [], seriesRatings: { a: 3.26, b: -1 } }));
        expect(back.seriesRatings).toEqual({ a: 3.5 });
    });
});
