// m07854 ⑭「今天看什么」随机抽卡 —— 纯逻辑行为 + 接线口径
//
// 纯逻辑（`pure/whatToWatch`）直接调函数、断言**行为**；
// 接线（搜索框里的骰子、宿主 Modal）只能读源码 —— 那是 Svelte 模板与宿主方法，
// tsc / svelte-check 都不会报「按钮挂错位置」。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildWatchPool,
    isWatchCandidate,
    pickWatchCandidate,
    shouldShowWatchDice,
    WATCH_PICK_MIN_RATING,
} from 'pure/whatToWatch';
import type { MediaEntry } from 'data/types';
import type { Rating } from 'pure/rating';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
/**
 * 🔴 本仓铁律（#379 / #730 / #731 / ⑪ ⑬ 连续踩过）：**先剥注释再匹配**。
 * Svelte 的 `<!-- -->` 也必须剥 —— 组件注释里常把「⛔ 别写 xxx」原样写出来，
 * 拿原文做反向断言会被自己的注释打穿。
 * ⚠️ 必须**单次交替**：分两步（先块后行 / 先行后块）都有反例 ——
 *    行注释里出现块注释的起始符时，块注释那一步会一路吞到后面某个块注释的收尾符，
 *    把夹在中间的真实代码整段吃掉（#760 在 main.ts 上实测吞掉 5.5K 字符）。
 */
const strip = (src: string): string => src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

function mk(over: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e1',
        type: 'movie',
        title: '某片',
        status: 'want',
        rating: 5,
        genres: [],
        cast: [],
        // 🔴 m04435 ②：候选门槛从「想看 + 评分 ≥ 4」换成「**必须已关联入口**」⇒
        //    测试默认值也得带一条观影链接，否则每一条都会因为「没入口」被剔除、断言全歪。
        links: [{ label: '在线观看', url: 'https://example.com/x' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...over,
    } as MediaEntry;
}

describe('🔴 m04435 ② 候选筛选：全状态、评分不限、**但必须已关联入口**', () => {
    it('🔴 四种状态**全部**可进池（用户原话：「全状态」）', () => {
        for (const s of ['want', 'watching', 'watched', 'archived'] as const) {
            expect(isWatchCandidate(mk({ status: s }))).toBe(true);
        }
    });

    it('🔴 评分不限：0 分 / 没评分 / 脏值都可进（旧的 `>= 4` 门槛已退场）', () => {
        expect(isWatchCandidate(mk({ rating: 0 }))).toBe(true);
        expect(isWatchCandidate(mk({ rating: undefined as unknown as Rating }))).toBe(true);
        // 脏数据按「无评分」处理即可，⛔ 不该因此被踢出随机池（那会让手改过笔记的条目永远抽不到）
        expect(isWatchCandidate(mk({ rating: 'abc' as unknown as Rating }))).toBe(true);
    });

    it('🔴 没关联入口 ⇒ 不是候选（抽出来点「就它了」会打不开）', () => {
        expect(isWatchCandidate(mk({ links: [] }))).toBe(false);
        expect(isWatchCandidate(mk({ links: [{ label: '空', url: '   ' }] as MediaEntry['links'] }))).toBe(false);
    });

    it('🔴 四类各自的最小入口都认（判据复用 `hasActionEntry`，⛔ 不另写一份）', () => {
        expect(isWatchCandidate(mk({ type: 'book', links: [], bookFile: 'a.epub' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'book', links: [], readUrl: 'https://x.com/b' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'music', links: [], audioPath: 'a.mp3' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'music', links: [], audioUrl: 'https://x.com/m.mp3' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'game', links: [], gameSwf: 'g.swf' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'game', links: [], gameLaunchPath: 'g.lnk' }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'tv', links: [], episodeUrls: ['https://x.com/e1'] }))).toBe(true);
        expect(isWatchCandidate(mk({ type: 'anime', links: [], episodeFiles: ['e1.mp4'] }))).toBe(true);
    });

    it('脏数据（空 id）剔除 —— 抽出来也打不开', () => {
        expect(isWatchCandidate(mk({ id: '' }))).toBe(false);
        expect(isWatchCandidate(null as unknown as MediaEntry)).toBe(false);
    });

    it('门槛常量仍导出但**已不参与筛选**（留着是为了让「它不在判据里」有据可查）', () => {
        expect(WATCH_PICK_MIN_RATING).toBe(4);
        // 2 分也照进 —— 常量在场不等于它在用
        expect(isWatchCandidate(mk({ rating: 2 }))).toBe(true);
    });

    it('buildWatchPool 只保留候选，保持原顺序', () => {
        const pool = buildWatchPool([
            mk({ id: 'a', status: 'want', rating: 5 }),
            mk({ id: 'b', status: 'watching', rating: 5 }),
            mk({ id: 'c', status: 'want', rating: 4.5 }),
            mk({ id: 'd', links: [] }),                        // 唯一被剔除的那条：没入口
            mk({ id: 'e', status: 'watched', rating: 1 }),     // 已看 + 1 分，照样进
        ]);
        expect(pool.map((e) => e.id)).toEqual(['a', 'b', 'c', 'e']);
    });
});

describe('#767 ⑭ 抽卡：不连续重复，池空返回 null', () => {
    it('池空 ⇒ null（⛔ 不造假条目）', () => {
        expect(pickWatchCandidate([])).toBeNull();
        expect(pickWatchCandidate([], null, () => 0.5)).toBeNull();
    });

    it('单条池 ⇒ 返回它，即使正是上一次抽到的那条（否则「换一个」永远空手，看起来像坏了）', () => {
        const only = mk({ id: 'solo' });
        expect(pickWatchCandidate([only], 'solo', () => 0.7)?.id).toBe('solo');
    });

    it('⛔ 「换一个」绝不返回同一条（这是这个词的全部意义）', () => {
        const pool = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })];
        // 把随机源钉在不同位置，都要避开刚抽过的 'a'
        for (const r of [0, 0.2, 0.5, 0.99]) {
            expect(pickWatchCandidate(pool, 'a', () => r)?.id).not.toBe('a');
        }
    });

    it('随机源注入越界（1 或负数）不返回 undefined，钳到合法下标', () => {
        const pool = [mk({ id: 'a' }), mk({ id: 'b' })];
        expect(pickWatchCandidate(pool, null, () => 1)?.id).toBe('b');
        expect(pickWatchCandidate(pool, null, () => -3)?.id).toBe('a');
        expect(pickWatchCandidate(pool, null, () => NaN)?.id).toBe('a');
    });

    it('随机源真的被用上了（不同 r 能抽到不同条目）', () => {
        const pool = [mk({ id: 'a' }), mk({ id: 'b' }), mk({ id: 'c' })];
        expect(pickWatchCandidate(pool, null, () => 0)?.id).toBe('a');
        expect(pickWatchCandidate(pool, null, () => 0.9)?.id).toBe('c');
    });
});

describe('#767 ⑭ 骰子的显隐判据', () => {
    it('没输入 ⇒ 显示', () => {
        expect(shouldShowWatchDice('')).toBe(true);
    });

    it('⛔ 只敲空格 ⇒ 仍算「没用搜索框」⇒ 显示（藏起来会被当成 bug）', () => {
        expect(shouldShowWatchDice('   ')).toBe(true);
        expect(shouldShowWatchDice('\t\n')).toBe(true);
    });

    it('有字 ⇒ 隐藏（用户原话：「输入文字搜索时隐藏」）', () => {
        expect(shouldShowWatchDice('熊')).toBe(false);
        expect(shouldShowWatchDice('  熊  ')).toBe(false);
    });
});

describe('#767 ⑭ 接线：骰子在搜索框**内部**、宿主弹 Modal', () => {
    const mediaListSrc = strip(read('src/views/components/MediaList.svelte'));
    const collectionSrc = strip(read('src/views/components/CollectionBoard.svelte'));

    it('骰子放在 `.rl-search-wrap` 内部（用户说的是"搜索框内部"，⛔ 不是工具栏第三枚按钮）', () => {
        for (const src of [mediaListSrc, collectionSrc]) {
            const wrapAt = src.indexOf('class="rl-search-wrap"');
            const diceAt = src.indexOf('class="rl-search-dice"');
            const wrapEndAt = src.indexOf('</div>', diceAt);
            expect(wrapAt).toBeGreaterThan(-1);
            expect(diceAt).toBeGreaterThan(wrapAt);
            // 骰子在 wrap 的闭合 </div> 之前 ⇒ 确实在容器内
            expect(wrapEndAt).toBeGreaterThan(diceAt);
        }
    });

    it('⛔ 别用 `searchText.length` 当判据（空格会把骰子藏掉），必须走纯函数', () => {
        for (const src of [mediaListSrc, collectionSrc]) {
            expect(src).toMatch(/shouldShowWatchDice\(searchText\)/);
            expect(src).not.toMatch(/searchText\.length\s*===\s*0/);
        }
    });

    it('🔴 2026-11-13：宿主 `openWhatToWatchModal` 收**页签作用域**的池，合并视图才回退全库', () => {
        const mainSrc = strip(read('main.ts'));
        // 签名必须收一个可选的池参数（⛔ 不能再是无参 + 一律 service.list()）
        const at = mainSrc.indexOf('openWhatToWatchModal(scoped');
        expect(at).toBeGreaterThan(-1);
        const body = mainSrc.slice(at, at + 1400);
        // 传入的那份优先，`scoped ?? all` —— 这是「按当前页签抽」的全部实现
        expect(body).toMatch(/scoped \?\? all/);
        // 兜底仍是全库（命令面板 / 合并视图都走这一支）
        expect(body).toMatch(/this\.service\.list\(\)/);
        expect(body).toMatch(/new WhatToWatchModal\(this\.app/);
        expect(body).toMatch(/posterUrl: \(e\) => this\.resolvePoster\(e\)/);
        expect(body).toMatch(/onOpenEntry: \(id\) => void this\.openEntryNote\(id\)/);
        // 🔴 m12298 ③：注入位从 `onEditEntry` 换成 `onPlayEntry`（「改属性」按钮被用户点名删除）。
        //    ⚠️ 这条断言不是「把旧断言删掉就绿」——它现在守的是**新口径**：
        //    播放钮必须走宿主统一主操作入口 `runEntryAction`，⛔ 不许在这里自己分流四种类型。
        expect(body).toMatch(/onPlayEntry: \(e\) => this\.runEntryAction\(e\)/);
        expect(body).not.toMatch(/onEditEntry/);
        expect(body).not.toMatch(/openEditModal/);
    });

    it('🔴 2026-11-13：池的作用域判据只有一处 —— 合并视图传 null，其余传当前页签筛过的条目', () => {
        const homeSrc = strip(read('src/views/components/HomeView.svelte'));
        // 唯一真源：watchDiceOpen 里判 mergedOn
        expect(homeSrc).toMatch(/watchDiceOpen = onOpenWhatToWatch[\s\S]{0,120}mergedOn \? null : listEntries/);
        // 两处骰子透传都走 watchDiceOpen，⛔ 别再直接透传 onOpenWhatToWatch
        expect(homeSrc).not.toMatch(/\{onOpenWhatToWatch\}/);
        expect(homeSrc.match(/onOpenWhatToWatch=\{watchDiceOpen\}/g)?.length).toBe(2);
        // 入口收池参数的签名（TS 侧的宿主接线）
        const viewSrc = strip(read('src/views/HomeView.ts'));
        expect(viewSrc).toMatch(/onOpenWhatToWatch: \(entries: readonly MediaEntry\[\] \| null\) =>/);
        expect(viewSrc).toMatch(/this\.plugin\.openWhatToWatchModal\(entries\)/);
    });

    it('🔴 2026-11-13：子组件只上报「点了」，⛔ 不自己筛候选也不收条目池', () => {
        for (const src of [mediaListSrc, collectionSrc]) {
            expect(src).toMatch(/export let onOpenWhatToWatch: \(\(\) => void\) \| null = null;/);
            expect(src).toMatch(/onOpenWhatToWatch\?\.\(\)/);
        }
    });

    it('Modal 走宿主基类而非自绘 fixed 遮罩（本仓 `fixed` 会被 transform 祖先偏移）', () => {
        const modalSrc = strip(read('src/modals/WhatToWatchModal.ts'));
        expect(modalSrc).toMatch(/export class WhatToWatchModal extends Modal/);
        expect(modalSrc).not.toMatch(/position:\s*fixed/);
        // 「换一个 / 就它了」两颗按钮都在，「就它了」是主按钮（mod-cta）
        expect(modalSrc).toMatch(/text: '换一个'/);
        expect(modalSrc).toMatch(/mod-cta rl-wtw-take/);
        // 换一个要把当前 id 传去排除 ⇒ 不连续重复
        expect(modalSrc).toMatch(/pickWatchCandidate\(this\.pool, this\.current\?\.id \?\? null/);
    });

    it('🔴 m12298 ③：删「改属性」按钮，⛔ 别只删模板留死样式/死接口', () => {
        const modalSrc = strip(read('src/modals/WhatToWatchModal.ts'));
        const cssSrc = strip(read('styles.css'));
        // 弹窗里不再有这颗按钮，也不再收 `onEditEntry` 注入位
        expect(modalSrc).not.toMatch(/rl-wtw-edit/);
        expect(modalSrc).not.toMatch(/onEditEntry/);
        expect(modalSrc).not.toMatch(/改属性/);
        // 样式表里那条 `order: 3; margin-left: auto` 必须一起退场
        // （留着会报 Unused CSS selector，顶破 89 warnings 基线）
        expect(cssSrc).not.toMatch(/\.rl-wtw-edit/);
    });

    it('🔴 m12298 ③：「换一个 / 就它了」整组贴右下角（换一个在左、就它了在右）', () => {
        const cssSrc = strip(read('styles.css'));
        // 整组右对齐
        expect(cssSrc).toMatch(/\.rl-wtw-ops \{[^}]*justify-content: flex-end;/);
        // 顺序不变：换一个 order 1 < 就它了 order 2
        expect(cssSrc).toMatch(/\.rl-wtw-modal \.rl-wtw-again \{ order: 1; \}/);
        expect(cssSrc).toMatch(/\.rl-wtw-modal \.rl-wtw-take\.mod-cta \{[^}]*order: 2;/);
        // ⛔ 别再用「改属性」原来的 `margin-left: auto` 顶右下 —— 那颗按钮已经没了
        expect(cssSrc).not.toMatch(/\.rl-wtw-edit/);
    });

    it('🔴 m12298 ③：卡面补「简介」与「个人状态与评价」两块（有值才渲染）', () => {
        const modalSrc = strip(read('src/modals/WhatToWatchModal.ts'));
        // 简介取 `summary`（⛔ 不是 aiSummary：用户要条目自己的简介）
        expect(modalSrc).toMatch(/e\.summary/);
        expect(modalSrc).not.toMatch(/aiSummary/);
        expect(modalSrc).toMatch(/text: '简介'/);
        // 个人状态与评价：状态 / 评分 / 心情 / 评语 四件都接上了
        expect(modalSrc).toMatch(/text: '个人状态与评价'/);
        expect(modalSrc).toMatch(/statusLabel\(e\.type, e\.status\)/);
        expect(modalSrc).toMatch(/starString\(rating\)/);
        expect(modalSrc).toMatch(/moodText\(e\.mood\)/);
        expect(modalSrc).toMatch(/e\.notes/);
        // 🔴 有值才渲染：三处都必须 `if (...)` 包着，⛔ 不能无条件 createDiv 留空标签
        expect(modalSrc).toMatch(/if \(summary\)/);
        expect(modalSrc).toMatch(/if \(moodTextValue\)/);
        expect(modalSrc).toMatch(/if \(notes\)/);
    });

    it('🔴 m12298 ③：封面右下角 = 有入口给播放钮 / 没入口给「未关联」角标（互斥，判据走 actionLabel）', () => {
        const modalSrc = strip(read('src/modals/WhatToWatchModal.ts'));
        const cssSrc = strip(read('styles.css'));
        // 判据必须是 `hasActionEntry`（唯一真源），⛔ 不许自己写 episodeFiles?.length 那一串
        expect(modalSrc).toMatch(/const ready = hasActionEntry\(e\);/);
        expect(modalSrc).not.toMatch(/episodeFiles\?\.length/);
        expect(modalSrc).not.toMatch(/bookFile\?\.trim/);
        // 两种形态都在，且是 if / else 互斥
        expect(modalSrc).toMatch(/rl-wtw-cover-play/);
        expect(modalSrc).toMatch(/rl-wtw-cover-none/);
        expect(modalSrc).toMatch(/text: '未关联'/);
        // 图标走 `actionIcon` + `safeSetIcon`（⛔ 不自己包 setIcon，也不硬编码 'play'）
        expect(modalSrc).toMatch(/safeSetIcon\(play, actionIcon\(e\.type\)\)/);
        // 点播放不能冒泡触发「打开笔记」
        expect(modalSrc).toMatch(/ev\.stopPropagation\(\)/);
        // 提示文案走 actionLabel 那套（⛔ 别自己拼「（本地文件）/（网络地址）」）
        expect(modalSrc).toMatch(/actionReadyHint\(e\.type, hasLocalEntry\(e\)\)/);
        expect(modalSrc).toMatch(/actionUnavailableHint\(e\.type\)/);
        // 几何：两种形态都定位在封面右下角
        expect(cssSrc).toMatch(/\.rl-wtw-cover-play,\s*\.rl-wtw-cover-none \{[^}]*position: absolute; right: 6px; bottom: 6px;/);
    });

    it('两处视图的搜索框都同步留了右侧内距 + 骰子样式（否则骰子压住占位文字 / 按钮没被透明化）', () => {
        for (const src of [mediaListSrc, collectionSrc]) {
            expect(src).toContain('padding: 5px 30px 5px 27px;');
            // 骰子样式写在各自组件的 scoped <style> 里（两视图各一份，⑥ parity 要求逐字一致）
            expect(src).toContain('.rl-toolbar .rl-search-dice {');
            expect(src).toMatch(/background: transparent/);
            expect(src).toMatch(/border: 0/);
        }
    });
});
