/**
 * **安装清单**：把「点一下按钮到底会装哪几样东西」变成可枚举的数据。
 *
 * 🔴 用户 m09123 原文：「这个一键装好和补环境具体是装什么东西，应该如果用户点击此行为就
 *    弹窗显示要装的项按序号来每完成一项就打勾」
 *
 *    用户的质疑完全成立 —— 之前的实现里，「一键装好」只是把按钮文字换成「正在安装…」
 *    再在旁边滚一行百分比，用户看不见：装几样、每样多大、装到第几样了、还差什么。
 *    228MB 的模型和 0.3MB 的词表在同一个「33%」里，谁都会怀疑它卡住了。
 *
 * 所以本模块只干一件事：**把安装动作展开成一张带序号的清单**。
 * 弹窗（`AsrInstallModal`）按这张表逐项打勾，执行层（`installBundle` / `installWhisperRuntime`）
 * 的进度回调负责告诉弹窗「现在到第几项、这一项到百分之几」。
 *
 * ⚠️ 纯逻辑，不碰 fs / 不碰 Obsidian API —— 这样单测能在无网络无 Node 的环境里钉住它。
 */

import { bundleOf, type AsrBundle } from 'pure/asrBundles';
import { ASR_MODEL_PRESETS, formatBytes, presetOf, type AsrModelPreset, type AsrModelTier } from 'pure/asrModels';
import { WHISPER_RUNTIME_FILES, WHISPER_RUNTIME_EXE, WHISPER_RUNTIME_ZIP_BYTES } from 'pure/whisperRuntime';
import { ASR_ENGINE_IDS, type AsrEngineId } from 'pure/asrEngines';

/** 清单里的一项 */
export interface AsrInstallItem {
    /** 界面上的序号（从 1 开始；`display` 直接用它） */
    index: number;
    /** 这一项叫什么（人话，不是文件名） */
    title: string;
    /** 体积文案，未知时为空串 */
    size: string;
    /** 明细（文件名 / 说明），弹窗里用弱色小字显示 */
    detail: string;
    /**
     * 这一项**落在哪个目录**（绝对路径；调用方没给就是空串）。
     *
     * 🔴 用户 m01935 原文：「点击一键安装时必须弹窗告知用户一键安装模型及配置器的
     *    所有路径待用户选择确认或自定义路径后才能安装」。
     *    ⇒ 路径不再是「装完才知道的副作用」，而是**开工前摊在桌面上的账单**。
     *    所以它必须挂在清单项上，与「第几项、多大」同源，⛔ 别在弹窗里另算一遍。
     */
    dir: string;
    /**
     * 这一项会落下的**文件名**（只读展示；从压缩包里剥出来的多项就列多个）。
     *
     * ⚠️ 只给名字不给全路径：全路径由 `joinInstallPath(dir, name)` 现拼。
     *    这样用户在弹窗里改了目录，文件清单不用重算，一行 `dir` 变了整列跟着变。
     */
    files: readonly string[];
}

/** 一次安装用到的两个落点（whisper 是唯一需要两个的：程序在 bin、模型在 models/whisper） */
export interface AsrInstallDirs {
    /** 模型 / 权重 / 词表的落点（六家都有） */
    engineDir: string;
    /** 识别程序的落点（whisper 用 `~/.reelludic/bin`；其余五家与 `engineDir` 相同） */
    binDir: string;
}

/**
 * 拼一个落点全路径。
 *
 * ⚠️ 纯模块里 **不 import `path`**（`pure/asrLayout` 也守着同一条规矩：纯逻辑要能在
 *    无 Node 的测试环境里跑）。这里按目录里已有的分隔符风格拼，Windows 路径原样保留下反斜杠。
 */
export function joinInstallPath(dir: string, name: string): string {
    const d = String(dir ?? '').trim();
    if (!d) return '';
    const n = String(name ?? '').trim();
    if (!n) return d;
    const sep = d.includes('\\') ? '\\' : '/';
    const head = d.replace(/[\\/]+$/, '');
    return `${head}${sep}${n}`;
}

/**
 * 从 bundle 条目推出「这一项真正落哪几个文件」。
 *
 * 🔴 三种取包方式落盘的文件数**不同**，弹窗要如实列，否则用户会以为漏装：
 *    · `innerPaths`（llama.cpp 运行时）—— 一个 24MB 包剥出**8 个**文件
 *    · `innerPath`（sherpa 的 exe）—— 一个 26MB 包剥出**1 个**文件
 *    · 都没有 —— 原文件直接落盘
 */
function landedFiles(fileName: string, innerPath?: string, innerPaths?: readonly string[]): string[] {
    const base = (raw: string): string => {
        const s = String(raw ?? '');
        const cut = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        return cut >= 0 ? s.slice(cut + 1) : s;
    };
    if (innerPaths && innerPaths.length > 0) {
        const names = innerPaths.map(base).filter((n) => n.length > 0);
        return names.length > 0 ? names : [fileName];
    }
    if (innerPath) {
        const one = base(innerPath);
        return [one || fileName];
    }
    return [fileName];
}

/** 一次安装的完整清单 */
export interface AsrInstallPlan {
    /** 弹窗标题 */
    title: string;
    /** 一句话说明这次要做什么 */
    note: string;
    items: readonly AsrInstallItem[];
    /** 非空表示这次装不了，弹窗只显示原因、不给「开始」按钮 */
    blockedReason: string;
}

/** whisper 的「程序」这一项在清单里的固定序号（`installWhisperRuntime` 只有一步） */
export const WHISPER_RUNTIME_ITEM_TITLE = '转写程序（whisper.cpp）';

/** 各家的弹窗标题与说明（人话，⛔ 不写文件名堆砌） */
const PLAN_TITLES: Record<AsrEngineId, { title: string; note: string }> = {
    whisper: { title: '安装 Whisper.cpp', note: '' },
    qwen3: {
        title: '安装 Qwen3-ASR',
        note: '要装两套模型：识别模型出文字，对齐模型出时间轴。两套都下完才能用。',
    },
    sensevoice: {
        title: '安装 SenseVoice',
        note: '要装三样：识别程序、中文识别模型、词表。少任何一样都会在转写那一刻才报错。',
    },
    paraformer: {
        title: '安装 Paraformer',
        note: '要装四样：断句程序、语音活动检测模型、中文识别模型、词表。它自带字级时间戳，中文生产场景的主力。',
    },
    xasr: {
        title: '安装 X-ASR',
        note: '要装六样：流式识别程序、语音活动检测模型、以及编码器 / 解码器 / 连接器三个权重和词表。三个权重必须同档配套，混用会直接崩。',
    },
    confucius: {
        title: '安装 Confucius4',
        note: '要装三样：llama.cpp 推理运行时（取其中必需的 8 个文件）、语言模型、投影器。投影器不下会直接拒绝运行。',
    },
};

/** 把 `AsrBundle` 的文件列表转成清单项（按 bundle 里的顺序，⛔ 不重排） */
function itemsFromBundle(bundle: AsrBundle, dirs: AsrInstallDirs): AsrInstallItem[] {
    return bundle.files.map((f, i) => {
        // 🔴 三种取包方式要分别说明，否则用户会疑惑「清单写 24MB、落盘只有一个 exe」
        //    · innerPath      —— 从压缩包里取出**一个**文件
        //    · innerPaths     —— 从压缩包里取出**多个**文件（llama.cpp 的运行时就是这种）
        //    · 都没有         —— 直接下原文件
        let detail: string;
        if (f.innerPaths && f.innerPaths.length > 0) {
            detail = `${f.fileName}（从官方压缩包里取出必需的 ${f.innerPaths.length} 个文件）`;
        } else if (f.innerPath) {
            detail = `${f.fileName}（从官方压缩包里取出，只留这一个文件）`;
        } else {
            detail = f.fileName;
        }
        return {
            index: i + 1,
            title: f.label,
            size: f.bytes > 0 ? formatBytes(f.bytes) : '',
            detail,
            // 全部落进该引擎自己的目录（exe / 权重 / 词表放在一起，与 `asrEnginePaths` 同源）
            dir: dirs.engineDir,
            files: landedFiles(f.fileName, f.innerPath, f.innerPaths),
        };
    });
}

/**
 * 造出某一家引擎的安装清单。
 *
 * @param engine 引擎 id（六家之一）
 * @param tier   whisper 专用：要装哪一档（其余五家忽略此参数）
 * @param variant 其余五家的档位（Qwen3 的 `0.6B`/`1.7B`、SenseVoice 的 `int8`/`fp32`、
 *                Paraformer 的 `int8`/`fp32`、X-ASR 的 `160`/`480`/`960`/`1920`、
 *                Confucius4 的 `Q4_K_M`/`F16`）。
 *                不传就是默认档 —— 但**必须**传，否则用户在下拉里选了 1.7B、
 *                弹窗却按 0.6B 的体积和文件列清单，装完还是用不上。
 */
export function asrInstallPlan(
    engine: string,
    tier?: AsrModelTier,
    variant?: {
        qwenTier?: string;
        svVariant?: string;
        paraVariant?: string;
        xasrChunk?: string;
        confuciusTier?: string;
    },
    /**
     * 这次要装到哪。
     *
     * 🔴 用户 m01935：安装前必须把**所有路径**摊给用户确认，所以目录必须**从外面传进来**
     *    （用户在弹窗里改过就用改后的），⛔ 别在纯逻辑里 `require('os').homedir()` 现算 ——
     *    那样弹窗显示的和真正落盘的会变成两处各算一遍，改了目录装到别处也没人发现。
     * 省略时目录为空串 ⇒ 弹窗只显示文件名、不显示目录，且不允许开工（调用方会拦）。
     */
    dirs?: AsrInstallDirs,
): AsrInstallPlan {
    // 🔴 id 归一必须走真源表，⛔ 别再写成「只认 qwen3/sensevoice，其余一律 whisper」——
    //    那样新增的三家会被静默按 whisper 的清单去装（装完自然跑不起来）。
    const id: AsrEngineId = (ASR_ENGINE_IDS as readonly string[]).includes(engine)
        ? (engine as AsrEngineId)
        : 'whisper';
    const where: AsrInstallDirs = {
        engineDir: String(dirs?.engineDir ?? '').trim(),
        binDir: String(dirs?.binDir ?? '').trim(),
    };

    if (id === 'whisper') {
        const preset: AsrModelPreset = (tier ? presetOf(tier) : null) ?? ASR_MODEL_PRESETS[1];
        return {
            title: '安装 Whisper.cpp',
            note: `要装两样：跑模型用的程序，以及 ${preset.title} 档的模型文件本身。程序只装一次，换档位时只下模型。`,
            items: [
                {
                    index: 1,
                    title: WHISPER_RUNTIME_ITEM_TITLE,
                    size: formatBytes(WHISPER_RUNTIME_ZIP_BYTES),
                    detail: `官方发布包，取其中必需的 ${WHISPER_RUNTIME_FILES.length} 个文件（${WHISPER_RUNTIME_EXE} 等）`,
                    // ⚠️ whisper 是唯一「程序与模型不同目录」的一家：程序进 bin、模型进 models/whisper。
                    //    ⛔ 别为了整齐把两者并成一个目录 —— `asrLocate.commonInstallDirs` 认的
                    //    就是 `~/.reelludic/bin`，装到别处会「装成功了但还是红的」。
                    dir: where.binDir,
                    files: WHISPER_RUNTIME_FILES,
                },
                {
                    index: 2,
                    title: `模型文件 ${preset.title}`,
                    size: formatBytes(preset.bytes),
                    detail: `${preset.fileName} · ${preset.subtitle}`,
                    dir: where.engineDir,
                    files: [preset.fileName],
                },
            ],
            blockedReason: '',
        };
    }

    const bundle = bundleOf(id, variant);
    if (!bundle) {
        return {
            title: '安装',
            note: '',
            items: [],
            blockedReason: '这一家不需要单独安装。',
        };
    }
    const meta = PLAN_TITLES[id];
    return {
        title: meta.title,
        note: meta.note,
        items: itemsFromBundle(bundle, where),
        blockedReason: bundle.blockedReason,
    };
}

/**
 * 这一家安装时需要用户确认**几个**目录。
 *
 * 🔴 用户 m01935 要求「告知用户一键安装模型及配置器的所有路径」—— 所以这里要把
 *    「这次到底涉及几个目录、各是干什么的」说清楚，而不是笼统给一个「安装目录」。
 *    · whisper：两个（程序进 bin、模型进 models/whisper）
 *    · 其余五家：一个（exe / 权重 / 词表都在同一个引擎目录里）
 * ⚠️ 返回值里的 `key` 与 `AsrInstallDirs` 的字段名逐字对应，弹窗靠它回填。
 */
export function asrInstallDirFields(engine: string): readonly { key: keyof AsrInstallDirs; label: string; why: string }[] {
    const id: AsrEngineId = (ASR_ENGINE_IDS as readonly string[]).includes(engine) ? (engine as AsrEngineId) : 'whisper';
    if (id === 'whisper') {
        return [
            {
                key: 'binDir',
                label: '识别程序目录',
                why: 'whisper-cli.exe 及其 dll 放这里。必须是插件能自动找到的位置，否则装完仍是「未就绪」。',
            },
            {
                key: 'engineDir',
                label: '模型文件目录',
                why: 'ggml 模型放这里。换档位只往这个目录加文件，不重复装程序。',
            },
        ];
    }
    return [
        {
            key: 'engineDir',
            label: '安装目录',
            why: '识别程序、模型权重、词表都会放进这一个目录，装完插件会直接从它读。',
        },
    ];
}

/** 清单总字节（`blockedReason` 非空时也照样算，弹窗要显示「本来要下多少」） */
export function planTotalBytes(
    engine: string,
    tier?: AsrModelTier,
    variant?: {
        qwenTier?: string;
        svVariant?: string;
        paraVariant?: string;
        xasrChunk?: string;
        confuciusTier?: string;
    },
): number {
    const id: AsrEngineId = (ASR_ENGINE_IDS as readonly string[]).includes(engine)
        ? (engine as AsrEngineId)
        : 'whisper';
    if (id === 'whisper') {
        const preset = (tier ? presetOf(tier) : null) ?? ASR_MODEL_PRESETS[1];
        return WHISPER_RUNTIME_ZIP_BYTES + preset.bytes;
    }
    const bundle = bundleOf(id, variant);
    if (!bundle) return 0;
    return bundle.files.reduce((sum, f) => sum + Math.max(0, f.bytes), 0);
}

/**
 * 把执行层的进度映射成「第几项 + 这一项自己到百分之几」。
 *
 * 🔴 为什么需要它：执行层给的是**整包加权总进度**（`0..100`），而弹窗要显示的是
 *    「第 2 项正在下，它自己 43%」。两者的口径不同，⛔ 不能把总进度直接当单项进度画，
 *    否则第 3 项一开头就显示 66%，用户会以为三项同时在下。
 *
 * @param total   清单总项数
 * @param current 当前项下标（0 基，来自执行层的 `fileIndex`）
 * @param percent 整包总进度（0..100）
 */
export function itemProgress(total: number, current: number, percent: number): { index: number; percent: number } {
    const safeTotal = Math.max(1, Math.floor(total));
    const idx = Math.max(0, Math.min(safeTotal - 1, Math.floor(current)));
    const all = Math.max(0, Math.min(100, percent));
    // 按项数等分反推单项进度：等价于「总进度 - 已完成项占的百分比」再归一
    const step = 100 / safeTotal;
    const local = Math.max(0, Math.min(100, (all - idx * step) / step * 100));
    return { index: idx, percent: Math.round(local) };
}
