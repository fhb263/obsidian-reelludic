// 「条目笔记模板」生成（纯逻辑，无 obsidian 依赖，可单测）。
//
// 用户 2026-11-08 指令：「给从笔记导入条目项加个『生成模板』按钮，可在仓库根目录生成笔记模板」。
//
// 🔴 这份模板的**唯一价值**是「照着填，然后能被『检索』正确导入」——
//    所以它只列**导入器真的会读**的键（`pure/noteImport.scanImportableNotes` 的 draft 白名单）。
//    ⛔ 不要「把 metaFields 里所有字段印一遍」：写进去却不读 = 又一个静默失败
//    （用户填了、看着像生效了、实际什么也没发生 —— 这正是 #732 那两类 bug 的病根）。
//
// 🔴 模板**故意**用 `{{标题}}` 这种占位符：万一用户把整份文件拖进 `笔记/` 里，
//    `scanImportableNotes` 的第二道闸会把「标题是模板占位符」报出来 ⇒ 不会被当成条目导进去。
//    另加一道保险：文件落在 `{libraryDir}/` 下而**不是** `{libraryDir}/笔记/`，
//    而扫描器只扫 `笔记/` 子树（见 `main.openNoteImport`）⇒ 位置本身就是隔离。
//
// ⚠️ 本模块**不写文件**（IO 在 main.ts），只把一份 Markdown 文本交出去。

import { ENTRY_TYPES, ENTRY_TYPE_DIRS, ENTRY_TYPE_LABELS, type EntryType } from 'data/types';
import { DIR_NOTES } from 'pure/dirs';
import { MEDIA_STATUSES } from 'pure/status';
import { statusLabel } from 'pure/labels';
import { labelOf } from 'pure/metaFields';

/** 生成模板用到的上下文（全部来自插件设置，本模块不兜底真实路径） */
export interface NoteTemplateContext {
    /** 媒体库目录（vault 相对，无前导/尾部斜杠） */
    libraryDir: string;
    /** 插件版本（写进文件头注释，便于对照是哪一版生成的字段口径） */
    pluginVersion: string;
}

/** 模板文件名（放 `{libraryDir}/` 下，与 `笔记/` 同级） */
export const NOTE_TEMPLATE_FILE = '条目模板.md';

/**
 * 模板的完整路径（vault 相对）。
 * 🔴 与其他路径工具同口径：`libraryDir` 空则回落 `ReelLudic`，去首尾斜杠、反斜杠转正斜杠。
 */
export function noteTemplatePath(libraryDir: string): string {
    const dir = (libraryDir || 'ReelLudic')
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
    return `${dir || 'ReelLudic'}/${NOTE_TEMPLATE_FILE}`;
}

/**
 * 六类通用的可填键（= `scanImportableNotes` draft 白名单里的通用部分）。
 *
 * ⛔ **不要**加 `tags` / `aliases` / `created` / `updated`：写侧 `entryFrontmatter` 会写它们，
 *    但**读侧导入器不读** ⇒ 列进模板就是让用户白填。要列它们，先把 `noteImport` 的
 *    draft 白名单补上（改动面：`noteImport.ts` + 本文件 + 单测三处一起改）。
 */
const COMMON_KEYS: readonly string[] = [
    'year',
    'genres',
    'series',
    'series_index',
    'status',
    'rating',
    'banner',
    'watched_date',
    'planned_date',
];

/**
 * 各类型的专属可填键（同样只取导入器会读的那些）。
 * ⚠️ 与 `metaFields.appliesTo` 不同源、也**不该**改成从它派生：那张表登记的是
 *    「语义上属于哪类」（含 `reading_page` / `playtime_minutes` 等**导入不读**的键）。
 *    这里要的是「填了会被读进去」的子集 ⇒ 两份判据不同，合并会重新制造静默失败。
 */
const TYPE_KEYS: Record<EntryType, readonly string[]> = {
    movie: ['director', 'cast', 'country', 'language', 'duration_min'],
    tv: ['director', 'cast', 'country', 'language', 'duration_min'],
    anime: ['director', 'cast', 'country', 'language', 'duration_min', 'developer'],
    game: ['platform', 'developer'],
    book: ['author', 'translator', 'publisher', 'isbn'],
    music: ['author', 'album'],
};

/** 字段示例值（用户照着改；语法形态与 `entryFrontmatter` 写出的一致） */
const SAMPLE: Record<string, string> = {
    year: '2020',
    genres: '[剧情, 科幻]',
    series: '"某某系列"',
    series_index: '1',
    status: 'watched',
    rating: '4.5',
    banner: '"媒体库/封面/xxx.jpg"',
    watched_date: '2024-03-08',
    planned_date: '2026-09-01',
    director: '"某某导演"',
    cast: '[演员A, 演员B]',
    country: '"中国"',
    language: '"汉语"',
    duration_min: '128',
    developer: '"某某工作室"',
    platform: '"PC"',
    author: '"某某"',
    translator: '"某某"',
    publisher: '"某出版社"',
    isbn: '"9787000000000"',
    album: '"某专辑"',
};

/**
 * 一行 frontmatter 的「注释 + 值」。
 *
 * 🔴 注释**必须单独成行**：`parseFrontmatterMap` 只跳过 `#` **开头**的行，
 *    行尾 `# …` 会被当成值的一部分读进去（`year: 2020 # 年份` ⇒ 值 `2020 # 年份`）。
 * ⛔ 别图省事写成行尾注释 —— 那会让用户复制过去的每一行都带脏值。
 */
function fieldLine(key: string, type: EntryType): string {
    const label = labelOf(key, type);
    const extra = key === 'status'
        ? `（可选：${MEDIA_STATUSES.map((s) => statusLabel(type, s)).join(' / ')}，也认 want / watching / watched / archived）`
        : '';
    return `# ${label}${extra}\n${key}: ${SAMPLE[key] ?? '""'}`;
}

/** 渲染一个类型的可复制区块 */
function typeBlock(type: EntryType): string {
    const labels = ENTRY_TYPE_LABELS[type];
    // 🔴 书籍另有子分类目录（文学 book/、网文 novel/、漫画 comic/，见 `pure/dirs.noteSubDir`）——
    //    只写 `笔记/book/` 会让网文作者以为自己放错了地方。
    const dir = type === 'book'
        ? `${DIR_NOTES}/book/` + '（文学）· ' + `${DIR_NOTES}/novel/` + '（网文）· ' + `${DIR_NOTES}/comic/` + '（漫画）'
        : `${DIR_NOTES}/${ENTRY_TYPE_DIRS[type]}/`;
    const keys = [...COMMON_KEYS, ...TYPE_KEYS[type]];
    const lines: string[] = [
        `### ${labels}（\`type: ${type}\`）→ 放 \`${dir}\``,
        '',
        '```yaml',
        '---',
        `type: ${type}`,
        '# 标题（必填；这里保留占位符，忘改时导入会被拦下并提示，不会被当成条目）',
        'title: "{{标题}}"',
        ...keys.map((k) => fieldLine(k, type)),
        '---',
        '```',
        '',
    ];
    return lines.join('\n');
}

/**
 * 生成完整的模板 Markdown。
 *
 * 形态：**一份参考文件**（用户 2026-11-08 选型：「单份参考文件，六类型全写在一个 md 里」）——
 * 不是六份分别可用的模板，而是一页「按需复制哪一段」的说明书。
 */
export function buildNoteTemplate(ctx: NoteTemplateContext): string {
    const lib = (ctx.libraryDir || 'ReelLudic').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || 'ReelLudic';
    const out: string[] = [
        '---',
        'tags: [reelludic-template]',
        '---',
        '',
        '# 条目笔记模板（填法参考）',
        '',
        `> 生成自 ReelLudic ${ctx.pluginVersion} · 媒体库目录 \`${lib}\``,
        '>',
        `> ⚠️ **这份文件本身不是条目**：它在 \`${lib}/\` 底下，而「检索」只扫 \`${lib}/${DIR_NOTES}/\` 子树 ⇒ 永远不会被导进来。`,
        '',
        '## 怎么用',
        '',
        `1. 在 \`${lib}/${DIR_NOTES}/<子目录>/\` 下新建一篇笔记（子目录见下面每段标题）`,
        '2. 把**对应类型**那段 `---` 区块原样复制到笔记最开头',
        '3. 改掉 `title`，按需删掉用不到的字段行',
        `4. 回到 设置 › 基本设置 › 管理与维护 › 从笔记导入条目 › **检索**`,
        '',
        '## 三条硬规则',
        '',
        '- 🔴 `title` 必须填真实标题：留 `{{标题}}` 会被拦下（这是故意的，防模板被当条目导进去）。',
        '- 🔴 **不要自己写 `id`**：导入时插件生成并回写到笔记里。自己写的 id 会被当成「已存在」而静默跳过。',
        '- 🔴 `status` 写中文也认（`已看` / `已读` / `通关` 都行）；写了认不出的值不会阻断导入，但会在弹窗里给出降级提示。',
        '',
        '## 字段取值形态',
        '',
        '| 形态 | 写法 | 例 |',
        '| --- | --- | --- |',
        '| 文本 | 双引号包住 | `director: "某某导演"` |',
        '| 数字 | 裸写 | `year: 2020` |',
        '| 列表 | 方括号 + 逗号 | `genres: [剧情, 科幻]`、`cast: [演员A, 演员B]` |',
        '| 日期 | `YYYY-MM-DD` | `watched_date: 2024-03-08` |',
        '',
        '> 封面 `banner` 可以写库内路径（`媒体库/封面/x.jpg`，导入时会自动剥掉库目录前缀）或 `https://` 链接。',
        '',
        '## 各类模板',
        '',
    ];

    for (const t of ENTRY_TYPES) out.push(typeBlock(t));

    out.push(
        '## 导入器不读的字段（填了也不会生效）',
        '',
        '下面这些键**写侧会写**（插件自己生成条目时会写进笔记），但**「检索」导入时不会读回**：',
        '',
        '- `tags` / `aliases` / `created` / `updated`',
        '- `screenwriter` / `producer` / `artist` / `binding` / `price`',
        '- `progress_season` / `progress_episode` / `progress_total_episodes` / `progress_percent`',
        '- `reading_page` / `reading_total_page` / `read_minutes` / `page_count`',
        '- `playtime_minutes` / `listen_minutes`',
        '',
        '⇒ 这些字段请在**插件表单里填**（导入完成后双击条目打开编辑表单）。',
        '把它们写进笔记再导入，只会得到一个空的条目 —— 那是最难查的一类问题。',
        '',
    );

    return out.join('\n');
}
