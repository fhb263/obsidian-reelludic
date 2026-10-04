// AI 回复里的 JSON 提取 —— **全仓唯一一份**（纯逻辑，无 obsidian 依赖，可单测）。
//
// 由来（#499）：总结摘要（`pure/aiSummary`）里本来有一份私有的 `stripFence` + `extractFirstJsonObject`；
// 本批的「AI 预填」同样要「模型爱加 ``` 围栏 / 爱在 JSON 前后解释两句」这套容错。
// 抄第二份 = 两套容错必然分叉（一边改了另一边不知道），故下沉到这里，两边共用。
//
// ⛔ 解析策略本身**不是**「尽量把坏数据救活」：以 `{` 开头却解析不出来的（坏 JSON）
//    一律返回 null —— 让调用方走各自的降级路径，**别把半截 JSON 当正文写进笔记**。

/** 剥掉 ```json … ``` 围栏（模型爱加）；无围栏时原样返回（去首尾空白） */
export function stripFence(text: string): string {
    const t = typeof text === 'string' ? text.trim() : '';
    const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
    return m ? m[1].trim() : t;
}

/** 提取首个**平衡的** `{...}`（容忍前后解释文字；字符串内的花括号与转义不参与计数） */
export function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * 「模型回复文本 → 对象」一站入口：剥围栏 → 提取首个 JSON 对象 → 解析。
 * 非字符串 / 空 / 没有 `{` / 坏 JSON / 解析结果不是对象（数组、`null`、标量）⇒ null。
 * ⚠️ 调用方若要「纯文本降级」（如总结摘要），自行在 null 之后判断 —— 本函数**只做 JSON 那一半**。
 */
export function parseAiJsonObject(text: string | null | undefined): Record<string, unknown> | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    const jsonText = extractFirstJsonObject(stripFence(text));
    if (!jsonText) return null;
    try {
        const obj = JSON.parse(jsonText) as unknown;
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
        return obj as Record<string, unknown>;
    } catch {
        return null;
    }
}
