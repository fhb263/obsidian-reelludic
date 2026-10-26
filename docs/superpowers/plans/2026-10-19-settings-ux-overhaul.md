# 设置页交互与视觉改造 + 关于页「未来规划」

> 用户指令原文逐条落在下面，实现与验收逐项对标。本文件同时是并行施工的**接口契约**（CLASS/API 冻结）。

## 一、需求清单（用户原文，冻结）

### 🔴 一、核心 Bug 修复（优先处理）

1. **设置页顶部 Tab 栏层级穿透**：修复顶部页签（基本设置 / 元数据源配置 / AI 集成 / 高级设置 / 关于）被下方内容遮挡的问题。提升 Tab 栏 `z-index` 或修正 `position: sticky/fixed` 的上下文，确保**永远置顶**，不被「笔记属性顺序对比预览」的表头穿透。
2. **「附件管理」弹窗无法二次打开**：点右上角 X 关闭后，再点「附件管理」按钮唤不起弹窗。
3. **「附件管理」弹窗排版严重错位**：
   - 顶部蓝色标题「附件管理」与副标题（数量统计文案）**文字重叠**；
   - 底部提示文案与红线**被截断**、显示不全 ⇒ Footer 需固定高度、内容不溢出；
   - 列表区右侧滚动条**贴边** ⇒ 列表容器加内边距（如 16px）。

### 🟡 二、基础设置 - 实验性功能（视觉样式统一）

1. **统一外层背景**：移除「实验性功能」下三个选项外层的深灰包裹底色，与顶部常规选项背景**平铺一致**，消除视觉割裂。
2. **下拉容器减重**：保留折叠展开逻辑，展开后包裹「库内路径」等内容的灰色容器底色调浅 / 改透明，避免「灰块套灰块」。
3. **输入框宽度适配**：展开后的输入框用 Flex 拉伸（`flex-grow: 1`）占满右侧剩余空间，但保留安全边距（不要顶到容器边缘）。

### 🟡 三、基础设置 - 封面与清理（交互重构）

1. **「Bases 视图模板」按钮降级**：紫色高亮（Primary）改为与下方「扫描 / 查看」相同的白底灰边次按钮（Secondary/Outline）。
2. **文案修改**：描述改为 `生成 .base：用原生 Bases 浏览收藏库(重复生成即覆盖)`。
3. **「失效链接检测」改 Modal**：点「检测」后不再页内嵌渲染结果，改为**带灰色遮罩的居中弹窗**；列表展示所有失效条目的具体链接、可点击跳转；0 条时展示空状态（如「共检测到 N 个条目，未发现失效链接」）。
4. **「下载封面」进度改异步 Modal**：不再设置页内嵌进度，改为弹出异步 Modal，显示当前迁移状态（网络封面 → 本地封面文件名），底部带动效进度条，完成后自动关闭或显示完成态。

### 🟡 四、基础设置 - 附件管理（信息架构与排版重构）

**列表双层折叠聚合（Nested Accordion）**：
- 一级分类：按类型分组（电影、书籍、音乐等）；
- 二级系列：分类内按系列名聚合（如「电影」下折叠「熊出没系列 (共 13 部)」）；
- 散件处理：无系列归属的单文件在一级分类下平铺显示；
- 数量统计：两级分组标题右侧均渲染条目数；
- 视觉层级：外层（大分类）浅灰、内层（系列组）纯白或极浅，用分割线区分，避免嵌套过重。

### 🟢 五、高级设置 - 笔记属性顺序（逻辑与对齐规范）

1. **固定横向排序**：对比预览的横向分类顺序严格为 `['全局','电影','剧集','动画','文学','网文','漫画','游戏','音乐']`（**9 列**）。
2. **业务字段字典纠错**：
   - 移除「文学」「网文」下的**画师**属性（画师只属漫画）；
   - 移除「网文」下的 **ISBN**（出版实体书特有：留文学 / 漫画）；
   - 重新梳理各分类标准元数据字段映射，避免张冠李戴。

### ② 关于页新手引导 → 「未来规划」

1. 现有「新手引导」按钮与其弹出的引导样式**全删**；
2. 原位置换成 **「未来规划」** 按钮；
3. 点击弹**居中带遮罩的 Modal**，展示插件未来规划，做**九宫格**；扩展越大越深的方向颜色越深，用 **v0 / v1 / v2** 表示。

九宫格模块（用户给定，顺序即网格顺序）：

| 版块 | 覆盖范围 |
| --- | --- |
| 搜索添加 | 多源链式搜索导入、豆瓣等账号收藏批量导入、手动填写 + AI 预填 |
| 视图展示 | 海报墙 / 列表 / 瀑布流 / 时间线视图，筛选 / 排序 / 搜索操作 |
| 计划追踪 | 追番表 / 排期表（周/月历）、追更检测 |
| 播放阅读 | 内置阅读器（TXT/EPUB/PDF/漫画）、内置播放器（视频/音频）、游戏路径 lnk |
| AI 增强 | 摘要、预填、翻译、歌词双语、AI 搜索、选段解读、云端朗读 |
| 统计报告 | 统计页数据统计、评分看板、年度报告 |
| 个性化 | 外观与体验设置 |
| 数据运维 | 持久化、笔记表单双向同步、备份迁移、附件管理（下载/清理）、失效链接检测 |
| 生态联动 | 兼容 Bases、Dataview、桌面端和移动端插件 UI 功能适配 |

**成熟度定级（本批裁定，写进弹窗图例）**：v2 = 搜索添加 / 视图展示 / 播放阅读 / AI 增强；v1 = 计划追踪 / 统计报告 / 数据运维；v0 = 个性化 / 生态联动。

---

## 二、接口契约（并行施工冻结，改契约先改本文件）

### 2.1 CSS 类名（`styles.css` 唯一写者 = CSS 包）

| 类名 | 归属 | 说明 |
| --- | --- | --- |
| `.rl-set-bar` 提层 | 现有 | `z-index: 40` |
| `.rl-fo-cmp-scroll` 隔离 | 现有 | 加 `isolation: isolate`（内部 sticky th 不得冲出） |
| `.rl-exp-list` 拍平 | 现有 | 去背景 / 描边 / 圆角 |
| `.rl-exp-panel.is-open > .setting-item` | 现有 | 子面板透明化（去灰块套灰块） |
| `.rl-dir-row` | 新增 | 本地目录行：控件 `flex: 1 1 auto`、输入框拉伸、右侧安全边距 |
| `.rl-am-*` | 新增 | 附件管理弹窗（见 2.3） |
| `.rl-lc-*` | 新增 | 失效链接弹窗 |
| `.rl-pm-*` | 新增 | 下载封面进度弹窗 |
| `.rl-rm-*` | 新增 | 未来规划九宫格 |

### 2.2 纯逻辑层（`src/pure/*` 唯一写者 = 逻辑包）

```ts
// src/pure/fieldOrder.ts
export const BOOK_KIND_EXCLUDED_FIELDS: Readonly<Record<BookKind, readonly string[]>>;
//   book(文学)  : ['artist']
//   novel(网文) : ['artist', 'isbn']
//   comic(漫画) : ['isbn']
export function exclusiveFieldsForBookKind(kind: BookKind): string[];
export function defaultOrderForBookKind(kind: BookKind): string[]; // 原签名的实现要吃到排除表
```

```ts
// src/pure/fieldOrderCompare.ts
export type CompareColumnKey = string; // '__global' | `t:${EntryType}` | `k:${BookKind}`
export interface FieldOrderCompareColumn { key: CompareColumnKey; label: string; kind?: 'global' | 'type' | 'bookKind'; type?: EntryType; bookKind?: BookKind }
export const FIELD_ORDER_COMPARE_COLUMNS: readonly FieldOrderCompareColumn[];
//   9 列固定顺序：__global 全局 / t:movie 电影 / t:tv 剧集 / t:anime 动画 /
//                k:book 文学 / k:novel 网文 / k:comic 漫画 / t:game 游戏 / t:music 音乐
export function buildFieldOrderCompare(
    orders: Readonly<Record<string, string[]>>,
    globalOrder?: readonly string[],
): FieldOrderCompare; // rows/cells/sizes 的 key 口径不变
```

### 2.3 弹窗层新增文件（唯一写者 = 弹窗包）

```ts
// src/modals/LinkCheckModal.ts
export interface DeadLinkItem { entryId: string; title: string; label: string; url: string }
export class LinkCheckModal extends Modal {
    constructor(app: App, opts: { entries: number; dead: number; unknown: number; items: DeadLinkItem[] });
    // 标题「失效链接检测」；副标题「共检测到 N 个条目，未发现失效链接」/「M 条可能已失效」；
    // 列表每行：条目名 + 字段名 + 可点击链接（window.open(url,'_blank')）；0 条走空状态。
}

// src/modals/PosterMigrateProgressModal.ts
export interface ComiclikeProgressStep { title: string; from: string; to: string }
export class PosterMigrateProgressModal extends Modal {
    constructor(app: App);
    setProgress(done: number, total: number, step?: { title: string; from: string; to: string }): void;
    finish(result: { success: number; fail: number; skipped: number; total: number; failures: { title: string; reason: string }[] }): void;
    fail(message: string): void;
}

// src/modals/RoadmapModal.ts
export class RoadmapModal extends Modal { constructor(app: App); }
```

### 2.4 宿主接线（`main.ts` + `src/Settings.ts` 唯一写者 = 设置页包）

- `openAssetManager()`：`assetManagerOpen` 标志必须在弹窗关闭时**复位**（否则二次打不开）。
- `scanLibraryLinks()` 返回值新增 `items: DeadLinkItem[]`（失效的具体链接）。
- `localizeAllPosters(onProgress)` 的进度回调新增第 3 参数 `step?: { title; from; to }`（当前网络封面 → 本地文件名）。
- `listEntryAssets()` 返回的 `AssetGroup.entry` 增加 `series?: string`（供二级系列聚合）。

## 三、文件域（并行互斥，越界即冲突）

| 包 | 文件 |
| --- | --- |
| 逻辑包 | `src/pure/fieldOrder.ts`、`src/pure/fieldOrderCompare.ts`、`src/pure/metaFields.ts`、`tests/fieldOrder.test.ts`、`tests/fieldOrderCompare.test.ts` |
| 设置页包 | `src/Settings.ts`、`main.ts`、`src/modals/EntryRestoreModal.ts`、新增 `src/modals/AssetManagerModal.ts`、删除 `src/modals/GuideModal.ts` |
| 弹窗包 | 新增 `src/modals/LinkCheckModal.ts`、`src/modals/PosterMigrateProgressModal.ts`、`src/modals/RoadmapModal.ts` |
| CSS 包 | `styles.css` |

## 四、验收（收口由主控执行）

1. `node node_modules/typescript/bin/tsc -noEmit -skipLibCheck`
2. `node esbuild.config.mjs production`（warnings 基线 87）
3. `node node_modules/vitest/vitest.mjs run`（root 必须大写盘符 `C:/…`）
4. `node _deploy.cjs` → `node tools/rd.cjs` 真机截图 + `check` 断言（tab 栏层叠、弹窗排版、九宫格）
