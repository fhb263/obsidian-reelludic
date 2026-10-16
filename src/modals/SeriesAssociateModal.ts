/**
 * 系列「批量关联」弹窗（#629）—— 系列折叠卡右键 →「批量关联」的落点。
 *
 * 🔴 用户口径：「新增系列卡片右键菜单-批量关联按钮」→ 问答裁定 = **逐条清单**：
 *    一个弹窗内把这一系列列全，逐行显示关联状态，点行开出**既有的**单条关联弹窗。
 *
 * 🔴 与 `SeriesReorderModal` 同一套壳约定（照抄它那三条）：
 *    · 挂在宿主 `Modal` ⇒ 遮罩 / Esc / 点外面关闭 / 焦点管理全部交给宿主，插件内**不自造遮罩**；
 *    · **保存实例并在 `onClose` 里销毁** —— 不销毁的话响应式逻辑会在弹窗关掉后继续往已卸载的 DOM 上写；
 *    · 清空宿主自带的标题文字（标题改由内容里的那行承担），⛔ 别隐藏宿主那枚关闭钮、也别自绘第二枚。
 *
 * ⚠️ 本文件**只是壳**：算宽度 + 挂 `SeriesAssoc.svelte` + 在每条关联弹窗关掉后**刷新清单**。
 * 🔴 刷新时机 = 那张关联弹窗 `commit()` **落库完成之后**（它给的 `onClosed` 钩子）——
 *    早一拍会读到旧数据，清单上那条还写着「未关联」，用户会以为没生效。
 * ⚠️ **嵌套弹窗是刻意的**：子弹窗关掉后清单还在原处（滚动位置都不丢）—— ⛔ 别改成
 *    「先关自己再开它、完了再开回来」，那会白白丢掉用户的浏览上下文。
 */
import { Modal, type App } from 'obsidian';
import type ReelLudicPlugin from '../../main';
import type { MediaEntry } from 'data/types';
import type { SeriesGroup } from 'pure/seriesGroup';
import { seriesAssocRows } from 'pure/seriesAssoc';
import { forceHideScroll } from 'services/scrollPref';
import SeriesAssoc from 'views/components/SeriesAssoc.svelte';

export class SeriesAssociateModal extends Modal {
    private instance: SeriesAssoc | null = null;
    /** 打开那一刻的成员 id（顺序即清单顺序）—— 刷新按它重取，组里被删掉的条目自动消失 */
    private readonly ids: string[];

    constructor(
        app: App,
        private plugin: ReelLudicPlugin,
        /** 打开那一刻的组快照（键 + 类型 + 显示名 + 已排好序的成员） */
        private group: SeriesGroup,
        /**
         * 开某一条的关联弹窗（宿主给：`plugin.quickAssociateEntry`）。
         * `onClosed` 在**落库完成后**回调 ⇒ 壳子靠它刷新清单。
         */
        private openAssociate: (entry: MediaEntry, onClosed: () => void) => void,
    ) {
        super(app);
        this.ids = group.items.map((e) => e.id);
    }

    onOpen(): void {
        const { contentEl } = this;
        this.titleEl.setText('');
        contentEl.empty();
        // 🔴 #630：本窗**恒隐藏滚动条**（用户点名）—— 与选集 / 快捷关联那两处同一档（`forceHideScroll`）
        forceHideScroll(this.modalEl);
        // 宽度：单列清单，够放「序号 + 标题 + 关联摘要 + 关联入口」即可（⛔ 别跟着窗口越长越宽）
        this.modalEl.style.width = 'min(560px, 92vw)';
        this.modalEl.style.maxWidth = 'min(560px, 92vw)';

        this.instance = new SeriesAssoc({
            target: contentEl,
            props: {
                title: `批量关联 · ${this.group.title}`,
                groupType: this.group.type,
                rows: seriesAssocRows(this.group.items),
                entries: this.group.items,
                onOpenRow: (entry: MediaEntry) => {
                    // 🔴 嵌套弹窗：开这一条的关联窗；它**关掉且落库完成后**再刷新清单
                    this.openAssociate(entry, () => { void this.refresh(); });
                },
            },
        });
    }

    /** 重取条目 → 重算清单行与顶部读数（只 `$set` 这两个 prop，组件本身不重建） */
    private async refresh(): Promise<void> {
        if (!this.instance) return;
        // 🔴 每次刷新都**重读 catalog**（`service.list()` 走的是落库那份）——
        //    ⛔ 别缓存条目：用户刚在子弹窗里改完的那些字段正是要看到的东西。
        const all = await this.plugin.service.list();
        const byId = new Map(all.map((e) => [e.id, e]));
        // 顺序照打开时的 id 顺序；已经查不到的（被删 / 改了系列）跳过 —— 与 `SeriesReorder` 的脏行处理同一条纪律
        const items = this.ids.map((id) => byId.get(id)).filter((x): x is MediaEntry => !!x);
        this.instance.$set({ rows: seriesAssocRows(items), entries: items });
    }

    onClose(): void {
        this.instance?.$destroy();
        this.instance = null;
        this.contentEl.empty();
    }
}
