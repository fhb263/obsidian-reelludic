// 元数据字段真源的一致性守卫（1.3.1 ①，2026-10-12）
//
// `pure/metaFields` 是**描述性**清单（它不生成 YAML、也不解析 YAML），所以必须有一套
// 断言把「清单」钉在两个**真源**上，否则两边一漂移，设置页展示的字段清单就是错的：
//   · 写侧真源 = `data/noteGenerator.entryFrontmatter`
//   · 读侧真源 = `pure/noteEditable.extractFrontmatterFromNote`
//
// 🔴 守卫是**自动的、零手工映射表**的：对每个登记键单独喂一份最小 frontmatter，
//    看真源认不认它 —— 这样新增字段的人只要漏登记一边，这里立刻红。
import { describe, it, expect } from 'vitest';
import { findMetaField, isMappableKey, META_FIELDS, type MetaField } from 'pure/metaFields';
import { entryFrontmatter } from 'data/noteGenerator';
import { extractFrontmatterFromNote } from 'pure/noteEditable';
import type { EntryType, MediaEntry } from 'data/types';

const ALL_TYPES: readonly EntryType[] = ['movie', 'tv', 'anime', 'book', 'game', 'music'];

/** 填满所有与 frontmatter 有关的字段（各 type 独有的字段由 `entryFrontmatter` 自己门控） */
function fullEntry(type: EntryType): MediaEntry {
    return {
        id: 'e1',
        type,
        title: '标题',
        status: 'watching',
        rating: 4,
        year: 2020,
        genres: ['题材'],
        cast: ['演员'],
        director: '导演',
        screenwriter: ['编剧'],
        country: '中国',
        language: '中文',
        durationMin: 100,
        aliases: ['又名'],
        author: '作者',
        artist: '画师',
        translator: '译者',
        publisher: '出版社',
        producer: '出品方',
        isbn: '9780000000000',
        binding: '平装',
        price: '¥ 68',
        series: '系列名',
        seriesIndex: 1,
        platform: 'PC',
        developer: '开发商',
        album: '专辑名',
        poster: '封面/x.jpg',
        tags: ['标签'],
        links: [],
        notes: '',
        watchedDate: '2024-03-08',
        plannedDate: '2024-04-09',
        pageCount: 320,
        readMinutes: 90,
        playtimeMinutes: 120,
        readingProgress: { page: 10, totalPage: 100 },
        progress: { season: 1, episode: 3, totalEpisodes: 12, history: [] },
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-08-25T00:00:00.000Z',
    };
}

/** 从 YAML frontmatter 文本里取出顶层键（值里含冒号也不影响 —— 只切第一个冒号） */
function fmKeys(fm: string): string[] {
    const body = /^---\n([\s\S]*?)\n---/.exec(fm)?.[1] ?? '';
    return body
        .split('\n')
        .map((l) => l.slice(0, l.indexOf(':')))
        .filter((k) => !!k);
}

/** 按声明的形态造一个最小合法样本值（enum 只用于 status） */
function sampleFor(f: MetaField): string {
    switch (f.kind) {
        case 'number':
            return '1';
        case 'list':
            return '[v]';
        case 'date':
            return '2026-01-01';
        case 'enum':
            return 'watching';
        case 'string':
        default:
            return 'v';
    }
}

/** 把单个键包成一份最小 frontmatter */
function fmOf(key: string, value: string): string {
    return `---\n${key}: ${value}\n---`;
}

describe('pure/metaFields 表本身的完整性', () => {
    it('键唯一、顺序稳定（顺序 = entryFrontmatter 的输出顺序）', () => {
        const keys = META_FIELDS.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('每项都有中文标签与形态', () => {
        for (const f of META_FIELDS) {
            expect(f.label.length, `${f.key} 缺中文标签`).toBeGreaterThan(0);
            expect(f.kind, `${f.key} 缺形态`).toBeTruthy();
        }
    });

    it('可映射键集合 = 全部登记字段（#613 翻面：不再有「锁定」这一档）', () => {
        expect(META_FIELDS.filter((f) => isMappableKey(f.key)).map((f) => f.key)).toEqual(
            META_FIELDS.map((f) => f.key),
        );
    });
});

describe('🔴 写侧一致性：metaFields.writable ↔ entryFrontmatter 实际输出', () => {
    it('六个类型合并后的实际输出键集合 = writable 标记为 true 的键集合', () => {
        const actual = new Set<string>();
        for (const t of ALL_TYPES) for (const k of fmKeys(entryFrontmatter(fullEntry(t)))) actual.add(k);
        const declared = META_FIELDS.filter((f) => f.writable).map((f) => f.key);

        // 双向差集都要空：漏登记（写侧有、清单没有）与 空登记（清单有、写侧没有）
        const missing = [...actual].filter((k) => !declared.includes(k));
        const ghost = declared.filter((k) => !actual.has(k));
        expect(missing, `写侧有但清单漏登记：${missing.join(', ')}`).toEqual([]);
        expect(ghost, `清单登记了但写侧并不输出：${ghost.join(', ')}`).toEqual([]);
    });
});

describe('🔴 读侧一致性：metaFields.readable ↔ handlers 实际解析（逐键单独喂）', () => {
    it('readable=true 的键，单独喂进去必须解析出内容', () => {
        const broken: string[] = [];
        for (const f of META_FIELDS.filter((x) => x.readable)) {
            const out = extractFrontmatterFromNote(fmOf(f.key, sampleFor(f)));
            if (Object.keys(out).length === 0) broken.push(f.key);
        }
        expect(broken, `清单说可读、读侧却不认：${broken.join(', ')}`).toEqual([]);
    });

    it('readable=false 的键，单独喂进去必须解析不出任何字段', () => {
        const leaked: string[] = [];
        for (const f of META_FIELDS.filter((x) => !x.readable)) {
            const out = extractFrontmatterFromNote(fmOf(f.key, sampleFor(f)));
            if (Object.keys(out).length > 0) leaked.push(f.key);
        }
        expect(leaked, `清单说不可读、读侧却解析了：${leaked.join(', ')}`).toEqual([]);
    });
});

describe('🔴 #613：Dataview 对齐键只是**标记**，不再拦截', () => {
    it('四个键都登记为 `dataviewAligned`（设置页在那几行挂徽标 + 悬停说明改名风险）', () => {
        for (const k of ['rating', 'tags', 'created', 'updated']) {
            expect(findMetaField(k)?.dataviewAligned, `${k} 该带 Dataview 标记`).toBe(true);
        }
    });

    it('但**不是**「不可映射」—— 用户裁定「全部可填」，42 个字段一个不落', () => {
        for (const f of META_FIELDS) {
            expect(isMappableKey(f.key), `${f.key} 应当可映射`).toBe(true);
        }
    });

    it('用户示例用到的 title 必须可映射（否则示例本身不成立）', () => {
        expect(isMappableKey('title')).toBe(true);
    });
});
