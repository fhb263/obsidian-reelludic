// 摘抄就地卡片纯逻辑测试：引用收起判定 / 键盘动作（Enter 提交 + 输入法保护）/ 信息行文案 / 浮层落位
import { describe, it, expect } from 'vitest';
import {
    QUOTE_EXPAND_THRESHOLD,
    needsQuoteExpand,
    excerptCardKeyAction,
    excerptCardLocLabel,
    placeCard,
} from 'pure/excerptCard';

describe('needsQuoteExpand（引用块默认收起判定）', () => {
    it('短引用不需要展开', () => {
        expect(needsQuoteExpand('很短的一句')).toBe(false);
    });

    it('阈值处为界：等于不展开、多一字展开', () => {
        expect(needsQuoteExpand('x'.repeat(QUOTE_EXPAND_THRESHOLD))).toBe(false);
        expect(needsQuoteExpand('x'.repeat(QUOTE_EXPAND_THRESHOLD + 1))).toBe(true);
    });

    it('忽略首尾空白后再判定（选区常带换行缩进）', () => {
        expect(needsQuoteExpand(`\n  ${'x'.repeat(QUOTE_EXPAND_THRESHOLD)}  \n`)).toBe(false);
    });

    it('可传自定义阈值；空串不展开', () => {
        expect(needsQuoteExpand('abcd', 3)).toBe(true);
        expect(needsQuoteExpand('', 3)).toBe(false);
    });
});

describe('excerptCardKeyAction（卡片内键盘动作）', () => {
    it('Ctrl+Enter / ⌘+Enter 提交（用户 2026-09-17 二次裁定：想法多行，Enter 留给换行）', () => {
        expect(excerptCardKeyAction({ key: 'Enter', ctrlKey: true })).toBe('submit');
        expect(excerptCardKeyAction({ key: 'Enter', metaKey: true })).toBe('submit');
    });

    it('单独 Enter 与 Shift+Enter 都不提交（留给换行）', () => {
        expect(excerptCardKeyAction({ key: 'Enter' })).toBe('ignore');
        expect(excerptCardKeyAction({ key: 'Enter', shiftKey: true })).toBe('ignore');
    });

    it('🔴 输入法组合态一律忽略（中文选词的 Enter 不是命令）', () => {
        expect(excerptCardKeyAction({ key: 'Enter', composing: true })).toBe('ignore');
        expect(excerptCardKeyAction({ key: 'Enter', ctrlKey: true, composing: true })).toBe('ignore');
        expect(excerptCardKeyAction({ key: 'Process' })).toBe('ignore');
        expect(excerptCardKeyAction({ key: 'Unidentified', composing: true })).toBe('ignore');
    });

    it('其它按键不处理（Esc 交回上层：只收卡片不关阅读器，由 scope 处理）', () => {
        expect(excerptCardKeyAction({ key: 'a' })).toBe('ignore');
        expect(excerptCardKeyAction({ key: 'Escape' })).toBe('ignore');
    });
});

describe('excerptCardLocLabel（卡片信息行）', () => {
    it('书名 + 章 + 百分比（分隔符沿用项目 ` · ` 两侧带空格风格）', () => {
        expect(excerptCardLocLabel('书名', { chapter: 3, pct: 18 })).toBe('摘自《书名》 · 第 3 章 · 18%');
    });

    it('无百分比时只到章（不留分隔符残渣）', () => {
        expect(excerptCardLocLabel('书名', { chapter: 3, pct: 0 })).toBe('摘自《书名》 · 第 3 章');
    });

    it('无定位时只有书名', () => {
        expect(excerptCardLocLabel('书名')).toBe('摘自《书名》');
        expect(excerptCardLocLabel('书名', { chapter: 0, pct: 0 })).toBe('摘自《书名》');
    });

    it('百分比取整；标题缺失回落中性词（文案规范：不出现具体名称）', () => {
        expect(excerptCardLocLabel('书名', { chapter: 1, pct: 18.6 })).toBe('摘自《书名》 · 第 1 章 · 19%');
        expect(excerptCardLocLabel('')).toBe('摘自《作品名称》');
    });
});

describe('placeCard（就地浮层落位：贴锚点上方、放不下转下方、四周钳制）', () => {
    const box = { boxW: 800, boxH: 600 };

    it('默认水平居中于锚点、贴其上方', () => {
        expect(placeCard({ anchorX: 400, anchorY: 300, cardW: 320, cardH: 200, ...box })).toEqual({ left: 240, top: 92 });
    });

    it('上方放不下 → 转锚点下方', () => {
        expect(placeCard({ anchorX: 400, anchorY: 40, cardW: 320, cardH: 200, ...box })).toEqual({ left: 240, top: 48 });
    });

    it('右侧越界 → 钳到容器右内边距', () => {
        expect(placeCard({ anchorX: 780, anchorY: 300, cardW: 320, cardH: 200, ...box }).left).toBe(476);
    });

    it('左侧越界 → 钳到 4px', () => {
        expect(placeCard({ anchorX: 0, anchorY: 300, cardW: 320, cardH: 200, ...box }).left).toBe(4);
    });

    it('卡片比容器还宽 → 仍留在左边（左钳优先，不出现负值）', () => {
        expect(placeCard({ anchorX: 100, anchorY: 300, cardW: 900, cardH: 200, ...box }).left).toBe(4);
    });
});
