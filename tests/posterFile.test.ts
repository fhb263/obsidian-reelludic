import { describe, it, expect } from 'vitest';
import { sanitizePosterTitle, orphanedDownloadedPosters, orphanCoverFiles } from 'pure/posterFile';

describe('pure/posterFile 封面文件名标题清洗', () => {
    it('普通标题原样保留', () => {
        expect(sanitizePosterTitle('海贼王')).toBe('海贼王');
        expect(sanitizePosterTitle('The Godfather')).toBe('The Godfather');
    });

    it('半角非法字符替换为下划线，全角标点合法保留', () => {
        expect(sanitizePosterTitle('星际穿越：IMAX')).toBe('星际穿越：IMAX'); // 全角冒号 NTFS 合法，保留
        expect(sanitizePosterTitle('A/B: C*D?E"F<G>H|I')).toBe('A_B_ C_D_E_F_G_H_I');
    });

    it('首尾空白去除', () => {
        expect(sanitizePosterTitle('  千与千寻  ')).toBe('千与千寻');
    });

    it('空/纯空白标题清洗后为空（调用方兜底）', () => {
        expect(sanitizePosterTitle('')).toBe('');
        expect(sanitizePosterTitle('   ')).toBe('');
    });
});

describe('pure/posterFile 弹窗未保存封面孤儿清理', () => {
    it('未保存（keep 缺省）→ 本次下载的全部本地封面应删除', () => {
        expect(orphanedDownloadedPosters(['封面/我的世界.jpg', '封面/部落冲突.jpg'])).toEqual(['封面/我的世界.jpg', '封面/部落冲突.jpg']);
    });

    it('保存成功且引用其中一个 → 仅保留被引用的封面，其余删除', () => {
        expect(orphanedDownloadedPosters(['封面/A.jpg', '封面/B.jpg'], '封面/B.jpg')).toEqual(['封面/A.jpg']);
    });

    it('保存时封面被清空（keep 空串）→ 全部删除', () => {
        expect(orphanedDownloadedPosters(['封面/A.jpg'], '')).toEqual(['封面/A.jpg']);
    });

    it('空列表 / 无下载 → 空结果', () => {
        expect(orphanedDownloadedPosters([])).toEqual([]);
    });

    it('重复下载路径去重（同一次会话多次选中同一结果）', () => {
        expect(orphanedDownloadedPosters(['封面/A.jpg', '封面/A.jpg'])).toEqual(['封面/A.jpg']);
    });
});

describe('pure/posterFile 封面目录孤儿扫描（H 清理工具）', () => {
    it('未被任何条目引用的封面文件 → 列出', () => {
        const coverFiles = ['封面/三体.jpg', '封面/孤儿1.jpg', '封面/孤儿2.jpg'];
        const referenced = ['封面/三体.jpg'];
        expect(orphanCoverFiles(coverFiles, referenced).sort()).toEqual(['封面/孤儿1.jpg', '封面/孤儿2.jpg']);
    });

    it('全部被引用 → 空', () => {
        const coverFiles = ['封面/A.jpg', '封面/B.jpg'];
        const referenced = ['封面/A.jpg', '封面/B.jpg'];
        expect(orphanCoverFiles(coverFiles, referenced)).toEqual([]);
    });

    it('引用含 URL 不参与本地比对（URL 封面不算本地文件）', () => {
        const coverFiles = ['封面/A.jpg'];
        const referenced = ['https://img.doubanio.com/A.jpg'];
        expect(orphanCoverFiles(coverFiles, referenced)).toEqual(['封面/A.jpg']);
    });

    it('引用去重与空值过滤', () => {
        const coverFiles = ['封面/A.jpg'];
        const referenced = ['封面/A.jpg', '封面/A.jpg', '', undefined as never];
        expect(orphanCoverFiles(coverFiles, referenced)).toEqual([]);
    });
});
