import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 m19946（用户逐字）：「还有下载B站音频的那个进度框只下载一个时怎么显示了两个标题和两个进度」
 *
 * 根因不是「多了个节点」，而是 `paintTasks()` 用 `rows.length > 0` 判「多任务」——
 * B 站下载每首歌都 `upsertTask`，**单首也走多行形态** ⇒ 卡片头/底写一次标题与百分比，
 * 那一行里再写一次，两套并存。
 *
 * ⇒ 判定必须是 `rows.length > 1`。这些判据守的就是这条，⛔ 别为了「多一行也无所谓」把它改回去。
 */
const SRC = readFileSync(join(__dirname, '..', 'src/services/progressBall.ts'), 'utf8');

function paintTasksBody(): string {
    const at = SRC.indexOf('private paintTasks(): void {');
    if (at < 0) return '';
    // ⚠️ 用大括号配对切函数体 —— 本仓是 CRLF，`\n    }\n` 这种锚会拿到 -1
    let i = SRC.indexOf('{', at);
    let depth = 0;
    for (let j = i; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') {
            depth--;
            if (depth === 0) return SRC.slice(i, j + 1);
        }
    }
    return '';
}

describe('🔴 m19946 单任务进度框只有一套标题与进度', () => {
    const body = paintTasksBody();

    it('paintTasks 函数体切得出来（切不出来后面的判据全是假绿）', () => {
        expect(body.length).toBeGreaterThan(800);
    });

    it('🔴「多任务」判定是 `rows.length > 1`，⛔ 不是 `> 0`', () => {
        expect(body).toContain('const multi = this.rows.length > 1;');
        expect(body).not.toContain('const multi = this.rows.length > 0;');
    });

    it('🔴 单行时**不建行节点**（建了就得靠藏，藏漏一处又是一份重复）', () => {
        // 建行循环必须包在 `if (multi) {` 里
        expect(body).toMatch(/if \(multi\) \{[\s\S]{0,400}?buildTaskRow\(row\)/);
        // 反向守卫：不许写成无条件的 for 循环
        expect(body).not.toMatch(/\n\s{8}for \(const row of this\.rows\) \{\n\s{12}let node = this\.taskNodes\.get\(row\.id\);/);
    });

    it('🔴 单行时百分比画进**单条 bar**（单任务形态唯一的进度条）', () => {
        expect(body).toMatch(/if \(!multi && this\.barFillEl\) \{/);
        expect(body).toContain('const p = taskBarPercent(only.percent);');
        expect(body).toContain("this.barFillEl.style.width = only.phase === 'done' ? '100%' : p === null ? '' : `${p}%`;");
    });

    it('🔴 多行时清掉单条 bar 的宽度（否则切回单任务会残留上一条的百分比）', () => {
        expect(body).toMatch(/if \(multi && this\.barFillEl\) this\.barFillEl\.style\.width = '';/);
    });

    it('🔴 单条 bar 与多行列表互斥（多行时藏 bar，单行时藏列表）', () => {
        expect(body).toContain("list.classList.toggle('is-hidden', !multi);");
        expect(body).toMatch(/if \(this\.barEl\) this\.barEl\.classList\.toggle\('is-hidden', multi\);/);
    });
});
