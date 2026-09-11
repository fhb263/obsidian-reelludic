// 统计页「动态」时间轴纯逻辑（无 obsidian 依赖，可单测）
// 责任：①按 日/周/月/年 算日历范围；②把多个数据源（状态翻转日志 / 新增条目 / 追更 / 计划 / 游玩 / 完成日期）
//   归并成同一条时间轴并按范围过滤、去重、倒序；③按范围给出行首时间文案。
// 口径：范围一律**本地时区日历口径**（周 = 周一起算，月 = 当月，年 = 当年），与「今年动态」既有语义一致。
import type { ActivityEvent, EntryType, MediaEntry } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { statusLabel } from 'pure/labels';
import { formatPlaytime } from 'pure/playtime';
import { JOURNAL_HEADING_PREFIX, localDateOf, localTimeOf } from 'pure/dailyLog';

export type FeedRange = 'day' | 'week' | 'month' | 'year';

export interface FeedSpan {
    /** 起始本地日期（含） */
    start: string;
    /** 结束本地日期（含） */
    end: string;
    /** 标题后缀文案，如「9月10日」「本周 9月8日–9月14日」 */
    label: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const toStr = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** 'YYYY-MM-DD' → 'M月D日' */
const md = (s: string): string => `${Number(s.slice(5, 7))}月${Number(s.slice(8, 10))}日`;
/** 'YYYY-MM-DD' → 本地 Date（不要用 new Date(str)：那是 UTC 语义，负时区会回退一天） */
const fromStr = (s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};

/** ISO-8601 周号（周一起算、周四定归属年）；用于「第 N 周」文案 */
export function isoWeekOf(date: Date): number {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7; // 周一 = 0
    d.setDate(d.getDate() - day + 3); // 移动到本周周四（决定归属年）
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    const fDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fDay + 3);
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

/** 日历范围：日=当天 / 周=本周（周一起）/ 月=当月 / 年=当年 */
export function feedSpan(range: FeedRange, now: Date = new Date()): FeedSpan {
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    if (range === 'day') {
        const day = toStr(new Date(y, m, d));
        return { start: day, end: day, label: md(day) };
    }
    if (range === 'week') {
        const mondayOffset = (now.getDay() + 6) % 7; // 周一 = 0
        const start = toStr(new Date(y, m, d - mondayOffset));
        const end = toStr(new Date(y, m, d - mondayOffset + 6));
        return { start, end, label: `第 ${isoWeekOf(now)} 周（${md(start)}–${md(end)}）` };
    }
    if (range === 'month') {
        return { start: toStr(new Date(y, m, 1)), end: toStr(new Date(y, m + 1, 0)), label: `${y}年${m + 1}月` };
    }
    return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}年` };
}

export type FeedKind = 'status' | 'created' | 'track' | 'plan' | 'watch' | 'play';

export interface FeedItem {
    /** 条目 id */
    id: string;
    /** 条目标题（空标题 → 未命名） */
    title: string;
    type: EntryType;
    kind: FeedKind;
    /** 本地日期 YYYY-MM-DD（过滤与排序用） */
    date: string;
    /** 本地时刻 HH:mm；仅状态变更 / 新增这类带时间戳的事件有 */
    time?: string;
    /** 行内徽标文案（状态变更 = 类型化状态标签；其余 = 事件名） */
    text: string;
    /** 标题后的细节补充（追更 = `S1E2`；游玩 = `1.5h`），无则不显示 */
    detail?: string;
    /** 状态徽标着色用（仅 kind==='status'） */
    status?: MediaStatus;
}

const titleOf = (e: MediaEntry): string => (e.title.trim() ? e.title.trim() : '未命名');

/**
 * 归并某范围内的动态（倒序）。
 *  - status：状态翻转日志（activityLog，精确到分）
 *  - created：条目新增（createdAt，精确到分）
 *  - track：追更历史（progress.history[].date，仅日期）
 *  - plan：计划观看日期（plannedDate，仅日期）
 *  - watch：完成日期（watchedDate，仅日期）
 *  - play：游玩记录（playSessions[]，仅日期）
 * 去重：同一「条目 + 日期」若已有状态变更事件，则不再补 plan / watch ——
 *  设 plannedDate 与标「想看」、记 watchedDate 与标「已看」通常同一动作，避免一行变两行。
 * 已删除条目（不在 entries 中）的状态记录跳过；无标题用「未命名」。
 */
export function collectFeed(entries: MediaEntry[], log: ActivityEvent[] | undefined, span: FeedSpan): FeedItem[] {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const items: FeedItem[] = [];
    /** 「id|日期」已由状态变更占位 → plan/watch 不再补 */
    const statusKeys = new Set<string>();
    const seen = new Set<string>();

    // 1) 状态翻转（唯一带精确时刻的来源之一）
    for (const ev of Array.isArray(log) ? log : []) {
        if (!ev || typeof ev.at !== 'string') continue;
        const date = localDateOf(ev.at);
        if (!date || date < span.start || date > span.end) continue;
        const e = byId.get(ev.id);
        if (!e) continue; // 条目已删
        statusKeys.add(`${ev.id}|${date}`);
        items.push({
            id: e.id,
            title: titleOf(e),
            type: e.type,
            kind: 'status',
            date,
            time: localTimeOf(ev.at),
            text: statusLabel(e.type, ev.status),
            status: ev.status,
        });
    }

    // 2) 条目新增（另一处精确时刻）
    for (const e of entries) {
        const date = localDateOf(e.createdAt);
        if (!date || date < span.start || date > span.end) continue;
        const key = `new|${e.id}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id: e.id, title: titleOf(e), type: e.type, kind: 'created', date, time: localTimeOf(e.createdAt), text: '新增' });
    }

    for (const e of entries) {
        // 3) 追更历史
        for (const h of e.progress?.history ?? []) {
            const date = typeof h?.date === 'string' ? h.date.slice(0, 10) : '';
            if (!date || date < span.start || date > span.end) continue;
            const key = `track|${e.id}|${date}|${h.season}|${h.episode}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ id: e.id, title: titleOf(e), type: e.type, kind: 'track', date, text: '追更', detail: `S${h.season}E${h.episode}` });
        }
        // 4) 计划观看（与同日状态变更去重）
        const planned = e.plannedDate?.slice(0, 10);
        if (planned && planned >= span.start && planned <= span.end && !statusKeys.has(`${e.id}|${planned}`)) {
            const key = `plan|${e.id}|${planned}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push({ id: e.id, title: titleOf(e), type: e.type, kind: 'plan', date: planned, text: '计划观看' });
            }
        }
        // 5) 完成日期（与同日状态变更去重）
        const watched = e.watchedDate?.slice(0, 10);
        if (watched && watched >= span.start && watched <= span.end && !statusKeys.has(`${e.id}|${watched}`)) {
            const key = `watch|${e.id}|${watched}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push({ id: e.id, title: titleOf(e), type: e.type, kind: 'watch', date: watched, text: statusLabel(e.type, 'watched') });
            }
        }
        // 6) 游玩记录
        for (const s of e.playSessions ?? []) {
            const date = typeof s?.date === 'string' ? s.date.slice(0, 10) : '';
            if (!date || date < span.start || date > span.end) continue;
            const key = `play|${e.id}|${date}|${s.minutes}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const dur = formatPlaytime(s.minutes);
            items.push({ id: e.id, title: titleOf(e), type: e.type, kind: 'play', date, text: '游玩', detail: dur || undefined });
        }
    }

    // 倒序：日期 desc；同日有精确时刻的按时刻倒序，仅日期事件排当天最后（用 '00:00' 兜底）
    return items.sort((a, b) => {
        const ka = `${a.date} ${a.time ?? '00:00'}`;
        const kb = `${b.date} ${b.time ?? '00:00'}`;
        return kb.localeCompare(ka);
    });
}

/** 行首时间文案：日视图 → HH:mm（仅日期事件 → ''）；周/月/年 → M月D日 [HH:mm] */
export function formatFeedTime(item: FeedItem, range: FeedRange): string {
    if (range === 'day') return item.time ?? '';
    return item.time ? `${md(item.date)} ${item.time}` : md(item.date);
}


// ──────────── 周期汇总（周 / 月 / 年视图：不再逐日罗列，改为「这个周期看了什么」） ────────────

/** 汇总行：同一语义的事件合并成一行（如「已读《A》《B》」） */
export interface FeedRow {
    key: string;
    /** 行首标签（类型化状态标签 / 新增 / 追更 / 计划 / 游玩） */
    label: string;
    items: FeedItem[];
}

export interface FeedGroup {
    key: string;
    /** 组标题：周视图 = 日期（`9月10日`）、月视图 = 周次（`第 37 周`）、年视图 = 月份（`9月`） */
    label: string;
    /** 组标题旁的次要区间说明（月视图分组时给「9月7日–9月13日」） */
    range?: string;
    rows: FeedRow[];
    total: number;
}

/** 行序：状态类按流程走（想看→在看→已看→存档），其余按 新增 / 追更 / 计划 / 游玩 */
const STATUS_ORDER: Record<MediaStatus, number> = { want: 0, watching: 1, watched: 2, archived: 3 };
const KIND_ORDER: Record<FeedKind, number> = { status: 0, watch: 1, created: 2, track: 3, plan: 4, play: 5 };

/** 行标签（也是行的归并键之一）：状态/完成用类型化标签，其余用事件名 */
function rowLabelOf(it: FeedItem): string {
    if (it.kind === 'status' || it.kind === 'watch') return it.text;
    if (it.kind === 'created') return '新增';
    if (it.kind === 'track') return '追更';
    if (it.kind === 'plan') return '计划';
    return '游玩';
}

/** 行排序键：先看事件大类，状态类内再按状态流程 */
function rowOrderOf(it: FeedItem): string {
    const k = it.kind === 'watch' ? 'status' : it.kind;
    const st = it.status ? STATUS_ORDER[it.status] : 0;
    return `${String(KIND_ORDER[it.kind]).padStart(2, '0')}-${String(st).padStart(2, '0')}-${rowLabelOf(it)}`;
}

/** 某天所属 ISO 周：键（含归属年，防跨年撞车）、周号、该周周一~周日区间文案 */
function weekInfo(date: string): { key: string; week: number; range: string } {
    const dt = fromStr(date);
    // ⚠️ getMonth() 是 0 基：这里传给 Date 构造器时**不要再 -1**
    const monday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - ((dt.getDay() + 6) % 7));
    const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3); // ISO 归属年由周四决定
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return {
        key: `${thursday.getFullYear()}-W${String(isoWeekOf(dt)).padStart(2, '0')}`,
        week: isoWeekOf(dt),
        range: `${md(toStr(monday))}–${md(toStr(sunday))}`,
    };
}

/**
 * 周期汇总：把一个周期的动态归并成「已读《A》《B》」这样的行。
 *  **逐级细分**：周视图按日分块、月视图按周分块、年视图按月分块（都是「看这个周期里的每个小周期看了什么」）。
 *  - 年视图按月分组（组标题 = `M月`），周/月视为单组（组标题留空，由面板标题承担）；
 *  - 组内按语义归并成行（同一行内**按条目去重**，避免同一部作品重复列名）；
 *  - 组按时间倒序（年视图最新月份在前），行按固定语义顺序（稳定可预期）。
 */
export function groupFeed(items: FeedItem[], range: Exclude<FeedRange, 'day'>): FeedGroup[] {
    /** 每条动态归到哪个小周期：周→日 / 月→周 / 年→月 */
    const groupOf = (it: FeedItem): { key: string; label: string; range?: string } => {
        if (range === 'week') return { key: it.date, label: md(it.date) };
        if (range === 'month') {
            const w = weekInfo(it.date);
            return { key: w.key, label: `第 ${w.week} 周`, range: w.range };
        }
        return { key: it.date.slice(0, 7), label: `${Number(it.date.slice(5, 7))}月` };
    };

    const byGroup = new Map<string, { label: string; range?: string; items: FeedItem[] }>();
    for (const it of items) {
        const g = groupOf(it);
        const cur = byGroup.get(g.key);
        if (cur) cur.items.push(it);
        else byGroup.set(g.key, { label: g.label, range: g.range, items: [it] });
    }
    const groups: FeedGroup[] = [];
    for (const [key, grp] of byGroup) {
        const { items: arr } = grp;
        const rowMap = new Map<string, FeedRow & { order: string }>();
        for (const it of arr) {
            const label = rowLabelOf(it);
            const rk = `${it.kind}|${label}`;
            let row = rowMap.get(rk);
            if (!row) {
                row = { key: rk, label, items: [], order: rowOrderOf(it) };
                rowMap.set(rk, row);
            }
            if (!row.items.some((x) => x.id === it.id)) row.items.push(it); // 同一行内按条目去重
        }
        const rows = [...rowMap.values()].sort((a, b) => a.order.localeCompare(b.order)).map(({ order: _o, ...r }) => r);
        groups.push({ key, label: grp.label, range: grp.range, rows, total: arr.length });
    }
    return groups.sort((a, b) => b.key.localeCompare(a.key));
}


// ──────────── 日记打卡：周期块（「记录到日记」跟随 日/周/月/年） ────────────

/** 范围词：按钮「记录今天/本周/本月/今年」、空态与提示文案共用 */
export const FEED_RANGE_WORDS: Record<FeedRange, string> = { day: '今天', week: '本周', month: '本月', year: '今年' };

/**
 * 日记打卡区块的标识（区块标题后缀，也是幂等替换的定位键）：
 *  日 = `2026-09-10` / 周 = `第 37 周（2026-09-07–09-13）` / 月 = `2026-09` / 年 = `2026`。
 *  带年份是为了跨年不撞键。
 */
export function feedSectionLabel(range: FeedRange, span: FeedSpan): string {
    if (range === 'day') return span.start;
    if (range === 'week') return `第 ${isoWeekOf(fromStr(span.start))} 周（${span.start}–${span.end.slice(5)}）`;
    if (range === 'month') return span.start.slice(0, 7);
    return span.start.slice(0, 4);
}

/** 行的 markdown 文本：`已读《A》《B》`（追更/游玩带 detail 后缀） */
function rowToMarkdown(row: FeedRow): string {
    const titles = row.items.map((i) => `《${i.title}》${i.detail ? ` ${i.detail}` : ''}`).join('');
    return `${row.label}${titles}`;
}

/**
 * 渲染周期打卡区块（周/月/年）——结构与统计页面板一致（分块 + 归并行），便于日记里直接读：
 * ```
 * ## ReelLudic 打卡 · 第 37 周（2026-09-07–09-13）
 * > [!reelludic] 本周 12 条动态
 * > **9月10日**（3 条）
 * > - 已看《咒》
 * > - 追更《剧名》 S1E2
 * ```
 * 空周期 → null（调用方据此提示、不写文件）。
 */
export function renderPeriodBlock(range: Exclude<FeedRange, 'day'>, span: FeedSpan, groups: FeedGroup[]): string | null {
    const total = groups.reduce((n, g) => n + g.total, 0);
    if (total === 0) return null;
    const lines = [
        `${JOURNAL_HEADING_PREFIX}${feedSectionLabel(range, span)}`,
        `> [!reelludic] ${FEED_RANGE_WORDS[range]} ${total} 条动态`,
    ];
    for (const g of groups) {
        lines.push(`> **${g.label}**${g.range ? `（${g.range}）` : ''}（${g.total} 条）`);
        for (const row of g.rows) lines.push(`> - ${rowToMarkdown(row)}`);
    }
    return lines.join('\n');
}
