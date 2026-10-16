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

/** 仓库主页（「关于」页的 Github 按钮 + 下面两条反馈链接的共同前缀） */
export const REPO_URL = 'https://github.com/fhb263/obsidian-reelludic';

/** 「报 Bug」→ `.github/ISSUE_TEMPLATE/bug_report.yml` */
export const BUG_REPORT_URL = `${REPO_URL}/issues/new?template=bug_report.yml`;

/** 「提需求」→ `.github/ISSUE_TEMPLATE/feature_request.yml` */
export const FEATURE_REQUEST_URL = `${REPO_URL}/issues/new?template=feature_request.yml`;

/** 「爱发电」→ 赞助入口（与反馈无关，但同属「对外链接」这一族，收在一处才好维护） */
export const AFDIAN_URL = 'https://ifdian.net/a/fhb263';

/** 「关于」页反馈按钮的**文案真源**（两枚按钮的可见名 —— 与上面的 URL 一一对应，⛔ 别在渲染处手写） */
export const SUPPORT_BUTTONS: ReadonlyArray<{ label: string; url: string }> = [
    { label: '报 Bug', url: BUG_REPORT_URL },
    { label: '提需求', url: FEATURE_REQUEST_URL },
];
