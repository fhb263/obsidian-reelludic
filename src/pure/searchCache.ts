// 搜索结果内存缓存（纯逻辑，可单测）
// 参考 obsidian-douban SyncStatusHolder 的幂等/去重思路：同一关键词重复搜索直接命中缓存，
// 减少外部 API 调用（对 429 限流的 Google Books、反爬敏感的 Douban 尤其重要）。
// 策略：TTL 过期失效；maxSize 满时简单全清（搜索场景容量小、代价低）。

export interface SearchCache<T> {
    /** 命中且未过期返回条目；未命中或过期返回 undefined（过期即删除） */
    get(key: string): T[] | undefined;
    set(key: string, items: T[]): void;
    clear(): void;
    readonly size: number;
}

export function createSearchCache<T>(opts: { ttlMs: number; maxSize: number }): SearchCache<T> {
    const store = new Map<string, { items: T[]; ts: number }>();
    return {
        get(key) {
            const hit = store.get(key);
            if (!hit) return undefined;
            if (Date.now() - hit.ts > opts.ttlMs) {
                store.delete(key);
                return undefined;
            }
            return hit.items;
        },
        set(key, items) {
            if (store.size >= opts.maxSize) store.clear();
            store.set(key, { items, ts: Date.now() });
        },
        clear() {
            store.clear();
        },
        get size() {
            return store.size;
        },
    };
}
