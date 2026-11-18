/**
 * 关联媒体重命名接线守卫（m07854 ⑱ 起，2026-11-13 七类规则改版）。
 *
 * 三层职责固定住：
 *   ⑴ 规则只活在 `pure/batchRename`（⛔ 视图/宿主里不许再拼一遍命名规则）；
 *   ⑵ 改名唯一出口是宿主 `fileManager.renameFile`（⛔ 不用 `adapter.rename`，那会断链接）；
 *   ⑶ 改名后**必须回写条目字段**（⛔ 漏了 = 条目指向不存在的旧路径）。
 *
 * 🔴 2026-11-13 用户口径（本文件据此翻面）：
 *    - 设置行改名「关联媒体重命名」、按钮「重命名」；
 *    - 弹窗**只显示关联的文件**，⛔ 不再列跳过项、⛔ 不再报「N 个文件被跳过」；
 *    - 弹窗要给七类规则模板 + 示例（真源 `RENAME_TEMPLATE_GROUPS`）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

// 🔴 铁律（#379 / #730 / #731 三次被自己的注释打穿）：先 strip 注释再匹配。
//    单次交替正则，Svelte 的 HTML 注释也一起剥（⑪ / ⑫ / ⑬ / ⑭ / ⑮ / ⑰ 同款）。
const strip = (src: string): string => src.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

const pureSrc = strip(read('src/pure/batchRename.ts'));
const modalSrc = strip(read('src/modals/BatchRenameModal.ts'));
const mainSrc = strip(read('main.ts'));
const settingsSrc = strip(read('src/Settings.ts'));
const cssSrc = strip(read('styles.css'));

/** 从标记起取方法体（花括号配平）。
 *  🔴 签名里可能带 `Promise<{ renamed: number; failed: number }>` 这种**返回类型对象字面量**，
 *  直接找第一个 `{` 会抓到返回类型那个（本轮首跑就这么红了 3 条）⇒ 先按尖括号深度跳过泛型，
 *  只在 `<...>` 闭合之后的下一个 `{` 才算方法体起点。 */
function methodBody(src: string, name: string): string {
    const at = src.indexOf(`    async ${name}(`);
    const at2 = at >= 0 ? at : src.indexOf(`    ${name}(`);
    expect(at2, `源码里找不到方法 ${name}`).toBeGreaterThanOrEqual(0);
    let angle = 0;
    let start = -1;
    for (let i = at2; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '<') angle += 1;
        else if (ch === '>') angle = Math.max(0, angle - 1);
        else if (ch === '{' && angle === 0) {
            start = i;
            break;
        }
    }
    expect(start, `方法 ${name} 找不到方法体`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error(`方法 ${name} 的花括号没配平`);
}

describe('规则只活在 pure/batchRename', () => {
    it('导出的是「算名字 + 判冲突」的纯函数，不含任何文件系统 API', () => {
        for (const name of ['buildRenameStem', 'planEntryRename', 'planBatchRename', 'summarizeRenamePlans']) {
            expect(pureSrc).toContain(`export function ${name}(`);
        }
        // ⛔ 纯层不许出现 fs / vault / adapter / renameFile
        expect(pureSrc).not.toMatch(/\brequire\(['"]fs['"]\)/);
        expect(pureSrc).not.toMatch(/\.vault\b/);
        expect(pureSrc).not.toMatch(/\badapter\b/);
        expect(pureSrc).not.toMatch(/renameFile/);
    });

    it('🔴 七类规则模板是真源数据，界面只渲染它（⛔ 别在两处各抄一份）', () => {
        expect(pureSrc).toContain('export const RENAME_TEMPLATE_GROUPS');
        expect(pureSrc).toContain('export function renameTemplateOf(');
        expect(pureSrc).toContain('export function renameKindOf(');
        // 七类 label 必须齐（用户口径：电影/剧集/动画/音乐/漫画/文学/网文）
        for (const label of ['电影', '剧集', '动画', '音乐', '漫画', '文学', '网文']) {
            expect(pureSrc, `缺类型 ${label}`).toContain(`label: '${label}'`);
        }
    });

    it('🔴 缺项不写占位符（⛔ `[未知]` / `N/A` / 空括号）', () => {
        expect(pureSrc).toContain('year > 0 ? `${title} (${year})` : title');
        expect(pureSrc).toContain('return res ? `${base} [${res}]` : base;');
        expect(pureSrc).not.toContain('[未知]');
        expect(pureSrc).not.toContain('未知');
        expect(pureSrc).not.toContain('N/A');
    });

    it('🔴 季号取 `progress.season`（MediaEntry 上没有 season 字段）', () => {
        expect(pureSrc).toContain('entry.progress?.season');
        expect(pureSrc).not.toMatch(/entry\.season\b/);
    });

    it('🔴 同目录撞名整组跳过；不同目录同名不算冲突', () => {
        expect(pureSrc).toContain('const key = `${dir}\\u0000${next.toLowerCase()}`;');
        expect(pureSrc).toContain('同目录里有别的文件会算出同一个名字');
        expect(pureSrc).toContain('plan.renames.splice(idx, 1);');
    });

    it('名字没变走 unchanged（不是 skipped），设置页不用报警', () => {
        expect(pureSrc).toContain('plan.unchanged.push(');
        expect(pureSrc).toContain('名字已经符合规则');
    });

    it('🔴 planBatchRename 只收「真会改名」的条目（跳过项不进列表的前提）', () => {
        expect(pureSrc).toContain('if (plan.renames.length > 0) out.push(plan);');
    });
});

describe('宿主执行体', () => {
    it('🔴 改名走 `fileManager.renameFile`，⛔ 不用 adapter.rename', () => {
        const body = methodBody(mainSrc, 'runBatchRename');
        expect(body).toContain('this.app.fileManager.renameFile(');
        expect(body).not.toMatch(/\.adapter\.rename/);
    });

    it('🔴 库外路径（getAbstractFileByPath 拿不到 TFile）必须计数为失败并跳过，⛔ 不许静默放过', () => {
        const body = methodBody(mainSrc, 'runBatchRename');
        expect(body).toContain('if (!(file instanceof TFile))');
        expect(body).toContain('failed += 1;');
        expect(body).toContain('不在库内');
    });

    it('🔴 改名成功后必须回写条目字段（episodeFiles / audioPath / bookFile），且走 service.update', () => {
        const body = methodBody(mainSrc, 'runBatchRename');
        expect(body).toContain('episodes[at] = nextPath;');
        expect(body).toContain('if (audio && audio === item.path) audio = nextPath;');
        // 文学 / 网文 / 漫画走 bookFile —— 漏回写 = 电子书改名后立刻打不开
        expect(body).toContain('if (book && book === item.path) book = nextPath;');
        expect(body).toContain('await this.service.update(');
        // ⛔ 不许绕过 service 直接写 catalog
        expect(body).not.toMatch(/catalog\.json/);
    });

    it('入口只负责取全库 + 交给弹窗，自己不判哪个文件能改', () => {
        const body = methodBody(mainSrc, 'openBatchRename');
        expect(body).toContain('await this.service.list()');
        expect(body).toContain('planBatchRename(entries,');
        expect(body).toContain('new BatchRenameModal(');
        expect(body).not.toContain('renameFile');
    });
});

describe('弹窗：先预览后执行', () => {
    it('🔴 弹窗不直接碰文件（改名由宿主注入的 `run` 做）', () => {
        expect(modalSrc).toContain('private run: (picked: RenamePlan[]) => Promise<{ renamed: number; failed: number }>,');
        expect(modalSrc).not.toMatch(/\.vault\b/);
        expect(modalSrc).not.toMatch(/renameFile/);
        expect(modalSrc).not.toMatch(/fileManager/);
    });

    it('🔴 标题是「关联媒体重命名」（用户 2026-11-13 改名）', () => {
        expect(modalSrc).toContain("createEl('h2', { text: '关联媒体重命名' })");
    });

    it('逐文件列「旧名 → 新名」', () => {
        expect(modalSrc).toContain('${r.name} → ${r.next}');
    });

    it('🔴 只显示关联的文件：⛔ 不列跳过项、⛔ 不报「N 个文件被跳过」', () => {
        // 用户原话：「不要显示什么有多少个文件被跳过了只显示关联的文件」
        expect(modalSrc).not.toContain('rl-rename-skip');
        expect(modalSrc).not.toContain('renderSkips');
        expect(modalSrc).not.toContain('被跳过');
    });

    it('🔴 2026-11-14：弹窗里**不显示**规则模板区（用户「这个重命名规则模板不要显示」）', () => {
        // 上一版（2026-11-13 ⑶）曾要求弹窗渲染 `RENAME_TEMPLATE_GROUPS`，本批用户明确要求撤掉。
        expect(modalSrc).not.toContain('renderTemplates');
        expect(modalSrc).not.toContain('命名规则模板');
        expect(modalSrc).not.toContain('rl-rename-templates');
        expect(modalSrc).not.toContain('规则模板：');
        expect(modalSrc).not.toContain('RENAME_TEMPLATE_GROUPS');
        // 模板真源仍必须在（设置页/其它入口用），只是不许在弹窗里渲染
        expect(pureSrc).toContain('export const RENAME_TEMPLATE_GROUPS');
        // ⛔ 也别在弹窗里抄一份模板字面量
        expect(modalSrc).not.toContain('{电影名}');
        expect(modalSrc).not.toContain('{剧名} - S');
    });

    it('默认全选可改的；按钮文案带文件数；没选时禁用', () => {
        expect(modalSrc).toContain('box.checked = true;');
        expect(modalSrc).toContain('this.runBtn.disabled = n === 0 || this.busy;');
        expect(modalSrc).toContain('`重命名 ${n} 个文件`');
    });

    it('🔴 结果必须报出来（成功 / 失败都 Notice），⛔ 静默关窗', () => {
        expect(modalSrc).toContain('已重命名 ${r.renamed} 个文件');
        expect(modalSrc).toContain('失败 ${r.failed} 个');
    });

    it('防重入（busy 期间不重复提交）', () => {
        expect(modalSrc).toContain('if (this.busy) return;');
        expect(modalSrc).toContain('this.busy = true;');
    });
});

describe('设置页入口', () => {
    it('「管理与维护」组里有这一行，按钮接宿主 openBatchRename', () => {
        expect(settingsSrc).toContain(".setName('关联媒体重命名')");
        expect(settingsSrc).toContain('void this.plugin.openBatchRename();');
        expect(settingsSrc).toContain("setButtonText('重命名')");
    });

    it('⛔ 不是「点一下直接跑」：入口方法名必须体现 preview/plan 语义（走弹窗）', () => {
        const at = settingsSrc.indexOf(".setName('关联媒体重命名')");
        const near = settingsSrc.slice(at, at + 600);
        expect(near).toContain('openBatchRename');
        expect(near).not.toContain('runBatchRename');
    });
});

describe('样式', () => {
    it('列表自己滚（模板区已删，只剩列表一处滚动容器）', () => {
        const at = cssSrc.indexOf('.rl-rename-list {');
        expect(at).toBeGreaterThanOrEqual(0);
        const block = cssSrc.slice(at, cssSrc.indexOf('}', at));
        expect(block).toContain('overflow-y: auto');
        expect(block).toContain('scrollbar-gutter: stable');
        // 模板区样式已是死码，⛔ 不许留着
        expect(cssSrc).not.toContain('.rl-rename-templates');
        const start = cssSrc.indexOf('.rl-rename-desc {');
        const end = cssSrc.indexOf('.rl-rename-ops {');
        const seg = cssSrc.slice(start, end + 200);
        expect(seg).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('🔴 2026-11-14：底部「取消 / 重命名」必须完整可见（用户「这两个主次按钮都被截断了」）', () => {
        const at = cssSrc.indexOf('.rl-rename-ops {');
        expect(at).toBeGreaterThanOrEqual(0);
        const block = cssSrc.slice(at, cssSrc.indexOf('}', at));
        // 钉在可视底边 + 不吃 flex 收缩 + 有实心底色（不透明才不会露出下面的行）
        expect(block).toContain('position: sticky');
        expect(block).toContain('bottom: 0');
        expect(block).toContain('flex: none');
        expect(block).toContain('background: var(--background-primary)');
        // ⛔ 底排自己不许变成滚动容器
        expect(block).not.toContain('overflow');
    });

    it('⛔ 已被「只显示关联文件」取代的跳过项样式必须删干净（死码不留）', () => {
        expect(cssSrc).not.toContain('.rl-rename-skips');
        expect(cssSrc).not.toContain('.rl-rename-skip');
    });

    it('⛔ 不复用 `rl-pc-*` 类名（语义不同，合并会互相误伤）', () => {
        expect(modalSrc).not.toContain('rl-pc-');
    });
});
