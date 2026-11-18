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
import { formatBadgeTime } from 'pure/playtime';

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
 *    （⇒ 封面角标 `.rl-cov-playtime`）。
 * 🔴 m04435 ④（用户逐条给了示例）：**取值改成 `formatBadgeTime`** ——
 *    分钟向下取整后按 `59min` / `1h` / `1h1min` / `2h` 呈现。
 *    旧实现是 `Math.round(playtimeMinutes / 60)` + `h`，25 分钟会显示成「已玩 0h」（把半小时内的游玩抹成 0）；
 *    新口径下同样的 25 分钟是「已玩 25min」，用户能看见自己确实玩过。
 * ⛔ 别再往这里加书籍页码那一档 —— 书籍进度走卡片自己的 `.rl-readrow`（百分比 + 进度条 + N/M 页），
 *    旧函数里那条分支在卡片上**从来没有消费者**（模板判据一直是 `e.type !== 'book'`），已随本批退场。
 * ⛔ 空值**不渲染角标**（封面不是元信息区，不留「-」空槽撑行高 —— 那条占位随旧行一起退场）。
 */
export function cardPlaytimeBadge(e: MediaEntry): string {
    if (e.type !== 'game' || !e.playtimeMinutes) return '';
    const t = formatBadgeTime(e.playtimeMinutes);
    return t ? `已玩 ${t}` : '';
}

/**
 * 书籍**阅读时长**角标的文本（#537；仅书籍且有时长；其余一律空串）——与上方游戏角标**同一个封面角落**。
 *
 * 🔴 用户原话（2026-10-05）：「显示在海报墙上『已读 2h』」。
 *   · 位置 = 封面左下角，**复用**游戏那枚 `.rl-cov-playtime` 的类与几何（同一角落只该有一套尺寸；
 *     ⛔ 别新造 `.rl-cov-readtime` —— 那会让 #530 的「序号避让」父级 `:has()` 规则漏掉书籍卡）；
 *   · 🔴 m04435 ④：取值改走 `formatBadgeTime`（`59min` / `1h` / `1h59min` / `2h`），
 *     与游戏「已玩」**同一套角标口径** —— 用户这轮的原话就是「已读 / 已听 / 已玩**统一**」。
 *     旧的 `formatPlaytime`（`0.5h` / `12.5h`）已退场：它把「59 分钟读了一小时不到」显示成 `1h` 满格，
 *     角标在封面上就那么大，小数小时的可读性远不如 `59min`。
 *   · 与 `.rl-readrow` 的「已读 X%」**不是一回事**：那条是阅读**进度**，这条是阅读**耗时**，两行并存。
 * ⛔ 空值**不渲染角标**（封面不留空槽）。
 */
export function cardReadBadge(e: MediaEntry): string {
    if (e.type !== 'book' || !e.readMinutes) return '';
    const t = formatBadgeTime(e.readMinutes);
    return t ? `已读 ${t}` : '';
}

/**
 * 音乐**收听时长**角标的文本（🔴 m02288；仅音乐且有时长；其余一律空串）。
 *
 * 用户原话（m02288）：「用音乐播放器播放每首音乐要统计总时长列在卡片网格封面左上角上统一，
 * 而不是让用户手动记录」。
 * 🔴 位置裁定（用户当场选的选项）：「**和游戏/书籍保持在底部原位**」——
 *    所以它复用同一个封面角落与**同一个类名** `.rl-cov-playtime`（`.rl-cov-foot-top` 那一行），
 *    ⛔ 没有新造「左上角」角标（用户否掉了那个方案）。
 *
 * 取值 = `listenMinutes`（播放器自动累计 + 「记录时长」手动补记，两者落的是同一个字段）；
 * 🔴 m04435 ④：格式化改走 `formatBadgeTime`（`59min` / `1h` / `1h59min` / `2h`）——
 *    用户这轮把「已读 / 已听 / 已玩」三枚的**单位口径统一**了，三处必须同源，⛔ 别留一个走老函数。
 * ⛔ 空值不渲染角标（封面不留空槽，与另外两枚同一条纪律）。
 */
export function cardListenBadge(e: MediaEntry): string {
    if (e.type !== 'music' || !e.listenMinutes) return '';
    const t = formatBadgeTime(e.listenMinutes);
    return t ? `已听 ${t}` : '';
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
