// 本地剧集集数选择弹窗（海报墙「观看」按钮 → 影视条目二次列出 1..N 集；电影多资源时按「文件 N」措辞）
//
// 🔴 #576（用户 2026-10-09「三、选集弹窗重构 / 1. UI 与交互改造（P0）」）——**本批整块重写交互形态**：
//    ①「**左侧封面化**：去掉左侧单独的数字，改成封面图，布局改为**左图右文**」
//       ⇒ 左侧那格（原来的序号）**换成封面缩略图**，集号挪进右侧文字块首行。⛔ 那个序号类名整体退场
//          —— 本注释**刻意不抄那个类名**：注释会进产物，抄了会撞红自己的反向守卫（本仓老坑）。
//    ②「**状态优化**：『未关联』状态增加『去关联』操作入口；移除弹窗底部的蓝色实心『取消』按钮」
//       ⇒ ⚠️ **取字面 vs 取意图**：未关联的行**没有可去的东西**，所以「去关联」落在**已关联**的行上
//          （清掉该集的本地路径 + 网络链接，集标题保留）；未关联行维持灰标、没有按钮。
//          取消按钮**整块删除** —— 退出走 Esc / 点遮罩 / 右上角关闭（都是 Obsidian 的既有路径）。
//    ③「**分页与展示**：每页展示 52 集（图标形式），下放显示分页 `1 2 3 ... 8 9 10`，
//       并加入 `<`（上一页）和 `>`（下一页）按钮」⇒ **翻面 #573 的「区间档签」**（`1-50 / 51-52`）：
//       档签与页码条是同一件事的两种形态，留着两套必然分叉。算法在纯模块 `pure/epPages`。
//    ④「将『当前进度』（橙色框）改成（橙色小圆点角标）：不要用粗边框，直接在对应数字的右下角加一个
//       极小的橙色圆点」⇒ 当前集在**集号右下角**点一粒 `.rl-eps-dot`（⛔ 不再用粗边框）。
//
// 🔴 #577（用户 2026-10-09「三、选集弹窗重构 / 2. 封面获取策略 + 3. 性能与缓存（P0）」）：
//    ① 左格封面**真的接上了**：本地视频 ⇒ 首帧（`<video preload="metadata">`，与库内音频探时长同一条路）；
//       网络视频 ⇒ 平台缩略图（B 站 `view` 的 `pic` + `@320w_200h_1c.webp`，算法见 `pure/epCover`）；
//       两者都没有 ⇒ **统一占位图**（灰底图标，⛔ 不显示破图）。计划由**宿主注入**（`coverFor`）。
//    ② **懒加载**：行进视口才去解析封面（`IntersectionObserver` + 160px 预取余量）——
//       52 集只问看得见的那几条；解析中先铺**骨架屏**（弱网先看到集数与标题，封面慢慢来）。
//    ③ 内存缓存 / 限速 / 去重都在**宿主**（`main.biliThumb`）：弹窗每次都是新实例，
//       缓存放这里等于没缓存（用户点名要「二次打开直接读缓存」）。
//
// ⚠️ **沿用不动**（前批的既定口径，本批只换外壳）：
//    · 悬停提示一律 `data-tip`（#448：未关联行 `disabled` 时原生 `title` 在实机上不弹）；
//    · dead 才标红、`unknown` 不标（#527）；列表**不设框内滚动**（#447，超出交给宿主 `.modal` 自己滚）。
//
// 🔴 #599（用户 2026-10-09）三条：
//    ①「选集（封面 + 集数号 + 集数标题）改成多列」⇒ 列表由竖排行改成 **网格**（#600 起 = **4 列**），
//       每格 = 封面（在上，16:10 铺满格宽）+ 集数号 + 集数标题（在下）；
//    ②「去除【去关联】入口按钮」⇒ 每行那枚按钮**整体退场**（连带宿主那枚落库出口与它的样式一并删）
//       —— ⛔ 不留死码；⚠️「按钮的类名 / 回调名 / 宿主方法名」这三个字面量**刻意一个都不写**：
//          注释会进产物，写了会撞红「那枚按钮不许回潮」那条反向守卫（本仓老坑）。
//       改关联/解除关联走海报墙右键那条**常驻**的「关联观看入口」（#599，清空输入框即解除）。
//    ③「隐藏滚动条」⇒ `modalEl` 挂全仓那枚 `.rl-hide-scroll`（**仍可滚**，只是不画条）。
// 🔴 #600（用户 2026-10-10）：① 列数 **3 → 4**（用户：「改成四列」）；② 分页口径改成
//    「**100 集以上才分页**」（页大小真源 = 纯模块 `pure/epPages.EP_PAGE_SIZE`，⛔ 弹窗里不写死数字）。
// 点击返回集下标（0 基），播放逻辑由调用方按本地优先处理；DOM API 渲染，风格复用 ConfirmModal/LinkPickerModal。
import { App, Modal, setIcon } from 'obsidian';
import type { LinkStatus } from 'pure/linkStatus';
import type { EpCoverPlan } from 'pure/epCover';
import { pageBarItems, pageCount, pageIndexOf, pageSlice, pageStep } from 'pure/epPages';

/** `setIcon` 遇未知名会抛 ⇒ 统一走这层（图标缺失不该让整个窗口打不开） */
function setIconSafe(el: HTMLElement, icon: string): void {
    try {
        setIcon(el, icon);
    } catch {
        /* 图标名不存在时静默（留空位，不炸） */
    }
}

export class EpisodePickerModal extends Modal {
    private resolve: ((idx: number | null) => void) | null = null;
    /** 当前页（0 基）—— 打开时落在 `currentIndex` 那一页 */
    private page = 0;
    /**
     * #576 起：宿主数组的**只读副本**（本窗不再改它们 —— #599 撤掉「去关联」后彻底只读）；
     * 复制仍保留：免得哪天上游数组被替换时本窗读到半途状态。
     */
    private files: (string | undefined)[];
    private urls: (string | undefined)[];
    private listEl: HTMLElement | null = null;
    private pagerEl: HTMLElement | null = null;
    /** #577 懒加载：可视区观察器（惰性创建；关窗时断开） */
    private io: IntersectionObserver | null = null;
    /** #577 观察中的行：`元素 → { 封面格, 集下标 }`（IO 回调只给元素，靠它取回上下文） */
    private readonly pending = new Map<Element, { cov: HTMLElement; idx: number }>();
    /** #577 已经问过封面的集（切页来回翻不重复问） */
    private readonly asked = new Set<number>();

    constructor(
        app: App,
        private entryTitle: string,
        private episodeFiles: (string | undefined)[],
        private episodeUrls: (string | undefined)[],
        private episodeTitles: (string | undefined)[],
        /** 电影（无「集」概念，多资源 = 多个文件）：标题与提示改用「文件 N」措辞 */
        private single = false,
        /**
         * #527：剧集**网络链接失效**状态（与 `episodeUrls` 下标对齐；`dead` 标红）。
         * 🔴 来自宿主**内存缓存**（编辑表单点过「检测失效」才有）—— 没检测过就传 `undefined`，
         *    此时与旧行为完全一致（⛔ 不自己探测：探测是用户手动触发的动作）。
         */
        private statuses?: (LinkStatus | undefined)[],
        /**
         * 🔴 #573 建立 / #576 语义升级：**当前看到的那一集**（0 基）。
         * 宿主传 `progress.episode - 1`。两个用途：⑴ 打开时默认停在它所在的**页**；
         * ⑵ 它的集号右下角点一粒**橙色小圆点**（#576 的四号要求）。
         * 缺省 0；越界钳到最后一页（见 `onOpen`）。
         */
        private currentIndex = 0,
        /**
         * 🔴 #577：封面**计划**解析（下标 → 计划）。宿主注入（`main.epCoverFor`）：
         * 本地视频首帧 / B 站缩略图（`@320w_200h_1c.webp`）/ 统一占位图。
         * ⚠️ 允许**异步**（B 站缩略图要发一次 `view` 请求）⇒ 弹窗先铺**骨架屏**再画。
         * 缺省 `undefined` ⇒ 全部走**统一占位图**（⛔ 不显示破图）。
         */
        private coverFor?: (idx: number) => EpCoverPlan | Promise<EpCoverPlan>,
    ) {
        super(app);
        // 稀疏数组的洞要原样保留（index i 恒 = 第 i+1 集，见 `pure/episodeAssoc.storeEpisodeList`）
        this.files = Array.isArray(episodeFiles) ? episodeFiles.slice() : [];
        this.urls = Array.isArray(episodeUrls) ? episodeUrls.slice() : [];
    }

    open(): Promise<number | null> {
        super.open();
        return new Promise((res) => (this.resolve = res));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-eps-modal');
        // 🔴 #599：本窗隐藏滚动条（用户点名）—— 复用全仓 `.rl-hide-scroll`（仍可滚，只是不画条）
        this.modalEl.addClass('rl-hide-scroll');
        contentEl.createDiv({
            cls: 'rl-nc-desc rl-eps-title',
            text: this.single ? `选择要播放的文件：《${this.entryTitle}》` : `选择集数：《${this.entryTitle}》`,
        });

        // 默认停在「当前看到的那一集」所在的页（52 集时正好是第一页，与旧观感一致）
        const pages = pageCount(this.files.length);
        const want = pageIndexOf(this.currentIndex);
        this.page = want < pages ? want : Math.max(0, pages - 1);

        // 🔴 列表**不设框内滚动**（#447 用户裁定：「把滑动条移除掉，剧集按钮对齐框」）—— 真的超出视口时
        //    由**宿主 `.modal`** 自己滚（它本就有 `max-height: var(--dialog-max-height)` + `overflow: auto`）。
        this.listEl = contentEl.createDiv({ cls: 'rl-eps-list' });
        this.pagerEl = contentEl.createDiv({ cls: 'rl-eps-pager' });
        this.paint();
        // ⛔ #576：底部那枚蓝色实心「取消」**整块删除**（用户点名）—— 退出走 Esc / 点遮罩 / 右上角关闭。
    }

    /** 重画「当前页的行 + 页码条」（切页 / 去关联后都调它） */
    private paint(): void {
        const list = this.listEl;
        const pager = this.pagerEl;
        if (!list || !pager) return;
        const total = this.files.length;
        const pages = pageCount(total);

        list.empty();
        // #577：上一页的行已经不在 DOM 里了 ⇒ 观察表一并清掉（⛔ 别让旧节点一直挂在表里）
        this.pending.clear();
        const [start, end] = pageSlice(this.page, total);
        for (let i = start; i < end; i++) this.renderRow(list, i);

        pager.empty();
        if (pages <= 1) return; // 单页不画页码条（CSS `:empty` 收掉那一行）
        // 🔴 #589：整条最前给一枚**页码读数**（`第 3 / 10 页`）—— 页码条只给「能跳到哪」，
        //    读数给「现在在哪、一共几页」；⛔ 它只是一枚文字 span（不是按钮，不参与跳页）。
        pager.createSpan({ cls: 'rl-eps-pg-info', text: `第 ${this.page + 1} / ${pages} 页` });
        const mk = (icon: string, aria: string, disabled: boolean, onClick: () => void): void => {
            const b = pager.createEl('button', { cls: 'rl-eps-pg is-step', attr: { 'data-tip': aria } });
            b.type = 'button';
            setIconSafe(b, icon);
            b.createSpan({ cls: 'rl-sr', text: aria });
            if (disabled) b.disabled = true;
            else b.onclick = () => onClick();
        };
        mk('chevron-left', '上一页', this.page <= 0, () => {
            this.page = pageStep(this.page, pages, -1);
            this.paint();
        });
        for (const it of pageBarItems(pages, this.page)) {
            if (it === '…') {
                pager.createSpan({ cls: 'rl-eps-pg-gap', text: '…' });
                continue;
            }
            const on = it - 1 === this.page;
            const b = pager.createEl('button', { cls: 'rl-eps-pg' + (on ? ' is-on' : ''), text: String(it) });
            b.type = 'button';
            if (on) b.setAttribute('aria-current', 'page');
            else
                b.onclick = () => {
                    this.page = it - 1;
                    this.paint();
                };
        }
        mk('chevron-right', '下一页', this.page >= pages - 1, () => {
            this.page = pageStep(this.page, pages, 1);
            this.paint();
        });
    }

    /**
     * 画一集的那一格（#599 起：**网格里的一格**；#600 起 = **4 列**）。🔴 悬停提示（`data-tip`）与「点格选这一集」的口径
     * **一个字没改**（#448/#527）—— 本批只换外壳（竖排行 → 网格格；封面铺满格宽、集号与标题在下方）。
     *
     * ⚠️ #599 起这一格**只有一个可交互元素**（`button.rl-eps-row`）—— 原先与它并排的「去关联」已退场，
     *    ⇒ 不再有「button 里不能嵌 button」那笔账（#564 同源那条），⛔ 也别再往里塞任何按钮。
     */
    private renderRow(list: HTMLElement, i: number): void {
        const path = this.files[i];
        const url = this.urls[i];
        const title = this.episodeTitles[i];
        const linked = !!path || !!url;
        // #527：该集网络链接被检测为失效（`dead`）→ 标红 + 提示里说清（⛔ 只在真 dead 时标；unknown 不标）
        const dead = this.statuses?.[i] === 'dead';
        // 🔴 #576：当前看到的那一集（宿主传 `progress.episode - 1`）
        const cur = i === this.currentIndex;
        // 提示首行 = 「第 N 集 集标题」（电影态 = 「文件 N 标题」）
        const label = this.single ? `文件 ${i + 1}${title ? ` ${title}` : ''}` : `第 ${i + 1} 集${title ? ` ${title}` : ''}`;
        const base = linked
            ? [label, path ? `本地：${path}` : '', url ? `网络：${url}` : ''].filter(Boolean).join('\n')
            : `${label}（未关联，可在编辑表单中添加）`;
        const hint = dead ? `${base}\n⚠ 链接可能已失效` : base;

        const item = list.createDiv({ cls: 'rl-eps-item' });
        // 🔴 #448：悬停提示走 `data-tip`（项目 UI 规范：一律自绘气泡，禁原生 `title` 黄条）。
        const row = item.createEl('button', {
            cls:
                'rl-eps-row'
                + (linked ? (dead ? ' is-linked is-dead' : ' is-linked') : ' is-off')
                + (cur ? ' is-cur' : ''),
            attr: linked ? { 'data-tip': hint } : { 'data-tip': hint, disabled: 'true' },
        });
        // ── 左格：封面（#577：本地首帧 / B 站缩略图 / 统一占位图）──
        const cov = row.createSpan({ cls: 'rl-eps-cover' });
        this.watchCover(item, cov, i);
        // ── 右格：集号（+ 当前进度橙点） / 可选集标题 ──
        const txt = row.createSpan({ cls: 'rl-eps-txt' });
        const nameEl = txt.createSpan({ cls: 'rl-eps-name' });
        nameEl.createSpan({ text: this.single ? `文件 ${i + 1}` : `第 ${i + 1} 集` });
        // 🔴 #576：「当前进度」= 集号**右下角**一粒极小的橙点（⛔ 不用粗边框；反向守卫锚的词，注释里一个都不许出现）
        if (cur) nameEl.createSpan({ cls: 'rl-eps-dot' });
        // 集标题是**可选**的（没填就不渲染那一行，⛔ 不留空占位）
        if (title) txt.createSpan({ cls: 'rl-eps-sub', text: title });
        // 状态标只标「异常」两态：未关联（灰）/ 已失效（红）—— 已关联且正常时保持干净
        if (!linked) row.createSpan({ cls: 'rl-eps-tag', text: '未关联' });
        else if (dead) row.createSpan({ cls: 'rl-eps-tag is-dead', text: '已失效' });
        if (linked) row.onclick = () => this.finish(i);
    }

    /**
     * 🔴 #577 **懒加载**：行进入可视区才去解析封面。
     *
     *  - 拿不到 `IntersectionObserver`（老运行环境）⇒ **立即**解析（能力回落，⛔ 别把路堵死）；
     *  - `root: null` 打**视口**：本列表自己不滚（#447），滚的是宿主 `.modal`
     *    —— 但 `IntersectionObserver` 会按**祖先的溢出裁剪**算交集，所以宿主滚出去的行照样不算可见；
     *  - 一条行只观察一次，命中即 `unobserve`（⛔ 不重复问）；
     *  - 关窗时 `disconnect`（否则「已经滚过去」的那些行还会继续排队发请求）。
     */
    private watchCover(item: HTMLElement, cov: HTMLElement, i: number): void {
        if (!this.coverFor) {
            this.paintPlaceholder(cov); // 宿主没注入能力 ⇒ 直接占位（旧行为）
            return;
        }
        const io = this.ensureIo();
        if (!io) {
            this.slotCover(cov, i);
            return;
        }
        this.pending.set(item, { cov, idx: i });
        io.observe(item);
    }

    /** 观察器（惰性建一次）；运行环境不支持 ⇒ `null` */
    private ensureIo(): IntersectionObserver | null {
        if (this.io) return this.io;
        if (typeof IntersectionObserver !== 'function') return null;
        this.io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    const hit = this.pending.get(e.target);
                    this.io?.unobserve(e.target);
                    this.pending.delete(e.target);
                    if (hit && hit.cov.isConnected) this.slotCover(hit.cov, hit.idx);
                }
            },
            // 预取余量：快滚到时先把请求发出去（是「可视区域的余量」，⛔ 不是全量预取）
            { root: null, rootMargin: '160px 0px' },
        );
        return this.io;
    }

    /**
     * 向宿主要这一集的封面：**先骨架屏**，计划到手再画。
     * ⚠️ 同一行只问一次（`asked`）—— 切页来回翻不该重复打接口。
     * ⚠️ 计划到手时那一格可能已经不在 DOM 里了（用户翻页 / 关窗）⇒ `isConnected` 兜底，⛔ 别往空气里画。
     */
    private slotCover(cov: HTMLElement, i: number): void {
        if (!this.coverFor || this.asked.has(i)) return;
        this.asked.add(i);
        cov.addClass('is-load'); // 骨架屏
        let plan: EpCoverPlan | Promise<EpCoverPlan>;
        try {
            plan = this.coverFor(i);
        } catch {
            plan = { kind: 'none' }; // 宿主解析炸了 ⇒ 占位图（⛔ 不让封面把弹窗搞崩）
        }
        void Promise.resolve(plan).then(
            (p) => {
                if (cov.isConnected) this.drawCover(cov, p);
            },
            () => {
                if (cov.isConnected) this.drawCover(cov, { kind: 'none' });
            },
        );
    }

    /** 画封面：`img` / `video`（本地首帧）/ 统一占位图 */
    private drawCover(cov: HTMLElement, plan: EpCoverPlan): void {
        cov.removeClass('is-load');
        if (plan.kind === 'img') {
            const img = cov.createEl('img', { cls: 'rl-eps-img' });
            img.src = plan.src;
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = '';
            return;
        }
        if (plan.kind === 'video') {
            // 本地视频**首帧**：`preload="metadata"` 让浏览器解出首帧（与库内音频探时长同一条路）。
            // ⛔ 不自动播放、不带控件：这一格只是封面，点它仍然是「选这一集去播放」。
            const v = cov.createEl('video', { cls: 'rl-eps-vid' });
            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;
            v.src = plan.src;
            // 解不出来（编码不支持 / 文件被移走）⇒ 就地回落占位图
            v.addEventListener('error', () => {
                if (cov.isConnected) this.paintPlaceholder(cov);
            });
            return;
        }
        this.paintPlaceholder(cov);
    }

    /** **统一占位图**：灰底 + 图标（拿不到封面就是它，⛔ 不显示破图、不编假地址） */
    private paintPlaceholder(cov: HTMLElement): void {
        cov.empty();
        cov.addClass('is-ph');
        setIconSafe(cov, this.single ? 'file-video' : 'video');
    }

    onClose(): void {
        // #577：断开观察器（否则已经滚过去的行还会继续排队发请求）
        this.io?.disconnect();
        this.io = null;
        this.pending.clear();
        this.resolve?.(null);
        this.contentEl.empty();
    }

    private finish(idx: number | null): void {
        const res = this.resolve;
        this.resolve = null;
        this.close();
        res?.(idx);
    }
}
