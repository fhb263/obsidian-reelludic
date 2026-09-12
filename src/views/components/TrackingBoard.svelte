<script lang="ts">
    // 追更表：只显示「在看」条目，表格化呈现进度、更新检测与活跃度
    // 参考 Bangumi-Bridge-Obsidian 追番脚本（DataViewJS）的概念移植：
    //   只看在看 → 更新检测（🆕已更新X集 置顶）→ 活跃/滞后置顶排序 → 直达观看
    //   更新检测（网站）：抓观看网址 HTML 提取最新集数 - 已看集数 = 更新数（本地文件夹检测未移植，用户明确不需要）
    import { statusLabel, isTrackingType } from 'pure/labels';
    import type { MediaEntry } from 'data/types';
    import type { UpdateCheckResult } from 'pure/updateCheck';
    import { runSerialWithDelay, decideUpdateDisplay } from 'pure/tracking';
    import Icon from './Icon.svelte';

    export let entries: MediaEntry[] = [];
    export let posterUrl: (e: MediaEntry) => string | undefined = () => undefined;
    export let onOpenEntry: (id: string) => void = () => {};
    export let onEditEntry: (id: string) => void = () => {};
    export let onOpenLink: (url: string) => void = () => {};
    /** 网站更新检测：返回 null=无观看网址；失败/无集数信息/站点拦截在 result.error/status 区分；force=跳过缓存 */
    export let onCheckUpdate: (url: string, watched: number, force?: boolean) => Promise<UpdateCheckResult | null> = async () => null;
    /** A2 落库：检测到比已知最新更新的集数时写回条目（去重基线，供下次秒显；不重写笔记） */
    export let onSaveLatestKnown: (id: string, latestEpisode: number) => Promise<void> = async () => {};
    /** 追番表「从 Bangumi 导入」：打开导入弹窗（HomeView 侧负责创建 Modal） */
    export let onImportBangumi: () => void = () => {};

    /** 更新检测结果：id → 结果 | 'checking'（检测中） | null（无观看网址） */
    let updateMap: Record<string, UpdateCheckResult | 'checking' | null> = {};
    let checking = false;

    /** 检测目标 = 第一个观看链接（与「观看」按钮一致） */
    function watchUrlOf(e: MediaEntry): string | undefined {
        return e.links[0]?.url;
    }

    /** 串行 + 间隔限流检测（防对反爬站点突发并发请求）：有 latestKnownEpisode 落库值的条目先秒显已知结果，再后台刷新 */
    async function runChecks(force: boolean = false) {
        const pool = entries.filter((e) => e.status === 'watching' && isTrackingType(e.type));
        if (pool.length === 0) {
            updateMap = {};
            checking = false;
            return;
        }
        checking = true;
        // 初始态：有落库已知最新集的条目直接秒显（不闪「检测中」），其余标记检测中
        const init: Record<string, UpdateCheckResult | 'checking' | null> = {};
        pool.forEach((e) => {
            const known = e.latestKnownEpisode ?? 0;
            const watched = e.progress?.episode ?? 0;
            if (known > 0) {
                init[e.id] = {
                    status: known > watched ? 'updated' : 'synced',
                    latestEpisode: known,
                    watchedEpisodes: watched,
                    updateCount: Math.max(0, known - watched),
                };
            } else {
                init[e.id] = 'checking';
            }
        });
        updateMap = init;
        await runSerialWithDelay(
            pool,
            async (e) => {
                try {
                    // 网站检测（有观看网址才做）；结果即最终结果（本地文件夹检测已于 #159 移除）
                    const url = watchUrlOf(e);
                    const r = url ? await onCheckUpdate(url, e.progress?.episode ?? 0, force) : null;
                    // 每条完成立即赋值新引用 → 该行从「检测中/秒显」变为结果（不必等最慢的条目）
                    updateMap = { ...updateMap, [e.id]: r };
                    // A2 落库：最新集比已知最新更新 → 写回（更新提示去重基线；失败静默不影响展示）
                    if (r && r.status === 'updated' && r.latestEpisode > (e.latestKnownEpisode ?? 0)) {
                        void onSaveLatestKnown(e.id, r.latestEpisode);
                    }
                } catch (err) {
                    updateMap = {
                        ...updateMap,
                        [e.id]: {
                            status: 'failed',
                            latestEpisode: 0,
                            watchedEpisodes: 0,
                            updateCount: 0,
                            error: err instanceof Error ? err.message : String(err),
                        },
                    };
                }
            },
            1500,
        );
        checking = false;
    }

    // entries 变化（进入追更表/刷新）时重新检测；组件初始化时 `$:` 会自动执行一次
    $: if (entries.length) runChecks();

    /** 检测中判断 */
    function isChecking(e: MediaEntry): boolean {
        return updateMap[e.id] === 'checking';
    }
    /** 取结果（非 checking 才返回） */
    function updOf(e: MediaEntry): UpdateCheckResult | null {
        const v = updateMap[e.id];
        return v && v !== 'checking' ? v : null;
    }
    /** 排序辅助：map 显式传参（$: 表达式直接引用 updateMap 才能被编译器追踪） */
    function sortWatching(list: MediaEntry[], map: Record<string, UpdateCheckResult | 'checking' | null>): MediaEntry[] {
        const upd = (e: MediaEntry) => {
            const v = map[e.id];
            return v && v !== 'checking' && v.status === 'updated' ? v.updateCount : 0;
        };
        return list.slice().sort((a, b) => {
            // 1. 更新数（🆕已更新X集）置顶，更新多的在前（参考脚本排序规则）
            const ca = upd(a), cb = upd(b);
            if (ca !== cb) return cb - ca;
            // 2. 活跃度：滞后（stale > idle > active）置顶 → 未开始排最后
            const act = { stale: 3, idle: 2, active: 1, none: 0 } as const;
            const da = activityOf(a), db = activityOf(b);
            if (act[da] !== act[db]) return act[db] - act[da];
            // 2.5 开播季度：新季度在前（参考脚本排序规则）
            const sa = seasonText(a.airDate) ?? '', sb = seasonText(b.airDate) ?? '';
            if (sa !== sb) return sb.localeCompare(sa);
            // 3. 同档按最近观看降序
            const ta = daysSinceLast(a), tb = daysSinceLast(b);
            if (ta !== null && tb !== null && ta !== tb) return tb - ta;
            return b.updatedAt.localeCompare(a.updatedAt);
        });
    }

    /** 在看条目（追番池）：仅动画/电视剧（书籍/游戏不追番）；updateMap 显式传入 → 检测结果变化时重排（有更新置顶） */
    $: watching = sortWatching(
        entries.filter((e) => e.status === 'watching' && isTrackingType(e.type)),
        updateMap,
    );

    /** 有更新的数量（统计行；map 直接参与 $: 表达式） */
    $: updatedCount = watching.filter((e) => {
        const v = updateMap[e.id];
        return !!v && v !== 'checking' && v.status === 'updated';
    }).length;

    /** 距上次观看天数（progress.lastWatchedDate 或 history 最后一条；无记录返回 null） */
    function daysSinceLast(e: MediaEntry): number | null {
        const d = e.progress?.lastWatchedDate ?? e.progress?.history?.slice(-1)[0]?.date;
        if (!d) return null;
        const t = new Date(d).getTime();
        if (Number.isNaN(t)) return null;
        return Math.max(0, Math.round((Date.now() - t) / 86400000));
    }

    /** 活跃度分档：null=未开始 / active=≤3天 / idle=≤7天 / stale=>7天（参考「有更新置顶」语义） */
    function activityOf(e: MediaEntry): 'none' | 'active' | 'idle' | 'stale' {
        const d = daysSinceLast(e);
        if (d === null) return 'none';
        if (d <= 3) return 'active';
        if (d <= 7) return 'idle';
        return 'stale';
    }

    /** 活跃度展示文本 */
    function activityText(e: MediaEntry): string {
        const d = daysSinceLast(e);
        if (d === null) return '未开始';
        if (d === 0) return '今天看过';
        return `${d} 天前`;
    }

    /** 进度文本：剧集 SxEy(/总集数)；书籍 页码/总页；游戏 时长 */
    function progressText(e: MediaEntry): string {
        if ((e.type === 'tv' || e.type === 'anime') && e.progress) {
            const p = e.progress;
            return p.totalEpisodes ? `S${p.season}E${p.episode}/${p.totalEpisodes}` : `S${p.season}E${p.episode}`;
        }
        if (e.type === 'book' && e.readingProgress?.totalPage) {
            return `${e.readingProgress.page ?? 0}/${e.readingProgress.totalPage} 页`;
        }
        if (e.type === 'game' && e.playtimeMinutes) {
            return `${Math.round(e.playtimeMinutes / 60)}h`;
        }
        return e.year ? String(e.year) : '—';
    }

    /** 开播季度：2024-10-03 → 2024年秋；无日期返回 undefined（番剧季度惯例 1-3春/4-6夏/7-9秋/10-12冬） */
    function seasonText(airDate: string | undefined): string | undefined {
        if (!airDate) return undefined;
        const m = /^(\d{4})-(\d{2})/.exec(airDate);
        if (!m) return undefined;
        const year = m[1], mon = Number(m[2]);
        const season = mon <= 3 ? '春' : mon <= 6 ? '夏' : mon <= 9 ? '秋' : '冬';
        return `${year}年${season}`;
    }
</script>

<div class="rl-tracking">
    <div class="rl-tr-head">
        <span class="rl-tr-title">追番表</span>
        <span class="rl-tr-cnt">{watching.length} 部在追</span>
        {#if updatedCount > 0}
            <span class="rl-tr-cnt rl-tr-cnt-new"><Icon icon="bell" size={11} /> {updatedCount} 部有更新</span>
        {/if}
        <span class="rl-tr-hint">更新置顶 · 滞后置顶 · 点击标题打开笔记</span>
        <button class="rl-tr-refresh" disabled={checking} data-tip="重新检查所有在追条目的更新" on:click={() => runChecks(true)}>
            {checking ? '检测中…' : '重新检测'}
        </button>
        <button class="rl-tr-import" on:click={onImportBangumi} data-tip="从 Bangumi 收藏列表批量导入动画条目">从 Bangumi 导入</button>
    </div>

    {#if watching.length === 0}
        <div class="rl-tr-empty">当前没有「在看」的条目 — 标记为「在看」后出现在这里</div>
    {:else}
        <table class="rl-tr-table">
            <thead>
                <tr>
                    <th>标题</th>
                    <th>开播季度</th>
                    <th>进度</th>
                    <th>更新状态</th>
                    <th>上次观看</th>
                    <th>活跃度</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                {#each watching as e}
                    {@const u = updateMap[e.id]}
                    <tr class:rl-tr-stale={activityOf(e) === 'stale'}>
                        <td>
                            <span class="rl-tr-title-cell" role="link" tabindex="0" data-tip="打开笔记：{e.title}" on:click={() => onOpenEntry(e.id)} on:keydown={(ev) => { if (ev.key === 'Enter') onOpenEntry(e.id); }}>
                                {e.title}
                            </span>
                        </td>
                        <td><span class="rl-tr-season">{seasonText(e.airDate) ?? '—'}</span></td>
                        <td><span class="rl-tr-prog">{progressText(e)}</span></td>
                        <td>
                            {#if u === 'checking'}
                                <span class="rl-tr-upd rl-tr-upd-check">检测中…</span>
                            {:else if !u}
                                <span class="rl-tr-upd rl-tr-upd-na" data-tip="该条目没有观看链接 — 编辑条目添加后即可检测更新">— 未设置</span>
                            {:else if u.status === 'updated'}
                                {@const isNew = decideUpdateDisplay(u.latestEpisode, e.latestKnownEpisode ?? 0, e.progress?.episode ?? 0) === 'new'}
                                {#if isNew}
                                    <span class="rl-tr-upd rl-tr-upd-new" data-tip="最新 {u.latestEpisode} 集 · 已看 {u.watchedEpisodes} 集"><Icon icon="bell" size={11} /> 更新{u.updateCount}集</span>
                                {:else}
                                    <span class="rl-tr-upd rl-tr-upd-ok" data-tip="最新 {u.latestEpisode} 集 · 已看 {u.watchedEpisodes} 集">✅ 已同步</span>
                                {/if}
                            {:else if u.status === 'synced'}
                                <span class="rl-tr-upd rl-tr-upd-ok" data-tip="最新 {u.latestEpisode} 集 · 已看 {u.watchedEpisodes} 集">✅ 已同步</span>
                            {:else if u.status === 'no-info'}
                                <span class="rl-tr-upd rl-tr-upd-na" data-tip="页面未找到集数信息（第X集/第X话/Episode X）">— 无集数</span>
                            {:else if u.status === 'blocked'}
                                <span class="rl-tr-upd rl-tr-upd-blocked" data-tip="该站有 CDN 人机验证，请在浏览器打开确认可访问，或更换观看链接">🔒 站点拦截</span>
                            {:else}
                                <span class="rl-tr-upd rl-tr-upd-fail" data-tip="检测失败：{u.error}">❌ 失败</span>
                            {/if}
                        </td>
                        <td><span class="rl-tr-last">{activityText(e)}</span></td>
                        <td>
                            {#if activityOf(e) === 'stale'}
                                <span class="rl-tr-act rl-tr-act-stale">🔴 滞后</span>
                            {:else if activityOf(e) === 'idle'}
                                <span class="rl-tr-act rl-tr-act-idle">🟡 待看</span>
                            {:else if activityOf(e) === 'active'}
                                <span class="rl-tr-act rl-tr-act-active">🟢 活跃</span>
                            {:else}
                                <span class="rl-tr-act rl-tr-act-none">⚪ 未开始</span>
                            {/if}
                        </td>
                        <td>
                            <span class="rl-tr-ops">
                                {#if e.links.length > 0}
                                    <button class="rl-tr-btn" data-tip="打开观看链接" on:click={() => onOpenLink(e.links[0].url)}><Icon icon="play" size={12} /> 观看</button>
                                {/if}
                                <button class="rl-tr-btn" data-tip="编辑条目" on:click={() => onEditEntry(e.id)}><Icon icon="pencil" size={12} /> 编辑</button>
                            </span>
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
</div>

<style>
    .rl-tracking { font-size: 13px; }
    .rl-tr-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .rl-tr-title { font-size: 14px; font-weight: 700; }
    .rl-tr-cnt { font-size: 11px; color: var(--text-muted); background: var(--background-modifier-hover); border-radius: var(--rl-t-radius-pill, 999px); padding: 1px 9px; }
    .rl-tr-cnt-new { color: var(--rl-danger); background: rgba(255, 107, 107, .14); font-weight: 700; }
    .rl-tr-hint { font-size: 11px; color: var(--text-faint); }
    .rl-tr-refresh { font-family: inherit; font-size: 11px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); padding: 1px 10px; cursor: pointer; margin-left: auto; transition: background .1s, transform .05s; }
    .rl-tr-refresh:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); }
    .rl-tr-refresh:active { background: var(--background-modifier-hover); transform: scale(.95); }
    .rl-tr-refresh:disabled { opacity: .5; cursor: default; }
    .rl-tr-import { font-family: inherit; font-size: 11px; border: 1px solid var(--interactive-accent); background: transparent; color: var(--interactive-accent); border-radius: var(--rl-t-radius-md, 6px); padding: 1px 10px; cursor: pointer; transition: background .1s, transform .05s; }
    .rl-tr-import:hover { background: rgba(69, 122, 251, .12); }
    .rl-tr-import:active { transform: scale(.95); }
    .rl-tr-empty { text-align: center; color: var(--text-faint); padding: 36px 0; font-size: 13px; }
    .rl-tr-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .rl-tr-table th, .rl-tr-table td { padding: 7px 10px; border-bottom: 1px solid var(--background-modifier-border); text-align: left; vertical-align: middle; }
    .rl-tr-table th { font-size: 11px; color: var(--text-faint); font-weight: 600; white-space: nowrap; }
    .rl-tr-table tbody tr:hover { background: var(--background-modifier-hover); }
    .rl-tr-table tr.rl-tr-stale { border-left: 3px solid var(--rl-danger); }
    .rl-tr-title-cell { cursor: pointer; font-weight: 600; color: var(--text-normal); }
    .rl-tr-title-cell:hover { color: var(--interactive-accent); text-decoration: underline; }
    .rl-tr-season { font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
    .rl-tr-prog { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--text-normal); white-space: nowrap; }
    .rl-tr-last { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .rl-tr-act { font-size: 11px; font-weight: 600; padding: 1px 9px; border-radius: var(--rl-t-radius-pill, 999px); white-space: nowrap; }
    .rl-tr-act-active { background: rgba(81, 207, 102, .14); color: var(--rl-good); }
    .rl-tr-act-idle { background: rgba(255, 193, 7, .14); color: #b08800; }
    .rl-tr-act-stale { background: rgba(255, 107, 107, .14); color: var(--rl-danger); }
    .rl-tr-act-none { background: var(--background-modifier-hover); color: var(--text-faint); }
    .rl-tr-upd { font-size: 11px; font-weight: 600; padding: 1px 9px; border-radius: var(--rl-t-radius-pill, 999px); white-space: nowrap; }
    .rl-tr-upd-new { background: rgba(255, 107, 107, .14); color: var(--rl-danger); }
    .rl-tr-upd-ok { background: rgba(81, 207, 102, .14); color: var(--rl-good); }
    .rl-tr-upd-na { background: var(--background-modifier-hover); color: var(--text-faint); }
    .rl-tr-upd-fail { background: rgba(134, 142, 150, .14); color: #868e96; }
    .rl-tr-upd-blocked { background: rgba(240, 146, 51, .14); color: var(--rl-warn); }
    .rl-tr-upd-check { background: var(--background-modifier-hover); color: var(--text-muted); }
    .rl-tr-ops { display: flex; gap: 6px; }
    .rl-tr-btn { font-family: inherit; font-size: 11px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); border-radius: var(--rl-t-radius-md, 6px); padding: 2px 10px; cursor: pointer; transition: color .15s ease, border-color .15s ease, background .15s ease, transform .12s ease; }
    .rl-tr-btn:hover { color: var(--interactive-accent); border-color: var(--interactive-accent); transform: scale(1.12); }
</style>
