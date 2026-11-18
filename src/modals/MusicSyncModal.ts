/**
 * 「从音乐平台同步清单」弹窗（第 15 轮阶段 C）。
 *
 * 与既有五个同步弹窗（Steam / Bangumi / TMDB / 豆瓣 / 微信读书）**完全同构**：
 * 打开即读 → 勾选 → 导入 → Notice 回执 → 关闭；⛔ 底部不放「取消」（右上角 ✕ 就是关闭）。
 *
 * 🔴 与它们唯一的差别：音乐这边是**两层**——先选歌单，再勾曲目。
 * 因为网易云一个账号常有几十个歌单、一屏放不下全部曲目；一次性把每个歌单的曲目
 * 全拉下来会打几十次请求。所以：
 *   ⑴ 打开只拉**歌单列表**（每家 1 次请求）
 *   ⑵ 点某个歌单才拉它的曲目（1 次），拉过的缓存起来，来回切不重复请求
 *   ⑶ 「我喜欢的音乐」在列表里按 `liked` 标出来，与自建歌单并列
 *
 * ## 用户 2026-11-09 的三条裁定（逐条落在本文件）
 * ⑴ **只落单曲**：歌单名写进条目标签，⛔ 不建「歌单条目」。
 * ⑵ **Cookie 过期就停**：`expired` 的结果直接铺在状态栏，⛔ 不重试、不静默降级。
 * ⑶ **每家独立降级**：某家失败只影响它自己的歌单区，其余照常可选。
 */
import { Modal, Notice, type App } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import { musicHintSections } from 'pure/syncHint';
import { renderSyncHint } from 'modals/syncHintView';
import type { MusicSyncCandidate, MusicSyncPlaylist } from 'pure/musicPlaylist';
import { musicPlatformLabel } from 'pure/musicPlatform';
import type { MyListOutcome } from 'services/dl/myMusic';

/** 曲目行 = 候选 + 「库里已有」标记（照 `SteamSyncRow extends SteamSyncCandidate` 的写法） */
export interface MusicSyncRow extends MusicSyncCandidate {
    /** 库里已经有同键条目 ⇒ 默认不勾；勾上 = 覆盖 */
    imported?: boolean;
}

/** 一个平台在弹窗里的状态（歌单列表 + 曲目缓存 + 失败原因） */
export interface MusicSyncPlatformState {
    platform: string;
    label: string;
    /** 歌单列表（含「我喜欢」） */
    lists: MusicSyncPlaylist[];
    /** 失败原因（`undefined` = 成功；「成功但 0 个歌单」是 `lists` 空 + 无 reason） */
    reason?: string;
    /** `true` = 登录态失效，UI 要提示重贴 Cookie */
    expired?: boolean;
}

export interface MusicSyncFetchOutcome {
    ok: boolean;
    message: string;
    platforms: MusicSyncPlatformState[];
}

export type MusicSyncFetchResult =
    | { ok: true; snapshot: MusicSyncFetchOutcome }
    | { ok: false; message: string };

export interface MusicSyncImportResult {
    added: number;
    skipped: number;
    failed: number;
    overridden: number;
    sameName: number;
}

export interface MusicSyncModalOptions {
    /**
     * 🔴 2026-11-09 第 16 轮新增（用户：「我的歌单三大平台放个同步按钮统一在凭据行里分别同步」）：
     * 只同步**这一家**。取值 = `DL_PLATFORMS` 里的键（`netease` / `qq` / `kugou`）；
     * `undefined` = 不限制（组头那颗「立即同步清单」走这条）。
     *
     * ⚠️ 过滤只发生在**展示层**，采集侧仍由 `onFetch` 决定要拉哪几家 ——
     *    `main.fetchMusicSyncLists` 按同一个值收窄，两处必须同源，⛔ 别只过滤 UI。
     */
    onlyPlatform?: string;
    /** 打开弹窗时拉各平台歌单列表 */
    onFetch: () => Promise<MusicSyncFetchResult>;
    /** 拉某个歌单的曲目（弹窗内按需调用，结果自行缓存） */
    onFetchTracks: (platform: string, playlistId: string) => Promise<MyListOutcome<MusicSyncRow>>;
    /** 导入勾选的曲目（`playlistName` 写在每条候选上） */
    onImport: (
        rows: MusicSyncRow[],
        onProgress?: (done: number, total: number, label: string) => void,
    ) => Promise<MusicSyncImportResult>;
}

interface RowRef {
    row: MusicSyncRow;
    checked: boolean;
    box: HTMLInputElement;
    rowEl: HTMLDivElement;
}

export class MusicSyncModal extends Modal {
    constructor(
        app: App,
        private readonly opts: MusicSyncModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wshelf-modal');
        // 🔴 第 16 轮：从某一家凭据行点进来时，标题带上平台名 —— 否则用户从「网易云」那条点开、
        //    看到的是通用标题，会怀疑弹窗里的清单到底是不是那一家的。
        const only = String(this.opts.onlyPlatform ?? '').trim();
        this.titleEl.setText(only ? `从${musicPlatformLabel(only)}同步清单` : '从音乐平台同步清单');

        // 🔴 2026-11-11 用户 m05717 ②：三段式（同步数据 / 冲突处理 / 前置条件），标签加粗 + 全角冒号。
        //    网易云 / QQ 音乐 / 酷狗三家共用这一个弹窗 ⇒ 平台名由 `only` 带入文案，
        //    通用入口（`only` 为空）时文案退化成「平台账号」。
        renderSyncHint(contentEl.createDiv({ cls: 'rl-wshelf-hint' }), musicHintSections(only ? musicPlatformLabel(only) : null));

        const status = contentEl.createDiv({ cls: 'rl-wshelf-status', text: '正在读取歌单列表…' });
        // 平台切换条（只有多个平台有歌单时才显示）
        const tabs = contentEl.createDiv({ cls: 'rl-msync-tabs' });
        tabs.style.display = 'none';
        // 歌单切换条（当前平台里的哪个清单）
        const plBar = contentEl.createDiv({ cls: 'rl-msync-pls' });
        plBar.style.display = 'none';
        const bar = contentEl.createDiv({ cls: 'rl-wshelf-bar' });
        bar.style.display = 'none';
        const countEl = bar.createSpan({ cls: 'rl-wshelf-count', text: '' });
        const allBtn = bar.createEl('button', { cls: 'rl-btn', text: '全选' });
        const list = contentEl.createDiv({ cls: 'rl-wshelf-list' });
        const note = contentEl.createDiv({ cls: 'rl-wshelf-note' });

        const ops = contentEl.createDiv({ cls: 'rl-wshelf-ops' });
        const retryBtn = ops.createEl('button', { cls: 'rl-btn', text: '重新读取' });
        // ⛔ 不放「取消」：右上角 ✕ 就是关闭（与另外五个同步弹窗同一口径）
        const goBtn = ops.createEl('button', { cls: 'rl-btn mod-cta', text: '导入' });
        goBtn.disabled = true;

        let refs: RowRef[] = [];
        /** 各平台的歌单列表（打开时拉一次） */
        let platforms: MusicSyncPlatformState[] = [];
        /** 曲目缓存：`platform:playlistId` ⇒ 候选（⛔ 重复拉同一个歌单） */
        const trackCache = new Map<string, MusicSyncRow[]>();
        /** 已勾选的跨歌单集合（切歌单不丢勾选） */
        const pickedKeys = new Set<string>();

        const picked = (): MusicSyncRow[] => refs.filter((r) => r.checked).map((r) => r.row);
        const overrideCount = (): number => picked().filter((r) => r.imported === true).length;

        /** 只刷数字与按钮态（⛔ 不重建行） */
        const refresh = (): void => {
            const n = pickedKeys.size;
            const ov = overrideCount();
            countEl.setText(`当前歌单已载 ${refs.length} 首 · 已选 ${n} 首` + (ov ? `（含覆盖 ${ov} 首）` : ''));
            goBtn.setText(n ? `导入 ${n} 首` : '导入');
            goBtn.disabled = n === 0;
            allBtn.setText(n >= refs.length && refs.length > 0 ? '全不选' : '全选');
        };

        allBtn.addEventListener('click', () => {
            const turnOn = picked().length < refs.length;
            for (const r of refs) {
                r.checked = turnOn;
                r.box.checked = turnOn;
                if (turnOn) pickedKeys.add(r.row.key);
                else pickedKeys.delete(r.row.key);
                r.rowEl.toggleClass('is-override', turnOn && r.row.imported === true);
            }
            refresh();
        });

        /**
         * 建行（每次切歌单重建 —— 与 Steam 弹窗「只建一次」不同，这里内容整块换）。
         * ⚠️ 重建时必须按 `pickedKeys` 还原勾选，否则切走再切回勾选就丢了。
         * ⚠️ 「库里已有」的行**默认不勾**（与另外五个弹窗同口径）；用户勾上 = 覆盖。
         */
        const buildRows = (rows: MusicSyncRow[], loaded: boolean): void => {
            list.empty();
            refs = [];
            if (!loaded) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: '正在读取曲目…' });
                refresh();
                return;
            }
            if (!rows.length) {
                list.createDiv({ cls: 'rl-wshelf-empty', text: '（这个歌单没有读到曲目）' });
                refresh();
                return;
            }
            for (const r of rows) {
                const checked = pickedKeys.has(r.key);
                const dup = r.imported === true;
                const rowEl = list.createDiv({ cls: 'rl-wshelf-row' + (dup ? ' is-done is-dup' : '') });
                const box = rowEl.createEl('input', { cls: 'rl-wshelf-box', attr: { type: 'checkbox' } });
                box.checked = checked;
                if (r.poster) {
                    rowEl.createEl('img', {
                        cls: 'rl-wshelf-cv',
                        attr: { src: r.poster, loading: 'lazy', decoding: 'async', alt: '' },
                    });
                } else {
                    // 无封面占位（⛔ 不留空洞让行高跳动）——
                    // ⚠️ 类名是 `is-ph`（不是 `rl-wshelf-cv-ph`）：`.rl-wshelf-cv.is-ph` 那条规则
                    //    是另外五个同步弹窗共用的，本文件⛔ 别造第二个占位类名。
                    rowEl.createSpan({ cls: 'rl-wshelf-cv is-ph' });
                }
                const main = rowEl.createDiv({ cls: 'rl-wshelf-main' });
                main.createDiv({ cls: 'rl-wshelf-t', text: r.title });
                const bits: string[] = [];
                if (r.artist) bits.push(r.artist);
                if (r.album) bits.push(r.album);
                if (r.vip) bits.push('会员');
                bits.push(r.playlistName);
                if (dup) bits.push('库里已有 · 勾选=覆盖');
                main.createDiv({ cls: 'rl-wshelf-sub', text: bits.join(' · ') });
                if (dup) rowEl.createSpan({ cls: 'rl-wshelf-dup', text: '库里已有' });
                const ref: RowRef = { row: r, checked, box, rowEl };
                box.addEventListener('change', () => {
                    ref.checked = box.checked;
                    if (box.checked) pickedKeys.add(r.key);
                    else pickedKeys.delete(r.key);
                    rowEl.toggleClass('is-override', dup && box.checked);
                    refresh();
                });
                refs.push(ref);
            }
            refresh();
        };

        const setBusy = (busy: boolean): void => {
            retryBtn.disabled = busy;
            goBtn.disabled = busy || pickedKeys.size === 0;
            allBtn.disabled = busy;
            for (const r of refs) r.box.disabled = busy;
            if (!busy) refresh();
        };

        /** 当前平台与歌单 */
        let activePlatform = '';
        let activePlaylistId = '';
        let activePlaylistName = '';
        /** 每平台上次停留的歌单，切换平台时回到那里 */
        const lastPicked = new Map<string, string>();

        /** 平台条（哪一家） */
        const paintTabs = (): void => {
            tabs.empty();
            const usable = platforms.filter((p) => p.lists.length > 0);
            if (usable.length <= 1) {
                tabs.style.display = 'none';
                return;
            }
            tabs.style.display = 'flex';
            for (const p of usable) {
                const btn = tabs.createEl('button', {
                    // 与歌单条同一套类口径（`.rl-msync-tab` / `.is-on`），⛔ 别一边用 `rl-btn + mod-cta`、
                    // 一边用胶囊 —— 同一弹窗里两层选择条长得不一样，用户会以为它们是两种东西。
                    cls: 'rl-msync-tab' + (p.platform === activePlatform ? ' is-on' : ''),
                    text: `${p.label}（${p.lists.length}）`,
                });
                btn.addEventListener('click', () => {
                    const remembered = lastPicked.get(p.platform) ?? p.lists[0]?.id ?? '';
                    void openPlaylist(p.platform, remembered);
                });
            }
        };

        /**
         * 歌单条（同一平台里的哪一个清单）。
         * 🔴 为什么单独一条：网易云一个账号常有几十个歌单，平台条只能表达「哪一家」，
         * 不能表达「哪个清单」；缺了它用户就只能同步默认第一个歌单。
         */
        const paintPlaylists = (): void => {
            plBar.empty();
            const p = platforms.find((x) => x.platform === activePlatform);
            if (!p || p.lists.length === 0) {
                plBar.style.display = 'none';
                return;
            }
            plBar.style.display = 'flex';
            for (const pl of p.lists) {
                const label = pl.liked ? `我喜欢（${pl.trackCount ?? 0}）` : `${pl.name}${pl.trackCount !== undefined ? `（${pl.trackCount}）` : ''}`;
                const btn = plBar.createEl('button', {
                    cls: 'rl-msync-pl' + (pl.id === activePlaylistId ? ' is-on' : ''),
                    text: label,
                });
                if (pl.name) btn.setAttribute('data-tip', pl.name);
                btn.addEventListener('click', () => {
                    void openPlaylist(activePlatform, pl.id);
                });
            }
        };

        const openPlaylist = async (platform: string, playlistId: string): Promise<void> => {
            const p = platforms.find((x) => x.platform === platform);
            const pl = p?.lists.find((x) => x.id === playlistId);
            activePlatform = platform;
            activePlaylistId = playlistId;
            activePlaylistName = pl?.name ?? '';
            lastPicked.set(platform, playlistId);
            // 平台条 + 歌单条都要跟着当前选择重画
            paintTabs();
            paintPlaylists();
            const cacheKey = `${platform}:${playlistId}`;
            const cached = trackCache.get(cacheKey);
            if (cached) {
                buildRows(cached, true);
                return;
            }
            buildRows([], false);
            setBusy(true);
            status.setText(`正在读取「${activePlaylistName || '歌单'}」的曲目…`);
            try {
                const out = await this.opts.onFetchTracks(platform, playlistId);
                trackCache.set(cacheKey, out.items);
                if (out.reason) {
                    status.setText(out.reason);
                    note.setText(out.expired ? '登录态已失效：请到设置重新粘贴 Cookie 后点「重新读取」。' : '');
                } else {
                    status.setText(`「${activePlaylistName}」共 ${out.items.length} 首`);
                    note.setText('');
                }
                buildRows(out.items, true);
            } catch (e) {
                status.setText(`读取曲目失败：${e instanceof Error ? e.message : String(e)}`);
                buildRows([], true);
            }
            setBusy(false);
        };

        const readAll = (): void => {
            setBusy(true);
            status.setText('正在读取歌单列表…');
            note.setText('');
            trackCache.clear();
            void (async () => {
                let out: MusicSyncFetchResult;
                try {
                    out = await this.opts.onFetch();
                } catch (e) {
                    status.setText(`读取失败：${e instanceof Error ? e.message : String(e)}`);
                    setBusy(false);
                    return;
                }
                if (!out.ok) {
                    status.setText(out.message);
                    setBusy(false);
                    return;
                }
                platforms = out.snapshot.platforms;
                // 🔴 第 16 轮：从某一家凭据行点进来的，只显示那一家。
                //    ⚠️ 采集侧已在 `main.fetchMusicSyncLists` 收窄，这里再筛一次是**展示层兜底**
                //    （万一宿主那边漏传 `onlyPlatform`，也不该把别家的歌单铺出来）。
                if (only) platforms = platforms.filter((p) => p.platform === only);
                // 失败/失效的平台如实铺在提示区（一家坏不拖累另一家）
                const bad = platforms.filter((p) => p.reason || p.expired);
                const usable = platforms.filter((p) => p.lists.length > 0);
                note.setText(bad.map((p) => `${p.label}：${p.reason ?? '登录态已失效'}`).join('\n'));
                bar.style.display = usable.length ? 'flex' : 'none';
                if (!usable.length) {
                    status.setText('没有读到任何歌单。' + (bad.length ? '先按上面的提示处理凭据。' : ''));
                    tabs.style.display = 'none';
                    plBar.style.display = 'none';
                    buildRows([], true);
                    setBusy(false);
                    return;
                }
                status.setText(`共读取 ${usable.reduce((n, p) => n + p.lists.length, 0)} 个歌单`);
                const first = usable[0];
                activePlatform = first.platform;
                await openPlaylist(first.platform, (lastPicked.get(first.platform) ?? first.lists[0]?.id) || '');
                setBusy(false);
            })();
        };
        retryBtn.addEventListener('click', readAll);

        goBtn.addEventListener('click', () => {
            const chosen = picked();
            if (!chosen.length) return;
            setBusy(true);
            status.setText('正在导入…');
            void (async () => {
                try {
                    const res = await this.opts.onImport(chosen, (done, total, label) =>
                        status.setText(`${label}（${done}/${total}）`),
                    );
                    const parts = [`已导入 ${res.added} 首曲目`];
                    if (res.overridden) parts.push(`覆盖 ${res.overridden} 首`);
                    if (res.skipped) parts.push(`跳过 ${res.skipped} 首`);
                    // 🔴 同名条目必须让用户看见（笔记路径按标题派生，会覆盖）
                    if (res.sameName) parts.push(`库内存在同名文件 ${res.sameName} 首，已跳过`);
                    if (res.failed) parts.push(`失败 ${res.failed} 首`);
                    new Notice(parts.join('，'));
                    this.close();
                } catch (e) {
                    status.setText(`导入失败：${e instanceof Error ? e.message : String(e)}`);
                    setBusy(false);
                }
            })();
        });

        readAll();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
