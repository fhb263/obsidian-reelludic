/**
 * 时间戳笔记的「心情 + 备注」文案真源（用户 `m04435` ①）。
 *
 * 用户原话：「**右键**：弹出"时间戳笔记"浮层（鼠标自动聚焦），附有一个笑脸表情图标
 * （点击后展开六档心情emoji图标），附预览窗。选择心情后生成记录并展示为：`20:15 震撼emoji`
 * （右键未选择直接关闭，不生成记录）」；当场裁定两条：「选心情只是选中，再点「写入笔记」才落」
 * 与「要有备注输入框，文字接在心情后面」。
 *
 * 落盘形态（链接 + 空格 + 补充文字）：
 * ```
 * [20:15](…链接…) 🤩 震撼 这段配乐绝了
 * ```
 * 三条口径：
 *  ① **心情在前、备注在后**，顺序固定 —— `pure/videoMarks.markCaption` 会把链接剥掉当「手写说明」
 *     显示在抽屉列表里，心情排在最前面才一眼可读。
 *  ② 心情缺省（用户没点笑脸）时**只写备注**，⛔ 不要留一个空槽占位。
 *  ③ 两者都空 ⇒ 空串（调用方据此判定「与左键单击完全一致」，走原来那条纯链接的路）。
 *
 * ⚠️ 心情的 emoji/文案一律取自 `pure/mood`（本表是唯一真源），⛔ 别在视图或宿主里手抄一份。
 */
import { moodText, type MoodId } from './mood';

/** 浮层标题（用户点名的那个名字，浮层标题栏与读屏标签共用） */
export const STAMP_NOTE_TITLE = '时间戳笔记';

/** 写入笔记的按钮文案 */
export const STAMP_NOTE_COMMIT = '写入笔记';

/**
 * 拼出链接**后面**那段补充文字（心情 + 备注）。
 * 两者都空 ⇒ `''`（调用方据此退化成纯时间戳链接，与左键单击同形）。
 */
export function stampNoteCaption(mood: MoodId | undefined, note: string | undefined): string {
    const parts: string[] = [];
    const m = moodText(mood);
    if (m) parts.push(m);
    const t = typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
    if (t) parts.push(t);
    return parts.join(' ');
}

/**
 * 把补充文字接到链接后面。`caption` 为空 ⇒ 原样返回 `link`（不带尾随空格 —— 那会让 Obsidian
 * 把链接 token 与空白一起当成坏 URL）。
 */
export function stampNoteLine(link: string, caption: string): string {
    const l = typeof link === 'string' ? link.trim() : '';
    if (!l) return '';
    const c = typeof caption === 'string' ? caption.trim() : '';
    return c ? `${l} ${c}` : l;
}

/**
 * 预览窗要显示的那一行（`0:20 🤩 震撼 备注`）。
 *
 * ⚠️ 预览**不是**最终笔记那一行：笔记里时间戳是链接（`[0:20](…)`），预览里只显示时间文字，
 * 否则用户会看到一坨 `…obsidian://…`。时间文字由调用方给的 `timeText` 决定（与链接文字同源，
 * 多集时形如 `第3集·0:20`），这里只管把心情/备注接上去。
 */
export function stampNotePreview(timeText: string, mood: MoodId | undefined, note: string | undefined): string {
    const t = typeof timeText === 'string' ? timeText.trim() : '';
    const caption = stampNoteCaption(mood, note);
    if (!t) return caption;
    return caption ? `${t} ${caption}` : t;
}
