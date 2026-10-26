/**
 * 创建 / 刷新**隔离真机库** `.testvault`。
 *
 * 🔴 为什么要隔离库（而不是直接驱动用户在用的 `临时测试库`）：
 *  - 测试会把状态改掉（切页签 / 改设置 / 建临时条目），污染用户真实库；
 *  - `--user-data-dir` 独立后，用户当前打开的窗口不会被抢焦点、也不会共享 workspace 布局。
 *
 * ⚠️ 踩过的两个坑（已在代码里兜住）：
 *  ⑴ **必须预写 `obsidian.json`**：否则真机停在 `starter.html`（「打开库」选择页），
 *     `window.app` 为 undefined —— 现象是「CDP 连上了但什么都读不到」。
 *  ⑵ **`community-plugins.json` 必须与实际安装的插件目录一致**：源库该文件里列了 5 个插件、
 *     实际只装了 3 个 ⇒ Obsidian 加载中止，目标插件**静默不加载**（`plugins.plugins[id]` 为空）。
 *
 * 用法：
 *   node tools/make-testvault.cjs                 # 增量刷新（保留已存在的大文件，快）
 *   node tools/make-testvault.cjs --full          # 全量重建
 *   node tools/make-testvault.cjs --from <源库>   # 换源库
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DEFAULTS, ROOT } = require('./realdevice/cdp.cjs');

const args = process.argv.slice(2);
const full = args.includes('--full');
const fromIdx = args.indexOf('--from');
const source = fromIdx >= 0 ? args[fromIdx + 1] : DEFAULTS.sourceVault;
const target = path.resolve(ROOT, DEFAULTS.vaultName);
const pluginId = DEFAULTS.pluginId;

// 这些目录是纯媒体/下载缓存，测试不需要（省 500MB+）
const SKIP_DIRS = new Set(['下载', '.trash']);

function rmrf(p) {
    fs.rmSync(p, { recursive: true, force: true });
}

/** 增量拷贝：内容没变就跳过，避免每次几十秒。
 *
 * 🔴 判据必须是**内容**，⛔ 不能用 mtime：`copyFileSync` 不保留源文件 mtime，
 *    目标那份的 mtime 是「上次拷贝的时刻」⇒ 恒大于源 ⇒ 「源更新了」永远判不出来。
 *    实测踩过：重新构建后 `make-testvault` 报「已就绪」，但隔离库里的 `main.js`
 *    还是旧产物（md5 不一致），真机跑的是上一版代码 —— 表现为「明明改了却没生效」。
 * 🔴 **产品产物（main.js / styles.css / manifest.json）永远无条件覆盖** —— 它们才是真机真正加载的东西，
 *    在这里省一次拷贝毫无意义，省出问题来却极难查。
 * ⚠️ 其余文件一旦读取失败（Obsidian 正在独占写缓存文件）⇒ **跳过那一份**，⛔ 不要让整个脚本卡死。
 */
const BUNDLE_FILES = new Set(['main.js', 'styles.css', 'manifest.json']);

function sameContent(src, dst) {
    const a = fs.statSync(src);
    const b = fs.statSync(dst);
    if (a.size !== b.size) return false;
    if (a.size > 512 * 1024) return true; // 大二进制：等长视为未变
    try {
        return fs.readFileSync(src).equals(fs.readFileSync(dst));
    } catch {
        return false; // 被占用 ⇒ 当作已变，交给下面的 copyFileSync（失败也不致命）
    }
}

function copyDir(src, dst, force) {
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (SKIP_DIRS.has(ent.name) && !force) continue;
        const s = path.join(src, ent.name);
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) {
            copyDir(s, d, force);
        } else {
            if (!force && !BUNDLE_FILES.has(ent.name) && fs.existsSync(d) && sameContent(s, d)) continue;
            try {
                fs.copyFileSync(s, d);
            } catch (e) {
                if (BUNDLE_FILES.has(ent.name)) throw e; // 产物拷不动 = 必须报错
                console.warn(`  跳过（被占用）：${path.relative(src, s)}`);
            }
        }
    }
}

console.log(`源库: ${source}`);
console.log(`目标: ${target}${full ? '（全量重建）' : '（增量）'}`);

if (!fs.existsSync(source)) {
    console.error(`✗ 源库不存在：${source}\n  用 --from <路径> 指定，或先装好测试库。`);
    process.exit(1);
}

if (full) {
    rmrf(target);
}
const t0 = Date.now();
// 全量重建时 force=true（空目录无所谓，语义更直白）；增量时按内容比对跳过
copyDir(source, target, full);

// ── ⓪ 仓库根的**构建产物**覆盖进隔离库 ────────────────────────────────────
// 🔴🔴 这一步以前**漏了**，代价很惨：`copyDir` 拷的是**源测试库**，它那份 main.js 是用户上次部署的，
//    与本仓刚构建的产物毫无关系 ⇒ 「构建了、make-testvault 也说就绪，但真机跑的是上一版代码」。
//    现象是「我明明改了却没生效」，极难查（本次 #687 排查就栽在这里）。
// ⚠️ 产物以**仓库根**为准（那是本次构建的输出）；源测试库那份只当兜底（仓库根缺文件时才用）。
const BUNDLE = ['main.js', 'styles.css', 'manifest.json'];
const pluginDir = path.join(pluginsDirOf(target), pluginId);
for (const f of BUNDLE) {
    const srcFile = path.join(ROOT, f);
    if (!fs.existsSync(srcFile)) {
        console.warn(`  ⚠ 仓库根没有 ${f}（先构建），沿用源库那份`);
        continue;
    }
    fs.copyFileSync(srcFile, path.join(pluginDir, f));
}
function pluginsDirOf(vault) {
    return path.join(vault, '.obsidian', 'plugins');
}

// ── ① 只启用「真装了的」插件，并保证目标插件在列 ───────────────────────────
const pluginsDir = path.join(target, '.obsidian', 'plugins');
const installed = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(pluginsDir, d.name, 'manifest.json'))).map((d) => d.name)
    : [];
const listFile = path.join(target, '.obsidian', 'community-plugins.json');
let enabled = [];
try {
    enabled = JSON.parse(fs.readFileSync(listFile, 'utf8'));
} catch {
    enabled = [];
}
const enabledValid = enabled.filter((id) => installed.includes(id));
if (!enabledValid.includes(pluginId)) enabledValid.push(pluginId);
fs.writeFileSync(listFile, JSON.stringify(enabledValid, null, 2), 'utf8');
console.log(`① 插件：已装 [${installed.join(', ')}] → 启用 [${enabledValid.join(', ')}]`);
if (enabled.length !== enabledValid.length) {
    console.log(`   剔除了源库里列了但没装的 ${enabled.length - enabledValid.length} 个（否则 Obsidian 会中止加载插件）`);
}

// ── ② 插件本体必须存在（缺了直接报错，别到真机里才静默失败）───────────────
const mainJs = path.join(pluginsDir, pluginId, 'main.js');
if (!fs.existsSync(mainJs)) {
    console.error(`✗ 目标插件未安装：${mainJs}\n  先部署：node _deploy.cjs（或把产物拷进隔离库）`);
    process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(pluginsDir, pluginId, 'manifest.json'), 'utf8'));
console.log(`② 插件本体: ${pluginId}@${manifest.version}  main.js=${(fs.statSync(mainJs).size / 1e6).toFixed(1)}MB`);

// ── ②b 产物一致性校验（🔴 别省：隔离库跑旧产物时，现象是「改了没生效」，极难查）──
const crypto = require('crypto');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
const stale = [];
for (const f of ['main.js', 'styles.css', 'manifest.json']) {
    const srcFile = path.join(ROOT, f);
    const dstFile = path.join(pluginsDir, pluginId, f);
    if (!fs.existsSync(srcFile) || !fs.existsSync(dstFile)) continue;
    if (md5(srcFile) !== md5(dstFile)) stale.push(f);
}
if (stale.length) {
    console.error(`✗ 隔离库里的产物与仓库不一致：${stale.join(', ')}`);
    console.error(`  先构建（node esbuild.config.mjs production）再重跑本脚本。`);
    process.exit(1);
}
console.log(`②b 产物 md5 一致（main.js / styles.css / manifest.json）`);

// ── ③ 报告 ─────────────────────────────────────────────────────────────────
const count = fs.readdirSync(target, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '.obsidian').map((d) => d.name);
console.log(`③ 内容目录: ${count.join(', ')}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`\n✓ 隔离库就绪。启动真机：node tools/rd.cjs launch`);
