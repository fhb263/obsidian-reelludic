// Bases 样式片段的「托管区 / 用户区」合并逻辑（纯函数，零 obsidian / DOM）。
//
// 🔴 要解决的问题（真实用户场景，不是假想）：
//   旧实现在 `main.ts` 里这样写 ——
//       if (!(vault.getAbstractFileByPath(snippetPath) instanceof TFile)) {
//           await io.writeText(snippetPath, BASE_SNIPPET_CSS);
//       }
//   也就是**只要文件存在就不写**。后果：片段里那条错误的 `.bases-view` 选择器
//   永远修不到已经生成过的用户 —— 他们必须在设置里手动删掉文件、再重新生成一次。
//   用户这次报的「这个 css 代码片段不生效没有悬停动效」正是撞在这上面。
//
// 🔴 但也不能简单地「每次全量覆盖」：片段进的是用户的 `.obsidian/snippets/`，
//   那是**用户可以自己改**的地方（文件头就写着「之后可自由修改」）。全量覆盖 =
//   把用户的定制悄悄抹掉，比不更新更恶劣。
//
// ⇒ 折中口径：把插件写的那段用标记圈起来当**托管区**，更新时只替换托管区，
//   标记之外的一切（用户自己加的规则）原样保留。
//   标记缺失（老版本写的文件 / 用户删了标记）⇒ 退化为「整段追加 + 加托管标记」，
//   ⛔ 仍然不覆盖用户已有的任何一行。

/** 托管区起始标记（⛔ 改这里要同步改 docs/ReelLudic Bases 样式.css） */
export const SNIPPET_MANAGED_BEGIN = '/* ==== ReelLudic 托管区 · 开始（重新生成时会整段替换，别在这里改）==== */';
/** 托管区结束标记 */
export const SNIPPET_MANAGED_END = '/* ==== ReelLudic 托管区 · 结束 ==== */';

/** 一次合并的结果 —— 带上「做了什么」便于调用方给用户准确提示 */
export interface SnippetMergeResult {
    /** 合并后的完整文件内容 */
    content: string;
    /** 相对原文件是否有实质变化（false ⇒ 调用方可以不写盘，省一次 IO） */
    changed: boolean;
    /** 用户区是否被保留下来（true 时提示文案要说「你加的样式还留着」） */
    keptUserContent: boolean;
}

/**
 * 从文件内容里切出「托管区之外的部分」，用来在替换时原样保留。
 * 标记成对出现才认；只出现一个（用户删了一半）⇒ 当作没有托管区。
 */
function splitAtManaged(content: string): { before: string; after: string } | null {
    const b = content.indexOf(SNIPPET_MANAGED_BEGIN);
    const e = content.indexOf(SNIPPET_MANAGED_END);
    if (b < 0 || e < 0 || e < b) return null;
    return { before: content.slice(0, b), after: content.slice(e + SNIPPET_MANAGED_END.length) };
}

/** 把模板的托管区包上标记（幂等：已经带标记就不重复包） */
export function wrapManaged(css: string): string {
    if (css.includes(SNIPPET_MANAGED_BEGIN) && css.includes(SNIPPET_MANAGED_END)) return css;
    return `${SNIPPET_MANAGED_BEGIN}\n${css.trimEnd()}\n${SNIPPET_MANAGED_END}`;
}

/**
 * 合并「插件自带片段」与「盘上已有片段」。
 *
 * @param existing 盘上现有内容；文件不存在传 `undefined`
 * @param shipped  插件这次要写入的片段
 *
 * 四种情形：
 *   1. 还没有文件                       ⇒ 写入带标记的 shipped
 *   2. 有文件、有完整托管标记            ⇒ 换掉托管区，标记外的用户内容原样留
 *   3. 有文件、无标记（老版本写的）      ⇒ **保留全部旧内容**，在后面追加新的托管区
 *      —— 老文件里那几条坏选择器留着也无害（匹配不到元素而已），
 *         而删掉它可能连带删掉用户在同一个文件里加过的东西。
 *   4. 盘上内容与将要写入的完全一致      ⇒ changed = false，不写盘
 */
export function mergeSnippet(existing: string | undefined, shipped: string): SnippetMergeResult {
    const managed = wrapManaged(shipped);

    // 情形 1：全新文件（文件不存在，或存在但是空的 —— 空文件等于没内容可保）
    if (existing === undefined || existing.trim().length === 0) {
        return { content: `${managed}\n`, changed: true, keptUserContent: false };
    }

    const parts = splitAtManaged(existing);

    // 情形 3：没有托管标记 —— 老版本文件，或用户把标记删了
    if (!parts) {
        const old = existing.trimEnd();
        // 老文件如果**已经**和新内容逐字一致（少见但可能：用户手动换成新的），别再追加一遍
        if (old === shipped.trimEnd() || old === managed.trimEnd()) {
            return { content: existing, changed: false, keptUserContent: false };
        }
        const head = old.length > 0 ? `${old}\n\n` : '';
        const note = '/* ── 以下由 ReelLudic 重新生成追加（上面是你原来的内容，未改动） ── */\n';
        return { content: `${head}${note}${managed}\n`, changed: true, keptUserContent: old.length > 0 };
    }

    // 情形 2：正常替换托管区
    const before = parts.before;
    const after = parts.after;
    const rebuilt = `${before}${managed}${after}`;
    const trimmedExisting = existing.trimEnd();
    const trimmedRebuilt = rebuilt.trimEnd();
    return {
        content: trimmedRebuilt === trimmedExisting ? existing : `${trimmedRebuilt}\n`,
        changed: trimmedRebuilt !== trimmedExisting,
        keptUserContent: after.trim().length > 0 || before.trim().length > 0,
    };
}

/**
 * 给用户的提示文案（一次算好，别在调用处拼字符串拼错）。
 * 口径：只有**真的**保留了用户内容才提一句 —— 否则是噪音。
 */
export function snippetNotice(path: string, r: SnippetMergeResult): string {
    const tail = r.keptUserContent ? '（你自己加的样式已保留）' : '';
    return `\n样式片段：${path}（设置 › 外观 › CSS 代码片段 里打开它）${tail}`;
}
