/**
 * B 站字幕（含 AI 字幕）→ 面板 cue 的纯逻辑层。
 *
 * 🔴 用户 2026-11-09 逐字：「播放网络集的字幕面板能不能显示其b站的AI字幕」
 *
 * 真机实测（`tools/probe-bili-subtitle-cookie.mjs`，2026-11-09）：
 *  - 匿名请求 `x/player/v2` / `x/player/wbi/v2`（无论带不带 wts）⇒ 都是 `code:0` 但
 *    `data.subtitle.subtitles = []`。**接口通、只是没内容** —— B 站字幕列表与登录态绑定；
 *  - 带用户 Cookie 请求同一个 `x/player/wbi/v2` ⇒ 返回 1 条
 *    `{ lan: 'ai-zh', lan_doc: '中文', ai_type: 1, subtitle_url: '//aisubtitle.hdslb.com/...' }`；
 *  - 该 `subtitle_url` 取回来的 JSON 是
 *    `{ type:'AIsubtitle', lang:'zh', body: [{ from: 0.02, to: 2.5, content: '...' }, ...] }`。
 *
 * ⚠️ 本文件只做「JSON → 可读结构」的纯变换，网络一律由调用方（服务层）负责：
 *    这样解析逻辑能被单测覆盖，也免得把一个 `fetch` 塞进纯模块里。
 */

/** B 站字幕轨（`data.subtitle.subtitles[]` 的一项） */
export interface BiliSubtitleTrack {
    /** 语言标签：`ai-zh`（AI 中文）/ `zh-CN` / `en-US` … */
    lan: string;
    /** 语言显示名：`中文` / `英文` … */
    lanDoc: string;
    /** 是否为 AI 生成字幕（B 站用 `ai_type: 1` 标） */
    isAi: boolean;
    /** 字幕 JSON 地址（B 站给的是 `//` 开头，需补协议） */
    url: string;
}

/** 一条字幕（与 `pure/subtitleCues.ts` 的 `Cue` 同形，便于直接喂面板） */
export interface BiliCue {
    start: number;
    end: number;
    text: string;
}

/**
 * 归一化 B 站给的字幕地址。
 * ⛔ 不能直接 `new URL(u)`：B 站返回的是 `//aisubtitle.hdslb.com/...`（协议相对），
 *    缺协议会让 `new URL` 直接抛 `Invalid URL`。
 */
export function normalizeSubtitleUrl(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const s = raw.trim();
    if (!s) return '';
    if (s.startsWith('//')) return `https:${s}`;
    if (/^https?:\/\//i.test(s)) return s;
    return `https://${s}`;
}

/**
 * 从 `x/player/wbi/v2` 的响应 JSON 里取出字幕轨列表。
 *
 * ⚠️ 判据是 `Array.isArray(data.subtitle.subtitles)` 而不是「有没有 `data`」：
 *    未登录时 `data.subtitle` 会是 `{}` 或干脆没有，取不到就必须返回空数组
 *    （调用方据此显示「没有字幕」，而不是当成接口错误去重试）。
 */
export function pickBiliSubtitles(json: unknown): BiliSubtitleTrack[] {
    const subtitles = (json as { data?: { subtitle?: { subtitles?: unknown } } })?.data?.subtitle?.subtitles;
    if (!Array.isArray(subtitles)) return [];
    const out: BiliSubtitleTrack[] = [];
    for (const raw of subtitles) {
        const it = raw as { lan?: unknown; lan_doc?: unknown; ai_type?: unknown; subtitle_url?: unknown };
        const url = normalizeSubtitleUrl(it?.subtitle_url);
        if (!url) continue; // 没有地址的轨拿不到内容，留着只会让菜单出现点不动的项
        out.push({
            lan: typeof it.lan === 'string' ? it.lan : '',
            lanDoc: typeof it.lan_doc === 'string' ? it.lan_doc : '',
            isAi: Number(it.ai_type) === 1,
            url,
        });
    }
    return out;
}

/**
 * 挑一条最该用的轨：优先人工中文 → AI 中文 → 任意中文 → 第一条。
 *
 * 🔴 用户点名要的是「AI 字幕」，但**有人工字幕时不该抢**：
 *    人工轨是校对过的，AI 轨有识别错误；只有人工的没有时才用 AI。
 *    这里把「是否 AI」放在「是否中文」之后判，正是为了不让 AI 轨压过人工中文轨。
 */
export function pickPreferredSubtitle(tracks: readonly BiliSubtitleTrack[]): BiliSubtitleTrack | null {
    if (!tracks.length) return null;
    const isZh = (t: BiliSubtitleTrack): boolean => /^zh|^ai-zh/i.test(t.lan) || /中文/.test(t.lanDoc);
    return tracks.find((t) => isZh(t) && !t.isAi) ?? tracks.find((t) => isZh(t)) ?? tracks[0] ?? null;
}

/**
 * 把 B 站字幕 JSON 的 `body[]` 转成 cue 列表。
 *
 * 结构：`{ body: [{ from: number, to: number, content: string }] }`
 * ⚠️ 三条清洗都要做，少一条就会在面板里看到脏行：
 *   ① `content` 里常有换行（`\n`）—— 面板是单行布局，换行会把行高撑爆；
 *   ② `from >= to` 的坏行直接丢（点上去跳到一个瞬间，等于没跳）；
 *   ③ 空白行丢（B 站 AI 轨会吐纯空格行）。
 * ⛔ 不排序：B 站给的顺序已按时间；排序反而会让「乱序 = 接口异常」这种信号消失。
 */
export function parseBiliSubtitleBody(json: unknown): BiliCue[] {
    const body = (json as { body?: unknown })?.body;
    if (!Array.isArray(body)) return [];
    const out: BiliCue[] = [];
    for (const raw of body) {
        const it = raw as { from?: unknown; to?: unknown; content?: unknown };
        const start = Number(it?.from);
        const end = Number(it?.to);
        const text = typeof it?.content === 'string' ? it.content.replace(/\s*\n\s*/g, ' ').trim() : '';
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        if (end <= start) continue;
        if (!text) continue;
        out.push({ start, end, text });
    }
    return out;
}

/**
 * cue 列表 → VTT 文本。
 *
 * 🔴 为什么还要转 VTT：面板吃的 `parseSubtitleText()` 按扩展名分流，
 *    但我们这里已经有结构化 cue 了；之所以仍产 VTT，是为了让「画面字幕」
 *    （`<track>` 那条通路）与「面板时间轴」共用同一份文本 —— 两条通路口径一致，
 *    才不会出现「面板有词、画面上没字幕」这种分裂。
 */
export function biliCuesToVtt(cues: readonly BiliCue[]): string {
    const stamp = (sec: number): string => {
        const s = Math.max(0, sec);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const rest = s % 60;
        const ss = Math.floor(rest);
        const ms = Math.round((rest - ss) * 1000);
        const p2 = (n: number): string => String(n).padStart(2, '0');
        return `${p2(h)}:${p2(m)}:${p2(ss)}.${String(ms).padStart(3, '0')}`;
    };
    const lines = ['WEBVTT', ''];
    for (const c of cues) {
        lines.push(`${stamp(c.start)} --> ${stamp(c.end)}`);
        lines.push(c.text);
        lines.push('');
    }
    return lines.join('\n');
}
