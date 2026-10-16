/**
 * **正文净化**（纯逻辑，#419）—— 无 `obsidian` / 无 DOM / 无网络，可单测。
 *
 * 输入是**已经从 HTML 里取出来的纯文本**（DOM 侧的取文本、按 `filterTag` 删块，都在
 * `services/htmlQuery` 做）；本模块只管**文本层**的脏东西：
 *  ① 书源 `chapter.filterTxt`（正则，`|` 是分支）—— 各站点的水印 / 广告 / 「本章完」；
 *  ② `&nbsp;`（NBSP）与各种空白规整；
 *  ③ 拆段（每段一行，EPUB 侧再包 `<p>`）。
 *
 * 🔴 为什么 `filterTxt` 要在这里而不是 DOM 侧：它是**文本正则**（不是选择器），
 *    而 `filterTag` 是**选择器** —— 两者层次不同，混在一起做会让「正则改不动 HTML」这种怪 bug 出现。
 */

/** 净化结果 + 有没有出错（`badPattern` 非空 ⇒ 该源的正则写坏了，UI 要提示） */
export interface CleanResult {
    text: string;
    /** 书源里的 `filterTxt` 编译失败时的原因（此时**不过滤**，原样保留正文） */
    badPattern?: string;
}

/**
 * 把书源的 `filterTxt` 编译成正则。
 *
 * 🔴 两处兼容（都是实测出来的）：
 *  ⑴ 书源里写的是**正则源码串**（如 `\\(本章完\\)`）⇒ 直接 `new RegExp`；
 *  ⑵ 正则里出现 `&nbsp;`（真实书源里就有：`一秒记住【文学巴士&nbsp;】，…`）——
 *     而 DOM 取出的文本里它是 `\u00a0`，**字面比不中** ⇒ 统一换成 `\s`；
 *     编不出来（用户写坏了）⇒ 回 `null`，调用方照常放行文本并在 UI 提示。
 */
export function buildFilterRegex(filterTxt: string): { re: RegExp } | { error: string } {
    const p = String(filterTxt ?? '').trim();
    if (!p) return { error: '' };
    const src = p.replace(/&nbsp;/g, '\\s');
    try {
        return { re: new RegExp(`(?:${src})`, 'g') };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * 净化一章正文。
 *
 * 顺序有讲究（⛔ 别调）：**先 NBSP→空格** ⇒ **再跑 filterTxt** ⇒ **最后规整空行**。
 * 若先规整空行，`filterTxt` 里那些带空格/换行的模式就再也比不中了。
 */
export function cleanChapterText(raw: string, opts: { filterTxt?: string } = {}): CleanResult {
    // 先把 NBSP / 全角空格归一，否则「一秒记住」这类前后带 &nbsp; 的模式永远比不中
    let t = String(raw ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\u3000/g, ' ');

    let badPattern: string | undefined;
    const built = buildFilterRegex(opts.filterTxt ?? '');
    if ('re' in built) t = t.replace(built.re, '');
    else if (built.error) badPattern = built.error;

    const lines = t
        .split(/\r\n|\r|\n/)
        .map((l) => l.replace(/[ \t]+$/g, '').trim())
        .filter((l) => l.length > 0);
    // 段落之间留**一个**空行（纯 TXT 与 EPUB 都好读；⛔ 别折叠成一行，网文的换段是有意义的）
    return { text: lines.join('\n\n'), badPattern };
}

/** 拆段（EPUB 侧每段包一个 `<p>`；已净化的文本按空行分段） */
export function chapterParagraphs(text: string): string[] {
    return String(text ?? '')
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
        .filter((p) => p.length > 0);
}

/**
 * 章节标题行：`第 N 章 原标题`（原标题已含「第 N 章」时**不重复加**，直接用它）。
 * ⚠️ 目录页给的标题常常自带「第 12 章 风起」⇒ 再加一层会变成「第 12 章 第 12 章 风起」。
 */
export function chapterHeading(no: number, title: string): string {
    const t = String(title ?? '').trim();
    if (/第\s*[0-9零一二三四五六七八九十百千两]+\s*[章节回]/.test(t)) return t;
    return no > 0 ? `第 ${no} 章 ${t}`.trim() : t;
}

/** 目录行的展示文本（列表里只看标题，序号由 UI 另渲染） */
export function chapterListLabel(no: number, title: string): string {
    return chapterHeading(no, String(title ?? '').trim());
}
