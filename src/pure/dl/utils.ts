/**
 * ⬇️ 2026-09-28 移植自 `obsidian-lyricflux/src/downloadUtils.ts`（v1.4.4，同作者；正本 LICENSE 文件 = GPL-3.0 全文）。
 * ⚠️ `sanitizeFilename` 与本仓 `pure/downloadPlan.sanitizeDownloadName` **职责重叠**：
 *    移植期先并存（各服务各用其一份），**T3 接线时必须收敛成一份**（本仓既有那份已被断言钉住 ⇒ 留它）。
 */
/**
 * 下载相关纯逻辑（无 obsidian 依赖，可单测）。
 * 内置网易云下载（v1.4.1）：文件名校验与构造。
 */

/** 文件名非法字符净化（替换 Windows 非法字符，保留中文/空格） */
export function sanitizeFilename(name: string): string {
    const cleaned = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
    return cleaned || 'Unknown'
}

/** 百科搜索来源（v1.4.4 功能增强）：百度百科 / 维基百科 / 豆瓣音乐 */
export type WikiSource = 'baike' | 'wikipedia' | 'douban'

/**
 * 构造百科来源的搜索 URL（v1.4.4）：关键词编码后替换 `%s` 模板。
 * - 百度百科：`https://baike.baidu.com/item/{词条}`
 * - 维基百科：`https://zh.wikipedia.org/w/index.php?search={关键词}`
 * - 豆瓣音乐：`https://search.douban.com/music/subject_search?search_text={关键词}`
 */
export function buildSourceSearchUrl(source: WikiSource, keyword: string): string {
    const kw = encodeURIComponent((keyword || '').trim())
    switch (source) {
        case 'baike':
            return `https://baike.baidu.com/item/${kw}`
        case 'wikipedia':
            return `https://zh.wikipedia.org/w/index.php?search=${kw}`
        case 'douban':
            return `https://search.douban.com/music/subject_search?search_text=${kw}`
        default:
            return ''
    }
}

/** 构造下载文件名：`艺术家 - 标题.{ext}`（缺项用 Unknown 兜底，ext 缺省 mp3） */
export function buildSongFilename(artist: string, title: string, ext = 'mp3'): string {
    const a = sanitizeFilename(artist || 'Unknown')
    const n = sanitizeFilename(title || 'Unknown')
    const e = (ext || 'mp3').replace(/^\./, '') || 'mp3'
    return `${a} - ${n}.${e}`
}

/**
 * 搜索相似度打分（下载多源结果排序用，v1.4.1）：
 * 标题精确/包含关键词 + 逐 token 标题命中 + 艺术家命中 + 标题长度惩罚（Live/Remix 等附加词越短越精确）。
 * 分越高越相似，供跨平台结果按相关度而非平台顺序排列。
 */
export function songSimilarityScore(keyword: string, name: string, artist: string): number {
    const kw = keyword.toLowerCase().trim()
    const n = name.toLowerCase().trim()
    const a = artist.toLowerCase().trim()
    if (!n) return -1
    const tokens = kw.split(/\s+/).filter(Boolean)
    let score = 0
    // 标题：整个关键词就是标题，或标题在关键词里（「晴天 周杰伦」含「晴天」）
    if (n === kw) score += 80
    else if (kw.includes(n)) score += 50
    else if (n.includes(kw)) score += 40
    // 逐 token：标题 token 精确/包含命中 + 艺术家命中（覆盖「晴天 周杰伦」双 token）
    for (const t of tokens) {
        if (n === t) score += 25
        else if (n.includes(t)) score += 12
        if (a.includes(t)) score += 30
        else {
            const ct = t.replace(/[.、，,·\-—\s]+$/g, '')
            if (ct && a.includes(ct)) score += 22
        }
    }
    // 标题附加词惩罚：晴天 > 晴天 (Live)
    score -= n.length / 10
    return score
}

/**
 * 网易云歌曲是否可下载（VIP 过滤，v1.4.2）：
 * fee 缺省视为可下；fee>0（VIP/付费/试听）外链拿不到完整音频，搜索时屏蔽。
 */
export function isNeteaseDownloadable(fee: number | undefined): boolean {
    return !(fee && fee > 0)
}

/** 时长格式化（秒 → MM:SS，如 269 → 4:29；≥1 小时 → H:MM:SS）；非法输入返回空串 */
export function formatDuration(seconds: number | undefined): string {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const ss = String(s).padStart(2, '0')
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
    return `${m}:${ss}`
}

/** 生成平台歌曲网页地址所需的 ID 载体（v1.4.4：搜索结果来源标识跳转） */
export type DownloadWebTarget = {
    source: 'netease' | 'qq' | 'kugou' | 'kuwo'
    id: string
    songmid?: string
    kuwoRid?: string
}

/**
 * 生成平台歌曲网页地址（v1.4.4）：网易云 `music.163.com/#/song?id=`、QQ `y.qq.com/n/ryqq/songDetail/{mid}`、
 * 酷狗 `kugou.com/song/#hash=`、酷我 `kuwo.cn/play_detail/{rid}`；缺少必要 ID 时返回 null（不生成链接）。
 */
export function buildSongWebUrl(song: DownloadWebTarget): string | null {
    switch (song.source) {
        case 'netease':
            return song.id ? `https://music.163.com/#/song?id=${encodeURIComponent(song.id)}` : null
        case 'qq': {
            const mid = song.songmid || song.id
            return mid ? `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(mid)}` : null
        }
        case 'kugou':
            return song.id ? `https://www.kugou.com/song/#hash=${encodeURIComponent(song.id)}` : null
        case 'kuwo': {
            const rid = song.kuwoRid || song.id
            return rid ? `https://www.kuwo.cn/play_detail/${encodeURIComponent(rid)}` : null
        }
        default:
            return null
    }
}

/**
 * 生成平台歌单网页地址（v1.4.4）：网易云 `music.163.com/#/playlist?id=`、QQ `y.qq.com/n/ryqq/playlist/{id}`（登录后可见）、
 * 酷我 `kuwo.cn/playlist_detail/{id}`。**酷狗歌单网页反爬（Access Denied），不生成跳转链接（返回空串），UI 降级为纯文本来源标识。**
 */
export function buildPlaylistWebUrl(source: 'netease' | 'qq' | 'kugou' | 'kuwo', id: string): string {
    if (!id) return ''
    switch (source) {
        case 'netease':
            return `https://music.163.com/#/playlist?id=${encodeURIComponent(id)}`
        case 'qq':
            return `https://y.qq.com/n/ryqq/playlist/${encodeURIComponent(id)}`
        case 'kugou':
            return ''
        case 'kuwo':
            return `https://www.kuwo.cn/playlist_detail/${encodeURIComponent(id)}`
        default:
            return ''
    }
}

/**
 * 构造 OpenAI 兼容 `/models` 端点 URL（v1.4.4 纯逻辑）：Base URL 去尾斜杠后拼 `/models`。空/空白返回 ''。
 * 若 Base 已是完整 `/chat/completions`，先去掉该后缀再拼 `/models`。
 */
export function buildOpenaiModelsUrl(baseUrl: string): string {
    const b = (baseUrl || '').trim().replace(/\/+$/, '')
    if (!b) return ''
    const base = /\/chat\/completions$/i.test(b) ? b.replace(/\/chat\/completions$/i, '') : b
    return `${base}/models`
}

/** 解析 OpenAI 兼容 `/models` 响应（v1.4.4 纯逻辑）：提取 `data[].id` 字符串列表；非对象/空数据返回空数组 */
export function parseOpenaiModelsResponse(text: string): string[] {
    try {
        const data = JSON.parse(text) as { data?: Array<{ id?: unknown }> }
        const ids = (data?.data ?? [])
            .map((m) => (typeof m?.id === 'string' ? m.id : ''))
            .filter((id) => id.length > 0)
        return ids
    } catch {
        return []
    }
}
