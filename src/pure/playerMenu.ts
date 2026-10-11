/**
 * 内置播放器浮层菜单纯逻辑（无 obsidian / DOM 依赖，可单测）
 *
 * 为什么单独抽出来：2026-09-18 按 B 站控制条口径改造后，选集 / 倍速 / 设置三类浮层
 * 共用同一个容器与同一套开合规则，最容易出错的又恰恰是「选项列表怎么算」与「点开/点关/切换」——
 * 这些放进 pure 层用单测钉住，UI 层只做「读 DOM 得到锚点 → 调纯函数拿选项与位置 → 写 DOM」。
 *
 * 🔴 定位只算「相对控制条容器」的 left / bottom：浮层是控制条的绝对定位子元素
 *   （向上浮出、贴着触发按钮右缘对齐），不做视口换算，也不复用 `pure/menuPlacement.placeMenu`
 *   —— 那个是「贴鼠标 + 四向翻转」的右键菜单语义，与「贴按钮 + 固定向上」不是一回事。
 */

import { SPEED_STEPS, formatSpeed, episodeLabel } from 'pure/player';

/**
 * 浮层种类（同一时刻只开一个）。'volume' 是唯一的**滑条型**浮层（点击音量图标后浮出的竖向滑条）；
 * 'subtitle' 是 #606 收进来的**字幕面板**（此前是一个独立的 Obsidian Modal，用户裁定「同设置面板一样上浮出来」）。
 */
export type PlayerMenuKind = 'episodes' | 'speed' | 'settings' | 'volume' | 'subtitle';

/** 倍速项：value 直接写 `video.playbackRate` */
export interface SpeedMenuItem {
    /** 档位字符串（如 `1.25`），UI 层据此回传选中的值 */
    id: string;
    label: string;
    /** 数值档位（UI 不必再 parseFloat） */
    value: number;
    active: boolean;
}

/** 选集项：index 直接传给 `goto()` */
export interface EpisodeMenuItem {
    /** 集下标字符串 */
    id: string;
    label: string;
    /** 集下标（0 基） */
    index: number;
    active: boolean;
}

/**
 * 设置项 id（#605 精简成三项）：
 *   · `playmode` **循环值行** —— 点击整行切到下一档，弹窗不关；
 *   · `pip`      **动作行**   —— 点击进入画中画并关闭弹窗（不支持时置灰不可点）；
 *   · `external` **动作行**   —— 点击转系统播放器打开并关闭弹窗。
 * ⛔ #605 起**没有**「后台播放」这一项 —— 它是**全局设置**，已搬到 设置页 › 内置视频播放器 折叠分组
 *    （用户裁定：全局项不该占播放器快捷面板）。
 */
export type PlayerSettingId = 'playmode' | 'pip' | 'external';

/**
 * 播放模式（#604 用户裁定：整张**剧集列表**级别 —— 取代旧的两个布尔 `autoNext` / `loopOne`）。
 *
 * 🔴 为什么把旧的「播完这一集」三选一框撤掉换成这一行：用户原话「『切集 / 循环 / 暂停』拆开」——
 *    那三个词是**三个不同层级**的概念被硬塞进一个框里：「切集」= 集末行为、「循环」= 列表级模式、
 *    「暂停」根本不是设置（底部主控制栏本来就有播放/暂停按钮）。⇒ 收成一行「播放模式」，
 *    集末行为由模式本身承载（`nextEpisodeIndex`），「暂停」整体移出设置。
 *
 * 五档语义（前四档与内置音频播放器 `pure/audioQueue` 同族口径，⛔ 别各写一套）：
 *   · `listLoop`   列表循环 —— 顺序推进，**最后一集播完回到第一集**；
 *   · `singleLoop` 单集循环 —— 播完重播本集；
 *   · `sequential` 顺序播放 —— 顺序推进，**最后一集播完停住**；
 *   · `shuffle`    随机播放 —— 随机挑一集（不与当前同集）；
 *   · `pauseAtEnd` 播完暂停 —— **播完当前这一集就停住**（⛔ 不推进下一集、也不弹连播面板）。
 *
 * 🔴 #606 用户点名「再加个播完暂停」—— 这正是 #604 撤掉那枚「暂停」档的语义（当初旧的三选一框里就有），
 *    只是这次它是**播放模式的一档**而不是一个独立按钮。⚠️ 追加在**末尾**：前三档的顺序一个字没动
 *    ⇒ 老用户点「播放模式」循环时，前四步与之前完全一致。
 */
export type PlayMode = 'listLoop' | 'singleLoop' | 'sequential' | 'shuffle' | 'pauseAtEnd';

/** 模式顺序（**真源**）：即循环切换 / 选择面板的展示顺序 */
export const PLAY_MODES: readonly PlayMode[] = ['listLoop', 'singleLoop', 'sequential', 'shuffle', 'pauseAtEnd'];

/** 模式显示名（「当前值」与面板**共用**；⛔ 别在视图层再写一份，否则改口径必漏） */
export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
    listLoop: '列表循环',
    singleLoop: '单集循环',
    sequential: '顺序播放',
    shuffle: '随机播放',
    pauseAtEnd: '播完暂停',
};

/** 脏值归一：设置文件被手改写脏值 ⇒ 回落 `listLoop`（与「缺省即列表循环」同口径） */
export function normalizePlayMode(v: unknown): PlayMode {
    return PLAY_MODES.includes(v as PlayMode) ? (v as PlayMode) : 'listLoop';
}

/**
 * #605 播放模式「整行点击循环」：按 `PLAY_MODES` 顺序取**下一档**，最后一档回到第一档。
 * 🔴 循环顺序 == 展示顺序（同一个真源）—— ⛔ 别在这里另写一份顺序表；脏值先归一（保证一定能前进一档，
 *    否则 `indexOf` 得 `-1` 会停在原地，看上去像「点了没反应」）。
 */
export function nextPlayMode(cur: PlayMode): PlayMode {
    return PLAY_MODES[(PLAY_MODES.indexOf(normalizePlayMode(cur)) + 1) % PLAY_MODES.length];
}

/**
 * 旧数据迁移（**零写入**）：`playerPlayMode` 缺省时由旧的两个布尔推导。
 *   `loopOne` → `singleLoop`；否则「自动切集」开 → `listLoop`、关 → `sequential`。
 * ⚠️ 旧口径「自动切集开 + 播到最后一集停住」与新口径「列表循环回到第一集」**不同**（有意）——
 *    想保留旧行为请选「顺序播放」。这是本批**唯一**的行为变化（见 CHANGELOG）。
 */
export function playModeFromLegacy(autoNext: boolean, loopOne: boolean): PlayMode {
    if (loopOne) return 'singleLoop';
    return autoNext ? 'listLoop' : 'sequential';
}

/**
 * 集末推进：返回下一集下标；`null` = **停住**（不弹连播面板）；等于 `cur` = **重播本集**。
 * `rng` 注入 ⇒ 随机模式可断言、可复现（与 `pure/audioQueue` 同款纪律，⛔ 别在这里直接调 `Math.random`）。
 * ⚠️ 单文件（电影）不归本函数管 —— 调用方先按 `single` 早退（一集没有「下一集」可言）。
 */
export function nextEpisodeIndex(
    mode: PlayMode,
    cur: number,
    count: number,
    rng: () => number = Math.random,
): number | null {
    if (count <= 0) return null;
    switch (mode) {
        case 'singleLoop':
            return cur;
        // count === 1 时 `(0+1)%1 = 0 = cur` ⇒ 回到本集（列表只有一集，循环就是重播它）
        case 'listLoop':
            return (cur + 1) % count;
        case 'sequential':
            return cur + 1 < count ? cur + 1 : null;
        // #606「播完暂停」：任何一集播完都**停住**（不推进、也不弹连播面板）
        case 'pauseAtEnd':
            return null;
        case 'shuffle': {
            if (count <= 1) return null;
            // 🔴 **有界重试 + 确定性回退**（与 `pure/audioQueue` 同款）：恒定/退化的随机源是**合法输入**，
            //    `while (n === cur)` 会死循环。次数用完就顺序推一个，绝不返回 `cur`（那是「重播」语义）。
            for (let i = 0; i < 24; i += 1) {
                const n = Math.floor(rng() * count);
                if (n >= 0 && n < count && n !== cur) return n;
            }
            return cur + 1 < count ? cur + 1 : 0;
        }
    }
}

/**
 * 设置弹窗里的行种类（#605 只剩两种）：
 *   · `cycle` 循环值行 —— 右侧只显示**当前值文字**（🔴 无箭头），点击就地切到下一档（弹窗不关）；
 *   · `nav`   动作行   —— 右侧只有右箭头（⛔ 无值、无开关），点击**立即执行并关闭**弹窗。
 * ⛔ 旧的 `select`（点开二级列表）与 `switch`（行内小开关）已随「后台播放搬走 / 播放模式改循环」退场。
 */
export type SettingRowKind = 'cycle' | 'nav';

export interface SettingRow {
    id: PlayerSettingId;
    label: string;
    kind: SettingRowKind;
    /** `cycle`：右缘显示的当前值文案 */
    value?: string;
    /** 置灰（不可用）：整行变暗、点击无反应 */
    disabled?: boolean;
    /** 置灰时右缘的说明文案（如「当前设备不支持」）—— 取代箭头出现 */
    note?: string;
}

/** 一组（组间有 1px 分割线） */
export interface SettingGroup {
    title?: string;
    rows: SettingRow[];
}

/** 弹窗标题（小号灰字那一行；与「分组标题」共用一套样式口径） */
export const SETTING_HEAD = '播放设置';

// ── #606 字幕面板（**播放器内上浮面板**，与设置面板同容器同开合规则）────────────────

/** 面板里那枚开关的文案 */
export const SUBTITLE_SWITCH_LABEL = '显示字幕';
/** 开关下方的提示（支持的字幕格式） */
export const SUBTITLE_HINT = '支持 .srt / .vtt';
/** 同目录没有候选时的说明 */
export const SUBTITLE_EMPTY_TEXT = '同目录没有找到字幕文件';
/** 底部动作行文案 */
export const SUBTITLE_BROWSE_LABEL = '从文件选择字幕';

/** 字幕候选行（`active` = 当前已挂载的那条，UI 高亮它） */
export interface SubtitleMenuCandidate {
    /** 候选文件名（选中后回传给视图去加载） */
    fileName: string;
    /** 语言标签（`pure/subtitle.subtitleLangLabel` 的结果；认不出时为空串 ⇒ UI 显示「字幕」） */
    lang: string;
    active: boolean;
}

/** 字幕面板模型：结构与文案全在这一份里，视图只做 DOM + 回传 */
export interface SubtitleMenuModel {
    title: string;
    /** 「显示字幕」开关态 */
    visible: boolean;
    hint: string;
    /** 同目录候选（空 ⇒ UI 显示 `emptyText`） */
    candidates: SubtitleMenuCandidate[];
    emptyText: string;
    browseLabel: string;
}

/**
 * #606 字幕面板模型。`active` 由 `current` 推出来 —— ⛔ 别让视图自己比对文件名
 * （两处判据迟早会漂；这正是「面板内容全部来自 pure」这条纪律的意义）。
 */
export function buildSubtitleMenu(opts: {
    title: string;
    /** 同目录候选（`lang` 是**已本地化的显示名**，由调用方经 `subtitleLangLabel` 得到） */
    candidates: readonly { fileName: string; lang?: string }[];
    /** 当前已挂载的字幕文件名（外部文件挂载时为 null ⇒ 没有一条高亮） */
    current: string | null;
    visible: boolean;
}): SubtitleMenuModel {
    return {
        title: `选择字幕：《${opts.title}》`,
        visible: !!opts.visible,
        hint: SUBTITLE_HINT,
        candidates: opts.candidates.map((c) => ({
            fileName: c.fileName,
            lang: c.lang ?? '',
            active: opts.current === c.fileName,
        })),
        emptyText: SUBTITLE_EMPTY_TEXT,
        browseLabel: SUBTITLE_BROWSE_LABEL,
    };
}

/** 倍速选项：档位与顺序完全来自 SPEED_STEPS；当前值不在档位内时**不亮任何一条**（不假装归一到 1×） */
export function buildSpeedOptions(cur: number): SpeedMenuItem[] {
    return SPEED_STEPS.map((value) => ({
        id: String(value),
        label: formatSpeed(value),
        value,
        active: value === cur,
    }));
}

/** 选集选项：单文件（电影）没有「集」的概念 → 空表；标签文案与顶栏标题同源（pure/player.episodeLabel） */
export function buildEpisodeOptions(
    items: readonly { index: number; title?: string }[],
    cur: number,
    single: boolean,
): EpisodeMenuItem[] {
    if (single) return [];
    return items.map((item) => ({
        id: String(item.index),
        label: episodeLabel(item, false),
        index: item.index,
        active: item.index === cur,
    }));
}

/**
 * 设置齿轮选项（🔴 #605 用户裁定的**三组三行**结构，与线框图逐行对应）：
 *
 * ```
 * 播放设置             ← SETTING_HEAD（小号灰字）
 * ──────────────
 * 播放模式   列表循环   ← cycle 循环值行（右侧当前值、⛔ 无箭头；点击整行切下一档）
 * ──────────────
 * 画中画          ›     ← nav 动作行（点击进画中画并关窗；不支持 ⇒ 置灰 + 右缘「当前设备不支持」）
 * ──────────────
 * 用系统播放器打开  ›    ← nav 动作行（点击转系统播放器并关窗）
 * ```
 *
 * 🔴 组标题**一律留空**（`title` 不填）：三组各只有一行，给一行起组名只会多出三行噪音；
 *    用户要的「小号灰字标题」由**弹窗标题** `SETTING_HEAD` 承担（同一套样式）。
 * 🔴 #605 起**每项各占一组**（三组 == 三行、组间两条分割线）—— 与用户「保留三段分割线」的裁定一致。
 * ⛔ 别在这里塞「暂停」—— 用户明确「暂停 从设置页移除，保留在底部主控制栏」。
 * ⛔ 别在这里塞「后台播放」—— 它是全局设置，已搬到设置页（见 `PlayerSettingId` 顶部注释）。
 * ⛔ 别把 `pip` 也做成「点开才出现」—— 用户要的是**置灰可见**（「不可用项置灰」）：
 *    看得见、但点不动，才知道这台设备没有这个能力。
 */
export function buildSettingOptions(opts: {
    pip: boolean;
    /** 当前播放模式（缺省 = 列表循环；调用方总会传真值） */
    playMode?: PlayMode;
}): SettingGroup[] {
    return [
        {
            rows: [
                {
                    id: 'playmode',
                    kind: 'cycle',
                    label: '播放模式',
                    value: PLAY_MODE_LABELS[normalizePlayMode(opts.playMode)],
                },
            ],
        },
        {
            rows: [
                opts.pip
                    ? { id: 'pip', kind: 'nav', label: '画中画' }
                    : { id: 'pip', kind: 'nav', label: '画中画', disabled: true, note: '当前设备不支持' },
            ],
        },
        {
            rows: [{ id: 'external', kind: 'nav', label: '用系统播放器打开' }],
        },
    ];
}

/** 浮层开合：同一入口再点一次 = 关；点另一个入口 = 切过去（永远只有一个开着） */
export function nextMenuState(cur: PlayerMenuKind | null, clicked: PlayerMenuKind): PlayerMenuKind | null {
    return cur === clicked ? null : clicked;
}

export interface AnchorGeometry {
    /** 触发按钮相对控制条容器左边界的左右缘（getBoundingClientRect 相减得到） */
    btnLeft: number;
    btnRight: number;
    /** 浮层实测宽度 */
    menuW: number;
    /** 控制条容器宽度 / 高度 */
    containerW: number;
    containerH: number;
    /** 视口内最小留白，默认 6 */
    margin?: number;
    /** 浮层与控制条的间距，默认 8 */
    gap?: number;
    /** 水平对齐：`right` = 右对齐按钮右缘（列表类菜单）；`center` = 水平居中于按钮（音量滑条这种窄浮层）；默认 `right` */
    align?: 'right' | 'center';
}

export interface AnchorPlacement {
    /** 浮层左边（相对控制条容器） */
    left: number;
    /** 浮层下边距（相对控制条容器底边；值 = 控制条高度 + gap，即浮在控制条上方） */
    bottom: number;
}

/**
 * 浮层定位：默认右对齐到触发按钮右缘、向上浮出；左右越界钳进容器。
 * 容器比浮层还窄时退化到 margin，**绝不产生负值**（负 left 会把浮层推出播放器外）。
 * `align: 'center'` 用于窄浮层（音量滑条）：水平居中于按钮，比右对齐更贴合「从这里长出来」的直觉。
 */
export function menuAnchor(g: AnchorGeometry): AnchorPlacement {
    const margin = g.margin ?? 6;
    const gap = g.gap ?? 8;
    const raw = g.align === 'center' ? (g.btnLeft + g.btnRight) / 2 - g.menuW / 2 : g.btnRight - g.menuW;
    const maxLeft = Math.max(margin, g.containerW - g.menuW - margin);
    const left = Math.min(Math.max(margin, raw), maxLeft);
    return { left, bottom: g.containerH + gap };
}
