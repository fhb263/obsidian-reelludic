import { describe, it, expect } from 'vitest';
import { stripFence, extractFirstJsonObject, parseAiJsonObject } from 'pure/aiJson';

// P1-3 补盲：`pure/aiJson` 原先没有同名测试。
// 它已被 `aiSummary` / `aiPrefill` 间接覆盖（围栏、前后夹杂文字），
// 但**括号配平算法的难分支一条都没测**——那正是最容易写错的地方。
describe('pure/aiJson 围栏剥离 stripFence', () => {
    it('无围栏 ⇒ 原样（仅去首尾空白）', () => {
        expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
    });

    it('```json 围栏 ⇒ 剥壳', () => {
        expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('无语言标注的 ``` 围栏也能剥', () => {
        expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('非字符串入参（运行时可能拿到 undefined/null）⇒ 空串', () => {
        expect(stripFence(undefined as unknown as string)).toBe('');
        expect(stripFence(null as unknown as string)).toBe('');
    });

    it('围栏内有换行的多行 JSON 不被压平', () => {
        expect(stripFence('```json\n{\n  "a": 1\n}\n```')).toBe('{\n  "a": 1\n}');
    });
});

describe('pure/aiJson 首个平衡对象 extractFirstJsonObject（难分支）', () => {
    it('没有 { ⇒ null', () => {
        expect(extractFirstJsonObject('no json here')).toBeNull();
    });

    it('括号未闭合 ⇒ null（⛔ 不返回半截）', () => {
        expect(extractFirstJsonObject('{"a":1')).toBeNull();
    });

    it('🔴 字符串内的花括号**不参与计数**', () => {
        // 这是配平算法最核心的正确性：若把字符串里的 { 也计数，会在这里提前截断。
        const text = '{"tpl":"a {b} c","x":1}';
        expect(extractFirstJsonObject(text)).toBe('{"tpl":"a {b} c","x":1}');
    });

    it('🔴 字符串内转义的引号不终止字符串', () => {
        const text = '{"q":"he said \\"hi\\"","x":2}';
        expect(extractFirstJsonObject(text)).toBe(text);
    });

    it('🔴 转义引号之后紧跟字符串内的 `}` —— 若转义未处理会提前截断', () => {
        // 这条是 escaped 分支的**唯一可观测差异输入**：
        // 不处理转义时，`\"` 里的 `"` 被当成字符串结束，随后的 `}` 让 depth 归零，
        // 于是提前返回非法片段 `{"tpl":"a\"}`。处理后 `}b` 属于字符串内容，正常配平。
        const text = '{"tpl":"a\\"}b","x":1}';
        expect(extractFirstJsonObject(text)).toBe(text);
        expect(parseAiJsonObject(text)).toEqual({ tpl: 'a"}b', x: 1 });
    });

    it('🔴 字符串内转义的反斜杠不误判为转义下一个字符', () => {
        // "a\\\\" 是 字符串结尾为两个反斜杠 —— 第二个反斜杠不应把收尾引号当转义。
        const text = '{"path":"C:\\\\tmp","x":3}';
        expect(extractFirstJsonObject(text)).toBe(text);
    });

    it('前后有解释文字 ⇒ 只取对象部分', () => {
        expect(extractFirstJsonObject('好的：{"a":1} 完毕')).toBe('{"a":1}');
    });

    it('嵌套对象正确配平', () => {
        expect(extractFirstJsonObject('{"a":{"b":{"c":1}}}')).toBe('{"a":{"b":{"c":1}}}');
    });

    it('前一个未闭合、后一个完整 ⇒ 从首个 { 起判，返回 null（不跳过）', () => {
        // 明确既有行为：算法只认**第一个** `{`，不做「换个起点再试」的猜测。
        expect(extractFirstJsonObject('{"broken": 1 and then {"ok":2}')).toBeNull();
    });
});

describe('pure/aiJson 不变式：extract 的结果必然以 `{` 开头', () => {
    it('返回值要么 null，要么首字符是 `{`（⇒ JSON.parse 永远拿不到数组/标量）', () => {
        // 这条不变式是 `parseAiJsonObject` 里 `Array.isArray(obj)` 守卫**不可达**的证明：
        // extract 的切片起点固定是首个 `{`，所以解析结果只可能是对象或抛错，
        // 绝不可能是数组/标量。该守卫是纯防御（防以后有人改 extract 的起点），
        // 因此它对应一个「存活突变」是**预期行为**，不是覆盖漏洞 —— 别为此硬凑用例。
        const inputs = [
            '{"a":1}',
            '[{"a":1}]',
            '解释 {"a":1} 尾巴',
            '{"a":1',
            'no json',
            '',
            '42',
            '"str"',
            'null',
        ];
        for (const input of inputs) {
            const got = extractFirstJsonObject(input);
            if (got !== null) expect(got.startsWith('{')).toBe(true);
        }
    });
});

describe('pure/aiJson 一站入口 parseAiJsonObject', () => {
    it('纯 JSON ⇒ 对象', () => {
        expect(parseAiJsonObject('{"a":1}')).toEqual({ a: 1 });
    });

    it('围栏 + 前后解释 ⇒ 对象', () => {
        expect(parseAiJsonObject('好的\n```json\n{"a":1}\n```\n希望有帮助')).toEqual({ a: 1 });
    });

    it('空 / null / undefined ⇒ null', () => {
        expect(parseAiJsonObject('')).toBeNull();
        expect(parseAiJsonObject('   ')).toBeNull();
        expect(parseAiJsonObject(null)).toBeNull();
        expect(parseAiJsonObject(undefined)).toBeNull();
    });

    it('数组 ⇒ null（只要对象）', () => {
        expect(parseAiJsonObject('[1,2]')).toBeNull();
    });

    it('🔴 既有行为：数组里含对象时，只认第一个 `{` ⇒ 返回内层对象（外壳被忽略）', () => {
        // 不是 bug 也不算特性 —— 是「只认第一个 `{`」这一策略的直接结果。
        // 锁住它有两个目的：① 明确 `Array.isArray` 守卫只在**无外层花括号**时不可达，
        // 这条路径能真正走到 `JSON.parse`；② 万一以后改成「优先整体解析」，
        // 这里会红，提醒改的人去核对调用方对数组回复的预期。
        expect(parseAiJsonObject('[{"a":1}]')).toEqual({ a: 1 });
        expect(parseAiJsonObject('模型说：[{"a":1},{"b":2}]')).toEqual({ a: 1 });
    });

    it('标量 / null 字面量 ⇒ null', () => {
        expect(parseAiJsonObject('42')).toBeNull();
        expect(parseAiJsonObject('null')).toBeNull();
        expect(parseAiJsonObject('"str"')).toBeNull();
    });

    it('🔴 以 { 开头但 JSON 非法 ⇒ null（不把坏 JSON 当正文）', () => {
        expect(parseAiJsonObject('{"a":1,,}')).toBeNull();
        expect(parseAiJsonObject('{a:1}')).toBeNull();
    });

    it('对象值为嵌套/数组时原样保留', () => {
        expect(parseAiJsonObject('{"a":[1,{"b":2}],"c":{"d":3}}')).toEqual({ a: [1, { b: 2 }], c: { d: 3 } });
    });
});
