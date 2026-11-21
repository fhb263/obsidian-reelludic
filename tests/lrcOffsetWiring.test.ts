/**
 * 🔴 m08028 接线守卫：歌词偏移从「按钮点下去」到「文件真的改了」这条路，
 * 中间任何一环顺序写反都会**静默**出问题 —— 而 `pure/lrcShift` 的单测完全看不见。
 *
 * 纯逻辑（标签重写 / 平移 / 记忆）已由 `tests/lrcShift.test.ts` 的 28 条钉住；
 * 这里只守**装配**，因为那才是本轮真正的雷区：
 *
 *  ⑴ 写回成功后必须先 `setLyricOffset(0)` **再** `loadLyrics()`。
 *    反了的话 `loadLyrics` 里 `lyricOffset = loadLyricOffset(...)` 会把刚写掉的旧偏移
 *    从 localStorage **读回来** ⇒ 文件已经改了、画面却还叠着 N 秒 ⇒ 双倍偏移。
 *  ② 时间基准**不许**再对 `audio.currentTime` 做加减。
 *    偏移是烘焙进 `lines` 的（`shiftLrcLines`），若再在 `syncCurrentLine` 里补一次就是两次。
 *  ③ 未写盘（`wrote === false`）**不许**归零 —— 文件里没有那段偏移，
 *    归零等于把用户刚调好的成果凭空丢掉。
 *  ④ 「写回笔记」必须走 `service.setNoteLrc`（` ```lrc ` 块的唯一写入口），
 *    ⛔ 不许在宿主里自己拼 `withLrcLyrics` / 直接写文件。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = 'C:/Users/kest/Desktop/obsidian-reelludic/';
const view = readFileSync(ROOT + 'src/views/audioPlayerMount.ts', 'utf8');
const main = readFileSync(ROOT + 'main.ts', 'utf8');
const pure = readFileSync(ROOT + 'src/pure/lrcShift.ts', 'utf8');
const css = readFileSync(ROOT + 'styles.css', 'utf8');

/** 取 `from` 之后的一段（找不到返回空串，让断言红而不是抛错） */
function sliceAfter(src: string, from: string, len: number): string {
    const i = src.indexOf(from);
    return i < 0 ? '' : src.slice(i, i + len);
}

/**
 * `fillOffsetPop()` 的**整段**（不是截固定字数）。
 * ⚠️ 2026-11-18 m08754：这函数从「读数 + 四颗文字按钮」变成「五段步进 + 两颗图标按钮 + 写回回调」，
 *    字数翻了近一倍；原先 `sliceAfter(..., 3000)` 会截在 `.finally()` 里，
 *    于是 `syncOffsetPop();` 那条守卫变成**假红**（代码明明还在）。
 *    ⇒ 改用「到下一个成员（`function` / JSDoc 注释）为止」定界。
 */
function funcBody(src: string, from: string): string {
    const i = src.indexOf(from);
    if (i < 0) return '';
    const stops = [src.indexOf('\n    function ', i + from.length), src.indexOf('\n    /**', i + from.length)]
        .filter((n) => n > -1);
    return src.slice(i, stops.length ? Math.min(...stops) : i + 8000);
}

describe('🔴 m08028 歌词偏移 · 播放器装配', () => {
    it('控制条有偏移按钮，且是铅笔图标（m08545：⛔ 不再在按钮里写文字）', () => {
        // 用户 m08545：「在音乐播放器工具栏倍速按钮旁加编辑铅笔样式的图标点击展开可调整偏移值实时调整」
        expect(view).toContain("const offsetBtn = iconButton('rl-ap-btn rl-ap-btn-offset', 'pencil', '歌词时间偏移（对齐歌曲与歌词）');");
        // 图标按钮的 svg 已经由 setIcon 放进去了 —— 再写 textContent 会把图标抹掉
        const sync = sliceAfter(view, 'function syncOffsetButton', 500);
        expect(sync.length).toBeGreaterThan(0);
        expect(sync).not.toContain('offsetBtn.textContent');
        expect(sync).toContain("offsetBtn.classList.toggle('is-var', lyricOffset !== 0);");
        // 读数仍走 lyricOffsetLabel（⛔ 不手拼 `+2s`），落在 aria + data-offset 上供核对
        expect(sync).toContain('const label = lyricOffsetLabel(lyricOffset);');
        expect(sync).toContain('offsetBtn.setAttribute(\'aria-label\', `歌词偏移 ${label}（对齐歌曲与歌词）`);');
        expect(sync).toContain("offsetBtn.setAttribute('data-offset', label);");
        // 非零才高亮 —— 与倍速「非 1× 才变色」同一套语言
        expect(view).not.toContain("offsetBtn.classList.add('is-var')");
    });

    it('浮层复用既有的 pop 容器（⛔ 不自建第二个浮层）', () => {
        expect(view).toContain("offsetBtn.addEventListener('click', () => togglePop('lyricOffset', offsetBtn));");
        expect(view).toContain("else if (kind === 'lyricOffset') fillOffsetPop();");
        // 关闭时三颗按钮的 `is-on` 都要摘掉，漏一颗会「关掉了还亮着」
        const close = sliceAfter(view, 'const closePop = (): void => {', 260);
        expect(close).toContain("offsetBtn.classList.remove('is-on');");
    });

    /**
     * 🔴 m08754 ①：用户逐字「把偏移值按改成 -+0.1s、1s 调整：UI 按 `<<  <  0s  >  >>` 显示，
     *    重置和写入笔记文字按钮都改成图标按钮」。
     */
    it('m08754 ① 五段步进：<<(−1s) <(−0.1s) 读数 >(+0.1s) >>(+1s)', () => {
        const pop = funcBody(view, 'function fillOffsetPop');
        expect(pop.length).toBeGreaterThan(0);
        // 四颗步进按钮的**字面量与顺序**：粗调在两头、细调贴读数
        const iCoarsePrev = pop.indexOf("build('<<', '提前 1 秒', -LYRIC_OFFSET_COARSE)");
        const iFinePrev = pop.indexOf("build('<', '提前 0.1 秒', -LYRIC_OFFSET_STEP)");
        const iVal = pop.indexOf("el('div', 'rl-ap-offset-val', lyricOffsetLabel(lyricOffset))");
        const iFineNext = pop.indexOf("build('>', '延后 0.1 秒', LYRIC_OFFSET_STEP)");
        const iCoarseNext = pop.indexOf("build('>>', '延后 1 秒', LYRIC_OFFSET_COARSE)");
        for (const i of [iCoarsePrev, iFinePrev, iVal, iFineNext, iCoarseNext]) expect(i).toBeGreaterThan(-1);
        // 顺序必须严格是 `<< < 读数 > >>`（读数在正中）
        expect(iCoarsePrev).toBeLessThan(iFinePrev);
        expect(iFinePrev).toBeLessThan(iVal);
        expect(iVal).toBeLessThan(iFineNext);
        expect(iFineNext).toBeLessThan(iCoarseNext);
        // ⛔ 旧的四个文字按钮（±1s / ±0.5s）不许长回来
        expect(pop).not.toContain("build('−1s'");
        expect(pop).not.toContain("build('+0.5s'");
        // 读数节点不再挂在 head 里（它现在是五段行的中间格）
        expect(pop).not.toContain("head.appendChild(el('div', 'rl-ap-offset-val'");
    });

    it('m08754 ① 动作区两颗按钮都是图标按钮（⛔ 不是文字）', () => {
        const pop = funcBody(view, 'function fillOffsetPop');
        expect(pop).toContain("const reset = iconButton('rl-ap-offset-act', 'rotate-ccw', '重置偏移为 0');");
        expect(pop).toContain("const save = iconButton('rl-ap-offset-act is-primary', 'save', '把当前偏移写进歌词文件');");
        // ⛔ 反向守卫：不许再出现「文字按钮」形态的建法
        expect(pop).not.toContain("el('button', 'rl-ap-offset-act', '重置')");
        expect(pop).not.toContain("el('button', 'rl-ap-offset-act is-primary', '写回笔记')");
    });

    /**
     * 🔴 m08754 ①：用户逐字「调整偏移值图标按钮要和其他工具栏图标大小一致**且仅在保持点击时高亮
     *    显示图标（取消后正常显示灰色图标）**」。
     * ⚠️ 这条是**反向守卫**：`styles.css` 里一旦又给 `.rl-ap-btn-offset.is-var` 上色，
     *    「关闭浮层后回灰」立刻失效（按钮会在偏移非 0 时常亮强调色）。
     */
    it('m08754 ① 高亮只归 `is-on`：`.is-var` 不许再带配色', () => {
        expect(css).not.toContain('.rl-ap-btn-offset.is-var');
        // 图标尺寸必须继承 `.rl-ap-btn`（⛔ 不许给偏移按钮单写文字按钮度量）
        // ⚠️ 锚点用**选择器**而不是注释文字：注释会被清理/改写，选择器是稳定的结构真源。
        const seg = sliceAfter(css, '.rl-ap-root .rl-ap-offset-head {', 2400);
        expect(seg.length).toBeGreaterThan(0);
        expect(seg).not.toMatch(/\.rl-ap-btn-offset\s*\{/);
        // 反向守卫：这一段的声明区（剥掉注释）里不许再出现这个选择器
        const decl = seg.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(decl).not.toMatch(/rl-ap-btn-offset/);
    });

    it('🔴 写回成功后的顺序：先归零、再重载', () => {
        const body = sliceAfter(view, 'save.addEventListener(\'click\', () => {', 1200);
        expect(body.length).toBeGreaterThan(0);
        const iZero = body.indexOf('setLyricOffset(0);');
        const iLoad = body.indexOf('void loadLyrics(track);');
        expect(iZero).toBeGreaterThan(-1);
        expect(iLoad).toBeGreaterThan(-1);
        // 顺序断言：归零必须出现在重载**之前**
        expect(iZero).toBeLessThan(iLoad);
        // 未写盘就直接 return（⛔ 别在这里归零）
        expect(body).toContain('if (!wrote) return;');
    });

    it('🔴 时间基准不在播放位置上叠加（偏移只烘焙进 lines）', () => {
        // 平移只在 loadLyrics / setLyricOffset 两处，且都是 `shiftLrcLines(parsedLines, ...)`
        const hits = view.match(/shiftLrcLines\(/g) ?? [];
        expect(hits.length).toBe(2);
        // ⛔ 反向守卫：不许对 currentTime 做偏移加减
        expect(view).not.toMatch(/currentTime\s*[-+]\s*lyricOffset/);
        expect(view).not.toMatch(/lyricOffset\s*\/\s*1000\s*\)\s*;?\s*\/\/.*currentTime/);
    });

    it('切曲先取该条目的偏移，再渲染（顺序反了会先按 0 画一遍）', () => {
        const body = sliceAfter(view, 'const loadLyrics = async (track: AudioPlayerTrack)', 700);
        const iLoad = body.indexOf('lyricOffset = loadLyricOffset(track.entryId);');
        const iRender = body.indexOf('renderLyrics();');
        expect(iLoad).toBeGreaterThan(-1);
        expect(iRender).toBeGreaterThan(-1);
        expect(iLoad).toBeLessThan(iRender);
    });

    it('纯文本歌词不做平移（没有时间轴，挪了也没意义）', () => {
        expect(view).toContain('if (!plainLyrics && parsedLines.length) {');
    });

    it('handle 暴露 resetLyricOffset，供宿主写回后归零', () => {
        expect(view).toContain('resetLyricOffset(): void;');
        expect(view).toContain('resetLyricOffset: () => undefined,');
        // ⚠️ 用正则而不是整段字面量：本仓文件是 **CRLF**，写死 `\n` 会永远匹配不上（本轮踩过）
        expect(view).toMatch(/resetLyricOffset\(\): void \{\s*setLyricOffset\(0\);/);
    });

    it('🔴 m08545 写回按钮的可用态必须跟着偏移一起刷新（真机实测踩到的 bug）', () => {
        // 病象：一进浮层就点「写回笔记」，那颗按钮永远停在 fillOffsetPop() 建节点时算出的
        // `disabled`（当时偏移是 0）—— 调到 +1s 后仍然点不到，功能等于没做。
        const sync = sliceAfter(view, 'function syncOffsetPop', 900);
        expect(sync.length).toBeGreaterThan(0);
        // 可用态与 aria 都必须在同步函数里重算，⛔ 不能只在建节点时算一次
        expect(sync).toContain("const canWrite = !!opts.onWriteBackLyricOffset && lyricOffset !== 0;");
        expect(sync).toContain('save.disabled = !canWrite;');
        expect(sync).toContain("'偏移为 0，无需写回'");
        expect(sync).toContain("'把当前偏移写进歌词文件'");
        // 建节点那段不许再自己算一遍（两处写必然漂）
        const fill = funcBody(view, 'function fillOffsetPop');
        expect(fill).toContain('save.disabled = true;');
        expect(fill).not.toContain('const canWrite =');
        // 建完立刻刷一遍，首帧就正确
        expect(fill).toContain('syncOffsetPop();');
    });
});

describe('🔴 m08028 歌词偏移 · 宿主写回', () => {
    it('写回走 `setNoteLrc`（```lrc 块唯一写入口），⛔ 不自拼 withLrcLyrics', () => {
        const body = sliceAfter(main, 'private async writeBackLyricOffset(', 2200);
        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain('await this.service.setNoteLrc(track.entryId, next);');
        expect(body).toContain('shiftLrcText(current, deltaMs)');
        expect(body).not.toContain('withLrcLyrics');
        expect(body).not.toContain('writeNoteRaw');
    });

    it('两条挂载都注入了回调（标签页/侧边栏 与 笔记内联块）', () => {
        const hits = main.match(/onWriteBackLyricOffset: \(track, deltaMs\) => this\.writeBackLyricOffset\(track, deltaMs\),/g) ?? [];
        expect(hits.length).toBe(2);
    });

    it('偏移为 0 / 非数直接返回 false（⛔ 别重写一遍字节还说「已写回」）', () => {
        const body = sliceAfter(main, 'private async writeBackLyricOffset(', 900);
        expect(body).toContain('if (!Number.isFinite(deltaMs) || deltaMs === 0) return false;');
        expect(body).toContain('if (!current.trim()) {');
        expect(body).toContain('if (next === current) {');
    });
});

describe('🔴 m08028 歌词偏移 · 纯模块口径', () => {
    it('保留原始小数位（⛔ 不把 [00:12.50] 抹成 [00:12]）', () => {
        expect(pure).toContain('const digits = Math.min(3, tag.length - dot - 1);');
        // 🔴 这里必须是 10 的幂（厘秒档），写成 1000 会让小数位永远为 0（单测抓过一次）
        expect(pure).toContain('10 ** (3 - digits)');
        // ⚠️ 反向守卫只能判**代码行**：文件注释里正好写着错误写法当反面教材
        //    （"写成 `1000 ** (3 - digits)` 会把…"）⇒ 全文件 `not.toContain` 会自己撞自己。
        const codeOnly = pure.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        expect(codeOnly).not.toContain('1000 ** (3 - digits)');
    });

    it('畸形时间标签字节不变（[99:99] 不该被算成 6039 秒）', () => {
        expect(pure).toContain('if (!isWellFormedClockTag(tag)) return tag;');
        expect(pure).toContain('if (!isWellFormedClockTag(inner)) {');
        // 三段式必须认，否则超一小时的歌词行会原地不动。
        // ⚠️ 用字面量判据（⛔ 别写两层转义的正则 —— 本轮在这上面翻过车）
        expect(pure).toContain('(?::\\d{2})?');
    });

    it('平移返回新对象（⛔ 不原地改，否则调不回 0）', () => {
        expect(pure).toContain('const next: LrcLine = { ...l, timestamp, timestr: formatClock(timestamp / 1000) };');
        expect(pure).not.toMatch(/l\.timestamp\s*=/);
    });

    it('归零删键（别留一堆 key="0" 白占配额）', () => {
        expect(pure).toContain('if (v === 0) localStorage.removeItem(LYRIC_OFFSET_KEY_PREFIX + entryId);');
    });
});
