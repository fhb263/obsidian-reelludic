import { describe, it, expect } from 'vitest';
import { MEDIA_STATUSES, STATUS_LABELS, isMediaStatus, canTransition } from 'pure/status';

describe('pure/status 状态枚举（弃剧已移除，存档替代）', () => {
    it('状态集合恰为四态（want/watching/watched/archived）', () => {
        expect(MEDIA_STATUSES).toEqual(['want', 'watching', 'watched', 'archived']);
    });

    it('isMediaStatus 正确识别', () => {
        expect(isMediaStatus('want')).toBe(true);
        expect(isMediaStatus('watching')).toBe(true);
        expect(isMediaStatus('watched')).toBe(true);
        expect(isMediaStatus('archived')).toBe(true);
        expect(isMediaStatus('dropped')).toBe(false); // 弃剧已移除
        expect(isMediaStatus('xxx')).toBe(false);
        expect(isMediaStatus(undefined)).toBe(false);
        expect(isMediaStatus(null)).toBe(false);
    });

    it('状态中文标签映射完整', () => {
        expect(STATUS_LABELS.want).toBe('想看');
        expect(STATUS_LABELS.watching).toBe('在看');
        expect(STATUS_LABELS.watched).toBe('已看');
        expect(STATUS_LABELS.archived).toBe('存档');
    });
});

describe('canTransition 状态流转校验', () => {
    it('同状态自转合法', () => {
        expect(canTransition('want', 'want')).toBe(true);
        expect(canTransition('watching', 'watching')).toBe(true);
        expect(canTransition('archived', 'archived')).toBe(true);
    });

    it('正向流转合法（主链）', () => {
        expect(canTransition('want', 'watching')).toBe(true);
        expect(canTransition('watching', 'watched')).toBe(true);
        expect(canTransition('want', 'watched')).toBe(true); // 一次看完
    });

    it('任意状态可转存档', () => {
        expect(canTransition('want', 'archived')).toBe(true);
        expect(canTransition('watching', 'archived')).toBe(true);
        expect(canTransition('watched', 'archived')).toBe(true);
    });

    it('存档可恢复回任意状态（双向自由）', () => {
        expect(canTransition('archived', 'want')).toBe(true);
        expect(canTransition('archived', 'watching')).toBe(true);
        expect(canTransition('archived', 'watched')).toBe(true);
    });

    it('回退流转不合法（存档除外）', () => {
        expect(canTransition('watched', 'want')).toBe(false);
        expect(canTransition('watched', 'watching')).toBe(false);
        expect(canTransition('watching', 'want')).toBe(false);
    });

    it('弃剧不再存在', () => {
        // @ts-expect-error 弃剧已从类型中移除
        expect(canTransition('want', 'dropped')).toBe(false);
    });
});
