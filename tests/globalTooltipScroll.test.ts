// @vitest-environment jsdom
/**
 * 全局 hover 提示（`data-tip`）的滚动收起口径。
 *
 * 🔴 2026-11-08 用户报障「字幕面板上的图标按钮鼠标 hover 不显示提示」—— 根因真缺陷：
 *    `globalTooltip` 把 `scroll` 监听挂在 document 的**捕获阶段**，页面里任何元素的内部滚动
 *    都会打进来。字幕列表 `.rl-epp-cuelist` 随播放自动翻页（#737 起还是平滑滚动，一次翻页
 *    派发上百个 scroll 事件）⇒ 鼠标一悬停、500ms 延迟刚开始就被那次**与按钮毫无关系**的
 *    滚动取消，提示永远出不来。
 *    （修复前本文件第 1 条会红：`expect(exists).toBe(true)` 实得 false。）
 *
 * 修好之后必须同时满足两条相反的要求，本文件就是锁这对矛盾：
 *   A. 无关容器滚动 ⇒ 提示照常出现（延迟期间不取消，位置到 show() 时才量）
 *   B. 元素自己的祖先滚动 ⇒ 已显示的提示必须收起（否则固定定位气泡留在原地错位）
 *
 * ⚠️ `initGlobalTooltip()` / `bindTooltipDocument()` 是**按 document 幂等**的（`boundDocs`
 *    WeakMap），同一个 document 只能绑一次、且 `destroy()` 不清 `boundDocs` ⇒ 每个用例各建
 *    一份独立 document，否则第二个用例的监听根本没挂上，会得到「怎么测都绿」的假象。
 */
import { describe, expect, it } from 'vitest';
import { bindTooltipDocument } from 'services/globalTooltip';

/** 等过 500ms 的默认延迟 + 余量 */
const AFTER_DELAY = 650;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** 造一个带 data-tip 的按钮，返回按钮与其图标子节点（真实 hover 落在图标上） */
function makeCueButton(doc: Document, tip: string): { btn: HTMLElement; icon: HTMLElement } {
    const btn = doc.createElement('button');
    btn.className = 'rl-epp-cuetool';
    btn.setAttribute('data-tip', tip);
    const icon = doc.createElement('svg');
    btn.appendChild(icon);
    // 真实按钮还带读屏名 span，一起造出来（它也是 data-tip 元素的后代）
    const sr = doc.createElement('span');
    sr.className = 'rl-sr';
    sr.textContent = tip;
    btn.appendChild(sr);
    return { btn, icon };
}

describe('globalTooltip · 滚动收起口径', () => {
    it('A 无关容器的内部滚动不取消待显示提示（字幕自动翻页时提示照常出现）', async () => {
        const doc = document;
        doc.body.innerHTML = '';
        // 模拟字幕列表：一个与按钮毫无关系的可滚动兄弟容器
        const cueList = doc.createElement('div');
        cueList.style.overflow = 'auto';
        doc.body.appendChild(cueList);

        const { btn, icon } = makeCueButton(doc, '放大字幕、悬停查词、循环跟读');
        doc.body.appendChild(btn);

        bindTooltipDocument(doc);
        icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

        // 延迟期间字幕列表自动滚动（捕获阶段会打到 document 上的监听）
        cueList.dispatchEvent(new Event('scroll'));

        await sleep(AFTER_DELAY);
        const tip = doc.querySelector('.rl-tip') as HTMLElement | null;
        expect(tip).not.toBeNull();
        expect(tip?.style.display).toBe('block');
        expect(tip?.textContent).toBe('放大字幕、悬停查词、循环跟读');
    });

    it('B 元素祖先滚动时，已显示的提示必须收起（不能留成错位气泡）', async () => {
        const doc = document.implementation.createHTMLDocument('ancestor-scroll');
        const host = doc.createElement('div');
        host.style.overflow = 'auto';
        doc.body.appendChild(host);

        const { btn } = makeCueButton(doc, '与祖先同滚动');
        host.appendChild(btn);

        bindTooltipDocument(doc);
        btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(AFTER_DELAY);

        const before = doc.querySelector('.rl-tip') as HTMLElement | null;
        expect(before?.style.display).toBe('block');

        // 祖先容器滚动 ⇒ 按钮真的被挪走 ⇒ 固定定位的气泡必须收起
        host.dispatchEvent(new Event('scroll'));
        expect(before?.style.display).toBe('none');
    });
});
