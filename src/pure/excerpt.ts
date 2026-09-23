// 摘抄纯逻辑（无 obsidian 依赖，可单测）
//
// 两种块格式并存（2026-09-17 起，用户指定新摘抄格式；旧格式解析端永久兼容）：
//  ① 摘抄区（callout，新）：头行 = `> [!quote|yellow] [[源文件#^id|标签]]`，正文 = `> 摘录`，
//     想法 = `> ---` + `> 想法`。块 id 嵌在头行链接锚点上，不再单列 `^id`。
//  ② 高亮区（同款 callout，配色段＝所选颜色）：`> [!quote|green] [[源文件#^hl…|第 N 章 · P% · 划线]]` + `> 引用`。
//  ③ 旧格式（扁平块，解析端兼容、渲染分支保留）：`> 引用` + 空行 + `**p.N** · 定位：N:N` + `^id`。
//
// 🔴 **callout 类型固定用内置 `quote`**（用户 2026-09-17 裁定 A1）：自定义类型（`[!TXT]` / `[!EPUB]`）
//    Obsidian 不认识 → 退回默认**灰底 + 铅笔**样式，观感很差；内置 `quote` 才有正常的引号图标与主题色。
//    「来源是哪种文件」由此由**头行链接的文件名**承载（`活着.txt`），不再编码进类型名。
// 🔴 **摘录↔想法 的分隔用真水平线 `> ---`**（同日裁定 B1）：`---div---` 是标记不是样式，渲染时会把
//    这几个字原样显出来；`> ---` 走 CommonMark 水平线，在 callout 内同样成立。旧块的 `---div---` 仍兼容解析。

import { readerDeepLink } from 'pure/readerLink';

export interface ParsedExcerpt {
    quote: string;
    page?: number;
    note?: string;
    id?: string;
    /** 原书定位：chapter 从 1 计，pct 0-100 整数（阅读器书签跳转/笔记溯源用；旧摘抄无此字段） */
    loc?: { chapter: number; pct: number };
    /** 高亮样式中文标签（仅「## 高亮」区使用：高亮/划线/波浪；旧块无此字段 → 按黄色高亮渲染） */
    style?: string;
    /** 高亮颜色：中文标签（旧块 meta 行「颜色：绿」）或 callout 配色 id（新块 `|green`）；缺省黄 */
    color?: string;
    // ── callout 头行字段（append-only；旧块与扁平块不产出）──
    /** 头行标签文案（如「第 6 章 · 11%」「第 128 页」） */
    label?: string;
    /** 源文件 wikilink 目标（vault 链接文本；无链接的头行不产出） */
    refLink?: string;
}

/** 渲染选项：摘抄/高亮区走 callout，旧格式渲染仍用扁平块（缺省） */
export interface ExcerptRenderOptions {
    /** 渲染为 callout 新格式（摘抄/高亮区）；缺省＝扁平块（旧格式，兼容用） */
    callout?: boolean;
    /** 源文件 wikilink 目标（vault 链接文本）；缺省时头行只写标签文本（此时块尾补 `^id` 行保住删除锚点） */
    refLink?: string;
    /**
     * callout 配色（Obsidian 色名：yellow / red / green / blue / purple）。
     * 🔴 **只在显式给出时才写 `|色名`**：高亮块按色渲染靠它（`renderHighlightBlock` 必传）；
     * 摘抄**不传** → 写成 `[!quote]`，颜色跟随用户主题（用户 2026-09-19 裁定 D-4：去掉 `|yellow`）。
     */
    calloutColor?: string;
    /**
     * 条目 id（给了才在头行尾追加「回到原文」深链 `[↩ 回到原文](obsidian://reelludic?…)`，用户 2026-09-19 裁定方案 A；D-3 定为带文字）。
     * 🔴 **必须传 entryId 而不是文件路径**：库外绝对路径会随移动/改名失效（本批要治的断点正是「库外书拿不到 wikilink」）。
     * 高亮镜像**不传**（用户裁定「只新块」）。
     */
    entryId?: string;
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** callout 类型：固定内置 `quote`（见文件头 A1 说明） */
const CALLOUT_TYPE = 'quote';
/** callout 头行：`> [!quote|yellow] 标题`（颜色段可选，大小写不敏感） */
const CALLOUT_HEAD = /^>\s*\[!([A-Za-z]+)(?:\|([^\]]*))?\]\s*(.*)$/;
/**
 * 摘录与想法之间的分隔行（callout 内写作 `> ***`）。
 * 🔴 **必须是 `***` 而不是 `---`**：CommonMark 里「一行文字 + 紧跟一行 `---`」＝ **setext 二级标题**，
 * `---` 会被当成标题下划线吃掉 —— 结果是**原文整段被渲染成标题**（变大变粗、显主题的标题色）
 * 且**分隔线根本不出现**。`***` 是 thematic break，不会触发 setext（Obsidian 论坛同款建议）。
 * （2026-09-19 用户截图实测抓出：上一版写 `---` 时「原文仅加粗」从未以"加粗"形态呈现过。）
 */
const DIVIDER_LINE = '***';
/** 历史分隔符（**只解析、不再写出**）：`---`＝2026-09-19 之前的形态（会触发 setext）；`---div---` 更早 */
const LEGACY_DIVIDERS = ['---', '---div---'];
/** 头行里的块锚点链接：`[[目标#^id|别名]]` */
const WIKILINK_WITH_ID = /\[\[([^\]|#]*)#\^([\w-]+)(?:\|([^\]]*))?\]\]/;
/** 任意 wikilink（无 #^id，手动录入书目链接可能长这样） */
const WIKILINK_ANY = /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/;

/** 生成块 id：prefix + 时间戳(36 进制) + 4 位随机（Obsidian 块 id 全局唯一约定） */
export function generateBlockId(prefix = 'bk'): string {
    let rand = '';
    for (let i = 0; i < 4; i++) rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return `${prefix}${Date.now().toString(36)}${rand}`;
}

/** 分隔行判定：新格式 `***` 与历史 `---` / `---div---` 都算（旧块照旧解析，不迁移） */
function isDivider(text: string): boolean {
    const t = text.trim();
    return t === DIVIDER_LINE || LEGACY_DIVIDERS.includes(t);
}

/** 从 callout 头行标签里还原机器可读定位：`第 N 章` → chapter、`第 N 页` → page、`· N%` → pct */
function locFromLabel(label: string | undefined): { loc?: { chapter: number; pct: number }; page?: number } {
    if (!label) return {};
    const pctM = label.match(/·\s*(\d+)\s*%/);
    const pct = pctM ? Math.max(0, Math.min(100, parseInt(pctM[1], 10))) : undefined;
    const pageM = label.match(/第\s*(\d+)\s*页/);
    const chapterM = label.match(/第\s*(\d+)\s*[章节回卷]/);
    const out: { loc?: { chapter: number; pct: number }; page?: number } = {};
    if (pageM) out.page = parseInt(pageM[1], 10);
    const chapter = chapterM ? Math.max(1, parseInt(chapterM[1], 10)) : pageM ? out.page : undefined;
    if (chapter !== undefined) out.loc = { chapter, pct: pct ?? 0 };
    return out;
}

/** 解析单个块：callout 新格式与扁平旧格式都能读（提取 引用/页码/心得或想法/块 id/定位/样式/颜色） */
export function parseExcerptBlock(md: string): ParsedExcerpt {
    const quote: string[] = [];
    const idea: string[] = [];
    let inIdea = false;
    let page: number | undefined;
    let note: string | undefined;
    let id: string | undefined;
    let loc: { chapter: number; pct: number } | undefined;
    let style: string | undefined;
    let color: string | undefined;
    let label: string | undefined;
    let refLink: string | undefined;

    for (const raw of md.split('\n')) {
        const t = raw.trim();
        const head = t.match(CALLOUT_HEAD);
        if (head) {
            // 先剥掉尾部的「回到原文」深链再解析（否则「无 wikilink」分支会把它当标签文本）
            const title = stripBackLink((head[3] ?? '').trim());
            const withId = title.match(WIKILINK_WITH_ID);
            if (withId) {
                refLink = (withId[1] ?? '').trim() || undefined;
                id = withId[2];
                label = (withId[3] ?? '').trim() || undefined;
            } else {
                const any = title.match(WIKILINK_ANY);
                if (any) {
                    refLink = (any[1] ?? '').trim() || undefined;
                    label = (any[2] ?? '').trim() || undefined;
                } else {
                    label = title || undefined;
                }
            }
            const fromLabel = locFromLabel(label);
            if (fromLabel.loc) loc = fromLabel.loc;
            if (fromLabel.page !== undefined) page = fromLabel.page;
            // callout 配色段（`[!TXT|green]`）原样存回 color：高亮按色渲染靠它，摘抄恒 yellow 时该值无人消费
            const colorToken = (head[2] ?? '').trim().toLowerCase();
            if (colorToken) color = colorToken;
            // 标签尾段「· 划线」＝高亮样式（定位段带 % 故被排除，摘抄的「第 N 章 · 11%」不会误判）
            const styleM = (label ?? '').match(/·\s*([^·\s%]+)\s*$/);
            if (styleM) style = styleM[1];
            continue;
        }
        if (t.startsWith('> ')) {
            const body = t.slice(2);
            if (isDivider(body)) inIdea = true;
            else if (inIdea) idea.push(body);
            else quote.push(stripQuoteBold(body));
        } else if (t.startsWith('>')) {
            const body = t.slice(1);
            if (isDivider(body)) inIdea = true;
            else if (inIdea) idea.push(body);
            else quote.push(stripQuoteBold(body));
        } else if (t.startsWith('^') && /^[\w-]+$/.test(t.slice(1))) {
            id = t.slice(1);
        } else if (t) {
            const cleaned = t.replace(/\*\*/g, '');
            const pm = cleaned.match(/p\.(\d+)|第(\d+)页/);
            if (pm) page = parseInt(pm[1] ?? pm[2], 10);
            const nm = t.match(/心得：\s*([^·\n]+)/);
            if (nm && nm[1].trim()) note = nm[1].trim();
            // 定位：章序:百分比（机器可读，展示层转「第N章 · X%」；无定位旧块不解析）
            const lm = cleaned.match(/定位：(\d+):(\d+)/);
            if (lm) {
                loc = { chapter: Math.max(1, parseInt(lm[1], 10)), pct: Math.max(0, Math.min(100, parseInt(lm[2], 10))) };
            }
            // 高亮样式/颜色（用户 2026-09-16 十四轮）：与定位同行、以「 · 」分隔 → 用非「·」截断
            const sm = cleaned.match(/样式：\s*([^·\s]+)/);
            if (sm) style = sm[1];
            const cm = cleaned.match(/颜色：\s*([^·\s]+)/);
            if (cm) color = cm[1];
        }
    }
    const ideaText = idea.join('\n').trim();
    return {
        quote: quote.join('\n'),
        page,
        note: ideaText || note,
        id,
        loc,
        style,
        color,
        label,
        refLink,
    };
}

/** 切块结果（含块在输入行数组里的下标区间，供删除按区间裁行） */
interface BlockRange {
    lines: string[];
    start: number;
    end: number;
}

/** 区内容切块（新旧两形态混排安全）：
 *  - callout 块：头行起、吃到连续 `>` 行（含 `> ---div---` 与想法行）；块尾紧跟的兜底 `^id` 行
 *    与「空行 + 兜底 `^id`」也并入本块（头行无链接时块 id 靠它落位）
 *  - 扁平块：吃到 `^id` 锚点行收尾（旧数据无锚点时吃到输入末尾）
 *  纯空白块不产出（区首尾空行不算块）。
 */
function splitBlocksWithRange(all: string[]): BlockRange[] {
    const blocks: BlockRange[] = [];
    let cur: string[] = [];
    let start = 0;
    const flush = (endIdx: number) => {
        if (cur.some((l) => l.trim() !== '')) blocks.push({ lines: cur, start, end: endIdx });
        cur = [];
    };
    const isHead = (l: string) => CALLOUT_HEAD.test(l.trim());
    const isIdLine = (l: string) => /^\^[\w-]+$/.test(l.trim());
    for (let i = 0; i < all.length; i++) {
        const line = all[i];
        const t = line.trim();
        if (isHead(line)) {
            flush(i - 1);
            cur = [line];
            start = i;
            continue;
        }
        if (cur.length && isHead(cur[0])) {
            if (t.startsWith('>')) {
                cur.push(line);
                continue;
            }
            if (isIdLine(line)) {
                cur.push(line);
                flush(i);
                continue;
            }
            if (t === '') {
                let j = i + 1;
                while (j < all.length && all[j].trim() === '') j++;
                if (j < all.length && isIdLine(all[j])) {
                    cur.push(line);
                    continue;
                }
            }
            flush(i - 1);
        }
        if (!cur.length) start = i;
        cur.push(line);
        if (isIdLine(line)) flush(i);
    }
    flush(all.length - 1);
    return blocks;
}

/** 区切片：返回「## <section>」标题下一行起的内容行 + 其在原文行数组里的起始下标 */
function sectionSlice(markdown: string, section: string): { offset: number; lines: string[] } | undefined {
    const re = new RegExp(`^##\\s+${escapeSection(section)}\\s*$`);
    const lines = markdown.split('\n');
    const idx = lines.findIndex((l) => re.test(l.trim()));
    if (idx === -1) return undefined;
    const out: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return { offset: idx + 1, lines: out };
}

/**
 * 解析笔记指定「## <section>」区为块列表（无区 → []）。
 * section 缺省 '摘抄'；高亮区传 '高亮'。返回 quote 非空的块。
 */
export function parseExcerptBlocks(markdown: string, section = '摘抄'): ParsedExcerpt[] {
    const slice = sectionSlice(markdown, section);
    if (!slice) return [];
    return splitBlocksWithRange(slice.lines)
        .map((b) => parseExcerptBlock(b.lines.join('\n')))
        .filter((b) => b.quote.trim().length > 0);
}

/** 头行标签：显式 label 优先；否则按定位拼「第 N 章 · P%」（无 loc 但有页码 → 「第 N 页 · P%」）。
 *  ⚠️ PDF 的「页」判定不再依赖来源类型（callout 类型已固定为 quote）—— 有 loc 记章、无 loc 有 page 记页；
 *  将来若补 PDF 写入口，让调用方直接传 label 即可。 */
export function excerptLabel(ex: ParsedExcerpt): string {
    if (ex.label) return ex.label;
    const pct = ex.loc && ex.loc.pct > 0 ? ` · ${ex.loc.pct}%` : '';
    if (ex.loc?.chapter !== undefined) return `第 ${ex.loc.chapter} 章${pct}`;
    if (ex.page !== undefined) return `第 ${ex.page} 页${pct}`;
    return '摘抄';
}

/**
 * 剥掉「整行被 `**` 包住」的那**一层** —— 原文渲染为 `**原文**`（有评语时）后的还原。
 * ⚠️ 只剥一层：原文**内部**自带的加粗（如 `**他说**很重要**吗**`）必须保留。
 * 边界：书名正文里的字面星号极少（正文是纯文本抽取），但像 `***` 这种分隔符长度不足 4 不会误命中。
 */
function stripQuoteBold(line: string): string {
    const m = /^\*\*([\s\S]*)\*\*$/.exec(line);
    return m ? m[1] : line;
}

/** 只加粗（用户 2026-09-19：有评语的摘抄，原文「仅加粗」）：先剥已有的整行加粗再套一层 → **幂等**，重复渲染不会变成 `****`；空行原样返回。 */
function boldOnly(line: string): string {
    return line.trim() ? `**${stripQuoteBold(line)}**` : line;
}

/**
 * 剥掉头行尾部的「回到原文」深链 `[↩](obsidian://reelludic?…)`。
 * 🔴 必须剥：`parseExcerptBlock` 在「头行无 wikilink」时会走 `label = title`，不剥就把整段链接吃进标签
 * （库外书恰好都走这条路）。⛔ **只认本插件的 scheme** —— 头行里用户自己写的普通 markdown 链接要保持原样。
 */
function stripBackLink(title: string): string {
    return title.replace(/\s*\[[^\]]{0,16}\]\(obsidian:\/\/reelludic\?[^)\s]*\)\s*$/i, '').trim();
}

/**
 * 渲染块 Markdown。
 * - 缺省（扁平块，高亮区沿用）：`> 引用` + 空行 + meta 行 + `^id`（缺 id 时自动生成）
 * - `callout: true`（摘抄 / 高亮区，2026-09-17 新格式）：
 *   `> [!quote|黄] [[源文件#^id|标签]]` + `> 摘录…` + `> ---` + `> 想法…`
 *   ⚠️ 头行无 wikilink（拿不到源文件）时，块尾补一行 `^id` —— 否则块 id 无处安放、删除/去重失效。
 */
export function renderExcerptBlock(ex: ParsedExcerpt, opts: ExcerptRenderOptions = {}): string {
    const id = ex.id ?? generateBlockId();
    if (!opts.callout) {
        const parts: string[] = [];
        if (ex.quote) parts.push(ex.quote.split('\n').map((l) => `> ${l}`).join('\n'));
        const meta: string[] = [];
        if (ex.page !== undefined) meta.push(`**p.${ex.page}**`);
        if (ex.note) meta.push(`心得：${ex.note}`);
        if (ex.loc) meta.push(`定位：${ex.loc.chapter}:${ex.loc.pct}`);
        if (ex.style) meta.push(`样式：${ex.style}`);
        if (ex.color) meta.push(`颜色：${ex.color}`);
        if (meta.length) parts.push(meta.join(' · '));
        parts.push(`^${id}`);
        return parts.join('\n\n');
    }
    const label = excerptLabel(ex);
    const title = opts.refLink ? `[[${opts.refLink}#^${id}|${label}]]` : label;
    // 「回到原文」深链（方案 A 双轨：wikilink 保留 + 追加 ↩）。构造失败（entryId 缺失/非法）→ 不产出，头行回到旧形态。
    // D-3：写「↩ 回到原文」而不是纯符号 —— 纯箭头看不出是干什么的。
    const back = opts.entryId ? readerDeepLink(opts.entryId, id) : null;
    const backLink = back ? ` [↩ 回到原文](${back})` : '';
    // D-4：配色段只在显式给了色名时才写（摘抄不传 → `[!quote]` 跟随主题；高亮块靠它按色渲染，不受影响）
    const colorSeg = opts.calloutColor ? `|${opts.calloutColor}` : '';
    const out: string[] = [`> [!${CALLOUT_TYPE}${colorSeg}] ${title}${backLink}`];
    const idea = (ex.note ?? '').trim();
    // 有评语 → 原文**仅加粗**（用户 2026-09-19 裁定方案 1）：原文与评语一眼分得开（此前两者都是普通段落）。
    // 无评语时不加任何标记（原文是整块唯一内容，加了反而多余）。高亮块没有 note → 自然不受影响。
    for (const l of (ex.quote ?? '').split('\n')) out.push(`> ${idea ? boldOnly(l) : l}`);
    if (idea) {
        out.push(`> ${DIVIDER_LINE}`);
        for (const l of idea.split('\n')) out.push(`> ${l}`);
    }
    if (!opts.refLink) out.push('', `^${id}`);
    return out.join('\n');
}

/** section 名转正则安全（中文/连字符等字符转义） */
function escapeSection(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 提取笔记中指定「## <section>」章节内容（不含标题行；到文件尾或下一个二级标题为止），无则 undefined。
 *  section 缺省 '摘抄'（默认行为/既有调用）；高亮复用本模块时传 '高亮'。 */
export function extractExcerptSection(markdown: string, section = '摘抄'): string | undefined {
    const re = new RegExp(`^##\\s+${escapeSection(section)}\\s*$`);
    const lines = markdown.split('\n');
    const idx = lines.findIndex((l) => re.test(l.trim()));
    if (idx === -1) return undefined;
    const out: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        out.push(lines[i]);
    }
    const sec = out.join('\n').trim();
    return sec || undefined;
}

/** 统计指定「## <section>」区内块数。
 *  callout 块按头行计 1；扁平块按 `^id` 锚点计 1（无链接头行的兜底 `^id` 已并回其 callout 块，不重复计）。 */
/** 笔记里全部「划词 / 插入标注区」的名字（顺序 = 两区都不在时的默认追加顺序）。
 *  🔴 **笔记模板重写必须把这些区都搬回去** —— 只搬「摘抄」会把「## 高亮」整区吞掉
 *  （2026-09-18 实测：`writeNote` 之后高亮块全丢 → 正文里还显示着却删不掉、双向溯源断链）。
 *  🔴 **「时间戳」/「截图」同理**（2026-09-19 补，实测漏网）：它们是 #326 插入的**用户数据**，
 *     但**不在笔记模板里** → 一旦条目保存触发 `writeNote` 重写，两区会被整段抹掉（静默丢数据：
 *     笔记里那行时间戳链接凭空消失）。实测证据：用户笔记里只留下**后一次**插入的那条，
 *     且日志里点过的更早那条（`t=430`）在全库都搜不到了。⇒ **新增加入笔记的区段必须同步这里**。 */
export const ANNOTATION_SECTIONS = ['高亮', '摘抄', '时间戳', '截图'] as const;

/** 按旧笔记里的出现顺序抽取标注区的**非空**内容（空区 / 不存在的区不返回）。 */
export function extractAnnotationSections(
    markdown: string,
    sections: readonly string[] = ANNOTATION_SECTIONS,
): { section: string; body: string }[] {
    const found: { section: string; body: string; at: number }[] = [];
    for (const name of sections) {
        const slice = sectionSlice(markdown, name);
        if (!slice) continue;
        const body = slice.lines.join('\n').trim();
        if (!body) continue;
        found.push({ section: name, body, at: slice.offset });
    }
    found.sort((a, b) => a.at - b.at);
    return found.map((f) => ({ section: f.section, body: f.body }));
}

/** 统计指定「## <section>」区内块数。
 *  callout 块按头行计 1；扁平块按 `^id` 锚点计 1（无链接头行的兜底 `^id` 已并回其 callout 块，不重复计）。 */
export function countExcerpts(markdown: string, section = '摘抄'): number {
    const slice = sectionSlice(markdown, section);
    if (!slice) return 0;
    return splitBlocksWithRange(slice.lines).length;
}

/** 合并写入策略 C：把「## <section>」区并入模板——插到「观看链接/相关链接」章节之前（G3 约定：摘抄区在个人评语后、链接前）；
 *  模板无链接章节则追加末尾；空区返回模板原样。section 缺省 '摘抄'。 */
export function mergeExcerptSection(templateMd: string, excerptSection: string, section = '摘抄'): string {
    const trimmed = excerptSection.trim();
    if (!trimmed) return templateMd;
    const lines = templateMd.split('\n');
    const linkIdx = lines.findIndex((l) => /^##\s+(观看链接|相关链接)\s*$/.test(l.trim()));
    const block = ['', `## ${section}`, '', ...trimmed.split('\n')];
    if (linkIdx === -1) {
        return lines.join('\n').replace(/\n+$/, '') + '\n' + block.join('\n') + '\n';
    }
    const before = lines.slice(0, linkIdx).join('\n').replace(/\s+$/, '');
    const after = lines.slice(linkIdx).join('\n');
    return before + '\n' + block.join('\n') + '\n' + after;
}

/**
 * 把「## <section>」区**整区替换**为给定内容（高亮镜像重写用：镜像由 JSON 单向生成，每次全量重写，不做增量追加）。
 * - 无该区：`body` 非空 → 先按 `mergeExcerptSection` 同规则新建（插入位置只有那一条真源），
 *   再走一遍本函数把排版**规范化** —— 否则「首次插入（merge 排版：下一个标题前不留空行）」与
 *   「后续替换（规范排版：留一个空行）」差一个空行 → 第二次同步又会白写一遍笔记；空 body → 原样返回
 * - 有该区：连标题带内容整体换成新内容；`body` 为空串 → **整区删除**
 * - 结果与原文逐字符相同 → 原样返回（调用方据此跳过磁盘写入，避免「打开即写」）
 */
export function replaceAnnotationSection(markdown: string, section: string, body: string): string {
    const next = body.trim();
    const slice = sectionSlice(markdown, section);
    if (!slice) {
        if (!next) return markdown;
        return replaceAnnotationSection(mergeExcerptSection(markdown, next, section), section, next);
    }
    const lines = markdown.split('\n');
    const headIdx = slice.offset - 1; // 「## <section>」标题行
    const endIdx = slice.offset + slice.lines.length; // 区内容结束后第一行（下一个二级标题或文末）
    const before = lines.slice(0, headIdx);
    const after = lines.slice(endIdx);
    if (!next) {
        // 删区：标题与内容一起切掉，并压掉切除处留下的多余空行（与 removeExcerptBlockByQuote 同口径）
        return [...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n');
    }
    const out = [...before, `## ${section}`, '', ...next.split('\n'), '', ...after].join('\n');
    return out === markdown ? markdown : out;
}

/** 向笔记追加一条块（摘抄/高亮共用）：已有「## <section>」区则区内追加（原块保留），无则插入到链接章节之前；空内容返回原样。section 缺省 '摘抄'。 */
export function appendExcerptToNote(noteMd: string, excerptMd: string, section = '摘抄'): string {
    const trimmed = excerptMd.trim();
    if (!trimmed) return noteMd;
    const sec = extractExcerptSection(noteMd, section);
    const newSec = sec ? sec + '\n\n' + trimmed : trimmed;
    const lines = noteMd.split('\n');
    const re = new RegExp(`^##\\s+${escapeSection(section)}\\s*$`);
    const idx = lines.findIndex((l) => re.test(l.trim()));
    if (idx !== -1) {
        const before = lines.slice(0, idx + 1).join('\n');
        const after = lines.slice(idx + 1);
        let j = 0;
        while (j < after.length && !/^##\s/.test(after[j])) j++;
        const rest = after.slice(j).join('\n');
        return before + '\n' + newSec + (rest ? '\n\n' + rest : '') + '\n';
    }
    return mergeExcerptSection(noteMd, newSec, section);
}

/**
 * 从笔记删除指定块（按块 id 匹配）。
 *  - callout 块（新）：id 在头行链接锚点 `[[…#^id|…]]` 上 → 整块 = 头行 + 后续连续 `>` 行（含兜底 `^id` 行）
 *  - 扁平块（旧）：id 是独立 `^id` 行 → 从该行向上到空行/章节标题、向下到空行
 * 块不存在/空 id 返回原笔记原样。
 */
export function removeExcerptBlock(noteMd: string, blockId: string): string {
    const id = blockId.startsWith('^') ? blockId.slice(1) : blockId;
    if (!id || !noteMd) return noteMd;
    const lines = noteMd.split('\n');
    const headRe = new RegExp(`#\\^${id}(?=[|\\]])`);
    const idLine = `^${id}`;
    const idIdx = lines.findIndex((l) => (l.includes('#^') && headRe.test(l)) || l.trim() === idLine);
    if (idIdx === -1) return noteMd;
    // 只在本块所在的二级区块内切块 —— 否则切块会从上一个「块尾标记」一路吃到文件头（区标题与模板行会被当成本块）
    let secStart = 0;
    for (let i = idIdx - 1; i >= 0; i--) {
        if (/^##\s/.test(lines[i])) {
            secStart = i + 1;
            break;
        }
    }
    let secEnd = lines.length - 1;
    for (let i = secStart; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) {
            secEnd = i - 1;
            break;
        }
    }
    // 与解析同一套切块规则 → 新旧两形态都能整块裁掉（旧实现按空行上下推定，会在「引用 + 空行 + ^id」时漏删引用行）
    const hit = splitBlocksWithRange(lines.slice(secStart, secEnd + 1)).find((b) =>
        b.lines.some((l) => (l.includes('#^') && headRe.test(l)) || l.trim() === idLine),
    );
    if (!hit) return noteMd;
    const start = secStart + hit.start;
    let end = secStart + hit.end;
    // 连带吃掉块尾紧邻空行（块间分隔），避免删完残留多余空行
    while (end + 1 < lines.length && lines[end + 1].trim() === '') end++;
    const removed = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');
    return removed.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}
