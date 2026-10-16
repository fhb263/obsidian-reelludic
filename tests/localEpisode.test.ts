// 单集本地检索匹配（pure/localEpisode）单测 — #563
// 规则表：
//  - 集号三形态（第N集/EN/裸数字），**都带边界**（裸子串会撞 1080p / 2023 / 第13集）；
//  - 集标题只影响排序（资源命名常省略标题）；电影无集号 ⇒ 只按标题匹配，没标题不猜；
//  - 同分时按文件名长度、再按路径字典序（稳定，⛔ 不许随机）。
import { describe, it, expect } from 'vitest';
import { episodePatterns, fileMatchesEpisode, pickLocalEpisode, LOCAL_DIR_MISSING_WARN } from 'pure/localEpisode';

const f = (name: string, path = `媒体/${name}`) => ({ path, name });

describe('fileMatchesEpisode：集号边界', () => {
    it('三种写法都认：第03集 / S01E03 / EP3 / 裸 03', () => {
        expect(fileMatchesEpisode('剧名 第03集.mkv', 3)).toBe(true);
        expect(fileMatchesEpisode('Show.S01E03.1080p.mkv', 3)).toBe(true);
        expect(fileMatchesEpisode('Show.EP3.mkv', 3)).toBe(true);
        expect(fileMatchesEpisode('剧名 03.mkv', 3)).toBe(true);
        expect(fileMatchesEpisode('剧名 3.mkv', 3)).toBe(true);
    });

    it('🔴 边界：不许被 1080p / 2023 / 第13集 这类子串撞中', () => {
        expect(fileMatchesEpisode('剧名 1080p.mkv', 3)).toBe(false);
        expect(fileMatchesEpisode('剧名 2023.mkv', 3)).toBe(false);
        expect(fileMatchesEpisode('剧名 第13集.mkv', 3)).toBe(false);
        expect(fileMatchesEpisode('剧名 30.mkv', 3)).toBe(false);
    });

    it('两位补零与不补零互通（03 ↔ 3）', () => {
        expect(fileMatchesEpisode('剧名 03.mkv', 3)).toBe(true);
        expect(fileMatchesEpisode('剧名 3.mkv', 3)).toBe(true);
    });
});

describe('episodePatterns：形态条数', () => {
    it('恰三条（中文「第N集」/ 前缀 EN / 裸数字）—— 增删要同步 README 与断言', () => {
        expect(episodePatterns(1).length).toBe(3);
    });
});

describe('pickLocalEpisode：挑选与排序', () => {
    it('多集目录里挑中当前集（不是相邻集）', () => {
        const files = [f('剧名 01.mkv'), f('剧名 02.mkv'), f('剧名 03.mkv'), f('剧名 12.mkv')];
        expect(pickLocalEpisode(files, 3, '', false)?.name).toBe('剧名 03.mkv');
        expect(pickLocalEpisode(files, 12, '', false)?.name).toBe('剧名 12.mkv');
    });

    it('集标题命中者排前（同一集号有正片与花絮时）', () => {
        const files = [f('剧名 03 花絮.mkv'), f('剧名 03 开始.mkv')];
        expect(pickLocalEpisode(files, 3, '开始', false)?.name).toBe('剧名 03 开始.mkv');
    });

    it('标题缺省时按集号挑，且同分取**文件名更短**的那条（再按路径字典序稳定）', () => {
        const files = [f('剧名 03 加长版压制组.mkv'), f('剧名 03.mkv')];
        expect(pickLocalEpisode(files, 3, '', false)?.name).toBe('剧名 03.mkv');
    });

    it('没命中 ⇒ null（⛔ 不许「随便挑一条」顶上）', () => {
        expect(pickLocalEpisode([f('剧名 01.mkv')], 3, '', false)).toBeNull();
        expect(pickLocalEpisode([], 3, '', false)).toBeNull();
    });

    it('电影（单集）：只按标题匹配', () => {
        const files = [f('某电影.2023.2160p.mkv'), f('别的片子.mkv')];
        expect(pickLocalEpisode(files, 1, '某电影', true)?.name).toBe('某电影.2023.2160p.mkv');
        expect(pickLocalEpisode(files, 1, '不存在', true)).toBeNull();
    });

    it('🔴 电影**没填标题不猜**（只有一条也不返回 —— 那可能是花絮/预告）', () => {
        expect(pickLocalEpisode([f('花絮.mkv')], 1, '', true)).toBeNull();
    });

    it('归一化对齐（空格/标点/大小写不参与比较）', () => {
        const files = [f('My_Movie.2023.mkv')];
        expect(pickLocalEpisode(files, 1, 'my movie', true)?.name).toBe('My_Movie.2023.mkv');
    });
});

describe('警告文案', () => {
    it('未配置根目录的警告是用户给定原文（唯一一份）', () => {
        expect(LOCAL_DIR_MISSING_WARN).toBe('请先前往设置页配置媒体文件根目录');
    });
});
