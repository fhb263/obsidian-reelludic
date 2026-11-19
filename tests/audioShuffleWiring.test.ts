// 音频播放器 · 乱序播放装配测试（m11034）。
//
// 为什么需要：`pure/audioQueue` 的单测只能证明「袋子的算法对」，
// 证明不了「视图层真的把袋子存住了、真的在队列变化时清掉了过期项」。
// 用户 m11034 报的是观感问题（10 首内就重复），必须同时钉住这两层。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const view = readFileSync(
    'C:/Users/kest/Desktop/obsidian-reelludic/src/views/audioPlayerMount.ts',
    'utf8',
).replace(/\r\n/g, '\n');

const pure = readFileSync('C:/Users/kest/Desktop/obsidian-reelludic/src/pure/audioQueue.ts', 'utf8').replace(
    /\r\n/g,
    '\n',
);

/** 剥注释（判「代码里没有」时不能让注释里的反面教材冒充） */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('🔴 m11034 随机播放：袋子必须被存住、不许每次重洗', () => {
    it('视图层有 `let bag: string[] = []` 且 `applyDecision` 里 `bag = decision.bag;` 回存', () => {
        expect(view).toContain('let bag: string[] = [];');
        expect(view).toContain('bag = decision.bag;');
        // 反向守卫：不许出现「调用里现造一个袋子」（那就是每首重洗）
        expect(view).not.toMatch(/bag: buildShuffleBag\(/);
    });

    it('`decideTrack` 调用把 bag 传进去（⛔ 不传 = 每次重新洗 = 隔两首又重复）', () => {
        const call = /const decision = decideTrack\(\{[\s\S]*?\}\);/.exec(view);
        expect(call).not.toBeNull();
        expect(call![0]).toContain('bag,');
    });
});

describe('🔴🔴 m11034 一轮之内绝不重复（真源语义）', () => {
    it('`buildShuffleBag` 把当前曲**整个剔除**，不是打乱后挪袋尾', () => {
        const code = stripComments(pure);
        // 核心实现必须含过滤
        expect(code).toContain('paths.filter((p) => p !== exclude)');
        // 反向守卫：旧的「洗完全队列再把袋首挪到袋尾」必须消失
        expect(code).not.toContain('out.splice(0, 1)');
        expect(code).not.toContain('out.push(first)');
    });

    it('袋子取空时不得回 null（单曲队列 ⇒ 等效单曲循环）', () => {
        const code = stripComments(pure);
        expect(code).toContain('if (!bag.length) return { target: current || paths[0], replay: true, bag };');
    });
});

describe('🔴 m11034 队列变化时清理过期的袋子项', () => {
    it('`updateQueue` 按当前队列过滤袋子（⛔ 不过滤 ⇒ 点到已删的歌时 `findIndex` 返 -1 静默 no-op）', () => {
        const fn = /const updateQueue = \(next: readonly AudioPlayerTrack\[\]\): void => \{[\s\S]*?\n    \};/.exec(
            view,
        );
        expect(fn).not.toBeNull();
        const body = fn![0];
        expect(body).toContain('const alive = new Set(items.map((t) => t.path));');
        expect(body).toContain('bag = bag.filter((p) => alive.has(p));');
        // 必须在 `if (!items.length || !cur) return;` **之前**清理 —— 当前曲被删时也要清
        expect(body.indexOf('bag = bag.filter')).toBeLessThan(body.indexOf('if (!items.length || !cur) return;'));
    });
});
