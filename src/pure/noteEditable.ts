// 笔记可编辑字段解析（纯逻辑，可单测）
// 背景：catalog.json 是结构化数据源，笔记 .md 是展示层；用户可能直接编辑笔记中的
// 「个人评语」「观看/相关链接」「简介/内容简介」「作者简介」「目录」章节与顶部 frontmatter（YAML）。
// 编辑表单重新打开时，先读笔记覆盖 catalog 值，避免用户手动维护的内容在下次编辑时"消失"（全类型通用）。
import type { MediaEntry, Progress, WatchLink } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { isMediaStatus } from 'pure/status';
import type { Rating } from 'pure/rating';
// 1.3.1 ① 字段映射（读侧）：笔记里的键名可能被用户改过，解析前先反查回原始键名
import { EMPTY_FIELD_MAP, mapReverse, type CompiledFieldMap } from 'pure/fieldMap';

export interface NoteEditable {
    /** 个人评语（笔记中实际写的文本；占位符视为未写返回 undefined） */
    notes?: string;
    /** 观看/相关链接（笔记中解析出的行；无链接返回 undefined） */
    links?: WatchLink[];
    /** 简介（影视/动画/游戏「## 简介」、图书「## 内容简介」章节；笔记编辑回填表单 summary） */
    summary?: string;
    /** 作者简介（图书笔记「## 作者简介」章节） */
    authorIntro?: string;
    /** 目录（图书笔记「## 目录」章节） */
    toc?: string;
    /** AI 一句话总结（笔记「## 一句话总结」章节） */
    aiSummary?: string;
    /** AI 核心看点（笔记「## 核心看点」无序列表，逐行一条） */
    aiHighlights?: string[];
    /** 数据源链接（属性表格「来源」行；笔记编辑回填表单 sourceUrl） */
    sourceUrl?: string;
    /** 数据源标识（由来源行中文标签映射；未知标签不返回，避免覆盖已有 source） */
    source?: string;
}

/** 属性表格「来源」行中文标签 → 数据源标识（与 noteGenerator SOURCE_LABELS 反向映射） */
const SOURCE_LABEL_TO_ID: Record<string, string> = {
    豆瓣: 'douban',
    TMDB: 'tmdb',
    Bangumi: 'bangumi',
    'Google Books': 'google',
    'Open Library': 'openlibrary',
    IGDB: 'igdb',
};

/**
 * 模板生成的评语占位行（**唯一真源**：`noteGenerator` 从这里取，⛔ 别在那边内联第二份）—— 视为「未写」。
 * 🔴 #453：正文里的「，支持 [[双链]]」已去掉（用户：「笔记里空评语不要显示『支持 [[双链]]』」）。
 */
export const NOTES_PLACEHOLDER = '（在这里写下你的感想）';

/**
 * 🔴 #453 **旧形态（带「，支持 [[双链]]」）必须继续认** —— 已存笔记里那行是旧文本；
 * 不认它 ⇒ 用户一打开旧条目，那句占位符就会被当成「他亲手写的评语」回填进表单（幽灵内容）。
 * ⚠️ 新写入的笔记一律用 `NOTES_PLACEHOLDER`（下次保存该条目时自动更替），这里只为**读**兼容。
 * ⛔ 别删这条兼容分支。
 */
const LEGACY_NOTES_PLACEHOLDERS: readonly string[] = ['（在这里写下你的感想，支持 [[双链]]）'];

/** 是否「模板写的空评语占位行」（**新旧形态都算未写**；判定只此一处） */
export function isNotesPlaceholder(text: string): boolean {
    const t = text.trim();
    return t === NOTES_PLACEHOLDER || LEGACY_NOTES_PLACEHOLDERS.includes(t);
}

/**
 * 🔴 #635 关联章节名（**保留区键**）。与 `data/noteGenerator.RELATED_SECTION` 必须是**同一个字面量** ——
 * 改名 = 存量笔记里的关联区一保存就被模板重写抹掉（「#587 改区名」同族的静默丢数据）。
 * ⚠️ 这里不 import 那边：`noteEditable` 是 pure 层，`noteGenerator` 是 data 层，反向依赖会成环。
 * 两边由断言逐字钉住（`assert-symbols`）。
 */
export const RELATED_SECTION = '关联';

/** 关联为空时的提示行（与链接章节「（暂无链接）」同口径；判断「这区是不是空的」靠它） */
export const RELATED_EMPTY_HINT = '（暂无关联）';

/**
 * 从笔记抽出「## 关联」区的原始正文（#635 重写保留区用）。
 * 空区（只有提示行 / 只有空白）⇒ `''`；没有该区 ⇒ `null`（**两种要分开**：
 * 「用户把整区删了」与「用户留着空区」在重写时的处理不一样）。
 */
export function extractRelatedSectionBody(text: string): string | null {
    const lines = text.split('\n');
    const head = lines.findIndex((l) => l.trim() === `## ${RELATED_SECTION}`);
    if (head === -1) return null;
    const buf: string[] = [];
    for (let i = head + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break; // 下一个二级标题 ⇒ 区结束
        buf.push(lines[i]);
    }
    const body = buf.join('\n').trim();
    if (!body || body === RELATED_EMPTY_HINT) return '';
    return body;
}

/** 纯文本章节（标题 → 字段）：内容取标题与下一个 ## 标题之间的文本，去首尾空白 */
const TEXT_SECTIONS: Record<string, keyof NoteEditable> = {
    '## 内容简介': 'summary',
    '## 简介': 'summary',
    '## 作者简介': 'authorIntro',
    '## 目录': 'toc',
    '## 一句话总结': 'aiSummary',
};

/** 从笔记 Markdown 提取用户手动维护的可编辑字段（个人评语/观看·相关链接/简介/作者简介/目录） */
export function extractEditableFromNote(text: string): NoteEditable {
    const out: NoteEditable = {};
    const lines = text.split('\n');
    const notesLines: string[] = [];
    const links: WatchLink[] = [];
    const textBuf: Partial<Record<keyof NoteEditable, string[]>> = {};
    const highlights: string[] = [];
    let section: 'notes' | 'links' | 'highlights' | keyof NoteEditable | null = null;
    // 链接章节标题（影视=观看链接，书/游戏=相关链接）
    const linkSections = new Set(['## 观看链接', '## 相关链接']);

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line.startsWith('## ') || line.startsWith('# ')) {
            if (line === '## 个人评语' || line === '# 个人评语') section = 'notes';
            else if (linkSections.has(line)) section = 'links';
            else if (line === '## 核心看点') section = 'highlights'; // 无序列表，逐行采集
            else if (TEXT_SECTIONS[line]) section = TEXT_SECTIONS[line];
            else section = null; // 其余章节（游玩记录/属性等）不采集
            continue;
        }
        if (section === 'notes') {
            notesLines.push(line);
        } else if (section === 'links' && line.startsWith('- [')) {
            const m = /^- \[([^\]]*)\]\(([^)]+)\)/.exec(line);
            if (m) links.push({ label: m[1].trim(), url: m[2].trim() });
        } else if (section === 'highlights') {
            const m = /^\s*[-*•]\s+(.+)$/.exec(line);
            const v = m ? m[1].trim() : '';
            if (v) highlights.push(v);
        } else {
            // 属性表格「来源」行（表格区）：`| 来源 | [豆瓣](url) |` → 同步数据源链接到表单
            const srcM = /^\|\s*来源\s*\|\s*\[([^\]]*)\]\(([^)]+)\)\s*\|/.exec(line);
            if (srcM) {
                out.sourceUrl = srcM[2].trim();
                const id = SOURCE_LABEL_TO_ID[srcM[1].trim()];
                if (id) out.source = id;
                continue;
            }
            if (section !== null && section !== 'links') {
                (textBuf[section] = textBuf[section] ?? []).push(line);
            }
        }
    }

    const notes = notesLines.join('\n').trim();
    // 🔴 #453：判据走 `isNotesPlaceholder`（新旧占位形态都算未写），⛔ 别退回 `!== NOTES_PLACEHOLDER`
    if (notes && !isNotesPlaceholder(notes)) out.notes = notes;
    if (links.length) out.links = links;
    if (highlights.length) out.aiHighlights = highlights;
    for (const key of ['summary', 'authorIntro', 'toc', 'aiSummary'] as const) {
        const val = (textBuf[key] ?? []).join('\n').trim();
        if (val) out[key] = val; // 章节为空视为未写，不覆盖 catalog
    }
    return out;
}

/** entryFrontmatter 生成的 YAML 键 → MediaEntry 字段（仅可编辑字段；id/type/title 为结构性字段不同步） */
type FmMap = (val: string, ctx: { str: (v: string) => string | undefined; strList: (v: string) => string[] | undefined; num: (v: string) => number | undefined }) => void;

/**
 * 从笔记顶部 frontmatter（YAML）提取可编辑字段（评分/状态/年份/演职人员/进度/链接日期等），
 * 校验类型后返回 Partial<MediaEntry>，供编辑表单打开时覆盖 catalog。
 *  - 跳过结构性字段（id/type/title）：改标题需在表单操作（笔记文件名为标题，保持一致性）
 *  - 非法值忽略（status 非四态、rating 超界、year 非数字等不返回）
 *  - banner → poster（URL 或库内路径原文透传，EntryModal 负责剥库目录前缀）
 */
export function extractFrontmatterFromNote(
    text: string,
    /** 1.3.1 ①：用户配置的字段映射（缺省恒等）。⚠️ 这里用的是**反向**表 ——
     *  笔记里写的是「新键名」，要靠它反查出 `handlers` 认识的原键名。 */
    fieldMap: CompiledFieldMap = EMPTY_FIELD_MAP,
): Partial<MediaEntry> {
    const out: Partial<MediaEntry> = {};
    const fm = /^---\n([\s\S]*?)\n---/.exec(text);
    if (!fm) return out;

    const str = (v: string): string | undefined => {
        if (!v) return undefined;
        if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\"/g, '"');
        return v;
    };
    const strList = (v: string): string[] | undefined => {
        const inner = v.startsWith('[') && v.endsWith(']') ? v.slice(1, -1) : v;
        const items = inner.split(',').map((s) => str(s.trim())).filter((s): s is string => !!s);
        return items.length ? items : undefined;
    };
    const num = (v: string): number | undefined => {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
    };
    const progress: Progress = { season: 1, episode: 0, history: [] };

    const handlers: Record<string, FmMap> = {
        status: (v) => {
            // 白名单随枚举走（isMediaStatus），避免硬编码漂移；弃剧已移除，存量笔记 dropped 不解析
            if (isMediaStatus(v)) out.status = v as MediaStatus;
        },
        rating: (v, { num: n }) => {
            const r = n(v);
            if (r !== undefined && r >= 0 && r <= 5) out.rating = r as Rating;
        },
        year: (v, { num: n }) => { out.year = n(v); },
        album: (v, { str: s }) => { out.album = s(v); },
        genres: (v, { strList: sl }) => { out.genres = sl(v) ?? []; },
        director: (v, { str: s }) => { out.director = s(v); },
        cast: (v, { strList: sl }) => { out.cast = sl(v) ?? []; },
        screenwriter: (v, { strList: sl }) => { out.screenwriter = sl(v); },
        country: (v, { str: s }) => { out.country = s(v); },
        language: (v, { str: s }) => { out.language = s(v); },
        duration_min: (v, { num: n }) => { out.durationMin = n(v); },
        aliases: (v, { strList: sl }) => { out.aliases = sl(v); },
        author: (v, { str: s }) => { out.author = s(v); },
        translator: (v, { str: s }) => { out.translator = s(v); },
        publisher: (v, { str: s }) => { out.publisher = s(v); },
        producer: (v, { str: s }) => { out.producer = s(v); },
        isbn: (v, { str: s }) => { out.isbn = s(v); },
        binding: (v, { str: s }) => { out.binding = s(v); },
        price: (v, { str: s }) => { out.price = s(v); },
        series: (v, { str: s }) => { out.series = s(v); },
        // 系列序号（#434）：可空；🔴 #443 起锁定整数（见 pure/seriesGroup 的 `seriesIndexValue`）。
        // ⚠️ 直接赋值（与 duration_min 同款）⇒ 清空即 `undefined`，不保留旧值（否则「删掉序号」在笔记里删不掉）。
        series_index: (v, { num: n }) => { out.seriesIndex = n(v); },
        platform: (v, { str: s }) => { out.platform = s(v); },
        developer: (v, { str: s }) => { out.developer = s(v); },
        banner: (v, { str: s }) => { out.poster = s(v); },
        watched_date: (v, { str: s }) => { out.watchedDate = s(v); },
        planned_date: (v, { str: s }) => { out.plannedDate = s(v); },
        playtime_minutes: (v, { num: n }) => { out.playtimeMinutes = n(v); },
        // #537 书籍阅读时长（分钟，append-only）：表单手填覆盖总数；与阅读器自动累计**不同时写**
        read_minutes: (v, { num: n }) => { out.readMinutes = n(v); },
        progress_season: (v, { num: n }) => {
            const s = n(v);
            if (s !== undefined) { progress.season = s; out.progress = progress; }
        },
        progress_episode: (v, { num: n }) => {
            const e = n(v);
            if (e !== undefined) { progress.episode = e; out.progress = progress; }
        },
        progress_total_episodes: (v, { num: n }) => {
            const t = n(v);
            if (t !== undefined) { progress.totalEpisodes = t; out.progress = progress; }
        },
        reading_page: (v, { num: n }) => {
            const p = n(v);
            if (p !== undefined) out.readingProgress = { ...out.readingProgress, page: p };
        },
        reading_total_page: (v, { num: n }) => {
            const t = n(v);
            if (t !== undefined) out.readingProgress = { ...out.readingProgress, totalPage: t };
        },
        page_count: (v, { num: n }) => {
            const p = n(v);
            if (p !== undefined) out.pageCount = p; // 元数据页数（豆瓣实体书）
        },
    };

    for (const raw of fm[1].split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        // 1.3.1 ①：先按反向映射把「笔记里的键名」换回原始键名，再查 handlers
        const key = mapReverse(fieldMap, line.slice(0, idx).trim());
        const val = line.slice(idx + 1).trim();
        const handler = handlers[key];
        if (handler) handler(val, { str, strList, num });
    }
    return out;
}
