// vault 内文件选择器（设置页「选择文件」用）：列出匹配扩展名的文件，可输入过滤
import { App, SuggestModal, TFile } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';

export class VaultFileSuggest extends SuggestModal<TFile> {
    constructor(
        app: App,
        private files: TFile[],
        private onPick: (f: TFile) => void,
        placeholder = '输入过滤…',
    ) {
        super(app);
        this.setPlaceholder(placeholder);
        this.setInstructions([{ command: '↑↓', purpose: '选择' }, { command: '↵', purpose: '确认' }]);
    }

    /** 🔴 #630：滚动条偏好（跟随设置开关）—— 建议弹层的候选列表也算「插件内的滚动条」。
     *  ⚠️ 必须 `super.onOpen()`：`SuggestModal` 的输入框与结果列表都在基类那个方法里建。 */
    onOpen(): void {
        applyScrollPref(this.modalEl);
        super.onOpen();
    }

    getSuggestions(query: string): TFile[] {
        const q = query.trim().toLowerCase();
        return q ? this.files.filter((f) => f.path.toLowerCase().includes(q)) : this.files;
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    onChooseSuggestion(file: TFile): void {
        this.onPick(file);
    }
}
