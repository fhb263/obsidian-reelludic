/**
 * AI 预填的**简介相关性闸口**（用户 m14816：「这个AI预填搜索的简介完全不相干都填进来了」）。
 *
 * 守的是什么：`decideSynopsis` 必须**只**放出标题对得上的那条简介，
 * 并且装配层（`main.ts` 的 `runPrefillTool`）真的用了它、而不是退回「第一个带简介的命中」。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decideSynopsis, normalizeForMatch, textMentionsTitle, titleTierOf } from 'pure/prefillRelevance';

const root = join(__dirname, '..');

/** 造一条搜索结果：`describeSearchResult` 认 `title` / `year` / `summary` */
function hit(title: string, summary?: string, year?: number): Record<string, unknown> {
    const o: Record<string, unknown> = { title };
    if (summary !== undefined) o.summary = summary;
    if (year !== undefined) o.year = year;
    return o;
}

describe('normalizeForMatch / titleTierOf', () => {
    it('去空白与标点、全角折半角后判同（同一部作品的不同写法）', () => {
        expect(normalizeForMatch('七里香 (Live)')).toBe('七里香live');
        expect(normalizeForMatch('ＳＰＹ×ＦＡＭＩＬＹ')).toBe('spyfamily');
        expect(titleTierOf('七里香 (Live)', '七里香')).toBe(2);
        expect(titleTierOf('名侦探柯南', '柯南')).toBe(2);
        expect(titleTierOf('七里香', '七里香')).toBe(3);
    });

    it('不同名一律 0（⛔ 别把「勉强相关」当 2）', () => {
        expect(titleTierOf('稻香', '七里香')).toBe(0);
        expect(titleTierOf('', '七里香')).toBe(0);
        expect(titleTierOf('七里香', '')).toBe(0);
    });

    it('极短标题不做包含判断（`火` 会被任何标题包含住）', () => {
        expect(titleTierOf('火山', '火')).toBe(0);
        expect(titleTierOf('火', '火山')).toBe(0);
    });
});

describe('decideSynopsis · 相关性闸口本体', () => {
    it('🔴 不相干的命中即便带简介也不许被采用（缺陷本体回归）', () => {
        const hits = [hit('七里香 (王俊凯 MV版)', '这是一段王俊凯的采访稿，跟作品无关。'), hit('稻香', '稻香的简介。')];
        const d = decideSynopsis(hits, { title: '七里香' });
        // 「七里香 (王俊凯 MV版)」归一后包含「七里香」⇒ 档位 2，它是同名的另一种版本，允许采用
        expect(d.pick?.synopsis).toContain('王俊凯');
        // 但「稻香」绝不能进来
        const d2 = decideSynopsis([hit('稻香', '稻香的简介。')], { title: '七里香' });
        expect(d2.pick).toBeNull();
        expect(d2.total).toBe(1);
        expect(d2.sameName).toBe(0);
    });

    it('同档命中里有简介的才进入候选；同名但都没简介 ⇒ pick 为 null 且 sameNameNoSynopsis 计数', () => {
        const d = decideSynopsis([hit('七里香', undefined), hit('七里香', '   ')], { title: '七里香' });
        expect(d.pick).toBeNull();
        expect(d.sameName).toBe(2);
        expect(d.sameNameNoSynopsis).toBe(2);

        const d2 = decideSynopsis([hit('七里香', undefined), hit('七里香', '真的简介')], { title: '七里香' });
        expect(d2.pick?.synopsis).toBe('真的简介');
        expect(d2.sameNameNoSynopsis).toBe(1);
    });

    it('全等优先于包含（同名精确条目打败「XX 版」）', () => {
        const d = decideSynopsis([hit('七里香 (Live)', 'live 版'), hit('七里香', '原版')], { title: '七里香' });
        expect(d.pick?.synopsis).toBe('原版');
        expect(d.pick?.title).toBe('七里香');
    });

    it('同档里年份更近的优先（翻拍/再版靠年份择近，但年份不同不否决）', () => {
        const d = decideSynopsis([hit('七里香', '2009 版', 2009), hit('七里香', '2004 版', 2004)], {
            title: '七里香',
            year: 2004,
        });
        expect(d.pick?.synopsis).toBe('2004 版');
        // 查询年没有命中任何一条时也不许丢：距离并列 ⇒ 取靠前的
        const d2 = decideSynopsis([hit('七里香', 'A', 1990), hit('七里香', 'B', 2020)], { title: '七里香' });
        expect(d2.pick?.synopsis).toBe('A');
    });

    it('作者只用来择优（同名不同作靠作者区分）', () => {
        // `describeSearchResult` 的 `sub` 来自各源自己的字段名，这里用书籍形状：
        // 顶层有 `author` 键 ⇒ 走 `bookView` ⇒ `sub = str(o.author)`。
        const d = decideSynopsis(
            [
                { title: '七里香', summary: '不是这位的', author: '某合唱团' },
                { title: '七里香', summary: '周杰伦的那首', author: '周杰伦' },
            ],
            { title: '七里香', author: '周杰伦' },
        );
        expect(d.pick?.synopsis).toBe('周杰伦的那首');
    });

    it('空输入 / 非数组 / 脏值都不抛', () => {
        expect(decideSynopsis([], { title: '七里香' })).toEqual({
            pick: null,
            sameName: 0,
            sameNameNoSynopsis: 0,
            total: 0,
        });
        expect(decideSynopsis(null as unknown as unknown[], { title: '七里香' }).pick).toBeNull();
        expect(decideSynopsis([null, 42, 'x'] as unknown[], { title: '七里香' }).pick).toBeNull();
    });

    it('同输入同输出（择优是全序，不依赖 sort 的稳定性）', () => {
        const hits = [hit('七里香', 'A', 2004), hit('七里香', 'B', 2004), hit('七里香', 'C', 2004)];
        const a = decideSynopsis(hits, { title: '七里香', year: 2004 });
        const b = decideSynopsis(hits, { title: '七里香', year: 2004 });
        expect(a.pick?.synopsis).toBe('A');
        expect(b.pick?.synopsis).toBe('A');
    });
});

describe('textMentionsTitle（fetch_page 的页面自证）', () => {
    it('页面正文里出现标题 ⇒ true；不出现 ⇒ false', () => {
        expect(textMentionsTitle('这里是《七里香》的条目页', '七里香')).toBe(true);
        expect(textMentionsTitle('这是一个搜索导航页', '七里香')).toBe(false);
    });

    it('极短标题不认（避免假阳性）；空值返 false', () => {
        expect(textMentionsTitle('火山爆发', '火')).toBe(false);
        expect(textMentionsTitle('', '七里香')).toBe(false);
        expect(textMentionsTitle('七里香', '')).toBe(false);
    });
});

describe('装配：main.ts 的 runPrefillTool 必须走闸口', () => {
    const src = readFileSync(join(root, 'main.ts'), 'utf8');

    it('🔴 反向守卫：⛔ 不许回潮成「第一个带简介的命中」', () => {
        expect(src).not.toContain('hits.find((h) => (synopsisOf(h)');
        expect(src).toContain('decideSynopsis(hits, { title })');
    });

    it('lookup_metadata 分支：没通过闸口时必须给出原因文案', () => {
        expect(src).toContain('decision.sameNameNoSynopsis');
        expect(src).toContain('decision.total');
        expect(src).toContain('不要拿别的作品的简介凑数');
    });

    it('fetch_page 分支：页面里没出现标题就不附简介', () => {
        expect(src).toContain('const wantTitle = str(\'title\');');
        expect(src).toContain('textMentionsTitle(body, wantTitle)');
        expect(src).toContain('它很可能不是这部作品的条目页');
    });

    it('fetch_page 的工具定义把 title 暴露给模型（可选，但强烈建议）', () => {
        const tool = readFileSync(join(root, 'src/pure/aiPrefill.ts'), 'utf8');
        expect(tool).toContain('核对页面里是否真的出现了这个标题');
        expect(tool).toContain("required: ['url']");
    });
});
