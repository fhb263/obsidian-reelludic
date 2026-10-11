import { describe, it, expect } from 'vitest';
import {
    buildSpeedOptions,
    buildEpisodeOptions,
    buildSettingOptions,
    buildSubtitleMenu,
    nextEpisodeIndex,
    nextPlayMode,
    normalizePlayMode,
    playModeFromLegacy,
    PLAY_MODES,
    PLAY_MODE_LABELS,
    SUBTITLE_HINT,
    SUBTITLE_EMPTY_TEXT,
    SUBTITLE_BROWSE_LABEL,
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

describe('buildSettingOptions（设置弹窗三组结构 #604 / #605 精简）', () => {
    const all = { pip: true, playMode: 'listLoop' as const };
    const rowsOf = (o: Parameters<typeof buildSettingOptions>[0]) => buildSettingOptions(o).flatMap((g) => g.rows);

    it('🔴 三组**各一行**：播放模式 ／ 画中画 ／ 用系统播放器打开 —— 顺序与分组固定', () => {
        expect(buildSettingOptions(all).map((g) => g.rows.map((r) => r.id))).toEqual([
            ['playmode'],
            ['pip'],
            ['external'],
        ]);
    });

    it('三组的组标题一律留空（小号灰字标题由弹窗标题 SETTING_HEAD 承担）', () => {
        expect(buildSettingOptions(all).every((g) => g.title === undefined)).toBe(true);
    });

    it('🔴「播放模式」是**循环值行**：右侧当前值 = 四档真源的中文名（⛔ 无展开列表）', () => {
        const row = rowsOf(all).find((r) => r.id === 'playmode')!;
        expect(row.kind).toBe('cycle');
        expect(row.value).toBe('列表循环');
        expect(rowsOf({ pip: true, playMode: 'shuffle' }).find((r) => r.id === 'playmode')!.value).toBe('随机播放');
    });

    it('🔴「画中画」是**动作行**（与「用系统播放器打开」同款）；不支持时**置灰可见** + 右缘「当前设备不支持」', () => {
        const on = rowsOf(all).find((r) => r.id === 'pip')!;
        expect(on.kind).toBe('nav');
        expect(on.disabled).toBeFalsy();
        expect(on.note).toBeUndefined();
        const off = rowsOf({ pip: false }).find((r) => r.id === 'pip')!;
        expect(off.kind).toBe('nav');
        expect(off.disabled).toBe(true);
        expect(off.note).toBe('当前设备不支持');
    });

    it('🔴「用系统播放器打开」是动作行（⛔ 不带值、不带开关）', () => {
        const row = rowsOf({ pip: false }).find((r) => r.id === 'external')!;
        expect(row.kind).toBe('nav');
        expect(row.disabled).toBeFalsy();
        expect(row.value).toBeUndefined();
    });

    it('🔴 #605 精简：⛔ 设置里**没有**「后台播放」（已搬去设置页）／也**没有**「暂停」', () => {
        expect(rowsOf(all).map((r) => r.id)).toEqual(['playmode', 'pip', 'external']);
    });

    it('🔴 #605：弹窗里**只有一种开关形态**（cycle 值行 + 两枚 nav），⛔ 不再有 switch 行', () => {
        const kinds = rowsOf(all).map((r) => r.kind);
        expect(kinds).toEqual(['cycle', 'nav', 'nav']);
    });
});

describe('nextPlayMode（#605 播放模式「整行点击循环」）', () => {
    it('按 PLAY_MODES 顺序前进一档，最后一档回到第一档（循环闭合）', () => {
        expect(nextPlayMode('listLoop')).toBe('singleLoop');
        expect(nextPlayMode('singleLoop')).toBe('sequential');
        expect(nextPlayMode('sequential')).toBe('shuffle');
        // #606 追加「播完暂停」在**末尾** ⇒ 前四档的循环位置一个字没动
        expect(nextPlayMode('shuffle')).toBe('pauseAtEnd');
        expect(nextPlayMode('pauseAtEnd')).toBe('listLoop');
    });

    it('走满一圈回到原档（五步一循环）', () => {
        let m = PLAY_MODES[0];
        for (let i = 0; i < PLAY_MODES.length; i++) m = nextPlayMode(m);
        expect(m).toBe(PLAY_MODES[0]);
    });

    it('🔴 脏值先归一（⛔ else indexOf 得 -1 会原地不动 = 「点了没反应」假象）', () => {
        expect(nextPlayMode('nope' as never)).toBe('singleLoop');
        expect(nextPlayMode(undefined as never)).toBe('singleLoop');
    });
});

describe('normalizePlayMode / playModeFromLegacy（脏值归一 + 旧数据迁移）', () => {
    it('五档原样通过；脏值 / undefined / 非字符串一律回落 listLoop', () => {
        for (const m of PLAY_MODES) expect(normalizePlayMode(m)).toBe(m);
        expect(normalizePlayMode('nope')).toBe('listLoop');
        expect(normalizePlayMode(undefined)).toBe('listLoop');
        expect(normalizePlayMode(3)).toBe('listLoop');
    });

    it('旧的两个布尔 → 新模式：loopOne 优先；其次 autoNext 开 = 列表循环 / 关 = 顺序播放', () => {
        expect(playModeFromLegacy(true, true)).toBe('singleLoop');
        expect(playModeFromLegacy(false, true)).toBe('singleLoop');
        expect(playModeFromLegacy(true, false)).toBe('listLoop');
        expect(playModeFromLegacy(false, false)).toBe('sequential');
    });

    it('🔴 标签表覆盖**五档**（⛔ 少一档 UI 就会显示 undefined）', () => {
        for (const m of PLAY_MODES) expect(typeof PLAY_MODE_LABELS[m]).toBe('string');
        expect(Object.keys(PLAY_MODE_LABELS)).toHaveLength(5);
        expect(PLAY_MODE_LABELS.pauseAtEnd).toBe('播完暂停');
    });
});

describe('nextEpisodeIndex（集末推进 · 五档）', () => {
    it('列表循环：一直往后走，最后一集**绕回第一集**', () => {
        expect(nextEpisodeIndex('listLoop', 0, 3)).toBe(1);
        expect(nextEpisodeIndex('listLoop', 2, 3)).toBe(0);
        // 列表只有一集 ⇒ 回到本集（循环就是重播它）
        expect(nextEpisodeIndex('listLoop', 0, 1)).toBe(0);
    });

    it('单集循环：恒返回 cur（重播本集）', () => {
        expect(nextEpisodeIndex('singleLoop', 2, 3)).toBe(2);
        expect(nextEpisodeIndex('singleLoop', 0, 1)).toBe(0);
    });

    it('顺序播放：最后一集返回 null（停住，不弹连播）', () => {
        expect(nextEpisodeIndex('sequential', 0, 3)).toBe(1);
        expect(nextEpisodeIndex('sequential', 2, 3)).toBeNull();
        expect(nextEpisodeIndex('sequential', 0, 1)).toBeNull();
    });

    it('🔴 #606 播完暂停：任何一集播完都返回 null（停住、不推进、也不弹连播）', () => {
        expect(nextEpisodeIndex('pauseAtEnd', 0, 3)).toBeNull();
        expect(nextEpisodeIndex('pauseAtEnd', 2, 3)).toBeNull();
        expect(nextEpisodeIndex('pauseAtEnd', 0, 1)).toBeNull();
        // 🔴 与「顺序播放」的分界线：顺序播放在**非末集**是要推进的，播完暂停从不推进
        expect(nextEpisodeIndex('sequential', 0, 3)).toBe(1);
        expect(nextEpisodeIndex('pauseAtEnd', 0, 3)).toBeNull();
    });

    it('随机播放：绝不返回 cur（那是「重播」语义）；单集 / 空列表返回 null', () => {
        expect(nextEpisodeIndex('shuffle', 1, 3, () => 0)).toBe(0);
        expect(nextEpisodeIndex('shuffle', 0, 3, () => 0.99)).toBe(2);
        expect(nextEpisodeIndex('shuffle', 0, 1)).toBeNull();
        expect(nextEpisodeIndex('shuffle', 0, 0)).toBeNull();
    });

    it('🔴 恒定随机源不死循环（有界重试 + 确定性回退，与 audioQueue 同款纪律）', () => {
        // 恒定返 0 ⇒ 每次都命中 cur ⇒ 重试耗尽后回退成顺序下一集
        expect(nextEpisodeIndex('shuffle', 0, 3, () => 0)).toBe(1);
        // 退化到最后一集 ⇒ 回退绕回 0
        expect(nextEpisodeIndex('shuffle', 2, 3, () => 0.999)).toBe(0);
    });

    it('空列表一律 null（任何模式）', () => {
        for (const m of PLAY_MODES) expect(nextEpisodeIndex(m, 0, 0)).toBeNull();
    });
});

describe('buildSubtitleMenu（#606 字幕面板模型）', () => {
    const cands = [
        { fileName: 'E01.chs.srt', lang: '中文' },
        { fileName: 'E01.eng.srt', lang: '' },
    ];

    it('标题带《》：选择字幕：《X》', () => {
        expect(buildSubtitleMenu({ title: '熊出没', candidates: [], current: null, visible: true }).title)
            .toBe('选择字幕：《熊出没》');
    });

    it('🔴 `active` 由 current 推出来（⛔ 别让视图自己比对文件名 —— 两处判据迟早漂）', () => {
        const m = buildSubtitleMenu({ title: 'X', candidates: cands, current: 'E01.eng.srt', visible: true });
        expect(m.candidates.map((c) => c.active)).toEqual([false, true]);
    });

    it('current 为 null（外部文件挂载）⇒ 一条都不高亮', () => {
        expect(buildSubtitleMenu({ title: 'X', candidates: cands, current: null, visible: true })
            .candidates.some((c) => c.active)).toBe(false);
    });

    it('lang 缺省补空串（UI 据此显示「字幕」）；文案与开关态原样透出', () => {
        const m = buildSubtitleMenu({ title: 'X', candidates: cands, current: null, visible: false });
        expect(m.candidates.map((c) => c.lang)).toEqual(['中文', '']);
        expect(m.visible).toBe(false);
        expect(m.hint).toBe(SUBTITLE_HINT);
        expect(m.browseLabel).toBe(SUBTITLE_BROWSE_LABEL);
        expect(m.emptyText).toBe(SUBTITLE_EMPTY_TEXT);
    });

    it('候选为空 ⇒ 空表（UI 显示 emptyText），不是 undefined', () => {
        expect(buildSubtitleMenu({ title: 'X', candidates: [], current: null, visible: true }).candidates).toEqual([]);
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
