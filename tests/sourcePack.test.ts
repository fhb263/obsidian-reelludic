// 源「清单」宽松解析的单测（#432 甲 · D-32 兼容社区 `repository.json` 形态）。
//
// 为什么值得单测：这段是「用户粘一个地址 / 一段文本」进来的**唯一入口**，
// 它判错的后果有两种，都很难查：
//   ① 把**能用的**说成坏的（比如把仓库清单的「文件地址」当成「坏源」逐条拒绝）；
//   ② 把**不该收的**收进来（`.js` 可执行脚本 —— 踩红线 D-24(a)）。
import { describe, expect, it } from 'vitest';
import { parseSourcePack, parseSourcePackValue, sourcePackEntryIssue, sourcePackSummary } from 'pure/sourcePack';

/** 一条**能过体检**的最小源（照 `diagnoseSource` 的必填项：名称 / 站点 / 目录 / 章节标题 + 正文） */
const OK_SOURCE = {
    url: 'https://example.com/',
    name: '示例源甲',
    crawl: { minInterval: 1, maxInterval: 1, maxAttempts: 2 },
    toc: { item: '#list > dl > dd > a' },
    chapter: { title: '.bookname > h1', content: '#content' },
};

describe('sourcePack · 源清单本体（形态 A：数组 / 单条 / {sources:[源对象]}）', () => {
    it('🔴 数组形态 ⇒ `form: sources`，可用源进 `sources`，坏条目进 `skipped` 且**带原因**（⛔ 不静默丢）', () => {
        const pack = parseSourcePack(JSON.stringify([OK_SOURCE, { name: '缺站点' }]));
        expect(pack.form).toBe('sources');
        expect(pack.sources.length).toBe(1);
        expect(pack.sources[0].name).toBe('示例源甲');
        expect(pack.skipped.length).toBe(1);
        expect(pack.skipped[0].reason).toMatch(/缺站点地址|缺目录规则/);
    });

    it('单条对象 / `{sources:[源对象]}` 都认（与既有 `parseSourceFile` 同一口径，⛔ 不另写一套）', () => {
        expect(parseSourcePack(JSON.stringify(OK_SOURCE)).sources.length).toBe(1);
        expect(parseSourcePack(JSON.stringify({ sources: [OK_SOURCE] })).sources.length).toBe(1);
    });

    it('⚠️ JSON 本身坏了 ⇒ **抛**（由调用方折成一句给用户的话，与 `parseSourceJson` 同口径）', () => {
        expect(() => parseSourcePack('{ 不是 json')).toThrow(/不是合法的 JSON/);
    });

    it('空 / 非对象 ⇒ 一个空清单（⛔ 不抛 —— 订阅拉回一个空数组是常态）', () => {
        expect(parseSourcePack('null').sources.length).toBe(0);
        expect(parseSourcePack('[]').sources.length).toBe(0);
        expect(parseSourcePack('{}').form).toBe('sources');
    });
});

describe('sourcePack · 🔴 仓库清单（形态 B：legado 社区仓的 repository.json）', () => {
    // 照官方文档 `docs.legadoteam.org/guide/community-booksource-repository.html` 的字段名
    const REPO = {
        name: '示例社区书源仓库',
        version: '1.0.0',
        updatedAt: '2026-04-20T00:00:00Z',
        sources: [
            { name: '示例源一', url: 'https://a.example.com', fileName: 'a.js', downloadUrl: 'https://raw.example.com/repo/a.js', tags: ['小说'] },
            { name: '示例源二', url: 'https://b.example.com', fileName: 'b.json', downloadUrl: 'https://raw.example.com/repo/b.json', tags: ['小说'] },
        ],
    };

    it('🔴🔴 **必须先认出它是仓库清单**：⛔ 不能丢给源体检（那会把「文件地址」说成「坏源」，用户看到「全被拒」而真因是别的）', () => {
        const pack = parseSourcePack(JSON.stringify(REPO));
        expect(pack.form).toBe('manifest');
        expect(pack.packName).toBe('示例社区书源仓库');
        expect(pack.entries.length).toBe(1);
        expect(pack.entries[0].downloadUrl).toBe('https://raw.example.com/repo/b.json');
        expect(pack.entries[0].name).toBe('示例源二');
        expect(pack.sources.length).toBe(0);
    });

    it('🔴🔴 **`.js` 一律跳过并说明红线原因**（legado 生态绝大多数是脚本型 —— 用户必须知道「为什么订了却没进来」）', () => {
        const pack = parseSourcePack(JSON.stringify(REPO));
        expect(pack.skipped.length).toBe(1);
        expect(pack.skipped[0].name).toBe('示例源一');
        expect(pack.skipped[0].reason).toMatch(/脚本型书源（\.js）/);
        expect(pack.skipped[0].reason).toMatch(/不执行第三方脚本/);
    });

    it('`{sourceUrls:[…]}` 老形态也认（只有地址、没有元数据）', () => {
        const pack = parseSourcePack(JSON.stringify({ name: '老形态仓库', sourceUrls: ['https://x.example.com/a.json', 'https://x.example.com/b.js', '不是地址'] }));
        expect(pack.form).toBe('manifest');
        expect(pack.packName).toBe('老形态仓库');
        expect(pack.entries.map((e) => e.downloadUrl)).toEqual(['https://x.example.com/a.json']);
        expect(pack.skipped.map((s) => s.reason)).toEqual(['脚本型书源（.js）：本插件不执行第三方脚本，已跳过', '下载地址不是 http(s) 开头']);
    });

    it('拿不到名字时退回落文件名（去扩展名），再退回落地址', () => {
        const pack = parseSourcePack(JSON.stringify({ sourceUrls: ['https://x.example.com/dir/某源名.json'] }));
        expect(pack.entries[0].name).toBe('某源名');
    });

    it('`{sources:[源对象]}` 与 `{sources:[文件地址]}` 靠**地址像不像文件**分流（两条路都不能误伤）', () => {
        // 里面的条目是**源对象**（没有 .json/.js 地址）⇒ 走形态 C
        expect(parseSourcePackValue({ sources: [OK_SOURCE] }).form).toBe('sources');
        // 里面的条目是**文件地址** ⇒ 走形态 B
        expect(parseSourcePackValue({ sources: [{ name: 'x', downloadUrl: 'https://a.example.com/x.json' }] }).form).toBe('manifest');
    });
});

describe('sourcePack · `sourcePackEntryIssue` 逐条判定（红线在这里守）', () => {
    it('🔴 `.js` 明确拒绝（并把原因写成一句人话，不是抛异常）', () => {
        expect(sourcePackEntryIssue({ downloadUrl: 'https://a.example.com/x.js' })).toMatch(/脚本型书源/);
        expect(sourcePackEntryIssue({ downloadUrl: 'https://a.example.com/x.js?v=2' })).toMatch(/脚本型书源/);
    });

    it('`.json` 与带 query 的 `.json` 放行', () => {
        expect(sourcePackEntryIssue({ downloadUrl: 'https://a.example.com/x.json' })).toBeNull();
        expect(sourcePackEntryIssue({ fileUrl: 'https://a.example.com/x.json?raw=1' })).toBeNull();
    });

    it('⛔ 非 http(s)（相对路径 / file: / 空）一律不收 —— 收了也拉不到', () => {
        expect(sourcePackEntryIssue({ downloadUrl: './x.json' })).toMatch(/不是 http\(s\) 开头/);
        expect(sourcePackEntryIssue({ downloadUrl: 'file:///C:/x.json' })).toMatch(/不是 http\(s\) 开头/);
        expect(sourcePackEntryIssue({})).toMatch(/没有下载地址/);
        expect(sourcePackEntryIssue(null)).toMatch(/不是一个对象/);
        expect(sourcePackEntryIssue([1, 2])).toMatch(/不是一个对象/);
    });

    it('字段名宽松：`downloadUrl` / `fileUrl` / `url` 三种键名都认（社区写法不统一）', () => {
        expect(sourcePackEntryIssue({ downloadUrl: 'https://a.example.com/x.json' })).toBeNull();
        expect(sourcePackEntryIssue({ file_url: 'https://a.example.com/x.json' })).toBeNull();
        expect(sourcePackEntryIssue({ url: 'https://a.example.com/x.json' })).toBeNull();
    });
});

describe('sourcePack · 摘要（UI 直接用，⛔ 视图层别另拼一套计数）', () => {
    it('两种形态各自的摘要，跳过数只在大于 0 时出现', () => {
        expect(sourcePackSummary(parseSourcePack(JSON.stringify([OK_SOURCE])))).toBe('可直接用 1 条');
        expect(sourcePackSummary(parseSourcePack(JSON.stringify([OK_SOURCE, {}])))).toBe('可直接用 1 条 · 跳过 1 条');
        expect(sourcePackSummary(parseSourcePack(JSON.stringify({ sourceUrls: ['https://a.example.com/x.json'] })))).toBe('待下载 1 条');
    });
});
