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
 */
export function songLibraryResults(songs: readonly DownloadSong[]): MusicSearchResult[] {
    const seen = new Set<string>();
    const out: MusicSearchResult[] = [];
    for (const s of songs ?? []) {
        const title = String(s?.name ?? '').trim();
        if (!title) continue;
        const artist = String(s?.artist ?? '').trim();
        const key = `${normKey(title)}\u0001${normKey(artist)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            id: `${SONG_LIB_ID}:${String(s.source ?? '')}:${String(s.id ?? '')}`,
            title,
            artist: artist || undefined,
            album: String(s?.album ?? '').trim() || undefined,
            // 直达 = 该平台这首歌的网页（缺 id 的平台没给 webUrl ⇒ undefined，徽标不显示直达）
            source: SONG_LIB_ID,
            sourceUrl: String(s?.webUrl ?? '').trim() || undefined,
        });
    }
    return out;
}
