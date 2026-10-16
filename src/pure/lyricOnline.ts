/**
 * 在线歌词检索的**纯逻辑**（2026-09-27 #396）—— 无 `obsidian` / 无网络 / 无 DOM，可单测。
 *
 * ## 分工
 * - 本模块只负责「**拼 URL**」与「**把响应文本变成候选/歌词**」以及「**挑哪一条**」。
 * - 🔴 **发请求不在这里**（那是 `services/lyricSearch` 的事）—— 纯函数才能喂 fixture 单测：
 *   中文音乐站的响应有一堆历史包袱（单引号 JSON、JSONP 包裹、base64、时间戳单位不同），
 *   这些坑**只有在单测里钉住才不会回归**。
 *
 * ## 金标准
 * 同作者 LyricFlux 的 `onlineLyrics.ts`（网易云）/ `kuwoMusic.ts` / `qqMusic.ts` —— **口径照搬、字段名照抄**，
 * 实现重写为纯函数（原实现把「拼 URL + 发请求 + 解析」揉在一个 async 函数里，无法单测）。
 * ⚠️ **`neteaseCrypto.ts` 用不到**：歌词接口是公开端点，不需要任何加密 / 签名 / API Key。
 *
 * ## 三个源的默认选择（用户 2026-09-27 裁定「源不用 API 配置默认就行」）
 * 网易云（纯 JSON，中文曲库最全）｜酷我（纯 JSON，最省事）｜QQ 音乐（JSONP，需去包裹）
 */

// 🔴 酷狗的 URL 与解析**不在这里重写**：下载面 #399-D 已经把 `pure/dl/kugou` 整套移植进来了，
//    歌词面只借用它的「歌词候选解析」并归一成 `LyricCandidate`（URL 常量同样只留一处）。
import { parseKugouLyricSearch } from 'pure/dl/kugou';

/**
 * 默认歌词源（免配置；顺序 = 弹窗里的默认展示顺序）。
 * 🔴 **2026-09-28 #400：补上第 4 个源「酷狗」** —— 用户「LRC歌词获取完整也给我搬过来，现在只有几个显示」。
 *    酷狗的 URL 构造与解析**不在这里重写**，直接复用下载面已移植的 `pure/dl/kugou`
 *    （截图里那套「模板只能有一处」的纪律对 URL 常量同样成立）。
 */
export type LyricSourceId = 'netease' | 'kuwo' | 'qq' | 'kugou';

/**
 * 歌词源的**显示名**（唯一定义处：候选浮层的来源胶囊与「某源 未找到 / 请求失败」那行小字都读它）。
 * 🔴 2026-09-28 #404：一律用**简称**（去掉「音乐」两字）—— 用户：「LRC歌词获取界面前缀网易云音乐等
 *    改成『网易云』」。⛔ 别再写全称：胶囊窄，全称会把歌名挤没；且与下载弹窗的平台名口径对齐。
 *    ⚠️ 设置页 Cookie 行的源名仍用全称（那是「到哪登录」的指引，不在本次口径内）。
 */
export const LYRIC_SOURCE_LABELS: Record<LyricSourceId, string> = {
    netease: '网易云',
    kuwo: '酷我',
    qq: 'QQ',
    kugou: '酷狗',
};

/** 一条候选（三家归一后的最小集） */
export interface LyricCandidate {
    /** 该源内部 id（网易云 = 数字 id；酷我 = rid；QQ = songmid） */
    id: string;
    name: string;
    artists: string[];
    durationSec?: number;
    /**
     * 网易云专用：`fee` 字段（⑤ 下载面 2026-09-27 增补 —— **歌词面不读它**，所以是可选且只填网易云）。
     * 🔴 语义见 `pure/songDownload.isNeteaseDownloadable`：**非 0 即不可经免费通道下载**。
     * ⛔ 别在搜索之外的地方（如歌词弹窗）用它做过滤。
     */
    fee?: number;
    /**
     * 🔴 音频档位（#405 增补：**只给下载面用**，歌词面不读）——网易云搜索响应里就带着三个档位对象
     * （`l` 128k / `m` 192k / `h` 320k，各含 `br` + `size`），原先整块丢了 ⇒ 下载界面的网易云行
     * 既不显示 kbps 也不显示体积（同页 QQ / 酷我 / 酷狗都有）。
     * 取值口径 = **`l`（免密外链实际拿到的档位）**，缺则 `m` → `h`（⛔ 不拿 `sq`/`hr` 无损档 ——
     * 那个免费通道拿不到，标上去就是给了用户一个他下不到的期望）。
     */
    bitrate?: number;
    size?: number;
}

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 各源需要的请求头（🔴 缺 `Referer` 会被对应站点拒绝或返回空） */
export const LYRIC_SOURCE_HEADERS: Record<LyricSourceId, Record<string, string>> = {
    netease: { 'User-Agent': UA, Referer: 'https://music.163.com' },
    kuwo: { 'User-Agent': UA, Referer: 'http://www.kuwo.cn' },
    qq: { 'User-Agent': UA, Referer: 'https://y.qq.com/' },
    // 酷狗歌词接口挂在 lyrics.kugou.com 上（正本用的是 www.kugou.com 作 Referer）
    kugou: { 'User-Agent': UA, Referer: 'https://www.kugou.com/' },
};

/**
 * 检索词 = 「标题 + 作者」。空标题 ⇒ `null`（调用方据此禁用按钮）。
 * 两侧都 trim；作者为空就只搜标题；**折叠连续空白**（标题里混进的多余空格会让搜索命中率明显下降）。
 */
export function buildLyricQuery(title: string, author?: string): string | null {
    const t = String(title ?? '').trim();
    if (!t) return null;
    const a = String(author ?? '').trim();
    return (a ? `${t} ${a}` : t).replace(/\s+/g, ' ');
}

/**
 * 🔴 酷狗歌词的检索词形态 = **`歌手-歌名`**（#405 实测修正）。
 *
 * 为什么单独一份（⛔ 不能并进 `buildLyricQuery`）：
 * `lyrics.kugou.com/search` 对**空格形态**（「歌名 歌手」，另外三源吃的就是那个）**恒返回 0 条**；
 * 换成**短横线**形态才有结果，且**候选字段的 song/singer 会随短横线两侧的词序对调**：
 *   · `keyword=七里香 周杰伦` ⇒ `candidates: 0`（用户报的「酷狗没有歌词」就是这个）
 *   · `keyword=周杰伦-七里香` ⇒ 20 条，首条 `song=七里香 / singer=周杰伦`（✅ 字段语义正确）
 *   · `keyword=七里香-周杰伦` ⇒ 也有候选，但 `song=周杰伦 / singer=七里香`（❌ 字段被搞反 ⇒ 匹配分算错）
 * ⇒ 顺序必须是 **歌手在前**。
 * 作者为空 ⇒ 只传歌名（实测「七里香」单独搜也有候选）。
 */
export function kugouLyricQuery(title: string, author?: string): string {
    const t = String(title ?? '').trim();
    const a = String(author ?? '').trim();
    return a ? `${a}-${t}` : t;
}

// ────────────────────────────── URL 构造 ──────────────────────────────

export function neteaseSearchUrl(query: string, limit = 50): string {
    return `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1&limit=${limit}`;
}

/** 网易云歌词：`lv=1` 原文 + `tv=-1` 不带翻译（翻译行会混进 LRC 正文，播放器不需要） */
export function neteaseLyricUrl(id: string): string {
    return `https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=1&kv=1&tv=-1`;
}

/**
 * 酷我搜索（legacy `searchMusicBykeyWord`，免登录）。
 * ⚠️ 这些参数是**照抄金标准**的：`rformat=json&encoding=utf8` 决定返回 JSON + UTF-8，
 * `vipver/client/ft/cluster/strategy/mobi/issubtitle/show_copyright_off` 少一个都可能返回别的格式。
 */
export function kuwoSearchUrl(query: string, limit = 50): string {
    const params: Record<string, string> = {
        vipver: '1',
        client: 'kt',
        ft: 'music',
        cluster: '0',
        strategy: '2012',
        encoding: 'utf8',
        rformat: 'json',
        mobi: '1',
        issubtitle: '1',
        show_copyright_off: '1',
        pn: '0',
        rn: String(limit),
        all: query,
    };
    const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
    return `http://www.kuwo.cn/search/searchMusicBykeyWord?${qs}`;
}

/** 酷我歌词：🔴 少了 `httpsStatus=1` 会 301（金标准注释里记着这条） */
export function kuwoLyricUrl(rid: string): string {
    return `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(rid)}&httpsStatus=1`;
}

export function qqSearchUrl(query: string, limit = 50): string {
    return `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&n=${limit}&p=1`;
}

/** QQ 歌词：`nobase64=1` ⇒ `lyric` 字段直接是明文 LRC（否则是 base64，多一层解码） */
export function qqLyricUrl(songmid: string): string {
    const params: Record<string, string> = {
        songmid,
        format: 'json',
        nobase64: '1',
        g_tk: '5381',
        loginUin: '0',
        hostUin: '0',
        inCharset: 'utf8',
        outCharset: 'utf-8',
    };
    const qs = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
    return `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${qs}`;
}

/**
 * 酷狗候选的 `id` 形态（2026-09-28 #400）：`{fileHash}\u0001{accesskey}` —— **两个参数都要**才能取歌词
 * （`lyrics.kugou.com/download?id=…&accesskey=…`）。
 *
 * 🔴 为什么塞进 `id` 而不是给 `LyricCandidate` 加字段：候选的 `id` 对上层（弹窗 / 表单 / 门面）
 *    本来就是**不透明的源内句柄** —— 上层只做「拿这条候选去换歌词」，从不解析它。
 *    塞进去 ⇒ 取歌词的调用链（`main.ts` 门面 → `EntryModal` → `EntryForm`）**一行都不用改**。
 * ⛔ 别把这个串当纯 hash 用（搜歌 / 下歌走的是下载面 `pure/dl/kugou`，与本模块无关）。
 */
export const KUGOU_LYRIC_ID_SEP = '\u0001';

/** 拼酷狗歌词候选 id（导出以便单测与调用方共用一处，⛔ 别在两处各写一遍分隔符） */
export function joinKugouLyricId(fileHash: string, accesskey: string): string {
    return `${fileHash}${KUGOU_LYRIC_ID_SEP}${accesskey}`;
}

/** 拆酷狗歌词候选 id；不是本模块拼出来的形态 ⇒ `accesskey` 为空串（取歌词时会失败并给出原因） */
export function splitKugouLyricId(raw: string): { id: string; accesskey: string } {
    const s = String(raw ?? '');
    const i = s.indexOf(KUGOU_LYRIC_ID_SEP);
    if (i < 0) return { id: s, accesskey: '' };
    return { id: s.slice(0, i), accesskey: s.slice(i + KUGOU_LYRIC_ID_SEP.length) };
}

/**
 * 酷狗歌词候选 → 本模块的归一候选。
 * 🔴 解析本身复用下载面已移植的 `pure/dl/kugou.parseKugouLyricSearch`（URL 与字段口径都只留一处）。
 */
export function parseKugouLyricCandidates(raw: string): LyricCandidate[] {
    return parseKugouLyricSearch(raw).map((c) => ({
        id: joinKugouLyricId(c.id, c.accesskey),
        name: c.song,
        artists: c.singer ? [c.singer] : [],
        durationSec: c.duration,
    }));
}

// ────────────────────────────── 响应解析 ──────────────────────────────
/** 去掉 JSONP 包裹（`callback({…});`）与前置块注释；不是 JSONP 就原样返回 */
export function unwrapJsonp(raw: string): string {
    const trimmed = String(raw ?? '')
        .trim()
        .replace(/^\/\*[\s\S]*?\*\//, '');
    const m = trimmed.match(/^[^(]*\(([\s\S]*)\)\s*;?\s*$/);
    return m ? m[1] : trimmed;
}

function safeJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

/**
 * 网易云搜索响应：`result.songs[]` ⇒ `{ id, name, ar[].name, dt(毫秒), fee }`
 * 🔴 #405 起**多取两个字段**：音频档位 `l` / `m` / `h`（各含 `{br, size}`）⇒ `bitrate` / `size`。
 *    实测（cloudsearch/pc）三档都在：`l{br:128000}` / `m{br:192000}` / `h{br:320000}`，
 *    另有 `sq{br:922746}`（无损，⛔ 不取 —— 免费通道拿不到）。
 */
export function parseNeteaseSearch(raw: string): LyricCandidate[] {
    const data = safeJson(raw) as { result?: { songs?: unknown } } | undefined;
    const songs = data?.result?.songs;
    if (!Array.isArray(songs)) return [];
    const out: LyricCandidate[] = [];
    for (const s of songs) {
        const row = s as { id?: unknown; name?: unknown; ar?: unknown; dt?: unknown; fee?: unknown };
        const id = Number(row.id) || 0;
        const name = typeof row.name === 'string' ? row.name : '';
        if (!id || !name) continue;
        const artists = Array.isArray(row.ar)
            ? (row.ar as { name?: unknown }[]).map((a) => (typeof a.name === 'string' ? a.name : '')).filter(Boolean)
            : [];
        const q = neteaseAudioQuality(s);
        out.push({
            id: String(id),
            name,
            artists,
            durationSec: typeof row.dt === 'number' && row.dt > 0 ? Math.round(row.dt / 1000) : undefined,
            // `fee` 原样透传（⛔ 不做「可下载」判断 —— 那是 `pure/songDownload` 的职责）
            fee: typeof row.fee === 'number' && Number.isFinite(row.fee) ? row.fee : undefined,
            bitrate: q.bitrate,
            size: q.size,
        });
    }
    return out;
}

/**
 * 取网易云搜索结果里的**免费档**音质（`l` → `m` → `h`）。
 * 三个档位对象形态都是 `{br, size}`（size 单位字节）；缺字段 / 脏值一律回 `undefined`（⛔ 不补假值）。
 * ⛔ 不取 `sq` / `hr`（无损 / Hi-Res）—— 免费通道下不到，标出来只会误导。
 */
function neteaseAudioQuality(song: unknown): { bitrate?: number; size?: number } {
    const row = song as { l?: unknown; m?: unknown; h?: unknown };
    for (const key of ['l', 'm', 'h'] as const) {
        const tier = row[key] as { br?: unknown; size?: unknown } | undefined;
        if (!tier || typeof tier !== 'object') continue;
        const br = typeof tier.br === 'number' && Number.isFinite(tier.br) && tier.br > 0 ? Math.round(tier.br / 1000) : undefined;
        const size = typeof tier.size === 'number' && Number.isFinite(tier.size) && tier.size > 0 ? tier.size : undefined;
        if (br || size) return { bitrate: br, size };
    }
    return {};
}

/** 网易云歌词响应：`lrc.lyric`（无歌词 / 只有元数据时为 null —— 交给上层报「未找到」） */
export function parseNeteaseLyric(raw: string): string | null {
    const data = safeJson(raw) as { lrc?: { lyric?: unknown } } | undefined;
    const text = data?.lrc?.lyric;
    if (typeof text !== 'string') return null;
    const t = text.trim();
    return t ? t : null;
}

/**
 * 酷我搜索响应：`abslist[]` ⇒ `{ MUSICRID: 'MUSIC_123' → rid, SONGNAME, ARTIST, DURATION(秒) }`。
 * 🔴 **两段式解析**：这接口历史上用**单引号**包裹键值（需 `'`→`"` 替换），现在返回标准双引号 JSON，
 *    而歌名里可能带撇号（`it's`）—— 所以**必须先用标准 JSON 试，失败才降级替换**；
 *    上来就全局替换会把合法 JSON 里的 `'` 改成 `"` ⇒ 整个响应解不出来（金标准实测口径）。
 */
export function parseKuwoSearch(raw: string): LyricCandidate[] {
    let data = safeJson(raw) as { abslist?: unknown } | undefined;
    if (data === undefined) data = safeJson(String(raw ?? '').replace(/'/g, '"')) as { abslist?: unknown } | undefined;
    const list = data?.abslist;
    if (!Array.isArray(list)) return [];
    const out: LyricCandidate[] = [];
    for (const it of list) {
        const row = it as { MUSICRID?: unknown; SONGNAME?: unknown; ARTIST?: unknown; DURATION?: unknown };
        const rid = String(row.MUSICRID ?? '').replace(/^MUSIC_/, '');
        const name = typeof row.SONGNAME === 'string' ? row.SONGNAME : '';
        if (!rid || !name) continue;
        const artist = typeof row.ARTIST === 'string' ? row.ARTIST : '';
        const dur = Number(row.DURATION);
        out.push({
            id: rid,
            name,
            artists: artist ? artist.split(/[&/、,]/).map((x) => x.trim()).filter(Boolean) : [],
            durationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined,
        });
    }
    return out;
}

/** 秒 → `[mm:ss.xx]`（酷我只给「秒」） */
function kuwoStamp(sec: number): string {
    const totalMs = Math.round(sec * 1000);
    const mm = Math.floor(totalMs / 60000);
    const ss = Math.floor((totalMs % 60000) / 1000);
    const xx = Math.floor((totalMs % 1000) / 10);
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `[${pad(mm)}:${pad(ss)}.${pad(xx)}]`;
}

/**
 * 酷我歌词响应：`data.lrclist[]` 每行 `{ time(秒), lineLyric }` ⇒ 拼成 LRC 文本。
 * ⚠️ 无时间戳 / 时间戳非法的行**原样保留**（多为标题、作词信息）—— 播放器侧 `parseLrcDocument`
 *    对无时间戳的行会跳过渲染，所以保留是安全的，且不丢信息。
 */
export function parseKuwoLyric(raw: string): string | null {
    const data = safeJson(raw) as { data?: { lrclist?: unknown } } | undefined;
    const list = data?.data?.lrclist;
    if (!Array.isArray(list) || list.length === 0) return null;
    const lines: string[] = [];
    for (const it of list) {
        const row = it as { time?: unknown; lineLyric?: unknown };
        const text = typeof row.lineLyric === 'string' ? row.lineLyric : '';
        if (!text) continue;
        const sec = Number(row.time);
        if (row.time === '' || row.time === null || row.time === undefined || !Number.isFinite(sec) || sec < 0) {
            lines.push(text);
            continue;
        }
        lines.push(`${kuwoStamp(sec)}${text}`);
    }
    const joined = lines.join('\n').trim();
    return joined ? joined : null;
}

/** QQ 搜索响应（可能 JSONP 包裹）：`data.song.list[]` ⇒ `{ songmid, songname, singer[].name, interval(秒) }` */
export function parseQqSearch(raw: string): LyricCandidate[] {
    const data = safeJson(unwrapJsonp(raw)) as { data?: { song?: { list?: unknown } } } | undefined;
    const list = data?.data?.song?.list;
    if (!Array.isArray(list)) return [];
    const out: LyricCandidate[] = [];
    for (const s of list) {
        const row = s as { songmid?: unknown; songname?: unknown; singer?: unknown; interval?: unknown };
        const mid = typeof row.songmid === 'string' ? row.songmid : '';
        const name = typeof row.songname === 'string' ? row.songname : '';
        if (!mid || !name) continue;
        const artists = Array.isArray(row.singer)
            ? (row.singer as { name?: unknown }[]).map((x) => (typeof x.name === 'string' ? x.name : '')).filter(Boolean)
            : [];
        const dur = Number(row.interval);
        out.push({
            id: mid,
            name,
            artists,
            durationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined,
        });
    }
    return out;
}

/** QQ 歌词响应（JSONP/块注释包裹）：`retcode === 0` 且 `lyric` 为明文文本（`nobase64=1`） */
export function parseQqLyric(raw: string): string | null {
    const data = safeJson(unwrapJsonp(raw)) as { retcode?: unknown; code?: unknown; lyric?: unknown } | undefined;
    if (!data) return null;
    const code = Number(data.retcode ?? data.code ?? -1);
    if (code !== 0) return null;
    const text = data.lyric;
    if (typeof text !== 'string') return null;
    const t = text.trim();
    return t ? t : null;
}

// ────────────────────────────── 挑哪一条 ──────────────────────────────

/** 去尾部标点 + 小写（翻唱源的歌手名常带 `周杰伦-` / `周杰伦.` 这类噪声） */
function cleanName(s: string): string {
    return String(s ?? '')
        .trim()
        .toLowerCase()
        .replace(/[.、，,·\-—\s]+$/g, '');
}

/**
 * 匹配得分（照搬 LyricFlux `pickBestMatch` 的评分口径）：
 * 标题**全等 +10** / 包含 +5；歌手**全等 +5** / 包含 +2。
 *
 * ⚠️ 刻意**不用时长**做匹配依据：表单里拿不到音频时长（文件未解码），拿一个猜的值去过滤只会误杀。
 */
function matchScore(c: LyricCandidate, title: string, author: string): number {
    let score = 0;
    const name = cleanName(c.name);
    if (title && name === title) score += 10;
    else if (title && name && name.includes(title)) score += 5;
    if (author) {
        const hits = (c.artists ?? []).map(cleanName);
        if (hits.some((x) => x === author)) score += 5;
        else if (hits.some((x) => x.includes(author))) score += 2;
    }
    return score;
}

/**
 * 弹窗里每个源最多列出几条候选。
 * 🔴 2026-09-28 #400：**3 → 10**（用户：「LRC歌词获取完整也给我搬过来，现在只有几个显示」）。
 *    配合搜索池放宽到每源 20 条，同名翻唱 / Live 版才有得选；面板本身可滚动，不会顶爆。
 * 🔴 2026-10-01 #475：**10 → 20**（用户：「lrc歌词获取的怎么这么少啊」）。**实测依据**（四源探针，
 *    `_probe_lyric.cjs`）：网易云 `limit=50` 真返回 50 条、`limit=100` 真返回 100 条；酷我 `limit=50` 也真给 50 条
 *    ⇒ **一直是「我们截得狠」，不是「源给得少」**（旧记「源只给 10 条」是错的）。
 *    搜索池随之 **20 → 50**：池子大了，排序后把**正确版本**顶进前 20 的机会才大 —— 《七里香》这种翻唱/现场版极多的歌，
 *    原版常被十几条翻唱挤到后面。面板可滚动 ⇒ 4 源 × 20 行不会顶爆。
 */
export const LYRIC_CANDIDATES_PER_SOURCE = 20;

/**
 * 候选**按匹配度排序**（最匹配的在前）并去重截断 —— 弹窗列出每一源的候选时用。
 *
 * 🔴 为什么不是「只给一个下标」：搜索接口对同名曲会同时返回原版 / Live / 翻唱，而**只有用户知道**
 *    他要哪一版。所以弹窗给的是一个**有序短列表**（首条 = 自动命中项），点哪条填哪条。
 * ⚠️ 排序必须**稳定**：同分保持各源自己的相关度排序（`Array.prototype.sort` 在 V8 上稳定）。
 * 🔴 去重键 = 歌名 + 歌手列表：跨源合并时同一首歌会在多个源各出现一次，但**源内**重复行没有价值。
 */
export function rankCandidates(candidates: LyricCandidate[], title: string, author?: string, limit = LYRIC_CANDIDATES_PER_SOURCE): LyricCandidate[] {
    const t = cleanName(title);
    const a = cleanName(author ?? '');
    const scored = (candidates ?? []).map((c, i) => ({ c, i, s: matchScore(c, t, a) }));
    scored.sort((x, y) => y.s - x.s || x.i - y.i);
    const seen = new Set<string>();
    const out: LyricCandidate[] = [];
    for (const { c } of scored) {
        const key = `${c.name}\u0000${(c.artists ?? []).join('\u0001')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
        if (out.length >= Math.max(1, limit)) break;
    }
    return out;
}

/** 候选行文案（`歌名 - 歌手 · 4:59`）—— 弹窗与日志共用一处 */
export function formatCandidateLabel(c: LyricCandidate): string {
    const artists = (c.artists ?? []).filter(Boolean).join(' / ');
    const head = artists ? `${c.name} - ${artists}` : c.name;
    if (!c.durationSec || !Number.isFinite(c.durationSec) || c.durationSec <= 0) return head;
    const total = Math.round(c.durationSec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${head} · ${m}:${String(s).padStart(2, '0')}`;
}
