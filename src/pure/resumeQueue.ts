/**
 * 「继续观看 / 阅读」队列（用户 m07854 ⑪ ①）。
 *
 * 用户原话：「首页页签计划页新增 tab「继续观看/阅读」队列（自动聚合所有状态为「在看」且
 * `last_position` 不为空的媒体，按最近活跃时间排序，可切卡片/列表视图）」
 *
 * 🔴 本仓**没有** `last_position` 这个字段（那是别处的叫法）。真实承载是两条：
 *    · 视频 —— `MediaEntry.videoPositions`（`Record<集下标字符串, 秒>`，见 data/types.ts:298）
 *    · 书籍 —— `MediaEntry.readingProgress`（`{ page?, totalPage?, percent? }`，见 data/types.ts:287）
 *    ⛔ 别为了对齐用户措辞去新造一个 `lastPosition` 字段：那会变成第二份真源，
 *       而播放器写的是 `videoPositions`（`main.ts persistVideoPosition`），必然漂移。
 *
 * 🔴 「最近活跃时间」也没有专门字段 —— 用 `updatedAt`（条目每次保存都会刷新，
 *    播放进度写回 `videoPositions` 也走 `service.update` ⇒ 会带动 `updatedAt`）。
 *    ⚠️ 刻意**不**混用 `progress.lastWatchedDate`：那只覆盖追番类，混进来会让
 *       「同一队列里两条数据的时间语义不同」，排序结果无法解释。
 */

import type { MediaEntry } from 'data/types';

/** 续播/续读的进度呈现 */
export interface ResumeSpot {
    /** `video` = 有播放位置；`read` = 有阅读进度 */
    kind: 'video' | 'read';
    /** 进度文案（「看到 12:34」「读至 42%」之类；容错，永不抛） */
    text: string;
    /** 0–100 的完成度（用于进度条；未知给 0） */
    percent: number;
}

/** 队列项：条目 + 它的续播位置 */
export interface ResumeItem {
    entry: MediaEntry;
    spot: ResumeSpot;
}

/** 秒 → `mm:ss` / `h:mm:ss`（⛔ 不复用播放器里的格式化：这里要容错负数与 NaN） */
function clockText(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const two = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/**
 * 取该条目的续播/续读位置。
 *
 * 返回 `null` 的三种情形（都算「没有可续的位置」，不该进队列）：
 *  ① 不是「在看」状态 —— 用户原话限定「状态为『在看』」
 *  ② 视频条目 `videoPositions` 为空/全是 0 秒（从没播过，或只播了 0 秒）
 *  ③ 书籍条目没有 `readingProgress.percent` 也没有 `page`（没读过）
 *
 * ⚠️ 只认「在看」是**用户明确口径**：想看 = 还没开始、已看 = 不需要续。
 */
export function resumeSpotOf(entry: MediaEntry): ResumeSpot | null {
    if (!entry || entry.status !== 'watching') return null;

    // ① 视频/音频：取**最大**的那个位置当代表（多集时「最近看的那集」未必最大，
    //    但本仓没有「上次播了哪集」的字段，用最大秒数至少不会把「看到 40 分钟」说成「看到 2 分钟」）。
    const positions = entry.videoPositions;
    if (positions) {
        let best = 0;
        for (const raw of Object.values(positions)) {
            const v = Number(raw);
            if (Number.isFinite(v) && v > best) best = v;
        }
        if (best > 0) {
            // 进度条：只有知道片长（`durationMin`，分钟）时才能算比例；
            // 算不出就给 0 —— ⛔ 别瞎猜成 50%，那比空着更误导。
            const minutes = Number(entry.durationMin);
            let pct = 0;
            if (Number.isFinite(minutes) && minutes > 0) {
                const totalSec = minutes * 60;
                // ⚠️ 位置**超出**片长也算 100%，不算 0 —— 超额只说明 `durationMin` 过期
                //    （换过片源 / 片长没回填），此时「看满了」比「没看过」诚实得多。
                pct = Math.max(0, Math.min(100, Math.round((best / totalSec) * 100)));
            }
            return { kind: 'video', text: `看到 ${clockText(best)}`, percent: pct };
        }
    }

    // ② 书籍：percent 优先，其次用 page/totalPage 换算
    const rp = entry.readingProgress;
    if (rp) {
        const fromPercent = Number(rp.percent);
        if (Number.isFinite(fromPercent) && fromPercent > 0) {
            const pct = Math.max(0, Math.min(100, Math.round(fromPercent)));
            return { kind: 'read', text: `读至 ${pct}%`, percent: pct };
        }
        const page = Number(rp.page);
        const total = Number(rp.totalPage);
        if (Number.isFinite(page) && page > 0 && Number.isFinite(total) && total > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((page / total) * 100)));
            return { kind: 'read', text: `读至 ${page}/${total} 页`, percent: pct };
        }
    }

    return null;
}

/**
 * 组装「继续观看 / 阅读」队列。
 *
 * 排序：`updatedAt` 倒序（最近动过的在前）。
 * ⚠️ 同 `updatedAt` 时用 `id` 兜底，保证**顺序稳定**（否则每次重排都可能换位置，
 *    用户会看到「刚才那张卡跳走了」的莫名现象）。
 */
export function buildResumeQueue(entries: readonly MediaEntry[]): ResumeItem[] {
    const out: ResumeItem[] = [];
    for (const e of entries ?? []) {
        const spot = resumeSpotOf(e);
        if (spot) out.push({ entry: e, spot });
    }
    out.sort((a, b) => {
        const ta = String(a.entry.updatedAt ?? '');
        const tb = String(b.entry.updatedAt ?? '');
        if (ta !== tb) return tb.localeCompare(ta);
        return String(a.entry.id).localeCompare(String(b.entry.id));
    });
    return out;
}
