// 操作系统品牌标（纯数据，无 obsidian 依赖，可单测）。
//
// 🔴 由来（用户 m07854 ⑤）：「将文字转语音组下的『系统语音』和『硅基流动』标题前的小图标
//    改成对应品牌图标」。
//    · 硅基流动本来就有官方标（`pure/aiIcons` 的 `AI_PROVIDER_ICON.siliconflow`，slug `siliconcloud`）
//      —— 那一头直接复用，⛔ 不再抄第二份路径。
//    · 「系统语音」是**操作系统自带**的 TTS（Windows SAPI / macOS AVSpeech），它没有单一厂商品牌；
//      当场问过用户，用户选的就是「用当前操作系统的品牌标（Windows 上显示 Windows 标）」
//      ⇒ 这张表就是那个「当前操作系统」的标。
//
// 来源与许可
//   · simple-icons（https://simpleicons.org），**CC0-1.0 公共领域**；品牌商标权仍属各家。
//     仅用于「指代该来源」这一指代性用途（与 `pure/sourceIcons` / `pure/aiIcons` 同一纪律）。
//   ⚠️ **Windows 标已从 simple-icons v13+ 移除**（实测 v13 / v14 / v15 / v16 全 404），
//      只剩 v11 / v12 有 ⇒ 本表用的是 **v12** 的四格方块（92 字符单路径）。
//      ⛔ 别拿别的四格近似标顶替：换了就不是 Windows 官方的那个形状了。
//   ⚠️ 生成器/探针：`_probe_os_icons*.cjs` 从 CDN 取回并实测 `viewBox` + 路径数 + 长度；
//      ⛔ 别手抄路径（本仓与 `_gen_source_icons.cjs` 同一条纪律）。
//
// ⚠️ 本表**不存品牌 hex**：渲染端 `services/aiIcon.renderAiIcon` 统一 `currentColor`，
//    深色主题自动跟随（与 `pure/sourceIcons` / `pure/aiIcons` 完全同口径）。
// ⚠️ 内置标那条分治逻辑只准有一份 —— 渲染一律走 `renderAiIcon`，⛔ 别在本表另写渲染函数。

import type { AiIcon } from 'pure/aiIcons';

/** 本表认得的操作系统（`process.platform` 的三种桌面取值；其余平台回退内置标） */
export type OsKey = 'win32' | 'darwin' | 'linux';

/**
 * 三大桌面的品牌标。
 *
 * ⚠️ Linux 的官方标（simple-icons `linux`，Tux 企鹅）是**单路径 5354 字符**——
 *    比本表另外两个加起来还大一个量级。它只在 Linux 上才会被画，为此多背 5KB 不值，
 *    ⇒ 这里刻意**不给 Linux 品牌标**，让它回退内置 `monitor` 标（语义仍准确：本机）。
 *    ⛔ 别为了「三平台齐整」把它塞进来。
 */
export const OS_ICON: Record<'win32' | 'darwin', AiIcon> = {
    /** simple-icons v12 `windows`（v13+ 已移除）。四格方块，24×24 单路径。 */
    win32: {
        kind: 'brand',
        slug: 'windows',
        viewBox: '0 0 24 24',
        d: 'M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623',
    },
    /** simple-icons v16 `apple`。两个子路径合在一条 `d` 里（果子 + 叶子）。 */
    darwin: {
        kind: 'brand',
        slug: 'apple',
        viewBox: '0 0 24 24',
        d: 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
    },
};

/**
 * 当前运行平台；**移动端安全**。
 *
 * 🔴🔴 2026-11-14（用户 m05673 手机实测报「设置页点页签后内容区一片空白」）：
 *    原写法 `platform: string = process.platform` 是**默认参数**，而默认参数在**每次调用时求值**
 *    ⇒ 手机端 WebView 里没有 `process` 全局，`systemVoiceIcon()` 一被调到就抛 `ReferenceError`。
 *    它又是 `renderPage()` 链上的一环，一抛就把整个「建设置页」的循环打断 —— 见 `Settings.display()`。
 *    ⛔ 永远不要在模块顶层或默认参数里裸写 `process.*`；一律走这里。
 *
 * 移动端（`process` 不存在）返回空串 ⇒ 调用方回退内置图标，而不是崩。
 */
export function currentPlatform(): string {
    // ⚠️ `typeof process === 'undefined'` 这个判断本身是安全的（typeof 对未声明标识符不抛），
    //    但**不能**写成 `process.platform ?? ''` —— 那会在 `process` 未声明时直接抛。
    if (typeof process === 'undefined' || !process) return '';
    const p = (process as { platform?: unknown }).platform;
    return typeof p === 'string' ? p : '';
}

/**
 * 「系统语音」该挂哪颗标：优先当前操作系统的品牌标，认不出平台就回退内置 `monitor`。
 *
 * ⚠️ 判据是**跑插件的那台机器**（`process.platform`），不是「被朗读的那本书」——
 *    系统语音用的是本机 TTS，这里显示的本来就该是「谁在发声」。
 * ⚠️ 参数化 `platform` 只是为了让单测能在任意机器上跑三条分支，⛔ 别在生产代码里传第二个值。
 */
export function systemVoiceIcon(platform: string = currentPlatform()): AiIcon {
    if (platform === 'win32' || platform === 'darwin') return OS_ICON[platform];
    return { kind: 'builtin', id: 'monitor' };
}
