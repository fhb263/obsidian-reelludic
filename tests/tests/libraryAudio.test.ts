import { describe, it, expect } from 'vitest';
import {
    LIBRARY_AUDIO_MIN_SCORE,
    audioStem,
    isExactTitleFile,
    pickLibraryAudio,
    scoreLibraryAudio,
    splitSongStem,
} from 'pure/libraryAudio';

// #404：音乐条目表单 → 播放按钮右键 → 「本地音频」浮层 → 那枚小按钮 =
// 「在库内音乐目录里找回同名音频」。用户：「优先检索库内音乐目录下同名音频文件进行关联」。
const f = (name: string) => ({ path: `下载/音乐/${name}`, name });

describe('audioStem / splitSongStem', () => {
    it('去扩展名只认最后一个点', () => {
        expect(audioStem('a.b.mp3')).toBe('a.b');
        expect(audioStem('无扩展名')).toBe('无扩展名');
        expect(audioStem('.hidden')).toBe('.hidden');
    });

    it('按**最后**一个 ` - ` 切艺人/歌名（歌名自带短横线时不误切）', () => {
        expect(splitSongStem('周杰伦 - 七里香.mp3')).toEqual({ artist: '周杰伦', title: '七里香' });
        expect(splitSongStem('周杰伦 - 2024 - 七里香.flac')).toEqual({ artist: '周杰伦 - 2024', title: '七里香' });
        expect(splitSongStem('七里香.mp3')).toEqual({ artist: '', title: '七里香' });
        expect(splitSongStem('周杰伦 - .mp3')).toEqual({ artist: '', title: '周杰伦 -' }); // 右侧空 ⇒ 不切
    });
});

describe('scoreLibraryAudio', () => {
    it('「艺人 - 歌名」形态命中最高', () => {
        const hit = scoreLibraryAudio(f('周杰伦 - 七里香.mp3'), '七里香', '周杰伦');
        const bare = scoreLibraryAudio(f('七里香.mp3'), '七里香', '周杰伦');
        const wrongArtist = scoreLibraryAudio(f('别的歌手 - 七里香.mp3'), '七里香', '周杰伦');
        expect(hit).toBeGreaterThan(bare);
        // ⚠️「只有歌名」与「歌名对但艺人不符」**同分** —— 光看文件名分不出这两者（都不是 bug：
        //    两边都只命中了歌名，谁更对只能靠人判断）⇒ 界面把「命中 N 个」一并告诉用户。
        expect(bare).toBe(wrongArtist);
        expect(bare).toBeGreaterThanOrEqual(LIBRARY_AUDIO_MIN_SCORE);
    });

    it('🔴 无关文件**不得**命中（这条钉的是「别拿条目作者去补文件名里缺失的艺人段」）', () => {
        expect(scoreLibraryAudio(f('别的歌.mp3'), '七里香', '周杰伦')).toBeLessThan(LIBRARY_AUDIO_MIN_SCORE);
        expect(scoreLibraryAudio(f('周杰伦 - 别的歌.mp3'), '七里香', '周杰伦')).toBeLessThan(LIBRARY_AUDIO_MIN_SCORE);
    });

    it('歌名自带短横线时仍能命中（拆分取**最后**一个 ` - ` ⇒ 尾段就是歌名）', () => {
        // ⚠️ 这里刻意**不要**再断言「整段当歌名那一档」——那一档实测是冗余的（见 `scoreLibraryAudio` 注释），
        //    已在 #404 本批删除；这条用例钉的是「删除后行为不变」。
        expect(scoreLibraryAudio(f('七里香 - Live.mp3'), '七里香 - Live', '')).toBeGreaterThanOrEqual(LIBRARY_AUDIO_MIN_SCORE);
    });

    it('标题为空 ⇒ -1（调用方据此提前退出，不拿空串去匹配）', () => {
        expect(scoreLibraryAudio(f('七里香.mp3'), '', '周杰伦')).toBe(-1);
        expect(scoreLibraryAudio(f('七里香.mp3'), '   ', '')).toBe(-1);
    });
});

describe('pickLibraryAudio', () => {
    const files = [
        f('周杰伦 - 七里香.mp3'),
        f('周杰伦 - 七里香 (2).flac'),
        f('别的歌手 - 七里香.mp3'),
        f('无关文件.mp3'),
    ];

    it('按分数降序、无关文件被过滤掉；每首只出现一次', () => {
        const { best, ranked } = pickLibraryAudio(files, '七里香', '周杰伦');
        // 分档：艺人+歌名全中（105）> 只中歌名（75，同分按路径序）> 歌名带 `(2)` 后缀（41，只中歌名单段）
        expect(ranked.map((m) => m.name)).toEqual(['周杰伦 - 七里香.mp3', '别的歌手 - 七里香.mp3', '周杰伦 - 七里香 (2).flac']);
        expect(best?.name).toBe('周杰伦 - 七里香.mp3');
        expect(new Set(ranked.map((m) => m.path)).size).toBe(ranked.length);
    });

    it('同分按路径字典序（结果稳定才可断言）', () => {
        const { ranked } = pickLibraryAudio([f('b - 同名.mp3'), f('a - 同名.mp3')], '同名', '');
        expect(ranked.map((m) => m.path)).toEqual(['下载/音乐/a - 同名.mp3', '下载/音乐/b - 同名.mp3']);
    });

    it('空列表 / 全不命中 ⇒ best 为 null（调用方给「没找到」提示，⛔ 不能随便挑一个）', () => {
        expect(pickLibraryAudio([], '七里香', '周杰伦')).toEqual({ best: null, ranked: [] });
        expect(pickLibraryAudio([f('无关.mp3')], '七里香', '周杰伦').best).toBeNull();
    });

    // 🔴 #463：用户报障「检索同名音频能搞到两个，还拉取了个错误的给我」
    describe('#463 同名优先（分数只是第二关键字）', () => {
        it('🔴 实景回归《七里香》：正确的 `七里香.mp3` 与无关的 `兰亭序 - 周杰伦.mp3` 同分时，必须选**同名的**', () => {
            const files463 = [f('兰亭序 - 周杰伦.mp3'), f('七里香.mp3')];
            const bare = pickLibraryAudio(files463, '七里香', '周杰伦');
            // 先确认这两条**确实同分**（否则这条测试就失去意义 —— 钉的正是「分数分不出来」）
            expect(bare.ranked.map((m) => Math.round(m.score * 10) / 10)).toEqual([74.7, 74.7]);
            expect(bare.best?.name).toBe('七里香.mp3');
            expect(bare.ranked[0].exact).toBe(true);
            expect(bare.ranked[1].exact).toBe(false);
        });

        it('🔴 `歌名 - 歌手` 命名（库内与「歌手 - 歌名」混用）也算同名：左段可以是标题', () => {
            const files463 = [f('兰亭序 - 周杰伦.mp3'), f('七里香.mp3')];
            expect(pickLibraryAudio(files463, '兰亭序', '周杰伦').best?.name).toBe('兰亭序 - 周杰伦.mp3');
        });

        it('同名归一：空白 / 全角标点 / 大小写不影响判定；带 `(Live)` 这类后缀**不算**同名', () => {
            expect(isExactTitleFile('七里香.mp3', ' 七里香 ')).toBe(true);
            expect(isExactTitleFile('BEYOND - 光辉岁月.mp3', '光辉岁月')).toBe(true);
            expect(isExactTitleFile('Lemon Tree.mp3', 'lemon tree')).toBe(true);
            expect(isExactTitleFile('七里香 (Live).mp3', '七里香')).toBe(false);
            expect(isExactTitleFile('七里香.mp3', '')).toBe(false);
        });

        it('同名列表内部仍按分数排（同名的两条：艺人也对的那条在前）', () => {
            const files463 = [f('别的歌手 - 七里香.mp3'), f('周杰伦 - 七里香.mp3')];
            const r = pickLibraryAudio(files463, '七里香', '周杰伦');
            expect(r.ranked.every((m) => m.exact)).toBe(true);
            expect(r.best?.name).toBe('周杰伦 - 七里香.mp3');
        });

        it('同名的两条**分数也相同**时，退回路径字典序（结果依旧稳定可断言）', () => {
            const r = pickLibraryAudio([f('b - 同名.mp3'), f('a - 同名.mp3')], '同名', '');
            expect(r.ranked.map((m) => m.path)).toEqual(['下载/音乐/a - 同名.mp3', '下载/音乐/b - 同名.mp3']);
        });
    });
});
