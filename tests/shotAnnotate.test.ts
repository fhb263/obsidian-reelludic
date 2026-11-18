/**
 * ⑰ 截图右键即时批注（用户 `m07854` ⑰）的守卫测试。
 *
 * 三层各钉一段：
 *   ① `pure/shotAnnotate` —— 归一化坐标 / 误触丢弃 / 撤销 / 马赛克块布局；
 *   ② `render/shotAnnotateDraw` —— 用**假 2D 上下文**记调用序列，钉住「马赛克从原图采样」这条；
 *   ③ 接线 —— 左键仍是 `takeShot()`，右键 `contextmenu` + `preventDefault`，两条走同一个
 *      `onCaptureShot` 出口（⛔ 宿主里不开第二条写笔记的路）。
 *
 * 🔴 strip 铁律：Svelte 的 HTML 注释也要剥 ⇒ 单次交替正则。
 * 🔴 ⛔ 源码文本里不许出现裸的块注释收尾符（本仓已栽三次：⑧ / ⑭ / #760）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    ANNOTATE_MIN_SIZE,
    ANNOTATE_TOOLS,
    ANNOTATE_TOOL_LABELS,
    ANNOTATE_TOOL_TIPS,
    annotateHint,
    canUndo,
    makeNumberShape,
    makePenShape,
    makeShape,
    makeTextShape,
    mosaicBlockFor,
    mosaicBlocks,
    shapeBounds,
    strokeWidthFor,
    toNorm,
    toPx,
    undoShapes,
    cloneShapes,
    type AnnotationShape,
} from 'pure/shotAnnotate';
import { ANNOTATE_STROKE_STYLE, replayShapes, type Ctx2D } from 'pure/shotAnnotateDraw';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (src: string): string => src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

describe('#770 ⑰ · 归一化坐标', () => {
    it('像素坐标 → 0..1', () => {
        expect(toNorm(400, 225, 800, 450)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('拖到画布外也不产生越界坐标', () => {
        expect(toNorm(-50, -999, 800, 450)).toEqual({ x: 0, y: 0 });
        expect(toNorm(9999, 9999, 800, 450)).toEqual({ x: 1, y: 1 });
    });

    it('宽高为 0 时退化但不抛（NaN 会让整张图导出失败）', () => {
        const p = toNorm(10, 10, 0, 0);
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
    });

    it('反归一化能还原像素', () => {
        expect(toPx({ x: 0.25, y: 0.5 }, 800, 450)).toEqual({ x: 200, y: 225 });
    });
});

describe('#770 ⑰ · 形状与误触', () => {
    it('七种工具都能造形状（拖动类走 makeShape，点放类各有专用构造器）', () => {
        for (const tool of ANNOTATE_TOOLS) {
            if (tool === 'pen') {
                const s = makePenShape([
                    { x: 0.1, y: 0.1 },
                    { x: 0.4, y: 0.3 },
                    { x: 0.6, y: 0.6 },
                ]);
                expect(s?.tool).toBe('pen');
                continue;
            }
            if (tool === 'text') {
                expect(makeTextShape({ x: 0.5, y: 0.5 }, '标注')?.tool).toBe('text');
                continue;
            }
            if (tool === 'number') {
                expect(makeNumberShape({ x: 0.5, y: 0.5 }, 1).tool).toBe('number');
                continue;
            }
            const s = makeShape(tool, { x: 0.1, y: 0.1 }, { x: 0.6, y: 0.6 });
            expect(s?.tool).toBe(tool);
        }
    });

    it('makeShape 只接拖动类：pen / text / number 必须返回 null（⛔ 别拿拖拽口径套点放工具）', () => {
        for (const tool of ['pen', 'text', 'number'] as const) {
            expect(makeShape(tool, { x: 0.1, y: 0.1 }, { x: 0.6, y: 0.6 })).toBeNull();
        }
    });

    it('过小的一笔当误触丢掉（否则撤销一次没反应会被当成按钮坏了）', () => {
        const tiny = makeShape('ellipse', { x: 0.5, y: 0.5 }, { x: 0.5 + ANNOTATE_MIN_SIZE / 2, y: 0.5 });
        expect(tiny).toBeNull();
    });

    it('扁平箭头不该被误判成误触（用长边判，不用短边）', () => {
        const flat = makeShape('arrow', { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.501 });
        expect(flat).not.toBeNull();
    });

    it('包围盒自动摆正方向（从右下往左上拖也对）', () => {
        const s = makeShape('ellipse', { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.3 }) as AnnotationShape;
        const b = shapeBounds(s, 1000, 1000);
        expect(b.left).toBeCloseTo(200);
        expect(b.top).toBeCloseTo(300);
        expect(b.width).toBeCloseTo(400);
        expect(b.height).toBeCloseTo(300);
    });
});

describe('#770 ⑰ · 撤销与深拷贝', () => {
    const a = makeShape('ellipse', { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) as AnnotationShape;
    const b = makeShape('arrow', { x: 0, y: 0 }, { x: 0.9, y: 0.9 }) as AnnotationShape;

    it('撤销弹掉最后一个，且返回新数组（不原地 pop，Svelte 才看得到变化）', () => {
        const src = [a, b];
        const out = undoShapes(src);
        expect(out).toHaveLength(1);
        expect(out[0]).toBe(a);
        expect(src).toHaveLength(2);
    });

    it('空列表撤销仍是空列表', () => {
        expect(undoShapes([])).toEqual([]);
    });

    it('canUndo 跟着长度走（撤销按钮可点态的判据）', () => {
        expect(canUndo([])).toBe(false);
        expect(canUndo([a])).toBe(true);
    });

    it('cloneShapes 是深拷贝：改副本不动原件', () => {
        const copy = cloneShapes([a]);
        // 七工具后 `AnnotationShape` 是联合类型（pen/text/number 没有 `to`），这里显式收窄到拖动类变体
        const first = copy[0] as { to: { x: number; y: number } };
        first.to.x = 0.99;
        expect((a as { to: { x: number; y: number } }).to.x).toBe(0.5);
    });
});

describe('#770 ⑰ · 马赛克块布局', () => {
    const shape = makeShape('mosaic', { x: 0.25, y: 0.25 }, { x: 0.5, y: 0.5 }) as AnnotationShape;

    it('块边长按画面短边换算，且不小于 2px', () => {
        expect(mosaicBlockFor(1920, 1080)).toBe(9);
        expect(mosaicBlockFor(10, 10)).toBe(2);
    });

    it('块坐标按块对齐（同形状在任何分辨率下观感一致）', () => {
        const blocks = mosaicBlocks(shape, 800, 800);
        expect(blocks.length).toBeGreaterThan(0);
        const size = mosaicBlockFor(800, 800);
        for (const b of blocks) {
            expect(b.x % size).toBe(0);
            expect(b.y % size).toBe(0);
        }
    });

    it('形状拖到画布外时只返回与画面相交的块（不产生负坐标）', () => {
        const out = makeShape('mosaic', { x: 0, y: 0 }, { x: 0.05, y: 0.05 }) as AnnotationShape;
        for (const b of mosaicBlocks(out, 400, 400)) {
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.y).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('#770 ⑰ · 绘制层（假上下文记调用序列）', () => {
    /** 只记录「谁被调了、参数是什么」的最小假上下文。 */
    function fakeCtx(pixels?: ArrayLike<number>): { ctx: Ctx2D; calls: string[]; fills: string[] } {
        const calls: string[] = [];
        const fills: string[] = [];
        const ctx = {
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1,
            lineCap: '',
            lineJoin: '',
            save: () => calls.push('save'),
            restore: () => calls.push('restore'),
            beginPath: () => calls.push('beginPath'),
            moveTo: () => calls.push('moveTo'),
            lineTo: () => calls.push('lineTo'),
            closePath: () => calls.push('closePath'),
            ellipse: () => calls.push('ellipse'),
            stroke: () => calls.push('stroke'),
            fill: () => calls.push('fill'),
            fillRect: () => {
                calls.push('fillRect');
                fills.push(String(ctx.fillStyle));
            },
            getImageData: () => {
                calls.push('getImageData');
                return { data: pixels ?? [10, 20, 30, 255, 10, 20, 30, 255] };
            },
        } as unknown as Ctx2D;
        return { ctx, calls, fills };
    }

    it('画圈走 ellipse + stroke', () => {
        const { ctx, calls } = fakeCtx();
        const s = makeShape('ellipse', { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.7 }) as AnnotationShape;
        replayShapes(ctx, null, [s], 800, 600);
        expect(calls).toContain('ellipse');
        expect(calls).toContain('stroke');
        expect(calls).not.toContain('getImageData');
    });

    it('箭头画主干 + 两条翼（moveTo 至少三次）', () => {
        const { ctx, calls } = fakeCtx();
        const s = makeShape('arrow', { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }) as AnnotationShape;
        replayShapes(ctx, null, [s], 800, 600);
        expect(calls.filter((c) => c === 'moveTo').length).toBeGreaterThanOrEqual(3);
        expect(calls.filter((c) => c === 'stroke').length).toBeGreaterThanOrEqual(2);
    });

    it('🔴 马赛克从**传进来的原图**采样，而不是从自己身上采样', () => {
        const { ctx, calls } = fakeCtx();
        const src = fakeCtx();
        const s = makeShape('mosaic', { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }) as AnnotationShape;
        replayShapes(ctx, src.ctx, [s], 400, 400);
        expect(src.calls).toContain('getImageData');
        expect(calls).not.toContain('getImageData');
        expect(calls).toContain('fillRect');
    });

    it('原图缺失时退化成可辨识的遮挡块（⛔ 静默什么都不画）', () => {
        const { ctx, calls } = fakeCtx();
        const s = makeShape('mosaic', { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) as AnnotationShape;
        replayShapes(ctx, null, [s], 400, 400);
        expect(calls).toContain('fillRect');
    });

    it('马赛克用采样均值上色（不是随便一种色）', () => {
        const { ctx, fills } = fakeCtx([10, 20, 30, 255, 10, 20, 30, 255]);
        const s = makeShape('mosaic', { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) as AnnotationShape;
        replayShapes(ctx, fakeCtx([10, 20, 30, 255, 10, 20, 30, 255]).ctx, [s], 400, 400);
        expect(fills.every((f) => f === 'rgb(10,20,30)')).toBe(true);
    });

    it('🔴 描边用固定高对比色，⛔ 不跟主题（截图会被插进笔记，换主题红圈就看不清）', () => {
        expect(ANNOTATE_STROKE_STYLE).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ANNOTATE_STROKE_STYLE.toLowerCase()).toBe('#ff3b30');
    });

    it('描边宽度与画面尺寸成比例且有下限', () => {
        expect(strokeWidthFor(1920, 1080)).toBeGreaterThan(strokeWidthFor(800, 450));
        expect(strokeWidthFor(10, 10)).toBe(1);
    });
});

describe('#770 ⑰ · 文案', () => {
    it('三种工具都有中文名与提示（⛔ 别在弹窗里另写一份）', () => {
        for (const t of ANNOTATE_TOOLS) {
            expect(ANNOTATE_TOOL_LABELS[t].length).toBeGreaterThan(0);
            expect(ANNOTATE_TOOL_TIPS[t].length).toBeGreaterThan(0);
        }
    });

    it('状态行带笔数', () => {
        expect(annotateHint('ellipse', 0)).toContain('按住拖拽');
        expect(annotateHint('ellipse', 2)).toContain('已画 2 笔');
    });
});

describe('#770 ⑰ · 接线：左键不变，右键进批注', () => {
    const viewSrc = read('src/views/VideoPlayerView.ts');
    const viewRaw = viewSrc;
    const view = strip(viewSrc);
    const modalSrc = read('src/modals/ShotAnnotateModal.ts');
    const modal = strip(modalSrc);

    it('左键仍是一键截图（takeShot 的 click 绑定一字未改）', () => {
        expect(view).toMatch(/shotBtn\.addEventListener\('click', \(\) => void this\.takeShot\(\)\);/);
    });

    it('右键 contextmenu 进批注，且 preventDefault（否则原生右键菜单会压在上面）', () => {
        expect(view).toMatch(/shotBtn\.addEventListener\('contextmenu'/);
        const at = view.indexOf("shotBtn.addEventListener('contextmenu'");
        const block = view.slice(at, at + 320);
        expect(block).toMatch(/ev\.preventDefault\(\)/);
        expect(block).toMatch(/this\.annotateShot\(\)/);
    });

    it('🔴 不在 mousedown 里拦右键（会吞掉左键 click 派发链）', () => {
        expect(view).not.toMatch(/shotBtn\.addEventListener\('mousedown'/);
    });

    it('批注与左键走**同一个** onCaptureShot 出口（宿主不开第二条写笔记的路）', () => {
        const at = view.indexOf('async annotateShot(');
        expect(at).toBeGreaterThan(-1);
        const body = view.slice(at, at + 900);
        expect(body).toMatch(/const cb = this\.opts\?\.onCaptureShot;/);
        expect(body).toMatch(/new ShotAnnotateModal\(this\.app/);
        expect(body).toMatch(/onSave: \(annotated\) => cb\(\{ png: annotated, seconds, ep \}\)/);
    });

    it('弹窗导出前把底图合成进去（否则落盘的是透明底 + 几笔红线）', () => {
        expect(modal).toMatch(/ctx\.drawImage\(base, 0, 0\)/);
        expect(modal).toMatch(/ctx\.drawImage\(over, 0, 0\)/);
        // 两行顺序必须是先底后覆盖
        expect(modal.indexOf('drawImage(base, 0, 0)')).toBeLessThan(modal.indexOf('drawImage(over, 0, 0)'));
    });

    it('🔴 重绘时马赛克采样源是 base（不是 over，否则越打越糊）', () => {
        expect(modal).toMatch(/const src = base\.getContext\('2d'\)/);
        expect(modal).toMatch(/replayShapes\(ctx as never, src as never/);
    });

    it('撤销走 undoShapes 整帧重放（⛔ 不做堆积快照）', () => {
        expect(modal).toMatch(/this\.shapes = undoShapes\(this\.shapes\)/);
        expect(modal).toMatch(/private repaint\(\): void/);
    });

    it('弹窗不碰 vault（落盘与写笔记的唯一拥有者是宿主）', () => {
        expect(modal).not.toMatch(/vault\.(create|createBinary|modify|append)/);
    });

    it('⛔ 不用 position: fixed 画在播放器上（会被 transform 祖先偏移）', () => {
        expect(view).not.toMatch(/rl-anno-stage[^\n]*fixed/);
    });

    it('样式只用主题变量、无 hex（⛔ 硬编码色在换主题时必翻车）', () => {
        const css = strip(read('styles.css'));
        const start = css.indexOf('.rl-anno-modal');
        expect(start).toBeGreaterThan(-1);
        // ⚠️ 不能按固定字符数切：越界会把旁边 `.rl-btn-danger` 段的 `#fff` 算进来（首跑就这么假红）
        const end = css.indexOf('.modal-content button.rl-nc-danger', start);
        expect(end).toBeGreaterThan(start);
        const seg = css.slice(start, end);
        expect(seg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(seg).toMatch(/var\(--interactive-accent\)/);
        expect(seg).toMatch(/var\(--background-modifier-hover\)/);
    });

    it('右键判定被抽成可测函数（合成事件 button 可能为 0）', () => {
        expect(modalRaw()).toMatch(/export function isAnnotateRequest/);
    });

    function modalRaw(): string {
        return modalSrc;
    }
});

describe('🔴 2026-11-14 用户 m03072 ⑤ · 批注弹窗与框选层的三条 bug', () => {
    const modal = strip(read('src/modals/ShotAnnotateModal.ts'));
    const overlay = strip(read('src/modals/ShotOverlay.ts'));
    const css = strip(read('styles.css'));

    it('工具条纯图标横排：模板里不再有文字标签 span（用户原话「不要标注文字，直接图标显示横排就行了」）', () => {
        expect(modal).not.toMatch(/rl-anno-tool-label/);
        // 文字退到悬停提示，⛔ 不是直接丢掉（否则新手不知道哪个是哪个）。
        // ⚠️ 但⛔ 不能改成 `aria-label`：本仓有「悬停提示单一真源」硬门禁
        //    （`tests/tooltipSingleSource.test.ts`），`data-tip` 与 `aria-label` 双挂会叠出两层气泡。
        expect(modal).toMatch(/btn\.setAttribute\('data-tip', ANNOTATE_TOOL_TIPS\[t\]\)/);
        expect(modal).not.toMatch(/setAttribute\('aria-label'/);
        // 样式也要跟模板对齐（留死 CSS 会顶破 Unused CSS 门禁）
        expect(css).not.toMatch(/rl-anno-tool-label/);
    });

    it('🔴 拖动类工具必须用 dragFrom 记起点（draft 从同点起手 ⇒ span=0 ⇒ makeShape 恒 null ⇒ 永远画不出来）', () => {
        // 根因：pointerdown 里 makeShape(tool, p, p) 恒 null；pointermove 的 first 又回落成当前点
        expect(modal).toMatch(/private dragFrom: \{ x: number; y: number \} \| null = null;/);
        expect(modal).toMatch(/this\.dragFrom = p;/);
        expect(modal).toMatch(/const from = this\.dragFrom \?\? p;/);
        expect(modal).toMatch(/makeShape\(this\.tool, from, p\)/);
        // ⛔ 别退回「从 draft 里捞 from」：draft 恒 null 时那条回退就是 bug 本身
        expect(modal).not.toMatch(/this\.draft && 'from' in this\.draft \? this\.draft\.from : p/);
        // 松手/取消都要清干净，否则下一次拖拽会用上一次的起点
        expect(modal).toMatch(/this\.dragFrom = null;/);
    });

    it('🔴 批注模式框选后要有**可见**的「批注 / 取消」按钮（不能只认回车/双击）', () => {
        expect(overlay).toMatch(/rl-shot-ops/);
        expect(overlay).toMatch(/this\.okText = opts\.okText\?\.trim\(\) \|\| '批注';/);
        expect(overlay).toMatch(/ops\.createEl\('button', \{ cls: 'mod-cta', text: this\.okText \}\)/);
        expect(overlay).toMatch(/ops\.createEl\('button', \{ text: '取消' \}\)/);
        // 按钮必须真的能点：挂进 `.rl-shot-box` 会因父级 pointer-events:none 变成装饰
        expect(css).toMatch(/\.rl-shot-ops \{[^}]*pointer-events: auto;/);
        expect(overlay).toMatch(/const ops = el\.createDiv\(\{ cls: 'rl-shot-ops hidden' \}\);/);
        // capture 阶段的 pointerdown 会把 click 吞掉 ⇒ 点在按钮上必须原样放行
        expect(overlay).toMatch(/this\.opsEl\.contains\(ev\.target\)\) return;/);
    });

    it('按钮跟着选框走（框动了/手柄拖了都要重摆，⛔ 钉在固定角落）', () => {
        expect(overlay).toMatch(/private paintOps\(\): void/);
        expect(overlay).toMatch(/if \(this\.adjust\) this\.paintOps\(\);/);
        expect(overlay).toMatch(/ops\.style\.top = /);
        expect(overlay).toMatch(/ops\.style\.left = /);
    });

    it('四个阅读器的提示都说「点批注确认」，而不是只有回车（文案与 UI 必须一致）', () => {
        for (const rel of [
            'src/modals/PdfReaderModal.ts',
            'src/modals/EpubReaderModal.ts',
            'src/modals/TxtReaderModal.ts',
            'src/modals/ComicReaderModal.ts',
        ]) {
            expect(read(rel)).toMatch(/点「批注」确认/);
        }
    });
});
