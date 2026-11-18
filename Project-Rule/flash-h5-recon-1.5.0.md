# Flash / H5 载体与存档落点勘察（ReelLudic 1.5.0）

> 只读勘察报告。⛔ 本次未修改任何源文件。
> 目标：核对用户第 ① 条需求「SWF/H5 载体目录约定」在 1.5.0 代码里的**现状**，为后续改动定最小面。
>
> 用户第 ① 条需求（逐字）：
> 「SWF/H5 载体目录约定：
> - 单文件无存档 SWF 直接放 `games/swf/` 统一管理，条目关联对应 `.swf`；
> - 单文件 SWF 有存档做独立目录（放 swf 入口 + sol 文件 / base64 字符串 / JSON 存档文件，存档是导出备份，需通过导入功能恢复）；
> - 多文件 SWF 做独立目录（含 swf），其下 `saves/` 放存档文件；
> - H5 游戏做网页嵌入，账号登录用弹窗 + OAuth 2.0 PKCE。」

---

## A. 现有目录与落点约定

### A1. 「游戏目录」设置项的真源

**键名**：`gameDownloadDir`（可选字段 `string`）

| 位置 | 原文 |
| --- | --- |
| `src/Settings.ts:463` | `gameDownloadDir?: string;` |
| `src/Settings.ts:457`（注释） | 游戏（swf）的**下载 / 存放目录**（append-only 可选字段；留空 = `下载/Flash 游戏`） |
| `src/Settings.ts:1107` | `gameDownloadDir: DOWNLOAD_DIR_DEFAULT.flash,` |
| `src/Settings.ts:1105-1106`（注释） | 缺省就得带 `Flash 游戏` 这一层，否则默认落点会从 `下载/Flash 游戏` 变成 `下载/` |

**默认值的真源**在纯层常量表，不在 Settings：

| 位置 | 原文 |
| --- | --- |
| `src/pure/downloadPlan.ts:30` | `export const DOWNLOAD_ROOT_DEFAULT = '下载';` |
| `src/pure/downloadPlan.ts:49` | ``flash: `${DOWNLOAD_ROOT_DEFAULT}/Flash 游戏`,`` |

**结论（明确回答「默认值到底是哪个」）**：默认值是 **`下载/Flash 游戏`**，**不是** `games/swf/`。
全仓不存在 `games/swf` 这个字面量（检索关键词：`games/swf`、`games`、`swfDir`、`gameFolder` —— `games/swf` 零命中）。

**UI 入口**（设置 › 播放阅读 › 启用内置游戏启动器 › 游戏目录）：

| 位置 | 原文 |
| --- | --- |
| `src/Settings.ts:7517` | `const game = new Setting(parent).setName('启用内置游戏启动器').setDesc('在插件内启动本地 Flash 游戏');` |
| `src/Settings.ts:7529-7540` | `this.createLibraryDirRow(panel, '游戏目录', 'Flash 游戏文件的存放与检索目录', () => this.plugin.settings.gameDownloadDir, async (next) => { this.plugin.settings.gameDownloadDir = next; await this.plugin.saveSettings(); }, 'game', 'flash');` |

开关本身：`src/Settings.ts:455` `internalGameLauncher?: boolean;`、`src/Settings.ts:1097` `internalGameLauncher: true,`（缺省 **true**）。

### A2. SWF 下载落点：真正的拼接函数

落点由**两段**拼成：设置项 → `downloadDir()` 归一 → 再追加一层「游戏名」目录。

**第一段（设置 → 基准目录）**：`src/pure/downloadPlan.ts:196-198`

```ts
export function downloadDir(root: string | undefined, kind: DownloadKind): string {
    return normalizeDownloadRoot(root, kind);
}
```

注释 `src/pure/downloadPlan.ts:189` 逐字：「#459 起 = 设置项的值**本身**，⛔ 不再拼 `音乐/` `书籍/` 子目录」，且「落盘与检索库内同名文件必须都走这一个函数」。

**第二段（基准目录 → 游戏专属目录）**：`main.ts:8310-8312`（函数 `fetchGameSwf` 内）

```ts
const gameFolder = gameName ? sanitizeDownloadName(gameName) : '';
const baseDir = downloadDir(this.settings.gameDownloadDir, 'flash');
const gameDir = gameFolder ? `${baseDir}/${gameFolder}` : baseDir;
```

落盘调用：`main.ts:8318-8331`，其中 `main.ts:8331` —— `root: gameDir,`。

设计动机（`main.ts:8302-8309` 逐字摘录）：「我们此前把**所有游戏**的 swf 与资源平铺在 `下载/Flash 游戏/` 一张桌上，两个后果：① 用户看到的是一堆 `04.swf` / `sounds/bgm.mp3`，分不清哪个属于哪个游戏；② 🔴 两个游戏都引用 `sounds/bgm.mp3` 时**互相覆盖** ⇒ 改成每个游戏一个目录」。

**文件名**：`main.ts:8301` `const filename = gameName ? \`${sanitizeDownloadName(gameName)}.swf\` : swfFileNameOf(swfUrl, 'flash-game');`

**扩展名白名单**：`src/pure/downloadPlan.ts:69` `flash: ['swf'],`，注释 `:66-68` 明确「只认 swf，⛔ 别把关联资源也加进来」。

**结论**：真正算「swf 该放哪」的只有一个表达式——`downloadDir(this.settings.gameDownloadDir, 'flash')` + `/<sanitizeDownloadName(标题)>/`。**多文件游戏的关联资源自动跟随**，因为它按主影片父目录拼（`main.ts:8308-8309`：「`fetchFlashAssets` 是按 `mainRelPath` 的**父目录**拼的」）。

### A3. 存档落点：`saveGameSaves` / `loadGameSaves` 全文

**落点注释**（`main.ts:8603` 逐字）：「落点：`pluginDir()/saves/<entryId>.json`（不进库：存档是运行期产物，进库会被同步/备份带上，且用户一般不想它们出现在文件列表里）」

**读**（`main.ts:8607-8624` 全文，含注释 `:8595-8606`）：

```ts
    async loadGameSaves(entryId: string): Promise<Record<string, string>> {
        const id = String(entryId ?? '').trim();
        if (!id) return {};
        try {
            const fsMod = require('node:fs') as typeof import('node:fs');
            const file = this.gameSaveFile(id);
            if (!file || !fsMod.existsSync(file)) return {};
            const raw = JSON.parse(fsMod.readFileSync(file, 'utf8')) as unknown;
            if (!raw || typeof raw !== 'object') return {};
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0) out[k] = v;
            }
            return out;
        } catch {
            return {};
        }
    }
```

**写**（`main.ts:8632-8651` 全文，含注释 `:8626-8631`）：

```ts
    async saveGameSaves(entryId: string, saves: Record<string, string>): Promise<void> {
        const id = String(entryId ?? '').trim();
        if (!id) return;
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(saves ?? {})) {
            if (typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) return;
        try {
            const fsMod = require('node:fs') as typeof import('node:fs');
            const file = this.gameSaveFile(id);
            if (!file) return;
            const dir = this.gameSaveDir();
            if (!dir) return;
            if (!fsMod.existsSync(dir)) fsMod.mkdirSync(dir, { recursive: true });
            fsMod.writeFileSync(file, JSON.stringify(clean));
        } catch {
            /* 存档写不进去不影响游戏继续 */
        }
    }
```

**两个私有 helper**：

| 位置 | 原文 |
| --- | --- |
| `main.ts:8653-8657` | `/** 存档目录（`pluginDir()/saves`；拿不到插件目录就空串） */`<br>`private gameSaveDir(): string {`<br>`    const base = this.pluginDir();`<br>`    return base ? \`${base}/saves\` : '';`<br>`}` |
| `main.ts:8659-8666` | `/** 单个条目的存档文件绝对路径（entryId 做文件名，⛔ 别用标题 —— 标题会改） */`<br>`private gameSaveFile(entryId: string): string {`<br>`    const dir = this.gameSaveDir();`<br>`    if (!dir) return '';`<br>`    // 只留安全字符：entryId 形如 \`e_1788180352140_9vf1\`，正常不会有别的字符`<br>`    const safe = String(entryId).replace(/[^A-Za-z0-9_-]/g, '_');`<br>`    return safe ? \`${dir}/${safe}.json\` : '';`<br>`}` |

`pluginDir()` 的定义在 `main.ts:6854-6866`，返回 `库根/.obsidian/plugins/<id>`（拿不到库根返回空串）。

**三种形态的支持情况（逐条判定）**：

| 形态 | 现状 | 证据 |
| --- | --- | --- |
| JSON 存档文件 | ✅ **只有这一种** | `main.ts:8647` `fsMod.writeFileSync(file, JSON.stringify(clean));` |
| sol 二进制文件 | ❌ **无** | 全仓 `.sol` 只出现在注释里（`main.ts:8596`、`src/pure/flashGame.ts:160/162/392`），无任何 `readFileSync`/`writeFileSync` 处理二进制 sol |
| base64 字符串 | ❌ **无** | 存档值是 **localStorage 原样的字符串**（`src/pure/flashGame.ts:273` `localStorage.setItem(k, saves[k])`），不是独立的 base64 存档文件形态 |
| 导入 / 导出备份 | ❌ **无** | 全仓无任何「导入存档」「导出存档」命令、按钮或方法；存档只在游戏运行期自动读写 |

**存档的 key 形态**（决定「sol 文件」这条路能不能直接落地）：`src/pure/flashGame.ts:163` 注释 —— 「存在**宿主网页的 localStorage** 里，key 形如 `<hostname>/<swf 目录>/<名字>`」；`src/pure/flashGame.ts:395` 再确认：「key 形态是 hostname/目录/名字，原样带回，由宿主按条目隔离落盘」。

### A4. 条目如何关联 swf：`MediaEntry` 里跟游戏载体有关的**全部**字段

全部在 `src/data/types.ts`，逐个给行号 + 注释原文：

| 行号 | 字段 | 注释原文（摘） |
| --- | --- | --- |
| `src/data/types.ts:250-251` | `gameLaunchPath?: string;` | 「游戏启动快捷方式（.lnk）路径（game 类型；vault 相对优先，库外绝对兼容；「▶ 启动」打开）」 |
| `src/data/types.ts:258` | `gameUrl?: string;` | 「游戏**网络路径**（#534；append-only 可选字段）。用户裁定「游戏**不接**在线检索源 —— 仅在右键弹窗加网络路径框（加粘贴文字按钮）」… ⚠️ 与 `sourceUrl`（数据来源平台页，搜索回填自动记录）不是一回事：那是出处，这是手填的入口。」 |
| `src/data/types.ts:270` | `gameSwf?: string;` | 「游戏**本地 Flash 影片**（.swf；append-only 可选字段，2026-11-16 用户裁定「先做本地 swf 播放」）。语义 = 「这个游戏挂了一个本地 swf，点「▶ 启动」在插件内用 Ruffle 直接玩」—— 与 `gameLaunchPath`（.lnk/.exe，交给系统 shell 拉起外部程序）**并列**，不是它的替代：两者都填时**swf 优先**。⚠️ 值可以是**库内相对路径**或**库外绝对路径**」 |
| `src/data/types.ts:288` | `gameEmbed?: string;` | 「游戏的**网页内嵌地址**（H5 / Unity 小游戏；append-only 可选字段）… 语义 = 「这个游戏没有可下载的 swf，但有一个能在 iframe 里跑的在线播放页」… 🔴 所以这里存的是**4399 自己的播放页**（`…/flash/<id>_2.htm`），不是中间页地址。⚠️ 与 `gameUrl`（手填的商店页/官网/攻略链接，点了交给系统浏览器）**不是一回事**：那个是「去外面看」，这个是「在插件里玩」。」 |
| `src/data/types.ts:302` | `gameSwfUrl?: string;` | 「这份 `gameSwf` 的**原始网络地址**（append-only 可选字段）… 用于三件事：① **补抓关联资源** ② **重新下载** ③ **溯源**。🔴 与 `gameSwf` 的**生命周期不同**：`gameSwf` 是本地路径，换机器 / 挪文件夹就失效；这个字段一旦写下就一直有效。⛔ 别在重设 `gameSwf` 时把它清掉。」 |
| `src/data/types.ts:313` | `gameWidth?: number;` | 「游戏画面的**原始宽**（像素；append-only 可选字段）… 站点在详情页里声明的舞台尺寸（4399 `_w = 800,`、7k7k `gamewidth: 800,`、17yy `flash_w = 800;`）。}」 |
| `src/data/types.ts:315` | `gameHeight?: number;` | 「游戏画面的**原始高**（像素；与 `gameWidth` 成对，单边存在时一律不采用）」 |

**没有任何「存档路径」字段** —— 存档位置是**推出来的**（`pluginDir()/saves/<entryId>.json`），不是条目上的字段。这是 A3 与第 ① 条需求之间最核心的落差。

**字段白名单同步**（新增字段必须同步，否则被静默丢弃）：

| 位置 | 原文 |
| --- | --- |
| `src/data/catalog.ts:135` | `gameSwf: isString(raw.gameSwf) && raw.gameSwf.length > 0 ? raw.gameSwf : undefined,` |
| `src/data/catalog.ts:137-138` | `// 与 gameSwf 并列 —— swf 可下载就本地跑，否则退回内嵌网页。` / `gameEmbed: …` |
| `src/data/catalog.ts:142` | `gameSwfUrl: isString(raw.gameSwfUrl) && raw.gameSwfUrl.length > 0 ? raw.gameSwfUrl : undefined,` |

**消费端判定链**：

| 位置 | 原文 | 作用 |
| --- | --- | --- |
| `src/pure/actionLabel.ts:53` | `case 'game': return !!e.gameSwf?.trim() \|\| !!e.gameEmbed?.trim() \|\| !!e.gameLaunchPath?.trim() \|\| !!e.gameUrl?.trim();` | 「有没有可用入口」 |
| `src/pure/actionLabel.ts:83` | `case 'game': return !!e.gameSwf?.trim() \|\| !!e.gameLaunchPath?.trim();` | 「有没有**本地**入口」（注释：⛔ gameEmbed 不算本地） |
| `src/views/components/EntryForm.svelte:1077` | 优先级注释：`gameSwf`（本地 Ruffle） > `gameEmbed`（内嵌网页） > `gameLaunchPath`（.lnk） > `gameUrl` | 表单侧口径 |
| `src/pure/popoverAutoSave.ts:56` | `gameSwf: 'game:swf',` | 自动保存键 |
| `src/pure/popoverAutoSave.ts:61` | `gameEmbed: 'game:embed',` | 自动保存键 |

**启动路由**（`main.ts:8668-8679`）：`launchGame` 里

```ts
const swf = String(entry.gameSwf ?? '').trim();
if (swf && this.settings.internalGameLauncher !== false) {
    await this.openFlashGame(entry);
    return;
}
```

即 **swf 优先于 .lnk**；`FlashGameView.renderInto` 里再分两档：`src/views/FlashGameView.ts:328-341`（swf 分支 → `ensureAndMount`）、`:344-348`（`gameEmbed` 分支 → `mountEmbed`）。

### A5. 「检索本地」「关联媒体」里选 swf 的路径

**宿主侧三个方法**：

| 位置 | 签名 | 说明 |
| --- | --- | --- |
| `main.ts:7763` | `async pickGameDirPath(): Promise<string \| undefined>` | 选目录，只认「选中/没选」两态 |
| `main.ts:7784` | `async pickGameSwfFromDir(): Promise<string \| null \| undefined>` | **三态**：库内相对路径 / `null`（目录里没 swf）/ `undefined`（取消）。体：`const files = this.collectFilesInDir(dir, isFlashPath); const picked = pickMainSwf(files.map((f) => f.path)); if (!picked) return null; return picked;` |
| `main.ts:7799` | `async listGameLaunchFilesInDir(dir: string): Promise<LibraryBookFile[]>` | → `collectFilesInDir(dir, isGameLaunchPath)` |
| `main.ts:8063` | `async pickGameSwfPath(): Promise<string \| undefined>` | 单文件选择 |
| `main.ts:8077` | `async promptFetchGameSwf(entryId?: string)` | 问详情页地址 → `fetchGameSwf` |

**快捷关联弹窗**：`src/modals/QuickAssociateModal.ts`

| 位置 | 原文 / 作用 |
| --- | --- |
| `:653` | `if (t === 'game' && (this.cbs.pickGameSwf \|\| this.cbs.fetchGameSwf \|\| this.cbs.pickGameSwfDir)) {` |
| `:655` | `swfLbl.createDiv({ cls: 'rl-qa-lbl', text: 'Flash 影片' });` |
| `:660` | `attr: { type: 'text', placeholder: '库内路径，或系统绝对路径（.swf）', spellcheck: 'false' },` |
| `:662` | `this.singleSwfInput.value = this.entry.gameSwf ?? '';` |
| `:664` / `:670` / `:675` | 三枚按钮：「浏览」/「目录」/「获取」 |
| `:672` | `dirBtn.onclick = () => void this.pickSwfDirInto(this.singleSwfInput!);` |
| `:681-699` | 「内嵌播放页」行（第四条路，`gameEmbed`，纯输入框无条件建） |
| `:2558` | `if (this.singleSwfInput) r.gameSwf = this.singleSwfInput.value.trim() \|\| undefined;` |

`pickSwfDirInto` 的三态处理在 `:713-736`：`null` → `new Notice('这个目录里没有 .swf 文件', 5000)`（`:720/:725`），`undefined` 静默。

**魔数校验的位置**（重要区分）：**不在**选文件路径上，只在**下载**路径上 —— `main.ts:8334-8343`：

```ts
validate: (bytes) => {
    const b = bytes ?? new Uint8Array(0);
    if (b.byteLength < 8) return '下载到的不是 swf（文件太小）';
    const sig = String.fromCharCode(b[0], b[1], b[2]);
    if (sig !== 'FWS' && sig !== 'CWS' && sig !== 'ZWS') {
        return '下载到的不是 swf（可能是网页或防盗链提示）';
```

注释 `main.ts:8332-8333`：「内容校验：swf 头部三选一（`FWS` 未压缩 / `CWS` zlib / `ZWS` LZMA）。🔴 很多站点把下架页面以 200 + HTML 返回，光看状态码会「下载成功」一个网页当影片。」

**手选 swf 只校验扩展名**：`src/pure/flashGame.ts:26-28` `export function isFlashPath(name: string): boolean { return FLASH_EXTS.includes(extOf(name)); }`，`FLASH_EXTS = ['swf']`（`:15`）。**结论：手工关联的 swf 不做魔数校验。**

---

## B. H5 / 网页嵌入现状

### B6. 现在有没有 H5 网页游戏嵌入？`gameEmbedHost.ts` 是干什么的？

**有。** 实现分三层：

**① 数据字段**：`src/data/types.ts:288` `gameEmbed?: string;`

**② 承载层**：`src/services/gameEmbedHost.ts`（208 行）。文件头 `:2` 逐字：「H5 / Unity 内嵌页的承载层：**`<webview>` 优先，退化为 `<iframe>`**。」

根因（`:4-14` 逐字摘录）：「2026-11-16 用户报障，真机实证：「iframe 内嵌游玩但根本登录不了 4399 账号，一登录就刷新重置」。实测（CDP，`session.defaultSession.cookies.get`）：· 第三方 `<iframe>`（带/不带 sandbox 都一样）加载 `https://www.4399.com/` 之后，`4399.com` / `3304399.net` / `sda.4399.com` 三个域的 cookie **一条都没有**；· 同一 URL 放进 `<webview>` 或顶层 `BrowserWindow`，立刻写进 5 条… ⇒ 根因是**第三方存储分区**… ⇒ `<webview>` 是独立的顶层 webContents（不是第三方上下文），cookie 正常落 jar。」

导出面：

| 位置 | 签名 / 原文 |
| --- | --- |
| `:41-47` | `interface WebviewElement extends HTMLElement`（`src? / loadURL? / getURL? / getWebContentsId? / reload? / executeJavaScript?`） |
| `:60` | `export function canUseWebview(): boolean` —— 判据 `return typeof el.loadURL === 'function';`（`:63`） |
| `:76-82` | `export interface EmbedHost { el: HTMLElement; kind: 'webview' \| 'iframe'; load(url: string): void; dispose(): void; }` |
| `:91` | `export function mountEmbedHost(parent: HTMLElement, url: string, cls: string): EmbedHost` |
| `:154` | `function attachWindowOpenHandler(wv: WebviewElement): () => void`（模块私有） |

webview 分支关键三行（`:98-100`）：

```ts
wv.setAttribute('allowpopups', '');
wv.setAttribute('partition', '');
wv.setAttribute('src', url);
```

注释 `:95-97`：「🔴 `allowpopups` 是**必需的**：不给它，Electron 直接在渲染层拦掉 window.open，`setWindowOpenHandler` 根本收不到回调（探针实测：给了才有 calls）。给它不等于「允许弹窗」—— handler 里我们一律 `deny` 并就地导航。」

降级 iframe 分支（`:125-129`）：

```ts
const frame = parent.createEl('iframe', { cls });
frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
frame.setAttribute('allowfullscreen', 'true');
frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals');
frame.setAttribute('src', url);
```

`attachWindowOpenHandler` 的机制（`:177-188`）：

```ts
wc.setWindowOpenHandler((details) => {
    const next = String(details?.url ?? '').trim();
    if (next) {
        try {
            void wv.loadURL?.(next)?.catch?.(() => undefined);
        } catch {
            /* 元素已销毁 */
        }
    }
    // 🔴 一律 deny：不 deny 就会走 Electron 的默认处理 = 系统浏览器
    return { action: 'deny' };
});
```

拿到 `webContents` 的方式（`:170-172`）：`const id = wv.getWebContentsId?.(); … wc = fromId(id);`，`fromId` 来自 `req('@electron/remote')`（`:159`）。挂钩时点是 `dom-ready`（`:194-197`，注释「`webContentsId` 只有在 webview 挂到 DOM 之后才有 ⇒ `dom-ready` 是最早的可靠时点」）。

**③ 播放端**：`src/views/FlashGameView.ts:381` `private mountEmbed(stage, url)` → `:384` `const host = mountEmbedHost(stage, url, 'rl-fg-frame')`；`:390` 降级提示「当前环境不支持内嵌窗口（webview），已降级为 iframe —— 登录态可能无法保持。」

**结论**：H5 嵌入**已存在且是 webview 路线**（不是 iframe）；登录完全靠第三方站点在 webview 里自己登录，**插件没有账号体系、没有登录弹窗、没有 OAuth**。

### B7. 有没有 OAuth / PKCE / 登录相关代码？

**无。** 检索过的关键词（全仓 `src/` + `main.ts`）：

`oauth`、`OAuth`、`pkce`、`PKCE`、`code_challenge`、`code_verifier`、`authorize`、`authorization_endpoint`、`token`、`access_token`、`refresh_token`、`client_secret`、`redirect_uri`、`state`（OAuth 语义）、`login`、`signIn`

唯一命中是 **应用级** 令牌，不是用户登录：

| 位置 | 原文 | 性质 |
| --- | --- | --- |
| `src/services/igdb.ts:2` | `// 鉴权：POST id.twitch.tv/oauth2/token（client_credentials）取 app access_token（缓存至过期前 60s）` | IGDB 封面查询用的**应用级**令牌 |
| `src/services/igdb.ts:13` | `const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';` | 固定端点，**无 authorize / 无重定向** |
| `src/services/igdb.ts:35` | `/** 构造 OAuth token URL（client_credentials 换 app token） */` | 只有 client_credentials 一条路 |
| `src/services/igdb.ts:5` | `// 历史：v0.3 曾接入 IGDB → 因需 Twitch OAuth/审核门槛高被 RAWG 替代 → RAWG 删除 → 现按用户要求重新接入` | 历史注释，非实现 |

这四处全部是 `client_credentials`（应用级、无用户交互、无 PKCE、无回调地址），**不构成任何用户登录能力**。

**结论写作「无」**：插件里不存在任何 OAuth 2.0 / PKCE / 登录弹窗 / 授权码交换代码。第 ① 条需求最后一句「账号登录用弹窗 + OAuth 2.0 PKCE」是**纯新增**，无既有实现可复用。

### B8. B 站 / YouTube 官方内嵌的机制，能否作为 H5 嵌入的现成范式？

**机制**：`player.bilibili.com` / `youtube.com/embed` 的**官方播放器 iframe** + 把设置里填的 Cookie 注入 Electron cookie jar。**不是** webview。

**地址拼接（纯函数，可单测）**：

| 位置 | 原文 |
| --- | --- |
| `src/pure/biliEmbed.ts:86` | `export function biliEmbedUrl(url: unknown): string \| null` |
| `src/pure/biliEmbed.ts:27` | `export const BILI_PLAYER_HOST = 'player.bilibili.com';` |
| `src/pure/biliEmbed.ts:121` | 拼出 `https://player.bilibili.com/player.html?bvid=…&page=…&autoplay=1&high_quality=1&as_wide=1&danmaku=1` |
| `src/pure/biliEmbed.ts:224` | `export const EMBED_LOAD_TIMEOUT = 8000` |
| `src/pure/netInline.ts:34` | `export function canPlayNetInline(url: unknown): boolean` = `canEmbedBili(s) \|\| isYouTubeUrl(s)` |
| `src/pure/netInline.ts:67` | `export function netOfficialEmbed(url: unknown): NetOfficialEmbed \| null` |
| `src/pure/netInline.ts:75` | `return { embedUrl: \`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0\`, label: 'YouTube' };` |
| `src/pure/netInline.ts:90` | `export function netEmbedSourceOf(url: unknown): NetEmbedSource \| null` |
| `src/pure/netInline.ts:105` | `export function netEmbedTitleOf(url: unknown): string` |

**挂载（iframe）**：`src/views/EpisodePageView.ts:5143` `private mountNetFrame(embedUrl: string, srcUrl = '')`，调用点 `:5022` `this.mountNetFrame(official.embedUrl, url);`

关键属性（`:5155-5164`）：

```ts
frame = layer.createEl('iframe', {
    cls: 'rl-epp-netframe',
    attr: {
        // B 站内嵌播放器只需要这两项；⛔ 不开 `allow-same-origin`（跨域同源会给它摸宿主的能力）
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        frameborder: '0',
        scrolling: 'no',
        title: NET_BAR_TITLE_FRAME,
    },
});
```

**Cookie 注入**（这是「账号登录」现状的全部）：`src/services/embedCookie.ts` 文件头 `:1-21` —— 把设置里填的 Cookie 同步进 Electron cookie jar（`@electron/remote` → `session.defaultSession.cookies`）。`:33-53` 关键点：`sameSite` 必须 `no_restriction`（SameSite=None），注释里的实测数字：「跨站 iframe 里 lax 一律不发送（CDP 实测 no_restriction ⇒ Cookie 头 1388 字节含 SESSDATA；lax ⇒ 0 字节）」。

调用时点在设 `src` **之前**（`src/views/EpisodePageView.ts:5175-5184`，注释：「🔴 先把设置里填的 Cookie 写进 Electron cookie jar，**再**设 `src`。iframe 一旦开始加载就已经发完首包，之后再写 cookie 对这次请求无效 ⇒ 必须「先登录、后加载」这个顺序」）。

**超时与备用域名兜底**：`src/views/EpisodePageView.ts:5188` `const retryUrl = netEmbedFallbackUrl(srcUrl);`、`:5202-5217` 计时器超时后先换域名重试一次，仍失败才 `layer.addClass('is-fail')`。局限写得很清楚（`:5131-5133`）：「`X-Frame-Options` 拒绝被嵌时 **Chrome 仍会触发 `load`**（加载的是错误页），所以看门狗只能抓「网络完全不通」，抓不到「拒绝被嵌」。」

**能否作为 H5 嵌入的范式？** 能，但要分清两条承载路线：

| 维度 | B 站/YouTube（网络集） | H5 游戏（游戏条目） |
| --- | --- | --- |
| 载体 | `<iframe>` | `<webview>`（优先）/ iframe（降级） |
| 为什么 | 官方播放器本身就设计成可嵌 | 4399 第三方分区 cookie 落不了盘 |
| 登录态 | 靠用户手填 Cookie 注入 jar | 靠 webview 自己是顶层 webContents |
| 入口 | `gameEmbed` 类似的纯 URL 字段 | `gameEmbed` |

可复用的**纯范式**（与承载无关）：① 地址拼接做成纯函数 + 单测（`netOfficialEmbed`）；② 承载层抽成独立模块（`mountEmbedHost` 已做）；③ 超时常量 + 兜底重试；④ 「先登录、后加载」的顺序纪律。

---

## C. 目录扫描与文件清单

### C9. 有没有「扫描某个目录下的文件」的公共函数？

**有，且是全仓唯一一份 walk**。

`main.ts:7809`：

```ts
private collectFilesInDir(dir: string, accept: (name: string) => boolean): LibraryBookFile[]
```

全文（`main.ts:7809-7831`）：

```ts
    private collectFilesInDir(dir: string, accept: (name: string) => boolean): LibraryBookFile[] {
        const d = String(dir ?? '').trim();
        if (!d || !Platform.isDesktopApp) return [];
        const out: LibraryBookFile[] = [];
        try {
            const fsMod = require('fs') as { readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[] };
            const sep = d.includes('/') ? '/' : '\\';
            const walk = (abs: string, depth: number): void => {
                if (depth > 4) return;
                for (const ent of fsMod.readdirSync(abs, { withFileTypes: true })) {
                    if (ent.name.startsWith('.')) continue;
                    const child = `${abs.replace(/[\\/]+$/, '')}${sep}${ent.name}`;
                    if (ent.isDirectory()) walk(child, depth + 1);
                    else if (accept(ent.name)) out.push({ path: this.toVaultRelPath(child), name: ent.name });
                }
            };
            walk(d, 0);
            out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
        } catch {
            return [];
        }
        return out;
    }
```

设计说明（`main.ts:7804-7807` 逐字）：「在目录里按扩展名收集文件（支持子目录，深度 ≤ 4；忽略隐藏项）—— 书籍 / 游戏两个入口**共用的唯一 walk**。🔴 抽出来是因为原先只有书籍一份；再加游戏时若照抄一遍 ⇒ 两条 walk 必然漂（深度、隐藏、路径转换三处最容易分叉）。」

**三个调用点**：`main.ts:7788`（`collectFilesInDir(dir, isFlashPath)`）、`main.ts:7800`（`collectFilesInDir(dir, isGameLaunchPath)`），以及书籍侧同一 walk。

**另外两个相关纯函数**：

| 位置 | 签名 | 作用 |
| --- | --- | --- |
| `src/pure/subtitle.ts:40` | `export function dirOfPath(p: string): string` | 「路径取目录（统一正斜杠；无目录返回空串）——播放器与 main 层共用，避免两处各写一遍」 |
| `main.ts:5687` | `public resolveEmbedUrl(path: string): string \| null` | 路径 → 宿主可加载 URL（库内 `getResourcePath` / 库外 `app://`） |

**局限（对第 ① 条需求重要）**：`collectFilesInDir` 的 `accept` 只吃**文件名**（`accept(ent.name)`），不吃路径，也**不返回目录列表**。要按「目录下有没有 `saves/`」做判定，现有函数不够用。

### C10. `src/pure/flashGame.ts` 三函数签名 + `saves` 回灌

**签名**：

| 位置 | 签名 |
| --- | --- |
| `src/pure/flashGame.ts:49` | `export function pickMainSwf(names: readonly string[]): string \| null` |
| `src/pure/flashGame.ts:90` | `export function isRuffleRuntimeComplete(fileNames: readonly string[]): boolean` |
| `src/pure/flashGame.ts:200` | `export function flashFrameHtml(opts: FlashFrameOptions): string` |

**`FlashFrameOptions` 相关成员**（`src/pure/flashGame.ts:158` 与 `:169`）：

```ts
    stage?: { width: number; height: number };
    /**
     * 开局要灌进 srcdoc 的 **Flash 存档快照**（`localStorage` 里那些 `.sol`）。
     * …
     * ⚠️ 只认字符串值；空对象/未传 ⇒ 不灌（首次玩）。
     */
    saves?: Record<string, string>;
```

**`saves` 回灌进 localStorage 的那段（`src/pure/flashGame.ts:265-277` 全文，位置在 `<script src=…/ruffle.js>` **之前**）**：

```html
<script>
// 🔴 存档回灌 —— 必须在 ruffle.js **之前**执行：Ruffle 启动时会 populateSaves() 扫 localStorage，
//    晚一步灌进去它就已经按「没有存档」初始化完了。
// 本 srcdoc 的 origin 是 null，localStorage 属于这个一次性文档，关页即销毁 ⇒ 每次打开都得重灌。
(function () {
  try {
    var saves = ${savesJson};
    for (var k in saves) {
      if (Object.prototype.hasOwnProperty.call(saves, k)) localStorage.setItem(k, saves[k]);
    }
  } catch (e) { /* 存不进就算了：不能因为存档挡住游戏本身 */ }
})();
</script>
```

`savesJson` 的来源（`src/pure/flashGame.ts:208-212`）：

```ts
    // 存档快照：只收「key / value 都是字符串」的项，别把乱七八糟的东西塞进 SRCDOC
    const saveEntries = Object.entries(opts.saves ?? {}).filter(
        ([k, v]) => typeof k === 'string' && k.length > 0 && typeof v === 'string' && v.length > 0,
    );
    const savesJson = JSON.stringify(Object.fromEntries(saveEntries));
```

**回传侧**（配套，`src/pure/flashGame.ts:398-435`）：

| 位置 | 原文 |
| --- | --- |
| `:398` | `function collectSaves() {` |
| `:406` | `if (typeof v === 'string' && v.length > 8 && (v.indexOf('TCSO') >= 0 \|\| v.length > 64)) {` |
| `:413-417` | `function pushSaves() { … window.parent.postMessage({ source: 'reelludic-flash', type: 'saves', saves: collectSaves() }, '*'); … }` |
| `:425-435` | `function watchSaves()`：`setInterval(tick, 15000)` + `beforeunload`，且 `if (now === last) return;`（有变化才传） |

**宿主侧接收**（`src/views/FlashGameView.ts:295-309`）：`if (d.type === 'saves' && d.saves && typeof d.saves === 'object') { void this.plugin.saveGameSaves(this.opts?.entry.id ?? '', d.saves); }`

**宿主编排**（`src/views/FlashGameView.ts:428` / `:438`）：

```ts
const saves = entryId ? await this.plugin.loadGameSaves(entryId) : {};
…
frame.srcdoc = flashFrameHtml({ ruffleBaseUrl: baseUrl, swfUrl, title, stage: stageBox, saves });
```

**关键结论**：存档在整条链路上**始终是 `Record<string, string>`**（localStorage 的 key→value 原样），**从头到尾没有 sol 文件、没有 base64 编解码、没有导入导出**。

---

## D. 影响面

### D11. 把存档落点从 `pluginDir()/saves/<entryId>.json` 改成「条目所在的游戏目录下 `saves/`」会牵动哪些文件

**先给判断依据**：存档位置目前**完全由 `entryId` 推出**（`main.ts:8660-8666`），而「条目所在的游戏目录」只能从 `entry.gameSwf` 的父目录推出 —— 这两者在现有代码里**没有任何交集**：`gameSaveDir()` 收不到 `entry`，`gameSaveFile()` 只收 `entryId`。

**必改（核心 4 处，全在 `main.ts`）**：

| 位置 | 那一行在干什么 | 要改成 |
| --- | --- | --- |
| `main.ts:8607` | `async loadGameSaves(entryId: string): Promise<Record<string, string>>` —— **签名只收 entryId**，无 entry 信息 | 必须拿到条目（或 `gameSwf`），否则算不出目录 ⇒ 改签名或先在内部 `this.service.get(entryId)` |
| `main.ts:8632` | `async saveGameSaves(entryId: string, saves: Record<string, string>)` —— 同上 | 同上 |
| `main.ts:8654-8657` | `private gameSaveDir(): string { const base = this.pluginDir(); return base ? \`${base}/saves\` : ''; }` —— **落点的唯一定义** | 改为按条目游戏目录计算，且要保留「拿不到 ⇒ 空串」的降级 |
| `main.ts:8660-8666` | `private gameSaveFile(entryId: string): string` —— 文件名归一 `replace(/[^A-Za-z0-9_-]/g, '_')` | 路径前缀换掉；文件名是否还按 entryId 需要决策 |

**连带必改（否则调用点编译不过 / 行为错）**：

| 位置 | 那一行在干什么 |
| --- | --- |
| `src/views/FlashGameView.ts:307` | `void this.plugin.saveGameSaves(this.opts?.entry.id ?? '', d.saves);` —— **只传 id**，改签名后必须改成传 entry 或 `gameSwf` |
| `src/views/FlashGameView.ts:428` | `const saves = entryId ? await this.plugin.loadGameSaves(entryId) : {};` —— 同上 |

**语义牵连（不改也能跑，但会与第 ① 条需求冲突，必须一起决策）**：

| 位置 | 那一行在干什么 | 冲突点 |
| --- | --- | --- |
| `main.ts:8515-8517` | Ruffle 运行时落 `pluginDir()/ruffle`（`const root = this.pluginDir(); … const dir = \`${root...}/ruffle\``) | 若「游戏目录」改成库内 `games/`，运行时**仍应留在插件目录**（避免进库被索引/同步）—— 两者不能混为一谈 |
| `src/data/types.ts:250-315` | 游戏载体字段全表 | 若「单文件有存档做独立目录」落成新形态，**没有**任何字段记录「这个条目用哪种布局」，得新增字段（并同步 `src/data/catalog.ts:135-142` 白名单） |
| `src/pure/entryTrash.ts:156-170` | `collectTrashFiles(entry, libraryDir, storePaths)` —— 连带文件只收 `poster` / `storePaths` / `bookFile` / `audioPath` / `episodeFiles` | **swf 与游戏存档都不在其中** ⇒ 删条目时游戏目录与存档**都不会进回收站**，改落点后这个漏洞会被放大 |
| `main.ts:8310-8312` | `const baseDir = downloadDir(this.settings.gameDownloadDir, 'flash');` | 用户要求「单文件无存档 SWF 直接放 `games/swf/`」—— 这与「一游戏一目录」是**两套布局**，需要按「有没有存档 / 是不是多文件」分流，而现有代码**只有一条**路径 |
| `src/pure/downloadPlan.ts:49` | `flash: \`${DOWNLOAD_ROOT_DEFAULT}/Flash 游戏\`,` | 默认值要变成 `games/swf` 就改这里（唯一真源），但会**打断 `src/Settings.ts:1107` 的缺省与所有存量用户的既有目录** |
| `src/Settings.ts:7529-7540` | 设置行「游戏目录」 | 文案与语义要跟着变（现在叫「Flash 游戏文件的存放与检索目录」） |

**不受影响（可放心）**：`src/pure/flashGame.ts` 三函数与 `saves` 类型（`Record<string, string>`）**不需要改** —— 它只关心「有没有一份快照」，不关心快照存在哪。

**结论（最小改动面）**：`main.ts` 三处（`loadGameSaves` / `saveGameSaves` / `gameSaveDir`+`gameSaveFile`）+ `src/views/FlashGameView.ts` 两处调用。**能跑起来的最小面 = 这 2 个文件**。但要真正满足第 ① 条需求的**全部四条**，还必须加上 `src/data/types.ts`（新字段）+ `src/data/catalog.ts`（白名单）+ `src/pure/downloadPlan.ts`（默认目录）+ `src/Settings.ts`（设置项）+ `src/pure/entryTrash.ts`（删除连带）。

### D12. 现有测试里跟 flash / 存档 / 游戏目录相关的测试文件

| 测试文件 | 钉住了什么断言（关键行） |
| --- | --- |
| `tests/flashGameShell.test.ts` | **存档落点最硬的一条守卫**。`:181` `expect(MAIN).toContain('async loadGameSaves(entryId: string): Promise<Record<string, string>> {');`；`:182` `saveGameSaves(entryId, saves)` 签名；`:183` `private gameSaveDir(): string {`；`:184` `expect(MAIN).toContain('return base ? \`${base}/saves\` : \'\';');`；`:185` `private gameSaveFile(entryId: string): string {`；`:187` 空对象不写；`:189` 读失败返回 `{}`。`：192-197` 钉 View 侧的载入/回传；`:164` `expect(HTML).toContain('var saves = {};');`（空快照不灌）；`:168-172` `watchSaves` / `if (now === last) return;` / `setInterval(tick, 15000)` / `beforeunload`；`:176-177` `collectSaves` 与 `v.indexOf('TCSO') >= 0`。**游戏目录**：`:425-433` 「一个游戏一个目录」—— `:428` `const baseDir = downloadDir(this.settings.gameDownloadDir, 'flash');`、`:429` `const gameDir = …`、`:430` `root: gameDir,`、**`:432` 反向守卫 `expect(MAIN).not.toMatch(/root: this\.settings\.gameDownloadDir,/);`**。`pickMainSwf` 七条断言行 `:391-423`。`clampGameStage` 断言行 `:204-251`。 |
| `tests/flashProgressAndLauncher.test.ts` | 设置项接线。`:106` `expect(SETTINGS).toMatch(/internalGameLauncher: true,/);`；`:124` `expect(SETTINGS).toMatch(/gameDownloadDir: DOWNLOAD_DIR_DEFAULT\.flash,/);`；`:117` 设置行 `createLibraryDirRow(… '游戏目录' … gameDownloadDir …)`；`:120` `expect(SETTINGS).toMatch(/'game',\s*'flash',/);`；`:138` `if (swf && this.settings.internalGameLauncher !== false) {`；`:145` `expect(MAIN).toContain("downloadDir(this.settings.gameDownloadDir, 'flash')");`；`:146` `expect(MAIN).toContain('root: gameDir,');` |
| `tests/flashGameView.test.ts` | 视图形态与播放链路。`:35` 基类是 `ItemView` 不是 `Modal`；`:89` 布局只序列化 entryId；`:124` srcdoc 隔离且**不加 sandbox**；`:137` H5 分支交给 `gameEmbedHost`；`:153` webview 优先 + 就地导航 + 一律 deny；`:171` swf 与插件目录都过 `resolveEmbedUrl`；`:177` swf 路径先自检；`:185` H5 不碰 Ruffle 运行时 |
| `tests/flashGame.test.ts` | `flashFrameHtml` 纯函数约束：`:90-132`（含 `:111` 恶意 URL 转义、`:121` scale、`:132` `noBorder`） |
| `tests/gameEmbedEntry.test.ts` | `gameEmbed` 字段的 UI 入口。`:28` `gameEmbed: 'game:embed',`；`:67` 启动判定含 `gameEmbed`（并有 `:69` 反向守卫禁止退回两条的老写法）；`:80` `input.gameEmbed = gameEmbed.trim() \|\| undefined;`；`:111` 宿主落库用 `!== undefined` 判定（`:112` 反向守卫） |
| `tests/flashFetch.test.ts` / `tests/flashAssets.test.ts` | 下载与关联资源抓取（对应 A2 的 `fetchGameSwf` / `fetchFlashAssets`） |

**结论**：存档落点的**每一行都被 `tests/flashGameShell.test.ts:180-190` 用字符串断言钉死** —— 包括那句 `` return base ? `${base}/saves` : ''; ``（`:184`）。要改存档落点，这个测试文件**必然**要同步改，否则全红。

---

## 总结：要实现用户第 ① 条需求，最小改动面

**第 ① 条需求 vs 现状，逐句对齐**：

| 需求 | 现状 | 差距 |
| --- | --- | --- |
| 单文件无存档 SWF 放 `games/swf/` | 一律 `下载/Flash 游戏/<游戏名>/`（`main.ts:8310-8312`） | **布局不同**，且没有「按有无存档分流」的逻辑 |
| 单文件有存档做独立目录（swf + sol/base64/JSON） | 存档统一 `pluginDir()/saves/<entryId>.json`（`main.ts:8653-8666`） | **落点错位**；**只有 JSON 一种形态**；**没有 sol / base64** |
| 存档是导出备份，需导入功能恢复 | 无任何导入/导出入口 | **纯新增** |
| 多文件 SWF 做独立目录，其下 `saves/` | 多文件确实进独立目录（`main.ts:8302-8309`），但 `saves/` **不在这里** | 只差 `saves/` 落点 |
| H5 网页嵌入 | ✅ 已有（`gameEmbed` + `mountEmbedHost` webview） | 已达成 |
| 登录用弹窗 + OAuth 2.0 PKCE | ❌ **完全无** | **纯新增**，且与 webview 方案存在架构冲突（webview 里第三方站点自己的登录 vs 插件主导的 OAuth） |

**最小改动面（按「能跑」与「满足全部四条」分两档）**：

**A 档 —— 只改存档落点（最小可运行）**：**2 个文件**
1. `main.ts` —— `loadGameSaves`（`:8607`）、`saveGameSaves`（`:8632`）、`gameSaveDir`（`:8654`）、`gameSaveFile`（`:8660`）
2. `src/views/FlashGameView.ts` —— 调用点 `:307` 与 `:428`

**B 档 —— 满足第 ① 条需求全部四条**：**7 个文件**
1. `main.ts`（存档落点 + 分流布局 + 导入导出命令）
2. `src/views/FlashGameView.ts`（调用点）
3. `src/data/types.ts`（新增「游戏布局 / 存档形态」字段，`:250-315` 区段）
4. `src/data/catalog.ts`（新字段白名单，`:135-142`）—— **漏了会静默丢弃**
5. `src/pure/downloadPlan.ts`（`games/swf` 默认值与 `flash` 白名单，`:49` / `:69`）
6. `src/Settings.ts`（设置文案与缺省，`:1107` / `:7529-7540`）
7. `src/pure/entryTrash.ts`（删除条目时把游戏目录与存档带进回收站，`:156-170`）

**外加必须同步的测试**：`tests/flashGameShell.test.ts:180-190`（存档落点字符串断言）与 `:425-433`（一游戏一目录反向守卫）、`tests/flashProgressAndLauncher.test.ts:123-125`（默认目录断言）。

**纯新增、无既有实现可复用**：OAuth 2.0 PKCE 登录弹窗（B7 已确认全仓无 OAuth/PKCE）、存档导入导出（A3 已确认无）、sol 二进制与 base64 形态（A3 已确认无）。
