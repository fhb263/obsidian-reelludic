// 编辑浮层「自动保存」触发判据（pure/popoverAutoSave，#568 / #569 / #583）—— 守用户点名的三条口径：
//   ① 空值不保存 ② 程序填入立即保存（force）③ 没改不保存
//   #583：判据从「集浮层专用」升为**四类浮层共用**（集 / 游戏 / 音乐 / 书籍），故本测试也一并通用化。
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_KEYS, AUTOSAVE_KEY_VALUES, shouldAutoSave } from 'pure/popoverAutoSave';

describe('popoverAutoSave（浮层自动保存的三条触发口径）', () => {
    it('键空间：九条键都带 `<浮层>:<字段>` 形态，且不重复（拼错键 = 提示落错行，静默）', () => {
        expect(AUTOSAVE_KEY_VALUES.length).toBe(9);
        expect(new Set(AUTOSAVE_KEY_VALUES).size).toBe(9);
        for (const k of AUTOSAVE_KEY_VALUES) expect(k).toMatch(/^[a-z]+:[a-zA-Z]+$/);
        // 四类浮层都在（集 3 / 游戏 2 / 音乐 2 / 书籍 2）—— 🔴 #601 起音乐多一条「网络地址」
        expect(AUTOSAVE_KEY_VALUES.filter((k) => k.startsWith('ep:'))).toHaveLength(3);
        expect(AUTOSAVE_KEY_VALUES.filter((k) => k.startsWith('game:'))).toHaveLength(2);
        expect(AUTOSAVE_KEY_VALUES.filter((k) => k.startsWith('audio:'))).toHaveLength(2);
        expect(AUTOSAVE_KEY_VALUES.filter((k) => k.startsWith('book:'))).toHaveLength(2);
    });

    // ⑵ #568「为空时不触发自动保存」＋ #569「仅选中框不填入为空值不触发保存」
    it('🔴 空值一律不保存（空串 / 全空白 / 只有换行 都不算「填了」）', () => {
        expect(shouldAutoSave('', '')).toBe(false);
        expect(shouldAutoSave('', '旧值')).toBe(false);
        expect(shouldAutoSave('   ', '')).toBe(false);
        expect(shouldAutoSave('\t\n ', '')).toBe(false);
    });

    // ⑶ #569「填写了的链接路径仅再次选中而不修改不触发保存」
    it('🔴 没改不保存：与表单态里已存的那份一致 ⇒ false（悬停看一眼再走不白闪提示）', () => {
        expect(shouldAutoSave('https://b.tv/BV1', 'https://b.tv/BV1')).toBe(false);
        expect(shouldAutoSave('E:/媒体/01.mp4', 'E:/媒体/01.mp4')).toBe(false);
        // 空白差异不算改（两侧都 trim —— 提交侧写回时也会 trim）
        expect(shouldAutoSave('  开始  ', '开始')).toBe(false);
        // 已存为空、现在填了空？上面那条已覆盖；这里反向：已存有值、现在清空 ⇒ 空值优先（见上一条）
        expect(shouldAutoSave('', 'E:/媒体/01.mp4')).toBe(false);
    });

    it('真的改了才保存', () => {
        expect(shouldAutoSave('https://b.tv/BV2', 'https://b.tv/BV1')).toBe(true);
        expect(shouldAutoSave('开始', '')).toBe(true);
        expect(shouldAutoSave('E:/媒体/01.mp4', 'E:/媒体/02.mp4')).toBe(true);
    });

    it('🔴 `force`（程序填入：粘贴 / 候选回填 / 本地检索 / 浏览选文件）⇒ 立即保存，不等失焦', () => {
        expect(shouldAutoSave('https://b.tv/BV1', 'https://b.tv/BV1', true)).toBe(true);
        expect(shouldAutoSave('E:/媒体/01.mp4', '', true)).toBe(true);
    });

    it('🔴 空值优先于 `force`：程序也不许把空值当「填入」保存下去', () => {
        expect(shouldAutoSave('', '', true)).toBe(false);
        expect(shouldAutoSave('   ', '旧值', true)).toBe(false);
    });

    // #583：书籍浮层是**唯一没有第二份缓冲**的（`bookFileVal` / `readUrl` 就是表单态本身）
    //   ⇒ 它的「已存值」= **打开浮层那一刻的快照**；判据本身一字不改（同一条 `shouldAutoSave`）。
    it('#583 书籍浮层同口径：与「打开浮层时的快照」比对 ⇒ 一样是「没改不存 / 改了才存」', () => {
        const openSnapshot = '书籍/旧书名.txt';
        expect(shouldAutoSave('书籍/旧书名.txt', openSnapshot)).toBe(false);
        expect(shouldAutoSave('书籍/新书名.txt', openSnapshot)).toBe(true);
        // 清空也是「空值优先」那一档 —— 但书籍的输入框直连表单态 ⇒ 清空照样生效（提交在字段本身）
        expect(shouldAutoSave('', openSnapshot)).toBe(false);
    });

    it('🔴 #593：实时保存的防抖窗口 = 600ms（⛔ 别改成 0 —— 逐字符落库会把写盘/刷视图跑成几十次）', () => {
        expect(AUTOSAVE_DEBOUNCE_MS).toBe(600);
    });

    it('🔴 #583：八条键分别落在四类浮层（提示不会都落到同一行）', () => {
        expect(AUTOSAVE_KEYS.epTitle).toBe('ep:title');
        expect(AUTOSAVE_KEYS.gameLaunch).toBe('game:launch');
        expect(AUTOSAVE_KEYS.audioPath).toBe('audio:path');
        expect(AUTOSAVE_KEYS.bookPath).toBe('book:path');
    });
});
