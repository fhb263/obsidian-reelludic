// 主视图一级页签真源（pure/homeTabs）—— 守三件「两处不许各写一份」的事：
//   ① **顺序**：顶部胶囊与左侧侧边栏共用同一份（换布局不该换顺序）
//   ② **文案**：页签显示名只有一份（书籍→阅读 是页签专用名，其余场景仍走 ENTRY_TYPE_LABELS）
//   ③ **图标**：写错名字 `setIcon` 会**静默失败**（空白图标、无任何报错）
// 外加「起始页」设置的归一：只认导航里真有的 6 个 id，兜底回到历史缺省 `media`。
import { describe, expect, it } from 'vitest';
import { HOME_TAB_ORDER, homeTabIcon, homeTabLabel, isNavTab, normalizeStartTab } from 'pure/homeTabs';

describe('homeTabs（#541 主视图页签真源）', () => {
    it('🔴 顺序固定：计划 → 阅读 → 影视 → 游戏 → 音乐 → 统计（两种布局共用）', () => {
        expect(HOME_TAB_ORDER).toEqual(['tracking', 'book', 'media', 'game', 'music', 'stats']);
    });

    it('🔴 显示名 = 用户点名的 6 项（书籍→阅读；音乐回归本名，不再是「收听」）', () => {
        expect(HOME_TAB_ORDER.map((t) => homeTabLabel(t))).toEqual(['计划', '阅读', '影视', '游戏', '音乐', '统计']);
        expect(homeTabLabel('music')).toBe('音乐');
    });

    it('非导航类型仍走 ENTRY_TYPE_LABELS（页签专用名不得外溢）', () => {
        expect(homeTabLabel('anime')).toBe('动画');
        expect(homeTabLabel('tv')).toBe('剧集');
        expect(homeTabLabel('movie')).toBe('电影');
    });

    it('每个导航页签都有非空图标名，且 6 枚互不相同', () => {
        const icons = HOME_TAB_ORDER.map((t) => homeTabIcon(t));
        expect(icons.every((i) => i.length > 0)).toBe(true);
        expect(new Set(icons).size).toBe(icons.length);
    });

    it('🔴 起始页归一：只认导航里真有的 id', () => {
        for (const t of HOME_TAB_ORDER) expect(normalizeStartTab(t)).toBe(t);
    });

    it('🔴 起始页兜底 = media（历史缺省）：脏数据 / 非导航 id / 缺省一律回它', () => {
        expect(normalizeStartTab('anime')).toBe('media');
        expect(normalizeStartTab('nope')).toBe('media');
        expect(normalizeStartTab('')).toBe('media');
        expect(normalizeStartTab(undefined)).toBe('media');
        expect(normalizeStartTab(null)).toBe('media');
        expect(normalizeStartTab(3)).toBe('media');
        expect(normalizeStartTab({ tab: 'book' })).toBe('media');
        // ⚠️ 大小写不同即视为脏数据（不做 toLowerCase 容错 —— 那会把 'BOOK' 也放进来）
        expect(normalizeStartTab('Book')).toBe('media');
    });

    it('isNavTab：只有 6 个导航 id 为真', () => {
        expect(isNavTab('stats')).toBe(true);
        expect(isNavTab('anime')).toBe(false);
        expect(isNavTab(undefined)).toBe(false);
        expect(isNavTab('')).toBe(false);
    });
});
