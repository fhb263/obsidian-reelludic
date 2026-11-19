// 歌词「同源顺延」行为测试（2026-11-19 m14228 ①）。
//
// 用户报障逐字：「为什么我明明搜索到出来源LRC歌词了，点击就说该源没有歌词」。
// 实测根因（探针取证）：同源不同版本**有没有歌词完全不同** ——
//   · 网易云《七里香》`limit=50` 时原版 `186016` 排第 65 名、压根不在候选里，
//     排前面三条翻唱（王俊凯 MV 版 / 吉拉朵女声版 / BFH beats）`lyricLen` 全是 **0**；
//   · 酷我 `songinfoandlrc?musicId=94237` 恒返 `{"status":301,"msg":"音乐查询失败"}`（连打 5 次一致），
//     同一接口对 `rid=324953` 却正常返 58 行。
// ⇒ 修法不是改解析器（那是对的：没有歌词就该返 null），而是**点「填入」失败时在同源里顺延重试**。
//
// 🔴 为什么用源码级判据（而不是 jsdom 挂载整套 EntryForm）：
//    `applyLyrics` 的入参 `onLoadLyric` 是宿主注入的异步函数，要真挂载就得连带造出整个编辑表单
//    （条目、字段规格、豆瓣回填、歌曲库搜索…），成本远超收益。所以这里退一步，**按可控性最高的方式**做：
//    把「顺序」（error 分支必须在顺延之前）、「范围」（只在同源内、只往后不回头）、
//    「上限」（有限值）、「成功后的副作用」（清错误 + 给 Notice）逐条钉死在源码结构上。
// ⚠️ 诚实的局限：这组判据抓不到「运行时分支真的按预期走」。它靠**变异验证**兜底 ——
//    改坏 `error` 分支顺序 / 去掉 `slice(at + 1)` / 把上限放大，都会立刻红（已实测）。
//    真正跑通顺延要看真机（`.testvault` 点《七里香》那些翻唱候选）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FORM = 'src/views/components/EntryForm.svelte';

/**
 * 从源码里抠出 `applyLyrics` 的函数体（供静态断言用）。
 *
 * ⚠️ 不能用「找 `\n    }\n`」这种行尾锚 —— 本仓源码是 **CRLF**，`\n` 前后都带 `\r`，
 *    第一版就因此拿到 `end = -1` 直接把整个测试文件炸掉（`expected -1 to be greater than 60598`）。
 * ⇒ 改成**大括号配对**：从函数名之后第一个 `{` 起算，遇到 `{` +1、`}` -1，归零即函数体结束。
 *    这样既不吃换行格式，也不会被函数体内的模板字符串大括号提前截断（`${…}` 里的括号成对出现）。
 */
function applyLyricsBody(src: string): string {
    const at = src.indexOf('async function applyLyrics');
    expect(at).toBeGreaterThan(-1);
    const open = src.indexOf('{', at);
    expect(open).toBeGreaterThan(at);
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    throw new Error('applyLyrics 函数体不闭合');
}

describe('applyLyrics 源码口径（防回潮）', () => {
    const src = readFileSync(FORM, 'utf8');
    const body = applyLyricsBody(src);

    it('🔴 有 error 时不顺延（网络/接口失败换候选照样失败，还会把网络问题伪装成「没歌词」）', () => {
        // `if (r.error) { ... return; }` 必须出现在「顺延」之前
        const errAt = body.indexOf('if (r.error)');
        const retryAt = body.indexOf('const rest =');
        expect(errAt).toBeGreaterThan(-1);
        expect(retryAt).toBeGreaterThan(-1);
        expect(errAt).toBeLessThan(retryAt);
    });

    it('🔴 顺延只在**同源**内（跨源换供应商 = 静默偷换用户点的那条）', () => {
        expect(body).toContain('lrcResults.find((x) => x.source === source)');
        // 反向守卫：不许出现「遍历 lrcResults 所有源」那种写法
        expect(body).not.toContain('lrcResults.flatMap');
    });

    it('顺延从**用户点的这条之后**开始（⛔ 不回头重试已点过的）', () => {
        expect(body).toContain('all.slice(at + 1, at + 1 + LYRIC_RETRY_MAX)');
    });

    it('成功后清错误并给一次可感知的提示（缓存命中式静默会让用户以为点错了）', () => {
        const okAt = body.indexOf('lrc = nr.text;');
        expect(okAt).toBeGreaterThan(-1);
        const after = body.slice(okAt, okAt + 400);
        expect(after).toContain('lrcOpen = false;');
        expect(after).toContain('new Notice(');
    });

    it('重试上限是有限值（⛔ 不许把 20 条候选全打一遍）', () => {
        const m = src.match(/const LYRIC_RETRY_MAX = (\d+);/);
        expect(m).toBeTruthy();
        const n = Number(m![1]);
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(5);
    });

    it('全部失败时如实给出「已试过 N 个版本」（⛔ 不是笼统的「该源没有」）', () => {
        expect(body).toContain('`该源没有这首歌的歌词（已试过 ${tried} 个版本）`');
    });
});

describe('搜索池放宽（网易云 50 → 100）', () => {
    const src = readFileSync('src/pure/lyricOnline.ts', 'utf8');

    it('neteaseSearchUrl 默认 limit 是 100', () => {
        expect(src).toContain('export function neteaseSearchUrl(query: string, limit = 100): string {');
        expect(src).not.toContain('export function neteaseSearchUrl(query: string, limit = 50): string {');
    });

    it('🔴 只放宽网易云：酷我 / QQ 的默认 limit 仍是 50（实测它们没有「原版排到 50 名外」）', () => {
        expect(src).toContain('export function kuwoSearchUrl(query: string, limit = 50): string {');
        expect(src).toContain('export function qqSearchUrl(query: string, limit = 50): string {');
    });

    it('展示条数不变（池子放宽 ≠ 弹层行数变多）', () => {
        expect(src).toContain('export const LYRIC_CANDIDATES_PER_SOURCE = 20;');
    });
});
