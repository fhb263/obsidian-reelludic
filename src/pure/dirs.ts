// 媒体库目录命名中枢（全仓统一引用，勿散落硬编码）
// 演进：v0.4 通俗化顶层目录（entries/→笔记、covers/→封面、backups/→备份、reports/→报告）；
//      本版类型子目录中文标签 → 英文（笔记/电影 → 笔记/movie、电视剧 → teleplay、动画 → animation、
//      书籍 → book、游戏 → game、音乐 → music）。UI 中文标签（ENTRY_TYPE_LABELS）与目录名解耦。
// 纯逻辑无 obsidian 依赖；catalog.json 文件名不变（数据索引文件，兼容性依赖多）
import { ENTRY_TYPE_DIRS, ENTRY_TYPE_LABELS, ENTRY_TYPES, type EntryType } from 'data/types';

/** 条目笔记目录（v0.4 起中文名，保持；类型子目录在其下按英文名分） */
export const DIR_NOTES = '笔记';
/** 本地化封面目录（原 covers/） */
export const DIR_COVERS = '封面';
/** 导出备份目录（原 backups/） */
export const DIR_BACKUPS = '备份';
/** 年度总结报告目录（原 reports/） */
export const DIR_REPORTS = '报告';

/** 类型 → 笔记子目录英文名（movie/teleplay/animation/book/game/music） */
export function typeDir(type: EntryType): string {
    return ENTRY_TYPE_DIRS[type];
}

/** 旧版类型子目录中文名（v0.4–v1.0.1，迁移识别用；勿用于新路径生成） */
export const LEGACY_TYPE_DIR_ZH: Record<EntryType, string> = ENTRY_TYPE_LABELS;

/** 旧中文目录名 → 类型 反查表（relocateLegacyNotePath 用） */
const TYPE_BY_LEGACY_ZH: Record<string, EntryType> = {};
for (const t of ENTRY_TYPES) {
    TYPE_BY_LEGACY_ZH[ENTRY_TYPE_LABELS[t]] = t;
}

/** 旧版笔记 notePath 的类型目录段中文 → 英文（catalog 引用迁移）。
 *  仅替换「非末段且整段等于旧中文目录名」的段：标题/文件名（末段）恒不参与，防含词标题误伤；
 *  已是英文目录（二次迁移）或非笔记路径原样返回——幂等。 */
export function relocateLegacyNotePath(notePath: string): string {
    const parts = notePath.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
        const t = TYPE_BY_LEGACY_ZH[parts[i]];
        if (t) {
            parts[i] = ENTRY_TYPE_DIRS[t];
            break;
        }
    }
    return parts.join('/');
}
