import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 这一组是**结构守卫**，不是行为测试，理由要说清楚：
 *
 * 用户 m12618 报「极速版 SenseVoice每隔2分钟出句还是错的」，根因是 `asrSenseVoice.ts`
 * 的 `runLines` **每个 stream chunk 各自 `split('\n')`** —— 一条 5～10KB 的 JSON 被
 * chunk 边界切成两半时两个片段都解析失败，整段句子静默丢失。
 *
 * `tests/lineBuffer.test.ts` 只能证明 `createLineSplitter` 本身对，**证明不了这两条
 * 链路真的在用它**。假 deps 是直接 `onLine(line)` 喂整行的，压根不经过分块流 ⇒
 * 如果有人把 `runLines` 改回逐块 split，行为测试全绿、缺陷照旧复发。
 *
 * 所以这里用源码级断言把「必须走统一的行缓冲」钉住。它守的是**接线**，不是逻辑。
 */
describe('行缓冲接线守卫（🔴 m12618 的复发防线）', () => {
    const ROOT = join(__dirname, '..');

    const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

    for (const rel of ['src/services/asrSenseVoice.ts', 'src/services/asrQwen.ts']) {
        it(`${rel} 必须用 pure/lineBuffer 做跨块行缓冲`, () => {
            const src = read(rel);
            expect(src).toContain("from 'pure/lineBuffer'");
            expect(src).toContain('createLineSplitter(');
            // 收尾必须 flush，否则最后一条没有换行结尾的 JSON / DONE 会漏
            expect(src).toContain('.flush()');
        });

        it(`${rel} 流式管道里不许再出现任何逐块 split`, () => {
            const src = read(rel);
            // ⚠️ 只守「流式管道」这一段：从第一个 data 回调到 flush 收尾。
            //    进程结束之后对整个 stderr 字符串 split 取最后一行是合法的
            //    （那时已经拿全了，不存在跨块问题），⛔ 别把守卫写成全文搜索。
            const start = src.indexOf(".on('data'");
            const end = src.lastIndexOf('.flush()');
            expect(start).toBeGreaterThan(0);
            expect(end).toBeGreaterThan(start);
            const streaming = src.slice(start, end);
            expect(streaming).not.toContain('.split(');
        });

        it(`${rel} 不许再手写一份 chunkBuffer / lastNewline（两份实现是事故土壤）`, () => {
            const src = read(rel);
            expect(src).not.toContain('function chunkBuffer');
            expect(src).not.toContain('function lastNewline');
        });
    }

    it('stderr 累积也走 splitter 的 onText，⛔ 不用 toString 逐块解中文', () => {
        const src = read('src/services/asrSenseVoice.ts');
        // 逐块 toString 会在多字节字符被腰斩时产生 U+FFFD，错误文案会变乱码
        expect(src).not.toMatch(/err \+= buf\.toString\('utf8'\)/);
    });
});
