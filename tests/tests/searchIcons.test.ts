// 阅读器网络搜索浮层的引擎图标表（pure/searchIcons）。
// 这里守的是「浮层改成纯图标之后」最容易静默出错的几件事：
//   ① 引擎增减时图标表漏改（漏 → 运行时 undefined → 整个 chip 空白，不报错）
//   ② 图标名写错（Obsidian 内置图标名不存在时 setIcon 静默失败 → 空白按钮，无任何提示）
//   ③ 拿别家品牌标顶替没有 logo 的引擎（观感上「冒充」）
//   ④ 纯黑品牌标在深色主题下隐形（X / TikTok 必须给 hexDark）
import { describe, expect, it } from 'vitest';
import { SEARCH_ENGINES } from 'pure/readerSearch';
import { SEARCH_ENGINE_ICONS, type EngineIcon } from 'pure/searchIcons';

/** 「未被 Simple Icons 收录、必须走内置图标」的引擎（不得改成拿别家品牌标顶替） */
const BUILTIN_ONLY = [
    'bing',
    'quark',
    'ebook',
    'jd',
    'pdd',
    'manmanbuy',
    'smzdm',
    'wanfang',
    'pubscholar',
    'cnki',
    'bingxueshu',
] as const;

/** 已核实存在于 Obsidian 内置图标集（obsidian.asar）的图标名 —— 白名单外的名字一律视为写错 */
const KNOWN_BUILTIN_ICONS = new Set([
    'search',
    'scan-search',
    'book-open',
    'shopping-cart',
    'shopping-bag',
    'line-chart',
    'badge-percent',
    'graduation-cap',
    'file-text',
    'library',
    'book-marked',
]);

const isBrand = (i: EngineIcon): i is Extract<EngineIcon, { kind: 'brand' }> => i.kind === 'brand';

describe('pure/searchIcons 引擎图标表', () => {
    it('与引擎表一一对应（不漏、不重、无未知 id）', () => {
        const engineIds = SEARCH_ENGINES.map((e) => e.id).sort();
        const iconIds = Object.keys(SEARCH_ENGINE_ICONS).sort();
        expect(iconIds).toEqual(engineIds);
        // 引擎表自身也不该有重复 id（重复时上面那条会被掩盖）
        expect(new Set(engineIds).size).toBe(engineIds.length);
    });

    it('每项都是完整的判别联合（brand 有 path+hex、builtin 有 id，二者互斥）', () => {
        for (const [id, icon] of Object.entries(SEARCH_ENGINE_ICONS)) {
            expect(['brand', 'builtin'], `${id} 的 kind`).toContain(icon.kind);
            if (isBrand(icon)) {
                expect(icon.path.length, `${id} path 长度`).toBeGreaterThan(20);
                expect(icon.hex, `${id} hex`).toMatch(/^#[0-9a-f]{6}$/);
                expect('id' in icon, `${id} brand 项不得带 builtin 的 id`).toBe(false);
            } else {
                expect(icon.id.length, `${id} 内置图标名`).toBeGreaterThan(0);
                expect('path' in icon, `${id} builtin 项不得带 brand 的 path`).toBe(false);
            }
        }
    });

    it('没有品牌 logo 的 11 个引擎必须走内置图标（不得拿别家品牌标冒充）', () => {
        for (const id of BUILTIN_ONLY) {
            const icon = SEARCH_ENGINE_ICONS[id];
            expect(icon?.kind, `${id} 应走内置图标`).toBe('builtin');
        }
        // 反向守卫：这 11 个之外不得再出现 builtin（多出来的必是引擎增减时忘了补品牌标）
        const builtinIds = Object.entries(SEARCH_ENGINE_ICONS)
            .filter(([, i]) => !isBrand(i))
            .map(([id]) => id)
            .sort();
        expect(builtinIds).toEqual([...BUILTIN_ONLY].sort());
    });

    it('内置图标名必须在已核实的白名单内（未知名会静默失败 → 空白按钮）', () => {
        for (const [id, icon] of Object.entries(SEARCH_ENGINE_ICONS)) {
            if (isBrand(icon)) continue;
            expect(KNOWN_BUILTIN_ICONS.has(icon.id), `${id} → ${icon.id} 不在已核实名单内`).toBe(true);
        }
    });

    it('brand 的 path 是安全的 SVG 路径片段（防手抄出错字 / 混入标签）', () => {
        for (const [id, icon] of Object.entries(SEARCH_ENGINE_ICONS)) {
            if (!isBrand(icon)) continue;
            expect(icon.path, `${id} path 不得含标签或引号`).not.toMatch(/[<>"'&]/);
            expect(icon.path, `${id} path 必须以 M/m 起笔`).toMatch(/^[Mm]/);
            expect(icon.path, `${id} path 只应含命令与数字`).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]+$/);
        }
    });

    it('纯黑品牌标必须给 hexDark（否则深色主题下隐形）', () => {
        const blacks: string[] = [];
        const withDark: string[] = [];
        for (const [id, icon] of Object.entries(SEARCH_ENGINE_ICONS)) {
            if (!isBrand(icon)) continue;
            if (icon.hex === '#000000') {
                blacks.push(id);
                expect(icon.hexDark, `${id} 是纯黑标却没有 hexDark`).toMatch(/^#[0-9a-f]{6}$/);
            }
            // 反向守卫：hexDark 只该出现在纯黑标上（别的品牌有官方色，不该被覆盖）
            if (icon.hexDark !== undefined) withDark.push(id);
        }
        // 硬编码清单：纯黑标就这三个（抖音取 TikTok 标 / Steam 官方标也是纯黑）—— 变更时必须显式确认
        expect(blacks.sort()).toEqual(['douyin', 'steam']);
        expect(withDark.sort()).toEqual(blacks);
    });
});
