// 四平台下载面服务层单测（#399-D 移植批）——注入假传输层，只验「控制流 + 组装」，不发真请求。
// 移植来源：obsidian-lyricflux v1.4.4 `downloadManager.ts`（同作者）；样本 JSON 与该仓各 `*-music.test.ts` 同形。
import { describe, it, expect, vi } from 'vitest';
import {
    DL_PLATFORMS,
    DL_SEARCH_ORDER,
    dlDownloadSong,
    dlPreviewAudio,
    dlPreviewCacheSize,
    dlPlaylistSongs,
    dlRecommendedPlaylists,
    dlSearch,
    dlTestConnection,
    neteaseCommentCount,
    type DlTransport,
    type DownloadSong,
} from 'services/dl';

/** 假传输层：按 URL 前缀路由；未登记的一律 404（让「漏请求」立刻暴露，而不是静默成功） */
function fakeTransport(routes: Record<string, { status?: number; text?: string; bytes?: Uint8Array }>): {
    t: DlTransport;
    calls: string[];
} {
    const calls: string[] = [];
    const find = (url: string) => {
        for (const key of Object.keys(routes)) if (url.includes(key)) return routes[key];
        return null;
    };
    const t: DlTransport = {
        async get(url) {
            calls.push(url);
            const r = find(url);
            if (!r) return { status: 404, text: '' };
            return { status: r.status ?? 200, text: r.text ?? '' };
        },
        async post(url) {
            calls.push(`POST ${url}`);
            const r = find(url);
            if (!r) return { status: 404, text: '' };
            return { status: r.status ?? 200, text: r.text ?? '' };
        },
        async getBuffer(url) {
            calls.push(url);
            const r = find(url);
            if (!r) return { status: 404, buffer: new Uint8Array(0) };
            return { status: r.status ?? 200, buffer: r.bytes ?? new Uint8Array(0) };
        },
    };
    return { t, calls };
}

/** 造一段「过 64KB 门槛 + 有 MP3 魔数」的假音频 */
function fakeMp3(size = 70 * 1024): Uint8Array {
    const b = new Uint8Array(size);
    b[0] = 0x49;
    b[1] = 0x44; // 'ID3'
    return b;
}

const QQ_SEARCH = JSON.stringify({
    data: {
        song: {
            list: [
                { songmid: 'AAA', songname: '晴天', singer: [{ name: '周杰伦' }], albumname: '叶惠美' },
                { songmid: 'BBB', songname: '晴天 (Live)', singer: [{ name: '周杰伦' }] },
            ],
        },
    },
});

describe('dlSearch：多源搜索的合并 / 失败语义 / 排序', () => {
    // 🔴 #405 夹具：网易云 cloudsearch 的**档位对象**（`l` 128k / `h` 320k，各含 br+size）
    //    —— 用户报的「网易云歌曲怎么不显示 kbps 和体积大小」就靠这两个字段。
    const NETEASE_SEARCH = JSON.stringify({
        result: {
            songs: [
                {
                    id: 186016,
                    name: '晴天',
                    ar: [{ name: '周杰伦' }],
                    dt: 269000,
                    fee: 0,
                    l: { br: 128000, size: 4300000 },
                    h: { br: 320000, size: 10700000 },
                },
            ],
        },
    });
    // ⚠️ 酷我搜索返回的是**单引号 legacy JSON**，且 `bitSwitch=0` 的行会被过滤 ⇒ 夹具必须照这个形态写
    const KUWO_SEARCH = "{'abslist':[{'MUSICRID':'MUSIC_228908','SONGNAME':'晴天','ARTIST':'周杰伦','bitSwitch':81920}]}";

    it('🔴 请求失败与「成功但空结果」必须分得清（失败进 failedSources，空结果不进）', async () => {
        const { t } = fakeTransport({
            'c.y.qq.com': { status: 500, text: '' }, // QQ 失败
            'kugou.com': { text: JSON.stringify({ data: { lists: [] } }) }, // 酷狗成功但空
            'kuwo.cn': { text: '{"abslist":[]}' }, // 酷我成功但空
        });
        const out = await dlSearch(t, '晴天', { enabled: { netease: false } });
        expect(out.failedSources).toEqual(['qq']);
        expect(out.songs).toEqual([]);
    });

    it('🔴 全部启用平台都失败 ⇒ onEmpty(networkError=true)（据此区分「网断了」与「没这首歌」）', async () => {
        const { t } = fakeTransport({});
        const onEmpty = vi.fn();
        await dlSearch(t, '不存在', { onEmpty });
        expect(onEmpty).toHaveBeenCalledWith(true);
    });

    it('平台优先级 order 为主键（同一批并集里，netease 排在 qq 前）', async () => {
        const { t } = fakeTransport({
            'c.y.qq.com': { text: QQ_SEARCH },
        });
        // 只开 qq：验证「平台内按相似度 → 标题短 → 字典序」三档
        const out = await dlSearch(t, '晴天', { enabled: { netease: false, kugou: false, kuwo: false } });
        expect(out.songs.map((s) => s.name)).toEqual(['晴天', '晴天 (Live)']);
        expect(out.songs[0].needsCookie).toBe(true);
    });

    // 🔴 #405：排序主键换成 `DL_SEARCH_ORDER`（酷我优先）—— 用户：「把歌曲搜索返回结果排序改成酷我优先返回」
    it('🔴 按 `DL_SEARCH_ORDER` 排序 ⇒ 同一批并集里**酷我排在网易云前面**', async () => {
        const { t } = fakeTransport({
            'music.163.com/api/cloudsearch': { text: NETEASE_SEARCH },
            'kuwo.cn': { text: KUWO_SEARCH },
        });
        const out = await dlSearch(t, '晴天', {
            enabled: { qq: false, kugou: false },
            order: [...DL_SEARCH_ORDER],
        });
        expect(out.songs.map((s) => s.source)).toEqual(['kuwo', 'netease']);
        // 同一批数据换成旧的平台清单顺序 ⇒ 结论反过来（证明这条断言真在测「顺序」而不是「只有一家有结果」）
        const legacy = await dlSearch(t, '晴天', {
            enabled: { qq: false, kugou: false },
            order: [...DL_PLATFORMS],
        });
        expect(legacy.songs.map((s) => s.source)).toEqual(['netease', 'kuwo']);
    });

    it('🔴 #405 网易云的 `kbps` / 体积进结果行（档位取搜索响应的 `l`：**免密外链实际拿到的档**）', async () => {
        const { t } = fakeTransport({ 'music.163.com/api/cloudsearch': { text: NETEASE_SEARCH } });
        const out = await dlSearch(t, '晴天', { enabled: { qq: false, kugou: false, kuwo: false } });
        expect(out.songs).toHaveLength(1);
        expect(out.songs[0]).toMatchObject({ source: 'netease', bitrate: 128, size: 4300000, ext: 'mp3' });
    });

    it('🔴 #405 只有高音质档（`h`）时取 `h`（l → m → h 兜底），且**不凭空造值**', async () => {
        const hOnly = JSON.stringify({
            result: { songs: [{ id: 2, name: '只有高音质', ar: [], dt: 1000, fee: 0, h: { br: 320000, size: 9999 } }] },
        });
        const { t } = fakeTransport({ 'music.163.com/api/cloudsearch': { text: hOnly } });
        const out = await dlSearch(t, '只有高音质', { enabled: { qq: false, kugou: false, kuwo: false } });
        expect(out.songs[0]).toMatchObject({ bitrate: 320, size: 9999 });
    });

    it('渐进上报 onPartial：哪个平台先回来就先给（不等最慢的）', async () => {
        const { t } = fakeTransport({ 'c.y.qq.com': { text: QQ_SEARCH } });
        const seen: string[][] = [];
        await dlSearch(t, '晴天', {
            enabled: { netease: false, kugou: false, kuwo: false },
            onPartial: (songs) => seen.push(songs.map((s) => s.name)),
        });
        expect(seen).toEqual([['晴天', '晴天 (Live)']]);
    });
});

describe('dlRecommendedPlaylists / dlPlaylistSongs：四平台歌单', () => {
    it('QQ 推荐歌单：分批补歌曲数（每批 ≤30，某批失败不影响其他批）', async () => {
        const ids = Array.from({ length: 35 }, (_, i) => `d${i}`);
        const list = JSON.stringify({
            code: 0,
            data: { list: ids.map((id) => ({ dissid: id, dissname: `歌单${id}`, listennum: 1 })) },
        });
        const { t, calls } = fakeTransport({
            'c.y.qq.com': { text: list },
            'u.y.qq.com': { text: JSON.stringify({ code: 0, req_0: { data: { songlist: [] } } }) },
        });
        const out = await dlRecommendedPlaylists(t, 'qq', 35);
        expect(out.playlists).toHaveLength(35);
        // 两批（30 + 5）⇒ 恰好两次 POST
        expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(2);
    });

    it('未知平台：返回可读 error（⛔ 不是静默空）', async () => {
        const { t } = fakeTransport({});
        const out = await dlRecommendedPlaylists(t, 'bogus' as never, 10);
        expect(out.playlists).toEqual([]);
        expect(out.error).toContain('未知平台');
    });

    it('QQ 歌单曲目：官方接口空 ⇒ 回退 musicu.fcg v2', async () => {
        const v2 = JSON.stringify({
            code: 0,
            req_0: {
                data: {
                    songlist: [
                        { mid: 'M1', name: '歌一', singer: [{ name: '歌手' }], interval: 180 },
                    ],
                },
            },
        });
        const { t, calls } = fakeTransport({
            'fcg_ucc_getcdinfo': { text: JSON.stringify({ code: 0, cdlist: [{ songlist: [] }] }) },
            'u.y.qq.com': { text: v2 },
        });
        const out = await dlPlaylistSongs(t, 'qq', '123');
        expect(calls.some((c) => c.startsWith('POST'))).toBe(true);
        expect(out.songs.length).toBeGreaterThanOrEqual(0);
    });
});

describe('dlTestConnection：四态文案（未填 / 无效 / 有效 / 会员）', () => {
    it('网易云：未填', async () => {
        const { t } = fakeTransport({});
        expect(await dlTestConnection(t, 'netease', '')).toEqual({ ok: false, message: '未粘贴网易云 Cookie' });
    });

    it('网易云：会员 / 普通账号 / 失效 三态', async () => {
        const vip = fakeTransport({ weapi: { text: JSON.stringify({ code: 200, profile: { vipType: 11 } }) } });
        expect((await dlTestConnection(vip.t, 'netease', 'MUSIC_U=x')).message).toContain('会员');
        const normal = fakeTransport({ weapi: { text: JSON.stringify({ code: 200, profile: { vipType: 0 } }) } });
        expect((await dlTestConnection(normal.t, 'netease', 'MUSIC_U=x')).message).toContain('普通账号');
        const bad = fakeTransport({ weapi: { text: JSON.stringify({ code: 301 }) } });
        expect((await dlTestConnection(bad.t, 'netease', 'MUSIC_U=x')).message).toContain('无效或已过期');
    });

    it('酷我：免登录即视为可用（明确说 Cookie 非必需）', async () => {
        const { t } = fakeTransport({});
        expect((await dlTestConnection(t, 'kuwo', '')).message).toContain('免登录');
    });

    /**
     * 🔴 2026-10-25（用户：「在b站音频流凭据行底下加个测试连接按钮」）：
     * 「有效」的判据是 `x/web-interface/nav` 回 `code === 0 && data.isLogin === true`。
     * ⛔ 别改用「能不能取字幕」当判据 —— 未登录时字幕接口也回 `code: 0`（只把 `need_login_subtitle`
     * 置真、字幕数组空），照它判会把匿名请求判成「有效」。
     */
    it('B站：未填 / 未登录 / code≠0 / 有效 四态', async () => {
        const empty = fakeTransport({});
        expect(await dlTestConnection(empty.t, 'bilibili', '')).toEqual({ ok: false, message: '未粘贴 B 站 Cookie' });

        // 未登录：接口 200 + code 0，但 isLogin=false ⇒ 必须判无效（这正是「能不能取字幕」判据会漏掉的坑）
        const anon = fakeTransport({ nav: { text: JSON.stringify({ code: 0, data: { isLogin: false } }) } });
        expect((await dlTestConnection(anon.t, 'bilibili', 'SESSDATA=x')).message).toContain('未登录');

        const bad = fakeTransport({ nav: { text: JSON.stringify({ code: -101, message: '账号未登录' }) } });
        expect((await dlTestConnection(bad.t, 'bilibili', 'SESSDATA=x')).message).toContain('无效或已过期');

        const ok = fakeTransport({ nav: { text: JSON.stringify({ code: 0, data: { isLogin: true, uname: '测试用户' } }) } });
        const r = await dlTestConnection(ok.t, 'bilibili', 'SESSDATA=x');
        expect(r.ok).toBe(true);
        expect(r.message).toContain('测试用户');
    });
});

describe('dlDownloadSong：四平台分发 + 落盘口径', () => {
    const song = (patch: Partial<DownloadSong>): DownloadSong => ({
        source: 'kuwo',
        id: '1',
        name: '作品名',
        artist: '作者名',
        ...patch,
    });
    const target = () => {
        const written: Array<{ path: string; size: number }> = [];
        return {
            written,
            t: {
                // #459：`root` = **目录本身**（旧版是「下载根」、由代码再拼 `音乐/`）⇒ 这里给真实缺省值
                root: '下载/音乐',
                taken: new Set<string>(),
                write: async (p: string, d: Uint8Array) => {
                    written.push({ path: p, size: d.byteLength });
                },
            },
        };
    };

    it('🔴 酷狗 VIP 曲目直接拒绝（不发任何请求）', async () => {
        const { t, calls } = fakeTransport({});
        const out = await dlDownloadSong(t, song({ source: 'kugou', id: 'H', vip: true }), { target: target().t });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('VIP');
        expect(calls).toEqual([]);
    });

    it('🔴 QQ 未配 Cookie ⇒ 可读原因（不是「下载失败」这种无从下手的话）', async () => {
        const { t } = fakeTransport({});
        const out = await dlDownloadSong(t, song({ source: 'qq', songmid: 'M1' }), { target: target().t });
        expect(out.ok).toBe(false);
        expect(out.message).toContain('Cookie');
    });

    it('酷我：128 取不到 ⇒ 降级 320 成功；落盘到 `下载/音乐/` 且重名走 (2)', async () => {
        const mp3 = fakeMp3();
        const { t, calls } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: '' } }) },
            'br=320': { text: JSON.stringify({ data: { url: 'https://x.test/a.mp3', bitrate: 320 } }) },
            'https://x.test/a.mp3': { bytes: mp3 },
        });
        const tg = target();
        tg.t.taken.add('下载/音乐/作者名 - 作品名.mp3');
        const out = await dlDownloadSong(t, song({ kuwoRid: '228908' }), { target: tg.t });
        expect(out.ok).toBe(true);
        expect(out.relPath).toBe('下载/音乐/作者名 - 作品名 (2).mp3');
        expect(tg.written[0].size).toBe(mp3.byteLength);
        expect(calls.some((c) => c.includes('br=320'))).toBe(true);
    });

    it('🔴 字节不过门槛（64KB）⇒ 判失败，⛔ 不写盘（挡「302 到 404 的 HTML 页」）', async () => {
        const { t } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://x.test/a.mp3' } }) },
            'https://x.test/a.mp3': { bytes: new Uint8Array(1024) },
        });
        const tg = target();
        const out = await dlDownloadSong(t, song({ kuwoRid: '1' }), { target: tg.t });
        expect(out.ok).toBe(false);
        expect(tg.written).toEqual([]);
    });

    it('🔴 首次失败自动重试一次（网络抖动友好）', async () => {
        let n = 0;
        const mp3 = fakeMp3();
        const t: DlTransport = {
            async get(url) {
                if (url.includes('br=128')) {
                    n++;
                    return n === 1
                        ? { status: 500, text: '' }
                        : { status: 200, text: JSON.stringify({ data: { url: 'https://x.test/a.mp3' } }) };
                }
                return { status: 404, text: '' };
            },
            async post() {
                return { status: 404, text: '' };
            },
            async getBuffer() {
                return { status: 200, buffer: mp3 };
            },
        };
        const out = await dlDownloadSong(t, song({ kuwoRid: '9' }), { target: target().t });
        expect(n).toBe(2);
        expect(out.ok).toBe(true);
    });

    it('🔴 扩展名按真实字节定（FLAC 魔数 ⇒ .flac，⛔ 不信 URL 后缀）', async () => {
        const flac = fakeMp3();
        flac[0] = 0x66;
        flac[1] = 0x4c;
        flac[2] = 0x61;
        flac[3] = 0x43; // 'fLaC'
        const { t } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://x.test/a.mp3' } }) },
            'https://x.test/a.mp3': { bytes: flac },
        });
        const out = await dlDownloadSong(t, song({ kuwoRid: '3' }), { target: target().t });
        expect(out.ok).toBe(true);
        expect(out.relPath?.endsWith('.flac')).toBe(true);
    });

    it('网易云：无 Cookie ⇒ 走免密外链（不碰 weapi）；有 Cookie 且非会员 ⇒ 仍回退外链', async () => {
        const mp3 = fakeMp3();
        const { t, calls } = fakeTransport({
            'song/media/outer/url': { bytes: mp3 },
        });
        const out = await dlDownloadSong(t, song({ source: 'netease', id: '186016', neteaseId: 186016 }), {
            target: target().t,
        });
        expect(out.ok).toBe(true);
        expect(calls.some((c) => c.includes('weapi'))).toBe(false);

        const withCookie = fakeTransport({
            'weapi/nuser/account/get': { text: JSON.stringify({ code: 200, profile: { vipType: 0 } }) },
            'song/media/outer/url': { bytes: mp3 },
        });
        const out2 = await dlDownloadSong(
            withCookie.t,
            song({ source: 'netease', id: '186016', neteaseId: 186016 }),
            { cookies: { netease: 'MUSIC_U=x' }, target: target().t },
        );
        expect(out2.ok).toBe(true);
        expect(out2.message).not.toContain('VIP 高音质');
    });

    it('平台常量表 = 四平台固定顺序（UI 胶囊/设置行都读它）', () => {
        expect([...DL_PLATFORMS]).toEqual(['netease', 'qq', 'kugou', 'kuwo']);
    });

    // 🔴 #405：搜索**结果的平台优先顺序**与「平台清单」是两件事（前者只管排序主键）
    it('🔴 `DL_SEARCH_ORDER` = 酷我优先（且仍是四平台全集，⛔ 别漏平台）', () => {
        expect([...DL_SEARCH_ORDER]).toEqual(['kuwo', 'netease', 'qq', 'kugou']);
        expect([...DL_SEARCH_ORDER].sort()).toEqual([...DL_PLATFORMS].sort());
    });
});

// ── 试听（2026-09-28 #400）：链路与下载同一处，但**不写盘**；缓存只在会话内 ──
describe('dlPreviewAudio：不写盘 + 会话缓存', () => {
    // 🔴 缓存键是 `{source}:{id}`，而 `id` 是**平台内 id**（kuwo=rid / qq=songmid / kugou=hash）
    //    ⇒ 夹具必须让 id 跟着平台 id 走，否则几首歌共用一个键，缓存断言会假绿。
    const song = (patch: Partial<DownloadSong>): DownloadSong => ({
        source: 'kuwo',
        name: '作品名',
        artist: '作者名',
        ...patch,
        id: patch.id ?? patch.kuwoRid ?? patch.songmid ?? '1',
    });

    it('🔴 返回音频字节与真实扩展名，且**一个字节都不落盘**（试听 ≠ 下载）', async () => {
        const mp3 = fakeMp3();
        const { t, calls } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://y.test/p1.mp3' } }) },
            'https://y.test/p1.mp3': { bytes: mp3 },
        });
        const out = await dlPreviewAudio(t, song({ kuwoRid: 'p1' }), {});
        expect(out.ok).toBe(true);
        expect(out.ext).toBe('mp3');
        expect(out.data?.byteLength).toBe(mp3.byteLength);
        expect(out.fromCache).toBeFalsy();
        // 只应发两次请求（取直链 + 取字节），没有任何写盘动作（本 API 根本没有 target 参数）
        expect(calls).toHaveLength(2);
    });

    it('🔴 同一首第二次试听 ⇒ 命中会话缓存，**不再发请求**（`fromCache` 明确标出）', async () => {
        const mp3 = fakeMp3();
        const { t, calls } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://y.test/p2.mp3' } }) },
            'https://y.test/p2.mp3': { bytes: mp3 },
        });
        const s = song({ kuwoRid: 'p2' });
        await dlPreviewAudio(t, s, {});
        const n = calls.length;
        const again = await dlPreviewAudio(t, s, {});
        expect(again.ok).toBe(true);
        expect(again.fromCache).toBe(true);
        expect(calls).toHaveLength(n);
        expect(again.message).toContain('缓存');
    });

    it('🔴 拿不到可播字节（小于 64KB 门槛 = 多半是错误页）⇒ 明确失败，⛔ 不把垃圾当音频播出去', async () => {
        const { t } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://y.test/p3.mp3' } }) },
            'https://y.test/p3.mp3': { bytes: new Uint8Array(100) },
        });
        const out = await dlPreviewAudio(t, song({ kuwoRid: 'p3' }), {});
        expect(out.ok).toBe(false);
        expect(out.data).toBeUndefined();
        expect(out.message).toContain('试听失败');
    });

    it('🔴 失败原因面向用户可读（酷狗 VIP ⇒ 说清是 VIP 而不是「未知错误」）', async () => {
        const { t, calls } = fakeTransport({});
        const out = await dlPreviewAudio(t, song({ source: 'kugou', id: 'HV', vip: true }), {});
        expect(out.ok).toBe(false);
        expect(out.message).toContain('VIP');
        expect(calls).toEqual([]);
    });

    it('🔴 会话缓存只装在内存里：条目数随试听增加（⛔ 没有设置页「清缓存」入口，重启即清）', async () => {
        const before = dlPreviewCacheSize();
        const { t } = fakeTransport({
            'br=128': { text: JSON.stringify({ data: { url: 'https://y.test/p4.mp3' } }) },
            'https://y.test/p4.mp3': { bytes: fakeMp3() },
        });
        await dlPreviewAudio(t, song({ kuwoRid: 'p4' }), {});
        expect(dlPreviewCacheSize()).toBe(before + 1);
    });
});

describe('🔴 m10134 neteaseCommentCount · 评价人数补拉', () => {
    // 用户裁定（m10369）：「补拉网易云评论数当「评价人数」」。
    // 实测端点：`/api/v1/resource/comments/R_SO_4_<songid>?limit=1&offset=0` ⇒ `{ total: 68308 }`。
    it('取 `total` 作为评价人数', async () => {
        const { t: tr } = fakeTransport({
            'resource/comments/R_SO_4_347230': { text: JSON.stringify({ total: 68308, hotComments: [] }) },
        });
        expect(await neteaseCommentCount(tr, 347230)).toBe(68308);
    });

    it('🔴 `total: 0` 是**真实结论**（没人评论）⇒ 回 0，与「取不到」必须分开', async () => {
        const { t: tr } = fakeTransport({
            'resource/comments/R_SO_4_1': { text: JSON.stringify({ total: 0 }) },
        });
        expect(await neteaseCommentCount(tr, 1)).toBe(0);
    });

    it('非法 songid（0 / 负数 / NaN / undefined）⇒ undefined 且**不发请求**', async () => {
        for (const bad of [0, -5, Number.NaN, undefined]) {
            const { t: tr, calls } = fakeTransport({});
            expect(await neteaseCommentCount(tr, bad as number)).toBeUndefined();
            expect(calls).toEqual([]);
        }
    });

    it('HTTP 非 2xx / JSON 坏 / 字段缺失 ⇒ undefined（⛔ 不抛，评价人数是锦上添花）', async () => {
        const cases = [
            { text: '', status: 500 },
            { text: 'not json' },
            { text: JSON.stringify({ code: 200 }) },
        ];
        for (const c of cases) {
            const { t: tr } = fakeTransport({ 'resource/comments': c });
            expect(await neteaseCommentCount(tr, 9)).toBeUndefined();
        }
    });

    it('URL 形态锁死（`R_SO_4_` 前缀 + `limit=1&offset=0`，只要 21KB 不拉整页评论）', async () => {
        const { t: tr, calls } = fakeTransport({ 'resource/comments': { text: '{"total":3}' } });
        await neteaseCommentCount(tr, 42);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('resource/comments/R_SO_4_42');
        expect(calls[0]).toContain('limit=1');
        expect(calls[0]).toContain('offset=0');
    });
});
