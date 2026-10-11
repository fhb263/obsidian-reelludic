// 合并视图三页面（pure/mergedPages，#550）—— 守「顺序 / 文案 / 图标」三件事，
// 以及一个最容易踩的语义坑：`library` 是**库列表**、不是书架。
import { describe, expect, it } from 'vitest';
import { MERGED_PAGES, mergedPageIcon, mergedPageLabel, type MergedPage } from 'pure/mergedPages';

describe('mergedPages（#550 合并视图的「更多」菜单取值空间）', () => {
    it('三个页面，顺序 = 媒体库 · 追更表 · 统计页（媒体库在最上）', () => {
        expect(MERGED_PAGES).toEqual(['library', 'tracking', 'stats']);
    });

    // 🔴 #567：展示名改成**页名**（追更表 / 统计页）—— 用户第四次点名这条文案。
    //    ⚠️ 别退回「追更 / 统计」：菜单是**去那一页的入口**，用页名才和页面自己对得上。
    it('文案取自本模块（三个词各一份，且用页名）', () => {
        expect(mergedPageLabel('library')).toBe('媒体库');
        expect(mergedPageLabel('tracking')).toBe('追更表');
        expect(mergedPageLabel('stats')).toBe('统计页');
    });

    // 🔴 两枚图标必须与 #547 顶端栏里那两枚**同款** —— 换名字会让「同一个页面」在两版里长得不一样。
    it('图标：追更表 / 统计页沿用 #547 顶端栏那两枚（calendar-check / trending-up）', () => {
        expect(mergedPageIcon('tracking')).toBe('calendar-check');
        expect(mergedPageIcon('stats')).toBe('trending-up');
        // 库列表这枚是本批新定的（与 `pure/homeTabs` 的占位图标同款）
        expect(mergedPageIcon('library')).toBe('layout-grid');
    });

    // 🔴 语义守：合并视图里书架拆成了 文学 / 网文 / 漫画（见 pure/mergedScope）⇒
    //    `library` 只能是「库列表」。写成「阅读 / 书架」会让菜单里出现一个点不到的第四档。
    it('🔴 `library` 是库列表（「媒体库」），⛔ 不是「阅读 / 书架」', () => {
        expect(mergedPageLabel('library')).toBe('媒体库');
        expect(mergedPageLabel('library')).not.toBe('阅读');
    });

    it('未登记的 id 回落到 library 那一份（防御脏数据穿透到菜单）', () => {
        expect(mergedPageLabel('nope' as MergedPage)).toBe('媒体库');
        expect(mergedPageIcon('nope' as MergedPage)).toBe('layout-grid');
    });
});
