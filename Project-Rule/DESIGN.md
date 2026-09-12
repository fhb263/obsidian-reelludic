# DESIGN.md — ReelLudic 技术设计

> 版本：v1.0.0（首个正式版，2026-09-05）| 最后更新：2026-09-05 | 状态：已实现（本文件为当前实现的实现依据，随代码演进）

---

## 1. 架构分层

```
┌─ 展示层 ─────────────────────────────────────────────┐
│  HomeView.ts/.svelte（统一视图 reelludic-home，页签容器）│
│    ├─ MediaList（书架：海报墙/列表/瀑布流 + 筛选排序）   │
│    ├─ TrackingBoard（追番表：更新检测 + 一键已更新）     │
│    ├─ CalendarBoard（排期表：月历/周历 + 拖拽排期 + 到期横幅 + 日期点击弹详情）│
│    └─ StatsBoard（统计 1.0：页眉动作(往年报告) + KPI 行 + 月度趋势×今年动态 + 四库分区 + 快捷行）│
│  Modals：EntryModal（添加/编辑）+ ExcerptModal/GameSessionModal│
│          + CalendarDayModal/ConfirmModal/NoteConflictModal│
│          + PosterMigrateModal/PosterCleanupModal/LinkPickerModal│
│          + EpisodePickerModal（集数选择）/TagEditor 系列（LyricFlux 侧）│
└──────────────────────────┬───────────────────────────┘
┌─ 功能层 ─────────────────┼───────────────────────────┐
│  EntryService（增删改查编排、状态流转、笔记生成/双写冲突）│
│  services/douban.ts（全类型主力：反爬 + Cookie 失效提示）│
│  services/tmdb.ts（影视）/ bangumi.ts（动画，详情补全）  │
│  services/nodeHttp.ts（Node 传输层：重定向/Cookie/PoW）│
└──────────────────────────┬───────────────────────────┘
┌─ 数据层 ─────────────────┼───────────────────────────┐
│  catalog.ts（catalog.json 读写 + normalizeEntry 归一） │
│  noteGenerator.ts（.md 详情笔记生成，纯逻辑）           │
│  types.ts（MediaEntry + entryType 六类型枚举）           │
│  pure/（status/labels/rating/excerpt/tracking/stats/report/…）│
└──────────────────────────┬───────────────────────────┘
┌─ 基础设施 ───────────────┼───────────────────────────┐
│  Vault API（媒体库/ 中文目录读写，ensureParentFolder）  │
│  Settings（10 源注册表凭据/源链/翻译 Key/库目录/播放阅读开关）│
│  main.ts（命令注册 + 视图注册 + 事件中枢）               │
└──────────────────────────────────────────────────────┘
```

依赖方向自上而下；纯逻辑模块（data/pure）不依赖 obsidian API，可直接单测。

## 2. 存储设计（vault 内 `媒体库/` 目录，v0.4 中文化）

```
媒体库/
├── catalog.json        # 目录元数据（唯一事实源）
├── 笔记/               # 每条目一个 .md 详情笔记（原 entries/）
├── 封面/               # 本地封面图片（原 covers/，{标题}.jpg 命名）
├── 备份/               # 导出备份（原 backups/）
└── 报告/               # 年度总结等（原 reports/）
```

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
      "source": "bangumi", "sourceUrl": "https://bgm.tv/subject/...",
      "communityScore": 8.5, "ratingCount": 517685,
      "summary": "剧情简介",
      "createdAt": "2026-08-25T18:00:00.000Z",
      "updatedAt": "2026-08-25T18:00:00.000Z"
    }
  ]
}
```

**Schema 红线**：字段只能新增、不能删除/改类型（AGENTS.md 强制），保证已存数据永不损坏。新增字段必须同步 `normalizeEntry` + catalog.test 回归（summary 曾遗漏导致保存即丢）。

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

## 简介

（剧情简介）

## 个人评语

（在这里写下你的感想，支持 [[双链]]）

## 观看·相关链接
- [B站](https://www.bilibili.com/bangumi/...)
```

frontmatter 与 catalog.json 双向冗余：catalog 是运行事实源，frontmatter/正文让用户可读可改（打开表单时经 noteEditable 回填覆盖 catalog 值）；保存时经 noteFingerprint 检测外部修改弹二选一。

## 3. 核心枚举（pure/）

```ts
// 状态流转：想看 → 在看 ⇄ 已看；任意态 ↔ 存档（弃剧已移除，存量 dropped 迁移 archived）
type MediaStatus = 'want' | 'watching' | 'watched' | 'archived';
// 条目类型（六态平铺：影视动画聚合浏览，书籍/游戏/音乐独立）
type EntryType = 'movie' | 'tv' | 'anime' | 'book' | 'game' | 'music';
// 评分 1~5，0 = 未评分
type Rating = 0 | 1 | 2 | 3 | 4 | 5;
```

## 4. 抓取流程（v0.4 起 Douban 全类型主力 + 反爬适配）

```
用户输入标题 → 按类型分流（并行 + 步骤化进度条）
  书/游戏/音乐 → Douban 单源（音乐 cat=1003，music.douban.com）
  影视      → TMDB + Douban 并行 → mergeBySource 同源去重 / sortByRelevance 相似度排序
  动画      → Bangumi + Douban 并行（前 3 条预补详情，选中时按需补全导演/评分）
  → 候选列表 → 用户选择（豆瓣封面下载到本地）→ 按命中源切换表单 UI（douban/tmdb/bangumi）
网络失败 / Cookie 失效 / 拦截页 → 明确提示，不阻塞手动添加
```

- **Douban**：全类型主力源。已适配反爬：Node 传输层（nodeHttp.ts：手动重定向 + Set-Cookie 续传 + 30s 超时 + GET 重试）+ 完整浏览器头 + dbcl2 登录态 Cookie + sha512 PoW 自动求解 + 拦截页三态检测 + 封面防盗链（Referer=douban.com 下载本地）。**Cookie 失效抛 DoubanCookieError 明确提示**（主源有结果不打扰）。音乐详情 JSON-LD：byArtist → author（歌手）、inAlbum/album → album。
- **TMDB**：官方 API v3（movie/tv），`language=zh-CN`；vote_count → ratingCount。
- **Bangumi**：/v0/search/subjects + /v0/subjects/{id}（评分/评价人数/制作公司）+ /v0/subjects/{id}/persons（导演/主演，type 兼容字符串）。
- **封面**：默认下载本地 `封面/{标题}.jpg`（sanitizePosterTitle 清洗 + 重名 -2/-3 防覆盖 + 幂等；未保存弹窗清理孤儿文件）。

## 5. 视图与命令注册（main.ts）

| 项 | 值 |
|---|---|
| 视图类型 ID | `reelludic-home`（统一视图，页签：计划表/书籍/影视/游戏/音乐/统计）、`reelludic-tracking`（历史遗留 ID，勿改） |
| 命令 | `open-media-library` / `add-media-entry` / `add-excerpt`（书籍摘抄）/ 年度总结等 |
| Ribbon | 书架视图 + 快速添加 |

## 6. 扩展点（已全部落地）

- **书籍库 v0.1 已交付**：摘抄（pure/excerpt.ts 合并写入策略 C + add-excerpt 命令 + ExcerptModal）、阅读进度双轨（页码/百分比）、noteGenerator 合并写入不覆写摘抄区。
- **游戏库 v0.2 已交付**：`platform`/`developer`/`playtimeMinutes`/`playSessions` 游玩记录（GameSessionModal 弹窗录入 + 笔记「游玩记录」章节 + 总时长联动）。
- **音乐库（#127）已交付**：`album`/`audioPath` 字段（schema 只增不改）；笔记模板 `lrc` 代码块（`source [[歌曲.mp3]]`，LyricFlux 原生支持 wiki 链接；目录解耦——LRC 笔记文件夹指向媒体库目录即播放）；状态文案 想听/在听/已听/存档；统计页签四库分区 + 年度总结四库。
- **新增字段不破坏现有 schema**（只增不改），旧版本插件读新数据时忽略未知字段。
- 性能缓存：`excerptCount` 摘抄计数落库（addExcerpt 维护 + 老数据惰性迁移），海报墙/列表封面 lazy + async 解码。
