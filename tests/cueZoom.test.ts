/**
 * @vitest-environment jsdom
 *
 * 字幕面板 Ctrl/⌘ + 滚轮缩放（用户 m02829）。
 *
 * 用户逐字：「字幕面板和字幕面板学习模式都要支持 ctrl 鼠标滚轮缩放」
 *
 * 这里钉三类事：
 *  ① 纯逻辑的档位数学（吸附 / 夹紧 / 幂等 / 方向）—— 与歌词区 `tests/lyricZoom.test.ts` 同一套口径；
 *  ② **两档字号都乘同一个变量** —— 只改普通档、学习档写死 16px 是这次最容易漏的错法；
 *  ③ 视图层的接线纪律 —— 只认 ctrl/meta、`passive: false`、不碰 transform/zoom、
 *     缩放不算「用户手动滚动」（否则调一次字号自动跟随就被永久关掉）。
 *
 * ⚠️ 本文件注释里 ⛔ 不许出现裸的块注释收尾符（`*` + `/` 连写），
 *    那会把注释提前截断、esbuild 报出莫名其妙的语法错（`tests/episodeCueLearn.test.ts` 踩过）。
 * ⚠️ 需要 jsdom：`applyCueScale` 那条要真建一个节点验证 CSS 变量落地。
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
    CUE_SCALE_DEFAULT,
    CUE_SCALE_KEY,
    CUE_SCALE_MAX,
    CUE_SCALE_MIN,
    CUE_SCALE_STEP,
    CUE_SCALE_VAR,
    applyCueScale,
    clampCueScale,
    cueScaleAfterWheel,
    cueScaleLabel
} from 'pure/cueZoom';

const CSS_RAW = readFileSync('styles.css', 'utf8');
const VIEW = readFileSync('src/views/EpisodePageView.ts', 'utf8');

/**
 * 剥掉 CSS 注释。
 *
 * 🔴 必须剥：断言「样式表里不许再有 `.rl-epp-wordtip-say`」时，我在删除处写的**注释里
 *    就提到了这个类名**（说明「两条规则一并删」），不剥就会自己命中自己 ——
 *    第一次跑正是这样假红。断言要盯的是「有没有真规则」，不是「有没有出现过这个词」。
 */
function stripCssComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = stripCssComments(CSS_RAW);

/** 剥掉 TS 注释：只看「真会跑」的代码，避免注释里的字面量把断言骗过去 */
function stripTsComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//.test(line))
        .join('\n');
}

const VIEW_CODE = stripTsComments(VIEW);

describe('cueZoom · 档位数学', () => {
    it('缺省是 1（改了会让老用户升级后字号突变）', () => {
        expect(CUE_SCALE_DEFAULT).toBe(1);
    });

    it('端点必须落在步长网格上（否则下限永远取不到）', () => {
        const lo = Math.round(CUE_SCALE_MIN / CUE_SCALE_STEP) * CUE_SCALE_STEP;
        const hi = Math.round(CUE_SCALE_MAX / CUE_SCALE_STEP) * CUE_SCALE_STEP;
        expect(lo).toBeCloseTo(CUE_SCALE_MIN, 5);
        expect(hi).toBeCloseTo(CUE_SCALE_MAX, 5);
    });

    it('上滚放大、下滚缩小（与歌词/漫画同一方向约定）', () => {
        expect(cueScaleAfterWheel(1, -100)).toBeGreaterThan(1);
        expect(cueScaleAfterWheel(1, 100)).toBeLessThan(1);
    });

    it('deltaY 为 0 时原样返回，不白改一次触发重排', () => {
        expect(cueScaleAfterWheel(1.3, 0)).toBe(clampCueScale(1.3));
    });

    it('deltaY 非数字时原样返回', () => {
        expect(cueScaleAfterWheel(1.3, Number.NaN)).toBe(clampCueScale(1.3));
    });

    it('连续上滚停在 MAX，连续下滚停在 MIN（端点真能到）', () => {
        let up = 1;
        for (let i = 0; i < 40; i++) up = cueScaleAfterWheel(up, -100);
        expect(up).toBe(CUE_SCALE_MAX);
        let down = 1;
        for (let i = 0; i < 40; i++) down = cueScaleAfterWheel(down, 100);
        expect(down).toBe(CUE_SCALE_MIN);
    });

    it('clamp 幂等：clamp(clamp(x)) === clamp(x)', () => {
        for (const x of [0.55, 0.8, 1, 1.37, 2.6, 9, -3]) {
            const once = clampCueScale(x);
            expect(clampCueScale(once)).toBe(once);
        }
    });

    it('脏输入回落到缺省 1，不抛', () => {
        expect(clampCueScale(Number.NaN)).toBe(CUE_SCALE_DEFAULT);
        expect(clampCueScale(Number.POSITIVE_INFINITY)).toBe(CUE_SCALE_DEFAULT);
    });

    it('百分比文案', () => {
        expect(cueScaleLabel(1)).toBe('100%');
        expect(cueScaleLabel(1.5)).toBe('150%');
        // 越界值先夹再算，⛔ 不许印出 900%
        expect(cueScaleLabel(9)).toBe(`${Math.round(CUE_SCALE_MAX * 100)}%`);
    });
});

describe('cueZoom · 落盘与变量落地', () => {
    it('CSS 变量名与 localStorage 键是约定的那两个', () => {
        expect(CUE_SCALE_VAR).toBe('--rl-epp-cue-scale');
        expect(CUE_SCALE_KEY).toBe('rl-epp-cue-scale');
    });

    it('applyCueScale 只写 CSS 变量，⛔ 不写 style.fontSize', () => {
        const box = document.createElement('div');
        applyCueScale(box, 1.4);
        expect(box.style.getPropertyValue(CUE_SCALE_VAR)).toBe('1.4');
        // 🔴 写内联 fontSize 会盖掉学习档那条 16px，切学习模式时字号不动
        expect(box.style.fontSize).toBe('');
    });
});

describe('cueZoom · 🔴 两档字号必须乘同一个变量（这次最容易漏的错法）', () => {
    it('普通档 13px 乘了变量', () => {
        expect(CSS).toMatch(/font-size:\s*calc\(13px\s*\*\s*var\(--rl-epp-cue-scale/);
    });

    it('学习档 16px 也乘了变量', () => {
        expect(CSS).toMatch(/font-size:\s*calc\(16px\s*\*\s*var\(--rl-epp-cue-scale/);
    });

    it('反向守卫：⛔ 不许再有写死的 13px / 16px 单档字号', () => {
        expect(CSS).not.toMatch(/\.rl-epp-cuetext\s*\{[^}]*font-size:\s*13px\s*;/);
        expect(CSS).not.toMatch(/\.rl-epp-cuesbox\.is-learn\s+\.rl-epp-cuetext\s*\{[^}]*font-size:\s*16px\s*;/);
    });

    it('变量有缺省值 1（变量没写上时字号必须还是原样）', () => {
        expect(CSS).toContain('var(--rl-epp-cue-scale, 1)');
    });
});

describe('cueZoom · 视图接线纪律', () => {
    it('只认 ctrlKey / metaKey，且不带修饰键时立刻放行', () => {
        const body = VIEW_CODE.slice(VIEW_CODE.indexOf('private onCueZoomWheel'));
        const head = body.slice(0, body.indexOf('private scrollCueTo'));
        expect(head).toContain('if (!ev.ctrlKey && !ev.metaKey) return;');
        expect(head).toContain('ev.preventDefault()');
    });

    it('监听必须 passive: false（否则挡不住整页缩放）', () => {
        expect(VIEW_CODE).toContain("this.cueListEl.addEventListener('wheel', (ev) => this.onCueZoomWheel(ev), { passive: false });");
    });

    it('⛔ 不碰 transform / zoom（会毁 scrollCueTo 与气泡定位）', () => {
        const body = VIEW_CODE.slice(VIEW_CODE.indexOf('private onCueZoomWheel'));
        const head = body.slice(0, body.indexOf('private scrollCueTo'));
        expect(head).not.toMatch(/\.style\.transform/);
        expect(head).not.toMatch(/\.style\.zoom/);
    });

    it('🔴 缩放不算「用户手动滚动」：markUser 必须先放修饰键滚轮过去', () => {
        const at = VIEW_CODE.indexOf('const markUser');
        expect(at).toBeGreaterThan(-1);
        const body = VIEW_CODE.slice(at, at + 600);
        // 否则「Ctrl+滚一格缩放」会被记成手动滚动 ⇒ cueFollow 被永久关掉
        expect(body).toMatch(/if\s*\(\s*wev\.ctrlKey\s*\|\|\s*wev\.metaKey\s*\)\s*return;/);
    });

    it('缩放后重算当前行对位（否则锁定态的当前行掉出视野）', () => {
        const body = VIEW_CODE.slice(VIEW_CODE.indexOf('private onCueZoomWheel'));
        const head = body.slice(0, body.indexOf('private scrollCueTo'));
        expect(head).toContain('this.scrollCueTo(this.cueActiveIdx)');
        // ⛔ 不许顺手清跟随：那会让用户调完字号发现字幕不再跟播放走
        expect(head).not.toMatch(/cueFollow\s*=\s*false/);
    });

    it('🔴 缩放引起的重排 scroll 不算「用户手动滚动」（否则 cueFollow 被误关）', () => {
        // 缩放时打点
        const zoomBody = VIEW_CODE.slice(VIEW_CODE.indexOf('private onCueZoomWheel'));
        const zoomHead = zoomBody.slice(0, zoomBody.indexOf('private scrollCueTo'));
        expect(zoomHead).toContain('this.cueZoomAt = Date.now()');
        // onCueScroll 必须先看这个点再判「用户输入」
        const at = VIEW_CODE.indexOf('private onCueScroll');
        const scrollBody = VIEW_CODE.slice(at, at + 1400);
        const zoomGuard = scrollBody.indexOf('this.cueZoomAt <');
        const userGuard = scrollBody.indexOf('this.cueUserInputAt >');
        expect(zoomGuard).toBeGreaterThan(-1);
        expect(zoomGuard).toBeLessThan(userGuard);
    });

    it('面板重建时重新 apply（否则重开视图掉回 100%）', () => {
        expect(VIEW_CODE).toContain('applyCueScale(host, this.cueScale);');
    });

    it('初值来自 loadCueScale（否则每次进来都从 100% 开始）', () => {
        expect(VIEW_CODE).toMatch(/cueScale\s*=\s*loadCueScale\(\)\s*\?\?\s*CUE_SCALE_DEFAULT/);
    });
});

describe('cueZoom · 🔴 查词气泡的发声按钮已删除（用户 m02829）', () => {
    it('视图里不再创建 🔊 按钮', () => {
        expect(VIEW_CODE).not.toContain('rl-epp-wordtip-say');
        expect(VIEW_CODE).not.toContain('SpeechSynthesisUtterance');
        expect(VIEW_CODE).not.toContain('window.speechSynthesis');
    });

    it('样式表里也不许留着那条规则（样式在而按钮不在会让人以为只是被藏了）', () => {
        expect(CSS).not.toContain('.rl-epp-wordtip-say');
    });
});