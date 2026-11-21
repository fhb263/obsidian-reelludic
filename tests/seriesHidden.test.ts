/**
 * 「隐藏此系列卡片」测试（m03458）。
 *
 * 用户原话（2026-11-21，逐字）：
 *   「在系列卡编辑属性窗口底部的『关闭』按钮删除掉（逻辑重复了），还有再在右上角加个
 *     『[复选框]隐藏此系列卡片』就只隐藏该系列封面和此信息栏，里面的系列条目不受影响」
 * 追问后追加澄清（逐字）：「不，这个隐藏的意思是模糊化，就像单卡那样」
 *
 * 本文件分四块：
 *   ① `pure/seriesHidden` 纯逻辑（读写/归一/判据/原型链守卫）
 *   ② catalog 顶层字段的「存得进、读得回」（本仓踩过 `seriesRatings` 漏搬的坑）
 *   ③ 「关闭」按钮确实没了（用户点名要删）
 *   ④ 接线纪律：模糊化复用既有 `is-card-hidden`、⛔ 不碰组内条目、⛔ 别把两个判据合并
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    normalizeSeriesHidden,
    seriesGroupHidden,
    seriesKeyOfEntry,
    writeSeriesHidden,
    type SeriesHiddenMap,
} from 'pure/seriesHidden';
import { parseCatalog, serializeCatalog } from 'data/catalog';
import type { MediaEntry } from 'data/types';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** 剥掉 CSS / JS 注释 —— 断言里写了类名字面量时，注释会自己命中自己（已踩过两次） */
function stripCssComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '');
}
function stripTsComments(code: string): string {
    return code
        .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('seriesHidden · 判据与写入口径', () => {
    it('只认 `=== true`；false / 0 / 字符串 / 缺键一律不算隐藏', () => {
        const map: SeriesHiddenMap = { 'movie\u0001周星驰': true };
        expect(seriesGroupHidden(map, 'movie\u0001周星驰')).toBe(true);
        expect(seriesGroupHidden(map, 'movie\u0001成龙')).toBe(false);
        // 脏数据绕过来（手改 catalog.json）也必须判否
        expect(seriesGroupHidden({ k: false } as unknown as SeriesHiddenMap, 'k')).toBe(false);
        expect(seriesGroupHidden({ k: 1 } as unknown as SeriesHiddenMap, 'k')).toBe(false);
        expect(seriesGroupHidden({ k: 'true' } as unknown as SeriesHiddenMap, 'k')).toBe(false);
        expect(seriesGroupHidden(null, 'k')).toBe(false);
        expect(seriesGroupHidden(undefined, 'k')).toBe(false);
        expect(seriesGroupHidden(map, '')).toBe(false);
    });

    it('🔴 原型链守卫：`constructor` / `toString` 不能被判成「隐藏了」', () => {
        // 内联 `map[key] === true` 写法在这里会返回函数（truthy），本仓已踩过同类坑
        const empty: SeriesHiddenMap = {};
        expect(seriesGroupHidden(empty, 'constructor')).toBe(false);
        expect(seriesGroupHidden(empty, 'toString')).toBe(false);
        expect(seriesGroupHidden(empty, '__proto__')).toBe(false);
    });

    it('写 true ⇒ 新增键；写非 true ⇒ 删键（**不存 false**）', () => {
        const a = writeSeriesHidden({}, 'g1', true);
        expect(a).toEqual({ g1: true });
        const b = writeSeriesHidden(a, 'g1', false);
        expect(b).toEqual({});
        // 🔴 不许留 `g1: false` 这种噪音键
        expect(Object.keys(b)).toHaveLength(0);
    });

    it('🔴 无变化时返回**同一个引用**（调用方据此跳过落盘）', () => {
        const a = writeSeriesHidden({}, 'g1', true);
        expect(writeSeriesHidden(a, 'g1', true)).toBe(a);
        const empty: SeriesHiddenMap = {};
        // 本来就没有、又要删 ⇒ 不必产出新表
        expect(writeSeriesHidden(empty, 'nope', false)).toBe(empty);
    });

    it('不改入参（纯函数纪律）', () => {
        const src: SeriesHiddenMap = { g1: true };
        writeSeriesHidden(src, 'g2', true);
        writeSeriesHidden(src, 'g1', false);
        expect(src).toEqual({ g1: true });
    });

    it('脏输入不抛：null / 数组 / 数字 / 空键', () => {
        expect(writeSeriesHidden(null, 'g1', true)).toEqual({ g1: true });
        expect(writeSeriesHidden(undefined, 'g1', true)).toEqual({ g1: true });
        expect(() => writeSeriesHidden([] as unknown as SeriesHiddenMap, 'g1', true)).not.toThrow();
        expect(writeSeriesHidden({ g1: true }, '', true)).toEqual({ g1: true });
    });

    it('normalizeSeriesHidden 只留 `true`，清掉 false 与脏值', () => {
        expect(
            normalizeSeriesHidden({ a: true, b: false, c: 1, d: 'true', e: null, '': true }),
        ).toEqual({ a: true });
        // 非对象一律空表（parseCatalog 靠这个兜底）
        expect(normalizeSeriesHidden(null)).toEqual({});
        expect(normalizeSeriesHidden([])).toEqual({});
        expect(normalizeSeriesHidden('x')).toEqual({});
        expect(normalizeSeriesHidden(42)).toEqual({});
    });

    it('seriesKeyOfEntry 转调 seriesGroup.seriesKeyOf（同一真源，不另拼字符串）', () => {
        const e = { type: 'movie', series: '  周星驰  ' } as MediaEntry;
        // 归一化会 trim ⇒ 键里不带空格
        expect(seriesKeyOfEntry(e)).toBe('movie\u0001周星驰');
        expect(seriesKeyOfEntry(null)).toBeNull();
        expect(seriesKeyOfEntry({ type: 'movie' } as MediaEntry)).toBeNull();
    });
});

describe('catalog · seriesHidden 存得进、读得回', () => {
    /** 造一条最小可用条目 */
    const entry = (id: string, series: string): MediaEntry =>
        ({
            id,
            type: 'movie',
            title: `片子${id}`,
            status: 'done',
            series,
            createdAt: '2026-11-21T00:00:00.000Z',
            updatedAt: '2026-11-21T00:00:00.000Z',
        }) as unknown as MediaEntry;

    it('🔴 写盘后能原样读回（本仓踩过 `seriesRatings` 漏搬 ⇒ 存了读不回来的坑）', () => {
        const text = serializeCatalog({
            version: 1,
            entries: [entry('a', '周星驰'), entry('b', '周星驰')],
            seriesHidden: { 'movie\u0001周星驰': true },
        });
        // 确实落进了 JSON
        expect(text).toContain('seriesHidden');
        const back = parseCatalog(text);
        expect(back.seriesHidden).toEqual({ 'movie\u0001周星驰': true });
    });

    it('空表**不写键**（⛔ 别给存量文件凭空添一个 `"seriesHidden": {}`）', () => {
        const text = serializeCatalog({ version: 1, entries: [entry('a', 'x')] });
        expect(text).not.toContain('seriesHidden');
    });

    it('脏值在写盘时被清掉（false 不进盘）', () => {
        const text = serializeCatalog({
            version: 1,
            entries: [entry('a', 'x')],
            seriesHidden: { k1: true, k2: false } as unknown as SeriesHiddenMap,
        });
        expect(text).toContain('k1');
        expect(text).not.toContain('k2');
    });

    it('老 catalog（没有 seriesHidden 键）照常读，缺省 = undefined', () => {
        const back = parseCatalog(JSON.stringify({ version: 1, entries: [] }));
        expect(back.seriesHidden).toBeUndefined();
    });
});

describe('🔴 底部「关闭」按钮已删除（用户点名：逻辑重复）', () => {
    const code = stripTsComments(read('src/views/components/SeriesProps.svelte'));

    it('模板里没有「关闭」按钮，也没有 `.rl-sp-actions` 容器', () => {
        expect(code).not.toContain('rl-sp-actions');
        expect(code).not.toMatch(/on:click=\{onClose\}/);
        expect(code).not.toContain('>关闭<');
    });

    it('`onClose` prop 一并收敛（关窗是宿主 Modal 的职责，组件不该自带）', () => {
        expect(code).not.toMatch(/export let onClose/);
    });

    it('宿主侧也不再往组件传 onClose（传了就是死参数）', () => {
        const modal = stripTsComments(read('src/modals/SeriesPropsModal.ts'));
        expect(modal).not.toMatch(/onClose:\s*\(\)\s*=>\s*this\.close\(\)/);
    });
});

describe('🔴 右上角「隐藏此系列卡片」复选框', () => {
    const code = stripTsComments(read('src/views/components/SeriesProps.svelte'));

    it('复选框在标题行里、文案与单卡一致（「隐藏此系列卡片」）', () => {
        expect(code).toContain('rl-sp-hidecard');
        expect(code).toContain('隐藏此系列卡片');
        // 与标题同一个容器 ⇒ 才叫「右上角」
        expect(code).toMatch(/rl-sp-head[\s\S]{0,400}rl-sp-title[\s\S]{0,400}rl-sp-hidecard/);
        // 复选框本体
        expect(code).toMatch(/type="checkbox"[^>]*bind:checked=\{hiddenCard\}/);
    });

    it('勾选回传宿主（组件不碰 plugin / 不碰磁盘）', () => {
        expect(code).toMatch(/onToggleHidden\(hiddenCard\)/);
        expect(code).not.toContain('service.setSeriesHidden');
        expect(code).not.toContain('plugin.service');
    });

    it('新增 hiddenCard / onToggleHidden 两个 prop', () => {
        expect(code).toMatch(/export let hiddenCard/);
        expect(code).toMatch(/export let onToggleHidden/);
    });
});

describe('🔴 宿主写入纪律：只改系列标记，⛔ 不碰组内条目', () => {
    const modal = stripTsComments(read('src/modals/SeriesPropsModal.ts'));

    it('走 service.setSeriesHidden 那一条出口', () => {
        expect(modal).toContain('service.setSeriesHidden');
    });

    it('⛔ 不许为了隐藏系列去改成员的 cardHidden（用户要「条目不受影响」）', () => {
        // 一旦出现写成员 cardHidden 的代码，就是把这个系列整个打码了
        expect(modal).not.toMatch(/\.cardHidden\s*=/);
        expect(modal).not.toContain('bulkSetCardHidden');
    });

    it('失败要回滚界面（与 doRate 同一条纪律：先刷新再落库，失败退回）', () => {
        // 回滚必须在 catch 里把 curHidden 和组件的 hiddenCard 都改回去
        expect(modal).toMatch(/catch[\s\S]{0,300}curHidden\s*=\s*prev/);
        expect(modal).toMatch(/catch[\s\S]{0,300}hiddenCard:\s*prev/);
    });
});

describe('🔴 列表呈现：模糊化复用既有 is-card-hidden，⛔ 不新造视觉', () => {
    const list = stripTsComments(read('src/views/components/MediaList.svelte'));

    it('系列卡打码判据 = 成员判据 OR 系列级判据（两个独立判据并存）', () => {
        expect(list).toMatch(/gHidden\s*=\s*gch\s*\|\|\s*seriesGroupHidden\(seriesHidden,\s*g\.key\)/);
        // 反向守卫：⛔ 别把两者合并成一个函数（合并后就分不清「成员全勾」与「系列自己标记」）
        expect(list).not.toMatch(/seriesCardHidden\s*\(\s*g\.items\s*\)\s*\|\|\s*seriesGroupHidden/);
    });

    it('打码动作全部沿用既有机制（is-card-hidden 类 + maskCardText）', () => {
        expect(list).toMatch(/class:is-card-hidden=\{gHidden\}/);
        // 5 处文案打码都换成 gHidden
        expect(list).not.toMatch(/maskCardText\(gch,/);
        expect(list).toMatch(/maskCardText\(gHidden,\s*g\.title\)/);
    });

    it('新增 seriesHidden prop 且类型来自 pure/seriesHidden（⛔ 模板里内联 map[key]===true）', () => {
        expect(list).toMatch(/export let seriesHidden: SeriesHiddenMap/);
        expect(list).toContain("from 'pure/seriesHidden'");
        // 模板内联写法的原型链洞：`seriesHidden[g.key] === true` 会被 constructor 骗过
        expect(list).not.toMatch(/seriesHidden\[[^\]]+\]\s*===\s*true/);
    });

    it('模糊样式仍在（复用旧规则，本需求没改 CSS）', () => {
        const css = stripCssComments(list);
        expect(css).toMatch(/\.rl-card\.is-card-hidden \.rl-cov-wrap\s*\{[^}]*blur\(/);
    });
});

describe('🔴 设置页「已隐藏的系列」清单（取消隐藏的唯一入口）', () => {
    const settings = stripTsComments(read('src/Settings.ts'));

    it('清单渲染方法存在且挂在「卡片信息栏」组内', () => {
        expect(settings).toContain('renderSeriesHiddenRows');
        // 必须在 renderCardFieldsRows 体内调用（挂在别的组就找不到了）
        const at = settings.indexOf('private renderCardFieldsRows(');
        const end = settings.indexOf('private ', at + 10);
        expect(at).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(at);
        expect(settings.slice(at, end)).toContain('renderSeriesHiddenRows');
    });

    it('取消隐藏走同一条 service 出口（⛔ 不直接改 catalog）', () => {
        const at = settings.indexOf('private async renderSeriesHiddenRows(');
        const end = settings.indexOf('\n    private ', at + 10);
        expect(at).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(at);
        const body = settings.slice(at, end);
        expect(body).toContain('service.setSeriesHidden');
        expect(body).toContain("setButtonText('取消隐藏')");
        // 反查可读名必须靠 foldSeries（分组真源），⛔ 别自己拼 type+name
        expect(body).toContain('foldSeries');
    });

    it('样式已补（rl-hidden-series 系列类），⛔ 不许裸奔', () => {
        const css = stripCssComments(read('styles.css'));
        for (const cls of ['.rl-hidden-series {', '.rl-hidden-series-list', '.rl-hidden-series-row', '.rl-hidden-series-name']) {
            expect(css).toContain(cls);
        }
    });
});
