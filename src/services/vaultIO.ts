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

/** 路径任一段以点开头（如 `.backups/…`）→ Obsidian vault 不索引，需走低层 adapter */
function hasHiddenSegment(p: string): boolean {
    return p.split('/').some((seg) => seg.startsWith('.'));
}

export function createVaultIO(app: App): VaultIO {
    return {
        async readText(path: string) {
            const p = normalizePath(path);
            const f = app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) {
                // 用 .read() 而非 cachedRead()：我们刚 vault.modify 写入后，cachedRead 缓存可能
                // 仍在微任务中未失效，导致紧跟的 refreshViews 读到旧数据，UI 滞后 ~500ms
                return app.vault.read(f);
            }
            // 隐藏路径（点开头目录）不在 vault 索引里（getAbstractFileByPath 恒 null）：
            // 走低层 adapter 直读；文件真不存在时 adapter 抛错，与「ENOENT」契约一致
            return app.vault.adapter.read(p);
        },
        async writeText(path: string, content: string) {
            const p = normalizePath(path);
            if (hasHiddenSegment(p)) {
                // 隐藏路径：adapter.mkdir 不自动建父目录 → 逐层建（已存在抛错忽略）；
                // 且不走 vault.create —— 隐藏文件不进索引，二次写入会走 create 分支报 EEXIST
                const segments = p.split('/');
                let cur = '';
                for (const seg of segments.slice(0, -1)) {
                    cur = cur ? `${cur}/${seg}` : seg;
                    try {
                        await app.vault.adapter.mkdir(cur);
                    } catch {
                        // 已存在：忽略
                    }
                }
                await app.vault.adapter.write(p, content);
                return;
            }
            const f = app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) {
                await app.vault.modify(f, content);
            } else {
                await ensureParentFolder(app.vault, p);
                await app.vault.create(p, content);
            }
        },
        async deleteFile(path: string) {
            const p = normalizePath(path);
            const f = app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) {
                // 🔴 #349（D-7）：走 `fileManager.trashFile` —— 尊重用户「删除文件」偏好（系统回收站 / Obsidian 回收站），
                //    误删可还原。⛔ 不用 `vault.delete`（那是**永久删除**，此前删笔记就是它，删了没法找回来）。
                await app.fileManager.trashFile(f);
                return;
            }
            // 隐藏路径（或索引缺失）：走低层 adapter；不存在时抛错 → 静默（删除目标可能已被外部移除）。
            // ⚠️ 这条分支**没有回收站**（adapter 层无 trash 概念）—— 只用于 `.backups/` 之类插件自己的隐藏目录。
            try {
                await app.vault.adapter.remove(p);
            } catch {
                // 文件不存在：静默返回
            }
        },
        async listFiles(folder: string) {
            // 必须走 adapter.list 而非 getFiles()：后者**不索引点开头目录**，
            // 对 `.backups/` 这类隐藏目录会永远返回空（1.0.4 单文件备份的旧档导入就栽在这里）
            const dir = normalizePath(folder);
            try {
                const listed = await app.vault.adapter.list(dir);
                return listed.files.map((p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p));
            } catch {
                // 目录不存在：空数组（与「不可见目录」同语义）
                return [];
            }
        },
    };
}
