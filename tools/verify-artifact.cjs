/**
 * 核对产物的**唯一正确方式**：先把 \uXXXX 转义还原成真实中文，再数文案。
 * 🔴 本仓 esbuild 产物里中文全是 `\uXXXX` 转义（如 "\u7279\u8272\uFF1A"），
 *    直接拿中文字面量去 indexOf 一定数到 0 —— 那不是"文案丢了"，是我的量法错了。
 */
const fs = require('fs');
const dst = 'C:\\Users\\kest\\Desktop\\临时测试库\\.obsidian\\plugins\\obsidian-reelludic\\main.js';
const raw = fs.readFileSync(dst, 'utf8');
// 只还原字符串里的 \uXXXX（全文件还原会把 JS 语法也改掉，这里只为计数，安全）
const s = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));

const cnt = (t) => s.split(t).length - 1;
const show = (label, t, expect) => {
    const n = cnt(t);
    const ok = expect === undefined ? '' : n === expect ? '  ✅' : `  ❌（期望 ${expect}）`;
    console.log(`${label.padEnd(46)} = ${String(n).padStart(2)}${ok}`);
};

console.log('════ 需求① 列宽竖指示器 ════');
show('柄反查 :scope > .rl-tbl-resize', ':scope > .rl-tbl-resize', 1);
show('柄命中区 10px', 'width:10px;margin-left:-5px', 1);
show('可见竖条 2px ::before', "::before{content:'';position:absolute;left:4px", 1);
show('松手/取消都复位 resizing（pointercancel）', "'pointercancel'", undefined);

console.log('\n════ 需求② 海报墙列数已删 ════');
show('POSTER_WALL_COLUMNS_MAX', 'POSTER_WALL_COLUMNS_MAX', 0);
show('设置项文案「海报墙列数」（只在注释里）', '海报墙列数', undefined);

console.log('\n════ 前几轮：同步按钮统一「立即同步」 ════');
// 5 颗按钮的 text 都是 '立即同步'（Steam 另有两处 setText 恢复）
show('「立即同步」总数（5 按钮 + 2 恢复 + 注释）', '立即同步', undefined);
for (const old of ['同步豆瓣收藏', '同步 Bangumi 收藏', '同步 TMDB 清单']) {
    show(`旧按钮文案「${old}」`, old, 0);
}
// ⚠️ 下面两条的残留都是**无害**的，别当成回归：
//   · 「从微信读书同步书架」还剩 1 处**代码文案** = 同步弹窗的 `titleEl`（modal 标题），
//     用户当时的原话只改「同步按钮文字」，modal 标题是另一件事（已向用户披露）。
//   · 「同步 Steam」还剩 1 处**代码文案** = steam.hint 里那句「返回游戏元数据与『同步 Steam』」，
//     它描述的是**能力**（能同步），不是按钮自己的名字。
show('旧按钮文案「从微信读书同步书架」（modal 标题 1 + 注释 4）', '从微信读书同步书架', 5);
show('旧按钮文案「同步 Steam」（hint 1 + 注释 5）', '同步 Steam', 6);

console.log('\n════ 前几轮：用途段按服务类别写 ════');
show('豆瓣：返回书籍、游戏、音乐、影视、动画、漫画元数据', '用途：返回书籍、游戏、音乐、影视、动画、漫画元数据', 1);
// 带「用途：」三段式的源 = 7 个（豆瓣/微信读书/TMDB/Bangumi/Google Books/OMDb/IGDB）+ Steam 1 = 8
// 其中 book 组是微信读书 + Google Books 两个用「用途：返回书籍元数据」；
// Open Library 是免 Key 源，句式是「Open Library（免 Key）：返回书籍元数据 —— …」（不带「用途：」前缀）
show('微信读书/Google Books：用途：返回书籍元数据', '用途：返回书籍元数据', 2);
show('Open Library：返回书籍元数据（免 Key 句式）', 'Open Library（免 Key）：返回书籍元数据', 1);
show('TMDB/OMDb：返回影视元数据', '用途：返回影视元数据', 2);
show('Bangumi：返回动画、漫画元数据', '用途：返回动画、漫画元数据', 1);
show('Steam/IGDB：返回游戏元数据', '用途：返回游戏元数据', 2);
show('MusicBrainz/iTunes：返回音乐元数据', '返回音乐元数据', 2);
show('AniList：返回动画元数据', '返回动画元数据', 1);
show('MangaDex：返回漫画元数据', '返回漫画元数据', 1);
show('旧串「书籍等元数据源」', '书籍等元数据源', 0);
show('旧串「并排源」', '并排源', 0);

console.log('\n════ 前几轮：三组改名 + TMDB 徽标 ════');
show('组名「音乐下载源凭据」', '音乐下载源凭据', undefined);
show('组名键「元数据搜索源凭据」', '元数据搜索源凭据', undefined);
show('组名键「元数据搜索源启用」', '元数据搜索源启用', undefined);
show('旧组名键「元数据源启用」（残留应为 0）', '"元数据源启用"', 0);
show('旧组名键「音乐源凭据」（残留应为 0）', '"音乐源凭据"', 0);
