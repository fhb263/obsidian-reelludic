/**
 * 同步弹窗三段式说明的**渲染**（2026-11-11 用户 m05717 ②）。
 *
 * ⚠️ 为什么文案在 `pure/syncHint.ts`、渲染在这里：
 *    `pure/` 下的模块一律不碰 DOM 与 `obsidian`，这样文案能被 vitest 逐字断言；
 *    渲染需要 Obsidian 给的 `createDiv` 扩展，只能放在 modals 层。
 */
import type { SyncHintSection } from 'pure/syncHint';

/**
 * 把正文里 `**xxx**` 渲染成加粗，其余原样。
 *
 * 用户原文里确实带了 `**不影响**` 这种行内强调（「**不影响**本地生成的评语…」），
 * 说明他要的不只是三段标签加粗，正文关键词也要加粗。
 * ⚠️ 只认成对的 `**`：落单的星号原样输出，不吞字符。
 */
function appendInlineBold(host: HTMLElement, text: string): void {
    const parts = text.split('**');
    for (let i = 0; i < parts.length; i += 1) {
        const piece = parts[i];
        if (piece === '') continue;
        // 奇数下标 = 被 `**` 包住的那一段
        if (i % 2 === 1) host.createEl('strong', { text: piece });
        else host.appendText(piece);
    }
}

/**
 * 在 `host` 里画三段说明。
 *
 * 结构（每段一行）：
 *   `<行><strong class="rl-wshelf-hint-label">同步数据</strong>：<正文></行>`
 *
 * 🔴 两条不能改的细节：
 *   ① 标签是 `<strong>` —— 用户说「用**加粗**或者**主题色**显示」，
 *      加粗给语义、主题色给视觉；两个都给，才在浅色/深色主题下都立得住。
 *   ② 冒号由**这里**补，不写进文案 —— 文案里再带冒号就会变成「同步数据：：」。
 */
export function renderSyncHint(host: HTMLElement, sections: readonly SyncHintSection[]): void {
    for (const sec of sections) {
        const line = host.createDiv({ cls: 'rl-wshelf-hint-line' });
        line.createEl('strong', { cls: 'rl-wshelf-hint-label', text: sec.label });
        // 全角冒号紧跟在加粗标签后面，与正文同色 —— 它属于标签，不属于正文
        line.appendText('：');
        appendInlineBold(line, sec.body);
    }
}
