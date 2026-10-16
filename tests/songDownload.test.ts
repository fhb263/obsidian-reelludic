import { describe, it, expect } from 'vitest';
import {
    MIN_AUDIO_BYTES,
    audioBytesIssue,
    isNeteaseDownloadable,
    neteaseOuterUrl,
    neteaseSongPageUrl,
    sniffAudioExt,
    songDownloadFilename,
} from 'pure/songDownload';

/** 造一段「像音频」的字节：头部按魔数写，其余补零到指定长度 */
function fakeAudio(magic: number[], size = MIN_AUDIO_BYTES + 1): Uint8Array {
    const b = new Uint8Array(size);
    magic.forEach((v, i) => (b[i] = v));
    return b;
}

function bytesOf(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe('neteaseOuterUrl', () => {
    it('拼出免密外链（数字 / 字符串 id 等价）', () => {
        expect(neteaseOuterUrl(347230)).toBe('https://music.163.com/song/media/outer/url?id=347230.mp3');
        expect(neteaseOuterUrl('347230')).toBe(neteaseOuterUrl(347230));
    });

    it('🔴 反例守卫：外链里**不得**出现 weapi/eapi 那套加密参数（这正是「免费通道」的定义）', () => {
        const url = neteaseOuterUrl(1);
        expect(url.includes('params=')).toBe(false);
        expect(url.includes('encSecKey')).toBe(false);
        expect(url.includes('/weapi/')).toBe(false);
        expect(url.includes('/eapi/')).toBe(false);
    });
});

describe('neteaseSongPageUrl', () => {
    it('拼歌曲网页地址；空 id 返回空串（⛔ 不给一个指向 id= 的半截链接）', () => {
        expect(neteaseSongPageUrl(1)).toBe('https://music.163.com/#/song?id=1');
        expect(neteaseSongPageUrl('')).toBe('');
        expect(neteaseSongPageUrl('   ')).toBe('');
    });
});

describe('isNeteaseDownloadable', () => {
    it('fee=0 可下载；fee 缺失（undefined/null）也按可下载处理', () => {
        expect(isNeteaseDownloadable(0)).toBe(true);
        expect(isNeteaseDownloadable(undefined)).toBe(true);
        expect(isNeteaseDownloadable(null)).toBe(true);
    });

    it('🔴 fee≠0 一律不可下载（实测 1 与 8 都 302 到 /404）', () => {
        expect(isNeteaseDownloadable(1)).toBe(false);
        expect(isNeteaseDownloadable(8)).toBe(false);
    });

    it('🔴 反例守卫：0 与 1 必须给出不同结论，否则这条判据等于没写', () => {
        expect(isNeteaseDownloadable(0)).not.toBe(isNeteaseDownloadable(1));
    });
});

describe('sniffAudioExt', () => {
    it('识别各家魔数', () => {
        expect(sniffAudioExt(fakeAudio([0x66, 0x4c, 0x61, 0x43]))).toBe('flac'); // fLaC
        expect(sniffAudioExt(fakeAudio([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]))).toBe('m4a'); // ....ftyp
        expect(sniffAudioExt(fakeAudio([0x4f, 0x67, 0x67, 0x53]))).toBe('ogg'); // OggS
        expect(sniffAudioExt(fakeAudio([0x49, 0x44, 0x33]))).toBe('mp3'); // ID3
        expect(sniffAudioExt(fakeAudio([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3'); // 裸帧同步
    });

    it('WAV 需要同时命中 RIFF 与 WAVE 两段（只判前半会误伤别的 RIFF 容器）', () => {
        const wav = fakeAudio([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
        expect(sniffAudioExt(wav)).toBe('wav');
        const riffOnly = fakeAudio([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]);
        expect(sniffAudioExt(riffOnly)).toBeNull();
    });

    it('🔴 认不出来一律 null —— 这正是「302 到 /404 的 HTML 页」被拦下的地方', () => {
        expect(sniffAudioExt(bytesOf('<!DOCTYPE html><html>404</html>'))).toBeNull();
        expect(sniffAudioExt(bytesOf(''))).toBeNull();
        expect(sniffAudioExt(fakeAudio([0x4f, 0x67]))).toBeNull(); // 太短
    });
});

describe('audioBytesIssue', () => {
    it('够大且魔数可识别 ⇒ 没问题', () => {
        expect(audioBytesIssue(fakeAudio([0x49, 0x44, 0x33]))).toBeNull();
    });

    it('字节数不足（受限 / 接口变更）报「过小」', () => {
        const tiny = fakeAudio([0x49, 0x44, 0x33], MIN_AUDIO_BYTES - 1);
        expect(audioBytesIssue(tiny)).toContain('过小');
    });

    it('够大但魔数不识别（拿到错误页）报「不是音频」', () => {
        const html = new Uint8Array(MIN_AUDIO_BYTES + 10);
        html.set(bytesOf('<!DOCTYPE html>'));
        expect(audioBytesIssue(html)).toContain('不是音频');
    });

    it('两个条件同时不满足时先报「过小」（大小是最便宜的判据，先判省一次嗅探）', () => {
        const tinyHtml = bytesOf('<!DOCTYPE html>');
        expect(audioBytesIssue(tinyHtml)).toContain('过小');
    });
});

describe('songDownloadFilename', () => {
    it('多歌手用顿号连接：`歌手1、歌手2 - 歌名.ext`', () => {
        expect(songDownloadFilename(['A', 'B'], '歌名', 'mp3')).toBe('A、B - 歌名.mp3');
        expect(songDownloadFilename('A', '歌名', 'mp3')).toBe('A - 歌名.mp3');
    });

    it('缺歌手只留歌名；缺歌名只留歌手', () => {
        expect(songDownloadFilename([], '歌名', 'mp3')).toBe('歌名.mp3');
        expect(songDownloadFilename(undefined, '歌名', 'mp3')).toBe('歌名.mp3');
        expect(songDownloadFilename(['A'], '', 'mp3')).toBe('A.mp3');
    });

    it('两者都缺 ⇒ 回退「未命名」（⛔ 不产出以点开头的 `.mp3`）', () => {
        expect(songDownloadFilename([], '', 'mp3')).toBe('未命名.mp3');
    });

    it('扩展名大小写 / 前导点无关，缺省 mp3', () => {
        expect(songDownloadFilename(['A'], 'x', '.FLAC')).toBe('A - x.flac');
        expect(songDownloadFilename(['A'], 'x', '')).toBe('A - x.mp3');
    });

    it('🔴 歌名里的 Windows 非法字符走净化（`A/B`、`什么？` 是常态）', () => {
        expect(songDownloadFilename(['A'], 'A/B', 'mp3')).toBe('A - A_B.mp3');
        expect(songDownloadFilename(['A'], '什么？', 'mp3')).toBe('A - 什么？.mp3');
        expect(songDownloadFilename(['A:B'], 'x', 'mp3')).toBe('A_B - x.mp3');
    });
});
