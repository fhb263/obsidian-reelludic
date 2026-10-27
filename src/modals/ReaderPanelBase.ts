// 阅读器公共面板基类（P0-1 去重）
//
// EpubReaderPanel 与 TxtReaderPanel 有 87 个成员方法、126 个字段逐字相同
// （用 TypeScript AST 取成员全文比对，两侧全等才迁移），统一由本类承载。
// 两者只保留真正不同的部分：Epub 走 iframe + epubParse 章节，Txt 走 div + txtParse 章节。
//
// 迁移判据（改前实测，勿凭感觉增删）：
//  · 两侧同名字段声明文本 0 处差异；
//  · 公共方法访问的 this.options.* 字段，两侧接口声明也 0 处差异 ⇒ 才有下面的 ReaderPanelOptionsBase；
//  · 公共方法引用的 this.* 里，没有任何一个只属于某一侧；
//  · 22 个方法两侧同名但实现不同 ⇒ 本类只声明 abstract，实现留在子类。
//
// ⛔ 不要把这些搬进来：currentFontPx / currentLineHeight / adjustFont / adjustLineHeight
//    它们读模块级可变状态 readerFontSize / readerLineHeight（每个模块一份）。
//    搬进本文件会让 Epub 与 Txt 共享字号状态 —— 那是行为改变，不是重构。
//
// ⚠️ 子类实现 abstract 成员时必须是 protected（不能收窄成 private，TS 会报错）。

import { Notice, setIcon, type Scope } from 'obsidian';
import { estimatePercent } from 'pure/readingProgress';
import { attachScrollFades, resyncScrollFade } from 'pure/readerToc';
import type { AnnoHeadHandles, AnnoSelState } from 'pure/annoSelection';
import { buildTtsMenu, loadVoiceUri, saveTtsEngine, saveTtsRate, saveTtsVolume, saveVoiceUri, ttsPitchLabel, ttsRateLabel, ttsVolumeLabel, type TtsEngineKind } from 'pure/tts';
import { cloudVoiceGroups, loadCloudVoice, saveCloudVoice } from 'pure/ttsCloud';
import { AUTO_SCROLL_DEFAULT, AUTO_SCROLL_MAX, AUTO_SCROLL_MIN, AUTO_SCROLL_STEP, AUTO_TURN_DEFAULT_MS, AUTO_TURN_MAX_MS, AUTO_TURN_MIN_MS, AUTO_TURN_STEP_MS, autoSpeedLabel, autoTurnLabel, clampAutoScrollPx, clampAutoTurnMs, loadAutoScrollPx, saveAutoScrollPx } from 'pure/readerAuto';
import { ttsSupported } from 'services/SpeechEngine';
import { TtsService } from 'services/TtsService';
import type { ParsedExcerpt } from 'pure/excerpt';
import type { ReaderBookmark } from 'pure/bookmark';
import { chapterHighlights, findSameHighlight, findSameExcerpt, HL_STYLES, HL_COLORS, DEFAULT_HL_STYLE, DEFAULT_HL_COLOR, type HlStyle, type HlColor, type ReaderHighlight, type HlMarkTarget } from 'pure/highlight';
import type { ReaderLineWidth, ScrollMode } from 'pure/paged';
import { footerReadout } from 'pure/readerFooter';
import { excerptCardLocLabel, excerptCardKeyAction, needsQuoteExpand, placeCard } from 'pure/excerptCard';
import type { ShotLoc, ShotRect } from 'pure/readerShot';
import { ShotOverlay } from 'modals/ShotOverlay';
import { SEARCH_ENGINE_GROUPS, searchEngineUrl, type SearchEngineId } from 'pure/readerSearch';
import { SEARCH_ENGINE_ICONS } from 'pure/searchIcons';
import type { ReaderQuickMode } from 'pure/readerQuick';
import { LETTER_DEFAULT, formatLetterSpacing, normalizeFontFamily, normalizeFontWeight, type ReaderFontFamily, type ReaderFontWeight, type ReaderTypoPayload, type SegOption } from 'pure/readerTypography';
import { isTypingTarget, resolveReaderHotkey } from 'pure/readerHotkeys';
import { READER_THEMES, readerThemeClass, type ReaderThemeId } from 'pure/readerTheme';
import { safeSetIcon } from '../services/safeIcon';


/** 两个阅读器 options 的公共字段（两侧声明逐字一致才放这里） */
export interface ReaderPanelOptionsBase {
    title: string;
    progress?: { chapterIndex: number; scrollRatio: number };
    onSaveProgress: (p: { chapterIndex: number; scrollRatio: number }) => void;
    onProgressPersist?: (percent: number) => void;
    settings?: ReaderTypoPayload;
    onSettingsChange?: (s: ReaderTypoPayload) => void;
    scrollMode?: ScrollMode;
    onScrollModeChange?: (m: ScrollMode) => void;
    lineWidth?: ReaderLineWidth;
    onLineWidthChange?: (w: ReaderLineWidth) => void;
    theme?: ReaderThemeId;
    onThemeChange?: (t: ReaderThemeId) => void;
    getCloudKey?: () => string;
    onExcerptSave?: (quote: string, note: string | undefined, loc: { chapter: number; pct: number }) => Promise<boolean>;
    onShotSave?: (rect: ShotRect, loc?: ShotLoc) => void;
    excerpts?: ParsedExcerpt[];
    onDeleteExcerpt?: (blockId: string) => Promise<boolean>;
    onTrashSelection?: (t: { highlightIds: string[]; excerptIds: string[]; highlightQuotes?: string[] }, opts?: { quiet?: boolean }) => Promise<number>;
    bookmarks?: ReaderBookmark[];
    pendingTargetId?: string;
    onOpenNote?: () => void;
    onBookmarksChange?: (list: ReaderBookmark[]) => void;
    onTranslate?: (text: string) => Promise<string | null>;
    onAiSearch?: (text: string) => Promise<string | null>;
    onAiAsk?: (text: string, question: string) => Promise<string | null>;
    onOpenExternal?: (url: string) => void;
    highlights?: ReaderHighlight[];
    onHighlight?: (quote: string, loc: { chapter: number; pct: number }, style?: HlStyle, color?: HlColor) => Promise<string | null>;
    onDeleteHighlight?: (blockId: string) => Promise<boolean>;
    onConfirmClear?: (message: string) => Promise<boolean>;
    onPurgeAnnotations?: (kind: 'highlight' | 'excerpt', blockIds: string[]) => Promise<number>;
}

export abstract class ReaderPanelBase<O extends ReaderPanelOptionsBase> {
    protected constructor(
        protected container: HTMLElement,
        protected scope: Scope,
        protected options: O,
        protected closeView: () => void,
    ) {}

protected chapterIndex!: number;
protected tocCollapsed = true;
protected mode: ScrollMode = 'continuous';
protected lineWidth: ReaderLineWidth = 'strict';
protected annotateMode: ReaderQuickMode | null = null;
protected moreBtn: HTMLButtonElement | null = null;
protected morePanelEl: HTMLDivElement | null = null;
protected moreOpen = false;
protected disposeHeadDensity: (() => void) | null = null;
protected disposeFade: (() => void) | null = null;
protected quickBtns: Partial<Record<ReaderQuickMode, HTMLButtonElement>> = {};
protected pageIndex = 0;
protected totalPages = 1;
protected pageW = 1;
protected modeSeg: HTMLElement | null = null;
protected widthSeg: HTMLElement | null = null;
protected indentSeg: HTMLElement | null = null;
protected theme: ReaderThemeId = 'follow';
protected themeSwatches: Partial<Record<ReaderThemeId, HTMLButtonElement>> = {};
protected indent = true;
protected fontFamily: ReaderFontFamily = 'default';
protected fontWeight: ReaderFontWeight = 'normal';
protected letterSpacing = LETTER_DEFAULT;
protected familySeg: HTMLElement | null = null;
protected weightSeg: HTMLElement | null = null;
protected letterSlider: HTMLInputElement | null = null;
protected letterVal: HTMLElement | null = null;
protected lastHotkeyNotice = 0;
protected hlStyle: HlStyle = DEFAULT_HL_STYLE;
protected hlColor: HlColor = DEFAULT_HL_COLOR;
protected hlPickerEl: HTMLDivElement | null = null;
protected hlPickerTargetId: string | null = null;
protected hlPickerAnchor: { x: number; y: number } | null = null;
protected hlStyleBtns: Partial<Record<HlStyle, HTMLButtonElement>> = {};
protected hlColorBtns: Partial<Record<HlColor, HTMLButtonElement>> = {};
protected hlTrashBtn: HTMLButtonElement | null = null;
protected hlTrashReady = false;
protected tocEl!: HTMLDivElement;
protected tocListEl!: HTMLDivElement;
protected exListEl: HTMLDivElement | null = null;
protected hlListEl: HTMLDivElement | null = null;
protected hlCountEl: HTMLDivElement | null = null;
protected exCountEl: HTMLDivElement | null = null;
protected bmCountEl: HTMLDivElement | null = null;
protected bmListEl: HTMLDivElement | null = null;
protected bmSel: AnnoSelState = { on: false, ids: [] };
protected hlSel: AnnoSelState = { on: false, ids: [] };
protected exSel: AnnoSelState = { on: false, ids: [] };
protected bmHeadRef: AnnoHeadHandles | null = null;
protected hlHeadRef: AnnoHeadHandles | null = null;
protected exHeadRef: AnnoHeadHandles | null = null;
protected shotOverlay: ShotOverlay | null = null;
protected headEl: HTMLElement | null = null;
protected headTitleEl: HTMLSpanElement | null = null;
protected sidebarToggleEl: HTMLButtonElement | null = null;
protected menuEl: HTMLDivElement | null = null;
protected settingsBtn: HTMLButtonElement | null = null;
protected settingsOpen = false;
protected menuFontVal: HTMLSpanElement | null = null;
protected menuLineVal: HTMLSpanElement | null = null;
protected menuFontSlider: HTMLInputElement | null = null;
protected menuLineSlider: HTMLInputElement | null = null;
protected ttsSvc: TtsService | null = null;
protected ttsBtnEl: HTMLButtonElement | null = null;
protected popEl: HTMLDivElement | null = null;
protected fsBtnEl: HTMLButtonElement | null = null;
protected immersiveBtnEl: HTMLButtonElement | null = null;
protected autoBtnEl: HTMLButtonElement | null = null;
protected immersive = false;
protected autoOn = false;
protected autoScrollPx = loadAutoScrollPx() ?? AUTO_SCROLL_DEFAULT;
protected autoTurnMs = AUTO_TURN_DEFAULT_MS;
protected autoPos: number | null = null;
protected footEl: HTMLElement | null = null;
protected autoRaf: number | null = null;
protected autoTimer: number | null = null;
protected autoLastTs = 0;
protected fsListenerRegistered = false;
protected footerFchEl!: HTMLSpanElement;
protected footerFpctEl!: HTMLSpanElement;
protected footerFillEl!: HTMLDivElement;
protected selbar: HTMLDivElement | null = null;
protected selbarParent: HTMLElement | null = null;
protected selRecord: { text: string; chapter: number; pct: number; mark?: HlMarkTarget | null } | null = null;
protected selbarHlBtn: HTMLButtonElement | null = null;
protected selbarTrashBtn: HTMLButtonElement | null = null;
protected translateCard: HTMLDivElement | null = null;
protected translateCardBody: HTMLDivElement | null = null;
protected searchCard: HTMLDivElement | null = null;
protected searchQueryEl: HTMLInputElement | null = null;
protected searchBodyEl: HTMLDivElement | null = null;
protected searchCopyBtn: HTMLButtonElement | null = null;
protected searchRunToken = 0;
protected netPanelEl: HTMLDivElement | null = null;
protected netQuoteEl: HTMLDivElement | null = null;
protected netQueryText = '';
protected searchMode: 'read' | 'ask' = 'read';
protected searchCardText = '';
protected searchModeBtns: Partial<Record<'read' | 'ask', HTMLButtonElement>> = {};
protected searchReadSecEl: HTMLDivElement | null = null;
protected searchAskSecEl: HTMLDivElement | null = null;
protected searchQuestionEl: HTMLInputElement | null = null;
protected searchQuoteEl: HTMLDivElement | null = null;
protected excerptCard: HTMLDivElement | null = null;
protected excerptLocEl: HTMLDivElement | null = null;
protected excerptQuoteEl: HTMLDivElement | null = null;
protected excerptMoreBtn: HTMLButtonElement | null = null;
protected excerptNoteEl: HTMLTextAreaElement | null = null;
protected excerptSaveBtn: HTMLButtonElement | null = null;
protected excerptCardQuote = '';
protected excerptCardLoc: { chapter: number; pct: number } | null = null;
protected highlightList: ReaderHighlight[] = [];
protected saveTimer: number | null = null;
protected scrollRaf: number | null = null;
protected switchTimer: number | null = null;
protected restoring = false;
protected lastRatio = 0;
protected jumpRatio: number | null = null;
protected pendingHighlight: string | null = null;
protected pendingHighlightHint: number | null = null;
protected chapterSizesCache: number[] | null = null;
protected lineHeight!: number;
protected onFsChange = (): void => {
        this.syncViewBtns();
    };
protected onReaderKeydown = (ev: KeyboardEvent): void => {
        if (ev.defaultPrevented || ev.isComposing) return;
        if (isTypingTarget(ev.target)) return;
        const svc = this.ttsSvc;
        const action = resolveReaderHotkey(
            ev.key,
            { ttsOn: !!svc?.isSpeaking, autoOn: this.autoOn },
            { ctrl: ev.ctrlKey, meta: ev.metaKey, alt: ev.altKey },
        );
        if (!action) return;
        ev.preventDefault();
        if (action === 'tts-toggle') {
            if (!svc?.isSpeaking) return;
            if (svc.isPaused) svc.resume();
            else svc.pause();
            return;
        }
        if (action === 'auto-toggle') {
            this.setAuto(!this.autoOn);
            return;
        }
        // ↑↓ 调速：翻页模式调「翻页间隔」，滚动模式调「滚动速度」——单位不同，但都用「快 = 数值更极端」表达
        const faster = action === 'auto-faster';
        let text: string;
        if (this.isPaged()) {
            this.autoTurnMs = clampAutoTurnMs(this.autoTurnMs + (faster ? -AUTO_TURN_STEP_MS : AUTO_TURN_STEP_MS));
            text = `自动翻页 ${autoTurnLabel(this.autoTurnMs)}`;
            this.restartAutoIfOn(); // 定时器按新间隔重建（滚动模式下无操作）
        } else {
            this.autoScrollPx = clampAutoScrollPx(this.autoScrollPx + (faster ? AUTO_SCROLL_STEP : -AUTO_SCROLL_STEP));
            saveAutoScrollPx(this.autoScrollPx); // 按帧读取 ⇒ 立刻生效，不打断
            text = `自动速度 ${autoSpeedLabel(this.autoScrollPx, this.currentFontPx())}`;
        }
        this.noticeHotkey(text);
    };
protected onDocMouseDown = (): void => {
        this.hideSelbar();
        this.hideExcerptCard();
        this.hideSearchCard();
        this.hideNetPanel();
        this.hideMenu();
        this.hideMore();
        this.hideTranslateCard();
        this.closePop();
    };
protected onUserInterrupt = (): void => {
        if (!this.autoOn) return;
        this.stopAuto();
        this.syncViewBtns();
    };

    protected abstract applyTypeVars(): void;
    protected abstract currentFontPx(): number;
    protected abstract currentLineHeight(): number;
    protected abstract trashSelection(): Promise<void>;
    protected abstract currentLoc(): { chapter: number; pct: number };
    protected abstract doHighlight(text: string, chapter: number, pct: number, style: HlStyle, color: HlColor, quiet: boolean): Promise<string | null>;
    protected abstract showHlPicker(anchor: { x: number; y: number } | null): void;
    protected abstract setIndent(on: boolean): void;
    protected abstract startAutoScroll(): void;
    protected abstract autoTurnTick(): void;
    protected abstract chapterSizes(): number[];
    protected abstract switchChapter(i: number): void;
    protected abstract toggleHighlight(text: string, loc: { chapter: number; pct: number }): Promise<void>;
    protected abstract submitExcerptCard(): Promise<void>;
    protected abstract buildBookmarkToc(): void;
    protected abstract buildExcerptToc(): void;
    protected abstract searchSeed(): string;
    protected abstract buildSearchCard(): HTMLDivElement | null;
    protected abstract jumpHighlight(hl: ReaderHighlight): void;
    protected abstract jumpExcerpt(ex: ParsedExcerpt): void;
    protected abstract jumpBookmark(bm: ReaderBookmark): void;
    protected abstract currentRatio(): number;

    /** 键位提示通知（500ms 限流；连按时不刷屏） */
    protected noticeHotkey(text: string): void {
        const now = Date.now();
        if (now - this.lastHotkeyNotice < 500) return;
        this.lastHotkeyNotice = now;
        new Notice(text, 1200);
    }

    /** 顶栏标题（#345）：文本 + 悬停全称 —— 被省略号截断后 data-tip 是唯一能看到完整标题的入口 */
    protected setHeadTitle(text: string): void {
        const el = this.headTitleEl;
        if (!el) return;
        el.setText(text);
        el.setAttribute('data-tip', text);
    }

    /** 窄屏「更多」浮层开合（#345）：与设置下拉同款；两者互斥 */
    protected toggleMore(): void {
        if (!this.morePanelEl) return;
        this.hideSelbar();
        this.hideMenu();
        this.moreOpen = !this.moreOpen;
        this.morePanelEl.toggleClass('hidden', !this.moreOpen);
        this.moreBtn?.toggleClass('active', this.moreOpen);
    }

    /** 收起「更多」浮层（外部 mousedown / 切走时调用）；未开则跳过 */
    protected hideMore(): void {
        if (!this.moreOpen) return;
        this.moreOpen = false;
        this.morePanelEl?.addClass('hidden');
        this.moreBtn?.removeClass('active');
    }

    /** 设定字体族（切换；#351 建为下拉 / #351e 改纯字变色）：即时应用 + 同步亮起态 + 写回设置 */
    protected setFontFamily(v: ReaderFontFamily): void {
        this.fontFamily = normalizeFontFamily(v);
        this.syncSegItems(this.familySeg, this.fontFamily);
        this.applyTypeStyle(true);
    }

    /** 设定字重（分段；#351）：即时应用 + 写回设置 */
    protected setFontWeight(v: ReaderFontWeight): void {
        this.fontWeight = normalizeFontWeight(v);
        this.syncSegItems(this.weightSeg, this.fontWeight);
        this.applyTypeStyle(true);
    }

    /** 应用 + （可选）写回设置 —— 打开面板时的初次应用也要走这里（persist=false） */
    protected applyTypeStyle(persist: boolean): void {
        this.applyTypeVars();
        if (persist) {
            this.options.onSettingsChange?.({
                fontSize: this.currentFontPx(),
                lineHeight: this.currentLineHeight(),
                fontFamily: this.fontFamily,
                fontWeight: this.fontWeight,
                letterSpacing: this.letterSpacing,
            });
        }
        this.syncSettingsLabels();
    }

    /** 云合成 Key（每次现取 ⇒ 设置页刚填完就能用，不必重开阅读器） */
    protected cloudKey(): string {
        return (this.options.getCloudKey?.() ?? "").trim();
    }

    /** 左键：朗读 / 停止切换；当前音源不可用时**说明原因**（不静默没反应） */
    protected toggleTts(): void {
        const svc = this.ttsSvc;
        if (!svc) return;
        if (!svc.available()) {
            new Notice(
                svc.engineKind === "cloud"
                    ? "云合成不可用：请到 设置 → AI集成 › 模型服务 · 硅基流动 填写 Key，或右键「朗读」切回系统语音"
                    : "当前环境不支持系统语音；可右键「朗读」切到云合成",
                6000,
            );
            return;
        }
        svc.toggle();
    }

    /** 同步按钮亮起态与提示（朗读中 = 亮 + 「停止朗读」） */
    protected syncTtsBtn(on: boolean): void {
        this.ttsBtnEl?.toggleClass("is-on", on);
        this.ttsBtnEl?.setAttribute("data-tip", on ? "停止朗读" : "从本段开始朗读");
    }

    /**
     * 朗读按钮可用性。🔴 **只要还有一种音源可用就不置灰** —— 置灰会连右键都点不开，
     * 用户就被困在不可用的音源里，没法在弹窗里切回能用的那个。
     * 两种都不可用（移动端无系统语音 + 未配云 Key）才置灰，并写明原因。
     */
    protected syncTtsAvailability(): void {
        const btn = this.ttsBtnEl;
        if (!btn) return;
        const anyOk = !!this.ttsSvc?.available() || ttsSupported() || !!this.cloudKey();
        btn.disabled = !anyOk;
        if (!anyOk) btn.setAttribute("data-tip", "当前环境不支持语音朗读");
    }

    /**
     * 右键弹窗（#340 建立；#341 语速改滑条；#343 方案 A 加音调 / 分组 / 试听；#344 加音源切换与云音色）。
     * 分组由 `pure/tts.buildTtsMenu` 按当前音源产出：**音源 chips 恒在**（用户 #344 裁定「弹窗里也能切」），
     * 系统音源 = 音调 + 语音分组；云音源 = 音色分组（🔴 **无音调行** —— 云侧不支持 pitch）。
     * 🔴 滑条拖动中**只改显示值**，松手（`change`）才交给服务 —— 拖动每帧都重启朗读会卡成一片；
     *    `setRate` / `setPitch` 都走 `restart()`，朗读不中断、按钮不熄灭。
     * 🔴 语音 / 音色项右侧 `▶` = **试听**（不改变选中、不关弹窗）；点整行才是选中（并按音源分别记住）。
     */
    protected openTtsMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.ttsBtnEl;
        const svc = this.ttsSvc;
        if (!btn || !svc) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
        for (const g of buildTtsMenu({
            engine: svc.engineKind,
            cloudReady: !!this.cloudKey(),
            rate: svc.currentRate,
            pitch: svc.currentPitch,
            volume: svc.currentVolume,
            voices: svc.voices(),
            curUri: svc.currentVoiceUri,
            cloudVoices: cloudVoiceGroups(loadCloudVoice()),
        })) {
            wrap.createDiv({ cls: "rl-reader-pop-title", text: g.title });
            if (g.select) {
                // 🔴 #351e 用户口径：音源由并排 chips 改成**下拉选择器**
                const opts = g.select;
                const cur = opts.find((c) => c.on)?.value ?? "";
                const sel = wrap.createEl("select", { cls: "rl-reader-pop-select" });
                for (const c of opts) {
                    // ⚠️ 不可用项**不置 disabled**：置灰的 <option> 根本选不了，用户就永远不知道要去哪配。
                    //    这里保持可选，选到不可用时弹一次说明再自动回落当前音源（#344 口径：不静默没反应）。
                    sel.createEl("option", { text: c.label, attr: { value: c.value } });
                }
                sel.value = cur;
                sel.addEventListener("change", () => {
                    const picked = opts.find((c) => c.value === sel.value);
                    if (picked?.disabled) {
                        new Notice(picked.hint || "当前音源不可用", 5000);
                        sel.value = cur; // 回落，不留下「显示云音源、实际还在系统语音」的假状态
                        return;
                    }
                    this.switchEngine(sel.value as TtsEngineKind);
                });
                continue;
            }
            if (g.slider) {
                const isRate = g.title === "语速";
                const isVolume = g.title === "音量";
                this.mkTtsSlider(wrap, {
                    slider: g.slider,
                    label: isRate ? ttsRateLabel : isVolume ? ttsVolumeLabel : ttsPitchLabel,
                    tip: isRate
                        ? "拖动调整朗读语速（键盘 ←/→ 微调）"
                        : isVolume
                          ? "拖动调整朗读音量（键盘 ←/→ 微调）"
                          : "拖动调整朗读音调（键盘 ←/→ 微调）",
                    apply: (v) => {
                        if (isRate) {
                            svc.setRate(v);
                            saveTtsRate(v); // 记住语速（跨书/跨面板）
                        } else if (isVolume) {
                            svc.setVolume(v);
                            saveTtsVolume(v); // 记住音量（跨书 / 跨音源）
                        } else {
                            svc.setPitch(v);
                        }
                    },
                });
                continue;
            }
            if (g.voiceGroups?.length) {
                // 🔴 #351e 用户口径：语音 / 音色也改成**下拉选择器**；原有分组（中文 → 英语 → 其它 /
                //    男声 → 女声）用 `<optgroup>` 保留 —— 分组是挑音色时最有用的信息，不能因为换控件丢掉。
                const box = wrap.createDiv({ cls: "rl-reader-pop-select-row" });
                const sel = box.createEl("select", { cls: "rl-reader-pop-select" });
                let curVoice = "";
                for (const vg of g.voiceGroups) {
                    const og = sel.createEl("optgroup", { attr: { label: vg.label } });
                    for (const it of vg.items) {
                        og.createEl("option", { text: it.label, attr: { value: it.value } });
                        if (it.on) curVoice = it.value;
                    }
                }
                sel.value = curVoice;
                // 试听从「每项一个 ▶」收成一个按钮：读**当前选中**那个（#343 的试听能力保留）
                const tryBtn = box.createEl("button", { cls: "rl-reader-pop-try", attr: { type: "button", "aria-label": "试听" } });
                setIcon(tryBtn, "play");
                tryBtn.setAttribute("data-tip", "试听");
                tryBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    svc.previewVoice(sel.value);
                });
                sel.addEventListener("change", () => {
                    svc.setVoice(sel.value);
                    // 🔴 按音源分别记：系统 voiceURI 与云音色全称不是同一个 id 空间
                    if (svc.engineKind === "cloud") saveCloudVoice(sel.value);
                    else saveVoiceUri(sel.value);
                    // ⚠️ 不再 closePop()：原来是「每项一个按钮、点完就收」；改成下拉后**留在原地**更顺手 ——
                    //    换完音色可以接着点「试听」或拖语速（同一块面板里一次调完）。
                });
            }
        }
        // 快捷键小字（#351 用户口径：[空格: 暂停/播放]）
        const hint = wrap.createDiv({ cls: "rl-reader-pop-hint" });
        hint.createDiv({ text: "空格：暂停 / 播放" });
    }

    /**
     * 弹窗里切音源（#344 用户裁定「弹窗里也能切」）。
     * 🔴 走 `setEngineKind` = restart 口径：在朗读则**从当前句用新引擎续读**，按钮不灭、位置不丢；
     *    切完装上**该音源自己的**记忆音色（没有记忆就用该音源的缺省），避免拿上一个音源的 id 串味。
     */
    protected switchEngine(kind: TtsEngineKind): void {
        const svc = this.ttsSvc;
        if (!svc) return;
        if (kind !== svc.engineKind) {
            if (!svc.setEngineKind(kind)) {
                new Notice(
                    kind === "cloud"
                        ? "云合成不可用：请先到 设置 → AI集成 › 模型服务 · 硅基流动 填写 Key"
                        : "当前环境不支持系统语音",
                    5000,
                );
                return;
            }
            svc.setVoice(kind === "cloud" ? loadCloudVoice() : loadVoiceUri());
            saveTtsEngine(kind);
            this.syncTtsAvailability();
        }
        this.closePop();
    }

    /** 朗读弹窗里的一行滑条（语速 / 音调共用）：拖动只改值文本，松手才落到服务 */
    protected mkTtsSlider(
        wrap: HTMLElement,
        o: {
            slider: { min: number; max: number; step: number; value: number };
            label: (v: number) => string;
            tip: string;
            apply: (v: number) => void;
        },
    ): void {
        const line = wrap.createDiv({ cls: "rl-reader-menu-row" });
        const slider = line.createEl("input", {
            cls: "rl-reader-menu-slider",
            attr: {
                type: "range",
                min: String(o.slider.min),
                max: String(o.slider.max),
                step: String(o.slider.step),
                value: String(o.slider.value),
                "data-tip": o.tip,
            },
        });
        const val = line.createSpan({ cls: "rl-reader-menu-val", text: o.label(o.slider.value) });
        slider.addEventListener("input", () => val.setText(o.label(Number(slider.value))));
        slider.addEventListener("change", () => {
            const v = Number(slider.value);
            o.apply(v);
            val.setText(o.label(v));
        });
    }

    /**
     * 右键弹窗：自动推进的**速度**（#341 建立；#342 起**两行恒在**）。
     * 🔴 两行都给（用户 #342：「加个翻页模式下自动翻页的间隔秒数」）—— 不论当前是滚动还是翻页模式都能调，
     *   免得出现「切到某个模式才看得见」的「找不着」。两行生效方式不同：
     *   滚动速度**按帧读取 ⇒ 立即生效**；翻页间隔在定时器里 ⇒ 改完要 `restartAutoIfOn()` 重建。
     */
    protected openAutoMenu(ev: MouseEvent): void {
        ev.preventDefault();
        ev.stopPropagation();
        const btn = this.autoBtnEl;
        if (!btn) return;
        const wrap = this.openPop(btn);
        if (!wrap) return;
        // #351 用户口径：**翻页间隔在前、滚动速度在后**（当前模式那一条先看到）
        this.mkAutoSlider(wrap, {
            title: "翻页间隔",
            min: AUTO_TURN_MIN_MS,
            max: AUTO_TURN_MAX_MS,
            step: AUTO_TURN_STEP_MS,
            value: this.autoTurnMs,
            tip: "拖动调整翻页间隔",
            label: autoTurnLabel,
            apply: (v) => {
                this.autoTurnMs = clampAutoTurnMs(v);
                if (this.autoOn && this.isPaged()) this.restartAutoIfOn(); // 定时器要按新间隔重建才生效
                return this.autoTurnMs;
            },
        });
        this.mkAutoSlider(wrap, {
            title: "滚动速度",
            min: AUTO_SCROLL_MIN,
            max: AUTO_SCROLL_MAX,
            step: AUTO_SCROLL_STEP,
            value: this.autoScrollPx,
            tip: "拖动调整滚动速度",
            // 🔴 速度文案按**当前字号**换算成「字/分」（#351 用户口径）；字号变了字/分跟着变，但 px/s 真源不动
            label: (v) => autoSpeedLabel(v, this.currentFontPx()),
            apply: (v) => {
                this.autoScrollPx = clampAutoScrollPx(v);
                saveAutoScrollPx(this.autoScrollPx); // 按帧读取 ⇒ 立刻生效，无需重启
                return this.autoScrollPx;
            },
        });
        // 快捷键小字（#351）：浮层里当下的键位提示
        const hint = wrap.createDiv({ cls: 'rl-reader-pop-hint' });
        hint.createDiv({ text: '↑↓：调速，不打断当前滚动' });
        hint.createDiv({ text: '空格：暂停 / 继续' });
    }

    /** 自动调速弹窗里的一行（标题 + 横向滑条 + 值文本；拖动只改值文本，松手才落库/生效） */
    protected mkAutoSlider(
        wrap: HTMLElement,
        o: {
            title: string;
            min: number;
            max: number;
            step: number;
            value: number;
            tip: string;
            label: (v: number) => string;
            apply: (v: number) => number;
        },
    ): void {
        wrap.createDiv({ cls: "rl-reader-pop-title", text: o.title });
        const line = wrap.createDiv({ cls: "rl-reader-menu-row" });
        const slider = line.createEl("input", {
            cls: "rl-reader-menu-slider",
            attr: {
                type: "range",
                min: String(o.min),
                max: String(o.max),
                step: String(o.step),
                value: String(o.value),
                "data-tip": o.tip,
            },
        });
        const val = line.createSpan({ cls: "rl-reader-menu-val", text: o.label(o.value) });
        slider.addEventListener("input", () => val.setText(o.label(Number(slider.value))));
        slider.addEventListener("change", () => val.setText(o.label(o.apply(Number(slider.value)))));
    }

    /** 开一个按钮右键弹窗（挂在按钮所在行下方；两个弹窗互斥 —— 先收旧的） */
    protected openPop(btn: HTMLButtonElement): HTMLDivElement | null {
        this.closePop();
        const row = btn.parentElement as HTMLElement | null;
        if (!row) return null;
        const wrap = row.createDiv({ cls: "rl-reader-pop" });
        // 🔴 #351e 修（#351 搬按钮时漏掉的配套）：浮层里的交互（下拉 / 试听 / 滑条）**必须自己挡住 mousedown**，
        //    否则 document 的 onDocMouseDown 会先把浮层 remove 掉 ⇒ mousedown 与 mouseup 之间目标被换掉，
        //    浏览器把 click 派发到两者的最近公共祖先（= 谁都不是），于是「点了一点反应都没有」。
        //    ⚠️ 老版浮层挂在**设置菜单**里，是被 `menu` 的 mousedown 挡板顺带保护着的；#351 把按钮搬到
        //    `.rl-reader-fops` 后就没人挡了 —— 换成 `<select>` 更会直接致命（原生下拉会被立刻关掉）。
        wrap.addEventListener("mousedown", (ev) => ev.stopPropagation());
        // 🔴 #351b 修：底栏图标组（`.rl-reader-fops`）是容器的**最后一行**，浮层若照旧向下开
        //    （`top: calc(100% + 4px)`，包含块 = `.rl-reader-footer`）会落到容器外/视口外 ⇒
        //    用户观感就是「右键没反应」。这一处必须**向上**开（`.rl-reader-pop-up`，配 `.rl-reader-fops { position: relative }`）。
        if (row.hasClass("rl-reader-fops")) wrap.addClass("rl-reader-pop-up");
        this.popEl = wrap;
        return wrap;
    }

    /** 收起按钮右键弹窗（外部 mousedown / 选完项） */
    protected closePop(): void {
        this.popEl?.remove();
        this.popEl = null;
    }

    /** 设置下拉开合切换：加/去 hidden + 按钮 active 态；打开时同步当前字号/行距/全屏文案 */
    protected toggleSettings(): void {
        if (!this.menuEl) return;
        // ≡ mousedown 已 stopPropagation（防 doc 先收起导致 toggle 反相），故这里显式收起可能残留的选中动作条
        this.hideSelbar();
        this.hideMore();
        this.settingsOpen = !this.settingsOpen;
        this.menuEl.toggleClass('hidden', !this.settingsOpen);
        this.settingsBtn?.toggleClass('active', this.settingsOpen);
        if (this.settingsOpen) {
            this.syncSettingsLabels();
            this.syncSegLabels();
            this.syncThemeSwatches();
            this.syncViewBtns();
        }
    }

    /** 收起设置下拉（外部 mousedown / 视情况调用）；未开则跳过 */
    protected hideMenu(): void {
        if (!this.settingsOpen) return;
        this.settingsOpen = false;
        this.menuEl?.addClass('hidden');
        this.settingsBtn?.removeClass('active');
    }

    /** 刷新菜单字号 / 行距的当前值文本与滑条位置（打开菜单、调整后调用） */
    protected syncSettingsLabels(): void {
        const px = this.currentFontPx();
        const lh = Math.round(this.currentLineHeight() * 100) / 100;
        if (this.menuFontVal) this.menuFontVal.setText(`${px}px`);
        if (this.menuLineVal) this.menuLineVal.setText(`${lh}`);
        // 滑条与真源对齐：键盘 +/− 走的是同一套 apply*，滑条必须跟着动
        if (this.menuFontSlider) this.menuFontSlider.value = String(px);
        if (this.menuLineSlider) this.menuLineSlider.value = String(lh);
        // 字距（#351）：值文本 + 滑条回位（同上口径）
        if (this.letterVal) this.letterVal.setText(formatLetterSpacing(this.letterSpacing));
        if (this.letterSlider) this.letterSlider.value = String(this.letterSpacing);
    }

    /** 同步三个分段控制器（阅读模式 / 行宽 / 缩进）—— 打开菜单、改设置后调用（#351） */
    protected syncSegLabels(): void {
        this.syncSegItems(this.modeSeg, this.mode);
        this.syncSegItems(this.widthSeg, this.lineWidth);
        this.syncSegItems(this.indentSeg, String(this.indent));
    }

    /** 同步主题色卡选中态（打开菜单、切换主题后调用） */
    protected syncThemeSwatches(): void {
        for (const meta of READER_THEMES) {
            this.themeSwatches[meta.id]?.toggleClass('is-on', meta.id === this.theme);
        }
    }

    /** 应用主题：容器上只保留当前档的 rl-rt-* 类（follow = 无类，完整继承 Obsidian 主题） */
    protected applyTheme(): void {
        for (const meta of READER_THEMES) {
            const cls = readerThemeClass(meta.id);
            if (cls) this.container.removeClass(cls);
        }
        const cls = readerThemeClass(this.theme);
        if (cls) this.container.addClass(cls);
    }

    // ── 高亮样式/颜色（用户 2026-09-16 十五轮，按参考图重做）：A 样式预览 + 五色圆点 + 垃圾桶 ──

    /** 构建样式选择器浮层（懒建一次；挂在动作条同一父级） */
    protected buildHlPicker(): HTMLDivElement | null {
        if (this.hlPickerEl) return this.hlPickerEl;
        const parent = this.selbarParent;
        if (!parent) return null;
        const p = parent.createDiv({ cls: 'rl-hl-picker hidden' });
        p.addEventListener('mousedown', (ev) => ev.stopPropagation());
        // 样式：字母 A 按该样式预览（高亮=底色 / 划线=下划线 / 波浪=波浪线），选中档加外圈环
        const styles = p.createDiv({ cls: 'rl-hl-styles' });
        for (const st of HL_STYLES) {
            const b = styles.createEl('button', {
                cls: 'rl-hl-style',
                attr: { type: 'button', 'data-style': st.id, 'data-tip': st.label },
            });
            b.createSpan({ cls: 'rl-hl-a', text: 'A' });
            b.createSpan({ cls: 'rl-sr', text: st.label });
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => void this.pickHlStyle(st.id, this.hlColor));
            this.hlStyleBtns[st.id] = b;
        }
        // 颜色：一行圆点（当前色打 ✓）
        const colors = p.createDiv({ cls: 'rl-hl-colors' });
        for (const co of HL_COLORS) {
            const d = colors.createEl('button', {
                cls: 'rl-hl-color',
                attr: { type: 'button', 'data-color': co.id, 'data-tip': `${co.label}色` },
            });
            d.addEventListener('mousedown', (ev) => ev.stopPropagation());
            d.addEventListener('click', () => void this.pickHlStyle(this.hlStyle, co.id));
            this.hlColorBtns[co.id] = d;
        }
        // 垃圾桶：仅当选区命中已有高亮/摘抄时可删（用户 2026-09-16 选定「搬进浮层」）
        const trash = p.createEl('button', { cls: 'rl-hl-trash hidden', attr: { type: 'button', 'data-tip': '删除这段' } });
        safeSetIcon(trash, 'trash-2');
        trash.addEventListener('mousedown', (ev) => ev.stopPropagation());
        trash.addEventListener('click', () => void this.trashSelection());
        this.hlTrashBtn = trash;
        this.hlPickerEl = p;
        return p;
    }

    protected hideHlPicker(): void {
        this.hlPickerEl?.addClass('hidden');
        this.hlPickerAnchor = null;
    }

    /** 选定样式或颜色：改「刚建/目标那条」高亮（删旧 + 按新样式重写）+ 记为下次默认 */
    protected async pickHlStyle(style: HlStyle, color: HlColor): Promise<void> {
        this.hlStyle = style;
        this.hlColor = color;
        this.options.onSettingsChange?.({
            fontSize: this.currentFontPx(),
            lineHeight: this.currentLineHeight(),
            hlStyle: style,
            hlColor: color,
        });
        const id = this.hlPickerTargetId;
        if (!id) return;
        const rec = this.highlightList.find((h) => h.id === id);
        this.hlPickerTargetId = null;
        if (!rec) return;
        const loc = rec.loc ?? this.currentLoc();
        const recId = rec.id;
        if (!recId) return;
        // 🔴 本方法是「改写这一条的样式/颜色」→ 必须先删旧块再写新块。
        //    只写不删会在笔记里叠出多条同选段高亮（用户 2026-09-17 实测「点一次出两条」）。
        //    走不弹确认的直删通道（与浮层垃圾桶同一条），不用会弹窗的删除入口。
        if (!this.options.onTrashSelection) {
            new Notice('当前阅读器不支持改写高亮样式，请先删除该高亮再重新标注');
            return;
        }
        try {
            // 返回 0 = 笔记里已无该块（本地列表过期）→ 照常继续写新块
            // { quiet: true }：这一步是改样式的中间步骤，不该单独报「已删除 N 条」——
            // 改样式是**一次用户动作**，只在该方法末尾报一条（用户 2026-09-18 报「弹三条提示」）。
            await this.options.onTrashSelection({ highlightIds: [recId], excerptIds: [] }, { quiet: true });
        } catch (err) {
            new Notice(`改写高亮失败：${err instanceof Error ? err.message : String(err)}`);
            this.hlPickerTargetId = recId;
            return;
        }
        this.highlightList = this.highlightList.filter((h) => h.id !== recId);
        // 同样静默：新块由本方法末尾一条提示统一代表（写失败时 doHighlight 已自行 Notice，返回 null → 不再报「已更新」）
        const newId = await this.doHighlight(rec.quote, loc.chapter, loc.pct, style, color, true);
        if (!newId) return;
        // 重写后是新块 id → 让后续改动能继续命中同一条
        this.hlPickerTargetId = newId;
        this.hlTrashReady = Boolean(this.hlPickerTargetId);
        this.showHlPicker(this.hlPickerAnchor);
        // ⚠️ 选完一次样式**也不收起**（用户 2026-09-17 改口径：可继续换档/换色比对，改样式走
        //    「先删旧再写新」无副作用）——色板与动作条统一等「点正文其他区域」由
        //    onDocMouseDown → hideSelbar（内含 hideHlPicker）收起。
        new Notice('已更新高亮样式');
    }

    /** 切换首行缩进（键盘等旧调用点） */
    protected toggleIndent(): void {
        this.setIndent(!this.indent);
    }

    // ── 翻页模式（iframe 内 body 单列 columns 分页 + transform 逐页平移） ──

    protected isPaged(): boolean {
        return this.mode === 'paged';
    }

    /** iframe 内滚动元素（连续模式纵向；翻页模式体宽度超 frame，用其测总宽）——复用滚动节区既有 frameScroller() */

    /**
     * 🔴 #469 记录「已知位置」缓存（0-1 钳制）：`lastRatio` 的**非测量更新点** ——
     * 人为定位（恢复 / 重排 / 跳转）之后目标位置就是已知位置；**切章必须归零**（新章从章头起）。
     * ⛔ 别在别处直接赋值 `lastRatio`：口径散开就会漂（与 TXT 面板同一份口径）。
     */
    protected markRatio(ratio: number): void {
        this.lastRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
    }

    /** 全屏切换：已全屏 → 退出；否则对最近 .modal（兼容旧弹窗）或视图容器请求全屏；异常/不支持静默忽略 */
    protected toggleFullscreen(): void {
        try {
            if (document.fullscreenElement) {
                void document.exitFullscreen?.().catch(() => {});
            } else {
                const target = (this.container.closest('.modal') ?? this.container) as HTMLElement | null;
                void target?.requestFullscreen?.().catch(() => {});
            }
        } catch {
            // 全屏不可用：静默
        }
    }

    /** 同步菜单三按钮高亮与全屏悬停提示（fullscreenchange、下拉打开、状态切换时调用） */
    protected syncViewBtns(): void {
        const fs = !!document.fullscreenElement;
        if (this.fsBtnEl) {
            this.fsBtnEl.toggleClass("is-on", fs);
            if (!this.fsBtnEl.disabled) this.fsBtnEl.setAttribute("data-tip", fs ? "退出全屏" : "全屏显示");
        }
        this.immersiveBtnEl?.toggleClass("is-on", this.immersive);
        this.autoBtnEl?.toggleClass("is-on", this.autoOn);
    }

    /** 沉浸模式：点击正文空白 = 收起 / 展开上下边栏（用户 2026-09-15 裁定，替代原「鼠标移到边缘唤出」；非沉浸态跳过） */
    protected toggleBars(): void {
        if (!this.immersive || !this.headEl) return;
        if (this.headEl.hasClass("hidden")) {
            this.headEl.removeClass("hidden");
            this.footEl?.addClass("rl-foot-show");
        } else {
            this.headEl.addClass("hidden");
            this.footEl?.removeClass("rl-foot-show");
            this.hideMenu(); // 顶栏收起时一并收起设置下拉，防菜单悬在空中
        }
    }

    /** 打开/关闭自动推进（用户 2026-09-15）：滚动模式匀速自动滚动；翻页模式定时自动翻页 */
    protected setAuto(on: boolean): void {
        if (on === this.autoOn) return;
        this.stopAuto();
        if (on) {
            this.autoOn = true;
            if (this.isPaged()) this.startAutoTimer();
            else this.startAutoScroll();
        }
        // 🔴 #351b 修：同上 —— 自动按钮也在底栏，高亮同步不能再看面板开没开
        this.syncViewBtns();
    }

    /** 模式切换后重启自动推进（滚动用 rAF、翻页用定时器，两条实现不同） */
    protected restartAutoIfOn(): void {
        if (!this.autoOn) return;
        this.stopAuto();
        this.autoOn = true;
        if (this.isPaged()) this.startAutoTimer();
        else this.startAutoScroll();
    }

    /** 开始自动翻页（定时 goNextPage；到全书末页自动停） */
    protected startAutoTimer(): void {
        if (this.autoTimer !== null) return;
        this.autoTimer = window.setInterval(() => this.autoTurnTick(), this.autoTurnMs);
    }

    /** 停止自动推进（关自动 / 销毁时调用）：清 rAF 与定时器 + 复位开关 */
    protected stopAuto(): void {
        this.autoOn = false;
        this.autoPos = null; // #342：下次开自动重新与真实位置对表
        if (this.autoRaf !== null) {
            window.cancelAnimationFrame(this.autoRaf);
            this.autoRaf = null;
        }
        if (this.autoTimer !== null) {
            window.clearInterval(this.autoTimer);
            this.autoTimer = null;
        }
    }

    /**
     * ‹ 上一章：非首章 → switchChapter(−1) 滚到章头；首章 → Notice
     */
    protected navPrev(): void {
        if (this.chapterIndex === 0) {
            new Notice('已是开头');
            return;
        }
        this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: 0 });
        this.options.onProgressPersist?.(estimatePercent(this.chapterSizes(), this.chapterIndex, 0));
        this.switchChapter(this.chapterIndex - 1);
    }

    /**
     * 顶栏「高亮」模式（选中即高亮）：新增成功后浮出样式色板，与「点动作条高亮」同款可选样式行为
     * （用户 2026-09-17 裁定）。不弹图标动作条 —— 该模式本就是「选中即走」，动作条会打断连续标注；
     * 色板以鼠标位置为锚点，**选完样式也不收**，点正文其他区域才收。
     */
    protected async highlightFromMode(text: string, loc: { chapter: number; pct: number }, anchor: { x: number; y: number } | null): Promise<void> {
        const before = this.highlightList.length;
        await this.toggleHighlight(text, loc);
        const added = this.highlightList.length > before ? this.highlightList[this.highlightList.length - 1] : null;
        if (!added?.id) return; // 取消高亮 / 新增失败：不动浮层
        this.hlTrashReady = true;
        this.hlPickerTargetId = added.id;
        this.showHlPicker(anchor);
    }

    /** 收起动作条并清空选区记录（不动浏览器选区高亮）；滚动/点击面板外/动作完成后调用 */
    protected hideSelbar(): void {
        this.selbar?.classList.add('hidden');
        this.selRecord = null;
        this.hideHlPicker();
    }

    /** 动作条「❝ 摘抄」：收起动作条 → 就地弹出摘抄卡片（在卡里写想法，Enter 保存）；无回调则提示 */
    protected addSelExcerpt(): void {
        const rec = this.selRecord;
        if (!rec) {
            this.hideSelbar();
            return;
        }
        // 动作条收起前取它的位置作卡片锚点（client 坐标 → 卡片落在刚点的按钮上方）
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showExcerptCard(rec.text, { chapter: rec.chapter, pct: rec.pct }, anchor);
    }

    // ── 摘抄就地卡片（用户 2026-09-17 裁定 C 方案：划词就地写、不打断阅读） ──

    /** 动作条当前位置（宿主 client 坐标）：作卡片锚点；动作条未定位过 → null（卡片退回容器中部） */
    protected selbarAnchorClient(): { x: number; y: number } | null {
        const bar = this.selbar;
        const parent = this.selbarParent;
        if (!bar || !parent) return null;
        const left = parseFloat(bar.style.left);
        const top = parseFloat(bar.style.top);
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
        const pRect = parent.getBoundingClientRect();
        return { x: pRect.left + left + (bar.offsetWidth || 0) / 2, y: pRect.top + top + bar.offsetHeight };
    }

    /** 懒建摘抄卡片（挂动作条同一父级=宿主文档；卡片自身 mousedown 不冒泡 → 点卡内不触发 onDocMouseDown） */
    protected buildExcerptCard(): HTMLDivElement | null {
        if (this.excerptCard) return this.excerptCard;
        const parent = this.selbarParent;
        if (!parent) return null;
        const card = parent.createDiv({ cls: 'rl-excard hidden' });
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        const head = card.createDiv({ cls: 'rl-excard-head' });
        head.createDiv({ cls: 'rl-excard-title', text: '添加摘抄' });
        this.excerptLocEl = head.createDiv({ cls: 'rl-excard-loc' });
        const body = card.createDiv({ cls: 'rl-excard-body' });
        this.excerptQuoteEl = body.createDiv({ cls: 'rl-excard-quote' });
        // 引用默认收起（CSS max-height），超阈值才给「展开 / 收起」
        const more = body.createEl('button', { cls: 'rl-excard-more hidden', attr: { type: 'button' }, text: '展开' });
        more.addEventListener('click', () => {
            const q = this.excerptQuoteEl;
            if (!q) return;
            const open = !q.hasClass('is-open');
            q.toggleClass('is-open', open);
            more.setText(open ? '收起' : '展开');
        });
        this.excerptMoreBtn = more;
        const noteField = body.createDiv({ cls: 'rl-excard-field' });
        noteField.createDiv({ cls: 'rl-excard-label', text: '想法（可选，支持 [[双链]]）' });
        const note = noteField.createEl('textarea', {
            cls: 'rl-excard-note',
            attr: { rows: '3', placeholder: '写下此刻的想法…（可留空）' },
        });
        // 🔴 Ctrl / ⌘ + Enter 保存；单独 Enter 与 Shift+Enter 一律留给换行（想法多为多行）。
        // 输入法组合态不提交（中文选词的 Enter 不是命令）
        note.addEventListener('keydown', (ev) => {
            const action = excerptCardKeyAction({
                key: ev.key,
                ctrlKey: ev.ctrlKey,
                metaKey: ev.metaKey,
                composing: ev.isComposing || ev.keyCode === 229,
            });
            if (action !== 'submit') return;
            ev.preventDefault();
            void this.submitExcerptCard();
        });
        this.excerptNoteEl = note;
        const foot = card.createDiv({ cls: 'rl-excard-foot' });
        const cancel = foot.createEl('button', { cls: 'rl-excard-btn', attr: { type: 'button' }, text: '取消' });
        cancel.addEventListener('click', () => this.hideExcerptCard());
        const save = foot.createEl('button', { cls: 'rl-excard-btn rl-excard-save', attr: { type: 'button', 'data-tip': '保存（Ctrl/⌘+Enter）' }, text: '保存摘抄' });
        save.addEventListener('click', () => void this.submitExcerptCard());
        this.excerptSaveBtn = save;
        this.excerptCard = card;
        return card;
    }

    /** 就地弹出摘抄卡片（anchor = 宿主 client 坐标；Enter 保存、Esc / 点正文其他区域取消） */
    protected showExcerptCard(quote: string, loc: { chapter: number; pct: number }, anchor: { x: number; y: number } | null): void {
        if (!this.options.onExcerptSave) {
            new Notice('当前阅读器不支持写摘抄');
            return;
        }
        const card = this.buildExcerptCard();
        const parent = this.selbarParent;
        if (!card || !parent) return;
        this.excerptCardQuote = quote;
        this.excerptCardLoc = loc;
        this.excerptLocEl?.setText(excerptCardLocLabel(this.options.title, loc));
        this.excerptQuoteEl?.setText(quote);
        this.excerptQuoteEl?.removeClass('is-open');
        this.excerptMoreBtn?.toggleClass('hidden', !needsQuoteExpand(quote));
        this.excerptMoreBtn?.setText('展开');
        if (this.excerptNoteEl) this.excerptNoteEl.value = '';
        this.excerptSaveBtn?.removeAttribute('disabled');
        card.removeClass('hidden');
        // 定位要量卡片尺寸（hidden 时 rect 全 0）→ 摘掉 hidden 后下一帧再算
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const pos = placeCard({
                anchorX: anchor ? anchor.x - pRect.left : pRect.width / 2,
                anchorY: anchor ? anchor.y - pRect.top : pRect.height / 3,
                cardW: cRect.width,
                cardH: cRect.height,
                boxW: pRect.width,
                boxH: pRect.height,
            });
            card.style.left = `${pos.left}px`;
            card.style.top = `${pos.top}px`;
            this.excerptNoteEl?.focus();
        });
    }

    /** 收起卡片并丢弃待写入内容（Esc / 点正文其他区域 / 保存成功后） */
    protected hideExcerptCard(): void {
        this.excerptCard?.addClass('hidden');
        this.excerptCardQuote = '';
        this.excerptCardLoc = null;
    }

    /** 卡片是否打开（Esc 分派用：打开时只收卡片，不关整个阅读器） */
    protected isExcerptCardOpen(): boolean {
        return Boolean(this.excerptCard && !this.excerptCard.hasClass('hidden'));
    }

    // ── 高亮（页内持久黄标 + 阅读数据存档；笔记「## 高亮」区是存档生成的只读镜像；正文在 iframe，mark 注入 frame 文档） ──

    /** 本章高亮（loc.chapter === 当前章（1 基）） */
    protected currentChapterHighlights(): ReaderHighlight[] {
        return chapterHighlights(this.highlightList, this.chapterIndex + 1);
    }

    /** 动作条「高亮」按钮口径：选区已是本章高亮 → 提示改「取消高亮」（点击即删除该条） */
    protected syncSelbarHlTip(text: string): void {
        const b = this.selbarHlBtn;
        if (!b) return;
        const loc = this.currentLoc();
        const hl = findSameHighlight(this.highlightList, text, loc.chapter);
        const ex = findSameExcerpt(this.options.excerpts ?? [], text, loc.chapter);
        const label = hl ? '取消高亮' : '高亮';
        b.setAttribute('data-tip', label);
        const sr = b.querySelector('.rl-sr');
        if (sr) sr.textContent = label;
        // 动作条垃圾桶（用户 2026-09-18）：只在「选中文字就是本章某条已有高亮」时露脸 —— 危险操作不做常显。
        // 动作条垃圾桶（用户 2026-09-18）：只在**选段真的落在高亮 mark 上**（= 屏幕上看得见样式）时露脸。
        // 判据取 DOM 实际样式，而非「高亮清单里文本匹配」—— 后者在「清单有记录、本段没画出标记」时会假阳性。
        const hasMark = this.selRecord?.mark != null;
        this.selbarTrashBtn?.toggleClass('hidden', !hasMark);
        // 色板垃圾桶仍在「删得掉」时出现（选区命中已有高亮或摘抄）—— 浮层打开时据此显隐
        this.hlTrashReady = Boolean(hl || ex);
    }

    /** 删除**选中的**书签（#345）：confirm 一次 → 从内存列表移除 → 通知宿主落盘 → 重绘（书签只在阅读进度 JSON 里，不动笔记） */
    protected async deleteSelectedBookmarks(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 个书签吗？（书签只记在阅读进度文件里，之后可重新添加）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        const remaining = this.bookmarks().filter((b) => !b.id || !sel.has(b.id));
        this.options.bookmarks = remaining;
        this.options.onBookmarksChange?.(remaining);
        this.buildBookmarkToc();
        new Notice(`已删除 ${ids.length} 个书签`);
        return true;
    }

    /** 删除**选中的**摘抄（#345）：confirm 一次 → 批量删除（onPurgeAnnotations）→ 本地列表移除重绘 */
    protected async deleteSelectedExcerpts(ids: string[]): Promise<boolean> {
        const msg = `确定删除选中的 ${ids.length} 条摘抄吗？（将从笔记「## 摘抄」区一并移除）`;
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return false;
        const sel = new Set(ids);
        await this.options.onPurgeAnnotations?.('excerpt', ids);
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => !x.id || !sel.has(x.id));
        this.buildExcerptToc();
        new Notice(`已删除 ${ids.length} 条摘抄`);
        return true;
    }

    /**
     * 同步分区头按钮态（#345）：无条目时「选择」按钮藏起来（只留空态文案）；
     * 「删除所选」在没有勾选时禁用（避免空删）。
     */
    protected syncAnnoBtns(h: AnnoHeadHandles | null, sel: AnnoSelState, total: number): void {
        if (!h) return;
        h.selectBtn.toggleClass('hidden', total === 0 && !sel.on);
        h.delBtn.disabled = sel.ids.length === 0;
    }

    /** 就地译文浮层卡片（挂 selbarParent；标题「译文」+ ✕关闭；内容随翻译态更新） */
    protected buildTranslateCard(): void {
        if (!this.selbarParent || this.translateCard) return;
        const card = this.selbarParent.createDiv({ cls: 'rl-translate-card hidden' });
        const head = card.createDiv({ cls: 'rl-translate-card-head' });
        head.createSpan({ cls: 'rl-translate-card-title', text: '译文' });
        const close = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-translate-card-close', attr: { 'data-tip': '关闭' }, text: '✕' });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideTranslateCard());
        this.translateCardBody = card.createDiv({ cls: 'rl-translate-card-body' });
        card.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.translateCard = card;
    }

    /** 收起译文浮层（✕/滚动/点外部/切章调用）；进行中的翻译结果到达时若已隐藏则丢弃 */
    protected hideTranslateCard(): void {
        if (this.translateCard) this.translateCard.classList.add('hidden');
        if (this.translateCardBody) this.translateCardBody.removeClass('rl-translate-loading');
    }

    /** 动作条「网络搜索」/ 顶栏「网络搜索」模式：收起动作条 → 就地弹**引擎浮层**（查询词＝选中文字）。
     *  ⚠️ 与顶栏模式走同一条路；「AI 搜索」另有独立入口（openAiFromSelection → 搜索卡）。 */
    protected openNetFromSelection(): void {
        const seed = this.searchSeed();
        // 取动作条位置作锚点要在 hideSelbar 之前（收起后仍读得到 style.left/top，这里只是取一次）
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showNetPanel(seed, anchor);
    }

    /** 动作条「AI搜索」/ 顶栏「AI 搜索」模式：收起动作条 → 就地弹 AI 卡并自动跑「解读选段」。 */
    protected openAiFromSelection(): void {
        const seed = this.searchSeed();
        const anchor = this.selbarAnchorClient();
        this.hideSelbar();
        this.showSearchCard(seed, anchor);
    }

    /** 切 AI 卡两态（用户 2026-09-18）：'read' 解读选段（走设置页提示词）/ 'ask' 自定义提问（走内置固定提示词）。
     *  切态只改可见性与提示文案，**不自动发请求**（避免切一下就白烧一次额度）。 */
    protected setSearchMode(m: 'read' | 'ask'): void {
        this.searchMode = m;
        (Object.keys(this.searchModeBtns) as ('read' | 'ask')[]).forEach((k) => {
            this.searchModeBtns[k]?.toggleClass('is-on', k === m);
        });
        this.searchReadSecEl?.toggleClass('hidden', m !== 'read');
        this.searchAskSecEl?.toggleClass('hidden', m !== 'ask');
        this.searchBodyEl?.removeClass('rl-search-loading');
        this.searchBodyEl?.removeClass('rl-search-error');
        this.searchBodyEl?.setText(m === 'read' ? '正在解读…' : '输入问题后按回车。');
        if (m === 'ask') this.searchQuestionEl?.focus();
        else this.searchQueryEl?.focus();
    }

    /** 显示搜索卡（anchor = 宿主 client 坐标；null 退回容器中部）并自动发起「解读选段」。
     *  每次打开都回到「解读选段」态（上次可能停在「自定义提问」态），并锁存选段供提问态兜底。 */
    protected showSearchCard(query: string, anchor: { x: number; y: number } | null): void {
        const card = this.buildSearchCard();
        const parent = this.selbarParent;
        if (!card || !parent) return;
        this.searchCardText = query;
        if (this.searchQueryEl) this.searchQueryEl.value = query;
        if (this.searchQuestionEl) this.searchQuestionEl.value = '';
        this.searchQuoteEl?.setText(query ? `选段：${truncateQuote(query)}` : '未选中文字（可直接提问）');
        this.setSearchMode('read');
        card.removeClass('hidden');
        // 定位要量卡片尺寸（hidden 时 rect 全 0）→ 摘掉 hidden 后下一帧再算；AI 请求一并放到这一帧，避免布局抖动
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const cRect = card.getBoundingClientRect();
            const pos = placeCard({
                anchorX: anchor ? anchor.x - pRect.left : pRect.width / 2,
                anchorY: anchor ? anchor.y - pRect.top : pRect.height / 3,
                cardW: cRect.width,
                cardH: cRect.height,
                boxW: pRect.width,
                boxH: pRect.height,
            });
            card.style.left = `${pos.left}px`;
            card.style.top = `${pos.top}px`;
            this.searchQueryEl?.focus();
            void this.runAiSearch();
        });
    }

    /** 引擎图标（二选一浮层）：拼查询 URL → 系统浏览器打开结果页（空查询先提示选中文字） */
    protected openEngineSearch(engineId: SearchEngineId, query: string): void {
        const url = searchEngineUrl(engineId, query);
        if (!url) {
            new Notice('先选中要搜索的内容', 2500);
            return;
        }
        const open = this.options.onOpenExternal;
        if (!open) {
            new Notice('当前阅读器不支持打开外部链接', 3000);
            return;
        }
        open(url);
    }

    /** 跑一次 AI 搜索（弹卡时自动 / 查询框回车）：令牌机制丢弃过期响应（改词、关卡片后再到达的结果不覆盖） */
    protected async runAiSearch(): Promise<void> {
        const body = this.searchBodyEl;
        const card = this.searchCard;
        if (!body || !card) return;
        const q = this.searchQueryEl?.value.trim() ?? '';
        body.removeClass('rl-search-error');
        if (!q) {
            body.removeClass('rl-search-loading');
            body.setText('输入要搜索的内容后按回车。');
            return;
        }
        const run = this.options.onAiSearch;
        if (!run) {
            body.removeClass('rl-search-loading');
            body.addClass('rl-search-error');
            body.setText('当前阅读器不支持 AI 搜索');
            return;
        }
        const token = ++this.searchRunToken;
        body.addClass('rl-search-loading');
        body.setText('搜索中…');
        let answer: string | null = null;
        try {
            answer = await run(q);
        } catch {
            answer = null; // 宿主已弹 Notice（Key/网络/超时），这里只负责卡片状态
        }
        if (token !== this.searchRunToken || card.hasClass('hidden')) return; // 已改词/已关闭 → 丢弃
        body.removeClass('rl-search-loading');
        body.empty();
        if (answer) {
            body.setText(answer);
        } else {
            body.addClass('rl-search-error');
            body.setText('搜索失败');
        }
    }

    /** 跑一次「自定义提问」（提问框回车触发）：选段 + 问题一起发，**不读设置页提示词**。
     *  与 runAiSearch 共用 searchRunToken → 两条通道互相作废（答案永远对应最后一次操作）。 */
    protected async runAiAsk(): Promise<void> {
        const body = this.searchBodyEl;
        const card = this.searchCard;
        if (!body || !card) return;
        const q = this.searchQuestionEl?.value.trim() ?? '';
        body.removeClass('rl-search-error');
        if (!q) {
            body.removeClass('rl-search-loading');
            body.setText('输入问题后按回车。');
            return;
        }
        const ask = this.options.onAiAsk;
        if (!ask) {
            body.removeClass('rl-search-loading');
            body.addClass('rl-search-error');
            body.setText('当前阅读器不支持 AI 提问');
            return;
        }
        // 选段以「解读选段」框当前内容为准（用户可能改过），空则回退打开卡片时锁存的选段
        const text = this.searchQueryEl?.value.trim() || this.searchCardText;
        const token = ++this.searchRunToken;
        body.addClass('rl-search-loading');
        body.setText('提问中…');
        let answer: string | null = null;
        try {
            answer = await ask(text, q);
        } catch {
            answer = null; // 宿主已弹 Notice（Key/网络/超时），这里只负责卡片状态
        }
        if (token !== this.searchRunToken || card.hasClass('hidden')) return; // 已改词/已关闭 → 丢弃
        body.removeClass('rl-search-loading');
        body.empty();
        if (answer) {
            body.setText(answer);
        } else {
            body.addClass('rl-search-error');
            body.setText('提问失败');
        }
    }

    /** 复制 AI 答案到剪贴板 */
    protected async copySearchAnswer(): Promise<void> {
        const el = this.searchBodyEl;
        const text = el?.getText().trim() ?? '';
        if (!el || !text || el.hasClass('rl-search-loading')) {
            new Notice('还没有可复制的答案', 2500);
            return;
        }
        try {
            if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
            await navigator.clipboard.writeText(text);
            new Notice('已复制', 2000);
        } catch {
            new Notice('复制失败，请手动选中复制', 3000);
        }
    }

    /** 收起搜索卡（✕ / Esc / 点正文其他区域 / 切章与重排）；不中断进行中的请求（结果到达时若已隐藏则丢弃） */
    protected hideSearchCard(): void {
        this.searchCard?.addClass('hidden');
        this.searchBodyEl?.removeClass('rl-search-loading');
    }

    /** 搜索卡是否打开（Esc 分派用：打开时只收卡片，不关整个阅读器） */
    protected isSearchCardOpen(): boolean {
        return Boolean(this.searchCard && !this.searchCard.hasClass('hidden'));
    }

    // ── 快捷搜索「二选一」浮层（用户 2026-09-17 二次裁定：顶栏搜索改模式开关）──
    // 拖选文字后先弹「网络搜索 / AI 搜索」，用户选了才真正搜（避免误触直接发 AI 请求）。

    // ── 「网络搜索」浮层（用户 2026-09-18：搜索拆成网络 / AI 两个独立入口，原「二选一」那一跳取消）──
    // 拖选文字 / 点动作条按钮 → 直接弹引擎浮层：24 个引擎按 5 类分组、**文字 chip**
    // （内置图标集没有各家品牌 logo，24 个纯图标分辨不出来），点引擎即开系统浏览器。
    // 🔴 **不清浏览器选区**：用户要求「选中保持高亮」—— 要看得见自己在搜哪一段；浮层按钮
    //    mousedown 同时 stopPropagation（防 document 收浮层）与 preventDefault（防焦点转移让选区消失）。

    /** 显示「网络搜索」浮层（text = 锁存的选中文字；anchor = 宿主 client 坐标，null 退容器中部） */
    protected showNetPanel(text: string, anchor: { x: number; y: number } | null): void {
        const panel = this.buildNetPanel();
        const parent = this.selbarParent;
        if (!panel || !parent) return;
        this.netQueryText = text;
        this.netQuoteEl?.setText(text ? `用选中文字：${text}` : '未选中文字 —— 先选中正文再点引擎');
        panel.classList.remove('hidden');
        requestAnimationFrame(() => {
            const pRect = parent.getBoundingClientRect();
            const bRect = panel.getBoundingClientRect();
            const evX = anchor ? anchor.x - pRect.left : pRect.width / 2;
            const evY = anchor ? anchor.y - pRect.top : pRect.height / 3;
            const gap = 8;
            const left = Math.min(Math.max(evX - bRect.width / 2, 4), Math.max(4, pRect.width - bRect.width - 4));
            let top = evY - bRect.height - gap;
            if (top < 4) top = evY + gap;
            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(Math.min(top, pRect.height - bRect.height - 4))}px`;
        });
    }

    /** 构建「网络搜索」浮层（挂 selbarParent；标题 + 选中文字预览 + 5 类分组文字 chip，超高内部滚动） */
    protected buildNetPanel(): HTMLDivElement | null {
        const parent = this.selbarParent;
        if (!parent) return null;
        if (this.netPanelEl) return this.netPanelEl;
        const panel = parent.createDiv({ cls: 'rl-search-net hidden' });
        const head = panel.createDiv({ cls: 'rl-search-net-head' });
        head.createSpan({ cls: 'rl-search-net-title', text: '网络搜索' });
        const close = head.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-net-close', attr: { 'data-tip': '关闭' }, text: '✕' });
        close.addEventListener('mousedown', (ev) => ev.stopPropagation());
        close.addEventListener('click', () => this.hideNetPanel());
        this.netQuoteEl = panel.createDiv({ cls: 'rl-search-net-quote' });
        const list = panel.createDiv({ cls: 'rl-search-net-list' });
        // 分组与顺序的唯一真源 = pure/readerSearch.SEARCH_ENGINE_GROUPS（组序 + 组内序即 UI 顺序）
        // 用户 2026-09-19 追加：图标**竖排** —— 每个分组自成**一列**（标题在上、图标往下排），5 组横向并排
        for (const g of SEARCH_ENGINE_GROUPS) {
            const col = list.createDiv({ cls: 'rl-search-net-col' });
            col.createDiv({ cls: 'rl-search-net-group', text: g.label });
            const row = col.createDiv({ cls: 'rl-search-net-row' });
            for (const eng of g.engines) {
                // 用户 2026-09-19：chip 改**纯图标**（品牌官方色）+ 悬停提示 —— 引擎名不再直接显示，走 data-tip
                const b = row.createEl('button', { cls: 'rl-btn rl-reader-btn rl-search-net-engine', attr: { type: 'button', 'data-tip': eng.label } });
                // 读屏名走隐藏文本（UI-GUIDE §3：纯图标按钮不挂 aria-label，否则与 data-tip 气泡叠成两层）
                b.createSpan({ cls: 'rl-sr', text: eng.label });
                setSearchEngineIcon(b, eng.id);
                b.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
                b.addEventListener('click', () => {
                    const q = this.netQueryText; // hideNetPanel 会清空锁存文本 → 先取
                    this.hideNetPanel();
                    this.openEngineSearch(eng.id, q);
                });
            }
        }
        panel.addEventListener('mousedown', (ev) => ev.stopPropagation());
        this.netPanelEl = panel;
        return panel;
    }

    /** 收起「网络搜索」浮层（点正文其他区域 / Esc / 切章 / 选取引擎后） */
    protected hideNetPanel(): void {
        this.netPanelEl?.addClass('hidden');
        this.netQueryText = '';
    }

    /** 浮层是否打开（Esc 分派用） */
    protected isNetPanelOpen(): boolean {
        return Boolean(this.netPanelEl && !this.netPanelEl.hasClass('hidden'));
    }

    // ── 顶栏快捷「标注模式锁」 ──

    /** 点快捷按钮：切换对应标注模式激活态（激活→再点取消；点另一钮切过去） */
    protected toggleAnnotate(kind: ReaderQuickMode): void {
        this.setAnnotate(this.annotateMode === kind ? null : kind);
    }

    /** 设置激活标注模式（null=全部退出），同步按钮 .rl-quick-active；进入高亮模式提示一次 */
    protected setAnnotate(kind: ReaderQuickMode | null): void {
        this.annotateMode = kind;
        (Object.keys(this.quickBtns) as ReaderQuickMode[]).forEach((k) => {
            this.quickBtns[k]?.toggleClass('rl-quick-active', k === kind);
        });
        if (kind === 'highlighter') new Notice('高亮模式：拖选文字即高亮（再点该按钮退出）');
        else if (kind === 'quote') new Notice('摘抄模式：拖选文字即加摘抄（再点该按钮退出）');
        else if (kind === 'languages') new Notice('翻译模式：拖选文字即翻译（再点该按钮退出）');
        else if (kind === 'bookmark') new Notice('书签模式：单击正文存书签（再点该按钮退出）');
        else if (kind === 'netsearch') new Notice('网络搜索模式：拖选文字后选搜索引擎（再点该按钮退出）');
        else if (kind === 'aisearch') new Notice('AI 搜索模式：拖选文字后由 AI 作答（再点该按钮退出）');
    }

    /** 清除激活标注模式（切章/关面板时调用，防残留） */
    protected resetAnnotate(): void {
        if (this.annotateMode) this.setAnnotate(null);
        this.hideNetPanel();
    }

    /**
     * 激活左侧 pane（目录/书签/摘抄）：展开目录列（取消 collapsed），
     * 同步侧栏三 tab 与头部三键的 active 态，并互斥显隐三个 pane。
     * 供头部三键与侧栏 tab 共用；T 键仍为整体折叠/展开（toggleToc）。
     */
    protected activatePane(pane: 'toc' | 'ex', expand = true): void {
        // 与 toggleToc 折叠态互斥：激活 pane 即展开目录列；首次挂载传 expand=false（保持「打开即收起」）
        if (expand) {
            this.tocEl.toggleClass('collapsed', false);
            this.tocCollapsed = false;
        }
        // pane 顺序（toc/ex）与创建顺序一致：侧栏 tab、pane 容器均按下标对应
        // （书签并入标注 pane 后只剩两页，用户 2026-09-17）
        const order: ReadonlyArray<'toc' | 'ex'> = ['toc', 'ex'];
        const idx = order.indexOf(pane);
        if (idx < 0) return;
        this.tocEl.querySelectorAll('.rl-reader-toc-tab').forEach((el, i) => el.toggleClass('active', i === idx));
        this.tocEl.querySelectorAll('.rl-reader-toc-pane').forEach((el, i) => el.toggleClass('hidden', i !== idx));
        // pane 由 display:none 恢复显示时 ROS 未必回调 ⇒ 补一枪，否则首次切页签没有渐隐提示
        // 🔴 补的对象必须是挂过渐隐的容器（目录页是 tocListEl，标注页是 pane 本身；见 buildSidebar 的 attachScrollFades）
        resyncScrollFade(
            pane === 'toc'
                ? this.tocListEl
                : this.tocEl.querySelectorAll<HTMLElement>('.rl-reader-toc-pane')[idx],
        );
    }

    /** 删除成功后从摘抄列表移除该项并重绘 */
    protected removeExcerptItem(blockId: string): void {
        this.options.excerpts = (this.options.excerpts ?? []).filter((x) => x.id !== blockId);
        this.buildExcerptToc();
    }

    /** 摘抄列表整体刷新（main 层摘抄写入成功后重读笔记注入；重绘摘抄 pane） */
    refreshExcerpts(excerpts: ParsedExcerpt[]): void {
        this.options.excerpts = excerpts;
        this.buildExcerptToc();
    }

    /**
     * 笔记内链接进场（M1 双向溯源）：在已注入的高亮/摘抄/书签里按块 id 找目标 → 走既有跳转通道
     * （它们各自负责切章 + 恢复比例 + quote 定位）。找不到 → 提示一次；一次性消费，切章不会重复触发。
     */
    protected consumePendingTarget(): void {
        const id = this.options.pendingTargetId;
        if (!id) return;
        this.options.pendingTargetId = undefined;
        const hl = this.highlightList.find((h) => h.id === id);
        if (hl) {
            this.jumpHighlight(hl);
            return;
        }
        const ex = (this.options.excerpts ?? []).find((x) => x.id === id);
        if (ex) {
            this.jumpExcerpt(ex);
            return;
        }
        const bm = this.bookmarks().find((b) => b.id === id);
        if (bm) {
            this.jumpBookmark(bm);
            return;
        }
        new Notice('笔记里的这个定位已找不到（可能已被删除）');
    }

    // ── 书签 ──

    /** 本会话书签数据源（面板内存态；宿主经 options.bookmarks 注入，变更走 onBookmarksChange 落盘） */
    protected bookmarks(): ReaderBookmark[] {
        return this.options.bookmarks ?? [];
    }

    /** 删除书签（右键单删）：🔴 **必须先二次确认**（用户 2026-09-20：「右键单击任一条书签会直接删除，给我弹二次确认删除」）。
     *  确认走与「删除所选」同一个通道 `onConfirmClear`（口径一致，⛔ 不各写一套）；用户取消 → 什么都不做。 */
    protected async removeBookmarkItem(id: string): Promise<void> {
        const msg = '确定删除这条书签吗？（只移除这条书签，不影响阅读进度与摘抄）';
        const ok = this.options.onConfirmClear ? await this.options.onConfirmClear(msg) : confirm(msg);
        if (!ok) return;
        const remaining = this.bookmarks().filter((b) => b.id !== id);
        this.options.bookmarks = remaining;
        this.options.onBookmarksChange?.(remaining);
        this.buildBookmarkToc();
        new Notice('已删除书签');
    }

    /** 书签列表整体刷新（宿主读盘/新增落盘后注入最新数据；重绘书签 pane） */
    refreshBookmarks(list: ReaderBookmark[]): void {
        this.options.bookmarks = list;
        this.buildBookmarkToc();
    }

    /** 翻章延后到宏任务：滚动事件高频触发时避免同步重建 iframe srcdoc 阻塞滚动 */
    protected scheduleChapterSwitch(i: number): void {
        if (this.switchTimer !== null) window.clearTimeout(this.switchTimer);
        this.switchTimer = window.setTimeout(() => {
            this.switchTimer = null;
            this.switchChapter(i);
        }, 0);
    }

    /** 滚动保存节流（300ms trailing） */
    protected scheduleSave(ratio: number): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            this.options.onSaveProgress({ chapterIndex: this.chapterIndex, scrollRatio: ratio });
        }, SAVE_THROTTLE);
    }

    /**
     * 更新底部工具条：分页器数字 + 进度条填充宽度（口径见 pure/readerFooter，TXT/EPUB/PDF 共用）。
     * 数字恒为「已读 全书%」、填充取全书进度；页码与章内% 只走悬停提示。
     * 旧实现翻页分支自行显示页码 + 章内% 填充 → 与滚动模式同一位置读数对不上（用户 2026-09-17 报障）。
     */
    protected updateProgress(): void {
        const ratio = this.currentRatio();
        const r = footerReadout({
            paged: this.isPaged(),
            page: this.pageIndex,
            totalPages: this.totalPages,
            chapPct: Math.round(ratio * 100),
            overallPct: estimatePercent(this.chapterSizes(), this.chapterIndex, ratio),
        });
        this.footerFpctEl?.setText(r.text);
        this.footerFpctEl?.setAttribute('data-tip', r.tip);
        this.footerFillEl?.style.setProperty('width', `${r.fillPct}%`);
    }

    // ── 字号 / 行距 / 布局 ──

    /** 菜单滑条（range）：拖动实时预览（input 事件按帧合并——字号/行距每次变化都要重排正文，逐事件应用会卡）、
     *  松手落库（change，拖拽过程不写盘）；键盘 ←/→ 由 range 原生支持。 */
    protected buildSlider(
        row: HTMLElement,
        opts: { min: number; max: number; step: number; tip: string; onInput: (v: number) => void; onChange: (v: number) => void },
    ): HTMLInputElement {
        const slider = row.createEl('input', {
            cls: 'rl-reader-menu-slider',
            attr: { type: 'range', min: String(opts.min), max: String(opts.max), step: String(opts.step), 'data-tip': opts.tip },
        });
        let pending: number | null = null;
        let raf = 0;
        const flush = (): void => {
            raf = 0;
            if (pending === null) return;
            const v = pending;
            pending = null;
            opts.onInput(v);
        };
        slider.addEventListener('input', () => {
            pending = Number(slider.value);
            if (!raf) raf = requestAnimationFrame(flush);
        });
        slider.addEventListener('change', () => opts.onChange(Number(slider.value)));
        return slider;
    }

    // ── 设置面板的分组 / 行 / 分段控制器（#351，与 TXT 阅读器同款，选项真源都在 pure/readerTypography）──

    /** 分组标题行（「▼ 显示」）：点击折叠整组；三角只旋转不换字符（两种字形宽度不同会让标题抖） */
    /**
     * 面板分组（#351）：标题 + 内容块。
     * 🔴 #351b 用户口径「**删除收起展示功能**」⇒ 分组**常显、不可折叠**：
     *    标题从 `<button>` 改成 `<div>` —— 一是折叠点击本就要撤，二是 `<button>` 会被 Obsidian 核心
     *    `button:not(.clickable-icon)`（0,1,1）压成**整行灰底 + 内阴影**，那正是用户说的「厚重感」（§3 的老坑）。
     */
    protected buildMenuSection(menu: HTMLElement, title: string): HTMLElement {
        menu.createDiv({ cls: 'rl-reader-menu-sec', text: title });
        return menu.createDiv({ cls: 'rl-reader-menu-group' });
    }

    /** 面板一行：左标签 + 右控件槽 */
    protected buildMenuRow(parent: HTMLElement, label: string): HTMLElement {
        const row = parent.createDiv({ cls: 'rl-reader-menu-row' });
        row.createSpan({ cls: 'rl-reader-menu-label', text: label });
        return row;
    }

    /** 分段控制器（#351）：胶囊容器 + 若干段，`data-val` 存取值；亮起态交给 syncSegItems */
    protected buildSeg<T>(row: HTMLElement, options: readonly SegOption<T>[], current: T, onPick: (v: T) => void): HTMLElement {
        // 🔴 `rl-seg-text` = **纯字变色切换**（#351b 用户口径：大胶囊太重 ⇒ 去掉容器底与描边，只留字色变化）
        const seg = row.createDiv({ cls: 'rl-seg rl-seg-text' });
        for (const o of options) {
            const b = seg.createEl('button', {
                cls: 'rl-seg-item',
                text: o.label,
                attr: { type: 'button', 'data-val': String(o.value) },
            });
            if (o.tip) b.setAttribute('data-tip', o.tip);
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', () => onPick(o.value));
        }
        this.syncSegItems(seg, String(current));
        return seg;
    }

    /** 同步分段控制器亮起态（按 `data-val` 比对）—— 三组分段共用这一个同步函数 */
    protected syncSegItems(seg: HTMLElement | null, current: string): void {
        if (!seg) return;
        for (const el of Array.from(seg.children)) {
            (el as HTMLElement).toggleClass('is-on', (el as HTMLElement).getAttribute('data-val') === current);
        }
    }

    /** 目录列折叠切换 */
    protected toggleToc(): void {
        this.tocCollapsed = !this.tocCollapsed;
        this.tocEl.toggleClass('collapsed', this.tocCollapsed);
        this.syncSidebarToggle();
    }

    /** 同步侧栏折叠开关图标与标题（随 tocCollapsed：展开→panel-left-close/收起目录；折叠→panel-left-open/展开目录） */
    protected syncSidebarToggle(): void {
        if (!this.sidebarToggleEl) return;
        if (this.tocCollapsed) {
            safeSetIcon(this.sidebarToggleEl, 'panel-left-open');
            this.sidebarToggleEl.setAttribute('data-tip', '展开目录');
        } else {
            safeSetIcon(this.sidebarToggleEl, 'panel-left-close');
            this.sidebarToggleEl.setAttribute('data-tip', '收起目录');
        }
    }
}

const SAVE_THROTTLE = 300;

function setSearchEngineIcon(host: HTMLElement, id: SearchEngineId): void {
    const box = host.createSpan({ cls: 'rl-search-net-icon' });
    const icon = SEARCH_ENGINE_ICONS[id];
    if (icon.kind === 'builtin') {
        safeSetIcon(box, icon.id);
        return;
    }
    box.style.setProperty('--rl-eng-c', icon.hex);
    if (icon.hexDark) box.style.setProperty('--rl-eng-c-dark', icon.hexDark);
    const svg = box.createSvg('svg', { cls: 'rl-eng-brand', attr: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' } });
    svg.createSvg('path', { attr: { d: icon.path } });
}

function truncateQuote(s: string, n = 18): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > n ? flat.slice(0, n) + '…' : flat;
}
