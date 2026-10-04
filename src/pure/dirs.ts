// 媒体库目录命名中枢（全仓统一引用，勿散落硬编码）
// 演进：v0.4 通俗化顶层目录（entries/→笔记、covers/→封面、backups/→备份、reports/→报告）；
//      本版类型子目录中文标签 → 英文（笔记/电影 → 笔记/movie、电视剧 → teleplay、动画 → animation、
//      书籍 → book、游戏 → game、音乐 → music）。UI 中文标签（ENTRY_TYPE_LABELS）与目录名解耦。
//      1.0.3.1：书籍按子分类再分目录（文学 book/、网文 novel/），见 noteSubDir。
// 纯逻辑无 obsidian 依赖；catalog.json 文件名不变（数据索引文件，兼容性依赖多）
import { ENTRY_TYPE_DIRS, ENTRY_TYPE_LABELS, ENTRY_TYPES, type BookKind, type EntryType, type MediaEntry } from 'data/types';
import { normalizeBookKind } from 'pure/bookKind';

/** 条目笔记目录（v0.4 起中文名，保持；类型子目录在其下按英文名分） */
export const DIR_NOTES = '笔记';
/** 本地化封面目录（原 covers/） */
export const DIR_COVERS = '封面';
/** 导出备份目录（原 backups/） */
export const DIR_BACKUPS = '备份';
/** 年度总结报告目录（原 reports/） */
export const DIR_REPORTS = '报告';
/** 阅读存档目录（书签 / 高亮 / 进度三者同放，见 `pure/readerStore`）。
 *  🔴 目录名**只此一处**：它是**红线路径**（`{lib}/阅读进度/{书名}-阅读-{id}.json`），
 *     ⛔ 别再在别处硬编码「阅读进度」（2026-09-23 #381 把 `readerStore` 那处收敛到这里）。 */
export const DIR_READING = '阅读进度';
/** 书籍下载**续传存档**目录（P1-C）：`{lib}/下载续传/{书名}-续传-{格式}-{hash8}.ndjson`。
 *  🔴 与「下载」目录**分开放**：存档是 `.ndjson` 的**中间态**（抓完即删），
 *     混进 `下载/书籍` 会被「库内找回同名书」当成一本书扫进来。目录名只此一处（`pure/chapterPlan` 引用）。 */
export const DIR_DOWNLOAD_RESUME = '下载续传';

/** 类型 → 笔记子目录英文名（movie/teleplay/animation/book/game/music） */
export function typeDir(type: EntryType): string {
    return ENTRY_TYPE_DIRS[type];
}

/** 书籍子分类 → 笔记子目录名（1.0.3.1 网文独立目录，用户 2026-09-13 指定；文学沿用 book/。
 *  🔴 2026-09-30 加回漫画（用户裁定）：独立 comic/ 子目录，与 book/、novel/ 同构。
 *     ⚠️ 用户实测库里没有存量 comic 条目 ⇒ 这次加目录**不触发任何存量迁移**（若有，migrateDirectories 会按本表搬）。 */
export const BOOK_KIND_DIRS: Record<BookKind, string> = {
    book: 'book',
    novel: 'novel',
    comic: 'comic',
};

/** 条目 → 笔记子目录名：书籍按子分类分（文学 book/、网文 novel/），其余类型 = 类型目录。
 *  ⚠️ 唯一入口：笔记路径生成（noteGenerator.entryNotePath）与存量迁移（main.migrateDirectories）都走这里，勿散落硬编码。 */
export function noteSubDir(e: Pick<MediaEntry, 'type' | 'bookKind'>): string {
    return e.type === 'book' ? BOOK_KIND_DIRS[normalizeBookKind(e.bookKind)] : ENTRY_TYPE_DIRS[e.type];
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
