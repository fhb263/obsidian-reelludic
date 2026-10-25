// Bases 样式片段「托管区 / 用户区」合并逻辑单测。
//
// 用户原话（m00002）：「还有这个css代码片段不生效没有悬停动效」。
//
// 根因是两条叠在一起：
//   ① 片段里的选择器 `.bases-view / .base-view` 在 Obsidian 里**不存在**
//      ⇒ 整份片段一条都没匹配上（真实类名是 `.bases-cards-group / .bases-cards-item`）；
//   ② `main.ts` 里「文件存在就跳过写盘」⇒ 就算片段修好了，**已经生成过的用户永远拿不到**。
//
// 这批判据钉的就是 ② —— 更新必须能到老用户手上，但又⛔不能把用户的定制抹掉。
import { describe, it, expect } from 'vitest';
import {
    SNIPPET_MANAGED_BEGIN,
    SNIPPET_MANAGED_END,
    mergeSnippet,
    snippetNotice,
    wrapManaged,
} from 'pure/snippetMerge';

const SHIPPED = '/* 新片段 */\n.bases-cards-group .bases-cards-item:hover { transform: translateY(-2px); }\n';

describe('wrapManaged —— 托管标记', () => {
    it('包上成对标记', () => {
        const out = wrapManaged(SHIPPED);
        expect(out.startsWith(SNIPPET_MANAGED_BEGIN)).toBe(true);
        expect(out.trimEnd().endsWith(SNIPPET_MANAGED_END)).toBe(true);
    });

    it('已经带标记 ⇒ 不重复包（幂等）', () => {
        const once = wrapManaged(SHIPPED);
        expect(wrapManaged(once)).toBe(once);
    });

    it('内容不会被改动（只加前后标记行）', () => {
        const out = wrapManaged(SHIPPED);
        expect(out).toContain(SHIPPED.trimEnd());
    });
});

describe('mergeSnippet —— 情形 1：全新文件', () => {
    it('直接写入带标记的片段，changed = true', () => {
        const r = mergeSnippet(undefined, SHIPPED);
        expect(r.changed).toBe(true);
        expect(r.keptUserContent).toBe(false);
        expect(r.content).toContain(SNIPPET_MANAGED_BEGIN);
        expect(r.content).toContain('.bases-cards-item:hover');
    });

    it('以换行结尾（约定俗成的文本文件收尾）', () => {
        expect(mergeSnippet(undefined, SHIPPED).content.endsWith('\n')).toBe(true);
    });
});

describe('mergeSnippet —— 情形 2：已有托管区（正常更新）', () => {
    const OLD = wrapManaged('/* 旧的坏选择器 */\n.bases-view img { border-radius: 8px; }\n');

    it('托管区被换成新的 —— 这正是「修复能送到老用户手上」的落点', () => {
        const r = mergeSnippet(OLD, SHIPPED);
        expect(r.changed).toBe(true);
        expect(r.content).toContain('.bases-cards-item:hover');
        expect(r.content).not.toContain('.bases-view img');
    });

    it('标记之外的用户内容**原样保留**', () => {
        const withUser = `${OLD}\n/* 我自己加的：调大封面圆角 */\n.bases-cards-item img { border-radius: 14px; }\n`;
        const r = mergeSnippet(withUser, SHIPPED);
        expect(r.changed).toBe(true);
        expect(r.keptUserContent).toBe(true);
        expect(r.content).toContain('我自己加的：调大封面圆角');
        expect(r.content).toContain('border-radius: 14px');
        // 新的托管区也进去了
        expect(r.content).toContain('.bases-cards-item:hover');
    });

    it('用户加在**前面**的内容也保留', () => {
        const withBefore = `/* 前缀区 */\n.bases-cards-item { margin: 0; }\n\n${OLD}`;
        const r = mergeSnippet(withBefore, SHIPPED);
        expect(r.content).toContain('前缀区');
    });

    it('内容已经是最新的 ⇒ changed = false（不写盘，省一次 IO）', () => {
        const current = mergeSnippet(undefined, SHIPPED).content;
        const r = mergeSnippet(current, SHIPPED);
        expect(r.changed).toBe(false);
    });

    it('重复合并是幂等的（跑第二次不会再变）', () => {
        const once = mergeSnippet(undefined, SHIPPED).content;
        const twice = mergeSnippet(once, SHIPPED);
        const thrice = mergeSnippet(twice.content, SHIPPED);
        expect(thrice.content).toBe(twice.content);
    });
});

describe('mergeSnippet —— 情形 3：老文件（无托管标记）', () => {
    const LEGACY = '/* 老版本写的片段：只有 .bases-view 那些坏选择器 */\n.bases-view img { border-radius: 8px; }\n';

    it('⛔ 不覆盖老文件：旧内容全留着', () => {
        const r = mergeSnippet(LEGACY, SHIPPED);
        expect(r.content).toContain('.bases-view img');
        expect(r.keptUserContent).toBe(true);
    });

    it('新的托管区追加在后面（修好的样式即位）', () => {
        const r = mergeSnippet(LEGACY, SHIPPED);
        expect(r.content).toContain(SNIPPET_MANAGED_BEGIN);
        expect(r.content).toContain('.bases-cards-item:hover');
        // 旧内容在前、托管区在后
        expect(r.content.indexOf('.bases-view img')).toBeLessThan(r.content.indexOf(SNIPPET_MANAGED_BEGIN));
    });

    it('追加时写明「上面是你原来的内容，未改动」', () => {
        expect(mergeSnippet(LEGACY, SHIPPED).content).toContain('未改动');
    });

    it('空文件 ⇒ 当新文件处理，不塞那句追加说明', () => {
        const r = mergeSnippet('', SHIPPED);
        expect(r.changed).toBe(true);
        expect(r.content).not.toContain('未改动');
    });

    it('老文件内容恰好已等于新片段 ⇒ changed = false（不重复追加）', () => {
        const r = mergeSnippet(`${SHIPPED.trimEnd()}\n`, SHIPPED);
        expect(r.changed).toBe(false);
    });

    it('标记只出现一半（用户删了结束标记）⇒ 当无标记处理，不吞用户内容', () => {
        const half = `${SNIPPET_MANAGED_BEGIN}\n/* 用户手删了结束标记 */\n.bases-cards-item { opacity: 1; }\n`;
        const r = mergeSnippet(half, SHIPPED);
        // 不能把 begin 之后的内容当托管区丢掉
        expect(r.content).toContain('用户手删了结束标记');
        expect(r.content).toContain('.bases-cards-item:hover');
    });
});

describe('snippetNotice —— 提示文案', () => {
    it('保留了用户内容 ⇒ 明说一句（这是「没偷偷覆盖你」的凭据）', () => {
        const text = snippetNotice('a/b.css', { content: '', changed: true, keptUserContent: true });
        expect(text).toContain('已保留');
        expect(text).toContain('a/b.css');
    });

    it('没保留 ⇒ 不提，避免噪音', () => {
        const text = snippetNotice('a/b.css', { content: '', changed: true, keptUserContent: false });
        expect(text).not.toContain('已保留');
        expect(text).toContain('a/b.css');
    });
});

describe('口径守卫', () => {
    it('标记是注释形态（⛔ 不能是会让 CSS 解析失败的东西）', () => {
        expect(SNIPPET_MANAGED_BEGIN.startsWith('/*')).toBe(true);
        expect(SNIPPET_MANAGED_BEGIN.trimEnd().endsWith('*/')).toBe(true);
        expect(SNIPPET_MANAGED_END.startsWith('/*')).toBe(true);
        expect(SNIPPET_MANAGED_END.trimEnd().endsWith('*/')).toBe(true);
    });

    it('两个标记不相同（相同会让 splitAtManaged 立刻错位）', () => {
        expect(SNIPPET_MANAGED_BEGIN).not.toBe(SNIPPET_MANAGED_END);
    });
});
