/**
 * 🔴 #598（用户 2026-10-10）：「设置页-关于页把**问题反馈**按钮分成**报 Bug、提需求**两个按钮，做好调用入口」。
 *
 * 本模块 = **对外链接的唯一真源**：仓库 / 报 Bug / 提需求 / 爱发电四条 URL 全在这里，
 * ⛔ 别在设置页里手写第二份字符串（本仓「同一概念只准一份」；#473 已为写死 UA 栽过一次）。
 *
 * 🔴 「报 Bug / 提需求」链到的是 `.github/ISSUE_TEMPLATE/` 下的**两个 issue form**
 *    （`bug_report.yml` / `feature_request.yml`），**不是**裸的 `/issues/new`：
 *      · 模板里已经把「插件版本 / Obsidian 版本 / 运行平台 / 复现步骤」（报 Bug）
 *        或「建议类别 / 想解决什么问题」（提需求）排成了必填项 —— 用户点进去**先看到该填什么**，
 *        省掉一轮「你这信息不全」的往返；
 *      · 🔴 `?template=<文件名>` 必须与 `.github/ISSUE_TEMPLATE/` 下的**真实文件名逐字一致**：
 *        写错（或模板被改名）不会报错，只会**静默落到「选择模板」页** —— 那等于回到了起点。
 *        ⇒ 单测里用 `fs` 核过这两份文件确实存在，并把 URL 里的 template 名与文件名比过。
 *      · ⚠️ GitHub 的 issue form 只认 `?template=`（`?labels=` 那套对 yml form 不生效）。
 *
 * 纯常量模块（无 obsidian / 无 DOM），可被单测与产物断言同时引用。
 */

// 品牌图标判别联合（`brand` 单路径填充式 / `builtin` 内置描边式）。
// ⚠️ 只借类型，不借表 —— `sourceIcons` 那张表是「搜索源」语义，GitHub 不属于它（见下方注释）。
import type { SourceIcon } from 'pure/sourceIcons';

/** 仓库主页（「关于」页的 Github 按钮 + 下面两条反馈链接的共同前缀） */
export const REPO_URL = 'https://github.com/fhb263/obsidian-reelludic';

/** 「报 Bug」→ `.github/ISSUE_TEMPLATE/bug_report.yml` */
export const BUG_REPORT_URL = `${REPO_URL}/issues/new?template=bug_report.yml`;

/** 「提需求」→ `.github/ISSUE_TEMPLATE/feature_request.yml` */
export const FEATURE_REQUEST_URL = `${REPO_URL}/issues/new?template=feature_request.yml`;

/** 「爱发电」→ 赞助入口（与反馈无关，但同属「对外链接」这一族，收在一处才好维护） */
export const AFDIAN_URL = 'https://ifdian.net/a/fhb263';

/**
 * 作者 B 站主页（🔴 2026-11-12 用户 m00353 ①-11 当场给的 UID）。
 *
 * 原话：「设置-关于页 ReelLudic 信息栏『同作者 fhb263』前面加个 B 站 logo 可点击跳转 B 站主页」。
 * ⚠️ 这个 URL **只能由用户提供** —— 仓库里原本没有任何线索（全仓唯一出现过的
 *    `space.bilibili.com/12345` 在 `tests/biliEmbed.test.ts` 里是测试样本，⛔ 别拿它当真实主页）。
 *    写错不会报错，只会让用户点到一个 404 页 —— 那种错只在真机上肉眼可见。
 */
export const BILI_SPACE_URL = 'https://space.bilibili.com/1828315053';

/** 关于页作者行那枚 B 站图标的读屏名 / 悬停说明（两处共用一份，⛔ 别在渲染处手写第二遍） */
export const BILI_SPACE_TIP = '作者的 B 站主页';
/**
 * 作者 GitHub 主页（🔴 2026-11-12 用户 `m05813` 当场给的 URL）。
 *
 * 原话：「设置-关于页 ReelLudic 信息栏的 b 站图标跟上 github 的图标，点击可跳转作者主页
 * 「https://github.com/fhb263」」。
 *
 * ⚠️ 这是**作者个人主页**，不是仓库地址（`REPO_URL` 是 `…/obsidian-reelludic`）——
 *    两者同属 `fhb263` 但落点不同，⛔ 别合并成一个常量。
 */
export const AUTHOR_GITHUB_URL = 'https://github.com/fhb263';

/** 关于页作者行那枚 GitHub 图标的读屏名 / 悬停说明（两处共用一份，⛔ 别在渲染处手写第二遍） */
export const AUTHOR_GITHUB_TIP = '作者的 GitHub 主页';

/**
 * GitHub 官方标（simple-icons v16，**CC0-1.0**，与 `pure/sourceIcons` / `pure/searchIcons` 同源）。
 *
 * 🔴 来历与纪律：
 *   ⑴ 路径由 `https://cdn.jsdelivr.net/npm/simple-icons@16/icons/github.svg` 取回，
 *      实测 **822 字节 / viewBox 24×24 / 单路径 712 字符**，不是手抄也不是凭记忆写的。
 *   ⑵ ⛔ 别在本文件手写第二份品牌路径 —— 关于页那枚图标与其它品牌标共用
 *      `services/aiIcon.renderAiIcon` 这**一个**渲染端（两类图标的 fill 策略不同：
 *      品牌标填充式、内置标描边式，那条分治只准有一份）。
 *   ⑶ 为什么放在 `supportLinks` 而不是 `sourceIcons`：后者是「元数据源 / 音乐平台」的图标表
 *      （`Record<KeySourceId, …>` 由类型强制齐全），GitHub 不是搜索源，塞进去会污染那张表的语义。
 *      而本文件已是「对外链接的唯一真源」，图标与它指向的 URL 收在一处才好维护。
 */
export const AUTHOR_GITHUB_ICON: SourceIcon = {
    kind: 'brand',
    slug: 'github',
    viewBox: '0 0 24 24',
    d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
};

/** 「关于」页反馈按钮的**文案真源**（两枚按钮的可见名 —— 与上面的 URL 一一对应，⛔ 别在渲染处手写） */
export const SUPPORT_BUTTONS: ReadonlyArray<{ label: string; url: string }> = [
    { label: '报 Bug', url: BUG_REPORT_URL },
    { label: '提需求', url: FEATURE_REQUEST_URL },
];
