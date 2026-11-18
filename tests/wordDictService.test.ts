import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDictCache, lookupWordInDict, type DictDeps } from 'services/wordDict';

const CSV = ['apple,ˈæpl,n. 苹果', 'book,bʊk,n. 书', 'zebra,,n. 斑马'].join('\n');

/** 可编程的假磁盘：读盘次数可断言，用来证明索引真的被缓存了 */
function deps(init: { size?: number; mtime?: number; text?: string; missing?: boolean } = {}) {
    const st = {
        reads: 0,
        stats: 0,
        size: init.missing ? -1 : (init.size ?? CSV.length),
        mtime: init.mtime ?? 1000,
        text: init.text ?? CSV,
        fail: false,
    };
    const d: DictDeps = {
        size: () => {
            st.stats += 1;
            return st.size;
        },
        mtime: () => st.mtime,
        readText: () => {
            st.reads += 1;
            if (st.fail) throw new Error('boom');
            return st.text;
        },
    };
    return { d, st };
}

describe('lookupWordInDict', () => {
    beforeEach(() => {
        clearDictCache();
    });

    it('命中时返回词条与音标', () => {
        const { d } = deps();
        const r = lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(r.entry).toEqual({ word: 'apple', phonetic: 'ˈæpl', def: 'n. 苹果' });
        expect(r.reason).toBe('');
    });

    it('查不到时给 null 且不报原因（安静失败）', () => {
        const { d } = deps();
        const r = lookupWordInDict(d, '/x/dict.csv', 'qqqq');
        expect(r.entry).toBeNull();
        expect(r.reason).toBe('');
    });

    it('没配路径：不读盘、给原因', () => {
        const { d, st } = deps();
        const r = lookupWordInDict(d, '   ', 'apple');
        expect(r.entry).toBeNull();
        expect(r.reason).toBe('还没有配置本地词典');
        expect(st.reads).toBe(0);
        expect(st.stats).toBe(0);
    });

    it('文件不存在：给原因', () => {
        const { d } = deps({ missing: true });
        const r = lookupWordInDict(d, '/x/none.csv', 'apple');
        expect(r.reason).toBe('找不到词典文件');
    });

    it('文件过大：拒绝读取（⛔ 不把 2GB 文件读进内存）', () => {
        const { d, st } = deps({ size: 200 * 1024 * 1024 });
        const r = lookupWordInDict(d, '/x/big.csv', 'apple');
        expect(r.reason).toContain('MB');
        expect(st.reads).toBe(0);
    });

    it('读盘抛错：给原因且清掉旧缓存', () => {
        const { d, st } = deps();
        const first = lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(first.entry).not.toBeNull();
        st.fail = true;
        st.mtime = 2000; // 让缓存失效，逼它重读
        const r = lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(r.entry).toBeNull();
        expect(r.reason).toBe('读取词典文件失败');
    });

    it('同一份文件只读一次（索引被缓存）', () => {
        const { d, st } = deps();
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        lookupWordInDict(d, '/x/dict.csv', 'book');
        lookupWordInDict(d, '/x/dict.csv', 'zebra');
        expect(st.reads).toBe(1);
    });

    it('路径变了就重读', () => {
        const { d, st } = deps();
        lookupWordInDict(d, '/x/a.csv', 'apple');
        lookupWordInDict(d, '/x/b.csv', 'apple');
        expect(st.reads).toBe(2);
    });

    it('文件大小变了就重读（用户替换了词典）', () => {
        const { d, st } = deps();
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        st.size = CSV.length + 100;
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(st.reads).toBe(2);
    });

    it('修改时间变了就重读（同大小重写也能跟上）', () => {
        const { d, st } = deps();
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        st.mtime = 9999;
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(st.reads).toBe(2);
    });

    it('大小与时间都没变：不重读', () => {
        const { d, st } = deps();
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        lookupWordInDict(d, '/x/dict.csv', 'apple');
        expect(st.reads).toBe(1);
    });

    it('路径首尾空白被 trim（用户粘路径常带空格）', () => {
        const { d } = deps();
        const r = lookupWordInDict(d, '  /x/dict.csv  ', 'apple');
        expect(r.entry?.def).toBe('n. 苹果');
    });
});
