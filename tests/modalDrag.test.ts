// @vitest-environment jsdom
// 百度搜索内嵌弹窗的拖动（用户 m17476：「要像微信扫码登录弹出的那个界面一样可拖动」）。
//
// 🔴 参照物是独立 OS 窗口：`services/qrLogin.openWereadWindow()` 的 `new BrowserWindow(...)`，
//    拖动由**系统标题栏**提供，插件里一行拖拽代码都没有。内嵌 Modal 没有标题栏 ⇒ 自己实现。
//    所以这里的判据分两层：① 纯算术（夹取/忽略/归零）② 装配（把手、transform、解绑）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DRAG_IGNORE_SELECTOR,
    DRAG_MARGIN,
    clampDragOffset,
    dragAxisRange,
    dragIgnored,
    dragOffsetAfter,
    dragOffsetIsZero,
} from '../src/pure/modalDrag';

const ROOT = resolve(__dirname, '..');
const modalSrc = readFileSync(resolve(ROOT, 'src/modals/BaiduSearchModal.ts'), 'utf8');
const cssSrc = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

/**
 * 剥掉注释再跑反向守卫。
 * 🔴 踩过：`BaiduSearchModal` 的注释里**逐字引用**了反面教材（`display: block`、裸 `createEl('iframe')`），
 *    反向守卫扫原文会撞到自己的注释 ⇒ 假红。
 */
function stripComments(s: string): string {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

describe('拖动位移的边界夹取（弹窗不许被拖出视口）', () => {
    it('弹窗整块放得进视口 ⇒ 位移被夹到「整块可见」的区间', () => {
        // 视口 1000x800，弹窗 400x300 摆在 left=300 top=250
        const box = { left: 300, top: 250, width: 400, height: 300 };
        const vp = { width: 1000, height: 800 };
        // 左边界：left + x ≥ margin ⇒ x ≥ 12-300 = -288
        // 右边界：left + width + x ≤ vp.width - margin ⇒ x ≤ 988-700 = 288
        // 上边界：12-250 = -238；下边界：800-12-550 = 238
        expect(clampDragOffset({ x: -1000, y: 5000 }, box, vp)).toEqual({ x: -288, y: 238 });
        expect(clampDragOffset({ x: 1000, y: -5000 }, box, vp)).toEqual({ x: 288, y: -238 });
    });

    it('小视口 / 大弹窗：整块放不下时仍可拖，只保证露头（⛔ 不许把拖动禁掉）', () => {
        // 弹窗 1200 宽 > 视口 600 ⇒ 整块可见不可能
        const box = { left: 0, top: 0, width: 1200, height: 900 };
        const vp = { width: 600, height: 500 };
        const [minX, maxX] = dragAxisRange(box.left, box.width, vp.width);
        expect(minX).toBe(DRAG_MARGIN - box.width);
        expect(maxX).toBe(vp.width - DRAG_MARGIN - box.left);
        // 🔴 区间必须非空 —— 空区间会让小窗口下的弹窗完全拖不动
        expect(maxX).toBeGreaterThan(minX);
    });

    it('居中弹窗向两边拖的余量对称', () => {
        const vp = { width: 1000, height: 1000 };
        const box = { left: 400, top: 400, width: 200, height: 200 };
        const [minX, maxX] = dragAxisRange(box.left, box.width, vp.width);
        expect(minX).toBe(DRAG_MARGIN - 400);
        expect(maxX).toBe(1000 - DRAG_MARGIN - 600);
        // 余量 = 1000 - 200 - 2*margin = 776；左可拖 388、右可拖 388
        expect(-minX).toBe(388);
        expect(maxX).toBe(388);
    });

    it('脏位移（NaN / Infinity）归零，⛔ 不把弹窗扔到视口外', () => {
        const box = { left: 100, top: 100, width: 200, height: 200 };
        const vp = { width: 800, height: 600 };
        expect(clampDragOffset({ x: Number.NaN, y: 0 }, box, vp)).toEqual({ x: 0, y: 0 });
        expect(
            clampDragOffset({ x: 0, y: Number.POSITIVE_INFINITY }, box, vp).y,
        ).toBeLessThanOrEqual(600);
        expect(dragOffsetAfter({ x: 5, y: 5 }, Number.NaN, Number.NaN)).toEqual({ x: 5, y: 5 });
    });

    it('dragOffsetIsZero 用于「归零时清掉 transform」', () => {
        expect(dragOffsetIsZero({ x: 0, y: 0 })).toBe(true);
        expect(dragOffsetIsZero({ x: 0.5, y: 0 })).toBe(false);
    });
});

describe('拖动与头部按钮共存（按钮必须能点）', () => {
    it('按钮 / 链接 / 输入框 / 可编辑区不启动拖动', () => {
        const mk = (tag: string): Element => document.createElement(tag);
        const btn = mk('button');
        expect(dragIgnored(btn)).toBe(true);
        // 按钮里的 `<svg>` / `<span>` 也得放行（指针落在子节点上）
        const inner = document.createElement('span');
        btn.appendChild(inner);
        expect(dragIgnored(inner)).toBe(true);

        expect(dragIgnored(mk('input'))).toBe(true);
        expect(dragIgnored(mk('a'))).toBe(true);
        const ed = document.createElement('div');
        ed.setAttribute('contenteditable', 'true');
        expect(dragIgnored(ed)).toBe(true);

        // 普通容器可以拖
        expect(dragIgnored(mk('div'))).toBe(false);
        expect(dragIgnored(null)).toBe(false);
    });

    it('忽略选择器覆盖按钮/表单/可编辑区（改动它等于改交互契约）', () => {
        for (const tag of ['button', 'a', 'input', 'textarea', 'select']) {
            expect(DRAG_IGNORE_SELECTOR).toContain(tag);
        }
        expect(DRAG_IGNORE_SELECTOR).toContain('[contenteditable="true"]');
    });
});

describe('弹窗装配（把手 / transform / 解绑）', () => {
    it('头部是拖动把手，且 pointerdown 在 dragIgnored 之后才 preventDefault', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain("handle.addClass('rl-baidu-drag')");
        // 🔴 顺序铁律：先判忽略、再 preventDefault —— 反了会把按钮 click 吞掉
        const iIgnored = code.indexOf('if (dragIgnored(ev.target as Element | null)) return;');
        const iPrevent = code.indexOf('ev.preventDefault();', iIgnored);
        expect(iIgnored).toBeGreaterThan(-1);
        expect(iPrevent).toBeGreaterThan(iIgnored);
    });

    it('用 transform 位移，⛔ 不写 style.left/top（会与 .modal 的 flex 居中打架）', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain('modalEl.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`');
        expect(code).not.toContain('modalEl.style.left');
        expect(code).not.toContain('modalEl.style.top');
    });

    it('位移归零时清掉 transform，不留 translate(0px, 0px)', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain("modalEl.style.removeProperty('transform')");
    });

    it('量盒子时减掉已有位移（否则第二次拖会越拖越偏）', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain('left: rect.left - start.x,');
        expect(code).toContain('top: rect.top - start.y,');
    });

    it('拖动用 pointer capture，松手/取消都解绑（三种事件都清了）', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain('handle.setPointerCapture(ev.pointerId)');
        expect(code).toContain("handle.removeEventListener('pointermove', onMove)");
        expect(code).toContain("handle.removeEventListener('pointerup', onUp)");
        expect(code).toContain("handle.removeEventListener('pointercancel', onUp)");
    });

    it('onClose 先解绑拖动再释放内嵌容器（拖到一半关窗不留悬挂监听）', () => {
        const code = stripComments(modalSrc);
        const iClose = code.indexOf('onClose(): void {');
        const iDetach = code.indexOf('this.detachDrag?.()', iClose);
        const iDispose = code.indexOf('this.host?.dispose()', iClose);
        expect(iDetach).toBeGreaterThan(iClose);
        expect(iDispose).toBeGreaterThan(iDetach);
    });

    it('只认左键 / 单指（中键右键放行给宿主）', () => {
        const code = stripComments(modalSrc);
        expect(code).toContain('if (ev.button !== 0) return;');
    });
});

describe('拖动样式（可拖的视觉提示）', () => {
    it('把手有 grab / grabbing 光标且禁选中（不然拖时会选中标题文字）', () => {
        const css = stripComments(cssSrc);
        expect(css).toMatch(/\.rl-baidu-drag\s*\{[^}]*cursor:\s*grab/);
        expect(css).toMatch(/\.rl-baidu-drag\s*\{[^}]*user-select:\s*none/);
        expect(css).toMatch(/\.rl-baidu-drag:active\s*\{[^}]*cursor:\s*grabbing/);
    });

    it('拖动中关掉过渡（否则弹窗黏在指针后面追）', () => {
        const css = stripComments(cssSrc);
        expect(css).toMatch(/\.rl-baidu-dragging\s*\{[^}]*transition:\s*none/);
    });

    it('把手里的按钮仍是 pointer 光标（别让按钮看起来像拖拽区）', () => {
        const css = stripComments(cssSrc);
        expect(css).toMatch(/\.rl-baidu-drag button[\s\S]{0,120}cursor:\s*pointer/);
    });
});
