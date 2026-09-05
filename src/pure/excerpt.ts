// 摘抄纯逻辑（无 obsidian 依赖，可单测）
// 摘抄块 Markdown 格式（书目笔记「## 摘抄」区内）：
//   > 引用文本（可多行 blockquote）
//   （空行）
//   **p.128** · 心得：xxx · 定位：1:42   ← 页码/心得/定位行（均可选；定位=章序:百分比，阅读器锚点跳转用）
//   ^bk001a                    ← 块 id 锚点（Obsidian block reference）

export interface ParsedExcerpt {
    quote: string;
    page?: number;
    note?: string;
    id?: string;
    /** 原书定位：chapter 从 1 计，pct 0-100 整数（阅读器书签跳转/笔记溯源用；旧摘抄无此字段） */
    loc?: { chapter: number; pct: number };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 生成块 id：prefix + 时间戳(36 进制) + 4 位随机（Obsidian 块 id 全局唯一约定） */
export function generateBlockId(prefix = 'bk'): string {
    let rand = '';
    for (let i = 0; i < 4; i++) rand += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return `${prefix}${Date.now().toString(36)}${rand}`;
}

/** 解析单个摘抄块：提取 引用（blockquote 行合并）/ 页码 / 心得 / 块 id / 定位 */
export function parseExcerptBlock(md: string): ParsedExcerpt {
    const quote: string[] = [];
    let page: number | undefined;
    let note: string | undefined;
    let id: string | undefined;
    let loc: { chapter: number; pct: number } | undefined;

    for (const raw of md.split('\n')) {
        const t = raw.trim();
        if (t.startsWith('> ')) {
            quote.push(t.slice(2));
        } else if (t.startsWith('>')) {
            quote.push(t.slice(1));
        } else if (t.startsWith('^') && /^[\w-]+$/.test(t.slice(1))) {
            id = t.slice(1);
        } else if (t) {
            const cleaned = t.replace(/\*\*/g, '');
            const pm = cleaned.match(/p\.(\d+)|第(\d+)页/);
            if (pm) page = parseInt(pm[1] ?? pm[2], 10);
            const nm = t.match(/心得：(.+)/);
            if (nm && nm[1].trim()) note = nm[1].trim();
            // 定位：章序:百分比（机器可读，展示层转「第N章 · X%」；无定位旧块不解析）
            const lm = cleaned.match(/定位：(\d+):(\d+)/);
            if (lm) {
                loc = { chapter: Math.max(1, parseInt(lm[1], 10)), pct: Math.max(0, Math.min(100, parseInt(lm[2], 10))) };
            }
        }
    }
    return { quote: quote.join('\n'), page, note, id, loc };
}

/**
 * 解析笔记指定「## <section>」区为块列表（无区 → []）。
 * 切块：按 ^id 锚点行分段（块内 quote 与 meta 间也有空行，不能按空行切；一区块都以 ^id 收尾）。
 * section 缺省 '摘抄'；高亮区传 '高亮'。返回 quote 非空的块。
 */
export function parseExcerptBlocks(markdown: string, section = '摘抄'): ParsedExcerpt[] {
    const sec = extractExcerptSection(markdown, section);
    if (!sec) return [];
    const blocks: string[] = [];
    let cur: string[] = [];
    for (const line of sec.split('\n')) {
        cur.push(line);
        if (/^\^[\w-]+$/.test(line.trim())) {
            blocks.push(cur.join('\n'));
            cur = [];
        }
    }
    if (cur.some((l) => l.trim())) blocks.push(cur.join('\n'));
    return blocks.map(parseExcerptBlock).filter((b) => b.quote.trim().length > 0);
}

/** 渲染摘抄块 Markdown（缺 id 时自动生成；有定位时 meta 行追加「· 定位：N:N」） */
export function renderExcerptBlock(ex: ParsedExcerpt): string {
    const id = ex.id ?? generateBlockId();
    const parts: string[] = [];
    if (ex.quote) parts.push(ex.quote.split('\n').map((l) => `> ${l}`).join('\n'));
    const meta: string[] = [];
    if (ex.page !== undefined) meta.push(`**p.${ex.page}**`);
    if (ex.note) meta.push(`心得：${ex.note}`);
    if (ex.loc) meta.push(`定位：${ex.loc.chapter}:${ex.loc.pct}`);
    if (meta.length) parts.push(meta.join(' · '));
    parts.push(`^${id}`);
    return parts.join('\n\n');
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

/** 统计指定「## <section>」区内 ^id 锚点块数（按区内 ^id 锚点行计数；区外不计） */
export function countExcerpts(markdown: string, section = '摘抄'): number {
    const sec = extractExcerptSection(markdown, section);
    if (!sec) return 0;
    return sec.split('\n').filter((l) => /^\^[\w-]+$/.test(l.trim())).length;
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
 * 从笔记删除指定摘抄块（按块 id 匹配 ^id 锚点行所在块：从该行向上到空行/章节标题为块头，向下到空行为块尾）。
 * 块不存在/空 id 返回原笔记原样。
 */
export function removeExcerptBlock(noteMd: string, blockId: string): string {
    const id = blockId.startsWith('^') ? blockId.slice(1) : blockId;
    if (!id || !noteMd) return noteMd;
    const lines = noteMd.split('\n');
    let idIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === `^${id}`) {
            idIdx = i;
            break;
        }
    }
    if (idIdx === -1) return noteMd;
    // 块头：从 id 行向上越过非空行（引用/页码行），到空行或「## 」标题为止
    let start = idIdx;
    while (start > 0 && lines[start - 1].trim() !== '' && !/^##\s/.test(lines[start - 1])) start--;
    // 块尾：id 行向下到空行为止
    let end = idIdx;
    while (end + 1 < lines.length && lines[end + 1].trim() !== '') end++;
    // 移除块 + 规整多余空行（块间最多保留一个空行）
    const removed = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');
    return removed.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n');
}
