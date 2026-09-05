// 网站更新检测（纯逻辑，可单测）
// 参考 Bangumi-Bridge-Obsidian 追番列表（串行/并行检测）脚本：
//   抓取观看网址 HTML → 正则提取最新集数 → 减去已观看集数 = 更新集数
// 逻辑与 HTTP 分离：注入 HttpGet 便于 mock；缓存/超时由调用方（main.ts）负责。

export type UpdateStatus = 'updated' | 'synced' | 'no-url' | 'failed' | 'no-info' | 'blocked';

export interface UpdateCheckResult {
    status: UpdateStatus;
    /** 网页提取到的最新集数（失败/未设置时为 0） */
    latestEpisode: number;
    /** 已观看集数（由调用方传入） */
    watchedEpisodes: number;
    /** 更新集数 = max(0, latest - watched) */
    updateCount: number;
    /** 失败原因（status=failed 时有值） */
    error?: string;
    /** 检测耗时 ms（供 UI 展示，可选） */
    elapsedMs?: number;
}

export type HttpGet = (url: string) => Promise<string>;

/** CDN 人机验证/WAF 拦截页特征（此类页面拿不到真实集数，需浏览器执行 JS 验证） */
const BLOCKED_PATTERNS = [
    'cdndefend',
    'verifying your browser',
    'verify you are human',
    '请开启javascript',
    '人机验证',
    '安全验证',
    '访问过于频繁',
];

/** 判断页面是否为 CDN 人机验证/反爬拦截页（true=拦截，提取集数无意义） */
export function isBlockedPage(html: string): boolean {
    if (!html) return false;
    const lower = html.toLowerCase();
    return BLOCKED_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

/** 从 HTML 提取最大集数：第X集 / 第X话 / Episode X / ep.X / EPX / 第X期 / X集 / 苹果CMS播放链接 /play/{id}-{ep}-{rec}.html */
export function extractMaxEpisodeFromHTML(html: string): number {
    if (!html) return 0;
    const patterns = [
        /第\s*(\d+)\s*集/g,
        /第\s*(\d+)\s*[话話]/g,
        /第\s*(\d+)\s*期/g,
        /Episode\s*(\d+)/gi,
        /ep\.?\s*(\d+)/gi,
        /(?<![a-z0-9])ep\s*(\d+)/gi,
        /(?<![a-z0-9])ep[=\/]\s*(\d+)/gi,
        /[^\d](\d+)\s*集(?![\u4e00-\u9fa5])/g,
        /^\s*(\d+)\s*集/g,
        // 苹果CMS 播放链接：/play/{剧集id}-{集序号}-{播放记录id}.html → 提取中间的集序号
        /\/play\/\d+-(\d+)-\d+\.html/g,
    ];
    let max = 0;
    for (const re of patterns) {
        const ms = [...html.matchAll(re)];
        for (const m of ms) {
            const n = parseInt(m[1], 10);
            if (!Number.isNaN(n) && n > 0 && n > max) max = n;
        }
    }
    return max;
}

/** 检测单个观看网址的更新情况：抓 HTML → 提最大集数 → 对比已观看集数 */
export async function checkAnimeUpdate(
    http: HttpGet,
    url: string,
    watchedEpisodes: number,
): Promise<UpdateCheckResult> {
    const start = Date.now();
    const fail = (error: string): UpdateCheckResult => ({
        status: 'failed',
        latestEpisode: 0,
        watchedEpisodes,
        updateCount: 0,
        error,
        elapsedMs: Date.now() - start,
    });
    if (!url || url.trim() === '') {
        return { status: 'no-url', latestEpisode: 0, watchedEpisodes, updateCount: 0, elapsedMs: Date.now() - start };
    }
    let html: string;
    try {
        html = await http(url.trim());
    } catch (e) {
        return fail('网络请求失败：' + (e instanceof Error ? e.message : String(e)));
    }
    if (isBlockedPage(html)) {
        return { status: 'blocked', latestEpisode: 0, watchedEpisodes, updateCount: 0, elapsedMs: Date.now() - start };
    }
    const latestEpisode = extractMaxEpisodeFromHTML(html);
    if (latestEpisode === 0) {
        return { status: 'no-info', latestEpisode: 0, watchedEpisodes, updateCount: 0, elapsedMs: Date.now() - start };
    }
    const updateCount = Math.max(0, latestEpisode - watchedEpisodes);
    return {
        status: updateCount > 0 ? 'updated' : 'synced',
        latestEpisode,
        watchedEpisodes,
        updateCount,
        elapsedMs: Date.now() - start,
    };
}
