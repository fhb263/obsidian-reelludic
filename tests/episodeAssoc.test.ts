// 影视「集关联」共用真源测试：集数组落库规整（**保位**）+ 集按钮悬停文案。
// 🔴 #446（2026-10-01 用户报障）：旧口径「压缩空位保序」与读侧的按下标配对矛盾 ——
//    「编辑第 2 集」里填的集标题，保存后跑到第 1 集（用户看到的就是「保存不生效」）。
import { describe, it, expect } from 'vitest';
import {
    episodeHintLabel,
    storeEpisodeList,
    episodeSectionSize,
    episodeSections,
    clampTabIndex,
    tabIndexOfEpisode,
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

// 🔴 2026-10-25 用户：「编辑属性窗口的总选集如 1000 集，分区应该按选项卡切换而不是平铺」
//   ⇒ 选项卡是「分区下标」的算术：钳制错 = 点了显示别的区，越界 = 渲染空白。
//   这两个函数放在纯模块正是为了能被这里钉住（组件内联函数测不到）。
describe('clampTabIndex 分区下标钳制（0 基）', () => {
    it('区间内原样返回', () => {
        expect(clampTabIndex(0, 8)).toBe(0);
        expect(clampTabIndex(3, 8)).toBe(3);
        expect(clampTabIndex(7, 8)).toBe(7);
    });

    it('越界：负数 → 0；超末 → 末位', () => {
        expect(clampTabIndex(-3, 8)).toBe(0);
        expect(clampTabIndex(8, 8)).toBe(7);
        expect(clampTabIndex(999, 8)).toBe(7);
    });

    it('非法输入：len ≤ 0 / NaN / 非有限 → 0（不返回 NaN、不出界）', () => {
        expect(clampTabIndex(2, 0)).toBe(0);
        expect(clampTabIndex(2, -1)).toBe(0);
        expect(clampTabIndex(NaN, 8)).toBe(0);
        expect(clampTabIndex(Infinity, 8)).toBe(0);
        expect(clampTabIndex(2.7, 8)).toBe(2); // 小数向下取整，⛔ 不四舍五入
    });
});

describe('tabIndexOfEpisode「已看到」落第几区', () => {
    const secs = episodeSections(1000, 130); // 8 区

    it('落在区内部 / 区边界都归该区', () => {
        expect(tabIndexOfEpisode(1, secs)).toBe(0);
        expect(tabIndexOfEpisode(130, secs)).toBe(0); // 首区末集
        expect(tabIndexOfEpisode(131, secs)).toBe(1); // 次区首集
        expect(tabIndexOfEpisode(500, secs)).toBe(3);
        expect(tabIndexOfEpisode(1000, secs)).toBe(7); // 末区末集
    });

    it('无进度 / 非法集号 → 第 0 区（没有进度就该落第一区）', () => {
        expect(tabIndexOfEpisode(0, secs)).toBe(0);
        expect(tabIndexOfEpisode(-5, secs)).toBe(0);
        expect(tabIndexOfEpisode(NaN, secs)).toBe(0);
    });

    it('集号超出总集数 → 末区（⛔ 不是 -1、不是 0）', () => {
        expect(tabIndexOfEpisode(5000, secs)).toBe(7);
    });

    it('空分区数组 → 0（不抛错）', () => {
        expect(tabIndexOfEpisode(3, [])).toBe(0);
    });
});
