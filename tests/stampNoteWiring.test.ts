// 🔴 m04435 ①：右键「时间戳笔记」浮层 —— 接线守卫（源码文本级）。
//
// 纯函数在 `tests/stampNote.test.ts`；这个文件守「功能到底连没连上」：
//  ⑴ 左键**不许**带 caption（带上了就是「单击也写心情」，破坏 #587 的一键口径）；
//  ⑵ 右键必须 `preventDefault` 且**不能**再顺手调 `insertStamp`；
//  ⑶ 浮层要能关（Esc / 点外面 / 关播放器），否则它会一直压在画面上；
//  ⑷ 写入必须走同一个 `onInsertStamp` 出口（⛔ 别开第二条写笔记的路）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
/** 剥注释：三档都不跨行（跨行那条会被模板串里的括号星号序列吞掉，本仓踩过 —— ⛔ 别写那个序列） */
function stripComments(src: string): string {
    return src
        .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
        .replace(/\/\*[^*\n]*\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}
const VIEW = stripComments(readFileSync(resolve(ROOT, 'src/views/VideoPlayerView.ts'), 'utf8'));
const POP = stripComments(readFileSync(resolve(ROOT, 'src/views/StampNotePopover.ts'), 'utf8'));
const MAIN = stripComments(readFileSync(resolve(ROOT, 'main.ts'), 'utf8'));
const CSS = readFileSync(resolve(ROOT, 'styles.css'), 'utf8');

function after(src: string, marker: string, len = 900): string {
    const at = src.indexOf(marker);
    if (at < 0) throw new Error(`找不到锚点：${marker}`);
    return src.slice(at, at + len);
}

describe('🔴 m04435 ① 按钮分工：左键一键、右键浮层', () => {
    it('🔴 左键仍是 `() => void this.insertStamp()`（不传 caption，一键口径不变）', () => {
        expect(VIEW).toContain("stampBtn.addEventListener('click', () => void this.insertStamp());");
    });

    it('🔴 右键必须 preventDefault（否则原生右键菜单会压住浮层）', () => {
        const body = after(VIEW, "stampBtn.addEventListener('contextmenu'", 400);
        expect(body).toContain('ev.preventDefault();');
        expect(body).toContain('ev.stopPropagation();');
        expect(body).toContain('this.openStampNotePopover(stampBtn);');
    });

    it('⛔ 右键 handler 里不许直接调 insertStamp（那是「右键=立刻写」，与裁定冲突）', () => {
        const body = after(VIEW, "stampBtn.addEventListener('contextmenu'", 400);
        expect(body).not.toContain('insertStamp');
    });

    it('⚠️ 只挂 contextmenu，不挂 mousedown 判 button（会吞掉左键 click 派发链）', () => {
        const body = after(VIEW, 'const stampBtn = tools.createEl', 700);
        expect(body).not.toContain('mousedown');
        expect(body).toContain("'contextmenu'");
    });

    it('入口按钮提示要交代右键（用户不可能猜到有这个功能）', () => {
        expect(VIEW).toContain('右键写时间戳笔记');
    });
});

describe('🔴 m04435 ① caption 只从浮层来', () => {
    it('🔴 `insertStamp(caption?)` 只在 caption 非空时才把它塞进 payload', () => {
        const body = after(VIEW, 'async insertStamp(caption?: string): Promise<void> {', 600);
        expect(body).toContain('const c = typeof caption === \'string\' ? caption.trim() : \'\';');
        expect(body).toContain('await cb(c ? { ...base, caption: c } : base);');
    });

    it('🔴 浮层提交 → 拼文案 → 走同一个 insertStamp（⛔ 不开第二条写笔记的路）', () => {
        const body = after(VIEW, 'private openStampNotePopover(anchor: HTMLElement): void {', 1200);
        expect(body).toContain('const caption = stampNoteCaption(result.mood, result.note);');
        expect(body).toContain('await this.insertStamp(caption);');
        expect(body).not.toContain('onInsertStamp?');
    });
});

describe('🔴 m04435 ① 浮层能关掉（否则一直压在画面上）', () => {
    it('🔴 Esc 关闭（用户在浮层里按 Esc 必须能退出）', () => {
        expect(POP).toContain("if (ev.key === 'Escape')");
        expect(POP).toContain('this.close();');
    });

    it('🔴 点浮层外面关闭（走既有的 document 级 pointerdown，捕获阶段）', () => {
        const body = after(VIEW, 'private onDocPointerDown = (ev: PointerEvent): void => {', 700);
        expect(body).toContain('this.closeStampNotePopover();');
        expect(body).toContain('this.stampNoteEl.contains(target)');
    });

    it('🔴 关播放器时摘掉浮层（挂在 root 里，root 会重建 ⇒ 不摘就是孤儿 DOM）', () => {
        const body = after(VIEW, 'async onClose(): Promise<void> {', 400);
        expect(body).toContain('this.closeStampNotePopover();');
    });

    it('🔴 关闭是幂等的（`onClose` 也会回到自己 ⇒ 必须可重入）', () => {
        const body = after(VIEW, 'private closeStampNotePopover(): void {', 400);
        expect(body).toContain('this.stampNotePopover = null;');
        expect(body).toContain('pop?.destroy();');
        // ⛔ 不许在关闭里再调 onClose（那会无限递归）
        expect(body).not.toContain('this.opts?.onClose');
    });

    it('⚠️ 同一时刻只留一个浮层（再点右键先销毁旧的，⛔ 别叠两层）', () => {
        const body = after(VIEW, 'private openStampNotePopover(anchor: HTMLElement): void {', 400);
        expect(body).toContain('this.closeStampNotePopover();');
    });
});

describe('🔴 m04435 ① 浮层自身的交互契约', () => {
    it('🔴 打开即聚焦备注框（用户：「鼠标自动聚焦」），且等一帧再 focus', () => {
        expect(POP).toContain('window.requestAnimationFrame(() => {');
        expect(POP).toContain('this.noteEl?.focus();');
    });

    it('🔴 六档心情取自 `pure/mood` 唯一真源（⛔ 不手抄 emoji 数组）', () => {
        expect(POP).toContain("import { MOODS, moodChipTip, moodText, type MoodId } from 'pure/mood';");
        expect(POP).toContain('for (const m of MOODS)');
        // ⛔ 反向守卫：不许在浮层里硬编码任何一档 emoji
        expect(POP).not.toContain('🤩');
        expect(POP).not.toContain('😭');
    });

    it('🔴 点已选档位 = 取消（与表单 chips / 评分「再点清零」同一纪律）', () => {
        expect(POP).toContain('this.mood = this.mood === id ? undefined : id;');
    });

    it('🔴 笑脸按钮展开六档，并维护 aria-expanded', () => {
        expect(POP).toContain("setIcon(smileBtn, 'smile');");
        expect(POP).toContain("smileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');");
        expect(POP).toContain("this.moodRowEl?.toggleClass('is-open', open);");
    });

    it('🔴 选心情只是选中 —— 提交在「写入笔记」按钮上（用户裁定）', () => {
        // 心情 chip 的 click 只切状态 + 刷预览，⛔ 不许直接 commit
        const body = after(POP, "chip.addEventListener('click', () => this.toggleMood(m.id));", 60);
        expect(body).not.toContain('commit');
        expect(POP).toContain('ok.addEventListener(\'click\', () => void this.commit());');
    });

    it('⚠️ 心情/备注都空时预览要说明「与左键单击相同」（避免用户以为没生效）', () => {
        expect(POP).toContain('不选心情也不写备注，就与左键单击相同。');
    });
});

describe('🔴 m04435 ① 宿主落盘', () => {
    it('🔴 `caption` 接到链接后面（`stampNoteLine`），而不是替换链接', () => {
        const body = after(MAIN, 'async insertVideoStamp(', 900);
        expect(body).toContain("const line = stampNoteLine(link, info.caption ?? '');");
        expect(body).toContain('appendNoteSection(entry.id, line, MARK_SECTION_STAMP)');
    });

    it('🔴 纯函数是真源来源（⛔ 别在宿主里手拼表情）', () => {
        expect(MAIN).toContain("import { stampNoteLine } from 'pure/stampNote';");
        const body = after(MAIN, 'async insertVideoStamp(', 900);
        expect(body).not.toContain('moodText');
    });

    it('🔴 预览时间文字与链接文字同源（都走 `stampLabel` + 三方取 max 的集数口径）', () => {
        const body = after(MAIN, 'private stampPreviewTextOf(', 800);
        expect(body).toContain('entry.episodeUrls?.length ?? 0');
        expect(body).toContain('entry.progress?.totalEpisodes ?? 0');
        expect(body).toContain('stampLabel(info.seconds, { ep: info.ep, multi: total > 1 })');
    });

    it('🔴 两处播放器选项都注入了 `stampPreviewText`（详情页 + 播放器标签页）', () => {
        // ⚠️ ⛔ 别用 `split('stampPreviewText: (i')` + `split('stampPreviewText: (info')` 相加 ——
        //    `(info)` 的前缀就是 `(i`，同一行会被数两遍（实测得 3 而不是 2）。
        //    用一条正则精确匹配「注入形态」，把方法定义 `stampPreviewTextOf(` 排除在外。
        // ⚠️ 命名带 `Label` 会撞产物断言 `#452` 的全局反向守卫 `!/reviewLabel/.test(js)`（子串命中）
        //    ⇒ 这里也顺手钉住「⛔ 别改回 …PreviewLabel」。
        const hits = (MAIN.match(/stampPreviewText: \((?:info|i)\) => this\.stampPreviewTextOf\(/g) ?? []).length;
        expect(hits).toBe(2);
        expect(MAIN).not.toContain('stampPreviewLabel');
    });
});

describe('🔴 m04435 ① 样式真源', () => {
    it('🔴 浮层是 absolute（相对 `.rl-vp-root`），⛔ 不是 fixed', () => {
        expect(CSS).toMatch(/\.rl-vp-stampnote \{[^}]*position: absolute;/);
        expect(CSS).not.toMatch(/\.rl-vp-stampnote \{[^}]*position: fixed;/);
    });

    it('🔴 `.hidden` 必须 `display: none`（TS 在量尺寸前先打它）', () => {
        expect(CSS).toMatch(/\.rl-vp-stampnote\.hidden \{ display: none; \}/);
    });

    it('🔴 量尺寸态不可见（用户不该看到定位过程）', () => {
        expect(CSS).toMatch(/\.rl-vp-stampnote\.is-measuring \{ visibility: hidden; \}/);
    });

    it('🔴 六档默认收起，`is-open` 才显示（用户：「点击后展开」）', () => {
        expect(CSS).toMatch(/\.rl-stampnote-moodrow \{ display: none;/);
        expect(CSS).toMatch(/\.rl-stampnote-moodrow\.is-open \{ display: flex; \}/);
    });

    it('🔴 选中态是唯一有底色的（透明底 + 选中才上色的统一纪律）', () => {
        expect(CSS).toMatch(/\.rl-stampnote-moodchip\.is-on \{[^}]*background:/);
        expect(CSS).toMatch(/\.rl-stampnote-moodchip \{[^}]*background: transparent;/);
    });
});
