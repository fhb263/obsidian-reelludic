/**
 * 音频转文字：引擎注册表与「Python 桥接」协议解析（纯逻辑，无 obsidian / node 依赖）。
 *
 * ## 六家引擎、五种执行器
 * - `whisper`    —— whisper.cpp CLI（`whisper-cli -m xxx.bin -osrt`）。模型可自动下载。runner = `whisper`
 * - `qwen3`      —— 用户自装的 Qwen3-ASR Python 工程，经 `cli_bridge.py` 调用。runner = `python`
 * - `sensevoice` —— sherpa-onnx **vad-with-offline-asr**（`--sense-voice-model=`）。runner = `sherpa-offline`
 * - `paraformer` —— sherpa-onnx **vad-with-offline-asr**（`--paraformer=`）。runner = `sherpa-offline`
 * - `xasr`       —— sherpa-onnx **vad-with-online-asr**（streaming transducer 三件套）。runner = `sherpa-online`
 * - `confucius`  —— llama.cpp `llama-mtmd-cli.exe`（`-m … --mmproj … --audio …`）。runner = `llama-mtmd`
 *
 * ## 🔴 为什么 2026-11 这轮把 sherpa 拆成 offline / online 两个 runner（实测结论，别合并回去）
 * `sherpa-onnx-vad-with-offline-asr.exe` 与 `sherpa-onnx-vad-with-online-asr.exe` 是**两个不同二进制**，
 * 认的参数集不同：
 *   · offline 版认 `--paraformer=` / `--sense-voice-model=` / `--whisper-encoder=`
 *   · online 版**不认** `--paraformer=`（实测直接报 `Invalid option --paraformer=…` 并打印 92 行 usage），
 *     它只认流式的 `--encoder/--decoder/--joiner/--tokens` 与 `--paraformer-encoder/--paraformer-decoder`
 * ⇒ 「一个 exe 通吃」是行不通的，runner 必须能区分这两条路。
 *
 * ## 🔴 为什么 Confucius4 不走 `r2t2_llama`（官方 README 推荐的 Python 包）
 * 官方预编译原生库是 **Linux x86_64 + CUDA + CPython 3.12** 的 `libllama.so.0.4.0`，Windows 上根本没有；
 * PyPI 上 `r2t2_llama` 也是 404。而实测 `llama-mtmd-cli.exe -m <Q4_K_M> --mmproj <mmproj> --audio <wav>`
 * 在 Windows CPU 上直接跑通，stdout 一行 `language English<asr_text>Good morning. …`。
 * ⇒ 走 llama.cpp 官方二进制，⛔ 不要引入 Python 依赖。
 *
 * ## 桥接脚本的 stdout 协议（见 `D:\Qwen3-aligner\cli_bridge.py`）
 * ```
 * PROGRESS <0-100> <阶段文案>
 * DONE <srt 绝对路径>
 * ERROR <一句话原因>
 * RESULT {"ok":true,"srtPath":"…","entries":3,"durationSec":13.82}
 * ```
 * 🔴 脚本的 stdout 里还会混进它上游库自己的 print（中文日志、`\r` 进度条），
 *    所以解析必须**只认这四种前缀**，其余静默丢弃 —— 别把第一行当结果。
 */

/**
 * 顺序 = 用户需求文档「选择模型」里的分组顺序（Whisper → Qwen3 → SenseVoice →
 * Paraformer → X-ASR → Confucius4），⛔ 别改成字母序。
 */
export const ASR_ENGINE_IDS = [
    'whisper',
    'qwen3',
    'sensevoice',
    'paraformer',
    'xasr',
    'confucius',
] as const;
export type AsrEngineId = (typeof ASR_ENGINE_IDS)[number];

/**
 * 执行器种类 —— 决定「拿哪个 exe、拼什么参数、怎么解析输出」。
 *
 * ⚠️ 这**不是**「引擎运行在哪个语言里」，而是「输出协议的形状」：
 *    · `whisper`            出 SRT 文件，读盘
 *    · `python`             出 `PROGRESS/DONE/ERROR/RESULT` 行协议
 *    · `sherpa-json`        `sherpa-onnx-offline.exe` 出整段 JSON（含 tokens + timestamps 数组），
 *                           由 `pure/senseVoice` 的 `parseSenseVoiceJson` 解析
 *    · `sherpa-vad-offline` `sherpa-onnx-vad-with-offline-asr.exe` 出 `0.134 -- 0.940: text`（stderr）
 *    · `sherpa-vad-online`  `sherpa-onnx-vad-with-online-asr.exe` 出 `vad segment(1:0.134-0.940) results: text`
 *    · `llama-mtmd`         `llama-mtmd-cli.exe` 出 `language English<asr_text>正文`（stdout，无时间戳）
 *
 * 🔴 为什么 `sherpa-json` 与两个 `sherpa-vad-*` 要分开，而不是合成一个 `sherpa`：
 *    SenseVoice 走的那条老链路（`services/asrSenseVoice` + `sherpa-onnx-offline.exe`）已经在生产跑通，
 *    拿整段 JSON 里的 token 级 timestamps 自己断句 —— 换掉它等于重写一条已验证的链路。
 *    而 Paraformer / X-ASR 只能靠 VAD 分段版拿时间戳（offline 版喂 paraformer 返回 `timestamps: []`，
 *    整段文字没法分条，见 `services/asrSherpaVad` 的注释）。
 *    ⇒ 三条路的 exe 与解析器都不同，⛔ 别为了「少一个枚举值」把它们合并。
 */
export type AsrRunnerId =
    | 'whisper'
    | 'python'
    | 'sherpa-json'
    | 'sherpa-vad-offline'
    | 'sherpa-vad-online'
    | 'llama-mtmd';

export interface AsrEngineDef {
    readonly id: AsrEngineId;
    /** 界面主标题（模型家名） */
    readonly title: string;
    /** 副标题：一句话说清它擅长什么（分组标题的第二段） */
    readonly subtitle: string;
    readonly scene: string;
    /** 执行器种类，决定跑哪个 exe / 怎么解析 */
    readonly runner: AsrRunnerId;
    /**
     * 是否由插件**一键安装**运行时（下载 exe + 模型）。
     * `qwen3` 为 `false`：它要 python + torch + 3.5GB safetensors，只能用户自备环境。
     */
    readonly autoInstall: boolean;
}

/**
 * 🔴 主标题 = 模型家名（2026-11-06 m08893 用户明确要求：「名称从中文精确版、极速中文版
 *    改成各自的模型家名，如 Whisper.cpp」）。
 *
 *    这**推翻了** m01938 需求文档里「界面上不能出现 Whisper、Qwen3 等技术词汇」那一条 ——
 *    用户后来发现「轻量多语版 / 中文精准版 / 极速纯中文版」这样的名字反而看不出装的是哪一家，
 *    排查问题时对不上号。现在技术名放主标题，人话定位放 subtitle：
 *      · 主标题回答「这是哪一家」
 *      · subtitle 回答「它擅长什么」
 *    ⛔ 别再把 title 改回「xx 版」——`tests/asrEngines.test.ts` 有断言钉住。
 *
 * 🔴 2026-11 用户新需求「支持多种 ASR 模型、可灵活切换」：从 3 家扩到 6 家，
 *    新增 Paraformer / X-ASR / Confucius4。subtitle 直接采用用户需求文档里每组的分组标题第二段，
 *    ⛔ 别自己另起一套说辞 —— 用户是按这些文案验收的。
 */
export const ASR_ENGINES: readonly AsrEngineDef[] = [
    {
        id: 'whisper',
        title: 'Whisper.cpp',
        subtitle: '全场景多语种 · 生态最成熟',
        scene: '适合日常口述、多语言视频；模型可在插件里一键下载。',
        runner: 'whisper',
        autoInstall: true,
    },
    {
        id: 'qwen3',
        title: 'Qwen3-ASR',
        subtitle: '大模型驱动 · 中英顶尖精度',
        scene: '适合高质量中文 / 中英混说；需要自己准备好 Python 环境与模型。',
        runner: 'python',
        autoInstall: false,
    },
    {
        id: 'sensevoice',
        title: 'SenseVoice',
        subtitle: '极速本地转写 · 支持情感识别',
        scene: '纯 CPU 也能跑得飞快；中文场景性价比最高。',
        runner: 'sherpa-json',
        autoInstall: true,
    },
    {
        id: 'paraformer',
        title: 'Paraformer',
        subtitle: '工业级中文 · 带字级时间戳',
        scene: '中文生产主力；原生字级时间戳与热词，适合做字幕对轴。',
        runner: 'sherpa-vad-offline',
        autoInstall: true,
    },
    {
        id: 'xasr',
        title: 'X-ASR',
        subtitle: '百兆内极轻量 · 流畅流式体验',
        scene: '0.16B 参数的中英双语流式模型；体积小、响应快。',
        runner: 'sherpa-vad-online',
        autoInstall: true,
    },
    {
        id: 'confucius',
        title: 'Confucius4',
        subtitle: '大模型流式 · 拒绝文字闪烁',
        scene: '网易有道流式识别大模型；一次成型不返工，慢一些但更稳。',
        runner: 'llama-mtmd',
        autoInstall: true,
    },
];

export function engineDefOf(id: string | undefined): AsrEngineDef {
    return ASR_ENGINES.find((e) => e.id === id) ?? ASR_ENGINES[0];
}

/**
 * 该引擎是否吃 sherpa-onnx 那套命令行（含 VAD 分段版与整段 JSON 版）。
 * ⚠️ 所有 sherpa 变体共用同一份 `silero_vad.onnx`（VAD 两个变体）与同一套 tar.bz2 发布包。
 */
export function isSherpaRunner(runner: AsrRunnerId): boolean {
    return runner === 'sherpa-json' || runner === 'sherpa-vad-offline' || runner === 'sherpa-vad-online';
}

/**
 * 该引擎的 runner 是否走「VAD 分段」那一套（输出 `start -- end: text`）。
 * 这两个变体共用**一个解析器**（`parseVadSegmentLine`），只是 exe 与模型旗标不同。
 */
export function isVadRunner(runner: AsrRunnerId): boolean {
    return runner === 'sherpa-vad-offline' || runner === 'sherpa-vad-online';
}

/** 该引擎是否需要 Python 桥接脚本（当前只有 Qwen3-ASR） */
export function usesPythonBridge(engine: string): boolean {
    return engineDefOf(engine).runner === 'python';
}

/**
 * 插件里的语言码 → 桥接脚本认的语言名（`English` / `Chinese` / `Cantonese`…）。
 * 🔴 桥接脚本要的是**英文名**不是语言码（`Chinese` 不是 `zh`），传错了模型会当成未知语言。
 */
export const QWEN_LANG_NAMES = [
    'Chinese',
    'English',
    'Japanese',
    'Korean',
    'Cantonese',
    'French',
    'German',
    'Italian',
    'Portuguese',
    'Russian',
    'Spanish',
] as const;

const QWEN_LANG_BY_CODE: Readonly<Record<string, string>> = {
    zh: 'Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    yue: 'Cantonese',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    es: 'Spanish',
};

/** 语言码 → 桥接脚本语言名。认不出（含 `auto`）回 `Chinese` —— 这款引擎的主力场景就是中文。 */
export function qwenLangFor(code: string | undefined): string {
    const k = String(code ?? '').trim().toLowerCase();
    return QWEN_LANG_BY_CODE[k] ?? 'Chinese';
}

/** 桥接脚本的模型档：`0.6B`（默认，显存友好）/ `1.7B`（更准更慢）。 */
export function qwenModelOf(raw: string | undefined): '0.6B' | '1.7B' {
    return String(raw ?? '').trim() === '1.7B' ? '1.7B' : '0.6B';
}

export interface QwenBridgeArgs {
    input: string;
    out: string;
    lang?: string;
    model?: string;
    mode?: 'transcribe' | 'align' | 'sensevoice';
    text?: string;
    segment?: number;
    /**
     * 模型根目录（其下是 `Qwen3-ASR-0.6B` / `Qwen3-ASR-1.7B` / `Qwen3-ForcedAligner-0.6B`）。
     *
     * 🔴 用户 m09432 挖出的真缺陷：插件把模型下到 `~/.reelludic/models/qwen3/`，
     *    而桥接脚本的 `model_loader` 默认只认 `<项目目录>/Qwen` ⇒ 卡片显示「已就绪」、
     *    真正转写时脚本却去另一个地方找，永远是「装了但用不了」。
     *    这个参数把两边指向同一个目录。
     */
    modelsDir?: string;
    /** 仅 `mode: 'sensevoice'` 用：sherpa-onnx 的 `sherpa-onnx-offline` 可执行文件绝对路径。 */
    sherpaExe?: string;
    /** 仅 `mode: 'sensevoice'` 用：SenseVoice 的模型 onnx 绝对路径（int8 / fp32 各一份）。 */
    senseVoiceModel?: string;
    /** 仅 `mode: 'sensevoice'` 用：SenseVoice 的 `tokens.txt` 绝对路径。 */
    senseVoiceTokens?: string;
}

/**
 * 拼 `cli_bridge.py` 的参数数组。
 * ⚠️ 只拼**脚本自己的**参数；解释器路径与脚本路径由调用方放在前面（它们不是脚本的参数）。
 */
export function buildQwenArgs(opts: QwenBridgeArgs): string[] {
    const args = ['--input', opts.input, '--out', opts.out];
    if (opts.lang) args.push('--lang', opts.lang);
    if (opts.model) args.push('--model', qwenModelOf(opts.model));
    if (opts.mode) args.push('--mode', opts.mode);
    if (opts.text) args.push('--text', opts.text);
    if (typeof opts.segment === 'number' && opts.segment > 0) {
        args.push('--segment', String(Math.round(opts.segment)));
    }
    // 模型根目录：只在 Qwen3 的两条链路上有意义（SenseVoice 走 sherpa 的三件套）
    if (opts.mode !== 'sensevoice' && opts.modelsDir) {
        args.push('--models-dir', opts.modelsDir);
    }
    // SenseVoice 三件套只在 sensevoice 模式下拼 —— 混进 transcribe 会让脚本把无关参数当噪声
    if (opts.mode === 'sensevoice') {
        if (opts.sherpaExe) args.push('--sherpa-exe', opts.sherpaExe);
        if (opts.senseVoiceModel) args.push('--sv-model', opts.senseVoiceModel);
        if (opts.senseVoiceTokens) args.push('--sv-tokens', opts.senseVoiceTokens);
    }
    args.push('--json');
    return args;
}

export type QwenBridgeLine =
    | { kind: 'progress'; percent: number | null; label: string }
    | { kind: 'seg'; start: number; end: number; total: number }
    | { kind: 'line'; start: number; end: number; text: string }
    | { kind: 'done'; srtPath: string }
    | { kind: 'error'; message: string }
    | { kind: 'result'; ok: boolean; srtPath: string; entries: number; durationSec: number };

/**
 * 解析桥接脚本的一行 stdout。
 *
 * 🔴 返回值 `null` 表示「这行不是协议消息」——调用方必须**忽略**而不是报错：
 *    脚本的 stdout 里混着上游库的中文日志和 `\r` 进度条，把噪声当错误会让转写一直显示失败。
 */
export function parseQwenLine(raw: string): QwenBridgeLine | null {
    const line = raw.replace(/\r/g, '').trim();
    if (!line) return null;
    if (line.startsWith('PROGRESS ')) {
        // `PROGRESS 35 正在识别` —— 第二个 token 是百分比，余下整段是文案（文案里可能有空格）
        const rest = line.slice('PROGRESS '.length).trim();
        const sp = rest.indexOf(' ');
        const head = sp < 0 ? rest : rest.slice(0, sp);
        const label = sp < 0 ? '' : rest.slice(sp + 1).trim();
        const n = Number(head);
        return { kind: 'progress', percent: Number.isFinite(n) ? n : null, label };
    }
    if (line.startsWith('SEG ')) {
        // `SEG 12.5 19.0 220.4` —— 起、止、总长（秒，浮点）。三个数缺一个就整行丢掉：
        // 半个时间戳画出来是「0:12 → NaN」，比不画更糟。
        const parts = line.slice('SEG '.length).trim().split(/\s+/);
        const start = Number(parts[0]);
        const end = Number(parts[1]);
        const total = Number(parts[2]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) return null;
        return { kind: 'seg', start, end, total };
    }
    if (line.startsWith('LINE ')) {
        // `LINE <起> <止> <正文>` —— 正文可能含空格，所以**只切前两刀**，余下整段当正文。
        // 🔴 用户 m11612「每一句转写」：插件拿它铺转写中的实时流。
        // ⚠️ 正文是空串就整行丢掉：画一排空壳行比不画更吓人。
        const rest = line.slice('LINE '.length).trim();
        const sp1 = rest.indexOf(' ');
        if (sp1 < 0) return null;
        const sp2 = rest.indexOf(' ', sp1 + 1);
        if (sp2 < 0) return null;
        const start = Number(rest.slice(0, sp1));
        const end = Number(rest.slice(sp1 + 1, sp2));
        const text = rest.slice(sp2 + 1).trim();
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (!text) return null;
        return { kind: 'line', start, end, text };
    }
    if (line.startsWith('DONE ')) {
        return { kind: 'done', srtPath: line.slice('DONE '.length).trim() };
    }
    if (line.startsWith('ERROR ')) {
        return { kind: 'error', message: line.slice('ERROR '.length).trim() };
    }
    if (line.startsWith('RESULT ')) {
        try {
            const obj = JSON.parse(line.slice('RESULT '.length)) as Record<string, unknown>;
            return {
                kind: 'result',
                ok: obj.ok === true,
                srtPath: String(obj.srtPath ?? ''),
                entries: Number(obj.entries ?? 0),
                durationSec: Number(obj.durationSec ?? 0),
            };
        } catch {
            return null; // 坏 JSON 当噪声丢掉，前面必然已经有 DONE 或 ERROR 了
        }
    }
    return null;
}

/**
 * 设置页的处方路径。
 *
 * ⚠️ 2026-11-06 起 ASR 引擎配置**不在「高级设置」**了：整组搬进新页签「播放阅读」（当时叫「沉浸体验」，
 *    11-07 用户改口）。⛔ 别把处方路径改回「高级设置 › 音频转文字」——那个入口已经不存在，
 *    用户照着找只会扑空（本次就是为此修的）。
 *
 * 🔴 2026-11-10 用户逐字（m03321）：「将设置页语音服务组下两个项语音转文字、文字转语音移出来为单独组」
 *    ⇒ 「语音转文字」本身**就是组名**了，路径从三级变成两级：
 *    ~~设置 › 播放阅读 › 语音服务 › 语音转文字~~ → **设置 › 播放阅读 › 语音转文字**。
 *    ⚠️ 那个中间层「语音服务」已从 `SETTING_GROUP_ICONS` 删除，⛔ 别再写回路径里。
 *
 * ⚠️ 文案里的路径会被 `tests/asrEngines.test.ts` 拿去与 `SETTING_NAV_TABS` /
 *    `SETTING_GROUP_ICONS` 逐级对账，⛔ 改文案必须保证「设置 › A › B」这个形状还能被正则切出来。
 */
const SETTINGS_TRAIL = '设置 › 播放阅读 › 语音转文字';

export function qwenMissingMessage(): string {
    return `还没有配置 Qwen3 的运行环境，请到「${SETTINGS_TRAIL}」里填 Python 解释器与桥接脚本`;
}

export function senseVoiceMissingMessage(): string {
    // ⚠️ 「极速版」是 SenseVoice 在界面上对用户用的别名（用户历次对话都这么叫它），
    //    文案里必须留着 —— `tests/asrQwen.test.ts` 钉住了它，删了会让用户认不出说的是哪一家。
    return `还没有配置极速版的运行程序，请到「${SETTINGS_TRAIL}」里填 sherpa-onnx 可用路径`;
}

/** 新引擎（Paraformer / X-ASR / Confucius4）通用的「还没装好」处方 */
export function engineMissingMessage(id: AsrEngineId): string {
    const def = engineDefOf(id);
    if (def.runner === 'python') return qwenMissingMessage();
    if (def.id === 'sensevoice') return senseVoiceMissingMessage();
    return `还没有安装 ${def.title} 的识别程序与模型，请到「${SETTINGS_TRAIL}」里点「一键装好」`;
}

/**
 * sherpa-onnx CLI 的说明文案。
 *
 * 实测（2026-11）：
 *  · `sherpa-onnx-offline.exe` 支持 `--sense-voice-model` / `--paraformer`，
 *    但**不认** `--qwen3-asr-*`（二进制里连字符串都没有），所以 Qwen3 不能走这条 CLI。
 *  · 真正好用（能拿分段）的是 `sherpa-onnx-vad-with-offline-asr.exe` 与
 *    `sherpa-onnx-vad-with-online-asr.exe`，两者都吃同一份 `silero_vad.onnx`。
 */
export function sherpaEngineHint(): string {
    return '需要 sherpa-onnx 的 vad-with-offline-asr / vad-with-online-asr 程序、对应模型与 silero_vad.onnx';
}
