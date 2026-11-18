// `pure/sourcePitch` 的守卫测试。
//
// 这段文案是**用户逐字给定**的（勾选项 hover 2 秒后的轻提示），所以测试不是为了「跑绿」，
// 而是为了钉住两件事：
//   ⑴ **覆盖率**：`PROVIDERS` 里某个组适用的每个已实现源都必须有文案 —— 将来新接一个源却忘配
//      一句话说明，CI 当场红（⛔ 别把守卫放宽成「允许缺失」，那等于让新源静默没有提示）。
//   ⑵ **不带渲染标记**：文案会进 `.rl-tip` 的 `textContent`（纯文本），若有人在里面写 `<b>` 或
//      markdown 强调，用户看到的是字面符号 —— 这一条挡住「以为气泡会解析」的误改。
import { describe, expect, it } from 'vitest';
import { SOURCE_GROUPS, PROVIDERS, GROUP_LABELS, type ProviderId } from 'pure/sourceRegistry';
import { SOURCE_PITCH, sourcePitch } from 'pure/sourcePitch';

/** 与 `Settings.groupCandidates` 逐字同口径：只算「已实现 且 groups 含本组」的源 */
function candidatesOf(group: (typeof SOURCE_GROUPS)[number]): ProviderId[] {
    return PROVIDERS.filter((p) => p.implemented && p.groups.includes(group)).map((p) => p.id);
}

describe('SOURCE_PITCH 覆盖率', () => {
    it('六组全部登记（含缺省的空对象也允许，但键必须在）', () => {
        for (const g of SOURCE_GROUPS) expect(SOURCE_PITCH).toHaveProperty(g);
        expect(Object.keys(SOURCE_PITCH).sort()).toEqual([...SOURCE_GROUPS].sort());
    });

    for (const g of SOURCE_GROUPS) {
        it(`「${GROUP_LABELS[g]}」组：每个候选源都有文案`, () => {
            const ids = candidatesOf(g);
            expect(ids.length).toBeGreaterThan(0);
            for (const id of ids) {
                const text = sourcePitch(g, id);
                expect(text, `${g}/${id} 缺一句话说明（真源：pure/sourcePitch.ts）`).not.toBe('');
            }
        });
    }

    it('登记了文案的源，必须真的属于该组（防「配错组」的静默失效）', () => {
        for (const g of SOURCE_GROUPS) {
            const allowed = new Set(candidatesOf(g));
            // `Object.keys` 天然返回 string[]；这里的键真源就是 `ProviderId`，收窄一次即可
            for (const id of Object.keys(SOURCE_PITCH[g]) as ProviderId[]) {
                expect(allowed.has(id), `${g} 里配了不属于该组的源：${id}`).toBe(true);
            }
        }
    });
});

describe('sourcePitch 查询语义', () => {
    it('查不到的源返回空串（调用端据此回退通用提示）', () => {
        expect(sourcePitch('book', 'steam')).toBe('');
    });

    it('同一个源在不同组是不同的话（豆瓣六组各一套）', () => {
        const texts = SOURCE_GROUPS.map((g) => sourcePitch(g, 'douban')).filter((t) => t !== '');
        expect(texts.length).toBeGreaterThan(1);
        expect(new Set(texts).size).toBe(texts.length);
    });

    it('文案非空且不含 HTML / markdown 强调标记', () => {
        for (const g of SOURCE_GROUPS) {
            for (const [id, text] of Object.entries(SOURCE_PITCH[g])) {
                expect(text && text.trim().length, `${g}/${id} 文案为空`).toBeGreaterThan(0);
                // 气泡走 textContent（纯文本）：`<` 与 `**` 会被原样显示成字符
                expect(text, `${g}/${id} 含 HTML 尖括号`).not.toMatch(/[<>]/);
            }
        }
    });

    it('不重复登记同一个组里的同一个源两次（对象天然去重，这条防「改回数组」）', () => {
        for (const g of SOURCE_GROUPS) {
            const keys = Object.keys(SOURCE_PITCH[g]);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});
