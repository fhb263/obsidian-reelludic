/**
 * Obsidian 真机测试环境（Real Device Harness）
 * ============================================
 * 用 **CDP（Chrome DevTools Protocol）** 驱动一台**真实 Obsidian 实例**：
 * 真渲染 / 真 Svelte / 真主题 / 真 Obsidian CSS / 真插件生命周期。
 *
 * 为什么不用复现页：复现页是手搭 HTML，样式与祖先链靠人抄，永远差一口气；
 * 而 CDP 连的就是 `app://obsidian.md/index.html` 那个真窗口，`window.app` 就是 Obsidian App。
 *
 * 设计要点：
 *  - **不改插件代码**：宿主侧只读 `window.app`，不注册全局、不打桩。
 *  - **隔离**：独立 `--user-data-dir`（不抢用户当前库的面板/插件状态）+
 *    库副本（`.testvault`，源头闸 `--harness-source` 决定从哪拷）。
 *  - **零新依赖**：WS 用 DSH 自带 ws；截图/求值全走原生 CDP 消息。
 *
 * 见 tools/README.md 的「真机测试」一节。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const state = require('./state.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

// ── ws 模块解析：优先本仓，其次 DSH profile，最后全局 ──────────────────────
function loadWs() {
    const candidates = [
        path.join(ROOT, 'node_modules', 'ws'),
        'C:/Users/kest/.dsh/profiles/desktop/node_modules/ws',
        'ws',
    ];
    for (const c of candidates) {
        try {
            return require(c);
        } catch {
            /* 下一个 */
        }
    }
    throw new Error('找不到 ws 模块（试过本仓 / DSH profile / 全局）');
}

// ── 默认常量 ────────────────────────────────────────────────────────────────
const DEFAULTS = {
    obsidianExe: 'D:/Obsidian/Obsidian.exe',
    port: 9333,
    vaultName: '.testvault',
    userDataName: '.testvault-userdata',
    pluginId: 'obsidian-reelludic',
    // 源头库：拷进隔离库的那份快照。--harness-source 可覆盖（见 tools/make-testvault.cjs）
    sourceVault: 'C:/Users/kest/Desktop/临时测试库',
    bootTimeoutMs: 60000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP 连接 ────────────────────────────────────────────────────────────────
function connect(wsUrl) {
    const WebSocket = loadWs();
    return new Promise((resolve, reject) => {
        // --remote-allow-origins=* 时 origin 随便；保留以兼容旧版
        const ws = new WebSocket(wsUrl, { origin: `http://127.0.0.1` });
        let nextId = 0;
        const pending = new Map();
        const listeners = new Map();

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }
            if (msg.id && pending.has(msg.id)) {
                const { res, rej, timer } = pending.get(msg.id);
                pending.delete(msg.id);
                clearTimeout(timer);
                msg.error ? rej(new Error(msg.error.message || JSON.stringify(msg.error))) : res(msg.result);
                return;
            }
            if (msg.method && listeners.has(msg.method)) {
                for (const fn of listeners.get(msg.method)) fn(msg.params);
            }
        });
        ws.on('error', reject);
        ws.on('open', () => {
            const session = {
                /** 底层发送 */
                send(method, params = {}, timeoutMs = 30000) {
                    const id = ++nextId;
                    return new Promise((res, rej) => {
                        const timer = setTimeout(() => {
                            pending.delete(id);
                            rej(new Error(`CDP 超时: ${method}`));
                        }, timeoutMs);
                        pending.set(id, { res, rej, timer });
                        ws.send(JSON.stringify({ id, method, params }));
                    });
                },
                /** 监听从主进程推来的事件（console / exception / 等） */
                on(method, fn) {
                    if (!listeners.has(method)) listeners.set(method, new Set());
                    listeners.get(method).add(fn);
                },
                /**
                 * 在真机窗口里求值。
                 * 🔴 returnByValue + awaitPromise：异步逻辑（如 `await leaf.setViewState`）可直接写。
                 * 🔴 userGesture：点按钮触发的 Obsidian 逻辑（如 openModal）需要用户手势上下文。
                 */
                async eval(expression, opts = {}) {
                    const r = await session.send(
                        'Runtime.evaluate',
                        {
                            expression,
                            returnByValue: true,
                            awaitPromise: true,
                            userGesture: true,
                            allowUnsafeEvalBlockedByCSP: false,
                            ...opts,
                        },
                        opts.timeoutMs || 60000,
                    );
                    if (r.exceptionDetails) {
                        const d = r.exceptionDetails;
                        throw new Error(`[真机求值失败] ${d.text} ${d.exception && d.exception.description ? d.exception.description : ''}\n--- 表达式 ---\n${String(expression).slice(0, 800)}`);
                    }
                    return r.result.value;
                },
                close() {
                    try {
                        ws.close();
                    } catch {
                        /* 已关 */
                    }
                },
            };
            resolve(session);
        });
    });
}

// ── 进程 / 启动 ─────────────────────────────────────────────────────────────
/** 找出所有用「本 harness 的 user-data-dir」跑起来的 Obsidian 进程（含子进程） */
function findHarnessProcs(userDataDir) {
    const norm = path.resolve(userDataDir).toLowerCase();
    if (process.platform !== 'win32') return [];
    const { execFileSync } = require('child_process');
    try {
        const out = execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                `Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" | Where-Object { $_.CommandLine -like '*${norm.replace(/'/g, "''")}*' } | Select-Object -ExpandProperty ProcessId`,
            ],
            { encoding: 'utf8', timeout: 15000 },
        );
        return out
            .split(/\r?\n/)
            .map((s) => Number(s.trim()))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function killHarness(userDataDir) {
    const pids = findHarnessProcs(userDataDir);
    for (const pid of pids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            /* 已退出 */
        }
    }
    return pids;
}

async function isPortAlive(port) {
    try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
        return r.ok;
    } catch {
        return false;
    }
}

/**
 * 收起两侧侧边栏，让主视图拿到全宽。
 * 🔴 为什么必须做：隔离库的 `workspace.json` 是从源库拷来的，源库平时两侧边栏都是开的 ⇒
 *    1440px 的窗口里主视图只剩 **210px**（截图里卡片挤成一列竖条，看着像布局炸了，其实是没空间）。
 *    这属于「测试画面整理」，不是改插件行为。
 */
async function collapseSidebars(c) {
    return c.eval(`(async () => {
        const app = window.app;
        // 有 dock 恢复状态时优先用 workspace API
        try {
            if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
            if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
        } catch (e) {}
        // 兜底：命令面板等价命令（老版本 workspace API 不完整时）
        const has = (id) => app.commands && app.commands.commands && app.commands.commands[id];
        for (const id of ['app:toggle-left-sidebar', 'app:toggle-right-sidebar']) {
            try {
                const collapsedL = app.workspace.leftSplit && app.workspace.leftSplit.collapsed;
                const collapsedR = app.workspace.rightSplit && app.workspace.rightSplit.collapsed;
                if (id.includes('left') && !collapsedL) app.commands.executeCommandById(id);
                if (id.includes('right') && !collapsedR) app.commands.executeCommandById(id);
            } catch (e) {}
        }
        await new Promise(r => setTimeout(r, 500));
        const root = document.querySelector('.rl-home');
        const b = root && root.getBoundingClientRect();
        return { width: b ? Math.round(b.width) : null,
                 left: !!(app.workspace.leftSplit && app.workspace.leftSplit.collapsed),
                 right: !!(app.workspace.rightSplit && app.workspace.rightSplit.collapsed) };
    })()`);
}

/** 等真机窗口里 `window.app` 就绪（不是 starter.html 那种「打开库」页） */
async function waitForApp(port, timeoutMs) {
    const started = Date.now();
    let lastErr = '';
    while (Date.now() - started < timeoutMs) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
            const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
            if (page) {
                const c = await connect(page.webSocketDebuggerUrl);
                try {
                    const ok = await c.eval(`!!(window.app && window.app.vault && window.app.workspace)`);
                    if (ok) {
                        c.close();
                        return page;
                    }
                } finally {
                    c.close();
                }
            } else {
                lastErr = `还没有 index.html 窗口（当前: ${targets.filter((t) => t.type === 'page').map((t) => t.url).join(', ') || '无'}）`;
            }
        } catch (e) {
            lastErr = e.message;
        }
        await sleep(1000);
    }
    throw new Error(`等真机 Obsidian 就绪超时（${timeoutMs}ms）：${lastErr}`);
}

/**
 * 启动（或复用）隔离的真机 Obsidian，返回 CDP session。
 * @param {object} opt
 * @param {boolean} [opt.reuse=true] 端口上已有 harness 实例则直接连（避免每次重启 ~10s）
 * @param {boolean} [opt.restart=false] 强制重启（插件 main.js 换版后需要重启才生效）
 * @param {boolean} [opt.show=false] 是否显示窗口（默认显示 —— 用户能直接旁观；关掉用 false）
 */
async function launch(opt = {}) {
    const cfg = { ...DEFAULTS, ...opt };
    const userDataDir = path.resolve(ROOT, cfg.userDataName);
    const vaultDir = path.resolve(ROOT, cfg.vaultName);

    if (!fs.existsSync(vaultDir)) {
        throw new Error(`隔离库不存在：${vaultDir}\n先跑：node tools/make-testvault.cjs`);
    }

    if (cfg.restart) {
        killHarness(userDataDir);
        await sleep(1500);
    }

    let port = cfg.port;
    if (await isPortAlive(port)) {
        if (cfg.reuse && !cfg.restart) {
            // 端口在听 ⇒ 多半是本 harness 的实例。给它足够时间把 window.app 挂起来
            // （刚启动时 index.html 先出现、app 后挂；也可能正在加载 6MB 的 main.js）
            let page = null;
            let why = '';
            try {
                page = await waitForApp(port, cfg.reuseTimeoutMs || 20000);
            } catch (e) {
                why = e.message;
            }
            if (page) {
                const session = await connect(page.webSocketDebuggerUrl);
                session._meta = { reused: true, port, vaultDir, userDataDir };
                await restoreSession(session);
                return session;
            }
            // 端口在听但连不上我们的库 ⇒ 明确报错（不静默另起一个，避免两个实例抢同一个库）
            throw new Error(`端口 ${port} 在听，但没有可用的真机窗口：${why}\n` +
                `  · 若是别的东西占着端口：--port 9334\n` +
                `  · 若是 harness 实例卡住：node tools/rd.cjs stop && node tools/rd.cjs launch --restart`);
        }
        throw new Error(`端口 ${port} 已被占用（换个 --port，或先 node tools/rd.cjs stop）`);
    }

    // 预置库登记，避免落到「打开库」选择页
    fs.mkdirSync(userDataDir, { recursive: true });
    const id = require('crypto').createHash('md5').update(path.resolve(vaultDir).toLowerCase()).digest('hex').slice(0, 16);
    fs.writeFileSync(
        path.join(userDataDir, 'obsidian.json'),
        JSON.stringify({ vaults: { [id]: { path: vaultDir, ts: Date.now(), open: true } }, updateDisabled: true }),
        'utf8',
    );

    const args = [
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        `--user-data-dir=${userDataDir}`,
    ];
    if (!cfg.show) args.push('--headless=new');
    // 关掉 GPU 可避免部分机器上的截图黑屏；Obsidian 用 CSS 渐变不至于炸
    args.push('--disable-gpu-sandbox');

    const child = spawn(cfg.obsidianExe, args, { detached: true, stdio: 'ignore' });
    child.unref();

    const page = await waitForApp(port, cfg.bootTimeoutMs);
    const session = await connect(page.webSocketDebuggerUrl);
    session._meta = { reused: false, port, vaultDir, userDataDir, pid: child.pid };
    await restoreSession(session);
    return session;
}

/**
 * 重放上次 `setup` 定下的会话状态（视口 / 明暗主题）。
 * 🔴 Emulation 覆盖不跨连接 —— 不重放的话，`setup` 之后再跑 `shot` 会退回启动尺寸。
 */
async function restoreSession(c) {
    const st = state.read(ROOT, DEFAULTS.userDataName);
    if (st.viewport && st.viewport.width) {
        await applyViewport(c, st.viewport.width, st.viewport.height);
    }
    if (st.theme) {
        await setTheme(c, st.theme).catch(() => {});
    }
    return st;
}

/** 关掉 harness 实例（不影响用户自己开的 Obsidian） */
function shutdown(opt = {}) {
    const cfg = { ...DEFAULTS, ...opt };
    const userDataDir = path.resolve(ROOT, cfg.userDataName);
    return killHarness(userDataDir);
}

// ── 真机操作原语 ────────────────────────────────────────────────────────────

/**
 * 打开插件主视图（走真机 leaf.setViewState，不做 DOM 伪造）。
 *
 * 🔴 视图**已开着时不要 `setActiveLeaf(leaf, {focus:true})`**：那会触发 Obsidian 的
 *    `layout-change`，插件随之对当前活动 leaf 重新走一遍 `applyUiTheme()`
 *    ⇒ 实测报 `leaf.view.setUiTheme is not a function`（视图开着时重开必现 2 条，
 *      detach 后重开 0 条）。这里改成只需「确保存在且已渲染」，切焦点留给真用户。
 */
async function openHomeView(c, opts = {}) {
    const viewType = opts.viewType || 'reelludic-home';
    return c.eval(`(async () => {
        const app = window.app;
        let leaf = app.workspace.getLeavesOfType(${JSON.stringify(viewType)})[0];
        if (!leaf) {
            leaf = app.workspace.getLeaf('tab');
            await leaf.setViewState({ type: ${JSON.stringify(viewType)}, active: true });
        }
        // 等 Svelte 首帧 + 数据异步加载完成
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
            await new Promise(r => setTimeout(r, 120));
            const el = leaf.view && leaf.view.containerEl;
            if (el && el.querySelector('[class*="rl-"]')) return true;
        }
        return false;
    })()`);
}

/** 切到指定一级页签：直接点真按钮（不是改状态） */
async function clickTab(c, label) {
    return c.eval(`(async () => {
        const view = window.app.workspace.getLeavesOfType('reelludic-home')[0];
        const root = view && view.view && view.view.containerEl;
        if (!root) return { ok: false, reason: '视图未打开' };
        const wanted = ${JSON.stringify(label)};
        // 页签按钮：优先带 data-tab 的，其次按可见文案匹配
        const cands = Array.from(root.querySelectorAll('button, [role="tab"], .rl-tab-btn, [data-tab]'));
        const hit = cands.find(el => {
            const t = (el.getAttribute('data-tab') || el.textContent || '').trim();
            return t === wanted;
        });
        if (!hit) return { ok: false, reason: '找不到页签: ' + wanted,
            visible: cands.map(e => (e.getAttribute('data-tab') || e.textContent || '').trim()).filter(Boolean).slice(0, 20) };
        hit.click();
        await new Promise(r => setTimeout(r, 700));
        return { ok: true, clicked: wanted };
    })()`);
}

/** 等某个选择器出现（真机 DOM） */
async function waitFor(c, selector, timeoutMs = 10000) {
    return c.eval(`(async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < ${timeoutMs}) {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) return true;
            await new Promise(r => setTimeout(r, 100));
        }
        return false;
    })()`);
}

/**
 * 设定真机视口尺寸。
 *
 * 🔴 主路径 = CDP `Emulation.setDeviceMetricsOverride`：
 *    实测这是**唯一**能让真机渲染进程重排的路径 —— Win32 `SetWindowPos` 确实把外框改成了
 *    1440×900（`GetClientRect` 证实），但渲染进程的 `innerWidth` 一直停在启动时的 800×599
 *    （连 `outerWidth` 都不变），因为后台/非前台启动的 Obsidian 窗口在此环境下不触发 Chromium 的
 *    resize 回调。走 Emulation 后 `innerWidth=1440`、截图 1440×900、布局真实重排 ——
 *    **渲染、CSS、主题、插件逻辑全是真机的**，只有「视口数值」由 CDP 指定，与 Playwright 的
 *    `page.setViewportSize()` 是同一层能力。
 *    同时也会把真实窗口调成对应尺寸，让旁观者看到一致的画面。
 */
async function setViewport(c, width, height, vaultName) {
    let win = null;
    try {
        const { setWindowSize } = require('./winwindow.cjs');
        win = setWindowSize(width, height, vaultName || DEFAULTS.vaultName);
    } catch (e) {
        win = { ok: false, raw: e.message };
    }
    await applyViewport(c, width, height);
    c._viewport = null;
    // 落盘：下一条 CLI 命令连上来时自动重放（Emulation 是会话级的）
    state.write(ROOT, DEFAULTS.userDataName, { viewport: { width, height } });
    return { ...(await c.eval(`({ vw: window.innerWidth, vh: window.innerHeight })`)), requested: `${width}x${height}`, scale: win && win.scale, windowResized: !!(win && win.ok) };
}

/**
 * 移动模拟档（2026-11-14 建立，用户 m06113 拍板的「方案 A」）。
 *
 * 🔴 为什么必须存在这一档：Obsidian 手机版**不是 Electron，是 Capacitor WebView**，
 *    那边**没有 `process` 全局**、`Platform.isMobileApp === true`。
 *    在本机桌面 Obsidian 里把窗口拖到 400px 宽只能验证 CSS —— `Platform.isMobileApp`
 *    由**宿主**决定而不是视口宽度决定，所以拖窗口**永远**测不到本次白屏那条路径。
 *
 * 这一档做三件事（缺一不可）：
 *   ① `Emulation.setDeviceMetricsOverride({ mobile: true, deviceScaleFactor: 3 })`
 *      + `Emulation.setTouchEmulationEnabled` —— 让触摸事件、无 hover、无右键的判定真实成立；
 *   ② `Network.setUserAgentOverride` 换成 iPhone UA —— 部分代码按 UA 分支；
 *   ③ `window.__rlMobilePatch()` —— 删掉 `process` 并把 `Platform.isMobileApp` 改成 true。
 *      ⚠️ 这层是 **monkey-patch**，属于「模拟」不属于「真机」；它只能证明「代码在移动端运行时
 *      路径上不崩」，⛔ 不能替真机证明渲染像素一致。
 */
const MOBILE_DEVICE = {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

/**
 * 在渲染进程里把环境改成「手机端」：
 * - 删掉 `process`（WebView 里本来就没有）；
 * - 把 `Platform.isMobileApp` / `isMobile` / `isPhone` 写成 true。
 *
 * 🔴 `delete globalThis.process` 本机实测可行（Node 26 里它是 `configurable: true` 的 getter），
 *    且 `typeof process === 'undefined'` 这个判断在删掉后是安全的 —— 与 `globalThis.process = undefined`
 *    不同（后者 `'process' in globalThis` 仍为 true）。
 * 🔴 `Platform` 来自 obsidian 模块，可能是**不可写**的 getter ⇒ 逐字段 try，
 *    失败时把失败字段如实返回，⛔ 不要假装成功。
 */
const MOBILE_PATCH_SCRIPT = `(() => {
    const out = { processDeleted: false, platformPatched: [], platformFailed: [] };

    // 🔴 2026-11-14 实测结论（务必保留）：**不能删 process**。
    //    删掉之后 Obsidian 宿主自己的 app.setting.open() 会抛
    //    \`TypeError: Cannot read properties of undefined (reading 'platform')\`
    //    （栈顶在 app://obsidian.md/app.js 的 \`new e\`）—— 桌面宿主本身就依赖 process。
    //    所以「无 process 时插件不崩」这条只能由单测覆盖（tests/mobileRuntime.test.ts），
    //    UI 级模拟只切 app.isMobile，两件事分开验。
    out.processDeleted = (typeof globalThis.process === 'undefined');
    // 如果调用方显式要求删（opt.dropProcess），才删；默认不删。
    if (out.processDeleted) out.platformPatched.push('process 早已缺失');

    // 真正生效的通道：window.app.isMobile（own-property、{writable:true, configurable:true}）。
    // 注意：obsidian 模块不在渲染进程 require.cache 里（window.require('obsidian') 抛
    // Cannot find module），它只在插件 bundle 作用域内注入 ⇒ 从页面外部改不到
    // Platform.isMobileApp。这里只记录事实，不假装成功。
    try {
        const app = window.app;
        if (app && 'isMobile' in app) {
            app.isMobile = true;
            if (app.isMobile === true) out.platformPatched.push('app.isMobile');
        }
    } catch (e) {
        out.platformFailed.push('app.isMobile: ' + String((e && e.message) || e));
    }
    out.appIsMobile = !!(window.app && window.app.isMobile);
    return out;
})()`;

/** 只做会话内的视口覆盖（内部用；真机窗口另走 Win32） */
async function applyViewport(c, width, height, opt = {}) {
    const mobile = !!opt.mobile;
    await c.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: mobile ? MOBILE_DEVICE.deviceScaleFactor : 1,
        mobile,
    });
    if (mobile) {
        // 触摸 + 无 hover：手机上 `mouseenter` 不会有，「长按 = 右键」也不存在
        try {
            await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        } catch (e) {
            // 某些 Electron 版本没有这个域；触摸模拟失败不阻断视口，但要留痕
            console.warn('[cdp] setTouchEmulationEnabled 不可用：' + (e && e.message));
        }
        try {
            await c.send('Network.setUserAgentOverride', { userAgent: MOBILE_DEVICE.ua, platform: 'iPhone' });
        } catch (e) {
            console.warn('[cdp] setUserAgentOverride 不可用：' + (e && e.message));
        }
    }
    await sleep(500);
    return c.eval(`({ vw: window.innerWidth, vh: window.innerHeight })`);
}

/**
 * 把当前会话切到「手机端」：视口 + 触摸 + UA + 删 process + 改 Platform。
 * @returns 打补丁的结果（含失败字段，供 CLI 如实打印）
 */
async function enterMobileMode(c, opt = {}) {
    const width = Number(opt.width) || MOBILE_DEVICE.width;
    const height = Number(opt.height) || MOBILE_DEVICE.height;
    await applyViewport(c, width, height, { mobile: true });
    const patch = await c.eval(MOBILE_PATCH_SCRIPT);
    return { width, height, patch };
}

/**
 * 明暗主题（真机主题 = `body` 上的 theme-dark / theme-light，插件 CSS 全靠它分档）。
 *
 * 🔴 正确 API 是 **`app.vault.setConfig('theme', ...)`**，不是 `app.setTheme()` / `customCss.setTheme()`：
 *    后两者实测都是**静默无效**（`customCss.themes` 只列用户装的第三方主题，没有内建名，
 *    传 `'obsidian'` / `'moonstone'` / `''` 一律不切，且不报错）。
 *    配置项取值：`'obsidian'` = 暗色，`'moonstone'` = 亮色，`'system'` = 跟随系统（默认）。
 */
async function setTheme(c, theme) {
    const want = theme === 'dark' ? 'obsidian' : theme === 'light' ? 'moonstone' : theme;
    await c.eval(`(async () => {
        const app = window.app;
        app.vault.setConfig('theme', ${JSON.stringify(want)});
        await new Promise(r => setTimeout(r, 1200));
        return true;
    })()`);
    return c.eval(`document.body.classList.contains('theme-dark') ? 'dark' : 'light'`);
}

/**
 * 真实鼠标点击（CDP Input 域）—— 比 `el.click()` 更接近真人：
 * 走命中测试、会触发 mouseenter/mouseleave，Obsidian 的悬停浮层与原生 Menu 都只认真实事件。
 * @param {string} selector CSS 选择器
 * @param {{index?:number}} [opt] 命中多个时取第几个
 */
async function realClick(c, selector, opt = {}) {
    const idx = opt.index || 0;
    const box = await c.eval(`(() => {
        const els = document.querySelectorAll(${JSON.stringify(selector)});
        const el = els[${idx}];
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    })()`);
    if (!box) throw new Error('元素不存在: ' + selector + (idx ? ' #' + idx : ''));
    if (box.w <= 0 || box.h <= 0) throw new Error('元素不可见（尺寸 0）: ' + selector);
    const base = { x: box.x, y: box.y, button: 'left', clickCount: 1, pointerType: 'mouse' };
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', clickCount: 0 });
    await sleep(150);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await sleep(80);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    await sleep(600);
    return box;
}

/** 悬停（触发 mouseenter；Obsidian 的浮层菜单靠它展开） */
async function hover(c, selector, opt = {}) {
    const idx = opt.index || 0;
    const box = await c.eval(`(() => {
        const el = document.querySelectorAll(${JSON.stringify(selector)})[${idx}];
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })()`);
    if (!box) throw new Error('元素不存在: ' + selector);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', clickCount: 0 });
    await sleep(400);
    return box;
}

/**
 * 当前「页菜单」里的条目文本与选择器。
 * 🔴 两种形态都要认：
 *   ⑴ Obsidian 原生菜单（`.menu .menu-item`）—— 其他弹窗/右键菜单；
 *   ⑵ 本插件**自绘**的「更多」页菜单（`.rl-more-pop`，role=menu，子项是按钮/div）——
 *      merged 导航布局下切页走的就是它。⛔ 只认 `.menu` 会把插件菜单漏掉（实测踩过）。
 */
const MENU_ITEM_SEL = '.menu .menu-item, .rl-more-pop [role="menuitem"], .rl-more-pop button, .rl-more-pop > *';

async function menuItems(c) {
    return c.eval(`Array.from(document.querySelectorAll(${JSON.stringify(MENU_ITEM_SEL)}))
        .map(e => e.textContent.trim()).filter(Boolean)`);
}

/** 按文本点菜单项 */
async function clickMenuItem(c, text) {
    const ok = await c.eval(`(() => {
        const items = Array.from(document.querySelectorAll(${JSON.stringify(MENU_ITEM_SEL)}));
        const hit = items.find(e => e.textContent.trim() === ${JSON.stringify(text)});
        if (!hit) return false;
        hit.click();
        return true;
    })()`);
    await sleep(700);
    return ok;
}

/** 截图：整窗 / 指定选择器所在元素的矩形区域 */
async function screenshot(c, outPath, opts = {}) {
    let clip;
    if (opts.selector) {
        const rect = await c.eval(`(() => {
            const el = document.querySelector(${JSON.stringify(opts.selector)});
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { x: b.x, y: b.y, width: b.width, height: b.height };
        })()`);
        if (!rect) throw new Error(`截图元素不存在: ${opts.selector}`);
        clip = { ...rect, scale: opts.scale || 1 };
    } else if (opts.scale && opts.scale !== 1) {
        const size = await c.eval(`({ width: window.innerWidth, height: window.innerHeight })`);
        clip = { x: 0, y: 0, width: size.width, height: size.height, scale: opts.scale };
    }
    const shot = await c.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: false } : {}) });
    const buf = Buffer.from(shot.data, 'base64');
    fs.mkdirSync(path.dirname(path.resolve(ROOT, outPath)), { recursive: true });
    fs.writeFileSync(path.resolve(ROOT, outPath), buf);
    return { path: path.resolve(ROOT, outPath), bytes: buf.length, clip: clip || null };
}

/**
 * 收集控制台错误与未捕获异常（插件运行期真实报错 —— 复现页永远抓不到这类）。
 *
 * 🔴 **必须丢弃历史事件**：`Runtime.enable` 会把连接前缓冲区里的异常/日志**重放**给新连接，
 *    而每个 CLI 子命令都是一次新连接 ⇒ 不丢弃的话，早先某次操作留下的旧报错会被反复
 *    当作「本次报错」报出来（实测：静置 2s 零异常，但只要 `collectErrors` 一开就冒出 2 条
 *    几分钟前的 `setUiTheme` 错误 —— 会直接误导人以为改动引发了新问题）。
 *    做法：`enable` 后先静置一小段，把这期间到达的事件全部丢弃，之后才开始记账。
 */
async function collectErrors(c, settleMs = 400) {
    const errors = [];
    let recording = false;
    c.on('Runtime.exceptionThrown', (p) => {
        if (!recording) return;
        const d = p.exceptionDetails || {};
        errors.push({ kind: 'exception', text: d.text, desc: d.exception && d.exception.description });
    });
    c.on('Runtime.consoleAPICalled', (p) => {
        if (!recording) return;
        if (p.type !== 'error' && p.type !== 'warning') return;
        const text = (p.args || [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
            .join(' ');
        errors.push({ kind: 'console:' + p.type, text });
    });
    await c.send('Runtime.enable').catch(() => {});
    await sleep(settleMs); // 把重放的历史事件吃掉
    recording = true;
    /** 清空已记录（「只关心这一步之后」的场景，如 dev 每次重载） */
    errors.reset = () => {
        errors.length = 0;
    };
    return errors;
}

module.exports = {
    DEFAULTS,
    ROOT,
    sleep,
    connect,
    launch,
    shutdown,
    killHarness,
    findHarnessProcs,
    waitForApp,
    isPortAlive,
    openHomeView,
    clickTab,
    collapseSidebars,
    realClick,
    hover,
    menuItems,
    clickMenuItem,
    waitFor,
    setViewport,
    setTheme,
    enterMobileMode,
    MOBILE_DEVICE,
    screenshot,
    collectErrors,
};
