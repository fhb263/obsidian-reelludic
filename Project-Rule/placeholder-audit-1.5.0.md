# 输入框占位符与分隔符口径全量清单（1.5.0）

> 审计对象：`C:\Users\kest\Desktop\obsidian-reelludic`（Obsidian 插件 ReelLudic 1.5.0）
> 审计方式：全仓 `grep` 检索 `placeholder` → 逐命中 `read` 上下文确认控件归属 → 反查提交侧 `split(...)`。
> 只读审计，未改动任何源文件。
>
> **统计口径**：以「真实承载输入框提示语的出现点」计，含生成器调用（`placeholderOf('x')`）与元数据定义行（`numPlaceholder:` 等）。
> 已排除：① 类型声明 `placeholder: string;`；② CSS `::placeholder` 选择器；③ `ComicReaderModal.ts` 的 `placeholderEl`（漫画**占位图**元素，非输入框）；④ `cardMeta.ts` / `seriesGroup.ts` 的 `PLACEHOLDER = '—'`（卡片空值占位符）；⑤ `noteImport.ts` 的 `isPlaceholder()`。
>
> **总计 160 处**：`EntryForm.svelte` 66 + `Settings.ts` 31 + `src/modals/` 51 + `src/views/` 12。

---

## 一、结论摘要

1. **多值字段现在是「双轨」口径，不是一套。** 表单里 `题材 / 主演 / 导演+编剧` 用**斜杠**（`EntryForm.svelte:4130` 的 `split(/[\/、,，]/)`），`标签` 用**逗号**（`EntryForm.svelte:4228` 的 `split(/[,，]/)`）—— 这两条由格式真源 `src/pure/formFields.ts:72`（`sep: 'slash'`）与 `:152`（`sep: 'comma'`）声明，提示语由 `placeholderOf()` 按同一份规格**生成**（`formFields.ts:189-199`），所以在「表单内部」提示语与实现是一致的。

2. **但换一个入口就不一致了：同一字段在表格视图里只认逗号。** `src/pure/tableCell.ts:175-180` 的 `splitListText()` 用 `/[，,]/`，**不认斜杠**；而 `EntryForm.svelte:4130` 认斜杠。用户在表单里学会「科幻 / 冒险」，去列表里改同一个字段写成「科幻 / 冒险」，就会被存成一个题材名 `科幻 / 冒险`。这是**跨入口真 bug**（见第四章第 2 条）。

3. **标签（tags）在表单与列表之间也各认各的**：表单 `split(/[,，]/)`（`EntryForm.svelte:4228`），列表侧 `noteCard.ts:426-431` 的 `splitList()` 用 `/[、,，]/`（**多认一个顿号**）。同一个「标签」字段，两个入口接受字符集不同。

4. **`hintOf()` 写了 28 条注意事项，界面上一条都没显示。** `src/pure/formFields.ts:205` 定义，全仓 `src/` 内**零调用点**（`grep hintOf` 仅命中定义自身与 `tests/formPlaceholders.test.ts`）。于是 `formFields.ts:155` 的「⚠️ 只认逗号（斜杠会被当成标签名的一部分）」、`:116` 的「⛔ 只能填一个平台」、`:103` 的「⛔ 只能填一个（斜杠会被当成名字的一部分）」这些**最关键的格式约束，用户一个字都看不到**。

5. **`FORM_FIELD_SPECS` 有 2 条规格是「死规格」**：`aliases`（`formFields.ts:157`，`sep: 'slash'`）与 `originalTitle`（`:62`）—— 编辑表单里**根本没有对应的输入框**（`EntryForm.svelte` 全文无 `bind:value={aliases}`、无原名框）。规格表承诺了一个界面上不存在的「多个用斜杠分隔，如 流浪地球2 / 小破球2」，谁也没机会看到它。

6. **单值字段的「（单个）」标注只覆盖了一部分。** 66 处里 **23 处**走 `placeholderOf`，其中 **13 处**带「（单个）」；**43 处**手写在模板里（`title`、`year`、`sourceName`、`communityScore`、`ratingCount`、各类数字框、各类 URL/路径框），**一律没有「（单个）」**。同一张表单里「如 重庆出版社（单个）」与「如 2024」并排出现，风格是割裂的。

7. **`formFields.ts` 里的 `example` 与模板手写文案已经不同源。** 例：`spec.notes.example` 是「一句话概括你的核心感受」（`formFields.ts:161`），模板写的是「在这里用一句话概括你的核心感受或者情绪记录...」（`EntryForm.svelte:6502`）；`spec.summary.example` 是「填写作品剧情简介…」（`:160`），模板按类型分叉成两句（`EntryForm.svelte:5130`）。规格表已不能作为「表单长什么样」的文字版（`formFields.ts:56-57` 的自我要求已失效）。

8. **提示语风格在搜索类输入框上至少四种写法并存**：「搜索标题…」（`MediaList.svelte:789`）、「输入标题…」（`EntryForm.svelte:4466`）、「检索词（作品标题 + 集标题…）」（`EntryForm.svelte:6026`）、「输入要搜索的内容」（`EpubReaderModal.ts:1794`，无省略号）。

**不一致条数：8 条**（第四章逐条展开，其中第 2、3 条是会**静默吞掉用户输入**的实际缺陷）。

---

## 二、编辑条目表单逐字段清单

文件：`src/views/components/EntryForm.svelte`（7245 行，Svelte 4）。
**66 处** `placeholder=`：23 处为 `placeholder={placeholderOf('key')}`（生成），43 处为模板手写字符串。

> 标注「（生成）」的原文**不是**模板里的字面量，而是 `placeholderOf()` 运行时产物；生成规则见 `formFields.ts:189-199`：多值 → `` `多个用${word}分隔，如 ${example}` ``，单值 → `` `如 ${example}（单个）` ``。
> 「单/多值」列中的「单值」指该字段在数据模型里是标量（不是数组），不代表提示语已声明。

| # | 字段 / 控件 | 控件类型 | placeholder 原文 | 单/多值 | 实际接受的分隔符 | 与提示语一致？ |
|---|---|---|---|---|---|---|
| 1 | `:4466` 面板顶部搜索（选中作品） | input text | `输入标题…` | 搜索词（单值） | 不拆分（模糊匹配） | 一致（未承诺格式） |
| 2 | `:4718` 封面海报 URL（`posterUrlInput`） | input text | `https://…` | 单值 URL | 不拆分 | 一致 |
| 3 | `:4752` 标题（`title`） | input text | `作品名称` | 单值 | 不拆分（`input.title`） | 一致，但**缺「（单个）」**；spec 例是「流浪地球2」（`formFields.ts:61`），与此文案不同源 |
| 4 | `:4821` 上映年 / 首播年 / 发行年（`year`，影视+游戏共用） | input text | `如 2024` | 单值数字 | `Number(year)`（`:4126`） | 一致，但**缺「（单个）」**；spec 例是「2023」 |
| 5 | `:4826` 上架年（`novel-year`） | input text | `如 2024` | 单值数字 | 同上 | 同上 |
| 6 | `:4828` 出版年（`comic-year`） | input text | `如 2024` | 单值数字 | 同上 | 同上 |
| 7 | `:4830` 出版年（`book-year`） | input text | `如 2024` | 单值数字 | 同上 | 同上 |
| 8 | `:4834` 发行年（`music-year`） | input text | `如 2024` | 单值数字 | 同上 | 同上 |
| 9 | `:4890` 来源（`sourceName`） | input text | `来源名` | 单值 | `parseSourceName()`（`:4278`） | **不一致**：spec 是「如 豆瓣（单个）」（`formFields.ts:63`），模板自写「来源名」，缺标注 |
| 10 | `:4892` 大众评分（`communityScore`） | input text | `如 7` | 单值 | `splitScoreCount()`（`:4240`）支持「7 \| 500」 | 提示**窄于**实际（能力未宣传，见 `:4898` 注释） |
| 11 | `:4901` 评价人数（`ratingCount`） | input text | `如 500` | 单值数字 | `ratingCountIssue()`（`:4251`） | 一致，但**缺「（单个）」** |
| 12 | `:4903` 平台链接（`sourceUrl`） | input text | `https://…` | 单值 URL | 不拆分 | 一致 |
| 13 | `:4920` 题材（`genres`，影视 / 游戏） | input text | `多个用斜杠分隔，如 科幻 / 冒险 / 灾难`（生成） | **多值** | `/[\/、,，]/`（`:4130`） | 提示**窄于**实际（顿号、逗号也收）；与表格侧冲突（第四章第 2 条） |
| 14 | `:4928` 题材（`novel-genres`） | input text | 同上（生成） | 多值 | 同上 | 同上 |
| 15 | `:4930` 题材（`comic-genres`） | input text | 同上（生成） | 多值 | 同上 | 同上 |
| 16 | `:4932` 题材（`book-genres`） | input text | 同上（生成） | 多值 | 同上 | 同上 |
| 17 | `:4936` 题材（`music-genres`） | input text | 同上（生成） | 多值 | 同上 | 同上 |
| 18 | `:4944` 标签（`tagsText`） | input text | `多个用逗号分隔，如 工作, 日常`（生成） | **多值** | `/[，,]/`（`:4228`） | **一致**（表单内）；与 `noteCard.ts:428` 的 `/[、,，]/` 不一致 |
| 19 | `:4952` 作者（`novel-author`） | input text | `如 唐家三少（单个）`（生成） | 单值 | 不拆分 | 一致 |
| 20 | `:4955` 总章数（novel，`pageCountVal`） | input number | `如 1200 章` | 单值数字 | `Number` | 一致，但**缺「（单个）」**；与 `:5056` 的「（单个）」风格不齐 |
| 21 | `:4962` 出版社（`comic-publisher`） | input text | `如 重庆出版社（单个）`（生成） | 单值 | `publisher.trim()`（`:4171/:4174`） | 一致 |
| 22 | `:4963` 原作（`comic-author`） | input text | `如 原作名（单个）`（生成） | 单值 | 不拆分（斜杠被当名字一部分） | 一致，但该约束只在 `note` 里（`formFields.ts:103`），**未显示** |
| 23 | `:4964` 画师（`comic-artist`） | input text | `如 作画者名（单个）`（生成） | 单值 | `artist.trim()`（`:4186`） | 一致 |
| 24 | `:4970` 总话数（comic，`pageCountVal`） | input number | `如 139` | 单值数字 | `Number` | 一致，但**缺「（单个）」** |
| 25 | `:4977` 出版社（`book-publisher`） | input text | `如 重庆出版社（单个）`（生成） | 单值 | trim | 一致 |
| 26 | `:4978` 作者（`book-author`） | input text | `如 刘慈欣（单个）`（生成） | 单值 | `author.trim()`（`:4157/:4204`） | 一致 |
| 27 | `:4985` 歌手 / 艺术家（`music-author`） | input text | `如 周杰伦（单个）`（生成） | 单值 | trim | 一致 |
| 28 | `:4986` 专辑（`album`） | input text | `如 七里香（单个）`（生成） | 单值 | `album.trim()`（`:4205`） | 一致 |
| 29 | `:5001` 导演 + 编剧（`directorWriters`，textarea） | textarea | `多个用斜杠分隔，如 郭帆 / 龚格尔`（生成） | **多值（两字段合一）** | `/[\/、,，]/`；`writers[0]`→导演，`writers.slice(1)`→编剧（`:4119`、`:4127-4128`） | **不一致**：提示语没说「第一个是导演、其余都是编剧」（该说明在 `formFields.ts:85` 的 note 里，不显示） |
| 30 | `:5016` 主演 / 主演（声优）（`cast`，textarea） | textarea | `多个用斜杠分隔，如 吴京 / 刘德华 / 李雪健`（生成） | **多值** | `/[\/、,，]/`（`:4129`） | 提示窄于实际；与表格侧冲突 |
| 31 | `:5021` 总集数（`totalEpisodes`） | input number | `如 12` | 单值数字 | `Number` + `resizeEpisodeFiles` | 一致，**缺「（单个）」** |
| 32 | `:5026` 平台（`platform`） | input text | `如 PC（单个）`（生成） | 单值 | `platform.trim()`（`:4192`），**不拆分** | 一致；「只能填一个」约束（`formFields.ts:116`）**未显示** |
| 33 | `:5027` 开发商（`developer`） | input text | `如 Mojang（单个）`（生成） | 单值 | trim | 一致 |
| 34 | `:5043` 总集数（另一分支，`totalEpisodes`） | input number | `如 12` | 单值数字 | 同上 | 一致，**缺「（单个）」** |
| 35 | `:5047` 当前集（`episode`） | input number | `如 5` | 单值数字 | `clampWatch()` | 一致，**缺「（单个）」** |
| 36 | `:5053` ISBN（`isbn`） | input text | `如 9787536692930（单个）`（生成） | 单值 | 不拆分 | 一致 |
| 37 | `:5056` 页数 / 章数 / 话数（`pageCount`） | input number | `如 320（单个）`（生成） | 单值数字 | `Number` | 一致 |
| 38 | `:5087` 系列（`series`） | input text | `同一系列的名称（留空不成组）`（生成，整句覆盖 `formFields.ts:134`） | 单值 | `series.trim()`（`:4218`） | 一致（语义已把「单个/可留空」说全；无「（单个）」字样） |
| 39 | `:5091` 系列序号（`series-index`） | input number | `可留空，填整数（第几部/季）`（生成，整句覆盖 `formFields.ts:145`） | 单值整数 | `parseSeriesIndexInput()`（`:4221`） | 一致（同上，无「（单个）」字样） |
| 40 | `:5111` 合集（`collection`） | input text | `如 马孔多宇宙（单个）`（生成） | 单值 | `collection.trim()`（`:4224`） | 一致 |
| 41 | `:5125` 阅读时长（`readHours`） | input number | `如 2.5` | 单值数字 | `Number` | 一致，**缺「（单个）」** |
| 42 | `:5130` 简介（`summary`，textarea） | textarea | `填写图书内容简介…` / `填写作品剧情简介…`（按 `type === 'book'` 分叉） | 长文本（单值） | 原样存 | 与 spec（`formFields.ts:160` 例为「填写作品剧情简介…」）**部分不同源** |
| 43 | `:5170` 歌词（`lrc`，textarea） | textarea | `逐行粘贴 LRC 歌词，或点右上角按钮在线获取` + 换行 + `[00:01.00]第一句歌词` | 长文本（多行） | 按行解析 | 一致 |
| 44 | `:5227` AI 总结（`aiText`，textarea） | textarea | `一句话总结：` + 三行 `1. 要点1 / 2. 要点2 / 3. 要点3` | 长文本 | 原样 | 一致 |
| 45 | `:5233` 游戏时长（`playtimeHours`） | input number | `如 12` | 单值数字 | `Number` | 一致，**缺「（单个）」** |
| 46 | `:5280` 游戏启动路径（`gameLaunchVal`） | input text | `库内路径，或系统绝对路径（.lnk）` | 单值路径 | `autoSaveGame('launch')` | 一致 |
| 47 | `:5295` 商店页 / 官网（`gameUrlVal`） | input text | `https://…（商店页 / 官网 / 攻略）` | 单值 URL | `autoSaveGame('url')` | 一致 |
| 48 | `:5311` SWF 路径（`gameSwfVal`） | input text | `本地 .swf 文件（.swf 结尾）` | 单值路径 | `autoSaveGame('swf')` | 一致 |
| 49 | `:5337` 内嵌播放页（`gameEmbedVal`） | input text | `H5 / Unity 游戏的播放页（https://…）` | 单值 URL | `autoSaveGame('embed')` | 一致 |
| 50 | `:5351` 作者介绍（`authorIntro`，textarea） | textarea | `填写作者介绍…` | 长文本 | 原样（`:4183`） | 一致 |
| 51 | `:5358` 目录（`toc`，textarea） | textarea | `填写目录，每行一项…` | **多值（换行分隔）** | 按换行 | 一致（唯一用换行分隔的列表字段） |
| 52 | `:5381` AI 总结（第二处，textarea） | textarea | 与 `:5227` 逐字相同 | 长文本 | 原样 | 同 44；**同一文案两处重复** |
| 53 | `:5409` 当前页（`readingPage`） | input number | `当前` | 单值数字 | `Number` | 与 `:5411` 不成对（一个写「当前」、一个写「总章节/总页数」），**缺「（单个）」** |
| 54 | `:5411` 总章节 / 总页数（`readingTotalPage`） | input number | `总章节` / `总页数`（按 `bookUnit`） | 单值数字 | `Number` | 一致，**缺「（单个）」** |
| 55 | `:5477` 音频路径（`audioPathVal`） | input text | `库内路径，或系统绝对路径（mp3/flac/m4a…）` | 单值路径 | `autoSaveAudio()` | 一致 |
| 56 | `:5505` 在线页 / 试听（`audioUrlVal`） | input text | `https://…（在线页 / 试听链接）` | 单值 URL | `autoSaveAudioUrl()` | 一致 |
| 57 | `:5514` 音频名（`audioNameVal`） | input text | `不含扩展名` | 单值 | `syncAudioName()` | 一致（未说「（单个）」，但已足够） |
| 58 | `:5540` 搜歌（`songUrlQuery`） | input text | `歌名（可补歌手，如 孤勇者 陈奕迅）` | 单值搜索词 | 空白分词 | 一致（「可补」= 空格，写法已示范） |
| 59 | `:5663-5665` 书籍文件（`bookFileVal`） | input text | comic：`文件夹路径（图片序列），或 .cbz / .cbt / .zip / .tar / .pdf / .epub 文件`；其余：`库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）` | 单值路径 | `autoSaveBook('path')` | 一致（此处的「 / 」是**文件类型枚举**，不是多值分隔符，不会误导） |
| 60 | `:5715` 在线阅读（`readUrl`） | input text | `在线阅读链接（http/https）` | 单值 URL | 提交时校验 | 一致 |
| 61 | `:5741` 搜书（`readUrlQuery`） | input text | `书名（可补作者，如 三体 刘慈欣）` | 单值搜索词 | 空白分词 | 一致 |
| 62 | `:5909` 集标题（`editTitle`） | input text | `如：开始` | 单值 | `autoSaveEp('title')` | 一致（**「如：」带全角冒号**，与全文其余「如 」空格写法不齐） |
| 63 | `:5959` 集网络地址（`editUrl`） | input text | `https://…` | 单值 URL | `autoSaveEp('url')` | 一致 |
| 64 | `:5990` 集本地路径（`editLocal`） | input text | `库内路径，或系统绝对路径` | 单值路径 | `autoSaveEp('local')` | 一致 |
| 65 | `:6026` B 站检索词（`epBiliQuery`） | input text | `检索词（作品标题 + 集标题，缺则补第N集）` | 单值搜索词 | 空白分词 | 一致 |
| 66 | `:6502` 个人评语（`notes`，textarea） | textarea | `在这里用一句话概括你的核心感受或者情绪记录...` | 长文本 | 原样 | 与 spec（`formFields.ts:161`「一句话概括你的核心感受」）**不同源**；末三点为半角 `...`（`:452` 注释要求勿改） |

**表单内计数**：多值字段 8 处（`genres` ×5、`tags` ×1、`director` ×1、`cast` ×1）；单值字段 58 处，其中带「（单个）」**13 处**、整句覆盖 2 处（`series` / `series-index`）、**手写无标注 43 处**。

**表单内不存在输入框的字段**（规格表有 spec，界面无控件）：
- `aliases`（又名）：`formFields.ts:157` 声明 `sep: 'slash'`，但 `EntryForm.svelte` 无任何 `bind:value={aliases}` 的 input —— `aliases` 只出现在 `:675`（初值 join `' / '`）、`:1785/:1819`（脏键集合）、`:4042`（回填）、`:4134`（提交拆分）。**只写不读**。
- `originalTitle`（原名）：`formFields.ts:62` 有 spec，模板无输入框 —— 仅在 `:662`（初值）、`:4123`（提交）、`:2107/:2181/:2228/:2248/:2301`（回填）出现。

---

## 三、设置页与弹窗清单

### 3.1 `src/Settings.ts`（31 处）

| # | 位置 | 控件 | placeholder 原文 | 单/多值 | 实际规则 | 一致？ |
|---|---|---|---|---|---|---|
| 1 | `:1946` | `createSecretField()` 通用密文框 | `opts.placeholder`（透传，实参见下） | 单值 | 不拆分 | 一致 |
| 2 | `:2128` | 音乐下载源 Cookie | `${p.site} 的 Cookie` | 单值 | 原样 | 一致 |
| 3 | `:2486` | yt-dlp 路径 | `yt-dlp.exe 的完整路径（留空 = 用系统 PATH）` | 单值路径 | 原样 | 一致 |
| 4 | `:2510` | ffmpeg 路径 | `ffmpeg.exe 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 5 | `:3488` | AI 模型名 | `填该端点支持的模型名` / `填模型名` | 单值 | 原样 | 一致 |
| 6 | `:3540` | 提示词 textarea | `opts.defaultText`（默认提示词作灰字） | 长文本 | `ta.value = opts.value?.trim() ?? ''`（`:3542`） | 一致（`placeholder` 与 `value` 分离，不会误当已填） |
| 7 | `:3668` | 自定义端点显示名 | `CUSTOM_SLOT_DEFAULT_NAME[slot]` | 单值 | 留空恢复默认 | 一致 |
| 8 | `:3692` | 自定义 base URL | `https://api.example.com/v1` | 单值 URL | 原样 | 一致 |
| 9 | `:3735` | 自定义端点 API Key | `${customSlotName(slot, get(f.name))}的 API Key` | 单值 | 原样 | 一致 |
| 10 | `:3910` | `renderQrAccountField()` 二维码账号框 | `opts.placeholder`（透传，实参 `:7849`） | 单值 | 原样 | 一致 |
| 11 | `:4051` | SteamID | `17 位 SteamID（形如 76561198…）` | 单值 | 原样 | 一致（`:4049` 注释记录用户裁定「改成 17 位」） |
| 12 | `:4383` | 凭据第 1 格 | `this.credentialPlaceholder(meta)` | 单值 | 原样 | 见下 |
| 13 | `:4392` | 凭据第 2 格 | `this.credentialPlaceholder(meta)` | 单值 | 原样 | 见下 |
| 14 | `:4961` | 本地词典 CSV | `ECDICT.csv 的完整路径（留空 = 不查词）` | 单值路径 | 原样 | 一致 |
| 15 | `:5402` | 自定义视图「按标签收录」 | `多个标签用逗号分隔，如 工作, 项目A` | **多值** | `tagsIn.value.split(/[,，]/)`（`:5406`） | **一致** |
| 16 | `:6095` | frontmatter 映射表「新属性名」 | `f.key`（把**现有键名**作灰字，`:6097` 说明空值=没配过） | 单值 | 原样 | 一致（此处灰字是「当前值提示」，语义特殊但自洽） |
| 17 | `:7257` | 海报列数 | `如 6` | 单值数字 | `min`/`max` 限制在 `:7254-7255` | 一致，但**未写取值范围**（提示弱于校验） |
| 18 | `:7682` | 本地目录 | `库内路径，或系统绝对路径` | 单值路径 | 原样 | 一致 |
| 19 | `:7849` | bilibili Cookie | `粘贴 bilibili.com 的 Cookie（可留空）` | 单值 | 原样 | 一致 |
| 20 | `:7899` | 代理地址 | `http://127.0.0.1:7897` | 单值 URL | 原样 | 一致 |
| 21 | `:7914` | YouTube Cookie | `SID=…; HSID=…; SSID=…（可留空）` | 单值 | 原样 | 一致 |
| 22 | `:8288` | `pathRow()` 通用路径框 | `opts.placeholder`（透传，实参 `:8545`–`:8653`） | 单值路径 | `setValue(saved \|\| detected)` | 一致 |
| 23 | `:8545` | ASR whisper 可执行 | `whisper-cli.exe 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 24 | `:8559` | ASR 模型 | `ggml-base.bin 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 25 | `:8596` | sherpa 可执行 | `sherpa-onnx-offline.exe 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 26 | `:8610` | sherpa 模型 | `model.int8.onnx 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 27 | `:8624` | tokens 文件 | `tokens.txt 的完整路径（留空 = 自动找）` | 单值路径 | 原样 | 一致 |
| 28 | `:8639` | Python 解释器 | `…\.venv\Scripts\python.exe` | 单值路径 | 原样 | **风格不一致**：这一格给的是路径**片段**，其余六格给的是「xxx 的完整路径（留空 = 自动找）」 |
| 29 | `:8653` | cli_bridge 脚本 | `cli_bridge.py 的完整路径` | 单值路径 | 原样 | 一致（但**缺**「（留空 = 自动找）」后缀，与 23–27 不齐） |
| 30 | `:9446` | 库目录 | `DEFAULT_LIBRARY_DIR` → 实际为 `ReelLudic`（`src/pure/libraryDir.ts:12`） | 单值 | `setValue(settings.libraryDir)` | **不一致**：其余路径框都写「库内路径，或系统绝对路径」，这一格只甩一个裸值，看不出是「目录名」还是「示例」 |
| 31 | `:9591` | 下载目录（按类型） | `DOWNLOAD_DIR_DEFAULT[kind]`（`src/pure/downloadPlan.ts:43-53`：`下载/音乐`、`下载/书籍`、`下载/视频`、`下载/Flash 游戏`，根为 `下载`，见 `:30`） | 单值 | 原样 | 一致，但**未说明是相对库根的路径** |

**`credentialPlaceholder(meta)`（`Settings.ts:3822-3837`）8 个分支**：

| 分支 | 行号 | 原文 |
|---|---|---|
| douban | `:3823` | `Douban Cookie（登录态）` |
| bangumi | `:3824` | `输入 Bangumi Access Token` |
| googleBooks | `:3825` | `API Key（可选，提配额）` |
| igdb | `:3826` | `IGDB Client ID` |
| tmdb | `:3830` | `TMDB v3 API Key（32 位，设置 → API）` |
| weread | `:3833` | `微信读书 Cookie（书架同步用）` |
| steam | `:3835` | `Steam Web API Key（同步库用）` |
| 默认 | `:3836` | `输入 ${meta.label} API Key` |

> `:4414-4417` 另有一处凭据框占用：「TMDB v4 access_token（eyJ 开头长串，账号同步用）」/ `${meta.label} Client Secret`，注释 `:4410-4413` 记录用户裁定「这一格只收 v4 access_token」。**每个源的凭据框写法都不统一**（有的带「输入」、有的不带；有的写「Cookie」、有的写「API Key」）。

### 3.2 `src/modals/`（51 处，50 个文件）

| # | 文件:行号 | 弹窗 / 控件 | placeholder 原文 | 单/多值 | 一致？ |
|---|---|---|---|---|---|
| 1 | `AssetManagerModal.ts:160` | 素材管理器搜索 | `搜索条目名 / 文件名 / 系列名` | 单值搜索词 | 一致（` / ` 是「或」不是分隔符） |
| 2 | `AsrInstallModal.ts:200` | ASR 安装目录 | `留空 = 用默认位置` | 单值路径 | 一致 |
| 3 | `AiPickerModal.ts:149` | 模型选择搜索 | `搜索模型…` | 单值 | 一致 |
| 4 | `AiPickerModal.ts:575` | 模型名输入（`AiModelNameModal`） | `this.opts.placeholder`（透传 `Settings.ts:3488`） | 单值 | 一致 |
| 5 | `EntryLogModal.ts:35` | 记录弹窗「时长（小时，可小数）」 | `如 1.5` | 单值数字 | 一致（`min:0 step:0.1`，`:159`） |
| 6 | `EntryLogModal.ts:38` | 记录弹窗「心得（可选）」 | `写下这次的感受…` | 长文本 | 一致 |
| 7 | `EntryLogModal.ts:44` | 重温「第几次重刷」 | `如 2` | 单值数字 | 一致（`min:1 step:1`，`:160`） |
| 8 | `EntryLogModal.ts:47` | 重温「感想」 | `这次重刷的感受…` | 长文本 | 一致 |
| 9 | `EntryLogModal.ts:53` | 周目「第几周目」 | `如 2` | 单值数字 | 一致 |
| 10 | `EntryLogModal.ts:56` | 周目「感想」 | `这一周目的感受…` | 长文本 | 一致 |
| 11 | `EntryLogModal.ts:159` | 时长框渲染 | `meta.numPlaceholder`（消费 5） | 单值 | 一致 |
| 12 | `EntryLogModal.ts:160` | 次数类框渲染 | `meta.numPlaceholder`（消费 7/9） | 单值 | 一致 |
| 13 | `EntryLogModal.ts:169` | 心得框渲染 | `meta.notePlaceholder`（消费 6/8/10） | 长文本 | 一致 |
| 14 | `ExcerptModal.ts:43` | 摘抄原文 | `粘贴摘抄的原文片段…` | 长文本 | 一致 |
| 15 | `ExcerptModal.ts:50` | 摘抄页码 | `如 128` | 单值数字 | 一致 |
| 16 | `ExcerptModal.ts:53` | 摘抄想法 | `写下此刻的想法…` | 长文本 | **不一致**：同一文案在 `PdfReaderModal.ts:2109` / `ReaderPanelBase.ts:1020` 写着「写下此刻的想法…（可留空）」，此处缺「（可留空）」 |
| 17 | `ExcerptModal.ts:67` | 挂载书目搜索 | `搜索书名 / 作者…` | 单值搜索词 | 一致 |
| 18 | `EpubReaderModal.ts:1794` | 阅读器解读搜索 | `输入要搜索的内容` | 单值 | **风格不一致**：无省略号，与全文其余搜索框不同 |
| 19 | `EpubReaderModal.ts:1809` | 阅读器提问 | `针对这段内容提问…` | 长文本 | 一致 |
| 20 | `TxtReaderModal.ts:1345` | 同上（TXT） | `输入要搜索的内容` | 单值 | 同 18（**两处逐字重复**） |
| 21 | `TxtReaderModal.ts:1360` | 同上（TXT） | `针对这段内容提问…` | 长文本 | 一致（与 19 重复） |
| 22 | `PdfReaderModal.ts:2109` | PDF 侧想法 | `写下此刻的想法…（可留空）` | 长文本 | 同 16 的对照项 |
| 23 | `ReaderPanelBase.ts:1020` | 阅读面板基类想法 | `写下此刻的想法…（可留空）` | 长文本 | 同上 |
| 24 | `EntryTextModal.ts:34` | 短评 | `写一句短评…` | 长文本 | 一致，但**未提「支持 [[双链]]」**（攻略框写了，见 25） |
| 25 | `EntryTextModal.ts:40` | 攻略正文 | `写下攻略正文（支持 [[双链]]）…` | 长文本 | 一致 |
| 26 | `EntryTextModal.ts:101` | 正文框渲染 | `meta.placeholder`（消费 24/25） | 长文本 | 一致 |
| 27 | `ImportBangumiModal.ts:39` | Bangumi 用户 ID | `如 595130，留空自动获取` | 单值数字 | 一致 |
| 28 | `ShotAnnotateModal.ts:301` | 截图标注文字 | `打字后回车` | 单值 | 一致（行为提示而非格式提示） |
| 29 | `TextPromptModal.ts:57` | 通用文本提示弹窗 | `this.opts.placeholder ?? ''`（默认空） | — | 一致（调用方决定） |
| 30 | `VaultFolderSuggest.ts:27` | 文件夹建议默认值 | `输入关键字过滤文件夹…` | 单值 | 一致 |
| 31 | `VaultFolderSuggest.ts:30` | 同上，`setPlaceholder()` | 同 30 | 单值 | 一致 |
| 32 | `VaultFileSuggest.ts:10` | 文件建议默认值 | `输入过滤…` | 单值 | 一致，但**比 30 短一截**（一个说「关键字过滤文件夹」，一个只说「过滤」） |
| 33 | `VaultFileSuggest.ts:13` | 同上，`setPlaceholder()` | 同 32 | 单值 | 一致 |
| 34 | `QuickAssociateModal.ts:312` | 网络地址（书籍） | `在线阅读链接（https://…）` | 单值 URL | 一致 |
| 35 | `QuickAssociateModal.ts:314` | 网络地址（漫画） | `在线阅读链接（https://…）` | 单值 URL | 一致（与 34 逐字重复） |
| 36 | `QuickAssociateModal.ts:315` | 网络地址（游戏） | `商店页 / 官网（https://…）` | 单值 URL | 一致 |
| 37 | `QuickAssociateModal.ts:316` | 网络地址（音乐） | `在线页 / 试听链接（https://…）` | 单值 URL | 一致 |
| 38 | `QuickAssociateModal.ts:321` | 本地路径（书籍） | `库内路径，如 书籍/书名.txt（TXT/EPUB/PDF）` | 单值路径 | 一致（`书籍/书名.txt` 内的 `/` 是目录分隔，非多值分隔） |
| 39 | `QuickAssociateModal.ts:332` | 本地路径（漫画） | `图片文件夹路径，或 .cbz / .cbt / .zip / .tar 文件` | 单值路径 | 一致 |
| 40 | `QuickAssociateModal.ts:340` | 本地路径（游戏） | `库内路径，或系统绝对路径（.lnk）` | 单值路径 | 一致 |
| 41 | `QuickAssociateModal.ts:348` | 本地路径（音乐） | `库内路径，或系统绝对路径（mp3/flac/m4a…）` | 单值路径 | 一致 |
| 42 | `QuickAssociateModal.ts:590` | 网络地址框渲染 | `net.placeholder`（消费 34–37） | 单值 | 一致 |
| 43 | `QuickAssociateModal.ts:631` | 本地路径框渲染 | `local.placeholder`（消费 38–41） | 单值 | 一致 |
| 44 | `QuickAssociateModal.ts:660` | SWF 路径 | `库内路径，或系统绝对路径（.swf）` | 单值路径 | 一致 |
| 45 | `QuickAssociateModal.ts:694` | 内嵌播放页 | `H5 / Unity 游戏的播放页（https://…）` | 单值 URL | 一致（与 `EntryForm.svelte:5337` 逐字重复） |
| 46 | `QuickAssociateModal.ts:1049` | 搜书名 / 搜歌名 | `书名（或书名 + 作者）` / `歌名（或歌名 + 歌手）` | 单值搜索词 | **不一致**：用「+」表示「加空格」，而 `EntryForm.svelte:5540` 同一语义写「可补歌手，如 孤勇者 陈奕迅」—— 两种说法指同一件事 |
| 47 | `QuickAssociateModal.ts:1166` | 集标题 | `如：开始` | 单值 | 一致（与 `EntryForm.svelte:5909` 重复，同样带全角冒号） |
| 48 | `QuickAssociateModal.ts:1197` | 集网络地址 | `https://…` | 单值 URL | 一致 |
| 49 | `QuickAssociateModal.ts:1215` | 集本地路径 | `库内路径，或系统绝对路径` | 单值路径 | 一致 |
| 50 | `QuickAssociateModal.ts:1232` | 字幕路径 | `同目录 .srt / .vtt / .ass（可留空）` | 单值路径 | 一致 |
| 51 | `QuickAssociateModal.ts:1744` | 选集检索词 | `检索词（作品标题 + 集标题，缺则补第N集）` | 单值 | 一致（与 `EntryForm.svelte:6026` 重复） |

### 3.3 `src/views/`（播放器 / 选集 / 列表视图，12 处）

> 12 = 字面量出现点：`SeriesProps` 3、`MediaList` 3（`:2723` 与 `:4093` 是变量，真身各在 `:783-790` / `:2686-2693`）、`MusicDownload` 1、`PosterSearch` 1、`RelatedChips` 2、`CollectionBoard` 1、`EpisodePageView` 1。
> 下表把两个变量展开成分支后共 22 行，**分支不重复计入 12**。

| # | 文件:行号 | 控件 | placeholder 原文 | 单/多值 | 一致？ |
|---|---|---|---|---|---|
| 1 | `components/SeriesProps.svelte:215` | 系列名 | `这个系列叫什么` | 单值 | 一致（风格偏口语，与全文「如 xxx」不齐） |
| 2 | `components/SeriesProps.svelte:276` | 归属合集 | `例如：熊出没（留空 = 清空）` | 单值 | 一致（**「例如：」前缀全文唯一**） |
| 3 | `components/SeriesProps.svelte:299` | 追加标签 | `多个用逗号分隔，例如：工作, 日常` | **多值** | **一致**：拆分在 `src/modals/SeriesPropsModal.ts:217` 的 `split(/[,，]/)`，`:213` 注释明写「与 EntryForm 同一套」 |
| 4 | `components/MediaList.svelte:2723` | 列表搜索框 | `searchPlaceholder`（变量，定义 `:783-790`） | 单值 | 见下 5 分支 |
| 5 | `components/MediaList.svelte:785` | ↑ 书籍分支 | `搜索书名、作者…` | 单值 | 一致 |
| 6 | `components/MediaList.svelte:786` | ↑ 游戏分支 | `搜索标题、开发商…` | 单值 | 一致 |
| 7 | `components/MediaList.svelte:787` | ↑ 音乐分支 | `搜索标题、作者…` | 单值 | 一致 |
| 8 | `components/MediaList.svelte:788` | ↑ 影视 / 动画分支 | `搜索标题、导演…` | 单值 | 一致（`:781` 注释记 #689 补「导演」） |
| 9 | `components/MediaList.svelte:789` | ↑ 默认分支 | `搜索标题…` | 单值 | 一致 |
| 10 | `components/MediaList.svelte:3137` | 批量标签 | `批量标签（逗号分隔）` | **多值** | **一致**：拆分 `:1743` 的 `split(/[,，]/)` |
| 11 | `components/MediaList.svelte:4093` | 表格行内编辑 | `cellEditPlaceholder(d)`（定义 `:2686-2693`） | 按列 | 见下 4 分支 |
| 12 | `components/MediaList.svelte:2688` | ↑ status 列 | `想看 / 在看 / 已看 / 搁置` | 单值 | 一致（`:245` 报错文案同四值） |
| 13 | `components/MediaList.svelte:2689` | ↑ rating 列 | `0~5，或 0~10（9/10）` | 单值 | 一致（`tableCell.ts:187-188` 支持三种写法；`:226` 报错文案同口径） |
| 14 | `components/MediaList.svelte:2690` | ↑ year 列 | `4 位数字` | 单值 | 一致（`tableCell.ts:231` 正则 `/^\d{4}$/`） |
| 15 | `components/MediaList.svelte:2691` | ↑ list 列（genres/tags/aliases/screenwriter/cast） | `用逗号分隔` | **多值** | **表格内一致**（`tableCell.ts:177` 的 `/[，,]/`），但**与表单冲突**（表单认斜杠） |
| 16 | `components/MediaList.svelte:2691` | ↑ date 列 | `2026-10-13` | 单值 | 一致（`tableCell.ts:249` 正则） |
| 17 | `components/MusicDownload.svelte:587` | 音乐下载搜索 | `输入歌名 / 歌手，如：作品名 作者名` | 单值搜索词 | **不一致**：前半句「歌名 / 歌手」易被读成多值分隔符，实际是「歌名 空格 歌手」（见 `:576-577` 注释：用「标题 作者」一次搜） |
| 18 | `components/PosterSearch.svelte:175` | 海报搜索 | `搜索词（默认「标题 + 类型词」）` / `搜索词（默认「标题 + 作者」）` | 单值 | 一致（「+」= 拼接搜索词） |
| 19 | `components/RelatedChips.svelte:298` | 关联条目搜索 | `搜库内条目：标题 / 原名 / 作者；留空列出全部` | 单值 | 一致（` / ` 是「或」） |
| 20 | `components/RelatedChips.svelte:384` | 关系词 | `REL_MIRROR_LABEL` / `关联` | 单值 | 一致 |
| 21 | `components/CollectionBoard.svelte:405` | 合集板搜索 | `搜索合集或条目` | 单值 | 一致（+ `:407` 同文 `aria-label`） |
| 22 | `views/EpisodePageView.ts:3286` | 选集页「就这一集的字幕提问」textarea | `就这一集的字幕提问…` | 长文本 | 一致 |

### 3.4 已核实并**排除**的非输入框命中

| 位置 | 是什么 | 结论 |
|---|---|---|
| `src/pure/cardMeta.ts:8` | `const PLACEHOLDER = '—'` | 卡片**空值占位符**（20 处使用），非输入框 |
| `src/pure/seriesGroup.ts:364` | `const PLACEHOLDER = '—'` | 同上（3 处使用） |
| `src/pure/noteImport.ts:65` | `function isPlaceholder(v: string)` | 导入时过滤 `—`/空值的判定函数，非输入框 |
| `src/modals/ComicReaderModal.ts:161,413,1543-1546,2255,2304-2313` | `placeholderEl` / `showPlaceholder()` | 漫画阅读器**占位图**元素 |
| `src/views/EpisodePageView.ts`（除 `:3286` 外 6 处） | `paintCoverPlaceholder` | 封面占位图 |
| `components/RatingBoard.svelte:422,618` | `.rl-board-placeholder` | 空态文案「暂无作品」+ CSS，非输入框 |
| `EntryForm.svelte:6950`、`SeriesProps.svelte:456`、`MediaList.svelte:4436/4476`、`CollectionBoard.svelte:689`、`RelatedChips.svelte:456` | CSS `::placeholder` 选择器 | 只改颜色，非文案 |
| `src/pure/formFields.ts:189-199` 等 | `placeholderOf` 定义与类型声明 `placeholder: string` | 生成器/类型，非控件 |

---

## 四、提示语与实际拆分规则不一致的项

### 第 1 条：标签（tags）—— 表单只认逗号，列表侧额外认顿号

- **位置**：表单 `src/views/components/EntryForm.svelte:4227-4230`；列表侧 `src/pure/noteCard.ts:426-431`（`splitList`）。
- **提示语原文**（表单，`EntryForm.svelte:4944` → `formFields.ts:148-156` 生成）：`多个用逗号分隔，如 工作, 日常`
- **实际规则**：
  - 表单：`input.tags = tagsText.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0)`（`:4227-4230`）—— **只认中英文逗号**，注释 `:4226` 明写。
  - 列表/表格：`splitList()` 用 `.split(/[、,，]/)`（`noteCard.ts:428`）—— **多认一个顿号**。
- **差在哪**：用户在表单里写「工作、日常」→ 存成**一个**标签 `工作、日常`；在列表里编辑同一字段写成「工作、日常」→ 拆成**两个**。同一字段两种行为，且 `formFields.ts:155` 的「⚠️ 只认逗号」警告因 `hintOf` 无人调用而从未显示。
- **建议改法**：把 `noteCard.ts:428` 的 `/[、,，]/` 与 `EntryForm.svelte:4228` 的 `/[,，]/` **合并到一个导出函数**（例如 `pure/formFields.ts` 新增 `splitFieldInput(key, raw)`），两侧都调它；`tests/formPlaceholders.test.ts:129` 的正向断言同步改为指向该函数，而不是各自钉 `split(...)` 字面量。

### 第 2 条：题材 / 主演（genres / cast）—— 表单认斜杠，表格**不认**斜杠（会静默吞输入）

- **位置**：表单 `EntryForm.svelte:4130`（genres）、`:4129`（cast）；表格 `src/pure/tableCell.ts:175-180`（`splitListText`）。
- **提示语原文**（表单，`EntryForm.svelte:4920` 等 5 处 → `formFields.ts:68-76` 生成）：`多个用斜杠分隔，如 科幻 / 冒险 / 灾难`
  表格行内（`MediaList.svelte:2691`）：`用逗号分隔`
- **实际规则**：
  - 表单：`genres.split(/[\/、,，]/)`（`:4130`）—— 认 `斜杠 / 顿号 / 中英文逗号`。
  - 表格：`t.split(/[,，]/)`（`tableCell.ts:177`，经 `:252` 的 `if (kind === 'list') return { ok: true, patch: b.set(splitListText(t), e) }`）—— **不认斜杠、不认顿号**。
- **差在哪**：`genres` 是 `kind: 'list'`（`src/pure/metaFields.ts:131`）。用户在表单里按提示语养成「科幻 / 冒险」的习惯，切到列表视图行内编辑同一个题材栏、原样输入「科幻 / 冒险」→ 被存成**一个**题材名 `科幻 / 冒险`，词云与筛选立刻失灵，而**没有任何报错**（`parseTableCellInput` 对 list 列永远返回 `ok: true`）。
- **建议改法**：`tableCell.splitListText` 改用与表单一致的 `/[\/、,，]/`；或反过来——把 `formFields.ts:72` 的 `sep` 从 `'slash'` 改成 `'comma'`，让整仓统一到逗号。二者择一，**不能继续并存**。

### 第 3 条：又名（aliases）—— 规格表承诺了一个界面上没有的输入框，而真实入口认的又不一样

- **位置**：规格 `src/pure/formFields.ts:157`；表单无控件（`EntryForm.svelte` 仅在 `:675`、`:1785`、`:1819`、`:4042`、`:4134` 出现 `aliases`）；表格 `src/pure/tableCell.ts:177`；frontmatter 读侧 `src/pure/noteEditable.ts:187-191`。
- **提示语原文**（`formFields.ts:157` 会生成的）：`多个用斜杠分隔，如 流浪地球2 / 小破球2` —— **但这句永远不会被渲染**（无控件调用 `placeholderOf('aliases')`）。
- **实际规则**：
  - 表格视图（`metaFields.ts:141` `kind: 'list'`）：`/[，,]/` —— 只认逗号。
  - frontmatter 解析（`noteEditable.ts:189`）：`inner.split(',')` —— **只认 ASCII 逗号**，连全角 `，` 都不认。
  - 表单提交（`EntryForm.svelte:4134`）：`/[\/、,，]/` —— 认四种，但用户没有输入框可填。
- **差在哪**：同一字段**三套口径**（表格逗号 / frontmatter 仅半角逗号 / 表单四选一），且「用户到底能从哪里填又名」在界面上没有任何提示。
- **建议改法**：二选一 —— ① 在 `EntryForm.svelte` 补 `aliases` 输入框并接 `placeholderOf('aliases')`；② 从 `FORM_FIELD_SPECS` 删掉 `aliases`（`formFields.ts:157`）与 `originalTitle`（`:62`）两条死规格，避免规格表继续描述不存在的界面。

### 第 4 条：导演 + 编剧合并框 —— 提示语只说「用斜杠分隔」，没说「第一个是导演」

- **位置**：`src/views/components/EntryForm.svelte:4997-5001`（textarea）、`:4119`（拆分）、`:4127-4128`（落位）。
- **提示语原文**（`EntryForm.svelte:5001` → `formFields.ts:78-86` 生成）：`多个用斜杠分隔，如 郭帆 / 龚格尔`
- **实际规则**：`const writers = directorWriters.split(/[\/、,，]/)...`（`:4119`）→ `director: writers[0]`（`:4127`）、`screenwriter: writers.slice(1)`（`:4128`）。即**位置即语义**：第 1 个是导演，其余全部是编剧。
- **差在哪**：提示语加示例「郭帆 / 龚格尔」看起来像「两个导演」。要填**两个导演**（如联合执导）时，第二个会被静默塞进 `screenwriter`。该规则只写在 `formFields.ts:85` 的 `note` 里（「第一个当导演，其余都当编剧」），而 `hintOf` 无人调用 ⇒ **用户永远看不到**。
- **建议改法**：把提示语改成能自解释的形态，例如 `多个用斜杠分隔，第 1 个是导演、其余都算编剧，如 郭帆 / 龚格尔`；或把这一格拆成「导演」「编剧」两个独立输入框。

### 第 5 条：`formFields.ts` 的 `example` 与模板手写文案已不同源（单值字段全部缺「（单个）」）

- **位置**：规格 `src/pure/formFields.ts:61,63,64,65,77,160,161`；模板 `EntryForm.svelte:4752,4890,4892,4901,4821,5130,6502`。
- **提示语原文对比**：

| 字段 | 规格会生成的（`placeholderOf`） | 模板实际手写的 | 差在哪 |
|---|---|---|---|
| title | `如 流浪地球2（单个）`（`formFields.ts:61`） | `作品名称`（`EntryForm.svelte:4752`） | 完全不同，且**缺「（单个）」** |
| sourceName | `如 豆瓣（单个）`（`:63`） | `来源名`（`:4890`） | 完全不同，且缺标注 |
| communityScore | `如 7.9（单个）`（`:64`） | `如 7`（`:4892`） | 示例值不同，且缺标注 |
| ratingCount | `如 500（单个）`（`:65`） | `如 500`（`:4901`） | 仅缺「（单个）」 |
| year | `如 2023（单个）`（`:77`） | `如 2024`（`:4821` 等 5 处） | 示例年不同，且缺标注 |
| summary | `如 填写作品剧情简介…（单个）`（`:160`） | `填写图书内容简介…` / `填写作品剧情简介…`（`:5130`） | 分叉文案，规格未覆盖 |
| notes | `如 一句话概括你的核心感受（单个）`（`:161`） | `在这里用一句话概括你的核心感受或者情绪记录...`（`:6502`） | 文案不同，且末三为半角点 |

- **差在哪**：`formFields.ts:56-57` 自称「这张表也是『表单长什么样』的文字版」，但实际 43 处手写文案未走规格，规格表已失真。同一张表单里「如 重庆出版社（单个）」与「如 2024」并排，**风格割裂**。
- **建议改法**：把这 7 个字段的模板文案改回 `placeholder={placeholderOf('...')}`；若确有理由手写（如 `title` 的「作品名称」更贴合语境），就在 `formFields.ts` 的对应 spec 里把 `example` 改成手写值，**保证规格与模板一致**，并由 `tests/formPlaceholders.test.ts` 反向断言（模板里出现 `placeholder="..."` 的字段必须也在 `FORM_FIELD_SPECS` 里）。

### 第 6 条：「写下此刻的想法…」同一句三种写法

- **位置**：`src/modals/ExcerptModal.ts:53`、`src/modals/PdfReaderModal.ts:2109`、`src/modals/ReaderPanelBase.ts:1020`。
- **提示语原文**：
  - `ExcerptModal.ts:53`：`写下此刻的想法…`
  - `PdfReaderModal.ts:2109`：`写下此刻的想法…（可留空）`
  - `ReaderPanelBase.ts:1020`：`写下此刻的想法…（可留空）`
- **实际规则**：三处均非必填（摘抄想法、PDF 想法都是可选字段）。
- **差在哪**：摘抄弹窗没写「（可留空）」，另外两处写了 ⇒ 用户无法从提示语判断这一格能不能跳过。
- **建议改法**：统一为 `写下此刻的想法…（可留空）`。

### 第 7 条：`hintOf()` 零调用 —— 28 条格式约束全部不可见

- **位置**：定义 `src/pure/formFields.ts:205-214`；全仓 `src/` 内**无任何调用点**（`grep hintOf` 仅命中定义自身与 `tests/formPlaceholders.test.ts:25,83,86-92`）。
- **受影响的 `note` 原文**（用户界面看不到）：
  - `formFields.ts:155`：`⚠️ 只认逗号（斜杠会被当成标签名的一部分），决定词云与自定义视图`
  - `formFields.ts:116`：`⛔ 只能填一个平台；要写多个请分条或在简介里说明`
  - `formFields.ts:103`：`⛔ 只能填一个（斜杠会被当成名字的一部分）`
  - `formFields.ts:64`：`支持「7 | 500」一口气写评分和人数`
  - `formFields.ts:85`：`第一个当导演，其余都当编剧`
  - `formFields.ts:75/:94`：`斜杠、顿号、逗号都能分隔`
- **差在哪**：`placeholder` 只能承载一句短语，那些「⛔ 不能这么做」的关键约束全被塞进 `note`，而 `note` 唯一的出口 `hintOf()` 没接进任何组件 ⇒ **等于没写**。这也直接放大了第 1、2、4 条的实际危害：用户没有任何途径知道标签不能用斜杠、平台不能填多个。
- **建议改法**：在 `EntryForm.svelte` 对应字段的 `<label class="rl-lbl">` 后追加一个 `<span class="rl-hint">{hintOf('tags')}</span>`（样式已有 `.rl-hint`），至少覆盖 `tags` / `platform` / `director` / `comic-author` / `cast` / `genres` 六个字段；或把 `note` 里最要紧的一句并入 `placeholder` 本体。

### 第 8 条：搜索类输入框至少四种写法并存

- **位置与原文**：
  - `src/views/components/MediaList.svelte:789`：`搜索标题…`
  - `src/views/components/EntryForm.svelte:4466`：`输入标题…`
  - `src/views/components/EntryForm.svelte:6026`：`检索词（作品标题 + 集标题，缺则补第N集）`
  - `src/modals/EpubReaderModal.ts:1794` / `src/modals/TxtReaderModal.ts:1345`：`输入要搜索的内容`（**无省略号**）
  - `src/modals/VaultFolderSuggest.ts:27`：`输入关键字过滤文件夹…` vs `src/modals/VaultFileSuggest.ts:10`：`输入过滤…`
- **差在哪**：同为「输入关键词搜索」，动词在「搜索 / 输入 / 检索 / 过滤」之间摇摆，句末省略号时有时无，长度从 5 字到 20 字。
- **建议改法**：统一为「搜索 + 对象 + …」句式（`搜索标题…`、`搜索书名、作者…`、`搜索合集或条目…`），短语体，一律带省略号。

---

## 五、建议统一的文案规范

### 5.1 多值字段：统一一种分隔符，并且只写一句

**规范**

1. 一个字段只允许**一种**分隔符作为「主分隔符」，并把它写进 `FORM_FIELD_SPECS` 的 `sep`（现有机制已支持）。
2. 提示语句式**固定为**：`多个用<分隔符中文名>分隔，如 <示例1><分隔符样例><示例2>`
   - 逗号：`多个用逗号分隔，如 工作, 日常`
   - 斜杠：`多个用斜杠分隔，如 科幻 / 冒险 / 灾难`
   - 生成逻辑已存在（`formFields.ts:194-196`），**只允许通过 `placeholderOf(key)` 产出，禁止模板手写第二条格式说明**（`EntryForm.svelte:142-143` 的既有约定要真正执行）。
3. **副分隔符不写进 placeholder，写进 hint**：若实现确实多认顿号/逗号（`genres` / `cast` 现状），在字段旁用 `.rl-hint` 显示一句「顿号、逗号也能分隔」，**不要塞进 placeholder**——placeholder 一长就会被 CSS 截断。
4. **同一字段跨入口必须同源**：表单、表格行内、批量编辑、frontmatter 解析四处，必须调用**同一个**拆分函数（建议 `pure/formFields.ts` 导出 `splitFieldInput(key, raw)`），禁止各处自己写 `split(...)`。
5. 提交方向（写 frontmatter）统一用**半角逗号 + 空格** join，读侧同时接受半角/全角逗号；这一点 `noteGenerator.ts:65-82` 与 `noteEditable.ts:187-191` 已经自洽，保持即可。

**建议的字段级定案（择一，需产品拍板）**

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. 全仓统一逗号**（推荐） | `genres` / `cast` / `director` 的 `sep` 改为 `'comma'`，`tableCell` / `noteCard` 已认逗号，改动最小 | 与 frontmatter 存储格式（`noteGenerator.ts:75` 用 `, ` join）一致；与表格、批量标签、视图标签三处已有口径一致 | 用户已有的「科幻 / 冒险」存量数据（`EntryForm.svelte:670` 初值用 `.join(' / ')`）需要一次迁移 |
| B. 全仓统一斜杠 | `tableCell.ts:177` 与 `noteCard.ts:428` 都改成 `/[\/、,，]/` | 视觉上斜杠比逗号更易读，且不动 placeholder | 与 frontmatter 存储用逗号 join 冲突，需读写两侧都改；`aliases`/`genres` 存量里可能真有含斜杠的名字（如作品名「Fate/stay night」），风险更高 |

**无论选哪条，必须同时改的 5 个点**：`EntryForm.svelte:4129`、`:4130`、`:4134`、`:4228`、`tableCell.ts:177`，以及 `noteCard.ts:428` 与 `noteEditable.ts:189` 的对齐。

### 5.2 单值字段：统一标注「（单个）」，并列明单位/范围

**规范**

1. 所有**标量**字段（`title`、`year`、`sourceName`、`communityScore`、`ratingCount`、`platform`、`developer`、`isbn`、`pageCount`、`publisher`、`author`、`album`、`collection`、`episode`、`totalEpisodes`、`readHours`、`playtimeHours`、`readingPage`、`readingTotalPage`）提示语一律以 `如 <示例>（单个）` 结尾。
   - 依据：`placeholderOf()` 已实现此规则（`formFields.ts:198`），但模板里 **43 处手写**绕过了它。
2. **例外（可省「（单个）」）**：字段本身语义已含「单一」时，用整句覆盖（`spec.placeholder`），如
   - `series`：`同一系列的名称（留空不成组）`（`formFields.ts:134`）✓
   - `series-index`：`可留空，填整数（第几部/季）`（`formFields.ts:145`）✓
   这类整句必须同时说清：**能否留空 + 值的形态**。
3. **数字框必须带范围或单位**：`如 6`（`Settings.ts:7257`）应改为 `如 6（2~8，单个）`；`如 1200 章`（`EntryForm.svelte:4955`）已带单位，保留。
4. **路径框统一句式**：`库内路径，或系统绝对路径（.lnk）` / `xxx.exe 的完整路径（留空 = 自动找）`。禁止出现裸值（`Settings.ts:9446` 的 `ReelLudic` 应改为 `库内目录名，如 ReelLudic（单个）`；`:8639` 的 `…\.venv\Scripts\python.exe` 应改为 `python.exe 的完整路径（通常在该 venv 里）`）。
5. **URL 框统一为** `https://…` 或 `https://…（用途说明）`；现在的三种（`https://…`、`在线阅读链接（http/https）`、`商店页 / 官网（https://…）`）收敛为后两种之一。
6. **「或」与「分隔符」必须能一眼区分**：` / ` 只用于**多值分隔**；「A 或 B」这类并列说明改用 `、` 或「或」字，避免 `搜索条目名 / 文件名 / 系列名`（`AssetManagerModal.ts:160`）被误读成可输入多值。
7. **可选性显式化**：可留空的字段，提示语里补「（可留空）」（如 `PdfReaderModal.ts:2109`），不要靠「用户猜」。
8. **`note` 必须可见**：把 `hintOf()` 接进 UI（第 7 条），否则 `FORM_FIELD_SPECS` 里所有 `⛔` 约束继续等于不存在。

### 5.3 落地检查清单（改完自查）

- [ ] `grep -n 'placeholder="' src/views/components/EntryForm.svelte` 的命中数应为 **0**（全部走 `placeholderOf`），或每个残留都有一条「为何必须手写」的注释。
- [ ] `grep -rn 'split(/' src/` 中，与列表字段相关的 `split(...)` 应只剩 `formFields.ts` 内的**一处**真源。
- [ ] `FORM_FIELD_SPECS` 的每条 `key` 都能在模板里找到一个消费点（消除 `aliases` / `originalTitle` 这类死规格）。
- [ ] `tests/formPlaceholders.test.ts` 的正向断言从「钉字面量」改为「钉生成函数 + 钉唯一拆分函数」，避免今天这种「测试全绿、实际跨入口不一致」。
- [ ] 用 `MediaList` 表格编辑一次 `genres`，输入 `科幻 / 冒险`，确认落盘为**两个**题材（当前会是一个）。
