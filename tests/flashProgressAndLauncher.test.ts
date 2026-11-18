// 下载进度表 + 设置页「启用内置游戏启动器」两件事的回归守卫。
//
// 🔴 由来（2026-11-16 用户逐字）：
//    ①「做进度表」——Ruffle 运行时首次要下 ~10MB（直连实测 278 秒），原先只有一行静止的
//       「正在下载 Flash 运行时」，用户根本分不清是卡死还是在下；单独的百分比又看不出量级
//       ⇒ 要的是「在干什么 + 已下载/总量 + 百分比」三件一起显示，且带一条填充条。
//    ②「还有游戏下载目录放播放阅读启用启动器下」——设置页「播放阅读」里要新增一个
//       「启用内置游戏启动器」折叠开关，把「游戏目录」作为它的从属子行。
//
// ⛔ 这个文件钉的是**形状**（谁调谁、谁先谁后、默认值方向），不是像素：
//    · 进度百分比必须由**已收字节**算出来 —— 这一包 10MB，只有跳数式「0 / 45 / 100」等于没做；
//    · 开关缺省必须是 **true**：设置加载是 `Object.assign({}, DEFAULT_SETTINGS, raw)`，
//      老用户文件里没有这个键，缺省 false 会让「刚配好 swf 的人」升级后点了没反应；
//    · 下载落点必须读 `gameDownloadDir` —— 否则设置页那个输入框是个鬼开关。
//
// ⚠️ `main.ts` 不能整份剥注释：里面 `'text/*;q=0.8'` 这类字符串里的 `/*` 会让朴素正则
//    把后面几千行当注释吞掉 ⇒ 这个文件对 `main.ts` 一律用原文 + 足够具体的模式。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MAIN = read('main.ts');
const VIEW = stripComments(read('src/views/FlashGameView.ts'));
const SETTINGS = stripComments(read('src/Settings.ts'));
const CSS = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
const NODE_HTTP = stripComments(read('src/services/nodeHttp.ts'));

describe('进度表 · 百分比必须来自真实字节数', () => {
    it('nodeHttp 在收包时逐块回调 onProgress（不是下完才报一次）', () => {
        expect(NODE_HTTP).toMatch(/onProgress/);
        // 关键：回调挂在 `res.on('data', ...)` 的同一处（拿到 chunk 就知道又多了多少字节）
        expect(NODE_HTTP).toMatch(/res\.on\('data'/);
    });

    it('httpGetBufferWithFallback 把 onProgress 透传下去（两条通道都要透）', () => {
        expect(MAIN).toMatch(/onProgress\?: \(received: number, total: number\) => void/);
        expect(MAIN).toMatch(/nodeHttpGetBuffer\(url, headers, attempts\[i\], \{ timeoutMs, onProgress \}\)/);
    });

    it('🔴 下载段按已收字节折算成 0–45%，⛔ 不是写死的整数跳变', () => {
        expect(MAIN).toMatch(/Math\.round\(\(received \/ total\) \* 45\)/);
        // total 可能为 0（302 无 body / 服务端不给 content-length）⇒ 必须挡住除零
        expect(MAIN).toMatch(/total > 0 \?/);
    });

    it('ensureRuffleRuntime 的进度回调带 detail（字节详情），且解压段不塞字节', () => {
        expect(MAIN).toMatch(
            /onProgress\?:\s*\(\s*pct: number \| undefined,\s*label: string,\s*detail\?: \{ received: number; total: number \},?\s*\) => void/,
        );
        // 解压段的「进度」是文件数不是字节数 ⇒ ⛔ 不能塞进 detail，否则界面把它当字节格式化
        expect(MAIN).toMatch(/report\(45 \+ Math\.round\(\(done \/ entries\.length\) \* 55\), '正在解压 Flash 运行时'\);/);
    });

    it('视图侧有独立进度条三件套（轨道 / 填充 / 文字），与状态行分开', () => {
        expect(VIEW).toMatch(/this\.progressEl = host\.createDiv\(\{ cls: 'rl-fg-progress' \}\);/);
        expect(VIEW).toMatch(/cls: 'rl-fg-progress-track'/);
        expect(VIEW).toMatch(/this\.progressBarEl = track\.createDiv\(\{ cls: 'rl-fg-progress-bar' \}\);/);
        expect(VIEW).toMatch(/this\.progressTextEl = this\.progressEl\.createDiv\(\{ cls: 'rl-fg-progress-text' \}\);/);
        // 状态行还在（它要承担长句子错误），两者不是二选一
        expect(VIEW).toMatch(/this\.statusEl = host\.createDiv\(\{ cls: 'rl-fg-status' \}\);/);
    });

    it('进度文案同时给出「已下载 / 总量」与百分比，没有总量时只报已下载', () => {
        expect(VIEW).toMatch(/formatBytes\(detail\.received\)\}\s*\/\s*\$\{formatBytes\(detail\.total\)\}/);
        expect(VIEW).toMatch(/parts\.push\(`\$\{value\}%`\)/);
        // 无 content-length 这一支：⛔ 别除以 0 报个假 100%，也别整块收起（那看起来就像卡死）
        expect(VIEW).toMatch(/const hasBytes = !hasPct && !!detail && detail\.received > 0;/);
        expect(VIEW).toMatch(/const shown = hasPct \|\| hasBytes;/);
        expect(VIEW).toMatch(/parts\.push\(`已下载 \$\{formatBytes\(detail\.received\)\}`\)/);
        // 不确定态交给 CSS 动画，⛔ 别写死假百分比
        expect(VIEW).toMatch(/bar\.addClass\('is-indeterminate'\)/);
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress-bar\.is-indeterminate \{/);
        expect(CSS).toMatch(/@keyframes rl-fg-indeterminate \{/);
    });

    it('有百分比时不带不确定态（两态互斥，别叠在一起）', () => {
        expect(VIEW).toMatch(/bar\.removeClass\('is-indeterminate'\);\s*\n\s*const parts: string\[\] = \[\];/);
    });

    it('🔴 状态行有话说时收掉进度表（同屏会自相矛盾）', () => {
        // 真机截到过「没有关联本地 swf」与「正在下载 … 14%」并存 ⇒ 出错必须交棒给状态行
        expect(VIEW).toMatch(/if \(text\) this\.setProgress\(null\);/);
    });

    it('🔴 进度表出现时也清掉状态行（反方向同样不能并存）', () => {
        // 单向调用：setStatus('') 里 `if (text)` 为假 ⇒ 不会回调 setProgress，无递归
        expect(VIEW).toMatch(/this\.setStatus\(''\);\s*\n\s*if \(hasPct\) \{/);
    });

    it('进度条几何：0% 起、可过渡、数字等宽（避免 3.2 → 10.0 抖动）', () => {
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress-bar \{[\s\S]*?width: 0%;/);
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress-bar \{[\s\S]*?transition: width/);
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress-text \{[\s\S]*?font-variant-numeric: tabular-nums;/);
        // 收起态不能占位（同状态行那套「有话说才显示」）
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress \{ display: none;/);
        expect(CSS).toMatch(/\.rl-fg \.rl-fg-progress\.is-on \{ display: block; \}/);
    });
});

describe('设置页 · 启用内置游戏启动器（用户裁定：游戏目录放它下面）', () => {
    it('🔴 开关缺省必须是 true（缺省 false 会让老用户升级后点了没反应）', () => {
        expect(SETTINGS).toMatch(/internalGameLauncher: true,/);
        expect(SETTINGS).not.toMatch(/internalGameLauncher: false,/);
    });

    it('折叠项名称与说明沿用同组「在插件内做某事」句式', () => {
        expect(SETTINGS).toMatch(/setName\('启用内置游戏启动器'\)\.setDesc\('在插件内启动本地 Flash 游戏'\)/);
        expect(SETTINGS).toMatch(/!!this\.plugin\.settings\.internalGameLauncher,/);
    });

    it('游戏目录是它的从属子行，走同一个 createLibraryDirRow（kind=flash）', () => {
        expect(SETTINGS).toMatch(
            /this\.createLibraryDirRow\(\s*panel,\s*'游戏目录',\s*'Flash 游戏文件的存放与检索目录（其下 `swf\/` 收单文件、`<游戏名>\/` 收多文件与存档）',\s*\(\) => this\.plugin\.settings\.gameDownloadDir,/,
        );
        // ⛔ 不能是 'other'：那个 kind 的扩展名白名单是空数组，swf 会被直接拒
        expect(SETTINGS).toMatch(/'game',\s*'flash',/);
    });

    it('① 游戏目录的说明必须交代内部分层（否则用户看到 swf/ 与 <游戏名>/ 不知道是什么）', () => {
        // 用户 2026-11-17：「单文件无存档 SWF 直接放 `games/swf/` 统一管理…多文件 SWF 做独立目录」
        expect(SETTINGS).toContain('`swf/` 收单文件');
        expect(SETTINGS).toContain('`<游戏名>/` 收多文件与存档');
    });

    it('① 启动器那行抽成独立方法（renderExperimentalRows 的 setName 被 #399 钉成恰 3 条）', () => {
        expect(SETTINGS).toContain('private renderGameLauncherRow(parent: HTMLDivElement): void {');
        expect(SETTINGS).toContain('this.renderGameLauncherRow(parent);');
    });

    it('gameDownloadDir 缺省 = 下载/Flash 游戏（空值不是「根目录」）', () => {
        expect(SETTINGS).toMatch(/gameDownloadDir: DOWNLOAD_DIR_DEFAULT\.flash,/);
    });

    it('目录输入框有独立的自动补全实例，且随设置页关闭一起收', () => {
        expect(SETTINGS).toMatch(/private gameFolderSuggest: FolderInputSuggest \| null = null;/);
        expect(SETTINGS).toMatch(/this\.gameFolderSuggest\?\.close\(\);/);
        expect(SETTINGS).toMatch(/this\.gameFolderSuggest = null;/);
        expect(SETTINGS).toMatch(/'dl' \| 'book' \| 'game'/);
    });
});

describe('接线 · 开关与目录真的被读到（否则是鬼开关）', () => {
    it('launchGame 的 swf 分支受开关门控', () => {
        // `!== false` 而不是 truthy 判断：缺省（老 settings 文件里没这个键）要当开
        expect(MAIN).toMatch(/if \(swf && this\.settings\.internalGameLauncher !== false\) \{/);
    });

    it('fetchGameSwf 落盘读设置里的游戏目录', () => {
        // 2026-11-16 用户「改成关联目录」之后，root 是**设置项 + 一层游戏文件夹**，
        // 不再是设置项本身（那是平铺）。这里只钉「设置项确实被读到了」这件事：
        // 具体拼法由 `tests/flashGameShell.test.ts` 的「一个游戏一个目录」那条守住。
        expect(MAIN).toContain("downloadDir(this.settings.gameDownloadDir, 'flash')");
        expect(MAIN).toContain('root: gameDir,');
    });
});
