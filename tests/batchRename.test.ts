/**
 * 关联媒体重命名规则守卫（2026-11-13 七类规则改版）。
 *
 * 这层只测**算名字**：条目 + 文件 → 改名计划。碰文件系统的部分在宿主
 * （`plugin.runBatchRename()` → `fileManager.renameFile`），⛔ 不在这里 mock。
 *
 * 🔴 期望值逐条对应用户给的七套模板（电影 / 剧集 / 动画 / 音乐 / 漫画 / 文学 / 网文），
 *    ⛔ 别把本文件的字面量当成「随手写的样例」——它们就是模板的验收口径。
 */
import { describe, expect, it } from 'vitest';
import type { MediaEntry } from 'data/types';
import {
    RENAME_TEMPLATE_GROUPS,
    buildRenameStem,
    cleanStem,
    planBatchRename,
    planEntryRename,
    renameKindOf,
    renamePlanTip,
    renameTemplateOf,
    resolutionOf,
    splitPath,
    summarizeRenamePlans,
} from 'pure/batchRename';

const STAMP = '2026-01-01T00:00:00.000Z';

function mk(patch: Partial<MediaEntry> = {}): MediaEntry {
    return {
        id: 'e1',
        type: 'movie',
        title: '蝴蝶效应',
        status: 'watched',
        rating: 5,
        genres: [],
        cast: [],
        createdAt: STAMP,
        updatedAt: STAMP,
        ...patch,
    } as MediaEntry;
}

const OPTS = {};

describe('七类规则模板（界面唯一真源）', () => {
    it('恰好七类，顺序与用户口径一致', () => {
        expect(RENAME_TEMPLATE_GROUPS.map((g) => g.kind)).toEqual([
            'movie', 'tv', 'anime', 'music', 'comic', 'book', 'novel',
        ]);
        expect(RENAME_TEMPLATE_GROUPS.map((g) => g.label)).toEqual([
            '电影', '剧集', '动画', '音乐', '漫画', '文学', '网文',
        ]);
    });

    it('每类都有模板与示例（⛔ 空示例 = 用户看不出名字长什么样）', () => {
        for (const g of RENAME_TEMPLATE_GROUPS) {
            expect(g.templates.length).toBeGreaterThan(0);
            expect(g.examples.length).toBeGreaterThan(0);
        }
    });

    it('电影 / 动画 / 漫画是多写法，且每种写法都被某个示例覆盖到', () => {
        for (const kind of ['movie', 'anime', 'comic'] as const) {
            const g = renameTemplateOf(kind)!;
            expect(g.templates.length).toBeGreaterThan(1);
            // ⚠️ 数量不必相等：用户给电影就只给了 1 个示例（`[4K]` 那版），
            //    但示例必须覆盖到每一条写法的**关键特征**（见下一条逐字断言）。
            expect(g.examples.length).toBeGreaterThan(0);
        }
    });

    it('模板与示例逐字对应用户给的文案', () => {
        expect(renameTemplateOf('movie')!.templates).toEqual([
            '{电影名} ({年份}).{ext}',
            '{电影名} ({年份}) [{分辨率}].{ext}',
        ]);
        expect(renameTemplateOf('movie')!.examples).toEqual(['流浪地球2 (2023) [4K].mkv']);
        expect(renameTemplateOf('tv')!.examples).toEqual(['权力的游戏 - S01E01 - 凛冬将至.mp4']);
        expect(renameTemplateOf('anime')!.examples).toEqual([
            '进击的巨人 - S04E01 - 海的另一边.mkv',
            '进击的巨人 - 第01话.mkv',
        ]);
        expect(renameTemplateOf('music')!.examples).toEqual([
            '周杰伦 - 七里香.mp3',
            '周杰伦&费玉清 - 千里之外.mp3',
        ]);
        expect(renameTemplateOf('comic')!.examples).toEqual(['海贼王 - 第1090话.cbz', '咒术回战 - 卷01.epub']);
        expect(renameTemplateOf('book')!.examples).toEqual(['刘慈欣 - 三体 (2008).epub']);
        expect(renameTemplateOf('novel')!.examples).toEqual(['诡秘之主 - 爱潜水的乌贼.txt']);
    });
});

describe('条目 → 用哪套规则', () => {
    it('影视音直接映射', () => {
        expect(renameKindOf({ type: 'movie' })).toBe('movie');
        expect(renameKindOf({ type: 'tv' })).toBe('tv');
        expect(renameKindOf({ type: 'anime' })).toBe('anime');
        expect(renameKindOf({ type: 'music' })).toBe('music');
    });

    it('book 按 bookKind 分漫画 / 网文 / 文学（缺省文学）', () => {
        expect(renameKindOf({ type: 'book', bookKind: 'comic' })).toBe('comic');
        expect(renameKindOf({ type: 'book', bookKind: 'novel' })).toBe('novel');
        expect(renameKindOf({ type: 'book', bookKind: 'book' })).toBe('book');
        expect(renameKindOf({ type: 'book' })).toBe('book');
    });

    it('🔴 游戏没有命名规则 ⇒ null（⛔ 不许给游戏目录改名）', () => {
        expect(renameKindOf({ type: 'game' })).toBeNull();
    });
});

describe('文件名清洗与分辨率识别', () => {
    it('去掉 Windows / Obsidian 禁用字符并压缩空白', () => {
        expect(cleanStem(' 复仇者  联盟: 终局之战 ')).toBe('复仇者 联盟 终局之战');
        expect(cleanStem('a\\b/c*d?e"f<g>h|i#j^k')).toBe('a b c d e f g h i j k');
    });

    it('⚠️ 与 sanitizeFileStem 的区别：这里**保留**扩展名', () => {
        expect(cleanStem('蝴蝶效应.mkv')).toBe('蝴蝶效应.mkv');
    });

    it('⚠️ 圆括号是合法文件名字符，⛔ 不许清洗掉（电影模板要写 `(2023)`）', () => {
        expect(cleanStem('流浪地球2 (2023)')).toBe('流浪地球2 (2023)');
    });

    it('🔴 2026-11-14：方括号必须**原样保留**（作者名带 `[国籍]` 前缀）', () => {
        // 用户原话：「怎么完整输出中括号的如「[哥伦比亚] 加西亚·马尔克斯」
        // 没有中括号就会变成整个人名了」
        expect(cleanStem('[哥伦比亚] 加西亚·马尔克斯')).toBe('[哥伦比亚] 加西亚·马尔克斯');
        expect(cleanStem('流浪地球2 (2023) [4K]')).toBe('流浪地球2 (2023) [4K]');
        // ⛔ 只有真正的禁用字符被剔掉，方括号不能跟着没了
        expect(cleanStem('a[b]c:d')).toBe('a[b]c d');
    });

    it('分辨率从原文件名里认（条目上没有分辨率字段）', () => {
        expect(resolutionOf('流浪地球2.2160p.mkv')).toBe('4K');
        expect(resolutionOf('流浪地球2 4K.mkv')).toBe('4K');
        expect(resolutionOf('a.1080p.mp4')).toBe('1080P');
        expect(resolutionOf('a.720p.mp4')).toBe('720P');
        expect(resolutionOf('a.mkv')).toBe('');
    });
});

describe('拆路径', () => {
    it('带目录 / 不带目录 / 反斜杠都认', () => {
        expect(splitPath('ReelLudic/视频/a.mkv')).toEqual({ dir: 'ReelLudic/视频/', name: 'a.mkv' });
        expect(splitPath('a.mkv')).toEqual({ dir: '', name: 'a.mkv' });
        expect(splitPath('ReelLudic\\视频\\a.mkv')).toEqual({ dir: 'ReelLudic/视频/', name: 'a.mkv' });
    });
});

describe('① 电影：`{电影名} ({年份})` + 可选 `[{分辨率}]`', () => {
    it('年份齐全', () => {
        expect(buildRenameStem(mk({ year: 2020 }), 1, true, OPTS)).toBe('蝴蝶效应 (2020)');
    });

    it('没有年份 ⇒ ⛔ 不写 `()`, 整段省略', () => {
        expect(buildRenameStem(mk({ year: undefined }), 1, true, OPTS)).toBe('蝴蝶效应');
    });

    it('有分辨率标签才加 `[4K]`', () => {
        expect(buildRenameStem(mk({ year: 2023, title: '流浪地球2' }), 1, true, { resolution: '4K' }))
            .toBe('流浪地球2 (2023) [4K]');
    });

    it('单文件电影不写集号（模板里本来就没有集号）', () => {
        expect(buildRenameStem(mk({ year: 2020 }), 7, true, OPTS)).toBe('蝴蝶效应 (2020)');
    });
});

describe('② 剧集：`{剧名} - S{季号}E{集号} - {单集标题}`', () => {
    it('季号 + 集号 + 单集标题', () => {
        const e = mk({
            type: 'tv',
            title: '权力的游戏',
            progress: { season: 1, episode: 1, history: [] },
            episodeTitles: ['凛冬将至'],
        });
        expect(buildRenameStem(e, 1, false, OPTS)).toBe('权力的游戏 - S01E01 - 凛冬将至');
    });

    it('没有季号 ⇒ 补 `S01`（⛔ 不产出 `SE01` 这种半截）', () => {
        expect(buildRenameStem(mk({ type: 'tv' }), 3, false, OPTS)).toBe('蝴蝶效应 - S01E03');
    });

    it('没有单集标题 ⇒ 整段省略（⛔ 不写孤零零的 ` - `）', () => {
        const e = mk({ type: 'tv', progress: { season: 2, episode: 1, history: [] } });
        expect(buildRenameStem(e, 5, false, OPTS)).toBe('蝴蝶效应 - S02E05');
    });

    it('`withEpisode: false` 的单文件剧只留片名', () => {
        expect(buildRenameStem(mk({ type: 'tv' }), 1, true, { withEpisode: false })).toBe('蝴蝶效应');
    });
});

describe('③ 动画：有季号走 SxxExx，没季号走 `第NN话`', () => {
    it('有季号 + 单集标题', () => {
        const e = mk({
            type: 'anime',
            title: '进击的巨人',
            progress: { season: 4, episode: 1, history: [] },
            episodeTitles: ['海的另一边'],
        });
        expect(buildRenameStem(e, 1, false, OPTS)).toBe('进击的巨人 - S04E01 - 海的另一边');
    });

    it('没有季号 ⇒ `第01话`', () => {
        expect(buildRenameStem(mk({ type: 'anime', title: '进击的巨人' }), 1, false, OPTS))
            .toBe('进击的巨人 - 第01话');
    });
});

describe('④ 音乐：`{歌手} - {歌曲名}`', () => {
    it('🔴 2026-11-14：歌手读 `author`（音乐的「艺术家」），⛔ 不是 `artist`（漫画画师）', () => {
        // 用户原话：「怎么音乐关联的音频文件没有重命名为：{歌手} - {歌曲名}.{ext}
        //          【比如骑在银龙的背上.mp3】」
        // 根因：上一版读 `entry.artist`，而表单/曲库/分组全都写 `author` ⇒ 歌手恒为空。
        const e = mk({
            type: 'music',
            title: '骑在银龙的背上',
            author: '中岛美雪',
            audioPath: 'ReelLudic/音乐/骑在银龙的背上.mp3',
        });
        expect(buildRenameStem(e, 1, true, OPTS)).toBe('中岛美雪 - 骑在银龙的背上');
        expect(planEntryRename(e, OPTS).renames[0].next).toBe('中岛美雪 - 骑在银龙的背上.mp3');
    });

    it('单曲走 audioPath 的歌曲名', () => {
        const e = mk({ type: 'music', title: '七里香', author: '周杰伦', audioPath: 'ReelLudic/音乐/x.mp3' });
        expect(planEntryRename(e, OPTS).renames[0].next).toBe('周杰伦 - 七里香.mp3');
    });

    it('多位歌手按原名拼接（`&` 是合法字符，⛔ 不清洗）', () => {
        const e = mk({ type: 'music', title: '千里之外', author: '周杰伦&费玉清' });
        expect(buildRenameStem(e, 1, true, OPTS)).toBe('周杰伦&费玉清 - 千里之外');
    });

    it('🔴 整张专辑多文件：每首用自己的单集标题，⛔ 不许全撞成同一个名字', () => {
        const e = mk({
            type: 'music',
            title: '七里香',
            author: '周杰伦',
            episodeTitles: ['我的地盘', '七里香'],
            episodeFiles: ['ReelLudic/音乐/01.mp3', 'ReelLudic/音乐/02.mp3'],
        });
        const plan = planEntryRename(e, OPTS);
        expect(plan.renames.map((r) => r.next)).toEqual(['周杰伦 - 我的地盘.mp3', '周杰伦 - 七里香.mp3']);
        expect(plan.skipped).toEqual([]);
    });

    it('没有歌手 ⇒ 只留歌曲名（⛔ 不写 `- 歌名`）', () => {
        expect(buildRenameStem(mk({ type: 'music', title: '晴天', author: undefined }), 1, true, OPTS))
            .toBe('晴天');
    });

    it('🔴 漫画的 `artist`（画师）⛔ 不能被当成歌手', () => {
        const e = mk({ type: 'music', title: '晴天', author: undefined, artist: '某画师', bookKind: undefined });
        // 非书籍时才回落 `artist` —— 这条是 music 类型、没有 bookKind，故回落生效（兼容老数据）
        expect(buildRenameStem(e, 1, true, OPTS)).toBe('某画师 - 晴天');
        // 一旦标成书籍（漫画），`artist` 就是画师，⛔ 不认
        const comic = mk({ type: 'book', bookKind: 'comic', title: '海贼王', artist: '尾田荣一郎' });
        expect(renameKindOf(comic)).toBe('comic');
        expect(buildRenameStem(comic, 1, true, OPTS)).toBe('海贼王');
    });

    it('🔴 2026-11-14：原文件名已合规（`歌手 - 歌名`）⇒ 不许改成只剩歌名', () => {
        // 用户原话：「还有一些符合规则关联的音频文件如：「周杰伦 - 七里香.mp3」
        // 被强制改为「七里香.mp3」了」
        const e = mk({
            type: 'music',
            title: '七里香',
            author: undefined,
            audioPath: 'ReelLudic/音乐/周杰伦 - 七里香.mp3',
        });
        const plan = planEntryRename(e, OPTS);
        expect(plan.renames).toEqual([]);
        expect(plan.unchanged.map((u) => u.reason)).toContain('名字已经符合规则');
    });

    it('🔴 2026-11-14：不符合形状的仍要改名（缺歌手时按规则退化）', () => {
        const e = mk({
            type: 'music',
            title: '七里香',
            author: undefined,
            audioPath: 'ReelLudic/音乐/track01.mp3',
        });
        expect(planEntryRename(e, OPTS).renames[0].next).toBe('七里香.mp3');
    });
});

describe('⑤ 漫画：`{漫画名} - 第{话数}话`', () => {
    it('多话按集号推进', () => {
        const e = mk({ type: 'book', bookKind: 'comic', title: '海贼王' });
        expect(buildRenameStem(e, 1090, false, OPTS)).toBe('海贼王 - 第1090话');
    });

    it('单文件卷只留片名（⛔ 不瞎标「第01话」）', () => {
        expect(buildRenameStem(mk({ type: 'book', bookKind: 'comic', title: '咒术回战' }), 1, true, OPTS))
            .toBe('咒术回战');
    });
});

describe('⑥ 文学：`{作者} - {书名} ({年份})`', () => {
    it('作者 + 书名 + 年份', () => {
        const e = mk({ type: 'book', bookKind: 'book', title: '三体', author: '刘慈欣', year: 2008 });
        expect(buildRenameStem(e, 1, true, OPTS)).toBe('刘慈欣 - 三体 (2008)');
    });

    it('没有作者 ⇒ 只留书名 (+年份)', () => {
        expect(buildRenameStem(mk({ type: 'book', title: '三体', year: 2008 }), 1, true, OPTS))
            .toBe('三体 (2008)');
    });
});

describe('⑦ 网文：`{书名} - {作者}`', () => {
    it('书名 + 作者', () => {
        const e = mk({ type: 'book', bookKind: 'novel', title: '诡秘之主', author: '爱潜水的乌贼' });
        expect(buildRenameStem(e, 1, true, OPTS)).toBe('诡秘之主 - 爱潜水的乌贼');
    });
});

describe('兜底与跳过', () => {
    it('片名全是非法字符 ⇒ 兜底「未命名」，⛔ 不产出空名字', () => {
        expect(buildRenameStem(mk({ title: '///' }), 1, true, OPTS)).toBe('未命名');
    });

    it('游戏无规则 ⇒ 空串 + 计划里带原因', () => {
        expect(buildRenameStem(mk({ type: 'game' }), 1, true, OPTS)).toBe('');
        const plan = planEntryRename(mk({ type: 'game' }), OPTS);
        expect(plan.renames).toEqual([]);
        expect(plan.skipped[0].reason).toContain('没有命名规则');
    });

    it('没有任何本地文件 ⇒ skipped 带原因', () => {
        const plan = planEntryRename(mk(), OPTS);
        expect(plan.renames).toEqual([]);
        expect(plan.skipped[0].reason).toContain('没有关联本地文件');
    });

    it('名字已经符合规则 ⇒ 进 unchanged（不是 skipped）', () => {
        const e = mk({ year: 2019, episodeFiles: ['ReelLudic/视频/蝴蝶效应 (2019).mkv'] });
        const plan = planEntryRename(e, OPTS);
        expect(plan.renames).toEqual([]);
        expect(plan.unchanged).toHaveLength(1);
        expect(plan.skipped).toEqual([]);
    });

    it('文学条目走 bookFile（没有 episodeFiles 时）', () => {
        const e = mk({
            type: 'book',
            bookKind: 'book',
            title: '三体',
            author: '刘慈欣',
            year: 2008,
            bookFile: 'ReelLudic/书/x.epub',
        });
        expect(planEntryRename(e, OPTS).renames[0].next).toBe('刘慈欣 - 三体 (2008).epub');
    });
});

describe('冲突与批量', () => {
    it('🔴 同一目录两个文件算出同一个名字 ⇒ **两颗都跳过**', () => {
        const e = mk({ title: '蝴蝶效应', episodeFiles: ['ReelLudic/视频/a.mkv', 'ReelLudic/视频/b.mkv'] });
        const plan = planEntryRename(e, OPTS);
        expect(plan.renames).toEqual([]);
        expect(plan.skipped).toHaveLength(2);
        expect(plan.skipped[0].reason).toContain('同一个名字');
    });

    it('🔴 互换改名（A→B、B→A）必须能算出两条计划', () => {
        const dir = 'ReelLudic/视频/';
        const a = mk({ id: 'a', title: '乙', year: 2019, episodeFiles: [`${dir}甲.mkv`] });
        const b = mk({ id: 'b', title: '甲', year: 2019, episodeFiles: [`${dir}乙.mkv`] });
        const plans = planBatchRename([a, b], OPTS);
        expect(plans).toHaveLength(2);
        expect(plans[0].renames[0].next).toBe('乙 (2019).mkv');
        expect(plans[1].renames[0].next).toBe('甲 (2019).mkv');
    });

    it('不同目录同名不算冲突', () => {
        const e = mk({ episodeFiles: ['ReelLudic/视频/a.mkv', 'ReelLudic/备份/b.mkv'] });
        const plan = planEntryRename(e, OPTS);
        expect(plan.renames).toHaveLength(2);
        expect(plan.skipped).toEqual([]);
    });

    it('🔴 planBatchRename 只收「真会改名」的条目（不展示跳过项的前提）', () => {
        const ok = mk({ id: 'ok', year: 2019, episodeFiles: ['ReelLudic/a.mkv'] });
        const noFile = mk({ id: 'no-file' });
        const plans = planBatchRename([ok, noFile], OPTS);
        expect(plans.map((p) => p.entryId)).toEqual(['ok']);
    });

    it('名字过长按 `maxNameLen` 截断（扩展名完整保留）', () => {
        const long = '很长的片名'.repeat(40);
        const e = mk({ title: long, episodeFiles: ['ReelLudic/视频/a.mkv'] });
        const plan = planEntryRename(e, { ...OPTS, maxNameLen: 60 });
        expect(plan.renames[0].next.length).toBeLessThanOrEqual(60);
        expect(plan.renames[0].next.endsWith('.mkv')).toBe(true);
    });
});

describe('汇总与文案', () => {
    it('summarizeRenamePlans 只把「真有改名」的算进 entries', () => {
        const withRename = planEntryRename(mk({ year: 2019, episodeFiles: ['ReelLudic/a.mkv'] }), OPTS);
        const onlySkip = planEntryRename(mk({ id: 'e2' }), OPTS);
        const sum = summarizeRenamePlans([withRename, onlySkip]);
        expect(sum.entries).toBe(1);
        expect(sum.files).toBe(1);
        expect(sum.skipped).toBe(1);
    });

    it('renamePlanTip：有改名时给 `旧 → 新`，多个时带总数', () => {
        const e = mk({ episodeFiles: ['ReelLudic/01.mkv', 'ReelLudic/备份/02.mkv'] });
        const plan = planEntryRename(e, OPTS);
        expect(renamePlanTip(plan)).toBe('01.mkv → 蝴蝶效应.mkv（共 2 个）');
    });

    it('renamePlanTip：没改名时给原因（⛔ 不返回空串）', () => {
        expect(renamePlanTip(planEntryRename(mk(), OPTS))).toContain('没有关联本地文件');
    });
});
