// 媒体库目录中文名（v0.4 持续优化：目录系统名称通俗化，全仓统一引用，勿散落硬编码）
// 纯逻辑无 obsidian 依赖；catalog.json 保留英文名不变（数据索引文件，兼容性依赖多）
import { ENTRY_TYPE_LABELS, type EntryType } from 'data/types';

/** 条目笔记目录（原 entries/，按类型分子目录） */
export const DIR_NOTES = '笔记';
/** 本地化封面目录（原 covers/） */
export const DIR_COVERS = '封面';
/** 导出备份目录（原 backups/） */
export const DIR_BACKUPS = '备份';
/** 年度总结报告目录（原 reports/） */
export const DIR_REPORTS = '报告';

/** 类型 → 笔记子目录名（复用 ENTRY_TYPE_LABELS：电影/电视剧/动画/书籍/游戏） */
export function typeDir(type: EntryType): string {
    return ENTRY_TYPE_LABELS[type];
}
