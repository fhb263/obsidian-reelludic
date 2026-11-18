/**
 * 「这一组在手机上根本用不了」的判定真源（2026-11-14，用户 m05673 手机实测）。
 *
 * 用户原话（逐字）：「……有的分两行有的一行显示空白一片应该给个提示不支持……」
 *
 * 背景：插件早就声明 `isDesktopOnly: false`（`manifest.json`），重功能全靠 `main.ts` 里
 * 那 81 处 `Platform.isDesktopApp` **在动作入口提前返回**挡住。那套「点了才告诉你不行」
 * 在桌面上没问题（用户知道自己点了什么），但在手机上表现为：设置页里一整组控件
 * **渲染出来是空的**（按钮根本没建），用户看到的就是「一片空白」，既不知道是不支持、
 * 也不知道是坏了。
 *
 * ⇒ 本模块负责「哪些组在移动端要显式打上『仅桌面端』」这份名单。
 * ⚠️ 名单**必须与 `main.ts` 的门控同源**：这里点名一组，就意味着那组的核心动作在移动端
 *    都会被 `Platform.isDesktopApp` 拦下。⛔ 别把「只是窄一点不好用」的组加进来
 *    —— 那是 CSS 的活（见 `styles.css` 的窄屏段），标成不支持反而吓退用户。
 */

/** 在移动端要标「仅桌面端」的分组标题（逐字等于 `Settings.ts` 里 `createGroupSection` 的第二参） */
export const DESKTOP_ONLY_GROUPS: readonly string[] = [
    // 本地转写要起子进程（whisper / sherpa-onnx），手机上连 Node 运行时都没有。
    '语音转文字',
    // 所有凭据的「测试 / 登录 / 同步」都走 node 侧 HTTP 与二维码登录，移动端没有这层。
    '元数据搜索源凭据',
    '网络播放源凭据',
    '音乐下载源凭据',
    '统一周期管理',
    // 系统级文件读写（另存为 / 从文件恢复）是 Electron dialog + fs。
    '数据与备份',
    // 下载封面 / 清理附件 / 还原条目全都落到文件系统。
    '管理与维护',
];

/** 这一组在移动端是否需要「仅桌面端」标记 */
export function isDesktopOnlyGroup(title: string): boolean {
    return DESKTOP_ONLY_GROUPS.includes(title);
}

/** 是否应该给这一组打标：只在**非桌面**且该组确实桌面专属时打 */
export function shouldMarkDesktopOnly(title: string, isDesktopApp: boolean): boolean {
    return !isDesktopApp && isDesktopOnlyGroup(title);
}

/** 标记文案（用户可见；「仅桌面端」四个字，一眼知道为什么点不了） */
export const DESKTOP_ONLY_LABEL = '仅桌面端';
