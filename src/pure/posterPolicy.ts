/**
 * 重新拉取（refetch）时的封面采用策略。
 *
 * 背景（2026-09-10 用户反馈）：所有类型条目重新拉取元数据时，搜索结果会无条件用
 * 远程封面覆盖当前 poster；豆瓣封面随后又被下载本地化（封面/{标题}.jpg，重名追加
 * -2/-3），每次重新拉取都产生一个新文件 → 封面目录堆积重复文件。
 *
 * 规则：本地封面（非 http 路径，如 封面/xxx.jpg）视为「已有资产」——自动回填不得覆盖；
 * 仅当前封面为空或本身就是远程 URL 时才采用新封面。手动动作（封面 URL 输入框、拖图
 * 上传、清除封面）不受此限，始终是显式覆盖。
 */

/**
 * 重新拉取时是否采用远程封面：当前封面为空或为远程 URL 时采用；已本地化则保留。
 *
 * 🔴 返回类型是**类型谓词**（`incoming is string`），不是 `boolean`：调用方普遍写成
 *   `if (shouldAdoptCover(poster, r.cover)) poster = r.cover;`
 *   —— 谓词让 TS 在 if 体内把 `r.cover` 收窄成 `string`，否则每个可选字段都要自己
 *   补 `?? ''` 或非空断言。⛔ 别改回 `boolean`（会让 EntryForm 里 6 处赋值重新报
 *   `Type 'string | undefined' is not assignable to type 'string'`，而 tsc 看不见 .svelte）。
 */
export function shouldAdoptCover(current: string | undefined, incoming: string | null | undefined): incoming is string {
    if (!incoming) return false;
    if (current && !/^https?:\/\//i.test(current)) return false; // 本地封面（封面/xxx.jpg 等）→ 保留
    return true;
}
