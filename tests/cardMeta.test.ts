// 卡片元信息文本（pure/cardMeta）单测 — 海报墙占位防错位
// 卡片网格同列依赖 subtitle/creator 两行高度一致，数据缺失返回「—」占位
// 保持行占位，避免同列卡片错位。
import { describe, it, expect } from 'vitest';
import { audioSubtitle, cardSubtitle, hasCardSubtitle, cardCreator, hasCardCreator, cardGenres, hasCardGenres, CARD_FIELD_DEFAULTS_BY_TYPE, CARD_FIELD_LIMIT, CARD_FIELD_OPTIONS, CARD_PREVIEW_ENTRIES, DEFAULT_CARD_FIELDS_BY_TYPE, cardFieldOptionsFor, cardFieldValue, normalizeCardFieldsForType, resolveCardFieldsByType, seriesCardFieldValue } from 'pure/cardMeta';
import { ENTRY_TYPES, type EntryType, type MediaEntry } from 'data/types';
import type { SeriesGroup } from 'pure/seriesGroup';

/** 最小化构造器：测试只关心参与分支的字段，其余走 default 填充 */
function entry(partial: Partial<MediaEntry>): MediaEntry {
    const base: MediaEntry = {
        id: 'e1',
        type: 'movie',
        title: 'X',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
    };
    return { ...base, ...partial };
}

describe('cardSubtitle 卡片副行（年份槽）', () => {
    it('电影有年份：返回年份字符串', () => {
        expect(cardSubtitle(entry({ type: 'movie', year: 2004 }))).toBe('2004');
    });

    it('电影无年份：返回占位符「—」（防止同行卡片错位）', () => {
        expect(cardSubtitle(entry({ type: 'movie' }))).toBe('—');
    });

    it('电视剧无年份同样占位（覆盖另一影视类型）', () => {
        expect(cardSubtitle(entry({ type: 'tv' }))).toBe('—');
    });

    it('音乐：专辑 + 年份拼接', () => {
        const m = entry({ type: 'music', album: 'Album X', year: 2020 });
        expect(cardSubtitle(m)).toBe('Album X · 2020');
    });

    it('音乐仅有专辑：仅返回专辑', () => {
        const m = entry({ type: 'music', album: 'Album X' });
        expect(cardSubtitle(m)).toBe('Album X');
    });

    it('音乐仅有年份：仅返回年份', () => {
        const m = entry({ type: 'music', year: 2020 });
        expect(cardSubtitle(m)).toBe('2020');
    });

    it('音乐无专辑无年份：返回占位符「—」', () => {
        expect(cardSubtitle(entry({ type: 'music' }))).toBe('—');
    });

    it('书籍无年份同样占位（书籍常见无豆瓣年份）', () => {
        expect(cardSubtitle(entry({ type: 'book' }))).toBe('—');
    });
});

describe('hasCardSubtitle 副行是否为真实内容（用于决定 title tooltip 是否设置）', () => {
    it('电影有年份 → true', () => {
        expect(hasCardSubtitle(entry({ type: 'movie', year: 2004 }))).toBe(true);
    });

    it('电影无年份 → false', () => {
        expect(hasCardSubtitle(entry({ type: 'movie' }))).toBe(false);
    });

    it('音乐有任一字段 → true', () => {
        expect(hasCardSubtitle(entry({ type: 'music', album: 'A' }))).toBe(true);
        expect(hasCardSubtitle(entry({ type: 'music', year: 2020 }))).toBe(true);
    });

    it('音乐全无 → false', () => {
        expect(hasCardSubtitle(entry({ type: 'music' }))).toBe(false);
    });
});

describe('cardCreator 卡片创作者行（导演 / 作者 / 开发商槽）', () => {
    it('有导演：返回导演', () => {
        expect(cardCreator(entry({ director: '克里斯托弗·诺兰' }))).toBe('克里斯托弗·诺兰');
    });

    it('无导演有作者：回退作者（书籍）', () => {
        expect(cardCreator(entry({ type: 'book', author: '东野圭吾' }))).toBe('东野圭吾');
    });

    it('无导演无作者有开发商：回退开发商（游戏）', () => {
        expect(cardCreator(entry({ type: 'game', developer: 'FromSoftware' }))).toBe('FromSoftware');
    });

    it('书籍同时有作者与导演：导演优先（先匹配先返回）', () => {
        expect(cardCreator(entry({ type: 'book', director: '某导演', author: '某作者' }))).toBe('某导演');
    });

    it('全无：返回占位符「—」（防错位核心场景）', () => {
        expect(cardCreator(entry({ type: 'movie' }))).toBe('—');
    });
});

describe('hasCardCreator 创作者行是否为真实内容', () => {
    it('有任一字段 → true', () => {
        expect(hasCardCreator(entry({ director: 'X' }))).toBe(true);
        expect(hasCardCreator(entry({ author: 'X' }))).toBe(true);
        expect(hasCardCreator(entry({ developer: 'X' }))).toBe(true);
    });

    it('全无 → false', () => {
        expect(hasCardCreator(entry({ type: 'movie' }))).toBe(false);
    });
});

describe('cardGenres 卡片题材行（genres 前 2 个）', () => {
    it('有题材：前 2 个以「 · 」连接', () => {
        expect(cardGenres(entry({ type: 'anime', genres: ['战斗', '奇幻'] }))).toBe('战斗 · 奇幻');
    });

    it('超过 2 个题材：只取前 2 个', () => {
        expect(cardGenres(entry({ genres: ['剧情', '喜剧', '犯罪'] }))).toBe('剧情 · 喜剧');
    });

    it('题材为空：返回占位符「—」（与作者/年份占位同款，保持行占位）', () => {
        expect(cardGenres(entry({ type: 'anime' }))).toBe('—');
    });
});

describe('hasCardGenres 题材行是否为真实内容', () => {
    it('有题材 → true', () => {
        expect(hasCardGenres(entry({ genres: ['冒险'] }))).toBe(true);
    });

    it('题材为空 → false', () => {
        expect(hasCardGenres(entry({ type: 'anime' }))).toBe(false);
    });
});

describe('audioSubtitle（④-4 音频播放器副行）', () => {
    it('作者 · 专辑 · 年份 三段齐全', () => {
        expect(audioSubtitle(entry({ type: 'music', author: 'A', album: 'B', year: 2024 }))).toBe('A · B · 2024');
    });

    it('缺项自动跳过（年份是数字字段，缺了不能变成空串占位）', () => {
        expect(audioSubtitle(entry({ type: 'music', author: 'A', album: 'B' }))).toBe('A · B');
        expect(audioSubtitle(entry({ type: 'music', author: 'A', year: 2024 }))).toBe('A · 2024');
        expect(audioSubtitle(entry({ type: 'music', album: 'B' }))).toBe('B');
    });

    it('全缺 → 空串（视图据此不渲染这一行），⛔ 不返回卡片那种「—」占位', () => {
        expect(audioSubtitle(entry({ type: 'music' }))).toBe('');
    });

    it('🔴 与 cardSubtitle 口径不同：播放器副行含作者，卡片副行只到「专辑 · 年份」', () => {
        const e = entry({ type: 'music', author: 'A', album: 'B', year: 2024 });
        expect(cardSubtitle(e)).toBe('B · 2024');
        expect(audioSubtitle(e)).toBe('A · B · 2024');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1.3.1 ①：海报墙卡片「显示哪些属性」（高级设置 › 海报墙卡片）
// ══════════════════════════════════════════════════════════════════════════════
describe('normalizeCardFieldsForType（卡片字段配置归一 · 按类型）', () => {
    it('缺省 = 影视那一组三行（与 1.3.1 之前的卡片逐像素一致）', () => {
        expect([...CARD_FIELD_DEFAULTS_BY_TYPE.movie]).toEqual(['year', 'creator', 'genres']);
        // ⚠️ #617 追加件起**不再**断言「池子前 3 项 = 缺省」—— 各类型已有**各自的预填**，
        //    那个「池子头 = 缺省」的口径整体作废（逐类预填由 `CARD_FIELD_DEFAULTS_BY_TYPE` 守卫钉住）。
    });

    it('🔴 非数组 ⇒ 回**该类型自己**的缺省（⛔ 不是空数组，也⛔ 不是影视那一组）', () => {
        for (const bad of [undefined, null, 'year', 42]) {
            expect(normalizeCardFieldsForType('movie', bad), String(bad)).toEqual([
                ...CARD_FIELD_DEFAULTS_BY_TYPE.movie,
            ]);
            expect(normalizeCardFieldsForType('music', bad), String(bad)).toEqual([
                ...CARD_FIELD_DEFAULTS_BY_TYPE.music,
            ]);
        }
    });

    it('🔴 空数组 = 用户刻意全关 —— 与「没配过」必须是两个状态', () => {
        expect(normalizeCardFieldsForType('movie', [])).toEqual([]);
    });

    it('丢掉不认识的键（旧版本残留 / 手改 data.json）', () => {
        expect(normalizeCardFieldsForType('movie', ['year', 'bogus', 42, null])).toEqual(['year']);
        expect(normalizeCardFieldsForType('movie', ['bogus'])).toEqual([]);
    });

    it('🔴 #640 保留**传入顺序**（用户拖出来的先后），⛔ 不再按池子顺序重排', () => {
        // 🔴 这是 #640 的翻面点：原先「顺序恒为池子顺序、与传入顺序无关」——
        //    那会让「拖拽排序 + 持久化」整个失效（拖完存下来、一读就被重排回去，静默无报错）。
        expect(normalizeCardFieldsForType('movie', ['genres', 'year'])).toEqual(['genres', 'year']);
        expect(normalizeCardFieldsForType('movie', ['creator', 'genres', 'year'])).toEqual(['creator', 'genres', 'year']);
        // 反向守卫：传入顺序**恰好等于**池子顺序时也得原样返回（不能靠「碰巧相同」蒙混）
        const pool = cardFieldOptionsFor('movie').map((o) => o.key);
        expect(normalizeCardFieldsForType('movie', pool.slice(0, 3))).toEqual(pool.slice(0, 3));
    });

    it('重复项去重', () => {
        expect(normalizeCardFieldsForType('movie', ['year', 'year'])).toEqual(['year']);
    });

    // ── #615：字段池 + 上限 5；🔴 #617 追加件：上限的「取前 N」按**该类型池子**的顺序 ──────
    it('🔴 #615 字段池是精选的 16 项，含 6 个类型的代表性字段', () => {
        expect(CARD_FIELD_OPTIONS).toHaveLength(16);
        const keys = CARD_FIELD_OPTIONS.map((o) => o.key);
        for (const k of ['year', 'creator', 'genres', 'author', 'artist', 'publisher', 'platform', 'developer', 'album', 'series']) {
            expect(keys).toContain(k);
        }
        // ⛔ 池子里不该出现「放卡片上没意义」的字段
        for (const k of ['id', 'type', 'tags', 'banner', 'created', 'updated']) {
            expect(keys).not.toContain(k);
        }
    });

    it('🔴 #615 上限 = 5，超限时**按传入顺序取前 5**（⛔ 不是丢掉整份配置）', () => {
        expect(CARD_FIELD_LIMIT).toBe(5);
        const pool = cardFieldOptionsFor('movie').map((o) => o.key);
        const out = normalizeCardFieldsForType('movie', [...pool]);
        expect(out).toHaveLength(CARD_FIELD_LIMIT);
        // 🔴 #640：截断取的是**用户顺序**的前 5（原先是「池子顺序的前 5」）——
        //    与「已选标签可拖拽排序」配套：用户把某个字段拖到第 3 位，它就该留在前 5 里。
        expect(out).toEqual(pool.slice(0, CARD_FIELD_LIMIT));
        // 反向守卫：**打乱后**截断取的是打乱的那个前 5，而不是池子前 5
        const shuffled = [...pool].reverse();
        expect(normalizeCardFieldsForType('movie', shuffled)).toEqual(shuffled.slice(0, CARD_FIELD_LIMIT));
    });

    it('恰 5 条不动它；4 条也不补满（上限只截断、不凑数）', () => {
        const five = cardFieldOptionsFor('movie').slice(0, 5).map((o) => o.key);
        expect(normalizeCardFieldsForType('movie', [...five])).toEqual([...five]);
        const four = cardFieldOptionsFor('movie').slice(0, 4).map((o) => o.key);
        expect(normalizeCardFieldsForType('movie', [...four])).toHaveLength(4);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #615：卡片信息栏的取值（每个可选字段都要能取到一行文本）
// ══════════════════════════════════════════════════════════════════════════════
describe('cardFieldValue（卡片信息栏取值）', () => {
    it('各字段取到对应的那个值', () => {
        const e = entry({
            country: '中国', language: '中文', durationMin: 120,
            author: '某作者', artist: '某画师', translator: '某译者',
            publisher: '某出版社', producer: '某出品方',
            platform: 'PC', developer: '某工作室', album: '某专辑',
            series: '某系列', aliases: ['甲', '乙', '丙'],
        });
        expect(cardFieldValue(e, 'country')).toBe('中国');
        expect(cardFieldValue(e, 'language')).toBe('中文');
        expect(cardFieldValue(e, 'duration')).toBe('120 分钟');
        expect(cardFieldValue(e, 'author')).toBe('某作者');
        expect(cardFieldValue(e, 'artist')).toBe('某画师');
        expect(cardFieldValue(e, 'translator')).toBe('某译者');
        expect(cardFieldValue(e, 'publisher')).toBe('某出版社');
        expect(cardFieldValue(e, 'producer')).toBe('某出品方');
        expect(cardFieldValue(e, 'platform')).toBe('PC');
        expect(cardFieldValue(e, 'developer')).toBe('某工作室');
        expect(cardFieldValue(e, 'album')).toBe('某专辑');
        expect(cardFieldValue(e, 'series')).toBe('某系列');
        expect(cardFieldValue(e, 'aliases')).toBe('甲 / 乙'); // 只取前 2
    });

    it('三个「老牌」字段仍走各自的原函数（观感与 1.3.1 之前一致）', () => {
        const e = entry({ type: 'music', album: '某专辑', year: 2024, director: '某导演' });
        expect(cardFieldValue(e, 'year')).toBe(cardSubtitle(e));
        expect(cardFieldValue(e, 'creator')).toBe(cardCreator(e));
        expect(cardFieldValue(e, 'genres')).toBe(cardGenres(e));
    });

    it('🔴 缺值一律「—」占位：**每个**可选字段都返回非空串（行不消失 ⇒ 同列卡片行数恒定）', () => {
        const e = entry({});
        for (const opt of CARD_FIELD_OPTIONS) {
            const v = cardFieldValue(e, opt.key);
            expect(typeof v, `${opt.key} 该返回字符串`).toBe('string');
            expect(v.length, `${opt.key} 缺值时应是占位符而不是空串`).toBeGreaterThan(0);
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #616 / #617 设置页预览卡的演示条目（**每类型一份**）
// 用户口径：「改成**预览海报墙 + 信息栏**」（#616）→「为**不同类型**条目卡片海报墙信息栏都加个」（#617）。
// 🔴 它们的全部价值建立在「16 个字段**逐份逐个**都有值」上 —— 少一个值，对应的 chip 点下去
//    卡片纹丝不动，而**界面上完全看不出来**（没有报错、没有空行提示）⇒ 只能靠这里的守卫兜住。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #616/#617 CARD_PREVIEW_ENTRIES（设置页预览卡的演示条目 · 每类型一份）', () => {
    it('六类**每类都有**一份演示条目（⛔ 少一类 ⇒ 切到那类预览卡直接是空的）', () => {
        for (const t of ENTRY_TYPES) {
            expect(CARD_PREVIEW_ENTRIES[t], `${t} 缺演示条目`).toBeTruthy();
            expect(CARD_PREVIEW_ENTRIES[t].type, `${t} 那份的 type 不对`).toBe(t);
        }
    });

    it('每份的 16 个候选字段**逐个**都有真值（⛔ 不是「—」占位）', () => {
        const dead: string[] = [];
        for (const t of ENTRY_TYPES) {
            for (const opt of CARD_FIELD_OPTIONS) {
                if (cardFieldValue(CARD_PREVIEW_ENTRIES[t], opt.key) === '—') dead.push(`${t}.${opt.key}`);
            }
        }
        expect(dead, `这些字段没值 ⇒ 对应 chip 点下去预览不会变：${dead.join(', ')}`).toEqual([]);
    });

    it('「题材 / 又名」各备足 2 项（否则看不出「最多取前 2 个」的效果）', () => {
        for (const t of ENTRY_TYPES) {
            expect(CARD_PREVIEW_ENTRIES[t].genres.length, t).toBeGreaterThanOrEqual(2);
            expect(CARD_PREVIEW_ENTRIES[t].aliases?.length ?? 0, t).toBeGreaterThanOrEqual(2);
        }
    });

    it('🔴 id 用保留形态（`__` 前缀）且**逐份唯一** ⇒ ⛔ 不与真实条目撞、也不彼此撞', () => {
        const ids = ENTRY_TYPES.map((t) => CARD_PREVIEW_ENTRIES[t].id);
        for (const id of ids) expect(id.startsWith('__')).toBe(true);
        expect(new Set(ids).size).toBe(ENTRY_TYPES.length);
        for (const t of ENTRY_TYPES) expect(CARD_PREVIEW_ENTRIES[t].title.length).toBeGreaterThan(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #617 按类型的**预填**与**候选池**（`resolveCardFieldsByType` 是唯一真源：
//      设置页读当前类型 与 HomeView 给海报墙传参 都必须走它，⛔ 别各写一套）
// 用户口径：「原来五个类型条目的怎么不预填上去，而且 5 个类型的字段选择怎么都是一样名称的」
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #617 resolveCardFieldsByType（按类型预填 + 归一）', () => {
    it('六键齐全：缺的类型也一律有值（⛔ 不留 `undefined` ⇒ 渲染侧不用再判空）', () => {
        const r = resolveCardFieldsByType(undefined);
        expect(Object.keys(r).sort()).toEqual([...ENTRY_TYPES].sort());
        for (const t of ENTRY_TYPES) expect(r[t], t).toEqual([...CARD_FIELD_DEFAULTS_BY_TYPE[t]]);
    });

    it('🔴 预填**按类型给**（⛔ 不再是六类共用一组）—— 逐类钉死，改错了必须红', () => {
        const r = resolveCardFieldsByType(undefined);
        expect(r.movie).toEqual(['year', 'creator', 'genres']);
        expect(r.tv).toEqual(['year', 'creator', 'genres']);
        expect(r.anime).toEqual(['year', 'creator', 'genres']);
        expect(r.book).toEqual(['year', 'author', 'genres']);
        expect(r.game).toEqual(['year', 'developer', 'platform']);
        expect(r.music).toEqual(['year', 'creator', 'album']);
        // 至少两类不同 ⇒ 否则「按类型预填」就是一句空话
        expect(new Set(ENTRY_TYPES.map((t) => r[t].join(','))).size).toBeGreaterThan(1);
    });

    it('🔴 只写了一类 ⇒ 那一类用新值、其余五类用**各自的预填**', () => {
        const r = resolveCardFieldsByType({ book: ['author', 'translator'] });
        expect(r.book).toEqual(['author', 'translator']);
        expect(r.movie).toEqual(['year', 'creator', 'genres']);
        expect(r.game).toEqual(['year', 'developer', 'platform']);
        expect(r.music).toEqual(['year', 'creator', 'album']);
    });

    it('🔴 空数组是「刻意全关」的合法值，⛔ 不许被预填吃掉（判据必须是 `=== undefined`）', () => {
        const r = resolveCardFieldsByType({ movie: [] });
        expect(r.movie).toEqual([]);
        expect(r.tv).toEqual(['year', 'creator', 'genres']);
    });

    it('🔴 老键 `cardFields` **不再参与**（用户裁定「让位给按类型预填」）', () => {
        // 传进去也不读 —— 参数表里根本没有它（这里顺带钉住签名形态：只收一个参数）
        expect(resolveCardFieldsByType.length).toBe(1);
    });

    it('每一类都过一遍归一：丢未知键 / **保留传入顺序** / 截断到 5', () => {
        const r = resolveCardFieldsByType({
            book: ['zzz', 'series', 'year', 'creator', 'genres', 'author', 'artist'],
        });
        // 🔴 #640：`zzz` 被丢掉，其余**按传入先后**保留，再截断到 5
        expect(r.book).toEqual(['series', 'year', 'creator', 'genres', 'author']);
    });

    it('非对象的新键（手改 data.json 成字符串）⇒ 走预填，⛔ 不炸', () => {
        const r = resolveCardFieldsByType('nope');
        for (const t of ENTRY_TYPES) expect(r[t], t).toEqual([...CARD_FIELD_DEFAULTS_BY_TYPE[t]]);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #617 候选池按类型过滤 —— 用户原话「5 个类型的字段选择怎么都是一样名称的」
// 过滤点有两处、缺一不可：**设置页候选**（`cardFieldOptionsFor`）与**归一**
// （`normalizeCardFieldsForType`）。只做前者 = 「看不见但生效」。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #617 候选池按类型过滤（cardFieldOptionsFor / normalizeCardFieldsForType）', () => {
    it('类型专属字段只出现在对应类型的池子里', () => {
        const keys = (t: EntryType) => cardFieldOptionsFor(t).map((o) => o.key);
        expect(keys('movie')).toContain('duration');
        expect(keys('movie')).not.toContain('translator');
        expect(keys('book')).toContain('translator');
        expect(keys('book')).not.toContain('platform');
        expect(keys('game')).toContain('platform');
        expect(keys('game')).not.toContain('author');
        expect(keys('music')).toContain('album');
        expect(keys('music')).not.toContain('duration');
    });

    it('六类通用字段**每类都有**（年份 / 创作者 / 题材 / 系列 / 又名）', () => {
        for (const t of ENTRY_TYPES) {
            const keys = cardFieldOptionsFor(t).map((o) => o.key);
            for (const k of ['year', 'creator', 'genres', 'series', 'aliases']) {
                expect(keys, `${t} 缺通用字段 ${k}`).toContain(k);
            }
        }
    });

    it('🔴 每个字段至少属于一个类型（⛔ 别登记一个谁都选不到的孤儿字段）', () => {
        expect(CARD_FIELD_OPTIONS.filter((o) => o.types.length === 0).map((o) => o.key)).toEqual([]);
    });

    it('🔴 六个类型的池子**并集 = 全部 16 项**（过滤只做减法，⛔ 不许有字段被漏掉）', () => {
        const union = new Set<string>();
        for (const t of ENTRY_TYPES) for (const o of cardFieldOptionsFor(t)) union.add(o.key);
        expect(union.size).toBe(CARD_FIELD_OPTIONS.length);
    });

    it('🔴 归一也按类型过滤：电影里塞「译者」、书籍里塞「平台」都会被丢掉（防「看不见但生效」）', () => {
        expect(normalizeCardFieldsForType('movie', ['translator', 'year'])).toEqual(['year']);
        expect(normalizeCardFieldsForType('book', ['platform', 'author'])).toEqual(['author']);
    });

    it('🔴 归一传非数组 ⇒ 用**该类型自己的预填**（⛔ 不是影视那一组）', () => {
        expect(normalizeCardFieldsForType('game', undefined)).toEqual(['year', 'developer', 'platform']);
        expect(normalizeCardFieldsForType('music', null)).toEqual(['year', 'creator', 'album']);
        expect(normalizeCardFieldsForType('book', [])).toEqual([]); // 空数组仍是合法值
    });
});

describe('🔴 #617 CARD_FIELD_DEFAULTS_BY_TYPE / DEFAULT_CARD_FIELDS_BY_TYPE', () => {
    it('六键齐全，且每键是**独立拷贝**（⛔ 不共用同一个数组）', () => {
        expect(Object.keys(DEFAULT_CARD_FIELDS_BY_TYPE).sort()).toEqual([...ENTRY_TYPES].sort());
        for (const t of ENTRY_TYPES) {
            expect(DEFAULT_CARD_FIELDS_BY_TYPE[t]).toEqual([...CARD_FIELD_DEFAULTS_BY_TYPE[t]]);
            expect(DEFAULT_CARD_FIELDS_BY_TYPE[t]).not.toBe(CARD_FIELD_DEFAULTS_BY_TYPE[t]);
        }
    });

    it('🔴 每类的预填都落在**该类型自己的候选池**里（⛔ 别预填一个它根本选不到的字段）', () => {
        for (const t of ENTRY_TYPES) {
            const pool = cardFieldOptionsFor(t).map((o) => o.key);
            for (const k of CARD_FIELD_DEFAULTS_BY_TYPE[t]) {
                expect(pool, `${t} 的预填 ${k} 不在它的候选池里`).toContain(k);
            }
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// #625 折叠卡（系列卡）的信息行取值
//
// 用户 2026-10-13 报障：「怎么系列卡不一致的，里面的视图也空了一大块出来」。
// 根因：折叠卡的信息行**从 #617 起就没跟上**「按类型配信息栏」—— 它写死三行
//      （年份段 / 部数 / 题材），普通卡却跟着设置走（0~5 行）⇒
//      行数不一致 ⇒ 卡片高度不一致 ⇒ 矮卡被网格拉高、正文下面空出一大块。
// 口径：折叠卡与普通卡**逐档对应**（同一个候选池、同一批行序），只是取值走组级聚合。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 #625 seriesCardFieldValue（折叠卡的信息行）', () => {
    const group = (items: MediaEntry[], type: EntryType = 'book'): SeriesGroup => ({
        key: `${type}\u0001示例`,
        type,
        name: '示例',
        title: '示例 书籍系列',
        items,
    });

    it('年份 → **组内跨度**（⛔ 不是首条的年份 —— 十几部作品的年份区间才是这一行的意义）', () => {
        const g = group([
            entry({ year: 1965, title: '一' }),
            entry({ year: 1969, title: '二' }),
            entry({ year: 1985, title: '三' }),
        ]);
        expect(seriesCardFieldValue(g, 'year')).toBe('1965–1985');
        // 全部缺年份 ⇒ 占位（⛔ 不是空串，见下一条）
        expect(seriesCardFieldValue(group([entry({})]), 'year')).toBe('—');
    });

    it('题材 → **组内并集**（前 2 个、` · ` 连接；与普通卡 `cardGenres` 同口径）', () => {
        const g = group([
            entry({ genres: ['科幻'] }),
            entry({ genres: ['灾难', '悬疑'] }),
        ]);
        expect(seriesCardFieldValue(g, 'genres')).toBe('科幻 · 灾难');
        expect(seriesCardFieldValue(group([entry({ genres: [] })]), 'genres')).toBe('—');
    });

    it('其余字段 → 取**组内首条**的值（同一系列这些属性本就共享）', () => {
        const g = group([
            entry({ author: '弗兰克·赫伯特', publisher: '江苏凤凰文艺' }),
            entry({ author: '别人', publisher: '别家' }),
        ]);
        expect(seriesCardFieldValue(g, 'author')).toBe('弗兰克·赫伯特');
        expect(seriesCardFieldValue(g, 'publisher')).toBe('江苏凤凰文艺');
        // 首条也没有 ⇒ 仍是 `cardFieldValue` 的占位口径
        expect(seriesCardFieldValue(group([entry({})]), 'translator')).toBe('—');
    });

    it('🔴🔴 **每一个候选字段都返回非空串** —— 空串会让那一行塌成 0 高，行数就又对不上了', () => {
        // 组内故意什么都不填 ⇒ 逼出所有字段的「缺值」分支
        const bare = group([entry({})]);
        const dead: string[] = [];
        for (const opt of CARD_FIELD_OPTIONS) {
            if (seriesCardFieldValue(bare, opt.key) === '') dead.push(opt.key);
        }
        expect(dead, `这些字段在缺值时会返回空串 ⇒ 对应那一行会塌掉：${dead.join(', ')}`).toEqual([]);
    });

    it('🔴 与 `cardFieldValue` **逐档对应**：同一批键都能取到值（⛔ 别在这一边漏一档）', () => {
        const e = entry({ type: 'book', year: 2000, author: 'A', genres: ['G'] });
        const g = group([e]);
        for (const opt of CARD_FIELD_OPTIONS) {
            // 同一条数据下两边都必须是**非空**字符串（可以是不同的聚合结果）
            expect(cardFieldValue(e, opt.key), `单条卡缺档：${opt.key}`).not.toBe('');
            expect(seriesCardFieldValue(g, opt.key), `折叠卡缺档：${opt.key}`).not.toBe('');
        }
    });

    it('空组（理论上到不了，兜住它）⇒ 占位，⛔ 不抛错、不返回空串', () => {
        expect(seriesCardFieldValue(group([]), 'year')).toBe('—');
        expect(seriesCardFieldValue(group([]), 'author')).toBe('—');
    });

    it('🔴 音乐系列：年份槽给**跨度**（⛔ 不是首条的专辑 · 年份 —— 各条专辑不同，那对「系列」没有意义）', () => {
        const g = group(
            [entry({ type: 'music', album: '叶惠美', year: 2003 }), entry({ type: 'music', year: 2004 })],
            'music',
        );
        // 年份恒走**组内极值**
        expect(seriesCardFieldValue(g, 'year')).toBe('2003–2004');
        // 专辑这种「各条不同」的字段退回首条（同一行位上至少有个可读的值）
        expect(seriesCardFieldValue(g, 'album')).toBe('叶惠美');
    });
});
