# 输入框占位符全清单 + 多标签分隔符口径

> 用户需求 m00002 ⑤：「列出所有输入框占位符并讲清多标签分隔符」。
> 盘点范围：`src/**/*.{ts,svelte}` 全部 `placeholder` 出现点，2026-11-18 实测 **159 处 / 126 种文案**。
> 真源：`src/pure/formFields.ts`。表格视图与编辑表单都从这里取口径（#735 已收敛）。

## 一、一眼结论：分隔符只有两套口径

| 口径 | 认什么 | 用在哪些字段 | 为什么不统一 |
| --- | --- | --- | --- |
| **斜杠档** `/[\/、,，]/` | 半角斜杠 `/`、顿号 `、`、中英文逗号 | `genres` 题材、`cast` 主演、`director` 导演/编剧、`aliases` 又名 | 用户习惯用 `科幻 / 冒险` 这种写法，顿号与逗号是顺手打出来的，宽容接受不会产生歧义 |
| **逗号档** `/,，/` | 只有中英文逗号 | `tags` 标签（以及由它派生的批量标签、视图标签、合集追加标签） | 标签常含斜杠（`动画/漫画` 是一个标签），认斜杠会把一个标签劈成两个 |

**一句话记法**：**标签只认逗号，其它多值字段斜杠顿号逗号都认。** 单值字段（如 `platform` 平台、`comic-author` 原作）**只填一个** —— 占位符里绝不出现分隔符示例，免得用户以为能填多个。

## 二、本次修掉的真 bug（#735）

同一个字段，在两个入口填同样的字，结果不同：

| 入口 | 改前 | 改后 |
| --- | --- | --- |
| 编辑表单（`EntryForm.svelte`） | `科幻 / 冒险` → 存成 **两条** | 不变（本来就是对的） |
| 表格格子（`tableCell.ts` + `MediaList.svelte`） | `科幻 / 冒险` → 静默存成 **一条**名叫「科幻 / 冒险」的题材，提示还写着「用逗号分隔」 | 与表单一致 → **两条** |

根因是「多值怎么拆」这个规则被抄了三份，表格那份抄漏了斜杠和顿号。现在收敛为：

```ts
// src/pure/formFields.ts —— 全仓唯一一份
export const FIELD_SPLIT_PATTERN: Record<FieldSeparator, RegExp> = {
    slash: /[\/、,，]/,
    comma: /[,，]/,
};
export function splitFieldValues(text: string, sep: FieldSeparator = 'slash'): string[]
```

`src/pure/tableCell.ts` 的 `splitListText(t, key)` 改为读 `formFieldSpec(key)?.sep ?? 'slash'`；
`MediaList.svelte` 的编辑框提示改为直接调 `placeholderOf(key)`，⛔ 不再手写文案。

> `src/views/components/EntryForm.svelte` 的提交侧仍是**内联正则**，这是刻意的：
> `tests/formPlaceholders.test.ts` 会从源码里剥出 `/[...]/` 字面量与规格表的 `sep` 逐字比对，
> 换成函数调用那张对照表就失效了。**验证方式不同，不是漏改。**

## 三、编辑表单的 28 个字段（`FORM_FIELD_SPECS`）

> 🔴 **本表的「输入框里显示」一列是 `EntryForm.svelte` 里的真实字面量**，逐条核过源码，
> 不是 `placeholderOf(key)` 的生成式。两者只对一部分字段重合 —— 见下表「来源」列。
> `placeholderOf` 的生成规则（供写新字段参考）：整句覆盖 > 多值 `多个用X分隔，如 例子` > 单值 `如 例子（单个）`。

| 字段 key | 标签 | 单/多 | 分隔 | 输入框里显示（真实） | 来源 |
| --- | --- | --- | --- | --- | --- |
| `title` | 标题 | 单值 | — | `作品名称` | 手写（`:4737`） |
| `originalTitle` | 原名 | 单值 | — | **无输入框** | 只有规格表 + 字段排序注册；靠搜索/豆瓣回填写入 |
| `sourceName` | 来源 | 单值 | — | `来源名` | 手写（`:4856`） |
| `communityScore` | 大众评分 | 单值 | — | `如 7` | 手写（`:4858`） |
| `ratingCount` | 评价人数 | 单值 | — | `如 500` | 手写（`:4867`） |
| `genres` | 题材 | 多值 | 斜杠 / 顿号 / 逗号 | `多个用斜杠分隔，如 科幻 / 冒险 / 灾难` | `placeholderOf('genres')`（五类共用 `:4886/4894/4896/4898/4902`） |
| `year` | 年份 | 单值 | — | `如 2024` | 手写，五个分支各一份（`:4787/4792/4794/4796/4800`） |
| `director` | 导演 / 编剧 | 多值 | 斜杠 / 顿号 / 逗号 | `多个用斜杠分隔，如 郭帆 / 龚格尔` | `placeholderOf('director')`（textarea `:4967`） |
| `cast` | 主演 | 多值 | 斜杠 / 顿号 / 逗号 | `多个用斜杠分隔，如 吴京 / 刘德华 / 李雪健` | `placeholderOf('cast')`（textarea `:4982`） |
| `author` | 作者 | 单值 | — | **未直接渲染** | 通用 key 只做规格表兜底；表单按子类用下面四个 |
| `book-author` | 作者（出版书） | 单值 | — | `如 刘慈欣（单个）` | `placeholderOf('book-author')`（`:4944`） |
| `novel-author` | 作者（网文） | 单值 | — | `如 唐家三少（单个）` | `placeholderOf('novel-author')`（`:4918`） |
| `comic-author` | 原作（漫画） | 单值 | — | `如 原作名（单个）` | `placeholderOf('comic-author')`（`:4929`） |
| `comic-artist` | 画师 | 单值 | — | `如 作画者名（单个）` | `placeholderOf('comic-artist')`（`:4930`） |
| `publisher` | 出版社 | 单值 | — | `如 重庆出版社（单个）` | `placeholderOf('publisher')`（漫画 `:4928`、出版书 `:4943`） |
| `isbn` | ISBN | 单值 | — | `如 9787536692930（单个）` | `placeholderOf('isbn')`（`:5019`） |
| `pageCount` | 页数 / 章数 / 话数 | 单值 | — | 出版书 `如 320（单个）`；网文 `如 1200 章`；漫画 `如 139` | 前两者分别是 `placeholderOf('pageCount')`（`:5022`）与手写（`:4921`）；漫画手写（`:4936`） |
| `platform` | 平台 | 单值 | — | `如 PC（单个）` | `placeholderOf('platform')`（`:4992`） |
| `developer` | 开发商 | 单值 | — | `如 Mojang（单个）` | `placeholderOf('developer')`（`:4993`） |
| `music-author` | 歌手 / 艺术家 | 单值 | — | `如 周杰伦（单个）` | `placeholderOf('music-author')`（`:4951`） |
| `album` | 专辑 | 单值 | — | `如 七里香（单个）` | `placeholderOf('album')`（`:4952`） |
| `series` | 系列 | 单值 | — | `同一系列的名称（留空不成组）` | `placeholderOf('series')`（`:5053`），整句覆盖 |
| `series-index` | 系列序号 | 单值 | — | `可留空，填整数（第几部/季）` | `placeholderOf('series-index')`（`:5057`），整句覆盖 |
| `collection` | 合集 | 单值 | — | `如 马孔多宇宙（单个）` | `placeholderOf('collection')`（`:5077`） |
| `tags` | 标签 | 多值 | **逗号** | `多个用逗号分隔，如 工作, 日常` | `placeholderOf('tags')`（`:4910`） |
| `aliases` | 又名 | 多值 | 斜杠 / 顿号 / 逗号 | **无输入框** | 只有规格表 + 字段排序注册；靠搜索/豆瓣回填写入（表格视图里才有这一格） |
| `summary` | 简介 | 单值 | — | 图书 `填写图书内容简介…`；其它 `填写作品剧情简介…` | 手写三元（`:5096`） |
| `notes` | 个人评语 | 单值 | — | `在这里用一句话概括你的核心感受或者情绪记录...` | 手写（`:6479`） |

`series` 与 `series-index` 的两条整句覆盖是**被产物断言逐字钉着的**（`assert-symbols.cjs:10245` / `:10755`），改文案会红。

⚠️ 标着「无输入框 / 未直接渲染」的字段（`originalTitle`、`aliases`、通用 `author`，以及不在规格表里但同待遇的 `country` / `language` / `durationMin`）是**有意如此**：
`src/pure/aiPrefill.ts:26-31` 的注释逐字记着理由 ——「只收**表单里真有可见输入框**的字段……预填它们 = 预览里看得见、字段区里找不到、下次编辑也改不了，是纯粹的暗写」。
所以 AI 预填也不会写它们，只能靠搜索回填带进来。

## 四、表格视图单元格（`MediaList.svelte` 的 `cellEditPlaceholder`）

| 列 | 编辑框提示 | 来源 |
| --- | --- | --- |
| 状态 | `想看 / 在看 / 已看 / 搁置` | 组件内写死（这列是枚举，不是自由文本） |
| 评分 | `0~5，或 0~10（9/10）` | 组件内写死 |
| 年份 | `4 位数字` | 组件内写死 |
| 日期类 | `2026-10-13` | 组件内写死（给格式样例） |
| 列表类（题材/主演/编剧/又名） | 由 `placeholderOf(key)` 生成 | **规格表真源**（#735 收口） |
| 其余文本列 | 空 | 不给废话提示 |

## 五、表格之外的输入框（按用途归组）

### 5.1 快捷关联弹窗（`src/modals/QuickAssociateModal.ts`）

| 提示 | 用途 |
| --- | --- |
| `https://…` / `在线阅读链接（https://…）` / `商店页 / 官网（https://…）` / `在线页 / 试听链接（https://…）` | 网络链接 |
| `库内路径，或系统绝对路径（.lnk）` | 本地文件/快捷方式 |
| `库内路径，或系统绝对路径（mp3/flac/m4a…）` | 音频 |
| `库内路径，或系统绝对路径（.swf）` | Flash 游戏 |
| `库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）` | 电子书 |
| `图片文件夹路径，或 .cbz / .cbt / .zip / .tar 文件` | 漫画 |
| `同目录 .srt / .vtt / .ass（可留空）` | 字幕 |
| `H5 / Unity 游戏的播放页（https://…）` | H5 游戏 |
| `检索词（作品标题 + 集标题，缺则补第N集）` | 搜索词 |
| `如：开始` | 时间点标签 |
| `库内路径，或系统绝对路径` | 通用文件 |

### 5.2 阅读器（`ReaderPanelBase` / `Txt` / `Epub` / `Pdf`）

| 提示 | 出处 |
| --- | --- |
| `输入要搜索的内容` | `EpubReaderModal.ts:1794`、`TxtReaderModal.ts:1408` |
| `针对这段内容提问…` | `EpubReaderModal.ts:1809`、`TxtReaderModal.ts:1423` |
| `写下此刻的想法…（可留空）` | `PdfReaderModal.ts:2109`、`ReaderPanelBase.ts:1020` |
| `粘贴摘抄的原文片段…` / `如 128` / `写下此刻的想法…` / `搜索书名 / 作者…` | `ExcerptModal.ts:43/50/53/67` |

### 5.3 设置页（`src/Settings.ts`）

| 提示 | 用途 |
| --- | --- |
| `${p.site} 的 Cookie` / `粘贴 bilibili.com 的 Cookie（可留空）` | 站点登录态 |
| `SID=…; HSID=…; SSID=…（可留空）` | YouTube Cookie |
| `17 位 SteamID（形如 76561198…）` | Steam |
| `TMDB v4 access_token（eyJ 开头长串，账号同步用）` | TMDB |
| `yt-dlp.exe 的完整路径（留空 = 用系统 PATH）` | 外部工具 |
| `ffmpeg.exe 的完整路径（留空 = 自动找）` | 外部工具 |
| `whisper-cli.exe` / `ggml-base.bin` / `sherpa-onnx-offline.exe` / `model.int8.onnx` / `tokens.txt` 的完整路径 | 语音识别 |
| `…\.venv\Scripts\python.exe` / `cli_bridge.py 的完整路径` | Python 桥 |
| `https://api.example.com/v1` | 自定义端点 |
| `${customSlotName(slot, get(f.name))}的 API Key` | API Key |
| `填该端点支持的模型名` / `填模型名` | 模型名 |
| `多个标签用逗号分隔，如 工作, 项目A` | **视图标签（逗号档）** |
| `http://127.0.0.1:7897` | 代理地址 |

### 5.4 系列属性（`SeriesProps.svelte`）

| 提示 | 说明 |
| --- | --- |
| `这个系列叫什么` | 合集名 |
| `例如：熊出没（留空 = 清空）` | 归属合集 |
| `多个用逗号分隔，例如：工作, 日常` | 批量追加标签 —— **逗号档** |

### 5.5 其它组件

| 提示 | 出处 |
| --- | --- |
| `搜索条目名 / 文件名 / 系列名` | `AssetManagerModal.ts:160` |
| `搜索合集或条目` | `CollectionBoard.svelte:405` |
| `输入标题…` / `作品名称` / `来源名` | `EntryForm.svelte` |
| `输入歌名 / 歌手，如：作品名 作者名` | `MusicDownload.svelte:647` |
| `搜索词（默认「标题 + 类型词」）` / `搜索词（默认「标题 + 作者」）` | `PosterSearch.svelte:175` |
| `搜库内条目：标题 / 原名 / 作者；留空列出全部` | `RelatedChips.svelte:298` |
| `批量标签（逗号分隔）` | `MediaList.svelte:3152` —— **逗号档** |
| `就这一集的字幕提问…` / `一句话记下这一集（可留空）` | `EpisodePageView.ts` |
| `补一句（可留空）` | `StampNotePopover.ts:105` |
| `输入过滤…` / `输入关键字过滤文件夹…` | `VaultFileSuggest.ts` / `VaultFolderSuggest.ts` |
| `写一句短评…` / `写下攻略正文（支持 [[双链]]）…` | `EntryTextModal.ts` |
| `搜索模型…` / `留空 = 用默认位置` | `AiPickerModal.ts` / `AsrInstallModal.ts` |
| `如 595130，留空自动获取` | `ImportBangumiModal.ts:39` |

### 5.6 多行文本的「格式样例」（`EntryForm.svelte`）

这几条不是分隔符问题，但同属「输入格式引导」，一并列出：

- 简介：`填写图书内容简介…`（`type === 'book'`）/ `填写作品剧情简介…`（其它五类）
- 目录：`填写目录，每行一项…`（**换行分隔**，不是逗号也不是斜杠）
- 总结摘要：`一句话总结：\n1. 要点1\n2. 要点2\n3. 要点3`
- 个人评语：`在这里用一句话概括你的核心感受或者情绪记录...`
- 歌词：`逐行粘贴 LRC 歌词…`，并说明高光句在时间标签后加 `[Gold]`
- 作者介绍、攻略正文：多行自由文本

## 六、AI 预填提示（`src/pure/aiPrefill.ts`）

AI 预填面板给每个字段的 `hint` 全部写「多个用 / 分隔」，与斜杠档一致；`genres` 另有「8种题材 / 风格」这类枚举提示。**这是展示层文案，不参与切分** —— 切分永远走 `formFields`。

## 七、守护测试

| 测试 | 守什么 |
| --- | --- |
| `tests/formPlaceholders.test.ts`（14 条） | 规格表 ↔ 提交侧 `split(/[...]/)` 字面量逐字对齐；`genres`/`cast`/`aliases` 必须是斜杠档，`tags` 必须是逗号档 |
| `tests/tableCell.test.ts`（22 条，本轮 +4） | 表格格子认四种分隔；四个 list 列同口径；反向守卫 `tableCell.ts` 不许再出现写死的 `/[,，]/`；提示与解析同源 |

## 八、改动清单（本轮）

| 文件 | 改动 |
| --- | --- |
| `src/pure/formFields.ts` | 新增 `FIELD_SPLIT_PATTERN`、`splitFieldValues(text, sep)` |
| `src/pure/tableCell.ts` | `splitListText(t, key)` 改读规格表 `sep`；新增 import |
| `src/views/components/MediaList.svelte` | 删掉写死的「用逗号分隔」，改调 `placeholderOf(key)` |
| `tests/tableCell.test.ts` | 新增 #735 四条守护 |
| `docs/audits/2026-11-18-placeholder-audit.md` | 本文档 |
