/**
 * 字幕 AI 总结（纯逻辑，无 obsidian 依赖，可单测）
 *
 * 责任：把一整集的字幕 cue 列表拼成 chat/completions 请求体（prompt 设计在此）、解析模型返回的 JSON。
 * 网络请求与 Key 注入由 `services/cueSummary.ts` 完成（与 `pure/aiSummary` 同一条纪律：
 * 纯模块只造 prompt 和解析，⛔ 不碰网络、不读设置）。
 *
 * 🔴 用户 2026-11-11 逐字：「给字幕加个AIAI面板总结按钮小图标放在时间轴定位按钮右旁
 *    点击在字幕面板上浮出AI面板」
 *    ⇒ 结算是**整条字幕全文**（用户裁定），不是当前时间轴窗口、也不是单行解释。
 *
 * 默认 prompt 设计要点（与 `aiSummary` 同一套纪律，避免模型自由发挥）：
 *  - 总结讲「这一集讲了什么」，按剧情推进分点，⛔ 不剧透整剧结局；
 *  - 只依据给出的字幕原文，**不得编造**没有出现的情节、人物或数据；
 *  - 只输出 JSON（便于稳定解析），解析侧仍对代码块/多余解释容错。
 */
import type { Cue } from 'pure/subtitleCues';
import type { TranslateProvider, TranslateRequestBody } from 'pure/translate';
import { resolveModel } from 'pure/translate';
// #499：与「条目摘要」「AI 预填」共用同一套 JSON 容错（剥围栏 / 提取首个对象）
import { parseAiJsonObject, stripFence } from 'pure/aiJson';

/** 面板上「一句话概括」的建议字数上限（提示文案用；解析侧另有硬上限） */
export const CUE_SUMMARY_MAX_CHARS = 60;
/** 梳理要点建议条数 */
export const CUE_POINT_SUGGEST = 5;
/** 解析侧要点条数硬上限 */
export const CUE_POINT_MAX_ITEMS = 12;
/** 解析侧概括长度硬上限（防模型输出整篇） */
const SUMMARY_HARD_LIMIT = 200;
/**
 * 喂给模型的字幕原文上限（字符）。
 *
 * 🔴 为什么必须有上限：一集 40 分钟的动画字幕约 1.5~2.5 万字符，一集播客/访谈能到 8 万以上。
 *    不截断会把 token 打爆（402/超长），截断按**从头取**——开头是这一集的情境建立，
 *    比中间随手一刀更有用。
 * ⚠️ 12 万字符约 6~8 万 token，是多数模型的舒适区；⛔ 别为了「更全」把这里调到无上限。
 */
export const CUE_SOURCE_LIMIT = 120_000;

export interface CueSummaryInput {
    /** 作品标题（必填；空 ⇒ 不请求） */
    title: string;
    /** 当前集标题（可选，如「第 3 话」），进 prompt 帮助模型定位 */
    episode?: string;
    /** 字幕语言标注（可选，如「中文」），影响 prompt 里对原文的说明 */
    lang?: string;
    /** 解析后的字幕行（按时间升序） */
    cues: readonly Cue[];
}

export interface CueSummaryResult {
    /** 一句话概括这一集讲了什么 */
    summary: string;
    /** 梳理要点（按剧情推进，几条） */
    points: string[];
}

// ── 对字幕提问（用户 2026-11-11：「给字幕面板的 AI 加个提问框」）──────────────────
//
// 🔴 与「总结」的关键差异：提问是**多轮**的，但每轮都必须重新带上字幕原文 ——
//    模型没有上一轮的上下文记忆（无状态 HTTP），只带问答历史会让它脱离原文瞎编。
//    ⇒ `buildCueAskBody` 每轮都重新拼字幕原文（这是 token 的主要开销来源，也是有意的）。
//
// ⚠️ 输出是**纯文本**而不是 JSON：问答要给的是解释，硬套 JSON 会让模型在「答不出」时
//    编一个 `{"answer":"..."}` 的形状，反而把「我不知道」吞掉。

/** 单条提问的字符上限（防粘贴整篇长文把 token 打爆） */
export const CUE_ASK_MAX_CHARS = 500;
/** 喂进 prompt 的历史轮数上限（只留最近几条，越早的越可能是别的子话题） */
export const CUE_ASK_HISTORY_TURNS = 4;

export interface CueAskTurn {
    /** 用户问的 */
    q: string;
    /** 模型答的 */
    a: string;
}

export const DEFAULT_CUE_ASK_PROMPT =
    '你在帮用户理解一集视频的内容。用户会给你这一集的字幕原文（时间戳 + 台词），' +
    '以及用户针对这集内容提出的问题。请只依据字幕原文回答：\n' +
    '1. 直接回答，不要复述问题，不要写「根据字幕」这类开场；\n' +
    '2. 涉及具体情节时，尽量带上时间点（格式 mm:ss），方便用户回看；\n' +
    '3. 字幕里没提到、或只能靠猜的内容，明确说「字幕里没有提到」，绝对不要编造；\n' +
    '4. 中文回答，简洁，一般 1~3 句话，需要展开时最多 5 句。';

/**
 * 构造「对字幕提问」的请求体；无标题 / 无字幕原文 / 问题为空 → null。
 *
 * @param history 之前的问答（按时间正序；本函数只取最近 `CUE_ASK_HISTORY_TURNS` 条）
 */
export function buildCueAskBody(
    input: CueSummaryInput,
    question: string,
    history: readonly CueAskTurn[] = [],
    provider?: TranslateProvider,
    prompt?: string,
    model?: string,
): TranslateRequestBody | null {
    const title = input.title?.trim();
    const q = question.replace(/\s+/g, ' ').trim().slice(0, CUE_ASK_MAX_CHARS);
    if (!title || !q) return null;
    const source = cuesToSourceText(input.cues);
    if (!source) return null;

    const lines: string[] = [`标题：${title}`];
    if (input.episode?.trim()) lines.push(`本集：${input.episode.trim()}`);
    if (input.lang?.trim()) lines.push(`字幕语言：${input.lang.trim()}`);
    lines.push(`共 ${input.cues.length} 行字幕，原文如下：\n${source}`);

    const recent = history.filter((t) => t.q.trim() && t.a.trim()).slice(-CUE_ASK_HISTORY_TURNS);
    if (recent.length > 0) {
        lines.push('');
        lines.push('此前已经问过（供理解上下文，不必重复回答）：');
        for (const t of recent) {
            lines.push(`问：${t.q.trim()}`);
            lines.push(`答：${t.a.trim()}`);
        }
    }
    lines.push('');
    lines.push(`现在的问题是：${q}`);

    return {
        model: resolveModel(provider, model),
        messages: [
            { role: 'system', content: prompt?.trim() || DEFAULT_CUE_ASK_PROMPT },
            { role: 'user', content: lines.join('\n') },
        ],
        stream: false,
    };
}

/**
 * 解析提问的回答：剥代码围栏后当纯文本用。
 *
 * ⚠️ 与 `parseCueSummaryResult` 不同，这里**不做 JSON 解析**：问答要的是自然语言，
 *    强行 JSON 化只会在模型答不出时逼它编一个空壳。返回 null 只代表「模型什么也没说」。
 */
export function parseCueAskResult(text: string | null | undefined): string | null {
    if (typeof text !== 'string') return null;
    const plain = stripFence(text).trim();
    return plain ? plain : null;
}

export const DEFAULT_CUE_SUMMARY_PROMPT =
    '你在帮用户快速回顾一集视频的内容。用户会给你这一集的字幕原文（时间戳 + 台词），' +
    '请据此输出两样东西：\n' +
    `1. summary：一句话概括这一集讲了什么，中文，不超过 ${CUE_SUMMARY_MAX_CHARS} 字。` +
    '说清「这一集主要发生了什么」，不要「本集讲述了」这类套话。\n' +
    `2. points：剧情/内容要点 ${CUE_POINT_SUGGEST} 条左右，按时间推进排列，每条不超过 30 字，` +
    '以具体事件或信息开头，不要「开头」「结尾」这类空泛标注。\n' +
    '只能依据给出的字幕原文，信息不足时宁可写得克制，绝对不要编造没有出现的情节、人物或数据。\n' +
    '只输出 JSON，格式：{"summary":"…","points":["…","…","…"]}。不要代码块标记，不要任何解释。';

/** 按字符数截断（超出补省略号；用于 prompt 输入侧控 token） */
function clip(s: string, n: number): string {
    const t = s.trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
}

/**
 * cue 列表 → 便于模型阅读的纯文本（每行 `[mm:ss] 台词`）。
 *
 * 🔴 为什么要带时间戳：模型靠它判断先后顺序、也便于它写出「前半段 / 后段」这种推进描述。
 * ⚠️ 空文本行（纯音乐标记 / 只含标签的行）**跳过**：它们在字幕里很常见（`[音乐]`、`♪`），
 *    原样喂进去只会白烧 token，还容易让模型把标记当成台词。
 */
export function cuesToSourceText(cues: readonly Cue[], limit: number = CUE_SOURCE_LIMIT): string {
    const out: string[] = [];
    let used = 0;
    for (const cue of cues) {
        const text = cue.text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const line = `[${formatCueStamp(cue.start)}] ${text}`;
        if (used + line.length > limit) break;
        out.push(line);
        used += line.length + 1;
    }
    return out.join('\n');
}

/** 秒 → `mm:ss`（超过一小时给 `h:mm:ss`）；非法值给 `00:00` */
export function formatCueStamp(seconds: number): string {
    const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * 构造字幕总结请求体；无标题 / 无字幕原文 → null（信息量为零，不该发请求）。
 *
 * ⚠️ `provider` / `model` 与翻译、条目摘要走同一条 `resolveModel` 口径（⛔ 别在这里另写默认模型表）。
 *
 * 🔴 `stream`（2026-11-12，用户 m09565 ①-8）：传 `true` ⇒ 请求体带 `stream: true`，
 *    由 `nodeHttpPostStream` 边收边解析。**缺省 `false`** —— 非流式那条老路一字不变，
 *    既有单测的 `toMatchObject({ stream: false })` 与「键集合恒为 messages/model/stream」继续成立。
 *    ⚠️ 提示词仍然要求 JSON（`{"summary":…,"points":[…]}`），流式只是让**传输**不阻塞：
 *       解析侧靠 `pure/cueStream` 从半截 JSON 里抠 `summary`，`points` 等收完再整块出。
 */
export function buildCueSummaryBody(
    input: CueSummaryInput,
    provider?: TranslateProvider,
    prompt?: string,
    model?: string,
    stream?: boolean,
): TranslateRequestBody | null {
    const title = input.title?.trim();
    if (!title) return null;
    const source = cuesToSourceText(input.cues);
    if (!source) return null;

    const lines: string[] = [`标题：${title}`];
    if (input.episode?.trim()) lines.push(`本集：${input.episode.trim()}`);
    if (input.lang?.trim()) lines.push(`字幕语言：${input.lang.trim()}`);
    lines.push(`共 ${input.cues.length} 行字幕，原文如下：\n${source}`);

    return {
        model: resolveModel(provider, model),
        messages: [
            { role: 'system', content: prompt?.trim() || DEFAULT_CUE_SUMMARY_PROMPT },
            { role: 'user', content: lines.join('\n') },
        ],
        // ⚠️ 显式写出来（哪怕 false）—— 键集合被 tests/aiPrefill.test.ts 钉成
        //    `['messages','model','stream']`，省掉这条会让键集合断言漂移。
        stream: stream === true,
    };
}

function asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

function asPoints(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map(asString).filter(Boolean).slice(0, CUE_POINT_MAX_ITEMS);
}

/**
 * 解析模型输出 → `{ summary, points }`；无法解析 → null（上层提示「生成失败」）。
 * 容错顺序与 `parseAiSummaryResult` 一致：剥围栏 → 提取首个 JSON 对象 → 解析；
 * 都失败时**纯文本降级为「一句话概括」**，但以 `{` 开头却解析失败的（坏 JSON）一律返回 null，
 * 避免把半截 JSON 显示在面板上。
 */
export function parseCueSummaryResult(text: string | null | undefined): CueSummaryResult | null {
    if (typeof text !== 'string' || !text.trim()) return null;

    const obj = parseAiJsonObject(text);
    if (obj) {
        const summary = clip(asString(obj.summary), SUMMARY_HARD_LIMIT);
        // ⚠️ 字段名容错：模型常把 `points` 写成 `highlights` / `key_points`（同一件事的三种叫法），
        //    只认一个会让「模型答对了但字段名不同」被误判成失败。
        const points = asPoints(obj.points ?? obj.highlights ?? obj.key_points);
        if (summary || points.length) return { summary, points };
    }

    const plain = stripFence(text).trim();
    if (!plain || plain.startsWith('{')) return null; // 坏 JSON 不当总结
    return { summary: clip(plain, SUMMARY_HARD_LIMIT), points: [] };
}
