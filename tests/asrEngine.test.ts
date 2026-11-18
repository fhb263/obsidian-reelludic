import { describe, expect, it } from 'vitest';
import {
    ASR_EXE_CANDIDATES_POSIX,
    ASR_EXE_CANDIDATES_WIN,
    ASR_SAMPLE_RATE,
    asrExeCandidates,
    asrModelMissingMessage,
    asrNotFoundMessage,
    asrSrtPathFor,
    asrStageLabel,
    asrWavPathFor,
    buildAsrArgs,
    buildExtractArgs,
    ffmpegExeCandidates,
    ffmpegNotFoundMessage,
    lastErrorLine,
    normalizeAsrLang,
    parseAsrPercent,
    parseAsrSegment,
    parseAsrSegmentEnd,
    parseFfmpegDuration,
    parseFfmpegOutTime,
    formatClock,
    segmentDetail,
    sanitizeExePath,
    withPercentLabel,
} from 'pure/asrEngine';

describe('sanitizeExePath', () => {
    it('去空白、剥掉首尾成对引号（资源管理器「复制为路径」带引号是常态）', () => {
        expect(sanitizeExePath('  "C:\\tools\\whisper-cli.exe"  ')).toBe('C:\\tools\\whisper-cli.exe');
        expect(sanitizeExePath("'/usr/bin/main'")).toBe('/usr/bin/main');
    });

    it('单边引号不剥（那是用户手滑，剥了反而变成另一个路径）', () => {
        expect(sanitizeExePath('"C:\\a.exe')).toBe('"C:\\a.exe');
    });

    it('空值 / undefined ⇒ 空串', () => {
        expect(sanitizeExePath(undefined)).toBe('');
        expect(sanitizeExePath('   ')).toBe('');
    });
});

describe('asrExeCandidates', () => {
    it('用户填了路径就只试那一个 —— 他明确指定了文件，退回候选名等于绕过配置', () => {
        expect(asrExeCandidates('"D:\\apps\\whisper-cli.exe"', 'win32')).toEqual(['D:\\apps\\whisper-cli.exe']);
    });

    it('留空时按平台给候选名（whisper.cpp 改过名：老版 main、新版 whisper-cli）', () => {
        expect(asrExeCandidates('', 'win32')).toEqual([...ASR_EXE_CANDIDATES_WIN]);
        expect(asrExeCandidates(undefined, 'linux')).toEqual([...ASR_EXE_CANDIDATES_POSIX]);
    });

    it('候选名都带 .exe（Windows）或不带（POSIX）', () => {
        for (const n of asrExeCandidates('', 'win32')) expect(n.endsWith('.exe')).toBe(true);
        for (const n of asrExeCandidates('', 'darwin')) expect(n.endsWith('.exe')).toBe(false);
    });
});

describe('ffmpegExeCandidates', () => {
    it('用户填了就用他填的，留空走平台候选', () => {
        expect(ffmpegExeCandidates('E:\\ff\\ffmpeg.exe', 'win32')).toEqual(['E:\\ff\\ffmpeg.exe']);
        expect(ffmpegExeCandidates('', 'win32')).toEqual(['ffmpeg.exe', 'ffmpeg']);
        expect(ffmpegExeCandidates('', 'linux')).toEqual(['ffmpeg']);
    });
});

describe('buildExtractArgs', () => {
    const args = buildExtractArgs('C:\\v\\a.mp4', 'C:\\v\\a.asr.wav');

    it('含 whisper.cpp 的硬要求：16kHz / 单声道 / pcm_s16le / 丢视频轨', () => {
        expect(args).toContain('-ar');
        expect(args[args.indexOf('-ar') + 1]).toBe(String(ASR_SAMPLE_RATE));
        expect(args[args.indexOf('-ac') + 1]).toBe('1');
        expect(args[args.indexOf('-c:a') + 1]).toBe('pcm_s16le');
        expect(args).toContain('-vn');
    });

    it('必须带 -y —— 否则同名 wav 已存在时子进程卡在覆盖询问上永不退出', () => {
        expect(args).toContain('-y');
    });

    it('输出路径在最后、输入在 -i 之后', () => {
        expect(args[args.length - 1]).toBe('C:\\v\\a.asr.wav');
        expect(args[args.indexOf('-i') + 1]).toBe('C:\\v\\a.mp4');
    });

    it('路径两端空白被去掉（用户粘贴常带尾空格）', () => {
        const a = buildExtractArgs('  C:\\v\\a.mp4  ', '  C:\\v\\a.asr.wav  ');
        expect(a).toContain('C:\\v\\a.mp4');
        expect(a[a.length - 1]).toBe('C:\\v\\a.asr.wav');
    });

    /**
     * 🔴 用户 m06361「怎么没有百分比进度条提示」的直接修复点：
     *    原来 `-loglevel error` 把 `Duration:` 也吞掉 ⇒ 没有分母，抽轨段只能画跑马灯。
     */
    it('必须让 ffmpeg 吐进度：-progress pipe:2 + -nostats，且 loglevel 不能是 error', () => {
        expect(args).toContain('-progress');
        expect(args[args.indexOf('-progress') + 1]).toBe('pipe:2');
        expect(args).toContain('-nostats');
        // ⛔ 退回 `error` 就再也拿不到 `Duration:`，百分比立刻失效
        expect(args[args.indexOf('-loglevel') + 1]).toBe('info');
    });
});

describe('parseFfmpegDuration', () => {
    it('认标准 Duration 行（含小数秒）', () => {
        expect(parseFfmpegDuration('  Duration: 00:00:13.82, bitrate: 256 kb/s')).toBeCloseTo(13.82, 2);
    });

    it('认小时级时长', () => {
        expect(parseFfmpegDuration('  Duration: 01:23:45.67, start: 0.000000')).toBeCloseTo(5025.67, 2);
    });

    it('不含 Duration / N/A ⇒ null（流式输入没有时长，⛔ 别拿 0 当分母）', () => {
        expect(parseFfmpegDuration('Duration: N/A, bitrate: N/A')).toBeNull();
        expect(parseFfmpegDuration('Stream #0:0: Audio: pcm_s16le')).toBeNull();
        expect(parseFfmpegDuration('')).toBeNull();
    });
});

describe('parseFfmpegOutTime', () => {
    it('out_time_us 按微秒换算成秒', () => {
        expect(parseFfmpegOutTime('out_time_us=13815563')).toBeCloseTo(13.815563, 5);
    });

    it('out_time_ms 也是微秒（ffmpeg 的历史命名错误）⇒ 同样除以 1e6', () => {
        expect(parseFfmpegOutTime('out_time_ms=13815563')).toBeCloseTo(13.815563, 5);
    });

    it('N/A 与无关行 ⇒ null', () => {
        expect(parseFfmpegOutTime('out_time_us=N/A')).toBeNull();
        expect(parseFfmpegOutTime('total_size=442176')).toBeNull();
        expect(parseFfmpegOutTime('progress=end')).toBeNull();
    });
});

describe('parseAsrSegmentEnd', () => {
    /**
     * 🔴 这是「平滑进度」的唯一来源：本机实测 `-pp` 的 progress 全程只打一次，
     *    而字幕行是每识别出一句就打一行。
     */
    it('取字幕行的结束时间（秒）', () => {
        expect(parseAsrSegmentEnd('[00:00:07.920 --> 00:00:14.320]   and the timestamps line up')).toBeCloseTo(14.32, 3);
    });

    it('认逗号小数（不同版本 / 分支见过两种写法）', () => {
        expect(parseAsrSegmentEnd('[00:00:01,000 --> 00:00:03,500] 你好')).toBeCloseTo(3.5, 3);
    });

    it('不是字幕行 ⇒ null（⛔ 别把日志里的方括号当时间轴）', () => {
        expect(parseAsrSegmentEnd('whisper_print_progress_callback: progress = 100%')).toBeNull();
        expect(parseAsrSegmentEnd('system_info: n_threads = 8')).toBeNull();
        expect(parseAsrSegmentEnd('')).toBeNull();
    });
});

describe('withPercentLabel', () => {
    it('把百分比拼进文案（用户要的是「看得见的数字」）', () => {
        expect(withPercentLabel('正在本地识别…', 45)).toBe('正在本地识别 45%');
        expect(withPercentLabel('正在提取音频…', 7)).toBe('正在提取音频 7%');
    });

    it('null ⇒ 只保留阶段文案，且去掉尾部省略号', () => {
        expect(withPercentLabel('正在加载识别模型…', null)).toBe('正在加载识别模型');
        expect(withPercentLabel('正在本地识别', null)).toBe('正在本地识别');
    });

    it('百分比夹到 0..100 且取整', () => {
        expect(withPercentLabel('识别', 128)).toBe('识别 100%');
        expect(withPercentLabel('识别', -3)).toBe('识别 0%');
        expect(withPercentLabel('识别', 45.6)).toBe('识别 46%');
    });
});

describe('parseAsrSegment / formatClock / segmentDetail', () => {
    it('抠出起止秒与正文（whisper 的 -pp 字幕行）', () => {
        const seg = parseAsrSegment('[00:00:07.920 --> 00:00:14.320]  hello world');
        expect(seg).not.toBeNull();
        expect(seg?.start).toBeCloseTo(7.92, 3);
        expect(seg?.end).toBeCloseTo(14.32, 3);
        expect(seg?.text).toBe('hello world');
    });

    it('正文为空也算有效行（⛔ 别因空文本把整行判废：时长信息本身就有用）', () => {
        const seg = parseAsrSegment('[00:00:01.000 --> 00:00:02.000]');
        expect(seg).not.toBeNull();
        expect(seg?.text).toBe('');
        expect(seg?.end).toBeCloseTo(2, 3);
    });

    it('不是时间轴行 ⇒ null', () => {
        expect(parseAsrSegment('whisper_print_progress_callback: progress = 100%')).toBeNull();
        expect(parseAsrSegment('')).toBeNull();
    });

    it('parseAsrSegmentEnd 与 parseAsrSegment 的 end 一致（旧签名不能漂）', () => {
        const line = '[00:01:02.500 --> 00:01:09.250] some text';
        expect(parseAsrSegmentEnd(line)).toBeCloseTo(parseAsrSegment(line)?.end ?? -1, 3);
    });

    it('formatClock：分秒、时分秒、坏值收敛成 0:00', () => {
        expect(formatClock(0)).toBe('0:00');
        expect(formatClock(75)).toBe('1:15');
        expect(formatClock(3725)).toBe('1:02:05');
        expect(formatClock(-1)).toBe('0:00');
        expect(formatClock(Number.NaN)).toBe('0:00');
    });

    it('segmentDetail：无总长时只给起止，有总长时补 /总长', () => {
        const seg = { start: 12, end: 19, text: '' };
        expect(segmentDetail(seg)).toBe('0:12 → 0:19');
        expect(segmentDetail(seg, 220)).toBe('0:12 → 0:19 / 3:40');
        expect(segmentDetail(seg, 0)).toBe('0:12 → 0:19');
    });

    it('segmentDetail ⛔ 不带句子正文（会把浮球 tooltip / 横幅撑爆）', () => {
        const seg = { start: 0, end: 4, text: '这是一句很长的正文，不应该出现在细节行里' };
        expect(segmentDetail(seg, 100)).toBe('0:00 → 0:04 / 1:40');
    });
});

describe('normalizeAsrLang', () => {
    it('auto 原样；2..3 位语言码放行', () => {
        expect(normalizeAsrLang('auto')).toBe('auto');
        expect(normalizeAsrLang('zh')).toBe('zh');
        expect(normalizeAsrLang('YUE')).toBe('yue');
    });

    it('其余一律回落 auto（⛔ 不把非法值透传给子进程）', () => {
        expect(normalizeAsrLang('chinese')).toBe('auto');
        expect(normalizeAsrLang('')).toBe('auto');
        expect(normalizeAsrLang(undefined)).toBe('auto');
        expect(normalizeAsrLang('z')).toBe('auto');
        expect(normalizeAsrLang('zh-CN')).toBe('auto');
    });
});

describe('buildAsrArgs', () => {
    const base = { model: 'C:\\m\\ggml-base.bin', wav: 'C:\\v\\a.asr.wav', outBase: 'C:\\v\\a' };

    it('带 -osrt 让 whisper.cpp 自己写 SRT（我们不拼字幕文本）', () => {
        expect(buildAsrArgs(base)).toContain('-osrt');
    });

    it('-of 给的是不带扩展名的基名', () => {
        const a = buildAsrArgs(base);
        expect(a[a.indexOf('-of') + 1]).toBe('C:\\v\\a');
    });

    it('必须带 -pp —— 否则 stderr 全程安静，进度球永远停在 0%', () => {
        expect(buildAsrArgs(base)).toContain('-pp');
    });

    it('语言：给了就写、没给写 auto、非法回落 auto', () => {
        expect(buildAsrArgs({ ...base, lang: 'zh' })[buildAsrArgs({ ...base, lang: 'zh' }).indexOf('-l') + 1]).toBe('zh');
        expect(buildAsrArgs(base).slice(-1)).toEqual(['auto']);
        const bad = buildAsrArgs({ ...base, lang: 'chinese' });
        expect(bad[bad.indexOf('-l') + 1]).toBe('auto');
    });

    it('线程数只在合法正整数时追加，且夹到 64 以内', () => {
        expect(buildAsrArgs(base)).not.toContain('-t');
        expect(buildAsrArgs({ ...base, threads: 0 })).not.toContain('-t');
        expect(buildAsrArgs({ ...base, threads: Number.NaN })).not.toContain('-t');
        const many = buildAsrArgs({ ...base, threads: 999 });
        expect(many[many.indexOf('-t') + 1]).toBe('64');
    });
});

describe('parseAsrPercent', () => {
    it('认真实出现的三种写法', () => {
        expect(parseAsrPercent('whisper_print_progress_callback: progress = 12%')).toBe(12);
        expect(parseAsrPercent('progress =  7%')).toBe(7);
        expect(parseAsrPercent('PROGRESS = 100 %')).toBe(100);
    });

    it('没有 progress 字样的一律不认（防把片段文本里的百分比抓进来）', () => {
        expect(parseAsrPercent('[00:00:01.000 --> 00:00:03.000]  这次提升 50%')).toBeNull();
        expect(parseAsrPercent('model = C:\\m\\ggml-50%.bin')).toBeNull();
        expect(parseAsrPercent('')).toBeNull();
    });

    it('越界夹到 0..100', () => {
        expect(parseAsrPercent('progress = 0%')).toBe(0);
        expect(parseAsrPercent('progress = 999%')).toBe(100);
    });
});

describe('asrStageLabel', () => {
    it('认加载模型 / 准备环境 / 逐句识别三段', () => {
        expect(asrStageLabel('whisper_init_from_file_with_params: loading model')).toBe('正在加载识别模型…');
        expect(asrStageLabel('system_info: n_threads = 8')).toBe('正在准备识别环境…');
        expect(asrStageLabel('[00:00:01.000 --> 00:00:03.000] 你好')).toBe('正在逐句识别…');
    });

    it('进度行不当作阶段文案（那是 parseAsrPercent 的活）', () => {
        expect(asrStageLabel('progress = 42%')).toBeNull();
    });

    it('错误行不当作阶段文案（错误由调用方从 stderr 尾部整段取）', () => {
        expect(asrStageLabel('error: failed to load model')).toBeNull();
    });

    it('认不出来 ⇒ null（调用方保持上一句，⛔ 不刷成空串）', () => {
        expect(asrStageLabel('')).toBeNull();
        expect(asrStageLabel('  ')).toBeNull();
        expect(asrStageLabel('some random chatter')).toBeNull();
    });
});

describe('asrWavPathFor / asrSrtPathFor', () => {
    it('与视频同目录同基名，wav 带 .asr 标记（⛔ 不覆盖用户自己的同名 wav）', () => {
        expect(asrWavPathFor('C:\\v\\a.mp4')).toBe('C:\\v\\a.asr.wav');
        expect(asrWavPathFor('/v/a.mkv')).toBe('/v/a.asr.wav');
    });

    it('srt 就在视频同目录 —— 用户不用选存哪儿', () => {
        expect(asrSrtPathFor('C:\\v\\a.mp4')).toBe('C:\\v\\a.srt');
        expect(asrSrtPathFor('/v/a.mkv')).toBe('/v/a.srt');
    });

    it('目录里的点不算扩展名（只认最后一段里的点）', () => {
        expect(asrSrtPathFor('C:\\my.videos\\a.mp4')).toBe('C:\\my.videos\\a.srt');
        expect(asrSrtPathFor('/home/a.b/c')).toBe('/home/a.b/c.srt');
    });

    it('空路径 ⇒ 空串（⛔ 不返回到处都是的相对路径）', () => {
        expect(asrWavPathFor('')).toBe('');
        expect(asrSrtPathFor('   ')).toBe('');
    });
});

describe('lastErrorLine', () => {
    it('取最后一行非空（whisper.cpp / ffmpeg 都把真错放最后）', () => {
        const stderr = 'loading model\nsystem_info: x\n\n  error: failed to load model  \n\n';
        expect(lastErrorLine(stderr, '兜底')).toBe('error: failed to load model');
    });

    it('全是空行 / 空串 ⇒ 兜底文案', () => {
        expect(lastErrorLine('', '兜底')).toBe('兜底');
        expect(lastErrorLine('  \n\n ', '兜底')).toBe('兜底');
    });

    it('超长行截断到 300 字符（更长的多半是刷屏日志，塞进 Notice 会糊满屏）', () => {
        const long = 'x'.repeat(500);
        const got = lastErrorLine(long, '兜底');
        expect(got.length).toBe(301); // 300 + 省略号
        expect(got.endsWith('…')).toBe(true);
    });
});

describe('三条引导文案', () => {
    it('缺 whisper 的文案必须说清「缺什么 / 去哪装 / 装完填路径」', () => {
        const msg = asrNotFoundMessage('whisper-cli.exe');
        expect(msg).toContain('whisper-cli.exe');
        expect(msg).toContain('whisper.cpp');
        expect(msg).toContain('设置');
        expect(msg).toContain('引号');
    });

    it('缺 ffmpeg 的文案要点明「抽音轨是前置」', () => {
        const msg = ffmpegNotFoundMessage();
        expect(msg).toContain('ffmpeg');
        expect(msg).toContain('16kHz');
    });

    it('缺模型的文案要点明需要一个 ggml 模型', () => {
        const msg = asrModelMissingMessage();
        expect(msg).toContain('.bin');
        expect(msg).toContain('ggml');
    });
});
