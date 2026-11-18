/**
 * m04135：两条交互优化的源码守卫。
 *
 * 用户原话（逐字）：「优化交互体验：在首页视图搜索框中搜索填入的文本如果这时点添加按钮
 *                  就直接填入搜索条目一步到位，省去打开添加条目窗口再搜索
 *                   ②播放器详情页的右键关联入口为网络链接，但视频播放器还是本地播放器不刷新，
 *                   而不是内嵌网络播放器」
 *
 * ⚠️ 全部是源码文本断言 —— 本仓没有 Svelte 编译器依赖（`tests/` 347 个文件没有一个编译组件），
 *    也拿不到渲染后的 DOM。所以这里钉的是「接线」而不是「行为」。
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const MEDIA_LIST = readFileSync(join(ROOT, 'src/views/components/MediaList.svelte'), 'utf8');
const HOME_VIEW = readFileSync(join(ROOT, 'src/views/HomeView.ts'), 'utf8');
const ENTRY_MODAL = readFileSync(join(ROOT, 'src/modals/EntryModal.ts'), 'utf8');
const ENTRY_FORM = readFileSync(join(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/views/EpisodePageView.ts'), 'utf8');
const MAIN = readFileSync(join(ROOT, 'main.ts'), 'utf8');

/** 三档不跨行剥注释（跨全文的 `/\/\*[\s\S]*?\*\//` 会被 `accept="image/*"` 吞掉十几万字符） */
function stripComments(text: string): string {
    return text
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * 按括号配平先跳过**参数列表**，再定位方法体的开括号。
 *
 * ⚠️ 本文件初版踩过的坑（记下来免得再犯）：
 *   ① `src.indexOf('{', at + signature.length)` 在 signature 自身已带 `{` 时，
 *      会跳过方法体那个大括号、命中体内嵌套块的开括号 ⇒ 取到的“方法体”只剩半截，
 *      断言 `toContain('this.syncNetAfterAssociate();')` 直接假红。
 *   ② 参数列表在大括号**之前**，`methodBody` 返回不到它 ⇒ 想断言构造参数必须另走 `paramsText`。
 */
function bodyBraceAt(src: string, signature: string): number {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`找不到方法体锚点：${signature}`);
    const parenAt = src.indexOf('(', at);
    if (parenAt < 0) throw new Error(`锚点后没有参数列表：${signature}`);
    let depth = 0;
    for (let i = parenAt; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
            depth--;
            if (depth === 0) {
                const braceAt = src.indexOf('{', i);
                if (braceAt < 0) throw new Error(`参数列表后没有大括号：${signature}`);
                return braceAt;
            }
        }
    }
    throw new Error(`参数列表括号不配对：${signature}`);
}

/** 参数列表原文（含两端圆括号）—— 断言构造签名 / 函数签名用它 */
function paramsText(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`找不到签名锚点：${signature}`);
    const braceAt = bodyBraceAt(src, signature);
    return src.slice(at, braceAt);
}

/** 按大括号深度配对取方法体（拿不到就抛 —— ⛔ 不许让断言静默变空） */
function methodBody(src: string, signature: string): string {
    const braceAt = bodyBraceAt(src, signature);
    let depth = 0;
    for (let i = braceAt; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(braceAt, i + 1);
        }
    }
    throw new Error(`大括号不配对：${signature}`);
}

describe('m04135 ① 首页搜索词带进「添加条目」并立即搜', () => {
    const list = stripComments(MEDIA_LIST);
    const home = stripComments(HOME_VIEW);
    const modal = stripComments(ENTRY_MODAL);
    const form = stripComments(ENTRY_FORM);
    const main = stripComments(MAIN);

    it('MediaList.onAdd 签名带第三个词参，且添加按钮真的把它传出去', () => {
        expect(list).toContain('export let onAdd: (t?: EntryType, kind?: BookKind, q?: string) => void');
        // 添加按钮那一次调用必须把 `searchText` 洗一下再传（空白词等价于没填）
        expect(list).toContain('searchText.trim() || undefined');
        // 反向守卫：⛔ 别退回「只传 type/kind」的老形状
        expect(list).not.toContain(
            "on:click={() => onAdd(resolveAddType(lockType, typeFilter, activeGroup ? activeGroup.type : null), lockType === 'book' && kindFilter !== 'all' ? kindFilter : undefined)}",
        );
    });

    it('HomeView 把词透传给 openAddModal', () => {
        expect(home).toContain(
            'onAdd: (t?: EntryType, kind?: BookKind, q?: string) => this.plugin.openAddModal(t, kind, q),',
        );
    });

    it('openAddModal 多了第三参并传给 EntryModal', () => {
        expect(main).toContain(
            'openAddModal(initialType?: EntryType, initialBookKind?: BookKind, initialQuery?: string): void {',
        );
        expect(main).toContain(
            'new EntryModal(this.app, this, undefined, initialType, initialBookKind, initialQuery);',
        );
    });

    it('EntryModal 构造收第六参并写进 repeat.query（presetQuery 的唯一来源）', () => {
        // 参数列表在大括号之前 ⇒ 必须用 paramsText，⛔ 不是 methodBody
        expect(paramsText(modal, 'constructor(')).toContain('private initialQuery?: string,');
        const ctor = methodBody(modal, 'constructor(');
        expect(ctor).toContain('this.repeat = { ...this.repeat, query: initialQuery.trim() };');
        // 只写 state，⛔ 不在构造函数里发起搜索（那时组件还没挂载）
        expect(ctor).not.toContain('doSearch');
    });

    it('EntryForm 首次打开带词就立刻搜，且三条判据一条都不能少', () => {
        expect(form).toContain('if (!entry && presetQuery.trim() && presetResults.length === 0) {');
        expect(form).toContain('void doSearch();');
        // 反向守卫：⛔ 别把「保存并继续」那条路也拉进来（候选已带回 ⇒ 再搜会重复并进池子）
        expect(form).not.toContain("if (!entry && presetQuery.trim()) {");
        // 反向守卫：⛔ 编辑表单不摆搜索区
        expect(form).not.toContain('if (presetQuery.trim()) {');
    });
});

describe('m04135 ② 关联改成网络链接后必须切到内嵌网络播放器', () => {
    const page = stripComments(PAGE);

    it('syncEpisodeSources 末尾补了「当前集形态重判」', () => {
        const body = methodBody(page, 'private syncEpisodeSources(entry: MediaEntry): void {');
        expect(body).toContain('this.syncCells();');
        expect(body).toContain('this.syncNetAfterAssociate();');
        // 顺序契约：先重画格子、再判播放形态（反了会拿旧格子算当前集）
        expect(body.indexOf('this.syncCells();')).toBeLessThan(body.indexOf('this.syncNetAfterAssociate();'));
    });

    it('syncNetAfterAssociate 按新数据选播放器，且优先级与 openCell 一致（本地优先）', () => {
        const body = methodBody(page, 'private syncNetAfterAssociate(): void {');
        // 判据用全页唯一口径
        expect(body).toContain('const idx = this.activeCellIndex();');
        expect(body).toContain("const url = (ctx.urls[idx] ?? '').trim();");
        expect(body).toContain("const localPath = (ctx.files[idx] ?? '').trim();");
        expect(body).toContain('const inNet = this.isNetPlayback();');
        expect(body).toContain('const wantNet = !!url && canPlayNetInline(url);');
        // 🔴 优先级契约：本地文件那支必须**先** return，网络判定排在它之后
        //   （`openCell()` 是 `if (cell.local) {...return}` 再轮到 url —— 两个入口不能给出不同结果）
        const localBranch = body.indexOf('if (localPath) {');
        expect(localBranch).toBeGreaterThan(0);
        expect(localBranch).toBeLessThan(body.indexOf('const wantNet ='));
        // 幂等守卫：同一集同一地址就别重建 iframe（否则正在播的会被打断）
        expect(body).toContain('if (inNet && this.netIndex === idx && this.netSrcUrl === url) return;');
        // 两个出口都在
        expect(body).toContain('this.enterNetEmbed(idx, url);');
        expect(body).toContain('this.exitNetEmbed(');
        // 🔴 进入网络态之后必须把分段页跟到那一格并重画 —— 与 `openCell()` 同一套收尾，
        //   少了它跨分段点击后右侧选集列表会翻到完全不相干的一段（`openCell` 里为此专门写过注释）。
        //   ⚠️ 只断言 `enterNetEmbed` 在是不够的：把收尾两行整段删掉仍然绿（突变 ⑫ 实测过）。
        const enterAt = body.indexOf('this.enterNetEmbed(idx, url);');
        expect(enterAt).toBeGreaterThan(0);
        const after = body.slice(enterAt);
        expect(after).toContain(
            'this.cellsPage = Math.max(0, Math.floor(this.orderedCellPos(idx) / EPISODE_PAGE_SIZE));',
        );
        expect(after).toContain('this.syncCells();');
        // 顺序契约：翻页 → 重画（反了会拿旧页号画格子）
        expect(after.indexOf('this.cellsPage =')).toBeLessThan(after.indexOf('this.syncCells();'));
        // 反向守卫：⛔ 别退回「只 replaceItems 就完事」那段老逻辑
        expect(body).not.toContain('this.replaceItems(');
        // 反向守卫：⛔ 别把 `wantNet` 当成第一个分支条件（那正是自相矛盾的版本）
        //   用 `if (wantNet)` 的形状钉 —— ⚠️ 别用带 `\n` 的多行文本比对，
        //   源文件是 CRLF，`\n` 匹配不上 `\r\n`，那种守卫是死的（本文件初版踩过）。
        expect(body).not.toContain('if (wantNet) {');
    });

    it('退出网络态的分支不能把本地源白挂一遍（restoreLocal 由有无本地文件决定）', () => {
        const body = methodBody(page, 'private syncNetAfterAssociate(): void {');
        // 本地有源：交给 exitNetEmbed(true) 自己 rerenderCurrent，外面不再补
        expect(body).toContain('if (inNet) this.exitNetEmbed(true);');
        // 两头都没有：exitNetEmbed(false) + 外面补一次 rerenderCurrent 画空态
        expect(body).toContain('this.exitNetEmbed(false);');
        expect(body).toContain('this.rerenderCurrent();');
        // 反向守卫：⛔ 别用三元把两种情况揉成一句（那样「本地有源」那条会白挂一遍源、闪一下）
        expect(body).not.toContain('this.exitNetEmbed(localPath ? true : false);');
    });
});
