/**
 * whisper.cpp 运行时的**一键安装**（纯逻辑：选哪些文件、放哪儿、进度怎么算）。
 *
 * 🔴 为什么需要它（用户 m05462 抱怨的另一半）：模型能一键下载，可**跑模型的程序**却要用户自己去
 *    GitHub 找 release、解开 zip、再把 5 个 dll 和一个 exe 摆对位置 —— 对一个只想转字幕的人，
 *    这已经超纲了。既然我们能下载模型，就没有理由不把这三分钟也省掉。
 *
 * 实测结论（2026-12，`whisper-bin-Win32.zip` / tag `b5454`，5,523,979 字节、33 个条目）：
 *    · 真正跑起来只需要 **5 个文件**：`whisper-cli.exe` + `whisper.dll` + `ggml.dll` +
 *      `ggml-base.dll` + `ggml-cpu.dll`（合计约 3.1MB）；
 *    · 同一个 zip 里还有 `parakeet` / `wchess` / `SDL2.dll` 等与转写无关的产物，
 *      全解压会让用户目录凭空多出几十 MB 垃圾 ⇒ 必须**按白名单**挑，⛔ 不要整包解压。
 *    · 解压到 `~/.reelludic/bin/` 后真跑 `whisper-cli.exe --help` 已验证可执行（exit 0）。
 *
 * ⚠️ 本模块不碰 fs / zip / http —— 只回答「要哪几个文件」「放哪儿」「进度怎么表达」。
 *    真下载与解压在 `services/whisperRuntime.ts`，宿主侧入口是 `main.ts`。
 */

/** 运行时需要的全部文件名（白名单，按依赖顺序：exe 最后列，便于日志先看到 dll） */
export const WHISPER_RUNTIME_FILES: readonly string[] = [
    'whisper.dll',
    'ggml.dll',
    'ggml-base.dll',
    'ggml-cpu.dll',
    'whisper-cli.exe',
] as const;

/** 主程序名（装完之后探测就靠它） */
export const WHISPER_RUNTIME_EXE = 'whisper-cli.exe';

/**
 * 官方 release 的产物地址。
 *
 * 🔴 为什么钉死一个 build 号而不是「取 latest」：GitHub 的 `releases/latest` 指向的 tag
 *    （如 `v1.9.5`）**assets 为空** —— 真正带编译产物的是 build 号 tag（`b5454` 这种）。
 *    跟着 latest 走会拿到 404，而用户在设置页只看到「下载失败」，无从判断。
 * ⚠️ 钉死版号也意味着不会自动拿到新版本 —— 对「能跑就行」的用途是对的取舍：
 *    whisper 的 CLI 参数在 b5xxx 上已经稳定，升级只在出问题时才值得做。
 */
export const WHISPER_RUNTIME_ZIP_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/b5454/whisper-bin-Win32.zip';

/**
 * 镜像/加速地址（按实测速度排序，逐个回退）。
 *
 * 🔴 为什么是**列表**而不是一个：真机实测（2026-11）直连 GitHub 时好时坏 ——
 *    同一分钟内出现过「完整拉完 5,523,979 字节」与「连续 8 次 504」两种情况，
 *    加 UA、重试都没用；而两个国内加速站同时可用。只备一个镜像时，
 *    那一个正好也抖，用户就只剩「下载失败」四个字。
 *
 * 实测数据（各抓前 2MB 即断开）：
 *   - `gh-proxy.com`  17s   200  5,523,979  ← 首选（最快）
 *   - `ghproxy.net`  146s   200  5,523,979  ← 次选（慢但通）
 *   - `ghfast.top`        403
 *   - `ghproxy.cc`        证书过期
 */
export const WHISPER_RUNTIME_ZIP_MIRRORS: readonly string[] = [
    'https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-Win32.zip',
    'https://ghproxy.net/https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-Win32.zip',
];

/** @deprecated 单镜像时代的名字，保留只为不破坏既有引用；新代码请用 {@link WHISPER_RUNTIME_ZIP_MIRRORS} */
export const WHISPER_RUNTIME_ZIP_MIRROR = WHISPER_RUNTIME_ZIP_MIRRORS[0];

/** zip 里那些文件的前缀目录（实测都在 `Release/` 下） */
export const WHISPER_RUNTIME_ZIP_PREFIX = 'Release/';

/** 期望的 zip 体积（用于判断「下完了没有」，与下载器的 2% 容差同一口径） */
export const WHISPER_RUNTIME_ZIP_BYTES = 5523979;

/**
 * zip 里的条目名 → 落盘文件名。
 *
 * 🔴 为什么要做映射而不是直接用条目名：zip 里带 `Release/` 前缀，直接拼出去会变成
 *    `~/.reelludic/bin/Release/whisper-cli.exe` —— 而自动探测找的是 `~/.reelludic/bin/whisper-cli.exe`
 *    （见 `pure/asrLocate.commonInstallDirs`）。两边对不上，装完仍然「未配置」。
 * ⚠️ zip 里的分隔符可能是 `/` 也可能是 `\`（Windows 打包工具两种都有），一律归一化。
 */
export function runtimeFilePlan(entryNames: readonly string[]): Array<{ entry: string; target: string }> {
    const out: Array<{ entry: string; target: string }> = [];
    for (const raw of entryNames) {
        const entry = String(raw ?? '').replace(/\\/g, '/');
        const base = entry.slice(entry.lastIndexOf('/') + 1);
        if (!base) continue;
        // 大小写不敏感匹配：不同 build 的大小写不一致过（`Ggml.dll`）
        const hit = WHISPER_RUNTIME_FILES.find((f) => f.toLowerCase() === base.toLowerCase());
        if (!hit) continue;
        if (out.some((o) => o.target === hit)) continue;
        out.push({ entry, target: hit });
    }
    return out;
}

/** 白名单里的 5 个文件是否都在（安装完整性判据） */
export function runtimeComplete(existing: readonly string[]): boolean {
    const set = new Set(existing.map((n) => String(n ?? '').toLowerCase()));
    return WHISPER_RUNTIME_FILES.every((f) => set.has(f.toLowerCase()));
}

/** 缺哪几个（用来给「安装不完整」一句人话） */
export function runtimeMissing(existing: readonly string[]): string[] {
    const set = new Set(existing.map((n) => String(n ?? '').toLowerCase()));
    return WHISPER_RUNTIME_FILES.filter((f) => !set.has(f.toLowerCase()));
}

/**
 * 安装进度换算：下载占 0–80%，解压占 80–100%。
 *
 * 🔴 为什么不是「下载 0–100 再解压 0–100」：两个进度条会各自冲到 100 再归零，
 *    用户会以为失败了一次。合成一条线性进度，中间那段文案从「正在下载」切成「正在安装」。
 */
export function installPercent(stage: 'download' | 'extract', inner: number): number {
    // ⚠️ NaN 与 ±Infinity 要分开处理：`Number.isFinite` 一刀切成 0 会把「已经远超上限」
    //    读成「还没开始」（`Infinity` 本该是 100）。只有真正的 NaN 才没有意义、取 0。
    const raw = Number(inner);
    const v = Number.isNaN(raw) ? 0 : Math.min(100, Math.max(0, raw));
    if (stage === 'download') return Math.round(v * 0.8);
    return Math.round(80 + v * 0.2);
}

/** 进度文案（⛔ 不出现 zip/exe/GitHub 这些词，见用户「不出现技术黑话」的要求） */
export function installLabel(stage: 'download' | 'extract'): string {
    return stage === 'download' ? '正在下载转写引擎…' : '正在安装转写引擎…';
}

/** 平台门控：一键安装只对 Windows 打包（官方只发 Win32 预编译包） */
export function installSupported(platform: string): boolean {
    return platform === 'win32';
}

/** 不支持时的说明（macOS / Linux 用户要自己编译或装 brew 包） */
export function installUnsupportedMessage(platform: string): string {
    // 🔴 2026-11-14（用户 m05673 手机实测）：移动端 `currentPlatform()` 返回空串 ——
    //    Android / iOS 的 WebView 里连 `process` 都没有，更没有「包管理器」这回事。
    //    ⛔ 别让它落到下面那句「请用你的包管理器安装」—— 手机上根本做不到。
    if (!platform) return '本地转写需要在电脑版 Obsidian 里使用（手机 / 平板暂不支持）。';
    if (platform === 'darwin') return 'macOS 上请用 Homebrew 安装（brew install whisper-cpp），装好后这里会自动找到它。';
    return '这个平台没有官方预编译包，请用你的包管理器安装 whisper.cpp，装好后这里会自动找到它。';
}
