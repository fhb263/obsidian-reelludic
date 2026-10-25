import { describe, expect, it } from 'vitest';
import {
    audioExtOf,
    audioStemOf,
    planAudioRename,
    splitAudioName,
    splitAudioPath,
} from 'pure/renameAudio';
import { DOWNLOAD_NAME_MAX_CHARS } from 'pure/downloadPlan';

describe('splitAudioPath', () => {
    it('库内相对路径（正斜杠）', () => {
        expect(splitAudioPath('下载/音乐/周杰伦 - 晴天.mp3')).toEqual({
            dir: '下载/音乐/',
            name: '周杰伦 - 晴天.mp3',
            sep: '/',
        });
    });

    it('库外绝对路径（反斜杠）—— 分隔符风格照抄，⛔ 不归一', () => {
        expect(splitAudioPath('C:\\Users\\kest\\Music\\a.mp3')).toEqual({
            dir: 'C:\\Users\\kest\\Music\\',
            name: 'a.mp3',
            sep: '\\',
        });
    });

    it('🔴 混用分隔符取**最后**一个（只认一种会让 b.mp3 被当成整段名）', () => {
        expect(splitAudioPath('D:/a\\b.mp3')).toEqual({ dir: 'D:/a\\', name: 'b.mp3', sep: '\\' });
    });

    it('无目录 ⇒ dir 空串、sep 回正斜杠', () => {
        expect(splitAudioPath('a.mp3')).toEqual({ dir: '', name: 'a.mp3', sep: '/' });
    });

    it('目录名里有点不会被误切（`1.0` 这类）', () => {
        expect(splitAudioPath('音乐/1.0/song.mp3').dir).toBe('音乐/1.0/');
    });
});

describe('splitAudioName', () => {
    it('普通名：主名 + 扩展名（含点、**原样大小写**）', () => {
        expect(splitAudioName('a.MP3')).toEqual({ stem: 'a', ext: '.MP3' });
    });

    it('多个点：只认最后一个（`a.b.mp3` ⇒ stem `a.b`）', () => {
        expect(splitAudioName('a.b.mp3')).toEqual({ stem: 'a.b', ext: '.mp3' });
    });

    it('无点 / 以点开头（隐藏名）/ 以点结尾 ⇒ 整体当主名、扩展名空', () => {
        expect(splitAudioName('README')).toEqual({ stem: 'README', ext: '' });
        expect(splitAudioName('.mp3')).toEqual({ stem: '.mp3', ext: '' });
        expect(splitAudioName('a.')).toEqual({ stem: 'a.', ext: '' });
    });
});

describe('planAudioRename —— 成功路径', () => {
    it('库内：只换最后一段，目录与分隔符原样', () => {
        const r = planAudioRename('下载/音乐/周杰伦 - 晴天.mp3', '晴天 - 周杰伦');
        expect('plan' in r && r.plan.to).toBe('下载/音乐/晴天 - 周杰伦.mp3');
        expect('plan' in r && r.plan.fromName).toBe('周杰伦 - 晴天.mp3');
        expect('plan' in r && r.plan.toName).toBe('晴天 - 周杰伦.mp3');
    });

    it('库外绝对：反斜杠风格保留', () => {
        const r = planAudioRename('C:\\M\\a.flac', 'b');
        expect('plan' in r && r.plan.to).toBe('C:\\M\\b.flac');
    });

    it('🔴 同名 .lrc 一起给出目标路径（口径来自 siblingLrcPath，⛔ 不另拼）', () => {
        const r = planAudioRename('下载/音乐/a.mp3', 'b');
        expect('plan' in r && r.plan.lrcFrom).toBe('下载/音乐/a.lrc');
        expect('plan' in r && r.plan.lrcTo).toBe('下载/音乐/b.lrc');
    });

    it('🔴 库外绝对路径的 .lrc 目标同样是绝对路径', () => {
        const r = planAudioRename('C:\\M\\a.m4a', 'b');
        expect('plan' in r && r.plan.lrcTo).toBe('C:\\M\\b.lrc');
    });

    it('🔴 扩展名不变（前后 ext 逐字相同，含大小写）', () => {
        const r = planAudioRename('x/a.MP3', 'b');
        expect('plan' in r && r.plan.toName).toBe('b.MP3');
    });

    it('无扩展名的文件也能改名（不加扩展名）', () => {
        const r = planAudioRename('x/a', 'b');
        expect('plan' in r && r.plan.toName).toBe('b');
    });

    it('主名里的空格与中文、括号、`-`、`、` 都合法且保留', () => {
        const r = planAudioRename('x/a.mp3', ' 周杰伦 - 晴天 (Live)、安可 ');
        expect('plan' in r && r.plan.toName).toBe('周杰伦 - 晴天 (Live)、安可.mp3');
    });

    it('🔴 粘完整文件名：尾部与本文件扩展名**完全相同** ⇒ 自动剥掉（不拼成 .mp3.mp3）', () => {
        const r = planAudioRename('x/a.mp3', 'b.mp3');
        expect('plan' in r && r.plan.toName).toBe('b.mp3');
    });

    it('🔴 剥扩展名大小写无关（`.MP3` 粘进来也认）', () => {
        const r = planAudioRename('x/a.MP3', 'b.mp3');
        expect('plan' in r && r.plan.toName).toBe('b.MP3');
    });

    it('⚠️ 尾部是**别的**扩展名不剥（`b.wav` 就是主名 `b.wav`）', () => {
        const r = planAudioRename('x/a.mp3', 'b.wav');
        expect('plan' in r && r.plan.toName).toBe('b.wav.mp3');
    });

    it('只有主名恰好等于现主名才算「没变」（剥完扩展名后再比）', () => {
        expect('plan' in planAudioRename('x/old.mp3', 'a')).toBe(true);
        expect('issue' in planAudioRename('x/a.mp3', 'a.mp3')).toBe(true);
    });
});

describe('planAudioRename —— 拒绝路径（每条都给出面向用户的原因）', () => {
    it('未关联：不是「失败」，而是「先去关联」', () => {
        const r = planAudioRename('', 'b');
        expect('issue' in r && r.issue).toContain('还没有关联');
    });

    it('空 / 只有空白', () => {
        expect('issue' in planAudioRename('x/a.mp3', '   ')).toBe(true);
    });

    it('非法字符（逐个）', () => {
        for (const ch of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
            const r = planAudioRename('x/a.mp3', `b${ch}c`);
            expect('issue' in r, ch).toBe(true);
        }
    });

    it('控制字符（\\x00-\\x1f / \\x7f）', () => {
        expect('issue' in planAudioRename('x/a.mp3', 'b\u0000c')).toBe(true);
        expect('issue' in planAudioRename('x/a.mp3', 'b\u007fc')).toBe(true);
    });

    it('🔴 首尾的**点**拒绝（系统会静默吃掉 ⇒ 界面说 A、盘上是 B）；首尾**空格**只是 trim', () => {
        expect('issue' in planAudioRename('x/a.mp3', '.b')).toBe(true);
        expect('issue' in planAudioRename('x/a.mp3', 'b.')).toBe(true);
        // 空格不算错：` b ` → `b` 正常改名（trim 后与现主名不同）
        const r = planAudioRename('x/a.mp3', ' b ');
        expect('plan' in r && r.plan.toName).toBe('b.mp3');
    });

    it('超长（= 下载名单段上限，⛔ 不另定一个数）', () => {
        const ok = 'x'.repeat(DOWNLOAD_NAME_MAX_CHARS);
        expect('plan' in planAudioRename('x/a.mp3', ok)).toBe(true);
        expect('issue' in planAudioRename('x/a.mp3', ok + 'x')).toBe(true);
    });

    it('没有变化', () => {
        const r = planAudioRename('x/a.mp3', 'a');
        expect('issue' in r && r.issue).toContain('没有变化');
    });

    it('路径末尾是分隔符（没有文件名）', () => {
        const r = planAudioRename('x/', 'b');
        expect('issue' in r && r.issue).toContain('没有文件名');
    });

    it('🔴 拒绝时**不返回 plan**（调用方拿不到半成品路径）', () => {
        const r = planAudioRename('x/a.mp3', 'b/c');
        expect('plan' in r).toBe(false);
    });
});

describe('audioStemOf / audioExtOf（组件渲染入口，取主名与扩展名只有这一处）', () => {
    it('库内路径', () => {
        expect(audioStemOf('下载/音乐/周杰伦 - 晴天.mp3')).toBe('周杰伦 - 晴天');
        expect(audioExtOf('下载/音乐/周杰伦 - 晴天.mp3')).toBe('.mp3');
    });

    it('库外路径 + 大小写保留', () => {
        expect(audioStemOf('C:\\M\\a.MP3')).toBe('a');
        expect(audioExtOf('C:\\M\\a.MP3')).toBe('.MP3');
    });

    it('空路径 / 无扩展名', () => {
        expect(audioStemOf('')).toBe('');
        expect(audioExtOf('')).toBe('');
        expect(audioExtOf('x/a')).toBe('');
    });
});
