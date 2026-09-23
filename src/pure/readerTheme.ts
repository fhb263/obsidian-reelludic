// 阅读主题（纯逻辑，无 DOM/obsidian 依赖）：档位表 + 归一 + 容器类名映射。
// 主题效果本身在 styles.css 的 .rl-reader.rl-rt-* 变量覆盖层里（不在此处算色值）。

/** 阅读主题档位：follow = 跟随 Obsidian 主题（缺省，观感与 1.0.4 一致）/ 五种独立阅读配色 */
export type ReaderThemeId = 'follow' | 'light' | 'dark' | 'green' | 'gray' | 'sepia';

export interface ReaderThemeMeta {
    id: ReaderThemeId;
    /** 色卡悬停提示（同时也作为无障碍名） */
    label: string;
}

/**
 * 档位顺序 = 设置菜单色卡渲染顺序；follow 恒在首位（缺省档）。
 * ⚠️ 新增档位必须同时在 styles.css 补 `.rl-reader.rl-rt-<id>` 变量块与色卡底色的
 * `[data-theme="<id>"]` 规则，否则该档点了没反应（单测 `readerThemeClass` 只保证映射存在）。
 */
export const READER_THEMES: readonly ReaderThemeMeta[] = [
    { id: 'follow', label: '跟随主题' },
    { id: 'light', label: '经典白' },
    { id: 'dark', label: '夜间黑' },
    { id: 'green', label: '护眼绿' },
    { id: 'gray', label: '深灰' },
    { id: 'sepia', label: '羊皮纸' },
];

/** 缺省档：跟随 Obsidian 主题（升级后观感零变化） */
export const DEFAULT_READER_THEME: ReaderThemeId = 'follow';

/**
 * 合法档位集合（以 READER_THEMES 的 id 为唯一真源，避免两处定义漂移）。
 * ⚠️ 用数组 + includes 而不是 `raw in OBJ`：`in` 会沿原型链命中 `toString` / `constructor`
 * 这类继承键，脏数据不仅没被兜底反而穿透下去（themeTokens 同款教训）。
 */
const VALID_THEMES: readonly string[] = READER_THEMES.map((t) => t.id);

/** 档位归一：脏数据/旧数据/原型链键名一律回退 follow */
export function normalizeReaderTheme(raw: unknown): ReaderThemeId {
    return typeof raw === 'string' && VALID_THEMES.includes(raw) ? (raw as ReaderThemeId) : DEFAULT_READER_THEME;
}

/** 档位 → 阅读器容器类名（follow 返回空串 = 不挂类，完全继承 Obsidian 主题变量） */
export function readerThemeClass(id: ReaderThemeId): string {
    return id === 'follow' || !VALID_THEMES.includes(id as string) ? '' : `rl-rt-${id}`;
}
