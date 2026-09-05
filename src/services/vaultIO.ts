// obsidian VaultIO 适配器：把 data/catalog 的 VaultIO 接口接到 Obsidian Vault API
import { App, TFile, normalizePath } from 'obsidian';
import type { VaultIO } from 'data/catalog';

/** vault.create 不会自动创建父目录，首写多层路径（ReelLudic/catalog.json 等）会抛 ENOENT；逐层补齐 */
async function ensureParentFolder(vault: App['vault'], filePath: string): Promise<void> {
    const segments = filePath.split('/');
    let cur = '';
    for (const seg of segments.slice(0, -1)) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!vault.getAbstractFileByPath(cur)) {
            await vault.createFolder(cur);
        }
    }
}

export function createVaultIO(app: App): VaultIO {
    return {
        async readText(path: string) {
            const f = app.vault.getAbstractFileByPath(normalizePath(path));
            if (!(f instanceof TFile)) throw new Error('ENOENT: ' + path);
            // 用 .read() 而非 cachedRead()：我们刚 vault.modify 写入后，cachedRead 缓存可能
            // 仍在微任务中未失效，导致紧跟的 refreshViews 读到旧数据，UI 滞后 ~500ms
            return app.vault.read(f);
        },
        async writeText(path: string, content: string) {
            const p = normalizePath(path);
            const f = app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) {
                await app.vault.modify(f, content);
            } else {
                await ensureParentFolder(app.vault, p);
                await app.vault.create(p, content);
            }
        },
        async deleteFile(path: string) {
            const f = app.vault.getAbstractFileByPath(normalizePath(path));
            if (f instanceof TFile) {
                await app.vault.delete(f);
            }
            // 文件不存在：静默返回（删除的目标可能已被外部移除）
        },
    };
}
