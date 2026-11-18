/**
 * 本地词典的**执行层**：读词典文件、建索引、缓存、查词。
 *
 * 🔴 惰性 + 缓存（用户 §3.1 悬停查词，词可能被反复划过）：
 *    一次读盘 + 一次建索引，结果按「路径 + 大小 + 修改时间」缓存。
 *    用户改了词典文件（大小或 mtime 变了）就重建，⛔ 不做「手动刷新按钮」——
 *    那种按钮的结局永远是「用户忘了点，然后以为坏了」。
 *
 * ⚠️ 依赖全部注入（`DictDeps`），单测才能在没有磁盘的机器上跑；
 *    真实现是 `defaultDictDeps()`，惰性 `require`（移动端没有 Node 模块）。
 */

import { DICT_MAX_BYTES, buildDictIndex, dictTooLarge, lookupDict, type DictEntry, type DictIndex } from 'pure/wordDict';

/** 查词结果：命中给词条，未命中给 `null` 但**不抛** */
export interface DictLookupResult {
    /** 词条；查不到为 null */
    entry: DictEntry | null;
    /** 查不到时的原因（没配词典 / 文件太大 / 读失败）；命中时为空串 */
    reason: string;
}

/** 执行层依赖（真源 = `defaultDictDeps`；单测注入假实现） */
export interface DictDeps {
    /** 文件大小（字节）；文件不存在返回 -1 */
    size: (p: string) => number;
    /** 修改时间（毫秒）；拿不到返回 0 */
    mtime: (p: string) => number;
    /** 读文本（UTF-8） */
    readText: (p: string) => string;
}

/** 缓存快照：同一份文件不重复解析 */
interface DictCache {
    path: string;
    size: number;
    mtime: number;
    text: string;
    index: DictIndex;
}

/** 单例缓存（模块级：词典是全局资源，⛔ 每个视图各建一份 = 内存翻几倍） */
let cache: DictCache | null = null;

/** 清缓存（单测用；生产不调 —— 文件变了靠 size/mtime 自动失效） */
export function clearDictCache(): void {
    cache = null;
}

/**
 * 取（必要时重建）词典缓存。返回 `null` 表示这份配置用不了，`reason` 给人话。
 */
function ensureCache(
    deps: DictDeps,
    path: string,
): { ok: true; cache: DictCache } | { ok: false; reason: string } {
    const trimmed = path.trim();
    if (!trimmed) return { ok: false, reason: '还没有配置本地词典' };
    const size = deps.size(trimmed);
    if (size < 0) return { ok: false, reason: '找不到词典文件' };
    if (dictTooLarge(size)) {
        return { ok: false, reason: `词典文件超过 ${Math.round(DICT_MAX_BYTES / 1024 / 1024)}MB，换一个精简版` };
    }
    const mtime = deps.mtime(trimmed);
    if (cache && cache.path === trimmed && cache.size === size && cache.mtime === mtime) {
        return { ok: true, cache };
    }
    let text: string;
    try {
        text = deps.readText(trimmed);
    } catch {
        // ⚠️ 清掉旧快照：文件刚变成读不了（被删/被独占），⛔ 别继续用上一份
        cache = null;
        return { ok: false, reason: '读取词典文件失败' };
    }
    cache = { path: trimmed, size, mtime, text, index: buildDictIndex(text) };
    return { ok: true, cache };
}

/**
 * 查一个词。宿主注入给视图层的就是它（包一层成 `lookupWord`）。
 *
 * ⚠️ `key` 已经在视图层过了一遍 `lookupKey`（小写 + 剥首尾标点），这里不再处理。
 * ⚠️ 任何异常都吞成 `reason`，⛔ 不让「词典坏了」把整个学习模式打崩。
 */
export function lookupWordInDict(deps: DictDeps, path: string, key: string): DictLookupResult {
    const got = ensureCache(deps, path);
    if (!got.ok) return { entry: null, reason: got.reason };
    try {
        const entry = lookupDict(got.cache.text, got.cache.index, key);
        return entry ? { entry, reason: '' } : { entry: null, reason: '' };
    } catch {
        return { entry: null, reason: '查词时出错' };
    }
}

/** 真实现（惰性 `require`：移动端没有 Node 模块，顶层 import 会让整包崩） */
export function defaultDictDeps(): DictDeps {
    // ⚠️ 必须写 `require('fs')` 而不是 `require('node:fs')`：
    //    `esbuild.config.mjs` 的 `external` 用的是 `builtin-modules` 的**不带前缀**清单，
    //    `node:` 前缀形式不在其中 ⇒ 打包期报 `Could not resolve "node:fs"`（本轮踩过）。
    const fs = require('fs') as {
        statSync: (p: string) => { size: number; mtimeMs: number };
        readFileSync: (p: string, enc: string) => string;
    };
    return {
        size: (p) => {
            try {
                return fs.statSync(p).size;
            } catch {
                return -1;
            }
        },
        mtime: (p) => {
            try {
                return fs.statSync(p).mtimeMs;
            } catch {
                return 0;
            }
        },
        readText: (p) => fs.readFileSync(p, 'utf8'),
    };
}
