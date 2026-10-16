# DESIGN.md — ReelLudic 技术设计

> 版本：**v1.4.0 期**（最近发布版 v1.3.0 / 2026-10-11；**当前开发版 1.4.0 / 2026-10-16**）| 最后更新：**2026-10-16** | 状态：已实现（本文件为当前实现的实现依据，随代码演进）
> 🔴 **真源口径**：schema 字段全集、视图 / 命令 ID、数据源清单、目录命名 —— 本文是**导读**，逐项以代码为准（`src/data/types.ts` / `src/views/*.ts` / `src/pure/sourceRegistry.ts` / `src/pure/dirs.ts`）。凡本文与代码冲突，**改本文**。



---

## 1. 架构分层

```
┌─ 展示层 ─────────────────────────────────────────────┐
│  HomeView.ts/.svelte（统一视图 reelludic-home，页签容器；三种导航布局）│
│    ├─ MediaList（书架：海报墙/列表/瀑布流 + 筛选排序 + 系列折叠卡）    │
│    ├─ TrackingBoard（追番表：更新检测 + 一键已更新）     │
│    ├─ CalendarBoard（排期表：月历/周历 + 拖拽排期 + 到期横幅 + 日期点击弹详情）│
│    └─ StatsBoard（统计页三层：核心指标 1 主 4 辅 → 动态 → 趋势 → 概览 Tab）│
│  独立视图（各一个 leaf）：TXT / EPUB / PDF / **漫画** 阅读器 ＋ 视频播放器 ＋ **音频播放器**│
│  Modals（26 个）：EntryModal（添加/编辑）+ ExcerptModal/GameSessionModal│
│          + CalendarDayModal/ConfirmModal/DeleteEntryModal/NoteConflictModal│
│          + PosterMigrateModal/PosterCleanupModal/PosterSearchModal/AssetCleanupModal│
│          + LinkPickerModal/EpisodePickerModal/SubtitlePickerModal/QuickAssociateModal│
│          + SeriesPickerModal/AiPickerModal/ImportBangumiModal/ReleaseNotesModal│
│          + **BookDownloadModal/MusicDownloadModal/SourceSubscribeModal**│
│          + **TxtReaderModal/EpubReaderModal/PdfReaderModal/ComicReaderModal**│
└──────────────────────────┬───────────────────────────┘
┌─ 功能层 ─────────────────┼───────────────────────────┐
│  EntryService（增删改查编排、状态流转、笔记生成/双写冲突）│
│  services/douban.ts（全类型主力：反爬 + Cookie 失效提示）│
│  services/tmdb.ts（影视）/ bangumi.ts（动画 **+ 漫画**）│
│  services/nodeHttp.ts（Node 传输层：重定向/Cookie/PoW）│
│  **12 源注册表**：另含 openLibrary / googleBooks / steam / musicbrainz /│
│     itunes / omdb / anilist / igdb / mangadex（真源 `pure/sourceRegistry`）│
│  **下载与源链**：novelSource（书源引擎）/ sourceFetch / sourceCheck /│
│     downloader + musicDownload + ytdlp / epubWriter / linkCheck（失效链接）│
│  **AI / 语音**：aiSummary / aiPrefill / aiIcon / translate / TtsService│
└──────────────────────────┬───────────────────────────┘
┌─ 数据层 ─────────────────┼───────────────────────────┐
│  catalog.ts（catalog.json 读写 + normalizeEntry 归一） │
│  noteGenerator.ts（.md 详情笔记生成，纯逻辑）           │
│  types.ts（MediaEntry + entryType 六类型 + BookKind/MusicKind 子分类）│
│  pure/（**148 个无 obsidian 依赖纯模块**，逐一配 tests/）│
│     status/labels/rating/dirs/cardMeta/stats/report/│
│     搜索链 search*+resultMerge+searchCache/子分类 bookKind+musicKind/│
│     进度 bookProgress+readingProgress+pdfProgress+epubParse+txtParse+bookmark+highlight+readTimer/│
│     源注册 sourceRegistry/追更 tracking+updateCheck+episodeScan/│
│     下载 downloadPlan+songDownload+novelPack+chapterPlan+cancel/│
│     系列 seriesGroup / 导航 navLayout+mergedPages+mergedScope+homeTabs /│
│     设置 settingNav+appearance / 排序 sortOptions / 图标 searchIcons /│
│     失效检测 linkStatus / 仿真辅助 menuPlacement+virtualWindow …│
└──────────────────────────┬───────────────────────────┘
┌─ 基础设施 ───────────────┼───────────────────────────┐
│  Vault API（媒体库/ 中文目录读写，ensureParentFolder）  │
│  Settings（**12 源注册表**凭据/6 组源链/翻译 Key/库目录/播放阅读开关/外观）│
│  main.ts（命令注册 + 视图注册 + 事件中枢 + 目录迁移编排）│
└──────────────────────────────────────────────────────┘
```

依赖方向自上而下；纯逻辑模块（data / pure）不依赖 obsidian API，可直接单测。

## 2. 存储设计（vault 内 `媒体库/` 目录，v0.4 中文化）

```
媒体库/
├── catalog.json        # 目录元数据（唯一事实源）
├── 笔记/               # 每条目一个 .md 详情笔记（原 entries/）
│   ├── book/ novel/ comic/              # 书籍按子分类分：文学 / 网文 / 漫画
│   └── movie/ teleplay/ animation/ game/ music/
├── 封面/               # 本地封面图片（原 covers/，{标题}.jpg 命名）
├── 阅读进度/           # 书签 / 高亮 / 阅读进度三者同放的 JSON
├── 下载续传/           # 书籍抓章的中间态存档（*.ndjson，抓完即删）
├── 备份/               # 导出备份（原 backups/）
├── 报告/               # 年度总结等（原 reports/）
└── 下载/               # 音乐 / 书籍下载落盘根（`pure/downloadPlan.DOWNLOAD_ROOT_DEFAULT`）
```

🔴 目录名常量**只在一处定义**：全部在 `src/pure/dirs.ts`（`DIR_NOTES` / `DIR_COVERS` / `DIR_BACKUPS` / `DIR_REPORTS` / `DIR_READING` / `DIR_DOWNLOAD_RESUME`），笔记子目录走唯一裁决入口 `noteSubDir(e)`（书籍按 `BookKind` 分、其余按类型）。⛔ 别在别处硬编码目录名。
⚠️ 「下载续传」与「下载」**刻意分开放**：存档是 `.ndjson` 中间态，混进 `下载/书籍` 会被「库内找回同名书」当成一本书扫进来。

### catalog.json schema（v1，字段只增不改）

```json
{
  "version": 1,
  "entries": [
    {
      "id": "e_1724596000000_ab12",
      "type": "tv",
      "title": "进击的巨人 最终季",
      "originalTitle": "進撃の巨人 The Final Season",
      "status": "watching",
      "rating": 4,
      "year": 2020,
      "genres": ["动画", "动作", "奇幻"],
      "director": "林祐一郎",
      "cast": ["梶裕贵", "石川由依"],
      "poster": "封面/进击的巨人 最终季.jpg",
      "progress": {
        "season": 4, "episode": 16,
        "totalEpisodes": 28, "lastWatchedDate": "2026-08-20",
        "history": [{ "season": 4, "episode": 15, "date": "2026-08-18" }]
      },
      "links": [
        { "label": "B站", "url": "https://www.bilibili.com/bangumi/..." }
      ],
      "notes": "个人评语",
      "tags": ["神作"],
      "notePath": "媒体库/笔记/进击的巨人 最终季.md",
      "noteFingerprint": "FNV-1a 指纹（双写冲突检测）",
      "excerptCount": 12,
      "latestKnownEpisode": 27,
      "series": "进击的巨人", "seriesIndex": 4,
      "episodeUrls": ["https://www.bilibili.com/bangumi/play/ep1", ""],
      "episodeTitles": ["来自海的那一边", "定罪"],
      "source": "bangumi", "sourceUrl": "https://bgm.tv/subject/...",
      "sourceName": "",
      "communityScore": 8.5, "ratingCount": 517685,
      "summary": "剧情简介",
      "createdAt": "2026-08-25T18:00:00.000Z",
      "updatedAt": "2026-08-25T18:00:00.000Z"
    }
  ]
}
```

**Schema 红线**：字段只能新增、不能删除/改类型（AGENTS.md 强制），保证已存数据永不损坏。新增字段必须同步 `normalizeEntry` + catalog.test 回归（summary 曾遗漏导致保存即丢）。

其余按类型可选的关键字段（**字段全集以 `src/data/types.ts` 为准**）：
- **通用**：`series` / `seriesIndex`（系列与序号，全 6 类型；序号只锁整数）、`sourceName`（手工条目的来源名，封面色标 / 表单链接 / 笔记「来源」行三处唯一入口 `pure/sourceMeta.entrySourceLabel`）
- **影视动画**：`progress`（季·集 + 历史）、`episodeUrls` / `episodeTitles` / `episodeFiles`（逐集链接 / 标题 / 本地文件）、`localWatchDir`、`videoPositions`（各文件播放位置）
- **书籍**：`bookKind`、`bookFile`（本地文件或文件夹）、`readUrl`（在线阅读链接）、`readingProgress`（页 / 百分比）、`readMinutes`（阅读时长）、`toc`、`isbn` / `publisher` / `binding`
- **漫画**：与书籍同字段，另 `artist`（画师）、总话数
- **游戏**：`platform` / `developer`、`gameLaunchPath`（本地启动）、`gameUrl`（网络路径）、`playtimeMinutes` / `playSessions`
- **音乐**：`artist` / `album` / `audioPath`、`musicKind`

### 条目 .md 笔记模板

```markdown
---
id: e_1724596000000_ab12
type: tv
title: 进击的巨人 最终季
status: watching
rating: 4
year: 2020
genres: [动画, 动作, 奇幻]
progress_season: 4
progress_episode: 16
poster: 封面/进击的巨人 最终季.jpg
banner: 媒体库/封面/进击的巨人 最终季.jpg
---

# 进击的巨人 最终季

## 基本信息
- **导演**：林祐一郎
- **主演**：梶裕贵 / 石川由依
- **来源**：[Bangumi ↗](https://bgm.tv/subject/...)

## 内容简介

（剧情简介）

## 个人评语

（在这里写下你的感想，支持 [[双链]]）

## 观看·相关链接
- [第 1 集 集标题](https://www.bilibili.com/bangumi/play/ep1)
```

🔴 章节结构（基本信息 / 内容简介 / 个人评语 / 一句话总结 / 核心看点 / 游玩记录 / 相关链接·观看链接）是**公共约定，⛔ 不可重命名** —— 重命名会破坏既有笔记的可读性与回填解析（`pure/noteEditable`）。
🔴 **空评语那行是解析哨兵**（文本真源 `pure/noteEditable.NOTES_PLACEHOLDER`，判定只走 `isNotesPlaceholder()`，新旧形态都算「未写」）。
🔴 **影视的逐集网络链接**写成 `- [第 N 集 集标题](url)`（标签走 `pure/episodeAssoc.episodeHintLabel` 同一真源）；**本地路径不写进笔记**（绝对路径又长又不可点）。

frontmatter 与 catalog.json 双向冗余：catalog 是运行事实源，frontmatter/正文让用户可读可改（打开表单时经 noteEditable 回填覆盖 catalog 值）；保存时经 noteFingerprint 检测外部修改弹二选一。

## 3. 核心枚举（pure/）

```ts
// 状态流转：想看 → 在看 ⇄ 已看；任意态 ↔ 存档（弃剧已移除，存量 dropped 迁移 archived）
type MediaStatus = 'want' | 'watching' | 'watched' | 'archived';
// 条目类型（六态平铺：影视动画聚合浏览，书籍/游戏/音乐独立）
type EntryType = 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music';
// 书籍子分类（append-only 可选字段）：文学 / 网文 / 漫画 —— 归一见 pure/bookKind
// ⚠️ 漫画 1.0.3.1 曾下线，#444e（2026-09-30）加回：独立源链组 + 独立 笔记/comic/ 目录
type BookKind = 'book' | 'novel' | 'comic';
// 音乐子分类：原 'other' 已下线，存量值归 music（音乐不再分子类）
type MusicKind = 'music';
// 评分 1~5，0 = 未评分
type Rating = 0 | 1 | 2 | 3 | 4 | 5;
```

⚠️ 合法值集合以 `BOOK_KIND_LABELS` / `MUSIC_KINDS` 为准；归一函数用 `Object.keys` / `includes` 校验，**⛔ 禁用 `in`**（会沿原型链把 `toString` 判成合法）。新增子分类值时必须三件套同步：`MediaEntry` 字段注释 + `normalizeEntry` 白名单 + `catalog.test.ts` 回归。

## 4. 抓取流程（12 源注册表 + 6 组源链；真源 `src/pure/sourceRegistry.ts`）

```
用户输入标题 → 按类型（书籍再按子分类）选源链（并行 + 步骤化进度条）
  文学 / 网文 → 豆瓣 + Open Library（Google Books 可选加入）
  漫画       → 豆瓣 + Bangumi（subjectType=1 书籍类目）+ MangaDex
  游戏       → 豆瓣 + Steam
  音乐       → 豆瓣 + MusicBrainz + iTunes
  影视       → TMDB + 豆瓣 并行 → mergeBySource 同源去重 / sortByRelevance 相似度排序
  动画       → Bangumi + 豆瓣 并行
  → 候选列表 → 用户选择（豆瓣封面下载到本地）→ 按命中源切换表单 UI（douban/tmdb/bangumi）→ 保存
网络失败 / Cookie 失效 / 拦截页 → 明确提示，不阻塞手动添加
```

- **12 个源全部在册**：`douban` / `tmdb` / `bangumi` / `openLibrary` / `googleBooks` / `steam` / `musicbrainz` / `itunes` / `omdb` / `anilist` / `igdb` / `mangadex`。⚠️ 凡涉源清单（文档 / UI 文案 / 测试 / 断言）**一律以 `PROVIDERS` 为准去遍历** —— ⛔ 别信手抄名单。
- **6 组源链**（`DEFAULT_CHAINS`，设置页可勾选）：`book` = 豆瓣 + Open Library｜`comic` = 豆瓣 + Bangumi + MangaDex｜`game` = 豆瓣 + Steam｜`music` = 豆瓣 + MusicBrainz + iTunes｜`movieTv` = 豆瓣 + TMDB｜`anime` = 豆瓣 + Bangumi。
  ⚠️ `comic` **不是** `EntryType`（是 book 的 `bookKind` 子类），路由走 `sourceGroupForBookKind`（⛔ 不改 `sourceGroupForType`）；Bangumi 同时服务 `anime` 与 `comic` 两链。
- **Douban**：全类型主力源。已适配反爬：Node 传输层（nodeHttp.ts：手动重定向 + Set-Cookie 续传 + 30s 超时 + GET 重试）+ 完整浏览器头 + dbcl2 登录态 Cookie + sha512 PoW 自动求解 + 拦截页三态检测 + 封面防盗链（Referer=douban.com 下载本地）。**Cookie 失效抛 DoubanCookieError 明确提示**（主源有结果不打扰）。音乐详情 JSON-LD：byArtist → author（歌手）、inAlbum/album → album。
- **TMDB**：官方 API v3（movie/tv），`language=zh-CN`；vote_count → ratingCount。
- **Bangumi**：/v0/search/subjects + /v0/subjects/{id}（评分/评价人数/制作公司）+ /v0/subjects/{id}/persons（导演/主演，type 兼容字符串）；漫画走 `subjectType=1` 书籍类目，缺 Token 时静默降级。
- **封面**：默认下载本地 `封面/{标题}.jpg`（sanitizePosterTitle 清洗 + 重名 -2/-3 防覆盖 + 幂等；未保存弹窗清理孤儿文件）。

## 5. 视图与命令注册（main.ts）

| 项       | 值                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 视图类型 ID | **共 7 个在册**（见下表）；其中 `reelludic-home` 是统一视图（页签**共 6 个**：计划 / 阅读 / 影视 / 游戏 / 音乐 / 统计 —— ⚠️ 第二个是「阅读」不是「书籍」，页签显示名见 `HomeView.svelte` 的 `tabLabel`）、`reelludic-tracking`（历史遗留 ID，**勿改**） |
| 命令      | `open-media-library` / `open-tracking-board` / `add-media-entry` / `add-excerpt`（书籍摘抄）/ `novel-download-open` / `book-download-open` / `audio-player-open-tab` / `audio-player-open-sidebar` / `player-capture-frame` / `player-insert-timestamp` / `cleanup-orphan-assets` |
| Ribbon  | 书架视图 + 快速添加                                                                                                                                                |

**视图清单**（真源 = 各自的 `*.ts` 导出常量）：

| 视图 | ID | 说明 |
|---|---|---|
| 书架 / 统一视图 | `reelludic-home` | 页签容器，**三种导航布局**（顶部胶囊 / 右上角文字菜单 / 合并视图） |
| 视频播放器 | `reelludic-video-player` | 自绘控件，画面撑满内容区 |
| 音频播放器 | `reelludic-audio-player` | 独立标签页或侧边栏；侧边栏在播时**就地切歌** |
| TXT 阅读器 | `reelludic-txt-reader` | 编码嗅探（BOM / UTF-8 / GB18030） |
| EPUB 阅读器 | `reelludic-epub-reader` | |
| PDF 阅读器 | `reelludic-pdf-reader` | |
| 漫画阅读器 | `reelludic-comic-reader` | 单页制；图片文件夹 / CBZ·ZIP·CBT·TAR |

## 6. 扩展点（已全部落地）

- **书籍库 v0.1 已交付**：摘抄（pure/excerpt.ts 合并写入策略 C + add-excerpt 命令 + ExcerptModal）、阅读进度双轨（页码/百分比）、noteGenerator 合并写入不覆写摘抄区。
- **游戏库 v0.2 已交付**：`platform`/`developer`/`playtimeMinutes`/`playSessions` 游玩记录（GameSessionModal 弹窗录入 + 笔记「游玩记录」章节 + 总时长联动）。
- **音乐库（#127）已交付**：`album`/`audioPath` 字段（schema 只增不改）；笔记模板 `lrc` 代码块（`source [[歌曲.mp3]]`，LyricFlux 原生支持 wiki 链接；目录解耦——LRC 笔记文件夹指向媒体库目录即播放）；状态文案 想听/在听/已听/存档；统计页签四库分区 + 年度总结四库。
- **1.1.0 期已交付**：海报墙密度（四档）+ 视图级题材筛选 + 封面评分角标、统计页三层重构、设置页顶栏 Tab（四平级 Tab）、媒体库目录搜索式选择、阅读器三件（顶栏章标题 / 六档阅读主题 / 标注）、PDF 阅读器 + 书签、视频播放器（自绘控件 / 倍速 / 音量浮层）、LRC 歌词四路源与内置音频播放器。
- **1.2.0 期已交付**（2026-10-04 定级，见 `RELEASE-1.2.0.md`）：音乐下载（网易云 / QQ / 酷狗 / 酷我 + B站 音频流，走 `yt-dlp`）、书籍下载（🔴 **书源由用户自备，插件不内置任何内容源**；多源并行搜书 → 章节范围 → 抓成 TXT/EPUB → 自动写回 `bookFile`；并发 50、断点续传、取消真取消）、系列合集（同名 ≥2 条自动折叠 + 系列视图 + 封面挑选弹窗）、漫画子分类加回 + 漫画阅读器、书籍阅读时长（`readMinutes`）、手工条目 AI 预填字段、封面网络搜索。
- **1.3.0 期（2026-10-11 定级为 minor；原 1.2.1 期**从未发布**，已整体改定 1.3.0）**：微信读书接入（Cookie 授权 / 测试连接 / 书架同步 / 书籍并排元数据源 / 搜索回填）、内置阅读器本地漫画（图片文件夹 / 压缩包 / EPUB 图册）、播放器时间戳·截图侧边栏抽屉、导航布局（顶部胶囊 / 文字菜单 / 合并视图）与「时间线」视图、全库失效链接检测（三态 ok/dead/unknown）、海报墙阅读进度与数字并排、基本设置页改回核心原生分组（`.setting-group` / `.setting-items`）、库概览、编辑浮层失焦自动保存、「电视剧」全局更名「剧集」。
- **1.4.0 期（2026-10-16 用户点名定级）**：EPUB 文字阅读器正文资源加载（🔴 **新纯模块 `src/pure/epubResource.ts`** —— 把章节里的包内相对引用重写成 `blob:` URL；真因是 `iframe.srcdoc` **没有基准 URL**，`image/p001.jpg` 会被解析到应用根目录 ⇒ 全 404 且每张图一次注定失败的请求。宿主复用**既有** `main.unpackEpub` 的 `loadBinary`（此前只有 EPUB 漫画链在用），经 `EpubReaderOptions.loadEpubResource` 注入；整章并行预取 + blob URL 缓存 + `destroy` 逐个 revoke + 渲染 token 作废迟到的并发渲染）、EPUB 首屏提速（目录字数由「开局对全书每章同步算一遍」改为 `IntersectionObserver` 惰性补算，实测 500 章省 ~95% 同步时间；计数口径未变）、Steam 凭据行两处 UI 修正（副标题机制整体删除、提示并入 `steam.hint` 末尾；`resultEl` 移到两个按钮之后，间距 16px → 8px）。
- **新增字段不破坏现有 schema**（只增不改），旧版本插件读新数据时忽略未知字段。
- 性能缓存：`excerptCount` 摘抄计数落库（addExcerpt 维护 + 老数据惰性迁移），海报墙/列表封面 lazy + async 解码。
