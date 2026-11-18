/**
 * `pure/asrLocate` 单测 —— 自动定位外部程序的**规则**。
 *
 * 🔴 这一组守的是用户 m05462 那次抱怨：判据必须是「系统里有没有」，不是「框里填没填」。
 *    几条最容易回归的点：
 *    ① 自动探测**不能用**含 `whisper.exe` 的候选表（那名字被 Python 版 openai-whisper 占用，
 *       探测「成功」但转写必然抛 Traceback）；
 *    ② Windows 的 PATH 只能用 `;` 拆，按 `:` 拆会切碎盘符；
 *    ③ 用户填了值就只试他自己填的（否则他以为配置生效了、实际跑的是另一个）。
 */
import { describe, expect, it } from 'vitest';
import {
    asrReady,
    commonInstallDirs,
    ffmpegPathNames,
    locateOrder,
    pathCandidates,
    splitPathList,
    whisperCppOnlyNames,
    withPlatformExt,
} from 'pure/asrLocate';

describe('withPlatformExt', () => {
    it('Windows 上没有扩展名的补 .exe', () => {
        expect(withPlatformExt('whisper-cli', 'win32')).toBe('whisper-cli.exe');
    });

    it('Windows 上已有扩展名的不动', () => {
        expect(withPlatformExt('whisper-cli.exe', 'win32')).toBe('whisper-cli.exe');
    });

    it('POSIX 上剥掉 .exe', () => {
        expect(withPlatformExt('ffmpeg.exe', 'darwin')).toBe('ffmpeg');
    });

    it('POSIX 上无扩展名的保持原样', () => {
        expect(withPlatformExt('ffmpeg', 'linux')).toBe('ffmpeg');
    });

    it('POSIX 上其它扩展名不动（别把所有点号后缀都当 .exe）', () => {
        expect(withPlatformExt('model.int8.onnx', 'darwin')).toBe('model.int8.onnx');
    });
});

describe('ffmpegPathNames', () => {
    it('Windows 只出 .exe 形态，不出重复的无扩展名版本', () => {
        const names = ffmpegPathNames('win32');
        expect(names).toContain('ffmpeg.exe');
        expect(names).not.toContain('ffmpeg');
    });

    it('POSIX 只出无扩展名形态', () => {
        const names = ffmpegPathNames('linux');
        expect(names).toContain('ffmpeg');
        expect(names).not.toContain('ffmpeg.exe');
    });
});

describe('whisperCppOnlyNames', () => {
    it('🔴 绝不包含 whisper —— 那个名字会被 Python 版 openai-whisper 占走', () => {
        for (const platform of ['win32', 'darwin', 'linux']) {
            const names = whisperCppOnlyNames(platform).map((n) => n.toLowerCase());
            expect(names).not.toContain('whisper');
            expect(names).not.toContain('whisper.exe');
        }
    });

    it('三个 whisper.cpp 的专属名都在（新旧版本二进制名不同）', () => {
        const names = whisperCppOnlyNames('win32');
        expect(names).toEqual(['whisper-cli.exe', 'main.exe', 'whisper-cpp.exe']);
    });

    it('POSIX 上按无扩展名形态给出', () => {
        expect(whisperCppOnlyNames('darwin')).toEqual(['whisper-cli', 'main', 'whisper-cpp']);
    });
});

describe('splitPathList', () => {
    it('Windows 按分号拆', () => {
        expect(splitPathList('C:\\a;C:\\b', 'win32')).toEqual(['C:\\a', 'C:\\b']);
    });

    it('🔴 Windows 上不能按冒号拆 —— 会切碎盘符', () => {
        const out = splitPathList('C:\\ffmpeg\\bin', 'win32');
        expect(out).toEqual(['C:\\ffmpeg\\bin']);
        expect(out[0]).toContain('C:\\');
    });

    it('POSIX 按冒号拆', () => {
        expect(splitPathList('/usr/bin:/opt/bin', 'linux')).toEqual(['/usr/bin', '/opt/bin']);
    });

    it('空 / undefined / 全空白都给空数组', () => {
        expect(splitPathList('', 'win32')).toEqual([]);
        expect(splitPathList(undefined, 'linux')).toEqual([]);
        expect(splitPathList('  ;;  ', 'win32')).toEqual([]);
    });

    it('去掉每项的首尾空白（PATH 里带空格是常见脏数据）', () => {
        expect(splitPathList(' /usr/bin : /opt/bin ', 'linux')).toEqual(['/usr/bin', '/opt/bin']);
    });
});

describe('pathCandidates', () => {
    it('目录 × 名字全组合', () => {
        expect(pathCandidates(['/a', '/b'], ['x', 'y'])).toEqual(['/a/x', '/a/y', '/b/x', '/b/y']);
    });

    it('去掉目录的尾部斜杠（`C:\\bin\\` 与 `C:\\bin` 是同一个目录）', () => {
        expect(pathCandidates(['C:\\bin\\'], ['ffmpeg.exe'])).toEqual(['C:\\bin/ffmpeg.exe']);
    });

    it('去重（同一个目录在 PATH 里出现两次是常态）', () => {
        const out = pathCandidates(['/a', '/a', '/A'], ['x']);
        expect(out).toHaveLength(1);
    });

    it('空目录项被跳过', () => {
        expect(pathCandidates(['', '   ', '/a'], ['x'])).toEqual(['/a/x']);
    });
});

describe('commonInstallDirs', () => {
    const opts = {
        home: 'C:\\Users\\u',
        appData: 'C:\\Users\\u\\AppData\\Roaming',
        localAppData: 'C:\\Users\\u\\AppData\\Local',
        programFiles: 'C:\\Program Files',
        programFilesX86: 'C:\\Program Files (x86)',
    };

    it('🔴 whisper 的第一项必须是插件自己的 bin 目录（与 main.ts 的 asrBinDir 逐字一致）', () => {
        // ⚠️ 2026-11-10 用户裁定把默认落点从 `~/.reelludic` 换到**插件目录**后，这里传 `pluginDir`
        //    才是模拟真实调用（`main.ts` 一直传它）。不传 `pluginDir` 的用例留作兜底路径的守卫。
        const dirs = commonInstallDirs('whisper', 'win32', { ...opts, pluginDir: 'C:\\vault\\.obsidian\\plugins\\obsidian-reelludic' });
        expect(dirs[0]).toBe('C:\\vault\\.obsidian\\plugins\\obsidian-reelludic/bin');
    });

    it('🔴 ffmpeg 的第一项也是那个 bin 目录（一键安装落点）', () => {
        const dirs = commonInstallDirs('ffmpeg', 'win32', { ...opts, pluginDir: '/v/p' });
        expect(dirs[0]).toBe('/v/p/bin');
    });

    it('🔴 老位置仍在候选里：已经装在 ~/.reelludic/bin 的用户升级后不能「程序不见了」', () => {
        const dirs = commonInstallDirs('whisper', 'win32', { ...opts, pluginDir: '/v/p' });
        expect(dirs).toContain('C:\\Users\\u/.reelludic/bin');
    });

    it('🔴 拿不到主目录但拿得到插件目录 ⇒ 仍然返回插件目录（⛔ 别一起判空）', () => {
        const dirs = commonInstallDirs('whisper', 'win32', { home: '', pluginDir: '/v/plugins/reelludic/' });
        expect(dirs).toEqual(['/v/plugins/reelludic/bin']);
    });

    it('插件目录的尾部斜杠被去掉（否则拼出双斜杠）', () => {
        const dirs = commonInstallDirs('ffmpeg', 'win32', { home: '/Users/u', pluginDir: '/v/p/' });
        expect(dirs[0]).toBe('/v/p/bin');
    });

    it('ffmpeg 会查 Program Files 与 WinGet / chocolatey / scoop', () => {
        const dirs = commonInstallDirs('ffmpeg', 'win32', opts);
        expect(dirs).toContain('C:\\Program Files/ffmpeg/bin');
        expect(dirs).toContain('C:\\Users\\u\\AppData\\Local/Microsoft/WinGet/Links');
        expect(dirs).toContain('C:\\Users\\u\\AppData\\Roaming/chocolatey/bin');
        expect(dirs).toContain('C:\\Users\\u/scoop/shims');
    });

    it('POSIX 才加 /usr/local/bin 与 /opt/homebrew/bin', () => {
        const posix = commonInstallDirs('ffmpeg', 'darwin', { home: '/Users/u' });
        expect(posix).toContain('/usr/local/bin');
        expect(posix).toContain('/opt/homebrew/bin');
        const win = commonInstallDirs('ffmpeg', 'win32', opts);
        expect(win).not.toContain('/usr/local/bin');
    });

    it('拿不到主目录 ⇒ 空数组（⛔ 不要退回相对路径乱猜）', () => {
        expect(commonInstallDirs('whisper', 'win32', { home: '' })).toEqual([]);
    });

    it('home 的尾部斜杠被去掉（否则拼出双斜杠）', () => {
        const dirs = commonInstallDirs('whisper', 'win32', { home: '/Users/u/' });
        expect(dirs[0]).toBe('/Users/u/.reelludic/bin');
    });
});

describe('locateOrder', () => {
    const base = {
        pathDirs: ['/usr/bin'],
        names: ['ffmpeg'],
        commonDirs: ['/opt/ffmpeg/bin'],
    };

    it('🔴 用户填了值就只试它自己 —— 不悄悄换成 PATH 里的另一个', () => {
        const order = locateOrder({ ...base, custom: '/my/ffmpeg' });
        expect(order).toEqual(['/my/ffmpeg']);
    });

    it('没填 ⇒ 先 PATH 再常见位置', () => {
        const order = locateOrder({ ...base, custom: '' });
        expect(order).toEqual(['/usr/bin/ffmpeg', '/opt/ffmpeg/bin/ffmpeg']);
    });

    it('PATH 与常见位置重合时去重（保留先出现的那个）', () => {
        const order = locateOrder({
            custom: '',
            pathDirs: ['/opt/ffmpeg/bin'],
            names: ['ffmpeg'],
            commonDirs: ['/opt/ffmpeg/bin'],
        });
        expect(order).toEqual(['/opt/ffmpeg/bin/ffmpeg']);
    });

    it('custom 首尾空格被 trim（粘路径常带空格）', () => {
        expect(locateOrder({ ...base, custom: '  /my/ffmpeg  ' })).toEqual(['/my/ffmpeg']);
    });

    it('全都空 ⇒ 空数组（调用方据此判「没找到」）', () => {
        expect(locateOrder({ custom: '', pathDirs: [], names: ['ffmpeg'], commonDirs: [] })).toEqual([]);
    });
});

describe('asrReady', () => {
    it('三件齐才算就绪', () => {
        expect(asrReady({ model: 'a.bin', exe: 'b.exe', ffmpeg: 'c.exe' })).toBe(true);
    });

    it('缺任一件都不算（缺 ffmpeg 也算 —— 三家引擎都要它）', () => {
        expect(asrReady({ model: '', exe: 'b.exe', ffmpeg: 'c.exe' })).toBe(false);
        expect(asrReady({ model: 'a.bin', exe: '', ffmpeg: 'c.exe' })).toBe(false);
        expect(asrReady({ model: 'a.bin', exe: 'b.exe', ffmpeg: '' })).toBe(false);
    });
});
