import { describe, it, expect } from 'vitest';
import { groupMusicByArtist, UNCATEGORIZED_ARTIST, type MusicGroup } from 'pure/musicGroup';
import type { MediaEntry } from 'data/types';

function entry(id: string, author?: string, album?: string, year?: number, title = `歌${id}`): MediaEntry {
    return { id, type: 'music', title, author, album, year, links: [], progress: {} } as unknown as MediaEntry;
}

function names(groups: MusicGroup[]): string[] {
    return groups.map((g) => g.artist);
}

describe('pure/musicGroup 音乐按歌手分组', () => {
    it('空输入返回空数组', () => {
        expect(groupMusicByArtist([])).toEqual([]);
    });

    it('按歌手分组，组名按中文本地化排序（ICU zh：汉字拼音序，拉丁字符靠后）', () => {
        const g = groupMusicByArtist([entry('1', '周杰伦'), entry('2', '陈奕迅'), entry('3', 'Beyond')]);
        expect(names(g)).toEqual(['陈奕迅', '周杰伦', 'Beyond']); // Chen < Zhou，Beyond 排汉字后
    });

    it('组内按专辑 → 年份 → 标题排序', () => {
        const g = groupMusicByArtist([
            entry('1', '周杰伦', '七里香', 2004),
            entry('2', '周杰伦', '叶惠美', 2003),
            entry('3', '周杰伦', '七里香', 2005), // 同专辑同年不同标题
            entry('4', '周杰伦', '叶惠美', 2003, '以父之名'),
            entry('5', '周杰伦', '叶惠美', 2003, '晴天'),
        ]);
        expect(g[0].entries.map((e) => e.id)).toEqual(['1', '3', '2', '5', '4']);
    });

    it('无 author / 空白 author 归「未分类」组置底', () => {
        const g = groupMusicByArtist([entry('1', '周杰伦'), entry('2'), entry('3', '   ')]);
        expect(names(g)).toEqual(['周杰伦', UNCATEGORIZED_ARTIST]);
        expect(g[1].entries.map((e) => e.id)).toEqual(['2', '3']);
    });

    it('只有未分类时仅输出未分类组', () => {
        const g = groupMusicByArtist([entry('1'), entry('2')]);
        expect(names(g)).toEqual([UNCATEGORIZED_ARTIST]);
        expect(g[0].entries).toHaveLength(2);
    });

    it('输入顺序不影响分组结果（分组稳定）', () => {
        const a = groupMusicByArtist([entry('1', 'A'), entry('2', 'B'), entry('3', 'C')]);
        const b = groupMusicByArtist([entry('3', 'C'), entry('1', 'A'), entry('2', 'B')]);
        expect(names(a)).toEqual(names(b));
        expect(a[0].entries.map((e) => e.id)).toEqual(['1']);
    });

    it('歌手名首尾空白修剪后分组', () => {
        const g = groupMusicByArtist([entry('1', ' 周杰伦 '), entry('2', '周杰伦')]);
        expect(g).toHaveLength(1);
        expect(g[0].entries).toHaveLength(2);
    });
});
