import { describe, it, expect } from 'vitest';
import { downloadToVault, type DownloadHttpGet, type DownloadStore } from 'services/downloader';
import { DOWNLOAD_MAX_BYTES } from 'pure/downloadPlan';

/** 够大、且魔数为 MP3 的字节 */
function audio(size = 1024): Uint8Array {
    const b = new Uint8Array(size);
    b[0] = 0x49; // 'I'
    b[1] = 0x44; // 'D'
    b[2] = 0x33; // '3'
    return b;
}

function fakeHttp(res: { status: number; buffer: Uint8Array } | Error, onCall?: (url: string, headers?: Record<string, string>) => void): DownloadHttpGet {
    return async (url, headers) => {
        onCall?.(url, headers);
        if (res instanceof Error) throw res;
        return res;
    };
}

function fakeStore(fail?: Error) {
    const written: { relPath: string; size: number }[] = [];
    const store: DownloadStore = {
        async write(relPath, data) {
            if (fail) throw fail;
            written.push({ relPath, size: data.byteLength });
        },
    };
    return { store, written };
}

describe('downloadToVault · 成功路径', () => {
    it('下载 + 落盘 + 回报库内相对路径与字节数', async () => {
        const { store, written } = fakeStore();
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: audio(2048) }), store, {
            url: 'https://x/a.mp3',
            kind: 'music',
            filename: 'A - 歌名.mp3',
        });
        expect(r).toEqual({ ok: true, relPath: '下载/音乐/A - 歌名.mp3', bytes: 2048 });
        expect(written).toEqual([{ relPath: '下载/音乐/A - 歌名.mp3', size: 2048 }]);
    });

    it('自定义目录与库内重名去重（#459：root = 目录本身，⛔ 不再套一层「音乐」）', async () => {
        const { store } = fakeStore();
        const taken = new Set(['我的库/下载/A - 歌名.mp3']);
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: audio() }), store, {
            url: 'u',
            kind: 'music',
            filename: 'A - 歌名.mp3',
            root: '我的库/下载',
            taken,
        });
        expect(r.relPath).toBe('我的库/下载/A - 歌名 (2).mp3');
    });

    it('请求头原样透传（Referer 这类缺了会被站点拒绝）', async () => {
        const { store } = fakeStore();
        let seen: Record<string, string> | undefined;
        await downloadToVault(fakeHttp({ status: 200, buffer: audio() }, (_u, h) => (seen = h)), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
            headers: { Referer: 'https://music.163.com' },
        });
        expect(seen).toEqual({ Referer: 'https://music.163.com' });
    });
});

describe('downloadToVault · 失败路径', () => {
    it('🔴 字符串文件名扩展名不合规 ⇒ **一个请求都不发**（别先下 80 MB 再说「不支持」）', async () => {
        const { store, written } = fakeStore();
        let calls = 0;
        const http = fakeHttp({ status: 200, buffer: audio() }, () => (calls += 1));
        const r = await downloadToVault(http, store, { url: 'u', kind: 'music', filename: 'evil.exe' });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('不支持的格式');
        expect(calls).toBe(0);
        expect(written).toHaveLength(0);
    });

    it('非 2xx ⇒ 失败且带状态码（403 的正文常是 HTML 错误页，交给解析只会静默空）', async () => {
        const { store, written } = fakeStore();
        const r = await downloadToVault(fakeHttp({ status: 403, buffer: audio() }), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('403');
        expect(written).toHaveLength(0);
    });

    it('http 抛错（超时 / 网络）⇒ 收敛成可读原因，⛔ 不抛给调用方', async () => {
        const { store } = fakeStore();
        const r = await downloadToVault(fakeHttp(new Error('Request timed out after 30000ms')), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('timed out');
    });

    it('超过大小上限 ⇒ 失败且不写盘', async () => {
        const { store, written } = fakeStore();
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: audio(DOWNLOAD_MAX_BYTES + 1) }), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('上限');
        expect(written).toHaveLength(0);
    });

    it('内容校验不通过 ⇒ 失败且不写盘（音频侧用它拦「302 到 /404 的 HTML 页」）', async () => {
        const { store, written } = fakeStore();
        const html = new Uint8Array(2048); // 魔数不识别
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: html }), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
            validate: (b) => (b[0] === 0x49 ? null : '返回内容不是音频（疑似错误页）'),
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('不是音频');
        expect(written).toHaveLength(0);
    });

    it('写入抛错 ⇒ 失败（⛔ 不谎报成功）', async () => {
        const { store } = fakeStore(new Error('EEXIST'));
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: audio() }), store, {
            url: 'u',
            kind: 'music',
            filename: 'a.mp3',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('EEXIST');
    });
});

describe('downloadToVault · 回调文件名', () => {
    it('按真实字节定扩展名（外链 URL 恒写 .mp3，内容未必是 mp3）', async () => {
        const { store, written } = fakeStore();
        const b = new Uint8Array(2048);
        b[0] = 0x66;
        b[1] = 0x4c;
        b[2] = 0x61;
        b[3] = 0x43; // 'fLaC'
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: b }), store, {
            url: 'u',
            kind: 'music',
            filename: (bytes) => `A - 歌名.${bytes[0] === 0x66 ? 'flac' : 'mp3'}`,
        });
        expect(r.relPath).toBe('下载/音乐/A - 歌名.flac');
        expect(written[0].relPath).toBe('下载/音乐/A - 歌名.flac');
    });

    it('🔴 回调产出的扩展名**照样受白名单约束**（回调结果成型晚，必须再判一次）', async () => {
        const { store, written } = fakeStore();
        const r = await downloadToVault(fakeHttp({ status: 200, buffer: audio() }), store, {
            url: 'u',
            kind: 'music',
            filename: () => 'a.exe',
        });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('不支持的格式');
        expect(written).toHaveLength(0);
    });
});
