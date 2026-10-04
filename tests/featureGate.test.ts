// #468 书籍下载封禁门控（`pure/featureGate`）—— 单一真源。
//
// 🔴 本文件的断言**故意钉住当前的封禁态**：门控是「用户裁定后手工翻」的开关，
//    解禁时必须**显式改动这里**（把它翻成 `true`），而不是悄悄漂移 —— 所以测试红了不是误报，是提醒。
// ⚠️ 类型必须是 `boolean`（不是字面量 `false`）：见模块头的说明，字面量会让消费点的分支被判不可达。

import { describe, it, expect } from 'vitest';
import { BOOK_DOWNLOAD_ENABLED } from 'pure/featureGate';

describe('featureGate · 书籍下载封禁（#468）', () => {
    it('当前为封禁态（用户 2026-10-01 裁定：这类搞不定，规划到未来再解禁）', () => {
        expect(BOOK_DOWNLOAD_ENABLED).toBe(false);
    });

    it('类型是 boolean（不是字面量 false）—— 否则 if (门控) 的分支会被判不可达并有被 esbuild 消除的风险', () => {
        // 运行期看：值相等即通过；真正的类型约束由 `tsc` 守（此处显式标注一遍，改窄会编译报错）
        const asBool: boolean = BOOK_DOWNLOAD_ENABLED;
        expect(typeof asBool).toBe('boolean');
    });
});
