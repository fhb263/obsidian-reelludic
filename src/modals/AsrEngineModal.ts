// 「选择音频转文字引擎」弹窗（用户 m01938 需求 ⑤ · 模块 1.3）
//
// 🔴 用户原文给的硬要求，逐条落到这里：
//  ⑴ 「卡片式单选，不要用原生下拉框」⇒ 三张 `.rl-asr-card` 竖排，推荐档带「推荐」角标；
//  ⑵ 「所有识别均在本地完成，音视频绝不会上传云端」⇒ 副标题第一句（信任背书必须在最明显的位置）；
//  ⑶ 「不出现技术黑话，技术词仅作极小字号的副标题」⇒ 标题只写「均衡版 / 极速版 / 精准版」，
//     `whisper.cpp · ggml-base` 放在 `.rl-asr-card-sub` 里小一号；
//  ⑷ 「下载中按钮变进度条，带暂停/继续和取消」⇒ 进度条 + 取消；**暂停不做**（见下方说明）；
//  ⑸ 「下载完成后变成 ✅ 已就绪」⇒ 徽标三态：未下载 / 下载中 N% / 已就绪；
//  ⑹ 「折叠项（高级配置）：底部提供 [展开高级配置]，里面可填自定义本地引擎路径」⇒ 由设置页那三行
//     路径输入承担，这里只放一个「用自定义模型文件」的入口，⛔ 不在这弹窗里再抄一套路径输入框。
//
// ⚠️ 为什么不做「暂停 / 继续」：断点续传要发 `Range` 请求并让服务端回 206，
//    HuggingFace 的 LFS 重定向链上并非每一跳都支持；做半套（暂停后从头下）比不做更坑。
//    取消会删掉 `.part`，重下从头开始 —— 这在 74MB 档上是可以接受的代价。
// ⚠️ 弹窗**不自己算目录、不自己发请求**：下载器由 `main` 注入（`onDownload`），
//    这样体积校验、.part 改名、取消清理只有一份实现。
import { App, Modal } from 'obsidian';
import { applyScrollPref } from 'services/scrollPref';
import {
    ASR_MODEL_PRESETS,
    ASR_MODEL_SITE,
    ASR_MODEL_SITE_MIRROR,
    manualDownloadTip,
    presetSizeLabel,
    type AsrModelPreset,
} from 'pure/asrModels';

/** 一档模型在界面上的实时状态 */
export interface AsrCardState {
    /** 目标文件是否已就绪（字节数校验通过） */
    ready: boolean;
    /** 正在下载时的百分比（0..100）；未在下载为 `null` */
    percent: number | null;
    /** 已收字节 / 总字节（进度文案用） */
    received: number;
    total: number;
}

/** 一次下载的句柄（由 `main` 提供，弹窗只管转调与显示） */
export interface AsrDownloadHandle {
    done: Promise<{ ok: boolean; message: string; path?: string }>;
    cancel: () => void;
}

export interface AsrEngineModalOptions {
    /** 当前生效的模型绝对路径（空串 = 未配置） */
    currentPath: string;
    /** 某一档的目标文件绝对路径（目录口径归 `main`，弹窗⛔ 不自己拼） */
    pathOf: (preset: AsrModelPreset) => string;
    /** 查某一档是否已下载就绪（含字节校验，由 main 实现） */
    stateOf: (preset: AsrModelPreset) => AsrCardState;
    /** 开始下载某一档；`onProgress` 由弹窗提供 */
    download: (preset: AsrModelPreset, onProgress: (pct: number | null, received: number, total: number) => void) => AsrDownloadHandle;
    /** 删除某一档的本地文件 */
    remove: (preset: AsrModelPreset) => void;
    /** 用户选中某一档（下载完成后自动调；也用于「切到已就绪的另一档」） */
    onPick: (preset: AsrModelPreset) => Promise<void>;
    /** 打开系统文件选择器挑一个自定义模型文件；返回选中的绝对路径或 null */
    pickCustom: () => Promise<string | null>;
    /** 用户选了自定义模型文件 */
    onPickCustom: (absPath: string) => Promise<void>;
    /**
     * 打开外部链接（2026-11-13 用户指令：「加下载模型官网路径，可让用户自己手动下载并配置对应的路径」）。
     * 宿主的 `openExternalUrl` 已限 http/https；这里只转调，⛔ 不在弹窗里自己 `window.open`。
     */
    onOpenExternal?: (url: string) => void;
}

export class AsrEngineModal extends Modal {
    private downloads = new Map<string, AsrDownloadHandle>();
    private cards = new Map<string, { state: AsrCardState; bar: HTMLElement; fill: HTMLElement; btn: HTMLButtonElement; badge: HTMLElement; del: HTMLButtonElement }>();
    private closed = false;

    constructor(
        app: App,
        private opts: AsrEngineModalOptions,
    ) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '选择音频转文字引擎' });
        // 信任背书（用户原文第一句）—— 必须在最显眼的位置，⛔ 不缩成脚注
        contentEl.createDiv({ cls: 'rl-asr-trust', text: '所有识别均在本地完成，音视频绝不会上传云端。' });

        // 🔴🔴 2026-11-14 用户 m03072 ⑥（逐字）：「给语音转文字的模型页加下载模型官网路径，
        //    （可让用户自己手动下载并配置对应的路径）区分一键下载和用户手动点链接下载并配置。
        //    旧版把手动下载塞在卡片上方、不标方式名，且「选择本地模型文件…」还藏在折叠项里
        //    ⇒ 用户看不出这是**两条并列的路**，也找不到配置入口。现按「方式一 / 方式二」分开：
        //    方式一 = 插件替你下（卡片）；方式二 = 你自己下 + 回来指定本地文件（本区自带按钮）。
        contentEl.createDiv({ cls: 'rl-asr-way', text: '方式一：一键下载并启用（插件联网下载）' });
        for (const p of ASR_MODEL_PRESETS) this.renderCard(contentEl, p);

        this.renderManualDownload(contentEl);

        // 高级配置：其余杂项（自定义模型路径已提到「方式二」里，这里不再重复放按钮）
        const adv = contentEl.createEl('details', { cls: 'rl-asr-adv' });
        adv.createEl('summary', { cls: 'rl-asr-adv-sum', text: '展开高级配置' });
        const advBody = adv.createDiv({ cls: 'rl-asr-adv-body' });
        advBody.createDiv({
            cls: 'rl-hint-note',
            text: '模型文件是 ggml 格式的 .bin，只要文件名对得上，放在任意目录都能用。',
        });
    }

    /**
     * 手动下载区（2026-11-13 首次加入；2026-11-14 用户 m03072 ⑥ 升级为「方式二」）。
     *
     * 🔴 用户要的是**两条并列的路**，不是「卡片 + 一段补充说明」：
     *    方式一 = 点卡片让插件下；方式二 = 自己去官网下 + 回来指定本地文件。
     *    所以这里必须自带「选择本地模型文件…」按钮（旧版藏在「展开高级配置」里，用户找不到）。
     * 🔴 两个域名都给：官网是权威源，但国内直连会超时；镜像能通但用户未必信任它。
     *    只给官网 = 一半用户点开是白屏；只给镜像 = 用户不敢点第三方域名。
     * 🔴 网址用 `setText` 原样显示而不是只藏在按钮里：用户常常先复制到浏览器下完、
     *    再回来选文件 —— 看不见的网址复制不了。
     * ⚠️ 逐个档位列文件名与体积：挑错一次要重下 1.5GB。
     */
    private renderManualDownload(host: HTMLElement): void {
        host.createDiv({ cls: 'rl-asr-way', text: '方式二：自己下载后指定本地文件（不联网）' });
        const box = host.createDiv({ cls: 'rl-asr-manual' });
        box.createDiv({ cls: 'rl-asr-manual-head', text: '从官网或镜像下载 .bin，再指定给插件' });
        box.createDiv({
            cls: 'rl-asr-manual-note',
            text: '下到本地后点下面的「选择本地模型文件…」指给它即可，插件不会联网下载任何东西。',
        });

        const rows: Array<{ label: string; url: string }> = [
            { label: '官网', url: ASR_MODEL_SITE },
            { label: '国内镜像', url: ASR_MODEL_SITE_MIRROR },
        ];
        for (const r of rows) {
            const line = box.createDiv({ cls: 'rl-asr-manual-row' });
            line.createSpan({ cls: 'rl-asr-manual-tag', text: r.label });
            // 网址原样可见 + 可选中复制（⛔ 不要只做成按钮）
            line.createSpan({ cls: 'rl-asr-manual-url', text: r.url });
            const open = line.createEl('button', { cls: 'rl-btn', text: '打开' });
            open.addEventListener('click', () => {
                if (this.opts.onOpenExternal) this.opts.onOpenExternal(r.url);
                else window.open(r.url, '_blank');
            });
        }

        // 每档给「文件名 + 体积」，用户照着下即可
        const list = box.createDiv({ cls: 'rl-asr-manual-files' });
        for (const p of ASR_MODEL_PRESETS) {
            list.createDiv({
                cls: 'rl-asr-manual-file',
                text: `${p.title} —— ${p.fileName}（约 ${presetSizeLabel(p)}）`,
            });
        }

        // 🔴 配置入口就放在「方式二」里面 —— 用户下完文件正好在这里接着点，零跳转
        const ops = box.createDiv({ cls: 'rl-asr-manual-ops' });
        const pick = ops.createEl('button', { cls: 'mod-cta', text: '选择本地模型文件…' });
        pick.addEventListener('click', () => {
            void this.opts.pickCustom().then(async (abs) => {
                if (!abs) return;
                await this.opts.onPickCustom(abs);
                this.close();
            });
        });

        // 通用提示：下完之后怎么让插件用上（⛔ 不在这里点名某一档 —— 上面逐个列过了）
        box.createDiv({ cls: 'rl-asr-manual-tip', text: manualDownloadTip() });
    }

    /** 画一张引擎卡片（结构固定，只让 `syncCard` 改字与状态） */
    private renderCard(host: HTMLElement, p: AsrModelPreset): void {
        const card = host.createDiv({ cls: 'rl-asr-card' });
        if (p.recommended) card.createSpan({ cls: 'rl-asr-tag', text: '✅ 推荐' });
        const head = card.createDiv({ cls: 'rl-asr-card-head' });
        head.createSpan({ cls: 'rl-asr-card-title', text: p.title });
        head.createSpan({ cls: 'rl-asr-card-sub', text: p.subtitle });
        card.createDiv({ cls: 'rl-asr-card-scene', text: p.scene });
        card.createDiv({ cls: 'rl-asr-card-meta', text: `约 ${presetSizeLabel(p)} · 下载后随时可删` });

        const badge = card.createSpan({ cls: 'rl-asr-card-badge', text: '' });
        const track = card.createDiv({ cls: 'rl-asr-card-track is-off' });
        const fill = track.createDiv({ cls: 'rl-asr-card-fill' });
        const ops = card.createDiv({ cls: 'rl-asr-card-ops' });
        const btn = ops.createEl('button', { cls: 'mod-cta', text: '下载并启用' });
        const del = ops.createEl('button', { cls: 'rl-btn', text: '删除' });

        const rec = { state: this.stateOf(p), bar: track, fill, btn, badge, del };
        this.cards.set(p.tier, rec);

        btn.addEventListener('click', () => this.startOrPick(p));
        del.addEventListener('click', () => {
            const h = this.downloads.get(p.tier);
            if (h) {
                // 下载中点「删除」= 取消（同一颗按钮的两种含义，避免多一颗没人懂的按钮）
                h.cancel();
                return;
            }
            this.opts.remove(p);
            this.refresh(p);
        });
        this.syncCard(p);
    }

    private stateOf(p: AsrModelPreset): AsrCardState {
        try {
            return this.opts.stateOf(p);
        } catch {
            return { ready: false, percent: null, received: 0, total: p.bytes };
        }
    }

    private refresh(p: AsrModelPreset): void {
        const rec = this.cards.get(p.tier);
        if (!rec) return;
        rec.state = this.stateOf(p);
        this.syncCard(p);
    }

    /** 把一张卡片的四个可变件刷成当前状态（⛔ 不重建节点） */
    private syncCard(p: AsrModelPreset): void {
        const rec = this.cards.get(p.tier);
        if (!rec) return;
        const st = rec.state;
        const busy = st.percent !== null;
        const isCurrent = !!this.opts.currentPath && this.opts.currentPath === this.pathOf(p);

        // 徽标三态：下载中 → 就绪 → 未下载
        if (busy) {
            rec.badge.setText(`下载中 ${st.percent ?? 0}%`);
            rec.badge.className = 'rl-asr-card-badge is-busy';
        } else if (st.ready) {
            rec.badge.setText(isCurrent ? '✅ 已就绪 · 使用中' : '✅ 已就绪');
            rec.badge.className = 'rl-asr-card-badge is-ready';
        } else {
            rec.badge.setText('未下载');
            rec.badge.className = 'rl-asr-card-badge';
        }

        rec.bar.toggleClass('is-off', !busy);
        rec.fill.style.width = busy ? `${Math.max(0, Math.min(100, st.percent ?? 0))}%` : '0';

        // 主按钮：下载中 = 取消；就绪且非当前 = 用它；就绪且当前 = 禁用；未下载 = 下载并启用
        rec.btn.disabled = false;
        if (busy) {
            rec.btn.setText('取消');
            rec.btn.className = 'rl-btn';
        } else if (st.ready && isCurrent) {
            rec.btn.setText('使用中');
            rec.btn.disabled = true;
            rec.btn.className = 'mod-cta';
        } else if (st.ready) {
            rec.btn.setText('用这一档');
            rec.btn.className = 'mod-cta';
        } else {
            rec.btn.setText('下载并启用');
            rec.btn.className = 'mod-cta';
        }
        // 删除只在「已就绪且不是当前使用中」时出现 —— 删正在用的会让转写直接失效
        rec.del.toggleClass('is-off', !st.ready || isCurrent);
    }

    private pathOf(p: AsrModelPreset): string {
        // 由 main 决定目录，这里不做拼接；`stateOf` 已经能判定就绪，路径只用于「是否当前」
        return this.opts.pathOf(p);
    }

    private startOrPick(p: AsrModelPreset): void {
        const rec = this.cards.get(p.tier);
        if (!rec) return;
        // 下载中 ⇒ 这颗按钮是「取消」
        const running = this.downloads.get(p.tier);
        if (running) {
            running.cancel();
            return;
        }
        if (rec.state.ready) {
            void this.opts.onPick(p).then(() => this.close());
            return;
        }
        this.downloads.set(
            p.tier,
            this.opts.download(p, (pct, received, total) => {
                const cur = this.cards.get(p.tier);
                if (!cur || this.closed) return;
                cur.state = { ...cur.state, percent: pct ?? (received > 0 ? 0 : null), received, total };
                this.syncCard(p);
            }),
        );
        const h = this.downloads.get(p.tier);
        if (!h) return;
        // 先把卡片切到「下载中 0%」，否则第一块数据到达前按钮没反应
        rec.state = { ...rec.state, percent: 0, received: 0, total: p.bytes };
        this.syncCard(p);
        void h.done.then(async (r) => {
            this.downloads.delete(p.tier);
            if (this.closed) return;
            this.refresh(p);
            if (!r.ok) return; // 失败/取消：卡片自己回到未下载态，⛔ 不弹红框
            await this.opts.onPick(p);
            this.close();
        });
    }

    onClose(): void {
        this.closed = true;
        // 关窗不中止下载（用户可以去看视频）—— 但弹窗自己不再更新
        this.downloads.clear();
        this.cards.clear();
        this.contentEl.empty();
    }
}
