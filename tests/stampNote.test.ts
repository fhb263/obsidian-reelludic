// 🔴 m04435 ①：右键「时间戳笔记」浮层 —— 心情 + 备注的**落盘文案**（纯函数）。
//
// 用户原话：「右键：弹出"时间戳笔记"浮层 … 选择心情后生成记录并展示为：`20:15 震撼emoji`
//   （右键未选择直接关闭，不生成记录）」；
// 当场裁定：⑴ 写入时机 =「选心情只是选中，再点「写入笔记」才落」；⑵ 要有备注输入框，
//   文字接在心情后面。
//
// 这个文件守的是**最容易悄悄坏掉**的那层：文案拼接。它错了不会报错、不会崩，只会让笔记里
// 出现 `🤩 震撼  备注`（双空格）或 `[0:20](链接) `（尾随空格）这种脏数据 —— 后者 Obsidian
// 会把链接 token 当成坏 URL。
import { describe, expect, it } from 'vitest';
import { STAMP_NOTE_COMMIT, STAMP_NOTE_TITLE, stampNoteCaption, stampNoteLine, stampNotePreview } from 'pure/stampNote';

describe('🔴 m04435 ① 落盘文案：心情在前、备注在后', () => {
    it('🔴 心情 + 备注 = `🤩 震撼 备注文字`（心情取自 pure/mood，⛔ 不手抄 emoji）', () => {
        expect(stampNoteCaption('wow', '这段配乐绝了')).toBe('🤩 震撼 这段配乐绝了');
    });

    it('🔴 只有心情：不带尾随空格', () => {
        expect(stampNoteCaption('heal', '')).toBe('🥰 治愈');
        expect(stampNoteCaption('heal', undefined)).toBe('🥰 治愈');
        expect(stampNoteCaption('heal', '   ')).toBe('🥰 治愈');
    });

    it('🔴 只有备注：⛔ 不留空槽占位（不许出现前导空格或空 emoji 位）', () => {
        expect(stampNoteCaption(undefined, '这句台词真好')).toBe('这句台词真好');
        expect(stampNoteCaption(undefined, '')).toBe('');
    });

    it('🔴 两者都空 ⇒ 空串（调用方据此退化成纯时间戳，与左键单击一致）', () => {
        expect(stampNoteCaption(undefined, undefined)).toBe('');
        expect(stampNoteCaption(undefined, '  ')).toBe('');
    });

    it('备注里的换行/连续空白压成一个空格（笔记行是单行）', () => {
        expect(stampNoteCaption('sad', '第一句\n第二句')).toBe('😭 致郁 第一句 第二句');
        expect(stampNoteCaption('sad', 'a   b')).toBe('😭 致郁 a b');
    });

    it('非法心情 id 当成没选（⛔ 不崩、也不回退第一档）', () => {
        expect(stampNoteCaption('nope' as never, '备注')).toBe('备注');
    });
});

describe('🔴 m04435 ① 落盘文案：接到链接后面', () => {
    const LINK = '[0:20](obsidian://reelludic?entry=e1&t=20)';

    it('🔴 有补充文字 ⇒ `链接 空格 文字`', () => {
        expect(stampNoteLine(LINK, '🤩 震撼 绝了')).toBe(`${LINK} 🤩 震撼 绝了`);
    });

    it('🔴 无补充文字 ⇒ **原样返回链接**（⛔ 不许加尾随空格，那会让 token 被当坏 URL）', () => {
        expect(stampNoteLine(LINK, '')).toBe(LINK);
        expect(stampNoteLine(LINK, '   ')).toBe(LINK);
        expect(stampNoteLine(LINK, undefined as never)).toBe(LINK);
    });

    it('空链接 ⇒ 空串（不产出半截行）', () => {
        expect(stampNoteLine('', '备注')).toBe('');
        expect(stampNoteLine('   ', '备注')).toBe('');
    });
});

describe('🔴 m04435 ① 预览窗', () => {
    it('🔴 `0:20 🤩 震撼 备注`（时间文字由宿主给，多集时形如 `第3集·0:20`）', () => {
        expect(stampNotePreview('0:20', 'wow', '绝了')).toBe('0:20 🤩 震撼 绝了');
        expect(stampNotePreview('第3集·0:20', 'wow', '')).toBe('第3集·0:20 🤩 震撼');
    });

    it('🔴 预览里⛔ 不出现链接正文（用户不该看到 `obsidian://…`）', () => {
        const s = stampNotePreview('0:20', 'wow', '绝了');
        expect(s).not.toContain('obsidian://');
        expect(s).not.toContain('](]');
    });

    it('两者都空 ⇒ 只有时间（预览仍要能看出「会写哪一刻」）', () => {
        expect(stampNotePreview('0:20', undefined, '')).toBe('0:20');
    });

    it('时间文字为空也不崩（回落到只有心情/备注）', () => {
        expect(stampNotePreview('', 'wow', '绝了')).toBe('🤩 震撼 绝了');
    });
});

describe('🔴 m04435 ① 文案常量', () => {
    it('浮层标题就是用户点名的「时间戳笔记」', () => {
        expect(STAMP_NOTE_TITLE).toBe('时间戳笔记');
    });

    it('提交按钮文案是「写入笔记」（对应用户裁定的「再点一下才落」）', () => {
        expect(STAMP_NOTE_COMMIT).toBe('写入笔记');
    });
});
