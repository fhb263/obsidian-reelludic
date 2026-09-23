// TTS 语音朗读服务（#340 建立；#344 起把「发声」交给可替换的**引擎**）。
//
// 🔴 四条硬约束：
//   ⑴ **绝不污染用户数据** —— 高亮只是正文里的临时 `<span class="rl-tts-cur">`，
//      不写笔记、不写阅读存档 JSON、不碰 `pure/highlight` 的用户高亮体系；停止/切章一律清干净。
//   ⑵ **每句定位前先清上一句高亮并 `normalize()`** —— 包裹 span 会把文本节点拆开，
//      不清就直接用旧偏移定位，第二句起必然打歪（这是本实现最容易踩的坑）。
//   ⑶ 不支持语音时**静默降级**（按钮置灰），不抛异常、不弹 Notice 刷屏。
//   ⑷ **改语速 / 换音色走 `restart()` 而不是 `stop()`**（#341 用户指令）—— 按钮保持常亮，
//      并用 `gen` 代数守卫挡掉被 cancel 的旧句子回调（否则会串音）。
//   ⑸（#344）**换音源同样走 `restart()` 口径** —— 从当前句用新引擎续读，位置与按钮态都不丢。
//
// 本类只负责**流程**：切句 / 队列 / 逐句高亮 / 居中滚动 / 按钮态 / 起读点 / 预取调度。
// 发声细节全在 `SpeechEngine`（系统语音 / 云合成），换音源不影响上面任何一条。

import {
    blockStartAt,
    clampTtsPitch,
    clampTtsRate,
    locateSpan,
    splitSentenceSpans,
    startIndexAt,
    TTS_PITCH_DEFAULT,
    TTS_RATE_DEFAULT,
    TTS_VOLUME_DEFAULT,
    clampTtsVolume,
    VOICE_PREVIEW_TEXT,
    type TtsEngineKind,
    type TtsVoiceLite,
} from 'pure/tts';
import type { SpeechEngine, SpeechOpts } from 'services/SpeechEngine';
import { prefetchIndex } from 'pure/ttsCloud';

/** 临时高亮类名（灰色，随主题；样式在 styles.css） */
export const TTS_CUR_CLS = 'rl-tts-cur';

/** 宿主把「正文在哪 / 怎么滚」交给服务（TXT 与 EPUB 各实现一份） */
export interface TtsHost {
    /** 正文纯文本（当前章；用于切句） */
    text(): string;
    /** 正文根元素（TXT: `.rl-reader-text`；EPUB: iframe 内的 body） */
    root(): HTMLElement | null;
    /** 滚动容器（与 `root()` 同一坐标系；EPUB 传 iframe 内的滚动元素） */
    scroller(): HTMLElement | null;
    /** 朗读状态变化（供按钮同步亮起态） */
    onState?(speaking: boolean): void;
}

export interface TtsServiceOpts {
    /** 两个音源各一个引擎；不可用的给 null（系统语音在移动端没有；云音源未配 Key 时也别建） */
    engines: Partial<Record<TtsEngineKind, SpeechEngine>>;
    /** 初始音源（真源是 localStorage 的 `rl-tts-engine`） */
    engine?: TtsEngineKind;
    rate?: number;
    pitch?: number;
    /** 初始音色（🔴 按音源各传各的：系统给 voiceURI、云给音色全称，绝不混用） */
    voice?: string | null;
    /** 初始音量（#351；播放侧增益，音源无关） */
    volume?: number;
}

export class TtsService {
    private queue: { start: number; end: number; text: string }[] = [];
    private at = 0;
    private speaking = false;
    /** 暂停中（#351 空格）：`speaking` 仍为 true —— 按钮**保持常亮**，只是声音停住 */
    private paused = false;
    private rate = TTS_RATE_DEFAULT;
    private pitch = TTS_PITCH_DEFAULT;
    private volume = TTS_VOLUME_DEFAULT;
    private voiceUri: string | null = null;
    private kind: TtsEngineKind;
    /**
     * 代数（#341）：`start` / `stop` / `restart` 各自增 1；一句的回调闭包捕获当时的值，
     * 回来对不上就直接作废。**没有它就会串音** —— `cancel()` 会**异步**回调旧句子的 `onend`，
     * 而那时 `speaking` 已被新流程重新置为 true，旧回调便会再 `at += 1` 多排一句。
     */
    private gen = 0;
    /** 本次朗读里**已发起预取**的句下标（云侧按字符计费 ⇒ 同句绝不重复请求） */
    private prefetched = new Set<number>();
    /**
     * 用户**点击段落**指定的起读点（章内字符偏移；#355）。`null` = 没点过 ⇒ 走视口口径。
     * 🔴 与「视口首个可见段落」是**两个来源、一个出口**（`startOffset()`）：点过就以点为优先 ——
     *    用户在文中部点了一下，接着按朗读却回到视口顶部那段，正是这次要修掉的行为。
     * ⚠️ 章内偏移**只在当前章有效**：换章必须 `resetAnchor()`（否则新章会从一个错位置读起）。
     */
    private anchor: number | null = null;
    /** 下一次高亮滚动是否走**平滑**（点击换起读点用；逐句推进仍用瞬移，避免动画追不上朗读） */
    private smoothOnce = false;

    constructor(private host: TtsHost, private opts: TtsServiceOpts) {
        this.rate = clampTtsRate(opts.rate ?? TTS_RATE_DEFAULT);
        this.pitch = clampTtsPitch(opts.pitch ?? TTS_PITCH_DEFAULT);
        this.volume = clampTtsVolume(opts.volume ?? TTS_VOLUME_DEFAULT);
        this.voiceUri = opts.voice ?? null;
        this.kind = opts.engine === 'cloud' ? 'cloud' : 'system';
    }

    get engineKind(): TtsEngineKind {
        return this.kind;
    }

    /** 当前音源是否可用（供按钮置灰判断：系统语音在移动端没有；云音源没配 Key 也不能点） */
    available(): boolean {
        return !!this.engine()?.available();
    }

    get isSpeaking(): boolean {
        return this.speaking;
    }

    /** 是否处于「暂停中」（朗读仍算开着 —— 按钮常亮，空格再按一次续读） */
    get isPaused(): boolean {
        return this.paused;
    }

    get currentVolume(): number {
        return this.volume;
    }

    get currentRate(): number {
        return this.rate;
    }

    get currentPitch(): number {
        return this.pitch;
    }

    get currentVoiceUri(): string | null {
        return this.voiceUri;
    }

    /** 当前音源的音色列表（系统语音走它；云音色的清单在 `pure/ttsCloud` 固定表里，恒空） */
    voices(): TtsVoiceLite[] {
        return this.engine()?.voices() ?? [];
    }

    /**
     * 切换音源。旧引擎**立刻收声**，正在朗读时**从当前句用新引擎续读** ——
     * 按钮与高亮全程不动（与 #341 的 restart 同口径，用户裁定「弹窗里也能切」）。
     * 目标引擎不可用（未配 Key / 移动端无系统语音）→ 不切并返回 false（调用方负责说明原因）。
     */
    setEngineKind(kind: TtsEngineKind): boolean {
        if (kind === this.kind) return true;
        if (!this.opts.engines[kind]?.available()) return false;
        this.engine()?.cancel();
        this.kind = kind;
        if (this.speaking) this.restart();
        return true;
    }

    /** 开始 / 停止切换；返回切换后的状态 */
    toggle(): boolean {
        if (this.speaking) this.stop();
        else void this.start();
        return this.speaking;
    }

    /**
     * 暂停 / 继续（#351「空格」；与 `toggle()` 的**开 / 关**语义刻意分开）：
     *  - 暂停**不 `stop()`** —— 高亮与按钮都留着（用户按空格是想「先听这儿」，不是想收摊）；
     *  - 恢复后从**当前这句的中断处**续读（引擎原生 pause/resume），不会回到句首。
     * 未在朗读 / 状态不符 → 静默无操作（键盘可能连按）。
     */
    pause(): void {
        if (!this.speaking || this.paused) return;
        this.paused = true;
        this.engine()?.pause();
    }

    /** 继续（暂停中才有效） */
    resume(): void {
        if (!this.speaking || !this.paused) return;
        this.paused = false;
        this.engine()?.resume();
    }

    private start(): void {
        if (!this.available()) return;
        const text = this.host.text();
        const spans = splitSentenceSpans(text);
        if (!spans.length) return;
        this.clearHighlight();
        this.queue = spans;
        // #342（用户指令）：从**当前段落**读起，而不是每次从头读整章
        this.at = startIndexAt(spans, this.startOffset());
        this.speaking = true;
        this.paused = false;
        this.gen += 1;
        this.prefetched.clear();
        this.host.onState?.(true);
        this.speakAt();
    }

    /**
     * 「当前段落」在**章节文本**里的起点偏移（→ `startIndexAt` 换成句子下标）。
     *
     * 🔴 **两个来源、一个出口**：
     *   ⑴ 用户**点过的段落**（`#355` 的 `anchorAt`，见 `anchor` 字段）——**优先**；
     *   ⑵ 没点过 ⇒ 视口口径：先找出**第一处仍可见的文本节点**（底边在视口顶边之下），再向上取到
     *      root 的直接子元素 —— 那就是一个段落；最后用 `Range`（root 起点 → 该段落起点）量出偏移。
     * 🔴 两种口径与 `locateSpan` 的量法**必须同口径**（只数文本、不数标签与 `<br>`），
     *   否则起读点会与高亮定位错开。点选那条走纯逻辑 `blockStartAt`（块长度累加），与 Range 同结果。
     * ⚠️ 章节标题不在 root（`.rl-reader-text` / iframe body）里 ⇒ 天然不会被当成「当前段落」。
     * 找不到（空章 / 视口高度为 0）→ 0，退回从头读（至少不会崩、也不会跳错位置）。
     */
    private startOffset(): number {
        if (this.anchor !== null) return this.anchor;
        const root = this.host.root();
        const sc = this.host.scroller();
        if (!root || !sc) return 0;
        const scRect = sc.getBoundingClientRect();
        if (!scRect.height) return 0;
        const doc = root.ownerDocument;
        const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let hit: Text | null = null;
        let n = walker.nextNode();
        while (n) {
            const t = n as Text;
            if (t.data.trim()) {
                const r = doc.createRange();
                r.selectNodeContents(t);
                const rect = r.getBoundingClientRect();
                if (rect.height > 0 && rect.bottom > scRect.top + 2) {
                    hit = t;
                    break;
                }
            }
            n = walker.nextNode();
        }
        if (!hit) return 0;
        let block: Node = hit;
        while (block.parentNode && block.parentNode !== root) block = block.parentNode;
        if (block === root) return 0;
        const head = doc.createRange();
        try {
            head.setStart(root, 0);
            head.setEndBefore(block);
        } catch {
            return 0; // 结构异常（理论上不会）→ 退回从头
        }
        return head.toString().length;
    }

    private engine(): SpeechEngine | null {
        return this.opts.engines[this.kind] ?? null;
    }

    /**
     * #355：把**正文里被点击到的节点**换算成章节文本偏移（供 `anchorAt` 用）。
     *
     * 做法：向上取到 root 的**直接子块**（段落）→ 数出它在兄弟节点里的下标 → 交给纯逻辑
     * `blockStartAt` 累加前序各块的文本长度。⛔ 与 `startOffset()` 的视口口径同结果（见其注释）。
     *
     * 返回 `null` = 「这次点击不算点段落」，调用方**什么都不做**：
     *   ㈠ 节点不在正文内（点了目录 / 顶栏 / 动作条）；㈡ 点到 root 自身 —— 正文段间的空白属于
     *   root 而不是某个段落，拿它当起读点会把整章读成「从上一段末尾开始」。
     */
    clickOffset(node: Node | null): number | null {
        const root = this.host.root();
        if (!root || !node || !root.contains(node) || node === root) return null;
        let block: Node = node;
        while (block.parentNode && block.parentNode !== root) block = block.parentNode;
        if (block === root || !block.parentNode) return null;
        // 🔴 空白文本节点也要计入（与 Range / locateSpan 同口径），故取**全部子节点**而非只取元素
        // ⚠️ 显式 `Array.from<Node>`：默认推断出 `ChildNode[]`，而 `block` 是 `Node` ⇒ indexOf 过不了类型
        const kids = Array.from<Node>(root.childNodes);
        const idx = kids.indexOf(block);
        if (idx < 0) return null;
        return blockStartAt(kids.map((k) => (k.textContent ?? '').length), idx);
    }

    /**
     * #355（用户指令）：**点击正文段落 = 重设朗读起读点**，粒度从「章节」细化到「段落」。
     *  - 未在朗读：只把锚点记下 ⇒ 之后点「朗读」从这一段读起（而不是回到视口顶部那一段）；
     *  - 正在朗读：**立刻从这一段读起**（打断当前句），高亮随之**平滑跳转**到新段落。
     * 锚点只是界面态（不落库、不写存档、不碰用户高亮），换章由宿主调 `resetAnchor()` 作废。
     */
    anchorAt(node: Node | null): void {
        const off = this.clickOffset(node);
        if (off === null) return;
        this.anchor = off;
        if (this.speaking) this.restart(off, true);
    }

    /**
     * 作废点击锚点（换章 / 正文整章重排后由宿主调用）。
     * 🔴 必须的：锚点是**章内**偏移，换章后那个数字指向的是另一段文字 ⇒ 不清理会让新章从错位置读起。
     */
    resetAnchor(): void {
        this.anchor = null;
    }

    private speechOpts(): SpeechOpts {
        return { rate: this.rate, pitch: this.pitch, volume: this.volume, voice: this.voiceUri };
    }

    private speakAt(): void {
        const cur = this.queue[this.at];
        const engine = this.engine();
        if (!cur || !engine) {
            this.finish();
            return;
        }
        this.highlightSpan(cur.start, cur.end);
        const gen = this.gen;
        void engine.speak(cur.text, this.speechOpts()).then((res) => {
            // 已被 stop() / restart() / 换源作废的句子：一律不许再排队
            if (gen !== this.gen || !this.speaking) return;
            if (res === 'cancelled') return; // 调用方（stop / restart）已自行收尾
            if (res === 'failed') {
                // 引擎已弹过原因 ⇒ 这里只负责收尾（用户 #344 裁定：云失败只提示并停止）
                this.finish();
                return;
            }
            this.at += 1;
            if (this.at < this.queue.length) this.speakAt();
            else this.finish();
        });
        this.prefetchNext(engine);
    }

    /**
     * 预取下一句（#344）：云合成每句要一次网络往返，不预取就会每句之间空 0.5–2 秒。
     * 🔴 系统引擎没有 `prefetch` ⇒ 自动跳过；
     * 🔴 「末句 / 越界 / 已在合成中」的判断全在纯逻辑 `prefetchIndex` 里（可单测），本方法只执行 ——
     *    云侧按字符计费，重复请求就是重复花钱。
     */
    private prefetchNext(engine: SpeechEngine): void {
        if (!engine.prefetch) return;
        const next = prefetchIndex(this.at, this.queue.length, [...this.prefetched]);
        if (next < 0) return;
        const span = this.queue[next];
        if (!span) return;
        this.prefetched.add(next);
        engine.prefetch(span.text, this.speechOpts());
    }

    /** 停止：cancel + 清高亮 + 通知按钮（🔴 三者缺一都会留下残影或按钮状态泄漏） */
    stop(): void {
        this.engine()?.cancel();
        this.gen += 1;
        this.speaking = false;
        this.paused = false;
        this.queue = [];
        this.at = 0;
        this.prefetched.clear();
        this.clearHighlight();
        this.host.onState?.(false);
    }

    private finish(): void {
        this.speaking = false;
        this.paused = false;
        this.prefetched.clear();
        this.clearHighlight();
        this.host.onState?.(false);
    }

    /**
     * 改语速（#341）：朗读中**就地重启当前句**让新语速立刻生效。
     * 🔴 **绝不走 `stop()`** —— `stop()` 会 `onState(false)` 把按钮通知成熄灭态（用户要求「改语速时保持朗读按钮常亮」）。
     * `restart()` 全程不动 `speaking` 与按钮状态，只有声音在句首重来。
     */
    setRate(r: number): void {
        const next = clampTtsRate(r);
        if (next === this.rate) return;
        this.rate = next;
        if (this.speaking) this.restart();
    }

    /** 换音色；`null` = 交给引擎自己挑（切音源时若该音源没有记忆值就用它） */
    setVoice(uri: string | null): void {
        if (uri === this.voiceUri) return;
        this.voiceUri = uri;
        if (this.speaking) this.restart();
    }

    /**
     * 改音调（#343 方案 A）：同语速口径 —— 朗读中**就地重读当前句**让新音调立刻生效，
     * 按钮保持常亮（走 `restart()` 而**不是** `stop()`）。
     * ⚠️ 云引擎不支持 pitch ⇒ 换了音源后这个值仍在，但云侧不会用（菜单里也不给音调行）。
     */
    setPitch(p: number): void {
        const next = clampTtsPitch(p);
        if (next === this.pitch) return;
        this.pitch = next;
        if (this.speaking) this.restart();
    }

    /**
     * 改音量（#351）：**与语速 / 音调同口径 —— 朗读中就地重读当前句**。
     * 🔴 为什么不像云引擎那样「直播放器增益」：系统语音的 `volume` 只在**发起 utterance 时**写死，
     *    没有实时通道 ⇒ 两个引擎若一个立即生效、一个下一句才生效，用户会以为「调了没反应」。
     *    统一走 `restart()` 还有一个便宜之处：云侧同一句的音频**吃缓存**（键只含 text/voice/rate），
     *    音量变化**不会重新计费**。
     * ⚠️ 暂停中调音量也会 restart（同语速口径），暂停态随之作废 —— 声音从新音量接着来，不静默。
     */
    setVolume(v: number): void {
        const next = clampTtsVolume(v);
        if (next === this.volume) return;
        this.volume = next;
        if (this.speaking) this.restart();
    }

    /**
     * 试听某个音色（#343 方案 A）：读一句固定短句，**不写高亮、不滚动、不改按钮态**。
     * 🔴 正在朗读时**先 `stop()`** —— 试听与朗读共用同一个播放通道，若只是排队，
     *   用户会「点了试听却半天没声音」（要等当前句读完）。停止行为可预测，而且**起读点 = 当前段落**，
     *   试听完再点朗读会从眼前这一段继续，不会跳回章首。
     */
    previewVoice(uri: string): void {
        const engine = this.engine();
        if (!engine?.available()) return;
        if (this.speaking) this.stop();
        engine.preview(VOICE_PREVIEW_TEXT, { rate: this.rate, pitch: this.pitch, volume: this.volume, voice: uri });
    }

    /**
     * 就地重启当前句：作废在飞的句子（`gen += 1`）→ cancel → 重排当前句。
     * 🔴 作废是必须的：`cancel()` 会**异步**回调旧句子的 `onend`，若不拦，它会再 `at += 1` 排下一句 ⇒ 串音。
     * 🔴 不清高亮也不通知 `onState`：当前句本来就亮着，重排后同一句仍是高亮 ⇒ 观感上「什么都没闪」。
     * @param offset 给定则**改排到该章内偏移所在的句子**（#355 点击换起读点）；省略 = 原地重读当前句
     * @param smooth 这一次高亮滚动是否走平滑（点击跳段用；默认瞬移）
     */
    private restart(offset?: number, smooth = false): void {
        if (!this.available()) return;
        if (offset !== undefined) {
            // 队列为空（空章）时 startIndexAt 返回 0，后续 speakAt 自会 finish()，不会崩
            this.at = startIndexAt(this.queue, offset);
        }
        this.gen += 1;
        this.paused = false; // 重读当前句 = 声音重新开始 ⇒ 暂停态自然作废（否则会「在响却标着暂停」）
        this.engine()?.cancel();
        this.prefetched.clear(); // 语速 / 音色变了 ⇒ 缓存键变了，旧预取不再有意义
        this.smoothOnce = smooth;
        this.speakAt();
    }

    /** 切章 / 关闭前调用：必须停，否则新章里会继续读旧章的队列并往旧节点写高亮 */
    destroy(): void {
        this.stop();
        for (const e of Object.values(this.opts.engines)) e?.dispose();
    }

    // ── 高亮与滚动 ──

    /** 清掉所有临时高亮（把 span 的子节点放回原处并删掉 span，再 normalize 合并文本节点） */
    private clearHighlight(): void {
        const root = this.host.root();
        if (!root) return;
        const marks = Array.from(root.querySelectorAll(`.${TTS_CUR_CLS}`));
        for (const m of marks) {
            const parent = m.parentNode;
            if (!parent) continue;
            while (m.firstChild) parent.insertBefore(m.firstChild, m);
            parent.removeChild(m);
        }
        if (marks.length) root.normalize();
    }

    /** 把原文 [start,end) 包成灰色高亮，并滚到居中 */
    private highlightSpan(start: number, end: number): void {
        const root = this.host.root();
        // 一次性标志就地消费（⛔ 别留在字段里：本句没找到可包节点时会漏到下一句，变成莫名平滑）
        const smooth = this.smoothOnce;
        this.smoothOnce = false;
        if (!root) return;
        this.clearHighlight(); // 🔴 见文件头第 ⑵ 条：不先清，偏移会对不上
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        const lengths: number[] = [];
        let n = walker.nextNode();
        while (n) {
            const t = n as Text;
            nodes.push(t);
            lengths.push(t.data.length);
            n = walker.nextNode();
        }
        const hits = locateSpan(lengths, start, end);
        if (!hits.length) return;
        let first: HTMLElement | null = null;
        for (const h of hits) {
            const node = nodes[h.index];
            if (!node) continue;
            const range = root.ownerDocument.createRange();
            try {
                range.setStart(node, h.from);
                range.setEnd(node, h.to);
            } catch {
                continue; // 越界（理论上已夹取）→ 跳过这一段，不影响朗读
            }
            const span = root.ownerDocument.createElement('span');
            span.className = TTS_CUR_CLS;
            try {
                range.surroundContents(span);
            } catch {
                continue; // 跨父节点（理论不会：hit 限定在单个文本节点内）
            }
            if (!first) first = span;
        }
        if (first) this.scrollTo(first, smooth);
    }

    /**
     * 当前句滚到阅读区中部（手动算 scrollTop，不用 scrollIntoView —— 后者会连带滚动祖先容器）。
     * @param smooth 平滑滚动（#355 点击跳段：高亮「平滑跳转」到新段落）。**逐句推进一律瞬移** ——
     *   每句都做动画会在朗读较快时出现「追不上的缓动」，观感比瞬移差。
     */
    private scrollTo(el: HTMLElement, smooth = false): void {
        const sc = this.host.scroller();
        if (!sc) return;
        const cRect = sc.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        if (!cRect.height) return;
        const delta = eRect.top + eRect.height / 2 - (cRect.top + cRect.height / 2);
        if (!Number.isFinite(delta)) return;
        const max = sc.scrollHeight - sc.clientHeight;
        const next = Math.max(0, Math.min(max, sc.scrollTop + delta));
        if (Math.abs(next - sc.scrollTop) <= 1) return;
        try {
            sc.scrollTo({ top: next, behavior: smooth ? 'smooth' : 'auto' });
        } catch {
            sc.scrollTop = next; // 极端环境不支持 scrollTo(options) → 退回瞬移（⛔ 不能什么都不做）
        }
    }
}
