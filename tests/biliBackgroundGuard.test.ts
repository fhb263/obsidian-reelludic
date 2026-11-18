/**
 * m03052 ⑤：B站音乐下载「后台继续」的组件侧 + 宿主侧源码守卫。
 *
 * 用户原话（逐字）：「给音乐从B站下载并转录的加个后台下载退出弹窗也能继续下载，
 *                  样式复用下载模型的那个悬浮球和进度框」
 *
 * 与 `tests/biliDownloadService.test.ts` 分工：那个文件测**服务层行为**，
 * 这个文件钉**接线**（组件必须只订阅、弹窗销毁不许取消任务、插件卸载要摘球）。
 * ⚠️ 全部是源码文本断言 —— 本仓没有 Svelte 编译器依赖，拿不到渲染后的 DOM。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const COMPONENT = readFileSync(join(ROOT, 'src/views/components/MusicDownload.svelte'), 'utf8');
const SERVICE = readFileSync(join(ROOT, 'src/services/biliDownloadService.ts'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'main.ts'), 'utf8');

/**
 * 剥注释再断言 —— `entryFormFields.test.ts` 踩过的坑：解释性注释里逐字写着被禁的选择器，
 * 不剥注释会让反向守卫自己把自己判红。
 *
 * ⚠️ 本仓库踩过两次的坑：`/\/\*[\s\S]*?\*\//` 这种「跨全文件」的正则会被
 * `<input accept="image/*">` 那段吞掉十几万字符（`image/` + `*` 被当成块注释起点）。
 * ⇒ 这里用三档不跨行的写法。
 */
function stripComments(text: string): string {
    return text
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 按大括号深度配对取方法体（拿不到就抛 —— ⛔ 不许让断言静默变空） */
function methodBody(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`找不到方法体锚点：${signature}`);
    const braceAt = src.indexOf('{', at + signature.length);
    if (braceAt < 0) throw new Error(`锚点后没有大括号：${signature}`);
    let depth = 0;
    for (let i = braceAt; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(braceAt, i + 1);
        }
    }
    throw new Error(`大括号没有配对：${signature}`);
}

describe('m03052 ⑤ · 组件只订阅、不拥有下载', () => {
    it('pickBili 里⛔ 不许 `await biliDownload(...)`（所有权已上移服务层）', () => {
        // 签名本身也不许 async：哪怕现在没 await，`async` 就是在邀请下一个人写进去
        // （实测：只查「里面没有 await」时，把签名改回 `async` 突变跑不红）
        expect(COMPONENT).toContain('function pickBili(v: BiliVideo): void {');
        const body = stripComments(methodBody(COMPONENT, 'function pickBili('));
        // 反向守卫：改造前的形态就是在这里 await
        expect(body).not.toMatch(/await\s+biliDownload\s*\(/);
        // 正向：必须转发到服务层
        expect(body).toContain('startBiliDownload(');
        // 结局不许在组件里 `.then` 回显（关窗后拿到的是已销毁组件的变量）
        expect(body).not.toContain('.then(');
    });

    it('onMount 里挂了进度与结局两条订阅', () => {
        const body = stripComments(methodBody(COMPONENT, 'onMount('));
        expect(body).toContain('onBiliProgress(');
        expect(body).toContain('onBiliOutcome(');
        // 两句都要落到可摘的句柄上
        expect(body).toContain('offBiliProgress = onBiliProgress(');
        expect(body).toContain('offBiliOutcome = onBiliOutcome(');
    });

    it('重开弹窗要恢复「正在下载」（⛔ 别让用户以为第一次白点了）', () => {
        const body = stripComments(methodBody(COMPONENT, 'onMount('));
        expect(body).toContain('runningBiliDownloads()');
        expect(body).toMatch(/downloadingId\s*=\s*`bili:\$\{/);
    });

    it('onDestroy 只摘订阅，⛔ 不许取消任务', () => {
        const body = stripComments(methodBody(COMPONENT, 'onDestroy('));
        expect(body).toContain('offBiliProgress?.()');
        expect(body).toContain('offBiliOutcome?.()');
        // 反向守卫：不许出现任何取消/中止语义
        expect(body).not.toMatch(/abort|cancel|stop/i);
    });

    it('结局回显带去重（`onPicked` 会写库，重复调 = 重复关联）', () => {
        const body = stripComments(methodBody(COMPONENT, 'onMount('));
        expect(body).toContain('seenOutcomes.has(key)');
        expect(body).toContain('seenOutcomes.add(key)');
        expect(body).toContain('onPicked(outcome.relPath)');
    });
});

describe('m03052 ⑤ · 服务层承诺', () => {
    it('同一 bvid 幂等（`running.get` 先查，⛔ 不重复起任务）', () => {
        const body = methodBody(SERVICE, 'export function startBiliDownload(');
        const existingAt = body.indexOf('const existing = running.get(bvid);');
        const ballAt = body.indexOf('startProgressBall(');
        expect(existingAt).toBeGreaterThan(0);
        expect(body).toContain('if (existing) return existing.promise;');
        // 先查重、后起球：否则重复点会闪两次球
        expect(existingAt).toBeLessThan(ballAt);
    });

    it('进度球在**任务开始**就起（不是等第一次进度回调）', () => {
        const body = methodBody(SERVICE, 'export function startBiliDownload(');
        const ballAt = body.indexOf('startProgressBall(');
        const runnerAt = body.indexOf('runner(video, onProgress');
        expect(ballAt).toBeGreaterThan(0);
        expect(runnerAt).toBeGreaterThan(0);
        expect(ballAt).toBeLessThan(runnerAt);
    });

    it('结局必须留住（重开弹窗回显）且带过期清理', () => {
        // 🔴 反向守卫前必须剥注释：源码里那段「为什么不用 window.setTimeout」的注释
        //    逐字写着该字符串，不剥会让这条断言自己把自己判红（本轮实测踩到第二次）。
        const body = stripComments(methodBody(SERVICE, 'export function startBiliDownload('));
        // ⚠️ 变量名是 `lastOutcomeRef` 不是 `last`：模块级 `let last` 会与 `main.ts` 里
        //    `libraryDisplayName` 的局部 `last` 重名，esbuild 把它改名成 `last2`，
        //    撞红 `assert-symbols` 的产物判据（实测踩到）。
        expect(body).toContain('lastOutcomeRef = outcome;');
        expect(body).toContain('OUTCOME_KEEP_MS');
        // 🔴 不只是「常量在」，必须**真的拿时间戳比较**再清 —— 实测：只查 `OUTCOME_KEEP_MS`
        //    时，把判断改成 `if (false)` 的突变跑不红（结局永不过期，旧失败永远挂着）。
        expect(body).toContain('if (lastOutcomeRef && lastOutcomeRef.at === at) lastOutcomeRef = null;');
        // `return lastOutcomeRef;` 在 `lastBiliOutcome()` 里，不在 `startBiliDownload` 体内
        expect(stripComments(SERVICE)).toContain('return lastOutcomeRef;');
        // ⚠️ 这里曾经写 `window.setTimeout` ⇒ node 环境单测 `ReferenceError: window is not defined`
        expect(body).not.toContain('window.setTimeout');
    });

    it('订阅回调抛错不能带崩下载（两处都 try/catch）', () => {
        const body = methodBody(SERVICE, 'export function startBiliDownload(');
        // progressListeners / outcomeListeners 各一个 try
        const tries = (body.match(/try\s*\{/g) ?? []).length;
        expect(tries).toBeGreaterThanOrEqual(2);
    });
});

describe('m03052 ⑤ · 宿主接线', () => {
    it('插件卸载时摘球 + 清订阅（球挂 body，不会被自动回收）', () => {
        expect(MAIN).toContain("import { disposeBiliDownloads } from 'services/biliDownloadService';");
        expect(MAIN).toContain('this.register(disposeBiliDownloads);');
        // 与既有进度球钩子挨着，不要散落在别处
        const ballAt = MAIN.indexOf('this.register(destroyProgressBall);');
        const biliAt = MAIN.indexOf('this.register(disposeBiliDownloads);');
        expect(ballAt).toBeGreaterThan(0);
        expect(biliAt).toBeGreaterThan(ballAt);
    });

    it('`dispose` 只摘球与订阅，⛔ 不 abort 在跑的任务', () => {
        const body = methodBody(SERVICE, 'export function disposeBiliDownloads(');
        expect(body).toContain('ball?.dismiss()');
        expect(body).toContain('progressListeners.clear()');
        expect(body).toContain('outcomeListeners.clear()');
        expect(body).not.toMatch(/abort|cancel/i);
    });
});
