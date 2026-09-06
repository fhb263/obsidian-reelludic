// 卡片元信息文本（pure/cardMeta）
// 海报墙 grid 卡片同列依赖 subtitle / creator 两行高度一致，
// 数据缺失时返回「—」占位以保持行占位，杜绝同列卡片错位。
import type { MediaEntry } from 'data/types';

/** 缺失字段占位符：与同列卡片保持行对齐 */
const PLACEHOLDER = '—';

/** 卡片副行（年份 / 专辑·年份槽）：
 *  - 音乐：「专辑 · 年份」（歌手由 creator 行展示，避免双标题）
 *  - 其他：仅年份
 *  - 无值：「—」占位（避免同行卡片错位） */
export function cardSubtitle(e: MediaEntry): string {
    if (e.type === 'music') {
        const parts = [e.album, e.year ? String(e.year) : undefined].filter(
            (x): x is string => !!x,
        );
        return parts.length > 0 ? parts.join(' · ') : PLACEHOLDER;
    }
    return e.year ? String(e.year) : PLACEHOLDER;
}

/** 副行是否为真实内容（用于决定 title tooltip 是否设置，避免显示「—」提示） */
export function hasCardSubtitle(e: MediaEntry): boolean {
    if (e.type === 'music') return !!(e.album || e.year);
    return !!e.year;
}

/** 卡片创作者行（导演 / 作者 / 开发商槽）：
 *  - 优先级：导演 → 作者 → 开发商
 *  - 全无：「—」占位（海报墙防错位核心场景） */
export function cardCreator(e: MediaEntry): string {
    if (e.director) return e.director;
    if (e.author) return e.author;
    if (e.developer) return e.developer;
    return PLACEHOLDER;
}

/** 创作者行是否为真实内容 */
export function hasCardCreator(e: MediaEntry): boolean {
    return !!(e.director || e.author || e.developer);
}

/** 卡片题材行（genres 前 2 个，「 · 」连接）：
 *  - 空 → 「—」占位（与 subtitle/creator 同款占位，行占位恒定防错位） */
export function cardGenres(e: MediaEntry): string {
    return e.genres.length > 0 ? e.genres.slice(0, 2).join(' · ') : PLACEHOLDER;
}

/** 题材行是否为真实内容（用于决定 title tooltip 是否设置，避免显示「—」提示） */
export function hasCardGenres(e: MediaEntry): boolean {
    return e.genres.length > 0;
}