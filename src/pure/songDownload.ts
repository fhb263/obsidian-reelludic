/**
 * 网易云「**免费通道**」下载的**纯逻辑**（2026-09-27 #397，⑤-c）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * ## 为什么只有网易云、且只有免费通道（用户裁定 D-12(a) / D-13(a)）
 * 金标准 LyricFlux 的 `downloadManager.ts` 有两条链路：
 *  - **VIP 链路**（`weapi` / `eapi` 加密请求拿 320k/无损直链）—— 依赖 `neteaseCrypto.ts`，而那个文件
 *    自称移植自 **AGPL** 的 `go-music-dl` ⇒ 合进本仓（GPL-3.0）有许可风险；且绕过平台付费能力。
 *  - **免费外链**（`song/media/outer/url`）—— **免登录 / 免加密 / 免 Cookie**，直接 302 到官方 CDN。
 * ⇒ 本轮只做后者，`neteaseCrypto` 一行都不碰。
 *
 * ## 实测（2026-09-27，本机 curl）
 * | 曲目 | `fee` | 外链结果 |
 * |---|---|---|
 * | 免费曲 | `0` | `302 → m701.music.126.net/…mp3`，`200` / `audio/mpeg` / 4.6 MB ✅ |
 * | 付费曲 | `1` / `8` | `302 → music.163.com/404`，`Content-Length: 0` ❌ |
 * ⇒ **可下载性完全由 `fee` 决定**，必须在搜索阶段就判出来（否则用户点下载才发现不行）。
 * ⚠️ 代价说清楚：免费通道**覆盖面窄**（大量华语流行是 `fee≠0`）—— 弹窗必须如实标注「需 VIP/付费」，
 *    ⛔ 不能静默过滤掉，否则用户会以为「搜不到这首歌」。
 */

import { sanitizeDownloadName } from 'pure/downloadPlan';

/**
 * 音频字节下限（照搬金标准 `MIN_AUDIO_BYTES`）。
 * 🔴 为什么非得有这道门：CDN 在受限/失效时返回的是**几百字节的 HTML 错误页**，而它的
 *    `content-type` 常常是 `application/octet-stream`（**不可信**）⇒ 光看头判不出来。
 */
export const MIN_AUDIO_BYTES = 64 * 1024;

/** 网易云外链直链（**免密通道**）：服务端 302 到 CDN，浏览器/Node 跟随即可拿到音频 */
export function neteaseOuterUrl(id: string | number): string {
    const sid = String(id ?? '').trim();
    return `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(sid)}.mp3`;
}

/** 歌曲网页地址（弹窗里「打开歌曲页」用；`#` 是网易云的 SPA 路由，可在系统浏览器打开） */
export function neteaseSongPageUrl(id: string | number): string {
    const sid = String(id ?? '').trim();
    return sid ? `https://music.163.com/#/song?id=${encodeURIComponent(sid)}` : '';
}

/**
 * 是否可经免费通道下载（照搬金标准 `isNeteaseDownloadable` 口径）：
 * 🔴 **`fee` 非 0 一律不可下** —— 实测 `fee=1`（VIP）与 `fee=8`（低清免费/高清会员）**都** 302 到 `/404`。
 * ⚠️ `fee` 缺失（老接口 / 别家源）时**按可下载处理**：宁可让用户点一次才发现不行，
 *    也不要因为字段缺失就把整个列表清空。
 */
export function isNeteaseDownloadable(fee?: number | null): boolean {
    return !(typeof fee === 'number' && Number.isFinite(fee) && fee > 0);
}

/**
 * 音频字节格式嗅探（魔数）⇒ 扩展名；认不出来返回 `null`。
 *
 * 顺序有讲究：`fLaC` / `ftyp` / `OggS` / `RIFF…WAVE` 这些**特征串**先判，
 * 最后才是 MP3（因为它最宽松 —— 见下）。
 * 🔴 MP3 的「帧同步」判据 `0xFF 0xEx` 会**连带命中 ADTS AAC**（`0xFF 0xF1`）—— 这是**刻意**接受的：
 *    网易云外链只给 MP3，为区分 AAC 而去解 MPEG layer 位不值当；宁可真阳性也不要漏判。
 */
export function sniffAudioExt(bytes: Uint8Array): string | null {
    const b = bytes;
    if (!b || b.length < 4) return null;
    // FLAC: 'fLaC'
    if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return 'flac';
    // M4A/MP4: offset 4 = 'ftyp'
    if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a';
    // OGG: 'OggS'
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg';
    // WAV: 'RIFF' …… 'WAVE'
    if (
        b.length >= 12 &&
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
    ) {
        return 'wav';
    }
    // MP3: ID3v2 标签头 'ID3'
    if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3';
    // MP3: 无标签的裸帧同步（11111111 111xxxxx）
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';
    return null;
}

/**
 * 音频字节可用性检查：返回**面向用户的原因**（可用返回 `null`）。
 * 把两个真实失败模式包成人话：内容过小（受限/接口变更）、魔数不识别（拿到的是错误页）。
 */
export function audioBytesIssue(bytes: Uint8Array): string | null {
    const size = bytes?.byteLength ?? 0;
    if (size < MIN_AUDIO_BYTES) return '返回内容过小，疑似版权受限或接口变更';
    if (!sniffAudioExt(bytes)) return '返回内容不是音频（疑似错误页）';
    return null;
}

/**
 * 下载文件名：`歌手1、歌手2 - 歌名.mp3`（多歌手用顿号 —— `/` 是非法字符、`_` 会与歌名里的下划线混淆）。
 * 缺歌手或歌名时只留有的那个；两者都缺 ⇒ 回退「未命名」（由 `sanitizeDownloadName` 兜）。
 * 🔴 整体走 `sanitizeDownloadName`：歌名里带 `* ? |` 是常态（「什么？」「A/B」）。
 */
export function songDownloadFilename(artists: string | readonly string[] | undefined, title: string, ext: string): string {
    const list = (Array.isArray(artists) ? artists : [artists])
        .map((a) => String(a ?? '').trim())
        .filter(Boolean);
    const t = String(title ?? '').trim();
    const joined = list.join('、');
    const head = joined && t ? `${joined} - ${t}` : t || joined;
    const e =
        String(ext ?? '')
            .replace(/^\./, '')
            .toLowerCase() || 'mp3';
    return `${sanitizeDownloadName(head)}.${e}`;
}
