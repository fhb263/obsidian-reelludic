// 年度总结生成（纯逻辑，无 obsidian 依赖，可单测）
// 全量内容：概览计数 + 四库 Top5 + 月度分布 + 完整双链清单
import type { EntryType, MediaEntry } from 'data/types';
import { finishedInYear, monthlyFinished, topRatedInYear } from 'pure/stats';
import { starString } from 'pure/rating';

export interface YearReportOptions {
    year: number;
    entries: MediaEntry[];
    /** 书籍摘抄计数（可选，缺省不计） */
    excerptCounts?: Record<string, number>;
}

function fmtHours(minutes: number): string {
    if (!minutes) return '0h';
    const h = minutes / 60;
    return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

/** 生成年度总结 Markdown（frontmatter + 概览 + Top榜 + 月度 + 双链清单） */
export function generateYearReport(opts: YearReportOptions): string {
    const { year, entries, excerptCounts = {} } = opts;
    const isMedia = (t: EntryType) => t === 'movie' || t === 'tv' || t === 'anime';
    const media = entries.filter((e) => isMedia(e.type));
    const books = entries.filter((e) => e.type === 'book');
    const games = entries.filter((e) => e.type === 'game');
    const musics = entries.filter((e) => e.type === 'music');
    const mediaF = media.filter((e) => finishedInYear(e, year));
    const booksF = books.filter((e) => finishedInYear(e, year));
    const gamesF = games.filter((e) => finishedInYear(e, year));
    const musicsF = musics.filter((e) => finishedInYear(e, year));
    // 页数口径：元数据 pageCount（豆瓣实体书）优先，旧数据回退进度基准 totalPage
    const bookPages = booksF.reduce((s, e) => s + (e.pageCount ?? e.readingProgress?.totalPage ?? 0), 0);
    const bookExcerpts = booksF.reduce((s, e) => s + (excerptCounts[e.id] ?? 0), 0);
    const playMinutes = gamesF.reduce((s, e) => s + (e.playtimeMinutes ?? 0), 0);
    const playSessions = gamesF.reduce((s, e) => s + (e.playSessions?.length ?? 0), 0);
    const musicMinutes = musicsF.reduce((s, e) => s + (e.durationMin ?? 0), 0);

    const lines: string[] = [];
    lines.push('---');
    lines.push('type: yearly-report');
    lines.push(`year: ${year}`);
    lines.push('---');
    lines.push('');
    lines.push(`# ${year} 年度总结`);
    lines.push('');
    lines.push(`> 由 ReelLudic 生成 · ${year} 年收藏回顾`);
    lines.push('');

    // 一、年度概览
    lines.push('## 一、年度概览');
    lines.push('');
    lines.push(`- 🎬 影视：看完 **${mediaF.length}** 部（电影 ${mediaF.filter((e) => e.type === 'movie').length} · 剧集 ${mediaF.filter((e) => e.type === 'tv').length} · 动画 ${mediaF.filter((e) => e.type === 'anime').length}）`);
    lines.push(`- 📚 书籍：读完 **${booksF.length}** 本 · 累计 **${bookPages}** 页${bookExcerpts ? ` · 摘抄 **${bookExcerpts}** 条` : ''}`);
    lines.push(`- 🎮 游戏：通关 **${gamesF.length}** 个 · 游玩 **${fmtHours(playMinutes)}**${playSessions ? ` · 记录 **${playSessions}** 条` : ''}`);
    lines.push(`- 🎵 音乐：已听 **${musicsF.length}** 首${musicMinutes ? ` · 时长 **${fmtHours(musicMinutes)}**` : ''}`);
    lines.push('');

    // 二、Top 评分榜（各库 Top5）
    lines.push('## 二、Top 评分榜');
    lines.push('');
    const topSections: [string, MediaEntry[]][] = [
        ['影视', topRatedInYear(media, year, 5)],
        ['书籍', topRatedInYear(books, year, 5)],
        ['游戏', topRatedInYear(games, year, 5)],
        ['音乐', topRatedInYear(musics, year, 5)],
    ];
    for (const [name, top] of topSections) {
        lines.push(`### ${name}`);
        lines.push('');
        if (top.length === 0) {
            lines.push(`本年暂无${name}评分记录。`);
        } else {
            for (const t of top) lines.push(`- ${starString(t.rating)} **[[${t.title}]]**${t.year ? `（${t.year}）` : ''}`);
        }
        lines.push('');
    }

    // 三、月度分布
    lines.push('## 三、月度节奏');
    lines.push('');
    lines.push(`| 月份 | 影视 | 书籍 | 游戏 | 音乐 |`);
    lines.push(`|------|------|------|------|------|`);
    const mf = [monthlyFinished(media, year), monthlyFinished(books, year), monthlyFinished(games, year), monthlyFinished(musics, year)];
    for (let m = 0; m < 12; m++) {
        const label = `${m + 1}月`;
        lines.push(`| ${label} | ${mf[0][m]} | ${mf[1][m]} | ${mf[2][m]} | ${mf[3][m]} |`);
    }
    lines.push('');

    // 四、完整清单（双链）
    lines.push('## 四、完整清单');
    lines.push('');
    lines.push(`> 本年看完/读完/通关/已听的全部条目，可直接双链引用。`);
    lines.push('');
    for (const [name, list] of [['影视', mediaF] as const, ['书籍', booksF] as const, ['游戏', gamesF] as const, ['音乐', musicsF] as const]) {
        lines.push(`### ${name}（${list.length}）`);
        lines.push('');
        if (list.length === 0) {
            lines.push(`本年暂无。`);
        } else {
            for (const t of list) lines.push(`- [[${t.title}]]${t.year ? `（${t.year}）` : ''}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/** 年度报告文件名（报告/YYYY-年度总结.md，v0.4 中文化） */
export function yearReportPath(year: number, baseDir = 'ReelLudic/报告'): string {
    return `${baseDir}/${year}-年度总结.md`;
}
