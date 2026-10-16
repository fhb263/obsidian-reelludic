# 附件清理 / 删除条目交互 设计方案（#349 / #350）

> **实施进度**（2026-09-20）：
> ✅ **M1 纯逻辑** + ✅ **M5「附件清理」入口升级**（#349）——设置页 / 命令面板可扫描并清理「未被引用的封面 + 条目已删后遗留的阅读存档」（走回收站）。
> ✅ **M2 官方弹窗接线核实**（asar 反查，见 §6.1）+ ✅ **M3 删除条目清单弹窗** + ✅ **M4 接线**（#350）——删条目时逐项可取消勾选；笔记交官方 `promptForDeletion`（自带「一并删除附件」），用户在那一步取消则**整体中止**；其余项走 `trashFile`；`vaultIO.deleteFile` 也一并改走回收站（D-7）。
> ⏳ 未做：M6 的 UI-GUIDE 章节已建（§10），**批量路径不做逐项清单**（D-3：会弹 N 次）——批量只清「安全项」，媒体永不默认删。

> 起点 = 用户 2026-09-20 原话：「目前"删除笔记条目"使用的是轻量级警告弹窗。但当前逻辑存在盲区：**无法有效清理或删除被遗弃的附件与封面**。为完善存储管理，我们需要一套更完善的"附件清理/删除"交互弹窗，调用 Ob 出的自动清理附件弹窗？obsidian v1.12 出的**"自动清理附件"**。当你删除一个笔记文件时，会弹出一个**简单的确认提示**，询问你是否要一并删除该笔记关联的附件。」
> 结论先行：**用户引用的官方能力真实存在**（v1.12.4），但**它只覆盖「笔记里链接过的文件」**；本插件的条目还拥有一批**不挂在笔记里**的资产（封面以外的阅读存档、媒体文件），因此**必须补一层自己的清单**。推荐 **方案 C（混合）**。

---

## 1. 金标准检索（先查清官方到底做了什么）

### 1.1 官方 v1.12.4（2026-02-27）原文

> **Automatic attachment cleanup** — When deleting a file, a prompt will ask if you would also like to delete its attachments. A new setting in **Files & Links** allows you to configure this behavior (choose "Always", "Ask every time", or "Never").

三档设置（**Always / Ask every time / Never**）落在 **设置 → 文件与链接**，弹窗问题形如「是否同时删除它的附件？」。

### 1.2 插件能用到的是哪个 API（本地类型实测，不是推测）

| API | 语义 | 会弹窗吗 | 说明 |
|---|---|---|---|
| `fileManager.promptForDeletion(file)` | **弹出 Obsidian 自己的删除确认**，返回 `true/false`（since 0.15.0） | ✅ **会** | 🔴 **这就是入口** —— 1.12 起这个原生弹窗里多了一条「一并删除附件？」 |
| `fileManager.trashFile(file)` | 按用户的「删除文件」偏好删除（`.trash/` 或系统回收站） | ❌ 不弹 | since 1.6.6；**尊重用户设置** |
| `vault.delete(file)` | **永久删除**（不进回收站） | ❌ 不弹 | 插件当前用的就是它 ⚠️ |

本仓 `node_modules/obsidian/obsidian.d.ts` 里**只有** `trashFile` / `promptForDeletion` / `getAvailablePathForAttachment`，**没有**任何「附件清理」专用 API ⇒ 官方那套是**应用内行为**，插件只能通过 `promptForDeletion` 间接获得。

### 1.3 生态参照（同类插件怎么做的）

- **Safe Attachment Trash**（社区，0.4.1，`minAppVersion 1.8.7`，明说「targets the public 1.12 API line」）：自己**全库扫描未引用附件** → 列出 → **用户勾选确认** → 移动到一个可还原的「安全回收区」（保留原路径以便恢复，永久删除要**二次确认**）；⚠️ 它明确写了「File moves use `FileManager.trashFile()` **so the user's configured deletion behavior is respected**」——**尊重用户的删除偏好**是生态共识。
- **Material 3 / PatternFly** 的通行做法：**危险操作 = 列出将要被删除的具体对象 + 默认只勾选「可安全恢复/可再生成」的那些**。

---

## 2. 现状勘察（本项目的删除链路与资产清单）

### 2.1 现有删除链路

```
EntryModal「删除」/ MediaList 右键 / HomeView 卡片菜单
   └─ plugin.deleteEntry(id)            main.ts:1432
        ├─ ConfirmModal('确定删除「X」？已生成的笔记文件将一并删除。')   ← 用户说的「轻量级警告弹窗」
        └─ service.removeWithNote(id)   EntryService.ts:98
             ├─ remove(id)                       （删除 entries 记录）
             └─ io.deleteFile(notePath)          → vaultIO.ts:62 → **app.vault.delete(f)**（永久删除）
（批量：plugin.deleteEntries(ids) 一次确认后循环同上）
```

### 2.2 一个条目拥有的资产（**实测盘点**）

| # | 资产 | 落盘位置 | 谁引用它 | 现在删条目时 | 是否会被 Ob 原生弹窗覆盖 |
|---|---|---|---|---|---|
| 1 | 笔记文件 | `{库}/…/{标题}.md` | 条目 `notePath` | ✅ 删（`vault.delete`） | —（它就是被删的那个文件） |
| 2 | **封面** | `{库}/{子目录}/封面/x.jpg` | 条目 `poster` **＋ 笔记正文 `![[…]]`（bookinfo callout）＋ frontmatter `banner:`** | ❌ **残留** | ✅ **会被覆盖**（笔记里链接过） |
| 3 | 玩家截图 | Obsidian 附件目录（`getAvailablePathForAttachment`） | 笔记 `## 截图` 区 `![[…]]` | ❌ 残留 | ✅ **会被覆盖**（笔记里链接过） |
| 4 | 阅读存档 JSON | `{库}/阅读进度/{书名}-阅读-{id}.json` | 条目 id（**不挂在笔记里**） | ❌ **残留** | ❌ 不覆盖（笔记没链接它） |
| 5 | 书签 JSON（旧版遗留） | `{库}/阅读进度/{书名}-书签-{id}.json` | 条目 id | ❌ 残留 | ❌ 不覆盖 |
| 6 | 媒体文件（书 / 影片） | 条目 `bookFile` / `episodeFiles` —— **可能在库外，且是用户自己的文件** | 条目引用 | ❌ 残留（**故意**：见 §5 红线） | ❌ 不覆盖（笔记没链接它 ⇒ **好事**） |
| 7 | 剧集字幕 / 外挂 | 同上 | 条目引用 | ❌ 残留 | ❌ 不覆盖 |

> 🔴 **关键发现（好消息）**：笔记正文**只嵌入封面**（`posterEmbed`），**不链接媒体文件** ⇒ Obsidian 的原生「一并删除附件」**不会误删用户的书/影片**，只会提出删封面与截图。这正是我们想借力的部分。
>
> 🔴 **关键发现（坏消息）**：`阅读进度/*.json` 这类**本插件自己生成**的资产**完全不在** Obsidian 的视野里 —— 不补一层自己的逻辑，它们永远是孤儿（与用户说的「清理盲区」完全对上）。

### 2.3 现有能力（可复用，别重造）

- **`PosterCleanupModal`**（`src/modals/PosterCleanupModal.ts`）+ **`plugin.listOrphanPosters()`**（`main.ts:3565`，纯函数 `orphanCoverFiles`）：**已经**能扫描「封面目录里未被任何条目引用的文件」，勾选后删除。入口在 **设置 → 清理孤儿封面 → 扫描**。
  - ⚠️ 两个缺口：⑴ 只覆盖**封面**，不管阅读存档；⑵ 删除走 **`vault.delete`（永久删除）**，不尊重用户的「删除文件 → 回收站」偏好（与 §1.3 的生态共识相反）。

### 2.4 三条已确认的缺陷（本方案要修的）

1. **删条目后封面残留**（除非用户手动去设置里点「清理孤儿封面」）。
2. **阅读存档 / 旧书签 JSON 永不清理**（无任何入口）。
3. **删除一律永久** —— `vault.delete` 绕过用户设置的回收站；误删无法挽回。

---

## 3. 三个方案

### 方案 A —— 纯原生：改用 `fileManager.promptForDeletion(note)`

```
┌─ 确定要删除「XX」吗？────────────────────┐
│  ☑ 同时删除它的附件（封面 / 截图）        │   ← Obsidian 原生弹窗（1.12 起多这一条）
│                        [ 取消 ] [ 删除 ] │
└──────────────────────────────────────────┘
+ 插件在弹窗确认后自行清理「阅读存档 / 旧书签 JSON」
```
- ✅ 体验与用户引用的一致；**零自绘 UI**；封面/截图交给官方判定（引用计数由 Obsidian 保证）。
- ✅ 顺带修掉「永久删除」——`promptForDeletion` 内部走用户的 trash 偏好。
- ❌ **只覆盖「有笔记」的条目**；没笔记的条目还是得自己弹。
- ❌ **批量删除会弹出 N 个原生弹窗**（列表多选删 5 条 = 5 次）。
- ❌ 「阅读存档」仍然不会出现在弹窗里（用户看不到「还会删什么」）。
- ⚠️ ~~**待实测确认**：`promptForDeletion` 这个 API 路径是否也会附加「附件」问题~~ → ✅ **已由 asar 反查证实「会」**（见 §6.1），但同一处也暴露了 `promptDelete=false` 时**直接删、不弹窗**的风险（D-9）。

### 方案 B —— 自建统一「删除条目」弹窗（不用原生）

```
┌─ 删除条目「XX」───────────────────────────┐
│ 将删除下列内容（可逐项取消勾选）：          │
│  ☑ 条目记录                               │
│  ☑ 笔记  XX.md                            │
│  ☑ 封面  封面/xx.jpg        （未被其他条目引用）│
│  ☑ 阅读存档  xx-阅读-123.json              │
│  ☐ 媒体文件 影片.mp4        ⚠️ 库外/你自己的文件│
│  ─────────────────────────────────────    │
│  ☑ 删除后放入回收站（跟随 Obsidian 设置）   │
│              [ 取消 ]  [ 删除以上 N 项 ]    │
└───────────────────────────────────────────┘
```
- ✅ 一次说清「会删什么」，**批量也只有一个弹窗**；媒体文件默认**不勾**（危险项）。
- ✅ 删除走 `fileManager.trashFile` ⇒ 尊重用户偏好，可恢复。
- ❌ 自绘 UI 面更大（复选框 + 风险分级 + 与 #345 的「选择模式」风格对齐）。
- ❌ **拿不到 Obsidian 的引用计数**：封面是否「只被这一个条目引用」要靠我们自己的 `listOrphanPosters` 口径（已有）；玩家截图则**只有 Obsidian 自己知道**（我们不知道哪些截图只被这一条笔记引用）⇒ 截图这一项做不准。
- ❌ 与官方 1.12 的能力重复造轮子（用户明确问「能不能调官方的」）。

### 方案 C —— 混合（**推荐**）

**分两层，各做各最擅长的**：

```
第一层（有笔记时）：调用 Obsidian 原生弹窗  = fileManager.promptForDeletion(noteFile)
        → 由 Obsidian 处理「笔记 + 它链接过的附件（封面 / 截图）」的删除与回收站偏好
第二层（插件自己的资产）：原生弹窗确认后，再用**自绘小清单**问一次「本插件生成的资产」
        → 阅读存档 JSON / 旧书签 JSON（默认勾选）
        → 封面（若原生已删则自动跳过；未被任何条目引用才出现）
        → 媒体文件（**默认不勾**，仅当用户显式展开「高级」时才列出）
批量删除：不调原生弹窗（会弹 N 次），统一走第一层的自绘版（标题改「删除 N 个条目」）
```
- ✅ 用户体验 = 用户引用官方时想要的那个弹窗（**且有官方维护的引用计数**）。
- ✅ 盲区（阅读存档）被补上，且用户在弹窗里**看得到**。
- ✅ 顺带把「永久删除」改成**尊重回收站偏好**。
- ⚠️ **两次弹窗**（原生一次 + 自绘一次）略啰嗦 ⇒ 缓解：第二层只在**确实有可清理项**时出现（无阅读存档、无封面 → 直接跳过，用户只看到原生那一个弹窗）。
- ⚠️ 依赖 §6.1 的实测结论（若 API 路径拿不到原生「附件」问题，则退化为方案 B 的截图项由用户自行处理，封面仍可用 `listOrphanPosters` 口径覆盖）。

### 3.4 顺带建议：把「清理孤儿封面」升级为「清理孤儿资产」

现有 `PosterCleanupModal` 已经很接近用户要的形态，建议扩成 **「附件清理」独立入口**（设置页 + 命令面板），扫描项：
`封面（未被条目引用）` + `阅读存档（无对应条目 id）` + `旧书签 JSON（无对应条目）`，
仍然是「勾选 → 确认 → 删除（走 trash 偏好）」。⚠️ **玩家截图不纳入**（无法判定引用，误删代价高）——这条要写进 UI 文案，避免用户以为「它什么都清」。

---

## 4. 模块规划（拆到可独立执行 / 可测的粒度）

| 模块 | 内容 | 可测性 |
|---|---|---|
| **M1 纯逻辑 `pure/entryAssets.ts`** | `entryAssetPlan(entry, ctx)` → 返回「这个条目拥有的资产清单」（路径 + 类型 + 风险级 + 默认勾选态）；`orphanAssets(files, entries, stores)`：把 `orphanCoverFiles` 的口径**扩到阅读存档**（按条目 id 后缀匹配文件名）；`assetLabel(kind)`。 | ✅ 纯函数，TDD（同类已有 `orphanCoverFiles` 先例） |
| **M2 `fileManager.promptForDeletion` 实测脚本** | 在测试库手动跑一次：① 直接命令删一个**有封面嵌入**的笔记，看弹窗里有没有「附件」问题；② 通过 `promptForDeletion` 再跑一次，比对。产出一行结论写回本文档 §6.1。 | ✅ 真机实测（无头浏览器做不到） |
| **M3 `DeleteEntryModal`（自绘清单）** | 条目记录 / 笔记 / 封面 / 阅读存档 / 旧书签 + 「高级」折叠里的媒体文件；删除按钮文案带条数；走 `trashFile`。**批量模式**复用同一弹窗（标题与清单里加「×N」）。 | DOM 接线 + 纯逻辑在 M1 |
| **M4 接线** | `plugin.deleteEntry` / `deleteEntries` 改为：有笔记 → `promptForDeletion`；随后 M3 的清单（有可清理项才弹）；`service.removeWithNote` 增加「按 M1 计划清理本插件资产」的入参（⛔ 不在 service 里弹 UI —— 保持「笔记只经 EntryService」的分层）。 | 真机 |
| **M5 「附件清理」入口升级** | `PosterCleanupModal` → `AssetCleanupModal`（标题/文案改「附件清理」）；`listOrphanPosters` → `listOrphanAssets`；删除改 `trashFile`。 | 纯逻辑在 M1 |
| **M6 文档** | UI-GUIDE 新增一节（删除类弹窗的形态口径：**列清楚 + 默认勾选可恢复项 + 危险项默认不勾 + 走 trash**）；CHANGELOG / progress。 | — |

---

## 5. 红线（写进实现，不得越过）

1. 🔴 **媒体文件（书 / 影片 / 字幕）永远不默认删除，且必须二次确认** —— 可能在库外、是用户自己的资产；`Safe Attachment Trash` 同口径（永久删除永远要**单独**确认）。
2. 🔴 **删除一律走 `fileManager.trashFile`**（尊重用户的「删除文件」偏好）；⛔ 不再用 `vault.delete`（永久删除）—— 现状 `vaultIO.deleteFile` 是永久删除，本轮一并改（⚠️ 要检查隐藏路径分支的兜底是否还在）。
3. 🔴 **绝不删「被别的条目/笔记还引用着的」文件**（封面引用计数口径沿用 `listOrphanPosters`，不要放宽）。
4. 🔴 **玩家截图不进插件的清理范围**（无法判定引用；交给 Obsidian 原生弹窗）。
5. 🔴 删除动作必须**逐项可取消勾选**，且弹窗里**列出具体路径/文件名**（用户原话就是「无法有效清理**被遗弃的**附件与封面」——「被遗弃」正是要靠清单表达）。

---

## 6. 待办与待裁定

### 6.1 ✅ 已用**静态证据**结掉（不需要真机点一遍了）

对用户机器上的 `D:/Obsidian/resources/obsidian.asar`（25MB 主 bundle）直接反查，`FileManager.promptForDeletion` 的实现是：

```js
e.prototype.promptForDeletion = function (e) {
  return __awaiter(this, void 0, Promise, function () {
    ...
    case 0:
      return t = this.app,
        n = t.vault.getConfig("promptDelete"),              // ① 是否弹确认（用户配置）
        i = t.vault.getConfig("trashOption"),               // ② 回收站偏好 system/local/none
        r = t.vault.getConfig("deleteUnlinkedAttachments"), // ③ 🔴 附件清理档位
        n ? ( (o = document.createDocumentFragment())
                .createEl("p", { cls: "u-break-word", text: bd.dialogue.labelConfirmDeletion({ filename: e.name }) }), … )
          : …
```

配套证据：
- 官方**文件浏览器**的删除菜单项调的就是它 —— `…setWarning(!0).onClick(() => this.app.fileManager.promptForDeletion(n))`（同一 API，非私有旁路）；
- 设置项在 bundle 里长这样：`deleteOption = [system | local | none]`、**`deleteAttachmentsOption = [ask | always | never]`**（与官方 changelog 的 Always / Ask every time / Never 三档逐字对应）。
- `trashFile` 的实现也确认会读 `trashOption`（`"system" !== config ? … : vault.trash(file, true)`）。

**结论：方案 C 的第一层成立且零成本 —— 插件调 `fileManager.promptForDeletion(noteFile)` 就能拿到「Trash 偏好 + 附件问题」的官方体验。**

🔴 **但挖出一个必须处理的细节（新决策点 D-9）**：`promptDelete === false` 时 `promptForDeletion` **不弹任何窗、直接删**（上面 `n ? … : …` 的分支）。用户若在 Obsidian 里关掉了「删除前确认」，我们用它的 API 就等于**没有任何确认地删掉条目 + 笔记**。⇒ **插件必须先自己确认**：读 `vault.getConfig('promptDelete')`（非公开 API，用 `as any` + try/catch 兜底），为 `false` 时先弹我们自己的清单确认。

### 6.2 决策点（只回改动项即可）

| 编号 | 决策点 | 推荐 |
|---|---|---|
| D-1 | 主方案 | **C 混合** |
| D-2 | 第二层（自绘清单）是否**只在有可清理项时**才弹 | **是**（避免连环弹窗） |
| D-3 | 批量删除是否也调原生弹窗 | **否**（会弹 N 次）→ 统一走自绘 |
| D-4 | 媒体文件（书/影片）是否进清单 | **进，但默认不勾 + 「高级」折叠 + 二次确认** |
| D-5 | 玩家截图 | **不纳入**，交给原生弹窗 |
| D-6 | 「清理孤儿封面」是否升级成「附件清理」（封面 + 阅读存档 + 旧书签）并加命令面板入口 | **是** |
| D-7 | 删除是否统一改走 `trashFile`（尊重回收站偏好） | **是**（顺带修缺陷 3） |
| D-8 | 是否给「删除条目」弹窗加「删除后放进回收站」的可视开关 | **不加**（跟随 Obsidian 设置即可，避免两个真源） |
| **D-9** | **`promptDelete === false`（用户在 Ob 里关了删除确认）时怎么办**（§6.1 新发现） | **读该配置，为 false 时先弹我们自己的清单确认**（否则会无确认地删条目 + 笔记） |
| **D-10** | 官方弹窗与自绘清单的**先后顺序** | **先官方**（笔记 + 其链接的封面/截图）→ 再自绘（本插件资产，且仅当有可清理项） |

---

## 7. 本方案不做什么

- ⛔ 不做「全库未引用附件扫描」（Safe Attachment Trash 那种）—— 那是 vault 级工具，容易把用户没关联到条目的普通文件卷进来；本方案只清**条目自己的**资产 + **封面目录**。
- ⛔ 不做「自动/定时清理」。
- ⛔ 不改笔记里的资产表达方式（封面仍是 `![[…]]` 嵌入）。
