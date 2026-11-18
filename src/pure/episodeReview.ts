// 单集评价（③，用户 2026-11-17）：
// 「播放器详情页（有选集时）在字幕面板上方加单集评价面板：未看/在看/已看（默认未看）
//   +「高光/平庸/槽点」标签（有高光/槽点标签的选集在选集网格上用流光/崩坏特效区分）
//   + 六档可选心情 + 一句话短评；各集数据写入整部单季 md 文件 yaml」
//
// 🔴 为什么单独立一个纯模块而不是塞进 `types.ts`：判据（合法值、归一、空值裁剪、特效归属）
//    要被**四个**调用方共用 —— catalog 白名单（读）、noteGenerator（写 yaml）、
//    播放器面板（改）、选集格子（画特效）。任何一处自己写一份判据，都会分叉成
//    「面板上标了高光、格子上没有流光」这种没法排查的错。
//
// 🔴 存档形状与 `videoPositions` / `subtitlePaths` 完全同构：`Record<集下标字符串, …>`。
//    理由不是「好看」：选集格子的 `index` 就是 `episodeFiles` 的下标，用同一个键空间
//    才能做到「换集即换评价」，也不需要任何排序/压缩逻辑。
//    ⛔ 别改成数组：三个集数组已经因为「压缩空位 vs 保位」踩过「第 2 集的标题跑到第 1 集」的坑。
import { isMoodId, moodText, type MoodId } from './mood';

/** 单集观看状态。⚠️ 与条目级 `MediaStatus`（want/watching/watched/archived）**不是一套**：
 *  单集没有「想看/归档」，默认值是「未看」而不是「想看」。 */
export type EpisodeWatchStatus = 'unwatched' | 'watching' | 'watched';

export const EPISODE_WATCH_STATUSES: readonly EpisodeWatchStatus[] = ['unwatched', 'watching', 'watched'];

/** 状态显示名（唯一真源；面板 chips 与笔记卡都读它） */
export const EPISODE_WATCH_LABELS: Record<EpisodeWatchStatus, string> = {
    unwatched: '未看',
    watching: '在看',
    watched: '已看',
};

/** 单集标签。语义是**这一集的观感档次**，不是情绪（情绪走 `mood`）。 */
export type EpisodeTag = 'highlight' | 'plain' | 'flaw';

export const EPISODE_TAGS: readonly EpisodeTag[] = ['highlight', 'plain', 'flaw'];

export const EPISODE_TAG_LABELS: Record<EpisodeTag, string> = {
    highlight: '高光',
    plain: '平庸',
    flaw: '槽点',
};

/** 选集格子上的特效（用户原话：「有高光/槽点标签的选集在选集网格上用流光/崩坏特效区分」）
 *  · `highlight`（高光）⇒ 流光
 *  · `flaw`（槽点）⇒ 崩坏
 *  · `plain`（平庸）与未打标签 ⇒ `null`，格子保持原样
 *  ⚠️ 同时打了高光与槽点时**只出流光**：两个特效叠在一格里既看不清也说不清哪个优先，
 *     而「有亮点」比「有槽点」更值得被一眼看到（排序判据写在下面 `episodeCellEffect` 里）。 */
export type EpisodeCellEffect = 'highlight' | 'flaw';

export interface EpisodeReview {
    /** 观看状态；缺省语义 = 未看 */
    status: EpisodeWatchStatus;
    /** 标签（可多选，最多 `EPISODE_TAGS.length` 个） */
    tags?: EpisodeTag[];
    /** 六档心情（与条目级 `mood` 同一个值域、同一份 `MOODS` 表，⛔ 不另造一套） */
    mood?: MoodId;
    /** 一句话短评（纯文本，落 yaml 时转义） */
    note?: string;
}

/** 一份「没填任何东西」的评价 —— 默认值为未看，且各可选字段缺省 */
export const EMPTY_EPISODE_REVIEW: EpisodeReview = { status: 'unwatched' };

/** 是不是空评价（未看 + 无标签 + 无心情 + 无短评）⇒ 落库时应整条丢弃，不在 yaml 里占位 */
export function isEmptyEpisodeReview(r: EpisodeReview | undefined): boolean {
    if (!r) return true;
    if (r.status !== 'unwatched') return false;
    if (r.tags && r.tags.length > 0) return false;
    if (r.mood) return false;
    if (r.note && r.note.trim()) return false;
    return true;
}

/**
 * 归一化一条评价（读侧用；非法值一律降级而不是抛）。
 *
 * 🔴 降级而不是丢弃：用户手改 yaml 写了 `status: 看完` 这类值时，
 *    整条评价消失比「状态回落成未看、但高光标签还在」更难排查 —— 至少后半截还在。
 */
export function normalizeEpisodeReview(raw: unknown): EpisodeReview | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;

    const status = typeof o.status === 'string' && (EPISODE_WATCH_STATUSES as readonly string[]).includes(o.status)
        ? (o.status as EpisodeWatchStatus)
        : 'unwatched';

    const tags: EpisodeTag[] = [];
    if (Array.isArray(o.tags)) {
        for (const t of o.tags) {
            // 去重保序：同一标签写两遍没有意义，但顺序是用户点出来的，不动
            if (typeof t === 'string' && (EPISODE_TAGS as readonly string[]).includes(t) && !tags.includes(t as EpisodeTag)) {
                tags.push(t as EpisodeTag);
            }
        }
    }

    const mood = typeof o.mood === 'string' && isMoodId(o.mood) ? o.mood : undefined;
    const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined;

    const out: EpisodeReview = { status };
    if (tags.length) out.tags = tags;
    if (mood) out.mood = mood;
    if (note) out.note = note;
    return isEmptyEpisodeReview(out) ? undefined : out;
}

/**
 * 归一化整张按集映射（`normalizeEntry` 白名单用）。
 * 判据：键必须是集下标数字串（与 `videoPositions` 同口径）、值归一后非空。
 * ⚠️ 空表返回 `undefined` 而不是 `{}`：空对象会让「有没有评价」这道判断永远为真。
 */
export function normalizeEpisodeReviews(raw: unknown): Record<string, EpisodeReview> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, EpisodeReview> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!/^\d+$/.test(k)) continue;
        const r = normalizeEpisodeReview(v);
        if (r) out[k] = r;
    }
    return Object.keys(out).length ? out : undefined;
}

/** 读某一集的评价（没有 ⇒ `undefined`，调用方自己决定要不要当未看） */
export function reviewAt(
    reviews: Record<string, EpisodeReview> | undefined,
    index: number,
): EpisodeReview | undefined {
    if (!reviews || !Number.isFinite(index) || index < 0) return undefined;
    const r = reviews[String(Math.floor(index))];
    return r ? r : undefined;
}

/**
 * 写某一集的评价（返回**新对象**，不改入参 —— catalog 侧走 `service.update`，原地改会绕过脏检查）。
 * 归一后为空 ⇒ 删掉这个键并返回 `undefined`（整表空了就不落库）。
 */
export function setReviewAt(
    reviews: Record<string, EpisodeReview> | undefined,
    index: number,
    next: EpisodeReview,
): Record<string, EpisodeReview> | undefined {
    if (!Number.isFinite(index) || index < 0) return reviews;
    const key = String(Math.floor(index));
    const merged: Record<string, EpisodeReview> = { ...(reviews ?? {}) };
    const norm = normalizeEpisodeReview(next);
    if (norm) merged[key] = norm;
    else delete merged[key];
    return Object.keys(merged).length ? merged : undefined;
}

/**
 * 这一格该出什么特效。
 * 判据顺序（**高光优先**）写在 `EpisodeCellEffect` 的注释里，这里只实现：
 * 有 `highlight` ⇒ 流光；否则有 `flaw` ⇒ 崩坏；其余 ⇒ `null`。
 */
export function episodeCellEffect(review: EpisodeReview | undefined): EpisodeCellEffect | null {
    if (!review?.tags?.length) return null;
    if (review.tags.includes('highlight')) return 'highlight';
    if (review.tags.includes('flaw')) return 'flaw';
    return null;
}

/**
 * 有评价的集数（用于面板标题「已评 3 / 12」）。
 * ⚠️ 只数**非空**评价：`normalizeEpisodeReviews` 已经滤过空值，但调用方可能传进来手搓的对象。
 */
export function reviewedCount(reviews: Record<string, EpisodeReview> | undefined): number {
    if (!reviews) return 0;
    let n = 0;
    for (const r of Object.values(reviews)) if (!isEmptyEpisodeReview(r)) n++;
    return n;
}

/** 标签的中文名（面板与格子 tooltip 共用；非法值回落空串而不是抛） */
export function episodeTagLabel(tag: string): string {
    return (EPISODE_TAG_LABELS as Record<string, string>)[tag] ?? '';
}/** 状态的中文名（同上） */
export function episodeStatusLabel(status: string): string {
    return (EPISODE_WATCH_LABELS as Record<string, string>)[status] ?? '';
}

// ───────────────────────────── 笔记 YAML 序列化（③ 的写侧唯一真源） ─────────────────────────────

/** 笔记 frontmatter 里承载单集评价的键名（⛔ 与 `metaFields` 的 `episode_reviews` 必须一致） */
export const EPISODE_REVIEWS_FM_KEY = 'episode_reviews';

/**
 * 把整张按集评价序列化成**一行** YAML 流式映射（= JSON 对象字面量，两者语法恰好重叠）。
 *
 * 为什么是一行而不是嵌套块：
 *  · `pure/noteEditable.extractFrontmatterFromNote` 是**逐行**解析（`split('\n')` + 首个冒号切键值），
 *    嵌套块里 `  0:` 这种子行会被当成顶层键、而父键 `episode_reviews:` 的值是空串 ⇒ 读不回来。
 *  · 一行 JSON 同时满足两件事：YAML 解析器（Obsidian / Dataview）按 flow mapping 读成对象；
 *    本插件的逐行解析器把它整串交给 `JSON.parse`。
 * ⚠️ `JSON.stringify` 会把短评里的引号/换行转义掉，不会破坏 YAML 结构（这也是不用手拼的原因）。
 * ⚠️ 空表返回 `''`（调用方据此**不写这一行**，与 `mood` 同口径：不给存量笔记塞空属性）。
 */
export function serializeEpisodeReviews(reviews: Record<string, EpisodeReview> | undefined): string {
    const norm = normalizeEpisodeReviews(reviews);
    if (!norm) return '';
    return JSON.stringify(norm);
}

/**
 * 从笔记里读回单集评价（`extractFrontmatterFromNote` 的 handler 用）。
 * 容忍三种历史形态：JSON 流式 / 空串 / 手写坏值（一律归一，坏值丢弃不抛）。
 */
export function parseEpisodeReviews(raw: string | undefined): Record<string, EpisodeReview> | undefined {
    const text = (raw ?? '').trim();
    if (!text) return undefined;
    try {
        return normalizeEpisodeReviews(JSON.parse(text));
    } catch {
        // 手改成非 JSON（例如写成 `0: watched`）⇒ 当作没有评价，⛔ 不要抛崩整个笔记导入
        return undefined;
    }
}

// ───────────────────────────── 笔记条目卡的展示投影（③ 的读侧唯一真源） ─────────────────────────────

/**
 * 笔记条目卡上「某一集评价」的一行展示值。
 *
 * 🔴 为什么在纯层做投影、而不是让渲染层自己拼：
 *    条目卡（`views/noteCardMount`）与播放器面板（`views/EpisodePageView`）是两套渲染，
 *    但用户看到的中文名/emoji/标签顺序**必须一模一样** —— 否则「面板上写 🤩 震撼、
 *    卡片上写 wow」这种错会一直没人发现。判据全部收口在这里，两边只负责画。
 */
export interface EpisodeReviewLine {
    /** 集下标（0 基，与 `episodeFiles` 同口径） */
    index: number;
    /** 卡片上显示的集号（1 基，人类读的那个数） */
    label: string;
    /** 状态中文名（未看/在看/已看） */
    status: string;
    /** 标签中文名，`、` 连接；没打标签 ⇒ 空串（渲染层据此不画这一格） */
    tags: string;
    /** 心情展示串（`🤩 震撼`）；没选 ⇒ 空串 */
    mood: string;
    /** 一句话短评（已 trim）；没写 ⇒ 空串 */
    note: string;
}

/**
 * 把按集评价摊平成「有内容的那几集」的展示行（按集号升序）。
 *
 * 判据三条，与面板同一份：
 *  ⑴ **只出有内容的集**：`isEmptyEpisodeReview` 为真的（未看 + 无标签 + 无心情 + 无短评）不出现。
 *     理由：一季 40 集里用户可能只评了 3 集，把 40 行「未看 — —」铺在笔记卡上就是噪音。
 *  ⑵ 集号按**数值**升序，⛔ 不按字符串 —— `'10' < '9'` 会让第 10 集跑到第 9 集前面。
 *  ⑶ `limit` 只截展示条数，不影响 `total`（卡片上要能说清「还有 N 集没显示」）。
 */
export function episodeReviewLines(
    reviews: Record<string, EpisodeReview> | undefined,
    limit = Number.POSITIVE_INFINITY,
): { lines: EpisodeReviewLine[]; total: number } {
    const entries = Object.entries(reviews ?? {})
        .map(([k, v]) => ({ index: Number(k), review: v }))
        .filter((x) => Number.isFinite(x.index) && !isEmptyEpisodeReview(x.review))
        .sort((a, b) => a.index - b.index);
    const lines = entries.slice(0, Math.max(0, limit)).map(({ index, review }) => ({
        index,
        label: `第 ${index + 1} 集`,
        status: episodeStatusLabel(review.status),
        tags: (review.tags ?? []).map((t) => episodeTagLabel(t)).filter((s) => !!s).join('、'),
        mood: review.mood ? moodText(review.mood) : '',
        note: (review.note ?? '').trim(),
    }));
    return { lines, total: entries.length };
}
