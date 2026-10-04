// 源「清单」的**宽松解析**（#432 甲 · 决策 D-32）。
//
// 背景：现在导入书源只有一条路 —— 用户在磁盘上有一个 `.json` 文件，挑它。
// 本轮补齐另外两条：**粘一段文本**、**给一个订阅地址**（拉回来再解析）。三条路最终都要回答同一个问题：
// 「这段东西里**哪些能变成可用的源**、哪些不能、为什么」。
//
// 🔴 两类载体必须分开对待（这是本模块存在的唯一理由）：
//   ① **源清单**：顶层是数组 / 单条对象 / `{sources:[源对象]}` —— 解析完**直接就是源**（交给 `parseSourceFile`）；
//   ② **仓库清单**：legado 社区仓的 `repository.json` 形态（`{name, sources:[{fileName, downloadUrl, …}]}`）
//      或更早的 `{sourceUrls:[…]}` —— 里面是**待下载的地址**，⛔ **不是源本体**。
//      ⚠️ 如果不先识别它就丢给 `parseSourceFile`：`{sources:[…]}` 会被当成「一批源」逐条体检 ⇒
//      用户看到「11 条全部被拒」而真正的原因是「它们只是文件地址」——**把能用的东西说成坏的**。
//
// 🔴 红线自查（D-24(a)：⛔ 不执行第三方脚本）：
//    legado 生态的源绝大多数是 **`.js` 可执行脚本**（社区仓的 `downloadUrl` 直接指向 `.js`）。
//    我们**不能**收那类 ⇒ 一律**跳过并给出原因**，⛔ 绝不静默丢（用户得知道「为什么订了 30 条却一条没用上」）。
//    ⚠️ 同一生态的「规则型」源也多用 **XPath**（`/…/`，本仓 `ruleExpr` 判为 `unsupported='xpath'`）—— 那类会在
//    下一步 `parseSourceFile` 的体检里被拒，原因由 `diagnoseSource` 给出（本模块不重复判）。
//
// 本模块只回答「这段文本是什么、里面哪些能用」，⛔ 不碰网络、不碰 DOM、不落库。

import { parseSourceFile, parseSourceJson, type NovelSource } from 'pure/sourceRule';

/** 清单形态：`sources` = 直接是源；`manifest` = 是一堆**待下载地址**（要走第二步去拉） */
export type SourcePackForm = 'sources' | 'manifest';
export const SOURCE_PACK_FORMS: readonly SourcePackForm[] = ['sources', 'manifest'];

/** 被跳过的一条（⛔ 不静默丢：名字 + 一句人话原因） */
export interface SourcePackSkipped {
    name: string;
    reason: string;
}

/** 仓库清单里的一条**待下载项** */
export interface SourcePackEntry {
    name: string;
    /** 要拉的地址（已去首尾空白） */
    downloadUrl: string;
    /** 该源的主站点（有就带上，用于展示与归类；不是下载地址） */
    site: string;
}

export interface SourcePack {
    form: SourcePackForm;
    /** 仓库名（`manifest` 才有；`sources` 恒为空串）—— 展示用，⛔ 不作任何判据 */
    packName: string;
    /** `form === 'sources'`：直接可用的源 */
    sources: NovelSource[];
    /** `form === 'manifest'`：待拉取的地址 */
    entries: SourcePackEntry[];
    /** 被拒 / 被跳过的条目（含原因） */
    skipped: SourcePackSkipped[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 读第一个非空字符串字段（同一语义在社区里有多种键名 —— 宽松解析全靠这个助手） */
function firstStr(o: Record<string, unknown>, keys: readonly string[]): string {
    for (const k of keys) {
        const v = str(o[k]);
        if (v) return v;
    }
    return '';
}

/** 看起来像「可下载的源文件地址」吗（用来把 `url` 与 `downloadUrl` 区分开） */
function looksLikeFileUrl(u: string): boolean {
    return /\.(json|js)(?:[?#]|$)/i.test(u);
}

/**
 * 逐条判断「这条能不能拉」；能用返回 `null`，否则返回给用户看的一句话。
 *
 * 🔴 两条红线相关：
 *   · **`.js` 一律不收**（第三方可执行脚本）——本仓从头到尾没有 JS 引擎，`@js:` 也只是被判为 `unsupported`；
 *   · 非 `http(s)` 一律不收（`file://` / 相对路径都拉不到）。
 */
export function sourcePackEntryIssue(item: unknown): string | null {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '这一条不是一个对象';
    const o = item as Record<string, unknown>;
    const url = firstStr(o, ['downloadUrl', 'download_url', 'fileUrl', 'file_url', 'url']);
    if (!url) return '这一条没有下载地址';
    if (!/^https?:\/\//i.test(url)) return '下载地址不是 http(s) 开头';
    if (/\.js(?:[?#]|$)/i.test(url)) return '脚本型书源（.js）：本插件不执行第三方脚本，已跳过';
    return null;
}

/** 从一条清单项里抽出展示名（拿不到就退回落文件名，再退回落空串） */
function entryName(o: Record<string, unknown>, url: string): string {
    const direct = firstStr(o, ['name', 'bookSourceName', 'fileName', 'file_name']);
    if (direct) return direct;
    const tail = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
    return tail.replace(/\.(json|js)$/i, '');
}

/**
 * 解析「一段 JSON 文本」（来自**粘贴**或**订阅地址拉回来的**内容）。
 *
 * ⚠️ JSON 本身坏了 ⇒ **抛**（由调用方折成一句给用户的话，与 `parseSourceJson` 同一口径）。
 * ⚠️ ⛔ 绝不静默丢条目：形态不对 / 被红线挡下 / 体检不过的，全部进 `skipped` 并带原因。
 */
export function parseSourcePack(text: string): SourcePack {
    let raw: unknown;
    try {
        raw = JSON.parse(String(text ?? ''));
    } catch (e) {
        throw new Error(`不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`);
    }
    return parseSourcePackValue(raw);
}

/** 同上，但入参已经是解析好的值（订阅流程里先 JSON 再分流时用得上） */
export function parseSourcePackValue(raw: unknown): SourcePack {
    const empty: SourcePack = { form: 'sources', packName: '', sources: [], entries: [], skipped: [] };
    if (!raw || typeof raw !== 'object') return empty;

    // ── 形态 A：`{ sourceUrls: ["https://…/a.json", …] }`（更早的社区写法：只有地址） ──
    if (Array.isArray((raw as { sourceUrls?: unknown }).sourceUrls)) {
        const list = (raw as { sourceUrls: unknown[] }).sourceUrls;
        const entries: SourcePackEntry[] = [];
        const skipped: SourcePackSkipped[] = [];
        list.forEach((u) => {
            const url = str(u);
            if (!url) return;
            const issue = sourcePackEntryIssue({ url });
            const name = entryName({}, url);
            if (issue) skipped.push({ name, reason: issue });
            else entries.push({ name, downloadUrl: url, site: '' });
        });
        return { form: 'manifest', packName: firstStr(raw as Record<string, unknown>, ['name', 'title']), sources: [], entries, skipped };
    }

    // ── 形态 B：`{ name, sources: [ { fileName, downloadUrl, … } ] }`（legado 社区仓 repository.json） ──
    const inner = (raw as { sources?: unknown }).sources;
    if (Array.isArray(inner) && inner.some((it) => it && typeof it === 'object' && !Array.isArray(it) && looksLikeFileUrl(firstStr(it as Record<string, unknown>, ['downloadUrl', 'download_url', 'fileUrl', 'file_url', 'url'])))) {
        const entries: SourcePackEntry[] = [];
        const skipped: SourcePackSkipped[] = [];
        inner.forEach((it) => {
            const o = it as Record<string, unknown>;
            const url = firstStr(o, ['downloadUrl', 'download_url', 'fileUrl', 'file_url', 'url']);
            const name = entryName(o, url);
            const issue = sourcePackEntryIssue(it);
            if (issue) skipped.push({ name: name || url, reason: issue });
            else entries.push({ name, downloadUrl: url, site: firstStr(o, ['site', 'bookSourceUrl', 'homepage']) });
        });
        return { form: 'manifest', packName: firstStr(raw as Record<string, unknown>, ['name', 'title']), sources: [], entries, skipped };
    }

    // ── 形态 C：源清单本体（数组 / 单条对象 / `{sources:[源对象]}`）—— 交给既有解析器，⛔ 不另写一套 ──
    // ⚠️ 用**值版** `parseSourceFile(raw)`（它本身就是收 `unknown`）——
    //    ⛔ 别绕 `parseSourceJson`：那个会对入参做 `String(...)`，传对象会变成 `"[object Object]"` 然后抛 JSON 错。
    const parsed = parseSourceFile(raw);
    return {
        form: 'sources',
        packName: '',
        sources: parsed.sources,
        entries: [],
        skipped: parsed.rejected.map((r) => ({ name: r.name || `第 ${r.index} 条`, reason: r.reason })),
    };
}

/**
 * 一句话摘要（UI 直接用；⛔ 别在视图层另拼一套计数口径 —— 那种地方一改就漏一处）。
 * 形状：`可直接用 8 条 · 需下载 12 条 · 跳过 3 条`
 */
export function sourcePackSummary(pack: SourcePack): string {
    const parts: string[] = [];
    if (pack.form === 'sources') parts.push(`可直接用 ${pack.sources.length} 条`);
    else parts.push(`待下载 ${pack.entries.length} 条`);
    if (pack.skipped.length) parts.push(`跳过 ${pack.skipped.length} 条`);
    return parts.join(' · ');
}
