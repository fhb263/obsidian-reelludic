/**
 * YouTube 网络集的**纯逻辑**（无 obsidian / 无 Node 依赖，可单测）。
 *
 * 🔴 为什么 YouTube 与 B 站必须分成两个模块（真机实测，2026-11）：
 *  - **接口完全不同**：B 站有 `playurl`/`pagelist` 这一类公开 API，一个 GET 就拿到
 *    DASH 清单 + sidx；YouTube 没有可用的公开取流口，只能靠 `yt-dlp` 这个外部进程。
 *  - **格式结构不同**：B 站给的是 fMP4 分片 + `SegmentBase` 索引；YouTube 给的是
 *    **整文件渐进式 MP4**（`protocol: "https"`，`fragments: 0`），单条视频轨最大
 *    1080P 的 `137`（avc1.640028）就有 80MB —— 没有分片索引可以按需拉。
 *  - **网络前置不同**：YouTube 直链带 `ip=<出口IP>`，且 `googlevideo.com` 对
 *    `app://obsidian.md` 这个 origin 不回 CORS 头 ⇒ 必须走本地回环代理（实测
 *    `fetch` 直接 `TypeError: Failed to fetch`）。
 *
 * 📐 关键实测数据（不是查文档猜的）：
 *  - YouTube **已不再提供渐进式（音视频合一）文件**：48 个格式全是分离轨，
 *    `vcodec !== 'none' && acodec !== 'none'` 一条都没有。
 *  - 视频轨（H.264，浏览器可解）：`137`=1080p / `136`=720p / `135`=480p / `134`=360p
 *  - 音频轨（AAC）：`140`=129kbps m4a / `139`=48kbps m4a
 *  - `MediaSource.isTypeSupported('video/mp4; codecs="avc1.640028"')` ⇒ **true**
 *    （真机探针 `tools/probe-yt-egress.mjs` 量到的，MSE 这条路是通的）
 *
 * ⚠️ 因此本模块只做**解析与挑选**，取流交给宿主（`main.ts` spawn yt-dlp），
 *    播放交给现有的 `MseTrackPipeline`（音视频两路喂两个 SourceBuffer）。
 */

/** yt-dlp `-J` 输出里我们真正要用的那几个字段（其余一律忽略，避免被上游改字段搞崩） */
export interface YtFormat {
    format_id?: string;
    /** 容器：`mp4` / `webm` / `m4a` */
    ext?: string;
    /** 视频编码，`none` 表示纯音频 */
    vcodec?: string;
    /** 音频编码，`none` 表示纯视频 */
    acodec?: string;
    height?: number | null;
    width?: number | null;
    fps?: number | null;
    /** 码率（kbps） */
    tbr?: number | null;
    abr?: number | null;
    /** `https` = 整文件；`m3u8_native` = HLS 分片 */
    protocol?: string;
    /** 直链（`protocol: "https"` 时才有意义） */
    url?: string;
    filesize?: number | null;
    filesize_approx?: number | null;
}

/** yt-dlp `-J` 的顶层字段（只列用到的） */
export interface YtInfo {
    id?: string;
    title?: string;
    duration?: number | null;
    thumbnail?: string;
    formats?: YtFormat[];
    /** 自动生成的字幕（B 站 AI 字幕的同位物）：`{ 'zh-Hans': [{ ext, url }] }` */
    automatic_captions?: Record<string, YtCaptionTrack[]>;
    /** 人工字幕 */
    subtitles?: Record<string, YtCaptionTrack[]>;
}

/** yt-dlp 字幕轨道 */
export interface YtCaptionTrack {
    ext?: string;
    url?: string;
    name?: string;
}

/**
 * 挑出来的一条**可播放轨道**（视频 + 音频）。
 *
 * ⚠️ 与 B 站的 `DashTrack` 刻意不同：那边有 `initRange`/`indexRange`（sidx 分片索引），
 *    YouTube 是**整文件** ⇒ 只有 `url` + `codecs` + `size`，没有分片可言。
 */
export interface YtMediaTrack {
    /** yt-dlp 的 format_id，排障用 */
    id: string;
    /** 直链 */
    url: string;
    /** 喂给 `MediaSource.isTypeSupported` 的 codecs 串，如 `avc1.640028` */
    codecs: string;
    /** 竖屏/横屏的高度（1080 / 720 / …）；纯音频 = 0 */
    height: number;
    /** 整文件字节数（估算值也可能落这里；0 = 未知） */
    size: number;
}

/** 一次取流的完整结果 */
export interface YtPick {
    /** 视频轨（必有） */
    video: YtMediaTrack;
    /** 音频轨（YouTube 分离轨，正常都有；极端情况可能 null） */
    audio: YtMediaTrack | null;
    /** 片名（取不到就用调用方给的兜底） */
    title: string;
    /** 片长（秒；`null` ⇒ 0） */
    duration: number;
    /** 本次能给的画质（高度，降序）。清晰度菜单吃它 */
    heights: number[];
}

/**
 * 认不认这个 URL 是 YouTube。
 *
 * 🔴 只认**明确域名**，⛔ 不用「含 youtube 字样」这种模糊判据
 *    （`notyoutube.com` / `youtube-dl.org` 都会被误伤）。
 */
export function isYouTubeUrl(raw: string): boolean {
    const s = String(raw || '').trim();
    if (!/^https?:\/\//i.test(s)) return false;
    try {
        const u = new URL(s);
        const h = u.hostname.toLowerCase();
        return (
            h === 'youtube.com' ||
            h === 'www.youtube.com' ||
            h === 'm.youtube.com' ||
            h === 'music.youtube.com' ||
            h === 'youtu.be' ||
            h === 'www.youtu.be' ||
            h.endsWith('.youtube.com')
        );
    } catch {
        return false;
    }
}

/**
 * 从 YouTube URL 里抠视频 id。
 *
 * 覆盖形态（都是真实分享格式）：
 *  - `https://www.youtube.com/watch?v=ID`
 *  - `https://youtu.be/ID`
 *  - `https://www.youtube.com/embed/ID`
 *  - `https://www.youtube.com/shorts/ID`
 *  - `https://m.youtube.com/watch?v=ID`
 *
 * ⚠️ 拿不到就 `null`：插件不会替用户去联网猜（那个成本应该由 yt-dlp 付一次）。
 */
export function youTubeIdOf(raw: string): string | null {
    if (!isYouTubeUrl(raw)) return null;
    try {
        const u = new URL(String(raw).trim());
        // `youtu.be/ID`
        if (u.hostname.toLowerCase().endsWith('youtu.be')) {
            const seg = u.pathname.split('/').filter(Boolean)[0] || '';
            return /^[A-Za-z0-9_-]{6,}$/.test(seg) ? seg : null;
        }
        // `?v=ID`
        const v = u.searchParams.get('v');
        if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) return v;
        // `/embed/ID`、`/shorts/ID`、`/live/ID`
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

/** 视频编码 → MSE codecs 串。yt-dlp 给的 `vcodec` 本身就是 `avc1.640028` 这种形态 */
function videoCodecsOf(f: YtFormat): string {
    const c = String(f.vcodec || '').trim();
    // `avc1` / `av01` / `hev1` / `vp9` 都是 MSE 认的名字；`vp9` 要写成 `vp09.00.10.08`，
    // 但 YouTube 的 vp9 轨实际会给完整串，这里只兜底裸名。
    if (c === 'vp9') return 'vp09.00.10.08';
    return c;
}

/** 音频编码 → MSE codecs 串 */
function audioCodecsOf(f: YtFormat): string {
    const c = String(f.acodec || '').trim();
    if (c === 'opus') return 'opus';
    return c;
}

/** 这条轨是不是「纯视频」 */
function isVideoOnly(f: YtFormat): boolean {
    return !!f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none');
}

/** 这条轨是不是「纯音频」 */
function isAudioOnly(f: YtFormat): boolean {
    return !!f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none');
}

/** 只收整文件直链（`m3u8_native` 是 HLS，握手与分片逻辑完全不同，本模块不碰） */
function isProgressive(f: YtFormat): boolean {
    return String(f.protocol || '') === 'https' && typeof f.url === 'string' && /^https?:\/\//i.test(f.url);
}

/** 轨的字节数：`filesize` 优先，估算值兜底 */
function sizeOf(f: YtFormat): number {
    const n = typeof f.filesize === 'number' && f.filesize > 0 ? f.filesize : f.filesize_approx;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * 浏览器**真能解**的编码白名单。
 *
 * 🔴 为什么必须在这里挡一道（真机踩过，B 站那边同样栽过）：
 *    YouTube 同一画质会同时给 `av01`（AV1）、`vp9`、`avc1`（H.264）三条。
 *    AV1 在老 Chromium 上 `isTypeSupported` 是 false，直接喂进去
 *    `SourceBuffer.appendBuffer` 会抛 `NotSupportedError`，整条管线报废。
 *    ⇒ 优先 H.264，其次 VP9，最后 AV1；同编码里挑码率最高的那条。
 */
const CODEC_RANK: Record<string, number> = {
    avc1: 0,
    vp9: 1,
    vp09: 1,
    av01: 2,
    hev1: 3,
    hvc1: 3,
};

function codecRank(codecs: string): number {
    const head = codecs.split('.')[0].toLowerCase();
    return CODEC_RANK[head] ?? 9;
}

/**
 * 从 yt-dlp 的 `formats` 里挑出一套可播的轨。
 *
 * 挑选口径（**优先级从高到低**，每一层都是真机需求）：
 *  ① 只收整文件直链（HLS 分片这条路本模块不管）；
 *  ② 视频轨：先按编码可解性（H.264 > VP9 > AV1），再按高度降序，最后码率降序；
 *  ③ 音频轨：m4a(AAC) 优先于 webm(Opus)（Safari/老 Chromium 的 Opus 支持不稳），
 *     同容器里码率高的优先；
 *  ④ 高度列表要**降序去重**，供清晰度菜单用。
 *
 * @param info yt-dlp `-J` 的解析结果
 * @param preferHeight 想要的画质高度（默认取最高可播档）；给不到就退到最近的更低档
 */
export function pickYtMedia(info: YtInfo | null | undefined, preferHeight?: number): YtPick | null {
    const formats = Array.isArray(info?.formats) ? info!.formats! : [];
    if (formats.length === 0) return null;

    const prog = formats.filter(isProgressive);

    // ── 视频轨 ──
    const vids = prog
        .filter(isVideoOnly)
        .filter((f) => typeof f.height === 'number' && (f.height as number) > 0)
        .filter((f) => {
            const c = videoCodecsOf(f);
            return !!c && c !== 'none';
        })
        .sort((a, b) => {
            // ① 编码可解性；② 高度；③ 码率
            const ra = codecRank(videoCodecsOf(a));
            const rb = codecRank(videoCodecsOf(b));
            if (ra !== rb) return ra - rb;
            const ha = Number(a.height) || 0;
            const hb = Number(b.height) || 0;
            if (ha !== hb) return hb - ha;
            return (Number(b.tbr) || 0) - (Number(a.tbr) || 0);
        });
    if (vids.length === 0) return null;

    // 想要的高度：给了就找「≤ 目标」里最高的那档；没给就取最高
    let videoFmt = vids[0];
    if (typeof preferHeight === 'number' && preferHeight > 0) {
        const okRank = vids[0] ? codecRank(videoCodecsOf(vids[0])) : 0;
        // 只在**同一编码档**里挑高度，⛔ 别为了高分辨率退到 AV1（老机器解不了）
        const sameCodec = vids.filter((f) => codecRank(videoCodecsOf(f)) === okRank);
        const notAbove = sameCodec.filter((f) => (Number(f.height) || 0) <= preferHeight);
        videoFmt = notAbove.length > 0 ? notAbove[0] : sameCodec[sameCodec.length - 1] ?? vids[0];
    }

    const video: YtMediaTrack = {
        id: String(videoFmt.format_id || ''),
        url: String(videoFmt.url || ''),
        codecs: videoCodecsOf(videoFmt),
        height: Number(videoFmt.height) || 0,
        size: sizeOf(videoFmt),
    };

    // ── 音频轨 ──
    const auds = prog
        .filter(isAudioOnly)
        .filter((f) => !!audioCodecsOf(f))
        .sort((a, b) => {
            // m4a(AAC) 优先；同容器比码率
            const ea = String(a.ext || '').toLowerCase() === 'm4a' ? 0 : 1;
            const eb = String(b.ext || '').toLowerCase() === 'm4a' ? 0 : 1;
            if (ea !== eb) return ea - eb;
            const aa = Number(a.abr) || Number(a.tbr) || 0;
            const ab = Number(b.abr) || Number(b.tbr) || 0;
            return ab - aa;
        });
    const audio: YtMediaTrack | null = auds[0]
        ? {
              id: String(auds[0].format_id || ''),
              url: String(auds[0].url || ''),
              codecs: audioCodecsOf(auds[0]),
              height: 0,
              size: sizeOf(auds[0]),
          }
        : null;

    // ── 可选高度（降序去重）──
    const heights: number[] = [];
    for (const f of vids) {
        const h = Number(f.height) || 0;
        if (h > 0 && !heights.includes(h)) heights.push(h);
    }
    heights.sort((a, b) => b - a);

    return {
        video,
        audio,
        title: String(info?.title || ''),
        duration: typeof info?.duration === 'number' && Number.isFinite(info.duration) ? info.duration : 0,
        heights,
    };
}

/**
 * 画质标签（清晰度菜单用）。
 *
 * ⚠️ 与 B 站的 `qualityLabel(qn)` 分开：那边吃的是 B 站 `qn` 数字（80/64/…），
 *    这边吃的是**像素高度**（1080/720/…）。⛔ 别合成一个函数 —— 两套编号混在一起
 *    必然出现「112P」那种荒谬文案（B 站那边已经踩过一次）。
 */
export function ytQualityLabel(height: number): string {
    const h = Number(height) || 0;
    if (h <= 0) return '未知';
    if (h >= 2160) return '4K';
    if (h >= 1440) return '2K';
    return `${h}P`;
}

/**
 * 挑一条字幕轨道。
 *
 * 🔴 优先级（用户是中文用户，实测 `zh-Hans` 命中率最高）：
 *  ① 人工字幕的中文 > ② 自动字幕的中文 > ③ 人工英文字幕 > ④ 自动英文字幕。
 *  ⛔ 不挑「第一条」：YouTube 的 key 顺序不稳定，第一条常是 `en-orig` 之类的自动轨。
 *
 * @returns 选中的轨道 + 它是不是自动生成的（面板上要标 AI / 人工）
 */
export function pickYtCaption(info: YtInfo | null | undefined): {
    url: string;
    lang: string;
    isAuto: boolean;
} | null {
    if (!info) return null;

    const ZH = ['zh-hans', 'zh-cn', 'zh', 'zh-hant', 'zh-tw', 'zh-hk'];
    const EN = ['en', 'en-us', 'en-gb'];

    /** 在给定表里按语言优先序找第一条可用轨 */
    const find = (table: Record<string, YtCaptionTrack[]> | undefined, langs: string[]): { url: string; lang: string } | null => {
        if (!table) return null;
        for (const want of langs) {
            for (const key of Object.keys(table)) {
                if (key.toLowerCase() !== want) continue;
                const arr = table[key];
                if (!Array.isArray(arr)) continue;
                // `ext` 优先 `vtt`（`json3` 是 YouTube 私有结构，解析成本高且不稳）
                const t = arr.find((x) => String(x.ext || '').toLowerCase() === 'vtt') ?? arr.find((x) => !!x.url);
                if (t && typeof t.url === 'string' && /^https?:\/\//i.test(t.url)) {
                    return { url: t.url, lang: key };
                }
            }
        }
        return null;
    };

    /**
     * 🔴 2026-11-10 真机 A/B（`tools/probe-yt-fmt-ab.mjs`，同一条 timedtext 逐路打）：
     *   `fmt=vtt`（带 `tlang=zh-Hans`）→ 429   `fmt=json3` → 429
     *   去 `fmt`                   → 429   `fmt=srv3` → 429
     *   **去掉 `tlang`**           → 200 / 14807 字节 WEBVTT
     * ⇒ 触发限流的是 **`tlang`（机器翻译）那条路**，不是 IP 级限流、也不是 fmt 的事
     *   （`no-tlang` 排在最后还能 200，恰恰是最难的样本）。
     * 所以：**优先取原始语言轨**（URL 不带 `tlang`）；只剩翻译轨时才用它，并把 `tlang` 剥掉
     * —— 拿原文总比拿到空面板强。⚠️ 剥掉后 `lang` 必须改报 URL 里的 `lang=`（真语言），
     *    否则面板会把英文正文标成「中文」。
     */
    const hasTlang = (u: string): boolean => /[?&]tlang=/.test(u);
    /**
     * 剥掉 `tlang=` 这一段。
     * 🔴 **只能按 `&` 切段过滤**，⛔ 不能 `new URL(...).searchParams` 重写：
     *    那条 URL 带 `signature`，任何重编码（`%2C`/`+`/空格）都会让签名失效 ⇒ 403。
     *    这里只动 `tlang` 一段，其余参数**逐字节保留**。
     */
    const stripTlang = (u: string): string => {
        const q = u.indexOf('?');
        if (q < 0) return u;
        const parts = u.slice(q + 1).split('&').filter((p) => p.length > 0 && !/^tlang=/.test(p));
        return u.slice(0, q + 1) + parts.join('&');
    };
    /** 取 URL 里的 `lang=`（剥 `tlang` 后的真语言）；取不到就用表里的 key */
    const realLang = (u: string, fallback: string): string => {
        const m = /[?&]lang=([^&]*)/.exec(u);
        return m && m[1] ? decodeURIComponent(m[1]) : fallback;
    };
    /** 同一档语言里：先要原始轨，没有再退回翻译轨（翻译轨同样会剥 `tlang`） */
    const findNoTlang = (table: Record<string, YtCaptionTrack[]> | undefined, langs: string[]): { url: string; lang: string } | null => {
        const hit = find(table, langs);
        return hit && !hasTlang(hit.url) ? hit : null;
    };
    const findAny = (table: Record<string, YtCaptionTrack[]> | undefined, langs: string[]): { url: string; lang: string } | null => {
        const raw = findNoTlang(table, langs) ?? find(table, langs);
        if (!raw) return null;
        const url = hasTlang(raw.url) ? stripTlang(raw.url) : raw.url;
        return { url, lang: realLang(url, raw.lang) };
    };

    const manualZh = findAny(info.subtitles, ZH);
    if (manualZh) return { ...manualZh, isAuto: false };
    const autoZh = findAny(info.automatic_captions, ZH);
    if (autoZh) return { ...autoZh, isAuto: true };
    const manualEn = findAny(info.subtitles, EN);
    if (manualEn) return { ...manualEn, isAuto: false };
    const autoEn = findAny(info.automatic_captions, EN);
    if (autoEn) return { ...autoEn, isAuto: true };
    return null;
}

/**
 * WebVTT 文本 → 纯 SRT 风格的行数组（`{ at: 秒, text }`）。
 *
 * 🔴 为什么自己解析而不用 `<track>`：插件的时间轴面板是**自己画的行**，
 *    需要 `{秒, 文本}` 结构来跟随播放头高亮。`<track>` 的 cues 是浏览器内部对象，
 *    取出来还要再转一道，且跨集复用会跟着 `<video>` 一起销毁。
 *
 * ⚠️ YouTube 的自动字幕 VTT **带内联时间戳**（`<00:00:01.234><c>词</c>`），
 *    留着会让用户看到满屏尖括号 ⇒ 必须剥掉。
 */
export function parseVttToCues(vtt: string): { at: number; text: string }[] {
    const out: { at: number; text: string }[] = [];
    const raw = String(vtt || '').replace(/\r\n?/g, '\n');
    // 按空行切块；每块形如：`[id]\n00:00:01.000 --> 00:00:03.000 [settings]\n文本`
    for (const block of raw.split(/\n{2,}/)) {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length < 2) continue;
        const tIdx = lines.findIndex((l) => l.includes('-->'));
        if (tIdx < 0) continue;
        const start = lines[tIdx].split('-->')[0].trim();
        const at = parseVttTime(start);
        if (at === null) continue;
        const text = lines
            .slice(tIdx + 1)
            .join(' ')
            // 剥内联时间戳 `<00:00:01.234>` 与配对标签 `<c>`/`</c>`
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) continue;
        out.push({ at, text });
    }
    out.sort((a, b) => a.at - b.at);
    return out;
}

/** `HH:MM:SS.mmm` / `MM:SS.mmm` → 秒；解析不了 ⇒ null */
function parseVttTime(s: string): number | null {
    const m = String(s).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    const h = m[1] ? Number(m[1]) : 0;
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(mm) || !Number.isFinite(ss)) return null;
    return h * 3600 + mm * 60 + ss + ms / 1000;
}

/**
 * 把提示性的 yt-dlp stderr 翻成人话。
 *
 * 🔴 必须区分「要登录」和「别的问题」：前者用户该去填 Cookie（或换代理出口），
 *    后者才是插件 bug。⛔ 全都糊成「取流失败」等于让用户没法自救。
 */
export function ytErrorMessage(stderr: string): string {
    const s = String(stderr || '');
    // 🔴🔴 2026-10-31 真机事故：用户在 Cookie **已经填好**的情况下，看到的是
    //    「请在设置里填浏览器 Cookie」——他照着做了一遍又一遍。
    //    真根因是 yt-dlp `JS runtimes: none`（见 `resolveJsRuntime`），与 Cookie 无关。
    //    ⇒ 「只拿到故事板」「让页面重载」这两个信号必须先于「要去填 Cookie」被识别出来。
    if (/Only images are available|storyboard/i.test(s)) {
        return 'YouTube 只下发了故事板图片（yt-dlp 没启用 JS 运行时）—— 需要本机装有 Node 18+；插件会自动调用它，装好后重开播放即可';
    }
    if (/The page needs to be reloaded/i.test(s)) {
        return 'YouTube 要求重载页面后才给格式（通常也是缺 JS 运行时；Cookie 过期也会这样）—— 请确认本机装有 Node 18+ 后重试，仍不行就更新 yt-dlp';
    }
    if (/Sign in to confirm|not a bot|confirm you.{0,3}re not a bot/i.test(s)) {
        return 'YouTube 要求验证机器人身份 —— 请在设置里填浏览器 Cookie，或换个代理出口再试';
    }
    if (/Video unavailable|Private video|removed by the uploader/i.test(s)) {
        return '这个视频不可用（已删除 / 私享 / 地区受限）';
    }
    if (/members-only|Join this channel/i.test(s)) {
        return '这是频道会员专属视频，需要对应账号的 Cookie';
    }
    if (/geo.?restricted|not available in your country/i.test(s)) {
        return '这个视频在当前代理出口地区不可用';
    }
    if (/timed out|timeout|ETIMEDOUT|ECONNREFUSED|getaddrinfo/i.test(s)) {
        return '连不上 YouTube —— 检查设置里的代理地址是否可用';
    }
    if (/Unsupported URL|is not a valid URL/i.test(s)) {
        return '链接格式不被识别（要 youtube.com/watch?v=… 或 youtu.be/…）';
    }
    return 'YouTube 取流失败（详见控制台日志）';
}

/**
 * 这段 stderr 属于「**这个视频**本身看不了」而不是「**你这边**连不上 / 没登录」。
 *
 * 🔴 为什么必须把两者分开（设置页「测试连接」的正确性全靠它）：
 *    测试连接拿一条**固定的探测视频**去打 yt-dlp。如果那条片子哪天被下架，
 *    单看「失败」会把结论写成「你配错了」—— 而实际上 yt-dlp 装好了、代理通了、
 *    Cookie 也有效，只是探测用的片子没了。用户会照着错误结论去乱改配置。
 *    ⇒ 「内容不可用」这一类应当判为**连通性没问题**（请求确实到达了 YouTube 并拿到明确答复）。
 *
 * ⚠️ 与 `ytErrorMessage` **共用同一批正则的语义**，但函数分开：那里是「翻译成一句话」，
 *    这里是「分类」。⛔ 别把判据写两份（改一处漏一处就会出现「文案说地区受限、判定说网络不通」）。
 */
export function ytContentUnavailable(stderr: string): boolean {
    const s = String(stderr || '');
    return (
        /Video unavailable|Private video|removed by the uploader/i.test(s) ||
        /members-only|Join this channel/i.test(s) ||
        /geo.?restricted|not available in your country/i.test(s)
    );
}

/**
 * 一条 YouTube 搜索结果（供「网络地址」行那枚 globe 挑链接用）。
 *
 * ⚠️ 字段刻意只留**能直接展示 + 能拼出链接**的几项：搜索走 `--flat-playlist`，
 *    yt-dlp 在这个模式下**不给**完整 formats / 精确时长（`duration` 常为 null），
 *    ⛔ 别在这里声明 `size` / `quality` 之类取流阶段才有的字段。
 */
export interface YtSearchItem {
    /** 11 位视频 id（拼链接 + 作 `{#each}` 的 key） */
    id: string;
    /** 视频页地址（`https://www.youtube.com/watch?v=<id>`） */
    url: string;
    title: string;
    /** 频道名（可能为空串 —— flat 模式偶尔不给 uploader） */
    channel: string;
    /** 时长秒数；flat 模式下常为 0（= 未知），⛔ 别当成「0 秒视频」 */
    duration: number;
    /** 封面地址（`i.ytimg.com` 规律拼出，不需要额外请求） */
    thumbnail: string;
}

/**
 * 由视频 id 拼出标准观看地址。
 *
 * 🔴 为什么统一收敛到 `watch?v=` 而不是还原用户原始形态：
 *    `episodeUrls` 存的是**要能再次取流**的地址，`shorts/<id>` / `youtu.be/<id>`
 *    虽然 `youTubeIdOf` 都认，但用户在笔记里看到 `watch?v=` 更清楚它是什么；
 *    而且 `netOfficialEmbed` 走的是 id，两种形态殊途同归。
 */
export function ytWatchUrl(id: string): string {
    return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * 解析 `yt-dlp --flat-playlist -J "ytsearchN:<词>"` 的产物 → 搜索结果列表。
 *
 * 🔴 为什么单独一个纯函数（放在 `pure` 而不是 service）：
 *    yt-dlp 的 JSON 形状**不稳定**（`entries` 可能在顶层，也可能在 `_type: playlist` 里；
 *    老版本 `url` 字段是裸 id，新版是完整 URL）。这些必须是**可单测的纯逻辑**，
 *    ⛔ 不能混在 spawn 的 service 里靠真机碰运气。
 *
 * ⚠️ 容错优先，⛔ 不抛：任何一条形状不对就跳过那一条，不因为一条脏数据丢掉整批
 *    （与本仓「工具失败不抛、能力回落」的一贯纪律一致）。
 * ⚠️ 缺 id 的条目直接丢：拼不出链接的搜索结果对本功能毫无意义。
 */
export function parseYtSearch(json: unknown): YtSearchItem[] {
    if (!json || typeof json !== 'object') return [];
    const root = json as Record<string, unknown>;
    const raw = Array.isArray(root.entries) ? root.entries : Array.isArray(json) ? (json as unknown[]) : [];
    const out: YtSearchItem[] = [];
    const seen = new Set<string>();
    for (const e of raw) {
        if (!e || typeof e !== 'object') continue;
        const o = e as Record<string, unknown>;
        // `id` 是首选；老版本有时只有 `url`（裸 id 或完整 URL），两种都认
        let id = typeof o.id === 'string' ? o.id.trim() : '';
        if (!id && typeof o.url === 'string') {
            const u = o.url.trim();
            id = youTubeIdOf(u) ?? (/^[A-Za-z0-9_-]{6,}$/.test(u) ? u : '');
        }
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : id;
        const channel =
            (typeof o.channel === 'string' && o.channel.trim()) ||
            (typeof o.uploader === 'string' && o.uploader.trim()) ||
            '';
        const durRaw = Number(o.duration ?? 0);
        const duration = Number.isFinite(durRaw) && durRaw > 0 ? Math.floor(durRaw) : 0;
        out.push({ id, url: ytWatchUrl(id), title, channel, duration, thumbnail: ytThumbUrl(id) });
    }
    return out;
}

/**
 * 由 id 拼封面地址。
 *
 * ⚠️ 用 `mqdefault.jpg`（320×180）：`maxresdefault` 对老视频常常 404，
 *    `default`（120×90）在列表里又糊。列表缩略图这个尺寸够用且几乎不会缺。
 */
export function ytThumbUrl(id: string): string {
    return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}
