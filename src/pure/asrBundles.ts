/**
 * 三家语音识别引擎各自的**安装包清单**（纯逻辑层，无 IO）。
 *
 * 🔴 为什么需要「一组文件」而不是「一个模型文件」：
 *    whisper.cpp 是单文件（一个 ggml 权重就能跑），但另外两家不是：
 *    · SenseVoice 要三样 —— sherpa-onnx 的可执行文件 + model.int8.onnx + tokens.txt；
 *    · Qwen3-ASR 要的是 Python 生态里的一整套模型目录（各自 ~1.8GB）。
 *    只下其中一个，用户点「一键装好」之后仍然跑不起来 —— 那正是本轮用户抱怨的
 *    「下载了还让我自己找剩下的框」（m05462）。
 *
 * 🔴 SenseVoice 的可执行文件在官方只以 `.tar.bz2` 提供（实测 v2.0.1 的 288 个资产**全是** tar.bz2，
 *    没有 zip），而 Node 的 zlib 不支持 bzip2。本机实测系统自带 `bsdtar 3.8.9`（带 bz2lib），
 *    且能把单个文件从 26.5MB 包里直接取出（`tar -xjf` + `--strip-components=2` + 通配包内路径）。
 *    因此这里只需要记录「包内路径」，解压交给执行层调系统 tar。
 *
 * ✅ 已实测：`sherpa-onnx-offline.exe` 是**单文件自足**的（2,035,712 字节，
 *    用干净 PATH + 干净 cwd 跑真实音频成功识别）—— 所以不必解出整个 26.5MB 包，只取这一个文件即可。
 *    ⚠️ 这个结论必须钉在测试里：某天上游改成动态链接，这里就该一起改。
 */

import type { AsrEngineId } from 'pure/asrEngines';

/** 安装包里的一个文件 */
export interface AsrBundleFile {
    /** 落盘文件名（相对引擎的安装目录） */
    fileName: string;
    /** 官方直链 */
    url: string;
    /**
     * 镜像直链。
     * 空串 = 该文件没有可用镜像（例如 GitHub Releases 的 tar 包，靠 `url` 自身即可，或另有镜像列表）。
     */
    mirrorUrl: string;
    /** 期望字节数（用于下载前告知体积 + 下完校验） */
    bytes: number;
    /**
     * 若该文件是压缩包，需要从包里取出的条目路径（支持 `*` 通配上游的版本目录名）。
     * 不填 = 下载下来的就是最终文件本身。
     */
    innerPath?: string;
    /**
     * 一次下载要取出**多个**条目时用这个（`innerPath` 的单条目形式不够用时才填）。
     *
     * 🔴 为什么需要多条目：Confucius4 的运行时是 llama.cpp 的 `llama-b12244-bin-win-cpu-x64.zip`，
     *    一个 24MB 包里有 52 个文件，我们要的 8 个（`llama-mtmd-cli.exe` + 7 个 dll）
     *    全在包的**扁平根目录**上。若按「一条目 = 一个 bundleFile」写，就得把同一个 24MB 包
     *    下载 8 遍（192MB）；按现在的写法下载一次、逐条剥出。
     * ⚠️ 与 `innerPath` 互斥；两者都填时以 `innerPaths` 为准。
     */
    innerPaths?: readonly string[];
    /**
     * 解开压缩包时剥掉的目录层数。默认 2 ——
     * sherpa 的 tar.bz2 是 `<版本目录>/bin/<exe>`，剥两层刚好剩文件名；
     * ⛔ llama.cpp 的 zip 是**扁平无目录**，必须显式写 0，否则会把文件名也剥掉、解不出东西。
     */
    stripLayers?: number;
    /**
     * 压缩包格式（决定 tar 的旗标：`tar -xjf` 解 bzip2、`tar -xf` 自动识别 zip）。
     * 默认 `'tbz'`（sherpa 的 tar.bz2）；llama.cpp 的 zip 填 `'zip'`。
     */
    archive?: 'tbz' | 'zip';
    /** 给人看的一句话说明（下载清单里逐条显示） */
    label: string;
}

/** 一个引擎的完整安装包 */
export interface AsrBundle {
    engine: AsrEngineId;
    files: readonly AsrBundleFile[];
    /**
     * 一键安装**不可用**时的人话原因（空串 = 可用）。
     * ⚠️ 不可用时仍然列出 files —— 界面要能告诉用户「还需要哪些东西、去哪拿」，
     *    而不是只留一句「不支持」。
     */
    blockedReason: string;
}

/** sherpa-onnx 的官方发布版本（⛔ 别改成 latest：资产名里带版本号，取 latest 会让文件名对不上） */
export const SHERPA_VERSION = 'v1.12.14';

/** sherpa-onnx 在 Windows x64 上的发布包（shared 版，官方只有 tar.bz2） */
export const SHERPA_WIN_ARCHIVE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/sherpa-onnx-${SHERPA_VERSION}-win-x64-shared.tar.bz2`;

/**
 * GitHub Releases 的镜像前缀（按实测速度排序）。
 * 🔴 实测数据（各抓前 2MB 断开）：`gh-proxy.com` 17.3s 最快、`ghproxy.net` 146s、`ghfast.top` 403、
 *    `ghproxy.cc` 证书过期。官方直连 87.6s 也能通，所以官方仍然先试。
 */
export const GITHUB_MIRROR_PREFIXES: readonly string[] = ['https://gh-proxy.com/', 'https://ghproxy.net/'];

/** 给一个 GitHub URL 造出镜像列表（顺序即尝试顺序，官方永远在最前） */
export function githubMirrorUrls(url: string): string[] {
    const out: string[] = [];
    for (const prefix of GITHUB_MIRROR_PREFIXES) out.push(`${prefix}${url}`);
    return out;
}

/** 包内可执行文件的条目路径（`*` 匹配上游带版本号的目录） */
export const SHERPA_EXE_INNER = '*/bin/sherpa-onnx-offline.exe';

/** 本机落盘的 sherpa 可执行文件名 */
export const SHERPA_EXE_NAME = 'sherpa-onnx-offline.exe';

/**
 * VAD 分段版的三个 exe（都在同一个 tar.bz2 里，`bin/` 下）。
 *
 * 🔴 为什么必须换 exe：`sherpa-onnx-offline.exe` 一次只吃**一整段**音频，
 *    输出是整段 JSON；它给 Paraformer 返回的 `timestamps` 是**空数组**（实测），
 *    没有时间戳就分不出字幕条。VAD 分段版会先用 silero-vad 把音频切成语音段，
 *    再逐段识别，输出天然带每段的起止时间。
 *
 * ⚠️ 两个 VAD 版**不能互换**（实测 `Invalid option --paraformer=…`）：
 *    · `vad-with-offline-asr`：认 `--paraformer` / `--sense-voice-model` / `--whisper-*`
 *    · `vad-with-online-asr`：认 `--encoder/--decoder/--joiner`（流式 transducer，X-ASR 属此类）
 */
export const SHERPA_VAD_OFFLINE_EXE_NAME = 'sherpa-onnx-vad-with-offline-asr.exe';
export const SHERPA_VAD_OFFLINE_EXE_INNER = `*/bin/${SHERPA_VAD_OFFLINE_EXE_NAME}`;
export const SHERPA_VAD_ONLINE_EXE_NAME = 'sherpa-onnx-vad-with-online-asr.exe';
export const SHERPA_VAD_ONLINE_EXE_INNER = `*/bin/${SHERPA_VAD_ONLINE_EXE_NAME}`;

/** 两个 VAD exe 的实测字节数（用于下载清单里提示体积） */
export const SHERPA_VAD_OFFLINE_EXE_BYTES = 2080768;
export const SHERPA_VAD_ONLINE_EXE_BYTES = 2115584;

/**
 * silero-vad 模型：VAD 分段版**必需**的第三个依赖（缺了直接起不来）。
 * 与引擎无关，两家 VAD 引擎（Paraformer / X-ASR）共用同一份。
 */
export const SILERO_VAD_NAME = 'silero_vad.onnx';
export const SILERO_VAD_BYTES = 643854;
export const SILERO_VAD_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';

/** 整个 sherpa 发布包的体积（从它里面剥出 exe，所以下载量按整包算） */
const SHERPA_ARCHIVE_BYTES = 26582353;

/** Paraformer 的官方仓库基址 */
const PARA_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09/resolve/main';
const PARA_MIRROR = 'https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09/resolve/main';

/** X-ASR 的官方仓库基址（权重在 `deployment/models/<chunk>` 下，⛔ 不在仓库根） */
const XASR_BASE = 'https://huggingface.co/GilgameshWind/X-ASR-zh-en/resolve/main';
const XASR_MIRROR = 'https://hf-mirror.com/GilgameshWind/X-ASR-zh-en/resolve/main';

/** Confucius4 的 GGUF 仓库基址（⚠️ 与主仓 netease-youdao/Confucius4-R2T2 是两个仓库） */
const CONF_BASE = 'https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF/resolve/main';
const CONF_MIRROR = 'https://hf-mirror.com/netease-youdao/Confucius4-R2T2-GGUF/resolve/main';


/** SenseVoice 模型的官方仓库基址 */
const SV_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main';
/** 同一仓库的国内镜像（实测直连 200，官方源在本机超时） */
const SV_MIRROR = 'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main';

/** HuggingFace 官方与国内镜像基址（实测官方在本机超时、镜像全通） */
const HF = 'https://huggingface.co';
const HF_MIRROR = 'https://hf-mirror.com';

/**
 * Qwen3-ASR 的两档（用户 m09432：「还有其他两家模型没有档位切换吗」）。
 *
 * 🔴 目录名**必须**等于上游仓库名（`Qwen3-ASR-0.6B`），因为桥接脚本那边是
 *    `load_asr_model(f"Qwen/Qwen3-ASR-{tier}")` → `os.path.join(MODELS_DIR, 'Qwen3-ASR-0.6B')`。
 *    以前这里写的是小写连字符的 `qwen3-asr-0.6B`，插件下到那儿、脚本去别处找 ⇒ 下完用不上。
 * ⚠️ 1.7B 的权重是**两片**（`model-00001-of-00002` / `-00002`）+ 一个 index，跟 0.6B 的单文件不同。
 */
export type QwenTier = '0.6B' | '1.7B';

export interface QwenAsrVariant {
    tier: QwenTier;
    /** 落盘目录名（= 上游仓库名去掉 `Qwen/` 前缀） */
    dir: string;
    /** 该档需要落盘的文件 → 实测字节数 */
    files: Record<string, number>;
}

export const QWEN_ASR_VARIANTS: readonly QwenAsrVariant[] = [
    {
        tier: '0.6B',
        dir: 'Qwen3-ASR-0.6B',
        files: {
            'config.json': 6193,
            'generation_config.json': 142,
            'merges.txt': 1671853,
            'model.safetensors': 1876091704,
            'preprocessor_config.json': 330,
            'tokenizer_config.json': 12487,
            'vocab.json': 2776833,
            'chat_template.json': 1161,
        },
    },
    {
        tier: '1.7B',
        dir: 'Qwen3-ASR-1.7B',
        files: {
            'config.json': 6194,
            'generation_config.json': 142,
            'merges.txt': 1671853,
            'model-00001-of-00002.safetensors': 4220320824,
            'model-00002-of-00002.safetensors': 478200688,
            'model.safetensors.index.json': 64821,
            'preprocessor_config.json': 330,
            'tokenizer_config.json': 12487,
            'vocab.json': 2776833,
            'chat_template.json': 1161,
        },
    },
];

/**
 * 强制对齐模型（用户 m09432：「还有对齐模型呢」）。
 *
 * 🔴 为什么必须有它：Qwen3-ASR **只出文本、不出时间轴**，没有对齐这一步就写不出带时间的 SRT。
 *    上游只发布了 0.6B 一档（实测 `Qwen3-ForcedAligner-1.7B` 不存在），所以**不跟 ASR 档位联动**。
 * ⚠️ whisper.cpp 与 SenseVoice 都不需要它：前者自带时间戳，后者的 sherpa CLI 直接返回 timestamps。
 */
export const QWEN_ALIGN: { dir: string; files: Record<string, number> } = {
    dir: 'Qwen3-ForcedAligner-0.6B',
    files: {
        'config.json': 5982,
        'generation_config.json': 115,
        'merges.txt': 1671853,
        'model.safetensors': 1835544544,
        'preprocessor_config.json': 330,
        'tokenizer_config.json': 12666,
        'vocab.json': 2776833,
        'chat_template.json': 1161,
    },
};

/** 兼容旧引用：默认档目录名 */
export const QWEN_ASR_DIR = QWEN_ASR_VARIANTS[0].dir;
export const QWEN_ALIGN_DIR = QWEN_ALIGN.dir;

/**
 * SenseVoice 的两档（用户 m09432：「还有其他两家模型没有档位切换吗」）。
 * 同一个仓库里就有两个 onnx：int8 量化版 228MB、fp32 原版 894MB —— 体积差 4 倍、精度略不同。
 */
export type SvVariant = 'int8' | 'fp32';

export interface SenseVoiceVariant {
    variant: SvVariant;
    /** 界面标题（用户要求「按它的原始模型档位名标表示」⇒ 就是量化名） */
    title: string;
    /** 落盘的模型文件名 */
    modelFile: string;
    bytes: number;
    /** 一句话说明（界面副标题） */
    note: string;
}

export const SENSEVOICE_VARIANTS: readonly SenseVoiceVariant[] = [
    {
        variant: 'int8',
        title: 'int8',
        modelFile: 'model.int8.onnx',
        bytes: 239233841,
        note: '量化版，小 4 倍，几乎无感',
    },
    {
        variant: 'fp32',
        title: 'fp32',
        modelFile: 'model.onnx',
        bytes: 937617178,
        note: '原版，精度最高，占内存',
    },
];

/** 把 variant 字符串归一到合法值（认不出回落 int8 —— 它是默认档） */
export function normalizeSvVariant(raw: string | undefined): SvVariant {
    return String(raw ?? '').trim() === 'fp32' ? 'fp32' : 'int8';
}

/** 把 tier 字符串归一到合法值（认不出回落 0.6B） */
export function normalizeQwenTier(raw: string | undefined): QwenTier {
    return String(raw ?? '').trim() === '1.7B' ? '1.7B' : '0.6B';
}

/** 取某档 Qwen3-ASR 的变体定义 */
export function qwenVariantOf(tier: string | undefined): QwenAsrVariant {
    const t = normalizeQwenTier(tier);
    return QWEN_ASR_VARIANTS.find((v) => v.tier === t) ?? QWEN_ASR_VARIANTS[0];
}

/** 取某档 SenseVoice 的变体定义 */
export function svVariantOf(variant: string | undefined): SenseVoiceVariant {
    const v = normalizeSvVariant(variant);
    return SENSEVOICE_VARIANTS.find((x) => x.variant === v) ?? SENSEVOICE_VARIANTS[0];
}

/** SenseVoice 安装包：exe（从 tar.bz2 里取）+ 该档模型 + 词表 */
export function senseVoiceBundle(variant: string | undefined): AsrBundle {
    const v = svVariantOf(variant);
    return {
        engine: 'sensevoice',
        files: [
            {
                fileName: SHERPA_EXE_NAME,
                url: SHERPA_WIN_ARCHIVE,
                mirrorUrl: githubMirrorUrls(SHERPA_WIN_ARCHIVE)[0] ?? '',
                bytes: 26582353,
                innerPath: SHERPA_EXE_INNER,
                label: '识别程序',
            },
            {
                fileName: v.modelFile,
                url: `${SV_BASE}/${v.modelFile}`,
                mirrorUrl: `${SV_MIRROR}/${v.modelFile}`,
                bytes: v.bytes,
                label: `中文识别模型 · ${v.title}`,
            },
            {
                fileName: 'tokens.txt',
                url: `${SV_BASE}/tokens.txt`,
                mirrorUrl: `${SV_MIRROR}/tokens.txt`,
                bytes: 315894,
                label: '词表',
            },
        ],
        blockedReason: '',
    };
}

/**
 * Qwen3 安装包：ASR 目录（按档位）+ 对齐模型目录（固定 0.6B）。
 *
 * 🔴 对齐模型**永远**在清单里，不跟着档位变 —— 它上游只有 0.6B 一档，
 *    而且没有它就无法生成时间轴（见 `QWEN_ALIGN` 的说明）。
 */
export function qwenBundle(tier: string | undefined): AsrBundle {
    const v = qwenVariantOf(tier);
    const filesOf = (repo: string, dir: string, bytes: Record<string, number>, kind: string): AsrBundleFile[] =>
        Object.keys(bytes).map((name) => ({
            fileName: `${dir}/${name}`,
            url: `${HF}/${repo}/resolve/main/${name}`,
            mirrorUrl: `${HF_MIRROR}/${repo}/resolve/main/${name}`,
            bytes: bytes[name] ?? 0,
            label: `${kind} · ${name}`,
        }));
    return {
        engine: 'qwen3',
        files: [
            ...filesOf(`Qwen/${v.dir}`, v.dir, v.files, `识别模型(${v.tier})`),
            ...filesOf(`Qwen/${QWEN_ALIGN.dir}`, QWEN_ALIGN.dir, QWEN_ALIGN.files, '对齐模型'),
        ],
        // ⚠️ 模型能自动下，但**跑起来还需要 Python 生态**（torch + qwen 包，数 GB 且与显卡驱动相关）。
        //    不给用户这个预期，下完几 GB 发现还要装 Python 才是真的坑。
        blockedReason:
            'Qwen3-ASR 要一套 Python 环境（torch 等，体积数 GB 且与显卡相关），插件无法替你装。可以在下面的「高级配置」里填好 Python 解释器与桥接脚本，再来这里下载模型。',
    };
}

/** 默认档（int8 / 0.6B）的常量形式，保留给只关心默认包的地方与测试 */
export const SENSEVOICE_BUNDLE: AsrBundle = senseVoiceBundle('int8');
export const QWEN_BUNDLE: AsrBundle = qwenBundle('0.6B');

/**
 * Paraformer 的两档（用户表格：int8 237MB / fp32 880MB）。
 *
 * ⚠️ 上游 `csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09` 仓库根目录同时给了
 *    `model.int8.onnx`（227330205 实测）与 `model.onnx`（822641426 实测），
 *    另外还有 `am.mvn` / `config.yaml` / `tokens.json` / 若干 .py 脚本 ——
 *    真正跑起来只需要「模型 + tokens.txt」，其余是训练/量化脚本，⛔ 不要塞进安装清单。
 */
export type ParaVariant = 'int8' | 'fp32';

export interface ParaformerVariant {
    variant: ParaVariant;
    title: string;
    modelFile: string;
    bytes: number;
    note: string;
}

export const PARAFORMER_VARIANTS: readonly ParaformerVariant[] = [
    {
        variant: 'int8',
        title: 'int8',
        modelFile: 'model.int8.onnx',
        bytes: 227330205,
        note: '量化版，体积 1/3.6，中文几乎无感',
    },
    {
        variant: 'fp32',
        title: 'fp32',
        modelFile: 'model.onnx',
        bytes: 822641426,
        note: '原版，精度基准',
    },
];

/** Paraformer 的词表（与模型同仓库，两档共用） */
const PARA_TOKENS_BYTES = 75354;

/** 把 variant 字符串归一到合法值（认不出回落 int8） */
export function normalizeParaVariant(raw: string | undefined): ParaVariant {
    return String(raw ?? '').trim() === 'fp32' ? 'fp32' : 'int8';
}

/** 取某档 Paraformer 的变体定义 */
export function paraVariantOf(variant: string | undefined): ParaformerVariant {
    const v = normalizeParaVariant(variant);
    return PARAFORMER_VARIANTS.find((x) => x.variant === v) ?? PARAFORMER_VARIANTS[0];
}

/**
 * Paraformer 安装包：VAD 分段 exe + silero-vad + 该档模型 + 词表。
 *
 * 🔴 为什么用 `vad-with-offline-asr` 而不是 `sherpa-onnx-offline`：
 *    实测 offline 版喂 `--paraformer` 返回 `"timestamps": []` —— 只有一整段文字，
 *    没法切成字幕条。VAD 分段版输出 `0.134 -- 0.940: text`，天然带时间轴。
 */
export function paraformerBundle(variant: string | undefined): AsrBundle {
    const v = paraVariantOf(variant);
    return {
        engine: 'paraformer',
        files: [
            {
                fileName: SHERPA_VAD_OFFLINE_EXE_NAME,
                url: SHERPA_WIN_ARCHIVE,
                mirrorUrl: githubMirrorUrls(SHERPA_WIN_ARCHIVE)[0] ?? '',
                bytes: SHERPA_ARCHIVE_BYTES,
                innerPath: SHERPA_VAD_OFFLINE_EXE_INNER,
                label: '识别程序',
            },
            {
                fileName: SILERO_VAD_NAME,
                url: SILERO_VAD_URL,
                mirrorUrl: githubMirrorUrls(SILERO_VAD_URL)[0] ?? '',
                bytes: SILERO_VAD_BYTES,
                label: '断句模型',
            },
            {
                fileName: v.modelFile,
                url: `${PARA_BASE}/${v.modelFile}`,
                mirrorUrl: `${PARA_MIRROR}/${v.modelFile}`,
                bytes: v.bytes,
                label: `中文识别模型 · ${v.title}`,
            },
            {
                fileName: 'tokens.txt',
                url: `${PARA_BASE}/tokens.txt`,
                mirrorUrl: `${PARA_MIRROR}/tokens.txt`,
                bytes: PARA_TOKENS_BYTES,
                label: '词表',
            },
        ],
        blockedReason: '',
    };
}

/**
 * X-ASR 的四档 chunk（160 / 480 / 960 / 1920 毫秒）。
 *
 * 🔴 用户表格写的是「Q4_K 93MB / F16 310MB」——**上游没有 GGUF**，实测 HF 上只有 ONNX。
 *    真实体积以这里为准（四档合计约 614.6MB，每档 encoder 都在 593MB 上下）。
 *    ⚠️ 这个差异必须让用户看见（`formatBundleBytes` 算出来的就是真体积），
 *    ⛔ 不要为了对上表格而虚报字节数 —— 下载器按这个数校验完整性，填错就直接装不上。
 *
 * 📌 四档的取舍：chunk 越小响应越快、越大越准。默认 1920ms（表格里「全精度」那一档）。
 */
export type XasrChunk = '160' | '480' | '960' | '1920';

export interface XasrVariant {
    chunk: XasrChunk;
    /** 界面标题 */
    title: string;
    /** 上游子目录名 */
    dir: string;
    encoderBytes: number;
    note: string;
}

export const XASR_VARIANTS: readonly XasrVariant[] = [
    { chunk: '160', title: '160ms 分块', dir: 'chunk-160ms-model', encoderBytes: 592967053, note: '延迟最低，适合实时字幕' },
    { chunk: '480', title: '480ms 分块', dir: 'chunk-480ms-model', encoderBytes: 592968361, note: '低延迟与精度的折中' },
    { chunk: '960', title: '960ms 分块', dir: 'chunk-960ms-model', encoderBytes: 592966960, note: '更稳的长句断句' },
    { chunk: '1920', title: '1920ms 分块', dir: 'chunk-1920ms-model', encoderBytes: 592958528, note: '全精度，默认档' },
];

/** X-ASR 三件套里除 encoder 外的固定字节（四档实测完全一致） */
const XASR_DECODER_BYTES = 11309084;
const XASR_JOINER_BYTES = 10260467;
const XASR_TOKENS_BYTES = 58806;

/** 把 chunk 字符串归一到合法值（认不出回落 1920 —— 默认档） */
export function normalizeXasrChunk(raw: string | undefined): XasrChunk {
    const s = String(raw ?? '').trim();
    const hit = XASR_VARIANTS.find((v) => v.chunk === s);
    return hit ? hit.chunk : '1920';
}

/** 取某档 X-ASR 的变体定义 */
export function xasrVariantOf(chunk: string | undefined): XasrVariant {
    const c = normalizeXasrChunk(chunk);
    return XASR_VARIANTS.find((v) => v.chunk === c) ?? XASR_VARIANTS[3];
}

/**
 * X-ASR 安装包：VAD 在线 exe + silero-vad + encoder/decoder/joiner + 词表。
 *
 * 🔴 必须用 `vad-with-online-asr` 这个 exe：X-ASR 是**流式** zipformer transducer，
 *    拿 `sherpa-onnx-offline.exe` 喂它会在打印 `Started` 之后直接崩（实测 exit 0xC0000409）。
 */
export function xasrBundle(chunk: string | undefined): AsrBundle {
    const v = xasrVariantOf(chunk);
    const dir = `deployment/models/${v.dir}`;
    return {
        engine: 'xasr',
        files: [
            {
                fileName: SHERPA_VAD_ONLINE_EXE_NAME,
                url: SHERPA_WIN_ARCHIVE,
                mirrorUrl: githubMirrorUrls(SHERPA_WIN_ARCHIVE)[0] ?? '',
                bytes: SHERPA_ARCHIVE_BYTES,
                innerPath: SHERPA_VAD_ONLINE_EXE_INNER,
                label: '识别程序',
            },
            {
                fileName: SILERO_VAD_NAME,
                url: SILERO_VAD_URL,
                mirrorUrl: githubMirrorUrls(SILERO_VAD_URL)[0] ?? '',
                bytes: SILERO_VAD_BYTES,
                label: '断句模型',
            },
            {
                fileName: `encoder-${v.chunk}ms.onnx`,
                url: `${XASR_BASE}/${dir}/encoder-${v.chunk}ms.onnx`,
                mirrorUrl: `${XASR_MIRROR}/${dir}/encoder-${v.chunk}ms.onnx`,
                bytes: v.encoderBytes,
                label: `识别模型 · encoder(${v.chunk}ms)`,
            },
            {
                fileName: `decoder-${v.chunk}ms.onnx`,
                url: `${XASR_BASE}/${dir}/decoder-${v.chunk}ms.onnx`,
                mirrorUrl: `${XASR_MIRROR}/${dir}/decoder-${v.chunk}ms.onnx`,
                bytes: XASR_DECODER_BYTES,
                label: `识别模型 · decoder(${v.chunk}ms)`,
            },
            {
                fileName: `joiner-${v.chunk}ms.onnx`,
                url: `${XASR_BASE}/${dir}/joiner-${v.chunk}ms.onnx`,
                mirrorUrl: `${XASR_MIRROR}/${dir}/joiner-${v.chunk}ms.onnx`,
                bytes: XASR_JOINER_BYTES,
                label: `识别模型 · joiner(${v.chunk}ms)`,
            },
            {
                fileName: 'tokens.txt',
                url: `${XASR_BASE}/${dir}/tokens.txt`,
                mirrorUrl: `${XASR_MIRROR}/${dir}/tokens.txt`,
                bytes: XASR_TOKENS_BYTES,
                label: '词表',
            },
        ],
        blockedReason: '',
    };
}

/**
 * Confucius4 的两档 GGUF（用户表格：Q4_K_M 1.0GB / F16 3.2GB）。
 *
 * 🔴 权重在**独立仓库** `netease-youdao/Confucius4-R2T2-GGUF`，
 *    主仓 `netease-youdao/Confucius4-R2T2` 只有 transformers 的 safetensors（4GB，插件跑不了）。
 * ⚠️ 每档要**两个**文件：语言模型 + mmproj（音频投影器）。少 mmproj 直接起不来。
 */
export type ConfuciusTier = 'Q4_K_M' | 'F16';

export interface ConfuciusVariant {
    tier: ConfuciusTier;
    title: string;
    modelFile: string;
    modelBytes: number;
    mmprojFile: string;
    mmprojBytes: number;
    note: string;
}

export const CONFUCIUS_VARIANTS: readonly ConfuciusVariant[] = [
    {
        tier: 'Q4_K_M',
        title: 'Q4_K_M',
        modelFile: 'Confucius4-R2T2-Q4_K_M.gguf',
        modelBytes: 1107404736,
        mmprojFile: 'mmproj-Confucius4-R2T2-Q8_0.gguf',
        mmprojBytes: 348336544,
        note: '量化版，体积 1/3，日常够用',
    },
    {
        tier: 'F16',
        title: 'F16',
        modelFile: 'Confucius4-R2T2-f16.gguf',
        modelBytes: 3447345088,
        mmprojFile: 'mmproj-Confucius4-R2T2-f16.gguf',
        mmprojBytes: 641773984,
        note: '全精度，效果最好，占内存',
    },
];

/** 把 tier 字符串归一到合法值（认不出回落 Q4_K_M） */
export function normalizeConfuciusTier(raw: string | undefined): ConfuciusTier {
    return String(raw ?? '').trim().toUpperCase() === 'F16' ? 'F16' : 'Q4_K_M';
}

/** 取某档 Confucius4 的变体定义 */
export function confuciusVariantOf(tier: string | undefined): ConfuciusVariant {
    const t = normalizeConfuciusTier(tier);
    return CONFUCIUS_VARIANTS.find((v) => v.tier === t) ?? CONFUCIUS_VARIANTS[0];
}

/**
 * llama.cpp 的 Windows CPU 发布包（Confucius4 的运行时）。
 *
 * 🔴 为什么要连运行时一起下：Confucius4 的官方 Python 路线（`r2t2_llama`）在 PyPI 上是 404，
 *    预编译库是 Linux x86_64 + CUDA + CPython 3.12 的 `.so`，Windows 上根本用不了。
 *    而 `llama-mtmd-cli.exe` 直接吃 `--audio` + `--mmproj`，实测在 Windows CPU 上就能出结果。
 * ⛔ 别只取 `llama-mtmd-cli.exe` 一个文件 —— 实测单文件跑起来 stdout/stderr 全空（缺 dll 静默失败）。
 */
export const LLAMA_CPP_BUILD = 'b12244';
export const LLAMA_CPP_ZIP_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}/llama-${LLAMA_CPP_BUILD}-bin-win-cpu-x64.zip`;
export const LLAMA_CPP_ZIP_BYTES = 24930349;

/**
 * 从 llama.cpp 的 zip 里要剥出的**最小可运行集**（实测 8 个文件能跑通）。
 *
 * ⚠️ zip 内是**扁平结构**（52 个条目、无目录前缀），所以 `stripLayers` 必须为 0，
 *    否则会把文件名本身剥掉、解出空目录。
 * ⚠️ `ggml-cpu-*.dll` 在包里另有 12 个针对具体指令集的变体，只需通用的 `x64` 那个 ——
 *    带全套会多出 20MB 无用文件。
 */
export const LLAMA_RUNTIME_FILES: readonly { name: string; bytes: number }[] = [
    { name: 'llama-mtmd-cli.exe', bytes: 97792 },
    { name: 'llama.dll', bytes: 3881472 },
    { name: 'ggml.dll', bytes: 78848 },
    { name: 'ggml-base.dll', bytes: 834560 },
    { name: 'mtmd.dll', bytes: 2241024 },
    { name: 'llama-common.dll', bytes: 8393728 },
    { name: 'libomp.dll', bytes: 768000 },
    { name: 'ggml-cpu-x64.dll', bytes: 932352 },
];

/** 最小可运行集合计字节（实测 17227776） */
export const LLAMA_RUNTIME_BYTES = LLAMA_RUNTIME_FILES.reduce((n, f) => n + f.bytes, 0);

/**
 * Confucius4 安装包：llama.cpp 运行时（一次下载剥 8 个文件）+ 该档模型 + mmproj。
 *
 * 🔴 运行时用一个 `bundleFile` 描述、靠 `innerPaths` 剥出 8 个文件：
 *    若按「一文件一条目」写，同一个 24MB 包会被下 8 遍。下载器看到 `innerPaths` 就只下一次。
 *    ⚠️ 这一条的 `fileName` 用 `llama-mtmd-cli.exe` 作为**代表文件名**（幂等判断只看它是否就位），
 *    其余 7 个文件由 `innerPaths` 一起剥出。
 */
export function confuciusBundle(tier: string | undefined): AsrBundle {
    const v = confuciusVariantOf(tier);
    return {
        engine: 'confucius',
        files: [
            {
                fileName: 'llama-mtmd-cli.exe',
                url: LLAMA_CPP_ZIP_URL,
                mirrorUrl: githubMirrorUrls(LLAMA_CPP_ZIP_URL)[0] ?? '',
                bytes: LLAMA_CPP_ZIP_BYTES,
                innerPaths: LLAMA_RUNTIME_FILES.map((f) => f.name),
                stripLayers: 0,
                archive: 'zip',
                label: '识别程序',
            },
            {
                fileName: v.modelFile,
                url: `${CONF_BASE}/${v.modelFile}`,
                mirrorUrl: `${CONF_MIRROR}/${v.modelFile}`,
                bytes: v.modelBytes,
                label: `识别模型 · ${v.title}`,
            },
            {
                fileName: v.mmprojFile,
                url: `${CONF_BASE}/${v.mmprojFile}`,
                mirrorUrl: `${CONF_MIRROR}/${v.mmprojFile}`,
                bytes: v.mmprojBytes,
                label: `听觉投影器 · ${v.title}`,
            },
        ],
        // 运行时我们代下，但**改配置**（线程数、上下文长度）需要用户自己在右侧面板填。
        blockedReason: '',
    };
}


/** 取某个引擎的安装包（whisper 是单文件多档，走 `ASR_MODEL_PRESETS`，这里返回 `null`） */
export function bundleOf(
    engine: AsrEngineId,
    opts?: {
        qwenTier?: string;
        svVariant?: string;
        paraVariant?: string;
        xasrChunk?: string;
        confuciusTier?: string;
    },
): AsrBundle | null {
    if (engine === 'sensevoice') return senseVoiceBundle(opts?.svVariant);
    if (engine === 'qwen3') return qwenBundle(opts?.qwenTier);
    if (engine === 'paraformer') return paraformerBundle(opts?.paraVariant);
    if (engine === 'xasr') return xasrBundle(opts?.xasrChunk);
    if (engine === 'confucius') return confuciusBundle(opts?.confuciusTier);
    return null;
}

/** 安装包总字节 */
export function bundleBytes(bundle: AsrBundle): number {
    let n = 0;
    for (const f of bundle.files) n += f.bytes;
    return n;
}

/** 安装包体积文案（`243MB`） */
export function bundleSizeLabel(bundle: AsrBundle): string {
    return formatBundleBytes(bundleBytes(bundle));
}

/** 与 `pure/asrModels.formatBytes` 同一套口径（这里独立一份是为了不让两个模块互相 import 成环） */
export function formatBundleBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知';
    if (bytes < 1024) return `${Math.round(bytes)}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    const mb = bytes / 1024 / 1024;
    return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}

/**
 * 整个包的下载进度（0..100 取整）。
 *
 * 🔴 语义是「按**字节**加权的总进度」，不是「已完成文件数 / 总文件数」：
 *    SenseVoice 三个文件是 25MB + 228MB + 0.3MB，按文件数算会在下完那个 0.3MB 词表后
 *    从 66% 直接跳到 100%，中间的 228MB 反而一动不动 —— 用户会以为卡死。
 *
 * @param fileIndex 当前正在下第几个文件（0 基）
 * @param fileReceived 当前文件已收字节
 */
export function bundlePercent(bundle: AsrBundle, fileIndex: number, fileReceived: number): number {
    const total = bundleBytes(bundle);
    if (total <= 0) return 0;
    let done = 0;
    for (let i = 0; i < bundle.files.length && i < fileIndex; i += 1) done += bundle.files[i].bytes;
    const cur = Math.max(0, Math.min(fileReceived, bundle.files[fileIndex]?.bytes ?? 0));
    const pct = Math.round(((done + cur) / total) * 100);
    if (!Number.isFinite(pct)) return 0;
    return Math.max(0, Math.min(100, pct));
}

/**
 * 解压 / 下载的**阶段文案**。
 * ⚠️ 用户要求「界面不出现技术黑话」⇒ 这里只说人话，⛔ 不写 tar.bz2 / exe 之类。
 */
export function bundleFileLabel(bundle: AsrBundle, index: number): string {
    const f = bundle.files[index];
    if (!f) return '';
    return `正在下载${f.label}…`;
}

/** 包内条目路径是否匹配一个具体的包内文件名（支持 `*` 通配一段目录） */
export function innerPathMatches(pattern: string, entryName: string): boolean {
    if (!pattern) return false;
    const norm = (s: string): string => s.replace(/\\/g, '/').replace(/^\.\//, '');
    const p = norm(pattern);
    const e = norm(entryName);
    if (!p.includes('*')) return p === e;
    // 只支持「一段 `*`」的简单通配：把 `*` 换成 `[^/]+` 后整体锚定
    const re = new RegExp(`^${p.split('*').map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
    return re.test(e);
}
