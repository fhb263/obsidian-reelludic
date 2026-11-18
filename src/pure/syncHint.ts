/**
 * 同步弹窗的三段式说明（2026-11-11 用户 m05717 ② 裁定）。
 *
 * 🔴 用户逐字要求：「这三个词（**同步数据**、**冲突处理**、**前置条件**）用**加粗**或者**主题色**
 *    显示，后面跟一个**全角冒号**。」
 *
 * 背景：原来 6 个同步弹窗各写一段 100~200 字的长句，用户看不懂「到底同步什么、会不会覆盖我的数据、
 * 要先准备什么」。改成固定三段后，每个弹窗的形状一致 —— 眼睛扫三个词就知道该看哪一段。
 *
 * ⚠️ 为什么把文案抽成纯函数而不是写在弹窗里：
 *    ① 文案是本轮交付的**主体**，必须能被单测逐字钉住（弹窗里的 `createDiv` 没法直接断言）；
 *    ② 6 个弹窗原本各写各的，措辞已经开始漂移（豆瓣写「只读豆瓣、不改动那边的内容」、
 *       Steam 写「只读 Steam，不会改动那边的内容」）—— 收成一处才不会再分叉。
 *    ⛔ 别把文案再散回各个 Modal。
 */

/** 一段说明：标签（会被加粗 + 补全角冒号）+ 正文 */
export interface SyncHintSection {
    /** 固定三选一；⛔ 不要自造第四种，三个词是用户点名的 */
    label: SyncHintLabel;
    /** 正文。不加粗、不带冒号 —— 冒号由渲染层补 */
    body: string;
}

export type SyncHintLabel = '同步数据' | '冲突处理' | '前置条件';

/** 三段的固定顺序（用户给的表格就是这个顺序） */
export const SYNC_HINT_LABELS: readonly SyncHintLabel[] = ['同步数据', '冲突处理', '前置条件'];

/** 全角冒号。⛔ 不是 `:` —— 用户明确点名「全角冒号」 */
export const SYNC_HINT_COLON = '：';

/**
 * 本地已有条目「默认不勾选」这类行为的统一说法。
 * 抽出来是因为 4 家（TMDB / Bangumi / Steam / 音乐）语义完全一致，
 * 只差「覆盖哪些字段」的半句。
 */
function keepLocalNote(overwritten: string): string {
    return `仅读取，单向同步。本地已有条目默认不勾选；手动勾选后，将覆盖${overwritten}（**不影响**本地生成的评语、进度及摘抄数据）。`;
}

/** 豆瓣：影视 / 书籍 / 音乐 / 游戏全类型 */
export function doubanHintSections(): SyncHintSection[] {
    return [
        { label: '同步数据', body: '豆瓣账号所有标记记录（含影、视、书、音、游戏等状态）。' },
        { label: '冲突处理', body: '仅读取，单向同步。本地库已存在的条目将自动跳过，不执行覆盖。' },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 元数据搜索源凭据 › 豆瓣」中配置登录态 Cookie。',
        },
    ];
}

/** 微信读书：书架电子书 */
export function wereadHintSections(): SyncHintSection[] {
    return [
        { label: '同步数据', body: '微信读书书架内的电子书。' },
        { label: '冲突处理', body: '仅读取，单向同步。本地库已存在同名书籍将自动跳过，不执行覆盖。' },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 元数据搜索源凭据 › 微信读书」中配置 Cookie。',
        },
    ];
}

/** TMDB：想看清单 + 收藏，电影与剧集 */
export function tmdbHintSections(): SyncHintSection[] {
    return [
        { label: '同步数据', body: 'TMDB 账号的想看清单（Watchlist）及收藏（Favorites），涵盖电影与剧集。' },
        { label: '冲突处理', body: keepLocalNote('基础元数据字段') },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 元数据搜索源凭据 › TMDB」中配置 API Key（32 位）及 Access Token（以 eyJ 开头的 v4 长字符串）。',
        },
    ];
}

/** Bangumi：想看 / 在看 / 看过 */
export function bangumiHintSections(): SyncHintSection[] {
    return [
        { label: '同步数据', body: 'Bangumi 账号的标记记录（想看 / 在看 / 看过）。' },
        { label: '冲突处理', body: keepLocalNote('基础元数据字段') },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 元数据搜索源凭据 › Bangumi」中配置 Access Token。',
        },
    ];
}

/** Steam：游戏库（含游玩时长）+ 愿望单 */
export function steamHintSections(): SyncHintSection[] {
    return [
        { label: '同步数据', body: 'Steam 账号的游戏库（含游玩时长）及愿望单。' },
        {
            label: '冲突处理',
            body: '仅读取，单向同步。本地缺失条目将新建；已有条目勾选后，仅覆盖 Steam 来源的元数据字段（标题、封面、平台、开发商、发行年、题材、简介、游玩时长），**不影响**本地生成的评语、进度、标签及个人评分。',
        },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 元数据搜索源凭据 › Steam」中配置 API Key（32 位十六进制）及 SteamID（17 位数字），并确保 Steam 账户的「个人资料」与「愿望单」已设为公开可见。',
        },
    ];
}

/**
 * 音乐平台（网易云 / QQ 音乐 / 酷狗）。
 * @param platformLabel 具体平台名（从某一家凭据行点进来时有值）；
 *                      从通用入口进来给 `null`，文案退化成多平台并列。
 */
export function musicHintSections(platformLabel: string | null): SyncHintSection[] {
    const which = platformLabel === null ? '平台账号' : `${platformLabel} 账号`;
    return [
        {
            label: '同步数据',
            body: `${which}内的歌单及「我喜欢的音乐」（歌单名称将自动写入本地条目标签，支持按标签筛选）。`,
        },
        {
            label: '冲突处理',
            body: '仅读取，单向同步。本地缺失条目将新建；已有条目勾选后，仅覆盖来源元数据字段（标题、歌手、专辑、封面），**不影响**本地生成的评语、进度、标签及个人评分。',
        },
        {
            label: '前置条件',
            body: '需在「设置 › 搜索配置 › 音乐下载凭据」中配置对应平台的 Cookie。如遇 Cookie 失效提示，重新配置后点击「重新读取」即可。',
        },
    ];
}
