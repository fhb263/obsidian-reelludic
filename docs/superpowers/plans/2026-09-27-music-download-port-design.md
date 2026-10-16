# ReelLudic 音乐下载面「LyricFlux 整体移植」设计文档

> 日期：2026-09-27 ｜ 状态：**✅ 已落地（2026-09-28 批次 #399-D）** —— 纯逻辑 + 服务层 + UI + 设置面全部进仓并跑完门禁
> ✅ **落地结果（#399-D）**：`pure/dl/{qq,kugou,kuwo,neteaseCrypto,utils}.ts`（逐字搬 + 来源头）｜`services/dl/index.ts`（`dlSearch` / `dlRecommendedPlaylists` / `dlPlaylistSongs` / `dlTestConnection` / `dlDownloadSong`）｜`MusicDownload.svelte` 四平台版｜`main.ts` 五门面｜设置页 4 行 Cookie + 测试连接。**门禁**：全量 127 文件 / 2355 例 / 0 失败；产物断言 1888 PASS / 0 FAIL；产物级突变 30/30 `[RED ok]`；md5 三方一致 + 已部署 + 镜像。UI-GUIDE **v125**。
> ✅ **已裁定的决策点**：**D-1 = (a)**（VIP 链路进仓，`neteaseCrypto.ts` 头部如实标注 AGPL 血统）｜**D-3 = (c) 不内嵌标签**（用户：「音频下载后不要回填标签那套…有风险不搞这套」）｜**D-4 = (a)**（Cookie 行归「数据源凭据」组，该页仍恰 2 组）｜**D-2 = (b) 自动档**（不给音质选择，各平台自带降级：网易云 eapi→weapi→免密；酷我 flac→320→128）｜**D-6 = (b) 不做试听**｜**D-7 认可**（用户确认两仓均其本人作品）。
> ⏳ **仍未做**：⑴ 进度**百分比**（本仓 `services/nodeHttp` 暂无流式钩子，当前只有阶段文本）；⑵ 试听（`previewAudio`）；⑶ 退役代码清理（`services/downloader.ts` 与 `pure/songDownload` 的部分导出已无产线调用）。
> 需求来源：用户 2026-09-27「编辑条目里本地音频下载按钮是和摘要总结那个同款按钮，而且点下载是空白（**能不能将原插件 obsidian-lyricflux 的下载界面和逻辑移植过来**）」→ 追问范围后裁定 **C 整体移植（含 VIP/Cookie）**；2026-09-28 追加「两个插件都是我做的，按原来移植合并就行了…四平台搜索歌曲和下载歌曲、都给我移植过来，先给我移植过来再改」。
> 前置阅读：`AGENTS.md`（红线）、`UI-GUIDE.md` **§16**（下载弹窗 / §16.7 图标纪律）、`docs/superpowers/plans/2026-09-27-1.1.1-design.md` §5.5 / §6（⑤ 的原始口径与 D-12~D-14）、`src/pure/downloadPlan.ts`、`src/pure/songDownload.ts`、`src/services/downloader.ts`、`src/services/musicDownload.ts`、`src/views/components/MusicDownload.svelte`。
> 参照物：测试库 `.obsidian/plugins/obsidian-lyricflux/main.js`（**v1.4.4，作者 `fhb263` = 本仓同作者**）。勘察方式 = 解 `\uXXXX` 转义后读码（`_dec.js`）。

---

## 1. 为什么值得移植（现状缺什么）

现有 ⑤-c 只有**单平台 · 免费通道**：搜索（`cloudsearch`）+ 推荐歌单/歌单详情 + `song/media/outer/url` 免密外链下载。实测约束是「热歌榜 200 首只有 1 首可下」（`fee={8:72,1:127,0:1}`）—— 覆盖面窄到几乎不可用。

LyricFlux 那套是**成熟可用**的：多平台、可带 Cookie 取 VIP 音质、下载后把歌词/封面**内嵌进文件**、全程进度回调、渐进式搜索体验。用户要的就是这个体验。

## 2. 参照物勘察结论（LyricFlux v1.4.4）

**界面（`DownloadModal`，纯 DOM 实现，非 Svelte）**
- 标题「下载歌曲」；搜索行 = 输入框 + 「百科」（聚合搜索，本仓不做）+ 「推荐歌单」按钮；回车/按钮触发搜索，**带 debounce**。
- **平台胶囊**按 `currentSource` 切换；平台表 `{ netease: 网易云音乐 / music.163.com, qq: QQ 音乐 / y.qq.com, kugou: 酷狗音乐 / kugou.com, kuwo: 酷我音乐 / kuwo.cn }`，顺序由 `sourceOrder()` 给出。
- **渐进增量渲染**：`pendingSeen` 去重 + `pendingResults` 按相似度**增量插入排序** + 每批到达即渲染（不是等全部结果）。
- 两级缓存：`playlistCache`（按源）/ `playlistSongsCache`（按 `源:id`）；歌单视图顶部有「返回推荐歌单」头（含实际歌曲数 + 刷新）。
- 搜索结果行 = 封面 + 歌名/副行 + 动作区；写盘不走弹窗关闭（下载完按钮回到可用态）。

**下载逻辑（`downloadSong(plugin, song, cookies, onProgress)`）**
- 按源分发：`downloadNetEase` / `downloadQq` / 酷狗 / 酷我。
- 网易云：**带 Cookie ⇒ 走 VIP 高音质**（用 `weapi` + `encSecKey`）；无 Cookie ⇒ 免费标准音质（本仓现走的外链）。
- QQ：**必需 Cookie**（含 `extractQqUin(cookie)` 取 uin + `QQ_REFERER`）。
- 酷狗：Cookie 可选；酷我：**免登录即可**（Cookie 仅「预留」）。
- `testPlatformConnection(source, cookie)`：逐平台「测试连接」，网易云还回报 `vipType`（是否会员）。
- `previewAudio(song, cookies, onProgress)`：试听同一套字节获取路径。

**落地后处理（这是最大的一块新纯逻辑）**
- 先 `fetchLyric` + `downloadImage`（封面）→ `embedTagsIntoBytes(audio, tags)` **把标签写回音频字节**（title / artist / album / lyrics / cover），按魔数判型（`looksLikeFlac` / `looksLikeMp3` / `looksLikeM4a` → `flac` / `mp3` / `m4a`）→ 落盘。
- 全程 `onProgress(pct | null, label)`（「正在下载音频」「正在获取歌词与封面…」「正在内嵌标签并写入…」）。

**设置面**：多平台 Cookie 分组（`cookie` 出现 107 次）+ 音质 + 下载目录。

## 3. 与本仓既有红线 / 已裁定的冲突（必须先认账）

| 冲突点 | 原口径 | 移植后 |
|---|---|---|
| 平台范围 | **D-13(a)** 只做网易云免费通道 | 四平台（网易云 / QQ / 酷狗 / 酷我） |
| 加密链路 | **⛔ 不碰 `neteaseCrypto`**（源自 AGPL 的 `go-music-dl`） | 需要 `weapi` + `encSecKey`（VIP 音质）⇒ **推翻该条**，见 D-1 |
| 文案规范 | 占位/示例不出现具体作品名、人名、数据源名 | LyricFlux 的占位是「输入歌名 / 歌手，如：晴天 周杰伦」⇒ **必须改中性写法** |
| 设置页分组 | **#399 刚把「音乐集成」整组删掉**（数据源配置页恰 2 组） | 多平台 Cookie + 音质 + 目录需要新家 ⇒ 见 D-4 |
| 下载开关 | `audioInlinePlayer`（「启用内置音乐播放器」）单一门控 | 保持（新面挂同一门控） |

## 4. 落地方案（C）：按本仓分层重写，不搬编译产物

⛔ **不复制 LyricFlux 的 `main.js`**（那是 esbuild 产物，1.18 MB，且与本仓分层冲突）；**按模块重写**：纯逻辑下沉 `src/pure/`（可 TDD），网络/落盘收在 `src/services/`（注入式 http，可单测），UI 用 Svelte。

### 4.0 真源映射表（2026-09-28 补：源码正本已定位）

🔴 **正本不在测试库里那份编译产物，而是** `C:\Users\kest\Desktop\obsidian-lyricflux\src\*.ts`（真 TS 源码，本仓同作者；LICENSE 文件是 **GPL-3.0 全文**，而 `package.json` 写 `MIT` —— 两者不一致，见 D-7）。

| LyricFlux 源文件（行数） | 本仓目标 | 说明 |
|---|---|---|
| `DownloadModal.ts`（604） | `views/components/MusicDownload.svelte`（重写） | 实时搜索（`SEARCH_DEBOUNCE_MS = 300`，无「搜索」按钮）、平台胶囊、进度条、结果列表、歌单返回头；**移除「关闭」按钮**（用户已定） |
| `downloadManager.ts`（1895） | 拆：`services/dl/index.ts` + `services/dl/{netease,qq,kugou,kuwo}.ts` + `pure/dl/*` | 按平台分发、VIP 判定、进度回调、字节校验、重试 |
| `downloadUtils.ts`（167） | `pure/dl/plan.ts`（**已有** `pure/downloadPlan`） | 路径 / 净化 / 去重（现有实现已覆盖，做差集后合并） |
| `neteaseCrypto.ts`（225） | `services/dl/crypto.ts` | ⚠️ **AGPL 混入风险点**（文件自述移植自 go-music-dl）⇒ D-1 |
| `qqMusic.ts`（418）/ `kugouMusic.ts`（405）/ `kuwoMusic.ts`（324） | `services/dl/{qq,kugou,kuwo}.ts` | 各自的搜索 / 取流 / 取词端点与签名 |
| `onlineLyrics.ts`（230） | 复用本仓 `pure/lyricOnline` + `services/lyricSearch` | 本仓已有三源歌词（#396），⛔ 不重复搬 |
| `tags.ts`（484）+ `renderers/{id3,mp4,vorbis,ogg,serializer,renderer}.ts`（约 900） | `pure/dl/tagEmbed.ts`（+ 按容器拆 `id3.ts`/`mp4.ts`/`vorbis.ts`） | **ID3v2 / FLAC / M4A 标签写回**；`renderers/lrc.ts` / `srt.ts` / `wordSplitter.ts` **不搬**（本仓已有 `pure/lrc`，且不做 srt） |
| `tagSize.ts`（86） | 并入 `pure/dl/tagEmbed.ts` | 计算嵌入后大小 / 上限 |
| `Settings.ts`（下载段） | 本仓设置页 | 多平台 Cookie（含「测试连接」）+ 音质 + 目录 ⇒ 位置见 D-4 |
| `songScanner.ts` / `Mp3PlayerRender.ts` / `LyricsView.ts` / `BaikeSearchModal.ts` / `TagEditorModal.ts` | **不搬** | 歌曲扫描 / 播放器 / 歌词视图 / 百科 / 标签编辑器 —— 本仓 ④ 已有播放器，百科与标签编辑不在本次范围 |

**规模**：下载面正本约 **6400 行**（不含播放器与歌词渲染）⇒ 按 §5 的 T1~T7 分批，**每批独立收口**。

### 4.1 纯逻辑（`src/pure/`，逐文件配单测）

| 模块 | 职责 | 备注 |
|---|---|---|
| `pure/dl/platforms.ts` | **平台注册表**（id / 显示名 / 站点 / 是否必需 Cookie / 免登录可用性 / 是否需要加密链路 / 音质档位集） | 与 `pure/sourceRegistry` 同款「注册表 = 唯一真源」思路；UI 胶囊、设置行、分发全部读它 |
| `pure/dl/quality.ts` | 音质档位表 + `normalizeQuality`（脏值回落）+ 每平台可用档位 | 具体档位值**开工时逐平台实测**后入表（⛔ 不臆造） |
| `pure/dl/cookies.ts` | Cookie 串解析 / `uin` 提取 / 必填项校验 / 有效性判据（纯函数：给响应体 → 判定结论） | 只做**判定**，不发请求 |
| `pure/dl/search.ts` | 多平台搜索结果统一模型 + 关键词相似度打分 + **增量插入排序** + 去重键 | 扩展现有 `pure/musicDownload`，别另起一份 |
| `pure/dl/plan.ts` | 沿用现有 `pure/downloadPlan`（净化 / 白名单 / `(2)(3)` 去重 / 上限） | 不改口径，只加平台子目录 |
| `pure/dl/sniff.ts` | 魔数判型（mp3 / flac / m4a / ogg）+ 64 KB 门槛 | 从 `pure/songDownload` 拆出，供**标签内嵌**选容器 |
| `pure/dl/tagEmbed.ts` | **ID3v2.3 / v2.4（含 syncsafe 帧长）、FLAC Vorbis comment、M4A `ilst`** 的标签写回 | 🔴 最大新面；纯字节进出 ⇒ 100% 可单测（喂真实小样本 + 边界） |

### 4.2 服务层（`src/services/`，注入 http，不直接依赖 obsidian）

| 模块 | 职责 |
|---|---|
| `services/dl/netease.ts` | 免费外链（既有）+ **VIP 链路**（`weapi` / `encSecKey`） |
| `services/dl/crypto.ts` | 上面用到的加密封装，**单独一文件**并**在文件头标注来源与许可**（见 D-1） |
| `services/dl/qq.ts` / `kugou.ts` / `kuwo.ts` | 各平台取字节 + 取歌词 + 取封面 |
| `services/dl/index.ts` | `downloadByPlatform(song, { cookies, quality }, onProgress)` 统一入口 + 逐平台失败可读化（⛔ 不抛到 UI） |
| `services/downloader.ts` | **既有**：注入式落盘（扩展名白名单在请求之前判）+ `main.writeBinaryFile` 逐层补目录 / `byteOffset` 切片 |

### 4.3 UI 层（Svelte，保持 ⑤-c 的三段视图骨架）

`views/components/MusicDownload.svelte` 重写为：搜索行（输入 + 「推荐歌单」）+ **平台胶囊（全部可点，未配 Cookie 的平台点了给明确原因而非禁用）** + 列表（封面 / 歌名 / 副行 / 动作区）+ **进度条**（`onProgress`）+ 歌单视图返回头。`modals/MusicDownloadModal.ts` 壳保持不变（标题「下载歌曲」+ `$destroy`）。
🔴 **图标一律走本仓 `./Icon.svelte`**（§16.7：#399-B 的空白弹窗就是踩这条）。小图标按钮 `.rl-ai-btn`。

### 4.4 设置与入口
- 入口：编辑表单「⤓」小图标按钮（已有，`audioInlinePlayer` 门控）+ LyricFlux 还有「歌曲列表弹窗」里的下载入口（本仓无该弹窗 ⇒ 不搬）。
- 设置：多平台 Cookie（每平台一行 + 「测试连接」按钮）+ 音质 + 下载目录 ⇒ 位置见 **D-4**。

## 5. 批次拆分（T1→T7，每批可独立验收）

| 批 | 内容 | 门禁要点 |
|---|---|---|
| **T1** | `platforms` / `quality` / `cookies` 三个纯模块 + 单测 | **先逐平台 curl 实测**音质档位与 Cookie 判据，再入表（⛔ 不臆造）；单元级突变全红 |
| **T2** | `sniff` 拆分 + **`tagEmbed`**（ID3v2.3/2.4 + FLAC + M4A）+ 单测 | 用**真实小样本字节**做往返（写标签 → 再读回）与「坏输入不破坏原字节」用例 |
| **T3** | `services/dl/netease`（免费 + VIP）+ `crypto.ts`（含来源标注）+ 单测（注入 http 桩） | 无 Cookie ⇒ 与现状逐字节一致（回归）；有 Cookie ⇒ 实测一首 VIP 曲目 |
| **T4** | `services/dl/qq` / `kugou` / `kuwo` + 单测 | 每平台「未配 Cookie」路径必须给出可读原因 |
| **T5** | UI 重写（渐进渲染 + 平台胶囊 + 进度条 + 错误态）+ 仿真页 | 用户约定：**先出象形/仿真图**再动实装；进度条与长列表滚动实测 |
| **T6** | 设置分组（Cookie + 测试连接 + 音质 + 目录） | 分组位置按 D-4；测试连接结果文案分「未填 / 无效 / 有效 / 会员」四态 |
| **T7** | 接线 + 收口（断言 / 突变 / 部署 / 双层 CHANGELOG / progress / UI-GUIDE） | 全量测试 + 产物断言 + 产物级突变 + md5 三方一致 + 镜像 |

## 6. 风险

- **接口易变**：QQ / 酷狗 / 酷我端点与签名常年漂 ⇒ 每平台都要**可读失败 + 降级提示**（「接口可能已变更」），并把「实测不过就不进表」当纪律。
- **VIP 链路的许可**：见 D-1。这决定 `crypto.ts` 能不能进仓。
- **标签内嵌写坏文件**：必须在写盘前完成全部字节处理，且**任何一步失败都回退成原始字节**（宁可不内嵌，也不产出坏音频）。
- **Cookie 明文落地**：写进 `data.json`（与既有 API Key 同款）。是否需要提示/加密 ⇒ D-5。
- **移动端**：无 Node http ⇒ 整面保持桌面端门控（既有口径）。

## 7. 待裁定（D-1…D-6）

| # | 议题 | 选项 |
|---|---|---|
| **D-1** | VIP 链路（`weapi` + `encSecKey`）能不能进仓 | (a) 进：按 LyricFlux 现有实现重写一份，文件头标注「源自 go-music-dl（AGPL）血统」并把许可影响写进 README；(b) **不进**：只做各平台免登录可用通道（网易云免费 / 酷我免登录 / 酷狗 QQ 可免的部分），VIP 面不做 |
| **D-2** | 音质选择 | (a) 全平台统一档位下拉；(b) 只给「自动（取当前 Cookie 能拿到的最高档）」不给选择（少一个设置项） |
| **D-3** | 内嵌标签范围 | (a) 歌词 + 封面 + 标题/歌手/专辑全内嵌（LyricFlux 全量）；(b) 只内嵌歌词；(c) 不内嵌（保持现状） |
| **D-4** | 设置分组放哪 | (a) **基本设置 · 实验性功能**内新增一行「音乐下载」→ 展开/弹窗配置（保持「数据源配置页恰 2 组」的既有断言）；(b) 数据源配置页新开「音乐下载」组（**要改既有断言**，且违背 #399 刚删组的精神）；(c) 独立第 5 个 Tab |
| **D-5** | Cookie 存储与提示 | (a) 明文存 `data.json` + 设置页一句提示（与 API Key 同款）；(b) 明文 + 首次填写弹一次说明 |
| **D-6** | 试听（`previewAudio`） | (a) 做（列表行加 ▶ 试听，复用同一套字节获取）；(b) 不做（本仓已有内置音频播放器，重复） |
| **D-7** | LyricFlux 的 `package.json` 写 `MIT`、`LICENSE` 文件是 `GPL-3.0` 全文（**两者不一致**） | (a) 以 `LICENSE`（GPL-3.0）为准 → 与本仓 GPL-3.0-only 兼容，移植放行；(b) 先修正本仓的许可声明再移植（更干净，但要动另一个仓） |

## 9. 2026-09-28 用户追加口径（已落地，属本次移植的 UI 前置）

用户附截图提出三件事，**已按 #399-C 落地并收口**（与本节的 T5 是同一方向，先做了最小可验版本）：
- 「LRC 歌词」→ **「LRC歌词」**（去掉中间空格）。
- 下载按钮要放在**「本地音频」标题旁边**（与「LRC歌词 / 总结摘要」两行同款同位置：`.rl-lbl-row` + `.rl-ai-btn`）。
- 下载弹窗：**去掉「关闭」按钮**、**去掉「搜索」按钮**，改成**敲一个字就实时搜索**（`SEARCH_DEBOUNCE_MS = 300`，回车立即搜）。
🔴 T5 重写弹窗时**必须保持**这三条（断言已按产物/源码双侧钉住）。

## 8. 与既有文档的关系
- `docs/superpowers/plans/2026-09-27-1.1.1-design.md` §6 的 **D-13(a) 被本文 D-1 取代**（若 D-1 取 (a)）；D-12 / D-14 不变。
- 版本：用户已裁定「下载面全是实验功能 ⇒ 版本始终 1.1.1」，本面**不升版号**。
