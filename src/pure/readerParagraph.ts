// 阅读器「当前段落」口径（#347）：单击书签时用它记录**段落文本 + 段落起点百分比**，
// 而不是只存一个滚动百分比（用户报障：「书签能不能从当前段落开始记录，不然不对齐不好看」）。
//
// 🔴 判据与 `services/TtsService.startOffset` **同一套**（第一处仍可见的文本节点 → 上升到 root 的直接子级）：
//    两处若各写一份，书签落点会与朗读起读点错开。
// ⚠️ `root` 与 `scroller` 必须**同一坐标系**：TXT 传 `.rl-reader-text` + `.rl-reader-scroll`；
//    EPUB 传 iframe 的 `body` + iframe 的 `scrollingElement`（两个都在 iframe 内，坐标自洽）。

/** 书签引用最长字数（超出截断 —— 存档 JSON 不该被一整段撑大） */
export const PARA_QUOTE_MAX = 120;

/** 段落文本 → 书签引用：折叠全部空白为单空格、去首尾、超长截断。
 *  空 / 纯空白 → `''`（调用方据此回退成纯位置书签，⛔ 不要写空引用进去）。 */
export function normalizeParagraphText(raw: string, max = PARA_QUOTE_MAX): string {
    const s = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 段落顶边在滚动内容里的偏移 → 章节内百分比（取整 + 夹取 0–100）。
 *  ⚠️ `scrollHeight ≤ 0`（尚未布局）或非法值 → 0，退回章首；⛔ 绝不产出 NaN / 负数。 */
export function paraPct(top: number, scrollHeight: number): number {
    if (!Number.isFinite(top) || !Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0;
    const r = Math.round((top / scrollHeight) * 100);
    return Math.min(100, Math.max(0, r));
}

/**
 * 取「当前段落」= **第一处仍可见的文本节点**所在的块（root 的直接子级）。
 * 返回归一后的文本 + 该块顶边在滚动内容里的偏移（px）。
 * 找不到（空章 / 未布局 / 只剩 root 本身）→ `null`（调用方退回旧口径：只存位置）。
 * ⚠️ 章节标题不在 root 里 ⇒ 天然不会被当成「当前段落」。
 */
export function currentParagraph(
    root: HTMLElement | null,
    scroller: HTMLElement | null,
): { text: string; top: number } | null {
    if (!root || !scroller) return null;
    const scRect = scroller.getBoundingClientRect();
    if (!scRect.height) return null;
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let hit: Text | null = null;
    let n = walker.nextNode();
    while (n) {
        const t = n as Text;
        if (t.data.trim()) {
            const r = doc.createRange();
            r.selectNodeContents(t);
            const rect = r.getBoundingClientRect();
            // +2：容忍半像素误差，避免刚好压在顶边的那一行被跳过
            if (rect.height > 0 && rect.bottom > scRect.top + 2) {
                hit = t;
                break;
            }
        }
        n = walker.nextNode();
    }
    if (!hit) return null;
    let block: Node = hit;
    while (block.parentNode && block.parentNode !== root) block = block.parentNode;
    if (block === root) return null;
    const el = block as HTMLElement;
    const text = normalizeParagraphText(el.textContent ?? '');
    if (!text) return null;
    const top = el.getBoundingClientRect().top - scRect.top + scroller.scrollTop;
    return { text, top };
}
