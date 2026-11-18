// 「今天看什么」全屏抽卡（m07854 ⑭，⑳ ③ 改版）
//
// 🔴 为什么是 **Modal** 而不是自己画一层 `position: fixed` 遮罩：
//    本仓 `MediaList.svelte:2228` / `:4053` / `:5121` 三处注释都记着同一条 ——
//    Obsidian 视图有 transform 祖先，`position: fixed` 会被整体偏移（#610 也是同一件事）。
//    Modal 由宿主挂在 body 下，不受那条限制，且自带 Esc / 点遮罩关闭、焦点管理、滚动隔离。
//    ⛔ 别再另造一套遮罩。
//
// 用户原话（`m07854` ⑭）：「点击从所有「想看」且**评分较高**的条目中随机全屏弹出一张卡片，
// 带「换一个 / 就它了」按钮，「就它了」为主按钮」
//
// 🔴 用户 m12298 ③ 的四处改版（本文件当前形态）：
//    逐字：「这个随机看一部页面要调整一下把右下角的改属性按钮删除，把"换一个/就它了"按钮放在右下角，
//          优化布局样式添加更多的信息（简介要有、个人状态与评价也要放上去）同时封面右下角加个播放按钮
//          如有（如没有给加个未关联封面右下角标）」
//    ① **删「改属性」**：那颗按钮是「不打开、直接编辑属性」的次选，用户明确不要 ⇒
//       连同 `onEditEntry` 注入位一起摘掉（⛔ 留着死参数 = 下次有人又接回去）。
//    ② **「换一个 / 就它了」右下角**：顺序不变（换一个在左、就它了在右），只是整组
//       `justify-content: flex-end` —— 与「改属性」原来占的那个 `margin-left: auto` 位置一致。
//    ③ **补信息**：简介（`summary`）+ 个人状态与评价（状态 / 评分 / 心情 / 个人评语）。
//       全部取自 `MediaEntry` 既有字段，⛔ 没有为了这张卡新增任何 schema。
//    ④ **封面右下角**：有入口 ⇒ 播放圆钮（点了直接播）；没有 ⇒ 「未关联」角标。
//       🔴 判据走 `pure/actionLabel` 的 `hasActionEntry`（**唯一真源**）—— ⛔ 别在这里
//          自己写 `episodeFiles?.length` 那一串，那会和「左键点了会不会有反应」分叉
//          （`actionLabel` 头注释记着 #534 / #535 / #601 三次同源漏判）。

import { App, Modal } from 'obsidian';
import type { MediaEntry } from '../data/types';
import { buildWatchPool, pickWatchCandidate } from '../pure/whatToWatch';
import { normalizeRating, starString } from '../pure/rating';
import { statusLabel } from '../pure/labels';
import {
    actionIcon,
    actionReadyHint,
    actionUnavailableHint,
    actionVerb,
    hasActionEntry,
    hasLocalEntry,
} from '../pure/actionLabel';
import { moodText } from '../pure/mood';
import { safeSetIcon } from 'services/safeIcon';
import { applyScrollPref } from 'services/scrollPref';

export interface WhatToWatchOptions {
    /** 全库条目（⛔ 不是当前页签筛过的那份，见 `buildWatchPool` 的注释） */
    entries: readonly MediaEntry[];
    /** 封面解析（宿主注入口，组件不自己拼路径） */
    posterUrl: (e: MediaEntry) => string | undefined;
    /** 「就它了」⇒ 打开条目笔记 */
    onOpenEntry: (id: string) => void;
    /**
     * 封面右下角的播放钮 ⇒ 走宿主的统一主操作入口（`runEntryAction`）。
     *
     * 🔴 为什么注入整个条目而不是 id：宿主的 `runEntryAction(e: MediaEntry)` 需要 type
     *    才能分流（book 阅读 / game 启动 / music 播放 / 其余观看），只给 id 还得再查一次库。
     *   ⚠️ ⑳ ③ 之前这里没有这条 —— 是「改属性」让出来的位置。
     */
    onPlayEntry: (e: MediaEntry) => void;
    /** 可注入的随机源（单测 / 真机探针用） */
    rand?: () => number;
}

export class WhatToWatchModal extends Modal {
    private readonly pool: MediaEntry[];
    private current: MediaEntry | null = null;
    private renderEl: HTMLElement | null = null;

    constructor(
        app: App,
        private readonly opts: WhatToWatchOptions,
    ) {
        super(app);
        this.pool = buildWatchPool(opts.entries);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        this.modalEl.addClass('rl-wtw-modal');
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rl-wtw');
        this.renderEl = contentEl.createDiv({ cls: 'rl-wtw-body' });
        this.current = pickWatchCandidate(this.pool, null, this.opts.rand);
        this.paint();
    }

    onClose(): void {
        this.contentEl.empty();
        this.renderEl = null;
        this.current = null;
    }

    /** 重画整张卡（只有「换一个」会走到；⛔ 不重建 Modal 本身） */
    private paint(): void {
        const host = this.renderEl;
        if (!host) return;
        host.empty();

        const e = this.current;
        if (!e) {
            // 空态：池里一条都没有。⛔ 不造假卡片，也不报错 —— 如实说清门槛。
            // 🔴 m04435 ②：门槛已从「想看 + 评分 ≥ 4」放宽成「全状态、评分不限、**但必须已关联入口**」，
            //    所以空态提示必须换成「没有可播放的条目」—— 再说「想看里没有四星」就是骗人。
            host.createDiv({ cls: 'rl-wtw-empty', text: '这个范围里还没有可播放的条目。' });
            host.createDiv({
                cls: 'rl-wtw-empty-hint',
                // 🔴 m04435 ②：⛔ 别在这里写死那四个字（菜单项文案）—— 本仓铁律「同一概念只准一份文案」，
                //    真源是 `pure/actionLabel` 里那个导出函数，写死就是第二份，迟早漂。
                //    ⚠️ 产物断言 #602① 会数「那四个字」与「带括号调用」两样，**连 `//` 注释也算**
                //    （该判据只剥 `/* */` 块注释）—— 本条注释第一版两样都撞红过一次：⛔ 别在注释里
                //    写出那个函数名加左括号的形态，也别写出那四个字。
                text: '条目要先关联本地文件或网络地址才能抽到；⛔ 状态和评分都不限制。',
            });
            const ops = host.createDiv({ cls: 'rl-wtw-ops' });
            const close = ops.createEl('button', { cls: 'rl-btn', text: '知道了' });
            close.addEventListener('click', () => this.close());
            return;
        }

        const card = host.createDiv({ cls: 'rl-wtw-card' });

        this.paintCover(card, e);
        this.paintInfo(card, e);

        // ── 按钮：整组贴右下角；左「换一个」次按钮，右「就它了」主按钮 ──
        // ⚠️ ⑳ ③ 起「改属性」已删（用户点名），所以这里只剩两枚 —— 顺序仍是
        //    换一个在左、就它了在右（`.rl-wtw-again` 的 `order: 1` 让它在 DOM 顺序之外也能居左）。
        const ops = host.createDiv({ cls: 'rl-wtw-ops' });
        const again = ops.createEl('button', { cls: 'rl-btn rl-wtw-again', text: '换一个' });
        again.setAttribute('data-tip', '再抽一部（不会连续抽到同一部）');
        again.addEventListener('click', () => {
            this.current = pickWatchCandidate(this.pool, this.current?.id ?? null, this.opts.rand);
            this.paint();
        });

        const take = ops.createEl('button', { cls: 'rl-btn mod-cta rl-wtw-take', text: '就它了' });
        take.setAttribute('data-tip', `打开「${e.title}」`);
        take.addEventListener('click', () => {
            const id = e.id;
            this.close();
            // 关闭之后再打开条目：先关能避免 Modal 遮罩与随后弹窗抢焦点
            // （本仓 `ConfirmModal` 头注释记过这条：Electron 原生弹窗与 Modal 关闭动画竞争会失焦）
            window.setTimeout(() => this.opts.onOpenEntry(id), 0);
        });
    }

    /**
     * 封面区：海报（或首字占位）+ **右下角**那枚入口。
     *
     * 🔴 右下角两种形态（用户 m12298 ③「加个播放按钮如有，如没有给加个未关联封面右下角标」）：
     *    有入口 ⇒ 播放圆钮，`data-tip` 用 `actionVerb`（观看 / 阅读 / 启动 / 播放）＋
     *      `actionReadyHint` 那套「实际会发生什么」的说明；
     *    没入口 ⇒ 不可点的「未关联」角标，`data-tip` 用 `actionUnavailableHint` 告诉去哪补。
     * ⚠️ 二者**互斥**，都由 `hasActionEntry` 判 —— ⛔ 别写成「有就叠一个、没有就不画」的 if/else
     *    两段各自算判据（早晚分叉）。
     */
    private paintCover(card: HTMLElement, e: MediaEntry): void {
        const cover = card.createDiv({ cls: 'rl-wtw-cover' });
        const url = this.opts.posterUrl(e);
        if (url) {
            cover.createEl('img', { attr: { src: url, alt: '', loading: 'lazy' } });
        } else {
            // 无海报时给首字占位（与列表卡片同款做法），⛔ 不留空白方框
            cover.createDiv({ cls: 'rl-wtw-cover-ph', text: e.title.slice(0, 2) });
        }

        const ready = hasActionEntry(e);
        if (ready) {
            const play = cover.createEl('button', {
                cls: 'rl-wtw-cover-play',
                attr: {
                    type: 'button',
                    'aria-label': `${actionVerb(e.type)}「${e.title}」`,
                    'data-tip': playTipOf(e),
                },
            });
            safeSetIcon(play, actionIcon(e.type));            play.addEventListener('click', (ev) => {
                // 封面在卡片内层，⛔ 不能让这次点击冒泡去触发「打开笔记」
                ev.preventDefault();
                ev.stopPropagation();
                this.close();
                window.setTimeout(() => this.opts.onPlayEntry(e), 0);
            });
        } else {
            cover.createDiv({
                cls: 'rl-wtw-cover-none',
                text: '未关联',
                attr: { 'data-tip': actionUnavailableHint(e.type) },
            });
        }
    }

    /**
     * 信息区：标题 / 元信息 / 简介 / 个人状态与评价。
     *
     * 🔴 分区顺序照用户点名的先后：「简介要有、个人状态与评价也要放上去」——
     *    简介在前（客观内容），个人状态与评价在后（主观记录）。
     * ⚠️ 两段都**有值才渲染**（⛔ 不留空标题 + 空行）：一张卡上出现「简介」二字却什么都没写，
     *    比不显示更糟 —— 用户会以为数据丢了。
     */
    private paintInfo(card: HTMLElement, e: MediaEntry): void {
        const info = card.createDiv({ cls: 'rl-wtw-info' });
        info.createDiv({ cls: 'rl-wtw-kicker', text: '今天看什么' });
        info.createDiv({ cls: 'rl-wtw-title', text: e.title });
        if (e.originalTitle && e.originalTitle !== e.title) {
            info.createDiv({ cls: 'rl-wtw-orig', text: e.originalTitle });
        }

        // ── 元信息：年份 / 类型 / 导演（评分与状态挪进下面的「个人状态与评价」，
        //    否则同一张卡上会各出现一次）──
        const metas = info.createDiv({ cls: 'rl-wtw-metas' });
        if (e.year) metas.createSpan({ cls: 'rl-wtw-year', text: String(e.year) });
        if (e.genres && e.genres.length > 0) {
            metas.createSpan({ cls: 'rl-wtw-genres', text: e.genres.slice(0, 3).join(' / ') });
        }
        if (e.director) metas.createSpan({ cls: 'rl-wtw-dir', text: e.director });

        // ── 简介（`summary` 是本仓既有的「简介」字段，搜索回填时就有；
        //     `aiSummary` 是 AI 生成的另一份，⛔ 别混用：用户要的是条目自己的简介）──
        const summary = (e.summary ?? '').trim();
        if (summary) {
            const box = info.createDiv({ cls: 'rl-wtw-block rl-wtw-summary' });
            box.createDiv({ cls: 'rl-wtw-block-label', text: '简介' });
            box.createDiv({ cls: 'rl-wtw-block-text', text: summary });
        }

        // ── 个人状态与评价：状态 / 评分 / 心情 / 个人评语 ──
        // 🔴 四项各自可缺（除状态外都不一定有值）：⛔ 别写成一排固定格子，
        //    空值会留下空洞标签（「评分：」后面啥也没有）。
        const rating = normalizeRating(e.rating);
        const moodTextValue = moodText(e.mood);
        const notes = (e.notes ?? '').trim();
        const feel = info.createDiv({ cls: 'rl-wtw-block rl-wtw-feel' });
        feel.createDiv({ cls: 'rl-wtw-block-label', text: '个人状态与评价' });
        const chips = feel.createDiv({ cls: 'rl-wtw-chips' });
        chips.createSpan({ cls: 'rl-wtw-chip', text: statusLabel(e.type, e.status) });
        if (rating > 0) {
            // ⚠️ 用 `starString` 的纯文本星（这里是一张静态卡，不需要 CSS 按比例裁切那套）
            chips.createSpan({ cls: 'rl-wtw-chip rl-wtw-rating', text: `${starString(rating)} ${rating}` });
        }
        if (moodTextValue) {
            // 心情（#772 新增六档）：`moodText` 已拼成「🤩 震撼」，⛔ 别在这里再拼一次 emoji
            chips.createSpan({ cls: 'rl-wtw-chip rl-wtw-mood', text: moodTextValue, attr: { 'data-tip': '心情（不参与任何数值计算）' } });
        }
        if (notes) {
            feel.createDiv({ cls: 'rl-wtw-block-text rl-wtw-notes', text: notes });
        }
    }
}

/**
 * 🔴 用仓库既有 `actionReadyHint(type, hasLocal)` 拼提示，⛔ 不自己再写一套
 *    「（本地文件）/（网络地址）」—— 那正是 `actionLabel` 头注释里 #535 记的
 *    「只填了网络地址却说打开本地文件」那个坑。
 */
function playTipOf(e: MediaEntry): string {
    return actionReadyHint(e.type, hasLocalEntry(e));
}
