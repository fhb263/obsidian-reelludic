// 阅读器深链（pure/readerLink）：构造 / 解析 `obsidian://reelludic?action=jump&book=…&block=…`
//
// 为什么守这些：
//   ① 深链会**写进用户笔记**（摘抄头行）→ 一旦构造出脏值就永久留在笔记里
//   ② 解析端要**严格**：笔记里的链接点击会被本插件拦截，误判会把用户的普通链接也吞掉
//   ③ 参数必须编码：book/block 虽是插件内 id，但「不产出不可用链接」这条不能靠调用方自觉
import { describe, it, expect } from 'vitest';
import { READER_DEEP_LINK_PREFIX, readerDeepLink, parseReaderDeepLink, readerDeepLinkFromParams } from 'pure/readerLink';

describe('pure/readerLink readerDeepLink 构造', () => {
    it('标准形态：obsidian://reelludic?action=jump&book=…&block=…', () => {
        expect(readerDeepLink('e_123', 'bk456')).toBe('obsidian://reelludic?action=jump&book=e_123&block=bk456');
    });

    it('前缀常量与实际产出一致（解析端靠它判定归属）', () => {
        expect(readerDeepLink('a', 'b')?.startsWith(READER_DEEP_LINK_PREFIX)).toBe(true);
    });

    it('构造端一律编码（特殊字符不破坏查询串）；解析端白名单只认合法 id → 非 id 值拒收', () => {
        const url = readerDeepLink('a b&c', 'x=y#z');
        expect(url).toBe('obsidian://reelludic?action=jump&book=a%20b%26c&block=x%3Dy%23z');
        // 编码能正确还原，但 `[\w-]` 白名单会拒收 —— 这是**有意**的：真实 id 永远是 `bk…` / `e_…`，
        // 解析端放宽反而会让「误吞用户普通链接」的风险变大。
        expect(parseReaderDeepLink(url!)).toBeNull();
        // 真实 id 形态（含下划线）往返一致
        expect(parseReaderDeepLink(readerDeepLink('e_1789', 'bkmu5g97j1t5o0')!)).toEqual({ book: 'e_1789', block: 'bkmu5g97j1t5o0' });
    });

    it('空 / 纯空白 / 非字符串 → null（不产出不可用链接）', () => {
        expect(readerDeepLink('', 'bk1')).toBeNull();
        expect(readerDeepLink('   ', 'bk1')).toBeNull();
        expect(readerDeepLink('e1', '')).toBeNull();
        expect(readerDeepLink(undefined as unknown as string, 'bk1')).toBeNull();
        expect(readerDeepLink('e1', null as unknown as string)).toBeNull();
    });

    it('两端空白被去掉（防手抖写入带空格的 id）', () => {
        expect(readerDeepLink(' e1 ', ' bk1 ')).toBe('obsidian://reelludic?action=jump&book=e1&block=bk1');
    });
});

describe('pure/readerLink parseReaderDeepLink 解析', () => {
    it('往返一致', () => {
        const url = readerDeepLink('e_1789', 'bkmu5g97j1t5o0')!;
        expect(parseReaderDeepLink(url)).toEqual({ book: 'e_1789', block: 'bkmu5g97j1t5o0' });
    });

    it('🔴 只认本插件的链接：其它 scheme / 其它 obsidian 动作 / 前缀相近的假货一律 null', () => {
        expect(parseReaderDeepLink('https://example.com/?book=a&block=b')).toBeNull();
        expect(parseReaderDeepLink('obsidian://open?vault=v&file=note')).toBeNull();
        // 前缀相近但不是我们的 host（避免 `reelludicx` 被误认）
        expect(parseReaderDeepLink('obsidian://reelludicx?action=jump&book=a&block=b')).toBeNull();
        expect(parseReaderDeepLink('reelludic://jump?book=a&block=b')).toBeNull();
        expect(parseReaderDeepLink('')).toBeNull();
    });

    it('action 必须是 jump（缺 / 别的值 → null）', () => {
        expect(parseReaderDeepLink('obsidian://reelludic?book=a&block=b')).toBeNull();
        expect(parseReaderDeepLink('obsidian://reelludic?action=delete&book=a&block=b')).toBeNull();
    });

    it('🔴 脏值拒绝：id 只允许 [\\w-]（防把任意链接当深链吞掉 / 注入）', () => {
        expect(parseReaderDeepLink('obsidian://reelludic?action=jump&book=a&block=<script>')).toBeNull();
        expect(parseReaderDeepLink('obsidian://reelludic?action=jump&book=a%20b&block=c')).toBeNull();
        expect(parseReaderDeepLink('obsidian://reelludic?action=jump&book=a&block=b;rm')).toBeNull();
        expect(parseReaderDeepLink('obsidian://reelludic?action=jump&book=a&block=')).toBeNull();
    });

    it('大小写与多余参数不影响（Obsidian 可能归一化 host）', () => {
        expect(parseReaderDeepLink('obsidian://ReelLudic?action=jump&book=a&block=b&vault=x')).toEqual({ book: 'a', block: 'b' });
    });
});

// 🔴 2026-09-19 用户第三次报障的**真根因**（读 Obsidian 核心代码 + 用户日志确认，不是推测）：
//    Obsidian 的 URI 语义是 `obsidian://<action>?<params>` —— **host 就是 action**；分发器 `dispatch(e)` 会
//    `console.log("Received URL action", e)` 再 `e.action` 查 handler（app.js:2814566 附近）。用户日志里那行
//    `Received URL action {action: 'reelludic', entry: 'e_…', ep: '0', t: '430'}` 说明两件事：
//      ⑴ 我们的协议处理器**确实被调用了**（handler 存在，没走 msgInvalidUriAction）；
//      ⑵ 但链接里写的 `action=video` **被 host 名覆盖**（`action` 变成 `'reelludic'`）。
//    ⇒ 旧实现「把 params 拼回 URL 再交给 parseReaderDeepLink / parseTimeLink」必然两个都不认
//      （一个要求 `jump`、一个要求 `video`）→ **处理器静默什么都不做** = 用户看到的「点了不跳」。
//    ⇒ 正确做法：**按参数形状分派** —— `book`+`block` = 阅读器跳转；`entry` = 视频时间戳。**完全不看 action**。
describe('pure/readerLink readerDeepLinkFromParams（协议处理器入口 · 按形状分派）', () => {
    it('book + block 齐备即命中（不看 action 是什么）', () => {
        const want = { book: 'e_1', block: 'bk1' };
        // Obsidian 实际给过来的形态：action 已被改成 host 名
        expect(readerDeepLinkFromParams({ action: 'reelludic', book: 'e_1', block: 'bk1' })).toEqual(want);
        // 没有 action 也认
        expect(readerDeepLinkFromParams({ book: 'e_1', block: 'bk1' })).toEqual(want);
        // 旧形态（action 还是 jump）也要认 —— 用户笔记里**已经写好的**链接不能因为改解析就失效
        expect(readerDeepLinkFromParams({ action: 'jump', book: 'e_1', block: 'bk1' })).toEqual(want);
    });

    it('缺参数 / 脏值 → null（绝不吞掉别人的 action）', () => {
        expect(readerDeepLinkFromParams({ book: 'e_1' })).toBeNull();
        expect(readerDeepLinkFromParams({ block: 'bk1' })).toBeNull();
        expect(readerDeepLinkFromParams({ book: 'a b', block: 'bk1' })).toBeNull();
        expect(readerDeepLinkFromParams({ book: 'e_1', block: '<script>' })).toBeNull();
        expect(readerDeepLinkFromParams({ book: 'e_1', block: '' })).toBeNull();
        expect(readerDeepLinkFromParams({})).toBeNull();
    });

    it('空 / 非对象 / 怪值不崩（Obsidian 给的是对象，但不许假设）', () => {
        expect(readerDeepLinkFromParams(null)).toBeNull();
        expect(readerDeepLinkFromParams(undefined)).toBeNull();
        expect(readerDeepLinkFromParams({ book: { a: 1 }, block: 'bk1' } as unknown as Record<string, unknown>)).toBeNull();
        // 数字值按字符串处理（Obsidian 可能给出数字型参数）
        expect(readerDeepLinkFromParams({ book: 1, block: 2 })).toEqual({ book: '1', block: '2' });
    });
});
