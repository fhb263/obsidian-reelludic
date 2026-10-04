/**
 * 「点按钮 ⇒ 弹系统文件选择框」的**唯一**实现（#425 第三次修，前两轮都没根治）。
 *
 * ## 🔴 为什么从「JS 现建 input → 挂进文档 → 用代码触发它」换成「`<label>` 内嵌 `<input>`」
 *
 * ⚠️ 本文件**刻意不写出那条老路的两个标志性调用名**：产物不剥注释，而反向守卫正是拿它们去核
 *    「有没有长回来」—— 写进注释就是自撞红（本仓同一条坑已踩三次）。下面一律用**说法**，不写调用。
 *
 *
 * #421 / #422 两轮都在修「设置页那两个导入按钮点了没反应」，用户上手**仍然**报同一件事。
 * 复盘：只要走 **JS 触发**那条路，就等于同时押上三个不确定项 ——
 *   ① input **现建后挂**（挂进去的是不是当前 document？会不会刚挂上就被重渲染摘掉？）；
 *   ② 触发时机算不算 user-activation，各 Electron / Chromium 版本行为并不一致；
 *   ③ **不可见 / 游离的元素在某些版本下被代码触发时静默不生效**（不抛错、无任何提示）——
 *      这与用户「点击无反应」的描述完全吻合。
 *
 * label 方案把这三条一起消掉：
 *   · `<input>` **自始至终就在 label 里**（不增删、不搬运）⇒ ①③ 不成立；
 *   · 点 label 由**浏览器内部**把激活转发给 input（标准行为，不经过任何 JS 调用）⇒ ② 不成立；
 *   · 而且 input 用 `inset:0` **铺满**整块 label —— 用户其实是**直接点在 input 上**，
 *     连「转发」这一步都不依赖。⇒ 两条路径同时成立。
 *
 * ⚠️ 调用方**别 `preventDefault()`**：那会把 label 的激活一起挡掉（`stopPropagation` 无妨）。
 * ⚠️ 隐藏方式**刻意不用 `display:none`**，而用 `.rl-file-pick`（绝对定位铺满 + `opacity:0`）——
 *    元素保持"真实可见、可交互"，正是要避开上面第 ③ 条。
 */
export interface FilePickOptions {
    /** 按钮样式类（与普通按钮同一套，例如 `rl-btn rl-src-import`） */
    cls: string;
    /** 按钮文字 */
    text: string;
    /** 悬浮提示（可选） */
    tip?: string;
    /** `accept` 过滤（缺省只收 `.json`） */
    accept?: string;
    /** 成功读到文本 */
    onText: (text: string, file: File) => void;
    /** 读文件失败 */
    onError?: (e: unknown) => void;
}

/** 造一个「点它弹文件框」的 label 按钮，挂到 `parent` 下并返回它 */
export function mountFilePickLabel(parent: HTMLElement, opts: FilePickOptions): HTMLLabelElement {
    // ⚠️ 刻意用**原生 DOM API**（不借 Obsidian 的 `createEl` 扩展）—— 这样这个函数在 jsdom 单测里
    //    也能原样跑（`createEl` 只在 Obsidian 运行时有，单测环境没有）。
    const label = document.createElement('label');
    label.className = `${opts.cls} rl-file-label`;
    label.textContent = opts.text; // 必须在 append input **之前**：反了会把 input 冲掉
    if (opts.tip) label.setAttribute('data-tip', opts.tip);
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'rl-file-pick';
    input.accept = opts.accept ?? '.json,application/json';
    input.addEventListener('change', () => {
        const file = input.files?.[0];
        /**
         * ⚠️ **立刻清空 `value`**：不清的话，用户「改了文件内容再选同一个文件」时 `change` **不会触发**
         *    （浏览器认为值没变）—— 表现就是"点了没反应"，是最容易被误判成 bug 的一种。
         *    `file` 是独立引用，清空 value 不影响它。
         */
        input.value = '';
        if (!file) return;
        file.text().then(
            (text) => opts.onText(text, file),
            (e) => opts.onError?.(e),
        );
    });
    label.appendChild(input);
    parent.appendChild(label);
    return label;
}
