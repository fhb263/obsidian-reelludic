// 库内笔记 → 条目 的反向导入（用户 2026-11-08：「是手写的条目在海报墙上展示无法出现，但笔记文件存在
// 是怎么回事，有没有再加个检索库内笔记文件生成条目的项在基本设置下」）。
//
// 🔴 为什么需要它：海报墙的唯一数据源是 `catalog.json`（`HomeView.ts` → `EntryService.list()`），
//    而**没有任何路径**会去读 vault 里已有的 md。手写的笔记哪怕 frontmatter 完全合规，只要没经过
//    `EntryService.create()` 落库，海报墙就永远不知道它存在 ——「文件在 ≠ 条目在」。
//
// 🔴 为什么必须白名单而不是「带 type 就收」：实测用户库 392 篇 md 里 296 篇带 `type:`，其中 140 篇是
//    `4-Archive/music-note/` 下 `musicCN`/`musicGW`/`popmusic` 这类**自定义 type**，另有 5 篇豆瓣模板
//    （title 还是 `{{title}}` 占位符）。判据放错 = 一键导入 140 条垃圾。
//    ⇒ 只认 `ENTRY_TYPES` 的六个合法值，且必须能读出一个**非空、非占位符**的 title。
//
// 本模块是纯逻辑（无 obsidian 依赖）：文件内容由调用方读好后传进来，便于单测。

import { ENTRY_TYPES, type EntryType, type MediaEntry } from 'data/types';
import { isMediaStatus, MEDIA_STATUSES, type MediaStatus } from './status';
import { statusLabel } from './labels';

/** 一条待导入候选（扫描结果） */
export interface NoteImportCandidate {
    /** vault 内相对路径（`媒体库/笔记/movie/xx.md`） */
    path: string;
    /** 笔记里读到的 id；空串 = 笔记没有 id 字段（导入时新生成） */
    id: string;
    type: EntryType;
    title: string;
    /** 落库用的条目草稿（已做类型/区间校验，交给 `normalizeEntry` 兜底） */
    draft: Partial<MediaEntry>;
    /**
     * 降级提示（`✅ 降级提示` 口径，用户 2026-11-08 裁定）。
     *
     * 🔴 为什么需要它：以前 `status` 是裸强转 `scalar(fm.status) as MediaEntry['status']`，
     *    而 `normalizeEntry` 只认四个枚举值、其余静默落 `'want'`。用户手写 `status: 已看`
     *    （这很符合直觉，也没人会去翻枚举）⇒ 导入后变成**想看**，而且**一句提示都没有**。
     *    这比直接报错更糟：条目出现了、状态是错的、用户以为成功了。
     *
     * ⇒ 现在非法值照样降级（⛔ 不阻断导入，用户裁定「降级提示」），但**必须把
     *    「哪里不认识、降成了什么」原样交给弹窗展示**。字段本身就是提示的唯一真源，
     *    ⛔ 别在弹窗里再推一遍原因（那会变成第二份判据）。
     */
    warnings?: string[];
}

/** 被跳过的文件（弹窗里要如实说明「为什么没收它」，否则用户只会觉得功能坏了） */
export interface NoteImportSkipped {
    path: string;
    reason: string;
}

export interface NoteImportScanInput {
    /** 扫描到的笔记：vault 相对路径 + 文件正文 */
    files: readonly { path: string; text: string }[];
    /** 已在 catalog 里的条目（用于 id / notePath 两道去重） */
    entries: readonly MediaEntry[];
    /** 笔记目录前缀（如 `媒体库/笔记`），用于展示与路径归一 */
    notesDir: string;
}

export interface NoteImportScanResult {
    candidates: NoteImportCandidate[];
    skipped: NoteImportSkipped[];
}

/** frontmatter 里被 `{{...}}` 包着的值 = 模板占位符，不是真数据 */
function isPlaceholder(v: string): boolean {
    return /\{\{[\s\S]*?\}\}/.test(v);
}

/** 取 YAML 标量：剥引号、去首尾空白 */
function scalar(raw: string): string {
    let v = raw.trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).replace(/\\"/g, '"');
    else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1).replace(/''/g, "'");
    return v.trim();
}

/**
 * 极简 YAML frontmatter 读取 → 键值表（值一律当字符串）。
 *
 * ⚠️ **不复用** `pure/noteEditable.extractFrontmatterFromNote`：那份**刻意跳过** `id`/`type`/`title`
 *    三个结构性字段（它的用途是「表单覆盖可编辑字段」）。反向导入要的恰恰是这三个 ⇒ 另写一份。
 *    ⛔ 别为了复用去改它 —— 会让编辑表单能把 id/type 改掉，那是结构性事故。
 */
export function parseFrontmatterMap(text: string): Record<string, string> {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return {};
    const out: Record<string, string> = {};
    for (const raw of m[1].split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        if (!key) continue;
        // ⚠️ 只取第一个冒号 —— 值里可能有 URL（`https://…`），再切就把值切断
        out[key] = line.slice(idx + 1).trim();
    }
    return out;
}

/** 合法类型判定（白名单，唯一真源 `ENTRY_TYPES`） */
function asEntryType(v: string): EntryType | null {
    const t = scalar(v) as EntryType;
    return ENTRY_TYPES.includes(t) ? t : null;
}

/**
 * 状态解析：认**枚举值**（`watching`）也认**中文标签**（`在看` / `已读` / `通关`）。
 *
 * 🔴 反查 `statusLabel(type, s)` 而不是手写第二份标签表 —— 标签表只有一处
 *    （`pure/labels`：书籍是「在读/已读」、游戏是「在玩/通关」、音乐是「在听/已听」），
 *    这里再抄一份就是「同一个概念两份文案」的老病根（同 `pure/tableCell.statusFromText` 的口径）。
 *
 * @returns 合法状态；无法识别时返回 `undefined`（由调用方决定降级 + 提示）
 */
function statusOf(type: EntryType, raw: string): MediaStatus | undefined {
    const t = scalar(raw);
    if (!t) return undefined;
    if (isMediaStatus(t)) return t;
    for (const s of MEDIA_STATUSES) {
        if (statusLabel(type, s) === t) return s;
    }
    return undefined;
}

/** 数字取值（非法返回 undefined，交给 normalizeEntry 的缺省） */
function num(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const v = scalar(raw);
    if (!v || isPlaceholder(v)) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * 扫一遍候选笔记，挑出「能安全变成条目」的那些。
 *
 * 三道闸（缺一不可，顺序也是判据的一部分）：
 *  ⑴ **type 白名单** —— 不是六个合法类型之一 ⇒ 跳过（挡掉 `musicCN` 这类自定义 type 与年度报告）；
 *  ⑵ **title 可用** —— 空 / 含 `{{}}` 占位符 ⇒ 跳过（挡掉豆瓣模板）；
 *  ⑶ **去重** —— 笔记 id 已在 catalog，**或** 目标路径已被某条目的 `notePath` 占着 ⇒ 跳过
 *     （后者是真实脏数据场景：历史上有两条同标题条目共用一个笔记文件）。
 *
 * @param notesDir 笔记根目录（vault 相对），仅用于「文件确实在该目录下」的兜底与展示
 */
export function scanImportableNotes(input: NoteImportScanInput): NoteImportScanResult {
    const byId = new Set(input.entries.map((e) => e.id));
    const usedPaths = new Set(input.entries.map((e) => e.notePath).filter((p): p is string => !!p).map((p) => p.toLowerCase()));
    const candidates: NoteImportCandidate[] = [];
    const skipped: NoteImportSkipped[] = [];

    for (const f of input.files) {
        const fm = parseFrontmatterMap(f.text);
        const typeRaw = fm.type ?? '';
        const type = asEntryType(typeRaw);
        if (!type) {
            // 没有 type 的普通笔记（项目文档、待办、思路稿…）不值得报——它们本来就不该是条目。
            // 但**有 type 却不在白名单**的要报：那多半是用户以为自己写对了。
            if (typeRaw.trim()) skipped.push({ path: f.path, reason: `类型「${scalar(typeRaw)}」不是条目的六种类型` });
            continue;
        }

        const titleRaw = fm.title ?? '';
        const title = scalar(titleRaw);
        if (!title) {
            skipped.push({ path: f.path, reason: 'frontmatter 没有标题' });
            continue;
        }
        if (isPlaceholder(title)) {
            skipped.push({ path: f.path, reason: '标题是模板占位符（{{…}}），不是真实条目' });
            continue;
        }

        const id = scalar(fm.id ?? '');
        if (id && byId.has(id)) continue; // 已经是条目了，没什么可导的（不算「跳过」，不必打扰用户）

        if (usedPaths.has(f.path.toLowerCase())) {
            skipped.push({ path: f.path, reason: '已有条目占用这个笔记路径' });
            continue;
        }

        // 🔴 状态降级（用户 2026-11-08 裁定「降级提示」）：非法值**不阻断导入**，
        //    但必须留下一条人能读懂的提示 —— 以前的裸强转会让 `status: 已看` 静默变成「想看」。
        const warnings: string[] = [];
        let status: MediaStatus | undefined;
        // ⚠️ 用 `scalarOrUndef` 而不是 `scalar`：`status: "{{status}}"` 这类模板占位符必须当「没填」，
        //    否则会误报一条「「{{status}}」不是合法值」—— 那是对模板的假警报。
        const statusRaw = scalarOrUndef(fm.status) ?? '';
        if (statusRaw) {
            status = statusOf(type, statusRaw);
            if (!status) {
                warnings.push(`状态「${statusRaw}」不是合法值，已降级为「${statusLabel(type, 'want')}」`);
            }
        }

        const draft: Partial<MediaEntry> = {
            type,
            title,
            year: num(fm.year),
            genres: parseList(fm.genres),
            status,
            rating: num(fm.rating) as MediaEntry['rating'],
            director: scalarOrUndef(fm.director),
            cast: parseList(fm.cast),
            country: scalarOrUndef(fm.country),
            language: scalarOrUndef(fm.language),
            durationMin: num(fm.duration_min),
            series: scalarOrUndef(fm.series),
            seriesIndex: num(fm.series_index),
            platform: scalarOrUndef(fm.platform),
            developer: scalarOrUndef(fm.developer),
            album: scalarOrUndef(fm.album),
            author: scalarOrUndef(fm.author),
            translator: scalarOrUndef(fm.translator),
            publisher: scalarOrUndef(fm.publisher),
            isbn: scalarOrUndef(fm.isbn),
            watchedDate: scalarOrUndef(fm.watched_date),
            plannedDate: scalarOrUndef(fm.planned_date),
        };
        // banner 是写侧的「库内完整路径 / URL」，读回来落到 poster 时**剥掉库目录前缀**由调用方做
        // （它需要知道 libraryDir），这里原样透传，调用方用 `posterFromBanner` 归一。
        const banner = scalarOrUndef(fm.banner);
        if (banner) draft.poster = banner;

        candidates.push({ path: f.path, id, type, title, draft, ...(warnings.length ? { warnings } : {}) });
    }

    return { candidates, skipped };
}

function scalarOrUndef(raw: string | undefined): string | undefined {
    if (raw === undefined) return undefined;
    const v = scalar(raw);
    if (!v || isPlaceholder(v)) return undefined;
    return v;
}

/** `[a, b, c]` / `a, b` → 字符串数组（剥引号、去空、去占位符） */
function parseList(raw: string | undefined): string[] {
    if (raw === undefined) return [];
    let inner = raw.trim();
    if (inner.startsWith('[') && inner.endsWith(']')) inner = inner.slice(1, -1);
    return inner
        .split(',')
        .map((s) => scalar(s))
        .filter((s) => !!s && !isPlaceholder(s));
}

/**
 * 写侧 `banner`（`{libraryDir}/封面/x.jpg` 或 URL）→ 读侧 `poster`（`封面/x.jpg` 或 URL）。
 *
 * 判据：只有「本地库内路径」才剥前缀；`https?://` 原样返回。
 * ⚠️ 与 `EntryModal` 打开时那段剥前缀逻辑同一口径（那里剥的是 `libraryDir/`，这里必须有同样的
 *    libraryDir 才能剥对 —— 所以本函数要参数而不是写死）。
 */
export function posterFromBanner(banner: string, libraryDir: string): string {
    const v = banner.trim();
    if (/^https?:\/\//i.test(v)) return v;
    const prefix = `${libraryDir.replace(/\/+$/, '')}/`;
    return v.startsWith(prefix) ? v.slice(prefix.length) : v;
}

/**
 * 把新分配的 id 写回笔记 frontmatter（用户裁定「写回」）。
 *
 * 规则：
 *  · 已有 `id:` 行 ⇒ **原地替换**（⛔ 不追加重复键，YAML 重复键读起来是后者胜，但会制造噪音）；
 *  · 没有 `id:` 行 ⇒ 插到 `---` 之后的第一行（结构性字段排最前，与 `entryFrontmatter` 同序）；
 *  · 没有 frontmatter ⇒ 整个新建一段（只放 id/type/title 三个结构性字段，其余留空让下次保存补齐）。
 *
 * ⚠️ 换行风格必须**保持原样**：本仓文件有 CRLF 也有 LF，写回时按原文首个换行判定，
 *    否则一次导入会把整篇笔记的换行刷成另一种（git diff 会炸满屏）。
 */
export function writeIdIntoNote(text: string, id: string, type: EntryType, title: string): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const idLine = `id: ${q(id)}`;

    // 情形 ③：没有 frontmatter ⇒ 造一段
    if (lines[0]?.trim() !== '---') {
        return ['---', idLine, `type: ${type}`, `title: ${q(title)}`, '---', '', text].join(eol);
    }
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end < 0) {
        // `---` 开了头却没闭合：文件本身是坏的，别硬塞（交给用户自己修）
        return text;
    }
    const head = lines.slice(0, end + 1);
    const hasId = head.some((l) => /^\s*id\s*:/.test(l));
    if (hasId) {
        for (let i = 1; i < end; i++) {
            if (/^\s*id\s*:/.test(lines[i])) {
                lines[i] = idLine;
                break;
            }
        }
        return lines.join(eol);
    }
    head.splice(1, 0, idLine);
    return [...head, ...lines.slice(end + 1)].join(eol);
}
