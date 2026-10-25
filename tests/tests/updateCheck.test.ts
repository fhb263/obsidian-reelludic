// 网站更新检测纯逻辑测试（参考 Bangumi-Bridge 追番脚本的串行/并行检测逻辑）
import { describe, it, expect } from 'vitest';
import { extractMaxEpisodeFromHTML, checkAnimeUpdate, isBlockedPage } from 'pure/updateCheck';

describe('extractMaxEpisodeFromHTML 集数提取', () => {
    it('第X集', () => {
        expect(extractMaxEpisodeFromHTML('第1集 第12集 第3集')).toBe(12);
    });
    it('第X话', () => {
        expect(extractMaxEpisodeFromHTML('第5话 第25话')).toBe(25);
    });
    it('第X話（日文汉字）', () => {
        expect(extractMaxEpisodeFromHTML('第3話 第18話')).toBe(18);
        expect(extractMaxEpisodeFromHTML('第7話 第12话')).toBe(12);
    });
    it('URL 参数 ep= / ep/（视频站）', () => {
        expect(extractMaxEpisodeFromHTML('<a href="/play?ep=8">播放</a>?ep=2')).toBe(8);
        expect(extractMaxEpisodeFromHTML('/video/ep/15.html')).toBe(15);
    });
    it('开头 X集全（无"第"字且不在句中）', () => {
        expect(extractMaxEpisodeFromHTML('12集全 720p')).toBe(12);
        expect(extractMaxEpisodeFromHTML('24集全')).toBe(24);
    });
    it('Episode X / ep.X / EPX', () => {
        expect(extractMaxEpisodeFromHTML('Episode 8 Episode 2 ep.10')).toBe(10);
        expect(extractMaxEpisodeFromHTML('EP1 EP15')).toBe(15);
    });
    it('第X期（综艺）', () => {
        expect(extractMaxEpisodeFromHTML('第3期 第20期')).toBe(20);
    });
    it('X集（无"第"字）', () => {
        expect(extractMaxEpisodeFromHTML('01集 25集 3集')).toBe(25);
    });
    it('苹果CMS 播放链接 /play/{id}-{ep}-{rec}.html', () => {
        expect(extractMaxEpisodeFromHTML('<a href="/play/47966-41-1399170.html">第41集</a><a href="/play/47966-12-1234.html">第12集</a>')).toBe(41);
    });
    it('混合模式取最大', () => {
        expect(extractMaxEpisodeFromHTML('第3集 Episode 15 第2话 /play/1-7-9.html')).toBe(15);
    });
    it('无集数信息返回 0', () => {
        expect(extractMaxEpisodeFromHTML('<html><body>没有剧集信息</body></html>')).toBe(0);
        expect(extractMaxEpisodeFromHTML('')).toBe(0);
    });
});

describe('isBlockedPage CDN 拦截识别', () => {
    it('cdndefend 挑战页被识别', () => {
        expect(isBlockedPage('<title>Protected by cdndefend, verifying your browser...</title><script>sha1</script>')).toBe(true);
    });
    it('人机验证/安全验证被识别', () => {
        expect(isBlockedPage('请完成人机验证后继续访问')).toBe(true);
        expect(isBlockedPage('安全验证 拖动滑块')).toBe(true);
    });
    it('正常页面不被误判', () => {
        expect(isBlockedPage('<div>第1集 第2集</div>')).toBe(false);
        expect(isBlockedPage('')).toBe(false);
    });
});

describe('checkAnimeUpdate 检测', () => {
    const htmlWithEps = (n: number) => `<div>第${n}集</div><div>第${n - 1}集</div>`;
    const okHttp = (html: string) => async () => html;
    const failHttp = () => async () => {
        throw new Error('网络超时');
    };

    it('有更新：最新 12 > 已看 10 → updateCount 2', async () => {
        const r = await checkAnimeUpdate(okHttp(htmlWithEps(12)), 'https://example.com/detail', 10);
        expect(r.status).toBe('updated');
        expect(r.latestEpisode).toBe(12);
        expect(r.updateCount).toBe(2);
    });

    it('已同步：最新 == 已看 → synced, updateCount 0', async () => {
        const r = await checkAnimeUpdate(okHttp(htmlWithEps(10)), 'https://example.com/detail', 10);
        expect(r.status).toBe('synced');
        expect(r.updateCount).toBe(0);
    });

    it('已看超过最新 → synced 不出现负数', async () => {
        const r = await checkAnimeUpdate(okHttp(htmlWithEps(8)), 'https://example.com/detail', 10);
        expect(r.status).toBe('synced');
        expect(r.updateCount).toBe(0);
    });

    it('空 URL → no-url', async () => {
        const r = await checkAnimeUpdate(okHttp(htmlWithEps(12)), '', 10);
        expect(r.status).toBe('no-url');
    });

    it('网络失败 → failed 带错误', async () => {
        const r = await checkAnimeUpdate(failHttp(), 'https://example.com/detail', 10);
        expect(r.status).toBe('failed');
        expect(r.error).toContain('网络请求失败');
        expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('页面无集数信息 → no-info', async () => {
        const r = await checkAnimeUpdate(okHttp('<html>登录页</html>'), 'https://example.com/detail', 10);
        expect(r.status).toBe('no-info');
    });

    it('CDN 人机验证拦截页 → blocked', async () => {
        const r = await checkAnimeUpdate(
            okHttp('<title>Protected by cdndefend, verifying your browser...</title>'),
            'https://example.com/play/1-2-3.html',
            10,
        );
        expect(r.status).toBe('blocked');
    });

    it('苹果CMS 播放页（可访问）→ 从播放链接提取集数', async () => {
        const r = await checkAnimeUpdate(
            okHttp('<a href="/play/47966-12-1234.html">第12集</a><a href="/play/47966-41-1399170.html">第41集</a>'),
            'https://example.com/play/47966-41-1399170.html',
            10,
        );
        expect(r.status).toBe('updated');
        expect(r.latestEpisode).toBe(41);
        expect(r.updateCount).toBe(31);
    });
});
