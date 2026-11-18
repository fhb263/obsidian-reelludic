/**
 * ②-4 微信读书划线同步的**接线守卫**（源码文本断言）。
 *
 * 为什么需要：区段名 / 写出口 / 「不留空区」这三处，任何一处写错都**不会报错**，只会静默出问题 ——
 * ⑴ 区名忘了进 `ANNOTATION_SECTIONS` → 用户下次保存条目，整区被模板重写抹掉（丢数据）；
 * ⑵ 绕过 `syncWereadNotes` 直接 `vault.modify` → `noteFingerprint` 过期，下次编辑误报「笔记被外部修改」；
 * ⑶ 没有划线也建区 → 每本书笔记里多一段「共 0 条」噪音。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANNOTATION_SECTIONS } from 'pure/excerpt';
import { WEREAD_NOTES_SECTION } from 'pure/wereadNotes';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** 剥注释：这些文件里到处是「⛔ 别写 aria-label」式的说明，直接匹配会假红 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('②-4 接线守卫 · 区段名', () => {
    it('区名是「同步划线与高亮」，⛔ 不是「高亮」（#528 本地高亮只存阅读进度文件）', () => {
        expect(WEREAD_NOTES_SECTION).toBe('同步划线与高亮');
    });

    it('区名已登记进 ANNOTATION_SECTIONS —— 否则保存条目时整区被模板重写抹掉', () => {
        expect(ANNOTATION_SECTIONS as readonly string[]).toContain(WEREAD_NOTES_SECTION);
    });

    it('「高亮」本身仍**不在**白名单里（#528 的裁定没被这次改动推翻）', () => {
        expect(ANNOTATION_SECTIONS as readonly string[]).not.toContain('高亮');
    });
});

describe('②-4 接线守卫 · 写出口', () => {
    it('EntryService 提供 syncWereadNotes，且走 replaceAnnotationSection + writeNoteRaw（整区重写 / 唯一写出口）', () => {
        const src = stripComments(read('src/services/EntryService.ts'));
        expect(src).toMatch(/async syncWereadNotes\(id: string, markdown: string\): Promise<boolean>/);
        expect(src).toContain('replaceAnnotationSection(old, WEREAD_NOTES_SECTION, markdown ??');
        expect(src).toMatch(/await this\.writeNoteRaw\(id, notePath, next\)/);
    });

    it('内容逐字相同就不写盘（同步式「打开即写」会白刷 mtime）', () => {
        const src = stripComments(read('src/services/EntryService.ts'));
        expect(src).toMatch(/if \(next === old\) return false;/);
    });

    it('宿主侧 ⛔ 不出现直接改笔记文件的写法', () => {
        const src = stripComments(read('main.ts'));
        // 只在 syncWereadNotesFor 附近检查即可（main.ts 其它地方有正当的 vault 访问）
        const start = src.indexOf('private async syncWereadNotesFor(');
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, start + 2000);
        expect(body).not.toContain('vault.modify');
        expect(body).not.toContain('vault.read');
    });
});

describe('②-4 接线守卫 · 不留空区 / 不打断导入', () => {
    it('没有划线（notes 为空）就直接返回，⛔ 不建空区', () => {
        const src = stripComments(read('main.ts'));
        const start = src.indexOf('private async syncWereadNotesFor(');
        const body = src.slice(start, start + 2000);
        expect(body).toMatch(/if \(res\.notes\.length === 0\) return;/);
    });

    it('拉取失败先 return，⛔ 不把失败原因写成笔记内容', () => {
        const src = stripComments(read('main.ts'));
        const start = src.indexOf('private async syncWereadNotesFor(');
        const body = src.slice(start, start + 2000);
        expect(body).toMatch(/if \(!res\.ok\)/);
        expect(body).toMatch(/return;/);
    });

    it('调划线**共用 wereadInfoGate 同一条串行链**（另开一条 = 并发翻倍吃风控）', () => {
        const src = stripComments(read('main.ts'));
        const start = src.indexOf('private wereadNotesGated(');
        expect(start).toBeGreaterThan(-1);
        const body = src.slice(start, start + 900);
        expect(body).toContain('this.wereadInfoGate');
        expect(body).toContain('fetchWereadNotesSvc');
    });

    it('导入循环里「新建」与「覆盖」两条路都同步划线', () => {
        const src = stripComments(read('main.ts'));
        const calls = src.match(/await this\.syncWereadNotesFor\(/g) ?? [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });
});
