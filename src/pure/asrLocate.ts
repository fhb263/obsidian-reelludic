/**
 * 本地语音识别所需的**外部程序定位**（纯逻辑，无 IO）。
 *
 * 🔴 为什么要这个模块（用户 2026-12 原话：「下载了 whisper.cpp·ggml-base，怎么还有剩下的框要我选择啊
 *    我怎么知道在哪里配置」）：原先把「输入框空着」当成「没配置」，可用户机器上 ffmpeg 早就在 PATH 里、
 *    模型也早被插件下到固定目录 —— 三个框全都空着只是因为我们从没去看，于是逼用户去「找路径」。
 *    真正该判的是**系统里有没有**，不是**框里填没填**。
 *
 * 分工：
 *    · 本模块只做「该去哪里找」的**字符串推导**与「找到了没」的**判定规则**，不碰磁盘、不碰 Node API；
 *    · 真正 `statSync` / `existsSync` 的探针在 `main.ts` 的 `asrAutoDetect()`（那里能惰性 `require('fs')`）。
 *    ⛔ 别把 fs 调用搬进来 —— 一搬进来单测就得造假文件系统，而这里的价值恰恰是能被穷举测。
 */

import { FFMPEG_EXE_CANDIDATES_POSIX, FFMPEG_EXE_CANDIDATES_WIN } from 'pure/asrEngine';

/** 一次探测的结果：找到就用，没找到就给出「你该怎么装」的下一步 */
export interface LocateResult {
    /** 找到的绝对路径；空串 = 没找到 */
    path: string;
}

/**
 * 把一个候选名按平台补上扩展名。
 *
 * 🔴 `ffmpeg` 在 Windows 上叫 `ffmpeg.exe`，但候选表里两个都列了 —— 那是给「用户显式填了路径」
 *    的场景用的。自动探测时按平台只留一个形态，避免同一个目录被试两遍。
 */
export function withPlatformExt(name: string, platform: string): string {
    const isWin = platform === 'win32';
    const hasExt = /\.[a-z0-9]+$/i.test(name);
    if (isWin) return hasExt ? name : `${name}.exe`;
    // POSIX：`.exe` 结尾的一律不要（那是 Windows 的名字）
    return hasExt && /\.exe$/i.test(name) ? name.replace(/\.exe$/i, '') : name;
}

/** ffmpeg 在 PATH 里的候选名（按平台过滤） */
export function ffmpegPathNames(platform: string): string[] {
    const src = platform === 'win32' ? FFMPEG_EXE_CANDIDATES_WIN : FFMPEG_EXE_CANDIDATES_POSIX;
    return src.map((n) => withPlatformExt(n, platform));
}

/**
 * whisper.cpp 的**专属**候选名（自动探测只用这一份）。
 *
 * 🔴 为什么不能直接复用 `ASR_EXE_CANDIDATES_WIN`（里面含 `whisper.exe`）：那个名字在 Windows 上
 *    还会被**另一个完全不同的程序**占用 —— Python 版 `openai-whisper` 的入口也叫 `whisper.exe`，
 *    而且它就装在 `%LOCALAPPDATA%\Python\bin`（很多人的 PATH 里都有）。两者参数毫无交集：
 *    whisper.cpp 要 `-m model -f wav -osrt -of 前缀`，openai-whisper 要位置参数 `audio.mp3`。
 *    本机实测：那个 `whisper.exe --help` 直接抛 Python Traceback ⇒ 探测「成功」了、转写必然失败，
 *    而且用户看到的是英文栈，比「未配置」难懂一百倍。
 * ⚠️ 但**用户手填** `whisper.exe` 时必须照用（那是他的明确指定，也许他真装了同名 wrapper）
 *    ⇒ 那一档走 `asrExeCandidates(raw)`，与本函数无关。
 */
export function whisperCppOnlyNames(platform: string): string[] {
    return ['whisper-cli', 'main', 'whisper-cpp'].map((n) => withPlatformExt(n, platform));
}

/**
 * 把 PATH 字符串拆成目录列表。
 *
 * ⚠️ Windows 的分隔符是 `;`、POSIX 是 `:`；但**从别处粘来的 PATH 常混用**（Git Bash 导出的 `:`、
 *    某些安装器写的 `;`），所以两个都拆 —— 多拆出一条不存在的目录没有任何代价（`statSync` 会失败），
 *    少拆一条就漏掉用户真正的安装位置。
 * ⚠️ Windows 上 `:` 会切碎盘符（`C:\ffmpeg` → `C` + `\ffmpeg`），所以**只在 POSIX 上按 `:` 拆**。
 */
export function splitPathList(raw: string | undefined, platform: string): string[] {
    const s = String(raw ?? '');
    if (!s) return [];
    const parts = platform === 'win32' ? s.split(';') : s.split(':');
    return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * 在 PATH 目录里拼出要尝试的文件名（`dir + name`）。
 *
 * ⚠️ 只拼字符串，不判存在 —— 判存在是调用方的事（这里没有 fs）。
 * ⚠️ 去重：PATH 里同一个目录出现两次是常态（用户自己加过一次、安装器又加过一次）。
 */
export function pathCandidates(dirs: readonly string[], names: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const dir of dirs) {
        // 🔴 先 trim 再判空：本函数也被 `commonInstallDirs` 的产物喂（那条路径没经过
        //    `splitPathList` 的清理），只判 `!base` 会让纯空白目录拼出 `'   /x'` 这种没意义的名字。
        // 去掉尾部斜杠（`C:\bin\` 与 `C:\bin` 是同一个目录，拼出来却带双斜杠）
        const base = String(dir ?? '').trim().replace(/[\\/]+$/, '');
        if (!base) continue;
        for (const name of names) {
            const full = `${base}/${name}`;
            const key = full.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(full);
        }
    }
    return out;
}

/**
 * 常见安装位置（PATH 里没有时的兜底）。
 *
 * 🔴 为什么要猜：大多数人装 ffmpeg / whisper.cpp 是「解压到某个盘」，**没加 PATH**。
 *    只查 PATH 的话，这些人明明装了却被判「未配置」，正是用户这次抱怨的同一类问题。
 *    ⚠️ 只列真正常见的位置，⛔ 不做全盘搜索 —— 全盘扫盘会让设置页卡住十几秒。
 */
export function commonInstallDirs(
    kind: 'whisper' | 'ffmpeg',
    platform: string,
    opts: {
        home: string;
        appData?: string;
        localAppData?: string;
        programFiles?: string;
        programFilesX86?: string;
        /**
         * 插件自己的安装目录（系统绝对路径）。
         *
         * 🔴 用户 2026-11-10 裁定「给所有模型下载目录换成插件文件夹根目录而不是 c 盘用户根目录」
         *    ⇒ 一键安装把程序下到 `<插件目录>/bin`，探测必须**同样**先看那里，
         *    否则就是「装成功了但还是红的」——比装不上更让人火大。
         * ⚠️ 由宿主算好传进来（本模块是纯逻辑，⛔ 不碰 `manifest` / `vault.adapter`）。
         */
        pluginDir?: string;
    },
): string[] {
    const pluginRoot = String(opts.pluginDir ?? '').trim().replace(/[\\/]+$/, '');
    // 插件目录优先：安装器就落在那儿（见 `main.ts::asrBinDir`），探测必须同源。
    // 插件目录可用时即使拿不到主目录也要返回它 —— `home` 缺失不该连带把插件里装好的程序也判丢。
    const pluginDirs = pluginRoot ? [`${pluginRoot}/bin`] : [];
    const home = String(opts.home ?? '').replace(/[\\/]+$/, '');
    if (!home) return pluginDirs;
    const dirs: string[] = [...pluginDirs];
    if (kind === 'whisper') {
        // 插件自己装的那个（见 `asrBinDir` / 一键安装）
        dirs.push(`${home}/.reelludic/bin`);
        dirs.push(`${home}/whisper.cpp`);
        dirs.push(`${home}/whisper.cpp/build/bin/Release`);
        dirs.push(`${home}/whisper.cpp/build/bin`);
        dirs.push(`${home}/Downloads/whisper-bin-Win32/Release`);
        if (opts.localAppData) dirs.push(`${opts.localAppData}/Programs/whisper.cpp`);
    } else {
        dirs.push(`${home}/.reelludic/bin`);
        if (opts.programFiles) dirs.push(`${opts.programFiles}/ffmpeg/bin`);
        if (opts.programFilesX86) dirs.push(`${opts.programFilesX86}/ffmpeg/bin`);
        if (opts.localAppData) {
            dirs.push(`${opts.localAppData}/Microsoft/WinGet/Links`);
            dirs.push(`${opts.localAppData}/Programs/ffmpeg/bin`);
        }
        if (opts.appData) dirs.push(`${opts.appData}/chocolatey/bin`);
        dirs.push(`${home}/scoop/shims`);
        dirs.push(`${home}/ffmpeg/bin`);
        dirs.push(`${home}/Downloads/ffmpeg/bin`);
        dirs.push(`${home}/Downloads/ffmpeg-master-latest-win64-gpl/bin`);
        // POSIX 常见位置（macOS 的 Homebrew 在 /opt/homebrew，Intel 在 /usr/local）
        if (platform !== 'win32') {
            dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/opt/local/bin');
        }
    }
    return dirs;
}

/**
 * 候选目录的**完整**尝试顺序：先用户显式填的（那是他的决定，⛔ 别绕过），再 PATH，最后常见位置。
 *
 * 🔴 顺序有意义：用户填了路径却填错时，若我们悄悄改用 PATH 里的另一个，他会以为自己的配置生效了
 *    —— 那比「找不到」更难排查。所以用户填的值**只试它自己**，不参与后面两档（与 `asrExeCandidates`
 *    同一条口径，见 `pure/asrEngine` 那个函数的注释）。
 */
export function locateOrder(opts: {
    custom: string;
    pathDirs: readonly string[];
    names: readonly string[];
    commonDirs: readonly string[];
}): string[] {
    const custom = opts.custom.trim();
    if (custom) return [custom];
    const fromPath = pathCandidates(opts.pathDirs, opts.names);
    const fromCommon = pathCandidates(opts.commonDirs, opts.names);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...fromPath, ...fromCommon]) {
        const key = p.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out;
}

/** 就绪判据要用的三件（`asrEngineStatusOf` 逐条查文件在不在） */
export interface AsrReadiness {
    /** 识别模型（whisper 的 .bin / SenseVoice 的 .onnx）—— 必须由用户提供或插件下载 */
    model: string;
    /** 识别程序（whisper-cli / python / sherpa-onnx-offline） */
    exe: string;
    /** 抽音轨工具（ffmpeg）—— 🔴 三家引擎都要，⛔ 别只对 whisper 查 */
    ffmpeg: string;
}

/**
 * 是否可以开始转写。
 *
 * 🔴 用户这次的抱怨本质是「还有框要我填」⇒ 就绪判据必须**把能自动找到的都算上**。
 *    原来的判据只看模型（`asrModelPath`），于是 ffmpeg 明明在 PATH 里，卡片还是「未配置」。
 * ⚠️ 但也不能无条件放行：`transcribeWithWhisper` 少了任一文件都会 spawn ENOENT，
 *    那时用户看到的是英文报错 —— 比「未配置」难懂得多。所以三者都要真在。
 */
export function asrReady(r: AsrReadiness): boolean {
    return Boolean(r.model && r.exe && r.ffmpeg);
}
