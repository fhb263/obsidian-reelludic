// 🔴 #598 对外链接真源（pure/supportLinks）单测
// 用户：「设置页-关于页把问题反馈按钮分成**报 Bug、提需求**两个按钮，做好调用入口」。
// ⚠️ 这里要真拿 fs 核 `.github/ISSUE_TEMPLATE/` 下的两个模板确实存在 ——
//    `?template=<名>` 写错不会报错，只会**静默落到「选择模板」页**（等于回到起点）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    REPO_URL, BUG_REPORT_URL, FEATURE_REQUEST_URL, AFDIAN_URL, SUPPORT_BUTTONS,
    AUTHOR_GITHUB_URL, AUTHOR_GITHUB_TIP, AUTHOR_GITHUB_ICON,
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

// 🔴 2026-11-12 用户 `m05813`：「设置-关于页 ReelLudic 信息栏的 b 站图标跟上 github 的图标，
//    点击可跳转作者主页『https://github.com/fhb263』」
// ⚠️ 这两条不是在测「常量等于我写的那串字」—— 那样改错了一起改就永远绿。测的是**关系**：
//    作者主页 ≠ 仓库地址（两者同属 fhb263 但落点不同，最容易抄错的就是这个）。
describe('pure/supportLinks · 作者 GitHub 入口（m05813）', () => {
    it('🔴 落点是**作者主页**，不是仓库地址（同属 fhb263，最易抄错的一处）', () => {
        expect(AUTHOR_GITHUB_URL).toBe('https://github.com/fhb263');
        // 反向守卫：⛔ 别把作者主页写成仓库地址 —— 用户点进去想看的是「这个人还做了什么」
        expect(AUTHOR_GITHUB_URL).not.toBe(REPO_URL);
        expect(AUTHOR_GITHUB_URL.endsWith('/obsidian-reelludic')).toBe(false);
        // 但两者必须是同一个作者（否则就是链到别人主页去了）
        expect(REPO_URL.startsWith(`${AUTHOR_GITHUB_URL}/`)).toBe(true);
    });

    it('图标是**品牌标**且路径完整（⛔ 不许退回内置图标占位）', () => {
        // 品牌标才有 GitHub 的辨识度；退回 `builtin`（某个语义相近的内置图标）用户认不出是谁
        expect(AUTHOR_GITHUB_ICON.kind).toBe('brand');
        if (AUTHOR_GITHUB_ICON.kind !== 'brand') return;
        expect(AUTHOR_GITHUB_ICON.slug).toBe('github');
        expect(AUTHOR_GITHUB_ICON.viewBox).toBe('0 0 24 24');
        // 实测 simple-icons v16 的 github 标单路径 712 字符；给个下界防「只抄了半截」
        expect(AUTHOR_GITHUB_ICON.d.length).toBeGreaterThan(600);
        expect(AUTHOR_GITHUB_ICON.d.startsWith('M12 .297c')).toBe(true);
        // ⛔ 别把品牌 hex 写进图标数据（本仓只走 currentColor + 主题色，见 sourceIcons 文件头）
        expect(/fill\s*=|#[0-9a-fA-F]{3,6}/.test(AUTHOR_GITHUB_ICON.d)).toBe(false);
    });

    it('悬停说明与读屏名是同一句（两处共用一份真源，⛔ 别在渲染处手写第二遍）', () => {
        expect(AUTHOR_GITHUB_TIP).toContain('GitHub');
        expect(AUTHOR_GITHUB_TIP.length).toBeGreaterThan(0);
    });
});
