// 游戏「本地 swf 直接玩」纯逻辑守卫（2026-11-16 用户裁定路线「C → A」）。
//
// 三条不回潮口径（本文件的意义 = 把真机踩出来的结论钉住）：
//   ① swf 的扩展名判据必须**独立**于「可启动文件」（.lnk/.exe）判据 —— 两者的下游行为完全不同
//      （一个是 shell.openPath 交给系统，一个是塞进 Ruffle 播），混在一起会让「检索本地」把 .swf 当程序启动。
//   ② Ruffle 运行时完整性 = 入口 + wasm + **core 分包**三样齐 —— 缺 core 分包时 Ruffle 报的是
//      `Failed to begin SWF load: Error: Failed to load Ruffle WASM`，极具误导性，判据必须挡住半装状态。
//   ③ 解压只落 .js / .wasm —— ⛔ 别把 .map / README / LICENSE 也铺进插件目录（白占地方且误导）。
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
    FLASH_EXTS,
    isFlashPath,
    isRuffleRuntimeComplete,
    shouldKeepRuffleFile,
    flashFrameHtml,
    RUFFLE_BUNDLE_URL,
    RUFFLE_ENTRY_FILE,
    RUFFLE_VERSION,
} from '../src/pure/flashGame';

const SRC = readFileSync(new URL('../src/pure/flashGame.ts', import.meta.url), 'utf8');

describe('isFlashPath：只有 .swf 才算 Flash 影片', () => {
    it('认 .swf（大小写不敏感）', () => {
        expect(isFlashPath('game.swf')).toBe(true);
        expect(isFlashPath('GAME.SWF')).toBe(true);
        expect(isFlashPath('d:/games/黄金矿工.Swf')).toBe(true);
    });

    it('不认其他可启动文件与普通文件', () => {
        expect(isFlashPath('game.lnk')).toBe(false);
        expect(isFlashPath('game.exe')).toBe(false);
        expect(isFlashPath('game.bat')).toBe(false);
        expect(isFlashPath('game.swf.txt')).toBe(false);
        expect(isFlashPath('swf')).toBe(false);
        expect(isFlashPath('')).toBe(false);
    });

    it('扩展名集合只有 swf 一条（⛔ 别把 lnk/exe 混进来）', () => {
        expect([...FLASH_EXTS]).toEqual(['swf']);
    });
});

describe('isRuffleRuntimeComplete：入口 + wasm + core 分包，三样齐才算装好', () => {
    const FULL = ['ruffle.js', 'core.ruffle.abc123.js', 'core.ruffle.def456.js', 'aaa.wasm', 'bbb.wasm'];

    it('完整包判为完整', () => {
        expect(isRuffleRuntimeComplete(FULL)).toBe(true);
    });

    it('缺 core 分包判为不完整（真机踩过的坑：会报那句误导性的 WASM 错误）', () => {
        expect(isRuffleRuntimeComplete(['ruffle.js', 'aaa.wasm'])).toBe(false);
    });

    it('缺入口 / 缺 wasm 都判为不完整', () => {
        expect(isRuffleRuntimeComplete(['core.ruffle.a.js', 'aaa.wasm'])).toBe(false);
        expect(isRuffleRuntimeComplete(['ruffle.js', 'core.ruffle.a.js'])).toBe(false);
    });

    it('大小写不敏感 + 空输入安全', () => {
        expect(isRuffleRuntimeComplete(['RUFFLE.JS', 'CORE.RUFFLE.A.JS', 'X.WASM'])).toBe(true);
        expect(isRuffleRuntimeComplete([])).toBe(false);
        expect(isRuffleRuntimeComplete(null as unknown as string[])).toBe(false);
    });

    it('入口文件名常量与判据一致（⛔ 两处写死会漂）', () => {
        expect(RUFFLE_ENTRY_FILE).toBe('ruffle.js');
        expect(isRuffleRuntimeComplete([RUFFLE_ENTRY_FILE, 'ruf.wasm', 'core.ruffle.x.js'])).toBe(true);
    });
});

describe('shouldKeepRuffleFile：只落 .js / .wasm', () => {
    it('保留脚本与 wasm', () => {
        expect(shouldKeepRuffleFile('ruffle.js')).toBe(true);
        expect(shouldKeepRuffleFile('core.ruffle.abc.js')).toBe(true);
        expect(shouldKeepRuffleFile('172de42e.wasm')).toBe(true);
    });

    it('丢掉 map / 说明 / 许可 / 目录项', () => {
        expect(shouldKeepRuffleFile('ruffle.js.map')).toBe(false);
        expect(shouldKeepRuffleFile('README.md')).toBe(false);
        expect(shouldKeepRuffleFile('LICENSE_APACHE')).toBe(false);
        expect(shouldKeepRuffleFile('package.json')).toBe(false);
        expect(shouldKeepRuffleFile('assets/')).toBe(false);
        expect(shouldKeepRuffleFile('')).toBe(false);
    });
});

describe('flashFrameHtml：播发页的关键约束', () => {
    const html = flashFrameHtml({
        ruffleBaseUrl: 'app://abc/x/ruffle',
        swfUrl: 'app://abc/x/game.swf',
        title: '黄金矿工',
    });

    it('publicPath 自动补尾斜杠（不给会让 Ruffle 去找 ruffle.js/ruffle.js）', () => {
        expect(html).toContain('publicPath: "app://abc/x/ruffle/"');
    });

    it('入口脚本指向同一基址下的 ruffle.js', () => {
        expect(html).toContain('<script src="app://abc/x/ruffle/ruffle.js"></script>');
    });

    it('swf 与标题都进了页面', () => {
        expect(html).toContain('app://abc/x/game.swf');
        expect(html).toContain('<title>黄金矿工</title>');
    });

    it('`</script>` 注入被转义（URL 里出现尖括号不会截断脚本块）', () => {
        const evil = flashFrameHtml({
            ruffleBaseUrl: 'app://a/r',
            swfUrl: 'app://a/</script><script>alert(1)</script>.swf',
        });
        // 原文里不应再出现能闭合脚本的裸序列
        expect(evil).not.toContain('</script><script>alert(1)</script>');
        expect(evil).toContain('\\u003c/script\\u003e');
    });

    it('标题做 HTML 转义（⛔ 不拿它当注入点）', () => {
        const t = flashFrameHtml({
            ruffleBaseUrl: 'app://a/r',
            swfUrl: 'app://a/g.swf',
            title: '<img src=x onerror=alert(1)>',
        });
        expect(t).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(t).not.toContain('<img src=x');
    });

    it('scale 透传给 Ruffle（默认 showAll：等比完整显示、留黑边）', () => {
        expect(html).toContain('scale: "showAll"');
        const zoom = flashFrameHtml({ ruffleBaseUrl: 'app://a/r', swfUrl: 'app://a/g.swf', scale: 'noBorder' });
        expect(zoom).toContain('scale: "noBorder"');
    });

    it('按需下载地址指向 web-selfhosted 包（⛔ 不是 nightly / npm 包）', () => {
        expect(RUFFLE_BUNDLE_URL).toContain('web-selfhosted.zip');
        expect(RUFFLE_BUNDLE_URL).toContain(`v${RUFFLE_VERSION}`);
        expect(RUFFLE_BUNDLE_URL).not.toContain('nightly');
    });

    it('纯层不碰 obsidian / Node 文件系统（可单测、可被组件安全引用）', () => {
        expect(SRC).not.toMatch(/from 'obsidian'/);
        expect(SRC).not.toMatch(/\brequire\(/);
        expect(SRC).not.toMatch(/from 'fs'/);
    });
});
