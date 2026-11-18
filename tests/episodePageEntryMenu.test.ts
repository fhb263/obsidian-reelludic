// 剧集页「简介封面右键菜单」的结构守卫。
//
// 🔴 由来（2026-11-08 用户指令）：「简介的封面可右键可弹窗菜单（同海报墙编辑属性逻辑）」。
//    用户当场选定的是**整个海报墙菜单**（不是只留「编辑属性」一项）
//    ⇒ 必须复用 `views/components/EntryContextMenu.svelte`，⛔ 不许在视图里重写一份菜单项。
//
// ⚠️ 为什么是源码文本守卫而不是行为测试：
//    `buildEntryMenu` / `openEntryMenu` / `buildInfoCard` 都是 `EpisodePageView` 的私有方法，
//    构造它要真的 Obsidian `App` + 完整 DOM + 工作区 leaf；而这次要锁的恰恰是**接线形状**
//    （谁被挂在谁身上、Esc 排第几、销毁有没有做），这些在行为测试里反而更容易假绿 ——
//    组件能弹出来，也不代表换片时旧实例的 window 监听被摘掉了。
//
// ⛔ 铁律（本仓已被自己的注释打穿三次：#379 / #730 / #731）：
//    先 strip 注释再匹配，否则注释里提到 `contextmenu` 也能让断言变绿。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EPISODE_COVER_MENU_HIDE } from 'pure/entryMenu';

const ROOT = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const page = stripComments(read('src/views/EpisodePageView.ts'));
const player = stripComments(read('src/views/VideoPlayerView.ts'));
const main = stripComments(read('main.ts'));
const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('pure/entryMenu · 详情页封面菜单隐藏口径', () => {
    it('🔴 只藏「观看 / 删除条目」两项（用户逐字点名，⛔ 不擅自扩大）', () => {
        expect([...EPISODE_COVER_MENU_HIDE]).toEqual(['watch', 'delete']);
    });

    it('其余八项都不在隐藏名单里', () => {
        for (const k of ['associate', 'edit', 'excerpt', 'comment', 'guide', 'rewatch', 'playthrough', 'time'] as const) {
            expect(EPISODE_COVER_MENU_HIDE).not.toContain(k);
        }
    });
});

describe('🔴 2026-11-08 简介封面右键菜单（复用海报墙同一个组件）', () => {
    it('🔴 必须复用 `views/components/EntryContextMenu.svelte`，⛔ 不许另写一份菜单', () => {
        expect(page).toMatch(/import EntryContextMenu from 'views\/components\/EntryContextMenu\.svelte';/);
        expect(page).toMatch(/new EntryContextMenu\(/);
        // 菜单项文案是海报墙那份的真源 —— 视图里出现这些字样就说明有人抄了一份菜单
        expect(page).not.toContain('编辑属性');
        expect(page).not.toContain('快速关联');
    });

    it('封面块挂的是 `.rl-epp-info-cov`（连裁切区一起响应），且先 preventDefault', () => {
        expect(page).toMatch(/cov\.addEventListener\('contextmenu'/);
        // 必须挡掉原生长按/右键菜单，且必须在派发之前（宿主回调是 async，等回来原生菜单已经弹了）
        const at = page.indexOf("cov.addEventListener('contextmenu'");
        expect(at).toBeGreaterThan(-1);
        const body = page.slice(at, at + 400);
        expect(body).toMatch(/ev\.preventDefault\(\)/);
        expect(body.indexOf('ev.preventDefault()')).toBeLessThan(body.indexOf('ev.stopPropagation()'));
        expect(body).toMatch(/this\.openEntryMenu\(ctx\.entry, ev\)/);
    });

    it('没注入 entryMenu 就不挂右键（别在半接管状态下弹空菜单）', () => {
        expect(page).toMatch(/entryMenu\?: EntryMenuActions;/);
        expect(page).toMatch(/if \(ctx\.entryMenu\) \{/);
        // `buildEntryMenu` 自己也要能空转
        expect(page).toMatch(/const actions = this\.pageCtx\?\.entryMenu;\s*\n\s*if \(!actions\) return;/);
    });

    it('宿主壳挂 body 且整层不吃点击（否则盖满整页把所有点击吞掉）', () => {
        expect(page).toMatch(/document\.body\.createDiv\(\{ cls: 'rl-epp-ctxhost' \}\)/);
        expect(css).toMatch(/\.rl-epp-ctxhost\s*\{[^}]*pointer-events:\s*none/);
        expect(css).toMatch(/\.rl-epp-ctxhost\s+\.rl-ctx\s*\{[^}]*pointer-events:\s*auto/);
        // 封面有右键提示光标
        expect(css).toMatch(/\.rl-epp-info-cov\s*\{[^}]*cursor:\s*context-menu/);
    });

    it('换片与关页都要销毁实例（`$destroy()` 摘不掉 body 壳 ⇒ 壳也得自己删）', () => {
        // 换片：`buildExtra` 里先销毁再重建（`buildUi()` 刚 empty 过，旧实例还挂着 window 监听）
        expect(page).toMatch(/this\.destroyEntryMenu\(\);\s*\n\s*this\.buildEntryMenu\(\);/);
        // 关页：`onClose` 里必须销毁
        expect(page).toMatch(/onClose\(\)[\s\S]{0,600}destroyEntryMenu\(\)[\s\S]{0,200}await super\.onClose\(\)/);
        // 销毁体本身要三件事都做：$destroy / 摘壳 / 复位开关
        expect(page).toMatch(/\$destroy\(\)[\s\S]{0,300}entryMenuHost\?\.remove\(\)/);
    });

    it('🔴 Esc 链最前面先收本菜单（与组件自己的 window keydown 双触发会一次关两层）', () => {
        expect(player).toMatch(/protected closeExtraOverlay\(\): boolean \{\s*\n\s*return false;/);
        const at = player.indexOf("scope.register([], 'Escape'");
        expect(at).toBeGreaterThan(-1);
        const body = player.slice(at, at + 500);
        expect(body).toMatch(/if \(this\.closeExtraOverlay\(\)\) return false;/);
        // 必须排在 lightbox / menuKind / drawer 之前
        expect(body.indexOf('closeExtraOverlay()')).toBeLessThan(body.indexOf('lightboxOpen()'));
        expect(body.indexOf('closeExtraOverlay()')).toBeLessThan(body.indexOf('menuKind'));
    });

    it('视图只转发动作，不自己决定菜单项：宿主把 7 条回调整套注入', () => {
        for (const key of [
            'onWatch',
            'onQuickAssociate',
            'onEditEntry',
            'onAddExcerpt',
            'onOpenEntryLogModal',
            'onOpenEntryTextModal',
            'onDeleteEntry',
        ]) {
            expect(page).toMatch(new RegExp(`${key}:\\s*\\(`));
            // ⚠️ 参数名不统一：`(e)` / `(id)` / `(e, kind)` 都有 ⇒ 别写死 `e`
            expect(main).toMatch(new RegExp(`${key}:\\s*\\([^)]*\\)\\s*=>`));
        }
        // 宿主侧每条都得落到真入口（⛔ 不许占位空实现）
        expect(main).toMatch(/onEditEntry: \(id\) => void this\.openEditModal\(id\)/);
        expect(main).toMatch(/onWatch: \(e\) => this\.runEntryAction\(e\)/);
        expect(main).toMatch(/onDeleteEntry: \(id\) => this\.deleteEntry\(id\)/);
    });

    it('🔴 编辑属性保存后选集页要立刻更新（不能只剩「重开页面才看见」）', () => {
        // 视图侧：只重画标题块 + 简介卡，⛔ 不整页重开（那会重建播放器、打断播放）
        expect(page).toMatch(/refreshEntrySnapshot\(entry: MediaEntry, coverUrl: string \| null\): void/);
        expect(page).toMatch(/if \(!ctx \|\| ctx\.entry\.id !== entry\.id\) return;/);
        // 宿主侧：`refreshViews()` 必须顺带刷选集页，且没开页时零开销
        expect(main).toMatch(/await this\.refreshEpisodePages\(\);/);
        expect(main).toMatch(
            /const leaves = this\.app\.workspace\.getLeavesOfType\(EPISODE_PAGE_VIEW_TYPE\);\s*\n\s*if \(!leaves\.length\) return;/
        );
        expect(main).toMatch(/v\.refreshEntrySnapshot\(latest, cover\)/);
    });

    it('🔴 详情页封面菜单要藏「观看 / 删除条目」（用户 2026-11-08 点名两项）', () => {
        // 口径只在纯模块里定义一次，视图只引用常量
        expect(page).toMatch(/hideItems: EPISODE_COVER_MENU_HIDE/);
        expect(page).toMatch(/import \{ EPISODE_COVER_MENU_HIDE \} from 'pure\/entryMenu';/);
        // ⛔ 不许在视图里散写这两个键（那就成了第二份口径）
        expect(page).not.toMatch(/hideItems:\s*\[/);
    });

    it('菜单组件支持按场景隐藏，且被隐藏的项连分割线一起收', () => {
        const menu = stripComments(read('src/views/components/EntryContextMenu.svelte'));
        expect(menu).toMatch(/export let hideItems: readonly EntryMenuHideKey\[\] = \[\];/);
        expect(menu).toMatch(/function hidden\(key: EntryMenuHideKey\): boolean/);
        // 每一项都得过 hidden() 判据，⛔ 不能只藏按钮不藏线
        for (const key of ['watch', 'associate', 'edit', 'delete']) {
            expect(menu).toContain(`!hidden('${key}')`);
        }
        // 三组各自算「这组还有没有项」，线跟着组走
        expect(menu).toMatch(/const sec1 = !hidden\('watch'\) \|\| !hidden\('associate'\)/);
        expect(menu).toMatch(/const sec3 = !hidden\('delete'\)/);
        expect(menu).toMatch(/\{#if sec1\}<div class="rl-ctx-sep"><\/div>\{\/if\}/);
        expect(menu).toMatch(/\{#if sec2 && sec3\}<div class="rl-ctx-sep"><\/div>\{\/if\}/);
    });

    it('默认不隐藏任何项（海报墙行为不受影响）', () => {
        // 组件默认值必须是空数组：其它调用点（MediaList / CollectionBoard）不传参也得看到全套
        const menu = stripComments(read('src/views/components/EntryContextMenu.svelte'));
        expect(menu).toMatch(/hideItems[^=]*=\s*\[\];/);
        // 海报墙那处调用⛔ 不该传 hideItems
        const list = stripComments(read('src/views/components/MediaList.svelte'));
        expect(list).not.toContain('hideItems');
    });
});

describe('🔴 2026-11-08 「全部 N 部」搬到系列标题行', () => {
    it('入口建在 `head` 上，而不是横带体内', () => {
        expect(page).toMatch(/this\.seasonsMoreEl = seaSec\.head\.createDiv\(\{ cls: 'rl-epp-seasonsmore' \}\)/);
        // ⛔ 旧的 `box.createDiv({ cls: 'rl-epp-seasonsmore' ... })` 必须绝迹
        expect(page).not.toMatch(/box\.createDiv\(\{ cls: 'rl-epp-seasonsmore'/);
    });

    it('监听只挂一次（槽在 `buildLow` 建），文案由 `buildSeasons` 回填', () => {
        // 监听挂在建槽处，且带 stopPropagation
        expect(page).toMatch(
            /this\.seasonsMoreEl\.addEventListener\('click',[\s\S]{0,200}ev\.stopPropagation\(\)/
        );
        expect(page).toMatch(/this\.pageCtx\?\.onOpenSeriesList\(\)/);
        // ⛔ 重画路径里不许再给**那个槽**挂监听（会随每次重画叠一个 ⇒ 点一下开两遍）。
        //    ⚠️ 别写成「函数体里没有 addEventListener('click')」——季卡自己的点击监听
        //      就在同一个函数里，那样写会把正常的卡点击也判成违规。
        const at = page.indexOf('private buildSeasons(');
        const body = page.slice(at, at + 2600);
        expect(body).not.toMatch(/more\.addEventListener/);
        expect(body).not.toMatch(/seasonsMoreEl[^;]*addEventListener/);
        // 文案在这里回填
        expect(body).toMatch(/more\.setText\(`全部 \$\{others\.length \+ 1\} 部`\)/);
    });

    it('没有同系列作品时，标题行入口也一起藏（别漂着一个「全部 1 部」）', () => {
        expect(page).toMatch(/more\.toggleClass\('is-empty', others\.length === 0\)/);
        expect(css).toMatch(/\.rl-epp-seasonsmore\.is-empty\s*\{\s*display:\s*none/);
    });

    it('样式改成「顶到标题行最右」，不再靠 align-self 站横带末尾', () => {
        expect(css).toMatch(/\.rl-epp-seasonsmore\s*\{[^}]*margin-left:\s*auto/);
        expect(css).not.toMatch(/\.rl-epp-seasonsmore\s*\{[^}]*align-self:\s*flex-end/);
    });
});
