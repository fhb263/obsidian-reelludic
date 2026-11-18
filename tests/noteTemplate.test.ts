// 「条目笔记模板」生成（pure/noteTemplate）单测。
//
// 🔴 这条测试的核心不是「字符串好不好看」，而是**模板列出来的键必须真的能被导入器读进去**：
//    写进去却不读 = 用户填了、看着像生效了、实际什么也没发生（#732 那两类 bug 的病根）。
//    ⇒ 这里用「反向抽取」把模板里的每个键捞出来，逐个断言它在 `noteImport` 的 draft 白名单里。

import { describe, expect, it } from 'vitest';
import { buildNoteTemplate, noteTemplatePath, NOTE_TEMPLATE_FILE } from 'pure/noteTemplate';
import { ENTRY_TYPES } from 'data/types';
import { scanImportableNotes } from 'pure/noteImport';

const CTX = { libraryDir: '媒体库', pluginVersion: '1.5.0' };

/** 把模板里某个 type 区块的 yaml 代码块捞出来（`### 电影（`type: movie`）` 之后第一个 ```yaml 块） */
function blockOf(md: string, type: string): string {
    const head = md.indexOf(`\`type: ${type}\``);
    expect(head, `模板里必须有 ${type} 的区块`).toBeGreaterThan(-1);
    const start = md.indexOf('```yaml', head);
    const end = md.indexOf('```', start + 7);
    expect(start, `${type} 区块必须有 yaml 代码块`).toBeGreaterThan(-1);
    // ⚠️ 必须 trim：代码块内容以换行开头，而 `parseFrontmatterMap` 的 `^---` 是**字符串开头锚定**
    //    （没有 multiline 标志）⇒ 前面多一个 `\n` 就整段解析不出 frontmatter。
    return md.slice(start + 7, end).trim();
}

/** 区块里的 frontmatter 键（只认行首 `key:`，注释行不算） */
function keysOf(block: string): string[] {
    return block
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l !== '---')
        .map((l) => l.slice(0, l.indexOf(':')))
        .filter((k) => k.length > 0);
}

describe('noteTemplatePath / 落盘位置', () => {
    it(`文件名固定为 ${NOTE_TEMPLATE_FILE}，且落在媒体库目录下（与「笔记/」同级）`, () => {
        expect(noteTemplatePath('媒体库')).toBe(`媒体库/${NOTE_TEMPLATE_FILE}`);
        // 🔴 关键：**不能**以 `/笔记/` 结尾 —— 扫描器只扫 `笔记/` 子树，落进去就会被当成条目
        expect(noteTemplatePath('媒体库')).not.toContain('/笔记/');
    });

    it('libraryDir 空 / 带斜杠 / 反斜杠都能归一', () => {
        expect(noteTemplatePath('')).toBe(`ReelLudic/${NOTE_TEMPLATE_FILE}`);
        expect(noteTemplatePath('/媒体库/')).toBe(`媒体库/${NOTE_TEMPLATE_FILE}`);
        expect(noteTemplatePath('媒体库\\封面\\')).toBe(`媒体库/封面/${NOTE_TEMPLATE_FILE}`);
    });
});

describe('buildNoteTemplate · 结构', () => {
    it('六个类型各一个区块，标题写类型所在子目录', () => {
        const md = buildNoteTemplate(CTX);
        for (const t of ENTRY_TYPES) {
            expect(md).toContain(`\`type: ${t}\``);
        }
        // 子目录必须与 pure/dirs.ENTRY_TYPE_DIRS 一致（tv → teleplay、anime → animation）
        expect(md).toContain('笔记/teleplay/');
        expect(md).toContain('笔记/animation/');
        expect(md).toContain('笔记/movie/');
    });

    it('书籍要写全三个子目录（文学 book / 网文 novel / 漫画 comic）', () => {
        const md = buildNoteTemplate(CTX);
        for (const d of ['笔记/book/', '笔记/novel/', '笔记/comic/']) expect(md).toContain(d);
    });

    it('每个区块都带 title 占位符（防模板被当条目导进去）', () => {
        const md = buildNoteTemplate(CTX);
        for (const t of ENTRY_TYPES) {
            const block = blockOf(md, t);
            expect(block, `${t} 区块必须写 type`).toContain(`type: ${t}`);
            expect(block, `${t} 区块必须有 title 占位符`).toContain('title: "{{标题}}"');
        }
    });

    it('🔴 不出现「行尾注释」——解析器只跳过 # 开头的行，行尾注释会被读进值里', () => {
        const md = buildNoteTemplate(CTX);
        for (const t of ENTRY_TYPES) {
            for (const line of blockOf(md, t).split('\n')) {
                const s = line.trim();
                if (!s || s.startsWith('#') || s === '---') continue;
                expect(s, `「${s}」不能带行尾注释（会被当成值）`).not.toMatch(/\s#\s/);
            }
        }
    });

    it('不写 id（导入时插件生成并回写；自己写的 id 会被当「已存在」静默跳过）', () => {
        const md = buildNoteTemplate(CTX);
        for (const t of ENTRY_TYPES) expect(keysOf(blockOf(md, t))).not.toContain('id');
    });
});

describe('🔴 buildNoteTemplate · 列出来的键必须真的能被导入器读进去', () => {
    it('把模板里每个 type 区块整段喂给 scanImportableNotes，字段要能落进 draft', () => {
        const md = buildNoteTemplate(CTX);
        for (const t of ENTRY_TYPES) {
            // 占位符是故意的：换成一个真实标题，模拟「用户照模板填完」
            const text = blockOf(md, t).replace('title: "{{标题}}"', 'title: "测试标题"');
            const { candidates, skipped } = scanImportableNotes({
                files: [{ path: `媒体库/笔记/${t}/测试.md`, text }],
                entries: [],
                notesDir: '媒体库/笔记',
            });
            // ⚠️ 注意：上面 `text` 就是完整笔记（frontmatter + 空正文），不含 `---` 以外的内容
            expect(skipped, `${t} 区块不该被拦（原因：${skipped.map((s) => s.reason).join(' / ')}）`).toHaveLength(0);
            expect(candidates, `${t} 区块必须能导入`).toHaveLength(1);
            const d = candidates[0].draft;
            expect(candidates[0].type).toBe(t);
            expect(candidates[0].title).toBe('测试标题');
            expect(candidates[0].warnings, `${t} 区块示例值不该触发降级警告`).toBeUndefined();
            // 通用字段真的有值落进 draft（不是「写进模板但没被读」）
            expect(d.year).toBe(2020);
            expect(d.genres).toEqual(['剧情', '科幻']);
            expect(d.status).toBe('watched');
            expect(d.rating).toBe(4.5);
            expect(d.series).toBe('某某系列');
            expect(d.seriesIndex).toBe(1);
            expect(d.watchedDate).toBe('2024-03-08');
            expect(d.plannedDate).toBe('2026-09-01');
        }
    });

    it('类型专属字段也真能落进 draft（而不是只印在模板上）', () => {
        const md = buildNoteTemplate(CTX);
        const draftOf = (t: string) => {
            const text = blockOf(md, t).replace('title: "{{标题}}"', 'title: "测试标题"');
            const r = scanImportableNotes({ files: [{ path: `媒体库/笔记/${t}/测试.md`, text }], entries: [], notesDir: '媒体库/笔记' });
            return r.candidates[0].draft;
        };
        expect(draftOf('movie')).toMatchObject({ director: '某某导演', cast: ['演员A', '演员B'], country: '中国', language: '汉语', durationMin: 128 });
        expect(draftOf('anime')).toMatchObject({ developer: '某某工作室' });
        expect(draftOf('game')).toMatchObject({ platform: 'PC', developer: '某某工作室' });
        expect(draftOf('book')).toMatchObject({ author: '某某', translator: '某某', publisher: '某出版社', isbn: '9787000000000' });
        expect(draftOf('music')).toMatchObject({ author: '某某', album: '某专辑' });
    });

    it('模板里列出的每个键都在导入器的 draft 白名单里（反向守卫）', () => {
        // 用「给每个键喂一个值，看 draft 里有没有出现对应字段」的方式反推白名单，
        // ⛔ 不读源码正则：那种守卫会被注释打穿（本仓已犯过三次）。
        const md = buildNoteTemplate(CTX);
        const importedKeys = new Set<string>();
        const probe: Record<string, string> = {
            year: '2001', genres: '[x]', series: '"s"', series_index: '2', status: 'watched', rating: '3',
            banner: '"https://x/y.jpg"', watched_date: '2024-01-01', planned_date: '2024-02-02',
            director: '"d"', cast: '[a]', country: '"c"', language: '"l"', duration_min: '90',
            developer: '"dev"', platform: '"PC"', author: '"a"', translator: '"t"', publisher: '"p"',
            isbn: '"i"', album: '"al"',
        };
        for (const k of Object.keys(probe)) {
            const text = `---\ntype: movie\ntitle: "t"\n${k}: ${probe[k]}\n---\n`;
            const r = scanImportableNotes({ files: [{ path: '媒体库/笔记/movie/x.md', text }], entries: [], notesDir: '媒体库/笔记' });
            const d = r.candidates[0]?.draft ?? {};
            // draft 里键名与 frontmatter 键名并不总相同（duration_min→durationMin、banner→poster…）
            const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
            const present = Object.keys(d).some((dk) => dk === camel || dk === k)
                || (k === 'banner' && typeof d.poster === 'string');
            if (present) importedKeys.add(k);
        }
        for (const t of ENTRY_TYPES) {
            for (const k of keysOf(blockOf(md, t))) {
                if (k === 'type' || k === 'title') continue;
                expect(importedKeys.has(k), `模板里列了「${k}」，但导入器根本不读它 ⇒ 用户白填`).toBe(true);
            }
        }
    });
});
