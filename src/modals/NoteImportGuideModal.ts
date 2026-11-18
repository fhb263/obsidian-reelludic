// 「从笔记导入条目」的**引导弹窗**（用户 2026-11-17 ⑥：「导入按钮要弹引导弹窗说明笔记需满足什么
// 条件，不能只提示『没有可导入的笔记』」）。
//
// 🔴 为什么必须有它：导入是个**单向动作**（导入后条目落 catalog、id 写回笔记）。
//    旧实现点「导入」就直接扫描，扫不到只丢一句 `Notice('没有可导入的笔记')` ——
//    用户拿到的信息量是零：不知道扫的是哪个目录、不知道笔记要满足什么、更不知道自己那篇为什么不算。
//    这属于「功能看起来坏了」而不是「用户写错了」，所以要在**动手之前**把判据说清楚。
//
// 🔴 判据只能有一份：本弹窗**只印条件**，不自己判文件（判断全在 `pure/noteImport.scanImportableNotes`）。
//    文案里的类型清单从 `ENTRY_TYPES` / `ENTRY_TYPE_LABELS` 派生，目录从 `baseNotesFolder` 派生 ——
//    ⛔ 别在这儿手写「电剧集动画书籍游戏音乐」，那样加第七种类型时这里会静默过期。
//
// ⚠️ 与 `NoteImportModal` 的分界：那边「列清单 + 勾选」，这边「讲条件 + 两条出口」。
//    两边都不扫库。
import { App, Modal } from 'obsidian';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from 'data/types';
import type { NoteImportSkipped } from 'pure/noteImport';

/** 一轮扫描的结果摘要（零结果时回填，用来解释「为什么它们没被收」） */
export interface NoteImportGuideScan {
    /** 实际读到正文的笔记篇数（读失败的不计） */
    scanned: number;
    /** 被跳过的文件与原因（判据真源在 `pure/noteImport`，这里只搬运） */
    skipped: readonly NoteImportSkipped[];
}

export interface NoteImportGuideOptions {
    /** 笔记根目录（vault 相对），如 `媒体库/笔记` */
    notesDir: string;
    /** 模板文件路径（vault 相对），如 `媒体库/条目模板.md` */
    templatePath: string;
    /** 上一轮扫描结果；`undefined` = 首次打开（还没扫过） */
    lastScan?: NoteImportGuideScan;
    /** 点「扫描笔记」*/
    onProceed: () => void;
    /** 点「生成模板」*/
    onTemplate: () => void;
}

/**
 * 六种合法类型的可读清单（`电影 / 剧集 / 动画 / 书籍 / 游戏 / 音乐`）。
 * 从 `ENTRY_TYPES` 派生：类型表加了新成员，弹窗文案自动跟上。
 */
export function noteImportTypeList(): string {
    return ENTRY_TYPES.map((t) => ENTRY_TYPE_LABELS[t]).join(' / ');
}

/**
 * 条件清单（**唯一文案真源**，单测直接断言它）。
 *
 * 四条对应 `scanImportableNotes` 的四道闸：type 白名单 / title 可用 / 路径未被占用 / 目录范围。
 * ⚠️ 每条都写「不满足会怎样」而不是只写「必须怎样」—— 用户要的是排查线索，不是规矩。
 */
export function noteImportRequirements(notesDir: string): readonly string[] {
    return [
        `① 文件放在「${notesDir}/」下面（这个目录之外的笔记不会被扫描）`,
        `② frontmatter 里 \`type:\` 是六种类型之一：${noteImportTypeList()}`,
        '③ frontmatter 里 `title:` 有真实标题，不能空、也不能是 `{{标题}}` 这种模板占位符',
        '④ 这篇笔记还没被现有条目占用（已有条目记着同一个笔记路径的会跳过）',
    ];
}

export class NoteImportGuideModal extends Modal {
    constructor(app: App, private readonly opts: NoteImportGuideOptions) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-nig-modal');
        contentEl.createEl('h2', { text: '从笔记导入条目' });

        contentEl.createDiv({
            cls: 'rl-pc-desc',
            text: '把已有的 Markdown 笔记识别成条目，让它们出现在海报墙上，并把新 id 写回笔记。',
        });

        this.renderRequirements(contentEl);
        if (this.opts.lastScan) this.renderEmptyResult(contentEl);

        const foot = contentEl.createDiv({ cls: 'rl-pc-foot' });
        const go = foot.createEl('button', { cls: 'mod-cta', text: '扫描笔记' });
        go.onclick = () => {
            this.close();
            this.opts.onProceed();
        };
        const tpl = foot.createEl('button', { cls: 'rl-btn', text: '生成模板' });
        tpl.setAttribute('data-tip', this.opts.templatePath);
        tpl.onclick = () => {
            this.close();
            this.opts.onTemplate();
        };
    }

    /** 四条条件逐行印出来（⛔ 不折成一段长句：用户是来逐条核对的） */
    private renderRequirements(parent: HTMLElement): void {
        const box = parent.createDiv({ cls: 'rl-nig-req' });
        box.createDiv({ cls: 'rl-nig-req-title', text: '一篇笔记要被导入，需要同时满足：' });
        const list = box.createEl('ul', { cls: 'rl-nig-req-list' });
        for (const line of noteImportRequirements(this.opts.notesDir)) {
            list.createEl('li', { text: line });
        }
    }

    /**
     * 零结果说明。
     * 🔴 这是本次报障的正面修复：旧实现只 `Notice('没有可导入的笔记')`，
     *    用户既不知道扫了几篇、也不知道为什么全被拒。这里把**篇数与原因**摆出来。
     */
    private renderEmptyResult(parent: HTMLElement): void {
        const { scanned, skipped } = this.opts.lastScan ?? { scanned: 0, skipped: [] };
        const box = parent.createDiv({ cls: 'rl-nig-empty' });
        box.createDiv({
            cls: 'rl-nig-empty-title',
            text: scanned === 0
                ? `没有读到笔记：「${this.opts.notesDir}/」下没有 .md 文件`
                : `读了 ${scanned} 篇，没有一篇同时满足上面四条`,
        });

        if (skipped.length === 0) {
            box.createDiv({
                cls: 'rl-pc-hint-inline',
                text: scanned === 0 ? '可以先用「生成模板」拿到可复制的字段区块，写到该目录下再来。' : '',
            });
            return;
        }

        box.createDiv({ cls: 'rl-pc-hint-inline', text: `另有 ${skipped.length} 篇被跳过：` });
        const list = box.createEl('ul', { cls: 'rl-nig-skip' });
        // 只列前 12 条：再多会把弹窗撑成一份日志（与 NoteImportModal.renderSkipped 同口径）
        for (const s of skipped.slice(0, 12)) {
            list.createEl('li', { text: `${s.path} —— ${s.reason}` });
        }
        if (skipped.length > 12) {
            list.createEl('li', { text: `……其余 ${skipped.length - 12} 篇同样被跳过` });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
