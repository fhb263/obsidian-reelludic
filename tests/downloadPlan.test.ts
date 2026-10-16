import { describe, it, expect } from 'vitest';
import {
    DOWNLOAD_DIR_DEFAULT,
    DOWNLOAD_ROOT_DEFAULT,
    DOWNLOAD_EXT_WHITELIST,
    DOWNLOAD_MAX_BYTES,
    DOWNLOAD_NAME_MAX_CHARS,
    downloadDir,
    downloadDirAbsPath,
    downloadExt,
    downloadExtAllowed,
    downloadRelPath,
    downloadSizeIssue,
    downloadRootIssue,
    migrateLegacyDownloadDir,
    normalizeDownloadRoot,
    sanitizeDownloadName,
    uniqueDownloadName,
} from 'pure/downloadPlan';
import { AUDIO_ASSOCIABLE_EXTENSIONS, VIDEO_ASSOCIABLE_EXTENSIONS } from 'pure/mediaExtensions';

describe('sanitizeDownloadName', () => {
    it('Windows 非法字符一律换成下划线', () => {
        expect(sanitizeDownloadName('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    });

    it('控制字符也换下划线（换行/制表符混进歌名是上游常态）', () => {
        expect(sanitizeDownloadName('a\tb\nc')).toBe('a_b_c');
    });

    it('折叠连续空白，但保留词间单空格', () => {
        expect(sanitizeDownloadName('a    b')).toBe('a b');
        expect(sanitizeDownloadName('  a  b  ')).toBe('a b');
    });

    it('去掉尾部空白与点（Windows 会静默吃掉它们，导致「落盘名 ≠ 预期名」）', () => {
        expect(sanitizeDownloadName('歌名 .')).toBe('歌名');
        expect(sanitizeDownloadName('歌名...')).toBe('歌名');
    });

    it('中文 / 括号 / 连字符 / 顿号 / 《》 都是合法字符，一个都不许动', () => {
        expect(sanitizeDownloadName('《歌名》- A、B (Live)')).toBe('《歌名》- A、B (Live)');
    });

    it('净化后为空则回退「未命名」（空串 / 全空格 / 只剩尾点）', () => {
        expect(sanitizeDownloadName('')).toBe('未命名');
        expect(sanitizeDownloadName('   ')).toBe('未命名');
        expect(sanitizeDownloadName('.')).toBe('未命名');
    });

    it('超长名截断到上限（防单段超出文件系统限制）', () => {
        const long = 'あ'.repeat(DOWNLOAD_NAME_MAX_CHARS + 50);
        expect(sanitizeDownloadName(long).length).toBe(DOWNLOAD_NAME_MAX_CHARS);
    });

    it('反例守卫：不做净化时非法字符会原样留下', () => {
        const raw = 'a/b:c';
        expect(sanitizeDownloadName(raw)).not.toBe(raw);
        expect(raw.includes('/')).toBe(true);
        expect(sanitizeDownloadName(raw).includes('/')).toBe(false);
    });
});

describe('downloadExt / downloadExtAllowed', () => {
    it('取扩展名：小写、去点无关、无扩展名或点结尾为空气', () => {
        expect(downloadExt('a.mp3')).toBe('mp3');
        expect(downloadExt('a.MP3')).toBe('mp3');
        expect(downloadExt('a.b.flac')).toBe('flac');
        expect(downloadExt('a')).toBe('');
        expect(downloadExt('.hidden')).toBe('');
        expect(downloadExt('a.')).toBe('');
    });

    it('白名单内放行（大小写与点无关），名单外拒绝', () => {
        expect(downloadExtAllowed('music', 'mp3')).toBe(true);
        expect(downloadExtAllowed('music', '.MP3')).toBe(true);
        expect(downloadExtAllowed('music', 'exe')).toBe(false);
        expect(downloadExtAllowed('music', '')).toBe(false);
        expect(downloadExtAllowed('video', 'mkv')).toBe(true);
        expect(downloadExtAllowed('other', 'mp3')).toBe(false);
    });

    it('音乐 / 视频白名单恒等于既有真源（⛔ 不许在本模块另抄一份）', () => {
        expect(DOWNLOAD_EXT_WHITELIST.music).toBe(AUDIO_ASSOCIABLE_EXTENSIONS);
        expect(DOWNLOAD_EXT_WHITELIST.video).toBe(VIDEO_ASSOCIABLE_EXTENSIONS);
    });
});

describe('uniqueDownloadName', () => {
    const taken = (...names: string[]) => new Set(names);

    it('不冲突时原样返回', () => {
        expect(uniqueDownloadName('歌名.mp3', taken())).toBe('歌名.mp3');
        expect(uniqueDownloadName('歌名.mp3', taken('别的.mp3'))).toBe('歌名.mp3');
    });

    it('冲突时追加 (2) / (3)（括号前有空格）', () => {
        expect(uniqueDownloadName('歌名.mp3', taken('歌名.mp3'))).toBe('歌名 (2).mp3');
        expect(uniqueDownloadName('歌名.mp3', taken('歌名.mp3', '歌名 (2).mp3'))).toBe('歌名 (3).mp3');
    });

    it('🔴 已带编号的名字要先归一再续号（否则会堆出「歌名 (2) (2).mp3」）', () => {
        expect(uniqueDownloadName('歌名 (2).mp3', taken('歌名 (2).mp3'))).toBe('歌名 (3).mp3');
        // 编号有空洞时**填第一个空位**，而不是「剥完编号一路加到 6」（洞不填会让编号无限膨胀）
        expect(uniqueDownloadName('歌名 (5).mp3', taken('歌名 (5).mp3'))).toBe('歌名 (2).mp3');
    });

    it('无扩展名也能去重（编号落在名字尾部）', () => {
        expect(uniqueDownloadName('歌名', taken('歌名'))).toBe('歌名 (2)');
    });

    it('多个点时只按最后一段扩展名处理', () => {
        expect(uniqueDownloadName('a.b.mp3', taken('a.b.mp3'))).toBe('a.b (2).mp3');
    });

    it('🔴 不带空格的「(数字)」是歌名的一部分，⛔ 不许剥（歌名(2) → 歌名(2) (2)）', () => {
        expect(uniqueDownloadName('歌名(2).mp3', taken('歌名(2).mp3'))).toBe('歌名(2) (2).mp3');
    });

    it('先净化再判重（非法字符不会绕过重名检测）', () => {
        expect(uniqueDownloadName('a/b.mp3', taken('a_b.mp3'))).toBe('a_b (2).mp3');
    });
});

describe('downloadDir（#459：值 = 目录本身，⛔ 不再拼子目录）', () => {
    it('填什么就用什么 —— 只做归一（反斜杠 / 首尾斜杠），不再多套一层', () => {
        expect(downloadDir('下载/音乐', 'music')).toBe('下载/音乐');
        expect(downloadDir('我的库/下载', 'music')).toBe('我的库/下载');
        expect(downloadDir('a\\b', 'music')).toBe('a/b');
        expect(downloadDir('/x/', 'music')).toBe('x');
    });

    it('空 / 未填 ⇒ 用该类型的默认目录（不是通用缺省「下载」）', () => {
        expect(downloadDir(undefined, 'music')).toBe('下载/音乐');
        expect(downloadDir('', 'book')).toBe('下载/书籍');
        expect(downloadDir('///', 'video')).toBe('下载/视频');
    });

    it('默认目录与常量表同源（默认落点与旧版逐字一致）', () => {
        expect(downloadDir(undefined, 'music')).toBe(DOWNLOAD_DIR_DEFAULT.music);
        expect(downloadDir(undefined, 'video')).toBe(DOWNLOAD_DIR_DEFAULT.video);
        expect(DOWNLOAD_DIR_DEFAULT.music).toBe(`${DOWNLOAD_ROOT_DEFAULT}/音乐`);
        expect(DOWNLOAD_DIR_DEFAULT.book).toBe(`${DOWNLOAD_ROOT_DEFAULT}/书籍`);
    });

    it('🔴 回归：把「下载/音乐」再喂进去不许变成「下载/音乐/音乐」（用户报障的原始形态）', () => {
        expect(downloadDir('下载/音乐', 'music')).not.toBe('下载/音乐/音乐');
        expect(downloadRelPath({ kind: 'music', filename: 'a.mp3', root: '下载/音乐' })).toBe('下载/音乐/a.mp3');
    });
});

describe('downloadRelPath', () => {
    it('拼成「目录/文件名」（目录来自 kind 的默认值或调用方给的值）', () => {
        expect(downloadRelPath({ kind: 'music', filename: '歌手 - 歌名.mp3' })).toBe('下载/音乐/歌手 - 歌名.mp3');
    });

    it('与 taken 联动做重名去重', () => {
        const taken = new Set(['下载/音乐/歌手 - 歌名.mp3']);
        expect(downloadRelPath({ kind: 'music', filename: '歌手 - 歌名.mp3', taken })).toBe(
            '下载/音乐/歌手 - 歌名 (2).mp3',
        );
    });

    it('文件名同样走净化', () => {
        expect(downloadRelPath({ kind: 'music', filename: 'a:b.mp3' })).toBe('下载/音乐/a_b.mp3');
    });

    it('🔴 只跟**同目录**的既有文件判重：别处的同名文件不算冲突', () => {
        const taken = new Set(['下载/视频/歌手 - 歌名.mp3', '别的地方/歌手 - 歌名.mp3']);
        expect(downloadRelPath({ kind: 'music', filename: '歌手 - 歌名.mp3', taken })).toBe(
            '下载/音乐/歌手 - 歌名.mp3',
        );
    });
});

describe('downloadSizeIssue', () => {
    it('未超限返回 null（含边界：恰好等于上限放行）', () => {
        expect(downloadSizeIssue(100)).toBeNull();
        expect(downloadSizeIssue(DOWNLOAD_MAX_BYTES)).toBeNull();
    });

    it('超限返回可读原因（含 MB 数值）', () => {
        const msg = downloadSizeIssue(DOWNLOAD_MAX_BYTES + 1);
        expect(msg).toBe(`文件超过 ${Math.round(DOWNLOAD_MAX_BYTES / 1024 / 1024)} MB 上限`);
    });

    it('非有限值 / 负数认定为异常', () => {
        expect(downloadSizeIssue(NaN)).toBe('文件大小异常');
        expect(downloadSizeIssue(-1)).toBe('文件大小异常');
    });
});

// #403：设置页「音乐下载路径目录」的归一与校验（用户：「在设置页-基本设置-数据与备份分组下，新增
// 「音乐下载路径目录」设置项」）。两个函数是**同一个真源**：`downloadDir()` 内部也走 normalize。
describe('normalizeDownloadRoot（#403 归一）', () => {
    it('反斜杠归一、去掉首尾斜杠与空白', () => {
        expect(normalizeDownloadRoot('\\下载\\音乐\\')).toBe('下载/音乐');
        expect(normalizeDownloadRoot('  下载/  ')).toBe('下载');
        expect(normalizeDownloadRoot('/下载//')).toBe('下载');
    });

    it('空 / 全是斜杠 / undefined ⇒ 回缺省（⛔ 不是空串）', () => {
        expect(normalizeDownloadRoot('')).toBe(DOWNLOAD_ROOT_DEFAULT);
        expect(normalizeDownloadRoot('///')).toBe(DOWNLOAD_ROOT_DEFAULT);
        expect(normalizeDownloadRoot(undefined)).toBe(DOWNLOAD_ROOT_DEFAULT);
        expect(normalizeDownloadRoot('   ')).toBe(DOWNLOAD_ROOT_DEFAULT);
    });

    it('#459：传了 kind ⇒ 空值回**该类型**的默认目录（这两项现在就是目录本身）', () => {
        expect(normalizeDownloadRoot('', 'music')).toBe('下载/音乐');
        expect(normalizeDownloadRoot(undefined, 'book')).toBe('下载/书籍');
        expect(normalizeDownloadRoot('\\', 'video')).toBe('下载/视频');
        // 有值 ⇒ kind 不影响结果（只做归一）
        expect(normalizeDownloadRoot('我的/音乐', 'book')).toBe('我的/音乐');
    });

    it('🔴 与 `downloadDir` 同源：归一后的值**就是**落盘目录（两处规则不许分叉）', () => {
        expect(downloadDir('\\下载\\', 'music')).toBe(normalizeDownloadRoot('\\下载\\'));
        expect(downloadDir('', 'music')).toBe(normalizeDownloadRoot('', 'music'));
    });
});

// #460：系统文件选择器（「浏览」）的 `defaultPath` 锚点 —— 冷启动要落在设置里填的目录，而不是系统「下载」
describe('downloadDirAbsPath（#460 系统选择器的锚点）', () => {
    it('拼接：库基路径 + 该类型目录', () => {
        expect(downloadDirAbsPath('C:/库', '下载/音乐', 'music')).toBe('C:/库/下载/音乐');
        expect(downloadDirAbsPath('C:/库', '下载/书籍', 'book')).toBe('C:/库/下载/书籍');
    });

    it('基路径归一：反斜杠 → 正斜杠、尾斜杠去掉（⛔ 别拼出 `C:\\库/下载` 这种混合形态）', () => {
        expect(downloadDirAbsPath('C:\\Users\\kest\\库\\', '下载/音乐', 'music')).toBe('C:/Users/kest/库/下载/音乐');
        expect(downloadDirAbsPath('\\\\nas\\share', '下载/音乐', 'music')).toBe('//nas/share/下载/音乐');
    });

    it('root 空 ⇒ 用该类型默认目录（与落盘同一个 `downloadDir`）', () => {
        expect(downloadDirAbsPath('C:/库', undefined, 'music')).toBe('C:/库/下载/音乐');
        expect(downloadDirAbsPath('C:/库', '', 'book')).toBe('C:/库/下载/书籍');
    });

    it('🔴 拿不到库基路径（非桌面 / 空串）⇒ `undefined`（退回系统默认，⛔ 不硬编路径）', () => {
        expect(downloadDirAbsPath(undefined, '下载/音乐', 'music')).toBeUndefined();
        expect(downloadDirAbsPath('', '下载/音乐', 'music')).toBeUndefined();
        expect(downloadDirAbsPath('   ', '下载/音乐', 'music')).toBeUndefined();
        expect(downloadDirAbsPath('/', '下载/音乐', 'music')).toBeUndefined();
    });
});

// #459：设置项语义从「下载根」改成「目录本身」时的一次性迁移（旧缺省 `下载` ⇒ 该类型默认目录）
describe('migrateLegacyDownloadDir（#459 存量迁移）', () => {
    it('旧缺省「下载」（含斜杠 / 空白写法）⇒ 补成该类型的默认目录', () => {
        expect(migrateLegacyDownloadDir('下载', 'music')).toBe('下载/音乐');
        expect(migrateLegacyDownloadDir('下载/', 'book')).toBe('下载/书籍');
        expect(migrateLegacyDownloadDir('  下载  ', 'video')).toBe('下载/视频');
    });

    it('🔴 用户自己填的值一个都不动（含已经是 `下载/音乐` 的、和更深的自定义目录）', () => {
        expect(migrateLegacyDownloadDir('下载/音乐', 'music')).toBe('下载/音乐');
        expect(migrateLegacyDownloadDir('我的库/歌', 'music')).toBe('我的库/歌');
        expect(migrateLegacyDownloadDir('媒体', 'music')).toBe('媒体');
    });

    it('空 / undefined 原样返回（= 用默认，由 downloadDir 兜）', () => {
        expect(migrateLegacyDownloadDir('', 'music')).toBe('');
        expect(migrateLegacyDownloadDir(undefined, 'book')).toBe('');
    });
});

describe('downloadRootIssue（#403 校验）', () => {
    it('库内相对路径合法（含中文 / 嵌套 / 空值）', () => {
        expect(downloadRootIssue('下载')).toBeNull();
        expect(downloadRootIssue('媒体/音乐')).toBeNull();
        expect(downloadRootIssue('')).toBeNull(); // 空 = 用缺省，**合法**
        expect(downloadRootIssue(undefined)).toBeNull();
    });

    it('🔴 盘符 / 绝对路径拦下（否则会被当库内文件夹 ⇒ 下载物落到「D:/音乐/音乐/…」且零报错）', () => {
        expect(downloadRootIssue('D://音乐')).toContain('不能填盘符或绝对路径');
        expect(downloadRootIssue('D:/音乐')).toContain('不能填盘符或绝对路径');
        expect(downloadRootIssue('/下载')).toContain('不能填盘符或绝对路径');
        expect(downloadRootIssue('\\\\nas\\share')).toContain('不能填盘符或绝对路径');
    });

    it('`..` 段拦下（会爬到库根之外）', () => {
        expect(downloadRootIssue('../外面')).toContain('不能出现 ..');
        expect(downloadRootIssue('下载/../外面')).toContain('不能出现 ..');
    });

    it('Windows 非法字符拦下', () => {
        expect(downloadRootIssue('下载:测试')).toBeTruthy();
        expect(downloadRootIssue('下载*名')).toBeTruthy();
        expect(downloadRootIssue('a?b')).toBeTruthy();
    });
});
