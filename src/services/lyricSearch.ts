/**
 * 在线歌词检索的**服务层**（2026-09-27 #396）—— 只做「拼 URL + 发请求 + 交给纯模块解析」。
 *
 * ## 分工（别把两边混起来）
 * - 拼 URL / 解析响应 / 挑哪一条 ⇒ `pure/lyricOnline`（**纯函数，可喂 fixture 单测**）。
 * - 发请求 ⇒ 本模块，且 **HTTP 走注入**（对齐 `services/douban` 的 `HttpGet` 口径）——
 *   真源在 `main.ts` 接线时传 `services/nodeHttp.nodeHttpGet`，单测传假响应。
 *
 * ## 为什么值得单独一层
 * - 🔴 **单源失败必须逐个降级**：四个源里任何一个改字段、封接口、超时，都只该表现为
 *   「这一源没有结果」，⛔ **绝不能**让整次「获取歌词」失败 —— 用户看到的是「四源都空」而不知道谁坏了。
 *   所以每源各自 try/catch，**并行**发起（`Promise.all` 收已 catch 的 promise ⇒ 永不 reject），
 *   快源不必等慢源。
 * - 四个源都是**免 API Key 的公开端点**（用户 2026-09-27 裁定「源不用 API 配置默认就行」）
 *   ⇒ 这里没有任何凭据 / Cookie / 签名逻辑。`neteaseCrypto` 用不到。
 *
 * ⚠️ **仅桌面端可用**（`nodeHttp` 依赖 Node 内置 https）⇒ 调用方（`main.ts`）按 `Platform.isDesktopApp` 门控，
 *    移动端不给「获取歌词」入口（否则必然是一次失败）。
 */
import type { LyricCandidate, LyricSourceId } from 'pure/lyricOnline';
import {
    LYRIC_SOURCE_HEADERS,
    LYRIC_SOURCE_LABELS,
    buildLyricQuery,
    kugouLyricQuery,
    kuwoLyricUrl,
    kuwoSearchUrl,
    neteaseLyricUrl,
    neteaseSearchUrl,
    parseKuwoLyric,
    parseKuwoSearch,
    parseNeteaseLyric,
    parseNeteaseSearch,
    parseKugouLyricCandidates,
    parseQqLyric,
    parseQqSearch,
    qqLyricUrl,
    qqSearchUrl,
    rankCandidates,
    splitKugouLyricId,
} from 'pure/lyricOnline';
import {
    buildKugouLyricDownloadUrl,
    buildKugouLyricSearchUrl,
    parseKugouLyricDownload,
} from 'pure/dl/kugou';

/** 注入式 GET：返回状态码 + 文本（真源 = `services/nodeHttp.nodeHttpGet`） */
export type LyricHttpGet = (
    url: string,
    headers?: Record<string, string>,
) => Promise<{ status: number; text: string }>;

/** 源顺序 = 弹窗展示顺序 = 「自动填入」的尝试顺序（网易云曲库最全、纯 JSON 最稳；QQ 需去 JSONP 包裹放最后） */
export const LYRIC_SOURCE_ORDER: LyricSourceId[] = ['netease', 'kuwo', 'qq', 'kugou'];

/** 某一个源的搜索结果 */
export interface LyricSourceResult {
    source: LyricSourceId;
    /** 面向用户的源名（弹窗分组标题） */
    label: string;
    /** 🔴 已由 `rankCandidates` **按匹配度排序并去重截断**（首条 = 自动命中项）—— 视图层直接渲染即可 */
    candidates: LyricCandidate[];
    /** 该源**请求失败**的原因（成功时 undefined）。与「请求成功但 0 条」是两回事 ⇒ 弹窗文案不同 */
    error?: string;
}

export interface LyricSearchOutcome {
    /** 实际使用的检索词；标题为空 ⇒ `null`（调用方应在此前就禁用按钮） */
    query: string | null;
    results: LyricSourceResult[];
}

export interface LyricFetchOutcome {
    /** 歌词正文（LRC 文本）；`null` = 该源确实没有这首歌的歌词 */
    text: string | null;
    /** 请求失败的原因（`text === null && error === undefined` 才是「真的没有歌词」） */
    error?: string;
}

/** 每个源的「搜索」与「取歌词」两步（两步分开 ⇒ 用户在弹窗里换一条候选只再发一次取歌词请求）
 *  ⚠️ `search` 收三个参数：拼好的 `query`（= `buildLyricQuery` 的「歌名 歌手」）+ 结构化的
 *  `title` / `author` —— 后者是给**酷狗**用的（它的检索词形态与另外三源不同，见 `kugouLyricQuery`），
 *  ⛔ 别在适配器里把 query 反解回 title/author。 */
const ADAPTERS: Record<
    LyricSourceId,
    {
        search: (http: LyricHttpGet, query: string, ctx: { title: string; author: string }) => Promise<LyricCandidate[]>;
        lyric: (http: LyricHttpGet, id: string) => Promise<string | null>;
    }
> = {
    netease: {
        search: async (http, q) => parseNeteaseSearch(await getText(http, neteaseSearchUrl(q), 'netease')),
        lyric: async (http, id) => parseNeteaseLyric(await getText(http, neteaseLyricUrl(id), 'netease')),
    },
    kuwo: {
        search: async (http, q) => parseKuwoSearch(await getText(http, kuwoSearchUrl(q), 'kuwo')),
        lyric: async (http, id) => parseKuwoLyric(await getText(http, kuwoLyricUrl(id), 'kuwo')),
    },
    qq: {
        search: async (http, q) => parseQqSearch(await getText(http, qqSearchUrl(q), 'qq')),
        lyric: async (http, id) => parseQqLyric(await getText(http, qqLyricUrl(id), 'qq')),
    },
    // 🔴 酷狗（2026-09-28 #400）：歌词接口是 `lyrics.kugou.com` 的 search + download 两步，
    //    且**取歌词需要 search 给的 `id` 与 `accesskey` 两个参数** —— 后者被拼进候选 id
    //    （见 `pure/lyricOnline.joinKugouLyricId` 的说明），到这里再拆开。
    // 🔴 2026-09-28 #405：检索词必须用 **`歌手-歌名`**（`kugouLyricQuery`）—— 用另外三源的
    //    「歌名 歌手」空格形态时该接口**恒返回 0 条**（用户报的「酷狗没有歌词」的真因）。
    //    库里没有「歌手-歌名」这条时**退回纯歌名**再试一次（只在 0 条时多发一次请求）。
    kugou: {
        search: async (http, _q, ctx) => {
            const primary = kugouLyricQuery(ctx.title, ctx.author);
            const first = parseKugouLyricCandidates(await getText(http, buildKugouLyricSearchUrl(primary), 'kugou'));
            if (first.length > 0 || !ctx.author) return first;
            return parseKugouLyricCandidates(await getText(http, buildKugouLyricSearchUrl(ctx.title), 'kugou'));
        },
        lyric: async (http, id) => {
            const { id: hash, accesskey } = splitKugouLyricId(id);
            if (!accesskey) throw new Error('缺少 accesskey');
            return parseKugouLyricDownload(
                await getText(http, buildKugouLyricDownloadUrl(hash, accesskey), 'kugou'),
            );
        },
    },
};

/** 非 2xx 一律当失败：站点返回 403/404/500 时正文常常是 HTML 错误页，交给解析器只会静默得到 0 条 */
async function getText(http: LyricHttpGet, url: string, source: LyricSourceId): Promise<string> {
    const res = await http(url, LYRIC_SOURCE_HEADERS[source]);
    if (!res || res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res?.status ?? '?'}`);
    return res.text;
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * 四源并行搜索（**单源失败逐个降级**，返回的 `results` 与 `LYRIC_SOURCE_ORDER` 同序、长度恒为 4）。
 * 标题为空 ⇒ 不发任何请求，`query` 返回 `null`。
 */
export async function searchLyrics(http: LyricHttpGet, title: string, author?: string): Promise<LyricSearchOutcome> {
    const query = buildLyricQuery(title, author);
    if (!query) return { query: null, results: [] };
    const results = await Promise.all(
        LYRIC_SOURCE_ORDER.map(async (source): Promise<LyricSourceResult> => {
            const label = LYRIC_SOURCE_LABELS[source];
            try {
                const raw = await ADAPTERS[source].search(http, query, { title, author: author ?? '' });
                return { source, label, candidates: rankCandidates(raw, title, author) };
            } catch (e) {
                return { source, label, candidates: [], error: errText(e) };
            }
        }),
    );
    return { query, results };
}

/**
 * 取某源某条候选的歌词。
 * 🔴 `text === null && !error` = **该源确实没有歌词**（正常结果，不是错误）；`error` 有值才是请求失败
 *    （弹窗据此区分「该源未找到」与「该源请求失败」，⛔ 别把两者写成同一句话）。
 */
export async function fetchLyric(http: LyricHttpGet, source: LyricSourceId, id: string): Promise<LyricFetchOutcome> {
    try {
        return { text: await ADAPTERS[source].lyric(http, id) };
    } catch (e) {
        return { text: null, error: errText(e) };
    }
}
