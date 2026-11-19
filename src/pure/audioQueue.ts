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

/**
 * 乱序的**权重表**：`路径 → 权重`（>0 的有限数；缺键 / 0 / 负数 / 非有限 ⇒ 用 {@link DEFAULT_SHUFFLE_WEIGHT}）。
 *
 * 🔴 m14228 ③（用户逐字：「给音乐乱序播放再加个如10星个人评分遇到的循环越高反之1星评分的音乐
 *    权重要大大降低」）。用户选了「用现有 1~5 星个人评分当权重」这一档 ⇒ 本模块**只认权重**、
 *    不认识星级 —— 星级 → 权重的换算在 {@link shuffleWeightOfRating}，⛔ 别把 `MediaEntry.rating`
 *    搬进这里（`audioQueue` 是纯队列逻辑，不认识条目模型）。
 */
export type ShuffleWeights = Readonly<Record<string, number>>;

/** 没有权重信息时每一首的权重（= 等概率，行为与加权前逐字一致） */
export const DEFAULT_SHUFFLE_WEIGHT = 1;

/**
 * 个人评分（1~5 星）→ 乱序权重。**越高星越常出现、1 星大幅降低**。
 *
 * 🔴 实测曲线（`(r/3)^2.2` 保留两位小数，见 `tests/audioQueueWeight.test.ts` 逐档钉住）：
 *    `1★ → 0.09`、`2★ → 0.41`、`3★ → 1.00`、`4★ → 1.88`、`5★ → 3.08`；未评分 → `1.00`。
 *    ⇒ **3★ 恰为中性、与未评分等价**（「三星 = 没什么意见」是用户能直接理解的语义），
 *      5★ 是 3★ 的 3 倍、是 1★ 的 **34 倍**。
 *
 * 五条口径（都有对应用例）：
 *  ⑴ **未评分 = 中性 1.0**，⛔ 不给 0 —— 用户没表态的歌不该被变相惩罚（新歌全是未评分，
 *     给 0 等于「导入的新歌永远排最后」）；
 *  ⑵ **1★ 不是 0 而是 0.09**，⛔ **不做硬排除** —— 用户说的是「权重要大大降低」，
 *     真排除是另一个需求（真排除了就再也听不到，用户改不回耳朵）；
 *  ⑶ **越界值夹进 `[1, 5]`**：`0` / 负数 / 非整数脏值一律当未评分（`rating` 红线是 1~5，
 *     但 data.json 可手改，⛔ 别让一个 99 把整轮洗牌压死）；
 *  ⑷ 单调递增且**严格**（相邻档必有差），单测逐档钉住；
 *  ⑸ 纯函数、无 `obsidian` 依赖。
 */
export function shuffleWeightOfRating(rating: number | undefined | null): number {
    if (typeof rating !== 'number' || !Number.isFinite(rating)) return DEFAULT_SHUFFLE_WEIGHT;
    const r = Math.round(rating);
    if (r < 1 || r > 5) return DEFAULT_SHUFFLE_WEIGHT;
    // 以 3★ 为中轴（= 1.0，与未评分等价），5★ ≈ 3.08、1★ ≈ 0.09 —— 指数 2.2 让「1 星 ≪ 5 星」
    // 的差距足够大（34 倍），又不至于像线性那样 1★ 还剩 0.2（用户要的是「大大降低」）。
    return Math.round(Math.pow(r / 3, 2.2) * 100) / 100;
}

/** 取某路径的权重（缺键 / 脏值 ⇒ {@link DEFAULT_SHUFFLE_WEIGHT}） */
function weightOf(map: ShuffleWeights | undefined, path: string): number {
    const v = map?.[path];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_SHUFFLE_WEIGHT;
}

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
    /**
     * 🔴 m14228 ③：乱序的权重表（`路径 → 权重`，见 {@link ShuffleWeights}）。
     * 缺省 / 空对象 ⇒ 等概率（行为与加权前逐字一致）。
     * ⚠️ **只影响「新洗一轮」时的抽取顺序** —— 已有袋子不会因为权重变化而重排
     * （否则用户改一次评分，正在放的那一轮会突然洗牌，观感像「跳歌」）。
     */
    weights?: ShuffleWeights;
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
 * 生成洗牌袋：**把当前曲排除后，其余各首 Fisher-Yates 打乱**。
 *
 * 🔴 三条纪律：
 *  ⑴ 打乱的是**副本**（⛔ 别就地把入参数组打乱 —— 调用方的队列顺序会被改掉，队列列表 UI 跟着乱）；
 *  ⑵ **当前曲不进袋**（`exclude`）—— 这是 m11034 的核心修正，理由见下；
 *  ⑶ 单曲队列（排除后为空）⇒ 返回空袋，`decideTrack` 会走 `replay: true`（等效单曲循环）。
 *
 * ## 🔴🔴 为什么当前曲必须**整个剔除**，而不是「洗进袋子再挪到袋尾」
 *
 * m08028 之后的实现是「全队列洗牌 + 若袋首是当前曲就挪到袋尾」。用户 m11034 报的就是它：
 * 「为什么 10 首内播放就排到之前播放过的音乐」—— 实测（20 个随机种子，`tests/audioQueue.test.ts`
 * 的「一轮内不重复」用例就是那次实测的固化）**最早在第 2 步就撞回刚听过的那首**。
 *
 * 根因是「一轮」的定义错了：全队列洗牌时，当前曲**已经在播**，却又在袋里排了一次 ⇒ 10 首歌的袋子
 * 实际只提供 9 首「新歌」，第 10 次抽取必然取回当前曲；而「挪袋尾」只防了**紧邻**重复，
 * 不防「隔一首、隔两句」的重复 —— 那正是用户说的「10 首内就排到之前播放过的」。
 *
 * 正确语义：**一轮 = 除当前曲外每首恰好一次**。袋子取空（一轮放完）时重新洗，重洗时同样剔除
 * 「此刻正在播的那首」⇒ 相邻两轮的交界处也不会紧邻重复。代价是每轮少一首（N 首队列一轮 N-1 首），
 * 换来的是「N 首之内绝不重样」这个用户能直接感知到的性质。
 *
 * ## 🔴 m14228 ③：加权洗牌（`weights`）为什么不会破坏「一轮内不重复」
 *
 * 用户要的是「5 星常出现、1 星大幅降低」。实现上**⛔ 不能改成「每首歌独立按权重掷骰」**——
 * 那样就回到了 m11034 修掉的病灶（同一首隔两首又回来），而且「一轮」这个概念直接消失。
 *
 * 正确做法（本函数）：**集合仍然是「除当前曲外每首恰好一次」，权重只决定抽取顺序** ——
 * 每步按权重**无放回**抽一首（Efraimidis-Spirakis：键 = `rng^(1/w)`，降序排）。
 * 权重 w 越大 ⇒ 键越容易排在前面；但每首**必然被抽到且只抽到一次** ⇒
 * 「一轮内不重复」这条性质逐字保留，加权只改变「谁先谁后」。
 *
 * 为什么用 `rng^(1/w)` 而不是「重复加权抽样 + 去重」：后者要循环 N 次且每次都扫全池
 * （O(N²)，还引入「抽到已选就重抽」的退化风险）；前者一次排序 O(N log N)，且
 * `w` 全相等时**退化为均匀随机排列**（与老 Fisher-Yates 同分布，行为逐字等价）。
 */
export function buildShuffleBag(
    paths: readonly string[],
    exclude: string = '',
    rng?: Rng,
    weights?: ShuffleWeights,
): string[] {
    // 剔除当前曲（⛔ 不是打乱后再挪位）：先把 pool 建好，再对它做加权排序。
    const pool = exclude ? paths.filter((p) => p !== exclude) : [...paths];
    // 无权重表 ⇒ 走原来的 Fisher-Yates（⛔ 别让老路径也过一遍指数运算，行为要和改动前逐字一致）
    if (!weights) {
        const out = pool;
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(safeRandom(rng) * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }
    // Efraimidis-Spirakis 加权无放回抽样：键 `rng^(1/w)` 降序。
    // ⚠️ `rng` 可能是 0 ⇒ `0 ** (1/w)` = 0，键最小但不是 -Infinity，排序仍稳定安全。
    const keyed = pool.map((p) => {
        const w = weightOf(weights, p);
        const r = safeRandom(rng);
        // `Math.pow(0, x)` = 0；`Math.pow(r, 1/w)` 在 w 极大时趋近 1 —— 都在 (0,1] 内，无 NaN。
        const key = Math.pow(r, 1 / w);
        return { p, key };
    });
    // 降序；键相等时用路径字典序兜底，保证**同种子必然同结果**（否则 V8 排序在等键上不可复现）
    keyed.sort((a, b) => (b.key === a.key ? (a.p < b.p ? -1 : a.p > b.p ? 1 : 0) : b.key - a.key));
    return keyed.map((x) => x.p);
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
        const bag = bagIn.length ? bagIn : buildShuffleBag(paths, current, input.rng, input.weights);
        // 🔴 m11034：袋可能为空 —— 队列只有一首时，`buildShuffleBag` 把当前曲排除后什么都不剩。
        //    此时必须回 `replay: true`（等效单曲循环），⛔ 不能回 `target: null` 让单曲歌单戛然而止。
        if (!bag.length) return { target: current || paths[0], replay: true, bag };
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
