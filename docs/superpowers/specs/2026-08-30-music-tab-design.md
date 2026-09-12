# 音乐页签设计（ReelLudic × LyricFlux 联动）

> 日期：2026-08-30 | 状态：设计已确认 | 范围：ReelLudic 新增音乐类型/页签 + 豆瓣音乐源 + lrc 笔记模板

## 背景与目标

ReelLudic 是 Obsidian 三库一体媒体管理插件（影视/书籍/游戏）。LyricFlux 是同作者的侧边栏内嵌歌词播放器，支持「LRC 笔记路径」模式：笔记内 ` ```lrc ` 代码块首行 `source 路径` 即渲染播放器（`/^source (?<audio>.*)/i`，原生支持 `[[wiki链接]]` / 库外绝对路径 / vault 相对路径三种解析）。

目标：ReelLudic 新增「音乐」页签，接豆瓣音乐源获取单曲信息并生成带 lrc source 块的音乐笔记，与 LyricFlux 目录解耦联动（LyricFlux LRC 笔记文件夹指向 ReelLudic 媒体库目录即可播放）。

## 澄清结论（用户确认）

| 维度 | 决定 |
|---|---|
| 条目粒度 | **单曲为条目**（歌手 + 歌名） |
| 豆瓣回填字段 | 封面、作者、发行年、来源、评分（含评价人数） |
| 本地音频关联 | **表单单行选择**（Electron 浏览选文件，路径只读展示）→ 写入 lrc source 行 |
| 设置页 | **只改「服务集成」描述文案**（含音乐），不新增开关 |
| LyricFlux 联动 | **目录解耦**：音乐笔记生成在 ReelLudic 媒体库目录，LyricFlux 的 LRC 笔记文件夹指向该目录 |
| 接入方案 | 方案 A 完整接入（music 类型 + 豆瓣音乐 cat=1003 搜索/详情回填） |

## 设计

### 1. 数据层（schema 只增不改）

- `EntryType` 增 `'music'`；同步 `ENTRY_TYPES` / `ENTRY_TYPE_LABELS` / `TYPE_COLORS`（types.ts）
- 状态文案（labels.ts）：`music: { want: '想听', watching: '在听', watched: '已听', archived: '存档' }`
- `MediaEntry` 新增两个可选字段：
  - `album?: string` —— 所属专辑（豆瓣详情回填，表单可改）
  - `audioPath?: string` —— 本地音频 vault 相对路径（lrc source 行来源；也兼容库外绝对路径）
- 歌手复用现有 `author` 字段；评分复用 `communityScore` + `ratingCount`；封面复用 `poster`；来源复用 `source`/`sourceUrl`
- `catalog.ts` normalizeEntry 透传 `album`/`audioPath`（过滤空串/非字符串）+ catalog.test 回归

### 2. 豆瓣音乐接入（复用现有 douban.ts 通道）

- `DOUBAN_CAT` 增 `music: 1003`；`DOUBAN_DOMAIN` 增 `music: 'music.douban.com'`
- 搜索：现有 `GET https://www.douban.com/j/search?q={q}&cat=1003`（JSON，items HTML 片段），`parseDoubanItem` 通用
- 详情：`https://music.douban.com/subject/{id}/`，走 JSON-LD 解析分支（音乐详情页含 JSON-LD：byArtist/datePublished/aggregateRating），失败回退 og meta
- 回填映射：byArtist → `author`；datePublished → `year`；aggregateRating → `communityScore`/`ratingCount`；封面 → `poster`；专辑 → `album`
- 反爬/Cookie 失效走现有 DoubanCookieError 机制（设置页服务集成文案含音乐）

### 3. 音乐表单（EntryForm）

```
作品基础信息
  标题 [歌名]      作者 [歌手]      发行年 [2020]     专辑 [可选]
  封面（右键更换）
简介（豆瓣回填，auto-grow）
本地音频： [C:\...\不再犹豫.mp3]  [浏览…] [✕]   ← 只读路径 + 浏览选择 + 清除
评分（只读）：★ 9.3 · 127,431 人评价
个人状态与评价：状态（想听/在听/已听/存档）+ 我的评分 + 评语
```

- 音乐类型**无**总集数 / 观看链接区块（单行音频选择替代，与影视集按钮区分）
- 音频选择复用现有 `pickLocalVideoPath`（Electron remote.dialog，filters 音频扩展名 mp3/flac/m4a/ogg/wav）；选中后转 vault 相对路径（`normalizePath`）存 `audioPath`，库外绝对路径原样保留（LyricFlux 两者都支持）
- 表单音频路径只读展示 + 「浏览…」「✕ 清除」；音频扩展名过滤

### 4. 笔记模板（noteGenerator）

> 2026-08-30 用户调整：基本信息改用 bookinfo callout 表格（与现有书籍模板同构）；评分带评价人数；lrc 块在 callout 后、评语前；评语用一级标题 `# 个人评语`（音乐类型与其他类型 `##` 不同，按用户要求）。

```
---
id: e_xxx
type: music
title: 不再犹豫
status: want
rating: 0
year: 1991
album: 犹豫
---

# 不再犹豫

> [!bookinfo]+ **《 不再犹豫 》**
>
> ![[不再犹豫.jpg]]
>
| 属性   | 内容   |
|:------ |:------ |
| 作者   | BEYOND |
| 发行年 | 1991   |
| 来源   | [不再犹豫](https://music.douban.com/subject/4899751/) |
| 评分   | 9.7 · 127,431 人评价 |

```lrc
source [[不再犹豫.mp3]]
```

# 个人评语

（在这里写下你的感想，支持 [[双链]]）
```

- 音乐类型 callout 表格固定四行：**作者**（`author`）/ **发行年**（`year`）/ **来源**（`sourceLinkText`）/ **评分**（`communityScore` + `ratingCount` →「9.7 · 127,431 人评价」，无评价人数则只显示分数）——不加「类型/个人评分」行
- callout 标题格式 `**《 标题 》**`（书名号内带空格，按用户示例）；封面 embed 复用 `posterEmbed`（本地路径 → `![[xxx.jpg]]` wikilink）
- lrc 块在 callout 之后、`# 个人评语` 之前；有 `audioPath` 才生成 `source [[相对路径]]` 行（LyricFlux 原生支持 wiki 链接），无音频不生成
- 评语章节用 **`# 个人评语`**（一级标题，音乐类型专用；其他类型保持 `##`）
- 模板输出单测断言：callout 四行表格、`source [[...]]` 行、`# 个人评语`、frontmatter 字段

### 5. 视图

- `HomeTab` 增 `'music'`；`TAB_ORDER` 插入（`['tracking', 'book', 'media', 'game', 'music', 'stats']`）
- 海报墙 / 列表 / 瀑布流通用（现有 MediaList 类型池机制）；卡片副行显示歌手 + 年份
- 音乐条目**不显示**观看按钮（播放交给 LyricFlux；卡片点击打开笔记）；类型筛选 chips 含音乐

### 6. LyricFlux 联动（目录解耦）

- 音乐笔记生成在 ReelLudic 媒体库目录（`entries/`）
- 用户在 LyricFlux 设置 LRC 笔记文件夹指向该目录 → 侧边栏歌单自动收录、播放器渲染
- ReelLudic 只保证 lrc 块格式正确（`source [[xxx.mp3]]`），不改 LyricFlux

### 7. 测试与交付

- catalog 回归（album/audioPath）+ labels（music 状态文案）+ noteGenerator（lrc 模板）
- tsc + esbuild 通过；三产物同步测试库（build/ + sync_plugin.ps1 + cmp 验证）
- 文档登记（CHANGELOG / current-progress）

## 明确不做（YAGNI）

- 不做豆瓣音乐搜索的歌词自动回填（歌词由 LyricFlux 在线歌词源获取）
- 不新增设置项（只改描述文案）
- 不做专辑为条目的聚合视图（单曲粒度已确认）
- 不改 LyricFlux 侧代码（目录解耦）
