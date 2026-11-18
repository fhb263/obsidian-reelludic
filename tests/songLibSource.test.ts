/**
 * m10134 ①：在线曲库结果回填表单时，「来源」框要写**平台名**，⛔ 不是「在线曲库」。
 *
 * 用户原话（逐字）：「搜索条目的在线曲库，返回填的来源评分要具体为填的链接平台名称
 *                  而不是在线曲库，还有为什么无法获取这些平台的大众评分和评价人数」
 *
 * 背景（改版前的事实）：
 *   卡片展示侧早就会用 `platformLabel` 覆盖徽标（`pure/searchDisplay.ts:258`），
 *   但 `EntryForm.pick()` 回填表单时只走 `sourceLabel(sourceFrom)`，
 *   而曲库结果的 `source` 恒为 `SONG_LIB_ID='songlib'`（栏位归属，不可改）
 *   ⇒ 卡片写着「网易云」、表单来源框却写「在线曲库」，两处对不上。
 *
 * ⚠️ 全部是源码文本断言 —— 本仓没有 Svelte 编译器依赖，拿不到渲染后的 DOM。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { SONG_LIB_ID, SONG_LIB_LABEL } from '../src/pure/songLibrary';

const ROOT = join(__dirname, '..');
const FORM = readFileSync(join(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/**
 * 剥注释再断言 —— 注释里逐字写着被禁的旧写法（本仓反复踩：不剥注释反向守卫自己判红）。
 * ⚠️ 不用「跨全文件」的 `/\/\*[\s\S]*?\*\//`：会被 `<input accept="image/*">` 那段吞掉十几万字符。
 */
function stripComments(text: string): string {
    return text
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/** 按大括号深度配对取函数体（拿不到就抛 —— ⛔ 不许让断言静默变空） */
function functionBody(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`找不到函数体锚点：${signature}`);
    const braceAt = src.indexOf('{', at + signature.length);
    if (braceAt < 0) throw new Error(`找不到函数体左花括号：${signature}`);
    let depth = 0;
    for (let i = braceAt; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(braceAt + 1, i);
        }
    }
    throw new Error(`函数体大括号不配对：${signature}`);
}

const PICK = stripComments(functionBody(FORM, 'async function pick(r: SearchResult)'));

describe('m10134 ① 在线曲库回填来源名 = 平台名（⛔ 不是「在线曲库」）', () => {
    it('`pick()` 里先取 `r.platformLabel`（用 `in` 窄化联合类型），再用它覆盖来源名', () => {
        expect(PICK).toContain("const pickedPlatform = ('platformLabel' in r ? String(r.platformLabel ?? '') : '').trim();");
        expect(PICK).toContain('sourceName = pickedPlatform || sourceLabel(sourceFrom);');
    });

    it('🔴 反向守卫：`pick()` 里不许再出现裸的 `sourceName = sourceLabel(sourceFrom);`', () => {
        // 剥注释后才判 —— 上面那段 // 解释里逐字写着这条旧写法作为反面教材
        expect(PICK).not.toContain('sourceName = sourceLabel(sourceFrom);');
    });

    it('曲库栏位 `source` 仍是 `songlib`（⛔ 不许为了改回填把栏位键改掉）', () => {
        // #458 教训：栏位归属与结果必须同口径，一旦改键整批曲库结果会被丢掉
        expect(SONG_LIB_ID).toBe('songlib');
        expect(SONG_LIB_LABEL).toBe('在线曲库');
    });

    it('非曲库结果没有 `platformLabel` ⇒ 仍回落到 `sourceLabel`（行为零变化）', () => {
        // 兜底那一半必须在同一个表达式里，⛔ 不能写成 `sourceName = pickedPlatform;`（会把豆瓣/TMDB 的来源名清空）
        expect(PICK).toContain('pickedPlatform || sourceLabel(sourceFrom)');
        expect(PICK).not.toMatch(/sourceName = pickedPlatform;\s*\n/);
    });
});
