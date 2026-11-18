/**
 * ① SWF 载体目录约定（`src/pure/gameLayout.ts`）。
 *
 * 判据全部来自用户 2026-11-17 逐字需求 + 二次裁定，所以每条用例的注释都写明「为什么是这条」：
 * 布局选错会直接表现为「两个游戏的 sounds/bgm.mp3 互相顶掉」或者「几百个单文件目录没法浏览」，
 * 这两种事故都不会报错，只能靠这里钉住。
 */
import { describe, expect, it } from 'vitest';
import {
    GAME_SAVES_SUBDIR,
    GAME_SWF_SUBDIR,
    dirOfSwf,
    gameBundleSavesDir,
    gameCarrierDir,
    gameCarrierLayout,
    isInBundleDir,
    isInSwfFlatDir,
    shouldUpgradeToBundle,
} from '../src/pure/gameLayout';

const BASE = '下载/Flash 游戏';

describe('gameLayout · 布局判据', () => {
    it('单文件无存档 ⇒ 平铺区', () => {
        expect(gameCarrierLayout({ multiFile: false, hasSaves: false })).toBe('swf-flat');
    });

    it('有存档 ⇒ 独立目录（「有存档」优先于「单文件」）', () => {
        // 用户逐字：「单文件 SWF 有存档做独立目录」
        expect(gameCarrierLayout({ multiFile: false, hasSaves: true })).toBe('bundle');
    });

    it('多文件 ⇒ 独立目录', () => {
        expect(gameCarrierLayout({ multiFile: true, hasSaves: false })).toBe('bundle');
        expect(gameCarrierLayout({ multiFile: true, hasSaves: true })).toBe('bundle');
    });
});

describe('gameLayout · 目录拼装', () => {
    it('平铺区是 `<游戏目录>/swf`（多个单文件游戏共用一间）', () => {
        expect(gameCarrierDir(BASE, '黄金矿工', 'swf-flat')).toBe(`${BASE}/${GAME_SWF_SUBDIR}`);
        expect(GAME_SWF_SUBDIR).toBe('swf');
    });

    it('独立目录是 `<游戏目录>/<游戏名>`', () => {
        expect(gameCarrierDir(BASE, '黄金矿工', 'bundle')).toBe(`${BASE}/黄金矿工`);
    });

    it('拿不到游戏名时退回 baseDir 本身，⛔ 不退回平铺区', () => {
        // 理由：那时文件名只能取 URL 末段（`04.swf`），全塞进 swf/ 会立刻互相顶掉
        expect(gameCarrierDir(BASE, '', 'swf-flat')).toBe(BASE);
        expect(gameCarrierDir(BASE, '   ', 'bundle')).toBe(BASE);
    });

    it('尾斜杠与反斜杠都归一（Windows 路径也认）', () => {
        expect(gameCarrierDir('下载\\Flash 游戏\\', '黄金矿工', 'bundle')).toBe('下载/Flash 游戏/黄金矿工');
        expect(gameCarrierDir(`${BASE}/`, '黄金矿工', 'bundle')).toBe(`${BASE}/黄金矿工`);
    });

    it('独立目录下的存档夹是 `saves/`', () => {
        expect(gameBundleSavesDir(`${BASE}/黄金矿工`)).toBe(`${BASE}/黄金矿工/${GAME_SAVES_SUBDIR}`);
        expect(GAME_SAVES_SUBDIR).toBe('saves');
        // 空入参不炸（调用方可能还没关联 swf）
        expect(gameBundleSavesDir('')).toBe(GAME_SAVES_SUBDIR);
    });
});

describe('gameLayout · 从 swf 路径反推位置', () => {
    it('dirOfSwf 取到最后一个斜杠之前', () => {
        expect(dirOfSwf(`${BASE}/swf/x.swf`)).toBe(`${BASE}/swf`);
        expect(dirOfSwf('x.swf')).toBe('');
    });

    it('平铺区只认父目录名 swf（不要求完整前缀匹配）', () => {
        // 「游戏目录」设置项可以被改到任意位置，拼进判据会在改设置后失效
        expect(isInSwfFlatDir(`${BASE}/swf/x.swf`)).toBe(true);
        expect(isInSwfFlatDir('我的库/小游戏/swf/x.swf')).toBe(true);
        expect(isInSwfFlatDir(`${BASE}/黄金矿工/x.swf`)).toBe(false);
        expect(isInSwfFlatDir('x.swf')).toBe(false);
    });

    it('独立目录 = 有父目录且父目录不是 swf', () => {
        expect(isInBundleDir(`${BASE}/黄金矿工/x.swf`)).toBe(true);
        expect(isInBundleDir(`${BASE}/swf/x.swf`)).toBe(false);
        expect(isInBundleDir('x.swf')).toBe(false);
    });
});

describe('gameLayout · 升级判据', () => {
    it('补到关联资源才升级到独立目录', () => {
        expect(shouldUpgradeToBundle(1)).toBe(true);
        expect(shouldUpgradeToBundle(12)).toBe(true);
        expect(shouldUpgradeToBundle(0)).toBe(false);
    });

    it('非法数值不升级（NaN / Infinity 都不当「有资源」）', () => {
        expect(shouldUpgradeToBundle(Number.NaN)).toBe(false);
        expect(shouldUpgradeToBundle(Number.POSITIVE_INFINITY)).toBe(false);
    });
});
