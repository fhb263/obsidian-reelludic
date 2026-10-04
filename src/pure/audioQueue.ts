/**
 * 音频播放器：播放模式 / 队列推进 / 乱序（2026-09-27 ④-3）—— **纯逻辑，无 `obsidian` / DOM 依赖**，可单测。
 *
 * ## 为什么单独成模块
 *
 * 这三组规则**每一条都有「看不出来但很烦」的失败形态**：
 *  - **模式搞错**：曲终后该停不停、该续不续（用户以为「卡住了」，重启才好）；
 *  - **洗牌袋搞错**：随机播放隔两首又回到同一首（LyricFlux 的源码注释原文就在防这个）；
 *  - **队列顺序搞错**：切歌回到第一首，但用户是从中间点进来的。
 * 这些都不是「报错」，是**观感**，事后极难从堆栈倒查 ⇒ 一律下沉成可断言的真源。
 *
 * ## 与 LyricFlux 的关系
 *
 * 语义来源 = LyricFlux `src/main.ts` 的 `cyclePlayMode` / `getNextSong` / `getPrevSong` /
 * `handleSongEnded` / `buildShuffleQueue`（其 `PLAY_MODES = ['off','single','sequential','shuffle']`）。
 * 🔴 **三处显式偏差**（各有对应用例，⛔ 别改回原形态）：
 *  ⑴ **随机源注入 `rng`**：LyricFlux 直接调 `Math.random()` ⇒ 洗牌结果无法断言；本模块把随机源做成入参
 *     （缺省仍是 `Math.random`），于是「整轮不重复」「首曲不撞当前曲」这两条能真的钉住。
 *  ⑵ **`off` 模式区分「曲终」与「手动切歌」**：LyricFlux 的 `handleSongEnded('off')` 自然停止，但它的
 *     `getNextSong('off')` 落进 `default` 分支 = 顺序下一首 ⇒ **手动点「下一首」在「不循环」下仍应切歌**
 *     （这是对的，不是 bug）。本模块用 `trigger` 把这两件事**显式分开**，⛔ 不再靠「调用方记得别在
 *     `ended` 时调 `getNextSong`」来保证 —— 那种约定就是下一个人会踩的坑。
 *  ⑶ **洗牌袋随决策返回、⛔ 不改入参**：LyricFlux 把袋子存在实例字段里；本模块保持纯函数（无隐藏状态），
 *     新袋子由调用方保存。**调用方不保存 = 每次重新洗牌 = 隔两首又重复**，故 `bag` 是返回值的一部分。
 *
 * ⚠️ **音量 / 倍速不在本模块**：仓内已有真源 `pure/player.ts`（`clampVolume`（0..1）/ `SPEED_STEPS` /
 *    `formatSpeed` / `formatTime`）⇒ ④-4 直接用，⛔ 别再搬一份 LyricFlux 的 `playbackUtils` ——
 *    两套档位表（它 0.25–2.0 十二档 / 仓内六档）同时存在必然打架。
 * ⚠️ **` ```lrc ` 块与歌词源不在本模块**：那是 ④-2 的 `pure/lrcSource.ts`（§15）。
 */

/** 播放模式（`off` = 不循环：曲终即停，但手动仍可切歌） */
export type AudioPlayMode = 'off' | 'single' | 'sequential' | 'shuffle';

/** 模式循环顺序（**真源**，与 LyricFlux 同序；`cyclePlayMode` 按它走） */
export const AUDIO_PLAY_MODES: readonly AudioPlayMode[] = ['off', 'single', 'sequential', 'shuffle'];

/** 模式显示名（UI 与提示共用；⛔ 别在视图层各写一份，否则改口径必漏） */
export const AUDIO_PLAY_MODE_LABELS: Record<AudioPlayMode, string> = {
    off: '不循环',
    single: '单曲循环',
    sequential: '顺序播放',
    shuffle: '随机播放',
};

/** 随机源（0 ≤ x < 1）；注入 ⇒ 洗牌可断言、可复现 */
export type Rng = () => number;

/** 触发方式：`ended` = 曲终自动推进；`manual` = 用户点「上一首 / 下一首」 */
export type AudioQueueTrigger = 'ended' | 'manual';

/** 切歌方向 */
export type AudioQueueDirection = 'next' | 'prev';

export interface AudioQueueDecision {
    /** 接下来要播的路径；`null` = 没有可播的（`off` 模式曲终 / 空队列 / 随机袋取空） */
    target: string | null;
    /**
     * `target` 与当前曲**是同一首** ⇒ 调用方应「回到 0 秒重播」，⛔ 不要走「换源」路径
     * （换源会重新加载、封面闪一下，观感上像卡了）。
     */
    replay: boolean;
    /** 更新后的洗牌袋（只有 `shuffle` 会变；其它模式原样回传）。**调用方必须存住它。** */
    bag: string[];
}

export interface AudioQueueInput {
    /** 队列（有序路径；由 `normalizeAudioQueue` 产出） */
    paths: readonly string[];
    /** 当前曲路径 */
    current: string;
    mode: AudioPlayMode;
    trigger: AudioQueueTrigger;
    /** 方向（`manual` 才需要，缺省 `next`） */
    direction?: AudioQueueDirection;
    /** 洗牌袋（`shuffle` 必传；⛔ 不传 ⇒ 每次重新洗 ⇒ 「隔两首又重复同一首」） */
    bag?: readonly string[];
    /** 随机源（缺省 `Math.random`） */
    rng?: Rng;
}

/** 任意输入 ⇒ 合法模式（未知 / 脏值一律回落 `off`，⛔ 不抛错：设置文件可能被手改） */
export function normalizeAudioPlayMode(value: unknown): AudioPlayMode {
    const s = String(value ?? '') as AudioPlayMode;
    return AUDIO_PLAY_MODES.includes(s) ? s : 'off';
}

/** 模式循环（点一次「模式」按钮）：走 `AUDIO_PLAY_MODES` 的下一项、末尾回卷 */
export function cycleAudioPlayMode(mode: AudioPlayMode): AudioPlayMode {
    const idx = AUDIO_PLAY_MODES.indexOf(normalizeAudioPlayMode(mode));
    return AUDIO_PLAY_MODES[(idx + 1) % AUDIO_PLAY_MODES.length];
}

/**
 * 队列规范化：去空白 / 去空项 / **保序去重**。
 *
 * 🔴 **⛔ 不按扩展名过滤**：队列来源是「各条目的 `audioPath`」，本来就该是音频；再按
 * `AUDIO_ASSOCIABLE_EXTENSIONS` 筛一遍只会**静默丢曲**（用户有个 `.opus` / `.ape` 就整首不见了，
 * 且没有任何提示）。扩展名白名单的用途是**系统文件选择器的过滤器**（④-2），不是这里。
 */
export function normalizeAudioQueue(paths: readonly string[] | undefined | null): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of paths ?? []) {
        const p = String(raw ?? '').trim();
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
    }
    return out;
}

/** 随机源兜底：非有限值 / 越界一律夹进 `[0, 1)`（否则 `Math.floor(r * n)` 会越界取到 `undefined`） */
function safeRandom(rng: Rng | undefined): number {
    const v = (rng ?? Math.random)();
    if (!Number.isFinite(v)) return 0;
    if (v <= 0) return 0;
    if (v >= 1) return 0.9999999999;
    return v;
}

/**
 * 生成洗牌袋：**整张队列 Fisher-Yates 打乱**。
 *
 * 🔴 两条纪律：
 *  ⑴ 打乱的是**副本**（⛔ 别就地把入参数组打乱 —— 调用方的队列顺序会被改掉，队列列表 UI 跟着乱）；
 *  ⑵ **袋首不得是当前曲**（`exclude`）：否则「点下一首」原地重播当前曲，看起来像按了没反应；
 *     仅在长度 > 1 时挪（单曲队列挪了就没有下一首了）。
 */
export function buildShuffleBag(
    paths: readonly string[],
    exclude: string = '',
    rng?: Rng,
): string[] {
    const out = [...paths];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(safeRandom(rng) * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    if (exclude && out.length > 1 && out[0] === exclude) {
        const [first] = out.splice(0, 1);
        out.push(first);
    }
    return out;
}

/** 顺序模式（`sequential`，也是 `off` 下**手动**切歌的口径）：环形前后步进；当前曲不在队列里时落到队列端点 */
function sequentialTarget(paths: readonly string[], current: string, dir: AudioQueueDirection): string {
    const n = paths.length;
    const idx = paths.indexOf(current);
    if (idx === -1) return dir === 'next' ? paths[0] : paths[n - 1];
    return dir === 'next' ? paths[(idx + 1) % n] : paths[(idx - 1 + n) % n];
}

/**
 * 队列推进的**唯一真源**：给定队列 / 当前曲 / 模式 / 触发方式，算出「接下来播什么」。
 *
 * 模式 × 触发 的完整口径（🟰 与 LyricFlux 一致；⚠️ 偏差见文件头）：
 *
 * | 模式 | 曲终（`ended`） | 手动下一首 | 手动上一首 |
 * |------|-----------------|-----------|-----------|
 * | `off` | **停**（`target: null`） | 顺序下一首 | 顺序上一首 |
 * | `single` | 本曲重播（`replay: true`） | 本曲重播 | 本曲重播 |
 * | `sequential` | 顺序下一首（环形回卷） | 同左 | 顺序上一首 |
 * | `shuffle` | 从洗牌袋取（袋空则重新洗） | 同左 | 随机一首（**不与当前同曲**） |
 *
 * 🔴 队列只有一首时：`sequential` / `shuffle` 的「下一首」就是它自己 ⇒ 返回 `replay: true`
 * （等效单曲循环），⛔ 不要返回 `target: null` —— 那会让「只有一首歌的歌单」曲终就彻底停下。
 */
export function decideTrack(input: AudioQueueInput): AudioQueueDecision {
    const paths = input.paths;
    const bagIn = [...(input.bag ?? [])];

    if (paths.length === 0) return { target: null, replay: false, bag: [] };

    const mode = normalizeAudioPlayMode(input.mode);
    const dir: AudioQueueDirection = input.direction ?? 'next';
    const current = input.current;

    // `off`：曲终自然停止（⛔ 不重播、也不切下一首）；手动切歌仍按顺序走
    if (mode === 'off' && input.trigger === 'ended') {
        return { target: null, replay: false, bag: bagIn };
    }

    if (mode === 'single') {
        const self = paths.includes(current) ? current : paths[0];
        return { target: self, replay: true, bag: bagIn };
    }

    if (mode === 'shuffle') {
        if (dir === 'prev') {
            // 🟰 LyricFlux：上一首取**随机一首且不与当前同曲**（它的 `getPrevSong` 就是这么写的）。
            // ⚠️ 已知不理想（随机播放里「上一首」严格说是「回到刚放过的那首」，需要历史栈）——
            //    但改口径要用户点头，故本批保持对齐，⛔ 不自作主张。
            if (paths.length === 1) return { target: paths[0], replay: true, bag: bagIn };
            const idx = paths.indexOf(current);
            // 🔴 **有界重试 + 回退**：LyricFlux 写的是 `while (rand === idx) rand = …` —— 恒定/退化随机源
            //    （自写脚本、被 mock 的 Math.random）会**死循环**，在插件里等于整个面板卡死。
            //    重试上限用不完就回退「顺序上一首」（长度 > 1 时必然与当前不同曲）。
            let pick = -1;
            for (let i = 0; i < 12 && pick < 0; i++) {
                const cand = Math.floor(safeRandom(input.rng) * paths.length);
                if (cand !== idx) pick = cand;
            }
            if (pick < 0) pick = (idx - 1 + paths.length) % paths.length;
            return { target: paths[pick], replay: paths[pick] === current, bag: bagIn };
        }
        const bag = bagIn.length ? bagIn : buildShuffleBag(paths, current, input.rng);
        const target = bag.shift() ?? null;
        return { target, replay: target === current, bag };
    }

    // sequential（以及 `off` 下的手动切歌）
    const target = sequentialTarget(paths, current, dir);
    return { target, replay: target === current, bag: bagIn };
}

/** 播放器种类（音频播放器 ↔ 视频播放器） */
export type PlayerKind = 'audio' | 'video';

/** 全部播放器种类（**互斥真源**） */
export const PLAYER_KINDS: readonly PlayerKind[] = ['audio', 'video'];

/**
 * 播放器互斥：起播 `starting` 这一路 ⇒ 需要先暂停的**其它路**。
 *
 * 🔴 为什么值得单独一个函数：两侧（`AudioPlayerView` / `VideoPlayerView`）若不共用它，就必然各自
 * 硬编码「另一个是谁」⇒ 将来加第三路（比如独立的 PDF 朗读）时**只在一边改**，表现为「两路同时出声」。
 * 同一时刻只允许一路在响（用户的硬需求：别两首歌叠着放）。
 */
export function playersToPause(starting: PlayerKind): PlayerKind[] {
    return PLAYER_KINDS.filter((k) => k !== starting);
}
