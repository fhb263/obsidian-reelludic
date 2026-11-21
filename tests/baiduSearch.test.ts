// `pure/baiduSearch` 与「百度搜索按钮 / 内嵌弹窗」装配的守护测试（用户 m17219）。
//
// 🔴 为什么要测这些「看起来只是拼字符串」的函数：
//    查询词的拼法一旦错，用户看到的是**搜索结果的错**（搜了错的词），而不是报错 ——
//    属于「静默错」里最难被发现的一类。所以下面把拼法的每个边界都钉住。
//
// 🔴 装配判据（`EntryForm.svelte` / `EntryModal.ts` / `main.ts` 源码级）不是防「写错」，
//    而是防「以后被顺手挪走」：用户明确要求按钮在 ✨ **左旁边**，位置是需求的一部分。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { baiduQueryIsEmpty, baiduSearchQuery, baiduSearchUrl, baiduSearchUrlFor, firstPersonName } from 'pure/baiduSearch';

const ROOT = resolve(__dirname, '..');
const formSrc = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
const modalSrc = readFileSync(resolve(ROOT, 'src/modals/BaiduSearchModal.ts'), 'utf8');
const entryModalSrc = readFileSync(resolve(ROOT, 'src/modals/EntryModal.ts'), 'utf8');
const mainSrc = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');

/**
 * 剥掉 TS / Svelte 注释（`//`、`/* *\/`、`<!-- -->`）。
 *
 * 🔴 反向守卫（`not.toContain`）必须跑在**剥注释之后**的代码上：
 *    本仓的注释习惯是「把被否掉的写法逐字写在注释里当反面教材」
 *    （如「⛔ 别为省事再借 sparkles」「为什么不用自己 createEl('iframe')」），
 *    直接扫原文会把这些**正确的说明**判成违规 —— 本轮首次运行就是这么假红的 3 条。
 * ⚠️ 只用于反向守卫；正向判据（`toContain`）请继续扫原文，那是在找「写了没」。
 */
/**
 * 🔴 剥注释必须**分区**：`<script>` 里才认 `//` 与 `/* *\/`，模板区只认 `<!-- -->`。
 *    早先的版本对全文无脑剥 `/* *\/`，而本模板里有 `accept="image/*"` —— 那个 `/*` 会被当成
 *    块注释开头，一路吞到十几万字符后的下一个 `*\/`，把 `{#if picked}` 之后的**整片字段区含两枚按钮
 *    全吃掉**（实测 `formCode.indexOf('class="rl-ai-btn rl-baidu-btn"') === -1`），
 *    于是「按钮在字段区之内」这条断言永远为假。这是测试自己的 bug，不是被测代码的 bug。
 *    纯 .ts 文件（没有 `<script>`）按整份 JS 处理。
 */
function stripJsComments(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

function stripHtmlComments(src: string): string {
    return src.replace(/<!--[\s\S]*?-->/g, ' ');
}

function stripComments(src: string): string {
    // 带 <script> 的 Svelte 组件：模板区只剥 <!-- -->，脚本区才剥 JS 注释
    if (/<script\b/i.test(src)) {
        const out: string[] = [];
        const re = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
            out.push(stripHtmlComments(src.slice(last, m.index)));
            out.push(m[1] + stripJsComments(m[2]) + m[3]);
            last = m.index + m[0].length;
        }
        out.push(stripHtmlComments(src.slice(last)));
        return out.join('');
    }
    // 无 <script>：模板片段（含 HTML 标签或 <!--）**只**剥 HTML 注释 ——
    // 对片段剥 `/* */` 正是上面记的那个坑；纯 .ts 源（无标签）才剥 JS 注释。
    const looksLikeTemplate = /<!--/.test(src) || /<\/[a-z][\w-]*\s*>/i.test(src);
    return looksLikeTemplate ? stripHtmlComments(src) : stripJsComments(src);
}

const modalCode = stripComments(modalSrc);
const formCode = stripComments(formSrc);

describe('baiduSearchQuery 拼查询词', () => {
    it('标题 + 作者，用单个空格连起来', () => {
        expect(baiduSearchQuery('三体', '刘慈欣')).toBe('三体 刘慈欣');
    });

    it('作者为空 ⇒ 只搜标题', () => {
        expect(baiduSearchQuery('三体', '')).toBe('三体');
        expect(baiduSearchQuery('三体', undefined)).toBe('三体');
        expect(baiduSearchQuery('三体', null)).toBe('三体');
    });

    it('标题为空但有作者 ⇒ 只搜作者（⛔ 不要拼出一个前导空格）', () => {
        expect(baiduSearchQuery('', '刘慈欣')).toBe('刘慈欣');
        expect(baiduSearchQuery(undefined, '刘慈欣')).toBe('刘慈欣');
    });

    it('两者都空 ⇒ 空串（调用方据此打开百度首页）', () => {
        expect(baiduSearchQuery('', '')).toBe('');
        expect(baiduSearchQuery(undefined, undefined)).toBe('');
        expect(baiduSearchQuery('   ', '   ')).toBe('');
    });

    it('作者名已经在标题里 ⇒ 不重复拼', () => {
        expect(baiduSearchQuery('周杰伦 - 七里香', '周杰伦')).toBe('周杰伦 - 七里香');
    });

    it('折掉多余空白（含全角空格）', () => {
        expect(baiduSearchQuery('  三体  ', '  刘 慈 欣 ')).toBe('三体 刘 慈 欣');
        expect(baiduSearchQuery('三体\u3000', '\u3000刘慈欣')).toBe('三体 刘慈欣');
    });

    it('超长截断：标题优先保留完整', () => {
        const long = '甲'.repeat(50);
        const out = baiduSearchQuery(long, '乙');
        expect(out.length).toBeLessThanOrEqual(60);
        expect(out.startsWith('甲')).toBe(true);
    });
});

describe('baiduSearchUrl 构造地址', () => {
    it('关键词走 `wd` 参数并做 URL 编码', () => {
        expect(baiduSearchUrl('三体 刘慈欣')).toBe(`https://www.baidu.com/s?wd=${encodeURIComponent('三体 刘慈欣')}`);
    });

    it('空格编成 %20，不是加成号的 +（百度两种都认，但保持一致便于断言）', () => {
        expect(baiduSearchUrl('a b')).toContain('%20');
        expect(baiduSearchUrl('a b')).not.toContain('+');
    });

    it('空查询词 ⇒ 百度首页，⛔ 不是 `?wd=` 空搜索页', () => {
        expect(baiduSearchUrl('')).toBe('https://www.baidu.com/');
        expect(baiduSearchUrl('   ')).toBe('https://www.baidu.com/');
        expect(baiduSearchUrl(null)).toBe('https://www.baidu.com/');
        expect(baiduSearchUrl('')).not.toContain('wd=');
    });

    it('baiduSearchUrlFor = 拼词 + 编码（一步到位，避免两处口径）', () => {
        expect(baiduSearchUrlFor('三体', '刘慈欣')).toBe(baiduSearchUrl('三体 刘慈欣'));
        expect(baiduSearchUrlFor('', '')).toBe('https://www.baidu.com/');
    });

    it('特殊字符必须编码（否则 `&` 会把查询词截断成另一个参数）', () => {
        const url = baiduSearchUrl('A&B=C');
        expect(url).toContain('%26');
        expect(url).toContain('%3D');
        // 编码后整条 URL 里只应有一个 `&`（即 `s?wd=` 之后没有裸 &）
        expect(url.split('&').length).toBe(1);
    });
});

describe('baiduQueryIsEmpty', () => {
    it('空白串算空', () => {
        expect(baiduQueryIsEmpty('')).toBe(true);
        expect(baiduQueryIsEmpty('   ')).toBe(true);
        expect(baiduQueryIsEmpty('\u3000')).toBe(true);
    });

    it('有内容算非空', () => {
        expect(baiduQueryIsEmpty('三体')).toBe(false);
    });
});

// 🔴 用户 m17819：「电影百度搜索要和标题+导演（取第 1 个）搜索」。
//    表单里导演与编剧合并在一个框（「丹尼斯·维伦纽瓦 / 埃里克·罗斯」），
//    整串拿去搜会把编剧也算成关键词 ⇒ 必须只取第一个。
describe('firstPersonName（取第一个导演/作者）', () => {
    it('斜杠分隔取第一个', () => {
        expect(firstPersonName('丹尼斯·维伦纽瓦 / 埃里克·罗斯')).toBe('丹尼斯·维伦纽瓦');
    });

    it('顿号与逗号也认（用户手填不会只用斜杠）', () => {
        expect(firstPersonName('宫崎骏、高畑勋')).toBe('宫崎骏');
        expect(firstPersonName('宫崎骏,高畑勋')).toBe('宫崎骏');
        expect(firstPersonName('宫崎骏；高畑勋')).toBe('宫崎骏');
    });

    it('单个值原样返回', () => {
        expect(firstPersonName('刘慈欣')).toBe('刘慈欣');
    });

    it('折掉全角/半角空白', () => {
        expect(firstPersonName('  刘慈欣\u3000 ')).toBe('刘慈欣');
    });

    it('空值/空串/全是分隔符 ⇒ 空串（拼词时会被跳过，退化成只搜标题）', () => {
        expect(firstPersonName('')).toBe('');
        expect(firstPersonName(undefined)).toBe('');
        expect(firstPersonName(null)).toBe('');
        expect(firstPersonName(' / 、 , ')).toBe('');
    });

    it('🔴 只取第一个非空段（前面有前导分隔符时不能返回空串）', () => {
        expect(firstPersonName(' / 刘慈欣 / 某编剧')).toBe('刘慈欣');
    });
});

// ── 装配判据（源码级，防「以后被挪走」） ───────────────────────────────────────
describe('编辑属性表单装配（m17219）', () => {
    it('EntryForm 声明了 onOpenBaiduSearch 这个 prop', () => {
        expect(formSrc).toContain(
            'export let onOpenBaiduSearch: (title: string, author: string) => void',
        );
    });

    it('按钮点击把「标题 + 该类型的主创」交给宿主（m17819：影视取导演的第一个）', () => {
        expect(formSrc).toContain('on:click={() => onOpenBaiduSearch(title, baiduSearchPerson())}');
        // 🔴 反向守卫：⛔ 不许退回「只认 author」——影视/游戏没有 author 字段，那样等于只搜标题
        expect(formSrc).not.toContain('onOpenBaiduSearch(title, author || artist)');
    });

    it('🔴 百度按钮必须排在 AI 预填按钮 **之前**（用户要求「AI预填图标按钮左旁边」）', () => {
        const iBaidu = formSrc.indexOf('class="rl-ai-btn rl-baidu-btn"');
        const iAi = formSrc.indexOf('class="rl-ai-btn"');
        expect(iBaidu).toBeGreaterThan(0);
        expect(iAi).toBeGreaterThan(0);
        expect(iBaidu).toBeLessThan(iAi);
    });

    // 🔴 m01755 用户逐字：「要做，统一显示」—— 推翻了旧口径 `{#if entry || manualFill}`。
    //    现在两枚按钮**无条件渲染**（编辑态 / 添加条目点选结果 / 添加条目手动填写，一律可见）。
    //    ⚠️ 本 it 从「门存在」翻成「门必须不存在」：旧断言正死在守那个 bug，别按旧版改回去。
    //    🔴 必须用 `formCode`（已剥注释）而不是 `formSrc` —— 本轮把沿革写进了注释，
    //       注释里那句 `{#if entry || manualFill}` 字面量会让 `formSrc` 的 not.toContain 假红。
    it('🔴 两枚按钮**不再**被 `entry || manualFill` 那道门包住（m01755 统一显示）', () => {
        expect(formCode).not.toContain('{#if entry || manualFill}');
        expect(formCode).not.toContain('{#if manualFill}');
        expect(formCode).not.toContain('manualFill');
        // 两枚按钮都在 `{#if picked}` 字段区之内（字段区是整块，不进 `picked` 就什么都看不到）
        const fieldsAt = formCode.indexOf('{#if picked}');
        const iBaidu = formCode.indexOf('class="rl-ai-btn rl-baidu-btn"');
        expect(fieldsAt).toBeGreaterThan(0);
        expect(iBaidu).toBeGreaterThan(fieldsAt);
    });

    it('🔴 影视取 directorWriters 的第一个，游戏取 developer（m17819）', () => {
        const body = formSrc.slice(formSrc.indexOf('function baiduSearchPerson()'));
        const fn = body.slice(0, body.indexOf('\n    }'));
        // 影视三类走导演框
        expect(fn).toContain("type === 'movie' || type === 'tv' || type === 'anime'");
        expect(fn).toContain('firstPersonName(directorWriters)');
        // 游戏走开发商、音乐走歌手
        expect(fn).toContain("type === 'game'");
        expect(fn).toContain('firstPersonName(developer)');
        expect(fn).toContain("type === 'music'");
        // 兜底是书籍作者
        expect(fn).toContain('return firstPersonName(author);');
        // 🔴 反向守卫：⛔ 影视那支不许退回裸 author（影视根本没有 author 字段）
        expect(fn).not.toContain("type === 'movie') return firstPersonName(author)");
    });

    it('按钮有读屏名（`.rl-sr`）与 data-tip，且⛔ 不用 `aria-label`（会与 data-tip 叠成两层气泡）', () => {
        const at = formSrc.indexOf('class="rl-ai-btn rl-baidu-btn"');
        const block = formSrc.slice(at, at + 1200);
        expect(block).toContain('class="rl-sr"');
        expect(block).toContain('data-tip=');
        expect(block).not.toContain('aria-label');
    });

    it('图标是放大镜（circle + 手柄），⛔ 不是星形/sparkles（会撞 AI 预填与总结摘要的图标家族）', () => {
        const at = formSrc.indexOf('class="rl-ai-btn rl-baidu-btn"');
        const block = formSrc.slice(at, at + 1200);
        expect(block).toContain('<circle cx="11" cy="11" r="7" />');
        // 🔴 只判**代码区**（剥注释后）：注释里逐字引着「别借 sparkles」当反面教材
        expect(stripComments(block)).not.toContain('sparkle');
    });
});

describe('宿主接线（m17219）', () => {
    it('EntryModal 把 onOpenBaiduSearch 接到 plugin.openBaiduSearch', () => {
        expect(entryModalSrc).toContain('onOpenBaiduSearch: (title: string, author: string) =>');
        expect(entryModalSrc).toContain('this.plugin.openBaiduSearch(title, author)');
    });

    it('main.ts 的 openBaiduSearch 走弹窗工厂并带外链出口', () => {
        expect(mainSrc).toContain('openBaiduSearch(title: string, author: string): void {');
        expect(mainSrc).toContain('openBaiduSearchModal(this.app, {');
        expect(mainSrc).toContain('onOpenExternal: (url) => this.openExternalUrl(url)');
    });
});

describe('BaiduSearchModal 承载层契约', () => {
    it('用 mountEmbedHost 承载（⛔ 不自己 createEl iframe —— 那会丢掉 webview 这一档）', () => {
        expect(modalSrc).toContain('mountEmbedHost(stage, this.url, ');
        // 🔴 只判代码区（注释里正逐字写着「为什么不用自己 createEl('iframe')」）
        expect(modalCode).not.toMatch(/createEl\('iframe'/);
    });

    it('🔴 onClose 必须调 dispose()（webview 是独立 webContents，不释放会残留进程）', () => {
        const at = modalSrc.indexOf('onClose(): void {');
        const body = modalSrc.slice(at, at + 500);
        expect(body).toContain('this.host?.dispose()');
        expect(body).toContain('this.host = null;');
    });

    it('降级到 iframe 时必须把原因写出来（否则用户以为插件坏了）', () => {
        expect(modalSrc).toContain("this.host.kind !== 'webview'");
        expect(modalSrc).toContain('已降级为 iframe');
    });

    it('查询词与地址都来自 pure/baiduSearch（⛔ 不在弹窗里自己拼一遍）', () => {
        expect(modalSrc).toContain("from 'pure/baiduSearch'");
        expect(modalSrc).toContain('baiduSearchQuery(this.opts.title, this.opts.author)');
        expect(modalSrc).toContain('baiduSearchUrlFor(this.opts.title, this.opts.author)');
        // 反向守卫：代码区不许出现裸的百度地址拼接（注释里引用它是为了说明「别这么干」）
        expect(modalCode).not.toContain('https://www.baidu.com/s?wd=');
    });

    it('⛔ 不做回填（用户裁定「纯内嵌百度网页，不回填」）', () => {
        expect(modalCode).not.toContain('onPickTitle');
        expect(modalCode).not.toContain('input.value =');
    });
});
