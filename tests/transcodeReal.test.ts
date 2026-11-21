// @vitest-environment node
/**
 * 转码链**真机**冒烟：真的拉起 ffmpeg，把 mkv 转成 mp4，再探测产物是否可播。
 *
 * 🔴 为什么必须有这一层（单测覆盖不到的地方）：
 *    `tests/transcode.test.ts` 全是纯函数断言 —— 它保证「参数拼得对」，但保证不了
 *    「这套参数喂给真 ffmpeg 会成功」。本仓已经栽过同类的坑（DASH 那套参数在单测里全绿，
 *    真机全是黑屏）。转码这件事的失败模式几乎全在「参数组合 + 真实容器特性」上：
 *    例如 `-map 0:a:0?` 在一个没有音轨的 mkv 上行为如何、`-movflags +faststart` 会不会因为
 *    输出到系统临时盘而失败 —— 这些只有真跑才知道。
 *
 * ⚠️ 没装 ffmpeg 的机器上**跳过**（⛔ 不能让这条测试变成「谁没装 ffmpeg 谁 CI 红」）。
 * ⚠️ 只跑最省时的一条（2 秒、h264+aac、流复制），总耗时控制在数秒内；
 *    真正慢的重编码路径不在冒烟范围（那是 ffmpeg 自己的事，不是本仓的逻辑）。
 */
import { describe, expect, it } from 'vitest';
import { defaultTranscodeDeps, probeVideo, transcodeToMp4 } from 'services/transcode';
import { isEmbeddableVideoPath } from 'pure/mediaExtensions';

/** 找一个能用的 ffmpeg（与宿主 `asrAutoDetect` 同源候选，这里只挑绝对路径最多的那个） */
function findFfmpeg(): string {
    // 惰性 require：本文件只在 node 环境跑，但导入期就不碰 fs 更安全
    const fs = require('fs') as typeof import('fs');
    const candidates = [
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        '/usr/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/opt/homebrew/bin/ffmpeg',
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch {
            /* 权限不足等，跳过 */
        }
    }
    // 最后试 PATH 上的裸名（spawn 会自己解析）
    return '';
}

const FFMPEG = findFfmpeg();

describe.skipIf(!FFMPEG)('transcodeToMp4 · 真机冒烟（真的拉 ffmpeg）', () => {
    it('mkv(h264+aac) → mp4：产物存在、能被探测、是内嵌容器', async () => {
        const deps = defaultTranscodeDeps();
        const fs = require('fs') as typeof import('fs');
        const os = require('os') as typeof import('os');
        const pathMod = require('path') as typeof import('path');
        const cp = require('child_process') as typeof import('child_process');

        const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'rl-tc-smoke-'));
        const src = pathMod.join(dir, 'smoke.mkv');
        try {
            // ① 造一个 2 秒的 mkv：h264 视频 + aac 音频（正是要 remux 的典型形态）
            const made = cp.spawnSync(
                FFMPEG,
                [
                    '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2:r=10',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-shortest',
                    src,
                ],
                { windowsHide: true },
            );
            expect(made.status, `造样本失败：${String(made.stderr)}`).toBe(0);
            expect(fs.existsSync(src)).toBe(true);

            // ② 探测：确认真能读出编码（这条本身就是 parseFfmpegProbe 的真机验证）
            const probe = await probeVideo(deps, FFMPEG, src);
            expect(probe.spawnError, `探测进程起不来：${probe.spawnError}`).toBe('');
            expect(probe.probe.videoCodec).toBe('h264');
            expect(probe.probe.audioCodec).toBe('aac');

            // ③ 转封装
            const res = await transcodeToMp4(deps, FFMPEG, src, src, {});
            expect(res.ok, `转码失败：${res.message}`).toBe(true);
            // 编码本来就是 h264+aac ⇒ 走 remux 就够，⛔ 不该退化成重编码
            expect(res.mode).toBe('remux');
            expect(fs.existsSync(res.outPath)).toBe(true);
            expect(isEmbeddableVideoPath(res.outPath)).toBe(true);
            // 产物不能是空壳（2 秒视频至少几 KB）
            expect(fs.statSync(res.outPath).size).toBeGreaterThan(1000);

            // ④ 产物再探测一遍：确认真的是一个正常的 mp4
            const after = await probeVideo(deps, FFMPEG, res.outPath);
            expect(after.spawnError).toBe('');
            expect(after.probe.videoCodec).toBe('h264');

            // ⑤ 第二次调用直接复用产物（缓存那条分支的真机版）
            const again = await transcodeToMp4(deps, FFMPEG, src, src, {});
            expect(again.ok).toBe(true);
            expect(again.outPath).toBe(res.outPath);
        } finally {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                /* 临时目录清不掉不影响结论 */
            }
        }
    }, 60_000);

    /**
     * HEVC 源：必须走**重编码**，且要走完「硬件编码器依次试 → 全失败退 libx264」整条链。
     *
     * 🔴 这条测的正是最容易假绿的地方：单测里 `buildTranscodeArgs` 拼出来的
     *    `-c:v h264_nvenc -preset p4 …` 完全合法，但这台机器可能**没有 N 卡**——
     *    真机的 `h264_nvenc` 会直接报 "Cannot load nvcuda.dll" 退出码非 0。
     *    如果降级链写错（例如把 `spawnCode` 判反、或者失败后不清半成品），
     *    用户看到的就是「HEVC 视频永远转不出来」，而单测全绿。
     *    ⇒ 这里显式要求：最终 ok 且产物是 h264 —— 不关心到底哪个编码器成了。
     */
    it('mkv(hevc) → mp4：必须重编码，且降级链能落到 libx264', async () => {
        const deps = defaultTranscodeDeps();
        const fs = require('fs') as typeof import('fs');
        const os = require('os') as typeof import('os');
        const pathMod = require('path') as typeof import('path');
        const cp = require('child_process') as typeof import('child_process');

        const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'rl-tc-hevc-'));
        const src = pathMod.join(dir, 'hevc.mkv');
        try {
            // libx265 造 1 秒 HEVC（比 h264 慢，但 1 秒 320x240 在几百毫秒量级）
            const made = cp.spawnSync(
                FFMPEG,
                [
                    '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=10',
                    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
                    '-c:v', 'libx265', '-pix_fmt', 'yuv420p',
                    // ⚠️ x265 默认往 stderr 喷一堆版本横幅，压到 error 免得污染 parseFfmpegProbe
                    '-x265-params', 'log-level=error',
                    '-c:a', 'aac', '-shortest',
                    src,
                ],
                { windowsHide: true },
            );
            // 这台机器的 ffmpeg 没编进 libx265 ⇒ 跳过（不是本仓的错）
            if (made.status !== 0) {
                expect(String(made.stderr)).toMatch(/libx265|Unknown encoder|not found/i);
                return;
            }

            const probe = await probeVideo(deps, FFMPEG, src);
            expect(probe.spawnError).toBe('');
            expect(probe.probe.videoCodec).toBe('hevc');

            const res = await transcodeToMp4(deps, FFMPEG, src, src, {});
            expect(res.ok, `HEVC 重编码失败：${res.message}`).toBe(true);
            // hevc 在 Chromium 里只有部分平台能播 ⇒ 必须重编码，⛔ 不能只 remux
            expect(res.mode).toBe('transcode');

            const after = await probeVideo(deps, FFMPEG, res.outPath);
            expect(after.spawnError).toBe('');
            // 最终产物必须是 h264 —— 这才是「mkv/HEVC 也能在插件内播」的验收点
            expect(after.probe.videoCodec).toBe('h264');
            expect(fs.statSync(res.outPath).size).toBeGreaterThan(500);
        } finally {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                /* 忽略 */
            }
        }
    }, 120_000);
});
