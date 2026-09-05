import { describe, it, expect } from 'vitest';
import { toFileUrl } from 'pure/mediaFileUrl';

describe('pure/mediaFileUrl 本地绝对路径 → file:// URL（Media Extended openUrl 输入格式）', () => {
    it('Windows 盘符路径：反斜杠转正斜杠，中文百分号编码，file:/// 三斜杠规范', () => {
        expect(toFileUrl('D:\\Movies\\千与千寻.mp4')).toBe('file:///D:/Movies/%E5%8D%83%E4%B8%8E%E5%8D%83%E5%AF%BB.mp4');
    });

    it('空格编码为 %20', () => {
        expect(toFileUrl('C:\\My Videos\\a b.mp4')).toBe('file:///C:/My%20Videos/a%20b.mp4');
    });

    it('正斜杠输入原样保留', () => {
        expect(toFileUrl('D:/Movies/x.mp4')).toBe('file:///D:/Movies/x.mp4');
    });

    it('文件名含 # / ?（URL fragment 分隔符）显式编码，防 URL 截断', () => {
        expect(toFileUrl('E:\\动漫\\海贼王 S01E01 #1?.mkv')).toBe('file:///E:/%E5%8A%A8%E6%BC%AB/%E6%B5%B7%E8%B4%BC%E7%8E%8B%20S01E01%20%231%3F.mkv');
    });

    it('前导斜杠剥离（避免 file://// 空 host）', () => {
        expect(toFileUrl('/D:/Movies/x.mp4')).toBe('file:///D:/Movies/x.mp4');
    });

    it('空路径返回 file:/// 前缀（调用方兜底）', () => {
        expect(toFileUrl('')).toBe('file:///');
    });
});
