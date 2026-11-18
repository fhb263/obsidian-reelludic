import { describe, it, expect } from 'vitest';
import { safeFilename, entryFrontmatter, generateNoteMarkdown, entryNotePath, hashNoteContent, episodeWatchLines } from 'data/noteGenerator';
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

    // ── Dataview 对齐：tags / created / updated / progress_percent ──
    it('tags：类型键在前 + 自定义标签（去重保序）；无自定义标签时仍带类型键', () => {
        expect(entryFrontmatter(baseEntry({ tags: ['神作', '动画'] }))).toContain('tags: ["tv", "神作", "动画"]');
        expect(entryFrontmatter(baseEntry({ tags: ['tv', '神作'] }))).toContain('tags: ["tv", "神作"]'); // 与类型键重复去重
        expect(entryFrontmatter(baseEntry())).toContain('tags: ["tv"]'); // 类型键始终在，便于 FROM #tv
    });

    it('created / updated：ISO → 本地日期 YYYY-MM-DD', () => {
        const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0).toISOString();
        const fm = entryFrontmatter(baseEntry({ createdAt: iso(2026, 9, 10), updatedAt: iso(2026, 9, 11) }));
        expect(fm).toContain('created: 2026-09-10');
        expect(fm).toContain('updated: 2026-09-11');
    });

    it('created / updated 非法或缺失 → 不输出该行', () => {
        const fm = entryFrontmatter(baseEntry({ createdAt: '', updatedAt: 'not-a-date' }));
        expect(fm).not.toContain('created:');
        expect(fm).not.toContain('updated:');
    });

    it('progress_percent：书籍取 percent（回退 page/totalPage）、剧集按集数比；游戏/音乐不输出', () => {
        const book = entryFrontmatter(baseEntry({ type: 'book', readingProgress: { percent: 42.6 } }));
        expect(book).toContain('progress_percent: 43');
        const bookFallback = entryFrontmatter(baseEntry({ type: 'book', readingProgress: { page: 50, totalPage: 200 } }));
        expect(bookFallback).toContain('progress_percent: 25');
        const tv = entryFrontmatter(baseEntry({ progress: { season: 1, episode: 6, totalEpisodes: 24, history: [] } }));
        expect(tv).toContain('progress_percent: 25');
        expect(entryFrontmatter(baseEntry())).not.toContain('progress_percent'); // 无 totalEpisodes
        expect(entryFrontmatter(baseEntry({ type: 'game', playtimeMinutes: 60 }))).not.toContain('progress_percent');
    });

    it('音乐 frontmatter 输出 album；无值不输出', () => {
        const fm = entryFrontmatter({ id: 'e_1', type: 'music', title: '不再犹豫', status: 'want', rating: 0, album: '犹豫', genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '' });
        expect(fm).toContain('album: "犹豫"');
        const fm2 = entryFrontmatter({ id: 'e_1', type: 'music', title: 'x', status: 'want', rating: 0, genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '' });
        expect(fm2).not.toContain('album:');
    });
});

describe('#434 系列 / 系列序号', () => {
    it('frontmatter 的 series_index：`series` 与 `seriesIndex` **都有值**才写；孤立序号不写（防「有 index 没 series」的脏数据）', () => {
        expect(entryFrontmatter(baseEntry({ type: 'movie', series: '某系列', seriesIndex: 3 }))).toContain('series_index: 3');
        // 🔴 #443 翻面（2026-09-30）：序号锁定整数 ⇒ 2.5 落笔为 **3**（⛔ 别再期望 `series_index: 2.5`）
        expect(entryFrontmatter(baseEntry({ type: 'movie', series: '某系列', seriesIndex: 2.5 }))).toContain('series_index: 3');
        expect(entryFrontmatter(baseEntry({ type: 'movie', series: '某系列' }))).not.toContain('series_index');
        expect(entryFrontmatter(baseEntry({ type: 'movie', seriesIndex: 3 }))).not.toContain('series_index');
        // 类型不门控：frontmatter 是机器读的，海报墙的系列分组对全部 6 类型生效
        expect(entryFrontmatter(baseEntry({ type: 'game', series: '某系列', seriesIndex: 1 }))).toContain('series_index: 1');
    });

    it('🔴 2026-11-14 m04138：系列行不再写进笔记正文（改由条目卡按字段投影），frontmatter 仍写 series_index', () => {
        // 🔴 翻面：旧断言锚 `| 系列 | … |` 表格行；表格已被能力块取代 ⇒ 正文里不该再有这些行。
        //    系列是否出现由 `pure/noteCard.buildNoteCardGroups` 的 `series` 行承载（见 noteCard.test.ts）。
        expect(generateNoteMarkdown(baseEntry({ type: 'movie', series: '某系列', seriesIndex: 3 }), 'ReelLudic', { table: true }))
            .not.toContain('| 系列 |');
        // frontmatter 侧一个字都不能少（机器读的那份是 Dataview/海报墙的真源）
        expect(entryFrontmatter(baseEntry({ type: 'movie', series: '某系列', seriesIndex: 3 }))).toContain('series_index: 3');
        expect(entryFrontmatter(baseEntry({ type: 'movie', series: '某系列', seriesIndex: 3 }))).toContain('series: "某系列"');
    });
});

describe('generateNoteMarkdown', () => {    it('生成条目卡代码块 + 章节结构（🔴 m07593：顶部 callout 已删除）', () => {
        const md = generateNoteMarkdown(baseEntry());
        // 🔴 2026-11-14 m07593：顶部 `> [!bookinfo]+` callout **整体删除**（封面改由条目卡组件内嵌显示）
        expect(md).not.toContain('> [!bookinfo]+');
        expect(md).not.toContain('**《进击的巨人 最终季》**');
        // 🔴 2026-11-14 m04138：属性表格 → ` ```reelludic ` 条目卡（块里只有条目 id 一行）
        expect(md).toContain('```reelludic');
        expect(md).toContain('e1');
        expect(md).not.toContain('| 属性 | 内容 |');
        expect(md).toContain('## 个人评语');
        expect(md).toContain('## 观看链接');
        // 🔴 #453 **翻面**：这条原先靠**评语占位行**里的「支持 [[双链]]」满足 —— 占位行去掉该短语后，
        //   改为断言新占位行本体，并反过来钉「笔记正文里不再出现『双链』」
        expect(md).toContain('（在这里写下你的感想）');
        expect(md).not.toContain('双链');
        // 正文里不再有任何封面嵌入（封面由条目卡组件内嵌显示）
        expect(md).not.toContain('![封面](');
    });

    it('简介：有值输出「## 简介」章节（条目卡之后、个人评语前），无值不输出', () => {
        const withSummary = generateNoteMarkdown(baseEntry({ summary: '人类为了自由与巨人战斗。' }));
        expect(withSummary).toContain('## 简介');
        expect(withSummary).toContain('人类为了自由与巨人战斗。');
        expect(withSummary.indexOf('## 简介')).toBeGreaterThan(withSummary.indexOf('```reelludic'));
        expect(withSummary.indexOf('## 简介')).toBeLessThan(withSummary.indexOf('## 个人评语'));
        // 无简介不生成该章节
        expect(generateNoteMarkdown(baseEntry())).not.toContain('## 简介');
    });

    it('🔴 #404 歌词小节：`## 歌词` + lrc 围栏放在**笔记开头**（条目卡之后、简介之前）', () => {
        const music = baseEntry({ type: 'music', title: '夜曲', summary: '简介内容', progress: undefined, audioPath: '下载/音乐/周杰伦 - 夜曲.mp3' });
        const md = generateNoteMarkdown(music, 'ReelLudic', { table: true });
        expect(md).toContain('## 歌词');
        expect(md).toContain('```lrc');
        expect(md).toContain('source [[下载/音乐/周杰伦 - 夜曲.mp3]]');
        // 顺序：callout → 条目卡 → ## 歌词 → ## 简介 → 个人评语
        expect(md.indexOf('## 歌词')).toBeGreaterThan(md.indexOf('```reelludic'));
        expect(md.indexOf('## 歌词')).toBeLessThan(md.indexOf('## 简介'));
        expect(md.indexOf('## 歌词')).toBeLessThan(md.indexOf('# 个人评语'));
        // 无 audioPath ⇒ 整节不生成（⛔ 不留一个空标题）
        const noAudio = generateNoteMarkdown(baseEntry({ type: 'music', title: '夜曲', progress: undefined }), 'ReelLudic', { table: true });
        expect(noAudio).not.toContain('## 歌词');
        expect(noAudio).not.toContain('```lrc');
        // 非音乐类型永不生成（即使字段被误填）
        const tv = generateNoteMarkdown(baseEntry({ type: 'tv', audioPath: '下载/音乐/x.mp3', progress: undefined }), 'ReelLudic', { table: true });
        expect(tv).not.toContain('## 歌词');
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

    it('笔记表格开关：opts.table=false → 不渲染条目卡，其余章节（简介/评语/链接）照旧', () => {
        const on = generateNoteMarkdown(baseEntry({ summary: 'x' }), 'ReelLudic', { table: true });
        expect(on).toContain('```reelludic');
        const off = generateNoteMarkdown(baseEntry({ summary: 'x' }), 'ReelLudic', { table: false });
        expect(off).not.toContain('```reelludic');
        expect(off).not.toContain('| 属性 | 内容 |');
        expect(off).not.toContain('|:-----|:-----|');
        expect(off).not.toContain('| 类型 |'); // 表格行不得残留
        // 🔴 2026-11-14 m07593 翻面：顶部 callout **整体删除**（封面改由条目卡组件内嵌显示）
        //    ⇒ 关表后正文里同样没有任何 `> ` 残留。
        expect(off).not.toContain('> [!bookinfo]+');
        // 🔴 #404 翻面：关表后**标题与封面嵌入都不再写进正文**（用户：「笔记内开头不写入《标题>图片嵌入，
        // 只在Yaml属性写入」）—— 旧口径「降级为普通加粗行 / 普通图片嵌入」已作废。
        expect(off).not.toContain('**《进击的巨人 最终季》**');
        expect(off).toContain('## 简介');
        expect(off).toContain('## 个人评语');
        expect(off).toContain('## 观看链接');
        // 🔴 2026-11-14 m04138 翻面：来源链接的载体从「表格来源行」迁到 **frontmatter**
        //    （`source` / `source_url` 两键）—— 关表不再丢来源，也不再靠正文里的 markdown 链接。
        const withSource = baseEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/1/' });
        expect(generateNoteMarkdown(withSource)).toContain('```reelludic');
        // 正文里已没有那张表 ⇒ 网址不再出现在**正文**（它现在只活在 YAML 里，由条目卡渲染）
        expect(generateNoteMarkdown(withSource, 'ReelLudic', { table: false })).not.toContain('https://movie.douban.com/subject/1/');
    });

    it('笔记表格开关缺省 = 开（不传 opts 与传 {} 都出条目卡）；音乐条目卡同受开关控制', () => {
        expect(generateNoteMarkdown(baseEntry())).toContain('```reelludic');
        expect(generateNoteMarkdown(baseEntry(), 'ReelLudic', {})).toContain('```reelludic');
        const music = baseEntry({ type: 'music', author: '歌手', year: 2024, cast: [], progress: undefined });
        expect(generateNoteMarkdown(music)).toContain('```reelludic');
        const musicOff = generateNoteMarkdown(music, 'ReelLudic', { table: false });
        expect(musicOff).not.toContain('```reelludic');
        expect(musicOff).toContain('# 个人评语'); // 音乐一级标题不受影响
    });

    it('🔴 m07593 笔记正文**不再有** bookinfo callout 与封面嵌入（封面由条目卡组件内嵌）', () => {
        const e = baseEntry({ poster: '封面/e_123.jpg' });
        const on = generateNoteMarkdown(e, 'ReelLudic', { table: true });
        expect(on).not.toContain('> [!bookinfo]+');
        expect(on).not.toContain('> ![[ReelLudic/封面/e_123.jpg]]');
        expect(on).not.toContain('![[ReelLudic/封面/e_123.jpg]]');
        expect(on).not.toContain('**《进击的巨人 最终季》**');

        const off = generateNoteMarkdown(e, 'ReelLudic', { table: false });
        // callout 块不得留下**任何** `> ` 行（引号块空行 `>` 也算残留）
        expect(off).not.toContain('> [!bookinfo]');
        expect(off.split('\n').some((l) => l.startsWith('>'))).toBe(false);
        // 🔴 标题与封面**正文里都不出现**（用户：「笔记内开头不写入《标题>图片嵌入，只在Yaml属性写入」）
        expect(off).not.toContain('**《进击的巨人 最终季》**');
        expect(off).not.toContain('![[ReelLudic/封面/e_123.jpg]]');
        expect(off).not.toContain('![');
        // 但 YAML 属性里两样都在（信息不丢）
        expect(entryFrontmatter(e)).toContain('title: "进击的巨人 最终季"');
        expect(entryFrontmatter(e)).toContain('banner: "ReelLudic/封面/e_123.jpg"');
    });

    it('🔴 #404 关表后的正文起点：第一个章节直接顶到最前（不再有标题 / 封面占位、不留空行）', () => {
        // 非音乐（无歌词小节）⇒ 正文第一行就是 `## 简介`
        const tv = generateNoteMarkdown(baseEntry({ type: 'tv', summary: '简介内容', poster: '封面/x.jpg' }), 'ReelLudic', { table: false });
        expect(tv.startsWith('## 简介')).toBe(true);
        // 音乐 + 有本地音频 ⇒ 正文第一行是 `## 歌词`（#404 把歌词小节移到笔记开头）
        const music = generateNoteMarkdown(
            baseEntry({ type: 'music', title: '夜曲', poster: '封面/m.jpg', progress: undefined, audioPath: '下载/音乐/周杰伦 - 夜曲.mp3', summary: '简介内容' }),
            'ReelLudic',
            { table: false },
        );
        expect(music.startsWith('## 歌词')).toBe(true);
        expect(music).not.toContain('**《 夜曲 》**');
    });

    it('封面 banner：只进 frontmatter，正文不再嵌入封面（🔴 m07593：封面由条目卡组件内嵌）', () => {
        const urlEntry = baseEntry({ poster: 'https://img.example.com/poster.jpg' });
        expect(entryFrontmatter(urlEntry)).toContain('banner: "https://img.example.com/poster.jpg"');
        expect(generateNoteMarkdown(urlEntry)).not.toContain('![封面](https://img.example.com/poster.jpg)');

        const localEntry = baseEntry({ poster: '封面/e_123.jpg' });
        expect(entryFrontmatter(localEntry)).toContain('banner: "ReelLudic/封面/e_123.jpg"');
        const md = generateNoteMarkdown(localEntry);
        expect(md).not.toContain('![[ReelLudic/封面/e_123.jpg]]');
        // 自定义库目录时按实际目录拼接（frontmatter 侧）
        expect(entryFrontmatter(localEntry, 'MyLib')).toContain('banner: "MyLib/封面/e_123.jpg"');

        // 无 poster 不输出 banner 与嵌入
        const noPoster = generateNoteMarkdown(baseEntry({ poster: undefined }));
        expect(noPoster).not.toContain('![[ReelLudic');
        expect(entryFrontmatter(baseEntry({ poster: undefined }))).not.toContain('banner:');
    });

    it('🔴 m07593 豆瓣图床封面：正文里不再有任何封面嵌入（防盗链 418 的处理移到条目卡组件）', () => {
        const dbEntry = baseEntry({ poster: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2687443734.jpg' });
        const md = generateNoteMarkdown(dbEntry);
        expect(md).not.toContain('<img src="https://img9.doubanio.com/');
        expect(md).not.toContain('![封面](');
        expect(md).not.toContain('referrerpolicy');
        // banner 仍在 frontmatter 里（信息不丢）
        expect(entryFrontmatter(dbEntry)).toContain('banner: "https://img9.doubanio.com/');
    });

    it('个人评语写入正文：有值输出评语、无值保留占位符（表单提交的 notes 必须落笔）', () => {
        const withNotes = generateNoteMarkdown(baseEntry({ notes: '神作，节奏完美。\n第二段感想。' }));
        expect(withNotes).toContain('神作，节奏完美。');
        expect(withNotes).toContain('第二段感想。');
        expect(withNotes).not.toContain('（在这里写下你的感想');
        const empty = generateNoteMarkdown(baseEntry({ notes: '' }));
        // 🔴 #453：占位行去掉「，支持 [[双链]]」（取 noteEditable.NOTES_PLACEHOLDER 唯一真源）
        expect(empty).toContain('（在这里写下你的感想）');
        expect(empty).not.toContain('双链');
    });

    it('评分/进度渲染：正文不再拼「个人评分 / 进度」表格行，值走 frontmatter（卡片渲染）', () => {
        const md = generateNoteMarkdown(baseEntry());
        // 🔴 2026-11-14 m04138 翻面：`★★★★☆` 与 `S4E16` 原先由表格行 `| 个人评分 | ★★★★☆（4/5） |`
        //    和 `| 进度 | S4E16 |` 拼出来；那两行已随表格删除，星串函数也从 noteGenerator 清走。
        expect(md).not.toContain('| 个人评分 |');
        expect(md).not.toContain('| 进度 |');
        expect(md).not.toContain('★★★★☆');
        // 值本身一字不少 —— 落在机器读的 frontmatter 里（条目卡从条目字段读，不依赖正文）
        const fm = entryFrontmatter(baseEntry());
        expect(fm).toContain('rating: 4');
        expect(fm).toContain('progress_season: 4');
        expect(fm).toContain('progress_episode: 16');
    });

    it('链接渲染：表格来源行 + 观看链接列表', () => {
        const md = generateNoteMarkdown(baseEntry());
        expect(md).toContain('[B站](https://www.bilibili.com/bangumi/123)');
    });

    // 🔴 #448：集网络链接要落进笔记（用户：「怎么我在编辑条目保存集网络链接怎么不写回笔记内，
    //    比如 [第1集 新邻居](网络链接) 格式到 ## 观看链接 下呢」）—— 以前这一节只读 `e.links`，
    //    而影视的链接已迁到 `episodeUrls`（提交时 links 清空）⇒ 集链接一条都看不到。
    describe('episodeWatchLines 影视逐集网络链接（#448）', () => {
        it('剧集：`- [第 N 集 集标题](url)`；保位（index i = 第 i+1 集），只输出有网址的集', () => {
            const lines = episodeWatchLines(
                baseEntry({
                    links: [],
                    episodeUrls: [undefined as never, 'https://a.com/2', undefined as never, 'https://a.com/4'],
                    episodeTitles: ['新邻居', undefined as never, '熊熊的歌声', undefined as never],
                }),
            );
            // 下标 1 = 第 2 集（标题空 ⇒ 只「第 2 集」）；下标 3 = 第 4 集（空位不占位、也不前移）
            expect(lines).toEqual(['- [第 2 集](https://a.com/2)', '- [第 4 集](https://a.com/4)']);
        });

        it('集标题进标签；电影不出「第 N 集」（缺标题回退片名）', () => {
            expect(
                episodeWatchLines(
                    baseEntry({ type: 'anime', links: [], episodeUrls: ['https://a.com/1'], episodeTitles: ['新邻居'] }),
                ),
            ).toEqual(['- [第 1 集 新邻居](https://a.com/1)']);
            const movie = baseEntry({ type: 'movie', title: '沙丘', links: [], episodeUrls: ['https://a.com/x'] });
            expect(episodeWatchLines(movie)).toEqual(['- [沙丘](https://a.com/x)']);
        });

        it('多资源电影用「文件 N」措辞（避免同一片名重复多行）', () => {
            const movie = baseEntry({ type: 'movie', title: '沙丘', links: [], episodeUrls: ['https://a.com/1', 'https://a.com/2'] });
            expect(episodeWatchLines(movie)).toEqual(['- [文件 1](https://a.com/1)', '- [文件 2](https://a.com/2)']);
        });

        it('转义：标题里的 `[`/`]` 不破链接；网址含空格 → 尖括号包裹', () => {
            expect(
                episodeWatchLines(
                    baseEntry({ links: [], episodeUrls: ['https://a.com/1'], episodeTitles: ['[前篇]'] }),
                ),
            ).toEqual(['- [第 1 集 \\[前篇\\]](https://a.com/1)']);
            expect(episodeWatchLines(baseEntry({ links: [], episodeUrls: ['https://a.com/a b'] }))).toEqual([
                '- [第 1 集](<https://a.com/a b>)',
            ]);
        });

        it('非影视类型不计；整段空 → 该节仍走原逻辑（（暂无链接））', () => {
            expect(episodeWatchLines(baseEntry({ type: 'book' }))).toEqual([]);
            const md = generateNoteMarkdown(baseEntry({ links: [], episodeUrls: [] }));
            expect(md).toContain('## 观看链接');
            expect(md).toContain('（暂无链接）');
        });

        it('节点整体渲染：## 观看链接 下出现逐集条目（且不吞掉旧 links 行）', () => {
            const md = generateNoteMarkdown(
                baseEntry({ episodeUrls: ['https://a.com/1'], episodeTitles: ['新邻居'] }),
            );
            expect(md).toContain('- [第 1 集 新邻居](https://a.com/1)');
            expect(md).toContain('- [B站](https://www.bilibili.com/bangumi/123)');
        });
    });

    it('来源：数据源自动链接迁到 frontmatter（source / source_url），正文不再出「来源」表格行', () => {
        // 🔴 2026-11-14 m04138：旧断言锚 `| 来源 | [豆瓣](…) |` 表格行 —— 表格已删。
        //    来源的**回写通道**迁到 frontmatter 两键（`pure/noteEditable` 的 handlers 反解），
        //    所以这里改钉 frontmatter，并把「正文里不再出现那张表的来源行」钉死。
        const douban = generateNoteMarkdown(
            baseEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/3001114/' }),
        );
        expect(douban).not.toContain('| 来源 |');
        expect(entryFrontmatter(baseEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/3001114/' })))
            .toContain('source: "douban"');
        expect(entryFrontmatter(baseEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/3001114/' })))
            .toContain('source_url: "https://movie.douban.com/subject/3001114/"');

        // 主源：TMDB / Google Books（🔴 #449：夹具用**真键** `googleBooks`，旧手抄表认的 `google` 已废）
        expect(entryFrontmatter(baseEntry({ source: 'tmdb', sourceUrl: 'https://www.themoviedb.org/movie/438631' })))
            .toContain('source_url: "https://www.themoviedb.org/movie/438631"');
        expect(entryFrontmatter(baseEntry({ type: 'book', source: 'googleBooks', sourceUrl: 'https://books.google.com/books?id=abc' })))
            .toContain('source: "googleBooks"');

        // 无 sourceUrl：⛔ 不写空键（`source_url:` 只在有值时才出现，避免 frontmatter 里多一行空串）
        expect(entryFrontmatter(baseEntry({ sourceUrl: undefined }))).not.toContain('source_url:');
    });

    it('动画类型进度落 frontmatter（正文不再拼进度表格行）', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'anime' }));
        expect(md).not.toContain('| 进度 |');
        const fm = entryFrontmatter(baseEntry({ type: 'anime' }));
        expect(fm).toContain('progress_season: 4');
        expect(fm).toContain('progress_episode: 16');
    });

    it('书籍类型：作者/出版社落 frontmatter，正文无「作者/出版社」表格行、无进度行，链接区用相关链接', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', author: '刘慈欣', publisher: '重庆出版社', director: undefined, cast: [], progress: undefined }));
        // 🔴 2026-11-14 m04138 翻面：表格行 `| 作者 | … |` / `| 出版社 | … |` 已随表格删除
        expect(md).not.toContain('| 作者 |');
        expect(md).not.toContain('| 出版社 |');
        const fm = entryFrontmatter(baseEntry({ type: 'book', author: '刘慈欣', publisher: '重庆出版社' }));
        expect(fm).toContain('author: "刘慈欣"');
        expect(fm).toContain('publisher: "重庆出版社"');
        expect(md).toContain('## 相关链接');
        expect(md).not.toContain('## 观看链接');
        expect(md).not.toContain('S4E16');
    });

    it('游戏类型：平台/开发商落 frontmatter（正文不再出「作者=开发商」表格行）', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'game', platform: 'PC', developer: 'CD Projekt Red', director: undefined, cast: [], progress: undefined, status: 'watched' }));
        expect(md).not.toContain('| 作者 |');
        expect(md).not.toContain('| 平台 |');
        const fm = entryFrontmatter(baseEntry({ type: 'game', platform: 'PC', developer: 'CD Projekt Red' }));
        expect(fm).toContain('platform: "PC"');
        expect(fm).toContain('developer: "CD Projekt Red"');
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

    it('正文不再输出属性表格行（编剧/国家/语言/片长/又名/译者/ISBN 全落 frontmatter）', () => {
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
        // 🔴 2026-11-14 m04138：这七行原先全是 `| 标签 | 值 |` 表格行，表格已换条目卡
        for (const line of ['| 作者 |', '| 编剧 |', '| 制片国家/地区 |', '| 语言 |', '| 片长 |', '| 又名 |', '| 主演 |']) {
            expect(md).not.toContain(line);
        }
        // 值一个不少地在 frontmatter 里（条目卡从条目字段读这些，不依赖正文）
        const fm = entryFrontmatter(
            baseEntry({
                type: 'movie',
                director: '丹尼斯·维伦纽瓦',
                screenwriter: ['丹尼斯·维伦纽瓦', '乔·斯派茨'],
                country: '美国',
                language: '英语',
                durationMin: 156,
                aliases: ['沙丘瀚战(港)'],
            }),
        );
        expect(fm).toContain('director: "丹尼斯·维伦纽瓦"');
        expect(fm).toContain('screenwriter: ["丹尼斯·维伦纽瓦", "乔·斯派茨"]');
        expect(fm).toContain('country: "美国"');
        expect(fm).toContain('language: "英语"');
        expect(fm).toContain('duration_min: 156');
        expect(fm).toContain('aliases: ["沙丘瀚战(港)"]');

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
        for (const line of ['| 作者 |', '| 译者 |', '| 出版社 |', '| ISBN |', '| 装帧 |', '| 定价 |', '| 丛书 |', '| 页数 |']) {
            expect(bmd).not.toContain(line);
        }
        const bfm = entryFrontmatter(
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
        expect(bfm).toContain('author: "渡边淳一"');
        expect(bfm).toContain('translator: "之乎"');
        expect(bfm).toContain('publisher: "青岛出版社"');
        expect(bfm).toContain('isbn: "9787555218296"');
        expect(bfm).toContain('binding: "平装"');
        expect(bfm).toContain('price: "39.00元"');
        expect(bfm).toContain('series: "渡边淳一作品"');
    });

    it('音乐笔记：条目卡 + lrc 块 + # 个人评语（🔴 m07593：顶部 callout 已删除，正文不再出四行属性表）', () => {
        const e: MediaEntry = {
            id: 'e_1', type: 'music', title: '不再犹豫', status: 'want', rating: 0,
            year: 1991, author: 'BEYOND', album: '犹豫',
            communityScore: 9.7, ratingCount: 127431,
            source: 'douban', sourceUrl: 'https://music.douban.com/subject/4899751/',
            audioPath: 'ReelLudic/music/不再犹豫.mp3', poster: 'ReelLudic/covers/m1.jpg',
            genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '',
        };
        const md = generateNoteMarkdown(e);
        expect(md).not.toContain('> [!bookinfo]+');
        expect(md).not.toContain('**《 不再犹豫 》**');
        expect(md).toContain('```reelludic');
        // 🔴 2026-11-14 m04138 翻面：`| 作者 |` / `| 发行年 |` / `| 来源 |` / `| 评分 |` 四行全部作废
        expect(md).not.toContain('| 作者   |');
        expect(md).not.toContain('| 发行年 |');
        expect(md).not.toContain('| 来源   |');
        expect(md).not.toContain('| 评分   |');
        // 值仍在 frontmatter（音乐歌手在 `author` 键 —— 见 pure/musicArtist 的 🔴 铁律）
        // ⚠️ 大众评分（`communityScore`）**从来就不在 frontmatter 里**，也不在正文里 ——
        //    它由条目卡从条目字段直接读（卡片拿的是 `MediaEntry`，不解析笔记文本），所以这里不钉它。
        const fm = entryFrontmatter(e);
        expect(fm).toContain('author: "BEYOND"');
        expect(fm).toContain('year: 1991');
        expect(fm).toContain('source_url: "https://music.douban.com/subject/4899751/"');
        expect(md).toContain('```lrc');
        expect(md).toContain('source [[ReelLudic/music/不再犹豫.mp3]]');
        expect(md).toContain('# 个人评语');
        // 🔴 #404 翻面：lrc 块随「## 歌词」小节**移到笔记开头**（条目卡之后、简介之前）——
        //    旧口径是「置于简介 / 个人评语之后」。
        expect(md.indexOf('## 歌词')).toBeGreaterThan(md.indexOf('```reelludic'));
        expect(md.indexOf('```lrc')).toBeGreaterThan(md.indexOf('## 歌词'));
        expect(md.indexOf('```lrc')).toBeLessThan(md.indexOf('# 个人评语'));
        expect(md.indexOf('# 个人评语')).toBeGreaterThan(md.indexOf('```reelludic'));
        expect(md).not.toContain('## 观看链接');
        expect(md).not.toContain('## 相关链接');
        // 无音频不生成 lrc 块（连带 `## 歌词` 标题也不生成）
        const md2 = generateNoteMarkdown({ ...e, audioPath: undefined });
        expect(md2).not.toContain('```lrc');
        expect(md2).not.toContain('## 歌词');
    });

    it('🔴 库外绝对音频 ⇒ `source` 行**裸写**（⛔ 不包 `[[ ]]` —— 那是库内路径的写法，包了 vault API 找不到）', () => {
        const base: MediaEntry = {
            id: 'e_2', type: 'music', title: '夜曲', status: 'want', rating: 0,
            audioPath: 'C:\\Music\\夜曲.mp3',
            genres: [], cast: [], links: [], notes: '', tags: [], createdAt: '', updatedAt: '',
        };
        expect(generateNoteMarkdown(base)).toContain('source C:\\Music\\夜曲.mp3');
        const posix = generateNoteMarkdown({ ...base, audioPath: '/Users/x/夜曲.mp3' });
        expect(posix).toContain('source /Users/x/夜曲.mp3');
        const unc = generateNoteMarkdown({ ...base, audioPath: '\\\\nas\\share\\夜曲.mp3' });
        expect(unc).toContain('source \\\\nas\\share\\夜曲.mp3');
        // UNC 的正斜杠写法（跨平台粘贴常见）同样裸写 —— 只认反斜杠 ⇒ 这里会变成 `source [[//nas/…]]` 断链
        const uncFwd = generateNoteMarkdown({ ...base, audioPath: '//nas/share/夜曲.mp3' });
        expect(uncFwd).toContain('source //nas/share/夜曲.mp3');
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
    it('按类型英文子目录生成 .md 路径（movie/teleplay/animation/book）', () => {
        expect(entryNotePath(baseEntry())).toBe('ReelLudic/笔记/teleplay/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'movie' }))).toBe('ReelLudic/笔记/movie/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'book' }))).toBe('ReelLudic/笔记/book/进击的巨人 最终季.md');
    });
    it('🔴 #444g 画师（漫画）：frontmatter 写独立 `artist` 键（画师行改由条目卡渲染）', () => {
        const comic = baseEntry({ type: 'book', bookKind: 'comic', author: '原作君', artist: '作画君' });
        // ⚠️ frontmatter 的字符串值都走 `q()` 加引号 ⇒ 断言要带引号
        expect(entryFrontmatter(comic)).toContain('artist: "作画君"');
        // ⛔ 不许把画师拼进 author（Dataview 查不出来，也丢人）
        expect(entryFrontmatter(comic)).not.toContain('author: 原作君 / 作画君');
        // 🔴 2026-11-14 m04138 翻面：正文里的 `| 画师 | 作画君 |` 表格行已随表格删除；
        //    画师这一行现在由 `pure/noteCard` 的 `book` 组（`artist` 键）承载，见 noteCard.test.ts。
        const md = generateNoteMarkdown(comic);
        expect(md).not.toContain('| 画师 |');
        expect(md).toContain('```reelludic');
    });

    it('非漫画不写 `artist` 键（该字段只有漫画会落库）', () => {
        expect(entryFrontmatter(baseEntry({ type: 'book', author: '某作者' }))).not.toContain('artist:');
        expect(entryFrontmatter(baseEntry({ type: 'movie', director: '某导演' }))).not.toContain('artist:');
    });

    it('书籍按子分类分目录：文学 book/、网文 novel/、漫画 comic/（缺省归 book/）', () => {
        expect(entryNotePath(baseEntry({ type: 'book', bookKind: 'book' }))).toBe('ReelLudic/笔记/book/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'book', bookKind: 'novel' }))).toBe('ReelLudic/笔记/novel/进击的巨人 最终季.md');
        // 🔴 2026-09-30 翻面：comic 加回 ⇒ 有自己的目录（曾是「已下线值 → 归 book/」）
        expect(entryNotePath(baseEntry({ type: 'book', bookKind: 'comic' }))).toBe('ReelLudic/笔记/comic/进击的巨人 最终季.md');
        expect(entryNotePath(baseEntry({ type: 'book' }))).toBe('ReelLudic/笔记/book/进击的巨人 最终季.md');
    });
    it('自定义库目录同样带子分类段', () => {
        expect(entryNotePath(baseEntry({ type: 'book', bookKind: 'novel' }), '媒体库/笔记')).toBe('媒体库/笔记/novel/进击的巨人 最终季.md');
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

describe('generateNoteMarkdown · AI 摘要章节', () => {
    it('非书籍：一句话总结 + 核心看点 插在简介之后、个人评语之前', () => {
        const md = generateNoteMarkdown(baseEntry({ summary: '剧情简介内容', aiSummary: '一句话总结内容', aiHighlights: ['看点甲', '看点乙'] }));
        const iSummary = md.indexOf('## 简介');
        const iAi = md.indexOf('## 一句话总结');
        const iHl = md.indexOf('## 核心看点');
        const iNotes = md.indexOf('## 个人评语');
        expect(iSummary).toBeGreaterThanOrEqual(0);
        expect(iAi).toBeGreaterThan(iSummary);
        expect(iHl).toBeGreaterThan(iAi);
        expect(iNotes).toBeGreaterThan(iHl);
        expect(md).toContain('一句话总结内容');
        expect(md).toContain('- 看点甲');
        expect(md).toContain('- 看点乙');
    });

    it('书籍：插在「目录」之后（与表单同序）', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', summary: '内容简介', authorIntro: '作者介绍', toc: '第一章', aiSummary: '总结', aiHighlights: ['甲'] }));
        const iToc = md.indexOf('## 目录');
        const iAi = md.indexOf('## 一句话总结');
        expect(iToc).toBeGreaterThanOrEqual(0);
        expect(iAi).toBeGreaterThan(iToc);
    });

    it('无值不产生章节；只看点无总结也照常渲染', () => {
        const none = generateNoteMarkdown(baseEntry());
        expect(none).not.toContain('## 一句话总结');
        expect(none).not.toContain('## 核心看点');
        const only = generateNoteMarkdown(baseEntry({ aiHighlights: ['只有看点'] }));
        expect(only).not.toContain('## 一句话总结');
        expect(only).toContain('## 核心看点');
        const onlySummary = generateNoteMarkdown(baseEntry({ aiSummary: '只有总结' }));
        expect(onlySummary).toContain('## 一句话总结');
        expect(onlySummary).not.toContain('## 核心看点');
    });

    it('空数组/全空白看点不渲染该章节', () => {
        const md = generateNoteMarkdown(baseEntry({ aiHighlights: ['  ', ''] }));
        expect(md).not.toContain('## 核心看点');
    });
});

// 网文口径（1.0.3，用户 2026-09-13 裁定）：年份行 → 上架年；页数行 → 章数；
// 出版侧字段（译者/出版社/出品方/ISBN/装帧/定价/丛书）与「## 目录」小节不渲染（文学保持原样）
describe('generateNoteMarkdown · 网文（novel）口径', () => {
    /** 同一份数据分别以文学 / 网文渲染，便于对照断言 */
    const bookish = (bookKind: 'book' | 'novel') =>
        baseEntry({
            type: 'book',
            bookKind,
            title: '斗罗大陆',
            author: '唐家三少',
            year: 2008,
            genres: ['玄幻'],
            translator: '某译',
            publisher: '某出版社',
            producer: '某出品方',
            isbn: '9787555218296',
            binding: '平装',
            price: '29.80',
            series: '斗罗系列',
            toc: '第一章 觉醒',
            pageCount: 1200,
            director: undefined,
            cast: [],
            progress: undefined,
        });

    it('网文：年份/章数不再写进正文（由条目卡按 bookKind 换名渲染）', () => {
        const md = generateNoteMarkdown(bookish('novel'));
        // 🔴 2026-11-14 m04138 翻面：`| 上架年 | 2008 |` / `| 章数 | 1200 |` 是表格行，表格已换条目卡。
        //    换名逻辑迁到 `pure/noteCard` 的 `bookKindLabelOf`（year→上架年、page_count→章数、series→系列），
        //    由 `tests/noteCard.test.ts` 钉住 —— 这里只钉「正文里不再有这些行」。
        expect(md).not.toContain('| 上架年 |');
        expect(md).not.toContain('| 年份 |');
        expect(md).not.toContain('| 章数 |');
        // 机器读的 frontmatter 不变（year/page_count 键名对 Dataview 兼容，bookKind 只换显示名）
        expect(entryFrontmatter(bookish('novel'))).toContain('year: 2008');
        expect(entryFrontmatter(bookish('novel'))).toContain('page_count: 1200');
    });

    it('网文：出版侧字段本来就不渲染（正文现在统一无表格行）', () => {
        const md = generateNoteMarkdown(bookish('novel'));
        for (const label of ['| 译者 |', '| 出版社 |', '| 出品方 |', '| ISBN |', '| 装帧 |', '| 定价 |', '| 丛书 |']) {
            expect(md).not.toContain(label);
        }
    });

    // 🔴 #431 **翻面**：这条原本钉「网文即使有 toc 也不渲染 ## 目录」（2026-09-13 裁定）。
    //    用户 2026-09-29 裁定「文学类和网文的 toc 目录回填只显示前 10 章加个 `....`」⇒ 网文也渲染。
    //    ⚠️ 当年那条裁定要防的是**一整份 2000+ 章的出版目录**，裁到 10 行之后这个顾虑不成立了。
    it('网文：有 toc **也**渲染「## 目录」小节（#431 翻面；作者简介照旧保留）', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', bookKind: 'novel', authorIntro: '示例作者简介', toc: '第一章 觉醒' }));
        expect(md).toContain('## 目录');
        expect(md).toContain('第一章 觉醒');
        expect(md).toContain('## 作者简介');
    });

    it('文学回归锁定：目录/出版侧字段照旧，正文无表格行（网文分支不得误伤）', () => {
        const md = generateNoteMarkdown(bookish('book'));
        // 🔴 2026-11-14 m04138 翻面：`| 年份 |` / `| 页数 |` / `| 译者 |` / … 全是表格行，已随表格删除。
        //    「文学 vs 网文」的显示差异现在由 `pure/noteCard.bookKindLabelOf` 承担（见 noteCard.test.ts）。
        for (const line of ['| 年份 |', '| 页数 |', '| 译者 |', '| 出版社 |', '| ISBN |', '| 上架年 |', '| 章数 |']) {
            expect(md).not.toContain(line);
        }
        // 正文侧真正该保留的：`## 目录` 章节（#431 翻面后文学与网文都渲染）
        expect(md).toContain('## 目录');
        // frontmatter 侧一字不少
        expect(entryFrontmatter(bookish('book'))).toContain('year: 2008');
        expect(entryFrontmatter(bookish('book'))).toContain('page_count: 1200');
        expect(entryFrontmatter(bookish('book'))).toContain('translator: "某译"');
        expect(entryFrontmatter(bookish('book'))).toContain('isbn: "9787555218296"');
    });

    it('缺省 bookKind（老数据）按文学口径：正文无表格行，目录照出', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', year: 2010, pageCount: 340, toc: '第一章' }));
        expect(md).not.toContain('| 年份 |');
        expect(md).not.toContain('| 页数 |');
        expect(md).toContain('## 目录');
        // 老数据缺省 bookKind ⇒ `bookKindLabelOf` 回落「年份 / 页数」（文学口径），由 noteCard.test.ts 钉住
        expect(entryFrontmatter(baseEntry({ type: 'book', year: 2010, pageCount: 340 }))).toContain('year: 2010');
    });

    it('frontmatter：page_count 键名不变（网文同字段 = 章数，Dataview 查询兼容）', () => {
        expect(entryFrontmatter(bookish('novel'))).toContain('page_count: 1200');
        expect(entryFrontmatter(bookish('book'))).toContain('page_count: 1200');
    });

    it('🔴 #445 漫画：正文无「话数/页数/章数」表格行，frontmatter 键名仍是 page_count', () => {
        const md = generateNoteMarkdown(baseEntry({ type: 'book', bookKind: 'comic', pageCount: 139 }));
        // 🔴 2026-11-14 m04138 翻面：`| 话数 | 139 |` 这行本身没了（表格 → 条目卡）。
        //    漫画侧「话数」这个换名由 `pure/noteCard.bookKindLabelOf` 承担（comic ⇒ 话数），
        //    由 `tests/noteCard.test.ts` 钉住；这里同时钉死「⛔ 不许退化成页数/章数」。
        expect(md).not.toContain('| 话数 |');
        expect(md).not.toContain('| 页数 |');
        expect(md).not.toContain('| 章数 |');
        expect(entryFrontmatter(baseEntry({ type: 'book', bookKind: 'comic', pageCount: 139 }))).toContain('page_count: 139');
    });
});

