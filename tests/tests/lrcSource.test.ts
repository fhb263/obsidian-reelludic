// 歌词源解析与优先级测试（2026-09-27 ④-2）。
//
// 为什么值得单测：` ```lrc ` 块是 ReelLudic 与 LyricFlux（及将被并入的内置播放器）之间的**唯一接口**，
// 而「歌词到底从哪来」有四条可能的路（`lyrics` 指令指向的文件 / 块内正文 / 同名 `.lrc` / 音频内嵌标签）。
// 优先级搞错的观感是「我在笔记里改了歌词，播放器还是唱旧的」——极难自查。
// 另：`source` / `lyrics` 里那个参数到底是 wiki 链接还是库外绝对路径，LyricFlux 在**四处**各写了一份判断
// （`LyricsMarkdownRender.ts` 的 106 / 494 / 542 / 553 行），本模块把它收敛成一处真源。
import { describe, it, expect } from 'vitest';
import {
    extractLrcBlock,
    lrcBlockLyrics,
    parseLrcBlock,
    pickLyrics,
    siblingLrcPath,
    parseLrcRef,
    formatLrcSourceDirective,
    withLrcLyrics,
} from 'pure/lrcSource';

describe('extractLrcBlock（从笔记正文里取 ` ```lrc ` 块）', () => {
    it('取到块内正文（⛔ 不含围栏行）', () => {
        const note = [
            '### 播放器',
            '',
            '```lrc',
            'source [[a/夜曲.mp3]]',
            '[00:01.00]第一句',
            '```',
            '',
            '## 个人评语',
        ].join('\n');
        expect(extractLrcBlock(note)).toBe('source [[a/夜曲.mp3]]\n[00:01.00]第一句');
    });

    it('围栏大小写不敏感、允许缩进（手写的笔记不一定规整）', () => {
        expect(extractLrcBlock('  ```LRC\n[00:01.00]x\n  ```')).toBe('[00:01.00]x');
    });

    it('🔴 4 个反引号的围栏里含 3 个反引号 ⇒ 不被提前截断（CommonMark 口径）', () => {
        const note = '````lrc\nsource [[a.mp3]]\n```\n[00:01.00]x\n````';
        expect(extractLrcBlock(note)).toBe('source [[a.mp3]]\n```\n[00:01.00]x');
    });

    it('只认 `lrc` 这一个信息串：`lrc2` / `lrc 注释` 都不算', () => {
        // 若实现写成 /^\s*`{3,}\s*lrc/ （不锚行尾），下面两块都会被误吃
        expect(extractLrcBlock('```lrc2\nnot lyrics\n```')).toBeNull();
        expect(extractLrcBlock('```lrc 这是别的语言\nx\n```')).toBeNull();
    });

    it('未闭合 / 没有块 ⇒ null（⛔ 别把后续整篇笔记当歌词）', () => {
        expect(extractLrcBlock('```lrc\nsource [[a.mp3]]\n没有闭合')).toBeNull();
        expect(extractLrcBlock('## 只有正文\n没有代码块')).toBeNull();
        expect(extractLrcBlock('')).toBeNull();
    });

    it('多个块 ⇒ 取第一块（noteGenerator 只会生成一块）', () => {
        expect(extractLrcBlock('```lrc\nA\n```\n\n```lrc\nB\n```')).toBe('A');
    });

    it('`~~~lrc`（另一种围栏）不认 —— 生成侧只用反引号', () => {
        expect(extractLrcBlock('~~~lrc\nA\n~~~')).toBeNull();
    });

    it('CRLF 归一：Windows 写的笔记也取得到（且正文不含 \\r）', () => {
        expect(extractLrcBlock('```lrc\r\n[00:01.00]x\r\n```')).toBe('[00:01.00]x');
    });
});

describe('parseLrcBlock（` ```lrc ` 块的指令区）', () => {
    it('只有 `source [[x]]` 时：取到音频、正文为空（ReelLudic 生成的就是这一形态）', () => {
        const d = parseLrcBlock('source [[ReelLudic/music/夜曲.mp3]]');
        expect(d.audio).toBe('[[ReelLudic/music/夜曲.mp3]]');
        expect(d.inline).toBe('');
        expect(d.embedded).toBe(false);
    });

    it('`source` 与 `lyrics` 两行都在，且**顺序无关**', () => {
        expect(parseLrcBlock('source [[a.mp3]]\nlyrics [[a.lrc]]')).toMatchObject({
            audio: '[[a.mp3]]',
            lyrics: '[[a.lrc]]',
        });
        expect(parseLrcBlock('lyrics [[a.lrc]]\nsource [[a.mp3]]')).toMatchObject({
            audio: '[[a.mp3]]',
            lyrics: '[[a.lrc]]',
        });
    });

    it('指令名大小写不敏感（`SOURCE` / `Source`）', () => {
        expect(parseLrcBlock('SOURCE [[a.mp3]]').audio).toBe('[[a.mp3]]');
        expect(parseLrcBlock('Source C:\\m\\a.mp3').audio).toBe('C:\\m\\a.mp3');
        expect(parseLrcBlock('Lyrics [[a.lrc]]').lyrics).toBe('[[a.lrc]]');
    });

    it('遗留 `embedded-lyrics` 指令被识别（LyricFlux 已不依赖它，仅为兼容旧笔记）', () => {
        const d = parseLrcBlock('source [[a.mp3]]\nembedded-lyrics');
        expect(d.embedded).toBe(true);
        expect(d.audio).toBe('[[a.mp3]]');
    });

    it('指令区之后的正文 = 内联歌词', () => {
        const d = parseLrcBlock('source [[a.mp3]]\n[00:01.00]第一句\n[00:05.00]第二句\n');
        expect(d.inline).toBe('[00:01.00]第一句\n[00:05.00]第二句');
    });

    it('🔴 遇到第一条非指令行即**停止扫描**（后面的 `source` 不再生效 —— 与 LyricFlux 同口径）', () => {
        const d = parseLrcBlock('[00:01.00]正文\nsource [[later.mp3]]');
        expect(d.audio).toBeUndefined();
        expect(d.inline).toBe('[00:01.00]正文\nsource [[later.mp3]]');
    });

    it('🔴 同一指令出现两次 ⇒ **最后一次生效**（LyricFlux 是逐行覆盖；⛔ 别改成「第一次优先」）', () => {
        expect(parseLrcBlock('source [[old.mp3]]\nsource [[new.mp3]]').audio).toBe('[[new.mp3]]');
        expect(parseLrcBlock('lyrics [[old.lrc]]\nlyrics [[new.lrc]]').lyrics).toBe('[[new.lrc]]');
    });

    it('CRLF 与空内容都不炸', () => {
        expect(parseLrcBlock('source [[a.mp3]]\r\n[00:01.00]x\r\n').audio).toBe('[[a.mp3]]');
        expect(parseLrcBlock('')).toEqual({ embedded: false, inline: '' });
    });

    it('反向守卫：⛔ 不是指令的相似行不得被误认（`source` 后必须有空格；`# source x` 是普通正文）', () => {
        expect(parseLrcBlock('source').audio).toBeUndefined();
        expect(parseLrcBlock('sourcebook [[a.mp3]]').audio).toBeUndefined();
        const withHash = parseLrcBlock('# source [[a.mp3]]');
        expect(withHash.audio).toBeUndefined();
        expect(withHash.inline).toBe('# source [[a.mp3]]');
    });
});

describe('pickLyrics（四路歌词源的优先级）', () => {
    it('只给内嵌 ⇒ 取内嵌', () => {
        expect(pickLyrics({ embedded: 'E' })).toEqual({ text: 'E', origin: 'embedded' });
    });

    it('只给同名 `.lrc` ⇒ 取同名文件', () => {
        expect(pickLyrics({ sibling: 'S' })).toEqual({ text: 'S', origin: 'sibling' });
    });

    it('🔴 优先级：`lyrics` 指令 > 块内正文 > 同名 `.lrc` > 音频内嵌', () => {
        const all = { directiveFile: 'D', inline: 'I', sibling: 'S', embedded: 'E' };
        expect(pickLyrics(all)?.origin).toBe('directive-file');
        expect(pickLyrics({ inline: 'I', sibling: 'S', embedded: 'E' })?.origin).toBe('inline');
        expect(pickLyrics({ sibling: 'S', embedded: 'E' })?.origin).toBe('sibling');
        expect(pickLyrics({ embedded: 'E' })?.origin).toBe('embedded');
    });

    it('🔴 四路全空（或只有空白）⇒ null（⛔ 不要拿空串去 parse，会得到 0 行歌词且静默）', () => {
        expect(pickLyrics({})).toBeNull();
        expect(pickLyrics({ directiveFile: '', inline: '   \n  ', sibling: '', embedded: '' })).toBeNull();
    });

    it('🔴 上一档是空白 ⇒ 落到下一档（笔记里只有 `source` 行时 `inline` 是空串，不能挡住同名 `.lrc`）', () => {
        expect(pickLyrics({ inline: '', sibling: 'S' })?.origin).toBe('sibling');
        expect(pickLyrics({ directiveFile: '  ', inline: 'I' })?.origin).toBe('inline');
    });
});

describe('siblingLrcPath（同名 `.lrc` 配对）', () => {
    it('库内相对路径：只换扩展名，目录不动', () => {
        expect(siblingLrcPath('ReelLudic/music/夜曲.mp3')).toBe('ReelLudic/music/夜曲.lrc');
    });

    it('库外绝对路径（反斜杠 / 正斜杠）都保留原分隔符风格', () => {
        expect(siblingLrcPath('C:\\Music\\夜曲.mp3')).toBe('C:\\Music\\夜曲.lrc');
        expect(siblingLrcPath('C:/Music/夜曲.mp3')).toBe('C:/Music/夜曲.lrc');
    });

    it('没有目录段 / 没有扩展名也能配', () => {
        expect(siblingLrcPath('夜曲.mp3')).toBe('夜曲.lrc');
        expect(siblingLrcPath('ReelLudic/music/夜曲')).toBe('ReelLudic/music/夜曲.lrc');
    });

    it('🔴 大写扩展名与多点文件名：替换**最后一个**点之后的段（⛔ 不要产出 `夜曲.MP3.lrc` / `a.lrc`）', () => {
        expect(siblingLrcPath('m/夜曲.MP3')).toBe('m/夜曲.lrc');
        expect(siblingLrcPath('m/a.b.mp3')).toBe('m/a.b.lrc');
    });

    it('🔴 幂等：本身就是 `.lrc` ⇒ 返回自己', () => {
        expect(siblingLrcPath('m/夜曲.lrc')).toBe('m/夜曲.lrc');
    });

    it('🔴 目录名里的点不能当扩展名（`m/1.0/夜曲` ⇒ 补 `.lrc`，⛔ 不是 `m/1.lrc`）', () => {
        expect(siblingLrcPath('m/1.0/夜曲')).toBe('m/1.0/夜曲.lrc');
        expect(siblingLrcPath('m/1.0/夜曲.mp3')).toBe('m/1.0/夜曲.lrc');
    });

    it('空值 / 只有空白 ⇒ null', () => {
        expect(siblingLrcPath('')).toBeNull();
        expect(siblingLrcPath('   ')).toBeNull();
    });
});

describe('parseLrcRef（`source` / `lyrics` 参数到底是三种引用里的哪一种）', () => {
    it('wiki 链接 ⇒ kind=wiki，取出里面的路径', () => {
        expect(parseLrcRef('[[ReelLudic/music/夜曲.mp3]]')).toEqual({ kind: 'wiki', value: 'ReelLudic/music/夜曲.mp3' });
    });

    it('🔴 wiki 链接带显示别名（`[[路径|显示名]]`）⇒ 只取路径（LyricFlux 会把别名一起当路径，找不到文件）', () => {
        expect(parseLrcRef('[[ReelLudic/music/夜曲.mp3|夜曲]]')).toEqual({
            kind: 'wiki',
            value: 'ReelLudic/music/夜曲.mp3',
        });
    });

    it('库外绝对路径：盘符（两种斜杠）/ UNC（两种斜杠）/ POSIX 根', () => {
        expect(parseLrcRef('C:\\Music\\夜曲.mp3')?.kind).toBe('absolute');
        expect(parseLrcRef('D:/Music/夜曲.mp3')?.kind).toBe('absolute');
        // 🔴 UNC 两种写法都必须判成 absolute，但走的是**两条**分支：反斜杠形态走 ABS_UNC，
        //    正斜杠形态走 `startsWith('/')`（那条同时管 POSIX 根）。⛔ 别把后者当多余分支删掉
        //    —— 删了 `//nas/…` 会被判成库内相对、包成 `source [[//nas/…]]`，笔记里就是一条断链。
        expect(parseLrcRef('\\\\nas\\share\\夜曲.mp3')?.kind).toBe('absolute');
        expect(parseLrcRef('//nas/share/夜曲.mp3')?.kind).toBe('absolute');
        expect(parseLrcRef('/Users/x/夜曲.mp3')?.kind).toBe('absolute');
    });

    it('其余 ⇒ kind=vault（库内相对路径，交给 vault API 取）', () => {
        expect(parseLrcRef('ReelLudic/music/夜曲.mp3')).toEqual({ kind: 'vault', value: 'ReelLudic/music/夜曲.mp3' });
        expect(parseLrcRef('./夜曲.mp3')?.kind).toBe('vault');
    });

    it('空值 / 只有空白 / 空 wiki ⇒ null', () => {
        expect(parseLrcRef('')).toBeNull();
        expect(parseLrcRef('   ')).toBeNull();
        expect(parseLrcRef('[[]]')).toBeNull();
        expect(parseLrcRef('[[|别名]]')).toBeNull();
    });
});

describe('formatLrcSourceDirective（写笔记时的 `source` 行）', () => {
    it('库内相对 ⇒ `source [[…]]`；库外绝对 ⇒ `source …`', () => {
        expect(formatLrcSourceDirective('ReelLudic/music/夜曲.mp3')).toBe('source [[ReelLudic/music/夜曲.mp3]]');
        expect(formatLrcSourceDirective('C:\\Music\\夜曲.mp3')).toBe('source C:\\Music\\夜曲.mp3');
        expect(formatLrcSourceDirective('/Users/x/夜曲.mp3')).toBe('source /Users/x/夜曲.mp3');
    });

    it('空值 ⇒ 空串（调用方据此决定不写这一行）', () => {
        expect(formatLrcSourceDirective('')).toBe('');
        expect(formatLrcSourceDirective('   ')).toBe('');
    });

    it('🔴 往返一致（防「生成」与「消费」两套规则各走各的）：值必须原样回来，且包装形态与种类**按映射对应**'
        + '（库内相对 → 包 `[[ ]]` ⇒ 解析成 kind=wiki；库外绝对 → 裸写 ⇒ 解析成 kind=absolute）', () => {
        for (const p of ['ReelLudic/music/夜曲.mp3', 'C:\\Music\\夜曲.mp3', 'D:/M/a.mp3', '/Users/x/a.mp3', '\\\\nas\\s\\a.mp3', '//nas/s/a.mp3']) {
            const kind = parseLrcRef(p)?.kind;
            const line = formatLrcSourceDirective(p);
            const param = line.slice('source '.length);
            const parsed = parseLrcRef(param);
            if (kind === 'absolute') {
                expect(line).toBe(`source ${p}`);
                expect(parsed).toEqual({ kind: 'absolute', value: p });
            } else {
                expect(line).toBe(`source [[${p}]]`);
                // 包进 wiki 之后解析出来自然是 wiki —— 关键是**值**没被改动
                expect(parsed).toEqual({ kind: 'wiki', value: p });
            }
            expect(parseLrcBlock(line).audio).toBe(param);
        }
    });

    it('已是 wiki 引用形态 ⇒ 规整成 `source [[路径]]`（去掉别名）', () => {
        expect(formatLrcSourceDirective('[[a/b.mp3]]')).toBe('source [[a/b.mp3]]');
        expect(formatLrcSourceDirective('[[a/b.mp3|显示名]]')).toBe('source [[a/b.mp3]]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 块内歌词的「读 / 写」一对（#396）：条目表单的 LRC 框与 `EntryService.writeNote` 的保留区
// 都靠这两个函数。🔴 最要紧的是**往返闭合**：写进去的必须能原样读出来，读出来的必须能原样写回去。
// ─────────────────────────────────────────────────────────────────────────────
describe('lrcBlockLyrics（取块内歌词正文）', () => {
    const NOTE = [
        '### 播放器',
        '',
        '```lrc',
        'source [[ReelLudic/music/夜曲.mp3]]',
        '',
        '[00:01.00]一群嗜血的蚂蚁',
        '[00:05.00]被腐肉所吸引',
        '```',
        '',
        '## 个人评语',
    ].join('\n');

    it('指令行**不算**歌词正文（它们由 `audioPath` 生成，不是用户内容）', () => {
        expect(lrcBlockLyrics(NOTE)).toBe('[00:01.00]一群嗜血的蚂蚁\n[00:05.00]被腐肉所吸引');
    });

    it('只有指令行 ⇒ 空串（不是 null：调用方要的是「框里显示什么」）', () => {
        expect(lrcBlockLyrics('```lrc\nsource [[a.mp3]]\n```')).toBe('');
    });

    it('无块 / 未闭合 / 空文档 ⇒ 空串', () => {
        expect(lrcBlockLyrics('## 个人评语\n随便写点')).toBe('');
        expect(lrcBlockLyrics('```lrc\n[00:01.00]没闭合')).toBe('');
        expect(lrcBlockLyrics('')).toBe('');
    });

    it('多条指令 + `lyrics` 指令也能正确切分（指令区以第一条非指令行结束）', () => {
        const note = '```lrc\nsource [[a.mp3]]\nlyrics [[a.lrc]]\n[00:01.00]x\n```';
        expect(lrcBlockLyrics(note)).toBe('[00:01.00]x');
    });
});

describe('withLrcLyrics（把歌词正文写回块内）', () => {
    const TEMPLATE = ['# 夜曲', '', '## 简介', '', '```lrc', 'source [[ReelLudic/music/夜曲.mp3]]', '```', '', '## 个人评语', ''].join('\n');

    it('指令行保留 + 歌词正文写进块内（空行分隔）', () => {
        const out = withLrcLyrics(TEMPLATE, '[00:01.00]a\n[00:05.00]b');
        expect(out).toContain('```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n\n[00:01.00]a\n[00:05.00]b\n```');
        // 块外内容一字不动
        expect(out.startsWith('# 夜曲\n\n## 简介\n\n')).toBe(true);
        expect(out.endsWith('\n\n## 个人评语\n')).toBe(true);
    });

    it('🔴 往返闭合：写进去的能原样读出来；读出来的能原样写回去', () => {
        const text = '[00:01.00]第一句\n[00:05.00]第二句';
        const written = withLrcLyrics(TEMPLATE, text);
        expect(lrcBlockLyrics(written)).toBe(text);
        expect(withLrcLyrics(written, lrcBlockLyrics(written))).toBe(written);
    });

    it('🔴 空歌词 ⇒ 只留指令行（这就是「清空歌词框」能生效的实现，⛔ 不是 no-op）', () => {
        const withLy = withLrcLyrics(TEMPLATE, '[00:01.00]a');
        expect(withLrcLyrics(withLy, '')).toContain('```lrc\nsource [[ReelLudic/music/夜曲.mp3]]\n```');
        expect(lrcBlockLyrics(withLrcLyrics(withLy, '   \n  '))).toBe('');
    });

    it('🔴 正文是**整段替换**不是追加（歌词的主人只有一个）', () => {
        const one = withLrcLyrics(TEMPLATE, '[00:01.00]旧歌词');
        const two = withLrcLyrics(one, '[00:09.00]新歌词');
        expect(lrcBlockLyrics(two)).toBe('[00:09.00]新歌词');
        expect(two).not.toContain('旧歌词');
    });

    it('无变化 ⇒ 原样返回同一串（调用方据此跳过写盘，别每次保存都白写一遍）', () => {
        const withLy = withLrcLyrics(TEMPLATE, '[00:01.00]a');
        expect(withLrcLyrics(withLy, '[00:01.00]a')).toBe(withLy);
        expect(withLrcLyrics(TEMPLATE, '')).toBe(TEMPLATE);
    });

    it('无块 / 未闭合 ⇒ 原样返回（⛔ 不许凭空造一个块出来）', () => {
        const noBlock = '# 书\n\n## 个人评语\n\n内容\n';
        expect(withLrcLyrics(noBlock, '[00:01.00]a')).toBe(noBlock);
        const broken = '```lrc\nsource [[a.mp3]]\n';
        expect(withLrcLyrics(broken, '[00:01.00]a')).toBe(broken);
    });

    it('多指令行全部保留（`source` + `lyrics` 都不丢）', () => {
        const t = '```lrc\nsource [[a.mp3]]\nlyrics [[a.lrc]]\n```';
        const out = withLrcLyrics(t, '[00:01.00]x');
        expect(out).toBe('```lrc\nsource [[a.mp3]]\nlyrics [[a.lrc]]\n\n[00:01.00]x\n```');
    });

    it('CRLF 文档也能改（笔记可能是 Windows 行尾）', () => {
        const crlf = '```lrc\r\nsource [[a.mp3]]\r\n```\r\n';
        expect(lrcBlockLyrics(withLrcLyrics(crlf, '[00:01.00]x'))).toBe('[00:01.00]x');
    });
});
