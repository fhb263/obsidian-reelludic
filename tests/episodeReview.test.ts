import { describe, expect, it } from 'vitest';
import {
    EMPTY_EPISODE_REVIEW,
    EPISODE_REVIEWS_FM_KEY,
    episodeCellEffect,
    episodeReviewLines,
    isEmptyEpisodeReview,
    normalizeEpisodeReview,
    normalizeEpisodeReviews,
    parseEpisodeReviews,
    reviewedCount,
    reviewAt,
    serializeEpisodeReviews,
    setReviewAt,
    type EpisodeReview,
} from 'pure/episodeReview';

/**
 * ③ 单集评价（用户 2026-11-17）的纯层判据。
 *
 * 钉的都是**会静默出错**的那几条 —— 归一把脏值吞掉、清空写不回、yaml 单行解析、
 * 展示投影的集号排序。这几条任一漂移，用户看到的都是「明明标了却没生效」这类没法排查的现象。
 */
describe('episodeReview · 归一', () => {
    it('空评价（未看 + 无标签 + 无心情 + 无短评）⇒ undefined，不占 yaml', () => {
        expect(normalizeEpisodeReview({ status: 'unwatched' })).toBeUndefined();
        expect(normalizeEpisodeReview(EMPTY_EPISODE_REVIEW)).toBeUndefined();
        expect(normalizeEpisodeReview({})).toBeUndefined();
        expect(normalizeEpisodeReview(null)).toBeUndefined();
        expect(isEmptyEpisodeReview(undefined)).toBe(true);
    });

    it('只要有一项非默认就不算空（否则标注会被整条吞掉）', () => {
        expect(normalizeEpisodeReview({ status: 'watched' })).toEqual({ status: 'watched' });
        expect(normalizeEpisodeReview({ status: 'unwatched', tags: ['highlight'] })?.tags).toEqual(['highlight']);
        expect(normalizeEpisodeReview({ status: 'unwatched', mood: 'wow' })?.mood).toBe('wow');
        expect(normalizeEpisodeReview({ status: 'unwatched', note: '好看' })?.note).toBe('好看');
    });

    it('非法状态降级为未看，⛔ 不整条丢弃（后半截标签/短评还要留住）', () => {
        const r = normalizeEpisodeReview({ status: 'finished', tags: ['flaw'], note: '烂尾' });
        expect(r?.status).toBe('unwatched');
        expect(r?.tags).toEqual(['flaw']);
        expect(r?.note).toBe('烂尾');
    });

    it('标签去重保序；非法心情丢弃；短评 trim 后为空则不留字段', () => {
        const r = normalizeEpisodeReview({
            status: 'watched',
            tags: ['flaw', 'highlight', 'flaw', 'nope'],
            mood: 'not-a-mood',
            note: '   有想法   ',
        });
        expect(r?.tags).toEqual(['flaw', 'highlight']);
        expect(r?.mood).toBeUndefined();
        expect(r?.note).toBe('有想法');
        expect(normalizeEpisodeReview({ status: 'watched', note: '   ' })?.note).toBeUndefined();
    });

    it('整表归一：键必须是集下标数字串，空表返回 undefined 而不是 {}', () => {
        expect(normalizeEpisodeReviews({ '0': { status: 'watched' }, abc: { status: 'watched' } })).toEqual({
            '0': { status: 'watched' },
        });
        // 全是空评价 ⇒ 整表为空 ⇒ undefined（返回 {} 会让「有没有评价」永远为真）
        expect(normalizeEpisodeReviews({ '0': { status: 'unwatched' } })).toBeUndefined();
        expect(normalizeEpisodeReviews([])).toBeUndefined();
        expect(normalizeEpisodeReviews('nope')).toBeUndefined();
    });
});

describe('episodeReview · 按集读写', () => {
    it('setReviewAt 返回新对象，不改入参（catalog 侧靠新引用触发脏检查）', () => {
        const before: Record<string, EpisodeReview> = { '0': { status: 'watched' } };
        const after = setReviewAt(before, 1, { status: 'watching' });
        expect(after).toEqual({ '0': { status: 'watched' }, '1': { status: 'watching' } });
        expect(before).toEqual({ '0': { status: 'watched' } });
        expect(after).not.toBe(before);
    });

    it('写空评价 ⇒ 删掉这一集；整表空了连字段一起没', () => {
        const one = setReviewAt({ '0': { status: 'watched' } }, 0, EMPTY_EPISODE_REVIEW);
        expect(one).toBeUndefined();
        const two = setReviewAt({ '0': { status: 'watched' }, '1': { status: 'watching' } }, 1, EMPTY_EPISODE_REVIEW);
        expect(two).toEqual({ '0': { status: 'watched' } });
    });

    it('reviewAt 缺省与越界都回 undefined；reviewedCount 只数非空', () => {
        const map = { '0': { status: 'watched' as const }, '2': { status: 'unwatched' as const } };
        expect(reviewAt(map, 0)?.status).toBe('watched');
        expect(reviewAt(map, 1)).toBeUndefined();
        expect(reviewAt(undefined, 0)).toBeUndefined();
        expect(reviewAt(map, -1)).toBeUndefined();
        expect(reviewedCount(map)).toBe(1);
        expect(reviewedCount(undefined)).toBe(0);
    });
});

describe('episodeReview · 选集格特效', () => {
    it('高光 ⇒ 流光；槽点 ⇒ 崩坏；平庸与无标签 ⇒ 无特效', () => {
        expect(episodeCellEffect({ status: 'watched', tags: ['highlight'] })).toBe('highlight');
        expect(episodeCellEffect({ status: 'watched', tags: ['flaw'] })).toBe('flaw');
        expect(episodeCellEffect({ status: 'watched', tags: ['plain'] })).toBeNull();
        expect(episodeCellEffect({ status: 'watched' })).toBeNull();
        expect(episodeCellEffect(undefined)).toBeNull();
    });

    it('高光与槽点同时打 ⇒ 只出流光（判据顺序固定在纯层）', () => {
        expect(episodeCellEffect({ status: 'watched', tags: ['flaw', 'highlight'] })).toBe('highlight');
    });
});

describe('episodeReview · yaml 单行回环', () => {
    it('序列化再解析得到同一张表（写下去的行与读回来的必须逐字相同）', () => {
        const map: Record<string, EpisodeReview> = {
            '0': { status: 'watched', tags: ['highlight'], mood: 'wow', note: '开场就炸' },
            '3': { status: 'watching' },
        };
        const line = serializeEpisodeReviews(map);
        expect(line).not.toContain('\n');
        expect(parseEpisodeReviews(line)).toEqual(map);
    });

    it('单行才活得下来：本仓的 frontmatter 解析器是逐行的', () => {
        // 嵌套块形态（`0:\n  status: watched`）会被逐行解析器拆成两个顶层键 ⇒ 这是选单行的唯一理由
        const line = serializeEpisodeReviews({ '0': { status: 'watched' } });
        expect(line.startsWith('{')).toBe(true);
        expect(line.split('\n').length).toBe(1);
    });

    it('空表 ⇒ 空串（调用方据此不写这一行）；坏值/空串 ⇒ undefined 且不抛', () => {
        expect(serializeEpisodeReviews(undefined)).toBe('');
        expect(serializeEpisodeReviews({})).toBe('');
        expect(parseEpisodeReviews('')).toBeUndefined();
        expect(parseEpisodeReviews(undefined)).toBeUndefined();
        expect(parseEpisodeReviews('0: watched')).toBeUndefined();
        expect(parseEpisodeReviews('{ bad json')).toBeUndefined();
    });

    it('短评里的引号/换行不会破坏结构（JSON.stringify 负责转义）', () => {
        const note = '他说"这也行"？\n还行';
        const back = parseEpisodeReviews(serializeEpisodeReviews({ '1': { status: 'watched', note } }));
        expect(back?.['1'].note).toBe(note);
    });

    it('frontmatter 键名与 metaFields 同源（改名必须两处一起改）', () => {
        expect(EPISODE_REVIEWS_FM_KEY).toBe('episode_reviews');
    });
});

describe('episodeReview · 笔记条目卡展示投影', () => {
    it('只出有内容的集，按集号数值升序（第 10 集不能跑到第 9 集前面）', () => {
        const { lines, total } = episodeReviewLines({
            '10': { status: 'watched', tags: ['flaw'] },
            '9': { status: 'watched', tags: ['highlight'] },
            '2': { status: 'unwatched' },
        });
        expect(total).toBe(2);
        expect(lines.map((l) => l.index)).toEqual([9, 10]);
        expect(lines.map((l) => l.label)).toEqual(['第 10 集', '第 11 集']);
    });

    it('展示串全部走既有中文名/emoji 表（⛔ 不出现英文 id）', () => {
        const { lines } = episodeReviewLines({
            '0': { status: 'watched', tags: ['highlight', 'plain'], mood: 'wow', note: ' 开场就炸 ' },
        });
        expect(lines[0].status).toBe('已看');
        expect(lines[0].tags).toBe('高光、平庸');
        expect(lines[0].mood).toContain('震撼');
        expect(lines[0].note).toBe('开场就炸');
    });

    it('没选的项给空串而不是 undefined（渲染层直接判真假，不用再转一次）', () => {
        const { lines } = episodeReviewLines({ '0': { status: 'watching' } });
        expect(lines[0]).toMatchObject({ status: '在看', tags: '', mood: '', note: '' });
    });

    it('limit 只截展示条数，total 仍是全量（卡片要能说出「还有 N 集」）', () => {
        const map: Record<string, EpisodeReview> = {};
        for (let i = 0; i < 5; i += 1) map[String(i)] = { status: 'watched' };
        const { lines, total } = episodeReviewLines(map, 2);
        expect(lines.length).toBe(2);
        expect(total).toBe(5);
    });

    it('一条评价都没有 ⇒ 空数组（渲染层据此整块不建）', () => {
        expect(episodeReviewLines(undefined).lines).toEqual([]);
        expect(episodeReviewLines({}).total).toBe(0);
        expect(episodeReviewLines({ '0': { status: 'unwatched' } }).lines).toEqual([]);
    });
});
