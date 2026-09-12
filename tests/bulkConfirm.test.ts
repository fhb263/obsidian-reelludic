import { describe, it, expect } from 'vitest';
import { describeBulkApply } from 'pure/bulkConfirm';

describe('pure/bulkConfirm 批量应用前置确认文案', () => {
    it('无选中项 → null（不弹窗）', () => {
        expect(describeBulkApply({ count: 0, statusLabel: '已看' })).toBeNull();
    });

    it('选中了但没有任何要改的项 → null', () => {
        expect(describeBulkApply({ count: 12 })).toBeNull();
        expect(describeBulkApply({ count: 12, rating: 0 })).toBeNull();
        expect(describeBulkApply({ count: 12, statusLabel: '   ' })).toBeNull();
        expect(describeBulkApply({ count: 12, tags: [] })).toBeNull();
    });

    it('仅状态：写明项数与该状态', () => {
        const m = describeBulkApply({ count: 12, statusLabel: '已看' });
        expect(m).toContain('12 项');
        expect(m).toContain('状态改为「已看」');
    });

    it('仅评分 1~5：写明星级', () => {
        expect(describeBulkApply({ count: 3, rating: 4 })).toContain('个人评分改为 4★');
    });

    it('rating 显式 null → 清除评分', () => {
        expect(describeBulkApply({ count: 3, rating: null })).toContain('清除个人评分');
    });

    it('仅标签：顿号连接，去空/去重/去首尾空白且保序', () => {
        const m = describeBulkApply({ count: 5, tags: ['科幻', ' 经典 ', '科幻', '', '  '] });
        expect(m).toContain('追加标签：科幻、经典');
    });

    it('三项齐全：按 状态 → 评分 → 标签 顺序，分号分隔', () => {
        const m = describeBulkApply({ count: 8, statusLabel: '在看', rating: 5, tags: ['神作'] });
        expect(m).toContain('状态改为「在看」；个人评分改为 5★；追加标签：神作');
    });

    it('诚实告知会一并更新笔记、且不可一键撤销', () => {
        const m = describeBulkApply({ count: 2, statusLabel: '已看' });
        expect(m).toContain('笔记');
        expect(m).toContain('不可一键撤销');
    });

    it('项数非法（负数 / NaN）按 0 处理 → null', () => {
        expect(describeBulkApply({ count: -3, statusLabel: '已看' })).toBeNull();
        expect(describeBulkApply({ count: NaN, statusLabel: '已看' })).toBeNull();
    });

    it('项数小数向下取整', () => {
        expect(describeBulkApply({ count: 3.9, statusLabel: '已看' })).toContain('3 项');
    });

    it('文案为单行（ConfirmModal 描述区居中、不解析换行）', () => {
        const m = describeBulkApply({ count: 4, statusLabel: '已看', rating: 3, tags: ['a'] });
        expect(m).not.toContain('\n');
    });
});
