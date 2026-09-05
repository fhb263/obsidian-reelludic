// 封面本地化文件名的标题清洗（v0.4 持续优化：covers/{标题}.jpg 命名）
// 纯逻辑无 obsidian 依赖，可单测；Windows/macOS 非法文件名字符统一替换为下划线

/** 非法文件名字符（Windows 保留字 \ / : * ? " < > |，macOS 冒号亦非法） */
const ILLEGAL = /[\\/:*?"<>|]/g;

/**
 * 将条目标题清洗为安全的封面文件名（不含扩展名）：
 * 非法字符 → 下划线，去除首尾空白；清洗后为空（如纯标点标题）→ 返回 '' 由调用方兜底
 */
export function sanitizePosterTitle(title: string): string {
    return title.replace(ILLEGAL, '_').trim();
}

/**
 * 弹窗会话结束后的孤儿封面清理：本次会话内 douban 封面已强制下载到本地（封面/{标题}.jpg），
 * 若用户最终未保存（取消弹窗）或保存时封面被替换/清空，这些下载文件不再被任何条目引用，应删除。
 *  downloaded：本次弹窗会话通过 onDownloadPoster 下载成功的封面相对路径列表；
 *  keep：保存成功且条目实际引用的封面相对路径（未保存/封面被清空时为 undefined/''）。
 * 返回应删除的路径（去重、过滤空串、排除 keep 引用的那张）。
 */
export function orphanedDownloadedPosters(downloaded: string[], keep?: string): string[] {
    return Array.from(new Set(downloaded.filter((p) => !!p && p !== keep)));
}

/**
 * 封面目录孤儿扫描（H 清理工具）：封面目录中未被任何条目 poster 引用的文件。
 *  coverFiles：封面目录下所有文件的**相对路径**清单（封面/xxx.jpg，不含库目录前缀——与 poster 存储格式一致）；
 *  referencedPosters：所有条目的 poster 值（含本地相对路径与 URL——URL 不参与本地比对）。
 * 返回应清理的孤儿文件路径（按 coverFiles 顺序，去重引用、过滤空值）。
 * ⚠️ 契约：coverFiles 与 referencedPosters 的本地路径必须同一格式（都是相对库目录），否则精确比对失配误判全部为孤儿。
 */
export function orphanCoverFiles(coverFiles: string[], referencedPosters: string[]): string[] {
    const ref = new Set(referencedPosters.filter((p): p is string => !!p && !/^https?:\/\//.test(p)));
    return coverFiles.filter((f) => !ref.has(f));
}
