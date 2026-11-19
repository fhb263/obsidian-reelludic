/**
 * 🔴 m11999 守护：豆瓣查不到集数时留空 + 给提示。
 *
 * 用户报障（2026-11-19 逐字）：「还是拉取不行啊，为什么我拉取"柯南"的条目豆瓣的总集数还是为空」。
 * 实测结论不是插件 bug —— 豆瓣**自己就没有**柯南的集数（`#info` 无「集数」行、rexxar API
 * `episodes_count: 0`、`/episodes` 404）；对照条目「佩琳物语」拿到 53 集，证明链路通。
 *
 * 用户裁定：「查不到就留空 + 给提示」⇒ ⛔ 不许编造集数，也 ⛔ 不许静默留空。
 * 本文件守的是这条「提示」的接缝，⛔ 不是重复测豆瓣解析（那些在 `tests/douban*.test.ts`）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const form = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/** 剥注释：源码注释里写满了「⛔ 不许 xxx」的反面教材，不剥会把自己写的警告判成命中 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 取某个函数体（按大括号深度配对）——拿不到就抛，避免「找不到也当通过」 */
function functionBody(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`函数签名未找到：${signature}`);
    const open = src.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    throw new Error(`函数体未闭合：${signature}`);
}

const code = stripComments(form);

describe('🔴 m11999 集数缺失提示', () => {
    it('提示文案说清「谁没给、已留空、请你填」，且不露出技术黑话', () => {
        expect(form).toContain('const EPISODE_COUNT_MISS_HINT =');
        const at = form.indexOf('const EPISODE_COUNT_MISS_HINT =');
        const text = form.slice(at, form.indexOf(';', at));
        expect(text).toContain('豆瓣没有提供');
        expect(text).toContain('已留空');
        expect(text).toContain('手动填写');
        // ⛔ 不许把内部错误（失败 / 出错 / 异常）甩给用户 —— 功能没坏，是数据源没有
        expect(text).not.toMatch(/失败|出错|异常/);
    });

    it('判定函数三条前置 return：非影视、已有集数、详情里真有集数 都不置位', () => {
        const body = functionBody(code, 'function noteEpisodeCountMiss(');
        expect(body).toContain("if (type !== 'tv' && type !== 'anime') return;");
        expect(body).toContain('if (totalEpisodes) return;');
        expect(body).toContain('if (d.episodeCount) return;');
        expect(body).toContain('episodeCountMiss = true;');
        // 反向守卫：⛔ 不许反过来 —— 有集数时也置位（那会让正常条目白挂一条提示）
        expect(body).not.toMatch(/if \(d\.episodeCount\) \{\s*episodeCountMiss = true/);
    });

    it('只在两条豆瓣详情分支调用，且都紧跟 applyDoubanDetail（顺序错了会用到旧 totalEpisodes）', () => {
        const calls = code.match(/noteEpisodeCountMiss\(d\);/g) ?? [];
        expect(calls).toHaveLength(2);
        const ordered = code.match(/applyDoubanDetail\(d\);\s*\n\s*noteEpisodeCountMiss\(d\);/g) ?? [];
        expect(ordered).toHaveLength(2);
    });

    it('⛔ 不许挂到多源共用的 applyDoubanDetail 里（会把 OMDb/OpenLibrary/Steam 也标成「豆瓣没给」）', () => {
        const body = functionBody(code, 'function applyDoubanDetail(');
        expect(body).not.toContain('noteEpisodeCountMiss');
        expect(body).not.toContain('episodeCountMiss');
    });

    it('两个总集数框都渲染提示、共用同一常量', () => {
        // ⚠️ 这两行在 Svelte 模板里，判据必须用**原始**源码：本文件的 stripComments 会把
        //    模板片段一起吃掉（实测 raw=2 / stripped=0），用它判会得到 0 命中的假红。
        const re = /\{#if episodeCountMiss\}<div class="rl-hint">\{EPISODE_COUNT_MISS_HINT\}<\/div>\{\/if\}/g;
        expect(form.match(re) ?? []).toHaveLength(2);
        // 用既有 `.rl-hint`，⛔ 不新造样式类（本仓提示一律走它）
        expect(form).not.toContain('rl-hint-miss');
    });

    it('用户手填集数即清提示（markTotalEpisodesTouched 里收标记）', () => {
        const body = functionBody(code, 'function markTotalEpisodesTouched(');
        expect(body).toContain('totalEpisodesAuto = false;');
        expect(body).toContain('episodeCountMiss = false;');
    });

    it('⛔ 不许编造集数：置位函数里不写 totalEpisodes', () => {
        const body = functionBody(code, 'function noteEpisodeCountMiss(');
        expect(body).not.toMatch(/totalEpisodes\s*=\s*/);
    });
});
