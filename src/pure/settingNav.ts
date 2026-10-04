/**
 * 设置页导航真源（#352 建立 / #353 横向 Tab / **#354 合并为 4 个平级 Tab**）：
 * 4 个 Tab 的 id / 标签 / 图标。
 *
 * 🔴 **为什么单独抽一个纯模块**：设置页从「一条垂直长列表」改成**横向 Tab**后，
 *    原来的 6 个一级标题（`setHeading()`）升格成了**导航项** —— 标签与图标从「一次性渲染」变成了
 *    **跨形态契约**（Tab 栏 / 内容区页体 / 无障碍 `aria-*` 用的是同一份数据）。
 *
 * 🔴 #354 的结构（用户给定顺序，**4 项平级**）：
 *      1. `基本设置`（`basic`）—— 原「数据管理」+ 原「外观」+ 原「实验性功能」合并（8 行 / 4 组）
 *      2. `数据源配置`（`sources`）—— 原「数据源管理」仅改名
 *      3. `AI集成`（`ai`）—— 不变
 *      4. `关于`（`about`）—— **回归 Tab 栏**（#353 曾把它外挂到右上角小图标）
 *    ⇒ #353 那份「附属页」常量（`SETTING_NAV_AUX`）**整体删除**：4 页全在栏里，
 *      也就不再有「Tab 栏无选中项」那个特例状态了（那是本设计唯一的例外，现已消失）。
 *
 * ⚠️ **id 全部沿用**（只新增 `basic`、删掉 `appearance` / `experimental` / `data` 三个 id）：
 *    路径文案与断言都按 id/标签走，id 不变能少动很多地方。
 *
 * 🔴 **图标名尤其危险**：`setIcon()` 遇到不存在的名字会**静默失败**（各 modal 的 `safeSetIcon` 把异常吞掉）
 *    ⇒ 界面上是一个**空白图标且没有任何报错**，只有单测能兜住（见 `tests/settingNav.test.ts` 的白名单，
 *    那份白名单是对 `D:\Obsidian\resources\obsidian.asar` **实测**出来的）。
 *    ⚠️ 实测 MISS 的名字（如 `ellipsis` / `info`）**不得**凭直觉使用 —— 「更多」类图标要用 `more-horizontal`。
 *    ⛔ 换任何一个图标名之前**先实测**。
 */

/** 设置页的一个「页」（= 一个平级 Tab） */
export interface SettingNavPage {
    /** 稳定 id（同时作为 DOM 类名后缀，勿改） */
    id: string;
    /** 导航项文字 */
    label: string;
    /** 图标名（Obsidian 内置 lucide 名，须在实测白名单内） */
    icon: string;
}

/**
 * Tab 栏的 4 项，顺序 = 用户给定顺序（勿动）。
 *
 * ⚠️ **标签是用户点名的名字**：「数据管理 → 基本设置」「数据源管理 → 数据源配置」都是本轮改名；
 *    全仓路径文案（形如「设置 → 数据源配置 › 数据源凭据」）与本表的标签**必须同步**
 *    —— 改标签就要同步改那些处方文案（`pure/sourceRegistry` 等处），否则提示会指向一个不存在的入口。
 */
export const SETTING_NAV_TABS: readonly SettingNavPage[] = [
    { id: 'basic', label: '基本设置', icon: 'sliders-horizontal' },
    // #422 改名：原「数据源配置」。用户原话「数据源配置、凭据改成元数据源配置、凭据」——
    // 本页里只有**前两组**是元数据源（后面还有音乐源凭据 / 书籍源凭据），统称「数据源」会把
    // 「音乐、书籍也是数据源吗」这件事一直含混。
    { id: 'sources', label: '元数据源配置', icon: 'folder-tree' },
    { id: 'ai', label: 'AI集成', icon: 'wand-2' },
    { id: 'about', label: '关于', icon: 'badge-info' },
];

/**
 * 全部页 = Tab 栏那 4 项（内容区按这个顺序建页体并决定渲染次序）。
 * ⚠️ 这是 `SETTING_NAV_TABS` 的**派生值**（不是第二份手写数据），两边永远一致。
 * ⚠️ #354 起**它不再等于「TABS + 附属页」** —— 附属页这个概念已随「关于」回归 Tab 而消失。
 */
export const SETTING_NAV_PAGES: readonly SettingNavPage[] = [...SETTING_NAV_TABS];

/**
 * 打开设置页时默认落在哪一页：**第一项**（`basic`）。
 * 🔴 必须是 Tab 里的 id，且**取第一项** —— 否则一打开设置页就落在第二页，
 *    用户会以为「第一个入口点了没反应」。单测钉死这两点。
 */
export const SETTING_NAV_DEFAULT = 'basic';

/**
 * 方向键在 Tab 之间移动（**WAI-ARIA Tabs 模式**：`←/→` 切页，首尾**循环**）。
 *
 * 🔴 为什么抽成纯函数：方向键是「声明了 `role="tablist"` 就必须给出」的键盘可达性契约，
 *    而它在 DOM 里只能靠派发事件验证（脆、且盖不住回绕这类边界）⇒ 把**取下一项**的规则单独拎出来，
 *    用单测钉住「顺序、回绕、以及 current 落在 Tab 之外时的兜底」。
 * ⚠️ 兜底那一支**仍然保留**（#354 起不再有"附属页"这个正常来源，但 `activePage` 是**实例字段**、
 *    可能来自旧版本残留或损坏数据）：命中不到就回**第一项**，
 *    ⛔ 不能返回 `undefined`（会让后续 `setActivePage(undefined)` 把整页搞成空白）。
 */
export function nextTabId(current: string, dir: 1 | -1): string {
    const n = SETTING_NAV_TABS.length;
    const i = SETTING_NAV_TABS.findIndex((p) => p.id === current);
    if (i < 0) return SETTING_NAV_TABS[0].id;
    return SETTING_NAV_TABS[(i + dir + n) % n].id;
}

/** 一个 Tab 的无障碍状态（视觉态由 CSS 类承担，这里只出 `aria-*` 要的值） */
export interface SettingTabState {
    id: string;
    /** 是否当前页 → `aria-selected` */
    selected: boolean;
    /** roving tabindex：`'0'` = 进 Tab 键序列，`'-1'` = 跳过 */
    tabindex: string;
}

/**
 * Tab 栏的无障碍状态（**roving tabindex** + `aria-selected`）。
 *
 * 🔴 为什么抽成纯函数：这段规则里有一条**只在特例下才走到**的分支，靠 DOM 断言根本盖不住 ——
 *    `activeId` 不是任何一个 Tab 的 id 时（旧数据残留 / 损坏），若一律给 `tabindex="-1"`，
 *    **键盘就再也进不了 Tab 栏**（整条导航对键盘用户消失）。
 *    故此时把**第一项**放回 Tab 键序列兜底。这条规则用单测钉住，比派发键盘事件稳得多。
 * ⚠️ #354 起 4 页全在栏内 ⇒ 正常路径下「有且只有一个 `tabindex="0"`」，兜底支只在异常输入时生效。
 */
export function tabStates(activeId: string): SettingTabState[] {
    const hasActive = SETTING_NAV_TABS.some((p) => p.id === activeId);
    return SETTING_NAV_TABS.map((p, i) => {
        const selected = p.id === activeId;
        const focusable = selected || (!hasActive && i === 0);
        return { id: p.id, selected, tabindex: focusable ? '0' : '-1' };
    });
}

/**
 * 子分组标题 → 图标（按标题文字取；取不到就**不挂图标**，不抛错）。
 *
 * ⚠️ 子分组标题是渲染时现传的字符串（不是一个枚举），所以这里用文字做 key。
 *    新增子分组忘了登记 ⇒ 只是缺个图标，不会出别的错。
 * ⚠️ 「基本设置」页那 4 组是 #354 新增（合并三页后的分组）：
 *    外观与体验 / 实验性功能 / 数据与备份 / 封面与清理。
 * ⚠️ **#356 起 `语音合成` 这条已删除**：该组两行按用户指令分别搬进了「AI服务」（朗读音源）与
 *    「API凭据」（硅基流动 Key），组本身撤销 ⇒ 留着就是一条永远不会命中的死配置。
 * 🔴 **#483**（用户：「重构 AI 集成 UI，参考市面上 AI 软件 / 中转站怎么做接入多 AI」）：AI 页两组
 *    **改名 + 换序** —— `AI服务` → **`用途`**（图标 `target`）、`API凭据` → **`模型服务`**（图标 `server`），
 *    且「模型服务」在上（接入顺序 = 先连服务商 → 再选它用在哪，与 Cherry Studio 一致）。
 *    ⛔ 旧键**一律不留**（组名已改，留着只会变成永不命中的死配置 —— 与下面 #422 同一条口径）。
 *    两个新图标名已用 `_probe_lucide.cjs` 在 asar 白名单内核实。
 * ⚠️ **#422**：「数据源启用 / 数据源凭据」两键改名加「元」；「网文书源」→「书籍源凭据」并**首次挂图标**。
 *    旧键**一律不留**（组名已改，留着只会变成永不命中的死配置）。
 * 🔴 **音乐源凭据**图标从 `key-round` 换成 `audio-lines`：改版前它跟「元数据源凭据 / API凭据」
 *    共用同一枚钥匙图标，三组挨着排下来**分不出哪个是哪个**（用户 2026-09-29：「把音乐源凭据图标改一下」）。
 *    ⛔ 换名之前**先实测**是否在 asar 白名单内（`setIcon` 遇未知名会静默失败）。
 * ⚠️ `网络文学源` / `经典文学源` 是**折叠小节**（渲染在 `.rl-key-row` 里，不走 `createGroupSection`）
 *    ⇒ 这里**不登记**（登记了也没人查）。
 */
export const SETTING_GROUP_ICONS: Readonly<Record<string, string>> = {
    元数据源启用: 'toggle-right',
    元数据源凭据: 'key-round',
    音乐源凭据: 'audio-lines',
    书籍源凭据: 'book-marked',
    模型服务: 'server',
    用途: 'target',
    外观与体验: 'sliders-horizontal',
    实验性功能: 'flask-conical',
    数据与备份: 'hard-drive',
    封面与清理: 'trash-2',
};

/** 取子分组图标；未登记则返回 null（调用方跳过挂图标） */
export function groupIcon(title: string): string | null {
    return SETTING_GROUP_ICONS[title] ?? null;
}
