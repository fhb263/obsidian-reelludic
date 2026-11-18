// 「关于 › 更新日志」弹窗 = **内置弹窗**（#491 建立 / #492 改「一个版本一句话」）。
//
// 用户 2026-10-03 两条：
//   ⑴「点击更新日志不跳转网页改成内置弹窗」—— 原先是 `window.open` 把用户丢到浏览器看仓库根的变更日志文件。
//   ⑵「弹窗内容改成按 releases 页这一系列的一句话来写」（本批 #492）—— 原先嵌的是**本版变更日志的整节**
//      （600+ 行、要滚动），现在换成 `pure/releaseNotes` 那张**手写的版本一句话表**。
//   ⇒ 弹窗**不发网络请求、不跳浏览器**；底部只留一个**用户主动点**的完整发布记录链接。
//
// 🔴 本轮用户裁定：「更新日志**按版本折叠**，默认只展开最新版（如 v1.5.0），
//    旧版本默认折叠、点标题或右侧 `v` 箭头才展开」。
//
// 为什么不再用 `MarkdownRenderer.render(releaseNotesMd())`：
//   `releaseNotesMd()` 产出的是**一个** markdown 无序列表，渲染成**一个** `<ul>` ——
//   折叠的粒度是「每个版本一块」，砸在同一个 `<ul>` 里就没法逐块开关。
//   ⇒ 改成自建节点：每个版本一个 `<details>`（原生折叠，键盘可达、无 JS 状态机），
//     `open` 属性只给第一条（= `RELEASE_NOTES[0]` = 当前版本）。
//   ⚠️ 原生 `<details>/<summary>` 而不是自己 `click` + `hidden`：焦点、空格/回车展开、
//      读屏「已折叠/已展开」全部由浏览器免费提供，`⛔` 别为省一行 CSS 手写状态机。
//   ⚠️ 摘要行仍走 markdown 渲染（`summary` 是关键，正文一句话里可能有 `**` / 行内代码），
//      所以**每条一个子组件**、`onClose` 里逐个 `unload()` —— 与原来「整块一个子组件」同理。
import { App, Component, MarkdownRenderer, Modal, setIcon } from 'obsidian';
import { RELEASE_NOTES, RELEASES_URL } from 'pure/releaseNotes';
import { applyScrollPref } from 'services/scrollPref';
import { bindTooltipDocument } from 'services/globalTooltip';
// 提示 + 读屏名统一走组件基座（①-9：⛔ 别再手写 aria-label，会与 data-tip 叠两层气泡）
import { setTip, srLabel } from 'ui/components';

export class ReleaseNotesModal extends Modal {
    /** 承载 markdown 渲染的子组件（每条版本一个；`onOpen` 装载 / `onClose` 逐个卸载） */
    private readonly bodies: Component[] = [];
    /** 一键展开/收起那枚按钮（文案按「当前是否已全展开」反转；`null` = 还没建） */
    private toggleEl: HTMLButtonElement | null = null;
    /** 正文滚动区（按钮要按它里面的 `<details>` 集合判全展开，故存一份引用） */
    private hostEl: HTMLElement | null = null;

    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl, titleEl } = this;
        contentEl.empty();
        // ⚠️ 挂 `modalEl`（不是 contentEl）：宽度那条规则要写 `.modal.rl-notes-modal`（同 `AiPickerModal` 的 `.rl-pick-modal`）
        this.modalEl.addClass('rl-notes-modal');
        // ⚠️ 标题**不带版本号**（#492）：正文列的是**每个版本一块**，标题挂某一版的号会误导 ——
        //    当前版本就是正文第一块。
        titleEl.setText('更新日志');

        // 🔴 2026-11-08（用户 m04478）：「更新日志页面加个一键展开和收起的按钮（透明化无边框）」
        // 🔴 2026-11-08（用户 m05024）：「把更新日志展开文字按钮改成**小图标按钮**放在更新日志**标题的旁边**」
        //    ⇒ 从「正文上方的一枚文字按钮」搬进 `.modal-title`，文案换成图标 + `data-tip` 悬停提示。
        //    ⚠️ 只认 `chevrons-up-down`（展开）/ `chevrons-down-up`（收起）这一对：
        //      两者同为「上下双箭头」家族，语义差别只在箭头朝向，视觉上是一枚图标在翻面。
        //      （`expand` / `collapse` 在 obsidian.asar 里**不存在**，是 lucide 的新名字 —— 已探测过。）
        //    ⚠️ 弹窗内的 `data-tip` 需要自己绑：全局 tooltip 按 document 绑定，主窗口由
        //      `initGlobalTooltip()` 自动挂，Modal 不在那条链上（设置页是手动绑的，见 `Settings.ts`）。
        bindTooltipDocument(this.modalEl.ownerDocument);
        this.toggleEl = titleEl.createEl('button', { cls: 'rl-notes-toggle', attr: { type: 'button' } });
        this.toggleEl.addEventListener('click', () => {
            const folds = this.foldEls();
            // 判据 = 「是不是**已经**全展开」：全展开就一键收起，否则一键展开
            // ⚠️ 不看某个单块的 open 状态（用户可能手动开了一半，那时点一次应该「补齐成全展开」）
            const allOpen = folds.length > 0 && folds.every((f) => f.open);
            for (const fold of folds) fold.open = !allOpen;
            this.syncToggleLabel();
        });

        const host = contentEl.createDiv({ cls: 'rl-notes-body' });
        this.hostEl = host;
        RELEASE_NOTES.forEach((note, i) => {
            // 默认只展开最新版（`RELEASE_NOTES[0]`）；其余折叠
            const fold = host.createEl('details', { cls: 'rl-notes-fold' });
            if (i === 0) fold.setAttribute('open', '');
            // 用户手动开合后按钮文案要跟着翻（否则「展开全部」点完还写着「展开全部」）
            fold.addEventListener('toggle', () => this.syncToggleLabel());
            const head = fold.createEl('summary', { cls: 'rl-notes-sum' });
            head.createSpan({ cls: 'rl-notes-ver', text: `v${note.version}` });
            head.createSpan({ cls: 'rl-notes-date', text: note.date });
            // 右侧 `v` 箭头：纯装饰（真开合判据是 `<details>` 的 `open`），`aria-hidden` 防止读屏念出多余符号
            head.createSpan({ cls: 'rl-notes-caret', text: '▾', attr: { 'aria-hidden': 'true' } });

            const body = fold.createDiv({ cls: 'rl-notes-item' });
            const comp = new Component();
            this.bodies.push(comp);
            comp.load();
            // ⚠️ 每条一个子组件：一句话里可能出现 `**` / 行内代码 / 外链，交给宿主渲染器，
            //    ⛔ 别用 `createSpan({ text })` 硬塞（会把 markdown 标记原样显示出来）。
            //    `sourcePath` 传空串：内容不是库里某个文件，链接 / 嵌入不需要相对基准。
            void MarkdownRenderer.render(this.app, note.summary, body, '', comp);
        });
        this.syncToggleLabel();

        const foot = contentEl.createDiv({ cls: 'rl-notes-foot' });
        foot.createSpan({ cls: 'rl-notes-meta', text: `共 ${RELEASE_NOTES.length} 个版本 · 完整发布记录见` });
        foot.createEl('a', { cls: 'rl-notes-link', text: 'GitHub Releases', href: RELEASES_URL });
    }

    /** 正文里所有版本折叠块（`querySelectorAll` 每次现取，⛔ 不另存一份数组当第二真源）。 */
    private foldEls(): HTMLDetailsElement[] {
        const host = this.hostEl;
        if (!host) return [];
        return Array.from(host.querySelectorAll<HTMLDetailsElement>('details.rl-notes-fold'));
    }

    /**
     * 按「是否已全展开」刷新那枚图标按钮（唯一定图标/提示的地方）。
     *
     * ⚠️ 图标与 `data-tip` 必须**同源**：一处写「全部展开」另一处写「全部收起」时，
     *    用户看到的箭头和悬停提示会互相打脸。两处都从 `allOpen` 派生。
     * 🔴 2026-11-12（用户 m00353 ①-9「部分按钮 hover 双提示重叠覆盖」）：
     *    这里原本 `aria-label` 与 `data-tip` 同时挂 —— 「弹窗自己绑了 document 所以不冲突」是**错的**：
     *    绑 document 只让 `data-tip` 生效，`aria-label` 照样会触发 Obsidian **自己的**官方气泡，
     *    于是同一颗按钮 hover 出两个提示。现在只留 `data-tip`，读屏名走 `.rl-sr`。
     */
    private syncToggleLabel(): void {
        const el = this.toggleEl;
        if (!el) return;
        const folds = this.foldEls();
        const allOpen = folds.length > 0 && folds.every((f) => f.open);
        const label = allOpen ? '全部收起' : '全部展开';
        el.empty();
        setIcon(el, allOpen ? 'chevrons-down-up' : 'chevrons-up-down');
        setTip(el, label);
        srLabel(el, label);
    }

    onClose(): void {
        // 先把每条的子组件卸载（markdown 里的链接 / 嵌入块），再清空内容
        for (const comp of this.bodies) comp.unload();
        this.bodies.length = 0;
        this.toggleEl = null;
        this.hostEl = null;
        this.contentEl.empty();
    }
}
