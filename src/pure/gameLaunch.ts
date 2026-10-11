// #534 游戏「检索本地」的纯逻辑：可启动文件判据（可单测，无 obsidian 依赖）。
//
// 由来（用户 2026-10-05）：「希望全类型条目启动路径旁都添加统一本地路径和网络路径检索小图标按钮」
//   —— 游戏那枚「本地检索」= 先弹系统目录选择器，再按标题在目录里找**同名可启动文件**（回填 `gameLaunchPath`）。
//
// 🔴 只认**文件**（快捷方式 / 可执行 / 脚本）：游戏目录里的子文件夹不参与（`gameLaunchPath` 要的是能直接拉起的路径）。
// ⚠️ 与书籍那套（`pure/libraryBooks.isAssociableBookPath`）**分开**：两者扩展名集合不同、也别互相借用
//    （借了就会「书籍检索忽然能匹配 .exe」那种串味）。

/** 可启动文件的扩展名（小写比较；Windows 主用 .lnk/.exe/.bat/.cmd，macOS 用 .app，Linux 用 .sh） */
export const GAME_LAUNCH_EXTS: readonly string[] = ['exe', 'lnk', 'bat', 'cmd', 'app', 'sh'];

/** 取扩展名（小写，不含点）；没有扩展名 → 空串 */
export function extOfFile(name: string): string {
    const base = String(name ?? '').trim();
    const i = base.lastIndexOf('.');
    if (i <= 0 || i === base.length - 1) return '';
    return base.slice(i + 1).toLowerCase();
}

/** 是不是可启动文件（按扩展名判断；大小写不敏感） */
export function isGameLaunchPath(name: string): boolean {
    return GAME_LAUNCH_EXTS.includes(extOfFile(name));
}
