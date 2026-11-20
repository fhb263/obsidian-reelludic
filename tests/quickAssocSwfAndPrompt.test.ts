// 2026-11-16 两项真机报障的守卫（用户原话：「游戏类型卡快捷关联入口里怎么没获取swf入口，
// 还有填入链接点获取后直接提示已取消获取就没反应了怎么回事」）。
//
// 🔴 ① `TextPromptModal.commit()` 必须先 resolve 再 `close()`：
//    `Modal.close()` 会**同步**跑 `onClose()`，那里有一句 `this.resolve?.(null)`。
//    原实现先 close 后 onSubmit ⇒ promise 已被解析成 `null`，调用方永远拿到「已取消」。
// 🔴 ② 游戏的快捷关联入口必须有「Flash 影片」行（浏览 / 获取），且落 `gameSwf`（与编辑表单同一字段），
//    且保存时 `undefined` = 本次没动（⛔ 别把已有值冲掉）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const PROMPT = read('src/modals/TextPromptModal.ts');
const QA = read('src/modals/QuickAssociateModal.ts');
const MAIN = read('main.ts');

describe('TextPromptModal：提交不得被自己的 onClose 抢成「取消」', () => {
    it('commit 里 resolve 在 close 之前（顺序即语义）', () => {
        const iResolve = PROMPT.indexOf('this.resolve?.(v);');
        const iClose = PROMPT.indexOf('this.close();', iResolve);
        expect(iResolve).toBeGreaterThan(-1);
        expect(iClose).toBeGreaterThan(iResolve);
        // 中间不能夹 onClose 那套解析：resolve 之后必须先把 resolve 置空
        const between = PROMPT.slice(iResolve, iClose);
        expect(between).toMatch(/this\.resolve = null;/);
    });

    it('resulve 之后 onSubmit 才会被调（否则调用方拿不到值也没意义）', () => {
        const iSubmit = PROMPT.indexOf('this.opts.onSubmit(v);');
        const iResolve = PROMPT.indexOf('this.resolve?.(v);');
        expect(iSubmit).toBeGreaterThan(iResolve);
    });

    it('onClose 里那句 null 解析仍在（取消路径不能丢）', () => {
        const tail = PROMPT.slice(PROMPT.indexOf('onClose(): void {'));
        expect(tail).toMatch(/this\.resolve\?\.\(null\);/);
    });
});

describe('QuickAssociateModal：游戏入口要有 Flash 影片行', () => {
    it('回调契约含 pickGameSwf / fetchGameSwf', () => {
        expect(QA).toMatch(/pickGameSwf\?:\s*\(\)\s*=>\s*Promise<string \| undefined>;/);
        expect(QA).toMatch(/fetchGameSwf\?:\s*\(\)\s*=>\s*Promise<\{ ok: boolean; message: string; relPath\?: string \}>;/);
    });

    it('结果契约含 gameSwf', () => {
        expect(QA).toMatch(/gameSwf\?:\s*string;/);
    });

    it('只在 game 类型且注入能力时建这一行', () => {
        // 2026-11-16 用户「改成关联目录」后多出 `pickGameSwfDir` 这第三种能力，
        // 条件随之扩了一项 —— 三种能力任意一个存在就要建行（⛔ 别退回只判两个）。
        expect(QA).toMatch(
            /if \(t === 'game' && \(this\.cbs\.pickGameSwf \|\| this\.cbs\.fetchGameSwf \|\| this\.cbs\.pickGameSwfDir\)\) \{/,
        );
        expect(QA).toMatch(/swfLbl\.createDiv\(\{ cls: 'rl-qa-lbl', text: 'Flash 影片' \}\);/);
    });

    it('两枚按钮各按注入情况渲染（⛔ 不画点了没反应的按钮）', () => {
        expect(QA).toMatch(/if \(this\.cbs\.pickGameSwf\) \{/);
        expect(QA).toMatch(/if \(this\.cbs\.fetchGameSwf\) \{/);
        expect(QA).toMatch(/'选择本地 \.swf 影片'/);
        // 🔴 m18062（用户：「悬停文案不要超过1行」）：原「填游戏详情页地址（4399 / 7k7k / 17yy 等），
        //    自动找出真实 swf 并下载入库」425px 超一行预算 ⇒ 精简成下面这句。
        //    判据意图不变：这枚「获取」按钮必须带一句说明它到底干什么。
        expect(QA).toMatch(/自动找 swf 下载/);
    });

    it('输入框回填 entry.gameSwf，且值参与 collectResult', () => {
        expect(QA).toMatch(/this\.singleSwfInput\.value = this\.entry\.gameSwf \?\? '';/);
        expect(QA).toMatch(/if \(this\.singleSwfInput\) r\.gameSwf = this\.singleSwfInput\.value\.trim\(\) \|\| undefined;/);
    });

    it('提示能路由到 swf 那一行（否则提示会跑到「本地路径」误导用户）', () => {
        expect(QA).toMatch(/this\.lastField = 'swf';/);
        expect(QA).toMatch(/this\.lastField === 'swf'/);
        // 2026-11-16 m04805 起多出 `'embed'` 一档（内嵌播放页行也有自己的标签行）
        expect(QA).toMatch(/rowHints: Partial<Record<'url' \| 'local' \| 'sub' \| 'swf' \| 'embed', HTMLElement>>/);
    });

    it('获取在途要禁用按钮并复原文案（防并发下两份）', () => {
        expect(QA).toMatch(/btn\.disabled = true;/);
        expect(QA).toMatch(/btn\.setText\('获取中…'\);/);
        expect(QA).toMatch(/btn\.disabled = false;/);
        expect(QA).toMatch(/btn\.setText\(prevText\);/);
    });

    it('用户主动取消不再重复弹「已取消」', () => {
        expect(QA).toMatch(/r\.message !== '已取消获取'/);
    });
});

describe('宿主侧接线：注入走编辑表单同一条链，落库不冲值', () => {
    it('只对 game 注入两个回调，且复用 pickGameSwfPath / promptFetchGameSwf', () => {
        expect(MAIN).toMatch(/\.\.\.\(entry\.type === 'game'/);
        expect(MAIN).toMatch(/pickGameSwf: \(\) => this\.pickGameSwfPath\(\),/);
        // 🔴 必须把条目 id 带下去：落盘文件名 =「条目标题.swf」，漏了 id 就退回 URL 末段（`04.swf`）
        expect(MAIN).toMatch(/fetchGameSwf: \(\) => this\.promptFetchGameSwf\(entry\.id\),/);
    });

    it('获取链全程把条目 id 传到 fetchGameSwf（用户报障「没有根据条目笔记重命名」）', () => {
        expect(MAIN).toMatch(/async promptFetchGameSwf\(entryId\?: string\)/);
        expect(MAIN).toMatch(/return this\.fetchGameSwf\(url, entryId\);/);
    });

    it('保存时 undefined = 本次没动（⛔ 别写成 ?? || undefined）', () => {
        expect(MAIN).toMatch(/if \(r\.gameSwf !== undefined\) patch\.gameSwf = r\.gameSwf\.trim\(\) \|\| undefined;/);
        expect(MAIN).not.toMatch(/patch\.gameSwf = r\.gameSwf\?\.trim\(\)/);
    });
});
