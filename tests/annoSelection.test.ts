import { describe, it, expect } from 'vitest';
import {
    annoCountText,
    createAnnoSel,
    enterAnnoSel,
    exitAnnoSel,
    isAnnoSelItem,
    selectAllAnno,
    selCount,
    selectedIds,
    toggleAnnoSelItem,
} from 'pure/annoSelection';

/** #345 标注三区（书签 / 高亮 / 摘抄）的多选状态机 */
describe('annoSelection（选择模式状态机）', () => {
    it('初始态：未进入模式、无勾选', () => {
        const s = createAnnoSel();
        expect(s.on).toBe(false);
        expect(s.ids).toEqual([]);
    });

    it('进入模式清空上次勾选（避免残影）；退出模式同样清空', () => {
        const s = createAnnoSel();
        enterAnnoSel(s);
        toggleAnnoSelItem(s, 'a');
        expect(selCount(s)).toBe(1);
        exitAnnoSel(s);
        expect(s.on).toBe(false);
        expect(s.ids).toEqual([]);
        enterAnnoSel(s);
        expect(s.on).toBe(true);
        expect(s.ids).toEqual([]);
    });

    it('逐条勾选是 toggle（再点取消）', () => {
        const s = createAnnoSel();
        enterAnnoSel(s);
        toggleAnnoSelItem(s, 'a');
        toggleAnnoSelItem(s, 'b');
        expect(s.ids).toEqual(['a', 'b']);
        toggleAnnoSelItem(s, 'a');
        expect(s.ids).toEqual(['b']);
        expect(isAnnoSelItem(s, 'a')).toBe(false);
        expect(isAnnoSelItem(s, 'b')).toBe(true);
    });

    it('🔴 未进入模式时点击不产生勾选（列表项点击应走跳转）', () => {
        const s = createAnnoSel();
        toggleAnnoSelItem(s, 'a');
        expect(s.ids).toEqual([]);
        expect(isAnnoSelItem(s, 'a')).toBe(false);
    });

    it('空 id / undefined 一律忽略（旧数据无 id ⇒ 不可勾选）', () => {
        const s = createAnnoSel();
        enterAnnoSel(s);
        toggleAnnoSelItem(s, '');
        toggleAnnoSelItem(s, undefined);
        expect(s.ids).toEqual([]);
        expect(isAnnoSelItem(s, undefined)).toBe(false);
    });

    it('全选只收有 id 的条目；未进入模式时忽略', () => {
        const s = createAnnoSel();
        selectAllAnno(s, ['a', 'b']);
        expect(s.ids).toEqual([]);
        enterAnnoSel(s);
        selectAllAnno(s, ['a', undefined, 'b', '']);
        expect(s.ids).toEqual(['a', 'b']);
    });

    it('selectedIds 返回副本（外部改动不回写内部状态）', () => {
        const s = createAnnoSel();
        enterAnnoSel(s);
        toggleAnnoSelItem(s, 'a');
        const out = selectedIds(s);
        out.push('b');
        expect(s.ids).toEqual(['a']);
    });

    it('计数文案：常态「书签（3）」/ 选择模式「已选 2 / 3」', () => {
        const s = createAnnoSel();
        expect(annoCountText('书签', 3, s)).toBe('书签（3）');
        expect(annoCountText('书签', 0, s)).toBe('书签（0）');
        enterAnnoSel(s);
        toggleAnnoSelItem(s, 'a');
        toggleAnnoSelItem(s, 'b');
        expect(annoCountText('书签', 3, s)).toBe('已选 2 / 3');
    });
});
