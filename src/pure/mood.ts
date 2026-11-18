// 心情（mood）：看完 / 读完后那一下**情绪反应**（纯逻辑，无 obsidian 依赖）
//
// 🔴 用户 m07854 ⑳（2026-11-13）：「所有类型『编辑属性 - 个人状态与评价』加 6 档 emoji
//    （🤩 震撼/神作、🥰 治愈/开心、🤔 烧脑/思考、😭 致郁/破防、😴 无聊/犯困、🤬 受罪/愤怒）」。
//
// ## 三条硬口径
// ① **心情不是评分**：评分是「好不好」（0~5 数值，可排序可均分），心情是「什么感觉」
//    （枚举，不参与任何均值计算）。⛔ 别把心情折算成数值塞进 rating —— 那会污染
//    系列均分 / 统计页 / `rating >= 4` 这类既有 Dataview 查询。
// ② **落盘存英文 id**（`mood: wow`），⛔ 不存 emoji：emoji 在 YAML 里是裸字符，
//    不同字体/系统渲染宽度不一，且用户换口味想改文案时历史数据就废了；
//    id 是稳定键，Dataview 也能直接筛。展示层再用 {@link moodEmoji} / {@link moodLabel} 拼。
// ③ **本表是唯一真源**：表单 chips、笔记属性表那一行、frontmatter 读回的白名单
//    全部走这里，⛔ 别在 UI 侧再手抄一份 emoji 数组（抄了就会出现「表单有 6 档、
//    读回只认 5 档」这种漂移）。

/** 心情档位 id（稳定键，落盘用）。顺序 = 用户给的顺序，⛔ 别重排（chips 按此渲染）。 */
export type MoodId = 'wow' | 'heal' | 'brain' | 'sad' | 'meh' | 'rage';

/** 一档心情：emoji + 主名 + 副名（用户给的是「主/副」两个词，展示与提示都用到） */
export interface MoodDef {
    id: MoodId;
    emoji: string;
    /** 主名（chips 上显示的那个词） */
    label: string;
    /** 副名（悬停提示里跟在主名后面，`震撼 / 神作`） */
    alt: string;
}

/** 六档心情（顺序 = 用户给定顺序） */
export const MOODS: readonly MoodDef[] = [
    { id: 'wow', emoji: '🤩', label: '震撼', alt: '神作' },
    { id: 'heal', emoji: '🥰', label: '治愈', alt: '开心' },
    { id: 'brain', emoji: '🤔', label: '烧脑', alt: '思考' },
    { id: 'sad', emoji: '😭', label: '致郁', alt: '破防' },
    { id: 'meh', emoji: '😴', label: '无聊', alt: '犯困' },
    { id: 'rage', emoji: '🤬', label: '受罪', alt: '愤怒' },
];

/** 全部合法 id（顺序同 {@link MOODS}；白名单校验与单测同源） */
export const MOOD_IDS: readonly MoodId[] = MOODS.map((m) => m.id);

/** 是否合法心情 id（读侧白名单用；⛔ 别用 `in MOODS` 之类的花活，这里就是数组查找） */
export function isMoodId(v: unknown): v is MoodId {
    return typeof v === 'string' && (MOOD_IDS as readonly string[]).includes(v);
}

/**
 * 归一：合法 id 原样返回，其余（缺省 / 老笔记乱填 / 已删档位）→ `undefined`。
 *
 * ⚠️ 返回 `undefined` 而不是回退到第一档：心情是**可选**字段，
 *    「没填」和「填了震撼」是两回事 —— 回退会把没填过的条目全染成「震撼」。
 */
export function normalizeMood(v: unknown): MoodId | undefined {
    return isMoodId(v) ? v : undefined;
}

/** id → 档位定义（非法 / 缺省 → undefined） */
export function moodDefOf(id: MoodId | undefined): MoodDef | undefined {
    if (!id) return undefined;
    return MOODS.find((m) => m.id === id);
}

/** id → emoji（非法 / 缺省 → 空串，调用方直接插模板不会出现 `undefined`） */
export function moodEmoji(id: MoodId | undefined): string {
    return moodDefOf(id)?.emoji ?? '';
}

/** id → 主名（非法 / 缺省 → 空串） */
export function moodLabel(id: MoodId | undefined): string {
    return moodDefOf(id)?.label ?? '';
}

/** id → 悬停提示（`震撼 / 神作`；缺省 → 空串） */
export function moodTip(id: MoodId | undefined): string {
    const d = moodDefOf(id);
    return d ? `${d.label} / ${d.alt}` : '';
}

/** id → 单行文本（`🤩 震撼`；笔记属性表那一行用；缺省 → 空串） */
export function moodText(id: MoodId | undefined): string {
    const d = moodDefOf(id);
    return d ? `${d.emoji} ${d.label}` : '';
}

/**
 * 文本 → id（表格单元格 / 手改笔记这两个入口用）。
 *
 * 🔴 认四种写法，顺序即优先级：
 *    · 稳定 id（`wow`）—— 落盘形态，读到它就是它；
 *    · 主名（`震撼`）—— 用户在格子里看到的那个词；
 *    · 主名带 emoji（`🤩 震撼`）—— 正是 {@link moodText} 拼出来的形态（表格显示什么就能填回什么）；
 *    · 纯 emoji（`🤩`）—— 用户从别处复制一个表情过来也认。
 * ⚠️ 空串 / 不认识 ⇒ `undefined`（⛔ 不回退第一档，理由同 {@link normalizeMood}）。
 * ⚠️ 与 `pure/status.statusFromText` 是同一套「值或中文标签都收」的纪律 —— 用户看到什么就能填什么。
 */
export function moodFromText(text: string): MoodId | undefined {
    const t = text.trim();
    if (!t) return undefined;
    if (isMoodId(t)) return t;
    for (const m of MOODS) {
        if (m.label === t) return m.id;
        if (`${m.emoji} ${m.label}` === t) return m.id;
        if (m.emoji === t) return m.id;
    }
    return undefined;
}

/**
 * 表单 chips 的提示语：选中态给「再点一次取消」，未选中给 `震撼 / 神作`。
 * ⚠️ 心情是**可清除**的（再点已选中的档位 = 取消）—— 与评分「再点清零」同一条交互纪律。
 */
export function moodChipTip(id: MoodId, selected: boolean): string {
    const base = moodTip(id);
    return selected ? `${base}（再点一次取消）` : base;
}
