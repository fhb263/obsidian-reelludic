// 媒体库目录「输入值」的纯逻辑（2026-09-23 #380）：归一化 / 非法输入说明 / 同库判定。
//
// 背景：设置页「媒体库目录」原本是个**裸文本框 + onChange 立即落库**——
//   ① 没说清它是**库内相对路径**，用户以为可以填绝对路径（`D:\媒体库`）；
//   ② 填了绝对路径也不报错：`normalizePath` 会把它当成库内一个叫 `D:` 的文件夹
//      ⇒ 静默新建一个空库 ⇒ 看起来像「数据没了」（旧数据其实还在另一个文件夹里）；
//   ③ 每敲一个字符就落库一次 ⇒ 打字过程中会连续切库、连续建目录。
// 本模块只回答「这串输入到底是什么意思、能不能用」，DOM 与弹窗留给视图层。
// ⚠️ 遗留：`'ReelLudic'` 全仓仍有 51 处硬编码（22 个文件，散在纯模块/服务/设置页）。
//    本次只把**设置页这一路**收敛到本常量；其余 50 处的收敛是**独立一件事**（改了要逐个验路径等价），
//    ⛔ 别顺手替换 —— 默认值一旦分叉就是「换个入口打开的库不是同一个」这种最难查的问题。
export const DEFAULT_LIBRARY_DIR = 'ReelLudic';

/**
 * 库内相对路径归一化（**幂等**）：去首尾空白 → 反斜杠转正斜杠 → 折叠重复斜杠 →
 * 去前导 `./` 段 → 去前导与尾随斜杠；结果为空则回退默认库名。
 *
 * ⚠️ 刻意**不**解析 `..`（交由 {@link libraryDirIssue} 直接判非法）——
 * 静默折叠 `..` 会让「用户以为指到了 A、实际指到 B」。
 */
export function normalizeLibraryDirInput(raw: string): string {
    const s = String(raw ?? '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/^(?:\.\/)+/, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    return s || DEFAULT_LIBRARY_DIR;
}

/**
 * 校验「用户可读的问题说明」；合法返回 `null`。
 *
 * 刻意**宽松**：只拦两类 ——
 *  ⑴ 一定不可能是库内相对路径的（盘符 / 前导斜杠 / UNC）；
 *  ⑵ 一定会让路径解析出错或踩到跨平台文件名的（`..` 段 / 非法字符）。
 * 其余一律放行（中文、空格、`+`、`-` 等都是合法文件夹名）。
 */
export function libraryDirIssue(raw: string): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null; // 空 = 用默认库名，合法
    if (/^[A-Za-z]:/.test(s)) return '只能填库内相对路径，不要带盘符（例如 D:）';
    if (/^[\\/]/.test(s)) return '只能填库内相对路径，不要以 / 或 \\ 开头';
    const cleaned = normalizeLibraryDirInput(s);
    if (cleaned.split('/').some((seg) => seg === '..')) return '路径里不能出现 ..';
    if (/[<>:"|?*\u0000-\u001f]/.test(cleaned)) return '路径里不能包含 < > : " | ? * 这些字符';
    return null;
}

/** 两个输入是否指向**同一个库**（各自归一化后比较；用于「值没变就别折腾」）。 */
export function sameLibraryDir(a: string, b: string): boolean {
    return normalizeLibraryDirInput(a) === normalizeLibraryDirInput(b);
}

/**
 * 库目录的**显示名** = 归一化后的**最后一段**（用户 2026-09-27 ①）。
 *
 * 背景：视图标签直接拿 `settings.libraryDir` 显示 ⇒ 用户把它设成 `3-资源 Resource/媒体库`
 * 后，标签页/侧边栏标题就变成了整条路径，既长又没信息量。
 * 显示与存储**必须分开** —— 这里只负责「叫什么」，⛔ 别拿它去拼路径（拼路径一律用归一化原值）。
 */
export function libraryDisplayName(raw: string): string {
    const last = normalizeLibraryDirInput(raw).split('/').filter(Boolean).pop();
    return last || DEFAULT_LIBRARY_DIR;
}

/**
 * 库内**文件**路径 → 显示名（叶子段 + 去掉扩展名）—— 与 {@link libraryDisplayName} 同族
 * （都是「显示名取叶子段」，只是这里连扩展名一起去掉）。
 *
 * 用途（2026-09-27 用户指令）：内置音频播放器**标签页标题**要显示「其播放关联的笔记名」，
 * 而不是「音频播放器」或音频文件名。笔记路径形如 `媒体库/笔记/music/七里香.md` ⇒ 显示 `七里香`。
 *
 * 🔴 为什么必须收敛成一处：手写 `split('/').pop().replace(/\.md$/)` 会踩四类坑 ——
 *   ① 分隔符两种（`\` / `/`）；② 扩展名大小写（`.MD`）；③ **带点的目录名不参与**（`1.0 计划/曲.md`
 *   的叶子是 `曲.md`，⛔ 不能从整条路径 `lastIndexOf('.')` 切）；④ 尾随分隔符 / 空白。
 * ⚠️ 只去**最后一段**的扩展名：`A.B/曲名.mp3` 的显示名是 `曲名`（⛔ 不是 `A`）。
 */
export function fileDisplayName(path: string): string {
    const norm = String(path ?? '')
        .trim()
        .replace(/\\/g, '/');
    const leaf = norm.split('/').filter(Boolean).pop() ?? '';
    if (!leaf) return '';
    const dot = leaf.lastIndexOf('.');
    // `dot <= 0`：无扩展名，或以点开头（`.gitignore` 这类视为整体名，⛔ 别切成空串）
    return dot > 0 ? leaf.slice(0, dot) : leaf;
}
