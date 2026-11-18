// ②-2：B站音乐**后台下载完成后自动关联已有音乐条目**（用户 m04435 逐字：
//   「从B站下载音乐：后台下载完成后自动关联已有音乐条目，不要求用户再手动搜索。」）
//
// 为什么是源码文本守卫：这条链路的失效形态有两种，编译器都看不见 ——
//   ⑴ **静默漏接**：`autoAssociateDownloadedAudio` 写了但没在下载成功后被调用（文件下好了、关联没发生）；
//   ⑵ **反向伤害**：把关联失败也当成下载失败（用户明明已经下好了，却被一句「请求失败」吓到）。
// 纯匹配逻辑的**行为**测试在 `tests/libraryAudio.test.ts`（`matchAudioFileToEntry` 那 9 条），本文件只管接线。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const raw = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');
/** 剥注释：三档且都**不跨行**（`/\/\*[\s\S]*?\*\//` 会被模板里的 `accept="image/*"` 之类吞掉，本仓踩过） */
const MAIN = raw
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/\/\*[^*\n]*\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * 按大括号配平取方法体（拿不到就抛 —— ⛔ 不许静默变空导致整组断言假绿）。
 *
 * 🔴 两个坑（本仓都踩过，缺一个就取错）：
 *  ⑴ 参数列表在大括号**之前** ⇒ 必须先按 `(` `)` 配平跳过参数；
 *  ⑵ 返回类型可能是 `Promise<{ ok: boolean; … }>` —— 跳过参数后遇到的第一个 `{`
 *     是**类型字面量**，不是方法体 ⇒ 还要按 `<` `>` 配平跳过泛型。
 * 取错了不会抛，只会悄悄返回一段类型文本，让所有 `toContain` 集体假红（本轮实测）。
 */
function methodBody(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`找不到方法：${signature}`);
    // ⑴ 跳过参数列表（signature 自带末尾 `(` ⇒ 从那个字符本身开始找，⛔ 别从它后面找）
    let p = src.indexOf('(', at + signature.length - 1);
    if (p < 0) throw new Error(`找不到参数列表：${signature}`);
    let paren = 0;
    for (; p < src.length; p++) {
        if (src[p] === '(') paren++;
        else if (src[p] === ')') {
            paren--;
            if (paren === 0) break;
        }
    }
    // ⑵ 跳过返回类型里的泛型（`Promise<{ … }>`），再取方法体
    let angle = 0;
    let open = -1;
    for (let q = p + 1; q < src.length; q++) {
        const ch = src[q];
        if (ch === '<') angle++;
        else if (ch === '>') angle--;
        else if (ch === '{' && angle === 0) {
            open = q;
            break;
        } else if (ch === ';' && angle === 0) break; // 纯声明，没有方法体
    }
    if (open < 0) throw new Error(`找不到方法体：${signature}`);
    let depth = 0;
    for (let q = open; q < src.length; q++) {
        if (src[q] === '{') depth++;
        else if (src[q] === '}') {
            depth--;
            if (depth === 0) return src.slice(open, q + 1);
        }
    }
    throw new Error(`方法体未闭合：${signature}`);
}

describe('🔴 m04435 ② B站下载完自动关联音乐条目', () => {
    it('🔴 下载成功路径**确实**调了自动关联（落盘之后、拼回执之前）', () => {
        const body = methodBody(MAIN, 'async dlBiliDownload(');
        expect(body).toContain('const auto = await this.autoAssociateDownloadedAudio(relPath);');
        // 顺序契约：必须先写文件、再关联 —— 文件不在库里时关联成功也没用
        const writeAt = body.indexOf('await this.writeBinaryFile(relPath, r.data);');
        const callAt = body.indexOf('this.autoAssociateDownloadedAudio(relPath)');
        const returnAt = body.indexOf('return { ok: true, message:');
        expect(writeAt).toBeGreaterThan(-1);
        expect(callAt).toBeGreaterThan(writeAt);
        expect(returnAt).toBeGreaterThan(callAt);
        // 关联结果必须拼回回执，否则用户看不到「帮你关联了哪一条」
        expect(body).toContain('（B站 \\xB7 ${ext}）${auto}');
    });

    it('🔴 自动关联**绝不抛**：catch 里返回空串，⛔ 不许把已下好的变成下载失败', () => {
        const body = methodBody(MAIN, 'private async autoAssociateDownloadedAudio(');
        // 整个方法被 try/catch 包住
        expect(body.trimStart().startsWith('{')).toBe(true);
        expect(body).toContain('try {');
        expect(body).toContain('} catch {');
        // ⛔ 不许在 catch 里 throw / 返回错误字符串（调用方只看『有没有多一句话』）
        const catchAt = body.indexOf('} catch {');
        const catchTail = body.slice(catchAt);
        expect(catchTail).not.toContain('throw');
        expect(catchTail).not.toContain('请求失败');
        // 没找到条目也是正常结局，要给出「可手动挑」的回执而不是装作成功
        expect(body).toContain('没找到可自动关联的音乐条目');
    });

    it('🔴 关联只动 `audioPath`，且**不覆盖**用户手工改过的笔记正文', () => {
        const body = methodBody(MAIN, 'private async autoAssociateDownloadedAudio(');
        expect(body).toContain('await this.service.update(hit.id, { audioPath: relPath });');
        // 外部改过笔记就不重写（与 EntryModal.onApplyAudio 同一口径）
        expect(body).toContain('await this.service.noteWasExternallyModified(hit.id)');
        // 关联完界面要刷新，否则卡片上还看不到音频已关联
        expect(body).toContain('await this.refreshViews();');
        // ⛔ 别顺手改别的字段（那会冲掉用户其它改动）
        expect(body).not.toContain('status:');
        expect(body).not.toContain('listenMinutes');
    });

    it('🔴 判据走共用真源 `matchAudioFileToEntry`，⛔ 不许在宿主里另写一套相似度', () => {
        const body = methodBody(MAIN, 'private async autoAssociateDownloadedAudio(');
        expect(body).toContain('matchAudioFileToEntry(entries, fileName)');
        // 反向守卫：宿主里不许出现自己的打分/同名判定（两把尺必然分叉）
        expect(body).not.toContain('songSimilarityScore');
        expect(body).not.toContain('segmentsExactTitle');
        expect(body).not.toContain('LIBRARY_AUDIO_MIN_SCORE');
    });

    it('🔴 纯匹配真源在 `pure/libraryAudio`，且导出名对得上', () => {
        const pure = readFileSync(resolve(ROOT, 'src/pure/libraryAudio.ts'), 'utf8');
        expect(pure).toContain('export function matchAudioFileToEntry<');
        expect(MAIN).toContain('matchAudioFileToEntry');
    });
});
