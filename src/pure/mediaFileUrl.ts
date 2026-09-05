/**
 * 本地绝对路径 → file:// URL
 * 用途：Media Extended 编程入口 api.openUrl() 接受 URL 字符串；vault 外绝对路径需转成 file:// 形式
 * （ME 的 resolveMxProtocol 对 file:// + 非 vault 文件会继续解析并播放，这是它播放库外文件的官方支持路径）
 * Windows 盘符路径规范为 file:///D:/...（三斜杠：host 为空、盘符落在 path 中）
 */
export function toFileUrl(path: string): string {
    const p = path.replace(/\\/g, '/').replace(/^\/+/, '');
    // encodeURI 保留 # 与 ?，二者在 URL 中分别是 fragment / query 分隔符，文件名含之会被截断 → 显式编码
    return 'file:///' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
}
