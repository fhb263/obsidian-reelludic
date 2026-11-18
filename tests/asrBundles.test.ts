/**
 * `pure/asrBundles` + `services/asrBundleInstall` 的单测。
 *
 * 🔴 这里钉的是**实测出来的上游事实**，不是我想当然的设计：
 *    · sherpa-onnx 只有 `.tar.bz2`（实测 v2.0.1 的 288 个资产全是 tar.bz2，没有 zip）；
 *    · `sherpa-onnx-offline.exe` 是单文件自足的（干净 PATH + 干净 cwd 跑真实音频成功）；
 *    · SenseVoice 模型 239,233,841 字节、词表 315,894 字节（HEAD 实测）。
 *    上游哪天变了，这些测试先红 —— 比用户在转写时收到一句「failed to load model」强得多。
 */
import { describe, expect, it } from 'vitest';
import {
    bundleBytes,
    bundlePercent,
    bundleSizeLabel,
    bundleOf,
    githubMirrorUrls,
    innerPathMatches,
    normalizeQwenTier,
    normalizeSvVariant,
    QWEN_ALIGN,
    QWEN_ALIGN_DIR,
    QWEN_ASR_DIR,
    QWEN_ASR_VARIANTS,
    qwenBundle,
    qwenVariantOf,
    SENSEVOICE_BUNDLE,
    SENSEVOICE_VARIANTS,
    senseVoiceBundle,
    SHERPA_EXE_INNER,
    SHERPA_EXE_NAME,
    SHERPA_WIN_ARCHIVE,
    svVariantOf,
} from 'pure/asrBundles';
import {
    CONFUCIUS_VARIANTS,
    confuciusBundle,
    confuciusVariantOf,
    LLAMA_RUNTIME_FILES,
    normalizeConfuciusTier,
    normalizeParaVariant,
    normalizeXasrChunk,
    PARAFORMER_VARIANTS,
    paraformerBundle,
    paraVariantOf,
    SHERPA_VAD_OFFLINE_EXE_NAME,
    SHERPA_VAD_ONLINE_EXE_NAME,
    SILERO_VAD_NAME,
    XASR_VARIANTS,
    xasrBundle,
    xasrVariantOf,
} from 'pure/asrBundles';
import { installBundle, type InstallBundleDeps } from 'services/asrBundleInstall';

describe('pure/asrBundles 磁盘体积常量', () => {
    it('SenseVoice 三个文件的字节数与 HEAD 实测一致', () => {
        const files = SENSEVOICE_BUNDLE.files;
        expect(files.map((f) => f.fileName)).toEqual([SHERPA_EXE_NAME, 'model.int8.onnx', 'tokens.txt']);
        expect(files[1].bytes).toBe(239233841);
        expect(files[2].bytes).toBe(315894);
        // 程序包是 26.5MB，但**解出来只有一个 2MB 的 exe** —— 所以校验的是压缩包大小
        expect(files[0].bytes).toBe(26582353);
    });

    it('程序只有一个，且来自 tar.bz2 里的那一条路径', () => {
        const exe = SENSEVOICE_BUNDLE.files[0];
        expect(exe.innerPath).toBe(SHERPA_EXE_INNER);
        // ⚠️ 官方 release 只有 tar.bz2 一种资产形态（实测 288 个资产全是），
        //    这条断言防的是「哪天有人改成 .zip 却没改解压分支」
        expect(SHERPA_WIN_ARCHIVE.endsWith('.tar.bz2')).toBe(true);
    });

    it('SenseVoice 不是被封锁的包（能一键装）', () => {
        expect(SENSEVOICE_BUNDLE.blockedReason).toBe('');
    });

    it('whisper 不走安装包体系（它按档位走 ASR_MODEL_PRESETS）', () => {
        expect(bundleOf('whisper')).toBeNull();
        expect(bundleOf('sensevoice')).not.toBeNull();
        expect(bundleOf('qwen3')).not.toBeNull();
    });
});

describe('pure/asrBundles Qwen3 清单', () => {
    const qwen = bundleOf('qwen3');
    it('两个模型目录都在（ASR 出文本、Aligner 出时间轴，缺一不可）', () => {
        expect(qwen).not.toBeNull();
        const names = qwen!.files.map((f) => f.fileName);
        expect(names.some((n) => n.startsWith(`${QWEN_ASR_DIR}/`))).toBe(true);
        expect(names.some((n) => n.startsWith(`${QWEN_ALIGN_DIR}/`))).toBe(true);
    });

    it('每个目录都齐了该有的文件，且不含 README 这类无关件', () => {
        const names = qwen!.files.map((f) => f.fileName.split('/')[1]);
        const v = qwenVariantOf('0.6B');
        for (const want of Object.keys(v.files)) expect(names).toContain(want);
        for (const want of Object.keys(QWEN_ALIGN.files)) expect(names).toContain(want);
        expect(names).not.toContain('README.md');
        expect(names).not.toContain('.gitattributes');
        expect(qwen!.files.length).toBe(Object.keys(v.files).length + Object.keys(QWEN_ALIGN.files).length);
    });

    it('大文件（model.safetensors）有真实字节数，不是 0', () => {
        const big = qwen!.files.filter((f) => f.fileName.endsWith('model.safetensors'));
        expect(big.length).toBe(2);
        for (const f of big) expect(f.bytes).toBeGreaterThan(1_000_000_000);
    });

    it('如实告诉用户「还需要 Python 环境」，⛔ 不假装一键全自动', () => {
        expect(qwen!.blockedReason).toContain('Python');
    });
});

describe('pure/asrBundles 另两家的档位（m09432）', () => {
    it('Qwen3 有两档，目录名必须等于上游仓库名（否则桥接脚本找不到）', () => {
        expect(QWEN_ASR_VARIANTS.map((v) => v.tier)).toEqual(['0.6B', '1.7B']);
        expect(QWEN_ASR_VARIANTS.map((v) => v.dir)).toEqual(['Qwen3-ASR-0.6B', 'Qwen3-ASR-1.7B']);
        // 🔴 小写连字符的旧目录名曾导致「下完用不上」，这条防它回来
        for (const v of QWEN_ASR_VARIANTS) expect(v.dir.startsWith('Qwen3-ASR-')).toBe(true);
    });

    it('1.7B 的权重分两片（+ 一个 index），体积明显大于 0.6B', () => {
        const small = bundleBytes(qwenBundle('0.6B'));
        const big = bundleBytes(qwenBundle('1.7B'));
        expect(big).toBeGreaterThan(small);
        const shards = qwenBundle('1.7B').files.filter((f) => /model-\d{5}-of-\d{5}\.safetensors$/.test(f.fileName));
        expect(shards.length).toBe(2);
        expect(qwenBundle('1.7B').files.some((f) => f.fileName.endsWith('model.safetensors.index.json'))).toBe(true);
    });

    it('换档位只影响 ASR 目录，对齐模型永远在（上游只有 0.6B 一档）', () => {
        const alignCount = (b: ReturnType<typeof qwenBundle>): number =>
            b.files.filter((f) => f.fileName.startsWith(`${QWEN_ALIGN_DIR}/`)).length;
        expect(alignCount(qwenBundle('0.6B'))).toBe(alignCount(qwenBundle('1.7B')));
        expect(alignCount(qwenBundle('0.6B'))).toBe(Object.keys(QWEN_ALIGN.files).length);
    });

    it('认不出的档位一律回落默认（⛔ 不抛错、也不下成奇怪的东西）', () => {
        expect(normalizeQwenTier(undefined)).toBe('0.6B');
        expect(normalizeQwenTier('9B')).toBe('0.6B');
        expect(normalizeQwenTier('1.7B')).toBe('1.7B');
        expect(qwenVariantOf('乱七八糟').dir).toBe('Qwen3-ASR-0.6B');
    });

    it('SenseVoice 有两档，模型文件名跟着档位走', () => {
        expect(SENSEVOICE_VARIANTS.map((v) => v.variant)).toEqual(['int8', 'fp32']);
        expect(svVariantOf('fp32').modelFile).toBe('model.onnx');
        expect(svVariantOf('int8').modelFile).toBe('model.int8.onnx');
        // 🔴 写死 int8 的话，用户选 fp32 会「装好了但探测去找一个没下过的文件名」
        const fp32 = senseVoiceBundle('fp32');
        expect(fp32.files.some((f) => f.fileName === 'model.onnx')).toBe(true);
        expect(fp32.files.some((f) => f.fileName === 'model.int8.onnx')).toBe(false);
    });

    it('fp32 比 int8 大（同一仓库里的两个 onnx）', () => {
        expect(svVariantOf('fp32').bytes).toBeGreaterThan(svVariantOf('int8').bytes);
        expect(svVariantOf('fp32').bytes).toBe(937617178);
        expect(svVariantOf('int8').bytes).toBe(239233841);
    });

    it('认不出的 SenseVoice 档位回落 int8', () => {
        expect(normalizeSvVariant(undefined)).toBe('int8');
        expect(normalizeSvVariant('q4')).toBe('int8');
        expect(normalizeSvVariant('fp32')).toBe('fp32');
    });

    it('`bundleOf` 的 opts 能把档位带下去', () => {
        const a = bundleOf('sensevoice', { svVariant: 'fp32' });
        const b = bundleOf('qwen3', { qwenTier: '1.7B' });
        expect(a!.files.some((f) => f.fileName === 'model.onnx')).toBe(true);
        expect(b!.files.some((f) => f.fileName.startsWith('Qwen3-ASR-1.7B/'))).toBe(true);
    });
});

describe('pure/asrBundles 新三家（Paraformer / X-ASR / Confucius4）', () => {
    it('Paraformer 两档，模型文件名跟着档位走', () => {
        expect(PARAFORMER_VARIANTS.map((v) => v.variant)).toEqual(['int8', 'fp32']);
        expect(paraVariantOf('int8').modelFile).toBe('model.int8.onnx');
        expect(paraVariantOf('fp32').modelFile).toBe('model.onnx');
        // ⛔ 写死 int8 的话，用户选 fp32 会「装好了但探测去找没下过的文件名」
        expect(paraformerBundle('fp32').files.some((f) => f.fileName === 'model.onnx')).toBe(true);
        expect(paraformerBundle('fp32').files.some((f) => f.fileName === 'model.int8.onnx')).toBe(false);
    });

    it('Paraformer 用 **offline** 版 exe + silero vad + 词表（四件套）', () => {
        const bundle = paraformerBundle('int8');
        expect(bundle.files).toHaveLength(4);
        const names = bundle.files.map((f) => f.fileName);
        expect(names).toContain(SHERPA_VAD_OFFLINE_EXE_NAME);
        expect(names).toContain(SILERO_VAD_NAME);
        expect(names).toContain('tokens.txt');
        // ⛔ online 版不认 --paraformer（实测打印 92 行 usage 后退出）
        expect(names).not.toContain(SHERPA_VAD_ONLINE_EXE_NAME);
        expect(bundle.blockedReason).toBe('');
    });

    it('⛔ X-ASR 必须用 **online** 版 exe（offline 版喂流式 encoder 会 0xC0000409 崩）', () => {
        const bundle = xasrBundle('1920');
        const names = bundle.files.map((f) => f.fileName);
        expect(names).toContain(SHERPA_VAD_ONLINE_EXE_NAME);
        expect(names).not.toContain(SHERPA_VAD_OFFLINE_EXE_NAME);
        expect(names).toContain(SILERO_VAD_NAME);
    });

    it('X-ASR 六件套齐全（exe + vad + 编码/解码/连接 + 词表）', () => {
        for (const v of XASR_VARIANTS) {
            const names = xasrBundle(v.chunk).files.map((f) => f.fileName);
            expect(names).toHaveLength(6);
            expect(names).toContain(`encoder-${v.chunk}ms.onnx`);
            expect(names).toContain(`decoder-${v.chunk}ms.onnx`);
            expect(names).toContain(`joiner-${v.chunk}ms.onnx`);
            expect(names).toContain('tokens.txt');
        }
    });

    it('X-ASR 四档分块，⛔ 三个权重必须同档配套（混用会直接崩）', () => {
        expect(XASR_VARIANTS.map((v) => v.chunk)).toEqual(['160', '480', '960', '1920']);
        for (const v of XASR_VARIANTS) {
            const names = xasrBundle(v.chunk).files.map((f) => f.fileName);
            // 同一档里出现的 encoder/decoder/joiner 后缀必须完全一致
            const suffix = `-${v.chunk}ms.onnx`;
            for (const n of names.filter((x) => /^(encoder|decoder|joiner)/.test(x))) {
                expect(n.endsWith(suffix)).toBe(true);
            }
        }
    });

    it('X-ASR 目录名跟着档位走（上游四档各一个子目录）', () => {
        for (const v of XASR_VARIANTS) expect(v.dir).toBe(`chunk-${v.chunk}ms-model`);
        expect(xasrVariantOf('1920').dir).toBe('chunk-1920ms-model');
        expect(xasrVariantOf('160').dir).toBe('chunk-160ms-model');
    });

    it('认不出的 X-ASR 档位回落 1920（默认最稳的一档）', () => {
        expect(normalizeXasrChunk(undefined)).toBe('1920');
        expect(normalizeXasrChunk('2000')).toBe('1920');
        expect(normalizeXasrChunk('160')).toBe('160');
    });

    it('Confucius4 两档的体积与上游 GGUF 实测字节一致', () => {
        expect(CONFUCIUS_VARIANTS.map((v) => v.tier)).toEqual(['Q4_K_M', 'F16']);
        expect(confuciusVariantOf('Q4_K_M').modelBytes).toBe(1107404736);
        expect(confuciusVariantOf('F16').modelBytes).toBe(3447345088);
        expect(confuciusVariantOf('Q4_K_M').mmprojBytes).toBe(348336544);
        expect(confuciusVariantOf('F16').mmprojBytes).toBe(641773984);
    });

    it('⛔ Confucius4 的运行时是一次下载剥出 8 个文件（不是下 8 遍 24MB 包）', () => {
        const runtime = confuciusBundle('Q4_K_M').files[0];
        expect(runtime.fileName).toBe('llama-mtmd-cli.exe');
        expect(runtime.innerPaths).toHaveLength(8);
        expect(runtime.innerPaths).toContain('llama-mtmd-cli.exe');
        expect(runtime.innerPaths).toContain('llama.dll');
        expect(runtime.innerPaths).toContain('mtmd.dll');
        expect(runtime.stripLayers).toBe(0);
        expect(runtime.archive).toBe('zip');
        // ⛔ 整个 zip 只算一次体积，否则进度条会重复计数
        expect(runtime.bytes).toBe(24930349);
        expect(LLAMA_RUNTIME_FILES).toHaveLength(8);
    });

    it('⛔ llama.cpp 最小可用集 8 个文件（只拷 exe 会静默失败）', () => {
        const names = LLAMA_RUNTIME_FILES.map((f) => f.name);
        expect(names).toEqual([
            'llama-mtmd-cli.exe',
            'llama.dll',
            'ggml.dll',
            'ggml-base.dll',
            'mtmd.dll',
            'llama-common.dll',
            'libomp.dll',
            'ggml-cpu-x64.dll',
        ]);
    });

    it('Confucius4 三件：运行时 + 语言模型 + 投影器（投影器必须下）', () => {
        const files = confuciusBundle('Q4_K_M').files;
        expect(files).toHaveLength(3);
        expect(files[1].fileName).toBe('Confucius4-R2T2-Q4_K_M.gguf');
        expect(files[2].fileName).toBe('mmproj-Confucius4-R2T2-Q8_0.gguf');
    });

    it('认不出的 Confucius4 档位回落 Q4_K_M', () => {
        expect(normalizeConfuciusTier(undefined)).toBe('Q4_K_M');
        expect(normalizeConfuciusTier('Q8_0')).toBe('Q4_K_M');
        expect(normalizeConfuciusTier('F16')).toBe('F16');
    });

    it('`bundleOf` 能把新三家与档位一起带下去；whisper 仍返回 null', () => {
        expect(bundleOf('paraformer', { paraVariant: 'fp32' })!.files.some((f) => f.fileName === 'model.onnx')).toBe(true);
        expect(bundleOf('xasr', { xasrChunk: '160' })!.files.some((f) => f.fileName === 'encoder-160ms.onnx')).toBe(true);
        expect(
            bundleOf('confucius', { confuciusTier: 'F16' })!.files.some((f) =>
                f.fileName.endsWith('f16.gguf'),
            ),
        ).toBe(true);
        // whisper 走 ASR_MODEL_PRESETS，不在这里
        expect(bundleOf('whisper')).toBeNull();
    });

    it('新三家的体积显著大于零且互不相同（⛔ 防手抄串行）', () => {
        const para = bundleBytes(paraformerBundle('int8'));
        const xasr = bundleBytes(xasrBundle('1920'));
        const conf = bundleBytes(confuciusBundle('Q4_K_M'));
        expect(para).toBeGreaterThan(0);
        expect(xasr).toBeGreaterThan(0);
        expect(conf).toBeGreaterThan(0);
        expect(new Set([para, xasr, conf]).size).toBe(3);
    });
});

describe('pure/asrBundles 镜像', () => {
    it('GitHub 镜像都保留了原始 URL（前缀式镜像，不是换域名）', () => {
        const urls = githubMirrorUrls(SHERPA_WIN_ARCHIVE);
        expect(urls.length).toBeGreaterThan(0);
        for (const u of urls) expect(u.endsWith(SHERPA_WIN_ARCHIVE)).toBe(true);
    });

    it('HuggingFace 类文件都有 hf-mirror 兜底（官方源在国内实测超时）', () => {
        for (const f of SENSEVOICE_BUNDLE.files) {
            if (f.fileName === SHERPA_EXE_NAME) continue; // 那个走 GitHub 镜像
            expect(f.mirrorUrl).toContain('hf-mirror.com');
        }
    });

    it('下载地址一律 https', () => {
        for (const bundle of [SENSEVOICE_BUNDLE, bundleOf('qwen3')!]) {
            for (const f of bundle.files) {
                expect(f.url.startsWith('https://')).toBe(true);
                if (f.mirrorUrl) expect(f.mirrorUrl.startsWith('https://')).toBe(true);
            }
        }
    });
});

describe('pure/asrBundles 加权进度', () => {
    it('按字节加权，不是按文件数', () => {
        // SenseVoice：25.4MB + 228.1MB + 0.3MB
        const total = bundleBytes(SENSEVOICE_BUNDLE);
        expect(bundlePercent(SENSEVOICE_BUNDLE, 1, 0)).toBe(Math.round((SENSEVOICE_BUNDLE.files[0].bytes / total) * 100));
        // 🔴 关键：下完第 1 个文件只到 ~10%，⛔ 不是 33%（按文件数）也不是 50%
        expect(bundlePercent(SENSEVOICE_BUNDLE, 1, 0)).toBeLessThan(20);
    });

    it('单调不减，且末位封顶 100', () => {
        const a = bundlePercent(SENSEVOICE_BUNDLE, 0, 0);
        const b = bundlePercent(SENSEVOICE_BUNDLE, 1, 0);
        const c = bundlePercent(SENSEVOICE_BUNDLE, 2, 0);
        const d = bundlePercent(SENSEVOICE_BUNDLE, 3, 0);
        expect(a).toBe(0);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
        expect(d).toBe(100);
    });

    it('夹住越界输入（负字节 / 超过文件大小）', () => {
        expect(bundlePercent(SENSEVOICE_BUNDLE, 0, -999)).toBe(0);
        expect(bundlePercent(SENSEVOICE_BUNDLE, 0, 999_999_999)).toBeLessThan(100);
    });

    it('体积文案是人话', () => {
        expect(bundleSizeLabel(SENSEVOICE_BUNDLE)).toMatch(/MB$/);
    });
});

describe('pure/asrBundles 包内路径匹配', () => {
    it('通配 `*` 匹配一段目录名', () => {
        expect(innerPathMatches(SHERPA_EXE_INNER, 'sherpa-onnx-v1.12.14-win-x64-shared/bin/sherpa-onnx-offline.exe')).toBe(true);
        expect(innerPathMatches(SHERPA_EXE_INNER, 'sherpa-onnx-v2.0.1-win-x64-shared/bin/sherpa-onnx-offline.exe')).toBe(true);
    });

    it('不跨目录匹配（`*` 只吃一段）', () => {
        expect(innerPathMatches(SHERPA_EXE_INNER, 'a/b/c/bin/sherpa-onnx-offline.exe')).toBe(false);
    });

    it('文件名不对就不匹配', () => {
        expect(innerPathMatches(SHERPA_EXE_INNER, 'x/bin/sherpa-onnx.exe')).toBe(false);
    });

    it('反斜杠路径也能认（Windows 工具可能给 `\\`）', () => {
        expect(innerPathMatches(SHERPA_EXE_INNER, 'x\\bin\\sherpa-onnx-offline.exe')).toBe(true);
    });

    it('空 pattern 一律不匹配', () => {
        expect(innerPathMatches('', 'anything')).toBe(false);
    });
});

/** 造一套假依赖，记录调用顺序（⛔ 不联网、不碰真磁盘） */
function fakeDeps(overrides: Partial<InstallBundleDeps> = {}): { deps: InstallBundleDeps; log: string[]; have: Map<string, number> } {
    const have = new Map<string, number>();
    const log: string[] = [];
    const deps: InstallBundleDeps = {
        download: (target, destPath, fallbackUrl, onProgress) => {
            log.push(`download:${destPath}:${fallbackUrl ? 'with-mirror' : 'no-mirror'}`);
            onProgress?.(50, Math.round(target.bytes / 2), target.bytes);
            return {
                done: Promise.resolve().then(() => {
                    have.set(destPath, target.bytes);
                    return { ok: true, message: '', path: destPath };
                }),
                cancel: () => log.push(`cancel:${destPath}`),
            };
        },
        extractOne: (archivePath, innerPaths, outDir, stripLayers, archive) => {
            log.push(`extract:${innerPaths.join('|')}->${outDir}@${stripLayers}/${archive}`);
            for (const p of innerPaths) have.set(`${outDir}/${p.slice(p.lastIndexOf('/') + 1)}`, 2035712);
            return { ok: true, message: '' };
        },
        mkdirp: (dir) => {
            log.push(`mkdirp:${dir}`);
        },
        size: (p) => have.get(p) ?? -1,
        remove: (p) => {
            log.push(`remove:${p}`);
            have.delete(p);
        },
        join: (dir, name) => `${dir}/${name}`,
        dirname: (p) => p.slice(0, p.lastIndexOf('/')),
        ...overrides,
    };
    return { deps, log, have };
}

describe('services/asrBundleInstall 整包安装', () => {
    it('三个文件按顺序下好，压缩包解开后删掉', async () => {
        const { deps, log } = fakeDeps();
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        const r = await h.done;
        expect(r.ok).toBe(true);
        expect(log.filter((l) => l.startsWith('download:')).length).toBe(3);
        // 压缩包下到临时名，解出后删掉
        expect(log.some((l) => l.includes('.sherpa-onnx-offline.exe.archive'))).toBe(true);
        expect(log.some((l) => l.startsWith(`remove:D:/bin/.${SHERPA_EXE_NAME}.archive`))).toBe(true);
    });

    it('已就绪的文件跳过，⛔ 不重复下 228MB', async () => {
        const { deps, log, have } = fakeDeps();
        have.set('D:/bin/model.int8.onnx', 239233841);
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        await h.done;
        // 只剩 exe（压缩包）与 tokens 两个真下载；模型那个已被跳过
        const dl = log.filter((l) => l.startsWith('download:'));
        expect(dl.length).toBe(2);
        expect(dl.some((l) => l.includes('model.int8.onnx'))).toBe(false);
    });

    it('全部就绪 ⇒ 一次下载都不发（幂等）', async () => {
        const { deps, log, have } = fakeDeps();
        for (const f of SENSEVOICE_BUNDLE.files) have.set(`D:/bin/${f.fileName}`, f.bytes);
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        const r = await h.done;
        expect(r.ok).toBe(true);
        expect(log.filter((l) => l.startsWith('download:')).length).toBe(0);
    });

    it('每个文件都带上镜像地址（否则国内下不动）', async () => {
        const { deps, log } = fakeDeps();
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        await h.done;
        const dl = log.filter((l) => l.startsWith('download:'));
        for (const l of dl) expect(l).toContain('with-mirror');
    });

    it('子目录里的文件会先建父目录（Qwen3 的两个模型目录）', async () => {
        const { deps, log } = fakeDeps();
        // Qwen3 默认被 Python 前提封锁，这里解除封锁，只验目录创建逻辑本身
        const qwen = { ...bundleOf('qwen3')!, blockedReason: '' };
        const h = installBundle(deps, qwen, 'D:/bin');
        await h.done;
        expect(log).toContain(`mkdirp:D:/bin/${QWEN_ASR_DIR}`);
        expect(log).toContain(`mkdirp:D:/bin/${QWEN_ALIGN_DIR}`);
    });

    it('解压失败 ⇒ 整体失败并指出是哪个文件', async () => {
        const { deps } = fakeDeps({ extractOne: () => ({ ok: false, message: '压缩包里找不到需要的文件' }) });
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        const r = await h.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('识别程序');
        expect(r.message).toContain('找不到需要的文件');
    });

    it('下载失败 ⇒ 失败并清掉半截文件', async () => {
        const { deps, log } = fakeDeps({
            download: (_t, destPath) => ({
                done: Promise.resolve({ ok: false, message: '服务器返回 404', path: destPath }),
                cancel: () => undefined,
            }),
        });
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        const r = await h.done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('服务器返回 404');
        expect(log.some((l) => l.startsWith('remove:'))).toBe(true);
    });

    it('取消 ⇒ 标记 cancelled，且上层能区分「取消」与「失败」', async () => {
        const { deps } = fakeDeps({
            download: (_t, destPath) => ({
                done: new Promise(() => undefined), // 永远不结束，模拟长下载
                cancel: () => undefined,
            }),
        });
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin');
        h.cancel();
        const r = await h.done;
        expect(r.ok).toBe(false);
        expect(r.cancelled).toBe(true);
    });

    it('包被封锁（Qwen3 的 Python 前提）⇒ 立刻失败且带上那句人话', async () => {
        const { deps, log } = fakeDeps();
        const qwen = { ...bundleOf('qwen3')!, blockedReason: '要 Python 环境' };
        const r = await installBundle(deps, qwen, 'D:/bin').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('Python');
        expect(log.filter((l) => l.startsWith('download:')).length).toBe(0);
    });

    it('安装位置为空 ⇒ 拒绝开始（⛔ 不往奇怪的地方写）', async () => {
        const { deps, log } = fakeDeps();
        const r = await installBundle(deps, SENSEVOICE_BUNDLE, '').done;
        expect(r.ok).toBe(false);
        expect(r.message).toContain('安装位置');
        expect(log.length).toBe(0);
    });

    it('进度单调递增且最终到 100', async () => {
        const { deps } = fakeDeps();
        const seen: number[] = [];
        const h = installBundle(deps, SENSEVOICE_BUNDLE, 'D:/bin', (p) => seen.push(p));
        await h.done;
        expect(seen.length).toBeGreaterThan(0);
        for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
        expect(seen[seen.length - 1]).toBe(100);
    });
});
