import { describe, expect, it } from 'vitest';
// @vitest-environment jsdom
import { FOLD_SELECTOR, rememberOpenFolds, restoreOpenFolds } from 'pure/detailsState';

/**
 * 守卫的是 2026-11-06 真机暴露过的回归：
 * 「沉浸体验 › 语音服务」的卡在装完引擎后**原地重画**，重画把 `<details>` 打回初始态，
 * 而折叠块的初始态常常是「缺程序或缺模型才展开」——装成功后条件变假，
 * 用户展开着看的折叠块反而合上，看不到刚装出来的结果。
 *
 * ⚠️ 2026-11-06 晚（m08661，A 版三段平铺）之后，音频转文字卡里已不再有折叠块、
 *    `FOLD_SELECTOR` 也放宽成裸 `details`（理由见模块头注释）。本文件因此按**新的口径**断言：
 *    「卡内任意 details」都要被照顾到，而不是只认那三个历史类名。
 */
function mount(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

describe('pure/detailsState 折叠状态记忆', () => {
    it('只收展开的折叠块，收起的一律不收', () => {
        const root = mount(`
            <details class="rl-asr-more" open><summary>更多</summary></details>
            <details class="rl-asr-back"><summary>备用</summary></details>
            <details class="something-else" open><summary>别的</summary></details>
        `);
        // 🔴 选择器是裸 details ⇒ 卡内任意展开的折叠块都要保住，不再按类名过滤。
        //    这正是放宽的目的：以后在卡里加折叠块不必再回来改两处。
        expect(rememberOpenFolds(root)).toEqual(['rl-asr-more', 'something-else']);
    });

    it('没有任何展开的折叠块时返回空数组', () => {
        const root = mount('<details class="rl-asr-more"></details>');
        expect(rememberOpenFolds(root)).toEqual([]);
    });

    it('空容器返回空数组，不抛错', () => {
        expect(rememberOpenFolds(mount(''))).toEqual([]);
    });

    it('重画之后能把展开状态还原（这就是这个模块存在的唯一理由）', () => {
        const root = mount('<details class="rl-asr-more" open></details>');
        const opened = rememberOpenFolds(root);
        expect(opened).toEqual(['rl-asr-more']);

        // 模拟重画：清空 + 用**初始态**重建（新节点不带 open —— 正是自动展开条件变假后的样子）
        root.innerHTML = '<details class="rl-asr-more"></details>';
        expect(root.querySelector('details')?.hasAttribute('open')).toBe(false);

        expect(restoreOpenFolds(root, opened)).toBe(1);
        expect(root.querySelector('details')?.hasAttribute('open')).toBe(true);
    });

    it('带多个 class 的元素用整个 class 串当键，也能还原', () => {
        const root = mount('<details class="rl-asr-manual is-on" open></details>');
        const opened = rememberOpenFolds(root);
        expect(opened).toEqual(['rl-asr-manual is-on']);

        root.innerHTML = '<details class="rl-asr-manual is-on"></details>';
        expect(restoreOpenFolds(root, opened)).toBe(1);
        expect(root.querySelector('details')?.hasAttribute('open')).toBe(true);
    });

    it('重画后某块已不存在时跳过，不抛错，返回值只算真正还原的', () => {
        const root = mount('<details class="rl-asr-more"></details>');
        // 换引擎后「备用模型库」那块可能整块不在
        expect(restoreOpenFolds(root, ['rl-asr-back', 'rl-asr-more'])).toBe(1);
    });

    it('class 串里的多余空白不影响还原', () => {
        const root = mount('<details class="rl-asr-more"></details>');
        expect(restoreOpenFolds(root, ['  rl-asr-more  '])).toBe(1);
    });

    it('className 为空的元素不记（否则选择器会拼成 details. 而匹配不到任何东西）', () => {
        const root = mount('<details open></details>');
        expect(rememberOpenFolds(root)).toEqual([]);
    });

    it('FOLD_SELECTOR 是裸 details：卡内新加的折叠块无需改代码就被保护', () => {
        const root = mount(`
            <details class="rl-brand-new-fold" open></details>
            <details class="rl-notes-fold" open></details>
        `);
        expect(FOLD_SELECTOR).toBe('details');
        expect(rememberOpenFolds(root)).toEqual(['rl-brand-new-fold', 'rl-notes-fold']);
        // 自定义选择器依然可用（需要把范围收窄时）
        expect(rememberOpenFolds(root, 'details.rl-notes-fold')).toEqual(['rl-notes-fold']);
    });
});
