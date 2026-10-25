// 剧集链接失效判定纯逻辑测试（#527）：http 判定 / bvid 提取 / code 映射 / 状态码映射 / 汇总
import { describe, it, expect } from 'vitest';
import {
    bvidOf,
    buildBiliCheckUrl,
    clearDeadEpisodeUrls,
    collectLinkScanTargets,
    isDead,
    isHttpUrl,
    parseBiliCode,
    statusFromBiliCode,
    statusFromHttpStatus,
    summarizeLinkStatus,
    BILI_VIEW_API,
} from 'pure/linkStatus';

describe('isHttpUrl', () => {
    it('http/https 为真（含前后空白）', () => {
        expect(isHttpUrl('https://x/y')).toBe(true);
        expect(isHttpUrl('  http://a.b  ')).toBe(true);
    });
    it('本地路径 / 空 / 非字符串为假', () => {
        expect(isHttpUrl('视频/第1集.mp4')).toBe(false);
        expect(isHttpUrl('')).toBe(false);
        expect(isHttpUrl(undefined)).toBe(false);
        expect(isHttpUrl('ftp://x')).toBe(false);
    });
});

describe('bvidOf', () => {
    it('B 站域名里取出 BV 号', () => {
        expect(bvidOf('https://www.bilibili.com/video/BV1xx411c7mD?p=2')).toBe('BV1xx411c7mD');
        expect(bvidOf('https://b23.tv/BV1xx411c7mD')).toBe('BV1xx411c7mD');
    });
    it('🔴 非 B 站域名即使含 BV… 也不认（防误判打去 B 站接口）', () => {
        expect(bvidOf('https://example.com/BV1xx411c7mD')).toBeUndefined();
    });
    it('无 BV 号 / 非字符串 → undefined', () => {
        expect(bvidOf('https://www.bilibili.com/')).toBeUndefined();
        expect(bvidOf(undefined)).toBeUndefined();
    });
    it('补上域名边界：evilbilibili.com 不算', () => {
        expect(bvidOf('https://evilbilibili.com/video/BV1xx411c7mD')).toBeUndefined();
    });
});

describe('buildBiliCheckUrl', () => {
    it('view 接口 + bvid 参数', () => {
        expect(buildBiliCheckUrl('BV1xx411c7mD')).toBe(`${BILI_VIEW_API}?bvid=BV1xx411c7mD`);
    });
});

describe('statusFromBiliCode', () => {
    it('0 → ok；已知失效码 → dead', () => {
        expect(statusFromBiliCode(0)).toBe('ok');
        expect(statusFromBiliCode(-404)).toBe('dead');
        expect(statusFromBiliCode(-403)).toBe('dead');
        expect(statusFromBiliCode(62002)).toBe('dead');
        expect(statusFromBiliCode(62004)).toBe('dead');
    });
    it('其它码 / 非数字 → unknown（⛔ 别把未知当失效）', () => {
        expect(statusFromBiliCode(-500)).toBe('unknown');
        expect(statusFromBiliCode('0')).toBe('unknown');
        expect(statusFromBiliCode(undefined)).toBe('unknown');
    });
});

describe('parseBiliCode', () => {
    it('从 JSON 文本取 code', () => {
        expect(parseBiliCode('{"code":0,"data":{}}')).toBe(0);
        expect(parseBiliCode('{"code":-404}')).toBe(-404);
    });
    it('非 JSON / 无 code / 非字符串 → undefined', () => {
        expect(parseBiliCode('<html>风控</html>')).toBeUndefined();
        expect(parseBiliCode('{"data":{}}')).toBeUndefined();
        expect(parseBiliCode('')).toBeUndefined();
        expect(parseBiliCode(undefined)).toBeUndefined();
    });
});

describe('statusFromHttpStatus', () => {
    it('2xx/3xx → ok；404/410 → dead', () => {
        expect(statusFromHttpStatus(200)).toBe('ok');
        expect(statusFromHttpStatus(301)).toBe('ok');
        expect(statusFromHttpStatus(404)).toBe('dead');
        expect(statusFromHttpStatus(410)).toBe('dead');
    });
    it('403 / 5xx / 非数字 → unknown', () => {
        expect(statusFromHttpStatus(403)).toBe('unknown');
        expect(statusFromHttpStatus(500)).toBe('unknown');
        expect(statusFromHttpStatus(undefined)).toBe('unknown');
    });
});

describe('isDead / summarizeLinkStatus', () => {
    it('只认 dead', () => {
        expect(isDead('dead')).toBe(true);
        expect(isDead('unknown')).toBe(false);
        expect(isDead('ok')).toBe(false);
        expect(isDead(undefined)).toBe(false);
    });
    it('汇总：分档计数，undefined 不计入 checked', () => {
        expect(summarizeLinkStatus(['ok', 'dead', undefined, 'unknown', 'dead'])).toEqual({
            ok: 1,
            dead: 2,
            unknown: 1,
            checked: 4,
        });
    });
});

describe('collectLinkScanTargets（#531 全库扫描的目标收集）', () => {
    it('只收**含 http(s) 网络地址**的条目；本地路径 / 空数组 / 缺字段一律跳过', () => {
        const out = collectLinkScanTargets([
            { id: 'a', episodeUrls: ['https://www.bilibili.com/video/BV1xx411c7mD', undefined] },
            { id: 'b', episodeUrls: ['视频/第1集.mp4', ''] },
            { id: 'c', episodeUrls: [] },
            { id: 'd' },
        ]);
        expect(out.map((t) => t.entryId)).toEqual(['a']);
    });

    it('🔴 `urls` 原样保留（含空位）—— 下标必须与 `episodeUrls` 对齐，否则标红会错集', () => {
        const out = collectLinkScanTargets([{ id: 'a', episodeUrls: [undefined, 'https://x/1', undefined] }]);
        expect(out[0].urls).toEqual([undefined, 'https://x/1', undefined]);
    });

    it('不改动入参数组（拷一份）', () => {
        const src = ['https://x/1'];
        const out = collectLinkScanTargets([{ id: 'a', episodeUrls: src }]);
        expect(out[0].urls).not.toBe(src);
        expect(out[0].urls).toEqual(src);
    });
});

describe('clearDeadEpisodeUrls（一键清除，2026-10-22 用户指令）', () => {
    it('🔴 只清 `dead`：`ok` / `unknown` / 未检测一律不动（unknown 多为超时，误删风险）', () => {
        const urls = ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'];
        const out = clearDeadEpisodeUrls(urls, ['ok', 'dead', 'unknown', undefined]);
        expect(out).toEqual(['https://a/1', undefined, 'https://a/3', 'https://a/4']);
    });

    it('🔴 **保留空位（不压缩）**：清掉第 2 集不能让第 3 集前移一格', () => {
        const out = clearDeadEpisodeUrls(['u1', 'u2', 'u3'], ['ok', 'dead', 'ok']);
        expect(out).toBeDefined();
        expect(out?.[0]).toBe('u1');
        expect(out?.[2]).toBe('u3');
        // 下标 1 是洞（undefined）而不是被 u3 顶上
        expect(out?.[1]).toBeUndefined();
        expect(out?.length).toBe(3);
    });

    it('🔴 同一条 URL 填了两处：只清标了 dead 的那一位（不按 URL 反查）', () => {
        const same = 'https://same/1';
        const out = clearDeadEpisodeUrls([same, same], ['ok', 'dead']);
        expect(out).toEqual([same, undefined]);
    });

    it('没有任何 dead → undefined（调用方据此跳过写盘）', () => {
        expect(clearDeadEpisodeUrls(['u1', 'u2'], ['ok', 'unknown'])).toBeUndefined();
        expect(clearDeadEpisodeUrls(['u1'], [])).toBeUndefined();
        expect(clearDeadEpisodeUrls([], ['dead'])).toBeUndefined();
        expect(clearDeadEpisodeUrls(undefined, ['dead'])).toBeUndefined();
    });

    it('标的 dead 但该位本来就空 / 纯空白 → 不算改动', () => {
        expect(clearDeadEpisodeUrls([undefined, '  '], ['dead', 'dead'])).toBeUndefined();
    });

    it('不改动入参数组', () => {
        const src = ['u1', 'u2'];
        const out = clearDeadEpisodeUrls(src, ['ok', 'dead']);
        expect(src).toEqual(['u1', 'u2']);
        expect(out).not.toBe(src);
    });
});
