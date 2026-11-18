/**
 * 🔴 pickYtCaption 的 `tlang` 纪律（2026-11-10 真机 A/B 定的）：
 *   同一条 timedtext，`fmt=vtt` / `json3` / 无 fmt / `srv3` **只要带 `tlang` 就 429**；
 *   **去掉 `tlang` ⇒ 200 / 14807 字节 WEBVTT**。
 *   ⇒ 触发限流的是机器翻译那条路，不是 IP 级限流、也不是 fmt。
 *   所以：优先原始轨；只剩翻译轨时剥 `tlang` 取原文，且 `lang` 必须改报 URL 里的真语言，
 *   否则面板会把英文正文标成「中文」。
 */
import { describe, expect, it } from 'vitest';

import { pickYtCaption, type YtInfo } from '../src/pure/youtube';

/** 一条字幕轨（⚠️ `pickYtCaption` 要的是**轨数组**，⛔ 别再在外面套一层数组） */
const one = (u: string) => ({ ext: 'vtt', url: u });
const only = (u: string) => [one(u)];

const TTLANG_EN = 'https://www.youtube.com/api/timedtext?v=abc&kind=asr&lang=en&tlang=zh-Hans&fmt=vtt&signature=SIG%2C1';
const ORIGINAL_EN = 'https://www.youtube.com/api/timedtext?v=abc&kind=asr&lang=en&fmt=vtt&signature=SIG%2C1';
const ORIGINAL_ZH = 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-Hans&fmt=vtt&signature=SIG%2C1';

describe('pickYtCaption —— tlang 翻译轨（带 tlang 的路 429，必须剥）', () => {
    it('同档语言里优先原始轨（不带 tlang），翻译轨让位', () => {
        const got = pickYtCaption({
            automatic_captions: { 'zh-hans': [one(TTLANG_EN), one(ORIGINAL_EN)] },
        } as unknown as YtInfo);
        expect(got?.url).toBe(ORIGINAL_EN);
    });

    it('只剩翻译轨 ⇒ 剥掉 tlang，但签名等其余参数逐字节不动', () => {
        const got = pickYtCaption({
            automatic_captions: { 'zh-hans': only(TTLANG_EN) },
        } as unknown as YtInfo);
        expect(got?.url).not.toContain('tlang=');
        expect(got?.url).toContain('signature=SIG%2C1');
        expect(got?.url).toContain('kind=asr');
        expect(got?.url).toContain('fmt=vtt');
    });

    it('剥 tlang 后 lang 改报 URL 里的真语言（en），不许把英文正文标成中文', () => {
        const got = pickYtCaption({
            automatic_captions: { 'zh-hans': only(TTLANG_EN) },
        } as unknown as YtInfo);
        expect(got?.lang).toBe('en');
    });

    it('tlang 在首参数位也能剥干净，不拼出坏 URL', () => {
        const got = pickYtCaption({
            subtitles: { zh: only('https://x.test/api/timedtext?tlang=zh-Hans&v=abc') },
        } as unknown as YtInfo);
        expect(got?.url).toBe('https://x.test/api/timedtext?v=abc');
    });

    it('原始中文轨照旧命中，且 lang 是中文', () => {
        const got = pickYtCaption({ subtitles: { 'zh-Hans': only(ORIGINAL_ZH) } } as unknown as YtInfo);
        expect(got?.url).toBe(ORIGINAL_ZH);
        expect(got?.lang).toBe('zh-Hans');
        expect(got?.isAuto).toBe(false);
    });

    it('URL 里没有 lang= 时 lang 回落成表里的 key（不猜）', () => {
        const got = pickYtCaption({ subtitles: { 'zh-CN': only('https://x.test/a.vtt') } } as unknown as YtInfo);
        expect(got?.lang).toBe('zh-CN');
    });
});
