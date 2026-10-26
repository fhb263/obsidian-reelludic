/**
 * 真机检测器（assert 用）：全部在**真 Obsidian 窗口内**求值，返回可读结论。
 *
 * 🔴 与「复现页 + 截图肉眼看」的区别：这里读的是**真机计算样式 / 真 DOM 几何**，
 *    能直接断言「对齐偏差 2px」「元素被裁」「文字折行」「主题变量是否生效」这类
 *    单测与 tsc 都看不见的问题。
 *
 * 约定：每个 detector 返回 { name, ok, detail } 或 { name, ok:false, detail }，
 *      多条检查可返回数组；`rd check` 统一渲染成 PASS/FAIL 行。
 */
'use strict';

const VIEW = 'reelludic-home';

/** 视口尺寸与缩放（真机窗口，不是模拟） */
async function viewport(c) {
    if (!c._viewport) {
        // 真机窗口可被用户/系统缩放改动 ⇒ 一次调用内固定下来
        c._viewport = await c.eval(`({
            w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio,
            scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
            theme: document.body.className,
        })`);
    }
    return c._viewport;
}

/** 主视图结构：根节点挂载 / 当前页签 / 内容区高度 */
async function viewStructure(c) {
    const r = await c.eval(`(async () => {
        const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(VIEW)})[0];
        if (!leaf) return { ok: false, reason: '主视图未打开' };
        const root = leaf.view.containerEl;
        const view = root.querySelector('.rl-home');
        if (!view) return { ok: false, reason: 'Svelte 根节点 .rl-home 未挂载（插件可能加载失败）' };
        const tab = root.querySelector('.rl-tabs button.on') || root.querySelector('[role="tab"][aria-selected="true"]');
        const body = root.querySelector('#rl-home-tabpanel');
        const br = body ? body.getBoundingClientRect() : null;
        const sr = view.getBoundingClientRect();
        return {
            ok: true,
            rootClass: view.className,
            activeTab: tab ? (tab.id || '').replace('rl-tab-', '') : null,
            activeTabLabel: tab ? tab.textContent.trim() : null,
            tabIds: Array.from(root.querySelectorAll('[role="tab"]')).map(e => e.id.replace('rl-tab-','')),
            rootSize: { w: Math.round(sr.width), h: Math.round(sr.height) },
            bodySize: br ? { w: Math.round(br.width), h: Math.round(br.height) } : null,
            textLen: view.innerText.trim().length,
            cards: root.querySelectorAll('.rl-card').length,
        };
    })()`);
    return { name: '主视图结构', points: [
        ['Svelte 根节点已挂载', r.ok, r.reason || r.rootClass],
        ['有文字内容', r.ok && r.textLen > 50, r.ok ? `${r.textLen} 字符` : ''],
        ['内容区高度 > 100px', r.ok && !!r.bodySize && r.bodySize.h > 100, r.ok && r.bodySize ? `${r.bodySize.w}×${r.bodySize.h}` : ''],
    ], raw: r };
}

/** 元素溢出 / 被裁：布局最常翻车的面 */
async function overflow(c, selector) {
    const r = await c.eval(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        if (!els.length) return { found: 0 };
        const bad = [];
        for (const el of els) {
            const b = el.getBoundingClientRect();
            const parent = el.parentElement;
            const pb = parent ? parent.getBoundingClientRect() : null;
            const ox = Math.round(el.scrollWidth - el.clientWidth);
            const oy = Math.round(el.scrollHeight - el.clientHeight);
            const escaped = pb && (b.left < pb.left - 1 || b.right > pb.right + 1 || b.top < pb.top - 1 || b.bottom > pb.bottom + 1);
            if (ox > 1 || oy > 1 || escaped) {
                bad.push({ cls: el.className.toString().slice(0, 60), text: (el.innerText||'').trim().slice(0, 30),
                    over: [ox, oy], escaped, rect: [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)] });
            }
        }
        return { found: els.length, bad: bad.slice(0, 8), badCount: bad.length };
    })()`);
    return { name: `溢出/越界: ${selector}`, points: [
        ['元素存在', r.found > 0, `${r.found} 个`],
        ['无溢出且未越出父容器', r.found > 0 && r.badCount === 0, r.badCount ? `${r.badCount} 个异常` : ''],
    ], raw: r };
}

/** 对齐：一组元素的左缘 / 右缘是否共用同一条线 */
async function alignment(c, selector, axis = 'left', tolerance = 1) {
    const r = await c.eval(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        if (els.length < 2) return { found: els.length, keys: [] };
        const keys = els.map(el => {
            const b = el.getBoundingClientRect();
            return ${JSON.stringify(axis)} === 'left' ? Math.round(b.left * 10) / 10
                 : ${JSON.stringify(axis)} === 'right' ? Math.round(b.right * 10) / 10
                 : Math.round((b.left + b.width / 2) * 10) / 10;
        });
        return { found: els.length, keys };
    })()`);
    const uniq = [...new Set(r.keys)].sort((a, b) => a - b);
    const spread = uniq.length ? uniq[uniq.length - 1] - uniq[0] : 0;
    return { name: `对齐(${axis}): ${selector}`, points: [
        ['至少两个元素可比', r.found >= 2, `${r.found} 个`],
        [`${axis} 偏差 ≤ ${tolerance}px`, r.found >= 2 && spread <= tolerance, `实测跨度 ${spread}px，取值 [${uniq.slice(0, 6).join(', ')}]`],
    ], raw: r };
}

/** 计算样式：确认某条 CSS 真的作用到了（级联被覆盖时最有用） */
async function computed(c, selector, props) {
    const r = await c.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const cs = getComputedStyle(el);
        const out = {};
        for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
        return out;
    })()`);
    const pts = [['元素存在', !!r, selector]];
    if (r) for (const p of props) pts.push([p, true, r[p] || '(空)']);
    return { name: `计算样式: ${selector}`, points: pts, raw: r };
}

/**
 * 主题变量生效性：插件样式大量依赖 Obsidian 的 `--background-primary` 等变量。
 * 深色模式下若某处写死了浅色值，这里能直接抓到。
 */
async function themeTokens(c) {
    const r = await c.eval(`(() => {
        const cs = getComputedStyle(document.body);
        const grab = (v) => (cs.getPropertyValue(v) || '').trim();
        // 🔴 主题变量可能给 rgb()/rgba()，也可能给 hex（实测 --background-primary 在浅色下就是 #ffffff）
        //    ⇒ 两种都要解析，否则亮度恒为 n/a，那条检查等于没做。
        const parseColor = (s) => {
            if (!s) return null;
            let m = s.match(/rgba?\\(([^)]+)\\)/);
            if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return { r: p[0], g: p[1], b: p[2] }; }
            m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (m) {
                let h = m[1];
                if (h.length === 3) h = h.split('').map(x => x + x).join('');
                return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
            }
            return null;
        };
        const lum = (rgb) => rgb ? (0.2126*rgb.r + 0.7152*rgb.g + 0.0722*rgb.b) / 255 : null;
        const bg = parseColor(grab('--background-primary'));
        return { isDark: document.body.classList.contains('theme-dark'),
                 bg: grab('--background-primary'), bgLum: lum(bg),
                 textNormal: grab('--text-normal'), accent: grab('--interactive-accent') };
    })()`);
    return { name: '主题变量', points: [
        ['body 带 theme-dark 或 theme-light', typeof r.isDark === 'boolean', r.isDark ? '深色' : '浅色'],
        ['--background-primary 可取到', !!r.bg, r.bg],
        ['--interactive-accent 可取到', !!r.accent, r.accent],
        ['背景亮度与明暗主题一致', r.bgLum !== null && (r.isDark ? r.bgLum < 0.5 : r.bgLum >= 0.5), `亮度 ${r.bgLum === null ? '无法解析' : r.bgLum.toFixed(2)}`],
    ], raw: r };
}

/** 文字折行：单行控件换成两行，是「看着怪」最高频的真因 */
async function wrap(c, selector, expectLines = 1) {
    const r = await c.eval(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        return els.slice(0, 30).map(el => {
            const cs = getComputedStyle(el);
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
            return { text: (el.innerText||'').trim().slice(0,20), h: Math.round(el.getBoundingClientRect().height),
                     lines: Math.max(1, Math.round(el.getBoundingClientRect().height / lh)) };
        });
    })()`);
    const multi = r.filter((x) => x.lines > expectLines);
    return { name: `折行: ${selector}（期望 ${expectLines} 行）`, points: [
        ['元素存在', r.length > 0, `${r.length} 个`],
        [`无多行`, multi.length === 0, multi.length ? multi.map((m) => `"${m.text}"=${m.lines}行`).join('; ') : ''],
    ], raw: r };
}

/** 求值自由检查（给一次性探针用） */
async function expr(c, js) {
    const v = await c.eval(js);
    return { name: '自定义表达式', points: [['求值成功', v !== undefined, typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300)]], raw: v };
}

const DETECTORS = { view: viewStructure, overflow, alignment, computed, theme: themeTokens, wrap, expr };

// ── 场景（用真点击 / 真命令驱动，产出可截图的真画面）─────────────────────────
const SCENARIOS = {
    /** 主视图总览（默认页签） */
    async home(c) {
        await c.eval(`(async () => {
            const app = window.app;
            const leaf = app.workspace.getLeavesOfType(${JSON.stringify(VIEW)})[0] || app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: ${JSON.stringify(VIEW)}, active: true });
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await new Promise(r => setTimeout(r, 1200));
            return true;
        })()`);
    },
    /** 切到某个一级页签：先找页签按钮，再走「更多」菜单（merged 布局），最后才回落到状态推送 */
    async tab(c, name) {
        const TAB_LABEL = { tracking: '计划', book: '阅读', media: '影视', game: '游戏', music: '音乐', stats: '统计' };
        const label = TAB_LABEL[name] || name;
        const VIEW = 'reelludic-home';

        // ① 顶部胶囊布局：直接点 #rl-tab-<name>
        const direct = await c.eval(`(async () => {
            const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(VIEW)})[0];
            const root = leaf && leaf.view.containerEl;
            const btn = root && root.querySelector('#rl-tab-' + ${JSON.stringify(name)});
            if (!btn) return false;
            btn.click();
            await new Promise(r => setTimeout(r, 800));
            return true;
        })()`);
        if (direct) return { via: 'tab-button' };

        // ② merged 布局：「更多」菜单（插件自绘 .rl-more-pop）
        const cdp = require('./cdp.cjs');
        try {
            // 先悬停再点：Obsidian/插件的浮层控件常常要 mouseenter 之后才把命中区域布好，
            // 一次性 press/release 在首次交互里可能被忽略（实测「点了没反应」）
            await cdp.hover(c, '.rl-more-btn');
            let items = await cdp.menuItems(c);
            if (!items.length) {
                await cdp.realClick(c, '.rl-more-btn');
                items = await cdp.menuItems(c);
            }
            if (items.length) {
                const KEY = { tracking: /追更/, book: /阅读/, media: /媒体库/, game: /游戏/, music: /音乐/, stats: /统计/ };
                const want = items.find((t) => (KEY[name] || new RegExp(label)).test(t));
                if (want) {
                    await cdp.clickMenuItem(c, want);
                    await cdp.sleep(900);
                    return { via: 'more-menu', picked: want, items };
                }
                await c.eval(`document.querySelectorAll('.rl-more-pop').forEach(m => m.remove())`);
                return { via: 'none', reason: '菜单里没有这一页', items };
            }
        } catch (e) {
            /* 没有「更多」按钮（非 merged 布局），继续往下 */
        }

        // ③ 兜底：推一次性请求给已挂载的组件（不伪造 DOM，走插件自己的通道）
        const r = await c.eval(`(async () => {
            const leaf = window.app.workspace.getLeavesOfType(${JSON.stringify(VIEW)})[0];
            if (!leaf || !leaf.view) return { ok: false, reason: '主视图未打开' };
            if (typeof leaf.view.setRequestedTab === 'function') {
                leaf.view.setRequestedTab(${JSON.stringify(name)});
                await new Promise(r => setTimeout(r, 900));
                return { ok: true, via: 'setRequestedTab' };
            }
            return { ok: false, reason: '没有 setRequestedTab' };
        })()`);
        return r;
    },
    /** 打开设置页并滚到插件设置 */
    async settings(c) {
        await c.eval(`(async () => {
            const app = window.app;
            app.setting && app.setting.open && app.setting.open();
            await new Promise(r => setTimeout(r, 800));
            if (app.setting && app.setting.openTabById) app.setting.openTabById(${JSON.stringify(require('./cdp.cjs').DEFAULTS.pluginId)});
            await new Promise(r => setTimeout(r, 900));
            return true;
        })()`);
    },
    /** 关闭所有弹窗/设置，回到主视图 */
    async reset(c) {
        await c.eval(`(async () => {
            const app = window.app;
            if (app.setting && app.setting.close) app.setting.close();
            app.workspace.iterateAllLeaves(l => { try { if (l.view && l.view.constructor && /Modal/.test(l.view.constructor.name)) l.detach(); } catch {} });
            document.querySelectorAll('.modal-container').forEach(m => m.remove());
            await new Promise(r => setTimeout(r, 500));
            return true;
        })()`);
    },
    /** 打开「添加条目」弹窗（真插件方法，不是伪造 DOM） */
    async addEntry(c, type) {
        await c.eval(`(async () => {
            const p = window.app.plugins.plugins[${JSON.stringify(require('./cdp.cjs').DEFAULTS.pluginId)}];
            if (!p) throw new Error('插件未加载');
            p.openAddModal(${type ? JSON.stringify(type) : 'undefined'});
            await new Promise(r => setTimeout(r, 1200));
            return true;
        })()`);
    },
};

module.exports = { DETECTORS, SCENARIOS, viewport };
