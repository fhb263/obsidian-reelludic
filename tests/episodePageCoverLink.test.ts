// 剧集页「简介封面左键进笔记」的接线守卫。
//
// 🔴 由来（2026-11-14 用户指令）：「播放器详情页简介封面加左键单击进笔记」。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：与 `episodePageEntryMenu.test.ts` 同一口径 ——
//    `buildInfoCard` 是 `EpisodePageView` 的私有方法，构造它要真的 Obsidian `App` + 完整 DOM + 工作区 leaf；
//    而这里要锁的恰恰是**接线形状**（谁挂监听、挂在哪层、走哪条出口、有没有节流/假监听），
//    行为测试里反而更容易假绿（能点开，也不代表走的是 `openEntryNote` 而不是另一套打开逻辑）。
//
// ⛔ 铁律：先 strip 注释再匹配，否则注释里提到 `click` / `onOpenNote` 也能让断言变绿。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = stripComments(read('src/views/EpisodePageView.ts'));
const main = stripComments(read('main.ts'));
const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** 取出 `buildInfoCard` 方法体（到下一个 `private ` 方法之前） */
function infoCardBody(src: string): string {
    const start = src.indexOf('private buildInfoCard(');
    expect(start, '找不到 buildInfoCard —— 方法被改名/删除了？').toBeGreaterThan(-1);
    const next = src.indexOf('\n    private ', start + 10);
    return src.slice(start, next === -1 ? src.length : next);
}

describe('EpisodePageView · 封面左键进笔记（用户 2026-11-14）', () => {
    it('🔴 `EpisodePageExtras` 声明了 `onOpenNote` 回调', () => {
        const i = page.indexOf('interface EpisodePageExtras');
        expect(i).toBeGreaterThan(-1);
        const block = page.slice(i, page.indexOf('}', page.indexOf('entryMenu', i)));
        expect(block).toMatch(/onOpenNote\?\s*:\s*\(id:\s*string\)\s*=>\s*void/);
    });

    it('🔴 只在注入时才挂左键（⛔ 没注入也给整块封面挂个空监听）', () => {
        const body = infoCardBody(page);
        // 必须有一段 `if (ctx.onOpenNote)` 守卫包住 click 挂载
        expect(body).toMatch(/if\s*\(\s*ctx\.onOpenNote\s*\)/);
        // 并且 click 监听必须在那个 if 之内（在 `is-clickable` 之后）
        const guardIdx = body.indexOf('if (ctx.onOpenNote)');
        const clickIdx = body.indexOf("addEventListener('click'");
        expect(clickIdx).toBeGreaterThan(guardIdx);
    });

    it('🔴 点击走 `ctx.onOpenNote` + `ctx.entry.id`（⛔ 不是另写打开逻辑）', () => {
        const body = infoCardBody(page);
        expect(body).toMatch(/addEventListener\('click',\s*\(\)\s*=>\s*ctx\.onOpenNote\?\.\(ctx\.entry\.id\)\)/);
    });

    it('🔴 键盘可达：Enter 也能开笔记，且 `preventDefault` 挡住默认行为', () => {
        const body = infoCardBody(page);
        expect(body).toMatch(/addEventListener\('keydown'/);
        expect(body).toMatch(/ev\.key !== 'Enter'/);
        expect(body).toMatch(/ev\.preventDefault\(\)/);
        // role=link + tabIndex=0 是「div 当链接用」的最低可访问性要求
        expect(body).toMatch(/setAttribute\('role',\s*'link'\)/);
        expect(body).toMatch(/tabIndex\s*=\s*0/);
    });

    it('🔴 挂在外层封面格 `cov` 上，不是 `<img>`（裁切留白区也要能点）', () => {
        const body = infoCardBody(page);
        expect(body).toMatch(/const cov = card\.createDiv\(\{\s*cls:\s*'rl-epp-info-cov'\s*\}\)/);
        // 不能在 img 上挂 click
        const imgIdx = body.indexOf('const img = cov.createEl');
        const clickIdx = body.indexOf("addEventListener('click'");
        expect(imgIdx).toBeGreaterThan(-1);
        expect(clickIdx).toBeGreaterThan(imgIdx);
        expect(body).not.toMatch(/img\.addEventListener\('click'/);
    });

    it('🔴 `is-clickable` 只在注入后加（⛔ 写进基础类 = 假功能）', () => {
        const body = infoCardBody(page);
        const guardIdx = body.indexOf('if (ctx.onOpenNote)');
        const clsIdx = body.indexOf("addClass('is-clickable')");
        expect(clsIdx).toBeGreaterThan(guardIdx);
        // CSS 里基础类 `cursor` 仍是 context-menu（右键语义），可点击态才改成 pointer
        expect(css).toMatch(/\.rl-epp-info-cov\s*\{[^}]*cursor:\s*context-menu/);
        expect(css).toMatch(/\.rl-epp-info-cov\.is-clickable\s*\{[^}]*cursor:\s*pointer/);
    });

    it('🔴 宿主把 `onOpenNote` 接到 `openEntryNote`（同一条出口，⛔ 别自己写打开笔记）', () => {
        expect(main).toMatch(/onOpenNote:\s*\(id\)\s*=>\s*void this\.openEntryNote\(id\)/);
        expect(main).toMatch(/async openEntryNote\(/);
    });

    it('🔴 右键菜单不受影响（左键进笔记、右键出菜单共存）', () => {
        const body = infoCardBody(page);
        expect(body).toMatch(/addEventListener\('contextmenu'/);
        // contextmenu 的监听必须仍在（这次改动不许把它替换掉）
        expect(body).toMatch(/this\.openEntryMenu\(ctx\.entry,\s*ev\)/);
    });
});
