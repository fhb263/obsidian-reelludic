// 影视「集关联」共用真源测试：集数组落库规整（**保位**）+ 集按钮悬停文案。
// 🔴 #446（2026-10-01 用户报障）：旧口径「压缩空位保序」与读侧的按下标配对矛盾 ——
//    「编辑第 2 集」里填的集标题，保存后跑到第 1 集（用户看到的就是「保存不生效」）。
import { describe, it, expect } from 'vitest';
import {
    episodeHintLabel,
    storeEpisodeList,
    episodeSectionSize,
    episodeSections,
    EP_BTN_W,
    EP_BTN_GAP,
    EP_SECTION_ROWS,
} from 'pure/episodeAssoc';

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

describe('episodeSectionSize 每区集数（列数 × 10 行）', () => {
    it('几何常数与按钮样式一致（36px 按钮 / 6px 间距 / 10 行）', () => {
        expect(EP_BTN_W).toBe(36);
        expect(EP_BTN_GAP).toBe(6);
        expect(EP_SECTION_ROWS).toBe(10);
    });

    it('宽 540px ⇒ 13 列 × 10 行 = 130（用户举例「第1-130集」的来历）', () => {
        // 13*36 + 12*6 = 468 + 72 = 540 恰好放满；14 列需 582
        expect(episodeSectionSize(540)).toBe(130);
        expect(episodeSectionSize(582)).toBe(140);
    });

    it('宽度不明（0 / 负数 / NaN）回落 13 列，绝不返回 0', () => {
        expect(episodeSectionSize(0)).toBe(130);
        expect(episodeSectionSize(-100)).toBe(130);
        expect(episodeSectionSize(NaN)).toBe(130);
    });

    it('极窄容器也至少 1 列 × rows，不会退化成 0', () => {
        expect(episodeSectionSize(10)).toBe(10);
        expect(episodeSectionSize(1, 3)).toBe(3);
    });

    it('rows 可覆盖；非法 rows 回落 10', () => {
        expect(episodeSectionSize(540, 5)).toBe(65);
        expect(episodeSectionSize(540, 0)).toBe(130);
    });
});

describe('episodeSections 分区切片', () => {
    it('130 集 / 每区 130 ⇒ 单区，标题照给「第 1-130 集」', () => {
        expect(episodeSections(130, 130)).toEqual([{ start: 1, end: 130, label: '第 1-130 集' }]);
    });

    it('131 集 / 每区 130 ⇒ 两区，末区只到 131', () => {
        expect(episodeSections(131, 130)).toEqual([
            { start: 1, end: 130, label: '第 1-130 集' },
            { start: 131, end: 131, label: '第 131 集' },
        ]);
    });

    it('两侧与边界：total 0 / 负数 ⇒ 空数组；恰好整除 ⇒ 不多出空区', () => {
        expect(episodeSections(0, 10)).toEqual([]);
        expect(episodeSections(-5, 10)).toEqual([]);
        expect(episodeSections(20, 10)).toHaveLength(2);
        expect(episodeSections(20, 10)[1]).toEqual({ start: 11, end: 20, label: '第 11-20 集' });
    });

    it('分区连续无缝无重叠（1..N 恰好覆盖一次）', () => {
        const secs = episodeSections(1000, 130);
        expect(secs).toHaveLength(8);
        expect(secs[0].start).toBe(1);
        expect(secs[secs.length - 1].end).toBe(1000);
        for (let i = 1; i < secs.length; i++) expect(secs[i].start).toBe(secs[i - 1].end + 1);
    });

    it('per 非法（0 / NaN）按 1 集一区，不丢集', () => {
        expect(episodeSections(3, 0).map((s) => s.end)).toEqual([1, 2, 3]);
        expect(episodeSections(3, NaN)).toHaveLength(3);
    });
});
