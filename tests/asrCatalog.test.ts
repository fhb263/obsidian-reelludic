/**
 * 「选择模型」平铺列表的数据契约。
 *
 * ⚠️ 这里钉的是**用户对照表的口径**（体积 / 准确度 / 标签），不是下载用的真实字节数。
 *    真实字节数在 `asrModels.ASR_MODEL_PRESETS` 与 `asrBundles`，两套各管各的。
 */
import { describe, expect, it } from 'vitest';

import { accuracyLabel, asrCatalog, asrCatalogTiers, catalogTierOf, tierRowVisible } from 'pure/asrCatalog';
import { ASR_ENGINES, ASR_ENGINE_IDS } from 'pure/asrEngines';

describe('asrCatalog 分组', () => {
    it('六家全在，顺序与 ASR_ENGINES 一致', () => {
        const groups = asrCatalog();
        expect(groups.map((g) => g.engine)).toEqual([...ASR_ENGINE_IDS]);
        expect(groups).toHaveLength(6);
    });

    it('家名与副标题直接取自 ASR_ENGINES（⛔ 不另抄一份）', () => {
        for (const g of asrCatalog()) {
            const def = ASR_ENGINES.find((e) => e.id === g.engine);
            expect(g.title).toBe(def?.title);
            expect(g.subtitle).toBe(def?.subtitle);
        }
    });

    it('每组至少一个档位', () => {
        for (const g of asrCatalog()) expect(g.tiers.length).toBeGreaterThan(0);
    });

    it('每组里的 tier.engine 与分组一致（⛔ 防手抄串行）', () => {
        for (const g of asrCatalog()) {
            for (const t of g.tiers) expect(t.engine).toBe(g.engine);
        }
    });
});

describe('档位表数字（用户对照表口径）', () => {
    const byPick = new Map(asrCatalogTiers().map((t) => [t.pickId, t]));

    it('总档位数 = 6 + 2 + 2 + 2 + 1 + 2 = 15', () => {
        expect(asrCatalogTiers()).toHaveLength(15);
    });

    it('Whisper 六档体积与准确度逐字对齐用户表', () => {
        expect(byPick.get('whisper:tiny')).toMatchObject({ size: '75 MB', accZh: 18.7, accEn: 7.55, tag: '极速极简' });
        expect(byPick.get('whisper:base')).toMatchObject({ size: '142 MB', accZh: 8.9, accEn: 5.01, tag: '入门平衡' });
        expect(byPick.get('whisper:small')).toMatchObject({ size: '466 MB', accZh: 6.2, accEn: 3.43, tag: '桌面常用' });
        expect(byPick.get('whisper:medium')).toMatchObject({ size: '1.5 GB', accZh: 4.8, accEn: 2.9, tag: '高精度' });
        expect(byPick.get('whisper:turbo')).toMatchObject({ size: '1.6 GB', accZh: 7.5, accEn: 4.8, tag: '性价比之王' });
        expect(byPick.get('whisper:large-v3')).toMatchObject({ size: '3.1 GB', accZh: 3.7, accEn: 3.0, tag: '旗舰精度' });
    });

    it('⛔ Whisper 档位按体积升序（turbo 在 medium 与 large-v3 之间）', () => {
        const order = asrCatalog()
            .find((g) => g.engine === 'whisper')
            ?.tiers.map((t) => t.tier);
        expect(order).toEqual(['tiny', 'base', 'small', 'medium', 'turbo', 'large-v3']);
    });

    it('Qwen3 两档', () => {
        expect(byPick.get('qwen3:0.6B')).toMatchObject({ size: '1.88 GB', accZh: 3.15, accEn: 2.11, tag: '高吞吐引擎' });
        expect(byPick.get('qwen3:1.7B')).toMatchObject({ size: '4.71 GB', accZh: 1.52, accEn: 1.63, tag: '开源 SOTA' });
    });

    it('SenseVoice 两档', () => {
        expect(byPick.get('sensevoice:int8')).toMatchObject({ size: '228 MB', accZh: 6.2, accEn: 3.1, tag: '端侧首选' });
        expect(byPick.get('sensevoice:fp32')).toMatchObject({ size: '894 MB', accZh: 6.2, accEn: 3.1, tag: '精度基准' });
    });

    it('⛔ Paraformer 的英文指标是 null（上游没给），不是 0', () => {
        expect(byPick.get('paraformer:int8')).toMatchObject({ size: '237 MB', accZh: 1.95, accEn: null });
        expect(byPick.get('paraformer:fp32')).toMatchObject({ size: '880 MB', accZh: 1.95, accEn: null });
        expect(accuracyLabel(byPick.get('paraformer:int8')!)).toBe('1.95/-%');
    });

    it('⛔ X-ASR 只有一行（HF 上只有 ONNX，没有 Q4_K / F16 两个 GGUF 档）', () => {
        const xasr = asrCatalog().find((g) => g.engine === 'xasr');
        expect(xasr?.tiers).toHaveLength(1);
        expect(xasr?.tiers[0]).toMatchObject({ pickId: 'xasr:1920', size: '586 MB', accZh: 6.85, accEn: 4.0 });
    });

    it('⛔ X-ASR 的 tier 是裸数字，label 才是给人看的 `1920ms`', () => {
        const t = byPick.get('xasr:1920')!;
        expect(t.tier).toBe('1920');
        expect(t.label).toBe('1920ms');
    });

    it('Confucius4 两档', () => {
        expect(byPick.get('confucius:Q4_K_M')).toMatchObject({ size: '1.0 GB', accZh: 8.2, accEn: 6.1, tag: '高精度零回改' });
        expect(byPick.get('confucius:F16')).toMatchObject({ size: '3.2 GB', accZh: 8.2, accEn: 6.1, tag: '流式旗舰' });
    });
});

describe('pickId 契约', () => {
    it('每个 pickId 都是 `<engine>:<档位>`，且与 switchAsrModel 的前缀约定一致', () => {
        for (const t of asrCatalogTiers()) {
            expect(t.pickId.startsWith(`${t.engine}:`)).toBe(true);
            expect(t.pickId.slice(t.engine.length + 1)).toBe(t.tier);
        }
    });

    it('pickId 全局唯一', () => {
        const ids = asrCatalogTiers().map((t) => t.pickId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('⛔ 六家里只有 X-ASR 带 label（其余靠 tier 就能显示）', () => {
        const withLabel = asrCatalogTiers().filter((t) => t.label !== undefined);
        expect(withLabel.map((t) => t.engine)).toEqual(['xasr']);
    });
});

describe('catalogTierOf', () => {
    it('认得出已有 pickId', () => {
        expect(catalogTierOf('whisper:base')?.tier).toBe('base');
        expect(catalogTierOf('confucius:F16')?.tier).toBe('F16');
    });

    it('认不出返回 null（调用方据此回落默认档）', () => {
        expect(catalogTierOf('nope')).toBeNull();
        expect(catalogTierOf('')).toBeNull();
        expect(catalogTierOf('whisper:不存在的档')).toBeNull();
    });

    it('⛔ 大小写敏感：`whisper:BASE` 不是 `whisper:base`', () => {
        expect(catalogTierOf('whisper:BASE')).toBeNull();
    });
});

describe('accuracyLabel', () => {
    it('两项都有时拼成 `中/英%`', () => {
        const t = asrCatalogTiers().find((x) => x.pickId === 'whisper:base')!;
        expect(accuracyLabel(t)).toBe('8.9/5.01%');
    });

    it('单项为 null 时显示 `-`（⛔ 不是 0，也不是「暂无」）', () => {
        const t = asrCatalogTiers().find((x) => x.pickId === 'paraformer:int8')!;
        expect(accuracyLabel(t)).toBe('1.95/-%');
    });

    it('两项都 null 也合法', () => {
        expect(accuracyLabel({ ...asrCatalogTiers()[0], accZh: null, accEn: null })).toBe('-/-%');
    });
});

describe('tierRowVisible（组内折叠：哪些档位该显示）', () => {
    // 常用入参：前 3 档常驻、收起态、不是选中项
    const base = { tierLimit: 3, expanded: false, isCurrent: false } as const;

    it('普通引擎：前 tierLimit 档可见，其余折起来', () => {
        expect(tierRowVisible(0, base.tierLimit, base.isCurrent, base.expanded, 'sensevoice')).toBe(true);
        expect(tierRowVisible(2, base.tierLimit, base.isCurrent, base.expanded, 'sensevoice')).toBe(true);
        expect(tierRowVisible(3, base.tierLimit, base.isCurrent, base.expanded, 'sensevoice')).toBe(false);
    });

    it('普通引擎：当前选中项永远显示（⛔ 别让右侧有配置、左侧找不到行）', () => {
        expect(tierRowVisible(5, base.tierLimit, true, false, 'confucius')).toBe(true);
    });

    it('普通引擎：点了展开后全部显示', () => {
        expect(tierRowVisible(5, base.tierLimit, false, true, 'paraformer')).toBe(true);
    });

    /**
     * 🔴 2026-11-10 用户逐字（m03321）：「Whisper.cpp 后三档不再折叠起来默认展开」
     *    ⇒ whisper **六档全摊**，与「第几档」「收没收起」「是不是选中项」全都无关。
     */
    it('whisper：六档全部可见，不受 tierLimit / expanded 影响', () => {
        const whisper = asrCatalog().find((g) => g.engine === 'whisper')!;
        expect(whisper.tiers.length).toBe(6);
        for (let ti = 0; ti < whisper.tiers.length; ti += 1) {
            expect(tierRowVisible(ti, 3, false, false, 'whisper'), `第 ${ti} 档被折了`).toBe(true);
            expect(tierRowVisible(ti, 0, false, false, 'whisper')).toBe(true);
        }
    });

    /**
     * 🔴 这是本判据最容易翻车的地方：whisper 免折之后，「收起态下被折起来的档数」恒为 0，
     *    而 `Settings.applyTierFold` 原来按 `hiddenCount === 0 && expanded` 决定要不要藏按钮 ——
     *    算出来是 false ⇒ **一个字都不用折的 whisper 组也挂着一个「展开其余 3 档」按钮，点了没反应**。
     *    视图层已改成 `hiddenCount === 0 && !expanded`。这里把这个前提钉死：
     *    免折的组在收起态下，可见数 = 总档数（⇒ 调用方据此算出 hiddenCount 为 0）。
     */
    it('whisper 收起态下可见数 = 总档数（⇒ 折叠按钮必须不出现）', () => {
        const whisper = asrCatalog().find((g) => g.engine === 'whisper')!;
        const visible = whisper.tiers.filter((_, ti) => tierRowVisible(ti, 3, false, false, 'whisper')).length;
        expect(visible).toBe(whisper.tiers.length);
        expect(whisper.tiers.length - visible).toBe(0);
    });

    /**
     * ⛔ 反向守卫：其余五家**不许**被 whisper 的豁免带跑。
     *    如果有人把 `WHISPER_NO_FOLD` 写成 `ASR_ENGINE_IDS`（或判据里漏了 engine 判断），
     *    这条会红 —— 那时所有组都全摊，「展开其余 N 档」全都变成死按钮。
     */
    it('⛔ 其余五家不受豁免影响，收起态下第 3 档之后仍然折着', () => {
        for (const engine of ASR_ENGINE_IDS) {
            if (engine === 'whisper') continue;
            const g = asrCatalog().find((x) => x.engine === engine)!;
            if (g.tiers.length <= 3) continue; // 本身不足 3 档的组没有「后面」可折
            expect(tierRowVisible(3, 3, false, false, engine), `${engine} 的第 4 档不该显示`).toBe(false);
        }
    });
});
