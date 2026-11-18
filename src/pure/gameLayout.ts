/**
 * SWF 载体目录约定（2026-11-17 用户裁定，① 的唯一判据真源）—— 纯逻辑，无 `obsidian` / 无 IO，可单测。
 *
 * ## 用户原话（逐字）
 * 「单文件无存档 SWF 直接放 `games/swf/` 统一管理，条目关联对应 `.swf`；单文件 SWF 有存档做独立目录
 *   （放 swf 入口 + sol 文件 / base64 字符串 / JSON 存档文件，存档是导出备份，需通过导入功能恢复）；
 *   多文件 SWF 做独立目录（含 swf），其下 `saves/` 放存档文件」
 *
 * ## 落地口径（用户 2026-11-17 二次裁定，⛔ 别自作主张扩范围）
 *   ① **「游戏目录」设置项原样保留** —— 约定的是它**内部**的分层，不是换根目录、不迁移老库。
 *      老库里的 `<游戏目录>/<游戏名>/` 仍然能播（`gameSwf` 存的是文档内相对路径，与分层无关）。
 *   ② **存档落点不动** —— 仍是 `pluginDir()/saves/<entryId>.json`（运行期产物不进库，免得被同步/备份
 *      带上）。本条只让**导出/导入**能落到「独立目录/saves/」，即用户说的
 *      「存档是导出备份，需通过导入功能恢复」。
 *   ③ H5 内嵌与 OAuth 2.0 PKCE **本轮不做**（用户明示「先不做 H5 登录，只落 SWF 目录约定」）。
 *
 * ## 为什么分层要按「有没有存档 / 是不是多文件」而不是一刀切
 *   单文件无存档的游戏占绝大多数（4399 上抓下来的 `黄金矿工.swf` 就一个文件）。
 *   给每个这样的游戏都建一个只装一个文件的目录，只会让 `游戏目录` 下几百个单文件目录难以浏览；
 *   反过来，**多文件**（主影片 + `sounds/bgm.mp3` 等同名资源）和**有存档**的条目又必须有独占目录 ——
 *   前者防止两个游戏都引用 `sounds/bgm.mp3` 时互相覆盖，后者让存档备份有一个天然的同居位置。
 */

/** 单文件无存档 SWF 的统一平铺区（`<游戏目录>/swf/`） */
export const GAME_SWF_SUBDIR = 'swf';

/** 独立目录下的存档备份子目录（`<游戏目录>/<游戏名>/saves/`） */
export const GAME_SAVES_SUBDIR = 'saves';

/**
 * 载体布局：
 *   · `swf-flat` —— 单文件、无存档 ⇒ 落 `<游戏目录>/swf/<游戏名>.swf`，多个游戏共用一间。
 *   · `bundle`   —— 多文件**或**有存档 ⇒ 落 `<游戏目录>/<游戏名>/`，主影片 + 关联资源 +
 *                    `saves/` 都归这一个目录独占。
 */
export type GameCarrierLayout = 'swf-flat' | 'bundle';

/** 判定布局要的输入（全部来自调用方已经知道的证据，⛔ 不要在这里反查 vault） */
export interface GameCarrierFacts {
    /** 是否是多文件载体（主影片旁边还有关联资源，或已存在同名的独立目录） */
    multiFile: boolean;
    /** 这个条目是否已经有存档（`pluginDir()/saves/<entryId>.json` 非空） */
    hasSaves: boolean;
}

/**
 * 选布局。
 *
 * 判据只有两条，**「有存档」优先于「单文件」**：一个单文件游戏一旦玩出了存档，
 * 它就需要一个能同时放影片和备份的位置；否则存档备份要么散落、要么只能留在插件目录里，
 * 与用户「独立目录里放 swf 入口 + 存档」的约定不符。
 */
export function gameCarrierLayout(facts: GameCarrierFacts): GameCarrierLayout {
    return facts.multiFile || facts.hasSaves ? 'bundle' : 'swf-flat';
}

/**
 * 拼出「主影片应该落在哪个目录」（库内相对路径，不带文件名、不带尾斜杠）。
 *
 * @param baseDir  「游戏目录」设置项解析出的库内相对路径（`downloadDir(settings.gameDownloadDir, 'flash')`）
 * @param gameName 条目标题（已由调用方 `sanitizeDownloadName` 洗过；空串表示拿不到条目名）
 * @param layout   `gameCarrierLayout()` 的结果
 *
 * ⚠️ 拿不到条目名（`gameName` 为空）时**一律退回 baseDir 本身**，⛔ 不要退回 `baseDir/swf`：
 *    那时文件名也只能从 URL 末段取（`04.swf`），多条这样的游戏全挤进 `swf/` 会立刻互相顶掉。
 */
export function gameCarrierDir(
    baseDir: string,
    gameName: string,
    layout: GameCarrierLayout,
): string {
    const base = String(baseDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const name = String(gameName ?? '').trim();
    if (!name) return base;
    return layout === 'bundle' ? `${base}/${name}` : `${base}/${GAME_SWF_SUBDIR}`;
}

/**
 * 独立目录下的存档备份目录（`<bundleDir>/saves`）。
 *
 * ⚠️ 只有 `bundle` 布局有这个概念；`swf-flat` 的条目一旦有了存档，
 *    `gameCarrierLayout()` 就会把它判成 `bundle` —— 所以这里不需要处理平铺分支。
 */
export function gameBundleSavesDir(bundleDir: string): string {
    const dir = String(bundleDir ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    return dir ? `${dir}/${GAME_SAVES_SUBDIR}` : `${GAME_SAVES_SUBDIR}`;
}

/**
 * 从「主影片的库内相对路径」反推它所在的**独立目录**（`<游戏目录>/<游戏名>`）。
 *
 * 用途：图片/音频/`saves/` 这类附属物都要落在主影片的**同级或子级**，
 * 而调用方手上只有 `entry.gameSwf`（形如 `下载/Flash 游戏/黄金矿工/黄金矿工.swf`）。
 *
 * ⚠️ 平铺区的影片（`<游戏目录>/swf/x.swf`）也会返回 `<游戏目录>/swf` —— 它是「影片所在目录」，
 *    不是「独立目录」，判断是否在平铺区要用 `isInSwfFlatDir()`，⛔ 别用这个函数的返回值去猜。
 */
export function dirOfSwf(swfRelPath: string): string {
    const p = String(swfRelPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const cut = p.lastIndexOf('/');
    return cut > 0 ? p.slice(0, cut) : '';
}

/**
 * 这个影片是不是躺在**平铺区**里（`<任意>/swf/<name>.swf`）。
 *
 * 判据只看**父目录名**是不是 `swf` —— 刻意不要求完整前缀匹配：
 * `游戏目录` 设置项可以被用户改到任意位置（`我的库/小游戏`），把它拼进判据只会在改设置后失效。
 */
export function isInSwfFlatDir(swfRelPath: string): boolean {
    const dir = dirOfSwf(swfRelPath);
    if (!dir) return false;
    const name = dir.slice(dir.lastIndexOf('/') + 1);
    return name === GAME_SWF_SUBDIR;
}

/**
 * 这个影片是不是躺在一个**独立目录**里（即父目录不是平铺区 `swf/`）。
 *
 * 用途：多文件判定。影片在独立目录 ⇒ 关联资源天然落在同一目录，属于多文件载体。
 * ⚠️ 单文件条目被「升级」成独立目录后，这里恒为 true —— 升级是单向的（见 `shouldUpgradeToBundle`）。
 */
export function isInBundleDir(swfRelPath: string): boolean {
    const dir = dirOfSwf(swfRelPath);
    return dir !== '' && !isInSwfFlatDir(swfRelPath);
}

/**
 * 下载完成后，是否该把这批文件从平铺区**升级**到独立目录。
 *
 * 唯一触发条件：补到了关联资源（`assetCount > 0`）—— 那正是「多文件 SWF」的定义。
 * ⛔ 不要因为「有存档」在这里返回 true：存档是**玩过之后**才出现的，而本函数跑在下载流程里，
 *    那个时刻的存档状态是上一轮的（要触发也应该在加载存档时判，见 `gameCarrierLayout`）。
 */
export function shouldUpgradeToBundle(assetCount: number): boolean {
    return Number.isFinite(assetCount) && assetCount > 0;
}
