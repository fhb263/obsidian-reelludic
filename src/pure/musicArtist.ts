/**
 * 「这条音乐的歌手是谁」—— **唯一真源**。
 *
 * 🔴🔴 2026-11-14 用户指令（bug 修复）：原话「怎么音乐关联的音频文件没有重命名为：
 *    `{歌手} - {歌曲名}.{ext}`【比如骑在银龙的背上.mp3】」。
 *
 * 根因不是规则写错，而是**歌手被存在了两个不同的字段里**，读的一侧读了错的那个：
 *
 *   · `data/types.ts:189-196` —— `artist` 是「**画师**（漫画的作画）」，注释明写
 *     「⚠️ **只有漫画会写**：表单只在漫画态渲染「画师」框，其余 bookKind 保存时显式清空」；
 *   · `pure/metaFields.ts:176` —— `{ key: 'author', appliesTo: ['book', 'music'],
 *     labelFor: { music: '艺术家' } }` ⇒ **音乐的歌手 = `author`**；
 *   · `pure/musicGroup.ts:32` —— 音乐页签按歌手分组读 `e.author?.trim()`；
 *   · `views/components/EntryForm.svelte:2147` —— 选中音乐搜索结果时 `author = r.artist`（把搜索结果的
 *     artist **搬进条目的 author**，名字相同、字段不同，这是最容易被误读成「同一个艺术家字段」的地方）；
 *   · `pure/cardMeta.audioSubtitle` / `cardCreator` —— 播放器副行与卡片创作者行都读 `e.author`。
 *
 * ⇒ 任何「按歌手」的读侧都必须走这里，⛔ 别再直接 `entry.artist`（那是画师）。
 */

import type { MediaEntry } from 'data/types';

/** 只取必要字段的结构子集（`MusicEntrySeed` / 测试夹具都能直接传）。 */
export interface MusicArtistLike {
    author?: string;
    artist?: string;
    /** 存在即说明这条是**书籍**（漫画画师才有 `artist`）⇒ 不要把它当歌手 */
    bookKind?: string;
}

/**
 * 取音乐条目的歌手名（已 `trim`；没有 ⇒ 空串）。
 *
 * 优先级：
 *  ⑴ `author` —— 正常路径，写入方是表单（`author = r.artist`）与 `pure/musicSync` 的落库种子；
 *  ⑵ `artist` 兜底 —— **只在这条不是书籍时**才认。理由：2026-11-14 之前 `musicSync` 把歌手写进了
 *     `artist`，老库里真有一批歌的歌手躺在那儿；不认就等于「历史数据永远显示不出歌手」，
 *     而认错的代价（把漫画画师当歌手）由 `bookKind` 这个判据挡掉了。
 */
export function musicArtistOf(entry: MusicArtistLike | null | undefined): string {
    if (!entry) return '';
    const byAuthor = String(entry.author ?? '').trim();
    if (byAuthor) return byAuthor;
    if (entry.bookKind) return '';
    return String(entry.artist ?? '').trim();
}
