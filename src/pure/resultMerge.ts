import type { TmdbDetail, TmdbSearchResult } from 'services/tmdb';

/**
 * 详情预取合并（非空覆盖）：搜索级结果缺 year/rating/director/cast/genres，
 * 详情拉取后回填，让搜索结果 row2「一览即见」作者/年份/评分。
 * 纯函数：不修改原对象，只覆盖有值字段。
 */
export function mergeTmdbDetail(r: TmdbSearchResult, d: Partial<TmdbDetail>): TmdbSearchResult {
    return {
        ...r,
        year: d.year ?? r.year,
        rating: d.rating ?? r.rating,
        ratingCount: d.ratingCount ?? r.ratingCount,
        director: d.director ?? r.director,
        cast: d.cast && d.cast.length ? d.cast : r.cast,
        genres: d.genres && d.genres.length ? d.genres : r.genres,
    };
}
