// 影视本地视频内嵌播放器弹窗（点「观看」/选集后落地播放）
// 复用 ReaderModal 沉浸式骨架；本类自带视频区 + 顶部控制条，不走 Svelte、纯 DOM API
// 播放源 URL 由 main 层算好传入（库内 getResourcePath(TFile) / 库外 app:// 推导），本弹窗只负责渲染播放
// Chromium 解码不了的格式（mkv/h265 等）由 main 层 isEmbeddableVideoPath 预判直接转系统播放器，不进本弹窗；
// 即便进了（如 mp4 封装异常），<video> error 时也回调 onExternalFallback 自动转系统，不黑屏卡死
import { App, Modal } from 'obsidian';

/** 可内嵌播放的剧集条目（main 层按 episodeFiles 过滤「仅可内嵌」项后构造） */
export interface EmbedVideoItem {
    /** 剧集下标（0 基，对应 episodeFiles 数组位；仅用于展示「第 N 集」与回调） */
    index: number;
    /** 集标题（可空；有则标题栏显示） */
    title?: string;
    /** 播放源 URL（已由 main 解析：库内 http/app、库外 app://） */
    url: string;
    /** 本地原始路径（供「外部打开」转系统播放器 / error 兜底回调） */
    path: string;
    /** 是否为首集/末集（main 计算边界，按钮置灰用） */
    isFirst: boolean;
    isLast: boolean;
}

export interface VideoPlayerModalOptions {
    /** 片名（标题栏） */
    entryTitle: string;
    /** 可内嵌播放列表（已按剧集顺序） */
    items: EmbedVideoItem[];
    /** 起始播放项下标（items 内，0 基） */
    startIndex: number;
    /** 「外部打开」/解码失败兜底：转系统播放器打开指定路径（main 层 shell.openPath） */
    onExternalFallback: (path: string) => void;
}

/** 顶部操作文案（每集按钮/标题），纯展示用 */
function episodeLabel(item: EmbedVideoItem): string {
    return `第 ${item.index + 1} 集${item.title ? ` · ${item.title}` : ''}`;
}

export class VideoPlayerModal extends Modal {
    private cur: number;
    private videoEl!: HTMLVideoElement;
    private titleTextEl!: HTMLElement;
    private prevBtn!: HTMLButtonElement;
    private nextBtn!: HTMLButtonElement;
    /** error 已触发标志：防止 error 期间再次切源/兜底重复调用 */
    private failed = false;

    constructor(app: App, private options: VideoPlayerModalOptions) {
        super(app);
        const n = options.items.length;
        this.cur = Math.max(0, Math.min(options.startIndex, n - 1));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        // 沉浸式近全屏（保留自绘顶部条与关闭，不加 rl-reader-immersive——那会隐藏自绘外的原生骨架）
        this.modalEl.addClass('rl-vp');
        this.modalEl.style.width = '92%';
        this.modalEl.style.maxWidth = '1200px';
        this.modalEl.style.height = '90%';
        contentEl.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden';

        const root = contentEl.createDiv({ cls: 'rl-vp-root' });

        // 顶部控制条：片名+集号标题 ｜ 上一集 下一集 ｜ 外部打开 ✕
        const bar = root.createDiv({ cls: 'rl-vp-bar' });
        const titleWrap = bar.createDiv({ cls: 'rl-vp-title-wrap' });
        this.titleTextEl = titleWrap.createDiv({ cls: 'rl-vp-title' });
        const ops = bar.createDiv({ cls: 'rl-vp-ops' });
        this.prevBtn = ops.createEl('button', { cls: 'rl-btn rl-vp-btn', text: '‹ 上一集' });
        this.prevBtn.addEventListener('click', () => this.goto(this.cur - 1));
        this.nextBtn = ops.createEl('button', { cls: 'rl-btn rl-vp-btn', text: '下一集 ›' });
        this.nextBtn.addEventListener('click', () => this.goto(this.cur + 1));
        const extBtn = ops.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-ext', text: '外部打开' });
        extBtn.setAttribute('data-tip', '改用系统播放器打开（mkv/HEVC 等内嵌解码不支持的格式用此兜底）');
        extBtn.addEventListener('click', () => this.openExternal());
        const closeBtn = ops.createEl('button', { cls: 'rl-btn rl-vp-btn rl-vp-close', text: '✕' });
        closeBtn.setAttribute('data-tip', '关闭播放器');
        closeBtn.addEventListener('click', () => this.close());

        // 视频区：黑底 flex 居中，等比缩放
        const stage = root.createDiv({ cls: 'rl-vp-stage' });
        this.videoEl = document.createElement('video');
        this.videoEl.controls = true;
        this.videoEl.preload = 'metadata';
        this.videoEl.addEventListener('error', () => {
            // 解码失败/源不可读 → 自动转系统播放器（用户已确认「不支持的自动转系统」）
            const item = this.options.items[this.cur];
            if (!item || this.failed) return;
            this.failed = true;
            this.options.onExternalFallback(item.path);
            this.close();
        });
        // 加载失败无 control 黑屏也兜底：手动 load 后仍不可用视为失败（极少，防御）
        stage.appendChild(this.videoEl);

        this.render();
    }

    onClose(): void {
        // 停播释放：清除 src 释放文件句柄/解码资源
        if (this.videoEl) {
            this.videoEl.pause();
            this.videoEl.removeAttribute('src');
            this.videoEl.load();
        }
        this.contentEl.empty();
    }

    /** 渲染当前集：标题 + video src + 边界按钮置灰 */
    private render(): void {
        const item = this.options.items[this.cur];
        if (!item) return;
        this.failed = false;
        this.titleTextEl.setText(`${this.options.entryTitle} · ${episodeLabel(item)}`);
        // 切源：清旧 src 再设新（同一 video 复用，避免重建元素丢失播放器状态）
        this.videoEl.pause();
        this.videoEl.removeAttribute('src');
        this.videoEl.load();
        this.videoEl.src = item.url;
        // 置灰边界
        this.prevBtn.disabled = item.isFirst;
        this.nextBtn.disabled = item.isLast;
        void this.videoEl.play().catch(() => {
            // 自动播放被拦（部分环境）：留在暂停态让用户点播放即可，不视为失败
        });
    }

    /** 切到相邻集（首集再上/末集再下已置灰，正常不可达；防御性 return） */
    private goto(idx: number): void {
        if (idx < 0 || idx >= this.options.items.length || idx === this.cur) return;
        this.cur = idx;
        this.render();
    }

    /** 当前集「外部打开」：直接转系统播放器并关闭弹窗 */
    private openExternal(): void {
        const item = this.options.items[this.cur];
        if (!item) return;
        this.options.onExternalFallback(item.path);
        this.close();
    }
}
