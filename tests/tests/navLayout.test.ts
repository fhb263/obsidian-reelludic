// 主导航布局（pure/navLayout）—— 守「缺省不变脸」与「脏数据不穿透」两件事。
import { describe, expect, it } from 'vitest';
import { NAV_LAYOUTS, NAV_LAYOUT_LABELS, normalizeNavLayout } from 'pure/navLayout';

describe('navLayout（#541 主导航布局）', () => {
    it('三种布局，且默认项（顶部胶囊）排在最前', () => {
        expect(NAV_LAYOUTS).toEqual(['top', 'sidebar', 'merged']);
        expect(NAV_LAYOUT_LABELS.top).toBe('顶部胶囊');
        // 🔴 这一档的**用户可见名**随形态改过四次（方位词从「左侧」一路改到「右上角」）；
        //    #574 起**去掉方位限定词**—— 三档要并列可读（顶部胶囊 / 文字菜单 / 合并视图），
        //    方位词反而是噪音（真源注释见 `pure/navLayout.ts` 的 `NAV_LAYOUT_LABELS` 上方）。
        //    ⚠️ 这里守的是「文案必须描述**现在**的形态」—— 下拉里写着方位、实际却排在别处，
        //    用户会照着自己的屏幕找不到它。
        expect(NAV_LAYOUT_LABELS.sidebar).toBe('文字菜单');
        // 🔴 #547 第三档：取消分类页签、改由顶端筛选栏导航（名字是用户给的）
        expect(NAV_LAYOUT_LABELS.merged).toBe('合并视图');
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
});
