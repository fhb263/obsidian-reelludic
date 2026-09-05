import { describe, it, expect } from 'vitest';
import { parseCatalog, serializeCatalog, CatalogStore, DEFAULT_CATALOG, normalizeEntry } from 'data/catalog';
import type { VaultIO } from 'data/catalog';
import type { Catalog, MediaEntry } from 'data/types';

function memIO(initial?: Record<string, string>): VaultIO & { files: Record<string, string> } {
    const files: Record<string, string> = { ...(initial || {}) };
    return {
        files,
        async readText(path: string) {
            if (!(path in files)) throw new Error(`ENOENT: ${path}`);
            return files[path];
        },
        async writeText(path: string, content: string) {
            files[path] = content;
        },
        async deleteFile(path: string) {
            delete files[path];
        },
    };
}

describe('parseCatalog', () => {
    it('解析合法 catalog', () => {
        const c = parseCatalog('{"version":1,"entries":[{"id":"e1","title":"沙丘","status":"want"}]}');
        expect(c.version).toBe(1);
        expect(c.entries).toHaveLength(1);
        expect(c.entries[0].title).toBe('沙丘');
    });

    it('非法 JSON 回退默认空库', () => {
        expect(parseCatalog('not json{{{')).toEqual(DEFAULT_CATALOG);
        expect(parseCatalog('')).toEqual(DEFAULT_CATALOG);
    });

    it('entries 非数组时回退空数组', () => {
        const c = parseCatalog('{"version":1,"entries":"oops"}');
        expect(c.entries).toEqual([]);
    });

    it('过滤缺 id 的条目，非法 status 容错归一为 want', () => {
        const text = JSON.stringify({
            version: 1,
            entries: [
                { id: 'e1', title: 'OK', status: 'want' },
                { title: 'no-id' },
                { id: 'e3', title: 'bad-status', status: 'nope' },
            ],
        });
        const c = parseCatalog(text);
        expect(c.entries).toHaveLength(2);
        expect(c.entries[0].id).toBe('e1');
        expect(c.entries[1].id).toBe('e3');
        expect(c.entries[1].status).toBe('want'); // 容错归一
    });
});

describe('normalizeEntry 缺字段兜底', () => {
    it('缺失字段填充默认值', () => {
        const e = normalizeEntry({ title: '沙丘' } as Partial<MediaEntry>);
        expect(e.id).toBeTruthy();
        expect(e.status).toBe('want');
        expect(e.rating).toBe(0);
        expect(e.genres).toEqual([]);
        expect(e.cast).toEqual([]);
        expect(e.links).toEqual([]);
        expect(e.tags).toEqual([]);
        expect(e.notes).toBe('');
        expect(e.createdAt).toBeTruthy();
        expect(e.updatedAt).toBeTruthy();
    });

    it('type 预留枚举（book/game）保留，非法值归一为 movie', () => {
        expect(normalizeEntry({ type: 'tv' as const }).type).toBe('tv');
        expect(normalizeEntry({ type: 'book' as const }).type).toBe('book'); // 三库扩展点预留
        expect(normalizeEntry({ type: 'xxx' as never }).type).toBe('movie');
    });

    it('弃剧迁移为存档（存量 dropped 归一 archived，归档语义兼容）', () => {
        expect(normalizeEntry({ title: 'x', status: 'dropped' as never }).status).toBe('archived');
        expect(normalizeEntry({ title: 'x', status: 'archived' }).status).toBe('archived');
        expect(normalizeEntry({ title: 'x', status: 'xxx' as never }).status).toBe('want');
    });

    it('rating 越界被钳制', () => {
        expect(normalizeEntry({ rating: 99 as never }).rating).toBe(5);
    });

    it('plannedDate 透传/缺失兜底 undefined（月历排期字段）', () => {
        expect(normalizeEntry({ plannedDate: '2026-09-01' }).plannedDate).toBe('2026-09-01');
        expect(normalizeEntry({ plannedDate: 123 as never }).plannedDate).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).plannedDate).toBeUndefined();
    });

    it('豆瓣适配字段归一化：字符串透传、数组过滤、空数组归 undefined', () => {
        const e = normalizeEntry({
            screenwriter: ['诺兰', '弟弟'],
            country: '美国',
            language: '英语',
            durationMin: 148,
            aliases: ['星际穿越', 'Interstellar'],
            translator: '某译',
            isbn: '9781234',
            producer: '华纳',
            binding: '精装',
            price: '68.00元',
            series: '某某丛书',
        });
        expect(e.screenwriter).toEqual(['诺兰', '弟弟']);
        expect(e.country).toBe('美国');
        expect(e.language).toBe('英语');
        expect(e.durationMin).toBe(148);
        expect(e.aliases).toEqual(['星际穿越', 'Interstellar']);
        expect(e.translator).toBe('某译');
        expect(e.isbn).toBe('9781234');
        expect(e.producer).toBe('华纳');
        expect(e.binding).toBe('精装');
        expect(e.price).toBe('68.00元');
        expect(e.series).toBe('某某丛书');
        // 空数组 → undefined；非法类型 → undefined
        expect(normalizeEntry({ screenwriter: [] }).screenwriter).toBeUndefined();
        expect(normalizeEntry({ aliases: [] }).aliases).toBeUndefined();
        expect(normalizeEntry({ screenwriter: [1, 'ok'] as never }).screenwriter).toEqual(['ok']);
        expect(normalizeEntry({ country: 42 as never }).country).toBeUndefined();
        expect(normalizeEntry({ durationMin: 'x' as never }).durationMin).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).isbn).toBeUndefined();
        // 数据源字段透传/兜底
        expect(normalizeEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/1/' }).source).toBe('douban');
        expect(normalizeEntry({ source: 'douban', sourceUrl: 'https://movie.douban.com/subject/1/' }).sourceUrl).toBe('https://movie.douban.com/subject/1/');
        expect(normalizeEntry({ source: 42 as never, sourceUrl: 'x' as never }).source).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).sourceUrl).toBeUndefined();
        // 简介/评价人数/作者简介/目录（豆瓣回填）透传与兜底——回归锁定：summary 曾被 normalizeEntry 丢弃导致笔记无简介
        expect(normalizeEntry({ summary: '地球往事三部曲' }).summary).toBe('地球往事三部曲');
        expect(normalizeEntry({ title: 'x' }).summary).toBeUndefined();
        expect(normalizeEntry({ ratingCount: 517685 }).ratingCount).toBe(517685);
        expect(normalizeEntry({ title: 'x' }).ratingCount).toBeUndefined();
        expect(normalizeEntry({ authorIntro: '刘慈欣' }).authorIntro).toBe('刘慈欣');
        expect(normalizeEntry({ toc: '第一章' }).toc).toBe('第一章');
        // 追更检测已知最新集（v0.5 A2 落库）：数值透传、非法类型/缺失兜底 undefined——回归锁定：增字段必须同步 normalizeEntry
        expect(normalizeEntry({ latestKnownEpisode: 12 }).latestKnownEpisode).toBe(12);
        expect(normalizeEntry({ latestKnownEpisode: 0 }).latestKnownEpisode).toBe(0);
        expect(normalizeEntry({ latestKnownEpisode: 'x' as never }).latestKnownEpisode).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).latestKnownEpisode).toBeUndefined();
        // 笔记内容指纹（G 双写冲突）：字符串透传、缺失兜底 undefined
        expect(normalizeEntry({ noteFingerprint: 'a1b2c3' }).noteFingerprint).toBe('a1b2c3');
        expect(normalizeEntry({ noteFingerprint: 42 as never }).noteFingerprint).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).noteFingerprint).toBeUndefined();
        // 摘抄数（P1 性能缓存）：数值透传、非法类型/缺失兜底 undefined
        expect(normalizeEntry({ excerptCount: 3 }).excerptCount).toBe(3);
        expect(normalizeEntry({ excerptCount: 0 }).excerptCount).toBe(0);
        expect(normalizeEntry({ excerptCount: 'x' as never }).excerptCount).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).excerptCount).toBeUndefined();
        // 本地剧集视频路径（集按钮关联）：字符串数组透传、非法项过滤、缺失兜底 undefined——回归锁定：增字段必须同步 normalizeEntry
        expect(normalizeEntry({ episodeFiles: ['C:/videos/ep01.mp4', 'C:/videos/ep02.mp4'] }).episodeFiles).toEqual(['C:/videos/ep01.mp4', 'C:/videos/ep02.mp4']);
        expect(normalizeEntry({ episodeFiles: ['ok.mp4', 42 as never, '', 'bad'] }).episodeFiles).toEqual(['ok.mp4', 'bad']);
        expect(normalizeEntry({ episodeFiles: 'x' as never }).episodeFiles).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).episodeFiles).toBeUndefined();
        // 剧集网络地址（每集与 episodeFiles 同下标）：字符串数组透传、非法项过滤、缺失兜底 undefined
        expect(normalizeEntry({ episodeUrls: ['https://a.com/1', 'https://b.com/2'] }).episodeUrls).toEqual(['https://a.com/1', 'https://b.com/2']);
        expect(normalizeEntry({ episodeUrls: ['https://a.com', 42 as never, '', 'x'] }).episodeUrls).toEqual(['https://a.com', 'x']);
        expect(normalizeEntry({ episodeUrls: 'x' as never }).episodeUrls).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).episodeUrls).toBeUndefined();
        // 集标题（hover 显示）：字符串数组透传、非法项过滤、缺失兜底 undefined
        expect(normalizeEntry({ episodeTitles: ['p1 开始', '第二集'] }).episodeTitles).toEqual(['p1 开始', '第二集']);
        expect(normalizeEntry({ episodeTitles: ['ok', 42 as never, '', 'bad'] }).episodeTitles).toEqual(['ok', 'bad']);
        expect(normalizeEntry({ episodeTitles: 'x' as never }).episodeTitles).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).episodeTitles).toBeUndefined();
        // 音乐专辑/本地音频路径（music 类型）：字符串透传、空串过滤、缺失兜底 undefined——回归锁定：增字段必须同步 normalizeEntry
        expect(normalizeEntry({ album: '犹豫' }).album).toBe('犹豫');
        expect(normalizeEntry({ album: '' }).album).toBeUndefined();
        expect(normalizeEntry({ audioPath: 'ReelLudic/music/不再犹豫.mp3' }).audioPath).toBe('ReelLudic/music/不再犹豫.mp3');
        expect(normalizeEntry({ audioPath: 42 as never }).audioPath).toBeUndefined(); // 非法类型兜底（与 country/noteFingerprint 等字符串字段惯例一致）
        // 追番表重构新字段：开播日期（airDate 字符串透传；localWatchDir 已于 #159 随功能删除，不再透传）
        expect(normalizeEntry({ airDate: '2024-10-03' }).airDate).toBe('2024-10-03');
        expect(normalizeEntry({ airDate: 'x' as never }).airDate).toBeUndefined();
        // 书籍文件路径（阅读器入口）：字符串透传、空串过滤、非法类型兜底 undefined（复用 audioPath 模式）
        expect(normalizeEntry({ bookFile: '书籍/三体.txt' }).bookFile).toBe('书籍/三体.txt');
        expect(normalizeEntry({ bookFile: '' }).bookFile).toBeUndefined();
        expect(normalizeEntry({ bookFile: 42 as never }).bookFile).toBeUndefined();
    });

    it('readingProgress / playtimeMinutes 透传与兜底（书籍/游戏进度字段）', () => {
        const rp = normalizeEntry({ readingProgress: { page: 123, totalPage: 456 } });
        expect(rp.readingProgress).toEqual({ page: 123, totalPage: 456 });
        expect(normalizeEntry({ readingProgress: { page: 'x' as never } }).readingProgress?.page).toBeUndefined();
        expect(normalizeEntry({ readingProgress: 'bad' as never }).readingProgress).toBeUndefined();
        expect(normalizeEntry({ playtimeMinutes: 720 }).playtimeMinutes).toBe(720);
        expect(normalizeEntry({ playtimeMinutes: 'x' as never }).playtimeMinutes).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).playtimeMinutes).toBeUndefined();
    });

    it('readingProgress.percent 透传与区间校验（阅读器进度百分比）', () => {
        expect(normalizeEntry({ readingProgress: { page: 12, totalPage: 300, percent: 34 } }).readingProgress)
            .toEqual({ page: 12, totalPage: 300, percent: 34 });
        expect(normalizeEntry({ readingProgress: { percent: 100 } }).readingProgress?.percent).toBe(100);
        expect(normalizeEntry({ readingProgress: { percent: 0 } }).readingProgress?.percent).toBe(0);
        // 越界/非法类型丢弃
        expect(normalizeEntry({ readingProgress: { percent: 101 } }).readingProgress?.percent).toBeUndefined();
        expect(normalizeEntry({ readingProgress: { percent: -1 } }).readingProgress?.percent).toBeUndefined();
        expect(normalizeEntry({ readingProgress: { percent: 'x' as never } }).readingProgress?.percent).toBeUndefined();
        // 无 percent 旧数据 → undefined（兼容）
        expect(normalizeEntry({ readingProgress: { page: 12 } }).readingProgress?.percent).toBeUndefined();
    });

    it('gameLaunchPath 透传与兜底（游戏启动快捷方式）', () => {
        expect(normalizeEntry({ gameLaunchPath: '游戏/塞尔达.lnk' }).gameLaunchPath).toBe('游戏/塞尔达.lnk');
        expect(normalizeEntry({ gameLaunchPath: '' }).gameLaunchPath).toBeUndefined();
        expect(normalizeEntry({ gameLaunchPath: 123 as never }).gameLaunchPath).toBeUndefined();
        expect(normalizeEntry({ title: 'x' }).gameLaunchPath).toBeUndefined();
    });
});

describe('CatalogStore', () => {
    it('文件缺失时 load 返回默认空库', async () => {
        const io = memIO();
        const store = new CatalogStore(io, 'ReelLudic/catalog.json');
        const c = await store.load();
        expect(c).toEqual(DEFAULT_CATALOG);
    });

    it('save 后 load 往返一致', async () => {
        const io = memIO();
        const store = new CatalogStore(io, 'ReelLudic/catalog.json');
        await store.save({
            version: 1,
            entries: [normalizeEntry({ id: 'e1', title: '沙丘', status: 'watched', rating: 5 })],
        });
        const c = await store.load();
        expect(c.entries).toHaveLength(1);
        expect(c.entries[0].title).toBe('沙丘');
        expect(c.entries[0].status).toBe('watched');
        expect(c.entries[0].rating).toBe(5);
    });

    it('serializeCatalog 输出可解析且字段归一', () => {
        const text = serializeCatalog({
            version: 1,
            entries: [{ id: 'e1', title: 'T', status: 'nope' }],
        } as unknown as Catalog);
        const parsed = parseCatalog(text);
        expect(parsed.entries[0].status).toBe('want');
    });
});
