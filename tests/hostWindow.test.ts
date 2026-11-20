// @vitest-environment node
// 独立窗口承载（用户 m17697：「为什么不能改成微信读书式浏览器弹窗」）。
//
// 🔴 这条需求的真本体不是「加拖动代码」，而是**别自己造窗口**：
//    微信读书那一档是 `new BrowserWindow(...)`，标题栏拖动/缩放/最大化全由系统给。
//    所以这里的测试守的是「真窗口优先 + 拿不到才降级」，而不是拖拽算术。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    hostWindowBounds,
    hostWindowReusable,
    hostWindowTitle,
    HOST_WINDOW_DEFAULT_HEIGHT,
    HOST_WINDOW_DEFAULT_WIDTH,
    HOST_WINDOW_EDGE,
    HOST_WINDOW_MIN_HEIGHT,
    HOST_WINDOW_MIN_WIDTH,
} from '../src/pure/hostWindow';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');
/** 剥注释：反向守卫必须只看代码，注释里常逐字引用反面教材 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

const WORK: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: 1920,
    height: 1040,
};

describe('窗口标题', () => {
    it('有搜索词时带前缀', () => {
        expect(hostWindowTitle('三体')).toBe('百度搜索：三体');
    });

    it('空搜索词只留前缀（⛔ 别出现「百度搜索：」后面空着）', () => {
        expect(hostWindowTitle('')).toBe('百度搜索');
        expect(hostWindowTitle('   ')).toBe('百度搜索');
        expect(hostWindowTitle('\u3000\u3000')).toBe('百度搜索');
    });

    it('折空白 + 超长截断（系统标题栏放不下）', () => {
        expect(hostWindowTitle('三体   刘慈欣')).toBe('百度搜索：三体 刘慈欣');
        const long = 'x'.repeat(200);
        const title = hostWindowTitle(long);
        expect(title.endsWith('…')).toBe(true);
        expect(title.length).toBeLessThan(80);
    });
});

describe('窗口矩形（setBounds 用）', () => {
    it('🔴 必须居中，不能落在 {0,0}（左上角会被任务栏/菜单栏压住）', () => {
        const b = hostWindowBounds({ width: 900, height: 720 }, WORK);
        expect(b.x).toBeGreaterThan(0);
        expect(b.y).toBeGreaterThan(0);
        // 居中：两侧留白相等（允许 1px 取整误差）
        expect(Math.abs(b.x - (WORK.width - b.width) / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.y - (WORK.height - b.height) / 2)).toBeLessThanOrEqual(1);
    });

    it('窗口比工作区还大时夹到「工作区 - 2×留白」', () => {
        const b = hostWindowBounds({ width: 9999, height: 9999 }, WORK);
        expect(b.width).toBe(WORK.width - HOST_WINDOW_EDGE * 2);
        expect(b.height).toBe(WORK.height - HOST_WINDOW_EDGE * 2);
        // 夹完仍要在工作区内
        expect(b.x).toBeGreaterThanOrEqual(WORK.x);
        expect(b.y).toBeGreaterThanOrEqual(WORK.y);
        expect(b.x + b.width).toBeLessThanOrEqual(WORK.x + WORK.width);
        expect(b.y + b.height).toBeLessThanOrEqual(WORK.y + WORK.height);
    });

    it('比下限还小的请求被抬到下限（不然窗口不可用）', () => {
        const b = hostWindowBounds({ width: 100, height: 100 }, WORK);
        expect(b.width).toBe(HOST_WINDOW_MIN_WIDTH);
        expect(b.height).toBe(HOST_WINDOW_MIN_HEIGHT);
    });

    it('多屏偏移也要保住（工作区 x/y 不是 0 时照样居中）', () => {
        const second = { x: 1920, y: -200, width: 1280, height: 1024 };
        const b = hostWindowBounds({ width: 800, height: 600 }, second);
        expect(b.x).toBeGreaterThanOrEqual(second.x);
        expect(b.x + b.width).toBeLessThanOrEqual(second.x + second.width);
        expect(b.y).toBeGreaterThanOrEqual(second.y);
    });

    it('🔴 拿不到工作区时只给宽高、x/y 归零（⛔ 别瞎猜居中坐标，多屏会算到屏外）', () => {
        const b = hostWindowBounds({ width: 900, height: 720 }, null);
        expect(b).toEqual({ x: 0, y: 0, width: 900, height: 720 });
    });

    it('脏尺寸（NaN / 0 / 负数）退回默认值', () => {
        const b = hostWindowBounds({ width: Number.NaN, height: 0 }, WORK);
        expect(b.width).toBe(HOST_WINDOW_DEFAULT_WIDTH);
        expect(b.height).toBe(HOST_WINDOW_DEFAULT_HEIGHT);
    });

    it('不传尺寸时用默认档', () => {
        const b = hostWindowBounds({}, WORK);
        expect(b.width).toBe(HOST_WINDOW_DEFAULT_WIDTH);
        expect(b.height).toBe(HOST_WINDOW_DEFAULT_HEIGHT);
    });

    it('工作区不可用（宽 0 / NaN）按「拿不到」处理', () => {
        expect(hostWindowBounds({ width: 900, height: 720 }, { x: 0, y: 0, width: 0, height: 1040 }).x).toBe(0);
        expect(
            hostWindowBounds({ width: 900, height: 720 }, { x: 0, y: 0, width: Number.NaN, height: 1040 }).x,
        ).toBe(0);
    });
});

describe('复用已有窗口', () => {
    it('没被销毁 ⇒ 复用（每点一次开一个窗比挡住半屏更难受）', () => {
        expect(hostWindowReusable(false)).toBe(true);
        expect(hostWindowReusable(undefined)).toBe(true);
    });

    it('已销毁 ⇒ 不复用（不能往尸体上 loadURL）', () => {
        expect(hostWindowReusable(true)).toBe(false);
    });
});

describe('装配：真窗口优先，拿不到才降级 Modal', () => {
    const modal = read('src/modals/BaiduSearchModal.ts');

    it('统一出口先试独立窗口', () => {
        const code = stripComments(modal);
        const iWin = code.indexOf('if (hostWindowAvailable())');
        const iOpen = code.indexOf('openHostWindow({');
        const iFallback = code.indexOf('new BaiduSearchModal(app, opts).open()');
        expect(iWin).toBeGreaterThan(-1);
        expect(iOpen).toBeGreaterThan(iWin);
        // 降级必须在真窗口尝试之后
        expect(iFallback).toBeGreaterThan(iOpen);
    });

    it('🔴 降级路径必须存在（非桌面端 / 被裁掉 remote 时不能让「点了没反应」）', () => {
        const code = stripComments(modal);
        expect(code).toContain('new BaiduSearchModal(app, opts).open()');
    });

    it('复用同站窗口（reuse: true）', () => {
        const code = stripComments(modal);
        expect(code).toContain('reuse: true');
    });

    it('标题走 hostWindowTitle（口径唯一）', () => {
        const code = stripComments(modal);
        expect(code).toContain('title: hostWindowTitle(query)');
    });
});

describe('装配：服务层的硬约束', () => {
    const svc = read('src/services/hostWindow.ts');

    it('🔴 构造参数不可信，必须补 setBounds（实测传 900×700 得到 800×600）', () => {
        const code = stripComments(svc);
        expect(code).toContain('win.setBounds?.(bounds)');
        // 反向守卫：不许只靠构造参数就以为尺寸对
        expect(code).not.toMatch(/return wrap\(win\);\s*\n\s*\}\)/);
        // bounds 必须来自 hostWindowBounds（唯一算术真源）
        expect(code).toContain('hostWindowBounds(');
    });

    it('require 走 window.require（模块级 require 被 Obsidian CSP 挡）', () => {
        const code = stripComments(svc);
        expect(code).toContain('(window as unknown as { require?: (m: string) => unknown }).require');
        expect(code).not.toMatch(/^import .*from '@electron\/remote'/m);
    });

    it('loadURL 的 reject 必须吞掉（ERR_ABORTED 不是失败）', () => {
        const code = stripComments(svc);
        expect(code).toContain('.catch?.(() => undefined)');
        // ⛔ 不许 await 它
        expect(code).not.toContain('await win.loadURL');
    });

    it('最小化时先 restore 再 show（否则点开看着像没反应）', () => {
        const code = stripComments(svc);
        expect(code).toContain('win.isMinimized?.()');
        expect(code).toContain('win.restore?.()');
    });

    it('复用判据按 host 前缀而不是整条 URL（每次 wd= 都不同）', () => {
        // ⚠️ 这里必须用原文而不是 stripComments：URL 拼接里的 `//` 会被当注释切掉
        expect(svc).toContain('const u = new URL(opts.url);');
        expect(svc).toContain('prefix = `${u.protocol}//${u.host}`');
        expect(svc).toContain('findWindowByUrlPrefix(prefix)');
        // 反向守则仍跑剥注释版：判断逻辑本身不许出现「整条 URL 相等」
        const code = stripComments(svc);
        expect(code).not.toContain('=== opts.url');
    });

    it('网页窗口不给 node 能力', () => {
        const code = stripComments(svc);
        expect(code).toContain('nodeIntegration: false');
        expect(code).toContain('contextIsolation: true');
    });

    it('拿不到 remote 返 null（调用方要明说，⛔ 不静默）', () => {
        const code = stripComments(svc);
        expect(code).toContain('if (!BW) return null;');
    });
});

describe('两条路径不会互相顶掉', () => {
    it('Modal 版仍在（兜底），且仍走本仓唯一承载层', () => {
        const modal = stripComments(read('src/modals/BaiduSearchModal.ts'));
        expect(modal).toContain('mountEmbedHost(stage');
        expect(modal).toContain('export class BaiduSearchModal extends Modal');
    });

    it('self-written 拖动只属于 Modal 兜底，主路径不碰它', () => {
        const modal = stripComments(read('src/modals/BaiduSearchModal.ts'));
        // attachDrag / attachResize 只在 Modal 类里
        expect(modal).toContain('private attachDrag(');
        expect(modal).toContain('private attachResize(');
        // 统一出口不引用它们（真窗口不需要自写拖动）
        const tail = modal.slice(modal.indexOf('export function openBaiduSearchModal'));
        expect(tail).not.toContain('attachDrag');
        expect(tail).not.toContain('attachResize');
    });
});
