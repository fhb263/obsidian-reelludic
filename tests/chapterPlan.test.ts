/**
 * `pure/chapterPlan` 单测（P1-C 断点续传）—— 目录指纹 / 存档命名 / NDJSON 容错解析 / 复用已下章节。
 *
 * 🔴 本文件的价值集中在**容错**与**不串味**两处：
 *    · 存档是「进程随时可能被杀」的场景下的产物 ⇒ 半截行必须能扛住（不能一行坏掉丢整本）；
 *    · 存档命名必须把「同名不同源」「同源不同格式」分开 ⇒ 认错档 = 用户拿到一本错位的书。
 */
import { describe, expect, it } from 'vitest';
import {
    applyResume,
    chaptersFingerprint,
    parseResume,
    resumeChapterLine,
    resumeDir,
    resumeFileName,
    resumeMatches,
    resumeMetaLine,
    resumePath,
    RESUME_VERSION,
    type ResumeChapter,
    type ResumeMeta,
} from 'pure/chapterPlan';
import type { ChapterTask } from 'pure/novelPack';

const META: ResumeMeta = {
    v: RESUME_VERSION,
    kind: 'meta',
    sourceKey: 'https://example.com/',
    bookUrl: 'https://example.com/book/9/',
    title: '示例书名甲',
    author: '示例作者甲',
    format: 'txt',
    tocKey: 'abcd1234',
    updatedAt: '2026-09-29T10:00:00.000Z',
};

function task(no: number, state: ChapterTask['state'] = 'pending'): ChapterTask {
    return { no, title: `第 ${no} 章 目录名`, url: `https://example.com/ch/${no}.html`, state };
}

describe('chaptersFingerprint —— 目录指纹', () => {
    it('同一份目录两次同值（可作「有没有变」的判据）', () => {
        const items = [
            { no: 1, title: '第一章 风起' },
            { no: 2, title: '第二章 雨落' },
        ];
        expect(chaptersFingerprint(items)).toBe(chaptersFingerprint([...items]));
    });

    it('任一章名变了 ⇒ 指纹变（书源改版的检测点）', () => {
        const a = chaptersFingerprint([{ no: 1, title: '第一章 风起' }]);
        const b = chaptersFingerprint([{ no: 1, title: '第一章 风起（新）' }]);
        expect(a).not.toBe(b);
    });

    it('多一章 / 少一章 ⇒ 指纹变', () => {
        const base = [{ no: 1, title: '第一章' }];
        expect(chaptersFingerprint(base)).not.toBe(chaptersFingerprint([...base, { no: 2, title: '第二章' }]));
    });

    it('🔴 只吃 no + title：**url 变动不影响指纹** —— 站点换域 / 给链接加参数不该让用户白下一遍', () => {
        const a = [{ no: 1, title: '第一章', url: 'https://old.example.com/ch/1.html' }];
        const b = [{ no: 1, title: '第一章', url: 'https://new.example.com/read/?id=1' }];
        expect(chaptersFingerprint(a)).toBe(chaptersFingerprint(b));
    });

    it('空表 / 缺字段不炸，且两次同值（稳定 ⇒ 不会每次都被判成「目录变了」）', () => {
        expect(chaptersFingerprint([])).toBe(chaptersFingerprint([]));
        expect(chaptersFingerprint([{}, {}])).toBe(chaptersFingerprint([{}, {}]));
    });
});

describe('resumeFileName / resumePath —— 存档命名与位置', () => {
    it('文件名含书名 · 续传 · 格式 · 8 位哈希，扩展名 `.ndjson`', () => {
        const n = resumeFileName({ title: '示例书名甲', sourceKey: META.sourceKey, bookUrl: META.bookUrl, format: 'txt' });
        expect(n).toMatch(/^示例书名甲-续传-txt-[0-9a-f]{8}\.ndjson$/);
    });

    it('🔴 同名不同源 / 同源不同书 / 同书不同格式 ⇒ **各存各的**（认错档 = 拿到一本错位的书）', () => {
        const base = { title: '示例书名甲', sourceKey: META.sourceKey, bookUrl: META.bookUrl, format: 'txt' as const };
        const otherSource = resumeFileName({ ...base, sourceKey: 'https://other.example.com/' });
        const otherBook = resumeFileName({ ...base, bookUrl: 'https://example.com/book/10/' });
        const otherFormat = resumeFileName({ ...base, format: 'epub' });
        expect(otherSource).not.toBe(resumeFileName(base));
        expect(otherBook).not.toBe(resumeFileName(base));
        expect(otherFormat).not.toBe(resumeFileName(base));
    });

    it('书名里的文件名字符被净化（`/ : * ? " < > |`），空书名回落「未命名」', () => {
        const n = resumeFileName({ title: 'a/b:c*d?e"f<g>h|i', sourceKey: 's', bookUrl: 'b', format: 'txt' });
        expect(/[\\/:*?"<>|]/.test(n.replace(/\.ndjson$/, ''))).toBe(false);
        expect(resumeFileName({ title: '   ', sourceKey: 's', bookUrl: 'b', format: 'txt' })).toMatch(/^未命名-续传-txt-/);
    });

    it('存档在 `{libraryDir}/下载续传/`（尾斜杠 / 空 libraryDir 都归一）', () => {
        expect(resumeDir('媒体库')).toBe('媒体库/下载续传');
        expect(resumeDir('媒体库/')).toBe('媒体库/下载续传');
        expect(resumeDir('')).toBe('ReelLudic/下载续传');
        expect(resumePath('媒体库', 'x.ndjson')).toBe('媒体库/下载续传/x.ndjson');
    });

    it('🔴 存档**不在**「下载」目录下（那是成品的家；中间态混进去会被「库内找回同名书」扫成一本书）', () => {
        expect(resumePath('媒体库', 'x.ndjson').startsWith('媒体库/下载续传/')).toBe(true);
        expect(resumePath('媒体库', 'x.ndjson').includes('/下载/')).toBe(false);
    });
});

describe('resumeMetaLine / resumeChapterLine —— 序列化', () => {
    it('元信息行是**单行**（恰一个结尾换行）、kind 标记为 meta、版本由本模块盖章', () => {
        const line = resumeMetaLine({ ...META });
        expect(line.endsWith('\n')).toBe(true);
        expect(line.slice(0, -1).includes('\n')).toBe(false);
        const o = JSON.parse(line) as Record<string, unknown>;
        expect(o.kind).toBe('meta');
        expect(o.v).toBe(RESUME_VERSION);
    });

    it('章节行是单行、kind 标记为 chapter、字段原样带回', () => {
        const line = resumeChapterLine({ no: 3, title: '第三章', text: '正文三' });
        expect(line.slice(0, -1).includes('\n')).toBe(false);
        expect(JSON.parse(line)).toEqual({ kind: 'chapter', no: 3, title: '第三章', text: '正文三' });
    });

    it('写出去的能原样读回来（往返一致）', () => {
        const text = resumeMetaLine(META) + resumeChapterLine({ no: 1, title: '第一章', text: '正文一' });
        const p = parseResume(text);
        expect(p.meta).toEqual(META);
        expect(p.chapters).toEqual([{ no: 1, title: '第一章', text: '正文一' }]);
    });
});

describe('parseResume —— 容错解析（进程随时可能被杀，本函数必须扛得住）', () => {
    const head = resumeMetaLine(META);

    it('升序返回；输入乱序也升序', () => {
        const text = head + [3, 1, 2].map((no) => resumeChapterLine({ no, title: `第${no}章`, text: `正文${no}` })).join('');
        expect(parseResume(text).chapters.map((c) => c.no)).toEqual([1, 2, 3]);
    });

    it('🔴 同一个 `no` 出现两次 ⇒ **后写的赢**（续传重抓那一章只会再追加一行，不会回头改旧行）', () => {
        const text =
            head +
            resumeChapterLine({ no: 1, title: '旧', text: '旧正文' }) +
            resumeChapterLine({ no: 1, title: '新', text: '新正文' });
        expect(parseResume(text).chapters).toEqual([{ no: 1, title: '新', text: '新正文' }]);
    });

    it('🔴 半截行 / 坏 JSON / 缺 kind / 空行一律**逐行跳过**，前面的章照常返回（⛔ 不是整档丢掉）', () => {
        const text =
            head +
            resumeChapterLine({ no: 1, title: '第一章', text: '正文一' }) +
            '\n' +
            '{"kind":"chapter","no":2,"title":"半截' + // 被写坏的最后一行
            '\n' +
            'not json at all\n' +
            '{"no":3,"title":"没有 kind"}\n' +
            resumeChapterLine({ no: 4, title: '第四章', text: '正文四' }) +
            '\n';
        expect(parseResume(text).chapters.map((c) => c.no)).toEqual([1, 4]);
    });

    it('章节行的形状校验：no 非正整数 / no 不是数 / text 不是字符串 ⇒ 跳过', () => {
        const bad = [
            '{"kind":"chapter","no":0,"title":"零","text":"x"}',
            '{"kind":"chapter","no":-3,"title":"负","text":"x"}',
            '{"kind":"chapter","no":1.5,"title":"小数","text":"x"}',
            '{"kind":"chapter","no":"2","title":"串号","text":"x"}',
            '{"kind":"chapter","no":9,"title":"没正文"}',
        ].join('\n');
        expect(parseResume(head + bad).chapters).toEqual([]);
    });

    it('meta 缺失 / 版本不认识 / 缺站点键或书籍页 / 格式非法 ⇒ `meta` 为 null（当没有），但不抛', () => {
        expect(parseResume('').meta).toBeNull();
        expect(parseResume('{"kind":"meta","v":99}').meta).toBeNull();
        expect(parseResume(JSON.stringify({ ...META, sourceKey: '' }) + '\n').meta).toBeNull();
        expect(parseResume(JSON.stringify({ ...META, bookUrl: '' }) + '\n').meta).toBeNull();
        expect(parseResume(JSON.stringify({ ...META, format: 'pdf' }) + '\n').meta).toBeNull();
    });

    it('空文本 / 纯空白 → 空结果（不抛）', () => {
        expect(parseResume('')).toEqual({ meta: null, chapters: [] });
        expect(parseResume('\n\n  \n')).toEqual({ meta: null, chapters: [] });
    });
});

describe('resumeMatches —— 敢不敢复用', () => {
    const want = { sourceKey: META.sourceKey, bookUrl: META.bookUrl, format: META.format, tocKey: META.tocKey };

    it('四项全等才复用', () => {
        expect(resumeMatches(META, want)).toBe(true);
    });

    it('🔴 任一不同都**不复用**（尤其 tocKey —— 目录变了还硬拼 = 序号对不上正文）', () => {
        expect(resumeMatches(META, { ...want, sourceKey: 'https://x.example.com/' })).toBe(false);
        expect(resumeMatches(META, { ...want, bookUrl: 'https://example.com/book/10/' })).toBe(false);
        expect(resumeMatches(META, { ...want, format: 'epub' })).toBe(false);
        expect(resumeMatches(META, { ...want, tocKey: 'ffffffff' })).toBe(false);
    });

    it('没有档（meta 为 null）⇒ 不复用', () => {
        expect(resumeMatches(null, want)).toBe(false);
    });
});

describe('applyResume —— 把存档里的章并回任务表', () => {
    const saved: ResumeChapter[] = [
        { no: 1, title: '第一章 风起', text: '正文一' },
        { no: 2, title: '第二章 雨落', text: '正文二' },
    ];

    it('命中的章直接标 done 并带回正文与章名，未命中的保持原样', () => {
        const tasks = [task(1), task(2), task(3)];
        const r = applyResume(tasks, saved);
        expect(r.reused).toBe(2);
        expect(r.tasks[0]).toMatchObject({ no: 1, state: 'done', title: '第一章 风起', text: '正文一' });
        expect(r.tasks[2]).toMatchObject({ no: 3, state: 'pending' });
        expect(r.tasks[2].text).toBeUndefined();
    });

    it('存档里**没有**的章不受影响（用户换了章节区间时不会串味）', () => {
        const r = applyResume([task(7), task(8)], saved);
        expect(r.reused).toBe(0);
        expect(r.tasks.every((t) => t.state === 'pending')).toBe(true);
    });

    it('🔴 正文为空的存档章**不复用**（宁可重抓，也不给用户一个空章节）', () => {
        const r = applyResume([task(1)], [{ no: 1, title: '第一章', text: '   ' }]);
        expect(r.reused).toBe(0);
        expect(r.tasks[0].state).toBe('pending');
    });

    it('复用章会**清掉旧的失败原因**（它现在是成功的，留着会误导回执）', () => {
        const failed: ChapterTask = { no: 1, title: '第 1 章 目录名', url: 'u', state: 'failed', error: '已取消' };
        const r = applyResume([failed], saved);
        expect(r.tasks[0].state).toBe('done');
        expect(r.tasks[0].error).toBeUndefined();
    });

    it('纯函数：不改入参数组与入参任务', () => {
        const tasks = [task(1)];
        applyResume(tasks, saved);
        expect(tasks[0].state).toBe('pending');
    });
});
