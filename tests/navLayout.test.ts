// 主导航布局（pure/navLayout）—— 守「缺省不变脸」与「脏数据不穿透」两件事。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV_LAYOUTS, NAV_LAYOUT_LABELS, normalizeNavLayout } from 'pure/navLayout';

const ROOT = resolve(__dirname, '..');

describe('navLayout（#541 主导航布局）', () => {
    it('三种布局，且默认项（横向页签）排在最前', () => {
        expect(NAV_LAYOUTS).toEqual(['top', 'sidebar', 'merged']);
        expect(NAV_LAYOUT_LABELS.top).toBe('横向页签');
        // 🔴 这几档的**用户可见名**随形态改过五次（方位词从「左侧」一路改到「右上角」，
        //    #574 起去掉方位限定词，2026-11-15 m07364 改成按形态命名）——
        //    三档要并列可读（横向页签 / 纵向页签 / 聚合下拉），方位词是噪音；
        //    「横向 / 纵向」说的是**页签自身的排列方向**，不是贴在屏幕哪一边。
        //    ⚠️ 这里守的是「文案必须描述**现在**的形态」—— 下拉里写着方位、实际却排在别处，
        //    用户会照着自己的屏幕找不到它。
        expect(NAV_LAYOUT_LABELS.sidebar).toBe('纵向页签');
        // 🔴 #547 第三档：取消分类页签、改由顶端筛选栏导航；m07364 起对外文案叫「聚合下拉」
        expect(NAV_LAYOUT_LABELS.merged).toBe('聚合下拉');
    });

    it('归一：三种合法值都认，其余（含脏数据）一律 top —— ⛔ 缺省不得回退成新形态', () => {
        expect(normalizeNavLayout('sidebar')).toBe('sidebar');
        expect(normalizeNavLayout('merged')).toBe('merged');
        expect(normalizeNavLayout('top')).toBe('top');
        expect(normalizeNavLayout(undefined)).toBe('top');
        expect(normalizeNavLayout(null)).toBe('top');
        expect(normalizeNavLayout('')).toBe('top');
        expect(normalizeNavLayout('SIDEBAR')).toBe('top');
        expect(normalizeNavLayout('MERGED')).toBe('top');
        expect(normalizeNavLayout(1)).toBe('top');
        expect(normalizeNavLayout({ layout: 'sidebar' })).toBe('top');
    });

    // 🔴 #545：id 是**存量数据里的值**（旧 data.json 存过 `'sidebar'`）⇒ 改名只动文案。
    //    这条守「⛔ 别把 id 一起改成 'text-menu' 之类」—— 那会让老用户升级后静默回落到顶部胶囊。
    it("#545：id 保持 'sidebar'（只改文案、⛔ 不改 id —— 存量数据里存过它）", () => {
        expect(NAV_LAYOUTS).toContain('sidebar');
    });

    // 🔴 #543：`normalizeNavCollapsed` 已随「折叠态」一起退场（侧边栏 = 恒定图标轨，没有可折叠的态）。
    //    这条守住的是「⛔ 别为了兼容把它加回来」—— 它已经没有读取方，留着就是死码。
    it('🔴 #543：不得再导出 `normalizeNavCollapsed`（折叠态已整体退场）', async () => {
        const mod = (await import('pure/navLayout')) as Record<string, unknown>;
        expect(Object.keys(mod)).not.toContain('normalizeNavCollapsed');
    });

    /**
     * 🔴 2026-11-14 用户 m05673（手机实测）：「默认导航布局应该为合并视图以适应手机端竖屏显示」。
     *
     * 这一档的新装播种必须与 `normalizeNavLayout` 的脏值兜底**分开**：
     *   · `normalizeNavLayout(undefined) === 'top'`（老用户 / 脏值，⛔ 不能变）；
     *   · `defaultNavLayoutFor(true) === 'merged'`（手机新装）。
     * 混成一件事就是二选一：要么手机不生效，要么全体老用户升级即换脸。
     */
    describe('🔴 2026-11-14 m05673 · 手机端新装默认合并视图', () => {
        it('手机 / 平板 → merged；桌面 → top', async () => {
            const { defaultNavLayoutFor } = await import('pure/navLayout');
            expect(defaultNavLayoutFor(true)).toBe('merged');
            expect(defaultNavLayoutFor(false)).toBe('top');
        });

        it('⛔ 别把播种塞进 normalizeNavLayout（那会让老用户升级即换脸）', () => {
            // 存量无值 / 脏值仍然必须回 'top' —— 与 defaultNavLayoutFor(true) 的 merged **不同**，
            // 这两条同时成立才说明「播种」和「兜底」是两件事。
            expect(normalizeNavLayout(undefined)).toBe('top');
            expect(normalizeNavLayout(undefined)).not.toBe('merged');
        });

        it('播种只认「磁盘上从未写过 navLayout」，写过的一律尊重用户选择', () => {
            const src = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');
            const at = src.indexOf('Object.assign({}, DEFAULT_SETTINGS, rawSettings)');
            expect(at).toBeGreaterThan(-1);
            const body = src.slice(at, at + 1200);
            // 判据必须是「字段存在性」，⛔ 不是 `if (!navLayout)`（那样用户选了 top 也会被改成 merged）
            expect(body).toMatch(/'navLayout' in rawSettings/);
            expect(body).toMatch(/defaultNavLayoutFor\(Platform\.isMobileApp\)/);
            expect(body).not.toMatch(/normalizeNavLayout\(/);
        });
    });
});
