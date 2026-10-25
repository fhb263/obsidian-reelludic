// obsidian 模块测试替身：纯逻辑单测在 Node 下运行，obsidian API 不可用。
// 只在被测试模块真正 import obsidian 时才需要扩展此文件。
export class Plugin {
    app: any;
    manifest: any;
    constructor(app: any, manifest: any) {
        this.app = app;
        this.manifest = manifest;
    }
    async onload(): Promise<void> {}
    async onunload(): Promise<void> {}
    registerEvent(_eventRef: any): void {}
    registerView(_type: string, _viewCreator: any): void {}
    addRibbonIcon(_icon: string, _title: string, _cb: () => void): HTMLElement {
        return document.createElement('div');
    }
    addCommand(_command: any): void {}
    addSettingTab(_tab: any): void {}
}

export class PluginSettingTab {
    app: any;
    containerEl: HTMLElement;
    constructor(app: any) {
        this.app = app;
        this.containerEl = document.createElement('div');
    }
    display(): void {}
}

export class Setting {
    constructor(_containerEl: HTMLElement) {}
    setHeading(): this { return this; }
    setName(_name: string): this { return this; }
    setDesc(_desc: string): this { return this; }
    addText(_cb: (text: any) => any): this { return this; }
    addToggle(_cb: (toggle: any) => any): this { return this; }
    addButton(_cb: (button: any) => any): this { return this; }
    addDropdown(_cb: (dd: any) => any): this { return this; }
}

export class Notice {
    constructor(_message: string) {}
}

export class Modal {
    app: any;
    contentEl: HTMLElement;
    constructor(app: any) {
        this.app = app;
        this.contentEl = document.createElement('div');
    }
    open(): void {}
    close(): void {}
}

export class ItemView {
    app: any;
    containerEl: HTMLElement;
    contentEl: HTMLElement;
    constructor(leaf: any) {
        this.app = leaf?.app;
        this.containerEl = document.createElement('div');
        this.contentEl = document.createElement('div');
    }
    getViewType(): string { return 'unknown'; }
    getDisplayText(): string { return 'unknown'; }
    getIcon(): string { return 'help'; }
    async onOpen(): Promise<void> {}
    async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
    app: any;
    constructor(app: any) { this.app = app; }
}

export class Menu {
    addItem(_cb: (item: any) => any): this { return this; }
    showAtPosition(_pos: any): void {}
}

export class MenuItem {
    setTitle(_t: string): this { return this; }
    setIcon(_i: string): this { return this; }
    onClick(_cb: () => void): this { return this; }
}

export class App {
    vault: any;
    workspace: any;
    metadataCache: any;
}

export class TFile {
    path: string;
    name: string;
    basename: string;
    extension: string;
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || '';
        this.basename = this.name.replace(/\.[^.]+$/, '');
        this.extension = this.name.includes('.') ? this.name.split('.').pop()! : '';
    }
}

export class TFolder {
    path: string;
    name: string;
    constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || '';
    }
}

export const normalizePath = (p: string): string => p.replace(/\\/g, '/');
export const Notice_ = Notice;
