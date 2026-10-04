// 条目进度文本（纯逻辑下沉；2026-09-30 #444c）
//
// 🔴 为什么要单独一个模块：系列选择弹窗从「插件视图内的绝对定位浮层」改成**应用级 Modal**
//    （`modals/SeriesPickerModal.ts` + `views/components/SeriesPicker.svelte`），
//    而弹窗**不再长在 `MediaList` 组件里** —— 那行「状态 · 进度」小字必须能在两个组件之间
//    **共用同一份口径**。⛔ 别在两处各写一套：卡面与弹窗给出不一样的进度，用户一眼就看出「两个地方说的不是一回事」。
//
// ⚠️ 本模块**没有 obsidian、没有 DOM、没有 Svelte**，可单测（本仓「纯逻辑下沉」红线）。
import type { MediaEntry } from 'data/types';
import { statusLabel } from 'pure/labels';

/** 书籍进度单位：关联 TXT（按章节解析）→ 章，其余（PDF / 手填 / 豆瓣兜底）→ 页 */
export function bookUnitOf(e: { bookFile?: string } | null | undefined): string {
    return String(e?.bookFile ?? '').toLowerCase().endsWith('.txt') ? '章' : '页';
}

/**
 * 阅读进度百分比（0-100）：
 * 阅读器进度 `percent` 优先（自动落库）；无则回退**手填页码**进度；`未开始` 返回 `undefined`（不渲染灰线）。
 * ⚠️ 非书籍一律 `undefined`。
 */
export function readPercent(e: MediaEntry): number | undefined {
    if (e.type !== 'book') return undefined;
    const rp = e.readingProgress;
    if (typeof rp?.percent === 'number') return Math.max(0, Math.min(100, Math.round(rp.percent)));
    // 仅 totalPage（自动解析未手填当前页）：按 0 计算，进度行照常渲染（0/N）
    if (!rp?.totalPage) return undefined;
    return Math.max(0, Math.min(100, Math.round(((rp.page ?? 0) / rp.totalPage) * 100)));
}

/**
 * 列表视图的**进度列**：书籍页码 / 阅读百分比、追剧中的 S/E（带百分比）、游戏时长。
 * ⚠️ 剧集 / 动画**只在「在看」时**给 S/E —— 想看（待开始）/ 已看（已看完）/ 存档 谈「追到第几集」没有意义。
 */
export function listProgress(e: MediaEntry): { text: string; pct?: number } {
    if (e.type === 'book') {
        const rp = e.readingProgress;
        if (rp?.totalPage) {
            const p = rp.page ?? 0;
            return { text: `${p}/${rp.totalPage} ${bookUnitOf(e)}`, pct: readPercent(e) };
        }
        if (typeof rp?.percent === 'number') return { text: `已读 ${readPercent(e)}%`, pct: readPercent(e) };
        return { text: '' };
    }
    if ((e.type === 'tv' || e.type === 'anime') && e.status === 'watching' && e.progress) {
        const s = `S${e.progress.season}E${e.progress.episode}`;
        if (e.progress.totalEpisodes && e.progress.totalEpisodes > 0) {
            const pct = Math.max(0, Math.min(100, Math.round((e.progress.episode / e.progress.totalEpisodes) * 100)));
            return { text: s, pct };
        }
        return { text: s };
    }
    if (e.type === 'game' && e.playtimeMinutes) {
        return { text: `已玩 ${Math.round(e.playtimeMinutes / 60)}h` };
    }
    return { text: '' };
}

/**
 * **封面左下角**「已玩 Nh」角标的文本（仅游戏且有时长；其余一律空串）。
 *
 * 🔴 2026-10-01 #471（用户原话：「游戏类型海报墙上已玩 10h 放在游戏封面左下角用个标记」）：
 *    这段文本原先挂在**元信息区**的 `.rl-prog` 行（旧名 `cardProgressText`），本批**只搬呈现位置**
 *    （⇒ 封面角标 `.rl-cov-playtime`），取值口径一个字没改（`playtimeMinutes` 是分钟，按小时四舍五入）。
 * ⛔ 别再往这里加书籍页码那一档 —— 书籍进度走卡片自己的 `.rl-readrow`（百分比 + 进度条 + N/M 页），
 *    旧函数里那条分支在卡片上**从来没有消费者**（模板判据一直是 `e.type !== 'book'`），已随本批退场。
 * ⛔ 空值**不渲染角标**（封面不是元信息区，不留「-」空槽撑行高 —— 那条占位随旧行一起退场）。
 */
export function cardPlaytimeBadge(e: MediaEntry): string {
    if (e.type !== 'game' || !e.playtimeMinutes) return '';
    return `已玩 ${Math.round(e.playtimeMinutes / 60)}h`;
}

/**
 * 系列选择弹窗里每一格的**小字** = 「状态 · 进度」。
 * ⚠️ 口径与卡片 / 列表**同一份**：状态走 `statusLabel`（动画「在看」/ 书籍「在读」…），进度复用 `listProgress`。
 * 补一条：剧集 / 动画**没在追**时不显示 S/E（`listProgress` 有意如此），但这里仍给出「共 N 集」——
 * 挑季的时候「这一季有多少集」是有用信息，而列表进度列不需要它。
 */
export function seasonRowMeta(e: MediaEntry): string {
    const parts = [statusLabel(e.type, e.status)];
    const prog = listProgress(e).text;
    if (prog) parts.push(prog);
    else if ((e.type === 'tv' || e.type === 'anime') && (e.progress?.totalEpisodes ?? 0) > 0) {
        parts.push(`共 ${e.progress?.totalEpisodes} 集`);
    }
    return parts.join(' · ');
}
