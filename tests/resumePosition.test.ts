/**
 * m07854 ⑧（2026-11-13）守卫：倍速 3× 档位 + 每个入口都要能记住播放位置。
 *
 * 为什么是**源码文本**守卫：
 *  - 「某个入口有没有透传 `initialPositions` / `onSavePosition`」是 **调用点有没有写那几行**，
 *    tsc 不会报（两个字段都是 optional）、svelte-check 也看不见（JS 对象字面量少个键完全合法）
 *    ⇒ 只能读源码文本断言。
 *  - 本轮真因就是这个形态：`playLocalEpisode`（编辑表单「集按钮」）漏了这两个字段，
 *    于是从编辑表单点开的视频永远从 0 开始。这条守卫就是钉住那个漏。
 *
 * ⛔ 铁律：先 strip 注释再匹配 —— 本仓 #379 / #730 / #731 三次被自己的注释打穿。
 * ⚠️ strip 必须**单次交替**，不能「先块后行」两段式：`main.ts` 里有一句行注释写着一个含
 *    斜杠星号的目录通配（形如 `下载/音乐/` 后面跟两个星号），两段式会让块注释正则从那里起手、
 *    一路吞到几 K 字符后的第一个块注释收尾符，把中间的真实代码整段吃掉
 *    （#760 踩过，见 tests/tooltipPopout.test.ts）。
 * ⚠️ 本文件自己的注释里也**不许**出现裸的块注释收尾符 —— 一写就会提前结束本段注释、
 *    把后面的 `const` 定义吞进注释里（首跑就这样红过：`ReferenceError: read is not defined`）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/** 单次交替 strip：先遇到谁就由谁消费（行注释里出现 `/*` 也不会误吞后续代码） */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

/** 取一个 `private xxx(` / `async xxx(` 方法体（花括号配对），找不到抛错便于早发现改名 */
function methodBody(src: string, name: string): string {
    const anchors = [`async ${name}(`, `private ${name}(`, `    ${name}(`];
    let start = -1;
    for (const a of anchors) {
        const at = src.indexOf(a);
        if (at >= 0) {
            start = at;
            break;
        }
    }
    if (start < 0) throw new Error(`源码里找不到方法定义 ${name}(`);
    const brace = src.indexOf('{', start);
    if (brace < 0) throw new Error(`${name} 后面没有函数体`);
    let depth = 0;
    for (let i = brace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(brace, i + 1);
        }
    }
    throw new Error(`${name} 的花括号没有闭合`);
}

const mainRaw = read('main.ts');
const main = stripComments(mainRaw);
const playerSrc = read('src/pure/player.ts');
const formSrc = read('src/views/components/EntryForm.svelte');
const modalSrc = read('src/modals/EntryModal.ts');

describe('m07854 ⑧ · 倍速 3× 档位', () => {
    it('SPEED_STEPS 含 3 且排在 2 之后', () => {
        // 档位真源只许这一份（UI 侧一律走 pure/playerMenu.buildSpeedOptions）
        const m = /export const SPEED_STEPS: readonly number\[\] = \[([^\]]+)\]/.exec(playerSrc);
        expect(m).not.toBeNull();
        const steps = (m as RegExpExecArray)[1].split(',').map((s) => Number(s.trim()));
        expect(steps).toContain(3);
        expect(steps.indexOf(3)).toBeGreaterThan(steps.indexOf(2));
    });
});

describe('m07854 ⑧ · 每个播放入口都要能记住位置', () => {
    it('编辑表单把集下标交出来（onPlayEpisode 第二参）', () => {
        // 键口径 = `VideoPlayerView.epKey()` = items[].index ⇒ 表单必须把 i 传下去，
        // 否则第 3 集的位置会被记到 0 上、与第 1 集互相覆盖
        expect(stripComments(formSrc)).toMatch(/onPlayEpisode\(p,\s*i\)/);
        expect(stripComments(formSrc)).toMatch(/onPlayEpisode:\s*\(path: string, index\?: number\)/);
    });

    it('EntryModal 把当前条目与集下标一起交给宿主', () => {
        const s = stripComments(modalSrc);
        expect(s).toMatch(/playLocalEpisode\(path,\s*index \?\? 0,\s*this\.entry/);
    });

    it('playLocalEpisode 接住集下标，并把位置表接进播放器选项', () => {
        const body = methodBody(main, 'playLocalEpisode');
        // 1) 集下标要进 item.index（播放器靠它推键）
        expect(body).toMatch(/index:\s*Math\.max\(0, Math\.floor\(index\)\)/);
        // 2) 三个位置记忆字段都要在（这是本轮真因：改前一个都没有）
        expect(body).toMatch(/entryId:\s*entry\.id/);
        expect(body).toMatch(/initialPositions:\s*entry\.videoPositions/);
        expect(body).toMatch(/onSavePosition:\s*\(k, sec\) => void this\.persistVideoPosition\(entry\.id, k, sec\)/);
    });

    it('没有真条目时不接记忆（不造假 id 去写库）', () => {
        const body = methodBody(main, 'playLocalEpisode');
        // 记忆三件套必须挂在 `entry ?` 条件展开里，⛔ 不能无条件写
        expect(body).toMatch(/\.\.\.\(entry/);
    });

    it('落库端仍在（persistVideoPosition 写 catalog.videoPositions）', () => {
        expect(main).toMatch(/private async persistVideoPosition\(entryId: string, epKey: string, seconds: number\)/);
        expect(main).toMatch(/service\.update\(entryId, \{ videoPositions: map \}\)/);
    });
});
