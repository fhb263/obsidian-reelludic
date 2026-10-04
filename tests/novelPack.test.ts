/**
 * `pure/novelPack` 单测（#419）—— TXT 合成 / 文件名 / 进度与失败回执。
 */
import { describe, expect, it } from 'vitest';
import {
    buildNovelTxt,
    chapterTaskSummary,
    failedChaptersText,
    novelBookFilename,
    novelMetaBlock,
    novelProgressText,
    novelElapsedText,
    novelProgressPercent,
    novelTocPreview,
    TOC_PREVIEW_LIMIT,
    TOC_PREVIEW_TAIL,
    novelTocBlock,
    type ChapterTask,
} from 'pure/novelPack';

const META = { title: '示例书名', author: '示例作者', sourceName: '示例源甲', intro: '这是一段简介。' };
const CH = [
    { no: 1, title: '第 1 章 风起', text: '正文一。' },
    { no: 2, title: '第 2 章 雨落', text: '正文二。' },
];

describe('novelPack · 文件名', () => {
    it('`书名 - 作者.ext`（基名与「库内找回」同一份口径）', () => {
        expect(novelBookFilename(META, 'txt')).toBe('示例书名 - 示例作者.txt');
        expect(novelBookFilename(META, 'epub')).toBe('示例书名 - 示例作者.epub');
    });

    it('缺作者只留书名；两者都缺 ⇒ 「未命名」（不留一个空扩展名文件）', () => {
        expect(novelBookFilename({ title: '示例书名' }, 'txt')).toBe('示例书名.txt');
        expect(novelBookFilename({ title: '' }, 'txt')).toBe('未命名.txt');
    });

    it('书名里的非法字符被净化（半角 `* ? : |` 换成 `_`；全角「：？」在多数平台合法 ⇒ 保留）', () => {
        expect(novelBookFilename({ title: '示例：卷一*上？', author: '甲' }, 'txt')).toBe('示例：卷一_上？ - 甲.txt');
        expect(novelBookFilename({ title: 'a/b:c*d?e"f<g>h|i', author: '甲' }, 'txt')).toBe('a_b_c_d_e_f_g_h_i - 甲.txt');
    });
});

describe('novelPack · TXT 合成', () => {
    it('头部 = 书名 + 作者/来源/简介；目录默认开（>1 章时）', () => {
        const t = buildNovelTxt(META, CH);
        expect(t.startsWith('示例书名\n作者：示例作者\n来源：示例源甲\n\n简介\n这是一段简介。')).toBe(true);
        expect(t).toContain('目录\n1. 第 1 章 风起\n2. 第 2 章 雨落');
        expect(t).toContain('第 1 章 风起\n\n正文一。');
        expect(t.endsWith('\n')).toBe(true);
    });

    it('`{ toc: false }` ⇒ 无目录（其余不变）', () => {
        const t = buildNovelTxt(META, CH, { toc: false });
        expect(t).not.toContain('目录');
        expect(t).toContain('第 2 章 雨落\n\n正文二。');
    });

    it('只有 1 章时不给目录（一节目录没有意义）', () => {
        expect(buildNovelTxt(META, [CH[0]])).not.toContain('目录');
    });

    it('🔴 空正文的章**整章不写**（那章已在 UI 报过失败，⛔ 别在成品里留个空标题让用户以为书本来就这样）', () => {
        const t = buildNovelTxt(META, [CH[0], { no: 2, title: '第 2 章 雨落', text: '   ' }, { no: 3, title: '第 3 章 云涌', text: '正文三。' }]);
        expect(t).not.toContain('第 2 章 雨落');
        expect(t).toContain('第 3 章 云涌');
        expect(t).toContain('目录\n1. 第 1 章 风起\n3. 第 3 章 云涌'); // 目录也只列写进去的章
    });

    it('标题缺省 ⇒ 「未命名」（用户至少能看到有个文件）', () => {
        expect(buildNovelTxt({ title: '' }, [CH[0]])).toContain('未命名');
    });

    it('元信息全空 ⇒ 不留空块（头就是光秃秃的书名）', () => {
        expect(novelMetaBlock({ title: 'x' })).toBe('');
        expect(buildNovelTxt({ title: '示例' }, [CH[0]])).toBe('示例\n\n\n第 1 章 风起\n\n正文一。\n');
    });

    it('`novelTocBlock` 一行一章', () => {
        expect(novelTocBlock(CH)).toBe('目录\n1. 第 1 章 风起\n2. 第 2 章 雨落');
    });
});

describe('novelPack · 进度与失败回执', () => {
    const tasks: ChapterTask[] = [
        { no: 1, title: 'a', url: 'u1', state: 'done' },
        { no: 2, title: 'b', url: 'u2', state: 'failed' },
        { no: 3, title: 'c', url: 'u3', state: 'pending' },
        { no: 4, title: 'd', url: 'u4', state: 'failed' },
    ];

    it('进度文案三态计数', () => {
        expect(chapterTaskSummary(tasks)).toEqual({ done: 1, failed: 2, pending: 1, total: 4 });
        expect(chapterTaskSummary([])).toEqual({ done: 0, failed: 0, pending: 0, total: 0 });
    });

    it('`novelProgressText` = `N / M 章`（负数与小数列都被夹住）', () => {
        expect(novelProgressText(128, 1234)).toBe('128 / 1234 章');
        expect(novelProgressText(-3, 10.9)).toBe('0 / 10 章');
    });

    it('🔴 #429 `novelProgressPercent`：真实进度 = **已处理（成功 + 失败）/ 总数**，⛔ 只算成功会永远停在 99%', () => {
        expect(novelProgressPercent(0, 0, 5)).toBe(0);
        expect(novelProgressPercent(2, 0, 5)).toBe(40);
        expect(novelProgressPercent(0, 2, 5)).toBe(40); // 失败也算「翻篇了」
        expect(novelProgressPercent(4, 1, 5)).toBe(100); // 全处理完 ⇒ 100，不会卡在 80%
        expect(novelProgressPercent(5, 0, 5)).toBe(100);
    });

    it('🔴 #429 `novelProgressPercent` 的边界：`total` 未知 / 为 0 / 为负 ⇒ **0**（⛔ 不产出 `NaN%` / `Infinity%`）', () => {
        expect(novelProgressPercent(3, 0, 0)).toBe(0);
        expect(novelProgressPercent(3, 0, -2)).toBe(0);
        expect(novelProgressPercent(3, 0, Number.NaN)).toBe(0);
        expect(novelProgressPercent(Number.NaN, Number.NaN, 10)).toBe(0); // 分子坏掉也不许污染分母
        expect(novelProgressPercent(99, 99, 10)).toBe(100); // 夹住上限
    });

    it('🔴 #429 `novelElapsedText`：一律**秒 + 两位小数**（用户样例就是 `68.96 s`，⚠️ 它 > 60 ⇒ ⛔ 不许自动进位成分）', () => {
        expect(novelElapsedText(68_960)).toBe('68.96 s');
        // ⚠️ 用 68.956 而不是 68.955 验「进一位」：`68.955` 在 IEEE754 里是**略小于** 68.955 的那个数
        //    ⇒ `toFixed(2)` 会给出 `68.95`。这不是 bug，是浮点的既有行为 —— ⛔ 别写一个自己会飘的期望值。
        expect(novelElapsedText(68_956)).toBe('68.96 s');
        expect(novelElapsedText(1234)).toBe('1.23 s');
        expect(novelElapsedText(120_000)).toBe('120.00 s');
    });

    it('🔴 #429 `novelElapsedText` 的边界：0 / 负数 / 非数 ⇒ `0.00 s`（⛔ 回执里不许出现 `NaN s`）', () => {
        expect(novelElapsedText(0)).toBe('0.00 s');
        expect(novelElapsedText(-500)).toBe('0.00 s');
        expect(novelElapsedText(Number.NaN)).toBe('0.00 s');
    });

    it('🔴 #431 `novelTocPreview`：超出 10 章 ⇒ **前 10 章 + `....`**（长篇 2000+ 章全塞进条目没人看，还会把笔记挂爆）', () => {
        const many = Array.from({ length: 1234 }, (_, i) => `第 ${i + 1} 章`);
        const out = novelTocPreview(many).split('\n');
        expect(out.length).toBe(TOC_PREVIEW_LIMIT + 1);
        expect(out[0]).toBe('第 1 章');
        expect(out[9]).toBe('第 10 章');
        expect(out[10]).toBe('....');
        expect(novelTocPreview(many)).not.toContain('第 11 章');
    });

    it('🔴 #431 截断标记是**四个半角点**（用户给的写法就是 `....`；⛔ 别顺手改成 `…` 或三点）', () => {
        expect(TOC_PREVIEW_TAIL).toBe('....');
    });

    it('⚠️ #431 **恰好 10 章 / 10 章以内不补尾巴**（补了会让人以为「后面还有，只是没显示」）', () => {
        expect(novelTocPreview(['第 1 章', '第 2 章'])).toBe('第 1 章\n第 2 章');
        const ten = Array.from({ length: TOC_PREVIEW_LIMIT }, (_, i) => `第 ${i + 1} 章`);
        expect(novelTocPreview(ten)).not.toContain('....');
        expect(novelTocPreview(ten).split('\n').length).toBe(TOC_PREVIEW_LIMIT);
        // 第 11 章才补
        expect(novelTocPreview([...ten, '第 11 章'])).toContain('....');
    });

    it('🔴 #431 空清单 ⇒ 空串（⛔ 不写一个只有 `....` 的怪目录）', () => {
        expect(novelTocPreview([])).toBe('');
    });

    it('失败回执列前几章章号（⛔ 不刷屏），全成功回空串', () => {
        expect(failedChaptersText(tasks)).toBe('有 2 章没抓到：第 2 章、第 4 章。可在源站直接看这几章，或换一个书源重试。');
        expect(failedChaptersText(tasks, 1)).toContain('有 2 章没抓到：第 2 章 等 2 章');
        expect(failedChaptersText([tasks[0]])).toBe('');
    });
});
