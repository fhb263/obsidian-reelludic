// 资源链接平台标签识别（纯逻辑，无 obsidian 依赖）
// 供 EntryForm 添加资源链接时「粘贴 URL 自动识别平台」，识别不到由用户手动选择

interface PlatformGuess {
    /** 主域名（hostname 精确匹配或子域后缀 .domain 匹配） */
    domains?: string[];
    /** 关键词回退（hostname 小写包含匹配，域名表未命中时兜底） */
    keywords?: string[];
    label: string;
}

/** 平台识别表：域名优先，标签与默认平台模板一致（B站/Netflix/豆瓣/爱奇艺/腾讯视频） */
const PLATFORM_GUESSES: PlatformGuess[] = [
    { domains: ['bilibili.com', 'b23.tv'], label: 'B站' },
    { domains: ['iqiyi.com', 'iq.com'], label: '爱奇艺' },
    { domains: ['qq.com'], keywords: ['video.qq.com'], label: '腾讯视频' },
    { domains: ['netflix.com'], label: 'Netflix' },
    { domains: ['douban.com', 'doubanio.com'], label: '豆瓣' },
    { domains: ['youku.com'], label: '优酷' },
    { domains: ['mgtv.com'], label: '芒果TV' },
    { domains: ['youtube.com', 'youtu.be'], label: 'YouTube' },
    { domains: ['primevideo.com', 'amazon.com', 'amazon.cn'], label: 'Amazon Prime Video' },
    { domains: ['disneyplus.com', 'hotstar.com'], label: 'Disney+' },
    { domains: ['max.com', 'hbomax.com', 'hbo.com'], label: 'HBO Max' },
    { domains: ['tv.apple.com'], label: 'Apple TV' },
    { domains: ['sohu.com'], label: '搜狐' },
    { domains: ['acfun.cn'], label: 'AcFun' },
    { domains: ['1905.com'], label: '1905电影网' },
    { domains: ['le.com'], label: '乐视' },
    { domains: ['ixigua.com'], label: '西瓜视频' },
    { domains: ['douyin.com'], label: '抖音' },
];

/** 从 URL 提取 hostname（小写）；无协议自动补 https，解析失败返回空串 */
function extractHost(raw: string): string {
    const url = raw.trim();
    if (!url) return '';
    const withScheme = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    try {
        return new URL(withScheme).hostname.toLowerCase();
    } catch {
        // URL 解析失败（如纯乱串）：退化用正则取第一段
        const m = withScheme.match(/^https?:\/\/([^/?#]+)/i);
        return m ? m[1].toLowerCase() : '';
    }
}

/**
 * 识别资源链接对应的平台标签；识别不到返回空串（调用方回退手动选择）。
 * 匹配优先级：主域名精确/子域后缀 → hostname 关键词包含。
 */
export function guessPlatformLabel(rawUrl: string): string {
    const host = extractHost(rawUrl);
    if (!host) return '';
    for (const g of PLATFORM_GUESSES) {
        for (const d of g.domains ?? []) {
            // 精确或子域后缀（.bilibili.com），防误匹配（notbilibili.com 不以 .bilibili.com 结尾）
            if (host === d || host.endsWith('.' + d)) return g.label;
        }
    }
    for (const g of PLATFORM_GUESSES) {
        for (const k of g.keywords ?? []) {
            if (host.includes(k)) return g.label;
        }
    }
    return '';
}
