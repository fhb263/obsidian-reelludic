// 标注列表（书签 / 高亮 / 摘抄）的**多选状态机**（#345）。
// 用户报障原文：「"清除全部"改成能看到具体条目并支持勾选单条或多条删除」——
// 即把不可逆的一键清空，换成「选择模式 + 逐条勾选 + 删除所选」。
//
// 纯逻辑（状态迁移 / 文案）在此单测；DOM 接线（分区头按钮、列表勾选框）在本文件下半部 ——
// 与 `readerToc.attachTocResizer` 同惯例（纯函数单测 + DOM 接线靠真机验证）。

export interface AnnoSelState {
    /** 是否处于「选择模式」 */
    on: boolean;
    /** 已勾选的条目 id。⚠️ 只有**有 id** 的条目可勾选（旧数据/手写条目可能缺 id ⇒ 无法唯一定位，
     *  既不显示勾选框、也不参与删除 —— 与既有右键单删的守卫同口径） */
    ids: string[];
}

/** 初始状态（未进入选择模式） */
export function createAnnoSel(): AnnoSelState {
    return { on: false, ids: [] };
}

/** 进入选择模式（清空上次勾选，避免残影） */
export function enterAnnoSel(s: AnnoSelState): void {
    s.on = true;
    s.ids = [];
}

/** 退出选择模式（连同勾选一并清空） */
export function exitAnnoSel(s: AnnoSelState): void {
    s.on = false;
    s.ids = [];
}

/** 勾选 / 取消勾选一条（未进入选择模式时忽略；空 id 忽略） */
export function toggleAnnoSelItem(s: AnnoSelState, id: string | undefined): void {
    if (!s.on || !id) return;
    const i = s.ids.indexOf(id);
    if (i >= 0) s.ids.splice(i, 1);
    else s.ids.push(id);
}

/** 该条目是否已勾选 */
export function isAnnoSelItem(s: AnnoSelState, id: string | undefined): boolean {
    return !!id && s.ids.indexOf(id) >= 0;
}

/** 全选：只收当前列表里**有 id** 的条目（无 id 的旧数据不参与） */
export function selectAllAnno(s: AnnoSelState, ids: (string | undefined)[]): void {
    if (!s.on) return;
    s.ids = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** 已勾选条数 */
export function selCount(s: AnnoSelState): number {
    return s.ids.length;
}

/** 取出已勾选 id 的**副本**（防止调用方就地改动内部状态） */
export function selectedIds(s: AnnoSelState): string[] {
    return s.ids.slice();
}

/**
 * 分区头计数文案：
 *  · 常态 → `书签（3）`
 *  · 选择模式 → `已选 2 / 3`（分子 = 已勾选，分母 = 该区条目总数）
 */
export function annoCountText(label: string, total: number, s: AnnoSelState): string {
    if (s.on) return `已选 ${s.ids.length} / ${total}`;
    return `${label}（${total}）`;
}

// ── DOM 接线（真机验证；不在 node 单测覆盖范围内） ──

/** 分区头的类名（三区共用；高亮摘抄另有 .rl-reader-ex-head 分隔线） */
export const ANNO_SEL_HEAD_CLS = 'rl-anno-sel';

export interface AnnoHeadHandles {
    /** 头部容器（模式类加在它上面） */
    head: HTMLDivElement;
    /** 列表容器（紧跟头部创建；模式类同步挂上） */
    listEl: HTMLDivElement;
    /** 计数文本节点 */
    countEl: HTMLDivElement;
    /** 「选择」按钮（常态） */
    selectBtn: HTMLButtonElement;
    /** 「全选」按钮（模式内） */
    selAllBtn: HTMLButtonElement;
    /** 「删除所选」按钮（模式内，危险样式） */
    delBtn: HTMLButtonElement;
    /** 「取消」按钮（模式内） */
    cancelBtn: HTMLButtonElement;
    /** 本区选择态 */
    sel: AnnoSelState;
}

export interface AnnoHeadOptions {
    /** 计数节点的类名（三区沿用 .rl-reader-ex-hlcount） */
    countCls: string;
    /** 列表容器的类名（如 .rl-reader-bm-list）；由本函数按「头 → 列表」顺序创建，避免顺序错乱 */
    listCls: string;
    /** 计数初始文案（如「书签（0）」） */
    text: string;
    /** 追加在 .rl-reader-hl-head 之后的额外类（高亮/摘抄区传 'rl-reader-ex-head'） */
    extraCls?: string;
    /** 删除已勾选的若干条：内部自行弹确认，**返回是否真的删了** ——
     *  用户取消时必须返回 false，否则会把选择模式一起关掉（勾选白做）。 */
    onDelete: (ids: string[]) => Promise<boolean>;
    /** 取当前列表全部条目 id（全选用；含 undefined 的旧数据） */
    allIds: () => (string | undefined)[];
    /** 重绘本区列表（模式切换 / 勾选变化后调用） */
    refresh: () => void;
}

/**
 * 建一个标注分区（#345）：头部 + 列表容器（按序创建）。
 * 头部常态 = `计数 + [选择]`；选择模式 = `已选 N / 总 + [全选] [删除所选] [取消]`。
 * 列表容器同步挂 `.rl-anno-sel`，由 CSS 决定勾选框显隐。
 */
export function buildAnnoHead(parent: HTMLElement, o: AnnoHeadOptions): AnnoHeadHandles {
    const sel = createAnnoSel();
    const head = parent.createDiv({ cls: 'rl-reader-hl-head' + (o.extraCls ? ` ${o.extraCls}` : '') });
    const countEl = head.createDiv({ cls: o.countCls, text: o.text });
    const actions = head.createDiv({ cls: 'rl-anno-actions' });
    // 常态按钮
    const selectBtn = actions.createEl('button', { cls: 'rl-btn rl-reader-btn rl-anno-btn rl-anno-normal', text: '选择' });
    selectBtn.setAttribute('data-tip', '进入选择模式：勾选单条或多条后删除');
    // 模式内按钮
    const selAllBtn = actions.createEl('button', { cls: 'rl-btn rl-reader-btn rl-anno-btn rl-anno-only', text: '全选' });
    selAllBtn.setAttribute('data-tip', '勾选本区全部条目');
    const delBtn = actions.createEl('button', { cls: 'rl-btn rl-reader-btn rl-anno-btn rl-anno-only rl-anno-danger', text: '删除所选' });
    delBtn.setAttribute('data-tip', '删除已勾选的条目（会先确认一次）');
    const cancelBtn = actions.createEl('button', { cls: 'rl-btn rl-reader-btn rl-anno-btn rl-anno-only', text: '取消' });
    cancelBtn.setAttribute('data-tip', '退出选择模式（不删除任何条目）');
    // 列表容器紧跟头部（顺序即「头 → 列表」，⛔ 不要调换）
    const listEl = parent.createDiv({ cls: o.listCls });

    const applyMode = (): void => {
        head.toggleClass(ANNO_SEL_HEAD_CLS, sel.on);
        listEl.toggleClass(ANNO_SEL_HEAD_CLS, sel.on);
        delBtn.disabled = sel.ids.length === 0;
        o.refresh();
    };

    // 🔴 四个按钮都要在 mousedown 上 stopPropagation：否则点击会先触发 document 的 onDocMouseDown，
    //    万一将来把头部放进浮层里就会被「先收起、再 toggle」反相。
    for (const b of [selectBtn, selAllBtn, delBtn, cancelBtn]) {
        b.addEventListener('mousedown', (ev) => ev.stopPropagation());
    }
    selectBtn.addEventListener('click', () => {
        enterAnnoSel(sel);
        applyMode();
    });
    cancelBtn.addEventListener('click', () => {
        exitAnnoSel(sel);
        applyMode();
    });
    selAllBtn.addEventListener('click', () => {
        selectAllAnno(sel, o.allIds());
        applyMode();
    });
    delBtn.addEventListener('click', () => {
        const ids = selectedIds(sel);
        if (ids.length === 0) return;
        void o.onDelete(ids).then((deleted) => {
            // 只有真的删了才退出选择模式；用户取消确认 → 保持勾选，便于继续调整
            if (deleted && sel.on) {
                exitAnnoSel(sel);
                applyMode();
            }
        });
    });

    return { head, listEl, countEl, selectBtn, selAllBtn, delBtn, cancelBtn, sel };
}

/** 列表项勾选框（#345）：24×24 热区 + 16×16 自绘方框；勾选态用强调色底 + 白勾 */
export function appendAnnoCheck(item: HTMLElement, checked: boolean): void {
    const box = item.createDiv({ cls: 'rl-anno-check' + (checked ? ' is-on' : '') });
    box.setAttribute('aria-hidden', 'true');
}
