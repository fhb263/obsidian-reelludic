// 本地剧集集数选择弹窗（海报墙「观看」按钮 → 影视条目二次列出 1..N 集；电影多资源时按「文件 N」措辞）
// 每集按钮只显示集数数字，「第 N 集 + 集标题」悬停提示（如悬停显示「第 1 集 开始」；**走 data-tip 自绘气泡**，
// 见下方 #448 注释 —— 原生 title 在「未关联（按钮 disabled）」那一档实机上不弹）；点击返回集下标，播放逻辑由调用方按本地优先处理
// DOM API 渲染，风格复用 ConfirmModal/LinkPickerModal；open() 返回选中的集下标（0-based），取消/关闭返回 null
import { App, Modal } from 'obsidian';

export class EpisodePickerModal extends Modal {
    private resolve: ((idx: number | null) => void) | null = null;

    constructor(
        app: App,
        private entryTitle: string,
        private episodeFiles: (string | undefined)[],
        private episodeUrls: (string | undefined)[],
        private episodeTitles: (string | undefined)[],
        /** 电影（无「集」概念，多资源 = 多个文件）：标题与提示改用「文件 N」措辞 */
        private single = false,
    ) {
        super(app);
    }

    open(): Promise<number | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createDiv({ cls: 'rl-nc-desc rl-eps-title', text: this.single ? `选择要播放的文件：《${this.entryTitle}》` : `选择集数：《${this.entryTitle}》` });
        // 🔴 #447 用户裁定：「把滑动条移除掉，剧集按钮对齐框」⇒ 加 `.rl-eps-grid-fill`：
        //    ① 去掉基础类的 `max-height + overflow-y`（那是给**快捷关联弹窗**用的窄框）；本弹窗要**一眼看全**，
        //       全列出来后若真的超出视口，交给**宿主 `.modal` 自己滚**（`.modal` 本就 `max-height: --dialog-max-height`
        //       + `overflow: auto`，按钮仍然够得着 —— 这比在框里滚一层更好）。
        //    ② 按钮改 `grid + minmax(44px,1fr)`：每行铺满框内宽度、左右留白一致（flex-wrap 下多余空间全堆右侧，
        //       再加上滚动条占位，就是用户截图里「按钮没跟框对齐」的样子）。
        const grid = contentEl.createDiv({ cls: 'rl-eps-grid rl-eps-grid-fill' });
        this.episodeFiles.forEach((path, i) => {
            const url = this.episodeUrls[i];
            const title = this.episodeTitles[i];
            const linked = !!path || !!url;
            // 按钮文字 = 序号；悬停提示 = 「第 N 集 集标题」（电影态 = 「文件 N 标题」）
            const label = this.single ? `文件 ${i + 1}${title ? ` ${title}` : ''}` : `第 ${i + 1} 集${title ? ` ${title}` : ''}`;
            const hint = linked
                ? [label, path ? `本地：${path}` : '', url ? `网络：${url}` : ''].filter(Boolean).join('\n')
                : `${label}（未关联，可在编辑表单中添加）`;
            // 🔴 #448：悬停提示改成 `data-tip`（项目 UI 规范：一律自绘气泡，禁原生 `title` 黄条）。
            // 用户报障原话：「选择集数窗口鼠标悬停怎么没有[第1集 标题]呢」—— 这批集**一条都没关联**时
            // 按钮全是 `disabled`，原生 `title` 在实机上不弹（自绘气泡则由 document 级委托兜住）。
            // ⚠️ **不需要额外包一层 span**：已用真 Chrome + CDP 可信输入实测（`_probe_hovertarget448.cjs`）——
            //    禁用按钮**照样收到 mouseover**（`elementFromPoint` 命中的就是它），`closest('[data-tip]')` 直接命中；
            //    「挂外层」与「挂按钮」四种组合全通 ⇒ 按最省事的那一种写，⛔ 别凭直觉加包层。
            const btn = grid.createEl('button', {
                cls: linked ? 'rl-eps-btn linked' : 'rl-eps-btn',
                text: String(i + 1),
                attr: linked ? { 'data-tip': hint } : { 'data-tip': hint, disabled: 'true' },
            });
            if (linked) btn.onclick = () => this.finish(i);
        });
        const ops = contentEl.createDiv({ cls: 'rl-nc-ops' });
        const cancel = ops.createEl('button', { cls: 'mod-cta', text: '取消' });
        cancel.onclick = () => this.finish(null);
    }

    onClose(): void {
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(idx: number | null): void {
        this.resolve?.(idx);
        this.resolve = null;
        this.close();
    }
}

