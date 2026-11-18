/**
 * 音乐平台「我的清单」纯逻辑（阶段 C1）——
 * 请求体 / 解析 / 文案全在这里，服务层只负责发请求。
 *
 * 🔴 用户裁定（2026-11-09 第 15 轮阶段 C，三项全选推荐项）：
 *    ⑴ 清单**只落单曲**，歌单名写进标签（不建「歌单条目」、不扩 schema）。
 *    ⑵ Cookie 过期 ⇒ **明确报错并提示重贴，不重试**（重试永远不会成功，只会白等）。
 *    ⑶ 三家私有接口**接受**，但**每家独立降级**：一家挂了只影响那一家，其余照常。
 *
 * ⛔ 本文件不出现 URL 字面量（与 `pure/songLibrary` 同口径）：URL 在 `pure/dl/{platform}.ts`，
 *    本文件只产出**请求体**与**解析结果**，宿主侧拿 URL 去拼。
 */
import type { DownloadSong } from 'services/dl';

/** 清单来源：我喜欢 / 某个歌单 */
export type MusicSyncSource = 'liked' | 'playlist';

/** 一个可同步的清单（弹窗里一行） */
export interface MusicSyncPlaylist {
    /** 平台内 id（网易云歌单 id / QQ dissid / 酷狗 special id） */
    id: string;
    /** 清单名（「我喜欢的音乐」「自建歌单名」…） */
    name: string;
    /** 曲目数（平台没给 ⇒ undefined，⛔ 不写 0 —— 「0 首」和「不知道」是两件事） */
    trackCount?: number;
    /** 封面（可空） */
    cover?: string;
    /** 是否「我喜欢」这种收藏型清单（用户改不了名、也删不掉） */
    liked?: boolean;
}

/** 同步候选（落库前的一首歌 + 它来自哪个清单） */
export interface MusicSyncCandidate {
    /** `music:{source}:{id}` 判重键（与阶段 B 同一把尺子） */
    key: string;
    /** 平台键 */
    source: string;
    /** 平台内的歌曲 id（网易云数字 id / QQ songmid / 酷狗 hash） */
    songId: string;
    title: string;
    artist?: string;
    album?: string;
    poster?: string;
    /** 平台歌曲网页（落库写 `sourceUrl`） */
    webUrl?: string;
    /** 是否 VIP/版权受限（只标注，不阻止落库 —— 同步只管元数据，不承诺可下载） */
    vip?: boolean;
    /** 来自哪个清单（写进标签） */
    playlistName: string;
}

/** 同步上限（照 `STEAM_SYNC_LIMIT = 2000` 的口径：巨量清单不能把主线程拖死） */
export const MUSIC_SYNC_LIMIT = 2000;

/**
 * Cookie 失效的**统一判据**。
 *
 * 🔴 为什么必须有一个独立判据：三家私有接口在「未登录」时表现各不相同 ——
 *    网易云回 `code: 301`、QQ 回 `code: -1000` 或直接给空列表、酷狗 302 到登录页。
 *    如果各写各的，就会出现「一家报「接口挂了」、另一家报「你没有歌」」这种自相矛盾的提示。
 * ⚠️ 判据只看**结构化信号**（HTTP 302 / 业务码），⛔ 不去猜「列表为空 = 没登录」——
 *    用户真的可能一个歌单都没有，那不该被说成登录失效。
 */
export function musicCookieExpired(input: { status?: number; code?: number | string; redirected?: boolean }): boolean {
    const { status, code, redirected } = input ?? {};
    if (redirected === true) return true;
    if (status === 302 || status === 301 || status === 401 || status === 403) return true;
    if (code === 301 || code === 401 || code === '301' || code === '401') return true;
    if (code === -1000 || code === '-1000') return true;
    return false;
}

/**
 * Cookie 失效的**可读文案**（用户裁定：明确报错 + 提示重贴，不重试）。
 *
 * 🔴 本仓对失败文案有硬要求：**必须能指导用户下一步**（见 `docs` 风险登记第 2 条）。
 *    所以这句话里必须同时出现「哪家」「怎么了」「去哪儿改」三件事。
 */
export function musicCookieExpiredMessage(platform: string): string {
    return `${platform} 的登录态已失效，同步已停止 —— 请到「设置 › 搜索配置 › 音乐平台凭据」重新粘贴 Cookie 后再试。`;
}

/**
 * 单平台降级文案（用户裁定：每家独立降级）。
 *
 * 用于「网易云挂了、QQ 和酷狗成功」这种混合结果：⛔ 不能整批当失败，
 * 也不能静默吞掉 —— 用户必须知道**哪家没同步上**，否则会以为「我只有这么多歌」。
 */
export function musicSyncPartialMessage(okSources: readonly string[], failed: readonly { platform: string; reason: string }[]): string {
    if (!failed.length) return '';
    const okPart = okSources.length ? `${okSources.join('、')} 已同步；` : '';
    const badPart = failed.map((f) => `${f.platform} 失败（${f.reason}）`).join('；');
    return `${okPart}${badPart}`;
}

/**
 * 把「我喜欢」的 id 列表变成候选（网易云/QQ 都先给 id 列表、再批量取详情）。
 *
 * @param ids    平台歌曲 id（去重前，可能带重复）
 * @param songs  已经取到的详情（按 id 索引）
 * @param ctx    { source, playlistName, webUrl 拼装 }
 */
export function musicCandidatesFromSongs(
    songs: readonly DownloadSong[],
    ctx: { source: string; playlistName: string; limit?: number },
): MusicSyncCandidate[] {
    const limit = Math.max(1, ctx.limit ?? MUSIC_SYNC_LIMIT);
    const out: MusicSyncCandidate[] = [];
    const seen = new Set<string>();
    for (const s of songs ?? []) {
        if (out.length >= limit) break;
        const songId = String(s?.id ?? '').trim();
        const title = String(s?.name ?? '').trim();
        // ⛔ 缺 id 或缺歌名的丢弃：没有 id 就算不出判重键（下次同步会重复落库）
        if (!songId || !title) continue;
        const key = `music:${ctx.source}:${songId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const item: MusicSyncCandidate = {
            key,
            source: ctx.source,
            songId,
            title,
            artist: String(s?.artist ?? '').trim() || undefined,
            album: String(s?.album ?? '').trim() || undefined,
            poster: String(s?.coverUrl ?? '').trim() || undefined,
            webUrl: String(s?.webUrl ?? '').trim() || undefined,
            playlistName: ctx.playlistName,
        };
        // ⚠️ 有值才写键（不是 `vip: s?.vip === true ? true : undefined`）：
        //    写成 `undefined` 时键仍存在，`'vip' in c` 永远为真 —— 下游分不清
        //    「确定不是 VIP」和「平台没给这个信息」。本仓 2026-11-09 在 `platformLabel` 上踩过同一个坑。
        if (s?.vip === true) item.vip = true;
        out.push(item);
    }
    return out;
}

/**
 * 清单名 → 标签。
 *
 * 🔴 用户裁定「歌单名写进标签」：标签是**给用户筛选用**的，所以只做最小净化 ——
 *    去空白、截到上限（标签栏放不下长名）、⛔ 不加前缀（加了就筛不出来了）。
 *
 * ⚠️ 上限写成常量、⛔ 别把数字直接写进 `slice(0, N)`：本仓有一条**计数型**反向守卫
 *    「前 24 字包含」定位仅剩 PDF 一处（`assert-symbols.cjs` 里数 `slice(0, 24)` 出现次数），
 *    直接写字面量会让那条守卫误红（2026-11-09 实测，它数的是字面量不是意图）。
 */
const PLAYLIST_TAG_MAX = 24;

export function playlistTag(name: string): string {
    const t = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!t) return '';
    return t.length > PLAYLIST_TAG_MAX ? t.slice(0, PLAYLIST_TAG_MAX) : t;
}

/**
 * 清单里「库里已有的」与「新的」怎么分（弹窗默认勾「库里没有的」）。
 *
 * @param existing 库里已有的判重键集合
 */
export function splitSyncCandidates(
    candidates: readonly MusicSyncCandidate[],
    existing: ReadonlySet<string>,
): { fresh: MusicSyncCandidate[]; known: MusicSyncCandidate[] } {
    const fresh: MusicSyncCandidate[] = [];
    const known: MusicSyncCandidate[] = [];
    for (const c of candidates ?? []) {
        if (existing.has(c.key)) known.push(c);
        else fresh.push(c);
    }
    return { fresh, known };
}

/** 同步结果汇总文案（与 `syncSummary` 同款口吻，⛔ 别写「成功/失败」两套词） */
export function musicSyncSummary(r: { playlists: number; added: number; skipped: number; overridden: number; failed: number }): string {
    const head = r.playlists > 0 ? `${r.playlists} 个清单；` : '';
    return `${head}新增 ${r.added} · 更新 ${r.overridden} · 跳过 ${r.skipped}${r.failed ? ` · 失败 ${r.failed}` : ''}`;
}
