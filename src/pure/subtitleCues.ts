// 字幕时间轴面板的**纯逻辑**：把字幕文本解析成 cue 列表 / 定位当前行 / 锁定态滚动偏移，⛔ 不碰 DOM。
//
// 用户（m00002「新页面播放加字幕面板」）的六节规格里，凡是「能算的」都归这里：
//   · 二、列表项 —— 每行 `[时间戳] [字幕文本]`，时间戳要等宽小字；→ `formatStamp`
//   · 三、播放联动 —— 当前行高亮 / 未锁定跟随 / 锁定提词器固定在容器内某个位置；
//     「锁定位置默认第二行」是个**可算的常量**，不在视图里散写 `1`；→ `LOCK_LINE_INDEX`
//   · 五、边界 —— 无字幕空态、解析中加载态、多语言切换（按语言给选项）→ `cueLangOptions`
//
// ⚠️ 与 `pure/subtitle.ts` 的分工：那边管「文件识别 / SRT→VTT / 候选匹配」（喂给 <track> 的），
//    这边管「把同一份文本解析成可点的行」。**两处都从同一段字幕文本出发**，
//    所以视图层只要拿到 VTT 原文，两边就不会漂（⛔ 不另读一次文件）。

import type { WordSpan } from 'pure/wordTiming';
import { parseAssKaraokeWords, parseVttInlineWords } from 'pure/wordTiming';

/** 一条字幕：起止秒 + 文本（多行已按规格「可多行但保持紧凑」用换行保留） */
export interface Cue {
    /** 起始秒（浮点） */
    start: number;
    /** 结束秒（浮点）；缺失/非法时退化为 `start` */
    end: number;
    /** 文本（已去掉 VTT 标签与 SRT 序号行；保留内部软换行） */
    text: string;
    /**
     * **真词级**时间戳（append-only 可选字段，用户 m01938「词级时间戳」）。
     *
     * 🔴 只在字幕源自己带了词级信息时才有值：
     *    · VTT 行内戳 `<00:00:01.500>`；· ASS 卡拉 OK标签 `{\k50}`。
     *    `undefined` = 这一行没有词级数据 ⇒ 视图层按字符权重**估算**（见 `pure/wordTiming`）。
     * ⚠️ 别在这里塞估算值：估算依赖「当前这一行」的时长，放在解析期算等于把
     *    一份伪精确数据当成真数据存下来，后续想改算法还得迁移已解析结果。
     */
    words?: WordSpan[];
}

/** 提词器锁定态：当前行固定在容器内的第几行（**默认第二行**，用户规格原话） */
export const LOCK_LINE_INDEX = 1;

/**
 * 锁定态「钉在第几行」——用户 2026-11-09 逐字：
 * 「字幕面板的锁定时间轴应该在一屏显示中位固定啊，而不是在第二行」
 *
 * ⇒ 从「固定第 2 行」改成「**容器可视区的中位行**」：列表高矮不同时（矮屏 / 折叠 / 字号变化）
 *   第 2 行可能贴在顶端、离视线中心很远，钉在中位才是提词器该有的样子。
 *
 * @param viewH 列表可视高度（`clientHeight`）
 * @param rowH 行高
 * @returns 中位行下标（0 基）；量不到尺寸时退回 `LOCK_LINE_INDEX`
 *
 * ⚠️ 用 `(viewH / 2 - rowH / 2) / rowH` 而不是 `viewH / rowH / 2`：
 *    后者按「行数的一半」算，会把当前行的**顶端**对到中位 ⇒ 整行偏下半个行高。
 */
export function lockLineFor(viewH: number, rowH: number): number {
    if (!Number.isFinite(viewH) || !Number.isFinite(rowH) || viewH <= 0 || rowH <= 0) return LOCK_LINE_INDEX;
    return Math.max(0, Math.floor((viewH / 2 - rowH / 2) / rowH));
}

/** 时间戳格式：`mm:ss` / `hh:mm:ss`（小时位为 0 时省掉，和 B 站口径一致） */
export function formatStamp(seconds: number): string {
    const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p2 = (n: number) => String(n).padStart(2, '0');
    return hh > 0 ? `${hh}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
}

/** `00:01:02.500` / `00:01:02,500` / `01:02.5` → 秒；非法 → NaN */
function parseStamp(raw: string): number {
    const m = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/.exec(raw.trim());
    if (!m) return NaN;
    const hh = m[1] ? Number(m[1]) : 0;
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
    if (![hh, mm, ss, ms].every((n) => Number.isFinite(n))) return NaN;
    return hh * 3600 + mm * 60 + ss + ms / 1000;
}

/** 去掉 VTT/SRT 的行内标签（`<i>`、`<c.foo>`、`{\an8}` 之类）——列表里只留纯文本 */
function stripCueTags(text: string): string {
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

/**
 * 解析 VTT / SRT 文本 → cue 数组（**按起始时间升序、彼此不重叠**）。
 *
 * 为什么两种格式一个入口：`main.readSubtitleAsVtt` 已经把 SRT 转成 VTT 再交给 <track>，
 * 面板拿到的也是同一份 VTT 原文 ⇒ 这里只需认 VTT；但 SRT 原文也可能从别处直接喂进来
 * （导入 .srt 时先解析、后转换），所以同一个函数两种都收 —— 判据是「时间轴行含 `-->`」。
 */
export function parseCues(vtt: string): Cue[] {
    const text = String(vtt ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return [];
    const out: Cue[] = [];
    const blocks = text.split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n');
        // 找时间轴行（VTT 的 cue 标识行 / SRT 的序号行都在它上面，一律跳过）
        const ti = lines.findIndex((l) => l.includes('-->'));
        if (ti < 0) continue;
        const arrow = lines[ti].split('-->');
        const start = parseStamp(arrow[0] ?? '');
        // 结束时间后面可能跟着 cue 设置（`align:start position:10%`），先切掉
        const end = parseStamp((arrow[1] ?? '').trim().split(/\s+/)[0] ?? '');
        if (!Number.isFinite(start)) continue;
        const rawBody = lines.slice(ti + 1).join('\n');
        const body = stripCueTags(rawBody);
        if (!body) continue;
        const end2 = Number.isFinite(end) && end >= start ? end : start;
        const cue: Cue = { start, end: end2, text: body };
        // 真词级：VTT 允许在行内写 `<00:00:01.500>` 标出每个词的起点。
        // ⚠️ 必须用 **rawBody**（未剥标签）探测 —— `stripCueTags` 会把内联戳一起吃掉。
        const inline = parseVttInlineWords(rawBody, cue.start, cue.end);
        if (inline) cue.words = inline;
        out.push(cue);
    }
    out.sort((a, b) => a.start - b.start);
    return out;
}

/**
 * 解析 ASS / SSA 的 `[Events]` 段 → cue 数组。
 *
 * 🔴 只取**纯文本**：样式覆盖（`{\pos(...)}`、`{\an8}`、卡拉 OK 标签）全部剥掉 ——
 *    面板是「提词器式阅读」，不是渲染器；用户要的是「能扫读的字幕行」。
 *    ⚠️ 视频轨道仍不支持 ASS（`pure/subtitle.ts` 的注释写明需要专门渲染器），
 *    这里只服务于**面板列表**：导入 .ass 后能读、能跳、能高亮，但画面上不叠字幕。
 */
export function parseAssCues(ass: string): Cue[] {
    const text = String(ass ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return [];
    const out: Cue[] = [];
    let inEvents = false;
    // 列序由 `Format:` 行给定，⛔ 不能假设固定位置（不同工具导出的列序不一样）
    let cols: string[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (/^\[.*\]$/.test(line)) {
            inEvents = /^\[events\]$/i.test(line);
            continue;
        }
        if (!inEvents) continue;
        if (/^format\s*:/i.test(line)) {
            cols = line
                .slice(line.indexOf(':') + 1)
                .split(',')
                .map((c) => c.trim().toLowerCase());
            continue;
        }
        if (!/^dialogue\s*:/i.test(line)) continue;
        if (cols.length === 0) cols = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
        // 文本列可能在最后也可能含逗号 ⇒ 前 n-1 列按逗号切，剩下的整体当文本
        const payload = line.slice(line.indexOf(':') + 1);
        const parts: string[] = [];
        let rest = payload;
        for (let i = 0; i < cols.length - 1; i++) {
            const idx = rest.indexOf(',');
            if (idx < 0) break;
            parts.push(rest.slice(0, idx));
            rest = rest.slice(idx + 1);
        }
        parts.push(rest);
        const at = (name: string): string => {
            const i = cols.indexOf(name);
            return i >= 0 ? (parts[i] ?? '') : '';
        };
        const start = parseStamp(at('start'));
        const end = parseStamp(at('end'));
        const rawText = at('text');
        const body = stripCueTags(rawText.replace(/\\N/gi, '\n').replace(/\\n/gi, '\n'));
        if (!Number.isFinite(start) || !body) continue;
        const end2 = Number.isFinite(end) && end >= start ? end : start;
        const cue: Cue = { start, end: end2, text: body };
        // 真词级：卡拉 OK 字幕用 `{\k50}`（厘秒）标每段时长。
        // ⚠️ 用 **rawText**（未剥标签）—— `stripCueTags` 会把 `{\k50}` 整段吃掉。
        const karaoke = parseAssKaraokeWords(rawText, cue.start, cue.end);
        if (karaoke) cue.words = karaoke;
        out.push(cue);
    }
    out.sort((a, b) => a.start - b.start);
    return out;
}

/** 按扩展名选解析器（导入 .ass/.ssa 走 ASS，其余当 VTT/SRT 处理） */
export function parseSubtitleText(text: string, fileName: string): Cue[] {
    const ext = (fileName.split('.').pop() ?? '').toLowerCase();
    return ext === 'ass' || ext === 'ssa' ? parseAssCues(text) : parseCues(text);
}

/**
 * 当前播放位置命中的 cue 下标：**取 start ≤ seconds + tol 里 start 最大的那一条**；
 * 没有 ⇒ `-1`（还没进第一条字幕，此时不该高亮任何行）。
 *
 * `tol` 默认 0.35s：`timeupdate` 粒度约 250ms，正好落在起始那一刻也要能点亮。
 * 与输入顺序无关（取最大 start 而不是「最后一个满足的」）⇒ cue 乱序也不会指错行。
 */
export function activeCueIndex(cues: readonly Cue[], seconds: number, tol = 0.35): number {
    const cur = Number(seconds);
    if (!Number.isFinite(cur) || cues.length === 0) return -1;
    let best = -1;
    let bestStart = -Infinity;
    for (let i = 0; i < cues.length; i++) {
        const s = Number(cues[i]?.start);
        if (!Number.isFinite(s) || s > cur + tol) continue;
        if (s > bestStart) {
            bestStart = s;
            best = i;
        }
    }
    return best;
}

/**
 * 锁定（提词器）模式下，列表要滚多少才能让第 `idx` 行落在容器内第 `lockLine` 行的位置。
 *
 * @param rowTops 各行相对列表顶部的偏移（`offsetTop`，由视图量出来传进来）
 * @param rowHeight 行高（锁定态行高恒定，视图按 CSS 算好传进来）
 * @param idx 当前行下标
 * @param lockLine 锁定位置（第几行，0 基；用户规格「默认第二行」⇒ 1）
 * @returns 目标 `scrollTop`（已夹在 `[0, maxScroll]`；量不到高度时返回 0）
 */
export function lockScrollTop(
    rowTops: readonly number[],
    rowHeight: number,
    idx: number,
    lockLine: number,
    maxScroll: number,
): number {
    if (idx < 0 || idx >= rowTops.length) return 0;
    const top = Number(rowTops[idx]);
    if (!Number.isFinite(top)) return 0;
    // 🔴 行高量不到（行还没渲染 / 被隐藏）⇒ 不滚：锁定态的位置**只能由行高算出来**，
    //    硬按 0 行高算会把当前行直接顶到容器顶端，看起来像「锁定失效」——比不动更糟。
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return 0;
    const target = top - Math.max(0, lockLine) * rowHeight;
    const max = Number.isFinite(maxScroll) && maxScroll > 0 ? maxScroll : 0;
    return Math.min(Math.max(0, target), max);
}

/**
 * 面板上「有没有内容」的显示态（视图只按它切 DOM，⛔ 不在视图里散写三元）。
 *
 * 🔴 用户 m11612：「转录过程中字幕面板的空态要变成转录过程（每一句转写）」
 *    ⇒ 新增 `transcribing`：转写要跑几分钟，这段时间面板原来一直显示
 *      「还没有字幕 / 导入一份 .srt」——**在说谎**（字幕正在被写出来）。
 *      这个态优先级最高：转写中就算列表里已经有别的字幕，也该让位给实时流，
 *      否则用户盯着旧字幕看不出正在生成。
 */
export type PanelState = 'empty' | 'loading' | 'transcribing' | 'ready';

/**
 * 由「是否在解析 / 是否在转写 / cue 条数」推出显示态。
 *
 * ⚠️ 判据顺序是有意的：`transcribing` **压过** `loading` ——
 *    转写期间面板同时可能处在「刚切集、正在解析」的 loading 态，
 *    此时用户更关心「我点的转写跑到哪一句了」，而不是那三行灰条。
 */
export function panelStateOf(loading: boolean, cueCount: number, transcribing = false): PanelState {
    if (transcribing) return 'transcribing';
    if (loading) return 'loading';
    return cueCount > 0 ? 'ready' : 'empty';
}

/**
 * 转写过程中已经识别出来的句子。
 *
 * 🔴 与 `Cue` 分开而不复用：`Cue` 带 `words`（词级时间戳）、已经过 VTT/ASS 解析，
 *    而这里是**引擎边跑边吐的草稿行**，将来还可能补一条「这句还在修正」的状态。
 *    混用会逼着视图层去猜「这条 cue 是真字幕还是半成品」。
 */
export interface TranscribeLine {
    /** 起始秒（引擎给的原值，⛔ 不夹取 —— 夹了会与最终 SRT 对不上） */
    start: number;
    /** 结束秒 */
    end: number;
    /** 该句正文（已去首尾空白；空串的行不进列表，见 `appendTranscribeLine`） */
    text: string;
}

/**
 * 实时流最多留多少行。
 *
 * ⚠️ 一小时的片子能识别出上千句，全塞进面板会让 DOM 越滚越大、滚到底部也越来越慢；
 *    用户要看的是「正在产出」，不是「全部历史」（最终产物是那个 .srt 文件）。
 *    留 200 行 ≈ 屏幕可见量的十几倍，足够看出句子的推进节奏。
 */
export const TRANSCRIBE_MAX_LINES = 200;

/**
 * 往实时流里追加一句（纯函数，返回新数组，⛔ 不原地改入参）。
 *
 * 三条规矩：
 *  · **空正文丢掉** —— 引擎会为静音段吐空行，画出来就是一排空壳行；
 *  · **重复行去掉** —— 同一起止时间重复上报时（有的引擎会在收尾再打一遍），
 *    追加会让同一句出现两遍，看着像识别重复了；
 *  · **超长截断头部** —— 见 `TRANSCRIBE_MAX_LINES`。
 *
 * ⚠️ 判重只比 `start`+`end`，不比正文：同一时间轴上换了正文说明引擎改了那句，
 *    这时候保留**新的**那一条才有意义（旧的已经被替代）。
 */
export function appendTranscribeLine(
    lines: readonly TranscribeLine[],
    next: TranscribeLine,
): TranscribeLine[] {
    const text = String(next?.text ?? '').trim();
    if (!text) return lines.slice();
    const start = Number(next.start);
    const end = Number(next.end);
    // 时间轴不合法就别进列表：后面算进度、排序都要用它，NaN 会污染整张列表
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return lines.slice();

    const kept = lines.filter((l) => !(l.start === start && l.end === end));
    kept.push({ start, end, text });
    // 按起点稳定排序：引擎逐段产出时顺序本就有序，这一步只为防跨段乱序
    kept.sort((a, b) => a.start - b.start);
    return kept.length > TRANSCRIBE_MAX_LINES ? kept.slice(kept.length - TRANSCRIBE_MAX_LINES) : kept;
}

/**
 * 实时流的一句话术（面板顶部那行说明）。
 *
 * ⚠️ 把「已识别 N 句」写进来而不是只写「正在转写」：
 *    用户要判断的是**它在动**，数字变了就是证据；纯静态文案几分钟不变很吓人。
 */
export function transcribeHeadline(lineCount: number): string {
    const n = Math.max(0, Math.floor(Number(lineCount) || 0));
    return n > 0 ? `正在转写… 已识别 ${n} 句` : '正在转写… 马上出第一句';
}

/** 语言切换项：面板头部按它出下拉（用户规格「多语言字幕时按语言提供选项」） */
export interface CueLangOption {
    /** 文件名（切语言时回传给视图去挂载） */
    fileName: string;
    /** 显示名（中文说明；识别不到语言时退回 `fileName`） */
    label: string;
    /** 当前是否选中 */
    active: boolean;
}

/**
 * 由候选列表 + 当前挂载项算出语言切换项。
 * ⚠️ 标签的中文化在视图层做（纯模块不依赖 `pure/subtitle` 的语言表）——
 * 这里只负责「排序 + 标注选中」，因为那是**面板口径**而不是文件名口径。
 */
export function cueLangOptions(
    candidates: readonly { fileName: string; label: string }[],
    activeFile: string | null,
): CueLangOption[] {
    return candidates.map((c) => ({
        fileName: c.fileName,
        label: c.label || c.fileName,
        active: activeFile !== null && c.fileName === activeFile,
    }));
}

/** 空态提示语（与 `videoDrawer.markEmptyHint` 同款口吻：先说「没有什么」，再说「怎么加」） */
export const CUE_EMPTY_HINT = '还没有字幕 — 同目录放一份 .srt / .ass，或点上方「导入」手动选文件';

/** 加载态提示语（用户规格「生成时间轴时显示轻量加载反馈」） */
export const CUE_LOADING_HINT = '正在生成时间轴…';
