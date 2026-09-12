// MusicBrainz 音乐元数据（免 Key 公开 API；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://musicbrainz.org/ws/2/release-group/?query={q}&fmt=json&limit=20（URL 编码）
//   - 端点接入时校准（#165 T7）：2026-09-02 实测 HTTP 200（带 UA）；检索词形态 = 直接 query={q}
//     （Lucene 多字段检索，title/artist 均可命中）；实测响应无 cover-art-archive 字段（需额外 inc 参数）
//   - MusicBrainz 政策要求请求标识 User-Agent（~1rps 限流）；UA 由客户端在请求时统一带上
// 结果映射为 MusicSearchResult（与豆瓣音乐同型，字段对齐 resultTypes.MusicSearchResult；
// id=release-group id；album=title——MusicSearchResult 语义 album 存所属专辑名，release-group 即专辑；
// cover=coverartarchive 纯 URL 拼接展示，404 由 UI 占位，不在搜索时请求探测）
import { asRecord, parseYear } from 'pure/record';
import type { MusicSearchResult } from 'services/resultTypes';

/** 注入 HTTP GET（url + 可选 headers——MusicBrainz 需 UA；测试 mock 断言 UA 透传） */
export type HttpGet = (url: string, headers?: Record<string, string>) => Promise<string>;

/** MusicBrainz 政策要求的请求标识（UA 缺失会被拒/限流更严） */
export const USER_AGENT = 'ReelLudic/0.1 (obsidian plugin)';

const SEARCH_ENDPOINT = 'https://musicbrainz.org/ws/2/release-group/';

/** artist-credit 单条（name=展示名；joinphrase=接在此项之后的拼接文本，如 ' feat. ' / ' & '） */
export interface MusicBrainzCredit {
    name: string;
    /** 后接文本（末项通常缺省） */
    joinphrase?: string;
}

/** release-group 单条解析后的扁平原始形态（安全读取；缺 id/title 在 parse 已过滤） */
export interface RawMusicBrainzItem {
    /** release-group id（UUID 字符串，对齐 MusicSearchResult.id） */
    id: string;
    /** 专辑名 */
    title: string;
    /** 首发日期（ISO，如 2008-08-19；缺省则无年份可提取） */
    firstReleaseDate?: string;
    /** 主类型（Album/Single/EP…；MusicSearchResult 无对应字段，保留供测试断言不依赖） */
    primaryType?: string;
    /** artist-credit（缺省/空 → 无艺术家） */
    artistCredit?: MusicBrainzCredit[];
}

/** 构造搜索 URL（limit=20 上限 + fmt=json；测试用 fixture 快照固定） */
export function buildSearchUrl(query: string): string {
    return `${SEARCH_ENDPOINT}?query=${encodeURIComponent(query)}&fmt=json&limit=20`;
}

/**
 * 解析 release-group 响应：release-groups[] → RawMusicBrainzItem[]。
 * 异常条目容错：缺 id / 缺 title 的条目过滤；first-release-date / artist-credit / primary-type
 * 缺失安全保留（undefined）；release-groups 缺失/空 → 空数组。
 */
export function parseMusicBrainzResults(text: string): RawMusicBrainzItem[] {
    const data = asRecord(JSON.parse(text));
    const groups = Array.isArray(data['release-groups']) ? data['release-groups'] : [];
    return groups
        .map(asRecord)
        .filter((g) => typeof g.id === 'string' && g.id !== '' && typeof g.title === 'string' && g.title !== '')
        .map((g) => ({
            id: g.id as string,
            title: g.title as string,
            firstReleaseDate: typeof g['first-release-date'] === 'string' ? g['first-release-date'] : undefined,
            primaryType: typeof g['primary-type'] === 'string' ? g['primary-type'] : undefined,
            artistCredit: Array.isArray(g['artist-credit'])
                ? g['artist-credit']
                      .map(asRecord)
                      .filter((c) => typeof c.name === 'string' && c.name !== '')
                      .map((c) => ({
                          name: c.name as string,
                          joinphrase: typeof c.joinphrase === 'string' ? c.joinphrase : undefined,
                      }))
                : undefined,
        }));
}

/** artist-credit 顺序拼合：name 后接该项 joinphrase（如 [A,' feat. ',B] → `A feat. B`；[A,' & ',B] → `A & B`） */
export function joinArtistCredit(ac: MusicBrainzCredit[] | undefined): string | undefined {
    if (!ac || ac.length === 0) return undefined;
    return ac.map((c) => c.name + (c.joinphrase ?? '')).join('');
}

/** 搜索级条目 → MusicSearchResult（album=title：release-group 即专辑；cover 纯 URL 拼接不请求探测） */
export function toMusicResult(item: RawMusicBrainzItem): MusicSearchResult {
    return {
        id: item.id,
        title: item.title,
        artist: joinArtistCredit(item.artistCredit),
        album: item.title,
        year: parseYear(item.firstReleaseDate),
        // 仅作 URL 展示：404 时 UI 占位图兜底，绝不在搜索时请求 coverartarchive 探测（红线）
        cover: `https://coverartarchive.org/release-group/${item.id}/front`,
        source: 'musicbrainz',
        sourceUrl: `https://musicbrainz.org/release-group/${item.id}`,
    };
}

export class MusicBrainzClient {
    readonly name = 'musicbrainz';

    constructor(private http: HttpGet) {}

    /** 搜索 → MusicSearchResult[]（搜索级字段：专辑名/艺术家/首发年份/封面 URL） */
    async search(query: string): Promise<MusicSearchResult[]> {
        const text = await this.http(buildSearchUrl(query), { 'User-Agent': USER_AGENT });
        return parseMusicBrainzResults(text).map(toMusicResult);
    }
}
