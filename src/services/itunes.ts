// iTunes 音乐检索（免 Key 公开 API；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://itunes.apple.com/search?term={q}&entity=album&limit=20（URL 编码）
//   - 端点接入时校准（#165 T8）：entity=album 限定专辑——collection* 字段语义与 MusicSearchResult 对齐
//   - 免 UA/免 Key；结果含 artworkUrl100 尺寸后缀（实测 URL 形态 .../source/100x100bb.jpg）
// 结果映射为 MusicSearchResult（与豆瓣音乐/musicbrainz 同型，字段对齐 resultTypes.MusicSearchResult；
// id=String(collectionId)——collectionId 为 number，MusicSearchResult.id: string 归一（同型约束）；
// album=collectionName（所属专辑名）；cover=artworkUrl100 尺寸 token 放大 600x600bb（无 artwork/token → undefined）；
// summary 不映射（primaryGenreName 是流派非简介，MusicSearchResult.summary 语义为条目简介文案——缺失即不填）；
// sourceUrl=collectionViewUrl（结果自带直填；缺省 undefined 由 UI 兜底））
import { asRecord, parseYear } from 'pure/record';
import type { MusicSearchResult } from 'services/resultTypes';

/** 注入 HTTP GET（URL 参数化；测试 mock 断言 URL 形态） */
export type HttpGet = (url: string) => Promise<string>;

const SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
/** artwork 放大目标尺寸 token（尺寸后缀形态 NNNxNNNbb，如实测 URL 的 100x100bb） */
const UPSCALE_SIZE = '600x600bb';

/** entity=album 单条解析后的扁平原始形态（安全读取；缺 collectionId/collectionName 在 parse 已过滤） */
export interface RawItunesItem {
    /** collectionId（number，iTunes 数字专辑 id；映射时 String() 归一对齐 MusicSearchResult.id: string） */
    collectionId: number;
    /** 专辑名 */
    collectionName: string;
    /** 歌手（缺省 → 无艺术家） */
    artistName?: string;
    /** 发行日期（ISO 时间串，如 2008-08-19T07:00:00Z；缺省/畸形则无年份可提取） */
    releaseDate?: string;
    /** 专辑封面（100px，映射时放大 600x600bb） */
    artworkUrl100?: string;
    /** 官方专辑页链接（结果自带） */
    collectionViewUrl?: string;
}

/** 构造搜索 URL（entity=album 限定专辑 + limit=20 上限；测试用 fixture 快照固定） */
export function buildSearchUrl(query: string): string {
    return `${SEARCH_ENDPOINT}?term=${encodeURIComponent(query)}&entity=album&limit=20`;
}

/**
 * 解析 search 响应：results[] → RawItunesItem[]。
 * 异常条目容错：缺 collectionId（非有限 number）/ 缺 collectionName 的条目过滤；
 * artistName / releaseDate / artworkUrl100 / collectionViewUrl 缺失安全保留（undefined）；results 缺失/空 → 空数组。
 */
export function parseItunesResults(text: string): RawItunesItem[] {
    const data = asRecord(JSON.parse(text));
    const results = Array.isArray(data.results) ? data.results : [];
    return results
        .map(asRecord)
        .filter(
            (it) =>
                typeof it.collectionId === 'number' &&
                Number.isFinite(it.collectionId) &&
                typeof it.collectionName === 'string' &&
                it.collectionName !== '',
        )
        .map((it) => ({
            collectionId: it.collectionId as number,
            collectionName: it.collectionName as string,
            artistName: typeof it.artistName === 'string' && it.artistName !== '' ? it.artistName : undefined,
            releaseDate: typeof it.releaseDate === 'string' ? it.releaseDate : undefined,
            artworkUrl100: typeof it.artworkUrl100 === 'string' ? it.artworkUrl100 : undefined,
            collectionViewUrl: typeof it.collectionViewUrl === 'string' ? it.collectionViewUrl : undefined,
        }));
}

/** artworkUrl100 → 600x600bb 放大：尺寸 token（NNNxNNNbb）原位替换；无 artwork 或无 token 无法放大 → undefined */
export function upscaleArtwork(url: string | undefined): string | undefined {
    if (!url) return undefined;
    const seg = url.match(/\d+x\d+bb/);
    return seg ? url.replace(seg[0], UPSCALE_SIZE) : undefined;
}

/** 搜索级条目 → MusicSearchResult（id=String(collectionId)；album=collectionName；cover=artwork 放大） */
export function toMusicResult(item: RawItunesItem): MusicSearchResult {
    return {
        id: String(item.collectionId),
        title: item.collectionName,
        artist: item.artistName,
        album: item.collectionName,
        year: parseYear(item.releaseDate),
        cover: upscaleArtwork(item.artworkUrl100),
        source: 'itunes',
        sourceUrl: item.collectionViewUrl,
    };
}

export class ItunesClient {
    readonly name = 'itunes';

    constructor(private http: HttpGet) {}

    /** 搜索 → MusicSearchResult[]（搜索级字段：专辑名/歌手/年份/放大封面/官方页链接） */
    async search(query: string): Promise<MusicSearchResult[]> {
        const text = await this.http(buildSearchUrl(query));
        return parseItunesResults(text).map(toMusicResult);
    }
}
