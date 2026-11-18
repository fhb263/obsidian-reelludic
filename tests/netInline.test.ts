import { describe, expect, it } from 'vitest';
import {
    canPlayNetInline,
    netEmbedFailText,
    netEmbedFallbackUrl,
    netEmbedSourceOf,
    netEmbedTitleOf,
    netOfficialEmbed,
} from 'pure/netInline';
import { canEmbedBili } from 'pure/biliEmbed';

/**
 * `canPlayNetInline` = 「这条链接值不值得进内置播放器去**试**取流」的**唯一判据**。
 *
 * 🔴 为什么这个文件必须存在（2026-10-31 用户报障）：「关联入口填了油管的链接还是跳转网页啊」。
 *    病根是四个闸门各自手写 `canEmbedBili(url)`，而 `canEmbedBili` 只认 B 站 iframe 地址。
 *    把判据收敛成一个函数之后，这条测试就是那四个闸门的**共同守卫**：
 *    只要它红了，说明「YouTube 又掉回开浏览器」的坑被重新挖开了。
 */

describe('canPlayNetInline', () => {
    it('B 站链接 ⇒ true（沿用 canEmbedBili 的全部判定）', () => {
        expect(canPlayNetInline('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
        expect(canPlayNetInline('https://www.bilibili.com/bangumi/play/ep123456')).toBe(true);
    });

    it('YouTube 链接 ⇒ true（本轮新增能力，⛔ 别退化）', () => {
        // 覆盖 isYouTubeUrl 认的三种形态：watch?v= / youtu.be 短链 / shorts
        expect(canPlayNetInline('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
        expect(canPlayNetInline('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
        expect(canPlayNetInline('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
        // 移动端与 music 子域也必须算
        expect(canPlayNetInline('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
        expect(canPlayNetInline('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('不可内联的链接 ⇒ false（这些必须老实开浏览器）', () => {
        expect(canPlayNetInline('https://example.com/video.mp4')).toBe(false);
        expect(canPlayNetInline('https://vimeo.com/123456')).toBe(false);
        // 裸片号不是 URL —— B 站那条也不认它
        expect(canPlayNetInline('1')).toBe(false);
    });

    it('脏输入 ⇒ false 而不抛（宿主拿到的可能是 undefined/空串/非字符串）', () => {
        expect(canPlayNetInline('')).toBe(false);
        expect(canPlayNetInline(null)).toBe(false);
        expect(canPlayNetInline(undefined)).toBe(false);
        expect(canPlayNetInline(42)).toBe(false);
        expect(canPlayNetInline({})).toBe(false);
    });

    it('⛔ 与 canEmbedBili 的分工不许被合并：YouTube 只能进 canPlayNetInline', () => {
        // 这条是**反向守卫**。若有人图省事把 YouTube 塞进 canEmbedBili / biliEmbedUrl，
        // 取流失败时就会去拼一个 `<iframe src="https://www.youtube.com/embed/…">` ——
        // 而这台机器上那个地址网络不可达（见 src/pure/biliEmbed.ts 文件头的真机实测），
        // 用户会看到一个永远转圈的白框。这一断言挡住那次"顺手合并"。
        const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        expect(canPlayNetInline(yt)).toBe(true);
        expect(canEmbedBili(yt)).toBe(false);
    });
});

/**
 * `netOfficialEmbed` = 设置项「网络集用插件播放器」**关闭**时，官方 iframe 该指向哪。
 *
 * 🔴 为什么值得单测（2026-10-31 用户逐字）：「在设置页内置播放器下加个启用则用插件的播放器
 *    播放网络集，不启用则用官方内嵌iframe播放」。
 *    这条是**用户主动选的第二条播法**，不是兜底 —— 拼错一个字符用户就会看到一块白，
 *    而它又完全由纯字符串逻辑决定，最适合在单测里钉死。
 */
describe('netOfficialEmbed', () => {
    it('B 站 ⇒ 官方 player.bilibili.com 地址（沿用 biliEmbedUrl，⛔ 不另拼一套）', () => {
        const r = netOfficialEmbed('https://www.bilibili.com/video/BV1xx411c7mD');
        expect(r).not.toBeNull();
        expect(r?.label).toBe('B站');
        expect(r?.embedUrl).toContain('player.bilibili.com');
        expect(r?.embedUrl).toContain('BV1xx411c7mD');
    });

    it('YouTube ⇒ youtube.com/embed/<id>（本轮新增的官方路，⛔ 别退化）', () => {
        const r1 = netOfficialEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(r1?.label).toBe('YouTube');
        expect(r1?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');

        // youtu.be 短链与 shorts 必须拼出**同一个** embed 地址（id 才是唯一键）
        expect(netOfficialEmbed('https://youtu.be/dQw4w9WgXcQ')?.embedUrl).toBe(r1?.embedUrl);
        expect(netOfficialEmbed('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.embedUrl).toBe(r1?.embedUrl);
    });

    it('拼不出官方地址 ⇒ null（调用方据此退回取流，⛔ 不许留白框）', () => {
        expect(netOfficialEmbed('https://example.com/video.mp4')).toBeNull();
        expect(netOfficialEmbed('https://vimeo.com/123456')).toBeNull();
        // 短链没有片号 ⇒ biliEmbedUrl 给 null，这里也必须给 null（而不是拼个空 bvid）
        expect(netOfficialEmbed('https://b23.tv/abcdefg')).toBeNull();
    });

    it('脏输入 ⇒ null 而不抛', () => {
        expect(netOfficialEmbed('')).toBeNull();
        expect(netOfficialEmbed(null)).toBeNull();
        expect(netOfficialEmbed(undefined)).toBeNull();
        expect(netOfficialEmbed(42)).toBeNull();
        expect(netOfficialEmbed({})).toBeNull();
    });

    it('🔴 与 canPlayNetInline 的分工：能进内置播放态 ≠ 有官方地址', () => {
        // 这条守的是「两条播法并存」这个结构。B 站两边都真、YouTube 只在插件播放器那条路上
        // 「能播」—— 官方地址拼得出来，但本机能不能连通是另一回事（见 pure/biliEmbed.ts 文件头）。
        const bili = 'https://www.bilibili.com/video/BV1xx411c7mD';
        expect(canPlayNetInline(bili)).toBe(true);
        expect(netOfficialEmbed(bili)).not.toBeNull();

        const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
        expect(canPlayNetInline(yt)).toBe(true);
        expect(netOfficialEmbed(yt)).not.toBeNull();
        // 但 YouTube **仍然**不能进 canEmbedBili —— 那条是自动兜底，不能自动去连一个可能不通的 iframe
        expect(canEmbedBili(yt)).toBe(false);
    });
});

/**
 * 🔴 2026-11-25 用户逐字：「恢复youtube在内嵌iframe的调用」，追问后选定
 *    「保持 iframe，我自己在系统层挂代理」。
 *
 * 这四条函数是那次裁定的**可交付部分**：网络层一个字没改（iframe 不吃插件里的 ytProxy），
 * 交付的是「挂上去的是谁家的播放器 / 白屏时怎么解释 / 有没有备用域名可退」。
 * 全是纯字符串逻辑，最适合在单测里钉死 —— 界面文案一错，用户就会以为插件坏了。
 */
describe('netEmbedSourceOf（标题/文案/备用域名的共同判据）', () => {
    it('B 站 ⇒ bili；YouTube 各形态 ⇒ youtube', () => {
        expect(netEmbedSourceOf('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bili');
        expect(netEmbedSourceOf('https://www.bilibili.com/bangumi/play/ep123456')).toBe('bili');
        expect(netEmbedSourceOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
        expect(netEmbedSourceOf('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
        expect(netEmbedSourceOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
    });

    it('⛔ 判据必须与 netOfficialEmbed 同进同出（拼不出地址就必须 null）', () => {
        // 不一致的后果很具体：界面出现「标题说 B 站、地址是 YouTube」这种自相矛盾。
        for (const u of [
            'https://example.com/video.mp4',
            'https://vimeo.com/123456',
            'https://b23.tv/abcdefg',
            '',
            null,
            undefined,
            42,
            {},
        ]) {
            expect(netEmbedSourceOf(u)).toBeNull();
            expect(netOfficialEmbed(u)).toBeNull();
        }
    });
});

describe('netEmbedTitleOf（挂的是谁家的官方播放器）', () => {
    it('YouTube ⇒ 写 YouTube，⛔ 不许沿用「B 站内嵌」那句话术', () => {
        expect(netEmbedTitleOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('YouTube 官方播放器');
        // 「取流失败兜底」那个旧标题属于已删除的内置播放器，绝不能出现在 YouTube 上
        expect(netEmbedTitleOf('https://youtu.be/dQw4w9WgXcQ')).not.toContain('B 站');
        expect(netEmbedTitleOf('https://youtu.be/dQw4w9WgXcQ')).not.toContain('兜底');
    });

    it('B 站 ⇒ 写 B 站', () => {
        expect(netEmbedTitleOf('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('B 站官方播放器');
    });

    it('拼不出 ⇒ 中性兜底标题（不撒谎）', () => {
        expect(netEmbedTitleOf('https://example.com/v')).toBe('官方播放器');
        expect(netEmbedTitleOf(null)).toBe('官方播放器');
    });
});

describe('netEmbedFailText（白屏时必须说清为什么）', () => {
    it('YouTube ⇒ 必须点明「系统层代理」与「插件里的代理管不到这里」', () => {
        // 这两点是用户最自然的误解来源：设置页明明有个 YouTube 代理，却对 iframe 无效。
        const t = netEmbedFailText('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(t).toContain('YouTube');
        expect(t).toContain('系统层');
        expect(t).toContain('管不到');
    });

    it('B 站 ⇒ 说网络或站外播放（⛔ 别把 YouTube 的代理话术贴到 B 站上）', () => {
        const t = netEmbedFailText('https://www.bilibili.com/video/BV1xx411c7mD');
        expect(t).toContain('B 站');
        expect(t).not.toContain('系统层');
    });

    it('认不出的地址也有一句话，⛔ 不许返回空串（空提示 = 白屏）', () => {
        const t = netEmbedFailText('https://example.com/v');
        expect(t.length).toBeGreaterThan(0);
        expect(netEmbedFailText(null).length).toBeGreaterThan(0);
    });
});

describe('netEmbedFallbackUrl（失败后自动重试一次）', () => {
    it('YouTube ⇒ 同 id 换 youtube-nocookie 域（主域被墙时有时仍在白名单）', () => {
        const f = netEmbedFallbackUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(f).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
        // 短链/shorts 必须退到**同一个**备用地址（id 才是唯一键）
        expect(netEmbedFallbackUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(f);
        expect(netEmbedFallbackUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(f);
    });

    it('⛔ B 站与认不出的地址都不给备用（多闪一次白没有任何收益）', () => {
        expect(netEmbedFallbackUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBeNull();
        expect(netEmbedFallbackUrl('https://example.com/v')).toBeNull();
        expect(netEmbedFallbackUrl(null)).toBeNull();
    });
});
