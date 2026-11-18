/**
 * 全局 UI 组件基座 —— **建控件只走这里**。
 *
 * 为什么要有这个文件（用户 m00353 ①-9 与 ③-5 是同一句话的两半）：
 *  · ①-9：「部分按钮 hover 双提示重叠覆盖」—— 根因不是某一颗按钮写错，而是**没有统一入口**：
 *    每处图标按钮都自己 `createEl('button')` + 自己决定挂 `aria-label` 还是 `data-tip`，
 *    于是有人两个都挂（叠两层气泡），有人一个都不挂（hover 无声）。全仓唯一那份工厂
 *    `iconButton` 还藏在 `src/views/audioPlayerMount.ts` 里、**没有导出**，等于只有音频播放器在用。
 *  · ③-5：「高级设置页视觉东拼西凑」—— 同上，同类控件在不同页面各手搓一遍。
 *    实测证据（2026-11-12）：`卡片信息栏` 与 `条目属性` 两组的分段 chips 条是**逐字复制**的两份
 *    （`rl-cf-typerow` / `typeBar` / `syncTypeBar` / `typeBtns` 全重复，只差 panel 类名与取 key 的函数）。
 * ⇒ 先把**提示与读屏**、以及**几处真正重复的结构**收到这里（本文件）。
 *
 * 🔴 铁律（本仓已多次踩坑，见 `Project-Rule/UI-GUIDE` §3）：
 *    同一个元素上 `data-tip`（插件自绘气泡，`services/globalTooltip.ts`）与
 *    `aria-label`（Obsidian 官方气泡）**只能存在一个**，两者并存 ⇒ 悬停叠出两层。
 *    本文件统一保 `data-tip`；读屏名一律走 `srLabel()` 的隐藏文本 `.rl-sr`。
 *    ⛔ 也⛔ 不要再用 `title`（浏览器原生黄条会成第三个气泡，#465 已明令禁止）。
 *
 * 🔴 颜色与尺寸（③-5 用户原话「绝对禁用写死的颜色和像素」）：
 *    本文件**不写任何 hex / rgb / px**。颜色一律 `var(--text-*)` / `var(--background-*)` /
 *    `var(--interactive-accent)` 等 Obsidian 原生变量；尺寸一律 `var(--size-4-*)` / `var(--icon-*)` /
 *    `var(--rl-t-radius-*)` / `em` / `fr`。样式在 `styles.css` 的 `.rl-ui-*` 段，不内联。
 *
 * 🔴 原生 API（③-5 用户原话「强制使用原生 API，不要手搓 input / select」）：
 *    能用 Obsidian `Setting` 的一律用 `Setting`（`addText` / `addToggle` / `addDropdown` / `addButton`）；
 *    本文件只在 `Setting` 表达不了的地方（分段 chips、状态表格、类型图标行）建控件，
 *    且建出来的东西在语义上就是原生控件（真 `<button>` / 真 `<table>`），⛔ 不用 `<div role=button>` 冒充。
 *
 * 用法：
 * ```ts
 * const btn = iconButton('rl-epp-cuetool', 'repeat', '单句循环');
 * // 状态会变的按钮：改文案走 setTip(btn, '关闭循环')，不要去碰 aria-label
 * ```
 */
import { safeSetIcon } from 'services/safeIcon';

/* ────────────────────────────── ① 提示 / 读屏（①-9 沉淀） ────────────────────────────── */

/**
 * 给纯图标按钮写读屏名：隐藏文本 `.rl-sr`（UI-GUIDE §3 口径）。
 *
 * 🔴 **⛔ 不写 `aria-label`** —— 那是宿主官方气泡的触发条件，会与 `data-tip` 叠两层。
 * 🔴 会先清掉同级的旧 `.rl-sr`：这些按钮被 `sync*` 反复回填，不清理就会越堆越多个读屏名。
 *
 * ⚠️ 2026-11-12 起从 `src/views/EpisodePageView.ts` 的模块私有函数搬到这里
 *    （原注释完整保留在下），搬的原因就是「别处想复用却拿不到，只能手写 `aria-label`」。
 */
export function srLabel(el: HTMLElement, text: string): void {
    el.querySelectorAll(':scope > .rl-sr').forEach((old) => old.remove());
    el.createSpan({ cls: 'rl-sr', text });
}

/**
 * 设置悬停提示（只写 `data-tip`，并顺手抹掉可能残留的 `aria-label` / `title`）。
 *
 * ⚠️ 为什么顺手抹：状态会变的按钮（跟随/锁定、循环档位、展开/收起）在 `sync*` 里反复改文案，
 *    只要有一处曾经用 `aria-label` 写过，后来改 `data-tip` 时旧的那个**不会自己消失** ——
 *    于是运行一段时间后突然开始叠两层气泡，而且只在「进过那个状态」之后才复现，极难查。
 *    ⇒ 让「设提示」这个动作本身保证不变量，而不是指望每个调用点都记得清。
 */
export function setTip(el: HTMLElement, text: string): void {
    el.setAttribute('data-tip', text);
    if (el.hasAttribute('aria-label')) el.removeAttribute('aria-label');
    if (el.hasAttribute('title')) el.removeAttribute('title');
}

/**
 * 建一个图标按钮（提示 + 读屏名一次到位）。
 *
 * 口径：
 *  · 真 `<button type="button">` —— 键盘 Enter/Space、焦点环、`disabled` 全部白拿；
 *  · 提示走 `data-tip`（插件自绘、带 500ms 延迟，见 `services/globalTooltip`）；
 *  · 读屏名走 `.rl-sr` 隐藏文本；
 *  · 图标名不认识时 `safeSetIcon` 静默 no-op，不会因为图标表变动把按钮炸掉。
 *
 * ⚠️ 图标名不存在时按钮会是一块空白 —— 加新图标请先用既有用法核对
 *    （本仓实测可用的名字见 `src/pure/homeTabs.ts` 的 `TAB_ICONS`，或 `tests/sourceIcons.test.ts`）。
 */
export function iconButton(cls: string, icon: string, tip: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (cls) btn.className = cls;
    setTip(btn, tip);
    srLabel(btn, tip);
    safeSetIcon(btn, icon);
    return btn;
}

/* ────────────────────────────── ② 带字按钮（**故意不在这里**） ────────────────────────────── */

/**
 * 🔴 本文件**故意不提供**「带字按钮」工厂。
 *
 * ③-5 第一版曾加过 `textButton()` + `.rl-ui-btn`，实测**外部引用数 = 0**，而本仓早已有
 * 唯一基准 `.rl-btn`（`styles.css:5655` 起，含 `.rl-btn-primary` / `.rl-btn-danger`，
 * 全仓 33 处使用、断言脚本锚了 54 处）。留着它等于给后来者第二条路 ——
 * 那正是用户 ③-5 说的「同一手势两处实现、组件规范不统一」。
 * ⇒ 要带字的按钮请直接用 `.rl-btn`，语义变体用 `.rl-btn-primary` / `.rl-btn-danger`。
 * ⛔ 别把 `textButton` 加回来，也别新建第三套带字按钮类。
 */

/* ────────────────────────────── ③ 字段说明行 / 回执槽 ────────────────────────────── */

/**
 * 建「一组设置」的标准头部：一行说明文字 + 一个回执槽。
 *
 * 为什么收：`字段映射` / `笔记属性顺序` / `卡片信息栏` / `条目属性` / `分类视图` 五组
 * 各自手写了一模一样的 `createDiv({ cls: '…-help' })` + `createDiv({ cls: '…-feedback' })`，
 * 类名还各起一套（`rl-fieldmap-help` / `rl-fo-help` / …）⇒ 改一处样式要改五遍。
 *
 * 回执槽口径（沿用 #640 那次修的经验）：
 *  · 空态**不占高度**（CSS 用 `:empty` 收掉），否则每组顶端会莫名多出一条空白；
 *  · ⛔ 不用 `Notice` 做组内回执 —— Notice 跑到右上角，用户根本不会把两件事联系起来。
 *
 * `opts.helpCls` / `opts.feedbackCls`（③-5 迁移用）：允许把**既有语义类**追加到新容器上。
 * 为什么需要：`字段映射` 那组的说明行还承担「未配置状态折进同一行」（`display:flex`）与
 * 「有错时整块变红告警」（`is-bad` + `role="alert"`）这两件**只有它需要**的事。
 * 硬把它改成纯 `.rl-ui-help` 会两项一起丢。⇒ 通用排版归 `.rl-ui-help`（唯一真源），
 * 特殊行为留在它自己的类里，而不是把整套声明复制一份。
 */
export function groupHeader(
    parent: HTMLElement,
    helpText: string,
    opts: { helpCls?: string; feedbackCls?: string } = {},
): { help: HTMLDivElement; feedback: HTMLDivElement } {
    const help = parent.createDiv({
        cls: opts.helpCls ? `rl-ui-help ${opts.helpCls}` : 'rl-ui-help',
        text: helpText,
    });
    const feedback = parent.createDiv({
        cls: opts.feedbackCls ? `rl-ui-feedback ${opts.feedbackCls}` : 'rl-ui-feedback',
    });
    return { help, feedback };
}

/**
 * 往回执槽里写一条回执（成功 / 失败 / 中性）。
 *
 * `tone` 同样只表语义，颜色交给 CSS 从 `--color-green` / `--color-red` 取。
 * ⚠️ 每次调用**先清空**再写 —— 回执槽会被反复复用（每敲一次回车就刷一次），
 *    不清就会堆成一列历史消息，用户看不出哪条是**这次**的结果。
 */
export function setFeedback(
    slot: HTMLElement,
    text: string,
    tone: 'ok' | 'warn' | 'neutral' = 'neutral',
): void {
    slot.empty();
    if (!text) return;
    slot.createSpan({ cls: `rl-ui-fb is-${tone}`, text });
}

/* ────────────────────────────── ④ 分段 chips（现在有两处在复制它） ────────────────────────────── */

export interface ChipItem {
    /** 稳定键（决定选中态；⛔ 不要用显示文字当键 —— 改名就丢状态） */
    key: string;
    /** 显示文字 */
    label: string;
}

export interface ChipBarHandle {
    /** 外层容器（要挂到 body 上的就是它） */
    el: HTMLDivElement;
    /** 按当前选中键同步高亮 + `aria-selected`（⛔ 别在调用点另写一份） */
    sync: () => void;
    /** 当前选中键 */
    current: () => string;
}

/**
 * 建一条**分段 chips**（平级枚举一眼看全、一点即切）。
 *
 * 为什么要收：`卡片信息栏`（`renderCardFieldsRows`）与 `条目属性`（`renderEntryFormRows`）
 * 两组的分段条是**逐字复制**的两份 —— 连 `syncTypeBar()` 的闭包体都一模一样，
 * 只差 panel 的类名与「取当前 key 的函数」。用户 ③-5 说的「东拼西凑」就是这个：
 * 同一手势两处实现，改一处忘一处。
 *
 * 口径：
 *  · 容器 `role="tablist"`，每颗 `role="tab"` + `aria-selected` —— 读屏能念出「第几个、选中没选中」；
 *  · 选中态只切 `is-on` 类，颜色由 CSS 从 `--interactive-accent` 取；
 *  · 点已选中的那格**不重画**（`if (next === cur) return`）—— 重画会把面板里的滚动位置与展开态冲掉；
 *  · 建完**立刻 sync 一次**（#659 的教训：只在点击时 sync ⇒ 首屏一颗都不高亮，用户以为坏了）。
 */
export function chipBar(opts: {
    parent: HTMLElement;
    /** 条上方的小标题（如「条目类型」）；不传则不建 */
    caption?: string;
    /**
     * tablist 的读屏名（**不可见**）。
     *
     * 为什么单独一个字段：`caption` 是**看得见**的标题，而有些分段条不需要可见标题
     * （如「编辑 / 对比预览」，两个按钮的字面已经说明一切）却仍需要读屏名 ——
     * 靠 `caption` 兼职就会在界面上凭空多出一行字（那是改界面，不是重构）。
     * 优先级：`caption` > `ariaLabel` > 空。
     */
    ariaLabel?: string;
    items: readonly ChipItem[];
    /** 当前选中键（每次 sync 时**现取**，⛔ 不要在闭包里缓存） */
    getKey: () => string;
    /** 点了另一格之后做什么（通常 = 存 key + 重画面板） */
    onPick: (key: string) => void;
    /** 容器类名（两组各自的 panel 外观不同，但条本身走同一个类） */
    cls?: string;
}): ChipBarHandle {
    const row = opts.parent.createDiv({ cls: 'rl-ui-chiprow' });
    if (opts.caption) row.createDiv({ cls: 'rl-ui-chipcap', text: opts.caption });
    const bar = row.createDiv({
        cls: opts.cls ? `rl-ui-chipbar ${opts.cls}` : 'rl-ui-chipbar',
        attr: { role: 'tablist', 'aria-label': opts.caption ?? opts.ariaLabel ?? '' },
    });

    const btns = new Map<string, HTMLButtonElement>();
    const sync = (): void => {
        const cur = opts.getKey();
        for (const [k, b] of btns) {
            const on = k === cur;
            b.toggleClass('is-on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        }
    };

    for (const item of opts.items) {
        const btn = bar.createEl('button', {
            cls: 'rl-ui-chip',
            text: item.label,
            attr: { type: 'button', role: 'tab', 'aria-selected': 'false' },
        });
        btns.set(item.key, btn);
        btn.addEventListener('click', () => {
            // ⚠️ 点已选中的那格：⛔ 不重画（会冲掉面板里的滚动位置与展开态）
            if (opts.getKey() === item.key) return;
            opts.onPick(item.key);
            sync();
        });
    }

    sync();

    return { el: row, sync, current: opts.getKey };
}

/* ────────────────────────────── ⑤ 状态表格（③-1 面板复用） ────────────────────────────── */

export interface StatusTableColumn {
    /** 表头文字（逐字，不裁剪） */
    label: string;
    /** 列宽（CSS grid 的 `fr` / `auto`，⛔ 不写 px） */
    width?: string;
    /** 文本对齐；默认左对齐 */
    align?: 'start' | 'center' | 'end';
}

export interface StatusTableHandle {
    /** 表格外层（含表头 + 行区） */
    el: HTMLDivElement;
    /** 行区容器（往里 append 行） */
    body: HTMLDivElement;
    /** 按列宽建一行（返回行元素，调用点往里塞 cell） */
    row: (opts?: { head?: boolean; cls?: string }) => HTMLDivElement;
}

/**
 * 建一张**语义化状态表**：表头 + 可滚动行区。
 *
 * ⚠️ 为什么不是真 `<table>`：③-1 的凭据面板每行右侧有「一键检测」这种按钮，
 *    表格单元格里塞按钮在窄屏（<420px）折叠时会挤成一团；用 `grid` + `role="table"`
 *    能让每行在窄屏改排成两列（姓名占满、其余换行），而真 table 做不到。
 *    ⛔ 但 `role` 必须齐（`table` / `row` / `columnheader` / `cell`），否则读屏读到一堆 div。
 *
 * 列宽真源只在这里（`grid-template-columns`），⛔ 别在 CSS 里再写一套。
 */
export function statusTable(
    parent: HTMLElement,
    columns: readonly StatusTableColumn[],
): StatusTableHandle {
    const el = parent.createDiv({ cls: 'rl-ui-tbl', attr: { role: 'table' } });
    const head = el.createDiv({ cls: 'rl-ui-tbl-head', attr: { role: 'row' } });
    for (const col of columns) {
        const cell = head.createDiv({
            cls: 'rl-ui-tbl-th',
            text: col.label,
            attr: { role: 'columnheader' },
        });
        if (col.align && col.align !== 'start') cell.addClass(`is-${col.align}`);
    }
    const body = el.createDiv({ cls: 'rl-ui-tbl-body' });

    // 列宽同时写到表头与每一行（`grid` 是每个 grid 容器各算一套，父容器设了也不继承）
    const tmpl = columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ');
    head.style.gridTemplateColumns = tmpl;

    const row = (opts: { head?: boolean; cls?: string } = {}): HTMLDivElement => {
        const r = body.createDiv({
            cls: opts.cls ? `rl-ui-tbl-row ${opts.cls}` : 'rl-ui-tbl-row',
            attr: { role: 'row' },
        });
        r.style.gridTemplateColumns = tmpl;
        return r;
    };

    return { el, body, row };
}

/**
 * 往表格行里塞一格。
 *
 * ⚠️ 所有格子都走这里：`role="cell"` + 对齐类一次到位，
 *    ⛔ 别在调用点 `createDiv({ cls: 'some-cell' })` —— 那样读屏就只剩一堆无名 div。
 */
export function cell(
    rowEl: HTMLElement,
    opts: { text?: string; cls?: string; align?: 'start' | 'center' | 'end' } = {},
): HTMLDivElement {
    const el = rowEl.createDiv({
        cls: opts.cls ? `rl-ui-tbl-td ${opts.cls}` : 'rl-ui-tbl-td',
        text: opts.text,
        attr: { role: 'cell' },
    });
    if (opts.align && opts.align !== 'start') el.addClass(`is-${opts.align}`);
    return el;
}

/* ────────────────────────────── ⑤-2 分离式表格（表头在外 + 表体滚动） ────────────────────────────── */

export interface SplitTableHandle {
    /** 表头外层（不滚动，贴在上沿） */
    headWrap: HTMLDivElement;
    /** 表头 `<table>`（已建好 `<colgroup>`；往里 `headRow` 塞 `<th>`） */
    headTable: HTMLTableElement;
    /** 表头行（已建好，`<th>` 直接往这里塞） */
    headRow: HTMLTableRowElement;
    /** 表体滚动容器 */
    wrap: HTMLDivElement;
    /** 表体 `<table>`（已建好 `<colgroup>`，往里塞 `<tbody>`） */
    bodyTable: HTMLTableElement;
}

export interface SplitTableOptions {
    /** 列宽真源（每列一个 CSS 长度，⛔ 不写 px 之外的单位限制；两张表共用这一份） */
    widths: readonly string[];
    /** 表头外层类名 */
    headWrapCls: string;
    /** 表体滚动容器类名 */
    wrapCls: string;
    /** 两张表共用的类名（不含 head/body 区分） */
    tableCls: string;
    /** 表头表自己的类名 */
    headCls: string;
    /** 表体表自己的类名 */
    bodyCls: string;
}

/**
 * 建一对**分离式表格**：表头 `<table>` 在滚动容器**外面**，表体 `<table>` 在滚动容器**里面**。
 *
 * 🔴 为什么必须分开两张表（#640 实测，⛔ 别改回一张表 + `position: sticky` 表头）：
 *    ⑴ 表头若在滚动容器内部且带 `sticky`，它仍参与该容器布局，而容器有 `border-radius` + `overflow`
 *       ⇒ 表头背景方块会顶到圆角外面，看着像「溢出去压住了上方页签」；
 *    ⑵ 表体滚动条要占宽（约 8px），表头却是 `width: 100%` ⇒ 表头比表体宽，右侧列对不齐。
 *    拆开之后表头根本不滚，两个问题一起消失。
 *
 * 🔴 对齐的唯一机制：两张表都 `table-layout: fixed`（由调用点的 `tableCls` 提供），
 *    并**共用同一份 `<colgroup>`**（本函数用 `opts.widths` 各写一份，内容逐字相同）。
 *    ⚠️ 于是列宽真源只有 `opts.widths` 一处 —— CSS ⛔ 不得再写 `td { width: … }`，否则与 col 打架。
 *
 * ⚠️ 为什么不用 `statusTable()`：那个是 `grid` + `role="table"` 的**只读**表（为窄屏折叠设计），
 *    而这里要的是真 `<table>` —— 42 行里每行都有一个可编辑 `<input>`，`table-layout: fixed`
 *    能保证输入框宽度不随内容抖动。两者是**不同语义**的控件，⛔ 别互相替代。
 */
export function splitTable(parent: HTMLElement, opts: SplitTableOptions): SplitTableHandle {
    const colgroupHtml = opts.widths.map((w) => `<col style="width:${w}">`).join('');

    const headWrap = parent.createDiv({ cls: opts.headWrapCls });
    const headTable = headWrap.createEl('table', { cls: `${opts.tableCls} ${opts.headCls}` });
    headTable.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;
    const headRow = headTable.createEl('thead').createEl('tr');

    const wrap = parent.createDiv({ cls: opts.wrapCls });
    const bodyTable = wrap.createEl('table', { cls: `${opts.tableCls} ${opts.bodyCls}` });
    bodyTable.innerHTML = `<colgroup>${colgroupHtml}</colgroup>`;

    return { headWrap, headTable, headRow, wrap, bodyTable };
}

/* ────────────────────────────── ⑥ 无边框图标动作（③-1「一键检测」） ────────────────────────────── */

/**
 * 建一枚**无边框透明**的图标动作按钮（用户 ③-1 逐字：「最右表头为一键检测按钮（无边框透明化）」）。
 *
 * 与 `iconButton` 的差别只有外观语义：这个在**静态**时完全透明（不抢视线），
 * hover / focus 才浮出底色与边框；⛔ 但它仍是真按钮 —— 键盘 Tab 能到、Enter 能按。
 */
export function ghostIconButton(cls: string, icon: string, tip: string): HTMLButtonElement {
    const btn = iconButton(cls, icon, tip);
    btn.classList.add('rl-ui-ghost');
    return btn;
}

/* ────────────────────────── ⑦ 弹窗关闭后归还焦点（2026-11-16 用户 m00830） ────────────────────────── */

/**
 * 弹窗关闭后，把残留在**卡片内部**的焦点交还给文档（用户 2026-11-16 m00830）。
 *
 * 用户原话：「点单卡和系列卡信息栏编辑属性退出后都存在封面悬停态不消失问题」。
 *
 * 根因：卡片信息栏是 `tabindex="0"` 的可点块，点它 ⇒ 焦点落在信息栏上 ⇒
 * 悬停遮罩的显示条件里那半边 `.rl-card:focus-within .rl-cov-hover { opacity: 1; }`
 * **永久命中**。弹窗关了以后 Obsidian 会把焦点**还给**打开前的那个元素（信息栏），
 * 于是 `:focus-within` 继续命中，遮罩一直亮着 —— 用户看到的「悬停态不消失」。
 *
 * 🔴 修法只做「归还焦点」，⛔ **别去动 `:focus-within` 那半条规则**：
 *    它是键盘用户看见「打开 ↗」的唯一途径（`CollectionBoard.svelte:19-21` 与
 *    `MediaList.svelte:1420-1431` 两处注释都把这条踩过的坑钉死了）。
 *
 * ⚠️ 必须 `setTimeout(…, 0)`：宿主是在 `onClose()` **之后**才做焦点复原的，
 *    同步 blur 会被那次复原覆盖掉（而且部分平台会把原生菜单一起关掉）。
 */
export function releaseCardFocusOnClose(): void {
    window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) return;
        if (active.closest('.rl-card')) active.blur();
    }, 0);
}
