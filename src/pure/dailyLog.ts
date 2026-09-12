/**
 * 「今日记录」/ 日记打卡（纯逻辑，无 IO、无 obsidian 依赖）
 *
 * 数据口径：
 *  - 「今天」一律按**本地时区**判定（createdAt / activityLog.at 都是 UTC ISO 串，
 *    直接 slice(0,10) 在 GMT+8 会把凌晨 0-8 点的记录算到前一天，故统一走 localDateOf）。
 *  - 「新增条目」取 MediaEntry.createdAt（存量数据无需迁移即可回溯）；
 *    「状态变更」取 catalog.activityLog（仅记录状态翻转，见 data/types ACTIVITY_EVENT）。
 *  - 已删除条目的状态记录不再展示（标题按 id 现查）。
 */
import type { ActivityEvent, EntryType, MediaEntry } from 'data/types';
import type { MediaStatus } from 'pure/status';
import { statusLabel } from 'pure/labels';

/** 日记打卡区块的标题前缀（幂等替换时按它定位；日期后缀 = YYYY-MM-DD） */
export const JOURNAL_HEADING_PREFIX = '## ReelLudic 打卡 · ';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** ISO → 本地日期 YYYY-MM-DD；非法输入 → ''（不抛错、不产出 NaN） */
export function localDateOf(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ISO → 本地时间 HH:mm；非法输入 → '' */
export function localTimeOf(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 今天的本地日期 YYYY-MM-DD */
export function todayLocal(now: Date = new Date()): string {
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export interface DayCreatedItem {
    id: string;
    title: string;
    time: string;
}

export interface DayStatusItem {
    id: string;
    title: string;
    type: EntryType;
    status: MediaStatus;
    time: string;
}

export interface DayActivity {
    /** 当天新增条目（按时间升序） */
    created: DayCreatedItem[];
    /** 当天状态翻转（按时间升序） */
    statuses: DayStatusItem[];
    /** 动态总条数 = created + statuses（0 = 今天还没动过） */
    total: number;
}

const titleOf = (e: MediaEntry): string => (e.title.trim() ? e.title.trim() : '未命名');

/** 归集某一天的动态：新增条目（createdAt）+ 状态翻转（activityLog） */
export function collectDayActivity(
    entries: MediaEntry[],
    log: ActivityEvent[] | undefined,
    dateStr: string,
): DayActivity {
    const created: DayCreatedItem[] = entries
        .filter((e) => localDateOf(e.createdAt) === dateStr)
        .map((e) => ({ id: e.id, title: titleOf(e), time: localTimeOf(e.createdAt) }))
        .sort((a, b) => a.time.localeCompare(b.time));

    const byId = new Map(entries.map((e) => [e.id, e]));
    const statuses: DayStatusItem[] = (Array.isArray(log) ? log : [])
        .filter((ev) => ev && localDateOf(ev.at) === dateStr)
        .filter((ev) => byId.has(ev.id)) // 条目已删 → 不再展示
        .map((ev) => {
            const e = byId.get(ev.id) as MediaEntry;
            return { id: e.id, title: titleOf(e), type: e.type, status: ev.status, time: localTimeOf(ev.at) };
        })
        .sort((a, b) => a.time.localeCompare(b.time));

    return { created, statuses, total: created.length + statuses.length };
}

/** 渲染日记打卡区块（Markdown）；当天无动态 → null（调用方据此提示，不写文件） */
export function renderJournalBlock(dateStr: string, act: DayActivity): string | null {
    if (act.total === 0) return null;
    const lines = [`${JOURNAL_HEADING_PREFIX}${dateStr}`, `> [!reelludic] 今日 ${act.total} 条动态`];
    for (const s of act.statuses) lines.push(`> - ${s.time} ${statusLabel(s.type, s.status)}《${s.title}》`);
    if (act.created.length) lines.push(`> 新增条目 ${act.created.length}：${act.created.map((c) => c.title).join(' / ')}`);
    return lines.join('\n');
}

/** 区块结束位置：下一个 `## ` 标题行（任意二级标题）或文件末尾 */
function sectionEnd(lines: string[], start: number): number {
    for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) return i;
    return lines.length;
}

/**
 * 幂等写入打卡区块：已有同标识区块 → 整体替换；否则追加到文末。
 * `sectionLabel` 是区块标识（日=`2026-09-10` / 周=`第 37 周（…）` / 月=`2026-09` / 年=`2026`），
 * 不同范围的区块天然互不覆盖。只动本区块，其余内容（含相邻区块）原样保留；重复执行结果不变。
 */
export function upsertJournalSection(note: string, sectionLabel: string, block: string): string {
    const heading = `${JOURNAL_HEADING_PREFIX}${sectionLabel}`;
    const lines = note.split('\n');
    const idx = lines.findIndex((l) => l.trim() === heading);
    if (idx < 0) {
        const body = note.trimEnd();
        return body ? `${body}\n\n${block}\n` : `${block}\n`;
    }
    const end = sectionEnd(lines, idx);
    const head = lines.slice(0, idx);
    const tail = lines.slice(end);
    // 头部与尾部分别清掉紧邻的空行，再用标准空行拼接（保证幂等）
    while (head.length && head[head.length - 1].trim() === '') head.pop();
    while (tail.length && tail[0].trim() === '') tail.shift();
    const out = [...head, ...(head.length ? [''] : []), ...block.split('\n'), ...(tail.length ? ['', ...tail] : [])];
    while (out.length && out[out.length - 1].trim() === '') out.pop(); // 收敛行尾空行，保证幂等
    return out.join('\n') + '\n';
}
