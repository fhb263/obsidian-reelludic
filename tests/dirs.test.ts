// 目录命名中枢测试：类型子目录英文名（movie/teleplay/animation/book/game/music）
// + 旧版中文类型目录 notePath 的英文化迁移（relocateLegacyNotePath，幂等防误伤）
import { describe, it, expect } from 'vitest';
import { typeDir, relocateLegacyNotePath } from 'pure/dirs';
import { ENTRY_TYPES } from 'data/types';

describe('typeDir 类型 → 笔记子目录英文名', () => {
    it('六类目录名 = movie/teleplay/animation/book/game/music（tv→teleplay、anime→animation 非内部键）', () => {
        expect(typeDir('movie')).toBe('movie');
        expect(typeDir('tv')).toBe('teleplay');
        expect(typeDir('anime')).toBe('animation');
        expect(typeDir('book')).toBe('book');
        expect(typeDir('game')).toBe('game');
        expect(typeDir('music')).toBe('music');
    });

    it('六类枚举全覆盖（ENTRY_TYPES 均有目录名）', () => {
        const names = ENTRY_TYPES.map(typeDir);
        expect(names).toHaveLength(6);
        for (const n of names) expect(/^[a-z]+$/.test(n)).toBe(true);
    });
});

describe('relocateLegacyNotePath 中文类型目录段 → 英文（迁移）', () => {
    it('默认库路径：笔记/电影|电视剧|动画|书籍|游戏|音乐 → 英文目录段', () => {
        expect(relocateLegacyNotePath('ReelLudic/笔记/电影/三体.md')).toBe('ReelLudic/笔记/movie/三体.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/电视剧/老友记.md')).toBe('ReelLudic/笔记/teleplay/老友记.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/动画/名侦探柯南.md')).toBe('ReelLudic/笔记/animation/名侦探柯南.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/书籍/活着.md')).toBe('ReelLudic/笔记/book/活着.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/游戏/部落冲突.md')).toBe('ReelLudic/笔记/game/部落冲突.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/音乐/七里香.md')).toBe('ReelLudic/笔记/music/七里香.md');
    });

    it('自定义库目录同样替换（任意前缀 + 笔记/ 父层）', () => {
        expect(relocateLegacyNotePath('媒体库/笔记/游戏/黑神话悟空.md')).toBe('媒体库/笔记/game/黑神话悟空.md');
        expect(relocateLegacyNotePath('MyLib/笔记/书籍/沙丘.md')).toBe('MyLib/笔记/book/沙丘.md');
    });

    it('幂等：已是英文目录的路径原样返回（二次迁移不破坏）', () => {
        expect(relocateLegacyNotePath('ReelLudic/笔记/movie/沙丘.md')).toBe('ReelLudic/笔记/movie/沙丘.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/book/三体.md')).toBe('ReelLudic/笔记/book/三体.md');
    });

    it('标题含中文类型词不误伤（只替换整段等于旧目录名的目录段，末段标题不参与）', () => {
        // 标题「电影往事」/「老友记 电视剧」均为末段（含文件名），非整段命中 → 原样
        expect(relocateLegacyNotePath('ReelLudic/笔记/movie/电影往事.md')).toBe('ReelLudic/笔记/movie/电影往事.md');
        expect(relocateLegacyNotePath('ReelLudic/笔记/teleplay/老友记 电视剧.md')).toBe('ReelLudic/笔记/teleplay/老友记 电视剧.md');
    });

    it('非笔记目录（封面等平铺路径）不误伤', () => {
        expect(relocateLegacyNotePath('ReelLudic/封面/电影.jpg')).toBe('ReelLudic/封面/电影.jpg');
        expect(relocateLegacyNotePath('ReelLudic/报告/2026-年度总结.md')).toBe('ReelLudic/报告/2026-年度总结.md');
    });
});
