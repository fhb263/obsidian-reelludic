// 🔴 m04435 ③：歌词区 Ctrl+滚轮缩放（用户逐字：
//   「歌词区域内 **Ctrl+鼠标滚轮**缩放歌词字号/比例：阻止页面默认缩放/滚动；
//     仅作用于歌词容器，不影响其他 UI；不影响歌词正常播放滚动」）
//
// 纯逻辑在 `pure/lyricZoom`（档位/吸附/持久化），接线在 `audioPlayerMount`，配色在 `styles.css`。
// 三处缺一处功能就静默失效：纯函数错 ⇒ 缩放乱跳；接线漏 ⇒ 滚了没反应；
// CSS 漏 ⇒ 比例写了但字号不动（本仓最容易被忽略的那一类）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    LYRIC_SCALE_DEFAULT,
    LYRIC_SCALE_MAX,
    LYRIC_SCALE_MIN,
    LYRIC_SCALE_STEP,
    clampLyricScale,
    lyricScaleAfterWheel,
    lyricScaleLabel,
} from 'pure/lyricZoom';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'src/views/audioPlayerMount.ts'), 'utf8');
/** 剥注释：三档且都**不跨行**（跨行那条会被模板串里的括号星号序列吞掉，本仓踩过 —— ⛔ 别在这里写那个序列） */
const MOUNT = raw
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/\/\*[^*\n]*\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
const CSS = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

const after = (src: string, marker: string, len = 1400): string => {
    const at = src.indexOf(marker);
    if (at < 0) throw new Error(`找不到锚点：${marker}`);
    return src.slice(at, at + len);
};

/** 值是否落在步长网格上（供多处断言复用） */
const onGridOf = (v: number): boolean =>
    Math.abs(v / LYRIC_SCALE_STEP - Math.round(v / LYRIC_SCALE_STEP)) < 1e-9;

describe('🔴 m04435 ③ 缩放档位（纯函数）', () => {
    it('缺省 / 上下限 / 步长三个常量都是约定值', () => {
        expect(LYRIC_SCALE_DEFAULT).toBe(1);
        // 🔴 真机实测（技术债）：原先写的 0.75 不在 0.1 网格上 ⇒ 用户按 Ctrl 一直下滚停在 0.8 不动。
        expect(LYRIC_SCALE_MIN).toBe(0.8);
        expect(LYRIC_SCALE_MAX).toBe(1.8);
        expect(LYRIC_SCALE_STEP).toBe(0.1);
    });

    it('🔴 区间端点必须落在步长网格上（否则「吸附 → 夹」会让下限永远取不到）', () => {
        const onGrid = (v: number): boolean => Math.abs(v / LYRIC_SCALE_STEP - Math.round(v / LYRIC_SCALE_STEP)) < 1e-9;
        expect(onGrid(LYRIC_SCALE_MIN)).toBe(true);
        expect(onGrid(LYRIC_SCALE_MAX)).toBe(true);
        expect(onGrid(LYRIC_SCALE_DEFAULT)).toBe(true);
    });

    it('🔴 clamp 内部必须把两个端点也吸到网格上（不是直接拿常量去夹）', () => {
        // 真机 bug 的第二种形态：常量对了，但 clamp 直接 `Math.max(MIN, …)` ⇒
        // 若 MIN 离开网格，吸附后的 0.8 会被夹回 0.75，再吸附回 0.8 → 奇偶振荡。
        // 源码守卫：两个端点都要经过 `Math.round(... / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP`。
        const src = readFileSync(resolve(ROOT, 'src/pure/lyricZoom.ts'), 'utf8');
        const body = src.slice(src.indexOf('export function clampLyricScale('), src.indexOf('export function lyricScaleAfterWheel('));
        expect(body).toContain('const lo = Math.round(LYRIC_SCALE_MIN / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP;');
        expect(body).toContain('const hi = Math.round(LYRIC_SCALE_MAX / LYRIC_SCALE_STEP) * LYRIC_SCALE_STEP;');
        // 反向守卫：不许退回「直接拿常量夹」
        expect(body).not.toMatch(/Math\.max\(\s*LYRIC_SCALE_MIN\s*,/);
        expect(body).not.toMatch(/Math\.min\(\s*LYRIC_SCALE_MAX\s*,/);
        // 行为守卫：网格外的输入被夹后，必须落在网格上
        for (const v of [0.7, 0.71, 0.74, 0.79, 1.85, 1.99]) {
            const out = clampLyricScale(v);
            expect(onGridOf(out)).toBe(true);
        }
    });

    it('🔴 clamp 必须幂等（真机 bug：0.75⇄0.8 来回弹 ⇒ 下滚到底停在 0.8 纹丝不动）', () => {
        for (const v of [0.75, 0.8, 0.9, 1, 1.23, 1.8, 2, 0.1, -5, NaN, Infinity]) {
            const once = clampLyricScale(v);
            expect(clampLyricScale(once)).toBe(once);
        }
        // 边界连夹 5 次不许动
        let min = LYRIC_SCALE_MIN;
        for (let i = 0; i < 5; i++) min = clampLyricScale(min);
        expect(min).toBe(LYRIC_SCALE_MIN);
        let max = LYRIC_SCALE_MAX;
        for (let i = 0; i < 5; i++) max = clampLyricScale(max);
        expect(max).toBe(LYRIC_SCALE_MAX);
    });

    it('🔴 连续下滚 41 次（奇数，能暴露奇偶振荡）也必须停在下限', () => {
        let z = LYRIC_SCALE_DEFAULT;
        const seen: number[] = [];
        for (let i = 0; i < 41; i++) { z = lyricScaleAfterWheel(z, 1); seen.push(z); }
        expect(z).toBe(LYRIC_SCALE_MIN);
        // 到底之后的最后 5 次一格都不许动
        expect(new Set(seen.slice(-5)).size).toBe(1);
        // 且全程不许低于下限
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(LYRIC_SCALE_MIN);
    });

    it('🔴 上滚放大、下滚缩小（与漫画阅读器同一方向约定）', () => {
        expect(lyricScaleAfterWheel(1, -1)).toBeCloseTo(1.1, 5);
        expect(lyricScaleAfterWheel(1, 1)).toBeCloseTo(0.9, 5);
    });

    it('🔴 一格一档、可回原点（上滚再下滚必须回到 1，⛔ 不留 1.0000000000000002）', () => {
        const up = lyricScaleAfterWheel(1, -100);
        const back = lyricScaleAfterWheel(up, 100);
        expect(back).toBe(1);
    });

    it('🔴 夹在区间内：一直放大到上限就停住，一直缩小到下限就停住', () => {
        let z = LYRIC_SCALE_DEFAULT;
        for (let i = 0; i < 40; i++) z = lyricScaleAfterWheel(z, -1);
        expect(z).toBe(LYRIC_SCALE_MAX);
        for (let i = 0; i < 40; i++) z = lyricScaleAfterWheel(z, 1);
        expect(z).toBe(LYRIC_SCALE_MIN);
    });

    it('`deltaY === 0` 原样返回（别白触发一次重排）', () => {
        expect(lyricScaleAfterWheel(1.3, 0)).toBeCloseTo(1.3, 5);
    });

    it('非法输入回落缺省（NaN / Infinity / 字符串脏值）', () => {
        expect(clampLyricScale(Number.NaN)).toBe(1);
        expect(clampLyricScale(Number.POSITIVE_INFINITY)).toBe(1);
        expect(lyricScaleAfterWheel(Number.NaN, -1)).toBeCloseTo(1.1, 5);
        expect(clampLyricScale(99)).toBe(LYRIC_SCALE_MAX);
        expect(clampLyricScale(0.01)).toBe(LYRIC_SCALE_MIN);
    });

    it('百分比文案会按档位吸附（`110%` / `80%` / `180%`）', () => {
        expect(lyricScaleLabel(1.1)).toBe('110%');
        // 🔴 下限已从 0.75 提到网格上的 0.8（真机 bug：0.75 不在步长网格上，吸附后停在 0.8）
        expect(lyricScaleLabel(0.1)).toBe('80%');
        expect(lyricScaleLabel(9)).toBe('180%');
    });
});

describe('🔴 m04435 ③ 歌词区缩放：接线', () => {
    it('🔴 只认 ctrl/⌘ —— 普通滚轮必须放行（#407「可用滚轮滚动歌词」不能破）', () => {
        const body = after(MOUNT, 'const onLyricWheel = (ev: WheelEvent): void => {', 700);
        expect(body).toContain('if (!ev.ctrlKey && !ev.metaKey) return;');
        // ⛔ 反向守卫：不许无条件 preventDefault（那会把普通滚动也吃掉）
        expect(body).not.toContain('const onLyricWheel = (ev: WheelEvent): void => {\n        ev.preventDefault();');
    });

    it('🔴 必须 `passive: false` 才能真的挡住浏览器整页缩放', () => {
        expect(MOUNT).toContain("lyrics.addEventListener('wheel', onLyricWheel, { passive: false });");
    });

    it('🔴 缩放只写 CSS 变量，⛔ 不用 transform/zoom（那会让居中量测失真）', () => {
        const body = after(MOUNT, 'const onLyricWheel = (ev: WheelEvent): void => {', 700);
        expect(body).toContain('applyLyricScale(lyrics, lyricScale);');
        expect(body).toContain('saveLyricScale(lyricScale);');
        expect(body).toContain('centerCurLine();');
        // ⛔ 反向：不许在缩放路径里动 transform / zoom / style.fontSize
        expect(body).not.toContain('transform');
        expect(body).not.toContain('style.zoom');
        expect(body).not.toContain('style.fontSize');
    });

    it('🔴 挂载时先套用记忆比例（首次渲染就该是用户上次的字号）', () => {
        expect(MOUNT).toContain('let lyricScale = loadLyricScale() ?? LYRIC_SCALE_DEFAULT;');
        expect(MOUNT).toContain('applyLyricScale(lyrics, lyricScale);');
    });

    it('🔴 销毁时摘掉监听（否则重开播放器会叠第二个 handler）', () => {
        expect(MOUNT).toContain("lyrics.removeEventListener('wheel', onLyricWheel);");
    });
});

describe('🔴 m04435 ③ 歌词区缩放：CSS 真源', () => {
    it('🔴 比例变量定义在容器上，行字号是 `calc(… * var(--rl-ap-lyric-scale))`', () => {
        expect(CSS).toMatch(/\.rl-ap-lyrics \{[^}]*--rl-ap-lyric-scale: 1;/);
        expect(CSS).toMatch(/\.rl-ap-lyr-line \{[^}]*font-size: calc\(14px \* var\(--rl-ap-lyric-scale, 1\)\);/);
    });

    it('🔴 紧档（compact）也不能例外 —— 否则窄布局里 Ctrl+滚轮全然无效', () => {
        expect(CSS).toMatch(
            /\[data-tier="compact"\] \.rl-ap-lyr-line \{[^}]*font-size: calc\(13px \* var\(--rl-ap-lyric-scale, 1\)\);/,
        );
    });

    it('🔴 ⛔ 不许把行字号写死回 `14px`（那会让变量白设）', () => {
        expect(CSS).not.toMatch(/\.rl-ap-lyr-line \{[^}]*font-size: 14px;/);
    });
});

describe('🔴 m04435 ③ [Gold] 渲染：暗金 / 亮金', () => {
    it('🔴 解析出的 gold 位落到 `is-gold` 类（且只在真时加）', () => {
        expect(MOUNT).toContain("const goldCls = line.gold ? ' is-gold' : '';");
        expect(MOUNT).toContain("el('div', 'rl-ap-lyr-line' + (plainLyrics ? ' is-plain' : '') + goldCls)");
    });

    it('🔴 暗金 = 未高亮的 Gold 行；亮金 = `.is-gold.is-cur`', () => {
        expect(CSS).toMatch(/\.rl-ap-lyr-line\.is-gold \{[^}]*color: #a8791f;/);
        expect(CSS).toMatch(/\.rl-ap-lyr-line\.is-gold\.is-cur \{[^}]*color: #f5c451;/);
    });

    it('🔴 金配色的顺序：`.is-gold` 在 `.is-cur` 之后（否则暗金会被 accent 盖掉）', () => {
        const cur = CSS.indexOf('.rl-ap-lyr-line.is-cur { color: var(--text-accent);');
        const goldAt = CSS.indexOf('.rl-ap-lyr-line.is-gold {');
        expect(cur).toBeGreaterThan(-1);
        expect(goldAt).toBeGreaterThan(cur);
    });

    it('🔴 深色主题有专门的一档（暗金在深底上不提亮会糊）', () => {
        expect(CSS).toMatch(/\.theme-dark \.rl-ap-lyr-line\.is-gold \{[^}]*color: #c79a35;/);
    });

    it('⚠️ 逐字高亮的基础两条规则必须还在（非金句全靠它们）', () => {
        expect(CSS).toMatch(/\.rl-ap-lyr-line\.is-cur \.rl-ap-lyr-w \{[^}]*color: var\(--text-faint\)/);
        expect(CSS).toMatch(/\.rl-ap-lyr-line\.is-cur \.rl-ap-lyr-w\.is-on \{[^}]*color: var\(--text-accent\)/);
        // 🔴 m07623：本条只保「基础规则在位」。**「金句当前行到底显什么色」由层叠胜负决定**，
        //   字符串存在性检查查不出被覆盖 —— 那部分判据在 `tests/lrcGold.test.ts` 的「层叠」一组，
        //   按特异度 + 出现顺序算实际生效值（本 bug 正是这样漏过去的：两条规则都在，金却被盖掉）。
    });
});

describe('🔴 m04435 ③ 编辑处占位提示', () => {
    const FORM = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

    it('🔴 歌词框 placeholder 交代 `[Gold]` 用法', () => {
        const body = after(FORM, '<textarea id="rl-lrc"', 600);
        expect(body).toContain('[00:10.00][Gold]');
        expect(body).toContain('高光句在时间标签后加 [Gold]');
    });

    it('🔴 提示只是 placeholder，⛔ 不许自动把 `[Gold]` 写进歌词值', () => {
        // 反向守卫：源码里不许出现「主动插标记」的写法
        expect(FORM).not.toContain('lrc = `[Gold]');
        expect(FORM).not.toContain("lrc += '[Gold]");
        expect(FORM).not.toContain('insertGold');
    });
});
