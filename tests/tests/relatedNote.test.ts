// #635 关联条目的**笔记侧**：`## 关联` 章节生成 + 重写保留区（用户手改不被覆盖）+ 章节名 / 提示行单真源。
import { describe, it, expect } from 'vitest';
import { EntryService } from 'services/EntryService';
import {
    RELATED_SECTION as GEN_SECTION,
    RELATED_EMPTY_HINT as GEN_HINT,
    generateNoteMarkdown,
    relatedNoteLines,
} from 'data/noteGenerator';
import {
    RELATED_SECTION as EDIT_SECTION,
    RELATED_EMPTY_HINT as EDIT_HINT,
    extractRelatedSectionBody,
} from 'pure/noteEditable';
import { normalizeEntry } from 'data/catalog';
import type { VaultIO } from 'data/catalog';
import type { MediaEntry } from 'data/types';

function memIO(): VaultIO & { files: Record<string, string> } {
    const files: Record<string, string> = {};
    return {
        files,
        async readText(path: string) {
            if (!(path in files)) throw new Error(`ENOENT: ${path}`);
            return files[path];
        },
        async writeText(path: string, content: string) {
            files[path] = content;
        },
        async deleteFile(path: string) {
            delete files[path];
        },
    };
}

function entry(id: string, extra: Partial<MediaEntry> = {}): MediaEntry {
    return normalizeEntry({ id, type: 'music', title: `标题-${id}`, ...extra });
}

/** 取某篇笔记里「## 关联」区正文（测试内自写，不复用被测实现） */
function sectionOf(md: string): string {
    const lines = md.split('\n');
    const i = lines.findIndex((l) => l.trim() === `## ${REL_HEADING}`);
    if (i === -1) return '<缺失>';
    const buf: string[] = [];
    for (let k = i + 1; k < lines.length; k++) {
        if (/^##\s/.test(lines[k])) break;
        buf.push(lines[k]);
    }
    return buf.join('\n').trim();
}
const REL_HEADING = '关联';

describe('#635 单真源：笔记生成侧与读取侧必须是同一个字面量', () => {
    it('章节名一致（⛔ 改名 = 存量笔记关联区保存即被抹掉）', () => {
        expect(GEN_SECTION).toBe(EDIT_SECTION);
        expect(GEN_SECTION).toBe(REL_HEADING);
    });

    it('空区提示行一致', () => {
        expect(GEN_HINT).toBe(EDIT_HINT);
    });
});

describe('#635 relatedNoteLines —— 逐条内容形态', () => {
    it('无关联 ⇒ 空数组', () => {
        expect(relatedNoteLines(entry('e_a'))).toEqual([]);
    });

    it('有 label ⇒ `- 关系词：[[标题]]`', () => {
        const a = entry('e_a', { related: [{ id: 'e_b', label: '翻唱' }] });
        expect(relatedNoteLines(a, [a, entry('e_b', { title: '晴天' })])).toEqual(['- 翻唱：[[晴天]]']);
    });

    it('label 空 ⇒ 「关联」', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }] });
        expect(relatedNoteLines(a, [a, entry('e_b', { title: '晴天' })])).toEqual(['- 关联：[[晴天]]']);
    });

    it('查不到目标 ⇒ 用 id 兜底（⛔ 不丢行）', () => {
        const a = entry('e_a', { related: [{ id: 'e_gone', label: '前作' }] });
        expect(relatedNoteLines(a, [a])).toEqual(['- 前作：[[e_gone]]']);
    });

    it('不传全库 ⇒ 也用 id 兜底', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }] });
        expect(relatedNoteLines(a)).toEqual(['- 关联：[[e_b]]']);
    });

    it('标题里的方括号转义（否则 wikilink 会被提前闭合）', () => {
        const a = entry('e_a', { related: [{ id: 'e_b' }] });
        const b = entry('e_b', { title: '第 5 集 [前篇]' });
        expect(relatedNoteLines(a, [a, b])).toEqual(['- 关联：[[第 5 集 \\[前篇\\]]]']);
    });
});

describe('#635 generateNoteMarkdown —— 关联章节', () => {
    it('无关联也出章节 + 提示行（保持章节结构稳定）', () => {
        expect(sectionOf(generateNoteMarkdown(entry('e_a')))).toBe(GEN_HINT);
    });

    it('有关联 ⇒ 逐行列出，且 id 换成标题', () => {
        const a = entry('e_a', { related: [{ id: 'e_b', label: '原唱' }, { id: 'e_c' }] });
        const all = [a, entry('e_b', { title: '晴天' }), entry('e_c', { title: '稻香' })];
        expect(sectionOf(generateNoteMarkdown(a, 'ReelLudic', { allEntries: all }))).toBe('- 原唱：[[晴天]]\n- 关联：[[稻香]]');
    });

    it('关联章节排在链接章节之前（与表单章节顺序一致）', () => {
        const md = generateNoteMarkdown(entry('e_a', { type: 'movie', related: [{ id: 'e_b' }] }));
        expect(md.indexOf('## 关联')).toBeGreaterThan(-1);
        expect(md.indexOf('## 关联')).toBeLessThan(md.indexOf('## 观看链接'));
    });

    it('音乐条目也有（音乐没有链接章节，关联照旧）', () => {
        const md = generateNoteMarkdown(entry('e_a', { type: 'music' }));
        expect(md).toContain('## 关联');
        expect(md).not.toContain('## 观看链接');
    });

    it('「笔记表格」关掉不影响关联章节', () => {
        const a = entry('e_a', { related: [{ id: 'e_b', label: '同曲' }] });
        const md = generateNoteMarkdown(a, 'ReelLudic', { table: false, allEntries: [a, entry('e_b', { title: '晴天' })] });
        expect(md).not.toContain('[!bookinfo]');
        expect(sectionOf(md)).toBe('- 同曲：[[晴天]]');
    });

    it('只写**出边**：别人挂我的不在我的笔记里（入边是渲染时算的，写进笔记就成了第二份真源）', () => {
        const a = entry('e_a');
        const b = entry('e_b', { related: [{ id: 'e_a', label: '原唱' }] });
        const mdA = generateNoteMarkdown(a, 'ReelLudic', { allEntries: [a, b] });
        expect(sectionOf(mdA)).toBe(GEN_HINT);
    });
});

describe('#635 extractRelatedSectionBody —— 区抽取（三种要分开）', () => {
    it('没有该区 ⇒ null', () => {
        expect(extractRelatedSectionBody('## 个人评语\n\n好\n')).toBeNull();
    });

    it('只有提示行 ⇒ 空串', () => {
        expect(extractRelatedSectionBody(`## ${REL_HEADING}\n\n${GEN_HINT}\n\n## 观看链接\n`)).toBe('');
    });

    it('只有空白 ⇒ 空串', () => {
        expect(extractRelatedSectionBody(`## ${REL_HEADING}\n\n   \n\n## 观看链接\n`)).toBe('');
    });

    it('有内容 ⇒ 原文（去首尾空白，不越过下一个二级标题）', () => {
        const md = `## ${REL_HEADING}\n\n- 原唱：[[晴天]]\n- 同曲：[[稻香]]\n\n## 观看链接\n- [a](b)\n`;
        expect(extractRelatedSectionBody(md)).toBe('- 原唱：[[晴天]]\n- 同曲：[[稻香]]');
    });

    it('末区（后面没有别的二级标题）也能抽', () => {
        expect(extractRelatedSectionBody(`## ${REL_HEADING}\n- 关联：[[x]]\n`)).toBe('- 关联：[[x]]');
    });
});

describe('#635 writeNote 保留区 —— 用户手改的关联不被模板覆盖', () => {
    it('目录没有关联、笔记里手写了 ⇒ 搬回（保存一次不会丢）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const e = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.writeNote(e.id);
        const path = (await svc.get(e.id))!.notePath!;
        // 模拟用户手改笔记的关联区（模板形态是 `## 关联\n（暂无关联）`，标题后**没有**空行）
        io.files[path] = io.files[path].replace(`## ${REL_HEADING}\n${GEN_HINT}`, `## ${REL_HEADING}\n- 续作：[[沙丘 2]]`);
        await svc.writeNote(e.id);
        expect(sectionOf(io.files[path])).toBe('- 续作：[[沙丘 2]]');
    });

    it('目录**有**关联 ⇒ 以目录为准，旧笔记内容不覆盖回来（否则表单新加的会被冲掉）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const a = await svc.create({ type: 'music', title: '晴天' });
        const b = await svc.create({ type: 'music', title: '稻香' });
        await svc.writeNote(a.id);
        const path = (await svc.get(a.id))!.notePath!;
        io.files[path] = io.files[path].replace(`## ${REL_HEADING}\n\n${GEN_HINT}`, `## ${REL_HEADING}\n\n- 手改：[[某人]]`);
        await svc.update(a.id, { related: [{ id: b.id, label: '同曲' }] });
        await svc.writeNote(a.id);
        expect(sectionOf(io.files[path])).toBe('- 同曲：[[稻香]]');
    });

    it('目标标题取自目录（wikilink 指向真标题，不是 id）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const a = await svc.create({ type: 'music', title: '晴天' });
        const b = await svc.create({ type: 'music', title: '稻香' });
        await svc.update(a.id, { related: [{ id: b.id, label: '同曲' }] });
        const path = await svc.writeNote(a.id);
        expect(sectionOf(io.files[path])).toBe('- 同曲：[[稻香]]');
    });

    it('旧笔记没有关联区 ⇒ 模板自带（不炸）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const a = await svc.create({ type: 'movie', title: '沙丘' });
        await svc.writeNote(a.id);
        const path = (await svc.get(a.id))!.notePath!;
        // 把整区从旧笔记里删掉
        io.files[path] = io.files[path].replace(`## ${REL_HEADING}\n\n${GEN_HINT}\n\n`, '');
        await svc.writeNote(a.id);
        expect(sectionOf(io.files[path])).toBe(GEN_HINT);
    });

    it('摘抄区仍插在「链接章节之前」（锚点没被关联章节抢走）+ 关联排在链接之前', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const a = await svc.create({ type: 'book', title: '坛经' });
        await svc.writeNote(a.id);
        const path = (await svc.get(a.id))!.notePath!;
        // 用户手动在笔记里加一块摘抄（模板本来没有该区）
        io.files[path] = io.files[path].replace(`## ${REL_HEADING}`, `## 摘抄\n\n> 本来无一物\n\n## ${REL_HEADING}`);
        await svc.writeNote(a.id);
        const md = io.files[path];
        // 🔴 `mergeExcerptSection` 的插入锚点是既有口径「链接章节之前」，本次**没有**改它 ——
        //    于是摘抄落在链接之前（附在关联之后），而不是把摘抄区拽到关联之前。
        expect(md.indexOf('## 摘抄')).toBeLessThan(md.indexOf('## 相关链接'));
        // 关联章节自身的位置：评语 → 关联 → 链接（与表单章节顺序一致）
        expect(md.indexOf('## 个人评语')).toBeLessThan(md.indexOf(`## ${REL_HEADING}`));
        expect(md.indexOf(`## ${REL_HEADING}`)).toBeLessThan(md.indexOf('## 相关链接'));
        expect(md).toContain('本来无一物');
    });

    it('幂等：连写两次内容不变（不会越写越多空行）', async () => {
        const io = memIO();
        const svc = new EntryService(io);
        const a = await svc.create({ type: 'music', title: '晴天' });
        const b = await svc.create({ type: 'music', title: '稻香' });
        await svc.update(a.id, { related: [{ id: b.id, label: '同曲' }] });
        const p1 = await svc.writeNote(a.id);
        const first = io.files[p1];
        await svc.writeNote(a.id);
        expect(io.files[p1]).toBe(first);
    });
});
