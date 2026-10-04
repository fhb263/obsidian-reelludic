// 设置页「媒体库目录」的两种文件夹选法（2026-09-23 #380）：
//   ① 主路径 = 输入框**边打边提示**（`AbstractInputSuggest`，Obsidian 1.4.10+）
//   ② 降级   = 「浏览」按钮 + 模糊搜索弹层（`FuzzySuggestModal`，Obsidian 0.9.20+）
//
// 🔴 ① 必须**运行时取基类**，⛔ 不能写静态的 `class X extends AbstractInputSuggest`：
//    `AbstractInputSuggest` 是 1.4.10 才有的导出，而本插件 `minAppVersion` = **0.15.0**。
//    静态继承时基类在旧版本上是 `undefined` ⇒ **模块加载期就抛 TypeError** ⇒
//    后果不是「这个功能不可用」，而是**整个插件起不来**。所以基类运行时读、读不到就返回 null 走降级。
import { AbstractInputSuggest, App, FuzzySuggestModal, TFolder } from 'obsidian';

/**
 * 库内文件夹候选（**唯一入口**：输入建议与降级弹层共用，⛔ 别各写一份过滤）。
 * 排除**库根** —— 媒体库目录必须是**子文件夹**（填根会被归一成默认名，徒增困惑）。
 * ⚠️ `getAllLoadedFiles` 是同步的（读已加载的索引）；文件夹极少变动，调用方在设置页渲染时取一次即可。
 */
export function folderCandidates(app: App): TFolder[] {
    return app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && !f.isRoot());
}

/** ② 降级入口：模糊搜索弹层（列出全部库内文件夹，输入即模糊过滤） */
export class VaultFolderSuggest extends FuzzySuggestModal<TFolder> {
    constructor(
        app: App,
        private folders: TFolder[],
        private onPick: (folder: TFolder) => void,
        placeholder = '输入关键字过滤文件夹…',
    ) {
        super(app);
        this.setPlaceholder(placeholder);
        this.setInstructions([
            { command: '↑↓', purpose: '选择' },
            { command: '↵', purpose: '确认' },
            { command: 'esc', purpose: '取消' },
        ]);
    }

    getItems(): TFolder[] {
        return this.folders;
    }

    getItemText(folder: TFolder): string {
        return folder.path;
    }

    onChooseItem(folder: TFolder): void {
        this.onPick(folder);
    }
}

/** 输入建议实例的最小对外契约（调用方只需能关掉它；不必知道 AbstractInputSuggest 的类型） */
export interface FolderInputSuggest {
    close(): void;
}

type SuggestBase = new (app: App, el: HTMLInputElement) => AbstractInputSuggest<TFolder> & FolderInputSuggest;

/**
 * ① 给输入框挂「边打边提示」。**旧版本（无该 API）返回 `null`** ⇒ 调用方退回 {@link VaultFolderSuggest} 按钮。
 *
 * ⚠️ 返回的实例要在设置页**重渲染/销毁时 `close()`** —— 设置页容器是复用的，不关会留下孤儿浮层。
 * ⚠️ 只在「用户从候选里选中」时回调 `onPick`；打字本身不回调（提交时机由调用方决定，见 Settings）。
 */
export function attachFolderInputSuggest(
    app: App,
    inputEl: HTMLInputElement,
    folders: TFolder[],
    onPick: (folder: TFolder) => void,
): FolderInputSuggest | null {
    const Base = AbstractInputSuggest as unknown as SuggestBase | undefined;
    if (typeof Base !== 'function') return null; // 旧版本：该 API 不存在 ⇒ 走降级按钮
    class FolderSuggest extends Base {
        // ⚠️ 基类里 `getSuggestions` 是 **protected**（`d.ts` 如此）⇒ 覆写也必须 protected
        protected getSuggestions(query: string): TFolder[] {
            const q = query.trim().toLowerCase();
            return q ? folders.filter((f) => f.path.toLowerCase().includes(q)) : folders;
        }

        renderSuggestion(folder: TFolder, el: HTMLElement): void {
            el.setText(folder.path);
        }
    }
    const suggest = new FolderSuggest(app, inputEl);
    suggest.onSelect((folder) => onPick(folder));
    return suggest;
}
