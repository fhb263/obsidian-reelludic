// m03052 ②：TXT 目录「卷 → 章」视图层守卫（读源码文本，同 tests/episodeReviewPanel.test.ts 套路）
//
// 为什么需要这一层：tests/txtVolume.test.ts 只验纯函数投影算得对，验不出
//   ① 渲染层到底用没用投影 ② 高亮是否还在按查询下标对齐（本轮修的就是这个真 bug）
//   ③ 折叠态是否真能展开 —— 这三件都只写在 src/modals/TxtReaderModal.ts 的模板逻辑里。
// ⚠️ 剥注释必须用三档不跨行版：本仓有 input type=file accept=image/* 这类字面量，
//   跨行剥法会把它当块注释起点、一路吞十几万字符。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'src/modals/TxtReaderModal.ts'), 'utf8');
const SRC = raw
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/\/\*[^*\n]*\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
const CSS = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

/** 取某方法体（从签名起、按大括号深度配对），拿不到就抛，避免断言静默变空 */
function methodBody(sig: string): string {
    const at = SRC.indexOf(sig);
    expect(at, `找不到方法签名：${sig}`).toBeGreaterThan(-1);
    const open = SRC.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < SRC.length; i++) {
        if (SRC[i] === '{') depth++;
        else if (SRC[i] === '}') {
            depth--;
            if (depth === 0) return SRC.slice(open, i + 1);
        }
    }
    throw new Error(`方法体未闭合：${sig}`);
}

describe('m03052 ② · 目录树渲染按卷分组', () => {
    it('buildBody 用 txtVolumeGroups 投影，⛔ 不再 forEach 扁平的 book.chapters', () => {
        const body = methodBody('private buildBody(): void {');
        expect(body).toContain('const volumes = txtVolumeGroups(this.book.chapters);');
        // 反向守卫：改造前的写法是 this.book.chapters.forEach((ch, i) => {
        expect(body).not.toMatch(/this\.book\.chapters\.forEach\(/);
    });

    it('每个卷出一个 volbody 容器，卷标题非空时才画卷头（散章平铺）', () => {
        const body = methodBody('private buildBody(): void {');
        expect(body).toContain('if (vol.title) this.tocListEl.appendChild(this.buildTocVolumeHead(vol));');
        expect(body).toContain("const body = this.tocListEl.createDiv({ cls: 'rl-reader-toc-volbody' });");
        expect(body).toContain('body.dataset.vol = String(vol.from);');
    });

    it('章按钮带 data-ch 下标并挂在卷体里（点它才切章）', () => {
        const body = methodBody('private buildBody(): void {');
        expect(body).toContain("'rl-reader-toc-item'");
        expect(body).toContain("'data-ch': String(i)");
        expect(body).toMatch(/item\.addEventListener\('click',\s*\(\)\s*=>\s*this\.switchChapter\(i\)\)/);
        // 章循环边界来自组区间，不是全量 chapters
        expect(body).toMatch(/for \(let i = vol\.from; i < vol\.to; i\+\+\)/);
    });
});

describe('m03052 ② · 当前章高亮按 data-ch 精确定位（⛔ 不是查询下标）', () => {
    it('高亮循环用 Number(el.dataset.ch) 比较，而不是 (el, i) => i === chapterIndex', () => {
        const body = methodBody('private renderContent(): void {');
        expect(body).toContain("querySelectorAll<HTMLElement>('.rl-reader-toc-item[data-ch]')");
        expect(body).toContain('Number(el.dataset.ch) === this.chapterIndex');
        // 🔴 这就是本轮修掉的真 bug：加了卷头之后查询下标 ≠ 章下标，高亮会整体错位
        expect(body).not.toMatch(/items\.forEach\(\(el,\s*i\)\s*=>\s*el\.toggleClass\('active',\s*i === this\.chapterIndex\)\)/);
    });

    it('当前章若在折叠的卷里 ⇒ 先展开所在卷再 scrollIntoView（否则高亮那条看不见）', () => {
        const body = methodBody('private renderContent(): void {');
        expect(body).toContain('this.expandTocVolumeOf(cur);');
        const expand = methodBody('private expandTocVolumeOf(item: HTMLElement): void {');
        expect(expand).toContain("item.closest<HTMLElement>('.rl-reader-toc-volbody')");
        expect(expand).toContain("body.removeClass('is-folded');");
        expect(expand).toContain("head.dataset.volOpen = '1';");
    });
});

describe('m03052 ② · 卷头折叠交互', () => {
    it('卷头是可点按钮，带 data-vol / data-vol-open / aria-expanded', () => {
        const head = methodBody('private buildTocVolumeHead(vol: TxtVolumeGroup): HTMLElement {');
        expect(head).toContain("'rl-reader-toc-volhead'");
        expect(head).toContain("head.dataset.volOpen = '1';");
        expect(head).toContain("'aria-expanded': 'true'");
        expect(head).toContain('head.dataset.vol = String(vol.from);');
    });

    it('点卷头只切换折叠态（⛔ 不切章：卷体不调 switchChapter）', () => {
        const head = methodBody('private buildTocVolumeHead(vol: TxtVolumeGroup): HTMLElement {');
        expect(head).toContain("body.toggleClass('is-folded', !next);");
        expect(head).not.toContain('switchChapter');
    });

    it('折叠态显示箭头切换 chevron-down ↔ chevron-right', () => {
        const head = methodBody('private buildTocVolumeHead(vol: TxtVolumeGroup): HTMLElement {');
        expect(head).toContain("safeSetIcon(caret, next ? 'chevron-down' : 'chevron-right');");
    });

    it('卷头不共用 .rl-reader-toc-item 类（否则高亮样式串到卷头）', () => {
        const head = methodBody('private buildTocVolumeHead(vol: TxtVolumeGroup): HTMLElement {');
        expect(head).not.toContain('rl-reader-toc-item');
    });
});

describe('m03052 ② · 样式', () => {
    it('卷体折叠是 display:none（不留空白占位）', () => {
        expect(CSS).toMatch(/\.rl-reader \.rl-reader-toc-volbody\.is-folded \{ display: none; \}/);
    });

    it('卷体有左缘竖线 + 缩进，表达「章回挂在卷下面」', () => {
        const at = CSS.indexOf('.rl-reader .rl-reader-toc-volbody {');
        expect(at).toBeGreaterThan(-1);
        const block = CSS.slice(at, CSS.indexOf('}', at));
        expect(block).toMatch(/margin-left:\s*10px;/);
        expect(block).toMatch(/border-left:\s*1px solid/);
    });

    it('卷头样式独一份，不与 toc-item 共用选择器', () => {
        expect(CSS).toContain('.rl-reader .rl-reader-toc-volhead {');
        expect(CSS).toMatch(/\.rl-reader \.rl-reader-toc-volhead:hover/);
    });

    it('卷头用 --text-muted（⛔ 不是 --text-faint：深色主题下卷号看不清）', () => {
        // 这是视觉核对时肉眼发现的：--text-faint 在深色皮肤叠 --background-primary 上，
        // 「第几卷」的对比度只有 3.5:1 左右。卷头是**分组标题**，不该按次要说明上色。
        const at = CSS.indexOf('.rl-reader .rl-reader-toc-volhead {');
        expect(at).toBeGreaterThan(-1);
        const block = CSS.slice(at, CSS.indexOf('}', at));
        expect(block).toMatch(/color:\s*var\(--text-muted\);/);
        expect(block).not.toMatch(/color:\s*var\(--text-faint\);/);
    });
});
