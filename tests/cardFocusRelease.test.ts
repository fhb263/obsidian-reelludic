// 弹窗关闭后归还卡片焦点 —— 源码守卫（2026-11-16 用户 m00830）
//
// 用户原话：「点单卡和系列卡信息栏编辑属性退出后都存在封面悬停态不消失问题」。
//
// 🔴 根因：卡片信息栏是 `tabindex="0"` 的可点块；点它 ⇒ 焦点落在信息栏上 ⇒
//    悬停遮罩的显示条件里那半边 `.rl-card:focus-within .rl-cov-hover { opacity: 1; }` 永久命中。
//    弹窗关闭后宿主把焦点**还给**打开前的那个元素（信息栏），于是遮罩一直亮着。
//
// 🔴 口径（用户裁定「改弹窗关闭时归还焦点」）：
//    ① 两个弹窗（单卡 `EntryModal` / 系列 `SeriesPropsModal`）关闭时都要调用同一个归还动作；
//    ② 归还动作必须异步（`setTimeout(…, 0)`）—— 宿主在 `onClose()` 之后才复原焦点；
//    ③ ⛔ **不动 `:focus-within` 那半条规则**（键盘用户靠它看见「打开 ↗」）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** 剥掉块注释与行注释（⛔ 本仓多次踩到「注释里逐字写实现形态污染断言」）。 */
const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const UI = stripComments(read('src/ui/components.ts'));
const ENTRY_MODAL = stripComments(read('src/modals/EntryModal.ts'));
const SERIES_MODAL = stripComments(read('src/modals/SeriesPropsModal.ts'));

/** 取某个方法体的原文（从签名到下一个同类缩进的 `}` 收尾）。 */
function bodyOf(src: string, signature: string): string {
    const start = src.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    return src.slice(start, start + 1400);
}

describe('弹窗关闭后归还焦点（2026-11-16 m00830）', () => {
    it('归还动作只在 ui/components 里实现一份，两个弹窗共用', () => {
        expect(UI).toMatch(/export function releaseCardFocusOnClose\(\): void \{/);
        // 只对卡片内残留焦点动手（⛔ 不要把文档焦点一律清空）
        expect(UI).toMatch(/if \(active\.closest\('\.rl-card'\)\) active\.blur\(\);/);
        // 必须异步：宿主在 onClose 之后才复原焦点
        expect(UI).toMatch(/window\.setTimeout\(\(\) => \{[\s\S]{0,400}\}, 0\);/);
    });

    it('单卡编辑属性关窗时归还焦点', () => {
        expect(ENTRY_MODAL).toMatch(/import \{ releaseCardFocusOnClose \} from 'ui\/components';/);
        const body = bodyOf(ENTRY_MODAL, 'onClose(): void {');
        expect(body).toMatch(/releaseCardFocusOnClose\(\);/);
    });

    it('系列编辑属性关窗时归还焦点', () => {
        expect(SERIES_MODAL).toMatch(/import \{ releaseCardFocusOnClose \} from 'ui\/components';/);
        const body = bodyOf(SERIES_MODAL, 'onClose(): void {');
        expect(body).toMatch(/releaseCardFocusOnClose\(\);/);
        // 原有的三件套壳约定不能被挤掉（`tests/seriesProps.test.ts` 也钉着）
        expect(body).toMatch(/this\.instance\?\.\$destroy\(\);/);
        expect(body).toMatch(/this\.instance = null;/);
    });

    it('⛔ 不许靠删 :focus-within 来治悬停态', () => {
        const list = stripComments(read('src/views/components/MediaList.svelte'));
        const board = stripComments(read('src/views/components/CollectionBoard.svelte'));
        expect(list).toMatch(/\.rl-card:focus-within \.rl-cov-hover/);
        expect(board).toMatch(/\.rl-card:focus-within \.rl-cov-hover/);
    });
});
