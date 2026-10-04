/**
 * 内置音频播放器（工作区标签页 / 侧边栏视图，2026-09-27 ④-4）
 *
 * ## 为什么是「一个视图 + 一个装配层」而不是两套 UI
 *
 * 用户的三条硬需求：**在标签页打开**、**也能在侧边栏按宽度自适应**、**歌词与音频统一呈现**。
 * 标签页与侧边栏是**同一个视图类型**，差别只在可用宽度 ⇒ 布局全靠
 * `pure/audioLayout.resolveAudioLayout(clientWidth)` 分三档（`ResizeObserver` 驱动）。
 * ⛔ 不存在「侧边栏专用布局」这种分支：把页签拖到侧栏、拉分隔条都会即时换档。
 *
 * DOM 与交互全在 `views/audioPlayerMount`（笔记内 ` ```lrc ` 块共用同一套装配），
 * 本类只负责：视图生命周期（Scope 快捷键 / 容器类名 / 销毁释放）+ 把宿主给的选项转交给装配层。
 *
 * ⚠️ **声道互斥**：起播时经 `opts.onPlayStart` 回调宿主去暂停别的播放器
 *   （真源 `pure/audioQueue.playersToPause`）；反向（视频起播 ⇒ 暂停本器）由宿主调
 *   `pausePlayback()`。⛔ 别在两侧各硬编码「另一个是谁」。
 */
import { ItemView, Scope, type WorkspaceLeaf } from 'obsidian';
import {
    mountAudioPlayer,
    type AudioPlayerHandle,
    type AudioPlayerMountOptions,
    type AudioPlayerTrack,
} from 'views/audioPlayerMount';
import { resolveKeyAction, type PlayerKeyAction } from 'pure/player';
import { siblingLrcPath } from 'pure/lrcSource';

/** 视图类型（main 层 `registerView` 与打开入口共用） */
export const AUDIO_PLAYER_VIEW_TYPE = 'reelludic-audio-player';

/** 打开选项 = 装配选项（形态由所在 leaf 的宽度决定，⛔ 不需要调用方指定档位） */
export type AudioPlayerOptions = AudioPlayerMountOptions;

/** 音频适用的快捷键动作（全屏 / 时间戳 / 截图不适用，⛔ 别为它们各写一个空分支） */
const AUDIO_KEY_ACTIONS: readonly PlayerKeyAction[] = [
    'toggle',
    'seek:-5',
    'seek:5',
    'seek:-30',
    'seek:30',
    'volume:up',
    'volume:down',
    // M 键静音：`runAction` 早就有 `mute` 分支、`bindKeys` 也早注册了 `m`/`M`，
    // 只差这张白名单（不加就等于注册了个空处理器：键被吃掉、宿主也接不了手）
    'mute',
];

export class AudioPlayerView extends ItemView {
    private handle: AudioPlayerHandle | null = null;
    private opts: AudioPlayerOptions | null = null;
    private mounted = false;
    /** 标签页标题：**正在播那一首的笔记名**（用户 2026-09-27 指令）—— 由装配层 `onTrackChange` 回填 */
    private nowPlaying: string | null = null;
    /** 当前曲目（#408：歌词重载与「打开笔记」都要它 —— `entryId` / `notePath` / `path`） */
    private nowTrack: AudioPlayerTrack | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        // 纯播放视图：不参与「导航 / 文件」语义（不显示文件面包屑、不记历史）
        this.navigation = false;
    }

    getViewType(): string {
        return AUDIO_PLAYER_VIEW_TYPE;
    }

    /**
     * 标签页标题 = **正在播那一首的笔记名**（用户 2026-09-27：「标签页显示为音频播放器的改成其播放关联的笔记名」）。
     *
     * 🔴 三件事一次说清：⑴ 取的是 `track.noteName`（笔记叶子段去扩展名，真源 `pure/libraryDir.fileDisplayName`），
     * ⛔ 不是媒体标题、更不是音频文件名；⑵ 笔记名拿不到（条目没笔记 / 内联块）才退回标题；
     * ⑶ **切歌要跟着变** ⇒ 由装配层 `onTrackChange` 回填 `nowPlaying` 并**刷新页头** ——
     *    只改 `getDisplayText()` 的返回值不够：Obsidian 不会自己重读标题（标签页会一直停在旧名字）。
     */
    getDisplayText(): string {
        return this.nowPlaying ?? this.opts?.items[0]?.noteName ?? this.opts?.items[0]?.title ?? '音频播放器';
    }

    getIcon(): string {
        return 'music';
    }

    async onOpen(): Promise<void> {
        // View.scope 默认 null（见 obsidian.d.ts）→ 自建子 scope，本视图为活动页时接管快捷键
        const scope = new Scope(this.app.scope);
        this.scope = scope;
        this.bindKeys(scope);
        // 容器打点：CSS 据此去 .view-content 默认内距并隐藏该视图页头（与 VideoPlayerView 同路线）
        this.containerEl.addClass('rl-ap-view');
        this.contentEl.addClass('rl-ap');
        this.mounted = true;
        this.watchNoteChanges();
        // 🔴 #410：把页签从标签栏拖进/拖出侧边栏时归属会变 ⇒ 跟着更新那颗按钮的可见性。
        //    `layout-change` 触发频繁，但这只是一次布尔判定 + 一次 class toggle（幂等、无 DOM 重建）。
        this.registerEvent(this.app.workspace.on('layout-change', () => this.handle?.setOpenNoteHidden(this.isInSidebar())));
        if (this.opts) this.build();
    }

    async onClose(): Promise<void> {
        this.handle?.destroy();
        this.handle = null;
        this.mounted = false;
        this.contentEl.empty();
    }

    /**
     * 载入播放内容（main 层在 `setViewState` 后调用；同一页签可反复换条目，不必新开）。
     * ⚠️ 方法名不能叫 `load` —— `ItemView` 基类已占用它（视图生命周期），签名不同会编译失败。
     */
    openWith(opts: AudioPlayerOptions): void {
        // 装配层每换一首都会回调 ⇒ 这里把「当前曲目」收下来并刷新标签页标题。
        // ⛔ 不覆盖宿主可能已有的回调（内联块那条路不用传，也就不会进这里）。
        this.opts = { ...opts, onTrackChange: (track) => this.setNowPlaying(track) };
        // 未挂载（Obsidian 延迟渲染）时只记 opts，交给 onOpen
        if (this.mounted) this.build();
    }

    /** 记下当前曲目并刷新页头（该方法不在公开 d.ts 里 ⇒ typeof 守卫后调用，与播放器/阅读器同款手法） */
    private setNowPlaying(track: AudioPlayerTrack): void {
        this.nowTrack = track;
        this.nowPlaying = track.noteName || track.title || null;
        const leaf = this.leaf as unknown as { updateHeader?: () => void };
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
    }

    /** 其它播放器起播 ⇒ 让出声道（宿主按 `pure/audioQueue.playersToPause` 逐个调用） */
    pausePlayback(): void {
        this.handle?.pause();
    }

    /** 本视图当前是否在播（宿主判互斥用） */
    isPlaying(): boolean {
        return this.handle?.isPlaying() ?? false;
    }

    private build(): void {
        if (!this.opts) return;
        this.handle?.destroy();
        this.handle = null;
        this.contentEl.empty();
        this.handle = mountAudioPlayer(this.contentEl, this.opts);
        this.handle.setOpenNoteHidden(this.isInSidebar());
    }

    /**
     * 🔴 #410：「打开笔记」按钮**只在标签页里显示**（用户：「如果侧边栏打开（的播放器），
     * 不显示打开笔记按钮」）—— 侧边栏那几个视图通常就贴在笔记旁边，那颗按钮是多余的。
     *
     * 判据 = leaf 的归属根：`getRoot()` 拿到 `rightSplit` / `leftSplit`（或移动端抽屉）就是侧边栏；
     * 拿不到（老版本 / 异常）⇒ **按标签页**处理（宁可多显示一颗，也别把功能藏掉）。
     * ⚠️ `getRoot` 不在公开 d.ts 里 ⇒ 经 `unknown` 收窄 + typeof 守卫。
     *
     * 🔴 #474 起**对外公开**：宿主也要拿它挑「侧边栏里那个播放器实例」（用户 2026-10-01：
     *    「侧边栏有歌曲正播放时，点海报墙的播放按钮应当就地切歌，而不是再开一个标签页」）。
     *    ⛔ 别在宿主侧另写一份「是不是侧边栏」的判据 —— 两处必然漂（本仓栽过多次）。
     */
    isInSidebar(): boolean {
        try {
            const leaf = this.leaf as unknown as { getRoot?: () => unknown };
            const root = typeof leaf.getRoot === 'function' ? leaf.getRoot() : undefined;
            if (!root) return false;
            const ws = this.app.workspace as unknown as { rootSplit?: unknown };
            return root !== ws.rootSplit;
        } catch {
            return false;
        }
    }

    /**
     * 🔴 #408：宿主发现「库里的条目变了」⇒ 把新队列推过来（⚙ 语义见装配层 `updateQueue`）。
     * ⛔ **不重建视图**（`build()` 会重挂 DOM、丢播放位置）—— 只把队列交给装配层认人更新。
     */
    refreshTracks(tracks: readonly AudioPlayerTrack[]): void {
        this.opts = this.opts ? { ...this.opts, items: tracks as AudioPlayerTrack[] } : null;
        this.handle?.updateQueue(tracks);
    }

    /**
     * 🔴 #408：**笔记 / 同名 `.lrc` 被改** ⇒ 重载当前曲目的歌词。
     * 用户报的正是这条：「播放中音乐标签页识别不到之后更新保存笔记的 LRC 歌词」——
     * 歌词只在切歌那一刻读一次，之后笔记里改了歌词播放器不会知道。
     * 判据 = 被改文件的路径命中**当前曲目的笔记路径**或它的**同名 `.lrc`**
     * （真源 `pure/lrcSource.siblingLrcPath`，⛔ 别在这里手拼 `.lrc` 路径）。
     * ⚠️ 用 `vault.on('modify')` 而不是定时轮询：一次字符串比较，零开销。
     */
    private watchNoteChanges(): void {
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                const t = this.currentTrack();
                if (!t) return;
                const p = file.path;
                if ((t.notePath && p === t.notePath) || (t.path && p === siblingLrcPath(t.path))) {
                    this.handle?.reloadLyrics();
                }
            }),
        );
    }

    /** 当前曲目（装配层 `onTrackChange` 回填；`notePath` / `path` 供「打开笔记」与歌词重载判定） */
    private currentTrack(): AudioPlayerTrack | null {
        return this.nowTrack;
    }

    /**
     * 快捷键：语义映射复用 `pure/player.resolveKeyAction`（与视频播放器**同一份表**）。
     * 音频没有全屏 / 时间戳 / 截图 ⇒ 先按 `AUDIO_KEY_ACTIONS` 过滤，未列入的直接不注册
     * （⛔ 别注册一个「什么都不做」的空处理器：那会**吃掉**这些键，宿主就没法再接手了）。
     */
    private bindKeys(scope: Scope): void {
        const combos: [string, boolean][] = [
            [' ', false],
            ['ArrowLeft', false],
            ['ArrowRight', false],
            ['ArrowLeft', true],
            ['ArrowRight', true],
            ['ArrowUp', false],
            ['ArrowDown', false],
            ['m', false],
            ['M', false],
        ];
        for (const [key, shift] of combos) {
            const action = resolveKeyAction(key, shift);
            if (!action || !AUDIO_KEY_ACTIONS.includes(action)) continue;
            scope.register(shift ? ['Shift'] : [], key, () => {
                this.runAction(action);
                return false;
            });
        }
    }

    private runAction(action: PlayerKeyAction): void {
        const h = this.handle;
        if (!h) return;
        switch (action) {
            case 'toggle': h.toggle(); break;
            case 'seek:-5': h.seekBy(-5); break;
            case 'seek:5': h.seekBy(5); break;
            case 'seek:-30': h.seekBy(-30); break;
            case 'seek:30': h.seekBy(30); break;
            case 'volume:up': h.nudgeVolume(1); break;
            case 'volume:down': h.nudgeVolume(-1); break;
            case 'mute': h.toggleMute(); break;
            default: break;
        }
    }
}
