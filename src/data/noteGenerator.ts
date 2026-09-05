// 详情笔记生成（纯逻辑，可单测）
import type { MediaEntry } from 'data/types';
import { ENTRY_TYPE_LABELS } from 'data/types';
import { starString } from 'pure/rating';
import { formatPlaytime } from 'pure/playtime';

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

/** 生成 frontmatter（YAML：字符串字段加引号防特殊字符破坏） */
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
    if (e.translator) lines.push(`translator: ${q(e.translator)}`);
    if (e.publisher) lines.push(`publisher: ${q(e.publisher)}`);
    if (e.producer) lines.push(`producer: ${q(e.producer)}`);
    if (e.isbn) lines.push(`isbn: ${q(e.isbn)}`);
    if (e.binding) lines.push(`binding: ${q(e.binding)}`);
    if (e.price) lines.push(`price: ${q(e.price)}`);
    if (e.series) lines.push(`series: ${q(e.series)}`);
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
    if (e.type === 'book' && e.pageCount) lines.push(`page_count: ${e.pageCount}`); // 元数据页数（豆瓣实体书，仅展示/统计）
    if (e.type === 'game' && e.playtimeMinutes) lines.push(`playtime_minutes: ${e.playtimeMinutes}`);
    lines.push('---');
    return lines.join('\n');
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

/** 数据源标识 → 中文名（笔记「来源」行） */
const SOURCE_LABELS: Record<string, string> = {
    douban: '豆瓣',
    tmdb: 'TMDB',
    google: 'Google Books',
    openlibrary: 'Open Library',
    bangumi: 'Bangumi',
};

/** 来源行链接：优先数据源官方页（搜索回填自动记录），回退手动添加的第一个观看链接 */
function sourceLinkText(e: MediaEntry): string {
    if (e.sourceUrl) {
        const label = SOURCE_LABELS[e.source ?? ''] ?? e.source ?? '来源';
        return `[${label}](${e.sourceUrl})`;
    }
    if (e.links.length > 0) return `[${e.links[0].label}](${e.links[0].url})`;
    return '';
}

/** 生成详情笔记 Markdown 全文（bookinfo callout + 属性表格 + 评语 + 链接） */
export function generateNoteMarkdown(e: MediaEntry, libraryDir: string = 'ReelLudic'): string {
    const s: string[] = [];
    // 顶部 bookinfo callout：书名 + 封面（默认展开）。封面用 posterEmbed：豆瓣 URL → HTML img（防盗链），
    // 其余 → markdown 图片；本地路径 → wikilink
    s.push(`> [!bookinfo]+ ${e.type === 'music' ? `**《 ${e.title} 》**` : `**《${e.title}》**`}`);
    const embed = posterEmbed(e, libraryDir);
    if (embed) {
        s.push('>');
        s.push(`> ${embed}`);
    }
    s.push('>');

    // 属性表格：固定行 类型/作者/年份/来源/评分 + 有值附加行（保留豆瓣适配的完整字段）
    // 音乐四行（作者/发行年/来源/评分），不参与影视/书籍附加行
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
            ['年份', e.year ? String(e.year) : ''],
            ['来源', sourceLinkText(e)],
            ['大众评分', e.communityScore != null ? String(e.communityScore) : ''],
            ['个人评分', `${starString(e.rating)}（${e.rating}/5）`],
        ];
    if (e.type === 'book') {
        if (e.translator) rows.push(['译者', e.translator]);
        if (e.publisher) rows.push(['出版社', e.publisher]);
        if (e.producer) rows.push(['出品方', e.producer]);
        if (e.isbn) rows.push(['ISBN', e.isbn]);
        // 页数 = 元数据（豆瓣实体书）优先，旧数据回退进度基准 totalPage
        const bookPages = e.pageCount ?? e.readingProgress?.totalPage;
        if (bookPages) rows.push(['页数', String(bookPages)]);
        if (e.binding) rows.push(['装帧', e.binding]);
        if (e.price) rows.push(['定价', e.price]);
        if (e.series) rows.push(['丛书', e.series]);
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
    if (e.type === 'book' && e.toc?.trim()) {
        s.push('## 目录');
        s.push('');
        s.push(e.toc.trim());
        s.push('');
    }

    s.push(e.type === 'music' ? '# 个人评语' : '## 个人评语');
    s.push('');
    // 表单提交的评语（e.notes）写入笔记正文；为空时保留占位符提示
    s.push(e.notes.trim() ? e.notes : '（在这里写下你的感想，支持 [[双链]]）');
    s.push('');

    // 音乐 lrc 块（LyricFlux 播放器，置于简介/评语之后）：有 audioPath 才生成——
    // vault 相对路径用 wiki 链接，库外绝对路径原样
    if (e.type === 'music' && e.audioPath) {
        const srcLine = /^[A-Za-z]:[\\/]|^\/\//.test(e.audioPath) || e.audioPath.startsWith('/')
            ? `source ${e.audioPath}`
            : `source [[${e.audioPath}]]`;
        s.push('```lrc');
        s.push(srcLine);
        s.push('```');
        s.push('');
    }
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
        if (e.links.length) {
            e.links.forEach((l) => s.push(`- [${l.label}](${l.url})`));
        } else {
            s.push('（暂无链接）');
        }
        s.push('');
    }
    return s.join('\n');
}

/** 条目笔记在 vault 内的路径：按类型分子目录（笔记/电影/、笔记/电视剧/…，v0.4 中文化），各类型互不混杂 */
export function entryNotePath(e: MediaEntry, baseDir: string = 'ReelLudic/笔记'): string {
    return `${baseDir}/${ENTRY_TYPE_LABELS[e.type]}/${safeFilename(e.title)}.md`;
}
