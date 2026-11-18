// Steam 封面图床的**唯一真源**守卫。
//
// 🔴 由来（2026-11-08 技术债清理）：同一个 URL 模板曾在 4 个地方各写一遍
//    （`services/steam.ts`、`pure/steamSync.ts`、`pure/searchDisplay.ts`、`modals/SteamSyncModal.ts`），
//    其中一处的注释还自称「两处必须同值」—— 注释自己就先失真了。
//    封面是用户第一个看见的东西，改一处漏三处就是贴图 404。
//
// ⚠️ 这条测试的价值不在"函数返回什么"（那是 steamSync.test.ts 已有的），
//    而在于**锁住"不再有第二处硬编码"**这个结构约束。删掉它，技术债会原样长回来。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STEAM_COVER_BASE, steamCoverUrl } from 'pure/steamCover';

const ROOT = resolve(__dirname, '..');

/** 读源码文本；文件不在就抛（防止改名后这条守卫静默失效） */
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** 去掉注释，避免"注释里提到了 URL"被当成第二处硬编码 */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 2026-11-08 Steam 封面图床唯一真源', () => {
    it('URL 拼接口径：竖版 library_600x900，不是 32×32 的 img_icon_url', () => {
        expect(steamCoverUrl(620)).toBe(`${STEAM_COVER_BASE}/620/library_600x900.jpg`);
        expect(steamCoverUrl(620)).not.toContain('img_icon_url');
    });

    it('🔴 四个历史调用点都不再硬编码图床（改一处漏三处 = 贴图 404）', () => {
        const files = [
            'src/services/steam.ts',
            'src/pure/steamSync.ts',
            'src/pure/searchDisplay.ts',
            'src/modals/SteamSyncModal.ts',
        ];
        for (const f of files) {
            const code = stripComments(read(f));
            expect(code, `${f} 里仍有硬编码图床/封面路径，应改走 pure/steamCover`).not.toContain(
                'cdn.cloudflare.steamstatic.com',
            );
            expect(code, `${f} 里仍有硬编码 library_600x900`).not.toContain('library_600x900');
        }
    });

    it('唯一真源本身只有一处图床常量', () => {
        const src = stripComments(read('src/pure/steamCover.ts'));
        const hits = src.match(/https:\/\/cdn\.cloudflare\.steamstatic\.com/g) ?? [];
        expect(hits.length).toBe(1);
    });
});
