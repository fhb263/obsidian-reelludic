// 搜索进度上报器（纯逻辑，可单测）：多源搜索（TMDB/Bangumi 与豆瓣并行 + 豆瓣详情补全）的
// 步骤化进度 + 线性外推预计耗时。步骤总数在豆瓣搜索返回后才确定（详情数 = min(3, 结果数)），
// 故用 addRemaining 动态补齐 total。
// v2（分源状态）：source 可选字段——携带时表示「某数据源本次搜索已完成」，供 UI 做逐源真实进度
//（快源先亮「已返回 N 条」，未完成源「搜索中…」，失败/超时给明确文案），与 label 单步进度互补。

/** 单源结束状态（source 事件） */
export type SourceDoneState = 'ok' | 'empty' | 'failed' | 'timeout' | 'blocked';

/** 源粒度进度事件（UI 逐源渲染用；label 进度与之并存） */
export interface SourceDoneEvent {
    /** 数据源 id（douban / tmdb / …） */
    id: string;
    state: SourceDoneState;
    /** ok/empty 时的条数（失败/超时 undefined） */
    count?: number;
    /**
     * 🔴 2026-11-12（m00353 ①-12）：该源本次拿到的**条目**。
     *
     * 为什么事件要带条目而不只带条数：用户的原话是「多源搜索其中一源超时不返回时，
     *   要显示骨架屏展示另一个已返回的源（否则等待太长）」——
     *   只要「已返回的源」不能立刻出卡片，界面就仍是「一起出」，
     *   一源卡住 5s 用户就干等 5s。所以「已返回」这件事必须带着内容走。
     *
     * 为什么留在纯函数层而不另开回调：另开回调就意味着 UI 要同时订阅两条事件流，
     *   还得自己维护「哪条先到、是否同一轮」的顺序问题；同一条事件带 `items` 则天然有序。
     *
     * 类型是 `readonly unknown[]` 而不是 `SearchResult[]`：本模块是纯逻辑层，
     *   ⛔ 不 import 任何视图/业务类型（否则 pure → views 反向依赖）。消费端自行断言。
     */
    items?: readonly unknown[];
}

export interface SearchProgress {
    /** 已完成步骤数 */
    done: number;
    /** 总步骤数（0 = 尚未确定，UI 显示不确定进度） */
    total: number;
    /** 当前步骤描述（如「Douban 搜索」） */
    label: string;
    /** 预计剩余秒数（线性外推，无剩余/未确定时为 0/undefined） */
    etaSec?: number;
    /** 可选：某源完成事件（本次事件涉及的源已出结果） */
    source?: SourceDoneEvent;
}

export type SearchProgressCb = (p: SearchProgress) => void;

export interface SearchProgressReporter {
    /** 完成一步并上报（label 为当前步骤描述） */
    next: (label: string) => void;
    /** 动态设定总步数：total = 已完成 + remaining（豆瓣详情步数搜索后才知道） */
    addRemaining: (remaining: number) => void;
    /** 某源搜索结束（成功/无匹配/失败/超时）：额外上报 source 事件，UI 可逐源更新状态 */
    source: (ev: SourceDoneEvent) => void;
}

export function createSearchProgress(onProgress: SearchProgressCb | undefined): SearchProgressReporter {
    const start = Date.now();
    let total = 0;
    let done = 0;
    const base = (extra?: Partial<SearchProgress>): void => {
        if (!onProgress) return;
        const elapsed = (Date.now() - start) / 1000;
        const remaining = total > done ? total - done : 0;
        // 有剩余 → 外推秒数；已全部完成 → 0；total 未确定 → undefined（UI 不显示 ETA）
        const etaSec = remaining > 0 && done > 0
            ? Math.max(1, Math.round((elapsed / done) * remaining))
            : total > 0
                ? 0
                : undefined;
        onProgress({ done, total, label, etaSec, ...extra });
    };
    let label = '';
    return {
        addRemaining(remaining: number) {
            total = done + remaining;
        },
        next(l: string) {
            done++;
            label = l;
            base();
        },
        source(ev: SourceDoneEvent) {
            // 保持当前步骤进度帧，仅追加 source 字段（不推进 done，避免与 step 计数混淆）
            base({ source: ev });
        },
    };
}
