import { describe, expect, it } from 'vitest';
import {
    DOWNLOAD_CHUNK_BYTES,
    DOWNLOAD_MIN_CHUNKED_BYTES,
    DOWNLOAD_PARALLEL,
    activeParallel,
    chunkedPercent,
    planChunks,
    resumeChunk,
    shouldChunk,
    sumBytes,
} from 'pure/asrDownloadPlan';

describe('planChunks 切片计划', () => {
    it('正好整片：228MB 切成 8MB 的片，序号连续', () => {
        const total = 8 * 1024 * 1024 * 3;
        const chunks = planChunks(total);
        expect(chunks).toHaveLength(3);
        expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
        expect(chunks[0]).toMatchObject({ start: 0, end: DOWNLOAD_CHUNK_BYTES - 1 });
        expect(chunks[2].end).toBe(total - 1);
    });

    it('末片比整片短，size 用 end-start+1（⛔ 不能一律写 chunkBytes）', () => {
        const total = DOWNLOAD_CHUNK_BYTES * 2 + 1000;
        const chunks = planChunks(total);
        expect(chunks).toHaveLength(3);
        expect(chunks[2].size).toBe(1000);
        expect(chunks[2].start).toBe(DOWNLOAD_CHUNK_BYTES * 2);
        expect(chunks[2].end).toBe(total - 1);
    });

    it('各片大小之和必须等于总长（否则合并出来差字节）', () => {
        for (const total of [1, 7, 1024, 239233841, 487601967, 3095033483]) {
            const sum = planChunks(total).reduce((a, c) => a + c.size, 0);
            expect(sum).toBe(total);
        }
    });

    it('总长未知（<=0）⇒ 单片，且不报错', () => {
        for (const bad of [0, -1, Number.NaN]) {
            const chunks = planChunks(bad);
            expect(chunks).toHaveLength(1);
            expect(chunks[0].start).toBe(0);
        }
    });

    it('比一片还小的文件 ⇒ 只有一片', () => {
        expect(planChunks(100)).toHaveLength(1);
        expect(planChunks(100)[0].size).toBe(100);
    });

    it('片间无缝衔接：前一片 end + 1 === 后一片 start', () => {
        const chunks = planChunks(239233841);
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].start).toBe(chunks[i - 1].end + 1);
        }
    });
});

describe('resumeChunk 续传断点', () => {
    const chunk = { index: 2, start: 1000, end: 1999, size: 1000 };

    it('已下一半 ⇒ 从断点接着下（Range 起点要加上已有长度）', () => {
        expect(resumeChunk(chunk, 400)).toEqual({ index: 2, start: 1400, end: 1999, size: 600 });
    });

    it('正好齐了 ⇒ null（不用再发请求）', () => {
        expect(resumeChunk(chunk, 1000)).toBeNull();
    });

    it('片文件比应有长度还大 ⇒ 整片重下（多出来的字节会让模型头部错位）', () => {
        expect(resumeChunk(chunk, 1200)).toEqual(chunk);
    });

    it('没有片文件 / 坏值 ⇒ 整片重下', () => {
        expect(resumeChunk(chunk, 0)).toEqual(chunk);
        expect(resumeChunk(chunk, -1)).toEqual(chunk);
        expect(resumeChunk(chunk, Number.NaN)).toEqual(chunk);
    });
});

describe('shouldChunk 该不该切片', () => {
    it('≥4MB 才切，小文件开并发是纯浪费', () => {
        expect(shouldChunk(0)).toBe(false);
        expect(shouldChunk(1000)).toBe(false);
        expect(shouldChunk(DOWNLOAD_MIN_CHUNKED_BYTES - 1)).toBe(false);
        expect(shouldChunk(DOWNLOAD_MIN_CHUNKED_BYTES)).toBe(true);
        expect(shouldChunk(239233841)).toBe(true);
    });

    it('总长未知 ⇒ 不切（切片需要精确上界）', () => {
        expect(shouldChunk(-1)).toBe(false);
        expect(shouldChunk(Number.NaN)).toBe(false);
    });
});

describe('sumBytes / chunkedPercent 进度汇总', () => {
    it('坏值与负数被忽略', () => {
        expect(sumBytes([100, -5, Number.NaN, 50])).toBe(150);
        expect(sumBytes([])).toBe(0);
    });

    it('百分比夹在 0..100，总长未知返 null', () => {
        expect(chunkedPercent(50, 100)).toBe(50);
        expect(chunkedPercent(0, 100)).toBe(0);
        expect(chunkedPercent(100, 100)).toBe(100);
        expect(chunkedPercent(120, 100)).toBe(100);
        expect(chunkedPercent(-10, 100)).toBe(0);
        expect(chunkedPercent(50, 0)).toBeNull();
        expect(chunkedPercent(50, Number.NaN)).toBeNull();
    });

    it('向下取整：98.9% 不显示成 99%（差最后一口气时别虚报）', () => {
        expect(chunkedPercent(989, 1000)).toBe(98);
    });
});

describe('activeParallel 并发路数', () => {
    it('片数少于上限时按片数来（3 片别开 4 路）', () => {
        expect(activeParallel(1)).toBe(1);
        expect(activeParallel(3)).toBe(3);
        expect(activeParallel(10)).toBe(DOWNLOAD_PARALLEL);
    });

    it('坏值收敛成 1，不抛', () => {
        expect(activeParallel(0)).toBe(1);
        expect(activeParallel(-3)).toBe(1);
        expect(activeParallel(Number.NaN)).toBe(1);
    });

    it('并发上限是 4（实测 4 路拿 3.25 倍，再加会被限流打回 403）', () => {
        expect(DOWNLOAD_PARALLEL).toBe(4);
    });
});
