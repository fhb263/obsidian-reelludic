# ReelLudic v1.0.0 功能概览

> 影视 / 剧集 / 动画 / 书籍 / 游戏 / 音乐六类收藏管理：自动抓取元数据、可双链的详情笔记、追更排期、内置简易播放器与阅读器。



---

## 收藏与管理

- 六类型统一管理（独立页签与目录）
- 三视图书架：海报墙 / 列表 / 瀑布流
- 筛选、排序、全库搜索
- 批量状态 / 评分 / 标签
- 右键菜单：打开笔记 / 编辑 / 观看 / 摘抄 / 游玩记录 / 删除

## 状态与进度

- 想看 / 在看 / 已看 / 存档（文案随类型：想读 / 想玩 / 想听）
- 剧集 / 动画季集进度（表单可手填，列表 / 月历 / 追更同步）
- 书籍页 / 章 / 百分比进度 + 本地文件自动解析
- 游戏游玩记录（日期 + 时长 + 心得）与总时长
- 计划观看 / 最近观看日期与活跃度

## 元数据搜索

- 11 数据源：豆瓣 / TMDB / Bangumi + Open Library / Google Books / Steam / MusicBrainz / iTunes / OMDb / AniList / IGDB
- 每类型源链自选，多源合并去重、详情预取、反爬适配
- 类型化字段回填、来源直达、一键重新拉取

## 笔记与双链

- 详情笔记自动生成，笔记 ↔ 表单双向同步
- 摘抄区块（`^id` 双链引用）与摘抄弹窗连续录入
- 阅读高亮写回笔记，评语支持双链
- 网页链接识别平台 + 打开 / 复制 / 本地文件关联
- LyricFlux LRC 音乐联动

## 追更与排期

- 追番表：网站更新检测、开播季度列、活跃度排序
- 从 Bangumi 收藏批量导入
- 排期表（月历 / 周历）：拖拽排期、到期横幅一键开始观看
- 当天计划弹窗：编辑 / 打开笔记 / 连续清除排期

## 播放与阅读

- 本地视频内嵌播放（多集连播；mkv 等自动转系统播放器）
- TXT / EPUB / PDF 阅读器：书签、摘抄、页内高亮、划词翻译（AI 双源）、翻页 / 连续模式、标注模式锁、进度记忆

## 统计与报告

- 统计页：KPI 行、月度看完趋势（四线）、今年动态、四库分区 + Top
- 年度总结一键生成（Markdown 报告）并打开
- 往年报告入口随时回看

## 数据管理

- 封面本地化下载、孤儿封面清理、存量迁移
- catalog 导出 / 合并去重恢复
- 中文目录体系：笔记 / 封面 / 备份 / 报告

## 工程

- 纯逻辑模块 808 单测全绿，Schema 只增不改（旧数据无损）
- 全部视觉走 Obsidian 主题变量，亮 / 暗自适应

---

## 参考与致谢

- [Bangumi-Bridge-Obsidian](https://github.com/Yasikap/Bangumi-Bridge-Obsidian) — 追番表蓝本
- [obsidian-custom-icons](https://github.com/Raven-Pensieve/obsidian-custom-icons) — 纯色图标思路
- [Readest](https://github.com/readest/readest) — 阅读器界面参考
- [obsidian-media-db](https://github.com/czottmann/obsidian-media-db) — 元数据抓取参考
- [metatube-server](https://github.com/metatube-community/metatube-server) — 媒体刮削模式
- [pdfjs-dist](https://github.com/mozilla/pdfjs-dist) — PDF 渲染内核
- [Lucide](https://github.com/lucide-icons/lucide) — 全局图标集
- [Notion](https://www.notion.so) — 仪表盘布局启发
- [Obsidian 文档](https://docs.obsidian.md) — 主题变量体系
- [Keep a Changelog](https://keepachangelog.com) — 变更日志规范
- [Semantic Versioning](https://semver.org) — 版本管理规范
