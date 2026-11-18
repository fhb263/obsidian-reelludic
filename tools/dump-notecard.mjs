// 把**真实**的 `buildNoteCardGroups` 输出导成 JSON，喂给 `_shot/src/` 的复现页。
//
// 🔴 为什么必须走这一步：`_shot/src/notecard-two-col.html` 里手工写了 TV_GROUPS / MOVIE_GROUPS，
//    那是「照着想象的结构写死」—— 用它验「音乐卡会不会冒出书籍字段」永远验不出来，
//    因为假数据里根本没有那个组。复现页要能证明真问题，数据就必须来自**真源函数**。
//
// 用法：node tools/dump-notecard.mjs → 写 _shot/notecard-data.json + _shot/src/_notecard-data.js
//       （复现页用 file:// 打开时 fetch 不到同目录 JSON，所以同时输出一份可 <script> 引入的 .js）
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, 'src');
const OUT_JS = resolve(ROOT, '_shot/src/_notecard-data.js');
const OUT_JSON = resolve(ROOT, '_shot/notecard-data.json');
const TMP_TS = resolve(ROOT, '_shot/.dump-entry.ts');
const TMP_MJS = resolve(ROOT, '_shot/.dump-entry.mjs');

const entry = `
import { buildNoteCardGroups } from 'pure/noteCard';
import { ENTRY_TYPES } from 'data/types';
export { buildNoteCardGroups, ENTRY_TYPES };
`;
writeFileSync(TMP_TS, entry, 'utf8');

// 🔴 用 esbuild 的 `alias` 选项，⛔ 别用 onResolve 插件自己拼路径：
//    插件返回的路径被 esbuild 当成**最终路径**，不会再补 `.ts` 后缀
//    ⇒ 报 `Could not read from file: src\pure\noteCard`（本轮踩过）。
const bundled = await build({
    entryPoints: [TMP_TS],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    alias: {
        pure: resolve(SRC, 'pure'),
        data: resolve(SRC, 'data'),
        services: resolve(SRC, 'services'),
        modals: resolve(SRC, 'modals'),
        ui: resolve(SRC, 'ui'),
        obsidian: resolve(ROOT, 'tests/mocks/obsidian.ts'),
    },
    resolveExtensions: ['.ts', '.js', '.mjs'],
    logLevel: 'silent',
});
writeFileSync(TMP_MJS, bundled.outputFiles[0].text, 'utf8');
const { buildNoteCardGroups: bg, ENTRY_TYPES } = await import(pathToFileURL(TMP_MJS).href);

// 六类型各塞满「所有已知字段」，让跨类型串组无所遁形
const STUFF = {
    translator: '译者甲', publisher: '出版社甲', isbn: '9787000000000', binding: '精装',
    price: '59.00', pageCount: 320, readingPage: 120, readingTotalPage: 320, readMinutes: 95,
    author: '作者甲', album: '专辑甲',
    director: '导演甲', screenwriter: ['编剧甲'], cast: ['演员甲', '演员乙'],
    country: '中国', language: '汉语', durationMin: 118, producer: '出品方甲',
    developer: '开发甲',
    year: 2020, rating: 4, mood: 'wow', tags: ['标签甲'],
};

const entries = {};
for (const type of ENTRY_TYPES) {
    const e = { id: `demo-${type}`, type, title: `演示 · ${type}`, status: 'watched', ...STUFF };
    // 集评价：只给剧集/动画放（电影没有单集概念）
    if (type === 'tv' || type === 'anime') {
        e.episodeReviews = {
            0: { status: 'watched', tags: ['highlight'], mood: 'wow', note: '开场就炸' },
            2: { status: 'watched', tags: ['flaw'], note: '中段拖' },
            5: { status: 'watching' },
        };
    }
    entries[type] = bg(e);
}

mkdirSync(resolve(ROOT, '_shot/src'), { recursive: true });
writeFileSync(OUT_JSON, JSON.stringify(entries, null, 2), 'utf8');
writeFileSync(OUT_JS, `window.__NC_DATA__ = ${JSON.stringify(entries)};\n`, 'utf8');

for (const [type, groups] of Object.entries(entries)) {
    console.log(`${type.padEnd(6)} → ${groups.map((g) => `${g.key}|${g.label}:${g.rows.length}`).join('  ')}`);
}
console.log(`\n写出 ${OUT_JSON}\n写出 ${OUT_JS}`);
