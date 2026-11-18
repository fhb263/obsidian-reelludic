// 在线曲库歌曲 → `music` 条目的**落库映射**（纯逻辑：不发请求、不落盘、不缓存，可单测）。
//
// 背景（用户 2026-11-09 第 15 轮：「给三大音乐平台加搜索元数据的功能」，成本规划阶段 B）：
// 在线曲库搜到的歌原来只能「点一下回填表单、再手动保存」；这里把「结果 → 条目」的映射钉成单一真源，
// 让「搜索结果卡片上的入库按钮」与未来的「同步清单」共用同一份口径。
//
// 🔴 三条硬口径（都写进单测）：
//  ⑴ **判重键 = 来源 id，⛔ 不是标题**：标题会被用户改（「晴天」手改成「晴天 (Live)」后，
//     按标题判重就会重复导入一条）。与 `steamSync.steamItemKey` / `tmdbItemKey` 同款。
//  ⑵ **歌曲时长不落库**：`MediaEntry.durationMin` 是**片长**、`listenMinutes` 是**收听时长**，
//     两者都不是「这首歌 4 分 29 秒」。本仓没有歌曲时长字段，本轮也不加（schema append-only
//     更要紧的是别把语义不同的值塞进现有字段 —— 那是静默写坏数据）。
//     搜索结果卡片上照样显示时长（`MusicSearchResult.duration` → `SearchDisplay.duration`）。
//  ⑶ **封面地址只从 `pure/posterSources` 拼**：四平台的尺寸改写规则、酷我的专辑图改写全在那里，
//     本文件⛔ 不出现任何 URL 字面量（与 `pure/songLibrary` 同一条纪律，断言脚本守着）。
import type { MediaEntry } from 'data/types';
import type { DownloadSong } from 'services/dl';
import { platformCoverUrl } from 'pure/posterSources';
import { musicArtistOf } from 'pure/musicArtist';
import { SONG_LIB_ID } from 'pure/songLibrary';
// 标题归一复用导入器那一份（`NFKC` + 折叠空白 + 小写），⛔ 别在本文件再写第二套 ——
// 「同名」必须在豆瓣同步 / Steam 同步 / 音乐清单同步之间是**同一个定义**，否则同一个库两种答案。
import { normalizeTitleForMatch } from 'pure/importConflict';
// 🔴 平台键与展示名住在**叶子模块** `pure/musicPlatform`（2026-11-09 第 15 轮抽出）：
//    结果卡片（`pure/songLibrary`）现在也要显示平台名，而本文件已经 import 了 `songLibrary` 的
//    `SONG_LIB_ID` ⇒ 常量若留在这里，`songLibrary` 反向 import 就是**循环依赖**。
//    这里 re-export 是为了「已有调用点（含单测）零改动」—— 新代码请直接从 `pure/musicPlatform` 取。
export {
    MUSIC_PLATFORMS,
    MUSIC_PLATFORM_LABELS,
    isMusicPlatform,
    musicPlatformLabel,
    type MusicPlatform,
} from 'pure/musicPlatform';
import { MUSIC_PLATFORM_LABELS, isMusicPlatform, type MusicPlatform } from 'pure/musicPlatform';

/**
 * 落库判重键：`music:{source}:{id}`。
 *
 * 🔴 **按来源 id 判重，⛔ 不按标题**（见文件头 ⑴）。
 * ⚠️ 与搜索结果卡片的「已添加」标记键（`pure/repeatAdd.resultKeyOf` = `id|title`）**不是一回事**：
 *    那个键服务于「本次搜索结果里哪张卡片点过」，键里的 `id` 已经是 `songlib:{source}:{id}`；
 *    这里服务的是「库里是否已有这首歌」，要能**从条目反解**出来（见 `musicKeyFromEntry`）。
 */
export function musicItemKey(source: unknown, id: unknown): string {
    const s = String(source ?? '').trim();
    const i = String(id ?? '').trim();
    if (!s || !i) return '';
    return `music:${s}:${i}`;
}

/**
 * 从条目反解判重键（「库里已有」的唯一判据）。
 *
 * 两条来源都要认：
 *  ① **本轮新落的条目**：`source` = 平台键、`sourceUrl` = 平台歌曲页 ⇒ 用 `musicIdFromUrl` 反解 id。
 *  ② **历史条目**：用户此前手动建的歌（只有 `sourceUrl`，`source` 为空或 `douban`）——
 *     判「库里已有」时不认它，否则会把用户的豆瓣条目当成「已入库」而跳过。
 *
 * ⚠️ 认不出回空串（⛔ 不拿标题兜底）。
 */
export function musicKeyFromEntry(e: { source?: string; sourceUrl?: string } | null | undefined): string {
    if (!e) return '';
    const src = String(e.source ?? '').trim();
    if (!isMusicPlatform(src)) return '';
    const id = musicIdFromUrl(e.sourceUrl);
    return id ? musicItemKey(src, id) : '';
}

/**
 * 从平台歌曲页地址反解**平台内 id**。
 *
 * 四种形态（真源 = `pure/dl/utils.buildSongWebUrl`，改那边必须同步这里）：
 *  · 网易云 `https://music.163.com/#/song?id=347230`            → `347230`
 *  · QQ     `https://y.qq.com/n/ryqq/songDetail/003OUlho2HcRHC` → `003OUlho2HcRHC`
 *  · 酷狗   `https://www.kugou.com/song/#hash=ABCDEF...`        → `ABCDEF...`
 *  · 酷我   `https://www.kuwo.cn/play_detail/211513640`         → `211513640`
 *
 * ⚠️ 返回**字符串**（QQ 的 songmid 是字母串，酷狗的 hash 是十六进制串，⛔ 别 `Number()`）。
 * ⚠️ 认不出回空串 —— 用户手填的别站链接不该被当成本平台曲目。
 */
export function musicIdFromUrl(url: unknown): string {
    const s = String(url ?? '').trim();
    if (!s) return '';
    const netease = /music\.163\.com\/#?\/?song\?id=(\d+)/.exec(s);
    if (netease) return netease[1];
    const qq = /y\.qq\.com\/n\/ryqq\/songDetail\/([A-Za-z0-9]+)/.exec(s);
    if (qq) return qq[1];
    const kugou = /kugou\.com\/song\/#?hash=([A-Za-z0-9]+)/i.exec(s);
    if (kugou) return kugou[1];
    const kuwo = /kuwo\.cn\/play_detail\/(\d+)/.exec(s);
    if (kuwo) return kuwo[1];
    return '';
}

/**
 * 落库输入（`importMusicRows` 逐条喂给 `service.create` / `service.update`）。
 *
 * ⚠️ 刻意**不含** `status`：用户库里的歌是「想听 / 在听 / 已听」由用户自己走流程改，
 *    落库只负责把客观元数据（歌名 / 歌手 / 专辑 / 封面 / 来源）填好。
 */
export interface MusicEntrySeed {
    type: 'music';
    title: string;
    /**
     * 歌手（⛔ 不叫 `artist`：`MediaEntry.artist` 是**漫画画师**专用，见 `data/types.ts:189-196`）。
     *
     * 🔴🔴 2026-11-14 用户指令（bug 修复）：原话「怎么音乐关联的音频文件没有重命名为：
     *    `{歌手} - {歌曲名}.{ext}`【比如骑在银龙的背上.mp3】」。
     *    根因是落库这条路径把歌手写进了 `artist`（画师槽），而**全仓其它地方都读 `author`**：
     *      · `pure/metaFields.ts:176` —— `{ key: 'author', appliesTo: ['book','music'],
     *        labelFor: { music: '艺术家' } }`（音乐的艺术家 = `author`）；
     *      · `pure/musicGroup.ts:32` —— 音乐页签按歌手分组用 `e.author?.trim()`；
     *      · `views/components/EntryForm.svelte:2147` —— 选中音乐结果时 `author = r.artist`；
     *      · `pure/cardMeta.audioSubtitle/cardCreator` —— 播放器副行与卡片创作者行都读 `e.author`。
     *    ⇒ 写进 `artist` 的歌，在分组/卡片/播放器/改名**四处都看不到歌手**，只剩歌名。
     * ⚠️ 改键名是 append-only 的安全方向（旧数据里 `artist` 上的歌手由读侧兼容，
     *    见 `pure/musicArtist` 的兜底），⛔ 别把两个键都写 —— 那是双写脏数据。
     */
    author?: string;
    album?: string;
    poster?: string;
    source: MusicPlatform;
    sourceName: string;
    sourceUrl: string;
}

/**
 * 一首歌 → 条目字段。**唯一映射真源**（⛔ 别在 `importMusicRows` 里再手写一遍，
 * 本仓 `importSteamRows` 与 `syncSteamNow` 各写一份映射就漏过字段，用户报过障）。
 *
 * 缺失即不写（`artist` 空 ⇒ 不落空串、`album` 空 ⇒ 不落空串）——
 * `normalizeEntry` 里 `album` 有「过滤空串」的判据，但 `artist` 只判 `isString`
 * ⇒ 这里写空串会真的落一个 `''` 进去，表单上看着像「填过又删了」。
 */
export function musicEntrySeed(song: DownloadSong): MusicEntrySeed | null {
    const src = song?.source;
    if (!isMusicPlatform(src)) return null;
    const title = String(song?.name ?? '').trim();
    if (!title) return null;
    const sourceUrl = String(song?.webUrl ?? '').trim();
    const artist = String(song?.artist ?? '').trim();
    const album = String(song?.album ?? '').trim();
    // 封面走 #509 的唯一真源：酷我必须用 `albumPicPath`（它的 `coverUrl` 是横的 MV 图），
    // 其余三平台按各自的尺寸改写规则抬到最大 —— 全在 `platformCoverUrl` 里，⛔ 本文件不拼 URL。
    const poster = String(platformCoverUrl(src, song) ?? '').trim();
    const seed: MusicEntrySeed = {
        type: 'music',
        // 歌名是平台的客观数据。⚠️ 覆盖已存在条目时**不要**用 seed 里的 title 覆盖用户改过的标题
        //    （用户可能把「晴天」改成「晴天 (2003 现场版)」）—— 那条判断在 `importMusicRows` 里做。
        title,
        source: src,
        sourceName: MUSIC_PLATFORM_LABELS[src],
        sourceUrl,
    };
    if (artist) seed.author = artist;
    if (album) seed.album = album;
    if (poster) seed.poster = poster;
    return seed;
}

/**
 * 曲库结果的最小结构（`MusicSearchResult` 满足它）。
 *
 * 🔴 为什么不用 `MusicSearchResult` 当形参类型：本模块的两个入口（`musicSeedFromResult` /
 *    `musicIdFromResult`）会被宿主拿 `SearchResult`（**联合类型**）直接调 —— 那时 tsc 无法窄化，
 *    会报 `GameSearchResult` 不能赋给 `MusicSearchResult`（`id: number` vs `string`）。
 *    ⇒ 收成结构子集：只要这几个字段，联合类型里每一个成员都结构兼容。
 * ⚠️ `id` 收 `string | number`：曲库结果是 `songlib:…` 字符串，其它源可能是数字。
 */
export interface MusicResultLike {
    id?: string | number;
    title?: string;
    artist?: string;
    album?: string;
    cover?: string;
    sourceUrl?: string;
}

/**
 * 搜索结果卡片（`MusicSearchResult`）→ 条目字段。**卡片入库按钮唯一入口**。
 *
 * 🔴 为什么不能直接复用 `musicEntrySeed`：卡片手里**没有 `DownloadSong`** ——
 *    `pure/songLibrary.songLibraryResults` 把四平台歌曲压成了 `MusicSearchResult`，
 *    平台与平台内 id 只剩在 `id` 这段字符串里：`songlib:{source}:{id}`。
 *    所以这里反解，而不是让卡片为了建一条条目再去发一次搜索。
 *
 * 🔴 **封面直接取 `r.cover`，⛔ 不再过 `platformCoverUrl`**：
 *    结果里的 `cover` 已经是 `songLibrary` 用 `platformCoverUrl` 改写过的**最终图 URL**
 *    （QQ 已抬到 1500、酷狗尺寸段已删、酷我已换成专辑图）。再跑一次不但多余，
 *    而且酷我在这一步会拿到 `''` —— 结果里没有 `albumPicPath`，再改写只会把封面抹掉。
 *
 * ⚠️ `sourceUrl` 取 `r.sourceUrl`（平台歌曲页）。它也是**下次判「库里已有」的钥匙**
 *    （`musicKeyFromEntry` 从它反解 id）⇒ 空 `sourceUrl` 的条目将来会被重复导入，
 *    但那种条目本来就点不开直达，仍然落库、不拦（⛔ 别为了「可判重」把用户能看的歌丢掉）。
 */
export function musicSeedFromResult(r: MusicResultLike | null | undefined): MusicEntrySeed | null {
    const id = String(r?.id ?? '').trim();
    // `${SONG_LIB_ID}:{source}:{id}` —— 只切两段：平台内 id 里万一有冒号（历史上没有）也不该被切坏
    // ⚠️ 前缀取 `SONG_LIB_ID` 常量而不是字面量：那个 id 只会在一处定义（#458 教训）
    const m = new RegExp(`^${SONG_LIB_ID}:([^:]+):(.+)$`).exec(id);
    if (!m) return null;
    const src = m[1];
    if (!isMusicPlatform(src)) return null;
    const title = String(r?.title ?? '').trim();
    if (!title) return null;
    const seed: MusicEntrySeed = {
        type: 'music',
        title,
        source: src,
        sourceName: MUSIC_PLATFORM_LABELS[src],
        sourceUrl: String(r?.sourceUrl ?? '').trim(),
    };
    const artist = String(r?.artist ?? '').trim();
    const album = String(r?.album ?? '').trim();
    const poster = String(r?.cover ?? '').trim();
    if (artist) seed.author = artist;
    if (album) seed.album = album;
    if (poster) seed.poster = poster;
    return seed;
}

/**
 * 从曲库结果反解**平台内 id**（`songlib:{平台}:{id}` 的最后一段）。
 *
 * 🔴 为什么单独拿出来：`musicEntrySeed.song` 有 `id`，而 `MusicEntrySeed` **刻意不含 id**
 *    （id 是「平台内编号」，不是条目字段）⇒ 单条落库要算判重键时，只能从卡片 id 反解。
 * ⚠️ 认不出回空串（此时 `musicItemKey` 也回空 ⇒ 那条只能靠同名保护拦，不会被误判成「库里已有」）。
 */
export function musicIdFromResult(r: MusicResultLike | null | undefined): string {
    const id = String(r?.id ?? '').trim();
    const m = new RegExp(`^${SONG_LIB_ID}:([^:]+):(.+)$`).exec(id);
    if (!m || !isMusicPlatform(m[1])) return '';
    return m[2];
}

/**
 * 批量去重（同一批候选里同一首歌只留第一条）。
 *
 * 弹窗「全选 → 入库」时四平台会各给一份同一首歌 ⇒ 不去重会一口气建四条一模一样的条目。
 * ⚠️ 按判重键（来源 id）去重，**⛔ 不按标题** —— 同名不同歌手是两首歌（
 *    `pure/songLibrary` 卡片的去重也踩过这条：它按「歌名 + 歌手」判，因为卡片不显示平台名；
 *    落库不一样，落库有 `source`，同一首歌在酷我和网易云是两个**不同**的条目来源。
 *    所以这里只丢「同一平台同一 id」的重复，跨平台各留一条）。
 */
export function dedupeMusicSongs(songs: readonly DownloadSong[]): DownloadSong[] {
    const seen = new Set<string>();
    const out: DownloadSong[] = [];
    for (const s of songs ?? []) {
        // ⚠️ 先判平台键：`musicItemKey` 只要求两段非空，`music:douban:1` 也会拼出来 ——
        //    但那种条目 `musicEntrySeed` 会回 null，留在这里会「去重后又被丢掉」，计数对不上。
        if (!isMusicPlatform(s?.source)) continue;
        const key = musicItemKey(s?.source, s?.id);
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

/**
 * 把「库里已有」的条目索引成 `判重键 → 条目 id`。
 *
 * 宿主落库前一次性建好（与 `importSteamRows` 的 `byKey` 同款），循环里 O(1) 查。
 */
export function indexMusicEntries(
    entries: readonly (Pick<MediaEntry, 'id' | 'source' | 'sourceUrl'> & { type?: string })[],
): Map<string, string> {
    const byKey = new Map<string, string>();
    for (const e of entries ?? []) {
        if (e?.type && e.type !== 'music') continue;
        const key = musicKeyFromEntry(e);
        if (!key) continue;
        // 先到先得：库里真有两条同曲目（历史手工重复）时，覆盖第一条就好，⛔ 不要来回覆盖
        if (!byKey.has(key)) byKey.set(key, e.id);
    }
    return byKey;
}

/**
 * 「库里已有这首、但它是个**没有平台键**的老条目」——可否把它认领成同一条曲目。
 *
 * 🔴 为什么需要这个判断（2026-11-09 阶段 C 真机核对发现，⛔ 别当成可选优化）：
 *    本仓音乐条目的主流来源是**豆瓣**（用户库里 17 首音乐有 16 首是 `source: douban`、
 *    `sourceUrl` 指向 `music.douban.com/subject/…`）。这类条目的「来源 id」是豆瓣 subject id，
 *    与 `music:{平台}:{id}` 永远对不上 ⇒ `indexMusicEntries` **一条都认不出来**，
 *    判重只能落到 `findTitleConflict` 的「同名 ⇒ 跳过」。
 *    实测后果：从网易云同步《七里香》，会因为库里已有豆瓣的《七里香》而**被当成同名冲突跳过**，
 *    整个清单同步对这类用户**一首也进不来**。
 *
 * 所以：**同名 + 同类 + 库内那条没有平台键**（`musicKeyFromEntry` 为空 ⇒ 它不属于任何音乐平台）
 * 且**歌手不冲突**时，视为同一首歌 —— 由调用方走「覆盖」分支，只补平台字段（`source` /
 * `sourceName` / `sourceUrl` / `poster`），⛔ 不改标题、⛔ 不动用户记录。
 *
 * 三条收紧（少一条就会误吞用户的收藏）：
 *  ⑴ 库内那条**必须没有平台键** —— 若它已经是「网易云:某 id」，那是另一首歌，同名也不能认领；
 *  ⑵ `artist` 双方都有值时必须**归一后相等** —— 同名不同歌手（《海阔天空》BEYOND / 黄家驹 各有版本）
 *     是真两首，认领了就丢一首；
 *  ⑶ 只在 `type === 'music'` 上谈认领（调用方已按类型过滤，这里再判一次防误用）。
 *
 * ⚠️ 认领**不等于**「随便覆盖」：调用方仍须保留用户字段（笔记 / 标签 / 评分 / 音频路径 / 收听时长），
 *    本条只回答「该不该把它当成同一条」，回答不了「覆盖哪些字段」。
 *
 * @param existing      库内既有条目（至少要 `id` / `type` / `title`，带上 `source` / `sourceUrl` / `author`）
 * @param title         本次要落库的歌名
 * @param artist        本次要落库的歌手（可空）
 * @returns 可认领的库内条目 id；不该认领则 `''`
 */
export function adoptableMusicEntryId(
    existing: readonly (Pick<MediaEntry, 'id' | 'title'> & {
        type?: string;
        source?: string;
        sourceUrl?: string;
        /** 歌手（⛔ 不是 `artist` —— 那是漫画画师，见 `pure/musicArtist` 的长注释） */
        author?: string;
        bookKind?: string;
        /** 2026-11-14 之前的老数据曾把歌手写在这里，`musicArtistOf` 会兜底认它 */
        artist?: string;
    })[],
    title: string,
    artist?: string,
): string {
    const wantTitle = normalizeTitleForMatch(String(title ?? ''));
    if (!wantTitle) return '';
    const wantArtist = normalizeTitleForMatch(String(artist ?? ''));
    for (const e of existing ?? []) {
        if (e?.type && e.type !== 'music') continue;
        if (!e?.id) continue;
        // ⑴ 已经是某个音乐平台的条目 ⇒ 那是另一首歌，同名也不认领
        if (musicKeyFromEntry(e)) continue;
        if (normalizeTitleForMatch(String(e.title ?? '')) !== wantTitle) continue;
        // ⑵ 双方都有歌手时必须一致；一方缺失 ⇒ 放行（豆瓣条目常缺歌手，卡死等于不认领）
        //    读侧走 `musicArtistOf`：它会认 `author`，也会兜底认老数据写在 `artist` 上的歌手。
        const haveArtist = normalizeTitleForMatch(musicArtistOf(e));
        if (wantArtist && haveArtist && wantArtist !== haveArtist) continue;
        return e.id;
    }
    return '';
}

/**
 * 认领时**只允许补**的平台字段白名单（⛔ 不是「要覆盖的字段」，是「可以写的字段」）。
 *
 * 用户裁定「歌单只落单曲」时同步定的口径：同步只能带来**平台侧客观信息**，
 * 用户在豆瓣那条上积累的东西（标题 / 歌手 / 专辑 / 评分 / 标签 / 笔记 / 音频路径 / 收听时长）一律不动。
 * 为什么标题也不动：豆瓣标题可能是用户挑过的那个版本（「海阔天空 (Live)」），
 * 平台侧标题往往带「【MV】」「1080P」这类杂质 —— 覆盖了等于把用户的选择冲掉。
 */
export const MUSIC_ADOPT_FIELDS = ['source', 'sourceName', 'sourceUrl', 'poster'] as const;
