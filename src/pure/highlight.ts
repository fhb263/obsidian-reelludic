// 阅读器高亮纯模型（纯逻辑，无 obsidian 依赖，可单测）。
// 🔴 真源（2026-09-18 起）：高亮存**每本书的 JSON 存档**（`pure/readerStore`，字段与进度/书签三合一），
//    **不再写进书目笔记**。笔记里的 `## 高亮` 区改为由 JSON **单向生成的只读镜像**（保住 Obsidian 搜索/导出/反链），
//    用户手改会被下次生成覆盖 —— 高亮 CRUD 一律经 `readerStore`，不得再出现「写笔记」的调用形态。
// 本模块保留：类型与档位/颜色、markdown 渲染（镜像生成用 `renderHighlightBlock`）、
//    笔记解析（**仅一次性迁移用** `parseHighlightBlocks`）、以及页内黄标渲染与判定（`markParagraphHtml` 等）。

import {
    parseExcerptBlocks,
    renderExcerptBlock,
    generateBlockId,
    type ParsedExcerpt,
} from 'pure/excerpt';
import { compactText, locateQuoteSpan } from 'pure/anchor';

/** 笔记「## 高亮」区标题（与「## 摘抄」并列） */
export const HIGHLIGHT_SECTION = '高亮';

/** 高亮样式（用户 2026-09-16 十四轮）：底色高亮 / 下划线 / 波浪线 */
export type HlStyle = 'hl' | 'underline' | 'wavy';
/** 高亮颜色：红 / 黄 / 绿 / 蓝 / 紫（用户 2026-09-16 十五轮：按参考图扩为五色） */
export type HlColor = 'red' | 'yellow' | 'green' | 'blue' | 'purple';

/** 旧档位别名（上一轮的「粉」按紫渲染；笔记里可能仍是「颜色：粉」→ append-only 兼容） */
const HL_COLOR_ALIAS: Record<string, HlColor> = { pink: 'purple', 粉: 'purple' };

/** 读别名：**必须 hasOwnProperty 守卫** —— {} 的 'constructor'/'toString' 等键会穿透原型链返回真值（本项目既有纪律） */
function hlColorAlias(v: unknown): HlColor | undefined {
    if (typeof v !== 'string') return undefined;
    return Object.prototype.hasOwnProperty.call(HL_COLOR_ALIAS, v) ? HL_COLOR_ALIAS[v] : undefined;
}

/** 样式档位（顺序即 UI 顺序） */
export const HL_STYLES: { id: HlStyle; label: string }[] = [
    { id: 'hl', label: '高亮' },
    { id: 'underline', label: '划线' },
    { id: 'wavy', label: '波浪' },
];

/** 颜色档位（顺序即 UI 顺序） */
export const HL_COLORS: { id: HlColor; label: string }[] = [
    { id: 'red', label: '红' },
    { id: 'yellow', label: '黄' },
    { id: 'green', label: '绿' },
    { id: 'blue', label: '蓝' },
    { id: 'purple', label: '紫' },
];

export const DEFAULT_HL_STYLE: HlStyle = 'hl';
export const DEFAULT_HL_COLOR: HlColor = 'yellow';

/**
 * 高亮色值（唯一真源）：`styles.css` 的 `.rl-hl-persist[data-color=…]` 规则与
 * `highlightMarkCss()` 生成的注入式 CSS 必须用同一组值 —— 产物断言会逐个校验两处一致。
 */
export const HL_COLOR_HEX: Record<HlColor, string> = {
    red: '#e8665a',
    yellow: '#e8b93f',
    green: '#58c072',
    blue: '#5aa2e8',
    purple: '#9a7ae0',
};

/**
 * 高亮 mark 的注入式 CSS（供**独立文档**上下文使用）。
 *
 * 🔴 为什么需要它：EPUB 正文跑在 `srcdoc` iframe 里，是**独立文档**，插件 `styles.css` 不会级联进去。
 *    十四轮加「三样式 × 五色」时只改了 `styles.css`、漏了 iframe 注入这一份 → EPUB 里所有高亮
 *    退化成浏览器对 `<mark>` 的默认黄底（用户 2026-09-17 实测报障：「始终是默认黄色，也没有划线波浪线」）。
 *    `EpubReaderModal.buildFrameCss()` 直接拼这个返回值；`refreshTheme()` 重设样式表时也走它，
 *    所以修复必须落在本函数（在别处另注入一个 `<style>` 会被主题切换覆盖掉）。
 */
export function highlightMarkCss(): string {
    const fallback = HL_COLOR_HEX[DEFAULT_HL_COLOR];
    const colors = HL_COLORS.map(
        (c) => `.rl-hl-persist[data-color="${c.id}"]{--rl-hl-c:${HL_COLOR_HEX[c.id]};}`,
    ).join('');
    // 🔴 mark 是行内盒：本串内**不得出现 padding / border** —— 会参与行内布局，导致「高亮后同行的后续
    //    文字整体位移 2px」（用户 2026-09-18 报障，无头实测 +2px；与 styles.css 同源两处必须一致）。
    //    划线样式一律走 text-decoration（不占布局），禁用 border-bottom。
    // 🔴 `color:inherit` 必须显式给（2026-09-18 实证）：`<mark>` 的 UA 默认色是 `MarkText`（纯黑），
    //    独立文档里更没有任何核心规则来覆写 → 深色主题下划线 / 波浪的黑字压在深底上直接看不见。
    //    高亮只加底色 / 划线、不改文字颜色 → inherit（跟随 body 注入色）。与 styles.css 同源两处必须一致。
    return (
        colors +
        `.rl-hl-persist{color:inherit;background:color-mix(in srgb, var(--rl-hl-c, ${fallback}) 42%, transparent);border-radius:2px;}` +
        `.rl-hl-persist[data-style="underline"]{background:transparent;border-radius:0;text-decoration-line:underline;text-decoration-thickness:2px;text-decoration-color:var(--rl-hl-c, ${fallback});text-underline-offset:3px;}` +
        `.rl-hl-persist[data-style="wavy"]{background:transparent;border-radius:0;text-decoration:underline wavy var(--rl-hl-c, ${fallback});text-underline-offset:3px;}`
    );
}

/** 归一：非法值/脏数据一律回退默认（数组 includes 而非 `in`，防原型链键名穿透） */
export function normalizeHlStyle(v: unknown): HlStyle {
    return HL_STYLES.some((s) => s.id === v) ? (v as HlStyle) : DEFAULT_HL_STYLE;
}

export function normalizeHlColor(v: unknown): HlColor {
    const alias = hlColorAlias(v);
    if (alias) return alias;
    return HL_COLORS.some((c) => c.id === v) ? (v as HlColor) : DEFAULT_HL_COLOR;
}

/** 档位 → 笔记里写的中文标签 */
export function hlStyleLabel(s: HlStyle): string {
    return HL_STYLES.find((x) => x.id === s)?.label ?? HL_STYLES[0].label;
}

export function hlColorLabel(c: HlColor): string {
    return HL_COLORS.find((x) => x.id === c)?.label ?? HL_COLORS[0].label;
}

/** 笔记里的中文标签 → 档位（容忍英文 id / 大小写 / 空白；认不出 → 默认） */
export function parseHlStyleLabel(v: string | undefined): HlStyle {
    const t = (v ?? "").trim();
    const byLabel = HL_STYLES.find((x) => x.label === t);
    if (byLabel) return byLabel.id;
    const lower = t.toLowerCase();
    return HL_STYLES.some((x) => x.id === lower) ? (lower as HlStyle) : DEFAULT_HL_STYLE;
}

export function parseHlColorLabel(v: string | undefined): HlColor {
    const t = (v ?? "").trim();
    const byLabel = HL_COLORS.find((x) => x.label === t);
    if (byLabel) return byLabel.id;
    const lower = t.toLowerCase();
    const alias = hlColorAlias(lower);
    if (alias) return alias;
    return HL_COLORS.some((x) => x.id === lower) ? (lower as HlColor) : DEFAULT_HL_COLOR;
}

/** 阅读器高亮条目（语义：页内持久标记的选段；形状与 ParsedExcerpt 一致，chapter/pct 为定位） */
export interface ReaderHighlight {
    /** 选中文本（blockquote 内容，多行合并为 \n） */
    quote: string;
    /** 块 id（^hl…，不含 ^） */
    id?: string;
    /** 原书定位：chapter 1 基 + pct 0-100（用于按章渲染黄标 + 跳转） */
    loc?: { chapter: number; pct: number };
    /** 样式（缺省＝底色高亮；旧数据无此字段） */
    style?: HlStyle;
    /** 颜色（缺省＝黄；旧数据无此字段） */
    color?: HlColor;
}

/** 从 ParsedExcerpt 收窄为高亮条目（只取 quote/id/loc；页码/心得高亮不用但保留引用字段以兼容删除定位） */
function toHighlight(ex: ParsedExcerpt): ReaderHighlight {
    return {
        quote: ex.quote,
        id: ex.id,
        loc: ex.loc,
        style: parseHlStyleLabel(ex.style),
        color: parseHlColorLabel(ex.color),
    };
}

/**
 * 从书目笔记 markdown 提取全部高亮块（「## 高亮」区逐块解析；无区/无块 → []）。
 * 解析复用 parseExcerptBlocks（块格式与摘抄一致，按 ^hl id 锚点切块）。
 * ⚠️ 自 2026-09-18 起高亮真源是 JSON 存档（`pure/readerStore`），本函数**只用于一次性迁移**：
 *    把历史笔记里的高亮读进 JSON。迁移完成后笔记里那份是 JSON 单向生成的只读镜像。
 */
export function parseHighlightBlocks(noteMd: string): ReaderHighlight[] {
    // 跳过镜像区首行提示（`%%…%%` 注释）：它不是高亮块，但会被切块器当成一个「扁平块」解析出非空 quote。
    // 少了这道过滤，「镜像已生成 → 用户删掉 JSON → 再次迁移」就会把提示行当成一条高亮搬进 JSON。
    return parseExcerptBlocks(noteMd, HIGHLIGHT_SECTION)
        .filter((ex) => !ex.quote.trim().startsWith('%%'))
        .map(toHighlight);
}

/**
 * 归一化高亮数组（**JSON 存档的唯一入口**，与 `renderHighlightBlock` 的 markdown 口径分家）。
 * 逐项规则：
 *  - 非对象、`quote` 去首尾空白后为空 → **整条跳过**（空引用无法渲染也无法定位）；
 *  - `loc` 非法（chapter 非整数/<1、pct 非有限数值/越界）→ **丢 loc 留 quote**（loc 只服务跨章跳转，
 *    丢了不影响按引用文本渲染黄标）；
 *  - `style`/`color` **原数据没有就不写**（缺省语义由渲染端 `?? 默认档位` 兜底，省字段也顺带兼容旧档）；
 *    有但认不出 → 回退默认档位（`normalizeHlStyle`/`normalizeHlColor`）；
 *  - `id` 仅非空字符串保留（供阅读器删除定位）。
 */
export function normalizeHighlights(raw: unknown): ReaderHighlight[] {
    if (!Array.isArray(raw)) return [];
    const out: ReaderHighlight[] = [];
    for (const item of raw) {
        const o = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
        if (!o) continue;
        const quote = typeof o.quote === 'string' ? o.quote.trim() : '';
        if (!quote) continue;
        const hl: ReaderHighlight = { quote };
        if (typeof o.id === 'string' && o.id !== '') hl.id = o.id;
        const loc = normalizeHlLoc(o.loc);
        if (loc) hl.loc = loc;
        if (o.style !== undefined) hl.style = normalizeHlStyle(o.style);
        if (o.color !== undefined) hl.color = normalizeHlColor(o.color);
        out.push(hl);
    }
    return out;
}

/** 高亮定位归一（chapter 1 基整数 + pct 0-100 有限数值才成立，否则判为「无定位」） */
function normalizeHlLoc(raw: unknown): { chapter: number; pct: number } | null {
    const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
    if (!o) return null;
    if (typeof o.chapter !== 'number' || !Number.isInteger(o.chapter) || o.chapter < 1) return null;
    if (typeof o.pct !== 'number' || !Number.isFinite(o.pct) || o.pct < 0 || o.pct > 100) return null;
    return { chapter: o.chapter, pct: o.pct };
}

/** 取某章的高亮（渲染黄标用）：loc.chapter === chapter；无 loc 的高亮不归入任何章（渲染时跳过） */
export function chapterHighlights(list: ReaderHighlight[], chapter: number): ReaderHighlight[] {
    return list.filter((h) => h.loc?.chapter === chapter);
}

/**
 * 在正文段落文本里定位高亮 quote 的命中片段（忽略空白差异，取首个命中）。
 * 返回命中片段覆盖的原文 [start,end) 字符偏移；无命中 → null。
 * 用于页内持久黄标：按偏移把命中片段包 <mark>（TXT 段落流与 EPUB iframe 共用）。
 */
export function findQuoteSegment(text: string, quote: string): { start: number; end: number } | null {
    // 单块特例：定位核心（去空白归一 + 偏移映射）在 pure/anchor，避免两处实现同一套算法
    const hit = locateQuoteSpan([text], quote);
    const r = hit?.ranges[0];
    return r ? { start: r.start, end: r.end } : null;
}

/** 渲染一条高亮块 markdown（2026-09-17 起与摘抄同款 callout，类型固定内置 `quote`）：
 *  头行 `> [!quote|颜色] [[源文件#^hl…|第 N 章 · P% · 样式]]` + `> 引用`。
 *  - 颜色 → callout 配色段（Obsidian 色名：颜色档位 id 本身就是合法色名）
 *  - 样式 → 标签尾段（`· 划线` / `· 波浪`；默认「高亮」省略，解析端缺省即高亮）
 *  - 定位 → 标签正文（`第 N 章` + `· P%`），解析端由标签还原 loc；**无 loc（手改/脏 JSON 的高亮）→ 标签只写「高亮」**
 *  - 块 id 嵌在头行链接锚点；拿不到源文件（refLink 缺省）时由 renderExcerptBlock 在块尾补 `^id` 兜底
 */
export function renderHighlightBlock(
    quote: string,
    loc?: { chapter: number; pct: number },
    style?: string,
    color?: string,
    opts: { refLink?: string; id?: string } = {},
): string {
    const q = quote?.trim();
    if (!q) return '';
    const st = normalizeHlStyle(parseHlStyleLabel(style));
    const co = normalizeHlColor(parseHlColorLabel(color));
    const stLabel = hlStyleLabel(st);
    const pct = loc && loc.pct > 0 ? ` · ${loc.pct}%` : '';
    const label = (loc ? `第 ${loc.chapter} 章${pct}` : '高亮') + (stLabel === HL_STYLES[0].label ? '' : ` · ${stLabel}`);
    return renderExcerptBlock(
        {
            quote: q,
            loc,
            id: opts.id ?? generateBlockId('hl'),
            style: stLabel,
            color: hlColorLabel(co),
            label,
        },
        { callout: true, refLink: opts.refLink, calloutColor: co },
    );
}

/** 镜像区首行提示（Obsidian 注释语法：阅读视图不渲染，源码里可见；迁移解析端按 `%%` 前缀跳过） */
export const HL_MIRROR_NOTICE = '%% 本区由 ReelLudic 从阅读数据自动生成，手动修改会在下次高亮变更时被覆盖 %%';

/**
 * 生成笔记「## 高亮」区的**内容**（不含 `## 高亮` 标题行）—— 只读镜像，由 JSON 存档单向生成：
 * 首行提示 + 逐条 callout 块（块 id 沿用 JSON 里的 `^hl…`，双向溯源/删除定位都靠它）。
 * 无高亮 → 空串（调用方据此把整区删掉，而不是留一个空标题）。
 */
export function renderHighlightMirror(highlights: ReaderHighlight[], opts: { refLink?: string } = {}): string {
    const blocks = highlights
        .map((h) => renderHighlightBlock(h.quote, h.loc, h.style, h.color, { refLink: opts.refLink, id: h.id }))
        .filter((b) => b !== '');
    if (blocks.length === 0) return '';
    return [HL_MIRROR_NOTICE, '', blocks.join('\n\n')].join('\n');
}


/** 选段是否落在高亮 mark 上 → 命中时返回该 mark 的块 id 与引用文本。
 *  `id === ''` 表示**确实落在 mark 上、但块缺 `^id`**（老数据 / 手写笔记）→ 调用方用 quote 兜底删。
 *  返回 `null` 表示选段**没有高亮样式**（动作条垃圾桶据此不显示）。 */
export interface HlMarkTarget {
    id: string;
    quote: string;
}

/**
 * 判断若干选区端点节点里**是否有一个落在高亮 mark 内**，命中即返回该 mark 的块 id + 引用文本。
 *
 * 🔴 为什么用 DOM 判据、而不是「高亮清单里文本匹配」：清单只说明「笔记里有这条高亮」，
 *    用户看到的是**屏幕上有没有样式**，两者可能不一致（清单有记录、本段却没画出 mark）——
 *    用户 2026-09-18 明确要求「选中没有样式的文字不要显示垃圾桶」。
 *
 * 参数按优先级给（阅读器传 `[range.startContainer, range.endContainer]`）：
 * 节点自身是 mark、或祖先里有 mark，即算命中；两端命中不同 mark 时取先给的（起点侧）。
 */
export function hlMarkTargetOf(...nodes: (Node | null | undefined)[]): HlMarkTarget | null {
    for (const n of nodes) {
        if (!n) continue;
        const el = (n.nodeType === 1 ? n : n.parentElement) as Element | null;
        const mark = el?.closest?.('mark.rl-hl-persist') ?? null;
        if (!mark) continue;
        return { id: mark.getAttribute('data-hl-id') ?? '', quote: (mark.textContent ?? '').trim() };
    }
    return null;
}
/** 段落 HTML 转义（纯函数内部用；与两阅读器此前的内联实现同口径） */
function escapeParaHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 章节**单个段落**的高亮重绘 —— 返回该段应写入的 innerHTML，`null` = 这段无需改动。
 * TXT 段落流与 EPUB iframe **共用同一份实现**（此前两处各抄一份，改一处漏一处）。
 *
 * 规则：按段纯文本收集本章高亮的命中区间 → 按偏移重建段落 HTML（文本转义 + 区间包 `<mark>`）；
 * 用区间重建而非 DOM Range 包裹，天然支持同段多个高亮且不嵌套。
 *
 * 🔴 「没命中的段落」也必须管（2026-09-18 用户报障的根因）：
 *   删除一条高亮后，若该段已不再有任何命中，必须把段内**残留的 `<mark>` 摊平回纯文本**。
 *   旧实现是 `if (segs.length === 0) continue;` —— 直接跳过该段，于是**刚删掉的那条高亮
 *   在屏幕上还留着**（提示「已删除 1 条」，正文却纹丝不动，切章/重排后才消失）。
 *   只有「本章高亮被删空」时才走了摊平分支，所以这个坑只在「删一条、本章还剩别的高亮」时露出。
 *
 * @param plain         段落纯文本（调用方传 `p.textContent`）
 * @param hls           本章高亮（调用方已按 loc.chapter 过滤）
 * @param hasStaleMark  该段当前是否已含 `<mark class="rl-hl-persist">`（调用方查 DOM 得出；
 *                      为真且本段无命中 → 返回摊平后的文本，绝不返回 null 把残影留在屏幕上）
 */
export function markParagraphHtml(
    plain: string,
    hls: ReaderHighlight[],
    hasStaleMark: boolean,
): string | null {
    const segs: { start: number; end: number; id?: string; style?: HlStyle; color?: HlColor }[] = [];
    for (const hl of hls) {
        const seg = findQuoteSegment(plain, hl.quote);
        if (seg) segs.push({ ...seg, id: hl.id, style: hl.style, color: hl.color });
    }
    if (segs.length === 0) {
        // 无命中：段内残留旧 mark（= 刚被删掉的那条）→ 摊平成纯文本；本来就干净 → 不动（null）
        return hasStaleMark ? escapeParaHtml(plain) : null;
    }
    segs.sort((a, b) => a.start - b.start);
    // 互相重叠/包含的区间只保留先命中者（正常每段每 quote 最多命中一次）
    const kept: typeof segs = [];
    for (const s of segs) {
        if (kept.some((k) => s.start < k.end && s.end > k.start)) continue;
        kept.push(s);
    }
    let html = '';
    let pos = 0;
    for (const k of kept) {
        const s = Math.max(pos, k.start);
        const e = Math.min(plain.length, k.end);
        if (e <= s) continue;
        html += escapeParaHtml(plain.slice(pos, s));
        const idAttr = k.id ? ` data-hl-id="${escapeParaHtml(k.id)}"` : '';
        const styleAttr = ` data-style="${k.style ?? DEFAULT_HL_STYLE}" data-color="${k.color ?? DEFAULT_HL_COLOR}"`;
        html += `<mark class="rl-hl-persist"${idAttr}${styleAttr}>${escapeParaHtml(plain.slice(s, e))}</mark>`;
        pos = e;
    }
    html += escapeParaHtml(plain.slice(pos));
    return html;
}

/** 归一文本（去全部空白），用于高亮 quote 是否同一段的比对（忽略换行/空格差异） */
export function normText(s: string): string {
    return compactText(s).text;
}

/**
 * 在给定章的高亮列表里查是否已存在"同一段文本"的高亮（去空白归一比对）。
 * 用于标注模式的 toggle：命中 → 取消该条；未命中 → 新增。返回命中的高亮条目（含 id）或 null。
 */
export function findSameHighlight(list: ReaderHighlight[], quote: string, chapter: number): ReaderHighlight | null {
    const q = normText(quote);
    if (!q) return null;
    for (const h of list) {
        if (h.loc?.chapter === chapter && normText(h.quote) === q) return h;
    }
    return null;
}

/**
 * 在给定列表里按「同一段文本」（去空白归一）定位一条条目 —— 供动作条垃圾桶删除既有摘抄用。
 * 给了 chapter 时优先同章命中；同章无命中则退化为全局命中（读者可能跨章重复摘抄同一句）。
 */
export function findSameExcerpt<T extends { quote: string; id?: string; loc?: { chapter: number } }>(
    list: T[],
    quote: string,
    chapter?: number,
): T | null {
    const q = normText(quote);
    if (!q) return null;
    const same = list.filter((x) => normText(x.quote) === q);
    if (same.length === 0) return null;
    if (chapter !== undefined) {
        const inCh = same.find((x) => x.loc?.chapter === chapter);
        if (inCh) return inCh;
    }
    return same[0];
}

/**
 * 高亮 toggle 决策结果：
 *  - `add`：未命中同文本高亮 → 新增；
 *  - `remove`：命中且有块 id → 删除该条；
 *  - `blocked`：命中但**缺块 id**（老数据 / 手写笔记的块没有 `^hl…` 行）→ 无法定位删除，
 *    面板应提示手动处理；**不得退化成「再新增一条重复高亮」**（2026-09-16 用户报
 *    「能高亮、不能再次选中删除」的边界形态：此时旧逻辑会静默追加重复条目，越点越多）。
 */
export type HighlightToggleDecision =
    | { action: 'add'; add: ReaderHighlight }
    | { action: 'remove'; id: string }
    | { action: 'blocked' };

/**
 * 高亮 toggle 决策：返回决策对象，供面板执行。
 * 选中文字在"当前章已有高亮"→ remove（有 id）/ blocked（缺 id）；否则 add。封装使纯逻辑可测、面板只消费结果。
 */
export function decideHighlightToggle(
    list: ReaderHighlight[],
    quote: string,
    loc: { chapter: number; pct: number },
): HighlightToggleDecision {
    const same = findSameHighlight(list, quote, loc.chapter);
    if (same) {
        if (same.id) return { action: 'remove', id: same.id };
        return { action: 'blocked' };
    }
    // 未命中 → 新增（id 由宿主 onHighlight 生成后回填）
    return { action: 'add', add: { quote: quote.trim(), loc } };
}
