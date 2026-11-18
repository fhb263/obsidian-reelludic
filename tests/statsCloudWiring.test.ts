/**
 * 统计页标签词云接线守卫（②-3，用户 m00353）。
 *
 * 为什么需要这层：`pure/wordCloud` 19 例单测只证明**算法**对，
 * 但「区块有没有真的挂进统计页」tsc 抓不到 —— 少写一个 `{#if k === 'cloud'}` 分支，
 * 类型全绿、单测全绿、页面上就是没有词云。这里按源码文本钉住接线。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOUD_HUE_COUNT } from '../src/pure/wordCloud';

const ROOT = join(__dirname, '..');
const board = readFileSync(join(ROOT, 'src/views/components/StatsBoard.svelte'), 'utf8');
const layout = readFileSync(join(ROOT, 'src/pure/statsLayout.ts'), 'utf8');

/** 剥掉注释再断言：本仓源码里到处是「⛔ 别写 …」的说明，会撞关键词 */
function stripComments(src: string): string {
    return src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const BOARD = stripComments(board);
const LAYOUT = stripComments(layout);

describe('标签词云 · 区块接线（②-3）', () => {
    it('`statsLayout` 里有 cloud 这个键，且缺省顺序把它放在**末尾**', () => {
        expect(LAYOUT).toContain("'cloud'");
        // 末尾而不是插在中间：老用户 statsOrder 里没这个键，normalize 补到末尾，缺省也必须在末尾
        expect(LAYOUT).toMatch(/STATS_BLOCK_DEFAULTS[^=]*=\s*\[[^\]]*'cloud'\]/);
    });

    it('展示名、半栏最小宽度都有 cloud（漏一个就 tsc 红，但仍钉一次防手滑）', () => {
        expect(LAYOUT).toMatch(/STATS_BLOCK_LABELS[\s\S]*?cloud:\s*'标签词云'/);
        expect(LAYOUT).toMatch(/STATS_BLOCK_MIN_HALF[\s\S]*?cloud:\s*\d+/);
    });

    it('StatsBoard 真的渲染了 cloud 分支，且调的是 `buildWordCloud`', () => {
        expect(BOARD).toMatch(/\{#if k === 'cloud'\}/);
        // 🔴 2026-11-16 第三次裁定（④）：自定义视图的归属标签要从词云里排除
        //   ⇒ 调用升级为 `buildWordCloud(entries, WORD_CLOUD_MAX, discardTags)`，
        //     第三个参数就是「视图归属标签」排除集合（由 `HomeView` 经 `customViewTagPool` 喂进来）。
        //   钉「调了纯层且把排除集合传下去」，⛔ 不钉字面参数个数（那会挡掉以后的参数升级）。
        expect(BOARD).toMatch(/buildWordCloud\(\s*entries\b[^)]*discardTags\s*\)/);
        expect(BOARD).toMatch(/export let discardTags: string\[\] = \[\];/);
    });

    it('🔴 字号档位来自 `w.level`，⛔ 不许在模板里另算频次排行', () => {
        // ⚠️ 用正则而不是全等：m05266 之后 class 串里多了 `hue-*`（色相）与 `is-abs`（螺旋态），
        //    钉全等字符串会让「加一个无关的类名」也变成红 —— 那是脆断言，钉的是字面不是行为。
        expect(BOARD).toMatch(/class="rl-cloud-w[^"]*\blv-\{w\.level\}/);
        // 反向守卫：模板里出现 `w.weight >` 之类的就地分档 ⇒ 说明有人把口径搬回视图了
        expect(BOARD).not.toMatch(/w\.weight\s*[<>]/);
    });

    it('空态分两态：没条目 vs 有条目但没打标签（后者才指路怎么打标签）', () => {
        expect(BOARD).toContain('cloudHasEntries');
        expect(BOARD).toMatch(/还没有条目打过标签/);
        expect(BOARD).toMatch(/还没有条目/);
    });

    it('CSS 五档档位齐全，且字号用相对单位（⛔ 写 px 会跟不动 Obsidian 的界面字号设置）', () => {
        for (const lv of [1, 2, 3, 4, 5]) {
            expect(BOARD).toMatch(new RegExp(`\\.rl-cloud-w\\.lv-${lv}\\s*\\{[^}]*font-size:\\s*[\\d.]+em`));
        }
        // 反向守卫：词云区块里不许出现 px 字号
        const cloudCss = BOARD.slice(BOARD.indexOf('.rl-cloud-body'));
        expect(cloudCss.slice(0, 1200)).not.toMatch(/\.rl-cloud-w[^{]*\{[^}]*font-size:\s*\d+px/);
    });

    it('🔴 词云按文本分配色相（m05266「加更多的颜色」），⛔ 无裸 hex / rgb()', () => {
        const cloudCss = BOARD.slice(BOARD.indexOf('.rl-cloud-body'), BOARD.indexOf('.rl-cloud-body') + 2600);
        // 八个色相桶必须齐（漏一个 ⇒ 该桶的词掉回正文色，看起来像坏了）
        for (let h = 0; h < CLOUD_HUE_COUNT; h++) {
            expect(BOARD).toMatch(new RegExp(`\\.rl-cloud-w\\.hue-${h}\\s*\\{\\s*--rl-cloud-hue:\\s*var\\(--color-`));
        }
        // 颜色必须走主题令牌，⛔ 不许写死（主题换了词云得跟着变）
        expect(cloudCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(cloudCss).not.toMatch(/rgba?\(/);
        expect(cloudCss).not.toMatch(/hsl\(/);
        // 反向守卫：色相不得用来编码频次（频次只由 lv-N 的字号表达，两套编码会打架）
        // ⚠️ 用 `[^}]*` 而不是 `\{\s*` —— 频次类色相是追加在规则**末尾**的写法，
        //    要求紧跟 `{` 会让「末尾偷偷加一行 --rl-cloud-hue」溜过去（突变实测：假绿）。
        // 🔴 必须钉**赋值形态** `--rl-cloud-hue\s*:`，不能只写变量名：低频档那条
        //    `.rl-cloud-w.lv-1, .rl-cloud-w.lv-2 { color: color-mix(in srgb, var(--rl-cloud-hue, …) …) }`
        //    是在**引用**色相（合法 —— 低频词收淡要读它），裸变量名会把「引用」误判成「赋值」（实测红）。
        expect(BOARD).not.toMatch(/\.rl-cloud-w\.lv-\d+\s*\{[^}]*--rl-cloud-hue\s*:/);
        // 色相必须由**文本**算，⛔ 不许按数组下标取（下标会让重新排序后所有词换色）
        expect(BOARD).toMatch(/hue-\{cloudHueIndexOf\(w\.text\)\}/);
        expect(BOARD).not.toMatch(/hue-\{[^}]*indexOf\(w\)[^}]*\}/);
    });

    it('🔴 删掉了丢词提示，改为 Ctrl+滚轮缩放（m05266）', () => {
        expect(BOARD).not.toMatch(/rl-cloud-drop/);
        expect(BOARD).not.toMatch(/没塞进这块空间/);
        // 缩放必须复用评分看板那个开关，⛔ 不许新开设置项
        expect(BOARD).toMatch(/function onCloudWheel\(ev: WheelEvent\)/);
        expect(BOARD).toMatch(/if \(!ctrlWheelZoom \|\| !ev\.ctrlKey\) return;/);
        expect(BOARD).toMatch(/on:wheel=\{onCloudWheel\}/);
        // 缩放要真的进到摆放的字号里，否则手势毫无效果
        expect(BOARD).toMatch(/basePx:\s*cloudBasePx\s*\*\s*cloudZoom/);
    });

    it('prefers-reduced-motion 关掉角标淡入', () => {
        expect(BOARD).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.rl-cloud-n\s*\{\s*transition:\s*none/);
    });
});

/**
 * 🔴🔴 2026-11-15 用户 m04255（逐字）：「表单只有归属标签，没有标签能被词云统计啊」
 *
 * 词云统计的就是 `MediaEntry.tags`，表单里那一栏绑的也是 `tags` —— 数据没错，
 * **错在名字**：词云空态指引写「在条目编辑表单的『标签』里填几个词」，表单 label 却叫「归属标签」，
 * 用户照字面找「标签」找不到，自然以为没有可填的标签。
 *
 * 这里钉的是「两处叫同一个名字」这件事本身。⛔ 未来若再改名，必须两边一起改，
 * 否则用户又会看到「指引里说的框不存在」。
 */
describe('标签栏 · 表单与词云必须叫同一个名字（m04255 → m04293）', () => {
    // ⚠️ 这里**不能用 `stripComments`**：`EntryForm.svelte` 有 6895 行，块注释正则
    //    `/\/\*[\s\S]*?\*\//` 会从最前面的 `/*` 一路吃掉到很后面，把整段模板删掉
    //    （本轮实测：剥完 `indexOf('data-fld="tags"')` 直接 -1）。
    //    改用原文 + 精确到引号/尖括号的模式，注释里提到旧名也撞不上。
    const formRaw = readFileSync(join(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
    const registryRaw = readFileSync(join(ROOT, 'src/pure/entryFormFields.ts'), 'utf8');

    it('🔴 表单 label 与字段注册表都叫「标签」，⛔ 不再带「归属」前缀', () => {
        expect(formRaw).toMatch(/for="rl-f-tags">标签</);
        expect(registryRaw).toMatch(/key:\s*'tags',\s*label:\s*'标签'/);
        // 反向守卫用 `>归属标签<` / `label: '归属标签'` 这种**精确形态**，
        // ⛔ 不用裸 `归属标签` —— 源码注释里会引述旧名，裸匹配会假红。
        expect(formRaw).not.toMatch(/>归属标签</);
        expect(registryRaw).not.toMatch(/label:\s*'归属标签'/);
    });

    it('🔴 合集同理：叫「合集」，⛔ 不再叫「归属合集」', () => {
        expect(formRaw).toMatch(/for="rl-f-collection">合集</);
        expect(registryRaw).toMatch(/key:\s*'collection',\s*label:\s*'合集'/);
        expect(formRaw).not.toMatch(/>归属合集</);
        expect(registryRaw).not.toMatch(/label:\s*'归属合集'/);
    });

    it('🔴 词云空态指引提到的名字，必须就是表单上的名字（这是本 bug 的**根因**）', () => {
        const hint = BOARD.match(/在条目编辑表单的「([^」]+)」里填几个词/);
        expect(hint, '空态指引里必须写清去哪个框填').toBeTruthy();
        // 指引里那个词，必须能在表单 label 上逐字找到 —— 否则用户就是照着指引找不到框
        expect(formRaw).toContain(`>${hint![1]}<`);
        expect(hint![1]).toBe('标签');
    });

    it('标签栏仍然绑在 `tags` / `collection` 上（⛔ 只改显示名，别把落盘字段一起改了）', () => {
        // ⚠️ 窗口给 400 字符：`data-fld` → `label` → `input` 三行加起来约 200 字符，
        //    卡 160 会假红（本轮实测：这条第一次就是这么挂的）。
        expect(formRaw).toMatch(/data-fld="tags"[\s\S]{0,400}bind:value=\{tagsText\}/);
        expect(formRaw).toMatch(/data-fld="collection"[\s\S]{0,400}bind:value=\{collection\}/);
        expect(registryRaw).toMatch(/key:\s*'tags'/);
        expect(registryRaw).toMatch(/key:\s*'collection'/);
    });
});

