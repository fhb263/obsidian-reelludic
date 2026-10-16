// 字段映射纯逻辑单测（1.3.1 ①，2026-10-12）
//
// 契约来源：用户给定的映射语法 `[原始属性名] -> [新属性名]`
//   · 参考实现 Media DB Plugin 的 Field Mapping（允许用户重命名插件生成的元数据字段）
//   · 可映射的键集合 = `pure/metaFields.MAPPABLE_FIELD_KEYS`（已排除用户点名保护的四个 Dataview 对齐键）
import { describe, it, expect } from 'vitest';
import {
    EMPTY_FIELD_MAP,
    compileFieldMap,
    compileFieldMapText,
    mapForward,
    mapReverse,
    parseFieldMap,
} from 'pure/fieldMap';
import { META_FIELDS, isMappableKey } from 'pure/metaFields';
import { entryFrontmatter } from 'data/noteGenerator';
import { extractFrontmatterFromNote } from 'pure/noteEditable';
import type { MediaEntry } from 'data/types';

describe('pure/fieldMap 解析（语法 [原始属性名] -> [新属性名]）', () => {
    it('基本形态：方括号 + 空格', () => {
        const r = parseFieldMap('[title] -> [uesrkey]');
        expect(r.entries).toEqual([{ from: 'title', to: 'uesrkey', line: 1 }]);
        expect(r.errors).toEqual([]);
    });

    it('方括号可省（裸键名照收）', () => {
        expect(parseFieldMap('title -> uesrkey').entries).toEqual([{ from: 'title', to: 'uesrkey', line: 1 }]);
    });

    it('箭头两侧无空格也认', () => {
        expect(parseFieldMap('year->release').entries).toEqual([{ from: 'year', to: 'release', line: 1 }]);
    });

    it('全角箭头 → 与半角 -> 等价', () => {
        expect(parseFieldMap('year → release').entries).toEqual([{ from: 'year', to: 'release', line: 1 }]);
    });

    it('空行与 # 注释整体跳过（注释不占行号以外的语义）', () => {
        const r = parseFieldMap('\n# 这是注释\n[year] -> [release]\n\n');
        expect(r.entries).toEqual([{ from: 'year', to: 'release', line: 3 }]);
        expect(r.errors).toEqual([]);
    });

    it('中文目标键合法（Obsidian 的 YAML 键支持中文）', () => {
        const r = parseFieldMap('[year] -> [发行年份]');
        expect(r.entries).toEqual([{ from: 'year', to: '发行年份', line: 1 }]);
        expect(r.errors).toEqual([]);
    });

    it('多行：逐行独立解析，行号如实回填', () => {
        const r = parseFieldMap('[year] -> [release]\n[author] -> [creator]');
        expect(r.entries).toEqual([
            { from: 'year', to: 'release', line: 1 },
            { from: 'author', to: 'creator', line: 2 },
        ]);
        expect(r.errors).toEqual([]);
    });

    it('空文本 / 全空白 → 空映射、零错误', () => {
        expect(parseFieldMap('')).toEqual({ entries: [], errors: [] });
        expect(parseFieldMap('   \n\n  ')).toEqual({ entries: [], errors: [] });
    });
});

describe('pure/fieldMap 校验（每条错误都带行号，供设置页就地提示）', () => {
    it('缺箭头 → 报错', () => {
        const r = parseFieldMap('[title] [uesrkey]');
        expect(r.entries).toEqual([]);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain('第 1 行');
    });

    it('源键未登记（拼错 / 不存在的字段）→ 报错', () => {
        const r = parseFieldMap('[titel] -> [x]');
        expect(r.entries).toEqual([]);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain('titel');
    });

    it('🔴 #613 翻面：四个 Dataview 对齐键**也可以映射**（用户裁定「全部可填」）', () => {
        for (const k of ['rating', 'tags', 'created', 'updated']) {
            const r = parseFieldMap(`[${k}] -> [x]`);
            expect(r.entries, `${k} 应当被接受`).toEqual([{ from: k, to: 'x', line: 1 }]);
            expect(r.errors).toEqual([]);
        }
    });

    it('🔴 但仍不许把某字段改名叫**另一个登记字段**（会写出两个同名键）—— 与「保护名单」无关', () => {
        const bad = parseFieldMap('[title] -> [rating]');
        expect(bad.entries).toEqual([]);
        expect(bad.errors).toHaveLength(1);
        expect(bad.errors[0]).toContain('rating');
    });

    it('目标键含非法字符（空格 / 冒号）→ 报错', () => {
        expect(parseFieldMap('[title] -> [my key]').errors).toHaveLength(1);
        expect(parseFieldMap('[title] -> [a:b]').errors).toHaveLength(1);
    });

    it('源键与目标键同名（无意义映射）→ 报错', () => {
        const r = parseFieldMap('[year] -> [year]');
        expect(r.entries).toEqual([]);
        expect(r.errors).toHaveLength(1);
    });

    it('同一源键映射两次 → 报错', () => {
        const r = parseFieldMap('[year] -> [a]\n[year] -> [b]');
        expect(r.entries).toHaveLength(1);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain('第 2 行');
    });

    it('两个源键映射到同一目标键 → 报错', () => {
        const r = parseFieldMap('[year] -> [x]\n[author] -> [x]');
        expect(r.entries).toHaveLength(1);
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0]).toContain('第 2 行');
    });

    it('🔴 目标键占用了**未参与映射的原始键** → 报错（会让那个字段写不出正确键名）', () => {
        const r = parseFieldMap('[title] -> [status]');
        expect(r.entries).toEqual([]);
        expect(r.errors).toHaveLength(1);
    });

    it('🔴 源键集合与目标键集合相交（链式映射）→ 报错', () => {
        const r = parseFieldMap('[title] -> [year]\n[year] -> [release]');
        expect(r.errors).toHaveLength(1);
    });

    it('一条错不影响同批的合法行（只丢错行）', () => {
        const r = parseFieldMap('[year] -> [release]\n[titel] -> [x]\n[author] -> [creator]');
        expect(r.entries.map((e) => e.from)).toEqual(['year', 'author']);
        expect(r.errors).toHaveLength(1);
    });

    it('🔴 #613：可映射集合 = **全部登记字段**（42 个一个不漏）', () => {
        const assignable = META_FIELDS.filter((f) => isMappableKey(f.key)).map((f) => f.key);
        expect(assignable).toEqual(META_FIELDS.map((f) => f.key));
        // ⛔ 未登记的键仍然拒绝 —— 拼错一个键名会静默写出一堆谁也不认的 frontmatter 键
        expect(isMappableKey('titel')).toBe(false);
    });
});

describe('pure/fieldMap 编译与应用', () => {
    it('compileFieldMap 出正向（写侧）与反向（读侧）两张表', () => {
        const m = compileFieldMap([{ from: 'title', to: 'uesrkey' }]);
        expect(m.forward.get('title')).toBe('uesrkey');
        expect(m.reverse.get('uesrkey')).toBe('title');
        expect(m.forward.size).toBe(1);
        expect(m.reverse.size).toBe(1);
    });

    it('mapForward / mapReverse 落空时原样返回（未映射的键不受影响）', () => {
        const m = compileFieldMap([{ from: 'title', to: 'uesrkey' }]);
        expect(mapForward(m, 'title')).toBe('uesrkey');
        expect(mapForward(m, 'year')).toBe('year');
        expect(mapReverse(m, 'uesrkey')).toBe('title');
        expect(mapReverse(m, 'year')).toBe('year');
    });

    it('compileFieldMapText 容错：只编译合法行', () => {
        const m = compileFieldMapText('[title] -> [uesrkey]\n[bogus] -> [x]');
        expect(m.forward.get('title')).toBe('uesrkey');
        expect(m.forward.has('bogus')).toBe(false);
    });

    it('EMPTY_FIELD_MAP 是恒等映射（未配置映射时的缺省行为）', () => {
        expect(mapForward(EMPTY_FIELD_MAP, 'title')).toBe('title');
        expect(mapReverse(EMPTY_FIELD_MAP, 'uesrkey')).toBe('uesrkey');
        expect(EMPTY_FIELD_MAP.forward.size).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 读写闭环 —— 本批（1.3.1 ①）最核心的契约
// 用户的原始诉求是「映射重命名插件生成的元数据字段」，那么**写出去的新键名必须能读回来**，
// 否则用户改完名字，下次打开编辑表单就会发现「我在笔记里改的值不见了」。
// ══════════════════════════════════════════════════════════════════════════════
describe('🔴 读写闭环：写侧改名 → 读侧反查', () => {
    function entry(partial: Partial<MediaEntry> = {}): MediaEntry {
        return {
            id: 'e1',
            type: 'movie',
            title: '标题',
            status: 'watching',
            rating: 4,
            year: 2020,
            genres: ['题材'],
            cast: [],
            director: '某某',
            links: [],
            notes: '',
            tags: [],
            createdAt: '2026-08-25T00:00:00.000Z',
            updatedAt: '2026-08-25T00:00:00.000Z',
            ...partial,
        };
    }

    it('笔记里写出新键名，读回来仍是原字段（值不丢）', () => {
        const map = compileFieldMapText('[year] -> [release]\n[director] -> [导演]');
        const fm = entryFrontmatter(entry(), 'ReelLudic', map);

        expect(fm).toContain('release: 2020');
        expect(fm).toContain('导演: "某某"');
        expect(fm).not.toContain('\nyear:');
        expect(fm).not.toContain('\ndirector:');

        const back = extractFrontmatterFromNote(fm, map);
        expect(back.year).toBe(2020);
        expect(back.director).toBe('某某');
    });

    it('不配置映射时产物与历史完全一致（恒等，不影响存量用户）', () => {
        const e = entry();
        expect(entryFrontmatter(e)).toBe(entryFrontmatter(e, 'ReelLudic', EMPTY_FIELD_MAP));
        expect(entryFrontmatter(e)).toContain('year: 2020');
    });

    it('值里含冒号时不会被误改（只认行首到第一个冒号）', () => {
        const map = compileFieldMapText('[year] -> [release]');
        const fm = entryFrontmatter(entry({ title: '沙丘2: Part Two' }), 'ReelLudic', map);
        expect(fm).toContain('title: "沙丘2: Part Two"');
        expect(fm).toContain('release: 2020');
    });

    it('未映射的键两侧都保持原名', () => {
        const map = compileFieldMapText('[year] -> [release]');
        expect(entryFrontmatter(entry(), 'ReelLudic', map)).toContain('rating: 4');
        expect(extractFrontmatterFromNote('---\nrating: 4\n---', map).rating).toBe(4);
    });

    it('用户示例（title -> uesrkey）端到端成立', () => {
        const map = compileFieldMapText('[title] -> [uesrkey]');
        const fm = entryFrontmatter(entry(), 'ReelLudic', map);
        expect(fm).toContain('uesrkey: "标题"');
        expect(fm).not.toContain('\ntitle:');
    });
});
