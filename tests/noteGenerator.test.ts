import { describe, it, expect } from 'vitest';
import { safeFilename, entryFrontmatter, generateNoteMarkdown, entryNotePath, posterEmbed, hashNoteContent } from 'data/noteGenerator';
import type { MediaEntry } from 'data/types';

function baseEntry(partial: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e1',
        type: 'tv',
        title: '进击的巨人 最终季',
        status: 'watching',
        rating: 4,
        year: 2020,
        genres: ['动画', '动作'],
        cast: ['梶裕贵'],
        links: [{ label: 'B站', url: 'https://www.bilibili.com/bangumi/123' }],
        notes: '',
        tags: [],
        progress: { season: 4, episode: 16, history: [] },
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
        ...partial,
    };
}

describe('safeFilename', () => {
    it('剔除非法文件名字符', () => {
        expect(safeFilename('沙丘2: Part Two')).not.toContain(':');
        expect(safeFilename('a/b\\c*d?e')).not.toMatch(/[\\/:*?"<>|]/);
    });

    it('空标题回退「未命名」', () => {
        expect(safeFilename('')).toBe('未命名');
        expect(safeFilename('   ')).toBe('未命名');
    });
});

describe('entryFrontmatter', () => {
    it('包含核心字段', () => {
        const fm = entryFrontmatter(baseEntry());
        expect(fm).toContain('id: "e1"');
        expect(fm).toContain('type: tv');
        expect(fm).toContain('title:');
        expect(fm).toContain('status: watching');
        expect(fm).toContain('rating: 4');
        expect(fm).toContain('year: 2020');
    });

    it('剧集输出进度行，电影不输出', () => {
        const tv = entryFrontmatter(baseEntry());
        expect(tv).toContain('progress_season: 4');
        expect(tv).toContain('progress_episode: 16');
        const movie = entryFrontmatter(baseEntry({ type: 'movie', progress: undefined, watchedDate: '2024-03-08' }));
        expect(movie).not.toContain('progress_season');
        expect(movie).toContain('watched_date: "2024-03-08"');
    });

    it('想看条目输出计划观看日期 planned_date，无值不输出', () => {
        const fm = entryFrontmatter(baseEntry({ plannedDate: '2026-09-01' }));
        expect(fm).toContain('planned_date: "2026-09-01"');
        expect(entryFrontmatter(baseEntry())).not.toContain('planned_date');
    });

    it('剧集总集数/书籍阅读进度/游戏时长 frontmatter 输出，无值不输出', () => {
        const tv = entryFrontmatter(baseEntry({ progress: { season: 2, episode: 12, totalEpisodes: 24, history: [] } }));
        expect(tv).toContain('progress_total_episodes: 24');
        const book = entryFrontmatter(baseEntry({ type: 'book', readingProgress: { page: 123, totalPage: 456 } }));
        expect(book).toContain('reading_page: 123');
        expect(book).toContain('reading_total_page: 456');
        const game = entryFrontmatter(baseEntry({ type: 'game', playtimeMinutes: 720 }));
        expect(game).toContain('playtime_minutes: 720');
        expect(entryFrontmatter(baseEntry())).not.toContain('reading_page');
        expect(entryFrontmatter(baseEntry())).not.toContain('playtime_minutes');
    });

    it('标题含特殊字符时安全引用', () => {
        const fm = entryFrontmatter(baseEntry({ title: '沙丘2: Part Two' }));
        expect(fm).toContain('"沙丘2: Part Two"');
    });

    it('音乐 frontmatter 输出 album；无值不输出', () => {
        const fm = entryFrontmatter({ id: 'e_1', type: 'music', title: '不再犹豫', status: 'want', rating: 0, album: '犹豫', genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '' });
        expect(fm).toContain('album: "犹豫"');
        const fm2 = entryFrontmatter({ id: 'e_1', type: 'music', title: 'x', status: 'want', rating: 0, genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '' });
        expect(fm2).not.toContain('album:');
    });
});

describe('generateNoteMarkdown', () => {
    it('生成 bookinfo callout + 属性表格 + 章节结构', () => {
        const md = generateNoteMarkdown(baseEntry());
        expect(md).toContain('> [!bookinfo]+ **《进击的巨人 最终季》**');
        expect(md).toContain('| 属性 | 内容 |');
        expect(md).toContain('## 个人评语');
        expect(md).toContain('## 观看链接');
        expect(md).toContain('[[双链]]');
        // 无封面时不输出封面行，callout 仅标题 + 结束符
        expect(md).not.toContain('![封面](');
    });

    it('简介：有值输出「## 简介」章节（属性表格后、个人评语前），无值不输出', () => {
        const withSummary = generateNoteMarkdown(baseEntry({ summary: '人类为了自由与巨人战斗。' }));
        expect(withSummary).toContain('## 简介');
        expect(withSummary).toContain('人类为了自由与巨人战斗。');
        expect(withSummary.indexOf('## 简介')).toBeGreaterThan(withSummary.indexOf('| 属性 | 内容 |'));
        expect(withSummary.indexOf('## 简介')).toBeLessThan(withSummary.indexOf('## 个人评语'));
        // 无简介不生成该章节
        expect(generateNoteMarkdown(baseEntry())).not.toContain('## 简介');
    });

    it('图书笔记：内容简介/作者简介/目录 独立小标题（豆瓣回填字段），无值不输出', () => {
        const md = generateNoteMarkdown(
            baseEntry({ type: 'book', summary: '地球往事三部曲', authorIntro: '刘慈欣，科幻作家。', toc: '第一章 科学边界', director: undefined, cast: [], progress: undefined }),
        );
        expect(md).toContain('## 内容简介');
        expect(md).toContain('地球往事三部曲');
        expect(md).toContain('## 作者简介');
        expect(md).toContain('刘慈欣，科幻作家。');
        expect(md).toContain('## 目录');
        expect(md).toContain('第一章 科学边界');
        // 章节顺序：内容简介 → 作者简介 → 目录 → 个人评语
        expect(md.indexOf('## 内容简介')).toBeLessThan(md.indexOf('## 作者简介'));
        expect(md.indexOf('## 作者简介')).toBeLessThan(md.indexOf('## 目录'));
        expect(md.indexOf('## 目录')).toBeLessThan(md.indexOf('## 个人评语'));
        // 图书缺字段不渲染对应小节；影视仍用「## 简介」不误加图书小节
        const bare = generateNoteMarkdown(baseEntry({ type: 'book', director: undefined, cast: [], progress: undefined }));
        expect(bare).not.toContain('## 内容简介');
        expect(bare).not.toContain('## 作者简介');
        expect(bare).not.toContain('## 目录');
        const movie = generateNoteMarkdown(baseEntry({ type: 'movie', summary: 'x', progress: undefined }));
        expect(movie).toContain('## 简介');
        expect(movie).not.toContain('## 作者简介');
    });

    it('封面 banner：frontmatter 输出 banner，正文标题前嵌入封面（URL 直用/本地 wikilink）', () => {
        const urlEntry = baseEntry({ poster: 'https://img.example.com/poster.jpg' });
        expect(entryFrontmatter(urlEntry)).toContain('banner: "https://img.example.com/poster.jpg"');
        expect(generateNoteMarkdown(urlEntry)).toContain('![封面](https://img.example.com/poster.jpg)');

        const localEntry = baseEntry({ poster: '封面/e_123.jpg' });
        expect(entryFrontmatter(localEntry)).toContain('banner: "ReelLudic/封面/e_123.jpg"');
        const md = generateNoteMarkdown(localEntry);
        expect(md).toContain('![[ReelLudic/封面/e_123.jpg]]');
        // 自定义库目录时按实际目录拼接
        expect(generateNoteMarkdown(localEntry, 'MyLib')).toContain('![[MyLib/封面/e_123.jpg]]');

        // 无 poster 不输出 banner 与嵌入
        const noPoster = generateNoteMarkdown(baseEntry({ poster: undefined }));
        expect(noPoster).not.toContain('![[ReelLudic');
        expect(entryFrontmatter(baseEntry({ poster: undefined }))).not.toContain('banner:');
    });

    it('豆瓣图床封面：banner 用内联 HTML img 强制携带 Referer（防盗链 418）', () => {
        const dbEntry = baseEntry({ poster: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2687443734.jpg' });
        const md = generateNoteMarkdown(dbEntry);
        expect(md).toContain('<img src="https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2687443734.jpg" alt="封面" referrerpolicy="unsafe-url">');
        expect(md).not.toContain('![封面](');
        // 非豆瓣 URL 仍用 markdown 图片
        expect(posterEmbed(baseEntry({ poster: 'https://img.example.com/x.jpg' }))).toBe('![封面](https://img.example.com/x.jpg)');
    });

    it('个人评语写入正文：有值输出评语、无值保留占位符（表单提交的 notes 必须落笔）', () => {
        const withNotes = generateNoteMarkdown(baseEntry({ notes: '神作，节奏完美。\n第二段感想。' }));
        expect(withNotes).toContain('神作，节奏完美。');
        expect(withNotes).toContain('第二段感想。');
        expect(withNotes).not.toContain('（在这里写下你的感想');
        const empty = generateNoteMarkdown(baseEntry({ notes: '' }));
        expect(empty).toContain('（在这里写下你的感想，支持 [[双链]]）');
    });

    it('评分/进度渲染进表格', () => {
        const md = generateNoteMarkdown(baseEntry());
        expect(md).toContain('★★★★☆');
        expect(md).toContain('S4E16');
        expect(md).toContain('| 个人评分 | ★★★★☆（4/5） |');
        expect(md).toContain('| 进度 | S4E16 |');
    });

    it('链接渲染：表格来源行 + 观看链接列表', () => {
        const md = generateNoteMarkdown(baseEntry());
        expect(md).toContain('[B站](https://www.bilibili.com/bangumi/123)');
    });

    it('来源行跟随数据源自动链接：优先 sourceUrl，回退手动链接', () => {
        // 豆瓣兜底：来源 = 豆瓣官方页
        const douban = generateNoteMarkdown(
            baseEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/3001114/' }),
        );
        expect(douban).toContain('| 来源 | [豆瓣](https://movie.douban.com/subject/3001114/) |');

        // 主源：TMDB / Google Books
        const tmdb = generateNoteMarkdown(
            baseEntry({ type: 'movie', source: 'tmdb', sourceUrl: 'https://www.themoviedb.org/movie/438631' }),
        );
        expect(tmdb).toContain('| 来源 | [TMDB](https://www.themoviedb.org/movie/438631) |');
        const google = generateNoteMarkdown(
            baseEntry({ type: 'book', source: 'google', sourceUrl: 'https://books.google.com/books?id=abc' }),
        );
        expect(google).toContain('| 来源 | [Google Books](https://books.google.com/books?id=abc) |');

        // 无 sourceUrl：回退手动观看链接
        const fallback = generateNoteMarkdown(baseEntry());
        expect(fallback).toContain('| 来源 | [B站](https://www.bilibili.com/bangumi/123) |');

        // 都无：留空
        const none = generateNoteMarkdown(baseEntry({ sourceUrl: undefined, links: [] }));
        expect(none).toContain('| 来源 |  |');
    });

    it('动画类型输出进度', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'anime' }));
        expect(md).toContain('S4E16');
    });

    it('书籍类型渲染作者/出版社，无进度行，链接区用相关链接', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', author: '刘慈欣', publisher: '重庆出版社', director: undefined, cast: [], progress: undefined }));
        expect(md).toContain('| 作者 | 刘慈欣 |');
        expect(md).toContain('| 出版社 | 重庆出版社 |');
        expect(md).toContain('## 相关链接');
        expect(md).not.toContain('## 观看链接');
        expect(md).not.toContain('S4E16');
    });

    it('游戏类型渲染平台/开发商（作者行=开发商）', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'game', platform: 'PC', developer: 'CD Projekt Red', director: undefined, cast: [], progress: undefined, status: 'watched' }));
        expect(md).toContain('| 作者 | CD Projekt Red |');
        expect(md).toContain('| 平台 | PC |');
    });

    it('书籍/游戏 frontmatter 输出专属字段', () => {
        const fm = entryFrontmatter(baseEntry({ type: 'book', author: '刘慈欣', publisher: '重庆出版社' }));
        expect(fm).toContain('author: "刘慈欣"');
        expect(fm).toContain('publisher: "重庆出版社"');
        const gfm = entryFrontmatter(baseEntry({ type: 'game', platform: 'PC', developer: 'CDPR' }));
        expect(gfm).toContain('platform: "PC"');
        expect(gfm).toContain('developer: "CDPR"');
    });

    it('豆瓣适配字段：影视/书籍新字段按有值输出、无值不输出', () => {
        const fm = entryFrontmatter(
            baseEntry({
                type: 'movie',
                director: '丹尼斯·维伦纽瓦',
                screenwriter: ['丹尼斯·维伦纽瓦', '乔·斯派茨'],
                country: '美国',
                language: '英语 / 汉语普通话',
                durationMin: 156,
                aliases: ['沙丘瀚战(港)', 'Dune: Part One'],
            }),
        );
        expect(fm).toContain('director: "丹尼斯·维伦纽瓦"');
        expect(fm).toContain('screenwriter: ["丹尼斯·维伦纽瓦", "乔·斯派茨"]');
        expect(fm).toContain('country: "美国"');
        expect(fm).toContain('language: "英语 / 汉语普通话"');
        expect(fm).toContain('duration_min: 156');
        expect(fm).toContain('aliases: ["沙丘瀚战(港)", "Dune: Part One"]');

        const bfm = entryFrontmatter(
            baseEntry({
                type: 'book',
                author: '渡边淳一',
                translator: '之乎',
                publisher: '青岛出版社',
                producer: '某出品',
                isbn: '9787555218296',
                binding: '平装',
                price: '39.00元',
                series: '渡边淳一作品',
            }),
        );
        expect(bfm).toContain('author: "渡边淳一"');
        expect(bfm).toContain('translator: "之乎"');
        expect(bfm).toContain('publisher: "青岛出版社"');
        expect(bfm).toContain('producer: "某出品"');
        expect(bfm).toContain('isbn: "9787555218296"');
        expect(bfm).toContain('binding: "平装"');
        expect(bfm).toContain('price: "39.00元"');
        expect(bfm).toContain('series: "渡边淳一作品"');

        // 无值不输出
        const plain = entryFrontmatter(baseEntry({ type: 'movie' }));
        expect(plain).not.toContain('screenwriter');
        expect(plain).not.toContain('country:');
        expect(plain).not.toContain('duration_min');
        expect(plain).not.toContain('translator');
        expect(plain).not.toContain('isbn');
    });

    it('笔记正文基本信息区输出新字段（编剧/国家/语言/片长/又名/译者/ISBN）', () => {
        const md = generateNoteMarkdown(
            baseEntry({
                type: 'movie',
                director: '丹尼斯·维伦纽瓦',
                screenwriter: ['丹尼斯·维伦纽瓦', '乔·斯派茨'],
                country: '美国',
                language: '英语',
                durationMin: 156,
                aliases: ['沙丘瀚战(港)'],
                cast: ['提莫西·查拉梅'],
            }),
        );
        expect(md).toContain('| 作者 | 丹尼斯·维伦纽瓦 |');
        expect(md).toContain('| 编剧 | 丹尼斯·维伦纽瓦 / 乔·斯派茨 |');
        expect(md).toContain('| 制片国家/地区 | 美国 |');
        expect(md).toContain('| 语言 | 英语 |');
        expect(md).toContain('| 片长 | 156 分钟 |');
        expect(md).toContain('| 又名 | 沙丘瀚战(港) |');

        const bmd = generateNoteMarkdown(
            baseEntry({
                type: 'book',
                author: '渡边淳一',
                translator: '之乎',
                publisher: '青岛出版社',
                isbn: '9787555218296',
                binding: '平装',
                price: '39.00元',
                series: '渡边淳一作品',
                readingProgress: { totalPage: 340 },
            }),
        );
        expect(bmd).toContain('| 作者 | 渡边淳一 |');
        expect(bmd).toContain('| 译者 | 之乎 |');
        expect(bmd).toContain('| 出版社 | 青岛出版社 |');
        expect(bmd).toContain('| ISBN | 9787555218296 |');
        expect(bmd).toContain('| 装帧 | 平装 |');
        expect(bmd).toContain('| 定价 | 39.00元 |');
        expect(bmd).toContain('| 丛书 | 渡边淳一作品 |');
        expect(bmd).toContain('| 页数 | 340 |');
    });

    it('音乐笔记：callout 四行表格（作者/发行年/来源/评分带人数）+ lrc 块 + # 个人评语', () => {
        const e: MediaEntry = {
            id: 'e_1', type: 'music', title: '不再犹豫', status: 'want', rating: 0,
            year: 1991, author: 'BEYOND', album: '犹豫',
            communityScore: 9.7, ratingCount: 127431,
            source: 'douban', sourceUrl: 'https://music.douban.com/subject/4899751/',
            audioPath: 'ReelLudic/music/不再犹豫.mp3', poster: 'ReelLudic/covers/m1.jpg',
            genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '',
        };
        const md = generateNoteMarkdown(e);
        expect(md).toContain('> [!bookinfo]+ **《 不再犹豫 》**');
        expect(md).toContain('| 作者   | BEYOND');
        expect(md).toContain('| 发行年 | 1991');
        expect(md).toContain('| 来源   | [豆瓣](https://music.douban.com/subject/4899751/)');
        expect(md).toContain('| 评分   | 9.7 · 127,431 人评价');
        expect(md).toContain('```lrc');
        expect(md).toContain('source [[ReelLudic/music/不再犹豫.mp3]]');
        expect(md).toContain('# 个人评语');
        // 顺序：lrc 块在简介与个人评语之后；音乐无观看链接章节
        expect(md.indexOf('```lrc')).toBeGreaterThan(md.indexOf('# 个人评语'));
        expect(md.indexOf('# 个人评语')).toBeGreaterThan(md.indexOf('## 简介'));
        expect(md).not.toContain('## 观看链接');
        expect(md).not.toContain('## 相关链接');
        // 无音频不生成 lrc 块
        const md2 = generateNoteMarkdown({ ...e, audioPath: undefined });
        expect(md2).not.toContain('```lrc');
    });
});

describe('hashNoteContent 内容指纹', () => {
    it('确定性：相同内容同 hash', () => {
        expect(hashNoteContent('---\ntitle: 三体\n---\n内容')).toBe(hashNoteContent('---\ntitle: 三体\n---\n内容'));
    });

    it('不同内容不同 hash（外部修改可检出）', () => {
        expect(hashNoteContent('个人评语：好看')).not.toBe(hashNoteContent('个人评语：好看，且震撼'));
    });

    it('空内容有稳定 hash', () => {
        expect(hashNoteContent('')).toBe(hashNoteContent(''));
        expect(hashNoteContent('')).toBeTruthy();
    });
});

describe('entryNotePath', () => {
    it('按类型中文子目录生成 .md 路径（v0.4 中文化）', () => {
        expect(entryNotePath(baseEntry())).toBe('ReelLudic/笔记/电视剧/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'movie' }))).toBe('ReelLudic/笔记/电影/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'book' }))).toBe('ReelLudic/笔记/书籍/进击的巨人 最终季.md');
    });
});

describe('generateNoteMarkdown 游戏游玩记录', () => {
    it('游戏含游玩记录 → 生成「游玩记录」章节（日期倒序 + 时长 + 心得）', () => {
        const game = baseEntry({
            type: 'game',
            title: '黑神话悟空',
            playtimeMinutes: 195,
            playSessions: [
                { date: '2026-08-01', minutes: 45, note: '刚打过虎先锋' },
                { date: '2026-08-02', minutes: 90 },
                { date: '2026-08-03', minutes: 60, note: '黄风岭' },
            ],
        });
        const md = generateNoteMarkdown(game);
        expect(md).toContain('## 游玩记录');
        // 日期倒序：08-03 在前、08-01 在后
        expect(md.indexOf('2026-08-03')).toBeLessThan(md.indexOf('2026-08-01'));
        // 时长格式（统一小时制）：0.8h / 1.5h / 1h
        expect(md).toContain('**2026-08-03** · 1h · 黄风岭');
        expect(md).toContain('**2026-08-02** · 1.5h');
        expect(md).toContain('**2026-08-01** · 0.8h · 刚打过虎先锋');
        // 位置：评语后、链接前
        expect(md.indexOf('## 游玩记录')).toBeGreaterThan(md.indexOf('## 个人评语'));
        expect(md.indexOf('## 游玩记录')).toBeLessThan(md.indexOf('## 相关链接'));
    });

    it('无游玩记录 → 不生成该章节', () => {
        const game = baseEntry({ type: 'game', title: '星露谷', playtimeMinutes: 60 });
        expect(generateNoteMarkdown(game)).not.toContain('## 游玩记录');
    });

    it('非游戏类型即使有 playSessions 也不生成', () => {
        const movie = baseEntry({ type: 'movie', playSessions: [{ date: '2026-08-01', minutes: 30 }] });
        expect(generateNoteMarkdown(movie)).not.toContain('## 游玩记录');
    });
});
