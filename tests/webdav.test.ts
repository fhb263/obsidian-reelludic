import { describe, expect, it } from 'vitest';
import {
    isDirectPlayableVideoUrl,
    parseDavList,
    normalizeDavBase,
    davAuthHeader,
    formatDavSize,
} from 'pure/webdav';

describe('normalizeDavBase', () => {
    it('补协议、补尾斜杠', () => {
        expect(normalizeDavBase('pan.example.com/dav')).toBe('https://pan.example.com/dav/');
    });

    it('// 开头补 https:', () => {
        expect(normalizeDavBase('//pan.example.com/dav/')).toBe('https://pan.example.com/dav/');
    });

    it('清 query 与 hash', () => {
        expect(normalizeDavBase('http://h:5244/dav/?a=1#x')).toBe('http://h:5244/dav/');
    });

    it('非 http(s) 一律空串', () => {
        expect(normalizeDavBase('ftp://h/dav/')).toBe('');
        expect(normalizeDavBase('')).toBe('');
        expect(normalizeDavBase(undefined)).toBe('');
        expect(normalizeDavBase(123)).toBe('');
    });
});

describe('davAuthHeader', () => {
    it('普通账号密码', () => {
        expect(davAuthHeader('u', 'p')).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    });

    it('中文密码不能抛（btoa 会炸，这里必须活着）', () => {
        const h = davAuthHeader('用户', '密码');
        expect(h.startsWith('Basic ')).toBe(true);
        expect(Buffer.from(h.slice(6), 'base64').toString('utf8')).toBe('用户:密码');
    });

    it('两个都空 ⇒ 空串（匿名访问不带 Authorization 头）', () => {
        expect(davAuthHeader('', '')).toBe('');
        expect(davAuthHeader(undefined, undefined)).toBe('');
    });
});

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/%E5%8A%A8%E7%94%BB/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/%E7%AC%AC2%E9%9B%86.mp4</D:href>
    <D:propstat><D:prop>
      <D:getcontentlength>1048576</D:getcontentlength>
      <D:getcontenttype>video/mp4</D:getcontenttype>
    </D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

describe('parseDavList', () => {
    it('解析出条目、目录在前、丢掉自引用', () => {
        const list = parseDavList(SAMPLE, 'https://h/dav/');
        expect(list.map((e) => e.name)).toEqual(['动画', '第2集.mp4']);
        expect(list[0].isDir).toBe(true);
        expect(list[1].isDir).toBe(false);
        expect(list[1].size).toBe(1048576);
        expect(list[1].mime).toBe('video/mp4');
    });

    it('href 做百分号解码 + 拼成绝对地址', () => {
        const list = parseDavList(SAMPLE, 'https://h/dav/');
        expect(list[1].name).toBe('第2集.mp4');
        expect(list[1].url).toBe('https://h/dav/%E7%AC%AC2%E9%9B%86.mp4');
    });

    it('容忍无前缀的裸标签（部分服务器不写 D:）', () => {
        const bare = `<multistatus><response><href>/dav/a.mp4</href>
            <propstat><prop><getcontentlength>12</getcontentlength></prop></propstat></response></multistatus>`;
        const list = parseDavList(bare, 'https://h/dav/');
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('a.mp4');
        expect(list[0].size).toBe(12);
    });

    it('坏输入不抛', () => {
        expect(parseDavList('', 'https://h/dav/')).toEqual([]);
        expect(parseDavList(null, 'https://h/dav/')).toEqual([]);
        expect(parseDavList('<a/>', '')).toEqual([]);
    });
});

describe('parseDavList · 服务器方言兼容', () => {
    it('小写 d: 前缀（Nextcloud 风格）', () => {
        const xml = `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response>
            <d:href>/dav/a.mp4</d:href>
            <d:propstat><d:prop><d:getcontentlength>99</d:getcontentlength></d:prop>
              <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
          </d:response>
        </d:multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/');
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('a.mp4');
        expect(list[0].size).toBe(99);
    });

    it('propstat 404 段里的占位值不能被当成真实属性', () => {
        // 真实响应长这样：200 段给 size，404 段给「我不支持 displayname」的占位 0
        const xml = `<D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>/dav/%E7%AC%AC1%E9%9B%86.mkv</D:href>
            <D:propstat>
              <D:prop><D:resourcetype/><D:getcontentlength>1048576</D:getcontentlength>
                <D:getcontenttype>video/x-matroska</D:getcontenttype></D:prop>
              <D:status>HTTP/1.1 200 OK</D:status>
            </D:propstat>
            <D:propstat>
              <D:prop><D:displayname/></D:prop>
              <D:status>HTTP/1.1 404 Not Found</D:status>
            </D:propstat>
          </D:response>
        </D:multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/');
        expect(list).toHaveLength(1);
        expect(list[0].size).toBe(1048576);
        expect(list[0].mime).toBe('video/x-matroska');
        // 404 段没有 displayname 实体 ⇒ 退回 href 末段，⛔ 不能变成空名字
        expect(list[0].name).toBe('第1集.mkv');
    });

    it('displayname 优先于 href 末段（群晖 href 是内部名）', () => {
        const xml = `<D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>/dav/@eaDir/9f8a-2b1c</D:href>
            <D:propstat><D:prop>
              <D:displayname>真正的名字.mp4</D:displayname>
              <D:getcontentlength>7</D:getcontentlength>
            </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
          </D:response>
        </D:multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/');
        expect(list[0].name).toBe('真正的名字.mp4');
        // href / url 仍保留服务器给的原值 —— 拼直链靠它，⛔ 不要用 displayname 替换
        expect(list[0].href).toBe('/dav/@eaDir/9f8a-2b1c');
    });

    it('自引用按解码后的路径判定：编码差异 / 尾斜杠不同也要认出是「自己」', () => {
        // base 是中文原文，服务器回的 href 是百分号编码 + 无尾斜杠
        const xml = `<D:multistatus xmlns:D="DAV:">
          <D:response>
            <D:href>/dav/%E5%8A%A8%E7%94%BB</D:href>
            <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
          </D:response>
          <D:response>
            <D:href>/dav/%E5%8A%A8%E7%94%BB/%E7%AC%AC1%E9%9B%86.mp4</D:href>
            <D:propstat><D:prop><D:getcontentlength>5</D:getcontentlength></D:prop></D:propstat>
          </D:response>
        </D:multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/动画/');
        // 只应剩下那一个文件，「动画」目录自身被丢掉
        expect(list.map((e) => e.name)).toEqual(['第1集.mp4']);
    });

    it('空标签 getcontentlength 不炸', () => {
        const xml = `<D:multistatus xmlns:D="DAV:"><D:response>
          <D:href>/dav/a.mp4</D:href>
          <D:propstat><D:prop><D:getcontentlength/></D:prop></D:propstat>
        </D:response></D:multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/');
        expect(list[0].size).toBe(0);
    });

    it('缺 status 字段的老服务器：按成功处理，⛔ 不能整段丢弃', () => {
        const xml = `<multistatus xmlns="DAV:"><response>
          <href>/dav/old.mp4</href>
          <propstat><prop><getcontentlength>42</getcontentlength></prop></propstat>
        </response></multistatus>`;
        const list = parseDavList(xml, 'https://h/dav/');
        expect(list).toHaveLength(1);
        expect(list[0].size).toBe(42);
    });
});

describe('isDirectPlayableVideoUrl', () => {
    it('mp4/webm 直链可内置', () => {
        expect(isDirectPlayableVideoUrl('https://h/a.mp4')).toBe(true);
        expect(isDirectPlayableVideoUrl('https://h/a.webm')).toBe(true);
    });

    it('查询串不影响判定', () => {
        expect(isDirectPlayableVideoUrl('https://h/a.mp4?token=x')).toBe(true);
    });

    it('mkv 不可内置（Chromium 解不了）', () => {
        expect(isDirectPlayableVideoUrl('https://h/a.mkv')).toBe(false);
    });

    it('非 http(s) 一律不可', () => {
        expect(isDirectPlayableVideoUrl('file:///a.mp4')).toBe(false);
        expect(isDirectPlayableVideoUrl('/local/a.mp4')).toBe(false);
        expect(isDirectPlayableVideoUrl('')).toBe(false);
    });
});

describe('formatDavSize', () => {
    it('分级', () => {
        expect(formatDavSize(0)).toBe('');
        expect(formatDavSize(512)).toBe('512 B');
        expect(formatDavSize(1024 * 1024)).toContain('MB');
    });
});
