/**
 * 字段映射（1.3.1 ①，2026-10-12）。
 *
 * ## 语法
 * 用户口径（参考 Media DB Plugin 的 Field Mapping）：
 *
 *     [原始属性名] -> [新属性名]
 *
 * 宽容处（都为了「用户手打」这个场景）：方括号可省、箭头两侧空格可省、全角 `→` 等价于 `->`、
 * 空行与 `#` 注释行跳过。
 *
 * ## 为什么有「集合级」校验
 * 行内错（拼错键名、非法字符）只丢**那一行**；但下面两类错会让「哪个键是哪个」**不可判定**，
 * 所以命中即**整批作废**：
 *   ① **链式**：`title -> year` 且 `year -> release` —— 源集合与目标集合相交，读写两侧都算不出终态；
 *   ② **占位**：`title -> status` —— 目标键抢了一个**未参与映射**的已登记键，那个字段就再也写不出自己的名字。
 *
 * ⚠️ 本模块**只管名字的换算**，不碰 YAML 的生成与解析（那两处是真源：`data/noteGenerator` /
 *    `pure/noteEditable`），也不管设置的持久化。纯函数，无 Obsidian 依赖。
 */
import { findMetaField, isMappableKey } from 'pure/metaFields';

export interface FieldMapEntry {
    /** 原始属性名（= 插件写出的 frontmatter 键） */
    from: string;
    /** 新属性名（用户想让它在笔记里叫什么） */
    to: string;
    /** 1 起的原始行号（供设置页就地指出「第几行错了」） */
    line: number;
}

export interface FieldMapParseResult {
    /** 可用的映射条目（已过全部校验） */
    entries: FieldMapEntry[];
    /** 面向用户的一行文案（均带「第 N 行」前缀）；集合级错误不带行号 */
    errors: string[];
}

/**
 * 目标键的合法形态：字母 / 数字 / 下划线 / 连字符 / 点 / 汉字。
 * ⛔ 不许空格、冒号、逗号、`#`、引号、方括号 —— 它们要么破坏 YAML，要么让 Obsidian 的属性面板解析错位。
 */
const KEY_RE = /^[A-Za-z0-9_.\-\u4e00-\u9fff]+$/;

/** 去掉一层方括号与两侧空白（方括号是可省的书写糖，不是语法必需） */
function strip(s: string): string {
    const t = s.trim();
    if (t.length >= 2 && t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).trim();
    return t;
}

/**
 * 解析映射文本。**不抛**（错误折进 `errors`）—— 设置页要边打边判，抛异常会让输入框直接崩。
 */
export function parseFieldMap(text: string): FieldMapParseResult {
    const errors: string[] = [];
    const raw: FieldMapEntry[] = [];
    const lines = String(text ?? '').split(/\r?\n/);

    lines.forEach((rawLine, i) => {
        const lineNo = i + 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) return;

        // 半角 `->` 优先；没有再看全角 `→`
        const sep = line.includes('->') ? '->' : line.includes('→') ? '→' : null;
        if (!sep) {
            errors.push(`第 ${lineNo} 行：缺少「->」，格式应为 [原始属性名] -> [新属性名]`);
            return;
        }
        const at = line.indexOf(sep);
        const from = strip(line.slice(0, at));
        const to = strip(line.slice(at + sep.length));

        if (!from || !to) {
            errors.push(`第 ${lineNo} 行：映射两侧都不能为空`);
            return;
        }
        if (!isMappableKey(from)) {
            // #613 起 `isMappableKey` = 「是否登记在本表内」⇒ 走到这里只可能是**拼错**
            //（原先还有一支「已登记但锁定」，随「全部可填」撤销）
            errors.push(`第 ${lineNo} 行：未知字段 ${from}`);
            return;
        }
        if (!KEY_RE.test(to)) {
            errors.push(`第 ${lineNo} 行：新属性名「${to}」含非法字符（不能有空格、冒号等）`);
            return;
        }
        if (from === to) {
            errors.push(`第 ${lineNo} 行：${from} 映射到自己没有意义`);
            return;
        }
        raw.push({ from, to, line: lineNo });
    });

    // 逐条校验：同一源键 / 同一目标键不许出现两次（后出现的那条报错，先出现的保留）
    const seenFrom = new Set<string>();
    const seenTo = new Set<string>();
    const entries: FieldMapEntry[] = [];
    for (const r of raw) {
        if (seenFrom.has(r.from)) {
            errors.push(`第 ${r.line} 行：${r.from} 上面已经映射过一次`);
            continue;
        }
        if (seenTo.has(r.to)) {
            errors.push(`第 ${r.line} 行：新属性名「${r.to}」已被占用`);
            continue;
        }
        seenFrom.add(r.from);
        seenTo.add(r.to);
        entries.push(r);
    }

    // 集合级：命中即整批作废（见文件头说明）
    // ⚠️ 注意 `clash` 这条**与「保护名单」无关**（那是 #613 已撤销的东西）—— 它拦的是
    //    「把 A 改名叫 B，而 B 本身也是一个没被映射的登记字段」⇒ 笔记里会写出**两个同名的键**。
    const mappedFrom = new Set(entries.map((e) => e.from));
    const chain = [...mappedFrom].filter((k) => seenTo.has(k));
    const clash = [...seenTo].filter((k) => !!findMetaField(k) && !mappedFrom.has(k));
    if (chain.length || clash.length) {
        for (const k of chain) errors.push(`「${k}」既是原属性名又是新属性名（链式映射无法判定终态）`);
        for (const k of clash) errors.push(`新属性名「${k}」已被未参与映射的字段占用`);
        return { entries: [], errors };
    }

    return { entries, errors };
}

/** 编译好的双向映射表（查找 O(1)） */
export interface CompiledFieldMap {
    /** 写侧：原键 → 新键 */
    forward: ReadonlyMap<string, string>;
    /** 读侧：新键 → 原键 */
    reverse: ReadonlyMap<string, string>;
}

/** ⚠️ 参数只要求 `from` / `to`（**不要** `line`）—— 编译不需要行号，调用方可以只给一对键 */
export function compileFieldMap(entries: readonly { from: string; to: string }[]): CompiledFieldMap {
    const forward = new Map<string, string>();
    const reverse = new Map<string, string>();
    for (const e of entries) {
        forward.set(e.from, e.to);
        reverse.set(e.to, e.from);
    }
    return { forward, reverse };
}

/** 从文本直达映射表（**忽略错误行**；错误文案另有 `parseFieldMap` 负责给用户看） */
export function compileFieldMapText(text: string): CompiledFieldMap {
    return compileFieldMap(parseFieldMap(text).entries);
}

/** 未配置映射时的缺省值 = 恒等映射 */
export const EMPTY_FIELD_MAP: CompiledFieldMap = { forward: new Map(), reverse: new Map() };

/** 写侧换算：落空（未映射的键）原样返回 */
export function mapForward(m: CompiledFieldMap, key: string): string {
    return m.forward.get(key) ?? key;
}

/** 读侧换算：落空原样返回 */
export function mapReverse(m: CompiledFieldMap, key: string): string {
    return m.reverse.get(key) ?? key;
}
