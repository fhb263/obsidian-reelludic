// 「元数据搜索源启用」那张表里，每个勾选项的**一句话说明**（hover 提示用）。
//
// 🔴 为什么单独一个纯模块：这段文案是**用户逐字给定**的（本轮裁定：勾选项 hover 2 秒后出轻提示），
//    13 条 × 6 组的映射关系写进 Settings 会变成一坨在渲染函数中间的字符串字面量表 ——
//    既没法单测「每个候选源都有文案」，也没法让「设了新源却忘了配文案」在 CI 里红。
//    ⇒ 真源放这里（无 obsidian 依赖、可单测），渲染端只调 `sourcePitch(group, id)`。
//
// ⚠️ 文案**逐字照抄**用户原话，⛔ 别顺手润色 / 补句号 / 统一标点：
//    用户是按「一眼看懂这个源强在哪」写的，改字就等于改产品口径。
// ⚠️ 同一个源在不同组里是**不同的话**（豆瓣在书籍/漫画/影视/动画/音乐/游戏六组各一套），
//    ⇒ 结构必须是「组 → 源 → 文案」两层，⛔ 别拍平成一个 `Record<ProviderId, string>`。
// ⚠️ 反引号里那些 `**` 是用户 markdown 原文的残留，**不要**在气泡里解析 ——
//    气泡走 `.rl-tip` 的纯文本 `textContent`（见 `services/globalTooltip`），
//    星号会原样显示成字符。若用户日后要求加粗，得先换渲染器，⛔ 别在文案里删星号了事。
import type { ProviderId, SourceGroup } from 'pure/sourceRegistry';

/**
 * 每组 → 各源的一句话说明。
 *
 * 🔴 键集合与 `PROVIDERS` 的 `groups` **必须对得上**：`tests/sourcePitch.test.ts` 有一条
 *    守卫逐组比对「`groupCandidates(group)` 里的每个源都必须有文案」，
 *    新接入源若忘配文案会当场红（⛔ 别把守卫改成「允许缺失」——那等于让新源静默没有提示）。
 */
export const SOURCE_PITCH: Readonly<Record<SourceGroup, Readonly<Partial<Record<ProviderId, string>>>>> = {
    book: {
        douban: '权威中文图书库，提供最全的出版信息、版本、译者与评分',
        weread: '中文电子书与网文库，支持同步个人书架与阅读进度',
        openLibrary: '免密开源书库，完美补充绝版老书与外文基础数据',
        googleBooks: '全球现代出版物全覆盖，支持书名/作者/全文检索',
    },
    comic: {
        douban: '国内引进版漫画单行本、册数与出版信息首选',
        bangumi: '日系漫画与轻小说最强库，连载状态与制作人员关联极准',
        mangadex: '专业漫画库，用于补充详细的分章列表与多语言翻译版本',
    },
    movieTv: {
        douban: '中文影视基准库，提供最全的中文演职员、上映信息与热评',
        tmdb: '全球影视最全库，提供超清海报/剧照，支持同步想看与收藏',
        omdb: '评分增强源，一键补充 IMDb、烂番茄、Metacritic 权威评分',
    },
    anime: {
        douban: '补充中文动画剧集的基础信息与国内用户评分',
        bangumi: '二次元动画首选，放送周期、分集列表与声优阵容最全',
        anilist: '跨平台评分聚合，支持批量抓取多层级关联数据与英/日文信息',
    },
    music: {
        douban: '华语实体唱片、专辑曲目与流派发行信息的基础参考',
        musicbrainz: '免密开源音乐库，提供严谨的曲目版本与厂牌结构化关联',
        itunes: '苹果正版数字库，快速抓取标准数字专辑封面与官方音轨顺序',
    },
    game: {
        douban: '中文游戏译名、发行平台与玩家评分的基础参考',
        steam: 'PC游戏首选，自动同步库内游戏，补充游玩时长与愿望单',
        igdb: '多平台主机游戏库，DLC、重制版与游戏引擎关联深度极佳',
    },
};

/**
 * 取某组某源的一句话说明；查不到回 `''`（调用方据此回退到通用提示，⛔ 别画空气泡）。
 */
export function sourcePitch(group: SourceGroup, id: ProviderId): string {
    const byGroup = SOURCE_PITCH[group];
    if (!byGroup) return '';
    return byGroup[id] ?? '';
}

/**
 * 该组**配了文案**的全部源 id（顺序 = `SOURCE_PITCH` 的书写顺序）。
 * 只给测试与「文案覆盖率」守卫用；渲染端**不要**拿它当候选源列表 ——
 * 候选源的真源是 `PROVIDERS` 的 `groups`（见 `Settings.groupCandidates`）。
 */
export function sourcePitchIds(group: SourceGroup): ProviderId[] {
    return Object.keys(SOURCE_PITCH[group] ?? {}) as ProviderId[];
}
