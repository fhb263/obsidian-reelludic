// 数据源搜索结果统一类型（v0.4 起书籍/游戏仅由 Douban 提供，类型定义独立于此文件，
// 避免依赖已删除的 googleBooks/rawg 服务模块；纯类型无逻辑，可被任何服务引用）
// 字段对齐豆瓣详情模板：书籍（作者/译者/出版社/出品方/ISBN/装帧/定价/丛书/页数）、
// 游戏（平台/开发商/发行商/类型）

/** 书籍搜索结果（Google Books 时代遗留形状，现仅 Douban 产生；含豆瓣详情字段） */
export interface BookSearchResult {
    id: string;
    title: string;
    author?: string;
    /** 译者（豆瓣详情回填） */
    translator?: string;
    publisher?: string;
    /** 出品方（豆瓣详情回填） */
    producer?: string;
    /** ISBN（豆瓣详情回填） */
    isbn?: string;
    /** 装帧（豆瓣详情回填） */
    binding?: string;
    /** 定价（豆瓣详情回填） */
    price?: string;
    /** 丛书（豆瓣详情回填） */
    series?: string;
    /** 页数 */
    pageCount?: number;
    year?: number;
    thumbnail?: string;
    description?: string;
    /** 类型/题材（书籍回填表单 genres） */
    genres?: string[];
    /** 大众评分（豆瓣 10 分制） */
    rating?: number;
    /** 豆瓣评价人数（搜索/详情回填，「评分（N人评价）」展示） */
    ratingCount?: number;
    /** 作者简介（豆瓣详情页，图书） */
    authorIntro?: string;
    /** 目录（豆瓣详情页，图书） */
    toc?: string;
    /** 来源标识：douban */
    source?: string;
    /** 数据源官方页链接（来源徽标直达） */
    sourceUrl?: string;
}

/** 游戏搜索结果（RAWG 时代遗留形状，现仅 Douban 产生；含豆瓣详情字段） */
export interface GameSearchResult {
    id: number;
    title: string;
    platform?: string;
    developer?: string;
    /** 发行商（豆瓣详情回填） */
    publisher?: string;
    year?: number;
    cover?: string;
    summary?: string;
    /** 类型/题材（豆瓣详情回填） */
    genres?: string[];
    /** 大众评分（豆瓣 10 分制） */
    rating?: number;
    /** 豆瓣评价人数 */
    ratingCount?: number;
    /** 来源标识：douban */
    source?: string;
    /** 数据源官方页链接 */
    sourceUrl?: string;
}

/** 音乐搜索结果（Douban 单源；含豆瓣详情字段） */
export interface MusicSearchResult {
    id: string;
    title: string;
    /** 歌手/艺术家（豆瓣详情回填，存 MediaEntry.author） */
    artist?: string;
    /** 所属专辑（豆瓣详情回填） */
    album?: string;
    year?: number;
    cover?: string;
    summary?: string;
    /** 大众评分（豆瓣 10 分制） */
    rating?: number;
    /** 豆瓣评价人数 */
    ratingCount?: number;
    /** 来源标识：douban */
    source?: string;
    /** 数据源官方页链接 */
    sourceUrl?: string;
}

/** OMDb（IMDb 数据）影视搜索结果（#165 T9 新增；独立类型，不并入 TmdbSearchResult——
 *  imdbID 为字符串而 TmdbSearchResult.id:number，禁止强塞；决策断言见 tests/omdb.test.ts）。
 *  字段取影视 shape 分支实际读取的可选子集：title/year/poster 回填展示，rating/ratingCount
 *  搜索级暂无（OMDb 仅详情返回评分），类型声明保留可选以与影视结果联合读取安全。 */
export interface OmdbSearchResult {
    /** IMDb id（字符串，如 tt0111161；与 imdbID 同值，供 merge/去重与直达） */
    id: string;
    /** IMDb id（展示层直达 https://www.imdb.com/title/{imdbID}；与 id 同值） */
    imdbID: string;
    title: string;
    /** 发行年份（Year 容错：`1994` / `1994–` / `1994-2000` 均取首 4 位） */
    year?: number;
    /** 海报 URL（源值 `N/A` 已在 parse 滤除 → undefined，UI 占位图兜底） */
    poster?: string;
    /** 大众评分（数据源；IMDb 10 分制，仅详情回填后有值） */
    rating?: number;
    /** 评价人数（仅详情回填后有值，imdbVotes 去逗号） */
    ratingCount?: number;
    /** 来源标识：omdb */
    source: 'omdb';
    /** IMDb 官方页直达（id 同源拼接） */
    sourceUrl?: string;
}
