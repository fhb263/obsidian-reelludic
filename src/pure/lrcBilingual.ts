/**
 * LRC **双语歌词**纯逻辑（#507，无 obsidian 依赖，可单测）。
 *
 * 用户原话：「音乐编辑条目还有为当前 LRC 歌词 AI 搜索并生成**双语歌词** `[00:15.16]hello | 你好` 格式，
 * 入口（小图标按钮）排在**搜歌词图标按钮旁边**」。
 *
 * 🔴 **格式即契约**：译文一律以 ` | ` 接在**该行原文之后**、**时间标签一个字不动**。
 *    ⇒ ⛔ 不能让模型「重写整份 LRC」（那会把时间轴改坏，且失败时不可挽回），
 *      只让它**逐行给译文**，拼回去这件事由本模块做（纯函数、可测、可回退）。
 * 🔴 **幂等**：已经有 ` | ` 的行**不动**（再点一次不会变成 `a | b | c`）。
 * 🔴 **只译「真的像歌词」的行**：时间标签后面没字的、纯符号（`♪` / `---`）的一律跳过；
 *    元信息行（`[ar:]` / `[ti:]` / `[offset:]`）本来就不匹配时间标签 ⇒ 天然不动。
 */

import { resolveModel, type TranslateProvider, type TranslateRequestBody } from 'pure/translate';

/** 一行「有时间标签 + 有正文」的歌词 */
export interface LrcTranslatableLine {
    /** 在原文里的行下标（0 起；`mergeBilingualLrc` 按它回填） */
    index: number;
    /** 正文（已 trim；⛔ 不含时间标签） */
    text: string;
}

/**
 * 时间标签：`[mm:ss]` / `[mm:ss.xx]` / `[mm:ss.xxx]` / `[mm:ss:xx]`；一行可挂**多个**（`[00:01.00][00:05.00]词`）。
 * ⚠️ 必须**至少一位数字**在 `[` 之后 —— 这一条同时把 `[ar:…]` `[ti:…]` `[offset:…]` 这些元信息行排除在外。
 */
const TIME_TAG_RE = /^((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)([\s\S]*)$/;

/** 双语分隔符（格式契约的一部分；⛔ 别换成别的符号 —— 用户给的就是 ` | `） */
export const LRC_BILINGUAL_SEP = ' | ';

/** 「像歌词的正文」：至少含一个字母类字符（含中日韩）—— `♪` / `...` / `---` 这类不算 */
function hasLyricText(s: string): boolean {
    return /[\p{L}]/u.test(s);
}

/**
 * 挑出**需要翻译**的行（时间标签 + 有歌词正文 + 还没双语）。
 * ⚠️ 返回的是**行下标**：`mergeBilingualLrc` 要靠它回填，⛔ 别改成「只返回文本数组」
 *    （那样一旦某行被跳过，后面全部错位）。
 */
export function collectLrcTranslatable(text: string): LrcTranslatableLine[] {
    const out: LrcTranslatableLine[] = [];
    const lines = String(text ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const m = TIME_TAG_RE.exec(lines[i]);
        if (!m) continue;
        const body = m[2].trim();
        if (!body) continue;
        if (body.includes(LRC_BILINGUAL_SEP)) continue; // 已经双语 ⇒ 幂等，不再译
        if (!hasLyricText(body)) continue; // 纯符号行（♪ / 间奏标记）
        out.push({ index: i, text: body });
    }
    return out;
}

/**
 * 内置提示词（system）。
 * 🔴 **不接设置页那条可改的「服务提示词」** —— 这里的格式（逐行、条数不变、只给译文）是**契约**，
 *    用户拿去改（比如换成「翻译并润色成中文」）会让解析侧拿不到对齐的行数 ⇒ 整批作废。
 *    ⛔ 别为省事把它接到 `readerTranslatePrompt` 上。
 */
export const DEFAULT_LRC_BILINGUAL_PROMPT =
    '你在为个人音乐库生成**双语歌词**。用户给你一份按行编号的歌词（原语言），' +
    '你要**逐行**翻译成简体中文。\n' +
    '硬性要求：\n' +
    '1. 输出行数必须与输入**完全一致**，顺序不变，一行对一行，⛔ 不许合并、拆分、增删行；\n' +
    '2. 每行只给**译文本身**，⛔ 不要带行号、不要带原文、不要加引号或解释；\n' +
    '3. 原文是呼唱 / 语气词 / 人名地名等不必硬译时，可保留原样或给最贴近的中文；\n' +
    '4. 保持歌词的语感与断句，不要翻译成书面报道；\n' +
    '5. 只输出 JSON，格式：{"lines":["第一行译文","第二行译文", …]}。不要代码块标记，不要任何解释。';

/** 单次喂给模型的歌词行数上限（超长歌词分批；模型一次太多行会开始漏行） */
export const LRC_BILINGUAL_BATCH = 60;

/** 一次请求要翻译的那批行（`buildLrcBilingualBody` 的输入） */
export interface LrcBilingualBatch {
    /** 这批行在原文里的行下标（与 `translations` 一一对应） */
    indexes: number[];
    /** 拼好的用户消息（带行号，便于模型对齐） */
    userText: string;
}

/**
 * 把一批行拼成用户消息（带行号）。
 * ⚠️ 行号只用于**让模型对齐**，解析侧靠**位置**回填 —— 即便模型把行号抄进译文，
 *    解析侧的 `stripLineNo` 也会把它剥掉（见 `parseLrcBilingualReply`）。
 */
export function buildLrcBilingualBatch(lines: readonly LrcTranslatableLine[]): LrcBilingualBatch {
    const slice = (lines ?? []).slice(0, LRC_BILINGUAL_BATCH);
    const userText = slice.map((l, i) => `${i + 1}. ${l.text}`).join('\n');
    return { indexes: slice.map((l) => l.index), userText };
}

/**
 * 解析模型返回的译文行。
 * 🔴 **两级**：先按 JSON（`{"lines":[…]}`，或模型直接给数组）——这是提示词要的形态；
 *    失败再按**纯文本逐行**兜底（模型漏了 JSON 时仍可用，⛔ 别只认 JSON 就整批作废）。
 * ⚠️ 兜底路径要剥掉模型自作主张加的行号（`1. ` / `1、` / `1)`），否则译文里会带上「1. 」。
 */
export function parseLrcBilingualReply(raw: string): string[] {
    const text = String(raw ?? '');
    // ① JSON（含 ```json 围栏 / 前后解释）：先剥围栏，再定位第一个 { 或 [
    const fenced = text.replace(/^\s*```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    const start = (() => {
        const a = fenced.indexOf('{');
        const b = fenced.indexOf('[');
        if (a < 0) return b;
        if (b < 0) return a;
        return Math.min(a, b);
    })();
    if (start >= 0) {
        const tail = fenced.slice(start);
        // 从后往前找配对的收尾符（模型常在 JSON 后面再解释两句）
        for (let end = tail.length; end > 0; end--) {
            const chunk = tail.slice(0, end);
            try {
                const data: unknown = JSON.parse(chunk);
                const arr = Array.isArray(data)
                    ? data
                    : (() => {
                          const obj = (data ?? {}) as Record<string, unknown>;
                          for (const k of ['lines', 'translations', 'result', 'lyrics']) {
                              if (Array.isArray(obj[k])) return obj[k] as unknown[];
                          }
                          return null;
                      })();
                if (arr && arr.length > 0) return arr.map((x) => stripLineNo(String(x ?? '')));
                break;
            } catch {
                /* 继续缩短再试 */
            }
        }
    }
    // ② 纯文本逐行兜底
    return fenced
        .split('\n')
        .map((l) => stripLineNo(l.trim()))
        .filter((l) => l.length > 0);
}

/** 剥掉模型可能加的行首编号（`1. ` / `1、` / `1)` / `1：`）与包裹引号 */
function stripLineNo(s: string): string {
    let v = String(s ?? '').trim();
    v = v.replace(/^\d{1,3}\s*[.、)）:：]\s*/, '');
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('「') && v.endsWith('」')))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

export interface LrcBilingualMerge {
    /** 合并后的整份 LRC */
    text: string;
    /** 真正接上译文的行数 */
    applied: number;
    /** 没拿到译文、**原样保留**的行数（⚠️ 调用方要如实告知用户，⛔ 别谎报成功） */
    missing: number;
}

/**
 * 把译文按 ` | ` 接回原文对应行。
 * 🔴 **时间标签一个字不动**：整行只有「正文尾部」被改写 —— 这也是本模块存在的意义
 *    （⛔ 不让模型重写整份 LRC：失败时不可挽回，且时间轴一旦被改就没人能发现）。
 * ⚠️ 译文数组比待译行少（模型漏行）⇒ 缺的那些行**原样保留**并计入 `missing`，⛔ 不填占位符。
 */
export function mergeBilingualLrc(
    original: string,
    translations: readonly string[],
): LrcBilingualMerge {
    const src = String(original ?? '');
    const lines = src.split('\n');
    const todo = collectLrcTranslatable(src);
    const tr = translations ?? [];
    let applied = 0;
    for (let k = 0; k < todo.length; k++) {
        const t = String(tr[k] ?? '').trim();
        if (!t) continue;
        const i = todo[k].index;
        const m = TIME_TAG_RE.exec(lines[i]);
        if (!m) continue;
        lines[i] = m[1] + todo[k].text + LRC_BILINGUAL_SEP + t;
        applied += 1;
    }
    return { text: lines.join('\n'), applied, missing: todo.length - applied };
}

/** 这份 LRC 还需要翻译多少行（0 ⇒ 已全双语 / 没有可译行；UI 用它决定按钮是否可点） */
export function lrcTranslatableCount(text: string): number {
    return collectLrcTranslatable(text).length;
}

/**
 * 一批行 → chat/completions 请求体。
 * 🔴 `model` 走 `resolveModel(provider, model)` —— 与翻译/总结同一条（⛔ 别自己拼默认模型名）。
 * ⚠️ 上下文里带上**歌名 / 歌手**（模型据此定语气与人名译法）；没给就不带，⛔ 不编占位。
 */
export function buildLrcBilingualBody(
    batch: LrcBilingualBatch,
    provider?: TranslateProvider,
    model?: string,
    meta?: { title?: string; artist?: string },
): TranslateRequestBody {
    const head: string[] = [];
    const t = String(meta?.title ?? '').trim();
    const a = String(meta?.artist ?? '').trim();
    if (t || a) head.push(`歌曲：${[t, a].filter(Boolean).join(' - ')}`);
    head.push('以下是从 LRC 里抽出的歌词正文（按行编号）：');
    return {
        model: resolveModel(provider, model),
        messages: [
            { role: 'system', content: DEFAULT_LRC_BILINGUAL_PROMPT },
            { role: 'user', content: `${head.join('\n')}\n${batch.userText}` },
        ],
    };
}
