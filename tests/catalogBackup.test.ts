import { describe, it, expect } from 'vitest';
import {
    BACKUP_FILE,
    BACKUP_KEEP,
    BACKUP_SCHEMA,
    backupStamp,
    countEntries,
    emptyBackupFile,
    legacyBackupStamp,
    legacyStampToAt,
    parseBackupFile,
    pushSnapshot,
    serializeBackupFile,
    sortLegacyBackupNames,
} from 'pure/catalogBackup';

const snap = (at: string, text: string, entries = 0) => ({ at, entries, text });

describe('catalogBackup · 单文件形态', () => {
    it('备份文件名与保留版数：单文件、仍保 5 版（语义不变，只是文件数 5 → 1）', () => {
        expect(BACKUP_FILE).toBe('catalog-backups.json');
        expect(BACKUP_KEEP).toBe(5);
        expect(BACKUP_SCHEMA).toBe(1);
    });
});

describe('catalogBackup · backupStamp', () => {
    it('本地时间 YYYY-MM-DD HH:mm:ss（不用 UTC：用户按时间认档会差 8 小时）', () => {
        expect(backupStamp(new Date(2026, 0, 5, 3, 7, 9))).toBe('2026-01-05 03:07:09');
        expect(backupStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59:59');
    });
});

describe('catalogBackup · 解析与序列化', () => {
    it('空 / 脏 / 结构不符 → 空备份（备份文件坏掉不该阻断主流程）', () => {
        for (const bad of [null, undefined, '', '   ', 'not json', '[]', '{"snapshots":"x"}', '{}']) {
            const bf = parseBackupFile(bad as string | null | undefined);
            expect(bf.snapshots).toEqual([]);
            expect(bf.schema).toBe(BACKUP_SCHEMA);
        }
    });
    it('逐条校验：单条脏快照被丢掉，其余照留', () => {
        const text = JSON.stringify({
            schema: 1,
            snapshots: [snap('2026-01-01 00:00:00', 'A'), { at: 'x' }, null, 42, snap('2026-01-02 00:00:00', 'B')],
        });
        const bf = parseBackupFile(text);
        expect(bf.snapshots.map((s) => s.text)).toEqual(['A', 'B']);
    });
    it('缺 entries 字段 → 记 -1（仅展示用，不影响逻辑）', () => {
        const bf = parseBackupFile(JSON.stringify({ schema: 1, snapshots: [{ at: 'a', text: 'X' }] }));
        expect(bf.snapshots[0].entries).toBe(-1);
    });
    it('序列化 → 解析 round-trip 保内容', () => {
        const bf = { schema: BACKUP_SCHEMA, hint: 'h', snapshots: [snap('2026-09-14 22:15:30', '{"a":1}', 1)] };
        const back = parseBackupFile(serializeBackupFile(bf));
        expect(back.snapshots).toHaveLength(1);
        expect(back.snapshots[0].text).toBe('{"a":1}');
        expect(back.snapshots[0].at).toBe('2026-09-14 22:15:30');
        expect(back.snapshots[0].entries).toBe(1);
    });
    it('序列化写出人类可读的多行 JSON 与自说明 hint', () => {
        const text = serializeBackupFile(emptyBackupFile());
        expect(text).toContain('\n');
        expect(text).toContain('snapshots');
        expect(JSON.parse(text).hint).toContain('还原');
    });
});

describe('catalogBackup · pushSnapshot', () => {
    it('新的在前，并按 keep 截断最旧', () => {
        let bf = emptyBackupFile();
        for (let i = 1; i <= 7; i++) bf = pushSnapshot(bf, snap(`2026-01-0${i} 00:00:00`, `T${i}`));
        expect(bf.snapshots).toHaveLength(BACKUP_KEEP);
        expect(bf.snapshots.map((s) => s.text)).toEqual(['T7', 'T6', 'T5', 'T4', 'T3']);
    });
    it('与最新一版内容完全相同 → 原样返回入参（引用相等，调用方据此跳过写盘）', () => {
        const first = pushSnapshot(emptyBackupFile(), snap('2026-01-01 00:00:00', 'SAME'));
        const again = pushSnapshot(first, snap('2026-01-02 00:00:00', 'SAME'));
        expect(again).toBe(first);
    });
    it('内容相同但并非最新一版（回退到旧内容）→ 仍作为新一版记录', () => {
        let bf = pushSnapshot(emptyBackupFile(), snap('t1', 'A'));
        bf = pushSnapshot(bf, snap('t2', 'B'));
        bf = pushSnapshot(bf, snap('t3', 'A'));
        expect(bf.snapshots.map((s) => s.text)).toEqual(['A', 'B', 'A']);
    });
    it('keep ≤ 0 兜底为 1（防「轮转把备份清空」自毁）', () => {
        let bf = emptyBackupFile();
        for (let i = 1; i <= 3; i++) bf = pushSnapshot(bf, snap(`t${i}`, `T${i}`), 0);
        expect(bf.snapshots.map((s) => s.text)).toEqual(['T3']);
        let bf2 = emptyBackupFile();
        for (let i = 1; i <= 3; i++) bf2 = pushSnapshot(bf2, snap(`t${i}`, `T${i}`), -5);
        expect(bf2.snapshots).toHaveLength(1);
    });
    it('不修改入参（纯函数）', () => {
        const src = emptyBackupFile();
        pushSnapshot(src, snap('t', 'X'));
        expect(src.snapshots).toEqual([]);
    });
});

describe('catalogBackup · countEntries', () => {
    it('统计 entries 条数', () => {
        expect(countEntries('{"version":1,"entries":[{"id":"a"},{"id":"b"}]}')).toBe(2);
        expect(countEntries('{"version":1,"entries":[]}')).toBe(0);
    });
    it('解析不出 / 无 entries → -1（不假装 0 条）', () => {
        expect(countEntries('not json')).toBe(-1);
        expect(countEntries('{"version":1}')).toBe(-1);
    });
});

describe('catalogBackup · 旧多文件备份兼容', () => {
    it('旧命名识别：catalog-YYYYMMDD-HHmmss.json', () => {
        expect(legacyBackupStamp('catalog-20260914-201530.json')).toBe('20260914201530');
        expect(legacyBackupStamp('catalog-backups.json')).toBeNull();
        expect(legacyBackupStamp('随便.json')).toBeNull();
        expect(legacyBackupStamp('catalog-2026-09-14.json')).toBeNull();
    });
    it('旧文件名 → 可读时间（导入后作为快照 at）', () => {
        expect(legacyStampToAt('catalog-20260914-201530.json')).toBe('2026-09-14 20:15:30');
        expect(legacyStampToAt('随便.json')).toBe('');
    });
    it('按时间升序排序（旧 → 新），非规范名排最后且不参与判别', () => {
        expect(
            sortLegacyBackupNames(['catalog-20260914-090000.json', 'x.txt', 'catalog-20260914-090100.json']),
        ).toEqual(['catalog-20260914-090000.json', 'catalog-20260914-090100.json', 'x.txt']);
    });
});
