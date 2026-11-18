// 守卫：swf 关联资源扫描（用户报障「怎么下载出的就一个 swf 文件没有其他的吗」）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ASSET_EXTS, ASSET_REF_MAX, baseNameOf, extractAssetRefs, MOVIE_EXTS, planAssetRefs } from '../src/pure/flashAssets';

const enc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

describe('extractAssetRefs：从 swf 字节里扫相对资源名', () => {
    it('认得常见资源扩展名', () => {
        const bytes = enc('FWS\x09sounds/bgm.mp3\x00img/logo.png\x00data.xml');
        const refs = extractAssetRefs(bytes);
        expect(refs).toContain('sounds/bgm.mp3');
        expect(refs).toContain('img/logo.png');
        expect(refs).toContain('data.xml');
    });

    it('不认绝对地址（下回来也放不回原位）', () => {
        const bytes = enc('http://cdn.x.com/a.png https://x.com/b.mp3 //x.com/c.png app://x/d.png');
        expect(extractAssetRefs(bytes)).toEqual([]);
    });

    it('不认以 / 开头与盘符路径', () => {
        const bytes = enc('/abs/a.png C:/win/b.png');
        const refs = extractAssetRefs(bytes);
        expect(refs).not.toContain('/abs/a.png');
        expect(refs).not.toContain('C:/win/b.png');
    });

    it('不认含 .. 的越界路径', () => {
        expect(extractAssetRefs(enc('../up/a.png'))).toEqual([]);
    });

    it('同一条目去重（大小写无关）且保序', () => {
        const refs = extractAssetRefs(enc('b.png A.png a.png'));
        expect(refs).toEqual(['b.png', 'A.png']);
    });

    it('按上限截断（防上千个字符串撑爆下载队列）', () => {
        const many = Array.from({ length: ASSET_REF_MAX + 10 }, (_, i) => `f${i}.png`).join(' ');
        expect(extractAssetRefs(enc(many)).length).toBe(ASSET_REF_MAX);
        expect(extractAssetRefs(enc(many), 3).length).toBe(3);
    });

    it('空输入与垃圾输入不炸', () => {
        expect(extractAssetRefs(undefined)).toEqual([]);
        expect(extractAssetRefs(new Uint8Array(0))).toEqual([]);
        expect(extractAssetRefs(enc('\x00\x01\x02'))).toEqual([]);
    });

    it('超长段丢弃（多是压缩数据被误判）', () => {
        const huge = `${'a'.repeat(200)}.png`;
        expect(extractAssetRefs(enc(huge))).toEqual([]);
    });

    it('子影片 swf 也算候选（loadMovie 常见）', () => {
        expect(extractAssetRefs(enc('levels/2.swf'))).toContain('levels/2.swf');
        expect(MOVIE_EXTS).toContain('swf');
    });

    it('扩展名白名单只有静态资源与 swf（⛔ 别把 js 之类也拉下来）', () => {
        expect(ASSET_EXTS).toContain('png');
        expect(ASSET_EXTS).toContain('mp3');
        expect(ASSET_EXTS).not.toContain('js');
        expect(ASSET_EXTS).not.toContain('html');
    });
});

describe('planAssetRefs：换算成可下载的相对路径', () => {
    it('按原始文件名剔除主影片自己（避免同一部影片两份）', () => {
        const refs = ['04.swf', 'sounds/a.mp3'];
        expect(planAssetRefs(refs, '04.swf')).toEqual(['sounds/a.mp3']);
        // 改名后的「游戏名.swf」不参与比对 —— swf 内部只可能用原始名自我引用
        expect(planAssetRefs(refs, '部落冲突.swf')).toEqual(['04.swf', 'sounds/a.mp3']);
    });

    it('剔除是大小写无关的', () => {
        expect(planAssetRefs(['PLAY.SWF', 'x.png'], 'play.swf')).toEqual(['x.png']);
    });

    it('保留子目录结构（Ruffle 按 swf 地址解析相对路径）', () => {
        const refs = ['sounds/bgm/x.mp3', 'img/ui/y.png'];
        expect(planAssetRefs(refs, 'g.swf')).toEqual(expect.arrayContaining(['sounds/bgm/x.mp3']));
    });

    it('去重 + 丢弃非法项', () => {
        expect(planAssetRefs(['a.png', 'A.PNG', 'http://x/b.png', ''], 'g.swf')).toEqual(['a.png']);
    });

    it('丢弃 Flash 播放器内建名（fl.dat / flash.xml 实测 404）', () => {
        const plan = planAssetRefs(['fl.dat', 'flash.xml', 'crossdomain.xml', 'real/bgm.mp3'], 'g.swf');
        expect(plan).toEqual(['real/bgm.mp3']);
    });

    it('baseNameOf 取末段并吃查询串', () => {
        expect(baseNameOf('a/b/c.swf?v=2')).toBe('c.swf');
        expect(baseNameOf('c.swf')).toBe('c.swf');
    });
});

describe('纯层卫生', () => {
    it('不碰 obsidian / node 内置 / require', () => {
        const src = readFileSync(new URL('../src/pure/flashAssets.ts', import.meta.url), 'utf8');
        expect(src).not.toMatch(/from ['"]obsidian['"]/);
        expect(src).not.toMatch(/require\(/);
        expect(src).not.toMatch(/from ['"]node:/);
        expect(src).not.toMatch(/\bBuffer\b/);
    });
});

// ⚠️ main.ts 里有 `'text/*;q=0.8'` 这类字符串里的 `/*`，朴素剥注释会把后面几千行当注释吞掉
//    ⇒ 这里用**原文**匹配足够具体的片段，不剥注释（同 tests/flashProgressAndLauncher.test.ts）。
const MAIN = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

describe('宿主接线：命名用游戏名 + 关联资源回填', () => {
    it('主影片命名为「游戏名.swf」，拿不到条目才退回 URL 末段', () => {
        expect(MAIN).toMatch(/const gameName = String\(entry\?\.title \?\? ''\)\.trim\(\);/);
        expect(MAIN).toMatch(/const filename = gameName \? `\$\{sanitizeDownloadName\(gameName\)\}\.swf` : swfFileNameOf\(swfUrl, 'flash-game'\);/);
        expect(MAIN).toMatch(/import \{[^}]*sanitizeDownloadName[^}]*\} from 'pure\/downloadPlan';/);
    });

    it('主影片字节被接住后再去补关联资源', () => {
        expect(MAIN).toMatch(/let mainBytes: Uint8Array \| undefined;/);
        expect(MAIN).toMatch(/mainBytes = b;/);
        expect(MAIN).toMatch(/await this\.fetchFlashAssets\(swfUrl, relPath, mainBytes, pageHeaders, report\)/);
    });

    it('关联资源：解压后再扫、失败忽略、不覆盖已有、只走相对路径', () => {
        expect(MAIN).toMatch(/private async fetchFlashAssets\(/);
        // 🔴 CWS 是压缩体，不解压永远扫不到资源名（这是「只下一个文件」的真正原因）
        expect(MAIN).toMatch(/private swfScanBytes\(bytes: Uint8Array \| undefined\): Uint8Array \| undefined/);
        expect(MAIN).toMatch(/zlib\.inflateSync\(Buffer\.from\(b\.subarray\(8\)\)\)/);
        expect(MAIN).toMatch(/const scan = this\.swfScanBytes\(mainBytes\);/);
        expect(MAIN).toMatch(/planAssetRefs\(extractAssetRefs\(scan\), baseNameOf\(/);
        expect(MAIN).toMatch(/if \(existing\.has\(rel\.toLowerCase\(\)\)\) continue;/);
        expect(MAIN).toMatch(/const abs = resolveUrl\(swfUrl, ref\);/);
        expect(MAIN).toMatch(/if \(r\.status < 200 \|\| r\.status >= 300 \|\| r\.buffer\.length === 0\) continue;/);
        // 🔴 单条失败不许抛出（抛出会让整个「获取」失败）
        expect(MAIN).toMatch(/\} catch \{\s*\n\s*\/\/ 单条失败不影响整体/);
    });

    it('汇报文案只在真的补到资源时才追加', () => {
        expect(MAIN).toMatch(/return done > 0 \? `（另补 \$\{done\} 个关联资源）` : '';/);
        expect(MAIN).toMatch(/message: `已获取并关联：\$\{relPath\}\$\{assetNote\}`/);
    });
});
