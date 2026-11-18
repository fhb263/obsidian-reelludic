import { describe, expect, it } from 'vitest';

import {
    ASR_ALL_ENGINES_SPLIT,
    asrEngineSubdir,
    asrFileOwner,
    asrFixedModelFiles,
} from 'pure/asrLayout';
import { ASR_MODEL_PRESETS } from 'pure/asrModels';
import { SENSEVOICE_VARIANTS } from 'pure/asrBundles';
import { ASR_ENGINES } from 'pure/asrEngines';

/**
 * 这个测试文件守的不是算法，是一条**极易被顺手改坏的产品规则**：
 * 三家模型必须各占一个子目录（m09819 用户报障「只有 Models 文件夹都不知道哪个是哪个」）。
 * 一旦有人把 whisper 改回根目录，这里立刻红。
 */
describe('pure/asrLayout 模型目录布局（m09819）', () => {    it('六家都必须分子目录，没有例外', () => {
        expect(ASR_ALL_ENGINES_SPLIT).toBe(true);
        for (const e of ASR_ENGINES) {
            const sub = asrEngineSubdir(e.id);
            expect(sub).toBe(e.id);
            // ⛔ 子目录名不能是空串 —— 空串拼出来就是根目录本身，那正是要禁的旧行为
            expect(sub.length).toBeGreaterThan(0);
        }
    });

    it('子目录名必须逐字等于 ASR_ENGINES 的 id（⛔ 不用展示名当目录名）', () => {
        expect(ASR_ENGINES.map((e) => e.id)).toEqual([
            'whisper',
            'qwen3',
            'sensevoice',
            'paraformer',
            'xasr',
            'confucius',
        ]);
        expect(ASR_ENGINES.map((e) => asrEngineSubdir(e.id))).toEqual([
            'whisper',
            'qwen3',
            'sensevoice',
            'paraformer',
            'xasr',
            'confucius',
        ]);
        // 展示名带点号与大写，当目录名会跨平台不一致，且 Windows 上「Whisper.cpp」是个怪目录名
        expect(asrEngineSubdir('Whisper.cpp')).toBe('whisper');
        expect(asrEngineSubdir('Qwen3-ASR')).toBe('whisper'); // 认不出回落 whisper（缺省引擎）
        // 🔴 新增三家的展示名同样认不出来（等于 id 的只有 id 本身），必须回落而不是拼出怪目录
        expect(asrEngineSubdir('X-ASR')).toBe('whisper');
        expect(asrEngineSubdir('Confucius4')).toBe('whisper');
    });

    it('whisper 的三档模型文件名全部能被认领回去', () => {
        for (const p of ASR_MODEL_PRESETS) {
            expect(asrFileOwner(p.fileName)).toBe('whisper');
        }
        // 档位文件名形如 ggml-xxx.bin，用前缀规则而非硬编码列表，
        // 这样以后加上 medium/large 之外的新档位，迁移逻辑不用改
        expect(asrFileOwner('ggml-tiny.bin')).toBe('whisper');
        expect(asrFileOwner('ggml-large-v3.bin')).toBe('whisper');
    });

    it('SenseVoice 的模型与词表能被认领回去，且两档都覆盖', () => {
        const fixed = asrFixedModelFiles('sensevoice');
        expect(fixed).toContain('tokens.txt');
        for (const v of SENSEVOICE_VARIANTS) {
            expect(fixed).toContain(v.modelFile);
            expect(asrFileOwner(v.modelFile)).toBe('sensevoice');
        }
        expect(asrFileOwner('tokens.txt')).toBe('sensevoice');
    });

    it('认不出的文件返回 null（⛔ 别乱搬用户的文件）', () => {
        expect(asrFileOwner('my-notes.md')).toBeNull();
        expect(asrFileOwner('_probe16k.wav')).toBeNull();
        expect(asrFileOwner('config.json')).toBeNull();
        expect(asrFileOwner('model.safetensors')).toBeNull(); // Qwen3 的产物在子目录里，不在平面清单
    });

    it('匹配要大小写不敏感（Windows 用户可能手动改成 GGML-BASE.BIN）', () => {
        expect(asrFileOwner('GGML-BASE.BIN')).toBe('whisper');
        // ⚠️ tokens.txt 走精确匹配（不忽略大小写）—— 它是 sherpa 认死的文件名，改名就用不了了
        expect(asrFileOwner('TOKENS.TXT')).toBeNull();
    });

    it('qwen3 没有平面文件（它的产物是两个上游仓库名目录）', () => {
        expect(asrFixedModelFiles('qwen3')).toEqual([]);
    });
});
