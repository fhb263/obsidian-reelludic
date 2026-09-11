// 笔记可编辑字段解析（用户直接编辑笔记后，编辑表单回填覆盖 catalog）
import { describe, expect, it } from 'vitest';
import { extractEditableFromNote, extractFrontmatterFromNote, NOTES_PLACEHOLDER } from 'pure/noteEditable';

describe('pure/noteEditable 从笔记提取可编辑字段', () => {
    it('提取个人评语与观看链接（影视笔记）', () => {
        const md = [
            '> [!bookinfo]+ **《回到未来》**',
            '> 封面：![[ReelLudic/封面/回到未来.jpg]]',
            '',
            '| 属性 | 内容 |',
            '|:-----|:-----|',
            '| 导演 | 罗伯特·泽米吉斯 |',
            '',
            '## 个人评语',
            '',
            '烧脑又温情，三部曲都值得看。',
            '想起 [[时间旅行]] 主题。',
            '',
            '## 观看链接',
            '',
            '- [B站](https://bilibili.com/video/1)',
            '- [油管](https://youtube.com/watch?v=2)',
            '',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.notes).toBe('烧脑又温情，三部曲都值得看。\n想起 [[时间旅行]] 主题。');
        expect(out.links).toEqual([
            { label: 'B站', url: 'https://bilibili.com/video/1' },
            { label: '油管', url: 'https://youtube.com/watch?v=2' },
        ]);
    });

    it('评语为占位符时视为未写（不覆盖）', () => {
        const md = ['## 个人评语', '', NOTES_PLACEHOLDER, '', '## 观看链接', '', '（暂无链接）'].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.notes).toBeUndefined();
        expect(out.links).toBeUndefined();
    });

    it('无链接（暂无链接）与无评语时返回空', () => {
        const md = ['## 个人评语', '', '', '## 相关链接', '', '（暂无链接）'].join('\n');
        expect(extractEditableFromNote(md)).toEqual({});
    });

    it('其他章节内容不采集（游玩记录/属性表格）', () => {
        const md = [
            '## 个人评语',
            '',
            '好游戏。',
            '',
            '## 游玩记录',
            '',
            '- **2026-08-01** · 0.8h · 刚打过虎先锋',
            '',
            '## 相关链接',
            '',
            '- [官网](https://example.com)',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.notes).toBe('好游戏。');
        expect(out.links).toEqual([{ label: '官网', url: 'https://example.com' }]);
    });

    it('图书笔记：提取 内容简介/作者简介/目录 并同步回表单（回归锁定）', () => {
        const md = [
            '> [!bookinfo]+ **《三体》**',
            '| 属性 | 内容 |',
            '|:-----|:-----|',
            '| 作者 | 刘慈欣 |',
            '',
            '## 内容简介',
            '',
            '文化大革命如火如荼进行的同时。军方探寻外星文明的绝秘计划"红岸工程"取得了突破性进展。',
            '但在按下发射键的那一刻，叶文洁没有意识到，她彻底改变了人类的命运。',
            '',
            '## 作者简介',
            '',
            '刘慈欣，祖籍河南，长于山西，中国科普作家协会会员。',
            '',
            '## 目录',
            '',
            '1.科学边界',
            '2.射手与农场主',
            '',
            '## 个人评语',
            '',
            '神作。',
            '',
            '## 相关链接',
            '',
            '（暂无链接）',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.summary).toContain('红岸工程');
        expect(out.summary).toContain('叶文洁');
        expect(out.authorIntro).toBe('刘慈欣，祖籍河南，长于山西，中国科普作家协会会员。');
        expect(out.toc).toBe('1.科学边界\n2.射手与农场主');
        expect(out.notes).toBe('神作。');
    });

    it('影视笔记：提取「## 简介」为 summary；其他类型笔记同步同样生效', () => {
        const md = [
            '## 简介',
            '',
            '人类为了自由与巨人战斗。',
            '',
            '## 个人评语',
            '',
            '好看。',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.summary).toBe('人类为了自由与巨人战斗。');
        expect(out.notes).toBe('好看。');
    });

    it('音乐笔记：评语为 H1「# 个人评语」（noteGenerator 音乐模板），回读同样生效且主标题不采集', () => {
        const md = [
            '# 不再犹豫',
            '',
            '这里是主标题下的简介或属性区，不应被采集。',
            '',
            '# 个人评语',
            '',
            '励志又上头，Beyond 永远的神。',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.notes).toBe('励志又上头，Beyond 永远的神。');
    });

    it('章节为空/缺失时对应字段为 undefined（不覆盖 catalog 已有值）', () => {
        const md = ['## 内容简介', '', '', '## 个人评语', '', '（在这里写下你的感想，支持 [[双链]]）'].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.summary).toBeUndefined();
        expect(out.authorIntro).toBeUndefined();
        expect(out.toc).toBeUndefined();
        expect(out.notes).toBeUndefined();
    });
});

describe('pure/noteEditable 从笔记 frontmatter 提取可编辑字段', () => {
    const FM = [
        '---',
        'id: "e_123"',
        'type: movie',
        'title: "回到未来"',
        'status: watching',
        'rating: 5',
        'year: 1985',
        'genres: [冒险, 喜剧, 科幻]',
        'director: "罗伯特·泽米吉斯"',
        'cast: ["迈克尔·J·福克斯", "克里斯托弗·劳埃德"]',
        'screenwriter: ["鲍勃·盖尔", "罗伯特·泽米吉斯"]',
        'country: "美国"',
        'language: "英语"',
        'duration_min: 116',
        'aliases: ["Back to the Future", "回到未來(港)"]',
        'author: "刘慈欣"',
        'album: "犹豫"',
        'isbn: "9787536692930"',
        'banner: "媒体库/封面/回到未来.jpg"',
        'progress_season: 1',
        'progress_episode: 3',
        'progress_total_episodes: 10',
        'watched_date: "2026-08-01"',
        'planned_date: "2026-09-01"',
        'reading_page: 50',
        'reading_total_page: 340',
        'playtime_minutes: 720',
        '---',
        '',
        '## 个人评语',
        '',
        '好看。',
    ].join('\n');

    it('提取全部可编辑字段：字符串/数字/数组/带转义引号', () => {
        const out = extractFrontmatterFromNote(FM);
        expect(out.status).toBe('watching');
        expect(out.rating).toBe(5);
        expect(out.year).toBe(1985);
        expect(out.genres).toEqual(['冒险', '喜剧', '科幻']);
        expect(out.director).toBe('罗伯特·泽米吉斯');
        expect(out.cast).toEqual(['迈克尔·J·福克斯', '克里斯托弗·劳埃德']);
        expect(out.screenwriter).toEqual(['鲍勃·盖尔', '罗伯特·泽米吉斯']);
        expect(out.country).toBe('美国');
        expect(out.durationMin).toBe(116);
        expect(out.aliases).toEqual(['Back to the Future', '回到未來(港)']);
        expect(out.author).toBe('刘慈欣');
        expect(out.album).toBe('犹豫');
        expect(out.isbn).toBe('9787536692930');
        expect(out.poster).toBe('媒体库/封面/回到未来.jpg');
        expect(out.watchedDate).toBe('2026-08-01');
        expect(out.plannedDate).toBe('2026-09-01');
        expect(out.playtimeMinutes).toBe(720);
    });

    it('进度与阅读进度字段聚合成 progress/readingProgress（history 为占位，EntryModal 合并时用条目历史覆盖）', () => {
        const out = extractFrontmatterFromNote(FM);
        expect(out.progress).toEqual({ season: 1, episode: 3, totalEpisodes: 10, history: [] });
        expect(out.readingProgress).toEqual({ page: 50, totalPage: 340 });
    });

    it('跳过结构性字段（id/type/title 不返回）；非法 status/rating 忽略', () => {
        const md = [
            '---',
            'id: "e_1"',
            'type: book',
            'title: "三体"',
            'status: 乱写的',
            'rating: 99',
            'year: "not-number"',
            '---',
        ].join('\n');
        const out = extractFrontmatterFromNote(md);
        expect(out.id).toBeUndefined();
        expect(out.type).toBeUndefined();
        expect(out.title).toBeUndefined();
        expect(out.status).toBeUndefined();
        expect(out.rating).toBeUndefined();
        expect(out.year).toBeUndefined();
    });

    it('无 frontmatter / 非 YAML 时返回空', () => {
        expect(extractFrontmatterFromNote('## 个人评语\n\n好看。')).toEqual({});
        expect(extractFrontmatterFromNote('')).toEqual({});
    });
});

describe('pure/noteEditable 从笔记属性表格「来源」行提取数据源链接', () => {
    it('来源行 [豆瓣](url) → sourceUrl + source 映射回 douban', () => {
        const md = [
            '> [!bookinfo]+ **《三体》**',
            '| 属性 | 内容 |',
            '|:-----|:-----|',
            '| 类型 | 书籍 |',
            '| 来源 | [豆瓣](https://book.douban.com/subject/2567698/) |',
            '| 大众评分 | 9.3 |',
            '',
            '## 个人评语',
        ].join('\n');
        const out = extractEditableFromNote(md);
        expect(out.sourceUrl).toBe('https://book.douban.com/subject/2567698/');
        expect(out.source).toBe('douban');
    });

    it('TMDB/Bangumi 标签同样映射；未知标签仅同步 URL 不覆盖 source', () => {
        const tmdb = ['| 来源 | [TMDB](https://www.themoviedb.org/movie/105) |'].join('\n');
        expect(extractEditableFromNote(tmdb).source).toBe('tmdb');
        const bgm = ['| 来源 | [Bangumi](https://bgm.tv/subject/302457) |'].join('\n');
        expect(extractEditableFromNote(bgm).source).toBe('bangumi');
        const custom = ['| 来源 | [我的收藏](https://example.com/x) |'].join('\n');
        const out = extractEditableFromNote(custom);
        expect(out.sourceUrl).toBe('https://example.com/x');
        expect(out.source).toBeUndefined();
    });

    it('无来源行/非链接格式时字段为 undefined', () => {
        expect(extractEditableFromNote('| 来源 | （暂无） |')).toMatchObject({});
        expect(extractEditableFromNote('## 个人评语')).toMatchObject({});
    });
});

describe('extractEditableFromNote · AI 摘要章节（笔记手改可读回表单）', () => {
    it('一句话总结 → aiSummary；核心看点列表 → aiHighlights', () => {
        const note = [
            '---', 'id: "e1"', '---', '',
            '## 简介', '剧情简介内容', '',
            '## 一句话总结', '沙漠星球的家族史诗', '',
            '## 核心看点', '- 沙虫生态设定', '- 宗教与政治隐喻', '',
            '## 个人评语', '很好看',
        ].join('\n');
        const ext = extractEditableFromNote(note);
        expect(ext.aiSummary).toBe('沙漠星球的家族史诗');
        expect(ext.aiHighlights).toEqual(['沙虫生态设定', '宗教与政治隐喻']);
    });

    it('多行总结不串到看点；看点容忍 * 与缩进；空章节不返回', () => {
        const note = [
            '## 一句话总结', '第一行', '第二行', '',
            '## 核心看点', '  * 甲', '- 乙', '',
            '## 个人评语', '评语',
        ].join('\n');
        const ext = extractEditableFromNote(note);
        expect(ext.aiSummary).toBe('第一行\n第二行');
        expect(ext.aiHighlights).toEqual(['甲', '乙']);

        const empty = extractEditableFromNote('## 一句话总结\n\n## 核心看点\n\n## 个人评语\nx');
        expect(empty.aiSummary).toBeUndefined();
        expect(empty.aiHighlights).toBeUndefined();
    });
});
