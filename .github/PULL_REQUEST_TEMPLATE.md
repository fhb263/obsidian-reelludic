## 这个 PR 做了什么

<!-- 一句话说清解决的问题或实现的功能 -->

## 关联 Issue

<!-- 例如 Closes #123；没有对应 Issue 可以写「无」 -->

## 改动类型

- [ ] 修复 Bug
- [ ] 新功能
- [ ] 重构（不改变行为）
- [ ] 样式 / 界面调整
- [ ] 文档
- [ ] 构建 / 工具链

## 涉及范围

- [ ] `src/pure/`（纯逻辑）
- [ ] `src/services/`（数据源 / 网络层）
- [ ] `src/data/`（schema / 落库 / 笔记生成）
- [ ] `src/views/`、`src/modals/`（界面）
- [ ] `src/Settings.ts`（设置页）
- [ ] `src/main.ts`（入口，属于高风险改动，请在下方说明原因）
- [ ] `styles.css`
- [ ] `tests/`
- [ ] 仅文档 / 构建脚本

## 自检清单

- [ ] `npm run build` 通过（含 `tsc` 类型检查，未被跳过）
- [ ] `npm test` 全绿
- [ ] 纯逻辑改动已补对应 `tests/` 单测（先写失败用例再实现）
- [ ] 未删除、未改写 `catalog.json` 已有字段；新增字段有默认值且读取端做了兜底
- [ ] 在 `src/` 顶层新增了模块时，已在 `vitest.config.ts` 的 alias 表注册
- [ ] 改了 `.svelte` 后已 `grep` 编译产物 `main.js` 验证目标代码形态（Svelte 文件不经 tsc 检查）
- [ ] 改了 `package.json` / `manifest.json` / `versions.json` 的版本号时三者一致
- [ ] 已在 Obsidian 中实际加载并手工验证过改动（Reload 插件后复测）

## 界面改动（若涉及）

<!-- 请贴改动前后的截图，或说明交互变化。样式调整请注明在浅色与深色主题下的表现 -->

## 补充说明

<!-- 兼容性影响、迁移逻辑、需要审阅者特别留意的地方 -->
