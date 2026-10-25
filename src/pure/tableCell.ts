// 表格视图的**单元格**读写（pure/tableCell，#621）
//
// 表格里一格的完整生命周期：**读**（`tableCellText`）→ 用户改 → **解析**（`parseTableCellInput`，
// 产出 `Partial<MediaEntry>`）→ 宿主写回（`EntryService.update` + `writeNote`）。
// 本模块只做前两步 —— ⛔ 不碰 obsidian API、不碰磁盘。
//
// 🔴 **这里是「元数据键 ⇄ `MediaEntry` 字段」的唯一真源**。为什么要单独一份：
//    frontmatter 键名（`duration_min`）与条目字段名（`durationMin`）**不是同名**，
//    而嵌套字段（`progress_episode` → `entry.progress.episode`）连层级都不一样。
//    这套对应关系散在 `noteGenerator`（写侧）与 `noteEditable`（读侧）里各写了一遍，
//    表格是**第三个消费者** —— 再散一份出来，三处迟早不一致（本仓已有 `artist` 这个先例）。
//    ⚠️ 本模块**不**替代那两个真源（它们仍在各自管辖写/读笔记），只服务「表格格子里改一个值」这条路径。
//
// 🔴 **嵌套字段必须整体重建**：`EntryService.update` 是 `{...prev, ...patch}` 的**浅合并** ⇒
//    传 `{ progress: { episode: 5 } }` 会把 `season` / `history` / `totalEpisodes` **整个抹掉**。
//    所以每个嵌套字段的 `set` 都先把**同级字段补齐**再覆盖目标字段（见 `nestedProgress`）。
import type { EntryType, MediaEntry, Progress } from 'data/types';
import { statusLabel } from 'pure/labels';
import { findMetaField } from 'pure/metaFields';
import { normalizeRating, ratingToTenths, type Rating } from 'pure/rating';
import { MEDIA_STATUSES, isMediaStatus, type MediaStatus } from 'pure/status';

/** 一格的值在 `MediaEntry` 里的读写位置 */
interface CellBinding {
    get(e: MediaEntry): unknown;
    /** 把新值包成 `Partial<MediaEntry>`；⚠️ 允许收 `undefined`（= 清空） */
    set(v: unknown, e: MediaEntry): Partial<MediaEntry>;
}

/** 顶层同名字段（大多数字段都是这种：键名只有大小写/下划线的差别） */
function flat(field: keyof MediaEntry): CellBinding {
    return {
        get: (e) => e[field],
        set: (v) => ({ [field]: v }) as Partial<MediaEntry>,
    };
}

/** 剧集进度：`progress.season` / `.episode` / `.totalEpisodes`（浅合并 ⇒ 必须补齐同级） */
function nestedProgress(field: 'season' | 'episode' | 'totalEpisodes'): CellBinding {
    return {
        get: (e) => e.progress?.[field],
        set: (v, e) => ({
            progress: {
                season: e.progress?.season ?? 1,
                episode: e.progress?.episode ?? 0,
                history: e.progress?.history ?? [],
                ...(e.progress?.totalEpisodes !== undefined ? { totalEpisodes: e.progress.totalEpisodes } : {}),
                ...(e.progress?.lastWatchedDate !== undefined ? { lastWatchedDate: e.progress.lastWatchedDate } : {}),
                [field]: v,
            } as Progress,
        }),
    };
}

/** 书籍阅读进度：`readingProgress.page` / `.totalPage`（`percent` 不动 —— 那是阅读器的口径，⛔ 别手改） */
function nestedReading(field: 'page' | 'totalPage'): CellBinding {
    const rebuild = (v: unknown, e: MediaEntry): Partial<MediaEntry> => {
        const next: { page?: number; totalPage?: number; percent?: number } = { ...(e.readingProgress ?? {}) };
        if (typeof v === 'number' && Number.isFinite(v)) next[field] = v;
        else delete next[field];
        return { readingProgress: Object.keys(next).length ? next : undefined };
    };
    return { get: (e) => e.readingProgress?.[field], set: rebuild };
}

/**
 * 全部可编辑列的读写表。
 * ⚠️ 键必须与 `pure/tableColumns.tableColumnPoolFor` 的产出**逐一对上**（`tests/tableColumns.test.ts`
 *    有一条守卫钉住「池子里的可编辑列在这里都有绑定」—— 少一条，那一列点开就写不回去）。
 */
const TABLE_CELL_BINDINGS: Record<string, CellBinding> = {
    // 通用
    status: flat('status'),
    rating: flat('rating'),
    year: flat('year'),
    genres: flat('genres'),
    series: flat('series'),
    series_index: flat('seriesIndex'),
    watched_date: flat('watchedDate'),
    planned_date: flat('plannedDate'),
    aliases: flat('aliases'),
    // 影视
    director: flat('director'),
    cast: flat('cast'),
    screenwriter: flat('screenwriter'),
    country: flat('country'),
    language: flat('language'),
    duration_min: flat('durationMin'),
    progress_season: nestedProgress('season'),
    progress_episode: nestedProgress('episode'),
    progress_total_episodes: nestedProgress('totalEpisodes'),
    // 书籍
    author: flat('author'),
    translator: flat('translator'),
    publisher: flat('publisher'),
    producer: flat('producer'),
    isbn: flat('isbn'),
    binding: flat('binding'),
    price: flat('price'),
    reading_page: nestedReading('page'),
    reading_total_page: nestedReading('totalPage'),
    page_count: flat('pageCount'),
    read_minutes: flat('readMinutes'),
    // 游戏
    platform: flat('platform'),
    developer: flat('developer'),
    playtime_minutes: flat('playtimeMinutes'),
    // 音乐
    album: flat('album'),
};

/** 这一列能不能在格子里改（虚拟列 / 未登记键 = 不能） */
export function hasTableCellBinding(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(TABLE_CELL_BINDINGS, key);
}

/**
 * 单元格的**显示文本**（空值 → `''`，由调用方渲染 `—` 占位 —— 与卡片信息栏同款口径）。
 * ⚠️ `status` / `rating` 两列在组件里走专属渲染（状态徽标 / 蓝星），不走本函数。
 */
export function tableCellText(e: MediaEntry, key: string): string {
    const b = TABLE_CELL_BINDINGS[key];
    if (!b) return '';
    const v = b.get(e);
    if (v === undefined || v === null || v === '') return '';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

/**
 * 状态输入：认**值**（`watching`）也认**中文标签**（`在看`）。
 * 🔴 反查 `statusLabel` 而不是手写第二份标签表 —— 标签表只有一处（`pure/labels`），
 *    这里再抄一份就是「同一个概念两份文案」的老病根。
 */
function statusFromText(type: EntryType, text: string): MediaStatus | undefined {
    if (isMediaStatus(text)) return text;
    for (const s of MEDIA_STATUSES) {
        if (statusLabel(type, s) === text) return s;
    }
    return undefined;
}

/**
 * 单元格进入编辑时**预填**的文本。
 * 🔴 两处与显示文本不同：
 *    · `rating` 按 **10 分制**预填（`9/10`）—— 与编辑表单里那个输入框同口径（半星在纯文本里没法表达，
 *      直接填 `4.5` 又不合用户「9 分」的习惯，用户点名要「如 9/10」）；
 *    · `status` 预填**中文标签**（`在看`）—— 那是界面上看得见的形态，⛔ 别让用户对着 `watching` 猜。
 */
export function tableCellDraft(e: MediaEntry, key: string): string {
    if (key === 'rating') {
        const r = normalizeRating(e.rating);
        return r > 0 ? `${ratingToTenths(r)}/10` : '';
    }
    if (key === 'status') return statusLabel(e.type, e.status);
    return tableCellText(e, key);
}

/**
 * 把用户输入解析成该列的**写回 patch**。
 * 🔴 不可解析时**不静默吞掉**：返回 `ok: false` + 一句人话原因，由组件提示。
 *    静默吞掉的后果是「我明明改了，它自己变回去了」—— 而用户**完全不知道哪里不对**。
 */
export type TableCellParse =
    | { ok: true; patch: Partial<MediaEntry> }
    | { ok: false; reason: string };

/** 列表类字段的输入拆分：`,` / `，` 分隔，去空白、丢空项（`科幻, 灾难` → `['科幻','灾难']`） */
function splitListText(t: string): string[] {
    return t
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

/**
 * 评分输入：`9/10`（带分母）或 `4.5` / `9`（不带分母）。
 *
 * 🔴 **档位判定是无歧义的**（三条互不重叠的区间）：
 *    · 带分母 ⇒ 按 `value / denom × 5` 折算（`9/10` → 4.5、`4.5/5` → 4.5）；
 *    · 不带分母且 ≤ 5 ⇒ 按**存储刻度**直读（`4.5` → 4.5）；
 *    · 不带分母且 > 5（≤ 10）⇒ 只可能是 10 分制（5 分制里不存在这个区间）⇒ 除以 2（`9` → 4.5）。
 *    这样「用户清空后直接敲 9」不会静默变成 5 分（旧口径的钳制行为），而是得到他想要的 4.5。
 * ⚠️ 越界（`13` / `13/10` / `0/0`）一律 `null` = 拒绝，由调用方提示 —— ⛔ 别钳制：
 *    「我明明输了 13」与「它自己变成 5」之间用户找不到因果。
 */
export function parseRatingCell(text: string): Rating | null {
    const m = text.trim().match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/);
    if (!m) return null;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return null;
    if (m[2] === undefined) {
        if (value > 10) return null;
        return normalizeRating(value > 5 ? value / 2 : value);
    }
    const denom = Number(m[2]);
    if (!Number.isFinite(denom) || denom <= 0 || value > denom) return null;
    return normalizeRating((value / denom) * 5);
}

/** 解析一格输入（`key` 决定按哪种形态校验；`e` 供嵌套字段重建同级） */
export function parseTableCellInput(e: MediaEntry, key: string, text: string): TableCellParse {
    const b = TABLE_CELL_BINDINGS[key];
    if (!b) return { ok: false, reason: '这一列不可编辑' };
    const t = text.trim();

    // ── 清空 ────────────────────────────────────────────────────────────────
    if (!t) {
        // 🔴 季 / 集在数据模型里**非空**（`Progress.season` / `.episode` 是必填）⇒「清空」语义 =
        //    回到初始态 S1E0（与宿主「快捷关联」重建 progress 时的缺省完全一致），⛔ 不是删掉这个键。
        if (key === 'progress_season') return { ok: true, patch: b.set(1, e) };
        if (key === 'progress_episode') return { ok: true, patch: b.set(0, e) };
        return { ok: true, patch: b.set(undefined, e) };
    }

    const kind = findMetaField(key)?.kind ?? 'string';

    if (key === 'rating') {
        const r = parseRatingCell(t);
        if (r === null) return { ok: false, reason: '评分填 0~5，或 0~10（如 9/10 = 4.5 星）' };
        return { ok: true, patch: b.set(r, e) };
    }
    if (kind === 'number') {
        // 🔴 年份单独收紧到 4 位：`26` 这种手滑会让条目从所有年份筛选里消失，而且**看不出错**
        if (key === 'year' && !/^\d{4}$/.test(t)) return { ok: false, reason: '年份要 4 位数字' };
        if (!/^\d+$/.test(t)) return { ok: false, reason: '这一列要填非负整数' };
        return { ok: true, patch: b.set(Number(t), e) };
    }
    if (kind === 'enum') {
        // ⚠️ 值的形态与**中文标签**都收（用户看到的是「在看」，没道理逼他记住 `watching`）
        const sv = statusFromText(e.type, t);
        if (!sv) return { ok: false, reason: '状态只认 想看 / 在看 / 已看 / 搁置（或 want / watching / watched / archived）' };
        return { ok: true, patch: b.set(sv, e) };
    }
    if (kind === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { ok: false, reason: '日期要写成 2026-10-13' };
        return { ok: true, patch: b.set(t, e) };
    }
    if (kind === 'list') return { ok: true, patch: b.set(splitListText(t), e) };
    return { ok: true, patch: b.set(t, e) };
}

/**
 * 「这一格**当前值**」对应的 patch —— 撤销栈用它把格子改回原样。
 * 🔴 刻意复用 `set`：撤销与写入走**同一条**重建路径（嵌套字段的同级补齐也照做），
 *    ⛔ 别在撤销时另写一套「把值塞回去」（那正是「撤销只改判据不改出口」这类病根）。
 */
export function tableCellCurrentPatch(e: MediaEntry, key: string): Partial<MediaEntry> | undefined {
    const b = TABLE_CELL_BINDINGS[key];
    if (!b) return undefined;
    return b.set(b.get(e), e);
}
