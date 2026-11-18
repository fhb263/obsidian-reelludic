// Flash 播放页（工作区独立标签页）的结构守卫。
//
// 🔴 由来（2026-11-16 用户逐字）：「要独立标签页运行而不是弹窗运行」。
//    改前是 `modals/FlashGameModal`（`Modal` 弹窗，盖住整窗、Esc 就没了）；
//    用户要的是像视频播放器那样能并排、能切走再切回 ⇒ 改成 `views/FlashGameView`（`ItemView`）。
//    ⛔ 别退回弹窗：这个文件的第一组用例就是钉死「容器是 ItemView、宿主走 openFlashGame」。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：
//    构造 `FlashGameView` 要真的 `WorkspaceLeaf` + 完整 Obsidian 工作区；而这次要锁的形状
//    （`opened` 标志而不是 `rootEl` 判挂载、异步回来先看 `disposed`、iframe 不加 sandbox）
//    在行为测试里反而更容易假绿 —— 页能开出来，也不代表切走再切回时不会重建整个播放器。
//
// ⛔ 铁律：先 strip 注释再匹配。Ruffle / sandbox / RufflePlayer 这些词在注释里反复出现，
//    不剥掉就会把「注释里提到」误判成「代码里有」。
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VIEW = stripComments(read('src/views/FlashGameView.ts'));
// ⚠️ `main.ts` 不能整份剥注释：里面有 `'text/*;q=0.8'` 这类**字符串里的 `/*`**
//    （Accept 头），朴素正则会把后面几千行当成注释吞掉 ⇒ 断言永远匹配不到真实代码。
//    这里用原文 + 足够具体的模式（下面每条都不是注释里会出现的样子）。
const MAIN = read('main.ts');
const CSS = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('FlashGameView · 容器形态（用户裁定：独立标签页，⛔ 不是弹窗）', () => {
    it('视图类型常量固定，改名会让已保存布局失效', () => {
        expect(VIEW).toMatch(/export const FLASH_GAME_VIEW_TYPE = 'reelludic-flash-game';/);
    });

    it('🔴 基类是 ItemView（标签页），不是 Modal', () => {
        expect(VIEW).toMatch(/export class FlashGameView extends ItemView/);
        expect(VIEW).not.toMatch(/extends Modal/);
        // 弹窗专属的生命周期/容器在本视图里不该出现
        expect(VIEW).not.toMatch(/\bnew Modal\(/);
        expect(VIEW).not.toMatch(/\.modalEl/);
    });

    it('🔴 宿主把 swf 分支交给 openFlashGame，并注册了该视图类型', () => {
        expect(MAIN).toMatch(/await this\.openFlashGame\(entry\);/);
        // ⛔ 构造调用不在，注释里提到 `FlashGameModal` 是允许的（历史说明），只要没有实例化
        expect(MAIN).not.toMatch(/new FlashGameModal\(/);
        expect(MAIN).toMatch(/registerView\(FLASH_GAME_VIEW_TYPE, \(leaf\) => new FlashGameView\(leaf, this\)\)/);
    });

    it('弹窗版文件已删除，且没人再 import 它', () => {
        expect(existsSync(resolve(ROOT, 'src/modals/FlashGameModal.ts'))).toBe(false);
        expect(VIEW).not.toMatch(/FlashGameModal/);
        // 只钉「没有这条 import」—— main.ts 的迁移注释里提到旧路径是允许的（历史说明）
        expect(MAIN).not.toMatch(/^import .*modals\/FlashGameModal/m);
    });

    it('关闭语义 = 关标签页：页面里没有「关闭」按钮', () => {
        expect(VIEW).not.toMatch(/text: '关闭'/);
        expect(VIEW).not.toMatch(/\.close\(\)/);
    });
});

describe('FlashGameView · 生命周期形状', () => {
    it('🔴 `opened` 标志区分「onOpen 未完成」与「已挂载」—— ⛔ 不用 rootEl 判', () => {
        expect(VIEW).toMatch(/private opened = false;/);
        expect(VIEW).toMatch(/this\.opened = true;/);
        expect(VIEW).toMatch(/if \(!this\.opened\) return;/);
        // 视频播放器就是被这一句坑过：占位态也算已挂载、但当时 rootEl 为空
        expect(VIEW).not.toMatch(/this\.rootEl/);
    });

    it('换条目走 openWith（⛔ 不能叫 load —— ItemView 基类已占用该名）', () => {
        expect(VIEW).toMatch(/openWith\(opts: FlashGameOptions\): void/);
        expect(VIEW).not.toMatch(/^\s*(?:public\s+|private\s+)?load\s*\(/m);
    });

    it('异步回来先看 disposed，再往舞台上写', () => {
        expect(VIEW).toMatch(/private async ensureAndMount\(/);
        expect(VIEW).toMatch(/if \(this\.disposed\) return;/);
        expect(VIEW).toMatch(/const stage = this\.stageEl;\s*\n\s*if \(!stage\) return;/);
    });

    it('onClose 释放全部引用并清空容器', () => {
        expect(VIEW).toMatch(/async onClose\(\): Promise<void> \{/);
        expect(VIEW).toMatch(/this\.disposed = true;/);
        expect(VIEW).toMatch(/this\.contentEl\.empty\(\);/);
    });

    it('🔴 只序列化 entryId，布局恢复时按 id 重取条目（⛔ 别把整个 MediaEntry 塞进布局）', () => {
        // 存整个条目 = 布局文件里躺一份陈旧快照，标题/评分改了会显示旧值
        expect(VIEW).toMatch(/getState\(\): Record<string, unknown> \{/);
        expect(VIEW).toMatch(/return id \? \{ entryId: id \} : \{\};/);
        // 恢复必须回 service 取最新条目，而不是直接用布局里的值
        expect(VIEW).toMatch(/async setState\(state: unknown, result: ViewStateResult\): Promise<void> \{/);
        expect(VIEW).toMatch(/await this\.plugin\.service\.get\(id\);/);
        expect(VIEW).toMatch(/await super\.setState\(state, result\);/);
        // ⚠️ setState 可能在 onOpen 之前也可能之后触发，两条都要处理
        expect(VIEW).toMatch(/if \(this\.opened\) \{/);
    });

    it('🔴 载入后主动刷标签页标题（Obsidian 不会因 getDisplayText 变化而重画 tab）', () => {
        // 真机截图里 5 个同类标签全叫占位名「Flash 游戏」，页内却是真片名
        expect(VIEW).toMatch(/private refreshLeafHeader\(\): void \{/);
        expect(VIEW).toMatch(/const leaf = this\.leaf as unknown as \{ updateHeader\?: \(\) => void \};/);
        expect(VIEW).toMatch(/if \(typeof leaf\.updateHeader === 'function'\) leaf\.updateHeader\(\);/);
        // openWith 里必须调（换条目时就靠它）
        const openWithBody = VIEW.slice(VIEW.indexOf('openWith(opts: FlashGameOptions): void {'));
        expect(openWithBody.slice(0, 600)).toMatch(/this\.refreshLeafHeader\(\);/);
    });

    it('条目被删（恢复时取不到）时留提示，不是一块黑舞台', () => {
        expect(VIEW).toMatch(/这一页没有关联游戏/);
    });

    it('没挂 swf 时的提示要指全两条入口（快捷关联 + 编辑属性）', () => {
        // 2026-11-16：快捷关联弹窗也有了「Flash 影片」行 ⇒ 只写编辑属性会误导
        expect(VIEW).toMatch(/这个条目还没有关联 \.swf/);
        expect(VIEW).toMatch(/「快捷关联」的「Flash 影片」行/);
        expect(VIEW).toMatch(/「编辑属性 → 启动路径」/);
    });
});

describe('FlashGameView · 播放链路（真机探针实证过的三条）', () => {
    it('swf 分支：iframe 走 srcdoc 隔离，且 ⛔ 不加 sandbox（会与 Ruffle 动态注入打架）', () => {
        expect(VIEW).toMatch(/stage\.createEl\('iframe', \{ cls: 'rl-fg-frame' \}\)/);
        expect(VIEW).toMatch(/frame\.srcdoc = flashFrameHtml\(/);
        // srcdoc 那条 iframe 上不许出现 sandbox —— 判据落在 ensureAndMount 段内，
        // 因为 H5/Unity 的 mountEmbed 分支**必须**挂 sandbox（见下面那条用例）。
        const srcdocBlock = VIEW.slice(
            VIEW.indexOf('private async ensureAndMount('),
            VIEW.indexOf('private setStatus('),
        );
        expect(srcdocBlock.length).toBeGreaterThan(200);
        expect(srcdocBlock).not.toMatch(/sandbox/);
    });

    it('H5 / Unity 分支：交给 gameEmbedHost，⛔ 别在 View 里自己设 sandbox', () => {
        // 2026-11-16 用户报障：「是内嵌iframe但为什么启动暴走英雄坛开始游戏后就跳转浏览器了」
        // 4399 的「开始游戏」是 target=_blank / window.open；Electron 默认把它交给系统浏览器。
        // 同一天第二轮报障：「根本登录不了 4399 账号一登录就刷新重置」⇒ iframe 是第三方上下文
        // （app:// 下的跨站），cookie 落不了盘；换成 <webview> 后实测能写进 5 条 cookie。
        const embedBlock = VIEW.slice(
            VIEW.indexOf('private mountEmbed('),
            VIEW.indexOf('private async ensureAndMount('),
        );
        expect(embedBlock.length).toBeGreaterThan(200);
        expect(embedBlock).toMatch(/mountEmbedHost\(stage, url, 'rl-fg-frame'\)/);
        expect(embedBlock).toMatch(/this\.embedHost = host;/);
        // ⛔ View 层不再自己设 sandbox：webview 分支不能带、iframe 分支的白名单归承载层统一维护
        expect(embedBlock).not.toMatch(/setAttribute\('sandbox'/);
    });

    it('内嵌承载层：webview 优先 + 新窗口就地导航 + 一律 deny（⛔ 别退回 iframe）', () => {
        const HOST = stripComments(read('src/services/gameEmbedHost.ts'));
        // webview 判定必须看 loadURL（元素建得出来 ≠ 宿主启了 webviewTag）
        expect(HOST).toMatch(/typeof el\.loadURL === 'function'/);
        // allowpopups 必给：不给的话 setWindowOpenHandler 收不到回调（真机实证）
        expect(HOST).toMatch(/setAttribute\('allowpopups', ''\)/);
        expect(HOST).toMatch(/setWindowOpenHandler\(/);
        // 接住之后必须就地导航并 deny，否则 Electron 默认交系统浏览器
        expect(HOST).toMatch(/void wv\.loadURL\?\.\(next\)/);
        expect(HOST).toMatch(/return \{ action: 'deny' \};/);
        // 降级分支才带 sandbox，且不许 popups
        expect(HOST).toMatch(
            /setAttribute\('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals'\)/,
        );
        expect(HOST).not.toMatch(/allow-popups-to-escape-sandbox/);
        expect(HOST).toMatch(/kind: 'webview' \| 'iframe'/);
    });

    it('运行时由 ensureRuffleRuntime 取，swf 与插件目录都过 resolveEmbedUrl', () => {
        expect(VIEW).toMatch(/await this\.plugin\.ensureRuffleRuntime\(/);
        expect(VIEW).toMatch(/this\.plugin\.resolveEmbedUrl\(rel\)/);
        expect(VIEW).toMatch(/this\.plugin\.resolveEmbedUrl\(ruffleDir\)/);
    });

    it('swf 路径先自检，省掉一次 10MB 级下载', () => {
        // 2026-11-16 加 H5/Unity 内嵌分支后，判定改成「有 swf 且确实是 swf 才走 Ruffle」——
        // 不存在的 swf 不再抢在 embed 之前报错。
        expect(VIEW).toMatch(/if \(rel && isFlashPath\(rel\)\) \{/);
        expect(VIEW).toMatch(/if \(!rel\) \{/);
        expect(VIEW).toMatch(/import \{ clampGameStage, flashFrameHtml, isFlashPath \} from 'pure\/flashGame';/);
    });

    it('H5 / Unity：有条在线播放页就直接内嵌，不碰 Ruffle 运行时', () => {
        // 🔴 内嵌分支必须**先于** ensureRuffleRuntime：那条路要下 ~10MB wasm，网页游戏根本用不上
        expect(VIEW).toMatch(/private mountEmbed\(stage: HTMLElement, url: string\): void \{/);
        expect(VIEW).toMatch(/if \(\/\^https\?:\\\/\\\/\/i\.test\(embed\)\) \{/);
        // src 的设置已下沉到承载层（webview / iframe 二选一），View 只交地址
        expect(VIEW).toMatch(/const host = mountEmbedHost\(stage, url, 'rl-fg-frame'\);/);
        const embedAt = VIEW.indexOf('this.mountEmbed(stage, embed)');
        const ruffleAt = VIEW.indexOf('this.ensureAndMount(swfUrl');
        expect(embedAt).toBeGreaterThan(0);
        expect(ruffleAt).toBeGreaterThan(0);
        // 两分支互斥，顺序无所谓（各自 return），但都必须存在
        expect(VIEW).toMatch(/const embed = String\(entry\.gameEmbed \?\? ''\)\.trim\(\);/);
    });
});

describe('styles.css · 页内几何（⛔ 不再是弹窗那套 max-height 假设）', () => {
    const ruleBody = (selector: string): string => {
        const i = CSS.indexOf(selector + ' {');
        if (i < 0) return '';
        const start = CSS.indexOf('{', i);
        let depth = 0;
        for (let k = start; k < CSS.length; k++) {
            if (CSS[k] === '{') depth++;
            else if (CSS[k] === '}') {
                depth--;
                if (depth === 0) return CSS.slice(start + 1, k);
            }
        }
        return '';
    };

    it('页面容器撑满可用高度（flex 纵向）', () => {
        const body = ruleBody('.rl-fg.rl-fg-page');
        expect(body).toMatch(/display:\s*flex;/);
        expect(body).toMatch(/flex-direction:\s*column;/);
        expect(body).toMatch(/height:\s*100%;/);
    });

    it('🔴 舞台吃掉剩余高度，且 min-height:0（少了它整页会出纵向滚动条）', () => {
        const body = ruleBody('.rl-fg .rl-fg-stage');
        expect(body).toMatch(/flex:\s*1 1 auto;/);
        expect(body).toMatch(/min-height:\s*0;/);
        // 弹窗版那套固定高度在标签页里会留一大片空白
        expect(body).not.toMatch(/68vh/);
    });

    it('iframe / webview 铺满舞台且无边框', () => {
        const body = ruleBody('.rl-fg .rl-fg-frame');
        expect(body).toMatch(/width:\s*100%;/);
        expect(body).toMatch(/height:\s*100%;/);
        expect(body).toMatch(/border:\s*0;/);
    });

    it('⛔ 内嵌容器不许写 display: block —— webview 的访客视口会掉到 150px 高', () => {
        // 2026-11-16 用户报障「内嵌的整个屏宽度都变窄了」。
        // 实测同一元素反复切换：display:block → guest 600→150；去掉 → 150→600；inline-flex → 600。
        // block 绕开了 Chromium webview 的尺寸同步，元素满高但访客只按 150px 排版。
        const body = ruleBody('.rl-fg .rl-fg-frame');
        expect(body).not.toMatch(/display:\s*block\s*;/);
        expect(body).toMatch(/display:\s*flex\s*;/);
    });
});
