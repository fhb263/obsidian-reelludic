/**
 * 二进制下载落盘的服务层（2026-09-27 #397，⑤ 公共基建）—— ⑤-a / ⑤-b / ⑤-c 共用。
 *
 * ## 分工（别把两边混起来）
 * - 路径决策（文件名净化 / 重名去重 / 白名单 / 大小上限）⇒ `pure/downloadPlan`（**纯函数，可单测**）。
 * - 发请求 + 落盘 ⇒ 本模块，且 **HTTP 与写入都走注入**（对齐 `services/lyricSearch` 的 `HttpGet` 口径）
 *   ⇒ 单测喂假 http / 假 store，既不需要 Obsidian 运行时，也不会真写磁盘。
 *
 * ## 真源
 * `main.ts` 接线时传 `services/nodeHttp.nodeHttpGetBuffer`（已含超时 30s / GET 重试 2 / 重定向跟随 10 跳 /
 * 手动 Set-Cookie 续传）+ 一个把 `vault.createBinary` 包起来的 store。
 * ⛔ **不要退回 `requestUrl`**：与音视频关联同一口径（Electron 网络栈对部分站点会被识别为爬虫）。
 *
 * ## 为什么自带 store 而不直接用 `vaultIO`
 * `vaultIO` 的三个方法全服务**文本**（`writeText` / `readText` / `deleteFile`），
 * 二进制要的是 `vault.createBinary`（且 `vault.create` 系列**都不自动建父目录**）
 * ⇒ 这里定一个最小接口，由 `main.ts` 提供实现（含父目录补齐）。
 */
import {
    downloadExt,
    downloadExtAllowed,
    downloadRelPath,
    downloadSizeIssue,
    type DownloadKind,
} from 'pure/downloadPlan';

/** 注入式二进制 GET（真源 = `services/nodeHttp.nodeHttpGetBuffer`） */
export interface DownloadBinaryResponse {
    status: number;
    buffer: Uint8Array;
}

export type DownloadHttpGet = (
    url: string,
    headers?: Record<string, string>,
) => Promise<DownloadBinaryResponse>;

/** 注入式写入（真源 = 补父目录 + `vault.createBinary`） */
export interface DownloadStore {
    write(relPath: string, data: Uint8Array): Promise<void>;
}

export interface DownloadRequest {
    url: string;
    headers?: Record<string, string>;
    /** 下载物类型（决定扩展名白名单与**缺省目录**；#459 起⛔ 不再由它拼子目录） */
    kind: DownloadKind;
    /**
     * 期望文件名（含扩展名）。
     * 🔴 也接受**回调**：音频的真实容器要**嗅探字节**才知道（网易云外链 URL 恒写 `.mp3`，
     *    内容却可能是别的），此时用 `(bytes) => songDownloadFilename(a, t, sniffAudioExt(bytes) ?? 'mp3')`。
     */
    filename: string | ((bytes: Uint8Array) => string);
    /** 库内**目录本身**（相对路径；缺省由 `pure/downloadPlan.downloadDir` 按 kind 兜 —— 音频 = `下载/音乐`）。
     *  🔴 #459：这是「文件所在目录」，⛔ 不是「根」—— `downloadRelPath` 不会再往上拼子目录。 */
    root?: string;
    /** 当前已存在的库内相对路径（重名去重依据；调用方从 vault 索引取） */
    taken?: ReadonlySet<string>;
    /** 内容校验：返回原因字符串即视为失败（音频侧传 `pure/songDownload.audioBytesIssue`） */
    validate?: (bytes: Uint8Array) => string | null;
}

export interface DownloadOutcome {
    ok: boolean;
    /** 成功时的库内相对路径（可直接写进条目的 `audioPath` / `bookFile`） */
    relPath?: string;
    bytes?: number;
    /** 面向用户的失败原因 */
    error?: string;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * 下载并落盘。**所有失败路径都返回可读的 `error`**（⛔ 不抛），调用方直接把它塞进 Notice。
 *
 * 判据顺序按「便宜的先行」：扩展名（只看字符串）→ 请求 → 大小 → 内容校验 → 写盘。
 * 🔴 扩展名能在请求**之前**判的就不该等到下载完 —— 用户点了个 `.exe` 链接时，
 *    不该先替他下 80 MB 再说「不支持该格式」。
 */
export async function downloadToVault(
    http: DownloadHttpGet,
    store: DownloadStore,
    req: DownloadRequest,
): Promise<DownloadOutcome> {
    if (typeof req.filename === 'string') {
        const ext = downloadExt(req.filename);
        if (!downloadExtAllowed(req.kind, ext)) {
            return { ok: false, error: `不支持的格式：${ext || '（无扩展名）'}` };
        }
    }

    let bytes: Uint8Array;
    try {
        const res = await http(req.url, req.headers);
        if (!res || res.status < 200 || res.status >= 300) {
            return { ok: false, error: `下载失败：HTTP ${res?.status ?? '?'}` };
        }
        bytes = res.buffer;
    } catch (e) {
        return { ok: false, error: `下载失败：${errText(e)}` };
    }

    const sizeIssue = downloadSizeIssue(bytes?.byteLength ?? 0);
    if (sizeIssue) return { ok: false, error: sizeIssue };

    const contentIssue = req.validate?.(bytes);
    if (contentIssue) return { ok: false, error: contentIssue };

    const filename = typeof req.filename === 'function' ? req.filename(bytes) : req.filename;
    // 回调形态的文件名到这里才成型 ⇒ 白名单必须**再判一次**（字符串形态已在请求前判过）
    const ext = downloadExt(filename);
    if (!downloadExtAllowed(req.kind, ext)) {
        return { ok: false, error: `不支持的格式：${ext || '（无扩展名）'}` };
    }

    const relPath = downloadRelPath({ kind: req.kind, filename, root: req.root, taken: req.taken });
    try {
        await store.write(relPath, bytes);
    } catch (e) {
        return { ok: false, error: `写入失败：${errText(e)}` };
    }
    return { ok: true, relPath, bytes: bytes.byteLength };
}
