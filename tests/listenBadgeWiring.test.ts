// 音乐收听时长**自动累计**的接线守卫（m02288）。
//
// 🔴 用户原话：「用音乐播放器播放每首音乐要统计总时长…而不是让用户手动记录」
//    ⇒ 三段缺一不可，任何一段断了都是「功能看着在、数字永远不动」，而 tsc / svelte-check 全绿：
//      ⑴ 装配层（`views/audioPlayerMount.ts`）真的在播/停/切歌时切段并回调；
//      ⑵ 服务层（`services/EntryService.ts`）有**只加收听分钟**的方法（⛔ 不走 addTimeSession）；
//      ⑶ 宿主（`main.ts`）把回调接上，且**两条构造路径都接**（标签页 + 笔记内联块）。
//
// ⚠️ 为什么是源码文本守卫：这三处都是私有方法 / 内部闭包，行为测试要起完整 Obsidian App + DOM +
//    真实 Audio 元素（jsdom 里 `audio.duration` 恒为 NaN），测不到真秒数。
//    纯函数那半（换算、攒零头）由 `tests/listenTime.test.ts` 覆盖，两边不重复。
//
// ⛔ 铁律：先 strip 注释再匹配（注释里出现这些词也算命中，会让守卫假绿）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** TS 剥注释：块注释（不跨行版）+ 整行 `//`。⛔ 不用 `[\s\S]` 全贪 —— 正则字面量里的 `/*` 会被吞。 */
function stripTs(text: string): string {
    return text
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

const MOUNT = stripTs(read('src/views/audioPlayerMount.ts'));
const SERVICE = stripTs(read('src/services/EntryService.ts'));
const MAIN = stripTs(read('main.ts'));

describe('⑴ 装配层：真在计时，⛔ 不是「播完才 +1」', () => {
    it('🔴 选项里暴露 `onListen` 回调（缺了它宿主根本拿不到分钟数）', () => {
        expect(MOUNT).toContain('onListen?:');
    });

    it('🔴 用累计器攒零头（⛔ 直接 ms⭢min 会让每段都不满 1 分钟的长听永远为 0）', () => {
        expect(MOUNT).toContain('new ListenAccumulator()');
    });

    it('🔴 播放开始时记时间戳，且**不覆盖**已在计时的那一段', () => {
        // 反复 play/pause（拖进度条也会触发）若每次都重置起点，等于只记最后那几秒。
        // ⚠️ 必须钉**带守卫的整句**：只匹配 `listenSince === null` 的话，
        //    结算函数里那句 `if (listenSince === null) return;` 也能让它变绿（实测假绿过）。
        expect(MOUNT).toContain('if (listenSince === null) listenSince = Date.now();');
    });

    it('🔴 暂停 / 播完 / 切歌 / 销毁都结算（少一个就丢一整段）', () => {
        // 精确到具体调用点，⛔ 不数「出现几次」—— 那种计数会因为多写一行无关代码而假绿/假红。
        // 真实布局（2026-11-17）：`onPause` 里的 flushListen、`onEnded` 里 applyDecision 之前、
        // `resetListenFor`（切歌）开头、`destroy()` 里 --- 共 3 处直调 + 1 处经 resetListenFor。
        expect(MOUNT).toContain('resetListenFor(');
        const calls = (MOUNT.match(/^\s*flushListen\(\);/gm) || []).length;
        expect(calls).toBeGreaterThanOrEqual(3);
    });
});

/** 取 `EntryService.bumpListenMinutes` 的真实函数体（⛔ 不用定长切片 —— 那会越过函数边界读进下一个方法的 playSessions）。 */
function bumpBody(): string {
    const at = SERVICE.indexOf('async bumpListenMinutes(');
    if (at < 0) return '';
    const end = SERVICE.indexOf('async removeTimeSession(', at);
    return SERVICE.slice(at, end > at ? end : at + 2000);
}

describe('⑵ 服务层：只加收听分钟', () => {
    it('🔴 `bumpListenMinutes` 存在且**只**动 `listenMinutes`', () => {
        const body = bumpBody();
        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain('listenMinutes:');
        // ⛔ 反向守卫：⛔ 不许把片长当成收听时长（两个字段语义不同，见 pure/musicSync 文件头）
        expect(body).not.toContain('durationMin');
        // ⛔ 反向守卫：⛔ 不许堆 playSessions 明细（那是用户手动「记录时长」的路，播放器每分钟都写一遍很脏）
        expect(body).not.toContain('playSessions');
    });

    it('🔴 非音乐条目 / 找不到条目 ⇒ 返回 null 而不抛（回调里抛会打断播放）', () => {
        const body = bumpBody();
        expect(body).toContain("!== 'music'");
        expect(body).toContain('return null');
    });

    it('🔴 落库后回写笔记（否则重启后数字回到旧值）', () => {
        expect(bumpBody()).toContain('writeNote(');
    });
});

describe('⑶ 宿主：两条构造路径都接上', () => {
    it('🔴 标签页 / 侧边栏 / 命令面板共用的 `buildAudioPlayerOptions` 接了', () => {
        // ⚠️ 必须锚「定义」而不是首次出现 —— 2026-11-21 m03288 给音乐系列卡加了「播整个系列」，
        //    新方法 `playSeriesMusic` 里就有 `this.buildAudioPlayerOptions(...)` **调用点**，
        //    而它定义在文件更前面 ⇒ `indexOf('buildAudioPlayerOptions')` 先命中调用点，
        //    `at + 6000` 的窗口根本够不到真正的定义（这条断言就是这样假红的）。
        const at = MAIN.indexOf('private async buildAudioPlayerOptions(');
        expect(at).toBeGreaterThan(-1);
        // 窗口用「下一个方法定义」当边界，⛔ 不再用硬编码字符数（注释一长就又滑出去）
        const end = MAIN.indexOf('private async loadEntryLyrics(', at);
        const body = MAIN.slice(at, end > at ? end : at + 8000);
        expect(body).toContain('onListen:');
        expect(body).toContain('bumpListenMinutes(');
    });

    it('🔴 笔记内联块那条 `audioOptionsForNote` **也**接了（同一首歌换个入口听不该少算一半）', () => {
        // ⚠️ 必须锚「定义」而不是首次出现 —— `indexOf('audioOptionsForNote')` 先命中的是
        //    `new AudioInlineBlock(el, () => this.audioOptionsForNote(...))` 那个**调用点**。
        const at = MAIN.indexOf('private async audioOptionsForNote(');
        expect(at).toBeGreaterThan(-1);
        const end = MAIN.indexOf('private isLyricFluxEnabled(', at);
        const body = MAIN.slice(at, end > at ? end : at + 4000);
        expect(body).toContain('onListen:');
        expect(body).toContain('bumpListenMinutes(');
    });

    it('🔴 回调里判 `entryId`（曲库外/未关联的音轨没有 id，传空串会把分钟记到别人头上）', () => {
        const at = MAIN.indexOf('onListen:');
        expect(at).toBeGreaterThan(-1);
        const body = MAIN.slice(at, at + 700);
        expect(body).toContain('track.entryId');
    });

    it('🔴 累计后刷新视图（海报墙的「已听 Nh」要跟着涨）', () => {
        const at = MAIN.indexOf('onListen:');
        const body = MAIN.slice(at, at + 700);
        expect(body).toContain('refreshViews()');
    });
});

describe('⑷ 卡片角标（用户裁定的位置：与游戏/书籍同一角落）', () => {
    const MEDIA = stripTs(read('src/views/components/MediaList.svelte'));

    /**
     * 取 `<div class="rl-cov-foot-top">` 那一块（到它的闭合 `</div>` 为止）。
     * ⚠️ ⛔ 不能再用「indexOf + 定长切片」：条件表达式里也有 `cardListenBadge(e)` 字样，
     *    切片会把**条件**当成**分支**读进来 ⇒ 把 `{:else if}` 删掉也能绿（实测假绿过）。
     */
    function footTopBlock(): string {
        const at = MEDIA.indexOf('<div class="rl-cov-foot-top">');
        if (at < 0) return '';
        const end = MEDIA.indexOf('</div>', at);
        return MEDIA.slice(at, end > at ? end : at + 2000);
    }

    it('🔴 音乐角标**真的渲染了一行**（`:else if` 分支在，渲的是 `cardListenBadge(e)`）', () => {
        const block = footTopBlock();
        expect(block.length).toBeGreaterThan(0);
        expect(block).toContain('{:else if cardListenBadge(e)}');
        // 反向守卫：⛔ 不许把分支换成恒假值（那等于音乐永远没角标，而条件里仍留着它的名字）
        expect(block).not.toContain('{:else if false}');
    });

    it('🔴 三枚角标**同一行**（⛔ 没给音乐另起左上角）', () => {
        // 用户当场否掉了「搬到左上角」那个方案：原话是「和游戏/书籍保持在底部原位」。
        const block = footTopBlock();
        expect(block).toContain('cardPlaytimeBadge(e)');
        expect(block).toContain('cardReadBadge(e)');
        expect(block).toContain('cardListenBadge(e)');
    });

    it('🔴 复用 `.rl-cov-playtime` 类（⛔ 别新造 `.rl-cov-listentime`）', () => {
        expect(footTopBlock()).toContain('cardListenBadge(e)}</span>');
        expect(MEDIA).not.toContain('rl-cov-listentime');
    });

    it('🔴 外层容器条件也带上了它（只听不读不玩的卡也要建遮罩，否则角标无处可落）', () => {
        // ⚠️ 必须钉**整条条件串**：只找 `{#if !wallView && (cardPlaytimeBadge(e)` 的话，
        //    外层被改坏后 indexOf 会落到**内层**那条上，而内层仍有它的名字 ⇒ 假绿（实测过）。
        const outer = '{#if !wallView && (cardPlaytimeBadge(e) || cardReadBadge(e) || cardListenBadge(e) ||';
        expect(MEDIA).toContain(outer);
        // 反向守卫：⛔ 不许退回「外层不含它」的形态
        expect(MEDIA).not.toContain('{#if !wallView && (cardPlaytimeBadge(e) || cardReadBadge(e) || seriesNo(');
    });
});
