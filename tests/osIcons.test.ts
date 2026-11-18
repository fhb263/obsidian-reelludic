// 操作系统品牌标的守卫（用户 m07854 ⑤）。
//
// 🔴 由来（用户逐字）：「将文字转语音组下的『系统语音』和『硅基流动』标题前的小图标
//    改成对应品牌图标」。
//    · 硅基流动有官方标 ⇒ 复用 `AI_PROVIDER_ICON.siliconflow`（⛔ 不新抄）；
//    · 「系统语音」是操作系统自带 TTS，没有单一厂商品牌 ⇒ 当场问过用户，
//      用户选「用当前操作系统的品牌标（Windows 上显示 Windows 标）」。
//
// ⚠️ 为什么是源码文本守卫而不是快照：
//    要锁的是「图标从哪来」这条**接线**（谁能被复用、谁必须回退），
//    而不是某个具体像素；`setIcon` 写错名字会被静默吞掉、tsc 也不会红。
//
// ⛔ 铁律：先 strip 注释再匹配（本仓被自己的注释打穿三次：#379 / #730 / #731）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OS_ICON, systemVoiceIcon } from 'pure/osIcons';
import { AI_PROVIDER_ICON } from 'pure/aiIcons';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('pure/osIcons · 三大桌面品牌标', () => {
    it('Windows / Apple 都是品牌标（填充式），且带正确的 viewBox', () => {
        for (const key of ['win32', 'darwin'] as const) {
            const icon = OS_ICON[key];
            expect(icon.kind).toBe('brand');
            if (icon.kind !== 'brand') return;
            expect(icon.viewBox).toBe('0 0 24 24');
            // ⛔ 不存品牌 hex：渲染端统一 currentColor，深色主题才跟得上
            expect(icon.d).not.toMatch(/fill\s*=|#[0-9a-fA-F]{3,6}/);
        }
    });

    it('Windows 用的是 v12 的四格方块（v13+ 已从 simple-icons 移除）', () => {
        const icon = OS_ICON.win32;
        expect(icon.kind === 'brand' && icon.slug).toBe('windows');
        // 四格方块路径极短（92 字符）—— 换成别的近似标就不会是这个长度/形状
        expect(icon.kind === 'brand' && icon.d.startsWith('M0,0H11.377V11.372H0Z')).toBe(true);
        expect(icon.kind === 'brand' && icon.d.length).toBeLessThan(120);
    });

    it('Apple 标是单条 d 里含两个子路径（果子 + 叶子）', () => {
        const icon = OS_ICON.darwin;
        expect(icon.kind === 'brand' && icon.slug).toBe('apple');
        expect(icon.kind === 'brand' && icon.d.split('M').length - 1).toBeGreaterThanOrEqual(2);
    });

    it('⛔ 刻意不给 Linux 品牌标（Tux 单路径 5354 字符，为此多背 5KB 不值）', () => {
        expect(Object.keys(OS_ICON).sort()).toEqual(['darwin', 'win32']);
        expect('linux' in OS_ICON).toBe(false);
    });
});

describe('systemVoiceIcon · 按当前操作系统取标', () => {
    it('Windows 上挂 Windows 标、macOS 上挂 Apple 标', () => {
        expect(systemVoiceIcon('win32')).toEqual(OS_ICON.win32);
        expect(systemVoiceIcon('darwin')).toEqual(OS_ICON.darwin);
    });

    it('认不出的平台回退内置 monitor（⛔ 不许留空白图标）', () => {
        expect(systemVoiceIcon('linux')).toEqual({ kind: 'builtin', id: 'monitor' });
        expect(systemVoiceIcon('freebsd')).toEqual({ kind: 'builtin', id: 'monitor' });
    });

    /**
     * 🔴 2026-11-14（用户 m05673 手机实测报「设置页内容一片空白」）：
     * 移动端 WebView 里**没有 `process` 全局**。`currentPlatform()` 遇此返回空串，
     * `systemVoiceIcon()` 必须安静回退 `monitor`，⛔ 绝不能抛。
     */
    it('🔴 移动端（拿不到平台）静默回退 monitor，⛔ 不抛异常', () => {
        expect(() => systemVoiceIcon('')).not.toThrow();
        expect(systemVoiceIcon('')).toEqual({ kind: 'builtin', id: 'monitor' });
    });

    it('currentPlatform() 在无 `process` 的环境下返回空串而不炸', async () => {
        const { currentPlatform } = await import('pure/osIcons');
        // 本机（Node）有 process ⇒ 返回真实平台；这里只钉「类型是字符串且不抛」。
        expect(typeof currentPlatform()).toBe('string');
    });

    it('默认参数取当前进程平台（不传参就是本机）', () => {
        const actual = systemVoiceIcon();
        expect(actual).toEqual(systemVoiceIcon(process.platform));
    });
});

describe('设置页接线（用户 m07854 ⑤）', () => {
    const src = stripComments(read('src/Settings.ts'));

    it('🔴 左栏两行都走品牌标：云端 = 硅基流动官方标，本地 = 当前操作系统', () => {
        expect(src).toContain(
            "renderAiIcon(ico, value === 'cloud' ? AI_PROVIDER_ICON.siliconflow : systemVoiceIcon());",
        );
        // 反向守卫：旧的 `cloud` / `house` 内置标不许回来
        expect(src).not.toContain("safeSetIcon(ico, value === 'cloud' ? 'cloud' : 'house');");
        // 🔴 2026-11-14（用户 m05673 手机实测）：import 现在多带 `currentPlatform` ——
        //    `systemVoiceIcon()` 的默认参数原本直接写 `process.platform`，手机端没有 `process`
        //    ⇒ `ReferenceError` ⇒ 打断整个 `Settings.display()` ⇒ 页签在、内容全空。
        //    ⛔ 别再把这条断言改回「只有 systemVoiceIcon」的旧字面量。
        expect(src).toContain("import { currentPlatform, systemVoiceIcon } from 'pure/osIcons';");
    });

    it('🔴 右上音色格标题的行头图标同样换标（两处必须一致，否则同一段自相矛盾）', () => {
        expect(src).toContain(
            "renderAiIcon(topHead.createSpan({ cls: 'rl-asr-top-icon' }), kind === 'cloud' ? AI_PROVIDER_ICON.siliconflow : systemVoiceIcon());",
        );
        // 反向守卫：右上那颗也不许退回内置 `volume-2`
        expect(src).not.toMatch(/safeSetIcon\(topHead\.createSpan\(\{ cls: 'rl-asr-top-icon' \}\)/);
    });

    it('硅基流动的标只从 AI_PROVIDER_ICON 取（⛔ 别抄第二份品牌路径）', () => {
        // 只允许出现「引用」，不许出现内联的 siliconcloud 路径片段
        expect(src).toContain('AI_PROVIDER_ICON.siliconflow');
        expect(src).not.toContain('M22.956 6.521');
    });
});

describe('样式：品牌标必须跟随行文字色', () => {
    const css = stripComments(read('styles.css'));
    const rule = (selector: string): string => {
        const head = new RegExp('(?:^|[}])\\s*([^{}]*?)\\{', 'gm');
        let m: RegExpExecArray | null;
        while ((m = head.exec(css))) {
            const list = m[1].split(',').map((s) => s.trim());
            if (!list.includes(selector)) continue;
            const open = css.indexOf('{', m.index + m[0].length - 1);
            const close = css.indexOf('}', open);
            return close < 0 ? '' : css.slice(open + 1, close);
        }
        return '';
    };

    it('🔴 左栏 / 右上图标都要 color: inherit（否则未选中的灰行上亮一颗蓝标，像已选中）', () => {
        for (const sel of ['.rl-asr-navi-icon.rl-ai-icon', '.rl-asr-top-icon.rl-ai-icon']) {
            const body = rule(sel);
            expect(body, `${sel} 规则不存在`).not.toBe('');
            expect(body).toMatch(/color:\s*inherit/);
        }
    });

    it('⛔ 不许写死品牌 hex', () => {
        const body = rule('.rl-asr-navi-icon.rl-ai-icon');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});
