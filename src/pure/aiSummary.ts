/**
 * AI 摘要（一句话总结 + 核心看点）纯逻辑（无 obsidian 依赖，可单测）
 *
 * 责任：把条目元数据组装成 chat/completions 请求体（prompt 设计在此）、解析模型返回的 JSON、
 * 以及「看点数组 ↔ 表单多行框」的互转。网络请求与 Key 注入由 services/aiSummary.ts 完成。
 *
 * prompt 可在设置页「AI 翻译与总结 → 服务提示词」覆盖（留空/改回默认文本即用 DEFAULT_SUMMARY_PROMPT）；
 * 默认 prompt 设计要点（避免模型自由发挥）：
 *  - 一句话总结 ≤40 字，只讲「是什么 + 最突出特点」，禁剧透结局、禁「本片讲述了」套话；
 *  - 核心看点 3 条、每条 ≤20 字、以具体名词短语开头，禁「值得一看 / 非常精彩」空泛评价；
 *  - 信息不足时宁可克制，**不得编造**具体情节或人物；
 *  - 只输出 JSON（便于稳定解析），解析侧仍对代码块/多余解释做容错，并保留「模型不听话」时的降级路径。
 */
import type { EntryType } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { modelFor, normalizeProvider, type TranslateProvider, type TranslateRequestBody } from 'pure/translate';

/** 一句话总结建议字数上限（提示文案与 UI 计数用；解析侧另有安全上限防病态输出） */
export const AI_SUMMARY_MAX_CHARS = 40;
/** 核心看点建议条数 */
export const AI_HIGHLIGHT_SUGGEST = 3;
/** 解析侧看点条数硬上限 */
export const AI_HIGHLIGHT_MAX_ITEMS = 6;
/** 解析侧总结长度硬上限（防模型输出整篇） */
const SUMMARY_HARD_LIMIT = 120;
/** prompt 中简介/目录的截断上限（控 token） */
const SUMMARY_INPUT_LIMIT = 1200;
const TOC_INPUT_LIMIT = 800;
/** 主演最多带几个进 prompt */
const CAST_INPUT_LIMIT = 8;

export interface AiSummaryInput {
    type: EntryType;
    title: string;
    year?: number;
    genres?: string[];
    /** 主创（书=作者 / 影视=导演 / 游戏=开发商 / 音乐=歌手） */
    creator?: string;
    cast?: string[];
    /** 简介/剧情简介 */
    summary?: string;
    /** 书籍目录（结构线索，仅书籍有值） */
    toc?: string;
}

export interface AiSummaryResult {
    summary: string;
    highlights: string[];
}

export const DEFAULT_SUMMARY_PROMPT =
    '你在为个人影音书游收藏库整理条目资料。根据用户给出的信息输出两样东西：\n' +
    `1. summary：一句话总结，中文，不超过 ${AI_SUMMARY_MAX_CHARS} 字。说清「它是什么 + 最突出的特点」；` +
    '不要剧透结局，不要「本片讲述了」「本书讲述了」这类套话，不要在总结里重复作品标题。\n' +
    `2. highlights：核心看点 ${AI_HIGHLIGHT_SUGGEST} 条，每条不超过 20 字，以具体名词短语开头` +
    '（设定 / 主题 / 风格 / 结构 / 表演 等），不要「值得一看」「非常精彩」这类空泛评价。\n' +
    '信息不足时宁可写得克制，绝对不要编造具体情节、人物或数据。\n' +
    '只输出 JSON，格式：{"summary":"…","highlights":["…","…","…"]}。不要代码块标记，不要任何解释。';

/** 按字符数截断（超出补省略号；用于 prompt 输入侧控 token） */
function clip(s: string, n: number): string {
    const t = s.trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 构造 AI 摘要请求体；无标题 → null（信息量为零，不该发请求） */
export function buildAiSummaryBody(input: AiSummaryInput, provider?: TranslateProvider, prompt?: string): TranslateRequestBody | null {
    const title = input.title?.trim();
    if (!title) return null;

    const lines: string[] = [`类型：${ENTRY_TYPE_LABELS[input.type] ?? input.type}`, `标题：${title}`];
    if (input.year) lines.push(`年份：${input.year}`);
    if (input.genres?.length) lines.push(`题材：${input.genres.filter(Boolean).join(' / ')}`);
    if (input.creator?.trim()) lines.push(`主创：${input.creator.trim()}`);
    const cast = (input.cast ?? []).filter(Boolean).slice(0, CAST_INPUT_LIMIT);
    if (cast.length) lines.push(`主演：${cast.join(' / ')}`);
    if (input.toc?.trim()) lines.push(`目录：\n${clip(input.toc, TOC_INPUT_LIMIT)}`);
    if (input.summary?.trim()) lines.push(`简介：\n${clip(input.summary, SUMMARY_INPUT_LIMIT)}`);

    return {
        model: modelFor(normalizeProvider(provider)),
        messages: [
            { role: 'system', content: prompt?.trim() || DEFAULT_SUMMARY_PROMPT },
            { role: 'user', content: lines.join('\n') },
        ],
        stream: false,
    };
}

/** 剥掉 ```json … ``` 围栏（模型爱加） */
function stripFence(text: string): string {
    const t = text.trim();
    const m = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
    return m ? m[1].trim() : t;
}

/** 提取首个平衡的 {...} 对象（容忍前后解释文字） */
function extractFirstJsonObject(text: string): string | null {
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

function asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

function asHighlights(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map(asString).filter(Boolean).slice(0, AI_HIGHLIGHT_MAX_ITEMS);
}

/**
 * 解析模型输出 → { summary, highlights }；无法解析 → null（上层提示「生成失败」）。
 * 容错顺序：剥围栏 → 提取首个 JSON 对象 → 解析；两者都失败时，**纯文本降级为「一句话总结」**，
 * 但以 `{` 开头却解析失败的（坏 JSON）一律返回 null，避免把半截 JSON 写进笔记。
 */
export function parseAiSummaryResult(text: string | null | undefined): AiSummaryResult | null {
    if (typeof text !== 'string' || !text.trim()) return null;
    const raw = stripFence(text);

    const jsonText = extractFirstJsonObject(raw);
    if (jsonText) {
        try {
            const obj = JSON.parse(jsonText) as Record<string, unknown>;
            if (obj && typeof obj === 'object') {
                const summary = clip(asString(obj.summary), SUMMARY_HARD_LIMIT);
                const highlights = asHighlights(obj.highlights);
                if (summary || highlights.length) return { summary, highlights };
            }
        } catch {
            /* 落到下方降级判断 */
        }
    }

    const plain = raw.trim();
    if (!plain || plain.startsWith('{')) return null; // 坏 JSON 不当总结
    return { summary: clip(plain, SUMMARY_HARD_LIMIT), highlights: [] };
}

/** 看点数组 → 表单多行框文本（每行一条） */
export function highlightsToText(list: string[] | undefined): string {
    return (list ?? []).map((s) => s.trim()).filter(Boolean).join('\n');
}

/** 表单多行框文本 → 看点数组：去空行、剥行首 bullet/序号、去重保序 */
export function textToHighlights(text: string): string[] {
    const out: string[] = [];
    for (const line of (text ?? '').split('\n')) {
        const cleaned = stripLinePrefix(line);
        if (cleaned && !out.includes(cleaned)) out.push(cleaned);
    }
    return out;
}

/** 剥离行首 bullet / 序号（`- ` `* ` `• ` `1. ` `1、` `1)`） */
function stripLinePrefix(line: string): string {
    return line
        .replace(/^\s*[-*•·]+\s*/, '')
        .replace(/^\s*\d+\s*[.、)）]\s*/, '')
        .trim();
}

/**
 * 单框合并：**第一行 = 一句话总结，其余每行 = 一条核心看点**（看点带 `1.` `2.` 编号，与框内占位符一致）。
 * 编号只在展示层，落库/笔记仍是无编号的纯文本——`textToAiFields` 会把行首序号剥掉，往返无损。
 * 总结为空而看点非空时，首行留空写出（`'\n1. 甲'`）——保住「第一行是总结槽」的位置，
 * 否则看点会在下次保存时被顶到总结位。
 */
export function aiFieldsToText(aiSummary: string | undefined, highlights: string[] | undefined): string {
    const summary = asString(aiSummary);
    const list = (highlights ?? []).map((s) => asString(s)).filter(Boolean);
    if (!summary && !list.length) return '';
    const numbered = list.map((h, i) => `${i + 1}. ${h}`);
    if (!summary) return '\n' + numbered.join('\n');
    return [summary, ...numbered].join('\n');
}

/** 单框合并的逆运算：首行 → aiSummary；其余非空行 → aiHighlights（同样剥 bullet/序号、去重、封顶） */
export function textToAiFields(text: string): { aiSummary?: string; aiHighlights?: string[] } {
    const lines = (text ?? '').split('\n');
    const summary = lines.length ? stripLinePrefix(lines[0]) : '';
    // 看点走 textToHighlights（剥 bullet/序号 + 去重保序），再套 asHighlights 的条数封顶
    const highlights = asHighlights(textToHighlights(lines.slice(1).join('\n')));
    return {
        aiSummary: summary || undefined,
        aiHighlights: highlights.length ? highlights : undefined,
    };
}
