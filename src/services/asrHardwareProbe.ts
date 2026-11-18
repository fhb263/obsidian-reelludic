/**
 * 真机硬件探测（用户 m05717 ① 选定「真探测，不要假数据」）。
 *
 * 采四类数据：显卡与显存（`nvidia-smi`）、物理内存（`os.totalmem`）、
 * CMake 与 C++ 编译器（`cmake --version` / `cl` / `g++ --version`）、可用磁盘。
 *
 * 🔴 设计铁律：**任何一项探不到都不许抛错**。
 *    「没装 N 卡」是绝大多数机器的正常状态，不是失败；
 *    「没装 CMake」对预编译路线毫无影响。
 *    所以每个探测都 `catch` 掉自己的异常，返回「空值 + 原因」，
 *    由界面决定怎么措辞（见 `pure/asrHardware.ts` 的 `gpuRowState` / `optionalToolState`）。
 *
 * ⚠️ 全部探测都在**子进程**里跑，且都带超时：
 *    `nvidia-smi` 在驱动半死不活时会卡住几十秒，不能让它拖住设置页渲染。
 *
 * 🔴🔴 2026-11-14（用户 m05195 / m05299，移动端适配）：**⛔ 绝对不要写顶层
 *    `import { spawn } from 'child_process'` / `import * as os from 'os'`**。
 *    理由（实测过，不是推测）：esbuild 会把静态 import 编译成产物**顶层**的
 *    `var import_child_process = require("child_process");`
 *    （见 `main.assert.js` 里 `// src/services/asrHardwareProbe.ts` 那一段）——
 *    而 Obsidian **移动端（Android / iOS WebView）没有 Node 运行时**，
 *    顶层 require 会在**插件加载期**就抛错，整个插件起不来。
 *    本仓已有正确范式：`src/pure/dl/neteaseCrypto.ts` 的 `getNodeCrypto()`。
 *    本文件的 `getNodeModule()` 与它同款：先试 `window.require`（渲染进程绕过 CSP），
 *    再试模块作用域 `require`（Node / vitest），**两层各带 try/catch**。
 *    ⛔ 别「优化」回静态 import —— 那会让移动端一启动就崩。
 */

/**
 * 取 Node 内置模块；拿不到返回 `null`（移动端就是这一支）。
 *
 * 顺序与 `src/pure/dl/neteaseCrypto.ts` 的 `getNodeCrypto()` 一致：
 * ① `window.require` —— Obsidian 渲染进程里 `require` 被 CSP 挡着，`window.require` 才是通的；
 * ② 模块作用域 `require` —— vitest / 打包后的 CJS bundle。
 */
function getNodeModule<T = unknown>(id: string): T | null {
    try {
        const w = typeof window !== 'undefined' ? (window as { require?: (m: string) => unknown }) : undefined;
        if (w && typeof w.require === 'function') {
            const mod = w.require(id);
            if (mod) return mod as T;
        }
    } catch {
        /* 回退到下一支 */
    }
    try {
        const req = typeof require !== 'undefined' ? (require as (m: string) => unknown) : undefined;
        if (typeof req === 'function') {
            const mod = req(id);
            if (mod) return mod as T;
        }
    } catch {
        /* 移动端 / 无 Node：落空，调用方按「探不到」处理 */
    }
    return null;
}

/** 子进程统一超时：探测是「锦上添花」，绝不能把界面卡住。 */
const PROBE_TIMEOUT_MS = 4000;

/** Node `os` 模块的最小面（只用到 totalmem）。 */
interface OsLike {
    totalmem: () => number;
}

/** Node `child_process` 的最小面（只用到 spawn）。 */
interface ChildProcessLike {
    spawn: (exe: string, args: string[], opts: Record<string, unknown>) => {
        stdout?: { on: (ev: string, cb: (b: Buffer) => void) => void } | null;
        stderr?: { on: (ev: string, cb: (b: Buffer) => void) => void } | null;
        on: (ev: string, cb: () => void) => void;
        kill: () => void;
    };
}

/** 跑一条命令，收 stdout+stderr 合并后的文本；超时/不存在一律返回空串。 */
function runQuiet(exe: string, args: readonly string[]): Promise<string> {
    return new Promise<string>((resolve) => {
        // 🔴 惰性取 `child_process`：移动端拿不到 ⇒ 直接返回空串（= 探不到），⛔ 不在模块加载期 require。
        const cp = getNodeModule<ChildProcessLike>('child_process');
        if (!cp || typeof cp.spawn !== 'function') {
            resolve('');
            return;
        }
        let out = '';
        let settled = false;
        const finish = (v: string): void => {
            if (settled) return;
            settled = true;
            resolve(v);
        };
        let child: ReturnType<ChildProcessLike['spawn']>;
        try {
            child = cp.spawn(exe, args as string[], {
                windowsHide: true,
                // ⚠️ `shell: true`：Windows 上 `cmake` / `cl` 往往不在 PATH 而是 .bat/.cmd 包装，
                //    不开 shell 会 ENOENT。代价是参数要自己防注入 —— 这里的参数全是常量。
                shell: true,
            });
        } catch {
            finish('');
            return;
        }
        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                /* 已经退出 */
            }
            finish(out);
        }, PROBE_TIMEOUT_MS);
        child.stdout?.on('data', (b: Buffer) => {
            out += b.toString();
        });
        child.stderr?.on('data', (b: Buffer) => {
            // 有些工具把版本号打在 stderr（如 g++ 的老版本），一起收
            out += b.toString();
        });
        child.on('error', () => {
            clearTimeout(timer);
            finish('');
        });
        child.on('close', () => {
            clearTimeout(timer);
            finish(out);
        });
    });
}

/** 显卡与显存。没装 N 卡时返回空数组 —— 这是正常情况，不是错误。 */
export async function probeGpus(): Promise<{ gpus: { name: string; vramMb: number }[]; error: string }> {
    const out = await runQuiet('nvidia-smi', [
        '--query-gpu=name,memory.total',
        '--format=csv,noheader,nounits',
    ]);
    if (!out.trim()) return { gpus: [], error: '' };
    // 延迟 require 纯函数，避免 service 层在模块加载期就依赖 pure（循环引用风险）
    const { parseNvidiaSmi } = await import('pure/asrHardware');
    return { gpus: parseNvidiaSmi(out), error: '' };
}

/** 物理内存总量（MiB）。 */
export function probeTotalMemMb(): number {
    try {
        // 🔴 惰性取 `os`：移动端拿不到 ⇒ 返回 0（= 不知道），⛔ 不在模块加载期 require。
        const os = getNodeModule<OsLike>('os');
        if (!os || typeof os.totalmem !== 'function') return 0;
        const bytes = os.totalmem();
        if (!Number.isFinite(bytes) || bytes <= 0) return 0;
        return Math.round(bytes / (1024 * 1024));
    } catch {
        return 0;
    }
}

/** CMake 是否可用 + 版本号。 */
export async function probeCmake(): Promise<{ found: boolean; version: string }> {
    const out = await runQuiet('cmake', ['--version']);
    const m = /cmake version\s+([\d.]+)/i.exec(out);
    if (!m) return { found: false, version: '' };
    return { found: true, version: m[1] };
}

/**
 * C++ 编译器是否可用。
 *
 * 🔴 为什么同时试 `cl`（MSVC）与 `g++`：Windows 上两者都存在，
 *    只报一个会漏掉「用户其实装了 MinGW」的情况。
 * ⚠️ `cl` 不带参数会打印用法而不是版本（退出码非 0），但仍能从输出里认出它存在。
 */
export async function probeCpp(): Promise<{ found: boolean; detail: string }> {
    const gcc = await runQuiet('g++', ['--version']);
    const gm = /g\+\+.*?([\d]+\.[\d]+\.[\d]+)/s.exec(gcc);
    if (gm) return { found: true, detail: `g++ ${gm[1]}` };
    const cl = await runQuiet('cl', []);
    const cm = /Microsoft.*?(\d+\.\d+\.\d+)/s.exec(cl);
    if (cm) return { found: true, detail: `MSVC ${cm[1]}` };
    if (cl.trim().length > 0) return { found: true, detail: 'MSVC' };
    return { found: false, detail: '' };
}

/**
 * 磁盘可用空间（MiB）。
 *
 * ⚠️ 用 `fs.statfsSync`（Node 18.15+）。本项目 target 是 Obsidian 桌面端的内置 Node，
 *    版本足够；但在极老的环境里它会缺失 ⇒ 用 try 兜住，返回 0 表示「不知道」，
 *    ⛔ 不要返回一个假数字让用户以为磁盘快满了。
 */
export function probeFreeDiskMb(dir: string): number {
    try {
        const fsMod = require('fs') as { statfsSync?: (p: string) => { bavail: number; bsize: number } };
        if (typeof fsMod.statfsSync !== 'function') return 0;
        const st = fsMod.statfsSync(dir);
        const bytes = st.bavail * st.bsize;
        if (!Number.isFinite(bytes) || bytes <= 0) return 0;
        return Math.round(bytes / (1024 * 1024));
    } catch {
        return 0;
    }
}

/**
 * 一次性采全部数据。
 *
 * ⚠️ 故意**并发**跑四个探测：串行的话在没装任何工具链的机器上要等 4 次超时（16 秒），
 *    用户打开设置页会以为卡死了。
 */
export async function probeHardware(dir: string): Promise<{
    gpus: { name: string; vramMb: number }[];
    totalMemMb: number;
    freeDiskMb: number;
    cmake: { found: boolean; version: string };
    cpp: { found: boolean; detail: string };
    probeError: string;
}> {
    const [gpuRes, cmake, cpp] = await Promise.all([probeGpus(), probeCmake(), probeCpp()]);
    return {
        gpus: gpuRes.gpus,
        totalMemMb: probeTotalMemMb(),
        freeDiskMb: probeFreeDiskMb(dir),
        cmake,
        cpp,
        probeError: gpuRes.error,
    };
}
