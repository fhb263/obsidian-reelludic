/**
 * 输入框格式引导的守卫（2026-11-15 用户 m04642 ②）。
 *
 * ## 用户口径（逐字）
 * 「这个所有输入框的占位字符应该引导用户填单个或多个的格式不然用户不知道填什么
 *   列个表格出来对比一下」
 *
 * ## 这个测试在钉什么
 * 改造前的 bug 不是"缺占位符"，而是**占位符与解析口径对不上**，具体三类：
 *   1. `tags` 提交时 `split(/[,，]/)` **只认逗号**，但当时占位符写「多个用逗号分隔」算对的；
 *   2. `genres` / `cast` / `aliases` / `directorWriters` 提交时 `split(/[\/、,，]/)`
 *      斜杠顿号逗号全认 —— 与 `tags` 的口径**不同**，但两者提示语长得一样；
 *   3. `platform` 是**单值**字符串，占位符却写 `PC / Switch / PS5`，
 *      看着像能填三个，实际整串存成**一个**平台名。
 *
 * ⇒ 两条路一起钉：
 *   · **正向**：模板里的占位符必须由 `placeholderOf(key)` 生成，⛔ 不许手写第二份格式说明；
 *   · **反向**：`FORM_FIELD_SPECS` 里的 `sep` 必须与 `EntryForm.svelte` 的 `split(...)` 逐字一致。
 *     以后谁改了提交侧切分规则却没改规格表，这里会红。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { FORM_FIELD_SPECS, formFieldSpec, hintOf, placeholderOf, separatorSample, separatorWord } from '../src/pure/formFields';

const ROOT = resolve(__dirname, '..');
const FORM = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');

/**
 * ⚠️ 这个文件（6900+ 行）**不能用 `stripComments`**：
 * 块注释正则 `/\/\*[\s\S]*?\*\//` 会从文件前段某个 `/*` 一路吃到很后面，
 * 把整段模板删掉 —— 实测剥完 `indexOf('placeholderOf(')` 直接 -1 造成恒假红。
 * 所以一律在**原文**上按精确形态匹配。
 */

describe('formFields · 占位符文案生成', () => {
    it('多值字段：先说「多个用X分隔」，再给例子', () => {
        expect(placeholderOf('genres')).toBe('多个用斜杠分隔，如 科幻 / 冒险 / 灾难');
        expect(placeholderOf('cast')).toContain('多个用斜杠分隔');
        // 🔴 tags 只认逗号 —— 这句必须写「逗号」，写「斜杠」就是骗用户
        expect(placeholderOf('tags')).toBe('多个用逗号分隔，如 工作, 日常');
    });

    it('单值字段：明示「（单个）」，且示例里不许出现分隔符', () => {
        for (const key of ['platform', 'author', 'developer', 'album', 'collection', 'publisher']) {
            const spec = formFieldSpec(key);
            expect(spec, `${key} 必须在规格表里`).toBeTruthy();
            expect(spec!.arity).toBe('single');
            const text = placeholderOf(key);
            expect(text, `${key} 的占位符必须点明单个`).toContain('（单个）');
            // ⛔ 单值示例里塞分隔符是 `PC / Switch / PS5` 那种反面教材
            expect(text, `${key} 的示例里不该出现斜杠`).not.toMatch(/示例|如 .*\/ /);
            expect(spec!.example).not.toContain('/');
        }
    });

    it('🔴 有 `placeholder:` 覆盖的字段原样返回覆盖文案（且一定也是单值口径）', () => {
        // 这两个框的整句是用户裁定结论、被 `assert-symbols.cjs` 逐字钉着 ⇒ 走覆盖而不是模板生成。
        const series = formFieldSpec('series')!;
        expect(series.placeholder).toBe('同一系列的名称（留空不成组）');
        expect(placeholderOf('series')).toBe(series.placeholder);

        const idx = formFieldSpec('series-index')!;
        expect(idx.placeholder).toBe('可留空，填整数（第几部/季）');
        expect(placeholderOf('series-index')).toBe(idx.placeholder);

        // 覆盖只给极少数被钉死的句子用，⛔ 别把普通字段也都写成覆盖
        const overridden = FORM_FIELD_SPECS.filter((s) => s.placeholder);
        expect(overridden.length, `覆盖字段不该有这么多：${overridden.map((s) => s.key).join(',')}`).toBeLessThanOrEqual(3);
    });

    it('🔴 platform 是单值：占位符不许让人以为能填多个', () => {
        const text = placeholderOf('platform');
        expect(text).not.toContain('/');
        expect(text).toContain('单个');
        expect(formFieldSpec('platform')!.note).toContain('只能填一个');
    });

    it('未登记的 key 原样回退 fallback，不抛错', () => {
        expect(placeholderOf('不存在', '兜底文案')).toBe('兜底文案');
        expect(placeholderOf('不存在')).toBe('');
        expect(hintOf('不存在')).toBe('');
    });

    it('hintOf 包含形态、示例、可留空与注意事项', () => {
        expect(hintOf('tags')).toContain('可填多个，用逗号分隔');
        expect(hintOf('tags')).toContain('可留空');
        expect(hintOf('tags')).toContain('只认逗号');
        expect(hintOf('platform')).toContain('只能填一个');
        // title 是必填 ⇒ 不该出现「可留空」
        expect(hintOf('title')).not.toContain('可留空');
    });

    it('分隔符口径的两个人话助手', () => {
        expect(separatorWord('comma')).toBe('逗号');
        expect(separatorWord('slash')).toBe('斜杠');
        expect(separatorWord(undefined)).toBe('斜杠');
        expect(separatorSample('comma')).toBe('，');
        expect(separatorSample('slash')).toBe(' / ');
    });

    it('规格表本身自洽：多值必有 sep，单值必无 sep', () => {
        for (const spec of FORM_FIELD_SPECS) {
            if (spec.arity === 'multi') {
                expect(spec.sep, `${spec.key} 是多值却没写 sep`).toBeTruthy();
            } else {
                expect(spec.sep, `${spec.key} 是单值却写了 sep`).toBeUndefined();
            }
            expect(spec.example.length, `${spec.key} 缺示例`).toBeGreaterThan(0);
        }
    });
});

describe('formFields · 反向核对：规格表 ↔ 提交侧 split 口径', () => {
    /**
     * 从源码里取某次 split 用的分隔符正则。
     * ⚠️ 必须允许换行：`input.tags = tagsText` 与 `.split(/[,，]/)` 分两行写
     *    （`EntryForm.svelte:4070-4071`），用 `tagsText\.split` 这种紧贴写法会匹配不到。
     */
    function splitPatternOf(expr: string): string | null {
        const m = FORM.match(new RegExp(`${expr}\\s*\\.\\s*split\\(\\s*(\\/[^)]+\\/)`));
        return m ? m[1] : null;
    }

    it('`tags` 只认逗号（与规格表的 comma 一致）', () => {
        const pat = splitPatternOf('tagsText');
        expect(pat, '提交侧必须存在 tagsText.split(...)').toBeTruthy();
        expect(pat).toBe('/[,，]/');
        expect(formFieldSpec('tags')!.sep).toBe('comma');
    });

    it('`genres` / `cast` 认斜杠顿号逗号（与规格表的 slash 一致）', () => {
        for (const expr of ['genres', 'cast']) {
            const pat = splitPatternOf(expr);
            expect(pat, `提交侧必须存在 ${expr}.split(...)`).toBeTruthy();
            expect(pat, `${expr} 的切分口径变了，规格表的 sep 也得跟着改`).toBe('/[\\/、,，]/');
            expect(formFieldSpec(expr)!.sep).toBe('slash');
        }
    });

    it('`aliases` 与 `directorWriters` 同样是 slash 口径', () => {
        expect(splitPatternOf('aliases')).toBe('/[\\/、,，]/');
        expect(splitPatternOf('directorWriters')).toBe('/[\\/、,，]/');
        expect(formFieldSpec('aliases')!.sep).toBe('slash');
        expect(formFieldSpec('director')!.sep).toBe('slash');
    });
});

describe('formFields · 模板接线守卫', () => {
    it('🔴 误导性最强的几个框必须由 placeholderOf() 生成', () => {
        const required = [
            ["placeholderOf('tags')", 'tagsText'],
            ["placeholderOf('genres')", null],
            ["placeholderOf('cast')", null],
            ["placeholderOf('director')", null],
            ["placeholderOf('platform')", null],
            ["placeholderOf('collection')", null],
            ["placeholderOf('series')", null],
            ["placeholderOf('album')", null],
            ["placeholderOf('developer')", null],
            ["placeholderOf('book-author')", null],
            ["placeholderOf('novel-author')", null],
            ["placeholderOf('comic-author')", null],
            ["placeholderOf('music-author')", null],
        ] as const;
        for (const [call] of required) {
            expect(FORM, `模板里缺 ${call}`).toContain(call);
        }
        // tags 那一框必须真的是它（bind:value={tagsText} 与 placeholderOf('tags') 相邻）
        expect(FORM).toMatch(/bind:value=\{tagsText\}[\s\S]{0,120}placeholder=\{placeholderOf\('tags'\)\}/);
    });

    it('🔴 旧的误导文案必须彻底消失（只看 placeholder 属性，注释里引述旧名不算）', () => {
        // ⚠️ 必须只扫 `placeholder="..."` 属性：注释里会引述旧的错误文案当反面教材
        //    （`EntryForm.svelte:139` 就写着 `PC / Switch / PS5`），全文件 grep 会自撞。
        const placeholders = (FORM.match(/placeholder="[^"]*"/g) ?? []).join('\n');
        const stale = [
            'PC / Switch / PS5', // 单值字段被写成能填三个
            '多个题材用 / 分隔', // 与 tags 的逗号口径混用
            '作者名，多个用 / 分隔',
            '原作 / 编剧，多个用 / 分隔',
            '作画，多个用 / 分隔',
            '多个主演用 / 分隔',
            '导演 / 编剧 用 / 分隔',
            '歌手 / 艺术家',
            '多个用逗号分隔，如 工作, 日常', // 已改成由 placeholderOf 生成
        ];
        for (const text of stale) {
            expect(placeholders, `模板里还留着旧占位符「${text}」`).not.toContain(text);
        }
    });

    it('⛔ 别在模板里手写第二份「多个用…分隔」说明', () => {
        const handwritten = FORM.match(/placeholder="[^"]*多个用[^"]*"/g) ?? [];
        expect(handwritten, `这些手写占位符该换成 placeholderOf()：${handwritten.join(' | ')}`).toHaveLength(0);
    });
});
