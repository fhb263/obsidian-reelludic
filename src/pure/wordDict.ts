/**
 * 本地词典的**纯逻辑层**：解析词典文件、建稀疏索引、按键查词。
 *
 * 🔴 为什么是「用户自装词典文件」而不是内置：
 *    `main.js` 已 96.9%，距用户定的 5MB 上限只剩 150KB。ECDICT 完整版约 30MB，
 *    精简版也有几 MB —— 塞进产物就是直接爆线。所以只带**解析器**，
 *    词典文件由用户在设置里指一个路径（与 whisper 模型、yt-dlp 同一条路）。
 *
 * 🔴 为什么是「稀疏索引」而不是直接把全表建成 Map：
 *    ECDICT 完整版 70 万行。`new Map()` 全量解析要同时持有原文 + 70 万个条目对象，
 *    峰值内存几百 MB，而用户一集字幕里能查到的词通常只有几十个。
 *    这里只记「每个两字母前缀 → 行区间」，查词时**只扫那一段**（几千行），
 *    代价是单次查词多几毫秒，换来常驻内存只有一份原文。
 *
 * 支持两种格式（都是「一行一个词」，靠分隔符自动认）：
 *   ① ECDICT 精简 CSV：`word,phonetic,definition`（含引号包裹、字段内逗号）
 *   ② 制表符简化表：`word<TAB>definition`（用户自己整理的词表）
 * ⚠️ 一行解析不出来就跳过该行，⛔ 不为一行坏数据让整个词典不可用。
 */

import { lookupKey } from 'pure/learnMode';

/** 词典文件的安全上限：再大就别整个读进内存了（也挡住「误选了 2GB 的视频文件」） */
export const DICT_MAX_BYTES = 64 * 1024 * 1024;

/** 释义展示长度上限（气泡里放不下长段落，ECDICT 的释义会带一堆词性与例句） */
export const DICT_DEF_MAX = 240;

/** 一个词条 */
export interface DictEntry {
    /** 原词形（保留大小写，气泡标题用它） */
    word: string;
    /** 音标（可缺） */
    phonetic?: string;
    /** 释义（已截断到 `DICT_DEF_MAX`） */
    def: string;
}

/** 稀疏索引：前缀 → `[起始行下标, 结束行下标)` */
export type DictIndex = ReadonlyMap<string, readonly [number, number]>;

/** 索引前缀长度。2 最平衡：桶够多（26×26 量级）又不至于每桶只有几行 */
export const DICT_BUCKET_CHARS = 2;

/**
 * 取一个词的索引前缀。
 * ⚠️ 非 ASCII 词（中文、日文）也要能分桶 —— 直接切码点，⛔ 不用 `slice(0,2)`：
 *    那是按 UTF-16 码元切，会把一个 surrogate pair 劈成两半，两侧前缀都查不到。
 */
export function bucketOf(key: string): string {
    if (!key) return '';
    return Array.from(key).slice(0, DICT_BUCKET_CHARS).join('');
}

/**
 * 拆 CSV 行（只在真正的逗号处切，⛔ 不切引号里的）。
 * ECDICT 的释义里到处都是逗号和引号，用 `split(',')` 会把一条释义劈成七八段。
 */
export function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"') {
                // 连续两个引号 = 一个字面引号（CSV 转义）
                if (line[i + 1] === '"') {
                    cur += '"';
                    i += 1;
                } else {
                    quoted = false;
                }
            } else {
                cur += ch;
            }
            continue;
        }
        if (ch === '"') {
            quoted = true;
            continue;
        }
        if (ch === ',') {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    out.push(cur);
    return out;
}

/** 释义压成一行 + 截断（气泡只有一行宽，换行会把气泡顶得很高） */
export function compactDef(raw: string): string {
    const one = raw.replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (one.length <= DICT_DEF_MAX) return one;
    return `${one.slice(0, DICT_DEF_MAX - 1)}…`;
}

/**
 * 解析一行词条。认不出来返回 `null`（调用方跳过该行）。
 *
 * 两种格式的判别：含制表符 ⇒ 简化表；否则按 CSV 走（至少 `词,释义` 两段）。
 * ⚠️ ECDICT 表头那行（`word,phonetic,definition`）会被当成词条解析出来，
 *    但它查不到任何真实单词，无副作用，⛔ 不必专门特判。
 */
export function parseDictLine(line: string): DictEntry | null {
    const text = line.replace(/\r$/, '');
    if (!text.trim()) return null;
    if (text.indexOf('\t') >= 0) {
        const [w, ...rest] = text.split('\t');
        const word = (w ?? '').trim();
        const def = compactDef(rest.join(' '));
        if (!word || !def) return null;
        return { word, def };
    }
    const cells = splitCsvLine(text);
    if (cells.length < 2) return null;
    const word = (cells[0] ?? '').trim();
    if (!word) return null;
    // 三段以上按 ECDICT 口径：第 2 段是音标，第 3 段起是释义（释义里可能含被引号包住的逗号）
    if (cells.length >= 3) {
        const phonetic = (cells[1] ?? '').trim();
        const def = compactDef(cells.slice(2).join(','));
        if (!def) return null;
        return phonetic ? { word, phonetic, def } : { word, def };
    }
    const def = compactDef(cells[1] ?? '');
    if (!def) return null;
    return { word, def };
}

/**
 * 扫一遍全文，建「前缀 → 行区间」索引。
 *
 * ⚠️ 只记**行号区间**，不复制任何词条内容 —— 这是内存能省下来的全部原因。
 * ⚠️ 区间按「首次出现」到「最后出现 + 1」取，允许桶内有空行与坏行，
 *    查词时逐行解析再过滤，比维护「连续块列表」简单得多且不会漏。
 */
export function buildDictIndex(text: string): DictIndex {
    const lines = text.split('\n');
    const spans = new Map<string, [number, number]>();
    for (let i = 0; i < lines.length; i += 1) {
        const entry = parseDictLine(lines[i]);
        if (!entry) continue;
        const bucket = bucketOf(lookupKey(entry.word));
        if (!bucket) continue;
        const cur = spans.get(bucket);
        if (!cur) {
            spans.set(bucket, [i, i + 1]);
            continue;
        }
        // 词典一般按字母序，行号只会往后长；用 min/max 兜住「没排序的手工词表」
        if (i < cur[0]) cur[0] = i;
        if (i + 1 > cur[1]) cur[1] = i + 1;
    }
    return spans;
}

/**
 * 在已建索引的词典里查一个词（返回 `null` = 查不到）。
 *
 * ⚠️ 大小写与首尾标点已在 `lookupKey` 里抹平，这里只做「前缀分桶 + 桶内逐行比对」。
 * ⚠️ 同一词出现多次时返回**第一个**：手工词表里常见「同一个词补了第二版释义」，
 *    取先出现的更符合「原文优先」的直觉，且省得为了打赢排序再存一份权重。
 */
export function lookupDict(text: string, index: DictIndex, key: string): DictEntry | null {
    const bucket = bucketOf(key);
    if (!bucket) return null;
    const span = index.get(bucket);
    if (!span) return null;
    const lines = text.split('\n');
    const [from, to] = span;
    const end = Math.min(to, lines.length);
    for (let i = from; i < end; i += 1) {
        const entry = parseDictLine(lines[i]);
        if (!entry) continue;
        if (lookupKey(entry.word) === key) return entry;
    }
    return null;
}

/** 词典文件是否大到不该整个读进来（调用方据此给人话提示） */
export function dictTooLarge(bytes: number): boolean {
    return Number.isFinite(bytes) && bytes > DICT_MAX_BYTES;
}
