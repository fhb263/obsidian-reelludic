// 卡片信息栏「按书籍子分类」（#653）单测
// 契约：用户点名的类型顺序把「书籍」拆成 文学 / 网文 / 漫画 三格 ⇒ 三格各存一份，
// 没配过就一起继承「书籍」那份（零迁移）。
import { describe, expect, it } from 'vitest';
import {
    CARD_FIELD_DEFAULTS_BY_TYPE,
    cardFieldsFor,
    resolveCardFieldsByKind,
    resolveCardFieldsByType,
} from 'pure/cardMeta';

describe('resolveCardFieldsByKind · 回落链', () => {
    it('三个子类都没配 ⇒ 一律等于「书籍」那一份（零迁移：老用户升上来观感不变）', () => {
        const byType = resolveCardFieldsByType({ book: ['year', 'author', 'translator'] });
        const byKind = resolveCardFieldsByKind({ book: ['year', 'author', 'translator'] }, undefined);
        expect(byKind.book).toEqual(byType.book);
        expect(byKind.novel).toEqual(byType.book);
        expect(byKind.comic).toEqual(byType.book);
    });

    it('书籍也没配 ⇒ 走书籍预填（⛔ 不是空数组）', () => {
        const byKind = resolveCardFieldsByKind({}, {});
        expect(byKind.book).toEqual([...CARD_FIELD_DEFAULTS_BY_TYPE.book]);
        expect(byKind.novel).toEqual([...CARD_FIELD_DEFAULTS_BY_TYPE.book]);
    });

    it('只配了网文 ⇒ 只有网文变，文学 / 漫画仍继承「书籍」那份', () => {
        const byKind = resolveCardFieldsByKind(
            { book: ['year', 'author'] },
            { novel: ['genres', 'author'] },
        );
        expect(byKind.novel).toEqual(['genres', 'author']);
        expect(byKind.book).toEqual(['year', 'author']);
        expect(byKind.comic).toEqual(['year', 'author']);
    });

    it('子类的脏值按书籍池子归一（⛔ 不直接透传手改 data.json 留下的非法键）', () => {
        const byKind = resolveCardFieldsByKind({}, { comic: ['__nope__', 'author'] });
        expect(byKind.comic).not.toContain('__nope__');
        expect(byKind.comic[0]).toBe('author');
    });

    it('超出上限（5 条）会被截断 —— 与按类型那条同一个归一口径', () => {
        const many = ['year', 'creator', 'genres', 'author', 'translator', 'publisher'];
        const byKind = resolveCardFieldsByKind({}, { novel: many });
        expect(byKind.novel.length).toBe(5);
    });
});

describe('cardFieldsFor · 唯一取值出口', () => {
    // ⚠️ 夹具必须用**该类型池子里真有的键**：`director` 不在 `cardFieldOptionsFor('movie')` 里，
    //    `resolveCardFieldsByType` 会把它当脏值丢掉（那是它的本职），拿它当夹具只会测出假失败。
    const byType = resolveCardFieldsByType({ movie: ['creator'], book: ['year', 'author'] });
    const byKind = resolveCardFieldsByKind({ book: ['year', 'author'] }, { novel: ['genres'] });

    it('书籍看 bookKind：网文取网文那份', () => {
        expect(cardFieldsFor('book', 'novel', byType, byKind)).toEqual(['genres']);
    });

    it('书籍缺 bookKind ⇒ 按「文学」算（与 pure/bookKind 的缺省口径一致）', () => {
        expect(cardFieldsFor('book', undefined, byType, byKind)).toEqual(['year', 'author']);
    });

    it('非书籍类型仍走 byType（⛔ 别让它去翻书籍那几张表）', () => {
        expect(cardFieldsFor('movie', undefined, byType, byKind)).toEqual(['creator']);
        // 反向守卫：就算误传了 bookKind，电影也不该被当成书籍
        expect(cardFieldsFor('movie', 'novel', byType, byKind)).toEqual(['creator']);
    });

    it('byType 里没有该类型 ⇒ 空数组（= 该类型信息栏全关，合法的用户选择）', () => {
        const empty = resolveCardFieldsByType(undefined);
        void empty;
        const vacuous = {} as typeof byType;
        expect(cardFieldsFor('game', undefined, vacuous, byKind)).toEqual([]);
    });
});
