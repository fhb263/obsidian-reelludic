/**
 * 系列「排序号」弹窗（#609）—— 海报墙**系列折叠卡右键 →「排序号」**的落点。
 *
 * 🔴 这是对 **#608** 的翻面：那版是「点一下就把整组按当前顺序自动重排」；用户 2026-10-11 裁定
 *    「右键菜单点击排序号给用户弹窗批量勾选排序手动排，**不是自动排**」⇒ 改成开这个弹窗、自己拖着排。
 *
 * 🔴 与 `SeriesPickerModal` 同一套壳约定（照抄它那三条）：
 *    · 挂在宿主 `Modal`（`document.body`）⇒ 遮罩 / Esc / 点外面关闭 / 焦点管理全部交给宿主，插件内**不自造遮罩**；
 *    · **保存实例并在 `onClose` 里销毁** —— 不销毁的话响应式逻辑会在弹窗关掉后继续往已卸载的 DOM 上写；
 *    · 清空宿主自带的标题文字（标题改由内容里的 `h2` 承担），⛔ 别隐藏宿主那枚关闭钮、也别自绘第二枚。
 *
 * ⚠️ 本文件**只是壳**：算宽度 + 挂 `SeriesReorder.svelte` + 把「新顺序」换算成落库补丁。
 * 🔴 落库走 `planSeriesReindexAll`（整组按新顺序 1..N，恒起始 1 / 步长 1）—— ⛔ 别在这里自己写编号循环。
 */
import { Modal, type App } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import { planSeriesReindexAll, type SeriesGroup } from 'pure/seriesGroup';
import SeriesReorder from 'views/components/SeriesReorder.svelte';
import { applyScrollPref } from 'services/scrollPref';

export class SeriesReorderModal extends Modal {
    private instance: SeriesReorder | null = null;

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        /** 打开那一刻的组快照（键 + 类型 + 显示名 + 已排好序的成员） */
        private group: SeriesGroup,
        /** 确认后的落库回调（宿主给；补丁 = `{ id, seriesIndex }[]`） */
        private onApply: (pairs: { id: string; seriesIndex: number }[]) => Promise<void>,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        this.titleEl.setText('');
        contentEl.empty();
        // 宽度：列表是单列，**别跟着窗口越长越宽**（`SeriesPickerModal` 是网格才需要按窗口算）
        this.modalEl.style.width = 'min(520px, 92vw)';
        this.modalEl.style.maxWidth = 'min(520px, 92vw)';

        this.instance = new SeriesReorder({
            target: contentEl,
            props: {
                title: `调整「${this.group.title}」的序号`,
                // 🔴 封面在**宿主**解析后传进来（组件不碰 `plugin`）；
                //    `seriesIndex` 不进列表 —— 序号徽标显示的是**当下位置**（拖完自己会变），
                //    ⛔ 别拿条目原序号去显示（那会在拖动后与实际不符）。
                items: this.group.items.map((e) => ({
                    id: e.id,
                    title: e.title,
                    sub: e.year ? String(e.year) : undefined,
                    poster: this.plugin.resolvePoster(e),
                })),
                onConfirm: (ids: string[]) => {
                    const pairs = planSeriesReindexAll(ids);
                    this.close(); // 先关窗再落库（与季列表/选集的次序一致：落库过程不该压着一层弹窗）
                    if (pairs.length === 0) return;
                    void this.onApply(pairs);
                },
                onCancel: () => this.close(),
            },
        });
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}
