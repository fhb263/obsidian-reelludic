/**
 * 字幕纯逻辑层（无 obsidian 依赖，可单测）：扩展名识别 / SRT→WebVTT 转换 / 语言标签 / 同目录候选匹配
 *
 * 背景：Obsidian 的 <video> 只吃 WebVTT（内嵌轨道读不到，MKV 里的字幕更读不到），
 * 所以外挂字幕要「读文本 → 转 VTT → Blob URL 挂 <track>」。转换与匹配都是纯字符串/文件名运算，抽到这里单测。
 * 只支持 srt / vtt：ass / ssa 需要专门的渲染器（字体、定位、特效），不在本次范围。
 */

import { videoExt } from './mediaExtensions';

const SUBTITLE_EXTS = ['srt', 'vtt'] as const;

/** 语言标签识别表（小写；用于候选排序与「简体/繁体/英文」等中文说明） */
const LANG_TAGS: readonly string[] = [
    'chs', 'cht', 'sc', 'tc', 'zh-cn', 'zh-tw', 'zh', 'chi', 'zho', 'cn',
    'eng', 'en', 'jpn', 'jp', 'kor', 'kr',
];

const LANG_LABELS: Record<string, string> = {
    chs: '简体', sc: '简体', cn: '简体',
    cht: '繁体', tc: '繁体',
    zh: '中文', 'zh-cn': '中文', 'zh-tw': '中文', chi: '中文', zho: '中文',
    eng: '英文', en: '英文',
    jpn: '日文', jp: '日文',
    kor: '韩文', kr: '韩文',
};

/** 取小写扩展名（srt / vtt / 空） */
export function subtitleExt(path: string): 'srt' | 'vtt' | '' {
    const ext = videoExt(path);
    return (SUBTITLE_EXTS as readonly string[]).includes(ext) ? (ext as 'srt' | 'vtt') : '';
}

/** 是否为受支持的字幕文件（srt / vtt；ass/ssa 不在内） */
export function isSubtitlePath(path: string): boolean {
    return subtitleExt(path) !== '';
}

/** 路径取目录（统一正斜杠；无目录返回空串）——播放器与 main 层共用，避免两处各写一遍 */
export function dirOfPath(p: string): string {
    const n = p.replace(/\\/g, '/');
    const i = n.lastIndexOf('/');
    return i > 0 ? n.slice(0, i) : '';
}

/** 路径取文件名（去目录） */
export function fileNameOfPath(p: string): string {
    return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

/** 文件名（去目录、去扩展名） */
function stemOf(fileName: string): string {
    const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
    const idx = base.lastIndexOf('.');
    return idx <= 0 ? base : base.slice(0, idx);
}

/** 从文件名尾部标签里识别语言（`a.chs.srt` → `chs`；识别不到 → 空串） */
export function subtitleLangTag(fileName: string): string {
    const parts = stemOf(fileName).split('.');
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i].toLowerCase();
        if (LANG_TAGS.includes(p)) return p;
    }
    return '';
}

/** 语言标签 → 中文说明（未知/空 → 空串） */
export function subtitleLangLabel(tag: string): string {
    return LANG_LABELS[(tag || '').toLowerCase()] ?? '';
}

/** 中文（含简繁）标签：排序时优先于其它语种 */
function isChineseTag(tag: string): boolean {
    return ['chs', 'cht', 'sc', 'tc', 'zh', 'zh-cn', 'zh-tw', 'chi', 'zho', 'cn'].includes(tag.toLowerCase());
}

/** SRT/VTT 时间轴匹配：`00:01,500` / `00:00:01.000` 两种形态都收 */
const TIME_PATTERN = /(\d{1,2}):(\d{2})(?::(\d{2}))?[,.](\d{1,3})/g;

/** 单行时间轴规范化：统一成 `hh:mm:ss.mmm`（无小时形态补 00） */
function normalizeTimeLine(line: string): string {
    return line.replace(TIME_PATTERN, (_m, a: string, b: string, c: string | undefined, ms: string) => {
        const withHour = c !== undefined;
        const h = (withHour ? a : '0').padStart(2, '0');
        const m = (withHour ? b : a).padStart(2, '0');
        const s = (withHour ? c : b).padStart(2, '0');
        return `${h}:${m}:${s}.${ms.padEnd(3, '0')}`;
    });
}

/**
 * SRT → WebVTT（已是 VTT 则只做 BOM/换行规范化后透传）。
 * 处理：去 BOM、CRLF→LF、时间轴逗号→点、无小时补全、补 `WEBVTT` 头；空输入给空字幕（避免 <track> 解析报错）。
 */
export function srtToVtt(text: string): string {
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'WEBVTT\n\n';
    if (/^WEBVTT/i.test(clean)) return `${clean}\n`;
    const body = clean
        .split('\n')
        .map((line) => (line.includes('-->') ? normalizeTimeLine(line) : line))
        .join('\n');
    return `WEBVTT\n\n${body}\n`;
}

/** 同目录字幕候选（UI 里「像选剧集那样」列出） */
export interface SubtitleCandidate {
    /** 文件名（同目录内，展示与后续读取用） */
    fileName: string;
    /** 语言标签（chs / eng…；无标签为空串） */
    lang: string;
}

/**
 * 从同目录文件名里挑出「属于该视频」的字幕候选：
 * 命中条件 = 字幕去扩展名后与视频同名，或为「视频名.语言」形态；
 * 排序 = 完全同名 → 中文优先 → 其它（同级按文件名升序），便于默认选中最合适的一条。
 */
export function pickSubtitleCandidates(videoFileName: string, fileNames: readonly string[]): SubtitleCandidate[] {
    const videoStem = stemOf(videoFileName);
    if (!videoStem) return [];
    const ranked: { candidate: SubtitleCandidate; rank: number }[] = [];
    for (const name of fileNames) {
        if (!isSubtitlePath(name)) continue;
        const stem = stemOf(name);
        if (stem !== videoStem && !stem.startsWith(`${videoStem}.`)) continue;
        const lang = subtitleLangTag(name);
        const rank = stem === videoStem ? 0 : isChineseTag(lang) ? 1 : 2;
        ranked.push({ candidate: { fileName: name, lang }, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.candidate.fileName.localeCompare(b.candidate.fileName));
    return ranked.map((r) => r.candidate);
}
