import { MarkdownRenderChild } from 'obsidian';
import type { MediaEntry } from 'data/types';
import {
    NOTE_CARD_LANG,
    buildNoteCardGroups,
    isNoteCardRowEmpty,
    noteCardTypeLabel,
    parseNoteCardSource,
    type NoteCardGroup,
    type NoteCardRow,
} from 'pure/noteCard';
import { iconButton } from 'ui/components';
import { isHalfStarClick, normalizeRating } from 'pure/rating';
// ③ 单集评价：卡片上的展示值走纯层投影（与播放器面板同一份判据，⛔ 不在这里另拼中文名）
import { episodeReviewLines } from 'pure/episodeReview';

/**
 * 笔记里 ` ```reelludic ` 块的渲染层 —— **插件专属条目卡**（2026-11-14 用户 m04138 指令）。
 *
 * 用户原话：「在笔记规划渲染出插件专属组件，因为笔记属性和表单两个可视化不对等的」。
 *
 * ## 🔴 2026-11-14 用户 m07593 翻面：**纯详情视图 + 标题旁编辑按钮**
 * 上一版是「官方 `Setting` + 控件」（点字段就地改）。用户看了真实效果后改口：
 * > 「这个占地面太大了，改成显示详情为主，另一个加个编辑按钮在组件标题旁为打开编辑属性窗口」
 * ⇒ 卡内不再有**常驻**输入框：平时只渲染密排的「键：值」详情；要改一批字段走标题旁的
 *   「编辑」按钮 → 打开宿主的**编辑属性窗口**（`EntryModal`，走 `EntryService.update`
 *   + `writeNote`，保留区合并 / 指纹刷新 / 活动流全在 service 里）。
 *
 * ## 🔴 2026-11-16 第三次裁定：**行内快捷编辑**（保留 m07593 的「不占地方」）
 * 用户：「加行内快捷编辑，不再恢复旧表格」。
 * ⇒ 值平时是**纯文本**；点一下才就地换成控件（文本 / 数字 / 日期 / 下拉 / 半星），
 *   Enter 或失焦确认、Esc 取消；写完从 catalog 重取重画。
 *   ⛔ **不复活旧 Markdown 属性表格**；⛔ 不回到「每行一个常驻输入框」那版。
 *   纯层的写映射 `pure/noteCard.applyNoteCardEdit` 是唯一真源，本文件只负责「怎么点」，
 *   语义（怎么解析、哪些键不可写）一律交给纯层 —— `tests/noteCard.test.ts` 钉着读写成对。
 *
 * ## 为什么是 `MarkdownRenderChild`
 * 必须走 `ctx.addChild(...)` 的卸载链：切走笔记 / 切编辑模式 / 关标签页时 `onunload()` 会被调用。
 * 本组件持有**异步加载后的 DOM 与事件**，不挂卸载链会出现「关掉笔记后旧的补丁还在改数据」。
 * 范式与 `views/audioPlayerMount.AudioInlineBlock` 完全一致（await 后必须再判 `disposed`）。
 *
 * ## 控件口径
 * · 图标按钮一律走 `ui/components` 的 `iconButton`（真 `<button>` + `data-tip` + `.rl-sr` 读屏名）。
 *   🔴 同一个元素上 `data-tip` 与 `aria-label` 只能存一个（会叠两层气泡）。
 * · ⛔ 本文件不直接碰 vault，也不自己调 `EntryService` —— 一切写操作交给宿主回调。
 */
export interface NoteCardMountOptions {
    /** 读一条（`EntryService.get`） */
    getEntry: (id: string) => Promise<MediaEntry | undefined>;
    /** 打开条目（标题行点击），缺省则标题不可点 */
    openEntry?: (id: string) => void;
    /** 打开**编辑属性窗口**（标题旁的「编辑」按钮），缺省则不渲染该按钮 */
    editEntry?: (id: string) => void;
    /** 解析封面地址（http URL 直用；本地相对路径映射到 vault 资源），缺省则不显示封面 */
    posterUrl?: (entry: MediaEntry) => string | undefined;
    /**
     * 行内快捷编辑的**落库出口**（2026-11-16 第三次裁定）。
     *
     * 渲染层只负责「点哪一行、敲了什么」；解析与写盘一律交给宿主：
     * 纯层 `applyNoteCardEdit(entry, key, raw)` 出 `Partial<MediaEntry>`（`null` = 不可写 / 非法），
     * 宿主再走 `EntryService.update` + `writeNote`，最后回**落库后的最新 entry** 供本卡重画。
     * 返回 `undefined` = 这次编辑被拒绝（值非法 / 键只读），渲染层原样回显，不报假成功。
     *
     * 缺省则不启用行内编辑（卡退化成纯详情视图，即 m07593 那版行为）。
     */
    saveField?: (id: string, key: string, raw: string) => Promise<MediaEntry | undefined>;
}

/**
 * 一行的**展示值**。
 *
 * 🔴 枚举类（状态 / 心情）存的是机器 id（`want` / `wow`），直接印出来用户看不懂 ——
 *    纯层已经在 `row.options` 里给了「id → 中文标签」的映射，这里按 id 换回标签。
 *    找不到对应项（非法值）时回落到原值，⛔ 别显示成空（用户会以为字段丢了）。
 */
function displayValueOf(row: NoteCardRow): string {
    if (row.kind === 'enum') {
        const hit = (row.options ?? []).find((o) => o.value === row.value);
        if (hit) return hit.label;
    }
    return row.value;
}

/**
 * 渲染单行（平时**只读**：键 + 值，密排可扫读）。
 *
 * ⚠️ 上一版这里是「官方 `Setting` + 控件」，用户嫌占地方 ⇒ 改成纯文本行。
 *   ⛔ 别再把常驻的 `Setting` / `addText` / `addDropdown` 搬回来（详见文件头说明）。
 * 🔴 2026-11-16 第三次裁定：值可点 ⇒ 就地换成控件，写完即收起（仍不是常驻输入框）。
 */
function renderRow(parent: HTMLElement, row: NoteCardRow, host?: RowEditHost): void {
    const line = parent.createDiv({ cls: 'rl-notecard-line' });
    // 空值压暗：一眼能看出「这条还没填」（⛔ 别用 display:none 藏起来）
    if (isNoteCardRowEmpty(row)) line.addClass('is-empty');
    line.createSpan({ cls: 'rl-notecard-key', text: row.label });
    const val = line.createSpan({ cls: 'rl-notecard-val', text: displayValueOf(row) || '—' });
    if (row.note) {
        line.setAttribute('data-tip', row.note);
    }
    if (!host) return;
    makeEditable(val, line, row, host);
}

/** 行内编辑的宿主契约（由 `NoteCardBlock` 提供，渲染层只认这三个动作） */
interface RowEditHost {
    /** 该行允许行内改吗（`readonly` 行一律不许） */
    canEdit(row: NoteCardRow): boolean;
    /** 提交一个原始输入（解析与落库都在宿主侧） */
    commit(key: string, raw: string): void;
}

/**
 * 把只读值的 `<span>` 接上「点一下就地改」。
 *
 * ⛔ 只读行（`kind === 'readonly'`）不给入口：纯层 `isReadonlyKey` 已保证它与
 *   `applyNoteCardEdit` 返回 `null` 的那批键逐一对齐，渲染层再做第二道拦截只会漂移。
 */
function makeEditable(val: HTMLElement, line: HTMLElement, row: NoteCardRow, host: RowEditHost): void {
    if (!host.canEdit(row)) return;
    val.addClass('is-editable');
    val.setAttribute('role', 'button');
    val.tabIndex = 0;
    val.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // 🔴 已经在编辑中就别再来一次：刚建出来的 `select` / 星星 / 输入框都是 `val` 的**子节点**，
        //    点它们的事件会冒泡回这里 ⇒ 再进 `beginEdit` ⇒ `val.empty()` 把控件当场销毁，
        //    用户看到的正是「选项弹不出来 / 点一下就没」（2026-11-16 m00830）。
        if (val.hasClass('is-editing')) return;
        beginEdit(val, row, host);
    });
    val.addEventListener('keydown', (ev) => {
        if (val.hasClass('is-editing')) return;
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        beginEdit(val, row, host);
    });
    // 行上的悬停说明保留在 `line` 上（⛔ 不在 `val` 上再挂一遍，会叠两层气泡）
    line.addClass('is-editable-row');
}

/**
 * 就地换成控件。
 *
 * · 提交：Enter / 失焦 ⇒ 交给宿主（宿主回来重画整卡）
 * · 取消：Esc ⇒ 原样回显，不写盘
 * · `enum` 用 `<select>`：选项来自纯层 `row.options`（⛔ 别在这儿再写一份状态/心情清单）
 * · `rating` 用五颗星：左半点 = 半星（与单卡编辑属性同一判定 `isHalfStarClick`）
 */
function beginEdit(val: HTMLElement, row: NoteCardRow, host: RowEditHost): void {
    // 原始展示值：取消 / 被拒绝时回显用（⛔ 别在提交时把 `val` 清空——拒绝时会留下一片空白）
    const shown = displayValueOf(row) || '—';
    const restore = (): void => {
        val.removeClass('is-editing');
        val.empty();
        val.setText(shown);
    };
    // 提交只能发生一次：`select` 的 change 与 blur、输入框的 Enter 与 blur 会连着来两发
    let settled = false;
    const submit = (raw: string): void => {
        if (settled) return;
        settled = true;
        // 先回显原值占位，宿主返回后由 `renderInto` 整体重画（拒绝时这里就是最终态）
        val.removeClass('is-editing');
        val.empty();
        val.setText(shown);
        host.commit(row.key, raw);
    };
    val.empty();
    val.addClass('is-editing');

    if (row.kind === 'rating') {
        const box = val.createDiv({ cls: 'rl-notecard-stars' });
        for (let s = 1; s <= 5; s += 1) {
            const star = box.createSpan({ cls: 'rl-notecard-star', text: '★' });
            if (s <= Number(row.value)) star.addClass('is-on');
            star.addEventListener('click', (ev) => {
                const half = isHalfStarClick(ev.offsetX, (ev.currentTarget as HTMLElement).offsetWidth);
                const next = normalizeRating(half ? s - 0.5 : s);
                // 再点同一档 ⇒ 清空（与单卡编辑属性的手感一致）
                submit(String(next === normalizeRating(Number(row.value)) ? 0 : next));
            });
        }
        const clear = box.createSpan({ cls: 'rl-notecard-star-clear', text: '清空' });
        clear.addEventListener('click', () => submit('0'));
        bindEscape(val, restore);
        return;
    }

    if (row.kind === 'enum') {
        const sel = val.createEl('select', { cls: 'rl-notecard-inp' });
        // 空选项：让「清空」有落点（心情本来就允许清空；状态清空由纯层拒绝并回退）
        sel.createEl('option', { value: '', text: '—' });
        for (const o of row.options ?? []) {
            const opt = sel.createEl('option', { value: o.value, text: o.label });
            if (o.value === row.value) opt.selected = true;
        }
        // 展示值可能是中文标签而非机器 id ⇒ 没命中任何选项时按标签回选一次
        if (!sel.value) {
            const byLabel = (row.options ?? []).find((o) => o.label === row.value);
            if (byLabel) sel.value = byLabel.value;
        }
        sel.addEventListener('change', () => submit(sel.value));
        sel.addEventListener('blur', () => submit(sel.value));
        bindEscape(val, restore);
        sel.focus();
        return;
    }

    const input = val.createEl('input', { cls: 'rl-notecard-inp' });
    input.type = row.kind === 'number' ? 'number' : row.kind === 'date' ? 'date' : 'text';
    if (row.kind === 'number') input.step = 'any';
    // 日期回显是 `YYYY-MM-DD`（纯层原样存字符串）⇒ 直接喂给 date 输入
    input.value = row.value;
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            submit(input.value);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            settled = true;
            restore();
        }
    });
    input.addEventListener('blur', () => submit(input.value));
    input.focus();
    input.select();
}

/** Esc 取消（`select` 与星控件用；输入框在自身 keydown 里处理） */
function bindEscape(host: HTMLElement, restore: () => void): void {
    host.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        restore();
    });
}

/** 一组（「基本信息」「进度」…）。整组无行时调用方不会走到这里。 */
function renderGroup(parent: HTMLElement, group: NoteCardGroup, host?: RowEditHost): void {
    const box = parent.createDiv({ cls: 'rl-notecard-group' });
    box.createDiv({ cls: 'rl-notecard-group-head', text: group.label });
    const body = box.createDiv({ cls: 'rl-notecard-group-body' });
    for (const row of group.rows) renderRow(body, row, host);
}

/** 卡片上最多画几集评价（超出只报数）。一季几十集时整卡会长到没法看，10 行是「翻两屏」的量。 */
const REVIEW_LINES_MAX = 10;

/**
 * ③ 单集评价分区（用户 m00002：「笔记渲染条目卡也要显示每集个人状态与评价」）。
 *
 * 只读展示：卡片上**不可编辑单集评价** —— 改它要去播放器详情页那一节
 * （那才有当前集的概念，卡片没有「当前集」）。
 * ⚠️ 一条评价都没有 ⇒ 整个分区**不建**（空标题比没有标题更丑，与 `buildNoteCardGroups` 同口径）。
 * ⚠️ 展示串全部来自 `pure/episodeReview.episodeReviewLines`，本函数只管 DOM 与省略计数。
 */
function renderReviews(parent: HTMLElement, entry: MediaEntry): void {
    const { lines, total } = episodeReviewLines(entry.episodeReviews, REVIEW_LINES_MAX);
    if (!lines.length) return;
    const box = parent.createDiv({ cls: 'rl-notecard-group rl-notecard-reviews' });
    const head = box.createDiv({ cls: 'rl-notecard-group-head' });
    head.createSpan({ text: '单集评价' });
    head.createSpan({ cls: 'rl-notecard-rv-count', text: `已评 ${total} 集` });
    const body = box.createDiv({ cls: 'rl-notecard-group-body' });
    for (const line of lines) {
        const row = body.createDiv({ cls: 'rl-notecard-rv' });
        // 集号固定宽度：`第 1 集` 与 `第 12 集` 不对齐时右侧标签会参差
        row.createSpan({ cls: 'rl-notecard-rv-ep', text: line.label });
        row.createSpan({ cls: `rl-notecard-rv-st is-${line.status === '已看' ? 'done' : line.status === '在看' ? 'doing' : 'none'}`, text: line.status });
        if (line.tags) row.createSpan({ cls: 'rl-notecard-rv-tags', text: line.tags });
        if (line.mood) row.createSpan({ cls: 'rl-notecard-rv-mood', text: line.mood });
        if (line.note) row.createSpan({ cls: 'rl-notecard-rv-note', text: line.note });
    }
    if (total > lines.length) {
        body.createDiv({ cls: 'rl-notecard-rv-more', text: `还有 ${total - lines.length} 集已评（去播放器详情页看全部）` });
    }
}

/**
 * ` ```reelludic ` 块的渲染体。
 *
 * source 只有**条目 id 一行**（`pure/noteCard.noteCardSourceOf`）：属性一律从 catalog 现取，
 * 避免「代码块里抄一份、frontmatter 里抄一份」形成两份真源。
 */
export class NoteCardBlock extends MarkdownRenderChild {
    private disposed = false;

    constructor(
        containerEl: HTMLElement,
        private readonly source: string,
        private readonly opts: NoteCardMountOptions,
    ) {
        super(containerEl);
    }

    async onload(): Promise<void> {
        const id = parseNoteCardSource(this.source);
        const host = this.containerEl;
        host.addClass('rl-nc');
        host.setAttribute('data-lang', NOTE_CARD_LANG);

        if (!id) {
            host.createDiv({ cls: 'rl-notecard-empty', text: '这个条目卡没有指定条目 id（第一行写条目的 id）' });
            return;
        }

        const entry = await this.opts.getEntry(id);
        // await 期间可能已经卸载（用户快速切走）⇒ 别再画，画了也没人收
        if (this.disposed) return;

        if (!entry) {
            host.createDiv({ cls: 'rl-notecard-empty', text: `找不到条目：${id}` });
            return;
        }

        // 唯一渲染入口：首次加载与行内改完重画都走 `renderInto`（⛔ 别再抄第二份版式代码）
        this.renderInto(entry);
    }

    /**
     * 版式（2026-11-16 用户 m01057：「笔记条目卡能不能分两栏就不会太长」）：
     *
     *     ┌──────────────────────────────────────────┐
     *     │ [封面] 类型 · 标题                  [编辑] │  ← head：整行通栏
     *     ├────────────────────┬─────────────────────┤
     *     │ 基本信息            │ 演职与规格           │  ← body：两栏流式
     *     │  类型 / 年份 …      │  导演 / 主演 …       │
     *     ├────────────────────┼─────────────────────┤
     *     │ 日期                │ 进度                 │
     *     └────────────────────┴─────────────────────┘
     *
     * 🔴 为什么是「整卡 head 通栏 + body 两栏」而不是「封面一栏 / 详情一栏」：
     *    上一版封面独占左栏、所有分组挤在右栏 ⇒ 组一多右栏就长得离谱（用户原话「太长」）。
     *    现在封面与标题合成通栏 head，下面的分组用 CSS 多栏（`column-count: 2`）**自动**流成两列，
     *    组数再多也只是往右挪，⛔ 不需要在 TS 侧手工配对「哪组跟哪组并排」。
     * ⚠️ 两栏靠 `styles.css` 的 `.rl-notecard-body` 实现（含窄屏回落单栏），改栏数只改 CSS。
     * ⚠️ 封面仍必须 `flex: 0 0 auto` 且窄：竖版 2:3 图铺满横向会变成一张巨图（m07593 的教训）。
     * ⚠️ 没有封面时不建封面节点：空位会白白吃掉宽度把标题挤窄（同旧版「不留灰框」口径）。
     */
    private renderInto(entry: MediaEntry): void {
        if (this.disposed) return;
        const host = this.containerEl;
        host.empty();
        const split = host.createDiv({ cls: 'rl-notecard-split' });

        // ── head：封面 + 标题行（通栏） ──
        const head = split.createDiv({ cls: 'rl-notecard-head' });
        const poster = this.opts.posterUrl?.(entry);
        if (poster) {
            const cover = head.createDiv({ cls: 'rl-notecard-cover' });
            const img = cover.createEl('img', {
                cls: 'rl-notecard-poster',
                attr: { alt: entry.title || '封面' },
            });
            img.setAttribute('src', poster);
            // 🔴 豆瓣图床防盗链：必须显式带 Referer，否则 418（与 `MediaList` / `CollectionBoard` 同口径）
            img.setAttribute('referrerpolicy', 'unsafe-url');
        }

        // ── 标题行：类型 + 标题 + 「编辑」按钮 ──
        const titleRow = head.createDiv({ cls: 'rl-notecard-titlerow' });
        const titleBox = titleRow.createDiv({ cls: 'rl-notecard-titlebox' });
        const kicker = titleBox.createDiv({ cls: 'rl-notecard-kicker', text: 'ReelLudic 条目' });
        kicker.setAttribute('data-tip', `类型：${noteCardTypeLabel(entry.type)}`);
        const title = titleBox.createDiv({ cls: 'rl-notecard-title', text: entry.title || '（未命名）' });
        if (this.opts.openEntry) {
            title.addClass('is-link');
            title.addEventListener('click', () => this.opts.openEntry?.(entry.id));
            // 只读入口留给键盘用户：标题是 div，补一个 tabindex + Enter
            title.setAttribute('role', 'link');
            title.tabIndex = 0;
            title.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                this.opts.openEntry?.(entry.id);
            });
        }

        // 「编辑」按钮（m07593）：标题旁的编辑入口 → 打开宿主的编辑属性窗口
        if (this.opts.editEntry) {
            const edit = iconButton('rl-notecard-edit', 'pencil', '编辑属性');
            edit.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.opts.editEntry?.(entry.id);
            });
            titleRow.appendChild(edit);
        }

        // ── 详情：七组「键：值」密排（挂在 split 下、与 head 平级；两栏由 CSS 多栏自动流） ──
        const body = split.createDiv({ cls: 'rl-notecard-body' });
        // 行内编辑宿主：`saveField` 缺省 ⇒ 不给入口（退化成纯详情视图 = m07593 那版行为）
        const rowHost: RowEditHost | undefined = this.opts.saveField
            ? {
                  canEdit: (r) => r.kind !== 'readonly',
                  commit: (key, raw) => void this.commitField(entry.id, key, raw),
              }
            : undefined;
        for (const g of buildNoteCardGroups(entry)) renderGroup(body, g, rowHost);

        // ③ 单集评价（用户 m00002：「笔记渲染条目卡也要显示每集个人状态与评价」）。
        //    🔴 挂在 head 之后、body 之下但**通栏**（`is-reviews` 类在 CSS 里 `column-span: all`）——
        //       塞进两栏流里会被从中间劈开，一季十几集读起来要来回跳栏。
        //    🔴 展示值一律走 `pure/episodeReview.episodeReviewLines`（与播放器面板同一份判据），
        //       ⛔ 别在这里自己拼 `EPISODE_TAG_LABELS[t]`：两套拼法必然漂移成
        //       「面板写高光、卡片写 highlight」。
        //    ⚠️ 只出**有内容**的集（`episodeReviewLines` 内部已滤）：一季 40 集只评了 3 集，
        //       铺 40 行「未看 — —」纯属噪音。超出上限的那几集只报数不画。
        renderReviews(split, entry);
    }

    /**
     * 提交一次行内编辑。
     *
     * 🔴 解析与落库都在宿主（`pure/noteCard.applyNoteCardEdit` + `EntryService.update` + `writeNote`）；
     *   本块只做两件事：把宿主的**拒绝**（`undefined`）静默回退，以及拿到最新 entry 后重画。
     * 返回 `undefined` = 被拒绝（值非法 / 键只读），⛔ 不弹「已保存」的假成功。
     */
    private async commitField(id: string, key: string, raw: string): Promise<void> {
        if (this.disposed || !this.opts.saveField) return;
        let next: MediaEntry | undefined;
        try {
            next = await this.opts.saveField(id, key, raw);
        } catch {
            return;
        }
        if (this.disposed || !next) return;
        this.renderInto(next);
    }

    onunload(): void {
        this.disposed = true;
        this.containerEl.empty();
    }
}

/** 注册用的语言名（`main.ts` 注册处理器时不用再手写一次字符串，避免两处漂移） */
export { NOTE_CARD_LANG };
