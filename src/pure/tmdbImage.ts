// TMDB 图片 CDN 的地址拼接（纯逻辑，**零 import**）。
//
// 为什么放在 pure 层（P1-8 分层债）：`pure/searchDisplay` 要给搜索结果算封面 URL，
// 原先是从 `services/tmdb` **值导入** `posterUrl` ⇒ pure → services 形成运行时穿透，
// services 侧那一串 HTTP/客户端依赖会顺着依赖图被拉进来，pure 层的「可单测、零副作用」
// 承诺当场作废。
//
// 这里只留一个常量 + 一个纯拼接函数，不引任何模块，故可被 pure 与 services 双向安全复用：
//   · `services/tmdb.ts` 原样 re-export `posterUrl`（保持既有调用方 `main.ts` 与
//     `tests/tmdb.test.ts` 的 import 路径不变）
//   · `pure/searchDisplay.ts` 改为直接从本模块取，运行时不再碰 services
//
// ⚠️ 尺寸档位（`w500` 默认）是 TMDB 的既定参数，⛔ 别改成 `original`：
//    原图动辄几 MB，列表页几十张封面会直接把内存和流量打满。

const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(path: string | undefined, size: string = 'w500'): string | undefined {
    if (!path) return undefined;
    return `${IMAGE_BASE}/${size}${path}`;
}
