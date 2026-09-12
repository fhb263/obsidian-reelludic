/**
 * 本地视频文件扩展名统一真源（可单测，无 obsidian 依赖）
 *
 * 统一两处散落的硬编码，避免改一处漏另一处：
 *  - 文件选择器「可关联的本地视频格式」（VIDEO_ASSOCIABLE_EXTENSIONS）
 *  - Chromium <video> 可内嵌解码的子集（CHROMIUM_VIDEO_EXTENSIONS）
 *
 * 背景：Obsidian 的 <video> 是 Chromium 内核，解码能力有限——只稳定支持
 * MP4(H.264/AAC)、WebM(VP8/VP9)、Ogg/Theora。mkv/avi/flv/wmv/ts/m4v 等容器
 * 及 HEVC(h265)/AV1 等编码常无法解码，内嵌会黑屏/无声（Chromium 无 HEVC 解码）。
 *
 * 因此「可关联」≠「可内嵌」：用户可在文件选择器关联任意外部播放器能播的容器，
 * 但只有可内嵌子集才值得进 Obsidian 内嵌播放器（其余由 <video> error / 扩展名
 * 预判自动转系统播放器兜底，见 VideoPlayerModal / main 层）。
 */

/** 文件选择器可选关联的本地视频容器扩展名（小写，无点；含 Chromium 可内嵌 + 需外部播放器的） */
export const VIDEO_ASSOCIABLE_EXTENSIONS: readonly string[] = [
    'mp4', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'webm', 'm4v', 'ts', 'ogv',
];

/** Chromium <video> 可稳定内嵌解码的视频容器扩展名（小写，无点；恒为 VIDEO_ASSOCIABLE_EXTENSIONS 的子集） */
export const CHROMIUM_VIDEO_EXTENSIONS: readonly string[] = ['mp4', 'webm', 'mov', 'ogv'];

/** 取路径扩展名（小写，去 #? 参数；无扩展名/空/以分隔符结尾 → ''） */
export function videoExt(path: string): string {
    if (!path) return '';
    const norm = path.replace(/\\/g, '/');
    const idx = norm.lastIndexOf('.');
    if (idx < 0 || idx === norm.length - 1) return '';
    const ext = norm.slice(idx + 1).toLowerCase();
    return ext.split(/[?#]/)[0];
}

/** 是否为「可关联的本地视频容器」（文件选择器用它筛选可选文件） */
export function isAssociableVideoPath(path: string): boolean {
    return VIDEO_ASSOCIABLE_EXTENSIONS.includes(videoExt(path));
}

/**
 * 该路径是否适合 Obsidian 内嵌 <video> 播放（可内嵌子集判定）。
 * @param path 本地绝对路径或 vault 相对路径均可（只判扩展名）
 */
export function isEmbeddableVideoPath(path: string): boolean {
    return CHROMIUM_VIDEO_EXTENSIONS.includes(videoExt(path));
}
