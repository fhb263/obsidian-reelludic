// 统一视图页签类型：计划表(月历) + 统计 + 书籍/影视聚合/游戏条目页签
// 'media' 为聚合页签：内部按动画/电视剧/电影三类筛选（MediaList typePool 机制）
import type { EntryType } from 'data/types';
export type HomeTab = 'tracking' | 'stats' | 'media' | EntryType;

/** 影视聚合页签包含的具体类型（筛选 chips 与计数共用） */
export const MEDIA_TYPES: EntryType[] = ['anime', 'tv', 'movie'];
