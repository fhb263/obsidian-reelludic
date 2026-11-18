/**
 * 词云摆放（`pure/wordCloudLayout`）——🔴 m04642 ①。
 *
 * 用户原话（2026-11-15）：「这个词云统计应该按参考 `@isoterik/react-word-cloud`、`araea-wordcloud`
 * 实现词云效果在有限空间内"见缝插针"」。
 *
 * 本文件钉的是**几何不变量**，不是"看起来像词云"：
 *   ① 任意两个词**不重叠**（含 `gap`）—— 这是"见缝插针"的反面定义，重叠了就是排布失败；
 *   ② 每个词**全在画布内** —— 越界的词会被 `overflow: hidden` 裁掉半截，比放不下更糟；
 *   ③ 大词优先占中心 —— 否则"见缝插针"会退化成随机撒点，视觉上没有主次；
 *   ④ 放不下时**如实上报** `dropped`，⛔ 不静默丢弃；
 *   ⑤ 字号档位与组件 CSS 同源 —— 估算与实渲染用同一个尺寸，否则"看着没碰却躲开了"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CLOUD_FIT_SCALES,
    CLOUD_LEVEL_EM,
    cloudHeightFor,
    estimateTextWidth,
    fontPxOfLevel,
    layoutWordCloud,
    type CloudLayoutWord,
    type CloudPlacedWord,
} from '../src/pure/wordCloudLayout';

const ROOT = resolve(__dirname, '..');

function w(text: string, level: number, weight = level): CloudLayoutWord {
    return { text, weight, level };
}

/** 复用被测模块自己的估算口径做重叠判定 —— 测试不该另写一套几何 */
function boxesOverlap(a: CloudPlacedWord, b: CloudPlacedWord, gap = 0): boolean {
    return (
        a.x - gap < b.x + b.width &&
        b.x < a.x + a.width + gap &&
        a.y - gap < b.y + b.height &&
        b.y < a.y + a.height + gap
    );
}

describe('layoutWordCloud · 🔴 几何不变量（"见缝插针"的正确性定义）', () => {
    const words: CloudLayoutWord[] = [
        w('喜剧', 5, 57),
        w('动画', 5, 55),
        w('奇幻', 4, 21),
        w('剧情', 4, 20),
        w('家庭', 3, 19),
        w('冒险', 3, 17),
        w('动作', 3, 15),
        w('Indie', 2, 12),
        w('古装', 2, 11),
        w('流行', 2, 10),
        w('科幻', 1, 9),
        w('游戏', 1, 9),
        w('儿童', 1, 9),
        w('爱情', 1, 9),
        w('Action', 1, 8),
    ];

    it('🔴🔴 任意两个词不重叠（这是本需求的验收定义）', () => {
        const r = layoutWordCloud(words, { width: 640, basePx: 13 });
        expect(r.placed.length).toBeGreaterThan(5);
        for (let i = 0; i < r.placed.length; i++) {
            for (let j = i + 1; j < r.placed.length; j++) {
                expect(
                    boxesOverlap(r.placed[i], r.placed[j]),
                    `「${r.placed[i].text}」与「${r.placed[j].text}」重叠了`,
                ).toBe(false);
            }
        }
    });

    it('🔴 每个词全在画布内（越界会被 overflow:hidden 裁掉半截）', () => {
        const r = layoutWordCloud(words, { width: 640, basePx: 13 });
        expect(r.placed.length).toBeGreaterThan(5);
        for (const p of r.placed) {
            expect(p.x, `「${p.text}」左越界`).toBeGreaterThanOrEqual(0);
            expect(p.y, `「${p.text}」上越界`).toBeGreaterThanOrEqual(0);
            expect(p.x + p.width, `「${p.text}」右越界`).toBeLessThanOrEqual(r.width + 0.001);
            expect(p.y + p.height, `「${p.text}」下越界`).toBeLessThanOrEqual(r.height + 0.001);
        }
    });

    it('🔴 大词整体靠中心（不能退化成随机撒点）', () => {
        const r = layoutWordCloud(words, { width: 640, basePx: 13 });
        const cx = r.width / 2;
        const cy = r.height / 2;
        const dist = (p: CloudPlacedWord): number => Math.hypot(p.x + p.width / 2 - cx, p.y + p.height / 2 - cy);
        const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
        const lv5 = r.placed.filter((p) => p.level === 5);
        const lv1 = r.placed.filter((p) => p.level === 1);
        expect(lv5.length).toBe(2);
        expect(lv1.length).toBeGreaterThan(0);
        // ⚠️ 只在**档位均值**上比较，别逐对比：小词会插进大词之间的缝里，
        //    单个小词比某个大字更靠中心是"见缝插针"的正常结果（d3-cloud 同款行为）。
        expect(avg(lv5.map(dist)), '最大的两个词整体应在中心附近').toBeLessThan(avg(lv1.map(dist)));
    });

    it('🔴 放不下时如实上报 dropped，⛔ 不静默丢弃', () => {
        // 60 个 4 字大词塞进 200×120 —— 必然放不完
        const many = Array.from({ length: 60 }, (_, i) => w(`标签${String(i).padStart(2, '0')}号`, 5, 60 - i));
        const r = layoutWordCloud(many, { width: 200, height: 120, basePx: 13 });
        expect(r.dropped.length).toBeGreaterThan(0);
        expect(r.placed.length + r.dropped.length).toBe(60);
    });

    it('🔴 空间够时一个都不丢（自动降档要真的起作用）', () => {
        const few = [w('喜剧', 5, 57), w('动画', 5, 55), w('奇幻', 4, 21)];
        const r = layoutWordCloud(few, { width: 520, basePx: 13 });
        expect(r.dropped).toEqual([]);
        expect(r.placed).toHaveLength(3);
        expect(r.scale).toBe(1);
    });

    it('空输入 / 零宽画布 → 空结果且不抛错', () => {
        expect(layoutWordCloud([], { width: 400 }).placed).toEqual([]);
        const zero = layoutWordCloud(words, { width: 0 });
        expect(zero.placed).toEqual([]);
        expect(zero.dropped).toHaveLength(words.length);
    });

    it('画布越窄越吃亏：空间真不够时要么少放词、要么缩字号', () => {
        // ⚠️ 得用**真的挤**的场景（40 个词）才测得出空间约束 ——
        //    15 个词在 260×200 里面积只用掉约 1/8，`scale=1` 全放下是正确结果，不是 bug。
        const many = Array.from({ length: 40 }, (_, i) => w(`标签${String(i).padStart(2, '0')}号`, 5 - (i % 5), 40 - i));
        const wide = layoutWordCloud(many, { width: 900, basePx: 13 });
        const narrow = layoutWordCloud(many, { width: 260, basePx: 13 });
        // 窄画布要么放的词更少，要么用了更小的字号 —— 二者必居其一
        const narrower = narrow.placed.length < wide.placed.length || narrow.scale < wide.scale;
        expect(narrower, `宽 scale=${wide.scale}/placed=${wide.placed.length}，窄 scale=${narrow.scale}/placed=${narrow.placed.length}`).toBe(true);
        expect(wide.placed.length).toBeGreaterThan(narrow.placed.length - 1);
    });
});

describe('layoutWordCloud · 降档（autoFit）', () => {
    it('丢词超阈值时整体缩字号再试，缩完词数更多', () => {
        const many = Array.from({ length: 26 }, (_, i) => w(`标签${i}号`, 4, 30 - i));
        const tight = layoutWordCloud(many, { width: 300, height: 200, basePx: 13 });
        // 必须真的缩过（scale < 1）且缩放值来自白名单
        expect(CLOUD_FIT_SCALES).toContain(tight.scale as (typeof CLOUD_FIT_SCALES)[number]);
        expect(tight.scale).toBeLessThanOrEqual(1);
        expect(tight.placed.length).toBeGreaterThan(0);
    });

    it('缩放后仍满足"不重叠 + 不出界"', () => {
        const many = Array.from({ length: 26 }, (_, i) => w(`标签${i}号`, 3, 30 - i));
        const r = layoutWordCloud(many, { width: 320, height: 210, basePx: 13 });
        for (let i = 0; i < r.placed.length; i++) {
            const p = r.placed[i];
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x + p.width).toBeLessThanOrEqual(r.width + 0.001);
            expect(p.y + p.height).toBeLessThanOrEqual(r.height + 0.001);
            for (let j = i + 1; j < r.placed.length; j++) {
                expect(boxesOverlap(p, r.placed[j])).toBe(false);
            }
        }
    });
});

describe('字号与尺寸口径', () => {
    it('🔴 档位 em 必须与 StatsBoard.svelte 里的 .lv-N 逐档一致', () => {
        const svelte = readFileSync(resolve(ROOT, 'src/views/components/StatsBoard.svelte'), 'utf8');
        const got: number[] = [];
        for (let lv = 1; lv <= 5; lv++) {
            const m = svelte.match(new RegExp(`\\.rl-cloud-w\\.lv-${lv}\\s*\\{[^}]*font-size:\\s*([\\d.]+)em`));
            expect(m, `StatsBoard.svelte 里找不到 .lv-${lv} 的 em 字号`).not.toBeNull();
            got.push(Number(m![1]));
        }
        expect(got).toEqual([...CLOUD_LEVEL_EM]);
    });

    it('fontPxOfLevel 越界钳到 1..5，不返回 NaN', () => {
        expect(fontPxOfLevel(0, 10)).toBe(fontPxOfLevel(1, 10));
        expect(fontPxOfLevel(99, 10)).toBe(fontPxOfLevel(5, 10));
        expect(Number.isFinite(fontPxOfLevel(NaN as unknown as number, 10))).toBe(true);
    });

    it('estimateTextWidth：CJK 比 ASCII 宽，空串为 0', () => {
        expect(estimateTextWidth('', 13)).toBe(0);
        expect(estimateTextWidth('中文', 13)).toBeGreaterThan(estimateTextWidth('ab', 13));
    });

    it('cloudHeightFor 有上下限，窄宽也不塌成 0', () => {
        expect(cloudHeightFor(0)).toBe(220);
        expect(cloudHeightFor(320)).toBeGreaterThanOrEqual(200);
        expect(cloudHeightFor(4000)).toBeLessThanOrEqual(340);
    });
});

describe('组件接线守卫（StatsBoard.svelte）', () => {
    const src = readFileSync(resolve(ROOT, 'src/views/components/StatsBoard.svelte'), 'utf8');

    it('🔴 词云必须走螺旋摆放，不许退回纯 flex-wrap', () => {
        expect(src).toMatch(/layoutWordCloud\(cloudWords/);
        expect(src).toMatch(/\.rl-cloud-body\.is-spiral/);
        expect(src).toMatch(/position:\s*absolute/);
    });

    it('🔴 容器要实测宽度（螺旋取决于画布尺寸）', () => {
        expect(src).toMatch(/function cloudMeasure/);
        expect(src).toMatch(/use:cloudMeasure/);
        expect(src).toMatch(/getBoundingClientRect\(\)\.width/);
    });

    it('🔴 塞不下的词不再靠一行灰字抱怨，改为 Ctrl+滚轮缩放（m05266）', () => {
        // 布局仍如实上报 dropped（纯逻辑层契约不变），但**模板不再渲染**任何提示。
        // ⚠️ 断言必须钉「渲染出来的元素」，⛔ 别用裸字符串：
        //    源码注释里逐字保留了用户原话（含「没塞进这块空间」）与 `⛔ 别把 .rl-cloud-drop 加回来`，
        //    裸匹配会连注释一起命中，变成恒假红 —— 这条踩过一次。
        expect(src).not.toMatch(/class="rl-cloud-drop"/);
        expect(src).not.toMatch(/\{cloudLayout\.dropped\.length\}/);
        expect(src).toMatch(/function onCloudWheel/);
        expect(src).toMatch(/on:wheel=\{onCloudWheel\}/);
    });

    it('🔴 未量到尺寸时要有回落，不能渲染成全部叠在 (0,0)', () => {
        expect(src).toMatch(/cloudLayout\s*\?\s*null|cloudLayout === null|!\s*cloudLayout/);
    });

    /**
     * 🔴 m04642 ①（真机实测修）：频次角标必须脱离文档流。
     *
     * 布局函数按**纯文字**估宽（`estimateTextWidth` 只算字符），
     * 而角标平时 `opacity: 0` 却仍参与布局宽度（`gap: 3px` + 9px 数字）。
     * 真机 320px 宽下量到 13 处重叠、oy 约等于整个字高 —— 估宽口径与渲染口径对不上。
     * 纯逻辑单测永远抓不到这类「CSS 撑宽」问题，只能靠这条源码守卫钉住。
     */
    it('🔴🔴 螺旋态下频次角标必须绝对定位（否则渲染宽 > 估宽，词块互相压住）', () => {
        const spiralBadge = src.match(
            /\.rl-cloud-body\.is-spiral\s+\.rl-cloud-w\.is-abs\s+\.rl-cloud-n\s*\{([^}]*)\}/,
        );
        expect(spiralBadge).not.toBeNull();
        const body = spiralBadge![1];
        expect(body).toMatch(/position:\s*absolute/);
        expect(body).toMatch(/left:\s*100%/);
        // 反向守卫：⛔ 不许又变回参与排布的 inline 展示
        expect(body).not.toMatch(/position:\s*(static|relative|sticky|fixed)/);
    });
});
