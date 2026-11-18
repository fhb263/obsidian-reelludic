/**
 * 语音转文字「AI 运行管家」的硬件数据层：解析 + 预估 + 判定。
 *
 * 🔴 为什么单独抽一个纯函数模块（而不是直接写进 `Settings.ts` / `main.ts`）：
 *    用户 m05717 ① 要的三块内容里，「环境体检」「资源预估」全是**数值判定**
 *    （显存够不够、CUDA 在不在、CMake 什么版本）。这些判据一旦埋在渲染代码里，
 *    单测摸不到、真机只能肉眼看，出错了没人拦得住。
 *    抽出来之后：探测是「拿字符串」、判定是「纯函数」，两边分别可验。
 *
 * ⛔ 这里**不做任何 IO**：不 spawn、不读盘、不 require('os')。
 *    所有真实数据由 `services/asrHardwareProbe.ts` 采回来，本模块只负责解读。
 *    这样在 node 环境（vitest）里可以直接拿假输出把每条判据钉住。
 */

/** 一块显卡。`vramMb` 是**总显存**（MiB）。 */
export interface GpuInfo {
    name: string;
    vramMb: number;
}

/** 一次硬件探测的完整结果。任何一项探测失败都不该让整块面板崩掉。 */
export interface HardwareInfo {
    gpus: readonly GpuInfo[];
    /** 物理内存总量（MiB）；探测失败为 0。 */
    totalMemMb: number;
    /** 正在跑的这个 Node 进程所在盘符的剩余空间（MiB）；探测失败为 0。 */
    freeDiskMb: number;
    /** CMake 是否可用（只有 whitelist 里的「源码编译」路线才需要）。 */
    cmake: { found: boolean; version: string };
    /** C++ 编译器是否可用（同上）。 */
    cpp: { found: boolean; detail: string };
    /** 探测本身出问题时的原话，用于在界面上如实说明而不是假装一切正常。 */
    probeError: string;
}

/** 空结果：探测还没跑、或整机都探不到时用它。 */
export const EMPTY_HARDWARE: HardwareInfo = {
    gpus: [],
    totalMemMb: 0,
    freeDiskMb: 0,
    cmake: { found: false, version: '' },
    cpp: { found: false, detail: '' },
    probeError: '',
};

/**
 * 解析 `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` 的输出。
 *
 * 真实输出长这样（每卡一行）：
 * ```
 * NVIDIA GeForce RTX 4060 Laptop GPU, 8188
 * ```
 * ⚠️ 显卡名自己可能**带逗号**（极少见但存在，例如某些 OEM 定制名），
 *    所以不能简单 `split(',')` 取第 0 段 —— 要从**右**边取最后一段当显存。
 * ⚠️ 没装 NVIDIA 驱动时该命令根本不存在，调用方拿到的是 `''` ⇒ 返回空数组，
 *    ⛔ 不要把它当成「探测失败」报错：这是占绝大多数的正常情况（集显/AMD/无卡）。
 */
export function parseNvidiaSmi(output: string): GpuInfo[] {
    const out: GpuInfo[] = [];
    for (const rawLine of String(output ?? '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const cut = line.lastIndexOf(',');
        if (cut <= 0) continue;
        const name = line.slice(0, cut).trim();
        const mem = Number.parseInt(line.slice(cut + 1).trim(), 10);
        if (!name || !Number.isFinite(mem) || mem <= 0) continue;
        out.push({ name, vramMb: mem });
    }
    return out;
}

/** 把 MiB 说成人话：`8188` → `8.0 GB`；`512` → `512 MB`。 */
export function formatMb(mb: number): string {
    if (!Number.isFinite(mb) || mb <= 0) return '0 MB';
    // 1024 MB 以下直接按 MB 说 —— 「0.5 GB」不如「512 MB」直观
    if (mb < 1024) return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * 把目录里的 `size` 文案（`'75 MB'` / `'1.5 GB'` / `'3.2 GB'`）换回 MiB。
 *
 * ⚠️ 这是**展示值反解**，不是真实字节数：`asrCatalog` 里写的 `1.5 GB` 是四舍五入过的。
 *    用于「预估占用」足够（用户要的是量级），⛔ 别拿它去判「磁盘放得下吗」——
 *    那个要按真实字节算（`asrInstallPlan` 里有精确值）。
 */
export function sizeLabelToMb(label: string): number {
    const m = /^\s*([\d.]+)\s*(GB|MB|G|M)\s*$/i.exec(String(label ?? ''));
    if (!m) return 0;
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const unit = m[2].toUpperCase();
    return Math.round(unit.startsWith('G') ? n * 1024 : n);
}

/** 资源预估：跑这一档大概要吃多少显存 / 内存。 */
export interface Footprint {
    /** 预计显存占用（MiB）；0 = 这一档不吃显存。 */
    vramMb: number;
    /** 预计内存占用（MiB）。 */
    ramMb: number;
}

/**
 * 估算某一档在指定设备上的占用。
 *
 * 系数怎么来的（都是**保守上界**，宁可说多一点也别让用户 OOM）：
 *  · 权重本身 = 目录里标的体积；
 *  · 推理时还要放一份激活/KV/中间张量，经验值约 +20%（大模型）到 +10%（小模型）；
 *  · 进程自身与运行时（llama.cpp / sherpa / onnxruntime）再固定 +256MB 显存 / +512MB 内存。
 *
 * ⚠️ CPU 路径**不吃显存**（`vramMb: 0`）—— 别为了「看起来对称」给它编一个数。
 */
export function estimateFootprint(sizeLabel: string, device: 'cpu' | 'gpu'): Footprint {
    const base = sizeLabelToMb(sizeLabel);
    if (base <= 0) return { vramMb: 0, ramMb: 0 };
    // 大档位的激活开销比例更高：>2GB 用 20%，否则 10%
    const ratio = base > 2048 ? 0.2 : 0.1;
    const weights = Math.ceil(base * (1 + ratio));
    if (device === 'gpu') {
        return { vramMb: weights + 256, ramMb: 512 };
    }
    return { vramMb: 0, ramMb: weights + 512 };
}

/** 显存够不够。没显卡时恒为 false（但界面上不该画红叉，见 `cudaRowState`）。 */
export function vramFits(needMb: number, gpu: GpuInfo | null): boolean {
    if (!gpu || needMb <= 0) return false;
    return gpu.vramMb >= needMb;
}

/**
 * 「运行设备」里 GPU 那一项该是什么状态。
 *
 * 三种结果，与用户 m05717 ① 的措辞一一对应：
 *  · `'selectable'` —— 有 N 卡、驱动正常、且这一档放得下 ⇒ 可点
 *  · `'no-gpu'` —— 整机没探到 N 卡 ⇒ 显示「未检测到，将默认使用 CPU」并**灰色置底**
 *  · `'too-small'` —— 有卡但显存不够这一档 ⇒ 可点但标红提示换小档位
 *
 * 🔴 用户原话：「没有独显的情况下 GPU 项显示『未检测到，将默认使用 CPU』并灰色置底，
 *    不要用红叉吓唬」。所以「没卡」是**中性状态**，不是错误。
 */
export type GpuRowState = 'selectable' | 'no-gpu' | 'too-small';

export function gpuRowState(gpu: GpuInfo | null, needMb: number): GpuRowState {
    if (!gpu) return 'no-gpu';
    if (needMb > 0 && gpu.vramMb < needMb) return 'too-small';
    return 'selectable';
}

/**
 * 默认运行设备。
 *
 * ⚠️ 当前**恒回 `'cpu'`**，这不是偷懒：本项目安装的全部是 CPU 版运行时
 *    （`llama-b12244-bin-win-cpu-x64.zip`、whisper 的 `ggml-cpu.dll`、sherpa 的 CPU 二进制），
 *    就算机器上有 4090，装进来的程序也用不上它。
 *    GPU 项因此只做「探测 + 说明」，⛔ 不做成默认值 —— 那会让用户以为开箱即用 GPU。
 */
export function defaultDevice(hw: HardwareInfo): 'cpu' | 'gpu' {
    // 保留参数：将来真接了 CUDA 运行时，这里改成「有卡且够用就 gpu」即可，
    // ⛔ 别现在就写 `return hw.gpus.length > 0 ? 'gpu' : 'cpu'` —— 那是假的。
    void hw;
    return 'cpu';
}

/** 预估是否超出现有资源，超了就返回一句给人看的话；没问题返回空串。 */
export function footprintWarning(fp: Footprint, device: 'cpu' | 'gpu', hw: HardwareInfo): string {
    if (device === 'gpu') {
        const gpu = hw.gpus[0] ?? null;
        if (!gpu) return '没检测到独立显卡，这一档会在 CPU 上跑。';
        if (fp.vramMb > gpu.vramMb) {
            const over = fp.vramMb - gpu.vramMb;
            return `显存不够：这一档预计要吃 ${formatMb(fp.vramMb)}，本机只有 ${formatMb(gpu.vramMb)}（差 ${formatMb(over)}）。建议换 INT8 / 小一档。`;
        }
        return '';
    }
    if (hw.totalMemMb > 0 && fp.ramMb > hw.totalMemMb) {
        return `内存不够：这一档预计要吃 ${formatMb(fp.ramMb)}，本机只有 ${formatMb(hw.totalMemMb)}。`;
    }
    return '';
}

/**
 * CMake / C++ 编译工具的状态行。
 *
 * 🔴 只有 whisper.cpp 的**源码编译**路线才需要它们；插件默认走的是预编译发布包，
 *    所以这两个缺失**不该挡住任何事** —— 界面上显示为「⚠ 可选」而不是红叉。
 *    ⛔ 别把可选依赖画成必需依赖：用户会以为不装就跑不了。
 */
export type OptionalToolState = 'ok' | 'missing';

export function optionalToolState(found: boolean): OptionalToolState {
    return found ? 'ok' : 'missing';
}

/** 一句概括当前的「环境体检」是否致命（有红叉就致命）。 */
export function hasFatalMissing(items: readonly { ok: boolean }[]): boolean {
    return items.some((it) => !it.ok);
}
