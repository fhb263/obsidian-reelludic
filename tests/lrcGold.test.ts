// 🔴 m04435 ③：[Gold] 高光句解析（用户逐字：
//   「LRC歌词框支持 `[时间戳][Gold]歌词`，如 `[01:29.58][Gold]分手应该体面`。
//     【`[Gold]` 解析后从渲染歌词正文移除；一行多时间戳时作用于该行全部时间点】」
//
// 四组判据，任何一条塌陷都会让功能静默失效（编译器和旧测试都看不见）：
//  ⑴ 标记被正确**识别**（大小写不敏感）；
//  ⑵ 标记从正文里**剥干净**（否则用户会在屏幕上看到 `[Gold]` 字样）；
//  ⑶ 一行多时间戳 ⇒ 每个时间点都算高光；
//  ⑷ 没标记的行 `gold` 必须**不存在**（不是 `false`）—— 渲染层靠真假判断，别留下半态。
import { describe, expect, it } from 'vitest';
import { isLrcContent, parseLrc, parseLrcDocument } from 'pure/lrc';

const gold = (content: string) => parseLrcDocument(content).lines;

describe('🔴 m04435 ③ [Gold]：标记识别', () => {
    it('🔴 时间标签之后的 `[Gold]` 被认出来，正文不含标记', () => {
        const lines = gold('[01:29.58][Gold]分手应该体面');
        expect(lines).toHaveLength(1);
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('分手应该体面');
        expect(lines[0].text).not.toContain('Gold');
        expect(lines[0].text).not.toContain('[');
    });

    it('🔴 大小写不敏感：`[gold]` / `[GOLD]` 同样算高光', () => {
        expect(gold('[00:01.00][gold]甲')[0].gold).toBe(true);
        expect(gold('[00:01.00][GOLD]乙')[0].gold).toBe(true);
        expect(gold('[00:01.00][GoLd]丙')[0].gold).toBe(true);
    });

    it('🔴 标签**顺序无关**：先 `[Gold]` 后时间（用户手打时两种都可能）', () => {
        const lines = gold('[Gold][00:05.00]倒过来的写法');
        expect(lines).toHaveLength(1);
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('倒过来的写法');
    });

    it('🔴 没有 `[Gold]` 的行：`gold` 字段**不存在**（不是 false）', () => {
        const line = gold('[00:01.00]普通一句')[0];
        expect(line.gold).toBeUndefined();
        expect('gold' in line).toBe(false);
    });

    it('⚠️ 别的方括号标签照旧是正文（`[Chorus]` 不算高光，也不能被剥掉）', () => {
        const line = gold('[00:01.00][Chorus]副歌唱起来')[0];
        expect(line.gold).toBeUndefined();
        expect(line.text).toBe('[Chorus]副歌唱起来');
    });
});

describe('🔴 m04435 ③ [Gold]：一行多时间戳 ⇒ 每个时间点都是高光', () => {
    it('🔴 两个时间标签 + 一个 `[Gold]` ⇒ 两行、都带 gold、正文一致', () => {
        const lines = gold('[00:10.00][01:20.00][Gold]副歌复用这句');
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.gold === true)).toBe(true);
        expect(lines.every((l) => l.text === '副歌复用这句')).toBe(true);
        // 时间戳真的分开了（不是两行同刻）
        expect(lines[0].timestamp).not.toBe(lines[1].timestamp);
    });

    it('🔴 一条高光、一条普通混排：各归各的（互不污染）', () => {
        const lines = gold(
            ['[00:01.00][Gold]高光的那句', '[00:02.00]普通的那句'].join('\n'),
        );
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('高光的那句');
        expect(lines[1].gold).toBeUndefined();
        expect(lines[1].text).toBe('普通的那句');
    });

    it('⚠️ `[Gold]` 夹在时间标签中间也认（`[t][Gold][t]` 这种乱序手打）', () => {
        const lines = gold('[00:10.00][Gold][01:20.00]中间插标记');
        expect(lines).toHaveLength(2);
        expect(lines.every((l) => l.gold === true)).toBe(true);
        expect(lines.every((l) => l.text === '中间插标记')).toBe(true);
    });
});

describe('🔴 m04435 ③ [Gold]：⛔ 不破坏既有解析行为', () => {
    it('`[Gold]` 不影响时间戳解析（秒数照旧精确）', () => {
        const line = gold('[01:29.58][Gold]时间要对')[0];
        expect(line.timestamp).toBe(89_580);
        expect(line.timestr).toBe('01:29');
    });

    it('`[Gold]` 行仍会得到逐字词元（高亮靠它，⛔ 别因为金标就跳过）', () => {
        const line = gold('[00:01.00][Gold]一二三')[0];
        expect(line.words?.length).toBeGreaterThan(0);
        expect(line.words?.map((w) => w.text).join('')).toBe('一二三');
    });

    it('`[Gold]` + 双语译文一起用时两者都在（译文另起一行，金标只管原文）', () => {
        const line = gold('[00:01.00][Gold]原文 | 译文')[0];
        expect(line.gold).toBe(true);
        expect(line.text).toBe('原文');
        expect(line.annotation).toBe('译文');
    });

    it('`[offset:]` 与 `[Gold]` 并存时 offset 照旧生效', () => {
        const lines = gold(['[offset:500]', '[00:10.00][Gold]偏移那句'].join('\n'));
        // `+` = 整体提前 ⇒ 10s 的标签落到 9.5s
        expect(lines[0].timestamp).toBe(9_500);
        expect(lines[0].gold).toBe(true);
    });

    it('`isLrcContent` 对只有 `[Gold]` 没有时间的行不误判（⛔ 别把标记行当成歌词）', () => {
        expect(isLrcContent('[Gold]这行没有时间标签')).toBe(false);
        expect(isLrcContent('[00:01.00][Gold]这行是歌词')).toBe(true);
    });

    it('`parseLrc` 便捷别名与主入口口径一致（两处都带 gold）', () => {
        const lines = parseLrc('[00:01.00][Gold]别名也要认');
        expect(lines[0].gold).toBe(true);
        expect(lines[0].text).toBe('别名也要认');
    });
});
