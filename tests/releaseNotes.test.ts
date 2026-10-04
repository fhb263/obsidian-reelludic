// 「关于 › 更新日志」弹窗正文的版本一句话表（#492）。
//
// 🔴 守的是三件事：① **顺序**（最新在前 —— 弹窗第一行就是当前版本）；② **形态**
//（版本号 `x.y.z` / 日期 `yyyy-mm-dd` / 一句话以「。」收尾且不啰嗦）；③ **markdown 产出的形状**
//（每条一行 `- **vX.Y.Z**（yyyy-mm-dd）：…`，行数 == 条目数）。
// ⚠️ 「版本号与日期必须与用户向 CHANGELOG 的标题逐字一致」这条**不在单测里**（它要读仓根文件，
//    属断言脚本的活 —— 见 assert-symbols 的 #492 块），这里只钉形态与顺序。
import { describe, it, expect } from 'vitest';
import { RELEASE_NOTES, RELEASES_URL, releaseNotesMd } from 'pure/releaseNotes';

describe('RELEASE_NOTES 版本一句话表', () => {
    it('非空，且每条的 version / date / summary 都不为空', () => {
        expect(RELEASE_NOTES.length).toBeGreaterThan(0);
        for (const n of RELEASE_NOTES) {
            expect(n.version.trim()).not.toBe('');
            expect(n.date.trim()).not.toBe('');
            expect(n.summary.trim()).not.toBe('');
        }
    });

    it('版本号与日期都是固定形态（x.y.z / yyyy-mm-dd —— 版号不带 v 前缀）', () => {
        for (const n of RELEASE_NOTES) {
            expect(n.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it('顺序 = 最新在前，且没有重复版本号', () => {
        const asNum = (v: string) => v.split('.').map(Number);
        for (let i = 1; i < RELEASE_NOTES.length; i++) {
            const prev = asNum(RELEASE_NOTES[i - 1].version);
            const cur = asNum(RELEASE_NOTES[i].version);
            const cmp = prev[0] - cur[0] || prev[1] - cur[1] || prev[2] - cur[2];
            expect(cmp, `第 ${i} 条 ${RELEASE_NOTES[i].version} 应小于上一条 ${RELEASE_NOTES[i - 1].version}`).toBeGreaterThan(0);
        }
        expect(new Set(RELEASE_NOTES.map((n) => n.version)).size).toBe(RELEASE_NOTES.length);
    });

    it('每条都是**一句话**：以「。」收尾，且长度收敛（⛔ 不退回成一段散文）', () => {
        for (const n of RELEASE_NOTES) {
            expect(n.summary.endsWith('。'), `${n.version} 的说明应以句号收尾`).toBe(true);
            expect(n.summary.length, `${n.version} 的说明过长`).toBeLessThanOrEqual(80);
            // ⛔ 不许出现换行 / 列表符号 —— 一句话就该是一行
            expect(/[\n\r]/.test(n.summary)).toBe(false);
        }
    });
});

describe('releaseNotesMd 弹窗正文', () => {
    it('每条一行，形状 = `- **vX.Y.Z**（yyyy-mm-dd）：…`，行数 == 条目数', () => {
        const lines = releaseNotesMd().split('\n');
        expect(lines.length).toBe(RELEASE_NOTES.length);
        RELEASE_NOTES.forEach((n, i) => {
            expect(lines[i].startsWith(`- **v${n.version}**（${n.date}）：`)).toBe(true);
            expect(lines[i].endsWith(n.summary)).toBe(true);
        });
    });

    it('正文里不出现节标题（`#`）与空行 —— 标题由弹窗自己渲染', () => {
        expect(/^#/m.test(releaseNotesMd())).toBe(false);
        expect(/^\s*$/m.test(releaseNotesMd())).toBe(false);
    });
});

describe('RELEASES_URL 完整发布记录链接', () => {
    it('是 https，且指向本仓的 releases 页（⛔ 别指回 CHANGELOG 的 raw 地址）', () => {
        expect(RELEASES_URL).toMatch(/^https:\/\/github\.com\/fhb263\/obsidian-reelludic\/releases$/);
    });
});
