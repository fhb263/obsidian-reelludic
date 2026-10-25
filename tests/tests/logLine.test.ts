import { describe, it, expect } from 'vitest';
import { datedRecordLine, commentRecordBlock } from 'pure/logLine';

// 🔴 用户 m00002：「条目卡片右键菜单的添加短评/记录重温/记录时长都给我加上时间前缀，预览效果」
//   ⇒ 每条落进笔记的记录都带 `- **日期** · ` 前缀，且弹窗预览与真实写入用**同一个模板**（本模块）。
describe('pure/logLine 记录行格式', () => {
    describe('datedRecordLine', () => {
        it('基础形态：日期加粗 + 分隔点 + 正文', () => {
            expect(datedRecordLine('2026-10-22', '第 1 次重刷')).toBe('- **2026-10-22** · 第 1 次重刷');
        });

        it('带备注时追加 · 备注', () => {
            expect(datedRecordLine('2026-10-22', '第 2 次重刷', '太好看了')).toBe(
                '- **2026-10-22** · 第 2 次重刷 · 太好看了',
            );
        });

        it('备注为空白串 / undefined ⇒ 不产出尾部分隔符', () => {
            expect(datedRecordLine('2026-10-22', '1 小时 30 分', '   ')).toBe('- **2026-10-22** · 1 小时 30 分');
            expect(datedRecordLine('2026-10-22', '1 小时 30 分')).toBe('- **2026-10-22** · 1 小时 30 分');
        });

        it('日期与备注两端空白剔除', () => {
            expect(datedRecordLine(' 2026-10-22 ', ' 第 3 周目 ', ' 爽 ')).toBe('- **2026-10-22** · 第 3 周目 · 爽');
        });
    });

    describe('commentRecordBlock', () => {
        it('单行短评 ⇒ 一行带日期前缀的列表项', () => {
            expect(commentRecordBlock('2026-10-22', '写得真好')).toBe('- **2026-10-22** · 写得真好');
        });

        it('多行短评：首行挂前缀，其余行缩进两格保持列表归属', () => {
            expect(commentRecordBlock('2026-10-22', '第一行\n第二行\n第三行')).toBe(
                '- **2026-10-22** · 第一行\n  第二行\n  第三行',
            );
        });

        it('多行短评中的空行保持空（不缩进成两个空格的行）', () => {
            expect(commentRecordBlock('2026-10-22', '第一段\n\n第二段')).toBe(
                '- **2026-10-22** · 第一段\n\n  第二段',
            );
        });
    });
});
