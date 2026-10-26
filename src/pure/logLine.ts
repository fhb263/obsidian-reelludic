// 逐条记录的「写入笔记那一行」格式 —— 唯一真源
//
// 🔴 用户 m00002：「条目卡片右键菜单的添加短评/记录重温/记录时长都给我加上时间前缀，预览效果」
//   ⇒ 结论：**每条落进笔记的记录都带日期前缀**，且弹窗里要能看到「将写入的这行」。
//
// ⛔ 别再在 noteGenerator / 弹窗预览里各拼一份模板：两处真源必然漂移（
//   历史坑：#453 的占位文案就是内联了两份，改一处就不同步）。

/** 日期前缀：`- **2026-10-22** · <正文>[ · <备注>]`
 *  - 时长 / 重温 / 周目 三类共用（它们的备注都可选）
 *  - 日期由调用方给（记录弹窗里是用户选的日期，默认今天）
 */
export function datedRecordLine(date: string, body: string, note?: string): string {
    const tail = note?.trim();
    return `- **${date.trim()}** · ${body.trim()}${tail ? ` · ${tail}` : ''}`;
}

/** 短评的追加块：同样带日期前缀。
 *  🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」——
 *    这个块现在落在**独立的 `## 短评` 章节**（noteGenerator），不再进 `## 个人评语`。
 *  ⚠️ 短评是多行自由文本（用户可能贴一大段）——首行挂 `- **日期** · `，
 *    后续行缩进两格继续保持列表项归属，⛔ 否则笔记里会被渲染成游离段落。
 */
export function commentRecordBlock(date: string, text: string): string {
    const lines = text.split('\n');
    const head = datedRecordLine(date, lines[0] ?? '');
    const rest = lines.slice(1).map((l) => (l.trim() ? `  ${l}` : ''));
    return [head, ...rest].join('\n');
}
