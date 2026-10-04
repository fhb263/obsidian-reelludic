// 影视「集关联」共用真源测试：集数组落库规整（**保位**）+ 集按钮悬停文案。
// 🔴 #446（2026-10-01 用户报障）：旧口径「压缩空位保序」与读侧的按下标配对矛盾 ——
//    「编辑第 2 集」里填的集标题，保存后跑到第 1 集（用户看到的就是「保存不生效」）。
import { describe, it, expect } from 'vitest';
import { episodeHintLabel, storeEpisodeList } from 'pure/episodeAssoc';

describe('storeEpisodeList 集数组落库规整（保位）', () => {
    it('🔴 位置即集号：第 2 集有值就落在 1 号位，空位留洞（⛔ 不压缩）', () => {
        const r = storeEpisodeList([undefined, '标题']);
        expect(r?.length).toBe(2);
        expect(r?.[0]).toBeUndefined();
        expect(r?.[1]).toBe('标题');
    });

    it('中间的洞保留（该集未关联），尾部空位去掉', () => {
        const r = storeEpisodeList(['a', undefined, 'c', undefined, undefined]);
        expect(r?.length).toBe(3);
        expect(r?.[0]).toBe('a');
        expect(r?.[1]).toBeUndefined();
        expect(r?.[2]).toBe('c');
    });

    it('trim；非法类型 / 空串 / 纯空白 → 该位视为未关联', () => {
        const r = storeEpisodeList(['  a.mp4  ', 42, '', '   ', 'b']);
        expect(r?.length).toBe(5);
        expect(r?.[0]).toBe('a.mp4');
        expect(r?.[1]).toBeUndefined();
        expect(r?.[2]).toBeUndefined();
        expect(r?.[3]).toBeUndefined();
        expect(r?.[4]).toBe('b');
    });

    it('整段空 / 非数组 → undefined（字段缺省不写）', () => {
        expect(storeEpisodeList([])).toBeUndefined();
        expect(storeEpisodeList([undefined, ''])).toBeUndefined();
        expect(storeEpisodeList('x')).toBeUndefined();
        expect(storeEpisodeList(undefined)).toBeUndefined();
    });

    it('maxLen：按当前总集数截取；超出部分不入结果；非法/负数按 0', () => {
        expect(storeEpisodeList(['1', '2', '3'], 2)?.length).toBe(2);
        expect(storeEpisodeList(['1', '2', '3'], 2)).toEqual(['1', '2']);
        expect(storeEpisodeList(['1'], 0)).toBeUndefined();
        expect(storeEpisodeList(['1'], -5)).toBeUndefined();
        expect(storeEpisodeList(['1'], NaN)?.length).toBe(1); // 非法上限 → 按原长
    });

    it('落盘往返：JSON 把洞写成 null，读回仍是同一个位置（不再移位）', () => {
        const r = storeEpisodeList([undefined, '标题']) as string[];
        const back = JSON.parse(JSON.stringify(r)) as unknown[];
        const again = storeEpisodeList(back);
        expect(again?.[1]).toBe('标题');
        expect(again?.[0]).toBeUndefined();
    });
});

describe('episodeHintLabel 集按钮悬停文案', () => {
    it('剧集 / 动画 = 「第 N 集 集标题」；未填标题只「第 N 集」', () => {
        expect(episodeHintLabel(0, '开始', false)).toBe('第 1 集 开始');
        expect(episodeHintLabel(11, '第 12 话', false)).toBe('第 12 集 第 12 话');
        expect(episodeHintLabel(1, undefined, false)).toBe('第 2 集');
        expect(episodeHintLabel(1, '   ', false)).toBe('第 2 集');
    });

    it('电影 / 单文件（single）= 标题本身；未填 → 空串（调用方自行回落）', () => {
        expect(episodeHintLabel(0, '开始', true)).toBe('开始');
        expect(episodeHintLabel(0, undefined, true)).toBe('');
    });
});
