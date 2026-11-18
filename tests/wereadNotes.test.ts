/**
 * ②-4 微信读书划线与高亮（`pure/wereadNotes`）单测。
 *
 * 🔴 2026-11-12 实测：本项目测试账号的划线 / 想法两个端点都返回空（`bookmarklist` 回 `{}`、
 *    `review/list?listType=11` 回 `totalCount: 0`），**拿不到真实样本**。所以这里的样本是按
 *    参考插件 `zhaohongxuan/obsidian-weread-plugin` 的 `models.ts` 字段签名**手写构造**的 ——
 *    钉的是「本仓怎么解释这些字段」，不是「微信读书明天还这么返回」。
 */
import { describe, expect, it } from 'vitest';
import {
    buildWereadBookmarkUrl,
    buildWereadChaptersBody,
    buildWereadReviewUrl,
    mergeWereadNotes,
    parseWereadBookmarks,
    parseWereadReviews,
    renderWereadNotes,
    WEREAD_NOTES_SECTION,
    type WereadNote,
} from 'pure/wereadNotes';

const note = (over: Partial<WereadNote> = {}): WereadNote => ({
    chapterUid: 1,
    chapterName: '第一章',
    range: '0-10',
    text: '划线原文',
    createTime: 1000,
    ...over,
});

describe('wereadNotes · URL 与常量', () => {
    it('区名就是用户指定的「同步划线与高亮」，⛔ 不是「高亮」', () => {
        expect(WEREAD_NOTES_SECTION).toBe('同步划线与高亮');
        expect(WEREAD_NOTES_SECTION).not.toBe('高亮');
    });

    it('划线 URL 带 bookId', () => {
        expect(buildWereadBookmarkUrl('695233')).toBe(
            'https://weread.qq.com/web/book/bookmarklist?bookId=695233',
        );
    });

    it('想法 URL 必须带 listType=11 与 mine=1（少了 mine 会拿到全站热门）', () => {
        const u = buildWereadReviewUrl('695233');
        expect(u).toContain('bookId=695233');
        expect(u).toContain('listType=11');
        expect(u).toContain('mine=1');
        expect(u).toContain('synckey=0');
    });

    it('chapterInfos body 是 bookIds 数组', () => {
        expect(JSON.parse(buildWereadChaptersBody('695233'))).toEqual({ bookIds: ['695233'] });
    });

    it('bookId 里的特殊字符被编码（不拼坏 URL）', () => {
        expect(buildWereadBookmarkUrl('a b')).toContain('bookId=a%20b');
    });
});

describe('wereadNotes · 解析划线', () => {
    it('正常响应：markText 是正文，空 markText 丢弃', () => {
        const out = parseWereadBookmarks({
            updated: [
                { chapterUid: 2, chapterName: '第二章', markText: '一句划线', range: '10-20', createTime: 5 },
                { chapterUid: 2, chapterName: '第二章', markText: '   ', range: '30-40', createTime: 6 },
            ],
        });
        expect(out.error).toBeUndefined();
        expect(out.notes).toHaveLength(1);
        expect(out.notes[0]).toMatchObject({ chapterUid: 2, text: '一句划线', range: '10-20' });
    });

    it('实测无数据时回 {} —— 是空列表**不是错误**', () => {
        const out = parseWereadBookmarks({});
        expect(out.error).toBeUndefined();
        expect(out.notes).toEqual([]);
    });

    it('-2010 报 Cookie 无效（⛔ 不能当成没有划线）', () => {
        const out = parseWereadBookmarks({ errCode: -2010, errMsg: '用户不存在' });
        expect(out.error).toContain('Cookie 无效');
        expect(out.notes).toEqual([]);
    });

    it('-2012 报登录超时并指路「测试连接」', () => {
        const out = parseWereadBookmarks({ errCode: -2012, errMsg: '登录超时' });
        expect(out.error).toContain('登录超时');
        expect(out.error).toContain('测试连接');
    });

    it('updated 不是数组 = 接口变了，必须报错而不是静默空', () => {
        const out = parseWereadBookmarks({ updated: { a: 1 } });
        expect(out.error).toContain('格式异常');
    });

    it('非对象 / null 回解析失败', () => {
        expect(parseWereadBookmarks(null).error).toContain('无法解析');
        expect(parseWereadBookmarks('x').error).toContain('无法解析');
    });
});

describe('wereadNotes · 解析想法', () => {
    it('abstract 是划线原文，content 是我的想法', () => {
        const out = parseWereadReviews({
            reviews: [
                {
                    reviewId: 'r1',
                    review: {
                        abstract: '被划的那句',
                        content: '我写的想法',
                        chapterUid: 3,
                        chapterName: '第三章',
                        range: '100-110',
                        createTime: 7,
                    },
                },
            ],
        });
        expect(out.error).toBeUndefined();
        expect(out.notes[0]).toMatchObject({
            chapterUid: 3,
            chapterName: '第三章',
            text: '被划的那句',
            note: '我写的想法',
            range: '100-110',
        });
    });

    it('只有 content（纯想法、没划线）也要收', () => {
        const out = parseWereadReviews({
            reviews: [{ review: { abstract: '', content: '只有想法', chapterUid: 4, range: '0-1' } }],
        });
        expect(out.notes).toHaveLength(1);
        expect(out.notes[0].text).toBe('');
        expect(out.notes[0].note).toBe('只有想法');
    });

    it('两者都空则丢弃', () => {
        const out = parseWereadReviews({ reviews: [{ review: { abstract: ' ', content: '' } }] });
        expect(out.notes).toEqual([]);
    });

    it('缺 chapterName 时回退 chapterTitle', () => {
        const out = parseWereadReviews({
            reviews: [{ review: { abstract: 'x', chapterTitle: '标题回退', chapterUid: 9, range: '1-2' } }],
        });
        expect(out.notes[0].chapterName).toBe('标题回退');
    });

    it('totalCount 为 0 / reviews 空数组 → 空列表无错误', () => {
        const out = parseWereadReviews({ totalCount: 0, reviews: [] });
        expect(out.error).toBeUndefined();
        expect(out.notes).toEqual([]);
    });

    it('错误响应优先于 reviews 字段', () => {
        const out = parseWereadReviews({ errCode: -2012, errMsg: '登录超时', reviews: [] });
        expect(out.error).toContain('登录超时');
    });
});

describe('wereadNotes · 合并去重', () => {
    it('同 chapterUid + range 的划线与其上的想法合成一条', () => {
        const h = [note({ chapterUid: 1, range: '10-20', text: '原文', note: undefined })];
        const r = [note({ chapterUid: 1, range: '10-20', text: '', note: '想法' })];
        const out = mergeWereadNotes(h, r);
        expect(out).toHaveLength(1);
        expect(out[0].text).toBe('原文');
        expect(out[0].note).toBe('想法');
    });

    it('同一句话被划两次（不同 range）是两条真实记录，⛔ 别按文本合并', () => {
        const out = mergeWereadNotes(
            [note({ range: '1-2', text: '同一句' }), note({ range: '90-91', text: '同一句' })],
            [],
        );
        expect(out).toHaveLength(2);
    });

    it('排序：章号升序 → 同章按 range 起点升序', () => {
        const out = mergeWereadNotes(
            [
                note({ chapterUid: 2, range: '5-9', text: 'b' }),
                note({ chapterUid: 1, range: '300-350', text: 'a2' }),
                note({ chapterUid: 1, range: '20-30', text: 'a1' }),
            ],
            [],
        );
        expect(out.map((n) => n.text)).toEqual(['a1', 'a2', 'b']);
    });

    it('range 解析不出数字时落章尾（不抛错、不排到最前）', () => {
        const out = mergeWereadNotes(
            [note({ range: 'x', text: 'bad' }), note({ range: '10-20', text: 'good' })],
            [],
        );
        expect(out.map((n) => n.text)).toEqual(['good', 'bad']);
    });

    it('合并时不覆盖已有的非空字段（划线先到 / 想法先到都成立）', () => {
        const out = mergeWereadNotes(
            [note({ chapterUid: 1, range: '1-2', text: '', note: '想法先' })],
            [note({ chapterUid: 1, range: '1-2', text: '原文后到' })],
        );
        expect(out[0].text).toBe('原文后到');
        expect(out[0].note).toBe('想法先');
    });
});

describe('wereadNotes · 渲染', () => {
    it('每条内容都以 > 开头（划线原文里的 ## 不能伪造出二级标题）', () => {
        const md = renderWereadNotes([note({ text: '## 我是一级标题' })], { syncedAt: 0 });
        const body = md.split('\n').filter((l) => l.includes('## 我是一级标题'));
        expect(body).toHaveLength(1);
        expect(body[0].startsWith('> ')).toBe(true);
    });

    it('章名用 ###，⛔ 不用 ##（否则截断区段）', () => {
        const md = renderWereadNotes([note({ chapterName: '第七章' })], { syncedAt: 0 });
        expect(md).toContain('### 第七章');
        expect(md).not.toMatch(/^## 第七章$/m);
    });

    it('想法行带 💭 且与划线之间有 > 空行', () => {
        const md = renderWereadNotes([note({ text: '原文', note: '想法' })], { syncedAt: 0 });
        expect(md).toContain('> 💭 想法');
        expect(md).toContain('>\n> 💭 想法');
    });

    it('多行划线逐行加 >', () => {
        const md = renderWereadNotes([note({ text: '第一行\n第二行' })], { syncedAt: 0 });
        expect(md).toContain('> 第一行');
        expect(md).toContain('> 第二行');
    });

    it('首行说明含总条数与同步时间', () => {
        const md = renderWereadNotes([note()], { syncedAt: Date.UTC(2026, 10, 12, 10, 30) });
        expect(md.split('\n')[0]).toContain('共 1 条');
        expect(md.split('\n')[0]).toContain('由插件从微信读书同步');
    });

    it('超 max 截断时如实写「共 N 条，此处显示前 M 条」', () => {
        const many = Array.from({ length: 5 }, (_, i) => note({ range: `${i}-${i + 1}`, text: `t${i}` }));
        const md = renderWereadNotes(many, { syncedAt: 0, max: 2 });
        expect(md).toContain('共 5 条');
        expect(md).toContain('此处显示前 2 条');
        expect(md).toContain('t1');
        expect(md).not.toContain('t2');
    });

    it('空列表只留说明行（不崩、不留空区）', () => {
        const md = renderWereadNotes([], { syncedAt: 0 });
        expect(md.split('\n')[0]).toContain('共 0 条');
    });
});
