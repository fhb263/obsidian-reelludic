/**
 * `pure/bookDownload` 单测 —— **#422 续四 之后这个模块只剩 `bookStem` 一个函数**。
 *
 * 🔴 直链通道（归一链接 / 判格式 / 合成文件名 / 字节防伪 / 失败归因）已随用户裁定整体删除，
 *    它那一批用例（原 169 行）随之退场；这里保留的是**还在用**的那一个函数：
 *    `bookStem` = 「书名 - 作者」的唯一定义处，`pure/novelPack`（书源成品文件名）与
 *    `pure/libraryBooks.splitBookStem`（库内找回）都按它对齐，⚠️ 与音频的「艺人 - 歌名」**顺序相反**。
 */
import { describe, expect, it } from 'vitest';
import { bookStem } from 'pure/bookDownload';

describe('bookStem · 书名基名', () => {
    it('书名 + 作者 ⇒ 「书名 - 作者」（首尾空白各自 trim）', () => {
        expect(bookStem(' 红楼梦 ', ' 曹雪芹 ')).toBe('红楼梦 - 曹雪芹');
    });

    it('缺作者只留书名；缺书名只留作者；两者都缺 ⇒ 空串（由净化层回落「未命名」）', () => {
        expect(bookStem('红楼梦', '')).toBe('红楼梦');
        expect(bookStem('', '曹雪芹')).toBe('曹雪芹');
        expect(bookStem('', '')).toBe('');
        expect(bookStem('  ', undefined)).toBe('');
    });

    it('🔴 顺序是「书名在前、作者在后」（⛔ 与音频的「艺人 - 歌名」相反，别照抄）', () => {
        expect(bookStem('三体', '刘慈欣')).toBe('三体 - 刘慈欣');
        expect(bookStem('三体', '刘慈欣')).not.toBe('刘慈欣 - 三体');
    });

    it('宽容类型：undefined / 非字符串都能吃（数据来自表单与 catalog，字段可能缺）', () => {
        expect(bookStem('三体', undefined)).toBe('三体');
        expect(bookStem(undefined as unknown as string, '刘慈欣')).toBe('刘慈欣');
    });
});
