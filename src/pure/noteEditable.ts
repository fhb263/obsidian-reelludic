// 笔记可编辑字段解析（纯逻辑，可单测）
// 背景：catalog.json 是结构化数据源，笔记 .md 是展示层；用户可能直接编辑笔记中的
// 「个人评语」「观看/相关链接」「简介/内容简介」「作者简介」「目录」章节与顶部 frontmatter（YAML）。
// 编辑表单重新打开时，先读笔记覆盖 catalog 值，避免用户手动维护的内容在下次编辑时"消失"（全类型通用）。
import type { MediaEntry, Progress, WatchLink } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { isMediaStatus } from 'pure/status';
import type { Rating } from 'pure/rating';

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

/** 模板生成的评语占位符：与 noteGenerator 保持一致，视为"未写" */
export const NOTES_PLACEHOLDER = '（在这里写下你的感想，支持 [[双链]]）';

/** 纯文本章节（标题 → 字段）：内容取标题与下一个 ## 标题之间的文本，去首尾空白 */
const TEXT_SECTIONS: Record<string, keyof NoteEditable> = {
    '## 内容简介': 'summary',
    '## 简介': 'summary',
    '## 作者简介': 'authorIntro',
    '## 目录': 'toc',
};

/** 从笔记 Markdown 提取用户手动维护的可编辑字段（个人评语/观看·相关链接/简介/作者简介/目录） */
export function extractEditableFromNote(text: string): NoteEditable {
    const out: NoteEditable = {};
    const lines = text.split('\n');
    const notesLines: string[] = [];
    const links: WatchLink[] = [];
    const textBuf: Partial<Record<keyof NoteEditable, string[]>> = {};
    let section: 'notes' | 'links' | keyof NoteEditable | null = null;
    // 链接章节标题（影视=观看链接，书/游戏=相关链接）
    const linkSections = new Set(['## 观看链接', '## 相关链接']);

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line.startsWith('## ') || line.startsWith('# ')) {
            if (line === '## 个人评语' || line === '# 个人评语') section = 'notes';
            else if (linkSections.has(line)) section = 'links';
            else if (TEXT_SECTIONS[line]) section = TEXT_SECTIONS[line];
            else section = null; // 其余章节（游玩记录/属性等）不采集
            continue;
        }
        if (section === 'notes') {
            notesLines.push(line);
        } else if (section === 'links' && line.startsWith('- [')) {
            const m = /^- \[([^\]]*)\]\(([^)]+)\)/.exec(line);
            if (m) links.push({ label: m[1].trim(), url: m[2].trim() });
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
    if (notes && notes !== NOTES_PLACEHOLDER) out.notes = notes;
    if (links.length) out.links = links;
    for (const key of ['summary', 'authorIntro', 'toc'] as const) {
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
export function extractFrontmatterFromNote(text: string): Partial<MediaEntry> {
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
        platform: (v, { str: s }) => { out.platform = s(v); },
        developer: (v, { str: s }) => { out.developer = s(v); },
        banner: (v, { str: s }) => { out.poster = s(v); },
        watched_date: (v, { str: s }) => { out.watchedDate = s(v); },
        planned_date: (v, { str: s }) => { out.plannedDate = s(v); },
        playtime_minutes: (v, { num: n }) => { out.playtimeMinutes = n(v); },
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
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        const handler = handlers[key];
        if (handler) handler(val, { str, strList, num });
    }
    return out;
}
