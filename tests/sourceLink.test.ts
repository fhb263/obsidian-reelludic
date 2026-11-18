// `pure/sourceLink.splitHintLinks` 的守卫测试。
//
// 这个拆分器不是「能跑就行」的工具函数 —— 它决定**设置页所有提示文案的显示文字**，
// 一旦切错，用户看到的描述会少字/串字，而且页面不会报错。所以下面每条都是「不改原文」的具体形态。
import { describe, expect, it } from 'vitest';
import { splitHintLinks } from 'pure/sourceLink';

/** 片段拼回去是否与原文逐字一致（最重要的一条不变量） */
function rejoin(parts: Array<{ text: string }>): string {
    return parts.map((p) => p.text).join('');
}

describe('splitHintLinks 不改变原文', () => {
    it('无域名：整段是一个文本片段', () => {
        const parts = splitHintLinks('特色：游戏库覆盖广，含平台、发售日与评分。');
        expect(parts).toHaveLength(1);
        expect(parts[0]).toEqual({ text: '特色：游戏库覆盖广，含平台、发售日与评分。', url: null });
    });

    it('空串与 null 安全', () => {
        expect(splitHintLinks('')).toEqual([]);
        expect(splitHintLinks(null as unknown as string)).toEqual([]);
        expect(splitHintLinks(undefined as unknown as string)).toEqual([]);
    });

    it('真实 hint 全文：拼回去逐字等于原文', () => {
        const hint =
            '获取：登录 douban.com 后按 F12，复制任意请求的 Cookie（含 dbcl2）。特色：中文条目最全，带评分、评价人数与简介。用途：返回书籍、游戏、音乐、影视、动画、漫画元数据；缺 Cookie 会 403。';
        expect(rejoin(splitHintLinks(hint))).toBe(hint);
    });
});

describe('splitHintLinks 识别域名', () => {
    it('裸域名补 https 前缀，展示文字仍是原样', () => {
        const parts = splitHintLinks('获取：登录 weread.qq.com 后按 F12。');
        expect(rejoin(parts)).toBe('获取：登录 weread.qq.com 后按 F12。');
        expect(parts).toHaveLength(3);
        expect(parts[1]).toEqual({ text: 'weread.qq.com', url: 'https://weread.qq.com' });
    });

    it('带路径的官网（steam 那种）整串成链接', () => {
        const parts = splitHintLinks('获取：Key 去 steamcommunity.com/dev/apikey 申请（32 位十六进制）。');
        expect(parts).toHaveLength(3);
        expect(parts[1]).toEqual({
            text: 'steamcommunity.com/dev/apikey',
            url: 'https://steamcommunity.com/dev/apikey',
        });
    });

    it('多级域名不被截断（console.cloud.google.com）', () => {
        const parts = splitHintLinks('获取：console.cloud.google.com 启用 Books API 后创建 API Key。');
        expect(parts[1]).toEqual({ text: 'console.cloud.google.com', url: 'https://console.cloud.google.com' });
    });

    it('一句里出现两个域名就切出两个链接', () => {
        const parts = splitHintLinks('先开 bgm.tv 再对 bgm.tv 授权。');
        const links = parts.filter((p) => p.url !== null);
        expect(links).toHaveLength(2);
        expect(links.every((l) => l.url === 'https://bgm.tv')).toBe(true);
    });
});

describe('splitHintLinks 不误判', () => {
    it('版本号不是域名（v1.5.0 / 1.0.2）', () => {
        expect(splitHintLinks('自 v1.5.0 起支持，兼容 1.0.2。').every((p) => p.url === null)).toBe(true);
    });

    it('数量与日期不是域名（1000 次/日、2026-10-31）', () => {
        expect(splitHintLinks('每天 1000 次，2026-10-31 更新。').every((p) => p.url === null)).toBe(true);
    });

    it('顶级域不在白名单的串不认（纯数据里的 x.newtld）', () => {
        expect(splitHintLinks('协议见 obsidian.localdoc 说明。').every((p) => p.url === null)).toBe(true);
    });

    it('单词中间不起链（zabc.com 不从 abc.com 处切）', () => {
        const parts = splitHintLinks('前缀zabc.com 收尾');
        // 因为前一个字符是字母，按边界规则整串都不该被单独切出「abc.com」
        expect(parts.every((p) => p.url === null || p.text === 'zabc.com')).toBe(true);
        expect(rejoin(parts)).toBe('前缀zabc.com 收尾');
    });

    it('连续调用互不污染（g 正则不复用 lastIndex）', () => {
        const a = splitHintLinks('访问 douban.com 看看');
        const b = splitHintLinks('访问 douban.com 看看');
        expect(a).toEqual(b);
    });
});
