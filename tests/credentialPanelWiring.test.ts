// ③-1 接线守卫（2026-11-12 用户 m00353）：「统一周期管理」面板必须**只读 credentialMeta**。
//
// 用户原话：「状态面板和搜索配置页必须共享同一个 `credentialMeta` 数据源，⛔ 不要在状态面板里
//   维护独立的『是否失效』状态」。语义层已由 `tests/credentialMeta.test.ts` 钉住，
//   本文件钉**接线**：视图层有没有绕过那份真源自己算、有没有绕过唯一写口自己落盘。
//
// ⚠️ 做法：读源码文本 + 剥注释后按正则断言。理由同 `tests/searchSkeleton.test.ts` ——
//   Settings.ts 是 9000+ 行的命令式 DOM 构造，没有可 inject 的宿主；用文本守卫锁结构是
//   本仓对这类「大文件里的接线」既有且有效的做法（截图/真机只能证明一次，断言每次 CI 都证明）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** 剥掉 `//` 行注释、`/* *\/` 块注释与 HTML 注释 —— 注释里合法出现的关键词不该判红。 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .replace(/<!--[\s\S]*?-->/g, '');
}

const settingsSrc = stripComments(readFileSync(join(ROOT, 'src', 'Settings.ts'), 'utf8'));
const navSrc = stripComments(readFileSync(join(ROOT, 'src', 'pure', 'settingNav.ts'), 'utf8'));

/**
 * 截出某个方法**定义**的函数体。
 *
 * 🔴 必须锚 `private <name>(` 而不是裸名字：`renderCredentialTable` 在调用点
 *   （`createGroupSection(parent, '统一周期管理', (body) => this.renderCredentialTable(body))`）
 *   先出现一次 —— 拿调用点当方法体，所有断言都会在 20 个字符的碎片上跑（第一版就是这么红的）。
 */
function methodBody(src: string, name: string): string {
    const anchors = [`private ${name}(`, `private ${name}<`];
    let at = -1;
    for (const a of anchors) {
        at = src.indexOf(a);
        if (at > -1) break;
    }
    expect(at, `源码里找不到方法定义 private ${name}(`).toBeGreaterThan(-1);
    // 方法体内允许出现更深的缩进，所以「下一个方法」的判据是：行首 4 空格 + `private ` 或 `/**`
    const rest = src.slice(at);
    const next = rest.slice(1).search(/\n {4}(?:private |\/\*\*|\})/);
    return next > -1 ? rest.slice(0, next + 1) : rest;
}

describe('③-1 接线 · 面板组已挂进「搜索配置」页', () => {
    it('「音乐下载源凭据」之后紧跟「统一周期管理」（用户逐字指定位置）', () => {
        const musicAt = settingsSrc.indexOf(`'音乐下载源凭据'`);
        const credAt = settingsSrc.indexOf(`'统一周期管理'`);
        expect(musicAt).toBeGreaterThan(-1);
        expect(credAt).toBeGreaterThan(musicAt);
        // 中间不许再插别的分组
        const between = settingsSrc.slice(musicAt, credAt);
        expect(between).not.toMatch(/createGroupSection\(parent, '/);
    });

    it('组名在 `settingNav` 里登记了图标（键不逐字一致就会静默丢图标）', () => {
        expect(navSrc).toMatch(/统一周期管理:\s*'[a-z0-9-]+'/);
    });
});

describe('③-1 接线 · 面板只用 credentialMeta 这份真源', () => {
    const body = methodBody(settingsSrc, 'renderCredentialTable');

    it('调 `buildCredentialMeta` 取表，并用 `credentialMetaInput()` 现取 settings/status/checkedAt', () => {
        expect(body).toMatch(/buildCredentialMeta\(\s*this\.plugin\.credentialMetaInput\(\)\s*\)/);
        // 检测后要用**新表**重画那一行（⛔ 别复用旧 row 对象，那会显示上一轮的结论）
        expect((body.match(/buildCredentialMeta\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('🔴 面板**不自己判失效** —— 体内不许出现 isExpired / statusOf / credentialStatusOf', () => {
        expect(body).not.toMatch(/isExpired\(/);
        expect(body).not.toMatch(/statusOf\(/);
        expect(body).not.toMatch(/credentialStatusOf\(/);
    });

    it('🔴 面板**不自己判配置** —— 体内不许读 musicDlCookies / biliCookie / keyField 这些字段', () => {
        expect(body).not.toMatch(/musicDlCookies/);
        expect(body).not.toMatch(/biliCookie/);
        expect(body).not.toMatch(/keyField/);
    });

    it('文案与时间也走 pure 层（credentialStateLabel / formatCheckedAt）', () => {
        expect(body).toMatch(/credentialStateLabel\(/);
        expect(body).toMatch(/formatCheckedAt\(/);
        // 🔴 2026-11-12 第 28 轮（用户 `m07505`）：「把上次检测的提示描述『登录超时可续期』删除掉」
        //   ⇒ 面板**不许**再调那个续期提示函数（它已随字段一起退场），也不许自己补一句提示。
        expect(body).not.toMatch(/credentialExpiryHint/);
        expect(body).not.toMatch(/rl-cred-hint/);
        // ⛔ 别在视图层自己拼日期
        expect(body).not.toMatch(/getFullYear\(\)/);
    });
});

describe('③-1 接线 · 写结论只走唯一写口', () => {
    const body = methodBody(settingsSrc, 'renderCredentialTable');

    it('结论写 `plugin.setCredentialStatus`（⛔ 不直接改 settings.credentialStatus）', () => {
        expect(body).toMatch(/this\.plugin\.setCredentialStatus\(/);
        expect(body).not.toMatch(/settings\.credentialStatus\s*=/);
    });

    it('检测动作走 `testCredentialByKey`（分派到既有三条路径，⛔ 面板不另写探测）', () => {
        expect(body).toMatch(/this\.plugin\.testCredentialByKey\(/);
    });

    it('一键检测**只测已配置的**（未配置的测了必然 false，会把「没填」写成「连接失败」）', () => {
        expect(body).toMatch(/filter\(\(r\) => r\.configured\)/);
    });

    it('一键检测**串行**执行（并发打同一批站点 = 自找风控）', () => {
        // 串行的证据：for 循环体内 await，而不是 Promise.all
        expect(body).not.toMatch(/Promise\.all/);
        // ⚠️ 两种写法都算串行：`for (const row of targets)` 与
        //    `for (const [i, row] of targets.entries())`（后者是为了报「第几条 / 共几条」，
        //    十几条串行要几十秒，只转圈用户会以为卡死）。⛔ 别把锚钉死成其中一种。
        expect(body).toMatch(/for \(const (?:\w+|\[\w+,\s*\w+\]) of targets(?:\.entries\(\))?\)/);
    });

    it('检测有**就近回执**（组件库 `setFeedback`）：单条与一键都要给，⛔ 不靠 Notice', () => {
        // 结果只落在行内两格，用户视线停在按钮上 ⇒ 必须有一句就近回执说明「点到了 / 测完了」
        expect(body).toMatch(/setFeedback\(feedback,/);
        expect(body).toMatch(/const feedback = parent\.createDiv\(\{ cls: 'rl-ui-feedback' \}\)/);
        expect(body).not.toMatch(/new Notice\(/);
    });
});

describe('③-1 接线 · 点名称跳转', () => {
    const jump = methodBody(settingsSrc, 'jumpToCredentialRow');

    it('靠 `data-cred-key` 找目标行（三处凭据行都挂了同一个属性）', () => {
        expect(jump).toMatch(/data-cred-key/);
        for (const attr of ['sourceCheckKey', 'musicCheckKey', 'netCheckKey']) {
            expect(settingsSrc).toMatch(new RegExp(`'data-cred-key':\\s*${attr}\\(`));
        }
    });

    it('不在本页才切页；已在本页就就地滚（⛔ 整页重建会丢用户滚动位置）', () => {
        expect(jump).toMatch(/this\.activePage === 'sources'/);
        expect(jump).toMatch(/this\.setActivePage\('sources'\)/);
        expect(jump).toMatch(/scrollIntoView\(/);
    });

    it('滚过去顺手展开那一行（只滚不展开 = 用户看到的还是折叠卡）', () => {
        expect(jump).toMatch(/addClass\('rl-key-open'\)/);
    });
});

/**
 * 🔴 #758（2026-11-12 用户 `m07505` 逐字）：「怎么我在搜索配置里配置了项和测试了连接但
 *   统一管理周期的不实时显示我的新增项」。
 *
 * 根因不是「算错了」，是**没有任何人通知它重算**：`paintRow` / `summaryEl` 原本只活在
 * `renderCredentialTable` 的闭包里，唯一触发重绘的是它自己那颗「一键检测」。
 * 用户填凭据、点行内「测试连接」、开机自检，三条路径都只改数据、不重绘面板。
 *
 * 这组守卫钉的就是「那个通知通道存在，且每个写入点都真的调了它」——
 * ⛔ 别再退回「只在 testAll 里重绘」的形态：那正是本次报障的成因。
 */
describe('#758 · 面板要有外部刷新通道', () => {
    it('面板建完就把刷新闭包交给 `this.credentialTableRefresh`', () => {
        const body = methodBody(settingsSrc, 'renderCredentialTable');
        expect(body).toMatch(/this\.credentialTableRefresh = paintAll/);
        // 闭包本体要重算汇总 + 逐行重画（缺一个，用户看到的就还是半旧的面板）
        expect(body).toMatch(/const paintAll = \(\): void => \{/);
        expect(body).toMatch(/summarizeCredentialMeta\(fresh\)/);
        expect(body).toMatch(/paintRow\(host, row\)/);
    });

    it('赋值点在建完 13 行之后（早于建行 ⇒ `[data-cred-row]` 一行都找不到）', () => {
        const body = methodBody(settingsSrc, 'renderCredentialTable');
        const loopAt = body.indexOf('const host = table.row({ cls: \'rl-cred-row\' })');
        const assignAt = body.indexOf('this.credentialTableRefresh = paintAll');
        expect(loopAt).toBeGreaterThan(-1);
        expect(assignAt).toBeGreaterThan(loopAt);
    });

    it('`display()` 开头把旧闭包置空（旧 DOM 已 empty，⛔ 别让刷新打到已卸载节点）', () => {
        // ⚠️ 不能用 `methodBody`：`display()` 是覆写 `PluginSettingTab` 的**公开**方法，
        //    源码里没有 `private ` 前缀（第一版就是这么红的）。按真实签名锚。
        const at = settingsSrc.indexOf('\n    display(): void {');
        expect(at, '源码里找不到 display(): void {').toBeGreaterThan(-1);
        const rest = settingsSrc.slice(at + 1);
        const next = rest.slice(1).search(/\n {4}(?:private |\/\*\*|\})/);
        const display = next > -1 ? rest.slice(0, next + 1) : rest;
        const emptyAt = display.indexOf('containerEl.empty()');
        const nullAt = display.indexOf('this.credentialTableRefresh = null');
        expect(emptyAt).toBeGreaterThan(-1);
        expect(nullAt).toBeGreaterThan(emptyAt);
    });

    it('刷新走带空守卫的 `refreshCredentialTable()`（⛔ 别在写入点直接碰字段）', () => {
        expect(settingsSrc).toMatch(/private refreshCredentialTable\(\): void \{\s*this\.credentialTableRefresh\?\.\(\);/);
    });

    /**
     * 🔴 这条是本组的**核心**：逐个写入点断言。
     *   ⚠️ 用 `indexOf` 定位每个 `clearCredentialStatus(...)` / `setCredentialStatus(...)` 调用，
     *      再往**后**看 400 字符内有没有 `refreshCredentialTable()` —— 写 `toMatch` 全文匹配
     *      是没用的（只要别处出现一次就绿），必须按调用点逐个查。
     */
    it('每个凭据写入点后面都调了刷新（漏一个，那一类凭据就回到"不实时"）', () => {
        const sites = [
            // 8 处 clear（填 / 改 / 登出凭据）
            /clearCredentialStatus\(musicCheckKey\(p\.id\)\)/,
            /clearCredentialStatus\(sourceCheckKey\(meta\.id\)\)/g,
            /clearCredentialStatus\(netCheckKey\('bilibili'\)\)/,
            /clearCredentialStatus\(netCheckKey\('youtube'\)\)/g,
            // 3 处 set（行内「测试连接」的结论）
            /setCredentialStatus\(musicCheckKey\(p\.id\), r\.ok\)/,
            /setCredentialStatus\(sourceCheckKey\(meta\.id\), res\.ok\)/,
            /setCredentialStatus\(netCheckKey\('bilibili'\), ok\)/,
            /setCredentialStatus\(netCheckKey\('youtube'\), ok\)/,
        ];
        let checked = 0;
        for (const re of sites) {
            const rx = new RegExp(re.source, re.flags.includes('g') ? 'g' : 'g');
            let m: RegExpExecArray | null;
            while ((m = rx.exec(settingsSrc)) !== null) {
                checked += 1;
                const after = settingsSrc.slice(m.index, m.index + 400);
                expect(
                    after,
                    `写入点 ${m[0]} 之后 400 字符内没调 refreshCredentialTable()（该处约在第 ${m.index} 字符）`,
                ).toMatch(/refreshCredentialTable\(\)/);
            }
        }
        // 至少 11 个写入点（8 clear + 3 set；`sourceCheckKey`/`youtube` 的 clear 各有多处）
        expect(checked).toBeGreaterThanOrEqual(11);
    });
});

/**
 * 🔴 用户 m07854 ②（2026-11-13）：「统一周期检测的怎么不同步到对应的搜索配置项里」。
 *
 * #758 只打通了「搜索配置 → 面板」；反方向一直是断的 —— 面板一键检测只 `paintRow` 面板自己那行，
 * 下面「搜索配置」里同名那行的徽标是另一个闭包，没人通知 ⇒ 用户看到「面板说连接失败，
 * 展开下面那行还写着已配置」。本组钉住反方向的接线。
 */
describe('#759 · 面板检测结论要同步回搜索配置行的徽标（用户 m07854 ②）', () => {
    it('面板一键检测里调了 `refreshCredentialBadge(row.key)`', () => {
        const body = methodBody(settingsSrc, 'renderCredentialTable');
        expect(body).toMatch(/this\.refreshCredentialBadge\(row\.key\)/);
        // 且必须在 `setCredentialStatus` 之后（先落结论再通知，反了就是拿旧值刷新）
        const setAt = body.indexOf('this.plugin.setCredentialStatus(row.key, r.ok)');
        const syncAt = body.indexOf('this.refreshCredentialBadge(row.key)');
        expect(setAt).toBeGreaterThan(-1);
        expect(syncAt).toBeGreaterThan(setAt);
    });

    it('四族凭据行都登记了刷新闭包（元数据源 / 音乐 / 网络播放 / AI 两家）', () => {
        // 每族一个具名 key 来源：漏一族，那一族检测完就不跟着变
        const keys = [
            /this\.registerCredentialBadge\(sourceCheckKey\(meta\.id\), refreshBadge\)/,
            /this\.registerCredentialBadge\(musicCheckKey\(p\.id\), refreshBadge\)/,
            /this\.registerCredentialBadge\(netCheckKey\(id\), refreshBadge\)/,
            /this\.registerCredentialBadge\(aiCheckKey\(provider\), refreshBadge\)/,
            /this\.registerCredentialBadge\(aiCheckKey\(slot\), refreshBadge\)/,
        ];
        for (const re of keys) {
            expect(settingsSrc, `缺少登记：${re}`).toMatch(re);
        }
    });

    it('登记必须发生在 `refreshBadge` 定义**之后**（否则闭包还没生出来）', () => {
        const at = settingsSrc.indexOf('this.registerCredentialBadge(sourceCheckKey(meta.id), refreshBadge)');
        expect(at).toBeGreaterThan(-1);
        const before = settingsSrc.slice(0, at);
        const defAt = before.lastIndexOf('const refreshBadge = (): void => {');
        expect(defAt).toBeGreaterThan(-1);
        // 定义在登记之前，且中间没有新的 builder 边界把它隔开
        expect(at - defAt).toBeLessThan(2000);
    });

    it('`display()` 会清空旧徽标闭包（旧 DOM 已 empty，⛔ 别让刷新打到卸载节点）', () => {
        expect(settingsSrc).toMatch(/this\.credentialBadgeRefresh\.clear\(\)/);
        const emptyAt = settingsSrc.indexOf('this.credentialTableRefresh = null');
        const clearAt = settingsSrc.indexOf('this.credentialBadgeRefresh.clear()');
        expect(clearAt).toBeGreaterThan(emptyAt);
    });

    it('`refreshCredentialBadge` 走 Map 空守卫，且支持「全刷」', () => {
        expect(settingsSrc).toMatch(/private registerCredentialBadge\(key: string, refresh: \(\) => void\): void \{/);
        expect(settingsSrc).toMatch(/private refreshCredentialBadge\(key\?: string\): void \{/);
        // 单键：get(...)?.(  —— 缺键时静默（该族可能没建：用户在别的页）
        expect(settingsSrc).toMatch(/this\.credentialBadgeRefresh\.get\(key\)\?\.\(\)/);
        // 全刷：遍历 values
        expect(settingsSrc).toMatch(/for \(const refresh of this\.credentialBadgeRefresh\.values\(\)\) refresh\(\)/);
    });
});
