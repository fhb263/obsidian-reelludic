/**
 * `pure/lrcBilingual` 单测（#507）—— 双语歌词的**拆行 / 解析 / 合并**。
 * 🔴 这一批最重要的事：**时间标签一个字不动**、**行数对齐**、**幂等**。
 * 夹具用真 LRC 形态（`[00:15.16]` / 多时间标签 / 元信息行 / 纯符号行 / 全角内容）。
 */
import { describe, expect, it } from 'vitest';
import {
    buildLrcBilingualBatch,
    buildLrcBilingualBody,
    collectLrcTranslatable,
    lrcTranslatableCount,
    mergeBilingualLrc,
    parseLrcBilingualReply,
    LRC_BILINGUAL_BATCH,
    LRC_BILINGUAL_SEP,
} from 'pure/lrcBilingual';

/** 一段典型 LRC：元信息 + 两行词 + 空行 + 纯符号行（间奏） */
const SRC = [
    '[ar:周杰伦]',
    '[ti:晴天]',
    '[00:00.00]',
    '[00:15.16]hello world',
    '[00:20.00]',
    '[00:25.30]♪',
    '[00:30.00][01:10.00]same line twice',
    '[01:20.00]你好',
].join('\n');

describe('collectLrcTranslatable', () => {
    it('只挑「有时间标签 + 有歌词正文」的行，并带回**行下标**', () => {
        const rows = collectLrcTranslatable(SRC);
        expect(rows.map((r) => r.index)).toEqual([3, 6, 7]);
        expect(rows.map((r) => r.text)).toEqual(['hello world', 'same line twice', '你好']);
    });

    it('元信息行（[ar:] / [ti:]）**不匹配**时间标签 ⇒ 天然不动', () => {
        expect(collectLrcTranslatable('[ar:周杰伦]\n[ti:晴天]')).toEqual([]);
    });

    it('时间标签后没正文的行跳过（`[00:00.00]` / 空行）', () => {
        expect(collectLrcTranslatable('[00:00.00]\n\n[00:01.00] ')).toEqual([]);
    });

    it('纯符号行跳过（`♪` / `...` / `---`）—— 翻它没意义，还会浪费一次请求', () => {
        expect(collectLrcTranslatable('[00:25.30]♪\n[00:26.00]...\n[00:27.00]———')).toEqual([]);
    });

    it('🔴 已有译文的行跳过（幂等：再点一次不会变成 `a | b | c`）', () => {
        expect(collectLrcTranslatable('[00:15.16]hello | 你好')).toEqual([]);
        expect(lrcTranslatableCount('[00:15.16]hello | 你好')).toBe(0);
    });

    it('一行挂多个时间标签 ⇒ 算一行（译文只挂一次）', () => {
        const rows = collectLrcTranslatable('[00:30.00][01:10.00]same line twice');
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe('same line twice');
    });

    it('日文 / 韩文也算「歌词正文」（`\\p{L}` 覆盖假名与谚文）', () => {
        expect(collectLrcTranslatable('[00:01.00]ありがとう')).toHaveLength(1);
        expect(collectLrcTranslatable('[00:01.00]감사합니다')).toHaveLength(1);
    });

    it('空串 / undefined / null ⇒ 空数组（⛔ 不抛异常）', () => {
        expect(collectLrcTranslatable('')).toEqual([]);
        expect(collectLrcTranslatable(undefined as unknown as string)).toEqual([]);
        expect(collectLrcTranslatable(null as unknown as string)).toEqual([]);
    });
});

describe('buildLrcBilingualBatch', () => {
    it('带行号拼用户消息（行号只为让模型对齐，解析侧靠位置回填）', () => {
        const rows = collectLrcTranslatable(SRC);
        const b = buildLrcBilingualBatch(rows);
        expect(b.indexes).toEqual([3, 6, 7]);
        expect(b.userText).toBe('1. hello world\n2. same line twice\n3. 你好');
    });

    it(`一次最多 ${LRC_BILINGUAL_BATCH} 行（超长歌词分批，避免模型漏行）`, () => {
        const many = Array.from({ length: LRC_BILINGUAL_BATCH + 20 }, (_, i) => ({ index: i, text: `line ${i}` }));
        const b = buildLrcBilingualBatch(many);
        expect(b.indexes).toHaveLength(LRC_BILINGUAL_BATCH);
        expect(b.indexes[0]).toBe(0);
    });
});

describe('buildLrcBilingualBody', () => {
    it('system 用**内置**那份提示词（逐行契约），user 带歌曲上下文 + 行号', () => {
        const b = buildLrcBilingualBatch([{ index: 0, text: 'hello' }]);
        const body = buildLrcBilingualBody(b, 'zhipu', undefined, { title: '晴天', artist: '周杰伦' });
        expect(body.messages[0].role).toBe('system');
        expect(body.messages[0].content).toContain('行数必须与输入**完全一致**');
        expect(body.messages[1].content).toContain('晴天 - 周杰伦');
        expect(body.messages[1].content).toContain('1. hello');
        expect(body.model).toBeTruthy();
    });

    it('没给歌名 / 歌手 ⇒ 不带那行（⛔ 不编占位）', () => {
        const b = buildLrcBilingualBatch([{ index: 0, text: 'hello' }]);
        const body = buildLrcBilingualBody(b, 'zhipu');
        expect(body.messages[1].content).not.toContain('歌曲：');
    });
});

describe('parseLrcBilingualReply', () => {
    it('JSON（提示词要的形态）', () => {
        expect(parseLrcBilingualReply('{"lines":["你好，世界","再一次"]}')).toEqual(['你好，世界', '再一次']);
    });

    it('带 ```json 围栏 / 前后解释也能取出来（模型爱这么干）', () => {
        expect(parseLrcBilingualReply('好的：\n```json\n{"lines":["甲","乙"]}\n```\n以上。')).toEqual(['甲', '乙']);
    });

    it('模型直接给数组也行', () => {
        expect(parseLrcBilingualReply('["甲","乙"]')).toEqual(['甲', '乙']);
    });

    it('字段名换成 translations / result 也认（⛔ 别只认 lines）', () => {
        expect(parseLrcBilingualReply('{"translations":["甲"]}')).toEqual(['甲']);
        expect(parseLrcBilingualReply('{"result":["乙"]}')).toEqual(['乙']);
    });

    it('🔴 不是 JSON ⇒ 按**纯文本逐行**兜底（⛔ 别整批作废）', () => {
        expect(parseLrcBilingualReply('你好，世界\n再一次')).toEqual(['你好，世界', '再一次']);
    });

    it('兜底路径要剥掉模型自己加的行号与包裹引号', () => {
        expect(parseLrcBilingualReply('1. 你好\n2、再一次\n3) "第三句"')).toEqual(['你好', '再一次', '第三句']);
    });

    it('空 / 全空白 ⇒ 空数组', () => {
        expect(parseLrcBilingualReply('')).toEqual([]);
        expect(parseLrcBilingualReply('   \n  ')).toEqual([]);
    });
});

describe('mergeBilingualLrc', () => {
    it('🔴 译文按 ` | ` 接在该行原文之后，**时间标签一个字不动**', () => {
        const out = mergeBilingualLrc(SRC, ['你好，世界', '同一句唱两遍', '你好']);
        const lines = out.text.split('\n');
        expect(lines[0]).toBe('[ar:周杰伦]');
        expect(lines[1]).toBe('[ti:晴天]');
        expect(lines[2]).toBe('[00:00.00]');
        expect(lines[3]).toBe(`[00:15.16]hello world${LRC_BILINGUAL_SEP}你好，世界`);
        expect(lines[5]).toBe('[00:25.30]♪'); // 纯符号行不动
        expect(lines[6]).toBe(`[00:30.00][01:10.00]same line twice${LRC_BILINGUAL_SEP}同一句唱两遍`);
        expect(lines[7]).toBe(`[01:20.00]你好${LRC_BILINGUAL_SEP}你好`);
        expect(out.applied).toBe(3);
        expect(out.missing).toBe(0);
    });

    it('🔴 行数与原文字节级对齐（只有正文尾部被改写）', () => {
        const out = mergeBilingualLrc(SRC, ['a', 'b', 'c']);
        expect(out.text.split('\n')).toHaveLength(SRC.split('\n').length);
    });

    it('译文比待译行少 ⇒ 缺的那些**原样保留**并计入 `missing`（⛔ 不填占位符、⛔ 不错位）', () => {
        const out = mergeBilingualLrc(SRC, ['你好，世界']);
        expect(out.applied).toBe(1);
        expect(out.missing).toBe(2);
        expect(out.text).toContain('[00:15.16]hello world | 你好，世界');
        expect(out.text).toContain('[00:30.00][01:10.00]same line twice\n'); // 没被改
    });

    it('译文里有空串 / 空白 ⇒ 当作「没拿到」，该行不动（⛔ 不许产出 `原文 | ` 这种半截）', () => {
        const out = mergeBilingualLrc(SRC, ['', '   ', '你好']);
        expect(out.applied).toBe(1);
        expect(out.missing).toBe(2);
        expect(out.text.includes('hello world |')).toBe(false);
        expect(out.text.includes('hello world '.trim() + ' \n')).toBe(false);
    });

    it('译文比待译行多 ⇒ 多余的丢掉（不影响原文）', () => {
        const out = mergeBilingualLrc(SRC, ['a', 'b', 'c', 'd', 'e']);
        expect(out.applied).toBe(3);
        expect(out.missing).toBe(0);
    });

    it('🔴 幂等：对已经双语的文本再跑一遍 ⇒ 什么都不做', () => {
        const once = mergeBilingualLrc(SRC, ['你好，世界', '同一句唱两遍', '你好']);
        const twice = mergeBilingualLrc(once.text, ['X', 'Y', 'Z']);
        expect(twice.applied).toBe(0);
        expect(twice.text).toBe(once.text);
    });

    it('空 LRC / 没有可译行 ⇒ 原文原样返回（applied 0）', () => {
        expect(mergeBilingualLrc('', ['a']).text).toBe('');
        expect(mergeBilingualLrc('[ti:x]', ['a']).applied).toBe(0);
    });
});
