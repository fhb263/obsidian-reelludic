import { describe, it, expect } from 'vitest';
import { TOAST_MS, TOAST_SAVED, TOAST_FAILED, shouldFlashSaved } from 'pure/toast';

describe('pure/toast 自动保存轻提示（#593：1.5 秒 + 显示期间不重弹）', () => {
    it('🔴 停留时长 = 1500ms（用户给定「改成 1.5 秒」—— ⛔ 不是旧的 3000）', () => {
        expect(TOAST_MS).toBe(1500);
    });

    it('文案真源不变（成功 / 失败两句）', () => {
        expect(TOAST_SAVED).toBe('设置已保存');
        expect(TOAST_FAILED).toBe('保存失败，请重试');
    });

    it('🔴 提示**正在显示**时的成功保存 ⇒ 不重弹（高频操作不闪烁）', () => {
        expect(shouldFlashSaved(true, false)).toBe(false);
    });

    it('🔴 提示**已消失** ⇒ 照常弹（就是用户说的「1.5 秒后再次操作才重新弹出」）', () => {
        expect(shouldFlashSaved(false, false)).toBe(true);
    });

    it('🔴 失败态**例外**：报错必须看得见（成功提示还在也要换成红字）', () => {
        expect(shouldFlashSaved(true, true)).toBe(true);
        expect(shouldFlashSaved(false, true)).toBe(true);
    });
});
