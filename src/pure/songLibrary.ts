// 在线曲库（歌曲检索）——音乐类型搜索结果里的**歌曲栏**（#464）
//
// 🔴 起因（用户 2026-10-01）：「豆瓣源搜作者，为什么不出现对应的音乐或其他条目？」
//    取证结论：**豆瓣音乐搜索只按「专辑名」匹配，不认歌手字段**（`j/search?cat=1003`）——
//      · 搜 `BEYOND` → 20 条全是**别人**叫《Beyond》的专辑，乐队自己的《光辉岁月》/《乐与怒》
//        **根本不在这 20 条里**（`total=3000` 也都是标题匹配，翻页翻不到）；
//      · 中文歌手常碰巧能出（豆瓣不少专辑标题带歌手名前缀「邓丽君:夜来香」）⇒ 这条一直没暴露；
//      · 豆瓣**没有**可用的「歌手 → 唱片」接口（音乐人页 301→302 跳去「小站」，内容还是错的）。
//    而「按歌手找他的流行曲」这件事实测只有**在线曲库**能干：四平台搜歌搜的是「歌名 + 歌手」，
//    搜 `BEYOND` 直接出《海阔天空》《光辉岁月》《真的爱你》《不再犹豫》《冷雨夜》《灰色轨迹》…
//    ⇒ 本模块 = 把 `services/dl`（**「下载歌曲」窗口用的同一条链**）的歌曲结果，映射成搜索结果卡片。
//
// 🔴 三条边界（⛔ 别越界）：
//  ⑴ **不是数据源**：不进 `pure/sourceRegistry` 的 PROVIDERS（也就不进设置页勾选 / 不进 `sourceChains`）。
//     它是「曲库检索」，与元数据源是两回事；栏位由表单按「音乐态 + 可下载」直接挂（见 `SONG_LIB_ID` 的用法）。
//  ⑵ **不自己发请求**：数据一律来自 `main.dlSearchSongs`（与下载窗口同一个函数、同一份平台顺序），
//     ⛔ 别在这里另拼一份四平台请求。
//  ⑶ **只做映射**：不发请求、不落盘、不缓存（纯函数，可单测）。
//
// ⚠️ 类型用 `import type` 从 `services/dl` 取（编译期擦除 ⇒ 纯模块不会把服务层拖进单测）。
import type { DownloadSong } from 'services/dl';
import type { MusicSearchResult } from 'services/resultTypes';
// 封面 URL 的**唯一真源**（#509 建）：四平台的尺寸改写规则、酷我的专辑图改写全在那里。
// ⚠️ 这里只是**调用**它，⛔ 别把图床域名拼进本文件（`assert-symbols` 的 #464 守卫明令本文件不得出现 URL）。
import { platformCoverUrl } from 'pure/posterSources';
// 平台名（网易云 / QQ音乐 / 酷狗 / 酷我）—— 叶子模块，⛔ 不 import `pure/musicSync`（那会循环依赖）。
import { musicPlatformLabel } from 'pure/musicPlatform';
// 发行日期 → 年份归一（`publishYearOf`）。⚠️ 只 import 这一个函数：`pure/dl/utils` 是零依赖叶子模块，
// 把它拖进来不会成环（同样的用法见 `pure/lyricOnline` 与 `pure/dl/qq|kugou`）。
import { publishYearOf } from 'pure/dl/utils';

/**
 * 「在线曲库」的**栏 id + 结果 source**（一个常量两处用：结果区按它建栏、结果按它归栏）。
 * 🔴 #458 的教训：栏位与结果必须同一个口径 —— 结果打了某个 source 却没有对应的栏，
 *    那批结果会被**整批丢掉**（漫画那批就是这么不显示的）。所以这个 id 只在这里定义一次。
 */
export const SONG_LIB_ID = 'songlib';

/** 展示名（列头 / 来源徽标 / 头部「数据源：」列表 / 自动回填的「来源」框 —— 全都取这一份） */
export const SONG_LIB_LABEL = '在线曲库';

/** 归一（小写 + 去空白与常见分隔符）：只用于**同名去重**，不参与打分 */
function normKey(s: string): string {
    return String(s ?? '')
        .toLowerCase()
        .replace(/[\s._\-—–·・、，,。．:：;；!！?？'"\/\\()（）[\]【】{}<>《》]/g, '');
}

/**
 * 四平台歌曲 → 音乐搜索结果卡片。
 *
 * 🔴 三条口径：
 *  ⑴ **`album` 键必须存在**（哪怕值是 `undefined`）—— 表单 `pick()` 是用 `'album' in r` 判「音乐形状」的，
 *     少这个键会被当成影视结果（回填错分支）。
 *  ⑵ **同「歌名 + 歌手」去重**（保留平台顺序里的第一条）：同一个歌四平台各来一份，卡片长得一模一样
 *     （本栏不显示平台名），四份重复纯属噪音。要**挑平台**去「下载歌曲」窗口 —— 那里有平台标注与试听。
 *     ⚠️ 只按「歌名 + 歌手」判重、**不按歌名单独判** —— 同名不同歌手是两首歌。
 *  ⑶ 空歌名条目直接丢（各平台偶有解析出空名的条目）。
 *
 * 🔴 2026-11-09 第 15 轮补「搜索元数据」（用户：「给三大音乐平台加搜索元数据的功能」）：
 *  ⑷ **封面**：`DownloadSong.coverUrl`（酷我走 `albumPicPath` 专辑图）→ `cover`，改写规则全在
 *     `pure/posterSources.platformCoverUrl`，本文件只调用、⛔ 不拼 URL（#464 守卫）。
 *  ⑸ **时长**：`DownloadSong.duration`（秒）→ `duration`，原样透传、⛔ 不在这里格式化。
 *  ⑹ **网易云封面是补拉来的**：它的搜索响应一条封面都不带（`pure/posterSources.ts:12` 实测记录），
 *     由调用方先 `await neteaseCoversByIds(...)` 再经 `covers` 传进来。
 *     ⚠️ **本函数保持同步纯函数** —— 三条调用链（表单结果栏 / 播放候选 / 封面搜索）都在用，
 *     改 async 会逼三处全变，收益为零。
 */
export function songLibraryResults(
    songs: readonly DownloadSong[],
    /**
     * 网易云补拉的封面（songid → 大图 URL）。只对 `source === 'netease'` 且自身没带封面时生效 ——
     * 平台自己给了图就以平台为准（那是它选的那张，补拉的是另一条请求的答案）。
     */
    covers?: ReadonlyMap<number, string>,
): MusicSearchResult[] {
    const seen = new Set<string>();
    const out: MusicSearchResult[] = [];
    for (const s of songs ?? []) {
        const title = String(s?.name ?? '').trim();
        if (!title) continue;
        const artist = String(s?.artist ?? '').trim();
        const key = `${normKey(title)}\u0001${normKey(artist)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // 平台自查封面；网易云自查为空时用补拉结果兜底（⛔ 反过来不行：补拉那张不一定是他选的那张）
        const ownCover = s?.source ? String(platformCoverUrl(s.source, s) ?? '').trim() : '';
        const extraCover = s?.source === 'netease' && s?.neteaseId != null
            ? String(covers?.get(s.neteaseId) ?? '').trim()
            : '';
        // 🔴 2026-11-09 第 15 轮（用户：「在线曲库也要显示来源平台名」）：
        //    曲库栏把四平台压成了一栏，卡片只写「在线曲库」用户分不清哪首是哪家的 ⇒ 带平台名。
        //    `source` 仍是 `SONG_LIB_ID`（栏位归属，不可改），平台名单开一个键。
        // ⚠️ 有值才写键（不是 `|| undefined`）：本仓反复踩过的「空 vs 缺」——
        //    写 `platform: undefined` 时 `hasOwnProperty('platform')` 仍为真，
        //    下游「有没有这个键」的判据就分不清「平台认不出」和「字段没产出」。
        const platform = musicPlatformLabel(s?.source);
        const item: MusicSearchResult = {
            id: `${SONG_LIB_ID}:${String(s.source ?? '')}:${String(s.id ?? '')}`,
            title,
            artist: artist || undefined,
            album: String(s?.album ?? '').trim() || undefined,
            // 时长秒数原样透传；非法值（0 / 负数 / NaN）不写 —— 卡片据此决定画不画那一段
            duration: Number.isFinite(s?.duration) && (s.duration as number) > 0 ? s.duration : undefined,
            cover: ownCover || extraCover || undefined,
            // 直达 = 该平台这首歌的网页（缺 id 的平台没给 webUrl ⇒ undefined，徽标不显示直达）
            source: SONG_LIB_ID,
            sourceUrl: String(s?.webUrl ?? '').trim() || undefined,
        };
        if (platform) item.platformLabel = platform;
        // 🔴 m19924 ②（用户逐字：「网易云那个热度值毫无用处，不要展示了删除掉」）：
        //    这里原本会把网易云搜索级的 `pop`（热度 0~100）写进 `reviewPercent`，
        //    卡片上渲染成「100%」看着像评分，其实是播放热度 —— **已整块删除**。
        //    ⛔ 不要改成写别的字段（`rating` 也不行：那是「大众评分」，热度不是评分）；
        //    ⛔ 也不要顺手删掉 `reviewPercent` 字段本身 —— Steam 好评率还在用它
        //       （`services/steam.ts` 的 histogram 百分比），删字段会把 Steam 分数一起弄丢。
        // 🔴 m12958（用户：「从三大平台搜索或同步得到的条目没有发行年、题材、简介」）：
        //    ① **发行年**：搜索级本来就带日期（QQ `pubtime` / 酷狗 `PublishDate` / 网易云 `publishTime`），
        //       只是这条映射链没往下传 ⇒ 这里补上。⛔ 别直接塞 `publishDate` 字符串：
        //       卡片/表单的「发行年」只要 4 位数字，走 `publishYearOf` 归一。
        //    ② **专辑键**：题材与简介要再打一次「专辑详情」，而那接口要的是专辑键
        //       （QQ `albummid` / 酷狗 `AlbumID`）。这里只透传，真补拉在 `services/dl.albumMetaFor`。
        //    ⚠️ 两者都是「有值才写键」—— 本仓反复踩过的「空 vs 缺」：
        //       写 `albumKey: undefined` 时 `'albumKey' in r` 仍为真，下游分不清「没产出」和「产出为空」。
        const year = publishYearOf(s?.publishDate);
        if (year != null) item.year = year;
        const albumKey = String(s?.albumKey ?? '').trim();
        if (albumKey) item.albumKey = albumKey;
        out.push(item);
    }
    return out;
}
