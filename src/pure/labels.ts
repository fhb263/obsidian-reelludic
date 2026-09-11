// 状态文案按类型映射（纯逻辑，可单测）
// 内部存储统一四态（want/watching/watched/archived），仅显示层按类型换文案；
// 存档为归档语义，全类型统一「存档」
import type { EntryType } from 'data/types';
import type { MediaStatus } from './status';
import { STATUS_LABELS } from './status';

const STATUS_LABELS_BY_TYPE: Record<EntryType, Record<MediaStatus, string>> = {
    movie: { want: '想看', watching: '在看', watched: '已看', archived: '存档' },
    tv: { want: '想看', watching: '在看', watched: '已看', archived: '存档' },
    anime: { want: '想看', watching: '在看', watched: '已看', archived: '存档' },
    book: { want: '想读', watching: '在读', watched: '已读', archived: '存档' },
    game: { want: '想玩', watching: '在玩', watched: '通关', archived: '存档' },
    music: { want: '想听', watching: '在听', watched: '已听', archived: '存档' },
};

export function statusLabel(type: EntryType, status: MediaStatus): string {
    return STATUS_LABELS_BY_TYPE[type]?.[status] ?? STATUS_LABELS[status];
}

// 状态区动词按类型映射（表单 label：状态/日期均以动词拼接），默认回退「观看」
const STATUS_VERB_BY_TYPE: Record<EntryType, string> = {
    movie: '观看', tv: '观看', anime: '观看',
    book: '阅读', game: '游玩', music: '收听',
};

export function statusVerb(type: EntryType): string {
    return STATUS_VERB_BY_TYPE[type] ?? '观看';
}

// 评语 placeholder 按类型映射（游戏/音乐非「感」字短语，需独立词表），默认回退「观后感」
const REVIEW_LABEL_BY_TYPE: Record<EntryType, string> = {
    movie: '观后感', tv: '观后感', anime: '观后感',
    book: '读后感', game: '游玩体验', music: '收听感受',
};

export function reviewLabel(type: EntryType): string {
    return REVIEW_LABEL_BY_TYPE[type] ?? '观后感';
}

/** 追更表收录范围：连载剧集与动画（书籍/游戏不追更） */
export function isTrackingType(type: EntryType): boolean {
    return type === 'tv' || type === 'anime';
}

// 顶部概览量词（「N X」里的 X）。单类型（锁定页签或类型筛选）用专属量词；
// 无类型（总库 / 影视聚合）回落「项媒体」。
// ⚠️ 每个 EntryType 都必须在此登记 —— 漏登记会静默落到兜底，页签顶部就会显示成「N 项媒体」。
// （曾漏 music：音乐页签顶部写「8 项媒体」而非「8 首音乐」。tests/labels.test.ts 有穷举锁。）
const OVERVIEW_UNIT_BY_TYPE: Record<EntryType, string> = {
    movie: '部电影',
    tv: '部电视剧',
    anime: '部动画',
    book: '本书',
    game: '款游戏',
    music: '首音乐',
};

export function overviewUnitLabel(type: EntryType | null): string {
    return (type ? OVERVIEW_UNIT_BY_TYPE[type] : '') || '项媒体';
}
