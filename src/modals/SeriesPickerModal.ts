/**
 * 系列「季列表」弹窗（#444c：从「插件视图内的绝对定位浮层」改成**应用级 Modal**）。
 *
 * 🔴 用户原话（2026-09-30）：「算了，直接改成全仓库，**不局限于当前插件视图内**了，**改成编辑条目弹出窗口这样**」。
 *    背景：用户提的两条诉求 ——「不要遮罩」与「弹窗要更大」—— 在「视图内居中弹窗」这个形态下**互相冲突**：
 *    去掉遮罩仍受**正文区**限制（窄），想变大也只能在正文区里做 ⇒ **4 列就是上限**（复现页 `_shot/sr444c.html` 量过）。
 *    ⇒ 换宿主 `Modal`（挂在 `document.body` 上，与「编辑条目」「下载书籍」同一套）：
 *      · 宽度按**整个窗口**算，不再被插件正文区卡住（同一窗口下 4 列 → 6 列）；
 *      · 遮罩、Esc、点外面关闭、焦点管理全部交给宿主 —— 插件内**不再自造遮罩**。
 *
 * ⚠️ 与 `EntryModal` / `BookDownloadModal` 同一套约定：**保存实例并在 `onClose` 里销毁**
 *    —— 不销毁的话组件里的响应式逻辑会在弹窗关掉后仍往已卸载的 DOM 上写状态。
 * ⚠️ 本文件**只是壳**：算宽度 + 挂 `SeriesPicker.svelte`。
 */
import { Modal, type App } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import {
    seriesPanelWidth,
    SERIES_PANEL_EDGE_GAP,
    type SeriesGroup,
} from 'pure/seriesGroup';
import type { MediaEntry } from 'data/types';
import SeriesPicker from 'views/components/SeriesPicker.svelte';

export class SeriesPickerModal extends Modal {
    private instance: SeriesPicker | null = null;

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        /** 打开那一刻的组快照（键 + 类型 + 显示名 + 已排好序的成员） */
        private group: SeriesGroup,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        // 壳的微调**只有一件**：清空宿主自带的标题文字（标题改由内容里的「组名 + N 部」承担，
        // 两份并存会把头部挤下去）。
        // 🔴🔴 #444d：⛔ **不要再隐藏宿主那枚关闭钮**，也⛔ 别在内容里自绘一枚 ——
        //    上一版正是「自绘 + 想隐藏宿主（那条 `display:none` 没生效）」⇒ 用户截图里**两个 ✕**。
        //    实测（`.workbuddy/tmp/asar/app.js`）：`this.closeButtonEl = this.modalEl.createDiv('modal-close-button …')`
        //    ⇒ 关闭钮挂在 `.modal` 内、右上角。**就让它留着**，出口只有这一个。
        this.modalEl.addClass('rl-series-modal');
        this.titleEl.setText('');
        contentEl.empty();

        // 🔴 宽度按**整个窗口**算（Modal 挂在 body 上 ⇒ 这才是它真正能用的宽）。
        //    ⛔ 别再退回「插件正文区」那套基准 —— 那正是被迫 4 列的原因（#444b 的教训在这里反过来了：
        //      基准取错的方向变了，因为**容器的层级变了**）。
        //    ⚠️ 列数不显式设：宽度定下来后由网格自己 `flex-wrap` 排，算式只负责「给多宽才不出现残行」。
        const availW = Math.max(0, window.innerWidth - 2 * SERIES_PANEL_EDGE_GAP);
        const width = seriesPanelWidth(this.group.items.length, availW);
        this.modalEl.style.width = `min(${width}px, 96vw)`;
        this.modalEl.style.maxWidth = `min(${width}px, 96vw)`;

        this.instance = new SeriesPicker({
            target: contentEl,
            props: {
                group: this.group,
                posterUrl: (e: MediaEntry) => this.plugin.resolvePoster(e),
                colorTheme: this.plugin.settings.colorTheme,
                // ⛔ 没有 `onClose`：关闭钮是宿主那枚 `.modal-close-button`（走 `Modal.close()` ⇒ `onClose()`）。
                // 点某一部/某一季 ⇒ **先关弹窗再执行**（与旧浮层 `runSeriesAction` 同一个次序：
                // 播放器/阅读器起来时不该还压着一层弹窗）
                onPlay: (e: MediaEntry) => {
                    this.close();
                    this.plugin.runEntryAction(e);
                },
            },
        });
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}
