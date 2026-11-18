// Steam 竖版封面图床 —— **唯一真源**（纯逻辑：零 obsidian / 零网络 / 零 DOM）。
//
// 🔴 2026-11-08 收口由来：同一个 URL 模板在 4 个地方各写了一遍
//    （`services/steam.ts` 的 `COVER_IMAGE_BASE`、`pure/steamSync.ts` 的 `steamCoverUrl`、
//      `pure/searchDisplay.ts` 的 gameView、`modals/SteamSyncModal.ts` 的愿望单行 img）。
//    其中 `pure/steamSync.ts` 的注释还自称「**两处**必须同值」—— 实际早就变成四处，
//    注释自己先失真了。封面是**用户第一个看见的东西**，一处改了三处没改，就是贴图 404。
//
// ⚠️ 为什么单独开一个小文件，而不是塞进 `pure/steamSync`：
//    `searchDisplay` 与 `SteamSyncModal` 只需要这一个函数；从 `pure/steamSync` 拿会把
//    整个同步逻辑（解析、判据、收敛）一起拖进依赖图。**只为一根常量付整包代价**没必要。
//
// ⛔ 图床口径（改之前先读）：竖版 `library_600x900.jpg`，不是 32×32 的 `img_icon_url`
//    —— 后者贴海报墙会糊成一团。路径以 appid 拼，不随响应字段变化。

/** 竖版封面图床基址 */
export const STEAM_COVER_BASE = 'https://cdn.cloudflare.steamstatic.com/steam/apps';

/** 商店竖版封面（`library_600x900.jpg`）*/
export function steamCoverUrl(appid: number): string {
    return `${STEAM_COVER_BASE}/${appid}/library_600x900.jpg`;
}
