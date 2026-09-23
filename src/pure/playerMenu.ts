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

/** 浮层种类（同一时刻只开一个）。'volume' 是唯一的**滑条型**浮层（点击音量图标后浮出的竖向滑条）。 */
export type PlayerMenuKind = 'episodes' | 'speed' | 'settings' | 'volume';

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

/** 设置项 id：前三个是**开关**（就地切换，不收起浮层），后两个是**动作**（执行一次后收起）。 */
export type PlayerSettingId = 'bgplay' | 'epsend' | 'autonext' | 'loopone' | 'stop' | 'pip' | 'external';

/** 开关型设置项 id（#337 起只剩「后台播放」—— 自动切集 / 单集循环 合并成「播完这一集」三选一框） */
export type PlayerSwitchId = Extract<PlayerSettingId, 'bgplay'>;

/** 「播完这一集」三选一（#337 用户裁定：自动切集 / 单集循环 两个会打架的开关合并成互斥选项框，
 *  并补上第三个正式选项「暂停」= 停在片尾 —— 此前只能把两个开关都关掉才达得到）。 */
export type EpisodeEndChoice = 'autonext' | 'loopone' | 'stop';

/** 三选一的展示顺序与文案（🔴 顺序即面板顺序；「暂停」= 停在片尾，不循环也不切；#338 文案改短） */
export const EPISODE_END_CHOICES: { id: EpisodeEndChoice; label: string }[] = [
    { id: 'autonext', label: '切集' },
    { id: 'loopone', label: '循环' },
    { id: 'stop', label: '暂停' },
];

/**
 * 由原有两个字段推导当前选项 —— 🔴 循环优先（与 `onEnded` 的既有优先级一致）；设置零迁移。
 * `single`（电影 / 单文件）恒不可能「切下一集」→ 显示上兜到「暂停」（`onEnded` 对 single 本来就停住）。
 */
export function episodeEndChoice(autoNext: boolean, loopOne: boolean, single = false): EpisodeEndChoice {
    const c = loopOne ? 'loopone' : autoNext ? 'autonext' : 'stop';
    return single && c === 'autonext' ? 'stop' : c;
}

/** 把用户选的选项写回两个字段（append-only 设置不变，只是组合变化） */
export function applyEpisodeEndChoice(choice: EpisodeEndChoice): { autoNext: boolean; loopOne: boolean } {
    return { autoNext: choice === 'autonext', loopOne: choice === 'loopone' };
}

/** 设置项：id 即动作名；`toggle` 为真时是开关框（点高亮/关则不亮）；`choices` 非空时是三选一框组 */
export interface SettingMenuItem {
    id: PlayerSettingId;
    label: string;
    active: boolean;
    /** 开关框（点击就地切换、点亮/熄灭、点击不收起浮层） */
    toggle?: boolean;
    /** 开关当前状态（仅 toggle 项有意义） */
    on?: boolean;
    /** 三选一框组（仅 `id === 'epsend'` 有意义；label 为组名） */
    choices?: { id: EpisodeEndChoice; label: string }[];
    /** 当前选中的选项（仅 choices 项有意义） */
    picked?: EpisodeEndChoice;
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
 * 设置齿轮选项：**设置区（后台播放开关 + 「播完这一集」三选一框）在前，动作区（画中画 / 用系统播放器打开）在后**。
 * #337 起「自动切集 / 单集循环」两个开关合并为 `epsend` 三选一框（互斥选项用单选，冲突从根上消失）。
 * 缺省值：后台播放视为关、播完行为视为「暂停」—— 调用方（视图）总会显式传真实状态，这里只是不让测试/旧调用炸掉。
 * 不支持画中画时该项**整条不出现** —— 不给一个点了只会报错的入口。
 */
export function buildSettingOptions(opts: {
    pip: boolean;
    bgPlay?: boolean;
    /** 当前「播完这一集」选项（调用方用 `episodeEndChoice(autoNext, loopOne, single)` 推导；缺省 = 暂停） */
    episodeEnd?: EpisodeEndChoice;
    /** 单集（电影 / 单文件）：不显示「切集」框（一集没法切） */
    single?: boolean;
}): SettingMenuItem[] {
    const list: SettingMenuItem[] = [
        { id: 'bgplay', label: '后台播放', active: false, toggle: true, on: !!opts.bgPlay },
        {
            id: 'epsend',
            label: '播完这一集',
            active: false,
            choices: opts.single
                ? EPISODE_END_CHOICES.filter((c) => c.id !== 'autonext')
                : EPISODE_END_CHOICES,
            // 🔴 单集把「切集」兜到「暂停」—— 防调用方传了未夹取的推导值（onEnded 对 single 本来就停住）
            picked: opts.single && (opts.episodeEnd ?? 'stop') === 'autonext' ? 'stop' : opts.episodeEnd ?? 'stop',
        },
    ];
    if (opts.pip) list.push({ id: 'pip', label: '画中画', active: false });
    list.push({ id: 'external', label: '用系统播放器打开', active: false });
    return list;
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
