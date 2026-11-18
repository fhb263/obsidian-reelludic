// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * 2026-11-11 用户 m05717 ② 的验收：
 *   「**同步数据**、**冲突处理**、**前置条件** 用**加粗**或者**主题色**显示，后面跟一个**全角冒号**」
 *
 * 分两层测：
 *   ① `pure/syncHint` —— 文案本体。用户给的是逐字表格，差一个标点都不算交付；
 *   ② `modals/syncHintView` —— 渲染。加粗必须是真 `<strong>`、冒号必须是全角、`**…**` 必须变加粗，
 *      这三件事只有真 DOM 才能验（字符串里看着对、页面上未必对）。
 */

/**
 * Obsidian 的 DOM 扩展方法，jsdom 没有。
 * ⚠️ 只在本文件补，不升格成全局 setup —— 替身越多越容易掩盖真实环境缺方法的问题。
 */
function patchDom(): void {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    if (typeof proto.appendText === 'function') return;
    proto.createDiv = function (this: HTMLElement, o?: { cls?: string }) {
        const d = document.createElement('div');
        if (o?.cls) d.className = o.cls;
        this.appendChild(d);
        return d;
    };
    proto.createEl = function (this: HTMLElement, tag: string, o?: { cls?: string; text?: string }) {
        const el = document.createElement(tag);
        if (o?.cls) el.className = o.cls;
        if (o?.text !== undefined) el.textContent = o.text;
        this.appendChild(el);
        return el;
    };
    proto.appendText = function (this: HTMLElement, t: string) {
        this.appendChild(document.createTextNode(t));
    };
}
patchDom();

import {
    SYNC_HINT_COLON,
    SYNC_HINT_LABELS,
    bangumiHintSections,
    doubanHintSections,
    musicHintSections,
    steamHintSections,
    tmdbHintSections,
    wereadHintSections,
    type SyncHintSection,
} from 'pure/syncHint';
import { renderSyncHint } from 'modals/syncHintView';

/** 六家同步源（音乐按「指定平台」和「通用入口」各算一份） */
const ALL: Array<{ name: string; sections: () => SyncHintSection[] }> = [
    { name: '豆瓣', sections: doubanHintSections },
    { name: '微信读书', sections: wereadHintSections },
    { name: 'TMDB', sections: tmdbHintSections },
    { name: 'Bangumi', sections: bangumiHintSections },
    { name: 'Steam', sections: steamHintSections },
    { name: '网易云（指定平台）', sections: () => musicHintSections('网易云音乐') },
];

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('三段标签与冒号（用户点名的三个词）', () => {
    it('顺序恒为 同步数据 → 冲突处理 → 前置条件', () => {
        expect(SYNC_HINT_LABELS).toEqual(['同步数据', '冲突处理', '前置条件']);
    });

    it('冒号是全角 `：`，不是半角 `:`', () => {
        expect(SYNC_HINT_COLON).toBe('：');
    });

    it.each(ALL)('$name 必须正好三段，且标签逐字一致', ({ sections }) => {
        const secs = sections();
        expect(secs.map((s) => s.label)).toEqual(['同步数据', '冲突处理', '前置条件']);
    });

    // ⛔ 反向守卫：『同步数据』这些词不得出现在正文里 —— 否则渲染出来会变成「标签 + 正文又说一遍」
    it.each(ALL)('$name 的正文不得自带标签词或冒号', ({ sections }) => {
        for (const sec of sections()) {
            expect(sec.body).not.toContain('同步数据：');
            expect(sec.body).not.toContain('冲突处理：');
            expect(sec.body).not.toContain('前置条件：');
            // 冒号由渲染层补；正文自带就会被渲染成「：：」
            expect(sec.body).not.toMatch(/^(同步数据|冲突处理|前置条件)：/);
        }
    });

    it.each(ALL)('$name 的三段正文都不为空', ({ sections }) => {
        for (const sec of sections()) expect(sec.body.trim().length).toBeGreaterThan(0);
    });
});

describe('各源文案要点（用户表格逐字要点）', () => {
    it('豆瓣：全类型 + 已存在跳过 + Cookie', () => {
        const [data, conflict, pre] = doubanHintSections();
        expect(data.body).toContain('影、视、书、音、游戏');
        expect(conflict.body).toContain('自动跳过');
        expect(pre.body).toContain('豆瓣');
        expect(pre.body).toContain('Cookie');
    });

    it('微信读书：书架 + 同名跳过 + Cookie', () => {
        const [data, conflict, pre] = wereadHintSections();
        expect(data.body).toContain('书架');
        expect(conflict.body).toContain('同名');
        expect(pre.body).toContain('Cookie');
    });

    it('TMDB：Watchlist + Favorites + API Key 与 Access Token', () => {
        const [data, , pre] = tmdbHintSections();
        expect(data.body).toContain('Watchlist');
        expect(data.body).toContain('Favorites');
        expect(data.body).toContain('电影与剧集');
        expect(pre.body).toContain('API Key');
        expect(pre.body).toContain('eyJ');
    });

    it('Bangumi：想看 / 在看 / 看过 + Access Token', () => {
        const [data, , pre] = bangumiHintSections();
        expect(data.body).toContain('想看 / 在看 / 看过');
        expect(pre.body).toContain('Access Token');
    });

    it('Steam：游戏库含游玩时长 + 愿望单 + 覆盖面窄且不动本地数据', () => {
        const [data, conflict, pre] = steamHintSections();
        expect(data.body).toContain('游玩时长');
        expect(data.body).toContain('愿望单');
        expect(conflict.body).toContain('Steam 来源');
        expect(conflict.body).toContain('不影响');
        expect(pre.body).toContain('SteamID');
        expect(pre.body).toContain('公开可见');
    });

    it('音乐：歌单 + 我喜欢的音乐 + 歌单名进标签 + Cookie 失效可重读', () => {
        const [data, conflict, pre] = musicHintSections('QQ音乐');
        expect(data.body).toContain('QQ音乐 账号');
        expect(data.body).toContain('我喜欢的音乐');
        expect(data.body).toContain('标签');
        expect(conflict.body).toContain('歌手');
        expect(pre.body).toContain('Cookie');
        expect(pre.body).toContain('重新读取');
    });

    it('音乐：通用入口（无平台名）不得出现具体平台名', () => {
        const [data] = musicHintSections(null);
        expect(data.body).toContain('平台账号');
        expect(data.body).not.toContain('网易云');
        expect(data.body).not.toContain('QQ音乐');
        // ⛔ 反向守卫：不能退化成 `null 账号` 这种东西
        expect(data.body).not.toContain('null');
    });
});

describe('渲染：加粗 + 全角冒号', () => {
    it('每个标签渲染成真 <strong>，不是普通文本', () => {
        const host = document.createElement('div');
        renderSyncHint(host, doubanHintSections());
        const strongs = host.querySelectorAll('strong.rl-wshelf-hint-label');
        expect(strongs).toHaveLength(3);
        expect(Array.from(strongs).map((s) => s.textContent)).toEqual(['同步数据', '冲突处理', '前置条件']);
    });

    it('三段各占一行（三个 .rl-wshelf-hint-line）', () => {
        const host = document.createElement('div');
        renderSyncHint(host, steamHintSections());
        expect(host.querySelectorAll('.rl-wshelf-hint-line')).toHaveLength(3);
    });

    it('全角冒号紧跟在标签后面（不是正文开头）', () => {
        const host = document.createElement('div');
        renderSyncHint(host, bangumiHintSections());
        const line = host.querySelectorAll('.rl-wshelf-hint-line')[0];
        // 第一段的节点序：<strong>同步数据</strong> + 文本「：」 + 正文
        const strong = line.querySelector('strong');
        expect(strong?.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
        expect((strong?.nextSibling as Text).data).toBe('：');
    });

    it('整行文本形如「同步数据：xxx」', () => {
        const host = document.createElement('div');
        renderSyncHint(host, tmdbHintSections());
        const text = host.querySelectorAll('.rl-wshelf-hint-line')[0].textContent ?? '';
        expect(text.startsWith('同步数据：')).toBe(true);
    });

    it('正文里的 `**不影响**` 渲染成 <strong>，且星号本身不残留', () => {
        const host = document.createElement('div');
        renderSyncHint(host, steamHintSections());
        const line = host.querySelectorAll('.rl-wshelf-hint-line')[1];
        const strongs = line.querySelectorAll('strong');
        // 第 0 个是标签，第 1 个是「不影响」
        expect(strongs).toHaveLength(2);
        expect(strongs[1].textContent).toBe('不影响');
        expect(line.textContent ?? '').not.toContain('**');
    });

    it('落单的 `*` 不吞字符（只认成对 `**`）', () => {
        const host = document.createElement('div');
        renderSyncHint(host, [{ label: '同步数据', body: 'a**b' }]);
        const line = host.querySelector('.rl-wshelf-hint-line') as HTMLElement;
        // `a**b` 切成 ['a', 'b'] —— 奇数下标那段加粗，但没配对的另一半不会被吃掉
        expect(line.textContent).toBe('同步数据：ab');
    });
});
