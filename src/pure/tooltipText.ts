// 悬停气泡文案的「压成一行」纯逻辑（无 obsidian / DOM 依赖，可单测）。
//
// 🔴 用户 m18062（逐字）：「优化精简所有鼠标hover 交互悬停文案，不要超过1行」。
//
// 为什么需要这一层，而不是一个个手改文案：
//   气泡的真源是 `src/services/globalTooltip.ts` 的 `tipTextOf()`，全仓有 375 处 `data-tip`
//   （静态字面量 210 + 动态拼接 165）。靠人工逐条保证「一行」是不可能的 ——
//   今天改完，明天随便谁写下 `'第一句\n第二句'` 或塞进一个 80 字路径，就又破了。
//   ⇒ 在**渲染入口**统一压平，才是「不可能再超过一行」的机械保证。
//
// 两个口径（都被用户的实际报障驱动）：
//   ⑴ **`\n` 一律折成空格**。CSS 是 `white-space: pre-line`，`\n` 会真的换行 ——
//      本轮审计出的 9 条超限里，有 5 条就是自己写进 `\n` 的（其中 2 条是上一轮新增按钮时写的）。
//   ⑵ **按显示宽度截断**，不是按字符数。12px 字号下 CJK 占 12px、ASCII 约 6.2px，
//      同样 20 个字符，全角是 240px、半角只有 124px —— 按字符数截会把半角文案白白砍掉一半。
//
// 预算从哪来：`styles.css` 的 `.rl-tip` 是 `max-width: 340px` + `padding: 5px 9px` + 1px 边框
//   ⇒ 一行可用宽度 = 340 − 9×2 − 2 = **320px**。12px CJK ⇒ **约 26 个汉字**。
//   ⛔ 改这里的预算前先量 `.rl-tip` 的实际盒模型，别拍脑袋。

/** 一行可用宽度（px）：`.rl-tip` 的 max-width 340 − 左右 padding 18 − 边框 2 */
export const TIP_MAX_WIDTH_PX = 320;

/** CJK/全角字符的估算宽度（px，对应 `--font-ui-smaller` 的 12px） */
export const TIP_CJK_PX = 12;

/** ASCII / 半角字符的估算宽度（px）：12px 字号下常见无衬线字体的均值 */
export const TIP_ASCII_PX = 6.2;

/** 截断标记 */
export const TIP_ELLIPSIS = '…';

/**
 * 单个字符的估算显示宽度（px）。
 *
 * 判定「是不是全角」用码位区间，与仓内其它按宽度排版的地方同口径：
 * CJK 部首/标点（0x2E80–0xA4CF）、谚文（0xAC00–0xD7A3）、兼容汉字（0xF900–0xFAFF）、
 * 全角标点（0xFF00–0xFF60 / 0xFFE0–0xFFE6）、以及 CJK 的 0x1100–0x115F 谚文字母区。
 */
export function charWidthPx(ch: string): number {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
        (c >= 0x1100 && c <= 0x115f) ||
        (c >= 0x2e80 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6);
    return wide ? TIP_CJK_PX : TIP_ASCII_PX;
}

/** 整串的估算显示宽度（px） */
export function textWidthPx(text: string): number {
    let w = 0;
    for (const ch of text) w += charWidthPx(ch);
    return w;
}

/**
 * 把任意悬停文案压成**一行**：折掉所有换行与连续空白，再按显示宽度截断。
 *
 * ⚠️ 返回的一定是可安全塞进 `.rl-tip` 的单行文本（不含 `\n`、不含 `\r`）。
 * ⚠️ 空/纯空白 ⇒ 返回空串，调用方据此**不显示气泡**（与 `data-tip=""` 的语义一致）。
 */
export function fitTipText(raw: string | null | undefined): string {
    const flat = String(raw ?? '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\s\u3000]+/g, ' ')
        .trim();
    if (!flat) return '';
    if (textWidthPx(flat) <= TIP_MAX_WIDTH_PX) return flat;
    // 逐个字符累加，留出省略号的位置（⛔ 别先截再拼，那样末尾会顶出预算）
    const budget = TIP_MAX_WIDTH_PX - charWidthPx(TIP_ELLIPSIS);
    let out = '';
    let used = 0;
    for (const ch of flat) {
        const w = charWidthPx(ch);
        if (used + w > budget) break;
        out += ch;
        used += w;
    }
    // 截断点可能落在空格上 ⇒ 去掉尾随空格再拼省略号，避免「文字 …」这种空心眼
    return `${out.replace(/[\s\u3000]+$/, '')}${TIP_ELLIPSIS}`;
}
