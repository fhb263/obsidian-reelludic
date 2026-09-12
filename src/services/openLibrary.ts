// Open Library 书籍元数据（免 Key 公开 API；纯逻辑：HTTP 注入可 mock）
// 搜索：GET https://openlibrary.org/search.json?q={q}&limit=20&fields=…
// 点选补全：GET https://openlibrary.org{key}.json（works/edition 记录：description/number_of_pages/publishers）
// 结果映射为 BookSearchResult（与豆瓣书籍同型，字段对齐 resultTypes.BookSearchResult）
import { asRecord } from 'pure/record';
import type { BookSearchResult } from 'services/resultTypes';

export type HttpGet = (url: string) => Promise<string>;

const API_BASE = 'https://openlibrary.org';
const SEARCH_PATH = '/search.json';
const FIELDS = 'key,title,author_name,first_publish_year,publisher,isbn,cover_i,subject';

/** search.json 单条 docs（原始字段形态；字段缺失安全读取，均为可选） */
export interface RawOpenLibraryItem {
    /** 作品 key（完整路径，如 /works/OL45883W——保留前缀，sourceUrl 直接拼接一致） */
    key?: string;
    title?: string;
    author_name?: string[];
    first_publish_year?: number;
    publisher?: string[];
    isbn?: string[];
    cover_i?: number;
    subject?: string[];
}

/** 构造搜索 URL（limit=20 + fields 白名单，字段以实测返回为准；测试用 fixture 快照固定） */
export function buildSearchUrl(query: string, limit: number = 20): string {
    return `${API_BASE}${SEARCH_PATH}?q=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`;
}

function strArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string');
    return out.length > 0 ? out : undefined;
}

function firstOf(arr: string[] | undefined): string | undefined {
    return arr && arr.length > 0 ? arr[0] : undefined;
}

/** 解析 search.json 响应：docs 数组 → RawOpenLibraryItem[]（缺 key/title 的异常条目过滤） */
export function parseOpenLibraryResults(text: string): RawOpenLibraryItem[] {
    const data = asRecord(JSON.parse(text));
    const docs = Array.isArray(data.docs) ? data.docs : [];
    return docs
        .map(asRecord)
        .filter((d) => typeof d.key === 'string' && typeof d.title === 'string')
        .map((d) => ({
            key: d.key as string,
            title: d.title as string,
            author_name: strArray(d.author_name),
            first_publish_year: typeof d.first_publish_year === 'number' ? d.first_publish_year : undefined,
            publisher: strArray(d.publisher),
            isbn: strArray(d.isbn),
            cover_i: typeof d.cover_i === 'number' ? d.cover_i : undefined,
            subject: strArray(d.subject),
        }));
}

/** 搜索级条目 → BookSearchResult（id 存完整 key 路径，sourceUrl 同源拼接；搜索级无页数故不填） */
export function toBookResult(item: RawOpenLibraryItem): BookSearchResult {
    const key = item.key ?? '';
    return {
        id: key,
        title: item.title ?? '',
        author: firstOf(item.author_name),
        publisher: firstOf(item.publisher),
        isbn: firstOf(item.isbn),
        year: item.first_publish_year,
        // 无 cover_i 则无封面（undefined → UI 占位图）
        thumbnail: typeof item.cover_i === 'number' ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : undefined,
        genres: item.subject ? item.subject.slice(0, 3) : undefined,
        source: 'openLibrary',
        sourceUrl: key ? `${API_BASE}${key}` : undefined,
    };
}

/** {key}.json 点选补全详情（works/edition 记录可用字段） */
export interface OpenLibraryWorkDetail {
    description?: string;
    numberOfPages?: number;
    publishers?: string[];
}

/** works/edition JSON description 形态：纯字符串或 {type:'/type/text', value}（/type/text 对象） */
function descriptionText(v: unknown): string | undefined {
    if (typeof v === 'string' && v) return v;
    const o = asRecord(v);
    return typeof o.value === 'string' && o.value ? o.value : undefined;
}

/**
 * 解析 {key}.json（works/edition 记录）：description/number_of_pages/publishers 安全读取；
 * 非 JSON / 非对象 → null。缺字段返回 undefined（works 级常无 number_of_pages，不崩）。
 */
export function parseOpenLibraryWorks(text: string): OpenLibraryWorkDetail | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
    const d = asRecord(data);
    const pages = d.number_of_pages;
    const publishers = strArray(d.publishers) ?? (typeof d.publishers === 'string' && d.publishers ? [d.publishers] : undefined);
    return {
        description: descriptionText(d.description),
        numberOfPages: typeof pages === 'number' ? pages : (typeof pages === 'string' && /^\d+$/.test(pages) ? Number(pages) : undefined),
        publishers,
    };
}

export class OpenLibraryClient {
    readonly name = 'openLibrary';

    constructor(private http: HttpGet) {}

    /** 搜索 → BookSearchResult[]（搜索级字段；无简介/页数，由点选 works.json 补全） */
    async search(query: string): Promise<BookSearchResult[]> {
        const text = await this.http(buildSearchUrl(query));
        return parseOpenLibraryResults(text).map(toBookResult);
    }

    /** 点选补全：{key}.json 详情（简介/页数/出版社）；key 形如 /works/OL…，URL 直接拼 .json */
    async fetchWorkDetail(key: string): Promise<OpenLibraryWorkDetail> {
        if (!key) return {};
        const text = await this.http(`${API_BASE}${key}.json`);
        return parseOpenLibraryWorks(text) ?? {};
    }
}
