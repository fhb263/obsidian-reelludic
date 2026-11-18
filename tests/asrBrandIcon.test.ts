// 六家引擎品牌标记的守卫（2026-11-11 用户：「图标要用各自的品牌图标而不是一个房子图标」）。
//
// 🔴 由来：用户要求「各自的品牌图标」，但实测 Obsidian 的 asar 图标库里**没有任何一家
//    ASR 厂商的图形**（openai / chatgpt / qwen / tongyi / alibaba / whisper / llama /
//    sherpa / funasr / huggingface 全部搜不到）。用户随后裁定「我画 6 个品牌 SVG 内联进去」。
//    ⇒ 这些是按各家技术特征画的极简标记，不是官方 logo 复刻，⛔ 别在文案里那样宣称。
//
// ⚠️ 为什么锁这些：
//   · 少画一家 ⇒ 那家左栏图标空白（对齐位缺失，标题整体左缩）；
//   · 路径写错一个字符 ⇒ `safeSetIcon` 不会报错，但画出来是残的（tsc 与行为测试都看不见）；
//   · `aria-hidden` 漏了 ⇒ 读屏会把装饰图形念一遍，而左侧项本身已有名称与 aria-pressed。
import { describe, expect, it } from 'vitest';
import { ASR_BRAND_KEYS, asrBrandKey, asrBrandMark, asrBrandSvg } from '../src/pure/asrBrandIcon';

describe('asrBrandKey — 引擎名归一化', () => {
    it('六家的键都能认出来', () => {
        for (const k of ASR_BRAND_KEYS) expect(asrBrandKey(k)).toBe(k);
    });

    it('大小写与首尾空白不影响', () => {
        expect(asrBrandKey('  Whisper ')).toBe('whisper');
        expect(asrBrandKey('Qwen3')).toBe('qwen3');
    });

    it('confucius4 / confucius4-r2t2 都归到 confucius', () => {
        expect(asrBrandKey('confucius4')).toBe('confucius');
        expect(asrBrandKey('Confucius4-R2T2')).toBe('confucius');
    });

    it('认不出的给 null（⛔ 别瞎猜一个图形糊弄）', () => {
        expect(asrBrandKey('')).toBeNull();
        expect(asrBrandKey('   ')).toBeNull();
        expect(asrBrandKey('some-new-engine')).toBeNull();
    });
});

describe('asrBrandMark — 六家的图形数据', () => {
    it('六家都有图形，且至少一条 path', () => {
        for (const k of ASR_BRAND_KEYS) {
            const m = asrBrandMark(k);
            expect(m).not.toBeNull();
            expect(m!.d.length).toBeGreaterThan(0);
            for (const d of m!.d) expect(d.trim().length).toBeGreaterThan(0);
        }
    });

    it('⛔ 六家的路径不许互相抄（抄了等于全用同一个图标，正是用户反对的）', () => {
        const sigs = ASR_BRAND_KEYS.map((k) => asrBrandMark(k)!.d.join('|'));
        expect(new Set(sigs).size).toBe(ASR_BRAND_KEYS.length);
    });

    it('统一 24×24 viewBox', () => {
        for (const k of ASR_BRAND_KEYS) expect(asrBrandMark(k)!.viewBox).toBe('0 0 24 24');
    });

    it('认不出的返回 null', () => {
        expect(asrBrandMark('nope')).toBeNull();
    });
});

describe('asrBrandSvg — 渲染出的 svg 片段', () => {
    it('含全部 path，且用 currentColor 随主题变色', () => {
        const svg = asrBrandSvg('whisper', 14);
        expect(svg.startsWith('<svg ')).toBe(true);
        expect(svg).toContain('stroke="currentColor"');
        expect(svg).toContain('width="14"');
        expect(svg).toContain('height="14"');
        const paths = asrBrandMark('whisper')!.d.length;
        expect((svg.match(/<path /g) ?? []).length).toBe(paths);
    });

    it('⛔ 必须 aria-hidden + focusable=false（图形是装饰，读屏不该念）', () => {
        for (const k of ASR_BRAND_KEYS) {
            const svg = asrBrandSvg(k);
            expect(svg).toContain('aria-hidden="true"');
            expect(svg).toContain('focusable="false"');
        }
    });

    it('有 dots 的那家要把 circle 也画出来（qwen3 的中心点）', () => {
        const svg = asrBrandSvg('qwen3');
        expect(svg).toContain('<circle ');
    });

    it('认不出的给空串（调用方据此退回通用图标）', () => {
        expect(asrBrandSvg('nope')).toBe('');
    });
});
