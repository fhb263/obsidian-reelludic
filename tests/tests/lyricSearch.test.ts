/**
 * 在线歌词检索服务层单测（2026-09-27 #396）。
 *
 * 这一层薄，但**薄在正确的地方**：它唯一的职责是「单源失败逐个降级 + 并行 + 走对 URL/请求头」。
 * 所以断言集中在三件事：
 *  ① 三源**都真的被查了**（少查一个 = 用户少一个源的歌词，而界面上完全看不出来）；
 *  ② 任一源抛错 / 非 2xx ⇒ **只影响那一源**，整次调用仍返回其余两源的结果（⛔ 不许整体失败）；
 *  ③ 每源带自己的 `Referer`（`pure` 里定义的真源）—— 缺了会被站点拒绝。
 */
import { describe, expect, it } from 'vitest';
import { LYRIC_SOURCE_HEADERS, joinKugouLyricId, type LyricCandidate } from 'pure/lyricOnline';
import { LYRIC_SOURCE_ORDER, fetchLyric, searchLyrics, type LyricHttpGet } from 'services/lyricSearch';

interface Call {
    url: string;
    headers?: Record<string, string>;
}

/** 假 HTTP：按 URL 返回响应；`undefined` 表示「这个 URL 不该被请求」 */
function makeHttp(route: (url: string) => { status: number; text: string } | undefined) {
    const calls: Call[] = [];
    const http: LyricHttpGet = async (url, headers) => {
        calls.push({ url, headers });
        const r = route(url);
        if (!r) throw new Error(`unexpected url: ${url}`);
        return r;
    };
    return { http, calls };
}

const NETEASE_OK = JSON.stringify({
    result: {
        songs: [
            { id: 2, name: '七里香 (Live)', ar: [{ name: '周杰伦' }], dt: 300000 },
            { id: 1, name: '七里香', ar: [{ name: '周杰伦' }], dt: 299000 },
        ],
    },
});
const KUWO_OK = JSON.stringify({ abslist: [{ MUSICRID: 'MUSIC_9', SONGNAME: '七里香', ARTIST: '周杰伦', DURATION: '299' }] });
const KUGOU_OK = JSON.stringify({ data: { candidates: [{ id: 'kg1', accesskey: 'ak1', song: '七里香', singer: '周杰伦', duration: 299000 }] } });
const QQ_OK = 'MusicJsonCallback(' + JSON.stringify({ data: { song: { list: [{ songmid: 'mid1', songname: '七里香', singer: [{ name: '周杰伦' }], interval: 299 }] } } }) + ');';

/** 四源都成功的最小路由 */
function allOk(url: string): { status: number; text: string } | undefined {
    if (url.includes('music.163.com/api/cloudsearch')) return { status: 200, text: NETEASE_OK };
    if (url.includes('kuwo.cn/search')) return { status: 200, text: KUWO_OK };
    if (url.includes('c.y.qq.com/soso')) return { status: 200, text: QQ_OK };
    if (url.includes('lyrics.kugou.com/search')) return { status: 200, text: KUGOU_OK };
    return undefined;
}

describe('lyricSearch · 搜索', () => {
    it('标题为空 ⇒ 一个请求都不发（调用方该在此前禁用按钮）', async () => {
        const { http, calls } = makeHttp(allOk);
        const out = await searchLyrics(http, '  ', '周杰伦');
        expect(out.query).toBeNull();
        expect(out.results).toEqual([]);
        expect(calls).toHaveLength(0);
    });

    it('🔴 四个源都真的被查了，且顺序 = LYRIC_SOURCE_ORDER', async () => {
        const { http, calls } = makeHttp(allOk);
        const out = await searchLyrics(http, '七里香', '周杰伦');
        expect(out.query).toBe('七里香 周杰伦');
        expect(calls).toHaveLength(4);
        expect(out.results.map((r) => r.source)).toEqual(LYRIC_SOURCE_ORDER);
        // #404：来源 label 走 `LYRIC_SOURCE_LABELS`，已改**简称**（网易云 / 酷我 / QQ / 酷狗）
        expect(out.results.map((r) => r.label)).toEqual(['网易云', '酷我', 'QQ', '酷狗']);
        expect(out.results.map((r) => r.candidates.length)).toEqual([2, 1, 1, 1]);
    });

    it('检索词进 URL（标题 + 作者，URL 编码）—— ⚠️ 酷狗那一路是**歌手-歌名**（#405）', async () => {
        const { http, calls } = makeHttp(allOk);
        await searchLyrics(http, '七里香', '周杰伦');
        const enc = encodeURIComponent('七里香 周杰伦');
        expect(calls[0].url).toContain(`s=${enc}`);
        expect(calls[1].url).toContain(`all=${enc}`);
        expect(calls[2].url).toContain(`w=${enc}`);
        expect(calls[3].url).toContain(`keyword=${encodeURIComponent('周杰伦-七里香')}`);
    });

    it('🔴 每源带自己的 Referer（⛔ 缺了会被站点拒绝或返回空）', async () => {
        const { http, calls } = makeHttp(allOk);
        await searchLyrics(http, '七里香');
        for (const c of calls) {
            const src = c.url.includes('163.com')
                ? 'netease'
                : c.url.includes('kuwo')
                  ? 'kuwo'
                  : c.url.includes('kugou')
                    ? 'kugou'
                    : 'qq';
            expect(c.headers).toEqual(LYRIC_SOURCE_HEADERS[src]);
            expect(c.headers?.Referer).toBeTruthy();
        }
    });

    it('🔴 候选已排序：全等标题排在同名 Live 版之前，且 `artists` 原样带出', async () => {
        const { http } = makeHttp(allOk);
        const out = await searchLyrics(http, '七里香', '周杰伦');
        const ne = out.results.find((r) => r.source === 'netease') as { candidates: LyricCandidate[] };
        expect(ne.candidates.map((c) => c.name)).toEqual(['七里香', '七里香 (Live)']);
        expect(ne.candidates[0]).toEqual({ id: '1', name: '七里香', artists: ['周杰伦'], durationSec: 299 });
    });

    it('🔴 单源抛错 ⇒ 只有该源带 error，其余源结果照旧（不许整体失败）', async () => {
        const { http } = makeHttp((url) => (url.includes('kuwo') ? undefined : allOk(url)));
        const out = await searchLyrics(http, '七里香', '周杰伦');
        expect(out.results).toHaveLength(4);
        const kuwo = out.results.find((r) => r.source === 'kuwo') as { candidates: unknown[]; error?: string };
        expect(kuwo.candidates).toEqual([]);
        expect(kuwo.error).toContain('unexpected url');
        expect(out.results.filter((r) => !r.error)).toHaveLength(3);
    });

    it('🔴 非 2xx 也当失败并报出状态码（403 的正文常是 HTML 错误页，交给解析器只会静默 0 条）', async () => {
        const { http } = makeHttp((url) => (url.includes('163.com') ? { status: 403, text: '<html>forbidden</html>' } : allOk(url)));
        const out = await searchLyrics(http, '七里香');
        const ne = out.results.find((r) => r.source === 'netease') as { error?: string };
        expect(ne.error).toBe('HTTP 403');
    });

    it('源返回 200 但结构不符 ⇒ 该源 0 条、**无 error**（「没找到」与「没查到」是两回事）', async () => {
        const { http } = makeHttp((url) => (url.includes('kuwo') ? { status: 200, text: 'not json' } : allOk(url)));
        const out = await searchLyrics(http, '七里香');
        const kuwo = out.results.find((r) => r.source === 'kuwo') as { candidates: unknown[]; error?: string };
        expect(kuwo.candidates).toEqual([]);
        expect(kuwo.error).toBeUndefined();
    });

    it('标题为空但作者非空（`buildLyricQuery` 只认标题）⇒ 同样不发请求', async () => {
        const { http, calls } = makeHttp(allOk);
        expect((await searchLyrics(http, '', '周杰伦')).query).toBeNull();
        expect(calls).toHaveLength(0);
    });
});

describe('lyricSearch · 取歌词', () => {
    const route = (url: string): { status: number; text: string } | undefined => {
        if (url.includes('music.163.com/api/song/lyric')) return { status: 200, text: JSON.stringify({ lrc: { lyric: '[00:01.00]网易云' } }) };
        if (url.includes('m.kuwo.cn')) return { status: 200, text: JSON.stringify({ data: { lrclist: [{ time: 1, lineLyric: '酷我' }] } }) };
        if (url.includes('fcg_query_lyric_new')) return { status: 200, text: 'MusicJsonCallback(' + JSON.stringify({ retcode: 0, lyric: '[00:01.00]QQ' }) + ')' };
        return undefined;
    };

    it('三源各自的歌词正文都能取到（走对 URL + 请求头）', async () => {
        const { http, calls } = makeHttp(route);
        expect(await fetchLyric(http, 'netease', '186016')).toEqual({ text: '[00:01.00]网易云' });
        expect(await fetchLyric(http, 'kuwo', '123')).toEqual({ text: '[00:01.00]酷我' });
        expect(await fetchLyric(http, 'qq', 'mid1')).toEqual({ text: '[00:01.00]QQ' });
        expect(calls[1].url).toContain('musicId=123');
        expect(calls[1].url).toContain('httpsStatus=1');
        expect(calls[2].headers).toEqual(LYRIC_SOURCE_HEADERS.qq);
    });

    it('🔴 该源没有歌词 ⇒ `text: null` 且**无 error**（正常结果，不是失败）', async () => {
        const { http } = makeHttp((url) => (url.includes('m.kuwo.cn') ? { status: 200, text: JSON.stringify({ data: { lrclist: [] } }) } : route(url)));
        expect(await fetchLyric(http, 'kuwo', '123')).toEqual({ text: null });
    });

    it('🔴 请求失败 ⇒ 带 error（弹窗文案与「未找到」不同）', async () => {
        const { http } = makeHttp((url) => (url.includes('m.kuwo.cn') ? { status: 502, text: '' } : route(url)));
        expect(await fetchLyric(http, 'kuwo', '123')).toEqual({ text: null, error: 'HTTP 502' });
    });

    it('抛异常也收成 error，⛔ 不冒泡（一次点击不该把表单打崩）', async () => {
        const { http } = makeHttp(() => undefined);
        const r = await fetchLyric(http, 'qq', 'mid1');
        expect(r.text).toBeNull();
        expect(r.error).toContain('unexpected url');
    });

    // ── 酷狗（2026-09-28 #400）──
    it('🔴 酷狗取歌词：候选 id 里带 `accesskey`，两参数都要进 URL（content 是 base64 ⇒ 解出 LRC 明文）', async () => {
        const lrc = '[00:01.00]酷狗';
        const { http, calls } = makeHttp((url) =>
            url.includes('lyrics.kugou.com/download')
                ? { status: 200, text: JSON.stringify({ content: Buffer.from(lrc, 'utf8').toString('base64') }) }
                : undefined,
        );
        expect(await fetchLyric(http, 'kugou', joinKugouLyricId('kg1', 'ak1'))).toEqual({ text: lrc });
        expect(calls[0].url).toContain('id=kg1');
        expect(calls[0].url).toContain('accesskey=ak1');
        expect(calls[0].headers).toEqual(LYRIC_SOURCE_HEADERS.kugou);
    });

    it('🔴 酷狗候选 id 缺 `accesskey` ⇒ 明确报错（⛔ 不许悄悄拼一个半截 URL 出去）', async () => {
        const { http, calls } = makeHttp(() => ({ status: 200, text: '{}' }));
        const r = await fetchLyric(http, 'kugou', 'kg1');
        expect(r.text).toBeNull();
        expect(r.error).toContain('accesskey');
        expect(calls).toHaveLength(0);
    });
});

// ── #405：酷狗的检索词形态与「0 条回退」──
//  用户报的「LRC歌词获取为什么没有酷狗的歌词」的真因：酷狗接口吃的是 **`歌手-歌名`**，
//  而接入时沿用了另外三源的「歌名 歌手」空格形态 ⇒ 酷狗**恒返回 0 条**（实测：空格 0 条 / 短横线 20 条）。
describe('searchLyrics · 酷狗检索词（#405）', () => {
    const KUGOU_EMPTY = JSON.stringify({ status: 200, data: { candidates: [] } });

    it('🔴 酷狗用「歌手-歌名」发请求（⛔ 不是另外三源的「歌名 歌手」）', async () => {
        const { http, calls } = makeHttp(allOk);
        await searchLyrics(http, '七里香', '周杰伦');
        const kg = calls.filter((c) => c.url.includes('lyrics.kugou.com/search'));
        expect(kg).toHaveLength(1);
        expect(kg[0].url).toContain('keyword=' + encodeURIComponent('周杰伦-七里香'));
        // 另外三源仍是空格形态（同一个检索词，各源自己的适配只改酷狗那一路）
        const ne = calls.find((c) => c.url.includes('music.163.com/api/cloudsearch'));
        expect(decodeURIComponent(ne!.url)).toContain('s=七里香 周杰伦');
    });

    it('🔴 酷狗「歌手-歌名」0 条 ⇒ **退回纯歌名**再试一次（库里没登记那对歌手时的兜底）', async () => {
        const seen: string[] = [];
        const { http } = makeHttp((url) => {
            if (url.includes('lyrics.kugou.com/search')) {
                const kw = decodeURIComponent((url.match(/keyword=([^&]*)/) ?? ['', ''])[1]);
                seen.push(kw);
                return { status: 200, text: kw.includes('-') ? KUGOU_EMPTY : KUGOU_OK };
            }
            if (url.includes('music.163.com/api/cloudsearch')) return { status: 200, text: NETEASE_OK };
            if (url.includes('kuwo.cn/search')) return { status: 200, text: KUWO_OK };
            if (url.includes('c.y.qq.com/soso')) return { status: 200, text: QQ_OK };
            return undefined;
        });
        const out = await searchLyrics(http, '七里香', '周杰伦');
        expect(seen).toEqual(['周杰伦-七里香', '七里香']); // 先短横线、再纯歌名
        expect(out.results.find((r) => r.source === 'kugou')?.candidates).toHaveLength(1);
    });

    it('🔴 无作者时**不**发第二次请求（第一次就是纯歌名，回退无从谈起）', async () => {
        const { http, calls } = makeHttp(allOk);
        await searchLyrics(http, '七里香', '');
        expect(calls.filter((c) => c.url.includes('lyrics.kugou.com/search'))).toHaveLength(1);
    });

    it('🔴 第一次就有结果时也**不**多发请求（只有 0 条才回退）', async () => {
        const { http, calls } = makeHttp(allOk);
        await searchLyrics(http, '七里香', '周杰伦');
        expect(calls.filter((c) => c.url.includes('lyrics.kugou.com/search'))).toHaveLength(1);
    });
});
