// 游戏外壳四按钮 + 原生舞台尺寸 + 页面形态纠正 + 17yy ajax 的守卫（2026-11-16 用户 m04001 / m04298）。
//
// 五条不回潮口径（本文件的意义 = 把这一轮踩出来的结论钉住）：
//   ① 四按钮落在**宿主页工具栏**（`.rl-fg-tools`），⛔ 不在游戏画面里 ——
//      用户 m04298 逐字：「四个图标按钮是替换工具栏的重新载入和在库中定位的文字按钮啊
//      不是在游戏屏幕显示（两个文字按钮逻辑重复和没必要，删除掉）」。
//   ② 四按钮是**无边框透明图标按钮**，用 obsidian 自带图标（rotate-ccw / zoom-in /
//      zoom-out / maximize），⛔ 别退回带字带边框的方块按钮、也⛔ 不引外部 png。
//   ③ srcdoc 里**不再有任何浮层控件**：跨不过 iframe 边界，按钮改成 postMessage 发指令，
//      srcdoc 侧 `listen()` 收指令再操作 Ruffle/舞台。
//   ④ 缩放只改 `#stage` 的 `transform: scale()`，⛔ 别去改 ruffle 内部 canvas 的宽高 ——
//      那会让 Flash 以为舞台变了、触发重新布局，游戏里写死的坐标全部错位。
//   ⑤ 全屏调的是**本 iframe 自己**的 `requestFullscreen`，⛔ 别去调父窗口
//      （跨源拿不到父窗口，且会抢走 Obsidian 整个窗口）。
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { clampGameStage, flashFrameHtml, GAME_STAGE_MAX, GAME_STAGE_MIN, pickMainSwf } from '../src/pure/flashGame';
import {
    build17yySwfUrl,
    normalizeGamePageUrl,
    parse17yyAjaxParams,
    parseGameStage,
} from '../src/pure/flashFetch';

const GAME = readFileSync(new URL('../src/pure/flashGame.ts', import.meta.url), 'utf8');
const FETCH = readFileSync(new URL('../src/pure/flashFetch.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const VIEW = readFileSync(new URL('../src/views/FlashGameView.ts', import.meta.url), 'utf8');
const TYPES = readFileSync(new URL('../src/data/types.ts', import.meta.url), 'utf8');
const CATALOG = readFileSync(new URL('../src/data/catalog.ts', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

const HTML = flashFrameHtml({ ruffleBaseUrl: 'app://a/r', swfUrl: 'app://a/g.swf', title: '黄金矿工' });

/**
 * 剥掉注释后再断言（同 `tests/seriesProps.test.ts` 的做法）。
 * 🔴 为什么必须剥：`FlashGameView.ts` 里留着「用户逐字要求删掉『重新载入 / 在库中定位』」
 *    这类**记载裁定**的注释 —— 直接对原文断言 `not.toContain('重新载入')` 会被自己的注释打红，
 *    而注释恰恰是该留的（它解释了为什么删）。判据只该落在**代码**上。
 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const VIEW_CODE = stripComments(VIEW);

describe('外壳四按钮：重玩 / 放大 / 缩小 / 全屏（宿主页工具栏）', () => {
    it('四枚图标按钮在宿主页建，且顺序固定', () => {
        const order = ['rotate-ccw', 'zoom-in', 'zoom-out', 'maximize'].map((icon) =>
            VIEW.indexOf(`iconButton('rl-fg-icon', '${icon}'`),
        );
        expect(order.every((i) => i > 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('按钮用 obsidian 自带图标名，⛔ 不引外部 png、不靠字体字形', () => {
        expect(VIEW).toContain("iconButton('rl-fg-icon', 'rotate-ccw'");
        expect(VIEW).toContain("iconButton('rl-fg-icon', 'zoom-in'");
        expect(VIEW).toContain("iconButton('rl-fg-icon', 'zoom-out'");
        expect(VIEW).toContain("iconButton('rl-fg-icon', 'maximize'");
        expect(VIEW).not.toMatch(/btn_[a-z]+\.png/);
    });

    it('图标按钮是「无边框透明」（用户逐字要求）', () => {
        expect(CSS).toMatch(
            /\.rl-fg \.rl-fg-icon \{[^}]*background: transparent;[^}]*border: 0;[^}]*box-shadow: none;/,
        );
        // 反向：⛔ 不许出现实心底色 / 描边
        expect(CSS).not.toMatch(/\.rl-fg \.rl-fg-icon \{[^}]*border: 1px solid/);
    });

    it('两个文字按钮已被删除（用户判为「逻辑重复和没必要」）', () => {
        expect(VIEW_CODE).not.toContain('重新载入');
        expect(VIEW_CODE).not.toContain('在库中定位');
        expect(VIEW_CODE).not.toMatch(/rl-fg-btn/);
        expect(CSS).not.toMatch(/\.rl-fg \.rl-fg-btn \{/);
        // 连带的方法也一并删掉，⛔ 别留没人调的死代码
        expect(VIEW_CODE).not.toMatch(/private revealSwf\(/);
    });

    it('srcdoc 里不再有任何浮层控件（按钮归宿主）', () => {
        expect(HTML).not.toContain('id="bar"');
        expect(HTML).not.toMatch(/id="btn-(replay|in|out|full)"/);
        expect(HTML).not.toMatch(/#bar button/);
        // 反向断言立论：注释里说明「按钮归宿主工具栏」
        expect(GAME).toContain('工具按钮**不在**这里');
    });

    it('宿主点击 → postMessage 发指令；srcdoc 侧 listen() 收指令', () => {
        expect(VIEW).toContain("private sendGame(type: 'replay' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fullscreen'): void {");
        expect(VIEW).toContain('win.postMessage({ source: \'reelludic-flash\', type }, \'*\');');
        expect(VIEW).toContain("this.replayBtn.onclick = () => this.sendGame('replay');");
        expect(VIEW).toContain("this.zoomInBtn.onclick = () => this.sendGame('zoom-in');");
        expect(VIEW).toContain("this.zoomOutBtn.onclick = () => this.sendGame('zoom-out');");
        expect(VIEW).toContain("this.fullBtn.onclick = () => this.sendGame('fullscreen');");
        expect(GAME).toContain('function listen()');
        expect(GAME).toContain("if (!d || d.source !== 'reelludic-flash') return;");
        // ⛔ 别再长出 wire()（那套是 iframe 内浮动条的残留）
        expect(GAME).not.toContain('function wire()');
    });
});

describe('四按钮的行为：缩放 / 重玩 / 全屏', () => {
    it('缩放只改 transform，⛔ 不碰 ruffle canvas 的宽高', () => {
        expect(GAME).toContain("stage.style.transform = 'scale(' + zoom + ')';");
        expect(GAME).toContain("stage.style.transformOrigin = 'center center';");
        // 反向：不许出现改 canvas 尺寸的写法
        expect(GAME).not.toMatch(/canvas\.style\.(width|height)/);
        expect(GAME).not.toMatch(/canvas\.(width|height)\s*=/);
    });

    it('放大 ×4/3、缩小 ×0.75，且有上下限', () => {
        expect(GAME).toContain('var ZOOM_IN = 4 / 3;');
        expect(GAME).toContain('var ZOOM_OUT = 0.75;');
        expect(GAME).toContain('var ZOOM_MIN = 0.25;');
        expect(GAME).toContain('var ZOOM_MAX = 4;');
        expect(GAME).toContain('zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));');
    });

    it('到界时把对应按钮置灰（srcdoc 回报 → 宿主置灰）', () => {
        // srcdoc 侧：算 canIn / canOut 并 postMessage 回报
        expect(GAME).toContain("type: 'zoom', zoom: zoom,");
        expect(GAME).toMatch(/canIn: zoom < ZOOM_MAX[^,]*,\s*canOut: zoom > ZOOM_MIN/);
        // 宿主侧：按回报值置灰，⛔ 不自己猜缩放值
        expect(VIEW).toContain("if (this.zoomInBtn) this.zoomInBtn.disabled = d.canIn === false;");
        expect(VIEW).toContain("if (this.zoomOutBtn) this.zoomOutBtn.disabled = d.canOut === false;");
    });

    it('全屏调本 iframe 自己的 documentElement，⛔ 不调父窗口', () => {
        expect(GAME).toMatch(/requestFullscreen/);
        expect(GAME).not.toMatch(/parent\.document/);
        expect(VIEW).not.toMatch(/parent\.document/);
    });

    it('重玩先复位缩放再重新加载', () => {
        expect(GAME).toMatch(/msg\.classList\.remove\('is-on'\);\s*zoom = 1;\s*applyZoom\(\);\s*load\(\);/);
    });
});

describe('存档：srcdoc 的 localStorage 关页即销毁，所以「灌进去 + 回带来」', () => {
    const HTML_SAVED = flashFrameHtml({
        ruffleBaseUrl: 'app://a/r',
        swfUrl: 'app://a/g.swf',
        title: '黄金矿工',
        saves: { 'sda.4399.com/upload/x/game': 'TCSOxxxxxx' },
    });

    it('存档在 ruffle.js 之前灌进 localStorage（晚一步 Ruffle 就按「没存档」初始化完了）', () => {
        // 🔴 锚点必须精确到 `<script src=`：注释里也会出现 ruffle.js 字样，
        //    直接 `indexOf('ruffle.js')` 会命中注释，测出个假的先后关系。
        const saveIdx = HTML_SAVED.indexOf('localStorage.setItem(k, saves[k])');
        const scriptIdx = HTML_SAVED.indexOf('<script src=');
        expect(saveIdx).toBeGreaterThan(0);
        expect(scriptIdx).toBeGreaterThan(0);
        expect(saveIdx).toBeLessThan(scriptIdx);
    });

    it('存档快照注入前先过滤：只收非空字符串键值', () => {
        expect(GAME).toContain("typeof v === 'string' && v.length > 0");
        expect(GAME).toContain('Object.fromEntries(saveEntries)');
    });

    it('空 / 未传存档时不灌（首次玩）', () => {
        expect(HTML).toContain('var saves = {};');
    });

    it('回传只在有变化时发生（⛔ 别每 15 秒打空消息让宿主白写盘）', () => {
        expect(GAME).toContain('function watchSaves()');
        expect(GAME).toContain('if (now === last) return;');
        expect(GAME).toMatch(/setInterval\(tick,\s*15000\)/);
        // 卸载前再补一次，避免「最后一局」丢档
        expect(GAME).toContain("window.addEventListener('beforeunload', function () { pushSaves(); });");
    });

    it('只回传像 Ruffle 存档的项（⛔ 不越界收集 srcdoc 里别人的 localStorage）', () => {
        expect(GAME).toContain('function collectSaves()');
        expect(GAME).toContain("v.indexOf('TCSO') >= 0");
    });

    it('宿主侧落盘到插件目录、按 entryId 命名，且空快照不写', () => {
        expect(MAIN).toContain('async loadGameSaves(entryId: string): Promise<Record<string, string>> {');
        expect(MAIN).toContain('async saveGameSaves(entryId: string, saves: Record<string, string>): Promise<void> {');
        expect(MAIN).toContain('private gameSaveDir(): string {');
        expect(MAIN).toContain('return base ? `${base}/saves` : \'\';');
        expect(MAIN).toContain('private gameSaveFile(entryId: string): string {');
        // 空对象直接返回，⛔ 别写 `{}` 上去
        expect(MAIN).toContain('if (Object.keys(clean).length === 0) return;');
        // 读不到 / 坏了不许挡住游戏
        expect(MAIN).toContain('} catch {\n            return {};');
    });

    it('打开时读快照灌进去、收到消息就落盘', () => {
        expect(VIEW).toContain('const saves = entryId ? await this.plugin.loadGameSaves(entryId) : {};');
        expect(VIEW).toContain('saves });');
        expect(VIEW).toContain("if (d.type === 'saves' && d.saves && typeof d.saves === 'object') {");
        expect(VIEW).toContain('void this.plugin.saveGameSaves(this.opts?.entry.id ?? \'\', d.saves);');
    });

    it('关页时稍后才摘监听（否则漏掉 beforeunload 那份存档）', () => {
        expect(VIEW).toContain("window.setTimeout(() => {\n                window.removeEventListener('message', this.onGameMessage);\n            }, 800);");
    });
});

describe('原生舞台尺寸：clampGameStage 只认成对且可信的', () => {
    it('两边都在范围内就返回', () => {
        expect(clampGameStage(800, 480)).toEqual({ width: 800, height: 480 });
    });

    it('单边缺失一律不采用（单边会得到荒谬比例）', () => {
        expect(clampGameStage(800, undefined)).toBeUndefined();
        expect(clampGameStage(undefined, 480)).toBeUndefined();
        expect(clampGameStage(800, null)).toBeUndefined();
        expect(clampGameStage(undefined, undefined)).toBeUndefined();
    });

    it('越界一律不采用（下界挡广告位 1×1，上界挡版本号）', () => {
        expect(clampGameStage(GAME_STAGE_MIN - 1, 480)).toBeUndefined();
        expect(clampGameStage(800, GAME_STAGE_MAX + 1)).toBeUndefined();
        expect(clampGameStage(1, 1)).toBeUndefined();
    });

    it('非整数四舍五入（站点常给 799.5 这类观测值）', () => {
        expect(clampGameStage(800.5, 480)).toEqual({ width: 801, height: 480 });
        expect(clampGameStage(799.4, 480.6)).toEqual({ width: 799, height: 481 });
    });

    it('字符串 / NaN / 布尔一律不采用', () => {
        expect(clampGameStage('800', '480')).toBeUndefined();
        expect(clampGameStage(NaN, 480)).toBeUndefined();
        expect(clampGameStage(true, 480)).toBeUndefined();
        expect(clampGameStage(Infinity, 480)).toBeUndefined();
    });

    it('给了可信尺寸就用 aspect-ratio 摆位，没给就铺满容器', () => {
        const withStage = flashFrameHtml({
            ruffleBaseUrl: 'app://a/r',
            swfUrl: 'app://a/g.swf',
            stage: { width: 800, height: 480 },
        });
        expect(withStage).toContain('aspect-ratio: 800 / 480;');
        expect(withStage).toContain('width: min(100%, calc(100vh * 1.666667));');
        // 不给尺寸时没有 aspect-ratio 规则，退回 100%/100%
        expect(HTML).not.toContain('aspect-ratio:');
        expect(HTML).toContain('#stage { position: relative; width: 100%; height: 100%; }');
    });

    it('FlashGameView 读 entry.gameWidth/gameHeight 并传给外壳', () => {
        expect(VIEW).toContain('clampGameStage(entry.gameWidth, entry.gameHeight)');
        expect(VIEW).toContain('stage: stageBox');
        expect(VIEW).toContain('clampGameStage, flashFrameHtml, isFlashPath');
    });
});

describe('P0 留档：原始 swf URL 与原生宽高', () => {
    it('条目有这三个字段（append-only）', () => {
        expect(TYPES).toContain('gameSwfUrl?: string;');
        expect(TYPES).toContain('gameWidth?: number;');
        expect(TYPES).toContain('gameHeight?: number;');
    });

    it('catalog 白名单同步了它们（漏了会静默丢弃）', () => {
        expect(CATALOG).toContain('gameSwfUrl:');
        expect(CATALOG).toContain('gameWidth:');
        expect(CATALOG).toContain('gameHeight:');
        expect(CATALOG).toContain('function isGameStageSide');
    });

    it('成功落盘时把原始 URL 与宽高一起写下', () => {
        expect(MAIN).toContain('gameSwfUrl: swfUrl,');
        expect(MAIN).toMatch(/\.\.\.\(stage \? \{ gameWidth: stage\.width, gameHeight: stage\.height \} : \{\}\)/);
    });
});

describe('P1 页面形态纠正 + 17yy ajax', () => {
    it('7k7k 的 /flash/ 纠正成 /swf/', () => {
        expect(normalizeGamePageUrl('https://www.7k7k.com/flash/123456.htm')).toBe(
            'https://www.7k7k.com/swf/123456.htm',
        );
    });

    it('17yy 的 /f/ 纠正成 /f/play/，已是 play/ 的不重复加', () => {
        expect(normalizeGamePageUrl('https://www.17yy.com/f/123456.html')).toBe(
            'https://www.17yy.com/f/play/123456.html',
        );
        expect(normalizeGamePageUrl('https://www.17yy.com/f/play/123456.html')).toBe(
            'https://www.17yy.com/f/play/123456.html',
        );
    });

    it('4399 与其他站点原样返回（⛔ 不猜域名）', () => {
        const u = 'https://www.4399.com/flash/207495.htm';
        expect(normalizeGamePageUrl(u)).toBe(u);
        expect(normalizeGamePageUrl('https://example.com/x')).toBe('https://example.com/x');
        expect(normalizeGamePageUrl('')).toBe('');
    });

    it('抽取 17yy 的 gameId 与 category', () => {
        const html = '<script>var date = "dfs"; var m7_gameid = "26815";</script>';
        expect(parse17yyAjaxParams(html, 'https://www.17yy.com/f/play/x.html')).toEqual({
            gameId: '26815',
            category: 'dfs',
        });
    });

    it('拼 17yy 的 swf 地址（域名是 img1，⛔ 不能拿页面域名去 resolve）', () => {
        expect(build17yySwfUrl('dfs', '/abc/def.swf')).toBe('http://img1.17yy.com/swf/dfs/abc/def.swf');
        expect(build17yySwfUrl('', 'abc.swf')).toBe('http://img1.17yy.com/swf/abc.swf');
        expect(build17yySwfUrl('dfs', '')).toBe('');
    });

    it('宿主里有 POST 通路（⛔ 别把 POST 写成 GET）', () => {
        expect(MAIN).toContain('private async nodeHttpPostWithFallback(');
        expect(MAIN).toContain("'http://www.17yy.com/e/payapi/vip_ajax.php'");
        expect(MAIN).toContain('action=getStatus&id=');
        expect(MAIN).toContain('normalizeGamePageUrl(String(pageUrl');
    });
});

describe('内嵌游戏页：优先存「开始游戏」那一跳的真实页（⛔ 别存详情页）', () => {
    it('宿主侧先试 parseGameEmbedPage，拿不到才退回 embedPageOf', () => {
        // 2026-11-16 报障根因：4399 详情页的「开始游戏」会 window.open / target=_blank 到页游站，
        // Electron 把新窗口交给系统浏览器 ⇒ 游戏跑出插件。
        expect(MAIN).toMatch(/const gamePage = parseGameEmbedPage\(first, url\);/);
        expect(MAIN).toMatch(/const embedUrl = gamePage \|\| this\.embedPageOf\(url, parsed\.embedUrl\);/);
        // 提示语要区分两种来源，否则用户不知道存的是哪一条
        expect(MAIN).toMatch(/已改为内嵌它的游戏本体页：/);
    });

    it('import 从纯层取 parseGameEmbedPage', () => {
        expect(MAIN).toMatch(/parseGameEmbedPage,/);
    });

    it('H5 内嵌交给 gameEmbedHost：View 不再自己设 sandbox（webview 不能带、降级白名单归承载层）', () => {
        const view = readFileSync(new URL('../src/views/FlashGameView.ts', import.meta.url), 'utf8');
        const block = view.slice(view.indexOf('private mountEmbed('), view.indexOf('private async ensureAndMount('));
        expect(block).toContain("mountEmbedHost(stage, url, 'rl-fg-frame')");
        expect(block).not.toContain("setAttribute('sandbox'");
        // 承载层：webview 优先（cookie 落得了盘）+ 降级 iframe 才带 sandbox 且禁 popups
        const host = readFileSync(new URL('../src/services/gameEmbedHost.ts', import.meta.url), 'utf8');
        expect(host).toContain("setAttribute('allowpopups', '')");
        expect(host).toContain('setWindowOpenHandler(');
        expect(host).toContain("return { action: 'deny' };");
        expect(host).toContain("setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals')");
        expect(host).not.toContain('allow-popups-to-escape-sandbox');
        expect(host).not.toContain('allow-top-navigation');
    });
});

describe('parseGameStage：三家站点的宽高口径', () => {
    it('4399：_w / _h', () => {
        const r = parseGameStage('<script>var _w = 800, _h = 480;</script>', 'https://www.4399.com/flash/1.htm');
        expect(r).toEqual({ width: 800, height: 480 });
    });

    it('7k7k：gamewidth / gameheight', () => {
        const r = parseGameStage('var g = {gamewidth: 640, gameheight: 480};', 'https://www.7k7k.com/swf/1.htm');
        expect(r).toEqual({ width: 640, height: 480 });
    });

    it('17yy：flash_w / flash_h', () => {
        const r = parseGameStage('var flash_w = 1024; var flash_h = 768;', 'https://www.17yy.com/f/play/1.html');
        expect(r).toEqual({ width: 1024, height: 768 });
    });

    it('其他站点回落 <embed width/height>', () => {
        const r = parseGameStage('<embed src="a.swf" width="550" height="400">', 'https://example.com/g');
        expect(r).toEqual({ width: 550, height: 400 });
    });

    it('抓不到就空对象（⛔ 别瞎给默认值）', () => {
        expect(parseGameStage('<html></html>', 'https://example.com/g')).toEqual({});
    });
});

describe('纯层卫生', () => {
    it('flashGame / flashFetch 都不碰 obsidian 与 Node 内置模块', () => {
        for (const src of [GAME, FETCH]) {
            expect(src).not.toMatch(/from 'obsidian'/);
            expect(src).not.toMatch(/\brequire\(/);
            expect(src).not.toMatch(/from 'node:/);
        }
    });
});

// ── 2026-11-16 用户 m04597：「我这个只有获取一个文件怎么办改成关联目录」 ──────────────
//
// 两条不回潮口径：
//   ① 一个游戏 = 一个目录（`下载/Flash 游戏/<游戏名>/`）：主影片 + 关联资源都落在里面。
//      🔴 这不只是「看起来整齐」——平铺时两个游戏都引用 `sounds/bgm.mp3` 会**互相覆盖**。
//   ② 关联对象从一个文件放宽到一个目录，主影片由 `pickMainSwf` 挑（纯函数，只吃文件名）。
describe('pickMainSwf：从目录里挑主影片', () => {
    it('只有一个 swf 就是它', () => {
        expect(pickMainSwf(['a.png', 'game.swf', 'b.mp3'])).toBe('game.swf');
    });

    it('没有 swf 返回 null（调用方据此提示，⛔ 别返回空串）', () => {
        expect(pickMainSwf(['a.png', 'readme.txt'])).toBeNull();
        expect(pickMainSwf([])).toBeNull();
    });

    it('多个时优先顶层：a.swf 优于 sub/a.swf', () => {
        expect(pickMainSwf(['sub/x.swf', 'main-file.swf'])).toBe('main-file.swf');
    });

    it('顶层多个时优先入口名 index/main/game/start', () => {
        expect(pickMainSwf(['aaa.swf', 'game.swf'])).toBe('game.swf');
        expect(pickMainSwf(['aaa.swf', 'start.swf'])).toBe('start.swf');
        expect(pickMainSwf(['aaa.swf', 'index.swf'])).toBe('index.swf');
    });

    it('都不命中入口名时取名字最短的', () => {
        expect(pickMainSwf(['long_name_v2_final.swf', 'x.swf'])).toBe('x.swf');
    });

    it('大小写不敏感，且反斜杠归一（Windows 路径也认）', () => {
        expect(pickMainSwf(['GAME.SWF'])).toBe('GAME.SWF');
        expect(pickMainSwf(['sub\\x.swf'])).toBe('sub/x.swf');
    });

    it('子目录深度优先于入口名（顶层随便叫什么都比子目录优先）', () => {
        expect(pickMainSwf(['sub/index.swf', 'zzz.swf'])).toBe('zzz.swf');
    });
});

describe('SWF 载体目录约定（①）：平铺区 / 独立目录', () => {
    it('落盘 root 由 gameCarrierDir 决定，不是设置项本身', () => {
        expect(MAIN).toContain('const gameFolder = gameName ? sanitizeDownloadName(gameName) : ');
        expect(MAIN).toContain("const baseDir = downloadDir(this.settings.gameDownloadDir, 'flash');");
        // 🔴 1.5.0 原口径「一游戏一目录」已被用户的目录约定替换：
        //    单文件无存档 → 平铺区 `<游戏目录>/swf/`；多文件 / 有存档 → 独立目录。
        //    判据全部收口在 `pure/gameLayout`，宿主只调函数、⛔ 不再自己拼路径。
        expect(MAIN).toContain('const layout = gameCarrierLayout({ multiFile: false, hasSaves: savedBefore });');
        expect(MAIN).toContain('const gameDir = gameCarrierDir(baseDir, gameFolder, layout);');
        expect(MAIN).toContain('root: gameDir,');
        // 反向守卫：⛔ 别再直接把设置项当 root（那就是连平铺区都没有的裸平铺）
        expect(MAIN).not.toMatch(/root: this\.settings\.gameDownloadDir,/);
        // 反向守卫：⛔ 别在宿主里手拼 `${baseDir}/${gameFolder}`（会绕过 gameLayout 的两层约定）
        expect(MAIN).not.toContain('const gameDir = gameFolder ? `${baseDir}/${gameFolder}` : baseDir;');
    });

    it('多文件：先搬主影片进独立目录，再补关联资源', () => {
        // 判据来自主影片自己引用的资源数（不是事后数文件）
        expect(MAIN).toContain('const mainRefs = this.flashAssetRefs(swfUrl, mainBytes);');
        expect(MAIN).toContain('if (shouldUpgradeToBundle(mainRefs.length) && entryId) {');
        expect(MAIN).toContain('relPath = await this.moveFlashToBundleDir(relPath, baseDir, gameFolder, report);');
        // 顺序：搬家在补资源之前（反了资源会留在平铺区、两个游戏互相顶掉）
        const iMove = MAIN.indexOf('relPath = await this.moveFlashToBundleDir(relPath, baseDir, gameFolder, report);');
        const iFetch = MAIN.indexOf('const assetNote = await this.fetchFlashAssets(swfUrl, relPath, mainBytes, pageHeaders, report);');
        expect(iMove).toBeGreaterThan(0);
        expect(iFetch).toBeGreaterThan(iMove);
    });

    it('宿主有「选目录挑主影片」的三态方法', () => {
        expect(MAIN).toContain('async pickGameSwfFromDir(): Promise<string | null | undefined> {');
        expect(MAIN).toContain('const picked = pickMainSwf(files.map((f) => f.path));');
        expect(MAIN).toContain('if (!picked) return null;');
    });

    it('两个入口都接上了目录选择（编辑表单 + 快捷关联）', () => {
        expect(MAIN).toContain('pickGameSwfDir: () => this.pickGameSwfFromDir(),');
        const FORM = readFileSync(new URL('../src/views/components/EntryForm.svelte', import.meta.url), 'utf8');
        expect(FORM).toContain('export let onPickGameSwfDir:');
        expect(FORM).toContain('async function browseGameSwfDir(ev?: MouseEvent) {');
        expect(FORM).toContain('>目录</button>');
        const QA = readFileSync(new URL('../src/modals/QuickAssociateModal.ts', import.meta.url), 'utf8');
        expect(QA).toContain('pickGameSwfDir?: () => Promise<string | null | undefined>;');
        expect(QA).toContain('private async pickSwfDirInto(input: HTMLInputElement): Promise<void> {');
        // 🔴 三态必须分开：取消静默、空目录提示
        expect(QA).toContain('if (picked === undefined) return;');
        expect(QA).toContain("new Notice('这个目录里没有 .swf 文件', 5000);");
    });
});
