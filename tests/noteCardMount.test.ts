// 笔记条目卡（` ```reelludic `）渲染层 —— 源码守卫
//
// 用户在 2026-11-16 第三次裁定的逐字口径：「加行内快捷编辑，不再恢复旧表格」。
// 本轮之前那个形态是 m07593 翻面后的「纯详情 + 标题旁编辑按钮」（卡内一个输入框都没有），
// 更早还试过「官方 `Setting` + 每行一个常驻控件」（用户嫌占地方，已否）。
//
// 🔴 本文件守的是**形态口径**，三条都不许回潮：
//   ① 值可点 ⇒ 就地换控件（`makeEditable` / `beginEdit` 必须存在，且入口按 `kind` 分流）；
//   ② **不是**常驻输入框：控件只在编辑中创建（⛔ 不许把 `Setting` / `addText` / `addDropdown` 搬回来）；
//   ③ ⛔ 不复活旧 Markdown 属性表格（`| 属性 | 内容 |` 那套的渲染痕迹一条都不许出现）。
//
// 另守**权责**：渲染层不碰 vault、不碰 `EntryService`，解析交给纯层 `applyNoteCardEdit`，
// 落库交给宿主注入的 `saveField`（`main.ts` 里 `service.update` + `writeNote`）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** 剥掉块注释与行注释（⛔ 本仓多次踩到「注释里逐字写实现形态污染断言」）。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MOUNT = stripComments(read('src/views/noteCardMount.ts'));
const MAIN = stripComments(read('main.ts'));

describe('noteCardMount · 行内快捷编辑（2026-11-16 第三次裁定）', () => {
    it('值可点：只读值渲染后接上就地编辑入口', () => {
        expect(MOUNT).toMatch(/function\s+makeEditable\(/);
        expect(MOUNT).toMatch(/val\.addClass\('is-editable'\)/);
        // 值元素必须是可聚焦的按钮语义（键盘用户不能只有鼠标）
        expect(MOUNT).toMatch(/val\.setAttribute\('role',\s*'button'\)/);
        expect(MOUNT).toMatch(/val\.tabIndex\s*=\s*0/);
    });

    it('入口按 kind 分流：枚举走 select、评分走五星、其余走 input', () => {
        expect(MOUNT).toMatch(/row\.kind === 'enum'/);
        expect(MOUNT).toMatch(/row\.kind === 'rating'/);
        expect(MOUNT).toMatch(/createEl\('select'/);
        expect(MOUNT).toMatch(/createEl\('input'/);
        // 数字/日期必须给对 input type（⛔ 全用 text 会让日期选择器消失）
        expect(MOUNT).toMatch(/row\.kind === 'number' \? 'number'/);
        expect(MOUNT).toMatch(/row\.kind === 'date' \? 'date'/);
    });

    it('只读行不给入口（与纯层 isReadonlyKey 口径对齐）', () => {
        expect(MOUNT).toMatch(/canEdit:\s*\(r\)\s*=>\s*r\.kind !== 'readonly'/);
        expect(MOUNT).toMatch(/if \(!host\.canEdit\(row\)\) return;/);
    });

    it('半星与单卡编辑属性同一判定（⛔ 别自己再写一套 offsetX 比较）', () => {
        expect(MOUNT).toMatch(/import \{ isHalfStarClick, normalizeRating \} from 'pure\/rating';/);
        expect(MOUNT).toMatch(/isHalfStarClick\(ev\.offsetX,/);
        expect(MOUNT).toMatch(/normalizeRating\(half \? s - 0\.5 : s\)/);
    });

    it('提交幂等：change 与 blur 不会重复落库', () => {
        // `settled` 必须在 submit 入口就短路（select 的 change + blur 会连着来两发）
        expect(MOUNT).toMatch(/const submit = \(raw: string\): void => \{\s*\n\s*if \(settled\) return;/);
    });

    it('编辑中不许重进 beginEdit（否则点下拉框会把它自己拆掉）', () => {
        // 🔴 2026-11-16 m00830 用户实测：「有些是选项不能选只能手打啊如心情」。
        // 根因：`select` / 星星 / 输入框都是 `val` 的子节点，点它们的事件冒泡回 `val` 的
        // click 监听 ⇒ 再进 `beginEdit` ⇒ `val.empty()` 把刚打开的控件销毁。
        // ⇒ 两个入口都必须先看 `is-editing`。
        const clicks = MOUNT.match(/if \(val\.hasClass\('is-editing'\)\) return;/g) ?? [];
        expect(clicks.length).toBeGreaterThanOrEqual(2);
        // 断言顺序：状态闸门必须在 `beginEdit(` 之前（写在后面等于没写）
        const clickIdx = MOUNT.indexOf("val.addEventListener('click'");
        const gateIdx = MOUNT.indexOf("if (val.hasClass('is-editing')) return;", clickIdx);
        const beginIdx = MOUNT.indexOf('beginEdit(val, row, host);', clickIdx);
        expect(clickIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeGreaterThan(clickIdx);
        expect(beginIdx).toBeGreaterThan(gateIdx);
    });

    it('被拒绝或被取消时回显原值（⛔ 不留一片空白）', () => {
        expect(MOUNT).toMatch(/const shown = displayValueOf\(row\) \|\| '—';/);
        expect(MOUNT).toMatch(/val\.setText\(shown\)/);
    });
});

describe('noteCardMount · 不回潮的老形态', () => {
    it('⛔ 不回到「官方 Setting + 每行常驻控件」那版', () => {
        expect(MOUNT).not.toMatch(/\bnew Setting\(/);
        expect(MOUNT).not.toMatch(/\.addText\(/);
        expect(MOUNT).not.toMatch(/\.addDropdown\(/);
        expect(MOUNT).not.toMatch(/\.addToggle\(/);
    });

    it('⛔ 不复活旧 Markdown 属性表格', () => {
        expect(MOUNT).not.toMatch(/\|\s*属性\s*\|/);
        expect(MOUNT).not.toMatch(/createEl\('table'|createEl\('tr'|createEl\('td'/);
    });

    it('版式只有一条渲染路径（首次加载与改完重画共用，⛔ 不许抄第二份）', () => {
        expect(MOUNT).toMatch(/private renderInto\(entry: MediaEntry\): void \{/);
        // `rl-notecard-split` 只许出现在 renderInto 里 —— 出现两次就是又抄了一份版式
        const splits = MOUNT.match(/rl-notecard-split/g) ?? [];
        expect(splits.length).toBe(1);
    });

    // 🔴 2026-11-16 用户 m01057：「笔记条目卡能不能分两栏就不会太长」
    //    结构口径：head（封面 + 标题，通栏）在上，body（七组属性）在下、按 CSS 多栏流成两列。
    //    ⛔ 退回「封面独占左栏 / 详情全挤右栏」＝右栏一长就顶穿整卡，那正是用户说的「太长」。
    it('两栏：head 通栏在上、body 平级在下（⛔ 不许把 body 塞进标题容器）', () => {
        const SRC = MOUNT;
        // head 直接挂在 split 下（封面与标题都进 head）
        expect(SRC).toMatch(/const head = split\.createDiv\(\{ cls: 'rl-notecard-head' \}\);/);
        expect(SRC).toMatch(/const cover = head\.createDiv\(\{ cls: 'rl-notecard-cover' \}\);/);
        expect(SRC).toMatch(/const titleRow = head\.createDiv\(\{ cls: 'rl-notecard-titlerow' \}\);/);
        // body 也直接挂在 split 下 —— 与 head 平级，不是 head/main 的子节点
        expect(SRC).toMatch(/const body = split\.createDiv\(\{ cls: 'rl-notecard-body' \}\);/);
        // ⛔ 旧的「右栏 main」容器已废：再出现就说明版式又退回左右两栏
        expect(SRC).not.toMatch(/rl-notecard-main/);
        expect(SRC).not.toMatch(/const main = split\.createDiv\(/);
    });
});

describe('noteCardMount · 权责分离', () => {
    it('渲染层不碰 vault、不碰 EntryService（写操作一律交宿主回调）', () => {
        // `MarkdownRenderChild` 是卸载链的基类，必须从 obsidian 拿 —— 这不是写盘能力
        expect(MOUNT).toMatch(/import \{ MarkdownRenderChild \} from 'obsidian';/);
        // 但真正的读写盘 API 一条都不许出现
        expect(MOUNT).not.toMatch(/app\.vault/);
        expect(MOUNT).not.toMatch(/\.vault\./);
        expect(MOUNT).not.toMatch(/processFrontMatter/);
        expect(MOUNT).not.toMatch(/FileManager/);
        expect(MOUNT).not.toMatch(/EntryService/);
    });

    it('落库出口是注入的 saveField，不是渲染层自己写盘', () => {
        expect(MOUNT).toMatch(/saveField\?: \(id: string, key: string, raw: string\) => Promise<MediaEntry \| undefined>;/);
        expect(MOUNT).toMatch(/await this\.opts\.saveField\(id, key, raw\)/);
        // `saveField` 缺省 ⇒ 不给编辑入口（退化成纯详情视图）
        expect(MOUNT).toMatch(/this\.opts\.saveField\s*\n?\s*\?/);
    });

    it('宿主侧解析走纯层 applyNoteCardEdit，落库走 update + writeNote', () => {
        expect(MAIN).toMatch(/import \{ NOTE_CARD_LANG, applyNoteCardEdit \} from 'pure\/noteCard';/);
        expect(MAIN).toMatch(/const patch = applyNoteCardEdit\(entry, key, raw\);/);
        // `null` = 拒绝（不可写 / 非法）⇒ 不许当成成功
        expect(MAIN).toMatch(/if \(!patch\) return undefined;/);
        expect(MAIN).toMatch(/saveField: \(id, key, raw\) => this\.saveNoteCardField\(id, key, raw\)/);
        expect(MAIN).toMatch(/const merged = await this\.service\.update\(entry\.id, patch\);/);
        expect(MAIN).toMatch(/await this\.service\.writeNote\(merged\.id\);/);
    });
});
