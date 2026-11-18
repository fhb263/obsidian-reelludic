// 「内嵌播放页」手动填写入口的守卫（2026-11-16 用户 m04805）。
//
// 为什么有这个文件：`gameEmbed` 是**先有自动写入、后补 UI** 的字段 ——
// 「获取」解析到 Unity / H5 页时（`main.ts` 的 H5 分支）会自己写进去，
// 但编辑表单与快捷关联弹窗里**一个字都没有**，用户 m04805 逐字问：
// 「还是内嵌游玩的怎么链接填在哪里了没看到」。本文件钉住补齐后的三件事：
//
//   ① 编辑表单有第四行「内嵌播放页」（`#rl-f-gameembed` + 粘贴按钮 + 自动保存键 `game:embed`）；
//   ② 「▶ 启动」认它 —— 只填内嵌地址时点启动必须走 `onLaunchGame`，
//      ⛔ 别退回「未关联启动入口」那条提示（那是 m04805 之前的真 bug）；
//   ③ 提交时恒写 `input.gameEmbed`（清空则落 undefined ⇒ 真能清掉旧值），
//      ⛔ 别写成「只有非空才写」，那样清不掉。
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const FORM = readFileSync(new URL('../src/views/components/EntryForm.svelte', import.meta.url), 'utf8');
const KEYS = readFileSync(new URL('../src/pure/popoverAutoSave.ts', import.meta.url), 'utf8');

/** 剥掉注释：本仓注释里大量引用「用户原话」，直接 `not.toContain` 会被自己的注释打红。 */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FORM_CODE = stripComments(FORM);

describe('内嵌播放页：UI 入口（之前只有自动写入，没有手动填写的地方）', () => {
    it('自动保存键空间里有 game:embed（拼错 = 提示落错行，静默）', () => {
        expect(KEYS).toMatch(/gameEmbed: 'game:embed',/);
        // 注释要写明它与 gameUrl 不是一回事，免得后来人合并两个键
        expect(KEYS).toMatch(/与\s*`gameUrl`\s*（商店页/);
    });

    it('表单有状态位、缓冲位，且打开浮层时会被灌值', () => {
        expect(FORM).toMatch(/let gameEmbed = entry\?\.gameEmbed \?\? '';/);
        expect(FORM).toMatch(/let gameEmbedVal = '';/);
        expect(FORM).toMatch(/gameEmbedVal = gameEmbed;/);
    });

    it('提交时四条缓冲各自写回（⛔ 别漏 embed —— 漏了就是「填了不生效」）', () => {
        expect(FORM).toMatch(/function commitGameEditor\(\): void \{/);
        expect(FORM).toMatch(/gameEmbed = gameEmbedVal\.trim\(\);/);
    });

    it('自动保存的字段联合类型与取值链都扩到四路', () => {
        expect(FORM).toMatch(/function autoSaveGame\(field: 'launch' \| 'url' \| 'swf' \| 'embed', force = false\): void \{/);
        expect(FORM).toMatch(/: gameEmbedVal;/);
        expect(FORM).toMatch(/: gameEmbed;/);
        expect(FORM).toMatch(/embed: AUTOSAVE_KEYS\.gameEmbed,/);
    });

    it('浮层里有独立的第四行：label 带 for、input 带 id（裸写会多报 A11y 破 89 基线）', () => {
        expect(FORM).toMatch(/<label class="rl-lbl-inline" for="rl-f-gameembed">内嵌播放页<\/label>/);
        expect(FORM).toMatch(/<input id="rl-f-gameembed" class="rl-input rl-ep-edit-input" value=\{gameEmbedVal\}/);
        expect(FORM).toMatch(/on:blur=\{\(\) => autoSaveGame\('embed'\)\}/);
        // 这一行的就地提示挂在 gameEmbed 键上
        expect(FORM).toMatch(/savedKey === AUTOSAVE_KEYS\.gameEmbed/);
    });

    it('有粘贴按钮（地址多半从浏览器地址栏复制来）', () => {
        expect(FORM).toMatch(/async function pasteGameEmbed\(\): Promise<void> \{/);
        expect(FORM).toMatch(/gameEmbedVal = v;/);
        expect(FORM).toMatch(/autoSaveGame\('embed', true\);/);
        expect(FORM).toMatch(/on:click=\{\(\) => void pasteGameEmbed\(\)\}/);
    });

    it('🔴 「▶ 启动」认内嵌地址 —— 只填它也要能启动', () => {
        expect(FORM).toMatch(/if \(gameSwf\.trim\(\) \|\| gameEmbed\.trim\(\) \|\| gameLaunchPath\.trim\(\)\) \{/);
        // 反向：⛔ 别退回只判两条的老写法
        expect(FORM_CODE).not.toMatch(/if \(gameSwf\.trim\(\) \|\| gameLaunchPath\.trim\(\)\) \{/);
    });

    it('启动按钮的提示与「已关联」高亮都算上内嵌地址', () => {
        expect(FORM).toMatch(/gameEmbed\.trim\(\) \? `内嵌播放页：\$\{gameEmbed\}/);
        expect(FORM).toMatch(
            /class:linked=\{!!gameSwf\.trim\(\) \|\| !!gameEmbed\.trim\(\) \|\| !!gameLaunchPath\.trim\(\) \|\| !!gameUrl\.trim\(\)\}/,
        );
    });

    it('提交块恒写 input.gameEmbed（清空要能落 undefined）', () => {
        expect(FORM).toMatch(/input\.gameEmbed = gameEmbed\.trim\(\) \|\| undefined;/);
    });
});

const QA = readFileSync(new URL('../src/modals/QuickAssociateModal.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

describe('内嵌播放页：快捷关联弹窗 + 宿主落库（用户多半从这个入口进）', () => {
    it('快捷关联结果里有 gameEmbed 字段', () => {
        expect(QA).toMatch(/gameEmbed\?: string;/);
    });

    it('弹窗建了独立一行「内嵌播放页」（game 类型总是建：纯输入框，不需要注入能力）', () => {
        expect(QA).toMatch(/embedLbl\.createDiv\(\{ cls: 'rl-qa-lbl', text: '内嵌播放页' \}\);/);
        expect(QA).toMatch(/this\.singleEmbedInput = embedRow\.createEl\('input', \{/);
        expect(QA).toMatch(/this\.singleEmbedInput\.value = this\.entry\.gameEmbed \?\? '';/);
        // 只在 game 类型建
        expect(QA).toMatch(/if \(t === 'game'\) \{\s*\n\s*const embedLbl/);
    });

    it('输入时能归到 embed 这一档（否则提示会闪到别的行）', () => {
        expect(QA).toMatch(/t === this\.singleEmbedInput \? 'embed'/);
        expect(QA).toMatch(/private lastField: 'url' \| 'local' \| 'sub' \| 'swf' \| 'embed' \| 'other' = 'other';/);
        expect(QA).toMatch(/'url' \| 'local' \| 'sub' \| 'swf' \| 'embed'/);
    });

    it('收集结果时产出 gameEmbed（没建那行就不产出，不冲旧值）', () => {
        expect(QA).toMatch(/if \(this\.singleEmbedInput\) r\.gameEmbed = this\.singleEmbedInput\.value\.trim\(\) \|\| undefined;/);
    });

    it('宿主落库用 !== undefined 判定（⛔ 别写成会冲掉旧值的写法）', () => {
        expect(MAIN).toMatch(/if \(r\.gameEmbed !== undefined\) patch\.gameEmbed = r\.gameEmbed\.trim\(\) \|\| undefined;/);
        expect(MAIN).not.toMatch(/patch\.gameEmbed = r\.gameEmbed\?\.trim\(\) \|\| undefined;/);
    });
});
