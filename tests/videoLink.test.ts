// 播放器时间戳链接（pure/videoLink）：构造 / 解析 / 边界 / 反向守卫。
//
// 这里守的是「点击跳转」最容易静默出错的几件事：
//   ① 解析过宽 → **吞掉用户的普通链接点击**（外链、阅读器深链、别的 scheme）
//   ② 解析过窄 → 自己写出来的链接自己认不出（往返一致性）
//   ③ 脏值（负数 / 非数字 / 超大秒数 / 非法转义）被当成合法目标
import { describe, expect, it } from 'vitest';
import { buildShotBlock, buildTimeLink, matchLineLink, parseMediaFragmentTime, parseSecondsText, parseTimeLink, sanitizeFileStem, shotFileName, videoDeepLinkFromParams } from 'pure/videoLink';
import { parseReaderDeepLink } from 'pure/readerLink';

describe('pure/videoLink parseSecondsText', () => {
    it('秒数 / 小数 / 分:秒 / 时:分:秒 都能解析', () => {
        expect(parseSecondsText('3')).toBe(3);
        expect(parseSecondsText('12.5')).toBe(12.5);
        expect(parseSecondsText('0:03')).toBe(3);
        expect(parseSecondsText('1:02:03')).toBe(3723);
        expect(parseSecondsText(' 90 ')).toBe(90);
    });

    it('宽松接受非规范写法（用户手写友好），但拒绝真正非法的值', () => {
        expect(parseSecondsText('10:3')).toBe(603); // Media Extended 视其为非法；这里按「分钟:秒」宽松解析
        expect(parseSecondsText('1:70')).toBe(130);
        for (const bad of ['', '   ', 'abc', '1:2:3:4', '-1', '3s', '1:2:']) {
            expect(parseSecondsText(bad), `应拒绝 ${JSON.stringify(bad)}`).toBeNull();
        }
    });

    it('上限 24 小时：挡住脏值与明显手误', () => {
        expect(parseSecondsText('86400')).toBe(86400);
        expect(parseSecondsText('86401')).toBeNull();
    });
});

describe('pure/videoLink parseMediaFragmentTime', () => {
    it('认 `#t=`（Media Fragment 标准）与 `?t=`（用户手写习惯）', () => {
        expect(parseMediaFragmentTime('影片.mp4#t=3')).toBe(3);
        expect(parseMediaFragmentTime('影片.mp4?t=3')).toBe(3);
        expect(parseMediaFragmentTime('影片.mp4#t=0:03')).toBe(3);
    });

    it('范围只取起点（播放器无片段播放语义）', () => {
        expect(parseMediaFragmentTime('影片.mp4#t=3,10')).toBe(3);
    });

    it('没有时间片段 / 片段非法 → null', () => {
        expect(parseMediaFragmentTime('影片.mp4')).toBeNull();
        expect(parseMediaFragmentTime('影片.mp4#t=abc')).toBeNull();
        expect(parseMediaFragmentTime('')).toBeNull();
    });
});

describe('pure/videoLink buildTimeLink（双轨）', () => {
    // 🔴 两条报告同一个根因（2026-09-19 用户实测）：首版**库外分支返回裸 URL**，没包 markdown 链接语法 →
    //    笔记里是一串纯文本；而且裸 URL **阅读视图会自动链接化（点得动）、编辑视图只是文本（点不动）**。
    it('库内 → Media Fragment 形态（生态标准，别的工具也认）', () => {
        expect(buildTimeLink({ seconds: 3, filePath: '影片.mp4' })).toBe('[0:03](影片.mp4#t=3)');
    });

    it('路径含空格 → 用 <> 包住（markdown 标准写法）', () => {
        expect(buildTimeLink({ seconds: 75, filePath: '目录/我的 影片.mp4' })).toBe('[1:15](<目录/我的 影片.mp4#t=75>)');
    });

    // 🔴 2026-09-19 用户实测报障：链接文字里的空格会让 Obsidian 的 token 检测在空白处截断
    //    （app.js `getClickableTokenAt` → `UE()`），把碎片 `5:56` 当 URL 去 `new URL()` → Invalid URL +
    //    「无法打开」。⇒ 文案一律不加空格。
    it('🔴 链接文字**不得含空白**（否则 Obsidian 编辑器里报 Invalid URL / 点了无法打开）', () => {
        for (const opts of [{ seconds: 356, entryId: 'e_1', ep: 0 }, { seconds: 356, filePath: 'a.mp4' }]) {
            const label = /^\[([^\]]+)\]/.exec(buildTimeLink(opts) ?? '')?.[1] ?? '';
            expect(label, `文案带空白：${label}`).not.toMatch(/\s/);
        }
        const shot = buildShotBlock({ fileName: 'a.png', timeLink: buildTimeLink({ seconds: 356, filePath: 'a.mp4' }) ?? '' });
        expect(/^!\[\[[^\]]+\]\]\n\[([^\]]+)\]/.exec(shot)?.[1] ?? '').not.toMatch(/\s/);
    });

    it('🔴 库外 → 条目深链**也必须包 markdown 链接语法**（返回裸 URL 会导致「编辑视图点不动」）', () => {
        expect(buildTimeLink({ seconds: 356, entryId: 'e_1789309055145_jc7m', ep: 0 })).toBe(
            '[5:56](obsidian://reelludic?action=video&entry=e_1789309055145_jc7m&ep=0&t=356)',
        );
    });

    it('🔴 反向守卫：任何形态都不得返回裸 URL（必须带 markdown 链接语法）', () => {
        for (const opts of [{ seconds: 3, entryId: 'e_1', ep: 0 }, { seconds: 3, filePath: 'a.mp4' }]) {
            const out = buildTimeLink(opts) ?? '';
            expect(out.startsWith('['), `裸 URL 形态：${out}`).toBe(true);
            expect(out).toMatch(/^\[[^\]]+\]\(.+\)$/);
        }
    });

    // 🔴 口径改判（用户 2026-09-19）：文字**只留时间**，去掉「·回到视频」尾巴。
    it('链接文字 = **只有时间**（`5:56`，不带任何后缀/空白）', () => {
        const label = /^\[([^\]]+)\]/.exec(buildTimeLink({ seconds: 356, entryId: 'e_1', ep: 0 }) ?? '')?.[1] ?? '';
        expect(label).toBe('5:56');
    });

    it('同时给了 filePath 与 entryId → 库内形态优先', () => {
        expect(buildTimeLink({ seconds: 3, filePath: 'a.mp4', entryId: 'e_1' })).toBe('[0:03](a.mp4#t=3)');
    });

    it('标签可自定义；缺可定位参数 → null（不产出不可用链接）', () => {
        expect(buildTimeLink({ seconds: 3, filePath: 'a.mp4', label: '开场' })).toBe('[开场](a.mp4#t=3)');
        expect(buildTimeLink({ seconds: 3 })).toBeNull();
        expect(buildTimeLink({ seconds: 3, entryId: 'bad id!' })).toBeNull();
    });

    it('往返：从产出的链接里抽出 URL 再解析，得到同一目标', () => {
        const link = buildTimeLink({ seconds: 356, entryId: 'e_1', ep: 2 }) ?? '';
        const url = /\]\((.+)\)$/.exec(link)?.[1] ?? '';
        expect(parseTimeLink(url)).toEqual({ kind: 'entry', entryId: 'e_1', ep: 2, seconds: 356 });
    });
});

describe('pure/videoLink parseTimeLink', () => {
    it('认自己产出的两种形态（往返一致）', () => {
        expect(parseTimeLink('obsidian://reelludic?action=video&entry=e_123&ep=2&t=3')).toEqual({
            kind: 'entry', entryId: 'e_123', ep: 2, seconds: 3,
        });
        expect(parseTimeLink('影片.mp4#t=3')).toEqual({ kind: 'vault', filePath: '影片.mp4', seconds: 3 });
    });

    it('库内形态：URL 编码还原、`<>` 已被浏览器剥掉也能认', () => {
        expect(parseTimeLink('目录/%E6%88%91%E7%9A%84%20%E5%BD%B1%E7%89%87.mp4#t=75')).toEqual({
            kind: 'vault', filePath: '目录/我的 影片.mp4', seconds: 75,
        });
        expect(parseTimeLink('我的 影片.mp4#t=75')).toEqual({ kind: 'vault', filePath: '我的 影片.mp4', seconds: 75 });
    });

    it('🔴 反向守卫：带 scheme 的外链一律不接管（否则点网页链接会「什么都不发生」）', () => {
        for (const href of [
            'https://example.com/v.mp4#t=3',
            'http://example.com/v.mp4?t=3',
            'video://影片.mp4?t=3', // 用户原案的 scheme：**不认**（插件注册不了 OS 协议，见模块头注释）
            'myreader://x?t=3',
        ]) {
            expect(parseTimeLink(href), `不该接管 ${href}`).toBeNull();
        }
    });

    it('🔴 反向守卫：不误吞阅读器深链与其它 action', () => {
        expect(parseTimeLink('obsidian://reelludic?action=jump&book=e_1&block=bk1')).toBeNull();
        expect(parseTimeLink('obsidian://reelludic?action=video&entry=e_1')).toBeNull(); // 缺 t
        expect(parseTimeLink('obsidian://reelludic?action=video&entry=bad!id&t=3')).toBeNull(); // id 白名单
        expect(parseTimeLink('obsidian://reelludic?action=video&entry=e_1&t=abc')).toBeNull();
        expect(parseTimeLink('obsidian://other?id=1&t=3')).toBeNull(); // 不是本插件
    });

    it('库内形态边界：空路径 / 绝对路径 / 纯片段 → null', () => {
        expect(parseTimeLink('')).toBeNull();
        expect(parseTimeLink('#t=3')).toBeNull();
        expect(parseTimeLink('/abs/v.mp4#t=3')).toBeNull();
    });

    it('与阅读器深链互不干扰（同一前缀，各自 action）', () => {
        expect(parseReaderDeepLink('obsidian://reelludic?action=video&entry=e_1&t=3')).toBeNull();
    });
});

describe('pure/videoLink 截图块', () => {
    it('文件名带时间戳、滤掉非法字符', () => {
        expect(shotFileName('影片名', 3)).toBe('影片名 0-03.png');
        expect(shotFileName('第 3 集/正片', 3723)).toBe('第 3 集 正片 1-02-03.png');
        expect(shotFileName('', 3)).toBe('截图 0-03.png');
        expect(sanitizeFileStem('a\\b:c*d?e"f<g>h|i#j^k[l]m')).toBe('a b c d e f g h i j k l m');
    });

    // 🔴 2026-09-19 用户报障「截图生成的时间戳无法跳转」的真根因：**入参契约与真实调用方不一致**。
    //    旧签名收「裸目标」（`a.mp4#t=3`），而唯一调用方 `saveVideoShot` 传的是 `buildTimeLink` 的产物
    //    （**已包 markdown 语法的完整链接**）→ 产出**嵌套链接**
    //    `![[图]]` + `[7:46]([7:46](obsidian://…))` → 完全点不动。
    //    而单测用的正是「裸目标」⇒ **测试全绿、真实路径全坏**（跑了 5 个版本都没发现）。
    //    ⇒ 契约改成「入参 = 完整 markdown 链接」，本函数**只做两行拼接**。
    it('极简两行：图 + 回跳时间戳链接（入参是 buildTimeLink 的产物，原样落第二行）', () => {
        const timeLink = buildTimeLink({ seconds: 3, filePath: '影片.mp4' }) ?? '';
        expect(timeLink).toBe('[0:03](影片.mp4#t=3)');
        expect(buildShotBlock({ fileName: '影片名 0-03.png', timeLink })).toBe(`![[影片名 0-03.png]]\n${timeLink}`);
    });

    it('🔴 端到端：块里的链接**必须能被解析回同一目标**（这才是「点得动、跳得到」的判据）', () => {
        // 抽目标时连同 `<>` 一起去掉（含空格路径的写法；浏览器/阅读视图本来也会剥掉它）
        const destOf = (line: string): string => (/\]\((.+)\)$/.exec(line)?.[1] ?? '').replace(/^<|>$/g, '');
        for (const opts of [
            { seconds: 466, entryId: 'e_1', ep: 0 }, // 库外：条目深链
            { seconds: 466, filePath: '目录/我的 影片.mp4' }, // 库内：Media Fragment
        ]) {
            const timeLink = buildTimeLink(opts) ?? '';
            const block = buildShotBlock({ fileName: '图.png', timeLink });
            const second = block.split('\n')[1] ?? '';
            // 第二行必须以链接语法起头（裸 URL 在编辑视图点不动）
            expect(second.startsWith('['), `第二行不是链接：${second}`).toBe(true);
            // 从第二行里抽出目标再解析 → 必须与构造时同源
            expect(parseTimeLink(destOf(second))).toEqual(parseTimeLink(destOf(timeLink)));
            expect(parseTimeLink(destOf(second))?.seconds).toBe(466);
        }
    });

    it('🔴 反向守卫：产出里**不得出现嵌套链接**（`]([`）—— 那正是用户报的「点了不跳」', () => {
        const timeLink = buildTimeLink({ seconds: 466, entryId: 'e_1', ep: 0 }) ?? '';
        const block = buildShotBlock({ fileName: '图.png', timeLink });
        // 先确认块真的产出了（否则下面的否定断言会「真空通过」）
        expect(block.startsWith('![[图.png]]\n[')).toBe(true);
        expect(block).not.toContain(']([');
        expect(block.split('\n')).toHaveLength(2);
    });

    it('🔴 反向守卫：传「裸目标」→ 空串（宁可什么都不写，也绝不产出点不动的裸 URL 行）', () => {
        expect(buildShotBlock({ fileName: '图.png', timeLink: '影片.mp4#t=3' })).toBe('');
        expect(buildShotBlock({ fileName: '图.png', timeLink: 'obsidian://reelludic?action=video&entry=e_1&t=3' })).toBe('');
    });

    // 截图块的链接文字与「插入时间戳」的默认文字必须一致（两处各写一遍必然漂）
    it('与时间戳链接用同一套文字（**只有时间**）', () => {
        const timeLink = buildTimeLink({ seconds: 356, filePath: 'a.mp4' }) ?? '';
        const stampLabel = /^\[([^\]]+)\]/.exec(timeLink)?.[1] ?? '';
        expect(stampLabel).not.toBe('');
        expect(buildShotBlock({ fileName: 'a.png', timeLink })).toContain(`[${stampLabel}](`);
    });

    it('缺参 → 空串（不写出半截块）', () => {
        const ok = buildTimeLink({ seconds: 3, filePath: 'a.mp4' }) ?? '';
        expect(buildShotBlock({ fileName: '', timeLink: ok })).toBe('');
        expect(buildShotBlock({ fileName: 'a.png', timeLink: '' })).toBe('');
    });
});

// 🔴 2026-09-19 用户第三次报障的真根因之一（用户日志实证）：
//    `Received URL action {action: 'reelludic', entry: 'e_1789309055145_jc7m', ep: '0', t: '430'}`
//    —— Obsidian 的 URI 是 `obsidian://<action>?<params>`，**host 就是 action**，查询里的 `action=video`
//    被 host 名覆盖 ⇒ 旧实现「拼回 URL 再解析」时 action 已不是 `video` → 永远 null → 点了不跳。
//    ⇒ 协议处理器改成**按形状**认：有合法 `entry` 就是视频时间戳。
describe('pure/videoLink videoDeepLinkFromParams（协议处理器入口 · 按形状分派）', () => {
    it('entry 齐备即命中（不看 action）', () => {
        expect(videoDeepLinkFromParams({ action: 'reelludic', entry: 'e_1789309055145_jc7m', ep: '0', t: '430' })).toEqual({
            kind: 'entry', entryId: 'e_1789309055145_jc7m', ep: 0, seconds: 430,
        });
        expect(videoDeepLinkFromParams({ action: 'video', entry: 'e_1', ep: '2', t: '3' })).toEqual({
            kind: 'entry', entryId: 'e_1', ep: 2, seconds: 3,
        });
        expect(videoDeepLinkFromParams({ entry: 'e_1' })).toEqual({ kind: 'entry', entryId: 'e_1', ep: 0, seconds: 0 });
    });

    // entry 合法 = 已证明是本插件的链接（白名单挡得住别人的链接），所以 t 这里一律**宽**：
    // 宁可「打开视频从头播」，也不要再出现「点了什么都不发生」——后者正是这三轮报障的东西。
    it('t / ep 缺失或非法 → 按 0（宽在时间，严在 id）', () => {
        expect(videoDeepLinkFromParams({ entry: 'e_1', t: 'abc' })).toEqual({ kind: 'entry', entryId: 'e_1', ep: 0, seconds: 0 });
        expect(videoDeepLinkFromParams({ entry: 'e_1', t: '999999' })).toEqual({ kind: 'entry', entryId: 'e_1', ep: 0, seconds: 0 });
        expect(videoDeepLinkFromParams({ entry: 'e_1', ep: '-1', t: '5' })).toEqual({ kind: 'entry', entryId: 'e_1', ep: 0, seconds: 5 });
    });

    it('🔴 缺 entry / 脏值 → null（阅读器深链、别人的 action 一律不接）', () => {
        expect(videoDeepLinkFromParams({ book: 'e_1', block: 'bk1' })).toBeNull();
        expect(videoDeepLinkFromParams({ action: 'open', file: 'x.md' })).toBeNull();
        expect(videoDeepLinkFromParams({ entry: 'bad!id', t: '3' })).toBeNull();
        expect(videoDeepLinkFromParams({ entry: '' })).toBeNull();
        expect(videoDeepLinkFromParams(null)).toBeNull();
        expect(videoDeepLinkFromParams(undefined)).toBeNull();
    });
});

// 🔴 2026-09-19 用户第三次报障：**编辑视图下仍然跳不了**。读 Obsidian 核心得到判据（app.js `onEditorClick`
//    @2548591）：它要求可点 token 落在 `.external-link` / `.cm-url` / `.cm-link` / `.cm-underline` 这些
//    **CM6 span** 上 —— 编辑视图里的链接**不是 `<a>`**（阅读视图才是）。而我们的拦截器第一步就是
//    `target.closest('a')`，编辑视图拿不到 `<a>` → 直接 return ⇒ 编辑视图永远拦不到。
//    修法：编辑器里**目标不在 DOM 属性上**，得回**所在行的 markdown 源码**按「点击处的文字」把目标取回来。
describe('pure/videoLink matchLineLink（编辑器里按点击处文字取回链接目标）', () => {
    const line = '前文 [7:10·回到视频](obsidian://reelludic?action=video&entry=e_1&ep=0&t=430) 后文';

    it('按**链接文字**命中（Live Preview 点到的就是显示文字）', () => {
        expect(matchLineLink(line, '7:10·回到视频')).toBe('obsidian://reelludic?action=video&entry=e_1&ep=0&t=430');
    });

    it('按**目标**命中（源码模式点到的就是 URL 文本）', () => {
        expect(matchLineLink(line, 'obsidian://reelludic?action=video&entry=e_1&ep=0&t=430')).toBe(
            'obsidian://reelludic?action=video&entry=e_1&ep=0&t=430',
        );
    });

    it('`<>` 包裹的目标也认（含空格的库内路径），且把尖括号剥掉', () => {
        const l = '看 [0:03·回到视频](<目录/我的 影片.mp4#t=3>)';
        expect(matchLineLink(l, '0:03·回到视频')).toBe('目录/我的 影片.mp4#t=3');
        expect(matchLineLink(l, '目录/我的 影片.mp4#t=3')).toBe('目录/我的 影片.mp4#t=3');
    });

    it('同一行多条链接 → 各自命中各自的目标', () => {
        const l = '[0:03·回到视频](a.mp4#t=3) 与 [1:00·回到视频](b.mp4#t=60)';
        expect(matchLineLink(l, '0:03·回到视频')).toBe('a.mp4#t=3');
        expect(matchLineLink(l, '1:00·回到视频')).toBe('b.mp4#t=60');
    });

    it('🔴 反向守卫：点别处 / 整行文本 / 不存在的文字 → null（绝不误吞普通点击）', () => {
        expect(matchLineLink(line, '')).toBeNull();
        expect(matchLineLink(line, '前文')).toBeNull();
        expect(matchLineLink(line, '后文')).toBeNull();
        expect(matchLineLink(line, line)).toBeNull(); // 点到行本身（整行文字）不该命中
        expect(matchLineLink('没有链接的一行', '没有链接的一行')).toBeNull();
        expect(matchLineLink('', 'x')).toBeNull();
    });
});
