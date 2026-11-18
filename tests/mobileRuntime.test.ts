/**
 * 🔴 2026-11-14（用户 m05673 手机实测）：移动端运行时的**真实差异**必须变成单测。
 *
 * 用户原话：「有在设置点一下只显示顶部页签而不是基本设置也签内容设置高级集成，播放阅读，
 * ai显示，搜索配置的原数据源配置启用有的分两行有的一行显示空白一片应该给个提示不支持
 * 还有默认导航布局应该为合并视图以适应手机端竖屏显示」
 *
 * ## 为什么这个文件必须存在
 *
 * Obsidian 手机版**不是 Electron**，是 Capacitor WebView —— 那里**没有 `process` 全局**。
 * 本次事故的根因就一行：
 *
 * ```ts
 * export function systemVoiceIcon(platform: string = process.platform): AiIcon
 * ```
 *
 * 默认参数**每次调用时求值** ⇒ `systemVoiceIcon()` 在手机上抛 `ReferenceError`；
 * 而它挂在 `Settings.display()` 的建页循环上 ⇒ 循环整个中断 ⇒ 页签在、内容区全白。
 *
 * ## 这个文件守的是什么
 *
 * 桌面端永远测不出这类 bug（`process` 一定存在），所以必须**显式把 `process` 删掉**再跑。
 * 本机实测：Node 26 里 `globalThis.process` 是 `configurable: true` 的 getter，
 * `delete globalThis.process` 可行、`typeof process === 'undefined'` 判断安全、能完整还原
 * （见 `withMobileRuntime` 的 finally）。
 *
 * ⚠️ 这个文件**只覆盖逻辑**（不计算布局、`getBoundingClientRect` 恒为 0）。
 *    视觉层面（窄屏行、徽标位置、合并视图观感）要靠 `tools/rd.cjs` 的移动模拟档，
 *    ⛔ 别指望这里给出"长得好不好看"的结论。
 */

import { describe, expect, it } from 'vitest';

import { currentPlatform, systemVoiceIcon } from 'pure/osIcons';
import { installSupported, installUnsupportedMessage } from 'pure/whisperRuntime';

/**
 * 在「没有 `process` 全局」的环境里跑一段代码，跑完**一定**还原。
 *
 * 🔴 为什么是 `delete` 而不是 `globalThis.process = undefined`：
 *    真实 WebView 里 `process` 是**未声明**的（连这个属性都没有），
 *    而 `= undefined` 会让 `'process' in globalThis === true` ——
 *    有些代码用 `'process' in globalThis` 或 `globalThis.process?.platform` 判断，
 *    两种形态行为不同。要模拟就模拟到底。
 */
function withMobileRuntime<T>(fn: () => T): T {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'process');
    const saved = had ? (globalThis as { process?: unknown }).process : undefined;
    // 记录描述符，尽量按原样还原（Node 里它是 getter，直接赋值也能work，但不保证）
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'process');
    delete (globalThis as { process?: unknown }).process;
    try {
        return fn();
    } finally {
        if (desc) Object.defineProperty(globalThis, 'process', desc);
        else if (had) (globalThis as { process?: unknown }).process = saved;
    }
}

describe('🔴 2026-11-14 m05673 · 移动端没有 process 全局（本次白屏事故的根因）', () => {
    it('环境自检：withMobileRuntime 里 process 真的不存在，出来后完整还原', () => {
        // 先进去看一眼
        withMobileRuntime(() => {
            expect(typeof process).toBe('undefined');
            expect('process' in globalThis).toBe(false);
        });
        // 出来后必须还在（否则后面所有测试都跑在假环境里，且污染全局）
        expect(typeof process).not.toBe('undefined');
        expect(typeof process.pid).toBe('number');
        expect(globalThis.process.version).toMatch(/^v\d+\./);
    });

    it('`currentPlatform()` 在移动端返回空串，⛔ 不抛 ReferenceError', () => {
        withMobileRuntime(() => {
            expect(() => currentPlatform()).not.toThrow();
            expect(currentPlatform()).toBe('');
        });
    });

    it('`systemVoiceIcon()` 无参调用在移动端不抛，回退内置 `monitor` 标', () => {
        // ⚠️ 这就是事故现场那一行：默认参数 `= process.platform` 会在调用时求值。
        //    改成 `= currentPlatform()` 之后才安全 —— 这条断言锁死那个改法。
        withMobileRuntime(() => {
            expect(() => systemVoiceIcon()).not.toThrow();
            expect(systemVoiceIcon()).toEqual({ kind: 'builtin', id: 'monitor' });
        });
    });

    it('桌面端行为不变（同一函数、两种环境都要对）', () => {
        // 桌面上照样给品牌标，不能为了"移动端安全"把桌面功能改没了
        expect(systemVoiceIcon('win32').kind).toBe('brand');
        expect(systemVoiceIcon('darwin').kind).toBe('brand');
        expect(systemVoiceIcon('linux')).toEqual({ kind: 'builtin', id: 'monitor' });
        expect(currentPlatform()).toBe(process.platform);
    });

    it('ASR 装不了时的文案：空平台先被拦下，⛔ 不落到「用你的包管理器安装」', () => {
        withMobileRuntime(() => {
            const platform = currentPlatform();
            expect(platform).toBe('');
            expect(installSupported(platform)).toBe(false);
            const msg = installUnsupportedMessage(platform);
            expect(msg).toContain('电脑版 Obsidian');
            expect(msg).toContain('手机');
            // 手机上「用包管理器安装」是完全做不到的事，出现即为文案 bug
            expect(msg).not.toContain('包管理器');
            expect(msg).not.toContain('Homebrew');
        });
    });
});
