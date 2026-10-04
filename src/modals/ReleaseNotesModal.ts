// 「关于 › 更新日志」= **内置弹窗**（#491 建立 / #492 改「一个版本一句话」）。
//
// 用户 2026-10-03 两条：
//   ⑴「点击更新日志不跳转网页改成内置弹窗」—— 原先是 `window.open` 把用户丢到浏览器看仓库根的变更日志文件。
//   ⑵「弹窗内容改成按 releases 页这一系列的一句话来写」（本批 #492）—— 原先嵌的是**本版变更日志的整节**
//      整节**（600+ 行、要滚动），现在换成 `pure/releaseNotes` 那张**手写的版本一句话表**。
//   ⇒ 弹窗**不发网络请求、不跳浏览器**；底部只留一个**用户主动点**的完整发布记录链接。
//
// 🔴 为什么内容不联网取：`raw.githubusercontent.com` 在国内常不可达，而用户要的正是「别转圈等一个大概率
//    失败的请求」（真源与措辞口径见 `pure/releaseNotes` 的文件头）。
// ⚠️ 渲染走宿主 `MarkdownRenderer.render` + 一个**自建 `Component`**（在 `onClose` 里 `unload()`）：
//    自建而不是复用 plugin 实例 —— 弹窗关了就把子组件（链接 / 嵌入块）一并释放，⛔ 别挂到插件生命周期上。
import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import { RELEASE_NOTES, RELEASES_URL, releaseNotesMd } from 'pure/releaseNotes';

export class ReleaseNotesModal extends Modal {
    /** 承载 markdown 渲染的子组件（`onOpen` 装载 / `onClose` 卸载） */
    private readonly body = new Component();

    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, titleEl } = this;
        contentEl.empty();
        // ⚠️ 挂 `modalEl`（不是 contentEl）：宽度那条规则要写 `.modal.rl-notes-modal`（同 `AiPickerModal` 的 `.rl-pick-modal`）
        this.modalEl.addClass('rl-notes-modal');
        // ⚠️ 标题**不带版本号**（#492）：正文列的是**每个版本一行**，标题挂某一版的号会误导 ——
        //    当前版本就是正文第一行。
        titleEl.setText('更新日志');

        const host = contentEl.createDiv({ cls: 'rl-notes-body' });
        this.body.load();
        // ⚠️ `sourcePath` 传空串：本弹窗的内容不是库里某个文件，走链接 / 嵌入时不需要相对基准
        void MarkdownRenderer.render(this.app, releaseNotesMd(), host, '', this.body);

        const foot = contentEl.createDiv({ cls: 'rl-notes-foot' });
        foot.createSpan({ cls: 'rl-notes-meta', text: `共 ${RELEASE_NOTES.length} 个版本 · 完整发布记录见` });
        foot.createEl('a', { cls: 'rl-notes-link', text: 'GitHub Releases', href: RELEASES_URL });
    }

    onClose(): void {
        // 先卸载子组件（markdown 里的链接 / 嵌入块），再清空内容
        this.body.unload();
        this.contentEl.empty();
    }
}
