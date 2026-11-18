/**
 * Flash 游戏存档的**导出备份文件**格式（① 的唯一判据真源）—— 纯逻辑，无 `obsidian` / 无 IO，可单测。
 *
 * ## 用户原话（逐字，2026-11-17）
 * 「单文件 SWF 有存档做独立目录（放 swf 入口 + sol 文件 / base64 字符串 / JSON 存档文件，
 *   存档是导出备份，**需通过导入功能恢复**）；
 *   多文件 SWF 做独立目录（含 swf），其下 `saves/` 放存档文件」
 *
 * ## 落地口径（用户二次裁定，⛔ 别自作主张扩范围）
 *   ① **运行期落点不动** —— 仍由 `pluginDir()/saves/<entryId>.json` 承担（那是插件自己的缓存，
 *      不进库、不被同步带上）。本模块只管**导出备份**这一件事。
 *   ② 导出产物是**单个 JSON 文件**（用户列的三种形态里 JSON 最好读、最好手改、最好排错；
 *      base64 与 .sol 二进制都不便于用户自己看懂哪里坏了）。
 *   ③ 导入必须是**显式动作**，⛔ 不做「打开游戏时自动扫 saves/ 目录并恢复」——
 *      那会让用户改坏一个备份文件就把游戏进度冲掉。
 *
 * ## 为什么要有 `kind` + `version` 两个字段
 *   导出文件会被用户改名、移动、甚至拿别的 JSON 来试。只有 `kind` 对得上的才认，
 *   否则「把 catalog 备份当存档导入」这种误操作会静默写进 localStorage，表现成
 *   「游戏打开后存档全没了但没报错」——这种失败最难查。
 */

/** 导出文件的身份标记（⛔ 改它等于让所有旧备份失效） */
export const GAME_SAVE_BUNDLE_KIND = 'reelludic-game-saves';

/** 导出文件格式版本（只追加不删；解析侧认 1） */
export const GAME_SAVE_BUNDLE_VERSION = 1;

/** 导出文件里的存档表：`SharedObject 名 → base64 内容`（与运行期落盘同形状） */
export type GameSaveMap = Record<string, string>;

/** `saves` 表里同一个键最多留多长 —— 防止有人手塞一个几十 MB 的串进来把内存吃光 */
export const GAME_SAVE_VALUE_MAX = 1_000_000;

/** 一个条目最多认多少条 SharedObject（4399 上的小游戏实测 1~3 条，超过这个数必是坏文件） */
export const GAME_SAVE_ENTRY_MAX = 64;

/** 导出文件的结构 */
export interface GameSaveBundle {
    kind: typeof GAME_SAVE_BUNDLE_KIND;
    version: number;
    /** 导出时刻（ISO 8601，只给人看，解析侧不依赖） */
    exportedAt: string;
    /** 条目 id / 标题（只给人看；导入时**不校验**——用户可能改名或换库重建条目） */
    entryId: string;
    title: string;
    /** 存档本体 */
    saves: GameSaveMap;
}

/**
 * 洗一遍存档表：只留 `非空字符串键 → 非空字符串值`，并裁掉超长/超量的条目。
 *
 * 与 `main.ts` 运行期落盘的过滤口径**刻意一致**（那边也是这个判据），
 * 否则会出现「导出文件里有、恢复后没有」的幽灵差异。
 */
export function cleanGameSaves(raw: unknown): GameSaveMap {
    const out: GameSaveMap = {};
    if (!raw || typeof raw !== 'object') return out;
    let n = 0;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (n >= GAME_SAVE_ENTRY_MAX) break;
        if (typeof k !== 'string' || k.length === 0) continue;
        if (typeof v !== 'string' || v.length === 0) continue;
        if (v.length > GAME_SAVE_VALUE_MAX) continue;
        out[k] = v;
        n += 1;
    }
    return out;
}

/**
 * 拼出导出文件的内容（JSON 字符串，带缩进——用户可能真要打开看一眼）。
 *
 * @param entryId 条目 id（写进文件只作标记）
 * @param title   条目标题（同上）
 * @param saves   存档表（会被 `cleanGameSaves` 洗一遍）
 * @param now     导出时刻；缺省取当前时间（测试可注入，避免用例依赖真实时钟）
 *
 * ⚠️ `saves` 洗完为空时仍返回合法文件（`saves: {}`）——
 *    调用方要判空就自己判 `Object.keys(...).length`，⛔ 别让本函数返回 `''` 那种「空串等于失败」的歧义。
 */
export function buildSaveBundle(entryId: string, title: string, saves: unknown, now?: Date): string {
    const bundle: GameSaveBundle = {
        kind: GAME_SAVE_BUNDLE_KIND,
        version: GAME_SAVE_BUNDLE_VERSION,
        exportedAt: (now ?? new Date()).toISOString(),
        entryId: String(entryId ?? ''),
        title: String(title ?? ''),
        saves: cleanGameSaves(saves),
    };
    return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** 解析结果：成功给存档表，失败给原因（调用方据此弹不同的提示，⛔ 不要只返回 undefined） */
export type GameSaveBundleParse =
    | { ok: true; saves: GameSaveMap; title: string; exportedAt: string }
    | { ok: false; reason: string };

/**
 * 解析导出文件。**永不抛** —— 用户手改坏的 JSON 只该得到一句人话原因。
 *
 * 校验顺序刻意如此：先身份（`kind`）→ 再版本 → 再结构 → 最后才洗数据。
 * 这样「导入错文件」与「文件坏了」得到的是两条不同的提示，用户才知道该换文件还是该修文件。
 */
export function parseSaveBundle(text: string): GameSaveBundleParse {
    const raw = String(text ?? '').trim();
    if (!raw) return { ok: false, reason: '文件是空的' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: '不是合法的 JSON（可能被改坏了）' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: '内容不是一个对象' };
    }
    const o = parsed as Record<string, unknown>;
    if (o.kind !== GAME_SAVE_BUNDLE_KIND) {
        return { ok: false, reason: '不是本插件的存档导出文件' };
    }
    const version = typeof o.version === 'number' ? o.version : 0;
    if (version !== GAME_SAVE_BUNDLE_VERSION) {
        return { ok: false, reason: `版本不认识（文件是 v${version}，本插件只认 v${GAME_SAVE_BUNDLE_VERSION}）` };
    }
    const saves = cleanGameSaves(o.saves);
    if (Object.keys(saves).length === 0) {
        return { ok: false, reason: '文件里没有存档内容' };
    }
    return {
        ok: true,
        saves,
        title: typeof o.title === 'string' ? o.title : '',
        exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
    };
}

/**
 * 导出文件的默认文件名（`<标题>-存档-<YYYYMMDD-HHmm>.json`）。
 *
 * ⚠️ 标题里可能有 `/` `:` `*` 这类在 Windows 上不能做文件名的字符 —— 必须洗掉，
 *    否则「另存为」对话框会直接拒绝或存成奇怪的名字。
 */
export function saveBundleFileName(title: string, now?: Date): string {
    const d = now ?? new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const safe = String(title ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    return `${safe || '游戏'}-存档-${stamp}.json`;
}
