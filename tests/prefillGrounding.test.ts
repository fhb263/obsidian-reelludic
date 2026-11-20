// m16449：AI 预填的真实性闸口（用户「优化AI预填真实每个类型返回模拟」⇒ 选定「修掉编造」）
//
// 这批测试守三件事：
//   ① 闸口本身的判定逻辑（数字边界、多值 token、豁免键、空产出）
//   ② 六类型各自「真实字段能被工具产出证实」+「编造字段会被丢」
//   ③ 装配：`describeSearchResult` 真的把 facts 交出去了、服务层真的调了闸口
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import {
    PREFILL_PERSONAL_KEYS,
    droppedNotice,
    factGrounded,
    groundPrefillFields,
    normalizeFact,
} from 'pure/prefillGrounding';
import { describeSearchResult } from 'pure/searchDisplay';
import { prefillFieldsFor } from 'pure/aiPrefill';

const ROOT = resolve(__dirname, '..');

describe('m16449 ① 归一与单值判定', () => {
    it('normalizeFact：NFKC + 小写 + 去空白', () => {
        expect(normalizeFact('  七 里 香 ')).toBe('七里香');
        expect(normalizeFact('１２')).toBe('12');
        expect(normalizeFact(null)).toBe('');
        expect(normalizeFact(42)).toBe('');
    });

    it('整串命中即通过（覆盖简介这种整段照抄）', () => {
        expect(factGrounded('刘慈欣', '「三体」的已核实字段：\n  作者：刘慈欣')).toBe(true);
    });

    it('🔴 数字必须做边界检查：12 不能命中 2012 / 3120', () => {
        expect(factGrounded('12', '总集数：2012')).toBe(false);
        expect(factGrounded('12', '总集数：3120')).toBe(false);
        expect(factGrounded('12', '总集数：12')).toBe(true);
    });

    it('多值字段逐个 token 检查，缺一个就整条不通过', () => {
        const hay = '主演：汤姆·汉克斯 / 罗宾·怀特';
        expect(factGrounded('汤姆·汉克斯 / 罗宾·怀特', hay)).toBe(true);
        expect(factGrounded('汤姆·汉克斯 / 汤姆·克鲁斯', hay)).toBe(false);
    });

    it('单字符 token 没有判别力 ⇒ 忽略；全是单字符 ⇒ 不通过', () => {
        expect(factGrounded('甲 / 乙', '主演：丙 / 丁')).toBe(false);
        expect(factGrounded('甲', '主演：丙')).toBe(false);
    });

    it('空工具产出 ⇒ 任何事实都不通过（没检索就没有事实）', () => {
        expect(factGrounded('刘慈欣', '')).toBe(false);
        expect(factGrounded('刘慈欣', '   ')).toBe(false);
    });
});

describe('m16449 ② 过闸：保留 vs 丢弃', () => {
    const defs = prefillFieldsFor('tv');

    it('有据的留下、编的丢掉，并如实记在 dropped 里', () => {
        const hay = '「沙丘」的已核实字段：\n  导演：丹尼斯·维伦纽瓦\n  主演：提莫西·查拉梅\n  发行年：2021';
        const r = groundPrefillFields(
            {
                directorWriters: '丹尼斯·维伦纽瓦',
                cast: '提莫西·查拉梅',
                year: '2021',
                // 👇 这三个在产出里根本没有（典型的「模拟」值）
                totalEpisodes: '10',
                genres: '史诗 / 科幻',
                summary: '一段编出来的简介',
            },
            hay,
            defs,
        );
        expect(r.fields).toEqual({
            directorWriters: '丹尼斯·维伦纽瓦',
            cast: '提莫西·查拉梅',
            year: '2021',
        });
        expect(r.dropped.sort()).toEqual(['genres', 'summary', 'totalEpisodes']);
    });

    it('`tags` 是唯一豁免键（个人标签外部源永远不会有）', () => {
        expect(PREFILL_PERSONAL_KEYS).toEqual(['tags']);
        const r = groundPrefillFields({ tags: '周末, 睡前' }, '', defs);
        expect(r.fields.tags).toBe('周末, 睡前');
        expect(r.dropped).toEqual([]);
    });

    it('schema 之外的键一律不输出', () => {
        const r = groundPrefillFields({ 不存在: 'x', tags: 'a' }, '', defs);
        expect(r.fields).toEqual({ tags: 'a' });
    });

    it('🔴 没有工具产出 ⇒ 只剩 tags（其余全丢，这是正确结果）', () => {
        const r = groundPrefillFields({ summary: '编的', year: '2021', tags: 'A' }, '', defs);
        expect(r.fields).toEqual({ tags: 'A' });
        expect(r.dropped.sort()).toEqual(['summary', 'year']);
    });

    it('droppedNotice：空清单返回 null；有点名', () => {
        expect(droppedNotice([], defs)).toBeNull();
        const msg = droppedNotice(['summary', 'year'], defs);
        expect(msg).toContain('2 项');
        expect(msg).toContain('简介');
        expect(msg).toContain('首播年'); // tv 的 year 标签是「首播年」
        expect(msg).toContain('查不到就不编');
    });
});

describe('m16449 ③ 六类型：真实字段有据可查、编造字段被丢', () => {
    // 每个类型用一条**贴近真源形状**的结果，模拟宿主 `lookup_metadata` 的真实产出文本：
    // facts 逐条列出 + 单独的「题材原文：」行（宿主实际就是这么拼的，见 `main.ts`）。
    const hayOf = (raw: Record<string, unknown>): string => {
        const d = describeSearchResult(raw as never);
        const parts = [...(d.facts ?? [])];
        if (d.genres?.length) parts.push(`题材原文：${d.genres.join(' / ')}`);
        return parts.join('\n');
    };
    const cases: { type: Parameters<typeof prefillFieldsFor>[0]; bookKind?: 'novel'; raw: Record<string, unknown>; good: Record<string, string>; bad: Record<string, string> }[] = [
        {
            type: 'movie',
            raw: { source: 'tmdb', title: '沙丘', director: '丹尼斯·维伦纽瓦', cast: ['提莫西·查拉梅'], year: 2021, genres: ['科幻'] },
            good: { directorWriters: '丹尼斯·维伦纽瓦', cast: '提莫西·查拉梅', year: '2021', genres: '科幻' },
            // ⚠️ 电影没有「总集数」这一格（`screenDefs` 只有 tv/anime 才 push），所以只放两个真有的键
            bad: { summary: '编的简介', cast: '汤姆·克鲁斯' },
        },
        {
            type: 'tv',
            raw: { source: 'tmdb', title: '绝命毒师', director: '文斯·吉里根', cast: ['布莱恩·科兰斯顿'], year: 2008, episodeCount: 62, genres: ['犯罪'] },
            good: { cast: '布莱恩·科兰斯顿', totalEpisodes: '62', genres: '犯罪' },
            bad: { totalEpisodes: '13', summary: '编的' },
        },
        {
            type: 'anime',
            raw: { source: 'bangumi', title: '进击的巨人', studio: 'WIT STUDIO', cast: ['梶裕贵'], episodeCount: 25, genres: ['动作'] },
            good: { cast: '梶裕贵', totalEpisodes: '25', genres: '动作' },
            bad: { totalEpisodes: '12', summary: '编的' },
        },
        {
            type: 'book',
            raw: { source: 'douban', title: '三体', author: '刘慈欣', publisher: '重庆出版社', isbn: '9787536692930', pageCount: 302, year: 2008, genres: ['科幻'] },
            good: { author: '刘慈欣', publisher: '重庆出版社', isbn: '9787536692930', pageCount: '302', genres: '科幻' },
            bad: { pageCount: '500', isbn: '9780000000000', summary: '编的' },
        },
        {
            type: 'game',
            raw: { source: 'steam', id: 1245620, title: '艾尔登法环', developer: 'FromSoftware', platform: 'PC', year: 2022, genres: ['动作'] },
            good: { developer: 'FromSoftware', platform: 'PC', genres: '动作' },
            bad: { developer: '米哈游', summary: '编的' },
        },
        {
            type: 'music',
            raw: { source: 'songlib', title: '七里香', artist: '周杰伦', album: '七里香', year: 2004, duration: 299 },
            good: { author: '周杰伦', album: '七里香', year: '2004' },
            bad: { album: '范特西', summary: '编的' },
        },
    ];

    for (const c of cases) {
        it(`${c.type}：有据的字段全部留下`, () => {
            const hay = hayOf(c.raw);
            expect(hay.length).toBeGreaterThan(0);
            const defs = prefillFieldsFor(c.type, c.bookKind);
            const r = groundPrefillFields(c.good, hay, defs);
            expect(r.dropped).toEqual([]);
            expect(r.fields).toEqual(c.good);
        });

        it(`${c.type}：编造的字段全部丢弃`, () => {
            const hay = hayOf(c.raw);
            const defs = prefillFieldsFor(c.type, c.bookKind);
            const r = groundPrefillFields(c.bad, hay, defs);
            expect(r.fields).toEqual({});
            expect(r.dropped.sort()).toEqual(Object.keys(c.bad).sort());
        });
    }
});

describe('m16449 ④ 装配：真源真的交出去了、服务层真的过闸了', () => {
    const display = readFileSync(resolve(ROOT, 'src/pure/searchDisplay.ts'), 'utf8');
    const svc = readFileSync(resolve(ROOT, 'src/services/aiPrefill.ts'), 'utf8');
    const main = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');

    it('searchDisplay 的五个形状分支都产出 facts', () => {
        const n = (display.match(/^ {8}facts: \(\(\) => \{/gm) ?? []).length;
        expect(n).toBe(5);
        expect(display).toContain('function factsOf(items: string[]): string[] | undefined');
        expect(display).toContain('function pushFact(out: string[], label: string, value: unknown): void');
    });

    it('服务层调用闸口，且闸口在 preferToolSynopsis/preferToolGenres 之后', () => {
        expect(svc).toContain("import { droppedNotice, groundPrefillFields } from 'pure/prefillGrounding';");
        expect(svc).toContain('const grounded = groundPrefillFields(merged, toolTexts.join(');
        expect(svc).toContain('const note = droppedNotice(grounded.dropped, defs);');
        expect(svc).toContain('return grounded.fields;');
        // 顺序：先照搬（简介/题材），再过闸
        const iPref = svc.indexOf('preferToolSynopsis(f as never, toolSynopsis, defs)');
        const iGround = svc.indexOf('groundPrefillFields(merged');
        expect(iPref).toBeGreaterThan(0);
        expect(iGround).toBeGreaterThan(iPref);
    });

    it('🔴 反向守卫：工具产出必须全量留档（少了它闸口会误杀全部字段）', () => {
        expect(svc).toContain('toolTexts.push(text);');
        expect(svc).not.toMatch(/toolTexts\s*=\s*\[\]/); // 别在中途清空
    });

    it('宿主 lookup_metadata 把 facts 拼进回报文本，且排在简介之前', () => {
        expect(main).toContain('for (const f of d.facts) factLines.push(');
        expect(main).toContain('const factsBlock = factLines.length ?');
        // 顺序铁律：facts 在 synopsis 之前（否则被 extractToolSynopsis 吞进简介正文）
        const iFacts = main.indexOf('const headWithFacts =');
        const iSyn = main.indexOf('${PREFILL_SYNOPSIS_PREFIX}${decision.pick.synopsis}', iFacts);
        expect(iFacts).toBeGreaterThan(0);
        expect(iSyn).toBeGreaterThan(iFacts);
        expect(main).toContain('${headWithFacts}');
    });
});
