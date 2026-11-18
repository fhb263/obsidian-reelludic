/**
 * 🔴 2026-11-14 用户 m04138：笔记条目卡（` ```reelludic `）的**纯逻辑层**守卫。
 *
 * 用户原话：「在笔记规划渲染出插件专属组件，因为笔记属性和表单两个可视化不对等的」——
 * 所以这个文件的核心不是「渲染好看」，而是**对等**：笔记侧看到的字段、标签、可写范围，
 * 必须与编辑表单同一套真源（`pure/metaFields`）说得上话。
 *
 * 三条被钉死的口径：
 *   ① 投影（`buildNoteCardGroups`）与回写（`applyNoteCardEdit`）必须**成对** ——
 *      能读出来的键必须能写回去，否则用户改完刷新又变回原值（最气人的那种 bug）。
 *   ② 音乐歌手在 `author`，`artist` 是**漫画画师**（见 `pure/musicArtist` 的铁律）。
 *   ③ 书籍子分类的标签换名（上架年 / 章数 / 话数 / 丛书）必须与表单逐字一致。
 */
import { describe, expect, it } from 'vitest';
import type { MediaEntry } from 'data/types';
import {
    NOTE_CARD_LANG,
    applyNoteCardEdit,
    buildNoteCardGroups,
    hasNoteCard,
    isNoteCardRowEmpty,
    moodOptionValue,
    noteCardFenceOf,
    noteCardSourceOf,
    noteCardTypeLabel,
    parseNoteCardSource,
} from 'pure/noteCard';

/** 最小可用条目（只覆盖本文件用到的字段，其余给合理缺省） */
function mk(patch: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e_1',
        type: 'tv',
        title: '进击的巨人 最终季',
        status: 'watching',
        rating: 4,
        genres: [],
        cast: [],
        links: [],
        notes: '',
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...patch,
    } as MediaEntry;
}

/** 把分组摊平成 key → row 的字典，断言时好取 */
function rowMap(entry: MediaEntry): Map<string, { label: string; value: string }> {
    const out = new Map<string, { label: string; value: string }>();
    for (const g of buildNoteCardGroups(entry)) {
        for (const r of g.rows) out.set(r.key, { label: r.label, value: r.value });
    }
    return out;
}

describe('noteCard · 语言名与围栏', () => {
    it('语言名是 reelludic（⛔ 不是 lrc —— 那个已被笔记内播放器占用）', () => {
        expect(NOTE_CARD_LANG).toBe('reelludic');
        expect(NOTE_CARD_LANG).not.toBe('lrc');
    });

    it('围栏里只有条目 id 一行（⛔ 不抄 frontmatter，避免两份真源）', () => {
        const fence = noteCardFenceOf('e_1');
        expect(fence).toBe('```reelludic\ne_1\n```');
        // 只三行：开围栏 / id / 闭围栏
        expect(fence.split('\n')).toHaveLength(3);
    });

    it('`noteCardSourceOf` 与 `parseNoteCardSource` 往返一致', () => {
        expect(parseNoteCardSource(noteCardSourceOf('e_42'))).toBe('e_42');
        // 容忍前后空白与空行
        expect(parseNoteCardSource('\n\n  e_42  \n\n')).toBe('e_42');
        // 兼容 `id: xxx` 写法
        expect(parseNoteCardSource('id: e_42')).toBe('e_42');
        // 引号也剥掉
        expect(parseNoteCardSource('id: "e_42"')).toBe('e_42');
        // 空块返回 null（渲染层据此出「没有指定条目 id」的提示）
        expect(parseNoteCardSource('')).toBeNull();
        expect(parseNoteCardSource('   \n  ')).toBeNull();
    });
});

describe('noteCard · 分组投影', () => {
    it('影视条目出「基本信息 / 日期 / 演职与规格 / 进度」四组，⛔ 不出书籍/游戏/音乐组', () => {
        const keys = buildNoteCardGroups(mk()).map((g) => g.key);
        expect(keys).toContain('basic');
        expect(keys).toContain('dates');
        expect(keys).toContain('media');
        expect(keys).toContain('progress');
        expect(keys).not.toContain('book');
        expect(keys).not.toContain('game');
        expect(keys).not.toContain('music');
    });

    it('分组顺序稳定（基本信息 → 日期 → 演职与规格 → 进度 → 游戏 → 书籍 → 音乐）', () => {
        const tv = buildNoteCardGroups(mk()).map((g) => g.key);
        expect(tv.indexOf('basic')).toBeLessThan(tv.indexOf('dates'));
        expect(tv.indexOf('dates')).toBeLessThan(tv.indexOf('media'));
        expect(tv.indexOf('media')).toBeLessThan(tv.indexOf('progress'));
    });

    it('`fieldAppliesTo` 生效：书籍条目不出「演职与规格」里的 director/编剧，但出书籍组', () => {
        const rows = rowMap(mk({ type: 'book', author: '刘慈欣' }));
        expect(rows.has('author')).toBe(true);
        expect(rows.has('publisher')).toBe(true);
        // 导演是影视专属 ⇒ 书籍不该有
        expect(rows.has('director')).toBe(false);
    });

    /**
     * 🔴 1.5.0 期 ④（用户 2026-11-17）：「编辑渲染条目卡删除影视下的『出品方』字段
     * （搜索添加的条目都没有该字段回填）」。
     *
     * 这条守卫**同时钉住摘与不摘的两边** —— 只测「影视没有 producer」是不够的：
     * 那把 `TYPE_EXCLUDED_KEYS` 写成「所有人都摘」也会绿，而游戏侧的出品方是真有数据的，
     * 跟着一起消失就是本轮引入的新 bug。
     *
     * ⚠️ 判据是「卡片上有没有这一行」，不是「字段还在不在」——
     *   `pure/metaFields.ts:175` 的 `appliesTo` **刻意没动**（它还被表格列 / 字段排序共用）。
     */
    it('豆瓣回填的出品方：影视（movie / tv）卡片上不出现，游戏仍有', () => {
        for (const t of ['movie', 'tv'] as const) {
            const rows = rowMap(mk({ type: t, producer: '华纳' }));
            expect(rows.has('producer')).toBe(false);
        }
        // 游戏侧保留（`appliesTo` 本来就有 game），且值照常投影得出来
        const game = rowMap(mk({ type: 'game', producer: '某出品方' }));
        expect(game.has('producer')).toBe(true);
        expect(game.get('producer')?.value).toBe('某出品方');
        // 动画本来就没有（`appliesTo` 是 ['movie','tv','game']），摘不摘都是 false —— 顺带钉住
        expect(rowMap(mk({ type: 'anime', producer: '某出品方' })).has('producer')).toBe(false);
    });

    it('摘掉的是**投影**：游戏条目仍能把 producer 写回去（读投影与写映射成对）', () => {
        // 影视不显示，但写映射不能跟着废掉 —— `applyNoteCardEdit` 是键级 switch，与分组无关
        expect(applyNoteCardEdit(mk({ type: 'tv' }), 'producer', '华纳')).toEqual({ producer: '华纳' });
        expect(applyNoteCardEdit(mk({ type: 'game' }), 'producer', '某出品方')).toEqual({ producer: '某出品方' });
    });

    /**
     * 🔴 用户 m01782：「音乐类型笔记怎么渲染卡里有书籍的字段的？」
     *
     * 根因不是漏筛：`author` 的 `appliesTo` 是 `['book','music']`（音乐侧经 `labelFor`
     * 显示成「艺术家」），却静态写在 book 组里 ⇒ 音乐卡渲染出一整块
     * **标题写「书籍」、内容是「艺术家」**的区块。
     *
     * ⚠️ 这三条是**成对**的，缺一条就会假绿：
     *  ⑴ 只断言「音乐没有 book 组」—— 把 `author` 从卡上整个删掉也会绿；
     *  ⑵ 只断言「音乐有 author 行」—— 它待在 book 组里也会绿；
     *  ⑶ 只断言「书籍有 author 行」—— 挪到任何地方都会绿。
     * 所以必须同时钉住：音乐没有 book 组 + author 落在 music 组 + 书籍侧照旧。
     */
    it('音乐卡⛔ 不出「书籍」组：author 挪进「音乐」组（不是从卡上删掉）', () => {
        const music = mk({ type: 'music', author: '中岛美雪', album: '骑在银龙的背上' });
        const groups = buildNoteCardGroups(music);
        // ⑴ 音乐卡上不该有 book 组
        expect(groups.some((g) => g.key === 'book')).toBe(false);
        // ⑵ author 必须还在，且落在 music 组（标签是「艺术家」）
        const musicGroup = groups.find((g) => g.key === 'music');
        expect(musicGroup).toBeDefined();
        expect(musicGroup?.label).toBe('音乐');
        const authorRow = musicGroup?.rows.find((r) => r.key === 'author');
        expect(authorRow).toBeDefined();
        expect(authorRow?.label).toBe('艺术家');
        expect(authorRow?.value).toBe('中岛美雪');
        expect(rowMap(music).has('author')).toBe(true);
    });

    it('书籍卡照旧：「作者」仍留在书籍组（⛔ 别为了修音乐把书目也删了）', () => {
        const book = mk({ type: 'book', author: '刘慈欣' });
        const groups = buildNoteCardGroups(book);
        const bookGroup = groups.find((g) => g.key === 'book');
        expect(bookGroup).toBeDefined();
        expect(bookGroup?.label).toBe('书籍');
        expect(bookGroup?.rows.find((r) => r.key === 'author')?.label).toBe('作者');
        // 书籍不该长出音乐组（album 的 appliesTo 不含 book）
        expect(groups.some((g) => g.key === 'music')).toBe(false);
    });

    it('每个键在任意类型下最多出现在一个组（挪组不能变成复制）', () => {
        for (const t of ['movie', 'tv', 'anime', 'book', 'game', 'music'] as const) {
            const entry = mk({ type: t, author: '甲', album: '乙', director: '丙', developer: '丁', platform: 'PC' });
            const seen = new Set<string>();
            for (const g of buildNoteCardGroups(entry)) {
                for (const r of g.rows) {
                    expect(seen.has(r.key), `${t} 类型下 ${r.key} 重复出现`).toBe(false);
                    seen.add(r.key);
                }
            }
        }
    });

    it('空值行照样出（编辑态要能点进去填空；只读态由渲染层压暗）', () => {
        const g = buildNoteCardGroups(mk({ year: undefined, tags: [] }));
        const flat = g.flatMap((x) => x.rows);
        const year = flat.find((r) => r.key === 'year');
        expect(year).toBeDefined();
        expect(year?.value).toBe('');
        expect(isNoteCardRowEmpty({ key: 'year', label: '年份', kind: 'number', value: '' })).toBe(true);
        expect(isNoteCardRowEmpty({ key: 'year', label: '年份', kind: 'number', value: '2020' })).toBe(false);
    });

    it('状态 / 心情是枚举，带选项（心情七档用 emoji + 中文）', () => {
        const flat = buildNoteCardGroups(mk({ mood: 'wow' })).flatMap((g) => g.rows);
        const status = flat.find((r) => r.key === 'status');
        expect(status?.kind).toBe('enum');
        expect(status?.options?.map((o) => o.value)).toEqual(['want', 'watching', 'watched', 'archived']);
        const mood = flat.find((r) => r.key === 'mood');
        expect(mood?.kind).toBe('enum');
        expect(mood?.options?.length).toBe(6);
        expect(mood?.options?.[0].label).toContain('🤩');
        expect(moodOptionValue('wow')).toBe('wow');
        expect(moodOptionValue('不存在的档')).toBe('');
    });

    it('评分是 0.5 步长的 rating 控件类型（不是文本框 —— 免得敲进 3.7）', () => {
        const flat = buildNoteCardGroups(mk()).flatMap((g) => g.rows);
        expect(flat.find((r) => r.key === 'rating')?.kind).toBe('rating');
    });

    it('`type` 与 `progress_percent` 是只读（派生值/类型不可在此修改）', () => {
        const flat = buildNoteCardGroups(mk({ type: 'tv' })).flatMap((g) => g.rows);
        expect(flat.find((r) => r.key === 'type')?.kind).toBe('readonly');
        expect(noteCardTypeLabel('tv')).toBeDefined();
        expect(noteCardTypeLabel('movie')).not.toBe(noteCardTypeLabel('tv'));
    });
});

describe('noteCard · 书籍子分类标签与表单对等', () => {
    it('文学：year→年份、page_count→页数、series→丛书', () => {
        const rows = rowMap(mk({ type: 'book', bookKind: 'book', year: 2008, pageCount: 340, series: '某丛书' }));
        expect(rows.get('year')?.label).toBe('年份');
        expect(rows.get('page_count')?.label).toBe('页数');
        expect(rows.get('series')?.label).toBe('丛书');
    });

    it('网文：year→上架年、page_count→章数、series→系列（⛔ 不是「丛书」）', () => {
        const rows = rowMap(mk({ type: 'book', bookKind: 'novel', year: 2008, pageCount: 1200, series: '斗罗系列' }));
        expect(rows.get('year')?.label).toBe('上架年');
        expect(rows.get('page_count')?.label).toBe('章数');
        expect(rows.get('series')?.label).toBe('系列');
    });

    it('漫画：page_count→话数（⛔ 不是页数、也不是章数）', () => {
        const rows = rowMap(mk({ type: 'book', bookKind: 'comic', pageCount: 139 }));
        expect(rows.get('page_count')?.label).toBe('话数');
    });

    it('缺省 bookKind（老数据）回落文学口径', () => {
        const rows = rowMap(mk({ type: 'book', year: 2010, pageCount: 340 }));
        expect(rows.get('year')?.label).toBe('年份');
        expect(rows.get('page_count')?.label).toBe('页数');
    });

    it('音乐：author 显示成「艺术家」（走 metaFields.labelFor，⛔ 不是「作者」）', () => {
        const rows = rowMap(mk({ type: 'music', author: '中岛美雪' }));
        expect(rows.get('author')?.label).toBe('艺术家');
        expect(rows.get('author')?.value).toBe('中岛美雪');
    });
});

describe('noteCard · 音乐歌手读对字段（author，不是 artist）', () => {
    it('音乐条目：author 出现在卡片上', () => {
        const rows = rowMap(mk({ type: 'music', author: '中岛美雪', title: '骑在银龙的背上' }));
        expect(rows.get('author')?.value).toBe('中岛美雪');
    });

    it('老数据把歌手写在 artist（musiSync 2026-11-14 之前的行为）⇒ 回落读出来', () => {
        const rows = rowMap(mk({ type: 'music', author: undefined, artist: '中岛美雪' }));
        expect(rows.get('author')?.value).toBe('中岛美雪');
    });

    it('漫画的 artist 是画师，⛔ 不能当歌手写进音乐的 author 行', () => {
        const comic = mk({ type: 'book', bookKind: 'comic', author: '原作君', artist: '作画君' });
        // 漫画：作者行是原作、画师行是作画（两个独立字段）
        const rows = rowMap(comic);
        expect(rows.get('author')?.value).toBe('原作君');
        expect(rows.get('artist')?.value).toBe('作画君');
        // 音乐：artist 字段被借作老数据兜底，但 bookKind 存在时**不许**回落（那是画师）
        const music = rowMap(mk({ type: 'music', author: '', artist: '作画君' }));
        expect(music.get('author')?.value).toBe('作画君');
    });
});

describe('noteCard · 投影与回写成对（能读出来的就能写回去）', () => {
    it('文本类：改标题/导演/出版社都能落成 patch', () => {
        expect(applyNoteCardEdit(mk(), 'title', '新标题')).toEqual({ title: '新标题' });
        expect(applyNoteCardEdit(mk(), 'director', '诺兰')).toEqual({ director: '诺兰' });
        expect(applyNoteCardEdit(mk({ type: 'book' }), 'publisher', '重庆出版社')).toEqual({ publisher: '重庆出版社' });
    });

    it('空串写回是「清空」而不是「忽略」（⛔ 不能变成改不掉）', () => {
        expect(applyNoteCardEdit(mk({ director: '诺兰' }), 'director', '')).toEqual({ director: undefined });
        expect(applyNoteCardEdit(mk({ tags: ['a'] }), 'tags', '')).toEqual({ tags: [] });
    });

    it('数字类：解析成数字；非法输入返 null（不静默写 NaN）', () => {
        expect(applyNoteCardEdit(mk(), 'year', '2020')).toEqual({ year: 2020 });
        expect(applyNoteCardEdit(mk(), 'year', 'abc')).toBeNull();
    });

    it('列表类：按「、」「，」「,」切分并去空', () => {
        expect(applyNoteCardEdit(mk(), 'tags', '科幻、悬疑，热血, 燃')).toEqual({ tags: ['科幻', '悬疑', '热血', '燃'] });
        expect(applyNoteCardEdit(mk(), 'cast', '甲、乙')).toEqual({ cast: ['甲', '乙'] });
    });

    it('状态：合法枚举落库，非法返 null', () => {
        expect(applyNoteCardEdit(mk(), 'status', 'watched')).toEqual({ status: 'watched' });
        expect(applyNoteCardEdit(mk(), 'status', '不存在')).toBeNull();
    });

    it('评分：0/0.5/…/5 落库；空串清成 0；越界返 null', () => {
        expect(applyNoteCardEdit(mk(), 'rating', '3.5')).toEqual({ rating: 3.5 });
        expect(applyNoteCardEdit(mk(), 'rating', '')).toEqual({ rating: 0 });
        expect(applyNoteCardEdit(mk(), 'rating', '7')).toBeNull();
        expect(applyNoteCardEdit(mk(), 'rating', '-1')).toBeNull();
    });

    it('心情：合法落库，非法清空（不是「什么都不做」）', () => {
        expect(applyNoteCardEdit(mk(), 'mood', 'wow')).toEqual({ mood: 'wow' });
        expect(applyNoteCardEdit(mk(), 'mood', '瞎写')).toEqual({ mood: undefined });
    });

    it('进度三键合成同一个 Progress，且**必须带上 history**（⛔ 丢了就等于抹掉观看历史）', () => {
        const e = mk({ progress: { season: 4, episode: 16, totalEpisodes: 28, history: [{ date: '2026-01-01', episode: 15 }] } as never });
        const p = applyNoteCardEdit(e, 'progress_episode', '20');
        expect(p).not.toBeNull();
        expect(p?.progress?.episode).toBe(20);
        expect(p?.progress?.season).toBe(4);
        expect(p?.progress?.totalEpisodes).toBe(28);
        // 🔴 历史一条不丢
        expect(p?.progress?.history).toHaveLength(1);
        // 季改一季，其余字段同样保留
        const p2 = applyNoteCardEdit(e, 'progress_season', '5');
        expect(p2?.progress?.season).toBe(5);
        expect(p2?.progress?.episode).toBe(16);
        expect(p2?.progress?.history).toHaveLength(1);
    });

    it('无 progress 的条目改集数 ⇒ 补一个合法骨架（season 1 / episode 0 起）', () => {
        const p = applyNoteCardEdit(mk({ progress: undefined }), 'progress_episode', '3');
        expect(p?.progress?.season).toBe(1);
        expect(p?.progress?.episode).toBe(3);
        expect(p?.progress?.history).toEqual([]);
    });

    it('阅读进度：改页数会**重算 percent**（不重算就会出现「页数和百分比互相矛盾」）', () => {
        const e = mk({ type: 'book', readingProgress: { page: 50, totalPage: 200, percent: 25 } });
        const p = applyNoteCardEdit(e, 'reading_page', '100');
        expect(p?.readingProgress?.page).toBe(100);
        expect(p?.readingProgress?.totalPage).toBe(200);
        expect(p?.readingProgress?.percent).toBe(50);
        // 改总页数同样重算
        const p2 = applyNoteCardEdit(e, 'reading_total_page', '400');
        expect(p2?.readingProgress?.percent).toBe(13); // 50 / 400 = 12.5 ⇒ round 13
        // 总页数为 0 ⇒ percent 归 0（⛔ 不能除出 Infinity/NaN）
        const p3 = applyNoteCardEdit(mk({ type: 'book', readingProgress: { page: 10, totalPage: 0 } }), 'reading_page', '20');
        expect(p3?.readingProgress?.percent).toBe(0);
    });

    it('`author` 一律写 `author`，⛔ 绝不落到 `artist`（漫画画师的键）', () => {
        const p = applyNoteCardEdit(mk({ type: 'music' }), 'author', '周杰伦');
        expect(p).toEqual({ author: '周杰伦' });
        expect(p).not.toHaveProperty('artist');
    });

    it('不可写的键返 null：type / progress_percent / created / updated', () => {
        for (const key of ['type', 'progress_percent', 'created', 'updated']) {
            expect(applyNoteCardEdit(mk(), key, 'x')).toBeNull();
        }
    });

    it('每个可写的投影行，`applyNoteCardEdit` 都能给出 patch（成对性总检）', () => {
        const e = mk({ type: 'book', bookKind: 'book', author: '刘慈欣', year: 2008, pageCount: 340 });
        const rows = buildNoteCardGroups(e).flatMap((g) => g.rows);
        const writable = rows.filter((r) => r.kind !== 'readonly');
        expect(writable.length).toBeGreaterThan(10);
        for (const r of writable) {
            // 用「当前值」回写：成对的实现必须给得出 patch（哪怕是空对象级别的等价）
            const patch = applyNoteCardEdit(e, r.key, r.value);
            expect(patch, `字段 ${r.key}（${r.label}）读得出却写不回 —— 投影/回写不成对`).not.toBeNull();
        }
    });
});

describe('noteCard · 🔴 长名单收紧（用户 m00983 ②：「详情不要太多，演员等长字段要收紧」）', () => {
    it('主演超过 6 项 ⇒ 只展开前 6 个 + 「等 N 人」', () => {
        const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
        const v = rowMap(mk({ cast: names })).get('cast')!.value;
        expect(v).toBe('甲、乙、丙、丁、戊、己 等 8 人');
        // 前 6 项都在，后两项**不出现在**展示文本里
        for (const n of names.slice(0, 6)) expect(v).toContain(n);
        expect(v).not.toContain('庚');
        expect(v).not.toContain('辛');
    });

    it('主演恰好 6 项 ⇒ 不截断、不出现尾注', () => {
        const v = rowMap(mk({ cast: ['甲', '乙', '丙', '丁', '戊', '己'] })).get('cast')!.value;
        expect(v).toBe('甲、乙、丙、丁、戊、己');
        expect(v).not.toContain('等');
    });

    it('编剧同样收紧（与主演一个口径）', () => {
        const v = rowMap(mk({ screenwriter: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).get('screenwriter')!.value;
        expect(v).toBe('a、b、c、d、e、f 等 7 人');
    });

    it('🔴 标签 / 别名这类用户自填短列表**不**被截断（截掉就是「我填的东西不见了」）', () => {
        // ⚠️ 实测发现 `genres` **不在** GROUP_DEFS 里 ⇒ 卡片本来就不显示题材（既有行为，不是本次改的），
        //    所以这里只钉真正会出现在卡片上的两个用户自填列表键。
        const many = ['1', '2', '3', '4', '5', '6', '7', '8'];
        expect(rowMap(mk({ tags: many })).get('tags')!.value).toBe('1、2、3、4、5、6、7、8');
        expect(rowMap(mk({ aliases: many })).get('aliases')!.value).toBe('1、2、3、4、5、6、7、8');
    });

    it('🔴 收紧只是展示投影，不动源数据（读一遍展示后 cast 仍是完整 8 项）', () => {
        const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
        const entry = mk({ cast: names });
        rowMap(entry);
        expect(entry.cast).toHaveLength(8);
    });
});

describe('noteCard · 纯层边界', () => {    it('不 import obsidian（纯逻辑，必须能在 vitest 里裸跑）', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const src = readFileSync(resolve(__dirname, '..', 'src/pure/noteCard.ts'), 'utf8');
        expect(src).not.toMatch(/from ['"]obsidian['"]/);
        expect(src).not.toMatch(/require\(['"]obsidian['"]\)/);
    });

    it('`hasNoteCard`：任何类型都至少有基本信息组 ⇒ 恒为真（守卫「别哪天删空了」）', () => {
        expect(hasNoteCard(mk())).toBe(true);
        expect(hasNoteCard(mk({ type: 'movie' }))).toBe(true);
        expect(hasNoteCard(mk({ type: 'game' }))).toBe(true);
        expect(hasNoteCard(mk({ type: 'music' }))).toBe(true);
        expect(hasNoteCard(mk({ type: 'book' }))).toBe(true);
    });
});
