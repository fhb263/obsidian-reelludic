// 音乐收听时长**自动累计**的判据（纯逻辑：不碰 DOM、不碰磁盘、可单测）。
//
// 🔴 用户 m02288 原话：「用音乐播放器播放每首音乐要统计总时长列在卡片网格封面左上角上统一，
//    而不是让用户手动记录」。
//
// 三条硬口径（都写进单测）：
//  ⑴ **累计的是「真实播放过的秒数」，⛔ 不是 `currentTime` 差值**：
//     拖动进度条 / 反复 seek 会让 `currentTime` 跳变，用差值累计等于「拖一下就听了十分钟」。
//     本模块只吃「这一段真的在播」的时长（由装配层用 `play`/`pause`/`ended` 事件切段后喂进来）。
//  ⑵ **落库字段是 `listenMinutes`（分钟整数），⛔ 不是 `durationMin`**：
//     `durationMin` 是**片长**（影视用），`listenMinutes` 才是收听时长（见 `pure/musicSync` 文件头 ⑵、
//     `data/catalog` 的 `Math.round` 白名单）。两个字段语义不同，⛔ 永远不互相赋值。
//  ⑶ **不足 1 分钟不落库**：`listenMinutes` 是整数分钟，播了 5 秒就 +1 分钟等于每次点开都白送一分钟。
//     零头留在内存里累到下一次（见 `ListenAccumulator`），关播放器就丢 —— 丢的是**零头**，不是已落库的分钟。
//
// ⚠️ 本模块没有 obsidian、没有 DOM、没有 Svelte（本仓「纯逻辑下沉」红线）。

/** 一秒 = 1000 毫秒（常量只为一处可调，⛔ 别在调用点散写整数） */
export const LISTEN_MS_PER_SECOND = 1000;

/** 满多少秒换 1 分钟（`listenMinutes` 是分钟整数） */
export const LISTEN_SECONDS_PER_MINUTE = 60;

/**
 * 一段真实播放（`play` → `pause`/`ended`/切歌）的毫秒数要不要计入。
 *
 * 🔴 阈值 1 秒的两条理由：
 *   · 低于 1 秒的「播放」多半是**手滑起播立刻暂停**（或键盘误触空格），计进去等于噪音；
 *   · 每一段都发一次 `addTimeSession`（会重写笔记）代价太高 —— 用累计器攒够整分钟才落库，
 *     这里只是把「明显不是收听」的碎片挡在外面。
 */
export const LISTEN_MIN_SEGMENT_MS = 1000;

/** 这一段播放是否够格计入（thousand-millisecond 判据，见 `LISTEN_MIN_SEGMENT_MS`） */
export function isCountableSegment(ms: number): boolean {
    return Number.isFinite(ms) && ms >= LISTEN_MIN_SEGMENT_MS;
}

/** 毫秒 → 整分钟（向下取整：零头留在累计器里，⛔ 不四舍五入 —— 那会凭空多算半分钟） */
export function msToWholeMinutes(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return 0;
    return Math.floor(ms / (LISTEN_MS_PER_SECOND * LISTEN_SECONDS_PER_MINUTE));
}

/**
 * 收听时长**累计器**：把一段段播放毫秒攒成「够 1 分钟就取走」的整数分钟。
 *
 * 为什么要有它（而不是每段直接调 `addTimeSession`）：
 *   · `addTimeSession` 会 `save + writeNote`（重写整份笔记）—— 每听 1 秒写一次盘是不可接受的；
 *   · 零头必须跨段保留，否则「每段都不到 1 分钟」的长听（拖来拖去）永远累计不到 1 分钟。
 *
 * ⚠️ 它**只管算账、不管落库**：调用方拿到 `addSegment()` 的返回值后自己去调服务层。
 */
export class ListenAccumulator {
    /** 已攒、尚未取走的毫秒（跨段保留的零头） */
    private pendingMs = 0;

    /** 记一段真实播放；返回「这一段让它攒够了多少整分钟」（可能是 0） */
    addSegment(ms: number): number {
        if (!isCountableSegment(ms)) return 0;
        this.pendingMs += ms;
        const minutes = msToWholeMinutes(this.pendingMs);
        if (minutes <= 0) return 0;
        // 只扣掉「换成了分钟的那部分」，零头继续留着（⛔ 别清零 —— 那会把 1 分 30 秒吞成 1 分钟）
        this.pendingMs -= minutes * LISTEN_SECONDS_PER_MINUTE * LISTEN_MS_PER_SECOND;
        return minutes;
    }

    /** 当前攒着、还没换成分钟的毫秒（测试 / 排查用；⛔ 别拿它直接落库） */
    pending(): number {
        return this.pendingMs;
    }

    /** 清零（换条目 / 销毁时调用） */
    reset(): void {
        this.pendingMs = 0;
    }
}
