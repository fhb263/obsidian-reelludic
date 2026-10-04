// 详情笔记生成（纯逻辑，可单测）
import type { MediaEntry } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { noteSubDir } from 'pure/dirs';
import { normalizeBookKind } from 'pure/bookKind';
import { starString } from 'pure/rating';
import { formatPlaytime } from 'pure/playtime';
import { localDateOf } from 'pure/dailyLog';
import { formatLrcSourceDirective } from 'pure/lrcSource';
import { seriesIndexValue } from 'pure/seriesGroup';
import { episodeHintLabel } from 'pure/episodeAssoc';
import { entrySourceLabel } from 'pure/sourceMeta';
import { NOTES_PLACEHOLDER } from 'pure/noteEditable';

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
 *  `TABLE rating, status FROM #movie WHERE rating >= 4 SORT created DESC` 检索。 */
export function entryFrontmatter(e: MediaEntry, libraryDir: string = 'ReelLudic'): string {
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
    if (e.type === 'book' && e.readingProgress) {
        if (e.readingProgress.page) lines.push(`reading_page: ${e.readingProgress.page}`);
        if (e.readingProgress.totalPage) lines.push(`reading_total_page: ${e.readingProgress.totalPage}`);
    }
    if (e.type === 'book' && e.pageCount) lines.push(`page_count: ${e.pageCount}`); // 元数据页数（豆瓣实体书，仅展示/统计）；网文同字段 = 章数，键名不变（Dataview 查询兼容，1.0.3）
    if (e.type === 'game' && e.playtimeMinutes) lines.push(`playtime_minutes: ${e.playtimeMinutes}`);
    // progress_percent：进度百分比（Dataview 排序/筛选用）——书籍优先 percent，回退 page/totalPage（与书架进度条同口径）；
    // 剧集/动画按已看集数比；游戏/音乐无统一百分比，不输出
    const pct = progressPercentOf(e);
    if (pct !== undefined) lines.push(`progress_percent: ${pct}`);
    lines.push('---');
    return lines.join('\n');
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

/** 封面嵌入文本：URL 用 markdown 图片；本地路径用 vault wikilink（从库目录根解析）。
 *  豆瓣图床（img*.doubanio.com）防盗链无 Referer 返回 418，改用内联 HTML img 强制携带 Referer。 */
export function posterEmbed(e: MediaEntry, libraryDir: string = 'ReelLudic'): string {
    if (!e.poster) return '';
    if (/^https?:\/\//.test(e.poster)) {
        if (/doubanio\.com/.test(e.poster)) return `<img src="${e.poster}" alt="封面" referrerpolicy="unsafe-url">`;
        return `![封面](${e.poster})`;
    }
    const rel = `${libraryDir}/${e.poster}`.replace(/\/+/g, '/');
    return `![[${rel}]]`;
}

/** 字符串显示宽度（全角按 2、半角按 1），用于音乐表格列内 padding 对齐 */
function displayWidth(s: string): number {
    let w = 0;
    for (const ch of s) w += /[^\x00-\xff]/.test(ch) ? 2 : 1;
    return w;
}

/** 属性表格的「创作者」行值：书籍→作者、影视/动画→导演、游戏→开发商（无则留空） */
function creatorOf(e: MediaEntry): string | undefined {
    if (e.type === 'book') return e.author;
    if (e.type === 'game') return e.developer;
    return e.director;
}

/**
 * 来源行链接：优先数据源官方页（搜索回填自动记录），回退手动添加的第一个观看链接。
 *
 * 🔴 #449：这里的 `SOURCE_LABELS` 手抄表**已删**，改走 `pure/sourceMeta.entrySourceLabel`（唯一真源）。
 *    旧表的键是**老的**（`google` / `openlibrary`，真源是 `googleBooks` / `openLibrary`）且**漏了 `mangadex`**
 *    ⇒ 那几种源在笔记里会原样吐出数据源键（`googleBooks` / `mangadex`）。#430 立的规矩就是三处消费共用一份。
 */
function sourceLinkText(e: MediaEntry): string {
    if (e.sourceUrl) {
        const label = entrySourceLabel(e) || '来源';
        return `[${label}](${e.sourceUrl})`;
    }
    if (e.links.length > 0) return `[${e.links[0].label}](${e.links[0].url})`;
    return '';
}


/** 生成详情笔记 Markdown 全文（顶部块 + 属性表格 + 评语 + 链接）
 *  - `opts.table === false`（设置页「笔记表格」关）→ **属性表格 + 顶部块（标题 / 封面嵌入）都不写**，
 *    正文直接从第一个内容小节开始；标题与封面只在 **YAML 属性**（含 `banner`）里保留。
 *    影响面：`pure/noteEditable` 的「来源」行解析拿不到值 → 编辑回填回退 catalog 既有值（不丢数据，
 *    但笔记里看不到来源链接）。 */
export function generateNoteMarkdown(
    e: MediaEntry,
    libraryDir: string = 'ReelLudic',
    opts: { table?: boolean } = {},
): string {
    const s: string[] = [];
    const withTable = opts.table !== false;
    // 顶部标题行（音乐书名号内带空格是历史形态，勿改）
    const headTitle = e.type === 'music' ? `**《 ${e.title} 》**` : `**《${e.title}》**`;
    // 封面嵌入走 posterEmbed：豆瓣 URL → HTML img（防盗链），其余 → markdown 图片；本地路径 → wikilink
    const embed = posterEmbed(e, libraryDir);
    // 顶部块随「笔记表格」开关二态：
    //   表格开 → bookinfo callout（标题 + 封面，默认展开）；
    //   🔴 表格关 → **正文一个字都不写**（标题与封面嵌入都不写）。
    //    2026-09-28 #404 用户原话：「默认关闭笔记表格项笔记内开头不写入《标题>图片嵌入，只在Yaml属性写入」
    //    ⇒ 推翻 2026-09-27 ③ 的「降级为普通标题 + 普通图片嵌入（都保留、只去外壳）」——那两样正是用户
    //      现在要去掉的。标题在 frontmatter 的 `title`、封面在 `banner`（见 `entryFrontmatter`），信息不丢。
    if (withTable) {
        s.push(`> [!bookinfo]+ ${headTitle}`);
        if (embed) {
            s.push('>');
            s.push(`> ${embed}`);
        }
        s.push('>');
    }

    // 属性表格：固定行 类型/作者/年份/来源/评分 + 有值附加行（保留豆瓣适配的完整字段）
    // 音乐四行（作者/发行年/来源/评分），不参与影视/书籍附加行
    // 网文（1.0.3）：年份行按「上架年」呈现；出版侧字段（译者/出版社/出品方/ISBN/装帧/定价/丛书）与「## 目录」不渲染——见下方 book 分支
    const novel = e.type === 'book' && normalizeBookKind(e.bookKind) === 'novel';
    const rows: [string, string][] = e.type === 'music'
        ? [
            ['作者', e.author ?? ''],
            ['发行年', e.year ? String(e.year) : ''],
            ['来源', sourceLinkText(e)],
            ['评分', e.communityScore != null
                ? (e.ratingCount != null ? `${e.communityScore} · ${e.ratingCount.toLocaleString()} 人评价` : String(e.communityScore))
                : ''],
        ]
        : [
            ['类型', `${ENTRY_TYPE_LABELS[e.type]}${e.genres.length ? ` · ${e.genres.join(' / ')}` : ''}`],
            ['作者', creatorOf(e) ?? ''],
            [novel ? '上架年' : '年份', e.year ? String(e.year) : ''],
            ['来源', sourceLinkText(e)],
            ['大众评分', e.communityScore != null ? String(e.communityScore) : ''],
            ['个人评分', `${starString(e.rating)}（${e.rating}/5）`],
        ];
    if (e.type === 'book') {
        // 🔴 #444g 漫画：**画师单列一行**（与「作者」行分开 —— 作者 = 原作 / 编剧，画师 = 作画）
        if (e.artist) rows.push(['画师', e.artist]);
        if (!novel) {
            if (e.translator) rows.push(['译者', e.translator]);
            if (e.publisher) rows.push(['出版社', e.publisher]);
            if (e.producer) rows.push(['出品方', e.producer]);
            if (e.isbn) rows.push(['ISBN', e.isbn]);
        }
        // 页数 = 元数据（豆瓣实体书）优先，旧数据回退进度基准 totalPage；同一字段按子分类换名呈现：
        //   文学 → 页数 ｜ 网文 → 章数 ｜ 漫画 → 话数（🔴 #445 加回「总话数」框后，漫画这条才有落库值）
        const bookKind = normalizeBookKind(e.bookKind);
        const pagesLabel = bookKind === 'comic' ? '话数' : (novel ? '章数' : '页数');
        const bookPages = e.pageCount ?? e.readingProgress?.totalPage;
        if (bookPages) rows.push([pagesLabel, String(bookPages)]);
        if (!novel) {
            if (e.binding) rows.push(['装帧', e.binding]);
            if (e.price) rows.push(['定价', e.price]);
        }
    } else if (e.type === 'game') {
        if (e.platform) rows.push(['平台', e.platform]);
        if (e.playtimeMinutes) rows.push(['时长', `${Math.round(e.playtimeMinutes / 60)}h`]);
    } else {
        if (e.type === 'anime' && e.developer) rows.push(['制作公司', e.developer]);
        if (e.screenwriter?.length) rows.push(['编剧', e.screenwriter.join(' / ')]);
        if (e.cast.length) rows.push([e.type === 'anime' ? '声优' : '主演', e.cast.join(' / ')]);
        if (e.country) rows.push(['制片国家/地区', e.country]);
        if (e.language) rows.push(['语言', e.language]);
        if (e.durationMin) rows.push(['片长', `${e.durationMin} 分钟`]);
        if (e.aliases?.length) rows.push(['又名', e.aliases.join(' / ')]);
        if ((e.type === 'tv' || e.type === 'anime') && e.progress) {
            const p = e.progress;
            rows.push(['进度', p.totalEpisodes ? `S${p.season}E${p.episode}/${p.totalEpisodes}` : `S${p.season}E${p.episode}`]);
        }
    }
    // ── 系列 / 系列序号（#434 建立 · #435 二轮修正）────────────────────────────
    // 🔴 **所有类型都必须能在属性表里看到它，而且序号要并进同一行**。
    //   用户原话：「条目里填写了系列名称和系列序号也**根本更新不了笔记条目**」——
    //   全链（表单 → catalog → 生成 → 写盘）本来是通的，**断在属性表这两处覆盖缺口上**：
    //   ① 🔴 **网文一行都没有** —— 原实现把系列整条按 2026-09-13 裁定归为「出版侧字段」（对网文不渲染），
    //      而 `series` 自 #434 起**已不是「丛书」那个出版侧概念**：它是**通用系列**（海报墙靠它成组，
    //      「斗罗大陆」「龙族」这类网文恰恰最需要）⇒ 网文补一行**「系列」**（⛔ 不改「丛书」那条裁定本身）。
    //   ② 🔴 **书籍的序号丢了** —— 原书籍侧裸写 `e.series`，用户填的「系列序号」在笔记里根本看不见。
    // ⚠️ 标签保留既有的不对称：**文学走「丛书」、其余（含网文）走「系列」**（#434 已记这是已知不对称）；
    //   本批只补**覆盖 + 序号**，⛔ 不动已定稿的「丛书」文案。
    // ⚠️ 序号 `undefined` ⇒ 只有名字（⛔ 不写「· 第 undefined 部」）；小数照原样（`第 1.5 部`）。
    if (e.series) {
        const idx = seriesIndexValue(e);
        const seriesText = idx === undefined ? e.series : `${e.series} · 第 ${idx} 部`;
        // ⛔ 只在这里出这一行，别在 book 分支里再补一次（两处各写一套必然漂移）
        rows.push([e.type === 'book' && !novel ? '丛书' : '系列', seriesText]);
    }
    // 属性表格（设置页「笔记表格」开关可整块关掉；关掉时 rows 仍照算——上面的字段收集与下面表格
    // 输出同源，避免开关另开一条分支）
    if (withTable) {
        s.push('| 属性 | 内容 |');
        s.push('|:-----|:-----|');
        if (e.type === 'music') {
            // 音乐四行按 key 显示宽度补空格对齐（发行年 3 全角最宽）
            const target = Math.max(...rows.map(([k]) => displayWidth(k))) + 1;
            for (const [k, v] of rows) s.push(`| ${k}${' '.repeat(Math.max(0, target - displayWidth(k)))}| ${v} |`);
        } else {
            for (const [k, v] of rows) s.push(`| ${k} | ${v} |`);
        }
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

    // 音乐 lrc 块已上移到笔记开头（#404，见上方「## 歌词」小节）—— ⛔ 别在这里再写一份。
    // 游戏游玩记录（catalog 明细的展示副本，日期倒序；由模板生成，重写笔记时随模板更新）
    if (e.type === 'game' && e.playSessions?.length) {
        s.push('## 游玩记录');
        s.push('');
        const sorted = [...e.playSessions].sort((a, b) => b.date.localeCompare(a.date));
        for (const ps of sorted) {
            s.push(`- **${ps.date}** · ${formatPlaytime(ps.minutes)}${ps.note ? ` · ${ps.note}` : ''}`);
        }
        s.push('');
    }
    // 音乐无观看/相关链接章节（本地音频已在 lrc 块声明，网络地址随条目保存但不在笔记渲染）
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
