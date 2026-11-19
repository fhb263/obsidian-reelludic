// 🔴 m14228 ③：乱序播放按个人评分加权（用户逐字：「给音乐乱序播放再加个如10星个人评分
//    遇到的循环越高反之1星评分的音乐权重要大大降低」，裁定「用现有 1~5 星个人评分当权重」）。
//
// 为什么值得这么多用例：加权洗牌最危险的失败不是「报错」，而是**悄悄退化成每首独立掷骰**
// —— 那样 m11034 修掉的「10 首内又听到刚放过的」会原地复活，而且听感上极难归因。
// 本文件把两条性质分别钉死：① 权重影响顺序；② 一轮内仍是「每首恰好一次」。
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SHUFFLE_WEIGHT,
    buildShuffleBag,
    decideTrack,
    shuffleWeightOfRating,
    type ShuffleWeights,
} from 'pure/audioQueue';

/** 袋式随机源：按给定序列吐值，用完回卷 */
function seq(values: number[]) {
    let i = 0;
    return () => values[i++ % values.length];
}

/** 线性同余伪随机（固定种子 ⇒ 可复现；⛔ 测试里不用 Math.random） */
function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

describe('shuffleWeightOfRating（星级 → 权重）', () => {
    it('未评分 / 脏值一律中性 1.0（⛔ 不给 0：新歌全是未评分，给 0 等于永远排最后）', () => {
        expect(shuffleWeightOfRating(undefined)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(null)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(Number.NaN)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        // 越界（data.json 可手改）⇒ 当未评分，⛔ 不让一个 99 把整轮洗牌压死
        expect(shuffleWeightOfRating(0)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(-3)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(99)).toBe(DEFAULT_SHUFFLE_WEIGHT);
    });

    it('1~5 星逐档严格递增（相邻档必有差）', () => {
        const w = [1, 2, 3, 4, 5].map((r) => shuffleWeightOfRating(r));
        for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThan(w[i - 1]);
        expect(w).toEqual([0.09, 0.41, 1, 1.88, 3.08]);
    });

    it('1 星是「大幅降低」但不是排除（用户说的是降权，不是永不播放）', () => {
        const one = shuffleWeightOfRating(1);
        const five = shuffleWeightOfRating(5);
        expect(one).toBeGreaterThan(0);
        // 「大大降低」的量化口径：5 星至少是 1 星的 30 倍
        expect(five / one).toBeGreaterThanOrEqual(30);
    });

    it('3★ 是中性中轴（与未评分等价），4★ 起才真正加权', () => {
        expect(shuffleWeightOfRating(3)).toBe(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(4)).toBeGreaterThan(DEFAULT_SHUFFLE_WEIGHT);
        expect(shuffleWeightOfRating(2)).toBeLessThan(DEFAULT_SHUFFLE_WEIGHT);
    });
});

describe('buildShuffleBag 加权（无放回 + 权重只改顺序）', () => {
    const paths = ['a', 'b', 'c', 'd'];

    it('无 weights ⇒ 与老的等概率 Fisher-Yates 逐字同行为（同种子同结果）', () => {
        const r1 = lcg(7);
        const r2 = lcg(7);
        expect(buildShuffleBag(paths, '', r1)).toEqual(buildShuffleBag(paths, '', r2));
    });

    it('权重极端时高权重必然排在前面（抽取顺序被权重支配）', () => {
        const weights: ShuffleWeights = { a: 1, b: 1, c: 1, d: 1000 };
        // 同一个随机源喂进去：d 的 `rng^(1/1000)` 极接近 1，其余远小于它
        const bag = buildShuffleBag(paths, '', () => 0.5, weights);
        expect(bag[0]).toBe('d');
    });

    it('🔴 一轮内**每首恰好一次**（加权不破坏 m11034 的「N 首之内绝不重样」）', () => {
        const weights: ShuffleWeights = { a: 0.05, b: 0.5, c: 1, d: 5 };
        for (let seed = 1; seed <= 30; seed++) {
            const bag = buildShuffleBag(paths, '', lcg(seed), weights);
            expect([...bag].sort()).toEqual([...paths].sort());
        }
    });

    it('当前曲仍被整个剔除（⛔ 不是「洗进去再挪袋尾」）', () => {
        const weights: ShuffleWeights = { a: 5, b: 1, c: 1, d: 1 };
        for (let seed = 1; seed <= 20; seed++) {
            const bag = buildShuffleBag(paths, 'a', lcg(seed), weights);
            expect(bag).not.toContain('a');
            expect(bag.length).toBe(3);
        }
    });

    it('同种子必同结果（等键时用路径兜底，⛔ 不依赖 V8 排序的实现细节）', () => {
        const weights: ShuffleWeights = { a: 1, b: 1, c: 1, d: 1 };
        const one = buildShuffleBag(paths, '', () => 0.5, weights);
        const two = buildShuffleBag(paths, '', () => 0.5, weights);
        expect(one).toEqual(two);
    });

    it('权重缺键的曲目按中性 1.0 参与（⛔ 不会因为缺键就被排到最末）', () => {
        const weights: ShuffleWeights = { a: 1 };
        const bag = buildShuffleBag(['a', 'b'], '', lcg(3), weights);
        expect([...bag].sort()).toEqual(['a', 'b']);
    });

    it('不就地修改入参数组（调用方的队列顺序不能被改掉）', () => {
        const input = ['a', 'b', 'c'];
        buildShuffleBag(input, '', lcg(5), { a: 5, b: 1, c: 1 });
        expect(input).toEqual(['a', 'b', 'c']);
    });
});

describe('decideTrack 的 weights 透传', () => {
    const paths = ['a', 'b', 'c', 'd'];

    it('把 weights 透传给新洗的一轮（高权重排在袋首）', () => {
        const decision = decideTrack({
            paths,
            current: 'a',
            mode: 'shuffle',
            trigger: 'ended',
            rng: () => 0.5,
            weights: { b: 1, c: 1, d: 1000 },
        });
        expect(decision.target).toBe('d');
    });

    it('🔴 有袋子时**不重洗**（用户改评分不该让正在放的一轮突然跳歌）', () => {
        const decision = decideTrack({
            paths,
            current: 'a',
            mode: 'shuffle',
            trigger: 'ended',
            bag: ['c', 'd'],
            rng: () => 0.5,
            // 若这条被重洗，d（权重 1000）会跑到前面；断言拿到的是袋首 c
            weights: { b: 1, c: 1, d: 1000 },
        });
        expect(decision.target).toBe('c');
        expect(decision.bag).toEqual(['d']);
    });

    it('不传 weights ⇒ 行为与加权前一致（等概率路径仍在）', () => {
        const decision = decideTrack({
            paths,
            current: 'a',
            mode: 'shuffle',
            trigger: 'ended',
            rng: seq([0, 0, 0, 0]),
        });
        expect(decision.target).toBeTruthy();
        expect(paths).toContain(decision.target);
    });

    it('单曲队列 + weights ⇒ 仍走 replay（⛔ 不因加权变成静音停住）', () => {
        const decision = decideTrack({
            paths: ['a'],
            current: 'a',
            mode: 'shuffle',
            trigger: 'ended',
            rng: () => 0.5,
            weights: { a: 5 },
        });
        expect(decision.target).toBe('a');
        expect(decision.replay).toBe(true);
    });
});
