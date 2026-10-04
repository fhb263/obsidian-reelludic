/**
 * 「封面来源」纯逻辑（#509）—— 除必应网络搜索外，再加**四大音乐平台**（网易云 / QQ / 酷狗 / 酷我）。
 * 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * 用户原话：「还有继续增强获取音乐类型条目封面的能力，**网络搜索 / 四大音乐平台搜索封面**」。
 *
 * ## 🔴 实测口径（2026-10-04，**真请求跑出来的**，⛔ 不是照文档猜的）
 *
 * | 平台 | 搜索结果自带封面？ | 拿**大图**的做法 | 实测到的最大尺寸 |
 * |---|---|---|---|
 * | 必应（既有 #498） | — | `murl` 就是原图 | — |
 * | 网易云 | ❌ **一条都没有**（实测 10 条 / 0 带封面） | 补一次 `weapi/v3/song/detail`（**免 Cookie**，实测 200）取 `al.picUrl`；也可 `?param=WxW` 指定尺寸 | 原始就是 **1500×1500** |
 * | QQ | ✅ `T002R300x300M000{albummid}.jpg` | 把尺寸段改成 **1500**（`1000` 反而 404） | **1477×1477**（541 KB） |
 * | 酷狗 | ✅ `/stdmusic/240/…jpg` | **删掉 `/stdmusic/<size>/` 里的尺寸段** | **1477×1477**（726 KB） |
 * | 酷我 | ⚠️ `coverUrl` 是 **MV 横图**（`wmvpic`，实测 324×182，最大 640×360 —— **不能当封面**） | 用**另一个字段** `web_albumpic_short`（专辑图，120）⇒ `img1.kuwo.cn/star/albumcover/1000/<去掉前导尺寸段的路径>` | **1000×1000**（350 KB） |
 *
 * ⚠️ **酷我这条是本模块存在的理由之一**：搜索响应里 `coverUrl`（`hts_MVPIC`）是**横的 MV 图**，
 *    直接拿来当封面会得到一张压扁的横图。专辑图在 `web_albumpic_short` 里，要自己拼 CDN 路径。
 * ⚠️ **防盗链实测**：四平台的封面地址**不带 Referer 也能下**（酷我那张 200）—— 但仍按平台带一个
 *    Referer（`PLATFORM_COVER_REFERER`），图站策略随时会变，带上没坏处。
 */
import type { EntryType } from 'data/types';
import type { PosterCandidate } from 'pure/posterSearch';

/** 封面来源（`bing` = 既有的网络图片搜索；其余四个 = 音乐平台） */
export type PosterSource = 'bing' | 'netease' | 'qq' | 'kugou' | 'kuwo';

/** 顺序 = 弹窗里胶囊的顺序（网络搜索排第一：它是所有类型都有的那条） */
export const POSTER_SOURCES: readonly PosterSource[] = ['bing', 'netease', 'qq', 'kugou', 'kuwo'];

/** 胶囊文案（也用作候选卡上的「来源」） */
export const POSTER_SOURCE_LABELS: Record<PosterSource, string> = {
    bing: '网络搜索',
    netease: '网易云',
    qq: 'QQ音乐',
    kugou: '酷狗',
    kuwo: '酷我',
};

/** 平台封面地址的 Referer（实测不带也能下，但图站策略随时会变 ⇒ 带上没坏处） */
export const PLATFORM_COVER_REFERER: Record<PosterSource, string> = {
    bing: '',
    netease: 'https://music.163.com/',
    qq: 'https://y.qq.com/',
    kugou: 'https://www.kugou.com/',
    kuwo: 'https://www.kuwo.cn/',
};

/**
 * 该类型能用哪些来源。
 * 🔴 **只有音乐**开平台那四档：影视 / 书籍 / 游戏在音乐平台上搜不到东西，
 *    列出来只会让用户点一下、等一次、得到空列表（用户体验上的负分）。
 */
export function posterSourcesFor(type: EntryType): PosterSource[] {
    return type === 'music' ? [...POSTER_SOURCES] : ['bing'];
}

/**
 * 平台的搜索词：**标题 + 歌手**（⛔ 不缀「专辑封面」那种词）。
 * - `buildPosterQuery`（必应那条）给音乐缀的是「 专辑封面」—— 图片搜索需要它；
 *   但**音乐平台的搜索框**要的是歌名/歌手，缀上「专辑封面」会搜不到东西（实测口径）。
 * - 歌手有就带上（帮它挑对同名歌），没有就只搜标题。
 */
export function buildPlatformCoverQuery(title: string, author?: string): string {
    const t = String(title ?? '').trim();
    const a = String(author ?? '').trim();
    if (!t) return '';
    return a ? `${t} ${a}` : t;
}

/** 平台搜索结果里本模块要用的那几项（`DownloadSong` 结构上兼容） */
export interface PlatformCoverSong {
    name?: string;
    artist?: string;
    album?: string;
    /** 平台给的**小**封面（列表缩略图用它；网易云可能为空） */
    coverUrl?: string;
    /** 酷我专用：专辑图路径片段（`120/s3s94/93/211513640.jpg` 这种），见 `platformCoverUrl` */
    albumPicPath?: string;
    /** 平台内歌曲页（作 Referer 更精准；没有就用平台域名根） */
    pageUrl?: string;
}

/**
 * 该平台这张封面**能拿到的最大图**（URL 改写规则，逐条实测过）。
 * 🔴 **换不来更大就原样返回**（⛔ 别返回空 —— 有图总比没图好）。
 * ⚠️ 规则**只认自己那条路径形态**：酷狗实测到的是 `/stdmusic/<size>/`，别写成「替换第一个数字段」——
 *    那条路径里还有 `20230920` 这种**日期段**，通用替换会把它一起改坏（改坏了 URL 直接 404）。
 */
export function upgradeCoverUrl(source: PosterSource, url: string): string {
    const u = String(url ?? '').trim();
    if (!u) return '';
    if (source === 'qq') {
        // 实测：300/500/800/1500 都有；**1000 反而 404** ⇒ 用 1500（拿回 1477×1477）
        return u.replace(/T002R\d+x\d+M000/, 'T002R1500x1500M000');
    }
    if (source === 'kugou') {
        // 实测：240/480/500/1000 都行；**删掉尺寸段能拿到 1477×1477** ⇒ 删（删不掉就原样）
        return u.replace(/\/stdmusic\/\d+\//, '/stdmusic/');
    }
    // 网易云：原始就是 1500×1500 ⇒ **一个字都不动**（加 `?param=` 只会把它变小）
    return u;
}

/**
 * 酷我：把搜索响应里的**专辑图路径片段**拼成可下载地址。
 * 实测：`img1.kuwo.cn/star/albumcover/<size>/<去掉前导尺寸段的路径>` ⇒ 120/300/500/**1000** 都有效，
 * 不带尺寸段反而 404 ⇒ 尺寸段**必须**留。
 */
export function kuwoAlbumCoverUrl(pathFragment: string, size = 1000): string {
    const p = String(pathFragment ?? '').trim();
    if (!p) return '';
    // 片段形如 `120/s3s94/93/211513640.jpg` ⇒ 去掉前导的尺寸段
    const tail = p.replace(/^\d+\//, '');
    return `https://img1.kuwo.cn/star/albumcover/${size}/${tail}`;
}

/**
 * 一条平台歌曲 → 它的封面（**大图**）；拿不到返回 `''`。
 * ⚠️ 酷我**用专辑图字段**（`albumPicPath`），⛔ 不用 `coverUrl`（那是横的 MV 图）。
 */
export function platformCoverUrl(source: PosterSource, song: PlatformCoverSong): string {
    if (source === 'kuwo') {
        return song.albumPicPath ? kuwoAlbumCoverUrl(song.albumPicPath) : '';
    }
    return upgradeCoverUrl(source, String(song.coverUrl ?? ''));
}

/** 列表里显示的缩略图：优先用平台给的**小图**（大图一两百 KB，35 张一起加载太慢） */
function platformThumbUrl(source: PosterSource, song: PlatformCoverSong, big: string): string {
    const small = String(song.coverUrl ?? '').trim();
    // ⚠️ 酷我的 `coverUrl` 是**横的 MV 图**、与专辑图不是同一张 ⇒ 缩略图也得用专辑图（小尺寸）
    if (source === 'kuwo') {
        return song.albumPicPath ? kuwoAlbumCoverUrl(song.albumPicPath, 300) : big;
    }
    return small || big;
}

/** 候选卡标题：`歌名 — 歌手 · 专辑`（帮用户在几张相似的封面里认出来） */
function platformCandidateTitle(song: PlatformCoverSong): string {
    const name = String(song.name ?? '').trim();
    const artist = String(song.artist ?? '').trim();
    const album = String(song.album ?? '').trim();
    const head = [name, artist].filter(Boolean).join(' — ');
    return [head, album].filter(Boolean).join(' · ') || '（未命名）';
}

/**
 * 平台搜索结果 → 封面候选（**只保留真拿到图的那几条**）。
 * - `murl` = **大图**（下载用）；`turl` = 平台小图（列表用）；
 * - `domain` = 平台名（候选卡上显示「来源：网易云」）；
 * - `page` = 歌曲页 / 平台域名根（下载时的 Referer）。
 * ⛔ 不按尺寸筛选（平台给的封面都是方的；酷我已在 `platformCoverUrl` 换成专辑图）。
 */
export function platformCandidates(
    source: PosterSource,
    songs: readonly PlatformCoverSong[],
    limit = 30,
): PosterCandidate[] {
    const out: PosterCandidate[] = [];
    const seen = new Set<string>();
    for (const s of songs ?? []) {
        if (out.length >= limit) break;
        const big = platformCoverUrl(source, s);
        if (!big || seen.has(big)) continue;
        seen.add(big);
        out.push({
            murl: big,
            turl: platformThumbUrl(source, s, big),
            title: platformCandidateTitle(s),
            page: String(s.pageUrl ?? '').trim() || PLATFORM_COVER_REFERER[source],
            domain: POSTER_SOURCE_LABELS[source],
        });
    }
    return out;
}
