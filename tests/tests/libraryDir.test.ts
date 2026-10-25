// 媒体库目录「输入值」纯逻辑测试（2026-09-23 #380）。
//
// 为什么值得单测：这一串输入决定「插件去哪个文件夹找 catalog.json」——
// 判错的后果不是显示错一格，而是**静默换到一个空库**（用户以为数据丢了）。所以
// 「什么算合法、什么必须拦、什么等价」这三件事要钉死在纯函数上。
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LIBRARY_DIR,
    normalizeLibraryDirInput,
    libraryDirIssue,
    sameLibraryDir,
    libraryDisplayName,
    fileDisplayName,
} from 'pure/libraryDir';

describe('normalizeLibraryDirInput（归一化）', () => {
    it('去首尾空白 / 反斜杠转正斜杠 / 折叠重复斜杠', () => {
        expect(normalizeLibraryDirInput('  99-媒体库  ')).toBe('99-媒体库');
        expect(normalizeLibraryDirInput('99-媒体库\\影视')).toBe('99-媒体库/影视');
        expect(normalizeLibraryDirInput('99-媒体库//影视')).toBe('99-媒体库/影视');
        expect(normalizeLibraryDirInput('99-媒体库\\\\影视')).toBe('99-媒体库/影视');
    });

    it('去前导 `./` 段与前导 / 尾随斜杠（本字段是库内相对路径）', () => {
        expect(normalizeLibraryDirInput('./99-媒体库')).toBe('99-媒体库');
        expect(normalizeLibraryDirInput('././99-媒体库')).toBe('99-媒体库');
        expect(normalizeLibraryDirInput('/99-媒体库/')).toBe('99-媒体库');
        expect(normalizeLibraryDirInput('\\99-媒体库\\')).toBe('99-媒体库');
    });

    it('嵌套路径保留层级（只去掉多余的那些斜杠）', () => {
        expect(normalizeLibraryDirInput('/99-媒体库/影视/')).toBe('99-媒体库/影视');
        expect(normalizeLibraryDirInput('99-媒体库\\影视//片库')).toBe('99-媒体库/影视/片库');
    });

    it('空 / 纯空白 / 纯斜杠 → 默认库名（与设置页 placeholder 一致）', () => {
        expect(normalizeLibraryDirInput('')).toBe(DEFAULT_LIBRARY_DIR);
        expect(normalizeLibraryDirInput('   ')).toBe(DEFAULT_LIBRARY_DIR);
        expect(normalizeLibraryDirInput('/')).toBe(DEFAULT_LIBRARY_DIR);
        expect(normalizeLibraryDirInput('///')).toBe(DEFAULT_LIBRARY_DIR);
        expect(normalizeLibraryDirInput('\\\\')).toBe(DEFAULT_LIBRARY_DIR);
    });

    it('幂等：归一化两次结果相同（失焦回显、重复提交都靠它）', () => {
        for (const raw of ['  /99-媒体库//影视/ ', '99-媒体库\\影视', '', './ReelLudic']) {
            const once = normalizeLibraryDirInput(raw);
            expect(normalizeLibraryDirInput(once)).toBe(once);
        }
    });

    it('非字符串输入不炸（损坏设置可能是 undefined / null）', () => {
        expect(normalizeLibraryDirInput(undefined as unknown as string)).toBe(DEFAULT_LIBRARY_DIR);
        expect(normalizeLibraryDirInput(null as unknown as string)).toBe(DEFAULT_LIBRARY_DIR);
    });
});

describe('libraryDirIssue（非法输入说明）', () => {
    it('🔴 带盘符的绝对路径必须拦下（否则会被当成库内一个叫 `D:` 的文件夹 ⇒ 静默换空库）', () => {
        expect(libraryDirIssue('D:\\媒体库')).toMatch(/盘符/);
        expect(libraryDirIssue('C:/媒体库')).toMatch(/盘符/);
        expect(libraryDirIssue('d:\\图书馆')).toMatch(/盘符/);
    });

    it('🔴 以 / 或 \\ 开头的路径必须拦下（本字段是库内相对路径）', () => {
        expect(libraryDirIssue('/Users/kest/媒体库')).toMatch(/不要以/);
        expect(libraryDirIssue('\\\\NAS\\媒体库')).toMatch(/不要以/);
    });

    it('🔴 `..` 段必须拦下（静默折叠会「以为指到 A、其实指到 B」）', () => {
        expect(libraryDirIssue('../媒体库')).toMatch(/\.\./);
        expect(libraryDirIssue('a/../../媒体库')).toMatch(/\.\./);
        // 文件名里含点但**不是** `..` 段 → 合法
        expect(libraryDirIssue('99-媒体库/v1.2 片库')).toBeNull();
    });

    it('🔴 跨平台非法字符必须拦下（含 " 会连带破坏 frontmatter 里的封面路径）', () => {
        expect(libraryDirIssue('媒体库<a>')).toMatch(/不能包含/);
        expect(libraryDirIssue('媒体库"引号')).toMatch(/不能包含/);
        expect(libraryDirIssue('媒体库:冒号')).toMatch(/不能包含/);
        expect(libraryDirIssue('媒体库|竖线')).toMatch(/不能包含/);
    });

    it('正常库内相对路径一律放行（中文 / 空格 / + - _ . 都合法）', () => {
        expect(libraryDirIssue('ReelLudic')).toBeNull();
        expect(libraryDirIssue('99-媒体库')).toBeNull();
        expect(libraryDirIssue('我的 媒体库 + 收藏')).toBeNull();
        expect(libraryDirIssue('99-媒体库/影视/片库')).toBeNull();
        expect(libraryDirIssue('.hidden')).toBeNull();
    });

    it('空值合法（= 用默认库名），但纯空白的非法说明不得误报', () => {
        expect(libraryDirIssue('')).toBeNull();
        expect(libraryDirIssue('   ')).toBeNull();
    });
});

describe('sameLibraryDir（同库判定）', () => {
    it('归一化后相同即同一库 —— 写法差异（斜杠方向/前后斜杠/空白）不算换库', () => {
        expect(sameLibraryDir('ReelLudic', ' ReelLudic ')).toBe(true);
        expect(sameLibraryDir('99-媒体库', '/99-媒体库/')).toBe(true);
        expect(sameLibraryDir('99-媒体库\\影视', '99-媒体库/影视')).toBe(true);
        expect(sameLibraryDir('', 'ReelLudic')).toBe(true);
    });

    it('不同库必须判为不同（否则用户改了却没生效）', () => {
        expect(sameLibraryDir('ReelLudic', '99-媒体库')).toBe(false);
        expect(sameLibraryDir('99-媒体库/影视', '99-媒体库/书籍')).toBe(false);
    });
});

// 2026-09-27 ①：用户把库目录设成 `3-资源 Resource/媒体库` 后，视图标签页标题变成了**整条路径**。
// 显示名与存储路径从此分开：这里只回答「叫什么」，路径拼接一律仍用归一化原值。
describe('libraryDisplayName（显示名 = 叶子段）', () => {
    it('🔴 嵌套路径只取最后一段（用户报的正是这个场景）', () => {
        expect(libraryDisplayName('3-资源 Resource/媒体库')).toBe('媒体库');
        expect(libraryDisplayName('99-媒体库/影视/片库')).toBe('片库');
    });

    it('写法差异（尾斜杠 / 重复斜杠 / 反斜杠 / 前导 ./）不影响取值', () => {
        expect(libraryDisplayName('3-资源 Resource/媒体库/')).toBe('媒体库');
        expect(libraryDisplayName('3-资源 Resource//媒体库')).toBe('媒体库');
        expect(libraryDisplayName('3-资源 Resource\\媒体库')).toBe('媒体库');
        expect(libraryDisplayName('./3-资源 Resource/媒体库')).toBe('媒体库');
        expect(libraryDisplayName('  3-资源 Resource/媒体库  ')).toBe('媒体库');
    });

    it('单段路径原样返回（默认 `ReelLudic` 的显示名不因本批改变）', () => {
        expect(libraryDisplayName('ReelLudic')).toBe('ReelLudic');
        expect(libraryDisplayName('媒体库')).toBe('媒体库');
    });

    it('空 / 纯空白 / 纯斜杠 / 非法类型 → 回退默认库名（与归一化同口径，⛔ 不返回空串）', () => {
        expect(libraryDisplayName('')).toBe(DEFAULT_LIBRARY_DIR);
        expect(libraryDisplayName('   ')).toBe(DEFAULT_LIBRARY_DIR);
        expect(libraryDisplayName('/')).toBe(DEFAULT_LIBRARY_DIR);
        expect(libraryDisplayName('///')).toBe(DEFAULT_LIBRARY_DIR);
        expect(libraryDisplayName(undefined as unknown as string)).toBe(DEFAULT_LIBRARY_DIR);
        expect(libraryDisplayName(null as unknown as string)).toBe(DEFAULT_LIBRARY_DIR);
    });

    it('⛔ 反向守卫：显示名**不得**把整条路径吐回来（这正是本次要修的 bug 形态）', () => {
        expect(libraryDisplayName('3-资源 Resource/媒体库')).not.toContain('/');
        expect(libraryDisplayName('3-资源 Resource\\媒体库')).not.toContain('\\');
    });
});

describe('fileDisplayName · 库内文件路径的显示名（去扩展名）', () => {
    it('取叶子段并去掉扩展名', () => {
        expect(fileDisplayName('媒体库/笔记/music/七里香.md')).toBe('七里香');
    });

    it('反斜杠分隔符同样认', () => {
        expect(fileDisplayName('媒体库\\笔记\\music\\七里香.md')).toBe('七里香');
    });

    it('🔴 带点的**目录名**不参与（⛔ 不能从整条路径 lastIndexOf(".") 切）', () => {
        expect(fileDisplayName('1.0 计划/曲名.mp3')).toBe('曲名');
        expect(fileDisplayName('媒体库/笔记/1.2 版本/一首歌.md')).toBe('一首歌');
    });

    it('扩展名大小写不敏感也能去干净', () => {
        expect(fileDisplayName('媒体库/笔记/x.MD')).toBe('x');
        expect(fileDisplayName('媒体库/笔记/x.Mp3')).toBe('x');
    });

    it('无扩展名 ⇒ 原样返回；以点开头的名字 ⇒ 整体保留（⛔ 别切成空串）', () => {
        expect(fileDisplayName('媒体库/笔记/无扩展名')).toBe('无扩展名');
        expect(fileDisplayName('媒体库/笔记/.gitignore')).toBe('.gitignore');
    });

    it('尾随分隔符 / 首尾空白 / 重复斜杠都能容错', () => {
        expect(fileDisplayName('  媒体库//笔记//七里香.md  ')).toBe('七里香');
        expect(fileDisplayName('媒体库/笔记/')).toBe('笔记');
    });

    it('空值 / 非字符串 ⇒ 空串（⛔ 不抛、不回落默认库名 —— 那是 libraryDisplayName 的口径）', () => {
        expect(fileDisplayName('')).toBe('');
        expect(fileDisplayName(null as unknown as string)).toBe('');
        expect(fileDisplayName(undefined as unknown as string)).toBe('');
    });

    it('🔴 反向守卫：显示名**不得**吐出路径分隔符，也不得留下 `.md`', () => {
        const n = fileDisplayName('媒体库/笔记/music/七里香.md');
        expect(n).not.toContain('/');
        expect(n).not.toContain('\\');
        expect(n.endsWith('.md')).toBe(false);
    });
});
