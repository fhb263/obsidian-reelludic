/**
 * 「从笔记导入条目」引导弹窗的**条件文案**（2026-11-17 用户报障 ⑥-B）。
 *
 * 用户原话：「『从笔记导入条目』导入按钮要弹引导弹窗说明笔记需满足什么条件，
 * 不能只提示『没有可导入的笔记』」。
 *
 * 这组用例盯的不是 DOM，而是**文案与判据同源**这件事：
 *  · `noteImportRequirements()` 印出来的类型清单必须等于 `ENTRY_TYPES` 的中文标签 ——
 *    加第七种类型时，弹窗文案会跟着变；只测「文案里含『电影』」是单向的，永远会绿。
 *  · 四条条件必须**逐条**对得上 `pure/noteImport.scanImportableNotes` 的那几道闸
 *    （type 白名单 / title 可用 / 路径未被占用 / 目录范围），漏一条就等于给了错的排查线索。
 *
 * ⚠️ 导 `modals/` 下的模块会连带加载 `obsidian` —— vitest alias 已把它指到 `tests/mocks/obsidian.ts`，
 *    这里只用纯函数，不 new Modal，所以替身足够。
 */
import { describe, expect, it } from 'vitest';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS } from 'data/types';
import { noteImportRequirements, noteImportTypeList } from 'modals/NoteImportGuideModal';

describe('noteImportGuide · 条件文案与判据同源', () => {
    it('类型清单由 `ENTRY_TYPES` 派生：六种全在、顺序一致、没有多余项', () => {
        const expected = ENTRY_TYPES.map((t) => ENTRY_TYPE_LABELS[t]).join(' / ');
        expect(noteImportTypeList()).toBe(expected);
        // 逐项钉住：这样「只印了前三种」也会被抓住（拼串相等已经覆盖，但这条给了更清楚的失败信息）
        for (const t of ENTRY_TYPES) expect(noteImportTypeList()).toContain(ENTRY_TYPE_LABELS[t]);
    });

    it('四条条件：目录 / type / title / 路径占用，一条都不许少', () => {
        const lines = noteImportRequirements('媒体库/笔记');
        expect(lines).toHaveLength(4);
        // ① 目录范围（对应 main.runNoteImport 的 `startsWith(`${folder}/`)`）
        expect(lines[0]).toContain('媒体库/笔记');
        // ② type 白名单（对应 scanImportableNotes 第一道闸）
        expect(lines[1]).toContain('type:');
        expect(lines[1]).toContain(ENTRY_TYPE_LABELS.movie);
        // ③ title 可用 + 占位符（对应第二道闸）
        expect(lines[2]).toContain('title:');
        expect(lines[2]).toContain('{{');
        // ④ 路径未被占用（对应第三道闸 usedPaths / byId 去重）
        expect(lines[3]).toContain('占用');
    });

    it('目录名来自入参而不是写死的「笔记」：换库目录后文案跟着变', () => {
        const a = noteImportRequirements('我的库/笔记');
        const b = noteImportRequirements('OtherLib/notes');
        expect(a[0]).toContain('我的库/笔记');
        expect(b[0]).toContain('OtherLib/notes');
        expect(a[0]).not.toBe(b[0]);
    });

    it('条件里印的类型清单与 `noteImportTypeList()` 是同一个源（⛔ 不烧第二份文案）', () => {
        const lines = noteImportRequirements('媒体库/笔记');
        expect(lines[1]).toContain(noteImportTypeList());
    });
});
