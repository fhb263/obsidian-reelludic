// @vitest-environment jsdom
/**
 * `services/filePick` 单测（#425）—— 书源导入的**唯一**文件选择实现。
 *
 * 🔴 这里测的是**结构**（input 在不在 label 里、change 之后怎么落结果、value 有没有清），
 *    ⛔ 不是「系统文件框到底弹没弹」—— jsdom 不会真弹框，那条只能靠实机验证。
 *    ⚠️ 前两轮就是被「CDP 拦截式假实测」带偏的（拦的是协议事件，绕过了"真实框有没有打开"）。
 */
import { describe, expect, it, vi } from 'vitest';
import { mountFilePickLabel, type FilePickOptions } from 'services/filePick';

function mount(extra: Partial<FilePickOptions> = {}) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const onText = vi.fn();
    const onError = vi.fn();
    const label = mountFilePickLabel(parent, { cls: 'rl-btn', text: '导入…', onText, onError, ...extra });
    const input = label.querySelector('input[type=file]') as HTMLInputElement;
    return { parent, label, input, onText, onError };
}

/** 塞一个假 File 进 `input.files`（jsdom 不许直接改 files ⇒ 用 defineProperty） */
function attachFile(input: HTMLInputElement, text: string, name = 'a.json'): File {
    const file = new File([text], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    return file;
}

/** 等一轮微任务（`file.text()` 是 Promise） */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('filePick · 点按钮选文件（#425）', () => {
    it('🔴 `<input>` **就在 label 里**（不增删、不搬运）—— 前两轮「点了没反应」正出在「JS 建 input → 挂 body → click()」那条路上', () => {
        const { label, input, parent } = mount();
        expect(input).toBeTruthy();
        expect(label.contains(input)).toBe(true);
        parent.remove();
    });

    it('🔴 页面里**只有一个** file input（⛔ 不许再往 body 上另挂隐藏节点、也不许留残留）', () => {
        const { input, parent } = mount();
        expect(document.body.querySelectorAll('input[type=file]').length).toBe(1);
        expect(input.closest('body')).toBe(document.body);
        parent.remove();
        expect(document.body.querySelectorAll('input[type=file]').length).toBe(0);
    });

    it('🔴 隐藏方式**不是 `display:none`**：走 `.rl-file-pick`（绝对定位铺满 + `opacity:0`）—— 不可见元素的 click() 会静默失效，那正是要避开的形态', () => {
        const { input, parent } = mount();
        expect(input.className).toContain('rl-file-pick');
        expect(input.style.display).not.toBe('none');
        parent.remove();
    });

    it('文字、样式类、tip、accept 都可覆盖（⛔ 别把扩展名写死在实现里）', () => {
        const { label, input, parent } = mount({ cls: 'rl-btn rl-src-import', text: '换一个', tip: '提示', accept: '.txt' });
        expect(label.textContent).toContain('换一个');
        expect(label.className).toContain('rl-src-import');
        expect(label.className).toContain('rl-file-label');
        expect(label.getAttribute('data-tip')).toBe('提示');
        expect(input.accept).toBe('.txt');
        parent.remove();
    });

    it('change ⇒ 读出文本交给 `onText`（连带 `File` 一起给）', async () => {
        const { input, onText, parent } = mount();
        attachFile(input, '{"a":1}');
        input.dispatchEvent(new Event('change'));
        await tick();
        expect(onText).toHaveBeenCalledTimes(1);
        expect(onText.mock.calls[0][0]).toBe('{"a":1}');
        expect((onText.mock.calls[0][1] as File).name).toBe('a.json');
        parent.remove();
    });

    it('🔴 change 之后**立刻清空 `value`**：不清的话「改完文件再选同一个文件」不会触发 change —— 表现同样像「点了没反应」'
        + '｜⚠️ file input 的 `value` **只允许程序化设成空串**（浏览器安全限制）⇒ 这里用 setter 观测它有没有被清',
        () => {
            const { input, parent } = mount();
            let cleared = false;
            Object.defineProperty(input, 'value', {
                configurable: true,
                get: () => 'C:/fakepath/a.json',
                set: (v: string) => {
                    if (v === '') cleared = true;
                },
            });
            attachFile(input, '{}');
            input.dispatchEvent(new Event('change'));
            expect(cleared).toBe(true);
            parent.remove();
        });

    it('没选文件（用户取消）⇒ 什么都不做，⛔ 不报错、不回调', () => {
        const { input, onText, onError, parent } = mount();
        Object.defineProperty(input, 'files', { value: [], configurable: true });
        input.dispatchEvent(new Event('change'));
        expect(onText).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        parent.remove();
    });

    it('读文件失败 ⇒ 走 `onError`（⛔ 不静默吞）', async () => {
        const { input, onError, parent } = mount();
        const file = attachFile(input, 'x');
        vi.spyOn(file, 'text').mockRejectedValue(new Error('boom'));
        input.dispatchEvent(new Event('change'));
        await tick();
        expect(onError).toHaveBeenCalled();
        parent.remove();
    });
});
