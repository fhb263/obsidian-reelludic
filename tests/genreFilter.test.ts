// 视图级题材筛选（pure/genreFilter）单测
//
// 需求（用户 2026-09-22）：
//  - 「题材」= 条目笔记元数据里的 `genres` 字段（本项目 frontmatter 键就叫 genres，卡片题材行同源），
//    **不手动维护题材表**、不并入 tags；
//  - 面板里题材按**出现频次**降序，过滤空值，另给「未分类」桶；
//  - 筛选是**视图级**的：每个子视图一套独立题材池（阅读-全部 / 影视-全部 干脆不提供题材筛选）；
//  - 多选（值之间 OR）；全选**包含**未分类（D-5）；胶囊文案按**题材池顺序**取第一个已选（D-6）。
import { describe, it, expect } from 'vitest';
import {
    GENRE_NONE_KEY,
    GENRE_NONE_LABEL,
    genreValuesOf,
    buildGenreOptions,
    matchesGenres,
    resolveGenreScope,
    matchesGenreScope,
    genrePillLabel,
} from 'pure/genreFilter';

describe('genreValuesOf · 取值归一（trim / 去空 / 去重）', () => {
    it('trim 后去空值、去重且保持原顺序', () => {
        expect(genreValuesOf({ genres: [' 科幻 ', '', '   ', '科幻', '推理'] })).toEqual(['科幻', '推理']);
    });

    it('缺省 / 非数组 / 非字符串项一律容错', () => {
        expect(genreValuesOf({})).toEqual([]);
        expect(genreValuesOf({ genres: undefined })).toEqual([]);
        expect(genreValuesOf({ genres: null as unknown as string[] })).toEqual([]);
        expect(genreValuesOf({ genres: ['科幻', 7 as unknown as string, null as unknown as string, '历史'] })).toEqual(['科幻', '历史']);
    });

    it('字面「未分类」不作为题材值（避免与合成桶重名两行）', () => {
        expect(genreValuesOf({ genres: ['未分类', '科幻'] })).toEqual(['科幻']);
    });
});

describe('buildGenreOptions · 池构建（频次降序 → 名称升序，未分类置末）', () => {
    const pool = [
        { genres: ['科幻', '推理'] },
        { genres: ['科幻'] },
        { genres: ['悬疑'] },
        { genres: ['科幻', '悬疑'] },
        { genres: [] },
        { genres: ['历史'] },
    ];

    it('按频次降序排列，计数为该题材在本池出现的条目数', () => {
        expect(buildGenreOptions(pool)).toEqual([
            { key: '科幻', label: '科幻', count: 3 },
            { key: '悬疑', label: '悬疑', count: 2 },
            { key: '历史', label: '历史', count: 1 },
            { key: '推理', label: '推理', count: 1 },
            { key: GENRE_NONE_KEY, label: GENRE_NONE_LABEL, count: 1 },
        ]);
    });

    it('同频次按名称升序（zh 拼音序：科幻 < 历史 < 推理 < 未分类 < 悬疑）——结果不随输入顺序漂移', () => {
        const a = buildGenreOptions([{ genres: ['历史', '推理'] }]);
        const b = buildGenreOptions([{ genres: ['推理', '历史'] }]);
        expect(a.map((o) => o.label)).toEqual(b.map((o) => o.label));
        expect(a.map((o) => o.label)).toEqual(['历史', '推理']);
    });

    it('同一条目内的重复题材只计一次（不虚增频次）', () => {
        expect(buildGenreOptions([{ genres: ['科幻', ' 科幻 ', '科幻'] }])).toEqual([
            { key: '科幻', label: '科幻', count: 1 },
        ]);
    });

    it('池里全是无题材条目 → 只有未分类一行', () => {
        expect(buildGenreOptions([{ genres: [] }, {}])).toEqual([
            { key: GENRE_NONE_KEY, label: GENRE_NONE_LABEL, count: 2 },
        ]);
    });

    it('池里没有无题材条目 → 不产生未分类行', () => {
        expect(buildGenreOptions([{ genres: ['科幻'] }]).some((o) => o.key === GENRE_NONE_KEY)).toBe(false);
    });

    it('空池 → 空数组；未分类恒在末位', () => {
        expect(buildGenreOptions([])).toEqual([]);
        const opts = buildGenreOptions([{ genres: ['科幻'] }, { genres: ['科幻'] }, {}]);
        expect(opts[opts.length - 1].key).toBe(GENRE_NONE_KEY);
    });

    it('不改动入参数组（纯函数）', () => {
        const input = [{ genres: ['科幻', '推理'] }];
        const snapshot = JSON.stringify(input);
        buildGenreOptions(input);
        expect(JSON.stringify(input)).toBe(snapshot);
    });
});

describe('matchesGenres · 多选 OR、空选不过滤', () => {
    it('未选任何题材 → 全部放行（等于没有这一维）', () => {
        expect(matchesGenres({ genres: ['科幻'] }, [])).toBe(true);
        expect(matchesGenres({ genres: [] }, [])).toBe(true);
    });

    it('单选：命中该题材才留下', () => {
        expect(matchesGenres({ genres: ['科幻', '推理'] }, ['科幻'])).toBe(true);
        expect(matchesGenres({ genres: ['推理'] }, ['科幻'])).toBe(false);
    });

    it('多选是 OR（值之间任一命中即留）', () => {
        expect(matchesGenres({ genres: ['推理'] }, ['科幻', '推理'])).toBe(true);
        expect(matchesGenres({ genres: ['历史'] }, ['科幻', '推理'])).toBe(false);
    });

    it('未分类键只命中「无题材」条目', () => {
        expect(matchesGenres({ genres: [] }, [GENRE_NONE_KEY])).toBe(true);
        expect(matchesGenres({}, [GENRE_NONE_KEY])).toBe(true);
        expect(matchesGenres({ genres: ['科幻'] }, [GENRE_NONE_KEY])).toBe(false);
    });

    it('未分类与具体题材同选（OR）', () => {
        expect(matchesGenres({ genres: [] }, [GENRE_NONE_KEY, '科幻'])).toBe(true);
        expect(matchesGenres({ genres: ['科幻'] }, [GENRE_NONE_KEY, '科幻'])).toBe(true);
        expect(matchesGenres({ genres: ['历史'] }, [GENRE_NONE_KEY, '科幻'])).toBe(false);
    });
});

describe('resolveGenreScope · 视图级可见性（用户 2026-09-22 指定）', () => {
    it('阅读页签：全部 → 不提供；文学 / 网文 → 各自一套', () => {
        expect(resolveGenreScope('book', 'book', 'all')).toBeNull();
        expect(resolveGenreScope('book', 'book', 'book')).toEqual({ key: 'book:book', type: 'book', bookKind: 'book' });
        expect(resolveGenreScope('book', 'book', 'novel')).toEqual({ key: 'book:novel', type: 'book', bookKind: 'novel' });
    });

    it('阅读的文学与网文是两套独立作用域（key 不同）', () => {
        const lit = resolveGenreScope('book', 'book', 'book');
        const web = resolveGenreScope('book', 'book', 'novel');
        expect(lit?.key).not.toBe(web?.key);
    });

    it('影视聚合页签：全部 → 不提供；动画 / 电视剧 / 电影 → 各自一套', () => {
        expect(resolveGenreScope(null, 'all', 'all')).toBeNull();
        expect(resolveGenreScope(null, 'anime', 'all')).toEqual({ key: 'type:anime', type: 'anime' });
        expect(resolveGenreScope(null, 'tv', 'all')).toEqual({ key: 'type:tv', type: 'tv' });
        expect(resolveGenreScope(null, 'movie', 'all')).toEqual({ key: 'type:movie', type: 'movie' });
    });

    it('游戏 / 音乐页签：无子分类 → 恒提供', () => {
        expect(resolveGenreScope('game', 'game', 'all')).toEqual({ key: 'type:game', type: 'game' });
        expect(resolveGenreScope('music', 'music', 'all')).toEqual({ key: 'type:music', type: 'music' });
    });

    it('单类型锁定页签（movie/tv/anime）恒提供', () => {
        for (const t of ['movie', 'tv', 'anime'] as const) {
            expect(resolveGenreScope(t, t, 'all')).toEqual({ key: `type:${t}`, type: t });
        }
    });

    it('缺省参数容错：无 lockType 无 typeFilter → 不提供', () => {
        expect(resolveGenreScope(undefined, 'all', 'all')).toBeNull();
        expect(resolveGenreScope(null, 'all', 'book')).toBeNull();
    });

    it('书籍脏子分类（已下线的 comic）归文学作用域，不产生第三个池', () => {
        expect(resolveGenreScope('book', 'book', 'comic' as never)).toEqual({ key: 'book:book', type: 'book', bookKind: 'book' });
    });
});

describe('matchesGenreScope · 池成员判定', () => {
    it('类型作用域只收该类型', () => {
        const scope = resolveGenreScope(null, 'movie', 'all')!;
        expect(matchesGenreScope({ type: 'movie' }, scope)).toBe(true);
        expect(matchesGenreScope({ type: 'tv' }, scope)).toBe(false);
    });

    it('书籍子分类作用域按 bookKind 分池，未标 kind 的存量书归文学', () => {
        const lit = resolveGenreScope('book', 'book', 'book')!;
        const web = resolveGenreScope('book', 'book', 'novel')!;
        expect(matchesGenreScope({ type: 'book' }, lit)).toBe(true);
        expect(matchesGenreScope({ type: 'book', bookKind: 'novel' }, lit)).toBe(false);
        expect(matchesGenreScope({ type: 'book', bookKind: 'novel' }, web)).toBe(true);
        expect(matchesGenreScope({ type: 'movie' }, web)).toBe(false);
    });
});

describe('genrePillLabel · 胶囊文案（未选=全部；1 项=名称；≥2 项=池序第一个+N-1）', () => {
    const options = buildGenreOptions([
        { genres: ['科幻', '科幻', '推理'] },
        { genres: ['推理', '悬疑'] },
        { genres: ['悬疑'] },
        { genres: [] },
    ]);

    it('未选 → 全部', () => {
        expect(genrePillLabel(options, [])).toBe('全部');
    });

    it('选 1 项 → 该题材名', () => {
        expect(genrePillLabel(options, ['悬疑'])).toBe('悬疑');
        expect(genrePillLabel(options, [GENRE_NONE_KEY])).toBe(GENRE_NONE_LABEL);
    });

    it('选 ≥2 项 → 「池序第一个 +N-1」，与勾选先后无关', () => {
        expect(genrePillLabel(options, ['推理', '悬疑'])).toBe('推理+1');
        expect(genrePillLabel(options, ['悬疑', '推理'])).toBe('推理+1');
        expect(genrePillLabel(options, ['悬疑', '推理', GENRE_NONE_KEY])).toBe('推理+2');
    });

    it('池序以频次为准：高频题材即使后被勾选也排在显示位', () => {
        expect(options.map((o) => o.label)).toEqual(['推理', '悬疑', '科幻', GENRE_NONE_LABEL]);
        // 「悬疑」「推理」频次同为 2 → 名称拼音序（t < x）定先后；
        // 勾选顺序反过来也必须显示「推理+1」（按池序，不按点击先后）
        expect(genrePillLabel(options, ['推理', '悬疑'])).toBe('推理+1');
        expect(genrePillLabel(options, ['悬疑', '推理'])).toBe('推理+1');
    });

    it('已选项已不在池内（数据变动）时不崩、仍给出计数', () => {
        expect(genrePillLabel(options, ['已消失的题材'])).toBe('已消失的题材');
        expect(genrePillLabel(options, ['已消失的题材', '推理'])).toBe('推理+1');
    });
});
