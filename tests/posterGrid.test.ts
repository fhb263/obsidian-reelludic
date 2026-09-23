// 海报密度（pure/posterGrid）单测
// 口径（用户 2026-09-22 裁定）：紧凑/标准/宽松 = 最小卡片宽度档；自定义 = 目标列数（带最小卡宽保护）。
// 模板串的**字面形态**是本模块的对外契约 —— 产物断言与视图内联 style 都按它比对，改形态必须同步改这里。
import { describe, it, expect } from 'vitest';
import {
    POSTER_DENSITIES,
    POSTER_DENSITY_LABELS,
    POSTER_CARD_MIN_WIDTHS,
    POSTER_CUSTOM_MIN_WIDTH,
    POSTER_GRID_GAP,
    POSTER_COLUMNS_DEFAULT,
    POSTER_COLUMNS_MIN,
    POSTER_COLUMNS_MAX,
    FALLBACK_POSTER_GRID_TEMPLATE,
    normalizePosterDensity,
    normalizePosterColumns,
    posterGridTemplate,
    type PosterDensity,
} from 'pure/posterGrid';

describe('posterGrid · 档位表', () => {
    it('四档顺序与标签', () => {
        expect(POSTER_DENSITIES).toEqual(['compact', 'standard', 'cozy', 'custom']);
        expect(POSTER_DENSITY_LABELS).toEqual({
            compact: '紧凑',
            standard: '标准',
            cozy: '宽松',
            custom: '自定义列数',
        });
    });

    it('默认档 = 标准，且「自定义」的卡宽下限复用标准档的值（不另造数字）', () => {
        expect(POSTER_DENSITIES.includes('standard')).toBe(true);
        expect(POSTER_CARD_MIN_WIDTHS.standard).toBe(180);
        expect(POSTER_CUSTOM_MIN_WIDTH).toBe(POSTER_CARD_MIN_WIDTHS.standard);
    });

    it('三档最小卡宽递增（紧凑 < 标准 < 宽松）', () => {
        expect(POSTER_CARD_MIN_WIDTHS.compact).toBeLessThan(POSTER_CARD_MIN_WIDTHS.standard);
        expect(POSTER_CARD_MIN_WIDTHS.standard).toBeLessThan(POSTER_CARD_MIN_WIDTHS.cozy);
    });

    it('间距常量与自定义列数边界', () => {
        expect(POSTER_GRID_GAP).toBe(12);
        expect(POSTER_COLUMNS_MIN).toBe(1);
        expect(POSTER_COLUMNS_MAX).toBe(12);
        expect(POSTER_COLUMNS_DEFAULT).toBe(6);
    });
});

describe('normalizePosterDensity · 脏输入一律回落标准档', () => {
    it('合法值原样返回', () => {
        for (const d of POSTER_DENSITIES) expect(normalizePosterDensity(d)).toBe(d);
    });

    it('缺省 / 空值 / 非字符串 → standard', () => {
        for (const raw of [undefined, null, '', '   ', 0, 1, true, false, {}, [], NaN]) {
            expect(normalizePosterDensity(raw)).toBe('standard');
        }
    });

    it('大小写与空格不宽容（只认精确枚举值）', () => {
        expect(normalizePosterDensity('Standard')).toBe('standard');
        expect(normalizePosterDensity(' standard ')).toBe('standard');
        expect(normalizePosterDensity('STANDARD')).toBe('standard');
    });

    it('原型链键不得误判合法（禁用 in 的回归守卫）', () => {
        for (const raw of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
            expect(normalizePosterDensity(raw)).toBe('standard');
        }
    });
});

describe('normalizePosterColumns · 缺省 6、范围 1-12', () => {
    it('数字与数字串都认', () => {
        expect(normalizePosterColumns(8)).toBe(8);
        expect(normalizePosterColumns('8')).toBe(8);
        expect(normalizePosterColumns('  7  ')).toBe(7);
        expect(normalizePosterColumns('6.2')).toBe(6);
    });

    it('越界钳制到 [1, 12]', () => {
        expect(normalizePosterColumns(0)).toBe(1);
        expect(normalizePosterColumns(-3)).toBe(1);
        expect(normalizePosterColumns(99)).toBe(12);
        expect(normalizePosterColumns(12)).toBe(12);
        expect(normalizePosterColumns(1)).toBe(1);
    });

    it('空值 / 非数字 → 缺省 6（输入框被清空时不该掉到 1 列）', () => {
        for (const raw of [undefined, null, '', '   ', 'abc', NaN, Infinity, -Infinity, true, {}, []]) {
            expect(normalizePosterColumns(raw)).toBe(POSTER_COLUMNS_DEFAULT);
        }
    });

    it('小数四舍五入到整数列', () => {
        expect(normalizePosterColumns(6.7)).toBe(7);
        expect(normalizePosterColumns(6.4)).toBe(6);
    });
});

describe('posterGridTemplate · 档位（最小卡宽 + 容器窄于卡宽时不溢出）', () => {
    it('三档按档位卡宽生成，且都带 min(…, 100%) 溢出兜底', () => {
        expect(posterGridTemplate('compact', POSTER_COLUMNS_DEFAULT)).toBe('repeat(auto-fill, minmax(min(150px, 100%), 1fr))');
        expect(posterGridTemplate('standard', POSTER_COLUMNS_DEFAULT)).toBe('repeat(auto-fill, minmax(min(180px, 100%), 1fr))');
        expect(posterGridTemplate('cozy', POSTER_COLUMNS_DEFAULT)).toBe('repeat(auto-fill, minmax(min(220px, 100%), 1fr))');
    });

    it('档位模板不含列数上限逻辑（整条模板不含 calc(）', () => {
        // ⚠️ 不能断言「不含 max(」——`minmax(` 自带 `max(` 子串，会假红
        for (const d of ['compact', 'standard', 'cozy'] as const) {
            expect(posterGridTemplate(d, 4)).not.toContain('calc(');
        }
    });

    it('自定义列数：列宽上限 = 按列数与间距反算，下限 = 卡宽保护', () => {
        expect(posterGridTemplate('custom', 6)).toBe(
            'repeat(auto-fill, minmax(min(max(180px, calc((100% - 60px) / 6)), 100%), 1fr))',
        );
        expect(posterGridTemplate('custom', 3)).toBe(
            'repeat(auto-fill, minmax(min(max(180px, calc((100% - 24px) / 3)), 100%), 1fr))',
        );
    });

    it('自定义列数 1 列：间距总量为 0，且仍是单列整宽', () => {
        expect(posterGridTemplate('custom', 1)).toBe(
            'repeat(auto-fill, minmax(min(max(180px, calc((100% - 0px) / 1)), 100%), 1fr))',
        );
    });

    it('自定义列数入参也走归一（0 → 1 列、脏值 → 缺省 6 列）', () => {
        expect(posterGridTemplate('custom', 0)).toBe(posterGridTemplate('custom', 1));
        expect(posterGridTemplate('custom', NaN)).toBe(posterGridTemplate('custom', POSTER_COLUMNS_DEFAULT));
        expect(posterGridTemplate('custom', 99)).toBe(posterGridTemplate('custom', POSTER_COLUMNS_MAX));
    });

    it('档位入参脏值 → 落标准档（不抛、不产出空串）', () => {
        expect(posterGridTemplate(undefined as unknown as PosterDensity, 6)).toBe(posterGridTemplate('standard', 6));
        expect(posterGridTemplate('nope' as unknown as PosterDensity, 6)).toBe(posterGridTemplate('standard', 6));
    });

    it('CSS 兜底常量与「标准」档一致（内联 style 失效时观感不变）', () => {
        expect(FALLBACK_POSTER_GRID_TEMPLATE).toBe(posterGridTemplate('standard', POSTER_COLUMNS_DEFAULT));
    });
});
