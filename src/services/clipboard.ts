// 剪贴板读取（「粘贴」按钮用）。
// 本仓有两处「粘贴」：编辑条目「第 N 集」浮层的网络地址、快捷关联弹窗的网络地址 ——
// 读取口径只此一份，⛔ 别在组件里各写一遍（一处支持失败提示、另一处静默，必然漂）。
//
// 桌面 Obsidian（Electron）支持 `navigator.clipboard.readText()`；移动端 / 无权限 / 非安全上下文
// 会抛错 ⇒ 一律返回 undefined，由调用方提示「请手动粘贴」（⛔ 不弹原始异常文案，用户看不懂）。
//
// ⚠️ **#492**：本模块**曾**带一个写入端（供「关于」页那枚一键复制按钮用）—— 那枚按钮已随本批整体
//    退场，写入端**一并删除**（只有一个使用者 = 死码，本仓「死码不留」）。
//    ⬅️ 阅读器三兄弟（Epub / Pdf / Txt 的「复制 AI 答案」）至今仍各自内联一份写剪贴板；
//    将来收口时**在这里重新落一个写入端**，⛔ 别写进组件里（本仓「同一口径一份实现」）。

/**
 * 剪贴板文本清洗（纯函数，可单测）：取**第一行**、去首尾空白、剥掉成对包裹的引号 / 尖括号
 * （从浏览器地址栏或 Markdown 链接里复制的地址常带 `<...>`、`"..."`）。
 * 例：`" https://a.com/x?y=1 "\n复制自某处` → `https://a.com/x?y=1`
 */
export function cleanPastedText(raw: string): string {
    if (typeof raw !== 'string') return '';
    const first = raw.split(/\r?\n/)[0] ?? '';
    let t = first.trim();
    for (const [open, close] of [
        ['<', '>'],
        ['"', '"'],
        ["'", "'"],
        ['（', '）'],
        ['(', ')'],
    ]) {
        if (t.length >= 2 && t.startsWith(open) && t.endsWith(close)) t = t.slice(1, -1).trim();
    }
    return t;
}

/** 读剪贴板文本（不可用 / 被拒 / 空 → undefined） */
export async function readClipboardText(): Promise<string | undefined> {
    try {
        const nav = typeof navigator === 'undefined' ? undefined : navigator;
        if (!nav?.clipboard?.readText) return undefined;
        const t = await nav.clipboard.readText();
        return typeof t === 'string' ? t : undefined;
    } catch {
        return undefined;
    }
}
