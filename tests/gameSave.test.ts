/**
 * ① 存档导出备份格式（`src/pure/gameSave.ts`）。
 *
 * 用户逐字：「存档是导出备份，**需通过导入功能恢复**」——所以这里钉的是**回环**：
 * 导出的文件必须能被导入解析回一模一样的存档表；反过来，任何「不是本插件存档」的
 * 文件都要被明确拒绝并给出人话原因（否则误导入会静默清空进度）。
 */
import { describe, expect, it } from 'vitest';
import {
    GAME_SAVE_BUNDLE_KIND,
    GAME_SAVE_BUNDLE_VERSION,
    GAME_SAVE_ENTRY_MAX,
    buildSaveBundle,
    cleanGameSaves,
    parseSaveBundle,
    saveBundleFileName,
} from '../src/pure/gameSave';

const SAVES = {
    'goldminer.sol': 'TCSOA=AAAA',
    'settings.sol': 'TCSOB=BBBB',
};

describe('gameSave · 存档表清洗', () => {
    it('只留非空字符串键值', () => {
        const out = cleanGameSaves({ a: 'x', b: '', c: 1, '': 'y', d: null });
        expect(out).toEqual({ a: 'x' });
    });

    it('非对象入参给空表（⛔ 不抛）', () => {
        expect(cleanGameSaves(null)).toEqual({});
        expect(cleanGameSaves('str')).toEqual({});
        expect(cleanGameSaves([])).toEqual({});
    });

    it('超量条目被裁掉（防止手塞的大文件吃内存）', () => {
        const many: Record<string, string> = {};
        for (let i = 0; i < GAME_SAVE_ENTRY_MAX + 20; i += 1) many[`k${i}`] = 'v';
        expect(Object.keys(cleanGameSaves(many)).length).toBe(GAME_SAVE_ENTRY_MAX);
    });
});

describe('gameSave · 导出→导入回环', () => {
    it('导出的文件能被导入解析回同一张表', () => {
        const text = buildSaveBundle('e_1', '黄金矿工', SAVES, new Date('2026-11-17T10:00:00Z'));
        const parsed = parseSaveBundle(text);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.saves).toEqual(SAVES);
        expect(parsed.title).toBe('黄金矿工');
        expect(parsed.exportedAt).toBe('2026-11-17T10:00:00.000Z');
    });

    it('文件带身份标记与版本号（误导入别的 JSON 时要能认出来）', () => {
        const text = buildSaveBundle('e_1', 't', SAVES);
        const obj = JSON.parse(text) as Record<string, unknown>;
        expect(obj.kind).toBe(GAME_SAVE_BUNDLE_KIND);
        expect(obj.version).toBe(GAME_SAVE_BUNDLE_VERSION);
        expect(obj.entryId).toBe('e_1');
    });

    it('空存档也产出合法文件（判空是调用方的事）', () => {
        const text = buildSaveBundle('e_1', 't', {});
        const parsed = parseSaveBundle(text);
        // 空表在解析侧算「没有内容」，但文件本身必须是合法 JSON
        expect(parsed.ok).toBe(false);
        if (parsed.ok) return;
        expect(parsed.reason).toContain('没有存档内容');
    });

    it('输出带缩进与结尾换行（用户可能真的打开看一眼）', () => {
        const text = buildSaveBundle('e_1', 't', SAVES);
        expect(text).toContain('\n  ');
        expect(text.endsWith('\n')).toBe(true);
    });
});

describe('gameSave · 解析失败要说人话', () => {
    it('空文件', () => {
        const r = parseSaveBundle('   ');
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toContain('空');
    });

    it('坏 JSON 不抛，只给原因', () => {
        const r = parseSaveBundle('{ 不是 json');
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toContain('JSON');
    });

    it('数组 / 原始值都被拒绝', () => {
        expect(parseSaveBundle('[]').ok).toBe(false);
        expect(parseSaveBundle('"str"').ok).toBe(false);
    });

    it('别的 JSON（比如 catalog 备份）要认出「不是本插件存档」', () => {
        const r = parseSaveBundle(JSON.stringify({ version: 1, entries: [] }));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toContain('不是本插件的存档');
    });

    it('版本不认识时把两个版本都报给用户', () => {
        const r = parseSaveBundle(JSON.stringify({ kind: GAME_SAVE_BUNDLE_KIND, version: 99, saves: SAVES }));
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.reason).toContain('99');
        expect(r.reason).toContain(String(GAME_SAVE_BUNDLE_VERSION));
    });
});

describe('gameSave · 默认文件名', () => {
    it('带标题与时间戳', () => {
        const name = saveBundleFileName('黄金矿工', new Date(2026, 10, 17, 9, 5));
        expect(name).toBe('黄金矿工-存档-20261117-0905.json');
    });

    it('洗掉 Windows 非法字符', () => {
        const name = saveBundleFileName('a/b:c*d?e"f<g>h|i');
        expect(name).not.toMatch(/[\\/:*?"<>|]/);
        expect(name.endsWith('.json')).toBe(true);
    });

    it('空标题退回「游戏」', () => {
        expect(saveBundleFileName('   ', new Date(2026, 0, 2, 3, 4))).toBe('游戏-存档-20260102-0304.json');
    });
});
