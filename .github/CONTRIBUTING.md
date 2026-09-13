# 贡献指南

感谢你愿意为 ReelLudic 出力。这份文档说明本项目的开发方式、代码约定与提交要求——**提交 PR 前请先读一遍**，能省下双方大量往返。

如果你只是想反馈问题或提建议，直接用 [Issue 模板](https://github.com/fhb263/obsidian-reelludic/issues/new/choose) 即可，不必读到这里。

---

## 环境准备

需要 Node.js 18 或更高版本。

```bash
git clone https://github.com/fhb263/obsidian-reelludic.git
cd obsidian-reelludic
npm install
```

把仓库放到你的测试 Vault 的 `.obsidian/plugins/` 下，或按下面的方式构建后手动拷贝产物。

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 开发模式（esbuild watch，产出带 sourcemap 的 `main.js`） |
| `npm run build` | 生产构建（先 `tsc -noEmit` 类型检查，再 esbuild 打包） |
| `npm test` | 跑单元测试（vitest，一次性） |
| `npm run test:watch` | 单元测试 watch 模式 |
| `npm run version` | 同步 `package.json` / `manifest.json` / `versions.json` 的版本号 |

### 在 Obsidian 里验证

1. `npm run build`
2. 把根目录的 `main.js`、`styles.css`、`manifest.json` 复制到 `<你的Vault>/.obsidian/plugins/obsidian-reelludic/`
3. Obsidian 中 `Ctrl/Cmd + P` → `Reload app without restarting`

**只构建不部署等于没验证** —— 目录里还是上一版的产物，容易把「没生效」误判成「没修好」。改完代码请务必走完这三步再复测。

---

## 项目结构

```
main.ts                 插件入口：命令注册、视图注册、事件中枢
src/
  pure/                 纯逻辑（不依赖 obsidian，全部可单测）
  services/             数据源抓取与网络层（douban / tmdb / bangumi / steam / …）
  data/                 catalog.json 读写、笔记生成、类型定义
  views/                主视图与其 Svelte 组件
  modals/               各类弹窗
  Settings.ts           设置页
tests/                  vitest 单测（与 src/pure、src/data 等同位对应）
```

架构上有一条重要倾向：**逻辑尽量下沉到 `src/pure/`**，界面层只做渲染与事件转发。这样绝大多数行为都能被单元测试覆盖，而不必依赖人工点界面。

---

## 代码约定

### TypeScript

- `strict` 模式，避免 `any`；变量与函数 `camelCase`，类与类型 `PascalCase`
- 缩进 4 空格
- 注释只写在复杂逻辑处，不要逐行复述代码

### 纯逻辑必须可测

校验、解析、换算、排序、命名生成这类逻辑，一律放进 `src/pure/`，配 `tests/` 下的单测。**先写失败用例（红），再实现（绿）。**

在 `src/` 顶层新增目录时，记得同步在 `vitest.config.ts` 的 alias 表里注册，否则单测解析不了裸导入。

### Svelte

项目使用 Svelte 4，有两条容易静默翻车的限制：

- 事件必须用指令语法 `on:click={fn}`。裸写 `onclick={fn}` 会被编译成普通属性，点击**无任何反应也不报错**。
- 模板表达式不支持 `as` 类型断言、`!` 非空断言、以及 `bind:value` 绑定数组下标。改用预类型化常量、可选链，或把断言放进 `<script>`。

另外，`.svelte` 文件**不经过 `tsc` 检查**（`tsconfig.json` 的 `include` 只含 `.ts`），类型写错要到运行时才炸，而且常被 `try/catch` 吞掉表现为「功能静默不生效」。改完 Svelte 组件后，建议 `grep` 一下 `main.js` 确认目标代码确实进了产物。

### 样式

界面风格对齐 Obsidian 原生语言，颜色与尺寸优先用 Obsidian 的 CSS 变量（`--text-normal`、`--background-primary` 等），确保浅色与深色主题下都可读。悬停提示统一用 `data-tip` 属性，不要用原生 `title`（会和 Obsidian 官方气泡叠成两层）。

### 两处「红线」

这两类改动会直接损坏用户已有数据，请谨慎对待，必要时先开 Issue 讨论：

- **`catalog.json` 的 schema 只增不改。** 字段可以追加（带默认值、读取端做兜底），但不能删除或改类型。
- **视图类型 ID 不能改**（`reelludic-media`、`reelludic-tracking`），否则用户 `workspace.json` 里保存的布局全部失效。

---

## 提交流程

### Commit message

格式：`<类型>: <简述>`

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `refactor` | 重构（不改变行为） |
| `style` | 样式 / 界面调整 |
| `docs` | 文档 |
| `chore` | 构建、依赖、工具链 |

一个提交只做一件事。代码、界面、文档尽量拆开，便于回溯。

### Pull Request

1. Fork 仓库，从 `master` 切出分支（如 `fix/douban-cover-403`）
2. 完成改动，确保 `npm run build` 与 `npm test` 都通过
3. 按 [PR 模板](PULL_REQUEST_TEMPLATE.md) 填好说明，界面改动请附前后截图
4. 保持 PR 聚焦——一个 PR 解决一个问题

提交 PR 即表示你同意你的贡献以 [GPL-3.0](LICENSE) 授权发布。

---

## 数据源相关改动的额外说明

各数据源都没有官方授权的稳定接口，插件走的是网页接口或公开 API。改这部分时请注意：

- **不要把 Cookie、Token、API Key 写进代码或测试**，这些一律由用户在设置页自行填写
- 抓取失败要降级而不是抛错崩溃，并给出可操作的中文提示
- 请求要节流（项目内已有串行限流与缓存），不要改成并发轰炸
- 新增数据源请同步在 `src/pure/sourceRegistry.ts` 注册，并补上设置页说明文案

---

## 遇到问题

- 使用层面的疑问 → 先看 [README 的常见问题](README.md#faq)
- 开发层面的疑问 → 开一个 Issue，或在已有 PR 下留言

再次感谢你的贡献。
