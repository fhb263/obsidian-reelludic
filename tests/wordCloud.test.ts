/**
 * `pure/wordCloud` 单测 —— ②-3 统计页标签词云（用户 m00353 裁定：词源 = 条目标签 tags）。
 *
 * 钉住四条口径（改实现前先读 `src/pure/wordCloud.ts` 模块头）：
 *   ① 同一目的重复标签只算一次；② 不合并大小写、不改写原文；
 *   ③ 全同频给中档（不是最低档）；④ 排序 = 频次降序 → 首见顺序，且稳定。
 */
import { describe, expect, it } from 'vitest';
import {
    CLOUD_HUE_COUNT,
    WORD_CLOUD_LEVELS,
    WORD_CLOUD_MAX,
    buildWordCloud,
    cloudHueIndexOf,
    cloudLevels,
    normalizeTag,
} from 'pure/wordCloud';
import type { MediaEntry } from 'data/types';

/** 造最小条目：只填词云会读的字段，其余留空（词云⛔ 不许依赖别的字段） */
function entry(tags: string[]): MediaEntry {
    return { tags } as MediaEntry;
}

describe('wordCloud · normalizeTag', () => {
    it('trim + 折叠内部空白', () => {
        expect(normalizeTag('  科幻  ')).toBe('科幻');
        expect(normalizeTag('硬   科幻')).toBe('硬 科幻');
        expect(normalizeTag('\t太空\n歌剧 ')).toBe('太空 歌剧');
    });

    it('空串 / 纯空白 ⇒ 空串（调用方据此跳过）', () => {
        expect(normalizeTag('')).toBe('');
        expect(normalizeTag('   ')).toBe('');
        expect(normalizeTag(undefined as unknown as string)).toBe('');
    });

    it('🔴 不改写大小写（合并大小写会让用户以为插件改了他的标签）', () => {
        expect(normalizeTag('RPG')).toBe('RPG');
        expect(normalizeTag('rpg')).toBe('rpg');
        expect(normalizeTag('RPG')).not.toBe(normalizeTag('rpg'));
    });
});

describe('wordCloud · buildWordCloud', () => {
    it('同一条目内重复标签只算一次', () => {
        const out = buildWordCloud([entry(['科幻', '科幻', ' 科幻 '])]);
        expect(out).toEqual([{ text: '科幻', weight: 1, level: 3 }]);
    });

    it('跨条目累加频次', () => {
        const out = buildWordCloud([entry(['科幻']), entry(['科幻', '太空'])]);
        const byText = new Map(out.map((w) => [w.text, w.weight]));
        expect(byText.get('科幻')).toBe(2);
        expect(byText.get('太空')).toBe(1);
    });

    it('空标签被丢弃，不留空词', () => {
        const out = buildWordCloud([entry(['', '  ', '科幻'])]);
        expect(out.map((w) => w.text)).toEqual(['科幻']);
    });

    it('没有标签 ⇒ 空数组（认空态，⛔ 不造占位词）', () => {
        expect(buildWordCloud([])).toEqual([]);
        expect(buildWordCloud([entry([]), entry([])])).toEqual([]);
    });

    it('tags 缺失 / 非数组按空处理（老数据零迁移）', () => {
        const broken = [{}, { tags: null }, { tags: 'not-an-array' }] as unknown as MediaEntry[];
        expect(buildWordCloud(broken)).toEqual([]);
    });

    it('🔴 排序 = 频次降序 → 首见顺序（同频次不按字典序）', () => {
        // 'zeta' 先出现、'alpha' 后出现，频次相同 ⇒ zeta 在前
        const out = buildWordCloud([entry(['zeta']), entry(['alpha'])]);
        expect(out.map((w) => w.text)).toEqual(['zeta', 'alpha']);
    });

    it('超过上限时按排序口径截断，只保留前 max 个', () => {
        const tags = Array.from({ length: WORD_CLOUD_MAX + 10 }, (_, i) => `t${i}`);
        const out = buildWordCloud([entry(tags)]);
        expect(out).toHaveLength(WORD_CLOUD_MAX);
        // 全同频 ⇒ 首见顺序 ⇒ 前 WORD_CLOUD_MAX 个
        expect(out[0].text).toBe('t0');
        expect(out[WORD_CLOUD_MAX - 1].text).toBe(`t${WORD_CLOUD_MAX - 1}`);
    });

    it('max 可覆盖，且非法值回落到默认上限', () => {
        expect(buildWordCloud([entry(['a', 'b', 'c'])], 2)).toHaveLength(2);
        expect(buildWordCloud([entry(['a', 'b', 'c'])], 0)).toHaveLength(3);
        expect(buildWordCloud([entry(['a', 'b', 'c'])], NaN)).toHaveLength(3);
    });

    it('最高频拿最高档、最低频拿最低档（词云必须有视觉对比）', () => {
        const out = buildWordCloud([entry(['热']), entry(['热']), entry(['热']), entry(['冷'])]);
        const byText = new Map(out.map((w) => [w.text, w.level]));
        expect(byText.get('热')).toBe(WORD_CLOUD_LEVELS);
        expect(byText.get('冷')).toBe(1);
    });

    it('🔴 全部同频 ⇒ 中档（不是最低档，否则像坏了）', () => {
        const out = buildWordCloud([entry(['a', 'b', 'c'])]);
        expect(out.map((w) => w.level)).toEqual([3, 3, 3]);
    });

    /**
     * 🔴 2026-11-16 用户逐字：「如果按标签归属自定义视图（如日常、工作），
     *    那标签词云统计的如工作、日常标签怎么办这些不是正常的标签」⇒ 裁定**从词云中排除**。
     * 排除集合来自 `pure/mediaViews.customViewTagPool`（所有 `kind === 'custom'` 视图的标签并集）。
     */
    describe('exclude：排除视图归属标签', () => {
        it('被排除的标签整条不出现（不进结果、不占名额）', () => {
            const out = buildWordCloud([entry(['工作', '科幻']), entry(['工作'])], WORD_CLOUD_MAX, ['工作']);
            expect(out.map((w) => w.text)).toEqual(['科幻']);
        });

        it('缺省第三参 = 不排除任何词（老调用方行为零变化）', () => {
            const out = buildWordCloud([entry(['工作', '科幻'])]);
            expect(out.map((w) => w.text).sort()).toEqual(['工作', '科幻'].sort());
            expect(buildWordCloud([entry(['a'])], WORD_CLOUD_MAX, [])).toHaveLength(1);
        });

        it('🔴 排除发生在截断之前 —— 不能先占满 max 再删掉', () => {
            // 6 个标签、上限 3：「工作」被排除后必须仍能填满 3 个真实标签
            const tags = ['工作', 'a', 'b', 'c', 'd', 'e'];
            const out = buildWordCloud([entry(tags)], 3, ['工作']);
            expect(out).toHaveLength(3);
            expect(out.map((w) => w.text)).toEqual(['a', 'b', 'c']);
        });

        it('🔴 排除后重新分档 —— 被排除的极值不许把别人的字号垫高', () => {
            // ⚠️ 频次必须跨条目拉开：同一条目内重复标签只算一次（见上面那条用例）
            // 「工作」出现 5 条是极值；排除后 a(3) / b(1) 应拉开两端
            const entries = [
                ...Array.from({ length: 5 }, () => entry(['工作'])),
                ...Array.from({ length: 3 }, () => entry(['a'])),
                entry(['b']),
            ];
            const withBan = buildWordCloud(entries, WORD_CLOUD_MAX, ['工作']);
            const byText = new Map(withBan.map((w) => [w.text, w.level]));
            expect(byText.has('工作')).toBe(false);
            expect(byText.get('a')).toBe(WORD_CLOUD_LEVELS);
            expect(byText.get('b')).toBe(1);
            // 对照：不排除时「工作」会吃掉最高档，a 只能到次档 —— 这正是必须重算的理由
            const noBan = new Map(buildWordCloud(entries).map((w) => [w.text, w.level]));
            expect(noBan.get('工作')).toBe(WORD_CLOUD_LEVELS);
        });

        it('🔴 大小写不敏感命中（与 `entryMatchesTags` 的小写比较口径一致）', () => {
            // 视图标签写 `Work`，条目里打的是 `work` —— 视图能筛出条目，词云就必须能排掉它
            expect(buildWordCloud([entry(['work'])], WORD_CLOUD_MAX, ['Work'])).toEqual([]);
            expect(buildWordCloud([entry(['Work'])], WORD_CLOUD_MAX, ['work'])).toEqual([]);
        });

        it('空白按 `normalizeTag` 口径归一后比较', () => {
            expect(buildWordCloud([entry(['  工作  '])], WORD_CLOUD_MAX, ['工作'])).toEqual([]);
            expect(buildWordCloud([entry(['工作'])], WORD_CLOUD_MAX, ['  工作 '])).toEqual([]);
        });

        it('排除表里的空串 / 非数组 ⇒ 忽略，不误伤', () => {
            expect(buildWordCloud([entry(['a'])], WORD_CLOUD_MAX, ['', '   '])).toHaveLength(1);
            const broken = buildWordCloud([entry(['a'])], WORD_CLOUD_MAX, null as unknown as string[]);
            expect(broken).toHaveLength(1);
        });

        it('全部标签都被排除 ⇒ 空数组（认空态，⛔ 不造占位词）', () => {
            expect(buildWordCloud([entry(['工作', '日常'])], WORD_CLOUD_MAX, ['工作', '日常'])).toEqual([]);
        });
    });
});

describe('wordCloud · cloudLevels', () => {
    it('空输入 ⇒ 空输出', () => {
        expect(cloudLevels([])).toEqual([]);
    });

    it('全同频 ⇒ 全中档（ceil(5/2)=3）', () => {
        expect(cloudLevels([2, 2, 2])).toEqual([3, 3, 3]);
    });

    it('两端拉满：min→1、max→5', () => {
        expect(cloudLevels([1, 5])).toEqual([1, 5]);
    });

    it('单调不减（频次高的档位不低于频次低的）', () => {
        const lv = cloudLevels([1, 2, 3, 7, 20]);
        for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeGreaterThanOrEqual(lv[i - 1]);
    });

    it('档位恒在 1..levelCount 内', () => {
        for (const w of [0, 1, 2, 3, 100, -5]) {
            for (const lv of cloudLevels([w, 1, 50])) expect(lv).toBeGreaterThanOrEqual(1);
        }
        expect(cloudLevels([1, 50]).every((v) => v >= 1 && v <= WORD_CLOUD_LEVELS)).toBe(true);
    });

    it('可指定档数（未来 CSS 加档时不用改函数）', () => {
        expect(cloudLevels([1, 9], 3)).toEqual([1, 3]);
        expect(cloudLevels([1, 9], 1)).toEqual([1, 1]);
    });

    /**
     * 🔴🔴 2026-11-15 用户真实库回归（153 条 / 52 个题材）。
     *
     * 这条钉的是「排名百分位 vs 线性归一」这个**真实修过的 bug**：
     * 原实现 `(w-min)/(max-min)` 在一条 57 的极值存在时，把第 3 名 21 到第 40 名 1 全压进同一档，
     * 词云塌成「两个字巨大 + 三十八个一样小」—— 正是 `cloudLevels` 注释里明令禁止的形态。
     * ⚠️ 旧用例（min→1 / max→5 / 单调 / 全同频中档）**全都抓不到**它，因为那些形状里没有长尾。
     */
    it('🔴 极值压境时仍要分得开：第 3 名不许和尾部塌进同一档', () => {
        // 真实分布的头部形状：57, 55, 21, 20, 19, 17, 15, 12, 11, 10, 9, 8, 6, 5, 5, 4, 3, 2, 1, 1
        const weights = [57, 55, 21, 20, 19, 17, 15, 12, 11, 10, 9, 8, 6, 5, 5, 4, 3, 2, 1, 1];
        const lv = cloudLevels(weights);
        // 两端仍拉满（既有口径不许退）
        expect(lv[0]).toBe(5);
        expect(lv[lv.length - 1]).toBe(1);
        // 核心断言：第 3 名（21 次）必须**明显**大于尾部（1 次），不能同档
        expect(lv[2]).toBeGreaterThan(lv[lv.length - 2]);
        expect(lv[2] - lv[lv.length - 2]).toBeGreaterThanOrEqual(2);
        // 词云不能只剩两档可用：本次 5 档必须**全部**用上
        expect(new Set(lv).size).toBe(5);
    });

    it('🔴 并列频次拿同一档（⛔ 别让同频词因数组顺序不同而字号不一）', () => {
        const a = cloudLevels([50, 5, 5, 1]);
        expect(a[1]).toBe(a[2]);
        const b = cloudLevels([50, 1, 5, 5]); // 同样的值，换个摆放顺序
        expect(b[2]).toBe(b[3]);
        // 5 在这两份输入里必须拿到同一个档位
        expect(a[1]).toBe(b[2]);
    });

    it('单个词 ⇒ 中档（它走的是「全同频」那条口径，没有对比对象时大小无意义）', () => {
        expect(cloudLevels([7])).toEqual([3]);
        expect(cloudLevels([7, 7, 7])).toEqual([3, 3, 3]);
    });
});

/**
 * 🔴 m05266（用户逐字）：「标签词云加更多的颜色」。
 *
 * 色相按**词文本**哈希分配，不是按下标。这三条钉的就是这个口径 ——
 * 一旦有人改成"按数组下标取色"，第①②条立刻红。
 */
describe('cloudHueIndexOf（色相按文本稳定分配）', () => {
    it('🔴 同一文本永远同一个颜色（重新排序 / 新增标签都不许换色）', () => {
        const texts = ['科幻', '喜剧', '动画', 'RPG', '周杰伦', '工作'];
        for (const t of texts) {
            expect(cloudHueIndexOf(t)).toBe(cloudHueIndexOf(t));
        }
        // 排序变了也还是同一个色：色相跟文本走，不跟位置走
        const shuffled = [...texts].reverse();
        const byText = new Map(texts.map((t) => [t, cloudHueIndexOf(t)]));
        for (const t of shuffled) expect(cloudHueIndexOf(t)).toBe(byText.get(t));
    });

    it('结果恒落在 0..CLOUD_HUE_COUNT-1（越界会让 hue-N 类名指向不存在的规则）', () => {
        const sample = [
            '科幻', '喜剧', '动画', '奇幻', '剧情', '家庭', '冒险', '动作',
            'RPG', 'Indie', 'a', 'bb', 'ccc', '', '  ', '冗长的标签名字用来测试哈希',
        ];
        for (const t of sample) {
            const h = cloudHueIndexOf(t);
            expect(Number.isInteger(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(CLOUD_HUE_COUNT);
        }
    });

    it('🔴 不同文本要摊开在多个色相上（全挤一个桶 = 等于没加颜色）', () => {
        // 用户真实库 Top15 题材，足够代表实际分布
        const real = [
            '喜剧', '动画', '奇幻', '剧情', '家庭', '冒险', '动作', 'Indie',
            '古装', '流行', '科幻', '游戏', '儿童', '爱情', 'Action',
        ];
        const hues = new Set(real.map((t) => cloudHueIndexOf(t)));
        // ⚠️ 8 个桶装 15 个词必有碰撞，不要求 8 个全用上；
        //    但少于 3 个桶就说明哈希退化了（比如只用了首字符），那样看着仍是一片单色。
        expect(hues.size).toBeGreaterThanOrEqual(3);
    });

    it('空值不炸，且与空串同桶', () => {
        expect(() => cloudHueIndexOf('')).not.toThrow();
        expect(cloudHueIndexOf('')).toBe(cloudHueIndexOf(''));
    });
});
