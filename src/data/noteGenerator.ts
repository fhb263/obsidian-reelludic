// 详情笔记生成（纯逻辑，可单测）
import type { MediaEntry } from 'data/types';
import { noteSubDir } from 'pure/dirs';
import { formatPlaytime } from 'pure/playtime';
import { localDateOf } from 'pure/dailyLog';
import { formatLrcSourceDirective } from 'pure/lrcSource';
import { seriesIndexValue } from 'pure/seriesGroup';
import { episodeHintLabel } from 'pure/episodeAssoc';
// ③ 单集评价的 YAML 序列化（写侧唯一真源，与 `noteEditable` 的读侧同源）
import { serializeEpisodeReviews, EPISODE_REVIEWS_FM_KEY } from 'pure/episodeReview';
import { NOTES_PLACEHOLDER } from 'pure/noteEditable';
// 🔴 2026-11-14 用户 m04138：属性表格 → 条目卡代码块（围栏拼装走纯层唯一真源）
import { noteCardFenceOf } from 'pure/noteCard';
// 🔴 用户 m00002：「记录时长 / 重温 / 周目 都加上时间前缀，预览效果」——
//   落盘行格式与弹窗预览共用 `pure/logLine` **唯一真源**（⛔ 别在这里再手拼一遍模板）
import { commentRecordBlock, datedRecordLine } from 'pure/logLine';
// 1.3.1 ① 字段映射（写侧）：把生成好的 YAML 顶层键名按用户配置重写
import { EMPTY_FIELD_MAP, mapForward, type CompiledFieldMap } from 'pure/fieldMap';
// 1.3.1 ① 第 3 件：把键**行**按该类型的配置顺序重排（文本层，与上面那道改名同一层）
import { applyFieldOrder } from 'pure/fieldOrder';
// #635 关联章节：关系词默认词与「目标标题」口径都走纯模块唯一真源（⛔ 别在笔记侧另立一份）
import { REL_DEFAULT_LABEL } from 'pure/relatedGraph';

/** 剔除文件名字非法字符，空则回退「未命名」 */
export function safeFilename(title: string): string {
    const cleaned = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || '未命名';
}

/** 笔记内容指纹（G 双写冲突）：FNV-1a 32 位哈希 → hex。
 *  writeNote 落盘后记录，下次写前读现有笔记比对——外部手动修改可检出（防静默覆盖）。 */
export function hashNoteContent(content: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < content.length; i++) {
        h ^= content.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

/** 生成 frontmatter（YAML：字符串字段加引号防特殊字符破坏）
 *  Dataview 对齐：tags / created / updated / progress_percent —— 在 Obsidian 里可直接
 *  `TABLE rating, status FROM #movie WHERE rating >= 4 SORT created DESC` 检索。
 *  ⚠️ 1.3.1 ①：第三参 `fieldMap` 是用户配置的**字段改名**（缺省恒等）—— 见 `applyFieldMap`。 */
export function entryFrontmatter(
    e: MediaEntry,
    libraryDir: string = 'ReelLudic',
    fieldMap: CompiledFieldMap = EMPTY_FIELD_MAP,
    /** 1.3.1 ① 第 3 件：该类型的**属性写出顺序**（原始键名数组；缺省 / 空 = 现有顺序）。
     *  ⚠️ 由 `EntryService` 按 `e.type` 从 `pure/fieldOrder.resolveAllOrders` 取好后传进来。 */
    fieldOrder: readonly string[] = [],
    /** 🔴 #721：该类型**不写出**的属性键（用户「笔记属性配置也可增删，删除后不拉取改属性字段」）。
     *  ⚠️ 与 `fieldOrder` 是两个语义：`fieldOrder` 决定**先后**，本参数决定**写不写**。
     *  ⚠️ 收窄（结构性键不可隐藏）在 `pure/fieldOrder.normalizeHidden` 已经做过，这里直接丢行。 */
    fieldHidden: readonly string[] = [],
): string {
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const lines: string[] = [
        '---',
        `id: ${q(e.id)}`,
        `type: ${e.type}`,
        `title: ${q(e.title)}`,
        `status: ${e.status}`,
        `rating: ${e.rating}`,
    ];
    // tags：类型键在前（#movie/#book… 便于按类型检索）+ 用户自定义标签去重保序
    const tags = [e.type, ...((e.tags ?? []).filter((t) => t !== e.type))];
    lines.push(`tags: [${tags.map(q).join(', ')}]`);
    // created / updated：本地日期（与「今日记录」同口径，UTC 切片会把凌晨算到前一天）
    const created = localDateOf(e.createdAt);
    const updated = localDateOf(e.updatedAt);
    if (created) lines.push(`created: ${created}`);
    if (updated) lines.push(`updated: ${updated}`);
    // 封面 banner：URL 直用；本地路径拼库目录（兼容 obsidian-banners 等插件）
    if (e.poster) lines.push(`banner: ${q(/^https?:\/\//.test(e.poster) ? e.poster : `${libraryDir}/${e.poster}`)}`);
    if (e.year) lines.push(`year: ${e.year}`);
    if (e.genres.length) lines.push(`genres: [${e.genres.join(', ')}]`);
    if (e.director) lines.push(`director: ${q(e.director)}`);
    if (e.cast.length) lines.push(`cast: [${e.cast.map(q).join(', ')}]`);
    if (e.screenwriter?.length) lines.push(`screenwriter: [${e.screenwriter.map(q).join(', ')}]`);
    if (e.country) lines.push(`country: ${q(e.country)}`);
    if (e.language) lines.push(`language: ${q(e.language)}`);
    if (e.durationMin) lines.push(`duration_min: ${e.durationMin}`);
    if (e.aliases?.length) lines.push(`aliases: [${e.aliases.map(q).join(', ')}]`);
    if (e.author) lines.push(`author: ${q(e.author)}`);
    // 🔴 #444g 画师（漫画）：与 `author` **分开的独立键** —— 漫画里「原作」与「作画」常是两个人，
    //    挤进同一个 author 会丢一个（⛔ 别写成 `author: ${author} / ${artist}` 那种拼接，Dataview 查不出来）。
    if (e.artist) lines.push(`artist: ${q(e.artist)}`);
    if (e.translator) lines.push(`translator: ${q(e.translator)}`);
    if (e.publisher) lines.push(`publisher: ${q(e.publisher)}`);
    if (e.producer) lines.push(`producer: ${q(e.producer)}`);
    if (e.isbn) lines.push(`isbn: ${q(e.isbn)}`);
    if (e.binding) lines.push(`binding: ${q(e.binding)}`);
    if (e.price) lines.push(`price: ${q(e.price)}`);
    if (e.series) lines.push(`series: ${q(e.series)}`);
    // 系列序号（#434；append-only；🔴 #443 起锁定整数 —— 写盘时经 `seriesIndexValue` 已取整）：只在两者都有值时写 ——
    // 孤立序号不参与任何分组，写进 frontmatter 只会制造「有 series_index 却没有 series」的脏数据。⚠️ 与 `series` 一样**不按类型门控**
    // （frontmatter 是机器读的，海报墙的系列分组对全部 6 类型生效）。
    if (e.series && seriesIndexValue(e) !== undefined) lines.push(`series_index: ${seriesIndexValue(e)}`);
    if (e.platform) lines.push(`platform: ${q(e.platform)}`);
    if (e.type === 'music' && e.album) lines.push(`album: ${q(e.album)}`);
    if (e.developer) lines.push(`developer: ${q(e.developer)}`);
    if ((e.type === 'tv' || e.type === 'anime') && e.progress) {
        lines.push(`progress_season: ${e.progress.season}`);
        lines.push(`progress_episode: ${e.progress.episode}`);
        if (e.progress.totalEpisodes) lines.push(`progress_total_episodes: ${e.progress.totalEpisodes}`);
    }
    if (e.watchedDate) lines.push(`watched_date: ${q(e.watchedDate)}`);
    if (e.plannedDate) lines.push(`planned_date: ${q(e.plannedDate)}`);
    // 🔴 #772 心情（⑳）：只在有值时写（缺省**不写空行** —— 心情是可选字段，
    //    给没填过的条目塞 `mood: ` 会在用户笔记里制造一堆空属性）。
    if (e.mood) lines.push(`mood: ${e.mood}`);
    // ③ 单集评价（append-only，2026-11-17）：写进**整部/单季 md** 的 frontmatter。
    //    ⚠️ 序列化走 `pure/episodeReview.serializeEpisodeReviews`（⛔ 别在这里手拼 JSON）——
    //    它内部先做 `normalizeEpisodeReviews` 归一，保证「写下去的行」和「读回来再写」逐字相同
    //    （否则每次 `service.update` 都会让笔记文件 mtime 变化，撞上 G 双写冲突检测）。
    //    ⚠️ 只在有值时写（与 `mood` 同口径）：没评价的条目一个空属性都不该多。
    const episodeReviewsLine = serializeEpisodeReviews(e.episodeReviews);
    if (episodeReviewsLine) lines.push(`${EPISODE_REVIEWS_FM_KEY}: ${episodeReviewsLine}`);
    // 🔴🔴 2026-11-14 用户 m04138：属性表格换成 ` ```reelludic ` 条目卡之后，
    //    「来源」那一行**不再存在** —— 而它原是 `sourceUrl` / `source` 唯一的回写通道
    //    （`pure/noteEditable.extractEditableFromNote` 的 `/^\|\s*来源\s*\|/` 正则）。
    //    ⇒ 把这两个键搬进 YAML，并在 `noteEditable.extractFrontmatterFromNote` 补上对应 handler。
    //    ⛔ 别只删表格不补这里：那样用户在笔记里手改来源就再也回不到 catalog
    //    （等同 `table: false` 的既有降级，但本批不该主动制造降级）。
    // ⚠️ 只在有值时写（与 `mood` 同口径），避免给没来源的条目塞空属性。
    if (e.source) lines.push(`source: ${q(e.source)}`);
    if (e.sourceUrl) lines.push(`source_url: ${q(e.sourceUrl)}`);
    if (e.type === 'book' && e.readingProgress) {
        if (e.readingProgress.page) lines.push(`reading_page: ${e.readingProgress.page}`);
        if (e.readingProgress.totalPage) lines.push(`reading_total_page: ${e.readingProgress.totalPage}`);
    }
    if (e.type === 'book' && e.pageCount) lines.push(`page_count: ${e.pageCount}`); // 元数据页数（豆瓣实体书，仅展示/统计）；网文同字段 = 章数，键名不变（Dataview 查询兼容，1.0.3）
    if (e.type === 'book' && e.readMinutes) lines.push(`read_minutes: ${e.readMinutes}`); // #537 阅读时长（分钟；阅读器自动累计 + 表单手填）
    if (e.type === 'game' && e.playtimeMinutes) lines.push(`playtime_minutes: ${e.playtimeMinutes}`);
    if (e.type === 'music' && e.listenMinutes) lines.push(`listen_minutes: ${e.listenMinutes}`); // #685 收听时长（分钟；播放器累计 + 「记录时长」补记）
    // progress_percent：进度百分比（Dataview 排序/筛选用）——书籍优先 percent，回退 page/totalPage（与书架进度条同口径）；
    // 剧集/动画按已看集数比；游戏/音乐无统一百分比，不输出
    const pct = progressPercentOf(e);
    if (pct !== undefined) lines.push(`progress_percent: ${pct}`);
    lines.push('---');
    // 🔴 两道文本层，**顺序不能换**：先按原始键名**排序**（`applyFieldOrder`），再**改名**（`applyFieldMap`）。
    //    反过来做的话，`fieldOrder` 里那一串原始键名就得跟着映射表再换一套，白搭一层耦合。
    // 🔴 #721：`fieldHidden` 是**要丢掉的键**（用户「删除后不拉取改属性字段」）——
    //    它在排序那一层就过滤掉，所以隐藏的键连「排到最后」都不会发生。
    return applyFieldMap(applyFieldOrder(lines.join('\n'), fieldOrder, fieldHidden), fieldMap);
}

/**
 * 1.3.1 ①：把生成好的 YAML 里的**顶层键名**按映射重写。
 *
 * 🔴 为什么在**文本层**做，而不是把 42 处 `lines.push(\`year: …\`)` 逐个改成 `\`${K('year')}: …\``：
 *    · 那样要动 42 行，且以后新增字段的人很容易漏掉一次换算（漏了就是**静默不映射**）；
 *    · 文本层只认「行首到第一个冒号」这一段，与生成逻辑完全解耦 ⇒ 新增字段**自动**被覆盖。
 * ⚠️ 「键名在行首」是这份 YAML 的**既有不变量**：全部单行、无嵌套、无缩进，值里虽有冒号但都在键之后。
 * ⛔ 别改成按 `key:` 全文搜索替换 —— 值里也可能出现同样的字符串。
 */
function applyFieldMap(fm: string, fieldMap: CompiledFieldMap): string {
    if (fieldMap.forward.size === 0) return fm;
    return fm
        .split('\n')
        .map((line) => {
            const idx = line.indexOf(':');
            if (idx <= 0) return line;
            const key = line.slice(0, idx);
            const to = mapForward(fieldMap, key);
            return to === key ? line : `${to}${line.slice(idx)}`;
        })
        .join('\n');
}

/** 条目进度百分比（0-100 取整）；无法确定 → undefined */
function progressPercentOf(e: MediaEntry): number | undefined {
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    if (e.type === 'book') {
        const rp = e.readingProgress;
        if (typeof rp?.percent === 'number') return clamp(rp.percent);
        if (rp?.totalPage) return clamp(((rp.page ?? 0) / rp.totalPage) * 100);
        return undefined;
    }
    if ((e.type === 'tv' || e.type === 'anime') && e.progress?.totalEpisodes) {
        return clamp((e.progress.episode / e.progress.totalEpisodes) * 100);
    }
    return undefined;
}

/**
 * 🔴🔴 2026-11-14 用户 m07593：顶部 **bookinfo callout 整体删除**（原话「这个属性表格有残留，把改成封面
 *    嵌入组件显示而不是用表格[!bookinfo]来显示」）⇒ 封面**不再往正文 markdown 里嵌**。
 *    封面现在由**条目卡组件内嵌显示**（`views/noteCardMount` → 宿主 `resolvePoster` 取 URL，
 *    豆瓣图床走 `referrerpolicy="unsafe-url"` 防盗链）。
 *    ⛔ 因此本文件原先的 `posterEmbed()`（markdown 图片 / wikilink / 内联 HTML img）**已整体删除**：
 *    它的唯一消费者就是那个 callout，留着就是「死码不留」铁律要清的那类残留。
 *    ⛔ 也别把它搬回正文 —— 正面残留正是用户要去掉的东西。
 */

/**
 * 🔴🔴 2026-11-14 用户 m04138：属性表格被「条目卡代码块」取代后，这里的三个辅助函数
 * （`displayWidth` / `creatorOf` / `sourceLinkText`）**已整体删除** —— 它们的唯一消费者就是那张表。
 * ⛔ 别为了「以后可能要用」留着：仓库的 Unused 门禁与「死码不留」铁律都盯着这类残留。
 *    · 表格行的信息现在由 `pure/noteCard.buildNoteCardGroups` 按七组投影（能力真源仍是 `pure/metaFields`）
 *    · 「来源」链接的**回写通道**已迁到 frontmatter（`noteGenerator.entryFrontmatter` 写 `source` /
 *      `source_url`，`pure/noteEditable` 的 handlers 反解）—— 见下方 `entryFrontmatter` 的注释。
 */


/**
 * 🔴 #635 关联章节：标题名是**保留区键**（`EntryService.writeNote` 会把旧笔记这一区整段搬回），
 *  ⛔ 改名 = 存量笔记里的关联区一保存就被模板重写抹掉（与 #587 改区名同族的静默丢数据）。
 *  读取侧 `pure/noteEditable.RELATED_SECTION` 必须是**同一个字面量**。
 */
export const RELATED_SECTION = '关联';
/** 关联为空时的提示行（与链接章节「（暂无链接）」同一措辞口径） */
export const RELATED_EMPTY_HINT = '（暂无关联）';

/**
 * 笔记「## 关联」区的逐条内容（#635）：`- 关系词：[[目标标题]]`，与既有 wikilink 口径一致。
 *
 * ⚠️ 只写**出边**（`e.related`）—— 入边是渲染时算的，笔记里写进去就成了第二份真源，
 *    摘掉出边之后笔记里会留下删不掉的幽灵关联。
 * ⚠️ 目标标题取 `allEntries`（可选）：查不到时用 `id` 兜底（⛔ 不丢行 —— 笔记是给人看的，
 *    留一行「已失效」比静默少一行更容易让用户自己发现）。
 */
export function relatedNoteLines(e: MediaEntry, allEntries?: readonly MediaEntry[]): string[] {
    const list = Array.isArray(e.related) ? e.related : [];
    if (!list.length) return [];
    const byId = new Map<string, string>();
    for (const x of allEntries ?? []) {
        if (x && typeof x.id === 'string') byId.set(x.id, x.title);
    }
    const out: string[] = [];
    for (const link of list) {
        if (!link || typeof link.id !== 'string' || !link.id) continue;
        const title = byId.get(link.id) || link.id;
        const label = typeof link.label === 'string' && link.label.trim() ? link.label.trim() : REL_DEFAULT_LABEL;
        out.push(`- ${label}：[[${escapeLinkText(title)}]]`);
    }
    return out;
}

/** 生成详情笔记 Markdown 全文（条目卡代码块 + 评语 + 链接）
 *  - 🔴 2026-11-14 用户 m07593：顶部 **bookinfo callout（标题 + 封面嵌入）已整体删除** ⇒
 *    封面改由**条目卡组件内嵌显示**（`views/noteCardMount`），正文里不再有任何 `> [!bookinfo]+` 残留。
 *  - `opts.table === false`（设置页「笔记表格」关）→ **条目卡代码块也不写**，
 *    正文直接从第一个内容小节开始；标题与封面只在 **YAML 属性**（含 `banner`）里保留。
 *    影响面：`pure/noteEditable` 的「来源」行解析拿不到值 → 编辑回填回退 catalog 既有值（不丢数据，
 *    但笔记里看不到来源链接）。
 *  - 🔴 #635 `opts.allEntries`：关联章节要把目标 **id 换成标题**（`[[标题]]`）。不传则回落 id 兜底；
 *    传了就能出真正的双链。它与「笔记表格」开关**互相独立**（表格关掉照样有关联章节）。 */
export function generateNoteMarkdown(
    e: MediaEntry,
    libraryDir: string = 'ReelLudic',
    opts: { table?: boolean; allEntries?: readonly MediaEntry[] } = {},
): string {
    const s: string[] = [];
    const withTable = opts.table !== false;
    // 🔴 2026-11-14 用户 m07593：顶部 **bookinfo callout 整体删除** —— 封面改由条目卡组件内嵌显示，
    //    正文不再有任何 `> [!bookinfo]+` 残留（那正是用户说的「属性表格有残留」）。
    //    ⛔ 原先的 `headTitle`（`**《…》**` 那行）**已整体删除**：它的唯一消费者就是那个 callout，
    //    留着就是「死码不留」铁律要清的那类残留。标题现在由条目卡组件自己渲染（`entry.title`）。
    // 🔴 `libraryDir` 参数**保留**：调用形态 `generateNoteMarkdown(e, libraryDir, {...})` 被断言钉死，
    //    且 `entryFrontmatter` 里还要用它拼 `banner:`（本地封面 → `${libraryDir}/${poster}`）。
    //    它在本函数内已无消费者（封面不再往正文嵌），这里显式「用掉」避免留下静默的未读参数。
    void libraryDir;

    // 🔴🔴 2026-11-14 用户 m04138：属性表格 → **插件专属条目卡代码块**（` ```reelludic `）。
    //    用户原话：「在笔记规划渲染出插件专属组件，因为笔记属性和表单两个可视化不对等的」。
    //    拍板口径：⑴ 代码块显式挂载；⑵ 可交互就地改；⑶ **替换掉**原来那张 `| 属性 | 内容 |` 表格。
    //
    //    ⚠️ 开关语义原样保留（#404 用户裁定，⛔ 别动）：`opts.table === false` ⇒ 顶部块与这一整块都不写。
    //    🔴 原先这里的 90 行 `rows: [string, string][]` 拼装（类型/作者/年份/来源/评分 + 各类型附加行
    //       + 心情行 + 系列行）**已整块删除**：它的唯一消费者就是那张表格。
    //       同样的信息现在由 `pure/noteCard.buildNoteCardGroups` 按七组投影（字段能力仍以
    //       `pure/metaFields` 为唯一真源），⛔ 别把 `rows` 复活 —— 两份投影并存就是「东拼西凑」的起点。
    //    🔴 块里只放**条目 id 一行**（`noteCardFenceOf`）：⛔ 别把 frontmatter 抄进来，
    //       那会形成两份真源，改一处另一处不动就是脏数据。
    if (withTable) {
        s.push(noteCardFenceOf(e.id));
        s.push('');
    }

    // 🔴 #404：音乐条目的**歌词小节移到笔记开头**（紧跟头部块 / 属性表格；关表时它就是正文第一行）——
    //    用户：「把笔记内lrc歌词代码块放在笔记开头## 歌词，下」。
    //    ⇒ 新增 `## 歌词` 小节标题，代码块挂在它下面（原先是一段**没有标题**的裸围栏、位置在「个人评语」之后）。
    //    ⚠️ 位置变化不影响歌词搬运：`withLrcLyrics` / `lrcBlockLyrics` 按**第一个 lrc 围栏**定位，与位置无关。
    //    🔴 `source` 行的形态（库内相对 ⇒ `[[…]]`、库外绝对 ⇒ 裸写）仍由 `pure/lrcSource.formatLrcSourceDirective`
    //       单一真源决定 —— 播放器侧用 `parseLrcRef` 反解（`tests/lrcSource.test.ts` 往返用例钉住两端）。
    if (e.type === 'music' && e.audioPath) {
        const srcLine = formatLrcSourceDirective(e.audioPath);
        if (srcLine) {
            s.push('## 歌词');
            s.push('');
            s.push('```lrc');
            s.push(srcLine);
            s.push('```');
            s.push('');
        }
    }

    // 简介（作品客观描述，搜索回填自动记录；与「个人评语」主观感想区分开；图书用「内容简介」标题）
    if (e.summary?.trim()) {
        s.push(`## ${e.type === 'book' ? '内容简介' : '简介'}`);
        s.push('');
        s.push(e.summary.trim());
        s.push('');
    }

    // 图书附加小节（豆瓣详情页回填）：作者简介 / 目录，有值才渲染
    if (e.type === 'book' && e.authorIntro?.trim()) {
        s.push('## 作者简介');
        s.push('');
        s.push(e.authorIntro.trim());
        s.push('');
    }
    // 目录：**文学与网文都渲染**（🔴 #431 翻面 —— 2026-09-13 的「网文无出版目录」针对的是那份 2000+ 章的
    // 出版目录；用户 2026-09-29 裁定「toc 回填只显示前 10 章加个 `....`」之后，网文写回来的也只有 10 行预览）。
    // ⚠️ 这里**不再按 `novel` 分叉**，⛔ 别只去掉一半（表单渲染、笔记不渲染 ⇒ 用户看得见条目里有目录、
    //    笔记里却没有，会以为同步坏了）。
    if (e.type === 'book' && e.toc?.trim()) {
        s.push('## 目录');
        s.push('');
        s.push(e.toc.trim());
        s.push('');
    }

    // AI 摘要（一句话总结 / 核心看点）：位置与编辑表单同序——简介（书籍再经作者简介/目录）之后、个人评语之前
    const aiSummary = e.aiSummary?.trim();
    const aiHighlights = (e.aiHighlights ?? []).map((h) => h.trim()).filter(Boolean);
    if (aiSummary) {
        s.push('## 一句话总结');
        s.push('');
        s.push(aiSummary);
        s.push('');
    }
    if (aiHighlights.length) {
        s.push('## 核心看点');
        s.push('');
        for (const h of aiHighlights) s.push(`- ${h}`);
        s.push('');
    }

    s.push(e.type === 'music' ? '# 个人评语' : '## 个人评语');
    s.push('');
    // 表单提交的评语（e.notes）写入笔记正文；为空时写占位行
    // 🔴 #453：占位文本取 `noteEditable.NOTES_PLACEHOLDER` **唯一真源**（原先这里内联了一份，
    //   改文案就得两处同步 —— 正是「两处真源必然漂移」的老坑）；该常量已去掉「，支持 [[双链]]」。
    s.push(e.notes.trim() ? e.notes : NOTES_PLACEHOLDER);
    s.push('');

    // 🔴 用户 2026-10-25：「添加短评不要追加到个人评语，另起个标题追加」——
    //    短评流水落到**独立**的 `## 短评` 章节（在「个人评语」之后、「游玩/阅读/收听记录」之前），
    //    日期倒序、与 `roundLogs` 同一口径。⛔ 别再往 `notes` 里拼（那正是用户要停掉的行为）。
    const commentLogs = e.commentLog ?? [];
    if (commentLogs.length) {
        s.push('## 短评');
        s.push('');
        for (const cm of [...commentLogs].sort((a, b) => b.date.localeCompare(a.date))) {
            // 多行短评走 `commentRecordBlock`（首行挂日期、后续行缩进两格保住列表项归属）；
            // 与弹窗预览**同一函数**，⛔ 别在这里另拼模板。
            s.push(commentRecordBlock(cm.date, cm.text));
        }
        s.push('');
    }

    // 音乐 lrc 块已上移到笔记开头（#404，见上方「## 歌词」小节）—— ⛔ 别在这里再写一份。
    // 🔴 #685 时长明细**按类型分章节**（catalog 明细的展示副本，日期倒序；由模板生成，重写笔记时随模板更新）：
    //    游戏 → 游玩记录 ｜ 书籍 → 阅读记录 ｜ 音乐 → 收听记录（章节名唯一真源在这一处，⛔ 别各处各写一份）
    const timeSection =
        e.type === 'game' ? '游玩记录' : e.type === 'book' ? '阅读记录' : e.type === 'music' ? '收听记录' : undefined;
    if (timeSection && e.playSessions?.length) {
        s.push(`## ${timeSection}`);
        s.push('');
        const sorted = [...e.playSessions].sort((a, b) => b.date.localeCompare(a.date));
        for (const ps of sorted) {
            s.push(datedRecordLine(ps.date, formatPlaytime(ps.minutes), ps.note));
        }
        s.push('');
    }
    // 🔴 #685 重温 / 周目记录：影视「重刷次数 + 感想」、游戏「周目序号 + 感想」—— 感想落**笔记内**（用户原话）
    const rewatchLogs = (e.roundLogs ?? []).filter((r) => r.kind === 'rewatch');
    if (rewatchLogs.length) {
        s.push('## 重温记录');
        s.push('');
        for (const r of [...rewatchLogs].sort((a, b) => b.date.localeCompare(a.date))) {
            s.push(datedRecordLine(r.date, `第 ${r.round} 次重刷`, r.note));
        }
        s.push('');
    }
    const playthroughLogs = (e.roundLogs ?? []).filter((r) => r.kind === 'playthrough');
    if (playthroughLogs.length) {
        s.push('## 周目记录');
        s.push('');
        for (const r of [...playthroughLogs].sort((a, b) => b.date.localeCompare(a.date))) {
            s.push(datedRecordLine(r.date, `第 ${r.round} 周目`, r.note));
        }
        s.push('');
    }
    // 🔴 #685 攻略（游戏）：右键菜单「添加攻略」写入 → 笔记「攻略」章节（空串不落）
    if (e.guide?.trim()) {
        s.push('## 攻略');
        s.push('');
        s.push(e.guide.trim());
        s.push('');
    }
    // 音乐无观看/相关链接章节（本地音频已在 lrc 块声明，网络地址随条目保存但不在笔记渲染）
    // 🔴 #635：**关联章节必须排在链接章节之前** —— 与表单章节顺序一致（简介 → 评语 → 关联 → 链接），
    //    且 `mergeExcerptSection` 的插入锚点是「链接章节之前」⇒ 摘抄区仍落在评语与关联之间。
    s.push(`## ${RELATED_SECTION}`);
    const relLines = relatedNoteLines(e, opts.allEntries);
    if (relLines.length) s.push(...relLines);
    else s.push(RELATED_EMPTY_HINT);
    s.push('');
    if (e.type !== 'music') {
        s.push(`## ${e.type === 'book' || e.type === 'game' ? '相关链接' : '观看链接'}`);
        // 🔴 #448：影视的**逐集网络链接**也要落进来（形如 `- [第 1 集 新邻居](https://…)`）。
        // 以前这里只读 `e.links`，而影视的链接已迁到 `episodeUrls`（提交时 `links` 清空）⇒ 集链接在笔记里
        // **一条都看不到**（打开笔记只有「（暂无链接）」），用户报障原话：「集网络链接怎么不写回笔记内」。
        const epLines = episodeWatchLines(e);
        if (epLines.length || e.links.length) {
            for (const line of epLines) s.push(line);
            e.links.forEach((l) => s.push(`- [${l.label}](${l.url})`));
        } else {
            s.push('（暂无链接）');
        }
        s.push('');
    }
    return s.join('\n');
}

/** Markdown 链接**文本**转义：标题里的 `[` / `]` 会提前闭合链接（如集标题「第 5 集 [前篇]」） */
function escapeLinkText(s: string): string {
    return s.replace(/[[\]]/g, '\\$&');
}
/** Markdown 链接**地址**：含空白 / 括号时用 CommonMark 的尖括号形式包裹，否则链接会被拆断 */
function escapeLinkUrl(u: string): string {
    return /[\s()<>]/.test(u) ? `<${u.replace(/>/g, '%3E')}>` : u;
}

/**
 * 影视条目「观看链接」章节里的**逐集条目**（#448 用户：「怎么我在编辑条目保存集网络链接怎么不写回笔记内，
 * 比如 [第1集 新邻居](网络链接) 格式到 ## 观看链接 下呢」）。
 *
 * 口径：
 *  - **只写集网络链接**（`episodeUrls`）—— 本地路径不进笔记：绝对路径又长又不可点，104 集足以把笔记灌满；
 *  - 标签走 `pure/episodeAssoc.episodeHintLabel`（剧集/动画 = 「第 N 集 集标题」，未填标题只「第 N 集」；
 *    电影 = 集标题，缺标题回退片名 —— 电影文案**不出「第 N 集」**，见 UI-GUIDE §3；多资源电影用「文件 N」措辞）；
 *  - 只输出**有网址**的集：集数组是**保位**的（index i = 第 i+1 集，空位留洞），空位跳过、下标照旧。
 *
 * ⚠️ 与「集数选择 / 集按钮悬停」同一份文案真源 ⇒ ⛔ 别在这里另写一套拼接。
 */
export function episodeWatchLines(e: MediaEntry): string[] {
    const t = e.type;
    if (t !== 'movie' && t !== 'tv' && t !== 'anime') return [];
    const urls = e.episodeUrls ?? [];
    const single = t === 'movie';
    const urlCount = urls.filter((u) => typeof u === 'string' && u.trim()).length;
    const out: string[] = [];
    for (let i = 0; i < urls.length; i++) {
        const raw = urls[i];
        const url = typeof raw === 'string' ? raw.trim() : '';
        if (!url) continue;
        const label = episodeHintLabel(i, e.episodeTitles?.[i], single) || (single && urlCount > 1 ? `文件 ${i + 1}` : e.title);
        out.push(`- [${escapeLinkText(label)}](${escapeLinkUrl(url)})`);
    }
    return out;
}

/** 条目笔记在 vault 内的路径：按类型分子目录（笔记/movie/、笔记/teleplay/…，英文目录名），各类型互不混杂；
 *  书籍再按子分类分（笔记/book/ 文学、笔记/novel/ 网文，1.0.3.1）——子目录裁决统一走 pure/dirs.noteSubDir */
export function entryNotePath(e: MediaEntry, baseDir: string = 'ReelLudic/笔记'): string {
    return `${baseDir}/${noteSubDir(e)}/${safeFilename(e.title)}.md`;
}
