import {
    actionLabel,
    ballTitle,
    ballTip,
    barPercent,
    clampPercent,
    endTip,
    nextMode,
    shortLabel,
    type BallMode,
    type ProgressBallEnd,
} from 'pure/progressBall';
// 提示 + 读屏名统一走组件基座（①-9：⛔ 别再手写 aria-label，会与 data-tip 叠两层气泡）
import { setTip, srLabel } from 'ui/components';

/**
 * 悬浮进度**卡片**（服务层，挂 `document.body`）。
 *
 * 🔴 用户 m01938 逐字：「悬浮进度球（用户点击了"音频转文字"后，切到了别的笔记去工作。转写需要几分钟。）」
 * 🔴 用户 m10634 逐字：「这个下载模型悬浮球怎么点一下就消失不见了，而且应该参考主流市面方案的悬浮球的进度框」
 *
 * 为什么必须挂在 `document.body` 而不是视图容器里：用户会**切走笔记**（这正是需求成立的前提），
 * 挂在 `EpisodePageView` 里，视图一卸载球就跟着没了，等于没做。
 *
 * 五条实现约束（都在代码里落实，改的时候别破）：
 *  ⑴ **单例**：卡片最多一个。新任务开始时若已有卡在跑，直接接管（旧的静默丢弃）。
 *  ⑵ **无百分比也要能显示**：转写前几分钟算不出比例，`percent: null` 时进度条走不确定态，
 *     摘要写「进行中」而不是伪造 0%（见 `pure/progressBall`）。
 *  ⑶ **点一下不再是「销毁」**：在「卡片」与「收起成小球」之间切换。m01938 当初把点击写成
 *     dismiss，是因为那时它只是 36px 装饰；一旦承担 465MB 下载这种十几分钟的任务，
 *     点一下就没了等于**把唯一的进度入口消耗掉**（这正是 m10634 报的障）。
 *  ⑷ **取消要经过确认**：真取消任务只能由卡片上的「取消」按钮发起，且要二次确认
 *     —— 反向误触会丢进度（虽然分片下载能续传，但不该靠运气）。
 *  ⑸ **一切定时器都要能被清掉**：`done/fail` 后定时自毁，任务重新开始 / 插件卸载时必须能立刻取消。
 *
 * ⚠️ 无障碍：容器带 `role="status" aria-live="polite"` 播报阶段变化。
 *    ⛔ **不要再给它加 `aria-label`** —— 它同时带了 `data-tip`（自绘气泡读的是 tooltip），
 *    两者并存会叠出双层提示（`Project-Rule/AGENTS.md` 明确禁止）。
 *    ⚠️ 卡片上的按钮各自带 `aria-label`，但它们是**按钮**、不是容器的标签，不冲突。
 */

/** 收尾后停留多久再消失（够用户看清「完成：字幕已保存」） */
const END_LINGER_MS = 2600;

/** 收起态小球的环形半径与周长（`viewBox` 36×36，`r=16` ⇒ 周长 ≈ 100.53，直接用 2πr 算，⛔ 别手抄常数） */
const RING_R = 16;
const RING_C = 2 * Math.PI * RING_R;

export interface ProgressBallHandle {
    /** 更新阶段 / 百分比 / 细节（三项都可省，省的项保持原值） */
    update(next: { label?: string; percent?: number | null; detail?: string }): void;
    /** 收尾：成功。卡片短暂显示结果后自毁 */
    done(message?: string): void;
    /** 收尾：失败 */
    fail(message?: string): void;
    /** 立刻销毁（插件卸载 / 任务被外部取消时调；⛔ 用户点击**不**走这条） */
    dismiss(): void;
}

export interface ProgressBallOptions {
    /**
     * 卡片上「取消」按钮的回调。
     *
     * ⚠️ 不传就不画取消按钮 —— 有些任务（如转写）的取消入口在别处（字幕面板上的停止按钮），
     * 卡片再放一个会造成「两处都能停，但只有一处会刷新界面状态」。
     */
    onCancel?: () => void;
}

class ProgressBallImpl implements ProgressBallHandle {
    private el: HTMLElement | null = null;
    private cardEl: HTMLElement | null = null;
    private pillEl: HTMLElement | null = null;
    private headlineEl: HTMLElement | null = null;
    private detailEl: HTMLElement | null = null;
    private barEl: HTMLElement | null = null;
    private barFillEl: HTMLElement | null = null;
    private txtEl: HTMLElement | null = null;
    /** 收起态小球**球心**的百分比（用户 m07854 ⑨）；与卡片里的 `txtEl` 同文案口径 */
    private ringPctEl: HTMLElement | null = null;
    private arcEl: SVGCircleElement | null = null;
    private cancelBtn: HTMLButtonElement | null = null;
    private minBtn: HTMLButtonElement | null = null;
    private armedCancel = false;
    private armTimer: number | null = null;
    private timer: number | null = null;
    private label = '';
    private detail = '';
    private percent: number | null = null;
    private mode: BallMode = 'card';
    private disposed = false;
    private ended = false;

    constructor(label: string, private readonly opts: ProgressBallOptions = {}) {
        this.label = label;
        this.mount();
        this.paint();
    }

    private mount(): void {
        const el = document.body.createDiv({ cls: 'rl-pball is-card' });
        this.el = el;
        // 读屏播报阶段变化；⛔ 不加 aria-label（与 data-tip 冲突，见文件头）
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');

        // ── 展开态：一张卡片（标题 / 进度条 / 细节 / 动作） ──
        const card = el.createDiv({ cls: 'rl-pball-card' });
        this.cardEl = card;
        const head = card.createDiv({ cls: 'rl-pball-head' });
        this.headlineEl = head.createSpan({ cls: 'rl-pball-title' });
        const ops = head.createDiv({ cls: 'rl-pball-ops' });
        // 收起按钮：⛔ 不是「关闭」，文案要写明任务继续（否则用户以为点掉就中止了）
        const minBtn = ops.createEl('button', { cls: 'rl-pball-btn rl-pball-min clickable-icon' });
        minBtn.setAttribute('type', 'button');
        minBtn.setText('–');
        // 🔴 2026-11-12（用户 m00353 ①-9「部分按钮 hover 双提示重叠覆盖」）：
        //    这里原来 `data-tip` + `aria-label` 都挂 ⇒ 悬停叠出**两层**气泡
        //    （插件自绘的 data-tip 气泡 + Obsidian 给 aria-label 画的官方气泡）。
        //    现在统一保 `data-tip`，读屏名走 `.rl-sr` 隐藏文本。
        //    ⚠️ 顺序不能反：`setText('–')` 会清空子节点，先写字再挂 srLabel。
        setTip(minBtn, actionLabel('minimize'));
        srLabel(minBtn, actionLabel('minimize'));
        minBtn.addEventListener('click', (ev: MouseEvent) => {
            ev.stopPropagation();
            this.setMode('pill');
        });
        this.minBtn = minBtn;
        if (this.opts.onCancel) {
            const cancel = ops.createEl('button', { cls: 'rl-pball-btn rl-pball-cancel clickable-icon' });
            cancel.setAttribute('type', 'button');
            cancel.setText('✕');
            // 🔴 同上（①-9）：只留 data-tip，读屏名走 `.rl-sr`
            setTip(cancel, actionLabel('cancel'));
            srLabel(cancel, actionLabel('cancel'));
            cancel.addEventListener('click', (ev: MouseEvent) => {
                ev.stopPropagation();
                this.requestCancel();
            });
            this.cancelBtn = cancel;
        }

        this.barEl = card.createDiv({ cls: 'rl-pball-bar' });
        this.barFillEl = (this.barEl as HTMLElement).createDiv({ cls: 'rl-pball-fill' });
        const foot = card.createDiv({ cls: 'rl-pball-foot' });
        this.detailEl = foot.createSpan({ cls: 'rl-pball-detail' });
        // 百分比单独一份：⛔ 不要和 detail 挤成一个字符串，二者更新频率不同
        this.txtEl = foot.createSpan({ cls: 'rl-pball-pct' });

        // ── 收起态：一个小球（环 + 截短阶段名） ──
        const pill = el.createDiv({ cls: 'rl-pball-pill' });
        this.pillEl = pill;
        const ring = pill.createDiv({ cls: 'rl-pball-ring' });
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 36 36');
        svg.setAttribute('class', 'rl-pball-svg');
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('class', 'rl-pball-track');
        track.setAttribute('cx', '18');
        track.setAttribute('cy', '18');
        track.setAttribute('r', String(RING_R));
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('class', 'rl-pball-arc');
        arc.setAttribute('cx', '18');
        arc.setAttribute('cy', '18');
        arc.setAttribute('r', String(RING_R));
        arc.setAttribute('stroke-dasharray', String(RING_C));
        arc.setAttribute('stroke-dashoffset', String(RING_C));
        svg.appendChild(track);
        svg.appendChild(arc);
        ring.appendChild(svg);
        this.arcEl = arc;
        /**
         * 🔴 球心百分比（用户 m07854 ⑨「球内显示百分比波动」）。
         *
         * 改前球心是**空的** —— 百分比只出现在展开卡片的 `.rl-pball-pct` 里，
         * 收起成小球之后用户只能看圆弧走了多少，估不出还剩多久。
         * 这里复用的文案口径与卡片完全一致（`pct === null ? '…' : \`${pct}%\``），
         * ⛔ 别自己再算一遍，两处显示不一致比不显示更糟。
         *
         * ⚠️ 节点必须在 svg **之后**建：环是 `place-items: center` 的 grid，
         *    svg 是 `position: absolute`（不占格），文字才是那个居中的格子。
         *    顺序反了 svg 会盖在文字上面（虽然视觉上只是描边压字，但暗色主题下很明显）。
         */
        this.ringPctEl = ring.createSpan({ cls: 'rl-pball-ringpct' });
        pill.createSpan({ cls: 'rl-pball-lbl' });

        /**
         * 点卡片本体 = 在展开 / 收起之间切换（🔴 m10634 的正面修复）。
         * ⚠️ 收尾态点一下才等于关掉（那时没东西可取消，留着只是碍事）。
         */
        el.addEventListener('click', () => this.toggle());
    }

    private setMode(mode: BallMode): void {
        this.mode = mode;
        this.paintMode();
    }

    private paintMode(): void {
        if (!this.el) return;
        this.el.toggleClass('is-card', this.mode === 'card');
        this.el.toggleClass('is-pill', this.mode === 'pill');
        // 🔴 2026-11-12（①-9）：这两处原来都是 `data-tip` + `aria-label` 双挂 ⇒ 悬停两层气泡。
        //    `setTip` 会顺手抹掉残留的 `aria-label`，状态切换时也不会「旧的那个自己留着」。
        if (this.minBtn) setTip(this.minBtn, actionLabel('minimize'));
        // ⚠️ 小球是**容器**不是按钮：它的读屏文本由可见的 `.rl-pball-lbl`（阶段名）承担，
        //    ⛔ 不再补 `.rl-sr`（否则读屏会把「展开进度」和阶段名连着念两遍）。
        if (this.pillEl) setTip(this.pillEl, actionLabel('expand'));
        // 收起态时给卡片补一句话：点回来。⛔ 不用 title（与 data-tip 重复会闪两次）
        if (this.el) this.el.setAttribute('data-tip', ballTip(this.state()));
    }

    private state(): { label: string; percent: number | null; detail?: string } {
        return { label: this.label, percent: this.percent, detail: this.detail };
    }

    private toggle(): void {
        if (!this.el) return;
        const next = nextMode(this.mode, this.ended);
        if (next === null) {
            /**
             * 收尾态点一下 = 关掉。
             *
             * 🔴 这里**不能**沿用 `if (this.disposed) return;` 那道闸：`finish()` 已经把
             * `disposed` 置 true 了（它的本意是「别再接收 update」），若在 toggle 里也拿它
             * 当退出条件，收尾态就**没有任何手动关闭途径** —— 用户想早点关掉刚弹出来的
             * 「完成」只能干等 `END_LINGER_MS`（2600ms）。`dismiss()` 本身对 disposed 是安全的。
             */
            this.dismiss();
            return;
        }
        // 只有「已收尾」才允许走上面那条；跑到这儿说明任务还在，节点也没被外部摘掉
        this.setMode(next);
    }

    /** 取消要先点两下（反问一次），避免误触丢任务 */
    private requestCancel(): void {
        if (this.ended || !this.cancelBtn) return;
        if (this.armedCancel) {
            this.armedCancel = false;
            if (this.armTimer !== null) {
                window.clearTimeout(this.armTimer);
                this.armTimer = null;
            }
            this.cancelBtn.removeClass('is-armed');
            this.armLabel(actionLabel('cancel'), '✕');
            this.opts.onCancel?.();
            return;
        }
        this.armedCancel = true;
        this.cancelBtn.addClass('is-armed');
        this.armLabel('再点一次就停下（已下载的部分会保留）', '确认取消');
        this.armTimer = window.setTimeout(() => {
            this.armTimer = null;
            this.armedCancel = false;
            if (!this.cancelBtn) return;
            this.cancelBtn.removeClass('is-armed');
            this.armLabel(actionLabel('cancel'), '✕');
        }, 4000);
    }

    /**
     * 给取消钮换「文字 + 提示 + 读屏名」。
     *
     * 🔴 这三样必须一起换，且**顺序固定**：`setText` 会清空子节点 ⇒ 读屏名 `.rl-sr`
     *    必须最后补，先补就被冲掉。2026-11-12（①-9）把原来三处各写一遍的四行
     *    收成这一个入口，就是为了不再出现「某一处只改了 data-tip 忘了 aria-label」。
     */
    private armLabel(tip: string, text: string): void {
        const btn = this.cancelBtn;
        if (!btn) return;
        btn.setText(text);
        setTip(btn, tip);
        srLabel(btn, tip);
    }

    /** 把当前状态刷到 DOM（只改文本与属性，⛔ 不重建节点） */
    private paint(): void {
        if (!this.el) return;
        const st = this.state();
        const pct = clampPercent(this.percent);
        if (this.headlineEl) this.headlineEl.setText(ballTitle(this.label));
        if (this.txtEl) this.txtEl.setText(pct === null ? '…' : `${pct}%`);
        // 球心与卡片同一口径（m07854 ⑨）：两处数字必须永远一样
        if (this.ringPctEl) this.ringPctEl.setText(pct === null ? '…' : `${pct}%`);
        if (this.detailEl) this.detailEl.setText(this.detail);
        // 无百分比 ⇒ 走不确定态（跑马灯），⛔ 不画一个停在 0 的条
        const p = barPercent(this.percent);
        if (this.barEl) this.barEl.toggleClass('is-indet', p === null);
        if (this.barFillEl) this.barFillEl.style.width = p === null ? '' : `${p}%`;
        if (this.arcEl) this.arcEl.setAttribute('stroke-dashoffset', String(RING_C * (1 - (p === null ? 0.18 : p / 100))));
        const lbl = this.pillEl?.querySelector('.rl-pball-lbl');
        if (lbl) lbl.setText(shortLabel(this.label));
        this.el.setAttribute('data-tip', ballTip(st));
    }

    update(next: { label?: string; percent?: number | null; detail?: string }): void {
        if (this.disposed) return;
        if (next.label !== undefined) this.label = next.label;
        if (next.percent !== undefined) this.percent = next.percent;
        if (next.detail !== undefined) this.detail = next.detail;
        this.paint();
    }

    /** 收尾共用：切到结果态 + 安排自毁 */
    private finish(kind: ProgressBallEnd, message?: string): void {
        if (this.disposed) return;
        this.disposed = true;
        this.ended = true;
        if (this.armTimer !== null) {
            window.clearTimeout(this.armTimer);
            this.armTimer = null;
        }
        // 收尾时一律展开成卡片：结果要让用户看见，⛔ 别缩成球再消失
        this.mode = 'card';
        this.paintMode();
        const text = endTip(kind, message);
        if (this.el) {
            this.el.addClass(kind === 'done' ? 'is-done' : 'is-fail');
            this.el.setAttribute('data-tip', text);
        }
        if (this.headlineEl) this.headlineEl.setText(text);
        if (this.txtEl) this.txtEl.setText(kind === 'done' ? '✓' : '!');
        // 球心同口径（m07854 ⑨）：收尾的小球不该还挂着 87% 这种中途数字
        if (this.ringPctEl) this.ringPctEl.setText(kind === 'done' ? '✓' : '!');
        if (this.detailEl) this.detailEl.setText('');
        if (this.barEl) this.barEl.toggleClass('is-indet', false);
        if (this.barFillEl) this.barFillEl.style.width = kind === 'done' ? '100%' : '0%';
        if (this.arcEl) this.arcEl.setAttribute('stroke-dashoffset', kind === 'done' ? '0' : String(RING_C));
        // 收尾态不再需要动作按钮（没东西可取消/收起）
        this.minBtn?.remove();
        this.cancelBtn?.remove();
        this.minBtn = null;
        this.cancelBtn = null;
        this.timer = window.setTimeout(() => this.remove(), END_LINGER_MS);
    }

    done(message?: string): void {
        this.finish('done', message);
    }

    fail(message?: string): void {
        this.finish('fail', message);
    }

    dismiss(): void {
        if (this.disposed && !this.el) return;
        this.disposed = true;
        this.remove();
    }

    /** 真正摘掉节点并清定时器（幂等） */
    private remove(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.armTimer !== null) {
            window.clearTimeout(this.armTimer);
            this.armTimer = null;
        }
        this.el?.remove();
        this.el = null;
        this.cardEl = null;
        this.pillEl = null;
        this.headlineEl = null;
        this.detailEl = null;
        this.barEl = null;
        this.barFillEl = null;
        this.txtEl = null;
        this.ringPctEl = null;
        this.arcEl = null;
        this.cancelBtn = null;
        this.minBtn = null;
        if (active === this) active = null;
    }
}

/** 当前那个卡片（单例；`null` = 没在跑） */
let active: ProgressBallImpl | null = null;

/**
 * 起一个进度卡片。
 *
 * ⚠️ 若已有卡片在跑，**旧的直接被接管**（静默丢弃）—— 见文件头约束⑴。
 * 返回的 handle 用于后续 `update/done/fail`；调完 `done/fail` 后再 `update` 无效（已收尾）。
 */
export function startProgressBall(label: string, opts: ProgressBallOptions = {}): ProgressBallHandle {
    active?.dismiss();
    const ball = new ProgressBallImpl(label, opts);
    active = ball;
    return ball;
}

/** 立刻拆掉卡片（插件 `onunload` 调；⛔ 不依赖 DOM 是否还在） */
export function destroyProgressBall(): void {
    active?.dismiss();
    active = null;
}
