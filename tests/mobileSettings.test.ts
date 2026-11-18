/**
 * 手机 / 平板上的设置页与首页（用户 m05673 手机实测三报）。
 *
 * 用户原话（逐字）：
 *   「在手机端验证了，有在设置点一下只显示顶部页签而不是基本设置也签内容设置高级集成，
 *     播放阅读，ai显示，搜索配置的原数据源配置启用有的分两行有的一行显示空白一片应该给个提示
 *     不支持还有默认导航布局应该为合并视图以适应手机端竖屏显示」
 *
 * 三件事，本文各守一组：
 *   ① 点页签后**只有页签、内容全空** —— 真因不是懒渲染，是 `display()` 的建页循环没有围栏：
 *      一页抛异常就中断，后面的页一个都没建，`setActivePage()` 也没执行到。
 *   ② 设置行「有的分两行、有的一行」+ 大片空白 —— 原生 `.setting-item` 是单行 flex，
 *      窄屏下各控件宽度不一、各自换行 ⇒ 行高参差、控件右对齐留出左边空白。
 *   ③ 手机默认导航布局 = 合并视图（见 `tests/navLayout.test.ts` 的播种守卫）。
 *
 * 🔴 为什么用源码文本守卫而不是行为测试：
 *   这里的缺陷全在「渲染期少了一层 try/catch」「少了一条 CSS」这种**没有类型可查、
 *   跑单测也看不见**的地方 —— 它们的表现只有在真机上点开设置页才看得见（而且看起来像白屏，
 *   不像报错）。文本守卫是唯一能在 CI 里提前拦住「有人把围栏删了」的手段。
 * ⚠️ 一律先 `stripComments()` 再匹配：注释里写一句同样的话就会假绿（本仓已打穿过三次）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
    return readFileSync(resolve(ROOT, rel), 'utf8');
}

/** 剥掉块注释与整行 `//` 注释（字符串里的 `//` 不处理 —— 本仓没有 URL 跟着代码的写法） */
function strip(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 取 `display()` 里「建页」那一段（从遍历 SETTING_NAV_PAGES 到循环结束的 `pageEls.set`） */
function pageLoopOf(src: string): string {
    const at = src.indexOf('for (const page of SETTING_NAV_PAGES)');
    expect(at, '找不到建页循环 —— 守卫失去锚点，需同步更新本测试').toBeGreaterThan(-1);
    const end = src.indexOf('this.setActivePage(this.activePage)', at);
    expect(end, '找不到 setActivePage 调用').toBeGreaterThan(at);
    return src.slice(at, end);
}

describe('🔴 2026-11-14 m05673 ① · 建页循环必须有围栏（否则一页抛错→整页空白）', () => {
    const settings = strip(read('src/Settings.ts'));
    const loop = pageLoopOf(settings);

    it('每页的 renderPage 调用被 try/catch 包住', () => {
        expect(loop).toContain('try {');
        expect(loop).toContain('this.renderPage(page.id, body);');
        expect(loop).toContain('catch');
    });

    it('catch 里必须真的写出来（⛔ 不许静默吞掉）', () => {
        // 静默 = 只 console.warn 或空 catch。用户那次白屏只能靠真机盯着发愣才发现，
        // 所以 catch 里必须既有 console.error（给我们）又有落 DOM 的说明（给用户）。
        expect(loop).toMatch(/console\.error\(/);
        expect(loop).toContain('rl-set-pagefail');
        // 页面名要进文案，用户才知道是哪一页坏了
        expect(loop).toMatch(/page\.label/);
    });

    it('失败页先 empty() 再写，避免半成品与错误文案叠在一起', () => {
        expect(loop).toMatch(/body\.empty\(\)/);
    });

    it('⛔ 循环里的 pageEls.set 必须在 try/catch **之外**（否则失败页连 id 都登记不上）', () => {
        const catchAt = loop.indexOf('catch');
        const setAt = loop.indexOf('this.pageEls.set(page.id, el);');
        expect(setAt).toBeGreaterThan(catchAt);
    });
});

describe('🔴 2026-11-14 m05673 ② · 窄屏设置行统一成「名称在上、控件在下」', () => {
    const css = strip(read('styles.css'));

    /**
     * 取某条媒体查询块的正文。
     * ⚠️ 同一档宽度在 `styles.css` 里**有多块**（719px 既有 ASR 那块，也有本次的设置行那块），
     *    所以必须按内容挑：传 `mustContain` 命中哪块就返回哪块。
     *    ⛔ 别改回「indexOf 第一处」—— 那样会读到无关的旧块，四条断言全部假红（已踩过）。
     */
    function mediaBlock(width: number, mustContain: string): string {
        const key = `@media (max-width: ${width}px)`;
        let from = 0;
        for (;;) {
            const at = css.indexOf(key, from);
            expect(at, `找不到含「${mustContain}」的 ${key} 媒体块`).toBeGreaterThan(-1);
            const open = css.indexOf('{', at);
            let depth = 0;
            let end = -1;
            for (let i = open; i < css.length; i += 1) {
                if (css[i] === '{') depth += 1;
                else if (css[i] === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
            const body = css.slice(open + 1, end);
            if (body.includes(mustContain)) return body;
            from = at + key.length;
        }
    }

    const SETTING_ROW = '.setting-item';

    it('719px 档里把 setting-item 改成纵向排列', () => {
        const block = mediaBlock(719, SETTING_ROW);
        expect(block).toMatch(/\.setting-item[^{]*\{[^}]*flex-direction:\s*column/);
    });

    it('名称区与控件区都撑满整行（控件不再被顶到右边留一大片空白）', () => {
        const block = mediaBlock(719, SETTING_ROW);
        expect(block).toMatch(/\.setting-item-info\s*\{[^}]*width:\s*100%/);
        expect(block).toMatch(/\.setting-item-control\s*\{[^}]*width:\s*100%/);
        expect(block).toMatch(/justify-content:\s*flex-start/);
    });

    it('分组标题行被排除（标题套纵向排列会多出一段无意义高度）', () => {
        expect(mediaBlock(719, SETTING_ROW)).toContain(':not(.setting-item-heading)');
    });

    it('⛔ 不许用裸 px 给输入框定宽（窄屏适配只允许主题变量 / % / em）', () => {
        const block = mediaBlock(719, SETTING_ROW);
        // 只查 input/select/dropdown 的 width —— 那些必须走 100% / 1 1 auto
        const widthRules = block.match(/width:\s*\d+px/g) ?? [];
        expect(widthRules).toEqual([]);
    });
});

describe('🔴 2026-11-14 m05673 · 桌面专属能力在移动端要说「不支持」而不是留白', () => {
    it('平台判据走 currentPlatform()，⛔ 不裸写 process.platform（手机端没有 process）', () => {
        const settings = strip(read('src/Settings.ts'));
        expect(settings).not.toContain('process.platform');
        expect(settings).toContain('currentPlatform()');
    });

    it('whisper 装不了时给的是「手机 / 平板暂不支持」，⛔ 不是「用你的包管理器安装」', () => {
        const rt = strip(read('src/pure/whisperRuntime.ts'));
        expect(rt).toContain('if (!platform) return');
        expect(rt).toContain('电脑版 Obsidian');
        // 空平台必须**先**被拦下，不能落到 macOS / Linux 那两句
        const emptyAt = rt.indexOf('if (!platform) return');
        const darwinAt = rt.indexOf("if (platform === 'darwin')");
        expect(emptyAt).toBeGreaterThan(-1);
        expect(emptyAt).toBeLessThan(darwinAt);
    });
});

describe('🔴 2026-11-14 m05673 · 失败页的样式必须存在（否则写了也不可见）', () => {
    const css = strip(read('styles.css'));

    it('`.rl-set-pagefail` 三个子类都有规则', () => {
        for (const cls of ['.rl-set-pagefail {', '.rl-set-pagefail-title', '.rl-set-pagefail-desc', '.rl-set-pagefail-detail']) {
            expect(css, `${cls} 缺失`).toContain(cls);
        }
    });

    it('详情文本可选中复制（用户要把报错贴给我们）', () => {
        const at = css.indexOf('.rl-set-pagefail-detail');
        const body = css.slice(at, css.indexOf('}', at));
        expect(body).toMatch(/user-select:\s*text/);
    });
});

describe('🔴 2026-11-14 m05673 · 「仅桌面端」徽标：名单一份、挂载一处、样式一份', () => {
    const css = strip(read('styles.css'));

    it('名单只住在 pure/platformGates（⛔ 别在 Settings.ts 里硬编码组名）', async () => {
        const gates = await import('pure/platformGates');
        expect(gates.DESKTOP_ONLY_GROUPS.length).toBeGreaterThan(0);
        // 桌面端永不标；移动端只有名单内的组才标
        for (const title of gates.DESKTOP_ONLY_GROUPS) {
            expect(gates.shouldMarkDesktopOnly(title, true), `${title} 在桌面不该标`).toBe(false);
            expect(gates.shouldMarkDesktopOnly(title, false), `${title} 在移动端该标`).toBe(true);
        }
        // 不在名单里的组（纯展示类）移动端也不标 —— 标多了会吓退用户
        expect(gates.shouldMarkDesktopOnly('外观与体验', false)).toBe(false);
        expect(gates.shouldMarkDesktopOnly('字段映射', false)).toBe(false);
    });

    it('徽标文案就是「仅桌面端」四个字（用户要的是「提示不支持」，不是含糊其辞）', async () => {
        const gates = await import('pure/platformGates');
        expect(gates.DESKTOP_ONLY_LABEL).toBe('仅桌面端');
        expect(gates.isDesktopOnlyGroup(gates.DESKTOP_ONLY_GROUPS[0])).toBe(true);
        expect(gates.isDesktopOnlyGroup('不存在的组')).toBe(false);
    });

    it('⚠️ 名单里的每个组名都必须在 Settings.ts 里真的被 createGroupSection 建出来', () => {
        const gates = read('src/pure/platformGates.ts');
        const settings = strip(read('src/Settings.ts'));
        const listed = [...gates.matchAll(/^\s*'([^']+)',\s*$/gm)].map((m) => m[1]);
        expect(listed.length).toBeGreaterThan(5);
        for (const title of listed) {
            expect(settings, `「${title}」在平台名单里，但 Settings.ts 里没有这一组`).toContain(
                `this.createGroupSection(parent, '${title}'`,
            );
        }
    });

    it('徽标挂在 createGroupSection 的标题行上（一处改动覆盖全部组）', () => {
        const settings = strip(read('src/Settings.ts'));
        expect(settings).toContain('shouldMarkDesktopOnly(title, Platform.isDesktopApp)');
        expect(settings).toContain('head.createSpan({ cls: \'rl-svc-group-badge-desktop\'');
        expect(settings).toContain("import { DESKTOP_ONLY_LABEL, shouldMarkDesktopOnly } from 'pure/platformGates';");
    });

    it('徽标样式全部走主题变量（⛔ 不写 hex；px 只允许发丝边框 1px）', () => {
        const at = css.indexOf('.rl-svc-group-badge-desktop');
        expect(at).toBeGreaterThan(-1);
        const body = css.slice(at, css.indexOf('}', at));
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        // 1px 发丝边框是全仓通行做法（border: 1px solid var(--…)），其余尺寸一律主题变量
        const pxRules = (body.match(/\d+px/g) ?? []).filter((x) => x !== '1px');
        expect(pxRules).toEqual([]);
        expect(body).toContain('var(--text-faint)');
        expect(body).toContain('var(--radius-s)');
    });
});
