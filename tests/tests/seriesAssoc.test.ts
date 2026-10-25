// 系列「批量关联」清单纯逻辑（pure/seriesAssoc）单测（#629）。
//
// 这批判据的**要害只有一条**：与 `pure/actionLabel.hasActionEntry` **同口径** ——
//   一律「trim 后非空」；空串 / 纯空格 / undefined 洞**都不算已关联**。
//   （判据一旦分叉，界面上就会出现「清单说未关联、卡片却给得出 ▶」这种自相矛盾。）
import { describe, it, expect } from 'vitest';
import {
    assocFlagsOf,
    assocLocalLabel,
    assocRemoteLabel,
    assocSummaryOf,
    seriesAssocHeadline,
    seriesAssocRowOf,
    seriesAssocRows,
    seriesAssocStats,
} from 'pure/seriesAssoc';
import { hasActionEntry } from 'pure/actionLabel';
import { ENTRY_TYPES, type EntryType, type MediaEntry } from 'data/types';

/** 最小化构造器：测试只关心参与分支的字段，其余走 default 填充 */
function entry(partial: Partial<MediaEntry>): MediaEntry {
    const base: MediaEntry = {
        id: 'e1',
        type: 'movie',
        title: 'X',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
    };
    return { ...base, ...partial };
}

describe('assocFlagsOf —— 单路径三类（书 / 游戏 / 音乐）', () => {
    it('书籍：只有本地文件 ⇒ local（计数 1 / 网络 0）', () => {
        const f = assocFlagsOf(entry({ type: 'book', bookFile: '书/活着.epub' }));
        expect(f).toEqual({ local: true, remote: false, linked: true, localCount: 1, remoteCount: 0 });
    });

    it('书籍：只有在线阅读链接 ⇒ remote（#535 口径：它也算「有入口」）', () => {
        const f = assocFlagsOf(entry({ type: 'book', readUrl: 'https://weread.qq.com/x' }));
        expect(f).toEqual({ local: false, remote: true, linked: true, localCount: 0, remoteCount: 1 });
    });

    it('书籍：两条都有 ⇒ 都算（计数各 1）', () => {
        const f = assocFlagsOf(entry({ type: 'book', bookFile: 'a.epub', readUrl: 'https://x' }));
        expect(f).toEqual({ local: true, remote: true, linked: true, localCount: 1, remoteCount: 1 });
    });

    it('空串 / 纯空格**不算**（⛔ 与 hasActionEntry 同口径 —— 这是本批最容易分叉的一处）', () => {
        expect(assocFlagsOf(entry({ type: 'book', bookFile: '   ' })).linked).toBe(false);
        expect(assocFlagsOf(entry({ type: 'book', bookFile: '' })).linked).toBe(false);
        expect(assocFlagsOf(entry({ type: 'book', readUrl: '\t' })).linked).toBe(false);
        expect(hasActionEntry(entry({ type: 'book', bookFile: '   ' }))).toBe(false);
    });

    it('游戏：快捷方式 / 网络路径两路（#534 起 gameUrl 也认）', () => {
        expect(assocFlagsOf(entry({ type: 'game', gameLaunchPath: 'x.lnk' })).local).toBe(true);
        expect(assocFlagsOf(entry({ type: 'game', gameUrl: 'https://store' })).remote).toBe(true);
        expect(assocFlagsOf(entry({ type: 'game', gameUrl: '  ' })).linked).toBe(false);
    });

    it('音乐：本地音频 / 网络地址两路（#601 起 audioUrl 也认）', () => {
        expect(assocFlagsOf(entry({ type: 'music', audioPath: 'a.flac' })).local).toBe(true);
        expect(assocFlagsOf(entry({ type: 'music', audioUrl: 'https://music.163.com/x' })).remote).toBe(true);
        expect(assocFlagsOf(entry({ type: 'music' })).linked).toBe(false);
    });
});

describe('assocFlagsOf —— 影视（逐集数组，计数是真条数）', () => {
    it('本地 3 集 + 网络 15 集 ⇒ 两个计数都是真条数', () => {
        const f = assocFlagsOf(
            entry({
                type: 'tv',
                episodeFiles: ['a.mp4', 'b.mp4', 'c.mp4'],
                episodeUrls: Array.from({ length: 15 }, (_, i) => `https://b/${i + 1}`),
            }),
        );
        expect(f).toEqual({ local: true, remote: true, linked: true, localCount: 3, remoteCount: 15 });
    });

    it('数组里的**洞**（`storeEpisodeList` 保位时会留）与空串都不计数 —— 那是「没关联」不是「关联了」', () => {
        // ⚠️ 用**真稀疏数组**造洞（`out[i] = t` 跳着写 ⇒ 中间是 hole，读出来 undefined）——
        //    这正是 `pure/episodeAssoc.storeEpisodeList` 产出的形态，⛔ 别写成 `['a', undefined, '']`
        //    （TS 里那也不是 `string[]` 的合法元素，只能靠 cast 硬塞 ⇒ 测的就不是真实数据形态了）。
        const files: string[] = [];
        files[0] = 'a.mp4';
        files[4] = 'e.mp4';
        const f = assocFlagsOf(entry({ type: 'anime', episodeFiles: files }));
        expect(files.length).toBe(5);
        expect(f.localCount).toBe(2);
        expect(f.local).toBe(true);
        expect(assocFlagsOf(entry({ type: 'anime', episodeFiles: ['', '  ', '\t'] })).local).toBe(false);
    });

    it('老字段 `links` 也算网络源（hasActionEntry 认它 ⇒ 这里必须认，否则清单与卡片自相矛盾）', () => {
        const e = entry({ type: 'movie', links: [{ label: '在线', url: 'https://x' }] });
        expect(assocFlagsOf(e).remoteCount).toBe(1);
        expect(hasActionEntry(e)).toBe(true);
    });

    it('全空 / 数组不存在 ⇒ 未关联', () => {
        expect(assocFlagsOf(entry({ type: 'movie' })).linked).toBe(false);
        expect(assocFlagsOf(entry({ type: 'tv', episodeFiles: [], episodeUrls: [] })).linked).toBe(false);
    });
});

describe('assocSummaryOf —— 清单里那一列文案', () => {
    it('未关联 = 「未关联」（不带任何「已关联 · 」前缀）', () => {
        expect(assocSummaryOf(entry({ type: 'book' }))).toBe('未关联');
        expect(assocSummaryOf(entry({ type: 'tv' }))).toBe('未关联');
    });

    it('单路径三类：本地 / 网络 / 两者都有（顺序恒「本地在前」）', () => {
        expect(assocSummaryOf(entry({ type: 'book', bookFile: 'a.epub' }))).toBe('已关联 · 本地文件');
        expect(assocSummaryOf(entry({ type: 'book', readUrl: 'https://x' }))).toBe('已关联 · 在线阅读链接');
        expect(assocSummaryOf(entry({ type: 'book', bookFile: 'a.epub', readUrl: 'https://x' })))
            .toBe('已关联 · 本地文件 + 在线阅读链接');
        expect(assocSummaryOf(entry({ type: 'game', gameLaunchPath: 'x.lnk' }))).toBe('已关联 · 快捷方式');
        expect(assocSummaryOf(entry({ type: 'game', gameUrl: 'https://s' }))).toBe('已关联 · 网络路径');
        expect(assocSummaryOf(entry({ type: 'music', audioPath: 'a.flac' }))).toBe('已关联 · 本地音频');
        expect(assocSummaryOf(entry({ type: 'music', audioUrl: 'https://m' }))).toBe('已关联 · 网络地址');
    });

    it('影视：按条数说（`本地 3 集 + 网络 15 集`），且**不出现「本地 0 集」这类噪音**', () => {
        expect(assocSummaryOf(entry({ type: 'tv', episodeFiles: ['a.mp4', 'b.mp4', 'c.mp4'] })))
            .toBe('已关联 · 本地 3 集');
        expect(assocSummaryOf(entry({ type: 'anime', episodeUrls: ['u1', 'u2'] }))).toBe('已关联 · 网络 2 集');
        expect(assocSummaryOf(entry({ type: 'tv', episodeFiles: ['a.mp4'], episodeUrls: ['u1', 'u2'] })))
            .toBe('已关联 · 本地 1 集 + 网络 2 集');
    });
});

describe('类型词表（与 actionReadyHint 同一套说法）', () => {
    it('四类的本地 / 网络词各就各位', () => {
        expect(ENTRY_TYPES.map((t: EntryType) => assocLocalLabel(t)))
            .toEqual(['本地视频', '本地视频', '本地视频', '本地文件', '快捷方式', '本地音频']);
        expect(ENTRY_TYPES.map((t: EntryType) => assocRemoteLabel(t)))
            .toEqual(['网络地址', '网络地址', '网络地址', '在线阅读链接', '网络路径', '网络地址']);
    });
});

describe('seriesAssocStats / seriesAssocHeadline —— 顶部读数', () => {
    it('只吃 `linked` 一个布尔（清单行 / 条目 / 任意投影都能喂）', () => {
        const s = seriesAssocStats([{ linked: true }, { linked: false }, { linked: true }]);
        expect(s).toEqual({ total: 3, linked: 2, unlinked: 1 });
    });

    it('空清单 ⇒ 0 / 0 / 0（⛔ 不出现 NaN）', () => {
        expect(seriesAssocStats([])).toEqual({ total: 0, linked: 0, unlinked: 0 });
    });

    it('文案：`共 N 部 · 已关联 M · 待补 K`', () => {
        expect(seriesAssocHeadline({ total: 15, linked: 3, unlinked: 12 })).toBe('共 15 部 · 已关联 3 · 待补 12');
    });
});

describe('seriesAssocRowOf / seriesAssocRows —— 投影成清单行', () => {
    it('序号取条目原样（可以是 undefined / 有空档，⛔ 别拿循环下标冒充）', () => {
        expect(seriesAssocRowOf(entry({ id: 'a', title: '甲', series: 'S', seriesIndex: 7 })))
            .toEqual({ id: 'a', index: 7, title: '甲', summary: '未关联', linked: false });
        expect(seriesAssocRowOf(entry({ id: 'b', title: '乙' })).index).toBeUndefined();
    });

    it('顺序照传入的来（排序归 pure/seriesGroup.sortSeriesItems）', () => {
        const rows = seriesAssocRows([
            entry({ id: 'a', title: '甲', type: 'book' }),
            entry({ id: 'b', title: '乙', type: 'book', bookFile: 'b.epub' }),
        ]);
        expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
        expect(rows.map((r) => r.summary)).toEqual(['未关联', '已关联 · 本地文件']);
    });
});
