/**
 * 🔴 m12958 守护：曲库结果的「发行年 / 题材 / 简介」从三平台一路走到表单的接缝。
 *
 * 用户报障（2026-11-19 逐字）：「还有从三大平台搜索或同步得到的条目没有发行年、题材、简介」。
 *
 * 本文件**不重复测解析**（那些在 `tests/dl-qq` / `tests/dl-kugou` / `tests/songLibrary`），
 * 只守三件「单测看不见、断了就静默退化」的事：
 *   ① 宿主有没有把 `fetchSongAlbumMeta` 真的挂到表单上（少一个 prop ⇒ 回调是默认空函数，永远填不上）；
 *   ② 表单拿到的**平台键**是 `qq`/`kugou` 而不是「QQ音乐」这种显示名（传错 ⇒ 宿主返回 `{}`，静默失效）；
 *   ③ 「测试连接」不许回潮成 `parseQqUserInfo`（改回去 = 真实 Cookie 恒判失败）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const form = readFileSync(resolve(ROOT, 'src/views/components/EntryForm.svelte'), 'utf8');
const modal = readFileSync(resolve(ROOT, 'src/modals/EntryModal.ts'), 'utf8');
const mainTs = readFileSync(resolve(ROOT, 'main.ts'), 'utf8');
const dlIndex = readFileSync(resolve(ROOT, 'src/services/dl/index.ts'), 'utf8');
const qqSrc = readFileSync(resolve(ROOT, 'src/pure/dl/qq.ts'), 'utf8');

/** 剥注释：源码注释里写满了「⛔ 不许 xxx」的反面教材，不剥会把自己写的警告判成命中 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * 取某个函数/方法体（按大括号深度配对）。
 *
 * ⚠️ 拿不到就抛 —— ⛔ 不许「找不到也当通过」，那正是假绿的来源。
 *
 * 🔴 两个必须做对的地方（都踩过，都导致反向守卫变空转）：
 *   ① 先配对**参数表的圆括号**；
 *   ② 再**跳过泛型/类型字面量里的 `{}`**。`dlTestConnection` 的返回类型是
 *      `Promise<{ ok: boolean; message: string }>` —— 直接 `indexOf('{', afterParams)`
 *      会命中那个**类型字面量**的大括号，取回来的「函数体」只有 31 个字符，
 *      于是「⛔ 不许出现 parseQqUserInfo」永远为真。
 *      实测：故意在函数体里插入 `parseQqUserInfo` 仍然 18 条全绿 —— 假绿。
 */
function bodyOf(src: string, signature: string): string {
    const at = src.indexOf(signature);
    if (at < 0) throw new Error(`签名未找到：${signature}`);
    const paren = src.indexOf('(', at);
    if (paren < 0) throw new Error(`未找到参数表：${signature}`);
    // ① 配对参数表圆括号
    let pd = 0;
    let afterParams = -1;
    for (let i = paren; i < src.length; i++) {
        if (src[i] === '(') pd++;
        else if (src[i] === ')') {
            pd--;
            if (pd === 0) {
                afterParams = i;
                break;
            }
        }
    }
    if (afterParams < 0) throw new Error(`参数表未闭合：${signature}`);
    // ② 跳过 `<...>` 里的类型字面量，找真正的函数体大括号（`=>` 的 `>` 不算收窄）
    let angle = 0;
    let open = -1;
    for (let i = afterParams + 1; i < src.length; i++) {
        const ch = src[i];
        if (ch === '<') angle++;
        else if (ch === '>' && src[i - 1] !== '=') angle--;
        else if (ch === '{' && angle === 0) {
            open = i;
            break;
        } else if (ch === ';' && angle === 0) break; // 声明式签名（无函数体）
    }
    if (open < 0) throw new Error(`未找到函数体：${signature}`);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(open, i + 1);
        }
    }
    throw new Error(`函数体未闭合：${signature}`);
}

describe('m12958 · 装配链路（宿主 → 弹窗 → 表单）', () => {
    it('① 宿主实现了 `fetchSongAlbumMeta(platform, albumKey)`', () => {
        expect(mainTs).toContain('async fetchSongAlbumMeta(platform: string, albumKey: string)');
    });

    it('① 宿主把 `albumMetaFor` 与 `AlbumMeta` 从 `services/dl` 正确导入', () => {
        // 只判「这两个名字在 import 块里」——不判顺序，改名重构不该假红
        const dlImportAt = mainTs.indexOf("} from 'services/dl'");
        expect(dlImportAt).toBeGreaterThan(0);
        const importBlock = mainTs.slice(mainTs.lastIndexOf('import {', dlImportAt), dlImportAt);
        expect(importBlock).toContain('albumMetaFor');
        expect(importBlock).toContain('type AlbumMeta');
    });

    it('② 弹窗把 `onFetchSongAlbumMeta` 挂到表单上（少这一行 ⇒ 表单里是默认空函数，永远填不上）', () => {
        expect(modal).toContain('onFetchSongAlbumMeta');
        expect(modal).toContain('this.plugin.fetchSongAlbumMeta(platform, albumKey)');
    });

    it('② 表单声明了 `onFetchSongAlbumMeta` prop', () => {
        expect(form).toContain('export let onFetchSongAlbumMeta');
    });
});

describe('m12958 · 表单回填（三个字段各自独立判空）', () => {
    const code = stripComments(form);

    it('回填 `genre → genres` / `description → summary` / `publishDate → year`', () => {
        expect(code).toContain('meta.genre && !genres');
        expect(code).toContain('meta.description && !summary');
        expect(code).toContain('meta.publishDate && !year');
    });

    it('🔴 发行年只取 4 位（`publishDate` 是 `YYYY-MM-DD`，⛔ 整串塞进「发行年」框）', () => {
        expect(code).toContain('meta.publishDate.slice(0, 4)');
    });

    it('🔴 平台键取 id 的**第二段**（`songlib:<平台键>:<歌曲id>`），⛔ 不用 `platformLabel` 显示名', () => {
        const callAt = code.indexOf('onFetchSongAlbumMeta(');
        expect(callAt).toBeGreaterThan(0);
        const seg = code.slice(Math.max(0, callAt - 700), callAt);
        // 正向：从 id 切第二段
        expect(seg).toContain("String(r.id ?? '').split(':')[1]");
        // 反向守卫：这段里不许出现 platformLabel（显示名会让宿主静默返回 {}）
        expect(seg).not.toContain('platformLabel');
    });

    it('只在「曲库结果 + 有专辑键」时才走（⛔ 每点一条都无脑发请求）', () => {
        expect(code).toContain("r.source === SONG_LIB_ID && 'albumKey' in r && r.albumKey");
    });

    it('补拉失败静默（catch 里不改字段，⛔ 不许抛到 pick 主流程）', () => {
        const at = code.indexOf('onFetchSongAlbumMeta(');
        const tail = code.slice(at, at + 900);
        expect(tail).toContain('catch');
    });
});

describe('m12958 · 服务层契约', () => {
    it('`albumMetaFor` 对网易云恒返回 `{}`（其专辑接口 `-462` 被拦，填了只会白发一次必失败的请求）', () => {
        const body = bodyOf(dlIndex, 'export async function albumMetaFor(');
        expect(body).toContain("platform === 'qq'");
        expect(body).toContain("platform === 'kugou'");
        // 没有 netease 分支 ⇒ 落到最后的 `return {}`
        expect(body).not.toContain("platform === 'netease'");
        expect(body).toContain('return {}');
    });

    it('`albumMetaFor` 不抛（整体 try/catch）', () => {
        const body = bodyOf(dlIndex, 'export async function albumMetaFor(');
        expect(body).toContain('try {');
        expect(body).toContain('catch');
    });

    it('🔴 「测试连接」的 qq 分支走结构检查，⛔ 不许回潮成 `parseQqUserInfo`（改回去 = 真实 Cookie 恒判失败）', () => {
        expect(dlIndex).toContain('checkQqCookieShape(c)');
        // 反向守卫：`dlTestConnection` 函数体里不许再出现旧的在线校验
        const body = bodyOf(dlIndex, 'export async function dlTestConnection(');
        expect(body).not.toContain('parseQqUserInfo');
        expect(body).not.toContain('buildQqUserInfoUrl');
    });

    it('保留 `buildQqUserInfoBody/parseQqUserInfo` 的**导出**（删了会破既有单测，且它们是取证记录）', () => {
        expect(qqSrc).toContain('export function parseQqUserInfo');
        expect(qqSrc).toContain('export function buildQqUserInfoUrl');
    });

    it('`checkQqCookieShape` 的成功文案必须同时含「结构完整」与「无法在线确认」', () => {
        const body = bodyOf(qqSrc, 'export function checkQqCookieShape(');
        expect(body).toContain('结构完整');
        expect(body).toContain('无法在线确认');
    });

    it('酷狗专辑详情不产出题材（`category` 是数字编号）', () => {
        const kugou = readFileSync(resolve(ROOT, 'src/pure/dl/kugou.ts'), 'utf8');
        const body = bodyOf(kugou, 'export function parseKugouAlbumDetail(');
        expect(body).toContain("genre: ''");
        // 反向守卫：不许把 category 当题材
        expect(body).not.toContain('category');
    });
});

describe('m12958 · 落库链路不丢字段', () => {
    it('`DownloadSong` 带 `publishDate` 与 `albumKey`（⛔ 叫 albumId —— `album` 已是专辑名）', () => {
        const at = dlIndex.indexOf('export interface DownloadSong');
        const block = dlIndex.slice(at, at + 2600);
        expect(block).toContain('publishDate?: string');
        expect(block).toContain('albumKey?: string');
        expect(block).not.toContain('albumId?: string');
    });

    it('三条映射都往下传了 `publishDate`', () => {
        for (const fn of ['mapNeteaseSongs', 'mapQqSongs', 'mapKugouSongs']) {
            const body = bodyOf(dlIndex, `function ${fn}(`);
            expect(body, fn).toContain('publishDate: s.publishDate');
        }
    });

    it('QQ / 酷狗映射带 `albumKey`，网易云**不带**（它没有可用专辑接口）', () => {
        // ⚠️ 必须用**剥注释**后的源码：`mapNeteaseSongs` 里那段「⛔ 这里不填 albumKey」的说明
        //    本身就是反面教材，不剥会把警告判成命中（本文件正是靠那条注释解释为什么不填）。
        const code = stripComments(dlIndex);
        expect(bodyOf(code, 'function mapQqSongs(')).toContain('albumKey: s.albumMid');
        expect(bodyOf(code, 'function mapKugouSongs(')).toContain('albumKey: s.albumId');
        expect(bodyOf(code, 'function mapNeteaseSongs(')).not.toContain('albumKey');
    });
});
