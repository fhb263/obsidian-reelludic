// @vitest-environment node
//
// 🔴 m03288（用户逐字）：「音乐系列卡封面加个播放按钮，点击即仅播放该系列的音乐，
//    顺序乱序播放该系列的音乐（原来选系列中的一条音乐条目播放的窗口删除掉）」
//
// 本文件钉死三件事，任一条被改回去都要红：
//  ⑴ 音乐系列**不再**走「选季弹窗」—— 点播放直接进 `playSeriesMusic`；
//  ② 那个队列**只收本系列成员**（⛔ 别退回全库队列，否则点系列卡会串进别的专辑）；
//  ③ 起播模式是 `shuffle`，但**只影响本次**，不写回 `settings.audioPlayMode`（⛔ 别改成持久化）。
//
// ⚠️ 断言一律跑**剥注释后**的源码：`main.ts` 与 `MediaList.svelte` 的注释里就写着
//    `SeriesPickerModal` / `可切换 N 部/季` / `shuffle` 这些字面量，拿原文断言会自己命中自己。
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
function read(rel: string): string {
    return readFileSync(`${ROOT}/${rel}`, 'utf8');
}

/** 剥掉 `/* ... *\/` 与 `//` 行注释；`//` 前用 `[^:]` 保护 `https://` 不被误伤。 */
function stripTsComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Svelte：模板注释是 `<!-- -->`；script/style 里的 `/* *\/`、`//` 一并剥。 */
function stripSvelteComments(code: string): string {
    return code
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 从 `marker` 起取出一段配平了 `{}` 的代码块（找不到就返回空串，让断言自然红）。
 *
 * ⚠️ `bodyAnchor` 必须是**函数体开头**那个 `{` 的原文片段，⛔ 别只给函数名 ——
 *    `buildAudioPlayerOptions` 的参数类型里就有 `only?: { ... }`，
 *    从函数名往后找第一个 `{` 会命中**类型字面量**，取出来的是半截签名而不是函数体。
 */
function balancedBlock(code: string, from: string, bodyAnchor: string = from): string {
    const at = code.indexOf(from);
    if (at < 0) return '';
    const anchorAt = code.indexOf(bodyAnchor, at);
    if (anchorAt < 0) return '';
    const open = anchorAt + bodyAnchor.length - 1;
    if (code[open] !== '{') return '';
    let depth = 0;
    for (let i = open; i < code.length; i++) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return code.slice(at, i + 1);
        }
    }
    return '';
}

const MAIN = stripTsComments(read('main.ts'));
const LIST = stripSvelteComments(read('src/views/components/MediaList.svelte'));

const OPEN_PICKER = balancedBlock(MAIN, 'openSeriesPicker(group: SeriesGroup): void {');
const PLAY_SERIES = balancedBlock(MAIN, 'private async playSeriesMusic(group: SeriesGroup): Promise<void> {');
const BUILD_OPTS = balancedBlock(MAIN, 'private async buildAudioPlayerOptions(', '): Promise<AudioPlayerOptions | null> {');

describe('音乐系列卡「播放整个系列」—— 宿主分流', () => {
    it('openSeriesPicker 里音乐走 playSeriesMusic，且**在**选季弹窗之前 return', () => {
        expect(OPEN_PICKER).not.toBe('');
        expect(PLAY_SERIES).not.toBe('');

        const musicAt = OPEN_PICKER.indexOf("group.type === 'music'");
        const pickerAt = OPEN_PICKER.indexOf('new SeriesPickerModal');
        expect(musicAt).toBeGreaterThanOrEqual(0);
        expect(pickerAt).toBeGreaterThanOrEqual(0);
        // 分流必须排在弹窗前面；排在后面等于「先弹窗再判断」，用户照样看见那个窗。
        expect(musicAt).toBeLessThan(pickerAt);

        // 音乐分支内必须直接 `void this.playSeriesMusic(group)`，紧接着 return。
        expect(OPEN_PICKER).toMatch(
            /if\s*\(\s*group\.type\s*===\s*'music'\s*\)\s*\{\s*void\s+this\.playSeriesMusic\(group\)\s*;\s*return\s*;\s*\}/,
        );
    });

    it('⚠️ 反向守卫：音乐分支体内 ⛔ 不许出现 SeriesPickerModal', () => {
        // 从现在位置切到 `void this.playSeriesMusic` 之前那段（就是音乐分支体），里面只应有播放调用。
        const branchStart = OPEN_PICKER.indexOf("group.type === 'music'");
        const callAt = OPEN_PICKER.indexOf('void this.playSeriesMusic(group)');
        expect(callAt).toBeGreaterThan(branchStart);
        const branch = OPEN_PICKER.slice(branchStart, callAt);
        expect(branch).not.toContain('SeriesPickerModal');
    });

    it('影视/动画仍走旧的选季弹窗（本次只改音乐，⛔ 波及其它类型）', () => {
        expect(OPEN_PICKER).toContain('new SeriesPickerModal(this.app, this, group).open()');
        // 单选组仍直接进那一部（影视/动画那条既有短路口径没被动）
        expect(OPEN_PICKER).toContain('void this.openEpisodePageFor(items[0])');
    });
});

describe('音乐系列卡「播放整个系列」—— 队列只收本组 + 乱序起播', () => {
    it('playSeriesMusic 用 onlyEntryIds 把队列裁到本组成员', () => {
        expect(PLAY_SERIES).not.toBe('');
        expect(PLAY_SERIES).toContain('onlyEntryIds: ids');
        // 集合来自 group.items 的 id
        expect(PLAY_SERIES).toMatch(/new Set\(\s*items\.map\(/);
        expect(PLAY_SERIES).toContain('this.buildAudioPlayerOptions(');
    });

    it('起播模式 = shuffle（用户要的「乱序」）', () => {
        expect(PLAY_SERIES).toContain("initialMode: 'shuffle'");
        // 判据真源仍是 pure/audioQueue 的字面量，别在这里自己编字符串
        const QUEUE = stripTsComments(read('src/pure/audioQueue.ts'));
        expect(QUEUE).toContain("'shuffle'");
    });

    it('⚠️ shuffle 只影响本次队列：⛔ 不许写回 settings.audioPlayMode', () => {
        expect(PLAY_SERIES).not.toContain('audioPlayMode');
        expect(PLAY_SERIES).not.toContain('persistAudioSetting');
    });

    it('组内无可播音频时有明确提示（⛔ 不许静默什么都不发生）', () => {
        expect(PLAY_SERIES).toContain('new Notice(');
        expect(PLAY_SERIES).toMatch(/if\s*\(\s*!opts\s*\)/);
    });

    it('落点与 playAudioEntry 同口径：侧边栏有播放器就就地切歌', () => {
        expect(PLAY_SERIES).toContain('this.findSidebarAudioPlayer()');
        expect(PLAY_SERIES).toContain('side.view.openWith(opts)');
        // 侧边栏折叠时要展开（否则只听见声音找不到播放器）
        expect(PLAY_SERIES).toContain('rightSplit?.collapsed');
    });
});

describe('buildAudioPlayerOptions —— 默认口径必须与改前逐字一致', () => {
    it('新增参数是可选的（老调用点不传也不报错）', () => {
        expect(BUILD_OPTS).not.toBe('');
        expect(BUILD_OPTS).toMatch(/only\?:\s*\{\s*onlyEntryIds\?:\s*ReadonlySet<string>;\s*initialMode\?:\s*AudioPlayMode\s*\}/);
    });

    it('只在传了 onlyEntryIds 时才裁队列；不传 = 全库（老路径）', () => {
        // 判据必须写成 `onlyIds && !onlyIds.has(e.id)` —— 光看 has 会把「没传」也当成「不在集合里」
        expect(BUILD_OPTS).toContain('if (onlyIds && !onlyIds.has(e.id)) continue;');
        expect(BUILD_OPTS).toMatch(/const onlyIds = only\?\.onlyEntryIds \?\? null;/);
    });

    it('initialMode 支持覆盖，缺省仍读设置', () => {
        expect(BUILD_OPTS).toContain('only?.initialMode ?? normalizeAudioPlayMode(this.settings.audioPlayMode)');
    });

    it('⚠️ 反向守卫：音乐队列筛选⛔ 不能只按 series 名匹配（那会漏掉改名/大小写/空白差异）', () => {
        expect(BUILD_OPTS).not.toMatch(/onlyEntryIds[\s\S]{0,200}\.series\s*===/);
    });
});

describe('系列卡那枚按钮 —— 文案要跟着动作改', () => {
    it('音乐组的提示词是「乱序播放整个系列」，不再是「可切换 N 部/季」', () => {
        const at = LIST.indexOf('class="rl-watch-btn rl-series-play"');
        expect(at).toBeGreaterThanOrEqual(0);
        // 从按钮起截一段（含 data-tip 与 aria 文本）
        const btn = LIST.slice(at, at + 700);
        expect(btn).toContain('乱序播放整个系列');
        expect(btn).toContain("g.type === 'music'");
        // 🔴 只截**三元表达式的真值支**：从 `? `乱序播放整个系列` 到 `: `${actionAriaLabel`
        //    ⚠️ 判空用 `toBeGreaterThan`，indexOf 返 -1 时 slice(-1) 会给出几乎整串，
        //       not.toContain 会命中 else 支的「可切换」而假红（第一版就栽在这）。
        const musicTipFrom = btn.indexOf('? `乱序播放整个系列');
        const musicTipTo = btn.indexOf(': `${actionAriaLabel');
        expect(musicTipFrom).toBeGreaterThanOrEqual(0);
        expect(musicTipTo).toBeGreaterThan(musicTipFrom);
        expect(btn.slice(musicTipFrom, musicTipTo)).not.toContain('可切换');
    });

    it('影视/动画的提示词保持原样（可切换 N 部/季）', () => {
        expect(LIST).toContain('`${actionAriaLabel(g.type)}（可切换 ${g.items.length} 部/季）`');
    });

    it('点它仍然 stopPropagation（⛔ 别让它变成「进系列视图」）', () => {
        const openSeriesFromCard = LIST.slice(LIST.indexOf('function openSeriesFromCard'));
        expect(openSeriesFromCard.slice(0, 400)).toContain('ev.stopPropagation()');
        expect(openSeriesFromCard.slice(0, 400)).toContain('onOpenSeriesPicker(group)');
    });
});
