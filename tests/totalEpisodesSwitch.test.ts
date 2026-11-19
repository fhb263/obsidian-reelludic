/**
 * m11317（用户反馈）：搜索剧集和动画，显示的总集数都是 1 集。
 *
 * 用户原话（逐字，转述自插件用户反馈）：
 *   「搜索相关的剧集和动画，显示的总集数都是1集」/「无法显示总集数」
 *
 * 根因（改版前的真实链路）：
 *   `EntryForm.svelte` 的 `let totalEpisodes = ... : type === 'movie' ? '1' : ''`
 *   **只在组件初始化时求值一次**。从「添加条目」进来时 `type` 默认 `movie`
 *   （`EntryModal` 传 `initialType ?? 'movie'`）⇒ `totalEpisodes` 被钉成 `'1'`。
 *   用户随后在下拉里切到「电视剧 / 动画」，`onTypeSelEl` 只改 `type`、不碰这个值，
 *   于是 `'1'` 一路带到豆瓣详情回填 —— `applyDoubanDetail` 的守卫是 `!totalEpisodes`
 *   （`'1'` 为真）⇒ **豆瓣查到的真实集数被静默丢弃**，落库就是 1 集。
 *
 * 修法：加 `totalEpisodesAuto` 标记 —— 只有「值还是自动给的」时才随类型重算；
 *   用户一动手（输入框 `on:input` → `resizeEpisodeFiles`）就收掉标记，此后不再改写。
 *
 * ⚠️ 全部是源码文本断言 —— 本仓没有 Svelte 编译器依赖，拿不到渲染后的 DOM。
 *    这类「初始化一次性求值 + 切类型不重算」的 bug，纯逻辑单测抓不到。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const FORM = readFileSync(join(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/**
 * 剥注释再断言 —— 注释里逐字写着被禁的旧口径（本仓反复踩：不剥注释反向守卫自己判红）。
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

const CODE = stripComments(FORM);
const ON_TYPE = functionBody(CODE, 'function onTypeSelEl(ev: Event): void');
const RESIZE = functionBody(CODE, 'function resizeEpisodeFiles()');
const APPLY_DETAIL = functionBody(CODE, 'function applyDoubanDetail(');

describe('m11317 切类型后总集数必须跟着重算（否则豆瓣真实集数被 "1" 挡掉）', () => {
    it('🔴 `onTypeSelEl` 里必须按新类型重算自动值：切出电影清空、切回电影给 1', () => {
        expect(ON_TYPE).toContain("if (totalEpisodesAuto) totalEpisodes = next.type === 'movie' ? '1' : '';");
        // 反向守卫：只改 type 不碰 totalEpisodes 的是改版前的坏形态
        expect(ON_TYPE).toMatch(/totalEpisodesAuto/);
    });

    it('🔴 用户手填过的值不许被切类型冲掉（标记只对「自动值」生效）', () => {
        // 重算那行必须以 `if (totalEpisodesAuto)` 开头 —— ⛔ 不是无条件覆盖
        expect(ON_TYPE).toContain('if (totalEpisodesAuto)');
        expect(ON_TYPE).not.toMatch(/^\s*totalEpisodes = next\.type/m);
    });

    it('🔴 自动标记的初值：编辑已有集数 ⇒ false；新建电影 ⇒ true；新建其它 ⇒ false', () => {
        // `!entry?.progress?.totalEpisodes && type === 'movie'`
        expect(CODE).toContain("let totalEpisodesAuto = !entry?.progress?.totalEpisodes && type === 'movie';");
        // 反向守卫：⛔ 别退回「恒 true」或「恒 false」的退化写法
        expect(CODE).not.toContain('let totalEpisodesAuto = true;');
        expect(CODE).not.toContain('let totalEpisodesAuto = false;');
    });

    it('🔴 用户动手改总集数就收掉自动标记（`resizeEpisodeFiles` 是输入框的 on:input）', () => {
        expect(RESIZE).toContain('markTotalEpisodesTouched();');
        // 必须在算 n 之前收标记：先收标记、后算值，顺序反了会让本次输入被当成「自动值」再被切类型覆盖
        expect(RESIZE.indexOf('markTotalEpisodesTouched();')).toBeLessThan(RESIZE.indexOf('const n = totalEpisodes'));
    });

    it('🔴 豆瓣回填的守卫仍是 `!totalEpisodes`（⛔ 不许为了绕开这个 bug 把守卫删掉）', () => {
        // 守卫在，才说明「切类型清空自动值」是正确解药；删守卫 = 把用户手填的集数也覆盖掉
        expect(APPLY_DETAIL).toContain('if (d.episodeCount && (type === \'tv\' || type === \'anime\') && !totalEpisodes)');
        expect(APPLY_DETAIL).toContain('totalEpisodes = String(d.episodeCount);');
    });

    it('⛔ 反向守卫：`totalEpisodes` 不许改成 `$:` 响应式（会在逐键输入时覆盖输入框）', () => {
        expect(CODE).not.toMatch(/^\s*\$:\s*totalEpisodes\s*=/m);
    });

    it('两个总集数输入框都挂 `on:input={resizeEpisodeFiles}`（用户动手的唯一入口）', () => {
        const hits = CODE.match(/bind:value=\{totalEpisodes\} on:input=\{resizeEpisodeFiles\}/g) ?? [];
        expect(hits.length).toBe(2);
    });
});
