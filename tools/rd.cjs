#!/usr/bin/env node
/**
 * `rd` —— 真机测试 CLI（Real Device）
 *
 * 一条命令把「真 Obsidian 实例 → 打开插件 → 驱动场景 → 断言 → 截图」串起来。
 *
 * 常用：
 *   node tools/rd.cjs status                    # 探一下真机是否在跑、插件版本
 *   node tools/rd.cjs launch                    # 启动（或复用）隔离真机实例
 *   node tools/rd.cjs setup --size 1440x900     # 整理出可截图可断言的干净画面
 *   node tools/rd.cjs shot                      # 截主视图
 *   node tools/rd.cjs scenario tab stats        # 切到统计页（真点菜单）
 *   node tools/rd.cjs check view                # 结构断言
 *   node tools/rd.cjs check overflow '.rl-card' # 溢出断言
 *   node tools/rd.cjs dev --tab media --shot    # 编辑循环：等产物变化 → 热重载 → 截图
 *   node tools/rd.cjs stop                      # 关掉（不影响你自己的 Obsidian）
 *
 * 所有子命令支持 `--port 9333` / `--json`。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cdp = require('./realdevice/cdp.cjs');
const { DETECTORS, SCENARIOS } = require('./realdevice/checks.cjs');
const state = require('./realdevice/state.cjs');

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
function opt(name, dflt) {
    const i = argv.indexOf('--' + name);
    if (i < 0) return dflt;
    const v = argv[i + 1];
    return !v || v.startsWith('--') ? true : v;
}
function positional() {
    const out = [];
    for (let i = 1; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            i++;
            continue;
        }
        out.push(argv[i]);
    }
    return out;
}
const PORT = Number(opt('port', cdp.DEFAULTS.port));
const JSON_OUT = !!opt('json', false);
// 🔴 reuse 必须显式为 true：默认值只在「没传这个键」时生效，漏传会变成 !!undefined
//    —— 表现为「端口在听却报占用」。
const launchOpts = { port: PORT, reuse: true, restart: !!opt('restart', false) };

// ── 输出 ────────────────────────────────────────────────────────────────────
const C = { ok: '\x1b[32m', bad: '\x1b[31m', dim: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

function render(result) {
    const list = Array.isArray(result) ? result : [result];
    let pass = 0;
    let total = 0;
    const flat = [];
    for (const r of list) {
        for (const [label, ok, detail] of r.points || []) {
            total++;
            if (ok) pass++;
            flat.push({ check: r.name, label, ok: !!ok, detail: detail == null ? '' : String(detail) });
        }
    }
    if (JSON_OUT) {
        console.log(JSON.stringify({ pass, total, flat }, null, 2));
    } else {
        let last = null;
        for (const f of flat) {
            if (f.check !== last) {
                console.log(`\n${C.b}${f.check}${C.x}`);
                last = f.check;
            }
            console.log(`  ${f.ok ? C.ok + 'PASS' + C.x : C.bad + 'FAIL' + C.x}  ${f.label}${f.detail ? C.dim + '  [' + f.detail + ']' + C.x : ''}`);
        }
        console.log(`\n${pass === total ? C.ok : C.bad}${pass}/${total} PASS${C.x}`);
    }
    return pass === total;
}

function brief(e) {
    return (e.desc || e.text || '').split('\n')[0];
}

// ── 热重载脚本 ──────────────────────────────────────────────────────────────
/**
 * `dev` 的热重载脚本（在真机里执行；`__PLUGIN__` 会被替换成带引号的插件 id）。
 *
 * 🔴 Obsidian 1.14.4 的 `PluginManager` **没有 `reloadPlugin`**（实测 API 只有
 *    load/unload/enable/disable 等）⇒ 重载 = `unloadPlugin` + `loadPlugin`。
 * 🔴 重载前**必须把主视图拆干净并等它真的拆完**：插件的 `applyUiTheme()` 在 `onload` 里
 *    遍历所有 `reelludic-home` leaf 调 `leaf.view.setUiTheme(...)`，只要还剩一个半死的视图
 *    就报 `leaf.view.setUiTheme is not a function`（实测：视图开着时 1 条，拆干净后 0 条）。
 *    这是 harness 侧重载姿势的问题，**不是插件 bug**（正常启用插件时视图要么不存在、要么完好）。
 */
const RELOAD_SCRIPT = `(async () => {
    const app = window.app;
    const PLUGIN = __PLUGIN__;
    try {
        for (const leaf of app.workspace.getLeavesOfType('reelludic-home')) {
            try { leaf.detach(); } catch (e) {}
        }
        const t0 = Date.now();
        while (Date.now() - t0 < 3000) {
            await new Promise(r => setTimeout(r, 100));
            if (app.workspace.getLeavesOfType('reelludic-home').length === 0) break;
        }
        await new Promise(r => setTimeout(r, 400));
        const pm = app.plugins;
        try { await pm.unloadPlugin(PLUGIN); } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
        await pm.loadPlugin(PLUGIN);
        await new Promise(r => setTimeout(r, 800));
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: 'reelludic-home', active: true });
        const t1 = Date.now();
        while (Date.now() - t1 < 8000) {
            await new Promise(r => setTimeout(r, 150));
            const root = leaf.view && leaf.view.containerEl;
            if (root && root.querySelector('.rl-card, .rl-home')) {
                return { ok: true, plugin: pm.plugins[PLUGIN] ? 'loaded' : 'missing' };
            }
        }
        return { ok: false, reason: '视图 8s 内没有渲染出内容', plugin: pm.plugins[PLUGIN] ? 'loaded' : 'missing' };
    } catch (e) { return { ok: false, error: String(e && e.stack || e) }; }
})()`;

// ── 子命令 ──────────────────────────────────────────────────────────────────
async function getSession() {
    return cdp.launch(launchOpts);
}

const commands = {
    async status() {
        const alive = await cdp.isPortAlive(PORT);
        const procs = cdp.findHarnessProcs(path.resolve(cdp.ROOT, cdp.DEFAULTS.userDataName));
        console.log(`端口 ${PORT}: ${alive ? C.ok + '在听' + C.x : C.dim + '无' + C.x}`);
        console.log(`harness 进程: ${procs.length ? procs.join(', ') : '无'}`);
        if (!alive) {
            console.log(C.dim + '（未启动：node tools/rd.cjs launch）' + C.x);
            return true;
        }
        const c = await getSession();
        const info = await c.eval(`(() => {
            const app = window.app;
            const pid = ${JSON.stringify(cdp.DEFAULTS.pluginId)};
            const p = app && app.plugins && app.plugins.plugins[pid];
            return {
                vault: app.vault.getName(), files: app.vault.getAllLoadedFiles().length,
                plugin: p ? p.manifest.version : null,
                pluginEnabled: !!(app.plugins.enabledPlugins && app.plugins.enabledPlugins.has(pid)),
                views: app.workspace.getLeavesOfType('reelludic-home').length,
                theme: document.body.className,
                vw: window.innerWidth, vh: window.innerHeight,
            };
        })()`);
        c.close();
        console.log(`库 ${info.vault}  文件 ${info.files}  窗口 ${info.vw}×${info.vh}`);
        console.log(`插件 ${info.plugin ? info.plugin + (info.pluginEnabled ? ' (已启用)' : C.bad + ' (未启用)' + C.x) : C.bad + '未加载' + C.x}   主视图 ${info.views} 个`);
        return true;
    },

    async launch() {
        const c = await getSession();
        const meta = c._meta;
        console.log(meta.reused ? `${C.dim}复用已有实例 :${meta.port}${C.x}` : `${C.ok}已启动${C.x}  pid=${meta.pid}  :${meta.port}`);
        const errors = await cdp.collectErrors(c);
        await cdp.sleep(800);
        const info = await c.eval(`(() => {
            const app = window.app;
            const p = app.plugins.plugins[${JSON.stringify(cdp.DEFAULTS.pluginId)}];
            return { vault: app.vault.getName(), plugin: p ? p.manifest.version : null, theme: document.body.className,
                     vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio };
        })()`);
        c.close();
        console.log(`库 ${info.vault}  ·  插件 ${info.plugin || C.bad + '未加载' + C.x}  ·  窗口 ${info.vw}×${info.vh}@${info.dpr}`);
        if (errors.length) {
            console.log(C.bad + '启动期报错:' + C.x);
            for (const e of errors.slice(0, 10)) console.log('  ' + brief(e));
        }
        return !!info.plugin;
    },

    async stop() {
        const pids = cdp.shutdown({ port: PORT });
        console.log(pids.length ? `已关闭 ${pids.length} 个 harness 进程` : '没有在跑的 harness 实例');
        return true;
    },

    async restart() {
        launchOpts.restart = true;
        return commands.launch();
    },

    /** viewport [--size 1440x900] —— 设定真机视口 */
    async viewport() {
        const size = String(opt('size', '1440x900')).split('x').map(Number);
        const c = await getSession();
        const vp = await cdp.setViewport(c, size[0], size[1]);
        c.close();
        console.log(`视口 ${vp.vw}×${vp.vh}（请求 ${vp.requested}）  真机窗口${vp.windowResized ? '已同步' : '未同步'}`);
        return true;
    },

    /**
     * mobile [--size 390x844] [--shot] [--tab x] —— 切到「手机端」跑一遍。
     *
     * 2026-11-14 建立（用户 m06113 拍板「方案 A」）。做的事：
     *   ① 视口 mobile:true + DPR 3 + 触摸模拟 + iPhone UA；
     *   ② 删 `process`、把 `Platform.isMobileApp` 改成 true；
     *   ③ 重载插件（旧实例可能已缓存了桌面端判断）；
     *   ④ 逐页点开设置页签，收集每页的错误与首屏高度 —— 这就是「白屏」的机器判据。
     *
     * 🔴 这是**模拟**不是真机：能证「移动端运行时路径不崩」，不能证「像素与真机一致」。
     * ⛔ 别把本命令的结果当成真机验收。
     */
    async mobile() {
        const size = String(opt('size', '390x844')).split('x').map(Number);
        const c = await getSession();
        const errors = await cdp.collectErrors(c);
        const m = await cdp.enterMobileMode(c, { width: size[0], height: size[1] });
        console.log(`视口 ${m.width}×${m.height}  mobile=true  DPR=${cdp.MOBILE_DEVICE.deviceScaleFactor}`);
        console.log(`process 已删: ${m.patch.processDeleted ? C.ok + '是' + C.x : C.bad + '否' + C.x}`);
        console.log(`已切的判定: [${m.patch.platformPatched.join(', ')}]  app.isMobile=${m.patch.appIsMobile}`);
        if (m.patch.platformFailed.length) {
            for (const f of m.patch.platformFailed) console.log(`  ${C.bad}${f}${C.x}`);
        }
        console.log(
            C.dim +
                '⚠️ 不删 process：删了宿主自己的 app.setting.open() 会崩（它读 process.platform）。' +
                '「无 process 不崩」由 tests/mobileRuntime.test.ts 单测覆盖。' +
                C.x,
        );
        console.log(
            C.dim +
                '⚠️ Platform.isMobileApp 从页面外部改不动（obsidian 模块只在插件包作用域内注入），' +
                '因此「仅桌面端」徽标在模拟里不会出现。' +
                C.x,
        );

        // 重载插件：旧实例在 onload 时已按桌面端算过一批分支，必须让它重跑一遍
        await c.eval(RELOAD_SCRIPT.replace('__PLUGIN__', JSON.stringify(cdp.DEFAULTS.pluginId)));
        const again = await c.eval(`(() => {
            try { if (window.app && 'isMobile' in window.app) window.app.isMobile = true; } catch (e) {}
            return {
                processGone: typeof globalThis.process === 'undefined',
                appIsMobile: !!(window.app && window.app.isMobile),
            };
        })()`);
        console.log(`重载后: process 缺失=${again.processGone}  app.isMobile=${again.appIsMobile}`);

        // 逐页扫设置页：白屏的机器判据 = 该页 .rl-set-page-body 的高度为 0 或含 .rl-set-pagefail
        const scan = await c.eval(`(async () => {
            const app = window.app;
            const pid = ${JSON.stringify(cdp.DEFAULTS.pluginId)};
            const plugin = app.plugins.plugins[pid];
            // 🔴 实例字段是 \`settingTab\` 不是 \`setting\`（实测：pluginKeys 里只有 settingTab）
            const tabInst = plugin && (plugin.settingTab || plugin.setting);
            if (!tabInst) return { ok: false, reason: '设置页实例不存在（plugin.settingTab 为空）' };
            app.setting && app.setting.open && app.setting.open();
            await new Promise(r => setTimeout(r, 500));
            if (app.setting && app.setting.openTabById) app.setting.openTabById(pid);
            await new Promise(r => setTimeout(r, 1200));
            const root = tabInst.containerEl;
            if (!root) return { ok: false, reason: '设置页 containerEl 为空' };
            const tabs = Array.from(root.querySelectorAll('.rl-set-tab'));
            const rows = [];
            for (const tab of tabs) {
                tab.click();
                await new Promise(r => setTimeout(r, 320));
                const page = root.querySelector('.rl-set-page.is-active');
                const body = page && page.querySelector('.rl-set-page-body');
                const fail = page && page.querySelector('.rl-set-pagefail');
                rows.push({
                    tab: (tab.textContent || '').trim(),
                    active: !!page,
                    h: body ? Math.round(body.getBoundingClientRect().height) : -1,
                    items: page ? page.querySelectorAll('.setting-item').length : 0,
                    fail: fail ? (fail.textContent || '').slice(0, 120) : '',
                });
            }
            return {
                ok: true,
                tabCount: tabs.length,
                appIsMobile: !!(app && app.isMobile),
                processGone: typeof globalThis.process === 'undefined',
                viewW: window.innerWidth,
                rows,
            };
        })()`);

        if (!scan.ok) {
            console.log(C.bad + '扫描失败: ' + scan.reason + C.x);
            c.close();
            return false;
        }
        console.log(
            `环境确认: app.isMobile=${scan.appIsMobile}  process 缺失=${scan.processGone}  vw=${scan.viewW}  页签数=${scan.tabCount}`,
        );
        let bad = 0;
        for (const r of scan.rows) {
            const blank = r.active && r.h <= 0;
            const failed = !!r.fail;
            if (blank || failed || !r.active) bad++;
            const tag = !r.active ? C.bad + '未激活' + C.x : failed ? C.bad + '报错页' + C.x : blank ? C.bad + '空白' + C.x : C.ok + 'OK' + C.x;
            console.log(`  ${tag}  ${r.tab}  h=${r.h}  items=${r.items}${r.fail ? '  ← ' + r.fail : ''}`);
        }
        if (errors.length) {
            console.log(C.bad + '期间控制台报错:' + C.x);
            for (const e of errors.slice(0, 12)) console.log('  ' + brief(e));
        }
        const shot = !!opt('shot', false);
        if (shot) {
            const out = opt('out', `_shot/rd/mobile-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);
            const info = await cdp.screenshot(c, out, {});
            console.log(`截图: ${path.relative(cdp.ROOT, info.path)}  ${(info.bytes / 1024).toFixed(0)}KB`);
        }
        c.close();
        console.log(`\n${bad === 0 ? C.ok : C.bad}设置页 ${scan.rows.length - bad}/${scan.rows.length} 页正常${C.x}`);
        return bad === 0 && errors.length === 0;
    },

    /** theme [--set dark|light] */
    async theme() {
        const set = opt('set', null);
        const c = await getSession();
        if (set) {
            await cdp.setTheme(c, set);
            state.write(cdp.ROOT, cdp.DEFAULTS.userDataName, { theme: set });
        }
        const info = await c.eval(`({
            theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
            bg: getComputedStyle(document.body).getPropertyValue('--background-primary').trim(),
        })`);
        c.close();
        console.log(`主题 ${info.theme}  背景 ${info.bg}`);
        return true;
    },

    /**
     * setup —— 整理成「可截图可断言」的干净画面：
     *   定视口 → 收侧边栏 → 只留主视图标签 → 开主视图 → 可选主题 / 页签。
     */
    async setup() {
        const size = String(opt('size', '1440x900')).split('x').map(Number);
        const tab = opt('tab', null);
        const theme = opt('set', null);
        const c = await getSession();
        const errors = await cdp.collectErrors(c);
        // 顺序要紧：先定视口 → 再收侧边栏（侧栏开着时主视图只剩 210px）
        await cdp.setViewport(c, size[0], size[1]);
        await cdp.collapseSidebars(c);
        await c.eval(`(async () => {
            for (const l of window.app.workspace.getLeavesOfType('markdown')) { try { l.detach(); } catch {} }
            await new Promise(r => setTimeout(r, 300));
            return true;
        })()`);
        await cdp.openHomeView(c);
        await cdp.sleep(700);
        await cdp.collapseSidebars(c);
        if (theme) {
            await cdp.setTheme(c, theme);
            state.write(cdp.ROOT, cdp.DEFAULTS.userDataName, { theme });
        }
        if (tab) await SCENARIOS.tab(c, tab);
        await cdp.sleep(500);
        const st = await c.eval(`(() => {
            const root = document.querySelector('.rl-home');
            const b = root && root.getBoundingClientRect();
            return { vw: window.innerWidth, vh: window.innerHeight,
                     theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
                     root: !!root, viewW: b ? Math.round(b.width) : 0 };
        })()`);
        c.close();
        console.log(`就绪 ${st.vw}×${st.vh}  ${st.theme}  主视图 ${st.root ? '已挂载' : C.bad + '未挂载' + C.x}  视图宽 ${st.viewW}px${tab ? '  页签 ' + tab : ''}`);
        if (errors.length) for (const e of errors.slice(0, 5)) console.log(`  ${C.bad}${brief(e)}${C.x}`);
        return st.root;
    },

    /** scenario <name> [arg] —— 驱动真机到某个画面 */
    async scenario() {
        const [name, arg] = positional();
        if (!name) {
            console.log('可用场景: ' + Object.keys(SCENARIOS).join(', '));
            return false;
        }
        const fn = SCENARIOS[name];
        if (!fn) {
            console.log(`${C.bad}未知场景: ${name}${C.x}\n可用: ${Object.keys(SCENARIOS).join(', ')}`);
            return false;
        }
        const c = await getSession();
        const errors = await cdp.collectErrors(c);
        const r = await fn(c, arg);
        await cdp.sleep(400);
        c.close();
        const via = r && r.via ? C.dim + '  (经 ' + r.via + (r.picked ? ': ' + r.picked : '') + ')' + C.x : '';
        console.log(`场景 ${name}${arg ? ' ' + arg : ''} 已就绪${via}`);
        if (r && r.via === 'none') console.log(`  ${C.bad}未能切页：${r.reason}  菜单项=[${(r.items || []).join(', ')}]${C.x}`);
        if (errors.length) {
            console.log(C.bad + '期间报错:' + C.x);
            for (const e of errors.slice(0, 10)) console.log('  ' + brief(e));
            return false;
        }
        return true;
    },

    /** shot [--out x.png] [--selector .rl-home] [--scale 2] */
    async shot() {
        const c = await getSession();
        await cdp.openHomeView(c);
        await cdp.sleep(300);
        const out = opt('out', `_shot/rd/${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);
        const info = await cdp.screenshot(c, out, {
            selector: opt('selector', undefined),
            scale: Number(opt('scale', 1)),
        });
        c.close();
        console.log(`截图: ${path.relative(cdp.ROOT, info.path)}  ${(info.bytes / 1024).toFixed(0)}KB`);
        return true;
    },

    /** check <detector> [args...] */
    async check() {
        const [kind, a, b, d] = positional();
        const c = await getSession();
        const errors = await cdp.collectErrors(c);
        await cdp.openHomeView(c);
        let result;
        switch (kind) {
            case 'view': result = await DETECTORS.view(c); break;
            case 'theme': result = await DETECTORS.theme(c); break;
            case 'overflow':
                if (!a) { console.log('需要选择器'); c.close(); return false; }
                result = await DETECTORS.overflow(c, a);
                break;
            case 'alignment':
                if (!a) { console.log('需要选择器'); c.close(); return false; }
                result = await DETECTORS.alignment(c, a, b || 'left', d ? Number(d) : 1);
                break;
            case 'computed':
                if (!a || !b) { console.log('需要选择器 + 属性表'); c.close(); return false; }
                result = await DETECTORS.computed(c, a, b.split(','));
                break;
            case 'wrap':
                if (!a) { console.log('需要选择器'); c.close(); return false; }
                result = await DETECTORS.wrap(c, a, b ? Number(b) : 1);
                break;
            case 'expr':
                if (!a) { console.log('需要表达式'); c.close(); return false; }
                result = await DETECTORS.expr(c, a);
                break;
            default:
                console.log('可用检测器: ' + Object.keys(DETECTORS).join(', '));
                c.close();
                return false;
        }
        await cdp.sleep(200);
        c.close();
        const pass = render(result);
        if (errors.length) {
            console.log(C.bad + '\n期间控制台报错（也算问题）:' + C.x);
            for (const e of errors.slice(0, 10)) console.log('  ' + brief(e));
        }
        return pass && errors.length === 0;
    },

    /**
     * dev —— 编辑循环：监视 main.js / styles.css / manifest.json，
     * 变化即热部署到隔离库并在真机里卸载重载插件 + 截图。
     */
    async dev() {
        const WATCH = ['main.js', 'styles.css', 'manifest.json'].map((f) => path.join(cdp.ROOT, f));
        const tab = opt('tab', null);
        const everyShot = !!opt('shot', false);
        const c = await getSession();
        const errors = await cdp.collectErrors(c);
        await cdp.openHomeView(c);
        if (tab) await SCENARIOS.tab(c, tab);

        const mtimes = new Map();
        for (const f of WATCH) if (fs.existsSync(f)) mtimes.set(f, fs.statSync(f).mtimeMs);

        console.log(`${C.ok}监视中${C.x} ${WATCH.map((f) => path.basename(f)).join(' / ')}  ${C.dim}（Ctrl+C 退出）${C.x}`);
        if (tab) console.log(`${C.dim}固定页签: ${tab}${C.x}`);

        let busy = false;
        let pending = false;
        const cycle = async () => {
            if (busy) {
                pending = true;
                return;
            }
            busy = true;
            try {
                const dst = path.join(path.resolve(cdp.ROOT, cdp.DEFAULTS.vaultName), '.obsidian', 'plugins', cdp.DEFAULTS.pluginId);
                for (const f of WATCH) {
                    if (!fs.existsSync(f)) continue;
                    fs.copyFileSync(f, path.join(dst, path.basename(f)));
                }
                const t0 = Date.now();
                errors.reset();
                const ok = await c.eval(RELOAD_SCRIPT.replace('__PLUGIN__', JSON.stringify(cdp.DEFAULTS.pluginId)));
                const dt = Date.now() - t0;
                if (tab) await SCENARIOS.tab(c, tab);
                await cdp.sleep(300);
                const stamp = new Date().toTimeString().slice(0, 8);
                const st = ok.ok ? `${C.ok}OK${C.x}` : `${C.bad}FAIL${C.x}`;
                const extra = ok.error ? '  ' + brief({ desc: ok.error }) : ok.reason ? '  ' + ok.reason : '';
                console.log(`${C.dim}${stamp}${C.x} 重载 ${st} ${C.dim}${dt}ms${C.x}${extra}`);
                const errs = errors.filter((e) => e.kind === 'exception' || e.kind === 'console:error');
                for (const e of errs.slice(0, 6)) console.log(`   ${C.bad}${brief(e)}${C.x}`);
                if (everyShot || errs.length || !ok.ok) {
                    const info = await cdp.screenshot(c, '_shot/rd/dev-latest.png');
                    console.log(`   ${C.dim}截图 ${path.relative(cdp.ROOT, info.path)}${C.x}`);
                }
            } finally {
                busy = false;
                if (pending) {
                    pending = false;
                    setTimeout(cycle, 100);
                }
            }
        };

        const timer = setInterval(() => {
            for (const f of WATCH) {
                if (!fs.existsSync(f)) continue;
                const m = fs.statSync(f).mtimeMs;
                if (m !== mtimes.get(f)) {
                    mtimes.set(f, m);
                    void cycle();
                    break;
                }
            }
        }, 300);

        await new Promise((resolve) => {
            const done = () => {
                clearInterval(timer);
                c.close();
                resolve();
            };
            process.on('SIGINT', done);
            process.on('SIGTERM', done);
        });
        return true;
    },

    async help() {
        const src = fs.readFileSync(__filename, 'utf8');
        console.log(src.split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
        return true;
    },
};

(async () => {
    const fn = commands[cmd];
    if (!fn) {
        await commands.help();
        process.exit(1);
    }
    try {
        const ok = await fn();
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error(`${C.bad}✗ ${e.message}${C.x}`);
        process.exit(1);
    }
})();
