import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefersReducedMotion, scrollBehavior } from 'pure/motion';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 剥注释再做全文匹配：本仓 #379 / #730 / #731 三次被自己的解释性注释打穿守卫。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const PAGE = stripComments(read('src/views/EpisodePageView.ts'));
const MOUNT = stripComments(read('src/views/audioPlayerMount.ts'));
const CSS = stripComments(read('styles.css'));

describe('pure/motion · 动效偏好', () => {
    it('node 环境没有 window.matchMedia ⇒ 当作「没开减少动效」，返回 smooth', () => {
        // ⚠️ 测试环境是 `environment: 'node'`，`window` 不存在。
        //    这正是 `prefersReducedMotion` 里 try/catch 存在的理由：不能因为读不到媒体查询就抛。
        expect(prefersReducedMotion()).toBe(false);
        expect(scrollBehavior()).toBe('smooth');
    });

    it('两处滚动都走 scrollBehavior()，⛔ 不许在视图里写死 smooth', () => {
        expect(PAGE).toContain("import { scrollBehavior } from 'pure/motion';");
        expect(MOUNT).toContain("import { scrollBehavior } from 'pure/motion';");
        // ⚠️ 只锁这两个函数体：`PAGE` 里另有一处**无关**的
        //    `scrollIntoView({ behavior: 'smooth' })`（选集卡横向定位，不是本次改的对象）。
        //    写成文件级「禁止出现 behavior: 'smooth'」会误报 —— 守卫必须先划清作用域。
        const cueFn = PAGE.slice(PAGE.indexOf('private setCueScroll(top: number): void {'));
        expect(cueFn.slice(0, 1600)).not.toMatch(/behavior:\s*'smooth'/);
        const lyrFn = MOUNT.slice(MOUNT.indexOf('const centerCurLine = (): void => {'));
        expect(lyrFn.slice(0, 900)).not.toMatch(/behavior:\s*'smooth'/);
    });
});

describe('🔴 2026-11-08 字幕面板滚动改平滑（用户原话「不要瞬间切换」）', () => {
    it('setCueScroll 用 scrollTo + 动态 behavior，不再直接赋 scrollTop', () => {
        expect(PAGE).toContain('private setCueScroll(top: number): void {');
        expect(PAGE).toContain('list.scrollTo({ top, behavior });');
        expect(PAGE).not.toContain('list.scrollTop = top;');
    });

    it('平滑模式下不能拿「scrollTop 没变」去摘目标（平滑是异步的）', () => {
        // 真 bug 记录：`scrollTo({behavior:'smooth'})` 返回时 scrollTop 还没动 ⇒ 恒等
        // ⇒ 目标被立刻从队列摘掉，`onCueScroll` 再来就没有东西可消费。
        expect(PAGE).toMatch(/if \(behavior === 'auto' && list\.scrollTop === before\)/);
    });

    it('onCueScroll 的 ±2 判据不被放宽（放宽会让手动滚动打断跟随失灵）', () => {
        expect(PAGE).toContain('Math.abs(pos - t) <= 2');
    });
});

describe('🔴 2026-11-08 歌词滚动改平滑（断言脚本锁死了那一行原文）', () => {
    it('reduced-motion 分支逐字保留原来的赋值（assert-symbols.cjs:6945 的 400 字符窗口）', () => {
        expect(MOUNT).toContain('lyrList.scrollTop = Math.max(0, lyrList.scrollTop + delta);');
    });

    it('平滑分支同样给出 ≥0 的夹取，且 behavior 与降级分支读同一个变量', () => {
        expect(MOUNT).toContain(
            'lyrList.scrollTo({ top: Math.max(0, lyrList.scrollTop + delta), behavior });',
        );
        // 同一个 `behavior` 变量同时喂 `if` 与 `scrollTo`：两分支口径不可能分叉
        expect(MOUNT).toContain('const behavior: ScrollBehavior = scrollBehavior();');
    });

    it('lyricCenterDelta 仍然只被调用一次（视图层不许自己再算一遍）', () => {
        expect(MOUNT.match(/lyricCenterDelta\(/g)?.length ?? 0).toBe(1);
    });
});

describe('🔴 2026-11-08 字幕放大且末行不再像被切（用户原话）', () => {
    it('正文字号 13px 基准 / 行高 1.6（原 12px / 1.5）', () => {
        const block = CSS.slice(CSS.indexOf('.rl-epp-cuetext {'));
        const decl = block.slice(0, block.indexOf('}'));
        // 🔴 2026-11-21 用户 m02829：「字幕面板和字幕面板学习模式都要支持 ctrl 鼠标滚轮缩放」
        //    ⇒ 字号从写死的 `13px` 变成 `calc(13px * var(--rl-epp-cue-scale, 1))`。
        //    判据意图不变（基准仍是 13px、行高仍是 1.6），只是允许被缩放变量乘一次；
        //    ⛔ 别把这里改成单纯 `toContain('13px')` 了事 —— 那句会让「基准被悄悄改成别的值」也通过。
        expect(decl).toContain('calc(13px * var(--rl-epp-cue-scale, 1))');
        expect(decl).toContain('line-height: 1.6');
        expect(decl).not.toContain('font-size: 12px');
        expect(decl).not.toContain('font-size: 13px;');
        // 正文仍然不做裁切：末行截断的真因在滚动视野，不是 line-clamp
        expect(decl).not.toContain('line-clamp');
        expect(decl).not.toContain('overflow: hidden');
    });

    it('学习模式 16px 基准 / 1.85，且与普通档保持明显落差', () => {
        const block = CSS.slice(CSS.indexOf('.rl-epp-cuesbox.is-learn .rl-epp-cuetext {'));
        const decl = block.slice(0, block.indexOf('}'));
        // 同一条口径：基准 16px 也要乘同一个缩放变量，否则「缩放只对普通档生效」
        expect(decl).toContain('calc(16px * var(--rl-epp-cue-scale, 1))');
        expect(decl).toContain('line-height: 1.85');
        expect(decl).not.toContain('font-size: 16px;');
    });

    it('列表底部留 10px 呼吸空间（原来只有 2px ⇒ 末句贴刀刃）', () => {
        const block = CSS.slice(CSS.indexOf('.rl-epp-cuelist {'));
        const decl = block.slice(0, block.indexOf('}'));
        expect(decl).toContain('padding: 2px 0 10px;');
        expect(decl).not.toMatch(/padding:\s*2px 0;/);
    });
});

describe('🔴 2026-11-08 删「B站官方播放器」胶囊（用户原话）', () => {
    it('视图里不再创建 rl-epp-netbar / rl-epp-nettitle，也没有 netTitleEl', () => {
        expect(PAGE).not.toContain('rl-epp-netbar');
        expect(PAGE).not.toContain('rl-epp-nettitle');
        expect(PAGE).not.toContain('netTitleEl');
        expect(PAGE).not.toContain('setNetTitle');
    });

    it('CSS 里那枚胶囊与动画一并退场', () => {
        expect(CSS).not.toContain('.rl-epp-netbar');
        expect(CSS).not.toContain('.rl-epp-nettitle');
        expect(CSS).not.toContain('rl-epp-netbar-autohide');
    });

    it('iframe 的 title 属性按用户裁定保留（无障碍用，不是那枚可见胶囊）', () => {
        expect(PAGE).toContain('title: NET_BAR_TITLE_FRAME');
    });

    it('netEmbedTitleOf 本体保留（tests/netInline.test.ts 还在锁它的三种返回值）', () => {
        expect(read('src/pure/netInline.ts')).toContain('export function netEmbedTitleOf');
    });
});

describe('🔴 2026-11-08 跟读图标不能空白（根因：sync 里没 safeSetIcon）', () => {
    it('syncCueShadowBtn 里真的设了图标', () => {
        const at = PAGE.indexOf('private syncCueShadowBtn(): void {');
        expect(at).toBeGreaterThan(-1);
        const body = PAGE.slice(at, at + 1200);
        expect(body).toContain("safeSetIcon(btn, 'mic-vocal');");
        // mic 已被「音频转文字」占用、repeat* 是循环档位，借用会造成同屏两个同图标按钮
        expect(body).not.toContain("safeSetIcon(btn, 'mic')");
        expect(body).not.toContain("safeSetIcon(btn, 'repeat");
    });

    it('六颗按钮全带 data-tip（globalTooltip 只认这个属性）', () => {
        for (const key of ['mode', 'learn', 'loop', 'shadow', 'asr', 'ai']) {
            expect(PAGE).toContain(`'data-cue': '${key}'`);
        }
        // 提示语按用户裁定只写描述，不加「学习模式：」前缀
        expect(PAGE).not.toContain('学习模式：放大字幕');
    });
});

describe('🔴 2026-11-13 AI 面板每次重画都把页面弹回顶部（用户 m15513 报障）', () => {
    /**
     * 真因：`buildCueAskBox()` 末尾原本**无条件**调
     *   `panel.scrollIntoView({ block: 'nearest', behavior: 'auto' })`，
     * 而该方法在**每次重画**时都会被调用（提交提问 / 回答回来 / 重新生成都走 `showCueAiPanel()`）。
     * 面板比视口高时 `block: 'nearest'` 会把面板**顶边**对齐视口顶边
     * ⇒ 用户每次基于字幕问答，页面都弹回顶部 AI 摘要处。
     */
    it('只滚一次：`scrollIntoView` 必须被 `cuePanelReveal` 闸住', () => {
        const at = PAGE.indexOf('private buildCueAskBox(panel: HTMLElement, body: HTMLElement): void {');
        expect(at).toBeGreaterThan(-1);
        const fn = PAGE.slice(at, at + 4200);
        // 闸门存在：`if (this.cuePanelReveal) { this.cuePanelReveal = false; … scrollIntoView … }`
        expect(fn).toMatch(/if \(this\.cuePanelReveal\) \{\s*this\.cuePanelReveal = false;/);
        const guard = fn.indexOf('if (this.cuePanelReveal)');
        const scroll = fn.indexOf('scrollIntoView(');
        expect(scroll).toBeGreaterThan(guard); // 滚动必须在闸门**之后**
        // 反向守卫：⛔ 不许再出现裸的（无闸门）scrollIntoView
        expect(fn.match(/scrollIntoView\(/g)?.length ?? 0).toBe(1);
    });

    it('`cuePanelReveal` 只在「从无到有」时置真，⛔ 不在每次重画时重置', () => {
        const at = PAGE.indexOf('private async toggleCueAiPanel(): Promise<void> {');
        expect(at).toBeGreaterThan(-1);
        const fn = PAGE.slice(at, at + 1400);
        // 必须排在「已有面板 ⇒ 收起返回」之后
        const close = fn.indexOf('this.destroyCueAiPanel();');
        const arm = fn.indexOf('this.cuePanelReveal = true;');
        expect(arm).toBeGreaterThan(close);
        // ⛔ 不许在 showCueAiPanel / generateCueAi 里把它置真（那等于每次都滚）
        const show = PAGE.indexOf('private showCueAiPanel(');
        expect(show).toBeGreaterThan(-1);
        expect(PAGE.slice(show, show + 800)).not.toContain('cuePanelReveal = true');
    });

    it('字段声明存在且默认 false（⛔ 默认 true 会在首次重画就滚）', () => {
        expect(PAGE).toContain('private cuePanelReveal = false;');
        expect(PAGE).not.toContain('private cuePanelReveal = true;');
    });

    it('滚动仍用 `block: nearest`（⛔ 别改 center：每次重新生成都会把右栏跳一下）', () => {
        const at = PAGE.indexOf('private buildCueAskBox(panel: HTMLElement, body: HTMLElement): void {');
        const fn = PAGE.slice(at, at + 4200);
        expect(fn).toContain("block: 'nearest'");
        expect(fn).not.toContain("block: 'center'");
    });
});
