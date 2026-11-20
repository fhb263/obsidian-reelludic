// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Obsidian 给 DOM 挂了一批扩展方法（`createDiv` / `createEl` / `addClass` / `toggleClass` / `setText` …），
 * jsdom 本身**没有**这些 —— 不补就是清一色 `is not a function`。
 *
 * ⚠️ 只在本文件补，不升格成全局 setup：
 *    测试替身越多，越容易掩盖「真实环境里其实没有这个方法」的问题。
 *    （`tests/mocks/obsidian.ts` 只管 obsidian **模块**导出，不管 DOM 原型。）
 */
function patchDom(): void {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.createDiv !== 'function') {
        proto.createDiv = function (this: HTMLElement, o?: { cls?: string }) {
            const d = document.createElement('div');
            if (o?.cls) d.className = o.cls;
            this.appendChild(d);
            return d;
        };
        proto.createSpan = function (this: HTMLElement, o?: { cls?: string; text?: string }) {
            const s = document.createElement('span');
            if (o?.cls) s.className = o.cls;
            if (o?.text !== undefined) s.textContent = o.text;
            this.appendChild(s);
            return s;
        };
        // 🔴 `createEl` 是 Obsidian 的扩展（卡片里的按钮靠它建），jsdom 没有。
        //    ⛔ 不要为了绕开这一点在服务层改用 `document.createElement` ——
        //    那样卡片就不认主题与 Obsidian 的按钮语义了，等于为测试改产品。
        proto.createEl = function (this: HTMLElement, tag: string, o?: { cls?: string; text?: string }) {
            const el = document.createElement(tag);
            if (o?.cls) el.className = o.cls;
            if (o?.text !== undefined) el.textContent = o.text;
            this.appendChild(el);
            return el;
        };
        proto.addClass = function (this: HTMLElement, c: string) {
            this.classList.add(c);
        };
        proto.removeClass = function (this: HTMLElement, c: string) {
            this.classList.remove(c);
        };
        proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
            this.classList.toggle(c, on);
        };
        proto.setText = function (this: HTMLElement, t: string) {
            this.textContent = t;
        };
        proto.empty = function (this: HTMLElement) {
            while (this.firstChild) this.removeChild(this.firstChild);
        };
    }
}
patchDom();

import { destroyProgressBall, startProgressBall } from 'services/progressBall';

/**
 * 悬浮进度**卡片**的服务层（真 DOM / jsdom）。
 *
 * ⚠️ 为什么纯函数单测不够：`pure/progressBall` 只测了文案与比例，
 *    但「卡片真的挂到 body 上了吗 / 点一下到底发生了什么 / 关掉后节点真的摘了吗」
 *    这三类错在 tsc 与纯单测里都看不见（本仓被「指针悬空继续写」坑过）。
 *
 * 🔴 本文件最重要的一组：`describe('点击不再销毁（m10634）')` ——
 *    m01938 当初把「点球 = 收起」写成规格，落到实现里是 `dismiss()`；
 *    一旦它承担十几分钟的下载任务，点一下就没了等于**把唯一的进度入口消耗掉**。
 *    那组断言就是防它退回去。
 */

/** 拿到 body 上当前那张卡片 */
function ballEl(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('.rl-pball');
}

beforeEach(() => {
    // jsdom 的 body 是共享的：每条用例前把上一条的残留清干净（`empty` 上面补过）
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

afterEach(() => {
    destroyProgressBall();
    vi.useRealTimers();
});

describe('进度卡片挂载', () => {
    it('挂到 document.body 上（不是某个视图容器）—— 这样切笔记才不会被一起卸掉', () => {
        startProgressBall('正在本地识别');
        const el = ballEl();
        expect(el).not.toBeNull();
        expect(el?.parentElement).toBe(document.body);
    });

    it('带 role=status + aria-live=polite 播报阶段变化', () => {
        startProgressBall('正在识别');
        const el = ballEl();
        expect(el?.getAttribute('role')).toBe('status');
        expect(el?.getAttribute('aria-live')).toBe('polite');
    });

    it('⛔ 容器不同时写 aria-label —— 与 data-tip 并存会叠双层气泡', () => {
        startProgressBall('正在识别');
        const el = ballEl();
        expect(el?.hasAttribute('data-tip')).toBe(true);
        expect(el?.hasAttribute('aria-label')).toBe(false);
    });

    it('首屏是展开态卡片，标题/进度条/百分比都在（不依赖后续 update）', () => {
        startProgressBall('正在识别');
        const el = ballEl() as HTMLElement;
        expect(el.classList.contains('is-card')).toBe(true);
        expect(el.querySelector('.rl-pball-card')).not.toBeNull();
        expect(el.querySelector('.rl-pball-bar')).not.toBeNull();
        expect(el.querySelector('.rl-pball-title')?.textContent).toContain('正在识别');
        // 无百分比 ⇒ 百分比位是省略号，⛔ 不是 0%
        expect(el.querySelector('.rl-pball-pct')?.textContent).toBe('…');
    });

    it('无百分比时进度条走不确定态（跑马灯），⛔ 不画一个停在 0 的条', () => {
        startProgressBall('正在准备');
        const bar = ballEl()?.querySelector('.rl-pball-bar');
        expect(bar?.classList.contains('is-indet')).toBe(true);
    });

    it('有百分比时退出不确定态并写宽度', () => {
        const ball = startProgressBall('下载中');
        ball.update({ percent: 40 });
        const bar = ballEl()?.querySelector('.rl-pball-bar') as HTMLElement;
        const fill = ballEl()?.querySelector('.rl-pball-fill') as HTMLElement;
        expect(bar.classList.contains('is-indet')).toBe(false);
        expect(fill.style.width).toBe('40%');
    });
});

describe('进度卡片更新', () => {
    it('update 写百分比 / 阶段 / 细节，且 tooltip 是全文', () => {
        const ball = startProgressBall('正在本地识别');
        ball.update({ label: '正在本地识别', percent: 42, detail: '1:20 / 5:00' });
        const el = ballEl() as HTMLElement;
        expect(el.querySelector('.rl-pball-pct')?.textContent).toBe('42%');
        expect(el.querySelector('.rl-pball-detail')?.textContent).toBe('1:20 / 5:00');
        expect(el.querySelector('.rl-pball-title')?.textContent).toBe('正在本地识别');
        expect(el.getAttribute('data-tip')).toBe('正在本地识别 · 1:20 / 5:00 · 42%');
    });

    it('省的项保持原值（只传 percent 不会把 label 清空）', () => {
        const ball = startProgressBall('正在下载');
        ball.update({ percent: 10 });
        ball.update({ percent: 20 });
        expect(ballEl()?.querySelector('.rl-pball-title')?.textContent).toBe('正在下载');
        expect(ballEl()?.querySelector('.rl-pball-pct')?.textContent).toBe('20%');
    });

    it('收起态小球上的阶段名被截短但 tooltip 是全文', () => {
        // ⚠️ 必须真的超过 14 字上限（等于上限是不截断的，别拿刚好 14 字的文案当反例）
        const long = '正在把音频切成小段并逐段送进本地引擎识别';
        const ball = startProgressBall(long);
        ball.update({ percent: 5 });
        const shown = ballEl()?.querySelector('.rl-pball-lbl')?.textContent ?? '';
        expect(shown.endsWith('…')).toBe(true);
        expect(shown.length).toBeLessThan(long.length);
        expect(ballEl()?.getAttribute('data-tip')).toContain(long);
    });

    it('收起态的环随百分比推进（100% 时走满）', () => {
        const ball = startProgressBall('下载中');
        ball.update({ percent: 0 });
        const arc = () => ballEl()?.querySelector('.rl-pball-arc')?.getAttribute('stroke-dashoffset');
        const at0 = Number(arc());
        ball.update({ percent: 50 });
        const at50 = Number(arc());
        ball.update({ percent: 100 });
        expect(Number(arc())).toBeCloseTo(0, 6);
        expect(at50).toBeLessThan(at0);
    });

    // 🔴 m20696（用户：「从B站下载音频那个进度浮球在转写成mp3时怎么不能循环转圈一周，这样观感会更好」）
    //   转码 / 抽轨没有百分比，原来只是把弧停在 18% 弧长 —— 静止的短弧看起来是「卡死」。
    describe('🔴 m20696 无百分比时环要连转', () => {
        const ring = () => ballEl()?.querySelector('.rl-pball-ring');

        it('起始（无百分比）⇒ 环挂 is-indet', () => {
            startProgressBall('正在转写成 mp3');
            expect(ring()?.classList.contains('is-indet')).toBe(true);
        });

        it('拿到百分比 ⇒ 退出 is-indet（转圈是「还在忙」，有数了就不该再转）', () => {
            const ball = startProgressBall('正在转写成 mp3');
            ball.update({ percent: 42 });
            expect(ring()?.classList.contains('is-indet')).toBe(false);
        });

        it('百分比又变回 null（切到下一个无进度阶段）⇒ 重新连转', () => {
            const ball = startProgressBall('下载中');
            ball.update({ percent: 60 });
            ball.update({ percent: null, label: '正在转写成 mp3' });
            expect(ring()?.classList.contains('is-indet')).toBe(true);
        });

        it('🔴 收尾必须停转（任务结束了还转 = 骗人）', () => {
            const ball = startProgressBall('正在转写成 mp3');
            expect(ring()?.classList.contains('is-indet')).toBe(true);
            ball.done('已完成');
            expect(ring()?.classList.contains('is-indet')).toBe(false);
        });

        // ⚠️ 多任务走的是另一条路（`paintTasks`），必须先有百分比再灌任务，
        //    否则起始态本来就是 is-indet，判不出 `paintTasks` 到底有没有更新环。
        it('🔴 多任务路径也要更新环（`paintTasks` 里漏掉就只剩单任务会转）', () => {
            const ball = startProgressBall('正在下载');
            ball.update({ percent: 80 });
            expect(ring()?.classList.contains('is-indet')).toBe(false);
            ball.upsertTask?.({ id: 'a', title: 'A', percent: 50, phase: 'running' });
            ball.upsertTask?.({ id: 'b', title: 'B', percent: 60, phase: 'running' });
            expect(ring()?.classList.contains('is-indet')).toBe(false);
            // 其中一行没有百分比 ⇒ 汇总是 null（口径见 pure/progressTasks）⇒ 环重新连转
            ball.upsertTask?.({ id: 'b', title: 'B', percent: null, phase: 'running' });
            expect(ring()?.classList.contains('is-indet')).toBe(true);
        });

        it('不定态时弧长恒定（转的是整圈，⛔ 别让 dashoffset 抖动）', () => {
            const ball = startProgressBall('正在转写成 mp3');
            const arc = () => ballEl()?.querySelector('.rl-pball-arc')?.getAttribute('stroke-dashoffset');
            const first = arc();
            ball.update({ label: '正在转写成 mp3（换文案）' });
            expect(arc()).toBe(first);
            // 且不是「走满」或「空」——18% 弧长的 dashoffset 应落在中间段
            const c = 2 * Math.PI * 16;
            expect(Number(first)).toBeGreaterThan(0);
            expect(Number(first)).toBeLessThan(c);
        });
    });
});

describe('点击不再销毁（m10634）', () => {
    it('🔴 点一下卡片 ⇒ 收起成小球，节点仍在（不是消失）', () => {
        startProgressBall('正在下载模型');
        const el = ballEl() as HTMLElement;
        el.click();
        expect(ballEl()).not.toBeNull();
        expect(ballEl()).toBe(el);
        expect(el.classList.contains('is-pill')).toBe(true);
        expect(el.classList.contains('is-card')).toBe(false);
    });

    it('🔴 再点一下 ⇒ 展开回卡片，节点还是那一个', () => {
        startProgressBall('正在下载模型');
        const el = ballEl() as HTMLElement;
        el.click();
        el.click();
        expect(el.classList.contains('is-card')).toBe(true);
        expect(el.classList.contains('is-pill')).toBe(false);
        // ⛔ 不许重建节点：重画会丢进度条过渡与滚动锚点
        expect(ballEl()).toBe(el);
    });

    it('收起后继续 update 仍然生效（任务没被点断）', () => {
        const ball = startProgressBall('正在下载模型');
        (ballEl() as HTMLElement).click();
        ball.update({ percent: 77 });
        expect(ballEl()?.querySelector('.rl-pball-pct')?.textContent).toBe('77%');
        expect(ballEl()?.classList.contains('is-pill')).toBe(true);
    });

    it('收起按钮带「任务继续」的文案，别让用户以为点掉就中止了', () => {
        startProgressBall('正在下载模型');
        const min = ballEl()?.querySelector('.rl-pball-min') as HTMLElement;
        // 🔴 2026-11-12（用户 m00353 ①-9）：读屏名从 `aria-label` 改成 `.rl-sr` 隐藏文本。
        //    原因：`aria-label` 与 `data-tip` 同时挂会让同一颗按钮 hover 出**两层气泡**
        //    （Obsidian 会给带 aria-label 的目标自绘官方气泡）。
        expect(min.querySelector('.rl-sr')?.textContent).toContain('任务继续');
        expect(min.hasAttribute('aria-label')).toBe(false);
        expect(min.getAttribute('data-tip')).toContain('任务继续');
    });

    it('收起按钮与卡片本体的点击互不连带（stopPropagation）', () => {
        startProgressBall('正在下载模型');
        const min = ballEl()?.querySelector('.rl-pball-min') as HTMLElement;
        min.click();
        const el = ballEl() as HTMLElement;
        // 收起按钮把它切到 pill 后，事件不该再冒泡到容器把 mode 切回来
        expect(el.classList.contains('is-pill')).toBe(true);
    });
});

describe('取消要二次确认', () => {
    it('没传 onCancel 时不画取消按钮（取消入口在别处，两处都能停会打架）', () => {
        startProgressBall('正在识别');
        expect(ballEl()?.querySelector('.rl-pball-cancel')).toBeNull();
    });

    it('第一次点只是「上膛」，不触发回调', () => {
        const onCancel = vi.fn();
        startProgressBall('正在下载模型', { onCancel });
        const cancel = ballEl()?.querySelector('.rl-pball-cancel') as HTMLElement;
        cancel.click();
        expect(onCancel).not.toHaveBeenCalled();
        expect(cancel.classList.contains('is-armed')).toBe(true);
        expect(cancel.textContent).toContain('确认');
    });

    it('第二次点才真取消', () => {
        const onCancel = vi.fn();
        startProgressBall('正在下载模型', { onCancel });
        const cancel = ballEl()?.querySelector('.rl-pball-cancel') as HTMLElement;
        cancel.click();
        cancel.click();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('上膛后 4 秒内没再点就自动撤回（防误触后一直等着）', () => {
        vi.useFakeTimers();
        const onCancel = vi.fn();
        startProgressBall('正在下载模型', { onCancel });
        const cancel = ballEl()?.querySelector('.rl-pball-cancel') as HTMLElement;
        cancel.click();
        expect(cancel.classList.contains('is-armed')).toBe(true);
        vi.advanceTimersByTime(4100);
        expect(cancel.classList.contains('is-armed')).toBe(false);
        cancel.click();
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('取消按钮不会连带切换展开态', () => {
        const onCancel = vi.fn();
        startProgressBall('正在下载模型', { onCancel });
        const cancel = ballEl()?.querySelector('.rl-pball-cancel') as HTMLElement;
        cancel.click();
        expect(ballEl()?.classList.contains('is-card')).toBe(true);
    });
});

describe('收尾与清场', () => {
    it('done 切到完成态，收尾后 update 不再生效', () => {
        const ball = startProgressBall('下载中');
        ball.done('成功 12 个');
        const el = ballEl() as HTMLElement;
        expect(el.classList.contains('is-done')).toBe(true);
        expect(el.getAttribute('data-tip')).toBe('完成：成功 12 个');
        expect(el.querySelector('.rl-pball-title')?.textContent).toBe('完成：成功 12 个');
        // 收尾后迟到的 update 不许把「完成」改回「正在…」
        ball.update({ label: '还在下', percent: 30 });
        expect(el.querySelector('.rl-pball-title')?.textContent).toBe('完成：成功 12 个');
    });

    it('收尾时从收起态强制展开成卡片（结果要让用户看见，⛔ 别缩成球再消失）', () => {
        const ball = startProgressBall('下载中');
        (ballEl() as HTMLElement).click();
        expect(ballEl()?.classList.contains('is-pill')).toBe(true);
        ball.done();
        expect(ballEl()?.classList.contains('is-card')).toBe(true);
    });

    it('收尾态不再有动作按钮（没东西可取消/收起）', () => {
        const ball = startProgressBall('下载中', { onCancel: () => undefined });
        ball.done();
        expect(ballEl()?.querySelector('.rl-pball-cancel')).toBeNull();
        expect(ballEl()?.querySelector('.rl-pball-min')).toBeNull();
    });

    it('fail 切到失败态并保留错误原文', () => {
        const ball = startProgressBall('识别中');
        ball.fail('引擎未配置');
        const el = ballEl() as HTMLElement;
        expect(el.classList.contains('is-fail')).toBe(true);
        expect(el.getAttribute('data-tip')).toBe('失败：引擎未配置');
    });

    it('done 后到点自毁（不留孤儿节点）', () => {
        vi.useFakeTimers();
        const ball = startProgressBall('下载中');
        ball.done();
        expect(ballEl()).not.toBeNull();
        vi.advanceTimersByTime(3000);
        expect(ballEl()).toBeNull();
    });

    it('收尾态点一下才等于关掉（那时没东西可跑，留着碍事）', () => {
        const ball = startProgressBall('下载中');
        ball.done();
        (ballEl() as HTMLElement).click();
        expect(ballEl()).toBeNull();
    });

    it('dismiss 立刻摘节点', () => {
        const ball = startProgressBall('下载中');
        expect(ballEl()).not.toBeNull();
        ball.dismiss();
        expect(ballEl()).toBeNull();
    });

    it('单例：起第二个时旧的被接管（不会叠两张）', () => {
        startProgressBall('任务一');
        startProgressBall('任务二');
        expect(document.body.querySelectorAll('.rl-pball').length).toBe(1);
        expect(ballEl()?.querySelector('.rl-pball-title')?.textContent).toContain('任务二');
    });

    it('destroyProgressBall 幂等：连调两次不抛', () => {
        startProgressBall('下载中');
        destroyProgressBall();
        destroyProgressBall();
        expect(ballEl()).toBeNull();
    });
});
