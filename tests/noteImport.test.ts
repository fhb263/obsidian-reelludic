// `pure/noteImport` 单测：反向导入扫描器的三道闸 + id 写回。
//
// 🔴 这些断言锁的是**判据本身**，不是实现细节。判据一漂，用户就会一键导入 140 条垃圾
//    （见 noteImport.ts 顶部关于 `musicCN` / 豆瓣模板的实测记录）。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    parseFrontmatterMap,
    posterFromBanner,
    scanImportableNotes,
    writeIdIntoNote,
    type NoteImportScanInput,
} from 'pure/noteImport';
import type { MediaEntry } from 'data/types';

function entry(over: Partial<MediaEntry>): MediaEntry {
    return {
        id: 'e_existing',
        type: 'movie',
        title: '既有条目',
        status: 'want',
        rating: 0,
        genres: [],
        cast: [],
        notePath: '媒体库/笔记/movie/既有条目.md',
        ...over,
    } as MediaEntry;
}

function note(path: string, fm: string): { path: string; text: string } {
    return { path, text: `---\n${fm}\n---\n\n正文\n` };
}

function scan(files: { path: string; text: string }[], entries: MediaEntry[] = []): ReturnType<typeof scanImportableNotes> {
    const input: NoteImportScanInput = { files, entries, notesDir: '媒体库/笔记' };
    return scanImportableNotes(input);
}

describe('parseFrontmatterMap', () => {
    it('只按第一个冒号切分（值里的 URL 不会被截断）', () => {
        const m = parseFrontmatterMap('---\nbanner: "https://a.com/b.jpg"\n---\n正文');
        expect(m.banner).toBe('"https://a.com/b.jpg"');
    });

    it('没有 frontmatter 返回空表', () => {
        expect(parseFrontmatterMap('# 普通笔记\n内容')).toEqual({});
    });

    it('CRLF 文件也能解析', () => {
        expect(parseFrontmatterMap('---\r\ntype: movie\r\n---\r\n正文').type).toBe('movie');
    });
});

describe('scanImportableNotes · 三道闸', () => {
    it('闸一：非六种合法 type 一律跳过（挡掉 musicCN 这类自定义 type）', () => {
        const r = scan([note('媒体库/笔记/music/x.md', 'type: musicCN\ntitle: "七里香"')]);
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped[0].reason).toContain('musicCN');
    });

    it('没有 type 的普通笔记不报跳过（项目文档本来就该被静默忽略）', () => {
        const r = scan([{ path: '待办.md', text: '# 待办\n- 做事\n' }]);
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped).toHaveLength(0);
    });

    it('闸二：标题是 {{title}} 占位符 ⇒ 跳过（豆瓣模板）', () => {
        const r = scan([note('4-Archive/Settings/Douban/图书模板.md', 'title: "{{title}}"\ntype: book\nbanner: "{{image}}"')]);
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped[0].reason).toContain('占位符');
    });

    it('闸二：没有标题 ⇒ 跳过', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie')]);
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped[0].reason).toContain('没有标题');
    });

    it('闸三 a：id 已在 catalog ⇒ 静默跳过（不算可选，也不报错）', () => {
        const r = scan(
            [note('媒体库/笔记/movie/既有条目.md', 'id: "e_existing"\ntype: movie\ntitle: "既有条目"')],
            [entry({})],
        );
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped).toHaveLength(0);
    });

    it('闸三 b：路径已被别的条目占用 ⇒ 跳过（同标题脏数据场景）', () => {
        const r = scan(
            [note('媒体库/笔记/movie/既有条目.md', 'type: movie\ntitle: "既有条目"')],
            [entry({})],
        );
        expect(r.candidates).toHaveLength(0);
        expect(r.skipped[0].reason).toContain('占用');
    });

    it('合规的手写笔记 ⇒ 进候选，字段按白名单读出来', () => {
        const r = scan([
            note(
                '媒体库/笔记/movie/黑客帝国.md',
                [
                    'type: movie',
                    'title: "黑客帝国"',
                    'status: watched',
                    'rating: 4.5',
                    'year: 1999',
                    'genres: [科幻, 动作]',
                    'cast: ["基努·里维斯"]',
                    'duration_min: 136',
                    'series: "黑客帝国系列"',
                    'series_index: 1',
                    'banner: "媒体库/封面/黑客帝国.jpg"',
                ].join('\n'),
            ),
        ]);
        expect(r.candidates).toHaveLength(1);
        const c = r.candidates[0];
        expect(c.title).toBe('黑客帝国');
        expect(c.type).toBe('movie');
        expect(c.draft.year).toBe(1999);
        expect(c.draft.genres).toEqual(['科幻', '动作']);
        expect(c.draft.cast).toEqual(['基努·里维斯']);
        expect(c.draft.durationMin).toBe(136);
        expect(c.draft.series).toBe('黑客帝国系列');
        expect(c.draft.seriesIndex).toBe(1);
        expect(c.draft.status).toBe('watched');
        expect(c.warnings).toBeUndefined();
        expect(c.draft.rating).toBe(4.5);
    });

    it('值里的占位符不会被当成真数据（banner: "{{image}}" ⇒ undefined）', () => {
        const r = scan([note('媒体库/笔记/book/x.md', 'type: book\ntitle: "真书"\nbanner: "{{image}}"')]);
        expect(r.candidates[0].draft.poster).toBeUndefined();
    });

    it('数组里混着占位符时只丢那一项', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie\ntitle: "片"\ngenres: [科幻, "{{g}}"]')]);
        expect(r.candidates[0].draft.genres).toEqual(['科幻']);
    });
});

describe('🔴 status 中文标签与降级提示（用户 2026-11-08 裁定「降级提示」）', () => {
    it('认中文标签：movie 的「已看」⇒ watched', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie\ntitle: "片"\nstatus: 已看')]);
        expect(r.candidates[0].draft.status).toBe('watched');
        expect(r.candidates[0].warnings).toBeUndefined();
    });

    it('标签按类型走：book 的「已读」与 game 的「通关」都 ⇒ watched', () => {
        const rb = scan([note('媒体库/笔记/book/b.md', 'type: book\ntitle: "书"\nstatus: 已读')]);
        expect(rb.candidates[0].draft.status).toBe('watched');
        const rg = scan([note('媒体库/笔记/game/g.md', 'type: game\ntitle: "游戏"\nstatus: 通关')]);
        expect(rg.candidates[0].draft.status).toBe('watched');
    });

    it('认枚举值：watching 原样通过', () => {
        const r = scan([note('媒体库/笔记/tv/t.md', 'type: tv\ntitle: "剧"\nstatus: watching')]);
        expect(r.candidates[0].draft.status).toBe('watching');
    });

    it('🔴 非法值不阻断导入，但必须留下降级提示（不能静默变「想看」）', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie\ntitle: "片"\nstatus: done')]);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0].draft.status).toBeUndefined();
        expect(r.candidates[0].warnings).toHaveLength(1);
        expect(r.candidates[0].warnings?.[0]).toContain('done');
        expect(r.candidates[0].warnings?.[0]).toContain('想看');
    });

    it('book 的降级提示用的是本书类型的兜底文案「想读」', () => {
        const r = scan([note('媒体库/笔记/book/b.md', 'type: book\ntitle: "书"\nstatus: 瞎写')]);
        expect(r.candidates[0].warnings?.[0]).toContain('想读');
    });

    it('完全没有 status ⇒ 不写键也不打警告', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie\ntitle: "片"')]);
        expect(r.candidates[0].draft.status).toBeUndefined();
        expect(r.candidates[0].warnings).toBeUndefined();
    });

    it('状态是模板占位符 {{status}} ⇒ 当没填，不误报降级', () => {
        const r = scan([note('媒体库/笔记/movie/x.md', 'type: movie\ntitle: "片"\nstatus: "{{status}}"')]);
        expect(r.candidates[0].draft.status).toBeUndefined();
        expect(r.candidates[0].warnings).toBeUndefined();
    });
});

describe('posterFromBanner', () => {
    it('URL 原样返回', () => {
        expect(posterFromBanner('https://a.com/b.jpg', '媒体库')).toBe('https://a.com/b.jpg');
    });

    it('库内路径剥掉库目录前缀', () => {
        expect(posterFromBanner('媒体库/封面/x.jpg', '媒体库')).toBe('封面/x.jpg');
    });

    it('前缀对不上就原样返回（不猜）', () => {
        expect(posterFromBanner('别的库/封面/x.jpg', '媒体库')).toBe('别的库/封面/x.jpg');
    });

    // 🔴 2026-11-08：这个函数曾经**写对了却没人调用** —— banner 原样落进 poster，
    //    `resolvePosterUrl` 再拼一次 libraryDir ⇒ `媒体库/媒体库/封面/x.jpg` ⇒ 封面全空。
    //    上面三条断言当时全绿，因为它们只测函数本身。⇒ 真正要锁的是**调用点存在**。
    it('🔴 落库路径真的调用了它（main.ts 不许把 banner 原样塞进 poster）', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(here, '..', 'main.ts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
        expect(code).toContain('posterFromBanner(');
        // ⛔ 反向守卫：直接写 `poster: cand.draft.poster` 就是绕过归一化的老写法
        expect(code).not.toMatch(/poster:\s*cand\.draft\.poster\b/);
    });
});

describe('writeIdIntoNote', () => {
    it('已有 id 行 ⇒ 原地替换，不产生重复键', () => {
        const out = writeIdIntoNote('---\nid: "old"\ntype: movie\ntitle: "片"\n---\n正文', 'e_new', 'movie', '片');
        expect(out).toContain('id: "e_new"');
        expect(out).not.toContain('id: "old"');
        expect(out.match(/^id:/gm)).toHaveLength(1);
    });

    it('没有 id 行 ⇒ 插在 --- 之后第一行', () => {
        const out = writeIdIntoNote('---\ntype: movie\ntitle: "片"\n---\n正文', 'e_new', 'movie', '片');
        const lines = out.split('\n');
        expect(lines[0]).toBe('---');
        expect(lines[1]).toBe('id: "e_new"');
    });

    it('完全没有 frontmatter ⇒ 新建一段（含 type/title 结构性字段）', () => {
        const out = writeIdIntoNote('# 正文开头\n内容', 'e_new', 'book', '某书');
        expect(out.startsWith('---\nid: "e_new"\ntype: book\ntitle: "某书"\n---\n')).toBe(true);
        expect(out).toContain('# 正文开头');
    });

    it('CRLF 文件写回仍是 CRLF（不把整篇换行刷成另一种）', () => {
        const out = writeIdIntoNote('---\r\ntype: movie\r\ntitle: "片"\r\n---\r\n正文', 'e_new', 'movie', '片');
        expect(out).toContain('\r\n');
        expect(out.split('\r\n')[1]).toBe('id: "e_new"');
        // 不能出现混合换行
        expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    });

    it('--- 未闭合的坏文件 ⇒ 原样返回，不硬塞', () => {
        const broken = '---\ntype: movie\ntitle: "片"\n正文';
        expect(writeIdIntoNote(broken, 'e_new', 'movie', '片')).toBe(broken);
    });
});
