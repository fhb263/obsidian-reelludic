# 阅读器翻译批（AI 划词翻译：智谱 GLM + DeepSeek 双源）设计

> 日期：2026-09-04 | 状态：设计已确认（用户快速确认，小功能直接开写） | 范围：ReelLudic 阅读器（TXT/EPUB）翻译能力
> 前置：批 1（仿 Readest UI）+ 批 1.5（软件式沉浸）已完成；翻译在批 1 作为动作条/顶栏「译」灰态占位预留，本批填充
> **r4 定稿（2026-09-04 夜）**：用户反馈 ③ 区 UI 混乱+要求简化——**模型字段直接去掉，固定为智谱 GLM-4-Flash / DeepSeek deepseek-v4-flash**；双 Key 字段始终都显示，不再按服务商切换；每个 Key 行**加测试连接按钮**（发 ping 验证 401/200）；服务商下拉只控默认源。
> **r3 定稿（2026-09-04 夜）**：经三轮换源后定为**双服务商可选**——① 智谱 GLM-4-Flash（免费，用户 cform 现用 key，端点 open.bigmodel.cn/chat/completions）+ ② DeepSeek（api.deepseek.com）。
> 翻译方向改为**自动中英互译**（同用户 cform prompt：中文→英文 / 英文→中文，只输出译文）。设置页「服务集成 → ③ AI 翻译」折叠项内服务商下拉切换、按源独立 Key/模型。
> **历次修订**：初版 DeepLX(localhost:1188，实测本机无服务 ERR_CONNECTION_REFUSED) → r2 改 DeepSeek 单源 → r3 加智谱成双源 + 自动中英互译 + 修复③折叠项打不开 bug（内层 .rl-key-row 未绑 click 致字段恒 hidden，改为平铺）。

## 决策（用户已确认）

| 决策点 | 结论 |
|---|---|
| 翻译服务 | **双源可选**：智谱 GLM（默认）/ DeepSeek，服务商下拉切换（settings `readerTranslateProvider`，默认 zhipu） |
| 端点 | 智谱 `POST https://open.bigmodel.cn/api/paas/v4/chat/completions`；DeepSeek `POST https://api.deepseek.com/chat/completions`；均 `Authorization: Bearer <Key>` |
| Key | 各源独立存：`readerZhipuKey` + `readerDeepseekKey`（仅 Key，无模型字段） |
| 模型 | **r4 起固定**：智谱 = `GLM-4-Flash`、DeepSeek = `deepseek-v4-flash`（hardcoded，UI 不暴露，用户不可改） |
| 翻译方向 | **自动中英互译**（同 cform：中文→英文 / 英文→中文，只输出译文；无固定目标语字段） |
| 设置 UI | 「③ AI 翻译（划词）」折叠项：hint + 服务商下拉 + 按源重绘 Key（密文）+ 模型（placeholder 给默认）；字段平铺修折叠 bug |
| 译文展示 | **选中附近就地浮层**卡片，不落库、无历史 |
| 协同 | 点动作条「翻译」→ **动作条收起**，译文浮层替换显示；含关闭 ✕、点外部/滚动收起 |
| 入口 | 动作条「译翻译」真调用 + 顶栏快捷「翻译」icon 真调用；顶栏左「高亮」仍灰态（下批） |
| 网络 | requestUrl POST；错误细分（未配对应源 Key / 401 Key 无效 / 429 限流 / 非 200 / 模型无译文） |

## 交互流

```
用户选中正文文本 → 动作条弹出（★书签 ❝摘抄 🖍高亮 [译翻译]）
  点「译翻译」→ 动作条收起 → 选中上方弹译文浮层卡片（loading → 译文 or 错误）
    浮层：译文文本 + 关闭 ✕；点外部/滚动/切章 → 收起（不落库）
EPUB：if​rame 内选中，坐标经 frameEl rect 换算到宿主，浮层挂宿主 body（同批 1 选中动作条换算）
```

## 架构

- `src/pure/translate.ts`（纯逻辑，无 obsidian import，TDD）：双源 OpenAI 兼容请求体 + 响应解析纯函数
  - `buildTranslateBody(text, provider?)` → `{ model, messages: [{system 中英互译指令},{user 原文}], stream:false }`；空文本 → null
  - `parseTranslateResponse(raw)` → 提取 `choices[0].message.content`（兼容部分端点的 `choice.text`）；非预期结构 → null
  - `modelFor(provider)` 固定模型（智谱 GLM-4-Flash / DeepSeek deepseek-v4-flash）；常量 `ZHIPU_CHAT_URL` / `DEEPSEEK_CHAT_URL` / `ZHIPU_MODEL` / `DEEPSEEK_MODEL`
- `main.ts`：`translateText(text)` 按 `readerTranslateProvider` 选 URL + 对应 Key，requestUrl POST Bearer；Key 未配/401/429/非 200/无译文 → 细分 Notice 并返回 null；`testTranslateConnection(provider)` 复用 `buildTranslatePingBody` 发 ping 验证
- `Settings.ts`：`readerTranslateProvider`('zhipu'|'deepseek') + `readerZhipuKey` + `readerDeepseekKey`（无 model 字段，r4 移除）；`serviceFoldOpen` 键 `translate`
- 设置 UI：`renderServiceSection` 加 **③ AI 翻译折叠项**（`renderTranslateFold`：hint + 服务商下拉 + `renderTranslateKeyBlock`×2 —名称/已配置徽标/密文 Key/测试连接按钮/结果文案；平铺）
- 阅读器 options：`onTranslate?: (text: string) => Promise<string | null>`（宿主持有网络）；面板仅负责调起 + 浮层展示
- 面板：`src/pure/` 之外新增译浮动条 DOM（`.rl-translate-card`），挂 selbarParent（同动作条定位上下文），TXT 直接挂 / EPUB 经坐标换算

## styles.css 新增

`.rl-translate-card`（就地译文卡：absolute 定位、max-width、圆角卡片、标题「译文」+ 关闭✕、加载态/错误态文字、Obsidian 变量色）。

## 测试策略

- pure/translate：`buildTranslateBody`/`buildTranslatePingBody`/`parseTranslateResponse`/`translateChatUrl`/`modelFor`/`normalizeProvider` 纯函数单测（TDD）
- 无 DOM 单测；面板手工目检（TXT/EPUB 各开一本：选中→翻译→浮层译文；未配 Key/401/429 → Notice）
- 回归 752 保持；tsc/esbuild/cmp 标准 gate

## 裁剪（不做）

- 不落库/无翻译历史/无语言临时切换/无逐词/无整章翻译/无高亮（下批）/无译文复制按钮（如便宜可加）
- 双源固定（智谱+DeepSeek），不做任意多服务商抽象（YAGNI）；各源固定官方端点（不提供自定义 base URL——官方统一 URL + Bearer Key 已够用）
