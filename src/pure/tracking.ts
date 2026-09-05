// 阶段 1 追更/排期纯逻辑（可单测）：
//  - runSerialWithDelay：串行 + 间隔限流执行（防对反爬站点突发并发请求，替代 Promise.all 全并发）
//  - duePlannedEntries：排期到期列表（plannedDate <= today 且 status=want）
//  - decideUpdateDisplay：更新提示去重决策（latestKnownEpisode 落库基线，同集数不重复标新）

/** 串行执行 + 间隔限流：逐条调用 fn，每条之间等待 delayMs（delayMs<=0 不等待）。
 *  fn 抛错时中止后续执行（错误向上传播）。 */
export async function runSerialWithDelay<T>(
    items: T[],
    fn: (item: T, index: number) => Promise<void>,
    delayMs: number,
): Promise<void> {
    for (let i = 0; i < items.length; i++) {
        await fn(items[i], i);
        if (i < items.length - 1 && delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

interface PlannedEntryLike {
    id: string;
    status: string;
    plannedDate?: string;
}

/** 排期到期且待开始（status=want）的条目：plannedDate <= todayStr（YYYY-MM-DD 字符串比较即可）。 */
export function duePlannedEntries<T extends PlannedEntryLike>(entries: T[], todayStr: string): T[] {
    return entries.filter((e) => e.status === 'want' && !!e.plannedDate && e.plannedDate <= todayStr);
}

export type UpdateDisplay = 'new' | 'known' | 'synced';

/** 更新提示去重决策：
 *  - new   ：最新集 > 已知最新（或首次检测）→ 标 🆕，并把 latest 写回落库 latestKnownEpisode
 *  - known ：最新集 <= 已知最新（已提示过，未变化）→ 不再重复标 🆕
 *  - synced：最新集 <= 已看集数（用户已看到最新）→ ✅
 *  最新集为 0（无集数信息）时兜底 synced。 */
export function decideUpdateDisplay(latest: number, known: number | undefined, watched: number): UpdateDisplay {
    if (latest <= watched) return 'synced';
    if (known === undefined || latest > known) return 'new';
    return 'known';
}
