# tools/ —— 开发工具

## 真机测试（`rd.cjs`）⭐

用 **CDP 驱动一台真实的 Obsidian 实例**，在真插件加载、真 Svelte 渲染、真 Obsidian CSS / 主题 / 祖先链下做断言与截图。

> **和复现页的区别**：复现页是手搭 HTML，样式与祖先链靠人抄 —— 抄漏了、Obsidian 的级联覆盖了、
> 主题变量实际取到别的值，复现页都**不会告诉你**。真机里 `window.app` 就是 Obsidian App，
> 看到的就是用户看到的。

### 为什么是 CDP（而不是 `dsh-obsidian-plugin` / `DSH Bridge` / `obsidian-playwright-mcp`）

| 方案 | 能否用于本仓 | 说明 |
|---|---|---|
| **CDP 直连（本工具）** | ✅ 已落地 | Obsidian 是 Electron，`--remote-debugging-port` 即开即用；**零新依赖**（WS 用 DSH 自带的 `ws`） |
| `obsidian-playwright-mcp` 类 | ❌ 不适用 | 面向**网页版** Obsidian（`app.obsidian.md`），桌面端插件（Node 传输层、`app://` 资源、本地文件）跑不起来 |
| `dsh-obsidian-plugin` / `DSH Bridge` | ❌ 无需 | 它们是「让 Agent 去操作**用户的真实库**」，而这里要的是「**隔离的**可断言测试环境」，用 CDP 直连更直接、且不污染用户的库 |

### 快速上手

```bash
# ① 一次性：从测试库建隔离副本（源库可用 --from 指定）
node tools/make-testvault.cjs

# ② 启动隔离真机（后台实例，不抢你正在用的窗口）
node tools/rd.cjs launch

# ③ 整理成可截图可断言的干净画面（定视口 / 收侧边栏 / 开主视图）
node tools/rd.cjs setup --size 1440x900 --tab media

# ④ 截图 / 断言
node tools/rd.cjs shot --out _shot/rd/home.png
node tools/rd.cjs check view
node tools/rd.cjs check overflow '.rl-card'
node tools/rd.cjs check computed '.rl-card' 'border-radius,box-shadow'

# ⑤ 编辑循环：改了产物自动热部署 + 真机重载 + 截图（Ctrl+C 退出）
node tools/rd.cjs dev --tab media --shot

# ⑥ 收工
node tools/rd.cjs stop
```

### 子命令

| 命令 | 作用 |
|---|---|
| `status` | 真机在不在、插件版本、主视图数量 |
| `launch` / `restart` / `stop` | 启动 / 强重启 / 关闭（**只动 harness 实例**，不碰你自己的 Obsidian） |
| `setup [--size 1440x900] [--tab media] [--set dark]` | 定视口 → 收侧边栏 → 只留主视图 → 可选主题/页签 |
| `viewport --size WxH` / `theme --set dark\|light` | 单独调视口 / 主题（会**落盘**，后续命令自动重放） |
| `scenario <name> [arg]` | `home` / `tab <media\|stats\|…>` / `settings` / `addEntry <type>` / `reset` |
| `shot [--out p] [--selector s] [--scale 2]` | 整窗或单元素截图 |
| `check <检测器> [参数]` | 见下表 |
| `dev [--tab x] [--shot]` | 编辑循环（监视 `main.js` / `styles.css` / `manifest.json`） |

### `check` 检测器

| 检测器 | 用途 |
|---|---|
| `view` | 主视图是否挂载、当前页签、内容区尺寸、卡片数 |
| `theme` | `--background-primary` / `--interactive-accent` 等主题变量是否真取到，明暗与亮度是否自洽 |
| `overflow <sel>` | 元素**滚动溢出**或**越出父容器**（布局最常翻车的面） |
| `alignment <sel> [left\|right\|center] [容差]` | 一组元素的边缘是否共用一条线 |
| `computed <sel> <属性,属性>` | 某条 CSS 是否真的作用到了（**排查级联被覆盖**最有用） |
| `wrap <sel> [期望行数]` | 单行控件是否被挤成多行 |
| `expr "<js>"` | 自由求值（一次性排查） |

退出码：`PASS` 且**无控制台报错** ⇒ 0；否则 1。可直接接进脚本。

### 隔离设计

| 项 | 路径 | 说明 |
|---|---|---|
| 隔离库 | `.testvault/` | 从源库拷贝；自动剔掉「列了但没装」的插件（否则 Obsidian 会中止加载插件） |
| 独立 userdata | `.testvault-userdata/` | `--user-data-dir` 独立 ⇒ 不抢用户当前窗口、不共享 workspace 布局 |
| 会话状态 | `.testvault-userdata/rd-session.json` | 视口/主题落盘，跨 CLI 命令重放 |

两者都在 `.gitignore` 里。插件本体从 `.testvault/.obsidian/plugins/obsidian-reelludic/` 读取 ——
`rd dev` 每次都会把仓库根的产物拷进去。

---

## 踩过的坑（重要，改本工具前先读）

| 坑 | 现象 | 正解 |
|---|---|---|
| **`obsidian.json` 没预置** | 真机停在「打开库」页，`window.app` 为 undefined，CDP 连上了却什么都读不到 | 启动前写 `obsidian.json` 登记库（`cdp.launch` 已内置） |
| **`community-plugins.json` 与已装插件不一致** | 目标插件**静默不加载**（`plugins.plugins[id]` 为空） | 按实际插件目录重写该文件（`make-testvault.cjs` 已内置） |
| **CDP 没有 `Browser.*` 窗口域** | `Browser.getWindowForTarget wasn't found` | Electron 不支持；改 Win32 `SetWindowPos`（`winwindow.cjs`） |
| **Win32 改窗口尺寸后渲染进程不重排** | 外框已是 1440×900，但 `innerWidth`/截图仍是 800×599 | 用 `Emulation.setDeviceMetricsOverride`（真机渲染 + 真 CSS，只有视口数值由 CDP 指定） |
| **Emulation 是会话级的** | `setup` 设好的视口，下一条 `shot` 又变回去 | 视口/主题落盘到 `rd-session.json`，每次连接重放 |
| **`Runtime.enable` 重放历史异常** | 早先某次操作的旧报错被当成「本次报错」反复报出（实测静置 0 异常却报 2 条） | `collectErrors` 先静置 400ms 丢弃重放事件，再开始记账 |
| **Obsidian 1.14.4 没有 `reloadPlugin`** | `reloadPlugin is not a function` | 用 `unloadPlugin` + `loadPlugin` |
| **视图没拆干净就重载** | `leaf.view.setUiTheme is not a function`（`applyUiTheme` 在 `onload` 里遍历 leaf） | 重载前 `detach` 并**等 leaf 真消失**；实测拆干净后 0 报错 |
| **侧边栏占满宽度** | 1440px 窗口里主视图只剩 210px，卡片挤成一列竖条（像布局炸了） | `setup` 先收两侧侧边栏 |
| **「更多」菜单不是原生 `.menu`** | 找不到菜单项 | merged 导航下是插件自绘 `.rl-more-pop`；且需**先 hover 再点**才稳定展开 |
| **切主题的两个 API 都静默无效** | `app.setTheme('obsidian')` / `customCss.setTheme(...)` 调完仍是浅色，**不报错** | 用 `app.vault.setConfig('theme', ...)`：`'obsidian'`=暗色 / `'moonstone'`=亮色 / `'system'`=跟随系统（`customCss.themes` 只列第三方主题，没有内建名） |
| **⚡ 用 PowerShell 改文件会毁中文** | `Set-Content -Encoding utf8` 走 ANSI 时中文变乱码、字符串被截断、还加 BOM | **改仓库文件一律用 write/edit 工具**，别用 PowerShell 重写文本 |

---

## 其他工具

| 文件 | 用途 |
|---|---|
| `mk-sim.mjs` | 复现页构建：把 `_shot/src/*.html` 里的 `@@INCLUDE@@` 内联成 `<style>` |
| `extract-poster-css.mjs` | 从产物抽取海报墙相关 CSS（复现页用） |
| `strip-backticks.cjs` | 去掉多余反引号 |
