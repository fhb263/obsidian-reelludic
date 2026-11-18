// 六种类型的「笔记渲染条目卡」全量真机测验（用户 m01782 逐字：
// 「还有真机测验一下所有类型笔记渲染条目卡，因为音乐类型笔记怎么渲染卡里有书籍的字段的？」）
//
// 🔴 用户报的那个 bug 不是孤例：`book` 组里静态写着 `author`，而 `author.appliesTo`
//    是 `['book','music']`（音乐侧显示成「艺术家」）⇒ 音乐卡渲染出一整块标题写「书籍」、
//    内容是「艺术家」的组。根因是「**分组表是静态的**，`fieldAppliesTo` 只管字段该不该出现、
//    管不了它该归到哪个组」。
//
// ⇒ 这个文件不只为 `author` 写一条，而是**穷举六类型 × 全部已登记字段**，逐条验证：
//    ⑴ 每个出现的字段都真的适用于该类型（`fieldAppliesTo` 为真）；
//    ⑵ 每个键最多出现在**一个**组里（挪组⛔ 不能变成复制）；
//    ⑶ 组标题与内容不打架 —— 例如「音乐」组里⛔ 不许出现书籍专属字段。
//
// ⚠️ 这是**行为级**测试（调真的 `buildNoteCardGroups`），不是源码文本守卫：
//    它锁的是「投影结果对不对」，不是「代码长什么样」。
import { describe, expect, it } from 'vitest';
import type { EntryType, MediaEntry } from 'data/types';
import { ENTRY_TYPES } from 'data/types';
import { fieldAppliesTo } from 'pure/metaFields';
import { buildNoteCardGroups } from 'pure/noteCard';

/** 造一个「六类字段全塞满」的条目，用来暴露跨类型串组 */
function stuffed(type: EntryType): MediaEntry {
    return {
        id: `x-${type}`,
        type,
        title: `测试-${type}`,
        status: 'watched',
        // 书籍专属
        translator: '译者甲',
        publisher: '出版社甲',
        isbn: '9787000000000',
        binding: '精装',
        price: '59.00',
        pageCount: 320,
        readingPage: 120,
        readingTotalPage: 320,
        readMinutes: 95,
        // 书籍 + 音乐共用（音乐侧显示为「艺术家」）
        author: '作者甲',
        // 音乐专属
        album: '专辑甲',
        // 影视专属
        director: '导演甲',
        screenwriter: ['编剧甲'],
        cast: ['演员甲', '演员乙'],
        country: '中国',
        language: '汉语',
        durationMin: 118,
        producer: '出品方甲',
        // 游戏专属
        developer: '开发甲',
        // 通用
        year: 2020,
        rating: 4,
        mood: 'wow',
        tags: ['标签甲'],
    } as unknown as MediaEntry;
}

/** 把分组拉平成 key → 组 key，便于查「某个字段落在哪个组」 */
function groupOf(entry: MediaEntry): Map<string, string> {
    const out = new Map<string, string>();
    for (const g of buildNoteCardGroups(entry)) {
        for (const row of g.rows) out.set(row.key, g.key);
    }
    return out;
}

describe('🔴 六类型条目卡：跨类型字段⛔ 不许串组（m01782 音乐卡出书籍字段的泛化守卫）', () => {
    it('每个出现的字段都真的适用于该类型（fieldAppliesTo 为真）', () => {
        const bad: string[] = [];
        for (const type of ENTRY_TYPES) {
            const g = groupOf(stuffed(type));
            for (const key of g.keys()) {
                if (!fieldAppliesTo(key, type)) bad.push(`${type} 卡上出现了不适用的 ${key}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('每个键在任意类型下最多出现在一个组（挪组⛔ 不能变成复制）', () => {
        const dup: string[] = [];
        for (const type of ENTRY_TYPES) {
            const seen = new Set<string>();
            for (const g of buildNoteCardGroups(stuffed(type))) {
                for (const row of g.rows) {
                    if (seen.has(row.key)) dup.push(`${type}: ${row.key} 出现了两次`);
                    seen.add(row.key);
                }
            }
        }
        expect(dup).toEqual([]);
    });

    it('🔴 音乐卡上⛔ 不许出现「书籍」组（用户报障的原点）', () => {
        const groups = buildNoteCardGroups(stuffed('music'));
        expect(groups.some((g) => g.key === 'book')).toBe(false);
        expect(groups.some((g) => g.label === '书籍')).toBe(false);
    });

    it('音乐卡的 author 落在「音乐」组，标签是「艺术家」（挪组≠删字段）', () => {
        const groups = buildNoteCardGroups(stuffed('music'));
        const musicGroup = groups.find((g) => g.key === 'music');
        expect(musicGroup).toBeDefined();
        const authorRow = musicGroup?.rows.find((r) => r.key === 'author');
        expect(authorRow).toBeDefined();
        expect(authorRow?.label).toBe('艺术家');
        expect(authorRow?.value).toBe('作者甲');
    });

    it('书籍卡的 author 仍在「书籍」组，标签是「作者」（⛔ 别为修音乐把书籍也改坏）', () => {
        const groups = buildNoteCardGroups(stuffed('book'));
        const bookGroup = groups.find((g) => g.key === 'book');
        expect(bookGroup).toBeDefined();
        const authorRow = bookGroup?.rows.find((r) => r.key === 'author');
        expect(authorRow).toBeDefined();
        expect(authorRow?.label).toBe('作者');
    });

    it('书籍专属字段⛔ 不出现在音乐/影视/游戏卡上', () => {
        const bookOnly = ['translator', 'publisher', 'isbn', 'binding', 'price', 'pageCount', 'readingPage', 'readingTotalPage', 'readMinutes'];
        const bad: string[] = [];
        for (const type of ['music', 'movie', 'tv', 'game'] as const) {
            const g = groupOf(stuffed(type));
            for (const key of bookOnly) {
                if (g.has(key)) bad.push(`${type} 卡上出现了书籍字段 ${key}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('影视卡⛔ 不出现「出品方」（④：用户要求删影视下的出品方）', () => {
        for (const type of ['movie', 'tv'] as const) {
            expect(groupOf(stuffed(type)).has('producer')).toBe(false);
        }
        // 游戏仍有出品方（用户只要求删影视下的）
        expect(groupOf(stuffed('game')).get('producer')).toBeDefined();
    });

    it('「书籍」这个组标题只在书籍卡上出现', () => {
        for (const type of ENTRY_TYPES) {
            const hasBookGroup = buildNoteCardGroups(stuffed(type)).some((g) => g.label === '书籍');
            expect({ type, hasBookGroup }).toEqual({ type, hasBookGroup: type === 'book' });
        }
    });

    it('六类型都能建出分组、且至少有一个组有内容（没有「整卡空白」的类型）', () => {
        for (const type of ENTRY_TYPES) {
            const groups = buildNoteCardGroups(stuffed(type));
            expect(groups.length).toBeGreaterThan(0);
            expect(groups.some((g) => g.rows.length > 0)).toBe(true);
        }
    });
});
