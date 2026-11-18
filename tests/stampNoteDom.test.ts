// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 m05415 真机修复：`StampNotePopover` 的 **Esc / Enter 键路**（真 DOM 行为测试）。
 *
 * 为什么必须写成行为测试（而不是 `stampNoteWiring.test.ts` 那种源码文本守卫）：
 *  真机实测发现浮层的 Esc **完全失效** —— 监听挂在 `host` 上永远不触发。
 *  逐层埋点铁证：真实按键下 `winCap:1, docCap:0, hostCap:0, noteCap:0`
 *  ⇒ **Obsidian 在 `window` 捕获阶段就把按键吃掉**（它自己的 Esc 关面板逻辑），
 *  事件根本没进到 document、更进不到浮层。
 *
 *  ⇒ 旧修的文本守卫（"只要有 addEventListener"）对这种**挂错层**的错完全无感：
 *    mutation ① 删掉 window 那条、② 改成 document、③ 不摘监听，三个都仍绿。
 *    所以这里用 jsdom 真的建 DOM、真的派发 keydown，并**模拟 Obsidian 的截断**
 *    （在 window 捕获阶段 `stopPropagation`），只有挂在 window 捕获的监听能活下来。
 */

function patchDom(): void {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.createDiv !== 'function') {
        proto.createDiv = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
            const d = document.createElement('div');
            if (o?.cls) d.className = o.cls;
            if (o?.text !== undefined) d.textContent = o.text;
            this.appendChild(d);
            return d;
        };
        proto.createSpan = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
            const s = document.createElement('span');
            if (o?.cls) s.className = o.cls;
            if (o?.text !== undefined) s.textContent = o.text;
            this.appendChild(s);
            return s;
        };
        proto.createEl = function (this: HTMLElement, tag: string, o?: { cls?: string; text?: string; attr?: Record<string, string> }) {
            const el = document.createElement(tag);
            if (o?.cls) el.className = o.cls;
            if (o?.text !== undefined) el.textContent = o.text;
            if (o?.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v);
            this.appendChild(el);
            return el;
        };
        proto.addClass = function (this: HTMLElement, c: string) { this.classList.add(c); };
        proto.removeClass = function (this: HTMLElement, c: string) { this.classList.remove(c); };
        proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); };
        proto.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
        proto.empty = function (this: HTMLElement) {
            while (this.firstChild) this.removeChild(this.firstChild);
        };
    }
}
patchDom();

// Obsidian 提供全局 `activeDocument`（多窗口下的"当前文档"）；jsdom 没有这个全局。
// 产品代码用它判焦点是否在浮层内 —— 这是真实环境里的正确写法，⛔ 别为测试改成 `document`。
(globalThis as unknown as { activeDocument: Document }).activeDocument = document;

// ⚠️ `tests/mocks/obsidian.ts` 没导出 `setIcon`（那是 DOM 图标工具，不是类），
//    而浮层里用它给关闭/笑脸按钮打图标。本文件只关心键路，图标是无副作用装饰 ⇒ 打桩即可。
//    ⛔ 别为了让测试过就把产品代码里的 `setIcon` 删掉 —— 那是真机确实显示图标的地方。
vi.mock('obsidian', async (orig) => {
    const actual = await orig<typeof import('../tests/mocks/obsidian')>();
    return { ...actual, setIcon: () => undefined };
});

import { StampNotePopover } from '../src/views/StampNotePopover';
/**
 * Obsidian 的截断模拟：在 window 捕获阶段**先**注册一个监听，
 * 把事件 stopPropagation 掉 —— 这与真机观测（docCap/hostCap/noteCap 全 0）一致。
 * ⚠️ 顺序很关键：本文件在 `mount()` **之前**注册，所以它比浮层的 window 捕获监听更早执行；
 *    但两者同在 window 捕获阶段 ⇒ 先注册的先跑，浮层那条仍会被调用（真机也是这样：
 *    `winCap:1` 说明 window 捕获阶段确实还有别的监听在跑）。
 *    真正的「截断」发生在 window 捕获**之后**、document 捕获**之前** ⇒ 等价于：
 *    事件进入 document 之前就被掐掉。
 */
function installObsidianKeyInterception(): () => void {
    const blocker = (ev: Event): void => {
        // 模拟 Obsidian：吃掉按键，不让它往 document / 目标元素传播
        ev.stopPropagation();
    };
    // 挂在 document 的捕获阶段并 stopPropagation ⇒ 目标是 host 里的 input，
    // 传播路径 window(cap) → document(cap) → … → host → input，
    // 在 document 捕获阶段掐掉，host 与 input 都收不到（真机就是 hostCap:0 / noteCap:0）。
    document.addEventListener('keydown', blocker, true);
    return () => document.removeEventListener('keydown', blocker, true);
}

function mountPopover(): {
    host: HTMLElement;
    pop: StampNotePopover;
    committed: Array<{ mood?: string; note: string }>;
    closes: () => number;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const committed: Array<{ mood?: string; note: string }> = [];
    let closed = 0;
    const pop = new StampNotePopover({
        timeText: '第1集·0:31',
        onCommit: (r) => { committed.push({ mood: r.mood, note: r.note }); },
        onClose: () => { closed++; },
    });
    pop.mount(host);
    return { host, pop, committed, closes: () => closed };
}

const press = (key: string, shift = false): void => {
    const ev = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
    // 派发到当前焦点元素（真机上按键就落在焦点元素上）
    (document.activeElement ?? document.body).dispatchEvent(ev);
};

beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('🔴 m05415 真机 bug：Obsidian 在 window 捕获阶段吃键，Esc 必须还能关掉浮层', () => {
    it('⛔ 前提守卫：确实模拟了「document 捕获就截断」（否则下面几条会变成假绿）', () => {
        const uninstall = installObsidianKeyInterception();
        const seen: string[] = [];
        const docBubble = (): void => { seen.push('docBubble'); };
        document.addEventListener('keydown', docBubble, false);
        const target = document.createElement('input');
        document.body.appendChild(target);
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.removeEventListener('keydown', docBubble, false);
        uninstall();
        // 截断生效 ⇒ 冒泡到 document 的监听收不到
        expect(seen).toEqual([]);
    });

    it('🔴 真机场景复现：document 捕获截断下，Esc 仍能关闭浮层（⛔ 靠 host 监听的实现会死在这里）', () => {
        const uninstall = installObsidianKeyInterception();
        const { pop, closes } = mountPopover();
        (document.querySelector('.rl-stampnote-note') as HTMLInputElement).focus();
        press('Escape');
        uninstall();
        expect(closes()).toBe(1);
        expect(document.querySelector('.rl-stampnote-note')).toBeNull();
        pop.destroy();
    });

    it('🔴 Enter 同样要能落盘（同一条 window 捕获通路）', async () => {
        const uninstall = installObsidianKeyInterception();
        const { pop, committed } = mountPopover();
        const note = document.querySelector('.rl-stampnote-note') as HTMLInputElement;
        note.value = '真机探针备注';
        note.dispatchEvent(new Event('input', { bubbles: true }));
        note.focus();
        press('Enter');
        uninstall();
        await Promise.resolve();
        expect(committed).toHaveLength(1);
        expect(committed[0].note).toBe('真机探针备注');
        pop.destroy();
    });

    it('⛔ 不许无条件吞全窗口 Esc：焦点不在浮层时按 Esc 不能关掉它', () => {
        const uninstall = installObsidianKeyInterception();
        const { pop, closes } = mountPopover();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        press('Escape');
        uninstall();
        expect(closes()).toBe(0);
        pop.destroy();
    });

    it('🔴 destroy 必须摘掉 window 监听（否则多个浮层叠加时会重复响应同一个 Esc）', () => {
        const uninstall = installObsidianKeyInterception();
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { pop, closes } = mountPopover();
        // ⚠️ `window.addEventListener` 是重载签名，`vi.spyOn` 会把 calls 推断成
        //   `keyof DedicatedWorkerGlobalScopeEventMap` 那一版 ⇒ 与 'keydown' 比较报 TS2367。
        //   这里只关心「第一个参数是不是 keydown、第三个是不是 true」，与重载无关，显式断言即可。
        type CallArgs = [unknown, unknown, unknown];
        const added = (addSpy.mock.calls as unknown as CallArgs[]).filter((c) => c[0] === 'keydown' && c[2] === true);
        expect(added.length).toBe(1);
        const handler = added[0][1];
        pop.destroy();
        // destroy 必须用**同一个引用 + 同一个 capture 位**摘掉
        const removed = (removeSpy.mock.calls as unknown as CallArgs[]).filter(
            (c) => c[0] === 'keydown' && c[2] === true && c[1] === handler,
        );
        expect(removed.length).toBe(1);
        addSpy.mockRestore();
        removeSpy.mockRestore();
        uninstall();
        // 已销毁 ⇒ 再按 Esc 不该有人响应
        press('Escape');
        expect(closes()).toBe(0);
    });

    it('🔴 Esc 必须 preventDefault（否则 Obsidian 会顺手把面板/设置一起关掉）', () => {
        const uninstall = installObsidianKeyInterception();
        const { pop } = mountPopover();
        const note = document.querySelector('.rl-stampnote-note') as HTMLInputElement;
        note.focus();
        const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        note.dispatchEvent(ev);
        uninstall();
        expect(ev.defaultPrevented).toBe(true);
        pop.destroy();
    });

    it('🔴 提交后浮层必须先摘掉（否则点完还能再点一次，重复写入）', async () => {
        const uninstall = installObsidianKeyInterception();
        const { pop, committed } = mountPopover();
        const ok = document.querySelector('.rl-stampnote-ops .mod-cta') as HTMLButtonElement;
        ok.click();
        await Promise.resolve();
        const afterFirst = committed.length;
        // 浮层已摘 ⇒ 节点没了
        expect(document.querySelector('.rl-stampnote-ops')).toBeNull();
        ok.click();
        await Promise.resolve();
        uninstall();
        // 第二次点击不许再写一条
        expect(committed.length).toBe(afterFirst);
        expect(committed.length).toBe(1);
        pop.destroy();
    });
});
