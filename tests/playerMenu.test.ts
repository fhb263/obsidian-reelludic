import { describe, it, expect } from 'vitest';
import {
    buildSpeedOptions,
    buildEpisodeOptions,
    buildSettingOptions,
    episodeEndChoice,
    applyEpisodeEndChoice,
    nextMenuState,
    menuAnchor,
} from 'pure/playerMenu';
import { SPEED_STEPS } from 'pure/player';

describe('buildSpeedOptions（倍速面板选项）', () => {
    it('档位与顺序完全来自 SPEED_STEPS，文案走 formatSpeed', () => {
        const opts = buildSpeedOptions(1);
        expect(opts.map((o) => o.value)).toEqual([...SPEED_STEPS]);
        expect(opts.map((o) => o.label)).toEqual(['0.5×', '0.75×', '1×', '1.25×', '1.5×', '2×']);
    });
    it('当前档高亮且只有一条', () => {
        const opts = buildSpeedOptions(1.25);
        expect(opts.filter((o) => o.active).map((o) => o.value)).toEqual([1.25]);
    });
    it('当前值不在档位内时不亮任何一条（不假装归一到 1×）', () => {
        const opts = buildSpeedOptions(1.7);
        expect(opts.some((o) => o.active)).toBe(false);
    });
    it('id 用档位字符串，UI 层据它回传选中的值', () => {
        const opts = buildSpeedOptions(1);
        expect(opts.map((o) => o.id)).toEqual(['0.5', '0.75', '1', '1.25', '1.5', '2']);
    });
});

describe('buildEpisodeOptions（选集面板选项）', () => {
    const items = [
        { index: 0, title: '第一话' },
        { index: 1 },
        { index: 2, title: '第三话' },
    ];

    it('单文件（电影）没有选集，返回空表', () => {
        expect(buildEpisodeOptions(items, 0, true)).toEqual([]);
    });

    it('空列表返回空表', () => {
        expect(buildEpisodeOptions([], 0, false)).toEqual([]);
    });

    it('文案：有集标题带「· 集标题」，无集标题只有「第 N 集」', () => {
        const opts = buildEpisodeOptions(items, 0, false);
        expect(opts.map((o) => o.label)).toEqual(['第 1 集 · 第一话', '第 2 集', '第 3 集 · 第三话']);
    });

    it('id 为集下标字符串（切集直接回传）', () => {
        expect(buildEpisodeOptions(items, 0, false).map((o) => o.id)).toEqual(['0', '1', '2']);
    });

    it('当前集高亮且只有一条', () => {
        const opts = buildEpisodeOptions(items, 2, false);
        expect(opts.filter((o) => o.active).map((o) => o.index)).toEqual([2]);
    });

    it('当前下标越界时不亮任何一条', () => {
        expect(buildEpisodeOptions(items, 9, false).some((o) => o.active)).toBe(false);
    });
});

describe('buildSettingOptions（设置齿轮选项）', () => {
    const all = { pip: true, bgPlay: true, episodeEnd: 'autonext' as const };

    it('开关区在前（后台播放 / 播完这一集三选一框），动作区在后', () => {
        expect(buildSettingOptions(all).map((o) => o.id)).toEqual(['bgplay', 'epsend', 'pip', 'external']);
    });

    it('「后台播放」是开关框（on = 当前状态）；动作项既不是开关也不是选框', () => {
        const opts = buildSettingOptions(all);
        expect(opts.filter((o) => o.toggle).map((o) => o.id)).toEqual(['bgplay']);
        expect(opts[0].on).toBe(true);
        expect(opts.filter((o) => !o.toggle && !o.choices).map((o) => o.id)).toEqual(['pip', 'external']);
    });

    it('🔴「播完这一集」是三选一框：顺序与文案固定，picked 由两个字段推导（#337/#338 文案改短）', () => {
        const grp = buildSettingOptions(all).find((o) => o.choices)!;
        expect(grp.choices!.map((c) => c.id)).toEqual(['autonext', 'loopone', 'stop']);
        expect(grp.choices!.map((c) => c.label)).toEqual(['切集', '循环', '暂停']);
        expect(grp.picked).toBe('autonext');
        expect(buildSettingOptions({ pip: false, episodeEnd: 'loopone' }).find((o) => o.choices)!.picked).toBe('loopone');
        expect(buildSettingOptions({ pip: false }).find((o) => o.choices)!.picked).toBe('stop');
    });

    it('🔴 单集（电影）不显示「切集」框，picked 兜到「暂停」（#338：一集没法切）', () => {
        const grp = buildSettingOptions({ pip: false, episodeEnd: 'autonext', single: true }).find((o) => o.choices)!;
        expect(grp.choices!.map((c) => c.id)).toEqual(['loopone', 'stop']);
        expect(grp.choices!.map((c) => c.label)).toEqual(['循环', '暂停']);
        expect(grp.picked).toBe('stop');
        // 单集 + 循环 → 仍亮「循环」
        const g2 = buildSettingOptions({ pip: false, episodeEnd: 'loopone', single: true }).find((o) => o.choices)!;
        expect(g2.picked).toBe('loopone');
    });

    it('支持画中画时含「画中画」', () => {
        expect(buildSettingOptions({ pip: true }).map((o) => o.id)).toContain('pip');
    });
    it('不支持画中画时该项整条不出现（不给一个点了只会报错的入口）', () => {
        expect(buildSettingOptions({ pip: false }).map((o) => o.id)).not.toContain('pip');
    });
    it('「用系统播放器打开」恒在（mkv/HEVC 兜底是最后退路）', () => {
        expect(buildSettingOptions({ pip: false }).map((o) => o.id)).toEqual(['bgplay', 'epsend', 'external']);
    });
    it('设置项都不是高亮态（选中语义走 on / picked，不复用 is-on）', () => {
        expect(buildSettingOptions(all).some((o) => o.active)).toBe(false);
    });
});

describe('episodeEndChoice / applyEpisodeEndChoice（#337 三选一 ↔ 原有两个字段）', () => {
    it('推导：循环优先（与 onEnded 的既有优先级一致）＞ 切下一集 ＞ 都关 = 暂停', () => {
        expect(episodeEndChoice(true, true)).toBe('loopone');
        expect(episodeEndChoice(true, false)).toBe('autonext');
        expect(episodeEndChoice(false, true)).toBe('loopone');
        expect(episodeEndChoice(false, false)).toBe('stop');
    });

    it('写回：每个选项对应一组字段组合（append-only 设置不变，只是组合变化）', () => {
        expect(applyEpisodeEndChoice('autonext')).toEqual({ autoNext: true, loopOne: false });
        expect(applyEpisodeEndChoice('loopone')).toEqual({ autoNext: false, loopOne: true });
        expect(applyEpisodeEndChoice('stop')).toEqual({ autoNext: false, loopOne: false });
    });
});

describe('nextMenuState（浮层开合互斥）', () => {
    it('没开时点入口 → 打开该项', () => {
        expect(nextMenuState(null, 'episodes')).toBe('episodes');
    });
    it('同一入口再点一次 → 关闭', () => {
        expect(nextMenuState('episodes', 'episodes')).toBeNull();
        expect(nextMenuState('speed', 'speed')).toBeNull();
    });
    it('点另一个入口 → 直接切过去（不会两个同时开着）', () => {
        expect(nextMenuState('episodes', 'speed')).toBe('speed');
        expect(nextMenuState('speed', 'settings')).toBe('settings');
    });
});

describe('menuAnchor（浮层贴按钮向上浮出的定位）', () => {
    const base = { btnLeft: 600, btnRight: 640, menuW: 180, containerW: 900, containerH: 44 };

    it('默认右对齐到触发按钮右缘，浮在控制条上方', () => {
        const p = menuAnchor(base);
        expect(p.left).toBe(460);
        expect(p.bottom).toBe(52);
    });

    it('向左越界时钳到 margin（不跑出播放器左缘）', () => {
        const p = menuAnchor({ ...base, btnLeft: 4, btnRight: 40, menuW: 180 });
        expect(p.left).toBe(6);
    });

    it('向右越界时钳到右缘内侧', () => {
        const p = menuAnchor({ ...base, btnLeft: 880, btnRight: 896, menuW: 180 });
        expect(p.left).toBe(900 - 180 - 6);
    });

    it('gap 可调（浮层与控制条的间距）', () => {
        expect(menuAnchor({ ...base, gap: 14 }).bottom).toBe(58);
    });

    it('容器比浮层还窄时退化到 margin，绝不出现负值', () => {
        const p = menuAnchor({ ...base, containerW: 120, menuW: 180 });
        expect(p.left).toBe(6);
        expect(p.left).toBeGreaterThanOrEqual(0);
    });

    it('margin 可调', () => {
        expect(menuAnchor({ ...base, btnLeft: 2, btnRight: 30, menuW: 180, margin: 20 }).left).toBe(20);
    });

    it('align 缺省仍是右对齐（列表类菜单口径不变）', () => {
        expect(menuAnchor({ ...base, menuW: 20 }).left).toBe(620);
    });

    it('align=center：水平居中于按钮（音量滑条用）', () => {
        const p = menuAnchor({ ...base, menuW: 20, align: 'center' });
        expect(p.left).toBe(610);
    });

    it('align=center 同样受左右夹取（不会跑出播放器）', () => {
        const p = menuAnchor({ ...base, btnLeft: 2, btnRight: 42, menuW: 200, align: 'center' });
        expect(p.left).toBe(6);
    });
});
