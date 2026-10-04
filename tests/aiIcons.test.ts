// AI 服务商图标（#479 建立 / #480 扩表）：品牌标来自 LobeHub Icons（MIT），生成器写盘 ⇒ 钉运行时完整性 + 生成质量。
// 🔴 内置图标名（`plug` / `ban` / `volume-2` / `play`）已用 `node _probe_lucide.cjs <name>` 在 app.js 图标表**实测存在** ——
//    `setIcon` 遇到未知名是**静默失败**（留一个空白 span，零报错），所以这份表是**正向白名单**，⛔ 别凭推测改。
import { describe, it, expect } from 'vitest';
import { AI_PROVIDER_ICON, TTS_ICON } from 'pure/aiIcons';

describe('AI 服务商图标（#479 / #480）', () => {
    it('chat 四档都有图标（编译期由 Record<TranslateProvider, AiIcon> 兜住，这里再钉一遍运行时）', () => {
        expect(Object.keys(AI_PROVIDER_ICON).sort()).toEqual(['custom', 'deepseek', 'siliconflow', 'zhipu']);
    });

    it('🔴 #480：硅基流动**升为一等 chat 提供商** ⇒ 它的品牌标进了服务商表', () => {
        const ic = AI_PROVIDER_ICON.siliconflow;
        expect(ic.kind).toBe('brand');
        if (ic.kind === 'brand') expect(ic.slug).toBe('siliconcloud');
    });

    it('品牌标：24×24 视图框 + 真有路径数据（防生成器抽空/抽错段）', () => {
        // ⚠️ 表的**键**是 TranslateProvider、`slug` 是 LobeHub 的标名 —— 两者不总是同名
        //    （`siliconflow` 的标叫 `siliconcloud`），所以这里按 `[key, slug]` 成对钉。
        const pairs: [keyof typeof AI_PROVIDER_ICON, string][] = [
            ['zhipu', 'zhipu'],
            ['deepseek', 'deepseek'],
            ['siliconflow', 'siliconcloud'],
        ];
        for (const [key, slug] of pairs) {
            const ic = AI_PROVIDER_ICON[key];
            expect(ic.kind).toBe('brand');
            if (ic.kind !== 'brand') continue;
            expect(ic.slug).toBe(slug);
            expect(ic.viewBox).toBe('0 0 24 24');
            expect(ic.d).toMatch(/^M[\d.\s-]/);
            expect(ic.d.length).toBeGreaterThan(200);
        }
    });

    it('🔴 自定义端点走 Obsidian 内置图标（⛔ 不拿 OpenAI 标顶替，免得填 Kimi/Ollama 的用户误会）', () => {
        expect(AI_PROVIDER_ICON.custom).toEqual({ kind: 'builtin', id: 'plug' });
    });

    it('朗读音源走内置标（音源不是服务商）；🔴 #481：标从波形改**喇叭**，与「试听 ▶」区分开', () => {
        expect(TTS_ICON).toEqual({ kind: 'builtin', id: 'volume-2' });
    });
});
