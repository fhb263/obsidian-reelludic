// 音乐平台键与展示名 —— **单一真源**（纯常量 + 纯判定，不 import 任何模块）。
//
// 🔴 为什么单独一个文件（2026-11-09 第 15 轮，用户：「在线曲库也要显示来源平台名」）：
//    这三样东西现在有两个消费方 ——
//     · `pure/musicSync`（落库时写 `MediaEntry.source` / `sourceName`）
//     · `pure/songLibrary`（结果卡片要显示平台名）
//    而 `musicSync` 已经 import 了 `songLibrary` 的 `SONG_LIB_ID` ⇒ 若把常量留在 `musicSync` 里，
//    `songLibrary` 反向 import 就成了**循环依赖**（rollup 会在构建时报循环，且运行期取到 undefined）。
//    ⇒ 抽到这个叶子模块，两边都 import 它，谁都不 import 谁。
//
// ⚠️ 与元数据源的 `ProviderId`（douban / tmdb / …）是**两套不同的枚举**：
//    那套回答「去哪搜元数据」，这套回答「这首歌来自哪个音乐平台」。
//    ⛔ 别把 `netease` 塞进 `sourceRegistry` 的 PROVIDERS（它没有搜索链）。
// ⚠️ 与 `pure/posterSources.POSTER_SOURCE_LABELS` 文案同值但**职责不同**（那是「封面搜索胶囊」的档位名），
//    刻意没合并：合并会让「封面来源」与「条目来源」耦合，将来加平台要同时改两处语义。

/** 四平台键（顺序 = 下载链路 `DL_PLATFORMS` 的前四项，⛔ 改动前先看那边） */
export const MUSIC_PLATFORMS = ['netease', 'qq', 'kugou', 'kuwo'] as const;

/** 音乐平台键 */
export type MusicPlatform = (typeof MUSIC_PLATFORMS)[number];

/**
 * 平台展示名。
 *
 * 🔴 落库时必须**显式写进 `MediaEntry.sourceName`**：`pure/sourceRegistry` 的
 *    `providerFromUrl` / `sourceLabel` 只认 `PROVIDERS` 里的元数据源，音乐四平台不在其中
 *    ⇒ 只写 `source` 时来源角标会**整块空白**。
 */
export const MUSIC_PLATFORM_LABELS: Record<MusicPlatform, string> = {
    netease: '网易云',
    qq: 'QQ音乐',
    kugou: '酷狗',
    kuwo: '酷我',
};

/** 是否音乐平台键（非法值一律 false，⛔ 不抛错也不兜底成第一个） */
export function isMusicPlatform(v: unknown): v is MusicPlatform {
    return typeof v === 'string' && (MUSIC_PLATFORMS as readonly string[]).includes(v);
}

/** 平台名（认不出回空串 —— 角标退化为纯数值，⛔ 绝不把 `undefined` 画到封面上） */
export function musicPlatformLabel(v: unknown): string {
    return isMusicPlatform(v) ? MUSIC_PLATFORM_LABELS[v] : '';
}
