// 设置页导航真源（pure/settingNav）—— 这里守的是「改版后最容易静默出错」的四件事：
//   ① 图标名写错：Obsidian 的 setIcon() 遇到不存在的名字**静默失败**（safeSetIcon 把异常吞掉）
//      ⇒ 界面上是一个**空白图标、没有任何报错**（tests/searchIcons.test.ts 里已记录同一个坑）
//   ② 标签被顺手改动：全仓有多处路径文案在引用「数据源配置 / AI集成」这两个名字
//      （改标签不同步文案 ⇒ 提示会指向一个不存在的入口）
//   ③ id 撞车 / 漏页：页的数量与顺序是导航契约
//   ④ **#354**：4 页**全部**是平级 Tab（「关于」已从 #353 的"附属页 + 右上角小图标"回归 Tab 栏），
//      且**默认页必须取第一项** —— 否则一打开设置页就落在第二页，用户会以为第一个入口点了没反应。
import { describe, expect, it } from 'vitest';
import {
    SETTING_NAV_PAGES,
    SETTING_NAV_TABS,
    SETTING_NAV_DEFAULT,
    SETTING_GROUP_ICONS,
    groupIcon,
    nextTabId,
    tabStates,
} from 'pure/settingNav';

/**
 * 对 `D:\Obsidian\resources\obsidian.asar`（本机 Obsidian 1.13.7）**实测确定存在**的图标名。
 * ⚠️ 探针判据是产物里的 `"name":[[` 形态（`_probe_icons.cjs`）；这份表是**正向白名单** ——
 *    只有「确定存在」才准进，实测 MISS 的（如 `palette` / `database` / `sparkles`）**不得**凭推测加入。
 */
const ASAR_VERIFIED_ICONS = [
    'hard-drive', 'flask-conical', 'sliders-horizontal', 'circuit-board', 'share-2', 'sun-moon',
    'panel-left', 'columns-2', 'layout-grid', 'toggle-right', 'key-round', 'volume-2', 'audio-lines',
    'wand-2', 'list-tree', 'plug-zap', 'folder-tree', 'folder-open', 'file-text', 'scroll-text',
    'book-marked', 'library-big', 'book-open', 'book-copy', 'gamepad-2', 'disc-3', 'trash-2',
    'badge-info', 'circle-help', 'life-buoy', 'chevron-down', 'chevron-right',
];

describe('settingNav（#354 设置页导航真源：4 个平级 Tab）', () => {
    it('4 个页、id 唯一、顺序固定', () => {
        expect(SETTING_NAV_PAGES.map((p) => p.id)).toEqual(['basic', 'sources', 'ai', 'about']);
        expect(new Set(SETTING_NAV_PAGES.map((p) => p.id)).size).toBe(SETTING_NAV_PAGES.length);
    });

    it('🔴 标签 = 用户点名的 4 项（含两处改名：数据管理→基本设置、数据源管理→数据源配置）', () => {
        expect(SETTING_NAV_PAGES.map((p) => p.label)).toEqual([
            '基本设置', '数据源配置', 'AI集成', '关于',
        ]);
    });

    it('🔴 每个导航图标都在 asar 实测白名单内（不在 → setIcon 静默失败 → 空白图标）', () => {
        const bad = SETTING_NAV_PAGES.filter((p) => !ASAR_VERIFIED_ICONS.includes(p.icon));
        expect(bad.map((p) => `${p.id}:${p.icon}`)).toEqual([]);
    });

    it('🔴 子分组图标同样受白名单约束（含「基本设置」页本轮新增的 4 组）', () => {
        const bad = Object.entries(SETTING_GROUP_ICONS).filter(([, icon]) => !ASAR_VERIFIED_ICONS.includes(icon));
        expect(bad.map(([t, icon]) => `${t}:${icon}`)).toEqual([]);
    });

    it('groupIcon：登记过的返回图标名，未登记返回 null（不抛错，只是缺个图标）', () => {
        expect(groupIcon('数据源启用')).toBe('toggle-right');
        expect(groupIcon('数据源凭据')).toBe('key-round');
        // 🔴 #356：「语音合成」组已撤销（两行分别搬进 AI服务 / API凭据）⇒ 该 key 必须整体退场，
        //    ⛔ 留着就是一条永远不会命中的死配置
        expect(groupIcon('语音合成')).toBeNull();
        // #354 新增的 4 组
        expect(groupIcon('外观与体验')).toBe('sliders-horizontal');
        expect(groupIcon('实验性功能')).toBe('flask-conical');
        expect(groupIcon('数据与备份')).toBe('hard-drive');
        expect(groupIcon('封面与清理')).toBe('trash-2');
        expect(groupIcon('这个词不存在')).toBeNull();
    });

    it('🔴 #354：Tab 栏就是全部 4 页 —— 「关于」回归为**平级 Tab**（推翻 #353 的外挂形态）', () => {
        expect(SETTING_NAV_TABS.map((p) => p.id)).toEqual(['basic', 'sources', 'ai', 'about']);
        expect(SETTING_NAV_TABS.some((p) => p.id === 'about')).toBe(true);
        // 回归 Tab 之后，关于那页的图标是 badge-info（原外挂按钮用的就是它）
        expect(SETTING_NAV_TABS.find((p) => p.id === 'about')?.icon).toBe('badge-info');
    });

    it('🔴 #354：页集合 = Tab 栏（不再有「TABS + 附属页」两份常量）', () => {
        expect(SETTING_NAV_PAGES).toEqual([...SETTING_NAV_TABS]);
        expect(SETTING_NAV_PAGES).toHaveLength(4);
    });

    it('🔴 默认页 = 第一项 basic（否则一打开设置页就落在第二页）', () => {
        expect(SETTING_NAV_DEFAULT).toBe(SETTING_NAV_TABS[0].id);
    });

    it('默认页是合法 id（否则打开设置页会一片空白）', () => {
        expect(SETTING_NAV_PAGES.map((p) => p.id)).toContain(SETTING_NAV_DEFAULT);
    });

    it('方向键在 Tab 间循环移动（WAI-ARIA Tabs 模式）', () => {
        expect(nextTabId('basic', 1)).toBe('sources');
        expect(nextTabId('sources', -1)).toBe('basic');
        expect(nextTabId('about', 1)).toBe('basic'); // 末项 → 首项（回绕）
        expect(nextTabId('basic', -1)).toBe('about');
    });

    it('🔴 current 不在 Tab 内（损坏数据 / 旧版本残留）→ 回到第一项，⛔ 不返回 undefined', () => {
        expect(nextTabId('appearance', 1)).toBe('basic'); // #354 删掉的旧 id
        expect(nextTabId('data', -1)).toBe('basic');
        expect(nextTabId('', 1)).toBe('basic');
    });

    it('tabStates —— 当前 Tab 选中且进 Tab 键序列，其余一律 -1', () => {
        expect(tabStates('sources')).toEqual([
            { id: 'basic', selected: false, tabindex: '-1' },
            { id: 'sources', selected: true, tabindex: '0' },
            { id: 'ai', selected: false, tabindex: '-1' },
            { id: 'about', selected: false, tabindex: '-1' },
        ]);
    });

    it('🔴 4 页全在栏内 ⇒ 任意合法 id 都**有且只有一个** tabindex="0"', () => {
        for (const p of SETTING_NAV_PAGES) {
            const st = tabStates(p.id);
            expect(st.filter((s) => s.tabindex === '0').map((s) => s.id)).toEqual([p.id]);
            expect(st.filter((s) => s.selected).map((s) => s.id)).toEqual([p.id]);
        }
    });

    it('🔴 兜底：activeId 不在栏内 → 无任何选中，但第一项必须回到 Tab 键序列（否则键盘进不了栏）', () => {
        const st = tabStates('nope');
        expect(st).toHaveLength(4);
        expect(st.every((s) => !s.selected)).toBe(true);
        expect(st.filter((s) => s.tabindex === '0').map((s) => s.id)).toEqual(['basic']);
    });

    it('🔴 模块**不得再导出**附属页常量（「关于」已回归 Tab ⇒ 那套「外挂页」概念整体退场）', async () => {
        // ⚠️ 这条只能在这里守：那个常量一旦没人用，esbuild 的 tree-shaking 会把它从 main.js 里**摇掉**
        //    ⇒ 产物断言（`!/SETTING_NAV_AUX = \{/.test(js)`）会**假绿**（本轮突变 M356-h 首版实证）。
        const mod = (await import('pure/settingNav')) as Record<string, unknown>;
        expect(Object.keys(mod)).not.toContain('SETTING_NAV_AUX');
    });
});
