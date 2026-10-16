/**
 * `pure/ytdlp` 单测（#496）—— yt-dlp 的可执行名解析、参数组装、进度行解析、产物挑选与错误文案。
 * 参数形态取自 **2026-10-03 用真 yt-dlp 跑通**的那一次（stdout 逐行核对过），⛔ 不是照文档编的。
 */
import { describe, expect, it } from 'vitest';
import {
    buildYtDlpArgs,
    lastYtDlpErrorLine,
    parseYtDlpPercent,
    pickYtDlpOutput,
    sanitizeYtDlpExe,
    ytDlpFailureMessage,
    ytDlpNeedsShell,
    ytDlpNotFoundMessage,
    ytDlpNoOutputMessage,
    ytDlpStageLabel,
    ytdlpExeCandidates,
    YTDLP_AUDIO_FORMAT,
    YTDLP_FORMAT,
    YTDLP_NAME_MAX_CHARS,
} from 'pure/ytdlp';

describe('sanitizeYtDlpExe', () => {
    it('去首尾空白', () => {
        expect(sanitizeYtDlpExe('  C:\\tools\\yt-dlp.exe  ')).toBe('C:\\tools\\yt-dlp.exe');
    });
    it('剥掉「复制为路径」带上的成对引号', () => {
        expect(sanitizeYtDlpExe('"C:\\Program Files\\yt-dlp\\yt-dlp.exe"')).toBe(
            'C:\\Program Files\\yt-dlp\\yt-dlp.exe',
        );
        expect(sanitizeYtDlpExe("'/usr/local/bin/yt-dlp'")).toBe('/usr/local/bin/yt-dlp');
    });
    it('单边引号不动（不是成对，多半是用户手滑，保留原样更可诊断）', () => {
        expect(sanitizeYtDlpExe('"C:\\x.exe')).toBe('"C:\\x.exe');
    });
    it('空 / undefined ⇒ 空串', () => {
        expect(sanitizeYtDlpExe('   ')).toBe('');
        expect(sanitizeYtDlpExe(undefined)).toBe('');
    });
});

describe('ytdlpExeCandidates', () => {
    it('填了路径就只用它（⛔ 不再去猜 PATH 里的）', () => {
        expect(ytdlpExeCandidates('C:\\t\\yt-dlp.exe', 'win32')).toEqual(['C:\\t\\yt-dlp.exe']);
    });
    it('留空 + win32 ⇒ `.exe` → `.cmd` → 裸名（pip 装出来的只有 `.cmd`，实测）', () => {
        expect(ytdlpExeCandidates('', 'win32')).toEqual(['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp']);
    });
    it('留空 + 非 win32 ⇒ 只有裸名', () => {
        expect(ytdlpExeCandidates('', 'darwin')).toEqual(['yt-dlp']);
    });
    it('只有空白等同留空', () => {
        expect(ytdlpExeCandidates('   ', 'win32')).toEqual(['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp']);
    });
});

describe('ytDlpNeedsShell', () => {
    it('win32 的 `.cmd` / `.bat` 要走 shell（Node 直接 spawn 会抛 EINVAL）', () => {
        expect(ytDlpNeedsShell('yt-dlp.cmd', 'win32')).toBe(true);
        expect(ytDlpNeedsShell('C:\\Python314\\Scripts\\yt-dlp.cmd', 'win32')).toBe(true);
        expect(ytDlpNeedsShell('C:\\x\\YT-DLP.CMD', 'win32')).toBe(true);
        expect(ytDlpNeedsShell('C:\\x\\yt-dlp.bat', 'win32')).toBe(true);
    });
    it('`.exe` 与裸名**不走** shell（少一层 cmd 解析，参数不会被二次解释）', () => {
        expect(ytDlpNeedsShell('yt-dlp.exe', 'win32')).toBe(false);
        expect(ytDlpNeedsShell('yt-dlp', 'win32')).toBe(false);
        expect(ytDlpNeedsShell('C:\\t\\yt-dlp.exe', 'win32')).toBe(false);
    });
    it('非 win32 恒 false（哪怕名字是 .cmd）', () => {
        expect(ytDlpNeedsShell('yt-dlp.cmd', 'darwin')).toBe(false);
        expect(ytDlpNeedsShell('yt-dlp.cmd', 'linux')).toBe(false);
    });
});

describe('buildYtDlpArgs', () => {
    const args = buildYtDlpArgs({ url: 'https://www.bilibili.com/video/BV1a2ak69ELi' });

    it('顺序与取值逐项固定（url 恒在最后）', () => {
        expect(args).toEqual([
            '--no-warnings',
            '--newline',
            '--no-playlist',
            '--no-part',
            '-f',
            YTDLP_FORMAT,
            '-x',
            '--audio-format',
            YTDLP_AUDIO_FORMAT,
            '--trim-filenames',
            String(YTDLP_NAME_MAX_CHARS),
            'https://www.bilibili.com/video/BV1a2ak69ELi',
        ]);
    });

    it('⛔ 不带 `--print`（它会隐式 `--quiet`，把进度行一起吞掉）', () => {
        expect(args).not.toContain('--print');
    });

    it('🔴 不带 `-o`：输出目录改由调用方的 `cwd` 定（临时目录 + 扫目录认产物）', () => {
        expect(args).not.toContain('-o');
    });

    it('🔴🔴 **参数里一个 `%` 都不许有** —— pip 形态的 yt-dlp 要经 cmd.exe 起，'
        + 'cmd 会把一对 `%` 之间的内容当变量展开（`%(title)s.%(ext)s` 会被吃掉、模板直接废掉）',
        () => {
            expect(args.every((a) => !a.includes('%'))).toBe(true);
        });

    it('url 去首尾空白', () => {
        const a = buildYtDlpArgs({ url: '  https://x/y  ' });
        expect(a[a.length - 1]).toBe('https://x/y');
    });
});

describe('parseYtDlpPercent', () => {
    it('取真输出的百分比（含 0.0 / 100.0 / 无小数的 100%）', () => {
        expect(parseYtDlpPercent('[download]   0.0% of    5.91MiB at  542.46KiB/s ETA 00:11')).toBe(0);
        expect(parseYtDlpPercent('[download]  33.8% of    5.91MiB at    3.02MiB/s ETA 00:01')).toBe(34);
        expect(parseYtDlpPercent('[download] 100.0% of    5.91MiB at    1.70MiB/s ETA 00:00')).toBe(100);
        expect(parseYtDlpPercent('[download] 100% of    5.91MiB in 00:00:02 at 2.70MiB/s')).toBe(100);
    });
    it('前导空白也认（进度行会带缩进）', () => {
        expect(parseYtDlpPercent('   [download]  12.1% of 1MiB')).toBe(12);
    });
    it('非进度行 / Destination 行 ⇒ null（⛔ 别把 5.91 当百分比）', () => {
        expect(parseYtDlpPercent('[download] Destination: out\\x.m4a')).toBeNull();
        expect(parseYtDlpPercent('[ExtractAudio] Destination: out\\x.mp3')).toBeNull();
        expect(parseYtDlpPercent('')).toBeNull();
    });
});

describe('ytDlpStageLabel', () => {
    it('下载开始 → 转 mp3 → 合并', () => {
        expect(ytDlpStageLabel('[download] Destination: d\\x.m4a')).toBe('正在从 B 站下载音频…');
        expect(ytDlpStageLabel('[ExtractAudio] Destination: d\\x.mp3')).toBe('正在转为 mp3…');
        expect(ytDlpStageLabel('[ffmpeg] Fixing malformed AAC bitstream')).toBe('正在转为 mp3…');
        expect(ytDlpStageLabel('[Merger] Merging formats')).toBe('正在合并音频流…');
    });
    it('认不出来 / 空行 ⇒ null（调用方保持上一句文案，⛔ 不刷成空串）', () => {
        expect(ytDlpStageLabel('[download]  12.1% of 1MiB')).toBeNull();
        expect(ytDlpStageLabel('Deleting original file x.m4a')).toBeNull();
        expect(ytDlpStageLabel('')).toBeNull();
    });
});

describe('pickYtDlpOutput', () => {
    it('优先 .mp3（`-x --audio-format mp3` 的正常产物）', () => {
        expect(pickYtDlpOutput(['a.m4a', 'a.mp3'])).toBe('a.mp3');
    });
    it('只有 m4a 时退回它（转码失败但原始流已下来时至少说清拿到了什么）', () => {
        expect(pickYtDlpOutput(['a.m4a'])).toBe('a.m4a');
    });
    it('白名单外的文件不算产物（.part / .webp / .json）', () => {
        expect(pickYtDlpOutput(['a.mp3.part', 'cover.webp', 'x.info.json'])).toBeNull();
        expect(pickYtDlpOutput(['a.m4a.part'])).toBeNull();
    });
    it('空目录 ⇒ null', () => {
        expect(pickYtDlpOutput([])).toBeNull();
    });
    it('结果与入参顺序无关（同一份产物在不同机器上选中同一个）', () => {
        expect(pickYtDlpOutput(['b.mp3', 'a.mp3'])).toBe('a.mp3');
        expect(pickYtDlpOutput(['a.mp3', 'b.mp3'])).toBe('a.mp3');
    });
});

describe('lastYtDlpErrorLine', () => {
    it('取最后一行非空内容并 trim', () => {
        expect(lastYtDlpErrorLine('line1\n\n  line2  \n')).toBe('line2');
    });
    it('超长截断到 200 字并加省略号', () => {
        const out = lastYtDlpErrorLine('x'.repeat(300));
        expect(out.length).toBe(201);
        expect(out.endsWith('…')).toBe(true);
    });
    it('空 ⇒ 空串', () => {
        expect(lastYtDlpErrorLine('')).toBe('');
    });
});

describe('ytDlpFailureMessage', () => {
    it('提到 ffmpeg ⇒ 直说装 ffmpeg（这是用户唯一能动手的事）', () => {
        const m = ytDlpFailureMessage({ code: 1, stderr: 'ERROR: Postprocessing: ffmpeg not found. Please install.' });
        expect(m).toContain('ffmpeg');
        expect(m).toContain('yt-dlp 同目录');
    });
    it('412 ⇒ 点名 B 站风控', () => {
        expect(ytDlpFailureMessage({ code: 1, stderr: 'ERROR: HTTP Error 412: Precondition Failed' })).toContain('412');
    });
    it('网络类错误 ⇒ 带出细节行', () => {
        const m = ytDlpFailureMessage({ code: 1, stderr: 'WARNING: x\nERROR: Unable to download webpage' });
        expect(m).toContain('网络或接口变更');
        expect(m).toContain('Unable to download webpage');
    });
    it('其它错误 ⇒ 带出最后一行', () => {
        expect(ytDlpFailureMessage({ code: 1, stderr: 'ERROR: Video unavailable' })).toBe(
            '下载失败：ERROR: Video unavailable',
        );
    });
    it('stderr 空 ⇒ 用退出码兜底（⛔ 不留一句光秃秃的「下载失败」）', () => {
        expect(ytDlpFailureMessage({ code: 2, stderr: '' })).toBe('下载失败（yt-dlp 退出码 2）');
        expect(ytDlpFailureMessage({ code: null, stderr: '' })).toContain('未知');
    });
    it('ffmpeg 优先于 412（两者同时出现时给可动手的那条）', () => {
        expect(ytDlpFailureMessage({ code: 1, stderr: 'HTTP Error 412\nffmpeg not found' })).toContain('ffmpeg');
    });
});

describe('缺失与无产物文案', () => {
    it('未找到 yt-dlp：把「去哪儿配」写出来', () => {
        const m = ytDlpNotFoundMessage('yt-dlp.exe');
        expect(m).toContain('yt-dlp.exe');
        expect(m).toContain('音乐源凭据');
    });
    it('无产物：说清「跑完了但没音频流」', () => {
        expect(ytDlpNoOutputMessage()).toContain('没有音频流');
    });
});
