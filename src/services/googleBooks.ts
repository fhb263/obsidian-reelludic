// Google Books 书籍元数据（公开 API；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=20
//   - settings.googleBooksApiKey 可选：有值拼 &key=（仅提升配额/免限流）；未配即不带 key 请求
//   - 免费额度 429 属限流 → 由 main runner 静默降级（failed），不弹 Notice（T3 收敛）
// 结果映射为 BookSearchResult（与豆瓣书籍同型，字段对齐 resultTypes.BookSearchResult）
import { asRecord, parseYear } from 'pure/record';
import type { BookSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string) => Promise<string>;

const API_BASE = 'https://www.googleapis.com';
const VOLUMES_PATH = '/books/v1/volumes';

/** volumes 单条 item 解析后的扁平原始形态（字段缺失安全读取，均为可选） */
export interface RawGoogleBooksItem {
    id?: string;
    title?: string;
    authors?: string[];
    publisher?: string;
    /** publishedDate 前 4 位年（'2000-05-15' / '2000' 均取整） */
    year?: number;
    pageCount?: number;
    /** categories 截 3 */
    categories?: string[];
    description?: string;
    /** imageLinks.thumbnail 原样（无 imageLinks 则 undefined；含 &zoom= 保留） */
    thumbnail?: string;
    /** industryIdentifiers 优先取 ISBN_13（缺则回退 ISBN_10） */
    isbn?: string;
    infoLink?: string;
}

/** 构造搜索 URL（maxResults=20；apiKey 有值才拼 &key=——未配即不带 key） */
export function buildSearchUrl(query: string, apiKey?: string, maxResults: number = 20): string {
    const url = `${API_BASE}${VOLUMES_PATH}?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
    return apiKey ? `${url}&key=${encodeURIComponent(apiKey)}` : url;
}

function strArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string');
    return out.length > 0 ? out : undefined;
}

function firstOf(arr: string[] | undefined): string | undefined {
    return arr && arr.length > 0 ? arr[0] : undefined;
}

/** industryIdentifiers[] → ISBN：ISBN_13 优先；缺 ISBN_13 回退 ISBN_10（两者皆无 → undefined） */
function isbnOf(ids: unknown): string | undefined {
    if (!Array.isArray(ids)) return undefined;
    let isbn10: string | undefined;
    for (const raw of ids) {
        const e = asRecord(raw);
        if (typeof e.identifier !== 'string' || !e.identifier) continue;
        if (e.type === 'ISBN_13') return e.identifier;
        if (e.type === 'ISBN_10' && isbn10 === undefined) isbn10 = e.identifier;
    }
    return isbn10;
}

/** imageLinks.thumbnail 原样读取（无 imageLinks → undefined） */
function thumbnailOf(imageLinks: unknown): string | undefined {
    const links = asRecord(imageLinks);
    return typeof links.thumbnail === 'string' && links.thumbnail ? links.thumbnail : undefined;
}

/** 解析 volumes 响应：items[] → RawGoogleBooksItem[]（title 缺失滤除该条；缺 id 同理滤除——sourceUrl 无法构造） */
export function parseGoogleBooksResults(text: string): RawGoogleBooksItem[] {
    const data = asRecord(JSON.parse(text));
    const items = Array.isArray(data.items) ? data.items : [];
    return items
        .map(asRecord)
        .map((it) => {
            const vi = asRecord(it.volumeInfo);
            return {
                id: typeof it.id === 'string' ? it.id : undefined,
                title: typeof vi.title === 'string' ? vi.title : undefined,
                authors: strArray(vi.authors),
                publisher: typeof vi.publisher === 'string' && vi.publisher ? vi.publisher : undefined,
                year: parseYear(vi.publishedDate),
                pageCount: typeof vi.pageCount === 'number' ? vi.pageCount : undefined,
                categories: strArray(vi.categories)?.slice(0, 3),
                description: typeof vi.description === 'string' && vi.description ? vi.description : undefined,
                thumbnail: thumbnailOf(vi.imageLinks),
                isbn: isbnOf(vi.industryIdentifiers),
                infoLink: typeof vi.infoLink === 'string' && vi.infoLink ? vi.infoLink : undefined,
            };
        })
        .filter((r) => typeof r.id === 'string' && typeof r.title === 'string');
}

/** 搜索级条目 → BookSearchResult（thumbnail 原样；无 imageLinks → undefined；sourceUrl=books?id={id}） */
export function toBookResult(item: RawGoogleBooksItem): BookSearchResult {
    const id = item.id ?? '';
    return {
        id,
        title: item.title ?? '',
        author: firstOf(item.authors),
        publisher: item.publisher,
        isbn: item.isbn,
        year: item.year,
        pageCount: item.pageCount,
        description: item.description,
        genres: item.categories,
        // 无 imageLinks → undefined（UI 占位图）
        thumbnail: item.thumbnail,
        source: 'googleBooks',
        sourceUrl: id ? `https://books.google.com/books?id=${id}` : undefined,
    };
}

export class GoogleBooksClient {
    readonly name = 'googleBooks';

    /** key 以 getter 注入：每次请求现读 settings（key 变更无需重建 client；空/缺省即不带 key 请求） */
    constructor(
        private http: HttpGet,
        private apiKey: () => string | undefined,
    ) {}

    /** 搜索 → BookSearchResult[]（搜索级已含简介/页数/分类/ISBN/封面，点选直接回填） */
    async search(query: string): Promise<BookSearchResult[]> {
        const text = await this.http(buildSearchUrl(query, this.apiKey() || undefined));
        return parseGoogleBooksResults(text).map(toBookResult);
    }
}
