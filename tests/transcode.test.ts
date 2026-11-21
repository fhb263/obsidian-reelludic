import { describe, expect, it } from 'vitest';
import {
    audioCodecPlayableIn,
    buildProbeArgs,
    buildRemuxArgs,
    buildTranscodeArgs,
    containerIsPlayable,
    downscaleFilter,
    encoderQualityArgs,
    H264_ENCODER_FALLBACK,
    isTranscodableSource,
    parseFfmpegProbe,
    planTranscode,
    transcodeFileName,
    transcodePercent,
    type VideoProbe,
} from 'pure/transcode';

const probe = (p: Partial<VideoProbe> = {}): VideoProbe => ({
    videoCodec: '',
    audioCodec: '',
    duration: 0,
    width: 0,
    height: 0,
    ...p,
});

describe('parseFfmpegProbe', () => {
    const REAL = `ffmpeg version 8.1.2 Copyright (c) 2000-2025 the FFmpeg developers
  Duration: 00:23:45.67, start: 0.000000, bitrate: 2345 kb/s
  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv), 3840x2160 [SAR 1:1 DAR 16:9], 23.98 fps
  Stream #0:1(jpn): Audio: flac, 48000 Hz, stereo, s16`;

    it('抠出视频/音频编码、分辨率、时长', () => {
        const p = parseFfmpegProbe(REAL);
        expect(p.videoCodec).toBe('hevc');
        expect(p.audioCodec).toBe('flac');
        expect(p.width).toBe(3840);
        expect(p.height).toBe(2160);
        // 23 分 45.67 秒
        expect(p.duration).toBeCloseTo(23 * 60 + 45.67, 2);
    });

    it('编码名兜底小写', () => {
        expect(parseFfmpegProbe('Stream #0:0: Video: H264 (High)').videoCodec).toBe('h264');
    });

    it('没有音轨 ⇒ audioCodec 空串，不算失败', () => {
        const p = parseFfmpegProbe('Stream #0:0: Video: h264 (High), yuv420p, 1920x1080');
        expect(p.audioCodec).toBe('');
        expect(p.videoCodec).toBe('h264');
    });

    it('认不出任何东西 ⇒ 全空，不抛', () => {
        expect(parseFfmpegProbe('')).toEqual(probe());
        expect(parseFfmpegProbe('随便一行中文')).toEqual(probe());
        expect(parseFfmpegProbe(null as unknown as string)).toEqual(probe());
    });
});

describe('planTranscode（判定的核心：容器能播 ≠ 编码能播）', () => {
    it('mp4 + h264 + aac ⇒ 不动文件（none）', () => {
        expect(planTranscode(probe({ videoCodec: 'h264', audioCodec: 'aac' }), 'mp4')).toBe('none');
    });

    it('webm + vp9 + opus ⇒ none（🔴 音频白名单按容器分，别误判要转）', () => {
        expect(planTranscode(probe({ videoCodec: 'vp9', audioCodec: 'opus' }), 'webm')).toBe('none');
    });

    it('mkv + vp9 + opus ⇒ remux（同编码同音频，只因容器换壳；音频在 mp4 里也不重编）', () => {
        expect(planTranscode(probe({ videoCodec: 'vp9', audioCodec: 'opus' }), 'mkv')).toBe('remux');
    });

    it('🔴 mkv + h264 + aac ⇒ 只换壳（remux），绝不重编码', () => {
        expect(planTranscode(probe({ videoCodec: 'h264', audioCodec: 'aac' }), 'mkv')).toBe('remux');
    });

    it('🔴 mp4 + hevc ⇒ 必须重编码（黑屏的典型）', () => {
        expect(planTranscode(probe({ videoCodec: 'hevc', audioCodec: 'aac' }), 'mp4')).toBe('transcode');
    });

    it('h264 + ac3 ⇒ 仍是 remux（只重编音频，不是整条重来）', () => {
        expect(planTranscode(probe({ videoCodec: 'h264', audioCodec: 'ac3' }), 'mkv')).toBe('remux');
    });

    it('探不到视频编码 ⇒ transcode（比盲 remux 安全）', () => {
        expect(planTranscode(probe(), 'mkv')).toBe('transcode');
    });

    it('forceTranscode 压过一切', () => {
        expect(planTranscode(probe({ videoCodec: 'h264', audioCodec: 'aac' }), 'mp4', { forceTranscode: true })).toBe('transcode');
    });

    it('avi + mpeg4 ⇒ transcode', () => {
        expect(planTranscode(probe({ videoCodec: 'mpeg4', audioCodec: 'mp3' }), 'avi')).toBe('transcode');
    });
});

describe('audioCodecPlayableIn（🔴 按容器分名单）', () => {
    it('空编码 = 无音轨 = 天然能播', () => {
        expect(audioCodecPlayableIn('mp4', '')).toBe(true);
        expect(audioCodecPlayableIn('mkv', '')).toBe(true);
    });

    it('aac/mp3 在 mp4 里能播', () => {
        expect(audioCodecPlayableIn('mp4', 'aac')).toBe(true);
        expect(audioCodecPlayableIn('mp4', 'mp3')).toBe(true);
    });

    it('🔴 aac 塞进 webm 不是标准做法，按不能播处理', () => {
        // webm 的音频规范只认 opus/vorbis；把 aac 标成「webm 可播」会让真正播放时哑火
        expect(audioCodecPlayableIn('webm', 'aac')).toBe(false);
    });

    it('opus 在 webm 能播', () => {
        expect(audioCodecPlayableIn('webm', 'opus')).toBe(true);
    });

    it('vorbis 只在 webm/ogv 能播，mp4 里不行', () => {
        expect(audioCodecPlayableIn('ogv', 'vorbis')).toBe(true);
        expect(audioCodecPlayableIn('mp4', 'vorbis')).toBe(false);
    });

    it('ac3/dts/flac 一律不行', () => {
        for (const c of ['ac3', 'dts', 'flac', 'truehd']) {
            expect(audioCodecPlayableIn('mp4', c)).toBe(false);
        }
    });
});

describe('containerIsPlayable', () => {
    it('四种可播容器', () => {
        for (const e of ['mp4', 'webm', 'mov', 'ogv']) expect(containerIsPlayable(e)).toBe(true);
    });

    it('其余一律不可', () => {
        for (const e of ['mkv', 'avi', 'ts', 'flv', 'wmv', '']) expect(containerIsPlayable(e)).toBe(false);
    });

    it('大小写无关', () => {
        expect(containerIsPlayable('MP4')).toBe(true);
    });
});

describe('buildProbeArgs', () => {
    it('用 info 级别 + -f null 输出，不产出文件', () => {
        const a = buildProbeArgs('C:/v/a.mkv');
        expect(a).toContain('-loglevel');
        expect(a[a.indexOf('-loglevel') + 1]).toBe('info');
        // 末尾必须是 `-f null -`：`-f null` 是假封装器，`-` 是输出到 stdout 丢弃
        expect(a.slice(-3)).toEqual(['-f', 'null', '-']);
        expect(a[a.indexOf('-i') + 1]).toBe('C:/v/a.mkv');
        expect(a).toContain('-hide_banner');
    });
});

describe('buildRemuxArgs', () => {
    it('视频 copy、丢字幕数据轨、faststart', () => {
        const a = buildRemuxArgs('in.mkv', 'out.mp4', probe({ videoCodec: 'h264', audioCodec: 'aac' }));
        expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
        expect(a[a.indexOf('-c:a') + 1]).toBe('copy');
        expect(a).toContain('-sn');
        expect(a).toContain('-dn');
        expect(a[a.indexOf('-movflags') + 1]).toBe('+faststart');
        expect(a).toContain('0:a:0?');
    });

    it('🔴 音频不认时只重编音频，视频仍 copy', () => {
        const a = buildRemuxArgs('in.mkv', 'out.mp4', probe({ videoCodec: 'h264', audioCodec: 'ac3' }));
        expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
        expect(a[a.indexOf('-c:a') + 1]).toBe('aac');
    });

    it('不传 probe 时按音频可复制处理（保守：不改音频编码）', () => {
        const a = buildRemuxArgs('in.mkv', 'out.mp4');
        expect(a[a.indexOf('-c:a') + 1]).toBe('copy');
    });

    it('🔴 输出恒为 mp4：按 mp4 的口径判音频，flac 源必须重编', () => {
        const a = buildRemuxArgs('in.mkv', 'out.mp4', probe({ videoCodec: 'h264', audioCodec: 'flac' }));
        expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
        expect(a[a.indexOf('-c:a') + 1]).toBe('aac');
    });

    it('opus 在 mp4 里 Chromium 能解 ⇒ 直接复制（不白重编一遍音频）', () => {
        const a = buildRemuxArgs('in.webm', 'out.mp4', probe({ videoCodec: 'vp9', audioCodec: 'opus' }));
        expect(a[a.indexOf('-c:v') + 1]).toBe('copy');
        expect(a[a.indexOf('-c:a') + 1]).toBe('copy');
    });
});

describe('buildTranscodeArgs', () => {
    it('显式压平像素格式（10bit 源转出来才能播）', () => {
        const a = buildTranscodeArgs('in.mkv', 'out.mp4', H264_ENCODER_FALLBACK, probe({ videoCodec: 'hevc' }));
        expect(a[a.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    });

    it('音频统一 aac 立体声', () => {
        const a = buildTranscodeArgs('in.mkv', 'out.mp4', 'libx264', probe());
        expect(a[a.indexOf('-c:a') + 1]).toBe('aac');
        expect(a[a.indexOf('-ac') + 1]).toBe('2');
    });

    it('4K 以内不加 scale', () => {
        const a = buildTranscodeArgs('in.mkv', 'out.mp4', 'libx264', probe({ width: 1920, height: 1080 }));
        expect(a).not.toContain('-vf');
    });

    it('8K 源缩到 4K', () => {
        const a = buildTranscodeArgs('in.mkv', 'out.mp4', 'libx264', probe({ width: 7680, height: 4320 }));
        expect(a[a.indexOf('-vf') + 1]).toBe('scale=3840:-2');
    });

    it('空 encoder ⇒ 退 libx264，不产出非法参数', () => {
        const a = buildTranscodeArgs('in.mkv', 'out.mp4', '', probe());
        expect(a[a.indexOf('-c:v') + 1]).toBe(H264_ENCODER_FALLBACK);
    });
});

describe('downscaleFilter', () => {
    it('横屏超宽按宽缩', () => {
        expect(downscaleFilter(probe({ width: 7680, height: 4320 }))).toBe('scale=3840:-2');
    });

    it('竖屏超高按高缩', () => {
        expect(downscaleFilter(probe({ width: 2160, height: 4320 }))).toBe('scale=-2:2160');
    });

    it('尺寸未知 ⇒ 空串（⛔ 别瞎缩）', () => {
        expect(downscaleFilter(probe())).toBe('');
    });
});

describe('encoderQualityArgs', () => {
    it('每家参数不同，⛔ 不能共用一套', () => {
        expect(encoderQualityArgs('h264_nvenc')).toContain('-cq');
        expect(encoderQualityArgs('h264_qsv')).toContain('-global_quality');
        expect(encoderQualityArgs('h264_amf')).toContain('-qp_i');
        expect(encoderQualityArgs('libx264')).toContain('-crf');
    });

    it('未知编码器退到 libx264 那套', () => {
        expect(encoderQualityArgs('不存在的编码器')).toEqual(encoderQualityArgs('libx264'));
    });
});

describe('transcodeFileName', () => {
    it('稳定：同样输入永远同样输出', () => {
        expect(transcodeFileName('/a/b.mkv')).toBe(transcodeFileName('/a/b.mkv'));
    });

    it('不同路径不同名（不同目录同名文件不能撞车）', () => {
        expect(transcodeFileName('/a/01.mkv')).not.toBe(transcodeFileName('/b/01.mkv'));
    });

    it('形如 tc-xxxxxxxx.mp4', () => {
        expect(transcodeFileName('x')).toMatch(/^tc-[0-9a-f]{8}\.mp4$/);
    });

    it('空输入也不抛', () => {
        expect(transcodeFileName('')).toMatch(/^tc-[0-9a-f]{8}\.mp4$/);
    });
});

describe('isTranscodableSource', () => {
    it('mkv/avi/ts/flv/wmv 需要转', () => {
        for (const n of ['a.mkv', 'a.avi', 'a.ts', 'a.flv', 'a.wmv']) {
            expect(isTranscodableSource(n)).toBe(true);
        }
    });

    it('本来就能播的四种 ⇒ 不需要转（false）', () => {
        for (const n of ['a.mp4', 'a.webm', 'a.mov', 'a.ogv']) {
            expect(isTranscodableSource(n)).toBe(false);
        }
    });

    it('非视频 ⇒ false', () => {
        expect(isTranscodableSource('a.txt')).toBe(false);
        expect(isTranscodableSource('')).toBe(false);
    });

    it('带查询串/反斜杠也能认', () => {
        expect(isTranscodableSource('D:\\anime\\01.mkv')).toBe(true);
        expect(isTranscodableSource('https://h/a.mkv?sign=x')).toBe(true);
    });
});

describe('transcodePercent', () => {
    it('正常换算', () => {
        expect(transcodePercent(30, 60)).toBe(50);
    });

    it('分母未知 ⇒ null（⛔ 别拿 0 当分母）', () => {
        expect(transcodePercent(30, 0)).toBeNull();
        expect(transcodePercent(30, NaN)).toBeNull();
    });

    it('超过总时长也钳到 100', () => {
        expect(transcodePercent(90, 60)).toBe(100);
    });

    it('负数钳到 0', () => {
        expect(transcodePercent(-5, 60)).toBe(0);
    });
});
