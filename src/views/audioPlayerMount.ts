/**
 * 音频播放器 DOM 装配（2026-09-27 ④-4）—— **主区标签页视图（`AudioPlayerView`）与笔记内
 * ` ```lrc ` 块共用这一套**，⛔ 别各写一份（两处布局分叉后，「笔记里看到的」与「标签页里看到的」
 * 就会不一样，而这正是最难被发现的一类不一致）。
 *
 * ## 结构（与 `_shot/src/_ap.css` 的仿真稿一致，三档只换 `grid-template-areas`）
 *
 * ```
 * .rl-ap-root[data-tier=wide|medium|compact]
 *   audio.rl-ap-audio                     ← 真正的播放内核（不参与布局）
 *   .rl-ap-body                           ← grid；**DOM 只有一套**
 *     .rl-ap-art    > .rl-ap-cover        ← 宽 200 / 中 88 / 紧档 display:none
 *     .rl-ap-slider > .rl-ap-progress + .rl-ap-time
 *     .rl-ap-controls                     ← 模式 / 上一首 / 播放暂停 / 下一首 / 音量
 *     .rl-ap-right                        ← 宽档是**真盒子**（承担贯通全高的竖分隔线）
 *       .rl-ap-meta   > 标题 + 副信息 + 状态     ┐ 窄档它 display:contents 退场，
 *       .rl-ap-lyrics > .rl-ap-lyr-line*        ┘ meta / lyrics 各自成为网格项
 * ```
 *
 * ## 四条不可回退的口径
 *
 * 1. 🔴 **档位由容器宽度决定，且「未布局不提交」** —— 真源 `pure/audioLayout.resolveAudioLayout`
 *    （返回 `null` 就跳过本轮）。⛔ 不要用媒体查询：视图宽度 ≠ 窗口宽度。
 * 2. 🔴 **当前行居中用「两条 rect 的差值」** —— `lyricCenterDelta`；⛔ 不能用 `offsetTop`
 *    （歌词行带 `position: relative`，`offsetTop` 是相对最近定位祖先 = `body`，会把 `scrollTop`
 *    顶到最大，当前行被推到视口上方）。
 * 3. 🔴 **队列推进只经 `pure/audioQueue.decideTrack`**，且必须带 `trigger`（`ended` / `manual`）；
 *    洗牌袋**由本层存住**（不存 = 每首重洗 = 隔两首又重复同一首）。
 * 4. 🔴 **悬停提示只走 `aria-label` 一种（#465，2026-10-01 用户裁定）** —— Obsidian 会给带 `aria-label`
 *    的元素弹**它自己的官方气泡**；再挂 `title` 会多弹一个**浏览器原生**气泡 ⇒ 同一颗按钮 hover 出两个
 *    提示（用户实测报障：「音频播放器侧边栏鼠标hover有两种提示，我不是明确只显示 Obsidian 一种提示的吗」）。
 *    ⇒ 本文件的每条提示只用 `setAttribute('aria-label', …)`，⛔ **一处 `title` 都不许留**
 *    （含「标题被省略号截断时看全名」那处 —— 同样改用 `aria-label`）。⚠️ 这是 §3「悬停一律 `data-tip`」
 *    在本文件上的**显式例外**（播放器是 Obsidian 视图，用官方气泡与宿主外观一致；两套气泡混用才是 bug）。
 *
 * ⚠️ 音量 / 倍速档位沿用仓内真源 `pure/player.ts`（`clampVolume` / `SPEED_STEPS`），
 *    ⛔ 不引入第二套档位表。
 */
import { MarkdownRenderChild, setIcon } from 'obsidian';
import {
    AUDIO_PLAY_MODE_LABELS,
    cycleAudioPlayMode,
    decideTrack,
    normalizeAudioPlayMode,
    shuffleWeightOfRating,
    type AudioPlayMode,
    type PlayerKind,
    type ShuffleWeights,
} from 'pure/audioQueue';
import { lyricCenterDelta, resolveAudioLayout, type AudioLayoutTier } from 'pure/audioLayout';
import { lrcIndexAt, parseLrc, wordIndexAt, type LrcLine } from 'pure/lrc';
import type { LrcLyricsOrigin } from 'pure/lrcSource';
import { clampVolume, formatSpeed, formatTime } from 'pure/player';
// 🔴 用户 2026-11-08：「音乐播放器和字幕面板的滚动改要有动效而不是瞬间切换」
//    ⇒ 滚动行为统一从 pure/motion 取（含 reduced-motion 降级），⛔ 别在视图里写死 'smooth'
import { scrollBehavior } from 'pure/motion';
import {
    AUDIO_VOLUME_MAX,
    AUDIO_VOLUME_STEP_PCT,
    clampAudioVolume,
    elementVolumeFor,
    formatVolumePercent,
    gainValueFor,
    needsGain,
    volumeFromPercent,
    volumePercent,
    volumeTint,
} from 'pure/audioVolume';
import { buildSpeedOptions, menuAnchor, nextMenuState, type PlayerMenuKind } from 'pure/playerMenu';
// 🔴 m02288：收听时长自动累计（判据/零头保留全在纯模块，本层只负责「哪一段算真的在播」）
import { ListenAccumulator } from 'pure/listenTime';
import {
    LYRIC_SCALE_DEFAULT,
    applyLyricScale,
    loadLyricScale,
    lyricScaleAfterWheel,
    saveLyricScale,
} from 'pure/lyricZoom';
// 🔴 m08028：歌词**整体时间戳偏移**（用户：「LRC 歌词整体所有时间戳向后加N秒…对齐歌曲与LRC歌词」）。
// 纯逻辑全在 `pure/lrcShift`（含 localStorage 记忆与夹取），本层只负责按钮 / 浮层 / 重算。
import {
    LYRIC_OFFSET_COARSE,
    LYRIC_OFFSET_STEP,
    clampLyricOffset,
    loadLyricOffset,
    lyricOffsetLabel,
    saveLyricOffset,
    shiftLrcLines,
} from 'pure/lrcShift';

/** 播放模式 → 图标名（**与 LyricFlux `LyricsView.renderModeIcon` 同形**：single→repeat-1、
 *  shuffle→shuffle、其余（off / sequential）→ repeat，靠 `.is-on` 区分「关」与「顺序」）。
 *  🔴 `setIcon` 遇未知名**静默失败**（按钮变空白、不报错）⇒ 这几个名字进白名单断言，⛔ 别随手换。 */
export const AUDIO_PLAY_MODE_ICONS: Record<AudioPlayMode, string> = {
    off: 'repeat',
    single: 'repeat-1',
    sequential: 'repeat',
    shuffle: 'shuffle',
};

/** 音量图标（0 = 静音 / < 50% / 其余） */
export function audioVolumeIcon(volume: number): string {
    const v = clampVolume(volume);
    if (v <= 0) return 'volume-x';
    return v < 0.5 ? 'volume-1' : 'volume-2';
}

/** 一次音量滚轮的步长（5%） */
/** 音量滚轮 / ↑↓ 的**档位步长**（= `pure/audioVolume.AUDIO_VOLUME_STEP_PCT / 100` = 10%）。
 *  🔴 三处（滑条 / 滚轮 / ↑↓）必须同档 —— 分叉的话用户会发现「滚轮和滑条对不齐」。 */
export const AUDIO_VOLUME_STEP = AUDIO_VOLUME_STEP_PCT / 100;

/** 会话级倍速（🔴 与视频播放器同款：模块级、**不落库** —— 两处各存一份必然漂；
 *  也⛔ 别搬 LyricFlux 的十二档 `playbackUtils`，档位真源是 `pure/player.SPEED_STEPS`） */
let apSpeed = 1;

/** 队列里的一首（宿主已把 URL / 封面解析好，本层不碰 vault） */
export interface AudioPlayerTrack {    entryId: string;
    title: string;
    /** 条目的**笔记名**（叶子段去扩展名）—— 标签页标题显示它（用户 2026-09-27 指令）。
     *  ⛔ 别在视图层自己 `split('/')`：分隔符两种、扩展名大小写、带点目录名都是坑（真源 `pure/libraryDir.fileDisplayName`）。 */
    noteName?: string;
    /** 次级信息（作者 · 专辑 · 年份），可为空 */
    subtitle?: string;
    /** 本地原始路径（库内相对或库外绝对）—— 用于「歌词来自哪一路」的日志与后续增强 */
    path: string;
    /**
     * 🔴 #408：条目**笔记的库内路径**（`entry.notePath`）—— 给「打开笔记」按钮用。
     * 缺省（条目没笔记 / 内联块）⇒ 按钮禁用并说明原因，⛔ 不画一个点了没反应的按钮。
     */
    notePath?: string;
    /** 播放源 URL（库内 `getResourcePath` / 库外 `app://`） */
    url: string;
    /** 封面资源 URL；`null` ⇒ 占位图标 */
    coverUrl: string | null;
    /**
     * 🔴 m14228 ③：个人评分（1~5，未评分 / 缺省 = 不参与加权）。
     * 用途**仅**是乱序播放的权重（`pure/audioQueue.shuffleWeightOfRating`）——
     * ⛔ 别在本层拿它做任何展示或写回：这是**只读快照**，改了它不会落到 catalog。
     */
    rating?: number;
}

export interface AudioPlayerMountOptions {
    /** 队列（按宿主给的顺序；通常 = 库内全部带 `audioPath` 的音乐条目） */
    items: AudioPlayerTrack[];
    /** 起始曲下标（越界会被夹回 0） */
    startIndex: number;
    /**
     * 取歌词。宿主负责四路优先级（`pure/lrcSource.pickLyrics`：
     * `lyrics 指令 > 块内正文 > 同名 .lrc > 音频内嵌`）；取不到返回 `null`。
     */
    loadLyrics: (track: AudioPlayerTrack) => Promise<{ text: string; origin: LrcLyricsOrigin } | null>;
    /** 初始播放模式（来自设置；缺省 = `off`） */
    initialMode?: AudioPlayMode;
    /** 初始音量 0..1（缺省 1） */
    initialVolume?: number;
    /** 模式变更写回（缺省只在本次会话生效） */
    onSaveMode?: (mode: AudioPlayMode) => void;
    /** 音量变更写回（缺省只在本次会话生效） */
    onSaveVolume?: (volume: number) => void;
    /**
     * 起播回调：宿主负责**让出声道**（暂停其它播放器）—— 音频 ↔ 视频互斥的真源是
     * `pure/audioQueue.playersToPause`，⛔ 别在两侧各硬编码「另一个是谁」。
     */
    onPlayStart?: (kind: PlayerKind) => void;
    /** 内联形态（笔记里的小卡片）：加 `.rl-ap-inline`，空态文案更短 */
    inline?: boolean;
    /**
     * **打开即自动播放**（#406 用户：「海报墙点击播放按钮后，现状为进入音乐标签页时默认状态为暂停，
     * 请改为点击即自动播放」）。⚠️ **缺省 false**：内联块（笔记里的 ` ```lrc ` 卡片）**不传** ——
     * 打开笔记就出声很吵，而且那次没人点过播放键；标签页 / 侧边栏由宿主显式传 `true`。
     */
    autoplay?: boolean;
    /**
     * 歌词**逐字高亮**（#406；缺省 false = 只按行高亮）。开关在设置页「外观与体验 · 歌词逐字高亮」。
     * 定位真源 = `pure/lrc.wordIndexAt`（有 `<mm:ss.xx>` 就按标记，没有则 `parseLrc` 已按均分给出时间）。
     */
    wordHighlight?: boolean;
    /** 当前曲目变更（切歌 / 起播）——宿主用它更新**标签页标题**（内联块不需要，可不传） */
    onTrackChange?: (track: AudioPlayerTrack) => void;
    /**
     * 🔴 #408：点「打开笔记」时回调（宿主 = `main.openEntryNote(entryId)`）。
     * 缺省 / 当前曲目没有 `notePath` ⇒ 按钮禁用（⛔ 不画一个点了没反应的按钮）。
     */
    onOpenNote?: (track: AudioPlayerTrack) => void;
    /**
     * 🔴 m08028：把**当前歌词偏移**写回笔记（用户裁定「播放器实时偏移 + 一键写回笔记」）。
     *
     * 宿主负责「读 lrc 块 → `pure/lrcShift.shiftLrcText` → 写回」，本层负责按钮与传值。
     * 返回 `true` 表示**真的写了盘** ⇒ 本层接着做 `reloadLyrics() + resetLyricOffset()`
     * （写盘 → 重载 → 归零；顺序反了会叠加两次偏移，或显示旧文件内容）。
     * 返回 `false`（无笔记 / 内容无变化 / 来源不可写）⇒ 什么都不做，由宿主自己给用户交代。
     *
     * 缺省（内联块且没有可写来源）⇒ 浮层里那颗按钮置灰并说明原因，
     * ⛔ 不画一个点了没反应的按钮。
     */
    onWriteBackLyricOffset?: (track: AudioPlayerTrack, deltaMs: number) => Promise<boolean>;
    /**
     * 🔴 m02288：**这一曲又听够了 N 个整分钟**（用户：「用音乐播放器播放每首音乐要统计总时长…
     * 而不是让用户手动记录」）。
     *
     * 只在该曲真的播满整分钟时回调一次（N 通常是 1；长时间不暂停时可 > 1），宿主负责落库到
     * `listenMinutes`（⛔ 不是 `durationMin`，那是片长）。三条口径：
     *  ⑴ 计的是**真实播放段**（`play`→`pause`/`ended`/切歌），⛔ 不用 `currentTime` 差值 ——
     *     否则拖动进度条会被算成收听了十几分钟；
     *  ⑵ **零头跨段保留**（`pure/listenTime.ListenAccumulator`）：每段都不到 1 分钟的碎片最终也能凑成整分钟；
     *  ⑶ 不足 1 分钟**不回调**（整数分钟字段，播 5 秒就 +1 等于每次点开白送一分钟）。
     * ⚠️ 内联块（笔记里的 ` ```lrc ` 卡片）也传 —— 在笔记里听歌同样是收听，没理由不计。
     */
    onListen?: (track: AudioPlayerTrack, minutes: number) => void;
}

export interface AudioPlayerHandle {
    root: HTMLElement;
    /** 播放 / 暂停切换（快捷键用） */
    toggle(): void;
    /** 相对跳转（秒，可负；越界由 `clampSeek` 同款夹取） */
    seekBy(delta: number): void;
    /** 音量增减（方向 ±1 档 = 5%） */
    nudgeVolume(dir: 1 | -1): void;
    /** 静音 ⇄ 取消静音（音量 0 时恢复满音量，与音量按钮的点击行为同一口径） */
    toggleMute(): void;
    isPlaying(): boolean;
    pause(): void;
    /** 🔴 #408：重载当前曲目的歌词（笔记 / 同名 `.lrc` 被改后调用） */
    reloadLyrics(): void;
    /**
     * 🔴 m08028：把实时歌词偏移归零（宿主写回成功后调）。
     *
     * 顺序必须是 `写盘 → reloadLyrics() → resetLyricOffset()` ——
     * 只归零不重载会显示旧文件内容，只重载不归零会叠加两次偏移。
     */
    resetLyricOffset(): void;
    /** 🔴 #408：宿主推新队列（库里条目变了：新增 / 改关联音频 / 删除）—— 语义见 `updateQueue` */
    updateQueue(next: readonly AudioPlayerTrack[]): void;
    /** 🔴 #410：隐藏 / 恢复「打开笔记」按钮（侧边栏实例整颗不显示）；幂等 */
    setOpenNoteHidden(hidden: boolean): void;
    /** 卸载：断事件、断 ResizeObserver、暂停并释放 `src` —— ⛔ 不释放的话关掉页签声音还在 */
    destroy(): void;
}

/** 建元素的小助手（用原生 DOM API，不依赖 Obsidian 对 HTMLElement 的全局增强） */
function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
}

/**
 * 建一个图标按钮：提示走 **`aria-label`（Obsidian 官方气泡）一种**。
 *
 * 🔴 #465：⛔ **不许再挂 `title`** —— Obsidian 对带 `aria-label` 的元素会弹自己的官方气泡，
 *   而 `title` 会再弹一个**浏览器原生**气泡 ⇒ **同一颗按钮 hover 出两个提示**（用户实测报障：
 *   「音频播放器侧边栏鼠标hover有两种提示，我不是明确只显示 Obsidian 一种提示的吗」）。
 * ⚠️ 顺带说明：`setIcon` 失败（图标名不存在）时，`aria-label` 同样能让空白按钮 hover 出用途，不会失去兜底。
 */
function iconButton(cls: string, icon: string, tip: string): HTMLButtonElement {
    const btn = el('button', cls);
    btn.type = 'button';
    btn.setAttribute('aria-label', tip);
    setIcon(btn, icon);
    return btn;
}



/**
 * 往 `host` 里装一个音频播放器。
 * @returns 句柄 —— 调用方**必须**在自己销毁时调 `handle.destroy()`。
 */
export function mountAudioPlayer(host: HTMLElement, opts: AudioPlayerMountOptions): AudioPlayerHandle {
    /** 队列（🔴 #408 起是 `let` —— 宿主可在播放中把新队列推过来，见 `updateQueue`）。
     *  ⚠️ 存**副本**：调用方那张数组不能被我们改。 */
    let items: AudioPlayerTrack[] = opts.items.slice();
    const mode0 = normalizeAudioPlayMode(opts.initialMode);
    let mode: AudioPlayMode = mode0;
    let volume = clampAudioVolume(opts.initialVolume ?? 1);
    /** #406：打开即自动播放（标签页 / 侧边栏传 true；笔记内联块不传） */
    const autoplay = opts.autoplay === true;
    /** #406：歌词逐字高亮（设置页「外观与体验 · 歌词逐字高亮」；缺省 false） */
    const wordHighlight = opts.wordHighlight === true;
    /** 🔴 洗牌袋：`decideTrack` 会回传新袋，**必须存住**（不存 = 每首重洗 = 隔两首又重复） */
    let bag: string[] = [];
    let idx = items.length ? Math.min(Math.max(0, opts.startIndex), items.length - 1) : -1;
    /**
     * 🔴 m08028：**原始**解析结果（未加偏移）。`lines` 是它按当前偏移平移后的「显示用」副本。
     *
     * ⚠️ 两套必须分开存：偏移随时可调、要能调回 0；如果直接原地改 `lines` 的 timestamp，
     *    「-1s 再 +1s」就回不到原点了（每次都在上一次的结果上累加）。
     */
    let parsedLines: LrcLine[] = [];
    let lines: LrcLine[] = [];
    /** 当前歌词偏移（毫秒，正 = 歌词整体往后挪）。按条目记忆，切曲时重读。 */
    let lyricOffset = 0;
    /** 歌词不是 LRC（解析后 0 行但有正文）⇒ 按纯文本列出来，不做高亮/跳转 */
    let plainLyrics = false;
    let curLine = -1;
    /** 逐字高亮（#406）：行下标 → 该行的词元 span；`wordHighlight` 关 / 该行无词元 ⇒ 不进表 */
    const wordSpans = new Map<number, HTMLElement[]>();
    /** 当前已点亮的词元下标（-1 = 该行还没开始唱） */
    let curWord = -1;
    let destroyed = false;
    let lyricsSeq = 0;

    // ── 🔴 m02288 收听时长累计（只算「真的在播」的那几段）──────────────────────────
    // 为什么不用 `currentTime` 差值：拖动进度条 / 反复 seek 会让它跳变，差值累计等于
    // 「拖一下就听了十分钟」。这里改用**墙钟**：`play` 开始时记起点，`pause`/`ended`/切歌/销毁
    // 时结算差值 —— 那段时间里音频确实在推进。
    // ⚠️ 零头保留在 `ListenAccumulator` 里跨段累积（`pure/listenTime` 有单测），
    //    所以「切来切去、每段都不到 1 分钟」最终一样能凑成整分钟。
    let listenSink = new ListenAccumulator();
    /** 当前这一段播放的起点（`null` = 现在没在播，不需要结算） */
    let listenSince: number | null = null;
    /** 正在计时的曲目（切歌/销毁那一刻要用它把最后一段记到**正确的歌**上） */
    let listenTrack: AudioPlayerTrack | null = null;

    /** 结算当前这一段（若有）并交给 `onListen`。幂等：结算后 `listenSince` 归 null。 */
    const flushListen = (): void => {
        if (listenSince === null) return;
        const ms = Date.now() - listenSince;
        listenSince = null;
        const track = listenTrack;
        if (!track?.entryId) return;
        const minutes = listenSink.addSegment(ms);
        if (minutes <= 0) return;
        opts.onListen?.(track, minutes);
    };

    /** 换到某曲时把账本清空（零头属于上一首，⛔ 不能算到下一首头上） */
    const resetListenFor = (track: AudioPlayerTrack | null): void => {
        flushListen();
        listenSink = new ListenAccumulator();
        listenTrack = track;
        // 「正在播」由 `play` 事件重新置点 —— 这里只负责换账本
        listenSince = null;
    };

    // ── 骨架 ──
    const root = el('div', 'rl-ap-root');
    root.dataset.tier = 'wide';

    const audio = el('audio', 'rl-ap-audio');
    audio.preload = 'metadata';
    root.appendChild(audio);

    if (!items.length) {
        // 空态：队列为空（宿主一般不会这样打开，留作防御）
        const empty = el('div', 'rl-ap-empty');
        empty.appendChild(el('div', 'rl-ap-empty-title', '播放队列是空的'));
        empty.appendChild(
            el(
                'div',
                'rl-ap-empty-hint',
                opts.inline
                    ? '这个笔记里的 lrc 块还没指定音频。'
                    : '还没有可播放的音乐 — 给音乐条目关联本地音频文件后再试。',
            ),
        );
        root.appendChild(empty);
        host.appendChild(root);
        return {
            root,
            toggle: () => undefined,
            seekBy: () => undefined,
            nudgeVolume: () => undefined,
            toggleMute: () => undefined,
            isPlaying: () => false,
            pause: () => undefined,
            reloadLyrics: () => undefined,
            resetLyricOffset: () => undefined,
            updateQueue: () => undefined,
            setOpenNoteHidden: () => undefined,
            destroy: () => root.remove(),
        };
    }

    const body = el('div', 'rl-ap-body');

    const art = el('div', 'rl-ap-art');
    const cover = el('div', 'rl-ap-cover');
    art.appendChild(cover);

    const slider = el('div', 'rl-ap-slider');
    const progress = el('div', 'rl-ap-progress');
    const played = el('div', 'rl-ap-progress-played');
    const thumb = el('div', 'rl-ap-progress-thumb');
    progress.appendChild(played);
    progress.appendChild(thumb);
    const timeBox = el('div', 'rl-ap-time');
    const timeCur = el('span', 'rl-ap-time-cur', '0:00');
    const timeSep = el('span', '', ' / ');
    const timeTotal = el('span', '', '0:00');
    timeBox.appendChild(timeCur);
    timeBox.appendChild(timeSep);
    timeBox.appendChild(timeTotal);
    slider.appendChild(progress);
    slider.appendChild(timeBox);

    const controls = el('div', 'rl-ap-controls');
    const modeBtn = iconButton('rl-ap-btn', AUDIO_PLAY_MODE_ICONS[mode0], '');
    const prevBtn = iconButton('rl-ap-btn', 'skip-back', '上一首');
    const playBtn = iconButton('rl-ap-btn rl-ap-btn-play', 'play', '播放');
    const nextBtn = iconButton('rl-ap-btn', 'skip-forward', '下一首');
    const volBtn = iconButton('rl-ap-btn', audioVolumeIcon(volume), '音量（滚轮微调 · M 静音）');
    // 倍速控件：**纯文字按钮**，内容就是当前倍速（如 `1.5×`）。
    // 用户 2026-09-27 指令：先要图标按钮、后改判为「用对应倍速的文字就行了」⇒ 文案由 `formatSpeed` 出
    // （⛔ 别手拼 `${v}×`：`0.5` 会变成 `.5×` 之类），并**只在 `syncSpeedButton()` 一处写**。
    const speedBtn = el('button', 'rl-ap-btn rl-ap-btn-speed', formatSpeed(apSpeed));
    speedBtn.type = 'button';
    // 🔴 m08028：**歌词偏移**入口。用户 m08545 改判：「在音乐播放器工具栏倍速按钮旁加编辑铅笔
    //    样式的图标点击展开可调整偏移值实时调整」⇒ 从「纯文字显示偏移量」改成**铅笔图标**，
    //    数值只在浮层里出现（`.rl-ap-offset-val`），按钮本身靠 `.is-var` 高亮表示「当前非 0」。
    //    ⛔ 别再往按钮里写文字：图标按钮的 `setIcon` 已经把 `<svg>` 放进去了，再写 `textContent`
    //    会把图标整个抹掉（这正是上一版文字按钮不能直接换成图标的原因）。
    const offsetBtn = iconButton('rl-ap-btn rl-ap-btn-offset', 'pencil', '歌词时间偏移（对齐歌曲与歌词）');
    controls.appendChild(modeBtn);
    controls.appendChild(prevBtn);
    controls.appendChild(playBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(volBtn);
    controls.appendChild(speedBtn);
    controls.appendChild(offsetBtn);

    const right = el('div', 'rl-ap-right');
    const meta = el('div', 'rl-ap-meta');
    const metaMain = el('div', 'rl-ap-meta-main');
    // 🔴 #410：标题与「打开笔记」按钮**同排**（用户：「把打开笔记按钮移到标题旁边」）——
    //    ⛔ 别再挂到 `.rl-ap-meta-right`（那里在最右端，与标题隔着一大片空白）。
    const titleRow = el('div', 'rl-ap-title-row');
    const titleEl = el('div', 'rl-ap-title');
    titleRow.appendChild(titleEl);
    const subEl = el('div', 'rl-ap-sub');
    metaMain.appendChild(titleRow);
    metaMain.appendChild(subEl);
    // ⚠️ **进行中 / 异常**（「无法播放」）仍要能看见 ⇒ 保留一个小文本位，空的时候 `.is-empty` 收起来。
    //    🔴 #410：连「加载中」也**不再提示**（用户点名去掉）⇒ 这个状态位现在只剩异常态在用。
    const metaRight = el('div', 'rl-ap-meta-right');
    const statusEl = el('div', 'rl-ap-status is-empty');
    const statusIco = el('span', 'rl-ap-ico');
    setIcon(statusIco, 'music');
    const statusText = el('span', '', '');
    statusEl.appendChild(statusIco);
    statusEl.appendChild(statusText);
    // 🔴 #409：阅读器 / 视频播放器同款图标按钮（`.rl-btn` 家族 + 纯图标 + 32×28 命中区，
    //    图标名与阅读器顶栏「打开笔记」同一个 `notebook-text`）。
    //    🔴 #410：**侧边栏实例里整颗隐藏**（用户：「如果侧边栏打开（的播放器），不显示打开笔记按钮」）——
    //    由 `.rl-ap-no-note-btn` 类在根上控制（宿主按 leaf 归属判定，见 `setOpenNoteHidden`）。
    const openNoteBtn = el('button', 'rl-btn rl-ap-iconbtn');
    openNoteBtn.type = 'button';
    setIcon(openNoteBtn, 'notebook-text');
    openNoteBtn.addEventListener('click', () => {
        const t = items[idx];
        if (t && openNoteBtn.disabled === false) opts.onOpenNote?.(t);
    });
    titleRow.appendChild(openNoteBtn);
    metaRight.appendChild(statusEl);
    meta.appendChild(metaMain);
    meta.appendChild(metaRight);

    const lyrics = el('div', 'rl-ap-lyrics');
    const lyrList = el('div', 'rl-ap-lyr-list');
    lyrics.appendChild(lyrList);

    right.appendChild(meta);
    right.appendChild(lyrics);

    body.appendChild(art);
    body.appendChild(slider);
    body.appendChild(controls);
    body.appendChild(right);
    root.appendChild(body);

    if (opts.inline) root.classList.add('rl-ap-inline');
    // 🔴 #412：**内联块永不显示「打开笔记」按钮**（用户：「音乐笔记内显示的播放器不要显示打开笔记按钮」）——
    //    那段笔记就在眼前，这颗按钮没有意义；之前只是**禁用**（灰着占位），现在直接不显示。
    //    ⚠️ 复用侧边栏那条同款机制（同一个类）；内联块不经过视图层 ⇒ 不会有人把它切回来。
    if (opts.inline) root.classList.add('rl-ap-no-note-btn');
    host.appendChild(root);

    // ── 🔴 m04435 ③：歌词区 Ctrl+滚轮缩放 ──
    // 用户逐字：「歌词区域内 **Ctrl+鼠标滚轮**缩放歌词字号/比例：阻止页面默认缩放/滚动；
    //   仅作用于歌词容器，不影响其他 UI；不影响歌词正常播放滚动」
    // 三条口径：
    //  ⑴ **只认 `ctrlKey`（和 macOS 的 ⌘）** —— 普通滚轮必须照常滚歌词（#407 那条「可滚轮滚动」不能破）；
    //  ⑵ `passive: false` + `preventDefault()` 才能真的挡住「Ctrl+滚轮 = 浏览器整页缩放」；
    //  ⑶ 只改 CSS 变量 `--rl-ap-lyric-scale`（`font-size` 按 `em` 自然跟随），⛔ **不用 transform/zoom** ——
    //     那会把 `getBoundingClientRect` 一起放大，`centerCurLine` 的居中会越缩越歪。
    let lyricScale = loadLyricScale() ?? LYRIC_SCALE_DEFAULT;
    applyLyricScale(lyrics, lyricScale);
    const onLyricWheel = (ev: WheelEvent): void => {
        // ⚠️ 只拦「带修饰键」的那种；不带 Ctrl 的滚轮一律放行（用户要能滚歌词）
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        const next = lyricScaleAfterWheel(lyricScale, ev.deltaY);
        if (next === lyricScale) return;
        lyricScale = next;
        applyLyricScale(lyrics, lyricScale);
        saveLyricScale(lyricScale);
        // 缩放改了行高 ⇒ 当前行的垂直居中要重算（否则「放大后当前句掉出视野」）
        centerCurLine();
        // ⚠️ 不写状态位：那块位置按 #408 只留给「进行中 / 异常」，字号变化本身就是可见反馈。
    };
    lyrics.addEventListener('wheel', onLyricWheel, { passive: false });

    // ── 档位：容器宽度决定，ResizeObserver 驱动 ──
    let lastWidth = -1;
    const applyTier = (): void => {
        const w = Math.round(root.clientWidth);
        const tier = resolveAudioLayout(w);
        // 未布局（宽度 0 / 量测异常）⇒ 跳过本轮，保持上一次的档位
        if (tier === null) return;
        if (w === lastWidth && root.dataset.tier === tier) return;
        lastWidth = w;
        root.dataset.tier = tier;
        // 档位变了 ⇒ 行高 / 容器高都变，当前行的居中要重算
        centerCurLine();
        // 🔴 档位一变，控制条的**内距/高度就变** ⇒ 浮层的 `bottom = 容器高 + 8` 是按旧高度算的，
        //    不重算就会「拖分栏时浮层错位」（浮层一直开着是常态：用户边看边拖）。
        //    ⚠️ 这里调的是**函数声明**（见下方 `replacePopIfOpen`）—— `const` 箭头在此时仍未初始化，会 TDZ。
        replacePopIfOpen();
    };

    // ── 歌词渲染 ──
    const renderLyrics = (): void => {
        lyrList.textContent = '';
        curLine = -1;
        curWord = -1;
        wordSpans.clear();
        if (!lines.length) {
            lyrList.appendChild(el('div', 'rl-ap-lyr-hint', '未找到歌词 — 可在条目笔记里加 lrc 代码块'));
            return;
        }
        lines.forEach((line, i) => {
            // 🔴 m04435 ③：`[Gold]` 标记过的行挂 `is-gold` —— CSS 靠它出**暗金**（非当前行）
            //    和**亮金**（`.is-gold.is-cur`）。⛔ 别在这里写颜色（真源在 `styles.css`）。
            //    ⚠️ `is-gold` **不改变 DOM 结构**（该行照旧拆成 `.rl-ap-lyr-w` 词元），
            //       但配色上它必须盖住逐字态 —— 否则金句当前行会被 `.is-cur .rl-ap-lyr-w.is-on`
            //       (0,4,0) 抢成主题色（🔴 m07623 用户报障：「被逐字滚动效果覆盖成主题色了」）。
            //       覆盖规则在 `styles.css` 的 `.rl-ap-lyr-line.is-gold.is-cur .rl-ap-lyr-w*`，
            //       判据在 `tests/lrcGold.test.ts` 的「按层叠算实际颜色」一组。⛔ 别在这里写颜色。
            const goldCls = line.gold ? ' is-gold' : '';
            const row = el('div', 'rl-ap-lyr-line' + (plainLyrics ? ' is-plain' : '') + goldCls);
            // 🔴 #406 逐字高亮：整行拆成词元 span（词元拼接 == `line.text`，⛔ 不动文本内容）。
            //    只在开关开 + 该行有词元时拆；否则退回原来的整行 `textContent`（零开销、零行为变化）。
            const words = wordHighlight && !plainLyrics ? line.words : undefined;
            if (words?.length) {
                const spans: HTMLElement[] = [];
                for (const w of words) {
                    const sp = el('span', 'rl-ap-lyr-w', w.text);
                    spans.push(sp);
                    row.appendChild(sp);
                }
                wordSpans.set(i, spans);
            } else {
                row.textContent = line.text;
            }
            // 🔴 #508（用户：「LRC双语歌词呈现渲染作两行（原文参与逐字高亮，译文作第二行变小变灰不参与逐字高亮）」）：
            //    译文**另起一行** —— `.rl-ap-lyr-tr`（小 + 灰），⛔ **不进 `wordSpans`**。
            //    ⚠️ 逐字高亮天然不会碰到它：词元 span 只覆盖**原文**（解析侧 `pure/lrc.splitAnnotation`
            //    已把 `原文 | 译文` 拆成 `text` / `annotation`，`extractPreciseWords` 也只吃 `text`）。
            //    ⛔ 别再退回「同一行里拼 ` · 译文`」（那正是用户要改掉的旧形态）。
            if (line.annotation) row.appendChild(el('div', 'rl-ap-lyr-tr', line.annotation));
            if (!plainLyrics) {
                row.addEventListener('click', () => {
                    audio.currentTime = Math.max(0, line.timestamp / 1000);
                    updateProgress();
                    syncCurrentLine(true);
                    syncCurrentWord(true);
                });
            }
            lyrList.appendChild(row);
        });
    };

    const curRow = (): HTMLElement | null => lyrList.children[curLine] as HTMLElement | undefined ?? null;

    /** 把当前行推到列表垂直正中（见文件头第 2 条口径）
     *
     *  🔴 用户 2026-11-08：「音乐播放器和字幕面板的滚动改要有动效而不是瞬间切换」
     *     ⇒ 平时走 `scrollTo({ behavior: 'smooth' })`；开了系统「减少动态效果」才退回
     *       瞬时赋值（那条 `scrollTop` 赋值必须**原样保留**：它既是降级路径，
     *       也是「位移夹到 ≥ 0」这条不变量的唯一实现 —— 负值会让浏览器把
     *       `scrollTop` 弹回 0 附近再被下次重算拉回，表现为歌词抖动）。
     *  ⚠️ 平滑版**同样**要夹 `Math.max(0, …)`：两处口径必须一致，
     *     否则开了动效的用户在列表顶部会看到歌词被拉上去又弹回来。 */
    const centerCurLine = (): void => {
        const row = curRow();
        if (!row) return;
        const delta = lyricCenterDelta(row.getBoundingClientRect(), lyrList.getBoundingClientRect());
        const behavior: ScrollBehavior = scrollBehavior();
        if (behavior === 'auto') {
            lyrList.scrollTop = Math.max(0, lyrList.scrollTop + delta);
            return;
        }
        lyrList.scrollTo({ top: Math.max(0, lyrList.scrollTop + delta), behavior });
    };

    const syncCurrentLine = (force = false): void => {
        if (plainLyrics || !lines.length) return;
        const next = lrcIndexAt(lines, audio.currentTime * 1000);
        if (!force && next === curLine) return;
        // 时间戳重复（副歌复用同刻）时 lrcIndexAt 取最后一个 ⇒ 不会来回跳
        const prev = lyrList.children[curLine] as HTMLElement | undefined;
        prev?.classList.remove('is-cur');
        curLine = next;
        // 换了行 ⇒ 逐字进度作废（新行从「一个字都没点亮」重新开始）
        curWord = -1;
        if (curLine < 0) return;
        const row = lyrList.children[curLine] as HTMLElement | undefined;
        if (!row) return;
        row.classList.add('is-cur');
        centerCurLine();
        syncCurrentWord(true);
    };

    /**
     * 逐字高亮（#406）：把当前行里「已唱到」的词元点亮。
     * 定位真源 = `pure/lrc.wordIndexAt`（⛔ 别在这里自己写二分）；只在开关开 + 当前行有词元时动手。
     * 🔴 只 toggle 变化的那一行的 span（数量级 = 一行十几个字），`timeupdate` 每秒几次完全够用。
     */
    const syncCurrentWord = (force = false): void => {
        if (!wordHighlight || plainLyrics) return;
        const spans = curLine < 0 ? undefined : wordSpans.get(curLine);
        if (!spans) return;
        const next = wordIndexAt(lines[curLine].words, audio.currentTime * 1000);
        if (!force && next === curWord) return;
        spans.forEach((sp, i) => sp.classList.toggle('is-on', i <= next));
        curWord = next;
    };

    // ── 进度 / 状态 ──
    const updateProgress = (): void => {
        const dur = audio.duration;
        const cur = audio.currentTime;
        const ratio = Number.isFinite(dur) && dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
        played.style.width = `${ratio * 100}%`;
        thumb.style.left = `${ratio * 100}%`;
        timeCur.textContent = formatTime(cur);
        timeTotal.textContent = formatTime(dur);
    };

    const setStatus = (text: string): void => {
        // 🔴 #408：状态位只留给**进行中 / 异常**（加载中 / 无法播放）；空串 ⇒ 整块收起（不占位）。
        // ⛔ 别再往里写「播放中 / 已暂停 / 已播完」—— 那三个由播放键的形状与图标表达
        //    （用户已经把这块地方要去做「打开笔记」按钮了）。
        statusText.textContent = text;
        statusEl.classList.toggle('is-empty', !text);
    };

    /** 「打开笔记」按钮的可用态（无笔记 / 宿主没接回调 ⇒ 禁用 + 说清原因）；提示只走 `aria-label`（#465，⛔ 别再加 `title`） */
    const refreshOpenNote = (track: AudioPlayerTrack): void => {
        const has = !!track.notePath;
        openNoteBtn.disabled = !has || !opts.onOpenNote;
        // ⚠️ 提示**必须带对象名**（§3 v10 口径：指向具体条目的按钮提示带上对象名）⇒ 精简只砍「这条曲目的」那几个字，
        //    不砍掉曲名本身（#467 精简批）。
        const tip = !has ? '这条条目还没有笔记' : `打开笔记：${track.title}`;
        openNoteBtn.setAttribute('aria-label', tip);
    };

    /**
     * 把一首曲目的**显示信息**刷到界面上（标题 / 副标题 / 封面 / 「打开笔记」态 / 信息块 / 页签标题回调）。
     * 🔴 与 `switchTo` 分开是给 `updateQueue` 用的：条目元数据变了但**音频没变**时只刷显示，
     *    ⛔ 不换源、不打断播放。
     */
    const refreshTrackMeta = (track: AudioPlayerTrack): void => {
        titleEl.textContent = track.title;
        // 标题被省略号截断时，hover 也要能看到全名 —— 走 `aria-label`（官方气泡），⛔ 别用 `title`（#465 双气泡）
        titleEl.setAttribute('aria-label', track.title);
        subEl.textContent = track.subtitle ?? '';
        subEl.style.display = track.subtitle ? '' : 'none';
        loadCover(track);
        refreshOpenNote(track);
        opts.onTrackChange?.(track);
    };

    const syncPlayButton = (): void => {
        const playing = !audio.paused && !audio.ended;
        setIcon(playBtn, playing ? 'pause' : 'play');
        playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
        // ⚠️ 这里曾经写状态位（播放中 / 已暂停 / 已播完）—— #408 起那块地方是「打开笔记」按钮，
        //    ⛔ 别再把播放态写回状态文本（那会让「加载中」被瞬间覆盖掉）。
    };

    const syncVolumeButton = (): void => {
        setIcon(volBtn, audioVolumeIcon(volume));
        volBtn.setAttribute(
            'aria-label',
            volume <= 0 ? '音量 0%（M 键取消静音）' : `音量 ${Math.round(volume * 100)}%（点击调节 · 滚轮微调）`,
        );
    };

    const syncModeButton = (): void => {
        // ⚠️ 这里**别用同名局部变量** `const mode = normalizeAudioPlayMode(mode)` ——
        //    局部 `mode` 会遮蔽外层的那个，右侧读到的就是它自己（TDZ / 读未初始化）。
        const m = normalizeAudioPlayMode(mode);
        setIcon(modeBtn, AUDIO_PLAY_MODE_ICONS[m]);
        modeBtn.setAttribute('aria-label', `播放模式：${AUDIO_PLAY_MODE_LABELS[m]}`);
        // 「已亮起」= 非「不循环」；⛔ 别用底色区分（并排按钮铺底色会连成色带）
        modeBtn.classList.toggle('is-on', m !== 'off');
    };

    // ── 队列推进（唯一真源：pure/audioQueue.decideTrack）──
    /**
     * 🔴 m14228 ③：把队列里每首的**个人评分**换算成乱序权重（星级 → 权重真源在
     * `pure/audioQueue.shuffleWeightOfRating`，⛔ 别在这里另写一套曲线）。
     *
     * 三条口径：
     *  ⑴ **全队都未评分 ⇒ 返回 `undefined`** —— 让 `buildShuffleBag` 走等概率老路径，
     *     行为与加权前逐字一致（不是「权重都是 1 的加权洗牌」，那会让随机序列整体偏移）；
     *  ⑵ 每次洗牌现算（`items` 可在播放中经 `updateQueue` 换掉）—— 不缓存，缓存了就必然出现
     *     「换了队列还用旧权重」的鬼故事；
     *  ⑶ 只读 `track.rating`，⛔ 不写回。
     */
    const shuffleWeights = (): ShuffleWeights | undefined => {
        let any = false;
        const out: Record<string, number> = {};
        for (const t of items) {
            const w = shuffleWeightOfRating(t.rating);
            out[t.path] = w;
            if (t.rating != null) any = true;
        }
        return any ? out : undefined;
    };
    const applyDecision = (trigger: 'ended' | 'manual', direction: 'next' | 'prev'): void => {
        const target = idx >= 0 ? items[idx].path : '';
        const decision = decideTrack({
            paths: items.map((t) => t.path),
            current: target,
            mode,
            trigger,
            direction,
            bag,
            // 🔴 m14228 ③：乱序按个人评分加权（5★ 常出现、1★ 大幅降低）。
            // ⚠️ 只在 `shuffle` 生效；`weights` 缺省时 `buildShuffleBag` 走等概率老路径。
            weights: shuffleWeights(),
        });
        bag = decision.bag;
        if (decision.target === null) {
            // `off` 模式曲终 / 无可播项 ⇒ 停在原地（⛔ 别硬切回第一首）
            audio.pause();
            syncPlayButton();
            return;
        }
        const nextIdx = items.findIndex((t) => t.path === decision.target);
        if (nextIdx < 0) return;
        if (decision.replay) {
            // 同曲 ⇒ **回到 0 秒重播**（⛔ 不走「换源」：重新加载会闪一下封面，观感像卡了）
            audio.currentTime = 0;
            beginPlayback();
            return;
        }
        void switchTo(nextIdx, true);
    };

    // ── 切曲 / 起播 ──
    const loadCover = (track: AudioPlayerTrack): void => {
        cover.textContent = '';
        if (!track.coverUrl) {
            const ico = el('span', 'rl-ap-ico');
            setIcon(ico, 'music');
            cover.appendChild(ico);
            return;
        }
        const img = el('img', 'rl-ap-cover-img');
        img.src = track.coverUrl;
        img.alt = '';
        img.loading = 'lazy';
        cover.appendChild(img);
    };

    const applyMode = (next: AudioPlayMode, save = true): void => {
        mode = next;
        syncModeButton();
        if (save) opts.onSaveMode?.(mode);
    };

    const beginPlayback = (): void => {
        opts.onPlayStart?.('audio');
        void audio.play().catch(() => {
            // 自动播放被拦 / 文件不可解码：如实说明，⛔ 别静默（用户会以为「点了没反应」）
            setStatus('无法播放');
        });
    };

    const loadLyrics = async (track: AudioPlayerTrack): Promise<void> => {
        const seq = ++lyricsSeq;
        lines = [];
        parsedLines = [];
        // 🔴 m08028：偏移**按条目记忆**（用户：「每条目各自记住」）⇒ 切曲先取出这首歌的偏移量。
        //    ⚠️ 必须在 `renderLyrics()` 之前取：渲染时要用它决定 `lines` 的内容。
        lyricOffset = loadLyricOffset(track.entryId);
        plainLyrics = false;
        renderLyrics();
        let got: { text: string; origin: LrcLyricsOrigin } | null = null;
        try {
            got = await opts.loadLyrics(track);
        } catch {
            got = null;
        }
        // 期间又切曲了 ⇒ 丢弃这次结果（否则「歌词比歌慢一步」，显示的是上一首的词）
        if (destroyed || seq !== lyricsSeq) return;
        const text = got?.text ?? '';
        if (text.trim()) {
            const parsed = parseLrc(text);
            if (parsed.length) {
                parsedLines = parsed;
                lines = shiftLrcLines(parsedLines, lyricOffset);
            } else {
                // 不是 LRC（同名 .lrc 里其实是整篇文本）：按纯文本列出来，不高亮、不跳转
                plainLyrics = true;
                lines = text.split('\n').map((t, i) => ({ timestamp: i, timestr: '', text: t })).filter((l) => l.text.trim());
            }
        }
        renderLyrics();
        syncCurrentLine(true);
    };

    /**
     * 🔴 m08028：改偏移并立刻生效（用户：「播放器里加 ±0.5s/±1s 微调，边听边校、立即生效」）。
     *
     * 只做三件事：夹取 → 重算显示用 `lines` → 重渲染 + 重新对齐当前行。
     * ⛔ 不动 `audio.currentTime` —— 用户要的是「歌词动」，不是「歌跳」。
     * 记忆（localStorage）在这里写，因为这是**唯一**的改动入口。
     */
    const setLyricOffset = (next: number): void => {
        const v = clampLyricOffset(next);
        if (v === lyricOffset) return;
        lyricOffset = v;
        const track = items[idx];
        if (track?.entryId) saveLyricOffset(track.entryId, v);
        // 纯文本歌词没有时间轴，平移无意义；`parsedLines` 为空时也不动（避免把提示行清掉）
        if (!plainLyrics && parsedLines.length) {
            lines = shiftLrcLines(parsedLines, lyricOffset);
            renderLyrics();
            syncCurrentLine(true);
        }
        syncOffsetButton();
        syncOffsetPop();
    };

    const switchTo = async (nextIdx: number, autoplay: boolean): Promise<void> => {
        idx = nextIdx;
        const track = items[idx];
        // 🔴 m02288：先结算**上一首**那一段，再换账本 —— 顺序反了会把上一首的零头记到下一首头上
        resetListenFor(track);
        refreshTrackMeta(track);
        audio.src = track.url;
        audio.currentTime = 0;
        updateProgress();
        // 🔴 #410：切歌**不再显示「加载中」**（用户：「这个加载中提示给我去除掉」）——
        //    切歌是瞬时的，那条提示只会闪一下；真出问题（无法播放）仍然会报。
        setStatus('');
        if (autoplay) beginPlayback();
        else syncPlayButton();
        await loadLyrics(track);
    };

    /**
     * 🔴 #408：宿主机发现「库里的条目变了」（新增 / 改了关联音频 / 删了）⇒ 把**新队列**推过来。
     * 用户报的就是这条：播放中在别处更新了条目与笔记，播放器**识别不到**（队列与歌词都停在打开那一刻）。
     *
     * 三条语义：
     *  ⑴ **认人**：按 `entryId` 找回当前曲目在新队列里的位置（⛔ 不按下标 —— 中途插入新歌会让下标错位）；
     *  ⑵ 找到且音频路径**没变** ⇒ 只刷显示信息（标题 / 副标题 / 封面 / 信息块），⛔ 不换源、不打断播放；
     *  ⑶ 路径变了 ⇒ `switchTo` 重载源，并**保持原来的播放 / 暂停态**（正在播就接着播）。
     * ⚠️ 当前曲目已不在新队列里（条目被删 / 改成别的类型）⇒ **什么都不做** ——
     *    正在听的歌不能被悄悄换掉（要停也得是用户点停）。
     */
    const updateQueue = (next: readonly AudioPlayerTrack[]): void => {
        const cur = items[idx];
        items = next.slice();
        // 🔴 m11034：队列变了 ⇒ 洗牌袋里可能留着**已经不在队列里**的路径。
        //    不清理的话，`applyDecision` 里 `findIndex` 返 -1 会静默 return ——
        //    用户点「下一首」像按了没反应（且没有任何提示）。只保留仍在队列里的项。
        const alive = new Set(items.map((t) => t.path));
        bag = bag.filter((p) => alive.has(p));
        if (!items.length || !cur) return;
        const i = items.findIndex((t) => !!t.entryId && t.entryId === cur.entryId);
        if (i < 0) return;
        if (items[i].path !== cur.path) void switchTo(i, !audio.paused && !audio.ended);
        else {
            idx = i;
            refreshTrackMeta(items[i]);
        }
    };

    // ── 事件绑定 ──
    const onTimeUpdate = (): void => {
        updateProgress();
        syncCurrentLine();
        syncCurrentWord();
    };
    const onLoadedMetadata = (): void => {
        updateProgress();
        syncCurrentLine(true);
        syncCurrentWord(true);
    };
    const onPlay = (): void => {
        // 🔴 接上 WebAudio 后若 `AudioContext` 还在 suspended，**一点声都没有** ⇒ 每次起播都补一次 resume
        if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume?.().catch(() => undefined);
        syncPlayButton();
        // 🔴 m02288：起播 = 这一段开始计时（`play` 可能因 seek/挂起被重复触发，
        //   所以只在「当前没有起点」时置点，⛔ 别无条件覆盖 —— 那会把前面那段的时长吞掉）
        if (listenSince === null) listenSince = Date.now();
    };
    const onPause = (): void => {
        syncPlayButton();
        // 🔴 m02288：暂停/播完 = 这一段结算（`pause` 也会在 `ended` 前触发，`flushListen` 幂等）
        flushListen();
    };
    const onEnded = (): void => {
        syncPlayButton();
        flushListen();
        applyDecision('ended', 'next');
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            opts.onPlayStart?.('audio');
            void audio.play().catch(() => setStatus('无法播放'));
        } else audio.pause();
    });
    prevBtn.addEventListener('click', () => applyDecision('manual', 'prev'));
    nextBtn.addEventListener('click', () => applyDecision('manual', 'next'));
    modeBtn.addEventListener('click', () => applyMode(cycleAudioPlayMode(mode)));

    /** 音量唯一写入口（按钮点击 / 滚轮 / 快捷键三处共用，⛔ 别各写一遍 muted 同步） */
    /**
     * 增益链（只有 > 100% 才需要）：原生 `<audio>.volume` 上限是 1，200% 那截只能靠 `GainNode`。
     *
     * 🔴 三个坑：⑴ `createMediaElementSource` 对**同一个元素只能调一次**（再调抛 `InvalidStateError`）
     *   ⇒ 用 `sourceBound` 记住「试过了」，失败也不再重试；⑵ WebAudio 的图一旦接上，**音频只走这张图** ——
     *   若 `AudioContext` 处于 `suspended`（无用户手势时就是这样）会**完全没声**⇒ 建完立刻 `resume()`，
     *   并在每次 `play` 时再补一次；⑶ 建失败/不支持 ⇒ **降级为原生音量**（`>100%` 那截丢失），⛔ 绝不抛。
     */
    let audioCtx: AudioContext | null = null;
    let gainNode: GainNode | null = null;
    let sourceBound = false;

    function ensureGain(): boolean {
        if (gainNode) return true;
        if (sourceBound) return false;
        sourceBound = true;
        const w = window as unknown as {
            AudioContext?: typeof AudioContext;
            webkitAudioContext?: typeof AudioContext;
        };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) return false;
        try {
            const ctx = new Ctor();
            const src = ctx.createMediaElementSource(audio);
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(ctx.destination);
            audioCtx = ctx;
            gainNode = gain;
            void ctx.resume?.().catch(() => undefined);
            return true;
        } catch {
            try {
                void audioCtx?.close();
            } catch {
                /* 关不掉就算了 */
            }
            audioCtx = null;
            gainNode = null;
            return false;
        }
    }

    /** 把 `volume` 写进「元素 + 增益」这一对（🔴 有增益时元素固定 1，否则 `volume × gain` 会双重衰减） */
    function applyVolume(): void {
        const gainActive = gainNode !== null;
        audio.muted = volume <= 0;
        audio.volume = elementVolumeFor(volume, gainActive);
        if (gainNode) gainNode.gain.value = gainValueFor(volume, gainActive);
    }

    const setVolume = (next: number): void => {
        const v = clampAudioVolume(next);
        if (v === volume) return;
        volume = v;
        if (needsGain(v)) ensureGain();
        applyVolume();
        syncVolumeButton();
        syncVolumePop();
        opts.onSaveVolume?.(v);
    };
    /** 静音 ⇄ 取消静音：静音中恢复**满音量**（⛔ 别记「上次音量」—— 那要再存一份状态，收益极小）。
     *  入口：`M` 键（`AudioPlayerView` → `handle.toggleMute`）与把滑条拖到 0。 */
    const toggleMute = (): void => setVolume(volume <= 0 ? 1 : 0);

    /** 设定倍速（浮层选档回传）。🔴 按钮文案**固定「倍速」**、⛔ 别跟着档位变（与视频播放器同口径，
     *  用户 2026-09-18 明示）；非 1× 时用 `.is-var` 变色提示 —— ⛔ 别复用 `is-on`（那是「浮层开着」）。 */
    const setSpeed = (v: number): void => {
        apSpeed = Number.isFinite(v) && v > 0 ? v : 1;
        audio.playbackRate = apSpeed;
        speedBtn.classList.toggle('is-var', apSpeed !== 1);
        syncSpeedButton();
        // 🔴 必须同步浮层：**拖动时手柄在动、已填充段不动 = 看着错位**（本批用户截图报的那个 bug）。
        //    原来只有 `onInput` 里手写了一次「改读数」，填充段（`--rl-ap-range-p`）从建面板起就没再更新过。
        syncSpeedPop();
    };

    /** 倍速按钮同步（提示 = `aria-label` 一种，见文件头 #465 口径）：文案与 `.is-var` 都只在这里写，⛔ 别在各调用点各写一遍 */
    const syncSpeedButton = (): void => {
        const label = formatSpeed(apSpeed);
        speedBtn.textContent = label;
        speedBtn.setAttribute('aria-label', `播放速度 ${label}`);
    };

    const onWheel = (ev: WheelEvent): void => {
        ev.preventDefault();
        setVolume(volume + (ev.deltaY < 0 ? AUDIO_VOLUME_STEP : -AUDIO_VOLUME_STEP));
    };
    volBtn.addEventListener('wheel', onWheel, { passive: false });

    /**
     * 浮层（倍速档位 / 音量滑条**共用一个容器**）—— 与视频播放器同构：
     * 它是**控制条的绝对定位子元素**（`.rl-ap-controls` 为定位上下文），位置每次打开由纯函数
     * `menuAnchor` 算（`bottom = 容器高 + 间距` ⇒ **向上开**，控制条在底部也不会顶出视图）。
     *
     * 🔴 三条硬约束（视频播放器那边实测踩过）：
     *  ⑴ 浮层**自己挡 `mousedown`** —— 否则拖滑条会穿透到下面的进度条 / 宿主；
     *  ⑵ 外点关闭挂 `document` **捕获阶段**，且必须**放行「浮层内」与「触发按钮」** ——
     *     否则「再点一次入口按钮关浮层」会先被这里关掉、随后按钮 click 又把它打开 = 点了没反应；
     *  ⑶ 先撤 `is-hidden` **再**量宽 —— `display:none` 的元素 `getBoundingClientRect()` 恒为 0。
     */
    const pop = el('div', 'rl-ap-pop is-hidden');
    pop.addEventListener('mousedown', (ev) => ev.stopPropagation());
    pop.addEventListener('click', (ev) => ev.stopPropagation());
    controls.appendChild(pop);
    let popKind: PlayerMenuKind | null = null;
    let popTrigger: HTMLElement | null = null;

    const closePop = (): void => {
        popKind = null;
        popTrigger = null;
        pop.classList.add('is-hidden');
        speedBtn.classList.remove('is-on');
        volBtn.classList.remove('is-on');
        offsetBtn.classList.remove('is-on');
    };

    const placePop = (btn: HTMLElement, align: 'right' | 'center'): void => {
        const barRect = controls.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const pos = menuAnchor({
            btnLeft: btnRect.left - barRect.left,
            btnRight: btnRect.right - barRect.left,
            menuW: pop.getBoundingClientRect().width,
            containerW: barRect.width,
            containerH: barRect.height,
            align,
        });
        pop.style.left = `${pos.left}px`;
        pop.style.bottom = `${pos.bottom}px`;
    };

    /**
     * 同步音量浮层的三条信息（数值 / 滑条位置 / 已填充比例）—— 浮层没开就什么都不做。
     * ⚠️ 滑条只存在于浮层里（点开才建）⇒ 一律**查询**而非常驻引用（否则会写到已脱离 DOM 的旧元素上）；
     * 写成**函数声明**（而非 `const` 箭头）是为了能被上面的 `setVolume` 引用而不触发 TDZ。
     */
    function syncVolumePop(): void {
        const val = pop.querySelector('.rl-ap-range-val');
        if (val instanceof HTMLElement) val.textContent = formatVolumePercent(volume);
        const slider = pop.querySelector('input.rl-ap-range');
        if (slider instanceof HTMLInputElement) {
            const pct = volumePercent(volume);
            slider.value = String(pct);
            // 轨道代表 0–200% ⇒ 已填充比例 = 百分比 / 2（100% 时正好半条）
            slider.style.setProperty('--rl-ap-range-p', `${pct / 2}%`);
            // 🔴 当前**颜色**（用户 2026-09-27 第二轮改判：「0% 时不显示段换色，从 0 到 100% 过程逐渐变色，
            //    不是一开始就固定色在那」）⇒ 颜色是**当前值的函数**，⛔ 不是在固定位置摆一段异色。
            //    两个数字交给 CSS 做两级 `color-mix`（主题色留在 CSS 里，JS 只给数）：
            //      `sat`  0%→下限、100%→满（低音量淡、越推越实）；≤100% 时 `warm` 恒 100 = **不偏橙**。
            //    ⚠️ 这两个变量**只由音量滑条设置** ⇒ 倍速滑条取默认值 = 纯强调色（用户：倍速滑条不换色）。
            const tint = volumeTint(pct);
            slider.style.setProperty('--rl-ap-vol-sat', `${tint.sat}%`);
            slider.style.setProperty('--rl-ap-vol-warm', `${tint.warm}%`);
        }
    }

    /**
     * 造一个横向滑条浮层内容（倍速 / 音量**共用**这一套排版）：
     * 顶部读数 + 一条细轨（已填充段靠 `--rl-ap-range-p` 表达 —— Chromium 的 range 没有 progress 伪元素，
     * 那是 Firefox 的 `::-moz-range-progress`），拖动仍走原生 range（键盘可达、拖动逻辑免费）。
     */
    function buildRangePop(opts0: {
        label: string;
        min: number;
        max: number;
        step: number;
        value: number;
        aria: string;
        onInput: (raw: number) => void;
    }): void {
        const box = el('div', 'rl-ap-rangebox');
        const val = el('div', 'rl-ap-range-val', opts0.label);
        const input = el('input', 'rl-ap-range') as HTMLInputElement;
        input.type = 'range';
        input.min = String(opts0.min);
        input.max = String(opts0.max);
        input.step = String(opts0.step);
        input.value = String(opts0.value);
        input.setAttribute('aria-label', opts0.aria);
        input.addEventListener('input', () => opts0.onInput(Number(input.value)));
        // 初值 / 已填充比例统一由各自 sync 写（与键盘 / 滚轮同一条路径，⛔ 不写第二处真源）
        box.appendChild(val);
        box.appendChild(input);
        pop.appendChild(box);
    }

    /** 倍速浮层：**档位索引**滑条（档位与名称全部来自 `pure/playerMenu.buildSpeedOptions`） */
    const fillSpeedPop = (): void => {
        const list = buildSpeedOptions(apSpeed);
        const at = list.findIndex((i) => i.active);
        buildRangePop({
            label: formatSpeed(apSpeed),
            min: 0,
            max: list.length - 1,
            step: 1,
            value: at < 0 ? 0 : at,
            aria: '播放速度',
            // ⛔ 这里**只回传档位**：读数 / 滑条位置 / 填充段全部由 `setSpeed → syncSpeedPop` 统一写
            //    （原先在此处另写一次读数，就是「两处各写一遍」的形态，也正是填充段漏更新的成因）
            onInput: (raw) => {
                const i = Math.max(0, Math.min(list.length - 1, Math.round(raw)));
                const picked = list[i];
                setSpeed(picked ? picked.value : apSpeed);
            },
        });
        syncSpeedPop();
    };

    /**
     * 倍速浮层同步（读数 / 滑条位置 / **已填充段**）—— 唯一写入口，由 `setSpeed()` 每次调用。
     * 🔴 档位索引也取自 `buildSpeedOptions`（与建面板时的 `max` 同源），⛔ 别再引第二处档位表。
     */
    function syncSpeedPop(): void {
        const val = pop.querySelector('.rl-ap-range-val');
        if (val instanceof HTMLElement) val.textContent = formatSpeed(apSpeed);
        const slider = pop.querySelector('input.rl-ap-range');
        if (slider instanceof HTMLInputElement) {
            const list = buildSpeedOptions(apSpeed);
            const at = list.findIndex((i) => i.active);
            const idx = at < 0 ? 0 : at;
            slider.value = String(idx);
            const span = Math.max(1, list.length - 1);
            slider.style.setProperty('--rl-ap-range-p', `${(idx / span) * 100}%`);
        }
    }

    /** 音量浮层：**0–200%、每 10% 一档**（标度真源 `pure/audioVolume`） */
    const fillVolumePop = (): void => {
        buildRangePop({
            label: formatVolumePercent(volume),
            min: 0,
            max: AUDIO_VOLUME_MAX * 100,
            step: AUDIO_VOLUME_STEP_PCT,
            value: volumePercent(volume),
            aria: '音量',
            onInput: (raw) => setVolume(volumeFromPercent(raw)),
        });
        syncVolumePop();
    };

    /**
     * 🔴 m08028：歌词偏移浮层的内容。
     *
     * 四段：读数 → 五段步进（`<<  <  0.0s  >  >>`）→ 重置 → 写回笔记。
     * ⚠️ 全部走 `setLyricOffset()` 这一个入口（⛔ 别在这里直接改 `lyricOffset` ——
     *    那样会漏掉记忆落库与 `lines` 重算，表现为「按钮点了但画面不动」）。
     *
     * 🔴 用 `-` 而不是「往前/往后」：偏移方向本身就容易讲反。
     *    本按钮的语义是「把**歌词时间轴**整体挪动」，`+` = 歌词更晚出现（歌跑到歌词后面去了）。
     *
     * 🔴 m08754 ①（用户：「把偏移值按改成 -+0.1s、1s 调整：UI 按 `<<  <  0s  >  >>` 显示，
     *    重置和写入笔记文字按钮都改成图标按钮」）⇒ 从「四个文字按钮 ±1s/±0.5s」改成
     *    「五段同行：`<<`(−1s) `<`(−0.1s) 读数 `>`(+0.1s) `>>`(+1s)」，动作区改图标。
     */
    function fillOffsetPop(): void {
        const head = el('div', 'rl-ap-offset-head');
        head.appendChild(el('div', 'rl-ap-offset-hint', '歌词整体挪动，点「写回笔记」后永久生效'));
        pop.appendChild(head);

        const build = (label: string, tip: string, delta: number): HTMLElement => {
            const b = el('button', 'rl-ap-offset-step', label) as HTMLButtonElement;
            b.type = 'button';
            // ⚠️ 只挂 aria-label、⛔ 不挂 title（Obsidian 会给 title 再套一层气泡，与 aria 双弹，见 #465）
            b.setAttribute('aria-label', tip);
            b.addEventListener('click', () => setLyricOffset(lyricOffset + delta));
            return b;
        };
        // 五段同一行：粗调在两头、细调贴着读数 —— 手指/鼠标从左往右扫，步长依次变细再变粗。
        // ⚠️ 文案就用用户给的原样 `<<` / `<` / `>` / `>>`（⛔ 别换成 `«‹›»` 这类排版引号：
        //    用户是照着「像播放器的快退/快进」的直觉写的，换字形会让它读起来像书名号）。
        const row = el('div', 'rl-ap-offset-row');
        row.appendChild(build('<<', '提前 1 秒', -LYRIC_OFFSET_COARSE));
        row.appendChild(build('<', '提前 0.1 秒', -LYRIC_OFFSET_STEP));
        row.appendChild(el('div', 'rl-ap-offset-val', lyricOffsetLabel(lyricOffset)));
        row.appendChild(build('>', '延后 0.1 秒', LYRIC_OFFSET_STEP));
        row.appendChild(build('>>', '延后 1 秒', LYRIC_OFFSET_COARSE));
        pop.appendChild(row);

        const actions = el('div', 'rl-ap-offset-actions');
        // 动作区两颗**图标按钮**（m08754 ①：「重置和写入笔记文字按钮都改成图标按钮」）——
        // 走与工具栏同一个 `iconButton()`，尺寸/描边/悬停态自动与左侧那排图标同族。
        const reset = iconButton('rl-ap-offset-act', 'rotate-ccw', '重置偏移为 0');
        reset.addEventListener('click', () => setLyricOffset(0));
        actions.appendChild(reset);

        // 「写回笔记」只在宿主给了回调、且当前偏移非零时可用 ——
        // ⛔ 偏移为 0 时写了也没意义（等于把文件重写一遍），按钮置灰说明原因。
        // ⚠️ 可用态与 aria **不在这里写**：建节点时先给个占位，函数末尾交给 `syncOffsetPop()`
        //    统一刷（偏移一变就要跟着变，写两处必然漂）。
        const save = iconButton('rl-ap-offset-act is-primary', 'save', '把当前偏移写进歌词文件');
        save.disabled = true;
        save.addEventListener('click', () => {
            const track = items[idx];
            const cb = opts.onWriteBackLyricOffset;
            if (!track || !cb || lyricOffset === 0) return;
            const delta = lyricOffset;
            // 立刻置灰防连点（异步写盘期间再点一次会重复改写同一段）
            save.disabled = true;
            void cb(track, delta)
                .then((wrote) => {
                    // ⚠️ 只有**真写了盘**才重载 + 归零：没写（无笔记 / 内容无变化）还归零，
                    //    会把用户刚调好的偏移凭空丢掉，而文件里根本没有那段偏移。
                    if (!wrote) return;
                    // 顺序：**先**归零（清掉 localStorage 里的这条记忆，否则 `loadLyrics` 会把旧偏移再读回来）
                    //      **再**重载（把文件里刚写进去的新时间读回来）。
                    setLyricOffset(0);
                    void loadLyrics(track);
                })
                .catch(() => undefined)
                .finally(() => {
                    // 浮层可能已经被关掉（`closePop` 会把 pop 清空）⇒ 节点还在才恢复可点
                    if (save.isConnected) save.disabled = lyricOffset === 0;
                });
        });
        actions.appendChild(save);
        pop.appendChild(actions);
        // 建完立刻刷一遍可用态（首帧就正确，别等用户先点一次 ± 才变）
        syncOffsetPop();
    }

    /**
     * 偏移浮层读数同步（浮层没开就什么都不做；只改读数那一个节点）。
     * 🔴 m08545 实测出来的真 bug：这里原先**只**改 `.rl-ap-offset-val`，于是一进浮层就先点
     *    「写回笔记」的那颗按钮永远停在 `fillOffsetPop()` 建节点那一刻的状态 —— 偏移从 0 调到
     *    `+1s` 后它仍然 `disabled`，用户点不到，功能等于没做。⇒ 写回按钮的可用态**必须**跟着
     *    读数一起刷新（两处写必然漂，收在这一个函数里）。
     */
    function syncOffsetPop(): void {
        const val = pop.querySelector('.rl-ap-offset-val');
        if (val instanceof HTMLElement) val.textContent = lyricOffsetLabel(lyricOffset);
        const save = pop.querySelector('.rl-ap-offset-act.is-primary');
        if (!(save instanceof HTMLButtonElement)) return;
        const canWrite = !!opts.onWriteBackLyricOffset && lyricOffset !== 0;
        save.disabled = !canWrite;
        save.setAttribute(
            'aria-label',
            !opts.onWriteBackLyricOffset
                ? '当前歌词来源不支持写回'
                : lyricOffset === 0
                  ? '偏移为 0，无需写回'
                  : '把当前偏移写进歌词文件',
        );
    }

    /**
     * 偏移按钮状态同步（**唯一写入口**）。
     * 🔴 m08545 起按钮是**铅笔图标**，所以这里 ⛔ 不写 `textContent`（写一次图标就没了），
     * 只维护 `.is-var` 与 `aria-label` / `data-offset`（便于真机与断言核对）。
     * 读数本身在浮层 `.rl-ap-offset-val` 里（`syncOffsetPop` 负责）。
     *
     * 🔴🔴 m08754 ① 用户改判：「仅在保持点击时高亮显示图标（取消后正常显示灰色图标）」——
     *    此前的 `.is-var`（偏移非 0 就常亮强调色）与这条**直接冲突**：用户看到的是「没开浮层
     *    图标也一直亮着」，误以为按钮卡住了。⇒ `.is-var` 退化成**纯数据标记**（不再带任何配色），
     *    高亮只由 `.is-on` 承担，而 `.is-on` **只**在 `openPop`/`closePop` 里翻转（与倍速/音量同款）。
     *    ⛔ 别再把 `.is-var` 写回 `styles.css` 的着色规则：那会让「关闭后回灰」失效。
     */
    function syncOffsetButton(): void {
        const label = lyricOffsetLabel(lyricOffset);
        offsetBtn.classList.toggle('is-var', lyricOffset !== 0);
        offsetBtn.setAttribute('aria-label', `歌词偏移 ${label}（对齐歌曲与歌词）`);
        offsetBtn.setAttribute('data-offset', label);
    }

    const openPop = (kind: 'speed' | 'volume' | 'lyricOffset', btn: HTMLElement): void => {
        popKind = kind;
        popTrigger = btn;
        pop.replaceChildren();
        if (kind === 'speed') fillSpeedPop();
        else if (kind === 'lyricOffset') fillOffsetPop();
        else fillVolumePop();
        pop.classList.remove('is-hidden');
        placePop(btn, kind === 'volume' ? 'center' : 'right');
        speedBtn.classList.toggle('is-on', kind === 'speed');
        volBtn.classList.toggle('is-on', kind === 'volume');
        offsetBtn.classList.toggle('is-on', kind === 'lyricOffset');
    };

    const togglePop = (kind: 'speed' | 'volume' | 'lyricOffset', btn: HTMLElement): void => {
        if (nextMenuState(popKind, kind) === null) closePop();
        else openPop(kind, btn);
    };

    /** 🔴 捕获阶段 + 放行「浮层内 / 触发按钮」两处（见上方 ⑵） */
    /** 浮层开着时按当前几何重算位置（`applyTier` 里那处调用的目标；函数声明 ⇒ 提升，无 TDZ） */
    function replacePopIfOpen(): void {
        if (popKind && popTrigger) placePop(popTrigger, popKind === 'volume' ? 'center' : 'right');
    }

    const onDocPointerDown = (ev: PointerEvent): void => {
        if (!popKind) return;
        const target = ev.target as Node | null;
        if (target && (pop.contains(target) || !!popTrigger?.contains(target))) return;
        closePop();
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    speedBtn.addEventListener('click', () => togglePop('speed', speedBtn));
    volBtn.addEventListener('click', () => togglePop('volume', volBtn));
    offsetBtn.addEventListener('click', () => togglePop('lyricOffset', offsetBtn));

    /** 进度条拖动：pointerdown 起、pointerup 止（capture 到 window，手指/鼠标移出条外也不断） */
    const ratioAt = (clientX: number): number => {
        const rect = progress.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };
    const seekRatio = (ratio: number): void => {
        const dur = audio.duration;
        if (!Number.isFinite(dur) || dur <= 0) return;
        audio.currentTime = ratio * dur;
        updateProgress();
        syncCurrentLine(true);
    };
    let dragging = false;
    const onPointerMove = (ev: PointerEvent): void => {
        if (dragging) seekRatio(ratioAt(ev.clientX));
    };
    const onPointerUp = (): void => {
        dragging = false;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
    };
    progress.addEventListener('pointerdown', (ev: PointerEvent) => {
        dragging = true;
        seekRatio(ratioAt(ev.clientX));
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    });

    // ── 装载 ──
    let ro: ResizeObserver | null = null;
    syncModeButton();
    syncVolumeButton();
    if (needsGain(volume)) ensureGain();
    applyVolume();
    audio.playbackRate = apSpeed;
    speedBtn.classList.toggle('is-var', apSpeed !== 1);
    syncSpeedButton();
    syncOffsetButton();
    if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(() => applyTier());
        ro.observe(root);
    } else {
        window.addEventListener('resize', applyTier);
    }
    const onWindowLoad = (): void => {
        // 字体加载完行高会变 ⇒ 强制重算档位与居中
        lastWidth = -1;
        applyTier();
        centerCurLine();
    };
    window.addEventListener('load', onWindowLoad);

    void switchTo(idx, autoplay).then(() => {
        applyTier();
    });

    const handle: AudioPlayerHandle = {
        root,
        toggle(): void {
            if (audio.paused) {
                opts.onPlayStart?.('audio');
                void audio.play().catch(() => setStatus('无法播放'));
            } else audio.pause();
        },
        seekBy(delta: number): void {
            const dur = audio.duration;
            const target = audio.currentTime + delta;
            audio.currentTime = Number.isFinite(dur) && dur > 0 ? Math.max(0, Math.min(dur, target)) : Math.max(0, target);
            updateProgress();
            syncCurrentLine(true);
        },
        nudgeVolume(dir: 1 | -1): void {
            setVolume(volume + dir * AUDIO_VOLUME_STEP);
        },
        toggleMute,
        isPlaying: () => !audio.paused && !audio.ended,
        pause(): void {
            audio.pause();
        },
    /** 🔴 #408：重载当前曲目的歌词（笔记 / 同名 `.lrc` 被改后由宿主或视图层触发） */
    reloadLyrics(): void {
            const t = items[idx];
            if (t) void loadLyrics(t);
        },
        /**
         * 🔴 m08028：**写回成功后**把实时偏移归零（宿主在写盘完成后调）。
         *
         * 为什么不复用 `setLyricOffset(0)` 的副作用了事：那个会顺手把 localStorage 里这条记忆删掉 ——
         * 正是我们要的（偏移已经落进文件，不需要再记），但也必须**先重载歌词**才能让画面与文件一致。
         * 顺序写死在宿主侧（`写盘 → reloadLyrics() → resetLyricOffset()`），这里只提供出口。
         */
        resetLyricOffset(): void {
            setLyricOffset(0);
        },
        /**
         * 🔴 #410：隐藏 / 恢复「打开笔记」按钮（**侧边栏实例整颗不显示** —— 用户：
         * 「如果侧边栏打开（的播放器），不显示打开笔记按钮」）。
         * 宿主按 leaf 归属判定后调用；`updateQueue` 之外**唯一**能改它的口，幂等。
         * ⚠️ 隐藏的是**按钮本身**，状态位（异常提示）不受影响。
         */
        setOpenNoteHidden(hidden: boolean): void {
            root.classList.toggle('rl-ap-no-note-btn', hidden);
        },
        /** 🔴 #408：宿主推新队列（库里的条目变了）—— 见 `updateQueue` 的三条语义 */
        updateQueue(next: readonly AudioPlayerTrack[]): void {
            updateQueue(next);
        },
        destroy(): void {
            destroyed = true;
            lyricsSeq++;
            // 🔴 m02288：关播放器前把最后那一段结算掉 —— 否则「听着歌关掉标签页」那段白听
            flushListen();
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', onEnded);
            volBtn.removeEventListener('wheel', onWheel);
            lyrics.removeEventListener('wheel', onLyricWheel);
            document.removeEventListener('pointerdown', onDocPointerDown, true);
            onPointerUp();
            if (ro) ro.disconnect();
            else window.removeEventListener('resize', applyTier);
            // 关掉增益链（每个挂载各自一份 ctx；不关会一直占着音频图）
            try {
                void audioCtx?.close();
            } catch {
                /* 关不掉就算了 */
            }
            audioCtx = null;
            gainNode = null;
            window.removeEventListener('load', onWindowLoad);
            root.remove();
        },
    };
    return handle;
}

/**
 * 笔记内 ` ```lrc ` 块的内联播放器（④-4 / D-8(c)）。
 *
 * 🔴 必须走 `ctx.addChild(...)` 的卸载链：预览被卸载（切走笔记、切编辑模式、关标签页）时
 *    **释放音频**。若直接把 DOM 塞进 `el` 了事，关掉笔记后音频会继续放 —— 这正是
 *    「播放器自己停不下来」的经典成因，而且在 Obsidian 里没有其它地方能替它收尾。
 *
 * `build` 是懒回调：选项要读 vault（解析 URL / 找条目 / 取歌词），在 `onload` 里才算，
 * 但**渲染阶段本身是同步的** —— 所以块先占位、选项到了再挂播放器。
 */
export class AudioInlineBlock extends MarkdownRenderChild {
    private handle: AudioPlayerHandle | null = null;
    private disposed = false;

    constructor(containerEl: HTMLElement, private readonly build: () => Promise<AudioPlayerMountOptions>) {
        super(containerEl);
    }

    async onload(): Promise<void> {
        const opts = await this.build();
        // await 期间可能已经卸载（用户快速切走）⇒ 别再挂载，挂了也没人释放
        if (this.disposed) return;
        this.handle = mountAudioPlayer(this.containerEl, opts);
    }

    onunload(): void {
        this.disposed = true;
        this.handle?.destroy();
        this.handle = null;
    }
}
