// 游戏「本地 swf 直接玩」的纯逻辑（可单测，无 obsidian / 无 Node / 无 DOM）。
//
// 用户 2026-11-16 三轮问答后点定：**先做本地 swf 播放**（选项「C → A」），
// 4399 在线抓取与网页内嵌留到后续 —— 本文件只管「本地文件 → 可播放的播放器页」这一段。
//
// 🔴 为什么不用 `<object>`/`<embed>` + 系统 Flash：Electron 里没有 Flash 插件，
//    唯一可行的运行时是 **Ruffle (WASM)**。所以这里的产物是一段 **srcdoc iframe 的 HTML**：
//    把 Ruffle 的 `ruffle.js` 与 swf 都用 `app://` 绝对 URL 塞进去，在隔离文档里跑。
//
// ⚠️ 与 `pure/gameLaunch.ts` **分开**：那边是「可启动文件（.lnk/.exe）」的判据，
//    这边是「可播放 flash（.swf）」的判据。⛔ 别把 swf 塞进 `GAME_LAUNCH_EXTS`
//    （那会让「检索本地」把 .swf 也当启动文件去 shell.openPath，行为完全错）。

/** 可播放的 Flash 影片扩展名（小写比较） */
export const FLASH_EXTS: readonly string[] = ['swf'];

/** 取扩展名（小写，不含点）；没有扩展名 → 空串。与 `pure/gameLaunch.extOfFile` 同语义，但本文件不依赖它。 */
function extOf(name: string): string {
    const base = String(name ?? '').trim();
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) return '';
    return base.slice(i + 1).toLowerCase();
}

/** 是不是可播放的 Flash 影片（按扩展名；大小写不敏感） */
export function isFlashPath(name: string): boolean {
    return FLASH_EXTS.includes(extOf(name));
}

/**
 * 从一批文件里挑出「这个游戏的主影片」（2026-11-16 用户要「改成关联目录」）。
 *
 * 用户原话：「原项目如何处理多文件关联的游戏的，我这个只有获取一个文件怎么办改成关联目录」
 * ⇒ 关联对象从一个**文件**放宽到一个**目录**，主影片由这里挑。
 *
 * 挑选口径（顺序即优先级，前一条能定就不看后面的）：
 *  ① 只有一个 `.swf` ⇒ 就是它（绝大多数情况，不做多余判断）；
 *  ② 多个时优先**顶层**的（`a.swf` 优于 `sub/a.swf`）—— 一个游戏文件夹里，
 *     主影片几乎总在根上，子目录里的是被 `loadMovie` 加载的分段；
 *  ③ 顶层还有多个 ⇒ 优先约定俗成的入口名（`index` / `main` / `game` / `start`）；
 *  ④ 仍无法区分 ⇒ 名字最短的（`04.swf` 优于 `04_mini_v2_final.swf`），同长按字面序。
 *
 * ⚠️ 这只是「猜」，猜错时用户可以在浮层里手填具体路径 —— 所以⛔ 不要为了更聪明的猜测
 *    引入体积/时间等需要 IO 的信息：本函数必须是**纯函数**（只吃文件名）。
 *
 * @param names 目录下所有文件的**相对路径**（`a.swf` / `sub/b.swf`）
 * @returns 挑中的相对路径；目录里没有 swf 时 `null`
 */
export function pickMainSwf(names: readonly string[]): string | null {
    const swfs = (names ?? [])
        .map((n) => String(n ?? '').replace(/\\/g, '/').replace(/^\.?\//, '').trim())
        .filter((n) => n.length > 0 && isFlashPath(n));
    if (swfs.length === 0) return null;
    if (swfs.length === 1) return swfs[0];

    const ENTRY_NAMES = ['index', 'main', 'game', 'start'];
    const rank = (p: string): number[] => {
        const slash = p.lastIndexOf('/');
        const file = slash >= 0 ? p.slice(slash + 1) : p;
        const depth = slash >= 0 ? p.split('/').length - 1 : 0;
        const stem = file.slice(0, file.length - extOf(file).length - 1).toLowerCase();
        const entryIdx = ENTRY_NAMES.indexOf(stem);
        // 入口名命中排在前面；没命中按「名字短」处理（用 -1 与真实下标区分开）
        return [depth, entryIdx >= 0 ? entryIdx : ENTRY_NAMES.length, file.length];
    };
    const sorted = [...swfs].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) {
            if (ra[i] !== rb[i]) return ra[i] - rb[i];
        }
        return a.localeCompare(b, 'zh');
    });
    return sorted[0];
}

/**
 * Ruffle 自托管包「**装完整**」的判据所需的三个特征。
 *
 * 🔴 这条判据是**真机踩出来的**（2026-11-16 探针）：只拷 `ruffle.js` + 一个 `.wasm` 时，
 *    Ruffle 报的是 `Failed to begin SWF load: Error: Failed to load Ruffle WASM` ——
 *    一句话把人往 wasm / MIME / URL 编码上带，而真因是缺了 `core.ruffle.*.js` 两个分包。
 *    ⇒ 完整性必须**按这三个特征一起查**，⛔ 别只查 `ruffle.js` 在不在。
 */
export const RUFFLE_ENTRY_FILE = 'ruffle.js';
export const RUFFLE_WASM_EXT = '.wasm';
export const RUFFLE_CORE_PREFIX = 'core.ruffle.';

/** 这份文件清单是否构成一套**能跑**的 Ruffle（入口 + 至少一个 wasm + 至少一个 core 分包） */
export function isRuffleRuntimeComplete(fileNames: readonly string[]): boolean {
    const names = (fileNames ?? []).map((n) => String(n ?? '').toLowerCase());
    const hasEntry = names.includes(RUFFLE_ENTRY_FILE);
    const hasWasm = names.some((n) => n.endsWith(RUFFLE_WASM_EXT));
    const hasCore = names.some((n) => n.startsWith(RUFFLE_CORE_PREFIX) && n.endsWith('.js'));
    return hasEntry && hasWasm && hasCore;
}

/** 装 Ruffle 需要落盘的扩展名（解压时只挑这些，⛔ 不把 .map / README / LICENSE 也铺进去） */
export const RUFFLE_KEEP_EXTS: readonly string[] = ['.js', '.wasm'];

/**
 * 按需下载的 Ruffle 版本与自托管包地址。
 *
 * 🔴 必须用 **web-selfhosted** 包（不是 `ruffle-nightly`、也不是 npm 的 `@ruffle-rs/ruffle`）：
 *    前者自带 `ruffle.js` + core 分包 + wasm，能直接 `<script src>` 起来；
 *    npm 包只是同一堆文件的另一种摆放，还得再解决复制问题。
 * ⚠️ 升级版本时只改这两个常量（地址由版本拼出，⛔ 别在调用点另写一份 URL —— 两处必然漂）。
 */
export const RUFFLE_VERSION = '0.7.1';
export const RUFFLE_BUNDLE_URL = `https://github.com/ruffle-rs/ruffle/releases/download/v${RUFFLE_VERSION}/ruffle-${RUFFLE_VERSION}-web-selfhosted.zip`;

/** 解压 Ruffle 时，这个包内文件名要不要落盘 */
export function shouldKeepRuffleFile(name: string): boolean {
    const n = String(name ?? '').toLowerCase();
    if (!n || n.endsWith('/')) return false;
    return RUFFLE_KEEP_EXTS.some((ext) => n.endsWith(ext));
}

/** 舞台尺寸的合理区间（像素）。下界挡广告位（常写成 1×1），上界挡把版本号/时间戳当尺寸。 */
export const GAME_STAGE_MIN = 64;
export const GAME_STAGE_MAX = 8192;

/**
 * 把「原始宽高」校验成一对可用值；不可信就整对丢弃。
 *
 * 🔴 **必须成对**（2026-11-16）：站点只写一半、或其中一半是解析噪声的情况真实存在
 *    （`_w = 800,` 抽到了、`_h` 那行被模板换行拆断）。只信一边会得到 800×<默认高> 的荒谬比例，
 *    比不设比例更难看 ⇒ 两边都过校验才返回，否则一律 `undefined`。
 */
export function clampGameStage(width: unknown, height: unknown): { width: number; height: number } | undefined {
    const w = typeof width === 'number' && Number.isFinite(width) ? Math.round(width) : 0;
    const h = typeof height === 'number' && Number.isFinite(height) ? Math.round(height) : 0;
    if (w < GAME_STAGE_MIN || w > GAME_STAGE_MAX) return undefined;
    if (h < GAME_STAGE_MIN || h > GAME_STAGE_MAX) return undefined;
    return { width: w, height: h };
}

/** 播放器页的构造入参 */
export interface FlashFrameOptions {
    /** Ruffle 目录的**绝对 URL 基址**（末尾斜杠可有可无，本函数自己补） */
    ruffleBaseUrl: string;
    /** swf 的绝对 URL */
    swfUrl: string;
    /** 影片标题（只用于 `<title>` 与加载失败提示，⛔ 不参与任何 DOM 注入） */
    title?: string;
    /** 舞台底色（swf 自带背景色时会被它盖掉，默认黑底与 Flash 习惯一致） */
    background?: string;
    /** 初始缩放口径，透传 Ruffle 的 `scale`（默认 `showAll` = 等比完整显示、留黑边） */
    scale?: string;
    /**
     * 游戏**原生舞台尺寸**（2026-11-16 用户裁定「留档原始宽高」的消费端）。
     *
     * 给了它 ⇒ 舞台按这个宽高比在容器里居中摆放（CSS `aspect-ratio`），两侧/上下黑边尽量窄；
     * 不给 ⇒ 铺满容器，由 Ruffle 的 `scale` 自己等比缩放留黑边（老行为）。
     * ⚠️ 传进来之前必须过 `clampGameStage()` —— 单边缺失或越界时本函数**静默退回铺满**，
     *    但别指望它兜住「只有宽没有高」：那是调用方的责任。
     */
    stage?: { width: number; height: number };
    /**
     * 开局要灌进 srcdoc 的 **Flash 存档快照**（`localStorage` 里那些 `.sol`）。
     *
     * 🔴 为什么要灌（2026-11-16 反查 `ruffle.js` 实证）：Ruffle 的 SharedObject（`.sol`）
     *    存在**宿主网页的 localStorage** 里，key 形如 `<hostname>/<swf 目录>/<名字>`；
     *    而我们跑在 `iframe.srcdoc` 里，其 origin 是 `null` —— 这份 localStorage 属于
     *    那个一次性文档，**关页即销毁**，于是每次打开游戏都像第一次玩。
     *    ⇒ 打开时把落盘的快照灌进去，玩的过程中把变化回传给宿主落盘，就实现了「存档随条目走」。
     * ⚠️ 只认字符串值；空对象/未传 ⇒ 不灌（首次玩）。
     */
    saves?: Record<string, string>;
}

/** HTML 文本转义（只用于我们自己拼进去的文字，⛔ 不用它处理 URL） */
function escText(v: string): string {
    return String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 把 URL 转成能安全嵌进 `<script>` 的字面量。
 * 🔴 关键在于把 `<` 转义成 `\u003c` —— 否则 URL 里出现 `</script>` 会把脚本块提前截断
 *    （文件名里带尖括号在 Windows 上虽然不合法，但这条防线不该靠文件名合法性来保证）。
 */
function jsUrl(v: string): string {
    return JSON.stringify(String(v ?? '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/**
 * 构造播放器页 HTML（`iframe.srcdoc` 的内容）。
 *
 * 🔴 为什么是 srcdoc 而不是把 Ruffle 直接注入 Obsidian 主文档（2026-11-16 探针 2 实证）：
 *    Ruffle 会往 `window` 上挂 `RufflePlayer`、注册 polyfill、抢键盘焦点；
 *    放进隔离文档后这些全部关在里面，关窗即随之消失（`frameOrigin='null'`、`activeInFrame` 仍能收按键）。
 *
 * ⚠️ `publicPath` 必须给**目录 URL（带尾斜杠）**：Ruffle 用它拼 `ruffle.js` 与 wasm / core 分包；
 *    给成 `…/ruffle.js` 会让它去找 `…/ruffle.js/ruffle.js`。
 */
export function flashFrameHtml(opts: FlashFrameOptions): string {
    const base = String(opts.ruffleBaseUrl ?? '');
    const withSlash = base.endsWith('/') ? base : `${base}/`;
    const title = escText(opts.title || 'Flash 游戏');
    const bg = escText(opts.background || '#000');
    const scale = escText(opts.scale || 'showAll');
    const swf = jsUrl(opts.swfUrl);
    const publicPath = jsUrl(withSlash);
    // 存档快照：只收「key / value 都是字符串」的项，别把乱七八糟的东西塞进 SRCDOC
    const saveEntries = Object.entries(opts.saves ?? {}).filter(
        ([k, v]) => typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0,
    );
    const savesJson = JSON.stringify(Object.fromEntries(saveEntries));
    const entryUrl = jsUrl(`${withSlash}${RUFFLE_ENTRY_FILE}`);
    // 原生舞台尺寸（只认成对且可信的）；不可信就当没有，退回铺满容器
    const stageBox = clampGameStage(opts.stage?.width, opts.stage?.height);
    const ratio = stageBox ? (stageBox.width / stageBox.height).toFixed(6) : '';
    const stageCss = stageBox
        ? `#stage { width: min(100%, calc(100vh * ${ratio})); height: auto; aspect-ratio: ${stageBox.width} / ${stageBox.height}; }`
        : '';
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: ${bg}; }
#wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
#stage { position: relative; width: 100%; height: 100%; }
${stageCss}
#stage ruffle-player, #stage ruffle-embed { display: block; width: 100%; height: 100%; }
/* 🔴 工具按钮**不在**这里（2026-11-16 用户逐字返工）：
   「四个图标按钮是替换工具栏的重新载入和在库中定位的文字按钮啊不是在游戏屏幕显示」
   ⇒ 四枚按钮由宿主页的 rl-fg-tools 渲染，点一下向本文档 postMessage 一条指令，
   本脚本收指令再操作 Ruffle/舞台。⛔ 别在这个 srcdoc 里再长出任何浮层控件 ——
   游戏画面归游戏，控制归宿主工具栏。
   ⚠️ 本段整体在 TS 模板字符串里，注释中 ⛔ 别写反引号（会提前终止字符串）。 */
#msg { position: absolute; inset: 0; display: none; padding: 24px; box-sizing: border-box;
  font: 13px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #ddd;
  background: ${bg}; white-space: pre-wrap; overflow: auto; }
#msg.is-on { display: block; }
#msg b { color: #ffd76b; font-weight: 600; }
</style>
</head>
<body>
<div id="wrap">
  <div id="stage"></div>
</div>
<div id="msg"></div>
<script>
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
  publicPath: ${publicPath},
  autoplay: "on",
  unmuteOverlay: "hidden",
  letterbox: "on",
  scale: ${jsUrl(scale)},
  quality: "high",
  logLevel: "error",
  contextMenu: "on",
  allowFullscreen: true,
  favicon: null,
  splashScreen: false
};
</script>
<script>
// 🔴 存档回灌 —— 必须在 ruffle.js **之前**执行：Ruffle 启动时会 populateSaves() 扫 localStorage，
//    晚一步灌进去它就已经按「没有存档」初始化完了。
// 本 srcdoc 的 origin 是 null，localStorage 属于这个一次性文档，关页即销毁 ⇒ 每次打开都得重灌。
(function () {
  try {
    var saves = ${savesJson};
    for (var k in saves) {
      if (Object.prototype.hasOwnProperty.call(saves, k)) localStorage.setItem(k, saves[k]);
    }
  } catch (e) { /* 存不进就算了：不能因为存档挡住游戏本身 */ }
})();
</script>
<script src=${entryUrl}></script>
<script>
(function () {
  var swfUrl = ${swf};
  var msg = document.getElementById('msg');
  var stage = document.getElementById('stage');
  var instance = null;
  // 缩放只改 #stage 的 transform：⛔ 别去改 ruffle 内部 canvas 的宽高 ——
  // 那会让 Flash 以为舞台变了、触发重新布局，游戏里写死的坐标全部错位。
  var zoom = 1;
  var ZOOM_MIN = 0.25;
  var ZOOM_MAX = 4;
  var ZOOM_IN = 4 / 3;
  var ZOOM_OUT = 0.75;
  function applyZoom() {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    stage.style.transform = 'scale(' + zoom + ')';
    stage.style.transformOrigin = 'center center';
    // 把「还能不能再放大/缩小」报给宿主工具栏去置灰。
    // 🔴 跨源 iframe 拿不到父级 DOM，只能单向 postMessage；收不到就由宿主自己保底。
    try {
      window.parent.postMessage({ source: 'reelludic-flash', type: 'zoom', zoom: zoom,
        canIn: zoom < ZOOM_MAX - 1e-6, canOut: zoom > ZOOM_MIN + 1e-6 }, '*');
    } catch (e) { /* 父级不可达就算了，不影响缩放本身 */ }
  }
  function load() {
    if (!instance) return;
    try {
      instance.load({ url: swfUrl, autoplay: 'on', unmuteOverlay: 'hidden', scale: ${jsUrl(scale)} });
    } catch (e) {
      fail(e && e.message ? e.message : String(e));
    }
  }
  function fail(text) {
    msg.innerHTML = '<b>Flash 影片没能启动</b>\\n\\n' + String(text || '') +
      '\\n\\n如果反复失败：确认插件目录下的 ruffle 运行时是完整包（需要 ruffle.js、至少一个 .wasm、以及 core.ruffle.*.js 分包）。';
    msg.classList.add('is-on');
  }
  function boot() {
    try {
      var api = window.RufflePlayer;
      if (!api || typeof api.newest !== 'function') {
        fail('Ruffle 运行时没有加载起来（ruffle.js 可能缺失或不完整）。');
        return;
      }
      var player = api.newest().createPlayer();
      player.style.width = '100%';
      player.style.height = '100%';
      stage.appendChild(player);
      player.addEventListener('error', function (ev) {
        var d = ev && ev.detail;
        fail((d && (d.message || d.error)) || '播放器报了错但没有附带原因。');
      });
      instance = typeof player.ruffle === 'function' ? player.ruffle() : player;
      load();
      applyZoom();
      listen();
    } catch (e) {
      fail(e && e.message ? e.message : String(e));
    }
  }
  /**
   * 收宿主工具栏发来的指令（用户在 2026-11-16 逐字要求：按钮放工具栏、不放游戏画面）。
   * 🔴 只认 source 为 reelludic-flash 的自定义消息：本页是 srcdoc（origin 为 null），
   *    没法用 origin 白名单校验来源，改用来源字段自证 + 只允许几个固定动作名。
   * ⚠️ 本段整体在 TS 模板字符串里，注释中 ⛔ 别写反引号（会提前终止字符串）。
   */
  function listen() {
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || d.source !== 'reelludic-flash') return;
      switch (d.type) {
        case 'replay':
          msg.classList.remove('is-on');
          zoom = 1;
          applyZoom();
          load();
          break;
        case 'zoom-in':
          zoom *= ZOOM_IN;
          applyZoom();
          break;
        case 'zoom-out':
          zoom *= ZOOM_OUT;
          applyZoom();
          break;
        case 'zoom-reset':
          zoom = 1;
          applyZoom();
          break;
        case 'fullscreen':
          // 全屏作用在**本 iframe 自己的文档**上（宿主 iframe 已声明 allow="fullscreen"）。
          // ⛔ 别去调父窗口的 requestFullscreen —— 跨源拿不到，且会把整个 Obsidian 窗口顶掉。
          var doc = document;
          var el = doc.documentElement;
          if (!doc.fullscreenElement) {
            var req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req) req.call(el).catch(function () {});
          } else {
            var ex = doc.exitFullscreen || doc.webkitExitFullscreen;
            if (ex) ex.call(doc).catch(function () {});
          }
          break;
        case 'save':
          // 宿主主动来要一次存档快照（关页前 / 定时存档）。⛔ 别只依赖 Ruffle 内部的
          // confirmReloadSave 之类钩子 —— 那是它自己弹窗用的，不保证被调到。
          pushSaves();
          break;
      }
    });
  }
  /**
   * 把当前 localStorage 里的存档整包回传给宿主。
   *
   * 🔴 只挑「看着像 Ruffle 存档」的键：Ruffle 用 xn(value)（校验 .sol 头）筛的，
   *    我们这边等价判据 = 值里带 TCSO（SharedObject 魔数）。⛔ 别把 srcdoc 里
   *    任何别人的 localStorage 项也传出去 —— 那是越界收集。
   *    key 形态是 hostname/目录/名字，原样带回，由宿主按条目隔离落盘。
   * ⚠️ 本段整体在 TS 模板字符串里，注释与字符串中 ⛔ 别写反引号（会提前终止）。
   */
  function collectSaves() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var v = localStorage.getItem(k);
        // TCSO = SharedObject 的 4 字节魔数，base64 之后出现在前几位
        if (typeof v === 'string' && v.length > 8 && (v.indexOf('TCSO') >= 0 || v.length > 64)) {
          out[k] = v;
        }
      }
    } catch (e) { /* 读不到就返回空对象 */ }
    return out;
  }
  function pushSaves() {
    try {
      window.parent.postMessage({ source: 'reelludic-flash', type: 'saves', saves: collectSaves() }, '*');
    } catch (e) { /* 父级不可达就算了，不影响游戏 */ }
  }
  /**
   * 存档回传的两个时机：
   *   ① 每 15 秒一次（防用户直接关窗口/崩溃 —— 那时 beforeunload 不一定来得及把消息发出去）；
   *   ② 页面卸载前一次（切标签页、关页都会走到）。
   * ⚠️ 只在**有变化**时传：把上次传过的 JSON 记下来比对，否则每 15 秒打一条空消息、
   *    宿主每次都要写盘。⛔ 别省这个比对。
   */
  function watchSaves() {
    var last = JSON.stringify(collectSaves());
    function tick() {
      var now = JSON.stringify(collectSaves());
      if (now === last) return;
      last = now;
      pushSaves();
    }
    window.setInterval(tick, 15000);
    window.addEventListener('beforeunload', function () { pushSaves(); });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    window.setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
  watchSaves();
})();
</script>
</body>
</html>`;
}
