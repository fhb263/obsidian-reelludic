import { Modal, type App } from 'obsidian';
import { applyScrollPref, markScrollInside } from 'services/scrollPref';

/**
 * 成熟度四档（🔴 2026-10-22 用户裁定扩档）：v3 完全形态 > v2 进阶完善 > v1 基本可用 > v0 概念规划
 * —— 九宫格用它上色深浅 + 右上角角标。四档的配色实现在 `styles.css` 的 `.rl-rm-cell[data-level]`。
 */
export type RoadmapLevel = 'v3' | 'v2' | 'v1' | 'v0';

export interface RoadmapCell {
    name: string;
    scope: string;
    level: RoadmapLevel;
}

/**
 * 九个版块。文案是用户原话（2026-10-21 逐条给定），不要为了排版「精简」——
 * 每个词都对应一个已实现/计划中的具体能力，删一个词就等于少承诺一件事。
 * 顺序 = 用户给的顺序（搜索 → 视图 → 播放 → 计划 → 统计 → AI → 插件设置 → 数据 → 生态），
 * 就是九宫格的读序。
 *
 * 🔴 2026-10-21 二轮（用户重给了一版九行表，本文件按它逐字落地）：
 *   ⑴ **顺序变了**：「播放阅读」从第 4 格提到第 3 格、「计划追踪」退到第 4 格（本轮用户表的横排序）；
 *   ⑵ **三个版块改名**：视图展示 → **视图编辑**、AI 增强 → **AI 赋能**、个性化 → **插件设置**、
 *      数据运维 → **数据管理**（改名不是换词：视图那格现在点名「右键菜单属性编辑与关联入口」，
 *      设置那格点名「快捷键命令面板 / 字段映射与属性排序」，覆盖范围随名字一起扩）；
 *   ⑶ ⚠️ 这张表**同时是 Issue 模板的「涉及版块」选项源**（`.github/ISSUE_TEMPLATE/*.yml`）——
 *      改这里就要同步改那两处（同一套九块，用户要求「统一」）。
 *
 * 🔴 2026-10-22 用户裁定（**覆盖 2026-10-21 那条「本版没有 v2」**）：档位从三档扩成**四档**
 *    v0 概念规划 / v1 基本可用 / v2 进阶完善 / v3 完全形态，`RoadmapLevel` 与 CSS 配色同步加 v3。
 *    本轮**只扩刻度、不动归属**（用户原话「只扩档位，等级不动」）⇒ `ROADMAP_CELLS` 里的 level
 *    值一个都没改，仍是 v1 / v0 两档在用；v2 / v3 是留给后续升级的刻度。
 *    ⚠️ 因此「`ROADMAP_CELLS` 里出现 v2 就是文案错了」这条**已作废** —— 四档都合法。
 * 🔴 1.4.x 用户指令：「关于页-未来规划弹窗把『播放阅读』网格升级为 v2」⇒ 该格 level 由 v1 改为 v2。
 *    这是**当前唯一**用到 v2 的格子（其余仍 v0/v1）；⛔ 别借这次把其它格也一起上调。
 */
export const ROADMAP_CELLS: readonly RoadmapCell[] = [
    {
        name: '搜索添加',
        scope: '多源链式搜索导入、豆瓣等账号收藏批量导入、手动填写',
        level: 'v1',
    },
    {
        name: '视图编辑',
        scope: '卡片网格 / 列表等视图展示、筛选 / 排序 / 搜索等操作、右键菜单属性编辑与关联入口',
        level: 'v1',
    },
    {
        name: '播放阅读',
        scope: '内置阅读器（TXT / EPUB / PDF / 漫画）、内置播放器（视频 / 音频）、其他启动',
        // 🔴 用户裁定（1.4.x）：「关于页未来规划弹窗把『播放阅读』网格升级为 v2」。
        //    ⚠️ 这是用户对**成熟度的判定**，不是「填个更好看的颜色」——⛔ 别顺手把别的格子也调高。
        level: 'v2',
    },
    {
        name: '计划追踪',
        scope: '追番表、排期表、追更检测',
        level: 'v0',
    },
    {
        name: '统计报告',
        scope: '统计页数据统计、评分看板、年度报告',
        level: 'v1',
    },
    {
        name: 'AI 赋能',
        scope: '摘要、预填、翻译、歌词双语、AI 搜索、选段解读、云端朗读',
        level: 'v0',
    },
    {
        name: '插件设置',
        scope: '外观与体验、元数据源 / AI 服务配置、快捷键命令面板、字段映射与属性排序自定义等',
        level: 'v1',
    },
    {
        name: '数据管理',
        scope: '持久化、备份迁移、附件管理、失效检测',
        level: 'v1',
    },
    {
        name: '生态联动',
        scope: '兼容三方插件或其他等、桌面端和移动端插件 UI 功能适配',
        level: 'v0',
    },
];

/**
 * 功能蓝图九宫格弹窗。
 *
 * 为什么用九宫格而不是列表：九个方向彼此没有先后关系，摆成 3×3 能一眼看出「哪几块已经吃透、
 * 哪几块还是空白」，这正是用户要的「颜色越深覆盖越完整」；列表读起来像待办清单，会误导成排期。
 * 颜色只由 data-level 决定（CSS 上色），JS 不碰色值，换主题/改深浅都不需要动这个文件。
 *
 * 🔴 2026-10-22 用户指令：标题改「**ReelLudic 功能蓝图**」（原「ReelLudic 组成——颜色越深，
 *    完成度越高」太长且把结论说成了副标题）；同时档位扩到 v0–v3 四档（见 `RoadmapLevel`）。
 *    标题既然不再解释颜色含义，`data-level` 的角标（v0/v1/…）就是唯一可读的档位来源。
 *
 * 🔴 2026-10-21 用户指令：**砍掉底部**那一坨（图例三行 + 「知道了」按钮）——图例是把
 *    「颜色越深 = 完成度越高」这句话翻译两遍，而顶部标题已经把它说完了；关闭走右上角 X / Esc。
 */
export class RoadmapModal extends Modal {
    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        applyScrollPref(this.modalEl);
        this.modalEl.addClass('rl-rm-modal');

        const { contentEl } = this;
        contentEl.empty();
        // 九宫格在窄屏会变很长，滚动交给 .rl-rm-body（CSS 给 max-height），外层 modal-content 不再滚
        markScrollInside(this.modalEl);

        const head = contentEl.createDiv({ cls: 'rl-rm-head' });
        head.createDiv({ cls: 'rl-rm-title', text: 'ReelLudic 功能蓝图' });

        const body = contentEl.createDiv({ cls: 'rl-rm-body' });
        const grid = body.createDiv({ cls: 'rl-rm-grid' });
        for (const cell of ROADMAP_CELLS) {
            const cellEl = grid.createDiv({ cls: 'rl-rm-cell', attr: { 'data-level': cell.level } });
            cellEl.createDiv({ cls: 'rl-rm-name', text: cell.name });
            cellEl.createDiv({ cls: 'rl-rm-scope', text: cell.scope });
            // 角标放最后：CSS 用绝对定位钉到右上角，DOM 顺序不影响视觉，但读屏会先读到方向名
            cellEl.createSpan({ cls: 'rl-rm-badge', text: cell.level });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
