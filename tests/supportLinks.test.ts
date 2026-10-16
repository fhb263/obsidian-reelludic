// 🔴 #598 对外链接真源（pure/supportLinks）单测
// 用户：「设置页-关于页把问题反馈按钮分成**报 Bug、提需求**两个按钮，做好调用入口」。
// ⚠️ 这里要真拿 fs 核 `.github/ISSUE_TEMPLATE/` 下的两个模板确实存在 ——
//    `?template=<名>` 写错不会报错，只会**静默落到「选择模板」页**（等于回到起点）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    REPO_URL, BUG_REPORT_URL, FEATURE_REQUEST_URL, AFDIAN_URL, SUPPORT_BUTTONS,
} from 'pure/supportLinks';

describe('pure/supportLinks · 反馈入口（#598）', () => {
    it('两枚反馈按钮 = **报 Bug / 提需求**（用户点名），顺序就是这个', () => {
        expect(SUPPORT_BUTTONS.map((b) => b.label)).toEqual(['报 Bug', '提需求']);
    });

    it('🔴 两枚按钮各自链到**对应的 issue form**（不是那枚笼统的 `/issues` 列表页）', () => {
        expect(SUPPORT_BUTTONS[0].url).toBe(BUG_REPORT_URL);
        expect(SUPPORT_BUTTONS[1].url).toBe(FEATURE_REQUEST_URL);
        expect(BUG_REPORT_URL).toBe(`${REPO_URL}/issues/new?template=bug_report.yml`);
        expect(FEATURE_REQUEST_URL).toBe(`${REPO_URL}/issues/new?template=feature_request.yml`);
        expect(BUG_REPORT_URL).not.toBe(FEATURE_REQUEST_URL);
    });

    it('🔴 `?template=` 与 `.github/ISSUE_TEMPLATE/` 下的**真实文件名逐字一致**（fs 真核）', () => {
        for (const url of [BUG_REPORT_URL, FEATURE_REQUEST_URL]) {
            const f = url.split('template=')[1] ?? '';
            expect(f).not.toBe('');
            expect(fs.existsSync(path.resolve(process.cwd(), '.github', 'ISSUE_TEMPLATE', f))).toBe(true);
        }
    });

    it('四条 URL 都是 https 且**互不相同**（同一条被复制两遍就会撞）', () => {
        const all = [REPO_URL, BUG_REPORT_URL, FEATURE_REQUEST_URL, AFDIAN_URL];
        for (const u of all) expect(u.startsWith('https://')).toBe(true);
        expect(new Set(all).size).toBe(4);
    });

    it('仓库前缀唯一真源：两条反馈链接都是从 `REPO_URL` 派生的', () => {
        expect(BUG_REPORT_URL.startsWith(`${REPO_URL}/issues/new`)).toBe(true);
        expect(FEATURE_REQUEST_URL.startsWith(`${REPO_URL}/issues/new`)).toBe(true);
    });
});
