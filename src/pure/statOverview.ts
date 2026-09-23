// 统计页「三层重构」的概览纯逻辑（无 obsidian 依赖，可单测）——2026-09-22 #371
//   口径：分类 = 书 / 影 / 游 / 音（影视 = movie + tv + anime 合并，与概览 Tab 一致）
//   同比 / 环比：给「裸数字」配对照（金标准：没有对照的数字没有判断价值）
//   颜色：只从类型色真源 TYPE_COLORS 取值，⛔ 本模块不新造色、也不硬编码色值
import type { MediaEntry } from 'data/types';
import { TYPE_COLORS } from 'data/types';
import { durationStats, finishedInYear, monthlyFinished, topRatedInYear } from 'pure/stats';

/** 概览分类（书 / 影 / 游 / 音） */
export type OverviewCategory = 'book' | 'media' | 'game' | 'music';

/** Tab 顺序（固定：书影游音） */
export const CATEGORY_KEYS: OverviewCategory[] = ['book', 'media', 'game', 'music'];

export const CATEGORY_LABELS: Record<OverviewCategory, string> = {
    book: '书籍',
    media: '影视',
    game: '游戏',
    music: '音乐',
};

/** 分类色 = 类型色真源（影视取 movie 蓝）。改类型色 → 图表/Tab 一起变，⛔ 别在组件里另写色值 */
export const CATEGORY_COLORS: Record<OverviewCategory, string> = {
    book: TYPE_COLORS.book,
    media: TYPE_COLORS.movie,
    game: TYPE_COLORS.game,
    music: TYPE_COLORS.music,
};

/** 条目归属哪个概览分类；未知类型返回 null（不猜、不落到某一类） */
export function categoryOf(e: MediaEntry): OverviewCategory | null {
    const t = e.type;
    if (t === 'book') return 'book';
    if (t === 'movie' || t === 'tv' || t === 'anime') return 'media';
    if (t === 'game') return 'game';
    if (t === 'music') return 'music';
    return null;
}

/** 同比 / 环比结果：`hasBaseline=false` ⇒ 视图**不画箭头**（去年/上月为 0 时 +N 是误导） */
export interface Comparison {
    current: number;
    previous: number;
    delta: number;
    hasBaseline: boolean;
}

/** 年度同比：今年完成数 vs 去年完成数（watchedDate 年份口径） */
export function yearOverYear(entries: MediaEntry[], year: number): Comparison {
    const list = Array.isArray(entries) ? entries : [];
    const current = list.filter((e) => finishedInYear(e, year)).length;
    const previous = list.filter((e) => finishedInYear(e, year - 1)).length;
    return { current, previous, delta: current - previous, hasBaseline: previous > 0 };
}

/** 月度环比：本月 vs 上月（1 月的上月 = 去年 12 月，跨年不断档） */
export function monthOverMonth(entries: MediaEntry[], year: number, month: number): Comparison {
    const list = Array.isArray(entries) ? entries : [];
    const m = Math.min(12, Math.max(1, Math.round(Number(month) || 1)));
    const current = monthlyFinished(list, year)[m - 1] ?? 0;
    const previous = m > 1 ? monthlyFinished(list, year)[m - 2] ?? 0 : monthlyFinished(list, year - 1)[11] ?? 0;
    return { current, previous, delta: current - previous, hasBaseline: previous > 0 };
}

/** 趋势序列（图表一条线 = 一个分类） */
export interface TrendSeries {
    key: OverviewCategory;
    label: string;
    /** 1-12 月计数 */
    arr: number[];
    /** 本年是否有数据（false ⇒ 图例里不出现，避免零值贴底线） */
    on: boolean;
}

export function trendSeriesOf(entries: MediaEntry[], year: number): TrendSeries[] {
    const list = Array.isArray(entries) ? entries : [];
    return CATEGORY_KEYS.map((k) => {
        const arr = monthlyFinished(list.filter((e) => categoryOf(e) === k), year);
        return { key: k, label: CATEGORY_LABELS[k], arr, on: arr.some((v) => v > 0) };
    });
}

/** 可见序列：**空选 = 这一维不存在**（全部显示）——与题材筛选同一口径 */
export function visibleTrendSeries(series: TrendSeries[], selected: readonly OverviewCategory[]): TrendSeries[] {
    const sel = Array.isArray(selected) ? selected : [];
    return (Array.isArray(series) ? series : []).filter((s) => s.on && (sel.length === 0 || sel.includes(s.key)));
}

/** Y 轴极值：只按**可见**序列算（筛选后坐标轴跟着变）；兜底 1 防除零 */
export function trendMaxOf(series: TrendSeries[], selected: readonly OverviewCategory[]): number {
    const vals = visibleTrendSeries(series, selected).flatMap((s) => s.arr);
    return Math.max(1, ...vals);
}

/** 概览 Tab 内的一个指标；`kind='hours'` 由视图格式化（分钟 → 小时） */
export interface OverviewMetric {
    label: string;
    value: number;
    kind: 'num' | 'hours';
}

export interface CategoryOverview {
    key: OverviewCategory;
    label: string;
    /** 本年完成数（读完 / 看完 / 通关 / 已听） */
    finished: number;
    metrics: OverviewMetric[];
    /** 影视专属：子类型计数行；其余分类为 '' */
    subText: string;
    /** 本年完成且有评分的前 3（Top3） */
    top: MediaEntry[];
    /** 该分类是否有条目（决定空态文案） */
    hasAny: boolean;
    /** 本年是否有完成（决定 Top3 空态文案） */
    hasFinished: boolean;
}

/** 分类概览：Tab 内容（指标 + 子类型行 + Top3 + 两个空态标记） */
export function categoryOverview(
    entries: MediaEntry[],
    year: number,
    excerptCounts: Record<string, number>,
    cat: OverviewCategory,
): CategoryOverview {
    const list = (Array.isArray(entries) ? entries : []).filter((e) => categoryOf(e) === cat);
    const finished = list.filter((e) => finishedInYear(e, year)).length;
    const watching = list.filter((e) => e.status === 'watching').length;
    const dur = durationStats(list);
    const exc = excerptCounts && typeof excerptCounts === 'object' ? excerptCounts : {};

    let metrics: OverviewMetric[] = [];
    let subText = '';
    if (cat === 'book') {
        metrics = [
            { label: '读完', value: finished, kind: 'num' },
            { label: '在读', value: watching, kind: 'num' },
            { label: '已读页', value: dur.bookPages, kind: 'num' },
            { label: '摘抄', value: list.reduce((s, e) => s + (exc[e.id] ?? 0), 0), kind: 'num' },
        ];
    } else if (cat === 'media') {
        const movie = list.filter((e) => e.type === 'movie').length;
        const tv = list.filter((e) => e.type === 'tv').length;
        const anime = list.filter((e) => e.type === 'anime').length;
        subText = `电影 ${movie} · 剧集 ${tv} · 动画 ${anime}`;
        metrics = [
            { label: '看完', value: finished, kind: 'num' },
            { label: '在追', value: watching, kind: 'num' },
            { label: '观影', value: dur.movieMinutes, kind: 'hours' },
            { label: '追剧集', value: dur.episodes, kind: 'num' },
        ];
    } else if (cat === 'game') {
        metrics = [
            { label: '通关', value: finished, kind: 'num' },
            { label: '玩过', value: list.filter((e) => (e.playSessions?.length ?? 0) > 0).length, kind: 'num' },
            { label: '游玩', value: dur.playMinutes, kind: 'hours' },
            { label: '记录', value: dur.playSessions, kind: 'num' },
        ];
    } else if (cat === 'music') {
        // 音乐时长：durationMin 求和，无值回退曲目数（沿用统计页原口径）
        const minutes = list.reduce((s, e) => s + (e.durationMin ?? 0), 0) || list.length;
        metrics = [
            { label: '已听', value: finished, kind: 'num' },
            { label: '在听', value: watching, kind: 'num' },
            { label: '曲目', value: list.length, kind: 'num' },
            { label: '时长', value: minutes, kind: 'hours' },
        ];
    }

    return {
        key: cat,
        label: CATEGORY_LABELS[cat] ?? '',
        finished,
        metrics,
        subText,
        top: topRatedInYear(list, year, 3),
        hasAny: list.length > 0,
        hasFinished: finished > 0,
    };
}
