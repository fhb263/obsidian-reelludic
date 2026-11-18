/**
 * 本地语音识别模型的**目录与下载计划**（纯逻辑层，无 IO）。
 *
 * 🔴 为什么直接从上游下：用户 m01938 要「像选游戏画质一样」挑一档引擎自动装好。
 *    模型不随插件分发（`main.js` 已 97%，模型最小也有 74MB），但托管位置不必我们操心 ——
 *    whisper.cpp 官方在 HuggingFace 上有公开仓库，实测三个 HEAD 都可直连：
 *      ggml-tiny.bin  77,691,713 字节（74.1MB）
 *      ggml-base.bin 147,951,465 字节（141.1MB）
 *      ggml-small.bin 487,601,967 字节（465MB）
 *    ⇒ 插件只发一个 HTTP 请求，⛔ 不自建对象存储，也不把二进制塞进产物。
 *
 * 🔴 为什么只有 whisper.cpp 三档、没有用户文档里点名的 Qwen3-ASR / SenseVoice：
 *    那两个是 FunASR 生态的运行时（各自一套可执行文件与模型格式），**喂不进 whisper-cli**。
 *    硬凑成「同一套引擎的三个档」会让用户下完 500MB 后发现跑不起来。
 *    因此这里按**能力档位**命名（极速 / 均衡 / 精准），技术名放副标题 —— 与用户
 *    「界面不出现技术黑话、技术词只做极小字号副标题」的要求一致。
 *
 * ⚠️ 体积数字写死成常量而不是运行时读 Content-Length：下载前要先告诉用户「还要下多大」，
 *    而那一步不能等网络。实测值与常量由 `tests/asrModels.test.ts` 钉住，改了必须同步。
 */

/**
 * 模型档位标识（稳定 ID，⛔ 别改成中文：它是存进设置、也是文件名的一部分）。
 *
 * 🔴 2026-11-06 m09123 用户纠正：「Whisper.cpp 的各档位按它的原始模型档位名标表示
 *    而不是什么精确版极速版，而且好像有 5 档按小从大列出来」——
 *    用户说得对。实测 `ggerganov/whisper.cpp` 仓库有 33 个 `ggml-*.bin`，
 *    按档位去重（只取非 `.en` 的多语版、只取标准量化）正好 **5 档**，
 *    之前只写了 3 档（tiny/base/small），漏了 medium 与 large-v3。
 *    ⇒ 档位名回归上游原名（tiny/base/small/medium/large-v3），
 *      ⛔ 不再自造「极速版/均衡版/精准版」——自造名让用户拿上游文档对不上号。
 */
export type AsrModelTier = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'turbo';

/** 一档模型的静态描述 */
export interface AsrModelPreset {
    tier: AsrModelTier;
    /** 界面主标题 = 上游原始档位名（⛔ 不自造「极速版」这类名字） */
    title: string;
    /** 副标题：一句话说清这一档适合谁 */
    subtitle: string;
    /** 适合什么场景的一句话 */
    scene: string;
    /** 下载地址（HuggingFace 官方仓库的 resolve 直链） */
    url: string;
    /** 落盘文件名 */
    fileName: string;
    /** 期望字节数（用于「下完校验」与「下载前告知体积」） */
    bytes: number;
    /** 是否推荐档 */
    recommended: boolean;
}

/** 官方仓库基址（换镜像只改这一处） */
export const ASR_MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/**
 * 国内镜像基址（`hf-mirror.com`，与官方同一批文件）。
 *
 * 🔴 为什么必须有它 —— 这是本轮**实测**出来的，不是猜的：
 *    直连 `huggingface.co` 在本机（中国大陆）**12 秒超时**、`socket hang up`，
 *    而 `hf-mirror.com` 直接通（302 跳到 `cas-bridge.xethub.hf.co`，之后照常收到字节）。
 *    没有镜像兜底，这个「一键下载」对目标用户群体等于完全不可用。
 * ⚠️ 镜像只换基址，路径与文件名完全一致（同一仓库的镜像），所以能靠字符串替换得出。
 * ⚠️ 镜像**不是首选**：官方永远先试（它是权威源、且海外用户更快），失败才回落。
 */
export const ASR_MODEL_MIRROR_BASE = 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main';

/** 某一档的镜像下载地址 */
export function mirrorUrlFor(preset: AsrModelPreset): string {
    return preset.url.replace(ASR_MODEL_BASE, ASR_MODEL_MIRROR_BASE);
}

/**
 * 六档预设，**顺序 = 体积从小到大**（2026-11-06 m09123 用户要求「按小从大列出来」）。
 *
 * 字节数全部来自实测（`hf-mirror.com/api/models/ggerganov/whisper.cpp/tree/main`）：
 *   ggml-tiny.bin      77,691,713
 *   ggml-base.bin     147,951,465
 *   ggml-small.bin    487,601,967
 *   ggml-medium.bin 1,533,763,059
 *   ggml-large-v3-turbo.bin 1,624,555,275
 *   ggml-large-v3.bin 3,095,033,483
 * ⚠️ 其余 28 个是 `.en`（纯英文）与 q5_1/q8_0 量化变体，⛔ 不上界面：
 *    中文用户用不了纯英文版，量化版与标准版的差别又不是「选档位」该操心的事。
 */
export const ASR_MODEL_PRESETS: readonly AsrModelPreset[] = [
    {
        tier: 'tiny',
        title: 'tiny',
        subtitle: '最快，精度最低',
        scene: '只想快速看个大意，或者机器比较老的时候用。',
        url: `${ASR_MODEL_BASE}/ggml-tiny.bin`,
        fileName: 'ggml-tiny.bin',
        bytes: 77691713,
        recommended: false,
    },
    {
        tier: 'base',
        title: 'base',
        subtitle: '速度与精度都够日常用',
        scene: '日常口述、多语言视频都够用；精度和速度都不吃亏。',
        url: `${ASR_MODEL_BASE}/ggml-base.bin`,
        fileName: 'ggml-base.bin',
        bytes: 147951465,
        recommended: true,
    },
    {
        tier: 'small',
        title: 'small',
        subtitle: '中文更准，速度中等',
        scene: '中文、中英混说要求高，机器性能也跟得上时用。',
        url: `${ASR_MODEL_BASE}/ggml-small.bin`,
        fileName: 'ggml-small.bin',
        bytes: 487601967,
        recommended: false,
    },
    {
        tier: 'medium',
        title: 'medium',
        subtitle: '精度高，要几 GB 内存',
        scene: '对准确度要求高、愿意等它慢慢跑的时候用。',
        url: `${ASR_MODEL_BASE}/ggml-medium.bin`,
        fileName: 'ggml-medium.bin',
        bytes: 1533763059,
        recommended: false,
    },
    {
        /**
         * 🔴 2026-11 用户需求文档「12 档模型表」里的 turbo 档：比 large-v3 快数倍、
         *    精度只掉一点，是官方主推的性价比档。
         * ⚠️ 上游文件名是 `ggml-large-v3-turbo.bin`（⛔ 不是 `ggml-turbo.bin`）——
         *    文件名与 tier 不一致是上游的事实，`presetByFileName` 按 fileName 精确比对，
         *    所以这里必须写上游原名，否则用户手填这个路径会被认成「自定义模型」。
         * 字节数实测（curl -sIL 经 hf-mirror，终态 200）：
         *    X-Linked-Size / Content-Length = 1624555275
         * ⚠️ `Invoke-WebRequest -Method Head` 会因 308 Permanent Redirect 直接报错，
         *    取 HF 体积一律用 `curl.exe`。
         * 🔴 **位置必须在 medium 与 large-v3 之间**：本数组顺序 = 体积升序（见上方约束），
         *    1,624,555,275 > 1,533,763,059 且 < 3,095,033,483。⛔ 别追加到末尾，
         *    单测直接钉住这个升序，且界面的「从小到大」也是靠它。
         */
        tier: 'turbo',
        title: 'turbo',
        subtitle: 'large 的精度，几倍的速度',
        scene: '想要接近旗舰的准确度、又受不了 large-v3 慢的时候用。',
        url: `${ASR_MODEL_BASE}/ggml-large-v3-turbo.bin`,
        fileName: 'ggml-large-v3-turbo.bin',
        bytes: 1624555275,
        recommended: false,
    },
    {
        tier: 'large-v3',
        title: 'large-v3',
        subtitle: '最准，也最慢最占内存',
        scene: '长视频、口音重、要成品字幕时用；普通机器会很慢。',
        url: `${ASR_MODEL_BASE}/ggml-large-v3.bin`,
        fileName: 'ggml-large-v3.bin',
        bytes: 3095033483,
        recommended: false,
    },
];

/** 按档位取预设（档位非法返回 `null`，⛔ 不抛） */
export function presetOf(tier: string): AsrModelPreset | null {
    for (const p of ASR_MODEL_PRESETS) {
        if (p.tier === tier) return p;
    }
    return null;
}

/**
 * 由模型文件路径反查是哪一档（认不出返回 `null`）。
 *
 * 🔴 为什么按**文件名**认而不是记一个 `asrModelTier` 设置键：
 *    用户可以直接在「识别模型文件」那行手填一个自己下的 `ggml-large-v3.bin`，
 *    这时没有档位可言，但界面仍要能说「已就绪（当前引擎：…）」。
 *    按文件名认，手填路径和自动下载走的是同一条判断，⛔ 不会出现「下载的显示档位、
 *    手填的显示空白」这种两套状态。
 * ⚠️ 只比 `fileName` 精确相等（大小写不敏感）—— 不比前缀，
 *    否则 `ggml-base.bin` 会被 `ggml-base-en.bin` 之类误认。
 */
export function presetByFileName(path: string): AsrModelPreset | null {
    const raw = String(path ?? '').trim();
    if (!raw) return null;
    const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
    const name = (cut >= 0 ? raw.slice(cut + 1) : raw).toLowerCase();
    if (!name) return null;
    for (const p of ASR_MODEL_PRESETS) {
        if (p.fileName.toLowerCase() === name) return p;
    }
    return null;
}

/** 字节数转人话体积（`74.1MB` / `465MB`）—— 界面文案统一走它，⛔ 各处自己算必然不一致 */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '未知';
    if (bytes < 1024) return `${Math.round(bytes)}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    const mb = bytes / 1024 / 1024;
    // 三位数（465MB）不要小数点，两位数（74.1MB）留一位 —— 读起来才顺
    return mb >= 100 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
}

/** 预设的体积文案 */
export function presetSizeLabel(preset: AsrModelPreset): string {
    return formatBytes(preset.bytes);
}

/**
 * 手动下载页：模型官方发布页（2026-11-13 用户指令「给语音转文字的模型页加下载模型官网路径，
 * 可让用户自己手动下载并配置对应的路径」）。
 *
 * 🔴 为什么不直接把 `preset.url` 当「官网路径」给用户：
 *    那是 HuggingFace 的 LFS `resolve` 直链 —— 点开等于**立刻开始下载单个 1.5GB 文件**，
 *    浏览器不一定给出另存为对话框，用户也不清楚该放到哪个目录。
 *    「官网路径」要给的是**能自己挑文件、能看清楚是哪个仓库**的页面。
 * ⚠️ 与 `ASR_MODEL_BASE` 同源（同一个仓库），换镜像/换仓库时两处一起改。
 */
export const ASR_MODEL_SITE = 'https://huggingface.co/ggerganov/whisper.cpp/tree/main';

/** 手动下载页（国内镜像版，与 `ASR_MODEL_SITE` 是同一批文件的两个入口） */
export const ASR_MODEL_SITE_MIRROR = 'https://hf-mirror.com/ggerganov/whisper.cpp/tree/main';

/**
 * 「官网路径」那一行要展示的完整说明。
 *
 * 🔴 三条信息缺一不可（用户拿不全就会来问）：
 *    ① 去哪下（官网 / 镜像两个入口，国内直连官网会超时）；
 *    ② 下哪个文件（传了 `preset` 就点名具体文件名，⛔ 不说「挑一个」——33 个文件里挑会挑错）；
 *    ③ 下完放哪、怎么让插件用上（放哪都行，关键是**选文件**那一步把绝对路径指过去）。
 * ⚠️ 文案里不带体积以外的技术细节：用户不需要知道 ggml 是什么。
 * ⚠️ `preset` 省略时给出通用说法（弹窗里已经在上面逐档列过文件名，不必重复）。
 */
export function manualDownloadTip(preset?: AsrModelPreset): string {
    const which = preset
        ? `找到 ${preset.fileName}（约 ${presetSizeLabel(preset)}）`
        : '下载对应的 .bin 文件';
    // 🔴 2026-11-14 用户 m03072 ⑥：「选择本地模型文件…」已从折叠项提到「方式二」区块内
    //    ⇒ 文案必须跟着改，否则用户会去翻「展开高级配置」找一颗已经不在了的按钮。
    return `手动下载：前往官网 ${ASR_MODEL_SITE} ${which}，下载后点上面的「选择本地模型文件…」把路径指给它即可。国内直连官网不通时改用镜像 ${ASR_MODEL_SITE_MIRROR}`;
}

/**
 * 下载进度百分比（0..100 取整）。
 *
 * ⚠️ `total <= 0` 时返回 `null` 而不是 0：上游没给 Content-Length 的环境下，
 *    画一根停在 0% 的条会让用户以为卡死（与转写横幅同一条判据）。
 */
export function downloadPercent(received: number, total: number): number | null {
    if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0) return null;
    const pct = Math.round((received / total) * 100);
    if (!Number.isFinite(pct)) return null;
    return Math.max(0, Math.min(100, pct));
}

/**
 * 下完之后校验字节数。
 *
 * 🔴 为什么要校验：HuggingFace 的 LFS 地址在断流时会「成功结束但只有一半字节」，
 *    不校验就会把半个模型交给 whisper-cli —— 它报的错是「failed to load model」，
 *    用户完全看不出是下载没下完。
 * ⚠️ 容差是**纯相对**的 2%，⛔ **不加绝对字节下限**：本轮第一版写了
 *    `max(4096, 2%)`，结果一个 1KB 的文件少一半（差 500 字节）落在 4096 里被判「完整」
 *    —— 下限把「绝对容差」和「小文件」这两件事搅在一起了。真实模型最小 74MB，
 *    2% 就有 1.48MB，根本不需要绝对下限。
 * ⚠️ 2% 的意义：个别镜像会做透明压缩 / 追加尾部字节，差几十 KB 不该判失败；
 *    真断流通常是差几十个百分点，落不进这个窗口。
 */
export function downloadLooksComplete(received: number, expected: number): boolean {
    if (!Number.isFinite(received) || !Number.isFinite(expected) || expected <= 0) return false;
    if (received <= 0) return false;
    const diff = Math.abs(received - expected);
    return diff <= expected * 0.02;
}

/** 下载目录里的临时文件后缀（⛔ 直接写目标名：下到一半被中断，下次会误以为是好的） */
export const ASR_DOWNLOAD_TMP_SUFFIX = '.part';

/** 临时文件名 */
export function tmpPathFor(destPath: string): string {
    return `${destPath}${ASR_DOWNLOAD_TMP_SUFFIX}`;
}

/**
 * 把目标目录与文件名拼成绝对路径。
 * ⚠️ 只处理分隔符，不做 `/` 归一成平台风格以外的变换 —— 拼错了要让 `fs` 报错，别在这里猜。
 */
export function joinDir(dir: string, fileName: string): string {
    const d = dir.replace(/[\\/]+$/, '');
    if (!d) return fileName;
    const sep = d.indexOf('\\') >= 0 ? '\\' : '/';
    return `${d}${sep}${fileName}`;
}
