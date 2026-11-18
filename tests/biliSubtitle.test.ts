/**
 * `pure/biliSubtitle.ts` 单测：B 站字幕 JSON → cue / VTT 的纯变换。
 *
 * 数据取自真机实测（`tools/probe-bili-subtitle-cookie.mjs`，2026-11-09）：
 * 带 Cookie 请求 `x/player/wbi/v2` 拿到的真实结构。
 */
import { describe, expect, it } from 'vitest';
import {
    biliCuesToVtt,
    normalizeSubtitleUrl,
    parseBiliSubtitleBody,
    pickBiliSubtitles,
    pickPreferredSubtitle,
} from 'pure/biliSubtitle';
import { fetchBiliSubtitle, type SubtitleTransport } from 'services/biliSubtitle';

describe('normalizeSubtitleUrl', () => {
    it('协议相对地址补 https', () => {
        expect(normalizeSubtitleUrl('//aisubtitle.hdslb.com/a.json')).toBe('https://aisubtitle.hdslb.com/a.json');
    });
    it('已有协议原样返回', () => {
        expect(normalizeSubtitleUrl('https://x.com/a.json')).toBe('https://x.com/a.json');
        expect(normalizeSubtitleUrl('http://x.com/a.json')).toBe('http://x.com/a.json');
    });
    it('裸域名补 https', () => {
        expect(normalizeSubtitleUrl('x.com/a.json')).toBe('https://x.com/a.json');
    });
    it('非字符串 / 空串 → 空串', () => {
        expect(normalizeSubtitleUrl(null)).toBe('');
        expect(normalizeSubtitleUrl(42)).toBe('');
        expect(normalizeSubtitleUrl('   ')).toBe('');
    });
});

describe('pickBiliSubtitles', () => {
    it('取出真实响应里的 ai-zh 轨', () => {
        const json = {
            code: 0,
            data: {
                subtitle: {
                    subtitles: [
                        { lan: 'ai-zh', lan_doc: '中文', ai_type: 1, subtitle_url: '//aisubtitle.hdslb.com/x.json' },
                    ],
                },
            },
        };
        const got = pickBiliSubtitles(json);
        expect(got).toHaveLength(1);
        expect(got[0]).toEqual({
            lan: 'ai-zh',
            lanDoc: '中文',
            isAi: true,
            url: 'https://aisubtitle.hdslb.com/x.json',
        });
    });

    it('未登录响应（subtitles: []）→ 空数组', () => {
        expect(pickBiliSubtitles({ code: 0, data: { subtitle: { subtitles: [] } } })).toEqual([]);
    });

    it('结构缺失 / 非数组 → 空数组（不抛）', () => {
        expect(pickBiliSubtitles({ code: 0, data: {} })).toEqual([]);
        expect(pickBiliSubtitles(null)).toEqual([]);
        expect(pickBiliSubtitles({ data: { subtitle: { subtitles: 'x' } } })).toEqual([]);
    });

    it('没有 subtitle_url 的轨被丢弃（菜单里不该出现点不动的项）', () => {
        const json = { data: { subtitle: { subtitles: [{ lan: 'zh', lan_doc: '中文' }] } } };
        expect(pickBiliSubtitles(json)).toEqual([]);
    });

    it('ai_type 非 1 判为人工字幕', () => {
        const json = {
            data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文（中国）', ai_type: 0, subtitle_url: '//a/b.json' }] } },
        };
        expect(pickBiliSubtitles(json)[0]?.isAi).toBe(false);
    });
});

describe('pickPreferredSubtitle', () => {
    const ai = { lan: 'ai-zh', lanDoc: '中文', isAi: true, url: 'u1' };
    const human = { lan: 'zh-CN', lanDoc: '中文（中国）', isAi: false, url: 'u2' };
    const en = { lan: 'en-US', lanDoc: 'English', isAi: false, url: 'u3' };

    it('人工中文优先于 AI 中文', () => {
        expect(pickPreferredSubtitle([ai, human, en])).toBe(human);
    });
    it('只有 AI 中文时用 AI', () => {
        expect(pickPreferredSubtitle([en, ai])).toBe(ai);
    });
    it('没有中文时取第一条', () => {
        expect(pickPreferredSubtitle([en])).toBe(en);
    });
    it('空列表 → null', () => {
        expect(pickPreferredSubtitle([])).toBeNull();
    });
});

describe('parseBiliSubtitleBody', () => {
    it('解析真实 body 结构', () => {
        const json = {
            type: 'AIsubtitle',
            body: [
                { from: 0.02, to: 2.5, content: '第一句' },
                { from: 2.5, to: 5, content: '第二句' },
            ],
        };
        expect(parseBiliSubtitleBody(json)).toEqual([
            { start: 0.02, end: 2.5, text: '第一句' },
            { start: 2.5, end: 5, text: '第二句' },
        ]);
    });

    it('content 里的换行压成空格（面板单行布局，换行会撑爆行高）', () => {
        const json = { body: [{ from: 1, to: 2, content: '上句\n下句' }] };
        expect(parseBiliSubtitleBody(json)[0]?.text).toBe('上句 下句');
    });

    it('end <= start 的坏行丢弃', () => {
        const json = { body: [{ from: 5, to: 5, content: '零宽' }, { from: 9, to: 3, content: '倒序' }] };
        expect(parseBiliSubtitleBody(json)).toEqual([]);
    });

    it('空白内容丢弃', () => {
        const json = { body: [{ from: 1, to: 2, content: '   ' }, { from: 3, to: 4, content: '' }] };
        expect(parseBiliSubtitleBody(json)).toEqual([]);
    });

    it('from/to 非数字丢弃', () => {
        const json = { body: [{ from: 'x', to: 2, content: 'a' }, { to: 2, content: 'b' }] };
        expect(parseBiliSubtitleBody(json)).toEqual([]);
    });

    it('结构缺失 → 空数组', () => {
        expect(parseBiliSubtitleBody({})).toEqual([]);
        expect(parseBiliSubtitleBody(null)).toEqual([]);
    });

    it('保持原顺序（不排序：乱序是接口异常信号，不该被抹掉）', () => {
        const json = { body: [{ from: 10, to: 12, content: '后' }, { from: 1, to: 2, content: '前' }] };
        expect(parseBiliSubtitleBody(json).map((c) => c.text)).toEqual(['后', '前']);
    });
});

describe('biliCuesToVtt', () => {
    it('产出合法 WEBVTT 头与时间轴', () => {
        const vtt = biliCuesToVtt([{ start: 0.02, end: 2.5, text: '你好' }]);
        expect(vtt.startsWith('WEBVTT')).toBe(true);
        expect(vtt).toContain('00:00:00.020 --> 00:00:02.500');
        expect(vtt).toContain('你好');
    });

    it('超过一小时的秒数进位正确', () => {
        const vtt = biliCuesToVtt([{ start: 3661.5, end: 3663, text: '一小时' }]);
        expect(vtt).toContain('01:01:01.500 --> 01:01:03.000');
    });

    it('负时间被夹到 0', () => {
        const vtt = biliCuesToVtt([{ start: -3, end: 1, text: '负' }]);
        expect(vtt).toContain('00:00:00.000 --> 00:00:01.000');
    });

    it('空列表只有 WEBVTT 头', () => {
        expect(biliCuesToVtt([]).trim()).toBe('WEBVTT');
    });
});

/**
 * `services/biliSubtitle.ts` 的 `onDiag` —— 只测「B 站认不认登录」这个判据。
 *
 * 🔴 回归目标（2026-10-31 事故）：未登录时 `x/player/wbi/v2` 回 `login_mid: 0` +
 *    `need_login_subtitle: true` + `subtitles: []`，与「登录了但这集没字幕」形状几乎一样。
 *    以前一律 `return null`，用户只看到「这一集没有字幕」，会以为视频没字幕而反复粘 Cookie。
 *    现在必须把 `loginMid` 报出去，让宿主能弹「Cookie 已失效」。
 */
describe('fetchBiliSubtitle 的 onDiag（登录态判据）', () => {
    /** 按固定 JSON 应答的传输桩；同时记录每条请求，方便断言没发多余的请求 */
    function stubTransport(listJson: unknown, bodyJson: unknown = null): { t: SubtitleTransport; calls: string[] } {
        const calls: string[] = [];
        const t: SubtitleTransport = {
            get: async (url: string) => {
                calls.push(url);
                if (calls.length === 1) {
                    return { status: 200, text: typeof listJson === 'string' ? listJson : JSON.stringify(listJson) };
                }
                return { status: 200, text: JSON.stringify(bodyJson ?? { body: [] }) };
            },
        };
        return { t, calls };
    }

    /** 未登录形态：与真机实测逐字一致 */
    const ANON_LIST = {
        code: 0,
        data: {
            login_mid: 0,
            need_login_subtitle: true,
            subtitle: { allow_submit: false, lan: '', lan_doc: '', subtitles: [], subtitle_position: null, font_size_type: 0 },
        },
    };

    /** 登录形态：一条人工中文轨 */
    const LOGIN_LIST = {
        code: 0,
        data: {
            login_mid: 1828315053,
            need_login_subtitle: false,
            subtitle: {
                subtitles: [
                    {
                        id: 1, lan: 'zh-CN', lan_doc: '中文（中国）', is_lock: 0, author_mid: 1,
                        subtitle_url: 'https://aisubtitle.hdslb.com/a.json', type: 0, ai_type: 0, ai_status: 0,
                    },
                ],
            },
        },
    };

    it('未登录（login_mid=0 + 空字幕）⇒ 报 loginMid:0 且返回 null', async () => {
        const { t } = stubTransport(ANON_LIST);
        const seen: Array<{ loginMid: number; trackCount: number; needLogin: boolean }> = [];
        const got = await fetchBiliSubtitle(t, 137649199, 'BV1GJ411x7h7', 'SESSDATA=x', (d) => seen.push(d));
        expect(got).toBeNull();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual({ loginMid: 0, trackCount: 0, needLogin: true });
    });

    it('已登录但这一集没字幕 ⇒ 同样返回 null，但 loginMid 非 0（宿主据此不误报 Cookie 失效）', async () => {
        const { t } = stubTransport({ code: 0, data: { login_mid: 1828315053, need_login_subtitle: false, subtitle: { subtitles: [] } } });
        const seen: Array<{ loginMid: number; trackCount: number; needLogin: boolean }> = [];
        const got = await fetchBiliSubtitle(t, 1, 'BV1GJ411x7h7', 'SESSDATA=x', (d) => seen.push(d));
        expect(got).toBeNull();
        expect(seen[0].loginMid).toBe(1828315053);
        expect(seen[0].trackCount).toBe(0);
    });

    it('有字幕 ⇒ 报 trackCount>0 并返回 VTT', async () => {
        const { t } = stubTransport(LOGIN_LIST, { body: [{ from: 0, to: 1.5, content: '你好' }] });
        const seen: Array<{ loginMid: number; trackCount: number; needLogin: boolean }> = [];
        const got = await fetchBiliSubtitle(t, 1, 'BV1GJ411x7h7', 'SESSDATA=x', (d) => seen.push(d));
        expect(got).not.toBeNull();
        expect(got?.text).toContain('WEBVTT');
        expect(got?.text).toContain('你好');
        expect(seen[0]).toEqual({ loginMid: 1828315053, trackCount: 1, needLogin: false });
    });

    it('风控给 HTML（JSON 解析炸）⇒ 静默 null，⛔ 不回调（没证据就别妄下「Cookie 失效」结论）', async () => {
        const { t, calls } = stubTransport('<html>风控</html>');
        const seen: unknown[] = [];
        const got = await fetchBiliSubtitle(t, 1, 'BV1GJ411x7h7', 'SESSDATA=x', (d) => seen.push(d));
        expect(got).toBeNull();
        expect(seen).toHaveLength(0);
        expect(calls).toHaveLength(1);
    });

    it('没带 Cookie ⇒ 直接 null，一次请求都不发、也不回调', async () => {
        const { t, calls } = stubTransport(ANON_LIST);
        const seen: unknown[] = [];
        const got = await fetchBiliSubtitle(t, 1, 'BV1GJ411x7h7', '', (d) => seen.push(d));
        expect(got).toBeNull();
        expect(calls).toHaveLength(0);
        expect(seen).toHaveLength(0);
    });
});
