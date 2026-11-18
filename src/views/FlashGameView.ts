/**
 * 本地 Flash 影片（.swf）**独立标签页**播放器 —— 游戏条目「▶ 启动」在有 `gameSwf` 时的落点。
 *
 * 🔴 容器演进（两次用户裁定，按时间序）：
 *   2026-11-16 第一轮（m01382「C → A」）：先做本地 swf 播放 ⇒ 当时落在 `Modal` 弹窗。
 *   2026-11-16 第二轮（m02472 逐字）：「要独立标签页运行而不是弹窗运行」
 *   ⇒ 改成工作区 `ItemView`（与视频播放器 / 选集页同族）。⛔ 别再退回 `Modal`。
 *
 * 运行方式（**三条都是真机探针实证过的，⛔ 别凭直觉改**）：
 *   ① **iframe.srcdoc 隔离** —— Ruffle 会往 `window` 上挂 `RufflePlayer`、注册 polyfill、抢键盘焦点；
 *      放进 srcdoc 文档后这些全关在隔离上下文里（`frameOrigin='null'`），关页即随之消失，
 *      而键盘焦点仍能进入该文档（探针实测 `activeInFrame='RUFFLE-PLAYER'`，游戏可收按键）。
 *   ② Ruffle 运行时**装在插件目录**（`pluginDir()/ruffle`）—— 不是库内：库内会被 Obsidian 建索引、
 *      被用户的同步 / 备份带上，且 28MB 的 wasm 进库没有任何好处。插件目录同样能用 `app://` 取到
 *      （探针实测 fetch 200 + MIME `application/wasm`）。
 *   ③ 首次使用**按需下载**（约 10MB 压缩包 → 落盘 ~29MB），装完打标记，之后每次直接开。
 *      包体不进插件发行包（用户明确要求控制体积）。
 *
 * ⚠️ 与弹窗形态的差异（迁到页时逐条对齐过）：
 *   · 关闭语义 = 关标签页 ⇒ **没有「关闭」按钮**（用户关页就是关掉；多一个按钮反而容易误以为是弹窗）。
 *   · 页可能被 Obsidian **延迟渲染**（后台标签页不建 DOM）⇒ 必须区分「onOpen 未完成」与
 *     「已挂载但还没内容」，否则 `if (this.rootEl) buildUi()` 恒假、点「启动」只记状态不建界面
 *     （`VideoPlayerView` 踩过同一个坑，见其 `opened` 标志注释）。
 *   · 切走再切回不需要重载：iframe 元素留在 DOM 里，Ruffle 的 wasm/WebGL 上下文不重建。
 */
import { ItemView, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry } from 'data/types';
import { clampGameStage, flashFrameHtml, isFlashPath } from 'pure/flashGame';
import { iconButton } from 'ui/components';
import { type EmbedHost, mountEmbedHost } from 'services/gameEmbedHost';

export const FLASH_GAME_VIEW_TYPE = 'reelludic-flash-game';

/** 打开 Flash 页需要的上下文（宿主在 `setViewState` 之后调用 `openWith` 传入） */
export interface FlashGameOptions {
    entry: MediaEntry;
}

/**
 * 字节数 → 人话（`3.2 MB` / `820 KB` / `512 B`）。
 *
 * 🔴 为什么不用 `Intl.NumberFormat` 的 unit 风格：Obsidian 的界面语言可能是中文也可能是英文，
 *    `Intl` 会跟着变（`3.2メガバイト` 之类），而这里是**游戏运行时的体积**，用国际单位最稳。
 * ⚠️ 只保留 1 位小数（10MB 级别多一位没意义，反而让进度条文字跳动）。
 */
function formatBytes(n: number): string {
    const v = Number.isFinite(n) && n > 0 ? n : 0;
    if (v < 1024) return `${Math.round(v)} B`;
    const kb = v / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
}

export class FlashGameView extends ItemView {
    /** 当前条目的快照（⛔ 别每次重读 service：页只负责渲染宿主交给它的这一份） */
    private opts: FlashGameOptions | null = null;
    /** 已完成 onOpen（未完成时 `openWith` 只记 opts，由 onOpen 负责建 UI） */
    private opened = false;
    /** 页已销毁标记（异步回来时先看它，⛔ 别往卸载后的 DOM 上写） */
    private disposed = false;
    /** 播放页 iframe（重载时换 srcdoc 而不是重建整页） */
    private frame: HTMLIFrameElement | null = null;
    /**
     * H5 / Unity 的内嵌容器（`<webview>` 或降级 `<iframe>`）。
     *
     * 🔴 `<webview>` 是**独立 webContents**：元素从 DOM 移除后进程不一定立刻走，
     *    必须显式 `dispose()`（见 `services/gameEmbedHost.ts`），否则关页后还挂着。
     */
    private embedHost: EmbedHost | null = null;
    /** 状态行（加载中 / 失败原因） */
    private statusEl: HTMLElement | null = null;
    /** 进度条（用户 m02844「做进度表」：百分比 + 已下载/总量；只在安装运行时那段显示） */
    private progressEl: HTMLElement | null = null;
    /** 进度条填充（改宽度） */
    private progressBarEl: HTMLElement | null = null;
    /** 进度条文字（「正在下载 Flash 运行时 · 3.2 / 10.0 MB · 32%」） */
    private progressTextEl: HTMLElement | null = null;
    /** 舞台容器（iframe 挂这里） */
    private stageEl: HTMLElement | null = null;
    /** 名称行（换条目时更新） */
    private nameEl: HTMLElement | null = null;
    /** 四枚工具图标按钮（用户 m04298：替换原「重新载入 / 在库中定位」两个文字按钮） */
    private replayBtn: HTMLButtonElement | null = null;
    private zoomInBtn: HTMLButtonElement | null = null;
    private zoomOutBtn: HTMLButtonElement | null = null;
    private fullBtn: HTMLButtonElement | null = null;
    /** 存档导出按钮（① 用户逐字：「存档是导出备份，需通过导入功能恢复」） */
    private exportBtn: HTMLButtonElement | null = null;
    /** 存档导入按钮（覆盖式恢复，二次确认在宿主 `importGameSaves` 里） */
    private importBtn: HTMLButtonElement | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private plugin: ReelLudicPlugin,
    ) {
        super(leaf);
    }

    getViewType(): string {
        return FLASH_GAME_VIEW_TYPE;
    }

    getDisplayText(): string {
        const title = String(this.opts?.entry.title ?? '').trim();
        return title || 'Flash 游戏';
    }

    getIcon(): string {
        // `gamepad-2` 是 lucide 自带图标名，Obsidian 的图标集是 lucide 子集
        return 'gamepad-2';
    }

    /** 当前页承载的条目 id（宿主用它判断「这个游戏是否已经开着一页」再决定复用还是新开） */
    entryId(): string | null {
        return this.opts?.entry.id ?? null;
    }

    /**
     * 只序列化**条目 id**（⛔ 别把整个 `MediaEntry` 塞进布局文件：那是几十个字段的快照，
     * 下次启动就是一份陈旧数据 —— 标题/评分改了会显示旧值）。
     * 有这一条，Obsidian 重启后布局能把 Flash 页恢复成「同一个游戏」而不是空页。
     */
    getState(): Record<string, unknown> {
        const id = this.entryId();
        return id ? { entryId: id } : {};
    }

    /**
     * 布局恢复：按 id 重新取条目（口径同 `getState` 只存 id）。
     * ⚠️ 调用时机不确定 —— 可能在 `onOpen` 之前（此时只记 opts，由 onOpen 建壳），
     *    也可能之后（这里直接补渲染）。两条都要照顾，⛔ 别只写一边。
     */
    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const raw = state && typeof state === 'object' ? (state as Record<string, unknown>).entryId : undefined;
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (id) {
            try {
                const entry = await this.plugin.service.get(id);
                // 条目可能已被删除（用户删了游戏，但布局还记着这一页）⇒ 保持空页 + 提示
                if (entry) {
                    this.opts = { entry };
                    this.disposed = false;
                    this.refreshLeafHeader();
                    if (this.opened) {
                        if (this.stageEl) {
                            this.renderInto();
                        } else {
                            this.buildShell();
                            this.renderInto();
                        }
                    }
                }
            } catch (err) {
                console.warn('[reelludic] 恢复 Flash 页失败：', err);
            }
        }
        await super.setState(state, result);
    }

    async onOpen(): Promise<void> {
        this.opened = true;
        // 收 srcdoc 回来的缩放状态（置灰到界按钮）。⛔ 别用 registerDomEvent 之流：
        // window 上的监听要在 onClose 里自己摘掉，否则关页后还挂在全局。
        window.addEventListener('message', this.onGameMessage);
        // 后台标签页可能延迟渲染：先把壳建出来，再按当前 opts 决定要不要真挂播放器
        this.buildShell();
        if (this.opts) {
            this.renderInto();
        } else {
            // 走到这里说明条目已被删除（正常恢复路径由 setState 取回 entry 并设 opts）。
            // 不提示的话用户只会看到一块黑舞台，以为播放器坏了。
            this.setStatus('这一页没有关联游戏 —— 从游戏条目的「▶ 启动」重新打开即可。');
        }
    }

    async onClose(): Promise<void> {
        this.disposed = true;
        // 🔴 先把 iframe 卸掉、**稍后**再摘监听：卸载 iframe 会让 srcdoc 文档走
        //    `beforeunload`，那里会 postMessage 最后一份存档；同步摘掉监听就漏了它。
        //    （每 15 秒还有一次定时回传兜底，这里只是避免「最后一局」丢档。）
        const frame = this.frame;
        const host = this.embedHost;
        this.frame = null;
        this.embedHost = null;
        this.stageEl = null;
        this.statusEl = null;
        this.progressEl = null;
        this.progressBarEl = null;
        this.progressTextEl = null;
        this.nameEl = null;
        this.replayBtn = null;
        this.zoomInBtn = null;
        this.zoomOutBtn = null;
        this.fullBtn = null;
        this.exportBtn = null;
        this.importBtn = null;
        // 🔴 先释放内嵌容器再清 DOM：webview 是独立 webContents，元素移除不会自动回收。
        if (host) host.dispose();
        this.contentEl.empty();
        if (frame) {
            window.setTimeout(() => {
                window.removeEventListener('message', this.onGameMessage);
            }, 800);
        } else {
            window.removeEventListener('message', this.onGameMessage);
        }
    }

    /**
     * 载入要播的影片（宿主在 `setViewState` 后调用；同一页可反复换条目，不必新开）。
     * ⚠️ 方法名不能叫 `load` —— `ItemView` 基类已占用，签名不同会编译失败。
     */
    openWith(opts: FlashGameOptions): void {
        this.opts = opts;
        this.disposed = false;
        // 标签页标题跟随游戏名：Obsidian 不在 `getDisplayText()` 变化时自动重画 tab header
        // （开新页那一刻读到的是占位名「Flash 游戏」，真机截图里 5 个同类 tab 全叫「Flash 游戏」）
        // ⇒ 载入后手动刷一次。与 `ReaderViews` / `VideoPlayerView` 同一做法。
        this.refreshLeafHeader();
        // 页没 onOpen 完（延迟渲染）⇒ 只记 opts，由 onOpen 接手
        if (!this.opened) return;
        // 已挂载就重建内容；壳只在 onOpen 建一次
        if (this.stageEl) {
            this.renderInto();
        } else {
            this.buildShell();
            this.renderInto();
        }
    }

    /**
     * 重挂一次影片（宿主在「导入存档」之后调用）。
     *
     * 🔴 为什么必须重挂、而不是 postMessage 塞存档：存档是**影片载入前**灌进 localStorage 的
     *    （见 `pure/flashGame.flashFrameHtml`，Ruffle 启动就 `populateSaves()` 扫过了）。
     *    活着的 iframe 里 Ruffle 已经读过存档表，此时再塞只会等到下一局才生效，
     *    用户会以为「导入没成功」。重挂 `srcdoc` 是唯一可靠的生效方式。
     */
    reloadStage(): void {
        if (!this.opened || this.disposed) return;
        if (!this.opts) return;
        this.renderInto();
    }

    /**
     * 让标签页标题跟上游戏名。
     * `updateHeader` 不在公开 d.ts 里 ⇒ 窄化断言后可选调用（与 `VideoPlayerView.refreshLeafHeader` 同口径）。
     */
    private refreshLeafHeader(): void {
        const leaf = this.leaf as unknown as { updateHeader?: () => void };
        if (typeof leaf.updateHeader === 'function') leaf.updateHeader();
    }

    /**
     * 建页壳：名称行 + 工具按钮 + 状态行 + 舞台（只建一次）。
     *
     * 🔴 2026-11-16 用户逐字返工：「四个图标按钮是替换工具栏的重新载入和在库中定位的文字按钮啊
     *    不是在游戏屏幕显示（两个文字按钮逻辑重复和没必要，删除掉）」
     *    ⇒ 四枚**图标按钮**放这里（宿主页工具栏），srcdoc 里不再有任何浮层控件。
     *    按钮点击跨不过 iframe 边界，所以统一走 postMessage 发指令（见 `sendGame`）。
     */
    private buildShell(): void {
        const host = this.contentEl;
        if (this.stageEl) return; // 已建过，避免重复叠壳
        host.empty();
        host.addClass('rl-fg');
        host.addClass('rl-fg-page');

        const bar = host.createDiv({ cls: 'rl-fg-bar' });
        this.nameEl = bar.createDiv({ cls: 'rl-fg-name', text: this.getDisplayText() });
        const tools = bar.createDiv({ cls: 'rl-fg-tools' });
        // 重玩：清错误提示 + 缩放归 1 + 重新 load 影片（＝原来的「重新载入」，只是换了图标入口）
        this.replayBtn = iconButton('rl-fg-icon', 'rotate-ccw', '重玩（从头开始，缩放归位）');
        this.replayBtn.onclick = () => this.sendGame('replay');
        tools.appendChild(this.replayBtn);
        this.zoomInBtn = iconButton('rl-fg-icon', 'zoom-in', '放大');
        this.zoomInBtn.onclick = () => this.sendGame('zoom-in');
        tools.appendChild(this.zoomInBtn);
        this.zoomOutBtn = iconButton('rl-fg-icon', 'zoom-out', '缩小');
        this.zoomOutBtn.onclick = () => this.sendGame('zoom-out');
        tools.appendChild(this.zoomOutBtn);
        this.fullBtn = iconButton('rl-fg-icon', 'maximize', '全屏');
        this.fullBtn.onclick = () => this.sendGame('fullscreen');
        tools.appendChild(this.fullBtn);
        // 🟠 ① 存档导出 / 导入（用户逐字：「存档是导出备份，需通过导入功能恢复」）。
        //    放在这排图标最后 —— 前四枚是**玩的时候**天天点，这两枚是**换库/重装前后**才点一次。
        this.exportBtn = iconButton('rl-fg-icon', 'upload', '导出存档（备份成 JSON 文件）');
        this.exportBtn.onclick = () => {
            const entry = this.opts?.entry;
            if (entry) void this.plugin.exportGameSaves(entry);
        };
        tools.appendChild(this.exportBtn);
        this.importBtn = iconButton('rl-fg-icon', 'download', '导入存档（用备份文件覆盖当前进度）');
        this.importBtn.onclick = () => {
            const entry = this.opts?.entry;
            if (entry) void this.plugin.importGameSaves(entry);
        };
        tools.appendChild(this.importBtn);

        this.statusEl = host.createDiv({ cls: 'rl-fg-status' });
        // 进度表（用户 m02844）：只在「首次安装运行时」那段出现 —— 轨道 + 填充 + 文字。
        // ⚠️ 与状态行分开两个节点：状态行还要承担错误提示（长句子），进度表只在有百分比时露头。
        this.progressEl = host.createDiv({ cls: 'rl-fg-progress' });
        const track = this.progressEl.createDiv({ cls: 'rl-fg-progress-track' });
        this.progressBarEl = track.createDiv({ cls: 'rl-fg-progress-bar' });
        this.progressTextEl = this.progressEl.createDiv({ cls: 'rl-fg-progress-text' });
        this.stageEl = host.createDiv({ cls: 'rl-fg-stage' });
    }

    /**
     * 给 srcdoc 里的播放器页发一条指令。
     * 🔴 跨源 iframe 拿不到彼此 DOM，唯一通路是 postMessage；srcdoc 的 origin 是 `null`，
     *    所以 `targetOrigin` 只能写 `'*'`，靠消息体里的 `source` 字段自证来路（接收侧同口径）。
     * ⚠️ iframe 还没挂上（正在下载运行时/空态）时静默返回 —— 按钮点了没反应比抛错好。
     */
    private sendGame(type: 'replay' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fullscreen'): void {
        const win = this.frame?.contentWindow;
        if (!win) return;
        try {
            win.postMessage({ source: 'reelludic-flash', type }, '*');
        } catch {
            /* 跨源受限或文档已销毁：不影响下一次操作 */
        }
    }

    /** srcdoc 回报缩放状态时置灰到界的按钮（⛔ 不猜，只按回报值） */
    private onGameMessage = (ev: MessageEvent): void => {
        const d = ev?.data as
            | { source?: string; type?: string; canIn?: boolean; canOut?: boolean; saves?: Record<string, string> }
            | null;
        if (!d || d.source !== 'reelludic-flash') return;
        if (d.type === 'zoom') {
            if (this.zoomInBtn) this.zoomInBtn.disabled = d.canIn === false;
            if (this.zoomOutBtn) this.zoomOutBtn.disabled = d.canOut === false;
            return;
        }
        // 存档回传：只落盘，不动界面（写盘失败也不该打断游戏）
        if (d.type === 'saves' && d.saves && typeof d.saves === 'object') {
            void this.plugin.saveGameSaves(this.opts?.entry.id ?? '', d.saves);
        }
    };

    /** 按当前 opts 重画舞台（装 / 取运行时 + 挂 iframe；首装会下载，进度写状态行） */
    private renderInto(): void {
        const stage = this.stageEl;
        if (!stage || !this.opts) return;
        stage.empty();
        this.frame = null;
        // 重画前先把上一个内嵌容器释放掉（webview 是独立 webContents，不释放会残留）
        this.embedHost?.dispose();
        this.embedHost = null;
        const entry = this.opts.entry;
        if (this.nameEl) this.nameEl.setText(entry.title || 'Flash 游戏');
        // 重画 = 一次全新的加载：先清掉上一轮的状态行与进度表，
        // 否则「重新载入」时会先闪一下旧百分比再归零。
        this.setStatus('');
        this.setProgress(null);

        // ① 先确认 swf 本身可用（路径空 / 扩展名不是 swf 都在这里拦，省一次 10MB 下载）
        const rel = String(entry.gameSwf ?? '').trim();
        if (rel && isFlashPath(rel)) {
            const swfUrl = this.plugin.resolveEmbedUrl(rel);
            if (!swfUrl) {
                this.setStatus('拿不到这个 swf 的本地地址（文件可能已被移动或删除）。');
                return;
            }
            // ② 运行时（首次会下载安装）—— 异步，回来先看 disposed
            // 原生舞台尺寸：获取时从详情页抓到的宽高（P0 留档）。成对且可信才算数，
            // 否则 `clampGameStage` 回 undefined，退回「填满可用区」的默认行为。
            const stageBox = clampGameStage(entry.gameWidth, entry.gameHeight);
            void this.ensureAndMount(swfUrl, entry.title || 'Flash 游戏', stageBox);
            return;
        }
        // ③ H5 / Unity：没有可下载的 swf，但有条能在 iframe 里跑的在线播放页
        //    （真机实测 4399 详情页无 X-Frame-Options / 无 CSP，嵌入可行；见 types.ts 的 gameEmbed 注释）
        const embed = String(entry.gameEmbed ?? '').trim();
        if (/^https?:\/\//i.test(embed)) {
            this.mountEmbed(stage, embed);
            return;
        }
        if (!rel) {
            // 两条入口都能挂 swf（2026-11-16 起快捷关联弹窗也有「Flash 影片」行）——
            // ⛔ 别只写编辑属性，否则用户按提示找不到快捷入口。
            this.setStatus('这个条目还没有关联 .swf —— 在卡片右键「快捷关联」的「Flash 影片」行点「获取」或「浏览」，也可以走「编辑属性 → 启动路径」。');
            return;
        }
        this.setStatus('关联的文件不是 .swf，无法用 Flash 播放器打开。');
    }

    /**
     * H5 / Unity：把在线播放页整个嵌进舞台。
     *
     * 🔴 为什么是「嵌 4399 的播放页」而不是「嵌游戏中间页」：Unity 中间页（`…/index.html`）
     *    带 Referer 校验，插件直连只会拿到「访问错误 / 请到4399官网开始游戏」；
     *    但嵌在 4399 页面里时 Referer 是 4399 自己，于是能跑（探针实证）。
     *
     * ⚠️ 与 swf 分支不同：这里**不需要** Ruffle 运行时，也就不该等那 10MB 下载。
     *
     * 🔴 2026-11-16（用户：「启动暴走英雄坛开始游戏后就跳转浏览器了」）——
     *    4399 的「开始游戏」本质是 `<a target="_blank">` / `window.open(...)`
     *    （实测 `.start-btn` 指向 `//www.zxwyouxi.com/g/100053785`）。Electron 宿主默认
     *    把这类新窗口交给**系统浏览器**，于是游戏跑出插件、也带不进存档。
     *
     * 🔴 2026-11-16 第二轮（用户：「根本登录不了 4399 账号一登录就刷新重置」）——
     *    真因是**第三方存储分区**：iframe 里的 4399 属于 app:// 下的跨站第三方上下文，
     *    cookie 落不了盘（实测三个域一条都没有）；同一地址放进 `<webview>` 立刻写进 5 条。
     *    ⇒ 承载层换成 `mountEmbedHost`（webview 优先，只有宿主禁用 webviewTag 才降级 iframe）。
     *    新窗口接管也在那一层做（`setWindowOpenHandler` + 就地导航 + 一律 deny）。
     *
     * ⛔ 别在本方法里自己设置 sandbox：webview 分支不能带 sandbox（会挡掉它的独立进程能力），
     *    而降级 iframe 分支的 sandbox 白名单由 `gameEmbedHost.ts` 统一维护 —— 两处都改会打架。
     */
    private mountEmbed(stage: HTMLElement, url: string): void {
        stage.empty();
        this.embedHost?.dispose();
        const host = mountEmbedHost(stage, url, 'rl-fg-frame');
        this.embedHost = host;
        this.frame = host.el as unknown as HTMLIFrameElement;
        this.setStatus(
            host.kind === 'webview'
                ? ''
                : '当前环境不支持内嵌窗口（webview），已降级为 iframe —— 登录态可能无法保持。',
        );
    }

    /** 取运行时后挂 iframe（拆出来是为了让 `renderInto` 保持同步、可被按钮直接调用） */
    private async ensureAndMount(
        swfUrl: string,
        title: string,
        stageBox?: { width: number; height: number },
    ): Promise<void> {
        let ruffleDir = '';
        try {
            ruffleDir = await this.plugin.ensureRuffleRuntime((pct, label, detail) => {
                this.setProgress(pct, label, detail);
            });
        } catch (err) {
            this.setProgress(null);
            this.setStatus(`Flash 运行时安装失败：${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        if (this.disposed) return;
        this.setProgress(null);
        if (!ruffleDir) {
            this.setStatus('Flash 运行时不可用 —— 桌面端才能在插件内播放本地 swf。');
            return;
        }
        const baseUrl = this.plugin.resolveEmbedUrl(ruffleDir);
        if (!baseUrl) {
            this.setStatus('拿不到 Flash 运行时的本地地址（插件目录不可读）。');
            return;
        }
        // 期间用户可能已点「重新载入」/换了条目 ⇒ 舞台已清空，别往旧舞台挂
        const stage = this.stageEl;
        if (!stage) return;

        // 存档快照：读落盘的那份灌进 srcdoc（srcdoc 的 localStorage 关页即销毁，
        // 不灌的话每次打开都像第一次玩）。读不到就空对象，不影响开局。
        const entryId = this.opts?.entry.id ?? '';
        const saves = entryId ? await this.plugin.loadGameSaves(entryId) : {};
        if (this.disposed) return;

        // ③ 挂 iframe：srcdoc 隔离 + 绝对 app:// URL
        stage.empty();
        const frame = stage.createEl('iframe', { cls: 'rl-fg-frame' });
        frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
        frame.setAttribute('allowfullscreen', 'true');
        // ⚠️ 不给 sandbox：srcdoc 默认继承父级权限；加了 allow-scripts 反而会与 Ruffle 的
        //    动态 script 注入打架（探针里能跑，是**不加 sandbox** 的那一档）。
        frame.srcdoc = flashFrameHtml({ ruffleBaseUrl: baseUrl, swfUrl, title, stage: stageBox, saves });
        this.frame = frame;
        this.setStatus('');
    }

    /** 状态行：空串 = 隐藏 */
    private setStatus(text: string): void {
        const el = this.statusEl;
        if (!el) return;
        el.setText(text);
        el.toggleClass('is-on', !!text);
        // 🔴 有话说时收掉进度表：两者同屏会自相矛盾（真机截到过「没有关联本地 swf」
        //    与「正在下载 … 14%」并存）。进度表只服务于「正在做」，一旦转为结论/错误就交棒。
        if (text) this.setProgress(null);
    }

    /**
     * 进度表（用户 m02844「做进度表」）—— `pct` 传 `null` 则整块收起。
     *
     * 显示三段信息：**在干什么** · **已下载/总量** · **百分比**。
     * 🔴 为什么不是一行文字：这一包 10MB / 实测 278 秒，只有一个静止的「正在下载」时用户
     *    完全分不清是卡死还是在下；而单独的百分比又说不出量级（下到 3.2MB 还是 8MB）。
     *
     * ⚠️ `detail.total` 可能是 0（服务端没给 content-length，或第一跳 302 无 body）⇒
     *    此时只显示已下载量、**不显示百分比**，⛔ 别除以 0 报个假 100%。
     * ⚠️ 解压段传的是「文件数 / 总文件数」，单位不是字节 ⇒ 用 `detail.total < 1024*1024`
     *    这类量级判断并不可靠，这里统一：**有 total 就显示 raw 数字**，措辞交给 `label`。
     */
    private setProgress(
        pct: number | null | undefined,
        label?: string,
        detail?: { received: number; total: number },
    ): void {
        const box = this.progressEl;
        const bar = this.progressBarEl;
        const text = this.progressTextEl;
        if (!box || !bar || !text) return;
        const hasPct = typeof pct === 'number' && Number.isFinite(pct);
        // 🔴 两种「要显示」的情况不能混为一谈：
        //    ⑴ 有百分比 ⇒ 正常进度；
        //    ⑵ **没有百分比但有已收字节**（服务端不给 content-length / 第一跳 302 无 body）
        //       ⇒ 仍然要显示，只是填充条走「不确定态」动画 —— ⛔ 别因为 pct 是 undefined
        //       就把整块收起：那样用户在真机上看到的是「一直空白跟卡死一样」，正是要修的问题。
        const hasBytes = !hasPct && !!detail && detail.received > 0;
        const shown = hasPct || hasBytes;
        box.toggleClass('is-on', shown);
        if (!shown) {
            // 收起时清干净，避免下次安装一闪而过显示上一轮的旧数字
            bar.style.width = '0%';
            bar.removeClass('is-indeterminate');
            text.setText('');
            return;
        }
        // 🔴 反方向也交棒：进度表一出现就清掉状态行，否则会留着上一轮的结论/错误
        //    （如「这个条目没有关联本地 swf」）与「正在下载 …」同屏矛盾。
        //    单向调用成立：setStatus('') 里 `if (text)` 为假，不会再调回这里，不会递归。
        this.setStatus('');
        if (hasPct) {
            const value = Math.max(0, Math.min(100, Math.round(pct as number)));
            bar.style.width = `${value}%`;
            bar.removeClass('is-indeterminate');
            const parts: string[] = [];
            if (label) parts.push(label);
            if (detail && detail.total > 0) {
                parts.push(`${formatBytes(detail.received)} / ${formatBytes(detail.total)}`);
            }
            parts.push(`${value}%`);
            text.setText(parts.join(' · '));
            return;
        }
        // 无总量：只说已下载多少，条走不确定态（宽度交给 CSS 动画，⛔ 别写死一个假百分比）
        bar.style.width = '100%';
        bar.addClass('is-indeterminate');
        const parts: string[] = [];
        if (label) parts.push(label);
        if (detail) parts.push(`已下载 ${formatBytes(detail.received)}`);
        text.setText(parts.join(' · '));
    }
}
